/*
 * Hyperbolic tilings in the Poincaré disk, as in Escher's "Circle Limit"
 * prints. The regular tiling {p, q} (q p-gons at every vertex) exists in the
 * hyperbolic plane when (p − 2)(q − 2) > 4.
 *
 * The central p-gon has its vertices at hyperbolic distance R from the
 * centre, cosh R = cot(π/p)·cot(π/q), which the disk shows at Euclidean
 * radius tanh(R/2). Every other tile is reached by reflecting a tile in one
 * of its edges; a geodesic is a diameter or a circle orthogonal to the
 * boundary, and reflection in it is a circle inversion. Each tile carries
 * the images of a few key points of the central tile (centre, vertices,
 * edge midpoints, vertices of nested copies), and every line drawn is the
 * geodesic between two of them, so arcs are exact rather than sampled
 * copies. Tiles smaller than the cutoff are drawn but not expanded.
 *
 * Styles: the tiling's edges; its (2, p, q) triangle subdivision (the
 * kaleidoscope of mirrors that generates it); concentric hyperbolic copies
 * of each tile; or every other triangle hatched, which two-colours the
 * tiling the way Escher did. The view can be centred on a tile, a vertex or
 * the midpoint of an edge (a hyperbolic translation moves it to the centre).
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // The geodesic through a and b: a diameter, or a circle orthogonal to the unit circle.
    function geodesic(a, b) {
        const det = a[0] * b[1] - a[1] * b[0];
        const scale = Math.max(geo.dist(a, [0, 0]), geo.dist(b, [0, 0]));
        if (Math.abs(det) < 1e-10 * Math.max(1e-6, scale)) {
            const u = scale > 0 ? (geo.dist(a, [0, 0]) >= geo.dist(b, [0, 0]) ? a : b) : [1, 0];
            const L = Math.hypot(u[0], u[1]) || 1;
            return { line: true, u: [u[0] / L, u[1] / L] };
        }
        // c·a = (1 + |a|²)/2, c·b = (1 + |b|²)/2
        const ra = (1 + a[0] * a[0] + a[1] * a[1]) / 2, rb = (1 + b[0] * b[0] + b[1] * b[1]) / 2;
        const c = [(ra * b[1] - rb * a[1]) / det, (a[0] * rb - b[0] * ra) / det];
        return { c, r: Math.sqrt(Math.max(0, c[0] * c[0] + c[1] * c[1] - 1)) };
    }

    function reflect(z, g) {
        if (g.line) {
            const k = 2 * (z[0] * g.u[0] + z[1] * g.u[1]);
            return [k * g.u[0] - z[0], k * g.u[1] - z[1]];
        }
        const dx = z[0] - g.c[0], dy = z[1] - g.c[1], s = (g.r * g.r) / (dx * dx + dy * dy);
        return [g.c[0] + dx * s, g.c[1] + dy * s];
    }

    // Hyperbolic translation taking the point a to the origin: z -> (z - a) / (1 - conj(a) z).
    function toOrigin(z, a) {
        const nx = z[0] - a[0], ny = z[1] - a[1];
        const dx = 1 - (a[0] * z[0] + a[1] * z[1]), dy = -(a[0] * z[1] - a[1] * z[0]);
        const d = dx * dx + dy * dy;
        return [(nx * dx + ny * dy) / d, (ny * dx - nx * dy) / d];
    }

    // Points reached along different chains of reflections agree only to ~1e-12
    // (~1e-9 deep in the rim of a large tiling),
    // which can straddle any rounding boundary, so identify them with a tolerance:
    // a hash grid of 1e-6 cells searched 3 × 3, matching within 1e-7.
    function pointIds() {
        const grid = new Map();
        let count = 0;
        return z => {
            const gx = Math.round(z[0] * 1e6), gy = Math.round(z[1] * 1e6);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const list = grid.get((gx + dx) * 4194304 + gy + dy);
                if (list) for (const q of list) if (Math.abs(q[0] - z[0]) < 1e-7 && Math.abs(q[1] - z[1]) < 1e-7) return q[2];
            }
            const k = gx * 4194304 + gy;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push([z[0], z[1], count]);
            return count++;
        };
    }

    // Curated {p, q} pairs that all read well.
    const PAIRS = [[7, 3], [3, 7], [5, 4], [4, 5], [6, 4], [4, 6], [8, 3], [3, 8], [5, 5], [6, 6], [8, 4], [4, 8], [12, 3], [7, 4], [10, 3]];

    PG.register({
        id: 'hyperbolic',
        name: 'Hyperbolic Tiling',
        category: 'Tiles',
        description: 'Regular {p, q} tilings of the Poincaré disk, in the manner of Escher\'s Circle Limit prints.',
        fit: false,
        params: [
            { type: 'section', label: 'Tiling' },
            { id: 'p', label: 'Polygon sides p', type: 'range', min: 3, max: 12, step: 1, value: 7 },
            { id: 'q', label: 'Polygons per vertex q', type: 'range', min: 3, max: 12, step: 1, value: 3,
                hint: 'Needs (p − 2)(q − 2) > 4; q is raised until it is' },
            { id: 'centre', label: 'Centre on', type: 'select', value: 'tile', random: ['tile', 'tile', 'vertex', 'edge'],
                options: [['tile', 'Tile'], ['vertex', 'Vertex'], ['edge', 'Edge']] },
            { id: 'spin', label: 'Spin°', type: 'range', min: 0, max: 360, step: 1, value: 0 },
            { id: 'minSize', label: 'Smallest tile (mm)', type: 'range', min: 0.5, max: 10, step: 0.1, value: 1.6, random: [1.2, 3],
                hint: 'Tiles smaller than this are not subdivided further towards the rim' },
            { type: 'section', label: 'Style' },
            { id: 'style', label: 'Style', type: 'select', value: 'triangles', random: ['edges', 'triangles', 'nested', 'nested', 'checker', 'checker'],
                options: [['edges', 'Edges'], ['triangles', 'Triangle kaleidoscope'], ['nested', 'Nested tiles'], ['checker', 'Hatched checkerboard']] },
            { id: 'rings', label: 'Nested copies', type: 'range', min: 1, max: 12, step: 1, value: 4, random: [2, 7],
                show: p => p.style === 'nested' },
            { id: 'spacing', label: 'Hatch spacing (mm)', type: 'range', min: 0.5, max: 4, step: 0.05, value: 0.9, random: [0.7, 1.5],
                show: p => p.style === 'checker' },
            { id: 'hatchAngle', label: 'Hatch angle°', type: 'range', min: 0, max: 180, step: 1, value: 45,
                show: p => p.style === 'checker' },
            { id: 'edges', label: 'Draw tile edges', type: 'checkbox', value: true, random: 0.7,
                show: p => p.style !== 'edges' },
            { id: 'rim', label: 'Boundary circle', type: 'checkbox', value: true, random: 0.7 },
            { type: 'section', label: 'Pens' },
            { id: 'split', label: 'Detail on pen 2', type: 'checkbox', value: true, random: false,
                hint: 'Tile edges and rim on pen 1, subdivision, copies or hatching on pen 2', show: p => p.style !== 'edges' },
        ],

        randomize(rng) {
            const [p, q] = rng.pick(PAIRS);
            return { p, q, spin: rng.int(0, 71) * 5 };
        },

        generate(prm, ctx) {
            const p = Math.max(3, Math.round(prm.p));
            let q = Math.max(3, Math.round(prm.q));
            while ((p - 2) * (q - 2) <= 4) q++;

            const bb = geo.bbox([ctx.shape.polygon()]);
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            const Rd = Math.max(1, ctx.shape.dist(cx, cy)); // disk radius in mm: the largest circle the visible area holds
            const toMM = z => [cx + Rd * z[0], cy + Rd * z[1]];

            // ---- the central tile's key points
            const Rh = Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q)));
            const rv = Math.tanh(Rh / 2);
            const rot = geo.rad(prm.spin) - Math.PI / 2;
            const pts = [[0, 0]];
            const V = i => 1 + (i % p), M = i => 1 + p + (i % p);
            for (let i = 0; i < p; i++) pts.push([rv * Math.cos(rot + (TAU * i) / p), rv * Math.sin(rot + (TAU * i) / p)]);
            for (let i = 0; i < p; i++) {
                // edge midpoint: where the edge's geodesic crosses the bisecting ray, |c| − r from the centre
                const g = geodesic(pts[V(i)], pts[V(i + 1)]);
                const d = g.line ? rv * Math.cos(Math.PI / p) : Math.hypot(g.c[0], g.c[1]) - g.r;
                const a = rot + (TAU * (i + 0.5)) / p;
                pts.push([d * Math.cos(a), d * Math.sin(a)]);
            }
            const rings = prm.style === 'nested' ? Math.max(1, Math.round(prm.rings)) : 0;
            const N = k => 1 + 2 * p + k * p; // first vertex of nested copy k
            for (let k = 0; k < rings; k++) {
                // copies at evenly spaced hyperbolic radii, inside the tile
                const r = Math.tanh((Rh * (rings - k)) / (rings + 1) / 2);
                for (let i = 0; i < p; i++) pts.push([r * Math.cos(rot + (TAU * i) / p), r * Math.sin(rot + (TAU * i) / p)]);
            }

            // ---- features as index pairs, per pen
            const edges = [], detail = [];
            for (let i = 0; i < p; i++) edges.push([V(i), V(i + 1)]);
            if (prm.style === 'triangles') for (let i = 0; i < p; i++) detail.push([0, V(i)], [0, M(i)]);
            const nested = [];
            for (let k = 0; k < rings; k++) {
                const ring = [];
                for (let i = 0; i < p; i++) ring.push([N(k) + i, N(k) + ((i + 1) % p)]);
                nested.push(ring);
            }
            const drawEdges = prm.style === 'edges' || prm.edges;

            // ---- move the chosen centre to the origin
            let shift = null;
            if (prm.centre === 'vertex') shift = pts[V(0)];
            else if (prm.centre === 'edge') shift = pts[M(0)];
            let first = shift ? pts.map(z => toOrigin(z, shift)) : pts;

            // ---- breadth-first reflection in tile edges
            const tileSize = t => Rd * Math.max(...t.pts.slice(1, p + 1).map(v => geo.dist(v, t.pts[0])));
            const id = pointIds();
            const tiles = [{ pts: first, parity: 0 }];
            const seen = new Set([id(first[0])]);
            const minSize = Math.max(0.3, prm.minSize);
            for (let head = 0; head < tiles.length && tiles.length < 25000; head++) {
                const t = tiles[head];
                if (tileSize(t) < minSize) continue;
                for (let i = 0; i < p; i++) {
                    const g = geodesic(t.pts[V(i)], t.pts[V(i + 1)]);
                    const c = reflect(t.pts[0], g);
                    if (Math.hypot(c[0], c[1]) >= 1) continue;
                    const k = id(c);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    tiles.push({ pts: t.pts.map(z => reflect(z, g)), parity: 1 - t.parity });
                }
            }

            // ---- draw
            const arc = (a, b) => {
                const g = geodesic(a, b), A = toMM(a), B = toMM(b);
                if (g.line || g.r * Rd > 1e5) return [A, B];
                const a0 = Math.atan2(a[1] - g.c[1], a[0] - g.c[0]);
                let da = Math.atan2(b[1] - g.c[1], b[0] - g.c[0]) - a0;
                while (da > Math.PI) da -= TAU;
                while (da < -Math.PI) da += TAU;
                const C = toMM(g.c);
                const path = geo.arc(C[0], C[1], g.r * Rd, a0, a0 + da);
                path[0] = A; path[path.length - 1] = B; // exact ends so neighbouring arcs join
                return path;
            };
            const done = new Set();
            const emit = (a, b, out) => {
                if (geo.dist(a, b) * Rd < 0.15) return;
                const ia = id(a), ib = id(b), k = ia < ib ? ia * 1e8 + ib : ib * 1e8 + ia;
                if (done.has(k)) return;
                done.add(k);
                out.push(arc(a, b));
            };
            const L0 = [], L1 = prm.split ? [] : L0;
            for (const t of tiles) {
                if (drawEdges) for (const [i, j] of edges) emit(t.pts[i], t.pts[j], L0);
                for (const [i, j] of detail) emit(t.pts[i], t.pts[j], L1);
                if (!rings) continue;
                // toward the rim keep every stride-th copy, so copies stay ≥ 0.8 mm apart (across the inradius)
                const stride = Math.ceil((0.8 * (rings + 1)) / (tileSize(t) * Math.cos(Math.PI / p)));
                for (let k = 0; k < rings; k++) {
                    if ((k + 1) % stride) continue;
                    for (const [i, j] of nested[k]) emit(t.pts[i], t.pts[j], L1);
                }
            }
            if (prm.style === 'checker') {
                // the 2p triangles (centre, vertex, midpoint) of every tile, alternately coloured
                const sp = Math.max(0.2, prm.spacing), ang = geo.rad(prm.hatchAngle);
                for (const t of tiles) {
                    for (let j = 0; j < 2 * p; j++) {
                        if ((j + t.parity) % 2) continue;
                        const i = j >> 1;
                        const tri = j % 2 ? [0, M(i), V(i + 1)] : [0, V(i), M(i)];
                        const P = tri.map(k => t.pts[k]);
                        if (Rd * Math.max(geo.dist(P[0], P[1]), geo.dist(P[1], P[2]), geo.dist(P[0], P[2])) < 2 * sp) continue;
                        const poly = [];
                        for (let e = 0; e < 3; e++) { const s = arc(P[e], P[(e + 1) % 3]); for (let k = 0; k < s.length - 1; k++) poly.push(s[k]); }
                        for (const s of geo.hatch(poly, sp, ang)) L1.push(s);
                    }
                }
            }
            if (prm.rim) L0.push(geo.circle(cx, cy, Rd));
            return { layers: prm.split ? [L0, L1] : [L0] };
        },
    });
})();
