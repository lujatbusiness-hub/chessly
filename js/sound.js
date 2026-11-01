/*
 * Chessly — sound effects.
 *
 * Every sound is synthesized with the Web Audio API, so no audio files are needed and the app still
 * works straight from index.html. A sound pack decides how the events sound:
 *
 *   move, capture, castle, promote   a piece is placed on the board
 *   check                            accent played on top of the move that gives check
 *   wrong                            wrong or illegal move
 *   hint, complete, perfect          trainer feedback
 *
 * Each pack has a `hit` (the sound of a piece landing) and a `timbre` for the short melodies.
 * Packs may override any event with their own function.
 */
(function (root) {
    'use strict';

    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let volume = 0.7;

    // Audio can only start after a user gesture; the context is created lazily and resumed on demand.
    function audio() {
        if (!ctx) {
            const AudioCtx = root.AudioContext || root.webkitAudioContext;
            if (!AudioCtx) return null;
            ctx = new AudioCtx();
            const limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -10;
            limiter.ratio.value = 6;
            master = ctx.createGain();
            master.gain.value = volume;
            master.connect(limiter).connect(ctx.destination);
            noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    const vary = (value, amount = 0.04) => value * (1 + (Math.random() * 2 - 1) * amount);
    const note = (base, semitones) => base * Math.pow(2, semitones / 12);

    function envelope(param, t, peak, attack, decay) {
        param.setValueAtTime(0.0001, t);
        param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
        param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    // Filtered noise burst: clicks, knocks, thumps and hiss.
    function noise(t, o) {
        const attack = o.attack || 0.001;
        const decay = o.decay || 0.05;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = o.filter || 'bandpass';
        filter.frequency.setValueAtTime(o.freq || 1000, t);
        if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(o.freqEnd, t + attack + decay);
        filter.Q.value = o.q || 1;
        const gain = ctx.createGain();
        envelope(gain.gain, t, o.gain || 0.5, attack, decay);
        src.connect(filter).connect(gain).connect(master);
        src.start(t, Math.random() * 0.5);
        src.stop(t + attack + decay + 0.05);
    }

    // Oscillator with an optional pitch sweep and low-pass filter.
    function tone(t, o) {
        const attack = o.attack || 0.004;
        const decay = o.decay || 0.2;
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.freq, t);
        if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + attack + decay * (o.sweep || 0.6));
        if (o.detune) osc.detune.value = o.detune;
        const gain = ctx.createGain();
        envelope(gain.gain, t, o.gain || 0.3, attack, decay);
        let head = osc;
        if (o.lowpass) {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(o.lowpass, t);
            if (o.lowpassEnd) filter.frequency.exponentialRampToValueAtTime(o.lowpassEnd, t + attack + decay);
            filter.Q.value = o.q || 0.7;
            head = osc.connect(filter);
        }
        head.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + attack + decay + 0.05);
    }

    // Inharmonic partials: bells, glass and stone.
    function bell(t, freq, o = {}) {
        const ratios = o.ratios || [1, 2.76, 5.4];
        ratios.forEach((ratio, i) => tone(t, {
            freq: freq * ratio,
            gain: (o.gain || 0.2) / (i + 1),
            attack: 0.002,
            decay: (o.decay || 0.6) / (1 + i * 0.6),
        }));
    }

    // A short melody in the pack's timbre. `steps` are semitones above the pack's base note.
    function melody(pack, t, steps, o = {}) {
        const tm = pack.timbre;
        const gap = o.gap || tm.gap || 0.09;
        steps.forEach((step, i) => {
            const freq = note(tm.base, step);
            const at = t + i * gap;
            if (tm.bell) bell(at, freq, { gain: (o.gain || 1) * tm.gain, decay: tm.decay, ratios: tm.ratios });
            else tone(at, { type: tm.type, freq, gain: (o.gain || 1) * tm.gain, decay: tm.decay, lowpass: tm.lowpass, attack: tm.attack });
        });
    }

    // Events every pack gets unless it defines its own.
    const DEFAULT_EVENTS = {
        move: (p, t) => p.hit(t, { strength: 1 }),
        capture: (p, t) => {
            p.hit(t, { strength: 1.25, capture: true });
            p.hit(t + 0.045, { strength: 0.7, capture: true });
        },
        castle: (p, t) => {
            p.hit(t, { strength: 0.9 });
            p.hit(t + 0.12, { strength: 0.9 });
        },
        promote: (p, t) => {
            p.hit(t, { strength: 1 });
            melody(p, t + 0.08, [0, 4, 7, 12], { gap: 0.06, gain: 0.7 });
        },
        check: (p, t) => melody(p, t + 0.05, [7, 13], { gap: 0.08, gain: 0.8 }),
        wrong: (p, t) => {
            tone(t, { type: 'square', freq: 155, freqEnd: 120, gain: 0.12, decay: 0.12, lowpass: 900 });
            tone(t + 0.13, { type: 'square', freq: 120, freqEnd: 95, gain: 0.12, decay: 0.18, lowpass: 800 });
        },
        hint: (p, t) => melody(p, t, [12], { gain: 0.45 }),
        complete: (p, t) => melody(p, t, [0, 4, 7], { gain: 0.8 }),
        perfect: (p, t) => {
            melody(p, t, [0, 4, 7, 12], { gain: 0.8 });
            melody(p, t + 0.42, [16, 19, 24], { gap: 0.05, gain: 0.45 });
        },
    };

    const PACKS = [
        {
            id: 'off',
            name: 'Off',
            description: 'No sounds.',
            bars: [1, 1, 1, 1, 1],
        },
        {
            id: 'wood',
            name: 'Wood',
            description: 'Classic wooden pieces on a wooden board.',
            bars: [3, 9, 5, 2, 1],
            hit(t, o) {
                const low = o.capture ? 0.72 : 1;
                noise(t, { freq: vary(1900 * low), q: 1.3, gain: 0.55 * o.strength, decay: 0.03 });
                tone(t, { freq: vary(760 * low), freqEnd: 600 * low, gain: 0.32 * o.strength, decay: 0.06 });
                tone(t, { type: 'triangle', freq: vary(190 * low), gain: 0.22 * o.strength, decay: 0.08 });
            },
            timbre: { type: 'triangle', base: 523.25, gain: 0.22, decay: 0.35 },
        },
        {
            id: 'felt',
            name: 'Felt',
            description: 'Soft, muted pieces with felt bases. Easy on the ears.',
            bars: [2, 4, 3, 2, 1],
            hit(t, o) {
                const low = o.capture ? 0.8 : 1;
                noise(t, { filter: 'lowpass', freq: vary(700 * low), q: 0.5, gain: 0.5 * o.strength, decay: 0.06, attack: 0.004 });
                tone(t, { freq: vary(150 * low), freqEnd: 110 * low, gain: 0.35 * o.strength, decay: 0.09, attack: 0.004 });
            },
            timbre: { type: 'sine', base: 392, gain: 0.2, decay: 0.5, attack: 0.012 },
            wrong: (p, t) => {
                tone(t, { freq: 220, freqEnd: 180, gain: 0.2, decay: 0.15, attack: 0.01 });
                tone(t + 0.14, { freq: 175, freqEnd: 140, gain: 0.2, decay: 0.22, attack: 0.01 });
            },
        },
        {
            id: 'marble',
            name: 'Marble',
            description: 'Heavy stone pieces with a bright, ringing click.',
            bars: [2, 8, 9, 6, 3],
            hit(t, o) {
                const low = o.capture ? 0.8 : 1;
                noise(t, { filter: 'highpass', freq: 3000, gain: 0.4 * o.strength, decay: 0.015 });
                bell(t, vary(2350 * low, 0.03), { gain: 0.16 * o.strength, decay: 0.14, ratios: [1, 1.58, 2.47] });
                tone(t, { freq: vary(330 * low), gain: 0.2 * o.strength, decay: 0.05 });
            },
            timbre: { bell: true, base: 659.25, gain: 0.2, decay: 0.9, ratios: [1, 2.01, 3.9] },
        },
        {
            id: 'crystal',
            name: 'Crystal',
            description: 'Glass pieces that chime like little bells.',
            bars: [1, 5, 8, 9, 7],
            hit(t, o) {
                const base = o.capture ? 1050 : 1400;
                bell(t, vary(base, 0.03), { gain: 0.17 * o.strength, decay: 0.45 });
                noise(t, { filter: 'highpass', freq: 5000, gain: 0.12 * o.strength, decay: 0.01 });
            },
            timbre: { bell: true, base: 783.99, gain: 0.18, decay: 1.2 },
        },
        {
            id: 'retro',
            name: '8-bit',
            description: 'Square-wave blips straight from a retro console.',
            bars: [6, 2, 6, 2, 6],
            hit(t, o) {
                if (o.capture) {
                    noise(t, { filter: 'lowpass', freq: 3500, freqEnd: 400, gain: 0.35 * o.strength, decay: 0.09 });
                    tone(t, { type: 'square', freq: 330, freqEnd: 70, gain: 0.12 * o.strength, decay: 0.1, sweep: 1 });
                } else {
                    tone(t, { type: 'square', freq: 520, freqEnd: 260, gain: 0.12 * o.strength, decay: 0.06, sweep: 1 });
                }
            },
            timbre: { type: 'square', base: 523.25, gain: 0.1, decay: 0.1, gap: 0.075 },
            wrong: (p, t) => {
                tone(t, { type: 'square', freq: 200, gain: 0.12, decay: 0.09 });
                tone(t + 0.1, { type: 'square', freq: 140, gain: 0.12, decay: 0.16 });
            },
        },
        {
            id: 'scifi',
            name: 'Sci-fi',
            description: 'Synth sweeps and laser zaps for the futuristic boards.',
            bars: [2, 5, 9, 5, 2],
            hit(t, o) {
                if (o.capture) {
                    tone(t, { type: 'sawtooth', freq: 900, freqEnd: 70, gain: 0.16 * o.strength, decay: 0.16, lowpass: 3000, lowpassEnd: 300, sweep: 1 });
                    noise(t, { freq: 1200, freqEnd: 200, q: 2, gain: 0.25 * o.strength, decay: 0.12 });
                } else {
                    tone(t, { freq: vary(1100), freqEnd: 330, gain: 0.26 * o.strength, decay: 0.08, sweep: 1 });
                    tone(t, { type: 'sawtooth', freq: 140, gain: 0.05 * o.strength, decay: 0.07, lowpass: 900 });
                }
            },
            timbre: { type: 'sawtooth', base: 440, gain: 0.1, decay: 0.4, lowpass: 1800 },
        },
    ];

    // Starts a little ahead of "now" so scheduled envelopes never begin in the past.
    function play(packId, event) {
        const pack = PACKS.find((p) => p.id === packId);
        if (!pack || pack.id === 'off' || !volume) return;
        if (!audio()) return;
        const handler = pack[event] || DEFAULT_EVENTS[event];
        if (handler) handler(pack, ctx.currentTime + 0.01);
    }

    // The sounds for a move record from chess.js: the base sound plus a check accent.
    function playMove(packId, record) {
        if (!record) return;
        let event = 'move';
        if (record.promotion) event = 'promote';
        else if (record.flag === 'k' || record.flag === 'q') event = 'castle';
        else if (record.captured) event = 'capture';
        play(packId, event);
        if (/[+#]$/.test(record.san || '')) play(packId, 'check');
    }

    function setVolume(value) {
        volume = Math.max(0, Math.min(1, Number(value) || 0));
        if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
    }

    // Browsers block audio until a user gesture. iOS Safari only accepts some gestures (touchend, click,
    // keydown, not touchstart/pointerdown) and also wants a sound started inside that gesture, so every
    // candidate event tries to unlock with a silent buffer until the context is running.
    const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    function unlock() {
        const context = audio();
        if (!context) return;
        const silent = context.createBufferSource();
        silent.buffer = context.createBuffer(1, 1, 22050);
        silent.connect(context.destination);
        silent.start(0);
        const done = () => UNLOCK_EVENTS.forEach((type) => root.removeEventListener(type, unlock, true));
        if (context.state === 'running') done();
        else context.resume().then(() => context.state === 'running' && done(), () => {});
    }
    UNLOCK_EVENTS.forEach((type) => root.addEventListener(type, unlock, { capture: true, passive: true }));
    // iOS suspends audio when the app goes to the background; resume on return.
    if (root.document) {
        root.document.addEventListener('visibilitychange', () => {
            if (root.document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
        });
    }

    root.ChesslySound = {
        PACKS: PACKS.map(({ id, name, description, bars }) => ({ id, name, description, bars })),
        play,
        playMove,
        setVolume,
        get volume() { return volume; },
    };
})(typeof window !== 'undefined' ? window : globalThis);
