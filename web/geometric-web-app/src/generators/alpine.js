/*
 * Alpine Valley: a village beneath a horseshoe of peaks, with a mountain
 * railway, timber chalets and a river. Terrain handles occlusion while the
 * architecture shares its roof hatching and details with the other scenes.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, Scene, segments } = PG.iso;
    const { wall, door, pane, windows, gableRoof, chimney, unit, shadeGable, church, conifer, turned, bridge, bridgeRamp, withKind, patioSet, bench } = PG.isokit;

    const INK = 0, RED = 1, SHADOW = 2, ACCENT = 3, GREEN = 4, FIGURE = 5, BLUE = 6, ROAD = 7;
    const SNOW = SHADOW, EARTH = ROAD;
    const person = withKind(FIGURE, PG.isokit.person);

    const smooth = (a, b, x) => geo.smoothstep(a, b, x);
    // towards the sun, low in the west as on a map lit from the top left
    const SUN = unit([-0.55, 0.3, 0.78]);

    // ------------------------------------------------------------------
    // The ground
    // ------------------------------------------------------------------

    // Heights on a grid over the block, split into triangles along whichever
    // diagonal of each cell is closer to level. W is the water level at each
    // point, a good way under the ground where it's dry, so land and water
    // can be told apart with a straight interpolation.
    class Ground {
        constructor(Lx, Ly, step) {
            this.Lx = Lx;
            this.Ly = Ly;
            this.nx = Math.max(8, Math.round(Lx / step));
            this.ny = Math.max(8, Math.round(Ly / step));
            this.dx = Lx / this.nx;
            this.dy = Ly / this.ny;
            this.h = new Float64Array((this.nx + 1) * (this.ny + 1));
            this.W = new Float64Array(this.h.length);
            this.diag = null;
        }

        id(i, j) { return j * (this.nx + 1) + i; }
        px(i) { return i * this.dx; }
        py(j) { return j * this.dy; }

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

        pt(v) {
            const i = v % (this.nx + 1), j = Math.floor(v / (this.nx + 1));
            return [i * this.dx, j * this.dy, this.h[v]];
        }

        // value of a per-point array at (x, y), interpolated on its triangle
        sample(arr, x, y) {
            const fx = geo.clamp(x / this.dx, 0, this.nx - 1e-9), fy = geo.clamp(y / this.dy, 0, this.ny - 1e-9);
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
    }

    // Nearest point on a polyline: arc position (0..1 along it), distance and
    // which side of it (+1 left, -1 right, looking along it)
    function nearest(path, cum, x, y) {
        let best = Infinity, bt = 0, side = 1;
        for (let i = 0; i + 1 < path.length; i++) {
            const a = path[i], b = path[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1;
            const t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / L2, 0, 1);
            const qx = a[0] + ex * t, qy = a[1] + ey * t, d = Math.hypot(x - qx, y - qy);
            if (d < best) {
                best = d;
                bt = (cum[i] + (cum[i + 1] - cum[i]) * t) / cum[cum.length - 1];
                side = ex * (y - a[1]) - ey * (x - a[0]) >= 0 ? 1 : -1;
            }
        }
        return { t: bt, d: best, side };
    }

    const lengths = path => {
        const cum = [0];
        for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        return cum;
    };

    // Keep the foreground broad enough for streets and buildings. Three offset
    // summits close the valley behind the railway instead of enclosing the viewer.
    function landscape(G, p, rng) {
        const { Lx, Ly } = G, M = Math.min(Lx, Ly), N = PG.makeNoise(rng);
        const phase = rng.range(0, TAU), bend = rng.range(0.035, 0.065) * Lx;
        const axis = Array.from({ length: 49 }, (_, i) => {
            const t = i / 48;
            return [Lx * (0.46 - 0.12 * t) + bend * Math.sin(t * TAU + phase), -8 + (Ly + 16) * t];
        });
        const cum = lengths(axis), river = geo.chaikin(axis, 2), rcum = lengths(river);
        const W0 = M * p.valley * 0.5, wr = geo.clamp(M * 0.018, 2.1, 4.5);
        const lake = rng.chance(p.lake) ? { t: rng.range(0.57, 0.65), len: 0.18 } : null;
        const floorAt = t => 1.4 + t * Math.min(4, Ly * 0.017);
        const lakeLevel = lake ? floorAt(lake.t - lake.len / 2) - 0.55 : 0;
        const peaks = [
            { x: Lx * rng.range(0.04, 0.14), y: Ly * rng.range(0.76, 0.87), h: p.relief * 0.76, r: M * 0.68 },
            { x: Lx * rng.range(0.38, 0.5), y: Ly * rng.range(0.87, 0.96), h: p.relief, r: M * 0.66 },
            { x: Lx * rng.range(0.81, 0.92), y: Ly * rng.range(0.77, 0.9), h: p.relief * 0.83, r: M * 0.7 },
        ];
        peaks.forEach(q => { q.phase = rng.range(0, TAU); });
        for (let j = 0; j <= G.ny; j++) for (let i = 0; i <= G.nx; i++) {
            const x = G.px(i), y = G.py(j), v = G.id(i, j);
            const { t, d } = nearest(axis, cum, x, y);
            let mountain = 0;
            for (const q of peaks) {
                const dx = x - q.x, dy = (y - q.y) * 1.12, a = Math.atan2(dy, dx);
                const r = Math.hypot(dx, dy) / (q.r * (1 + 0.1 * Math.cos(3 * a + q.phase)));
                const height = q.h * Math.pow(Math.max(0, 1 - r), 1.22);
                mountain = Math.max(mountain, height);
            }
            mountain *= smooth(0.38, 0.74, y / Ly);
            mountain *= 1 - 0.72 * Math.exp(-((d / Math.max(10, W0)) ** 2)) * (1 - smooth(0.64, 0.91, t));
            const foothill = M * 0.065 * Math.exp(-(((x / Lx - 0.08) / 0.2) ** 2 + ((y / Ly - 0.34) / 0.24) ** 2));
            let z = floorAt(t) + mountain + foothill + 0.35 * N.noise2(x / 24, y / 24);
            z += mountain * 0.012 * N.fbm2(x / 18, y / 18, 2);
            let W = z - 30;
            const rv = nearest(river, rcum, x, y);
            const channel = wr * (1 + 0.12 * Math.sin(t * 19 + phase));
            if (rv.d < channel + G.dx * 1.5 && t < 0.79) {
                const level = lake && t < lake.t ? Math.min(floorAt(rv.t) - 0.55, lakeLevel) : floorAt(rv.t) - 0.55;
                if (rv.d < channel) z = Math.min(z, level - 1.2 * (1 - (rv.d / channel) ** 2));
                else z = Math.max(z, level + 0.15);
                W = level;
            }
            if (lake) {
                const u = (t - lake.t) / (lake.len / 2), cross = d / (W0 * 0.9);
                const bowl = Math.max(0, 1 - u * u - cross * cross);
                if (bowl > 0) {
                    z = geo.lerp(z, lakeLevel - 3, Math.min(1, bowl * 2.6));
                    W = lakeLevel;
                }
            }
            G.h[v] = z;
            G.W[v] = W;
        }
        G.split();
        return { axis, cum, river, rcum, wr, lake, lakeLevel, W0, floorAt, vside: -1, tv: 0.27, peaks };
    }

    // ------------------------------------------------------------------
    // Drawing the ground
    // ------------------------------------------------------------------

    // Fill in the ground: faces for the triangles we can see, contours traced
    // across them, water surfaces with their shorelines, the edges where the
    // ground turns away from us, and cliff marks on the steep bits
    function drawGround(T, G, V) {
        const { S, p, cam } = T;
        const { nx, ny, h, W } = G;
        const facing = new Uint8Array(nx * ny * 2);
        const normal = (A, B, C) => {
            const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
            return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        };
        const iv = p.contour, snow = V.snow;
        const segsByLevel = new Map(), shore = [];
        const hach = new PG.RNG(p.seed | 0);
        const cut = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                G.tris(i, j).forEach((tri, k) => {
                    const P = tri.map(v => G.pt(v)), n = normal(P[0], P[1], P[2]);
                    if (n[2] < 0) n.forEach((_, q) => (n[q] = -n[q]));
                    const front = cam.facing(n[0], n[1], n[2]);
                    facing[(j * nx + i) * 2 + k] = front ? 1 : 0;
                    if (!front) return;
                    const f = tri.map(v => h[v] - W[v]);
                    // dry part of the triangle as ground, wet part as water at its level
                    const dry = [], wet = [];
                    for (let q = 0; q < 3; q++) {
                        const a = q, b = (q + 1) % 3, pa = P[a], pb = P[b];
                        if (f[a] >= 0) dry.push(pa); else wet.push([pa[0], pa[1], W[tri[a]]]);
                        if ((f[a] >= 0) !== (f[b] >= 0)) {
                            const c = cut(pa, pb, f[a], f[b]), wl = W[tri[a]] + (W[tri[b]] - W[tri[a]]) * (f[a] / (f[a] - f[b]));
                            dry.push(c);
                            wet.push([c[0], c[1], wl]);
                        }
                    }
                    if (dry.length >= 3) S.face(dry);
                    if (wet.length >= 3) S.face(wet);
                    if (dry.length && wet.length) {
                        // shoreline across this triangle
                        const e = [];
                        for (let q = 0; q < 3; q++) {
                            const a = q, b = (q + 1) % 3;
                            if ((f[a] >= 0) !== (f[b] >= 0)) e.push(cut(P[a], P[b], f[a], f[b]));
                        }
                        if (e.length === 2) shore.push(e);
                    }
                    // contours: one segment per level that crosses the triangle
                    const zs = tri.map((v, q) => p.contours ? h[v] : h[v] - V.snowAt(P[q][0], P[q][1]));
                    const lo = Math.min(...zs), hi = Math.max(...zs);
                    const levels = [];
                    if (p.contours) for (let L = Math.ceil(lo / iv) * iv; L < hi; L += iv) levels.push(L);
                    else if (lo < 0 && hi > 0) levels.push(0);
                    for (const L of levels) {
                        if (p.contours && L > snow && Math.round(L / iv) % 4) continue;
                        const e = [];
                        for (let q = 0; q < 3; q++) {
                            const a = q, b = (q + 1) % 3, za = zs[a] - L, zb = zs[b] - L;
                            if ((za >= 0) !== (zb >= 0)) {
                                const c = cut(P[a], P[b], za, zb);
                                if (G.sample(W, c[0], c[1]) <= c[2]) e.push({ c, key: Math.min(tri[a], tri[b]) * 1e6 + Math.max(tri[a], tri[b]) });
                            }
                        }
                        if (e.length === 2) {
                            if (!segsByLevel.has(L)) segsByLevel.set(L, []);
                            segsByLevel.get(L).push(e);
                        }
                    }
                    // cliff marks down the fall line on the steep faces
                    const sl = Math.hypot(n[0], n[1]) / n[2];
                    S.kind = INK;
                    if (p.rock && sl > 1.2 && hach.chance(Math.min(0.22, (sl - 1.2) * 0.18) * p.rock)) {
                        const c = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3];
                        const g = [n[0] / n[2], n[1] / n[2]], gl = Math.hypot(g[0], g[1]), len = Math.min(G.dx * 1.2, 2.2);
                        const e = [c[0] + (g[0] / gl) * len, c[1] + (g[1] / gl) * len];
                        if (!G.wet(c[0], c[1])) S.line([[c[0], c[1], G.at(c[0], c[1]) + 0.05], [e[0], e[1], G.at(e[0], e[1]) + 0.05]]);
                    }
                });
            }
        }
        // stitch each level's segments into polylines
        for (const [L, segs] of segsByLevel) {
            S.kind = !p.contours || L >= snow ? SNOW : EARTH;
            for (const line of stitch(segs)) S.line(line.map(q => [q[0], q[1], q[2] + 0.03]));
        }
        S.kind = BLUE;
        for (const line of stitch(shore.map(([a, b]) => [{ c: a, key: keyOf(a) }, { c: b, key: keyOf(b) }]))) {
            // take the corners off where the shore zigzags across the grid
            let q = line;
            for (let pass = 0; pass < 2; pass++) q = q.map((c, i) => (i && i < q.length - 1 ? c.map((v, k) => (q[i - 1][k] + 2 * v + q[i + 1][k]) / 4) : c));
            // which pulls it off the edge a little, so keep it up on the bank
            S.line(q.map(c => [c[0], c[1], Math.max(c[2], G.at(c[0], c[1])) + 0.05]));
        }
        // outline where the ground turns away from us
        S.kind = INK;
        // In a cell split along a-c, triangle 0 has the bottom and right edges and 1
        // the top and left. Split along b-d, 0 has the bottom and left, 1 the top and right.
        const fc = (i, j, k) => facing[(j * nx + i) * 2 + k];
        const d0 = (i, j) => G.diag[j * nx + i] === 0;
        const edge = (a, b) => S.line([G.pt(a), G.pt(b)].map(q => [q[0], q[1], q[2] + 0.03]));
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const t0 = G.tris(i, j)[0];
                if (fc(i, j, 0) !== fc(i, j, 1)) edge(...(d0(i, j) ? [t0[0], t0[2]] : [t0[1], t0[2]]));
                const bottom = fc(i, j, 0), left = fc(i, j, d0(i, j) ? 1 : 0);
                if (j > 0 && bottom !== fc(i, j - 1, 1)) edge(G.id(i, j), G.id(i + 1, j));
                if (i > 0 && left !== fc(i - 1, j, d0(i - 1, j) ? 0 : 1)) edge(G.id(i, j), G.id(i, j + 1));
                // the back edges of the block, against the sky
                if (j === ny - 1 && fc(i, j, 1)) edge(G.id(i, ny), G.id(i + 1, ny));
                if (i === nx - 1 && fc(i, j, d0(i, j) ? 0 : 1)) edge(G.id(nx, j), G.id(nx, j + 1));
            }
        }
    }

    function terrainMarks(T, G, V) {
        const { S, p, k } = T, e = Math.max(0.8, G.dx * 0.6);
        const gap = Math.max(2.1, 0.9 / k);
        S.kind = SHADOW;
        for (let y = gap; y < G.Ly; y += gap) {
            let run = [];
            const flush = () => { if (run.length > 2) S.line(run); run = []; };
            for (let x = 1; x < G.Lx; x += 1.2) {
                const yy = y + x * 0.16;
                if (yy >= G.Ly) { flush(); break; }
                const z = G.at(x, yy), gx = (G.at(x + e, yy) - G.at(x - e, yy)) / (2 * e);
                const gy = (G.at(x, yy + e) - G.at(x, yy - e)) / (2 * e);
                const light = (-gx * SUN[0] - gy * SUN[1] + SUN[2]) / Math.hypot(gx, gy, 1);
                if (p.rock > 0 && z > 10 && z < V.snowAt(x, yy) && light < 0.4 * p.rock + 0.04 && !G.wet(x, yy)) run.push([x, yy, z + 0.07]);
                else flush();
            }
            flush();
        }
        S.kind = INK;
        for (const peak of V.peaks) {
            for (const angle of [-2.65, -1.65, -0.75]) {
                const line = [];
                for (let i = 0; i < 40; i++) {
                    const t = i / 39, r = peak.r * t * 0.78;
                    const x = peak.x + Math.cos(angle + 0.1 * Math.sin(t * 5 + peak.phase)) * r;
                    const y = peak.y + Math.sin(angle) * r;
                    if (x < 0 || y < 0 || x > G.Lx || y > G.Ly) break;
                    const z = G.at(x, y);
                    if (z < 12) break;
                    line.push([x, y, z + 0.08]);
                }
                if (p.rock && line.length > 2) S.line(line);
            }
        }
        const rng = new PG.RNG(hash(p.seed, 907));
        S.kind = BLUE;
        for (let y = 2; y < G.Ly; y += Math.max(2.1, 0.9 / k)) for (let x = 2; x < G.Lx; x += 5) {
            const xx = x + rng.range(-1.5, 1.5), yy = y + rng.range(-0.5, 0.5), len = rng.range(1.2, 3.5);
            const a = [xx - T.cam.rx * len / 2, yy - T.cam.ry * len / 2];
            const b = [xx + T.cam.rx * len / 2, yy + T.cam.ry * len / 2];
            if (G.wet(...a) && G.wet(...b) && rng.chance(0.68)) S.line([[...a, G.sample(G.W, ...a) + 0.08], [...b, G.sample(G.W, ...b) + 0.08]]);
        }
        S.kind = INK;
    }

    function groundShadow(T, G, vertices) {
        const shadow = PG.iso.hull(vertices.map(([x, y, z]) => {
            let qx = x, qy = y;
            for (let i = 0; i < 4; i++) {
                const h = Math.max(0, z - G.at(qx, qy));
                qx = x + 0.65 * h; qy = y - 0.4 * h;
            }
            return [qx, qy];
        }));
        T.S.kind = SHADOW;
        for (const line of geo.hatch([shadow], 0.65 / T.k, Math.atan2(T.cam.ry, T.cam.rx))) T.S.line(drape(G, line, 0.1));
        T.S.kind = INK;
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

    // The two cut faces of the block we can see: the ground's edge along the
    // top, strata below it and the base
    function drawSides(T, G, zb, rng) {
        const { S, cam } = T;
        const N = PG.makeNoise(rng);
        const sides = [];
        if (cam.facing(0, -1, 0)) sides.push({ n: G.nx, pt: i => [G.px(i), 0], v: i => G.id(i, 0) });
        if (cam.facing(-1, 0, 0)) sides.push({ n: G.ny, pt: j => [0, G.py(j)], v: j => G.id(0, j) });
        if (cam.facing(0, 1, 0)) sides.push({ n: G.nx, pt: i => [G.px(i), G.Ly], v: i => G.id(i, G.ny) });
        if (cam.facing(1, 0, 0)) sides.push({ n: G.ny, pt: j => [G.Lx, G.py(j)], v: j => G.id(G.nx, j) });
        const [, top] = G.bounds();
        for (const sd of sides) {
            const pts = [];
            for (let i = 0; i <= sd.n; i++) pts.push([...sd.pt(i), G.h[sd.v(i)], G.W[sd.v(i)]]);
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

    // Point on a polyline at arc position t (0..1), with its direction
    function pathAt(path, cum, t) {
        const L = cum[cum.length - 1] * t;
        let i = 0;
        while (i + 2 < cum.length && cum[i + 1] < L) i++;
        const f = (L - cum[i]) / (cum[i + 1] - cum[i]), a = path[i], b = path[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return { x: geo.lerp(a[0], b[0], f), y: geo.lerp(a[1], b[1], f), ux: (b[0] - a[0]) / l, uy: (b[1] - a[1]) / l };
    }

    const axisAt = (V, t) => pathAt(V.axis, V.cum, t);

    // Level the ground round (x, y) out to r, blending back in over the next r/2
    function level(G, x, y, r, z) {
        for (let j = 0; j <= G.ny; j++) {
            for (let i = 0; i <= G.nx; i++) {
                const d = Math.hypot(G.px(i) - x, G.py(j) - y);
                if (d > r * 1.5) continue;
                const v = G.id(i, j), w = 1 - smooth(r, r * 1.5, d);
                G.h[v] = geo.lerp(G.h[v], z, w);
            }
        }
    }

    // A crossing behind the village gives the train a clear silhouette and keeps
    // the river visible beneath a continuous run of stone arches.
    function railLine(G, V, rng) {
        const pts = [], zs = [], inside = [], kind = [];
        const lift = Math.max(9, Math.min(14, G.Lx * 0.067));
        const z0 = V.floorAt(0.5) + lift, phase = rng.range(-0.2, 0.2);
        const n = Math.ceil((G.Lx + 16) / 2);
        for (let i = 0; i <= n; i++) {
            const t = i / n, x = -8 + (G.Lx + 16) * t;
            const y = G.Ly * (0.48 + 0.055 * Math.sin(Math.PI * t + phase));
            const z = z0 + t * 2.2, ground = G.at(x, y);
            pts.push([x, y]); zs.push(z);
            inside.push(x > 1 && x < G.Lx - 1 && y > 1 && y < G.Ly - 1);
            kind.push(ground > z + 5 ? 'tunnel' : ground < z - 3.5 ? 'bridge' : 'shelf');
        }
        pts.forEach(([x, y], i) => {
            if (kind[i] !== 'shelf' || !inside[i]) return;
            for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
                const gi = Math.round(x / G.dx) + di, gj = Math.round(y / G.dy) + dj;
                if (gi < 0 || gj < 0 || gi > G.nx || gj > G.ny) continue;
                const d = Math.hypot(G.px(gi) - x, G.py(gj) - y);
                if (d > 4.5) continue;
                const v = G.id(gi, gj), f = 1 - smooth(2.5, 4.5, d);
                G.h[v] = geo.lerp(G.h[v], zs[i], f);
                G.W[v] = Math.min(G.W[v], G.h[v] - 0.5);
            }
        });
        return { pts, zs, inside, kind };
    }
    function mainRoad(G, V, side) {
        const off = V.W0 * 0.62, qs = [], os = [];
        for (let i = 0; i <= 60; i++) {
            const q = axisAt(V, 0.02 + (0.62 * i) / 60), nx = -q.uy * side, ny = q.ux * side;
            let o = off;
            while (o < off + 80 && (G.wet(q.x + nx * o, q.y + ny * o) || G.wet(q.x + nx * (o - 5), q.y + ny * (o - 5)))) o += 1;
            qs.push([q.x, q.y, nx, ny]);
            os.push(o);
        }
        // widen the detour a bit either side before smoothing, or the curves cut back into the water
        let o2 = os.map((_, i) => Math.max(...os.slice(Math.max(0, i - 3), i + 4)));
        for (let pass = 0; pass < 2; pass++) o2 = o2.map((_, i) => { const w = o2.slice(Math.max(0, i - 3), i + 4); return w.reduce((a, b) => a + b, 0) / w.length; });
        return geo.chaikin(qs.map(([x, y, nx, ny], i) => [x + nx * o2[i], y + ny * o2[i]]), 1);
    }

    function earthworks(G, V, rng, p) {
        const M = Math.min(G.Lx, G.Ly);
        const side = V.vside, E = { side };
        E.main = mainRoad(G, V, side);
        // the village: whichever spot on the road side of the floor has the most flat dry ground round it
        const room = (x, y) => {
            let n = 0;
            for (let r = 12; r <= 48; r += 12) {
                for (let k = 0; k < r / 2; k++) {
                    const a = (k / (r / 2)) * TAU, qx = x + r * Math.cos(a), qy = y + r * Math.sin(a);
                    if (qx > 8 && qy > 8 && qx < G.Lx - 8 && qy < G.Ly - 8 && G.slope(qx, qy) < 0.3 && !G.wet(qx, qy)) n++;
                }
            }
            return n;
        };
        for (let k = 0; k < 40; k++) {
            const t = V.tv + rng.range(-0.08, 0.08), q = axisAt(V, t), o = V.W0 * 0.62 * rng.range(1.3, 2.6);
            const x = q.x - q.uy * o * side, y = q.y + q.ux * o * side;
            if (G.wet(x, y)) continue;
            const score = room(x, y) + rng.range(0, 4);
            if (!E.village || score > E.village.score) E.village = { x, y, score, ang: Math.atan2(q.uy, q.ux) };
        }
        if (!E.village) {
            const q = axisAt(V, 0.2);
            E.village = { x: q.x - q.uy * V.W0 * 1.2 * side, y: q.y + q.ux * V.W0 * 1.2 * side, ang: Math.atan2(q.uy, q.ux) };
        }
        // the hut on a little alp cut into the slope a way above the village. Try a few spots
        // until one has a road up to it that isn't too steep.
        if (p.hut) {
            const v = E.village, zv = G.at(v.x, v.y), cands = [];
            let from = E.main[0];
            for (const q of E.main) if (Math.hypot(q[0] - v.x, q[1] - v.y) < Math.hypot(from[0] - v.x, from[1] - v.y)) from = q;
            for (let tries = 0; tries < 400; tries++) {
                const x = rng.range(18, G.Lx - 18), y = rng.range(18, G.Ly - 18);
                if (G.wet(x, y) || nearest(V.axis, V.cum, x, y).side !== side) continue;
                const z = G.at(x, y), d = Math.hypot(x - v.x, y - v.y), rise = (z - zv) / p.relief;
                if (d < 50 || d > 170 || rise < 0.1 || rise > 0.4) continue;
                cands.push({ x, y, z, score: -Math.abs(rise - 0.22) * 6 - G.slope(x, y) - d / 300 });
            }
            cands.sort((a, b) => b.score - a.score);
            for (const c of cands.slice(0, 4)) {
                const keep = G.h.slice();
                level(G, c.x, c.y, 11, c.z);
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
        // the top station on the highest summit well inside the block
        if (p.cable) {
            let top = null;
            const m = Math.round((M * 0.12) / G.dx);
            for (let j = m; j <= G.ny - m; j++) for (let i = m; i <= G.nx - m; i++) {
                const v = G.id(i, j);
                if (!top || G.h[v] > top[2]) top = [G.px(i), G.py(j), G.h[v]];
            }
            if (top) {
                level(G, top[0], top[1], 6, top[2] - 1.5);
                E.top = top;
            }
        }
        if (p.railway) E.rail = railLine(G, V, rng);
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
    function drawRail(T, G, R, claims, rng) {
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
        // a train out in the open
        const long = open.filter(([a, b]) => b - a > 30);
        if (long.length) {
            const [a, b] = rng.pick(long);
            train(T, pts, zs, rng.int(a + 26, b - 2), rng);
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
        const inside = q => q[0] >= 0 && q[1] >= 0 && q[0] <= G.Lx && q[1] <= G.Ly;
        for (const side of [L, R]) {
            let run = [];
            for (const q of side) {
                if (inside(q) && !G.wet(q[0], q[1])) run.push(q);
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
        const cell = (x, y) => G.id(geo.clamp(Math.round(x / G.dx), 1, nx - 1), geo.clamp(Math.round(y / G.dy), 1, ny - 1));
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
            const [c, v] = pop();
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
        for (let v = t; v >= 0; v = prev[v]) path.push([G.px(v % (nx + 1)), G.py(Math.floor(v / (nx + 1)))]);
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

    // Chalet: a stone base stepping down to the slope, walls, a wide gable
    // roof and a balcony along the front on the upper floor
    function chalet(T, G, x, y, ang, L, D, floors, rng) {
        const S = T.S, F0 = turned(x, y, 0, ang);
        const zs = [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]].map(([a, b]) => { const q = F0.P(a, b, 0); return G.at(q[0], q[1]); });
        const zlo = Math.min(...zs), zhi = Math.max(...zs), F = turned(x, y, zhi + 0.3, ang);
        const fp = [-L / 2, -D / 2, L / 2, D / 2], top = floors * 2.8;
        groundShadow(T, G, [-1, 1].flatMap(a => [-1, 1].flatMap(b => [F.P(a * L / 2, b * D / 2, 0), F.P(a * (L / 2 + 0.7), b * (D / 2 + 0.7), top + D * 0.3)])));
        S.kind = INK;
        S.box(F, -L / 2 - 0.2, -D / 2 - 0.2, zlo - zhi - 1, L / 2 + 0.2, D / 2 + 0.2, 0);
        footing(T, G, F, -L / 2 - 0.2, -D / 2 - 0.2, L / 2 + 0.2, D / 2 + 0.2);
        S.box(F, -L / 2, -D / 2, 0, L / 2, D / 2, top);
        const R = gableRoof(T, F, fp, top, true, geo.rad(rng.range(27, 34)), rng);
        shadeGable(T, F, R);
        if (rng.chance(0.5)) chimney(T, F, rng.range(-L / 3, L / 3), R.mid + 0.6, R.zb, R.ridge + 0.5);
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) door(T, front.at, L / 2, 0, 1.1, 2);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            // Timber bands sit between the floors; shutters frame each window.
            S.kind = ROAD;
            for (let f = 1; f < floors; f++) for (const c of [f * 2.8, f * 2.8 + 0.3]) S.line([W.at(0, c), W.at(W.len, c)]);
            const n = Math.max(1, Math.floor(W.len / 3)), step = W.len / n;
            for (let f = 0; f < floors; f++) for (let i = 0; i < n; i++) {
                const s = (i + 0.5) * step - 0.5, c = f * 2.8 + 0.9;
                if (side === 0 && f === 0 && Math.abs(s + 0.5 - L / 2) < 1.3) continue;
                S.kind = INK;
                pane(T, W.at, s, c, 1, 1.2, 'cross');
                if (T.k > 0.55) {
                    S.kind = ACCENT;
                    for (const a of [s - 0.5, s + 1.1]) {
                        pane(T, W.at, a, c, 0.4, 1.2, 'bars');
                    }
                }
            }
        }
        S.kind = INK;
        if (floors > 1 && T.sees(front.n)) {
            S.box(F, -L / 2 + 0.3, -D / 2 - 1, 2.8, L / 2 - 0.3, -D / 2, 2.95);
            S.kind = ACCENT;
            S.line([F.P(-L / 2 + 0.3, -D / 2 - 1, 3.9), F.P(L / 2 - 0.3, -D / 2 - 1, 3.9)]);
            for (let a = -L / 2 + 0.3; a <= L / 2 - 0.2; a += Math.max(0.65, 0.45 / T.k)) S.line([F.P(a, -D / 2 - 1, 2.95), F.P(a, -D / 2 - 1, 3.9)]);
            S.kind = GREEN;
            for (let a = -L / 2 + 1; a < L / 2 - 1; a += 2.8) {
                S.line([F.P(a - 0.7, -D / 2 - 1.12, 3.75), F.P(a, -D / 2 - 1.2, 3.55), F.P(a + 0.7, -D / 2 - 1.12, 3.75)]);
            }
        }
        S.kind = INK;
        return zhi + 0.3;
    }

    // Lattice pylon from the ground up to a crossarm at `top`, across `A`
    function pylon(T, x, y, z0, top, A) {
        const S = T.S, w0 = 1.6, w1 = 0.5, h = top - z0;
        const at = (sx, sy, f) => { const w = geo.lerp(w0, w1, f); return [x + (A[0] * sx - A[1] * sy) * w, y + (A[1] * sx + A[0] * sy) * w, z0 + h * f]; };
        const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sx, sy] of legs) S.line([at(sx, sy, 0), at(sx, sy, 1)]);
        const n = Math.max(2, Math.round(h / 3));
        for (let k = 0; k < 4; k++) {
            const [ax, ay] = legs[k], [bx, by] = legs[(k + 1) % 4];
            for (let i = 0; i < n; i++) S.line([at(ax, ay, i / n), at(bx, by, (i + 1) / n)]);
        }
        S.line([[x - A[0] * 3, y - A[1] * 3, top], [x + A[0] * 3, y + A[1] * 3, top]]);
    }

    // Cable car from `a` up to `b` (ground points): stations at each end,
    // pylons wherever the cable would come down too near the ground, a pair of
    // sagging cables and a cabin or two on them
    function cableCar(T, G, a, b, claims, rng) {
        const S = T.S;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), u = [dx / L, dy / L], A = [-u[1], u[0]];
        const za = G.at(a[0], a[1]) + 7, zb = G.at(b[0], b[1]) + 7;
        const sup = [[0, za], [1, zb]];
        // put in pylons where the straight line between supports is lowest over the ground
        for (let it = 0; it < 4; it++) {
            let worst = null, wc = 9;
            for (let k = 0; k + 1 < sup.length; k++) {
                const [f0, z0] = sup[k], [f1, z1] = sup[k + 1];
                for (let f = f0 + 0.03; f < f1 - 0.03; f += 0.01) {
                    const x = a[0] + dx * f, y = a[1] + dy * f, c = geo.lerp(z0, z1, (f - f0) / (f1 - f0)) - G.at(x, y);
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
            claims.take(p[0], p[1], 7);
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
        // cabins, one on each track, hanging a few metres under the cable
        for (const [off, f] of [[-2, rng.range(0.25, 0.45)], [2, rng.range(0.55, 0.75)]]) {
            let k = 0;
            while (k + 2 < sup.length && sup[k + 1][0] < f) k++;
            const s = (f - sup[k][0]) / (sup[k + 1][0] - sup[k][0]), pts = cable(off, sup[k][0], sup[k][1], sup[k + 1][0], sup[k + 1][1]);
            const q = pts[Math.round(s * 24)], F = turned(q[0], q[1], q[2] - 4.6, Math.atan2(u[1], u[0]));
            S.line([q, F.P(0, 0, 2.6)]);
            S.box(F, -1.4, -1.1, 0, 1.4, 1.1, 2.4);
            S.kind = RED;
            S.hatch([F.P(-1.4, -1.1, 2.4), F.P(1.4, -1.1, 2.4), F.P(1.4, 1.1, 2.4), F.P(-1.4, 1.1, 2.4)], F.V(0, 1, 0), 0.35);
            S.kind = INK;
        }
        claims.line(Array.from({ length: 40 }, (_, i) => [a[0] + dx * i / 39, a[1] + dy * i / 39]), 3);
    }

    // Stream from high up in a gully down to the river, taking the steepest
    // way down, falling in streaks where it goes over something steep
    function stream(T, G, start) {
        const S = T.S, { nx, ny, h, W } = G;
        let i = geo.clamp(Math.round(start[0] / G.dx), 1, nx - 1), j = geo.clamp(Math.round(start[1] / G.dy), 1, ny - 1);
        const path = [];
        for (let step = 0; step < 600; step++) {
            const v = G.id(i, j);
            path.push([G.px(i), G.py(j), h[v]]);
            if (W[v] > h[v] || i <= 0 || j <= 0 || i >= nx || j >= ny) break;
            let best = null, bz = h[v];
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
                if ((a || b) && h[G.id(i + a, j + b)] < bz) { bz = h[G.id(i + a, j + b)]; best = [i + a, j + b]; }
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

    // Everything on the valley: forest, the village and its roads, the road
    // up to the hut, the cable car, a stream coming down, and a couple of
    // paragliders and birds overhead
    function settle(T, G, V, E, rng) {
        const { S, p } = T;
        const N = PG.makeNoise(rng), claims = new Claims();
        const [zmin, zmax] = G.bounds(), treeline = geo.lerp(zmin, zmax, p.snow * 0.8);
        const AT = t => axisAt(V, t);
        const onBlock = (x, y, m) => x > m && y > m && x < G.Lx - m && y < G.Ly - m;
        const side = E.side, { x: cx, y: cy, ang } = E.village;
        const dryRound = (x, y, r) => {
            for (let k = 0; k < 8; k++) if (G.wet(x + r * Math.cos((k * TAU) / 8), y + r * Math.sin((k * TAU) / 8))) return false;
            return !G.wet(x, y);
        };
        road(T, G, E.main, 4.5);
        claims.line(E.main, 3.5);
        if (E.rail) claims.line(E.rail.pts.filter((_, i) => E.rail.inside[i]), 4);
        if (E.hut) claims.take(E.hut[0], E.hut[1], 10);
        const lanes = [E.main];
        const addLane = pts => {
            const path = geo.resample(geo.chaikin(pts, 2), 2);
            if (path.length < 2 || geo.pathLength(path) < 1) return;
            if (path.some(([x, y]) => !onBlock(x, y, 3) || !dryRound(x, y, 2) || G.slope(x, y) > 0.45)) return;
            road(T, G, path, 3);
            claims.line(path, 2.5);
            lanes.push(path);
        };
        // A looping village lane and a quieter road along the opposite bank.
        const mcum = lengths(E.main), mainPoint = t => { const q = pathAt(E.main, mcum, t); return [q.x, q.y]; };
        const loop = [mainPoint(0.08)];
        for (const t of [0.2, 0.4, 0.6]) { const q = mainPoint(t); loop.push([Math.min(G.Lx - 8, q[0] + 32), q[1]]); }
        loop.push(mainPoint(0.72));
        addLane(loop);
        const west = [];
        for (let i = 0; i <= 20; i++) {
            const q = AT(0.07 + 0.35 * i / 20), off = Math.max(14, V.W0 * 0.75);
            west.push([q.x - q.uy * off, q.y + q.ux * off]);
        }
        addLane(west);
        // where the village is on the road
        let iv = 0;
        E.main.forEach((q, i) => { if (Math.hypot(q[0] - cx, q[1] - cy) < Math.hypot(E.main[iv][0] - cx, E.main[iv][1] - cy)) iv = i; });
        // a lane off the road over the river on a stone bridge, into the other half of the village
        const vr = E.main[iv], rt = nearest(V.river, V.rcum, vr[0], vr[1]).t;
        for (const dt of [0, 0.03, -0.03, 0.06, -0.06]) {
            const r = pathAt(V.river, V.rcum, geo.clamp(rt + dt, 0.02, 0.98));
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
                const bank = lanes[lanes.length - 1], c = lengths(bank), q = pathAt(bank, c, nearest(bank, c, ...far).t);
                addLane([far, [q.x, q.y]]);
            }
            break;
        }
        if (E.hutRoad) {
            road(T, G, E.hutRoad, 3);
            claims.line(E.hutRoad, 2.5);
        }
        // the church in the middle of the village, or the nearest flat spot to it
        if (p.church) {
            let spot = null;
            for (let k = 0; k < 30 && !spot; k++) {
                const r = k && 3 + k * 1.2, x = cx + r * Math.cos(k * 2.4), y = cy + r * Math.sin(k * 2.4);
                if (onBlock(x, y, 15) && G.slope(x, y) < 0.35 && dryRound(x, y, 9) && claims.free(x, y, 10)) spot = [x, y];
            }
            if (spot) {
                const [x, y] = spot, F0 = turned(x, y, 0, ang + (Math.PI / 2) * side), fp = [-4.5, -8, 4.5, 8];
                const zs = [[-5, -8], [5, -8], [5, 8], [-5, 8]].map(([a, b]) => { const q = F0.P(a, b, 0); return G.at(q[0], q[1]); });
                const F = turned(x, y, Math.max(...zs) + 0.2, ang + (Math.PI / 2) * side);
                S.kind = INK;
                S.box(F, -5, -8.4, Math.min(...zs) - Math.max(...zs) - 1, 5, 8.4, 0);
                footing(T, G, F, -5, -8.4, 5, 8.4);
                church(T, F, fp, rng);
                groundShadow(T, G, [[-5, -8, 0], [5, -8, 0], [5, 8, 0], [-5, 8, 0], [0, 5, 18], [-4, 0, 8], [4, 0, 8]].map(q => F.P(...q)));
                claims.take(x, y, 11);
                const entry = F.P(0, -9, 0), q = pathAt(E.main, mcum, nearest(E.main, mcum, ...entry).t);
                road(T, G, geo.resample([entry.slice(0, 2), [q.x, q.y]], 2), 2.4);
                S.kind = ROAD;
                const apron = [[-6, -10], [6, -10], [6, -8.5], [-6, -8.5], [-6, -10]].map(([a, b]) => F.P(a, b, 0).slice(0, 2));
                S.line(drape(G, apron));
                for (const a of [-5, 5]) {
                    const b = F.P(a, -9.3, 0);
                    bench(T, b[0], b[1], G.at(b[0], b[1]) + 0.1, PG.isokit.nearestDir(...F.V(0, -1, 0)));
                }
                S.kind = INK;
            }
        }
        // bottom station of the cable car at the edge of the village, on its side of the river
        let start = null;
        if (E.top) {
            for (let tries = 0; tries < 150 && !start; tries++) {
                const a = rng.range(0, TAU), r = rng.range(20, 60), x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                if (!onBlock(x, y, 10) || G.slope(x, y) > 0.3 || !claims.free(x, y, 7) || !dryRound(x, y, 8)) continue;
                if (nearest(V.axis, V.cum, x, y).side === side && Math.hypot(E.top[0] - x, E.top[1] - y) > 60) start = [x, y];
            }
            if (start) claims.take(start[0], start[1], 8);
        }
        // Chalets face their lane, with a footpath to the front door.
        const streets = lanes.map(path => ({ path, cum: lengths(path) }));
        const nHouses = Math.round(38 * p.houses);
        for (let i = 0, tries = 0; i < nHouses && tries < nHouses * 70; tries++) {
            const street = rng.pick(streets), q = pathAt(street.path, street.cum, rng.range(0.02, 0.93));
            const L = rng.range(9, 14), D = rng.range(7, 10), rr = Math.hypot(L, D) / 2 + 0.8;
            const sign = rng.sign(), off = sign * (rr + 4 + rng.range(0, 5));
            const x = q.x - q.uy * off, y = q.y + q.ux * off;
            const a = Math.atan2(q.uy, q.ux) + (sign < 0 ? Math.PI : 0);
            if (!onBlock(x, y, rr + 2) || G.slope(x, y) > 0.45 || !claims.free(x, y, rr) || !dryRound(x, y, rr + 3)) continue;
            const terrace = turned(x, y, 0, a).P(L / 2 + 2.3, -D / 2 + 0.5, 0);
            const cafe = i % 4 === 0 && onBlock(terrace[0], terrace[1], 3) && dryRound(terrace[0], terrace[1], 2) && claims.free(terrace[0], terrace[1], 2);
            claims.take(x, y, rr);
            const z = chalet(T, G, x, y, a, L, D, rng.chance(0.85) ? 2 : 1, rng);
            const F = turned(x, y, z, a), entry = F.P(0, -D / 2 - 0.5, 0);
            const walk = [entry.slice(0, 2), [q.x, q.y]];
            road(T, G, geo.resample(walk, 1.5), 1.3);
            claims.line(geo.resample(walk, 2), 1);
            if (cafe) {
                const zt = G.at(terrace[0], terrace[1]) + 0.15;
                claims.take(terrace[0], terrace[1], 2);
                S.kind = ACCENT;
                patioSet(T, turned(terrace[0], terrace[1], zt, a), 0, 0, rng);
                S.kind = INK;
            }
            i++;
        }
        // Walkers and benches give the streets a human scale.
        for (const { path, cum } of streets) {
            const len = cum[cum.length - 1], count = Math.round(len * p.houses / 12);
            for (let i = 0; i < count; i++) {
                const q = pathAt(path, cum, rng.range(0.08, 0.9));
                const x = q.x - q.uy * 0.7, y = q.y + q.ux * 0.7;
                if (!onBlock(x, y, 3) || G.wet(x, y)) continue;
                person(T, x, y, G.at(x, y) + 0.12, rng);
                if (i % 3 === 0) {
                    const bx = q.x + q.uy * 3.6, by = q.y - q.ux * 3.6;
                    if (onBlock(bx, by, 2) && dryRound(bx, by, 1.5) && claims.free(bx, by, 1.2)) {
                        claims.take(bx, by, 1.2);
                        S.kind = ROAD;
                        bench(T, bx, by, G.at(bx, by) + 0.1, PG.isokit.nearestDir(-q.uy, q.ux));
                    }
                }
            }
        }
        S.kind = INK;
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
        if (start) cableCar(T, G, start, [E.top[0], E.top[1]], claims, rng);
        // a stream down the far side, from a gully high up
        if (p.falls) {
            let best = null;
            for (let tries = 0; tries < 300; tries++) {
                const x = rng.range(10, G.Lx - 10), y = rng.range(10, G.Ly - 10), z = G.at(x, y);
                const n = nearest(V.axis, V.cum, x, y);
                if (n.side === side || z < geo.lerp(zmin, zmax, 0.35) || z > geo.lerp(zmin, zmax, 0.65) || n.t < 0.2) continue;
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
        if (E.rail) drawRail(T, G, E.rail, claims, rng);
        // forest: in clumps on the lower and middle slopes, thinning out up to the tree line
        const sp = geo.lerp(12, 6, p.forest), f = 1 / 35;
        S.kind = GREEN;
        for (let y = sp / 2; y < G.Ly; y += sp) {
            for (let x = sp / 2; x < G.Lx; x += sp) {
                const tx = x + rng.range(-0.45, 0.45) * sp, ty = y + rng.range(-0.45, 0.45) * sp;
                if (!onBlock(tx, ty, 2)) continue;
                const z = G.at(tx, ty), sl = G.slope(tx, ty), up = (z - zmin) / (treeline - zmin);
                if (up > 1 || sl > 0.95 || G.wet(tx, ty)) continue;
                const clump = N.fbm2(tx * f, ty * f, 3) + 0.25 * (1 - Math.abs(up - 0.45) * 2) - 0.1 * (up < 0.08 ? 3 : 0);
                if (!p.forest || clump < 0.3 - 0.38 * p.forest || !claims.free(tx, ty, 2.2)) continue;
                claims.take(tx, ty, 1.4);
                S.kind = GREEN;
                const height = rng.range(7, 12) * (1.1 - 0.4 * up);
                groundShadow(T, G, [[tx - 1, ty - 1, z], [tx + 1, ty + 1, z], [tx, ty, z + height]]);
                S.kind = GREEN;
                conifer(T, tx, ty, z - 0.2, height, rng);
            }
        }
        // overhead
        if (p.fliers) {
            for (let i = rng.int(1, 2); i > 0; i--) {
                const q = AT(rng.range(0.3, 0.8)), z = G.at(q.x, q.y) + (zmax - zmin) * rng.range(0.45, 0.75);
                paraglider(T, q.x + rng.range(-20, 20), q.y + rng.range(-20, 20), z, rng.range(0, TAU), rng);
            }
            const q = AT(rng.range(0.4, 0.9));
            birds(T, q.x, q.y, zmax + rng.range(5, 20), rng);
        }
        S.kind = INK;
    }

    // ------------------------------------------------------------------
    // Scene
    // ------------------------------------------------------------------

    function buildValley(T, G, V, E, rng) {
        const { p } = T;
        const [zmin, zmax] = G.bounds();
        V.snow = geo.lerp(zmin, zmax, p.snow);
        const snowNoise = PG.makeNoise(new PG.RNG(hash(p.seed, 908)));
        V.snowAt = (x, y) => V.snow + p.relief * 0.055 * snowNoise.noise2(x / 18, y / 18);
        drawGround(T, G, V);
        terrainMarks(T, G, V);
        if (p.cutaway) drawSides(T, G, zmin - p.base, rng);
        settle(T, G, V, E, rng);
        return V;
    }

    PG.register({
        id: 'alpine',
        name: 'Alpine Valley',
        category: 'Scenes',
        description: 'A storybook mountain village with red-roofed chalets, a stone railway viaduct, fir woods and snow-capped peaks.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'size', label: 'Valley size (m)', type: 'range', min: 120, max: 400, step: 5, value: 160, random: [140, 190],
                hint: 'Smaller valleys bring the buildings closer' },
            { id: 'aspect', label: 'Valley depth', type: 'range', min: 0.6, max: 2, step: 0.05, value: 1.35, random: [1.1, 1.5] },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 25, max: 65, step: 0.5, value: 30, random: [27, 39] },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 37, random: [33, 41] },
            { id: 'framing', label: 'Framing', type: 'select', value: 'close', random: false,
                options: [['close', 'Village close-up'], ['whole', 'Whole valley']] },
            { id: 'cutaway', label: 'Cutaway base', type: 'checkbox', value: false },
            { id: 'base', label: 'Base depth (m)', type: 'range', min: 5, max: 60, step: 1, value: 8, random: false, show: p => p.cutaway },
            { type: 'section', label: 'Landscape' },
            { id: 'relief', label: 'Mountain height (m)', type: 'range', min: 30, max: 240, step: 5, value: 75, random: [65, 100] },
            { id: 'valley', label: 'Valley width', type: 'range', min: 0.1, max: 0.5, step: 0.01, value: 0.36, random: [0.3, 0.44] },
            { id: 'lake', label: 'Lake', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, random: [0.4, 1], hint: 'Chance of a lake above the village' },
            { id: 'snow', label: 'Snow line', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.72, random: [0.6, 0.85],
                hint: 'Share of the way up above which the ground is left white' },
            { id: 'contours', label: 'Topographic contours', type: 'checkbox', value: false },
            { id: 'contour', label: 'Contour interval (m)', type: 'range', min: 1, max: 20, step: 0.5, value: 8, random: false, show: p => p.contours },
            { id: 'rock', label: 'Mountain shading', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.4, 1] },
            { type: 'section', label: 'Life' },
            { id: 'forest', label: 'Forest', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.3, 0.85] },
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
                const heightK = (H * 0.94) / (y1 - y0);
                return { k: Math.min((W * 0.94) / (x1 - x0), heightK), heightK, mid: c0.ground((x0 + x1) / 2, (y0 + y1) / 2, 0) };
            };
            const base = p.cutaway ? p.base : 0;
            const guess = fit(-base, p.relief * 1.15);
            const G = new Ground(Lx, Ly, geo.clamp(1.3 / guess.k, 1.2, 3));
            const V = landscape(G, p, rng);
            const E = earthworks(G, V, rng, p);
            const [zmin] = G.bounds(), fitted = fit(zmin - base, 0, G);
            const close = p.framing === 'close' && !p.cutaway;
            const k = close ? Math.min(fitted.k * 1.5, fitted.heightK) : fitted.k, mid = fitted.mid;
            if (close) { mid[0] += Lx * 0.065 * c0.rx; mid[1] += Lx * 0.065 * c0.ry; }
            const cam = makeCamera(p.yaw, p.elev, k, W, H, mid[0], mid[1]);
            const S = new Scene(cam, W, H);
            const T = {
                S, cam, p: Object.assign({ seed: ctx.seed | 0 }, p), k,
                detail: true,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                tones: { lit: RED, dark: INK, canopy: ACCENT },
                waterKind: BLUE,
                hLit: 0.65,
                hDark: 0.4,
                lit: n => (n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * SUN[2],
            };
            buildValley(T, G, V, E, rng);
            const out = PG.pens.renderScene('alpine', S, p);
            return out;
        },
    });
})();
