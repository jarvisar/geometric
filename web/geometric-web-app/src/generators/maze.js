/*
 * Perfect mazes (spanning trees of a cell graph) on a rectangular grid or a
 * circular "theta" grid whose rings double their cell count as the
 * circumference grows. Algorithms (see Jamis Buck, "Mazes for Programmers"):
 *  - recursive backtracker: iterative depth-first carving, long winding corridors
 *  - Prim: random frontier growth, many short dead ends
 *  - Kruskal: random edge order with union–find, evenly textured
 *  - Wilson: loop-erased random walks, an unbiased uniform spanning tree
 * Walls are emitted as maximal runs (collinear grid walls, whole ring arcs,
 * radial lines spanning several rings) so the plotter draws long strokes; the
 * outer wall is one stroke per side of the openings. The BFS solution goes on
 * pen 2, rounded through the cell centres.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Carve a spanning tree. nbrs[c] = [[d, kind], ...]; weight(kind) biases choices.
    function carve(N, nbrs, algo, weight, rng, start) {
        const pass = new Set();
        const key = (a, b) => (a < b ? a * N + b : b * N + a);
        const link = (a, b) => pass.add(key(a, b));
        const pickW = list => {
            let tot = 0;
            for (const e of list) tot += weight(e[1]);
            let r = rng.random() * tot;
            for (const e of list) if ((r -= weight(e[1])) <= 0) return e;
            return list[list.length - 1];
        };
        if (algo === 'kruskal') {
            const edges = [];
            for (let a = 0; a < N; a++) for (const [b, kind] of nbrs[a]) if (a < b) edges.push([-Math.log(1 - rng.random()) / weight(kind), a, b]);
            edges.sort((x, y) => x[0] - y[0]);
            const parent = new Int32Array(N).map((_, i) => i);
            const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
            for (const [, a, b] of edges) {
                const ra = find(a), rb = find(b);
                if (ra !== rb) { parent[ra] = rb; link(a, b); }
            }
        } else if (algo === 'prim') {
            const inTree = new Uint8Array(N), inFront = new Uint8Array(N);
            const front = [];
            const grow = c => {
                inTree[c] = 1;
                for (const [d] of nbrs[c]) if (!inTree[d] && !inFront[d]) { inFront[d] = 1; front.push(d); }
            };
            grow(start);
            while (front.length) {
                const i = Math.floor(rng.random() * front.length);
                const f = front[i];
                front[i] = front[front.length - 1];
                front.pop();
                const e = pickW(nbrs[f].filter(x => inTree[x[0]]));
                link(f, e[0]);
                grow(f);
            }
        } else if (algo === 'wilson') {
            const inTree = new Uint8Array(N), next = new Int32Array(N);
            inTree[start] = 1;
            const order = rng.shuffle(Array.from({ length: N }, (_, i) => i));
            for (const s of order) {
                if (inTree[s]) continue;
                let c = s;
                while (!inTree[c]) { next[c] = pickW(nbrs[c])[0]; c = next[c]; }
                for (c = s; !inTree[c]; c = next[c]) { inTree[c] = 1; link(c, next[c]); }
            }
        } else {
            const seen = new Uint8Array(N);
            const stack = [start];
            seen[start] = 1;
            while (stack.length) {
                const c = stack[stack.length - 1];
                const open = nbrs[c].filter(x => !seen[x[0]]);
                if (!open.length) { stack.pop(); continue; }
                const [d] = pickW(open);
                link(c, d);
                seen[d] = 1;
                stack.push(d);
            }
        }
        return { has: (a, b) => pass.has(key(a, b)) };
    }

    // Breadth-first path from a to b through passages.
    function solve(N, nbrs, maze, a, b) {
        const prev = new Int32Array(N).fill(-1);
        prev[a] = a;
        const queue = [a];
        for (let qi = 0; qi < queue.length && prev[b] < 0; qi++) {
            const c = queue[qi];
            for (const [d] of nbrs[c]) if (prev[d] < 0 && maze.has(c, d)) { prev[d] = c; queue.push(d); }
        }
        const path = [];
        if (prev[b] < 0) return path;
        for (let c = b; ; c = prev[c]) { path.push(c); if (c === a) break; }
        return path.reverse();
    }

    // Join consecutive truthy flags into [start, end) index runs.
    function runs(flags) {
        const out = [];
        let s = -1;
        for (let i = 0; i <= flags.length; i++) {
            if (i < flags.length && flags[i]) { if (s < 0) s = i; } else if (s >= 0) { out.push([s, i]); s = -1; }
        }
        return out;
    }

    function rectMaze(p, ctx) {
        const { width: W, height: H, rng } = ctx;
        let c = Math.min(p.cell, W / 2, H / 2); // at least 2 Ã— 2 cells, all inside the area
        let cols = Math.max(2, Math.floor(W / c)), rows = Math.max(2, Math.floor(H / c));
        if (cols * rows > 60000) { c *= Math.sqrt((cols * rows) / 60000); cols = Math.floor(W / c); rows = Math.floor(H / c); }
        const ox = (W - cols * c) / 2, oy = (H - rows * c) / 2;
        const N = cols * rows, id = (i, j) => j * cols + i;
        const nbrs = Array.from({ length: N }, () => []);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            if (i + 1 < cols) { nbrs[id(i, j)].push([id(i + 1, j), 0]); nbrs[id(i + 1, j)].push([id(i, j), 0]); }
            if (j + 1 < rows) { nbrs[id(i, j)].push([id(i, j + 1), 1]); nbrs[id(i, j + 1)].push([id(i, j), 1]); }
        }
        const b = geo.clamp(p.bias, -0.95, 0.95);
        const maze = carve(N, nbrs, p.algorithm, k => (k ? 1 - b : 1 + b), rng, id(rng.int(0, cols - 1), rng.int(0, rows - 1)));

        const walls = [];
        for (let j = 1; j < rows; j++) {
            const y = oy + j * c;
            const f = [];
            for (let i = 0; i < cols; i++) f.push(!maze.has(id(i, j - 1), id(i, j)));
            for (const [s, e] of runs(f)) walls.push([[ox + s * c, y], [ox + e * c, y]]);
        }
        for (let i = 1; i < cols; i++) {
            const x = ox + i * c;
            const f = [];
            for (let j = 0; j < rows; j++) f.push(!maze.has(id(i - 1, j), id(i, j)));
            for (const [s, e] of runs(f)) walls.push([[x, oy + s * c], [x, oy + e * c]]);
        }
        // outer wall: entrance in the top wall near the left, exit in the bottom wall near the right
        const q = Math.max(0, Math.floor(cols / 4) - 1);
        const inCol = rng.int(0, q), outCol = cols - 1 - rng.int(0, q);
        const x0 = ox, x1 = ox + cols * c, y0 = oy, y1 = oy + rows * c;
        walls.push([[ox + (inCol + 1) * c, y0], [x1, y0], [x1, y1], [ox + (outCol + 1) * c, y1]]);
        walls.push([[ox + outCol * c, y1], [x0, y1], [x0, y0], [ox + inCol * c, y0]]);

        if (!p.solution) return walls;
        const cells = solve(N, nbrs, maze, id(inCol, 0), id(outCol, rows - 1));
        const path = [[ox + (inCol + 0.5) * c, y0 - c / 2]];
        for (const k of cells) path.push([ox + ((k % cols) + 0.5) * c, oy + (Math.floor(k / cols) + 0.5) * c]);
        path.push([ox + (outCol + 0.5) * c, y1 + c / 2]);
        return { layers: [walls, [geo.roundCorners(path, p.round, 8)]] };
    }

    function thetaMaze(p, ctx) {
        const { width: W, height: H, rng } = ctx;
        // largest circle about the centre inside the clip shape (rotation enlarges W × H)
        const R = Math.min(W / 2, H / 2, ctx.shape ? Math.max(1, ctx.shape.dist(W / 2, H / 2)) : Infinity);
        const c = Math.min(Math.max(p.cell, R / 120), R / 2); // at least 2 rings, all inside the circle
        const rings = Math.max(2, Math.floor(R / c));
        const cx = W / 2, cy = H / 2;
        // cells per ring: 1 in the centre, 6 in ring 1, doubling when cells get wider than √2·c
        const n = [1, 6];
        for (let i = 2; i < rings; i++) n.push((TAU * (i + 0.5)) / n[i - 1] > Math.SQRT2 ? n[i - 1] * 2 : n[i - 1]);
        const base = [0];
        for (let i = 1; i < rings; i++) base.push(base[i - 1] + n[i - 1]);
        const N = base[rings - 1] + n[rings - 1];
        const id = (i, k) => base[i] + (((k % n[i]) + n[i]) % n[i]);
        const a0 = -Math.PI / 2 - Math.PI / n[rings - 1]; // outer cell 0 centred at the top
        const ang = (i, k) => a0 + (TAU * k) / n[i];

        const nbrs = Array.from({ length: N }, () => []);
        const add = (a, b, kind) => { nbrs[a].push([b, kind]); nbrs[b].push([a, kind]); };
        for (let i = 1; i < rings; i++) {
            for (let k = 0; k < n[i]; k++) {
                if (n[i] > 1) add(id(i, k), id(i, k + 1), 0);
                add(id(i, k), i === 1 ? 0 : id(i - 1, Math.floor((k * n[i - 1]) / n[i])), 1);
            }
        }
        const b = geo.clamp(p.bias, -0.95, 0.95);
        const maze = carve(N, nbrs, p.algorithm, k => (k ? 1 - b : 1 + b), rng, rng.int(0, N - 1));

        const walls = [];
        const arc = (r, t0, t1) => geo.arc(cx, cy, r, t0, t1);
        // ring arcs (inner wall of every cell in ring i), joined around the ring
        for (let i = 1; i < rings; i++) {
            const f = [];
            for (let k = 0; k < n[i]; k++) f.push(!maze.has(id(i, k), i === 1 ? 0 : id(i - 1, Math.floor((k * n[i - 1]) / n[i]))));
            const rs = runs(f);
            if (rs.length === 1 && rs[0][0] === 0 && rs[0][1] === n[i]) { walls.push(geo.circle(cx, cy, i * c, 0, a0)); continue; }
            if (rs.length > 1 && rs[0][0] === 0 && rs[rs.length - 1][1] === n[i]) {
                const last = rs.pop();
                rs[0] = [last[0] - n[i], rs[0][1]]; // wraps past angle a0
            }
            for (const [s, e] of rs) walls.push(arc(i * c, ang(i, s), ang(i, e)));
        }
        // radial walls, grouped by angle so walls in consecutive rings become one line
        const M = n[rings - 1];
        const radial = new Map();
        for (let i = 1; i < rings; i++) {
            if (n[i] < 2) continue;
            for (let k = 0; k < n[i]; k++) {
                if (maze.has(id(i, k), id(i, k + 1))) continue;
                const a = (((k + 1) * M) / n[i]) % M;
                (radial.get(a) || radial.set(a, []).get(a)).push(i);
            }
        }
        for (const [a, list] of radial) {
            list.sort((x, y) => x - y);
            const t = a0 + (TAU * a) / M, ux = Math.cos(t), uy = Math.sin(t);
            for (let s = 0; s < list.length;) {
                let e = s;
                while (e + 1 < list.length && list[e + 1] === list[e] + 1) e++;
                const r0 = list[s] * c, r1 = (list[e] + 1) * c;
                walls.push([[cx + ux * r0, cy + uy * r0], [cx + ux * r1, cy + uy * r1]]);
                s = e + 1;
            }
        }
        // outer wall with the entrance (outer cell 0) left open
        const Ro = rings * c;
        walls.push(arc(Ro, ang(rings - 1, 1), ang(rings - 1, 0) + TAU));

        if (!p.solution) return walls;
        const cells = solve(N, nbrs, maze, id(rings - 1, 0), 0);
        // polyline in (angle, radius) with a corner wherever it turns, then rounded
        const ringOf = k => { let i = rings - 1; while (base[i] > k) i--; return i; };
        const mid = k => { const i = ringOf(k); return [a0 + (TAU * (k - base[i] + 0.5)) / n[i], i ? (i + 0.5) * c : 0]; };
        let [ta] = mid(cells[0]);
        const poly = [[ta, Ro + c / 2], [ta, (rings - 0.5) * c]];
        for (let s = 1; s < cells.length; s++) {
            const A = ringOf(cells[s - 1]), B = ringOf(cells[s]);
            const [tb, rb] = mid(cells[s]);
            let d = tb - ta;
            d -= TAU * Math.round(d / TAU); // shortest way round, angle kept continuous
            const ra = poly[poly.length - 1][1];
            if (B === 0) poly.push([ta, 0]);
            else if (B === A) poly.push([ta + d, rb]);
            else if (B > A) poly.push([ta + d, ra], [ta + d, rb]);
            else poly.push([ta, rb], [ta + d, rb]);
            ta += d;
        }
        const clean = [poly[0]];
        for (const q of poly) { const l = clean[clean.length - 1]; if (Math.abs(q[0] - l[0]) > 1e-9 || Math.abs(q[1] - l[1]) > 1e-9) clean.push(q); }
        const rounded = geo.roundCorners(clean, p.round, 8);
        const path = [];
        for (let s = 1; s < rounded.length; s++) {
            const [t0, r0] = rounded[s - 1], [t1, r1] = rounded[s];
            const steps = Math.max(1, Math.ceil(Math.max(Math.abs(r1 - r0), Math.max(r0, r1) * Math.abs(t1 - t0)) / 0.4));
            for (let u = s === 1 ? 0 : 1; u <= steps; u++) {
                const t = t0 + ((t1 - t0) * u) / steps, r = r0 + ((r1 - r0) * u) / steps;
                path.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
            }
        }
        return { layers: [walls, [path]] };
    }

    PG.register({
        id: 'maze',
        name: 'Maze',
        category: 'Tiles',
        description: 'Perfect mazes on a grid or in concentric rings, with the solution on a second pen.',
        fit: false,
        params: [
            { type: 'section', label: 'Maze' },
            { id: 'shape', label: 'Shape', type: 'select', value: 'rect', random: ['rect', 'circle'],
                options: [['rect', 'Rectangular grid'], ['circle', 'Circular (theta)']] },
            { id: 'cell', label: 'Cell size (mm)', type: 'range', min: 2, max: 30, step: 0.5, value: 6, random: [3.5, 10] },
            { id: 'algorithm', label: 'Algorithm', type: 'select', value: 'backtracker', random: ['backtracker', 'backtracker', 'prim', 'kruskal', 'wilson'],
                options: [['backtracker', 'Recursive backtracker'], ['prim', "Prim's"], ['kruskal', "Kruskal's"], ['wilson', "Wilson's (uniform)"]] },
            { id: 'bias', label: 'Direction bias', type: 'range', min: -0.9, max: 0.9, step: 0.05, value: 0, random: [-0.6, 0.6],
                hint: 'Favour horizontal (+) or vertical (−) passages; on circles, around (+) or outwards (−)' },
            { type: 'section', label: 'Solution' },
            { id: 'solution', label: 'Show solution (pen 2)', type: 'checkbox', value: true, random: 0.7 },
            { id: 'round', label: 'Rounded solution', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.5, random: [0.2, 0.5],
                show: p => p.solution },
        ],

        generate(p, ctx) {
            return p.shape === 'circle' ? thetaMaze(p, ctx) : rectMaze(p, ctx);
        },
    });
})();
