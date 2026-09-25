/*
 * Celtic knotwork on a grid of dots (the "breaks" method described by
 * George Bain and formalised by Peter Cromwell). In half-dot units the dots
 * sit at even (x, y); crossing sites sit at the midpoints of the grid edges,
 * the points with x + y odd, and strands run diagonally from site to site.
 *
 * At every site two strands meet. Normally they cross straight over.
 * Where the grid edge through a site is a "break", the strands may not cross
 * it and instead bounce back on their own side, parallel to it; the border
 * of the grid is a break all round. Following the pairings site to site
 * traces every closed strand of the knot.
 *
 * Over and under: at a site on a horizontal edge the NW–SE strand goes over,
 * on a vertical edge the NE–SW strand. Along any strand the site type flips
 * with every step and the strand's axis flips with every bounce, so between
 * two crossings (k steps, k − 1 bounces) "over" flips an odd number of
 * times: the knot is always properly alternating, whatever the breaks.
 *
 * Geometry: through a crossing a strand is straight; at a bounce it follows
 * a 90° arc of radius √½ centred half a step beyond the site. Both meet the
 * link midpoints along the diagonal, so the band's edges are exact offset
 * curves (parallel lines and concentric arcs). Strands cross at right angles,
 * so the under-strand is cut by arclength: w/2 + gap either side of the site.
 */
