/*
 * Superformula (Johan Gielis, 2003), a generalised superellipse:
 *   r(φ) = (|cos(mφ/4)|^n2 + |sin(mφ/4)|^n3)^(−1/n1)
 * A stack of shapes shrinks from the outer set of parameters to the inner
 * set, turning a little at every step. Each shape is normalised by its own
 * largest radius (computed in log space, since the raw formula can overflow).
 * Half-integer or odd m with n2 ≠ n3 need 4π or 8π of φ before the curve
 * closes, so the sweep is chosen per shape. The default is Paul Bourke's
 * six-petal flower (m=6, n=1,7,8) closing into a spiky star.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // One closed superformula curve with max radius 1.
    function shape(m, n1, n2, n3, quality) {
        const k = Math.round(m * 2); // m in half steps
        const sym = Math.abs(n2 - n3) < 1e-9;
        let turns;
        if (k === 0) turns = 1;
        else if (k % 2) turns = sym ? 2 : 4;
        else turns = sym || (k / 2) % 2 === 0 ? 1 : 2;
        n1 = Math.max(0.02, n1);
        const q = m / 4;
        const logR = phi => -Math.log(Math.pow(Math.abs(Math.cos(q * phi)), n2) + Math.pow(Math.abs(Math.sin(q * phi)), n3)) / n1;

        // dense enough for sharp spikes (small n1) and many lobes
        const N = Math.min(24000, Math.ceil(turns * (300 + 90 * Math.abs(m)) * (n1 < 1 ? 2 : 1) * quality));
        const L = new Float64Array(N + 1);
        let top = -Infinity;
        for (let i = 0; i <= N; i++) {
            const v = logR((TAU * turns * i) / N);
            L[i] = isFinite(v) ? v : 50;
            if (L[i] > top) top = L[i];
        }
        const pts = new Array(N + 1);
        for (let i = 0; i <= N; i++) {
            const phi = (TAU * turns * i) / N;
            const r = Math.exp(L[i] - top);
            pts[i] = [r * Math.cos(phi), -r * Math.sin(phi)];
        }
        pts[N] = [pts[0][0], pts[0][1]];
        return pts;
    }

    PG.register({
        id: 'superformula',
        name: 'Superformula',
        category: 'Curves',
        description: "Gielis's superformula: a stack of shapes morphing, shrinking and twisting inward.",
        fit: true,
        params: [
            { type: 'section', label: 'Outer shape' },
            { id: 'm', label: 'Symmetry m', type: 'range', min: 0, max: 24, step: 0.5, value: 6 },
            { id: 'n1', label: 'n1', type: 'range', min: 0.1, max: 40, step: 0.05, value: 1 },
            { id: 'n2', label: 'n2', type: 'range', min: 0.1, max: 40, step: 0.05, value: 7 },
            { id: 'n3', label: 'n3', type: 'range', min: 0.1, max: 40, step: 0.05, value: 8 },
            { type: 'section', label: 'Inner shape' },
            { id: 'm2', label: 'Symmetry m', type: 'range', min: 0, max: 24, step: 0.5, value: 6,
                hint: 'Rounded to half steps along the stack so every shape closes' },
            { id: 'n1b', label: 'n1', type: 'range', min: 0.1, max: 40, step: 0.05, value: 0.3 },
            { id: 'n2b', label: 'n2', type: 'range', min: 0.1, max: 40, step: 0.05, value: 0.4 },
            { id: 'n3b', label: 'n3', type: 'range', min: 0.1, max: 40, step: 0.05, value: 0.4 },
            { type: 'section', label: 'Stack' },
            { id: 'count', label: 'Shapes', type: 'range', min: 1, max: 80, step: 1, value: 36, random: [12, 50] },
            { id: 'inner', label: 'Inner scale', type: 'range', min: 0, max: 0.95, step: 0.01, value: 0.06, random: [0, 0.4] },
            { id: 'twist', label: 'Twist per step°', type: 'range', min: -20, max: 20, step: 0.1, value: 2, random: [-4, 4] },
            { id: 'ease', label: 'Morph ease', type: 'range', min: 0.2, max: 4, step: 0.05, value: 1, random: [0.5, 2],
                hint: '< 1 morphs early (near the outside), > 1 late' },
            { type: 'section', label: 'Output' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Shapes alternate between pens' },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng, p) {
            // Mostly integer symmetry kept across the stack; half-integer m
            // (two overlapping sweeps) only with n2 = n3 so it stays light.
            const half = rng.chance(0.12);
            const m = rng.weighted([[3, rng.int(3, 8)], [1, rng.int(9, 14)]]) + (half ? 0.5 : 0);
            const m2 = rng.chance(0.7) ? m : Math.max(1, m + rng.pick([-2, -1, 1, 2]));
            const set = () => {
                const style = rng.weighted([[3, 'star'], [1, 'round'], [3, 'spiky'], [2, 'petal'], [3, 'bourke']]);
                if (style === 'star') return [rng.range(1, 4), rng.range(4, 12)];
                if (style === 'round') return [rng.range(4, 20), rng.range(2, 8)];
                if (style === 'spiky') return [rng.range(0.2, 0.6), rng.range(0.3, 1.5)];
                if (style === 'bourke') return [rng.range(0.8, 1.5), rng.range(5, 9)];
                return [rng.range(0.6, 2), rng.range(0.3, 1)];
            };
            const [a1, a2] = set(), [b1, b2] = set();
            const asym = () => (half || rng.chance(0.7) ? 1 : rng.range(0.7, 1.4));
            const r2 = v => +v.toFixed(2);
            const out = { m, m2: half ? m : m2, n1: r2(a1), n2: r2(a2), n3: r2(a2 * asym()), n1b: r2(b1), n2b: r2(b2), n3b: r2(b2 * asym()) };
            // keep the ink to roughly 25 m on A4 (a unit radius ends up ≈ 90 mm):
            // measure a few shapes along the stack
            let avg = 0;
            for (let i = 0; i < 5; i++) {
                const f = i / 4, g = Math.pow(f, p.ease), L = (a, b) => geo.lerp(a, b, g);
                const mm = Math.round(L(out.m, out.m2) * 2) / 2;
                avg += geo.pathLength(shape(mm, L(out.n1, out.n1b), L(out.n2, out.n2b), L(out.n3, out.n3b), 0.5)) *
                    geo.lerp(1, p.inner, f) * 90 / 5;
            }
            out.count = Math.max(6, Math.min(p.count, Math.floor(25000 / avg)));
            return out;
        },

        generate(p) {
            const K = Math.max(1, Math.round(p.count));
            const pens = Math.max(1, Math.round(p.pens));
            const layers = Array.from({ length: pens }, () => []);
            for (let i = 0; i < K; i++) {
                const f = K > 1 ? i / (K - 1) : 0;
                const g = Math.pow(f, p.ease);
                const m = Math.round(geo.lerp(p.m, p.m2, g) * 2) / 2;
                const pts = shape(m, geo.lerp(p.n1, p.n1b, g), geo.lerp(p.n2, p.n2b, g), geo.lerp(p.n3, p.n3b, g), p.quality);
                const s = geo.lerp(1, p.inner, f);
                if (s <= 1e-4) continue;
                const a = geo.rad(p.twist * i), c = Math.cos(a) * s, sn = Math.sin(a) * s;
                layers[i % pens].push(pts.map(q => [q[0] * c - q[1] * sn, q[0] * sn + q[1] * c]));
            }
            return { layers };
        },
    });
})();
