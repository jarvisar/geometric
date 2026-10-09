/*
 * Alpine Valley: a village on the floor of a valley closed off by snowy peaks,
 * with a railway on a stone viaduct, a cable car, fir woods, farms and a lake.
 * Drawn filling the page looking up the valley, or as a block cut out of the
 * landscape. The terrain hides whatever is behind it, and the buildings share
 * their roof hatching and details with the other scenes.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, Scene, segments } = PG.iso;
    const { wall, door, pane, windows, gableRoof, chimney, unit, shade, outward, shadeGable, church, conifer, turned, bridge, bridgeRamp, withKind, patioSet, bench } = PG.isokit;

    const INK = 0, RED = 1, SHADOW = 2, ACCENT = 3, GREEN = 4, FIGURE = 5, BLUE = 6, ROAD = 7;
    const SNOW = SHADOW, EARTH = ROAD;
    const person = withKind(FIGURE, PG.isokit.person);

    const smooth = (a, b, x) => geo.smoothstep(a, b, x);
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    // ------------------------------------------------------------------
    // The ground
    // ------------------------------------------------------------------

    // Heights on a grid of Lx × Ly meters, split into triangles along whichever
    // diagonal of each cell is closer to level. The grid starts at world point
    // o and runs along unit vector u, and along u turned a quarter left. W is
    // the water level at each point, a good way under the ground where it's
    // dry, so land and water can be told apart with a straight interpolation.
    class Ground {
        constructor(Lx, Ly, step, o = [0, 0], u = [1, 0]) {
            this.Lx = Lx;
            this.Ly = Ly;
            this.o = o;
            this.u = u;
            this.nx = Math.max(8, Math.round(Lx / step));
            this.ny = Math.max(8, Math.round(Ly / step));
            this.dx = Lx / this.nx;
            this.dy = Ly / this.ny;
            this.h = new Float64Array((this.nx + 1) * (this.ny + 1));
            this.W = new Float64Array(this.h.length);
            this.diag = null;
        }

        id(i, j) { return j * (this.nx + 1) + i; }
        world(a, b) { return [this.o[0] + a * this.u[0] - b * this.u[1], this.o[1] + a * this.u[1] + b * this.u[0]]; }
        local(x, y) {
            const dx = x - this.o[0], dy = y - this.o[1];
            return [dx * this.u[0] + dy * this.u[1], dy * this.u[0] - dx * this.u[1]];
        }
        vxy(i, j) { return this.world(i * this.dx, j * this.dy); }
        pt(v) {
            const [x, y] = this.vxy(v % (this.nx + 1), Math.floor(v / (this.nx + 1)));
            return [x, y, this.h[v]];
        }
        cell(x, y) {
            const [a, b] = this.local(x, y);
            return [geo.clamp(Math.round(a / this.dx), 0, this.nx), geo.clamp(Math.round(b / this.dy), 0, this.ny)];
        }
        inside(x, y, m = 0) {
            const [a, b] = this.local(x, y);
            return a >= m && b >= m && a <= this.Lx - m && b <= this.Ly - m;
        }
        // every grid point within r of (x, y), with its distance
        near(x, y, r, fn) {
            const [a, b] = this.local(x, y);
            const i0 = Math.max(0, Math.floor((a - r) / this.dx)), i1 = Math.min(this.nx, Math.ceil((a + r) / this.dx));
            const j0 = Math.max(0, Math.floor((b - r) / this.dy)), j1 = Math.min(this.ny, Math.ceil((b + r) / this.dy));
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const d = Math.hypot(i * this.dx - a, j * this.dy - b);
                    if (d <= r) fn(this.id(i, j), d);
                }
            }
        }

        // pick the diagonals once the heights are in
        split() {
            const { nx, ny, h } = this;
            this.diag = new Uint8Array(nx * ny);
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    const a = h[this.id(i, j)], b = h[this.id(i + 1, j)], c = h[this.id(i + 1, j + 1)], d = h[this.id(i, j + 1)];
                    this.diag[j * nx + i] = Math.abs(a - c) <= Math.abs(b - d) ? 0 : 1;
                }
            }
        }

        // the two triangles of cell (i, j) as vertex ids, anticlockwise from above
        tris(i, j) {
            const a = this.id(i, j), b = this.id(i + 1, j), c = this.id(i + 1, j + 1), d = this.id(i, j + 1);
            return this.diag[j * this.nx + i] === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        }

        // value of a per-point array at world (x, y), interpolated on its triangle
        sample(arr, x, y) {
            const [la, lb] = this.local(x, y);
            const fx = geo.clamp(la / this.dx, 0, this.nx - 1e-9), fy = geo.clamp(lb / this.dy, 0, this.ny - 1e-9);
            const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
            const a = arr[this.id(i, j)], b = arr[this.id(i + 1, j)], c = arr[this.id(i + 1, j + 1)], d = arr[this.id(i, j + 1)];
            if (this.diag[j * this.nx + i] === 0) return u > v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;
            return u + v < 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
        }

        at(x, y) { return this.sample(this.h, x, y); }
        wet(x, y) { return this.sample(this.h, x, y) < this.sample(this.W, x, y); }

        bounds() {
            let lo = Infinity, hi = -Infinity;
            for (const z of this.h) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
            return [lo, hi];
        }

        // steepness (rise over run) at (x, y)
        slope(x, y) {
            const e = Math.max(this.dx, this.dy);
            return Math.hypot(this.at(x + e, y) - this.at(x - e, y), this.at(x, y + e) - this.at(x, y - e)) / (2 * e);
        }

        // heights box-blurred r grid points each way, twice
        blurred(r) {
            const { nx, ny } = this;
            const a = Float64Array.from(this.h), b = new Float64Array(a.length);
            for (let pass = 0; pass < 2; pass++) {
                for (let j = 0; j <= ny; j++) {
                    for (let i = 0; i <= nx; i++) {
                        let s = 0, n = 0;
                        for (let d = Math.max(-r, -i); d <= Math.min(r, nx - i); d++) { s += a[this.id(i + d, j)]; n++; }
                        b[this.id(i, j)] = s / n;
                    }
                }
                for (let j = 0; j <= ny; j++) {
                    for (let i = 0; i <= nx; i++) {
                        let s = 0, n = 0;
                        for (let d = Math.max(-r, -j); d <= Math.min(r, ny - j); d++) { s += b[this.id(i, j + d)]; n++; }
                        a[this.id(i, j)] = s / n;
                    }
                }
            }
            return a;
        }

        // downhill direction and steepness at (x, y)
        fall(x, y) {
            const e = Math.max(this.dx, this.dy) * 0.6;
            const gx = (this.at(x + e, y) - this.at(x - e, y)) / (2 * e), gy = (this.at(x, y + e) - this.at(x, y - e)) / (2 * e);
            const s = Math.hypot(gx, gy) || 1e-9;
            return [-gx / s, -gy / s, s];
        }
    }

    // ------------------------------------------------------------------
    // Paths
    // ------------------------------------------------------------------

    const lengths = path => {
        const cum = [0];
        for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        return cum;
    };

    // A polyline with its running length, and optionally a value at each point
    const track = (pts, par = null) => ({ pts, cum: lengths(pts), par });

    // Nearest point on a track: arc position (0..1 along it), distance, which
    // side of it (+1 left, -1 right, looking along it) and the value there
    function nearest(tr, x, y) {
        const { pts, cum, par } = tr;
        let best = Infinity, bi = 0, bf = 0, side = 1;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1;
            const t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / L2, 0, 1);
            const dx = x - a[0] - ex * t, dy = y - a[1] - ey * t, d = dx * dx + dy * dy;
            if (d < best) {
                best = d;
                bi = i;
                bf = t;
                side = ex * (y - a[1]) - ey * (x - a[0]) >= 0 ? 1 : -1;
            }
        }
        return {
            t: (cum[bi] + (cum[bi + 1] - cum[bi]) * bf) / cum[cum.length - 1], d: Math.sqrt(best), side,
            par: par ? par[bi] + (par[bi + 1] - par[bi]) * bf : 0,
        };
    }

    // Point on a track at arc position t (0..1), with its direction
    function pathAt(tr, t) {
        const { pts: path, cum } = tr, L = cum[cum.length - 1] * geo.clamp(t, 0, 1);
        let i = 0;
        while (i + 2 < cum.length && cum[i + 1] < L) i++;
        const f = (L - cum[i]) / (cum[i + 1] - cum[i] || 1), a = path[i], b = path[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return { x: geo.lerp(a[0], b[0], f), y: geo.lerp(a[1], b[1], f), ux: (b[0] - a[0]) / l, uy: (b[1] - a[1]) / l };
    }

    // Arc position where a track's value first reaches `v` (values rising along it)
    function parAt(tr, v) {
        const { par, cum } = tr, n = par.length;
        if (v <= par[0]) return 0;
        for (let i = 0; i + 1 < n; i++) {
            if (par[i + 1] >= v) return (cum[i] + (cum[i + 1] - cum[i]) * ((v - par[i]) / (par[i + 1] - par[i] || 1))) / cum[n - 1];
        }
        return 1;
    }

    const keyOf = c => `${Math.round(c[0] * 1000)},${Math.round(c[1] * 1000)}`;

    // Join segments that share end points (by key) into polylines
    function stitch(segs) {
        const ends = new Map();
        segs.forEach((s, i) => {
            for (const e of s) {
                if (!ends.has(e.key)) ends.set(e.key, []);
                ends.get(e.key).push(i);
            }
        });
        const used = new Uint8Array(segs.length), out = [];
        for (let i = 0; i < segs.length; i++) {
            if (used[i]) continue;
            used[i] = 1;
            const line = [segs[i][0], segs[i][1]];
            for (const dir of [1, 0]) {
                for (;;) {
                    const tip = dir ? line[line.length - 1] : line[0];
                    const next = (ends.get(tip.key) || []).find(q => !used[q]);
                    if (next === undefined) break;
                    used[next] = 1;
                    const s = segs[next], o = s[0].key === tip.key ? s[1] : s[0];
                    if (dir) line.push(o); else line.unshift(o);
                }
            }
            out.push(line.map(e => e.c));
        }
        return out;
    }

    // ------------------------------------------------------------------
    // The lie of the land
    // ------------------------------------------------------------------

    // Ridged noise for the mountainsides: sharp crests, rounded hollows
    function ridged(N, x, y) {
        let s = 0, a = 0.6, f = 1;
        for (let o = 0; o < 3; o++) {
            s += a * (1 - Math.abs(N.noise2(x * f + o * 17.3, y * f - o * 9.1))) ** 2;
            a *= 0.5;
            f *= 2.1;
        }
        return s - 0.42;
    }

    // Priority flood from the outlets (Barnes et al.) on an nu × nv grid: fills
    // every pit up to its spill point plus a hair, and returns the nodes in the
    // order they were reached, which runs from the outlets uphill.
    function flood(h, nu, nv, outlet) {
        const N = nu * nv, filled = Float64Array.from(h), order = new Int32Array(N), closed = new Uint8Array(N);
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
            const fc = filled[c] + 1e-7, cx = c % nu, cy = (c - cx) / nu;
            for (const [a, b] of NB) {
                const x = cx + a, y = cy + b;
                if (x < 0 || y < 0 || x >= nu || y >= nv) continue;
                const m = y * nu + x;
                if (closed[m]) continue;
                closed[m] = 1;
                if (filled[m] < fc) filled[m] = fc;
                push(filled[m], m);
            }
        }
        return { filled, order, cnt };
    }

    // Stream power erosion (Braun & Willett's implicit scheme, as in Tidal
    // Atlas). Slopes steeper than smax per cell collapse, which keeps the
    // ridges from turning into needles.
    function erode(h, up, nu, nv, outlet, iters, K, smax) {
        const N = nu * nv, rec = new Int32Array(N), len = new Float64Array(N), area = new Float64Array(N);
        for (let it = 0; it < iters; it++) {
            const { filled, order, cnt } = flood(h, nu, nv, outlet);
            for (let i = 0; i < N; i++) {
                rec[i] = i; len[i] = 1;
                if (outlet[i]) continue;
                const fi = filled[i], cx = i % nu, cy = (i - cx) / nu;
                let best = 0;
                NB.forEach(([a, b], e) => {
                    const x = cx + a, y = cy + b;
                    if (x < 0 || y < 0 || x >= nu || y >= nv) return;
                    const m = y * nu + x, dl = e < 4 ? 1 : Math.SQRT2, sl = (fi - filled[m]) / dl;
                    if (sl > best) { best = sl; rec[i] = m; len[i] = dl; }
                });
            }
            area.fill(1);
            for (let q = cnt - 1; q >= 0; q--) { const i = order[q]; if (rec[i] !== i) area[rec[i]] += area[i]; }
            for (let q = 0; q < cnt; q++) {
                const i = order[q], r = rec[i];
                if (r === i) continue;
                const F = K * Math.sqrt(area[i]) / len[i];
                h[i] = Math.min((h[i] + up[i] + F * h[r]) / (1 + F), h[r] + smax * len[i]);
            }
        }
    }

    // Mountains: the uplift (0..1 at plan u, v) worn down by a quick erosion
    // pass on a coarse grid, so ridges and gullies branch the way real ones do.
    // Returns the heights, 0..1, as a function of plan position.
    function massif(uplift, box, N2) {
        const [u0, v0, u1, v1] = box, cell = Math.max(1.6, Math.sqrt(((u1 - u0) * (v1 - v0)) / 12000));
        const nu = Math.ceil((u1 - u0) / cell) + 1, nv = Math.ceil((v1 - v0) / cell) + 1, N = nu * nv;
        const up = new Float64Array(N), h = new Float64Array(N), outlet = new Uint8Array(N);
        for (let j = 0; j < nv; j++) {
            for (let i = 0; i < nu; i++) {
                const q = j * nu + i, u = u0 + i * cell, v = v0 + j * cell;
                up[q] = uplift(u, v);
                h[q] = up[q] * 4 + 0.02 * N2.noise2(u / 9, v / 9);
                outlet[q] = up[q] < 0.02 || i === 0 || j === 0 || i === nu - 1 || j === nv - 1 ? 1 : 0;
            }
        }
        erode(h, up, nu, nv, outlet, 24, 0.9, 0.55);
        // one soft pass takes the grid scale kinks out of the gullies
        const soft = Float64Array.from(h);
        for (let j = 1; j < nv - 1; j++) {
            for (let i = 1; i < nu - 1; i++) {
                const q = j * nu + i;
                soft[q] = (4 * h[q] + 2 * (h[q - 1] + h[q + 1] + h[q - nu] + h[q + nu]) + h[q - nu - 1] + h[q - nu + 1] + h[q + nu - 1] + h[q + nu + 1]) / 16;
            }
        }
        let hi = 1e-9;
        for (const z of soft) hi = Math.max(hi, z);
        for (let q = 0; q < N; q++) h[q] = soft[q] / hi;
        // D8 drainage runs in eight fixed directions, so read the grid through a
        // gentle warp to bend the gullies
        return (u, v) => {
            u += 5 * N2.fbm2(u / 45 + 20, v / 45, 2);
            v += 5 * N2.fbm2(u / 45, v / 45 + 20, 2);
            const fx = geo.clamp((u - u0) / cell, 0, nu - 1.001), fy = geo.clamp((v - v0) / cell, 0, nv - 1.001);
            const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, q = j * nu + i;
            return geo.lerp(geo.lerp(h[q], h[q + 1], a), geo.lerp(h[q + nu], h[q + nu + 1], a), b);
        };
    }

    // Everything is laid out in plan: u across the valley (0..U) and v up it
    // from the front (0..V). The river comes in at the front left of center,
    // swings over to the right and goes back to a gap between the far peaks.
    // The valley is walled in down both sides and closed off by three summits.
    function landscape(G, P, p, rng) {
        const { U, V, M } = P, N = PG.makeNoise(rng), relief = p.relief;
        const phase = rng.range(0, TAU), wig = rng.range(0.02, 0.035);
        const pts = [], par = [], t0 = Math.min(-0.1, P.t0 - 0.05);
        for (let i = 0; i <= 64; i++) {
            const t = geo.lerp(t0, 1.15, i / 64);
            const s = 0.28 + 0.3 * smooth(-0.15, 0.6, t) - 0.1 * smooth(0.5, 0.95, t) + wig * Math.sin(t * 8 + phase);
            pts.push(P.w(U * s, V * t));
            par.push(t);
        }
        const axis = track(pts, par);
        const rpts = geo.chaikin(pts, 2), river = track(rpts, rpts.map(([x, y]) => nearest(axis, x, y).par));
        const W0 = M * p.valley * 0.5, wr = geo.clamp(M * 0.018, 2.1, 4.5);
        const lake = rng.chance(p.lake) ? { t: rng.range(0.66, 0.71), len: 0.14 } : null;
        const floorAt = t => 1.4 + Math.max(0, t) * Math.min(5, V * 0.02);
        const lakeLevel = lake ? floorAt(lake.t - lake.len / 2) - 0.55 : 0;
        const peaks = [
            [rng.range(0.02, 0.14), rng.range(0.82, 0.9), 0.8, 0.56],
            [rng.range(0.36, 0.5), rng.range(0.94, 1), 1, 0.56],
            [rng.range(0.84, 0.98), rng.range(0.84, 0.92), 0.88, 0.56],
            // shoulders down the sides, so the valley is walled in most of the way to the front
            [-0.18, rng.range(0.5, 0.6), 0.5, 0.46],
            [1.18, rng.range(0.48, 0.58), 0.55, 0.46],
        ].map(([s, t, h, r]) => ({ u: U * s, v: V * t, h, r: M * r, phase: rng.range(0, TAU) }));
        // Uplift: a soft maximum of the peaks, so where two meet there's a saddle
        // rather than a crease, kept off the floor up to the gap at the back
        const lift = (u, v) => {
            const wu = u + 9 * N.fbm2(u / 60 + 7, v / 60, 2), wv = v + 9 * N.fbm2(u / 60, v / 60 - 5, 2);
            let m4 = 0;
            for (const q of peaks) {
                const du = wu - q.u, dv = (wv - q.v) * 1.1, a = Math.atan2(dv, du);
                const r = Math.hypot(du, dv) / (q.r * (1 + 0.12 * Math.cos(3 * a + q.phase) + 0.05 * Math.cos(5 * a - q.phase)));
                if (r < 1) m4 += (q.h * Math.pow(1 - r, 1.2)) ** 4;
            }
            const [x, y] = P.w(u, v), d = nearest(axis, x, y).d;
            return Math.pow(m4, 0.25) * (1 - 0.9 * Math.exp(-((d / Math.max(10, W0)) ** 2)) * (1 - smooth(0.7, 0.95, v / V)));
        };
        const corners = [[0, 0], [G.Lx, 0], [0, G.Ly], [G.Lx, G.Ly]].map(([a, b]) => P.uv(...G.world(a, b)));
        const box = [Math.min(...corners.map(q => q[0])), Math.min(...corners.map(q => q[1])), Math.max(...corners.map(q => q[0])), Math.max(...corners.map(q => q[1]))];
        const worn = massif(lift, box, N);
        for (let j = 0; j <= G.ny; j++) {
            for (let i = 0; i <= G.nx; i++) {
                const [x, y] = G.vxy(i, j), [u, v] = P.uv(x, y), t = v / V, id = G.id(i, j);
                const ax = nearest(axis, x, y);
                // concave, so the slopes ease off towards the floor and steepen into the summits
                const w = worn(u, v), mountain = relief * (0.3 * w + 0.7 * w * w), rough = mountain / relief;
                let z = floorAt(t) + mountain + 0.35 * N.noise2(u / 24, v / 24);
                z += relief * rough * (0.03 * ridged(N, u / 9, v / 9));
                let W = z - 30;
                const rv = nearest(river, x, y);
                const channel = wr * (1 + 0.12 * Math.sin(rv.par * 19 + phase));
                if (rv.d < channel + G.dx * 1.5 && rv.par < 0.8) {
                    const level = lake && rv.par < lake.t ? Math.min(floorAt(rv.par) - 0.55, lakeLevel) : floorAt(rv.par) - 0.55;
                    if (rv.d < channel) z = Math.min(z, level - 1.2 * (1 - (rv.d / channel) ** 2));
                    else z = Math.max(z, level + 0.15);
                    W = level;
                }
                if (lake) {
                    const a = (ax.par - lake.t) / (lake.len / 2), cross = ax.d / (W0 * 0.9);
                    const bowl = Math.max(0, 1 - a * a - cross * cross);
                    if (bowl > 0) {
                        z = geo.lerp(z, lakeLevel - 3, Math.min(1, bowl * 2.6));
                        W = lakeLevel;
                    }
                }
                G.h[id] = z;
                G.W[id] = W;
            }
        }
        G.split();
        const tAt = (x, y) => P.uv(x, y)[1] / V;
        return {
            axis, river, wr, lake, lakeLevel, W0, floorAt, tAt, tv: 0.44,
            peaks: peaks.map(q => { const [x, y] = P.w(q.u, q.v); return { ...q, x, y }; }),
            // floor height under a world point
            base: (x, y) => floorAt(tAt(x, y)),
        };
    }

    // ------------------------------------------------------------------
    // Drawing the ground
    // ------------------------------------------------------------------

    // Fill in the ground: faces for the triangles we can see, water surfaces
    // with their shorelines, the outline where the ground turns away from us,
    // shading on the slopes away from the sun and contours if asked for
    function drawGround(T, G, V) {
        const { S, p, cam } = T;
        const { nx, ny, h, W } = G;
        // Which way each grid point faces, from the slope round it. The outline
        // follows where this changes sign, so it's smooth rather than stepping
        // along the grid.
        const face = new Float64Array(h.length);
        for (let j = 0; j <= ny; j++) {
            for (let i = 0; i <= nx; i++) {
                const i0 = Math.max(0, i - 1), i1 = Math.min(nx, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny, j + 1);
                const a = (h[G.id(i1, j)] - h[G.id(i0, j)]) / ((i1 - i0) * G.dx), b = (h[G.id(i, j1)] - h[G.id(i, j0)]) / ((j1 - j0) * G.dy);
                const gx = a * G.u[0] - b * G.u[1], gy = a * G.u[1] + b * G.u[0];
                face[G.id(i, j)] = -(gx * cam.fx + gy * cam.fy) * cam.ce - cam.se;
            }
        }
        const facing = new Uint8Array(nx * ny * 2);
        const normal = (A, B, C) => {
            const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
            const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
            return n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
        };
        const cut = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
        // where the values f at the corners pass L, as a segment keyed by the edges it crosses
        const crossing = (tri, P, f, L) => {
            const e = [];
            for (let q = 0; q < 3; q++) {
                const a = q, b = (q + 1) % 3, fa = f[a] - L, fb = f[b] - L;
                if ((fa >= 0) !== (fb >= 0)) e.push({ c: cut(P[a], P[b], fa, fb), key: Math.min(tri[a], tri[b]) * 1e6 + Math.max(tri[a], tri[b]) });
            }
            return e.length === 2 ? e : null;
        };
        const dry = c => G.sample(W, c[0], c[1]) <= c[2] + 0.02;
        const add = (map, L, e) => { let a = map.get(L); if (!a) map.set(L, (a = [])); a.push(e); };
        const iv = p.contour, snow = V.snow, dz = 0.5, m0 = -8;
        // tone and steepness come from the ground blurred over a few meters, so they
        // change over whole slopes rather than from one triangle to the next
        const hs = G.blurred(Math.max(1, Math.round(3 / G.dx)));
        const strata = geo.lerp(3.6, 2.1, p.rock) / (T.k * cam.ce), steep = geo.lerp(1.8, 1.15, p.rock);
        const outline = [], shore = [], shades = new Map(), levels = new Map(), ledges = new Map();
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                G.tris(i, j).forEach((tri, k) => {
                    const P = tri.map(v => G.pt(v)), n = normal(P[0], P[1], P[2]);
                    const front = cam.facing(n[0], n[1], n[2]);
                    facing[(j * nx + i) * 2 + k] = front ? 1 : 0;
                    const Q = P.map(c => cam.project(c[0], c[1], c[2]));
                    if (Math.max(Q[0][0], Q[1][0], Q[2][0]) < m0 || Math.min(Q[0][0], Q[1][0], Q[2][0]) > T.W - m0) return;
                    if (Math.max(Q[0][1], Q[1][1], Q[2][1]) < m0 || Math.min(Q[0][1], Q[1][1], Q[2][1]) > T.H - m0) return;
                    const ol = crossing(tri, P, tri.map(v => face[v]), 0);
                    if (ol && dry(ol[0].c) && dry(ol[1].c)) outline.push(ol);
                    if (!front) return;
                    const f = tri.map(v => h[v] - W[v]);
                    // dry part of the triangle as ground, wet part as water at its level
                    const land = [], wet = [];
                    for (let q = 0; q < 3; q++) {
                        const a = q, b = (q + 1) % 3, pa = P[a], pb = P[b];
                        if (f[a] >= 0) land.push(pa); else wet.push([pa[0], pa[1], W[tri[a]]]);
                        if ((f[a] >= 0) !== (f[b] >= 0)) {
                            const c = cut(pa, pb, f[a], f[b]), wl = W[tri[a]] + (W[tri[b]] - W[tri[a]]) * (f[a] / (f[a] - f[b]));
                            land.push(c);
                            wet.push([c[0], c[1], wl]);
                        }
                    }
                    if (land.length >= 3) S.face(land);
                    if (wet.length >= 3) S.face(wet);
                    if (land.length && wet.length) {
                        const e = crossing(tri, P, f, 0);
                        if (e) shore.push(e);
                    }
                    if (!land.length) return;
                    const zs = tri.map(v => h[v]);
                    const B = tri.map((v, q) => [P[q][0], P[q][1], hs[v]]), nb = normal(B[0], B[1], B[2]);
                    const lo = Math.min(...zs), hi = Math.max(...zs);
                    // Shade: lines along the slope every dz meters of height, only on
                    // ground turned from the sun. Darker ground keeps more of the
                    // levels, so the gap between them on paper suits the tone there.
                    const tone = T.tone(nb);
                    if (tone > 0.18) {
                        const R = B.map(c => cam.project(c[0], c[1], c[2]));
                        const det = (R[1][0] - R[0][0]) * (R[2][1] - R[0][1]) - (R[2][0] - R[0][0]) * (R[1][1] - R[0][1]);
                        if (Math.abs(det) > 1e-9) {
                            const a = ((B[1][2] - B[0][2]) * (R[2][1] - R[0][1]) - (B[2][2] - B[0][2]) * (R[1][1] - R[0][1])) / det;
                            const b = ((B[2][2] - B[0][2]) * (R[1][0] - R[0][0]) - (B[1][2] - B[0][2]) * (R[2][0] - R[0][0])) / det;
                            // meters of height per mm on paper, and the gap wanted at this tone
                            const grad = Math.hypot(a, b), want = T.shadeGap / tone ** 1.6;
                            let m = 1;
                            while (m <= 32 && (m * dz) / grad < want) m *= 2;
                            if (m <= 32) {
                                for (let L = Math.ceil(lo / (m * dz)) * m; L * dz < hi; L += m) {
                                    const e = crossing(tri, P, zs, L * dz);
                                    if (e && dry(e[0].c) && dry(e[1].c)) add(shades, L, e);
                                }
                            }
                        }
                    }
                    // Rock: ledges across the steep faces above the trees. Under snow
                    // only the steepest faces stay bare. Not on the darkest faces, where
                    // they'd double up the shading into a solid patch.
                    const sl = Math.hypot(nb[0], nb[1]) / nb[2], zm = (zs[0] + zs[1] + zs[2]) / 3;
                    if (p.rock > 0 && tone < 0.55 && zm > V.treeline - p.relief * 0.05 && sl > (zm > V.snowAt(P[0][0], P[0][1]) ? steep + 0.5 : steep)) {
                        for (let L = Math.ceil(lo / strata); L * strata < hi; L++) {
                            const e = crossing(tri, P, zs, L * strata);
                            if (e) add(ledges, L, e);
                        }
                    }
                    if (p.contours) {
                        for (let L = Math.ceil(lo / iv) * iv; L < hi; L += iv) {
                            if (L > snow && Math.round(L / iv) % 4) continue;
                            const e = crossing(tri, P, zs, L);
                            if (e && dry(e[0].c) && dry(e[1].c)) add(levels, L, e);
                        }
                    }
                });
            }
        }
        // the outline, pulled towards us a little so the ground it sits on can't hide it
        const toCam = [-cam.fx * cam.ce * 0.25, -cam.fy * cam.ce * 0.25, cam.se * 0.25];
        S.kind = INK;
        for (const line of stitch(outline)) S.line(line.map(q => [q[0] + toCam[0], q[1] + toCam[1], q[2] + toCam[2]]));
        S.kind = SHADOW;
        for (const segs of shades.values()) for (const line of stitch(segs)) S.line(line.map(q => [q[0], q[1], q[2] + 0.03]));
        // the ledges broken up into short lengths, so they read as rock rather than contours
        S.kind = INK;
        const dash = new PG.RNG(hash(p.seed, 905));
        for (const segs of ledges.values()) {
            for (const line of stitch(segs)) {
                for (const piece of dashes(line, dash, 1.5, 7, 1, 5)) S.line(piece.map(q => [q[0], q[1], q[2] + 0.04]));
            }
        }
        for (const [L, segs] of levels) {
            S.kind = L >= snow ? SNOW : EARTH;
            for (const line of stitch(segs)) S.line(line.map(q => [q[0], q[1], q[2] + 0.03]));
        }
        S.kind = BLUE;
        for (const line of stitch(shore)) {
            // take the corners off where the shore zigzags across the grid
            let q = line;
            for (let pass = 0; pass < 2; pass++) q = q.map((c, i) => (i && i < q.length - 1 ? c.map((v, k) => (q[i - 1][k] + 2 * v + q[i + 1][k]) / 4) : c));
            // which pulls it off the edge a little, so keep it up on the bank
            S.line(q.map(c => [c[0], c[1], Math.max(c[2], G.at(c[0], c[1])) + 0.05]));
        }
        // Edges of the ground. The cutaway draws the ones on the sides we see.
        S.kind = INK;
        const fc = (i, j, k) => facing[(j * nx + i) * 2 + k];
        const d0 = (i, j) => G.diag[j * nx + i] === 0;
        const edge = (a, b) => S.line([G.pt(a), G.pt(b)].map(q => [q[0], q[1], q[2] + 0.03]));
        const out = n => !(p.cutaway && cam.facing(n[0], n[1], 0));
        const [ux, uy] = G.u;
        // In a cell split along a-c, triangle 0 has the bottom and right edges and 1
        // the top and left. Split along b-d, 0 has the bottom and left, 1 the top and right.
        for (let i = 0; i < nx; i++) {
            if (out([uy, -ux]) && fc(i, 0, 0)) edge(G.id(i, 0), G.id(i + 1, 0));
            if (out([-uy, ux]) && fc(i, ny - 1, 1)) edge(G.id(i, ny), G.id(i + 1, ny));
        }
        for (let j = 0; j < ny; j++) {
            if (out([-ux, -uy]) && fc(0, j, d0(0, j) ? 1 : 0)) edge(G.id(0, j), G.id(0, j + 1));
            if (out([ux, uy]) && fc(nx - 1, j, d0(nx - 1, j) ? 0 : 1)) edge(G.id(nx, j), G.id(nx, j + 1));
        }
    }

    // A polyline (3D points) cut into dashes of random lengths between a0 and a1
    // meters, with gaps between g0 and g1
    function dashes(line, rng, a0, a1, g0, g1) {
        const out = [];
        let cur = [line[0]], on = true, left = rng.range(a0, a1);
        for (let i = 1; i < line.length; i++) {
            let a = line[i - 1];
            const b = line[i];
            let d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            while (d > left) {
                const t = left / d, c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
                if (on) { cur.push(c); if (cur.length > 1) out.push(cur); }
                else cur = [c];
                on = !on;
                d -= left;
                a = c;
                left = on ? rng.range(a0, a1) : rng.range(g0, g1);
            }
            left -= d;
            if (on) cur.push(b);
        }
        if (on && cur.length > 1) out.push(cur);
        return out;
    }

    // Ripples on open water
    function waterMarks(T, G, rng) {
        const { S, k, cam } = T;
        S.kind = BLUE;
        const gap = Math.max(2.1, 0.9 / k);
        for (let b = 2; b < G.Ly; b += gap) {
            for (let a = 2; a < G.Lx; a += 5) {
                const [x, y] = G.world(a + rng.range(-1.5, 1.5), b + rng.range(-0.5, 0.5)), len = rng.range(1.2, 3.5);
                const p0 = [x - cam.rx * len / 2, y - cam.ry * len / 2], p1 = [x + cam.rx * len / 2, y + cam.ry * len / 2];
                if (G.wet(...p0) && G.wet(...p1) && G.wet(x, y) && rng.chance(0.68)) {
                    S.line([[...p0, G.sample(G.W, ...p0) + 0.08], [...p1, G.sample(G.W, ...p1) + 0.08]]);
                }
            }
        }
        S.kind = INK;
    }

    function groundShadow(T, G, vertices) {
        const [sx, sy] = T.shadowDir;
        const shadow = PG.iso.hull(vertices.map(([x, y, z]) => {
            // Where the ground falls away steeper than the sun the shadow never lands and
            // runs off down the slope as a fan of hatching, so keep it to the length it'd be
            // on level ground
            const cap = Math.max(0, z - G.at(x, y)) + 0.5;
            let qx = x, qy = y;
            for (let i = 0; i < 4; i++) {
                const h = geo.clamp(z - G.at(qx, qy), 0, cap);
                qx = x + sx * h; qy = y + sy * h;
            }
            return [qx, qy];
        }));
        T.S.kind = SHADOW;
        for (const line of geo.hatch([shadow], 0.65 / T.k, Math.atan2(T.cam.ry, T.cam.rx))) T.S.line(drape(G, line, 0.1));
        T.S.kind = INK;
    }

    // The two cut faces of the block we can see: the ground's edge along the
    // top, strata below it and the base
    function drawSides(T, G, zb, rng) {
        const { S, cam } = T;
        const N = PG.makeNoise(rng);
        const sides = [];
        if (cam.facing(0, -1, 0)) sides.push({ n: G.nx, v: i => G.id(i, 0) });
        if (cam.facing(-1, 0, 0)) sides.push({ n: G.ny, v: j => G.id(0, j) });
        if (cam.facing(0, 1, 0)) sides.push({ n: G.nx, v: i => G.id(i, G.ny) });
        if (cam.facing(1, 0, 0)) sides.push({ n: G.ny, v: j => G.id(G.nx, j) });
        const [, top] = G.bounds();
        for (const sd of sides) {
            const pts = [];
            for (let i = 0; i <= sd.n; i++) pts.push([...G.pt(sd.v(i)), G.W[sd.v(i)]]);
            for (let i = 0; i < sd.n; i++) {
                const a = pts[i], b = pts[i + 1];
                S.face([[a[0], a[1], zb], [b[0], b[1], zb], [b[0], b[1], Math.max(b[2], b[3])], [a[0], a[1], Math.max(a[2], a[3])]]);
            }
            S.kind = INK;
            S.line(pts.map(q => [q[0], q[1], q[2]]));
            S.line([[pts[0][0], pts[0][1], zb], [pts[sd.n][0], pts[sd.n][1], zb]]);
            for (const q of [pts[0], pts[sd.n]]) S.line([[q[0], q[1], zb], [q[0], q[1], q[2]]]);
            // water cut through: its surface and the bed under it
            S.kind = BLUE;
            let run = [];
            for (const q of pts) {
                if (q[3] > q[2]) run.push([q[0], q[1], q[3]]);
                else if (run.length) { if (run.length > 1) S.line(run); run = []; }
            }
            if (run.length > 1) S.line(run);
            // strata: wavy layers, stopping short of the surface
            S.kind = EARTH;
            const layers = Math.max(3, Math.round((top - zb) / 9));
            for (let k = 1; k < layers; k++) {
                const base = zb + ((top - zb) * k) / layers;
                let seg = [];
                for (let i = 0; i <= sd.n; i++) {
                    const q = pts[i], z = base + 3.5 * N.fbm2(q[0] * 0.02 + k * 3.1, q[1] * 0.02 - k, 2) + k * 0.8 * N.noise2(i * 0.05, k);
                    if (z < q[2] - 1.2) seg.push([q[0], q[1], z]);
                    else { if (seg.length > 1) S.line(seg); seg = []; }
                }
                if (seg.length > 1) S.line(seg);
            }
            // topsoil a little under the surface
            S.line(pts.map(q => [q[0], q[1], q[2] - Math.min(1.4, (q[2] - zb) * 0.2)]));
        }
    }

    // ------------------------------------------------------------------
    // Earthworks: where the road, village, hut and top station go, and the
    // railway. Anything that reshapes the ground has to happen here, before
    // it's drawn.
    // ------------------------------------------------------------------

    // Level the ground round (x, y) out to r, blending back in over the next r/2
    function level(G, x, y, r, z) {
        G.near(x, y, r * 1.5, (v, d) => { G.h[v] = geo.lerp(G.h[v], z, 1 - smooth(r, r * 1.5, d)); });
    }

    // A line across the valley behind the village on a run of stone arches,
    // into tunnels either side
    function railLine(G, P, V, rng) {
        const pts = [], zs = [], inside = [], kind = [];
        const lift = Math.max(9, Math.min(14, P.U * 0.067)), tr = rng.range(0.54, 0.59);
        const z0 = V.floorAt(tr) + lift, phase = rng.range(-0.2, 0.2);
        const u0 = -16, u1 = P.U + 16, n = Math.ceil((u1 - u0) / 2);
        for (let i = 0; i <= n; i++) {
            const t = i / n, [x, y] = P.w(geo.lerp(u0, u1, t), P.V * (tr + 0.05 * Math.sin(Math.PI * t + phase)));
            const z = z0 + t * 2.2, ground = G.at(x, y);
            pts.push([x, y]); zs.push(z);
            inside.push(G.inside(x, y, 1));
            kind.push(ground > z + 5 ? 'tunnel' : ground < z - 3.5 ? 'bridge' : 'shelf');
        }
        pts.forEach(([x, y], i) => {
            if (kind[i] !== 'shelf' || !inside[i]) return;
            G.near(x, y, 4.5, (v, d) => {
                G.h[v] = geo.lerp(G.h[v], zs[i], 1 - smooth(2.5, 4.5, d));
                G.W[v] = Math.min(G.W[v], G.h[v] - 0.5);
            });
        });
        return { pts, zs, inside, kind };
    }

    function mainRoad(G, V, side) {
        const off = V.W0 * 0.62, qs = [], os = [];
        const a = parAt(V.axis, -0.5), b = parAt(V.axis, 0.78);
        for (let i = 0; i <= 80; i++) {
            const q = pathAt(V.axis, geo.lerp(a, b, i / 80)), nx = -q.uy * side, ny = q.ux * side;
            let o = off;
            while (o < off + 80 && (G.wet(q.x + nx * o, q.y + ny * o) || G.wet(q.x + nx * (o - 5), q.y + ny * (o - 5)))) o += 1;
            qs.push([q.x, q.y, nx, ny]);
            os.push(o);
        }
        // widen the detour a bit either side before smoothing, or the curves cut back into the water
        let o2 = os.map((_, i) => Math.max(...os.slice(Math.max(0, i - 3), i + 4)));
        for (let pass = 0; pass < 2; pass++) o2 = o2.map((_, i) => { const w = o2.slice(Math.max(0, i - 3), i + 4); return w.reduce((u, v) => u + v, 0) / w.length; });
        return geo.chaikin(qs.map(([x, y, nx, ny], i) => [x + nx * o2[i], y + ny * o2[i]]), 1);
    }

    function earthworks(G, P, V, rng, p) {
        // the village goes on the wide side of the river, near the front
        const probe = P.w(P.U * 0.85, P.V * 0.15), side = nearest(V.axis, probe[0], probe[1]).side;
        const E = { side };
        E.main = mainRoad(G, V, side);
        const seen = (x, y, m) => G.inside(x, y, 8) && P.seen(x, y, G.at(x, y), m);
        // the village: whichever spot on the road side of the floor has the most flat dry ground round it
        const room = (x, y) => {
            let n = 0;
            for (let r = 12; r <= 48; r += 12) {
                for (let k = 0; k < r / 2; k++) {
                    const a = (k / (r / 2)) * TAU, qx = x + r * Math.cos(a), qy = y + r * Math.sin(a);
                    if (seen(qx, qy, 4) && G.slope(qx, qy) < 0.3 && !G.wet(qx, qy)) n++;
                }
            }
            return n;
        };
        for (let k = 0; k < 40; k++) {
            const q = pathAt(V.axis, parAt(V.axis, V.tv + rng.range(-0.08, 0.08))), o = V.W0 * 0.62 * rng.range(1.3, 2.6);
            const x = q.x - q.uy * o * side, y = q.y + q.ux * o * side;
            if (G.wet(x, y) || !seen(x, y, 15)) continue;
            const score = room(x, y) + rng.range(0, 4);
            if (!E.village || score > E.village.score) E.village = { x, y, score, ang: Math.atan2(q.uy, q.ux) };
        }
        if (!E.village) {
            const q = pathAt(V.axis, parAt(V.axis, V.tv));
            E.village = { x: q.x - q.uy * V.W0 * 1.2 * side, y: q.y + q.ux * V.W0 * 1.2 * side, ang: Math.atan2(q.uy, q.ux) };
        }
        // the hut on a little alp cut into the slope a way above the village. Try a few spots
        // until one has a road up to it that isn't too steep.
        if (p.hut) {
            const v = E.village, zv = G.at(v.x, v.y), cands = [];
            for (let tries = 0; tries < 400; tries++) {
                const [x, y] = P.w(P.U * rng.range(0.04, 0.96), P.V * rng.range(0.1, 0.85));
                if (!seen(x, y, 12) || G.wet(x, y) || nearest(V.axis, x, y).side !== side) continue;
                const z = G.at(x, y), d = Math.hypot(x - v.x, y - v.y), rise = (z - zv) / p.relief;
                if (d < 50 || d > 170 || rise < 0.1 || rise > 0.4) continue;
                cands.push({ x, y, z, score: -Math.abs(rise - 0.22) * 6 - G.slope(x, y) - d / 300 });
            }
            cands.sort((a, b) => b.score - a.score);
            for (const c of cands.slice(0, 4)) {
                const keep = G.h.slice();
                level(G, c.x, c.y, 11, c.z);
                // off the main road where it passes nearest, so the road doesn't run
                // alongside it first and cross back over it
                let from = E.main[0];
                for (const q of E.main) if (Math.hypot(q[0] - c.x, q[1] - c.y) < Math.hypot(from[0] - c.x, from[1] - c.y)) from = q;
                let route = null;
                // on steep ground a gentle grade only fits hairpins narrower than the
                // road, which draws as a scribble, so go steeper until it untangles
                for (const grade of [0.18, 0.26, 0.4, 0.6]) {
                    if (!route) route = climb(G, from, [c.x, c.y], grade);
                    if (route && tangled(route, 3.5)) route = null;
                }
                if (route) {
                    E.hut = [c.x, c.y, c.z];
                    E.hutRoad = route;
                    break;
                }
                G.h.set(keep);
            }
        }
        // the top station on the highest summit we can see
        if (p.cable) {
            let top = null;
            for (let v = 0; v < G.h.length; v += 2) {
                const q = G.pt(v);
                if ((!top || q[2] > top[2]) && seen(q[0], q[1], 14)) top = q;
            }
            if (top) {
                level(G, top[0], top[1], 6, top[2] - 1.5);
                E.top = top;
            }
        }
        if (p.railway) E.rail = railLine(G, P, V, rng);
        G.split();
        return E;
    }

    // ------------------------------------------------------------------
    // The railway
    // ------------------------------------------------------------------

    // Frame along a stretch of line from a to b (x, y, z), u along it, v across
    function along(a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, U = [dx / l, dy / l, 0], Vv = [-dy / l, dx / l, 0];
        return {
            len: l, U, V: Vv,
            P: (u, v, c) => [a[0] + U[0] * u + Vv[0] * v, a[1] + U[1] * u + Vv[1] * v, a[2] + (b[2] - a[2]) * (u / l) + c],
        };
    }

    // Stone viaduct under a stretch of the line: a pier down to the ground
    // every span or so and a round arch between each pair, the arch and its
    // ring of voussoirs drawn on the side we see
    function viaduct(T, G, run) {
        const S = T.S, wv = 2.4, tp = 1.2, per = 6;
        const piers = [];
        for (let i = 0; i < run.length; i += per) piers.push(run[i]);
        if (piers[piers.length - 1] !== run[run.length - 1]) piers.push(run[run.length - 1]);
        S.kind = INK;
        for (let k = 0; k + 1 < piers.length; k++) {
            const a = piers[k], b = piers[k + 1], F = along(a, b), L = F.len, ls = L - 2 * tp;
            if (ls < 2) continue;
            const r = ls / 2, um = L / 2, zs = Math.min(a[2], b[2]) - 1 - r;
            // the face we see: whichever side of the viaduct points at the camera
            const vs = T.sees([F.V[0], F.V[1], 0]) ? wv : -wv;
            const n = 14;
            for (let i = 0; i < n; i++) {
                const u0 = tp + (ls * i) / n, u1 = tp + (ls * (i + 1)) / n;
                const arc = u => zs - a[2] - (b[2] - a[2]) * (u / L) + Math.sqrt(Math.max(0, r * r - (u - um) ** 2));
                const top = -0.5;
                S.prism([F.P(u0, -wv, arc(u0)), F.P(u1, -wv, arc(u1)), F.P(u1, -wv, top), F.P(u0, -wv, top)], [F.V[0] * 2 * wv, F.V[1] * 2 * wv, 0], false, true);
            }
            // arch and ring
            const ring0 = [], ring1 = [];
            for (let i = 0; i <= 20; i++) {
                const th = Math.PI - (Math.PI * i) / 20, u = um + r * Math.cos(th), c = zs - a[2] - (b[2] - a[2]) * (u / L);
                ring0.push(F.P(u, vs, c + r * Math.sin(th)));
                ring1.push(F.P(um + (r + 0.5) * Math.cos(th), vs, zs - a[2] - (b[2] - a[2]) * ((um + (r + 0.5) * Math.cos(th)) / L) + (r + 0.5) * Math.sin(th)));
            }
            S.line(ring0);
            if (T.k > 0.6) S.line(ring1);
            // deck: its edge along the face we see, and a parapet each side
            for (const v of [-wv, wv]) {
                S.line([F.P(0, v, -0.5), F.P(L, v, -0.5)]);
                S.line([F.P(0, v, 0.9), F.P(L, v, 0.9)]);
            }
            S.face([F.P(0, -wv, 0), F.P(L, -wv, 0), F.P(L, wv, 0), F.P(0, wv, 0)], false);
        }
        // piers, from below the ground up to the deck
        for (let k = 0; k < piers.length; k++) {
            const q = piers[k], nb = piers[Math.min(k + 1, piers.length - 1)], pb = piers[Math.max(k - 1, 0)];
            const F = along(pb === q ? q : pb, nb === q ? q : nb), g = G.at(q[0], q[1]);
            if (g > q[2] - 2) continue;
            const P = axesAt(q, F.U, F.V);
            S.box(P, -tp, -wv, g - q[2] - 1, tp, wv, -0.5);
            // cutwaters widening at the foot
            S.box(P, -tp - 0.3, -wv - 0.3, g - q[2] - 1, tp + 0.3, wv + 0.3, g - q[2] + 1.5);
        }
    }

    function axesAt(o, U, V) {
        return {
            P: (a, b, c) => [o[0] + a * U[0] + b * V[0], o[1] + a * U[1] + b * V[1], o[2] + c],
            V: (a, b, c) => [a * U[0] + b * V[0], a * U[1] + b * V[1], c],
        };
    }

    // Tunnel mouth: a wall across the line with an arched opening, dark inside.
    // U points out of the tunnel. If that side faces away from us we'd only see
    // the back of the wall, which should be buried in the hill, so leave it out.
    function portal(T, q, U, V) {
        if (!T.sees(U)) return;
        const S = T.S, F = axesAt(q, U, V), w = 4.2, h = 6.5, r = 2.4;
        S.kind = INK;
        S.box(F, -0.6, -w, -1.5, 0.6, w, h);
        S.box(F, -0.8, -w - 0.2, h, 0.8, w + 0.2, h + 0.4);
        const pts = [F.P(0.62, -r, 0)];
        for (let i = 0; i <= 12; i++) pts.push(F.P(0.62, -r * Math.cos((Math.PI * i) / 12), 3 + r * Math.sin((Math.PI * i) / 12)));
        pts.push(F.P(0.62, r, 0));
        S.loop(pts);
        S.hatch(pts, [0, 0, 1], 0.3);
    }

    // Red train on the line: an engine and a few carriages, each a box along
    // the track with its lower half filled in red and a row of windows
    function train(T, pts, zs, at, rng) {
        const S = T.S, cars = rng.int(3, 4), carL = 5;
        for (let c = 0; c < cars; c++) {
            const i0 = at - c * (carL + 1), i1 = i0 - carL;
            if (i1 < 0) break;
            const a = [pts[i1][0], pts[i1][1], zs[i1] + 0.5], b = [pts[i0][0], pts[i0][1], zs[i0] + 0.5];
            const F = along(a, b), L = F.len - 0.4, w = 1.45, h = 3.1;
            const P = { P: (u, v, z) => F.P(u + 0.2, v, z), V: (u, v, z) => [F.U[0] * u + F.V[0] * v, F.U[1] * u + F.V[1] * v, z] };
            S.kind = INK;
            S.box(P, 0, -w, 0, L, w, h);
            S.box(P, 0.2, -w + 0.2, h, L - 0.2, w - 0.2, h + 0.3);
            if (c === 0) {
                // pantograph on the engine
                S.line([P.P(L * 0.3, -0.5, h + 0.3), P.P(L * 0.5, 0, h + 1.4), P.P(L * 0.7, 0.5, h + 0.3)]);
                S.line([P.P(L * 0.35, 0, h + 1.4), P.P(L * 0.65, 0, h + 1.4)]);
            }
            for (const v of [-w, w]) {
                const n = [F.V[0] * Math.sign(v), F.V[1] * Math.sign(v), 0];
                if (!T.sees(n)) continue;
                const band = [P.P(0.1, v, 0.15), P.P(L - 0.1, v, 0.15), P.P(L - 0.1, v, 1.5), P.P(0.1, v, 1.5)];
                S.kind = RED;
                S.hatch(band, [0, 0, 1], 0.3);
                S.hatch([P.P(0.1, v, 2.6), P.P(L - 0.1, v, 2.6), P.P(L - 0.1, v, h - 0.1), P.P(0.1, v, h - 0.1)], [0, 0, 1], 0.3);
                S.kind = INK;
                const m = Math.max(2, Math.round(L / 1.6));
                for (let k = 0; k < m; k++) {
                    const u = 0.4 + ((L - 0.8) * k) / m;
                    S.loop([P.P(u, v, 1.7), P.P(u + (L - 0.8) / m - 0.3, v, 1.7), P.P(u + (L - 0.8) / m - 0.3, v, 2.4), P.P(u, v, 2.4)]);
                }
            }
        }
    }

    // Draw the line: rails and ties on the shelf and the viaducts, piers and
    // arches under the viaducts, portals where it goes into the mountain, and
    // a train somewhere out in the open
    function drawRail(T, G, R, claims, nearCable, rng) {
        const S = T.S, { pts, zs, kind, inside } = R;
        const q3 = i => [pts[i][0], pts[i][1], zs[i]];
        let i = 0;
        const open = [];
        while (i < pts.length) {
            let j = i;
            while (j < pts.length && kind[j] === kind[i] && inside[j]) j++;
            if (j === i) { i++; continue; }
            const run = [];
            for (let q = i; q < Math.min(j + 1, pts.length); q++) if (inside[q]) run.push(q3(q));
            if (kind[i] === 'bridge' && run.length > 2) viaduct(T, G, run);
            if (kind[i] !== 'tunnel' && run.length > 1) open.push([i, j]);
            if (kind[i] === 'tunnel') {
                for (const e of [i, j - 1]) {
                    const o = kind[e === i ? Math.max(0, i - 1) : Math.min(pts.length - 1, j)];
                    if (o === 'tunnel' || !inside[e]) continue;
                    const a = pts[Math.max(0, e - 1)], b = pts[Math.min(pts.length - 1, e + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    const s = e === i ? -1 : 1, ux = (s * (b[0] - a[0])) / l, uy = (s * (b[1] - a[1])) / l;
                    portal(T, q3(e), [ux, uy, 0], [-uy, ux, 0]);
                }
            }
            claims.line(run, 3);
            i = j;
        }
        // rails and ties
        S.kind = INK;
        for (const [a, b] of open) {
            for (const off of [-0.75, 0.75]) {
                const line = [];
                for (let q = a; q < Math.min(b + 1, pts.length); q++) {
                    if (!inside[q]) continue;
                    const p0 = pts[Math.max(0, q - 1)], p1 = pts[Math.min(pts.length - 1, q + 1)], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
                    line.push([pts[q][0] - ((p1[1] - p0[1]) / l) * off, pts[q][1] + ((p1[0] - p0[0]) / l) * off, zs[q] + 0.35]);
                }
                if (line.length > 1) S.line(line);
            }
            for (let q = a + ((a + 1) & 1); q < Math.min(b + 1, pts.length); q += 2) {
                if (!inside[q]) continue;
                const p0 = pts[Math.max(0, q - 1)], p1 = pts[Math.min(pts.length - 1, q + 1)], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
                const nx = -(p1[1] - p0[1]) / l, ny = (p1[0] - p0[0]) / l;
                S.line([[pts[q][0] - nx * 1.5, pts[q][1] - ny * 1.5, zs[q] + 0.3], [pts[q][0] + nx * 1.5, pts[q][1] + ny * 1.5, zs[q] + 0.3]]);
            }
        }
        // a train out in the open, not right under the cable car
        const long = open.filter(([a, b]) => b - a > 30);
        for (let tries = 0; long.length && tries < 20; tries++) {
            const [a, b] = rng.pick(long), at = rng.int(a + 26, b - 2);
            if (tries < 19 && pts.slice(at - 26, at + 1).some(q => nearCable(q[0], q[1], 10))) continue;
            train(T, pts, zs, at, rng);
            break;
        }
    }

    // ------------------------------------------------------------------
    // On the ground
    // ------------------------------------------------------------------

    // Keeps things that stand on the ground out of each other's way
    class Claims {
        constructor() { this.cells = new Map(); this.radius = 0; }
        key(x, y) { return `${Math.floor(x / 8)},${Math.floor(y / 8)}`; }
        free(x, y, r) {
            const i0 = Math.floor(x / 8), j0 = Math.floor(y / 8), n = Math.ceil((r + this.radius) / 8);
            for (let i = i0 - n; i <= i0 + n; i++) {
                for (let j = j0 - n; j <= j0 + n; j++) {
                    for (const [a, b, q] of this.cells.get(`${i},${j}`) || []) if ((a - x) ** 2 + (b - y) ** 2 < (q + r) ** 2) return false;
                }
            }
            return true;
        }
        take(x, y, r) {
            this.radius = Math.max(this.radius, r);
            const k = this.key(x, y);
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push([x, y, r]);
        }
        // a line of them, for roads and cables
        line(pts, r) { for (const [x, y] of pts) this.take(x, y, r); }
    }

    // Polyline laid on the ground, a hair above it, split into short steps
    const drape = (G, pts, lift = 0.15) => {
        const out = [];
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.2));
            for (let k = 0; k < n; k++) {
                const x = geo.lerp(a[0], b[0], k / n), y = geo.lerp(a[1], b[1], k / n);
                out.push([x, y, G.at(x, y) + lift]);
            }
        }
        const e = pts[pts.length - 1];
        out.push([e[0], e[1], G.at(e[0], e[1]) + lift]);
        return out;
    };

    // Two parallel lines either side of a path, each laid on the ground
    function road(T, G, pts, w) {
        const S = T.S, L = [], R = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
            L.push([pts[i][0] + nx * w / 2, pts[i][1] + ny * w / 2]);
            R.push([pts[i][0] - nx * w / 2, pts[i][1] - ny * w / 2]);
        }
        S.kind = ROAD;
        for (const side of [L, R]) {
            let run = [];
            for (const q of side) {
                if (G.inside(q[0], q[1]) && !G.wet(q[0], q[1])) run.push(q);
                else { if (run.length > 1) S.line(drape(G, run)); run = []; }
            }
            if (run.length > 1) S.line(drape(G, run));
        }
        // roads used to be drawn in ink, and what comes after still expects it
        S.kind = INK;
    }

    // Way up a slope: the cheapest route over the grid where the grade stays
    // under `grade`, which puts in the hairpins by itself where it's steep
    function climb(G, from, to, grade) {
        const { nx, ny, h } = G, N = (nx + 1) * (ny + 1);
        const cell = (x, y) => { const [i, j] = G.cell(x, y); return G.id(geo.clamp(i, 1, nx - 1), geo.clamp(j, 1, ny - 1)); };
        const s = cell(...from), t = cell(...to);
        const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
        const moves = [];
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if ((a || b) && (Math.abs(a) !== 2 || Math.abs(b) !== 2) && (Math.abs(a) + Math.abs(b) < 4)) moves.push([a, b]);
        // a binary heap on (cost, vertex)
        const heap = [];
        const push = (c, v) => {
            heap.push([c, v]);
            for (let i = heap.length - 1; i > 0;) {
                const q = (i - 1) >> 1;
                if (heap[q][0] <= heap[i][0]) break;
                [heap[q], heap[i]] = [heap[i], heap[q]];
                i = q;
            }
        };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                for (let i = 0; ;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                    if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                    if (m === i) break;
                    [heap[m], heap[i]] = [heap[i], heap[m]];
                    i = m;
                }
            }
            return top;
        };
        const tx = t % (nx + 1), ty = Math.floor(t / (nx + 1));
        dist[s] = 0;
        push(0, s);
        while (heap.length) {
            const [, v] = pop();
            if (done[v]) continue;
            done[v] = 1;
            if (v === t) break;
            const i = v % (nx + 1), j = Math.floor(v / (nx + 1));
            for (const [a, b] of moves) {
                const i2 = i + a, j2 = j + b;
                if (i2 < 1 || j2 < 1 || i2 >= nx || j2 >= ny) continue;
                const w = G.id(i2, j2), run = Math.hypot(a * G.dx, b * G.dy), g = Math.abs(h[w] - h[v]) / run;
                if (g > grade || G.W[w] > h[w]) continue;
                const nc = dist[v] + run * (1 + 4 * g);
                if (nc < dist[w]) {
                    dist[w] = nc;
                    prev[w] = v;
                    push(nc + 0.8 * Math.hypot((i2 - tx) * G.dx, (j2 - ty) * G.dy), w);
                }
            }
        }
        if (prev[t] < 0) return null;
        const path = [];
        for (let v = t; v >= 0; v = prev[v]) path.push(G.vxy(v % (nx + 1), Math.floor(v / (nx + 1))));
        return geo.chaikin(path.reverse(), 2);
    }

    // Does the path come back within w of itself further along
    function tangled(path, w) {
        const cum = lengths(path);
        for (let i = 0; i < path.length; i++) {
            for (let j = i + 1; j < path.length; j++) {
                if (cum[j] - cum[i] > 2 * w && Math.hypot(path[j][0] - path[i][0], path[j][1] - path[i][1]) < w) return true;
            }
        }
        return false;
    }

    // Line round a base where its walls go into the ground. Without it a base
    // on a slope looks like it's standing on legs.
    function footing(T, G, F, x0, y0, x1, y1) {
        const pts = [], c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
        for (let k = 0; k < 4; k++) {
            const [a0, b0] = c[k], [a1, b1] = c[k + 1], n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / 1.5));
            for (let i = 0; i < n; i++) {
                const q = F.P(geo.lerp(a0, a1, i / n), geo.lerp(b0, b1, i / n), 0);
                pts.push([q[0], q[1], G.at(q[0], q[1]) + 0.05]);
            }
        }
        pts.push(pts[0]);
        T.S.line(pts);
    }

    // Lattice pylon from the ground up to a crossarm at `top`, across `A`
    function pylon(T, x, y, z0, top, A) {
        const S = T.S, w0 = 1.6, w1 = 0.5, h = top - z0;
        const at = (sx, sy, f) => { const w = geo.lerp(w0, w1, f); return [x + (A[0] * sx - A[1] * sy) * w, y + (A[1] * sx + A[0] * sy) * w, z0 + h * f]; };
        const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sx, sy] of legs) S.line([at(sx, sy, 0), at(sx, sy, 1)]);
        // bracing on the two near faces only, with all four it's a solid scribble at this size
        const n = Math.max(2, Math.round(h / 5));
        for (let k = 0; k < 4; k++) {
            const [ax, ay] = legs[k], [bx, by] = legs[(k + 1) % 4], mx = (ax + bx) / 2, my = (ay + by) / 2;
            if (!T.sees([A[0] * mx - A[1] * my, A[1] * mx + A[0] * my, 0])) continue;
            for (let i = 0; i < n; i++) S.line([at(ax, ay, i / n), at(bx, by, (i + 1) / n)]);
        }
        S.line([[x - A[0] * 3, y - A[1] * 3, top], [x + A[0] * 3, y + A[1] * 3, top]]);
    }

    // Cable car from `a` up to `b` (ground points): stations at each end,
    // pylons wherever the cable would come down too near the ground, a pair of
    // sagging cables and a cabin or two on them
    function cableCar(T, G, a, b, nearRail, rng) {
        const S = T.S;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), u = [dx / L, dy / L], A = [-u[1], u[0]];
        const za = G.at(a[0], a[1]) + 7, zb = G.at(b[0], b[1]) + 7;
        const sup = [[0, za], [1, zb]];
        // Put in pylons where the sagging cable comes lowest over the ground. Not within
        // 12 m of a support, or the cable leaving a station at 7 m always looks too low
        // and gets a pylon right beside it.
        const m = 12 / L;
        for (let it = 0; it < 4; it++) {
            let worst = null, wc = 6;
            for (let k = 0; k + 1 < sup.length; k++) {
                const [f0, z0] = sup[k], [f1, z1] = sup[k + 1], sag = 0.025 * L * (f1 - f0);
                for (let f = f0 + m; f < f1 - m; f += 0.01) {
                    const s = (f - f0) / (f1 - f0), x = a[0] + dx * f, y = a[1] + dy * f;
                    const c = geo.lerp(z0, z1, s) - sag * 4 * s * (1 - s) - G.at(x, y);
                    if (c < wc) { wc = c; worst = f; }
                }
            }
            if (worst === null) break;
            sup.push([worst, G.at(a[0] + dx * worst, a[1] + dy * worst) + 14]);
            sup.sort((p, q) => p[0] - q[0]);
        }
        S.kind = INK;
        for (const [f, z] of sup.slice(1, -1)) pylon(T, a[0] + dx * f, a[1] + dy * f, G.at(a[0] + dx * f, a[1] + dy * f), z, A);
        // Timber stations with a broad roof and an opening for the cable.
        for (const [p, dir] of [[a, 1], [b, -1]]) {
            const F = turned(p[0], p[1], G.at(p[0], p[1]), Math.atan2(u[1], u[0]));
            S.box(F, -4, -3.5, -2, 4, 3.5, 7.8);
            footing(T, G, F, -4, -3.5, 4, 3.5);
            const roof = gableRoof(T, F, [-4.5, -4, 4.5, 4], 7.8, true, geo.rad(24), rng, { attic: false });
            shadeGable(T, F, roof);
            for (const side of [0, 2]) windows(T, wall(F, side, [-4, -3.5, 4, 3.5]), { base: 0, floors: 2, winW: 1.5, winH: 1.6, gap: 0.8, style: 'cross' });
            groundShadow(T, G, [-4, 4].flatMap(x => [-3.5, 3.5].flatMap(y => [F.P(x, y, 0), F.P(x, y, 9)])));
            if (T.sees(F.V(dir, 0, 0))) {
                const hole = [F.P(4 * dir, -2.8, 3.2), F.P(4 * dir, 2.8, 3.2), F.P(4 * dir, 2.8, 7), F.P(4 * dir, -2.8, 7)];
                S.loop(hole);
                S.hatch(hole, [0, 0, 1], 0.3);
            }
        }
        const cable = (off, f0, z0, f1, z1) => {
            const pts = [], sag = 0.025 * L * (f1 - f0);
            for (let i = 0; i <= 24; i++) {
                const s = i / 24, f = geo.lerp(f0, f1, s);
                pts.push([a[0] + dx * f + A[0] * off, a[1] + dy * f + A[1] * off, geo.lerp(z0, z1, s) - sag * 4 * s * (1 - s)]);
            }
            return pts;
        };
        for (let k = 0; k + 1 < sup.length; k++) for (const off of [-2, 2]) S.line(cable(off, sup[k][0], sup[k][1], sup[k + 1][0], sup[k + 1][1]));
        const hang = (off, f) => {
            let k = 0;
            while (k + 2 < sup.length && sup[k + 1][0] < f) k++;
            const s = (f - sup[k][0]) / (sup[k + 1][0] - sup[k][0]);
            return cable(off, sup[k][0], sup[k][1], sup[k + 1][0], sup[k + 1][1])[Math.round(s * 24)];
        };
        // whether a cabin hanging from q would be drawn over the viaduct, up to 16 m tall
        const back = T.cam.ce / T.cam.se;
        const overRail = q => {
            const h = q[2] - 4.6 - G.at(q[0], q[1]);
            for (let o = h - 16; o <= h; o += 2) if (nearRail(q[0] + T.cam.fx * o * back, q[1] + T.cam.fy * o * back, 8)) return true;
            return false;
        };
        // cabins, one on each track, hanging a few meters under the cable
        for (const [off, f0, f1] of [[-2, 0.25, 0.45], [2, 0.55, 0.75]]) {
            let q = hang(off, rng.range(f0, f1));
            for (let tries = 0; tries < 12 && overRail(q); tries++) q = hang(off, rng.range(f0 - 0.1, f1 + 0.1));
            const F = turned(q[0], q[1], q[2] - 4.6, Math.atan2(u[1], u[0]));
            S.line([q, F.P(0, 0, 2.6)]);
            S.box(F, -1.4, -1.1, 0, 1.4, 1.1, 2.4);
            S.kind = RED;
            S.hatch([F.P(-1.4, -1.1, 2.4), F.P(1.4, -1.1, 2.4), F.P(1.4, 1.1, 2.4), F.P(-1.4, 1.1, 2.4)], F.V(0, 1, 0), 0.35);
            S.kind = INK;
        }
    }

    // Stream from high up in a gully down to the river, taking the steepest
    // way down, falling in streaks where it goes over something steep
    function stream(T, G, start) {
        const S = T.S, { nx, ny, h, W } = G;
        let [i, j] = G.cell(start[0], start[1]);
        i = geo.clamp(i, 1, nx - 1);
        j = geo.clamp(j, 1, ny - 1);
        const path = [];
        for (let step = 0; step < 600; step++) {
            const v = G.id(i, j);
            path.push(G.pt(v));
            if (W[v] > h[v] || i <= 0 || j <= 0 || i >= nx || j >= ny) break;
            let best = null, bz = h[v];
            for (let a = -1; a <= 1; a++) {
                for (let b = -1; b <= 1; b++) {
                    if ((a || b) && h[G.id(i + a, j + b)] < bz) { bz = h[G.id(i + a, j + b)]; best = [i + a, j + b]; }
                }
            }
            if (!best) break;
            [i, j] = best;
        }
        if (path.length < 6) return null;
        const pts = geo.chaikin(path.map(q => [q[0], q[1]]), 2);
        S.kind = BLUE;
        S.line(drape(G, pts, 0.1));
        // a fall of water down the steep stretches
        for (let k = 1; k < path.length; k++) {
            const a = path[k - 1], b = path[k], g = (a[2] - b[2]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (g < 0.9) continue;
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]), ox = -(b[1] - a[1]) / l, oy = (b[0] - a[0]) / l;
            for (const o of [-0.5, 0, 0.5]) S.line([[a[0] + ox * o, a[1] + oy * o, a[2] + 0.2], [b[0] + ox * o, b[1] + oy * o, b[2] + 0.2]]);
        }
        return pts;
    }

    // Paraglider: a curved wing on its lines with the pilot hanging under it
    function paraglider(T, x, y, z, ang, rng) {
        const S = T.S, c = Math.cos(ang), s = Math.sin(ang), span = 9, n = 8;
        const at = (f, dz) => {
            const a = (f - 0.5) * 2.2, r = span / 2.2;
            return [x - s * r * Math.sin(a), y + c * r * Math.sin(a), z + r * Math.cos(a) - r + dz];
        };
        const lead = [], trail = [];
        for (let i = 0; i <= n; i++) {
            const q = at(i / n, 0);
            lead.push([q[0] + c * 1.2, q[1] + s * 1.2, q[2]]);
            trail.push([q[0] - c * 1.2, q[1] - s * 1.2, q[2] - 0.2]);
        }
        for (let i = 0; i < n; i++) S.face([lead[i], lead[i + 1], trail[i + 1], trail[i]]);
        S.kind = FIGURE;
        S.loop(lead.concat(trail.slice().reverse()));
        S.kind = RED;
        for (let i = 0; i < n; i += 2) S.hatch([lead[i], lead[i + 1], trail[i + 1], trail[i]], [c, s, 0], 0.35);
        S.kind = FIGURE;
        const pilot = [x, y, z - 6.5];
        for (const f of [0, 0.3, 0.7, 1]) S.line([at(f, -0.1), pilot]);
        person(T, pilot[0], pilot[1], pilot[2] - 1.2, rng);
        S.kind = INK;
    }

    // A few birds wheeling over the valley
    function birds(T, x, y, z, rng) {
        const S = T.S, c = T.cam;
        S.kind = FIGURE;
        for (let i = rng.int(3, 6); i > 0; i--) {
            const bx = x + rng.range(-15, 15), by = y + rng.range(-15, 15), bz = z + rng.range(-5, 5), w = rng.range(1, 1.6);
            const at = (sx, dz) => [bx + c.rx * sx, by + c.ry * sx, bz + dz];
            S.line([at(-w, 0.3), at(-w * 0.4, 0.45), at(0, 0), at(w * 0.4, 0.45), at(w, 0.3)]);
        }
    }

    // Frame for a building on a slope: the base steps down to the lowest
    // corner, and the floor sits just above the highest
    function plot(T, G, x, y, ang, L, D) {
        const F0 = turned(x, y, 0, ang);
        const zs = [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]].map(([a, b]) => { const q = F0.P(a, b, 0); return G.at(q[0], q[1]); });
        const zlo = Math.min(...zs), zhi = Math.max(...zs);
        return { F: turned(x, y, zhi + 0.3, ang), drop: zlo - zhi - 1.3 };
    }

    // Chalet: a stone base stepping down to the slope, timber walls with
    // shuttered windows and a wide gable roof. Along the street the ridge runs
    // along the front with a balcony under the eaves. Gable fronted ones have
    // a balcony across the gable on every upper floor and a flatter roof.
    function chalet(T, G, x, y, ang, L, D, floors, rng, gable = false) {
        const S = T.S, { F, drop } = plot(T, G, x, y, ang, L, D);
        const fp = [-L / 2, -D / 2, L / 2, D / 2], fh = 2.8, top = floors * fh;
        groundShadow(T, G, [-1, 1].flatMap(a => [-1, 1].flatMap(b => [F.P(a * L / 2, b * D / 2, 0), F.P(a * (L / 2 + 0.7), b * (D / 2 + 0.7), top + D * 0.3)])));
        S.kind = INK;
        S.box(F, -L / 2 - 0.2, -D / 2 - 0.2, drop, L / 2 + 0.2, D / 2 + 0.2, 0);
        footing(T, G, F, -L / 2 - 0.2, -D / 2 - 0.2, L / 2 + 0.2, D / 2 + 0.2);
        S.box(F, -L / 2, -D / 2, 0, L / 2, D / 2, top);
        const R = gableRoof(T, F, fp, top, !gable, geo.rad(gable ? rng.range(22, 27) : rng.range(27, 34)), rng);
        shadeGable(T, F, R);
        if (rng.chance(0.5)) chimney(T, F, gable ? R.mid + rng.range(-1, 1) : rng.range(-L / 3, L / 3), gable ? rng.range(-D / 4, D / 4) : R.mid + 0.6, R.zb, R.ridge + 0.5);
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) door(T, front.at, L / 2, 0, 1.1, 2);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            // timber bands between the floors, shutters either side of each window
            S.kind = ROAD;
            for (let f = 1; f < floors; f++) for (const c of [f * fh, f * fh + 0.3]) S.line([W.at(0, c), W.at(W.len, c)]);
            const n = Math.max(1, Math.floor(W.len / 3)), step = W.len / n;
            for (let f = 0; f < floors; f++) {
                for (let i = 0; i < n; i++) {
                    const s = (i + 0.5) * step - 0.5, c = f * fh + 0.9;
                    if (side === 0 && f === 0 && Math.abs(s + 0.5 - L / 2) < 1.3) continue;
                    S.kind = INK;
                    pane(T, W.at, s, c, 1, 1.2, 'cross');
                    if (T.k > 0.55) {
                        S.kind = ACCENT;
                        for (const a of [s - 0.5, s + 1.1]) pane(T, W.at, a, c, 0.4, 1.2, 'bars');
                    }
                }
            }
        }
        if (T.sees(front.n)) {
            for (let f = 1; f < (gable ? floors : Math.min(2, floors)); f++) balcony(T, F, -L / 2 + 0.3, L / 2 - 0.3, -D / 2, f * fh);
        }
        S.kind = INK;
        return F;
    }

    // Balcony along the front (b = b0) from a0 to a1 at height c: a deck, a
    // rail with its bars, and flower boxes hung on it
    function balcony(T, F, a0, a1, b0, c) {
        const S = T.S, out = b0 - 1;
        S.kind = INK;
        S.box(F, a0, out, c, a1, b0, c + 0.15);
        S.kind = ACCENT;
        S.line([F.P(a0, out, c + 1.1), F.P(a1, out, c + 1.1)]);
        for (let a = a0; a <= a1 + 0.01; a += Math.max(0.65, 0.45 / T.k)) S.line([F.P(a, out, c + 0.15), F.P(a, out, c + 1.1)]);
        S.kind = GREEN;
        for (let a = a0 + 0.7; a < a1 - 0.7; a += 2.8) {
            S.line([F.P(a - 0.7, out - 0.12, c + 0.95), F.P(a, out - 0.2, c + 0.75), F.P(a + 0.7, out - 0.12, c + 0.95)]);
        }
        S.kind = INK;
    }

    // Hip roof over a footprint longer in a than b, its slopes hatched like the gables
    function hipped(T, F, fp, zTop, pitch, oh = 0.5) {
        const [a0, b0, a1, b1] = fp, zb = zTop - 0.2;
        const A0 = a0 - oh, A1 = a1 + oh, B0 = b0 - oh, B1 = b1 + oh, hw = (B1 - B0) / 2, rise = hw * Math.tan(pitch), bm = (B0 + B1) / 2;
        const v = [F.P(A0, B0, zb), F.P(A1, B0, zb), F.P(A1, B1, zb), F.P(A0, B1, zb), F.P(A0 + hw, bm, zb + rise), F.P(A1 - hw, bm, zb + rise)];
        const faces = [[0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5]];
        T.S.solid(v, faces);
        const centre = F.P((a0 + a1) / 2, bm, zb + rise * 0.3);
        for (const f of faces.slice(1)) {
            const pts = f.map(i => v[i]);
            shade(T, pts, outward(pts, centre));
        }
        return { zb, ridge: zb + rise, rise, hw };
    }

    // Grand hotel: a long block of four or five floors with balconies all along
    // the front, a hipped roof with flags, a sign board and a striped awning over
    // the door
    function hotel(T, G, x, y, ang, L, D, rng) {
        const S = T.S, floors = rng.int(4, 5), fh = 2.9, top = 0.4 + floors * fh;
        const { F, drop } = plot(T, G, x, y, ang, L, D), fp = [-L / 2, -D / 2, L / 2, D / 2];
        groundShadow(T, G, [-1, 1].flatMap(a => [-1, 1].flatMap(b => [F.P(a * L / 2, b * D / 2, 0), F.P(a * L / 2, b * D / 2, top + 3)])));
        S.kind = INK;
        S.box(F, -L / 2 - 0.3, -D / 2 - 0.3, drop, L / 2 + 0.3, D / 2 + 0.3, 0.4);
        footing(T, G, F, -L / 2 - 0.3, -D / 2 - 0.3, L / 2 + 0.3, D / 2 + 0.3);
        S.box(F, -L / 2, -D / 2, 0.4, L / 2, D / 2, top);
        S.box(F, -L / 2 - 0.25, -D / 2 - 0.25, top, L / 2 + 0.25, D / 2 + 0.25, top + 0.4);
        const R = hipped(T, F, fp, top + 0.4, geo.rad(rng.range(38, 44)), 0.6);
        // a row of little dormers would crowd it at this size, so just the flags
        for (const a of [-L / 2 + R.hw + 0.6, L / 2 - R.hw - 0.6]) {
            const base = F.P(a, 0, R.ridge), tip = [base[0], base[1], base[2] + 4.5];
            S.line([base, tip]);
            const fl = [tip, [tip[0] + T.cam.rx * 2.2, tip[1] + T.cam.ry * 2.2, tip[2] - 0.6], [tip[0], tip[1], tip[2] - 1.3]];
            S.face(fl);
            S.kind = RED;
            S.loop(fl);
            S.hatch(fl, [0, 0, 1], 0.35);
            S.kind = INK;
        }
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            windows(T, W, { base: 0.4, floors, style: 'frame', winW: 1, winH: 1.55, gap: 1.05, doors: side === 0 ? [L / 2] : [] });
        }
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            door(T, front.at, L / 2, 0.4, 1.8, 2.4, true);
            for (let f = 1; f < floors; f++) balcony(T, F, -L / 2 + 0.6, L / 2 - 0.6, -D / 2, 0.4 + f * fh);
            // sign board under the cornice, with a line of "lettering"
            const c = top - 0.95, w = Math.min(8, L * 0.4), board = [front.at(L / 2 - w / 2, c), front.at(L / 2 + w / 2, c), front.at(L / 2 + w / 2, c + 0.8), front.at(L / 2 - w / 2, c + 0.8)];
            S.face(board);
            S.loop(board);
            S.kind = ACCENT;
            for (let s = L / 2 - w / 2 + 0.5; s < L / 2 + w / 2 - 0.4; s += 0.55) S.line([front.at(s, c + 0.22), front.at(s, c + 0.58)]);
            S.kind = INK;
            PG.isokit.awning(T, F, -2.2, 2.2, -D / 2, 0.4 + 2.75, 1.6, RED);
        }
        S.kind = INK;
        return F;
    }

    // Hay barn up on stone legs, plank walls and a big door, no windows
    function barn(T, G, x, y, ang, rng) {
        const S = T.S, L = rng.range(6, 8), D = rng.range(5, 6.2), h = rng.range(3.4, 4.4);
        const { F, drop } = plot(T, G, x, y, ang, L, D), fp = [-L / 2, -D / 2, L / 2, D / 2];
        groundShadow(T, G, [-1, 1].flatMap(a => [-1, 1].flatMap(b => [F.P(a * L / 2, b * D / 2, 0), F.P(a * L / 2, b * D / 2, h + 2)])));
        S.kind = INK;
        // legs, each with a flat stone on top
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const pa = a * (L / 2 - 0.4), pb = b * (D / 2 - 0.4);
            S.box(F, pa - 0.2, pb - 0.2, drop, pa + 0.2, pb + 0.2, 0.25);
            S.box(F, pa - 0.45, pb - 0.45, 0.25, pa + 0.45, pb + 0.45, 0.45);
        }
        S.box(F, -L / 2, -D / 2, 0.45, L / 2, D / 2, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(rng.range(28, 34)), rng, { attic: false }));
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            S.kind = ROAD;
            const n = Math.max(2, Math.round(W.len / Math.max(0.55, 0.6 / T.k)));
            for (let i = 1; i < n; i++) S.line([W.at((W.len * i) / n, 0.45), W.at((W.len * i) / n, h - 0.1)]);
            S.kind = INK;
            if (side === 0) {
                const door = [W.at(L / 2 - 1.1, 0.45), W.at(L / 2 + 1.1, 0.45), W.at(L / 2 + 1.1, 2.7), W.at(L / 2 - 1.1, 2.7)];
                S.face(door);
                S.loop(door);
                S.line([W.at(L / 2, 0.45), W.at(L / 2, 2.7)]);
            }
        }
        S.kind = INK;
    }

    // Cow: a body, a head, four legs, and a patch on the side we see
    function cow(T, x, y, z, ang) {
        const S = T.S, F = turned(x, y, z, ang);
        S.kind = INK;
        S.box(F, -0.95, -0.4, 0.75, 0.95, 0.4, 1.45);
        S.box(F, 0.95, -0.22, 1.05, 1.45, 0.22, 1.55);
        for (const [a, b] of [[-0.75, -0.3], [0.75, -0.3], [0.75, 0.3], [-0.75, 0.3]]) S.line([F.P(a, b, 0), F.P(a, b, 0.75)]);
        for (const b of [-0.4, 0.4]) {
            if (!T.sees(F.V(0, Math.sign(b), 0))) continue;
            const patch = [F.P(-0.6, b, 0.9), F.P(0.1, b, 0.9), F.P(0.2, b, 1.35), F.P(-0.5, b, 1.35)];
            S.hatch(patch, [0, 0, 1], 0.3);
        }
    }

    // Haystack round a pole
    function haystack(T, x, y, z) {
        const S = T.S;
        S.kind = ACCENT;
        S.lathe(x, y, [[0.95, z], [1.05, z + 0.7], [0.7, z + 1.6], [0, z + 2.3]], T.segs(1));
        S.line([[x, y, z + 2.3], [x, y, z + 2.9]]);
        S.kind = INK;
    }

    // Small car or the yellow post bus, along `ang`
    function vehicle(T, x, y, z, ang, bus) {
        const S = T.S, F = turned(x, y, z, ang);
        S.kind = INK;
        if (bus) {
            const L = 10.5, hw = 1.25, r = 0.5, h = 3.1;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, h);
            for (const b of [-hw, hw]) {
                if (!T.sees(F.V(0, Math.sign(b), 0))) continue;
                S.kind = ACCENT;
                S.hatch([F.P(-L / 2 + 0.1, b, r), F.P(L / 2 - 0.1, b, r), F.P(L / 2 - 0.1, b, 1.6), F.P(-L / 2 + 0.1, b, 1.6)], [0, 0, 1], 0.3);
                S.kind = INK;
                const n = 6;
                for (let i = 0; i < n; i++) {
                    const a = -L / 2 + 0.5 + ((L - 1) * i) / n;
                    S.loop([F.P(a, b, 1.8), F.P(a + (L - 1) / n - 0.25, b, 1.8), F.P(a + (L - 1) / n - 0.25, b, 2.7), F.P(a, b, 2.7)]);
                }
            }
            PG.isokit.wheels(T, F, [-L / 2 + 1.8, L / 2 - 1.8], hw, r);
            return;
        }
        const L = 4.2, hw = 0.9, r = 0.39;
        S.box(F, -L / 2, -hw, r * 0.75, L / 2, hw, 1.02);
        PG.isokit.cabin(T, F, -1.45, 0.85, -1.1, 0.3, hw - 0.06, 1.02, 1.65);
        PG.isokit.wheels(T, F, [-L / 2 + 0.8, L / 2 - 0.85], hw, r);
    }

    // Summit cross on its stone cairn
    function summitCross(T, x, y, z) {
        const S = T.S, c = T.cam;
        S.kind = INK;
        S.lathe(x, y, [[1, z - 0.5], [0.8, z + 0.6], [0, z + 0.9]], 8, false);
        const F = turned(x, y, z + 0.6, Math.atan2(c.ry, c.rx) + 0.5);
        S.box(F, -0.15, -0.15, 0, 0.15, 0.15, 4.2);
        S.box(F, -1.1, -0.12, 2.9, 1.1, 0.12, 3.2);
    }

    // Railway station beside the line: a platform along the track and a
    // timber station house behind it under a canopy
    function station(T, G, R, i0, i1, claims, rng) {
        const S = T.S, { pts, zs } = R, a = pts[i0], b = pts[i1];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], z = (zs[i0] + zs[i1]) / 2;
        // the side of the line we see
        let s = 1;
        if (!T.sees([-dy / L, dx / L, 0])) s = -1;
        const F = turned(mid[0], mid[1], z, ang), P = (u, v, c) => F.P(u, s * v, c);
        S.kind = INK;
        S.box({ P }, -L / 2, 2.1, -2.5, L / 2, 5.1, 0.75);
        // canopy on posts along the platform
        const cu = L * 0.32;
        for (const u of [-cu, -cu / 3, cu / 3, cu]) S.line([P(u, 4.5, 0.75), P(u, 4.5, 3.6)]);
        const roof = [P(-cu - 1, 3.4, 3.6), P(cu + 1, 3.4, 3.6), P(cu + 1, 6.2, 4.3), P(-cu - 1, 6.2, 4.3)];
        S.face(roof);
        S.loop(roof);
        S.kind = RED;
        S.hatch(roof, F.V(0, s, 0), 0.65);
        S.kind = INK;
        // station house just behind
        const hx = F.P(0, s * 10.5, 0);
        claims.take(hx[0], hx[1], 8);
        const sign = s > 0 ? ang : ang + Math.PI;
        chalet(T, G, hx[0], hx[1], sign, 12, 7.5, 2, rng);
        // a clock on a post
        const cp = P(-cu - 3, 3.6, 0.75);
        S.line([cp, [cp[0], cp[1], cp[2] + 3]]);
        S.loop(PG.iso.ring(12, (c, q) => [cp[0] + T.cam.rx * 0.5 * c, cp[1] + T.cam.ry * 0.5 * c, cp[2] + 3.4 + 0.5 * q]));
        claims.line(geo.resample([a, b], 3), 7);
    }

    // Fir woods over the slopes, in clumps down near the floor and thinning
    // out towards the tree line
    function forest(T, G, P, V, claims, rng) {
        const { S, p } = T;
        if (!p.forest) return;
        const N = PG.makeNoise(rng), f = 1 / 45, sp = geo.lerp(7, 3.9, p.forest);
        let count = 0;
        S.kind = GREEN;
        for (let b = sp / 2; b < G.Ly && count < 4500; b += sp * 0.87) {
            const shift = (Math.round(b / (sp * 0.87)) % 2) * sp * 0.5;
            for (let a = sp / 2 + shift; a < G.Lx; a += sp) {
                const [tx, ty] = G.world(a + rng.range(-0.35, 0.35) * sp, b + rng.range(-0.35, 0.35) * sp);
                if (!G.inside(tx, ty, 1)) continue;
                const z = G.at(tx, ty);
                if (!P.seen(tx, ty, z, -5)) continue;
                const floor = V.base(tx, ty), up = (z - floor) / (V.treeline - floor), sl = G.slope(tx, ty);
                if (up > 1 || sl > 1.5 || G.wet(tx, ty)) continue;
                const clump = N.fbm2(tx * f, ty * f, 3) * 0.7 + (up > 0.08 ? 0.3 : -0.25) - 0.45 * smooth(0.65, 1, up);
                if (clump < 0.42 - 0.55 * p.forest || !claims.free(tx, ty, 2.2)) continue;
                claims.take(tx, ty, 1.4);
                conifer(T, tx, ty, z - 0.2, rng.range(6.5, 10.5) * (1.05 - 0.35 * up), rng);
                count++;
            }
        }
        S.kind = INK;
    }

    // Plots on the valley floor, on a grid turned to the main road: plowed,
    // in hay, fenced pasture with cows, orchard or plain meadow with a barn
    function fields(T, G, P, V, E, claims, rng) {
        const { S, p } = T, { x: cx, y: cy, ang } = E.village;
        const d = [Math.cos(ang), Math.sin(ang)], n = [-d[1], d[0]];
        const cw = rng.range(12, 16), cd = rng.range(16, 22), jit = new PG.RNG(hash(p.seed, 911));
        const corner = new Map();
        const at = (i, j) => {
            const key = i * 1000 + j;
            if (!corner.has(key)) {
                const r = new PG.RNG(hash(p.seed, 912, i, j));
                corner.set(key, [cx + d[0] * (i * cw + r.range(-2, 2)) + n[0] * (j * cd + r.range(-3, 3)), cy + d[1] * (i * cw + r.range(-2, 2)) + n[1] * (j * cd + r.range(-3, 3))]);
            }
            return corner.get(key);
        };
        const reach = Math.ceil(Math.max(P.U, P.V) / Math.min(cw, cd)) + 2;
        const flat = (x, y) => G.inside(x, y, 2) && P.seen(x, y, G.at(x, y), -3) && !G.wet(x, y) && G.slope(x, y) < 0.4 && G.at(x, y) - V.base(x, y) < 14;
        const kinds = [[3, 'crop'], [2, 'hay'], [2.2, 'pasture'], [1, 'orchard'], [1.6, 'meadow']];
        for (let j = -reach; j <= reach; j++) {
            for (let i = -reach; i <= reach; i++) {
                // shrunk a little, leaving a track between neighbors
                const c4 = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
                const mx = c4.reduce((s, q) => s + q[0], 0) / 4, my = c4.reduce((s, q) => s + q[1], 0) / 4;
                const poly = c4.map(([x, y]) => [geo.lerp(x, mx, 0.08), geo.lerp(y, my, 0.08)]);
                const probe = [];
                for (let k = 0; k < 4; k++) {
                    const a = poly[k], b = poly[(k + 1) % 4];
                    for (let t = 0; t < 1; t += 0.25) probe.push([geo.lerp(a[0], b[0], t), geo.lerp(a[1], b[1], t)]);
                }
                probe.push([mx, my]);
                if (!probe.every(([x, y]) => flat(x, y) && claims.free(x, y, 1.2))) continue;
                for (const [x, y] of probe) claims.take(x, y, 2.5);
                claims.take(mx, my, Math.min(cw, cd) * 0.45);
                const kind = jit.weighted(kinds);
                S.kind = ROAD;
                S.line(drape(G, poly.concat([poly[0]]), 0.1));
                const along = jit.chance(0.5) ? Math.atan2(d[1], d[0]) : Math.atan2(n[1], n[0]);
                if (kind === 'crop') {
                    S.kind = EARTH;
                    for (const line of geo.hatch([poly], 1.4 / T.k, along)) S.line(drape(G, line, 0.08));
                } else if (kind === 'hay') {
                    // windrows, and a haystack or two
                    S.kind = ACCENT;
                    for (const line of geo.hatch([poly], 3.6, along)) {
                        const len = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
                        for (let t = 0.8; t < len - 0.8; t += 2.4) {
                            const q0 = geo.lerpPt(line[0], line[1], t / len), q1 = geo.lerpPt(line[0], line[1], Math.min(len - 0.6, t + 1.5) / len);
                            S.line(drape(G, [q0, q1], 0.12));
                        }
                    }
                    for (let k = jit.int(0, 2); k > 0; k--) {
                        const q = [mx + jit.range(-4, 4), my + jit.range(-4, 4)];
                        haystack(T, q[0], q[1], G.at(q[0], q[1]));
                    }
                } else if (kind === 'pasture') {
                    S.kind = ROAD;
                    for (let k = 0; k < 4; k++) {
                        const a = poly[k], b = poly[(k + 1) % 4];
                        // the fence follows the ground in short lengths
                        for (let t = 0; t < 1; t += 0.25) {
                            const q0 = geo.lerpPt(a, b, t), q1 = geo.lerpPt(a, b, t + 0.25);
                            PG.isokit.railFence(T, [q0[0], q0[1], G.at(q0[0], q0[1])], [q1[0], q1[1], G.at(q0[0], q0[1])], 1.1);
                        }
                    }
                    for (let k = jit.int(2, 5); k > 0; k--) {
                        const q = [mx + jit.range(-0.3, 0.3) * cw, my + jit.range(-0.3, 0.3) * cd];
                        cow(T, q[0], q[1], G.at(q[0], q[1]), jit.range(0, TAU));
                    }
                } else if (kind === 'orchard') {
                    S.kind = GREEN;
                    const rows = geo.hatch([poly.map(([x, y]) => [geo.lerp(x, mx, 0.2), geo.lerp(y, my, 0.2)])], 5.5, along);
                    for (const line of rows) {
                        const len = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
                        for (let t = 0; t <= len; t += 5.5) {
                            const q = geo.lerpPt(line[0], line[1], len ? t / len : 0);
                            PG.isokit.roundTree(T, q[0], q[1], G.at(q[0], q[1]), jit);
                        }
                    }
                } else if (jit.chance(0.6)) {
                    barn(T, G, mx, my, Math.atan2(d[1], d[0]) + (jit.chance(0.5) ? 0 : Math.PI / 2), jit);
                }
                S.kind = INK;
            }
        }
    }

    // Everything on the valley: the village round its square and along its
    // lanes, a hotel, the station, farms and fields, barns up the slopes, the
    // road up to the hut, the cable car, a stream coming down, boats on the
    // lake, the forest, and paragliders and birds overhead
    function settle(T, G, P, V, E, rng) {
        const { S, p } = T;
        // solid is the buildings and the square, which the cable car and paragliders keep clear of
        const claims = new Claims(), solid = new Claims();
        const [zmin, zmax] = G.bounds();
        const AT = t => pathAt(V.axis, parAt(V.axis, t));
        const onBlock = (x, y, m) => G.inside(x, y, m) && P.seen(x, y, G.at(x, y), -m);
        const side = E.side, { x: cx, y: cy } = E.village;
        const dryRound = (x, y, r) => {
            for (let k = 0; k < 8; k++) if (G.wet(x + r * Math.cos((k * TAU) / 8), y + r * Math.sin((k * TAU) / 8))) return false;
            return !G.wet(x, y);
        };
        const flatRound = (x, y, r, sl) => onBlock(x, y, r) && dryRound(x, y, r) && G.slope(x, y) < sl && claims.free(x, y, r);
        // A footprint turned to `a` as a row of circles along its length, which
        // lets buildings sit closer to the road than one circle round the lot would
        const cover = (x, y, a, L, D) => {
            const c = Math.cos(a), sn = Math.sin(a), lo = Math.min(L, D), hi = Math.max(L, D), n = Math.max(1, Math.ceil(hi / lo)), out = [];
            for (let i = 0; i < n; i++) {
                const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (hi - lo), du = L >= D ? t : 0, dv = L >= D ? 0 : t;
                out.push([x + du * c - dv * sn, y + du * sn + dv * c, lo * 0.6 + 0.4]);
            }
            return out;
        };
        const fits = (x, y, a, L, D, sl) => cover(x, y, a, L, D).every(([u, v, r]) => flatRound(u, v, r, sl) && dryRound(u, v, r + 2));
        const hold = (x, y, a, L, D) => { for (const [u, v, r] of cover(x, y, a, L, D)) claims.take(u, v, r); };
        road(T, G, E.main, 4.5);
        claims.line(E.main, 3.5);
        if (E.rail) claims.line(E.rail.pts.filter((_, i) => E.rail.inside[i]), 4);
        if (E.hut) {
            claims.take(E.hut[0], E.hut[1], 10);
            solid.take(E.hut[0], E.hut[1], 14);
        }
        const nearRail = (x, y, r) => !!E.rail && E.rail.pts.some((q, i) => E.rail.inside[i] && Math.hypot(q[0] - x, q[1] - y) < r);
        const lanes = [E.main];
        // a lane through pts, cut back to its longest stretch on dry, gentle ground
        const addLane = (pts, min = 20) => {
            let best = [], run = [];
            for (const q of geo.resample(geo.chaikin(pts, 2), 2)) {
                if (G.inside(q[0], q[1], 3) && dryRound(q[0], q[1], 2) && G.slope(q[0], q[1]) < 0.45) run.push(q);
                else run = [];
                if (run.length > best.length) best = run;
            }
            if (best.length < 2 || geo.pathLength(best) < min) return false;
            road(T, G, best, 3);
            claims.line(best, 2.5);
            lanes.push(best);
            return true;
        };
        // where the village is on the road, and which way is away from the river there
        let iv = 0;
        E.main.forEach((q, i) => { if (Math.hypot(q[0] - cx, q[1] - cy) < Math.hypot(E.main[iv][0] - cx, E.main[iv][1] - cy)) iv = i; });
        const mt = track(E.main), mlen = mt.cum[mt.cum.length - 1], tv = mt.cum[iv] / mlen;
        const away = t => { const q = pathAt(mt, t); return { x: q.x, y: q.y, ux: q.ux, uy: q.uy, nx: -q.uy * side, ny: q.ux * side }; };
        // A lane looping round the middle, a back lane further out along the
        // valley with side streets joining it, and a quieter road along the far bank
        const lane = offs => addLane(offs.map(([dt, off]) => { const q = away(tv + (dt * 62) / mlen); return [q.x + q.nx * off, q.y + q.ny * off]; }));
        lane([[-1, 0], [-0.7, 24], [-0.25, 36], [0.25, 36], [0.7, 24], [1, 0]]);
        lane([[-1.6, 0], [-1.4, 30], [-1, 58], [-0.4, 66], [0.4, 66], [1, 58], [1.4, 30], [1.6, 0]]);
        for (const dt of [-0.45, 0.45]) lane([[dt, 36], [dt * 1.1, 64]]);
        for (const dt of [-0.1, 0.15]) lane([[dt, 36], [dt + 0.05, 58]]);
        const west = [];
        for (let i = 0; i <= 20; i++) {
            const q = AT(geo.lerp(P.t0 + 0.02, 0.45, i / 20)), off = Math.max(14, V.W0 * 0.75);
            west.push([q.x + q.uy * off * side, q.y - q.ux * off * side]);
        }
        addLane(west);
        // a lane off the road over the river on a stone bridge, into the other half of the village
        const vr = E.main[iv], rt = nearest(V.river, vr[0], vr[1]).t;
        for (const dt of [0, 0.03, -0.03, 0.06, -0.06]) {
            const r = pathAt(V.river, geo.clamp(rt + dt, 0.02, 0.98));
            if (!G.wet(r.x, r.y)) continue;
            // n points across from the road side
            let n = [-r.uy, r.ux];
            if ((vr[0] - r.x) * n[0] + (vr[1] - r.y) * n[1] > 0) n = [-n[0], -n[1]];
            let a0 = 0, a1 = 0;
            while (a0 > -20 && G.wet(r.x + n[0] * a0, r.y + n[1] * a0)) a0 -= 0.5;
            while (a1 < 20 && G.wet(r.x + n[0] * a1, r.y + n[1] * a1)) a1 += 0.5;
            // any wider and it's the lake
            if (a1 - a0 > V.wr * 2 + 4) continue;
            a0 -= 0.5;
            a1 += 0.5;
            const ramp = bridgeRamp(a1 - a0), at = a => [r.x + n[0] * a, r.y + n[1] * a];
            const far = at(a1 + ramp + 22);
            if (!onBlock(far[0], far[1], 10) || G.wet(far[0], far[1]) || G.slope(far[0], far[1]) > 0.4) continue;
            const w = 3.2, e0 = at(a0 - ramp), e1 = at(a1 + ramp);
            // b = 0 on the side we see
            let m = [-n[1], n[0]];
            if (!T.sees([-m[0], -m[1], 0])) m = [-m[0], -m[1]];
            const F = {
                P: (a, b, z) => [r.x + n[0] * a + m[0] * (b - w / 2), r.y + n[1] * a + m[1] * (b - w / 2), z],
                V: (a, b, z) => [n[0] * a + m[0] * b, n[1] * a + m[1] * b, z],
            };
            S.kind = INK;
            bridge(T, F, a0, a1, w, Math.max(G.at(...e0), G.at(...e1)) + 0.1, G.sample(G.W, r.x, r.y), true);
            road(T, G, [vr, e0], 3);
            road(T, G, [e1, far], 3);
            claims.line(geo.resample([vr, e0, e1, far], 3), 3);
            if (lanes.length > 1) {
                const bank = track(lanes[lanes.length - 1]), q = pathAt(bank, nearest(bank, ...far).t);
                addLane([far, [q.x, q.y]], 1);
            }
            break;
        }
        if (E.hutRoad) {
            road(T, G, E.hutRoad, 3);
            claims.line(E.hutRoad, 2.5);
        }
        // The square just off the main road, with a fountain in the middle and
        // the church across the far side facing it
        const sq = away(tv);
        const sqc = [sq.x + sq.nx * 15, sq.y + sq.ny * 15], sqa = Math.atan2(sq.ny, sq.nx) - Math.PI / 2;
        const SF = turned(sqc[0], sqc[1], 0, sqa);
        const sqPts = [[-14, -9], [14, -9], [14, 9], [-14, 9]].map(([a, b]) => SF.P(a, b, 0));
        if (p.houses > 0.2 && sqPts.concat([SF.P(0, 0, 0)]).every(q => onBlock(q[0], q[1], 4) && !G.wet(q[0], q[1]) && G.slope(q[0], q[1]) < 0.25)) {
            S.kind = ROAD;
            S.line(drape(G, sqPts.concat([sqPts[0]]).map(q => q.slice(0, 2)), 0.1));
            for (const q of sqPts) claims.take(q[0], q[1], 3);
            claims.take(sqc[0], sqc[1], 13);
            solid.take(sqc[0], sqc[1], 16);
            const z0 = G.at(sqc[0], sqc[1]);
            S.kind = INK;
            PG.isokit.fountain(T, sqc[0], sqc[1], z0 + 0.05, rng);
            for (const [a, b] of [[-13, -8], [13, -8], [13, 8], [-13, 8]]) {
                const q = SF.P(a, b, 0);
                PG.isokit.crookLamp(T, q[0], q[1], G.at(q[0], q[1]));
            }
            // café tables down one side, a market cart and some people about
            for (let a = -10; a <= -4; a += 3) {
                const q = SF.P(a, 5.5, 0);
                S.kind = ACCENT;
                PG.isokit.bistro(T, q[0], q[1], G.at(q[0], q[1]), rng, true);
            }
            S.kind = INK;
            const cq = SF.P(8, 5, 0);
            PG.isokit.cart(T, cq[0], cq[1], G.at(cq[0], cq[1]), rng);
            for (let k = 0; k < 7; k++) {
                const q = SF.P(rng.range(-12, 12), rng.range(-7, 7), 0);
                if (Math.hypot(q[0] - sqc[0], q[1] - sqc[1]) > 3.4) person(T, q[0], q[1], G.at(q[0], q[1]) + 0.1, rng);
            }
            if (p.church) {
                const c = SF.P(0, 9 + 9.5, 0);
                if (flatRound(c[0], c[1], 9, 0.35)) {
                    const { F, drop } = plot(T, G, c[0], c[1], sqa, 10, 17);
                    S.kind = INK;
                    S.box(F, -5, -8.4, drop, 5, 8.4, 0);
                    footing(T, G, F, -5, -8.4, 5, 8.4);
                    church(T, F, [-4.5, -8, 4.5, 8], rng);
                    groundShadow(T, G, [[-5, -8, 0], [5, -8, 0], [5, 8, 0], [-5, 8, 0], [0, -6, 22], [-4, 0, 8], [4, 0, 8]].map(q => F.P(...q)));
                    claims.take(c[0], c[1], 11);
                    solid.take(c[0], c[1], 12);
                }
            }
        }
        // a grand hotel near the middle, and another if the village is big
        for (let h = 0, tries = 0; h < (p.houses > 0.75 ? 2 : p.houses > 0.3 ? 1 : 0) && tries < 60; tries++) {
            const q = away(tv + rng.range(-1, 1) * (70 / mlen)), off = rng.range(14, 24);
            const x = q.x + q.nx * off, y = q.y + q.ny * off, L = rng.range(20, 25), D = rng.range(11, 13), a = T.square(Math.atan2(-q.nx, q.ny));
            if (!fits(x, y, a, L + 2, D + 3, 0.3)) continue;
            hold(x, y, a, L + 2, D + 3);
            for (const [u, v, r] of cover(x, y, a, L + 2, D + 3)) solid.take(u, v, r);
            hotel(T, G, x, y, a, L, D, rng);
            h++;
        }
        // Bottom station of the cable car at the edge of the village, on its side of the
        // river. Take the spot nearest the top so the cable heads up over the fields rather
        // than across the village, keep it off the big buildings and over the train, and
        // keep clear the ground it's drawn over so nothing gets built there. That's not
        // just under it: on paper a cable h meters up lines up with ground h / tan(elev)
        // further back, and anything up to a tall chalet's height in between.
        let start = null, cable = null;
        if (E.top) {
            const zb = G.at(E.top[0], E.top[1]) + 7, back = T.cam.ce / T.cam.se, [fx, fy] = [T.cam.fx, T.cam.fy];
            const span = s => {
                const d = Math.hypot(E.top[0] - s[0], E.top[1] - s[1]), za = G.at(s[0], s[1]) + 7, out = [];
                for (let i = 0; i <= 39; i++) {
                    const f = i / 39, [x, y] = geo.lerpPt(s, E.top, f), z = geo.lerp(za, zb, f) - 0.1 * d * f * (1 - f), hc = Math.max(0, z - G.at(x, y));
                    out.push({ x, y, z, i, under: true });
                    for (let o = Math.max(0, hc - 14) * back; ; o = Math.min(o + 4, hc * back)) {
                        out.push({ x: x + fx * o, y: y + fy * o, z, i });
                        if (o >= hc * back) break;
                    }
                }
                return out;
            };
            let best = Infinity;
            for (let tries = 0; tries < 500; tries++) {
                const a = rng.range(0, TAU), r = rng.range(20, 90), x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                const d = Math.hypot(E.top[0] - x, E.top[1] - y);
                if (d < 60 || d >= best || !flatRound(x, y, 6, 0.3) || nearest(V.axis, x, y).side !== side) continue;
                const band = span([x, y]);
                // under the line, the cable has to clear a train with a cabin's height to spare
                if (E.rail && band.some(q => q.under && E.rail.pts.some((c, j) => E.rail.inside[j] && Math.hypot(c[0] - q.x, c[1] - q.y) < 5 && q.z < E.rail.zs[j] + 7))) continue;
                // Crossing a building is a heavy penalty rather than ruled out, as sometimes
                // there's no way round, and leaving the cable car out leaves a flat summit
                const score = d + 500 * band.filter(q => q.i >= 4 && q.i <= 35 && !solid.free(q.x, q.y, 2)).length;
                if (score >= best) continue;
                start = [x, y];
                cable = band;
                best = score;
            }
            if (start) {
                claims.take(start[0], start[1], 8);
                claims.take(E.top[0], E.top[1], 7);
                for (const q of cable) claims.take(q.x, q.y, 4);
                cable = cable.map(q => [q.x, q.y]);
            }
        }
        const nearCable = (x, y, r) => !!cable && cable.some(q => Math.hypot(q[0] - x, q[1] - y) < r);
        // the station where the line runs on a shelf, as near the village as it can be
        if (E.rail) {
            const R = E.rail;
            let best = null;
            for (let i = 3; i + 9 < R.pts.length; i++) {
                if (![...Array(10).keys()].every(k => R.kind[i + k] === 'shelf' && R.inside[i + k])) continue;
                const q = R.pts[i + 5];
                if (!P.seen(q[0], q[1], R.zs[i + 5], 12) || nearCable(q[0], q[1], 24)) continue;
                const d = Math.hypot(q[0] - cx, q[1] - cy);
                if (!best || d < best[1]) best = [i, d];
            }
            if (best) station(T, G, R, best[0], best[0] + 9, claims, rng);
        }
        // Chalets line the lanes facing them, with a footpath to the front door,
        // closer together near the middle where more of them turn their gables
        // to the street. The lanes nearest the middle get first pick.
        const streets = lanes.map(path => track(path));
        const mid = st => { const q = pathAt(st, 0.5); return Math.hypot(q.x - cx, q.y - cy); };
        let built = 0;
        for (const st of streets.slice().sort((a, b) => mid(a) - mid(b))) {
            const len = st.cum[st.cum.length - 1];
            for (const sign of [-1, 1]) {
                for (let s = rng.range(2, 9); s < len - 3 && built < 80;) {
                    const q0 = pathAt(st, s / len), dc = Math.hypot(q0.x - cx, q0.y - cy);
                    if (!rng.chance(p.houses * (0.45 + 0.55 * Math.exp(-dc / 80)))) {
                        s += rng.range(4, 9);
                        continue;
                    }
                    // a smaller house if a big one won't fit
                    let gable, L, D, q, x, y, a, ok = false;
                    for (let k = 0; k < 3 && !ok; k++) {
                        gable = rng.chance(dc < 50 ? 0.5 : 0.25);
                        L = (gable ? rng.range(8, 11) : rng.range(9, 14)) * (1 - 0.15 * k);
                        D = (gable ? rng.range(9, 12) : rng.range(7, 10)) * (1 - 0.15 * k);
                        q = pathAt(st, Math.min(len, s + L / 2) / len);
                        const off = sign * (D / 2 + rng.range(4.5, 7));
                        x = q.x - q.uy * off;
                        y = q.y + q.ux * off;
                        a = T.square(Math.atan2(q.uy, q.ux) + (sign < 0 ? Math.PI : 0));
                        ok = fits(x, y, a, L, D, 0.45);
                    }
                    if (!ok) {
                        s += rng.range(4, 9);
                        continue;
                    }
                    s += L + rng.range(3, 8);
                    built++;
                    hold(x, y, a, L, D);
                    for (const [u, v, r] of cover(x, y, a, L, D)) solid.take(u, v, r);
                    const floors = dc < 45 ? rng.pick([2, 3, 3]) : rng.chance(0.85) ? 2 : 1;
                    const F = chalet(T, G, x, y, a, L, D, floors, rng, gable), entry = F.P(0, -D / 2 - 0.5, 0);
                    const walk = [entry.slice(0, 2), [q.x, q.y]];
                    road(T, G, geo.resample(walk, 1.5), 1.3);
                    claims.line(geo.resample(walk, 2), 1);
                    const terrace = F.P(L / 2 + 2.3, -D / 2 + 0.5, 0);
                    if (built % 4 === 0 && flatRound(terrace[0], terrace[1], 2, 0.45)) {
                        claims.take(terrace[0], terrace[1], 2);
                        S.kind = ACCENT;
                        patioSet(T, turned(terrace[0], terrace[1], G.at(terrace[0], terrace[1]) + 0.15, a), 0, 0, rng);
                        S.kind = INK;
                    } else if (rng.chance(0.4)) {
                        // a garden tree beside the house
                        const g = F.P(rng.sign() * (L / 2 + 3), rng.range(-D / 3, D / 3), 0);
                        if (flatRound(g[0], g[1], 2, 0.45)) {
                            claims.take(g[0], g[1], 2.5);
                            S.kind = GREEN;
                            PG.isokit.roundTree(T, g[0], g[1], G.at(g[0], g[1]), rng);
                            S.kind = INK;
                        }
                    }
                }
            }
        }
        // the hut at the top of its road, with a flag
        if (E.hut) {
            const [hx, hy] = E.hut;
            claims.take(hx, hy, 9);
            chalet(T, G, hx, hy, rng.range(0, TAU), 12, 9, 2, rng);
            const z = G.at(hx, hy);
            S.kind = INK;
            S.line([[hx + 6, hy + 6, z], [hx + 6, hy + 6, z + 11]]);
            const fl = [[hx + 6, hy + 6, z + 11], [hx + 6 + T.cam.rx * 3, hy + 6 + T.cam.ry * 3, z + 10.3], [hx + 6, hy + 6, z + 9.6]];
            S.face(fl);
            S.kind = RED;
            S.loop(fl);
            S.hatch(fl, [0, 0, 1], 0.35);
            S.kind = INK;
        }
        if (start) cableCar(T, G, start, [E.top[0], E.top[1]], nearRail, rng);
        // a cross on the highest summit the cable car doesn't go to
        if (p.rock > 0) {
            let top = null;
            for (const q of V.peaks.slice(0, 3)) {
                // the actual summit is near the peak's center, wherever erosion left it
                let best = null;
                G.near(q.x, q.y, q.r * 0.25, v => { const c = G.pt(v); if (!best || c[2] > best[2]) best = c; });
                if (!best || !P.seen(best[0], best[1], best[2], 6) || (E.top && Math.hypot(E.top[0] - best[0], E.top[1] - best[1]) < 15)) continue;
                if (!top || best[2] > top[2]) top = best;
            }
            if (top) summitCross(T, top[0], top[1], top[2]);
        }
        // a stream down the far side, from a gully high up
        if (p.falls) {
            let best = null;
            for (let tries = 0; tries < 300; tries++) {
                const [x, y] = P.w(P.U * rng.range(0.05, 0.95), P.V * rng.range(0.1, 0.9));
                if (!G.inside(x, y, 10)) continue;
                const z = G.at(x, y), n = nearest(V.axis, x, y);
                if (n.side === side || z < geo.lerp(zmin, zmax, 0.35) || z > geo.lerp(zmin, zmax, 0.65) || n.par < 0.2 || !P.seen(x, y, z, 10)) continue;
                // a gully: lower than the ground either side across the slope
                const e = 6, around = (G.at(x + e, y) + G.at(x - e, y) + G.at(x, y + e) + G.at(x, y - e)) / 4;
                const score = around - z;
                if (!best || score > best[3]) best = [x, y, z, score];
            }
            if (best) {
                const pts = stream(T, G, best);
                if (pts) claims.line(pts, 2.5);
            }
        }
        if (E.rail) drawRail(T, G, E.rail, claims, nearCable, rng);
        // boats out on the lake
        if (V.lake) {
            const c = AT(V.lake.t);
            for (let k = 0, tries = 0; k < 4 && tries < 40; tries++) {
                const x = c.x + rng.range(-1, 1) * V.W0, y = c.y + rng.range(-1, 1) * V.W0;
                if (!onBlock(x, y, 4) || !G.wet(x, y) || !G.wet(x + 6, y) || !G.wet(x - 6, y) || !G.wet(x, y + 6) || !G.wet(x, y - 6) || !claims.free(x, y, 5)) continue;
                claims.take(x, y, 5);
                S.kind = INK;
                PG.isokit.boat(T, turned(x, y, V.lakeLevel, rng.range(0, TAU)), rng.chance(0.5) ? 'sail' : 'row', rng);
                k++;
            }
        }
        fields(T, G, P, V, E, claims, rng);
        // trees along the river banks
        S.kind = GREEN;
        for (let t = 0.01; t < 0.99; t += 0.012) {
            const r = pathAt(V.river, t);
            for (const s of [-1, 1]) {
                if (!rng.chance(0.45)) continue;
                const o = V.wr + rng.range(3, 6), x = r.x - r.uy * o * s, y = r.y + r.ux * o * s;
                if (!flatRound(x, y, 2.4, 0.4) || G.at(x, y) - V.base(x, y) > 6) continue;
                claims.take(x, y, 2.6);
                PG.isokit.roundTree(T, x, y, G.at(x, y), rng);
            }
        }
        S.kind = INK;
        // barns dotted about the alps up the slopes, each in its own clearing
        for (let k = 0, tries = 0; k < Math.round(10 * p.houses) && tries < 500; tries++) {
            const [x, y] = P.w(P.U * rng.range(0, 1), P.V * rng.range(0.05, 0.85));
            if (!flatRound(x, y, 7, 0.45)) continue;
            const up = (G.at(x, y) - V.base(x, y)) / (V.treeline - V.base(x, y));
            if (up < 0.08 || up > 0.95) continue;
            claims.take(x, y, 9);
            barn(T, G, x, y, T.square(Math.atan2(...G.fall(x, y).slice(0, 2).reverse())), rng);
            k++;
        }
        forest(T, G, P, V, claims, rng);
        // traffic on the main road: cars, and the post bus
        let bus = p.houses > 0.3;
        for (let t = rng.range(0.05, 0.15); t < 0.95; t += rng.range(0.08, 0.2)) {
            const q = pathAt(mt, t), lane = rng.sign(), x = q.x - q.uy * lane * 1.1, y = q.y + q.ux * lane * 1.1;
            if (!onBlock(x, y, 4) || G.wet(x, y)) continue;
            vehicle(T, x, y, G.at(x, y) + 0.1, Math.atan2(q.uy, q.ux) + (lane > 0 ? 0 : Math.PI), bus);
            bus = false;
        }
        // walkers and benches give the streets a human scale
        for (const st of streets) {
            const len = st.cum[st.cum.length - 1], count = Math.round(len * p.houses / 12);
            for (let i = 0; i < count; i++) {
                const q = pathAt(st, rng.range(0.08, 0.9));
                const x = q.x - q.uy * 0.7, y = q.y + q.ux * 0.7;
                if (!onBlock(x, y, 3) || G.wet(x, y)) continue;
                person(T, x, y, G.at(x, y) + 0.12, rng);
                if (i % 3 === 0) {
                    const bx = q.x + q.uy * 3.6, by = q.y - q.ux * 3.6;
                    if (flatRound(bx, by, 1.2, 0.45)) {
                        claims.take(bx, by, 1.2);
                        S.kind = ROAD;
                        bench(T, bx, by, G.at(bx, by) + 0.1, PG.isokit.nearestDir(-q.uy, q.ux));
                    }
                }
            }
        }
        S.kind = INK;
        // overhead
        if (p.fliers) {
            // somewhere a paraglider won't be drawn over the viaduct, the cable car or a building
            const back = T.cam.ce / T.cam.se;
            const clearSky = (x, y, z) => {
                const h = z - G.at(x, y);
                for (let o = h - 24; o <= h + 2; o += 3) {
                    const u = x + T.cam.fx * o * back, v = y + T.cam.fy * o * back;
                    if (nearRail(u, v, 10) || nearCable(u, v, 8) || !solid.free(u, v, 6)) return false;
                }
                return true;
            };
            for (let i = rng.int(1, 2); i > 0; i--) {
                for (let tries = 0; tries < 12; tries++) {
                    const q = AT(rng.range(0.3, 0.8)), z = G.at(q.x, q.y) + (zmax - zmin) * rng.range(0.45, 0.75);
                    const x = q.x + rng.range(-20, 20), y = q.y + rng.range(-20, 20);
                    if (!clearSky(x, y, z)) continue;
                    paraglider(T, x, y, z, rng.range(0, TAU), rng);
                    break;
                }
            }
            const q = AT(rng.range(0.4, 0.9));
            birds(T, q.x, q.y, zmax + rng.range(5, 20), rng);
        }
        S.kind = INK;
    }

    // ------------------------------------------------------------------
    // Scene
    // ------------------------------------------------------------------

    function buildValley(T, G, P, V, E, rng) {
        const { p } = T;
        const [zmin, zmax] = G.bounds();
        V.snow = geo.lerp(zmin, zmax, p.snow);
        V.treeline = geo.lerp(zmin, V.snow, 0.8);
        const snowNoise = PG.makeNoise(new PG.RNG(hash(p.seed, 908)));
        V.snowAt = (x, y) => V.snow + p.relief * 0.055 * snowNoise.noise2(x / 18, y / 18);
        drawGround(T, G, V);
        waterMarks(T, G, new PG.RNG(hash(p.seed, 907)));
        if (p.cutaway) drawSides(T, G, zmin - p.base, rng);
        settle(T, G, P, V, E, rng);
    }

    // Grid spacing: fine enough for the scale, but not so fine a big valley takes forever
    const gridStep = (k, area) => Math.max(geo.clamp(1.3 / k, 1.2, 3), Math.sqrt(area / 60000));

    PG.register({
        id: 'alpine',
        name: 'Alpine Valley',
        category: 'Scenes',
        description: 'A storybook mountain village with chalets, a grand hotel and a square, farms and fir woods, a railway on a stone viaduct and a cable car up jagged snowy peaks.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'size', label: 'Valley size (m)', type: 'range', min: 120, max: 400, step: 5, value: 160, random: [140, 190],
                hint: 'Smaller valleys bring the buildings closer' },
            { id: 'aspect', label: 'Valley depth', type: 'range', min: 0.6, max: 2, step: 0.05, value: 1.35, random: [1.1, 1.5],
                show: p => p.framing === 'whole' || p.cutaway },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 25, max: 65, step: 0.5, value: 30, random: [27, 39] },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 37, random: [33, 41] },
            { id: 'framing', label: 'Framing', type: 'select', value: 'close', random: false,
                options: [['close', 'Fill the page'], ['whole', 'Whole valley']] },
            { id: 'cutaway', label: 'Cutaway base', type: 'checkbox', value: false },
            { id: 'base', label: 'Base depth (m)', type: 'range', min: 5, max: 60, step: 1, value: 8, random: false, show: p => p.cutaway },
            { type: 'section', label: 'Landscape' },
            { id: 'relief', label: 'Mountain height (m)', type: 'range', min: 30, max: 240, step: 5, value: 95, random: [80, 120] },
            { id: 'valley', label: 'Valley width', type: 'range', min: 0.1, max: 0.5, step: 0.01, value: 0.36, random: [0.3, 0.44] },
            { id: 'lake', label: 'Lake', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, random: [0.4, 1], hint: 'Chance of a lake above the village' },
            { id: 'snow', label: 'Snow line', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.66, random: [0.55, 0.8],
                hint: 'Share of the way up above which the ground is left white' },
            { id: 'contours', label: 'Topographic contours', type: 'checkbox', value: false },
            { id: 'contour', label: 'Contour interval (m)', type: 'range', min: 1, max: 20, step: 0.5, value: 8, random: false, show: p => p.contours },
            { id: 'rock', label: 'Mountain shading', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.4, 1] },
            { type: 'section', label: 'Life' },
            { id: 'forest', label: 'Forest', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.35, 0.85] },
            { id: 'houses', label: 'Village', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, random: [0.55, 0.95],
                hint: 'How many chalets there are' },
            { id: 'church', label: 'Church', type: 'checkbox', value: true, random: 0.8 },
            { id: 'hut', label: 'Road up to a hut', type: 'checkbox', value: true, random: 0.8,
                hint: 'Hairpins up the mountainside to a hut on a shoulder' },
            { id: 'cable', label: 'Cable car', type: 'checkbox', value: true, random: 0.7 },
            { id: 'railway', label: 'Railway', type: 'checkbox', value: true, random: 0.8,
                hint: 'A mountain train on a curved stone viaduct above the village' },
            { id: 'falls', label: 'Waterfall', type: 'checkbox', value: true, random: 0.8 },
            { id: 'fliers', label: 'Paragliders & birds', type: 'checkbox', value: true, random: 0.6 },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const rng = new PG.RNG(hash(ctx.seed | 0, 1));
            const page = p.framing !== 'whole' && !p.cutaway;
            const se = Math.sin(geo.rad(p.elev)), ce = Math.cos(geo.rad(p.elev));
            let k, cam, G, P, V, E;
            if (page) {
                // Scale so the far peaks top out a little under the top of the page,
                // with the floor somewhere between 0.8 and 1.5 valleys deep
                const reach = d => (0.86 * H) / (d * se + p.relief * ce);
                k = geo.clamp(W / p.size, reach(1.5 * p.size), reach(0.8 * p.size));
                const c0 = makeCamera(p.yaw, p.elev, k, W, H, 0, 0), r = [c0.rx, c0.ry], f = [c0.fx, c0.fy];
                const U = W / k, Vd = ((0.86 * H) / k - p.relief * ce) / se / 0.97;
                // plan u runs across the page and v away from us, from the bottom edge
                const w = (u, v) => [u * r[0] + v * f[0], u * r[1] + v * f[1]];
                const uv = (x, y) => [x * r[0] + y * r[1], x * f[0] + y * f[1]];
                const C = w(U / 2, H / (2 * k * se));
                cam = makeCamera(p.yaw, p.elev, k, W, H, C[0], C[1]);
                // the ground runs off the bottom and sides of the page and stops a little way behind the far peaks
                const u0 = -12, u1 = U + 12, v0 = -(0.3 * p.relief * ce) / se - 12, v1 = Vd * 1.08;
                G = new Ground(u1 - u0, v1 - v0, gridStep(k, (u1 - u0) * (v1 - v0)), w(u0, v0), r);
                const seen = (x, y, z, m) => {
                    const q = cam.project(x, y, z), e = m * k;
                    return q[0] >= e && q[1] >= e && q[0] <= W - e && q[1] <= H - e;
                };
                P = { U, V: Vd, M: Math.min(U, Vd), w, uv, seen, t0: v0 / Vd };
                V = landscape(G, P, p, rng);
                E = earthworks(G, P, V, rng, p);
            } else {
                const Lx = p.size, Ly = p.size * p.aspect;
                const c0 = makeCamera(p.yaw, p.elev, 1, W, H, 0, 0);
                // scale to fit the block and everything on it on the page
                const fit = (zLo, zHi, grid) => {
                    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                    const put = (x, y, z) => {
                        const q = c0.project(x, y, z);
                        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
                    };
                    for (const [x, y] of [[0, 0], [Lx, 0], [Lx, Ly], [0, Ly]]) put(x, y, zLo);
                    if (grid) {
                        for (let v = 0; v < grid.h.length; v += 3) { const q = grid.pt(v); put(q[0], q[1], q[2] + 16); }
                    } else for (const [x, y] of [[0, 0], [Lx, 0], [Lx, Ly], [0, Ly]]) put(x, y, zHi);
                    return { k: Math.min((W * 0.94) / (x1 - x0), (H * 0.94) / (y1 - y0)), mid: c0.ground((x0 + x1) / 2, (y0 + y1) / 2, 0) };
                };
                const base = p.cutaway ? p.base : 0;
                const guess = fit(-base, p.relief * 1.15);
                G = new Ground(Lx, Ly, gridStep(guess.k, Lx * Ly));
                // the plan is mirrored on the block, so the river runs across the view rather than along it
                P = { U: Lx, V: Ly, M: Math.min(Lx, Ly), w: (u, v) => [Lx - u, v], uv: (x, y) => [Lx - x, y], seen: (x, y, z, m) => G.inside(x, y, m), t0: 0 };
                V = landscape(G, P, p, rng);
                E = earthworks(G, P, V, rng, p);
                const [zmin] = G.bounds(), fitted = fit(zmin - base, 0, G);
                k = fitted.k;
                cam = makeCamera(p.yaw, p.elev, k, W, H, fitted.mid[0], fitted.mid[1]);
            }
            // the sun is low on the left and a little in front, so the faces turned
            // to the right are the ones in shade
            const sun = unit([-0.9 * cam.rx - 0.25 * cam.fx, -0.9 * cam.ry - 0.25 * cam.fy, 1.25]);
            const S = new Scene(cam, W, H);
            const T = {
                S, cam, W, H, p: Object.assign({ seed: ctx.seed | 0 }, p), k,
                detail: true,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                tones: { lit: RED, dark: INK, canopy: ACCENT },
                waterKind: BLUE,
                hLit: 0.65,
                hDark: 0.4,
                shadeGap: 0.55,
                shadowDir: [-sun[0] / sun[2], -sun[1] / sun[2]],
                lit: n => (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * sun[2],
                // Turn a building (angle of its front) at least 20° off square to the view,
                // or the walls along the view show edge on and it looks like a cut-out
                square: a => {
                    const d = geo.deg(a - Math.atan2(cam.ry, cam.rx)), m = ((d % 90) + 90) % 90;
                    return a + geo.rad(m < 20 ? 20 - m : m > 70 ? 70 - m : 0);
                },
                // how dark a slope with this normal is, 0 where it gets at least as much sun as level ground
                tone: n => {
                    const light = (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / Math.hypot(n[0], n[1], n[2]);
                    return geo.clamp((0.9 * sun[2] - light) / (0.9 * sun[2] + 0.1), 0, 1);
                },
            };
            buildValley(T, G, P, V, E, rng);
            return PG.pens.renderScene('alpine', S, p);
        },
    });
})();
