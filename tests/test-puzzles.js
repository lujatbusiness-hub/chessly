/*
 * Puzzle checks: the puzzle helpers and the bundled Lichess puzzle set. Run with: node tests/test-puzzles.js
 */
'use strict';

const assert = require('assert');

globalThis.window = globalThis; // js/puzzles-data.js assigns window.CHESSLY_PUZZLES
const Chess = require('../js/chess.js');
const Puzzles = require('../js/puzzles.js');
require('../js/puzzles-data.js');

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

// Deterministic random numbers for pick().
function seeded(seed) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

const SAMPLE = {
    themes: ['fork', 'mateIn1', 'endgame'],
    puzzles: [
        ['a', 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', 'f2g3 e6e7 b2b1 b3c1 b1c1 h6c1', 900, [0]],
        ['b', 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', 'f2g3 e6e7', 1500, [1, 2]],
        ['c', 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', 'f2g3 e6e7', 1520, [0]],
        ['d', 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24', 'f2g3 e6e7', 2400, [2]],
    ],
};

console.log('Puzzles:');

test('raw rows are parsed into puzzles with theme names', () => {
    const { puzzles } = Puzzles.prepare(SAMPLE);
    assert.deepStrictEqual(puzzles[1].themes, ['mateIn1', 'endgame']);
    assert.deepStrictEqual(puzzles[0].moves, ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1']);
    assert.strictEqual(puzzles[0].rating, 900);
});

test('theme labels: known names and camelCase fallback', () => {
    assert.strictEqual(Puzzles.themeLabel('mateIn2'), 'Mate in 2');
    assert.strictEqual(Puzzles.themeLabel('anastasiaMate'), 'Anastasia mate');
});

test('pick prefers puzzles near the target rating', () => {
    const { puzzles } = Puzzles.prepare(SAMPLE);
    const many = Array.from({ length: 40 }, (_, i) => Object.assign({}, puzzles[i % 4], { id: `p${i}`, rating: 600 + i * 50 }));
    const random = seeded(7);
    for (let i = 0; i < 30; i++) {
        const p = Puzzles.pick(many, { target: 1500, random });
        assert.ok(Math.abs(p.rating - 1500) <= 300, `picked ${p.rating}`);
    }
});

test('pick filters by theme, skips seen puzzles and never repeats the current one', () => {
    const { puzzles } = Puzzles.prepare(SAMPLE);
    const random = seeded(3);
    for (let i = 0; i < 20; i++) {
        assert.ok(Puzzles.pick(puzzles, { target: 1500, theme: 'fork', random }).themes.includes('fork'));
        assert.strictEqual(Puzzles.pick(puzzles, { target: 1500, seen: new Set(['b']), exclude: 'c', random }).id === 'b', false);
    }
    assert.strictEqual(Puzzles.pick(puzzles, { target: 1500, theme: 'zugzwang' }), null);
    // All seen: falls back to seen puzzles instead of giving up.
    assert.ok(Puzzles.pick(puzzles, { target: 1500, seen: new Set(['a', 'b', 'c', 'd']) }));
});

test('UCI moves convert to board moves, including promotion', () => {
    assert.deepStrictEqual(Puzzles.uciToMove('e2e4'), { from: 'e2', to: 'e4', promotion: undefined });
    assert.deepStrictEqual(Puzzles.uciToMove('e7e8n'), { from: 'e7', to: 'e8', promotion: 'N' });
});

test('score: clean solve 1, with hints ½, mistakes or shown solution 0', () => {
    assert.strictEqual(Puzzles.score({}), 1);
    assert.strictEqual(Puzzles.score({ hints: 2 }), 0.5);
    assert.strictEqual(Puzzles.score({ mistakes: 1 }), 0);
    assert.strictEqual(Puzzles.score({ hints: 1, revealed: true }), 0);
});

test('difficulty falls back to normal', () => {
    assert.strictEqual(Puzzles.difficultyFor('harder').offset, 300);
    assert.strictEqual(Puzzles.difficultyFor('nonsense').id, 'normal');
});

test('bundled puzzle set: every solution is legal and the player makes the last move', () => {
    const { puzzles, themes } = Puzzles.prepare(globalThis.CHESSLY_PUZZLES);
    assert.ok(puzzles.length >= 1000, `only ${puzzles.length} puzzles`);
    assert.ok(themes.length >= 10, `only ${themes.length} theme filters`);
    for (const p of puzzles) {
        const game = new Chess(p.fen);
        const player = game.turn === 'w' ? 'b' : 'w';
        assert.ok(p.moves.length >= 2 && p.moves.length % 2 === 0, `${p.id}: ${p.moves.length} moves`);
        for (const uci of p.moves) assert.ok(game.move(Puzzles.uciToMove(uci)), `${p.id}: illegal move ${uci}`);
        assert.strictEqual(game.history()[game.history().length - 1].color, player, `${p.id}: opponent moves last`);
    }
});

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
