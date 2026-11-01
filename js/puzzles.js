/*
 * Chessly puzzles — tactics puzzles from the Lichess puzzle database (CC0).
 *
 * The puzzle set itself lives in js/puzzles-data.js (built by tools/build_puzzles.py) and is only loaded when the
 * Puzzles tab is opened. Each puzzle starts one move early: the first move is the opponent's (the move that
 * creates the tactic), then the player has to find every one of their moves while the opponent's replies are
 * played automatically.
 */
(function (root) {
    'use strict';

    const DATA_SCRIPT = 'js/puzzles-data.js';
    const LICHESS_URL = 'https://lichess.org/training/';

    // Offset from the player's puzzle rating, like on Lichess.
    const DIFFICULTIES = [
        { id: 'easiest', name: 'Easiest', offset: -600 },
        { id: 'easier', name: 'Easier', offset: -300 },
        { id: 'normal', name: 'Normal', offset: 0 },
        { id: 'harder', name: 'Harder', offset: 300 },
        { id: 'hardest', name: 'Hardest', offset: 600 },
    ];

    // Themes that describe the source game rather than the tactic; they are not offered as a filter.
    const HIDDEN_THEMES = new Set(['master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality', 'oneMove']);
    const MIN_THEME_PUZZLES = 20;

    const THEME_LABELS = {
        mate: 'Checkmate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4',
        mateIn5: 'Mate in 5 or more', short: 'Short (2 moves)', long: 'Long (3 moves)', veryLong: 'Very long (4+ moves)',
        opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame', pawnEndgame: 'Pawn endgame',
        rookEndgame: 'Rook endgame', bishopEndgame: 'Bishop endgame', knightEndgame: 'Knight endgame',
        queenEndgame: 'Queen endgame', queenRookEndgame: 'Queen & rook endgame', fork: 'Fork', pin: 'Pin',
        skewer: 'Skewer', discoveredAttack: 'Discovered attack', discoveredCheck: 'Discovered check',
        doubleCheck: 'Double check', sacrifice: 'Sacrifice', deflection: 'Deflection', attraction: 'Attraction',
        clearance: 'Clearance', interference: 'Interference', intermezzo: 'Intermezzo', xRayAttack: 'X-ray attack',
        hangingPiece: 'Hanging piece', trappedPiece: 'Trapped piece', capturingDefender: 'Capture the defender',
        defensiveMove: 'Defensive move', quietMove: 'Quiet move', zugzwang: 'Zugzwang', advancedPawn: 'Advanced pawn',
        promotion: 'Promotion', underPromotion: 'Underpromotion', kingsideAttack: 'Kingside attack',
        queensideAttack: 'Queenside attack', exposedKing: 'Exposed king', attackingF2F7: 'Attacking f2 or f7',
        backRankMate: 'Back rank mate', smotheredMate: 'Smothered mate', castling: 'Castling', enPassant: 'En passant',
        crushing: 'Crushing', advantage: 'Advantage', equality: 'Equality', oneMove: 'One move', master: 'Master game',
        masterVsMaster: 'Master vs master', superGM: 'Super GM game',
    };

    // "anastasiaMate" -> "Anastasia mate" for themes without an explicit label.
    function themeLabel(theme) {
        if (THEME_LABELS[theme]) return THEME_LABELS[theme];
        const words = theme.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    function difficultyFor(id) {
        return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES.find((d) => d.id === 'normal');
    }

    // Raw data row -> puzzle object.
    function parse(row, themes) {
        const [id, fen, moves, rating, themeIndices] = row;
        return { id, fen, moves: moves.split(' '), rating, themes: themeIndices.map((i) => themes[i]) };
    }

    function prepare(data) {
        if (!data || !Array.isArray(data.puzzles) || !Array.isArray(data.themes)) throw new Error('Puzzle data is missing or broken.');
        const puzzles = data.puzzles.map((row) => parse(row, data.themes));
        const counts = new Map();
        puzzles.forEach((p) => p.themes.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
        const themes = [...counts.entries()]
            .filter(([theme, count]) => count >= MIN_THEME_PUZZLES && !HIDDEN_THEMES.has(theme))
            .map(([id, count]) => ({ id, name: themeLabel(id), count }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { puzzles, themes, source: data.source };
    }

    // Loads js/puzzles-data.js once (a script tag, so it also works when index.html is opened from disk).
    let loading = null;
    function load() {
        if (root.CHESSLY_PUZZLES) return Promise.resolve(prepare(root.CHESSLY_PUZZLES));
        if (!loading) {
            loading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = DATA_SCRIPT;
                script.onload = () => {
                    try {
                        resolve(prepare(root.CHESSLY_PUZZLES));
                    } catch (err) {
                        reject(err);
                    }
                };
                script.onerror = () => {
                    loading = null;
                    script.remove();
                    reject(new Error('Could not load the puzzles.'));
                };
                document.head.appendChild(script);
            });
        }
        return loading;
    }

    // Picks a random puzzle close to `target` rating, preferring puzzles not in `seen` (a Set of ids).
    // The rating window widens until there are enough candidates. Returns null if no puzzle has the theme.
    function pick(puzzles, { target, theme = 'all', seen = new Set(), exclude = null, random = Math.random }) {
        let pool = theme === 'all' ? puzzles : puzzles.filter((p) => p.themes.includes(theme));
        if (!pool.length) return null;
        // Never the same puzzle twice in a row, unless it is the only one.
        if (exclude && pool.length > 1) pool = pool.filter((p) => p.id !== exclude);
        const fresh = pool.filter((p) => !seen.has(p.id));
        const candidates = fresh.length ? fresh : pool;
        const wanted = Math.min(12, candidates.length);
        let near = [];
        for (let range = 75; near.length < wanted; range *= 2) {
            near = candidates.filter((p) => Math.abs(p.rating - target) <= range);
        }
        return near[Math.floor(random() * near.length)];
    }

    // UCI move ("e7e8q") -> { from, to, promotion } as used by Chess.move().
    function uciToMove(uci) {
        return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ? uci[4].toUpperCase() : undefined };
    }

    // Puzzle result for the rating: solved cleanly 1, solved with hints ½, any mistake or a shown solution 0.
    function score({ mistakes = 0, hints = 0, revealed = false }) {
        if (mistakes || revealed) return 0;
        return hints ? 0.5 : 1;
    }

    function lichessUrl(puzzle) {
        return LICHESS_URL + encodeURIComponent(puzzle.id);
    }

    const ChesslyPuzzles = {
        DIFFICULTIES,
        themeLabel,
        difficultyFor,
        parse,
        prepare,
        load,
        pick,
        uciToMove,
        score,
        lichessUrl,
    };

    root.ChesslyPuzzles = ChesslyPuzzles;
    if (typeof module === 'object' && module.exports) module.exports = ChesslyPuzzles;
})(typeof window !== 'undefined' ? window : globalThis);
