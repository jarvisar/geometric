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

    const RATIOS = [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [2, 5], [1, 3], [4, 5], [3, 7], [5, 6]];

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
            { id: 'damping', label: 'Damping', type: 'range', min: 0, max: 6, step: 0.05, value: 1.2,
                hint: 'How far the swing dies away over the drawing (e-folds)' },
            { id: 'skew', label: 'Damping skew', type: 'range', min: -0.9, max: 0.9, step: 0.01, value: 0, random: [-0.4, 0.4],
                hint: 'Positive: X dies away faster than Y' },
            { type: 'section', label: 'Output' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Splits the line by time into consecutive colour bands' },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng) {
            const [a, b] = rng.pick(RATIOS);
            const swap = rng.chance(0.5);
            const out = {
                fx: swap ? b : a, fy: swap ? a : b,
                detune: +rng.range(0.002, 0.02).toFixed(3),
                px: rng.int(0, 359), py: rng.int(0, 359),
                a2: 0, rotary: false,
            };
            const plain = a === b;
            if (rng.chance(plain ? 0.7 : 0.4)) {
                // a faster second pendulum: either circular (equal frequencies,
                // phases 90° apart) or another near-rational pair
                out.a2 = +rng.range(0.25, 0.7).toFixed(2);
                if (rng.chance(0.5)) {
                    out.fx2 = out.fy2 = rng.int(Math.max(a, b) + 1, Math.max(a, b) + 4);
                    out.px2 = rng.int(0, 359); out.py2 = (out.px2 + rng.pick([90, 270])) % 360;
                } else {
                    const [c, d] = rng.pick(RATIOS);
                    out.fx2 = rng.chance(0.5) ? c : d; out.fy2 = out.fx2 === c ? d : c;
                    out.px2 = rng.int(0, 359); out.py2 = rng.int(0, 359);
                }
            }
            if (rng.chance(plain && !out.a2 ? 1 : 0.35)) {
                out.rotary = true;
                out.ar = +rng.range(0.25, 0.9).toFixed(2);
                out.fr = rng.pick([out.fx, out.fy, Math.min(out.fx, out.fy)]);
                out.rdetune = +(rng.sign() * rng.range(0.002, 0.012)).toFixed(3);
                out.pr = rng.int(0, 359);
            }
            // choose the duration for roughly 12-26 m of ink on A4
            out.damping = +rng.range(0.8, 2).toFixed(2);
            let v2 = (out.fx * out.fx + out.fy * out.fy) / 2, ext = 1;
            if (out.a2) { v2 += out.a2 * out.a2 * (out.fx2 * out.fx2 + out.fy2 * out.fy2) / 2; ext += out.a2; }
            if (out.rotary) { v2 += out.ar * out.ar * out.fr * out.fr; ext += out.ar; }
            const perCycle = TAU * Math.sqrt(v2) * 0.9 * (95 / ext) * (1 - Math.exp(-out.damping)) / out.damping;
            out.cycles = Math.round(geo.clamp(rng.range(12000, 26000) / perCycle, 15, 250));
            return out;
        },

        generate(p) {
            const T = TAU * Math.max(1, p.cycles);
            const d = p.damping / T;
            const dx = d * (1 + p.skew), dy = d * (1 - p.skew);
            const fx = p.fx + p.detune, fy = p.fy;
            const px = geo.rad(p.px), py = geo.rad(p.py);
            const a2 = p.a2 || 0;
            const fx2 = p.fx2, fy2 = p.fy2, px2 = geo.rad(p.px2), py2 = geo.rad(p.py2);
            const ar = p.rotary ? p.ar : 0;
            const fr = p.fr + p.rdetune, pr = geo.rad(p.pr);

            let fmax = Math.max(fx, fy);
            if (a2) fmax = Math.max(fmax, fx2, fy2);
            if (ar) fmax = Math.max(fmax, Math.abs(fr));
            const N = Math.min(150000, Math.ceil(p.cycles * fmax * 48 * p.quality));
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
            const pens = Math.max(1, Math.round(p.pens));
            return { layers: geo.splitPath(path, pens).map(piece => [piece]) };
        },
    });
})();
