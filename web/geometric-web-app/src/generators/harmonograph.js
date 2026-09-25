/*
 * Harmonograph — a pen driven by damped pendulums:
 *   x = sin(fx·t + px)·e^{−dx·t} + A2·sin(fx2·t + px2)·e^{−dx·t}
 *   y = sin(fy·t + py)·e^{−dy·t} + A2·sin(fy2·t + py2)·e^{−dy·t}
 * plus an optional rotary pendulum that swings the table in a circle. Small
 * integer frequency ratios give closed Lissajous figures; a tiny detune makes
 * each swing land slightly off the last, so the figure slowly turns while it
 * decays into the familiar shaded spirals. One continuous line. The default
 * pairs a slow circular swing with a 3× faster one, which reads as a pinwheel.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // [weight, [a, b]]: simple ratios read as clear figures, busier ones are rarer
    const RATIOS = [[3, [1, 1]], [4, [1, 2]], [4, [2, 3]], [2, [3, 4]], [2, [1, 3]], [1, [3, 5]], [0.5, [2, 5]], [0.5, [4, 5]]];

    // The pen's path, sampled `perCycle` times per turn of the fastest pendulum.
    function trace(p, perCycle, maxN) {
        const ar = p.rotary ? p.ar : 0;
        // with no damping and no detune every swing retraces the first one
        const still = !p.damping && !p.detune && (!ar || !p.rdetune);
        const T = TAU * (still ? 1 : Math.max(1, p.cycles));
        const d = p.damping / T;
        const dx = d * (1 + p.skew), dy = d * (1 - p.skew);
        const fx = p.fx + p.detune, fy = p.fy;
        const px = geo.rad(p.px), py = geo.rad(p.py);
        const a2 = p.a2 || 0;
        const fx2 = p.fx2, fy2 = p.fy2, px2 = geo.rad(p.px2), py2 = geo.rad(p.py2);
        const fr = p.fr + p.rdetune, pr = geo.rad(p.pr);

        let fmax = Math.max(fx, fy);
        if (a2) fmax = Math.max(fmax, fx2, fy2);
        if (ar) fmax = Math.max(fmax, Math.abs(fr));
        const N = Math.min(maxN, Math.ceil((T / TAU) * fmax * perCycle));
        const path = new Array(N + 1);
        for (let i = 0; i <= N; i++) {
            const t = (T * i) / N;
            const ex = Math.exp(-dx * t), ey = Math.exp(-dy * t);
            let x = Math.sin(fx * t + px) * ex;
            let y = Math.sin(fy * t + py) * ey;
            if (a2) {
                x += a2 * Math.sin(fx2 * t + px2) * ex;
                y += a2 * Math.sin(fy2 * t + py2) * ey;
            }
            if (ar) {
                const er = ar * Math.exp(-d * t);
                x += er * Math.sin(fr * t + pr);
                y += er * Math.cos(fr * t + pr);
            }
            path[i] = [x, y];
        }
        return path;
    }

    PG.register({
        id: 'harmonograph',
        name: 'Harmonograph',
        category: 'Curves',
        description: 'Decaying pendulum swings near simple frequency ratios, drawn as one continuous line.',
        fit: true,
        params: [
            { type: 'section', label: 'Pendulums' },
            { id: 'fx', label: 'X frequency', type: 'range', min: 1, max: 8, step: 1, value: 1 },
            { id: 'fy', label: 'Y frequency', type: 'range', min: 1, max: 8, step: 1, value: 1 },
            { id: 'detune', label: 'Detune', type: 'range', min: 0, max: 0.05, step: 0.001, value: 0.008,
                hint: 'Added to the X frequency: makes the figure turn slowly as it decays' },
            { id: 'px', label: 'X phase°', type: 'range', min: 0, max: 360, step: 1, value: 0 },
            { id: 'py', label: 'Y phase°', type: 'range', min: 0, max: 360, step: 1, value: 90 },
            { type: 'section', label: 'Second pendulum' },
            { id: 'a2', label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55 },
            { id: 'fx2', label: 'X frequency', type: 'range', min: 1, max: 8, step: 1, value: 3, show: p => p.a2 > 0 },
            { id: 'fy2', label: 'Y frequency', type: 'range', min: 1, max: 8, step: 1, value: 3, show: p => p.a2 > 0 },
            { id: 'px2', label: 'X phase°', type: 'range', min: 0, max: 360, step: 1, value: 90, show: p => p.a2 > 0 },
            { id: 'py2', label: 'Y phase°', type: 'range', min: 0, max: 360, step: 1, value: 0, show: p => p.a2 > 0 },
            { type: 'section', label: 'Rotary table' },
            { id: 'rotary', label: 'Rotary pendulum', type: 'checkbox', value: false },
            { id: 'ar', label: 'Strength', type: 'range', min: 0, max: 1.5, step: 0.01, value: 0.5, show: p => p.rotary },
            { id: 'fr', label: 'Frequency', type: 'range', min: 1, max: 8, step: 1, value: 2, show: p => p.rotary },
            { id: 'rdetune', label: 'Detune', type: 'range', min: -0.05, max: 0.05, step: 0.001, value: -0.004, show: p => p.rotary },
            { id: 'pr', label: 'Phase°', type: 'range', min: 0, max: 360, step: 1, value: 0, show: p => p.rotary },
            { type: 'section', label: 'Decay' },
            { id: 'cycles', label: 'Duration (cycles)', type: 'range', min: 5, max: 300, step: 1, value: 36 },
            { id: 'damping', label: 'Damping', type: 'range', min: 0, max: 6, step: 0.05, value: 1.6,
                hint: 'How far the swing dies away over the drawing (e-folds)' },
            { id: 'skew', label: 'Damping skew', type: 'range', min: -0.9, max: 0.9, step: 0.01, value: 0, random: [-0.4, 0.4],
                hint: 'Positive: X dies away faster than Y' },
            { type: 'section', label: 'Output' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Splits the line by time into consecutive colour bands' },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng, p) {
            const [a, b] = rng.weighted(RATIOS);
            const swap = rng.chance(0.5);
            const plain = a === b, top = Math.max(a, b);
            const px = rng.int(0, 359);
            const out = {
                fx: swap ? b : a, fy: swap ? a : b, px,
                // equal frequencies in phase (or opposite) only swing along a line
                py: plain ? (px + rng.sign() * rng.int(45, 135) + 360) % 360 : rng.int(0, 359),
                a2: 0, rotary: false,
            };
            if (rng.chance(plain ? 0.7 : 0.4)) {
                // a second pendulum: either circular (equal frequencies, phases
                // 90° apart) or a near-rational pair on the same beat as the first
                out.a2 = +rng.range(0.25, 0.65).toFixed(2);
                const ks = [2, 3].filter(k => top * k <= 8);
                if (!ks.length || rng.chance(0.55)) {
                    out.fx2 = out.fy2 = rng.int(top + 1, Math.min(7, top + 3));
                    out.px2 = rng.int(0, 359); out.py2 = (out.px2 + rng.pick([90, 270])) % 360;
                } else {
                    const k = rng.pick(ks);
                    out.fx2 = out.fx * k; out.fy2 = out.fy * k;
                    out.px2 = rng.int(0, 359); out.py2 = rng.int(0, 359);
                }
            }
            // (a busy ratio with a second pendulum is already complex enough)
            if (rng.chance(plain && !out.a2 ? 1 : out.a2 && top > 2 ? 0 : 0.3)) {
                out.rotary = true;
                out.ar = +rng.range(0.25, 0.8).toFixed(2);
                // on a plain 1:1 swing a same-speed table only makes another ellipse
                out.fr = plain ? a * rng.pick([1, 2, 2, 3]) : rng.pick([out.fx, out.fy, Math.min(out.fx, out.fy)]);
                out.pr = rng.int(0, 359);
            }
            out.damping = +rng.range(1.2, 2.5).toFixed(2);
            // Detune from the total drift it causes: the figure should turn by
            // a fraction of a revolution to about a turn while it decays,
            // however long the drawing is, but short drawings drift less so
            // neighbouring swings stay close enough to shade rather than scribble.
            const drift = rng.range(0.25, 1.6) * Math.PI, rdrift = rng.range(0.25, 1.5) * Math.PI, rsign = rng.sign();
            const setDuration = cycles => {
                const T = TAU * cycles, cap = 0.12 * cycles;
                out.cycles = cycles;
                out.detune = +geo.clamp(Math.min(drift, cap) / T, 0.001, 0.05).toFixed(3);
                out.rdetune = out.rotary ? +(rsign * geo.clamp(Math.min(rdrift, cap) / T, 0.001, 0.05)).toFixed(3) : 0;
            };
            // Measure the ink of a short trial run fitted to A4 (the envelope and
            // drift don't depend on the duration, so ink grows with the cycle
            // count), then pick the duration for roughly 12-26 m of line.
            const C0 = 40;
            setDuration(C0);
            const trial = trace(Object.assign({}, p, out), 24, 1e5), bb = geo.bbox([trial]);
            const perCycle = geo.pathLength(trial) * Math.min(180 / bb.w, 267 / bb.h) / C0;
            setDuration(Math.round(geo.clamp(rng.range(12000, 26000) / perCycle, 15, 250)));
            return out;
        },

        generate(p) {
            const path = trace(p, 128 * p.quality, 150000);
            const pens = Math.max(1, Math.round(p.pens));
            return { layers: geo.splitPath(path, pens).map(piece => [piece]) };
        },
    });
})();
