/*
 * Farmland: a farm and the country round it, drawn filling the page in the
 * same isometric scene as Castle Town and Alpine Valley (lib/iso.js).
 *
 * There are four kinds of country, each with its own plan, farm and crops
 * (see COUNTRIES). The prairie is a grid of section roads and big square
 * fields with a center pivot. Hedgerows are small fields cut from a Voronoi
 * diagram with a hedge along every edge, a winding lane and an oast house.
 * The Tuscan hills have a farm on a hilltop at the end of a white road lined
 * with cypresses. The polder is dead flat, long strips between ditches, a
 * dike with a river behind it and a mill. The season picks the crops.
 *
 * The ground is a height grid lined up with the page, and the crop rows are
 * straight lines in plan laid over it, so they ripple over the hills on
 * paper and show the lie of the land. Everything is planned first: the
 * roads, the creek, the farm lot and the fields. Then the ground is shaped
 * round them (a valley for the creek, a level lot, a hollow for the pond),
 * the buildings, trees and machines are drawn and cast their shadows onto
 * the ground, and last the lines on the ground are laid, cut wherever
 * there's a shadow, a road or water so nothing runs through them. Machines
 * at work split a field into the part done and the part still to do.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, Scene, segments, hull } = PG.iso;
    const kit = PG.isokit;
    const { wall, pane, door, gableRoof, hipRoof, chimney, inKind, withKind, outward, shade, shadeGable, vault, ribs, turned, unit } = kit;

    // Line kinds, in the order of the parts in pens.js
    const INK = 0, RED = 1, SHADOW = 2, GOLD = 3, GREEN = 4, FIGURE = 5, WATER = 6, SOIL = 7, BLOOM = 8;
    // Lines closer than this on paper (mm) run together under a 0.35 mm pen
    const FINE = 0.7;
    // Ground an A4 page shows at the default view width (screen m²)
    const REF_AREA = 190 * 190 * 267 / 180;
    const UP = [0, 0, 1];
    const smooth = geo.smoothstep;
    const person = withKind(FIGURE, kit.person);

    // Paper distance (mm) between two lines along world vector a that are
    // world vector b apart
    function apart(T, a, b) {
        const c = T.cam, on = v => [v[0] * c.rx + v[1] * c.ry, (v[0] * c.fx + v[1] * c.fy) * c.se + (v[2] || 0) * c.ce];
        const p = on(a), q = on(b);
        return (c.k * Math.abs(p[0] * q[1] - p[1] * q[0])) / (Math.hypot(p[0], p[1]) || 1);
    }

    // Length on paper (mm) of a meter of level ground along direction (dx, dy)
    function onPaper(T, dx, dy) {
        const c = T.cam;
        return c.k * Math.hypot(dx * c.rx + dy * c.ry, (dx * c.fx + dy * c.fy) * c.se);
    }

    const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

    function bounds(pts) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of pts) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
        return [x0, y0, x1, y1];
    }

    function distToPath(pts, x, y) {
        let best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1];
            const t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
            const d = Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t);
            if (d < best) best = d;
        }
        return best;
    }

    // Distance to a polygon's outline, negative inside
    function polyDist(poly, x, y) {
        const d = distToPath(poly.concat([poly[0]]), x, y);
        return geo.pointInPolygon(x, y, poly) ? -d : d;
    }

    function pathNearPoly(path, poly, gap) {
        return path.some(q => polyDist(poly, q[0], q[1]) < gap)
            || poly.some(q => distToPath(path, q[0], q[1]) < gap)
            || !!crossing(path, poly.concat([poly[0]]));
    }

    // The line `off` meters to the left of a path
    function sidePath(pts, off) {
        return pts.map((q, i) => {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            return [q[0] - ((b[1] - a[1]) / l) * off, q[1] + ((b[0] - a[0]) / l) * off];
        });
    }

    // Points round a vertical circle on the half the camera sees, a hair outside it
    function frontArc(T, x, y, z, r, n = 14) {
        const c = T.cam, phi = Math.atan2(c.fy, c.fx), R = r * 1.015 + 0.01, out = [];
        for (let i = 0; i <= n; i++) {
            const a = phi + Math.PI / 2 + (Math.PI * i) / n;
            out.push([x + R * Math.cos(a), y + R * Math.sin(a), z]);
        }
        return out;
    }

    // Hatch flat polygons in a plane (world points: the first is the outline,
    // the rest holes), lines along unit vector d about gap mm apart on paper
    function hatchIn(T, polys, d, gap, phase = 0.5) {
        const o = polys[0][0], n = unit(PG.iso.newell(polys[0]));
        const e2 = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
        const per = apart(T, d, e2);
        if (per < 1e-6) return;
        const flat = q => { const x = q[0] - o[0], y = q[1] - o[1], z = q[2] - o[2]; return [x * d[0] + y * d[1] + z * d[2], x * e2[0] + y * e2[1] + z * e2[2]]; };
        const lift = ([u, v]) => [o[0] + u * d[0] + v * e2[0], o[1] + u * d[1] + v * e2[1], o[2] + u * d[2] + v * e2[2]];
        for (const [a, b] of geo.hatch(polys.map(P => P.map(flat)), gap / per, 0, phase)) T.S.line([lift(a), lift(b)]);
    }

    // ------------------------------------------------------------------
    // The ground: heights on a grid lined up with the page
    // ------------------------------------------------------------------

    class Ground {
        // Lu × Lv meters from world point o, along unit vector u and u turned a quarter left
        constructor(Lu, Lv, step, o, u) {
            this.o = o;
            this.u = u;
            this.nx = Math.max(8, Math.round(Lu / step));
            this.ny = Math.max(8, Math.round(Lv / step));
            this.dx = Lu / this.nx;
            this.dy = Lv / this.ny;
            this.h = new Float64Array((this.nx + 1) * (this.ny + 1));
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
        each(fn) {
            for (let j = 0; j <= this.ny; j++) for (let i = 0; i <= this.nx; i++) fn(this.id(i, j), ...this.vxy(i, j));
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
        tris(i, j) {
            const a = this.id(i, j), b = this.id(i + 1, j), c = this.id(i + 1, j + 1), d = this.id(i, j + 1);
            return this.diag[j * this.nx + i] === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        }
        at(x, y) {
            const [la, lb] = this.local(x, y);
            const fx = geo.clamp(la / this.dx, 0, this.nx - 1e-9), fy = geo.clamp(lb / this.dy, 0, this.ny - 1e-9);
            const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, h = this.h;
            const a = h[this.id(i, j)], b = h[this.id(i + 1, j)], c = h[this.id(i + 1, j + 1)], d = h[this.id(i, j + 1)];
            if (this.diag[j * this.nx + i] === 0) return u > v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;
            return u + v < 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
        }
        // lowest ground under a footprint (world points)
        low(pts) {
            let z = Infinity;
            for (const [x, y] of pts) z = Math.min(z, this.at(x, y));
            return z;
        }
    }

    // ------------------------------------------------------------------
    // Keep-out zones: roads, the creek, the yard, shadows. Lines laid on the
    // ground break where they cross one.
    // ------------------------------------------------------------------

    class Mask {
        constructor(cell = 10) { this.cell = cell; this.cells = new Map(); }
        put(item, x0, y0, x1, y1) {
            const c = this.cell;
            for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
                for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
                    const key = i * 100003 + j;
                    let a = this.cells.get(key);
                    if (!a) this.cells.set(key, (a = []));
                    a.push(item);
                }
            }
        }
        // a polyline, r meters either side
        line(pts, r) {
            for (let i = 0; i + 1 < pts.length; i++) {
                const a = pts[i], b = pts[i + 1];
                this.put({ a, b, r2: r * r }, Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r);
            }
        }
        circle(x, y, r) { this.line([[x, y], [x, y]], r); }
        poly(pts) {
            const [x0, y0, x1, y1] = bounds(pts);
            this.put({ poly: pts, box: [x0, y0, x1, y1] }, x0, y0, x1, y1);
        }
        hit(x, y) {
            const c = this.cell, a = this.cells.get(Math.floor(x / c) * 100003 + Math.floor(y / c));
            if (!a) return false;
            for (const it of a) {
                if (it.poly) {
                    const b = it.box;
                    if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && geo.pointInPolygon(x, y, it.poly)) return true;
                    continue;
                }
                const { a: p, b: q, r2 } = it, ex = q[0] - p[0], ey = q[1] - p[1];
                const t = geo.clamp(((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
                const dx = x - p[0] - ex * t, dy = y - p[1] - ey * t;
                if (dx * dx + dy * dy < r2) return true;
            }
            return false;
        }
    }

    // Where things stand, so nothing is put down on top of something else
    class Claims {
        constructor() { this.m = new Mask(8); }
        free(x, y, r) { return !this.m.hit(x, y) && !this.m.hit(x + r, y) && !this.m.hit(x - r, y) && !this.m.hit(x, y + r) && !this.m.hit(x, y - r); }
        take(x, y, r) { this.m.circle(x, y, r); }
        poly(pts) { this.m.poly(pts); }
        line(pts, r) { this.m.line(pts, r); }
    }

    // Lay a plan polyline on the ground, lift meters up, in pieces where
    // `ok` allows. The ends of each piece are found to a few centimeters.
    // While the fields are being filled this waits in T.queue, so the rows
    // get cut by shadows cast later on by things standing in other fields.
    function lay(T, pts, lift = 0.1, ok = null, whole = false) {
        if (T.queue) {
            const kind = T.S.kind;
            T.queue.push(() => { T.S.kind = kind; layNow(T, pts, lift, ok, whole); });
            return;
        }
        layNow(T, pts, lift, ok, whole);
    }

    // Run fn now, or once the fields are done if lines are waiting
    function later(T, fn) {
        if (!T.queue) { fn(); return; }
        const kind = T.S.kind;
        T.queue.push(() => { T.S.kind = kind; fn(); });
    }

    function layNow(T, pts, lift, ok, whole) {
        const { S, G } = T, step = T.drapeStep;
        let run = [], prev = null, prevOk = false;
        const z = (x, y) => G.at(x, y) + lift;
        const flush = () => { if (run.length > 1) S.line(run, whole); run = []; };
        const visit = (x, y) => {
            const good = !ok || ok(x, y);
            if (prev && good !== prevOk) {
                let lo = 0, hi = 1;
                for (let k = 0; k < 7; k++) {
                    const m = (lo + hi) / 2;
                    if (ok(geo.lerp(prev[0], x, m), geo.lerp(prev[1], y, m)) === prevOk) lo = m; else hi = m;
                }
                const t = prevOk ? lo : hi, ex = geo.lerp(prev[0], x, t), ey = geo.lerp(prev[1], y, t);
                run.push([ex, ey, z(ex, ey)]);
                if (prevOk) flush();
            }
            if (good) run.push([x, y, z(x, y)]);
            prev = [x, y];
            prevOk = good;
        };
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
            for (let k = 0; k < n; k++) visit(geo.lerp(a[0], b[0], k / n), geo.lerp(a[1], b[1], k / n));
        }
        const e = pts[pts.length - 1];
        visit(e[0], e[1]);
        flush();
    }

    // The piece of a polyline from arc length s0 to s1 (cum is its running length)
    function slice(pts, cum, s0, s1) {
        const at = s => {
            let i = 0;
            while (i + 2 < cum.length && cum[i + 1] < s) i++;
            return geo.lerpPt(pts[i], pts[i + 1], geo.clamp((s - cum[i]) / (cum[i + 1] - cum[i] || 1), 0, 1));
        };
        const out = [at(s0)];
        for (let i = 1; i + 1 < pts.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
        out.push(at(s1));
        return out;
    }

    const runLength = pts => {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        return cum;
    };

    // A polyline cut into dashes `on` long with `off` gaps (plan meters)
    function dashes(pts, on, off, phase = 0) {
        const cum = runLength(pts), L = cum[cum.length - 1], per = on + Math.max(0, off), out = [];
        if (!(on > 0) || !(L > 0)) return out;
        for (let s = -(((phase % per) + per) % per); s < L; s += per) {
            const a = Math.max(0, s), b = Math.min(L, s + on);
            if (b - a > 1e-6) out.push(slice(pts, cum, a, b));
        }
        return out;
    }

    // ------------------------------------------------------------------
    // The lie of the land
    // ------------------------------------------------------------------

    // Rolling hills, a valley for the creek, a level yard for the farm and a
    // hollow for the pond
    function landscape(T, plan, rng) {
        const { G } = T, N = PG.makeNoise(rng);
        const relief = plan.relief, f = 1 / plan.hillScale;
        const { ang, k: sk } = plan.stretch, ca = Math.cos(ang), sa = Math.sin(ang);
        G.each((v, x, y) => {
            const a = (x * ca + y * sa) * f, b = (y * ca - x * sa) * f * sk;
            G.h[v] = relief * (0.5 + 0.6 * N.fbm2(a, b, 3, 2, 0.4));
        });
        if (plan.hill) {
            // a rise for the farm to stand on
            const { x, y, r, h } = plan.hill;
            G.each((v, px, py) => { G.h[v] += h * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (r * r)); });
        }
        if (plan.dike) {
            // the dikes' banks, and the river bed sloping down beyond the near one's foot and back up to the far one
            const { y: yd, h, crest, run, river, far } = plan.dike;
            G.each((v, x, y) => {
                G.h[v] = G.h[v] * 0.3 + h * (1 - smooth(crest, crest + run, Math.min(Math.abs(y - yd), Math.abs(y - far))));
                G.h[v] -= 2.2 * Math.min(smooth(river[0] - 3, river[0] + 3, y), 1 - smooth(river[1] - 3, river[1] + 3, y));
            });
        }
        const creek = plan.creek;
        if (creek) {
            G.each((v, x, y) => {
                const d = distToPath(creek.pts, x, y);
                G.h[v] -= creek.depth * (1 - smooth(0, creek.width, d)) + 0.8 * (1 - smooth(creek.hw * 0.5, creek.hw + 1, d));
            });
        }
        for (const lot of [plan.lot, ...(plan.holdings || [])]) {
            // Level each yard, with a wider blend round the main farm.
            let z = 0, n = 0;
            G.each((v, x, y) => { if (polyDist(lot.poly, x, y) < 0) { z += G.h[v]; n++; } });
            z = n ? z / n : 0;
            G.each((v, x, y) => { G.h[v] = geo.lerp(G.h[v], z, 1 - smooth(-2, lot === plan.lot ? 30 : 12, polyDist(lot.poly, x, y))); });
            lot.z = z;
        }
        const pond = plan.pond;
        if (pond) {
            // the water stands a little under the lowest point of its rim, and
            // the banks rise from it, so the shore is where the rim is
            G.split();
            const rim = pond.rim;
            let z = Infinity;
            for (const [x, y] of rim) z = Math.min(z, G.at(x, y));
            pond.z = z - 0.3;
            G.each((v, x, y) => {
                const d = polyDist(rim, x, y);
                if (d < 0) G.h[v] = Math.min(G.h[v], pond.z - 0.4 + 0.1 * d);
                else if (d < 8) G.h[v] = Math.min(G.h[v], pond.z + 0.35 * d);
            });
        }
        G.split();
    }

    // Faces for the ground and its outline where it turns away from us
    function drawGround(T) {
        const { S, G, cam } = T, { nx, ny } = G;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                for (const tri of G.tris(i, j)) {
                    const P = tri.map(v => G.pt(v));
                    S.face(P, false);
                }
            }
        }
        // the outline, where the ground turns from facing us to facing away
        const face = new Float64Array(G.h.length);
        for (let j = 0; j <= ny; j++) {
            for (let i = 0; i <= nx; i++) {
                const i0 = Math.max(0, i - 1), i1 = Math.min(nx, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny, j + 1);
                const a = (G.h[G.id(i1, j)] - G.h[G.id(i0, j)]) / ((i1 - i0) * G.dx), b = (G.h[G.id(i, j1)] - G.h[G.id(i, j0)]) / ((j1 - j0) * G.dy);
                const gx = a * G.u[0] - b * G.u[1], gy = a * G.u[1] + b * G.u[0];
                face[G.id(i, j)] = -(gx * cam.fx + gy * cam.fy) * cam.ce - cam.se;
            }
        }
        const segs = [];
        const cut = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                for (const tri of G.tris(i, j)) {
                    const f = tri.map(v => face[v]);
                    if (f.every(v => v < 0) || f.every(v => v >= 0)) continue;
                    const P = tri.map(v => G.pt(v)), e = [];
                    for (let q = 0; q < 3; q++) {
                        const a = q, b = (q + 1) % 3;
                        if ((f[a] >= 0) !== (f[b] >= 0)) e.push(cut(P[a], P[b], f[a], f[b]));
                    }
                    if (e.length === 2) segs.push(e);
                }
            }
        }
        const toCam = [-cam.fx * cam.ce * 0.25, -cam.fy * cam.ce * 0.25, cam.se * 0.25];
        S.kind = INK;
        for (const [a, b] of segs) S.line([a, b].map(q => [q[0] + toCam[0], q[1] + toCam[1], q[2] + toCam[2]]));
    }

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

    // Where the ground passes through height `level`, as polylines, in the
    // triangles that `ok` allows
    function contour(T, level, ok) {
        const { G } = T, segs = [];
        const cut = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level]; };
        for (let j = 0; j < G.ny; j++) {
            for (let i = 0; i < G.nx; i++) {
                for (const tri of G.tris(i, j)) {
                    const f = tri.map(v => G.h[v] - level);
                    if (f.every(v => v < 0) || f.every(v => v >= 0)) continue;
                    const P = tri.map(v => G.pt(v));
                    if (!ok(P[0][0], P[0][1])) continue;
                    const e = [];
                    for (let q = 0; q < 3; q++) {
                        const a = q, b = (q + 1) % 3;
                        if ((f[a] >= 0) !== (f[b] >= 0)) e.push({ c: cut(P[a], P[b], f[a], f[b]), key: Math.min(tri[a], tri[b]) * 1e6 + Math.max(tri[a], tri[b]) });
                    }
                    if (e.length === 2) segs.push(e);
                }
            }
        }
        return stitch(segs);
    }

    // Shade the slopes turned from the sun on grass (where ok says), with
    // level lines like Alpine Valley's mountains. Darker slopes keep more of
    // the levels, so the gap between them on paper suits the tone there.
    function hillShade(T, ok) {
        const { S, G, cam } = T, { nx, ny } = G, dz = 0.25, h = G.h;
        const cut = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
        const levels = new Map();
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                for (const tri of G.tris(i, j)) {
                    const P = tri.map(v => G.pt(v));
                    const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
                    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
                    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
                    const tone = T.tone(n);
                    if (tone < 0.12) continue;
                    const mx = (P[0][0] + P[1][0] + P[2][0]) / 3, my = (P[0][1] + P[1][1] + P[2][1]) / 3;
                    if (!ok(mx, my) && !P.some(q => ok(q[0], q[1]))) continue;
                    const R = P.map(c => cam.project(c[0], c[1], c[2]));
                    const det = (R[1][0] - R[0][0]) * (R[2][1] - R[0][1]) - (R[2][0] - R[0][0]) * (R[1][1] - R[0][1]);
                    if (Math.abs(det) < 1e-9) continue;
                    const a = ((P[1][2] - P[0][2]) * (R[2][1] - R[0][1]) - (P[2][2] - P[0][2]) * (R[1][1] - R[0][1])) / det;
                    const b = ((P[2][2] - P[0][2]) * (R[1][0] - R[0][0]) - (P[1][2] - P[0][2]) * (R[2][0] - R[0][0])) / det;
                    const grad = Math.hypot(a, b), want = T.p.hillGap / tone ** 1.4;
                    let m = 1;
                    while (m <= 64 && (m * dz) / grad < want) m *= 2;
                    if (m > 64) continue;
                    const zs = tri.map(v => h[v]), lo = Math.min(...zs), hi = Math.max(...zs);
                    for (let L = Math.ceil(lo / (m * dz)) * m; L * dz < hi; L += m) {
                        const e = [];
                        for (let q = 0; q < 3; q++) {
                            const s = q, t = (q + 1) % 3, fa = zs[s] - L * dz, fb = zs[t] - L * dz;
                            if ((fa >= 0) !== (fb >= 0)) e.push({ c: cut(P[s], P[t], fa, fb), key: Math.min(tri[s], tri[t]) * 1e6 + Math.max(tri[s], tri[t]) });
                        }
                        if (e.length !== 2) continue;
                        let arr = levels.get(L);
                        if (!arr) levels.set(L, (arr = []));
                        arr.push(e);
                    }
                }
            }
        }
        // Hachures: short strokes straight down the slope, set out along each
        // level line. Whole level lines in blue looked like streams.
        S.kind = SHADOW;
        const gap = T.p.hillGap * 0.9, len = T.p.hillGap * 0.75;
        for (const segs of levels.values()) {
            for (const line of stitch(segs)) {
                const cum = runLength(line), L = cum[cum.length - 1];
                if (L * T.k < 2) continue;
                let i = 0;
                for (let s = (L * 0.37) % (gap / T.k); s < L; ) {
                    while (i + 2 < cum.length && cum[i + 1] < s) i++;
                    const a = line[i], b = line[i + 1], t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
                    const x = geo.lerp(a[0], b[0], t), y = geo.lerp(a[1], b[1], t);
                    // downhill, from the ground's slope here
                    const e = G.dx, gx = G.at(x + e, y) - G.at(x - e, y), gy = G.at(x, y + e) - G.at(x, y - e), gl = Math.hypot(gx, gy) || 1;
                    const dx = -gx / gl, dy = -gy / gl, sp = onPaper(T, dx, dy);
                    s += gap / Math.max(0.3, onPaper(T, (b[0] - a[0]) / (cum[i + 1] - cum[i] || 1), (b[1] - a[1]) / (cum[i + 1] - cum[i] || 1)));
                    if (sp < 0.2 || !ok(x, y)) continue;
                    const l = len / sp, q = [x + dx * l, y + dy * l];
                    if (!ok(q[0], q[1])) continue;
                    S.line([[x, y, G.at(x, y) + 0.06], [(x + q[0]) / 2, (y + q[1]) / 2, G.at((x + q[0]) / 2, (y + q[1]) / 2) + 0.06], [q[0], q[1], G.at(q[0], q[1]) + 0.06]], true);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Shadows. Faces and solids cast onto the ground along the sun, and the
    // shadows are hatched together at the end, laid over the ground.
    // ------------------------------------------------------------------

    function castOnGround(T) {
        const { S, G } = T, [sx, sy] = T.sun;
        S.sun = T.sun;
        S.shadow = { polys: [] };
        S.castShadow = function (pts) {
            if (!T.casting) return;
            const q = pts.map(([x, y, z]) => {
                let qx = x, qy = y;
                const cap = Math.max(0, z - G.at(x, y)) + 0.5;
                for (let i = 0; i < 4; i++) {
                    const h = geo.clamp(z - G.at(qx, qy), 0, cap);
                    qx = x + sx * h;
                    qy = y + sy * h;
                }
                return [qx, qy];
            });
            const s = hull(q);
            if (s.length >= 3 && Math.abs(geo.polygonArea(s)) > 0.05) T.shadows.push(s);
        };
    }

    // Fill the shadows with lines across the page, merging any that overlap
    function hatchShadows(T, gap) {
        const { S, cam } = T;
        const polys0 = T.shadows;
        if (!polys0.length) return;
        // hatch lines run level across the page, along the camera's right
        const ca = cam.rx, sa = cam.ry, spacing = gap / (cam.k * cam.se);
        const polys = polys0.map(P => {
            const Q = P.map(p => [p[0] * ca + p[1] * sa, p[1] * ca - p[0] * sa]);
            let lo = Infinity, hi = -Infinity;
            for (const p of Q) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
            return { Q, lo, hi };
        }).sort((a, b) => a.lo - b.lo);
        const back = (u, v) => [u * ca - v * sa, u * sa + v * ca];
        let y0 = Infinity, y1 = -Infinity;
        for (const P of polys) { if (P.lo < y0) y0 = P.lo; if (P.hi > y1) y1 = P.hi; }
        let next = 0, live = [];
        S.kind = SHADOW;
        const ok = (x, y) => !T.wet(x, y);
        for (let j = Math.ceil(y0 / spacing); j * spacing <= y1; j++) {
            const y = j * spacing, iv = [];
            while (next < polys.length && polys[next].lo <= y) live.push(polys[next++]);
            live = live.filter(P => P.hi >= y);
            for (const { Q: P } of live) {
                let lo = Infinity, hi = -Infinity;
                for (let i = 0, n = P.length; i < n; i++) {
                    const a = P[i], b = P[(i + 1) % n];
                    if ((a[1] > y) !== (b[1] > y)) {
                        const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
                        if (x < lo) lo = x;
                        if (x > hi) hi = x;
                    }
                }
                if (hi > lo) iv.push([lo, hi]);
            }
            iv.sort((u, v) => u[0] - v[0]);
            let run = null;
            const emit = () => lay(T, [back(run[0], y), back(run[1], y)], 0.12, ok);
            for (const r of iv) {
                if (run && r[0] <= run[1]) run[1] = Math.max(run[1], r[1]);
                else { if (run) emit(); run = r.slice(); }
            }
            if (run) emit();
        }
    }

    // ------------------------------------------------------------------
    // Plans. Each country lays out its roads, lot and fields in its own way.
    // ------------------------------------------------------------------

    // Spans about `size` long from lo to hi, stopping either side of each gap
    // ([a, b] pairs, a === b for a plain edge)
    function spans(lo, hi, size, gaps, rng) {
        const edges = [[lo, lo], ...gaps.slice().sort((u, v) => u[0] - v[0]), [hi, hi]], out = [];
        for (let i = 0; i + 1 < edges.length; i++) {
            const s0 = edges[i][1], s1 = edges[i + 1][0], L = s1 - s0;
            if (L < 4) continue;
            const n = Math.max(1, Math.round(L / size)), cuts = [s0];
            for (let k = 1; k < n; k++) cuts.push(s0 + (L * (k + rng.range(-0.15, 0.15))) / n);
            cuts.push(s1);
            for (let k = 0; k + 1 < cuts.length; k++) out.push([cuts[k], cuts[k + 1]]);
        }
        return out;
    }

    // A creek wandering across the page, kept clear of the lot
    function planCreek(T, plan, rng) {
        const { P, p } = T;
        if (!p.creek) return null;
        const lot = plan.lot.poly;
        for (let attempt = 0; attempt < 12; attempt++) {
            const pts = [];
            const v0 = rng.range(-0.05, 0.95) * P.V, v1 = rng.range(0.05, 1.05) * P.V, ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
            const amp = rng.range(10, 22);
            for (let t = -0.15; t <= 1.15; t += 0.008) {
                const u = t * P.U, v = geo.lerp(v0, v1, t) + amp * Math.sin(t * 8 + ph) + amp * 0.4 * Math.sin(t * 21 + ph2);
                pts.push(P.w(u, v));
            }
            if (pts.some(([x, y]) => polyDist(lot, x, y) < 30)) continue;
            return { pts, hw: rng.range(2.4, 3.6), depth: plan.relief * 0.35 + 1.5, width: rng.range(45, 70) };
        }
        return null;
    }

    // Prairie: section roads on a grid, big square fields, the farm lot on
    // the corner of one of them
    function planPrairie(T, rng) {
        const { P, p } = T;
        const plan = {
            country: 'prairie', relief: 13 * p.hills, hillScale: rng.range(150, 220),
            stretch: { ang: rng.range(0, TAU), k: rng.range(1, 1.8) }, roads: [], fields: [],
        };
        const fw = 120 * p.fieldSize;
        const [cx, cy] = P.w(P.U * rng.range(0.42, 0.58), P.V * rng.range(0.42, 0.55));
        const LW = rng.range(92, 102), LD = rng.range(84, 92);
        const lot = [cx - LW / 2, cy - LD / 2, cx + LW / 2, cy + LD / 2];
        plan.lot = { rect: lot, poly: rectPoly(lot), F: frame(cx, cy, 0, 0), W: LW, D: LD };
        const rw = 9;
        const ry = lot[1] - rw / 2, side = rng.sign();
        const rx = side > 0 ? lot[2] + rw / 2 + fw * rng.range(0.7, 1.3) : lot[0] - rw / 2 - fw * rng.range(0.7, 1.3);
        const ext = 60;
        plan.roads.push({ pts: [[P.x0 - ext, ry], [P.x1 + ext, ry]], hw: 3.6, kind: 'gravel', poles: true });
        plan.roads.push({ pts: [[rx, P.y0 - ext], [rx, P.y1 + ext]], hw: 3.6, kind: 'gravel' });
        // the drive comes in off the road a little to one side of the middle
        plan.mirror = rng.sign();
        const du = rng.range(0, 8), dx = cx + du * plan.mirror;
        plan.drive = { u: du, pts: [[dx, ry + 3.6], [dx, lot[1] + 22]], hw: 2.4 };
        const xs = spans(P.x0 - fw, P.x1 + fw, fw, [[lot[0], lot[0]], [lot[2], lot[2]], [rx - rw / 2, rx + rw / 2]], rng);
        const ys = spans(P.y0 - fw, P.y1 + fw, fw * rng.range(0.85, 1.1), [[ry - rw / 2, ry + rw / 2], [lot[3], lot[3]]], rng);
        for (const [x0, x1] of xs) {
            for (const [y0, y1] of ys) {
                if (Math.abs(x0 - lot[0]) < 0.1 && Math.abs(y0 - lot[1]) < 0.1) continue;
                const w = x1 - x0, d = y1 - y0;
                // some fields are split in two along their length
                if (Math.max(w, d) > fw * 0.9 && rng.chance(0.45)) {
                    const t = rng.range(0.4, 0.6);
                    if (w > d) { const xm = geo.lerp(x0, x1, t); plan.fields.push({ poly: rectPoly([x0, y0, xm, y1]) }, { poly: rectPoly([xm, y0, x1, y1]) }); }
                    else { const ym = geo.lerp(y0, y1, t); plan.fields.push({ poly: rectPoly([x0, y0, x1, ym]) }, { poly: rectPoly([x0, ym, x1, y1]) }); }
                } else plan.fields.push({ poly: rectPoly([x0, y0, x1, y1]) });
            }
        }
        plan.creek = planCreek(T, plan, rng);
        return plan;
    }

    // Voronoi cells of the points, cut to the box [x0, y0, x1, y1], as convex polygons
    function voronoi(pts, box) {
        return pts.map(([px, py], i) => {
            let poly = rectPoly(box);
            const others = [];
            pts.forEach((q, j) => { if (j !== i) others.push([j, (q[0] - px) ** 2 + (q[1] - py) ** 2]); });
            others.sort((a, b) => a[1] - b[1]);
            for (const [j, d2] of others) {
                // a point more than twice as far as the cell's farthest corner can't cut it
                let far = 0;
                for (const c of poly) far = Math.max(far, (c[0] - px) ** 2 + (c[1] - py) ** 2);
                if (d2 > 4 * far) break;
                const q = pts[j];
                poly = geo.clipPolygonHalfPlane(poly, [(px + q[0]) / 2, (py + q[1]) / 2], [px - q[0], py - q[1]]);
                if (poly.length < 3) break;
            }
            return poly;
        });
    }

    // Points on a jittered grid `gap` apart, turned to angle `ang`, covering the box
    function jitterGrid(box, gap, ang, jitter, rng) {
        const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + gap;
        const c = Math.cos(ang), s = Math.sin(ang), out = [];
        for (let a = -R; a <= R; a += gap) {
            for (let b = -R; b <= R; b += gap * 0.9) {
                const u = a + rng.range(-jitter, jitter) * gap, v = b + rng.range(-jitter, jitter) * gap;
                const x = cx + u * c - v * s, y = cy + u * s + v * c;
                if (x > x0 - gap && x < x1 + gap && y > y0 - gap && y < y1 + gap) out.push([x, y]);
            }
        }
        return out;
    }

    // Unique edges of a set of cells, each with the two cells it lies between
    function cellEdges(cells) {
        const map = new Map(), key = q => `${Math.round(q[0] * 2)},${Math.round(q[1] * 2)}`;
        cells.forEach((poly, ci) => {
            for (let i = 0; i < poly.length; i++) {
                const a = poly[i], b = poly[(i + 1) % poly.length];
                if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
                const k = key([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
                const e = map.get(k);
                if (e) e.cells.push(ci);
                else map.set(k, { a, b, cells: [ci] });
            }
        });
        return [...map.values()];
    }

    // An angle for the lot so its front faces us, turned 25 to 60 degrees off square
    function frontAngle(T, rng) {
        const toward = Math.atan2(-T.cam.fy, -T.cam.fx), front = toward + rng.sign() * rng.range(geo.rad(25), geo.rad(55));
        return front + Math.PI / 2;
    }

    // A rotated rectangular lot with its frame, front (-v) facing us
    function makeLot(T, cx, cy, W, D, ang) {
        const F = turned(cx, cy, 0, ang);
        return { F, ang, W, D, poly: [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([a, b]) => F.P(a, b, 0).slice(0, 2)) };
    }

    // A path across the page in plan (u, v) meters, wandering about v0
    function wander(T, v0, amp, rng, t0 = -0.15, t1 = 1.15) {
        const { P } = T, ph = rng.range(0, TAU), ph2 = rng.range(0, TAU), tilt = rng.range(-0.25, 0.25) * P.V, out = [];
        for (let t = t0; t <= t1 + 1e-9; t += 0.01) {
            out.push(P.w(t * P.U, v0 + tilt * (t - 0.5) + amp * Math.sin(t * 5.5 + ph) + amp * 0.35 * Math.sin(t * 13 + ph2)));
        }
        return out;
    }

    // Hedgerows: a winding lane, small fields of all shapes with hedges
    // round them and trees standing in the hedges, the farm round its yard
    function planHedgerows(T, rng) {
        const { P, p } = T;
        const plan = {
            country: 'hedgerows', relief: 20 * p.hills, hillScale: rng.range(120, 170),
            stretch: { ang: rng.range(0, TAU), k: rng.range(1, 1.4) }, roads: [], fields: [],
        };
        const [cx, cy] = P.w(P.U * rng.range(0.4, 0.6), P.V * rng.range(0.45, 0.58));
        const W = rng.range(70, 80), D = rng.range(60, 68);
        plan.lot = makeLot(T, cx, cy, W, D, frontAngle(T, rng));
        // the lane runs across in front of the farm, clear of the lot
        const [, vc] = P.uv(cx, cy);
        let lane;
        for (let k = 0; k < 10; k++) {
            lane = wander(T, vc - D * 0.75 - 14 - k * 6, rng.range(10, 22), rng);
            if (lane.every(([x, y]) => polyDist(plan.lot.poly, x, y) > 9)) break;
        }
        plan.roads.push({ pts: lane, hw: 2.4, kind: 'lane', hedged: true });
        // the farm track from the lane to the gate in the front of the lot
        const gate = plan.lot.F.P(rng.range(-0.15, 0.2) * W, -D / 2, 0).slice(0, 2);
        let best = lane[0];
        for (const q of lane) if (Math.hypot(q[0] - gate[0], q[1] - gate[1]) < Math.hypot(best[0] - gate[0], best[1] - gate[1])) best = q;
        plan.drive = { pts: [best, gate], hw: 1.8, gate };
        const box = [P.x0 - 40, P.y0 - 40, P.x1 + 40, P.y1 + 40];
        const cells = voronoi(jitterGrid(box, 58 * p.fieldSize, rng.range(0, TAU), 0.32, rng), box);
        plan.fields = cells.filter(poly => poly.length >= 3).map(poly => ({ poly }));
        plan.edges = cellEdges(cells);
        plan.creek = planCreek(T, plan, rng);
        return plan;
    }

    // A smooth path through the given points (plan), corners cut a few times
    function smoothPath(pts, iterations = 4) {
        return geo.chaikin(pts, iterations, false);
    }

    // Tuscan hills: big rolling fields with no hedges, the farm up on a
    // hilltop at the end of a white road lined with cypresses, a chapel on
    // the road and pines and cypresses dotted about
    function planTuscan(T, rng) {
        const { P, p } = T;
        const relief = 30 * p.hills;
        const plan = {
            country: 'tuscan', relief, hillScale: rng.range(140, 190),
            stretch: { ang: rng.range(0, TAU), k: rng.range(1, 1.5) }, roads: [], fields: [],
        };
        const [cx, cy] = P.w(P.U * rng.range(0.42, 0.58), P.V * rng.range(0.52, 0.64));
        const W = rng.range(78, 84), D = rng.range(70, 76);
        plan.lot = makeLot(T, cx, cy, W, D, frontAngle(T, rng));
        plan.hill = { x: cx, y: cy, r: rng.range(70, 95), h: relief * 0.7 + 3 };
        // the white road climbs from the bottom of the page in a long S to the farm's gate
        const gate = plan.lot.F.P(0, -D / 2, 0).slice(0, 2);
        const [gu, gv] = P.uv(...gate), side = rng.sign();
        const ctrl = [P.w(gu + side * P.U * rng.range(0.25, 0.4), -30), P.w(gu + side * P.U * 0.3, gv * 0.3), P.w(gu - side * P.U * 0.25, gv * 0.62), P.w(gu - side * 12, gv - 22), gate];
        const road = smoothPath(ctrl, 5);
        plan.roads.push({ pts: road, hw: 2.2, kind: 'white', cypress: true });
        plan.drive = null;
        plan.gate = gate;
        const box = [P.x0 - 40, P.y0 - 40, P.x1 + 40, P.y1 + 40];
        const cells = voronoi(jitterGrid(box, 88 * p.fieldSize, rng.range(0, TAU), 0.3, rng), box);
        plan.fields = cells.filter(poly => poly.length >= 3).map(poly => ({ poly }));
        // the chapel stands where the road bends, on the outside of the curve
        const mid = road[Math.floor(road.length * rng.range(0.3, 0.5))];
        plan.chapel = { x: mid[0], y: mid[1] };
        plan.creek = planCreek(T, plan, rng);
        return plan;
    }

    // Separate working yards give the lane somewhere else to go. Reserve them
    // before shaping the ground so crops, water and trees respect their plots.
    function planHoldings(T, plan, rng) {
        plan.holdings = [];
        if (!T.p.holdings) return;
        const { P } = T, roads = plan.roads.slice(), want = Math.max(1, Math.floor(P.area / 1.09));
        const nearest = (q, paths) => {
            let best = null, distance = Infinity;
            for (const r of paths) for (let i = 0; i + 1 < r.pts.length; i++) {
                const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
                const t = geo.clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
                const p = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                if (d < distance) { best = p; distance = d; }
            }
            return best;
        };
        for (let n = 0; n < want; n++) {
            const candidates = [];
            for (let v = 0.16; v <= 0.88; v += 0.09) for (let u = 0.2; u <= 0.81; u += 0.1) {
                const [x, y] = P.w(P.U * (u + rng.range(-0.025, 0.025)), P.V * v);
                const near = nearest([x, y], roads);
                if (!near) continue;
                const ang = Math.atan2(near[1] - y, near[0] - x) + Math.PI / 2;
                const lot = makeLot(T, x, y, plan.country === 'prairie' ? 54 : 48, 42, ang);
                const samples = [lot.F.P(0, 0, 0), ...lot.poly];
                if (!samples.every(q => P.seen(q[0], q[1], 0, 7) && P.seen(q[0], q[1], 18, 3))) continue;
                const occupied = [plan.lot, ...plan.holdings];
                if (occupied.some(o => pathNearPoly(o.poly.concat([o.poly[0]]), lot.poly, 18))) continue;
                if (roads.some(r => pathNearPoly(r.pts, lot.poly, r.hw + 5))) continue;
                if (plan.creek && pathNearPoly(plan.creek.pts, lot.poly, plan.creek.hw + 10)) continue;
                if (plan.dike && samples.some(q => q[1] > plan.dike.y - 15)) continue;
                if (plan.mill && polyDist(lot.poly, plan.mill.x, plan.mill.y) < 15) continue;
                const gate = lot.F.P(0, -lot.D / 2, 0).slice(0, 2), from = nearest(gate, roads);
                const route = [from, gate];
                if (occupied.some(o => pathNearPoly(route, o.poly, 6))) continue;
                if (plan.creek && (crossing(route, plan.creek.pts) || plan.creek.pts.some(q => distToPath(route, ...q) < plan.creek.hw + 4))) continue;
                const length = Math.hypot(from[0] - gate[0], from[1] - gate[1]);
                if (length > P.U * 0.7) continue;
                lot.drive = { pts: [from, gate], hw: 1.7, kind: 'gravel' };
                lot.variant = n;
                const front = lot.F.V(0, -1, 0), facing = -front[0] * T.cam.fx - front[1] * T.cam.fy;
                // From the third yard on, keep them apart so they don't line up along one road
                const apart = n < 2 ? 0 : Math.max(0, 120 - Math.min(...plan.holdings.map(o => Math.hypot(o.F.P(0, 0, 0)[0] - x, o.F.P(0, 0, 0)[1] - y)))) * 0.4;
                candidates.push({ lot, score: length * 0.25 + Math.abs(u - 0.5) * 12 - facing * 12 + rng.range(0, 8) + apart });
            }
            candidates.sort((a, b) => a.score - b.score);
            if (!candidates.length) break;
            const lot = candidates[0].lot;
            plan.holdings.push(lot);
            plan.roads.push(lot.drive);
        }
        if (plan.ditches) for (const lot of plan.holdings) {
            // Drainage goes round the nursery, with a bridge at its entrance.
            const [x, y] = lot.F.P(0, 0, 0), u = lot.F.V(1, 0, 0), v = lot.F.V(0, 1, 0), W = lot.W + 4, D = lot.D + 4;
            const local = p => [(p[0] - x) * u[0] + (p[1] - y) * u[1] + W / 2, (p[0] - x) * v[0] + (p[1] - y) * v[1] + D / 2];
            plan.ditches = plan.ditches.flatMap(([a, b]) => {
                const clip = clipSeg(local(a), local(b), W, D);
                if (!clip) return [[a, b]];
                const [p, q] = clip.map(c => lot.F.P(c[0] - W / 2, c[1] - D / 2, 0).slice(0, 2)), pieces = [];
                if (Math.hypot(p[0] - a[0], p[1] - a[1]) > 0.1) pieces.push([a, p]);
                if (Math.hypot(b[0] - q[0], b[1] - q[1]) > 0.1) pieces.push([q, b]);
                return pieces;
            });
            const rim = rectPoly([-W / 2, -D / 2, W / 2, D / 2]).map(q => lot.F.P(...q, 0).slice(0, 2));
            for (let i = 0; i < 4; i++) plan.ditches.push([rim[i], rim[(i + 1) % 4]]);
        }
    }

    // Polder: level ground drained by ditches, long strips of field running
    // back from a straight road to the dike, a river behind the dike and a
    // mill at the end of the main ditch
    function planPolder(T, rng) {
        const { P, p } = T;
        const plan = {
            country: 'polder', relief: 0.5, hillScale: 200, stretch: { ang: 0, k: 1 }, roads: [], fields: [], ditches: [],
        };
        const [cx, cy] = P.w(P.U * rng.range(0.4, 0.6), P.V * rng.range(0.38, 0.48));
        const sw = 30 * p.fieldSize, W = 2 * sw, D = rng.range(52, 60);
        const rw = 6, ry = cy - D / 2 - rw / 2 - 3.5;
        const lot = [cx - W / 2, cy - D / 2, cx + W / 2, cy + D / 2];
        plan.lot = { rect: lot, poly: rectPoly(lot), F: frame(cx, cy, 0, 0), W, D };
        const ext = 60;
        plan.roads.push({ pts: [[P.x0 - ext, ry], [P.x1 + ext, ry]], hw: 2.6, kind: 'paved', poplars: true });
        // the dike runs along behind the farm, the river beyond it and another dike on the far bank
        const yd = cy + D / 2 + rng.range(70, 130), r1 = yd + 14 + rng.range(55, 80);
        plan.dike = { y: yd, h: 3.6, crest: 2.8, run: 9.5, river: [yd + 14, r1], far: r1 + 14 };
        plan.drive = { pts: [[cx + rng.range(-0.3, 0.3) * W, ry + 2.6], [cx, cy - D / 2 + 12]], hw: 1.8 };
        plan.drive.pts[1][0] = plan.drive.pts[0][0];
        // strips of field between ditches, back from the road to the dike and down from it to the page's edge
        const xs = [];
        for (let x = lot[0]; x > P.x0 - 2 * sw; x -= sw * rng.range(0.8, 1.2)) xs.push(x);
        for (let x = lot[2]; x < P.x1 + 2 * sw; x += sw * rng.range(0.8, 1.2)) xs.push(x);
        xs.push(cx);
        xs.sort((a, b) => a - b);
        const bands = [[ry + rw / 2 + 3, yd - 12 - 3]];
        let y = ry - rw / 2 - 3;
        while (y > P.y0 - 60) { const y1 = y - rng.range(140, 220); bands.push([y1, y]); y = y1 - 6; }
        const strips = (y0, y1, far) => {
            for (let i = 0; i + 1 < xs.length; i++) {
                const r = [xs[i] + 1.4, y0, xs[i + 1] - 1.4, y1];
                if (r[0] >= lot[0] - 0.1 && r[2] <= lot[2] + 0.1 && y0 < lot[3] && y1 > lot[1]) {
                    // the strips behind the lot run on to the dike
                    if (y1 > lot[3] + 20) plan.fields.push({ poly: rectPoly([r[0], lot[3] + 3, r[2], y1]) });
                    continue;
                }
                plan.fields.push({ poly: rectPoly(r), far });
            }
            for (const x of xs) plan.ditches.push([[x, y0 - 1.5], [x, y1 + 1.5]]);
            plan.ditches.push([[P.x0 - ext, y0 - 1.5], [P.x1 + ext, y0 - 1.5]]);
        };
        for (const [y0, y1] of bands) strips(y0, y1, false);
        // the mill stands at the dike end of a ditch near the middle of the page
        const near = xs.filter(x => Math.abs(x - cx) > W / 2 + 10 && P.seen(x, yd - 16, 0, 25));
        const mx = near.length ? rng.pick(near) : cx + W;
        plan.mill = { x: mx, y: yd - 17 };
        // More strips past the far dike, which is in view when the river's narrow or the
        // camera's high. Laid last so they don't move anything else on a given seed.
        for (let y = plan.dike.far + 12 + 3; y < P.y1 + 60;) { const y1 = y + rng.range(140, 220); strips(y, y1, true); y = y1 + 3; }
        plan.creek = null;
        return plan;
    }

    // ------------------------------------------------------------------
    // Hedges, gates and trellises
    // ------------------------------------------------------------------

    // One bushy lump of hedge: a round cut-out a bit wider than tall
    function bush(T, x, y, r, rng) {
        const S = T.S, ce = T.cam.ce, z = T.G.at(x, y) - 0.2, flat = 0.78, cz = (r * flat) / ce;
        const P = card(T, x, y, z, 0), n = 14, ph = rng.range(0, TAU), pts = [];
        for (let i = 0; i < n; i++) {
            const a = (TAU * i) / n, b = 1 + 0.07 * Math.sin(a * 4 + ph);
            pts.push(P(Math.cos(a) * r * b, cz + (Math.sin(a) * r * flat * b) / ce));
        }
        S.face(pts);
        S.loop(pts);
    }

    // A hedge laid along a polyline, its lumps spaced so they show on paper,
    // with an oak standing in it every so often. ok(x, y) says where it can grow.
    function hedge(T, pts, rng, ok, claims, oaks = true) {
        const cum = runLength(pts), L = cum[cum.length - 1];
        if (L < 2) return;
        const spots = [];
        let nextOak = rng.range(10, 40), s = 0.8, i = 0;
        while (s < L) {
            while (i + 2 < cum.length && cum[i + 1] < s) i++;
            const a = pts[i], b = pts[i + 1], l = cum[i + 1] - cum[i] || 1, t = (s - cum[i]) / l;
            const x = geo.lerp(a[0], b[0], t), y = geo.lerp(a[1], b[1], t), d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
            const step = Math.max(1.6, 1.2 / Math.max(0.05, onPaper(T, d[0], d[1])));
            if (ok(x, y) && T.P.seen(x, y, 0, -6)) {
                if (oaks && s > nextOak && rng.chance(0.25 + 0.6 * T.p.trees) && claims.free(x, y, 4)) {
                    claims.take(x, y, 4);
                    spots.push([x, y, 'oak']);
                    nextOak = s + rng.range(25, 60);
                } else spots.push([x, y, 'bush']);
            }
            s += step * rng.range(0.85, 1.15);
        }
        spots.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        T.S.kind = GREEN;
        for (const [x, y, kind] of spots) {
            if (kind === 'oak') tree(T, x, y, T.G.at(x, y) - 0.2, rng);
            else bush(T, x, y, rng.range(1.15, 1.45), rng);
        }
        T.S.kind = INK;
    }

    // Hedges along every field edge, both sides of the lane and round the
    // lot, with a gate into some of the fields
    function hedgerows(T, plan, rng, claims) {
        const lane = plan.roads[0], creek = plan.creek, lot = plan.lot.poly, drive = plan.drive;
        const outlying = (x, y) => plan.holdings.every(o => polyDist(o.poly, x, y) > 2 && distToPath(o.drive.pts, x, y) > o.drive.hw + 2);
        const ok = (x, y) => distToPath(lane.pts, x, y) > lane.hw + 1.2 && polyDist(lot, x, y) > 1.6
            && (!creek || distToPath(creek.pts, x, y) > creek.hw + 2.2) && distToPath(drive.pts, x, y) > drive.hw + 1.2 && !T.wet(x, y)
            && (!plan.pond || polyDist(plan.pond.rim, x, y) > 4) && outlying(x, y) && !(plan.bridge && Math.hypot(x - plan.bridge.x, y - plan.bridge.y) < plan.bridge.r);
        T.casting = true;
        for (const e of plan.edges) {
            const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
            if (!T.P.seen(mid[0], mid[1], 0, -60)) continue;
            const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
            if (L > 14 && rng.chance(0.3)) {
                // a gap with a five-bar gate in it
                const t0 = rng.range(0.2, 0.7), t1 = t0 + 4 / L, g0 = geo.lerpPt(e.a, e.b, t0), g1 = geo.lerpPt(e.a, e.b, t1);
                hedge(T, [e.a, g0], rng, ok, claims);
                hedge(T, [g1, e.b], rng, ok, claims);
                if (ok(...g0) && ok(...g1) && T.P.seen(g0[0], g0[1], 0, 2)) fieldGate(T, g0, g1, rng.chance(0.3));
            } else hedge(T, [e.a, e.b], rng, ok, claims);
        }
        const along = (x, y) => polyDist(lot, x, y) > 1.6 && (!creek || distToPath(creek.pts, x, y) > creek.hw + 1.5) && distToPath(drive.pts, x, y) > drive.hw + 1
            && outlying(x, y) && !(plan.bridge && Math.hypot(x - plan.bridge.x, y - plan.bridge.y) < plan.bridge.r);
        for (const s of [-1, 1]) hedge(T, sidePath(lane.pts, s * (lane.hw + 1.4)), rng, along, claims);
        // round the lot, gapped for the gate
        const ring4 = lot.concat([lot[0]]).map(([x, y], i, arr) => [x, y]);
        const gap = (x, y) => Math.hypot(x - drive.gate[0], y - drive.gate[1]) > 3.5;
        hedge(T, ring4.map(([x, y]) => { const [cx, cy] = geo.centroid(lot); const l = Math.hypot(x - cx, y - cy); return [x + ((x - cx) / l) * 1.2, y + ((y - cy) / l) * 1.2]; }), rng, gap, claims, false);
        T.casting = false;
    }

    // Five-bar gate across a gap from a to b, standing open or shut
    function fieldGate(T, a, b, open) {
        const S = T.S, G = T.G, z = G.at(a[0], a[1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        if (open) d = [d[0] * 0.5 - d[1] * 0.87, d[1] * 0.5 + d[0] * 0.87];
        const at = (s, c) => [a[0] + d[0] * s, a[1] + d[1] * s, z + c];
        S.kind = SOIL;
        S.line([at(0, 0), at(0, 1.3)]);
        S.line([[b[0], b[1], G.at(b[0], b[1])], [b[0], b[1], G.at(b[0], b[1]) + 1.3]]);
        const w = L * 0.95;
        for (const c of [0.3, 0.6, 0.9, 1.2]) S.line([at(0, c), at(w, c)]);
        if (T.detail) S.line([at(0, 0.3), at(w, 1.2)]);
        S.line([at(w, 0.3), at(w, 1.2)]);
    }

    // Rows on wires: a run of posts with foliage between, h high, standing in
    // a row from a to b over the ground. The foliage hides what's behind it.
    function trellis(T, a, b, h, kind, ok, leafy = true) {
        const S = T.S, G = T.G, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 2) return;
        const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = Math.max(1, Math.ceil(L / Math.max(1.4, 1.6 / Math.max(0.05, onPaper(T, d[0], d[1])))));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const x = a[0] + (d[0] * L * i) / n, y = a[1] + (d[1] * L * i) / n;
            pts.push(ok(x, y) && T.P.seen(x, y, 0, -4) ? [x, y, G.at(x, y)] : null);
        }
        const post = Math.max(4, Math.round(9 / (L / n))), low = h * 0.45;
        let run = [];
        const flush = () => {
            if (run.length < 2) { run = []; return; }
            for (let i = 0; i + 1 < run.length; i++) {
                const p = run[i], q = run[i + 1];
                S.face([[p[0], p[1], p[2] + low], [q[0], q[1], q[2] + low], [q[0], q[1], q[2] + h], [p[0], p[1], p[2] + h]]);
            }
            S.kind = kind;
            // the leaves: a lumpy top and a looser line along their bottom, over the bare trunks
            const top = [], bottom = [];
            run.forEach((p, i) => {
                top.push([p[0], p[1], p[2] + h]);
                bottom.push([p[0], p[1], p[2] + low + (i % 2 ? 0.12 : 0)]);
                if (leafy && i + 1 < run.length) {
                    const q = run[i + 1];
                    for (const [t, lift] of [[0.33, 0.22], [0.66, 0.22]]) top.push([geo.lerp(p[0], q[0], t), geo.lerp(p[1], q[1], t), geo.lerp(p[2], q[2], t) + h + lift]);
                }
            });
            S.line(top);
            if (leafy) S.line(bottom);
            S.kind = INK;
            run.forEach((p, i) => { if (i % post === 0 || i === run.length - 1) S.line([[p[0], p[1], p[2]], [p[0], p[1], p[2] + low]]); });
            run = [];
        };
        for (const q of pts) { if (q) run.push(q); else flush(); }
        flush();
    }

    // A row of a hop garden: tall poles carrying a wire, the bines climbing
    // strings set out in a zigzag between the ground and the wire, leafy at
    // the top. The row hides what's behind it like a curtain.
    function hopRow(T, a, b, ok) {
        const S = T.S, G = T.G, L = Math.hypot(b[0] - a[0], b[1] - a[1]), h = 5;
        if (L < 4) return;
        const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], per = Math.max(3, 2.2 / Math.max(0.05, onPaper(T, d[0], d[1])));
        const n = Math.max(2, Math.round(L / per)), at = s => [a[0] + d[0] * s, a[1] + d[1] * s];
        const pts = [];
        for (let i = 0; i <= n * 2; i++) {
            const [x, y] = at((L * i) / (n * 2));
            pts.push(ok(x, y) && T.P.seen(x, y, 0, -6) ? [x, y, G.at(x, y)] : null);
        }
        let run = [];
        const flush = () => {
            if (run.length >= 3) {
                for (let i = 0; i + 1 < run.length; i++) {
                    const p = run[i].q, q = run[i + 1].q;
                    S.face([p, q, [q[0], q[1], q[2] + h], [p[0], p[1], p[2] + h]]);
                }
                S.kind = GREEN;
                S.line(run.map(({ q, i }) => [q[0], q[1], q[2] + (i % 2 ? 0.3 : h)]));
                const top = [];
                run.forEach(({ q }, k) => {
                    top.push([q[0], q[1], q[2] + h]);
                    if (k + 1 < run.length) { const r = run[k + 1].q; top.push([(q[0] + r[0]) / 2, (q[1] + r[1]) / 2, (q[2] + r[2]) / 2 + h + 0.3]); }
                });
                S.line(top);
                S.kind = INK;
                run.forEach(({ q, i }) => { if (i % 6 === 0) S.line([q, [q[0], q[1], q[2] + h + 0.5]]); });
            }
            run = [];
        };
        pts.forEach((q, i) => { if (q) run.push({ q, i }); else flush(); });
        flush();
    }

    // Humped stone bridge carrying a lane over the creek
    function stoneBridge(T, road, creek) {
        const X = crossing(road.pts, creek.pts);
        if (!X || !T.P.seen(X.x, X.y, 0, -15)) return null;
        const G = T.G, d = X.d, nrm = [-d[1], d[0]];
        // b runs away from us, from the side we see
        const away = nrm[0] * T.cam.fx + nrm[1] * T.cam.fy > 0 ? nrm : [-nrm[0], -nrm[1]];
        const w = road.hw * 2 + 1, span = creek.hw * 2 + 1.5;
        const P = (a, b, c) => [X.x + d[0] * a + away[0] * (b - w / 2), X.y + d[1] * a + away[1] * (b - w / 2), c];
        const V = (a, b, c) => [d[0] * a + away[0] * b, d[1] * a + away[1] * b, c];
        const zr = Math.max(G.at(...P(-span / 2 - 1, w / 2, 0).slice(0, 2)), G.at(...P(span / 2 + 1, w / 2, 0).slice(0, 2)));
        const zw = G.at(X.x, X.y) + 0.15;
        T.S.kind = INK;
        T.casting = true;
        kit.bridge(T, { P, V }, -span / 2, span / 2, w, zr, zw, false);
        T.casting = false;
        return { x: X.x, y: X.y, r: span / 2 + kit.bridgeRamp(span) + 1 };
    }

    // Where two polylines cross, with the first one's direction there
    function crossing(A, B) {
        for (let i = 0; i + 1 < A.length; i++) {
            const a = A[i], b = A[i + 1];
            for (let j = 0; j + 1 < B.length; j++) {
                const c = B[j], e = B[j + 1];
                const X = geo.lineIntersect(a, [b[0] - a[0], b[1] - a[1]], c, [e[0] - c[0], e[1] - c[1]]);
                if (X && X.t >= 0 && X.t <= 1 && X.u >= 0 && X.u <= 1) {
                    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                    return { x: X.x, y: X.y, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
                }
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Field fills. Each draws inside a convex field, a few meters in from
    // its edge, wherever T.free allows.
    // ------------------------------------------------------------------

    // Spacing in meters for lines along angle `ang` to come `mm` apart on paper
    function spacing(T, ang, mm) {
        const d = [Math.cos(ang), Math.sin(ang), 0], n = [-d[1], d[0], 0];
        return mm / Math.max(apart(T, d, n), 1e-6);
    }

    // Straight rows across a field. `each(seg, i)` can draw a row itself.
    function rows(T, f, ang, mm, each, inset = 3) {
        const inner = geo.insetConvex(f.poly, inset);
        if (inner.length < 3) return [];
        const gap = Math.max(0.8, spacing(T, ang, mm)), segs = geo.hatch([inner], gap, ang);
        segs.forEach((seg, i) => each(seg, i, gap));
        return segs;
    }

    // Dashes along a row about `on` and `off` mm on paper
    function dashRow(T, seg, on, off, phase = 0) {
        const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, s = onPaper(T, (b[0] - a[0]) / L, (b[1] - a[1]) / L);
        return dashes(seg, on / s, off / s, (phase * (on + off)) / s);
    }

    function lineRows(T, f, kind, mm, ang = f.ang) {
        T.S.kind = kind;
        rows(T, f, ang, mm, seg => lay(T, seg, 0.1, T.free));
    }

    function dashedRows(T, f, kind, mm, on, off, ang = f.ang) {
        T.S.kind = kind;
        rows(T, f, ang, mm, (seg, i) => { for (const d of dashRow(T, seg, on, off, (i * 0.37) % 1)) lay(T, d, 0.1, T.free); });
    }

    // Standing grain: rows with a pair of tramlines every so often
    function grain(T, f, kind, rng) {
        const S = T.S, every = rng.int(7, 10), m = T.p.rows;
        rows(T, f, f.ang, m, (seg, i, gap) => {
            const r = i % every;
            if (r === 0) {
                S.kind = SOIL;
                const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
                for (const s of [-0.5, 0.5]) lay(T, [[a[0] + n[0] * gap * s, a[1] + n[1] * gap * s], [b[0] + n[0] * gap * s, b[1] + n[1] * gap * s]], 0.1, T.free);
            } else if (r !== 1 && r !== every - 1) {
                S.kind = kind;
                lay(T, seg, 0.1, T.free);
            }
        });
    }

    // Grass tuft: three short strokes on a card, dropped if anything covers it
    function tuft(T, x, y) {
        const P = card(T, x, y, T.G.at(x, y), 0);
        T.S.line([P(-0.35, 0.5), P(-0.05, 0), P(0, 0.7)], true);
        T.S.line([P(0.05, 0), P(0.35, 0.5)], true);
    }

    function tufts(T, f, rng, per = 70) {
        const S = T.S, [x0, y0, x1, y1] = bounds(f.poly), inner = geo.insetConvex(f.poly, 3);
        if (inner.length < 3) return;
        S.kind = GREEN;
        const at = [];
        for (let i = Math.round(Math.abs(geo.polygonArea(inner)) / per); i > 0; i--) at.push([rng.range(x0, x1), rng.range(y0, y1)]);
        later(T, () => {
            for (const [x, y] of at) if (geo.pointInPolygon(x, y, inner) && T.free(x, y) && T.P.seen(x, y, 0, -2)) tuft(T, x, y);
        });
    }

    // Spots on a jittered grid inside a field, `gap` meters apart, nearest first
    function spots(T, f, gap, rng, inset = 4, jitter = 0.3) {
        const inner = geo.insetConvex(f.poly, inset), out = [];
        if (inner.length < 3) return out;
        const [x0, y0, x1, y1] = bounds(inner), c = Math.cos(f.ang), s = Math.sin(f.ang);
        const R = Math.hypot(x1 - x0, y1 - y0) / 2, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        for (let a = -R; a <= R; a += gap) {
            for (let b = -R; b <= R; b += gap) {
                const u = a + rng.range(-jitter, jitter) * gap, v = b + rng.range(-jitter, jitter) * gap;
                const x = mx + u * c - v * s, y = my + u * s + v * c;
                if (geo.pointInPolygon(x, y, inner) && T.P.seen(x, y, 0, -12)) out.push([x, y]);
            }
        }
        return out.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
    }

    // Round bale lying on its side, along angle `ang`
    function bale(T, x, y, ang) {
        const S = T.S, r = 0.8, L = 1.3, z = T.G.at(x, y) - 0.05, ax = [Math.cos(ang), Math.sin(ang)], n = [-ax[1], ax[0]];
        const pts = ring(12, (c, s) => [x - ax[0] * L / 2 + n[0] * r * c, y - ax[1] * L / 2 + n[1] * r * c, z + r + r * s]);
        S.kind = GOLD;
        S.prism(pts, [ax[0] * L, ax[1] * L, 0], true);
    }

    // Sunflowers: rows of heads on stems, all turned to face us like the
    // people, the stems standing in a green row line
    function sunflowers(T, f) {
        const S = T.S, m = Math.max(1.9, T.p.rows * 1.3), r = 0.34 / T.k, up = 1.0 / (T.k * T.cam.ce);
        rows(T, f, f.ang, m, (seg, i) => {
            const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, s = onPaper(T, (b[0] - a[0]) / L, (b[1] - a[1]) / L);
            const step = 1.8 / s;
            S.kind = GREEN;
            lay(T, seg, 0.1, T.free);
            later(T, () => {
                for (let t = ((i % 2) * step) / 2 + step / 2; t < L - step / 2; t += step) {
                    const [x, y] = geo.lerpPt(a, b, t / L);
                    if (!T.free(x, y) || !T.P.seen(x, y, 0, -1)) continue;
                    const P = card(T, x, y, T.G.at(x, y), 0);
                    S.kind = GREEN;
                    S.line([P(0, 0.1), P(0, up - r)], true);
                    S.kind = GOLD;
                    S.line(ring(8, (c, q) => P(r * c, up + r * q)).concat([P(r, up)]), true);
                }
            });
        });
    }

    function orchard(T, f, rng, claims) {
        for (const [x, y] of spots(T, f, 7, rng, 5, 0.06)) {
            if (!T.free(x, y) || !claims.free(x, y, 2)) continue;
            claims.take(x, y, 2.5);
            fruitTree(T, x, y, rng, T.season === 'spring');
        }
    }

    // Pasture: grass and a herd or two grazing together, fenced in
    function pasture(T, f, rng, claims, kind) {
        pastureShelter(T, f, rng, claims, kind);
        tufts(T, f, rng, 60);
        const inner = geo.insetConvex(f.poly, 7);
        if (inner.length < 3 || T.p.animals <= 0) return;
        const area = Math.abs(geo.polygonArea(inner)), n = Math.max(2, Math.round((area / 700) * (0.2 + T.p.animals)));
        const [x0, y0, x1, y1] = bounds(inner), herd = [];
        const groups = [], wanted = rng.int(1, 3);
        for (let i = 0; i < 30 && groups.length < wanted; i++) {
            const x = rng.range(x0, x1), y = rng.range(y0, y1);
            if (geo.pointInPolygon(x, y, inner) && T.free(x, y)) groups.push([x, y]);
        }
        if (!groups.length) return;
        const spread = Math.sqrt(area) * 0.12;
        for (let i = 0; i < n * 4 && herd.length < n; i++) {
            const g = groups[i % groups.length], x = g[0] + rng.gauss(0, spread), y = g[1] + rng.gauss(0, spread);
            if (!geo.pointInPolygon(x, y, inner) || !T.free(x, y) || !claims.free(x, y, 2.6) || !T.P.seen(x, y, 0, -2)) continue;
            claims.take(x, y, 2.2);
            herd.push([x, y]);
        }
        herd.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        const coat = rng.chance(0.6) ? 'holstein' : 'dark';
        for (const [x, y] of herd) {
            if (kind === 'sheep') sheep(T, x, y, rng.sign());
            else if (kind === 'horses') horse(T, x, y, rng.sign(), rng);
            else cow(T, x, y, rng.sign(), rng, coat);
        }
    }

    function pastureShelter(T, f, rng, claims, kind) {
        if (T.p.animals <= 0 || T.pastureShelters || Math.abs(geo.polygonArea(f.poly)) < 2400) return;
        const candidates = spots(T, f, 16, rng, 14, 0.15).map(q => ({ q,
            d: Math.min(...T.plan.roads.map(r => distToPath(r.pts, ...q))) }));
        candidates.sort((a, b) => a.d - b.d);
        for (const { q: [x, y] } of candidates) {
            const F = turned(x, y, T.G.at(x, y), frontAngle(T, rng));
            const footprint = rectPoly([-8, -10, 8, 10]).map(q => F.P(...q, 0).slice(0, 2));
            if (!footprint.every(q => geo.pointInPolygon(...q, f.poly) && T.keep(...q) && T.P.seen(...q, 0, 8) && claims.free(...q, 2))
                || !claims.free(x, y, 12) || !T.keep(x, y)) continue;
            const levels = footprint.map(q => T.G.at(...q));
            if (Math.max(...levels) - Math.min(...levels) > 2) continue;
            cartShed(T, F, [-7, 3, 7, 9], rng);
            for (const [a, b] of [[[-7, 3], [-7, -9]], [[-7, -9], [-2, -9]], [[2, -9], [7, -9]], [[7, -9], [7, 3]]]) boardFence(T, F.P(...a, 0), F.P(...b, 0));
            T.S.kind = INK;
            T.S.box(F, -6, -4, 0, -4, 1, 0.8);
            T.S.loop([F.P(-5.7, -3.7, 0.82), F.P(-4.3, -3.7, 0.82), F.P(-4.3, 0.7, 0.82), F.P(-5.7, 0.7, 0.82)]);
            for (const [a, b] of [[0, -4], [4, 0]]) {
                const [cx, cy] = F.P(a, b, 0);
                if (kind === 'sheep') sheep(T, cx, cy, rng.sign());
                else if (kind === 'horses') horse(T, cx, cy, rng.sign(), rng);
                else cow(T, cx, cy, rng.sign(), rng);
            }
            claims.poly(footprint);
            T.reserve(footprint);
            T.pastureShelters++;
            return;
        }
    }

    // Barbed wire round a field: posts and two wires, with a gate gap
    function wireFence(T, poly, gate = -1) {
        const S = T.S, G = T.G;
        S.kind = SOIL;
        for (let e = 0; e < poly.length; e++) {
            const a = poly[e], b = poly[(e + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const s = onPaper(T, (b[0] - a[0]) / L, (b[1] - a[1]) / L), step = Math.max(4, 1.6 / Math.max(s, 0.05));
            const n = Math.max(1, Math.round(L / step));
            let prev = null;
            for (let i = 0; i <= n; i++) {
                const [x, y] = geo.lerpPt(a, b, i / n);
                const ok = T.keep(x, y) && !(e === gate && Math.abs(i / n - 0.5) < 3 / L);
                const z = G.at(x, y), top = [x, y, z + 1.3];
                if (ok && T.P.seen(x, y, 0, -3)) {
                    S.line([[x, y, z], top]);
                    if (prev) for (const h of [0.75, 1.2]) S.line([[prev[0], prev[1], prev[2] + h], [x, y, z + h]]);
                }
                prev = ok ? [x, y, z] : null;
            }
        }
    }

    // A center pivot sprinkler: a round field with its rows in rings and the
    // pivot's long arm on wheeled towers over the crop
    function pivot(T, f, rng, kind) {
        const S = T.S, G = T.G, [x0, y0, x1, y1] = bounds(f.poly);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.min(x1 - x0, y1 - y0) / 2 - 4;
        const free = T.free;
        S.kind = kind;
        // rings far enough apart where they cross the view, which is where they run closest
        const gap = T.p.rows / (T.k * T.cam.se);
        for (let r = R; r > 6; r -= gap) {
            const n = Math.max(24, Math.ceil((TAU * r) / T.drapeStep)), pts = [];
            for (let i = 0; i <= n; i++) pts.push([cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n)]);
            lay(T, pts, 0.1, free);
        }
        // the wheel tracks of the towers
        const across = Math.atan2(T.cam.ry, T.cam.rx) + rng.range(-0.5, 0.5) + (rng.chance(0.5) ? Math.PI : 0);
        const towers = Math.max(3, Math.round(R / 40)), dir = [Math.cos(across), Math.sin(across)];
        S.kind = SOIL;
        for (let i = 1; i <= towers; i++) {
            const r = (R * i) / towers - 1;
            const n = Math.ceil((TAU * r) / T.drapeStep), pts = [];
            for (let k = 0; k <= n; k++) pts.push([cx + r * Math.cos((TAU * k) / n), cy + r * Math.sin((TAU * k) / n)]);
            for (const d of dashes(pts, 6, 1.5)) lay(T, d, 0.12, free);
        }
        // The arm: a pipe arched over each span between A-frame towers on two
        // wheels, with truss rods slung under it. The arm is turned to cross
        // the view, where the truss has some depth on paper.
        T.casting = true;
        S.kind = INK;
        const zc = G.at(cx, cy);
        S.lathe(cx, cy, [[1.6, zc], [1.6, zc + 0.3], [0.25, zc + 4.4], [0, zc + 4.6]], 4, false, Math.PI / 4);
        let prev = [cx, cy, zc + 4.3];
        const along = (a, b, t, lift) => [geo.lerp(a[0], b[0], t), geo.lerp(a[1], b[1], t), geo.lerp(a[2], b[2], t) + lift];
        for (let i = 1; i <= towers; i++) {
            const r = (R * i) / towers - 1, x = cx + dir[0] * r, y = cy + dir[1] * r, z = G.at(x, y), top = [x, y, z + 3.9];
            const n = [-dir[1], dir[0]];
            for (const s of [-1, 1]) {
                S.line([[x + n[0] * 1.7 * s, y + n[1] * 1.7 * s, z + 0.45], top]);
                S.loop(ring(10, (c, q) => [x + n[0] * 1.9 * s + dir[0] * 0.5 * c, y + n[1] * 1.9 * s + dir[1] * 0.5 * c, z + 0.5 + 0.5 * q]));
            }
            S.line([[x + n[0] * 1.9, y + n[1] * 1.9, z + 0.5], [x - n[0] * 1.9, y - n[1] * 1.9, z + 0.5]]);
            const pipe = [], rods = [], m = 8, depth = 2.2;
            for (let k = 0; k <= m; k++) {
                const t = k / m;
                pipe.push(along(prev, top, t, 0.35 * Math.sin(Math.PI * t)));
                rods.push(along(prev, top, t, -depth * Math.min(1, 3 * Math.min(t, 1 - t))));
            }
            S.line(pipe);
            if (T.detail) {
                S.line(rods);
                for (let k = 1; k < m; k++) S.line(k % 2 ? [pipe[k - 1], rods[k], pipe[k + 1]] : [rods[k], pipe[k]]);
            }
            prev = top;
        }
        const tip = [cx + dir[0] * (R + 7), cy + dir[1] * (R + 7), prev[2] - 0.6];
        S.line([prev, tip]);
        if (T.detail) S.line([along(prev, tip, 0.1, -1.2), tip]);
        T.casting = false;
    }

    // ------------------------------------------------------------------
    // Machines at work. Each takes a field and what it's doing in it.
    // ------------------------------------------------------------------

    function wheel(T, F, a, b, r) {
        const pts = ring(T.segs(r), (c, s) => F.P(a + r * c, b, r + r * s));
        T.S.face(pts);
        T.S.loop(pts);
        if (T.detail && r * T.k > 0.9) T.S.loop(ring(8, (c, s) => F.P(a + r * 0.45 * c, b, r + r * 0.45 * s)));
    }

    // Tractor heading along `ang`, its hood painted in `paint`
    function tractor(T, x, y, ang, paint = RED) {
        const S = T.S, z = T.G.at(x, y), F = turned(x, y, z, ang), P = F.P;
        S.kind = INK;
        S.box(F, -0.3, -0.42, 0.75, 1.95, 0.42, 1.5);
        kit.cabin(T, F, -1.55, -0.15, -1.45, -0.25, 0.62, 1.3, 2.7);
        S.box(F, -1.7, -0.72, 2.7, 0.0, 0.72, 2.85);
        for (const b of [-1, 1]) {
            wheel(T, F, -0.95, b * 0.92, 0.82);
            wheel(T, F, 1.45, b * 0.62, 0.45);
        }
        S.line([P(1.55, -0.2, 1.5), P(1.55, -0.2, 2.5)]);
        if (T.sees(UP)) inKind(S, paint, () => S.hatch([P(-0.25, -0.38, 1.5), P(1.9, -0.38, 1.5), P(1.9, 0.38, 1.5), P(-0.25, 0.38, 1.5)], F.V(1, 0, 0), 0.45));
        return F;
    }

    // Combine harvester heading along `ang` with its header out in front
    function combine(T, x, y, ang, rng) {
        const S = T.S, z = T.G.at(x, y), F = turned(x, y, z, ang), P = F.P, hw = 4.4;
        S.kind = INK;
        S.box(F, -3.4, -1.35, 1.0, 1.3, 1.35, 3.3);
        S.box(F, -2.6, -1.5, 3.3, 0.4, 1.5, 4.3);
        kit.cabin(T, F, 0.5, 2.3, 0.6, 2.1, 0.95, 3.0, 4.7);
        S.box(F, 1.3, -0.7, 0.8, 3.1, 0.7, 2.1);
        S.box(F, 3.0, -hw, 0.35, 4.5, hw, 1.15);
        const reel = ring(10, (c, s) => F.P(4.1 + 0.55 * c, -hw + 0.25, 1.75 + 0.55 * s));
        S.prism(reel, F.V(0, 2 * hw - 0.5, 0), true);
        for (const b of [-1, 1]) {
            wheel(T, F, 0.6, b * 1.42, 0.95);
            wheel(T, F, -2.7, b * 1.2, 0.6);
        }
        // unloading auger folded back along the tank
        S.line([P(-2.4, -1.6, 4.1), P(0.3, -1.6, 4.4)]);
        for (const b of [-1.35, 1.35]) {
            if (!T.sees(F.V(0, Math.sign(b), 0))) continue;
            inKind(S, RED, () => S.hatch([P(-3.3, b, 1.1), P(1.2, b, 1.1), P(1.2, b, 2.0), P(-3.3, b, 2.0)], [0, 0, 1], 0.5));
        }
        return F;
    }

    // Trailer with sloped sides, hitched behind a tractor frame
    function grainCart(T, F) {
        const S = T.S, P = F.P;
        S.kind = INK;
        const v = [P(-6.2, -1.0, 1.0), P(-3.0, -1.0, 1.0), P(-3.0, 1.0, 1.0), P(-6.2, 1.0, 1.0),
            P(-6.5, -1.4, 2.6), P(-2.7, -1.4, 2.6), P(-2.7, 1.4, 2.6), P(-6.5, 1.4, 2.6)];
        S.solid(v, PG.iso.BOX);
        for (const b of [-1, 1]) wheel(T, F, -4.6, b * 1.2, 0.7);
        S.line([P(-2.9, 0, 1.0), P(-1.6, 0, 0.9)]);
    }

    // A field being worked: the part done behind the machine, the part still
    // to do ahead of it. `doneFn` and `todoFn` fill a row, `machine` draws
    // whatever is at work at the end of the current pass.
    function workRows(T, f, rng, mm, doneFn, todoFn, machine) {
        const segs = rows(T, f, f.ang, mm, () => {});
        if (segs.length < 6) { for (const s of segs) todoFn(s, 0); return; }
        const done = rng.int(Math.floor(segs.length * 0.25), Math.floor(segs.length * 0.7));
        const cur = segs[done], [a, b] = cur, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = rng.range(0.25, 0.75), at = geo.lerpPt(a, b, t);
        segs.forEach((seg, i) => {
            if (i < done) doneFn(seg, i);
            else if (i > done + 1) todoFn(seg, i);
            else if (i === done) { doneFn([a, at], i); todoFn([at, b], i); }
            else todoFn(seg, i);
        });
        machine(at[0], at[1], Math.atan2(b[1] - a[1], b[0] - a[0]), L);
    }

    function harvesting(T, f, rng, claims) {
        const S = T.S, m = T.p.rows;
        let carted = false;
        workRows(T, f, rng, m,
            (seg, i) => { S.kind = GOLD; for (const d of dashRow(T, seg, 0.6, 0.9, (i * 0.31) % 1)) lay(T, d, 0.1, T.free); },
            seg => { S.kind = GOLD; lay(T, seg, 0.1, T.free); },
            (x, y, ang) => {
                T.casting = true;
                // the combine's header reaches out over the standing grain
                const c = Math.cos(ang), s = Math.sin(ang);
                combine(T, x - c * 4, y - s * 4, ang, rng);
                claims.take(x, y, 7);
                if (!carted && rng.chance(0.75)) {
                    const F = tractor(T, x - c * 3 - s * 6.5, y - s * 3 + c * 6.5, ang);
                    grainCart(T, F);
                    carted = true;
                }
                T.casting = false;
            });
    }

    function plowing(T, f, rng, claims, before) {
        const S = T.S, m = T.p.rows;
        workRows(T, f, rng, m * 0.75,
            seg => { S.kind = SOIL; lay(T, seg, 0.1, T.free); },
            (seg, i) => {
                if (i % 2) return;
                if (before === 'stubble') { S.kind = GOLD; for (const d of dashRow(T, seg, 0.6, 0.9, (i * 0.31) % 1)) lay(T, d, 0.1, T.free); }
            },
            (x, y, ang) => {
                T.casting = true;
                const c = Math.cos(ang), s = Math.sin(ang);
                const F = tractor(T, x + c * 2.5, y + s * 2.5, ang);
                // the plow: a beam with its shares in a slant behind
                S.kind = INK;
                for (let i = 0; i < 4; i++) S.box(F, -2.4 - i * 0.9, -0.9 + i * 0.5 - 0.15, 0.1, -1.9 - i * 0.9, -0.9 + i * 0.5 + 0.15, 0.7);
                S.line([F.P(-1.7, -0.9, 0.7), F.P(-5.2, 0.9, 0.7)]);
                claims.take(x, y, 6);
                T.casting = false;
            });
    }

    function spraying(T, f, rng, claims) {
        const S = T.S;
        let at = null;
        workRows(T, f, rng, T.p.rows,
            seg => { S.kind = GREEN; for (const d of dashRow(T, seg, 0.8, 0.8)) lay(T, d, 0.1, T.free); },
            seg => { S.kind = GREEN; for (const d of dashRow(T, seg, 0.8, 0.8)) lay(T, d, 0.1, T.free); },
            (x, y, ang) => { at = [x, y, ang]; });
        if (!at) return;
        const [x, y, ang] = at, c = Math.cos(ang), s = Math.sin(ang);
        T.casting = true;
        const F = tractor(T, x + c * 2, y + s * 2, ang);
        S.kind = INK;
        S.lathe(...F.P(-2.4, 0, 0).slice(0, 2), [[0.7, F.P(0, 0, 1.0)[2]], [0.7, F.P(0, 0, 2.2)[2]], [0.3, F.P(0, 0, 2.5)[2]]], 10);
        // the spray booms folded out either side, held up by a stay
        for (const b of [-1, 1]) {
            S.line([F.P(-3.4, b * 0.8, 1.4), F.P(-3.4, b * 12, 1.2)]);
            S.line([F.P(-3.4, b * 0.8, 2.2), F.P(-3.4, b * 6, 1.4)]);
        }
        claims.take(x, y, 12);
        T.casting = false;
    }

    function baling(T, f, rng, claims) {
        const S = T.S, m = T.p.rows * 3;
        workRows(T, f, rng, m,
            (seg, i) => {
                const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (i % 2 === 0) for (let t = rng.range(6, 14); t < L - 3; t += rng.range(14, 24)) {
                    const [x, y] = geo.lerpPt(a, b, t / L);
                    if (T.free(x, y) && claims.free(x, y, 1.5) && T.P.seen(x, y, 0, -2)) { claims.take(x, y, 1.6); T.casting = true; bale(T, x, y, Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2); T.casting = false; }
                }
            },
            seg => { S.kind = GOLD; lay(T, wavy(seg, 0.6), 0.1, T.free); },
            (x, y, ang) => {
                T.casting = true;
                const c = Math.cos(ang), s = Math.sin(ang);
                const F = tractor(T, x + c * 3, y + s * 3, ang);
                S.kind = INK;
                const pr = ring(12, (cc, ss) => F.P(-3.6 + 1.0 * cc, -1.05, 1.15 + 1.0 * ss));
                S.prism(pr, F.V(0, 2.1, 0), true);
                for (const b of [-1, 1]) wheel(T, F, -3.6, b * 1.2, 0.45);
                claims.take(x, y, 6);
                T.casting = false;
            });
    }

    // A row with a gentle wobble, for windrows
    function wavy(seg, amp) {
        const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], out = [];
        const m = Math.max(2, Math.ceil(L / 3)), ph = (a[0] * 0.37 + a[1] * 0.11) % TAU;
        for (let i = 0; i <= m; i++) {
            const t = i / m, w = amp * Math.sin(t * L * 0.15 + ph);
            out.push([geo.lerp(a[0], b[0], t) + n[0] * w, geo.lerp(a[1], b[1], t) + n[1] * w]);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Trees, animals and little things
    // ------------------------------------------------------------------

    const tree = withKind(GREEN, kit.roundTree), fir = withKind(GREEN, kit.conifer);

    function fruitTree(T, x, y, rng, blossom) {
        const S = T.S, z = T.G.at(x, y), P = card(T, x, y, z, 0.1), r = rng.range(1.5, 1.9), cz = 2.0 + r * 0.8;
        S.kind = GREEN;
        const lobes = [];
        for (let i = 0; i < 18; i++) {
            const a = (TAU * i) / 18, b = 1 + 0.08 * Math.sin(a * 5 + x);
            lobes.push(P(Math.cos(a) * r * b, cz + Math.sin(a) * r * b));
        }
        S.face(lobes);
        S.loop(lobes);
        if (blossom && T.detail) {
            S.kind = BLOOM;
            for (let i = 0; i < 4; i++) {
                const a = rng.range(0, TAU), d = rng.range(0.2, 0.65) * r, q = 0.16;
                S.loop(ring(6, (c, s) => P(Math.cos(a) * d + q * c, cz + Math.sin(a) * d + q * s)));
            }
        }
        S.kind = GREEN;
        const B = card(T, x, y, z, 0);
        S.line([B(0, 0), B(0, cz - r)]);
    }

    // Livestock are drawn a little larger than life, or they'd be specks on paper
    const BEAST = 1.25;

    // Cow seen side on, as a cut-out facing us like the people: a deep body,
    // a head held low or grazing, legs and a tail. Holsteins get black
    // patches, the others a solid hatch.
    function cow(T, x, y, dir, rng, coat = 'holstein') {
        const S = T.S, P0 = card(T, x, y, T.G.at(x, y), 0), m = BEAST, P = (u, w) => P0(u * dir * m, w * m);
        const graze = rng.chance(0.45), hy = graze ? 0.35 : 1.25;
        S.kind = FIGURE;
        const body = [P(-1.0, 0.8), P(0.85, 0.75), P(0.95, 1.05), P(0.82, 1.42), P(-0.85, 1.48), P(-1.05, 1.3)];
        S.face(body);
        S.loop(body);
        const head = [P(0.82, 1.38), P(1.05, hy + 0.32), P(1.35, hy + 0.05), P(1.45, hy + 0.22), P(1.12, hy + 0.55), P(0.95, 1.1)];
        S.face(head);
        S.loop(head);
        S.line([P(1.0, hy + 0.55), P(0.92, hy + 0.7)]);
        for (const u of [-0.85, -0.62, 0.55, 0.75]) S.line([P(u, 0.8), P(u + rng.range(-0.05, 0.05), 0)]);
        S.line([P(-1.02, 1.35), P(-1.15, 1.0), P(-1.12, 0.65)]);
        if (!T.detail) return;
        if (coat === 'holstein') {
            const u = rng.range(-0.75, -0.05);
            const patch = [P(u, 0.95), P(u + 0.5, 0.92), P(u + 0.58, 1.3), P(u - 0.05, 1.38)];
            S.hatch(patch, [0, 0, 1], 0.28);
            S.hatch([P(1.05, hy + 0.3), P(1.25, hy + 0.12), P(1.3, hy + 0.25), P(1.1, hy + 0.45)], [0, 0, 1], 0.28);
        } else S.hatch(body, [0, 0, 1], 0.4);
    }

    // Horse side on, head up
    function horse(T, x, y, dir, rng) {
        const S = T.S, P0 = card(T, x, y, T.G.at(x, y), 0), m = BEAST, P = (u, w) => P0(u * dir * m, w * m);
        S.kind = FIGURE;
        const body = ring(12, (c, s) => P(c * 0.85, 1.2 + s * 0.3));
        S.face(body);
        S.loop(body);
        const neck = [P(0.5, 1.18), P(0.95, 1.95), P(1.18, 1.88), P(0.86, 1.3)];
        S.face(neck);
        S.loop(neck);
        const head = [P(0.95, 1.95), P(1.12, 2.02), P(1.5, 1.62), P(1.38, 1.52)];
        S.face(head);
        S.loop(head);
        const g = rng.range(-0.15, 0.15);
        for (const [u, k] of [[-0.62, 1], [-0.45, -1], [0.5, 1], [0.66, -1]]) S.line([P(u, 1), P(u + g * k, 0)]);
        S.line([P(-0.82, 1.35), P(-1.05, 1.1), P(-1.02, 0.7)]);
    }

    function sheep(T, x, y, dir) {
        const S = T.S, P0 = card(T, x, y, T.G.at(x, y), 0), P = (u, w) => P0(u * dir * BEAST, w * BEAST);
        S.kind = FIGURE;
        const body = [], round = [];
        for (let i = 0; i < 28; i++) {
            const a = (TAU * i) / 28, bump = 0.06 * Math.abs(Math.sin(a * 4));
            body.push(P(Math.cos(a) * (0.75 + bump), 0.75 + Math.sin(a) * (0.4 + bump)));
            round.push(P(Math.cos(a) * 0.75, 0.75 + Math.sin(a) * 0.4));
        }
        S.face(round);
        S.loop(body);
        const hd = [P(0.62, 0.95), P(0.98, 0.92), P(1.05, 0.62), P(0.75, 0.58)];
        S.face(hd);
        S.loop(hd);
        if (T.detail) S.hatch(hd, [0, 0, 1], 0.3);
        for (const u of [-0.42, -0.25, 0.3, 0.46]) S.line([P(u, 0.42), P(u, 0)]);
    }

    // ------------------------------------------------------------------
    // Prairie farm buildings. Frames have u along the road and v into the
    // lot, so walls facing -v face the road.
    // ------------------------------------------------------------------

    // Red boards up a wall: wall(s, c) gives world points, outline and holes are [s, c] polygons
    function boards(T, at, outline, holes, kind = RED) {
        const a = at(0, 0), b = at(1, 0), u = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        const per = apart(T, UP, u);
        if (per < 0.25) return;
        const gap = Math.max(FINE + 0.2, 0.95) / per;
        inKind(T.S, kind, () => {
            for (const [p, q] of geo.hatch([outline, ...holes], gap, Math.PI / 2)) T.S.line([at(...p), at(...q)]);
        });
    }

    // A door that slides on a track, braced with an X
    function xDoor(T, at, s0, s1, c0, c1) {
        const S = T.S;
        S.loop([at(s0, c0), at(s1, c0), at(s1, c1), at(s0, c1)]);
        if (!T.detail) return;
        S.line([at(s0, c0), at(s1, c1)]);
        S.line([at(s1, c0), at(s0, c1)]);
    }

    // Big barn, ridge along v, with its big doors in the gable at b0. The
    // roof is a gambrel, a Gothic arch (the round-roofed kind, its curve
    // smooth so only the outline shows) or a plain gable.
    function gambrelBarn(T, F, fp, rng, style = 'gambrel') {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, w = a1 - a0, L = b1 - b0, am = (a0 + a1) / 2;
        let wallH = rng.range(4.2, 4.8), kneeH, ridge, roof;
        if (style === 'arch') {
            // two arcs that meet in a point at the top
            wallH = rng.range(2.6, 3.2);
            const R = w * 0.85, cphi = (R - w / 2) / R, phi = Math.acos(cphi), n = 7;
            const right = Array.from({ length: n }, (_, i) => { const t = (phi * i) / n; return [a1 - R + R * Math.cos(t), wallH + R * Math.sin(t)]; });
            ridge = wallH + R * Math.sin(phi);
            kneeH = wallH + (ridge - wallH) * 0.55;
            roof = [...right, [am, ridge], ...right.slice().reverse().map(([a, c]) => [2 * am - a, c])];
        } else if (style === 'gable') {
            ridge = wallH + (w / 2) * Math.tan(geo.rad(rng.range(36, 42)));
            kneeH = (wallH + ridge) / 2;
            roof = [[a1, wallH], [am, ridge], [a0, wallH]];
        } else {
            const knee = w * 0.16;
            kneeH = wallH + w * 0.32;
            ridge = kneeH + w * 0.19;
            roof = [[a1, wallH], [a1 - knee, kneeH], [am, ridge], [a0 + knee, kneeH], [a0, wallH]];
        }
        const prof = [[a0, 0], [a1, 0], ...roof];
        S.kind = INK;
        // walls and floor drawn as edges, the arch's roof facets as one smooth surface
        const m = prof.length, v = prof.map(([a, c]) => P(a, b0, c)).concat(prof.map(([a, c]) => P(a, b1, c)));
        const faces = [prof.map((_, i) => i), prof.map((_, i) => m + i)], groups = [0, 0];
        for (let i = 0; i < m; i++) {
            faces.push([i, (i + 1) % m, m + (i + 1) % m, m + i]);
            groups.push(style === 'arch' && i >= 2 && i < m - 1 ? 1 : 0);
        }
        S.solid(v, faces, groups);
        // roof slopes, the ones out of the sun hatched
        const slopes = roof.slice(0, -1).map((q, i) => [q, roof[i + 1]]);
        const centre = P(am, (b0 + b1) / 2, wallH);
        for (const [[pa, pc], [qa, qc]] of slopes) {
            const pts = [P(pa, b0, pc), P(qa, b0, qc), P(qa, b1, qc), P(pa, b1, pc)], n = outward(pts, centre);
            if (!T.sees(n) || !T.tones || T.lit(n)) continue;
            hatchIn(T, [pts], unit([n[0] * n[2], n[1] * n[2], n[2] * n[2] - (n[0] ** 2 + n[1] ** 2 + n[2] ** 2)]), T.hDark);
        }
        // the door end: sliding doors, a hayloft door under a hood at the peak
        const end = (s, c) => P(a1 - s, b0, c), dw = Math.min(5.6, w * 0.46), hl = Math.min(1.8, w * 0.14);
        const doorAt = [w / 2 - dw / 2, w / 2 + dw / 2], loft = [w / 2 - hl / 2, w / 2 + hl / 2, kneeH - 1.6, kneeH + 0.6];
        if (T.sees(F.V(0, -1, 0))) {
            const gable = prof.map(([a, c]) => [a1 - a, c]);
            boards(T, end, gable, [rectPoly([doorAt[0], 0, doorAt[1], 4]), rectPoly([loft[0], loft[2], loft[1], loft[3]])]);
            S.kind = INK;
            xDoor(T, end, doorAt[0], w / 2, 0, 4);
            xDoor(T, end, w / 2, doorAt[1], 0, 4);
            S.line([end(doorAt[0] - 0.6, 4.25), end(doorAt[1] + 0.6, 4.25)]);
            xDoor(T, end, loft[0], loft[1], loft[2], loft[3]);
        }
        // hay hood over the loft door
        const hp = [[am - 1.1, ridge - 1.3], [am + 1.1, ridge - 1.3], [am, ridge - 0.25]].map(([a, c]) => P(a, b0, c));
        S.prism(hp, F.V(0, -1.5, 0));
        if (T.detail) S.line([P(am, b0 - 1.3, ridge - 1.3), P(am, b0 - 1.3, kneeH - 1.2)]);
        // side walls with a row of small stall windows
        for (const side of [1, 3]) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            const n = Math.max(2, Math.floor(L / 3.2)), holes = [];
            for (let i = 0; i < n; i++) {
                const s = ((i + 0.5) * L) / n;
                holes.push(rectPoly([s - 0.45, 1.6, s + 0.45, 2.4]));
            }
            boards(T, W.at, rectPoly([0, 0, L, wallH]), holes);
            S.kind = INK;
            for (const h of holes) S.loop(h.map(([s, c]) => W.at(s, c)));
        }
        // the back gable
        if (T.sees(F.V(0, 1, 0))) boards(T, (s, c) => P(a0 + s, b1, c), prof.map(([a, c]) => [a - a0, c]), []);
        // cupola on the ridge
        S.kind = INK;
        const bm = b0 + L * rng.range(0.4, 0.6), cu = 0.8;
        S.box(F, am - cu, bm - cu, ridge - 0.4, am + cu, bm + cu, ridge + 1.3);
        if (T.detail) for (const side of [0, 1, 2, 3]) {
            const W = wall(F, side, [am - cu, bm - cu, am + cu, bm + cu]);
            if (T.sees(W.n)) for (const s of [0.45, 1.15]) S.line([W.at(s, ridge + 0.1), W.at(s, ridge + 1.1)]);
        }
        const apex = P(am, bm, ridge + 2.6), e = cu + 0.3;
        const base = [P(am - e, bm - e, ridge + 1.3), P(am + e, bm - e, ridge + 1.3), P(am + e, bm + e, ridge + 1.3), P(am - e, bm + e, ridge + 1.3)];
        S.solid(base.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        S.line([apex, [apex[0], apex[1], apex[2] + 1.2]]);
        if (T.detail) S.line([[apex[0] - T.cam.rx * 0.6, apex[1] - T.cam.ry * 0.6, apex[2] + 0.9], [apex[0] + T.cam.rx * 0.6, apex[1] + T.cam.ry * 0.6, apex[2] + 0.9]]);
        return { ridge, wallH };
    }

    // Lean-to roof off a wall (from kit.wall) between s0 and s1, sloping out
    // `depth` meters from height hi to lo, on posts
    function leanTo(T, W, s0, s1, depth, hi, lo, posts = true) {
        const S = T.S, t = 0.15, n = W.n, nl = Math.hypot(n[0], n[1]) || 1;
        const at = (s, c, out) => { const q = W.at(s, c); return [q[0] + (n[0] / nl) * out, q[1] + (n[1] / nl) * out, q[2]]; };
        const a = at(s0, 0, 0), b = at(s1, 0, 0), along = [b[0] - a[0], b[1] - a[1], 0];
        S.prism([at(s0, hi, 0), at(s0, lo, depth), at(s0, lo - t, depth), at(s0, hi - t, 0)], along);
        if (posts) {
            const k = Math.max(2, Math.round((s1 - s0) / 3.5) + 1);
            for (let i = 0; i < k; i++) {
                const s = geo.lerp(s0 + 0.2, s1 - 0.2, i / (k - 1));
                S.line([at(s, 0, depth - 0.2), at(s, lo - t, depth - 0.2)]);
            }
        }
        const sl = Math.atan2(hi - lo, depth), up = [(n[0] / nl) * Math.sin(sl), (n[1] / nl) * Math.sin(sl), Math.cos(sl)];
        shade(T, [at(s0, hi, 0), at(s1, hi, 0), at(s1, lo, depth), at(s0, lo, depth)], up);
    }

    // Board fence between two points on level ground: posts and three rails
    function boardFence(T, p0, p1, h = 1.3) {
        const S = T.S, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 0.6) return;
        const d = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L], step = Math.max(2.2, 1.1 / Math.max(0.05, onPaper(T, d[0], d[1])));
        const at = (s, c) => [p0[0] + d[0] * s, p0[1] + d[1] * s, p0[2] + c];
        S.kind = SOIL;
        const n = Math.max(1, Math.round(L / step));
        for (let i = 0; i <= n; i++) S.line([at((L * i) / n, 0), at((L * i) / n, h)]);
        for (const c of [0.45, 0.85, 1.25].map(f => (f * h) / 1.3)) S.line([at(0, c), at(L, c)]);
    }

    // Stack of round bales: a row on the ground and a row on top, along `ang`
    function baleStack(T, x, y, ang, n) {
        const c = Math.cos(ang), s = Math.sin(ang), z = T.G.at(x, y), r = 0.8, L = 1.3;
        const at = (i, row) => [x + c * (i - (n - 1 - row) / 2) * 1.62, y + s * (i - (n - 1 - row) / 2) * 1.62, z + row * 1.38];
        T.S.kind = GOLD;
        for (let row = 0; row < 2; row++) {
            for (let i = 0; i < n - row; i++) {
                const [bx, by, bz] = at(i, row), pts = ring(12, (cc, ss) => [bx + c * r * cc - s * L / 2, by + s * r * cc + c * L / 2, bz + r + r * ss]);
                T.S.prism(pts, [s * L, -c * L, 0], true);
            }
        }
    }

    // Fuel tank: a cylinder lying on a pair of trestles
    function fuelTank(T, x, y, z, ang) {
        const S = T.S, F = turned(x, y, z, ang), r = 0.75, L = 3.2;
        S.kind = INK;
        for (const a of [-1.1, 1.1]) S.line([F.P(a, -0.7, 0), F.P(a, 0, 1.4), F.P(a, 0.7, 0)]);
        S.prism(ring(14, (c, s) => F.P(-L / 2, r * c, 2.0 + r * s)), F.V(L, 0, 0), true);
        S.line([F.P(0.8, 0, 1.25), F.P(0.8, 0, 0.6), F.P(1.4, -0.4, 0.6)]);
    }

    function mailbox(T, x, y, z, ang) {
        const S = T.S, F = turned(x, y, z, ang);
        S.kind = INK;
        S.line([F.P(0, 0, 0), F.P(0, 0, 1.0)]);
        S.box(F, -0.3, -0.15, 1.0, 0.3, 0.15, 1.3);
    }

    // Vegetable plot: rows of plants with a path down the middle
    function garden(T, F, a0, b0, a1, b1) {
        const S = T.S, P = F.P;
        S.kind = SOIL;
        S.loop([P(a0, b0, 0.02), P(a1, b0, 0.02), P(a1, b1, 0.02), P(a0, b1, 0.02)]);
        S.kind = GREEN;
        const gap = Math.max(0.9, 1.1 / onPaper(T, ...F.V(0, 1, 0).slice(0, 2)) / 1);
        const am = (a0 + a1) / 2;
        for (let b = b0 + gap * 0.7; b < b1 - gap * 0.4; b += gap) {
            for (const [s0, s1] of [[a0 + 0.4, am - 0.5], [am + 0.5, a1 - 0.4]]) {
                const L = s1 - s0, n = Math.max(2, Math.round((L * onPaper(T, ...F.V(1, 0, 0).slice(0, 2))) / 0.9));
                const pts = [];
                for (let i = 0; i <= n; i++) pts.push(P(s0 + (L * i) / n, b, 0.15 + 0.12 * (i % 2)));
                S.line(pts);
            }
        }
    }

    // Hen house on legs with a little ramp and a wired run in front
    function henHouse(T, F, a, b) {
        const S = T.S, P = F.P;
        S.kind = INK;
        for (const [da, db] of [[0, 0], [2.2, 0], [2.2, 1.6], [0, 1.6]]) S.line([P(a + da, b + db, 0), P(a + da, b + db, 0.6)]);
        S.box(F, a, b, 0.6, a + 2.2, b + 1.6, 1.9);
        const R = gableRoof(T, F, [a, b, a + 2.2, b + 1.6], 1.9, true, geo.rad(32), null, { attic: false });
        shadeGable(T, F, R);
        S.line([P(a + 0.6, b, 0.8), P(a + 0.9, b - 1.2, 0)]);
        S.kind = SOIL;
        const run = [[a - 0.2, b - 0.1], [a - 0.2, b - 3.5], [a + 3.0, b - 3.5], [a + 3.0, b - 0.1]];
        for (let i = 0; i + 1 < run.length; i++) kit.railFence(T, P(run[i][0], run[i][1], 0), P(run[i + 1][0], run[i + 1][1], 0), 1, true);
    }

    function dog(T, x, y, z, dir) {
        const S = T.S, P0 = card(T, x, y, z, 0), P = (u, w) => P0(u * dir, w);
        S.kind = FIGURE;
        const body = [P(-0.4, 0.35), P(0.35, 0.35), P(0.45, 0.62), P(0.65, 0.72), P(0.62, 0.55), P(0.35, 0.58), P(-0.4, 0.6)];
        S.face(body);
        S.loop(body);
        for (const u of [-0.32, 0.3]) S.line([P(u, 0.35), P(u, 0)]);
        S.line([P(-0.4, 0.55), P(-0.6, 0.75)]);
    }

    // Two-story farmhouse with an ell at the back and a porch along the front
    function farmhouse(T, F, fp, rng) {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, L = a1 - a0, base = 0.5, top = base + 2 * kit.FLOOR;
        S.kind = INK;
        kit.plinth(T, F, fp, base, 0.1);
        S.box(F, a0, b0, base, a1, b1, top);
        const R = gableRoof(T, F, fp, top, true, geo.rad(rng.range(38, 44)), rng, { attic: false });
        shadeGable(T, F, R);
        // the ell, a story and a half, its ridge running back
        const ew = Math.min(6.5, L * 0.55), ea = rng.chance(0.5) ? a0 + 0.8 : a1 - 0.8 - ew, eb1 = b1 + rng.range(5, 7);
        const ell = [ea, b1, ea + ew, eb1], eTop = base + 1.5 * kit.FLOOR;
        S.box(F, ell[0], ell[1] - 0.5, base, ell[2], ell[3], eTop);
        shadeGable(T, F, gableRoof(T, F, [ell[0], ell[1] - 0.5, ell[2], ell[3]], eTop, false, geo.rad(40), rng, { attic: false }));
        chimney(T, F, rng.chance(0.5) ? a0 + 1.4 : a1 - 1.4, (b0 + b1) / 2, R.zb, R.ridge + 0.6);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            kit.windows(T, W, { base, floors: 2, style: 'sash', winW: 0.95, winH: 1.5, gap: 1.3, doors: side === 0 ? [L / 2] : [] });
        }
        kit.windows(T, wall(F, rng.chance(0.5) ? 1 : 3, ell), { base, floors: 1, style: 'sash', winW: 0.9, winH: 1.3, gap: 1.5 });
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) door(T, front.at, L / 2, base, 1.0, 2.2);
        // porch across the front on turned posts, with a rail
        const pd = 2.4, ph = base + 2.75;
        S.box(F, a0 - 0.2, b0 - pd, 0, a1 + 0.2, b0, base);
        leanTo(T, wall(F, 0, [a0 - 0.2, b0, a1 + 0.2, b1]), 0, L + 0.4, pd, ph + 0.5, ph);
        if (T.detail) {
            const rail = [[a0, b0 - pd + 0.2], [L / 2 - 0.9 + a0, b0 - pd + 0.2]];
            S.line(rail.map(([a, b]) => P(a, b, base + 0.9)));
            S.line([[a0 + L / 2 + 0.9, b0 - pd + 0.2], [a1, b0 - pd + 0.2]].map(([a, b]) => P(a, b, base + 0.9)));
            kit.steps(T, F, a0 + L / 2, b0 - pd, 1.6, 3);
        }
        return { R, ell };
    }

    // Concrete stave silo with a domed cap and hoops round it
    function silo(T, x, y, z, r, h, rng) {
        const S = T.S;
        S.kind = INK;
        const prof = [[r, z], [r, z + h]];
        for (let i = 1; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); prof.push([i === 4 ? 0 : r * Math.cos(a), z + h + r * 0.8 * Math.sin(a)]); }
        S.lathe(x, y, prof, Math.max(16, T.segs(r)));
        const gap = Math.max(1.6, 1.15 / (T.k * T.cam.ce));
        if (T.detail) for (let c = z + gap; c < z + h - 0.4; c += gap) S.line(frontArc(T, x, y, c, r));
    }

    // Corrugated steel grain bin: rings round the wall, ribs down the cone
    function grainBin(T, x, y, z, r, h) {
        const S = T.S, pitch = Math.tan(geo.rad(30)), apex = z + h + (r - 0.5) * pitch;
        S.kind = INK;
        S.lathe(x, y, [[r, z], [r, z + h], [r + 0.2, z + h - 0.05], [0.5, apex], [0.5, apex + 0.5], [0, apex + 0.6]], Math.max(16, T.segs(r)));
        if (!T.detail) return;
        const gap = Math.max(1.0, 1.0 / (T.k * T.cam.ce));
        for (let c = z + gap; c < z + h - 0.2; c += gap) S.line(frontArc(T, x, y, c, r));
        // ribs down the half of the roof we see
        const c = T.cam, phi = Math.atan2(c.fy, c.fx), n = Math.max(4, Math.round((Math.PI * r * T.k) / 1.3));
        for (let i = 1; i < n; i++) {
            const a = phi + Math.PI / 2 + (Math.PI * i) / n, ca = Math.cos(a), sa = Math.sin(a);
            const at = (rr, zz) => [x + rr * ca, y + rr * sa, zz];
            S.line([at(r + 0.2, z + h + 0.02), at(1.2, apex - 0.7 * pitch + 0.05)]);
        }
    }

    // Bucket elevator: a tall square leg with spouts down to the bins
    function grainLeg(T, x, y, z, tops) {
        const S = T.S, F = frame(x, y, z, 0), top = Math.max(...tops.map(t => t[2])) + 6;
        S.kind = INK;
        S.box(F, -0.5, -0.5, 0, 0.5, 0.5, top);
        S.box(F, -0.9, -0.9, top, 0.9, 0.9, top + 1.4);
        for (const t of tops) S.line([[x, y, top - 0.3], [(x + t[0]) / 2, (y + t[1]) / 2, (top + t[2]) / 2 + 0.3], t]);
    }

    // Quonset hut: a half round of corrugated steel with a big door in the end
    function quonset(T, F, fp) {
        const S = T.S, [a0, b0, a1, b1] = fp, w = a1 - a0;
        S.kind = INK;
        const V = vault(T, F, fp, 0, true, w / 2, 0);
        const gap = Math.max(0.9, 1.0 / T.k);
        if (T.detail) ribs(T, V, gap, INK);
        for (const [b, s] of [[b0, -1], [b1, 1]]) {
            if (!T.sees(F.V(0, s, 0))) continue;
            const at = (u, c) => F.P(s < 0 ? a1 - u : a0 + u, b, c), dw = w * 0.55;
            S.loop([at(w / 2 - dw / 2, 0), at(w / 2 + dw / 2, 0), at(w / 2 + dw / 2, w * 0.3), at(w / 2 - dw / 2, w * 0.3)]);
            if (T.detail) for (let i = 1; i < 4; i++) S.line([at(w / 2 - dw / 2, (w * 0.3 * i) / 4), at(w / 2 + dw / 2, (w * 0.3 * i) / 4)]);
        }
    }

    // Pole barn for the machinery, open down one long side
    function machineShed(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, L = a1 - a0, h = rng.range(4.6, 5.4);
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(rng.range(18, 24)), rng, { attic: false }));
        const W = wall(F, 0, fp);
        if (!T.sees(W.n)) return;
        const n = Math.max(2, Math.round(L / 7));
        for (let i = 0; i < n; i++) {
            const s0 = (L * i) / n + 0.5, s1 = (L * (i + 1)) / n - 0.5;
            if (i % 2 === 0) kit.garageDoor(T, W.at, s0, 0, s1 - s0, h - 0.9);
            else S.loop([W.at(s0, 0), W.at(s1, 0), W.at(s1, h - 0.9), W.at(s0, h - 0.9)]);
        }
    }

    // Windpump: a steel lattice tower with a fan of blades and a tail vane,
    // and a stock tank at its foot
    function windpump(T, x, y, z, rng, tank = null) {
        const S = T.S, H = rng.range(10, 12), w0 = 1.7, w1 = 0.4;
        const F = turned(x, y, z, rng.range(0, TAU)), P = F.P;
        S.kind = INK;
        const leg = (sa, sb, c) => { const w = geo.lerp(w0, w1, c / H); return P(sa * w, sb * w, c); };
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sa, sb] of corners) S.line([leg(sa, sb, 0), leg(sa, sb, H)]);
        const bays = 3;
        for (let i = 0; i < bays; i++) {
            const c0 = (H * i) / bays, c1 = (H * (i + 1)) / bays;
            for (let e = 0; e < 4; e++) {
                const [pa, pb] = corners[e], [qa, qb] = corners[(e + 1) % 4], n = F.V((pa + qa) / 2, (pb + qb) / 2, 0);
                S.line([leg(pa, pb, c1), leg(qa, qb, c1)]);
                if (T.detail && T.sees(n)) {
                    S.line([leg(pa, pb, c0), leg(qa, qb, c1)]);
                    S.line([leg(qa, qb, c0), leg(pa, pb, c1)]);
                }
            }
        }
        // the wheel faces the wind, turned partway towards us
        const cam = T.cam, face = Math.atan2(-cam.fy, -cam.fx) + rng.sign() * rng.range(0.5, 0.9);
        const W = turned(x, y, z, face), hub = W.P(0.5, 0, H + 0.8), R = 2.3;
        const at = (s, c) => W.P(0.5, s, H + 0.8 + c);
        S.line([P(0, 0, H), hub]);
        S.loop(ring(28, (c, s) => at(R * c, R * s)));
        S.loop(ring(10, (c, s) => at(R * 0.3 * c, R * 0.3 * s)));
        const n = T.detail ? 16 : 8;
        for (let i = 0; i < n; i++) {
            const a = (TAU * i) / n, c = Math.cos(a), s = Math.sin(a);
            S.line([at(R * 0.3 * c, R * 0.3 * s), at(R * c, R * s)]);
        }
        // tail vane behind
        S.line([W.P(0.3, 0, H + 0.8), W.P(-3.4, 0, H + 1.0)]);
        const vane = [W.P(-2.4, 0, H + 0.6), W.P(-4.2, 0, H + 0.4), W.P(-4.2, 0, H + 1.9), W.P(-2.4, 0, H + 1.4)];
        S.face(vane);
        S.loop(vane);
        // stock tank
        const [tx, ty] = tank || F.P(3.6, 0, 0);
        const tz = T.G.at(tx, ty);
        S.lathe(tx, ty, [[2.2, tz], [2.2, tz + 0.7]], T.segs(2.2));
        T.casting = false;
        S.kind = WATER;
        S.line(frontArc(T, tx, ty, tz + 0.55, 1.6, 10));
        T.casting = true;
        S.kind = INK;
    }

    // Shelterbelt: rows of firs from a to b, the later rows stepping `inward`
    function shelterbelt(T, a, b, inward, rng, claims, rowsN = 2) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = inward;
        const spots = [];
        for (let r = 0; r < rowsN; r++) {
            for (let s = (r % 2) * 2.4 + 1.5; s < L - 1; s += 4.8) {
                const x = a[0] + d[0] * s + n[0] * r * 4.2 + rng.range(-0.4, 0.4), y = a[1] + d[1] * s + n[1] * r * 4.2 + rng.range(-0.4, 0.4);
                if (T.P.seen(x, y, 0, -14)) spots.push([x, y]);
            }
        }
        spots.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        for (const [x, y] of spots) {
            claims.take(x, y, 2);
            fir(T, x, y, T.G.at(x, y) - 0.2, rng.range(8, 11.5), rng);
        }
    }

    // The farmstead on its lot, in a frame with u along the road and v into
    // the lot. The house is by the road with its garden and hen house, the
    // barn across the gravel yard with silos on one side and a corral on the
    // other, grain bins along the side, a machine shed at the back and a
    // shelterbelt round the back and the far side. `m` mirrors it.
    function prairieFarm(T, plan, rng, claims) {
        const S = T.S, lot = plan.lot, z = lot.z, W = lot.W, D = lot.D, [ox, oy] = lot.F.P(0, 0, 0);
        const F = frame(ox, oy, z, 0), P = F.P, m = plan.mirror;
        const fpm = (a0, b0, a1, b1) => (m > 0 ? [a0, b0, a1, b1] : [-a1, b0, -a0, b1]);
        const at = (a, b, c = 0) => P(a * m, b, c);
        const xy = (a, b) => at(a, b).slice(0, 2);
        const du = plan.drive.u;
        T.casting = true;
        // shelterbelt along the back and the far side
        shelterbelt(T, xy(-W / 2 + 2, D / 2 - 2), xy(W / 2 - 2, D / 2 - 2), [0, -1], rng, claims, 2);
        shelterbelt(T, xy(-W / 2 + 2, -D / 2 + 18), xy(-W / 2 + 2, D / 2 - 10), [m, 0], rng, claims, 2);
        // the barn across the yard, its doors facing it
        const bw = rng.range(12, 13.5), bl = rng.range(22, 25), bu = rng.range(-4, 3);
        const bv1 = D / 2 - 14, bv0 = bv1 - bl, barnFp = fpm(bu - bw / 2, bv0, bu + bw / 2, bv1);
        gambrelBarn(T, F, barnFp, rng, rng.weighted([[6, 'gambrel'], [2.5, 'arch'], [1.5, 'gable']]));
        // a lean-to down the side we see
        const side = T.sees(F.V(1, 0, 0)) ? 1 : 3, bwall = wall(F, side, barnFp);
        if (rng.chance(0.65)) leanTo(T, bwall, bl * 0.15, bl * 0.85, 4.5, 3.6, 2.5);
        // silos on the far side of the barn from the corral
        const ns = rng.weighted([[3, 1], [2, 2]]);
        for (let i = 0; i < ns; i++) {
            const [sx, sy] = xy(bu - bw / 2 - 3.8, bv0 + 4 + i * 7);
            silo(T, sx, sy, z, 3, rng.range(16, 19) - i * 2.5, rng);
        }
        // corral beside the barn with cattle in it and the windpump at its corner
        const c0 = bu + bw / 2 + (side === 1 && m > 0 || side === 3 && m < 0 ? 6.5 : 2), c1 = c0 + rng.range(14, 18);
        const corral = [[c0, bv0 + 1], [c1, bv0 + 1], [c1, bv1 + 2], [c0, bv1 + 2]];
        for (let i = 0; i < 4; i++) {
            const [a, b] = corral[i], [c, d] = corral[(i + 1) % 4];
            if (i === 0) {
                const gm = (a + c) / 2;
                boardFence(T, at(a, b), at(gm - 1.8, b));
                boardFence(T, at(gm + 1.8, b), at(c, d));
            } else boardFence(T, at(a, b), at(c, d));
        }
        const [wx, wy] = xy(c1 - 2.5, bv1 - 1), [tx, ty] = xy(c1 - 6.5, bv1 - 2);
        claims.take(wx, wy, 2.5);
        claims.take(tx, ty, 2.8);
        windpump(T, wx, wy, z, rng, [tx, ty]);
        const coat = rng.chance(0.5) ? 'holstein' : 'dark';
        for (let i = rng.int(2, 5); i > 0; i--) {
            const [x, y] = xy(rng.range(c0 + 2, c1 - 2), rng.range(bv0 + 4, bv1 - 1));
            if (!claims.free(x, y, 2)) continue;
            claims.take(x, y, 2);
            cow(T, x, y, rng.sign(), rng, coat);
        }
        // grain bins in a row down the side of the yard, a leg beside them
        const nb = rng.int(2, 4), br = rng.range(4, 4.8), tops = [], bx = W / 2 - 10;
        for (let i = 0; i < nb; i++) {
            const [x, y] = xy(bx, -D / 2 + 14 + br + i * (2 * br + 2.4));
            const h = rng.range(6.5, 8.5);
            grainBin(T, x, y, z, br, h);
            tops.push([x, y, z + h + (br - 0.5) * Math.tan(geo.rad(30)) + 0.6]);
        }
        if (nb > 1) grainLeg(T, ...xy(bx - br - 2, -D / 2 + 14 + br + (nb - 1) * (br + 1.2)), z, tops);
        // the house near the road, with its lawn, garden, hen house and washing
        const hw = rng.range(10, 11.5), hd = rng.range(7.5, 8.5), hu = -W / 2 + 15, hb = -D / 2 + 12;
        const houseFp = fpm(hu, hb, hu + hw, hb + hd);
        const { ell } = farmhouse(T, F, houseFp, rng);
        claims.poly([xy(hu - 1, hb - 3), xy(hu + hw + 1, hb - 3), xy(hu + hw + 1, ell[3] + 1), xy(hu - 1, ell[3] + 1)].map(q => q));
        for (let i = 0; i < 4; i++) {
            const [x, y] = xy(hu + rng.range(-4, hw + 2), -D / 2 + rng.range(3, 7));
            if (claims.free(x, y, 3.5)) { claims.take(x, y, 3.5); tree(T, x, y, z, rng); }
        }
        // the hen house goes behind the half of the house the ell isn't on
        const ellMid = (ell[0] + ell[2]) / 2 * m, hen = ellMid > hu + hw / 2 ? hu + 0.5 : hu + hw - 3.5;
        henHouse(T, F, m > 0 ? hen : -(hen + 2.2), hb + hd + 4.5);
        const ga = hu + hw + 3, gb = hb + 2;
        if (ga + 9 < du - 3) {
            garden(T, F, ...fpm(ga, gb, ga + 9, gb + 8));
            kit.clothesline(T, frame(...xy(ga - 1.5, gb + 1), z, 1), 0, 0, 6, rng);
        }
        // the machine shed or a quonset at the back corner
        const qa = -W / 2 + 18, quon = rng.chance(0.5);
        if (quon) quonset(T, F, fpm(qa, bv0 - 6, qa + 11, bv1));
        else machineShed(T, F, fpm(qa - 2, bv1 - 12, qa + 18, bv1), rng);
        // wheel tracks across the gravel yard, from the end of the drive to the barn, the shed and the bins
        S.kind = SOIL;
        const yard = fpm(du - 12, -D / 2 + 22, bx - br - 4, bv0 - 1), ya = [yard[0], yard[2]];
        const from = [du, -D / 2 + 21];
        for (const to of [[bu, bv0 - 0.5], [quon ? qa + 5.5 : qa + 8, quon ? bv0 - 6.5 : bv1 - 12.5], [bx - br - 1, -D / 2 + 16 + br]]) {
            const mid = [(from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.15, (from[1] + to[1]) / 2];
            const curve = Array.from({ length: 13 }, (_, i) => {
                const t = i / 12, a = (1 - t) * (1 - t) * from[0] + 2 * t * (1 - t) * mid[0] + t * t * to[0], b = (1 - t) * (1 - t) * from[1] + 2 * t * (1 - t) * mid[1] + t * t * to[1];
                return xy(a, b);
            });
            for (const s of [-0.85, 0.85]) for (const d of dashes(sidePath(curve, s), 2.2, 1.2)) S.line(d.map(([x, y]) => [x, y, z + 0.05]));
        }
        fuelTank(T, ...xy(qa + 6, bv0 - 11), z, rng.range(0, TAU));
        baleStack(T, ...xy(bu, bv1 + 5.5), 0, rng.int(3, 5));
        // pickup by the house, tractor and truck in the yard, people and the dog about
        kit.car(T, ...xy(hu + hw + 1.5, -D / 2 + 8), z, 0, rng, false, 'pickup');
        tractor(T, ...xy(du + rng.range(2, 8), bv0 - 6), rng.range(0, TAU));
        const [mx, my] = xy(du + 3.5, -D / 2 + 1.5);
        mailbox(T, mx, my, T.G.at(mx, my), 0);
        for (let i = rng.int(1, 3); i > 0; i--) {
            const [x, y] = xy(rng.range(ya[0] + 3, ya[1] - 3) * m, rng.range(yard[1] + 2, yard[3] - 2));
            if (claims.free(x, y, 1)) person(T, x, y, z, rng);
        }
        dog(T, ...xy(du - 2, -D / 2 + 26), z, rng.sign());
        T.casting = false;
    }

    // ------------------------------------------------------------------
    // Hedgerow farm buildings
    // ------------------------------------------------------------------

    // Level boards across a wall (from kit.wall), mm apart on paper, round any holes ([s, c] polygons)
    function weatherboard(T, W, c0, c1, holes, kind = INK, mm = 1.05) {
        const a = W.at(0, 0), b = W.at(1, 0), u = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), per = apart(T, u, UP);
        if (per < 0.2) return;
        inKind(T.S, kind, () => {
            for (const [p, q] of geo.hatch([rectPoly([0, c0, W.len, c1]), ...holes], mm / per, 0)) T.S.line([W.at(...p), W.at(...q)]);
        });
    }

    // Cone roof with its slopes hatched like Castle Town's tower roofs: lines
    // down the side we see, stopping at staggered heights so they never close
    // up to nothing towards the top
    function cone(T, x, y, R, z, h, n) {
        T.S.lathe(x, y, [[R, z], [R * 0.025, z + h * 0.975], [0, z + h]], n);
        if (!T.tones) return;
        const S = T.S, cam = T.cam, Re = R * 1.015 + 0.003;
        const rim = a => [x + Re * Math.cos(a), y + Re * Math.sin(a), z + 0.01];
        const apex = cam.project(x, y, z + h);
        let i = 0;
        for (let a = 0; a < TAU - 1e-6;) {
            const c = Math.cos(a), s = Math.sin(a), nn = [c * h, s * h, R];
            const lit = T.lit(nn), gap = lit ? T.hLit : T.hLit * 0.75;
            const q0 = cam.project(...rim(a)), q1 = cam.project(...rim(a + 0.01));
            const tx = (q1[0] - q0[0]) / 0.01, ty = (q1[1] - q0[1]) / 0.01;
            const lx = apex[0] - q0[0], ly = apex[1] - q0[1], ll = Math.hypot(lx, ly) || 1;
            const across = Math.abs(tx * ly - ty * lx) / ll;
            if (T.sees(nn)) {
                const j = i++ % 8, lv = j ? Math.log2(j & -j) : 3;
                const f = geo.clamp(1 - (T.hLit * 0.55) / (gap * 2 ** lv), 0.15, 0.9);
                const top = [x + Re * (1 - f) * c, y + Re * (1 - f) * s, z + h * f];
                inKind(S, lit ? T.tones.lit : T.tones.dark, () => S.line([rim(a), top]));
            }
            a += geo.clamp(gap / Math.max(across, 1e-3), 0.02, 0.5);
        }
    }

    // Stone farmhouse: two floors, a chimney stack on each gable and a hood over the door
    function stoneHouse(T, F, fp, rng) {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, L = a1 - a0, top = 2 * kit.FLOOR + 0.3;
        S.kind = INK;
        kit.plinth(T, F, fp, 0.3, 0.1);
        S.box(F, a0, b0, 0.3, a1, b1, top);
        const R = gableRoof(T, F, fp, top, true, geo.rad(rng.range(40, 46)), rng, { attic: false });
        shadeGable(T, F, R);
        for (const a of [a0 + 0.7, a1 - 0.7]) chimney(T, F, a, (b0 + b1) / 2, R.zb, R.ridge + 0.9);
        for (let side = 0; side < 4; side++) kit.windows(T, wall(F, side, fp), { base: 0.3, floors: 2, style: 'frame', winW: 1, winH: 1.3, gap: 1.6, doors: side === 0 ? [L / 2] : [] });
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            door(T, front.at, L / 2, 0.3, 1.0, 2.1);
            const hood = gableRoof(T, F, [a0 + L / 2 - 0.9, b0 - 0.9, a0 + L / 2 + 0.9, b0], 2.75, false, geo.rad(40), rng, { attic: false });
            shadeGable(T, F, hood);
        }
        return R;
    }

    // Threshing barn: long and black-boarded under a steep roof, with a
    // midstrey, the porch for the wagons, out in the middle of the front
    function threshingBarn(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, L = a1 - a0, h = rng.range(4.2, 4.8);
        S.kind = INK;
        kit.plinth(T, F, fp, 0.5, 0.05);
        S.box(F, a0, b0, 0.5, a1, b1, h);
        const R = hipRoof(T, F, fp, h, geo.rad(rng.range(48, 54)));
        for (const W of [0, 1, 2, 3].map(sd => wall(F, sd, fp))) if (T.sees(W.n)) weatherboard(T, W, 0.6, h - 0.2, []);
        hatchHip(T, F, fp, R);
        // the midstrey: a porch with its own gable, big doors in its front
        const am = (a0 + a1) / 2 + rng.range(-0.1, 0.1) * L, mw = 5.2, md = 3.2, mh = h + 0.6;
        const mfp = [am - mw / 2, b0 - md, am + mw / 2, b0 + 0.5];
        S.kind = INK;
        S.box(F, mfp[0], mfp[1], 0, mfp[2], mfp[3], mh);
        shadeGable(T, F, gableRoof(T, F, mfp, mh, false, geo.rad(48), rng, { attic: false }));
        const W = wall(F, 0, mfp);
        if (T.sees(W.n)) {
            S.loop([W.at(0.5, 0), W.at(mw - 0.5, 0), W.at(mw - 0.5, mh - 0.4), W.at(0.5, mh - 0.4)]);
            S.line([W.at(mw / 2, 0), W.at(mw / 2, mh - 0.4)]);
        }
        for (const sd of [1, 3]) { const Ws = wall(F, sd, mfp); if (T.sees(Ws.n)) weatherboard(T, Ws, 0.1, mh - 0.2, []); }
        return R;
    }

    // Hatch the four slopes of a hip roof (from kit.hipRoof over fp)
    function hatchHip(T, F, fp, R) {
        const [a0, b0, a1, b1] = fp, oh = 0.4, A0 = a0 - oh, A1 = a1 + oh, B0 = b0 - oh, B1 = b1 + oh, P = F.P;
        const hw = Math.min(A1 - A0, B1 - B0) / 2, zb = R.zb, zr = R.ridge;
        let ridge;
        if (A1 - A0 > B1 - B0 + 0.05) ridge = [P(A0 + hw, (B0 + B1) / 2, zr), P(A1 - hw, (B0 + B1) / 2, zr)];
        else if (B1 - B0 > A1 - A0 + 0.05) ridge = [P((A0 + A1) / 2, B0 + hw, zr), P((A0 + A1) / 2, B1 - hw, zr)];
        else ridge = [P((A0 + A1) / 2, (B0 + B1) / 2, zr), P((A0 + A1) / 2, (B0 + B1) / 2, zr)];
        const c = [P(A0, B0, zb), P(A1, B0, zb), P(A1, B1, zb), P(A0, B1, zb)], centre = P((a0 + a1) / 2, (b0 + b1) / 2, zb);
        const [r0, r1] = ridge, near = q => (Math.hypot(q[0] - r0[0], q[1] - r0[1]) < Math.hypot(q[0] - r1[0], q[1] - r1[1]) ? r0 : r1);
        for (let i = 0; i < 4; i++) {
            const p = c[i], q = c[(i + 1) % 4], np = near(p), nq = near(q);
            const pts = np === nq ? [p, q, np] : [p, q, nq, np];
            shade(T, pts, outward(pts, centre));
        }
    }

    // Oast house: one or two round kilns with cone roofs and white cowls on
    // top, joined to a two-floor stowage with a hoist housing under its eaves
    function oastHouse(T, F, a, b, rng, kilns) {
        const S = T.S, P = F.P, sw = 6.5, sl = 13;
        const fp = [a - sw / 2, b, a + sw / 2, b + sl], top = 5.6;
        S.kind = INK;
        S.box(F, fp[0], fp[1], 0, fp[2], fp[3], top);
        shadeGable(T, F, gableRoof(T, F, fp, top, false, geo.rad(45), rng, { attic: false }));
        for (let sd = 0; sd < 4; sd++) kit.windows(T, wall(F, sd, fp), { base: 0, floors: 2, style: 'split', winW: 0.8, winH: 1.0, gap: 2.4 });
        // the hoist housing sticking out of the roof on the yard side
        const side = T.sees(F.V(-1, 0, 0)) ? -1 : 1, ha = side < 0 ? fp[0] : fp[2], hb = b + sl * 0.55;
        const hfp = side < 0 ? [ha - 1.2, hb - 1.1, ha + 0.6, hb + 1.1] : [ha - 0.6, hb - 1.1, ha + 1.2, hb + 1.1];
        S.box(F, hfp[0], hfp[1], top - 1.6, hfp[2], hfp[3], top + 0.6);
        shadeGable(T, F, gableRoof(T, F, hfp, top + 0.6, true, geo.rad(40), rng, { attic: false }));
        // kilns at the near end, round or the older square kind under a pyramid
        const square = rng.chance(0.3);
        for (let i = 0; i < kilns; i++) {
            const r = 3.1, ka = a + (kilns > 1 ? (i - 0.5) * 6.8 : 0), [x, y, z] = P(ka, b - r + 0.6, 0);
            S.kind = INK;
            const ch = 6.8;
            if (square) {
                const h = r * 0.95, kfp = [ka - h, b - 2 * h + 0.6, ka + h, b + 0.6];
                S.box(F, kfp[0], kfp[1], -0.3, kfp[2], kfp[3], 5.9);
                const apex = P(ka, b - h + 0.6, 5.9 + ch), e = h + 0.25;
                const base = [P(ka - e, b - h + 0.6 - e, 5.9), P(ka + e, b - h + 0.6 - e, 5.9), P(ka + e, b - h + 0.6 + e, 5.9), P(ka - e, b - h + 0.6 + e, 5.9)];
                S.solid(base.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
                const c = P(ka, b - h + 0.6, 7);
                for (let k = 0; k < 4; k++) { const tri = [base[k], base[(k + 1) % 4], apex]; shade(T, tri, outward(tri, c)); }
            } else {
                S.lathe(x, y, [[r, z - 0.3], [r * 0.94, z + 5.6]], T.segs(r));
                S.lathe(x, y, [[r * 0.98, z + 5.6], [r * 0.98, z + 5.9]], T.segs(r));
                cone(T, x, y, r * 0.98, z + 5.9, ch, T.segs(r));
            }
            // the cowl: a white hood that turns with the wind, its vane sticking out behind
            const zc = z + 5.9 + ch * 0.86, rc = 0.62;
            S.kind = INK;
            S.lathe(x, y, [[rc, zc], [rc, zc + 1.3], [rc * 0.6, zc + 1.75], [0, zc + 1.85]], 12);
            const vd = [T.cam.rx, T.cam.ry], s = rng.sign();
            const vane = [[x + vd[0] * s * rc, y + vd[1] * s * rc, zc + 1.5], [x + vd[0] * s * 2.1, y + vd[1] * s * 2.1, zc + 1.65], [x + vd[0] * s * 2.1, y + vd[1] * s * 2.1, zc + 1.05], [x + vd[0] * s * rc, y + vd[1] * s * rc, zc + 0.6]];
            S.face(vane);
            S.loop(vane);
            if (T.detail && !square) S.line(frontArc(T, x, y, z + 2.4, r * 0.97, 10).slice(3, 8));
        }
    }

    // Open-fronted cart shed on posts under a gable roof
    function cartShed(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, L = a1 - a0, h = 3.2;
        S.kind = INK;
        const back = [a0, b1 - 0.3, a1, b1];
        S.box(F, back[0], back[1], 0, back[2], back[3], h);
        for (const sd of [1, 3]) S.box(F, sd === 1 ? a1 - 0.3 : a0, b0, 0, sd === 1 ? a1 : a0 + 0.3, b1, h);
        const n = Math.max(2, Math.round(L / 3.2));
        for (let i = 1; i < n; i++) S.box(F, a0 + (L * i) / n - 0.12, b0, 0, a0 + (L * i) / n + 0.12, b0 + 0.24, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(rng.range(38, 44)), rng, { attic: false }));
    }

    // Haystack round a pole, its straw drawn down the side we see in gold
    function haystack(T, x, y) {
        const S = T.S, z = T.G.at(x, y) - 0.1, prof = [[1.8, 0], [1.9, 1.0], [1.55, 2.3], [0.8, 3.4], [0.18, 4.0], [0, 4.1]];
        S.kind = INK;
        S.lathe(x, y, prof.map(([r, h]) => [r, z + h]), T.segs(1.9));
        const face = Math.atan2(-T.cam.fy, -T.cam.fx);
        inKind(S, GOLD, () => {
            for (let i = -5; i <= 5; i++) {
                const a = face + i * 0.26, c = Math.cos(a), s = Math.sin(a);
                S.line(prof.slice(0, 5 - (i & 1)).map(([r, h]) => [x + (r * 1.02 + 0.01) * c, y + (r * 1.02 + 0.01) * s, z + h]));
            }
        });
        S.line([[x, y, z + 4.1], [x, y, z + 4.8]]);
    }

    // The farm round its yard, in the lot's frame: the house facing the lane
    // with its front garden, the threshing barn across the back, the oast
    // house down one side and the cart shed down the other, haystacks behind
    function hedgeFarm(T, plan, rng, claims) {
        const S = T.S, lot = plan.lot, z = lot.z, W = lot.W, D = lot.D;
        const F = turned(...lot.F.P(0, 0, 0).slice(0, 2), z, lot.ang), P = F.P;
        const xy = (a, b) => P(a, b, 0).slice(0, 2);
        // the house and the cart shed go on the side whose inside we can see
        const m = T.sees(F.V(1, 0, 0)) ? 1 : -1;
        const fpm = (a0, b0, a1, b1) => (m > 0 ? [a0, b0, a1, b1] : [-a1, b0, -a0, b1]);
        T.casting = true;
        const hw = rng.range(10.5, 12), hd = rng.range(6.5, 7.5), hu = -W / 2 + 7;
        const house = fpm(hu, -D / 2 + 9, hu + hw, -D / 2 + 9 + hd);
        stoneHouse(T, F, house, rng);
        // the front garden behind a low wall, with a tree or two
        S.kind = INK;
        const g = fpm(hu - 1, -D / 2 + 3, hu + hw + 1, -D / 2 + 8.2);
        S.box(F, g[0], g[1], 0, g[2], g[1] + 0.4, 0.8);
        for (let i = 0; i < 2; i++) {
            const [x, y] = xy(m * (hu + rng.range(0.5, hw - 0.5)), -D / 2 + rng.range(4.5, 6.5));
            if (claims.free(x, y, 2.5)) { claims.take(x, y, 2.5); fruitTree(T, x, y, rng, T.season === 'spring'); }
        }
        // threshing barn across the back
        const bl = rng.range(24, 28), bd = rng.range(8.5, 10), bu = rng.range(-6, 4);
        threshingBarn(T, F, [bu - bl / 2, D / 2 - 7 - bd, bu + bl / 2, D / 2 - 7], rng);
        // oast house down the far side, its kilns towards the front
        const oa = m > 0 ? W / 2 - 9 : -W / 2 + 9;
        oastHouse(T, F, oa, -D / 2 + 16, rng, rng.chance(0.55) ? 2 : 1);
        // cart shed down the side, open to the yard
        const csF = m > 0 ? turned(...xy(-W / 2 + 10, -2), z, lot.ang + Math.PI / 2) : turned(...xy(W / 2 - 10, 14), z, lot.ang - Math.PI / 2);
        cartShed(T, csF, [0, 0, 16, 6], rng);
        // haystacks and bales behind the barn, a tractor and a cart in the yard
        for (let i = 0; i < rng.int(1, 3); i++) {
            const [x, y] = xy(rng.range(-W / 2 + 14, W / 2 - 14), D / 2 - 3.5);
            if (claims.free(x, y, 3)) { claims.take(x, y, 3); haystack(T, x, y); }
        }
        const tf = tractor(T, ...xy(rng.range(-6, 2), rng.range(-6, 2)), lot.ang + rng.range(-0.4, 0.4) + (rng.chance(0.5) ? 0 : Math.PI), rng.chance(0.5) ? RED : GREEN);
        if (T.season !== 'spring') hayWagon(T, tf);
        for (let i = rng.int(1, 3); i > 0; i--) {
            const [x, y] = xy(rng.range(-10, 10), rng.range(-12, 6));
            if (claims.free(x, y, 1)) person(T, x, y, z, rng);
        }
        dog(T, ...xy(rng.range(-8, 8), -D / 2 + 14), z, rng.sign());
        T.casting = false;
    }

    // ------------------------------------------------------------------
    // Tuscan trees and buildings
    // ------------------------------------------------------------------

    // Hatch the shaded side of a cut-out (card points [u, w], w up), like the
    // round trees: everything right of `from` of the way across
    function shadeCard(T, P, outline, from, cz) {
        if (!T.tones) return;
        let u0 = Infinity, u1 = -Infinity;
        for (const [u] of outline) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
        const cut = geo.lerp(u0, u1, from), ce = T.cam.ce;
        // in page-round units, so the lines come out evenly spaced on paper
        const flat = outline.map(([u, w]) => [u, (w - cz) * ce]);
        const right = geo.clipPolygonHalfPlane(flat, [cut, 0], [1, 0]);
        if (right.length < 3) return;
        for (const [a, b] of geo.hatch([right], T.hDark / T.k, 0.9)) T.S.line([P(a[0], cz + a[1] / ce), P(b[0], cz + b[1] / ce)]);
    }

    // Italian cypress: a tall dark flame on a short trunk
    function cypress(T, x, y, rng, H = null) {
        const S = T.S, z = T.G.at(x, y) - 0.2, h = H || rng.range(11, 15), w = h * rng.range(0.1, 0.12), base = 0.7;
        const P = card(T, x, y, z, 0.2), n = 22, out = [];
        const r = t => (t < 0.28 ? w * Math.sqrt(Math.max(0, 1 - ((0.28 - t) / 0.3) ** 2)) : w * Math.pow(Math.max(0, 1 - ((t - 0.28) / 0.72) ** 1.5), 0.85));
        for (let i = 0; i <= n; i++) { const t = i / n; out.push([r(t), base + t * (h - base)]); }
        const outline = out.concat(out.slice(1, -1).reverse().map(([u, c]) => [-u, c]));
        S.kind = GREEN;
        const pts = outline.map(([u, c]) => P(u, c));
        S.face(pts);
        S.loop(pts);
        shadeCard(T, P, outline, 0.55, h * 0.4);
        S.line([P(0, 0), P(0, base)]);
    }

    // Umbrella pine: a bare trunk and a wide flat crown
    function stonePine(T, x, y, rng) {
        const S = T.S, z = T.G.at(x, y) - 0.2, h = rng.range(9, 12), R = rng.range(4.5, 6), lean = rng.range(-0.8, 0.8);
        const P = card(T, x, y, z, 0.3), ce = T.cam.ce, top = h, low = h - 3.2, out = [];
        for (let i = 0; i <= 16; i++) {
            const t = i / 16, a = Math.PI * t, bump = 1 + 0.08 * Math.sin(t * 19 + x);
            out.push([lean + R * Math.cos(a) * bump, low + (top - low) * Math.sin(a) * bump]);
        }
        for (let i = 1; i < 8; i++) out.push([lean - R + (2 * R * i) / 8, low - 0.35 * Math.sin((Math.PI * i) / 8) - 0.15]);
        S.kind = GREEN;
        const pts = out.map(([u, c]) => P(u, c));
        S.face(pts);
        S.loop(pts);
        // the underside of the crown in shade
        if (T.tones) {
            const flat = out.map(([u, c]) => [u, (c - low) * ce]);
            const under = geo.clipPolygonHalfPlane(flat, [0, 0.55 * (top - low) * ce], [0, -1]);
            if (under.length >= 3) for (const [a, b] of geo.hatch([under], T.hDark / T.k, 0)) S.line([P(a[0], low + a[1] / ce), P(b[0], low + b[1] / ce)]);
        }
        const B = card(T, x, y, z, 0);
        S.line([B(-0.15, 0), B(lean * 0.9 - 0.12, low - 0.3)]);
        S.line([B(0.15, 0), B(lean * 0.9 + 0.12, low - 0.3)]);
    }

    // Olive tree: a low lumpy grey crown on a short twisted trunk that forks
    function olive(T, x, y, rng) {
        const S = T.S, z = T.G.at(x, y) - 0.1, r = rng.range(1.9, 2.4), ce = T.cam.ce, cz = 1.6 + (r * 0.8) / ce;
        const P = card(T, x, y, z, 0.2), out = [], ph = rng.range(0, TAU);
        for (let i = 0; i < 18; i++) {
            const a = (TAU * i) / 18, b = 1 + 0.12 * Math.sin(a * 5 + ph);
            out.push([Math.cos(a) * r * b, cz + (Math.sin(a) * r * 0.8 * b) / ce]);
        }
        S.kind = GREEN;
        const pts = out.map(([u, c]) => P(u, c));
        S.face(pts);
        S.loop(pts);
        if (T.detail) S.line([P(-r * 0.4, cz - 0.1), P(-r * 0.1, cz + 0.3), P(r * 0.3, cz + 0.05)]);
        const B = card(T, x, y, z, 0), k = rng.sign() * 0.25;
        S.line([B(0, 0), B(k, 0.9), B(k - 0.45, cz - 0.6)]);
        S.line([B(k, 0.9), B(k + 0.5, cz - 0.7)]);
    }

    function oliveGrove(T, f, rng, claims) {
        T.casting = true;
        for (const [x, y] of spots(T, f, rng.range(10, 12), rng, 4, 0.05)) {
            if (!T.keep(x, y) || !claims.free(x, y, 2.6)) continue;
            claims.take(x, y, 3);
            olive(T, x, y, rng);
        }
        T.casting = false;
    }

    // Lavender: rows of round bushes, each row a run of bumps over the ground
    function lavender(T, f) {
        const S = T.S, m = Math.max(1.7, T.p.rows * 1.15);
        S.kind = BLOOM;
        rows(T, f, f.ang, m, seg => {
            const [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            // one bush every 1.3 mm on paper, each a dome with a little gap after it
            const bw = Math.max(1.1, 1.3 / Math.max(0.05, onPaper(T, d[0], d[1])));
            later(T, () => {
                for (let s = bw * 0.15; s + bw * 0.7 <= L; s += bw) {
                    const pts = [];
                    for (let k = 0; k <= 6; k++) {
                        const t = s + (bw * 0.7 * k) / 6, x = a[0] + d[0] * t, y = a[1] + d[1] * t;
                        pts.push([x, y, T.G.at(x, y) + 0.1 + 0.75 * Math.sin((Math.PI * k) / 6)]);
                    }
                    const [mx, my] = pts[3];
                    if (T.free(pts[0][0], pts[0][1]) && T.free(pts[6][0], pts[6][1]) && T.P.seen(mx, my, 0, -1)) S.line(pts, true);
                }
            });
        }, T.inset);
    }

    // Vineyard: rows of vines on wires, the leaves making a low hedge along each
    // Rows of vines and hops don't cast shadows, which would fill the field with hatching
    function vineyard(T, f) {
        rows(T, f, f.ang, Math.max(2.6, T.p.rows * 1.8), (seg, i) => {
            if (T.p.country === 'tuscan' && i % 5 === 0) dryStoneWall(T, seg, 1.2);
            else trellis(T, seg[0], seg[1], 1.6, GREEN, T.keep);
        }, T.inset + 1);
    }

    // Tulip beds: the field cut into beds along its length, each a solid
    // stripe of one color with a path between, some left green
    function tulips(T, f, rng) {
        const inner = geo.insetConvex(f.poly, T.inset);
        if (inner.length < 3) return;
        // beds always run the length of the field
        let best = 0, ang = f.ang;
        f.poly.forEach((a, i) => { const b = f.poly[(i + 1) % f.poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
        f = { ...f, ang };
        const d = [Math.cos(f.ang), Math.sin(f.ang)], n = [-d[1], d[0]];
        let lo = Infinity, hi = -Infinity;
        for (const q of inner) { const v = q[0] * n[0] + q[1] * n[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const nb = Math.max(2, Math.round((hi - lo) / rng.range(4.5, 6.5))), w = (hi - lo) / nb;
        const colors = rng.chance(0.35) ? [rng.pick([RED, GOLD, BLOOM])] : rng.shuffle([RED, GOLD, BLOOM, GREEN]).slice(0, rng.int(2, 3));
        const fine = Math.max(0.75, T.p.rows * 0.5);
        for (let i = 0; i < nb; i++) {
            const a = lo + i * w + 0.5, b = lo + (i + 1) * w - 0.5;
            let bed = geo.clipPolygonHalfPlane(inner, [n[0] * a, n[1] * a], n);
            bed = geo.clipPolygonHalfPlane(bed, [n[0] * b, n[1] * b], [-n[0], -n[1]]);
            if (bed.length < 3) continue;
            const kind = colors[i % colors.length];
            T.S.kind = kind;
            if (kind === GREEN) rows(T, { poly: bed }, f.ang, T.p.rows, seg => { for (const q of dashRow(T, seg, 0.7, 0.7)) lay(T, q, 0.1, T.free); }, 0);
            else rows(T, { poly: bed }, f.ang, fine, seg => lay(T, seg, 0.15, T.free), 0);
        }
    }

    // Plowed clay in big wavy furrows, the way the Tuscan hills get turned in autumn
    function clods(T, f) {
        T.S.kind = SOIL;
        rows(T, f, f.ang, T.p.rows * 0.9, seg => lay(T, wavy(seg, 0.5), 0.1, T.free), T.inset);
    }

    // Tuscan farmhouse: a stone block of two floors under a low hip roof with
    // a dovecote tower rising out of it, a loggia in a lower wing, an outside
    // stair up to the first floor door and green shutters
    function casale(T, F, fp, rng) {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, L = a1 - a0, top = 0.3 + 2 * kit.FLOOR;
        S.kind = INK;
        kit.plinth(T, F, fp, 0.3, 0.12);
        S.box(F, a0, b0, 0.3, a1, b1, top);
        const R = hipRoof(T, F, fp, top, geo.rad(rng.range(22, 26)));
        hatchHip(T, F, fp, R);
        // the tower, its top ringed with pigeon holes under a little hip roof
        const tw = 4.6, ta = rng.chance(0.5) ? a0 + 1.2 : a1 - 1.2 - tw, tb = (b0 + b1) / 2 - tw / 2 + rng.range(-0.8, 0.8);
        const tfp = [ta, tb, ta + tw, tb + tw], tt = R.ridge + 3.8;
        S.box(F, tfp[0], tfp[1], top - 1, tfp[2], tfp[3], tt);
        S.box(F, tfp[0] - 0.15, tfp[1] - 0.15, tt - 1.6, tfp[2] + 0.15, tfp[3] + 0.15, tt - 1.45);
        const TR = hipRoof(T, F, tfp, tt, geo.rad(24));
        hatchHip(T, F, tfp, TR);
        for (let sd = 0; sd < 4; sd++) {
            const W = wall(F, sd, tfp);
            if (!T.sees(W.n)) continue;
            for (let i = 0; i < 4; i++) S.loop([W.at(0.55 + i * 1.05, tt - 1.15), W.at(0.95 + i * 1.05, tt - 1.15), W.at(0.95 + i * 1.05, tt - 0.6), W.at(0.55 + i * 1.05, tt - 0.6)]);
            pane(T, W.at, tw / 2 - 0.35, tt - 3.4, 0.7, 1.1, null);
        }
        chimney(T, F, rng.chance(0.5) ? a0 + L * 0.7 : a0 + L * 0.3, b1 - 2, R.zb, R.ridge + 0.7);
        // windows with shutters either side
        for (let sd = 0; sd < 4; sd++) {
            const W = wall(F, sd, fp);
            if (!T.sees(W.n)) continue;
            const n = Math.max(1, Math.floor(W.len / 3.4)), step = W.len / n;
            for (let f = 0; f < 2; f++) {
                for (let i = 0; i < n; i++) {
                    const s = (i + 0.5) * step, c = 0.3 + f * kit.FLOOR + 0.9;
                    if (sd === 0 && f === 0 && i === Math.floor(n / 2)) continue;
                    S.kind = INK;
                    pane(T, W.at, s - 0.4, c, 0.8, 1.2, 'split');
                    if (T.k > 0.75) {
                        S.kind = GREEN;
                        for (const u of [s - 0.82, s + 0.42]) pane(T, W.at, u, c, 0.4, 1.2, null);
                    }
                }
            }
        }
        S.kind = INK;
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            // the outside stair up the front to a door on the first floor
            const s0 = L * 0.18, s1 = s0 + 4.4, c1 = 0.3 + kit.FLOOR;
            const q = (s, c, out) => { const w = front.at(s, c); return [w[0] + front.n[0] * out, w[1] + front.n[1] * out, w[2]]; };
            S.solid([q(s0, 0, 0), q(s1, 0, 0), q(s1, c1, 0), q(s0, 0, 1.3), q(s1, 0, 1.3), q(s1, c1, 1.3)], [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [0, 2, 5, 3]]);
            S.line([q(s0, 0.9, 1.3), q(s1, c1 + 0.9, 1.3), q(s1 + 1.4, c1 + 0.9, 1.3)]);
            S.box(F, a0 + s1, b0 - 1.3, c1 - 0.25, a0 + s1 + 1.5, b0, c1);
            door(T, front.at, s1 + 0.75, c1, 0.9, 2.0);
            door(T, front.at, L / 2 + 1.5, 0.3, 1.1, 2.2);
        }
        return { R, tfp };
    }

    // A lower wing with a loggia of round arches along its front, and a
    // pergola in front of it
    function loggiaWing(T, F, fp, rng) {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, L = a1 - a0, h = 3.6;
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(22), rng, { attic: false }));
        const W = wall(F, 0, fp);
        if (T.sees(W.n)) {
            const n = Math.max(2, Math.round(L / 3)), step = L / n;
            for (let i = 0; i < n; i++) kit.arch(T, W.at, (i + 0.5) * step, 0, step * 0.62, h - 0.7);
        }
        // pergola: posts, beams and a vine along the top
        const pb = b0 - 4.2, pz = 2.5;
        for (const a of [a0 + 0.3, (a0 + a1) / 2, a1 - 0.3]) S.line([P(a, pb, 0), P(a, pb, pz)]);
        S.line([P(a0 + 0.3, pb, pz), P(a1 - 0.3, pb, pz)]);
        const nb = Math.max(3, Math.round(L / 1.4));
        for (let i = 0; i <= nb; i++) S.line([P(a0 + 0.3 + ((L - 0.6) * i) / nb, pb - 0.3, pz), P(a0 + 0.3 + ((L - 0.6) * i) / nb, b0, pz + 0.2)]);
        S.kind = GREEN;
        S.line(Array.from({ length: 25 }, (_, i) => P(a0 + 0.3 + ((L - 0.6) * i) / 24, pb + 1.4 + 0.45 * Math.sin(i * 1.3), pz + 0.25)));
        S.kind = INK;
    }

    // Hay barn with its big openings closed by brick screens laid in a lattice
    function fienile(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, L = a1 - a0, h = rng.range(5, 5.8);
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(rng.range(20, 24)), rng, { attic: false }));
        for (const sd of [0, 1, 3]) {
            const W = wall(F, sd, fp);
            if (!T.sees(W.n)) continue;
            const n = sd === 0 ? 2 : 1, ow = Math.min(2.6, W.len / (n + 1));
            for (let i = 0; i < n; i++) {
                const s = (W.len * (i + 1)) / (n + 1) - ow / 2, c0 = 1.6, c1 = h - 0.8;
                const box = [W.at(s, c0), W.at(s + ow, c0), W.at(s + ow, c1), W.at(s, c1)];
                S.loop(box);
                if (!T.detail) continue;
                const { pu } = { pu: apart(T, UP, unit([box[1][0] - box[0][0], box[1][1] - box[0][1], 0])) };
                const gap = Math.max(0.5, 1.1 / Math.max(pu, 0.2));
                for (let t = -ow; t < c1 - c0; t += gap) {
                    // diagonals both ways, clipped to the opening
                    for (const sg of [1, -1]) {
                        const pts = [];
                        for (const [u, v] of [[0, t], [ow, t + sg * ow]]) pts.push([u, v]);
                        const [p0, p1] = pts, clip = clipSeg(p0, p1, ow, c1 - c0);
                        if (clip) S.line(clip.map(([u, v]) => W.at(s + u, c0 + v)));
                    }
                }
            }
            if (sd === 0) door(T, W.at, L / 2, 0, 1.6, 2.6, true);
        }
    }

    // Segment a-b cut to the box 0..w × 0..h
    function clipSeg(a, b, w, h) {
        let t0 = 0, t1 = 1;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const pp = [-dx, dx, -dy, dy], qq = [a[0], w - a[0], a[1], h - a[1]];
        for (let i = 0; i < 4; i++) {
            if (pp[i] === 0) { if (qq[i] < 0) return null; continue; }
            const r = qq[i] / pp[i];
            if (pp[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        if (t1 - t0 < 1e-6) return null;
        return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
    }

    // Wayside chapel: a little gable with a bell hung in an arch over the front
    function chapel(T, x, y, ang, rng) {
        const S = T.S, z = T.G.at(x, y), F = turned(x, y, z, ang), P = F.P, fp = [-3.2, -4.6, 3.2, 4.6], h = 5.4;
        S.kind = INK;
        kit.plinth(T, F, fp, 0.4, 0.3);
        S.box(F, fp[0], fp[1], 0.4, fp[2], fp[3], h);
        const R = gableRoof(T, F, fp, h, false, geo.rad(28), rng, { attic: false });
        shadeGable(T, F, R);
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            kit.arch(T, front.at, 3.2, 0.4, 1.6, 3.0);
            S.loop(ring(12, (c, s) => front.at(3.2 + 0.55 * c, h + 0.8 + 0.55 * s)));
        }
        // the bell gable: a thin wall standing up over the front with an arch for the bell
        const bz = R.ridge, bw = 1.6;
        S.box(F, -bw / 2, fp[1] - 0.1, bz - 0.6, bw / 2, fp[1] + 0.35, bz + 1.6);
        S.lathe(...P(0, fp[1] - 0.1, 0).slice(0, 2), [[0.15, bz + 1.6], [0.15, bz + 2.0], [0, bz + 2.1]], 6);
        const W = wall(F, 0, [-bw / 2, fp[1] - 0.1, bw / 2, fp[1] + 0.35]);
        if (T.sees(W.n)) kit.arch(T, W.at, bw / 2, bz + 0.1, 0.6, 1.1);
        return F;
    }

    function yardWall(T, F, a, b, h = 1.1) {
        const S = T.S, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < 0.1) return;
        const nx = -dy / L * 0.3, ny = dx / L * 0.3;
        const base = [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
        S.kind = SOIL;
        S.prism(base.map(q => F.P(...q, -0.6)), F.V(0, 0, h + 0.6));
        if (T.detail && h * T.k > 0.8) S.line([F.P(a[0] - nx, a[1] - ny, h * 0.45), F.P(b[0] - nx, b[1] - ny, h * 0.45)]);
    }

    function encloseYard(T, F, W, D, h = 1.1) {
        const x = W / 2 - 2, y = D / 2 - 2;
        for (const [a, b] of [[[-x, -y], [-4, -y]], [[4, -y], [x, -y]], [[x, -y], [x, y]], [[x, y], [-x, y]], [[-x, y], [-x, -y]]]) yardWall(T, F, a, b, h);
        T.S.kind = INK;
        for (const a of [-4, 4]) {
            T.S.box(F, a - 0.5, -y - 0.5, -0.4, a + 0.5, -y + 0.5, h + 0.9);
            T.S.box(F, a - 0.65, -y - 0.65, h + 0.9, a + 0.65, -y + 0.65, h + 1.15);
        }
    }

    function well(T, F, a, b) {
        const S = T.S, [x, y, z] = F.P(a, b, 0), r = 1.3;
        S.kind = INK;
        S.lathe(x, y, [[r, z], [r, z + 0.9], [r + 0.15, z + 1.05]], 16);
        S.loop(ring(16, (c, s) => [x + r * 0.75 * c, y + r * 0.75 * s, z + 1.06]));
        for (const u of [-1.7, 1.7]) S.box(F, a + u - 0.13, b - 0.13, 0, a + u + 0.13, b + 0.13, 3.4);
        S.line([F.P(a - 1.7, b, 2.1), F.P(a + 1.7, b, 2.1)]);
        S.line([F.P(a, b, 2.1), F.P(a, b, 0.65)]);
        shadeGable(T, F, gableRoof(T, F, [a - 2.2, b - 1.7, a + 2.2, b + 1.7], 3.4, true, geo.rad(28), null, { attic: false }));
    }

    function pergola(T, F, fp) {
        const S = T.S, [a0, b0, a1, b1] = fp, h = 3.2;
        S.kind = SOIL;
        for (const a of [a0, (a0 + a1) / 2, a1]) for (const b of [b0, b1]) S.box(F, a - 0.15, b - 0.15, 0, a + 0.15, b + 0.15, h);
        for (const b of [b0, b1]) S.line([F.P(a0 - 0.4, b, h), F.P(a1 + 0.4, b, h)]);
        const n = Math.max(3, Math.floor((a1 - a0) * onPaper(T, ...F.V(1, 0, 0)) / 1.3));
        for (let i = 0; i <= n; i++) {
            const a = geo.lerp(a0, a1, i / n);
            S.line([F.P(a, b0 - 0.4, h), F.P(a, b1 + 0.4, h)]);
        }
        S.kind = GREEN;
        for (const v of [0.25, 0.65]) S.line(Array.from({ length: n * 3 + 1 }, (_, i) => F.P(geo.lerp(a0, a1, i / (n * 3)), geo.lerp(b0, b1, v) + 0.5 * Math.sin(i * 1.4), h + 0.2)));
        S.kind = SOIL;
        const a = (a0 + a1) / 2, b = (b0 + b1) / 2;
        S.box(F, a - 2.4, b - 0.7, 0.9, a + 2.4, b + 0.7, 1.1);
        for (const db of [-1.4, 1.4]) S.box(F, a - 2.4, b + db - 0.25, 0.5, a + 2.4, b + db + 0.25, 0.7);
    }

    function wineCellar(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, h = 5;
        S.kind = INK;
        kit.plinth(T, F, fp, 0.35, 0.2);
        S.box(F, a0, b0, 0.35, a1, b1, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(23), rng, { attic: false }));
        const W = wall(F, 0, fp), L = a1 - a0;
        if (T.sees(W.n)) {
            for (const s of [L * 0.25, L * 0.75]) kit.arch(T, W.at, s, 0.35, 2.8, 3.6);
            pane(T, W.at, L / 2 - 0.4, 3.5, 0.8, 0.8, null);
        }
        for (const side of [1, 2, 3]) {
            const wallSide = wall(F, side, fp);
            if (!T.sees(wallSide.n)) continue;
            const n = Math.max(1, Math.floor(wallSide.len / 4.5));
            for (let i = 0; i < n; i++) {
                const s = wallSide.len * (i + 0.5) / n;
                kit.arch(T, wallSide.at, s, 1.7, 1.1, 1.8);
            }
            S.line([wallSide.at(0, 0.8), wallSide.at(wallSide.len, 0.8)]);
        }
        leanTo(T, W, 0.5, L - 0.5, 3.5, 3.4, 2.7);
        S.kind = SOIL;
        for (const a of [a0 + 2, a0 + 4.5, a1 - 2]) {
            const [x, y, z] = F.P(a, b0 - 1.7, 0.2);
            S.lathe(x, y, [[0.7, z], [0.9, z + 0.7], [0.7, z + 1.5]], 12);
            for (const h of [0.3, 1.2]) S.line(frontArc(T, x, y, z + h, 0.85));
        }
    }

    function greenhouse(T, F, fp) {
        const S = T.S, [a0, b0, a1, b1] = fp, h = 2.5, ridge = 4.6, bm = (b0 + b1) / 2;
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, 0.4);
        S.prism([F.P(a0, b0, 0.4), F.P(a0, b1, 0.4), F.P(a0, b1, h), F.P(a0, bm, ridge), F.P(a0, b0, h)], F.V(a1 - a0, 0, 0));
        const n = Math.max(3, Math.floor((a1 - a0) * onPaper(T, ...F.V(1, 0, 0)) / 1.5));
        for (let i = 1; i < n; i++) {
            const a = geo.lerp(a0, a1, i / n);
            S.line([F.P(a, b0 - 0.03, 0.4), F.P(a, b0 - 0.03, h), F.P(a, bm, ridge + 0.03), F.P(a, b1 + 0.03, h), F.P(a, b1 + 0.03, 0.4)]);
        }
        for (const b of [b0, b1]) S.line([F.P(a0, b, 1.4), F.P(a1, b, 1.4)]);
        S.kind = GREEN;
        for (const b of [(b0 + bm) / 2, (bm + b1) / 2]) S.line([F.P(a0, b, (h + ridge) / 2 + 0.04), F.P(a1, b, (h + ridge) / 2 + 0.04)]);
        S.kind = INK;
        const W = wall(F, T.sees(F.V(-1, 0, 0)) ? 3 : 1, fp);
        if (T.sees(W.n)) door(T, W.at, W.len / 2, 0.4, 1.3, 2.1, true);
    }

    function drawHoldings(T, plan, rng, claims) {
        const S = T.S;
        for (const lot of plan.holdings) {
            const [x, y] = lot.F.P(0, 0, 0), F = turned(x, y, lot.z, lot.ang);
            // The third yard on is laid out the other way round, so wide views don't repeat one yard
            const m = lot.variant >= 2 ? -1 : 1, xy = (a, b) => F.P(m * a, b, 0).slice(0, 2);
            const R = ([a0, b0, a1, b1]) => m > 0 ? [a0, b0, a1, b1] : [-a1, b0, -a0, b1];
            T.casting = true;
            if (plan.country === 'tuscan') {
                encloseYard(T, F, lot.W, lot.D);
                if (lot.variant % 2 === 0) {
                    casale(T, F, R([-19, 6, -3, 16]), rng);
                    wineCellar(T, F, R([4, 7, 19, 16]), rng);
                    loggiaWing(T, F, R([-19, -9, -11, 3]), rng);
                    well(T, F, m * 2, -1);
                    pergola(T, F, R([8, -15, 19, -7]));
                } else {
                    fienile(T, F, R([-18, 5, 1, 16]), rng);
                    garden(T, F, ...R([6, 1, 19, 16]));
                    haystack(T, ...xy(-12, -4));
                    baleStack(T, ...xy(-5, -4), lot.ang, 4);
                }
                for (const a of [-20, 20]) cypress(T, ...xy(a, -15), rng, 11);
            } else if (plan.country === 'prairie') {
                machineShed(T, F, R([-22, 5, 1, 17]), rng);
                const tops = [];
                for (const a of [8, 19]) {
                    const [bx, by] = xy(a, 10);
                    grainBin(T, bx, by, lot.z, 4.3, 9);
                    tops.push([bx, by, lot.z + 11.8]);
                }
                grainLeg(T, ...xy(13.5, 2), lot.z, tops);
                if (T.p.work > 0) {
                    const tf = tractor(T, ...xy(6, -8), lot.ang, GREEN);
                    grainCart(T, tf);
                }
                baleStack(T, ...xy(-16, -2), lot.ang, 5);
                boardFence(T, F.P(m * -25, -17, 0), F.P(m * -25, 17, 0));
                shelterbelt(T, xy(-23, 19), xy(23, 19), F.V(0, -1, 0), rng, claims, 1);
            } else {
                encloseYard(T, F, lot.W, lot.D, 0.8);
                greenhouse(T, F, R([-19, 7, 3, 16]));
                greenhouse(T, F, R([-19, -5, 3, 4]));
                if (plan.country === 'hedgerows') stoneHouse(T, F, R([8, 5, 19, 15]), rng);
                else machineShed(T, F, R([7, 6, 20, 16]), rng);
                garden(T, F, ...R([8, -12, 19, 1]));
                garden(T, F, ...R([-19, -16, -5, -8]));
            }
            S.kind = SOIL;
            const nursery = plan.country === 'hedgerows' || plan.country === 'polder';
            for (const s of [-1, 1]) S.line([F.P(s * 1.3, -lot.D / 2, 0.08), F.P(m * (nursery ? 5 + s : s * 2), -7, 0.08), F.P(m * (nursery ? 5 + s : s * 5), 2, 0.08)]);
            if (T.p.people > 0) {
                person(T, ...F.P(m * 3, -7, 0), rng);
                vehicle(T, ...xy(-5, -12), lot.ang, 'pickup', rng);
            }
            claims.poly(lot.poly);
            T.casting = false;
        }
    }

    // Buildings face a shared working court, with a garden and pergola at
    // the front. The gate stays clear all the way to the winery.
    function tuscanFarm(T, plan, rng, claims) {
        const S = T.S, lot = plan.lot, z = lot.z, W = lot.W, D = lot.D;
        const F = turned(...lot.F.P(0, 0, 0).slice(0, 2), z, lot.ang), P = F.P, xy = (a, b) => P(a, b, 0).slice(0, 2);
        const m = T.sees(F.V(1, 0, 0)) ? 1 : -1;
        const fpm = (a0, b0, a1, b1) => (m > 0 ? [a0, b0, a1, b1] : [-a1, b0, -a0, b1]);
        T.casting = true;
        encloseYard(T, F, W, D, 1.35);
        const L = rng.range(22, 25), Dh = rng.range(12, 14), hb = D / 2 - 25;
        const hfp = fpm(-W / 2 + 8, hb, -W / 2 + 8 + L, hb + Dh);
        casale(T, F, hfp, rng);
        // the wing off the far end with its loggia facing the front
        const wfp = fpm(-W / 2 + 8 + L, hb + 1.5, -W / 2 + 8 + L + 11, hb + 10);
        loggiaWing(T, F, wfp, rng);
        // hay barn back on the other side
        fienile(T, F, fpm(W / 2 - 20, D / 2 - 21, W / 2 - 6, D / 2 - 7), rng);
        const CF = turned(...xy(m * (W / 2 - 13), -3), z, lot.ang - m * Math.PI / 2);
        wineCellar(T, CF, [-12, -5, 12, 5], rng);
        const gfp = fpm(-W / 2 + 7, -D / 2 + 7, -12, -8);
        garden(T, F, ...gfp);
        for (const [a, b] of [[[gfp[0], gfp[1]], [gfp[0], gfp[3]]], [[gfp[0], gfp[3]], [gfp[2], gfp[3]]], [[gfp[2], gfp[1]], [gfp[2], gfp[3]]]]) yardWall(T, F, a, b, 0.7);
        pergola(T, F, fpm(9, -D / 2 + 8, W / 2 - 8, -D / 2 + 17));
        well(T, F, m * -8, 3);
        // threshing floor: a round of paving in front of the house
        S.kind = INK;
        const [tx, ty] = xy(m * -1, -12);
        S.loop(ring(40, (c, s) => [tx + 7 * c, ty + 7 * s, z + 0.08]));
        S.loop(ring(40, (c, s) => [tx + 6.3 * c, ty + 6.3 * s, z + 0.08]));
        if (T.detail) for (let i = 0; i < 16; i++) {
            const a = TAU * i / 16;
            S.line([[tx + 6.3 * Math.cos(a), ty + 6.3 * Math.sin(a), z + 0.08], [tx + 7 * Math.cos(a), ty + 7 * Math.sin(a), z + 0.08]]);
        }
        claims.take(tx, ty, 8);
        // a straw rick and a few bales by the barn
        const [rx, ry] = xy(m * (W / 2 - 12), D / 2 - 4);
        if (claims.free(rx, ry, 3)) { claims.take(rx, ry, 3); haystack(T, rx, ry); }
        baleStack(T, ...xy(m * (W / 2 - 24), D / 2 - 9), lot.ang, 4);
        // cypresses and a pine round the house
        for (let i = 0; i < rng.int(3, 6); i++) {
            const [x, y] = xy(m * rng.range(-W / 2 + 2, -W / 2 + 6), rng.range(-D / 2 + 4, D / 2 - 4));
            if (claims.free(x, y, 1.6)) { claims.take(x, y, 1.6); cypress(T, x, y, rng); }
        }
        const [px, py] = xy(m * rng.range(0, 10), D / 2 - 4);
        if (claims.free(px, py, 4)) { claims.take(px, py, 4); stonePine(T, px, py, rng); }
        for (let i = 0; i < 4; i++) {
            const [x, y] = xy(m * (-W / 2 + 7 + i * 6), -D / 2 + 3.5);
            if (claims.free(x, y, 2.6)) { claims.take(x, y, 2.8); olive(T, x, y, rng); }
        }
        S.kind = SOIL;
        for (const s of [-1, 1]) S.line([[0, -D / 2], [5, -25], [11, -12], [11, 2], [17, 8]].map(([a, b]) => P(m * (a + s), b, 0.08)));
        if (T.p.people > 0) kit.car(T, ...xy(m * -24, -2), z, 0, rng, false, 'sedan');
        if (T.p.work > 0) tractor(T, ...xy(m * 13, 9), lot.ang + Math.PI / 2, RED);
        for (let i = Math.ceil(T.p.people * 4); i > 0; i--) {
            const [x, y] = xy(m * rng.range(-5, 10), rng.range(-3, 5));
            if (claims.free(x, y, 1)) person(T, x, y, z, rng);
        }
        if (T.p.animals > 0) dog(T, ...xy(m * 6, -5), z, rng.sign());
        T.casting = false;
    }

    // Cypresses in pairs along the white road, and the chapel at the bend
    function tuscanEdges(T, plan, rng, claims) {
        const road = plan.roads[0], cum = runLength(road.pts), L = cum[cum.length - 1];
        const wallRng = new PG.RNG(hash(T.seed, 21));
        for (const edge of cellEdges(plan.fields.map(f => f.poly))) {
            const { a, b } = edge, mid = geo.lerpPt(a, b, 0.5), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (edge.cells.length < 2 || len < 18 || !T.P.seen(...mid, 0, -30) || !wallRng.chance(0.8)) continue;
            if (len > 32 && wallRng.chance(0.3)) {
                const q0 = geo.lerpPt(a, b, 0.5 - 2.4 / len), q1 = geo.lerpPt(a, b, 0.5 + 2.4 / len);
                dryStoneWall(T, [a, q0]);
                dryStoneWall(T, [q1, b]);
                if (T.keep(...mid)) fieldGate(T, q0, q1, true);
            } else dryStoneWall(T, [a, b]);
        }
        T.casting = true;
        if (plan.chapel) {
            const { x, y } = plan.chapel;
            // stand it off the road on the side away from us
            let best = 0;
            for (let i = 0; i + 1 < road.pts.length; i++) if (Math.hypot(road.pts[i][0] - x, road.pts[i][1] - y) < 0.01) best = i;
            const a = road.pts[best], b = road.pts[best + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            let nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
            if (nx * T.cam.fx + ny * T.cam.fy < 0) { nx = -nx; ny = -ny; }
            const cx = x + nx * 11, cy = y + ny * 11;
            if (T.P.seen(cx, cy, 0, 5) && T.keep(cx, cy) && claims.free(cx, cy, 9)) {
                claims.take(cx, cy, 7);
                chapel(T, cx, cy, Math.atan2(-nx, ny), rng);
                // a cypress either side, set back behind its front
                for (const s of [-1, 1]) { const qx = cx + ((b[0] - a[0]) / l) * 6.5 * s + nx * 2, qy = cy + ((b[1] - a[1]) / l) * 6.5 * s + ny * 2; claims.take(qx, qy, 1.5); cypress(T, qx, qy, rng, rng.range(13, 16)); }
                plan.chapelAt = [cx, cy];
            }
        }
        // the avenue runs down from the farm for most of the way
        const from = L * rng.range(0.25, 0.45);
        for (const s of [-1, 1]) {
            const side = sidePath(road.pts, s * (road.hw + 2.4));
            const sc = runLength(side);
            for (let d = from + (s > 0 ? 0 : 4.5); d < sc[sc.length - 1] - 4; d += 9) {
                let i = 0;
                while (i + 2 < sc.length && sc[i + 1] < d) i++;
                const [x, y] = geo.lerpPt(side[i], side[i + 1], (d - sc[i]) / (sc[i + 1] - sc[i] || 1));
                if (!T.P.seen(x, y, 0, -16) || !claims.free(x, y, 1.4) || polyDist(plan.lot.poly, x, y) < 2 || plan.holdings.some(lot => polyDist(lot.poly, x, y) < 3)) continue;
                claims.take(x, y, 1.6);
                cypress(T, x, y, rng);
            }
        }
        T.casting = false;
    }

    function dryStoneWall(T, pts, h = 1) {
        const S = T.S, [a, b] = pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(len / T.drapeStep));
        S.kind = SOIL;
        lay(T, pts, h, T.keep);
        if (h * T.k * T.cam.ce > 0.5) lay(T, pts, 0.08, T.keep);
        // Short planar faces follow the terrain without exposing their seams.
        for (let i = 0; i < n; i++) {
            const p = geo.lerpPt(a, b, i / n), q = geo.lerpPt(a, b, (i + 1) / n);
            if (!T.keep(...p) || !T.keep(...q) || !T.P.seen(...p, 0, -4)) continue;
            const zp = T.G.at(...p), zq = T.G.at(...q);
            S.face([[...p, zp], [...q, zq], [...q, zq + h], [...p, zp + h]], false);
        }
    }

    // Trees standing out in the fields here and there: pines on the
    // hilltops and cypresses in twos and threes
    function scatterTrees(T, plan, rng, claims) {
        const { P, p } = T;
        T.casting = true;
        for (let i = Math.round(10 * p.trees * P.area); i > 0; i--) {
            const f = rng.pick(plan.fields), c = geo.centroid(f.poly), e = f.poly[rng.int(0, f.poly.length - 1)];
            const x = geo.lerp(c[0], e[0], 0.92), y = geo.lerp(c[1], e[1], 0.92);
            if (!P.seen(x, y, 0, -10) || !T.keep(x, y) || !claims.free(x, y, 5)) continue;
            claims.take(x, y, 5);
            if (rng.chance(0.45)) stonePine(T, x, y, rng);
            else for (let k = rng.int(1, 3); k > 0; k--) cypress(T, x + rng.range(-3, 3), y + rng.range(-3, 3), rng);
        }
        T.casting = false;
    }

    // ------------------------------------------------------------------
    // Polder buildings and trees
    // ------------------------------------------------------------------

    // Stolp farm: a square barn and house under one huge pyramid of thatch,
    // with a two-floor front house facing the road under a bell gable
    function stolp(T, F, cb, rng) {
        const S = T.S, P = F.P, sz = rng.range(16, 19), h = 3.2, fp = [-sz / 2, cb, sz / 2, cb + sz];
        S.kind = INK;
        kit.plinth(T, F, fp, 0.3, 0.1);
        S.box(F, fp[0], fp[1], 0.3, fp[2], fp[3], h);
        const R = hipRoof(T, F, fp, h, geo.rad(rng.range(50, 54)));
        const keep = T.tones;
        if (keep) T.tones = { ...keep, lit: GOLD };
        hatchHip(T, F, fp, R);
        T.tones = keep;
        chimney(T, F, rng.range(-1.5, 1.5), cb + sz * 0.62, R.zb, R.ridge - 0.6);
        // the big doors into the barn down the side, windows and a door in the front
        for (const sd of [1, 3]) {
            const W = wall(F, sd, fp);
            if (!T.sees(W.n)) continue;
            S.loop([W.at(sz * 0.55, 0.3), W.at(sz * 0.85, 0.3), W.at(sz * 0.85, h - 0.1), W.at(sz * 0.55, h - 0.1)]);
            if (T.detail) S.line([W.at(sz * 0.7, 0.3), W.at(sz * 0.7, h - 0.1)]);
            for (const s of [sz * 0.12, sz * 0.32]) pane(T, W.at, s, 1.1, 0.9, 1.2, 'cross');
        }
        // the front house, its gable to the road
        const fw = rng.range(8, 9.5), fd = 6.5, fh = 0.3 + 2 * 2.8, ffp = [-fw / 2, cb - fd + 0.8, fw / 2, cb + 0.8];
        S.box(F, ffp[0], ffp[1], 0, ffp[2], ffp[3], fh);
        const fr = gableRoof(T, F, [ffp[0] + 0.4, ffp[1] + 0.7, ffp[2] - 0.4, ffp[3]], fh + 0.25, false, geo.rad(56), rng, { attic: false });
        shadeGable(T, F, fr);
        kit.gableWall(T, F, ffp[0], ffp[1], 0.4, kit.neckGable(fw, fh, fr.rise));
        const front = wall(F, 0, ffp);
        if (T.sees(front.n)) {
            door(T, front.at, fw / 2, 0.3, 1.1, 2.3);
            for (const s of [fw * 0.18, fw * 0.66]) pane(T, front.at, s, 0.9, 1.1, 1.4, 'cross');
            for (const s of [fw * 0.18, fw / 2 - 0.55, fw * 0.66]) pane(T, front.at, s, 3.7, 1.1, 1.3, 'cross');
            pane(T, front.at, fw / 2 - 0.4, fh + fr.rise * 0.3, 0.8, 1.0, 'split');
        }
        for (const sd of [1, 3]) kit.windows(T, wall(F, sd, ffp), { base: 0.3, floors: 2, style: 'cross', winW: 0.9, winH: 1.2, gap: 1.4 });
        return fp;
    }

    // Hay barrack: four tall poles with a roof that slides up and down
    // them, sat on top of the hay
    function hayBarrack(T, x, y, z, ang, rng) {
        const S = T.S, F = turned(x, y, z, ang), P = F.P, s = 2.8, H = 8.5, rz = rng.range(4.2, 5.2);
        S.kind = GOLD;
        S.box(F, -s + 0.3, -s + 0.3, 0, s - 0.3, s - 0.3, rz - 0.1);
        S.kind = INK;
        for (const [a, b] of [[-s, -s], [s, -s], [s, s], [-s, s]]) S.box(F, a - 0.12, b - 0.12, 0, a + 0.12, b + 0.12, H);
        const e = s + 0.5, apex = P(0, 0, rz + 2.6);
        const base = [P(-e, -e, rz), P(e, -e, rz), P(e, e, rz), P(-e, e, rz)];
        S.solid(base.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        const c = P(0, 0, rz + 0.8);
        for (let i = 0; i < 4; i++) { const tri = [base[i], base[(i + 1) % 4], apex]; shade(T, tri, outward(tri, c)); }
        if (T.detail) {
            const sees = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([a, b]) => T.sees(F.V(a, b, 0)));
            S.kind = GOLD;
            for (const [a, b] of sees) {
                const W = wall(F, [[0, -1], [1, 0], [0, 1], [-1, 0]].findIndex(q => q[0] === a && q[1] === b), [-s + 0.3, -s + 0.3, s - 0.3, s - 0.3]);
                for (let k = 1; k < 5; k++) S.line([W.at(0, (rz * k) / 5 - 0.1), W.at(W.len, (rz * k) / 5 - 0.1)]);
            }
            S.kind = INK;
        }
    }

    // Smock mill draining the polder: an eight-sided thatched body on a
    // brick base, a cap turned to the wind and four lattice sails
    function smockMill(T, x, y, rng) {
        const S = T.S, cam = T.cam, z = T.G.at(x, y) - 0.2;
        S.kind = INK;
        S.lathe(x, y, [[6.2, z], [5.8, z + 3.6]], 8, false, Math.PI / 8);
        S.lathe(x, y, [[5.3, z + 3.6], [3.1, z + 19.5]], 8, false, Math.PI / 8);
        // thatch strokes down the faces we see
        if (T.detail) {
            const c0 = Math.atan2(cam.fy, cam.fx) + Math.PI;
            S.kind = GOLD;
            for (let a = -1.3; a <= 1.3; a += 0.16) {
                const t = c0 + a, at = (r, h) => [x + r * 1.03 * Math.cos(t), y + r * 1.03 * Math.sin(t), z + h];
                const facet = Math.cos(Math.PI / 8) / Math.cos(((t - Math.PI / 8) % (Math.PI / 4) + Math.PI / 4) % (Math.PI / 4) - Math.PI / 8);
                S.line([at(5.3 * facet, 3.9), at(3.1 * facet, 18.8)]);
            }
            S.kind = INK;
        }
        // the cap faces into the wind, here turned partway towards us
        const face = Math.atan2(-cam.fy, -cam.fx) + rng.sign() * rng.range(0.25, 0.5);
        const C = turned(x, y, z + 19.5, face), P = C.P;
        S.box(C, -2.4, -2.2, 0, 3.0, 2.2, 1.3);
        shadeGable(T, C, gableRoof(T, C, [-2.4, -2.2, 3.0, 2.2], 1.3, true, geo.rad(40), rng, { attic: false }));
        // tail pole down the back to the winding wheel on the ground
        S.line([P(-2.2, 0, 0.6), P(-11, 0, -18.5)]);
        S.line([P(-2.2, 0.6, 0.3), P(-9.5, 0.4, -15)]);
        S.loop(ring(16, (c, s) => P(-11, 1.0 * c, -18.0 + 1.0 * s)));
        // door and a window up the front
        const fw = Math.atan2(-cam.fy, -cam.fx), dd = (r, h) => [x + r * Math.cos(fw), y + r * Math.sin(fw), z + h];
        const side = [-Math.sin(fw), Math.cos(fw)];
        const quad = (r, h0, h1, w) => [h0, h0, h1, h1].map((h, i) => { const q = dd(r, h), s = (i === 0 || i === 3 ? -w : w) / 2; return [q[0] + side[0] * s, q[1] + side[1] * s, q[2]]; });
        S.loop(quad(5.95, 0.2, 2.6, 1.3));
        S.loop(quad(4.6 * 1.01, 9, 10.2, 0.8));
        // the sails, set in an X across the front of the cap
        const hub = P(3.4, 0, 1.0), sx = C.V(0, 1, 0);
        const at = (s, c) => [hub[0] + sx[0] * s, hub[1] + sx[1] * s, hub[2] + c];
        const bar = Math.max(0.9, 2 / T.k), phi0 = Math.PI / 4 + rng.range(-0.15, 0.15);
        for (let i = 0; i < 4; i++) {
            const a = phi0 + (i * Math.PI) / 2, cx = Math.cos(a), cy = Math.sin(a);
            const q = (s, t) => at(cx * s - cy * t, cy * s + cx * t);
            const s0 = 1.8, s1 = rng.range(12.5, 13.5), wd = 2.3;
            S.line([q(0, 0), q(s1 + 0.4, 0)]);
            const sail = [q(s0, 0.15), q(s1, 0.15), q(s1, wd), q(s0, wd)];
            S.face(sail);
            S.loop(sail);
            if (T.detail) {
                const n = Math.max(3, Math.round((s1 - s0) / bar));
                for (let j = 1; j < n; j++) S.line([q(s0 + ((s1 - s0) * j) / n, 0.15), q(s0 + ((s1 - s0) * j) / n, wd)]);
                S.line([q(s0, wd * 0.55), q(s1, wd * 0.55)]);
            }
        }
        const hr = 0.55;
        const hubPts = ring(10, (c, s) => at(c * hr, s * hr));
        S.face(hubPts);
        S.loop(hubPts);
    }

    // Lombardy poplar: tall and narrow with a ragged edge
    function poplar(T, x, y, rng) {
        const S = T.S, z = T.G.at(x, y) - 0.2, h = rng.range(16, 21), w = h * 0.09, P = card(T, x, y, z, 0.2), out = [];
        const n = 20;
        for (let i = 0; i <= n; i++) {
            const t = i / n, r = w * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.6) * (1 + 0.12 * Math.sin(t * 23 + x));
            out.push([r, 1.5 + t * (h - 1.5)]);
        }
        const outline = out.concat(out.slice(1, -1).reverse().map(([u, c]) => [-u * 0.95, c]));
        S.kind = GREEN;
        const pts = outline.map(([u, c]) => P(u, c));
        S.face(pts);
        S.loop(pts);
        shadeCard(T, P, outline, 0.55, h * 0.5);
        S.line([P(0, 0), P(0, 1.6)]);
    }

    // Pollard willow: a stubby trunk with a ball of thin shoots on top
    function pollard(T, x, y, rng) {
        const S = T.S, z = T.G.at(x, y) - 0.2, P = card(T, x, y, z, 0.1), th = rng.range(2, 2.6), r = rng.range(1.6, 2);
        S.kind = GREEN;
        const crown = ring(16, (c, s) => P(r * c * (1 + 0.1 * Math.sin(c * 9)), th + r * 0.9 + (r * 0.9 * s) / T.cam.ce));
        S.face(crown);
        S.loop(crown);
        if (T.detail) for (const a of [-0.5, 0, 0.5]) S.line([P(a * 0.3, th + 0.1), P(a * r * 1.3, th + r * 1.6)]);
        const tw = 0.35, trunk = [P(-tw, 0), P(tw, 0), P(tw * 1.3, th), P(-tw * 1.3, th)];
        S.face(trunk);
        S.loop(trunk);
    }

    // The polder farm: the stolp facing the road, the hay barrack and a shed
    // beside it, willows round the yard and the cows waiting by the gate
    function polderFarm(T, plan, rng, claims) {
        const S = T.S, lot = plan.lot, z = lot.z, W = lot.W, D = lot.D, [ox, oy] = lot.F.P(0, 0, 0);
        const F = frame(ox, oy, z, 0), P = F.P, xy = (a, b) => P(a, b, 0).slice(0, 2);
        const m = rng.sign(), du = plan.drive.pts[0][0] - ox;
        T.casting = true;
        const su = -m * W * 0.12;
        const SF = frame(ox + su, oy, z, 0);
        const fp = stolp(T, SF, -D / 2 + 12, rng);
        claims.poly([xy(su + fp[0] - 1, fp[1] - 8), xy(su + fp[2] + 1, fp[1] - 8), xy(su + fp[2] + 1, fp[3] + 1), xy(su + fp[0] - 1, fp[3] + 1)]);
        hayBarrack(T, ...xy(su + m * (fp[2] + 7), fp[1] + 4), z, rng.range(-0.2, 0.2), rng);
        const shed = m > 0 ? [su + fp[2] + 3, fp[3] - 9, su + fp[2] + 15, fp[3]] : [su + fp[0] - 15, fp[3] - 9, su + fp[0] - 3, fp[3]];
        S.kind = INK;
        S.box(F, shed[0], shed[1], 0, shed[2], shed[3], 3.4);
        shadeGable(T, F, gableRoof(T, F, shed, 3.4, true, geo.rad(28), rng, { attic: false }));
        kit.windows(T, wall(F, 0, shed), { base: 0, floors: 1, style: 'split', winW: 0.9, winH: 0.9, gap: 2.4 });
        // willows round the yard
        for (let s = -W / 2 + 3; s < W / 2 - 2; s += rng.range(6, 8)) {
            for (const b of [D / 2 - 3]) {
                const [x, y] = xy(s, b);
                if (claims.free(x, y, 2.4)) { claims.take(x, y, 2.4); pollard(T, x, y, rng); }
            }
        }
        for (let b = -D / 2 + 20; b < D / 2 - 6; b += rng.range(6, 8)) {
            const [x, y] = xy(-m * (W / 2 - 3), b);
            if (claims.free(x, y, 2.4)) { claims.take(x, y, 2.4); pollard(T, x, y, rng); }
        }
        tractor(T, ...xy(su + m * (fp[2] + 8), fp[1] - 4), rng.range(0, TAU), rng.chance(0.5) ? RED : GREEN);
        kit.car(T, ...xy(du + m * 5, -D / 2 + 6), z, 1, rng, false, rng.chance(0.5) ? 'van' : 'sedan');
        kit.bike(T, ...xy(su - 2, fp[1] - 2.4), z, 0, rng, false);
        for (let i = rng.int(1, 3); i > 0; i--) {
            const [x, y] = xy(rng.range(-8, 8), -D / 2 + rng.range(2, 6));
            if (claims.free(x, y, 1)) person(T, x, y, z, rng);
        }
        T.casting = false;
    }

    // Ditches round every strip, poplars down the road, the mill and the
    // river behind the dike with a boat sailing on it
    function polderEdges(T, plan, rng, claims) {
        const S = T.S, lot = plan.lot.poly, road = plan.roads[0];
        const ok = (x, y) => polyDist(lot, x, y) > 0.5 && !(Math.abs(y - road.pts[0][1]) < road.hw + 0.6) && distToPath(plan.drive.pts, x, y) > plan.drive.hw + 0.4;
        S.kind = WATER;
        for (const d of plan.ditches) for (const s of [-1, 1]) lay(T, sidePath(d, s * 1.0), 0.05, (x, y) => ok(x, y) && !T.onRoad(x, y));
        for (const lot of plan.holdings) for (const d of plan.ditches) culvert(T, lot.drive, { pts: d, hw: 1 });
        // the farm bridge over the ditch by the road
        const [dx, dy] = plan.drive.pts[0];
        S.kind = INK;
        T.casting = true;
        for (const s of [-1, 1]) {
            const x = dx + s * (plan.drive.hw + 0.3), z = T.G.at(x, dy + 3);
            S.box(frame(x, dy + 3, z, 0), -0.12, -1.6, 0, 0.12, 1.6, 0.9);
        }
        // poplars along the road on the far side
        for (let x = road.pts[0][0] + rng.range(0, 9); x < road.pts[1][0]; x += 9) {
            const y = road.pts[0][1] + road.hw + 4.6;
            if (!T.P.seen(x, y, 0, -22) || polyDist(lot, x, y) < 3 || !claims.free(x, y, 2) || Math.abs(x - dx) < 5 || plan.holdings.some(o => distToPath(o.drive.pts, x, y) < 5)) continue;
            claims.take(x, y, 2);
            poplar(T, x, y, rng);
        }
        // the mill
        if (plan.mill && T.P.seen(plan.mill.x, plan.mill.y, 0, -10)) {
            claims.take(plan.mill.x, plan.mill.y, 10);
            smockMill(T, plan.mill.x, plan.mill.y, rng);
        }
        T.casting = false;
        // the river: its water, the shore lines and ripples, and a sailing barge
        const dk = plan.dike, [r0, r1] = dk.river, zw = -0.55, P = T.P;
        S.face([[P.x0 - 80, r0 - 4], [P.x1 + 80, r0 - 4], [P.x1 + 80, r1 + 4], [P.x0 - 80, r1 + 4]].map(([x, y]) => [x, y, zw]), false);
        S.kind = WATER;
        for (const line of contour(T, zw, (x, y) => y > dk.y + 5)) S.line(line.map(q => [q[0], q[1], zw + 0.04]));
        for (let y = r0 + 4; y < r1 - 3; y += 5.5) {
            for (let x = P.x0 + rng.range(0, 10); x < P.x1; x += rng.range(9, 16)) {
                const L = rng.range(2.5, 5);
                if (T.P.seen(x, y, 0, 2)) S.line([[x, y, zw + 0.05], [x + L, y, zw + 0.05]]);
            }
        }
        const by = (r0 + r1) / 2 + rng.range(-8, 8);
        const bxs = [];
        for (let x = P.x0; x < P.x1; x += 5) if (T.P.seen(x, by, 0, 15)) bxs.push(x);
        if (bxs.length) {
            const x = bxs[Math.floor(bxs.length * rng.range(0.25, 0.75))];
            T.casting = false;
            S.kind = INK;
            kit.underway(T, x, by, rng.chance(0.5) ? 0 : Math.PI, rng, zw);
        }
        // the road along the top of each dike, and the foot of the near bank
        S.kind = INK;
        for (const yd of [dk.y, dk.far]) for (const s of [-1, 1]) lay(T, [[P.x0 - 60, yd + s * 2.2], [P.x1 + 60, yd + s * 2.2]], 0.1);
        S.kind = GREEN;
        lay(T, [[P.x0 - 60, dk.y - dk.crest - dk.run], [P.x1 + 60, dk.y - dk.crest - dk.run]], 0.08, (x, y) => !(plan.mill && Math.hypot(x - plan.mill.x, y - plan.mill.y) < 7));
        // grass on the slopes turned to us, in strokes down the bank
        if (T.detail) for (const yd of [dk.y, dk.far]) for (let x = P.x0 - 60 + rng.range(0, 6); x < P.x1 + 60; x += rng.range(4, 7)) {
            const y0 = yd - dk.crest - dk.run * rng.range(0.25, 0.4), y1 = y0 + dk.run * rng.range(0.2, 0.35);
            if (T.P.seen(x, y0, 0, -2) && !(plan.mill && Math.hypot(x - plan.mill.x, y0 - plan.mill.y) < 8)) lay(T, [[x, y0], [x + 0.6, y1]], 0.08, null, true);
        }
    }

    // ------------------------------------------------------------------
    // Things going along the roads, and in the air
    // ------------------------------------------------------------------

    // A car, pickup, van or truck heading along `ang`, built like kit.car but turned to any angle
    function vehicle(T, x, y, ang, type, rng) {
        const S = T.S, z = T.G.at(x, y), F = turned(x, y, z, ang);
        S.kind = INK;
        const wheelsAt = (xs, hw, r) => { for (const a of xs) for (const b of [-1, 1]) wheel(T, F, a, b * (hw + 0.04), r); };
        if (type === 'pickup') {
            const L = 5, hw = 0.95, r = 0.44;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.15);
            kit.cabin(T, F, -0.6, 1.0, -0.5, 0.55, hw - 0.05, 1.15, 1.9);
            S.box(F, -L / 2 + 0.05, -hw + 0.02, 1.15, -0.75, hw - 0.02, 1.55);
            wheelsAt([-L / 2 + 0.95, L / 2 - 0.95], hw, r);
        } else if (type === 'truck') {
            // grain truck: a cab and a high open box behind
            const L = 8, hw = 1.2, r = 0.5;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2 - 2.2, hw, 2.9);
            S.box(F, L / 2 - 2.1, -hw + 0.05, r * 0.8, L / 2, hw - 0.05, 1.5);
            kit.cabin(T, F, L / 2 - 2.1, L / 2 - 0.1, L / 2 - 2.1, L / 2 - 0.8, hw - 0.05, 1.5, 2.7);
            wheelsAt([-L / 2 + 1.2, -L / 2 + 2.4, L / 2 - 1.1], hw, r);
        } else if (type === 'van') {
            const L = 5, hw = 0.98, r = 0.42;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.2);
            kit.cabin(T, F, -L / 2, L / 2 - 0.35, -L / 2, L / 2 - 1.1, hw, 1.2, 2.1);
            wheelsAt([-L / 2 + 0.9, L / 2 - 0.9], hw, r);
        } else {
            const L = 4.2, hw = 0.9, r = 0.39;
            S.box(F, -L / 2, -hw, r * 0.75, L / 2, hw, 1.02);
            kit.cabin(T, F, -1.45, 0.85, -1.1, 0.3, hw - 0.06, 1.02, 1.65);
            wheelsAt([-L / 2 + 0.8, L / 2 - 0.85], hw, r);
        }
    }

    // Flat trailer stacked with square bales, hitched behind a tractor frame
    function baleTrailer(T, F) {
        const S = T.S;
        S.kind = INK;
        S.box(F, -7.2, -1.2, 0.9, -2.6, 1.2, 1.1);
        for (const b of [-1, 1]) wheel(T, F, -4.9, b * 1.25, 0.45);
        S.line([F.P(-2.6, 0, 1.0), F.P(-1.7, 0, 0.9)]);
        S.kind = GOLD;
        for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 4 - (row > 1 ? 1 : 0); i++) {
                const a0 = -7.0 + i * 1.1 + (row > 1 ? 0.55 : 0);
                S.box(F, a0, -1.1, 1.1 + row * 0.5, a0 + 1.05, 1.1, 1.6 + row * 0.5);
            }
        }
        S.kind = INK;
    }

    // Four-wheeled wagon piled high with loose hay, hitched behind a tractor frame
    function hayWagon(T, F) {
        const S = T.S, P = F.P;
        S.kind = INK;
        S.box(F, -7.6, -1.1, 0.95, -2.8, 1.1, 1.15);
        for (const a of [-7.0, -3.4]) for (const b of [-1, 1]) wheel(T, F, a, b * 1.15, 0.5);
        S.line([P(-2.8, 0, 1.0), P(-1.7, 0, 0.9)]);
        // the load, rounded over the top
        const prof = [];
        for (let i = 0; i <= 8; i++) {
            const t = (Math.PI * i) / 8;
            prof.push(P(-7.8, 1.25 * Math.cos(t), 1.15 + 0.4 + 1.5 * Math.sin(t)));
        }
        prof.push(P(-7.8, -1.25, 1.15), P(-7.8, 1.25, 1.15));
        S.kind = GOLD;
        S.prism(prof.slice(0, 9).concat([P(-7.8, -1.25, 1.15), P(-7.8, 1.25, 1.15)].reverse()), F.V(5.2, 0, 0), true);
        S.kind = INK;
    }

    // Spots along a road, a little in from its edges and spaced out
    function along(road, rng, gap) {
        const cum = runLength(road.pts), L = cum[cum.length - 1], out = [];
        let i = 0;
        for (let s = rng.range(0, gap); s < L; s += gap * rng.range(0.7, 1.4)) {
            while (i + 2 < cum.length && cum[i + 1] < s) i++;
            const a = road.pts[i], b = road.pts[i + 1], l = cum[i + 1] - cum[i] || 1, t = (s - cum[i]) / l;
            out.push({ x: geo.lerp(a[0], b[0], t), y: geo.lerp(a[1], b[1], t), d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] });
        }
        return out;
    }

    // Who's out on the roads: cars and farm traffic, people walking and riding bikes or horses
    function roadLife(T, plan, rng, claims) {
        const { p, P } = T;
        if (!p.people) return;
        T.casting = true;
        for (const road of plan.roads) {
            for (const { x: x0, y: y0, d } of along(road, rng, 70 / (0.3 + p.people))) {
                const side = rng.sign(), n = [-d[1], d[0]], lane = road.hw * 0.5 * side;
                const x = x0 + n[0] * lane, y = y0 + n[1] * lane;
                if (!P.seen(x, y, 0, 6) || !claims.free(x, y, 6) || T.wet(x, y)) continue;
                if (plan.bridge && Math.hypot(x - plan.bridge.x, y - plan.bridge.y) < plan.bridge.r + 3) continue;
                claims.take(x, y, 6);
                const ang = Math.atan2(d[1], d[0]) + (side < 0 ? Math.PI : 0);
                const roll = rng.random(), c = plan.country;
                if (c === 'polder' && roll < 0.6 || c === 'tuscan' && roll < 0.3) {
                    // cyclists, the Dutch way two abreast
                    const F = turned(x, y, 0, ang);
                    for (const b of rng.chance(0.5) ? [-0.5, 0.5] : [0]) {
                        const q = F.P(0, b, 0);
                        kit.bike(T, q[0], q[1], T.G.at(q[0], q[1]), PG.isokit.nearestDir(Math.cos(ang), Math.sin(ang)), rng, true);
                    }
                } else if (c === 'hedgerows' && roll < 0.3) {
                    horse(T, x, y, Math.cos(ang) * T.cam.rx + Math.sin(ang) * T.cam.ry >= 0 ? 1 : -1, rng);
                    person(T, x + n[0] * 0.8, y + n[1] * 0.8, T.G.at(x, y), rng);
                } else if (roll < 0.55) {
                    for (let k = rng.int(1, 2); k > 0; k--) person(T, x + rng.range(-0.6, 0.6), y + rng.range(-0.6, 0.6), T.G.at(x, y), rng);
                    if (rng.chance(0.4)) dog(T, x + d[0] * 1.2, y + d[1] * 1.2, T.G.at(x, y), rng.sign());
                } else if (roll < 0.75 && c !== 'tuscan') {
                    const F = tractor(T, x, y, ang, rng.chance(0.5) ? RED : GREEN);
                    if (rng.chance(0.6)) baleTrailer(T, F);
                } else {
                    const types = c === 'prairie' ? ['pickup', 'pickup', 'truck', 'sedan'] : c === 'polder' ? ['van', 'sedan'] : ['sedan', 'sedan', 'van'];
                    vehicle(T, x, y, ang, rng.pick(types), rng);
                }
            }
        }
        T.casting = false;
    }

    // Hot air balloon: a striped envelope over a wicker basket, floating
    // high enough that its shadow lands somewhere else on the fields
    function balloon(T, rng, avoid) {
        const { S, cam, W, H } = T, z0 = rng.range(55, 80);
        // somewhere up the page that isn't in front of the farm or a landmark
        // and whose shadow lands out on the fields where it shows
        let sx, sy, x, y;
        const hits = b => avoid.some(r => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]);
        for (let k = 0; ; k++) {
            if (k === 30) return;
            sx = W * rng.range(0.12, 0.88);
            sy = H * rng.range(0.1, 0.36);
            [x, y] = cam.ground(sx, sy, z0 + 10);
            const h = z0 + 11 - T.G.at(x, y), gx = x + T.sun[0] * h, gy = y + T.sun[1] * h, q = cam.project(gx, gy, T.G.at(gx, gy)), r = 9 * T.k;
            if (q[0] < r || q[0] > W - r || q[1] < r || q[1] > H - r) continue;
            if (T.plan.roads.some(rd => distToPath(rd.pts, gx, gy) < rd.hw + 12) || T.wet(gx, gy) || (T.plan.creek && distToPath(T.plan.creek.pts, gx, gy) < 16)) continue;
            if (!hits([sx - 12, sy - 14, sx + 12, sy + 16]) && !hits([q[0] - r, q[1] - r * 0.7, q[0] + r, q[1] + r * 0.7])) break;
        }
        const prof = [[1.2, 0], [2.6, 3], [6.2, 7.5], [8.4, 11.5], [8.8, 14], [8.2, 17], [6.2, 20], [3.2, 22], [0, 22.8]].map(([r, h]) => [r, z0 + h]);
        S.kind = INK;
        // The envelope is convex, so its outline is the hull of its rings on paper.
        // The lathe's own outline didn't close over a shape this round.
        const n0 = 32, verts = [], faces = [];
        prof.forEach(([r, h]) => { if (r > 0) for (let i = 0; i < n0; i++) verts.push([x + r * Math.cos((TAU * i) / n0), y + r * Math.sin((TAU * i) / n0), h]); });
        const top = verts.length;
        verts.push([x, y, prof[prof.length - 1][1]]);
        const rings = prof.length - 1;
        faces.push(Array.from({ length: n0 }, (_, i) => i));
        for (let k = 0; k + 1 < rings; k++) for (let i = 0; i < n0; i++) faces.push([k * n0 + i, k * n0 + (i + 1) % n0, (k + 1) * n0 + (i + 1) % n0, (k + 1) * n0 + i]);
        for (let i = 0; i < n0; i++) faces.push([(rings - 1) * n0 + i, (rings - 1) * n0 + (i + 1) % n0, top]);
        S.solid(verts, faces, faces.map(() => 1), true);
        const toCam = [-cam.fx * cam.ce * 0.3, -cam.fy * cam.ce * 0.3, cam.se * 0.3];
        const outline = hull(verts.map((v, i) => { const q = cam.project(v[0], v[1], v[2]); return [q[0], q[1], i]; })).map(q => verts[q[2]]);
        S.loop(outline.map(v => [v[0] + toCam[0], v[1] + toCam[1], v[2] + toCam[2]]));
        S.loop(ring(n0, (c, q) => [x + 1.22 * c, y + 1.22 * q, z0]));
        // the gores, every other one filled in a stripe color, on the side we see
        const n = 16, phi = Math.atan2(cam.fy, cam.fx), stripe = rng.pick([RED, GOLD, BLOOM]);
        const meridian = a => prof.slice(1, -1).map(([r, h]) => [x + r * 1.02 * Math.cos(a), y + r * 1.02 * Math.sin(a), h]);
        for (let i = 0; i < n; i++) {
            const a0 = (TAU * i) / n, a1 = (TAU * (i + 1)) / n, mid = (a0 + a1) / 2;
            if (Math.cos(mid - phi) > -0.05) continue;
            S.kind = INK;
            S.line(meridian(a0));
            if (i % 2 || !T.detail) continue;
            S.kind = stripe;
            const steps = Math.max(2, Math.round((8.8 * (a1 - a0) * T.k) / 0.55));
            for (let k = 1; k < steps; k++) S.line(meridian(geo.lerp(a0, a1, k / steps)));
        }
        S.kind = INK;
        // basket and its ropes
        const F = turned(x, y, z0 - 4.5, Math.atan2(cam.ry, cam.rx) + 0.5);
        S.box(F, -0.7, -0.7, 0, 0.7, 0.7, 1.1);
        for (const [a, b] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) S.line([F.P(a, b, 1.1), [x + a * 1.2, y + b * 1.2, z0 + 0.2]]);
        S.line([F.P(0, 0, 1.1), [x, y, z0 + 0.2]]);
    }

    // A loose V of birds up over the fields
    function birds(T, rng) {
        const { S, cam, W, H } = T, z = rng.range(25, 40), sx = W * rng.range(0.2, 0.8), sy = H * rng.range(0.15, 0.6);
        const [x, y] = cam.ground(sx, sy, z), n = rng.int(5, 9), dir = rng.sign();
        S.kind = INK;
        for (let i = 0; i < n; i++) {
            const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
            const P = card(T, x, y, z, 0), u = -dir * row * 2.2 + rng.range(-0.4, 0.4), w = side * row * 1.5 + rng.range(-0.3, 0.3);
            const wing = rng.range(0.7, 0.9), lift = rng.range(0.2, 0.45);
            S.line([P(u - wing, w + lift), P(u - wing * 0.45, w + lift * 0.4), P(u, w), P(u + wing * 0.45, w + lift * 0.4), P(u + wing, w + lift)]);
        }
    }

    // Crop duster: a little biplane flying low over a field with spray trailing behind
    function biplane(T, plan, rng) {
        const { S, P } = T;
        const fields = plan.fields.filter(f => { const c = geo.centroid(f.poly); return P.seen(c[0], c[1], 0, 30) && polyDist(plan.lot.poly, c[0], c[1]) > 40 && !GRASS.has(f.kind) && f.kind !== 'pivot'
            && (!plan.creek || distToPath(plan.creek.pts, c[0], c[1]) > 35) && plan.roads.every(r => distToPath(r.pts, c[0], c[1]) > 25); });
        if (!fields.length) return;
        const f = rng.pick(fields), [cx, cy] = geo.centroid(f.poly), z = T.G.at(cx, cy) + rng.range(8, 11);
        // turned to cross the page, where the wings show their length
        const across = Math.atan2(T.cam.ry, T.cam.rx) + rng.range(-0.5, 0.5) + (rng.chance(0.5) ? 0 : Math.PI);
        const F0 = turned(cx, cy, z, across), m = 1.4, F = { P: (a, b, c) => F0.P(a * m, b * m, c * m), V: (a, b, c) => F0.V(a * m, b * m, c * m) };
        S.kind = INK;
        S.box(F, -3.4, -0.45, -0.45, 1.8, 0.45, 0.45);
        S.box(F, 1.8, -0.5, -0.5, 2.3, 0.5, 0.5);
        for (const c of [-0.6, 1.0]) S.box(F, -0.5, -4.4, c, 1.1, 4.4, c + 0.14);
        for (const b of [-3.0, 3.0]) for (const a of [-0.2, 0.8]) S.line([F.P(a, b, -0.46), F.P(a + 0.1, b, 1.0)]);
        S.box(F, -3.7, -1.5, 0.1, -2.7, 1.5, 0.22);
        const fin = [F.P(-3.6, 0, 0.4), F.P(-2.7, 0, 0.4), F.P(-3.45, 0, 1.6)];
        S.face(fin);
        S.loop(fin);
        if (T.tones) inKind(S, RED, () => S.hatch([F.P(-0.5, -4.4, 1.14), F.P(1.1, -4.4, 1.14), F.P(1.1, 4.4, 1.14), F.P(-0.5, 4.4, 1.14)], F.V(1, 0, 0), T.hLit));
        // the propeller, and the spray in dashes off the trailing edge of the lower wing
        S.line([F.P(2.4, -1.2, 0.35), F.P(2.4, 1.2, -0.35)]);
        S.kind = SHADOW;
        const drop = (z - T.G.at(cx, cy) - 1.5) / m;
        for (const b of [-3.6, -1.8, 0, 1.8, 3.6]) {
            const a = F.P(-0.6, b, -0.7), e = F.P(-14, b * 1.3, -drop), n = 7;
            for (let i = 0; i < n; i++) {
                const t0 = i / n, t1 = (i + 0.55) / n;
                S.line([[geo.lerp(a[0], e[0], t0), geo.lerp(a[1], e[1], t0), geo.lerp(a[2], e[2], t0)], [geo.lerp(a[0], e[0], t1), geo.lerp(a[1], e[1], t1), geo.lerp(a[2], e[2], t1)]]);
            }
        }
        S.kind = INK;
    }

    // ------------------------------------------------------------------
    // Roads and water
    // ------------------------------------------------------------------

    function drawRoad(T, r, others) {
        const S = T.S, ok = (x, y) => !others.some(o => distToPath(o.pts, x, y) < o.hw + 0.2) && !T.wet(x, y);
        S.kind = INK;
        for (const s of [-1, 1]) lay(T, sidePath(r.pts, s * r.hw), 0.1, ok);
        if (!T.detail) return;
        if (r.kind === 'paved') {
            // a dashed white line down the middle
            for (const d of dashes(r.pts, 3, 4)) lay(T, d, 0.1, ok);
        } else if (r.kind === 'gravel' || r.kind === 'white') {
            // wheel tracks
            S.kind = SOIL;
            for (const s of [-1, 1]) for (const d of dashes(sidePath(r.pts, s * Math.min(1.1, r.hw * 0.45)), 3.5, 2.5)) lay(T, d, 0.1, ok);
        }
    }

    // Power line on poles along a road, the wires sagging between them
    function powerLine(T, r, off, rng) {
        const S = T.S, G = T.G, line = sidePath(r.pts, off), [a, b] = [line[0], line[line.length - 1]];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
        const step = 45, s0 = rng.range(0, step), tops = [];
        for (let s = s0; s < L; s += step) {
            const x = a[0] + d[0] * s, y = a[1] + d[1] * s;
            if (!T.P.seen(x, y, 0, -30) || T.wet(x, y)) { tops.push(null); continue; }
            const z = G.at(x, y);
            tops.push([x, y, z]);
        }
        S.kind = INK;
        T.casting = true;
        tops.forEach(t => {
            if (!t) return;
            const [x, y, z] = t;
            S.line([[x, y, z], [x, y, z + 9]]);
            S.line([[x - n[0] * 1.1, y - n[1] * 1.1, z + 8.4], [x + n[0] * 1.1, y + n[1] * 1.1, z + 8.4]]);
        });
        T.casting = false;
        for (let i = 0; i + 1 < tops.length; i++) {
            const p = tops[i], q = tops[i + 1];
            if (!p || !q) continue;
            for (const w of [-1, 1]) {
                const pts = [];
                for (let k = 0; k <= 10; k++) {
                    const t = k / 10;
                    pts.push([geo.lerp(p[0], q[0], t) + n[0] * w, geo.lerp(p[1], q[1], t) + n[1] * w, geo.lerp(p[2], q[2], t) + 8.4 - 0.9 * 4 * t * (1 - t)]);
                }
                S.line(pts);
            }
        }
    }

    function drawCreek(T, creek, rng) {
        const S = T.S, ok = (x, y) => !T.onRoad(x, y);
        S.kind = WATER;
        for (const s of [-1, 1]) lay(T, sidePath(creek.pts, s * creek.hw), 0.05, ok);
        // a few flow marks down the middle where it's wide enough on paper
        if (creek.hw * 2 * T.k > 3) for (const d of dashes(creek.pts, 4, 9, rng.range(0, 9))) lay(T, d, 0.05, ok);
    }

    // Concrete bridge carrying a road over the creek
    function culvert(T, road, creek) {
        const S = T.S, G = T.G;
        // where the road's center line crosses the creek
        let best = null;
        for (let i = 0; i + 1 < road.pts.length; i++) {
            const a = road.pts[i], b = road.pts[i + 1];
            for (let j = 0; j + 1 < creek.pts.length; j++) {
                const c = creek.pts[j], d = creek.pts[j + 1];
                const X = geo.lineIntersect(a, [b[0] - a[0], b[1] - a[1]], c, [d[0] - c[0], d[1] - c[1]]);
                if (X && X.t >= 0 && X.t <= 1 && X.u >= 0 && X.u <= 1) best = { x: X.x, y: X.y, d: [b[0] - a[0], b[1] - a[1]] };
            }
        }
        if (!best || !T.P.seen(best.x, best.y, 0, -10)) return;
        const L = Math.hypot(...best.d), d = [best.d[0] / L, best.d[1] / L], span = creek.hw * 2 + 3;
        const za = G.at(best.x - d[0] * span / 2, best.y - d[1] * span / 2), zb = G.at(best.x + d[0] * span / 2, best.y + d[1] * span / 2);
        const z = Math.max(za, zb) + 0.15, F = turned(best.x, best.y, z, Math.atan2(d[1], d[0]));
        S.kind = INK;
        T.casting = true;
        S.box(F, -span / 2, -road.hw, -0.5, span / 2, road.hw, 0);
        for (const b of [-1, 1]) S.box(F, -span / 2, b * road.hw - 0.25, 0, span / 2, b * road.hw + 0.25, 0.8);
        T.casting = false;
    }

    // The pond: its water, a ripple or two, reeds round the bank and a few
    // trees on the far side
    function drawPond(T, pond, rng, claims) {
        const S = T.S, z = pond.z, rim = pond.rim, [cx, cy] = geo.centroid(rim);
        S.face(rim.map(([x, y]) => [x, y, z]), false);
        S.kind = WATER;
        S.loop(rim.map(([x, y]) => [x, y, z + 0.05]));
        const n = rim.length, a0 = rng.int(0, n - 1);
        for (const [f, share] of [[0.62, 0.4], [0.34, 0.3]]) {
            const pts = [];
            for (let i = 0; i <= Math.round(n * share); i++) {
                const [x, y] = rim[(a0 + i) % n];
                pts.push([cx + (x - cx) * f, cy + (y - cy) * f, z + 0.05]);
            }
            S.line(pts);
        }
        S.kind = GREEN;
        // reeds on the near bank stand further back, so they don't run up over the water on paper
        const out = q => {
            const dx = q[0] - cx, dy = q[1] - cy, near = (dx * T.cam.fx + dy * T.cam.fy) < 0, f = near ? 1.16 : 1.05;
            return [cx + dx * f + rng.range(-0.3, 0.3), cy + dy * f + rng.range(-0.3, 0.3)];
        };
        for (let i = 0; i < n; i += rng.int(1, 3)) {
            const [x, y] = out(rim[i]);
            if (T.P.seen(x, y, 0, -1)) reeds(T, x, y);
        }
        T.casting = true;
        // trees on the bank away from us, so they don't hide the water
        for (let i = 0; i < n; i++) {
            const q = rim[i], dx = q[0] - cx, dy = q[1] - cy, l = Math.hypot(dx, dy) || 1;
            if ((dx * T.cam.fx + dy * T.cam.fy) / l < 0.55 || !rng.chance(0.18 + 0.2 * T.p.trees)) continue;
            const x = q[0] + (dx / l) * 5, y = q[1] + (dy / l) * 5;
            if (!claims.free(x, y, 3)) continue;
            claims.take(x, y, 3);
            tree(T, x, y, T.G.at(x, y) - 0.2, rng);
        }
        T.casting = false;
    }

    // A clump of reeds: a few tall strokes fanning out, dropped if anything covers them
    function reeds(T, x, y) {
        const P = card(T, x, y, T.G.at(x, y), 0);
        T.S.line([P(-0.45, 1.3), P(-0.1, 0), P(0, 1.6)], true);
        T.S.line([P(0.08, 0), P(0.45, 1.2)], true);
    }

    // ------------------------------------------------------------------
    // Putting it together
    // ------------------------------------------------------------------

    // What grows in each country through the year, as [weight, kind]
    const PRAIRIE = {
        spring: [[3, 'plowed'], [3, 'seedlings'], [1.6, 'young'], [1.3, 'pasture'], [0.8, 'hay'], [0.5, 'fallow']],
        summer: [[3, 'corn'], [2.4, 'soy'], [2, 'wheat'], [1.3, 'pasture'], [1.2, 'hay'], [0.7, 'sunflowers']],
        harvest: [[2, 'drycorn'], [2.4, 'stubble'], [1.5, 'plowed'], [1.4, 'bales'], [1.0, 'pasture'], [0.3, 'orchard']],
    };
    const HEDGEROWS = {
        spring: [[2, 'plowed'], [2.4, 'young'], [1.6, 'rapeseed'], [3, 'sheep'], [1.2, 'cows'], [0.8, 'orchard'], [0.6, 'hops'], [1, 'copse']],
        summer: [[2.4, 'wheat'], [1.2, 'barley'], [1.5, 'meadow'], [2.5, 'sheep'], [1.2, 'cows'], [0.8, 'hops'], [1, 'copse'], [0.5, 'orchard']],
        harvest: [[2, 'stubble'], [2, 'plowed'], [1.5, 'bales'], [2.6, 'sheep'], [1.2, 'cows'], [0.6, 'orchard'], [1, 'copse'], [0.8, 'haystacks']],
    };
    const TUSCAN = {
        spring: [[3, 'young'], [1.6, 'vineyard'], [1.2, 'olives'], [1, 'fallow'], [1, 'meadow'], [0.6, 'lavender'], [1.2, 'plowed']],
        summer: [[2.5, 'wheat'], [2.5, 'sunflowers'], [1.6, 'vineyard'], [1.2, 'olives'], [0.7, 'lavender'], [1, 'bales']],
        harvest: [[3, 'clods'], [1.8, 'stubble'], [1.5, 'bales'], [1.6, 'vineyard'], [1.2, 'olives'], [0.5, 'sunflowers']],
    };
    const POLDER = {
        spring: [[4, 'tulips'], [3, 'cows'], [1.4, 'mown'], [1.5, 'plowed'], [1, 'young']],
        summer: [[3, 'cows'], [2, 'mown'], [2, 'potatoes'], [1.5, 'corn'], [1, 'bulbs'], [1, 'hay']],
        harvest: [[3, 'cows'], [2, 'plowed'], [1, 'stubble'], [1.5, 'corn'], [1, 'bales'], [1, 'potatoes']],
    };
    // what a field of each kind can be doing when there's work going on
    const WORK = {
        plowed: 'plowing', seedlings: 'spraying', young: 'spraying', wheat: 'harvesting', barley: 'harvesting', hay: 'baling',
        meadow: 'baling', stubble: 'plowing', drycorn: 'harvesting', soy: 'spraying', clods: 'plowing', mown: 'baling', potatoes: 'spraying',
    };

    function fillField(T, f, rng, claims) {
        const S = T.S, p = T.p, m = p.rows;
        switch (f.kind) {
            case 'corn': lineRows(T, f, GREEN, m); break;
            case 'drycorn': dashedRows(T, f, GOLD, m, 3.5, 0.45); break;
            case 'soy': dashedRows(T, f, GREEN, m * 0.85, 2.4, 0.5); break;
            case 'young': grain(T, f, GREEN, rng); break;
            case 'wheat': grain(T, f, GOLD, rng); break;
            case 'barley': dashedRows(T, f, GOLD, m * 0.9, 3.2, 0.45); break;
            case 'rapeseed': lineRows(T, f, GOLD, Math.max(0.85, m * 0.55), f.ang + Math.PI / 4); break;
            case 'seedlings': dashedRows(T, f, GREEN, m, 0.8, 0.8); break;
            case 'plowed': lineRows(T, f, SOIL, m * 0.75); break;
            case 'stubble': dashedRows(T, f, GOLD, m * 1.2, 0.6, 0.9); break;
            case 'hay': S.kind = GOLD; rows(T, f, f.ang, m * 3, seg => lay(T, wavy(seg, 0.6), 0.1, T.free), T.inset); break;
            case 'meadow': {
                tufts(T, f, rng, 45);
                T.casting = true;
                for (const [x, y] of spots(T, f, rng.range(18, 26), rng, 6, 0.3)) if (T.free(x, y) && claims.free(x, y, 3) && rng.chance(0.5)) { claims.take(x, y, 3); haystack(T, x, y); }
                T.casting = false;
                break;
            }
            case 'bales': {
                dashedRows(T, f, GOLD, m * 2, 0.4, 1.4);
                T.casting = true;
                for (const [x, y] of spots(T, f, rng.range(14, 20), rng, 6, 0.35)) {
                    if (T.free(x, y) && claims.free(x, y, 1.5) && rng.chance(0.8)) { claims.take(x, y, 1.6); bale(T, x, y, rng.range(0, TAU)); }
                }
                T.casting = false;
                break;
            }
            case 'haystacks': {
                dashedRows(T, f, GOLD, m * 1.2, 0.6, 0.9);
                T.casting = true;
                for (const [x, y] of spots(T, f, rng.range(16, 22), rng, 7, 0.3)) if (T.free(x, y) && claims.free(x, y, 3) && rng.chance(0.55)) { claims.take(x, y, 3); haystack(T, x, y); }
                T.casting = false;
                break;
            }
            case 'sunflowers': sunflowers(T, f); break;
            case 'orchard': T.casting = true; orchard(T, f, rng, claims); T.casting = false; break;
            case 'pasture': T.casting = true; pasture(T, f, rng, claims, rng.chance(0.7) ? 'cows' : 'sheep'); T.casting = false; wireFence(T, f.poly, rng.int(0, f.poly.length - 1)); break;
            case 'sheep': T.casting = true; pasture(T, f, rng, claims, 'sheep'); T.casting = false; break;
            case 'cows': T.casting = true; pasture(T, f, rng, claims, rng.chance(0.15) ? 'horses' : 'cows'); T.casting = false; break;
            case 'hops': rows(T, f, f.ang, Math.max(3.4, m * 2.4), seg => hopRow(T, seg[0], seg[1], T.keep), T.inset + 1); break;
            case 'copse': copse(T, f, rng, claims); break;
            case 'olives': oliveGrove(T, f, rng, claims); break;
            case 'vineyard': vineyard(T, f); break;
            case 'lavender': lavender(T, f); break;
            case 'clods': clods(T, f); break;
            case 'tulips': tulips(T, f, rng); break;
            case 'potatoes': dashedRows(T, f, GREEN, m * 1.05, 1.6, 0.35); break;
            case 'bulbs': dashedRows(T, f, GREEN, m * 0.85, 0.5, 0.5); break;
            case 'mown': S.kind = GREEN; rows(T, f, f.ang, m * 2.6, seg => lay(T, wavy(seg, 0.4), 0.1, T.free), T.inset); break;
            case 'pivot': pivot(T, f, rng, f.crop); break;
            case 'harvesting': harvesting(T, f, rng, claims); break;
            case 'plowing': plowing(T, f, rng, claims, f.before); break;
            case 'spraying': spraying(T, f, rng, claims); break;
            case 'baling': baling(T, f, rng, claims); break;
            default: tufts(T, f, rng, 90);
        }
    }

    // A wood of mixed trees filling a field, the oaks and firs packed close
    function copse(T, f, rng, claims) {
        const pts = spots(T, f, 6.5, rng, 2.5, 0.45);
        T.casting = true;
        for (const [x, y] of pts) {
            if (!T.keep(x, y) || !claims.free(x, y, 2.6)) continue;
            claims.take(x, y, 2.6);
            if (rng.chance(0.3)) fir(T, x, y, T.G.at(x, y) - 0.2, rng.range(8, 12), rng);
            else tree(T, x, y, T.G.at(x, y) - 0.2, rng);
        }
        T.casting = false;
    }

    // Each country's plan, farm, crops and the things along its field edges
    const COUNTRIES = {
        prairie: { plan: planPrairie, farm: prairieFarm, kinds: PRAIRIE, inset: 3 },
        hedgerows: { plan: planHedgerows, farm: hedgeFarm, kinds: HEDGEROWS, inset: 3.8, edges: hedgerows },
        polder: { plan: planPolder, farm: polderFarm, kinds: POLDER, inset: 2.2, edges: polderEdges },
        tuscan: { plan: planTuscan, farm: tuscanFarm, kinds: TUSCAN, inset: 3.2, edges: (T, plan, rng, claims) => { tuscanEdges(T, plan, rng, claims); scatterTrees(T, plan, rng, claims); } },
    };

    // The pond goes in a field that isn't by the lot, a little way off the creek
    function placePond(T, plan, rng) {
        const { P } = T;
        const options = plan.fields.filter(f => {
            const [cx, cy] = geo.centroid(f.poly);
            return !f.far && Math.abs(geo.polygonArea(f.poly)) > 1500 && P.seen(cx, cy, 0, 15) && polyDist(plan.lot.poly, cx, cy) > 45 && plan.holdings.every(lot => polyDist(lot.poly, cx, cy) > 24) && (!plan.creek || distToPath(plan.creek.pts, cx, cy) > 40)
                && plan.roads.every(r => distToPath(r.pts, cx, cy) > 25);
        });
        if (!options.length) return;
        const f = rng.pick(options), [cx, cy] = geo.centroid(f.poly), R = rng.range(10, 15), ph = rng.range(0, TAU);
        plan.pond = { rim: Array.from({ length: 36 }, (_, i) => { const a = (TAU * i) / 36, q = R * (1 + 0.16 * Math.sin(2 * a + ph) + 0.08 * Math.sin(3 * a)); return [cx + q * Math.cos(a), cy + q * Math.sin(a) * 0.85]; }) };
        f.pond = true;
    }

    function build(T, seed) {
        const { S, p, P } = T;
        const C = COUNTRIES[p.country] || COUNTRIES.prairie;
        T.inset = C.inset;
        const rng = new PG.RNG(hash(seed, 1));
        const plan = C.plan(T, rng);
        T.plan = plan;
        planHoldings(T, plan, new PG.RNG(hash(seed, 20)));
        if (p.pond) placePond(T, plan, new PG.RNG(hash(seed, 6)));
        landscape(T, plan, new PG.RNG(hash(seed, 2)));
        drawGround(T);
        // keep-outs for everything laid on the ground
        const keep = new Mask(), roadMask = new Mask(), water = new Mask(), shade = new Mask(8);
        for (const r of plan.roads) { keep.line(r.pts, r.hw + (r.hedged ? 4 : 2)); roadMask.line(r.pts, r.hw + 0.5); }
        if (plan.creek) { keep.line(plan.creek.pts, plan.creek.hw + 3); water.line(plan.creek.pts, plan.creek.hw); }
        if (plan.dike) { const [r0, r1] = plan.dike.river; water.poly(rectPoly([P.x0 - 80, r0, P.x1 + 80, r1])); }
        if (plan.ditches) for (const d of plan.ditches) { water.line(d, 1.0); keep.line(d, 1.6); }
        if (plan.pond) {
            const [cx, cy] = geo.centroid(plan.pond.rim);
            keep.poly(plan.pond.rim.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * 3.5, y + ((y - cy) / l) * 3.5]; }));
            water.poly(plan.pond.rim);
        }
        keep.poly(plan.lot.poly);
        for (const lot of plan.holdings) keep.poly(lot.poly);
        if (plan.drive) keep.line(plan.drive.pts, plan.drive.hw + 1);
        T.keep = (x, y) => !keep.hit(x, y);
        T.reserve = poly => keep.poly(poly);
        T.pastureShelters = 0;
        T.free = (x, y) => !keep.hit(x, y) && !shade.hit(x, y);
        T.wet = (x, y) => water.hit(x, y);
        T.onRoad = (x, y) => roadMask.hit(x, y);
        const claims = new Claims();
        T.shadows = [];
        if (p.shadows) castOnGround(T);
        T.casting = false;

        // the farm, the roads and the water
        C.farm(T, plan, new PG.RNG(hash(seed, 4)), claims);
        claims.poly(plan.lot.poly);
        drawHoldings(T, plan, new PG.RNG(hash(seed, 22)), claims);
        S.kind = INK;
        const d = plan.drive;
        if (d) for (const s of [-1, 1]) lay(T, sidePath(d.pts, s * d.hw), 0.1, (x, y) => !T.onRoad(x, y));
        for (const r of plan.roads) drawRoad(T, r, plan.roads.filter(o => o !== r));
        const lrng = new PG.RNG(hash(seed, 7));
        if (plan.creek) {
            drawCreek(T, plan.creek, lrng);
            for (const r of plan.roads) {
                if (r.kind === 'lane') plan.bridge = stoneBridge(T, r, plan.creek);
                else culvert(T, r, plan.creek);
            }
            // trees along the banks
            T.casting = true;
            for (const s of [-1, 1]) {
                const bank = sidePath(plan.creek.pts, s * (plan.creek.hw + 4.5));
                for (let i = 0; i < bank.length; i += lrng.int(3, 9)) {
                    const [x, y] = bank[i];
                    if (!lrng.chance(0.25 + 0.6 * p.trees) || T.onRoad(x, y) || !P.seen(x, y, 0, -12) || !claims.free(x, y, 3)) continue;
                    if (plan.bridge && Math.hypot(x - plan.bridge.x, y - plan.bridge.y) < plan.bridge.r + 3) continue;
                    claims.take(x, y, 3);
                    tree(T, x, y, T.G.at(x, y) - 0.2, lrng);
                }
            }
            T.casting = false;
        }
        if (plan.pond) drawPond(T, plan.pond, lrng, claims);
        for (const r of plan.roads) if (r.poles && p.detail) powerLine(T, r, r.hw + 3, lrng);
        if (C.edges) C.edges(T, plan, new PG.RNG(hash(seed, 8)), claims);
        roadLife(T, plan, new PG.RNG(hash(seed, 9)), claims);

        // what grows where, and who's at work
        const frng = new PG.RNG(hash(seed, 3));
        const kinds = C.kinds[p.season].map(([w, k]) => [k === 'copse' ? w * (0.3 + p.trees) : k === 'cows' || k === 'sheep' || k === 'pasture' ? w * (0.4 + p.animals) : w, k]);
        const live = plan.fields.filter(f => { const c = geo.centroid(f.poly); return f.poly.length >= 3 && P.seen(c[0], c[1], 0, -60); });
        for (const f of live) {
            // rows run along the field's longest edge, or across it now and then
            let best = 0, ang = 0;
            f.poly.forEach((a, i) => { const b = f.poly[(i + 1) % f.poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
            f.ang = frng.chance(0.75) ? ang : ang + Math.PI / 2;
            f.kind = frng.weighted(kinds);
            // each crop gets less likely once it's been picked, so one doesn't take over the page
            const pick = kinds.find(k => k[1] === f.kind);
            pick[0] *= f.kind === 'tulips' ? 0.85 : 0.6;
        }
        // one big square field can be under a pivot
        if (p.country === 'prairie' && p.season !== 'spring') {
            const big = live.filter(f => { const [x0, y0, x1, y1] = bounds(f.poly), c = geo.centroid(f.poly); return Math.min(x1 - x0, y1 - y0) > 90 && !f.pond && P.seen(c[0], c[1], 0, -20); });
            if (big.length && frng.chance(0.75)) { const f = frng.pick(big); f.kind = 'pivot'; f.crop = p.season === 'summer' ? GREEN : GOLD; }
        }
        let machines = 0;
        const order = live.slice().sort((a, b) => {
            const ca = geo.centroid(a.poly), cb = geo.centroid(b.poly), qa = T.cam.project(ca[0], ca[1], 0), qb = T.cam.project(cb[0], cb[1], 0);
            return Math.hypot(qa[0] - T.W / 2, qa[1] - T.H / 2) - Math.hypot(qb[0] - T.W / 2, qb[1] - T.H / 2);
        });
        for (const f of order) {
            const job = WORK[f.kind];
            if (!job || f.far || machines >= Math.round((1 + Math.round(p.work * 2)) * Math.max(1, P.area)) || !frng.chance(p.work) || f.pond) continue;
            const c = geo.centroid(f.poly);
            if (!P.seen(c[0], c[1], 0, 20) || Math.abs(geo.polygonArea(f.poly)) < 1800) continue;
            f.before = f.kind;
            f.kind = job;
            machines++;
        }
        // Things standing in the fields cast their shadows as the fields are
        // filled, so the lines on the ground wait until they're all in
        T.queue = [];
        for (const f of live) fillField(T, f, frng, claims);
        if (p.fliers) {
            const arng = new PG.RNG(hash(seed, 10));
            T.casting = true;
            // screen boxes of the things the balloon shouldn't hang in front of
            const avoid = [], box = pts => { const q = pts.map(([x, y, z]) => T.cam.project(x, y, z)), b = bounds(q); avoid.push([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4]); };
            box(plan.lot.poly.flatMap(([x, y]) => [[x, y, plan.lot.z], [x, y, plan.lot.z + 22]]));
            for (const lot of plan.holdings) box(lot.poly.flatMap(([x, y]) => [[x, y, lot.z], [x, y, lot.z + 18]]));
            if (plan.mill) box([[plan.mill.x - 13, plan.mill.y, 0], [plan.mill.x + 13, plan.mill.y, 34]]);
            if (plan.chapelAt) box([[plan.chapelAt[0] - 6, plan.chapelAt[1], T.G.at(...plan.chapelAt)], [plan.chapelAt[0] + 6, plan.chapelAt[1], T.G.at(...plan.chapelAt) + 16]]);
            if (arng.chance(0.75)) balloon(T, arng, avoid);
            if (p.country === 'prairie' && p.season !== 'harvest' && arng.chance(0.6)) biplane(T, plan, arng);
            T.casting = false;
            for (let i = arng.int(1, 2); i > 0; i--) birds(T, arng);
        }
        for (const sh of T.shadows) shade.poly(sh);
        const queue = T.queue;
        T.queue = null;
        for (const fn of queue) fn();
        if (p.hillShade) {
            const grass = new Mask();
            for (const f of live) {
                if (!GRASS.has(f.kind)) continue;
                const inner = geo.insetConvex(f.poly, T.inset + 0.5);
                if (inner.length >= 3) grass.poly(inner);
            }
            // well clear of the water, or the shading round a bank reads as ripples
            const nearWater = new Mask();
            if (plan.pond) nearWater.poly(plan.pond.rim.map(([x, y]) => { const [cx, cy] = geo.centroid(plan.pond.rim), l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * 10, y + ((y - cy) / l) * 10]; }));
            if (plan.creek) nearWater.line(plan.creek.pts, plan.creek.hw + 9);
            hillShade(T, (x, y) => grass.hit(x, y) && T.free(x, y) && !nearWater.hit(x, y));
        }
        if (p.shadows) hatchShadows(T, p.shadowGap);
    }

    // Fields left to grass, which get the hill shading
    const GRASS = new Set(['pasture', 'sheep', 'cows', 'meadow', 'fallow']);

    PG.register({
        id: 'farmland',
        name: 'Farmland',
        category: 'Scenes',
        description: 'A farm and the fields round it on the prairie, in hedgerow country, in the Tuscan hills or on a polder, with machines at work, livestock and the crops of the season.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'size', label: 'View width (m)', type: 'range', min: 140, max: 420, step: 5, value: 190, random: [170, 240],
                hint: 'How much of the country fits across the page. Smaller brings the farm closer' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 40, random: [30, 55] },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 25, max: 60, step: 0.5, value: 38, random: [33, 45] },
            { type: 'section', label: 'Farm' },
            { id: 'country', label: 'Landscape', type: 'select', value: 'prairie', random: true,
                options: [['prairie', 'Prairie'], ['hedgerows', 'Hedgerows'], ['tuscan', 'Tuscan hills'], ['polder', 'Polder']] },
            { id: 'season', label: 'Season', type: 'select', value: 'summer', random: true,
                options: [['spring', 'Spring'], ['summer', 'Summer'], ['harvest', 'Harvest']] },
            { id: 'hills', label: 'Rolling hills', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1], show: p => p.country !== 'polder' },
            { id: 'fieldSize', label: 'Field size', type: 'range', min: 0.5, max: 1.6, step: 0.01, value: 1, random: [0.7, 1.3] },
            { id: 'holdings', label: 'Outlying farmyards', type: 'checkbox', value: true, random: 0.9,
                hint: 'Connected cottages and a winery, a grain yard, or glasshouses and market gardens. Wider views fit more' },
            { id: 'creek', label: 'Creek', type: 'checkbox', value: true, random: 0.75, show: p => p.country !== 'polder',
                hint: 'The polder has ditches and a river behind the dike instead' },
            { id: 'pond', label: 'Pond', type: 'checkbox', value: true, random: 0.6 },
            { id: 'work', label: 'Machines at work', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1] },
            { id: 'animals', label: 'Livestock', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1] },
            { id: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'people', label: 'People & traffic', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.8] },
            { id: 'fliers', label: 'Balloon & birds', type: 'checkbox', value: true, random: 0.6, hint: 'A hot air balloon, birds and on the prairie a crop duster' },
            { id: 'rows', label: 'Row spacing (mm)', type: 'range', min: 0.9, max: 3, step: 0.05, value: 1.5, random: false,
                hint: 'Gap between crop rows on paper. Each crop spaces its rows from this' },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Board walls, wheel tracks, power lines, truss work and other small line work' },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Roof hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Roof hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false, show: p => p.roofHatch },
            { id: 'hillShade', label: 'Hill shading', type: 'checkbox', value: true, hint: 'Short strokes down the grassy slopes turned from the sun' },
            { id: 'hillGap', label: 'Hill shading spacing (mm)', type: 'range', min: 0.5, max: 2.5, step: 0.05, value: 1.3, random: false, show: p => p.hillShade },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 48, random: [40, 58], show: p => p.shadows },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false, show: p => p.shadows },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        generate(p, ctx) {
            const { width: W, height: H } = ctx, seed = ctx.seed | 0;
            const se = Math.sin(geo.rad(p.elev)), ce = Math.cos(geo.rad(p.elev));
            const k = W / p.size;
            const c0 = makeCamera(p.yaw, p.elev, k, W, H, 0, 0), r = [c0.rx, c0.ry], f = [c0.fx, c0.fy];
            const U = W / k, V = H / (k * se);
            // plan u runs across the page and v away from us, from the bottom edge
            const w = (u, v) => [u * r[0] + v * f[0], u * r[1] + v * f[1]];
            const uv = (x, y) => [x * r[0] + y * r[1], x * f[0] + y * f[1]];
            const C = w(U / 2, V / 2);
            const cam = makeCamera(p.yaw, p.elev, k, W, H, C[0], C[1]);
            const S = new Scene(cam, W, H);
            // the ground runs off every edge, and further below the page where hills can reach up into it
            const reach = 45 * ce / se;
            const u0 = -12, u1 = U + 12, v0 = -reach - 12, v1 = V + 12;
            const step = geo.clamp(2.4 / k, 2.2, 4.5);
            const G = new Ground(u1 - u0, v1 - v0, step, w(u0, v0), r);
            const [x0, y0, x1, y1] = bounds([w(u0, v0), w(u1, v0), w(u1, v1), w(u0, v1)]);
            const seen = (x, y, z, m) => {
                const q = cam.project(x, y, z), e = m * k;
                return q[0] >= e && q[1] >= e && q[0] <= W - e && q[1] <= H - e;
            };
            // how much ground is in view, 1 on A4 at the default width. Farmyards and the like go up with it.
            const area = W * H / (k * k) / REF_AREA;
            const P = { U, V, w, uv, seen, x0, y0, x1, y1, area };
            // the sun is high on the left and a little behind, so shadows fall to the right and towards us
            const cot = 1 / Math.tan(geo.rad(p.sun)), sd = unit([0.85 * r[0] - 0.4 * f[0], 0.85 * r[1] - 0.4 * f[1], 0]);
            const sun = [sd[0] * cot, sd[1] * cot], toSun = unit([-sun[0], -sun[1], 1]);
            const T = {
                S, G, P, cam, p, k, W, H, sun, seed,
                season: p.season,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: rr => segments(rr, k),
                picket: Math.max(0.28, 0.9 / k),
                drapeStep: geo.clamp(1.2 / k, 1, 3),
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: GOLD } : null,
                waterKind: WATER,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.6,
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
                // How dark a slope is, 0 where it gets as much sun as level ground. Farm hills are
                // gentle, so a slope 10 degrees off the sun is already half dark.
                tone: n => geo.clamp((toSun[2] - (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2])) / 0.22, 0, 1),
            };
            build(T, seed);
            return PG.pens.renderScene('farmland', S, p);
        },
    });
})();
