/*
 * Chessly rating — an Elo rating for the player, in the style of puzzle ratings.
 *
 * Two separate ratings use the same Elo math (change = K × (score − expected score)):
 * - Training rating: every first test of a round counts as a game against the line. The line has a difficulty
 *   rating (longer lines, where you have to remember more of your own moves, are harder) and the test result is
 *   the score (a perfect run is a win, every mistake or hint costs part of it).
 * - Game rating: every finished game against Stockfish, with the level's rating as the opponent's rating
 *   (win 1, draw ½, loss 0).
 */
(function (root) {
    'use strict';

    const START_RATING = 1200;
    const MIN_RATING = 100;
    // Higher K while the rating is still provisional, so it finds the player's level quickly.
    const K_PROVISIONAL = 40;
    const K_ESTABLISHED = 20;
    const PROVISIONAL_GAMES = 20;
    // Line difficulty: base + per move the player has to play from memory, clamped to a sensible range.
    const DIFFICULTY_BASE = 600;
    const DIFFICULTY_PER_MOVE = 70;
    const DIFFICULTY_MIN = 400;
    const DIFFICULTY_MAX = 2600;
    // Score lost per mistake / per hint (a test never scores below 0).
    const MISTAKE_PENALTY = 0.25;
    const HINT_PENALTY = 0.15;
    const HISTORY_LIMIT = 50;

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    // Number of moves the player makes in a line (`sans` = all moves in order, white first).
    function playerMoveCount(sans, color) {
        return sans.filter((_, ply) => (ply % 2 === 0 ? 'w' : 'b') === color).length;
    }

    function lineDifficulty(playerMoves) {
        return clamp(Math.round(DIFFICULTY_BASE + DIFFICULTY_PER_MOVE * playerMoves), DIFFICULTY_MIN, DIFFICULTY_MAX);
    }

    function testScore(mistakes, hints) {
        return clamp(1 - MISTAKE_PENALTY * mistakes - HINT_PENALTY * hints, 0, 1);
    }

    // Probability of a perfect run as predicted by the ratings.
    function expectedScore(rating, difficulty) {
        return 1 / (1 + Math.pow(10, (difficulty - rating) / 400));
    }

    function kFactor(games) {
        return games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
    }

    function initialRating() {
        return { rating: START_RATING, games: 0, peak: START_RATING, history: [] };
    }

    // Repairs whatever was stored (missing, older or broken data).
    function normalize(data) {
        const base = initialRating();
        if (!data || typeof data !== 'object' || !Number.isFinite(data.rating)) return base;
        return {
            rating: Math.max(MIN_RATING, Math.round(data.rating)),
            games: Number.isInteger(data.games) && data.games > 0 ? data.games : 0,
            peak: Number.isFinite(data.peak) ? Math.round(data.peak) : Math.round(data.rating),
            history: Array.isArray(data.history) ? data.history.slice(-HISTORY_LIMIT) : [],
        };
    }

    function isProvisional(data) {
        return data.games < PROVISIONAL_GAMES;
    }

    // Applies one rated game with `score` (0–1) against an opponent of `opponent` rating. Returns the new rating
    // data and a summary of the change; `data` is not modified. `meta` is stored with the history entry.
    function applyScore(data, { opponent, score, meta = {}, time = Date.now() }) {
        const before = normalize(data);
        const s = clamp(score, 0, 1);
        const expected = expectedScore(before.rating, opponent);
        const k = kFactor(before.games);
        const rating = Math.max(MIN_RATING, Math.round(before.rating + k * (s - expected)));
        const delta = rating - before.rating;
        const entry = Object.assign({}, meta, { time, opponent, score: s, delta, rating });
        const after = {
            rating,
            games: before.games + 1,
            peak: Math.max(before.peak, rating),
            history: before.history.concat([entry]).slice(-HISTORY_LIMIT),
        };
        return { data: after, change: { before: before.rating, after: rating, delta, score: s, expected, opponent, k } };
    }

    // Training rating: one rated line test against a line of `difficulty`.
    function applyResult(data, { difficulty, mistakes = 0, hints = 0, meta = {}, time }) {
        const result = applyScore(data, { opponent: difficulty, score: testScore(mistakes, hints), meta, time });
        result.change.difficulty = difficulty;
        return result;
    }

    // Game rating: score of a finished game from the player's view.
    const GAME_SCORES = { win: 1, draw: 0.5, loss: 0 };

    function applyGame(data, { opponent, outcome, meta = {}, time }) {
        if (!(outcome in GAME_SCORES)) throw new Error(`Unknown game outcome: ${outcome}`);
        const result = applyScore(data, { opponent, score: GAME_SCORES[outcome], meta: Object.assign({ outcome }, meta), time });
        result.change.outcome = outcome;
        return result;
    }

    const ChesslyRating = {
        START_RATING,
        PROVISIONAL_GAMES,
        playerMoveCount,
        lineDifficulty,
        testScore,
        expectedScore,
        kFactor,
        initialRating,
        normalize,
        isProvisional,
        applyScore,
        applyResult,
        applyGame,
    };

    root.ChesslyRating = ChesslyRating;
    if (typeof module === 'object' && module.exports) module.exports = ChesslyRating;
})(typeof window !== 'undefined' ? window : globalThis);
