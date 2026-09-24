/*
 * Marching squares iso-lines, stitched into continuous polylines so a
 * plotter draws each contour in one stroke.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    // Sample fn(x, y) on an nx × ny grid spanning [x0, x0 + w] × [y0, y0 + h].
    PG.sampleField = function (fn, x0, y0, w, h, cell) {
        const nx = Math.max(2, Math.round(w / cell) + 1);
        const ny = Math.max(2, Math.round(h / cell) + 1);
        const dx = w / (nx - 1), dy = h / (ny - 1);
        const values = new Float64Array(nx * ny);
        let min = Infinity, max = -Infinity;
        for (let j = 0; j < ny; j++) {
            const y = y0 + j * dy;
            for (let i = 0; i < nx; i++) {
                const v = fn(x0 + i * dx, y);
                values[j * nx + i] = v;
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }
        return { values, nx, ny, x0, y0, dx, dy, min, max };
    };

    // Iso-lines of a sampled field at `level`. Returns an array of polylines.
    PG.isolines = function (field, level) {
        const { values: v, nx, ny, x0, y0, dx, dy } = field;
        // a sample exactly on the level gives zero-length and doubled segments: nudge the level off it
        for (let i = 0; i < v.length; i++) if (v[i] === level) { level += 1e-9 * (Math.abs(level) || 1); break; }
        const H = (nx - 1) * ny; // horizontal edge count; vertical edges follow
        const hEdge = (i, j) => j * (nx - 1) + i;
        const vEdge = (i, j) => H + j * nx + i;

        const points = new Map(); // edge id -> [x, y]
        const links = new Map();  // edge id -> [neighbour edge ids]

        function edgePoint(id) {
            let p = points.get(id);
            if (p) return p;
            let i, j, va, vb, horizontal;
            if (id < H) { j = Math.floor(id / (nx - 1)); i = id - j * (nx - 1); horizontal = true; va = v[j * nx + i]; vb = v[j * nx + i + 1]; }
            else { const k = id - H; j = Math.floor(k / nx); i = k - j * nx; horizontal = false; va = v[j * nx + i]; vb = v[(j + 1) * nx + i]; }
            let t = (level - va) / (vb - va);
            if (!isFinite(t)) t = 0.5;
            t = Math.min(1, Math.max(0, t));
            p = horizontal ? [x0 + (i + t) * dx, y0 + j * dy] : [x0 + i * dx, y0 + (j + t) * dy];
            points.set(id, p);
            return p;
        }
        function link(a, b) {
            let la = links.get(a); if (!la) links.set(a, (la = []));
            let lb = links.get(b); if (!lb) links.set(b, (lb = []));
            la.push(b); lb.push(a);
        }

        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = v[j * nx + i], b = v[j * nx + i + 1];
                const c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
                const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
                if (code === 0 || code === 15) continue;
                const T = hEdge(i, j), B = hEdge(i, j + 1), L = vEdge(i, j), R = vEdge(i + 1, j);
                switch (code) {
                    case 1: case 14: link(L, B); break;
                    case 2: case 13: link(B, R); break;
                    case 3: case 12: link(L, R); break;
                    case 4: case 11: link(T, R); break;
                    case 6: case 9: link(T, B); break;
                    case 7: case 8: link(T, L); break;
                    case 5: {
                        const centre = (a + b + c + d) / 4 > level;
                        if (centre) { link(T, L); link(B, R); } else { link(T, R); link(L, B); }
                        break;
                    }
                    case 10: {
                        const centre = (a + b + c + d) / 4 > level;
                        if (centre) { link(T, R); link(L, B); } else { link(T, L); link(B, R); }
                        break;
                    }
                }
            }
        }

        // Walk the link graph into polylines: open chains (ending on the grid border) first.
        const visited = new Set();
        const lines = [];
        function walk(start) {
            const ids = [start];
            visited.add(start);
            let prev = -1, cur = start;
            for (;;) {
                const nb = links.get(cur);
                let next = -1;
                for (const n of nb) if (n !== prev && !visited.has(n)) { next = n; break; }
                if (next < 0) {
                    // closing a loop?
                    if (ids.length > 2 && nb.includes(start) && prev !== start) ids.push(start);
                    break;
                }
                visited.add(next);
                ids.push(next);
                prev = cur; cur = next;
            }
            lines.push(ids.map(edgePoint));
        }
        for (const [id, nb] of links) if (nb.length === 1 && !visited.has(id)) walk(id);
        for (const id of links.keys()) if (!visited.has(id)) walk(id);
        return lines.filter(l => l.length > 1);
    };

    // Convenience: several evenly spaced levels between the field's min and max.
    PG.contourLevels = function (field, count, lo, hi) {
        lo = lo === undefined ? field.min : lo;
        hi = hi === undefined ? field.max : hi;
        const levels = [];
        for (let i = 1; i <= count; i++) levels.push(lo + ((hi - lo) * i) / (count + 1));
        return levels;
    };
})();
