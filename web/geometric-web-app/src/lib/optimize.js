/*
 * Plot optimisation: point simplification, path merging and pen-up travel
 * ordering, plus length / time statistics. Operates on paper coordinates (mm).
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const opt = (PG.optimize = {});

    // Drop consecutive points closer than eps.
    opt.dedupe = function (path, eps) {
        if (path.length < 2) return path;
        const e2 = eps * eps;
        const out = [path[0]];
        let last = path[0];
        for (let i = 1; i < path.length; i++) {
            const p = path[i];
            const dx = p[0] - last[0], dy = p[1] - last[1];
            if (dx * dx + dy * dy >= e2) { out.push(p); last = p; }
        }
        const end = path[path.length - 1];
        if (out.length === 1 || out[out.length - 1] !== end) {
            if (out.length > 1) out[out.length - 1] = end; else out.push(end);
        }
        return out;
    };

    // Ramer–Douglas–Peucker, iterative (long paths would blow the stack recursively).
    opt.simplify = function (path, tol) {
        const n = path.length;
        if (n < 3 || tol <= 0) return path;
        const keep = new Uint8Array(n);
        keep[0] = keep[n - 1] = 1;
        const stack = [0, n - 1];
        const t2 = tol * tol;
        while (stack.length) {
            const b = stack.pop(), a = stack.pop();
            const ax = path[a][0], ay = path[a][1];
            const dx = path[b][0] - ax, dy = path[b][1] - ay;
            const L2 = dx * dx + dy * dy;
            let maxD = -1, idx = -1;
            for (let i = a + 1; i < b; i++) {
                const px = path[i][0] - ax, py = path[i][1] - ay;
                let d2;
                if (L2 === 0) d2 = px * px + py * py;
                else {
                    const cr = px * dy - py * dx;
                    d2 = (cr * cr) / L2;
                    // points beyond the ends of the chord (e.g. closed loops) use endpoint distance
                    const t = (px * dx + py * dy) / L2;
                    if (t < 0) d2 = px * px + py * py;
                    else if (t > 1) { const qx = px - dx, qy = py - dy; d2 = qx * qx + qy * qy; }
                }
                if (d2 > maxD) { maxD = d2; idx = i; }
            }
            if (maxD > t2) {
                keep[idx] = 1;
                if (idx - a > 1) stack.push(a, idx);
                if (b - idx > 1) stack.push(idx, b);
            }
        }
        const out = [];
        for (let i = 0; i < n; i++) if (keep[i]) out.push(path[i]);
        return out;
    };

    function isClosed(path, tol) {
        const a = path[0], b = path[path.length - 1];
        return path.length > 2 && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
    }
    opt.isClosed = isClosed;

    // Spatial hash of path endpoints. id = pathIndex * 2 + (0 = start, 1 = end).
    class EndpointGrid {
        constructor(paths, cell) {
            this.cell = cell;
            this.map = new Map();
            this.paths = paths;
            paths.forEach((p, i) => {
                this.add(i * 2, p[0]);
                this.add(i * 2 + 1, p[p.length - 1]);
            });
        }
        key(ix, iy) { return (ix + 32768) * 65536 + (iy + 32768); }
        add(id, pt) {
            const k = this.key(Math.floor(pt[0] / this.cell), Math.floor(pt[1] / this.cell));
            let arr = this.map.get(k);
            if (!arr) this.map.set(k, (arr = []));
            arr.push(id);
        }
        endpoint(id) {
            const p = this.paths[id >> 1];
            return id & 1 ? p[p.length - 1] : p[0];
        }
    }

    // Join paths whose endpoints touch (within tol), reversing as needed.
    opt.merge = function (paths, tol) {
        const n = paths.length;
        if (n < 2) return paths;
        const cell = Math.max(tol, 1e-4);
        const grid = new EndpointGrid(paths, cell);
        const used = new Uint8Array(n);
        const t2 = tol * tol;

        function nearest(pt) {
            const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
            let best = -1, bestD = t2;
            for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
                const arr = grid.map.get(grid.key(cx + ox, cy + oy));
                if (!arr) continue;
                for (let k = arr.length - 1; k >= 0; k--) {
                    const id = arr[k];
                    if (used[id >> 1]) { arr[k] = arr[arr.length - 1]; arr.pop(); continue; }
                    const q = grid.endpoint(id);
                    const dx = q[0] - pt[0], dy = q[1] - pt[1], d = dx * dx + dy * dy;
                    if (d <= bestD) { bestD = d; best = id; }
                }
            }
            return best;
        }

        const out = [];
        for (let i = 0; i < n; i++) {
            if (used[i]) continue;
            used[i] = 1;
            let chain = paths[i].slice();
            for (let pass = 0; pass < 2; pass++) {
                while (!isClosed(chain, tol)) {
                    const id = nearest(chain[chain.length - 1]);
                    if (id < 0) break;
                    const j = id >> 1, p = paths[j];
                    used[j] = 1;
                    if (id & 1) for (let k = p.length - 2; k >= 0; k--) chain.push(p[k]);
                    else for (let k = 1; k < p.length; k++) chain.push(p[k]);
                }
                chain.reverse();
            }
            out.push(chain);
        }
        return out;
    };

    // Greedy nearest-neighbour ordering with path reversal. Closed loops are
    // re-started at the vertex nearest the pen. Returns { paths, end }.
    opt.sort = function (paths, start = [0, 0], rotateLoops = true) {
        const n = paths.length;
        if (n === 0) return { paths: [], end: start };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of paths) for (const q of [p[0], p[p.length - 1]]) {
            if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
            if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
        }
        const span = Math.max(maxX - minX, maxY - minY, 1e-3);
        const dim = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(n / 2))));
        const cell = span / dim + 1e-9;
        const gx = Math.ceil((maxX - minX) / cell) + 1, gy = Math.ceil((maxY - minY) / cell) + 1;
        const cells = new Array(gx * gy);
        const cellOf = (x, y) => [
            Math.min(gx - 1, Math.max(0, Math.floor((x - minX) / cell))),
            Math.min(gy - 1, Math.max(0, Math.floor((y - minY) / cell))),
        ];
        const endpoint = id => { const p = paths[id >> 1]; return id & 1 ? p[p.length - 1] : p[0]; };
        for (let i = 0; i < n * 2; i++) {
            const q = endpoint(i);
            const [cx, cy] = cellOf(q[0], q[1]);
            const k = cy * gx + cx;
            (cells[k] || (cells[k] = [])).push(i);
        }
        const done = new Uint8Array(n);
        const out = [];
        let cur = start;
        for (let step = 0; step < n; step++) {
            const [cx, cy] = cellOf(cur[0], cur[1]);
            let best = -1, bestD = Infinity;
            const maxR = Math.max(gx, gy);
            for (let r = 0; r <= maxR; r++) {
                const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
                for (let y = y0; y <= y1; y++) {
                    if (y < 0 || y >= gy) continue;
                    const edgeRow = y === y0 || y === y1;
                    for (let x = x0; x <= x1; x += edgeRow ? 1 : x1 - x0 || 1) {
                        if (x < 0 || x >= gx) continue;
                        const arr = cells[y * gx + x];
                        if (!arr) continue;
                        for (let k = arr.length - 1; k >= 0; k--) {
                            const id = arr[k];
                            if (done[id >> 1]) { arr[k] = arr[arr.length - 1]; arr.pop(); continue; }
                            const q = endpoint(id);
                            const dx = q[0] - cur[0], dy = q[1] - cur[1], d = dx * dx + dy * dy;
                            if (d < bestD) { bestD = d; best = id; }
                        }
                    }
                }
                // anything in ring r+1 is at least r*cell away (relative to our cell)
                if (best >= 0 && Math.sqrt(bestD) <= r * cell) break;
            }
            if (best < 0) break;
            const idx = best >> 1;
            done[idx] = 1;
            let p = paths[idx];
            if (best & 1) p = p.slice().reverse();
            if (rotateLoops && p.length > 3 && isClosed(p, 1e-6)) {
                let bi = 0, bd = Infinity;
                for (let i = 0; i < p.length - 1; i++) {
                    const dx = p[i][0] - cur[0], dy = p[i][1] - cur[1], d = dx * dx + dy * dy;
                    if (d < bd) { bd = d; bi = i; }
                }
                if (bi > 0 && bd < bestD * 0.8) {
                    const core = p.slice(0, -1);
                    p = core.slice(bi).concat(core.slice(0, bi));
                    p.push(p[0]);
                }
            }
            out.push(p);
            cur = p[p.length - 1];
        }
        return { paths: out, end: cur };
    };

    // Lengths and pen-lift counts for an ordered list of layers ([{ paths }]).
    // Travel includes moving from home to the first stroke and back home per layer.
    opt.stats = function (layers, home = [0, 0]) {
        let draw = 0, travel = 0, lifts = 0, points = 0, paths = 0;
        for (const layer of layers) {
            let cur = home;
            for (const p of layer.paths) {
                if (!p.length) continue;
                travel += Math.hypot(p[0][0] - cur[0], p[0][1] - cur[1]);
                for (let i = 1; i < p.length; i++) draw += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
                cur = p[p.length - 1];
                points += p.length;
                paths++;
                lifts++;
            }
            if (layer.paths.length) travel += Math.hypot(home[0] - cur[0], home[1] - cur[1]);
        }
        return { draw, travel, lifts, points, paths };
    };

    opt.estimateTime = function (stats, plot) {
        const down = Math.max(1, plot.drawSpeed), up = Math.max(1, plot.travelSpeed);
        return stats.draw / down + stats.travel / up + stats.lifts * Math.max(0, plot.liftTime);
    };
})();
