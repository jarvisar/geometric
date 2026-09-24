/*
 * Chladni figures — the nodal lines of a vibrating plate, where sand collects.
 *
 * Rectangular plate (free-edge approximation, as in Chladni's own tables):
 *   f(x, y) = cos(nπx)·cos(mπy) + mix·cos(mπx)·cos(nπy),   x, y ∈ [0, 1]
 * mix = ±1 gives the classic symmetric figures; other values morph between them.
 *
 * Circular plate (clamped membrane): f(r, θ) = J_n(k·r)·cos(nθ) with k the
 * m-th zero of the Bessel function J_n, so the rim is itself a nodal line;
 * mix adds the "swapped" mode J_m(k'·r)·cos(mθ). J_n comes from Bessel's
 * integral (1/π)∫₀^π cos(nτ − x·sin τ) dτ, evaluated by the trapezoid rule
 * (exponentially accurate for periodic integrands) into a lookup table.
 *
 * Sand bands are extra contours at ±δ, ±2δ… hugging the nodal line: tight
 * where the plate slopes steeply, opening up around the saddle points.
 */
(function () {
    'use strict';
    const { geo } = PG;

    PG.register({
        id: 'chladni',
        name: 'Chladni',
        category: 'Fields',
        description: 'Nodal lines of vibrating square and circular plates, with sand bands hugging them.',
        fit: false,
        params: [
            { type: 'section', label: 'Plate' },
            { id: 'plate', label: 'Plate', type: 'select', value: 'rect', random: ['rect', 'rect', 'circle'],
                options: [['rect', 'Rectangular (fills page)'], ['circle', 'Circular']] },
            { id: 'n', label: 'n', type: 'range', min: 0, max: 20, step: 1, value: 7,
                hint: 'Rectangle: waves across. Circle: nodal diameters.' },
            { id: 'm', label: 'm', type: 'range', min: 1, max: 20, step: 1, value: 3,
                hint: 'Rectangle: waves down. Circle: nodal circles (including the rim).' },
            { id: 'mix', label: 'Mix', type: 'range', min: -1, max: 1, step: 0.01, value: -1,
                hint: 'Weight of the swapped (m, n) mode; ±1 are the classic figures' },
            { type: 'section', label: 'Sand' },
            { id: 'bands', label: 'Bands', type: 'range', min: 0, max: 12, step: 1, value: 4, random: [2, 6] },
            { id: 'spacing', label: 'Band spacing (mm)', type: 'range', min: 0.6, max: 6, step: 0.05, value: 0.9, random: [0.8, 1.6], show: p => p.bands > 0,
                hint: 'Gap between the nodal line and the first band, along typical stretches of the node' },
            { id: 'spread', label: 'Band spread', type: 'range', min: 1, max: 2.5, step: 0.01, value: 1.3, random: [1, 1.8], show: p => p.bands > 0,
                hint: 'Bands k sit at δ·k^spread: >1 thins the sand away from the node' },
            { id: 'cell', label: 'Grid resolution (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.6, random: false },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 3, step: 1, value: 2, random: false,
                hint: '2: sand bands on pen 2. 3: bands on the + and − sides on pens 2 and 3' },
        ],

        randomize(rng, p) {
            let n, m, mix, cellSize;
            if (p.plate === 'circle') {
                n = rng.int(1, 9); m = rng.int(2, 6);
                mix = rng.chance(0.3) ? 0 : +(rng.sign() * rng.range(0.25, 1)).toFixed(2);
                cellSize = 180 / Math.max(n + 1, 2 * m);
            } else {
                do { n = rng.int(2, 13); m = rng.int(1, 11); } while (n === m || n + m < 6 || n + m > 19);
                mix = rng.weighted([[3, 1], [3, -1], [2, +(rng.sign() * rng.range(0.3, 0.95)).toFixed(2)]]);
                cellSize = 180 / Math.max(n, m);
            }
            // keep the sand within ~30% of a nodal cell (on A4) so domains stay open
            const spacing = +rng.range(0.8, 1.3).toFixed(2), spread = +rng.range(1, 1.4).toFixed(2);
            const bands = geo.clamp(Math.floor(Math.pow((0.3 * cellSize) / spacing, 1 / spread)), 1, 6);
            return { n, m, mix, spacing, spread, bands };
        },

        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const n = Math.round(p.n), m = Math.round(p.m);
            const circle = p.plate === 'circle';
            // with n = m the swapped mode is the same mode, and mix = âˆ’1 would cancel everything
            const mix = n === m ? 0 : p.mix;
            let fn, x0 = 0, y0 = 0, w = W, h = H, R = 0, cx = W / 2, cy = H / 2;

            if (circle) {
                // inscribed radius of the visible area (the canvas grows when rotated)
                R = Math.max(1, ctx.shape.dist(cx, cy)) || Math.min(W, H) / 2;
                const k1 = besselZero(n, Math.max(1, m)), n2 = Math.max(1, m), k2 = besselZero(n2, Math.max(1, n));
                const kMax = Math.max(k1, k2) * 1.02;
                const J1 = besselTable(n, kMax), J2 = mix ? besselTable(n2, kMax) : null;
                fn = (x, y) => {
                    const dx = (x - cx) / R, dy = (y - cy) / R;
                    const r = Math.min(1.01, Math.hypot(dx, dy)), th = Math.atan2(dy, dx);
                    let v = J1(k1 * r) * Math.cos(n * th);
                    if (J2) v += mix * J2(k2 * r) * Math.cos(n2 * th);
                    return v;
                };
                x0 = cx - R; y0 = cy - R; w = h = 2 * R;
            } else {
                const PI = Math.PI;
                fn = (x, y) => {
                    const u = x / W, v = y / H;
                    return Math.cos(n * PI * u) * Math.cos(m * PI * v) + mix * Math.cos(m * PI * u) * Math.cos(n * PI * v);
                };
            }

            // Cap the grid at ~300k samples.
            const cell = Math.max(p.cell, Math.sqrt((w * h) / 300000));
            const field = PG.sampleField(fn, x0, y0, w, h, cell);
            const amp = Math.max(Math.abs(field.min), Math.abs(field.max)) || 1;
            const vals = field.values;
            for (let i = 0; i < vals.length; i++) vals[i] /= amp;
            field.min /= amp; field.max /= amp;

            const clip = circle ? paths => PG.clipPaths(paths, PG.shapes.circle(cx, cy, R)) : paths => paths;
            let nodal = clip(PG.isolines(field, 0));
            if (circle) {
                // The rim is itself a zero of the field. Trace it once as a clean circle:
                // drop the traced copy and run the nodal lines that reach it out onto it.
                const inner = R - 0.5 * cell;
                nodal = PG.clipPaths(nodal, PG.shapes.circle(cx, cy, inner)).filter(q => geo.pathLength(q) > cell);
                const toRim = q => {
                    const d = Math.hypot(q[0] - cx, q[1] - cy);
                    return d > inner - 1e-6 ? [cx + ((q[0] - cx) * R) / d, cy + ((q[1] - cy) * R) / d] : null;
                };
                for (const q of nodal) {
                    const a = toRim(q[0]), b = toRim(q[q.length - 1]);
                    if (a) q.unshift(a);
                    if (b) q.push(b);
                }
                nodal.push(geo.circle(cx, cy, R));
            }

            // Bands are level sets of S = f / sqrt(|∇f|² + ε²), roughly the signed
            // distance (mm) to the nodal line. Plain levels of f would crowd
            // weak nodal domains; S keeps every band hugging its node, while the
            // ε term lets the bands open up around saddles where ∇f vanishes.
            const plus = [], minus = [];
            if (p.bands > 0) {
                const dist = distanceField(field, 0.35 * nodalSlope(field));
                for (let k = 1; k <= p.bands; k++) {
                    const lev = p.spacing * Math.pow(k, p.spread);
                    plus.push(...clip(PG.isolines(dist, lev)));
                    minus.push(...clip(PG.isolines(dist, -lev)));
                }
            }

            if (p.pens >= 3) return { layers: [nodal, plus, minus] };
            if (p.pens === 2) return { layers: [nodal, plus.concat(minus)] };
            return nodal.concat(plus, minus);
        },
    });

    // J_n(x) by the trapezoid rule on Bessel's integral.
    function besselJ(n, x) {
        const M = Math.max(64, Math.ceil(x + n) + 32), hstep = Math.PI / M;
        let s = 0.5 * (1 + Math.cos(n * Math.PI)); // tau = 0 and tau = pi (sin = 0)
        for (let k = 1; k < M; k++) {
            const t = k * hstep;
            s += Math.cos(n * t - x * Math.sin(t));
        }
        return s / M;
    }

    // Lookup table of J_n on [0, xMax] with linear interpolation.
    function besselTable(n, xMax) {
        const step = 0.004, N = Math.ceil(xMax / step) + 2;
        const tab = new Float64Array(N);
        for (let i = 0; i < N; i++) tab[i] = besselJ(n, i * step);
        return x => {
            const f = Math.min(N - 1.001, Math.max(0, x / step)), i = Math.floor(f), t = f - i;
            return tab[i] + (tab[i + 1] - tab[i]) * t;
        };
    }

    // m-th positive zero of J_n: scan for sign changes, refine by bisection.
    // j_{n,1} > n, and below that J_n is tiny enough for rounding noise to
    // fake a sign change, so the scan starts at x = n.
    function besselZero(n, m) {
        let found = 0, x = Math.max(0.05, n), prev = besselJ(n, x);
        const dx = 0.1;
        for (let it = 0; it < 20000; it++) {
            const x1 = x + dx, v = besselJ(n, x1);
            if ((prev < 0) !== (v < 0)) {
                if (++found === m) {
                    let a = x, b = x1, fa = prev;
                    for (let k = 0; k < 50; k++) {
                        const c = (a + b) / 2, fc = besselJ(n, c);
                        if ((fa < 0) === (fc < 0)) { a = c; fa = fc; } else b = c;
                    }
                    return (a + b) / 2;
                }
            }
            x = x1; prev = v;
        }
        return x;
    }

    // f / sqrt(|∇f|² + eps²) on the same grid (central differences).
    function distanceField(field, eps) {
        const { values: v, nx, ny, dx, dy } = field;
        const out = new Float64Array(nx * ny);
        let min = Infinity, max = -Infinity;
        const e2 = eps * eps;
        for (let j = 0; j < ny; j++) {
            const jm = Math.max(0, j - 1), jp = Math.min(ny - 1, j + 1);
            for (let i = 0; i < nx; i++) {
                const im = Math.max(0, i - 1), ip = Math.min(nx - 1, i + 1);
                const gx = (v[j * nx + ip] - v[j * nx + im]) / ((ip - im) * dx);
                const gy = (v[jp * nx + i] - v[jm * nx + i]) / ((jp - jm) * dy);
                const s = v[j * nx + i] / Math.sqrt(gx * gx + gy * gy + e2);
                out[j * nx + i] = s;
                if (s < min) min = s;
                if (s > max) max = s;
            }
        }
        return Object.assign({}, field, { values: out, min, max });
    }

    // Median |∇f| (per mm) at grid points close to the nodal lines.
    function nodalSlope(field) {
        const { values: v, nx, ny, dx, dy } = field;
        const near = [], all = [];
        for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
                const gx = (v[j * nx + i + 1] - v[j * nx + i - 1]) / (2 * dx);
                const gy = (v[(j + 1) * nx + i] - v[(j - 1) * nx + i]) / (2 * dy);
                const g = Math.hypot(gx, gy);
                if (Math.abs(v[j * nx + i]) < 0.6 * g * Math.max(dx, dy)) near.push(g);
                else if ((i & 7) === 0 && (j & 7) === 0) all.push(g);
            }
        }
        const pick = near.length > 20 ? near : all;
        if (!pick.length) return 0.01;
        pick.sort((a, b) => a - b);
        return pick[Math.floor(pick.length / 2)] || 0.01;
    }
})();
