/*
 * Ridgelines — stacked profiles in the manner of Peter Saville's "Unknown
 * Pleasures" cover (itself Harold Craft's 1970 plot of pulsar CP 1919).
 *
 * Hidden lines are removed with the classic floating-horizon algorithm: lines
 * are processed front (bottom of the page) to back, against a buffer holding
 * the upper envelope of everything drawn so far. A line is visible only where
 * it rises above that envelope; crossings are interpolated so the cuts are
 * crisp, then the envelope is lowered to include the new line. The result is
 * as if every profile were a filled silhouette occluding the ones behind it.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'ridgelines',
        name: 'Ridgelines',
        category: 'Fields',
        description: 'Stacked noise profiles with hidden-line removal: pulsar plots, terrain and swells.',
        fit: false,
        params: [
            { type: 'section', label: 'Signal' },
            { id: 'mode', label: 'Mode', type: 'select', value: 'pulsar', random: ['pulsar', 'pulsar', 'terrain', 'waves'],
                options: [['pulsar', 'Pulsar (Unknown Pleasures)'], ['terrain', 'Terrain'], ['waves', 'Waves']] },
            { id: 'amplitude', label: 'Amplitude (mm)', type: 'range', min: 2, max: 120, step: 0.5, value: 30, random: [12, 50] },
            { id: 'scale', label: 'Feature size (mm)', type: 'range', min: 2, max: 150, step: 0.5, value: 14, random: [6, 40] },
            { id: 'octaves', label: 'Roughness (octaves)', type: 'range', min: 1, max: 6, step: 1, value: 3 },
            { id: 'sharpness', label: 'Peak sharpness', type: 'range', min: 0.5, max: 5, step: 0.05, value: 3.2, random: [1, 4] },
            { id: 'envelope', label: 'Envelope width', type: 'range', min: 0.1, max: 2, step: 0.01, value: 0.5,
                hint: 'Width of the active band, relative to the line length' },
            { id: 'jitter', label: 'Fine jitter', type: 'range', min: 0, max: 0.1, step: 0.005, value: 0.02, random: [0, 0.04],
                hint: 'Tiny high-frequency wobble along every line (fraction of amplitude)' },
            { id: 'coherence', label: 'Line coherence', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, show: p => p.mode !== 'terrain',
                hint: 'How similar neighbouring lines are' },
            { type: 'section', label: 'Layout' },
            { id: 'lines', label: 'Lines', type: 'range', min: 5, max: 250, step: 1, value: 80, random: [40, 120] },
            { id: 'padX', label: 'Side padding (mm)', type: 'range', min: 0, max: 80, step: 0.5, value: 30, random: [10, 45] },
            { id: 'padY', label: 'Top/bottom padding (mm)', type: 'range', min: 0, max: 80, step: 0.5, value: 16, random: [5, 30] },
            { id: 'perspective', label: 'Perspective', type: 'range', min: 0, max: 3, step: 0.05, value: 0,
                hint: 'Lines and amplitudes shrink towards the back' },
            { id: 'res', label: 'X resolution (mm)', type: 'range', min: 0.2, max: 2, step: 0.05, value: 0.4, random: false },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Split pens by', type: 'select', value: 'depth', show: p => p.pens > 1,
                options: [['depth', 'Depth bands'], ['alternate', 'Alternate lines']] },
        ],

        randomize(rng, p) {
            if (p.mode === 'pulsar') {
                const lines = rng.int(50, 100);
                return {
                    lines, amplitude: +((230 / lines) * rng.range(7, 13)).toFixed(1),
                    envelope: +rng.range(0.35, 0.7).toFixed(2), scale: +rng.range(11, 20).toFixed(1),
                    sharpness: +rng.range(2.2, 3.8).toFixed(2), padX: +rng.range(20, 45).toFixed(1),
                    perspective: rng.chance(0.25) ? +rng.range(0.2, 0.8).toFixed(2) : 0,
                    coherence: +rng.range(0.5, 0.85).toFixed(2), octaves: rng.int(3, 4),
                };
            }
            if (p.mode === 'terrain') {
                return {
                    envelope: +rng.range(1.1, 2).toFixed(2), scale: +rng.range(25, 70).toFixed(1),
                    sharpness: +rng.range(1.3, 3).toFixed(2), padX: +rng.range(0, 25).toFixed(1),
                    amplitude: +rng.range(20, 45).toFixed(1), perspective: +rng.range(0.3, 1.2).toFixed(2),
                    octaves: rng.int(3, 6), lines: rng.int(50, 100), jitter: 0,
                };
            }
            return {
                envelope: +rng.range(1, 2).toFixed(2), scale: +rng.range(25, 60).toFixed(1),
                sharpness: +rng.range(1.5, 4).toFixed(2), padX: +rng.range(0, 30).toFixed(1),
                amplitude: +rng.range(12, 30).toFixed(1), perspective: +rng.range(0, 1.2).toFixed(2),
                coherence: +rng.range(0.5, 0.9).toFixed(2), lines: rng.int(50, 100), jitter: 0,
            };
        },

        generate(p, ctx) {
            const { width: W, height: H, noise, rng } = ctx;
            const N = Math.max(2, Math.round(p.lines));
            const x0 = Math.min(p.padX, W / 2 - 1), x1 = W - x0;
            const L = x1 - x0, cx = (x0 + x1) / 2;
            const nx = Math.min(4000, Math.max(2, Math.ceil(L / p.res) + 1));
            const dx = L / (nx - 1);
            const A = p.amplitude;
            const k = p.perspective;

            // Baselines: line 0 is the front (bottom). With perspective the gaps
            // shrink towards the back and so do amplitude and horizontal scale.
            const top = Math.min(p.padY, H / 3);
            const yFront = H - top;
            // leave room for the back row's peaks, but never let the back pass the front
            // (the back row's peaks are shrunk by perspective, so need less room)
            const depthPos = z => (k > 0 ? ((1 - 1 / (1 + k * z)) * (1 + k)) / k : z);
            const depthScale = z => 1 / (1 + k * z);
            const yBack = Math.min(top + A * 0.85 * depthScale(1), yFront - 0.3 * (yFront - top));

            const sc = 1 / p.scale;
            // how far apart neighbouring lines are in noise space
            const lineStep = geo.lerp(0.9, 0.03, p.coherence);
            const envW = p.envelope * L / 2;
            const envPow = p.mode === 'pulsar' ? 2 : 6;
            const envelope = u => Math.exp(-Math.pow(Math.abs(u) / envW, envPow));

            // Waves: a dominant swell plus a couple of cross swells. Each component
            // is peaked on its own, (½ + ½ sin)^sharpness, so crests stay sharp
            // and troughs flat; the phase advancing per line tilts the crests.
            const comps = [];
            if (p.mode === 'waves') {
                const n = rng.int(2, 3);
                for (let c = 0; c < n; c++) {
                    comps.push({
                        f: TAU / (p.scale * (c === 0 ? 1 : rng.range(0.35, 0.8))),
                        ph: rng.range(0, TAU),
                        drift: rng.sign() * rng.range(0.3, 1) * geo.lerp(0.9, 0.06, p.coherence),
                        a: c === 0 ? 1 : rng.range(0.25, 0.5),
                    });
                }
            }
            // Pulsar: each line has its own gain and a slightly wandering centre.
            const lineGain = [], lineShift = [];
            for (let i = 0; i < N; i++) {
                lineGain.push(0.35 + 0.65 * geo.smoothstep(-0.6, 0.6, noise.noise2(i * lineStep * 0.7, 71.3)));
                lineShift.push(noise.noise2(i * lineStep * 0.5, -33.1) * envW * 0.18);
            }

            // Raw heights, normalised afterwards so that typical line maxima reach A
            // (a high percentile rather than the single tallest spike).
            const heights = [], lineMax = [];
            for (let i = 0; i < N; i++) {
                const z = N > 1 ? i / (N - 1) : 0;
                const s = depthScale(z);
                const hz = new Float64Array(nx);
                for (let j = 0; j < nx; j++) {
                    const xs = x0 + j * dx;
                    const xw = cx + (xs - cx) / s; // world x seen through perspective
                    let h;
                    if (p.mode === 'terrain') {
                        const n = noise.fbm2(xw * sc, (z * L * 1.2) * sc, p.octaves);
                        h = Math.pow(geo.clamp(0.5 + 0.62 * n, 0, 1), p.sharpness) * envelope(xs - cx);
                    } else if (p.mode === 'waves') {
                        let v = 0;
                        for (const c of comps) v += c.a * Math.pow(0.5 + 0.5 * Math.sin(xw * c.f + c.ph + i * c.drift), p.sharpness);
                        // slow swell groups plus a little chop
                        const g = 0.6 + 0.4 * noise.noise2(xw * sc * 0.25, i * lineStep * 0.3 + 40);
                        v = v * g + 0.12 * noise.fbm2(xw * sc * 2, i * lineStep * 2, p.octaves);
                        h = Math.max(0, v) * envelope(xs - cx);
                    } else {
                        const n = noise.fbm2(xw * sc, i * lineStep, p.octaves);
                        h = Math.pow(geo.clamp(0.5 + 0.65 * n, 0, 1), p.sharpness) *
                            envelope(xw - cx - lineShift[i]) * lineGain[i];
                    }
                    hz[j] = h;
                }
                heights.push(hz);
                lineMax.push(Math.max(...hz));
            }
            lineMax.sort((a, b) => a - b);
            const hMax = Math.max(1e-9, lineMax[Math.floor((lineMax.length - 1) * 0.9)]);

            const layers = Array.from({ length: Math.max(1, p.pens) }, () => []);
            const horizon = new Float64Array(nx).fill(H + 1e4);
            const ys = new Float64Array(nx);
            for (let i = 0; i < N; i++) {
                const z = N > 1 ? i / (N - 1) : 0;
                const s = depthScale(z);
                const base = yFront - (yFront - yBack) * depthPos(z);
                const hz = heights[i];
                for (let j = 0; j < nx; j++) {
                    let jit = 0;
                    if (p.jitter > 0) jit = p.jitter * noise.noise2((x0 + j * dx) * 0.55, i * 3.7 + 100);
                    ys[j] = base - A * s * (hz[j] / hMax + jit);
                }

                // visible runs: ys < horizon, with interpolated crossings
                const runs = [];
                let run = null;
                let dPrev = ys[0] - horizon[0];
                if (dPrev < 0) run = [[x0, ys[0]]];
                for (let j = 1; j < nx; j++) {
                    const d = ys[j] - horizon[j];
                    const xj = x0 + j * dx;
                    if ((d < 0) !== (dPrev < 0)) {
                        const t = dPrev / (dPrev - d);
                        const pt = [xj - dx + dx * t, ys[j - 1] + (ys[j] - ys[j - 1]) * t];
                        if (run) { run.push(pt); runs.push(run); run = null; }
                        else run = [pt];
                    }
                    if (d < 0) run.push([xj, ys[j]]);
                    dPrev = d;
                }
                if (run) runs.push(run);
                for (let j = 0; j < nx; j++) if (ys[j] < horizon[j]) horizon[j] = ys[j];

                const pen = p.pens <= 1 ? 0 : p.penMode === 'alternate'
                    ? i % p.pens : Math.min(p.pens - 1, Math.floor((i / N) * p.pens));
                for (const r of runs) if (r.length > 1) layers[pen].push(r);
            }
            return { layers };
        },
    });
})();
