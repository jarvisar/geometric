/*
 * Plot optimization: point simplification, path merging and pen-up travel
 * ordering, plus length statistics. Operates on paper coordinates (mm).
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

    // Greedy nearest-neighbor ordering with path reversal. Closed loops are
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

    // Cut the parts of strokes that would run over ink the same pen already put down. A felt tip
    // dragged over wet or dried ink picks it up and dries out, and then skips on the next lines.
    //
    // A stretch counts as drawn when at least `cover` (0 to 1) of the pen's width across it is
    // already inked. At 1 only ink that's already on the paper goes, so the plot looks the same.
    // Lower values also cut lines that half overlap, which can open thin gaps in dense hatching.
    // Only overlaps of at least minRun mm are cut, so lines can still cross or meet without an
    // extra pen lift. Strokes are checked longest first, which keeps long lines whole and drops
    // the short repeats instead.
    // Returns { paths, removed } with the strokes in their original order and removed in mm.
    opt.overlaps = function (paths, width, cover, minRun) {
        const n = paths.length;
        if (n === 0 || !(width > 0)) return { paths, removed: 0 };
        const r = width / 2;
        // Ink reaches r from a centerline. The width is sampled at 17 points, edges first since
        // they're what usually isn't inked. The outer 10% (at most 0.05 mm) on each side isn't
        // checked, so near-duplicates (simplified differently, or a hair apart) still count.
        const edge = Math.min(width * 0.1, 0.05);
        const across = [8, -8, 0, 4, -4, 2, -2, 6, -6, 1, -1, 3, -3, 5, -5, 7, -7].map(k => k / 8 * (r - edge));
        const need = Math.max(1, Math.ceil(Math.min(1, cover) * across.length - 1e-9));
        // Strokes are checked in pieces this long. Each piece is tested across its midpoint.
        const step = Math.max(width / 4, 0.02);
        // A stroke's own ink this close behind the pen is the line itself, not an overlap
        const lag = 2 * (width + step);
        // A leftover this short between two cuts would only be a dot
        const speck = width;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const lengths = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const p = paths[i];
            for (let j = 0; j < p.length; j++) {
                const x = p[j][0], y = p[j][1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (j) lengths[i] += Math.hypot(x - p[j - 1][0], y - p[j - 1][1]);
            }
        }
        // Ink is stored as pieces bucketed by midpoint. Samples sit up to r from the midpoint of the
        // piece being checked, and ink reaches r from them, so with pieces at most step long anything
        // that matters is in the 3 x 3 cells around it. Big sheets get bigger cells to keep the grid
        // under 2M cells.
        const cell = Math.max(2 * r + step, Math.sqrt((maxX - minX + 1) * (maxY - minY + 1) / 2e6));
        const nx = Math.floor((maxX - minX) / cell) + 1, ny = Math.floor((maxY - minY) / cell) + 1;
        const head = new Int32Array(nx * ny).fill(-1);
        let cap = 4096, count = 0;
        let seg = new Float64Array(cap * 4), next = new Int32Array(cap), owner = new Int32Array(cap);
        let arcEnd = new Float64Array(cap), alive = new Uint8Array(cap);
        const grow = (a, k) => { const b = new a.constructor(cap * k); b.set(a); return b; };

        function add(x0, y0, x1, y1, who, arc) {
            if (count === cap) {
                cap *= 2;
                seg = grow(seg, 4); next = grow(next, 1); owner = grow(owner, 1); arcEnd = grow(arcEnd, 1); alive = grow(alive, 1);
            }
            const i = count++;
            seg[i * 4] = x0; seg[i * 4 + 1] = y0; seg[i * 4 + 2] = x1; seg[i * 4 + 3] = y1;
            owner[i] = who; arcEnd[i] = arc; alive[i] = 1;
            const k = Math.floor(((y0 + y1) / 2 - minY) / cell) * nx + Math.floor(((x0 + x1) / 2 - minX) / cell);
            next[i] = head[k];
            head[k] = i;
            return i;
        }

        const dist2 = (i, x, y) => {
            const ax = seg[i * 4], ay = seg[i * 4 + 1], dx = seg[i * 4 + 2] - ax, dy = seg[i * 4 + 3] - ay;
            const L2 = dx * dx + dy * dy;
            let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - x, ey = ay + dy * t - y;
            return ex * ex + ey * ey;
        };
        const t2 = (r + 1e-6) * (r + 1e-6), far2 = (2 * r - edge + 1e-6) * (2 * r - edge + 1e-6);
        let near = new Int32Array(64);
        // Is enough of the pen's width already inked across this point? (ux, uy) is the unit normal.
        // The ink that could reach any sample is collected first, so a stroke out on its own costs
        // one grid lookup instead of one per sample.
        function drawn(x, y, ux, uy, who, before) {
            let found = 0;
            const cx = Math.floor((x - minX) / cell), cy = Math.floor((y - minY) / cell);
            for (let gy = Math.max(0, cy - 1); gy <= Math.min(ny - 1, cy + 1); gy++) {
                for (let gx = Math.max(0, cx - 1); gx <= Math.min(nx - 1, cx + 1); gx++) {
                    for (let i = head[gy * nx + gx]; i >= 0; i = next[i]) {
                        if (!alive[i] || (owner[i] === who && arcEnd[i] > before) || dist2(i, x, y) > far2) continue;
                        if (found === near.length) { const b = new Int32Array(found * 2); b.set(near); near = b; }
                        near[found++] = i;
                    }
                }
            }
            if (!found) return false;
            let hit = 0, miss = 0;
            for (const k of across) {
                const sx = x + ux * k, sy = y + uy * k;
                let inked = false;
                for (let j = 0; j < found && !inked; j++) inked = dist2(near[j], sx, sy) <= t2;
                if (inked) { if (++hit >= need) return true; }
                else if (++miss > across.length - need) return false;
            }
            return false;
        }

        // Pieces of the stroke being checked: x0 y0 x1 y1, the path segment each is on, the
        // distance along the stroke where each starts, and its ink id (-1 while it isn't stored).
        let pcap = 1024;
        let pc = new Float64Array(pcap * 4), pseg = new Int32Array(pcap), parc = new Float64Array(pcap + 1);
        let pid = new Int32Array(pcap), cov = new Uint8Array(pcap);
        const order = Array.from(paths.keys()).sort((a, b) => lengths[b] - lengths[a]);
        const out = new Array(n);
        let removed = 0;
        for (const who of order) {
            const p = paths[who];
            let m = 0;
            for (let s = 1; s < p.length; s++) m += Math.max(1, Math.ceil(Math.hypot(p[s][0] - p[s - 1][0], p[s][1] - p[s - 1][1]) / step));
            if (m > pcap) {
                pcap = m;
                pc = new Float64Array(pcap * 4); pseg = new Int32Array(pcap); parc = new Float64Array(pcap + 1);
                pid = new Int32Array(pcap); cov = new Uint8Array(pcap);
            }
            let k = 0, arc = 0;
            for (let s = 1; s < p.length; s++) {
                const a = p[s - 1], b = p[s];
                const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                const parts = Math.max(1, Math.ceil(L / step));
                for (let j = 0; j < parts; j++, k++) {
                    // exact vertices at the ends, untouched stretches keep their original points
                    const u0 = j / parts, u1 = (j + 1) / parts;
                    pc[k * 4] = j ? a[0] + (b[0] - a[0]) * u0 : a[0];
                    pc[k * 4 + 1] = j ? a[1] + (b[1] - a[1]) * u0 : a[1];
                    pc[k * 4 + 2] = j < parts - 1 ? a[0] + (b[0] - a[0]) * u1 : b[0];
                    pc[k * 4 + 3] = j < parts - 1 ? a[1] + (b[1] - a[1]) * u1 : b[1];
                    pseg[k] = s;
                    parc[k] = arc;
                    arc += L / parts;
                }
            }
            parc[m] = arc;
            for (k = 0; k < m; k++) {
                const x0 = pc[k * 4], y0 = pc[k * 4 + 1], x1 = pc[k * 4 + 2], y1 = pc[k * 4 + 3];
                const L = Math.hypot(x1 - x0, y1 - y0) || Infinity;
                cov[k] = drawn((x0 + x1) / 2, (y0 + y1) / 2, (y0 - y1) / L, (x1 - x0) / L, who, (parc[k] + parc[k + 1]) / 2 - lag) ? 1 : 0;
                // Pieces that are already drawn stay out of the grid until we know they're kept
                pid[k] = cov[k] ? -1 : add(x0, y0, x1, y1, who, parc[k + 1]);
            }

            // Runs of drawn / new pieces: [first piece, end piece, drawn, length]
            const runs = [];
            for (k = 0; k < m;) {
                let j = k;
                while (j < m && cov[j] === cov[k]) j++;
                runs.push([k, j, cov[k], parc[j] - parc[k]]);
                k = j;
            }
            if (runs.length === 1 && !runs[0][2]) { out[who] = [p]; continue; }
            const cut = runs.map(r => r[2] === 1 && (r[3] >= minRun || runs.length === 1));
            runs.forEach((r, i) => {
                if (r[2] || r[3] >= speck) return;
                if ((i === 0 || cut[i - 1]) && (i === runs.length - 1 || cut[i + 1])) cut[i] = true;
            });
            if (!cut.includes(true)) {
                for (k = 0; k < m; k++) if (pid[k] < 0) add(pc[k * 4], pc[k * 4 + 1], pc[k * 4 + 2], pc[k * 4 + 3], who, parc[k + 1]);
                out[who] = [p];
                continue;
            }

            const pieces = [];
            let from = -1;
            const emit = to => {
                const line = [[pc[from * 4], pc[from * 4 + 1]]];
                for (let s = pseg[from]; s < pseg[to - 1]; s++) line.push(p[s]);
                line.push([pc[(to - 1) * 4 + 2], pc[(to - 1) * 4 + 3]]);
                pieces.push(line);
                from = -1;
            };
            runs.forEach(([a, b, , len], i) => {
                for (k = a; k < b; k++) {
                    if (cut[i]) { if (pid[k] >= 0) alive[pid[k]] = 0; }
                    else if (pid[k] < 0) pid[k] = add(pc[k * 4], pc[k * 4 + 1], pc[k * 4 + 2], pc[k * 4 + 3], who, parc[k + 1]);
                }
                if (!cut[i]) { if (from < 0) from = a; return; }
                removed += len;
                if (from >= 0) emit(a);
            });
            if (from >= 0) emit(m);
            out[who] = pieces;
        }
        return { paths: out.flat(), removed };
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
})();
