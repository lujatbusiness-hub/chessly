/*
 * Chessly — application logic: opening trainer, explorer, puzzles, free play and custom openings.
 */
(function () {
    'use strict';

    const config = Object.assign({ opponentDelay: 450, wrongMoveDelay: 700, demoDelay: 1100, demoStartDelay: 700, moveAnimation: 200, defaultAnimation: 'slide', boards: [], pieceSets: [], retiredPieceSets: {}, pieceColorPresets: [] }, window.CHESSLY_CONFIG || {});
    if (!config.boards.length) config.boards = [{ id: 'classic', name: 'Classic' }];
    // Older configs only had a top-level pieceSet path.
    if (!config.pieceSets.length) config.pieceSets = [{ id: 'classic', name: 'Classic', path: config.pieceSet || null }];
    const STORAGE = {
        custom: 'chessly.customOpenings.v1',
        progress: 'chessly.progress.v1',
        settings: 'chessly.settings.v1',
        rating: 'chessly.rating.v1',
        gameRating: 'chessly.gameRating.v1',
        puzzleRating: 'chessly.puzzleRating.v1',
        puzzleSeen: 'chessly.puzzleSeen.v1',
    };
    const MODES = ['train', 'explore', 'puzzles', 'free', 'design'];
    // Position shown on the board in the Design tab: every piece type plus a last-move highlight.
    const DESIGN_PREVIEW_MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'];
    const DESIGN_PREVIEW_PIECES = [['wK', 'light'], ['wN', 'dark'], ['bQ', 'light'], ['bN', 'dark']];
    // Played (and taken back) on the Design board to preview the move animation: a capture with check, then a recapture.
    const ANIMATION_PREVIEW_MOVES = ['Bxf7+', 'Kxf7'];
    const COLOR_NAMES = { w: 'White', b: 'Black' };
    const Rating = window.ChesslyRating;
    const Puzzles = window.ChesslyPuzzles;
    // Solved or skipped puzzles are remembered (newest last) so they don't come up again soon.
    const PUZZLE_SEEN_LIMIT = 4000;
    const Sound = window.ChesslySound || { PACKS: [{ id: 'off', name: 'Off', description: '', bars: [] }], play() {}, playMove() {}, setVolume() {} };
    const DEFAULT_SOUND_PACK = 'wood';
    const engine = window.ChesslyEngine ? new window.ChesslyEngine() : null;
    const ENGINE_SIDES = ['w', 'random', 'b'];
    // Events played by the sound preview in the Design tab, with their delay in ms.
    const SOUND_PREVIEW = [['move', 0], ['capture', 520], ['castle', 1040], ['check', 1600], ['complete', 2250]];
    // How many full moves of each line are practiced (0 = the whole line).
    const DEPTH_OPTIONS = [3, 5, 8, 10, 15, 0];
    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------------ Storage

    function loadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function saveJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn('[Chessly] Could not save to localStorage:', err);
        }
    }

    // ------------------------------------------------------------------ Helpers

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    function plural(count, word) {
        return `${count} ${word}${count === 1 ? '' : 's'}`;
    }

    function moveLabel(ply, san) {
        return ply % 2 === 0 ? `${ply / 2 + 1}. ${san}` : `${(ply + 1) / 2}… ${san}`;
    }

    function formatMoves(sans, limit = Infinity) {
        const parts = [];
        sans.slice(0, limit).forEach((san, i) => parts.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san));
        return parts.join(' ') + (sans.length > limit ? ' …' : '');
    }

    function namesList(names, max = 3) {
        if (names.length <= max) return names.join(', ');
        return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
    }

    // ------------------------------------------------------------------ Opening data

    function parseLine(text) {
        const game = new Chess();
        const sans = [];
        for (const token of Chess.tokenizeMoves(text)) {
            const record = game.move(token);
            if (!record) {
                const where = sans.length ? `after ${formatMoves(sans)}` : 'in the start position';
                throw new Error(`"${token}" is not a legal move ${where}.`);
            }
            sans.push(record.san);
        }
        if (!sans.length) throw new Error('No moves found.');
        return sans;
    }

    function prepareOpening(raw, custom) {
        const lines = [];
        for (const line of raw.lines || []) {
            try {
                const sans = parseLine(line.moves);
                // `full` is the whole line; `sans` is the part trained at the current depth (see applyDepth).
                lines.push({ name: line.name, full: sans, sans });
            } catch (err) {
                console.warn(`[Chessly] Skipping line "${line.name}" of "${raw.name}": ${err.message}`);
            }
        }
        return {
            id: raw.id,
            name: raw.name,
            eco: raw.eco || '',
            side: raw.side === 'b' ? 'b' : 'w',
            description: raw.description || '',
            custom,
            lines,
        };
    }

    function loadOpenings() {
        const builtIn = (window.CHESSLY_OPENINGS || []).map((raw) => prepareOpening(raw, false));
        const custom = loadJson(STORAGE.custom, []).map((raw) => prepareOpening(raw, true));
        state.openings = builtIn.concat(custom);
        applyDepth();
    }

    // ------------------------------------------------------------------ Depth (moves to train)

    function trimToDepth(sans) {
        return state.depth ? sans.slice(0, state.depth * 2) : sans.slice();
    }

    // Cuts every line to the selected depth. All training, explorer and progress code reads `line.sans`.
    function applyDepth() {
        for (const opening of state.openings) {
            for (const line of opening.lines) line.sans = trimToDepth(line.full);
        }
    }

    function longestLine(opening) {
        return opening.lines.reduce((max, line) => Math.max(max, line.full.length), 0);
    }

    // The selected depth, or 0 when it already covers every line of the opening.
    function effectiveDepth(opening) {
        return state.depth && opening && state.depth * 2 < longestLine(opening) ? state.depth : 0;
    }

    function depthLabel(depth) {
        return depth ? `First ${plural(depth, 'move')}` : 'Full lines';
    }

    // Lines that share their first moves look the same once cut short. Returns the index of the
    // first line with the same (trimmed) moves, or `index` itself.
    function sameAsIndex(opening, index) {
        const key = lineKeyOf(opening.lines[index]);
        return opening.lines.findIndex((line) => lineKeyOf(line) === key);
    }

    function distinctLineIndices(opening) {
        return opening.lines.map((_, i) => i).filter((i) => sameAsIndex(opening, i) === i);
    }

    // Library categories, in display order. Built-in openings are sorted by side and first move.
    const CATEGORIES = [
        { id: 'white-e4', label: 'White · 1.e4' },
        { id: 'white-d4', label: 'White · 1.d4' },
        { id: 'white-flank', label: 'White · Flank openings' },
        { id: 'black-e4', label: 'Black · vs 1.e4' },
        { id: 'black-d4', label: 'Black · vs 1.d4' },
        { id: 'black-flank', label: 'Black · vs flank openings' },
        { id: 'mine', label: 'My openings' },
    ];

    function categoryOf(opening) {
        if (opening.custom) return 'mine';
        const first = opening.lines[0] && opening.lines[0].sans[0];
        const group = first === 'e4' ? 'e4' : first === 'd4' ? 'd4' : 'flank';
        return `${opening.side === 'w' ? 'white' : 'black'}-${group}`;
    }

    function openingMatches(opening, query) {
        if (!query) return true;
        const haystack = [opening.name, opening.eco, ...opening.lines.map((line) => line.name)].join(' ').toLowerCase();
        return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
    }

    function currentOpening() {
        return state.openings.find((o) => o.id === state.openingId) || null;
    }

    function selectedEntries(opening) {
        if (state.lineKey === 'all') return opening.lines.map((line, index) => ({ line, index }));
        const index = Number(state.lineKey);
        return [{ line: opening.lines[index], index }];
    }

    // Merges lines into a move tree. Each node knows which lines pass through it and which end there.
    function buildTree(entries) {
        const makeNode = () => ({ children: new Map(), lines: [], ends: [] });
        const root = makeNode();
        for (const { line, index } of entries) {
            let node = root;
            node.lines.push(index);
            for (const san of line.sans) {
                if (!node.children.has(san)) node.children.set(san, makeNode());
                node = node.children.get(san);
                node.lines.push(index);
            }
            node.ends.push(index);
        }
        return root;
    }

    function walkTree(root, sans, count = sans.length) {
        let node = root;
        for (let i = 0; i < count && node; i++) node = node.children.get(sans[i]);
        return node || null;
    }

    // ------------------------------------------------------------------ Progress

    function lineKeyOf(line) {
        return line.sans.join(' ');
    }

    function lineStats(opening, index) {
        const entry = (state.progress[opening.id] || {})[lineKeyOf(opening.lines[index])];
        return entry || { completed: 0, perfect: 0 };
    }

    function recordResult(opening, index, perfect) {
        const bucket = state.progress[opening.id] || (state.progress[opening.id] = {});
        const key = lineKeyOf(opening.lines[index]);
        const entry = bucket[key] || { completed: 0, perfect: 0 };
        entry.completed += 1;
        if (perfect) entry.perfect += 1;
        entry.last = Date.now();
        bucket[key] = entry;
        saveJson(STORAGE.progress, state.progress);
    }

    // ------------------------------------------------------------------ Rating (see js/rating.js)

    function lineDifficulty(line, color) {
        return Rating.lineDifficulty(Rating.playerMoveCount(line.sans, color));
    }

    function ratingLabel(data = state.rating) {
        return `${data.rating}${Rating.isProvisional(data) ? '?' : ''}`;
    }

    function formatDelta(delta) {
        return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0';
    }

    // Only the first test of a round is rated; retries right after are practice.
    function rateRound(r) {
        const { data, change } = Rating.applyResult(state.rating, {
            difficulty: lineDifficulty(r.line, r.color),
            mistakes: r.mistakes,
            hints: r.hints,
            meta: { opening: r.opening.name, line: r.line.name, color: r.color },
        });
        state.rating = data;
        saveJson(STORAGE.rating, state.rating);
        return change;
    }

    // kind: 'rating' (training) or 'gameRating' (games vs Stockfish).
    function resetRating(kind = 'rating') {
        const label = { rating: 'training rating', gameRating: 'game rating', puzzleRating: 'puzzle rating' }[kind];
        if (!confirm(`Reset your ${label} (${ratingLabel(state[kind])}) to ${Rating.START_RATING}? Its history is deleted.`)) return;
        state[kind] = Rating.initialRating();
        saveJson(STORAGE[kind], state[kind]);
        render();
    }

    function ratingTooltip(data, name, unit, source) {
        if (!data.games) return `${name}: starts at ${Rating.START_RATING} and changes with ${source}.`;
        const last = data.history[data.history.length - 1];
        return `${name} from ${plural(data.games, unit)} (peak ${data.peak})` +
            (Rating.isProvisional(data) ? ` — provisional until ${Rating.PROVISIONAL_GAMES} ${unit}s.` : '.') +
            (last ? ` Last change: ${formatDelta(last.delta)}.` : '');
    }

    function renderRatingChip() {
        $('rating-train').textContent = ratingLabel(state.rating);
        $('rating-train').parentElement.title = ratingTooltip(state.rating, 'Training rating', 'rated test', 'every first test of a training round');
        $('rating-game').textContent = ratingLabel(state.gameRating);
        $('rating-game').parentElement.title = ratingTooltip(state.gameRating, 'Game rating', 'rated game', 'every finished game against Stockfish');
        $('rating-puzzle').textContent = ratingLabel(state.puzzleRating);
        $('rating-puzzle').parentElement.title = ratingTooltip(state.puzzleRating, 'Puzzle rating', 'rated puzzle', 'every puzzle you try');
    }

    // --- Game rating: games against Stockfish

    function newFreeGameState(vsEngine, userColor, fen = null) {
        // `level` is fixed at the start; `unrated` holds the reason a game no longer counts.
        // `fen` is the start position when the game did not start from the initial position (e.g. a puzzle).
        return { engine: vsEngine, userColor, fen, level: state.engineLevel, unrated: null, resigned: false, rated: false, ratingChange: null };
    }

    function freeGameOver() {
        return games.free.status().over || state.freeGame.resigned;
    }

    function markFreeGameUnrated(reason) {
        const g = state.freeGame;
        if (g.engine && !g.rated && !g.unrated && !freeGameOver()) g.unrated = reason;
    }

    // Outcome of the finished game from the player's view, or null while it is still going on.
    function freeGameOutcome() {
        const g = state.freeGame;
        if (g.resigned) return 'loss';
        const status = games.free.status();
        if (!status.over) return null;
        if (status.reason !== 'checkmate') return 'draw';
        return (status.result === '1-0') === (g.userColor === 'w') ? 'win' : 'loss';
    }

    // Records a finished game against Stockfish once.
    function rateFreeGame() {
        const g = state.freeGame;
        const outcome = freeGameOutcome();
        if (!g.engine || g.rated || g.unrated || !outcome) return;
        const level = window.ChesslyEngine.levelFor(g.level);
        const { data, change } = Rating.applyGame(state.gameRating, {
            opponent: level.estimate,
            outcome,
            meta: { level: level.level, color: g.userColor, moves: games.free.history().length },
        });
        state.gameRating = data;
        g.rated = true;
        g.ratingChange = change;
        saveJson(STORAGE.gameRating, state.gameRating);
    }

    function freeRatingNote() {
        const g = state.freeGame;
        if (!g.engine) return '';
        if (g.ratingChange) return ` Game rating ${formatDelta(g.ratingChange.delta)} → ${ratingLabel(state.gameRating)}.`;
        if (g.unrated) return ` Not rated (${g.unrated}).`;
        return '';
    }

    function resignFreeGame() {
        const g = state.freeGame;
        if (!g.engine || freeGameOver() || !games.free.history().length) return;
        if (!confirm(g.unrated ? 'Resign this game?' : 'Resign this game? It counts as a loss for your game rating.')) return;
        cancelEngine();
        g.resigned = true;
        rateFreeGame();
        updateFreeStatus();
        render();
        setTimeout(() => playSound('complete'), 120);
    }

    // ------------------------------------------------------------------ State

    const state = {
        mode: 'train',
        openings: [],
        openingId: null,
        lineKey: 'all',
        depth: 0,
        color: 'w',
        orientation: { train: 'w', explore: 'w', puzzles: 'w', free: 'w', design: 'w' },
        progress: loadJson(STORAGE.progress, {}),
        rating: Rating.normalize(loadJson(STORAGE.rating, null)), // training rating (line tests)
        gameRating: Rating.normalize(loadJson(STORAGE.gameRating, null)), // game rating (games vs Stockfish)
        puzzleRating: Rating.normalize(loadJson(STORAGE.puzzleRating, null)), // puzzle rating (Lichess puzzles)
        status: { train: null, explore: null, puzzles: null, free: null, design: null },
        round: null,
        explore: { opening: null, root: null, path: [], ply: 0 },
        puzzleSet: null, // { puzzles, themes } once js/puzzles-data.js is loaded
        puzzleLoad: null, // 'loading' or an error message
        puzzle: null, // the puzzle on the board, see startPuzzle()
        puzzleSeen: loadJson(STORAGE.puzzleSeen, []),
        puzzleTheme: 'all',
        puzzleDifficulty: 'normal',
        dialogSide: 'w',
        libraryOpen: false,
        libraryPreferred: true,
        librarySearch: '',
        collapsed: new Set(),
        board: null,
        pieces: null,
        pieceColors: { w: null, b: null },
        animation: 'slide',
        animationSpeed: 'normal',
        previewTimer: null,
        soundPack: DEFAULT_SOUND_PACK,
        lastSoundPack: DEFAULT_SOUND_PACK, // restored when sounds are switched back on with M
        soundVolume: 70,
        soundTimers: [],
        freeOpponent: 'human', // setting: 'human' (both sides on one board) or 'engine'
        engineLevel: 3,
        engineSide: 'w', // setting: 'w', 'b' or 'random'
        freeGame: { engine: false, userColor: 'w' }, // the game currently on the Free play board
        engineThinking: false,
        engineToken: 0, // bumped to ignore answers for positions that changed meanwhile
        engineError: null,
    };

    const games = { train: new Chess(), explore: new Chess(), puzzles: new Chess(), free: new Chess(), design: new Chess() };
    DESIGN_PREVIEW_MOVES.forEach((san) => games.design.move(san));
    const view = new BoardView($('board'), {
        onMove: handleBoardMove,
        canMove: canUserMove,
        animationMs: config.moveAnimation,
        onMoveShown: (record) => Sound.playMove(state.soundPack, record),
    });

    function playSound(event) {
        Sound.play(state.soundPack, event);
    }

    function saveSettings() {
        saveJson(STORAGE.settings, {
            mode: state.mode,
            openingId: state.openingId,
            lineKey: state.lineKey,
            depth: state.depth,
            color: state.color,
            board: state.board,
            pieces: state.pieces,
            pieceColors: state.pieceColors,
            animation: state.animation,
            animationSpeed: state.animationSpeed,
            soundPack: state.soundPack,
            lastSoundPack: state.lastSoundPack,
            soundVolume: state.soundVolume,
            freeOpponent: state.freeOpponent,
            engineLevel: state.engineLevel,
            engineSide: state.engineSide,
            puzzleTheme: state.puzzleTheme,
            puzzleDifficulty: state.puzzleDifficulty,
            libraryOpen: state.libraryPreferred,
            collapsed: [...state.collapsed],
        });
    }

    // ------------------------------------------------------------------ Design

    function findById(list, id, fallbackId) {
        return list.find((item) => item.id === id) || list.find((item) => item.id === fallbackId) || list[0];
    }

    function applyBoard(id) {
        const board = findById(config.boards, id, config.defaultBoard);
        state.board = board.id;
        document.documentElement.dataset.board = board.id;
    }

    function applyPieces(id) {
        const set = findById(config.pieceSets, id, config.defaultPieces);
        state.pieces = set.id;
        document.documentElement.dataset.pieces = set.id;
        view.setPieceSet(set.path);
    }

    // ------------------------------------------------------------------ Piece colors
    //
    // Image pieces are recolored with an SVG gradient-map filter: the image is turned into grayscale, then
    // shadows map to a dark shade of the chosen color, the set's body brightness to the color itself and
    // highlights to a light tint. Outlines, shading and details survive. Unicode pieces just use the color.

    const PIECE_SIDES = { w: '--piece-white', b: '--piece-black' };
    const LUMA_MATRIX = '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0';
    const TINT_STEPS = 32;
    const colorCanvas = document.createElement('canvas').getContext('2d');
    const baseColorCache = new Map();

    function normalizeColor(value) {
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    }

    function toRgb(color) {
        colorCanvas.fillStyle = '#000000';
        colorCanvas.fillStyle = color;
        const value = colorCanvas.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
        if (value[0] === '#') return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
        return value.match(/[\d.]+/g).slice(0, 3).map((n) => Number(n) / 255);
    }

    function luminance([r, g, b]) {
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    // Original body colors of a piece set, read from its [data-pieces] block in css/theme.css.
    function pieceSetBaseColors(id) {
        if (!baseColorCache.has(id)) {
            const probe = document.createElement('div');
            probe.dataset.pieces = id;
            probe.hidden = true;
            document.body.appendChild(probe);
            const style = getComputedStyle(probe);
            baseColorCache.set(id, { w: style.getPropertyValue('--piece-white').trim(), b: style.getPropertyValue('--piece-black').trim() });
            probe.remove();
        }
        return baseColorCache.get(id);
    }

    function tintTables(color, baseColor) {
        const target = toRgb(color);
        const mid = Math.min(Math.max(luminance(toRgb(baseColor)), 0.08), 0.92);
        const dark = target.map((c) => c * 0.12);
        const light = target.map((c) => c + (1 - c) * 0.85);
        return target.map((_, ch) => Array.from({ length: TINT_STEPS + 1 }, (__, i) => {
            const g = i / TINT_STEPS;
            const value = g <= mid
                ? dark[ch] + (target[ch] - dark[ch]) * (g / mid)
                : target[ch] + (light[ch] - target[ch]) * ((g - mid) / (1 - mid));
            return value.toFixed(3);
        }).join(' '));
    }

    function applyPieceColors() {
        const root = document.documentElement;
        const filters = [];
        const rules = [];
        Object.entries(PIECE_SIDES).forEach(([side, prop]) => {
            const color = state.pieceColors[side];
            if (color) root.style.setProperty(prop, color);
            else root.style.removeProperty(prop);
            if (!color) return;
            config.pieceSets.filter((set) => set.path).forEach((set) => {
                const id = `piece-tint-${set.id}-${side}`;
                const [r, g, b] = tintTables(color, pieceSetBaseColors(set.id)[side]);
                filters.push(`<filter id="${id}" color-interpolation-filters="sRGB">` +
                    `<feColorMatrix type="matrix" values="${LUMA_MATRIX}"/>` +
                    `<feComponentTransfer><feFuncR type="table" tableValues="${r}"/><feFuncG type="table" tableValues="${g}"/>` +
                    `<feFuncB type="table" tableValues="${b}"/></feComponentTransfer></filter>`);
                // The board (and drag ghosts) follow the active set; picker tiles show their own set.
                rules.push(`html[data-pieces="${set.id}"] .piece-${side} img, ` +
                    `.design-option[data-pieces-choice="${set.id}"] .piece-${side} img { filter: url(#${id}); }`);
            });
        });
        $('piece-tint-defs').innerHTML = filters.join('');
        $('piece-tint-style').textContent = rules.join('\n');
    }

    function setPieceColor(side, color) {
        state.pieceColors[side] = normalizeColor(color);
        applyPieceColors();
        saveSettings();
        renderPieceColorPanel();
    }

    function renderPieceColorPicker() {
        Object.keys(PIECE_SIDES).forEach((side) => {
            $(`piece-colors-${side}`).innerHTML = [
                `<button type="button" class="color-swatch original" role="radio" data-color-choice="" title="Original colors of the piece set" aria-label="Original"></button>`,
                ...config.pieceColorPresets.map((p) => `<button type="button" class="color-swatch" role="radio" data-color-choice="${escapeHtml(p.color)}" style="--swatch: ${escapeHtml(p.color)}" title="${escapeHtml(p.name)}" aria-label="${escapeHtml(p.name)}"></button>`),
                `<label class="color-swatch custom" title="Custom color"><input type="color" data-custom-color="${side}" aria-label="Custom color"></label>`,
            ].join('');
        });
    }

    function renderPieceColorPanel() {
        const base = pieceSetBaseColors(state.pieces);
        Object.keys(PIECE_SIDES).forEach((side) => {
            const current = state.pieceColors[side] || '';
            const container = $(`piece-colors-${side}`);
            let matched = false;
            container.querySelectorAll('[data-color-choice]').forEach((el) => {
                const active = el.dataset.colorChoice === current;
                matched = matched || active;
                el.classList.toggle('active', active);
                el.setAttribute('aria-checked', String(active));
            });
            container.querySelector('.original').style.setProperty('--swatch', base[side]);
            const custom = container.querySelector('.custom');
            custom.classList.toggle('active', !matched);
            if (matched) custom.style.removeProperty('--swatch');
            else custom.style.setProperty('--swatch', current);
            custom.querySelector('input').value = current || normalizeColor(base[side]) || '#ffffff';
        });
        $('btn-piece-colors-reset').disabled = !state.pieceColors.w && !state.pieceColors.b;
    }

    function applyAnimation(style, speed) {
        const styles = BoardView.ANIMATION_STYLES;
        state.animation = (styles.find((s) => s.id === style) || styles.find((s) => s.id === config.defaultAnimation) || styles[1]).id;
        state.animationSpeed = BoardView.ANIMATION_SPEEDS.includes(speed) ? speed : 'normal';
        view.setAnimation(state.animation, state.animationSpeed);
    }

    function resetDesignPreview() {
        clearTimeout(state.previewTimer);
        while (games.design.history().length > DESIGN_PREVIEW_MOVES.length) games.design.undo();
    }

    // Plays the sample moves on the Design board one by one, then takes them back.
    function previewAnimation() {
        if (state.mode !== 'design') return;
        const game = games.design;
        resetDesignPreview();
        render();
        const step = Math.max(view.moveDuration(), 150) + 380;
        const actions = ANIMATION_PREVIEW_MOVES.map((san) => () => game.move(san))
            .concat(ANIMATION_PREVIEW_MOVES.map(() => () => game.undo()));
        const run = (i) => {
            if (i >= actions.length || state.mode !== 'design') return;
            state.previewTimer = setTimeout(() => {
                if (state.mode !== 'design') return;
                actions[i]();
                render();
                run(i + 1);
            }, i === 0 ? 120 : step + (i === ANIMATION_PREVIEW_MOVES.length ? 350 : 0));
        };
        run(0);
    }

    // ------------------------------------------------------------------ Sounds

    function applySound(packId, volume) {
        const pack = Sound.PACKS.find((p) => p.id === packId) || Sound.PACKS.find((p) => p.id === DEFAULT_SOUND_PACK) || Sound.PACKS[0];
        state.soundPack = pack.id;
        if (pack.id !== 'off') state.lastSoundPack = pack.id;
        const level = Number(volume);
        state.soundVolume = Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 70;
        Sound.setVolume(state.soundVolume / 100);
    }

    function previewSound() {
        state.soundTimers.forEach(clearTimeout);
        state.soundTimers = SOUND_PREVIEW.map(([event, delay]) => setTimeout(() => {
            if (event === 'check') Sound.playMove(state.soundPack, { san: 'Qh5+' });
            else playSound(event);
        }, delay));
    }

    function toggleMute() {
        applySound(state.soundPack === 'off' ? state.lastSoundPack : 'off', state.soundVolume);
        saveSettings();
        renderDesignPanel();
        playSound('move');
    }

    function renderDesignPicker() {
        $('design-boards').innerHTML = config.boards.map((b) => `
            <button type="button" class="design-option" role="radio" data-board-choice="${escapeHtml(b.id)}">
                <span class="board-swatch" data-board="${escapeHtml(b.id)}"><span class="board-swatch-squares"></span></span>
                <span class="design-option-name">${escapeHtml(b.name)}</span>
            </button>`).join('');

        $('design-pieces').innerHTML = config.pieceSets.map((p) => `
            <button type="button" class="design-option" role="radio" data-pieces-choice="${escapeHtml(p.id)}">
                <span class="piece-strip">${DESIGN_PREVIEW_PIECES.map(([, shade]) => `<span class="strip-sq ${shade}"></span>`).join('')}</span>
                <span class="design-option-name">${escapeHtml(p.name)}</span>
            </button>`).join('');
        config.pieceSets.forEach((p) => {
            const squares = $('design-pieces').querySelectorAll(`[data-pieces-choice="${CSS.escape(p.id)}"] .strip-sq`);
            DESIGN_PREVIEW_PIECES.forEach(([piece], i) => squares[i].appendChild(createChessPiece(piece, p.path)));
        });

        $('design-sounds').innerHTML = Sound.PACKS.map((p) => `
            <button type="button" class="design-option" role="radio" data-sound-choice="${escapeHtml(p.id)}" title="${escapeHtml(p.description)}">
                <span class="sound-swatch sound-${escapeHtml(p.id)}">${p.bars.map((h, i) => `<span style="--h:${h};--i:${i}"></span>`).join('')}</span>
                <span class="design-option-name">${escapeHtml(p.name)}</span>
            </button>`).join('');

        $('design-anims').innerHTML = BoardView.ANIMATION_STYLES.map((a) => `
            <button type="button" class="design-option" role="radio" data-anim-choice="${a.id}" title="${escapeHtml(a.description)}">
                <span class="anim-swatch anim-${a.id}"><span class="anim-trail"></span><span class="anim-dot"></span>${a.trail ? '<span class="anim-tag">Trail</span>' : ''}</span>
                <span class="design-option-name">${escapeHtml(a.name)}</span>
            </button>`).join('');
    }

    function renderDesignPanel() {
        const markActive = (container, attr, current) => container.querySelectorAll('.design-option').forEach((el) => {
            const active = el.dataset[attr] === current;
            el.classList.toggle('active', active);
            el.setAttribute('aria-checked', String(active));
        });
        markActive($('design-boards'), 'boardChoice', state.board);
        markActive($('design-pieces'), 'piecesChoice', state.pieces);
        markActive($('design-anims'), 'animChoice', state.animation);
        markActive($('design-sounds'), 'soundChoice', state.soundPack);
        const pack = Sound.PACKS.find((p) => p.id === state.soundPack);
        $('design-sound-name').textContent = pack.name;
        $('design-sound-desc').textContent = pack.description;
        $('sound-volume').value = state.soundVolume;
        $('sound-volume').disabled = pack.id === 'off';
        $('sound-volume-value').textContent = `${state.soundVolume}%`;
        $('btn-sound-preview').disabled = pack.id === 'off';
        renderPieceColorPanel();
        const style = BoardView.ANIMATION_STYLES.find((a) => a.id === state.animation);
        $('design-anim-name').textContent = style.name;
        $('design-anim-desc').textContent = style.description;
        document.querySelectorAll('#anim-speed button').forEach((b) => {
            const active = b.dataset.speed === state.animationSpeed;
            b.classList.toggle('active', active);
            b.disabled = style.id === 'off';
        });
        $('btn-anim-preview').disabled = style.id === 'off';
        $('design-board-name').textContent = findById(config.boards, state.board).name;
        $('design-pieces-name').textContent = findById(config.pieceSets, state.pieces).name;
    }

    function setStatus(mode, text, kind = 'info') {
        state.status[mode] = { text, kind };
        if (mode === state.mode) renderStatus();
    }

    // ------------------------------------------------------------------ Training rounds
    //
    // A round trains one line in three steps: Watch (the line is played step by step),
    // Test (play your moves from memory, hints only, no solution) and Result.
    // While watching or testing, the rest of the app is locked so the round stays focused.

    function roundLocked() {
        const r = state.round;
        return state.mode === 'train' && !!r && r.phase !== 'result';
    }

    function clearRoundTimer(r = state.round) {
        if (r && r.timer) {
            clearTimeout(r.timer);
            r.timer = null;
        }
    }

    // Prefers lines practiced less often; avoids repeating `exclude` when there is a choice.
    // Lines that are identical at the current depth count once.
    function pickLine(opening, exclude = -1) {
        const skip = exclude >= 0 ? sameAsIndex(opening, exclude) : -1;
        const others = distinctLineIndices(opening).filter((i) => i !== skip);
        const pool = others.length ? others : [exclude];
        const weights = pool.map((i) => 1 / (1 + lineStats(opening, i).completed));
        let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
        for (let k = 0; k < pool.length; k++) {
            roll -= weights[k];
            if (roll <= 0) return pool[k];
        }
        return pool[pool.length - 1];
    }

    // Back to the lobby, where opening, line and color are chosen.
    function resetTraining() {
        clearRoundTimer();
        state.round = null;
        games.train.reset();
        state.orientation.train = state.color;
        const opening = currentOpening();
        setStatus('train', opening && opening.lines.length
            ? 'Choose a line and your color, then start a round.'
            : 'This opening has no lines yet.');
        render();
    }

    function startRound(lineIndex) {
        const opening = currentOpening();
        if (!opening || !opening.lines.length) {
            resetTraining();
            return;
        }
        clearRoundTimer();
        const index = lineIndex !== undefined ? lineIndex : state.lineKey === 'all' ? pickLine(opening) : Number(state.lineKey);
        const line = opening.lines[index];
        state.round = {
            opening,
            index,
            line,
            depth: line.sans.length < line.full.length ? state.depth : 0,
            color: state.color,
            phase: 'demo',
            ply: 0,
            playing: true,
            timer: null,
            node: null,
            mistakes: 0,
            hints: 0,
            hintLevel: 0,
            busy: false,
            marks: new Map(),
            perfect: false,
            rated: false,
            ratingChange: null,
        };
        state.orientation.train = state.color;
        games.train.reset();
        setStatus('train', `Watch the line once. You will play the ${COLOR_NAMES[state.color]} moves.`);
        render();
        scheduleDemoStep(config.demoStartDelay);
    }

    function endRound() {
        const r = state.round;
        if (r && r.phase === 'test' && games.train.history().length && !confirm('End this round? The current test is not saved.')) return;
        resetTraining();
    }

    // --- Step 1: Watch

    function demoGo(ply) {
        const r = state.round;
        const total = r.line.sans.length;
        r.ply = Math.max(0, Math.min(ply, total));
        const game = games.train;
        game.reset();
        r.line.sans.slice(0, r.ply).forEach((san) => game.move(san));
        if (r.ply === 0) {
            setStatus('train', 'Start position. Watch how the line unfolds.');
        } else {
            const label = moveLabel(r.ply - 1, r.line.sans[r.ply - 1]);
            const who = (r.ply - 1) % 2 === (r.color === 'w' ? 0 : 1) ? 'your move' : 'opponent';
            if (r.ply < total) setStatus('train', `${label} — ${who}.`);
            else {
                r.playing = false;
                setStatus('train', `${label} — end of the line. Ready? Start the test and play it from memory.`, 'success');
            }
        }
        render();
    }

    function scheduleDemoStep(delay = config.demoDelay) {
        const r = state.round;
        clearRoundTimer(r);
        if (!r || r.phase !== 'demo' || !r.playing) return;
        r.timer = setTimeout(() => {
            if (state.round !== r || r.phase !== 'demo' || !r.playing) return;
            r.timer = null;
            demoGo(r.ply + 1);
            scheduleDemoStep();
        }, delay);
    }

    function demoTogglePlay() {
        const r = state.round;
        if (!r || r.phase !== 'demo') return;
        r.playing = !r.playing;
        if (r.playing && r.ply >= r.line.sans.length) demoGo(0);
        if (r.playing) scheduleDemoStep(400);
        else clearRoundTimer(r);
        render();
    }

    function demoJump(ply) {
        const r = state.round;
        if (!r || r.phase !== 'demo') return;
        r.playing = false;
        clearRoundTimer(r);
        demoGo(ply);
    }

    // --- Step 2: Test

    function startTest() {
        const r = state.round;
        if (!r) return;
        clearRoundTimer(r);
        Object.assign(r, {
            phase: 'test',
            playing: false,
            node: buildTree([{ line: r.line, index: r.index }]),
            mistakes: 0,
            hints: 0,
            hintLevel: 0,
            busy: false,
            marks: new Map(),
        });
        games.train.reset();
        setStatus('train', r.color === 'w' ? 'Your turn — play the first move from memory.' : 'White moves first…');
        render();
        continueTest();
    }

    function continueTest() {
        const r = state.round;
        if (!r || r.phase !== 'test') return;
        if (!r.node.children.size) {
            finishTest();
            return;
        }
        if (games.train.turn === r.color) return;
        r.busy = true;
        r.timer = setTimeout(() => {
            if (state.round !== r || r.phase !== 'test') return;
            r.timer = null;
            const san = r.node.children.keys().next().value;
            const record = games.train.move(san);
            r.node = r.node.children.get(san);
            r.busy = false;
            if (!r.node.children.size) finishTest();
            else {
                setStatus('train', `Opponent played ${record.san}. Your move.`);
                render();
            }
        }, config.opponentDelay);
    }

    function testReady() {
        const r = state.round;
        return !!r && r.phase === 'test' && !r.busy && games.train.turn === r.color;
    }

    function handleTestMove(from, to, promotion) {
        if (!testReady()) return;
        const r = state.round;
        const game = games.train;
        const record = game.move({ from, to, promotion });
        if (!record) return;
        r.marks = new Map();
        const next = r.node.children.get(record.san);

        if (next) {
            r.node = next;
            r.hintLevel = 0;
            if (!next.children.size) {
                finishTest();
                return;
            }
            setStatus('train', `✓ ${record.san} — correct.`, 'success');
            render();
            continueTest();
            return;
        }

        r.mistakes += 1;
        r.busy = true;
        setTimeout(() => playSound('wrong'), 90); // after the click of the move itself
        r.marks = new Map([[record.from, 'wrong'], [record.to, 'wrong']]);
        setStatus('train', `✗ ${record.san} is not the move. Try again — or take a hint.`, 'danger');
        render();
        r.timer = setTimeout(() => {
            if (state.round !== r) return;
            r.timer = null;
            game.undo();
            r.marks = new Map();
            r.busy = false;
            render();
        }, config.wrongMoveDelay);
    }

    // Hints never reveal the move text: first the piece, then also its target square.
    function testHint() {
        if (!testReady()) return;
        const r = state.round;
        if (r.hintLevel >= 2) return;
        const moves = [...r.node.children.keys()].map((san) => games.train.resolve(san)).filter(Boolean);
        r.hints += 1;
        r.hintLevel += 1;
        playSound('hint');
        r.marks = new Map(moves.map((m) => [m.from, 'hint']));
        if (r.hintLevel === 1) setStatus('train', 'Hint: move the highlighted piece.', 'warning');
        else {
            moves.forEach((m) => r.marks.set(m.to, 'hint-target'));
            setStatus('train', 'Hint: the highlighted piece goes to the marked square.', 'warning');
        }
        render();
    }

    // --- Step 3: Result

    function finishTest() {
        const r = state.round;
        clearRoundTimer(r);
        r.phase = 'result';
        r.busy = false;
        r.marks = new Map();
        r.perfect = r.mistakes === 0 && r.hints === 0;
        recordResult(r.opening, r.index, r.perfect);
        r.ratingChange = r.rated ? null : rateRound(r);
        r.rated = true;
        const ratingNote = r.ratingChange
            ? ` Rating ${formatDelta(r.ratingChange.delta)} → ${ratingLabel()}.`
            : ' (Retry — not rated.)';
        // After the last move's own sound.
        r.timer = setTimeout(() => {
            r.timer = null;
            playSound(r.perfect ? 'perfect' : 'complete');
        }, 280);
        setStatus('train', r.perfect
            ? `Perfect! You played “${r.line.name}” from memory without a single mistake or hint.${ratingNote}`
            : `Line complete with ${plural(r.mistakes, 'mistake')} and ${plural(r.hints, 'hint')}. Retry for a perfect run.${ratingNote}`,
        'success');
        render();
    }

    function nextLine() {
        const r = state.round;
        const opening = currentOpening();
        let index;
        if (state.lineKey === 'all') index = pickLine(opening, r ? r.index : -1);
        else {
            // Next line that differs at the current depth.
            const current = Number(state.lineKey);
            const key = lineKeyOf(opening.lines[current]);
            index = current;
            for (let step = 1; step < opening.lines.length; step++) {
                const candidate = (current + step) % opening.lines.length;
                if (lineKeyOf(opening.lines[candidate]) !== key) {
                    index = candidate;
                    break;
                }
            }
            state.lineKey = String(index);
            saveSettings();
            startExplorer(true);
        }
        startRound(index);
    }

    // ------------------------------------------------------------------ Puzzles
    //
    // Lichess puzzles: the opponent plays the first move, then you find the best moves while the opponent's
    // replies are played for you. The first attempt at a puzzle is rated against the puzzle's Lichess rating:
    // the first wrong move, showing the solution or skipping after you started counts as a loss, solving it as a
    // win (half a win with hints). Retries are practice.

    function puzzleReady() {
        const p = state.puzzle;
        return !!p && p.phase === 'solve' && !p.busy && games.puzzles.turn === p.color;
    }

    function clearPuzzleTimer(p = state.puzzle) {
        if (p && p.timer) {
            clearTimeout(p.timer);
            p.timer = null;
        }
    }

    // Loads the puzzle set on first use, then shows a puzzle if there is none yet.
    function ensurePuzzle() {
        if (state.puzzle) return;
        if (state.puzzleSet) {
            nextPuzzle();
            return;
        }
        if (state.puzzleLoad === 'loading') return;
        state.puzzleLoad = 'loading';
        setStatus('puzzles', 'Loading puzzles…');
        render();
        Puzzles.load().then((set) => {
            state.puzzleSet = set;
            state.puzzleLoad = null;
            if (!set.themes.some((t) => t.id === state.puzzleTheme)) state.puzzleTheme = 'all';
            renderPuzzleFilters();
            if (!state.puzzle) nextPuzzle();
        }, (err) => {
            state.puzzleLoad = err && err.message ? err.message : String(err);
            setStatus('puzzles', state.puzzleLoad, 'danger');
            render();
        });
    }

    function puzzleTarget() {
        return state.puzzleRating.rating + Puzzles.difficultyFor(state.puzzleDifficulty).offset;
    }

    function markPuzzleSeen(id) {
        state.puzzleSeen = state.puzzleSeen.filter((seen) => seen !== id).concat([id]).slice(-PUZZLE_SEEN_LIMIT);
        saveJson(STORAGE.puzzleSeen, state.puzzleSeen);
    }

    // A rated attempt that skipping would give up: you already moved or took a hint.
    function puzzleAttemptOpen() {
        const p = state.puzzle;
        return !!p && p.phase !== 'done' && !p.rated && (p.moves > 0 || p.hints > 0);
    }

    // A puzzle that can be swapped without losing anything (finished, or not touched yet).
    function puzzleUntouched() {
        const p = state.puzzle;
        return !p || p.phase === 'done' || (!p.rated && !p.moves && !p.hints);
    }

    function nextPuzzle() {
        if (!state.puzzleSet) {
            ensurePuzzle();
            return;
        }
        if (puzzleAttemptOpen()) {
            if (!confirm('Skip this puzzle? It counts as failed for your puzzle rating.')) return;
            ratePuzzle(0);
        }
        const current = state.puzzle;
        const options = { target: puzzleTarget(), seen: new Set(state.puzzleSeen), exclude: current ? current.data.id : null };
        const data = Puzzles.pick(state.puzzleSet.puzzles, Object.assign({ theme: state.puzzleTheme }, options))
            || Puzzles.pick(state.puzzleSet.puzzles, options);
        startPuzzle(data, false);
    }

    // `practice`: a retry of a puzzle that was already rated.
    function startPuzzle(data, practice) {
        clearPuzzleTimer();
        const game = games.puzzles;
        game.load(data.fen);
        const color = game.turn === 'w' ? 'b' : 'w';
        const p = {
            data,
            color,
            ply: 0, // index of the next move in data.moves
            phase: 'setup', // setup (opponent's first move) → solve → done
            busy: true,
            timer: null,
            moves: 0,
            mistakes: 0,
            hints: 0,
            hintLevel: 0,
            revealed: false,
            marks: new Map(),
            practice,
            rated: practice,
            ratingChange: null,
        };
        state.puzzle = p;
        state.orientation.puzzles = color;
        if (!practice) markPuzzleSeen(data.id);
        setStatus('puzzles', `You play ${COLOR_NAMES[color]}. Watch the opponent's move…`);
        render();
        p.timer = setTimeout(() => {
            if (state.puzzle !== p) return;
            p.timer = null;
            const record = playPuzzleMove(p);
            p.phase = 'solve';
            p.busy = false;
            setStatus('puzzles', `${COLOR_NAMES[record.color]} played ${record.san}. Find the best move for ${COLOR_NAMES[color]}.`);
            render();
        }, config.demoStartDelay);
    }

    // Plays the next move of the solution (either side) on the puzzle board.
    function playPuzzleMove(p) {
        const record = games.puzzles.move(Puzzles.uciToMove(p.data.moves[p.ply]));
        p.ply += 1;
        return record;
    }

    function puzzleMoveMatches(record, uci) {
        const played = Chess.squareName(record.from) + Chess.squareName(record.to) + (record.promotion ? record.promotion.toLowerCase() : '');
        return played === uci;
    }

    function handlePuzzleMove(from, to, promotion) {
        if (!puzzleReady()) return;
        const p = state.puzzle;
        const game = games.puzzles;
        const record = game.move({ from, to, promotion });
        if (!record) return;
        p.moves += 1;
        p.marks = new Map();
        // Like on Lichess, any mating move is right, even if the solution has a different one.
        const correct = puzzleMoveMatches(record, p.data.moves[p.ply]) || game.status().reason === 'checkmate';

        if (correct) {
            p.ply += 1;
            p.hintLevel = 0;
            if (p.ply >= p.data.moves.length || game.status().over) {
                finishPuzzle();
                return;
            }
            p.busy = true;
            setStatus('puzzles', `✓ ${record.san} — best move! Keep going.`, 'success');
            render();
            p.timer = setTimeout(() => {
                if (state.puzzle !== p) return;
                p.timer = null;
                const reply = playPuzzleMove(p);
                p.busy = false;
                if (p.ply >= p.data.moves.length) {
                    finishPuzzle();
                    return;
                }
                setStatus('puzzles', `✓ ${record.san} — opponent replied ${reply.san}. Find the next move.`, 'success');
                render();
            }, config.opponentDelay);
            return;
        }

        p.mistakes += 1;
        if (!p.rated) ratePuzzle(0);
        p.busy = true;
        setTimeout(() => playSound('wrong'), 90); // after the click of the move itself
        p.marks = new Map([[record.from, 'wrong'], [record.to, 'wrong']]);
        setStatus('puzzles', `✗ ${record.san} is not the solution. Try again — or show the solution.${puzzleRatingNote(p, p.mistakes === 1)}`, 'danger');
        render();
        p.timer = setTimeout(() => {
            if (state.puzzle !== p) return;
            p.timer = null;
            game.undo();
            p.marks = new Map();
            p.busy = false;
            render();
        }, config.wrongMoveDelay);
    }

    // Hints never reveal the move text: first the piece, then also its target square.
    function puzzleHint() {
        if (!puzzleReady()) return;
        const p = state.puzzle;
        if (p.hintLevel >= 2) return;
        const move = Puzzles.uciToMove(p.data.moves[p.ply]);
        p.hints += 1;
        p.hintLevel += 1;
        playSound('hint');
        p.marks = new Map([[Chess.squareIndex(move.from), 'hint']]);
        if (p.hintLevel === 1) setStatus('puzzles', 'Hint: move the highlighted piece.', 'warning');
        else {
            p.marks.set(Chess.squareIndex(move.to), 'hint-target');
            setStatus('puzzles', 'Hint: the highlighted piece goes to the marked square.', 'warning');
        }
        render();
    }

    // Plays the rest of the solution move by move. Counts as a failed attempt.
    function showPuzzleSolution() {
        if (!puzzleReady()) return;
        const p = state.puzzle;
        if (!p.rated) ratePuzzle(0);
        p.revealed = true;
        p.busy = true;
        p.marks = new Map();
        const step = () => {
            if (state.puzzle !== p) return;
            p.timer = null;
            if (p.ply >= p.data.moves.length) {
                finishPuzzle();
                return;
            }
            const record = playPuzzleMove(p);
            setStatus('puzzles', `Solution: ${record.san}`, 'warning');
            render();
            p.timer = setTimeout(step, config.opponentDelay + 350);
        };
        p.timer = setTimeout(step, 150);
        render();
    }

    function finishPuzzle() {
        const p = state.puzzle;
        clearPuzzleTimer(p);
        p.phase = 'done';
        p.busy = false;
        p.marks = new Map();
        if (!p.rated) ratePuzzle(Puzzles.score(p));
        const clean = !p.revealed && !p.mistakes && !p.hints;
        // After the last move's own sound.
        p.timer = setTimeout(() => {
            p.timer = null;
            playSound(clean ? 'perfect' : 'complete');
        }, 280);
        const note = puzzleRatingNote(p, true);
        if (p.revealed) setStatus('puzzles', `That was the solution.${note}`, 'warning');
        else if (clean) setStatus('puzzles', `Solved! No mistakes, no hints.${note}`, 'success');
        else setStatus('puzzles', `Solved with ${plural(p.mistakes, 'mistake')} and ${plural(p.hints, 'hint')}.${note}`, 'success');
        render();
    }

    function ratePuzzle(score) {
        const p = state.puzzle;
        const { data, change } = Rating.applyScore(state.puzzleRating, {
            opponent: p.data.rating,
            score,
            meta: { puzzle: p.data.id },
        });
        state.puzzleRating = data;
        saveJson(STORAGE.puzzleRating, state.puzzleRating);
        p.rated = true;
        p.ratingChange = change;
    }

    function puzzleRatingNote(p, mention) {
        if (!mention) return '';
        if (p.practice) return ' (Retry — not rated.)';
        if (p.ratingChange) return ` Puzzle rating ${formatDelta(p.ratingChange.delta)} → ${ratingLabel(state.puzzleRating)}.`;
        return '';
    }

    function retryPuzzle() {
        const p = state.puzzle;
        if (p && p.phase === 'done') startPuzzle(p.data, true);
    }

    function playPuzzleOn() {
        const p = state.puzzle;
        if (!p || p.phase !== 'done' || games.puzzles.status().over) return;
        playFromPosition(games.puzzles.history().map((r) => r.san), p.color, p.data.fen);
    }

    // Theme and difficulty apply right away if nothing is lost, otherwise from the next puzzle.
    function setPuzzleOption(key, value) {
        if (state[key] === value) return;
        state[key] = value;
        saveSettings();
        if (!state.puzzleSet) return;
        if (puzzleUntouched()) nextPuzzle();
        else {
            setStatus('puzzles', 'The new setting applies from the next puzzle.');
            render();
        }
    }

    // ------------------------------------------------------------------ Explorer

    function startExplorer(keepPath) {
        const opening = currentOpening();
        const ex = state.explore;
        state.orientation.explore = state.color;
        ex.opening = opening;
        if (!opening || !opening.lines.length) {
            ex.root = null;
            ex.path = [];
            ex.ply = 0;
            games.explore.reset();
            setStatus('explore', 'This opening has no lines yet.');
            render();
            return;
        }
        ex.root = buildTree(selectedEntries(opening));
        if (state.lineKey !== 'all') {
            const sans = opening.lines[Number(state.lineKey)].sans;
            let common = 0;
            while (common < Math.min(ex.ply, sans.length) && ex.path[common] === sans[common]) common += 1;
            ex.ply = keepPath ? common : 0;
            ex.path = sans.slice();
        } else if (!keepPath || !walkTree(ex.root, ex.path)) {
            ex.path = [];
            ex.ply = 0;
        }
        extendPath();
        explorerGo(ex.ply);
    }

    // Follows the first continuation until the end of a line.
    function extendPath() {
        const ex = state.explore;
        let node = walkTree(ex.root, ex.path);
        while (node && node.children.size) {
            const [san, child] = node.children.entries().next().value;
            ex.path.push(san);
            node = child;
        }
    }

    function explorerGo(ply) {
        const ex = state.explore;
        const opening = ex.opening;
        if (!ex.root) return;
        ex.ply = Math.max(0, Math.min(ply, ex.path.length));
        const game = games.explore;
        game.reset();
        ex.path.slice(0, ex.ply).forEach((san) => game.move(san));
        const node = walkTree(ex.root, ex.path, ex.ply);
        const lineNames = (indices) => namesList(indices.map((i) => opening.lines[i].name));
        if (ex.ply === 0) {
            setStatus('explore', 'Start position. Step through with ← → or click a move / continuation.');
        } else if (!node.children.size) {
            const cut = node.ends.some((i) => opening.lines[i].full.length > opening.lines[i].sans.length);
            setStatus('explore', cut
                ? `End of the first ${plural(state.depth, 'move')}: ${lineNames(node.ends)}. Choose “All” to see more.`
                : `End of line: ${lineNames(node.ends)}.`, 'success');
        } else {
            const label = node.lines.length === 1 ? 'Line' : 'Lines';
            setStatus('explore', `${label}: ${lineNames(node.lines)}`);
        }
        render();
    }

    function explorerChoose(san) {
        const ex = state.explore;
        if (ex.path[ex.ply] !== san) {
            ex.path = ex.path.slice(0, ex.ply).concat(san);
            extendPath();
        }
        explorerGo(ex.ply + 1);
    }

    function handleExploreMove(from, to, promotion) {
        const game = games.explore;
        const record = game.move({ from, to, promotion });
        if (!record) return;
        game.undo();
        const node = walkTree(state.explore.root, state.explore.path, state.explore.ply);
        if (node && node.children.has(record.san)) explorerChoose(record.san);
        else {
            playSound('wrong');
            setStatus('explore', `${record.san} is not in the selected line(s). Use Free play to analyse freely.`, 'warning');
        }
    }

    // ------------------------------------------------------------------ Free play

    function handleFreeMove(from, to, promotion) {
        if (freeGameOver()) return;
        if (!games.free.move({ from, to, promotion })) return;
        afterFreeMove();
        engineTurn();
    }

    function afterFreeMove() {
        rateFreeGame();
        updateFreeStatus();
        render();
        if (games.free.status().over) setTimeout(() => playSound('complete'), 280);
    }

    function freeGameInProgress() {
        return games.free.history().length > 0 && !freeGameOver();
    }

    // Starts a game with the current opponent settings.
    function newFreeGame() {
        cancelEngine();
        games.free.reset();
        const vsEngine = state.freeOpponent === 'engine' && !!engine;
        const side = state.engineSide === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : state.engineSide;
        state.freeGame = newFreeGameState(vsEngine, side);
        if (vsEngine) {
            state.orientation.free = side;
            engine.newGame();
            warmEngine();
        }
        updateFreeStatus();
        render();
        engineTurn();
    }

    // Changing the opponent or your color starts a new game (after asking, if one is going on).
    function setFreeOption(key, value) {
        if (state[key] === value) return;
        if (freeGameInProgress() && !confirm('This starts a new game. Continue?')) return;
        state[key] = value;
        saveSettings();
        newFreeGame();
    }

    // Takes back moves until it is your turn again (your move and Stockfish's reply).
    function freeUndo() {
        const game = games.free;
        if (!game.history().length) return;
        if (state.freeGame.engine) {
            markFreeGameUnrated('a move was taken back');
            cancelEngine();
            game.undo();
            while (game.history().length && game.turn !== state.freeGame.userColor) game.undo();
        } else {
            game.undo();
        }
        updateFreeStatus();
        render();
        engineTurn();
    }

    // Continues a position (e.g. the end of an opening line) as a game against Stockfish.
    // `sans` are played from the initial position, or from `fen` if given.
    function playFromPosition(sans, userColor, fen = null) {
        if (roundLocked() || !engine) return;
        cancelEngine();
        games.free.load(fen || Chess.START_FEN);
        sans.forEach((san) => games.free.move(san));
        state.freeOpponent = 'engine';
        state.freeGame = newFreeGameState(true, userColor, fen);
        state.orientation.free = userColor;
        engine.newGame();
        setMode('free');
    }

    // ------------------------------------------------------------------ Stockfish

    function warmEngine() {
        if (!engine || engine.status === 'ready') return;
        engine.start().then(renderFreePanel, showEngineError);
        renderFreePanel();
    }

    function cancelEngine() {
        state.engineToken += 1;
        state.engineThinking = false;
        if (engine) engine.cancel();
    }

    function showEngineError(err) {
        state.engineThinking = false;
        state.engineError = err && err.message ? err.message : String(err);
        setStatus('free', `Stockfish could not start: ${state.engineError}`, 'danger');
        render();
    }

    // Lets Stockfish move if it is its turn. Answers for outdated positions are ignored.
    function engineTurn() {
        const game = games.free;
        if (!engine || !state.freeGame.engine || freeGameOver() || game.turn === state.freeGame.userColor) return;
        if (state.engineThinking) return;
        const token = ++state.engineToken;
        const started = Date.now();
        state.engineThinking = true;
        state.engineError = null;
        updateFreeStatus();
        render();
        engine.bestMove(game.history().map(window.ChesslyEngine.toUci), state.engineLevel, state.freeGame.fen).then((best) => {
            if (token !== state.engineToken) return;
            // A short pause so instant replies at low levels do not feel abrupt.
            const wait = Math.max(0, config.opponentDelay - (Date.now() - started));
            setTimeout(() => {
                if (token !== state.engineToken) return;
                state.engineThinking = false;
                if (!best || !game.move(best)) {
                    if (engine.status === 'error') showEngineError(engine.error);
                    else render();
                    return;
                }
                afterFreeMove();
            }, wait);
        }, (err) => {
            if (token === state.engineToken) showEngineError(err);
        });
    }

    function updateFreeStatus() {
        const game = games.free;
        const status = game.status();
        if (state.freeGame.engine) {
            const you = state.freeGame.userColor;
            const note = freeRatingNote();
            if (state.freeGame.resigned) {
                setStatus('free', `You resigned — Stockfish wins.${note}`, 'danger');
            } else if (status.reason === 'checkmate') {
                const youWin = (status.result === '1-0') === (you === 'w');
                setStatus('free', `${youWin ? 'Checkmate — you win!' : 'Checkmate — Stockfish wins.'}${note}`, youWin ? 'success' : 'danger');
            } else if (status.over) {
                setStatus('free', `Draw by ${status.reason}.${note}`, 'warning');
            } else if (state.engineThinking) {
                setStatus('free', 'Stockfish is thinking…');
            } else if (game.turn === you) {
                setStatus('free', status.check ? 'Check! Your move.' : 'Your move.', status.check ? 'danger' : 'info');
            } else if (state.engineError) {
                setStatus('free', `Stockfish could not start: ${state.engineError}`, 'danger');
            } else {
                setStatus('free', 'Stockfish to move.');
            }
            return;
        }
        if (status.reason === 'checkmate') {
            setStatus('free', `Checkmate — ${status.result === '1-0' ? 'White' : 'Black'} wins.`, 'success');
        } else if (status.over) {
            setStatus('free', `Draw by ${status.reason}.`, 'warning');
        } else if (status.check) {
            setStatus('free', `Check! ${COLOR_NAMES[game.turn]} to move.`, 'danger');
        } else {
            setStatus('free', `${COLOR_NAMES[game.turn]} to move.`);
        }
    }

    // ------------------------------------------------------------------ Board callbacks

    function canUserMove(color) {
        if (state.mode === 'train') return testReady() && color === state.round.color;
        if (state.mode === 'explore') return !!state.explore.root;
        if (state.mode === 'puzzles') return puzzleReady() && color === state.puzzle.color;
        if (state.mode === 'design') return false;
        if (freeGameOver()) return false;
        if (!state.freeGame.engine) return true;
        return color === state.freeGame.userColor && games.free.turn === color && !state.engineThinking;
    }

    function handleBoardMove(from, to, promotion) {
        if (state.mode === 'train') handleTestMove(from, to, promotion);
        else if (state.mode === 'explore') handleExploreMove(from, to, promotion);
        else if (state.mode === 'puzzles') handlePuzzleMove(from, to, promotion);
        else handleFreeMove(from, to, promotion);
    }

    // ------------------------------------------------------------------ Selection & mode changes

    // Clicking Training starts a round right away (beginning with the demo). During a round
    // the other modes are locked.
    function setMode(mode) {
        if (roundLocked()) return;
        if (state.mode === 'design') resetDesignPreview();
        state.mode = mode;
        saveSettings();
        if (mode === 'train') startRound();
        else render();
        if (mode === 'puzzles') ensurePuzzle();
        if (mode === 'free') {
            if (state.freeGame.engine) warmEngine();
            updateFreeStatus();
            render();
            engineTurn();
        }
    }

    function selectOpening(id) {
        if (roundLocked()) return;
        state.openingId = id;
        state.lineKey = 'all';
        const opening = currentOpening();
        if (opening) state.color = opening.side;
        saveSettings();
        startExplorer(false);
        resetTraining();
    }

    // ------------------------------------------------------------------ Opening library

    // The library is a column on wide screens and a drawer over the page on narrow ones.
    const drawerQuery = window.matchMedia('(max-width: 1180px)');
    const libraryIsDrawer = () => drawerQuery.matches;

    // `remember` stores the choice as the preference for wide screens (the drawer always starts closed).
    function setLibraryOpen(open, remember = true) {
        state.libraryOpen = open;
        document.body.classList.toggle('library-open', open);
        $('btn-library').classList.toggle('active', open);
        $('btn-library').setAttribute('aria-expanded', String(open));
        if (remember && !libraryIsDrawer()) {
            state.libraryPreferred = open;
            saveSettings();
        }
    }

    function chooseFromLibrary(id) {
        if (roundLocked()) return;
        if (id !== state.openingId) selectOpening(id);
        if (state.mode === 'free' || state.mode === 'design' || state.mode === 'puzzles') setMode('train');
        if (libraryIsDrawer()) setLibraryOpen(false, false);
        render();
    }

    function toggleCategory(id) {
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        saveSettings();
        renderLibrary();
    }

    function renderLibrary() {
        const query = state.librarySearch.trim();
        const html = CATEGORIES.map((category) => {
            const openings = state.openings.filter((o) => categoryOf(o) === category.id && openingMatches(o, query));
            if (!openings.length && (query || category.id !== 'mine')) return '';
            const collapsed = !query && state.collapsed.has(category.id);
            const items = openings.map((opening) => {
                const distinct = distinctLineIndices(opening);
                const total = distinct.length;
                const perfect = distinct.filter((i) => lineStats(opening, i).perfect > 0).length;
                const meta = [opening.eco, plural(opening.lines.length, 'line')].filter(Boolean).join(' · ');
                const active = opening.id === state.openingId ? 'active' : '';
                return `
                    <li><button type="button" class="library-item ${active}" data-opening="${escapeHtml(opening.id)}">
                        <span class="library-item-name">${escapeHtml(opening.name)}</span>
                        <span class="library-item-score ${total && perfect === total ? 'done' : ''}" title="Lines played perfectly (${escapeHtml(depthLabel(effectiveDepth(opening)).toLowerCase())})">★ ${perfect}/${total}</span>
                        <span class="library-item-meta">${escapeHtml(meta)}</span>
                        <span class="library-progress"><span style="width:${total ? (perfect / total) * 100 : 0}%"></span></span>
                    </button></li>`;
            }).join('');
            const empty = openings.length ? '' : '<p class="library-empty">Save a line from Free play or add one below.</p>';
            return `
                <section class="library-group ${collapsed ? 'collapsed' : ''}">
                    <button type="button" class="library-group-head" data-category="${category.id}" aria-expanded="${!collapsed}">
                        <span class="library-chevron">▾</span>${escapeHtml(category.label)}
                        <span class="library-count">${openings.length}</span>
                    </button>
                    <ul class="library-items">${items}</ul>${empty}
                </section>`;
        }).join('');
        $('library-list').innerHTML = html || '<p class="library-empty">No openings match your search.</p>';
    }

    function selectLine(key) {
        if (roundLocked()) return;
        state.lineKey = key;
        saveSettings();
        startExplorer(true);
        resetTraining();
    }

    function selectDepth(depth) {
        if (roundLocked() || !DEPTH_OPTIONS.includes(depth)) return;
        state.depth = depth;
        applyDepth();
        const ex = state.explore;
        ex.path = trimToDepth(ex.path);
        ex.ply = Math.min(ex.ply, ex.path.length);
        saveSettings();
        startExplorer(true);
        resetTraining();
    }

    function selectColor(color) {
        if (roundLocked()) return;
        state.color = color;
        saveSettings();
        resetTraining();
        state.orientation.explore = color;
        render();
    }

    // ------------------------------------------------------------------ Custom openings

    function customOpenings() {
        return loadJson(STORAGE.custom, []);
    }

    function openLineDialog(prefill = '') {
        const select = $('dlg-opening');
        const customs = customOpenings();
        select.innerHTML = '<option value="__new">+ New opening…</option>' +
            customs.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('');
        const opening = currentOpening();
        select.value = opening && opening.custom ? opening.id : '__new';
        $('dlg-opening-name').value = '';
        $('dlg-line-name').value = '';
        $('dlg-moves').value = prefill;
        $('dlg-error').textContent = '';
        state.dialogSide = opening && opening.custom ? opening.side : state.mode === 'free' ? state.orientation.free : state.color;
        syncDialog();
        $('line-dialog').showModal();
        (prefill ? $('dlg-line-name') : $('dlg-moves')).focus();
    }

    function syncDialog() {
        const id = $('dlg-opening').value;
        $('dlg-name-field').classList.toggle('hidden', id !== '__new');
        if (id !== '__new') {
            const existing = customOpenings().find((o) => o.id === id);
            if (existing) state.dialogSide = existing.side;
        }
        $('dlg-side').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.color === state.dialogSide));
    }

    function saveLineFromDialog(event) {
        event.preventDefault();
        const error = $('dlg-error');
        let sans;
        try {
            sans = parseLine($('dlg-moves').value);
        } catch (err) {
            error.textContent = err.message;
            return;
        }
        const customs = customOpenings();
        const targetId = $('dlg-opening').value;
        let opening;
        if (targetId === '__new') {
            const name = $('dlg-opening-name').value.trim();
            if (!name) {
                error.textContent = 'Please give the new opening a name.';
                return;
            }
            opening = { id: 'custom-' + Date.now().toString(36), name, side: state.dialogSide, description: '', lines: [] };
            customs.push(opening);
        } else {
            opening = customs.find((o) => o.id === targetId);
            opening.side = state.dialogSide;
        }
        const lineName = $('dlg-line-name').value.trim() || `Line ${opening.lines.length + 1}`;
        opening.lines.push({ name: lineName, moves: sans.join(' ') });
        saveJson(STORAGE.custom, customs);
        $('line-dialog').close();
        loadOpenings();
        selectOpening(opening.id);
        if (state.mode === 'free') setMode('train');
        if (!roundLocked()) setStatus(state.mode, `Saved “${lineName}” to ${opening.name}.`, 'success');
    }

    function deleteCustomLine(index) {
        const opening = currentOpening();
        if (!opening || !opening.custom) return;
        if (!confirm(`Delete the line “${opening.lines[index].name}”?`)) return;
        const customs = customOpenings();
        const stored = customs.find((o) => o.id === opening.id);
        stored.lines = stored.lines.filter((line) => line.moves !== opening.lines[index].full.join(' '));
        const remaining = stored.lines.length ? customs : customs.filter((o) => o.id !== opening.id);
        saveJson(STORAGE.custom, remaining);
        loadOpenings();
        selectOpening(stored.lines.length ? opening.id : state.openings[0].id);
    }

    function deleteCustomOpening() {
        const opening = currentOpening();
        if (!opening || !opening.custom) return;
        if (!confirm(`Delete “${opening.name}” and all of its lines?`)) return;
        saveJson(STORAGE.custom, customOpenings().filter((o) => o.id !== opening.id));
        delete state.progress[opening.id];
        saveJson(STORAGE.progress, state.progress);
        loadOpenings();
        selectOpening(state.openings[0].id);
    }

    // ------------------------------------------------------------------ Rendering

    function render() {
        const mode = state.mode;
        const game = games[mode];
        if (view.game !== game) view.setGame(game);
        view.setOrientation(state.orientation[mode]);
        const r = mode === 'train' ? state.round : null;
        if (mode === 'puzzles') view.marks = state.puzzle ? state.puzzle.marks : new Map();
        else view.marks = r && r.phase === 'test' ? r.marks : new Map();
        view.arrows = [];
        view.render();

        const locked = roundLocked();
        document.body.classList.toggle('round-locked', locked);
        document.querySelectorAll('#mode-tabs .tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
            tab.disabled = locked && tab.dataset.mode !== mode;
            tab.title = tab.disabled ? 'Finish or end the round first' : '';
        });
        document.querySelectorAll('.mode-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== mode));
        $('opening-card').classList.toggle('hidden', mode === 'free' || mode === 'design' || mode === 'puzzles' || !!r);
        renderLibrary();
        $('moves-card').classList.toggle('hidden', mode === 'design');

        renderOpeningCard();
        renderRoundPanel();
        renderExplorePanel();
        renderPuzzlePanel();
        renderFreePanel();
        renderDesignPanel();
        renderMoveList();
        renderStatus();
        renderTurn();
        renderRatingChip();
    }

    function renderOpeningCard() {
        const opening = currentOpening();
        if (!opening) return;
        $('opening-title').textContent = opening.name;
        const meta = [opening.eco, plural(opening.lines.length, 'line'), `Repertoire for ${COLOR_NAMES[opening.side]}`].filter(Boolean);
        $('opening-meta').textContent = meta.join(' · ');
        $('opening-desc').textContent = opening.description;
        $('opening-desc').classList.toggle('hidden', !opening.description);
        $('btn-delete-opening').classList.toggle('hidden', !opening.custom);
        document.querySelectorAll('#color-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.color === state.color));

        renderDepthPicker(opening);
        const distinct = distinctLineIndices(opening);
        const perfectLines = distinct.filter((i) => lineStats(opening, i).perfect > 0).length;
        const items = [`
            <li class="line-item ${state.lineKey === 'all' ? 'active' : ''}" data-line="all">
                <span class="line-name">All lines</span>
                <span class="line-badges"><span class="badge ${perfectLines === distinct.length && perfectLines ? 'perfect' : ''}">★ ${perfectLines}/${distinct.length}</span></span>
                <span class="line-moves">Opponent picks a random branch</span>
            </li>`];
        opening.lines.forEach((line, i) => {
            const stats = lineStats(opening, i);
            const same = sameAsIndex(opening, i);
            const preview = same === i
                ? formatMoves(line.sans, 10)
                : `= “${opening.lines[same].name}” in the first ${plural(state.depth, 'move')}`;
            const badges = [];
            if (stats.perfect) badges.push(`<span class="badge perfect" title="Perfect runs">★ ${stats.perfect}</span>`);
            if (stats.completed) badges.push(`<span class="badge" title="Completed runs">✓ ${stats.completed}</span>`);
            if (opening.custom) badges.push(`<button class="line-delete" type="button" data-delete="${i}" title="Delete line">×</button>`);
            items.push(`
                <li class="line-item ${state.lineKey === String(i) ? 'active' : ''} ${same === i ? '' : 'same'}" data-line="${i}">
                    <span class="line-name">${escapeHtml(line.name)}</span>
                    <span class="line-badges"><span class="line-length" title="Length of the full line">${Math.ceil(line.full.length / 2)} mv</span>${badges.join('')}</span>
                    <span class="line-moves">${escapeHtml(preview)}</span>
                </li>`);
        });
        $('line-list').innerHTML = items.join('');
    }

    function renderDepthPicker(opening) {
        const longest = longestLine(opening);
        const active = effectiveDepth(opening);
        $('depth-toggle').innerHTML = DEPTH_OPTIONS.map((depth) => {
            const covered = depth && depth * 2 >= longest;
            const title = covered ? 'All lines of this opening are this short or shorter' : depthLabel(depth);
            return `<button type="button" data-depth="${depth}" class="${depth === active ? 'active' : ''}" role="radio"
                aria-checked="${depth === active}" title="${escapeHtml(title)}" ${covered ? 'disabled' : ''}>${depth || 'All'}</button>`;
        }).join('');
        $('depth-note').textContent = longest ? `Longest line: ${plural(Math.ceil(longest / 2), 'move')}` : '';
    }

    function renderRoundPanel() {
        const panel = $('round-panel');
        const r = state.round;
        const opening = currentOpening();
        const steps = [['demo', 'Watch'], ['test', 'Test'], ['result', 'Result']];
        const phaseIndex = r ? steps.findIndex(([id]) => id === r.phase) : -1;
        const stepper = `<ol class="round-steps">${steps.map(([id, label], i) => `
            <li class="${i === phaseIndex ? 'current' : i < phaseIndex ? 'done' : ''}"><span>${i + 1}</span>${label}</li>`).join('')}</ol>`;
        const stat = (value, label) => `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;

        if (!r) {
            const hasLines = opening && opening.lines.length;
            const lineLabel = !hasLines ? '—'
                : state.lineKey === 'all' ? 'A random line (least practiced first)' : opening.lines[Number(state.lineKey)].name;
            const difficulties = !hasLines ? []
                : (state.lineKey === 'all' ? distinctLineIndices(opening) : [Number(state.lineKey)])
                    .map((i) => lineDifficulty(opening.lines[i], state.color));
            const low = Math.min(...difficulties);
            const high = Math.max(...difficulties);
            const difficultyLabel = !difficulties.length ? '—' : low === high ? String(low) : `${low}–${high}`;
            const rating = state.rating;
            panel.innerHTML = `
                ${stepper}
                <p class="round-intro">Each round: <strong>watch</strong> the line once, then <strong>test</strong> yourself —
                    from memory, with hints only.</p>
                <div class="round-summary"><span>Line</span><strong>${escapeHtml(lineLabel)}</strong>
                    <span>Moves</span><strong>${depthLabel(effectiveDepth(opening))}</strong>
                    <span>You play</span><strong>${COLOR_NAMES[state.color]}</strong>
                    <span>Line rating</span><strong title="Difficulty of the line: grows with the number of moves you play from memory">${difficultyLabel}</strong></div>
                <div class="rating-summary">
                    <div><span class="rating-summary-label">Training rating</span>
                        <strong class="rating-summary-value">${ratingLabel(rating)}</strong></div>
                    <div class="rating-summary-meta">${rating.games
                        ? `${plural(rating.games, 'rated test')} · peak ${rating.peak}${Rating.isProvisional(rating) ? ' · provisional' : ''}`
                        : 'Unrated — your first tests set it'}</div>
                    ${rating.games ? '<button class="btn ghost small" type="button" data-action="reset-rating">Reset</button>' : ''}
                </div>
                <button class="btn primary big" type="button" data-action="start" ${hasLines ? '' : 'disabled'}>▶ Start round</button>`;
            return;
        }

        const total = r.line.sans.length;
        const header = `
            <div class="round-line">
                <span class="round-opening">${escapeHtml(r.opening.name)}</span>
                <span class="round-line-name">${escapeHtml(r.line.name)}${r.depth ? ` · first ${plural(r.depth, 'move')}` : ''} · you play ${COLOR_NAMES[r.color]}</span>
            </div>`;

        if (r.phase === 'demo') {
            const atEnd = r.ply >= total;
            panel.innerHTML = `
                ${stepper}${header}
                <div class="round-progress"><span style="width:${(r.ply / total) * 100}%"></span></div>
                <div class="round-counter">Move ${r.ply} / ${total}</div>
                <div class="btn-row nav-row">
                    <button class="btn" type="button" data-action="demo-first" title="Start" ${r.ply === 0 ? 'disabled' : ''}>&#9198;</button>
                    <button class="btn" type="button" data-action="demo-prev" title="Back (←)" ${r.ply === 0 ? 'disabled' : ''}>&#9664;</button>
                    <button class="btn" type="button" data-action="demo-play" title="Play / pause (Space)">${r.playing ? '&#10074;&#10074;' : '&#9654;&#xFE0E; Play'}</button>
                    <button class="btn" type="button" data-action="demo-next" title="Forward (→)" ${atEnd ? 'disabled' : ''}>&#9654;</button>
                </div>
                <div class="round-actions">
                    <button class="btn primary big ${atEnd ? 'ready' : ''}" type="button" data-action="test" title="Enter">Start test →</button>
                    <button class="btn ghost small" type="button" data-action="end">End round</button>
                </div>`;
            return;
        }

        if (r.phase === 'test') {
            const yourMoves = Math.ceil((total - (r.color === 'w' ? 0 : 1)) / 2);
            const played = games.train.history().filter((m) => m.color === r.color).length;
            panel.innerHTML = `
                ${stepper}${header}
                <div class="round-progress test"><span style="width:${(played / yourMoves) * 100}%"></span></div>
                <div class="train-stats">${stat(`${played}/${yourMoves}`, 'Your moves')}${stat(r.mistakes, 'Mistakes')}${stat(r.hints, 'Hints')}</div>
                <div class="round-actions">
                    <button class="btn" type="button" data-action="hint" title="Hint (H)" ${testReady() && r.hintLevel < 2 ? '' : 'disabled'}>
                        💡 Hint ${r.hintLevel ? `(${r.hintLevel}/2)` : ''}</button>
                    <button class="btn ghost small" type="button" data-action="end">End round</button>
                </div>`;
            return;
        }

        const others = distinctLineIndices(r.opening).length > 1;
        panel.innerHTML = `
            ${stepper}${header}
            <div class="round-result ${r.perfect ? 'perfect' : ''}">
                <span class="round-result-icon">${r.perfect ? '★' : '✓'}</span>
                <span>${r.perfect ? 'Perfect run' : 'Line complete'}</span>
            </div>
            <div class="train-stats">${stat(Math.ceil(total / 2), 'Moves')}${stat(r.mistakes, 'Mistakes')}${stat(r.hints, 'Hints')}</div>
            ${renderRatingChange(r)}
            <div class="round-actions grid">
                <button class="btn primary" type="button" data-action="retry" title="R">↻ Retry test</button>
                <button class="btn" type="button" data-action="watch">▶ Watch again</button>
                ${others ? '<button class="btn" type="button" data-action="next" title="N">Next line →</button>' : ''}
                <button class="btn ghost" type="button" data-action="end">Back to lobby</button>
                ${engine ? '<button class="btn wide" type="button" data-action="play" title="Continue the final position against Stockfish">♞ Play on vs Stockfish</button>' : ''}
            </div>`;
    }

    function renderRatingChange(r) {
        const c = r.ratingChange;
        if (!c) {
            return `<div class="rating-change unrated"><span>Rating</span><strong>${ratingLabel()}</strong>
                <span class="rating-change-note">Retry — not rated. Start a new round to play for rating.</span></div>`;
        }
        const kind = c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : '';
        return `<div class="rating-change ${kind}">
                <span>Rating</span>
                <strong>${c.before} → ${ratingLabel()}</strong>
                <span class="rating-change-delta">${formatDelta(c.delta)}</span>
                <span class="rating-change-note">Line rating ${c.difficulty} · score ${Math.round(c.score * 100)}% (expected ${Math.round(c.expected * 100)}%)</span>
            </div>`;
    }

    // Fills the theme and difficulty pickers (themes once the puzzle set is loaded).
    function renderPuzzleFilters() {
        const set = state.puzzleSet;
        const themes = set ? set.themes : [];
        $('puzzle-theme').innerHTML = '<option value="all">All themes</option>' +
            themes.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${t.count})</option>`).join('');
        $('puzzle-theme').value = themes.some((t) => t.id === state.puzzleTheme) ? state.puzzleTheme : 'all';
        $('puzzle-difficulty').innerHTML = Puzzles.DIFFICULTIES.map((d) =>
            `<option value="${d.id}">${d.name}${d.offset ? ` (${d.offset > 0 ? '+' : '−'}${Math.abs(d.offset)})` : ''}</option>`).join('');
        $('puzzle-difficulty').value = state.puzzleDifficulty;
    }

    function renderPuzzlePanel() {
        if (state.mode !== 'puzzles') return;
        const p = state.puzzle;
        const body = $('puzzle-body');
        const stat = (value, label) => `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
        $('puzzle-id').innerHTML = p
            ? `<a href="${Puzzles.lichessUrl(p.data)}" target="_blank" rel="noopener" title="Open this puzzle on Lichess">#${escapeHtml(p.data.id)} ↗</a>`
            : '';

        if (!p) {
            const error = state.puzzleLoad && state.puzzleLoad !== 'loading';
            body.innerHTML = error
                ? `<p class="round-intro">${escapeHtml(state.puzzleLoad)}</p>
                   <button class="btn primary" type="button" data-action="load">Try again</button>`
                : '<p class="round-intro">Loading puzzles…</p>';
        } else {
            const done = p.phase === 'done';
            const themes = done
                ? p.data.themes.map((t) => `<span class="badge">${escapeHtml(Puzzles.themeLabel(t))}</span>`).join('')
                : '<span class="puzzle-hidden">shown when solved</span>';
            const summary = `
                <div class="round-summary">
                    <span>You play</span><strong>${COLOR_NAMES[p.color]}</strong>
                    <span>Puzzle rating</span><strong>${done ? p.data.rating : '?'}</strong>
                    <span>Themes</span><div class="puzzle-themes">${themes}</div>
                </div>`;
            if (!done) {
                const canAct = puzzleReady();
                body.innerHTML = `${summary}
                    <div class="train-stats">${stat(p.mistakes, 'Mistakes')}${stat(p.hints, 'Hints')}${stat(p.practice ? 'Retry' : p.rated ? 'Failed' : 'Rated', 'Attempt')}</div>
                    <div class="round-actions grid">
                        <button class="btn" type="button" data-action="hint" title="Hint (H)" ${canAct && p.hintLevel < 2 ? '' : 'disabled'}>
                            💡 Hint ${p.hintLevel ? `(${p.hintLevel}/2)` : ''}</button>
                        <button class="btn" type="button" data-action="solution" ${canAct ? '' : 'disabled'}>Show solution</button>
                        <button class="btn ghost wide" type="button" data-action="next" title="N">Skip puzzle →</button>
                    </div>`;
            } else {
                const solved = !p.revealed;
                const clean = solved && !p.mistakes && !p.hints;
                body.innerHTML = `${summary}
                    <div class="round-result ${clean ? 'perfect' : ''}">
                        <span class="round-result-icon">${clean ? '★' : solved ? '✓' : '👁'}</span>
                        <span>${clean ? 'Solved' : solved ? 'Solved with help' : 'Solution shown'}</span>
                    </div>
                    ${renderPuzzleRatingChange(p)}
                    <div class="round-actions grid">
                        <button class="btn primary" type="button" data-action="next" title="N / Enter">Next puzzle →</button>
                        <button class="btn" type="button" data-action="retry" title="R">↻ Retry</button>
                        ${engine && !games.puzzles.status().over ? '<button class="btn wide" type="button" data-action="play" title="Continue the final position against Stockfish">♞ Play on vs Stockfish</button>' : ''}
                    </div>`;
            }
        }

        const rating = state.puzzleRating;
        const box = $('puzzle-rating');
        box.querySelector('.rating-summary-value').textContent = ratingLabel(rating);
        const target = Math.max(0, puzzleTarget());
        box.querySelector('.rating-summary-meta').textContent = (rating.games
            ? `${plural(rating.games, 'rated puzzle')} · peak ${rating.peak}${Rating.isProvisional(rating) ? ' · provisional' : ''}`
            : 'Unrated — your first puzzles set it') + ` · next puzzles ≈ ${target}`;
        $('btn-puzzle-rating-reset').classList.toggle('hidden', !rating.games);
    }

    function renderPuzzleRatingChange(p) {
        const c = p.ratingChange;
        if (!c) {
            return `<div class="rating-change unrated"><span>Rating</span><strong>${ratingLabel(state.puzzleRating)}</strong>
                <span class="rating-change-note">Retry — not rated.</span></div>`;
        }
        const kind = c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : '';
        return `<div class="rating-change ${kind}">
                <span>Rating</span>
                <strong>${c.before} → ${c.after}</strong>
                <span class="rating-change-delta">${formatDelta(c.delta)}</span>
                <span class="rating-change-note">Puzzle rating ${c.opponent} · score ${Math.round(c.score * 100)}% (expected ${Math.round(c.expected * 100)}%)</span>
            </div>`;
    }

    function renderGameRating(vsEngine) {
        const box = $('game-rating');
        box.classList.toggle('hidden', !vsEngine || !engine);
        if (!vsEngine || !engine) return;
        const data = state.gameRating;
        const g = state.freeGame;
        const level = window.ChesslyEngine.levelFor(g.engine ? g.level : state.engineLevel);
        const expected = Math.round(Rating.expectedScore(data.rating, level.estimate) * 100);
        let line = `vs level ${level.level} (${level.estimate}): expected score ${expected}%`;
        if (g.ratingChange) line = `Last game ${formatDelta(g.ratingChange.delta)} (${g.ratingChange.outcome})`;
        else if (g.unrated) line = `This game is not rated: ${g.unrated}.`;
        box.querySelector('.rating-summary-value').textContent = ratingLabel(data);
        box.querySelector('.rating-summary-meta').textContent = data.games
            ? `${plural(data.games, 'rated game')} · peak ${data.peak}${Rating.isProvisional(data) ? ' · provisional' : ''} — ${line}`
            : `Unrated — finished games set it. ${line[0].toUpperCase()}${line.slice(1)}`;
        $('btn-game-rating-reset').classList.toggle('hidden', !data.games);
    }

    function renderFreePanel() {
        const vsEngine = state.freeOpponent === 'engine';
        const setActive = (selector, attr, value) => document.querySelectorAll(selector).forEach((b) => {
            b.classList.toggle('active', b.dataset[attr] === value);
            b.setAttribute('aria-checked', String(b.dataset[attr] === value));
        });
        setActive('#free-opponent button', 'opponent', state.freeOpponent);
        setActive('#engine-side button', 'side', state.engineSide);
        $('free-opponent').querySelector('[data-opponent="engine"]').disabled = !engine;
        $('engine-settings').classList.toggle('hidden', !vsEngine);
        if (engine) {
            const level = window.ChesslyEngine.levelFor(state.engineLevel);
            $('engine-level').value = level.level;
            $('engine-level-name').textContent = `${level.level} · ${level.name}`;
            $('engine-level-rating').textContent = level.rating;
        }
        let engineState = '';
        if (vsEngine && engine) {
            if (state.engineError || engine.status === 'error') engineState = 'Unavailable';
            else if (engine.status === 'loading') engineState = 'Loading…';
            else if (state.engineThinking) engineState = 'Thinking…';
            else if (engine.status === 'ready') engineState = 'Ready';
        }
        $('engine-state').textContent = engineState;
        $('engine-state').className = `engine-state ${state.engineThinking ? 'thinking' : ''}`;
        $('btn-free-undo').disabled = !games.free.history().length || state.freeGame.resigned;
        // Opening lines start from the initial position, so a game from a puzzle position can't be saved as one.
        $('btn-free-save').disabled = !!state.freeGame.fen;
        $('btn-free-save').title = state.freeGame.fen ? 'Only games from the initial position can be saved as a line' : '';
        const g = state.freeGame;
        $('btn-free-resign').classList.toggle('hidden', !vsEngine || !g.engine);
        $('btn-free-resign').disabled = !g.engine || !games.free.history().length || freeGameOver();
        renderGameRating(vsEngine);
        $('free-hint').textContent = vsEngine
            ? 'Changing the opponent or your color starts a new game. Undo takes back your last move and Stockfish’s reply. The strength applies from the next move. Finished and resigned games count for your game rating; a game with an undo or a strength change is not rated.'
            : 'Play both sides freely. Use “Save as line” to turn the moves into your own opening.';
    }

    function renderExplorePanel() {
        const ex = state.explore;
        $('btn-explore-play').disabled = !ex.root || !engine;
        $('btn-first').disabled = $('btn-prev').disabled = ex.ply === 0;
        $('btn-next').disabled = $('btn-last').disabled = ex.ply >= ex.path.length;
        const node = ex.root ? walkTree(ex.root, ex.path, ex.ply) : null;
        const box = $('continuations');
        if (!node || !node.children.size) {
            box.innerHTML = node ? '<span>End of line.</span>' : '';
            return;
        }
        const opening = ex.opening;
        box.innerHTML = '<span>Next:</span>' + [...node.children.entries()].map(([san, child]) => {
            const title = child.lines.map((i) => opening.lines[i].name).join(', ');
            const active = ex.path[ex.ply] === san ? 'active' : '';
            return `<button class="chip ${active}" type="button" data-san="${escapeHtml(san)}" title="${escapeHtml(title)}">${escapeHtml(moveLabel(ex.ply, san))}</button>`;
        }).join('');
    }

    function renderMoveList() {
        const list = $('move-list');
        const explore = state.mode === 'explore';
        const demo = state.mode === 'train' && !!state.round && state.round.phase === 'demo';
        const sans = explore ? state.explore.path : games[state.mode].history().map((r) => r.san);
        const current = explore ? state.explore.ply - 1 : sans.length - 1;
        if (!sans.length) {
            list.innerHTML = '<p class="empty">No moves yet.</p>';
            return;
        }
        // Games from a position (puzzles) keep that position's move numbers; if Black moves first, the
        // first row starts with an empty White cell.
        const startFen = state.mode === 'puzzles' && state.puzzle ? state.puzzle.data.fen : state.mode === 'free' ? state.freeGame.fen : null;
        const fenParts = startFen ? startFen.split(' ') : [];
        const offset = fenParts[1] === 'b' ? 1 : 0;
        const firstMove = Number(fenParts[5]) || 1;
        const cell = (i) => {
            if (i < 0) return '<span class="move empty-cell">…</span>';
            if (i >= sans.length) return '<span></span>';
            const classes = ['move', explore || demo ? 'clickable' : '', i === current ? 'current' : '', i > current ? 'future' : ''].join(' ');
            return `<button class="${classes}" type="button" data-ply="${i + 1}">${escapeHtml(sans[i])}</button>`;
        };
        let html = '';
        for (let i = -offset; i < sans.length; i += 2) html += `<span class="move-num">${firstMove + (i + offset) / 2}.</span>${cell(i)}${cell(i + 1)}`;
        list.innerHTML = html;
        const active = list.querySelector('.move.current');
        if (active) list.scrollTop = active.offsetTop - list.clientHeight / 2;
    }

    function renderStatus() {
        const status = state.status[state.mode] || { text: '', kind: 'info' };
        const el = $('status');
        el.textContent = status.text;
        el.className = `status ${status.kind}`;
        el.classList.toggle('hidden', !status.text);
    }

    function renderTurn() {
        const turn = games[state.mode].turn;
        $('turn-indicator').innerHTML = `<span class="turn-dot ${turn}"></span>${COLOR_NAMES[turn]} to move`;
    }

    // ------------------------------------------------------------------ Events

    function bindEvents() {
        $('mode-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (tab) setMode(tab.dataset.mode);
        });
        $('btn-library').addEventListener('click', () => setLibraryOpen(!state.libraryOpen));
        drawerQuery.addEventListener('change', () => setLibraryOpen(libraryIsDrawer() ? false : state.libraryPreferred, false));
        $('library-backdrop').addEventListener('click', () => setLibraryOpen(false));
        $('library-search').addEventListener('input', (e) => {
            state.librarySearch = e.target.value;
            renderLibrary();
        });
        $('library-list').addEventListener('click', (e) => {
            const head = e.target.closest('[data-category]');
            if (head) {
                toggleCategory(head.dataset.category);
                return;
            }
            const item = e.target.closest('[data-opening]');
            if (item) chooseFromLibrary(item.dataset.opening);
        });
        $('btn-library-add').addEventListener('click', () => openLineDialog(''));
        $('color-toggle').addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (button) selectColor(button.dataset.color);
        });
        $('depth-toggle').addEventListener('click', (e) => {
            const button = e.target.closest('[data-depth]');
            if (button && !button.disabled) selectDepth(Number(button.dataset.depth));
        });
        $('line-list').addEventListener('click', (e) => {
            const del = e.target.closest('[data-delete]');
            if (del) {
                deleteCustomLine(Number(del.dataset.delete));
                return;
            }
            const item = e.target.closest('.line-item');
            if (item) selectLine(item.dataset.line);
        });
        $('design-boards').addEventListener('click', (e) => {
            const option = e.target.closest('[data-board-choice]');
            if (!option) return;
            applyBoard(option.dataset.boardChoice);
            saveSettings();
            renderDesignPanel();
        });
        $('design-pieces').addEventListener('click', (e) => {
            const option = e.target.closest('[data-pieces-choice]');
            if (!option) return;
            applyPieces(option.dataset.piecesChoice);
            saveSettings();
            renderDesignPanel();
        });
        Object.keys(PIECE_SIDES).forEach((side) => {
            const container = $(`piece-colors-${side}`);
            container.addEventListener('click', (e) => {
                const swatch = e.target.closest('[data-color-choice]');
                if (swatch) setPieceColor(side, swatch.dataset.colorChoice || null);
            });
            container.addEventListener('input', (e) => {
                if (e.target.matches('[data-custom-color]')) setPieceColor(side, e.target.value);
            });
        });
        $('btn-piece-colors-reset').addEventListener('click', () => {
            state.pieceColors = { w: null, b: null };
            applyPieceColors();
            saveSettings();
            renderPieceColorPanel();
        });
        $('design-anims').addEventListener('click', (e) => {
            const option = e.target.closest('[data-anim-choice]');
            if (!option) return;
            applyAnimation(option.dataset.animChoice, state.animationSpeed);
            saveSettings();
            renderDesignPanel();
            previewAnimation();
        });
        $('anim-speed').addEventListener('click', (e) => {
            const button = e.target.closest('[data-speed]');
            if (!button) return;
            applyAnimation(state.animation, button.dataset.speed);
            saveSettings();
            renderDesignPanel();
            previewAnimation();
        });
        $('btn-anim-preview').addEventListener('click', previewAnimation);
        $('design-sounds').addEventListener('click', (e) => {
            const option = e.target.closest('[data-sound-choice]');
            if (!option) return;
            applySound(option.dataset.soundChoice, state.soundVolume);
            saveSettings();
            renderDesignPanel();
            playSound('move');
            setTimeout(() => playSound('capture'), 380);
        });
        $('sound-volume').addEventListener('input', (e) => {
            applySound(state.soundPack, e.target.value);
            $('sound-volume-value').textContent = `${state.soundVolume}%`;
        });
        $('sound-volume').addEventListener('change', () => {
            saveSettings();
            playSound('move');
        });
        $('btn-sound-preview').addEventListener('click', previewSound);
        $('btn-flip').addEventListener('click', () => {
            state.orientation[state.mode] = state.orientation[state.mode] === 'w' ? 'b' : 'w';
            render();
        });

        $('round-panel').addEventListener('click', (e) => {
            const button = e.target.closest('[data-action]');
            if (!button || button.disabled) return;
            const r = state.round;
            const actions = {
                start: () => startRound(),
                test: startTest,
                end: endRound,
                hint: testHint,
                retry: startTest,
                watch: () => startRound(r.index),
                play: () => playFromPosition(r.line.sans, r.color),
                next: nextLine,
                'reset-rating': () => resetRating('rating'),
                'demo-first': () => demoJump(0),
                'demo-prev': () => demoJump(r.ply - 1),
                'demo-next': () => demoJump(r.ply + 1),
                'demo-play': demoTogglePlay,
            };
            actions[button.dataset.action]();
        });

        $('puzzle-panel').addEventListener('click', (e) => {
            const button = e.target.closest('[data-action]');
            if (!button || button.disabled) return;
            const actions = {
                load: ensurePuzzle,
                hint: puzzleHint,
                solution: showPuzzleSolution,
                next: nextPuzzle,
                retry: retryPuzzle,
                play: playPuzzleOn,
            };
            actions[button.dataset.action]();
        });
        $('puzzle-theme').addEventListener('change', (e) => setPuzzleOption('puzzleTheme', e.target.value));
        $('puzzle-difficulty').addEventListener('change', (e) => setPuzzleOption('puzzleDifficulty', e.target.value));
        $('btn-puzzle-rating-reset').addEventListener('click', () => resetRating('puzzleRating'));

        $('btn-first').addEventListener('click', () => explorerGo(0));
        $('btn-prev').addEventListener('click', () => explorerGo(state.explore.ply - 1));
        $('btn-next').addEventListener('click', () => explorerGo(state.explore.ply + 1));
        $('btn-last').addEventListener('click', () => explorerGo(state.explore.path.length));
        $('continuations').addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (chip) explorerChoose(chip.dataset.san);
        });
        $('move-list').addEventListener('click', (e) => {
            const move = e.target.closest('.move.clickable');
            if (!move) return;
            if (state.mode === 'train') demoJump(Number(move.dataset.ply));
            else explorerGo(Number(move.dataset.ply));
        });

        $('btn-free-new').addEventListener('click', () => {
            if (freeGameInProgress() && !confirm('Start a new game?')) return;
            newFreeGame();
        });
        $('btn-free-undo').addEventListener('click', freeUndo);
        $('btn-free-resign').addEventListener('click', resignFreeGame);
        $('btn-game-rating-reset').addEventListener('click', () => resetRating('gameRating'));
        $('free-opponent').addEventListener('click', (e) => {
            const button = e.target.closest('[data-opponent]');
            if (button && !button.disabled) setFreeOption('freeOpponent', button.dataset.opponent);
        });
        $('engine-side').addEventListener('click', (e) => {
            const button = e.target.closest('[data-side]');
            if (button) setFreeOption('engineSide', button.dataset.side);
        });
        $('engine-level').addEventListener('input', (e) => {
            state.engineLevel = Number(e.target.value);
            const g = state.freeGame;
            // Before the first move the new strength simply becomes the game's level; later it makes the game unrated.
            if (!games.free.history().length || freeGameOver()) g.level = state.engineLevel;
            else if (g.level !== state.engineLevel) markFreeGameUnrated('the strength was changed during the game');
            updateFreeStatus();
            renderFreePanel();
        });
        $('engine-level').addEventListener('change', saveSettings);
        $('btn-explore-play').addEventListener('click', () => playFromPosition(state.explore.path.slice(0, state.explore.ply), state.color));
        $('btn-free-save').addEventListener('click', () => openLineDialog(formatMoves(games.free.history().map((r) => r.san))));

        $('btn-new-opening').addEventListener('click', () => openLineDialog(''));
        $('btn-delete-opening').addEventListener('click', deleteCustomOpening);
        $('dlg-opening').addEventListener('change', syncDialog);
        $('dlg-side').addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            state.dialogSide = button.dataset.color;
            syncDialog();
        });
        $('dlg-cancel').addEventListener('click', () => $('line-dialog').close());
        $('line-form').addEventListener('submit', saveLineFromDialog);

        document.addEventListener('keydown', (e) => {
            if ($('line-dialog').open || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
            const key = e.key.toLowerCase();
            if (key === 'f') $('btn-flip').click();
            if (key === 'p' && state.mode === 'design') previewAnimation();
            if (key === 'o') setLibraryOpen(!state.libraryOpen);
            if (key === 'm') toggleMute();
            if (key === 'escape' && state.libraryOpen && libraryIsDrawer()) setLibraryOpen(false);
            if (state.mode === 'train') {
                const r = state.round;
                const phase = r ? r.phase : 'lobby';
                const shortcuts = {
                    lobby: { enter: () => startRound() },
                    demo: {
                        ' ': demoTogglePlay,
                        arrowleft: () => demoJump(r.ply - 1),
                        arrowright: () => demoJump(r.ply + 1),
                        enter: startTest,
                    },
                    test: { h: testHint },
                    result: { r: startTest, n: () => distinctLineIndices(r.opening).length > 1 && nextLine() },
                }[phase];
                if (shortcuts[key]) {
                    e.preventDefault();
                    shortcuts[key]();
                }
            }
            if (state.mode === 'puzzles' && state.puzzle) {
                const done = state.puzzle.phase === 'done';
                const shortcuts = done ? { n: nextPuzzle, enter: nextPuzzle, r: retryPuzzle } : { h: puzzleHint, n: nextPuzzle };
                if (shortcuts[key]) {
                    e.preventDefault();
                    shortcuts[key]();
                }
            }
            if (state.mode === 'explore') {
                const ex = state.explore;
                const target = { arrowleft: ex.ply - 1, arrowright: ex.ply + 1, home: 0, end: ex.path.length }[key];
                if (target !== undefined) {
                    e.preventDefault();
                    explorerGo(target);
                }
            }
        });
    }

    // ------------------------------------------------------------------ Init

    function init() {
        loadOpenings();
        const settings = loadJson(STORAGE.settings, {});
        const saved = state.openings.find((o) => o.id === settings.openingId);
        const opening = saved || state.openings[0];
        state.openingId = opening.id;
        state.lineKey = saved && (settings.lineKey === 'all' || opening.lines[Number(settings.lineKey)]) ? String(settings.lineKey) : 'all';
        state.color = saved && (settings.color === 'w' || settings.color === 'b') ? settings.color : opening.side;
        state.depth = DEPTH_OPTIONS.includes(settings.depth) ? settings.depth : 0;
        applyDepth();
        state.mode = MODES.includes(settings.mode) ? settings.mode : 'train';

        bindEvents();
        renderDesignPicker();
        // Older settings stored one combined theme; use it for both board and pieces.
        applyBoard(settings.board || settings.theme);
        // Removed duplicate piece sets map to the set with the same shapes, keeping their old colors.
        const retired = config.retiredPieceSets[settings.pieces];
        const savedColors = settings.pieceColors || (retired ? { w: retired.w, b: retired.b } : {});
        state.pieceColors = { w: normalizeColor(savedColors.w), b: normalizeColor(savedColors.b) };
        applyPieces(retired ? retired.pieces : settings.pieces || settings.theme);
        renderPieceColorPicker();
        applyPieceColors();
        applyAnimation(settings.animation, settings.animationSpeed);
        applySound(settings.soundPack, settings.soundVolume === undefined ? 70 : settings.soundVolume);
        if (Sound.PACKS.some((p) => p.id === settings.lastSoundPack && p.id !== 'off')) state.lastSoundPack = settings.lastSoundPack;
        state.freeOpponent = settings.freeOpponent === 'engine' && engine ? 'engine' : 'human';
        state.engineSide = ENGINE_SIDES.includes(settings.engineSide) ? settings.engineSide : 'w';
        if (engine) state.engineLevel = window.ChesslyEngine.levelFor(settings.engineLevel).level;
        if (typeof settings.puzzleTheme === 'string') state.puzzleTheme = settings.puzzleTheme;
        state.puzzleDifficulty = Puzzles.difficultyFor(settings.puzzleDifficulty).id;
        renderPuzzleFilters();
        const startSide = state.engineSide === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : state.engineSide;
        state.freeGame = newFreeGameState(state.freeOpponent === 'engine', startSide);
        if (state.freeGame.engine) state.orientation.free = startSide;
        state.collapsed = new Set(Array.isArray(settings.collapsed) ? settings.collapsed : []);
        state.libraryPreferred = settings.libraryOpen !== false;
        setLibraryOpen(state.libraryPreferred && !libraryIsDrawer(), false);
        updateFreeStatus();
        startExplorer(false);
        resetTraining();
        if (retired) saveSettings();
        if (state.mode === 'free' && state.freeGame.engine) {
            warmEngine();
            engineTurn();
        }
        if (state.mode === 'puzzles') {
            render();
            ensurePuzzle();
        }
    }

    init();
})();
