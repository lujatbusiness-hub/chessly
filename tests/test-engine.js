/*
 * Engine + opening data checks. Run with: node tests/test-engine.js
 */
'use strict';

const assert = require('assert');
const Chess = require('../js/chess.js');
const OPENINGS = require('../js/openings.js');

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${name}\n       ${err.message}`);
    }
}

function play(moves, fen) {
    const game = new Chess(fen);
    for (const token of Chess.tokenizeMoves(moves)) {
        assert.ok(game.move(token), `illegal move ${token}`);
    }
    return game;
}

console.log('Perft (move generation):');
const PERFT = [
    ['start position', Chess.START_FEN, [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [name, fen, counts] of PERFT) {
    test(name, () => {
        const game = new Chess(fen);
        counts.forEach((expected, i) => assert.strictEqual(game.perft(i + 1), expected, `depth ${i + 1}`));
    });
}

console.log('Rules:');
test('fool\'s mate is checkmate', () => {
    const game = play('f3 e5 g4 Qh4');
    const status = game.status();
    assert.strictEqual(status.reason, 'checkmate');
    assert.strictEqual(status.result, '0-1');
    assert.strictEqual(game.history()[3].san, 'Qh4#');
});
test('stalemate', () => {
    const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.strictEqual(game.status().reason, 'stalemate');
});
test('en passant capture removes the pawn', () => {
    const game = play('e4 a6 e5 d5 exd6');
    assert.strictEqual(game.get('d5'), null);
    assert.strictEqual(game.get('d6'), 'wP');
});
test('cannot castle through check', () => {
    const game = new Chess('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
    assert.strictEqual(game.move('O-O'), null);
    assert.ok(game.move('O-O-O'));
});
test('promotion with SAN and check suffix', () => {
    const game = new Chess('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
    assert.strictEqual(game.move('e8=Q').san, 'e8=Q+');
});
test('knight disambiguation', () => {
    const game = play('d4 d5 Nf3 Nf6');
    assert.strictEqual(game.legalMoves().map((m) => game.sanFor(m)).filter((s) => s.endsWith('d2')).sort().join(','), 'Bd2,Kd2,Nbd2,Nfd2,Qd2');
});
test('threefold repetition', () => {
    const game = play('Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8');
    assert.strictEqual(game.status().reason, 'threefold repetition');
});
test('undo restores the position', () => {
    const game = new Chess();
    const before = game.fen();
    game.move('e4');
    game.undo();
    assert.strictEqual(game.fen(), before);
});

console.log('Opening lines:');
for (const opening of OPENINGS) {
    for (const line of opening.lines) {
        test(`${opening.name} — ${line.name}`, () => play(line.moves));
    }
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
