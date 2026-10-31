/*
 * Rating (Elo) checks. Run with: node tests/test-rating.js
 */
'use strict';

const assert = require('assert');
const Rating = require('../js/rating.js');

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

console.log('Rating:');

test('expected score is 50% for equal ratings and ~91% for +400', () => {
    assert.strictEqual(Rating.expectedScore(1500, 1500), 0.5);
    assert.ok(Math.abs(Rating.expectedScore(1900, 1500) - 0.909) < 0.001);
});

test('player moves are counted per color', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'];
    assert.strictEqual(Rating.playerMoveCount(sans, 'w'), 3);
    assert.strictEqual(Rating.playerMoveCount(sans, 'b'), 2);
});

test('longer lines are harder and difficulty is clamped', () => {
    assert.ok(Rating.lineDifficulty(10) > Rating.lineDifficulty(5));
    assert.strictEqual(Rating.lineDifficulty(0), 600);
    assert.strictEqual(Rating.lineDifficulty(100), 2600);
});

test('test score: perfect 1, mistakes and hints cost, never below 0', () => {
    assert.strictEqual(Rating.testScore(0, 0), 1);
    assert.strictEqual(Rating.testScore(1, 0), 0.75);
    assert.ok(Math.abs(Rating.testScore(0, 2) - 0.7) < 1e-9);
    assert.strictEqual(Rating.testScore(9, 9), 0);
});

test('broken or missing stored data falls back to the start rating', () => {
    assert.strictEqual(Rating.normalize(null).rating, Rating.START_RATING);
    assert.strictEqual(Rating.normalize({ rating: 'x' }).rating, Rating.START_RATING);
    assert.strictEqual(Rating.normalize({ rating: 1500.4, games: 3 }).rating, 1500);
});

test('a perfect run against an equal line gains K/2 while provisional', () => {
    const start = Rating.initialRating();
    const { data, change } = Rating.applyResult(start, { difficulty: 1200, mistakes: 0, hints: 0 });
    assert.strictEqual(change.delta, 20);
    assert.strictEqual(data.rating, 1220);
    assert.strictEqual(data.games, 1);
    assert.strictEqual(data.peak, 1220);
    assert.strictEqual(start.rating, 1200, 'input is not modified');
});

test('failing an easy line loses more than failing a hard one', () => {
    const base = Rating.normalize({ rating: 1500, games: 30 });
    const easy = Rating.applyResult(base, { difficulty: 900, mistakes: 4 }).change.delta;
    const hard = Rating.applyResult(base, { difficulty: 2100, mistakes: 4 }).change.delta;
    assert.ok(easy < hard && hard < 0, `easy ${easy}, hard ${hard}`);
});

test('K factor drops after the provisional games', () => {
    assert.strictEqual(Rating.kFactor(0), 40);
    assert.strictEqual(Rating.kFactor(Rating.PROVISIONAL_GAMES), 20);
    assert.ok(Rating.isProvisional(Rating.initialRating()));
});

test('game rating: win, draw and loss against an equal opponent', () => {
    const base = Rating.normalize({ rating: 1400, games: 25 });
    assert.strictEqual(Rating.applyGame(base, { opponent: 1400, outcome: 'win' }).change.delta, 10);
    assert.strictEqual(Rating.applyGame(base, { opponent: 1400, outcome: 'draw' }).change.delta, 0);
    assert.strictEqual(Rating.applyGame(base, { opponent: 1400, outcome: 'loss' }).change.delta, -10);
    assert.throws(() => Rating.applyGame(base, { opponent: 1400, outcome: 'resigned' }));
});

test('a draw against a much stronger opponent gains rating', () => {
    const base = Rating.normalize({ rating: 1200, games: 25 });
    assert.ok(Rating.applyGame(base, { opponent: 2000, outcome: 'draw' }).change.delta > 0);
});

test('rating never drops below the floor and history is capped', () => {
    let data = Rating.normalize({ rating: 110, games: 50 });
    for (let i = 0; i < 80; i++) data = Rating.applyGame(data, { opponent: 3000, outcome: 'loss' }).data;
    assert.ok(data.rating >= 100);
    assert.strictEqual(data.history.length, 50);
    assert.strictEqual(data.games, 130);
});

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
