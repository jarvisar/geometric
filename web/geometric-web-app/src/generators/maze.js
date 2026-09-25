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
                if (inTree[s] || !nbrs[s].length) continue; // masked-out cells have no neighbours
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
        // Only cells lying wholly inside the clip shape (circle, hexagon, rotated page…)
        // are used: the largest 4-connected group of them. Cells shrink until a few fit.
        let c = Math.min(p.cell, W / 2, H / 2); // at least 2 × 2 cells, all inside the area
        let cols, rows, ox, oy, inc, count;
        for (let tries = 0; ; tries++) {
            cols = Math.max(2, Math.floor(W / c)); rows = Math.max(2, Math.floor(H / c));
            if (cols * rows > 60000) { c *= Math.sqrt((cols * rows) / 60000); cols = Math.floor(W / c); rows = Math.floor(H / c); }
            ox = (W - cols * c) / 2; oy = (H - rows * c) / 2;
            const corner = new Uint8Array((cols + 1) * (rows + 1));
            for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) corner[j * (cols + 1) + i] = ctx.shape.dist(ox + i * c, oy + j * c) > -1e-6 ? 1 : 0;
            const ok = (i, j) => corner[j * (cols + 1) + i] && corner[j * (cols + 1) + i + 1] && corner[(j + 1) * (cols + 1) + i] && corner[(j + 1) * (cols + 1) + i + 1];
            inc = new Int32Array(cols * rows); // 0 outside, else a group label; then 1 = kept
            count = 0;
            let label = 1, best = 0, bestLabel = 0;
            for (let s = 0; s < cols * rows; s++) {
                if (inc[s] || !ok(s % cols, Math.floor(s / cols))) continue;
                label++;
                let size = 0;
                const stack = [s];
                inc[s] = label;
                while (stack.length) {
                    const k = stack.pop(), i = k % cols, j = Math.floor(k / cols);
                    size++;
                    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
                        if (a < 0 || b < 0 || a >= cols || b >= rows || inc[b * cols + a] || !ok(a, b)) continue;
                        inc[b * cols + a] = label;
                        stack.push(b * cols + a);
                    }
                }
                if (size > best) { best = size; bestLabel = label; }
            }
            for (let s = 0; s < inc.length; s++) inc[s] = inc[s] === bestLabel ? 1 : 0;
            count = best;
            if (count >= 4 || tries > 30) break;
            c *= 0.85;
        }
        const N = cols * rows, id = (i, j) => j * cols + i;
        const on = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && inc[id(i, j)] === 1;
        const nbrs = Array.from({ length: N }, () => []);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            if (!on(i, j)) continue;
            if (on(i + 1, j)) { nbrs[id(i, j)].push([id(i + 1, j), 0]); nbrs[id(i + 1, j)].push([id(i, j), 0]); }
            if (on(i, j + 1)) { nbrs[id(i, j)].push([id(i, j + 1), 1]); nbrs[id(i, j + 1)].push([id(i, j), 1]); }
        }
        const b = geo.clamp(p.bias, -0.95, 0.95);
        const kept = [];
        for (let s = 0; s < N; s++) if (inc[s]) kept.push(s);
        const start = count === N ? id(rng.int(0, cols - 1), rng.int(0, rows - 1)) : rng.pick(kept);
        const maze = carve(N, nbrs, p.algorithm, k => (k ? 1 - b : 1 + b), rng, start);

        // entrance in the top row near the left, exit in the bottom row near the right
        const jTop = Math.floor(kept[0] / cols), jBot = Math.floor(kept[kept.length - 1] / cols);
        const top = [], bot = [];
        for (let i = 0; i < cols; i++) { if (on(i, jTop)) top.push(i); if (on(i, jBot)) bot.push(i); }
        const inCol = top[rng.int(0, Math.max(0, Math.floor(top.length / 4) - 1))];
        const outCol = bot[bot.length - 1 - rng.int(0, Math.max(0, Math.floor(bot.length / 4) - 1))];

        // walls: every grid edge with a kept cell on either side, unless it is a passage or a door
        const walls = [];
        for (let j = 0; j <= rows; j++) {
            const y = oy + j * c;
            const f = [];
            for (let i = 0; i < cols; i++) {
                const A = on(i, j - 1), B = on(i, j);
                const door = (B && j === jTop && i === inCol) || (A && j === jBot + 1 && i === outCol);
                f.push((A || B) && !door && !(A && B && maze.has(id(i, j - 1), id(i, j))));
            }
            for (const [s, e] of runs(f)) walls.push([[ox + s * c, y], [ox + e * c, y]]);
        }
        for (let i = 0; i <= cols; i++) {
            const x = ox + i * c;
            const f = [];
            for (let j = 0; j < rows; j++) {
                const A = on(i - 1, j), B = on(i, j);
                f.push((A || B) && !(A && B && maze.has(id(i - 1, j), id(i, j))));
            }
            for (const [s, e] of runs(f)) walls.push([[x, oy + s * c], [x, oy + e * c]]);
        }

        if (!p.solution) return walls;
        const cells = solve(N, nbrs, maze, id(inCol, jTop), id(outCol, jBot));
        // lead in and out through the doors, as far as the drawing area allows
        const xa = ox + (inCol + 0.5) * c, xb = ox + (outCol + 0.5) * c, y0 = oy + jTop * c, y1 = oy + (jBot + 1) * c;
        const lead = (x, y) => Math.min(c / 2, Math.max(0, ctx.shape.dist(x, y) - 0.3));
        const path = [[xa, y0 - lead(xa, y0)]];
        for (const k of cells) path.push([ox + ((k % cols) + 0.5) * c, oy + (Math.floor(k / cols) + 0.5) * c]);
        path.push([xb, y1 + lead(xb, y1)]);
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
        // lead in from outside the entrance, but not past the edge of the drawing area
        const poly = [[ta, Math.min(Ro + c / 2, Math.max(Ro, R - 0.3))], [ta, (rings - 0.5) * c]];
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

        randomize(rng, p) {
            // theta mazes lose their rings when the cells are large
            return p.shape === 'circle' ? { cell: +rng.range(3.5, 7).toFixed(1) } : {};
        },

        generate(p, ctx) {
            return p.shape === 'circle' ? thetaMaze(p, ctx) : rectMaze(p, ctx);
        },
    });
})();
