/*
 * Tidal Atlas: one eroded landscape drawn again and again as the sea rises.
 * The terrain comes from a stream power erosion pass, so the valleys drown
 * into fjords and the ridges break up into island chains. Hidden lines are
 * removed with a floating horizon over the terrain surface, which is exact
 * enough at plotter scale and a lot cheaper than clipping against faces.
 */
(function () {
    'use strict';
    const { geo } = PG;
    const L = 100, EN = 65;
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    // logical line groups, mapped onto pens at the end
    const WATER = 0, COAST = 1, LOW = 2, SECTION = 5, ROCK = 6, STRATA = 7, NOTES = 8;

    // ------------------------------------------------------------------
    // Terrain
    // ------------------------------------------------------------------

    // Neighbour indices on an n x n grid, 8 per node, -1 off the edge
    function neighbours(n) {
        const nbr = new Int32Array(n * n * 8).fill(-1);
        for (let i = 0; i < n * n; i++) {
            const cx = i % n, cy = (i - cx) / n;
            for (let e = 0; e < 8; e++) {
                const x = cx + NB[e][0], y = cy + NB[e][1];
                if (x >= 0 && y >= 0 && x < n && y < n) nbr[i * 8 + e] = y * n + x;
            }
        }
        return nbr;
    }

    // Priority flood from the outlets (Barnes et al.): fills every pit up to its
    // spill point plus a hair, and returns the nodes in the order they were
    // reached, which runs from the outlets uphill.
    function flood(h, n, nbr, outlet) {
        const N = n * n, filled = Float64Array.from(h), order = new Int32Array(N), closed = new Uint8Array(N);
        const hk = new Float64Array(N), hv = new Int32Array(N);
        let hs = 0, cnt = 0;
        const push = (key, v) => {
            let j = hs++;
            while (j > 0) { const q = (j - 1) >> 1; if (hk[q] <= key) break; hk[j] = hk[q]; hv[j] = hv[q]; j = q; }
            hk[j] = key; hv[j] = v;
        };
        for (let i = 0; i < N; i++) if (outlet[i]) { closed[i] = 1; push(h[i], i); }
        while (hs) {
            const c = hv[0], key = hk[--hs], v = hv[hs];
            let j = 0;
            for (;;) {
                let q = 2 * j + 1;
                if (q >= hs) break;
                if (q + 1 < hs && hk[q + 1] < hk[q]) q++;
                if (hk[q] >= key) break;
                hk[j] = hk[q]; hv[j] = hv[q]; j = q;
            }
            hk[j] = key; hv[j] = v;
            order[cnt++] = c;
            const fc = filled[c] + 1e-7;
            for (let e = c * 8, end = e + 8; e < end; e++) {
                const m = nbr[e];
                if (m < 0 || closed[m]) continue;
                closed[m] = 1;
                if (filled[m] < fc) filled[m] = fc;
                push(filled[m], m);
            }
        }
        return { filled, order, cnt };
    }

    // Stream power erosion (Braun & Willett's implicit scheme) on an n x n grid.
    // Receivers come from the flooded surface, so pits fill instead of trapping
    // the rivers. Slopes steeper than smax collapse, which keeps the ridges from
    // turning into needles.
    function erode(h, U, n, outlet, iters, K, smax) {
        const N = n * n, rec = new Int32Array(N), len = new Float64Array(N), area = new Float64Array(N), nbr = neighbours(n);
        for (let it = 0; it < iters; it++) {
            const { filled, order, cnt } = flood(h, n, nbr, outlet);
            for (let i = 0; i < N; i++) {
                rec[i] = i; len[i] = 1;
                if (outlet[i]) continue;
                const fi = filled[i];
                let best = 0;
                for (let e = 0; e < 8; e++) {
                    const m = nbr[i * 8 + e];
                    if (m < 0) continue;
                    const dl = e < 4 ? 1 : Math.SQRT2, s = (fi - filled[m]) / dl;
                    if (s > best) { best = s; rec[i] = m; len[i] = dl; }
                }
            }
            area.fill(1);
            for (let q = cnt - 1; q >= 0; q--) { const i = order[q]; if (rec[i] !== i) area[rec[i]] += area[i]; }
            for (let q = 0; q < cnt; q++) {
                const i = order[q], r = rec[i];
                if (r === i) continue;
                const F = K * Math.sqrt(area[i]) / len[i];
                h[i] = Math.min((h[i] + U[i] + F * h[r]) / (1 + F), h[r] + smax[i] * len[i]);
            }
        }
        return area;
    }

    // Uplift pattern, starting surface and outlets for each kind of land. u, v
    // run 0..1 across the tile, with (0, 0) the corner nearest the viewer.
    function landform(kind, rng, N2) {
        const n = EN, N = n * n, U = new Float64Array(N), h = new Float64Array(N), outlet = new Uint8Array(N), smax = new Float64Array(N);
        const warp = (u, v, s) => [u + s * N2.fbm2(u * 2.3 + 11, v * 2.3, 3), v + s * N2.fbm2(u * 2.3, v * 2.3 - 7, 3)];
        const ridged = (u, v, oct) => {
            let sum = 0, amp = 0.5, f = 1, norm = 0;
            for (let o = 0; o < oct; o++) {
                const r = 1 - Math.abs(N2.noise2(u * f * 3 + o * 5.3, v * f * 3 - o * 2.9));
                sum += amp * r * r; norm += amp; amp *= 0.5; f *= 2.1;
            }
            return sum / norm;
        };
        const blobs = [];
        if (kind === 'archipelago') {
            // island massifs kept apart so real straits open between them
            const count = rng.int(5, 8);
            for (let tries = 0; blobs.length < count && tries < 200; tries++) {
                const b = [rng.range(0.14, 0.86), rng.range(0.14, 0.86), rng.range(0.07, 0.14), rng.range(0.45, 1)];
                if (blobs.every(o => Math.hypot(o[0] - b[0], o[1] - b[1]) > (o[2] + b[2]) * 1.35)) blobs.push(b);
            }
            blobs[0][3] = 1;
        }
        const cx0 = 0.5 + rng.range(-0.08, 0.08), cy0 = 0.5 + rng.range(-0.08, 0.08);
        // alpine: long ridges running down from the summit, spread round it
        const arms = [], armCount = rng.int(3, 5), turn = rng.range(0, Math.PI * 2);
        for (let i = 0; i < armCount; i++) {
            const a = turn + (i + rng.range(-0.3, 0.3)) * Math.PI * 2 / armCount;
            arms.push([Math.cos(a), Math.sin(a), rng.range(0.45, 0.62), rng.range(0.06, 0.1), rng.range(0.78, 0.94)]);
        }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const u = i / (n - 1), v = j / (n - 1), k = j * n + i;
            const [wu, wv] = warp(u, v, 0.12);
            let up;
            if (kind === 'fjords') {
                const t = (wu + wv) / 2 + 0.08 * N2.fbm2(u * 4, v * 4, 2);
                up = geo.smoothstep(0.05, 0.8, t) * (0.55 + 0.45 * ridged(wu, wv, 3));
            } else if (kind === 'archipelago') {
                up = 0;
                for (const [bx, by, br, bh] of blobs) up = Math.max(up, bh * Math.exp(-((wu - bx) ** 2 + (wv - by) ** 2) / (br * br)));
                up = Math.max(0, up - 0.08) * (0.6 + 0.4 * ridged(wu, wv, 3));
            } else if (kind === 'volcano') {
                const r = Math.hypot(wu - cx0, wv - cy0);
                up = Math.max(0, 1 - r / 0.48) ** 1.3 * (0.8 + 0.2 * ridged(wu, wv, 2));
            } else {
                const du = wu - cx0, dv = wv - cy0;
                up = Math.max(0, 1 - Math.hypot(du, dv) / 0.45) ** 1.6;
                for (const [ax, ay, len, w, amp] of arms) {
                    const along = du * ax + dv * ay, off = dv * ax - du * ay;
                    if (along > 0) up = Math.max(up, amp * Math.max(0, 1 - along / len) * Math.exp(-((off / w) ** 2)));
                }
                up *= 0.75 + 0.25 * ridged(wu, wv, 3);
            }
            U[k] = up;
            smax[k] = 0.16 * (1 + 0.5 * N2.noise2(u * 7 - 3, v * 7 + 1));
            h[k] = up * 0.3 + 0.02 * N2.fbm2(u * 9, v * 9, 3);
            outlet[k] = kind === 'fjords' ? i === 0 || j === 0 : i === 0 || j === 0 || i === n - 1 || j === n - 1;
        }
        return { U, h, outlet, smax };
    }

    // Box blur in place, rows then columns
    function blur(v, n, r) {
        const tmp = new Float64Array(n);
        for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
            const at = b => pass ? b * n + a : a * n + b;
            for (let b = 0; b < n; b++) {
                let s = 0;
                for (let d = -r; d <= r; d++) s += v[at(geo.clamp(b + d, 0, n - 1))];
                tmp[b] = s / (2 * r + 1);
            }
            for (let b = 0; b < n; b++) v[at(b)] = tmp[b];
        }
    }

    const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

    // The eroded grid is the slow part, so it's kept for the next generate
    // when only the view or the linework changes.
    let erodedCache = null, terrainCache = null;
    function eroded(kind, seed) {
        const key = kind + ',' + seed;
        if (erodedCache && erodedCache.key === key) return erodedCache;
        const rng = new PG.RNG(PG.iso.hash(seed, 41)), N2 = PG.makeNoise(new PG.RNG(PG.iso.hash(seed, 43)));
        const { U, h, outlet, smax } = landform(kind, rng, N2), N = EN * EN;
        const area = erode(h, U, EN, outlet, 20, 3, smax);
        let lo = Infinity, hi = -Infinity;
        for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        // Glaciers: deepen the valleys that drain a lot of ground and blur the cut
        // so the troughs come out wide and flat bottomed. The fjord coast gets the
        // deepest ones so the sea runs far inland along them.
        const cut = new Float64Array(N), a0 = Math.log(12), a1 = Math.log(N * (kind === 'alpine' ? 0.03 : 0.06));
        for (let i = 0; i < N; i++) cut[i] = geo.smoothstep(a0, a1, Math.log(area[i]));
        for (let pass = 0; pass < 2; pass++) blur(cut, EN, 2);
        const depth = { fjords: 0.55, alpine: 0.42, archipelago: 0.12, volcano: 0.08 }[kind] * (hi - lo);
        // Ground far from any uplift sinks, so straits between islands run deep.
        // Blurred so the sea floor keeps falling away instead of going flat.
        const sink = { fjords: 0, alpine: 0.1, archipelago: 0.3, volcano: 0.25 }[kind] * (hi - lo), far = Float64Array.from(U);
        for (let pass = 0; pass < 3; pass++) blur(far, EN, 4);
        for (let i = 0; i < N; i++) h[i] -= depth * cut[i] + sink * (1 - geo.smoothstep(0.02, 0.3, U[i])) * (1 - geo.smoothstep(0, 0.35, far[i]));
        // one soft pass takes the grid scale kinks out of the gullies, so profiles
        // run smooth across them while the big ridges stay sharp enough
        const soft = Float64Array.from(h);
        for (let j = 1; j < EN - 1; j++) for (let i = 1; i < EN - 1; i++) {
            const q = j * EN + i;
            soft[q] = (4 * h[q] + 2 * (h[q - 1] + h[q + 1] + h[q - EN] + h[q + EN]) + h[q - EN - 1] + h[q - EN + 1] + h[q + EN - 1] + h[q + EN + 1]) / 16;
        }
        h.set(soft);
        // the cut leaves basins in the troughs, which would flood as lakes below sea level
        const edges = new Uint8Array(N);
        for (let i = 0; i < N; i++) { const x = i % EN, y = (i - x) / EN; edges[i] = x === 0 || y === 0 || x === EN - 1 || y === EN - 1 ? 1 : 0; }
        h.set(flood(h, EN, neighbours(EN), edges).filled);
        lo = Infinity; hi = -Infinity;
        for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        let crater = null;
        if (kind === 'volcano') {
            // caldera: a steep walled bowl sunk into the summit
            let top = 0;
            for (let i = 1; i < N; i++) if (h[i] > h[top]) top = i;
            const ti = top % EN, tj = (top - ti) / EN, rc = EN * 0.085, reach = EN * 0.3, floor = hi - (hi - lo) * 0.3;
            for (let j = 0; j < EN; j++) for (let i = 0; i < EN; i++) {
                // erosion eats into the summit, so rebuild the upper cone and
                // keep the gullies only lower down
                const d = Math.hypot(i - ti, j - tj), q = j * EN + i;
                const cone = lo + (hi - lo) * Math.max(0, 1 - Math.max(0, d - rc) / reach) ** 1.5;
                h[q] = Math.max(h[q], cone * (0.97 + 0.03 * N2.noise2(i * 0.4, j * 0.4)));
                if (d < rc * 1.2) h[q] = Math.min(h[q], geo.lerp(floor, hi * 1.05, geo.smoothstep(0.6, 1.1, d / rc)));
            }
            crater = { u: ti / (EN - 1), v: tj / (EN - 1), r: rc / (EN - 1), lake: (floor - lo) / (hi - lo) + 0.09 };
        }
        for (let j = 0; j < EN; j++) for (let i = 0; i < EN; i++) {
            // a shelf falling away to the open edges, so the sea bed isn't flat in section
            const u = i / (EN - 1), v = j / (EN - 1), e = kind === 'fjords' ? Math.min(u, v) : Math.min(u, v, 1 - u, 1 - v);
            h[j * EN + i] = (h[j * EN + i] - lo) / (hi - lo) - 0.14 * (1 - geo.smoothstep(0, 0.25, e)) * (0.75 + 0.25 * N2.noise2(u * 6 + 3, v * 6));
        }
        return (erodedCache = { key, h, N2, crater });
    }

    // Heights (about 0..1) on an rn x rn grid over the tile, upsampled from the
    // erosion grid with a little rock texture on top
    function terrain(kind, seed, rn, rough) {
        const key = [kind, seed, rn, rough].join();
        if (terrainCache && terrainCache.key === key) return terrainCache;
        const { h, N2, crater } = eroded(kind, seed), n = EN;
        const g = (i, j) => h[geo.clamp(j, 0, n - 1) * n + geo.clamp(i, 0, n - 1)];
        // D8 drainage runs in eight fixed directions. Sampling the grid through a
        // gentle warp bends the valleys so they don't look ruled.
        const wn = 33, warp = new Float32Array(wn * wn * 2);
        for (let j = 0; j < wn; j++) for (let i = 0; i < wn; i++) {
            const u = i / (wn - 1), v = j / (wn - 1), fade = 0.035 * geo.smoothstep(0, 0.12, Math.min(u, v, 1 - u, 1 - v));
            warp[(j * wn + i) * 2] = fade * N2.fbm2(u * 3.2 + 20, v * 3.2, 2);
            warp[(j * wn + i) * 2 + 1] = fade * N2.fbm2(u * 3.2, v * 3.2 + 20, 2);
        }
        const out = new Float32Array(rn * rn);
        let hub = -1, hubD = Infinity;
        for (let j = 0; j < rn; j++) {
            const v = j / (rn - 1), wy = v * (wn - 1), wj = Math.min(wn - 2, Math.floor(wy)), ty = wy - wj;
            for (let i = 0; i < rn; i++) {
                const u = i / (rn - 1), wx = u * (wn - 1), wi = Math.min(wn - 2, Math.floor(wx)), tx = wx - wi;
                const w = (o, c) => warp[((wj + o) * wn + wi + c) * 2];
                const w2 = (o, c) => warp[((wj + o) * wn + wi + c) * 2 + 1];
                const du = (w(0, 0) * (1 - tx) + w(0, 1) * tx) * (1 - ty) + (w(1, 0) * (1 - tx) + w(1, 1) * tx) * ty;
                const dv = (w2(0, 0) * (1 - tx) + w2(0, 1) * tx) * (1 - ty) + (w2(1, 0) * (1 - tx) + w2(1, 1) * tx) * ty;
                const fx = geo.clamp(u + du, 0, 1) * (n - 1), fy = geo.clamp(v + dv, 0, 1) * (n - 1);
                if (crater) {
                    const cd = Math.hypot(u + du - crater.u, v + dv - crater.v);
                    if (cd < hubD) { hubD = cd; hub = j * rn + i; }
                }
                const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy)), sx = fx - x0, sy = fy - y0;
                const row = dy => cubic(g(x0 - 1, y0 + dy), g(x0, y0 + dy), g(x0 + 1, y0 + dy), g(x0 + 2, y0 + dy), sx);
                const z = Math.max(cubic(row(-1), row(0), row(1), row(2), sy), Math.min(g(x0, y0), g(x0 + 1, y0), g(x0, y0 + 1), g(x0 + 1, y0 + 1)));
                out[j * rn + i] = z + rough * (0.004 + 0.012 * z) * N2.fbm2(u * 7 + 5, v * 7 - 3, 2);
            }
        }
        // Single node pits (from Catmull-Rom undershoot and the warp) notch every
        // profile that crosses them, so lift them to their lowest neighbour
        for (let j = 1; j < rn - 1; j++) for (let i = 1; i < rn - 1; i++) {
            const q = j * rn + i, m = Math.min(out[q - 1], out[q + 1], out[q - rn], out[q + rn]);
            if (out[q] < m) out[q] = m;
        }
        // Crater lake: flood the caldera floor from its lowest point up to the
        // lake level. The water is flat, so it's drawn and hidden like ground.
        let lake = null;
        if (crater) {
            // where the warp put the crater on the render grid
            const R = crater.r * 0.7 * (rn - 1), ci = hub % rn, cj = Math.floor(hub / rn);
            let seed0 = -1;
            for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(rn - 1, Math.ceil(cj + R)); j++) for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(rn - 1, Math.ceil(ci + R)); i++) {
                if (Math.hypot(i - ci, j - cj) <= R && (seed0 < 0 || out[j * rn + i] < out[seed0])) seed0 = j * rn + i;
            }
            const mask = new Uint8Array(rn * rn), stack = seed0 >= 0 && out[seed0] < crater.lake ? [seed0] : [];
            let leak = false;
            while (stack.length && !leak) {
                const q = stack.pop();
                if (mask[q]) continue;
                mask[q] = 1;
                const i = q % rn, j = (q - i) / rn;
                if (Math.hypot(i - ci, j - cj) > R * 2) leak = true;
                for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const a = i + di, b = j + dj;
                    if (a >= 0 && b >= 0 && a < rn && b < rn && !mask[b * rn + a] && out[b * rn + a] < crater.lake) stack.push(b * rn + a);
                }
            }
            if (!leak && stack.length === 0 && mask.some(v => v)) {
                const cellW = L / (rn - 1), box = [Infinity, Infinity, -Infinity, -Infinity];
                for (let q = 0; q < rn * rn; q++) {
                    if (!mask[q]) continue;
                    out[q] = crater.lake;
                    const x = (q % rn) * cellW, y = Math.floor(q / rn) * cellW;
                    box[0] = Math.min(box[0], x - cellW); box[1] = Math.min(box[1], y - cellW);
                    box[2] = Math.max(box[2], x + cellW); box[3] = Math.max(box[3], y + cellW);
                }
                lake = { level: out[seed0], box };
            }
        }
        const sorted = Float32Array.from(out).sort();
        return (terrainCache = { key, n: rn, h: out, cell: L / (rn - 1), lo: sorted[0], hi: sorted[sorted.length - 1], lake,
            quantile: f => sorted[Math.round(geo.clamp(f, 0, 1) * (sorted.length - 1))] });
    }

    // ------------------------------------------------------------------
    // Fields on the terrain grid
    // ------------------------------------------------------------------

    // Marching squares on an n x n grid with typed link arrays. The shared
    // PG.isolines is fine for a few levels but too slow for dense contours.
    let links = null;
    function isolines(v, n, level, cell) {
        const E = n * (n - 1);
        if (!links || links.n !== n) links = { n, a: new Int32Array(4 * E).fill(-1), touched: [] };
        const la = links.a, touched = links.touched;
        const link = (a, b) => {
            la[2 * a + (la[2 * a] < 0 ? 0 : 1)] = b;
            la[2 * b + (la[2 * b] < 0 ? 0 : 1)] = a;
            touched.push(a, b);
        };
        for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
            const k = j * n + i, a = v[k], b = v[k + 1], c = v[k + n + 1], d = v[k + n];
            const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
            if (code === 0 || code === 15) continue;
            const T = j * (n - 1) + i, B = T + n - 1, Lf = E + k, R = Lf + 1;
            switch (code) {
                case 1: case 14: link(Lf, B); break;
                case 2: case 13: link(B, R); break;
                case 3: case 12: link(Lf, R); break;
                case 4: case 11: link(T, R); break;
                case 6: case 9: link(T, B); break;
                case 7: case 8: link(T, Lf); break;
                default: {
                    const centre = (a + b + c + d) / 4 > level;
                    if ((code === 5) === centre) { link(T, Lf); link(B, R); } else { link(T, R); link(Lf, B); }
                }
            }
        }
        const point = e => {
            if (e < E) {
                const j = Math.floor(e / (n - 1)), i = e - j * (n - 1), va = v[j * n + i], vb = v[j * n + i + 1];
                return [(i + geo.clamp((level - va) / (vb - va), 0, 1)) * cell, j * cell];
            }
            const f = e - E, j = Math.floor(f / n), i = f - j * n, va = v[j * n + i], vb = v[(j + 1) * n + i];
            return [i * cell, (j + geo.clamp((level - va) / (vb - va), 0, 1)) * cell];
        };
        const lines = [], seen = new Set();
        const walk = start => {
            const ids = [start];
            seen.add(start);
            let prev = -1, cur = start;
            for (;;) {
                const n0 = la[2 * cur], n1 = la[2 * cur + 1];
                const next = n0 >= 0 && n0 !== prev && !seen.has(n0) ? n0 : n1 >= 0 && n1 !== prev && !seen.has(n1) ? n1 : -1;
                if (next < 0) {
                    if (ids.length > 2 && (n0 === start || n1 === start)) ids.push(start);
                    break;
                }
                seen.add(next); ids.push(next); prev = cur; cur = next;
            }
            if (ids.length > 1) lines.push(ids.map(point));
        };
        for (const e of touched) if (!seen.has(e) && la[2 * e + 1] < 0) walk(e);
        for (const e of touched) if (!seen.has(e)) walk(e);
        for (const e of touched) { la[2 * e] = -1; la[2 * e + 1] = -1; }
        touched.length = 0;
        return lines;
    }

    // Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells
    function distanceField(land, n) {
        const INF = 1e20, d = new Float64Array(n * n), f = new Float64Array(n), z = new Float64Array(n + 1), w = new Int32Array(n);
        for (let i = 0; i < n * n; i++) d[i] = land[i] ? 0 : INF;
        const pass = (o, stride) => {
            for (let q = 0; q < n; q++) f[q] = d[o + q * stride];
            let k = 0;
            w[0] = 0; z[0] = -INF; z[1] = INF;
            for (let q = 1; q < n; q++) {
                if (f[q] >= INF) continue;
                let s;
                for (;;) {
                    const r = w[k];
                    s = f[r] >= INF ? -INF : (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
                    if (s <= z[k] && k > 0) k--; else break;
                }
                if (f[w[0]] >= INF || (k === 0 && s <= z[0])) { w[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
                k++; w[k] = q; z[k] = s; z[k + 1] = INF;
            }
            if (f[w[0]] >= INF) return;
            k = 0;
            for (let q = 0; q < n; q++) {
                while (z[k + 1] < q) k++;
                d[o + q * stride] = (q - w[k]) ** 2 + f[w[k]];
            }
        };
        for (let j = 0; j < n; j++) pass(j * n, 1);
        for (let i = 0; i < n; i++) pass(i, n);
        for (let i = 0; i < n * n; i++) d[i] = Math.sqrt(d[i]);
        return d;
    }

    // ------------------------------------------------------------------
    // Visibility
    // ------------------------------------------------------------------

    // One study: the terrain at sea level `sea` seen through camera C. Builds the
    // floating horizon, a running maximum of the surface's screen height along
    // every screen column, front to back. A point shows when it's above the
    // horizon of everything in front of it.
    let horizonBuf = new Float32Array(0);
    function view(T, C, sea, hide) {
        const { n, h, cell } = T, { k, fx, fy, rx, ry, se, ce } = C, rel = C.relief;
        const Z = (x, y) => {
            const gx = geo.clamp(x / cell, 0, n - 1.000001), gy = geo.clamp(y / cell, 0, n - 1.000001);
            const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j, q = j * n + i;
            return ((h[q] * (1 - tx) + h[q + 1] * tx) * (1 - ty) + (h[q + n] * (1 - tx) + h[q + n + 1] * tx) * ty) * rel;
        };
        const as = [0, L * rx, L * ry, L * (rx + ry)], d1 = L * (fx + fy);
        const a0 = Math.min(...as), a1 = Math.max(...as);
        const cols = Math.min(2400, Math.ceil((a1 - a0) * k / 0.1) + 2), da = (a1 - a0) / (cols - 1);
        const rows = Math.ceil(d1 / (cell * 0.7)) + 2, dd = d1 / (rows - 1);
        if (horizonBuf.length < cols * rows) horizonBuf = new Float32Array(cols * rows);
        const M = horizonBuf, top = new Float32Array(cols);
        for (let c = 0; c < cols; c++) {
            const a = a0 + c * da, bx = a * rx, by = a * ry;
            // the stretch of this column's ground line inside the tile
            const lo = Math.max(fx > 1e-9 ? -bx / fx : -Infinity, fy > 1e-9 ? -by / fy : -Infinity);
            const hi = Math.min(fx > 1e-9 ? (L - bx) / fx : Infinity, fy > 1e-9 ? (L - by) / fy : Infinity);
            let run = -Infinity;
            for (let r = 0, o = c * rows; r < rows; r++, o++) {
                const d = r * dd;
                if (d >= lo - 1e-9 && d <= hi + 1e-9) {
                    const u = d * se + Math.max(Z(bx + d * fx, by + d * fy), sea) * ce;
                    if (u > run) run = u;
                }
                M[o] = run;
            }
            top[c] = run;
        }
        const eps = 0.01 / k;
        const V = {
            Z, top, a0, da, cols, hide,
            // is a point on or above the terrain surface visible?
            see(x, y, z) {
                const d = x * fx + y * fy, r = Math.floor(d / dd) - 1;
                if (r >= 0) {
                    const a = x * rx + y * ry, u = d * se + z * ce, gc = (a - a0) / da;
                    const c = geo.clamp(Math.floor(gc), 0, cols - 2), t = gc - c;
                    if (u < M[c * rows + r] * (1 - t) + M[(c + 1) * rows + r] * t - eps) return false;
                }
                return !hide || !hide(C.P(x, y, z));
            },
            // for things nothing on the terrain can cover, in world or page units
            clear: (x, y, z) => !hide || !hide(C.P(x, y, z)),
            open: q => !hide || !hide(q),
        };
        return V;
    }

    // Visible parts of a 3D polyline as page paths
    function trace(pts, C, V, out, always = false) {
        const see = always ? V.clear : V.see;
        let prev = pts[0], pv = see(prev[0], prev[1], prev[2]), A = C.P(prev[0], prev[1], prev[2]);
        let run = pv ? [A] : null;
        const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        const finish = () => { if (run && run.length > 1 && geo.pathLength(run) > 0.2) out.push(run); run = null; };
        for (let i = 1; i < pts.length; i++) {
            const q = pts[i], B = C.P(q[0], q[1], q[2]);
            const m = always && !V.hide ? 1 : Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 0.2));
            let t0 = 0;
            for (let s = 1; s <= m; s++) {
                const t = s / m, pt = s === m ? q : at(prev, q, t), v = see(pt[0], pt[1], pt[2], pv);
                if (v !== pv) {
                    let lo = t0, hi = t;
                    for (let b = 0; b < 7; b++) {
                        const mid = (lo + hi) / 2, mp = at(prev, q, mid);
                        if (see(mp[0], mp[1], mp[2], pv) === pv) lo = mid; else hi = mid;
                    }
                    const cp = at(prev, q, pv ? lo : hi), cut = C.P(cp[0], cp[1], cp[2]);
                    if (pv) { run.push(cut); finish(); } else run = [cut];
                    pv = v;
                }
                t0 = t;
            }
            if (pv) run.push(B);
            prev = q; A = B;
        }
        finish();
    }

    // Split a 3D polyline where it crosses heights `cuts`, calling emit(band, part)
    function bands(pts, cuts, emit) {
        const band = z => { let b = 0; while (b < cuts.length && z >= cuts[b]) b++; return b; };
        let part = [pts[0]], cur = band(pts[0][2]);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], nb = band(b[2]);
            if (nb !== cur) {
                const dir = nb > cur ? 1 : -1;
                for (let c = cur; c !== nb; c += dir) {
                    const z = cuts[dir > 0 ? c : c - 1], t = (z - a[2]) / (b[2] - a[2]);
                    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z];
                    part.push(q);
                    if (part.length > 1) emit(c, part);
                    part = [q];
                }
                cur = nb;
            }
            part.push(b);
        }
        if (part.length > 1) emit(cur, part);
    }

    // Parts of a polyline above (or below) `level`, cut exactly where it crosses.
    // `flat` replaces the height of what's emitted, for lines drawn at the level.
    function split(pts, level, keepAbove, emit, flat) {
        const inside = q => (q[2] >= level) === keepAbove;
        const put = q => flat === undefined ? q : [q[0], q[1], flat];
        let run = inside(pts[0]) ? [put(pts[0])] : null;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], ina = inside(a), inb = inside(b);
            if (ina !== inb) {
                const t = (level - a[2]) / (b[2] - a[2]), q = put([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level]);
                if (ina) { run.push(q); if (run.length > 1) emit(run); run = null; } else run = [q];
            }
            if (inb) run.push(put(b));
        }
        if (run && run.length > 1) emit(run);
    }

    // ------------------------------------------------------------------
    // Drawing one study
    // ------------------------------------------------------------------

    function drawStudy(T, p, C, sea, zlo, V, put) {
        const { n, h, cell } = T, rel = C.relief, Z = V.Z;
        const cuts = [rel * 0.33, rel * 0.62];
        // a crater lake above the sea is drawn as water, so land lines skip it
        const lk = T.lake && T.lake.level * rel > sea ? T.lake : null, lakeZ = lk ? lk.level * rel : 0;
        const onLake = q => Math.abs(q[2] - lakeZ) < rel * 1e-5 && q[0] >= lk.box[0] && q[0] <= lk.box[2] && q[1] >= lk.box[1] && q[1] <= lk.box[3];
        const dry = (pts, emit) => {
            if (!lk) return emit(pts);
            let run = [pts[0]];
            for (let i = 1; i < pts.length; i++) {
                if (onLake(pts[i - 1]) && onLake(pts[i])) { if (run.length > 1) emit(run); run = [pts[i]]; } else run.push(pts[i]);
            }
            if (run.length > 1) emit(run);
        };
        const land = (pts, VV = V) => dry(pts, d => split(d, sea, true, run => bands(run, cuts, (b, part) => trace(part, C, VV, put(LOW + b)))));
        const sp = p.spacing;
        // screen vectors of the world axes, for spacing lines in paper mm
        const [ex, ey] = axes(C);
        const cross = Math.abs(ex[0] * ey[1] - ex[1] * ey[0]);

        if (p.style === 'ridges' || p.style === 'wire') {
            const ridges = p.style === 'ridges', dirs = ridges ? [C.fy >= C.fx] : [true, false];
            const gap = ridges ? sp : sp * 4.5, e = cell * 1.5, minGap = Math.max(0.4, sp * 0.85);
            for (const ax of dirs) {
                const step = Math.min(L / 12, gap * Math.hypot(...(ax ? ex : ey)) / cross);
                // a runs along the profiles, b across them
                const ar = ax ? C.rx : C.ry, af = ax ? C.fx : C.fy, br = ax ? C.ry : C.rx, bf = ax ? C.fy : C.fx;
                for (let s = step / 2, idx = 0; s < L; s += step, idx++) {
                    const g = s / cell, j = Math.min(n - 2, Math.floor(g)), t = g - j, pts = [];
                    for (let i = 0; i < n; i++) {
                        const z = (ax ? h[j * n + i] * (1 - t) + h[(j + 1) * n + i] * t : h[i * n + j] * (1 - t) + h[i * n + j + 1] * t) * rel;
                        pts.push(ax ? [i * cell, s, z] : [s, i * cell, z]);
                    }
                    if (!ridges) { land(pts); continue; }
                    // Where the ground turns away the profiles bunch up. Line idx
                    // survives down to a local spacing of minGap / 2^(trailing
                    // zeros of idx), so every other line stops first, then every
                    // fourth, and the gaps stay tidy instead of breaking into dashes.
                    let tz = 0;
                    while (tz < 8 && ((idx + 1) >> tz & 1) === 0) tz++;
                    const need = minGap / (1 << tz);
                    land(pts, Object.assign({}, V, {
                        see(x, y, z, was) {
                            if (!V.see(x, y, z)) return false;
                            if (tz >= 8) return true;
                            const zx = (Z(x + e, y) - Z(x - e, y)) / (2 * e), zy = (Z(x, y + e) - Z(x, y - e)) / (2 * e);
                            const za = ax ? zx : zy, zb = ax ? zy : zx, rise = af * C.se + za * C.ce;
                            const D = -br / ar * rise + bf * C.se + zb * C.ce;
                            const gapHere = step * C.k * D * Math.abs(ar) / Math.hypot(ar, rise);
                            return gapHere >= need * (was ? 0.85 : 1.15);
                        },
                    }));
                }
            }
            if (p.style === 'wire') {
                // diagonals through the mesh, like a triangulated wireframe
                const dx = [ex[0] + ey[0], ex[1] + ey[1]], step = gap * Math.hypot(...dx) / cross;
                for (let s = -L + step / 2; s < L; s += step) {
                    const pts = [];
                    for (let q = 0; q < n; q++) {
                        const x = q * cell, y = x - s;
                        if (y >= 0 && y <= L) pts.push([x, y, Z(x, y)]);
                    }
                    if (pts.length > 1) land(pts);
                }
            }
        } else {
            const dz = sp / (C.k * C.ce) * (p.style === 'hachures' ? 5 : 1.6), oc = 0.42 / (C.k * Math.sqrt(C.se));
            const occ = { n: Math.ceil(L / oc), cell: oc, id: 0 };
            occ.cells = new Int32Array(occ.n * occ.n);
            for (let z = Math.ceil((sea + dz * 0.5) / dz) * dz; z < T.hi * rel; z += dz) {
                const lines = isolines(h, n, z / rel, cell);
                if (p.style === 'contours') {
                    for (const line of lines) bands(line.map(q => [q[0], q[1], z]), cuts, (b, part) => trace(part, C, V, put(LOW + b)));
                } else hachure(C, V, cell, lines, z, dz, sea, put, cuts, occ);
            }
        }

        // Water ruled with lines level on the page, gap mm apart, so it reads like
        // a flat wash. Keeps the parts over ground lower than level, inside box.
        const ruled = (gap, level, emit, box) => {
            const dd = gap / (C.k * C.se), d1 = L * (C.fx + C.fy);
            for (let d = dd / 2; d < d1; d += dd) {
                const lo = Math.max(-d * C.fx / C.rx, (L - d * C.fy) / C.ry), hi = Math.min((L - d * C.fx) / C.rx, -d * C.fy / C.ry);
                if (!(hi > lo)) continue;
                const m = Math.ceil((hi - lo) / (cell * 0.7));
                let pts = [];
                for (let q = 0; q <= m + 1; q++) {
                    const a = lo + (hi - lo) * Math.min(q, m) / m, x = geo.clamp(a * C.rx + d * C.fx, 0, L), y = geo.clamp(a * C.ry + d * C.fy, 0, L);
                    if (q <= m && (!box || (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]))) { pts.push([x, y, Z(x, y)]); continue; }
                    if (pts.length > 1) split(pts, level, false, emit, level);
                    pts = [];
                }
            }
        };

        // coastline
        for (const line of isolines(h, n, sea / rel, cell)) trace(line.map(q => [q[0], q[1], sea]), C, V, put(COAST));

        // water
        if (p.sea === 'ripples' || p.sea === 'both') {
            const mask = new Uint8Array(n * n), ls = sea / rel;
            for (let i = 0; i < n * n; i++) mask[i] = h[i] >= ls ? 1 : 0;
            const dist = distanceField(mask, n), scale = C.k * Math.sqrt(C.se);
            let r = 0, gap = Math.max(0.5, sp * 1.2);
            for (let q = 0; q < p.ripples; q++) {
                r += gap; gap *= 1.28;
                for (const line of isolines(dist, n, r / scale / cell, cell)) trace(line.map(pt => [pt[0], pt[1], sea]), C, V, put(WATER));
            }
        }
        if (lk) {
            const [bx0, by0, bx1, by1] = lk.box, inBox = q => q[0] >= bx0 && q[0] <= bx1 && q[1] >= by0 && q[1] <= by1;
            for (const line of isolines(h, n, lk.level + 1e-5, cell)) {
                let run = [];
                for (const q of line) {
                    if (inBox(q)) run.push([q[0], q[1], lakeZ]);
                    else { if (run.length > 1) trace(run, C, V, put(COAST)); run = []; }
                }
                if (run.length > 1) trace(run, C, V, put(COAST));
            }
            ruled(Math.max(0.45, sp * 1.3), lakeZ + rel * 2e-5, run => { if (run.every(inBox)) trace(run, C, V, put(WATER)); }, lk.box);
        }
        if (p.sea === 'ruled' || p.sea === 'both') ruled((p.sea === 'both' ? 2.2 : 1) * Math.max(0.45, sp * 1.3), sea, run => trace(run, C, V, put(WATER)));

        // tile edges at the surface: the back two only show over the terrain
        const edge = (x0, y0, x1, y1) => {
            const pts = [];
            for (let q = 0; q < n; q++) {
                const x = x0 + (x1 - x0) * q / (n - 1), y = y0 + (y1 - y0) * q / (n - 1);
                pts.push([x, y, Z(x, y)]);
            }
            return pts;
        };
        const front = [edge(0, L, 0, 0), edge(0, 0, L, 0)], back = [edge(L, 0, L, L), edge(0, L, L, L)];
        for (const pts of back) {
            split(pts, sea, false, run => trace(run, C, V, put(WATER)), sea);
            split(pts, sea, true, run => trace(run, C, V, put(ROCK)));
        }
        for (const pts of front) {
            split(pts, sea, false, run => trace(run, C, V, put(WATER), true), sea);
            if (!p.cutaway) {
                split(pts, sea, true, run => trace(run, C, V, put(ROCK), true));
                // the tile edge under the land too, so the terrain sits on the water
                split(pts, sea, true, run => trace(run, C, V, put(WATER), true), sea);
            }
        }
        if (p.cutaway) section(p, C, sea, zlo, V, put, front);
    }

    // Hachures: short strokes down the fall line between two contour levels,
    // packed closer where the slope is steeper. Fall lines converge in gullies,
    // so a plan view grid remembers which stroke owns each spot and a stroke
    // stops when it runs into another one.
    function hachure(C, V, cell, lines, z, dz, sea, put, cuts, occ) {
        const Z = V.Z, e = cell * 0.7;
        const grad = (x, y) => [(Z(x + e, y) - Z(x - e, y)) / (2 * e), (Z(x, y + e) - Z(x, y - e)) / (2 * e)];
        const floor = Math.max(sea, z - dz), scale = C.k * Math.sqrt(C.se);
        const slot = (x, y) => Math.min(occ.n - 1, Math.floor(y / occ.cell)) * occ.n + Math.min(occ.n - 1, Math.floor(x / occ.cell));
        for (const line of lines) {
            let carry = 0;
            for (let i = 1; i < line.length; i++) {
                const a = line[i - 1], b = line[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
                let t = carry;
                while (t < seg) {
                    const x = a[0] + (b[0] - a[0]) * t / seg, y = a[1] + (b[1] - a[1]) * t / seg;
                    const [gx, gy] = grad(x, y), slope = Math.hypot(gx, gy), id = ++occ.id;
                    if (slope > 0.08 && !occ.cells[slot(x, y)]) {
                        const pts = [[x, y, z]], mine = [slot(x, y)];
                        let px = x, py = y;
                        for (let s = 0; s < 40; s++) {
                            const [qx, qy] = grad(px, py), g = Math.hypot(qx, qy);
                            if (g < 1e-6) break;
                            px -= qx / g * cell * 0.6; py -= qy / g * cell * 0.6;
                            if (px < 0 || py < 0 || px > L || py > L) break;
                            const q = slot(px, py), owner = occ.cells[q];
                            if (owner && owner !== id) break;
                            mine.push(q);
                            const pz = Z(px, py);
                            if (pz <= floor) { pts.push([px, py, floor]); break; }
                            pts.push([px, py, pz]);
                        }
                        for (const q of mine) occ.cells[q] = id;
                        if (pts.length > 1) bands(pts, cuts, (bd, part) => trace(part, C, V, put(LOW + bd)));
                    }
                    t += geo.lerp(2.2, 0.55, geo.smoothstep(0.1, 1.4, slope)) / scale;
                }
                carry = t - seg;
            }
        }
    }

    // Cutaway: the two front faces of the block, with the water standing in
    // section over the sea bed and wavy strata below.
    function section(p, C, sea, zlo, V, put, front) {
        const N3 = PG.makeNoise(new PG.RNG(PG.iso.hash(p.seedBase, 77)));
        // both faces as one strip from the left corner round to the right
        const strip = front[0].concat(front[1].slice(1)), m = strip.length;
        for (const q of [strip[0], strip[(m - 1) / 2], strip[m - 1]]) trace([[q[0], q[1], zlo], [q[0], q[1], Math.max(q[2], sea)]], C, V, put(ROCK), true);
        for (const face of front) trace([[face[0][0], face[0][1], zlo], [face[face.length - 1][0], face[face.length - 1][1], zlo]], C, V, put(ROCK), true);
        trace(strip, C, V, put(ROCK), true);
        // water in section: level lines from the bed up to the surface
        const cosX = Math.abs(C.rx) / Math.hypot(C.rx, C.fx * C.se), cosY = Math.abs(C.ry) / Math.hypot(C.ry, C.fy * C.se);
        const wdz = Math.max(0.5, p.spacing * 1.2) / (C.k * C.ce * Math.min(cosX, cosY));
        for (const face of front) for (let z = sea - wdz; z > zlo; z -= wdz) split(face, z, false, run => trace(run, C, V, put(SECTION), true), z);
        // Strata, the same rocks in every study, stopping short of the surface.
        // Each bed gets a texture: dashes for shale, dots for sandstone, and the
        // bottom one is bedrock with slanted strokes.
        const gap = Math.max(1.6, p.spacing * 4) / (C.k * C.ce), out = put(STRATA);
        const count = Math.ceil((Math.max(...strip.map(q => q[2])) - zlo) / gap) + 2;
        const bed = (l, s) => l <= 0 ? zlo : zlo + l * gap + gap * 0.9 * N3.fbm2(s * 3 + l * 0.37, l * 1.7, 3) + (s - 0.5) * gap * 1.5;
        const inside = (z, i) => z > zlo + gap * 0.3 && z < strip[i][2] - gap * 0.35;
        const runs = (zf, emit) => {
            let seg = null;
            for (let i = 0; i < m; i++) {
                const z = zf(i, i / (m - 1));
                if (inside(z, i)) (seg = seg || []).push([strip[i][0], strip[i][1], z]);
                else { if (seg && seg.length > 1) emit(seg); seg = null; }
            }
            if (seg && seg.length > 1) emit(seg);
        };
        const textures = ['plain', 'dash', 'dots', 'plain', 'dash', 'dots'], rot = Math.abs(PG.iso.hash(p.seedBase, 78)) % 3;
        for (let l = 0; l < count; l++) {
            if (l > 0) runs((i, t) => bed(l, t), seg => trace(seg, C, V, out, true));
            const kind = l === 0 ? 'bedrock' : textures[(l + rot) % textures.length];
            const mid = f => (i, t) => geo.lerp(bed(l, t), bed(l + 1, t), f);
            const page = seg => seg.map(q => C.P(q[0], q[1], q[2]));
            if (kind === 'dash') runs(mid(0.5), seg => chop(page(seg), 1.4, 1, 0, out, V));
            else if (kind === 'dots') {
                runs(mid(0.33), seg => chop(page(seg), 0.25, 1.1, 0, out, V));
                runs(mid(0.67), seg => chop(page(seg), 0.25, 1.1, 0.67, out, V));
            } else if (kind === 'bedrock') {
                // short strokes leaning across the bed, about 1.3 mm apart
                const every = Math.max(1, Math.round(1.3 / (C.k * L / (m - 1) * 0.8)));
                for (let i = every; i + every < m; i += every) {
                    const t = i / (m - 1), j = i + Math.round(every * 0.6);
                    const z0 = geo.lerp(bed(0, t), bed(1, t), 0.2), z1 = geo.lerp(bed(0, t), bed(1, t), 0.8);
                    if (j < m && inside(z0, i) && inside(z1, j) && (i < (m - 1) / 2) === (j < (m - 1) / 2)) {
                        const A = [strip[i][0], strip[i][1], z0], B = [strip[j][0], strip[j][1], z1];
                        if (V.clear(...A) && V.clear(...B)) out.push([C.P(...A), C.P(...B)]);
                    }
                }
            }
        }
    }

    // Cut a page path into dashes, on and off in mm, starting partway into a
    // period. Dashes something else covers are dropped.
    function chop(path, on, off, phase, out, V) {
        const period = on + off;
        let t = phase * period, cur = t < on ? [path[0]] : null;
        const done = () => { if (cur && cur.length > 1 && cur.every(q => V.open(q))) out.push(cur); cur = null; };
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            let u = 0;
            while (u < len - 1e-9) {
                const edge = t < on ? on : period, step = Math.min(len - u, edge - t);
                u += step; t += step;
                const q = [a[0] + (b[0] - a[0]) * u / len, a[1] + (b[1] - a[1]) * u / len];
                if (cur) cur.push(q);
                if (t >= period - 1e-9) { t = 0; cur = [q]; } else if (t >= on - 1e-9 && cur) done();
            }
        }
        done();
    }

    // ------------------------------------------------------------------
    // Survey marks
    // ------------------------------------------------------------------

    // Page vectors for one world unit along x and y on the ground
    const axes = C => [[C.k * C.rx, -C.k * C.fx * C.se], [C.k * C.ry, -C.k * C.fy * C.se]];
    const hatchPoly = (poly, gap, angle, out) => { for (const [a, b] of geo.hatch([poly], gap, angle)) out.push([a, b]); };

    // A checkered border along the front edges of the tile, like the neatline
    // of an old map sheet, one square per tenth of the side
    function border(C, V, z, put) {
        const [ex, ey] = axes(C), sx = Math.hypot(...ex), sy = Math.hypot(...ey);
        const o = [[0.7 / sx, 0.7 / sy], [1.7 / sx, 1.7 / sy]], out = put(NOTES);
        const lineAt = f => {
            const ax = o[0][0] + (o[1][0] - o[0][0]) * f, ay = o[0][1] + (o[1][1] - o[0][1]) * f;
            return [[-ax, L, z], [-ax, -ay, z], [L, -ay, z]];
        };
        for (const f of [0, 1]) trace(lineAt(f), C, V, out, true);
        for (let j = 0; j <= 10; j++) {
            const t = L * j / 10;
            if (j > 0) {
                trace([[-o[0][0], t, z], [-o[1][0], t, z]], C, V, out, true);
                trace([[t, -o[0][1], z], [t, -o[1][1], z]], C, V, out, true);
            } else trace([[-o[0][0], -o[0][1], z], [-o[1][0], -o[1][1], z]], C, V, out, true);
            if (j % 2 || j === 10) continue;
            for (const f of [1 / 3, 2 / 3]) {
                const ax = o[0][0] + (o[1][0] - o[0][0]) * f, ay = o[0][1] + (o[1][1] - o[0][1]) * f;
                trace([[-ax, t, z], [-ax, t + L / 10, z]], C, V, out, true);
                trace([[t, -ay, z], [t + L / 10, -ay, z]], C, V, out, true);
            }
        }
    }

    // A tide staff by the left or right corner (side -1 or 1), sharing the
    // block's height scale, with the water standing in it and a pointer at the
    // current level. Short ticks on the outside mark the rest of the series.
    function staff(C, V, sea, levels, z0, z1, side, put) {
        const P = z => side > 0 ? C.P(L, 0, z) : C.P(0, L, z), w = 1.1, rel = C.relief, notes = put(NOTES);
        const X = P(0)[0] + side * 3.2, Xo = X + side * w, x = t => X + side * t;
        const add = (pts, out = notes) => { if (pts.every(q => V.open(q))) out.push(pts); };
        const y0 = P(z0)[1], y1 = P(z1)[1];
        add([[X, y0], [Xo, y0], [Xo, y1], [X, y1], [X, y0]]);
        const step = rel / 10;
        for (let z = Math.ceil(z0 / step) * step; z <= z1 + 1e-9; z += step) {
            const y = P(z)[1], major = Math.abs(Math.round(z / step) % 5) === 0;
            add([[x(-(major ? 1.4 : 0.7)), y], [X, y]]);
        }
        const ys = P(sea)[1];
        for (let y = y0 - 0.45; y > ys + 0.1; y -= 0.45) add([[x(0.2), y], [x(w - 0.2), y]], put(SECTION));
        for (const l of levels) {
            const y = P(l)[1];
            if (Math.abs(l - sea) < 1e-9) {
                add([[x(w + 0.35), y], [x(w + 2.3), y - 1.05], [x(w + 2.3), y + 1.05], [x(w + 0.35), y]]);
                add([[x(w + 0.9), y], [x(w + 2.1), y - 0.62], [x(w + 2.1), y + 0.62], [x(w + 0.9), y]]);
            } else add([[x(w + 0.35), y], [x(w + 1.3), y]]);
        }
    }

    // Compass rose lying flat on the ground, north towards the far corner of
    // the tile, so it turns with the view
    function rose(C, cx, cy, R, out) {
        const [ex, ey] = axes(C), r = R / C.k;
        const at = (a, rad) => [cx + (Math.cos(a) * ex[0] + Math.sin(a) * ey[0]) * rad * r, cy + (Math.cos(a) * ex[1] + Math.sin(a) * ey[1]) * rad * r];
        const north = Math.PI / 4;
        const ring = [];
        for (let i = 0; i <= 48; i++) ring.push(at(i / 48 * Math.PI * 2, 0.62));
        out.push(ring);
        for (let m = 0; m < 4; m++) {
            const a = north + m * Math.PI / 2, tip = at(a, m === 0 ? 1.45 : 1), left = at(a + Math.PI / 4, 0.24), right = at(a - Math.PI / 4, 0.24), mid = at(0, 0);
            out.push([left, tip, right]);
            out.push([tip, mid]);
            // shade one half of each point
            const half = [mid, tip, left], ang = Math.atan2(tip[1] - mid[1], tip[0] - mid[0]);
            hatchPoly(half, 0.38, ang, out);
        }
    }

    // Scale bar, four tenths of the tile side, measured across the page where
    // the view doesn't foreshorten
    function scaleBar(C, x, y, out) {
        const seg = L / 10 * C.k, h = 1.3;
        out.push([[x, y], [x + 4 * seg, y], [x + 4 * seg, y + h], [x, y + h], [x, y]]);
        for (let i = 1; i < 4; i++) out.push([[x + i * seg, y], [x + i * seg, y + h]]);
        for (let i = 0; i < 4; i += 2) for (const f of [1 / 3, 2 / 3]) out.push([[x + i * seg, y + h * f], [x + (i + 1) * seg, y + h * f]]);
        for (let i = 1; i < 5; i++) out.push([[x + seg * i / 5, y + h], [x + seg * i / 5, y + h + 0.6]]);
    }

    // Coarse map of where ink already is, for finding room for the legend
    function occupancy(groups, W, H, cell) {
        const gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1, used = new Uint8Array(gw * gh);
        const mark = (x, y) => {
            const i = Math.floor(x / cell), j = Math.floor(y / cell);
            if (i >= 0 && j >= 0 && i < gw && j < gh) used[j * gw + i] = 1;
        };
        for (const paths of groups) for (const path of paths) for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i], m = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5));
            for (let s = 0; s <= m; s++) mark(a[0] + (b[0] - a[0]) * s / m, a[1] + (b[1] - a[1]) * s / m);
        }
        // summed area table, so any rectangle can be tested at once
        const sat = new Int32Array((gw + 1) * (gh + 1));
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            sat[(j + 1) * (gw + 1) + i + 1] = used[j * gw + i] + sat[j * (gw + 1) + i + 1] + sat[(j + 1) * (gw + 1) + i] - sat[j * (gw + 1) + i];
        }
        const free = (x, y, w, h) => {
            const i0 = Math.floor(x / cell), j0 = Math.floor(y / cell), i1 = Math.ceil((x + w) / cell), j1 = Math.ceil((y + h) / cell);
            if (i0 < 0 || j0 < 0 || i1 > gw || j1 > gh) return false;
            return sat[j1 * (gw + 1) + i1] - sat[j0 * (gw + 1) + i1] - sat[j1 * (gw + 1) + i0] + sat[j0 * (gw + 1) + i0] === 0;
        };
        // the free w x h spot nearest (ax, ay), inside the drawing area
        return (w, h, ax, ay) => {
            let best = null, bd = Infinity;
            for (let y = 0; y + h <= H; y += cell) for (let x = 0; x + w <= W; x += cell) {
                const d = Math.hypot(x + w / 2 - ax, y + h / 2 - ay);
                if (d < bd && free(x, y, w, h)) { bd = d; best = [x, y]; }
            }
            return best;
        };
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    // Where each study goes on the page. Every study's outline at unit scale
    // (highest and lowest screen height per sideways bin, with its tide staff
    // and border) is dropped down against the ones before it, so diamonds that
    // are offset sideways nest into each other. Layouts only differ in the
    // sideways offsets. Sizes in mm depend on the scale, so it runs a few times.
    function arrange(p, layout, W, H, T0, levels, zlo, rel, c) {
        const n = levels.length, { fx, fy, rx, ry, se, ce } = c;
        const aL = L * ry, NB = 120, wb = (L * rx - aL) / NB, tileW = L * rx - aL;
        const outline = levels.map(sea => {
            const shift = p.cutaway ? 0 : sea, top = new Float64Array(NB).fill(-Infinity), bot = new Float64Array(NB);
            for (let j = 0; j < T0.n; j++) for (let i = 0; i < T0.n; i++) {
                const x = i * T0.cell, y = j * T0.cell, b = Math.min(NB - 1, Math.floor((x * rx + y * ry - aL) / wb));
                const u = (x * fx + y * fy) * se + (Math.max(sea, T0.h[j * T0.n + i] * rel) - shift) * ce;
                if (u > top[b]) top[b] = u;
            }
            const zb = (p.cutaway ? zlo : sea) - shift;
            for (let b = 0; b < NB; b++) {
                const a = aL + (b + 0.5) * wb;
                bot[b] = (a >= 0 ? a / rx * fx : a / ry * fy) * se + zb * ce;
                if (top[b] === -Infinity) top[b] = b ? top[b - 1] : bot[b];
            }
            // tide staff, from the lowest ground (or block bottom) to the highest
            const staffU = cy => [cy * se + (Math.min(zb + shift, T0.lo * rel) - shift) * ce, cy * se + (T0.hi * rel - shift) * ce];
            return { top, bot, right: staffU(L * fx), left: staffU(L * fy) };
        });
        const staffs = p.marks && layout !== 'stack';
        const cols = n <= 2 ? n : W > H * 1.2 ? Math.ceil(n / 2) : 2;
        const offsets = (k, s) => {
            const pitch = tileW + (staffs ? 9 : 4) / k;
            return Array.from({ length: n }, (_, i) => {
                if (layout === 'zigzag') return [(i % 2 ? 0.5 : -0.5) * s, i % 2 ? 1 : -1];
                if (layout === 'cascade') return [(i - (n - 1) / 2) * s, 1];
                if (layout === 'row') return [(i - (n - 1) / 2) * pitch, 1];
                if (layout === 'grid') {
                    const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols);
                    return [(i % cols - (inRow - 1) / 2) * pitch, 1];
                }
                return [0, 1];
            });
        };
        const run = (k, s) => {
            const gap = 3 / k, band = p.marks ? 2.6 / k : 0, sIn = Math.round(3 / k / wb), sOut = staffs ? Math.ceil(7 / k / wb) : 0;
            const studies = offsets(k, s).map(([A, side], i) => {
                const o = Math.round(A / wb), O = outline[i], top = new Map(), bot = new Map();
                for (let b = 0; b < NB; b++) { top.set(o + b, O.top[b]); bot.set(o + b, O.bot[b] - band); }
                if (staffs) {
                    const [lo, hi] = side > 0 ? O.right : O.left;
                    for (let b = sIn; b < sOut; b++) {
                        const g = side > 0 ? o + NB + b : o - 1 - b;
                        top.set(g, hi); bot.set(g, lo);
                    }
                }
                return { o, side, top, bot };
            });
            const U = [];
            studies.forEach((st, i) => {
                let u = null;
                for (let j = 0; j < i; j++) {
                    let need = -Infinity;
                    for (const [g, t] of st.top) if (studies[j].bot.has(g)) need = Math.max(need, t - studies[j].bot.get(g));
                    if (need > -Infinity) u = Math.min(u ?? Infinity, U[j] - need - gap);
                }
                U.push(u ?? (i ? U[i - 1] : 0));
            });
            let g0 = Infinity, g1 = -Infinity, u0 = Infinity, u1 = -Infinity;
            studies.forEach((st, i) => {
                for (const g of st.top.keys()) { g0 = Math.min(g0, g); g1 = Math.max(g1, g + 1); }
                for (const t of st.top.values()) u1 = Math.max(u1, t + U[i]);
                for (const b of st.bot.values()) u0 = Math.min(u0, b + U[i]);
            });
            const kk = Math.max(1e-3, Math.min(W * 0.96 / ((g1 - g0) * wb), H * 0.95 / (u1 - u0)));
            const X = (W - (g1 - g0) * wb * kk) / 2, Y = (H - (u1 - u0) * kk) / 2;
            return {
                k: kk,
                pos: studies.map((st, i) => ({ ox: X + (-aL + (st.o - g0) * wb) * kk, oy: Y + (u1 - U[i]) * kk, side: st.side })),
            };
        };
        const solve = s => {
            let k = Math.min(W / tileW, H / (n * tileW * 0.6)), r;
            for (let it = 0; it < 3; it++) { r = run(k, s); k = r.k; }
            return r;
        };
        if (layout === 'zigzag' || layout === 'cascade') {
            const spreads = layout === 'zigzag' ? [0.2, 0.35, 0.5, 0.65, 0.8] : [0.25, 0.4, 0.55, 0.7, 0.85, 1];
            return spreads.map(f => solve(f * tileW)).reduce((a, b) => b.k > a.k ? b : a);
        }
        return solve(0);
    }

    function camera(yaw, elev, k, ox, oy, shift, relief) {
        const th = geo.rad(yaw), el = geo.rad(elev);
        const fx = Math.sin(th), fy = Math.cos(th), rx = fy, ry = -fx, se = Math.sin(el), ce = Math.cos(el);
        return {
            k, fx, fy, rx, ry, se, ce, relief,
            P: (x, y, z) => [ox + k * (x * rx + y * ry), oy - k * ((x * fx + y * fy) * se + (z - shift) * ce)],
        };
    }

    PG.register({
        id: 'tidal', name: 'Tidal Atlas', category: 'Scenes', fit: false,
        description: 'One eroded landscape drawn again and again as the sea rises, its valleys drowning into fjords and its ridges into island chains.',
        params: [
            { type: 'section', label: 'Studies' },
            { id: 'studies', label: 'Studies', type: 'range', min: 1, max: 6, step: 1, value: 4, random: [3, 4] },
            { id: 'layout', label: 'Arrangement', type: 'select', value: 'zigzag', random: ['auto', 'zigzag', 'zigzag', 'cascade', 'stack'],
                options: [['auto', 'Fit to paper'], ['column', 'Vertical sequence'], ['zigzag', 'Zigzag'], ['cascade', 'Cascade'],
                    ['row', 'Horizontal strip'], ['grid', 'Grid'], ['stack', 'Exploded stack']] },
            { id: 'first', label: 'Flooded at first (%)', type: 'range', min: 0, max: 90, step: 1, value: 28, random: [18, 36] },
            { id: 'last', label: 'Flooded at last (%)', type: 'range', min: 10, max: 99, step: 1, value: 93, random: [85, 97], show: p => p.studies > 1 },
            { type: 'section', label: 'Land' },
            { id: 'land', label: 'Landform', type: 'select', value: 'alpine', random: true,
                options: [['alpine', 'Alpine massif'], ['fjords', 'Fjord coast'], ['archipelago', 'Archipelago'], ['volcano', 'Volcanic island']] },
            { id: 'relief', label: 'Relief (%)', type: 'range', min: 10, max: 60, step: 1, value: 38, random: [28, 44] },
            { id: 'rough', label: 'Rock texture', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4, random: [0.2, 0.6] },
            { id: 'yaw', label: 'Turn (°)', type: 'range', min: 10, max: 80, step: 1, value: 45, random: [35, 55] },
            { id: 'elev', label: 'View height (°)', type: 'range', min: 20, max: 65, step: 1, value: 32, random: [28, 42] },
            { type: 'section', label: 'Linework' },
            { id: 'style', label: 'Terrain lines', type: 'select', value: 'ridges', random: ['ridges', 'ridges', 'contours', 'wire', 'hachures'],
                options: [['ridges', 'Fine ridges'], ['contours', 'Elevation contours'], ['hachures', 'Hachures'], ['wire', 'Wire mesh']] },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.35, max: 1.5, step: 0.05, value: 0.45, random: false },
            { id: 'sea', label: 'Water', type: 'select', value: 'ripples', random: ['ripples', 'ripples', 'ruled', 'both'],
                options: [['ripples', 'Coastal ripples'], ['ruled', 'Ruled'], ['both', 'Ripples & ruled'], ['plain', 'Outline only']] },
            { id: 'ripples', label: 'Ripple lines', type: 'range', min: 1, max: 14, step: 1, value: 7, random: [5, 9], show: p => p.sea === 'ripples' || p.sea === 'both' },
            { id: 'cutaway', label: 'Cutaway block', type: 'checkbox', value: true, random: 0.6 },
            { id: 'base', label: 'Block depth (%)', type: 'range', min: 5, max: 50, step: 1, value: 26, random: false, show: p => p.cutaway },
            { id: 'marks', label: 'Survey marks', type: 'checkbox', value: true },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        // Pairings that look right: wire and hachures get quiet water, the stack
        // doesn't want too many studies, and islands need a first tide high
        // enough to cover the low ground between them. Without the block, half the time
        // the water gets the flat ruled wash.
        randomize(rng, p) {
            const q = {};
            if (p.style === 'wire' || p.style === 'hachures') q.sea = rng.pick(['ripples', 'ripples', 'plain']);
            if (p.layout === 'stack') q.studies = rng.int(3, 4);
            if (p.land === 'archipelago' || p.land === 'volcano') q.first = rng.int(20, 34);
            if (!p.cutaway && q.sea === undefined && rng.chance(0.5)) q.sea = 'ruled';
            return q;
        },
        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            // the spiky landforms get a little less height for the same setting
            const n = p.studies, seed = ctx.seed | 0, rel = L * p.relief / 100 * { alpine: 1, fjords: 0.85, archipelago: 0.75, volcano: 0.9 }[p.land];
            const th = geo.rad(p.yaw), el = geo.rad(p.elev);
            const c = { fx: Math.sin(th), fy: Math.cos(th), rx: Math.cos(th), ry: -Math.sin(th), se: Math.sin(el), ce: Math.cos(el) };
            // a coarse copy of the terrain for sizing the layout
            const T0 = terrain(p.land, seed, 129, p.rough);
            const zlo = p.cutaway ? Math.min(-rel * p.base / 100, T0.lo * rel - rel * 0.03) : 0;
            const seaAt = (T, i) => rel * T.quantile((n === 1 ? p.first : geo.lerp(p.first, p.last, i / (n - 1))) / 100);
            // with a cutaway the block stays put and the water climbs it, otherwise
            // the water plane stays put and the land sinks into it
            const shiftOf = sea => p.cutaway ? 0 : sea;
            let layout = p.layout;
            if (n === 1 && layout !== 'stack') layout = 'column';
            const levels0 = Array.from({ length: n }, (_, i) => seaAt(T0, i));
            let placed;
            if (layout === 'auto') {
                const tries = ['column', 'zigzag', 'row', 'grid'].map(name => ({ name, r: arrange(p, name, W, H, T0, levels0, zlo, rel, c) }));
                const best = tries.reduce((a, b) => b.r.k > a.r.k * 1.04 ? b : a);
                layout = best.name; placed = best.r;
            } else if (layout === 'stack') {
                let uTop = -Infinity, uBot = Infinity;
                for (const sea of levels0) {
                    const shift = shiftOf(sea);
                    uBot = Math.min(uBot, ((p.cutaway ? zlo : sea) - shift) * c.ce);
                    for (let j = 0; j < T0.n; j += 2) for (let q = 0; q < T0.n; q += 2) {
                        const x = q * T0.cell, y = j * T0.cell;
                        uTop = Math.max(uTop, (x * c.fx + y * c.fy) * c.se + (Math.max(sea, T0.h[j * T0.n + q] * rel) - shift) * c.ce);
                    }
                }
                const bh = uTop - uBot, width = L * (c.rx - c.ry), below = p.marks ? 2.6 : 0, overlap = 0.42;
                const k = Math.max(1e-3, Math.min(W * 0.94 / width, (H * 0.94 - below) / (bh * (1 + (n - 1) * overlap))));
                const y0 = (H - bh * k * (1 + (n - 1) * overlap) - below) / 2;
                placed = { k, pos: levels0.map((_, i) => ({ ox: (W - width * k) / 2 - L * c.ry * k, oy: y0 + i * bh * k * overlap + uTop * k, side: 1 })) };
            } else placed = arrange(p, layout, W, H, T0, levels0, zlo, rel, c);
            const k = placed.k;
            let rn = geo.clamp(Math.round(L * k / 0.28), 129, 449);
            rn -= (rn - 1) % 8;
            const T = terrain(p.land, seed, rn, p.rough);
            const levels = levels0.map((_, i) => seaAt(T, i));
            const groups = Array.from({ length: 9 }, () => []), footprints = [], q0 = Object.assign({ seedBase: seed }, p);
            let C0 = null;
            for (let i = 0; i < n; i++) {
                const { ox, oy, side } = placed.pos[i], sea = levels[i], shift = shiftOf(sea);
                const C = camera(p.yaw, p.elev, k, ox, oy, shift, rel);
                C0 = C0 || C;
                const hide = layout === 'stack' && i > 0 ? q => footprints.some(fp => fp(q)) : null;
                const V = view(T, C, sea, hide), bottom = p.cutaway ? zlo : sea;
                const put = g => groups[g];
                drawStudy(T, q0, C, sea, bottom, V, put);
                if (p.marks) {
                    border(C, V, bottom, put);
                    if (layout !== 'stack') staff(C, V, sea, levels, Math.min(bottom, T.lo * rel), T.hi * rel, side, put);
                }
                if (layout === 'stack') {
                    const { top, a0, da, cols } = V;
                    footprints.push(([X, Y]) => {
                        const a = (X - ox) / k, q = Math.round((a - a0) / da);
                        if (q < 0 || q >= cols || top[q] === -Infinity) return false;
                        return Y > oy - k * (top[q] - shift * c.ce) && Y < C.P(a >= 0 ? a / c.rx : 0, a < 0 ? a / c.ry : 0, bottom)[1];
                    });
                }
            }
            if (p.marks) {
                const find = occupancy(groups, W, H, 1.5), R = geo.clamp(Math.min(W, H) * 0.028, 3, 14);
                const spot = find(R * 3.4, R * 3.4, 0, 0);
                if (spot) rose(C0, spot[0] + R * 1.7, spot[1] + R * 1.7, R, groups[NOTES]);
                const len = 4 * L / 10 * C0.k;
                const bar = find(len + 3, 4.5, W, H);
                if (bar) scaleBar(C0, bar[0] + 1.5, bar[1] + 1.5, groups[NOTES]);
            }
            const layers = PG.pens.layers(p.pens);
            // groups: surface water, coast, low, mid and high land, water in section,
            // block outline, strata, survey marks. Layer i gets the profile's i-th ink.
            const maps = [
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 1, 1, 1, 0, 1, 1, 1],
                [0, 1, 1, 1, 1, 0, 2, 2, 2],
                [0, 1, 3, 1, 1, 0, 2, 2, 2],
                [0, 1, 3, 1, 1, 0, 2, 2, 4],
                [5, 0, 3, 1, 1, 0, 2, 2, 4],
                [5, 0, 3, 6, 1, 0, 2, 2, 4],
                [5, 0, 3, 6, 1, 0, 2, 7, 4],
            ][layers.length - 1];
            groups.forEach((paths, g) => { for (const q of paths) layers[maps[g]].push(q); });
            return { layers };
        },
    });
})();
