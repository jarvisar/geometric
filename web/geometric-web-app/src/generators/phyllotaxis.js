/*
 * Phyllotaxis — Vogel's sunflower model (1979): seed k sits at angle k·α and
 * radius √k, with α the golden angle 137.508°. Seeds can be drawn as dots or
 * joined into parastichies, the spirals the eye picks out: seed k joined to
 * seed k + F for a Fibonacci number F. In "zones" mode every Fibonacci family
 * is drawn only where its links are among the shortest, so the spiral count
 * steps up (8/13, 13/21, 21/34 …) towards the rim as in a real seed head.
 * Families alternate in winding direction, which makes a natural pen split.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const GOLDEN = 180 * (3 - Math.sqrt(5)); // 137.5077…°
    const FIB = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

    // Uniform Catmull–Rom through the points (open), `sub` samples per span.
    function smooth(pts, sub) {
        if (pts.length < 3) return pts;
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
            for (let s = 1; s <= sub; s++) {
                const t = s / sub, t2 = t * t, t3 = t2 * t;
                const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
                out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
            }
        }
        return out;
    }

    PG.register({
        id: 'phyllotaxis',
        name: 'Phyllotaxis',
        category: 'Curves',
        description: 'Sunflower seed spirals: golden-angle dots and Fibonacci parastichies.',
        fit: true,
        params: [
            { type: 'section', label: 'Seeds' },
            { id: 'count', label: 'Seeds', type: 'range', min: 100, max: 3000, step: 10, value: 1200, random: [300, 1600] },
            { id: 'angle', label: 'Angle offset°', type: 'range', min: -2, max: 2, step: 0.001, value: 0, random: false,
                hint: 'Added to the golden angle (137.508°); tiny changes straighten the spirals into spokes' },
            { id: 'spread', label: 'Radial exponent', type: 'range', min: 0.35, max: 0.8, step: 0.01, value: 0.5, random: [0.45, 0.65],
                hint: '0.5 packs seeds evenly (Vogel); larger values open up the rim' },
            { id: 'style', label: 'Draw', type: 'select', value: 'spirals', random: ['dots', 'spirals', 'spirals', 'both'],
                options: [['dots', 'Dots'], ['spirals', 'Spirals'], ['both', 'Dots and spirals']] },
            { type: 'section', label: 'Dots' },
            { id: 'shape', label: 'Shape', type: 'select', value: 'circle', show: p => p.style !== 'spirals', random: ['circle', 'circle', 'polygon', 'aligned'],
                options: [['circle', 'Circle'], ['polygon', 'Polygon'], ['aligned', 'Polygon facing out']] },
            { id: 'sides', label: 'Sides', type: 'range', min: 3, max: 8, step: 1, value: 4, show: p => p.style !== 'spirals' && p.shape !== 'circle' },
            { id: 'size', label: 'Dot size', type: 'range', min: 0.05, max: 1.2, step: 0.01, value: 0.7, show: p => p.style !== 'spirals', random: [0.35, 0.9],
                hint: 'Relative to the gap between neighbouring seeds' },
            { id: 'growth', label: 'Growth', type: 'range', min: -1, max: 2, step: 0.05, value: 0.3, show: p => p.style !== 'spirals', random: [0, 1],
                hint: 'Dots grow towards the rim as (k/N)^growth' },
            { id: 'rings', label: 'Rings per dot', type: 'range', min: 1, max: 4, step: 1, value: 1, show: p => p.style !== 'spirals', random: [1, 3] },
            { type: 'section', label: 'Spirals' },
            { id: 'para', label: 'Parastichies', type: 'select', value: 'zones', show: p => p.style !== 'dots', random: ['zones', 'zones', 'pair'],
                options: [['zones', 'Fibonacci zones'], ['pair', 'Fixed pair']] },
            { id: 'pair', label: 'Pair', type: 'select', value: '13', show: p => p.style !== 'dots' && p.para === 'pair',
                options: [['5', '5 / 8'], ['8', '8 / 13'], ['13', '13 / 21'], ['21', '21 / 34'], ['34', '34 / 55'], ['55', '55 / 89']] },
            { id: 'reach', label: 'Link reach', type: 'range', min: 1, max: 3, step: 0.05, value: 1.6, show: p => p.style !== 'dots' && p.para === 'zones', random: false,
                hint: 'Longest link drawn, relative to the local seed gap' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 3, step: 1, value: 1, random: false,
                hint: '2: dots and spirals apart (or the two spiral directions); 3: dots and each direction' },
        ],

        randomize(rng, p) {
            // the pair that reads best is the one whose links are shortest near the rim
            const root = Math.sqrt(p.count) * rng.range(0.6, 1);
            let i = 0;
            while (i < FIB.length - 2 && FIB[i + 1] < root) i++;
            return { pair: String(FIB[Math.max(3, i)]) };
        },

        generate(p) {
            const N = Math.max(2, Math.round(p.count));
            const alpha = geo.rad(GOLDEN + p.angle);
            const e = p.spread;
            const X = new Float64Array(N), Y = new Float64Array(N), A = new Float64Array(N);
            for (let k = 0; k < N; k++) {
                const r = Math.pow(k + 0.5, e), a = k * alpha;
                X[k] = r * Math.cos(a); Y[k] = r * Math.sin(a); A[k] = a;
            }
            // nearest-neighbour gap for hexagonal packing at seed k
            const gap = k => Math.sqrt((4 * Math.PI * e * Math.pow(k + 0.5, 2 * e - 1)) / Math.sqrt(3));

            const pens = Math.max(1, Math.round(p.pens));
            const layers = Array.from({ length: pens }, () => []);
            const dots = p.style !== 'spirals', spirals = p.style !== 'dots';
            const dotLayer = 0;
            const dirLayer = d => Math.min(pens - 1, (dots && pens > 1 ? 1 : 0) + (pens >= (dots ? 3 : 2) ? d : 0));

            if (dots) {
                const sides = p.shape === 'circle' ? 0 : Math.max(3, Math.round(p.sides));
                const R = Math.max(1, Math.round(p.rings));
                for (let k = 0; k < N; k++) {
                    const s = 0.5 * p.size * gap(k) * Math.pow(Math.max((k + 1) / N, 0.15), p.growth);
                    for (let j = 0; j < R; j++) {
                        const r = (s * (R - j)) / R;
                        if (r <= 1e-6) continue;
                        if (!sides) layers[dotLayer].push(geo.circle(X[k], Y[k], r, 20));
                        else layers[dotLayer].push(geo.close(geo.ngon(X[k], Y[k], r, sides, p.shape === 'aligned' ? A[k] : 0)));
                    }
                }
            }

            if (spirals) {
                const fams = [];
                if (p.para === 'pair') {
                    const i = Math.max(0, FIB.indexOf(+p.pair));
                    fams.push([FIB[i], i], [FIB[i + 1], i + 1]);
                } else {
                    FIB.forEach((F, i) => { if (F >= 3 && F < N) fams.push([F, i]); });
                }
                // In zones mode a link k -> k+F is kept only when F is one of the two
                // shortest Fibonacci links leaving seed k: two crossing families
                // everywhere, handing over to the next pair further out.
                let best = null;
                if (p.para !== 'pair') {
                    best = new Int32Array(N * 2).fill(-1);
                    for (let k = 0; k < N; k++) {
                        let d1 = Infinity, d2 = Infinity, f1 = -1, f2 = -1;
                        for (const [F] of fams) {
                            if (k + F >= N) break;
                            const d = Math.hypot(X[k + F] - X[k], Y[k + F] - Y[k]);
                            if (d < d1) { d2 = d1; f2 = f1; d1 = d; f1 = F; } else if (d < d2) { d2 = d; f2 = F; }
                        }
                        best[2 * k] = f1; best[2 * k + 1] = f2;
                    }
                }
                const limit = p.para === 'pair' ? 3 : p.reach;
                for (const [F, fi] of fams) {
                    const layer = layers[dirLayer(fi % 2)];
                    for (let s = 0; s < F; s++) {
                        let run = null;
                        for (let k = s; k + F < N; k += F) {
                            const d = Math.hypot(X[k + F] - X[k], Y[k + F] - Y[k]);
                            const ok = d <= limit * gap(k + F / 2) && (!best || best[2 * k] === F || best[2 * k + 1] === F);
                            if (!ok) {
                                if (run && run.length > 1) layer.push(smooth(run, 4));
                                run = null;
                                continue;
                            }
                            if (!run) run = [[X[k], Y[k]]];
                            run.push([X[k + F], Y[k + F]]);
                        }
                        if (run && run.length > 1) layer.push(smooth(run, 4));
                    }
                }
            }
            return { layers };
        },
    });
})();
