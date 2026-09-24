/*
 * Warp — Vasarely-style op-art bulges ("Vega" series). A regular structure
 * (checkerboard hatching, grid, stripes or nested squares) is drawn flat,
 * densely resampled, and pushed through one to three radial lens warps:
 *
 *   p' = c + (p − c)·(1 + s·(1 − (d/R)²)³)     for d = |p − c| < R
 *
 * The centre is magnified by 1 + s and the rim compressed, which the eye reads
 * as a sphere swelling out of the page (s < 0 pinches a dimple instead). The
 * profile joins the flat surround smoothly and stays monotonic for
 * −1 < s < 1.5, so lines never fold or cross.
 */
(function () {
    'use strict';
    const { geo } = PG;

    PG.register({
        id: 'warp',
        name: 'Op-Art Warp',
        category: 'Fields',
        description: 'Vasarely bulges: hatched checkerboards, grids and stripes swelling out of the page.',
        fit: false,
        params: [
            { type: 'section', label: 'Structure' },
            { id: 'style', label: 'Style', type: 'select', value: 'checker', random: ['checker', 'checker', 'grid', 'lines', 'rings'],
                options: [['checker', 'Hatched checkerboard'], ['grid', 'Grid'], ['lines', 'Stripes'], ['rings', 'Nested squares']] },
            { id: 'cells', label: 'Cells across', type: 'range', min: 4, max: 60, step: 1, value: 13, random: [9, 18],
                show: p => p.style === 'checker' || p.style === 'grid' },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.7, max: 8, step: 0.05, value: 1.5, random: [1.3, 2.4],
                show: p => p.style !== 'grid', hint: 'Hatch / stripe spacing before warping' },
            { id: 'weave', label: 'Hatch every cell', type: 'checkbox', value: true, random: 0.6,
                show: p => p.style === 'checker', hint: 'Fill the other cells with perpendicular hatching instead of leaving them blank' },
            { type: 'section', label: 'Bulge' },
            { id: 'bulges', label: 'Bulges', type: 'range', min: 1, max: 3, step: 1, value: 1,
                hint: 'The first sits at the centre; extra ones are placed at random' },
            { id: 'strength', label: 'Strength', type: 'range', min: -0.9, max: 1.4, step: 0.01, value: 0.85, random: [-0.5, 1.1],
                hint: 'Centre magnification − 1; negative pinches' },
            { id: 'radius', label: 'Radius (% of short side)', type: 'range', min: 10, max: 100, step: 1, value: 44, random: [28, 55] },
            { id: 'cx', label: 'Centre x (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, random: false },
            { id: 'cy', label: 'Centre y (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, random: false },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 2, step: 1, value: 1, random: false,
                hint: 'Checker/grid: split by direction. Stripes/squares: alternate lines' },
        ],

        randomize(rng, p) {
            const out = {};
            if (p.style === 'grid') out.cells = rng.int(24, 45);
            if (p.style === 'rings') out.spacing = +rng.range(1.6, 3).toFixed(2);
            // blank-cell checkers need dense hatching to read as black squares
            if (p.style === 'checker' && !p.weave) out.spacing = +rng.range(1.1, 1.6).toFixed(2);
            out.radius = p.bulges > 1 ? rng.int(24, 40) : rng.int(34, 55);
            // mostly swell, sometimes pinch
            out.strength = +(rng.chance(0.8) ? rng.range(0.5, 1.1) : rng.range(-0.55, -0.3)).toFixed(2);
            return out;
        },

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            // short side of the visible area (the canvas grows when rotated)
            const short = 2 * Math.max(1, ctx.shape.dist(W / 2, H / 2)) || Math.min(W, H);
            const s = geo.clamp(p.strength, -0.95, 1.45);

            // Bulges: the first at (cx, cy), extras at random, not too close.
            const bulges = [{ x: (W * p.cx) / 100, y: (H * p.cy) / 100, r: (short * p.radius) / 100, s }];
            for (let b = 1; b < p.bulges; b++) {
                let best = null;
                for (let t = 0; t < 30; t++) {
                    const c = { x: rng.range(0.1, 0.9) * W, y: rng.range(0.1, 0.9) * H, r: bulges[0].r * rng.range(0.55, 0.9), s: s * rng.range(0.6, 1) };
                    const gap = Math.min(...bulges.map(o => Math.hypot(o.x - c.x, o.y - c.y) - 0.8 * (o.r + c.r)));
                    if (!best || gap > best.gap) best = { c, gap };
                    if (gap > 0) break;
                }
                bulges.push(best.c);
            }
            const warp = pt => {
                let x = pt[0], y = pt[1];
                for (const b of bulges) {
                    const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy, r2 = b.r * b.r;
                    if (d2 >= r2) continue;
                    const q = 1 - d2 / r2, f = 1 + b.s * q * q * q;
                    x = b.x + dx * f; y = b.y + dy * f;
                }
                return [x, y];
            };

            // Unwarped structure over the page plus a margin (warps move content
            // within each lens, so content just outside the page can slide in).
            const m = Math.max(...bulges.map(b => b.r)) * 0.3 + 2;
            const X0 = -m, Y0 = -m, X1 = W + m, Y1 = H + m;
            const A = [], B = []; // pen 1 / pen 2
            const ox = W / 2, oy = H / 2; // structure is centred on the page

            if (p.style === 'checker' || p.style === 'grid') {
                const cell = W / Math.max(1, p.cells);
                const i0 = Math.floor((X0 - ox) / cell), i1 = Math.ceil((X1 - ox) / cell);
                const j0 = Math.floor((Y0 - oy) / cell), j1 = Math.ceil((Y1 - oy) / cell);
                if (p.style === 'grid') {
                    for (let i = i0; i <= i1; i++) A.push([[ox + i * cell, Y0], [ox + i * cell, Y1]]);
                    for (let j = j0; j <= j1; j++) B.push([[X0, oy + j * cell], [X1, oy + j * cell]]);
                } else {
                    // an integer number of hatch lines per cell, evenly centred
                    const n = Math.max(1, Math.round(cell / p.spacing)), hs = cell / n;
                    for (let j = j0; j < j1; j++) {
                        for (let i = i0; i < i1; i++) {
                            const x = ox + i * cell, y = oy + j * cell;
                            const even = ((i + j) & 1) === 0;
                            if (!even && !p.weave) continue;
                            for (let k = 0; k < n; k++) {
                                const t = (k + 0.5) * hs;
                                // alternate stroke direction so the pen zig-zags
                                if (even) A.push(k & 1 ? [[x + cell, y + t], [x, y + t]] : [[x, y + t], [x + cell, y + t]]);
                                else B.push(k & 1 ? [[x + t, y + cell], [x + t, y]] : [[x + t, y], [x + t, y + cell]]);
                            }
                        }
                    }
                }
            } else if (p.style === 'lines') {
                const sp = p.spacing;
                let k = 0;
                for (let y = oy + Math.ceil((Y0 - oy) / sp) * sp; y <= Y1; y += sp, k++) {
                    const seg = k & 1 ? [[X1, y], [X0, y]] : [[X0, y], [X1, y]];
                    (k % 2 ? B : A).push(seg);
                }
            } else {
                // nested squares around the first bulge
                const cx = bulges[0].x, cy = bulges[0].y, sp = p.spacing;
                const reach = Math.max(cx - X0, X1 - cx, cy - Y0, Y1 - cy);
                for (let k = 1; k * sp <= reach; k++) {
                    const h = k * sp;
                    (k % 2 ? B : A).push([[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]]);
                }
            }

            // Resample only where a lens can bend the line; straight runs elsewhere stay two-point.
            const inLens = (a, b) => bulges.some(L => segDist2(L.x, L.y, a, b) < L.r * L.r);
            const bend = paths => paths.map(path => {
                const out = [path[0]];
                for (let i = 1; i < path.length; i++) {
                    const a = path[i - 1], b = path[i];
                    if (inLens(a, b)) out.push(...geo.resample([a, b], 0.5).slice(1));
                    else out.push(b);
                }
                return out.map(warp);
            });
            const L1 = bend(A), L2 = bend(B);
            return p.pens > 1 ? { layers: [L1, L2] } : L1.concat(L2);
        },
    });

    // Squared distance from (px, py) to segment ab.
    function segDist2(px, py, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        let t = L2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = a[0] + dx * t - px, ey = a[1] + dy * t - py;
        return ex * ex + ey * ey;
    }
})();
