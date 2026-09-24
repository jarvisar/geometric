/*
 * Image — a photo translated into plotter lines. The luminance raster is
 * sampled bilinearly ('cover' or 'contain' fit), then shaped by contrast,
 * gamma and invert. Four renderings:
 *   spiral   — one Archimedean spiral from the centre whose sideways squiggle
 *              grows with darkness (the "SpiralBetty" look), one stroke;
 *   squiggle — horizontal rows with the same darkness-driven squiggle;
 *   hatch    — up to four cross-hatch layers (45°, 135°, 0°, 90°), each drawn
 *              only where darkness passes its threshold;
 *   tsp      — TSP art (after Kaplan & Bosch, 2005): darkness-weighted
 *              stipples by dart throwing, evened out by weighted Lloyd
 *              relaxation (Secord, 2002), then a single tour built by
 *              nearest-neighbour and improved with 2-opt and Or-opt moves on
 *              neighbour lists under a time budget.
 * Without an image a small ray-traced still life of spheres is used.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // ---- built-in demo: three spheres on a floor with soft shadows and
    // occlusion (sphere shadow / occlusion approximations after Inigo Quilez)
    let demo = null;
    function demoImage() {
        if (demo) return demo;
        const w = 240, h = 320, data = new Float32Array(w * h);
        const S = [[-0.42, 1.05, 0.45, 1.05], [1.02, 0.6, -0.7, 0.6], [-1.08, 0.36, -1.25, 0.36]];
        const nz = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
        const [Lx, Ly, Lz] = nz(-0.6, 0.72, -0.35);
        const ox = 0.3, oy = 1.85, oz = -5.9;
        const [fx, fy, fz] = nz(0.05 - ox, 0.62 - oy, 0 - oz);
        const [rx, , rz] = nz(fz, 0, -fx);
        const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
        // soft shadow toward the light from point p (skipping sphere `skip`)
        const shadow = (px, py, pz, skip) => {
            let res = 1;
            for (let i = 0; i < 3; i++) {
                if (i === skip) continue;
                const s = S[i], cx = px - s[0], cy = py - s[1], cz = pz - s[2];
                const b = cx * Lx + cy * Ly + cz * Lz, hh = b * b - (cx * cx + cy * cy + cz * cz - s[3] * s[3]);
                const t = -b - Math.sqrt(Math.max(hh, 0));
                if (t <= 0) continue;
                const d = Math.sqrt(Math.max(0, s[3] * s[3] - hh)) - s[3];
                res = Math.min(res, geo.smoothstep(0, 1, (8 * d) / t));
            }
            return res;
        };
        const occlusion = (px, py, pz, nx, ny, nzz, skip) => {
            let occ = 1;
            for (let i = 0; i < 3; i++) {
                if (i === skip) continue;
                const s = S[i], dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz, l2 = dx * dx + dy * dy + dz * dz, l = Math.sqrt(l2);
                occ *= 1 - (Math.max(0, (nx * dx + ny * dy + nzz * dz) / l) * s[3] * s[3]) / l2;
            }
            return occ;
        };
        const sky = dy => 0.66 + 0.06 * geo.smoothstep(0.2, 0, dy); // light backdrop, darker upward
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const u = ((2 * (i + 0.5)) / w - 1) * (w / h), v = 1 - (2 * (j + 0.5)) / h;
            const [dx, dy, dz] = nz(fx * 2.2 + rx * u + ux * v, fy * 2.2 + uy * v, fz * 2.2 + rz * u + uz * v);
            let t = Infinity, hit = -2;
            for (let k = 0; k < 3; k++) {
                const s = S[k], cx = ox - s[0], cy = oy - s[1], cz = oz - s[2];
                const b = cx * dx + cy * dy + cz * dz, hh = b * b - (cx * cx + cy * cy + cz * cz - s[3] * s[3]);
                if (hh >= 0) { const tk = -b - Math.sqrt(hh); if (tk > 0 && tk < t) { t = tk; hit = k; } }
            }
            if (dy < 0 && -oy / dy < t) { t = -oy / dy; hit = -1; }
            let lum;
            if (hit === -2) lum = sky(dy);
            else {
                const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
                if (hit === -1) {
                    const spot = 0.85 + 0.15 * Math.exp(-0.05 * (px * px + (pz + 0.4) * (pz + 0.4)));
                    lum = 1.02 * spot * (0.72 * Ly * shadow(px, py, pz, -1) + 0.3 * occlusion(px, py, pz, 0, 1, 0, -1));
                    lum = geo.lerp(sky(dy), lum, Math.exp(-0.0018 * t * t)); // fade into the backdrop
                } else {
                    const s = S[hit], nx = (px - s[0]) / s[3], ny = (py - s[1]) / s[3], nzz = (pz - s[2]) / s[3];
                    const dif = Math.max(0, nx * Lx + ny * Ly + nzz * Lz) * shadow(px, py, pz, hit);
                    const amb = (0.55 + 0.45 * ny) * occlusion(px, py, pz, nx, ny, nzz, hit);
                    const dn = dx * nx + dy * ny + dz * nzz;
                    const rl = (dx - 2 * dn * nx) * Lx + (dy - 2 * dn * ny) * Ly + (dz - 2 * dn * nzz) * Lz;
                    lum = 0.86 * (0.8 * dif + 0.2 * amb + 0.12 * Math.max(0, -ny)) + Math.pow(Math.max(0, rl), 40) * 0.6 * dif;
                }
            }
            data[j * w + i] = Math.pow(geo.clamp(lum, 0, 1), 0.85);
        }
        return (demo = { width: w, height: h, data });
    }

    // Bilinear luminance sampler fitted into a box; outside the image is paper white.
    function sampler(img, bb, fit) {
        const iw = img.width, ih = img.height, D = img.data;
        const s = fit === 'contain' ? Math.min(bb.w / iw, bb.h / ih) : Math.max(bb.w / iw, bb.h / ih);
        const ox = bb.minX + (bb.w - iw * s) / 2, oy = bb.minY + (bb.h - ih * s) / 2;
        return (x, y) => {
            const u = (x - ox) / s - 0.5, v = (y - oy) / s - 0.5;
            if (u < -0.5 || v < -0.5 || u > iw - 0.5 || v > ih - 0.5) return 1;
            const uu = geo.clamp(u, 0, iw - 1), vv = geo.clamp(v, 0, ih - 1);
            const i0 = Math.floor(uu), j0 = Math.floor(vv);
            const i1 = Math.min(i0 + 1, iw - 1), j1 = Math.min(j0 + 1, ih - 1);
            const fx = uu - i0, fy = vv - j0;
            const a = D[j0 * iw + i0] + (D[j0 * iw + i1] - D[j0 * iw + i0]) * fx;
            const b = D[j1 * iw + i0] + (D[j1 * iw + i1] - D[j1 * iw + i0]) * fx;
            return a + (b - a) * fy;
        };
    }

    // Push each base point (even arc-length steps) along its unit normal by a
    // sine wave whose amplitude, and optionally frequency, follow darkness.
    function squiggleLine(pts0, normals, dark, p, s) {
        const out = [];
        let ph = 0;
        const k = TAU / p.wave;
        for (let i = 0; i < pts0.length; i++) {
            const [x, y] = pts0[i];
            const d = dark(x, y);
            const a = p.amp * (s / 2) * d;
            out.push([x + normals[i][0] * a * Math.sin(ph), y + normals[i][1] * a * Math.sin(ph)]);
            ph += k * (i + 1 < pts0.length ? geo.dist(pts0[i], pts0[i + 1]) : 0) * (1 - p.fmod + p.fmod * d);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // TSP art helpers
    // ------------------------------------------------------------------
    function stipple(weight, inside, bb, N, rng) {
        // total weight from a coarse pass sets the Poisson-disk radius for the
        // local target density N·w/Σw: r = k / sqrt(w)
        const g = Math.max(0.5, Math.sqrt((bb.w * bb.h) / 20000));
        let sum = 0, wmax = 0;
        for (let y = bb.minY + g / 2; y < bb.maxY; y += g) for (let x = bb.minX + g / 2; x < bb.maxX; x += g) {
            const w = weight(x, y);
            sum += w * g * g;
            if (w > wmax) wmax = w;
        }
        if (sum <= 0 || wmax <= 0) return [];
        const k = 0.7 * Math.sqrt(sum / N), rMin = k / Math.sqrt(wmax), rCap = rMin * 6;

        // weight raster shared by dart throwing and relaxation
        const px = Math.max(rMin / 1.6, Math.sqrt((bb.w * bb.h) / 2.5e5));
        const rw = Math.ceil(bb.w / px), rh = Math.ceil(bb.h / px);
        const Wt = new Float32Array(rw * rh);
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
            const x = bb.minX + (i + 0.5) * px, y = bb.minY + (j + 0.5) * px;
            Wt[j * rw + i] = inside(x, y) ? weight(x, y) : 0;
        }
        const R = { Wt, rw, rh, px, bb };
        const cdf = new Float64Array(rw * rh);
        let acc = 0;
        for (let q = 0; q < Wt.length; q++) cdf[q] = acc += Wt[q];
        if (acc <= 0) return [];

        const cell = rMin;
        const gx = Math.ceil(bb.w / cell) + 1, gy = Math.ceil(bb.h / cell) + 1;
        const grid = new Array(gx * gy);
        const X = [], Y = [];
        const tries = N * 12;
        for (let t = 0; t < tries && X.length < N; t++) {
            // pick a pixel with probability ∝ weight (binary search of the cumulative table)
            const target = rng.random() * acc;
            let lo = 0, hi = cdf.length - 1;
            while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] > target) hi = m; else lo = m + 1; }
            const w = Wt[lo], i = lo % rw, j = (lo - i) / rw;
            const x = bb.minX + (i + rng.random()) * px, y = bb.minY + (j + rng.random()) * px;
            if (x > bb.maxX || y > bb.maxY) continue;
            const r = Math.min(rCap, k / Math.sqrt(w)), r2 = r * r;
            const ci = Math.floor((x - bb.minX) / cell), cj = Math.floor((y - bb.minY) / cell), D = Math.ceil(r / cell);
            let ok = true;
            for (let jj = Math.max(0, cj - D); ok && jj <= Math.min(gy - 1, cj + D); jj++) {
                for (let ii = Math.max(0, ci - D); ii <= Math.min(gx - 1, ci + D); ii++) {
                    const arr = grid[jj * gx + ii];
                    if (!arr) continue;
                    for (const id of arr) {
                        const dx = X[id] - x, dy = Y[id] - y;
                        if (dx * dx + dy * dy < r2) { ok = false; break; }
                    }
                    if (!ok) break;
                }
            }
            if (!ok) continue;
            (grid[cj * gx + ci] || (grid[cj * gx + ci] = [])).push(X.length);
            X.push(x); Y.push(y);
        }
        const PX = Float64Array.from(X), PY = Float64Array.from(Y);
        relax(PX, PY, R, rCap, k);
        return [PX, PY];
    }

    // Weighted Lloyd relaxation on the raster (after Secord, 2002): every pixel
    // goes to its nearest stipple (each stipple claims a disc about its local
    // spacing, z-buffer style) and stipples move to the weighted centroid of
    // their pixels. A few rounds turn dart-throwing clumps into even flow.
    function relax(X, Y, R, maxReach, k) {
        const { Wt, rw: w, rh: h, px, bb } = R;
        const N = X.length;
        const best = new Float32Array(w * h), owner = new Int32Array(w * h);
        const sx = new Float64Array(N), sy = new Float64Array(N), sw = new Float64Array(N);
        const deadline = performance.now() + 250;
        for (let it = 0; it < 4 && performance.now() < deadline; it++) {
            best.fill(Infinity);
            owner.fill(-1);
            for (let n = 0; n < N; n++) {
                const ci = (X[n] - bb.minX) / px - 0.5, cj = (Y[n] - bb.minY) / px - 0.5;
                const wl = Wt[geo.clamp(Math.round(cj), 0, h - 1) * w + geo.clamp(Math.round(ci), 0, w - 1)];
                const reach = Math.min(maxReach, (1.6 * k) / Math.sqrt(Math.max(wl, 1e-4))) / px;
                const i0 = Math.max(0, Math.floor(ci - reach)), i1 = Math.min(w - 1, Math.ceil(ci + reach));
                const j0 = Math.max(0, Math.floor(cj - reach)), j1 = Math.min(h - 1, Math.ceil(cj + reach));
                for (let j = j0; j <= j1; j++) {
                    const dy = j - cj, row = j * w;
                    for (let i = i0; i <= i1; i++) {
                        const dx = i - ci, d2 = dx * dx + dy * dy;
                        if (d2 < best[row + i]) { best[row + i] = d2; owner[row + i] = n; }
                    }
                }
            }
            sx.fill(0); sy.fill(0); sw.fill(0);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const q = j * w + i, o = owner[q], wt = Wt[q];
                if (o < 0 || wt <= 0) continue;
                sx[o] += (i + 0.5) * wt; sy[o] += (j + 0.5) * wt; sw[o] += wt;
            }
            for (let n = 0; n < N; n++) {
                if (sw[n] > 0) { X[n] = bb.minX + (sx[n] / sw[n]) * px; Y[n] = bb.minY + (sy[n] / sw[n]) * px; }
            }
        }
    }

    function tour(X, Y, budgetMs) {
        const N = X.length;
        if (N < 3) return Array.from({ length: N }, (_, i) => i);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < N; i++) {
            minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]);
            minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]);
        }
        const cell = Math.max(1e-3, Math.sqrt(((maxX - minX) * (maxY - minY)) / N) * 1.5);
        const gx = Math.floor((maxX - minX) / cell) + 1, gy = Math.floor((maxY - minY) / cell) + 1;
        const cellOf = i => Math.floor((Y[i] - minY) / cell) * gx + Math.floor((X[i] - minX) / cell);
        const buckets = Array.from({ length: gx * gy }, () => []);
        for (let i = 0; i < N; i++) buckets[cellOf(i)].push(i);
        const d = (a, b) => { const dx = X[a] - X[b], dy = Y[a] - Y[b]; return Math.sqrt(dx * dx + dy * dy); };

        // Visit grid rings around point a until nothing closer can remain.
        function nearest(a, K) {
            const ci = Math.floor((X[a] - minX) / cell), cj = Math.floor((Y[a] - minY) / cell);
            const best = []; // [dist, id] sorted, at most K
            const maxR = Math.max(gx, gy);
            for (let r = 0; r <= maxR; r++) {
                for (let j = cj - r; j <= cj + r; j++) {
                    if (j < 0 || j >= gy) continue;
                    const edge = j === cj - r || j === cj + r;
                    for (let i = ci - r; i <= ci + r; i += edge || r === 0 ? 1 : 2 * r) {
                        if (i < 0 || i >= gx) continue;
                        for (const b of buckets[j * gx + i]) {
                            if (b === a) continue;
                            const dd = d(a, b);
                            if (best.length < K || dd < best[best.length - 1][0]) {
                                let k = best.length;
                                if (k === K) best.pop(), k--;
                                while (k > 0 && best[k - 1][0] > dd) k--;
                                best.splice(k, 0, [dd, b]);
                            }
                        }
                    }
                }
                if (best.length === K && best[best.length - 1][0] <= r * cell) break;
            }
            return best.map(q => q[1]);
        }

        // neighbour lists
        const KN = 8;
        const nbrs = new Array(N);
        for (let i = 0; i < N; i++) nbrs[i] = nearest(i, KN);

        // greedy nearest-neighbour tour; visited points leave their buckets
        const T = new Int32Array(N), pos = new Int32Array(N);
        const where = new Int32Array(N);
        buckets.forEach(bk => bk.forEach((id, k) => { where[id] = k; }));
        const take = i => {
            const bk = buckets[cellOf(i)], k = where[i], last = bk.pop();
            if (last !== i) { bk[k] = last; where[last] = k; }
        };
        let cur = 0;
        for (let i = 1; i < N; i++) if (X[i] + Y[i] < X[cur] + Y[cur]) cur = i;
        take(cur);
        for (let n = 0; n < N; n++) {
            T[n] = cur; pos[cur] = n;
            if (n === N - 1) break;
            const nx = nearest(cur, 1)[0];
            take(nx);
            cur = nx;
        }

        // 2-opt and Or-opt with neighbour lists and don't-look bits
        const reverse = (i, j) => { // reverse tour positions i..j (cyclic, inclusive)
            let len = ((j - i + N) % N) + 1;
            if (len * 2 > N) { const t = i; i = (j + 1) % N; j = (t - 1 + N) % N; len = N - len; }
            for (let k = 0; k < len >> 1; k++) {
                const a = (i + k) % N, b = (j - k + N) % N;
                const ta = T[a], tb = T[b];
                T[a] = tb; pos[tb] = a; T[b] = ta; pos[ta] = b;
            }
        };
        const next = c => T[(pos[c] + 1) % N], prev = c => T[(pos[c] - 1 + N) % N];
        // Replace tour edges {a,b}, {c,d} by {a,c}, {b,d}, whichever way the tour now runs.
        const swapEdges = (a, b, c, d) => {
            if (next(a) === b) reverse(pos[b], pos[c]); else reverse(pos[a], pos[d]);
        };
        const queue = [], inQ = new Uint8Array(N);
        for (let i = 0; i < N; i++) { queue.push(T[i]); inQ[T[i]] = 1; }
        const push = c => { if (!inQ[c]) { inQ[c] = 1; queue.push(c); } };

        function twoOpt(a) {
            for (let dir = 0; dir < 2; dir++) {
                const pa = pos[a];
                const b = dir === 0 ? T[(pa + 1) % N] : T[(pa - 1 + N) % N];
                const dab = d(a, b);
                for (const c of nbrs[a]) {
                    const dac = d(a, c);
                    if (dac >= dab) break;
                    const pc = pos[c];
                    const e = dir === 0 ? T[(pc + 1) % N] : T[(pc - 1 + N) % N];
                    if (c === b || e === a) continue;
                    if (dac + d(b, e) - dab - d(c, e) < -1e-10) {
                        if (dir === 0) reverse((pa + 1) % N, pc);
                        else reverse(pa, (pc - 1 + N) % N);
                        push(a); push(b); push(c); push(e);
                        return true;
                    }
                }
            }
            return false;
        }
        // Move the run of 1-3 cities starting at a between two cities near it.
        function orOpt(a) {
            if (N < 8) return false;
            let s2 = a;
            for (let L = 1; L <= 3; L++, s2 = next(s2)) {
                const s1 = a, p = prev(s1), n = next(s2);
                const seg = L === 1 ? [s1] : L === 2 ? [s1, s2] : [s1, next(s1), s2];
                const gain = d(p, s1) + d(s2, n) - d(p, n);
                if (gain <= 1e-10) continue;
                for (const c of nbrs[s1]) {
                    if (d(c, s1) >= gain) break;
                    if (seg.includes(c)) continue;
                    for (let opt = 0; opt < 2; opt++) {
                        const x = opt === 0 ? c : prev(c), y = opt === 0 ? next(c) : c;
                        if (x === p || y === p || x === n || y === n || seg.includes(x) || seg.includes(y)) continue;
                        const add = opt === 0 ? d(x, s1) + d(s2, y) - d(x, y) : d(x, s2) + d(s1, y) - d(x, y);
                        if (gain - add > 1e-10) {
                            // as 2-opt steps: p x .. n s2..s1 y, then p n .. x s2..s1 y, then flip the run
                            swapEdges(p, s1, x, y);
                            swapEdges(p, x, n, s2);
                            if (opt === 0) swapEdges(x, s2, s1, y);
                            [p, n, x, y, ...seg].forEach(push);
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        const deadline = performance.now() + budgetMs;
        let qi = 0, iter = 0;
        while (qi < queue.length) {
            if ((++iter & 127) === 0 && performance.now() > deadline) break;
            const a = queue[qi++];
            inQ[a] = 0;
            if (qi > 50000) { queue.splice(0, qi); qi = 0; }
            if (!twoOpt(a)) orOpt(a);
        }

        // open the loop at its longest edge
        let cut = 0, longest = -1;
        for (let i = 0; i < N; i++) {
            const L = d(T[i], T[(i + 1) % N]);
            if (L > longest) { longest = L; cut = i; }
        }
        const order = new Array(N);
        for (let i = 0; i < N; i++) order[i] = T[(cut + 1 + i) % N];
        return order;
    }

    PG.register({
        id: 'image',
        name: 'Image',
        category: 'Image',
        description: 'Turn a photo into a squiggle spiral, squiggled rows, cross-hatching or a single-line TSP portrait.',
        fit: false,
        params: [
            { type: 'section', label: 'Image' },
            { id: 'image', label: 'Image', type: 'image' },
            { id: 'fit', label: 'Fit', type: 'select', value: 'cover', options: [['cover', 'Cover (crop)'], ['contain', 'Contain']] },
            { id: 'contrast', label: 'Contrast', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.2, random: [0.9, 1.6] },
            { id: 'brightness', label: 'Brightness', type: 'range', min: -1, max: 1, step: 0.01, value: 0, random: [-0.25, 0.25] },
            { id: 'invert', label: 'Invert', type: 'checkbox', value: false },
            { type: 'section', label: 'Lines' },
            { id: 'mode', label: 'Mode', type: 'select', value: 'spiral', random: true,
                options: [['spiral', 'Squiggle spiral'], ['squiggle', 'Squiggle rows'], ['hatch', 'Cross-hatch'], ['tsp', 'TSP single line']] },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.6, max: 6, step: 0.05, value: 1.6, random: [1.2, 2.4],
                show: p => p.mode !== 'tsp' },
            { id: 'amp', label: 'Amplitude', type: 'range', min: 0, max: 1.5, step: 0.01, value: 1, random: [0.75, 1.1],
                show: p => p.mode === 'spiral' || p.mode === 'squiggle', hint: 'Squiggle height in the darkest areas, × line spacing' },
            { id: 'wave', label: 'Wavelength (mm)', type: 'range', min: 0.3, max: 6, step: 0.05, value: 1, random: [0.7, 1.8],
                show: p => p.mode === 'spiral' || p.mode === 'squiggle' },
            { id: 'fmod', label: 'Frequency modulation', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4,
                show: p => p.mode === 'spiral' || p.mode === 'squiggle', hint: 'Lighter areas get longer, lazier waves' },
            { id: 'extent', label: 'Spiral extent', type: 'select', value: 'circle', show: p => p.mode === 'spiral',
                options: [['circle', 'Circle'], ['page', 'Whole area']] },
            { id: 'join', label: 'Join rows into one stroke', type: 'checkbox', value: false, show: p => p.mode === 'squiggle' },
            { id: 'layers', label: 'Hatch layers', type: 'range', min: 1, max: 4, step: 1, value: 4, random: [3, 4], show: p => p.mode === 'hatch' },
            { id: 'points', label: 'Points', type: 'range', min: 500, max: 20000, step: 100, value: 10000, random: false, show: p => p.mode === 'tsp' },
            { id: 'budget', label: 'Tour optimisation (ms)', type: 'range', min: 0, max: 3000, step: 50, value: 400, random: false,
                show: p => p.mode === 'tsp' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false, show: p => p.mode === 'hatch',
                hint: 'Hatch layers are shared out over the pens' },
        ],

        randomize(rng, p) {
            // full-page squiggle rows are the heaviest mode: give them more air
            return p.mode === 'squiggle' ? { spacing: +rng.range(1.7, 2.6).toFixed(2) } : {};
        },

        generate(p, ctx) {
            const { rng } = ctx;
            const img = ctx.images && ctx.images.image && ctx.images.image.data ? ctx.images.image : demoImage();
            const area = ctx.shape.polygon();
            const bb = geo.bbox([area]);
            const lum = sampler(img, bb, p.fit);
            const gamma = Math.pow(2, -1.5 * p.brightness);
            const dark = (x, y) => {
                let l = (lum(x, y) - 0.5) * p.contrast + 0.5;
                l = Math.pow(geo.clamp(l, 0, 1), gamma);
                return p.invert ? l : 1 - l;
            };
            const s = p.spacing;
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            // ~10 samples per wave, coarser if the whole drawing would pass 300k points
            const baseLen = (p.mode === 'spiral' && p.extent === 'page' ? Math.PI * (bb.w * bb.w + bb.h * bb.h) / 4 : bb.w * bb.h) / s;
            const step = Math.max(Math.min(0.25, p.wave / 10), baseLen / 3e5);

            if (p.mode === 'spiral') {
                // 'circle': the largest circle inside the clip shape around its centre
                const inR = ctx.shape.dist(cx, cy) > s ? ctx.shape.dist(cx, cy) : Math.min(bb.w, bb.h) / 2;
                const R = p.extent === 'page' ? Math.hypot(bb.w, bb.h) / 2 : inR - s / 2;
                const b = s / TAU;
                const base = [], nrm = [];
                for (let th = 0; b * th <= R;) {
                    const r = b * th, c = Math.cos(th), sn = Math.sin(th);
                    base.push([cx + r * c, cy + r * sn]);
                    nrm.push([c, sn]);
                    th += step / Math.hypot(r, b);
                }
                return [squiggleLine(base, nrm, dark, p, s)];
            }

            if (p.mode === 'squiggle') {
                const rows = [];
                let k = 0;
                for (let y = bb.minY + s / 2; y < bb.maxY; y += s, k++) {
                    // span of this row inside the (convex) area
                    let x0 = Infinity, x1 = -Infinity;
                    for (let i = 0, n = area.length; i < n; i++) {
                        const a = area[i], c = area[(i + 1) % n];
                        if ((a[1] - y) * (c[1] - y) > 0 || a[1] === c[1]) continue;
                        const x = a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]);
                        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                    }
                    if (!(x1 - x0 > s)) continue;
                    const n = Math.ceil((x1 - x0) / step), base = [], nrm = [];
                    for (let i = 0; i <= n; i++) {
                        base.push([x0 + ((x1 - x0) * i) / n, y]);
                        nrm.push([0, 1]);
                    }
                    if (p.join && k % 2) base.reverse();
                    rows.push(squiggleLine(base, nrm, dark, p, s));
                }
                if (!p.join) return rows;
                return [[].concat(...rows)];
            }

            if (p.mode === 'hatch') {
                const nL = geo.clamp(Math.round(p.layers), 1, 4);
                const angles = [45, 135, 0, 90];
                const pens = Math.max(1, p.pens);
                const layers = Array.from({ length: pens }, () => []);
                const R = Math.hypot(bb.w, bb.h) / 2 + s;
                const du = 0.3, minLen = 1.2, bridge = 0.6;
                for (let li = 0; li < nL; li++) {
                    const thr = (li + 1) / (nL + 1);
                    const a = geo.rad(angles[li]), ca = Math.cos(a), sa = Math.sin(a);
                    const out = layers[li % pens];
                    // offsets start at a per-layer phase so layers don't share lines
                    for (let v = -R + s * (0.5 + ((li * 0.37) % 1)); v <= R; v += s) {
                        const px = cx - sa * v, py = cy + ca * v;
                        const runs = [];
                        let start = null, prevD = -1, prevU = -R;
                        for (let u = -R; u <= R; u += du) {
                            const x = px + ca * u, y = py + sa * u;
                            const inBox = x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY;
                            const dv = inBox ? dark(x, y) - thr : -1;
                            // interpolate the threshold crossings for clean ends
                            if (dv > 0 && start === null) start = prevU + ((u - prevU) * prevD) / (prevD - dv);
                            else if (dv <= 0 && start !== null) {
                                runs.push([start, prevU + ((u - prevU) * prevD) / (prevD - dv)]);
                                start = null;
                            }
                            prevD = dv; prevU = u;
                        }
                        if (start !== null) runs.push([start, prevU]);
                        // bridge tiny gaps, drop crumbs
                        const merged = [];
                        for (const r of runs) {
                            const last = merged[merged.length - 1];
                            if (last && r[0] - last[1] < bridge) last[1] = r[1]; else merged.push(r);
                        }
                        for (const [u0, u1] of merged) {
                            if (u1 - u0 >= minLen) out.push([[px + ca * u0, py + sa * u0], [px + ca * u1, py + sa * u1]]);
                        }
                    }
                }
                return pens > 1 ? { layers } : layers[0];
            }

            // ---- TSP
            const inside = (x, y) => ctx.shape.dist(x, y) > 0.2;
            // squared so light areas thin out quickly; paper-white stays empty
            const weight = (x, y) => { const d = Math.max(0, dark(x, y) - 0.03) / 0.97; return d * d; };
            const pts = stipple(weight, inside, bb, Math.round(p.points), rng);
            if (!pts.length || pts[0].length < 2) return [];
            const [X, Y] = pts;
            const order = tour(X, Y, p.budget);
            return [order.map(i => [X[i], Y[i]])];
        },
    });
})();