(function () {
    'use strict';
    const { geo } = PG;
    // diagonal directions (y down): NE, NW, SW, SE
    const DIRS = [[1, -1], [-1, -1], [-1, 1], [1, 1]];
    const OPP = [2, 3, 0, 1];
    const H = 1, V = 2, X = 0; // site kinds: horizontal break, vertical break, crossing
    // partner direction at a site of each kind
    const PAIR = {
        [X]: [2, 3, 0, 1], // straight through
        [H]: [1, 0, 3, 2], // NE↔NW above, SW↔SE below
        [V]: [3, 2, 1, 0], // NE↔SE right, NW↔SW left
    };

    PG.register({
        id: 'celtic',
        name: 'Celtic Knot',
        category: 'Tiles',
        description: 'Interlaced knotwork on a grid of dots, with breaks that turn the plait into panels and loops.',
        fit: false,
        params: [
            { type: 'section', label: 'Grid' },
            { id: 'cell', label: 'Dot spacing (mm)', type: 'range', min: 6, max: 60, step: 0.5, value: 20, random: [13, 30] },
            { id: 'breaks', label: 'Breaks', type: 'select', value: 'quad', random: ['random', 'mirror', 'quad', 'quad', 'rings', 'none'],
                options: [['none', 'None (plain plait)'], ['random', 'Random'], ['mirror', 'Random, mirrored'], ['quad', 'Random, four-fold'], ['rings', 'Nested frames']] },
            { id: 'density', label: 'Break density', type: 'range', min: 0, max: 0.8, step: 0.01, value: 0.28, random: [0.12, 0.4],
                show: p => p.breaks !== 'none' && p.breaks !== 'rings' },
            { id: 'ringStep', label: 'Frame every (dots)', type: 'range', min: 1, max: 6, step: 1, value: 2, random: [1, 3],
                show: p => p.breaks === 'rings' },
            { id: 'ringGaps', label: 'Openings in frames', type: 'range', min: 0, max: 0.9, step: 0.01, value: 0.25, random: [0, 0.5],
                show: p => p.breaks === 'rings' },
            { type: 'section', label: 'Band' },
            { id: 'width', label: 'Band width (% of spacing)', type: 'range', min: 0, max: 27, step: 0.5, value: 18, random: [12, 26] },
            { id: 'lines', label: 'Lines per band', type: 'range', min: 1, max: 6, step: 1, value: 2, random: [2, 4],
                hint: '1 draws the centre line only' },
            { id: 'gap', label: 'Crossing gap (mm)', type: 'range', min: 0, max: 5, step: 0.05, value: 1.2, random: [0.6, 1.8] },
            { id: 'flip', label: 'Mirror over/under', type: 'checkbox', value: false, random: 0.5 },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Each closed strand gets a pen at random' },
        ],

        generate(p, ctx) {
            const { rng } = ctx;
            const bb = geo.bbox([ctx.shape.polygon()]);
            const cell = Math.max(2, p.cell), u = cell / 2;
            const m = Math.max(1, Math.floor(bb.w / cell)), n = Math.max(1, Math.floor(bb.h / cell));
            const X0 = bb.minX + (bb.w - m * cell) / 2, Y0 = bb.minY + (bb.h - n * cell) / 2;
            const XM = 2 * m, YM = 2 * n;
            const toMM = (x, y) => [X0 + x * u, Y0 + y * u];

            // ---- site kinds (x + y odd); border sites are breaks
            const idx = (x, y) => y * (XM + 1) + x;
            const kind = new Int8Array((XM + 1) * (YM + 1)).fill(-1);
            for (let y = 0; y <= YM; y++) for (let x = (y + 1) % 2; x <= XM; x += 2) {
                kind[idx(x, y)] = y === 0 || y === YM ? H : x === 0 || x === XM ? V : X;
            }
            // a break on an interior grid edge: sites with x odd lie on horizontal edges
            const setBreak = (x, y) => {
                if (x <= 0 || x >= XM || y <= 0 || y >= YM || kind[idx(x, y)] < 0) return;
                kind[idx(x, y)] = x % 2 ? H : V;
            };
            if (p.breaks === 'rings') {
                const step = Math.max(1, Math.round(p.ringStep));
                for (let k = step; 2 * k < Math.min(m, n); k += step) {
                    const a = 2 * k, bx = XM - 2 * k, by = YM - 2 * k;
                    for (let x = a + 1; x < bx; x += 2) for (const y of [a, by]) if (!rng.chance(p.ringGaps)) setBreak(x, y);
                    for (let y = a + 1; y < by; y += 2) for (const x of [a, bx]) if (!rng.chance(p.ringGaps)) setBreak(x, y);
                }
            } else if (p.breaks !== 'none') {
                const mx = p.breaks === 'mirror' || p.breaks === 'quad', my = p.breaks === 'quad';
                for (let y = 1; y < YM; y++) for (let x = 1 + (y % 2); x < XM; x += 2) {
                    // decide once per symmetry orbit, at its top-left member
                    if ((mx && x > XM - x) || (my && y > YM - y)) continue;
                    if (!rng.chance(p.density)) continue;
                    setBreak(x, y);
                    if (mx) setBreak(XM - x, y);
                    if (my) setBreak(x, YM - y);
                    if (mx && my) setBreak(XM - x, YM - y);
                }
            }

            // ---- trace every closed strand as a list of visits { x, y, a (in dir), d (out dir) }
            const used = new Uint8Array((XM + 1) * (YM + 1) * 4);
            const valid = (x, y) => x >= 0 && y >= 0 && x <= XM && y <= YM;
            const loops = [];
            for (let y = 0; y <= YM; y++) for (let x = (y + 1) % 2; x <= XM; x += 2) {
                for (let d0 = 0; d0 < 4; d0++) {
                    if (used[idx(x, y) * 4 + d0] || !valid(x + DIRS[d0][0], y + DIRS[d0][1])) continue;
                    const visits = [];
                    let sx = x, sy = y, d = d0;
                    for (let guard = 0; guard < 4 * (XM + 1) * (YM + 1); guard++) {
                        used[idx(sx, sy) * 4 + d] = 1;
                        const tx = sx + DIRS[d][0], ty = sy + DIRS[d][1], a = OPP[d];
                        used[idx(tx, ty) * 4 + a] = 1;
                        const out = PAIR[kind[idx(tx, ty)]][a];
                        visits.push({ x: tx, y: ty, a, d: out });
                        sx = tx; sy = ty; d = out;
                        if (sx === x && sy === y && d === d0) break;
                    }
                    loops.push(visits);
                }
            }

            // ---- draw: every visit is the piece from the incoming to the outgoing link midpoint
            const w = (p.width / 100) * cell;
            const L = Math.max(1, Math.round(p.lines));
            const offsets = L === 1 ? [0] : Array.from({ length: L }, (_, j) => -w / 2 + (j * w) / (L - 1));
            const half = u * Math.SQRT1_2; // half a link, the straight run either side of a crossing
            const cut = Math.min(0.92 * half, (L === 1 ? 0 : w / 2) + p.gap);
            const R = u * Math.SQRT1_2; // bounce arc radius
            const pens = Math.max(1, p.pens | 0);
            const layers = Array.from({ length: pens }, () => []);

            for (const visits of loops) {
                const out = layers[pens > 1 ? rng.int(0, pens - 1) : 0];
                for (const o of offsets) {
                    let cur = null;
                    const add = (pts, fresh) => {
                        if (fresh || !cur) { cur = []; out.push(cur); }
                        for (const q of pts) {
                            const last = cur[cur.length - 1];
                            if (!last || Math.abs(last[0] - q[0]) > 1e-9 || Math.abs(last[1] - q[1]) > 1e-9) cur.push(q);
                        }
                    };
                    for (const v of visits) {
                        const T = toMM(v.x, v.y);
                        const dout = DIRS[v.d]; // outgoing travel direction (unnormalised)
                        const k = kind[idx(v.x, v.y)];
                        if (k === X) {
                            const D = [dout[0] * Math.SQRT1_2, dout[1] * Math.SQRT1_2], N = [-D[1] * o, D[0] * o];
                            const at = s => [T[0] + D[0] * s + N[0], T[1] + D[1] * s + N[1]];
                            // over: the NW–SE strand at sites on horizontal edges (x odd), the NE–SW one otherwise
                            const nwse = D[0] * D[1] > 0;
                            const over = (nwse === (v.x % 2 === 1)) !== p.flip;
                            if (over || cut <= 0) add([at(-half), at(half)]);
                            else { add([at(-half), at(-cut)]); add([at(cut), at(half)], true); }
                        } else {
                            // bounce: 90° arc about the point half a step beyond the site
                            const C = [T[0] + (DIRS[v.a][0] + dout[0]) * u / 2, T[1] + (DIRS[v.a][1] + dout[1]) * u / 2];
                            const Pin = [T[0] + DIRS[v.a][0] * u / 2, T[1] + DIRS[v.a][1] * u / 2];
                            const Pout = [T[0] + dout[0] * u / 2, T[1] + dout[1] * u / 2];
                            const a0 = Math.atan2(Pin[1] - C[1], Pin[0] - C[0]);
                            let da = Math.atan2(Pout[1] - C[1], Pout[0] - C[0]) - a0;
                            while (da > Math.PI) da -= 2 * Math.PI;
                            while (da < -Math.PI) da += 2 * Math.PI;
                            // the left normal of the travel direction points away from C when turning clockwise
                            const r = R - Math.sign(da) * o;
                            add(geo.arc(C[0], C[1], r, a0, a0 + da));
                        }
                    }
                }
            }
            return pens > 1 ? { layers } : layers[0];
        },
    });
})();
