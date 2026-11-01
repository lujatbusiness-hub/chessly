/*
 * Chessly — Stockfish opponent.
 *
 * Loads vendor/stockfish/stockfish.js on first use (3 MB, so not at startup), runs it as a Web Worker
 * from a Blob URL (works from file:// too) and talks UCI with it.
 *
 *   const engine = new ChesslyEngine();
 *   engine.bestMove(['e2e4', 'e7e5'], 4).then((move) => ...);   // { from: 'g1', to: 'f3', promotion: null } or null
 *
 * Only one search runs at a time. A new request cancels the running one, and a cancelled request
 * resolves with null.
 */
(function (root) {
    'use strict';

    const SCRIPT = 'vendor/stockfish/stockfish.js';
    const FILES = 'abcdefgh';

    // Difficulty levels. Levels 1–3 cap Stockfish's skill and search depth to go below its lowest
    // calibrated strength; levels 4–9 use its built-in rating limiter (UCI_Elo, 1320–3190); level 10 is full strength.
    // Ratings are rough guides, not exact human ratings. `rating` is the label shown in the app,
    // `estimate` the number used as the opponent's rating for the player's game Elo (js/rating.js).
    const LEVELS = [
        { level: 1, name: 'Beginner', rating: '≈ 800', estimate: 800, skill: 0, depth: 1, movetime: 200 },
        { level: 2, name: 'Novice', rating: '≈ 1000', estimate: 1000, skill: 3, depth: 2, movetime: 300 },
        { level: 3, name: 'Casual', rating: '≈ 1200', estimate: 1200, skill: 6, depth: 4, movetime: 400 },
        { level: 4, name: 'Club player', rating: '≈ 1400', estimate: 1400, elo: 1400, movetime: 500 },
        { level: 5, name: 'Strong club player', rating: '≈ 1600', estimate: 1600, elo: 1600, movetime: 600 },
        { level: 6, name: 'Expert', rating: '≈ 1800', estimate: 1800, elo: 1800, movetime: 700 },
        { level: 7, name: 'Candidate master', rating: '≈ 2000', estimate: 2000, elo: 2000, movetime: 800 },
        { level: 8, name: 'Master', rating: '≈ 2300', estimate: 2300, elo: 2300, movetime: 1000 },
        { level: 9, name: 'Grandmaster', rating: '≈ 2600', estimate: 2600, elo: 2600, movetime: 1200 },
        { level: 10, name: 'Maximum', rating: '3000+', estimate: 3000, skill: 20, depth: 24, movetime: 2000 },
    ];

    function levelFor(number) {
        return LEVELS.find((l) => l.level === Number(number)) || LEVELS[2];
    }

    // Board index used by chess.js (0 = a8, 63 = h1) <-> square name.
    function squareName(index) {
        return FILES[index & 7] + (8 - (index >> 3));
    }

    function squareIndex(name) {
        return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
    }

    // chess.js move record -> UCI string ("e2e4", "e7e8q").
    function toUci(record) {
        return squareName(record.from) + squareName(record.to) + (record.promotion ? record.promotion.toLowerCase() : '');
    }

    function parseUci(uci) {
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
        return { from: squareIndex(uci.slice(0, 2)), to: squareIndex(uci.slice(2, 4)), promotion: uci[4] ? uci[4].toUpperCase() : null };
    }

    let sourceLoading = null;

    function loadSource() {
        if (root.CHESSLY_STOCKFISH) return Promise.resolve(root.CHESSLY_STOCKFISH);
        if (!sourceLoading) {
            sourceLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = SCRIPT;
                script.async = true;
                script.onload = () => (root.CHESSLY_STOCKFISH ? resolve(root.CHESSLY_STOCKFISH) : reject(new Error(`${SCRIPT} did not define the engine.`)));
                script.onerror = () => reject(new Error(`could not load ${SCRIPT}.`));
                document.head.appendChild(script);
            }).catch((err) => {
                sourceLoading = null;
                throw err;
            });
        }
        return sourceLoading;
    }

    class ChesslyEngine {
        constructor() {
            this.worker = null;
            this.ready = null;
            this.current = null; // running search
            this.next = null; // search waiting for the running one to stop
            this.status = 'idle'; // idle | loading | ready | error
        }

        // Loads and starts the engine once. Resolves when it answered "readyok".
        start() {
            if (this.ready) return this.ready;
            this.status = 'loading';
            this.ready = loadSource().then((source) => new Promise((resolve, reject) => {
                const url = URL.createObjectURL(new Blob([`(${source.toString()})()`], { type: 'text/javascript' }));
                const worker = new Worker(url);
                this.worker = worker;
                worker.onmessage = (e) => {
                    const line = String(e.data);
                    if (line === 'readyok' && this.status === 'loading') {
                        this.status = 'ready';
                        resolve();
                    } else if (line.startsWith('bestmove')) {
                        this.finish(line.split(/\s+/)[1]);
                    }
                };
                worker.onerror = (e) => {
                    e.preventDefault();
                    this.fail(new Error(e.message || 'the engine crashed.'));
                    reject(new Error(e.message || 'the engine crashed.'));
                };
                this.post('uci');
                this.post('isready');
            })).catch((err) => {
                this.fail(err);
                throw err;
            });
            return this.ready;
        }

        fail(err) {
            this.status = 'error';
            this.error = err;
            if (this.worker) this.worker.terminate();
            this.worker = null;
            this.ready = null;
            [this.current, this.next].forEach((job) => job && job.resolve(null));
            this.current = this.next = null;
        }

        post(command) {
            if (this.worker) this.worker.postMessage(command);
        }

        // `moves`: UCI moves from the start position, or from `fen` if given. Resolves with { from, to, promotion }
        // (board indices) or null.
        bestMove(moves, level, fen = null) {
            return this.start().then(() => new Promise((resolve) => {
                if (this.next) this.next.resolve(null);
                this.next = { moves, level: levelFor(level), fen, resolve };
                if (this.current) {
                    this.current.cancelled = true;
                    this.post('stop');
                } else {
                    this.run();
                }
            }));
        }

        run() {
            const job = this.next;
            this.next = null;
            this.current = job;
            if (!job) return;
            const level = job.level;
            this.post(`setoption name UCI_LimitStrength value ${level.elo ? 'true' : 'false'}`);
            if (level.elo) this.post(`setoption name UCI_Elo value ${level.elo}`);
            this.post(`setoption name Skill Level value ${level.elo ? 20 : level.skill}`);
            this.post(`position ${job.fen ? 'fen ' + job.fen : 'startpos'}${job.moves.length ? ' moves ' + job.moves.join(' ') : ''}`);
            this.post(level.depth ? `go depth ${level.depth} movetime ${level.movetime}` : `go movetime ${level.movetime}`);
        }

        finish(uci) {
            const job = this.current;
            this.current = null;
            if (job) job.resolve(job.cancelled ? null : parseUci(uci || ''));
            if (this.next) this.run();
        }

        // Stops any search; pending requests resolve with null.
        cancel() {
            if (this.next) this.next.resolve(null);
            this.next = null;
            if (this.current) {
                this.current.cancelled = true;
                this.post('stop');
            }
        }

        newGame() {
            this.cancel();
            this.post('ucinewgame');
        }
    }

    ChesslyEngine.LEVELS = LEVELS;
    ChesslyEngine.levelFor = levelFor;
    ChesslyEngine.toUci = toUci;
    root.ChesslyEngine = ChesslyEngine;
})(window);
