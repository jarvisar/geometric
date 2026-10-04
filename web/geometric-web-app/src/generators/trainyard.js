/*
 * Trainyard: an isometric railway yard drawn for four to eight pens, in the
 * same illustrated-map style as Harbor and Fairground.
 *
 * Everything runs along x. From the near side of the page to the far side
 * there's the town, a station or a goods yard, the main line, the yard, the
 * engine depot and more town. The yard fans out from a lead in the middle
 * with a ladder of points above it and one below, so the tracks spread both
 * ways like the bowl of a hump yard. The depot is reached off the lead with
 * an S bend that runs under the coaling tower, and it's a roundhouse round a
 * turntable, a round engine house over one or a straight shed. The station
 * sits on a loop under canopies or an arched train shed. The town is
 * terraces, or works and gasholders, or both. The plan and the drawing are
 * separate steps (see buildYard), so everything knows where everything
 * else goes before anything is drawn.
 *
 * Track is center lines (see Track). Sleepers merge where tracks run close,
 * which gives the long timbers through a set of points for free. Most of the
 * rolling stock is boxes, prisms and solids of revolution along the track,
 * with the paint as hatching on the roofs, ribs down the sides or bands round
 * a boiler. Steam is a chain of lumpy cut-outs that trail back along a moving
 * train or rise off a standing one.
 *
 * Red is for lit roofs and red paint, blue for shadows and steam, gold for
 * canopies, lining and yellow paint. Five pens give the track a brown of its
 * own, six to eight add green trees, purple people and light blue steam.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, hull, Scene, segments, BOX } = PG.iso;
    const kit = PG.isokit;
    const { wall, rect, pane, door, windows, gableRoof, unit, outward, shade, shadeGable, shadeRound, inKind, withKind, arch, crookLamp } = kit;

    // line kinds. Track gets a pen of its own from five pens, plants, people and steam after that.
    const INK = 0, RED = 1, BLUE = 2, GOLD = 3, GREEN = 4, FIGURE = 5, STEAM = 6, TRACK = 7;
    const person = withKind(FIGURE, kit.person);
    const SUN_TURN = geo.rad(65); // as in Harbor: shadows fall along +x, turned this far towards -y
    const HG = 0.7175;            // half the gauge (m)
    const RAIL = 0.18;            // rail tops above the ground, where the wheels sit
    const TIE = 1.3;              // half a sleeper
    const WIRE = 5.6;             // contact wire above the ground (m)

    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const Z = [0, 0, 1];

    // Frame from an origin and three axes (unit vectors), for things at any angle
    function axes(O, U, V, W) {
        return {
            O, U, V: (a, b, c) => [a * U[0] + b * V[0] + c * W[0], a * U[1] + b * V[1] + c * W[1], a * U[2] + b * V[2] + c * W[2]],
            P: (a, b, c) => [O[0] + a * U[0] + b * V[0] + c * W[0], O[1] + a * U[1] + b * V[1] + c * W[1], O[2] + a * U[2] + b * V[2] + c * W[2]],
        };
    }

    // Fill a flat face with lines in a paint color, or 'dark' for close ink
    // lines. Only with hatching on, and only when the camera sees it (n is the
    // outward normal).
    function paint(T, pts, n, lv, dir, gap = 1) {
        if (!T.tones || !lv || !T.sees(n)) return;
        inKind(T.S, lv === 'dark' ? INK : lv, () => T.S.hatch(pts, dir, (lv === 'dark' ? T.hDark : T.hLit) * gap));
    }

    // Solid of revolution about a line along u (at v0, height c0) from [u, r]
    // pairs. Each stretch of the profile is its own smoothing group, so the
    // creases between them show and the facets don't.
    function latheU(T, F, prof, v0, c0, n = 14) {
        const v = [], f = [], g = [], rings = [];
        for (const [u, r] of prof) {
            rings.push(v.length);
            if (r <= 1e-9) { v.push(F.P(u, v0, c0)); continue; }
            for (let i = 0; i < n; i++) v.push(F.P(u, v0 + r * Math.cos((TAU * i) / n), c0 + r * Math.sin((TAU * i) / n)));
        }
        const pt = k => prof[k][1] <= 1e-9, last = prof.length - 1;
        if (!pt(0)) { f.push(Array.from({ length: n }, (_, i) => rings[0] + i)); g.push(0); }
        for (let k = 0; k < last; k++) {
            const s0 = rings[k], s1 = rings[k + 1];
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                if (pt(k + 1)) f.push([s0 + i, s0 + j, s1]);
                else if (pt(k)) f.push([s0, s1 + j, s1 + i]);
                else f.push([s0 + i, s0 + j, s1 + j, s1 + i]);
                g.push(k + 1);
            }
        }
        if (!pt(last)) { f.push(Array.from({ length: n }, (_, i) => rings[last] + i)); g.push(0); }
        T.S.solid(v, f, g);
    }

    // Ring round the u axis, for bands on a boiler or a tank
    function band(T, F, u, r, v0, c0) {
        T.S.loop(ring(Math.max(12, T.segs(r)), (c, s) => F.P(u, v0 + r * c, c0 + r * s)));
    }

    // ------------------------------------------------------------------
    // Track geometry
    // ------------------------------------------------------------------

    // Walks a center line in plan: straight runs and arcs, points about a meter apart
    class Path {
        constructor(x, y, h = 0) {
            this.x = x;
            this.y = y;
            this.h = h;
            this.pts = [[x, y]];
        }

        go(L) {
            if (L <= 1e-6) return this;
            const n = Math.max(1, Math.ceil(L)), c = Math.cos(this.h), s = Math.sin(this.h);
            for (let i = 1; i <= n; i++) this.pts.push([this.x + (c * L * i) / n, this.y + (s * L * i) / n]);
            this.x += c * L;
            this.y += s * L;
            return this;
        }

        // arc of radius R through angle a, positive to the left
        turn(R, a) {
            const sg = Math.sign(a), cx = this.x - Math.sin(this.h) * R * sg, cy = this.y + Math.cos(this.h) * R * sg;
            const a0 = this.h - (sg * Math.PI) / 2, n = Math.max(2, Math.ceil(R * Math.abs(a)));
            for (let i = 1; i <= n; i++) this.pts.push([cx + R * Math.cos(a0 + (a * i) / n), cy + R * Math.sin(a0 + (a * i) / n)]);
            this.h += a;
            this.x = cx + R * Math.cos(a0 + a);
            this.y = cy + R * Math.sin(a0 + a);
            return this;
        }

        // straight on (heading along x) until x
        to(x) {
            return this.go((x - this.x) / Math.cos(this.h));
        }
    }

    // Center line of a track. `from` and `to` are the tracks it leaves at its
    // start and joins at its end, `tie(s)` overrides the sleeper length and
    // `own` keeps its sleepers out of the merging where tracks meet (the
    // turntable spokes).
    class Track {
        constructor(pts, o = {}) {
            this.pts = pts;
            const cum = [0];
            for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
            this.cum = cum;
            this.len = cum[cum.length - 1];
            Object.assign(this, { from: null, to: null, tie: null, own: false, stop: false, z: 0 }, o);
        }

        // point and unit direction at arc length s
        at(s) {
            const { pts, cum } = this;
            s = geo.clamp(s, 0, this.len);
            let lo = 0, hi = cum.length - 1;
            while (hi - lo > 1) {
                const m = (lo + hi) >> 1;
                if (cum[m] <= s) lo = m;
                else hi = m;
            }
            const a = pts[lo], b = pts[hi], l = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / l;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l];
        }
    }

    // Sleepers and rails for every track. Tracks earlier in the list win where
    // two run close: the later one drops its sleepers there and the earlier
    // one's get longer to carry both, like the long timbers through a set of
    // points. Rails of a branch start once they've pulled clear of the track
    // they leave, so the two never draw over each other.
    function layTracks(T, tracks) {
        const { S, p } = T;
        const cell = 8, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
        tracks.forEach((t, ti) => {
            for (let k = 1; k < t.pts.length; k++) {
                const a = t.pts[k - 1], b = t.pts[k];
                for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i++) {
                    for (let j = Math.floor(Math.min(a[1], b[1]) / cell); j <= Math.floor(Math.max(a[1], b[1]) / cell); j++) {
                        const kk = key(i, j);
                        if (!grid.has(kk)) grid.set(kk, []);
                        grid.get(kk).push(ti, k);
                    }
                }
            }
        });
        // nearest point on a track listed before `upto`, or on track `only`
        const nearest = (x, y, upto, only = -1) => {
            let best = null;
            const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
            for (let di = -1; di <= 1; di++) {
                for (let dj = -1; dj <= 1; dj++) {
                    const list = grid.get(key(ci + di, cj + dj));
                    if (!list) continue;
                    for (let m = 0; m < list.length; m += 2) {
                        const ti = list[m], k = list[m + 1];
                        if (only >= 0 ? ti !== only : ti >= upto || tracks[ti].own) continue;
                        const t = tracks[ti], a = t.pts[k - 1], b = t.pts[k];
                        const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
                        const u = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / l2, 0, 1);
                        const d = Math.hypot(a[0] + ex * u - x, a[1] + ey * u - y);
                        if (!best || d < best.d) best = { t, d, s: t.cum[k - 1] + u * Math.sqrt(l2) };
                    }
                }
            }
            return best;
        };
        const sp = p.ties > 0 ? Math.max(p.ties, 1.1 / T.k) : 0;
        if (sp) {
            for (const t of tracks) {
                t.ties = [];
                for (let s = sp / 2; s < t.len; s += sp) {
                    const [x, y, tx, ty] = t.at(s), h = t.tie ? t.tie(s) : TIE;
                    t.ties.push({ x, y, nx: -ty, ny: tx, lo: -h, hi: h, off: false });
                }
            }
            tracks.forEach((t, ti) => {
                if (t.own) return;
                for (const q of t.ties) {
                    const nb = nearest(q.x, q.y, ti);
                    if (!nb || nb.d > 2.3) continue;
                    q.off = true;
                    const o = nb.t.ties[geo.clamp(Math.round((nb.s - sp / 2) / sp), 0, nb.t.ties.length - 1)];
                    if (!o) continue;
                    const d = (q.x - o.x) * o.nx + (q.y - o.y) * o.ny;
                    if (d > 0) o.hi = Math.max(o.hi, d + TIE);
                    else o.lo = Math.min(o.lo, d - TIE);
                }
            });
            S.kind = TRACK;
            for (const t of tracks) {
                const z = t.z + 0.05;
                for (const q of t.ties) {
                    if (!q.off) S.line([[q.x + q.nx * q.lo, q.y + q.ny * q.lo, z], [q.x + q.nx * q.hi, q.y + q.ny * q.hi, z]]);
                }
            }
        }
        const apart = (q, ti) => ti < 0 || (nearest(q[0], q[1], 0, ti) || { d: 1 }).d >= 0.12;
        tracks.forEach(t => {
            let a = 0, b = t.pts.length - 1;
            const fi = t.from ? tracks.indexOf(t.from) : -1, ti = t.to ? tracks.indexOf(t.to) : -1;
            while (a < b - 1 && !apart(t.pts[a], fi)) a++;
            while (b > a + 1 && !apart(t.pts[b], ti)) b--;
            const P = t.pts, z = t.z + RAIL;
            S.kind = TRACK;
            for (const side of [-1, 1]) {
                const line = [];
                for (let i = a; i <= b; i++) {
                    const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
                    line.push([P[i][0] - ((p1[1] - p0[1]) / l) * HG * side, P[i][1] + ((p1[0] - p0[0]) / l) * HG * side, z]);
                }
                S.line(line);
            }
        });
        // how far (x, y) is from the nearest track, for placing things beside them
        return (x, y) => {
            const nb = nearest(x, y, tracks.length);
            return nb ? nb.d : Infinity;
        };
    }

    // ------------------------------------------------------------------
    // Rolling stock. Builders take a frame on the rails at the middle of the
    // car, u along the track (towards the front for engines), v across and c
    // up, and the paint: RED, GOLD, 'dark' or null.
    // ------------------------------------------------------------------

    // Wheels either side at u positions, radius r, just outside the rails
    function wheelset(T, F, us, r, out = 0.1) {
        const S = T.S, n = Math.max(8, T.segs(r));
        for (const side of [-1, 1]) {
            for (const u of us) {
                const pts = ring(n, (c, s) => F.P(u + r * c, side * (HG + out), r + r * s));
                S.face(pts);
                S.loop(pts);
            }
        }
    }

    // Freight bogie: two wheelsets with the side frame across their middle
    function bogie(T, F, u, r = 0.46, wb = 1.75) {
        wheelset(T, F, [u - wb / 2, u + wb / 2], r);
        for (const side of [-1, 1]) T.S.box(F, u - wb / 2 - 0.3, side * (HG + 0.18), r * 0.55, u + wb / 2 + 0.3, side * (HG + 0.36), r * 1.45);
    }

    function couplers(T, F, L, c = 0.85) {
        for (const e of [-1, 1]) T.S.box(F, (e * L) / 2 - e * 0.1, -0.13, c - 0.1, e * (L / 2 + 0.42), 0.13, c + 0.1);
    }

    // Upright lines along a side of a car in its paint, standing in for ribs
    // or posts, skipping the gaps given as [u0, u1]
    function ribs(T, F, v, u0, u1, c0, c1, gap, lv, skip = []) {
        if (!T.detail) return;
        const kind = T.tones && lv ? (lv === 'dark' ? INK : lv) : T.S.kind;
        inKind(T.S, kind, () => {
            const n = Math.max(1, Math.round((u1 - u0) / gap));
            for (let i = 1; i < n; i++) {
                const u = u0 + ((u1 - u0) * i) / n;
                if (skip.some(([a, b]) => u > a && u < b)) continue;
                T.S.line([F.P(u, v, c0), F.P(u, v, c1)]);
            }
        });
    }

    // Flat roof slab over [u0, u1] × ±hw at height c, painted
    function slab(T, F, u0, u1, hw, c, t, lv) {
        T.S.box(F, u0, -hw, c, u1, hw, c + t);
        paint(T, [F.P(u0, -hw, c + t), F.P(u1, -hw, c + t), F.P(u1, hw, c + t), F.P(u0, hw, c + t)], Z, lv, F.V(0, 1, 0));
    }

    // Ridge of coal or ballast heaped on top of a car, hatched dark
    function heap(T, F, u0, u1, hw, c, h, lv = 'dark') {
        const r = Math.min(hw * 1.2, (u1 - u0) * 0.3);
        const v = [F.P(u0, -hw, c), F.P(u1, -hw, c), F.P(u1, hw, c), F.P(u0, hw, c), F.P(u0 + r, 0, c + h), F.P(u1 - r, 0, c + h)];
        const f = [[0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5]];
        T.S.solid(v, f);
        const centre = F.P((u0 + u1) / 2, 0, c + h * 0.3);
        for (const q of f.slice(1)) {
            const pts = q.map(i => v[i]);
            paint(T, pts, outward(pts, centre), lv, F.V(1, 0, 0));
        }
    }

    function boxcar(T, F, L, lv, rng, reefer = false) {
        const S = T.S, hw = 1.5, d = 1.2, h = reefer ? 4 : 4.25, e = L / 2;
        bogie(T, F, -(e - 2.1));
        bogie(T, F, e - 2.1);
        couplers(T, F, L);
        S.box(F, -e, -hw, d - 0.3, e, hw, d);
        S.box(F, -e + 0.1, -hw + 0.05, d, e - 0.1, hw - 0.05, h);
        slab(T, F, -e, e, hw + 0.06, h, 0.12, lv);
        const dw = reefer ? 1.8 : 2.6, dh = h - d - 0.4;
        for (const side of [-1, 1]) {
            const b = side * (hw - 0.05);
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, b, c);
            rect(T, at, -dw / 2, d + 0.12, dw, dh);
            if (T.detail) {
                if (reefer) {
                    for (const c of [d + 0.7, h - 0.8]) S.line([at(-dw / 2 - 0.25, c), at(-dw / 2 + 0.3, c)]);
                    S.line([at(dw / 2 - 0.2, d + 1.3), at(dw / 2 - 0.2, h - 1.3)]);
                } else {
                    S.line([at(-dw / 2 - dw * 0.9, h - 0.12), at(dw / 2 + 0.2, h - 0.12)]);
                    S.line([at(-dw / 2 + 0.12, d + 0.3), at(dw / 2 - 0.12, h - 0.6)]);
                }
            }
            ribs(T, F, b, -e + 0.1, e - 0.1, d + 0.12, h - 0.08, reefer ? 1.6 : 1.05, lv, [[-dw / 2 - 0.2, dw / 2 + 0.2]]);
        }
        // ladder on the end we can see
        for (const s of [-1, 1]) {
            if (!T.detail || !T.sees(F.V(s, 0, 0))) continue;
            const u = s * (e - 0.1);
            for (const v of [-0.95, -0.55]) S.line([F.P(u, v, d + 0.2), F.P(u, v, h - 0.2)]);
            for (let c = d + 0.5; c < h - 0.2; c += 0.45) S.line([F.P(u, -0.95, c), F.P(u, -0.55, c)]);
        }
    }

    function tankCar(T, F, L, lv, rng) {
        const S = T.S, e = L / 2, r = 1.3, c0 = 1.4 + r, Lt = L - 2.4;
        bogie(T, F, -(e - 1.9));
        bogie(T, F, e - 1.9);
        couplers(T, F, L);
        S.box(F, -e, -0.35, 0.95, e, 0.35, 1.3);
        for (const s of [-1, 1]) S.box(F, s * e, -1.45, 1.05, s * (Lt / 2 + 0.1), 1.45, 1.3);
        latheU(T, F, [[-Lt / 2 - 0.5, r * 0.45], [-Lt / 2, r], [Lt / 2, r], [Lt / 2 + 0.5, r * 0.45]], 0, c0, 18);
        const [x, y, z] = F.P(0, 0, c0 + r - 0.2);
        S.lathe(x, y, [[0.6, z], [0.6, z + 0.6], [0.35, z + 0.72]], 12);
        // saddles down to the sill
        for (const u of [-Lt * 0.32, Lt * 0.32]) S.box(F, u - 0.25, -0.9, 1.3, u + 0.25, 0.9, c0 - r * 0.75);
        if (T.detail) for (const s of [-1, 1]) S.line([F.P(-Lt / 2 + 0.3, s * (r + 0.1), c0 + 0.15), F.P(Lt / 2 - 0.3, s * (r + 0.1), c0 + 0.15)]);
        if (!T.tones || !lv) return;
        if (lv === 'dark') {
            // lines along the tank round its underside, closer together further down
            const toCam = [-T.cam.fx * T.cam.ce, -T.cam.fy * T.cam.ce], vc = toCam[0] * F.V(0, 1, 0)[0] + toCam[1] * F.V(0, 1, 0)[1];
            // from the side facing the camera round and down the near side
            const th = Math.atan2(T.cam.se, vc), sg = th > Math.PI / 2 ? 1 : -1, m = Math.max(3, Math.round((r * T.k) / (T.hDark * 1.3)));
            inKind(S, INK, () => {
                for (let i = 0; i < m; i++) {
                    const a = th + sg * Math.PI * (0.22 + 0.6 * Math.sqrt(i / m));
                    S.line([F.P(-Lt / 2, (r + 0.01) * Math.cos(a), c0 + (r + 0.01) * Math.sin(a)), F.P(Lt / 2, (r + 0.01) * Math.cos(a), c0 + (r + 0.01) * Math.sin(a))]);
                }
            });
        } else {
            inKind(S, lv, () => {
                for (const u of [-Lt * 0.36, -Lt * 0.33, Lt * 0.33, Lt * 0.36]) band(T, F, u, r + 0.01, 0, c0);
            });
        }
    }

    // Covered hopper, or an open one heaped with coal
    function hopper(T, F, L, lv, rng, open = false) {
        const S = T.S, e = L / 2, hw = 1.5, h = open ? 3.6 : 4.1, zb = 1.7;
        bogie(T, F, -(e - 1.8));
        bogie(T, F, e - 1.8);
        couplers(T, F, L);
        S.box(F, -e, -0.3, 0.95, e, 0.3, 1.25);
        S.box(F, -e + 0.15, -hw, zb, e - 0.15, hw, h);
        const nb = open ? 2 : 3, span = L - 5, bl = span / nb;
        for (let i = 0; i < nb; i++) {
            const uc = -span / 2 + bl * (i + 0.5);
            S.prism([F.P(uc - bl / 2 + 0.05, -hw + 0.12, zb), F.P(uc + bl / 2 - 0.05, -hw + 0.12, zb), F.P(uc + 0.35, -hw + 0.12, 0.85), F.P(uc - 0.35, -hw + 0.12, 0.85)], F.V(0, 2 * hw - 0.24, 0));
        }
        for (const side of [-1, 1]) if (T.sees(F.V(0, side, 0))) ribs(T, F, side * hw, -e + 0.15, e - 0.15, zb, h, 1.35, lv);
        if (open) {
            if (T.detail) S.loop([F.P(-e + 0.3, -hw + 0.15, h), F.P(e - 0.3, -hw + 0.15, h), F.P(e - 0.3, hw - 0.15, h), F.P(-e + 0.3, hw - 0.15, h)]);
            heap(T, F, -e + 0.35, e - 0.35, hw - 0.2, h, 0.75);
        } else {
            slab(T, F, -e + 0.1, e - 0.1, hw + 0.04, h, 0.1, lv);
            if (T.detail) S.loop([F.P(-e + 1, -0.35, h + 0.1), F.P(e - 1, -0.35, h + 0.1), F.P(e - 1, 0.35, h + 0.1), F.P(-e + 1, 0.35, h + 0.1)]);
        }
    }

    // Open wagon with walls, empty or carrying scrap, coils, pipes or coal
    function gondola(T, F, L, lv, rng) {
        const S = T.S, e = L / 2, hw = 1.5, d = 1.2, h = 2.5, t = 0.1;
        bogie(T, F, -(e - 2));
        bogie(T, F, e - 2);
        couplers(T, F, L);
        S.box(F, -e, -hw, d - 0.3, e, hw, d);
        S.box(F, -e, -hw, d, e, -hw + t, h);
        S.box(F, -e, hw - t, d, e, hw, h);
        S.box(F, -e, -hw + t, d, -e + t, hw - t, h);
        S.box(F, e - t, -hw + t, d, e, hw - t, h);
        for (const side of [-1, 1]) if (T.sees(F.V(0, side, 0))) ribs(T, F, side * hw, -e, e, d, h, 1.2, lv);
        const load = rng.weighted([[3, 'scrap'], [2, 'coils'], [2, 'pipes'], [1.5, 'none'], [2, 'coal']]);
        if (load === 'coal') heap(T, F, -e + t, e - t, hw - t, h - 0.3, 0.8);
        else if (load === 'coils') {
            const n = Math.floor((L - 2) / 2.6);
            for (let i = 0; i < n; i++) {
                const u = -((n - 1) * 2.6) / 2 + i * 2.6;
                latheU(T, F, [[u - 0.75, 0.85], [u + 0.75, 0.85]], 0, d + 0.85, 16);
                if (T.detail) {
                    for (const s of [-1, 1]) if (T.sees(F.V(s, 0, 0))) band(T, F, u + s * 0.76, 0.35, 0, d + 0.85);
                }
            }
        } else if (load === 'pipes') {
            for (const [v, c] of [[-0.9, 0.3], [-0.3, 0.3], [0.3, 0.3], [0.9, 0.3], [-0.6, 0.85], [0, 0.85], [0.6, 0.85]]) {
                latheU(T, F, [[-e + 0.3, 0.28], [e - 0.3, 0.28]], v, d + c, 10);
            }
        } else if (load === 'scrap') {
            for (let i = rng.int(7, 12); i > 0; i--) {
                const u = rng.range(-e + 1, e - 1), v = rng.range(-hw + 0.5, hw - 0.5), a = rng.range(0, TAU);
                const G = axes(F.P(u, v, d + rng.range(0.4, 1.3)), unit(add(mul(F.V(1, 0, 0), Math.cos(a)), mul(F.V(0, 1, 0), Math.sin(a)))), unit(add(mul(F.V(1, 0, 0), -Math.sin(a)), mul(F.V(0, 1, 0), Math.cos(a)))), Z);
                const s = rng.range(0.3, 0.8);
                S.box(G, -s, -s * 0.6, -s * 0.4, s, s * 0.6, s * 0.4);
            }
        }
    }

    // Shipping container from u0 to u1 standing at height c: ribbed sides in
    // its paint, doors on one end
    function container(T, F, u0, u1, c, lv, rng) {
        const S = T.S, hw = 1.22, h = rng.chance(0.3) ? 2.9 : 2.6;
        S.box(F, u0, -hw, c, u1, hw, c + h);
        paint(T, [F.P(u0, -hw, c + h), F.P(u1, -hw, c + h), F.P(u1, hw, c + h), F.P(u0, hw, c + h)], Z, lv, F.V(0, 1, 0), 1.4);
        for (const side of [-1, 1]) if (T.sees(F.V(0, side, 0))) ribs(T, F, side * hw, u0, u1, c + 0.08, c + h - 0.08, 0.5, lv);
        const end = rng.chance(0.5) ? 1 : -1, u = end > 0 ? u1 : u0;
        if (T.detail && T.sees(F.V(end, 0, 0))) {
            S.line([F.P(u, 0, c + 0.1), F.P(u, 0, c + h - 0.1)]);
            for (const v of [-0.8, -0.3, 0.3, 0.8]) S.line([F.P(u, v, c + 0.15), F.P(u, v, c + h - 0.15)]);
        }
        return c + h;
    }

    // Flat car with logs, lumber, pipes, containers or a crated machine
    function flatcar(T, F, L, lv, rng, load) {
        const S = T.S, e = L / 2, hw = 1.45, d = 1.3;
        bogie(T, F, -(e - 2));
        bogie(T, F, e - 2);
        couplers(T, F, L);
        S.box(F, -e, -hw, d - 0.35, e, hw, d);
        load = load || rng.weighted([[3, 'logs'], [2, 'lumber'], [2, 'pipes'], [3, 'boxes'], [1.5, 'crate']]);
        if (load === 'logs') {
            const rl = rng.range(0.3, 0.38), len = L - 1.4;
            let c = d + rl;
            for (const m of [4, 3, 2]) {
                for (let i = 0; i < m; i++) {
                    const v = (i - (m - 1) / 2) * 2.04 * rl, du = rng.range(-0.35, 0.35);
                    latheU(T, F, [[-len / 2 + du, rl], [len / 2 + du, rl]], v, c, 10);
                }
                c += rl * 1.75;
            }
            if (T.detail) {
                for (const s of [-1, 1]) {
                    for (let u = -e + 1.2; u < e - 0.8; u += 2.8) S.line([F.P(u, s * (hw - 0.05), d), F.P(u, s * (hw - 0.05), d + rl * 5)]);
                }
            }
        } else if (load === 'lumber') {
            const n = 2, bl = (L - 1.2) / n;
            for (let i = 0; i < n; i++) {
                const u0 = -e + 0.6 + i * bl + 0.1, u1 = u0 + bl - 0.2;
                for (const [c0, c1] of [[d, d + 1.1], [d + 1.1, d + 2.2]]) {
                    S.box(F, u0, -1.2, c0, u1, 1.2, c1);
                    paint(T, [F.P(u0, -1.2, c1), F.P(u1, -1.2, c1), F.P(u1, 1.2, c1), F.P(u0, 1.2, c1)], Z, GOLD, F.V(1, 0, 0), 1.2);
                }
                if (T.detail) for (let u = u0 + 0.8; u < u1 - 0.4; u += 1.6) S.line([F.P(u, -1.21, d + 0.02), F.P(u, -1.21, d + 2.21), F.P(u, 1.21, d + 2.21)]);
            }
        } else if (load === 'pipes') {
            for (const [v, c] of [[-0.95, 0.4], [0, 0.4], [0.95, 0.4], [-0.48, 1.2], [0.48, 1.2], [0, 2]]) {
                latheU(T, F, [[-e + 0.4, 0.42], [e - 0.4, 0.42]], v, d + c, 12);
                if (T.detail) for (const s of [-1, 1]) if (T.sees(F.V(s, 0, 0))) band(T, F, s * (e - 0.39), 0.3, v, d + c);
            }
        } else if (load === 'crate') {
            const u0 = rng.range(-e + 1, -1.5), u1 = rng.range(1.5, e - 1);
            S.box(F, u0, -1.3, d, u1, 1.3, d + 2.6);
            if (T.detail) {
                for (const side of [-1, 1]) {
                    if (!T.sees(F.V(0, side, 0))) continue;
                    S.line([F.P(u0, side * 1.3, d), F.P(u1, side * 1.3, d + 2.6)]);
                    S.line([F.P(u0, side * 1.3, d + 2.6), F.P(u1, side * 1.3, d)]);
                }
            }
        } else {
            // containers: one long or two short, sometimes stacked two high
            const lvs = [RED, RED, GOLD, GOLD, 'dark', null], pick = () => rng.pick(lvs);
            const long = L >= 13.5 && rng.chance(0.5);
            const tops = long ? [[-6.1, 6.1]] : [[-e + 0.3, -0.15], [0.15, e - 0.3]];
            for (const [u0, u1] of tops) {
                const c1 = container(T, F, u0, u1, d, pick(), rng);
                if (rng.chance(0.35)) container(T, F, u0 + 0.05, u1 - 0.05, c1, pick(), rng);
            }
        }
    }

    function caboose(T, F, lv, rng) {
        const S = T.S, e = 5, hw = 1.5, d = 1.25, h = 3.85, b = 3.8;
        bogie(T, F, -3.1);
        bogie(T, F, 3.1);
        couplers(T, F, 10);
        S.box(F, -e, -hw, d - 0.3, e, hw, d);
        S.box(F, -b, -hw + 0.05, d, b, hw - 0.05, h);
        slab(T, F, -b - 0.2, b + 0.2, hw + 0.1, h, 0.12, lv);
        S.box(F, -1.1, -1.2, h + 0.12, 1.1, 1.2, h + 1.3);
        slab(T, F, -1.25, 1.25, 1.35, h + 1.3, 0.1, lv);
        const [x, y, z] = F.P(-2.6, 0.4, h + 0.12);
        S.frustum(x, y, z, z + 1, 0.1, 0.1, 8);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * (hw - 0.05), c), ac = (s, c) => F.P(s, side * 1.2, c);
            for (const u of [-2.6, -0.5, 1.9]) rect(T, at, u, 2.2, 0.7, 0.8);
            rect(T, ac, -0.8, h + 0.45, 0.6, 0.55);
            rect(T, ac, 0.2, h + 0.45, 0.6, 0.55);
        }
        // end platforms: railings and a door in the end wall
        for (const s of [-1, 1]) {
            const u = s * (e - 0.08);
            for (const v of [-1, 1]) S.line([F.P(s * b, v * (hw - 0.1), d + 1), F.P(u, v * (hw - 0.1), d + 1), F.P(u, v * (hw - 0.1), d)]);
            S.line([F.P(u, -hw + 0.1, d + 1), F.P(u, -0.5, d + 1)]);
            S.line([F.P(u, 0.5, d + 1), F.P(u, hw - 0.1, d + 1)]);
            if (T.sees(F.V(s, 0, 0))) rect(T, (vv, c) => F.P(s * b, vv, c), -0.4, d + 0.05, 0.8, 2);
        }
    }

    // Coach, or a railcar with a cab at each end, or a luggage van with
    // double doors and only a few windows
    function coach(T, F, lv, rng, style = 'coach') {
        const S = T.S, e = 10, hw = 1.45, d = 1.2, h = 3.7, cab = style === 'railcar';
        bogie(T, F, -7.3, 0.46, 2.4);
        bogie(T, F, 7.3, 0.46, 2.4);
        couplers(T, F, 2 * e);
        S.box(F, -e, -hw, d - 0.25, e, hw, d);
        S.box(F, -e + 0.15, -hw, d, e - 0.15, hw, h);
        const arc = Array.from({ length: 9 }, (_, i) => { const t = -1 + (2 * i) / 8; return F.P(-e + 0.1, t * (hw + 0.05), h + 0.5 * (1 - t * t)); });
        S.prism(arc, F.V(2 * e - 0.2, 0, 0), true);
        if (T.tones) inKind(S, INK, () => { for (const t of [-0.55, 0, 0.55]) S.line([F.P(-e + 0.1, t * (hw + 0.06), h + 0.51 * (1 - t * t)), F.P(e - 0.1, t * (hw + 0.06), h + 0.51 * (1 - t * t))]); });
        if (cab) {
            S.box(F, -3, -0.9, 0.55, 3, 0.9, d - 0.25);
            const [x, y, z] = F.P(1.5, 0.5, h + 0.45);
            S.frustum(x, y, z - 0.2, z + 0.6, 0.12, 0.12, 8);
        }
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * hw, c);
            if (style === 'van') {
                for (const u of [-e + 0.6, e - 1.6]) rect(T, at, u, 2.2, 1, 0.9);
                for (const u of [-4.2, 2.4]) {
                    rect(T, at, u, d + 0.15, 1.8, 2.2);
                    S.line([at(u + 0.9, d + 0.15), at(u + 0.9, d + 2.35)]);
                }
            } else {
                for (const u of [-e + (cab ? 2 : 0.5), e - (cab ? 2.9 : 1.4)]) rect(T, at, u, d + 0.15, 0.9, 2.2);
                const n = cab ? 9 : 11, w0 = -e + (cab ? 3.2 : 1.8), w = (2 * e - (cab ? 6.4 : 3.6)) / n;
                for (let i = 0; i < n; i++) rect(T, at, w0 + i * w, 2.2, w - 0.3, 0.9);
                if (cab) for (const u of [-e + 0.4, e - 1.4]) rect(T, at, u, 2.3, 1, 0.8);
            }
            // painted lower side and a line above the windows
            paint(T, [at(-e + 1.5, d + 0.1), at(e - 1.5, d + 0.1), at(e - 1.5, 2), at(-e + 1.5, 2)], F.V(0, side, 0), lv, Z);
            if (T.tones && lv && lv !== 'dark') inKind(S, lv, () => S.line([at(-e + 0.2, 3.3), at(e - 0.2, 3.3)]));
        }
        for (const s of [-1, 1]) {
            if (!cab) {
                S.box(F, s * (e - 0.15), -0.7, d + 0.2, s * (e + 0.25), 0.7, h - 0.2);
                continue;
            }
            // cab end: windscreens, a yellow panel under them and the lamps
            if (!T.sees(F.V(s, 0, 0))) continue;
            const u = s * (e - 0.15), af = (v, c) => F.P(u, v, c);
            rect(T, af, -1.2, 2.3, 1.05, 0.9);
            rect(T, af, 0.15, 2.3, 1.05, 0.9);
            paint(T, [af(-hw, d + 0.1), af(hw, d + 0.1), af(hw, 2.1), af(-hw, 2.1)], F.V(s, 0, 0), GOLD, Z, 0.6);
            for (const v of [-0.9, 0.9]) S.loop(ring(8, (c, q) => af(v + 0.13 * c, 1.7 + 0.13 * q)));
        }
    }

    // Steam engine: drivers with a coupling rod on each side, a boiler with
    // bands round it, dome, chimney and cab. Returns the top of the chimney.
    function steamLoco(T, F, lv, rng) {
        const S = T.S, big = rng.chance(0.5), rd = big ? 0.86 : 0.78, nd = big ? 4 : 3, pitch = 2 * rd + 0.2;
        // laid out from the back of the cab, so a bigger engine reaches further forward
        const cb = -6.4, fb = cb + 2.5, zc = 2.85, r = 0.92;
        const us = Array.from({ length: nd }, (_, i) => fb + rd - 0.3 + i * pitch);
        const front = us[nd - 1] + rd + 0.4;
        wheelset(T, F, us, rd, 0.22);
        if (T.detail && T.k * rd > 1.6) for (const side of [-1, 1]) for (const u of us) S.loop(ring(8, (c, s) => F.P(u + 0.16 * c, side * (HG + 0.23), rd + 0.16 * s)));
        wheelset(T, F, [front + 0.7, front + 1.75].filter(u => u < 5.3), 0.42);
        wheelset(T, F, [fb - 1.25], 0.5);
        S.box(F, cb - 0.2, -0.72, 0.6, 5.8, 0.72, 1.72);
        // running board, boiler and smokebox
        S.box(F, cb, -1.25, 1.72, 5.7, 1.25, 1.84);
        latheU(T, F, [[fb, r], [4.1, r]], 0, zc, 18);
        latheU(T, F, [[4.1, r + 0.08], [5.6, r + 0.08]], 0, zc, 18);
        if (T.sees(F.V(1, 0, 0))) S.loop(ring(16, (c, s) => F.P(5.61, 0.72 * c, zc + 0.72 * s)));
        // chimney, dome, sandbox and safety valves stand on the boiler
        const top = (u, prof) => { const [x, y, z] = F.P(u, 0, 0); S.lathe(x, y, prof.map(([rr, c]) => [rr, z + c]), 12); };
        top(4.9, [[0.36, zc + 0.8], [0.38, zc + 1.8], [0.5, zc + 1.82], [0.5, zc + 2]]);
        top(1, [[0.62, zc + 0.72], [0.6, zc + 1.18], [0.42, zc + 1.42], [0, zc + 1.52]]);
        top(-0.7, [[0.42, zc + 0.75], [0.4, zc + 1], [0, zc + 1.12]]);
        top(fb + 0.5, [[0.12, zc + 0.85], [0.12, zc + 1.2]]);
        // square-shouldered firebox under the back of the boiler, then the cab
        S.box(F, fb, -1.02, 1.84, fb + 1.7, 1.02, zc + 0.62);
        S.box(F, cb, -1.45, 1.84, fb, 1.45, 3.95);
        slab(T, F, cb - 0.2, fb + 0.2, 1.55, 3.95, 0.14, 'dark');
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * 1.45, c);
            rect(T, at, cb + 0.35, 2.65, fb - cb - 0.7, 0.85);
            // cylinder, slide bars and the rods
            latheU(T, F, [[front, 0.4], [front + 1.4, 0.4]], side * 1.08, 1.05, 12);
            const phi = rng.range(0, TAU), cr = rd * 0.42, pin = u => [u + cr * Math.cos(phi), rd + cr * Math.sin(phi)];
            const vr = side * (HG + 0.28), p0 = pin(us[0]), p1 = pin(us[nd - 1]);
            S.box(F, p0[0] - 0.12, vr, p0[1] - 0.07, p1[0] + 0.12, vr + side * 0.06, p0[1] + 0.07);
            const main = pin(us[nd - 2]), xh = front - 0.3;
            S.line([F.P(main[0], vr + side * 0.08, main[1]), F.P(xh, vr + side * 0.08, 1.05)]);
            S.line([F.P(xh - 1, side * 1.08, 1.05), F.P(front, side * 1.08, 1.05)]);
            if (T.detail) S.line([F.P(fb, side * (r + 0.12), zc + 0.35), F.P(4.1, side * (r + 0.12), zc + 0.35)]);
        }
        // buffer beam in front, with buffers and a lamp
        S.box(F, 5.7, -1.4, 0.95, 5.95, 1.4, 1.6);
        paint(T, [F.P(5.95, -1.4, 0.95), F.P(5.95, 1.4, 0.95), F.P(5.95, 1.4, 1.6), F.P(5.95, -1.4, 1.6)], F.V(1, 0, 0), RED, Z, 0.5);
        for (const v of [-0.9, 0.9]) latheU(T, F, [[5.95, 0.14], [6.35, 0.14], [6.35, 0.26], [6.45, 0.26]], v, 1.25, 10);
        S.box(F, 5.2, -0.18, zc + 0.95, 5.5, 0.18, zc + 1.3);
        if (T.tones) inKind(S, GOLD, () => { for (const u of [fb + 1.8, 1.8, 3.5]) band(T, F, u, r + 0.012, 0, zc); });
        return F.P(4.9, 0, zc + 2);
    }

    // Tender behind a steam engine: a tank heaped with coal, lined out in gold
    function tender(T, F, lv, rng) {
        const S = T.S, e = 3.9, hw = 1.45, d = 1.3, h = 3.3;
        bogie(T, F, -2.1, 0.48, 1.7);
        bogie(T, F, 2.1, 0.48, 1.7);
        couplers(T, F, 8);
        S.box(F, -e - 0.1, -hw, d - 0.3, e + 0.1, hw, d);
        S.box(F, -e, -hw, d, e, hw, h);
        S.box(F, -e, -hw - 0.08, h, e, hw + 0.08, h + 0.18);
        heap(T, F, -e + 2.2, e - 0.1, hw - 0.1, h + 0.18, 0.7);
        const [x, y, z] = F.P(-e + 1, 0, h + 0.18);
        S.frustum(x, y, z, z + 0.3, 0.35, 0.35, 10);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * hw, c);
            if (lv === RED) paint(T, [at(-e + 0.1, d + 0.1), at(e - 0.1, d + 0.1), at(e - 0.1, h - 0.1), at(-e + 0.1, h - 0.1)], F.V(0, side, 0), RED, Z);
            if (T.tones) inKind(S, GOLD, () => S.loop([at(-e + 0.3, d + 0.3), at(e - 0.3, d + 0.3), at(e - 0.3, h - 0.3), at(-e + 0.3, h - 0.3)]));
        }
    }

    // Three-axle truck for a diesel
    function truck(T, F, u, r = 0.5) {
        wheelset(T, F, [u - 1.9, u, u + 1.9], r);
        for (const side of [-1, 1]) T.S.box(F, u - 2.5, side * (HG + 0.18), r * 0.5, u + 2.5, side * (HG + 0.38), r * 1.5);
    }

    // Road diesel: long hood, cab and short hood on a deck with handrails.
    // `shunter` is the small switcher, hood and cab only.
    function diesel(T, F, lv, rng, shunter = false) {
        const S = T.S, d = 1.55, hw = 1.5, L = shunter ? 10.5 : 17.5, e = L / 2;
        if (shunter) {
            bogie(T, F, -2.8, 0.5, 2.1);
            bogie(T, F, 2.8, 0.5, 2.1);
        } else {
            truck(T, F, -5.8);
            truck(T, F, 5.8);
            S.box(F, -3.4, -1.2, 0.5, 3.4, 1.2, 1.2);
        }
        couplers(T, F, L);
        S.box(F, -e, -hw, 1.15, e, hw, d);
        const h0 = shunter ? -e + 0.4 : -e + 0.5, h1 = shunter ? 1.5 : 2.9, hh = shunter ? 2.2 : 2.5;
        const c0 = h1, c1 = shunter ? e - 0.3 : c0 + 2.6, ch = shunter ? 2.85 : 2.95;
        S.box(F, h0, -0.95, d, h1, 0.95, d + hh);
        paint(T, [F.P(h0, -0.95, d + hh), F.P(h1, -0.95, d + hh), F.P(h1, 0.95, d + hh), F.P(h0, 0.95, d + hh)], Z, lv, F.V(0, 1, 0));
        S.box(F, c0, -1.45, d, c1, 1.45, d + ch);
        slab(T, F, c0 - 0.1, c1 + 0.1, 1.52, d + ch, 0.12, 'dark');
        if (!shunter) S.box(F, c1, -0.95, d, e - 0.5, 0.95, d + 1.8);
        // exhaust and radiator on the hood
        S.box(F, h1 - (shunter ? 1.4 : 4.5), -0.25, d + hh, h1 - (shunter ? 1 : 4), 0.25, d + hh + 0.35);
        if (T.detail) S.loop([F.P(h0 + 0.5, -0.6, d + hh), F.P(h0 + 2.2, -0.6, d + hh), F.P(h0 + 2.2, 0.6, d + hh), F.P(h0 + 0.5, 0.6, d + hh)]);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * 1.45, c), ah = (s, c) => F.P(s, side * 0.95, c);
            rect(T, at, c0 + 0.3, d + 1.55, (c1 - c0) / 2 - 0.45, 0.9);
            rect(T, at, (c0 + c1) / 2 + 0.15, d + 1.55, (c1 - c0) / 2 - 0.45, 0.9);
            if (T.detail) for (let u = h0 + 0.9; u < h1 - 0.5; u += 1.3) S.line([ah(u, d + 0.2), ah(u, d + hh - 0.25)]);
            // a band of paint along the hood side
            paint(T, [ah(h0 + 0.05, d + 0.35), ah(h1 - 0.05, d + 0.35), ah(h1 - 0.05, d + 0.9), ah(h0 + 0.05, d + 0.9)], F.V(0, side, 0), lv, Z, 0.7);
            // handrail
            const v = side * (hw - 0.08);
            S.line([F.P(-e + 0.2, v, d + 1.05), F.P(c0 - 0.1, v, d + 1.05)]);
            if (T.detail) for (let u = -e + 0.2; u < c0; u += 1.8) S.line([F.P(u, v, d), F.P(u, v, d + 1.05)]);
        }
        // ends: striped pilots and a headlight
        for (const s of [-1, 1]) {
            const u = s * e;
            S.box(F, u - s * 0.05, -hw, 0.55, u + s * 0.1, hw, 1.15);
            if (T.tones && T.sees(F.V(s, 0, 0))) {
                inKind(S, GOLD, () => {
                    for (let i = -4; i <= 4; i++) {
                        const v0 = i * 0.36;
                        if (Math.abs(v0) > hw - 0.15) continue;
                        S.line([F.P(u + s * 0.1, v0 - 0.15, 0.6), F.P(u + s * 0.1, v0 + 0.15, 1.1)]);
                    }
                });
            }
            const hu = s < 0 ? h0 : shunter ? c1 : e - 0.5, hc = s < 0 ? d + hh - 0.35 : shunter ? d + ch - 0.4 : d + 1.4;
            if (T.sees(F.V(s, 0, 0))) S.loop(ring(8, (c, q) => F.P(hu, 0.16 * c, hc + 0.16 * q)));
        }
    }

    // Steam breakdown crane: a cab that turns on its chassis, a boiler
    // chimney out the back and the lattice jib laid forward on a rest
    function crane(T, F, lv, rng) {
        const S = T.S, e = 5.5, hw = 1.45, d = 1.3;
        bogie(T, F, -3.3, 0.46);
        bogie(T, F, 3.3, 0.46);
        couplers(T, F, 2 * e);
        S.box(F, -e, -hw, d - 0.35, e, hw, d);
        const [x, y, z] = F.P(-1, 0, d);
        S.lathe(x, y, [[1.4, z], [1.4, z + 0.3]], T.segs(1.4));
        S.box(F, -3.6, -1.35, d + 0.3, 1.2, 1.35, d + 2.8);
        const R = gableRoof(T, F, [-3.6, -1.35, 1.2, 1.35], d + 2.8, true, geo.rad(18), rng, { attic: false });
        shadeGable(T, F, R, 'canopy');
        const [cx, cy, cz] = F.P(-2.9, 0, R.ridge);
        S.frustum(cx, cy, cz - 0.4, cz + 1.2, 0.2, 0.2, 8);
        for (const side of [-1, 1]) if (T.sees(F.V(0, side, 0))) rect(T, (s, c) => F.P(s, side * 1.35, c), -1.5, d + 1.3, 1, 0.8);
        // the jib, pinned low on the cab front and resting on a trestle at the far end
        S.box(F, e - 1.3, -0.5, d, e - 0.9, 0.5, d + 1.4);
        const pin = 1.2, tip = e + 1.5, top = [], bot = [];
        for (let i = 0; i <= 8; i++) {
            const u = pin + ((tip - pin) * i) / 8, c = d + 1.2 + (0.3 * i) / 8, hgt = geo.lerp(1, 0.35, i / 8);
            for (const v of [-0.4, 0.4]) {
                top.push(F.P(u, v, c + hgt / 2));
                bot.push(F.P(u, v, c - hgt / 2));
            }
        }
        for (const k of [0, 1]) {
            S.line(top.filter((_, i) => i % 2 === k));
            S.line(bot.filter((_, i) => i % 2 === k));
            if (T.detail) S.line(top.filter((_, i) => i % 2 === k).map((q, i) => (i % 2 ? q : bot[i * 2 + k])));
        }
        S.line([F.P(tip, 0, d + 1.5), F.P(tip, 0, d + 0.4)]);
    }

    // Box-cab electric: a long body with sloping cab ends, louvres down the
    // side and a pantograph at each end, up to the wire when the track has
    // one and folded down when it doesn't
    function electric(T, F, lv, rng, t) {
        const S = T.S, e = 8.4, hw = 1.45, d = 1.35, h = 4.05;
        bogie(T, F, -5.2, 0.55, 2.8);
        bogie(T, F, 5.2, 0.55, 2.8);
        couplers(T, F, 2 * e + 0.2);
        S.box(F, -e - 0.1, -hw, 1, e + 0.1, hw, d);
        S.prism([F.P(-e, -hw, d), F.P(e, -hw, d), F.P(e, -hw, h - 0.9), F.P(e - 0.8, -hw, h), F.P(-e + 0.8, -hw, h), F.P(-e, -hw, h - 0.9)], F.V(0, 2 * hw, 0));
        paint(T, [F.P(-e + 0.8, -hw, h), F.P(e - 0.8, -hw, h), F.P(e - 0.8, hw, h), F.P(-e + 0.8, hw, h)], Z, lv, F.V(0, 1, 0));
        S.box(F, -2.4, -0.8, h, 2.4, 0.8, h + 0.45);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * hw, c);
            for (const u of [-e + 0.9, e - 1.7]) rect(T, at, u, 2.55, 0.8, 0.85);
            for (const u of [-e + 1.9, e - 2.6]) rect(T, at, u, d + 0.15, 0.7, 2.2);
            for (const [u0, u1] of [[-4.6, -0.5], [0.5, 4.6]]) {
                rect(T, at, u0, 2.35, u1 - u0, 1.1);
                if (T.detail) for (let u = u0 + 0.35; u < u1 - 0.1; u += 0.35) S.line([at(u, 2.45), at(u, 3.35)]);
            }
            paint(T, [at(-e + 0.3, d + 0.2), at(e - 0.3, d + 0.2), at(e - 0.3, d + 0.75), at(-e + 0.3, d + 0.75)], F.V(0, side, 0), lv, Z, 0.6);
        }
        const wire = t && t.wired ? WIRE - t.z - RAIL : null;
        for (const s of [-1, 1]) {
            // windscreen in the sloping face, lamps on the end
            const nf = F.V(s * 0.9, 0, 0.8);
            if (T.sees(nf)) {
                const q = (v, f) => F.P(s * (e - 0.8 * f), v, h - 0.9 + 0.9 * f);
                for (const [v0, v1] of [[-1.2, -0.1], [0.1, 1.2]]) S.loop([q(v0, 0.2), q(v1, 0.2), q(v1, 0.85), q(v0, 0.85)]);
            }
            if (T.sees(F.V(s, 0, 0))) for (const v of [-0.9, 0.9]) S.loop(ring(8, (c, q) => F.P(s * e, v + 0.14 * c, d + 0.8 + 0.14 * q)));
            // pantograph: an arm up from a hinge on the roof to a bow across the top
            const u0 = s * (e - 3.3), head = wire === null ? h + 0.55 : wire, knee = wire === null ? h + 0.4 : (h + head) / 2 + 0.3;
            S.box(F, u0 - s * 1.3, -0.5, h, u0 - s * 0.9, 0.5, h + 0.25);
            for (const v of [-0.35, 0.35]) S.line([F.P(u0 - s * 1.1, v, h + 0.25), F.P(u0 + s * 0.7, v * 0.6, knee), F.P(u0, v * 0.3, head - 0.1)]);
            for (const du of [-0.15, 0.15]) S.line([F.P(u0 + du, -1, head - 0.15), F.P(u0 + du, -0.8, head), F.P(u0 + du, 0.8, head), F.P(u0 + du, 1, head - 0.15)]);
        }
    }

    // Cattle wagon: slatted sides with gaps between, painted, and a door
    function cattle(T, F, L, lv, rng) {
        const S = T.S, hw = 1.45, d = 1.2, h = 3.9, e = L / 2;
        bogie(T, F, -(e - 2));
        bogie(T, F, e - 2);
        couplers(T, F, L);
        S.box(F, -e, -hw, d - 0.3, e, hw, d);
        S.box(F, -e + 0.1, -hw + 0.05, d, e - 0.1, hw - 0.05, h);
        slab(T, F, -e, e, hw + 0.06, h, 0.12, lv);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            const at = (s, c) => F.P(s, side * (hw - 0.05), c);
            rect(T, at, -1, d + 0.1, 2, h - d - 0.3);
            if (T.detail) {
                inKind(S, T.tones && lv ? (lv === 'dark' ? INK : lv) : S.kind, () => {
                    for (let c = d + 0.4; c < h - 0.2; c += 0.34) for (const [u0, u1] of [[-e + 0.2, -1.1], [1.1, e - 0.2]]) S.line([at(u0, c), at(u1, c)]);
                });
                for (const u of [-e + 0.15, -e / 2, e / 2, e - 0.15]) S.line([at(u, d), at(u, h)]);
            }
        }
    }

    // Car carrier: a tall box with its sides pierced, painted, and doors at the ends
    function autorack(T, F, L, lv, rng) {
        const S = T.S, hw = 1.5, d = 1.1, h = 5.7, e = L / 2;
        bogie(T, F, -(e - 2.2));
        bogie(T, F, e - 2.2);
        couplers(T, F, L);
        S.box(F, -e, -hw, d - 0.3, e, hw, d);
        S.box(F, -e + 0.1, -hw, d, e - 0.1, hw, h);
        slab(T, F, -e, e, hw + 0.05, h, 0.12, lv);
        for (const side of [-1, 1]) {
            if (!T.sees(F.V(0, side, 0))) continue;
            ribs(T, F, side * hw, -e + 0.1, e - 0.1, d + 0.15, h - 0.1, 0.65, lv);
            for (const c of [2.9, 4.4]) S.line([F.P(-e + 0.1, side * hw, c), F.P(e - 0.1, side * hw, c)]);
        }
        for (const s of [-1, 1]) {
            if (!T.sees(F.V(s, 0, 0))) continue;
            const af = (v, c) => F.P(s * (e - 0.1), v, c);
            rect(T, af, -1.3, d + 0.2, 2.6, h - d - 0.5);
            S.line([af(0, d + 0.2), af(0, h - 0.3)]);
        }
    }

    const STOCK = {
        box: { L: 15, build: (T, F, lv, rng) => boxcar(T, F, 15, lv, rng) },
        reefer: { L: 14, build: (T, F, lv, rng) => boxcar(T, F, 14, lv, rng, true) },
        tank: { L: 13, build: (T, F, lv, rng) => tankCar(T, F, 13, lv, rng) },
        hopper: { L: 13.5, build: (T, F, lv, rng) => hopper(T, F, 13.5, lv, rng) },
        coal: { L: 11.5, build: (T, F, lv, rng) => hopper(T, F, 11.5, lv, rng, true) },
        gondola: { L: 15, build: (T, F, lv, rng) => gondola(T, F, 15, lv, rng) },
        flat: { L: 16, build: (T, F, lv, rng) => flatcar(T, F, 16, lv, rng) },
        well: { L: 16, build: (T, F, lv, rng) => flatcar(T, F, 16, lv, rng, 'boxes') },
        caboose: { L: 10, build: caboose },
        coach: { L: 20, build: (T, F, lv, rng) => coach(T, F, lv, rng) },
        railcar: { L: 20, build: (T, F, lv, rng) => coach(T, F, lv, rng, 'railcar') },
        van: { L: 20, build: (T, F, lv, rng) => coach(T, F, lv, rng, 'van') },
        electric: { L: 17.3, build: electric },
        cattle: { L: 12, build: (T, F, lv, rng) => cattle(T, F, 12, lv, rng) },
        autorack: { L: 18.5, build: (T, F, lv, rng) => autorack(T, F, 18.5, lv, rng) },
        steam: { L: 12.9, build: steamLoco },
        tender: { L: 8, build: tender },
        diesel: { L: 17.5, build: (T, F, lv, rng) => diesel(T, F, lv, rng) },
        shunter: { L: 10.5, build: (T, F, lv, rng) => diesel(T, F, lv, rng, true) },
        crane: { L: 11, build: crane },
    };

    // Frame on the rails of track t at arc length s, along the chord between
    // points `half` either side so a car on a curve sits across it
    function onTrack(t, s, half, back) {
        const a = t.at(s - half), b = t.at(s + half);
        let ux = b[0] - a[0], uy = b[1] - a[1];
        const l = Math.hypot(ux, uy) || 1;
        ux /= l;
        uy /= l;
        if (back) { ux = -ux; uy = -uy; }
        return axes([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, t.z + RAIL], [ux, uy, 0], [-uy, ux, 0], Z);
    }

    // A train on track t with its head at arc length s, facing `dir` (+1 or
    // -1 along the track) and the rest trailing behind. Cars are [kind, paint].
    // Returns the chimneys of any steam engines, and where the tail ends.
    function train(T, t, s, dir, cars, rng) {
        const S = T.S, stacks = [];
        S.kind = INK;
        for (const [kind, lv] of cars) {
            const L = STOCK[kind].L, sc = s - (dir * L) / 2;
            if (sc - L / 2 < 0 || sc + L / 2 > t.len) break;
            const F = onTrack(t, sc, L * 0.3, dir < 0);
            if (T.onPage(F.O[0], F.O[1], 2, 40)) {
                const top = STOCK[kind].build(T, F, lv, rng, t);
                if (kind === 'steam') stacks.push({ top, F });
            }
            s -= dir * (L + 0.85);
        }
        return { stacks, tail: s };
    }

    // ------------------------------------------------------------------
    // Steam
    // ------------------------------------------------------------------

    // Puffs of steam from (x, y, z), each a lumpy round cut-out facing the
    // camera. They drift off along `drift` (world, per meter traveled),
    // rising `rise` for each meter and growing as they go.
    function plume(T, x, y, z, drift, n, rng, r0 = 0.55, grow = 1.2, rise = 1) {
        const S = T.S, ce = T.cam.ce, keep = S.kind;
        S.kind = STEAM;
        let r = r0, px = x, py = y, pz = z + r0 * 0.7;
        for (let i = 0; i < n; i++) {
            const P = card(T, px, py, pz, 0), lobes = rng.int(5, 8), a0 = rng.range(0, TAU), pts = [];
            const seg = Math.max(3, Math.round(T.segs(r) / lobes));
            for (let l = 0; l < lobes; l++) {
                const bump = r * rng.range(0.08, 0.17);
                for (let j = 0; j < seg; j++) {
                    const t = j / seg, a = a0 + ((l + t) * TAU) / lobes, rr = r + bump * Math.sin(Math.PI * t);
                    pts.push([rr * Math.cos(a), (rr * Math.sin(a)) / ce]);
                }
            }
            S.face(hull(pts).map(([u, w]) => P(u, w)), false);
            S.loop(pts.map(([u, w]) => P(u, w)));
            if (T.detail && r * T.k > 1.4) {
                // a curl inside the bigger puffs
                const ca = rng.range(0, TAU), cr = r * 0.42, cu = r * 0.3 * Math.cos(ca), cw = r * 0.3 * Math.sin(ca), curl = [];
                for (let j = 0; j <= 8; j++) {
                    const a = ca + 0.8 + (j / 8) * 1.9;
                    curl.push(P(cu + cr * Math.cos(a), (cw + cr * Math.sin(a)) / ce));
                }
                S.line(curl);
            }
            const step = r * rng.range(0.95, 1.3);
            r *= grow * rng.range(0.92, 1.08);
            px += drift[0] * step;
            py += drift[1] * step;
            pz += step * rise * rng.range(0.7, 1.15);
        }
        S.kind = keep;
    }

    // ------------------------------------------------------------------
    // Engine depot
    // ------------------------------------------------------------------

    // Round bar between two world points, smooth so only its outline shows
    function tube(T, p0, p1, r, n = 8) {
        const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], a = unit(d);
        const e1 = unit(Math.abs(a[2]) < 0.9 ? cross(a, Z) : cross(a, [1, 0, 0])), e2 = cross(a, e1);
        T.S.prism(ring(n, (c, s) => add(p0, add(mul(e1, r * c), mul(e2, r * s)))), d, true);
    }

    // Arched doorway on a wall, open, with the dark inside hatched in
    function doorway(T, at, s, w, h) {
        const pts = [at(s - w / 2, 0), at(s + w / 2, 0)];
        for (let k = 0; k <= 12; k++) pts.push(at(s + (w / 2) * Math.cos((Math.PI * k) / 12), h - w / 2 + (w / 2) * Math.sin((Math.PI * k) / 12)));
        T.S.loop(pts);
        T.S.hatch(pts, Z, (T.hDark || 0.5) * 0.9);
    }

    // Turntable pit of radius R with the bridge turned to `ang`. The pit wall
    // is faces all round, so its near side hides the floor behind it. Returns
    // the bridge's frame for an engine to stand on.
    function turntable(T, x, y, R, ang) {
        const S = T.S, d = 1.2, n = Math.max(48, T.segs(R));
        const keep = S.shadow;
        S.shadow = null;
        S.kind = INK;
        const circle = (r, z) => ring(n, (c, s) => [x + r * c, y + r * s, z]);
        const rim = circle(R, 0), foot = circle(R, -d);
        for (let i = 0; i < n; i++) S.face([rim[i], rim[(i + 1) % n], foot[(i + 1) % n], foot[i]], false);
        S.loop(rim);
        S.loop(circle(R + 0.5, 0));
        S.loop(foot);
        S.kind = TRACK;
        S.loop(circle(R - 0.8, -d + 0.15));
        S.kind = INK;
        S.frustum(x, y, -d, -d + 0.5, 0.9, 0.7, 12);
        const U = [Math.cos(ang), Math.sin(ang), 0], F = axes([x, y, 0], U, [-U[1], U[0], 0], Z), L = R - 0.3;
        for (const v of [-1.5, 1.15]) S.prism([F.P(-L, v, 0.05), F.P(L, v, 0.05), F.P(L, v, -0.5), F.P(0, v, -d + 0.3), F.P(-L, v, -0.5)], F.V(0, 0.35, 0));
        S.kind = TRACK;
        if (T.detail) for (let u = -L + 0.4; u < L; u += 0.9) S.line([F.P(u, -1.2, 0.08), F.P(u, 1.2, 0.08)]);
        for (const v of [-HG, HG]) S.line([F.P(-L, v, RAIL), F.P(L, v, RAIL)]);
        S.kind = INK;
        // the operator's hut at one end
        S.box(F, L - 1.9, 1.5, 0.05, L - 0.4, 2.7, 2.3);
        S.box(F, L - 2.05, 1.35, 2.3, L - 0.25, 2.85, 2.45);
        S.shadow = keep;
        return axes([x, y, 0], U, [-U[1], U[0], 0], Z);
    }

    // Roundhouse round the turntable at (x, y): n stalls from angle a0 in
    // steps of da, doors facing in, a monitor roof with clerestory windows
    // and a smoke jack over each stall. Each stall is a quiet solid and the
    // outline goes over the top once, so the stalls don't draw the walls they
    // share twice. Stalls in `open` get their doors open. Returns the smoke
    // jacks' tops.
    function roundhouse(T, x, y, rIn, depth, a0, da, n, open, rng) {
        const S = T.S, hF = 7.4, hB = 5.6, rOut = rIn + depth;
        const at = (r, a, z) => [x + r * Math.cos(a), y + r * Math.sin(a), z];
        const hr = r => hF + ((r - rIn) / depth) * (hB - hF);
        const angs = Array.from({ length: n + 1 }, (_, i) => a0 + i * da);
        const m0 = rIn + depth * 0.28, m1 = rIn + depth * 0.58, mh = 1.4;
        S.kind = INK;
        for (let i = 0; i < n; i++) {
            const A = angs[i], B = angs[i + 1];
            S.solid([at(rIn, A, 0), at(rIn, B, 0), at(rOut, B, 0), at(rOut, A, 0), at(rIn, A, hF), at(rIn, B, hF), at(rOut, B, hB), at(rOut, A, hB)], BOX, null, true);
            S.solid([at(m0, A, hr(m0) - 0.3), at(m0, B, hr(m0) - 0.3), at(m1, B, hr(m1) - 0.3), at(m1, A, hr(m1) - 0.3),
                at(m0, A, hr(m0) + mh), at(m0, B, hr(m0) + mh), at(m1, B, hr(m1) + mh), at(m1, A, hr(m1) + mh)], BOX, null, true);
        }
        const arc = (r, z) => angs.map(a => at(r, a, typeof z === 'function' ? z(r) : z));
        for (const [r, z] of [[rIn, 0], [rIn, hF], [rOut, hB], [rOut, 0], [m0, hr(m0)], [m0, hr(m0) + mh], [m1, hr(m1) + mh]]) S.line(arc(r, z));
        for (const a of angs) {
            S.line([at(rIn, a, 0), at(rIn, a, hF), at(m0, a, hr(m0)), at(m0, a, hr(m0) + mh), at(m1, a, hr(m1) + mh), at(m1, a, hr(m1)), at(rOut, a, hB), at(rOut, a, 0)]);
        }
        for (const a of [angs[0], angs[n]]) S.line([at(rIn, a, 0), at(rOut, a, 0)]);
        const jacks = [];
        for (let i = 0; i < n; i++) {
            const A = angs[i], B = angs[i + 1], M = (A + B) / 2, centre = at((rIn + rOut) / 2, M, 2);
            // roof slopes either side of the monitor, and the monitor's own top
            for (const [r0, r1, z0, z1] of [[rIn, m0, hF, hr(m0)], [m1, rOut, hr(m1), hB], [m0, m1, hr(m0) + mh, hr(m1) + mh]]) {
                const q = [at(r0, A, z0), at(r0, B, z0), at(r1, B, z1), at(r1, A, z1)];
                shade(T, q, outward(q, centre));
            }
            const n0 = [-Math.cos(M), -Math.sin(M), 0];
            const p0 = at(rIn, A, 0), p1 = at(rIn, B, 0), len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const W = (s, c) => [p0[0] + ((p1[0] - p0[0]) * s) / len, p0[1] + ((p1[1] - p0[1]) * s) / len, c];
            if (T.sees(n0)) {
                const dw = Math.min(4.4, len - 1), dh = 5.9;
                if (open[i]) doorway(T, W, len / 2, dw, dh);
                else {
                    arch(T, W, len / 2, 0, dw, dh);
                    S.line([W(len / 2, 0), W(len / 2, dh)]);
                    if (T.detail) for (const s of [-1, 1]) pane(T, W, len / 2 + s * dw * 0.25 - 0.45, 3.6, 0.9, 1.1, 'cross');
                }
                // clerestory windows along the monitor
                const q0 = at(m0, A, 0), q1 = at(m0, B, 0), ml = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
                const Wm = (s, c) => [q0[0] + ((q1[0] - q0[0]) * s) / ml, q0[1] + ((q1[1] - q0[1]) * s) / ml, c];
                const k = Math.max(1, Math.floor(ml / 1.3));
                for (let j = 0; j < k; j++) rect(T, Wm, (ml * (j + 0.5)) / k - 0.4, hr(m0) + 0.25, 0.8, mh - 0.55);
            }
            const [jx, jy] = at(rOut - 4.5, M, 0), jz = hr(rOut - 4.5);
            S.frustum(jx, jy, jz - 0.3, jz + 1.3, 0.38, 0.3, 10);
            S.frustum(jx, jy, jz + 1.3, jz + 1.8, 0.7, 0.25, 10);
            jacks.push([jx, jy, jz + 1.8]);
        }
        // tall windows down the two end walls
        for (const [a, sg] of [[angs[0], -1], [angs[n], 1]]) {
            const nn = [-Math.sin(a) * sg, Math.cos(a) * sg, 0];
            if (!T.sees(nn)) continue;
            const Wd = (s, c) => at(rIn + s, a, c);
            const k = Math.floor(depth / 3.2);
            for (let j = 0; j < k; j++) arch(T, Wd, (depth * (j + 0.5)) / k, 1.2, 1.3, 3.4);
        }
        return jacks;
    }

    // Straight engine shed over tracks at `ys`, doors at x0 facing -x: a row
    // of pitched roofs across the tracks, or with `along` a gable over each
    // pair of roads, so the end is a row of gables. Smoke vents on the
    // ridges, an arched door for each road and tall windows down the side.
    // Roads in `open` have their doors open. Returns the vents.
    function engineShed(T, x0, L, ys, open, rng, along = false) {
        const S = T.S, y0 = Math.min(...ys) - 3, D = Math.max(...ys) + 3 - y0, h = 6.8, F = frame(x0, y0, 0, 0), fp = [0, 0, L, D];
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        const vents = [];
        if (along) {
            const n = Math.max(1, Math.round(D / 10)), bd = D / n;
            for (let i = 0; i < n; i++) {
                const Ri = gableRoof(T, F, [0.4, i * bd + 0.4, L - 0.4, (i + 1) * bd - 0.4], h + 0.2, true, geo.rad(30), rng, { attic: true });
                shadeGable(T, F, Ri);
                for (let a = 5; a < L - 3; a += 9) {
                    S.box(F, a - 0.6, Ri.mid - 0.4, Ri.ridge - 0.3, a + 0.6, Ri.mid + 0.4, Ri.ridge + 0.8);
                    vents.push(F.P(a, Ri.mid, Ri.ridge + 0.8));
                }
            }
        } else {
            const n = Math.max(2, Math.round(L / 7.5)), bw = L / n;
            for (let i = 0; i < n; i++) {
                const Ri = gableRoof(T, F, [i * bw + 0.4, 0, (i + 1) * bw - 0.4, D], h + 0.2, false, geo.rad(32), rng, { attic: false });
                shadeGable(T, F, Ri);
                const am = (i + 0.5) * bw;
                for (const b of [D * 0.3, D * 0.7]) {
                    S.box(F, am - 0.35, b - 0.35, Ri.ridge - 0.3, am + 0.35, b + 0.35, Ri.ridge + 0.7);
                    vents.push(F.P(am, b, Ri.ridge + 0.7));
                }
            }
        }
        const end = wall(F, 3, fp);
        if (T.sees(end.n)) {
            ys.forEach((y, i) => {
                const s = D - (y - y0), dw = 4.2, dh = 5.4;
                if (open[i]) doorway(T, end.at, s, dw, dh);
                else {
                    arch(T, end.at, s, 0, dw, dh);
                    S.line([end.at(s, 0), end.at(s, dh)]);
                }
            });
            if (T.detail) for (const c of [h - 0.9, h - 0.6]) S.line([end.at(0, c), end.at(D, c)]);
        }
        const side = wall(F, 0, fp);
        if (T.sees(side.n)) for (let a = 2.5; a < L - 1.5; a += 4) arch(T, side.at, a, 1.4, 1.4, 3.8);
        return vents;
    }

    // Round engine house over the turntable, like the one at Camden: a
    // many-sided brick drum with a tall window in each bay, a conical roof
    // shaded facet by facet, a ring of smoke vents and a lantern on top. The
    // approach comes in through the big door facing `door`. Returns the vents.
    function engineHouse(T, x, y, R, door, rng) {
        const S = T.S, n = 24, h = 8, rl = 4, zr = h + 0.45, zt = zr + (R + 0.6 - rl) * Math.tan(geo.rad(22));
        const rot = door - Math.PI / n, at = (r, a, z) => [x + r * Math.cos(a), y + r * Math.sin(a), z];
        S.kind = INK;
        S.lathe(x, y, [[R, 0], [R, h]], n, false, rot);
        S.lathe(x, y, [[R + 0.3, h], [R + 0.3, zr]], n, false, rot);
        S.lathe(x, y, [[R + 0.6, zr], [rl, zt]], n, false, rot);
        const centre = [x, y, zr];
        for (let i = 0; i < n; i++) {
            const A = rot + (TAU * i) / n, B = rot + (TAU * (i + 1)) / n;
            const q = [at(R + 0.6, A, zr), at(R + 0.6, B, zr), at(rl, B, zt), at(rl, A, zt)];
            shade(T, q, outward(q, centre));
        }
        // lantern: a glazed drum with its own little roof and a finial
        S.lathe(x, y, [[rl - 0.8, zt], [rl - 0.8, zt + 2.2]], 12, false, rot);
        S.lathe(x, y, [[rl - 0.2, zt + 2.2], [0.3, zt + 3.7], [0, zt + 3.9]], 12, false, rot);
        S.line([[x, y, zt + 3.9], [x, y, zt + 5]]);
        for (let i = 0; i < 12; i++) {
            const A = rot + (TAU * i) / 12, B = rot + (TAU * (i + 1)) / 12, M = (A + B) / 2;
            if (!T.sees([Math.cos(M), Math.sin(M), 0])) continue;
            const p0 = at(rl - 0.79, A, 0), p1 = at(rl - 0.79, B, 0);
            const W = (s, c) => [geo.lerp(p0[0], p1[0], s), geo.lerp(p0[1], p1[1], s), c];
            rect(T, W, 0.2, zt + 0.5, 0.6, 1.3);
        }
        // a tall window in each bay, and the door where the approach comes in
        for (let i = 0; i < n; i++) {
            const A = rot + (TAU * i) / n, B = rot + (TAU * (i + 1)) / n, M = (A + B) / 2;
            if (!T.sees([Math.cos(M), Math.sin(M), 0])) continue;
            const p0 = at(R + 0.01, A, 0), p1 = at(R + 0.01, B, 0), len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const W = (s, c) => [p0[0] + ((p1[0] - p0[0]) * s) / len, p0[1] + ((p1[1] - p0[1]) * s) / len, c];
            if (i === 0) doorway(T, W, len / 2, Math.min(4.8, len - 0.8), 6.4);
            else {
                arch(T, W, len / 2, 1.2, Math.min(1.9, len * 0.35), 4.4);
                if (T.detail) S.loop(ring(T.segs(0.4), (c, q) => W(len / 2 + 0.4 * c, h - 1.2 + 0.4 * q)));
            }
        }
        const vents = [];
        for (let i = 0; i < 12; i++) {
            const a = rot + (TAU * (i + 0.5)) / 12, r = R * 0.55, z = zr + (R + 0.6 - r) * Math.tan(geo.rad(22));
            const [vx, vy] = at(r, a, 0);
            S.frustum(vx, vy, z - 0.4, z + 1.3, 0.35, 0.28, 8);
            S.frustum(vx, vy, z + 1.3, z + 1.75, 0.65, 0.2, 8);
            vents.push([vx, vy, z + 1.75]);
        }
        return vents;
    }

    // Ash pit between the rails of a track from s0 to s1: dark down the middle
    function ashPit(T, t, s0, s1) {
        const S = T.S, pts = [];
        for (const [s, side] of [[s0, -1], [s1, -1], [s1, 1], [s0, 1]]) {
            const [x, y, tx, ty] = t.at(s);
            pts.push([x - ty * side * (HG - 0.15), y + tx * side * (HG - 0.15), 0.12]);
        }
        S.kind = INK;
        S.loop(pts);
        S.hatch(pts, [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], 0], T.hDark || 0.5);
    }

    // Coal stage beside a track: a raised brick stage under a roof, with
    // tubs of coal on it and a jib to swing them over the tenders
    function coalStage(T, F, L, rng) {
        const S = T.S, D = 4.5, h = 2.8;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        for (const a of [0.3, L - 0.3]) for (const b of [0.3, D - 0.3]) S.box(F, a - 0.12, b - 0.12, h, a + 0.12, b + 0.12, h + 3);
        shadeGable(T, F, gableRoof(T, F, [0, 0, L, D], h + 3, true, geo.rad(22), rng, { attic: false }));
        for (let a = 1; a < L - 1; a += 1.6) {
            S.box(F, a - 0.4, 0.6, h, a + 0.4, 1.4, h + 0.75);
            heap(T, frame(...F.P(a, 1, h + 0.75), 0), -0.35, 0.35, 0.35, 0, 0.3);
        }
        const W = wall(F, 0, [0, 0, L, D]);
        if (T.sees(W.n) && T.detail) for (let c = 0.5; c < h; c += 0.5) S.line([W.at(0, c), W.at(L, c)]);
        S.line([F.P(L / 2, 0.2, h), F.P(L / 2, 0.2, h + 2.4), F.P(L / 2, -1.8, h + 2)]);
    }

    // Concrete coaling tower straddling a track: the bunker up on legs, a
    // hoist shaft up one side and chutes down over the rails
    function coalingTower(T, F, rng) {
        const S = T.S, e = 4.2, w = 3.3, z0 = 7.4, z1 = rng.range(16, 20);
        S.kind = INK;
        for (const [a, b] of [[-e, -w], [e, -w], [e, w], [-e, w]]) S.box(F, a - 0.35, b - 0.35, 0, a + 0.35, b + 0.35, z0);
        S.prism([F.P(-e, -w, z0), F.P(-e, w, z0), F.P(-e, 1.1, z0 - 1.6), F.P(-e, -1.1, z0 - 1.6)], F.V(2 * e, 0, 0));
        S.box(F, -e - 0.3, -w - 0.3, z0, e + 0.3, w + 0.3, z1);
        S.box(F, -e - 0.55, -w - 0.55, z1, e + 0.55, w + 0.55, z1 + 0.45);
        S.box(F, -e + 0.6, -w + 0.2, z1 + 0.45, e - 0.6, w - 1.2, z1 + 3.2);
        slab(T, F, -e + 0.4, e - 0.4, w - 1, z1 + 3.2, 0.2, null);
        const top = [F.P(-e + 0.4, -w, z1 + 3.4), F.P(e - 0.4, -w, z1 + 3.4), F.P(e - 0.4, w - 1, z1 + 3.4), F.P(-e + 0.4, w - 1, z1 + 3.4)];
        shade(T, top, Z);
        // hoist shaft, taller than the rest
        S.box(F, -1.4, w + 0.3, 0, 1.4, w + 2.6, z1 + 5.5);
        S.box(F, -1.6, w + 0.1, z1 + 5.5, 1.6, w + 2.8, z1 + 5.8);
        for (let side = 0; side < 4; side++) {
            const Wl = wall(F, side, [-e - 0.3, -w - 0.3, e + 0.3, w + 0.3]);
            if (!T.sees(Wl.n)) continue;
            if (T.detail) for (let c = z0 + 1.5; c < z1 - 0.3; c += 1.5) S.line([Wl.at(0, c), Wl.at(Wl.len, c)]);
            windows(T, wall(F, side, [-e + 0.6, -w + 0.2, e - 0.6, w - 1.2]), { base: z1 + 0.45, floors: 1, style: 'bars', winW: 0.9, winH: 1, sill: 1.1, gap: 1 });
        }
        const sh = wall(F, 0, [-1.4, w + 0.3, 1.4, w + 2.6]);
        if (T.sees(sh.n) && T.detail) for (let c = 2; c < z1 + 5; c += 2.2) rect(T, sh.at, 0.9, c, 1, 0.8);
        // chutes swung down over the track
        for (const u of [-2, 2]) S.line([F.P(u - 0.45, -1.1, z0 - 1.6), F.P(u - 0.45, -0.1, 5.3), F.P(u + 0.45, -0.1, 5.3), F.P(u + 0.45, -1.1, z0 - 1.6)]);
    }

    // Tank on a braced steel tower, with a spout reaching towards `ang`
    function waterTower(T, x, y, ang, rng) {
        const S = T.S, R = rng.range(2.8, 3.3), h = rng.range(7.5, 9), th = rng.range(3.8, 4.5), nl = 6;
        S.kind = INK;
        const legs = [];
        for (let i = 0; i < nl; i++) {
            const a = (TAU * (i + 0.5)) / nl, g = [x + R * 1.05 * Math.cos(a), y + R * 1.05 * Math.sin(a), 0], t = [x + R * 0.8 * Math.cos(a), y + R * 0.8 * Math.sin(a), h];
            tube(T, g, t, 0.14, 6);
            legs.push([g, t]);
        }
        if (T.detail) {
            for (let i = 0; i < nl; i++) {
                const [g0, t0] = legs[i], [g1, t1] = legs[(i + 1) % nl];
                for (const [f0, f1] of [[0.08, 0.5], [0.5, 0.92]]) {
                    const P = (A, B, f) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
                    S.line([P(g0, t0, f0), P(g1, t1, f1)]);
                    S.line([P(g1, t1, f0), P(g0, t0, f1)]);
                }
            }
        }
        S.lathe(x, y, [[R + 0.6, h], [R + 0.6, h + 0.2]], T.segs(R + 0.6));
        S.loop(ring(T.segs(R + 0.6), (c, s) => [x + (R + 0.55) * c, y + (R + 0.55) * s, h + 1.1]));
        S.lathe(x, y, [[R, h + 0.2], [R, h + 0.2 + th]], T.segs(R));
        S.lathe(x, y, [[R + 0.25, h + 0.2 + th], [R + 0.25, h + 0.4 + th], [0.35, h + th + 2.1], [0, h + th + 2.2]], T.segs(R));
        shadeRound(T, x, y, h + 0.2, h + 0.2 + th, R, R);
        if (T.detail) for (const f of [1 / 3, 2 / 3]) S.loop(ring(T.segs(R), (c, s) => [x + (R + 0.01) * c, y + (R + 0.01) * s, h + 0.2 + th * f]));
        const ax = Math.cos(ang), ay = Math.sin(ang), sx = x + ax * (R + 0.2), sy = y + ay * (R + 0.2);
        tube(T, [sx, sy, h + 1], [sx + ax * 2.8, sy + ay * 2.8, h - 1.4], 0.22, 8);
        S.line([[sx + ax * 2.8, sy + ay * 2.8, h - 1.4], [sx + ax * 2.9, sy + ay * 2.9, h - 3]]);
    }

    // Water crane beside a track: a column with its arm swung out and a
    // brazier at the foot to keep it from freezing
    function waterColumn(T, x, y, ang) {
        const S = T.S, ax = Math.cos(ang), ay = Math.sin(ang);
        S.kind = INK;
        S.frustum(x, y, 0, 0.3, 0.42, 0.42, 10);
        S.frustum(x, y, 0.3, 3.3, 0.17, 0.13, 10);
        tube(T, [x, y, 3.25], [x + ax * 2.4, y + ay * 2.4, 3.25], 0.13, 8);
        S.line([[x + ax * 2.4, y + ay * 2.4, 3.15], [x + ax * 2.55, y + ay * 2.55, 1.9]]);
        const bx = x - ay * 0.9, by = y + ax * 0.9;
        S.frustum(bx, by, 0.5, 1.1, 0.25, 0.32, 8);
        for (const a of [0, TAU / 3, (2 * TAU) / 3]) S.line([[bx + 0.3 * Math.cos(a), by + 0.3 * Math.sin(a), 0.6], [bx + 0.4 * Math.cos(a), by + 0.4 * Math.sin(a), 0]]);
    }

    // ------------------------------------------------------------------
    // Lineside
    // ------------------------------------------------------------------

    // Buffer stop at the end of a track: rails bent up into a frame with a
    // painted beam across the front. (x, y) is the end, (ux, uy) the way in.
    function bufferStop(T, x, y, ux, uy, z = 0) {
        const S = T.S, F = axes([x, y, z], [ux, uy, 0], [-uy, ux, 0], Z);
        S.kind = INK;
        for (const v of [-HG, HG]) {
            S.line([F.P(-0.4, v, RAIL), F.P(0.9, v, 1.1), F.P(0.9, v, RAIL)]);
            S.line([F.P(0.2, v, RAIL + 0.35), F.P(0.9, v, 0.7)]);
        }
        S.box(F, -0.55, -1.2, 0.75, -0.3, 1.2, 1.2);
        paint(T, [F.P(-0.55, -1.2, 0.75), F.P(-0.55, 1.2, 0.75), F.P(-0.55, 1.2, 1.2), F.P(-0.55, -1.2, 1.2)], F.V(-1, 0, 0), RED, Z, 0.5);
    }

    // Lever and target beside a set of points, on the side away from the
    // branch. The target is a disk on a short post, painted.
    function switchStand(T, x, y, lv) {
        const S = T.S, P = card(T, x, y, 0, 0);
        S.kind = INK;
        S.box(frame(x, y, 0, 0), -0.25, -0.2, 0, 0.25, 0.2, 0.45);
        S.line([P(0, 0.45), P(0, 1.35)]);
        const r = 0.24, pts = ring(T.segs(r), (c, s) => P(r * c, 1.35 + r + (r * s) / T.cam.ce));
        S.face(pts);
        inKind(S, T.tones ? lv : S.kind, () => {
            S.loop(pts);
            if (T.tones) S.hatch(pts, Z, T.hLit * 0.6);
        });
    }

    // Semaphore signal facing trains coming along +u of frame F: a post with
    // a ladder and a finial, and a red arm sticking out to the left
    function semaphore(T, F, h, rng) {
        const S = T.S;
        S.kind = INK;
        S.box(F, -0.15, -0.15, 0, 0.15, 0.15, h);
        const [x, y, z] = F.P(0, 0, h);
        S.lathe(x, y, [[0.22, z], [0.22, z + 0.15], [0.08, z + 0.35], [0, z + 0.6]], 8);
        if (T.detail) {
            for (const v of [-0.2, 0.2]) S.line([F.P(0.35, v, 0), F.P(0.35, v, h - 1.4)]);
            for (let c = 0.4; c < h - 1.4; c += 0.45) S.line([F.P(0.35, -0.2, c), F.P(0.35, 0.2, c)]);
        }
        const arms = rng.chance(0.4) ? [h - 0.8, h - 2.6] : [h - 0.8];
        arms.forEach((c, i) => {
            const tip = rng.range(-0.25, 0.1), arm = [F.P(-0.2, 0.15, c - 0.15), F.P(-0.2, 1.55, c - 0.15 + tip), F.P(-0.2, 1.55, c + 0.15 + tip), F.P(-0.2, 0.15, c + 0.15)];
            S.face(arm);
            S.loop(arm);
            paint(T, arm, F.V(-1, 0, 0), i ? GOLD : RED, Z, 0.45);
            S.loop(ring(T.segs(0.12), (q, s) => F.P(-0.22, -0.15 + 0.12 * q, c + 0.05 + 0.12 * s)));
        });
    }

    // Signal gantry: lattice masts either side and a braced girder across
    // from y0 to y1 at x, with a color light signal over each track at ys.
    // The lit lamp is painted, the others left dark.
    function gantry(T, x, y0, y1, ys, rng) {
        const S = T.S, W = frame(0, 0, 0, 0), h = 6.4, gh = 1.1;
        S.kind = INK;
        for (const y of [y0, y1]) {
            S.box(W, x - 0.3, y - 0.3, 0, x + 0.3, y + 0.3, h + gh);
            if (T.detail) {
                for (let c = 0.3; c + 1.2 < h; c += 1.2) {
                    S.line([[x - 0.31, y - 0.3, c], [x - 0.31, y + 0.3, c + 1.2]]);
                    S.line([[x - 0.31, y + 0.3, c], [x - 0.31, y - 0.3, c + 1.2]]);
                }
            }
        }
        for (const c of [h, h + gh - 0.15]) S.box(W, x - 0.25, y0, c, x + 0.25, y1, c + 0.15);
        const n = Math.max(2, Math.round((y1 - y0) / 1.1)), zig = [];
        for (let i = 0; i <= n; i++) zig.push([x - 0.26, y0 + ((y1 - y0) * i) / n, i % 2 ? h + gh - 0.15 : h + 0.15]);
        S.line(zig);
        for (const y of ys) {
            S.box(W, x - 0.1, y - 0.1, h + gh, x + 0.1, y + 0.1, h + gh + 0.6);
            S.box(W, x - 0.25, y - 0.35, h + gh + 0.6, x, y + 0.35, h + gh + 2.2);
            const lit = rng.int(0, 2);
            for (let k = 0; k < 3; k++) {
                const c = h + gh + 1.9 - k * 0.5, pts = ring(T.segs(0.16), (q, s) => [x - 0.26, y + 0.16 * q, c + 0.16 * s]);
                inKind(S, T.tones && k === lit ? [RED, GOLD, GREEN][k] : S.kind, () => {
                    S.loop(pts);
                    if (T.tones && k === lit) S.hatch(pts, Z, 0.3);
                });
            }
        }
    }

    // Telegraph poles along a line from x0 to x1 at y, with wires sagging between them
    function telegraph(T, x0, x1, y, rng) {
        const S = T.S, gap = 32, n = Math.max(1, Math.round((x1 - x0) / gap)), h = 7.5;
        S.kind = INK;
        const tops = [];
        for (let i = 0; i <= n; i++) {
            const x = x0 + ((x1 - x0) * i) / n + rng.range(-1.5, 1.5);
            S.line([[x, y, 0], [x, y, h + 0.4]]);
            for (const c of [h, h - 0.7]) S.line([[x, y - 1, c], [x, y + 1, c]]);
            tops.push(x);
        }
        for (let i = 0; i < n; i++) {
            for (const c of [h, h - 0.7]) {
                for (const v of [-0.8, 0.8]) {
                    const pts = [];
                    for (let k = 0; k <= 10; k++) pts.push([geo.lerp(tops[i], tops[i + 1], k / 10), y + v, c + 0.08 - 0.9 * 4 * (k / 10) * (1 - k / 10)]);
                    S.line(pts);
                }
            }
        }
    }

    // Overhead wires along the main line from x0 to x1: a portal over all
    // the tracks at `ys` every so often, and for each track a sagging
    // messenger wire with the contact wire hung level under it on droppers.
    // Portals keep clear of anything at `avoid`.
    function catenary(T, x0, x1, ys, avoid) {
        const S = T.S, W = frame(0, 0, 0, 0), n = Math.max(1, Math.round((x1 - x0) / 46)), yA = Math.min(...ys) - 3, yB = Math.max(...ys) + 3;
        const hc = WIRE, hm = WIRE + 1.5;
        S.kind = INK;
        const xs = [];
        for (let i = 0; i <= n; i++) {
            let x = x0 + ((x1 - x0) * i) / n;
            for (const a of avoid) if (Math.abs(x - a) < 5) x = a + (x < a ? -5 : 5);
            xs.push(x);
            for (const y of [yA, yB]) {
                S.box(W, x - 0.18, y - 0.18, 0, x + 0.18, y + 0.18, hm + 0.9);
                if (T.detail) for (let c = 0.4; c + 1.1 < hm; c += 1.1) S.line([[x - 0.19, y - 0.18, c], [x - 0.19, y + 0.18, c + 1.1]]);
            }
            S.box(W, x - 0.14, yA, hm + 0.5, x + 0.14, yB, hm + 0.9);
            for (const y of ys) S.line([[x, y, hm + 0.5], [x, y, hc]]);
        }
        for (let i = 0; i < n; i++) {
            const a = xs[i], b = xs[i + 1], m = Math.max(2, Math.round((b - a) / 5));
            for (const y of ys) {
                const sag = t => hm - 1.1 * 4 * t * (1 - t);
                S.line(Array.from({ length: 13 }, (_, k) => [geo.lerp(a, b, k / 12), y, sag(k / 12)]));
                S.line([[a, y, hc], [b, y, hc]]);
                if (T.detail) for (let k = 1; k < m; k++) S.line([[geo.lerp(a, b, k / m), y, hc], [geo.lerp(a, b, k / m), y, sag(k / m)]]);
            }
        }
    }

    // Signal box beside the line at the throat: a brick locking room, the
    // glazed operating floor over it under a hipped roof, and an outside stair
    function signalBox(T, F, rng) {
        const S = T.S, L = 8, D = 4, h0 = 3.2, h1 = 6.3;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h0);
        S.box(F, -0.2, -0.2, h0, L + 0.2, D + 0.2, h1);
        const R = gableRoof(T, F, [-0.2, -0.2, L + 0.2, D + 0.2], h1, true, geo.rad(30), rng, { attic: false });
        shadeGable(T, F, R);
        kit.chimney(T, F, L - 1.2, D * 0.7, R.zb, R.ridge + 0.7);
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, [-0.2, -0.2, L + 0.2, D + 0.2]), { base: h0, floors: 1, style: 'split', winW: 0.9, winH: 1.5, sill: 0.9, gap: 0.15 });
            windows(T, wall(F, side, [0, 0, L, D]), { base: 0, floors: 1, style: 'bars', winW: 0.6, winH: 0.9, sill: 1.2, gap: 1.8 });
        }
        const front = wall(F, 0, [-0.2, -0.2, L + 0.2, D + 0.2]);
        if (T.sees(front.n)) rect(T, front.at, L / 2 - 1.8, h0 + 0.15, 3.6, 0.45);
        // stair up the end to a landing by the door
        const run = h0 / 0.7;
        S.prism([F.P(L, D + 0.1, h0), F.P(L, D + 0.1, h0 - 0.35), F.P(L + run, D + 0.1, 0), F.P(L + run, D + 0.1, 0.35)], F.V(0, 1, 0));
        S.box(F, L, D - 1.3, h0 - 0.2, L + 1.3, D + 1.1, h0);
        for (const v of [D + 0.1, D + 1.1]) S.line([F.P(L, v, h0 + 1), F.P(L + run, v, 1)]);
    }

    // ------------------------------------------------------------------
    // Station
    // ------------------------------------------------------------------

    const PLAT = 1.05; // platform height (m)

    // Platform along x from x0 to x1 between y0 and y1, ramped down at both
    // ends, with a coping line and a gold safety line along the edges that
    // have a track
    function platform(T, x0, x1, y0, y1, edges) {
        const S = T.S, W = frame(0, 0, 0, 0), ramp = 3.5;
        S.kind = INK;
        S.box(W, x0 + ramp, y0, 0, x1 - ramp, y1, PLAT);
        for (const [a, b] of [[x0, x0 + ramp], [x1, x1 - ramp]]) S.prism([[b, y0, 0], [b, y0, PLAT], [a, y0, 0]], [0, y1 - y0, 0]);
        for (const y of edges) {
            const inn = y === y0 ? 1 : -1;
            if (T.detail) S.line([[x0 + ramp, y + inn * 0.45, PLAT], [x1 - ramp, y + inn * 0.45, PLAT]]);
            if (T.tones) inKind(S, GOLD, () => S.line([[x0 + ramp, y + inn * 0.8, PLAT], [x1 - ramp, y + inn * 0.8, PLAT]]));
        }
    }

    // Saw-tooth valance hanging off an eave from a to b
    function daggers(T, a, b, drop) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / Math.max(0.3, 0.9 / T.k))), pts = [];
        for (let i = 0; i <= 2 * n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / (2 * n), a[1] + ((b[1] - a[1]) * i) / (2 * n), a[2] - (i % 2 ? drop : 0)]);
        T.S.line(pts);
    }

    // Platform canopy on a row of columns down the middle: a low gable roof
    // with dagger boards along both eaves, and benches and lamps under it
    function canopy(T, x0, x1, y0, y1, z, rng) {
        const S = T.S, F = frame(x0, y0, 0, 0), L = x1 - x0, D = y1 - y0, n = Math.max(2, Math.round(L / 6));
        S.kind = INK;
        for (let i = 0; i <= n; i++) {
            const a = 0.4 + ((L - 0.8) * i) / n;
            S.box(F, a - 0.1, D / 2 - 0.1, PLAT, a + 0.1, D / 2 + 0.1, z);
            if (T.detail) for (const s of [-1, 1]) S.line([F.P(a, D / 2, z - 0.8), F.P(a, D / 2 + s * 1.2, z - 0.02)]);
        }
        const R = gableRoof(T, F, [0.4, 0.4, L - 0.4, D - 0.4], z, true, geo.rad(14), rng, { attic: false });
        shadeGable(T, F, R, 'canopy');
        if (T.detail) {
            for (const b of [0, D]) daggers(T, F.P(0, b, R.zb), F.P(L, b, R.zb), 0.3);
        }
    }

    // Station building facing the street (-v), platform behind it: a
    // two-story middle with a clock in a front gable, and lower wings
    function stationHouse(T, F, L, D, rng) {
        const S = T.S, base = 0.3, wing = L * 0.3, m0 = wing, m1 = L - wing, FLOOR = kit.FLOOR;
        S.kind = INK;
        kit.plinth(T, F, [0, 0, L, D], base, 0.2);
        for (const [a0, a1] of [[0.4, m0], [m1, L - 0.4]]) {
            const fp = [a0, 0.8, a1, D - 0.8], top = base + 3.8;
            S.box(F, fp[0], fp[1], base, fp[2], fp[3], top);
            shadeGable(T, F, gableRoof(T, F, fp, top, true, geo.rad(34), rng, { attic: false }));
            for (let side = 0; side < 4; side++) windows(T, wall(F, side, fp), { base, floors: 1, style: 'frame', winW: 1, winH: 1.7, sill: 0.9, gap: 1.2 });
        }
        const fp = [m0, 0, m1, D], top = base + 2 * FLOOR + 0.8, mid = (m0 + m1) / 2;
        S.box(F, m0, 0, base, m1, D, top);
        const R = gableRoof(T, F, fp, top, true, geo.rad(38), rng, { attic: false });
        shadeGable(T, F, R);
        for (const a of [m0 + 1.2, m1 - 1.2]) kit.chimney(T, F, a, D * 0.65, R.zb, R.ridge + 0.6);
        // gabled bay out front with the clock and the doors
        const bw = Math.min(6, (m1 - m0) * 0.5), bay = [mid - bw / 2, -1.4, mid + bw / 2, 0.2];
        S.box(F, bay[0], bay[1], base, bay[2], bay[3], top);
        const RB = gableRoof(T, F, [bay[0], bay[1], bay[2], D * 0.45], top, false, geo.rad(45), rng, { attic: false });
        shadeGable(T, F, RB);
        const front = wall(F, 0, bay);
        if (T.sees(front.n)) {
            for (const s of [bw * 0.2, bw * 0.5, bw * 0.8]) arch(T, front.at, s, base, 1.1, 2.7);
            const cz = top + RB.rise * 0.35, cr = Math.min(0.85, RB.rise * 0.3);
            S.loop(ring(T.segs(cr), (x, y) => front.at(bw / 2 + cr * x, cz + cr * y)));
            if (T.detail) S.line([front.at(bw / 2, cz + cr * 0.75), front.at(bw / 2, cz), front.at(bw / 2 + cr * 0.5, cz + cr * 0.25)]);
            windows(T, front, { base: base + FLOOR + 0.3, floors: 1, style: 'frame', winW: 0.9, winH: 1.6, gap: 0.6 });
        }
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), { base: base + 0.3, floors: 2, style: 'frame', winW: 1, winH: 1.6, gap: 1.1, skip: side === 0 ? [[mid - m0 - bw / 2 - 0.3, mid - m0 + bw / 2 + 0.3]] : [] });
        }
    }

    // Lattice footbridge across y from y0 to y1 at x, deck at z, with a flight
    // of stairs down to each landing in `stairs` ([y, ground height, run
    // direction along x]) and braced trestles at `piers`. The lattice is
    // lines only so trains show through.
    function footbridge(T, x, y0, y1, z, stairs, piers = []) {
        const S = T.S, hw = 1.3, gh = 1.6;
        S.kind = INK;
        const W = frame(0, 0, 0, 0);
        S.box(W, x - hw, y0, z - 0.35, x + hw, y1, z);
        for (const s of [-1, 1]) {
            const xs = x + s * hw;
            S.box(W, xs - 0.1, y0, z + gh - 0.15, xs + 0.1, y1, z + gh);
            const n = Math.max(2, Math.round((y1 - y0) / 1.6));
            const zig = [];
            for (let i = 0; i <= n; i++) zig.push([xs, y0 + ((y1 - y0) * i) / n, i % 2 ? z + gh - 0.15 : z]);
            S.line(zig);
            for (let i = 0; i <= n; i += 2) S.line([[xs, y0 + ((y1 - y0) * i) / n, z], [xs, y0 + ((y1 - y0) * i) / n, z + gh - 0.15]]);
        }
        // stairs: a sloping flight with its handrails, on a pair of posts
        for (const [y, g, dir] of stairs) {
            const run = (z - g) / 0.62, xa = x + dir * hw, xb = xa + dir * run;
            const F = axes([xa, y, 0], [dir, 0, 0], [0, 1, 0], Z);
            S.prism([F.P(0, -1.1, z), F.P(0, -1.1, z - 0.4), F.P(run, -1.1, g), F.P(run, -1.1, g + 0.4)], F.V(0, 2.2, 0));
            for (const v of [-1.1, 1.1]) S.line([F.P(0, v, z + 1), F.P(run, v, g + 1)]);
            if (T.detail) for (let t = 0.5; t < run; t += 0.5) S.line([F.P(t, -1.1, z - (t / run) * (z - g) + 0.02), F.P(t, 1.1, z - (t / run) * (z - g) + 0.02)]);
            for (const v of [-0.9, 0.9]) S.box(F, run * 0.45 - 0.12, v - 0.12, g, run * 0.45 + 0.12, v + 0.12, g + (z - g) * 0.55 - 0.3);
        }
        // columns under the ends of the span, and trestles between the tracks
        for (const y of [y0 + 0.3, y1 - 0.3]) for (const s of [-1, 1]) S.box(W, x + s * (hw - 0.3) - 0.15, y - 0.15, 0, x + s * (hw - 0.3) + 0.15, y + 0.15, z - 0.35);
        for (const y of piers) {
            for (const s of [-1, 1]) S.box(W, x + s * (hw - 0.3) - 0.14, y - 0.14, 0, x + s * (hw - 0.3) + 0.14, y + 0.14, z - 0.35);
            if (!T.detail) continue;
            for (let c = 0.4; c + 2 < z; c += 2.1) {
                S.line([[x - hw + 0.3, y - 0.15, c], [x + hw - 0.3, y - 0.15, c + 2]]);
                S.line([[x + hw - 0.3, y - 0.15, c], [x - hw + 0.3, y - 0.15, c + 2]]);
            }
        }
    }

    // Overall roof over the station from x0 to x1, y0 to y1: a barrel vault
    // on columns springing at zb, slate either side with glass down the middle
    // under the ribs, and a glazed screen with fanned bars in the end we see.
    // The vault is a shell of faces with no ends, so the trains show through
    // the open end, and its outline is drawn by hand.
    function trainShed(T, x0, x1, y0, y1, zb) {
        const S = T.S, W = frame(0, 0, 0, 0), cam = T.cam, span = y1 - y0, rise = span * 0.32, ym = (y0 + y1) / 2;
        const R = (span * span / 4 + rise * rise) / (2 * rise), zc = zb + rise - R, th0 = Math.acos(span / 2 / R), sweep = Math.PI - 2 * th0, n = 18;
        const at = (x, th, lift = 0) => [x, ym + (R + lift) * Math.cos(th), zc + (R + lift) * Math.sin(th)];
        S.kind = INK;
        const nc = Math.max(2, Math.round((x1 - x0) / 7));
        for (const y of [y0, y1]) {
            for (let i = 0; i <= nc; i++) {
                const x = x0 + ((x1 - x0) * i) / nc;
                S.box(W, x - 0.25, y - 0.25, 0, x + 0.25, y + 0.25, zb - 0.9);
            }
            S.box(W, x0 - 0.2, y - 0.35, zb - 0.9, x1 + 0.2, y + 0.35, zb);
        }
        const th = i => th0 + (sweep * i) / n;
        for (let i = 0; i < n; i++) S.face([at(x0, th(i)), at(x1, th(i)), at(x1, th(i + 1)), at(x0, th(i + 1))]);
        for (const x of [x0, x1]) S.line(Array.from({ length: n + 1 }, (_, i) => at(x, th(i), 0.01)));
        // the curve's own outline, where it turns edge-on to us
        const sil = Math.atan2(cam.fy * cam.ce, cam.se);
        if (sil > th0 && sil < Math.PI - th0) S.line([at(x0, sil, 0.01), at(x1, sil, 0.01)]);
        // glass down the middle, slate hatched either side
        const g0 = n * 0.2, g1 = n * 0.85;
        for (let i = 0; i < n; i++) {
            if (i >= g0 && i < g1) continue;
            const q = [at(x0, th(i), 0.02), at(x1, th(i), 0.02), at(x1, th(i + 1), 0.02), at(x0, th(i + 1), 0.02)];
            shade(T, q, [0, Math.cos(th(i + 0.5)), Math.sin(th(i + 0.5))]);
        }
        for (const i of [g0, g1]) S.line([at(x0, th(i), 0.02), at(x1, th(i), 0.02)]);
        if (T.detail) for (let t = g0 + 0.5; t < g1; t += 0.5) S.line([at(x0, th(t), 0.02), at(x1, th(t), 0.02)]);
        const nr = Math.max(2, Math.round((x1 - x0) / 6));
        for (let i = 1; i < nr; i++) S.line(Array.from({ length: n + 1 }, (_, k) => at(x0 + ((x1 - x0) * i) / nr, th(k), 0.05)));
        // end screen: a beam across, and bars fanning up from it to the arch
        const zv = zb + rise * 0.2;
        S.box(W, x0 - 0.1, y0, zv - 0.5, x0 + 0.3, y1, zv);
        const hub = [x0, ym, zv];
        for (let k = 1; k < 10; k++) {
            const a = th0 + (sweep * k) / 10, q = at(x0, a, -0.05);
            if (q[2] > zv + 0.3) S.line([hub, q]);
        }
        if (T.detail) S.line(Array.from({ length: 13 }, (_, k) => { const a = th0 + 0.15 + ((sweep - 0.3) * k) / 12; return [x0, ym + (R - rise * 0.45) * Math.cos(a), Math.max(zv, zc + (R - rise * 0.45) * Math.sin(a))]; }));
    }

    // Goods shed over a siding along x at y: a long brick shed with arched
    // openings at the ends for the track, loading doors on the road side
    // under a canopy, and a lorry or two backed up to it
    function goodsShed(T, x0, L, y, rng) {
        const S = T.S, D = 13, F = frame(x0, y - 8.5, 0, 0), fp = [0, 0, L, D], h = 6.4;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        shadeGable(T, F, gableRoof(T, F, fp, h, true, geo.rad(26), rng, { attic: true }));
        const end = wall(F, 3, fp);
        if (T.sees(end.n)) doorway(T, end.at, D - 8.5, 4.4, 5.4);
        const front = wall(F, 0, fp), n = Math.max(2, Math.floor(L / 6));
        if (T.sees(front.n)) {
            for (let i = 0; i < n; i++) {
                const s = (L * (i + 0.5)) / n;
                kit.garageDoor(T, front.at, s - 1.4, 0.9, 2.8, 3);
            }
        }
        // canopy out over the loading bank
        S.box(F, 0, -2.2, 0, L, 0, 0.9);
        const c = [F.P(0, 0, 5), F.P(L, 0, 5), F.P(L, -3.6, 4.3), F.P(0, -3.6, 4.3)];
        S.prism(c, [0, 0, 0.18]);
        shade(T, c.map(q => [q[0], q[1], q[2] + 0.18]), outward(c, F.P(L / 2, 2, 0)), 'canopy');
        for (let i = 0; i <= n; i++) S.line([F.P((L * i) / n, -3.4, 4.35), F.P((L * i) / n, -0.2, 3.3)]);
        for (let i = 0; i < n; i++) {
            if (!rng.chance(0.55)) continue;
            const [x, yy] = F.P((L * (i + 0.5)) / n, -6.2, 0);
            S.kind = FIGURE;
            kit.car(T, x, yy, 0, 3, rng, true, rng.chance(0.6) ? 'truck' : 'van');
            S.kind = INK;
        }
    }

    // Stacks of containers in rows along x between x0 and x1, from y0 across to y1
    function containerStacks(T, x0, x1, y0, y1, rng) {
        const lvs = [RED, RED, GOLD, GOLD, 'dark', null, null];
        for (let y = y0 + 1.3; y < y1 - 1.2; y += 2.7) {
            for (let x = x0; x + 6.1 < x1; ) {
                const len = rng.chance(0.6) && x + 12.2 < x1 ? 12.2 : 6.1;
                const F = frame(x, y, 0, 0);
                let c = 0;
                for (let k = rng.int(0, 3); k > 0; k--) c = container(T, F, 0, len, c, rng.pick(lvs), rng);
                x += len + rng.range(0.3, 1.2);
            }
        }
    }

    // Rail-mounted gantry crane from yA to yB over whatever's between, legs
    // running on their own rails along x. The trolley hangs a container off
    // its spreader. Returns nothing, it's just big.
    function gantryCrane(T, x, yA, yB, rng) {
        const S = T.S, W = frame(0, 0, 0, 0), h = 14.5, e = 4.5;
        S.kind = INK;
        for (const y of [yA, yB]) {
            S.box(W, x - e - 1, y - 0.5, 0, x + e + 1, y + 0.5, 1.1);
            for (const s of [-1, 1]) tube(T, [x + s * e, y, 1.1], [x + s * 1.2, y, h], 0.32, 8);
            if (T.detail) S.line([[x - e * 0.7, y, 3], [x + e * 0.7, y, 3]]);
            S.kind = TRACK;
            S.line([[x - 40, y, 0.1], [x + 40, y, 0.1]]);
            S.kind = INK;
        }
        S.box(W, x - 1.4, yA - 5, h, x + 1.4, yB + 5, h + 1.8);
        if (T.detail) {
            const k = Math.round((yB - yA + 10) / 1.8), zig = [];
            for (let i = 0; i <= k; i++) zig.push([x - 1.41, yA - 5 + ((yB - yA + 10) * i) / k, i % 2 ? h + 1.7 : h + 0.1]);
            S.line(zig);
        }
        // cab and trolley partway across, with a box coming up on the spreader
        const yt = geo.lerp(yA + 3, yB - 3, rng.range(0.2, 0.8)), zs = rng.range(5, 9);
        S.box(W, x - 1.7, yt - 1.6, h + 1.8, x + 1.7, yt + 1.6, h + 3.2);
        S.box(W, x - 1.2, yt - 1, h - 2.4, x + 1.2, yt + 1, h);
        for (const dx of [-1, 1]) S.line([[x + dx * 0.9, yt, h - 2.4], [x + dx * 3, yt, zs + 2.8]]);
        S.box(W, x - 3.1, yt - 1.3, zs + 2.6, x + 3.1, yt + 1.3, zs + 2.8);
        container(T, axes([x - 3.05, yt, 0], [1, 0, 0], [0, 1, 0], Z), 0, 6.1, zs, rng.pick([RED, GOLD, null]), rng);
    }

    // ------------------------------------------------------------------
    // Industry
    // ------------------------------------------------------------------

    // Gasholder: a ring of columns tied together at the top and halfway up
    // by lattice girders, with the bell inside risen partway
    function gasholder(T, x, y, R, rng) {
        const S = T.S, n = 12, H = R * 1.45, hb = geo.lerp(4, H - 2, rng.range(0.3, 0.9)), rb = R - 0.9;
        S.kind = INK;
        S.lathe(x, y, [[R + 0.4, 0], [R + 0.4, 1.4]], T.segs(R));
        S.lathe(x, y, [[rb, 1.4], [rb, hb], [rb * 0.75, hb + rb * 0.1], [rb * 0.35, hb + rb * 0.16], [0, hb + rb * 0.18]], T.segs(rb));
        shadeRound(T, x, y, 1.4, hb, rb, rb);
        if (T.detail) for (let z = 4; z < hb - 0.8; z += 3.2) S.loop(ring(T.segs(rb), (c, s) => [x + (rb + 0.01) * c, y + (rb + 0.01) * s, z]));
        for (let i = 0; i < n; i++) {
            const a = (TAU * i) / n;
            tube(T, [x + R * Math.cos(a), y + R * Math.sin(a), 0], [x + R * Math.cos(a), y + R * Math.sin(a), H], 0.3, 6);
        }
        for (const z of [H * 0.5, H]) {
            for (const dz of [-0.7, 0]) S.loop(ring(n * 4, (c, s) => [x + R * c, y + R * s, z + dz]));
            if (!T.detail) continue;
            const zig = [];
            for (let i = 0; i <= n * 6; i++) zig.push([x + R * Math.cos((TAU * i) / (n * 6)), y + R * Math.sin((TAU * i) / (n * 6)), z - (i % 2 ? 0.7 : 0)]);
            S.line(zig);
        }
    }

    // Works in frame F (fronts on v = 0): a long shed under a saw-tooth roof
    // with its glazing facing the street, an office block on the front and a
    // tall chimney. Returns the chimney top.
    function works(T, F, L, D, rng) {
        const S = T.S, h = rng.range(5, 6.5), P = F.P;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        const n = Math.max(3, Math.round(D / 4)), dv = D / n, ht = dv * 0.55;
        for (let i = 0; i < n; i++) {
            const b = dv * i;
            S.prism([P(-0.15, b, h), P(-0.15, b, h + ht), P(-0.15, b + dv, h)], F.V(L + 0.3, 0, 0));
            shade(T, [P(-0.15, b, h + ht), P(L + 0.15, b, h + ht), P(L + 0.15, b + dv, h), P(-0.15, b + dv, h)], F.V(0, ht, dv), 'lit');
            if (T.detail && T.sees(F.V(0, -1, 0))) {
                const m = Math.max(2, Math.round(L / 1.2));
                for (let j = 1; j < m; j++) S.line([P((L * j) / m, b, h + 0.1), P((L * j) / m, b, h + ht - 0.1)]);
            }
        }
        for (let side = 0; side < 4; side++) windows(T, wall(F, side, [0, 0, L, D]), { base: 0, floors: 1, style: 'bars', winW: 1.4, winH: 1.8, sill: 1.6, gap: 1.2 });
        const oa = rng.range(2, Math.max(2.1, L - 12)), of = [oa, -0.1, oa + 10, 5];
        S.box(F, of[0], of[1], 0, of[2], of[3], h + 2);
        kit.flatRoof(T, F, of, h + 2, 0.2, 0.35);
        windows(T, wall(F, 0, of), { base: 0, floors: 2, style: 'frame', winW: 1, winH: 1.4, gap: 0.9 });
        const [x, y] = P(rng.chance(0.5) ? L * 0.8 : L * 0.2, D * 0.7, 0), H = rng.range(24, 34);
        S.lathe(x, y, [[1.5, 0], [1.5, 1.5], [0.85, H], [1.05, H + 0.25], [1.05, H + 1]], 16);
        if (T.detail) for (const f of [0.3, 0.6, 0.85]) S.loop(ring(16, (c, s) => [x + (1.5 - 0.65 * f + 0.02) * c, y + (1.5 - 0.65 * f + 0.02) * s, 1.5 + (H - 1.5) * f]));
        return [x, y, H + 1];
    }

    // ------------------------------------------------------------------
    // Town either side of the railway
    // ------------------------------------------------------------------

    const tree = withKind(GREEN, kit.roundTree);

    // Row of terraced houses under one long roof, ridge along the street,
    // from u = 0 to L in frame F with the fronts on v = 0. Chimneys on the
    // party walls, a back extension each and walled yards behind with a
    // privy and sometimes washing out.
    function terraceRow(T, F, L, rng) {
        const S = T.S, FLOOR = kit.FLOOR, D = 7.5, Y = 8, base = 0.25, n = Math.max(2, Math.round(L / 5.2)), w = L / n, top = base + 2 * FLOOR;
        S.kind = INK;
        kit.plinth(T, F, [0, 0, L, D], base, 0.1);
        S.box(F, 0, 0, base, L, D, top);
        const R = gableRoof(T, F, [0, 0, L, D], top, true, geo.rad(rng.range(30, 38)), rng, { attic: false });
        shadeGable(T, F, R);
        for (let i = 1; i < n; i++) kit.chimney(T, F, i * w, D / 2 + 0.6, R.zb, R.ridge + 0.5);
        const doors = Array.from({ length: n }, (_, i) => i * w + (i % 2 ? w - 1 : 1));
        const front = wall(F, 0, [0, 0, L, D]);
        if (T.sees(front.n)) for (const d of doors) door(T, front.at, d, base, 0.95, 2.1);
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, [0, 0, L, D]), { base, floors: 2, style: 'sash', winW: 0.95, winH: 1.35, gap: 1.3, doors: side === 0 ? doors : [] });
        }
        for (let i = 0; i < n; i++) {
            const a0 = i % 2 ? i * w + 0.25 : (i + 1) * w - 2.75, a1 = a0 + 2.5;
            S.box(F, a0, D, base, a1, D + 3.4, base + FLOOR);
            shadeGable(T, F, gableRoof(T, F, [a0, D, a1, D + 3.4], base + FLOOR, false, geo.rad(30), rng, { attic: false }));
            // yard walls, a privy in the far corner and maybe washing
            S.box(F, i * w - 0.1, D + 3.4, 0, i * w + 0.1, D + Y, 1.6);
            S.box(F, i * w + 0.1, D + Y - 0.2, 0, (i + 1) * w - 0.1, D + Y, 1.6);
            const pa = i % 2 ? (i + 1) * w - 1.5 : i * w + 0.3;
            S.box(F, pa, D + Y - 1.5, 0, pa + 1.2, D + Y - 0.2, 2.1);
            const pw = wall(F, 0, [pa, D + Y - 1.5, pa + 1.2, D + Y - 0.2]);
            if (T.sees(pw.n)) door(T, pw.at, 0.6, 0, 0.7, 1.7);
            if (rng.chance(0.55)) kit.clothesline(T, F, i * w + 0.6, D + 5, w - 1.2, rng);
        }
    }

    // Street along x at y from x0 to x1: raised sidewalks, lamps, parked cars
    // and people about
    function street(T, x0, x1, y, rng) {
        const { S, p } = T, W = frame(0, 0, 0, 0), hw = 4.5, sw = 1.8;
        S.kind = INK;
        for (const s of [-1, 1]) {
            const e = y + s * hw;
            S.box(W, x0, Math.min(e, e + s * sw), 0, x1, Math.max(e, e + s * sw), 0.15);
            for (let x = x0 + rng.range(4, 12); x < x1; x += rng.range(18, 26)) crookLamp(T, x, e + s * 0.5, 0.15);
            for (let x = x0 + rng.range(2, 10); x < x1 - 6; ) {
                if (rng.chance(0.25 + p.people * 0.4)) {
                    kit.car(T, x + 2.5, y + s * (hw - 1.15), 0, s < 0 ? 0 : 2, rng, true);
                    x += rng.range(6, 9);
                } else x += rng.range(5, 14);
            }
            for (let i = Math.round(((x1 - x0) / 25) * p.people); i > 0; i--) person(T, rng.range(x0, x1), e + s * rng.range(0.5, 1.4), 0.15, rng);
        }
    }

    // Streets filling the page from the railway's edge at y0 out along s (+1
    // or -1): a street, a row of terraces facing it with its yards behind, an
    // alley, the next row's yards and that row facing the next street. The
    // rows break for cross streets and the odd tree. With industry about, a
    // block can be a works or a gasholder instead. Returns the chimney tops.
    function town(T, y0, s, rng) {
        const { p } = T, chimneys = [], mills = { terraces: 0, industry: 0.85, mixed: 0.35 }[p.town];
        let y = y0;
        for (let k = 0; k < 3; k++) {
            const yc = y + s * 4.5, sp = T.span(yc, 0, -30), spf = T.span(yc + s * 40, 0, -30);
            if (!sp && !spf) break;
            const lo = Math.min(sp ? sp[0] : Infinity, spf ? spf[0] : Infinity), hi = Math.max(sp ? sp[1] : -Infinity, spf ? spf[1] : -Infinity);
            street(T, lo - 10, hi + 10, yc, rng);
            const yA = yc + s * 6.3, yB = yA + s * 34;
            // blocks between cross streets
            let x = lo - rng.range(0, 30);
            while (x < hi) {
                const len = rng.range(34, 60), x1 = x + len;
                if (rng.chance(mills) && T.onPage(x + len / 2, yA + s * 17, 0, 80)) {
                    if (rng.chance(0.4)) gasholder(T, x + len / 2, yA + s * 17, Math.min(15, len / 2 - 3), rng);
                    else chimneys.push(works(T, frame(s > 0 ? x : x1, yA, 0, s > 0 ? 0 : 2), len, 30, rng));
                    x = x1 + 9;
                    continue;
                }
                for (const [yf, out] of [[yA, s], [yB, -s]]) {
                    // frame with v running back from the street, u along it
                    const dir = out > 0 ? 0 : 2, ox = out > 0 ? x : x1;
                    const F = frame(ox, yf, 0, dir);
                    if (!T.onPage(x + len / 2, yf + out * 8, 0, 60)) continue;
                    if (rng.chance(0.12)) {
                        for (let i = 0; i < 3; i++) {
                            const [tx, ty] = F.P(rng.range(3, len - 3), rng.range(2, 12), 0);
                            tree(T, tx, ty, 0, rng);
                        }
                        continue;
                    }
                    terraceRow(T, F, len, rng);
                }
                x = x1 + 9;
            }
            y = yB + s * 1.8;
        }
        return chimneys;
    }

    // ------------------------------------------------------------------
    // Odds and ends on the spare ground
    // ------------------------------------------------------------------

    // Stack of sleepers: a block with the top layer marked out on it. Any
    // more lines than that and it plots as a black lump.
    function sleepers(T, F, rng) {
        const S = T.S, h = rng.int(3, 6) * 0.22;
        S.kind = INK;
        S.box(F, -1.3, -1.1, 0, 1.3, 1.1, h);
        if (T.detail) for (const b of [-0.55, 0, 0.55]) S.line([F.P(-1.3, b, h), F.P(1.3, b, h)]);
    }

    // Rails stacked on a rack of short posts
    function railRack(T, F) {
        const S = T.S;
        S.kind = INK;
        for (const a of [-3.5, 0, 3.5]) S.box(F, a - 0.12, -0.8, 0, a + 0.12, 0.8, 0.5);
        for (const b of [-0.5, 0, 0.5]) S.line([F.P(-4.5, b, 0.52), F.P(4.5, b, 0.52)]);
    }

    // Cluster of oil drums
    function drums(T, x, y, rng) {
        const S = T.S;
        S.kind = INK;
        for (let i = rng.int(3, 7); i > 0; i--) {
            const a = rng.range(0, TAU), d = rng.range(0, 1.1), dx = x + d * Math.cos(a), dy = y + d * Math.sin(a);
            S.lathe(dx, dy, [[0.29, 0], [0.29, 0.88]], 10);
            if (T.detail) S.loop(ring(10, (c, s) => [dx + 0.3 * c, dy + 0.3 * s, 0.44]));
        }
    }

    // Tin hut with a gable roof: a lamp room or stores
    function hut(T, F, rng) {
        const S = T.S, L = rng.range(3, 5), D = rng.range(2.4, 3.2), h = 2.5;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        shadeGable(T, F, gableRoof(T, F, [0, 0, L, D], h, rng.chance(0.5), geo.rad(28), rng, { attic: false }));
        const W = wall(F, 0, [0, 0, L, D]);
        if (T.sees(W.n)) {
            door(T, W.at, L * 0.3, 0, 0.9, 2);
            pane(T, W.at, L * 0.55, 1, 0.8, 0.8, 'cross');
        }
        return [L, D];
    }

    // Sand drying house: a brick shed with a tall chimney. Returns the chimney top.
    function sandHouse(T, F, rng) {
        const S = T.S, L = 7, D = 4.5, h = 3.4;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, h);
        shadeGable(T, F, gableRoof(T, F, [0, 0, L, D], h, true, geo.rad(32), rng, { attic: false }));
        for (let side = 0; side < 4; side++) windows(T, wall(F, side, [0, 0, L, D]), { base: 0, floors: 1, style: 'bars', winW: 0.8, winH: 1, sill: 1.2, gap: 1.6 });
        const [x, y] = F.P(L - 1, D / 2, 0), H = rng.range(11, 15);
        S.lathe(x, y, [[0.75, 0], [0.5, H], [0.62, H + 0.1], [0.62, H + 0.5]], 12);
        if (T.detail) for (const f of [0.35, 0.7]) S.loop(ring(12, (c, s) => [x + (0.75 - 0.25 * f + 0.02) * c, y + (0.75 - 0.25 * f + 0.02) * s, H * f]));
        return [x, y, H + 0.5];
    }

    // Heap of loco coal, with a board wall along the back
    function coalStack(T, F, rng) {
        const L = rng.range(7, 11), D = rng.range(4, 5.5);
        heap(T, F, 0, L, D / 2, 0, rng.range(1.4, 2));
        T.S.box(F, -0.3, D / 2 + 0.1, 0, L + 0.3, D / 2 + 0.3, 1.6);
        return [L, D];
    }

    // Small lumpy bush sitting on the ground, a cut-out facing the camera
    function bush(T, x, y, r, rng) {
        const S = T.S, ce = T.cam.ce, P = card(T, x, y, 0, 0), n = Math.max(10, T.segs(r)), lumps = rng.int(3, 5), pts = [];
        S.kind = GREEN;
        for (let i = 0; i <= n; i++) {
            const a = (Math.PI * i) / n, rr = r * (1 + 0.14 * Math.abs(Math.sin(a * lumps)));
            pts.push(P(rr * Math.cos(a), (rr * Math.sin(a)) / ce * 0.8));
        }
        S.face(pts);
        S.loop(pts);
    }

    // Everything already standing, as disks and boxes on the ground, and the
    // edges of the town on either side
    class Claims {
        constructor() { this.discs = []; this.rects = []; this.lo = -Infinity; this.hi = Infinity; }
        disc(x, y, r) { this.discs.push([x, y, r]); }
        rect(x0, y0, x1, y1) { this.rects.push([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]); }
        free(x, y, r) {
            if (y - r < this.lo || y + r > this.hi) return false;
            if (this.discs.some(([a, b, q]) => (a - x) ** 2 + (b - y) ** 2 < (q + r) ** 2)) return false;
            return !this.rects.some(([a, b, c, d]) => x + r > a && x - r < c && y + r > b && y - r < d);
        }
    }

    // Fill the spare ground between the tracks and buildings. Clutter
    // (sleepers, rails, drums, huts, coal) stays by the tracks and round the
    // depot, trees come in clumps where noise says so, and most of the rest
    // is left bare. Candidates come off a grid on the page so all of it gets a look.
    function odds(T, claims, gap, depot, rng, steam) {
        const { S, p, cam } = T;
        const step = 6, spots = [];
        for (let sy = -10; sy < S.H + 30; sy += step) {
            for (let sx = -5; sx < S.W + 5; sx += step) {
                const [x, y] = cam.ground(sx + rng.range(-2, 2), sy + rng.range(-2, 2), 0);
                spots.push([x, y]);
            }
        }
        rng.shuffle(spots);
        let sand = 0, coal = 0;
        for (const [x, y] of spots) {
            const room = gap(x, y);
            if (room < 3.5 || !claims.free(x, y, 1.5)) continue;
            const wood = T.noise.fbm2(x / 45, y / 45, 2) + (p.trees - 0.5) * 0.6, busy = T.noise.noise2(x / 30 + 17, y / 30);
            const near = Math.hypot(x - depot.x, y - depot.y) < 85, lineside = room < 12;
            let kind = 'none';
            if (wood > 0.3 && room > 5) kind = rng.chance(0.8) ? 'tree' : 'bush';
            else if ((near || lineside) && busy > 0.15 - p.props * 0.3 && rng.chance(0.25 + p.props * 0.5)) {
                kind = rng.weighted([
                    [near && room > 9 && coal < 2 ? 1.5 : 0, 'coal'], [room > 6 ? 3 : 0, 'sleepers'], [room > 7 ? 2 : 0, 'rails'], [2, 'drums'],
                    [room > 7 ? 2 : 0, 'hut'], [near && room > 9 && !sand ? 1.2 : 0, 'sand'], [1.5 * p.people, 'man'], [1, 'bush'],
                ]);
            } else if (lineside && rng.chance(0.06 * p.people)) kind = 'man';
            else if (rng.chance(0.04 * p.trees)) kind = 'bush';
            const F = frame(x, y, 0, rng.pick([0, 1]));
            if (kind === 'coal' && claims.free(x + 4, y, 5)) {
                const [L, D] = coalStack(T, frame(x - 4.5, y, 0, 0), rng);
                claims.rect(x - 5, y - D / 2 - 0.5, x - 4.5 + L + 0.5, y + D / 2 + 0.5);
                coal++;
            } else if (kind === 'sleepers') {
                sleepers(T, F, rng);
                claims.disc(x, y, 2);
            } else if (kind === 'rails' && gap(x + 4, y) > 3 && gap(x - 4, y) > 3 && claims.free(x, y, 3)) {
                railRack(T, frame(x, y, 0, 0));
                claims.rect(x - 4.7, y - 1, x + 4.7, y + 1);
            } else if (kind === 'drums') {
                drums(T, x, y, rng);
                claims.disc(x, y, 1.6);
            } else if (kind === 'hut' && claims.free(x, y, 3.5)) {
                const [L, D] = hut(T, frame(x - 2, y - 1.4, 0, 0), rng);
                claims.rect(x - 2.3, y - 1.7, x - 2 + L + 0.3, y - 1.4 + D + 0.3);
            } else if (kind === 'sand' && claims.free(x + 1, y, 6) && gap(x + 4, y) > 6) {
                steam.push({ top: sandHouse(T, frame(x - 2.5, y - 2.2, 0, 0), rng), smoke: true });
                claims.rect(x - 3, y - 2.7, x + 5, y + 2.8);
                sand++;
            } else if (kind === 'tree') {
                tree(T, x, y, 0, rng);
                claims.disc(x, y, 2.2);
            } else if (kind === 'bush') {
                bush(T, x, y, rng.range(0.6, 1.2), rng);
                claims.disc(x, y, 1.2);
            } else if (kind === 'man') {
                person(T, x, y, 0, rng);
                claims.disc(x, y, 0.6);
            }
        }
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    // Radius for points at angle A that still leave the first branch clear of
    // a track g away
    const pointsRadius = (A, g, max = 70) => Math.min(max, (0.9 * g) / (2 * (1 - Math.cos(A))));

    // Tracks fanning out to one side of the track at (x, y) that runs along
    // x: a ladder at angle A with points off it, one track for each y in ys
    // (nearest first), and the ladder itself curving into the last one. They
    // all run on to x1. Returns the tracks in the order of ys, the ladder,
    // the points for their stands and where the fan straightens out.
    function fan(x, y, ys, A, R, x1, from) {
        const sg = Math.sign(ys[0] - y), c = R * (1 - Math.cos(A)), along = yy => (Math.abs(yy - y) - 2 * c) / Math.sin(A);
        const P = new Path(x, y).turn(R, sg * A), ex = P.x, ey = P.y;
        P.go(along(ys[ys.length - 1])).turn(R, -sg * A);
        const end = P.x, ladder = new Track(P.to(x1).pts, { from, kind: 'yard' }), tracks = [], switches = [[x, y, 0, sg]];
        for (const yy of ys.slice(0, -1)) {
            const d = along(yy), bx = ex + Math.cos(A) * d, by = ey + sg * Math.sin(A) * d;
            tracks.push(new Track(new Path(bx, by, sg * A).turn(R, -sg * A).to(x1).pts, { from: ladder, kind: 'yard' }));
            switches.push([bx, by, sg * A, -sg]);
        }
        tracks.push(ladder);
        return { tracks, ladder, switches, end };
    }

    // S bend from (x, y) heading along x over to y1: out at angle B on radius
    // R, straight, and back. Returns the path and the length of the straight.
    function sBend(x, y, y1, B, R) {
        const sg = Math.sign(y1 - y), run = Math.max(0, (Math.abs(y1 - y) - 2 * R * (1 - Math.cos(B))) / Math.sin(B));
        return { P: new Path(x, y).turn(R, sg * B).go(run).turn(R, -sg * B), run, dx: 2 * R * Math.sin(B) + run * Math.cos(B) };
    }

    // Arc length along track t where it gets to x (tracks that only head +x)
    function sAt(t, x) {
        let j = 0;
        while (j < t.pts.length - 1 && t.pts[j][0] < x) j++;
        return t.cum[j] - (t.pts[j][0] - x);
    }

    // Arc lengths along track t that show on the page
    function visible(T, t, m = 0) {
        let a = null, b = null;
        for (let s = 0; s <= t.len; s += 2) {
            const [x, y] = t.at(s);
            if (!T.onPage(x, y, t.z, m)) continue;
            if (a === null) a = s;
            b = s;
        }
        return a === null ? null : [a, b];
    }

    // The main lines along the near side, the lead down the middle of the
    // yard, and a fan of points either side of it
    function planYard(T, L, rng) {
        const { p } = T, { X0, X1, N, mid, Y } = L;
        L.mains = [];
        for (let j = 0; j < p.mains; j++) {
            L.mains.push(new Track(new Path(X0, Y.main(j)).to(X1).pts, { kind: 'main', wired: p.wires }));
            L.tracks.push(L.mains[j]);
        }
        Y.lead = Y.yard(mid);
        L.span = T.span(Y.lead, 0, 0) || [X0, X1];
        L.xs = geo.lerp(L.span[0], L.span[1], rng.range(0.2, 0.3));
        L.lead = new Track(new Path(X0, Y.lead).to(X1).pts, { kind: 'yard' });
        L.tracks.push(L.lead);
        L.yard = [];
        L.yard[mid] = L.lead;
        const A = geo.rad(17), R = pointsRadius(A, L.g), ladders = [];
        L.fanEnd = L.xs;
        for (const sg of [1, -1]) {
            const idx = [];
            for (let i = mid + sg; i >= 0 && i < N; i += sg) idx.push(i);
            if (!idx.length) continue;
            const f = fan(L.xs, Y.lead, idx.map(i => Y.yard(i)), A, R, X1, L.lead);
            idx.forEach((i, k) => { L.yard[i] = f.tracks[k]; });
            ladders.push(f.ladder);
            L.switches.push(...f.switches);
            L.fanEnd = Math.max(L.fanEnd, f.end);
        }
        // yard tracks nearest the lead win over the ones further out, the ladders over nothing
        const order = L.yard.map((t, i) => [t, i]).filter(([t]) => t !== L.lead && !ladders.includes(t)).sort((u, v) => Math.abs(u[1] - mid) - Math.abs(v[1] - mid));
        for (const [t] of order) L.tracks.push(t);
        for (const t of ladders) L.tracks.push(t);
    }

    // The engine depot up past the yard: a roundhouse round a turntable, a
    // round engine house over one, or a straight shed with its roads fanning
    // into it. It's reached off the lead by an S bend that runs on under the
    // coaling tower, with a couple of servicing sidings off the S.
    function planDepot(T, L, rng) {
        const { p, cam } = T, { Y, N, xs } = L, top = Y.yard(N - 1);
        const D = L.depot = { kind: p.depot, service: [], spokes: [] };
        if (D.kind === 'roundhouse') {
            // stalls stop well short of the approach coming in from -x, and the
            // whole thing sits far enough up that the nearest stall clears the yard
            Object.assign(D, { Rt: 11, rIn: 22, depth: 20, da: geo.rad(11), face: Math.atan2(cam.fy, cam.fx) });
            D.stalls = Math.min(p.stalls, Math.floor((2 * (Math.PI - 0.45 - D.face)) / D.da));
            D.a0 = D.face - (D.stalls * D.da) / 2;
            D.y = top + Math.max(D.Rt + 10, 5 - (D.rIn + D.depth) * Math.min(0, Math.sin(D.a0)));
            D.far = D.y + (D.stalls ? D.rIn + D.depth : D.Rt);
        } else if (D.kind === 'round') {
            Object.assign(D, { Rt: 11, Rh: 25 });
            D.y = top + D.Rh + 7;
            D.far = D.y + D.Rh;
        } else {
            Object.assign(D, { gs: 5.2, nr: 5, A: geo.rad(20) });
            D.R = pointsRadius(D.A, D.gs, 40);
            D.y = top + 18;
            D.roads = Array.from({ length: D.nr }, (_, k) => D.y + k * D.gs);
            D.far = D.roads[D.nr - 1] + 4;
        }
        // `door` is where the depot proper starts, the S bend comes back from there
        const sp = T.span(D.kind === 'shed' ? D.y + 10 : D.y, 0, 0) || L.span, straight = 26, Rd = 26, B = geo.rad(34);
        let door;
        if (D.kind === 'roundhouse') {
            D.x = geo.lerp(sp[0], sp[1], rng.range(0.42, 0.55));
            door = D.x - D.Rt;
        } else if (D.kind === 'round') {
            D.x = geo.lerp(sp[0], sp[1], rng.range(0.45, 0.58));
            door = D.x - D.Rh;
        } else {
            const c = D.R * (1 - Math.cos(D.A)), len = 2 * D.R * Math.sin(D.A) + ((D.nr - 1) * D.gs - 2 * c) / Math.tan(D.A);
            D.x = geo.lerp(sp[0], sp[1], rng.range(0.52, 0.64));
            door = D.x - 10 - len;
        }
        const bend = sBend(0, Y.lead, D.y, B, Rd);
        let xap = door - straight - bend.dx;
        if (xap > xs - 30) {
            const d = xap - (xs - 30);
            xap -= d;
            door -= d;
            D.x -= d;
        }
        D.door = door;
        const end = D.kind === 'shed' ? D.x + 56 : D.x - D.Rt - 0.3;
        D.approach = new Track(sBend(xap, Y.lead, D.y, B, Rd).P.to(end).pts, { from: L.lead, kind: 'depot' });
        L.tracks.push(D.approach);
        // servicing sidings off the diagonal of the S, out over the spare
        // ground between it and the fan, each ending at a buffer stop
        const sx0 = xap + Rd * Math.sin(B), sy0 = Y.lead + Rd * (1 - Math.cos(B)), Rb = 30;
        for (const [up, reach] of [[11, 26], [17, 46]]) {
            const yb = Y.lead + up - Rb * (1 - Math.cos(B));
            if (yb < sy0 + 1.5 || yb > sy0 + bend.run * Math.sin(B) - 1.5) continue;
            const xb = sx0 + (yb - sy0) / Math.tan(B), xe = Math.min(xs + reach, door - 30);
            if (xe - xb < 45) continue;
            const t = new Track(new Path(xb, yb, B).turn(Rb, -B).to(xe).pts, { from: D.approach, stop: true, kind: 'service' });
            D.service.push(t);
            L.tracks.push(t);
        }
        if (D.kind === 'shed') {
            const f = fan(door, D.y, D.roads.slice(1), D.A, D.R, end, D.approach);
            D.roadTracks = [D.approach, ...f.tracks];
            L.switches.push(...f.switches);
            for (const t of f.tracks) L.tracks.push(t);
        }
        if (D.kind === 'roundhouse') {
            // spokes off the turntable, into the stalls and a few out in the open
            const spoke = (a, r1, stall) => {
                const pts = [];
                for (let r = D.Rt + 0.4; r <= r1; r += 1) pts.push([D.x + r * Math.cos(a), D.y + r * Math.sin(a)]);
                const t = new Track(pts, { own: true, tie: s => Math.min(TIE, (D.Rt + 0.4 + s) * D.da * 0.5 - 0.08), kind: 'spoke', a, stall, stop: !stall });
                D.spokes.push(t);
                L.tracks.push(t);
            };
            for (let i = 0; i < D.stalls; i++) spoke(D.a0 + (i + 0.5) * D.da, D.rIn + D.depth - 1.5, true);
            for (let i = 1, a = D.a0 + (D.stalls + 1) * D.da; i <= 3 && a < Math.PI - 0.5; i++, a += D.da * 1.3) spoke(a, D.rIn + 4 + i * 2, false);
        }
    }

    // The near side of the main line: a station on a loop with an island
    // platform and a side platform in front of the station building, under
    // canopies or an overall roof, or a goods yard with the goods shed and
    // the container stacks on sidings off the main line. `near` is where the
    // town can start.
    function planStation(T, L, rng) {
        const { p } = T, yM = L.Y.main(p.mains - 1), near = L.mains[p.mains - 1];
        L.yM = yM;
        L.near = yM - 7;
        if (p.station === 'canopies' || p.station === 'trainshed') {
            const yL = yM - 10.3, sp = T.span(yL - 4, PLAT) || L.span;
            const len = geo.clamp((sp[1] - sp[0]) * 0.42, 45, 80), xm = geo.lerp(sp[0], sp[1], rng.range(0.4, 0.52));
            const st = L.st = { x0: xm - len / 2, x1: xm + len / 2, yL };
            const b = sBend(0, yM, yL, geo.rad(15), 60);
            const P = sBend(st.x0 - 8 - b.dx, yM, yL, geo.rad(15), 60).P.to(st.x1 + 8).turn(60, geo.rad(15)).go(b.run).turn(60, -geo.rad(15));
            st.loop = new Track(P.pts, { from: near, to: near, kind: 'loop' });
            L.tracks.push(st.loop);
            L.near = yL - 7.15 - 9.5 - 4;
        } else if (p.station === 'goods') {
            // a siding down off the main line through the goods shed, and one
            // more off that under the gantry crane with the stacks beside it
            const yA = yM - 7.5, yB = yA - 6, sp = T.span(yA - 6, 0, 0) || L.span, B = geo.rad(16), R = 40;
            const a = sBend(0, yM, yA, B, R), xg = geo.lerp(sp[0], sp[1], rng.range(0.06, 0.14));
            const G = L.goods = { yA, yB, shed: xg + a.dx + 6 };
            G.cut = G.shed + 38;
            G.a = new Track(sBend(xg, yM, yA, B, R).P.to(G.cut + 95).pts, { from: near, stop: true, kind: 'goods' });
            G.b = new Track(sBend(G.cut, yA, yB, B, R).P.to(G.cut + 105).pts, { from: G.a, stop: true, kind: 'goods' });
            L.tracks.push(G.a, G.b);
            L.switches.push([xg, yM, 0, -1], [G.cut, yA, 0, -1]);
            L.near = yB - 19;
        }
    }

    // A straight engine shed over the top roads past the fan, and a long
    // footbridge over the main line and the whole yard, short of the shed
    function planExtras(T, L, rng) {
        const { p } = T, { N, Y } = L;
        L.shedX = L.bridgeX = null;
        if (p.shed && p.depot !== 'shed' && N >= 3) {
            const sp = T.span(Y.yard(N - 1), 0, 0);
            const x0 = sp ? Math.max(L.fanEnd + 12, geo.lerp(sp[0], sp[1], rng.range(0.6, 0.72))) : null;
            if (x0 !== null && x0 < sp[1] - 18) L.shedX = x0;
        }
        if (p.bridge) {
            const sp = T.span(Y.lead, 0, 0), lo = L.xs + 25, hi = Math.min(L.shedX === null ? Infinity : L.shedX - 16, sp ? sp[1] - 30 : -Infinity);
            if (hi > lo) L.bridgeX = geo.lerp(lo, hi, rng.range(0.3, 0.8));
        }
    }

    // A steam engine and its tender, or a diesel of some kind
    function loco(rng, p, lv, kinds = [[1, 'diesel'], [1, 'shunter']]) {
        if (rng.chance(p.steam)) return [['steam', lv], ['tender', lv]];
        return [[rng.weighted(kinds), lv]];
    }

    function drawDepot(T, L, seed) {
        const { p } = T, D = L.depot, { claims, steam } = L, rng = new PG.RNG(hash(seed, 3));
        const engine = (t, s, dir) => {
            const r = train(T, t, s, dir, loco(rng, p, rng.pick(['dark', 'dark', RED, GOLD])), rng);
            for (const q of r.stacks) steam.push({ ...q, still: true });
        };
        if (D.kind === 'roundhouse') {
            const { Rt, rIn, depth, da, a0, stalls } = D;
            claims.disc(D.x, D.y, Rt + 4);
            for (const t of D.spokes) {
                const [x, y] = t.at(t.len * 0.5), [x1, y1] = t.at(t.len);
                claims.disc(x, y, 3);
                claims.disc(x1, y1, 3);
            }
            for (let i = 0; i < stalls; i++) {
                const a = a0 + (i + 0.5) * da, r = rIn + depth / 2;
                claims.disc(D.x + r * Math.cos(a), D.y + r * Math.sin(a), depth / 2 + 1.5);
            }
            const open = Array.from({ length: stalls }, () => rng.chance(0.55));
            const bridge = turntable(T, D.x, D.y, Rt, rng.chance(0.3) ? Math.PI : rng.pick(D.spokes).a);
            D.spokes.forEach((t, i) => {
                if (t.stall && !open[i]) return;
                if (!rng.chance(t.stall ? 0.8 : 0.7)) return;
                // nosing out of the stall door, or parked out in the open
                engine(t, t.stall ? rIn - Rt - 0.4 - rng.range(1.2, 3.5) : t.len - 1, -1);
            });
            if (rng.chance(0.6)) {
                const bt = new Track([bridge.P(-Rt + 0.4, 0, 0), bridge.P(Rt - 0.4, 0, 0)].map(q => [q[0], q[1]]));
                engine(bt, bt.len - 0.5 - rng.range(0, 1.5), 1);
            }
            if (stalls) D.vents = roundhouse(T, D.x, D.y, rIn, depth, a0, da, stalls, open, rng);
        } else if (D.kind === 'round') {
            claims.disc(D.x, D.y, D.Rh + 1.5);
            D.vents = engineHouse(T, D.x, D.y, D.Rh, Math.PI, rng);
            if (rng.chance(0.7)) engine(D.approach, sAt(D.approach, D.door - rng.range(1.5, 3.5)), -1);
        } else {
            const open = D.roads.map(() => rng.chance(0.6));
            claims.rect(D.door - 2, D.y - 4, D.x + 62, D.far + 1);
            D.vents = engineShed(T, D.x, 60, D.roads, open, rng, true);
            // engines out on the roads in front of the shed, and nosing out of it
            D.roadTracks.forEach((t, i) => {
                const sd = sAt(t, D.x);
                if (open[i] && rng.chance(0.7)) engine(t, sd - rng.range(1.5, 3.5), -1);
                else if (rng.chance(0.4)) engine(t, sd - rng.range(4, 12), 1);
            });
        }
        // coaling tower over the approach, with the water tower and a water crane by it
        const ct = sAt(D.approach, D.door - 14);
        coalingTower(T, onTrack(D.approach, ct, 2, false), rng);
        if (rng.chance(0.75)) engine(D.approach, ct + rng.range(-2, 3), 1);
        {
            const [cx, cy] = D.approach.at(ct);
            claims.rect(cx - 5, cy - 4, cx + 5, cy + 6.5);
            const [x, y] = D.approach.at(sAt(D.approach, D.door - 2.5));
            waterColumn(T, x, y + 2.6, -Math.PI / 2);
            const [wx, wy] = D.approach.at(ct - 15);
            waterTower(T, wx, wy + 8, -Math.PI / 2, rng);
            claims.disc(wx, wy + 8, 4.5);
        }
        // servicing sidings: an engine over the ash pit on one, the coal stage
        // and the breakdown crane on the other
        D.service.forEach((t, i) => {
            if (!visible(T, t, 10)) return;
            if (i === 0) {
                ashPit(T, t, t.len - 30, t.len - 14);
                if (rng.chance(0.8)) engine(t, t.len - rng.range(14, 20), 1);
            } else {
                const [x, y] = t.at(t.len - 24);
                coalStage(T, frame(x - 5, y + 2.4, 0, 0), 10, rng);
                claims.rect(x - 5.5, y + 2, x + 5.5, y + 7.5);
                if (rng.chance(0.7)) train(T, t, t.len - 3.5, 1, [['crane', null]], rng);
                if (rng.chance(0.6)) engine(t, t.len - rng.range(24, 30), 1);
            }
        });
    }

    // A stopping train: an engine and a few coaches, or a railcar or two
    function local(rng, p) {
        const lv = rng.pick([RED, 'dark', GOLD]), paint = lv === 'dark' ? RED : lv;
        if (rng.chance(0.3)) return Array.from({ length: rng.int(1, 2) }, () => ['railcar', paint]);
        const cars = loco(rng, p, lv, [[1, 'diesel']]);
        if (rng.chance(0.4)) cars.push(['van', paint]);
        for (let k = rng.int(2, 4); k > 0; k--) cars.push(['coach', paint]);
        return cars;
    }

    function drawStation(T, L, seed) {
        const { S, p } = T, { claims, steam, yM } = L, rng = new PG.RNG(hash(seed, 7));
        if (L.st) {
            const st = L.st, yL = st.yL, iy0 = yL + 1.65, iy1 = yM - 1.65, sy1 = yL - 1.65, sy0 = sy1 - 5.5;
            const shed = p.station === 'trainshed';
            platform(T, st.x0, st.x1, iy0, iy1, [iy0, iy1]);
            platform(T, st.x0 + 4, st.x1 - 4, sy0, sy1, [sy1]);
            const Lb = geo.clamp(st.x1 - st.x0 - 34, 18, 34), D = 9.5, xb = shed ? (st.x0 + st.x1) / 2 - Lb / 2 : st.x0 + 6;
            stationHouse(T, frame(xb, sy0 - D, 0, 0), Lb, D, rng);
            claims.rect(st.x0 - 4, sy0 - D - 4, st.x1 + 4, iy1);
            let fx = null;
            if (shed) {
                // one roof over the lot, springing from the far side of the near main line
                trainShed(T, st.x0 + 2, st.x1 - 2, sy0 - 0.3, yM + (p.mains > 1 ? 2.25 : 3.2), 7.4);
            } else {
                canopy(T, st.x0 + 5, st.x1 - 21, iy0, iy1, PLAT + 3.6, rng);
                canopy(T, xb + 1.5, xb + Lb * 0.62, sy0 + 0.5, sy1, PLAT + 3.3, rng);
                fx = st.x1 - 8;
                footbridge(T, fx, (sy0 + sy1) / 2, (iy0 + iy1) / 2, PLAT + 6.2, [[(sy0 + sy1) / 2, PLAT, -1], [(iy0 + iy1) / 2, PLAT, -1]]);
            }
            L.stationBridge = fx;
            // lamps along the edges, benches and people waiting
            S.kind = INK;
            for (let x = st.x0 + 6; x < st.x1 - 5; x += 13) {
                crookLamp(T, x, iy0 + 1.3, PLAT);
                if (fx === null || x < fx - 12) crookLamp(T, x + 6, sy1 - 1.2, PLAT);
            }
            for (let x = st.x0 + 9; x < st.x1 - 22; x += rng.range(8, 14)) kit.bench(T, x, (iy0 + iy1) / 2 + 0.9, PLAT, 1);
            const busy = 0.3 + p.people * 0.7;
            for (let i = Math.round(rng.range(4, 10) * busy); i > 0; i--) person(T, rng.range(st.x0 + 5, st.x1 - 12), rng.chance(0.5) ? rng.range(iy0 + 1.2, iy0 + 2.5) : rng.range(iy1 - 2.5, iy1 - 1.2), PLAT, rng);
            for (let i = Math.round(rng.range(2, 6) * busy); i > 0; i--) person(T, rng.range(st.x0 + 8, st.x1 - 8), rng.range(sy0 + 1.8, sy1 - 1.2), PLAT, rng);
            if (rng.chance(0.8)) {
                const r = train(T, st.loop, st.loop.len - rng.range(46, 58), 1, local(rng, p), rng);
                for (const q of r.stacks) steam.push({ ...q, still: true });
            }
        } else if (L.goods) {
            const G = L.goods;
            goodsShed(T, G.shed, 32, G.yA, rng);
            claims.rect(G.shed - 1, G.yA - 16, G.shed + 33, G.yA + 4.5);
            const x0 = G.cut + 36, x1 = G.cut + 100;
            containerStacks(T, x0, x1, G.yB - 15.5, G.yB - 3, rng);
            gantryCrane(T, geo.lerp(x0 + 8, x1 - 20, rng.range(0.1, 0.6)), G.yA + 3.4, G.yB - 16.5, rng);
            claims.rect(G.cut - 2, G.yB - 17.5, x1 + 2, G.yA + 4);
            // wagons in at the goods shed, container flats along under the crane
            S.kind = INK;
            const box = [];
            for (let k = rng.int(2, 4); k > 0; k--) box.push(freight(rng, rng.pick(['box', 'reefer', 'cattle'])));
            train(T, G.a, sAt(G.a, G.shed + 30), 1, box, rng);
            const flats = [];
            for (let k = rng.int(3, 5); k > 0; k--) flats.push(['well', null]);
            if (rng.chance(0.6)) flats.unshift(['shunter', rng.pick([RED, GOLD])]);
            train(T, G.b, G.b.len - 3, 1, flats, rng);
            for (let i = Math.round(rng.range(2, 5) * p.people); i > 0; i--) person(T, rng.range(G.shed, G.shed + 32), G.yA - rng.range(9, 11), 0.9, rng);
        }
    }

    function drawLineside(T, L, seed) {
        const { p } = T, { claims, gap, Y, xs, yM, X0 } = L, rng = new PG.RNG(hash(seed, 8));
        L.switches.forEach(([x, y, h, side], i) => {
            const c = Math.cos(h), s = Math.sin(h);
            if (T.onPage(x, y, 0, 10)) switchStand(T, x - c * 3 + s * side * 2.4, y - s * 3 - c * side * 2.4, i % 3 ? RED : GOLD);
        });
        for (const t of L.tracks) {
            if (!t.stop) continue;
            const [x, y, ux, uy] = t.at(t.len);
            bufferStop(T, x, y, ux, uy);
        }
        const y0M = Y.main(0), xb = xs - rng.range(22, 32);
        signalBox(T, frame(xb, y0M + 4.2, 0, 0), rng);
        claims.rect(xb - 1, y0M + 3.5, xb + 13.5, y0M + 9.5);
        for (const x of [xs - rng.range(4, 10), xs - rng.range(50, 70)]) {
            if (!T.onPage(x, y0M + 3, 4, 10)) continue;
            semaphore(T, axes([x, y0M + 3, 0], [-1, 0, 0], [0, -1, 0], Z), rng.range(7, 8.5), rng);
            claims.disc(x, y0M + 3, 1.5);
        }
        if (L.st) {
            for (const x of [L.st.x0 - 12, L.st.x1 + 14]) if (T.onPage(x, L.st.yL - 3, 4, 10)) semaphore(T, axes([x, L.st.yL - 3, 0], [-1, 0, 0], [0, -1, 0], Z), 6.5, rng);
        }
        const vis = visible(T, L.mains[0], 20), ys = L.mains.map((_, j) => Y.main(j));
        if (vis && p.wires) {
            catenary(T, X0 + vis[0] - 50, X0 + vis[1] + 50, ys, [L.bridgeX, L.stationBridge].filter(x => x !== null && x !== undefined));
        } else if (vis) {
            const gx = L.st ? Math.max(L.st.x1 + 30, X0 + vis[0] + 20) : X0 + geo.lerp(vis[0], vis[1], 0.3);
            if (gx < X0 + vis[1] - 10 && (L.bridgeX === null || Math.abs(gx - L.bridgeX) > 8)) {
                gantry(T, gx, yM - 3, y0M + 3, ys, rng);
                claims.disc(gx, y0M + 3, 1.5);
            }
            telegraph(T, X0 + vis[0] - 40, X0 + vis[1] + 40, y0M + 3.6, rng);
        }
        if (L.bridgeX !== null) {
            const x = L.bridgeX, yn = Y.yard(L.N - 1) + 4.4, z = 7.8;
            // stairs down whichever way there's room, at the south end past the
            // station loop if that's in the way
            const clear = (y, d) => claims.free(x + d * 7.5, y, 1.5) && [1.5, 4, 7, 10, 13].every(t => gap(x + d * t, y) > 2.6 && claims.free(x + d * t, y, 1.2));
            const way = (y, d) => (clear(y, d) ? d : clear(y, -d) ? -d : 0);
            const south = [yM - 4.6, yM - 7].concat(L.st ? [L.st.yL - 4.6, L.st.yL - 7] : []);
            const ys0 = south.find(y => way(y, -1)), ds = ys0 === undefined ? 0 : way(ys0, -1), dn = way(yn, 1);
            if (ds && dn) {
                // trestles wherever there's room between the tracks, not too close together
                const piers = [];
                for (let y = ys0 + 3; y < yn - 3; y += 0.25) {
                    if (gap(x - 1.2, y) > 2.4 && gap(x + 1.2, y) > 2.4 && (!piers.length || y - piers[piers.length - 1] > 7)) piers.push(y + 0.1);
                }
                footbridge(T, x, ys0, yn, z, [[ys0, 0, ds], [yn, 0, dn]], piers);
                for (const [y, d] of [[ys0, ds], [yn, dn]]) claims.rect(x, y - 1.5, x + d * 14, y + 1.5);
            }
        }
    }

    function drawYard(T, L, seed) {
        const { p } = T, { N, steam } = L, rng = new PG.RNG(hash(seed, 4)), until = L.yard.map(() => Infinity);
        if (L.shedX !== null) {
            // wagons stop short of the doors, the odd engine noses out of them
            const x0 = L.shedX, roads = [N - 2, N - 1], open = roads.map(() => rng.chance(0.7));
            engineShed(T, x0, 72, roads.map(i => L.Y.yard(i)), open, rng);
            L.claims.rect(x0 - 1, L.Y.yard(N - 2) - 3.5, x0 + 73, L.Y.yard(N - 1) + 3.5);
            roads.forEach((i, k) => {
                const t = L.yard[i];
                until[i] = sAt(t, x0) - 4;
                if (open[k] && rng.chance(0.8)) {
                    const r = train(T, t, until[i] + 4 - rng.range(1.5, 3.5), -1, loco(rng, p, rng.pick(['dark', RED, GOLD]), [[1, 'diesel']]), rng);
                    for (const q of r.stacks) steam.push({ ...q, still: true });
                }
            });
        }
        for (let i = 0; i < N; i++) fillTrack(T, L.yard[i], rng, steam, L.yard[i] === L.lead ? L.fanEnd - L.X0 + 6 : 0, until[i]);
        // a cut waiting on the lead to be sorted
        if (rng.chance(0.4 + p.cars * 0.5)) {
            const cars = rng.chance(0.6) ? loco(rng, p, rng.pick(['dark', RED, GOLD])) : [];
            for (let k = rng.int(3, 8); k > 0; k--) cars.push(freight(rng));
            const r = train(T, L.lead, L.xs - L.X0 - 6, 1, cars, rng);
            for (const q of r.stacks) steam.push({ ...q, still: true });
        }
        // a train on the main line, under way: an express, a freight, a
        // container train or a couple of railcars
        const mr = new PG.RNG(hash(seed, 5)), t = L.mains[mr.int(0, p.mains - 1)], dir = mr.chance(0.5) ? 1 : -1, vis = visible(T, t);
        if (vis && mr.chance(p.trains)) {
            const s = geo.lerp(vis[0], vis[1], dir > 0 ? mr.range(0.55, 0.8) : mr.range(0.2, 0.45)), lv = mr.pick(['dark', RED, GOLD]), paint = lv === 'dark' ? RED : lv;
            const kind = mr.weighted([[3, 'express'], [3, 'freight'], [1.2, 'railcar'], [1, 'containers']]);
            let cars;
            if (kind === 'railcar') cars = Array.from({ length: mr.int(2, 3) }, () => ['railcar', paint]);
            else {
                cars = mr.chance(p.steam) ? [['steam', lv], ['tender', lv]] : p.wires ? [['electric', lv]] : [['diesel', lv], ['diesel', lv]];
                if (kind === 'express' && mr.chance(0.4)) cars.push(['van', paint]);
                for (let k = mr.int(6, 12); k > 0; k--) cars.push(kind === 'express' ? ['coach', paint] : kind === 'containers' ? ['well', null] : freight(mr));
            }
            const r = train(T, t, s, dir, cars, mr);
            for (const q of r.stacks) steam.push({ ...q, moving: dir });
        }
    }

    function freight(rng, kind) {
        kind = kind || rng.weighted([[4, 'box'], [2, 'reefer'], [3, 'tank'], [2.5, 'hopper'], [2, 'coal'], [2.5, 'gondola'], [2, 'flat'], [2, 'well'], [1.3, 'cattle'], [1, 'autorack']]);
        const lv = {
            box: [[3, RED], [2, 'dark'], [2, null], [1, GOLD]],
            reefer: [[4, GOLD], [2, null], [1, RED]],
            tank: [[3, 'dark'], [2, null], [1, RED], [1, GOLD]],
            hopper: [[3, null], [2, GOLD], [1.5, RED]],
            gondola: [[2, RED], [2, 'dark'], [2, null]],
            cattle: [[3, RED], [2, 'dark'], [1, null]],
            autorack: [[2, null], [2, RED], [1, GOLD], [1, 'dark']],
        }[kind];
        return [kind, lv ? rng.weighted(lv) : null];
    }

    // Cuts of wagons along a yard track, sometimes with an engine on the
    // front or a caboose on the back, with gaps between. Nothing stands on
    // the points before arc length `from`, or past `until`.
    function fillTrack(T, t, rng, steam, from = 0, until = Infinity) {
        const { p } = T, vis = visible(T, t, -20);
        if (!vis) return;
        // from where it straightens out past the points
        const yEnd = t.pts[t.pts.length - 1][1];
        let i0 = 0;
        while (i0 < t.pts.length - 1 && Math.abs(t.pts[i0][1] - yEnd) > 0.05) i0++;
        let s = Math.max(vis[0], t.cum[i0] + 4, from) + rng.range(0, 36);
        const end = Math.min(t.len - 5, vis[1] + 30, until);
        while (s < end) {
            if (!rng.chance(0.15 + p.cars * 0.6)) { s += rng.range(15, 45); continue; }
            const style = rng.weighted([[5, 'mixed'], [1, 'tank'], [1, 'coal'], [1, 'well'], [0.6, 'reefer'], [0.5, 'autorack']]);
            const n = rng.int(2, Math.round(3 + 9 * p.cars));
            const cars = rng.chance(0.3) ? loco(rng, p, rng.pick([RED, GOLD, 'dark']), [[1, 'shunter'], [0.7, 'diesel']]) : [];
            for (let k = 0; k < n; k++) cars.push(freight(rng, style === 'mixed' ? null : style));
            if (rng.chance(0.35)) cars.push(['caboose', rng.chance(0.8) ? RED : GOLD]);
            // head towards +s, so the train trails back to where we started
            const len = cars.reduce((a, [k]) => a + STOCK[k].L + 0.85, 0);
            const r = train(T, t, Math.min(end, s + len), 1, cars, rng);
            for (const q of r.stacks) steam.push({ ...q, still: true });
            s += len + rng.range(10, 50);
        }
    }

    function buildYard(T, seed) {
        const { S, p, cam } = T;
        const rng = new PG.RNG(hash(seed, 1));
        // the ground the page shows, with room below it for tall things
        const tall = 20 * cam.ce * cam.k;
        const cs = [[0, 0], [S.W, 0], [S.W, S.H + tall], [0, S.H + tall]].map(([sx, sy]) => cam.ground(sx, sy, 0));
        const [, yc] = cam.ground(S.W / 2, S.H / 2), N = p.tracks, g = p.spacing;
        const y0 = yc - ((N - 1) * g) / 2 + rng.range(-6, 6);
        const L = {
            X0: Math.min(...cs.map(q => q[0])) - 20, X1: Math.max(...cs.map(q => q[0])) + 20,
            N, g, mid: Math.floor((N - 1) / 2), tracks: [], switches: [], steam: [], claims: new Claims(),
            Y: { yard: i => y0 + i * g, main: j => y0 - 7 - j * 4.5 },
        };
        planYard(T, L, rng);
        planDepot(T, L, rng);
        planStation(T, L, rng);
        planExtras(T, L, rng);
        L.gap = layTracks(T, L.tracks);
        // shadows hatch level across the page, so they don't run with the rails or sleepers
        S.shadowGroup(0, null, Math.atan2(cam.ry, cam.rx));
        drawDepot(T, L, seed);
        drawStation(T, L, seed);
        drawLineside(T, L, seed);
        // the towns either side, beyond the railway
        const tr = new PG.RNG(hash(seed, 9));
        L.claims.lo = L.near;
        L.claims.hi = L.depot.far + 6;
        for (const top of [...town(T, L.near, -1, tr), ...town(T, L.depot.far + 6, 1, tr)]) L.steam.push({ top, smoke: true });
        drawYard(T, L, seed);
        odds(T, L.claims, L.gap, L.depot, new PG.RNG(hash(seed, 10)), L.steam);

        // steam over everything: trailing back off a train under way, rising
        // off the rest, and smoke from the depot roof and the chimneys
        const wr = new PG.RNG(hash(seed, 6)), wind = [wr.range(-0.4, 0.4), wr.range(0.1, 0.45)];
        for (const q of L.steam) {
            if (!wr.chance(p.plumes * 1.25)) continue;
            const [x, y, z] = q.top;
            if (q.moving) {
                const back = q.F.V(-1, 0, 0);
                plume(T, x, y, z, [back[0] * 1.6 + wind[0] * 0.3, back[1] * 1.6 + wind[1] * 0.3], Math.round(8 + 8 * p.plumes), wr, 0.7, 1.1, 0.22);
            } else if (q.smoke) plume(T, x, y, z, wind, Math.round(3 + 5 * p.plumes), wr, 0.9, 1.2, 0.8);
            else plume(T, x, y, z, wind, Math.round(3 + 5 * p.plumes), wr, 0.6, 1.22, 1);
        }
        for (const [x, y, z] of L.depot.vents || []) if (wr.chance(p.plumes * 0.3)) plume(T, x, y, z, wind, Math.round(2 + 3 * p.plumes), wr, 0.6, 1.25, 1);
    }

    PG.register({
        id: 'trainyard',
        name: 'Trainyard',
        category: 'Scenes',
        description: 'An isometric railway yard with a roundhouse, freight trains and steam, shaded for four to eight pens.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 1, max: 5, step: 0.05, value: 1.7, random: [1.4, 2.2],
                hint: 'How big a meter is on paper' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 15, max: 75, step: 0.5, value: 50, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 39.5, random: false,
                hint: '35.3 is true isometric' },
            { id: 'flip', label: 'Mirror', type: 'checkbox', value: false, random: 0.5,
                hint: 'Draw the whole yard the other way round, shadows and all' },
            { type: 'section', label: 'Layout' },
            { id: 'depot', label: 'Engine depot', type: 'select', value: 'roundhouse', random: ['roundhouse', 'roundhouse', 'round', 'shed'],
                options: [['roundhouse', 'Roundhouse'], ['round', 'Round engine house'], ['shed', 'Straight shed']] },
            { id: 'stalls', label: 'Roundhouse stalls', type: 'range', min: 0, max: 18, step: 1, value: 12, random: [7, 16], show: p => p.depot === 'roundhouse' },
            { id: 'station', label: 'Near side', type: 'select', value: 'canopies', random: ['canopies', 'canopies', 'trainshed', 'goods'],
                options: [['canopies', 'Station with canopies'], ['trainshed', 'Station with a train shed'], ['goods', 'Goods yard'], ['none', 'Nothing']] },
            { id: 'town', label: 'Town', type: 'select', value: 'terraces', random: ['terraces', 'terraces', 'mixed', 'industry'],
                options: [['terraces', 'Terraces'], ['mixed', 'Terraces and industry'], ['industry', 'Industry']], hint: 'Works and gasholders take over some of the blocks' },
            { id: 'shed', label: 'Yard shed', type: 'checkbox', value: true, random: 0.5, show: p => p.depot !== 'shed',
                hint: 'A straight shed over the top two yard tracks' },
            { id: 'bridge', label: 'Footbridge', type: 'checkbox', value: true, random: 0.6, hint: 'A long lattice footbridge over the main line and the yard' },
            { id: 'wires', label: 'Overhead wires', type: 'checkbox', value: false, random: 0.35, hint: 'Catenary over the main line, and electric engines to run under it' },
            { type: 'section', label: 'Yard' },
            { id: 'tracks', label: 'Yard tracks', type: 'range', min: 3, max: 16, step: 1, value: 9, random: [6, 12] },
            { id: 'spacing', label: 'Track spacing (m)', type: 'range', min: 4.2, max: 7, step: 0.1, value: 4.8, random: false },
            { id: 'mains', label: 'Main line tracks', type: 'range', min: 1, max: 4, step: 1, value: 2, random: [1, 3] },
            { id: 'ties', label: 'Sleeper spacing (m)', type: 'range', min: 0, max: 3, step: 0.05, value: 1.1, random: false,
                hint: 'Spacing of the sleepers under the rails, 0 for none. They never get closer than about a millimeter on paper' },
            { type: 'section', label: 'Trains' },
            { id: 'cars', label: 'Wagons', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9],
                hint: 'How full the yard tracks are' },
            { id: 'steam', label: 'Steam engines', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.2, 1],
                hint: 'Share of steam engines, the rest are diesels' },
            { id: 'plumes', label: 'Steam & smoke', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 1] },
            { type: 'section', label: 'Details' },
            { id: 'props', label: 'Yard clutter', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1],
                hint: 'Sleepers, rails, drums, huts and coal on the spare ground' },
            { id: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9] },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9] },
            { id: 'trains', label: 'Main line train', type: 'range', min: 0, max: 1, step: 0.01, value: 0.85, random: [0.5, 1],
                hint: 'Chance of a train going by on the main line' },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Roof & paint hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false,
                show: p => p.roofHatch, hint: 'Shaded faces are hatched closer, at 60% of this' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 50, random: [42, 60],
                show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false,
                show: p => p.shadows },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        randomize(rng) {
            return { yaw: rng.pick([42, 46, 50, 50, 54]), elev: rng.pick([36, 39.5, 39.5, 43]) };
        },

        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const k = p.scale;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0);
            const S = new Scene(cam, W, H);
            const cot = 1 / Math.tan(geo.rad(p.sun));
            const sun = [cot * Math.cos(SUN_TURN), -cot * Math.sin(SUN_TURN)];
            if (p.shadows) S.sun = sun;
            const toSun = unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: GOLD } : null,
                waterKind: STEAM,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.6,
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
            };
            // x range where (x, y, z) lands on the page, at least m mm in from the edges
            T.span = (y, z = 0, m = 0) => {
                const o = cam.project(0, y, z), d = cam.project(1, y, z);
                let lo = -Infinity, hi = Infinity;
                for (const [a, b, top] of [[d[0] - o[0], o[0], W], [d[1] - o[1], o[1], H]]) {
                    if (Math.abs(a) < 1e-9) { if (b < m || b > top - m) return null; continue; }
                    const t0 = (m - b) / a, t1 = (top - m - b) / a;
                    lo = Math.max(lo, Math.min(t0, t1));
                    hi = Math.min(hi, Math.max(t0, t1));
                }
                return lo < hi ? [lo, hi] : null;
            };
            T.onPage = (x, y, z, m = 0) => {
                const q = cam.project(x, y, z);
                return q[0] > -m && q[1] > -m && q[0] < W + m && q[1] < H + m;
            };
            T.noise = ctx.noise;
            buildYard(T, ctx.seed | 0);
            if (p.shadows) {
                S.kind = BLUE;
                S.hatchShadows(p.shadowGap);
            }
            const out = PG.pens.renderScene('trainyard', S, p);
            if (p.flip) for (const layer of out.layers) for (const path of layer.paths) for (const v of path) v[0] = W - v[0];
            return out;
        },
    });
})();
