/*
 * Truchet tiles. Every cell of a square or hexagonal grid holds the same
 * motif in one of a few orientations; neighbouring motifs meet at the cell
 * edges, so the pattern reads as long meandering curves.
 *
 *  - arcs:      Smith's tiles (1987) — two quarter circles joining the
 *               midpoints of adjacent edges. Concentric bands at radii
 *               s/2 ± k·w stay continuous across tiles.
 *  - hex:       three 120° arcs centred on alternating hexagon vertices.
 *  - diagonal:  one diagonal per cell ("10 PRINT CHR$(205.5+RND(1))"); with
 *               bands, parallel lines plus matching corner cuts so the
 *               stripes stay continuous.
 *  - triangles: half-square triangles, hatched on a global phase so the
 *               hatching of neighbouring triangles joins into long strokes.
 *
 * Orientation is random, or with "structure" > 0 blended with a smooth noise
 * threshold so large coherent regions appear.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const SQ3 = Math.sqrt(3);

    PG.register({
        id: 'truchet',
        name: 'Truchet',
        category: 'Tiles',
        description: 'Randomly oriented tiles whose arcs, diagonals or triangles join into long meanders.',
        fit: false,
        params: [
            { type: 'section', label: 'Tiles' },
            { id: 'type', label: 'Tile', type: 'select', value: 'arcs', random: ['arcs', 'arcs', 'hex', 'hex', 'diagonal', 'triangles'],
                options: [['arcs', 'Quarter arcs'], ['hex', 'Hexagon arcs'], ['diagonal', 'Diagonals (10 PRINT)'], ['triangles', 'Hatched triangles']] },
            { id: 'cell', label: 'Cell size (mm)', type: 'range', min: 3, max: 40, step: 0.5, value: 13, random: [10, 22] },
            { id: 'bands', label: 'Bands', type: 'range', min: 1, max: 9, step: 1, value: 5, random: [1, 6],
                show: p => p.type !== 'triangles' },
            { id: 'bandGap', label: 'Band spacing (mm)', type: 'range', min: 0.4, max: 5, step: 0.1, value: 1.1, random: [0.8, 2.2],
                show: p => p.type !== 'triangles' && p.bands > 1,
                hint: 'Clamped so bands of neighbouring arcs never cross' },
            { id: 'hatch', label: 'Hatch spacing (mm)', type: 'range', min: 0.4, max: 4, step: 0.05, value: 1.1, random: [0.8, 2],
                show: p => p.type === 'triangles' },
            { id: 'hatchDir', label: 'Hatch direction', type: 'select', value: 'along', random: true, show: p => p.type === 'triangles',
                options: [['along', 'Along the diagonal'], ['across', 'Across the diagonal'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical']] },
            { id: 'otherHalf', label: 'Hatch other half (pen 2)', type: 'checkbox', value: false, random: 0.3,
                show: p => p.type === 'triangles' },
            { type: 'section', label: 'Orientation' },
            { id: 'structure', label: 'Structure', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4, random: [0, 0.65],
                hint: '0 = every tile random, 1 = orientation follows smooth noise regions' },
            { id: 'noiseScale', label: 'Region size (mm)', type: 'range', min: 15, max: 300, step: 1, value: 80, random: [30, 160],
                show: p => p.structure > 0 },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                show: p => p.type !== 'triangles' }, // triangles: 'Hatch other half' picks pen 2
            { id: 'penMode', label: 'Split pens by', type: 'select', value: 'curve', show: p => p.pens > 1 && p.type !== 'triangles',
                options: [['curve', 'Whole curves'], ['band', 'Band'], ['orient', 'Tile orientation']] },
        ],

        randomize(rng, p) {
            // aim for 12-28 m of line on A4: length ≈ area · bands · k / cell
            if (p.type === 'triangles') return { hatch: Math.max(p.hatch, p.otherHalf ? 1.4 : 1) };
            const k = { arcs: Math.PI / 2, hex: (2 * Math.PI) / 3, diagonal: 2.6 }[p.type];
            return { bands: Math.max(1, Math.min(p.bands, Math.floor((rng.range(12000, 28000) * p.cell) / (48000 * k)))) };
        },

        generate(p, ctx) {
            const { width: W, height: H, rng, noise } = ctx;
            const s = p.cell;
            const pens = Math.max(1, p.pens | 0);
            const ns = 1 / p.noiseScale;

            // Orientation index in [0, k): blend of per-tile randomness and a noise level.
            const orient = (x, y, k) => {
                const r = rng.random();
                if (p.structure <= 0) return Math.floor(r * k);
                const v = geo.clamp(0.5 + 0.9 * noise.fbm2(x * ns, y * ns, 2), 0, 0.9999);
                return Math.min(k - 1, Math.floor((p.structure * v + (1 - p.structure) * r) * k));
            };

            // Band radii around r0. The spread is clamped to 0.34·cell so arcs from
            // opposite corners keep clear of each other (they touch at ≈ 0.41·cell).
            const radii = r0 => {
                const B = p.type === 'arcs' || p.type === 'hex' ? Math.max(1, p.bands | 0) : 1;
                const w = B > 1 ? Math.min(p.bandGap, (0.34 * s) / (B - 1)) : 0;
                const out = [];
                for (let k = 0; k < B; k++) out.push({ r: r0 + (k - (B - 1) / 2) * w, k: Math.min(k, B - 1 - k) });
                return out;
            };

            // Arcs carry { path, o (orientation), k (band class) }.
            const arcs = [];

            if (p.type === 'arcs') {
                const cols = Math.ceil(W / s) + 2, rows = Math.ceil(H / s) + 2;
                const x0 = (W - (cols - 2) * s) / 2 - s, y0 = (H - (rows - 2) * s) / 2 - s;
                const bands = radii(s / 2);
                const quarter = Math.PI / 2;
                for (let j = 0; j < rows; j++) {
                    for (let i = 0; i < cols; i++) {
                        const x = x0 + i * s, y = y0 + j * s;
                        const o = orient(x + s / 2, y + s / 2, 2);
                        // corners (and start angles) of the two arcs
                        const cs = o === 0
                            ? [[x, y, 0], [x + s, y + s, Math.PI]]
                            : [[x + s, y, quarter], [x, y + s, 3 * quarter]];
                        for (const [cx, cy, a0] of cs) {
                            for (const b of bands) arcs.push({ path: geo.arc(cx, cy, b.r, a0, a0 + quarter), o, k: b.k });
                        }
                    }
                }
            } else if (p.type === 'hex') {
                // flat-topped hexagons, centre spacing = cell size, edge e = s / √3
                const e = s / SQ3;
                const dx = 1.5 * e, dy = SQ3 * e;
                const cols = Math.ceil(W / dx) + 3, rows = Math.ceil(H / dy) + 3;
                const bands = radii(e / 2);
                for (let i = -1; i < cols; i++) {
                    for (let j = -1; j < rows; j++) {
                        const cx = i * dx, cy = (j + (i & 1 ? 0.5 : 0)) * dy;
                        const o = orient(cx, cy, 2);
                        for (let v = o; v < 6; v += 2) {
                            const a = (v * TAU) / 6;
                            const vx = cx + e * Math.cos(a), vy = cy + e * Math.sin(a);
                            const a0 = a + (2 * TAU) / 6; // wedge towards the centre, 120° wide
                            for (const b of bands) arcs.push({ path: geo.arc(vx, vy, b.r, a0, a0 + TAU / 3), o, k: b.k });
                        }
                    }
                }
            } else if (p.type === 'diagonal') {
                // Bands: lines parallel to the diagonal hitting the edges at q = k·w
                // from the corner, plus the matching corner cuts at s − q, so every
                // edge carries the same symmetric set of crossings and stripes continue.
                const cols = Math.ceil(W / s) + 2, rows = Math.ceil(H / s) + 2;
                const x0 = (W - (cols - 2) * s) / 2 - s, y0 = (H - (rows - 2) * s) / 2 - s;
                const B = Math.max(1, p.bands | 0);
                const w = B > 1 ? Math.min(p.bandGap, (0.45 * s) / (B - 1)) : 0;
                const unit = []; // lines in a unit tile for the "\" orientation, as [x0,y0,x1,y1]
                for (let k = 0; k < B; k++) {
                    const q = k * w;
                    unit.push({ l: [q, 0, s, s - q], k });
                    if (k) unit.push({ l: [0, q, s - q, s], k });
                    if (k) unit.push({ l: [0, s - q, q, s], k }, { l: [s - q, 0, s, q], k });
                }
                for (let j = 0; j < rows; j++) {
                    for (let i = 0; i < cols; i++) {
                        const x = x0 + i * s, y = y0 + j * s;
                        const o = orient(x + s / 2, y + s / 2, 2);
                        for (const { l, k } of unit) {
                            // o = 1 mirrors the tile horizontally ("/")
                            const path = o ? [[x + s - l[0], y + l[1]], [x + s - l[2], y + l[3]]] : [[x + l[0], y + l[1]], [x + l[2], y + l[3]]];
                            arcs.push({ path, o, k });
                        }
                    }
                }
            } else {
                // half-square triangles; orientation = which corner is filled
                const cols = Math.ceil(W / s) + 2, rows = Math.ceil(H / s) + 2;
                const x0 = (W - (cols - 2) * s) / 2 - s, y0 = (H - (rows - 2) * s) / 2 - s;
                const main = [], other = [];
                const q = Math.PI / 4;
                const angleFor = (o, half) => {
                    // hypotenuse runs at 135° for corners 0/2, 45° for corners 1/3
                    const along = o % 2 ? q : 3 * q;
                    if (p.hatchDir === 'along') return along;
                    if (p.hatchDir === 'across') return along + 2 * q;
                    const base = p.hatchDir === 'vertical' ? 2 * q : 0;
                    return half ? base + 2 * q : base;
                };
                for (let j = 0; j < rows; j++) {
                    for (let i = 0; i < cols; i++) {
                        const x = x0 + i * s, y = y0 + j * s;
                        const c = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
                        const o = orient(x + s / 2, y + s / 2, 4);
                        main.push(...geo.hatch([c[o], c[(o + 1) % 4], c[(o + 3) % 4]], p.hatch, angleFor(o, false)));
                        if (p.otherHalf) {
                            const u = (o + 2) % 4;
                            other.push(...geo.hatch([c[u], c[(u + 1) % 4], c[(u + 3) % 4]], p.hatch, angleFor(u, true)));
                        }
                    }
                }
                if (!p.otherHalf) return pens > 1 ? { layers: [main] } : main;
                return { layers: [main, other] };
            }

            if (pens <= 1) return arcs.map(a => a.path);

            let penOf;
            if (p.penMode === 'band') penOf = a => a.k;
            else if (p.penMode === 'orient') penOf = a => a.o;
            else {
                // union arcs that share an endpoint, then colour each whole curve at random
                const key = pt => `${Math.round(pt[0] * 200)},${Math.round(pt[1] * 200)}`;
                const parent = arcs.map((_, i) => i);
                const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
                const seen = new Map();
                arcs.forEach((a, i) => {
                    for (const pt of [a.path[0], a.path[a.path.length - 1]]) {
                        const k = key(pt), j = seen.get(k);
                        if (j === undefined) seen.set(k, i); else parent[find(i)] = find(j);
                    }
                });
                const colour = new Map();
                arcs.forEach((a, i) => { a.root = find(i); });
                penOf = a => {
                    if (!colour.has(a.root)) colour.set(a.root, rng.int(0, pens - 1));
                    return colour.get(a.root);
                };
            }
            const layers = Array.from({ length: pens }, () => []);
            for (const a of arcs) layers[penOf(a) % pens].push(a.path);
            return { layers };
        },
    });
})();
