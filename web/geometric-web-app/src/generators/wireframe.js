/*
 * Wireframe: a triangulated wire mesh draped over a height field and seen from
 * above at an angle, like the terrain plots from early computer graphics.
 *
 * The mesh is a lattice of square cells, each split into triangles by a
 * diagonal. Hidden lines are removed exactly. For a point on an edge, the sight
 * line back to the eye is walked across the mesh from triangle to triangle, and
 * the point is hidden if the line is under the surface at any edge it crosses.
 * Both are straight inside a triangle, so checking at the edges is enough.
 *
 * With a frayed edge the border triangles drop out, and the loose ends of the
 * rows and columns are left sticking out like a torn net.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Pen slots from cold to hot. Elevation and distance bands use the inks in
    // this order at any pen count, so they always read as a gradient.
    const RAMP = [0, 3, 6, 2, 5, 1, 7, 4];
    const ROW = 0, COL = 1, DIAG = 2, ANTI = 3;
    const MAX_CELLS = 40000;

    PG.register({
        id: 'wireframe',
        name: 'Wireframe',
        category: 'Fields',
        description: 'A triangulated wire mesh draped over city blocks, terraced hills, canyons and craters, with hidden lines removed and a frayed edge.',
        fit: false,
        params: [
            { type: 'section', label: 'Terrain' },
            { id: 'terrain', label: 'Terrain', type: 'select', value: 'city',
                random: ['hills', 'hills', 'city', 'city', 'peaks', 'island', 'canyon', 'craters', 'ripples'],
                options: [['hills', 'Rolling hills'], ['peaks', 'Ridged peaks'], ['island', 'Island'], ['canyon', 'Canyons'],
                    ['city', 'City blocks'], ['craters', 'Craters'], ['ripples', 'Ripples']] },
            { id: 'relief', label: 'Height', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.6, random: [0.35, 0.8] },
            { id: 'scale', label: 'Feature size', type: 'range', min: 0.15, max: 1.2, step: 0.01, value: 0.7, random: [0.35, 0.8],
                hint: 'Size of the hills, blocks, craters or waves, relative to the width of the mesh' },
            { id: 'rough', label: 'Roughness', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0.15, 0.6],
                show: p => p.terrain !== 'city' && p.terrain !== 'ripples' },
            { id: 'terraces', label: 'Terrace steps', type: 'range', min: 0, max: 10, step: 1, value: 5, random: false,
                hint: 'Cuts the height into flat steps with a cliff between them (0 = smooth)' },
            { id: 'sea', label: 'Flat below', type: 'range', min: 0, max: 0.7, step: 0.01, value: 0, random: false,
                hint: 'Levels everything under this height, like a lake or a plain' },
            { type: 'section', label: 'Mesh' },
            { id: 'cells', label: 'Cells across', type: 'range', min: 12, max: 100, step: 1, value: 36, random: false },
            { id: 'pattern', label: 'Triangles', type: 'select', value: 'diamond',
                random: ['diamond', 'diamond', 'tri', 'tri', 'zig', 'slope', 'cross', 'random', 'grid'],
                options: [['tri', 'One way'], ['zig', 'Zigzag rows'], ['diamond', 'Diamonds'], ['cross', 'Crossed'],
                    ['slope', 'Along the slope'], ['random', 'Random'], ['grid', 'Squares only']] },
            { id: 'flats', label: 'Plain squares on flat ground', type: 'checkbox', value: false, random: 0.3,
                show: p => p.pattern !== 'grid', hint: 'Only slopes and cliffs get diagonals' },
            { id: 'irregular', label: 'Irregularity', type: 'range', min: 0, max: 1, step: 0.01, value: 0, random: false,
                hint: 'Stretches and jitters the mesh, like a net that was pulled out of shape' },
            { id: 'fray', label: 'Frayed edge', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: false,
                hint: 'Border cells drop out and leave loose threads (0 = clean edge)' },
            { type: 'section', label: 'View' },
            { id: 'frame', label: 'Framing', type: 'select', value: 'page', random: ['page', 'page', 'page', 'tile'],
                options: [['page', 'Fill the page'], ['tile', 'Whole tile']] },
            { id: 'yaw', label: 'Turn (°)', type: 'range', min: -90, max: 90, step: 1, value: -14, random: false },
            { id: 'pitch', label: 'Tilt (°)', type: 'range', min: 20, max: 90, step: 1, value: 54, random: [36, 68],
                hint: '90 looks straight down' },
            { id: 'persp', label: 'Perspective', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: false,
                hint: '0 keeps parallel lines parallel' },
            { id: 'solid', label: 'Hide lines behind the surface', type: 'checkbox', value: true, random: 0.85 },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
            { id: 'penMode', label: 'Color by', type: 'select', value: 'height', show: p => p.pens > 1,
                options: [['height', 'Elevation'], ['depth', 'Distance'], ['direction', 'Line direction']] },
        ],

        randomize(rng, p) {
            const out = { sea: 0, irregular: rng.chance(0.25) ? +rng.range(0.4, 1).toFixed(2) : 0 };
            const steps = (chance, lo, hi) => (rng.chance(chance) ? rng.int(lo, hi) : 0);
            if (p.terrain === 'hills') {
                out.terraces = steps(0.6, 3, 7);
                if (rng.chance(0.3)) out.sea = +rng.range(0.15, 0.35).toFixed(2);
            } else if (p.terrain === 'peaks') {
                Object.assign(out, { terraces: steps(0.25, 4, 8), rough: +rng.range(0.15, 0.4).toFixed(2),
                    scale: +rng.range(0.5, 0.95).toFixed(2), relief: +rng.range(0.5, 0.9).toFixed(2) });
                if (rng.chance(0.25)) out.sea = +rng.range(0.1, 0.25).toFixed(2);
            } else if (p.terrain === 'island') {
                Object.assign(out, { terraces: steps(0.4, 4, 8), relief: +rng.range(0.55, 0.95).toFixed(2) });
            } else if (p.terrain === 'canyon') {
                Object.assign(out, { terraces: steps(0.6, 3, 6), relief: +rng.range(0.3, 0.6).toFixed(2),
                    scale: +rng.range(0.5, 1).toFixed(2), rough: +rng.range(0.1, 0.4).toFixed(2) });
            } else if (p.terrain === 'city') {
                Object.assign(out, { terraces: steps(0.5, 4, 8), relief: +rng.range(0.45, 0.85).toFixed(2), irregular: 0 });
            } else if (p.terrain === 'craters') {
                Object.assign(out, { terraces: steps(0.2, 4, 7), relief: +rng.range(0.3, 0.55).toFixed(2),
                    scale: +rng.range(0.3, 0.7).toFixed(2) });
            } else {
                Object.assign(out, { terraces: steps(0.25, 4, 8), relief: +rng.range(0.25, 0.5).toFixed(2),
                    scale: +rng.range(0.25, 0.6).toFixed(2) });
                if (rng.chance(0.25)) out.sea = +rng.range(0.3, 0.5).toFixed(2);
            }
            // Hidden lines stay on over cliffs. Seeing through works on smooth ground,
            // but cliffs behind cliffs turn to scribble.
            out.solid = !(out.terraces === 0 && p.terrain !== 'city' && rng.chance(0.18));
            const view = rng.random();
            let pitch = p.pitch;
            if (p.frame === 'tile') {
                // a tile reads best face on or as a true isometric block, and with not much torn off it
                if (view < 0.3) Object.assign(out, { yaw: rng.sign() * 45, persp: 0, pitch: pitch = rng.int(38, 55) });
                else Object.assign(out, { yaw: view < 0.75 ? 0 : rng.sign() * rng.int(8, 20), persp: +rng.range(0.3, 0.9).toFixed(2) });
                out.fray = rng.chance(0.55) ? 0 : +rng.range(0.2, 0.55).toFixed(2);
            } else {
                out.yaw = view < 0.25 ? 0 : view < 0.7 ? rng.int(-25, 25) : rng.sign() * rng.int(26, 60);
                out.persp = rng.chance(0.2) ? 0 : +rng.range(0.3, 0.9).toFixed(2);
                out.fray = rng.chance(0.35) ? 0 : +rng.range(0.3, 0.9).toFixed(2);
            }
            // Keep the ink about the same whatever the pattern and tilt. Squares have no
            // diagonals and crossed cells have two, a low tilt packs in more rows, and seeing
            // through draws everything behind as well.
            let cells = rng.range(30, 52) * Math.sqrt(Math.sin(geo.rad(pitch)) / 0.8);
            if (p.pattern === 'grid') cells *= 1.25;
            if (p.pattern === 'cross') cells *= 0.72;
            if (!out.solid) cells *= 0.8;
            out.cells = Math.round(cells);
            return out;
        },

        generate(p, ctx) {
            const { noise } = ctx;
            const pitch = geo.rad(p.pitch), sp = Math.sin(pitch), cp = Math.cos(pitch);
            const yaw = geo.rad(p.yaw), cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
            const region = ctx.shape.polygon(), box = geo.bbox([region]), mid = geo.centroid(region);
            const fill = p.frame === 'page';

            // x and y are on the ground with the eye off towards -y, z is up.
            // D is the distance to the eye in cells, 0 for a parallel projection.
            const camera = (D, zt) => ({ D, zt, raw(x, y, z) {
                const w = D ? D / (D + y * cp - (z - zt) * sp) : 1;
                return [x * w, -(y * sp + (z - zt) * cp) * w];
            } });

            // ---- lattice: N x M cells with the view aimed at (cx, cy). S is the size the
            // terrain is relative to and top the highest it gets, all in cells.
            let n = Math.round(p.cells), N, M, cx, cy, S, top, C, zoom = 0, rx, ry;
            if (fill) {
                // The mesh covers the page. `cells` of them fit across where the view is aimed, and
                // the lattice takes in all the ground that can show up inside the visible area.
                for (let pass = 0; pass < 2; pass++) {
                    zoom = box.w / n;
                    const hh = box.h / zoom / 2;
                    // rx and ry are about how far the ground in view reaches. Not divided by the real
                    // tilt, or the island and the ripples would move as the view tilts.
                    S = n; top = p.relief * 0.34 * S; rx = n / 2; ry = hh / 0.8;
                    // Perspective 1 draws the nearest cells about 2.2 times the size of the farthest
                    // at any tilt. Looking nearly straight down that would bring the eye down into
                    // the terrain, so the angle of view stops at 28 degrees.
                    const D = p.persp > 0 ? hh / (p.persp * Math.min(0.53, 0.375 * sp / Math.max(cp, 1e-9))) : 0;
                    C = camera(D, top / 2);
                    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
                    for (const q of region) {
                        const sx = (q[0] - mid[0]) / zoom, su = (mid[1] - q[1]) / zoom;
                        for (const z of [0, top]) {
                            // where the sight line through this corner meets the ground at height z
                            let gx = sx, gy;
                            if (D) {
                                const depth = (z - C.zt - su * cp) / (su * cp / D - sp), k = (D + depth) / D;
                                gx = k * sx; gy = depth * cp + k * su * sp;
                            } else gy = su * sp + (C.zt + su * cp - z) / sp * cp;
                            const lx = gx * cyaw + gy * syaw, ly = gy * cyaw - gx * syaw;
                            x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly);
                        }
                    }
                    const pad = p.irregular > 0 ? 4 : 2;
                    cx = pad - Math.floor(x0); cy = pad - Math.floor(y0);
                    N = Math.ceil(x1) + pad + cx; M = Math.ceil(y1) + pad + cy;
                    if (N * M <= MAX_CELLS) break;
                    n = Math.max(4, Math.floor(n * Math.sqrt(MAX_CELLS / (N * M))));
                }
            } else {
                // A tile on its own. The cell count is for the side lying across the page, and the
                // other side is picked so the projected tile has about the shape of the visible area.
                const flip = Math.abs(syaw) > Math.abs(cyaw), want = box.h / box.w;
                let m = n, err = Infinity;
                for (let t = Math.ceil(n * 0.5); t <= Math.min(n * 2.6, MAX_CELLS / n); t += Math.max(1, Math.round(n / 24))) {
                    const w = flip ? t : n, d = flip ? n : t, z = p.relief * 0.34 * Math.min(w, d) * 0.5;
                    const c = camera(p.persp > 0 ? 0.9 * Math.hypot(w, d) / p.persp : 0, z);
                    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
                    for (let k = 0; k < 8; k++) {
                        const x = (k & 1 ? 0.5 : -0.5) * w, y = (k & 2 ? 0.5 : -0.5) * d;
                        const q = c.raw(x * cyaw - y * syaw, x * syaw + y * cyaw, k & 4 ? z : 0);
                        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
                    }
                    // near ties go to the squarer tile
                    const e = Math.abs(Math.log((y1 - y0) / (x1 - x0) / want)) + 0.03 * Math.abs(Math.log(t / n));
                    if (e < err) { err = e; m = t; }
                }
                N = flip ? m : n; M = flip ? n : m; cx = N / 2; cy = M / 2;
                S = Math.min(N, M); top = p.relief * 0.34 * S; rx = N / 2; ry = M / 2;
                C = camera(p.persp > 0 ? 0.9 * Math.hypot(N, M) / p.persp : 0, top / 2);
            }
            const W = N + 1, cross = p.pattern === 'cross';
            const NL = W * (M + 1), NV = NL + (cross ? N * M : 0), D = C.D, zt = C.zt;

            // ---- vertices: place in the lattice, then position on the ground and height
            const IX = new Float32Array(NV), IY = new Float32Array(NV);
            const X = new Float64Array(NV), Y = new Float64Array(NV), Z = new Float64Array(NV);
            // A repeatable random number for a lattice point, counted from the point the view is aimed
            // at. A page-filling mesh then keeps its jitter and its diagonals when the view changes
            // what the lattice has to cover.
            const ox = fill ? cx : 0, oy = fill ? cy : 0;
            const hash = (i, j, k) => {
                let v = Math.imul(i - ox, 374761393) ^ Math.imul(j - oy, 668265263) ^ Math.imul(ctx.seed + k, 1274126177);
                v = Math.imul(v ^ (v >>> 16), 0x85ebca6b);
                v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35);
                return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
            };
            for (let j = 0, v = 0; j <= M; j++) {
                for (let i = 0; i <= N; i++, v++) {
                    let x = i, y = j;
                    if (p.irregular > 0) {
                        // nothing moves on the border, so a tile's clean edge stays straight
                        const k = p.irregular * geo.smoothstep(0, 5, Math.min(i, N - i, j, M - j));
                        // Jitter stays under 1/7 of a cell, past that a triangle can flip over.
                        // The slow stretch on top is smooth enough not to.
                        x += 0.13 * k * (2 * hash(i, j, 1) - 1); y += 0.13 * k * (2 * hash(i, j, 2) - 1);
                        const wx = noise.noise2((x - cx) * 0.11 + 40, (y - cy) * 0.11);
                        const wy = noise.noise2((x - cx) * 0.11 - 17, (y - cy) * 0.11 + 23);
                        x += k * wx; y += k * wy;
                    }
                    IX[v] = i; IY[v] = j; X[v] = x; Y[v] = y;
                }
            }
            const turn = (x, y) => [(x - cx) * cyaw - (y - cy) * syaw, (x - cx) * syaw + (y - cy) * cyaw];
            // Heights are stretched to use the whole range over the ground that's in view, so
            // the terraces and colors all get used whatever else the lattice had to cover
            const height = relief(p, ctx, { N, M, cx, cy, S, rx, ry, fill }), h = new Float64Array(NL);
            let lo = Infinity, hi = -Infinity;
            for (let v = 0; v < NL; v++) {
                h[v] = height(X[v], Y[v], IX[v], IY[v]);
                if (fill) {
                    const g = turn(X[v], Y[v]), s = C.raw(g[0], g[1], zt);
                    if (ctx.shape.dist(mid[0] + s[0] * zoom, mid[1] + s[1] * zoom) < -zoom) continue;
                }
                lo = Math.min(lo, h[v]); hi = Math.max(hi, h[v]);
            }
            const steps = Math.round(p.terraces), city = p.terrain === 'city';
            for (let v = 0; v < NL; v++) {
                let t = hi > lo ? geo.clamp((h[v] - lo) / (hi - lo), 0, 1) : 0;
                if (p.sea > 0) t = Math.max(0, (t - p.sea) / (1 - p.sea));
                // buildings round up, or the low ones would all sink into the street
                if (steps > 0) t = (city ? Math.ceil(t * steps - 1e-9) : Math.min(steps, Math.floor(t * (steps + 1)))) / steps;
                Z[v] = t * top;
            }

            // ---- triangles. Cell corners are a, b, c, d going round, the diagonal is a-c (0) or b-d (1).
            const diag = new Uint8Array(N * M), flat = new Uint8Array(N * M);
            const NT = N * M * (cross ? 4 : 2);
            const TV = new Int32Array(NT * 3), TN = new Int32Array(NT * 3).fill(-1);
            for (let j = 0, cell = 0, t = 0; j < M; j++) {
                for (let i = 0; i < N; i++, cell++) {
                    const a = j * W + i, b = a + 1, d = a + W, c = d + 1, checker = (i - ox + j - oy) & 1;
                    flat[cell] = Z[a] === Z[b] && Z[b] === Z[c] && Z[c] === Z[d] ? 1 : 0;
                    if (p.pattern === 'zig') diag[cell] = (j - oy) & 1;
                    else if (p.pattern === 'diamond' || p.pattern === 'grid') diag[cell] = checker;
                    else if (p.pattern === 'random') diag[cell] = hash(i, j, 3) < 0.5 ? 1 : 0;
                    else if (p.pattern === 'slope') {
                        // the diagonal joining the two corners closest in height, so it runs along the slope
                        const u = Math.abs(Z[a] - Z[c]), w = Math.abs(Z[b] - Z[d]);
                        diag[cell] = u === w ? checker : u < w ? 0 : 1;
                    }
                    let tris;
                    if (cross) {
                        const m = NL + cell;
                        IX[m] = i + 0.5; IY[m] = j + 0.5;
                        X[m] = (X[a] + X[b] + X[c] + X[d]) / 4; Y[m] = (Y[a] + Y[b] + Y[c] + Y[d]) / 4;
                        Z[m] = (Z[a] + Z[b] + Z[c] + Z[d]) / 4;
                        tris = [a, b, m, b, c, m, c, d, m, d, a, m];
                    } else tris = diag[cell] ? [a, b, d, b, c, d] : [a, b, c, a, c, d];
                    TV.set(tris, t);
                    t += tris.length;
                }
            }

            // ---- edges, with the triangle on each side, and each triangle's neighbors
            const edges = new Map(), ET = new Int32Array(NT * 6).fill(-1), slot = new Int32Array(NT * 3);
            let NE = 0;
            for (let t = 0; t < NT; t++) {
                for (let k = 0; k < 3; k++) {
                    const a = TV[3 * t + k], b = TV[3 * t + (k + 1) % 3], key = a < b ? a * NV + b : b * NV + a;
                    const e = edges.get(key);
                    if (e === undefined) { edges.set(key, NE); ET[2 * NE] = t; slot[NE] = 3 * t + k; NE++; }
                    else { ET[2 * e + 1] = t; TN[3 * t + k] = ET[2 * e]; TN[slot[e]] = t; }
                }
            }
            const edge = (a, b) => edges.get(a < b ? a * NV + b : b * NV + a);

            // ---- threads: the lattice lines as lists of vertex pairs, so each is drawn in one go
            const threads = [];
            const thread = (fam, q) => {
                if (q.length) threads.push({ fam, q, ids: Array.from({ length: q.length / 2 }, (_, k) => edge(q[2 * k], q[2 * k + 1])) });
            };
            for (let j = 0; j <= M; j++) { const q = []; for (let i = 0; i < N; i++) q.push(j * W + i, j * W + i + 1); thread(ROW, q); }
            for (let i = 0; i <= N; i++) { const q = []; for (let j = 0; j < M; j++) q.push(j * W + i, (j + 1) * W + i); thread(COL, q); }
            const loose = threads.length;
            if (p.pattern !== 'grid') {
                const skip = cell => p.flats && flat[cell];
                for (let k = 1 - M; k < N; k++) {
                    const q = [];
                    for (let i = Math.max(0, k); i < N && i - k < M; i++) {
                        const j = i - k, cell = j * N + i, a = j * W + i, c = a + W + 1;
                        if (skip(cell)) continue;
                        if (cross) q.push(a, NL + cell, NL + cell, c); else if (!diag[cell]) q.push(a, c);
                    }
                    thread(DIAG, q);
                }
                for (let k = 0; k < N + M - 1; k++) {
                    const q = [];
                    for (let i = Math.min(N - 1, k); i >= 0 && k - i < M; i--) {
                        const j = k - i, cell = j * N + i, b = j * W + i + 1, d = b + W - 1;
                        if (skip(cell)) continue;
                        if (cross) q.push(b, NL + cell, NL + cell, d); else if (diag[cell]) q.push(b, d);
                    }
                    thread(ANTI, q);
                }
            }

            // ---- turn the lattice to face the eye. A page-filling mesh is placed already,
            // a tile is fitted once it's known which edges are left.
            for (let v = 0; v < NV; v++) { const g = turn(X[v], Y[v]); X[v] = g[0]; Y[v] = g[1]; }
            let mx = 0, my = 0;
            const page = q => {
                const s = C.raw(q[0], q[1], q[2]);
                return [mid[0] + (s[0] - mx) * zoom, mid[1] + (s[1] - my) * zoom];
            };
            const point = v => [X[v], Y[v], Z[v]];
            const PX = new Float64Array(NV), PY = new Float64Array(NV);
            const place = () => { for (let v = 0; v < NV; v++) { const q = page(point(v)); PX[v] = q[0]; PY[v] = q[1]; } };
            // mm inside the visible area, negative outside
            const inside = new Float32Array(NV);
            if (fill) { place(); for (let v = 0; v < NV; v++) inside[v] = ctx.shape.dist(PX[v], PY[v]); }

            // ---- fraying: which triangles are still there. Each stretch of the edge about a
            // cell long is torn back by its own amount, mostly a little, and a slow noise on
            // top takes bigger bites.
            const solid = new Uint8Array(NT).fill(1);
            const F = p.fray * Math.min(7, 0.16 * S);
            // its own stream, so the terrain stays the same when the fraying changes
            const frng = new PG.RNG(ctx.seed + 104729);
            const torn = len => Float32Array.from({ length: len }, () => Math.pow(frng.random(), 1.7));
            const bite = (s, tear) => 0.3 * (0.5 + 0.5 * noise.noise2(s * 0.21 + 70, -30)) + 0.7 * tear[Math.floor(s)];
            if (F > 0 && fill) {
                // triangles have to be all the way inside the visible area, so nothing is cut by the margin
                const starts = [];
                let total = 0;
                region.forEach((a, i) => { starts.push(total); total += geo.dist(a, region[(i + 1) % region.length]); });
                const tear = torn(Math.ceil(total / zoom) + 2);
                // how far round the outline the point nearest to (x, y) is, in cells
                const along = (x, y) => {
                    let best = Infinity, s = 0;
                    region.forEach((a, i) => {
                        const b = region[(i + 1) % region.length], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1;
                        const d = Math.abs((x - a[0]) * ey - (y - a[1]) * ex) / len;
                        if (d < best) { best = d; s = starts[i] + geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / len, 0, len); }
                    });
                    return s / zoom;
                };
                for (let t = 0; t < NT; t++) {
                    const a = TV[3 * t], b = TV[3 * t + 1], c = TV[3 * t + 2];
                    const d = Math.min(inside[a], inside[b], inside[c]) / zoom;
                    if (d <= 0) solid[t] = 0;
                    else if (d < F && d < F * bite(along((PX[a] + PX[b] + PX[c]) / 3, (PY[a] + PY[b] + PY[c]) / 3), tear)) solid[t] = 0;
                }
            } else if (F > 0) {
                // the four sides, one after the other
                const tear = torn(2 * (N + M) + 4);
                for (let t = 0; t < NT; t++) {
                    const x = (IX[TV[3 * t]] + IX[TV[3 * t + 1]] + IX[TV[3 * t + 2]]) / 3;
                    const y = (IY[TV[3 * t]] + IY[TV[3 * t + 1]] + IY[TV[3 * t + 2]]) / 3;
                    const dx = Math.min(x, N - x), dy = Math.min(y, M - y);
                    const s = dx < dy ? (x < N / 2 ? y : M + N + 2 + y) : (y < M / 2 ? M + 1 + x : 2 * M + N + 3 + x);
                    if (Math.min(dx, dy) < F * bite(s, tear)) solid[t] = 0;
                }
            }
            // the part of each edge that's drawn, from E0 to E1 along its thread
            const E0 = new Float32Array(NE), E1 = new Float32Array(NE);
            for (let e = 0; e < NE; e++) if (solid[ET[2 * e]] || (ET[2 * e + 1] >= 0 && solid[ET[2 * e + 1]])) E1[e] = 1;

            // Loose ends: where a row or column runs out of mesh it carries on alone for
            // up to a few cells, usually stopping partway along one
            if (F > 0) {
                for (let th = 0; th < loose; th++) {
                    const { ids, q } = threads[th], len = ids.length, had = ids.map(e => E1[e] > 0);
                    const trail = (k, dir) => {
                        if (!frng.chance(0.8)) return;
                        for (let left = p.fray * frng.range(0.3, 2.8); left > 0.15 && k >= 0 && k < len && !had[k]; k += dir, left--) {
                            if (fill && inside[q[2 * k + (dir > 0 ? 1 : 0)]] < 0.5) break; // would run off the page
                            const e = ids[k], f = Math.min(1, left);
                            if (E1[e] > E0[e]) { E0[e] = 0; E1[e] = 1; } // met the end coming the other way
                            else if (dir > 0) E1[e] = f;
                            else { E0[e] = 1 - f; E1[e] = 1; }
                        }
                    };
                    for (let k = 0; k < len; k++) {
                        if (!had[k]) continue;
                        if (k > 0 && !had[k - 1]) trail(k - 1, -1);
                        if (k < len - 1 && !had[k + 1]) trail(k + 1, 1);
                    }
                }
            }

            const used = new Uint8Array(NV);
            for (const th of threads) {
                th.ids.forEach((e, k) => {
                    const u = th.q[2 * k], v = th.q[2 * k + 1];
                    // A clean page-filling mesh runs off the page and gets cut by the margin. Edges
                    // further out than they are long can't reach back in, so they're skipped.
                    if (fill && E1[e] > 0 && Math.max(inside[u], inside[v]) < -Math.hypot(PX[u] - PX[v], PY[u] - PY[v])) E1[e] = 0;
                    if (E1[e] > E0[e]) used[u] = used[v] = 1;
                });
            }
            if (!fill) {
                // Grow the tile about its middle until it touches a side of the visible area. This
                // also fits the circle, hexagon and diamond crops, and the page when it's rotated.
                const pts = [];
                for (let v = 0; v < NV; v++) if (used[v]) pts.push(C.raw(X[v], Y[v], Z[v]));
                if (!pts.length) return [];
                const bb = geo.bbox([pts]), bx = (bb.minX + bb.maxX) / 2, by = (bb.minY + bb.maxY) / 2;
                zoom = Infinity;
                region.forEach((a, i) => {
                    const b = region[(i + 1) % region.length];
                    let nx = a[1] - b[1], ny = b[0] - a[0];
                    const len = Math.hypot(nx, ny);
                    if (len < 1e-9) return;
                    let room = ((a[0] - mid[0]) * nx + (a[1] - mid[1]) * ny) / len;
                    if (room < 0) { room = -room; nx = -nx; ny = -ny; }
                    let reach = 0;
                    for (const s of pts) reach = Math.max(reach, ((s[0] - bx) * nx + (s[1] - by) * ny) / len);
                    if (reach > 0) zoom = Math.min(zoom, room / reach);
                });
                if (!isFinite(zoom)) zoom = 1;
                mx = bx; my = by;
                place();
            }

            // ---- hidden lines
            // Sight lines are tipped a hair to the side so they never run exactly along a line of vertices
            const ex = 1e-3, ey = -D * cp, ez = zt + D * sp;
            const third = (t, a, b) => { const k = 3 * t; return TV[k] !== a && TV[k] !== b ? TV[k] : TV[k + 1] !== a && TV[k + 1] !== b ? TV[k + 1] : TV[k + 2]; };
            const maxSteps = 8 * (N + M) + 64;
            // Can the eye see the point (px, py, pz) on the edge a-b, which has triangles t1 and t2 on its sides?
            const seen = (px, py, pz, a, b, t1, t2) => {
                let dx, dy, dz, far;
                if (D) { dx = ex - px; dy = ey - py; dz = ez - pz; far = Math.min(1, (top - pz) / dz); }
                else { dx = 1e-4 * cp; dy = -cp; dz = sp; far = (top - pz) / dz; }
                const dd = dx * dx + dy * dy;
                if (far <= 0 || dd < 1e-12) return true;
                // start in the triangle on the side the sight line leaves by
                const abx = X[b] - X[a], aby = Y[b] - Y[a], side = abx * dy - aby * dx > 0;
                let T = -1, c = -1;
                for (const t of [t1, t2]) {
                    if (t < 0) continue;
                    const k = third(t, a, b);
                    if ((abx * (Y[k] - Y[a]) - aby * (X[k] - X[a]) > 0) === side) { T = t; c = k; }
                }
                if (T < 0) return true;
                // l and r are the ends of the edge the line crosses next, left and right of it
                const off = v => dx * (Y[v] - py) - dy * (X[v] - px);
                let l = a, r = b, fl = off(a), fr = off(b);
                if (fl < 0) { l = b; r = a; const f = fl; fl = fr; fr = f; }
                let fc = off(c);
                if (fc >= 0) { l = c; fl = fc; } else { r = c; fr = fc; }
                for (let step = 0; step < maxSteps; step++) {
                    const den = fl - fr, u = den > 0 ? fl / den : 0.5;
                    const qx = X[l] + (X[r] - X[l]) * u, qy = Y[l] + (Y[r] - Y[l]) * u;
                    const s = ((qx - px) * dx + (qy - py) * dy) / dd;
                    if (s >= far) return true;
                    let next = -1;
                    for (let k = 3 * T, e = 0; e < 3; e++) {
                        const v = TV[k + e], w = TV[k + (e + 1) % 3];
                        if ((v === l && w === r) || (v === r && w === l)) { next = TN[k + e]; break; }
                    }
                    if ((solid[T] || (next >= 0 && solid[next])) && pz + s * dz < Z[l] + (Z[r] - Z[l]) * u - 1e-9) return false;
                    if (next < 0) return true;
                    c = third(next, l, r);
                    fc = off(c);
                    if (fc >= 0) { l = c; fl = fc; } else { r = c; fr = fc; }
                    T = next;
                }
                return true;
            };
            // Visible stretches of the edge u-v between r0 and r1, sampled about every mm
            // with the ends of each stretch found by bisection
            const visible = (u, v, e, r0, r1, mm) => {
                if (!p.solid) return [[r0, r1]];
                const ax = X[u], ay = Y[u], az = Z[u], bx = X[v] - ax, by = Y[v] - ay, bz = Z[v] - az;
                const t1 = ET[2 * e], t2 = ET[2 * e + 1];
                // not at the vertex itself, where the edge has no sides to start from
                const see = t => { t = geo.clamp(t, 1e-4, 1 - 1e-4); return seen(ax + bx * t, ay + by * t, az + bz * t, u, v, t1, t2); };
                const count = geo.clamp(Math.ceil(mm * (r1 - r0)), 1, 24), out = [];
                let t0 = r0, was = see(r0), start = r0;
                for (let k = 1; k <= count; k++) {
                    const t = r0 + (r1 - r0) * k / count, now = see(t);
                    if (now !== was) {
                        let a = t0, b = t;
                        for (let i = 0; i < 8; i++) { const half = (a + b) / 2; if (see(half) === was) a = half; else b = half; }
                        if (was) out.push([start, (a + b) / 2]); else start = (a + b) / 2;
                        was = now;
                    }
                    t0 = t;
                }
                if (was) out.push([start, r1]);
                return out;
            };

            // ---- pens
            const pens = PG.pens.count(p.pens), layers = PG.pens.layers(pens);
            const slots = PG.pens.slots({ id: 'wireframe' }, p);
            const ramp = slots.map((s, i) => i).sort((a, b) => RAMP.indexOf(slots[a]) - RAMP.indexOf(slots[b]));
            const byDepth = p.penMode === 'depth', byFamily = p.penMode === 'direction';
            const value = byDepth ? q => q[1] * cp - q[2] * sp : q => q[2];
            let v0 = Infinity, v1 = -Infinity;
            for (let v = 0; v < NV; v++) {
                if (!used[v] || (fill && inside[v] < 0)) continue;
                const t = value(point(v));
                v0 = Math.min(v0, t); v1 = Math.max(v1, t);
            }
            const span = v1 - v0 || 1;
            const fams = [...new Set(threads.map(th => th.fam))];
            // Split a run of 3D points where it crosses from one band into the next. Ground
            // sitting exactly on a band edge goes with the band below, cliff and all.
            const emit = (run, fam) => {
                let first = 0, count = pens, layer = b => ramp[byDepth ? count - 1 - b : b];
                if (byFamily) {
                    // each direction gets its share of the pens, split by height if it has several
                    const f = fams.indexOf(fam), nf = fams.length;
                    first = pens > nf ? Math.floor(f * pens / nf) : f % pens;
                    count = pens > nf ? Math.floor((f + 1) * pens / nf) - first : 1;
                    layer = b => first + b;
                }
                if (count === 1) { layers[layer(0)].push(run.map(page)); return; }
                let cur = [page(run[0])], pen = -1;
                for (let i = 1; i < run.length; i++) {
                    const a = run[i - 1], b = run[i];
                    const ta = (value(a) - v0) / span * count, tb = (value(b) - v0) / span * count;
                    const tlo = Math.min(ta, tb), thi = Math.max(ta, tb), cuts = [0];
                    for (let c = Math.floor(tlo) + 1; c < thi; c++) if (c - tlo > 1e-7 && thi - c > 1e-7) cuts.push((c - ta) / (tb - ta));
                    if (tb < ta) cuts.sort((s, t) => s - t);
                    cuts.push(1);
                    for (let k = 1; k < cuts.length; k++) {
                        const s0 = cuts[k - 1], s1 = cuts[k];
                        const band = geo.clamp(Math.ceil(ta + (tb - ta) * (s0 + s1) / 2 - 1e-7) - 1, 0, count - 1);
                        if (band !== pen) {
                            if (cur.length > 1) layers[layer(pen)].push(cur);
                            cur = [page(s0 === 0 ? a : lerp3(a, b, s0))];
                            pen = band;
                        }
                        cur.push(page(s1 === 1 ? b : lerp3(a, b, s1)));
                    }
                }
                if (cur.length > 1) layers[layer(pen)].push(cur);
            };

            // ---- draw each thread, joining the visible stretches that meet at a vertex
            for (const th of threads) {
                let run = null, last = -1;
                // a stretch under 0.2 mm would only be a dot
                const flush = () => { if (run && geo.pathLength(run.map(page)) >= 0.2) emit(run, th.fam); run = null; };
                th.ids.forEach((e, k) => {
                    if (!(E1[e] > E0[e])) return;
                    const u = th.q[2 * k], v = th.q[2 * k + 1], a = point(u), b = point(v);
                    const at = t => (t === 0 ? a : t === 1 ? b : lerp3(a, b, t));
                    for (const [t0, t1] of visible(u, v, e, E0[e], E1[e], Math.hypot(PX[u] - PX[v], PY[u] - PY[v]))) {
                        if (!(run && last === u && t0 === 0)) { flush(); run = [at(t0)]; }
                        run.push(at(t1));
                        last = t1 === 1 ? v : -1;
                    }
                });
                flush();
            }
            return { layers };
        },
    });

    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    // The terrain as a function of where a vertex is on the ground (x, y) and in the
    // lattice (i, j), all in cells. G has the lattice size N x M, the point the view is
    // aimed at (cx, cy), the size S that features are relative to, and how far the
    // ground in view reaches from that point (rx, ry). Any range of heights will do.
    function relief(p, ctx, G) {
        const { rng, noise } = ctx, { N, M, cx, cy, S } = G;
        if (p.terrain === 'city') return city(p, rng, G);
        const f = 1 / (p.scale * S);
        // octaves finer than about 3 cells only show up as spikes
        const oct = geo.clamp(Math.floor(Math.log2(p.scale * S / 3)) + 1, 1, 5), gain = 0.3 + 0.35 * p.rough;
        const fbm = (x, y) => noise.fbm2(x, y, oct, 2, gain);
        // Ridged multifractal (Musgrave), 0 to 1 with sharp crests
        const ridged = (x, y) => {
            let sum = 0, amp = 1, fr = 1, norm = 0, prev = 1;
            for (let o = 0; o < oct; o++) {
                let v = 1 - Math.abs(noise.noise2(x * fr + o * 17.31, y * fr - o * 9.73));
                v *= v;
                sum += v * amp * prev; norm += amp; prev = v; amp *= gain; fr *= 2;
            }
            return sum / norm;
        };

        if (p.terrain === 'craters') {
            // A few big craters and a lot of small ones, each a flat floor inside a raised rim.
            // A page-filling mesh scatters them over a fixed patch of ground, so tilting or
            // turning the view doesn't move them.
            const ex = G.fill ? 2.2 * S : 0.55 * N, ey = G.fill ? 2.2 * S : 0.55 * M, big = p.scale * S * 0.36;
            let list = [];
            for (let k = geo.clamp(Math.round(16 * ex * ey / (p.scale * p.scale * S * S)), 4, 900); k > 0; k--) {
                const r = Math.max(2, big * Math.pow(rng.range(0.25, 1), 1.5));
                list.push({ x: cx + rng.range(-ex, ex), y: cy + rng.range(-ey, ey), r, a: Math.pow(r / big, 0.6), peak: r > big * 0.45 && rng.chance(0.6) });
            }
            list = list.filter(c => c.x > -2 * c.r && c.x < N + 2 * c.r && c.y > -2 * c.r && c.y < M + 2 * c.r);
            return (x, y) => {
                let z = 0.5 * fbm((x - cx) * f * 0.7, (y - cy) * f * 0.7);
                for (const c of list) {
                    const d = Math.hypot(x - c.x, y - c.y) / c.r;
                    if (d > 2) continue;
                    const rim = 0.34 * Math.exp(-Math.pow((d - 1) / 0.2, 2));
                    const bowl = d < 1 ? -0.7 * (1 - geo.smoothstep(0.45, 1, d)) : 0;
                    z += c.a * (rim + bowl + (c.peak ? 0.4 * Math.exp(-Math.pow(d / 0.17, 2)) : 0));
                }
                return z;
            };
        }
        if (p.terrain === 'ripples') {
            // rings spreading from one to three drops and running into each other
            const drops = [];
            for (let k = rng.weighted([[5, 1], [3, 2], [2, 3]]), i = 0; i < k; i++) {
                const reach = i ? 0.8 : 0.3;
                drops.push({ x: cx + G.rx * rng.range(-reach, reach), y: cy + G.ry * rng.range(-reach, reach),
                    len: p.scale * S * 0.5 * rng.range(0.8, 1.2), phase: rng.chance(0.5) ? 0 : Math.PI, a: i ? rng.range(0.5, 0.9) : 1 });
            }
            return (x, y) => {
                let z = 0;
                for (const c of drops) {
                    const d = Math.hypot(x - c.x, y - c.y);
                    z += c.a * Math.cos(TAU * d / c.len - c.phase) * Math.exp(-d / (0.75 * S));
                }
                return z;
            };
        }
        return (x, y) => {
            const u = (x - cx) * f, v = (y - cy) * f;
            // a slow warp bends the noise into less blobby landforms
            const wx = noise.fbm2(u * 0.6 + 3.1, v * 0.6 - 7.7, 2), wy = noise.fbm2(u * 0.6 - 5.2, v * 0.6 + 1.3, 2);
            if (p.terrain === 'peaks') return ridged(u * 0.8 + 0.25 * wx, v * 0.8 + 0.25 * wy);
            if (p.terrain === 'island') {
                // a massif in the middle that sinks into flat sea before the edge of the view
                const r = Math.hypot((x - cx) / G.rx, (y - cy) / G.ry) + 0.18 * wx;
                return Math.max(0, (0.3 + 0.7 * ridged(u + 0.3 * wx + 5, v + 0.3 * wy - 8)) * (1 - geo.smoothstep(0.25, 1.15, r)) - 0.06);
            }
            if (p.terrain === 'canyon') {
                // canyons run along the lines where the noise crosses zero, the plateau is everything else
                const n = fbm(u * 0.8 + 0.5 * wx, v * 0.8 + 0.5 * wy);
                return geo.smoothstep(0.02, 0.4, Math.abs(n)) * (0.82 + 0.18 * noise.noise2(u * 0.5 + 9, v * 0.5 - 4));
            }
            return fbm(u + 0.35 * wx, v + 0.35 * wy);
        };
    }

    // City blocks. The ground is cut into rectangles with streets between them, working in
    // whole vertices so every wall is one cell wide. A tile is cut up on its own with the
    // border left at street level. A page-filling mesh looks at part of a fixed city three
    // mesh widths out each way, so tilting or turning the view doesn't rebuild it.
    function city(p, rng, G) {
        const { N, M, cx, cy, S } = G, W = N + 1, h = new Float64Array(W * (M + 1));
        const big = Math.max(3, Math.round(p.scale * S * 0.42)), small = 2, R = 3 * S;
        const blocks = [];
        (function cut(x0, y0, x1, y1) {
            const wide = x1 - x0 >= y1 - y0, len = wide ? x1 - x0 : y1 - y0;
            // long cuts are avenues with a flat roadway, short ones are alleys
            const gap = len > big * 1.5 && rng.chance(0.6) ? 2 : 1, room = len - gap - 1 - 2 * small;
            if (room < 0 || (len <= big && rng.chance(0.5))) { blocks.push([x0, y0, x1, y1]); return; }
            const s = (wide ? x0 : y0) + small + Math.round(room * rng.range(0.2, 0.8));
            if (wide) { cut(x0, y0, s, y1); cut(s + gap + 1, y0, x1, y1); }
            else { cut(x0, y0, x1, s); cut(x0, s + gap + 1, x1, y1); }
        })(...(G.fill ? [cx - R, cy - R, cx + R, cy + R] : [1, 1, N - 1, M - 1]));

        const fill = (x0, y0, x1, y1, z) => {
            for (let j = Math.max(0, y0); j <= Math.min(M, y1); j++) for (let i = Math.max(0, x0); i <= Math.min(N, x1); i++) h[j * W + i] = z;
        };
        // towers get taller towards downtown
        const dx = cx + S * rng.range(-0.2, 0.2), dy = cy + S * rng.range(-0.3, 0.3);
        for (const [x0, y0, x1, y1] of blocks) {
            const open = rng.chance(0.1), tall = rng.range(0.45, 1), tower = rng.chance(0.45), lift = rng.range(1.15, 1.45);
            const ix = rng.range(0, 1), iy = rng.range(0, 1);
            if (open) continue; // a square
            const near = 1 - Math.min(1, Math.hypot((x0 + x1) / 2 - dx, (y0 + y1) / 2 - dy) / (1.4 * S));
            const z = (0.3 + 0.7 * Math.pow(near, 1.5)) * tall;
            fill(x0, y0, x1, y1, z);
            // a tower set back on its podium
            if (tower && x1 - x0 >= 4 && y1 - y0 >= 4) {
                const sx = 1 + Math.floor(ix * Math.floor((x1 - x0 - 2) / 2)), sy = 1 + Math.floor(iy * Math.floor((y1 - y0 - 2) / 2));
                fill(x0 + sx, y0 + sy, x1 - sx, y1 - sy, z * lift);
            }
        }
        return (x, y, i, j) => h[j * W + i];
    }
})();
