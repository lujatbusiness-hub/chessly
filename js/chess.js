/*
 * Chessly — chess rules engine (no dependencies).
 *
 * Squares are indexed 0..63: index = row * 8 + col, where row 0 is rank 8
 * and col 0 is file a. So a8 = 0, h8 = 7, a1 = 56, h1 = 63.
 * Pieces are two-letter codes: color ('w' | 'b') + type ('K' 'Q' 'R' 'B' 'N' 'P').
 */
(function (root) {
    'use strict';

    const FILES = 'abcdefgh';
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const PROMOTION_PIECES = ['Q', 'R', 'B', 'N'];
    const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const ORTHOGONALS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const SQ = { a1: 56, e1: 60, h1: 63, a8: 0, e8: 4, h8: 7 };
    const SAN_PATTERN = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])([QRBN])?$/;

    const rowOf = (sq) => sq >> 3;
    const colOf = (sq) => sq & 7;
    const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
    const opposite = (color) => (color === 'w' ? 'b' : 'w');

    function squareName(sq) {
        return FILES[colOf(sq)] + (8 - rowOf(sq));
    }

    function squareIndex(name) {
        if (typeof name === 'number') return name;
        if (!/^[a-h][1-8]$/.test(name)) return -1;
        return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
    }

    // Turns PGN-like text ("1. e4 e5 2. Nf3 {comment} Nc6") into plain move tokens.
    function tokenizeMoves(text) {
        let cleaned = String(text).replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
        while (/\([^()]*\)/.test(cleaned)) cleaned = cleaned.replace(/\([^()]*\)/g, ' ');
        return cleaned
            .replace(/\$\d+/g, ' ')
            .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/g, ' ')
            .replace(/\d+\.+/g, ' ')
            .split(/\s+/)
            .filter(Boolean);
    }

    // Removes check marks, annotations and '=' so SAN variants compare equal.
    function normalizeSan(san) {
        return String(san).trim().replace(/[+#!?]+$/g, '').replace(/e\.p\.$/, '').replace(/0/g, 'O').replace('=', '');
    }

    class Chess {
        constructor(fen = START_FEN) {
            this.load(fen);
        }

        reset() {
            this.load(START_FEN);
        }

        load(fen) {
            const parts = String(fen).trim().split(/\s+/);
            const rows = (parts[0] || '').split('/');
            if (rows.length !== 8) throw new Error('Invalid FEN: ' + fen);
            const board = new Array(64).fill(null);
            rows.forEach((rowText, r) => {
                let c = 0;
                for (const ch of rowText) {
                    if (/\d/.test(ch)) {
                        c += Number(ch);
                        continue;
                    }
                    const type = ch.toUpperCase();
                    if (!'KQRBNP'.includes(type) || c > 7) throw new Error('Invalid FEN: ' + fen);
                    board[r * 8 + c] = (ch === type ? 'w' : 'b') + type;
                    c += 1;
                }
                if (c !== 8) throw new Error('Invalid FEN: ' + fen);
            });
            const castling = parts[2] || '-';
            const ep = parts[3] && parts[3] !== '-' ? squareIndex(parts[3]) : -1;
            this.board = board;
            this.turn = parts[1] === 'b' ? 'b' : 'w';
            this.castling = {
                K: castling.includes('K'),
                Q: castling.includes('Q'),
                k: castling.includes('k'),
                q: castling.includes('q'),
            };
            this.epSquare = ep >= 0 ? ep : null;
            this.halfmoves = Number(parts[4]) || 0;
            this.fullmoves = Number(parts[5]) || 1;
            this.undoStack = [];
            this.records = [];
            this.repetitions = new Map();
            this.countPosition(1);
        }

        fen() {
            const rows = [];
            for (let r = 0; r < 8; r++) {
                let text = '';
                let empty = 0;
                for (let c = 0; c < 8; c++) {
                    const piece = this.board[r * 8 + c];
                    if (!piece) {
                        empty += 1;
                        continue;
                    }
                    if (empty) text += empty;
                    empty = 0;
                    text += piece[0] === 'w' ? piece[1] : piece[1].toLowerCase();
                }
                if (empty) text += empty;
                rows.push(text);
            }
            const castling = ['K', 'Q', 'k', 'q'].filter((k) => this.castling[k]).join('') || '-';
            const ep = this.epSquare === null ? '-' : squareName(this.epSquare);
            return [rows.join('/'), this.turn, castling, ep, this.halfmoves, this.fullmoves].join(' ');
        }

        get(square) {
            return this.board[squareIndex(square)] || null;
        }

        history() {
            return this.records.slice();
        }

        kingSquare(color) {
            return this.board.indexOf(color + 'K');
        }

        inCheck(color = this.turn) {
            const king = this.kingSquare(color);
            return king >= 0 && this.isAttacked(king, opposite(color));
        }

        // Is `sq` attacked by any piece of color `by`?
        isAttacked(sq, by) {
            const b = this.board;
            const r = rowOf(sq);
            const c = colOf(sq);
            const pawnRow = by === 'w' ? r + 1 : r - 1;
            for (const dc of [-1, 1]) {
                if (inside(pawnRow, c + dc) && b[pawnRow * 8 + c + dc] === by + 'P') return true;
            }
            for (const [dr, dc] of KNIGHT_STEPS) {
                if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'N') return true;
            }
            for (const [dr, dc] of KING_STEPS) {
                if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'K') return true;
            }
            const sliders = [[DIAGONALS, 'B'], [ORTHOGONALS, 'R']];
            for (const [dirs, type] of sliders) {
                for (const [dr, dc] of dirs) {
                    let rr = r + dr;
                    let cc = c + dc;
                    while (inside(rr, cc)) {
                        const piece = b[rr * 8 + cc];
                        if (piece) {
                            if (piece === by + type || piece === by + 'Q') return true;
                            break;
                        }
                        rr += dr;
                        cc += dc;
                    }
                }
            }
            return false;
        }

        pseudoMoves(color) {
            const b = this.board;
            const enemy = opposite(color);
            const moves = [];
            const add = (from, to, extra) => {
                moves.push(Object.assign({ from, to, piece: b[from], captured: b[to], flag: '', promotion: null }, extra));
            };

            for (let from = 0; from < 64; from++) {
                const piece = b[from];
                if (!piece || piece[0] !== color) continue;
                const type = piece[1];
                const r = rowOf(from);
                const c = colOf(from);

                if (type === 'P') {
                    const dir = color === 'w' ? -1 : 1;
                    const startRow = color === 'w' ? 6 : 1;
                    const lastRow = color === 'w' ? 0 : 7;
                    const addPawn = (to, extra) => {
                        if (rowOf(to) === lastRow) {
                            PROMOTION_PIECES.forEach((p) => add(from, to, Object.assign({ promotion: p }, extra)));
                        } else {
                            add(from, to, extra);
                        }
                    };
                    if (!inside(r + dir, c)) continue;
                    const one = from + dir * 8;
                    if (!b[one]) {
                        addPawn(one);
                        const two = one + dir * 8;
                        if (r === startRow && !b[two]) add(from, two, { flag: 'b' });
                    }
                    for (const dc of [-1, 1]) {
                        if (!inside(r + dir, c + dc)) continue;
                        const to = (r + dir) * 8 + c + dc;
                        if (b[to] && b[to][0] === enemy) addPawn(to);
                        else if (to === this.epSquare && !b[to]) add(from, to, { flag: 'e', captured: enemy + 'P' });
                    }
                    continue;
                }

                if (type === 'N' || type === 'K') {
                    for (const [dr, dc] of type === 'N' ? KNIGHT_STEPS : KING_STEPS) {
                        if (!inside(r + dr, c + dc)) continue;
                        const to = (r + dr) * 8 + c + dc;
                        if (!b[to] || b[to][0] === enemy) add(from, to);
                    }
                    if (type === 'K') this.addCastling(color, from, moves);
                    continue;
                }

                const dirs = type === 'B' ? DIAGONALS : type === 'R' ? ORTHOGONALS : DIAGONALS.concat(ORTHOGONALS);
                for (const [dr, dc] of dirs) {
                    let rr = r + dr;
                    let cc = c + dc;
                    while (inside(rr, cc)) {
                        const to = rr * 8 + cc;
                        if (b[to]) {
                            if (b[to][0] === enemy) add(from, to);
                            break;
                        }
                        add(from, to);
                        rr += dr;
                        cc += dc;
                    }
                }
            }
            return moves;
        }

        addCastling(color, from, moves) {
            const home = color === 'w' ? SQ.e1 : SQ.e8;
            if (from !== home) return;
            const b = this.board;
            const enemy = opposite(color);
            const rook = color + 'R';
            const [kingSide, queenSide] = color === 'w' ? ['K', 'Q'] : ['k', 'q'];
            const castle = (to, flag) => moves.push({ from, to, piece: color + 'K', captured: null, flag, promotion: null });
            if (!this.castling[kingSide] && !this.castling[queenSide]) return;
            if (this.isAttacked(home, enemy)) return;
            if (
                this.castling[kingSide] && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
                !this.isAttacked(home + 1, enemy) && !this.isAttacked(home + 2, enemy)
            ) {
                castle(home + 2, 'k');
            }
            if (
                this.castling[queenSide] && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
                !this.isAttacked(home - 1, enemy) && !this.isAttacked(home - 2, enemy)
            ) {
                castle(home - 2, 'q');
            }
        }

        // Low-level move application without legality checks or bookkeeping of SAN history.
        applyMove(move) {
            const b = this.board;
            const color = this.turn;
            this.undoStack.push({
                board: b.slice(),
                turn: color,
                castling: Object.assign({}, this.castling),
                epSquare: this.epSquare,
                halfmoves: this.halfmoves,
                fullmoves: this.fullmoves,
            });

            b[move.to] = move.promotion ? color + move.promotion : move.piece;
            b[move.from] = null;
            if (move.flag === 'e') b[move.to + (color === 'w' ? 8 : -8)] = null;
            if (move.flag === 'k') {
                b[move.to - 1] = b[move.to + 1];
                b[move.to + 1] = null;
            }
            if (move.flag === 'q') {
                b[move.to + 1] = b[move.to - 2];
                b[move.to - 2] = null;
            }

            if (move.piece[1] === 'K') {
                if (color === 'w') this.castling.K = this.castling.Q = false;
                else this.castling.k = this.castling.q = false;
            }
            for (const sq of [move.from, move.to]) {
                if (sq === SQ.h1) this.castling.K = false;
                if (sq === SQ.a1) this.castling.Q = false;
                if (sq === SQ.h8) this.castling.k = false;
                if (sq === SQ.a8) this.castling.q = false;
            }

            this.epSquare = move.flag === 'b' ? (move.from + move.to) / 2 : null;
            this.halfmoves = move.piece[1] === 'P' || move.captured ? 0 : this.halfmoves + 1;
            if (color === 'b') this.fullmoves += 1;
            this.turn = opposite(color);
        }

        revertMove() {
            const snapshot = this.undoStack.pop();
            if (!snapshot) return false;
            Object.assign(this, snapshot);
            return true;
        }

        // All legal moves, optionally only those starting on `from`.
        legalMoves(from) {
            const color = this.turn;
            const enemy = opposite(color);
            const fromIndex = from === undefined || from === null ? null : squareIndex(from);
            return this.pseudoMoves(color).filter((move) => {
                if (fromIndex !== null && move.from !== fromIndex) return false;
                this.applyMove(move);
                const king = this.kingSquare(color);
                const legal = king < 0 || !this.isAttacked(king, enemy);
                this.revertMove();
                return legal;
            });
        }

        sanFor(move, legal = this.legalMoves()) {
            let san;
            if (move.flag === 'k') san = 'O-O';
            else if (move.flag === 'q') san = 'O-O-O';
            else {
                const type = move.piece[1];
                const capture = move.captured ? 'x' : '';
                const to = squareName(move.to);
                if (type === 'P') {
                    san = (capture ? FILES[colOf(move.from)] + 'x' : '') + to + (move.promotion ? '=' + move.promotion : '');
                } else {
                    const rivals = legal.filter((m) => m.piece === move.piece && m.to === move.to && m.from !== move.from);
                    let disambiguation = '';
                    if (rivals.length) {
                        const sameFile = rivals.some((m) => colOf(m.from) === colOf(move.from));
                        const sameRank = rivals.some((m) => rowOf(m.from) === rowOf(move.from));
                        if (!sameFile) disambiguation = FILES[colOf(move.from)];
                        else if (!sameRank) disambiguation = String(8 - rowOf(move.from));
                        else disambiguation = squareName(move.from);
                    }
                    san = type + disambiguation + capture + to;
                }
            }
            this.applyMove(move);
            if (this.inCheck()) san += this.legalMoves().length ? '+' : '#';
            this.revertMove();
            return san;
        }

        // Finds the legal move for a SAN string or a {from, to, promotion} object, without playing it.
        resolve(input, legal = this.legalMoves()) {
            if (typeof input === 'string') {
                const san = normalizeSan(input);
                if (san === 'O-O' || san === 'O-O-O') {
                    const flag = san === 'O-O' ? 'k' : 'q';
                    return legal.find((m) => m.flag === flag) || null;
                }
                const match = SAN_PATTERN.exec(san);
                if (!match) return null;
                const [, type = 'P', file, rank, to, promotion] = match;
                const target = squareIndex(to);
                const candidates = legal.filter((m) =>
                    m.piece[1] === type &&
                    m.to === target &&
                    (!file || FILES[colOf(m.from)] === file) &&
                    (!rank || String(8 - rowOf(m.from)) === rank) &&
                    m.promotion === (promotion || null)
                );
                return candidates.length === 1 ? candidates[0] : null;
            }
            if (!input) return null;
            const from = squareIndex(input.from);
            const to = squareIndex(input.to);
            const candidates = legal.filter((m) => m.from === from && m.to === to);
            if (!candidates.length) return null;
            const promotion = input.promotion ? String(input.promotion).toUpperCase() : candidates[0].promotion ? 'Q' : null;
            return candidates.find((m) => m.promotion === promotion) || null;
        }

        // Plays a move (SAN string or {from, to, promotion}). Returns the move record or null if illegal.
        move(input) {
            const legal = this.legalMoves();
            const move = this.resolve(input, legal);
            if (!move) return null;
            const record = {
                color: this.turn,
                from: move.from,
                to: move.to,
                piece: move.piece,
                captured: move.captured,
                promotion: move.promotion,
                flag: move.flag,
                san: this.sanFor(move, legal),
            };
            this.applyMove(move);
            this.records.push(record);
            this.countPosition(1);
            return record;
        }

        undo() {
            if (!this.records.length) return null;
            this.countPosition(-1);
            this.revertMove();
            return this.records.pop();
        }

        // Position identity for repetition detection (en passant only counts if it can actually be played).
        positionKey() {
            const parts = this.fen().split(' ');
            const epPlayable = this.epSquare !== null && this.legalMoves().some((m) => m.flag === 'e');
            return parts.slice(0, 3).join(' ') + ' ' + (epPlayable ? parts[3] : '-');
        }

        countPosition(delta) {
            const key = this.positionKey();
            const count = (this.repetitions.get(key) || 0) + delta;
            if (count > 0) this.repetitions.set(key, count);
            else this.repetitions.delete(key);
        }

        insufficientMaterial() {
            const pieces = [];
            this.board.forEach((piece, sq) => {
                if (piece && piece[1] !== 'K') pieces.push({ type: piece[1], shade: (rowOf(sq) + colOf(sq)) % 2 });
            });
            if (pieces.length === 0) return true;
            if (pieces.length === 1 && (pieces[0].type === 'B' || pieces[0].type === 'N')) return true;
            return pieces.every((p) => p.type === 'B' && p.shade === pieces[0].shade);
        }

        // { over, check, result?, reason? }
        status() {
            const check = this.inCheck();
            if (!this.legalMoves().length) {
                if (check) return { over: true, check, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
                return { over: true, check, result: '1/2-1/2', reason: 'stalemate' };
            }
            if (this.halfmoves >= 100) return { over: true, check, result: '1/2-1/2', reason: 'fifty-move rule' };
            if ((this.repetitions.get(this.positionKey()) || 0) >= 3) {
                return { over: true, check, result: '1/2-1/2', reason: 'threefold repetition' };
            }
            if (this.insufficientMaterial()) return { over: true, check, result: '1/2-1/2', reason: 'insufficient material' };
            return { over: false, check };
        }

        // Counts leaf nodes of the move tree (used to verify move generation).
        perft(depth) {
            if (depth === 0) return 1;
            const moves = this.legalMoves();
            if (depth === 1) return moves.length;
            let nodes = 0;
            for (const move of moves) {
                this.applyMove(move);
                nodes += this.perft(depth - 1);
                this.revertMove();
            }
            return nodes;
        }
    }

    Chess.START_FEN = START_FEN;
    Chess.squareName = squareName;
    Chess.squareIndex = squareIndex;
    Chess.tokenizeMoves = tokenizeMoves;
    Chess.normalizeSan = normalizeSan;

    root.Chess = Chess;
    if (typeof module === 'object' && module.exports) module.exports = Chess;
})(typeof window !== 'undefined' ? window : globalThis);
