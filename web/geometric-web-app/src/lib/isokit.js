/*
 * Parts for building towns in an isometric scene (see iso.js): walls,
 * windows, doors and roofs, plus vehicles, fences, furniture and people.
 * Further down are the bigger pieces Town and Harbour share: the church,
 * clock tower, terraces, market hall, things for a square, boats and bridges.
 *
 * Builders take a context T with S (the scene), cam, k (mm per m), detail
 * (draw small line work), sees(normal), segs(r) and picket (fence spacing).
 * Footprints are [a0, b0, a1, b1] in a lot frame (iso.frame). Builders don't
 * pick pens: the caller sets S.kind first.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const { geo, TAU } = PG;
    const { BOX, DIRS, frame, newell, card, ring, hull } = PG.iso;
    const inset3 = PG.iso.inset3;

    const FLOOR = 2.9; // storey height (m)

    // One wall of a footprint (0 front, 1 right, 2 back, 3 left). at(s, c) gives
    // the world point, with s running left to right seen from outside.
    function wall(F, side, fp) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        if (side === 0) return { len: a1 - a0, at: (s, c) => P(a0 + s, b0, c), n: F.V(0, -1, 0) };
        if (side === 1) return { len: b1 - b0, at: (s, c) => P(a1, b0 + s, c), n: F.V(1, 0, 0) };
        if (side === 2) return { len: a1 - a0, at: (s, c) => P(a1 - s, b1, c), n: F.V(0, 1, 0) };
        return { len: b1 - b0, at: (s, c) => P(a0, b1 - s, c), n: F.V(-1, 0, 0) };
    }

    function rect(T, at, s, c, w, h) {
        T.S.loop([at(s, c), at(s + w, c), at(s + w, c + h), at(s, c + h)]);
    }

    function pane(T, at, s, c, w, h, style) {
        const S = T.S;
        rect(T, at, s, c, w, h);
        if (!T.detail || Math.min(w, h) * T.k < 1.1) return;
        if (style === 'bars') {
            S.line([at(s, c + h / 3), at(s + w, c + h / 3)]);
            S.line([at(s, c + (2 * h) / 3), at(s + w, c + (2 * h) / 3)]);
        } else if (style === 'split') {
            S.line([at(s + w / 2, c), at(s + w / 2, c + h)]);
        } else if (style === 'sash') {
            S.line([at(s, c + h / 2), at(s + w, c + h / 2)]);
        } else if (style === 'cross') {
            S.line([at(s + w / 2, c), at(s + w / 2, c + h)]);
            S.line([at(s, c + h * 0.55), at(s + w, c + h * 0.55)]);
        } else if (style === 'wide') {
            S.line([at(s + w / 3, c), at(s + w / 3, c + h)]);
            S.line([at(s + (2 * w) / 3, c), at(s + (2 * w) / 3, c + h)]);
        } else if (style === 'frame') {
            // a chunky frame round a sash window
            const f = Math.min(0.1, w * 0.15, h * 0.15);
            S.loop([at(s + f, c + f), at(s + w - f, c + f), at(s + w - f, c + h - f), at(s + f, c + h - f)]);
            S.line([at(s + f, c + h / 2), at(s + w - f, c + h / 2)]);
        }
    }

    function door(T, at, s, base, w = 1, h = 2.1, double = false) {
        rect(T, at, s - w / 2, base, w, h);
        if (!T.detail) return;
        if (double) T.S.line([at(s, base), at(s, base + h)]);
        else if (w * T.k > 1.4) T.S.line([at(s + w * 0.3, base + h * 0.47), at(s + w * 0.3, base + h * 0.53)]);
    }

    function garageDoor(T, at, s, base, w = 2.6, h = 2.2) {
        rect(T, at, s, base, w, h);
        if (!T.detail) return;
        const n = w * T.k > 5 ? 4 : 3;
        for (let i = 1; i < n; i++) T.S.line([at(s, base + (h * i) / n), at(s + w, base + (h * i) / n)]);
    }

    // Windows on every floor of a wall the camera can see, leaving room for doors.
    // o: { base, floors, style, winW, winH, sill, gap, doors: [s centre...], skip: [[s0, s1]...] }
    function windows(T, W, o) {
        if (!T.sees(W.n)) return false;
        const ww = o.winW || 1.1, wh = o.winH || 1.35, sill = o.sill || 0.9, gap = o.gap || 1.1;
        let n = Math.floor((W.len - 0.5 + gap) / (ww + gap));
        if (n < 1 && W.len > ww + 0.5) n = 1;
        const step = W.len / Math.max(1, n);
        const skip = (o.skip || []).concat((o.doors || []).map(d => [d - 0.75, d + 0.75]));
        for (let f = 0; f < o.floors; f++) {
            const c = o.base + f * FLOOR + sill;
            for (let i = 0; i < n; i++) {
                const s = (i + 0.5) * step - ww / 2;
                if (f === 0 && skip.some(([k0, k1]) => s < k1 + 0.15 && s + ww > k0 - 0.15)) continue;
                pane(T, W.at, s, c, ww, wh, o.style);
            }
        }
        return true;
    }

    // Line inside the two rakes of a gable end, so the roof reads as having some thickness
    function fascia(T, G, hw, rise, zb) {
        const L = Math.hypot(hw, rise), t = 0.2;
        const dx = t * L / rise, dz = t * L / hw;
        if (hw - dx < 0.3) return;
        T.S.line([G(-hw + dx, zb), G(0, zb + rise - dz), G(hw - dx, zb)]);
    }

    // Gable roof over a footprint, ridge along u or v, sitting a little below the
    // wall tops with overhanging eaves. Returns its height function.
    function gableRoof(T, F, fp, zTop, alongU, pitch, rng, o = {}) {
        const S = T.S, [a0, b0, a1, b1] = fp;
        // Below ~32° pitch, dropping the eave 0.25 m put the slope under the wall top at
        // the wall line, and the wall's top edges poked through the roof
        const oh = 0.4, tp = Math.tan(pitch), zb = zTop - Math.min(0.25, oh * tp - 0.03);
        const P = F.P;
        const res = { zb, alongU, tp, oh, fp };
        if (alongU) {
            const hw = (b1 - b0) / 2 + oh, rise = hw * tp, bm = (b0 + b1) / 2;
            S.prism([P(a0 - oh, b0 - oh, zb), P(a0 - oh, b1 + oh, zb), P(a0 - oh, bm, zb + rise)], F.V(a1 - a0 + 2 * oh, 0, 0));
            for (const [a, n] of [[a0 - oh, -1], [a1 + oh, 1]]) {
                if (!T.sees(F.V(n, 0, 0))) continue;
                const G = (s, c) => P(a, bm - n * s, c);
                fascia(T, G, hw, rise, zb);
                if (o.attic !== false && rise > 1.7) gableWindow(T, G, rise, zb, rng);
            }
            Object.assign(res, { hw, rise, mid: bm, h: (a, b) => zb + rise - Math.abs(b - bm) * tp });
        } else {
            const hw = (a1 - a0) / 2 + oh, rise = hw * tp, am = (a0 + a1) / 2;
            S.prism([P(a0 - oh, b0 - oh, zb), P(a1 + oh, b0 - oh, zb), P(am, b0 - oh, zb + rise)], F.V(0, b1 - b0 + 2 * oh, 0));
            for (const [b, n] of [[b0 - oh, -1], [b1 + oh, 1]]) {
                if (!T.sees(F.V(0, n, 0))) continue;
                const G = (s, c) => P(am - n * s, b, c);
                fascia(T, G, hw, rise, zb);
                if (o.attic !== false && rise > 1.7) gableWindow(T, G, rise, zb, rng);
            }
            Object.assign(res, { hw, rise, mid: am, h: (a, b) => zb + rise - Math.abs(a - am) * tp });
        }
        res.ridge = zb + res.rise;
        return res;
    }

    function gableWindow(T, G, rise, zb, rng) {
        const kind = rng.int(0, 2);
        const c = zb + rise * 0.28;
        if (kind === 0) {
            const s = Math.min(0.9, rise * 0.3);
            pane(T, G, -s / 2, c, s, s, 'cross');
        } else if (kind === 1) {
            const r = Math.min(0.42, rise * 0.14);
            T.S.loop(ring(T.segs(r), (x, y) => G(x * r, c + r + y * r)));
        } else {
            const w = Math.min(0.7, rise * 0.22), h = w * 1.3;
            pane(T, G, -w - 0.2, c, w, h, 'split');
            pane(T, G, 0.2, c, w, h, 'split');
        }
    }

    // A point on one slope of a gable roof: s along the eave, t up the slope.
    // side -1 is the slope at the low end of the cross axis, +1 the other.
    function gableSlope(F, R, side) {
        const [a0, b0, a1, b1] = R.fp, oh = R.oh;
        const cs = 1 / Math.hypot(1, R.tp), sn = R.tp * cs;
        const P = F.P;
        const len = (R.alongU ? a1 - a0 : b1 - b0) + 2 * oh, up = R.hw / cs;
        let at, n;
        if (R.alongU) {
            if (side < 0) { at = (s, t) => P(a0 - oh + s, b0 - oh + t * cs, R.zb + t * sn); n = F.V(0, -sn, cs); }
            else { at = (s, t) => P(a1 + oh - s, b1 + oh - t * cs, R.zb + t * sn); n = F.V(0, sn, cs); }
        } else if (side < 0) {
            at = (s, t) => P(a0 - oh + t * cs, b1 + oh - s, R.zb + t * sn); n = F.V(-sn, 0, cs);
        } else {
            at = (s, t) => P(a1 + oh - t * cs, b0 - oh + s, R.zb + t * sn); n = F.V(sn, 0, cs);
        }
        return { at, n, len, up };
    }

    // Skylights, solar panels or a dormer on the slopes the camera can see
    function roofExtras(T, F, R, rng, allowDormer) {
        for (const side of [-1, 1]) {
            const sl = gableSlope(F, R, side);
            if (!T.sees(sl.n) || sl.up < 2.2) continue;
            const roll = rng.random();
            if (roll < 0.22 && sl.len > 4) {
                const w = Math.min(sl.len - 1.6, rng.range(2.6, 4.2)), h = Math.min(sl.up - 1.1, 2.1);
                const s0 = rng.range(0.8, sl.len - 0.8 - w), t0 = 0.6;
                T.S.loop([sl.at(s0, t0), sl.at(s0 + w, t0), sl.at(s0 + w, t0 + h), sl.at(s0, t0 + h)]);
                if (T.detail) {
                    const cols = Math.max(2, Math.round(w / 1.05));
                    for (let i = 1; i < cols; i++) T.S.line([sl.at(s0 + (w * i) / cols, t0), sl.at(s0 + (w * i) / cols, t0 + h)]);
                    T.S.line([sl.at(s0, t0 + h / 2), sl.at(s0 + w, t0 + h / 2)]);
                }
            } else if (roll < 0.45) {
                const n = sl.len > 7 && rng.chance(0.5) ? 2 : 1;
                for (let i = 0; i < n; i++) {
                    const s0 = ((i + 0.5) * sl.len) / n - 0.5 + rng.range(-0.6, 0.6);
                    const t0 = rng.range(0.7, Math.max(0.8, sl.up - 2.2));
                    T.S.loop([sl.at(s0, t0), sl.at(s0 + 1, t0), sl.at(s0 + 1, t0 + 1.2), sl.at(s0, t0 + 1.2)]);
                }
            } else if (roll < 0.62 && allowDormer && R.alongU) {
                dormer(T, F, R, side, rng);
            }
        }
    }

    // Shed dormer poking out of a gable slope (ridge along u only)
    function dormer(T, F, R, side, rng) {
        const [a0, b0, a1, b1] = R.fp, oh = R.oh, tp = R.tp;
        const hd = 1.25, wd = Math.min(2.2, (a1 - a0) * 0.35);
        const df = 1.0;                    // distance in from the eave
        if (df + hd / tp > R.hw - 0.3) return;
        const bE = side < 0 ? b0 - oh : b1 + oh;
        const bAt = d => bE - side * d;
        const zs = d => R.zb + d * tp;
        const ad = rng.range(a0 + 0.5, a1 - 0.5 - wd);
        const P = F.P, db = df + hd / tp, zt = zs(df) + hd;
        const v = [P(ad, bAt(df), zs(df)), P(ad + wd, bAt(df), zs(df)), P(ad + wd, bAt(df), zt), P(ad, bAt(df), zt),
            P(ad, bAt(db), zt), P(ad + wd, bAt(db), zt)];
        T.S.solid(v, [[0, 1, 2, 3], [3, 2, 5, 4], [0, 3, 4], [1, 5, 2], [0, 4, 5, 1]]);
        const at = side < 0 ? (s, c) => P(ad + s, bAt(df), c) : (s, c) => P(ad + wd - s, bAt(df), c);
        pane(T, at, 0.3, zs(df) + 0.25, wd - 0.6, hd - 0.5, 'split');
    }

    // Starts down at the eaves, so only the part above the roof shows
    function chimney(T, F, a, b, zFrom, zTo) {
        T.S.box(F, a - 0.35, b - 0.35, zFrom, a + 0.35, b + 0.35, zTo);
        T.S.box(F, a - 0.45, b - 0.45, zTo, a + 0.45, b + 0.45, zTo + 0.18);
    }

    function roofUnit(T, F, a, b, z, s = 1) {
        const r = 0.45 * s, leg = 0.35 * s, h = 0.45 * s;
        T.S.box(F, a - r, b - r, z + leg, a + r, b + r, z + leg + h);
        for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = a + da * (r - 0.08), y = b + db * (r - 0.08);
            T.S.line([F.P(x, y, z), F.P(x, y, z + leg)]);
        }
    }

    function flatRoof(T, F, fp, zTop, o = 0.25, t = 0.35) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        T.S.box(F, a0 - o, b0 - o, zTop, a1 + o, b1 + o, zTop + t);
        const d = 0.3, z = zTop + t;
        if (Math.min(a1 - a0, b1 - b0) > 3) {
            T.S.loop([P(a0 - o + d, b0 - o + d, z), P(a1 + o - d, b0 - o + d, z), P(a1 + o - d, b1 + o - d, z), P(a0 - o + d, b1 + o - d, z)]);
        }
        return z;
    }

    function plinth(T, F, fp, h, o = 0.25) {
        const [a0, b0, a1, b1] = fp;
        T.S.box(F, a0 - o, b0 - o, 0, a1 + o, b1 + o, h);
    }

    function steps(T, F, s, b, w, n, rise = 0.17, run = 0.3) {
        for (let i = 0; i < n; i++) T.S.box(F, s - w / 2, b - run * (n - i), rise * i, s + w / 2, b, rise * (i + 1));
    }

    function porch(T, F, s0, s1, b, depth, h) {
        const S = T.S;
        S.box(F, s0, b - depth, 0, s1, b, 0.3);
        for (const s of [s0 + 0.1, s1 - 0.25]) S.box(F, s, b - depth + 0.1, 0.3, s + 0.15, b - depth + 0.25, h);
        S.box(F, s0 - 0.15, b - depth - 0.15, h, s1 + 0.15, b, h + 0.22);
    }

    function downpipe(T, W, s, base, top) {
        const S = T.S;
        S.line([W.at(s, base), W.at(s, top - 0.35)]);
        S.line([W.at(s, top - 0.35), W.at(s - 0.25, top - 0.1)]);
    }

    function hipRoof(T, F, fp, zTop, pitch) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        const oh = 0.4, zb = zTop - Math.min(0.25, oh * Math.tan(pitch) - 0.03); // see gableRoof
        const A0 = a0 - oh, A1 = a1 + oh, B0 = b0 - oh, B1 = b1 + oh;
        const hw = Math.min(A1 - A0, B1 - B0) / 2, rise = hw * Math.tan(pitch);
        const v = [P(A0, B0, zb), P(A1, B0, zb), P(A1, B1, zb), P(A0, B1, zb)];
        let f;
        if (A1 - A0 > B1 - B0 + 0.05) {
            const bm = (B0 + B1) / 2;
            v.push(P(A0 + hw, bm, zb + rise), P(A1 - hw, bm, zb + rise));
            f = [[0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5]];
        } else if (B1 - B0 > A1 - A0 + 0.05) {
            const am = (A0 + A1) / 2;
            v.push(P(am, B0 + hw, zb + rise), P(am, B1 - hw, zb + rise));
            f = [[0, 3, 2, 1], [3, 0, 4, 5], [1, 2, 5, 4], [0, 1, 4], [2, 3, 5]];
        } else {
            v.push(P((A0 + A1) / 2, (B0 + B1) / 2, zb + rise));
            f = [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
        }
        T.S.solid(v, f);
        return { zb, rise, ridge: zb + rise, fp };
    }

    // Hexahedron with a box's topology: bottom a0..a1, top t0..t1
    function cabin(T, F, a0, a1, t0, t1, hw, c0, c1) {
        const P = F.P;
        const v = [P(a0, -hw, c0), P(a1, -hw, c0), P(a1, hw, c0), P(a0, hw, c0),
            P(t0, -hw, c1), P(t1, -hw, c1), P(t1, hw, c1), P(t0, hw, c1)];
        T.S.solid(v, BOX);
        if (!T.detail) return;
        // windows inset into the sides, windscreen and back window
        const faces = [[0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
        const mid = [(a0 + a1 + t0 + t1) / 4, 0, (c0 + c1) / 2];
        const centre = P(...mid);
        faces.forEach((f, i) => {
            const pts = f.map(j => v[j]);
            const n = newell(pts);
            let cx = 0, cy = 0, cz = 0;
            for (const p of pts) { cx += p[0] / 4; cy += p[1] / 4; cz += p[2] / 4; }
            const s = n[0] * (cx - centre[0]) + n[1] * (cy - centre[1]) + n[2] * (cz - centre[2]) < 0 ? -1 : 1;
            if (!T.cam.facing(s * n[0], s * n[1], s * n[2])) return;
            const ins = inset3(pts, Math.min(0.12, (c1 - c0) * 0.22));
            if (ins.length < 3) return;
            T.S.loop(ins);
            if (i < 2 && Math.abs(a1 - a0) > 1.8) {
                // pillar between the front and back side windows
                const e = geo.lerp(a0, a1, 0.52), et = geo.lerp(t0, t1, 0.52);
                const b = i === 0 ? -hw : hw;
                T.S.line([P(e, b, c0 + 0.1), P(et, b, c1 - 0.1)]);
            }
        });
    }

    function wheels(T, F, xs, hw, r) {
        const S = T.S, n = T.segs(r);
        for (const a of xs) {
            for (const side of [-1, 1]) {
                const b = side * (hw + 0.04);
                const pts = ring(n, (c, s) => F.P(a + r * c, b, r + r * s));
                S.face(pts);
                S.loop(pts);
                if (T.detail && r * T.k > 0.6) S.loop(ring(Math.max(6, n >> 1), (c, s) => F.P(a + r * 0.45 * c, b, r + r * 0.45 * s)));
            }
        }
    }

    // `street` lets in the box truck, which is too long for a driveway. `type`
    // picks one: sedan, suv, pickup, van or truck.
    function car(T, x, y, z, dir, rng, street = false, type = null) {
        const S = T.S, F = frame(x, y, z, dir);
        type = type || rng.weighted([[4, 'sedan'], [4, 'suv'], [2, 'pickup'], [1, 'van'], [street ? 0.6 : 0, 'truck']]);
        if (type === 'sedan') {
            const L = 4.2, hw = 0.9, r = 0.39;
            S.box(F, -L / 2, -hw, r * 0.75, L / 2, hw, 1.02);
            cabin(T, F, -1.45, 0.85, -1.1, 0.3, hw - 0.06, 1.02, 1.65);
            wheels(T, F, [-L / 2 + 0.8, L / 2 - 0.85], hw, r);
        } else if (type === 'suv') {
            const L = 4.5, hw = 0.95, r = 0.44;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.12);
            cabin(T, F, -2.15, 1.05, -2.1, 0.5, hw - 0.05, 1.12, 1.98);
            wheels(T, F, [-L / 2 + 0.8, L / 2 - 0.85], hw, r);
        } else if (type === 'pickup') {
            const L = 5, hw = 0.95, r = 0.44;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.15);
            cabin(T, F, -0.6, 1.0, -0.5, 0.55, hw - 0.05, 1.15, 1.9);
            S.box(F, -L / 2 + 0.05, -hw + 0.02, 1.15, -0.75, hw - 0.02, 1.55);
            if (T.detail) S.loop([F.P(-L / 2 + 0.2, -hw + 0.15, 1.55), F.P(-0.9, -hw + 0.15, 1.55), F.P(-0.9, hw - 0.15, 1.55), F.P(-L / 2 + 0.2, hw - 0.15, 1.55)]);
            wheels(T, F, [-L / 2 + 0.95, L / 2 - 0.95], hw, r);
        } else if (type === 'van') {
            const L = 5, hw = 0.98, r = 0.42;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.2);
            cabin(T, F, -L / 2, L / 2 - 0.35, -L / 2, L / 2 - 1.1, hw, 1.2, 2.1);
            wheels(T, F, [-L / 2 + 0.9, L / 2 - 0.9], hw, r);
        } else {
            // box truck
            const L = 6.4, hw = 1.1, r = 0.45;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2 - 1.9, hw, 3.2);
            S.box(F, L / 2 - 1.85, -hw + 0.05, r * 0.8, L / 2, hw - 0.05, 1.35);
            cabin(T, F, L / 2 - 1.85, L / 2 - 0.1, L / 2 - 1.85, L / 2 - 0.7, hw - 0.05, 1.35, 2.45);
            wheels(T, F, [-L / 2 + 1.1, L / 2 - 1.0], hw, r);
        }
    }

    // Picket fence between two world points on the same level
    function fence(T, p0, p1, h = 1, rails = false) {
        const S = T.S;
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 0.4) return;
        const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
        const at = (s, c) => [p0[0] + ux * s, p0[1] + uy * s, p0[2] + c];
        S.face([at(0, 0), at(L, 0), at(L, h * 0.8), at(0, h * 0.8)]);
        S.line([at(0, h * 0.7), at(L, h * 0.7)]);
        if (rails) S.line([at(0, h), at(L, h)]);
        const n = Math.max(1, Math.round(L / T.picket));
        for (let i = 0; i <= n; i++) S.line([at((L * i) / n, 0), at((L * i) / n, h)]);
    }

    // Balcony railing along a polyline, bars on a coarser spacing than pickets
    function railing(T, pts, h = 1) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const at = (s, c) => [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L, a[2] + c];
            T.S.face([at(0, 0), at(L, 0), at(L, h * 0.9), at(0, h * 0.9)]);
            T.S.line([at(0, h), at(L, h)]);
            const n = Math.max(1, Math.round(L / Math.max(0.35, T.picket * 1.2)));
            for (let j = 0; j <= n; j++) T.S.line([at((L * j) / n, 0), at((L * j) / n, h)]);
        }
    }

    function patioSet(T, F, a, b, rng) {
        const S = T.S;
        const [x, y, z] = F.P(a, b, 0);
        const tr = 0.55;
        const top = ring(T.segs(tr), (c, s) => [x + tr * c, y + tr * s, z + 0.75]);
        S.face(top);
        S.loop(top);
        S.line([[x, y, z], [x, y, z + 0.75]]);
        if (rng.chance(0.7)) {
            S.frustum(x, y, z + 2.05, z + 2.55, 1.35, 0, 8, rng.range(0, TAU), false);
            S.line([[x, y, z + 0.75], [x, y, z + 2.05]]);
        }
        const n = rng.int(2, 3), a0 = rng.range(0, TAU);
        for (let i = 0; i < n; i++) {
            const t = a0 + (TAU * i) / n, cx = Math.cos(t), cy = Math.sin(t);
            chair(T, x + cx, y + cy, z, nearestDir(-cx, -cy));
        }
    }

    // Which of the four frame directions is closest to (dx, dy)
    function nearestDir(dx, dy) {
        let best = 0;
        for (let i = 1; i < 4; i++) {
            if (DIRS[i][0] * dx + DIRS[i][1] * dy > DIRS[best][0] * dx + DIRS[best][1] * dy) best = i;
        }
        return best;
    }

    // Seat faces u, backrest behind it
    function chair(T, x, y, z, dir) {
        const F = frame(x, y, z, dir);
        T.S.box(F, -0.22, -0.22, 0.4, 0.22, 0.22, 0.46);
        T.S.box(F, -0.22, -0.22, 0.46, -0.16, 0.22, 0.9);
        for (const [a, b] of [[0.18, -0.18], [0.18, 0.18], [-0.18, 0.18], [-0.18, -0.18]]) T.S.line([F.P(a, b, 0), F.P(a, b, 0.4)]);
    }

    function bench(T, x, y, z, dir) {
        const F = frame(x, y, z, dir), S = T.S;
        S.box(F, -0.8, -0.22, 0.42, 0.8, 0.22, 0.48);
        S.box(F, -0.8, 0.16, 0.55, 0.8, 0.22, 0.9);
        for (const s of [-0.65, 0.65]) {
            S.line([F.P(s, -0.18, 0), F.P(s, -0.18, 0.42)]);
            S.line([F.P(s, 0.18, 0), F.P(s, 0.18, 0.42)]);
        }
    }

    function clothesline(T, F, a, b, L, rng) {
        const S = T.S;
        for (const s of [a, a + L]) {
            S.line([F.P(s, b, 0), F.P(s, b, 1.9)]);
            S.line([F.P(s, b - 0.35, 1.9), F.P(s, b + 0.35, 1.9)]);
        }
        for (const o of [-0.3, 0.3]) S.line([F.P(a, b + o, 1.9), F.P(a + L, b + o, 1.85)]);
        let s = a + 0.3;
        while (s < a + L - 0.8) {
            const w = rng.range(0.4, 0.7), h = rng.range(0.5, 0.8);
            const pts = [F.P(s, b - 0.3, 1.88), F.P(s + w, b - 0.3, 1.88), F.P(s + w, b - 0.3, 1.88 - h), F.P(s, b - 0.3, 1.88 - h)];
            S.face(pts);
            S.loop(pts);
            s += w + 0.25;
        }
    }

    function person(T, x, y, z, rng) {
        const S = T.S, ce = T.cam.ce;
        const P = card(T, x, y, z, 0);
        const h = rng.range(1.6, 1.85), hr = 0.13;
        const body = [P(-0.2, 0.85), P(0.2, 0.85), P(0.23, h - 0.38), P(0.14, h - 0.28), P(-0.14, h - 0.28), P(-0.23, h - 0.38)];
        S.face(body);
        S.loop(body);
        const head = ring(T.segs(hr), (c, s) => P(hr * c, h - hr / ce + (hr * s) / ce));
        S.face(head);
        S.loop(head);
        const step = rng.range(-0.12, 0.12);
        S.line([P(-0.09, 0.85), P(-0.09 + step, 0)]);
        S.line([P(0.09, 0.85), P(0.09 - step, 0)]);
    }

    // Bicycle drawn in its own upright plane along `dir`, with a rider if asked
    function bike(T, x, y, z, dir, rng, rider) {
        const S = T.S, F = frame(x, y, z, dir);
        const P = (a, c) => F.P(a, 0, c);
        const r = 0.34, n = Math.max(8, T.segs(r));
        for (const a of [-0.52, 0.52]) S.loop(ring(n, (c, s) => P(a + r * c, r + r * s)));
        const rear = P(-0.52, r), front = P(0.52, r), bb = P(-0.05, 0.3);
        const seat = P(-0.18, 0.86), head = P(0.36, 0.84), bar = P(0.33, 1.0);
        S.line([rear, bb, seat, rear]);
        S.line([seat, head, bb]);
        S.line([front, head, bar]);
        if (!rider) return;
        const hr = 0.12, ce = T.cam.ce;
        const shoulder = P(0.08, 1.45);
        S.line([P(-0.15, 0.92), shoulder, bar]);
        const k = rng.range(-0.12, 0.12);
        S.line([P(-0.12, 0.92), P(0.05 + k, 0.62), P(-0.05 + k, 0.2)]);
        const [hx, hy, hz] = P(0.13, 1.45 + hr / ce + 0.04);
        const C = card(T, hx, hy, 0, 0);
        const headPts = ring(T.segs(hr), (c, s) => C(hr * c, hz + (hr * s) / ce));
        S.face(headPts);
        S.loop(headPts);
    }

    // Keeps props from landing on each other within a lot
    class Occupancy {
        constructor(w, d) { this.w = w; this.d = d; this.rects = []; }
        add(a0, b0, a1, b1) { this.rects.push([a0, b0, a1, b1]); }
        free(a0, b0, a1, b1, pad = 0.3) {
            if (a0 < 0.3 || b0 < 0.3 || a1 > this.w - 0.3 || b1 > this.d - 0.3) return false;
            return !this.rects.some(r => a0 < r[2] + pad && a1 > r[0] - pad && b0 < r[3] + pad && b1 > r[1] - pad);
        }
        // random spot for a w × d footprint inside [a0, a1] × [b0, b1]
        place(rng, w, d, a0 = 0, b0 = 0, a1 = this.w, b1 = this.d, tries = 14) {
            if (a1 - w < a0 || b1 - d < b0) return null;
            for (let i = 0; i < tries; i++) {
                const a = rng.range(a0, a1 - w), b = rng.range(b0, b1 - d);
                if (this.free(a, b, a + w, b + d)) {
                    this.add(a, b, a + w, b + d);
                    return [a, b];
                }
            }
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Shading. A scene that hatches its roofs (Harbour) sets T.tones to the
    // line kinds for lit faces, shaded faces and canopies, with T.hLit and
    // T.hDark (spacing in mm) and T.lit(n). Without T.tones nothing is hatched.
    // T.waterKind is the kind for water (fountain jets, wakes).
    // ------------------------------------------------------------------

    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const unit = v => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
    };

    // Outward normal of a flat face (world points) on a solid around `centre`
    function outward(pts, centre) {
        const n = newell(pts);
        let cx = 0, cy = 0, cz = 0;
        for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; cz += p[2] / pts.length; }
        const s = n[0] * (cx - centre[0]) + n[1] * (cy - centre[1]) + n[2] * (cz - centre[2]) < 0 ? -1 : 1;
        return [n[0] * s, n[1] * s, n[2] * s];
    }

    // Draw in another kind for a moment, when there is one
    function inKind(S, kind, fn) {
        const keep = S.kind;
        if (kind !== undefined && kind !== null) S.kind = kind;
        const out = fn();
        S.kind = keep;
        return out;
    }

    // A builder that always draws in `kind`, so a scene can give people or boats a pen of their own
    const withKind = (kind, fn) => (T, ...args) => inKind(T.S, kind, () => fn(T, ...args));

    // Hatch a roof face down its fall line (flat roofs along x), shaded faces
    // closer together. tone 'roof' is lit or shaded by the sun, 'canopy' is the
    // same with the canopy kind on the lit side, and 'lit' always counts as lit.
    // n is the outward normal.
    function shade(T, pts, n, tone = 'roof') {
        const K = T.tones;
        if (!K || !T.sees(n)) return;
        const lit = tone === 'lit' || T.lit(n);
        const flat = Math.hypot(n[0], n[1]) < 1e-6 * Math.abs(n[2]);
        const n2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
        const dir = flat ? [1, 0, 0] : [n[0] * n[2], n[1] * n[2], n[2] * n[2] - n2];
        inKind(T.S, lit ? (tone === 'canopy' ? K.canopy : K.lit) : K.dark, () => T.S.hatch(pts, dir, lit ? T.hLit : T.hDark));
    }

    function shadeGable(T, F, R, tone) {
        for (const side of [-1, 1]) {
            const sl = gableSlope(F, R, side);
            shade(T, [sl.at(0, 0), sl.at(sl.len, 0), sl.at(sl.len, sl.up), sl.at(0, sl.up)], sl.n, tone);
        }
    }

    // Upright lines down the shaded side of a round tower (radius r0 at z0 to
    // r1 at z1), the same idea as the hatching on a roof out of the sun
    function shadeRound(T, x, y, z0, z1, r0, r1) {
        if (!T.tones) return;
        const c = T.cam;
        const at = (r, f, z) => {
            const s = r * f, d = Math.sqrt(r * r - s * s);
            return [x + c.rx * s - c.fx * d, y + c.ry * s - c.fy * d, z];
        };
        for (let f = 0.45; f < 0.97; f += T.hLit / (T.k * r0)) T.S.line([at(r0 + 0.01, f, z0), at(r1 + 0.01, f, z1)]);
    }

    // ------------------------------------------------------------------
    // Town centre buildings, shared by Town and Harbour
    // ------------------------------------------------------------------

    // Striped canvas awning over a shop front, with a scalloped valance. Every
    // other stripe is filled with lines close enough to read as solid, in
    // `stripe` if given.
    function awning(T, F, a0, a1, b, z, depth, stripe) {
        const S = T.S, P = F.P, drop = depth * 0.42, val = 0.3, lo = z - drop - val;
        S.prism([P(a0, b, z), P(a0, b - depth, z - drop), P(a0, b - depth, lo), P(a0, b, lo)], F.V(a1 - a0, 0, 0));
        const n = Math.max(3, Math.round((a1 - a0) / 0.34) | 1), sw = (a1 - a0) / n;
        const fill = T.detail ? Math.max(1, Math.ceil((sw * T.k) / 0.3)) : 1;
        inKind(S, stripe, () => {
            for (let i = 1; i < n; i += 2) {
                for (let j = 0; j <= fill; j++) {
                    const a = a0 + sw * (i + j / fill);
                    S.line([P(a, b, z), P(a, b - depth, z - drop), P(a, b - depth, lo)]);
                }
            }
        });
        if (!T.detail) return;
        const pts = [];
        for (let i = 0; i < n; i++) {
            for (let k = i ? 1 : 0; k <= 6; k++) pts.push(P(a0 + sw * (i + k / 6), b - depth, lo - 0.1 * Math.sin((Math.PI * k) / 6)));
        }
        S.line(pts);
    }

    // Barrel vault over a footprint. The arch spans u (alongV) or v, and the
    // barrel runs along the other axis. arc(y) gives the curve over the vault
    // at position y along the barrel, a hair above the facets.
    function vault(T, F, fp, zb, alongV, rise, oh = 0.3) {
        const [a0, b0, a1, b1] = fp;
        const x0 = (alongV ? a0 : b0) - oh, x1 = (alongV ? a1 : b1) + oh;
        const y0 = (alongV ? b0 : a0) - oh, y1 = (alongV ? b1 : a1) + oh;
        const P = alongV ? (x, y, c) => F.P(x, y, c) : (x, y, c) => F.P(y, x, c);
        const c = x1 - x0, xm = (x0 + x1) / 2, R = (c * c / 4 + rise * rise) / (2 * rise), zc = zb + rise - R;
        const th0 = Math.acos(Math.min(1, c / 2 / R)), sweep = Math.PI - 2 * th0;
        const at = (y, th, lift) => P(xm + (R + lift) * Math.cos(th), y, zc + (R + lift) * Math.sin(th));
        const n = 14, prof = [];
        for (let i = 0; i <= n; i++) prof.push(at(y0, th0 + (sweep * i) / n, 0));
        T.S.prism(prof, alongV ? F.V(0, y1 - y0, 0) : F.V(y1 - y0, 0, 0), true);
        return {
            y0, y1, ridge: zb + rise,
            arc: (y, m = 24) => {
                const pts = [];
                for (let i = 0; i <= m; i++) pts.push(at(y, th0 + (sweep * i) / m, 0.03));
                return pts;
            },
        };
    }

    // Lines over a vault, a few like seams or close enough to read as hatching.
    // In the lit tone by default, so a scene without tones gets none.
    function ribs(T, V, gap, kind = T.tones ? T.tones.lit : null) {
        if (kind === null || kind === undefined) return;
        const n = Math.max(1, Math.round((V.y1 - V.y0) / gap));
        inKind(T.S, kind, () => {
            for (let i = 0; i < n; i++) T.S.line(V.arc(V.y0 + ((V.y1 - V.y0) * (i + 0.5)) / n));
        });
    }

    // Open market hall: posts, beams and a double barrel roof, stalls underneath
    function marketHall(T, F, fp, rng) {
        const S = T.S;
        const [a0, b0, a1, b1] = fp, L = a1 - a0, h = 3.3;
        const nPost = Math.max(2, Math.round(L / 4) + 1);
        for (const b of [b0, b1 - 0.3]) {
            for (let i = 0; i < nPost; i++) {
                const a = a0 + ((L - 0.3) * i) / (nPost - 1);
                S.box(F, a, b, 0, a + 0.3, b + 0.3, h);
            }
            S.box(F, a0 - 0.1, b - 0.05, h, a1 + 0.1, b + 0.35, h + 0.35);
        }
        const bm = (b0 + b1) / 2, rise = (bm - b0) * 0.42;
        for (const half of [[a0, b0, a1, bm], [a0, bm, a1, b1]]) {
            const V = vault(T, F, half, h + 0.35, false, rise, 0.2);
            if (T.tones) ribs(T, V, T.hLit / T.k);
            else ribs(T, V, 1.6, S.kind);
        }
        // stalls with crates on them
        const n = Math.max(1, Math.floor(L / 3.6));
        for (let i = 0; i < n; i++) {
            const a = a0 + (L * (i + 0.5)) / n - 0.75;
            S.box(F, a, bm - 0.45, 0, a + 1.5, bm + 0.45, 0.8);
            for (let c = 0; c < 2; c++) S.box(F, a + 0.1 + c * 0.7, bm - 0.35, 0.8, a + 0.65 + c * 0.7, bm + 0.2, 1.1);
        }
        return { doors: [L / 2], awning: null };
    }

    // Square clock tower with a pyramid roof, standing on (a, b)
    function clockTower(T, F, a, b, rng) {
        const S = T.S, P = F.P;
        const w = 3.2, r = w / 2, h1 = 4.2, h2 = 8.2, h3 = 11;
        S.box(F, a - r - 0.3, b - r - 0.3, 0, a + r + 0.3, b + r + 0.3, 0.45);
        S.box(F, a - r, b - r, 0.45, a + r, b + r, h3);
        for (const z of [h1, h2]) S.box(F, a - r - 0.12, b - r - 0.12, z, a + r + 0.12, b + r + 0.12, z + 0.25);
        S.box(F, a - r - 0.25, b - r - 0.25, h3, a + r + 0.25, b + r + 0.25, h3 + 0.35);
        // pyramid roof
        const e = r + 0.55, zb = h3 + 0.35, apex = P(a, b, zb + e * 1.1);
        const corners = [P(a - e, b - e, zb), P(a + e, b - e, zb), P(a + e, b + e, zb), P(a - e, b + e, zb)];
        S.solid(corners.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        const centre = P(a, b, zb + e * 0.3);
        for (let i = 0; i < 4; i++) {
            const tri = [corners[i], corners[(i + 1) % 4], apex];
            shade(T, tri, outward(tri, centre));
        }
        // clock faces, door and windows on the sides the camera sees
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, [a - r, b - r, a + r, b + r]);
            if (!T.sees(W.n)) continue;
            const cr = 0.85, cz = (h2 + 0.25 + h3) / 2;
            S.loop(ring(T.segs(cr), (x, y) => W.at(r + cr * x, cz + cr * y)));
            if (T.detail) S.line([W.at(r, cz + cr * 0.7), W.at(r, cz), W.at(r + cr * 0.45, cz - cr * 0.3)]);
            if (side === 0) door(T, W.at, r, 0.45, 1.3, 2.6, true);
            else pane(T, W.at, r - 0.35, h1 + 1.2, 0.7, 1.6, 'frame');
        }
        return { doors: [0], awning: null };
    }

    // Gable wall standing up in front of a roof, from an outline [s, c] that
    // runs from (0, zb) over the top to (L, zb). Built from upright slices that
    // stay quiet, and drawn front and back with a line across at each corner.
    function gableWall(T, F, a0, b0, t, outline) {
        const S = T.S, P = F.P, zb = outline[0][1];
        for (let i = 0; i + 1 < outline.length; i++) {
            const [s0, c0] = outline[i], [s1, c1] = outline[i + 1];
            if (s1 - s0 < 1e-6) continue;
            S.prism([P(a0 + s0, b0, zb), P(a0 + s1, b0, zb), P(a0 + s1, b0, c1), P(a0 + s0, b0, c0)], F.V(0, t, 0), false, true);
        }
        S.line(outline.map(([s, c]) => P(a0 + s, b0, c)));
        S.line(outline.map(([s, c]) => P(a0 + s, b0 + t, c)));
        for (const [s, c] of outline.slice(1, -1)) S.line([P(a0 + s, b0, c), P(a0 + s, b0 + t, c)]);
    }

    // Stepped gable over a roof of this width and rise, each step clear of the slope
    function stepGable(L, zb, rise, n) {
        const sw = L / (2 * n + 1), roof = s => zb + rise * (1 - Math.abs(s - L / 2) / (L / 2)), cap = zb + rise + 0.55;
        const hs = Array.from({ length: n }, (_, k) => roof((k + 1) * sw) + 0.35);
        const out = [[0, zb]];
        hs.forEach((h, k) => out.push([k * sw, h], [(k + 1) * sw, h]));
        out.push([n * sw, cap], [L - n * sw, cap]);
        for (let k = n - 1; k >= 0; k--) out.push([L - (k + 1) * sw, hs[k]], [L - k * sw, hs[k]]);
        out.push([L, zb]);
        return out;
    }

    // Neck gable: rounded shoulders up to an upright neck with a little pediment
    function neckGable(L, zb, rise) {
        const nw = L * 0.3, out = [];
        for (let i = 0; i <= 8; i++) out.push([nw * (i / 8), zb + rise * 0.6 * Math.sin((Math.PI / 2) * (i / 8))]);
        out.push([nw, zb + rise + 0.25], [L / 2, zb + rise + 0.85], [L - nw, zb + rise + 0.25]);
        for (let i = 8; i >= 0; i--) out.push([L - nw * (i / 8), zb + rise * 0.6 * Math.sin((Math.PI / 2) * (i / 8))]);
        return out;
    }

    // Beam sticking out under the peak of a gable with a rope down from it
    function hoist(T, F, a, b, c) {
        T.S.box(F, a - 0.09, b - 1, c - 0.09, a + 0.09, b, c + 0.09);
        if (T.detail) T.S.line([F.P(a, b - 0.85, c - 0.09), F.P(a, b - 0.85, c - 1.6)]);
    }

    // Row of narrow houses sharing their side walls, each with its gable to
    // the street: plain, stepped or a neck gable, some with a hoist beam.
    // o.shops puts a shop front with an awning on some of them.
    function terrace(T, F, fp, rng, o) {
        const S = T.S;
        const [a0, b0, a1, b1] = fp, L = a1 - a0, base = 0.3, t = 0.35;
        const n = Math.max(2, Math.round(L / rng.range(3.8, 4.8)));
        const ws = Array.from({ length: n }, () => rng.range(0.85, 1.15)), sum = ws.reduce((u, v) => u + v, 0);
        plinth(T, F, fp, base, 0.15);
        const doors = [];
        let a = a0;
        for (let i = 0; i < n; i++) {
            const w = (ws[i] * L) / sum, h = [a, b0, a + w, b1];
            const floors = Math.max(1, Math.min(o.floors, rng.int(2, 4))), top = base + floors * FLOOR;
            S.box(F, a, b0, base, a + w, b1, top);
            const style = rng.weighted([[3, 'plain'], [2, 'step'], [1.5, 'neck']]);
            // the roof stops at the side walls, and behind the gable wall when there is one
            const rf = [a + 0.4, style === 'plain' ? b0 : b0 + t + 0.3, a + w - 0.4, b1];
            const R = gableRoof(T, F, rf, top + 0.25, false, geo.rad(rng.range(50, 58)), rng, { attic: style === 'plain' && rng.chance(0.6) });
            shadeGable(T, F, R);
            const front = wall(F, 0, h);
            if (style !== 'plain') {
                gableWall(T, F, a, b0, t, style === 'step' ? stepGable(w, top, R.rise, w > 4.4 ? 3 : 2) : neckGable(w, top, R.rise));
                if (T.sees(front.n)) pane(T, front.at, w / 2 - 0.35, top + R.rise * 0.25, 0.7, 0.9, 'cross');
            }
            if (rng.chance(0.4)) hoist(T, F, a + w / 2, style === 'plain' ? b0 - 0.4 : b0, top + R.rise * (style === 'plain' ? 0.55 : 0.75));
            if (rng.chance(0.3)) chimney(T, F, a + w / 2 + rng.range(-0.3, 0.3), b1 - 1, R.zb, R.ridge + rng.range(0.2, 0.5));
            const d = w * rng.range(0.25, 0.35);
            doors.push(a - a0 + d);
            // a shop takes the ground floor: wide window beside the door, awning over both
            const shop = o.shops && floors > 1 && w > 3.6 && rng.chance(o.shops);
            if (T.sees(front.n)) {
                door(T, front.at, d, base, 0.95, 2.2);
                steps(T, F, a + d, b0, 1.1, 2);
                if (shop) pane(T, front.at, d + 0.75, base + 0.6, w - d - 1.05, 1.7, 'wide');
            }
            windows(T, front, { base: shop ? base + FLOOR : base, floors: shop ? floors - 1 : floors, style: 'frame', winW: 0.85, winH: 1.4, gap: 0.55, doors: shop ? [] : [d] });
            if (shop) awning(T, F, a + 0.15, a + w - 0.15, b0, base + 2.75, 1.1);
            windows(T, wall(F, 2, h), { base, floors, style: 'frame', winW: 0.85, winH: 1.3, gap: 0.8 });
            // only the ends of the row have windows down the side
            if (i === 0) windows(T, wall(F, 3, h), { base, floors, style: 'frame', winW: 0.85, winH: 1.3, gap: 1.2 });
            if (i === n - 1) windows(T, wall(F, 1, h), { base, floors, style: 'frame', winW: 0.85, winH: 1.3, gap: 1.2 });
            a += w;
        }
        return { doors, awning: null };
    }

    // Round-headed window or opening on a wall
    function arch(T, at, s, c, w, h) {
        const r = w / 2, pts = [at(s - r, c + h - r), at(s - r, c), at(s + r, c), at(s + r, c + h - r)];
        for (let i = 1; i < 12; i++) pts.push(at(s + r * Math.cos((Math.PI * i) / 12), c + h - r + r * Math.sin((Math.PI * i) / 12)));
        T.S.loop(pts);
    }

    // Church: a nave with its gable to the street and a tower in front of it
    // under a tall eight-sided spire
    function church(T, F, fp, rng) {
        const S = T.S, P = F.P;
        const [a0, b0, a1, b1] = fp, am = (a0 + a1) / 2, tw = 3.6, base = 0.4;
        const nave = [a0, b0 + tw - 0.6, a1, b1], eaves = base + rng.range(5.5, 6.5);
        plinth(T, F, fp, base, 0.2);
        S.box(F, nave[0], nave[1], base, nave[2], nave[3], eaves);
        shadeGable(T, F, gableRoof(T, F, nave, eaves, false, geo.rad(rng.range(46, 52)), rng, { attic: false }));
        for (const side of [1, 3]) {
            const W = wall(F, side, nave);
            if (!T.sees(W.n)) continue;
            const n = Math.max(2, Math.floor(W.len / 2.4));
            for (let i = 0; i < n; i++) arch(T, W.at, ((i + 0.5) * W.len) / n, base + 1.3, 0.9, 3.2);
        }
        // tower with a belfry and a cornice, then the spire
        const th = base + rng.range(11, 13.5), tf = [am - tw / 2, b0, am + tw / 2, b0 + tw];
        S.box(F, tf[0], tf[1], base, tf[2], tf[3], th);
        S.box(F, tf[0] - 0.18, tf[1] - 0.18, th, tf[2] + 0.18, tf[3] + 0.18, th + 0.35);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, tf);
            if (!T.sees(W.n)) continue;
            arch(T, W.at, tw / 2, th - 3, 1.1, 2.3);
            if (T.detail) for (let c = th - 2.6; c < th - 1.2; c += 0.35) S.line([W.at(tw / 2 - 0.55, c), W.at(tw / 2 + 0.55, c)]);
            if (side === 0) {
                arch(T, W.at, tw / 2, base, 1.4, 2.8);
                S.loop(ring(T.segs(0.5), (x, y) => W.at(tw / 2 + 0.5 * x, base + 4.4 + 0.5 * y)));
            } else {
                arch(T, W.at, tw / 2, base + 5, 0.6, 1.6);
            }
        }
        // world coordinates from here, the spire is a hand-built solid
        const rs = tw / 2 + 0.1, hs = rng.range(8, 10.5), [cx, cy, zs] = P(am, b0 + tw / 2, th + 0.35);
        // turned so its flat sides line up with the tower's
        const rim = Array.from({ length: 8 }, (_, i) => {
            const a = Math.PI / 8 + (TAU * i) / 8;
            return [cx + rs * Math.cos(a), cy + rs * Math.sin(a), zs];
        });
        const apex = [cx, cy, zs + hs];
        S.solid(rim.concat([apex]), [rim.map((_, i) => i), ...rim.map((_, i) => [i, (i + 1) % 8, 8])]);
        const centre = [cx, cy, zs + hs * 0.2];
        for (let i = 0; i < 8; i++) {
            const tri = [rim[i], rim[(i + 1) % 8], apex];
            shade(T, tri, outward(tri, centre));
        }
        // cross on top
        S.line([apex, [cx, cy, apex[2] + 1.3]]);
        const [ux, uy] = [T.cam.rx, T.cam.ry];
        S.line([[cx - ux * 0.4, cy - uy * 0.4, apex[2] + 0.9], [cx + ux * 0.4, cy + uy * 0.4, apex[2] + 0.9]]);
        return { doors: [am - a0], awning: null };
    }

    // Market cart: a counter on two wheels under a small gable canopy
    function cart(T, x, y, z, rng) {
        const S = T.S, F = frame(x, y, z, 3), L = 1.7, D = 0.9, zb = 0.45, zc = zb + 0.8, zt = zc + 1.15;
        S.box(F, -L / 2, -D / 2, zb, L / 2, D / 2, zc);
        const r = 0.36;
        for (const a of [-L / 2 + 0.4, L / 2 - 0.4]) {
            const pts = ring(T.segs(r), (c, s) => F.P(a + r * c, -D / 2 - 0.05, r + r * s));
            S.face(pts);
            S.loop(pts);
        }
        for (const [a, b] of [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]]) S.line([F.P(a, b, zc), F.P(a, b, zt - 0.25)]);
        const R = gableRoof(T, F, [-L / 2, -D / 2, L / 2, D / 2], zt, true, geo.rad(24), rng, { attic: false });
        shadeGable(T, F, R, 'canopy');
        if (T.detail) S.line([F.P(-L / 2, -D / 2, zb + 0.4), F.P(L / 2, -D / 2, zb + 0.4)]);
    }

    // Round café table with a couple of chairs, under an umbrella if asked
    function bistro(T, x, y, z, rng, umbrella) {
        const S = T.S;
        S.frustum(x, y, z + 0.72, z + 0.78, 0.32, 0.32, T.segs(0.32));
        S.line([[x, y, z], [x, y, z + 0.72]]);
        if (umbrella) {
            S.line([[x, y, z + 0.78], [x, y, z + 2]]);
            S.lathe(x, y, [[1, z + 2], [0.9, z + 2.12], [0.08, z + 2.35], [0, z + 2.4]], T.segs(1));
        }
        const t = rng.range(0, TAU);
        for (const s of [-1, 1]) {
            const cx = Math.cos(t) * 0.6 * s, cy = Math.sin(t) * 0.6 * s;
            chair(T, x + cx, y + cy, z, nearestDir(-cx, -cy));
        }
    }

    // Crook lamp post with a lantern hanging from it
    function crookLamp(T, x, y, z) {
        const S = T.S, P = card(T, x, y, z, 0);
        const h = 3.1, w = 0.07, r = 0.32;
        S.face([P(-w, 0), P(w, 0), P(w, h), P(-w, h)]);
        S.line([P(-w, h), P(-w, 0), P(w, 0), P(w, h)]);
        const crook = [];
        for (let i = 0; i <= 10; i++) {
            const t = Math.PI - (Math.PI * i) / 10;
            crook.push(P(r + (r + w) * Math.cos(t), h + (r + w) * Math.sin(t)));
        }
        S.line(crook);
        const lx = 2 * r, lan = [P(lx - 0.13, h - 0.12), P(lx + 0.13, h - 0.12), P(lx + 0.17, h - 0.55), P(lx - 0.17, h - 0.55)];
        S.face(lan);
        S.loop(lan);
        if (T.detail) S.line([P(lx, h - 0.12), P(lx, h - 0.55)]);
        S.line([P(-0.18, 0), P(-0.18, 0.3), P(0.18, 0.3), P(0.18, 0)]);
    }

    // Post and rail fence between two points on the same level
    function railFence(T, p0, p1, h = 1, grid = false) {
        const S = T.S, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 0.6) return;
        const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
        const at = (s, c) => [p0[0] + ux * s, p0[1] + uy * s, p0[2] + c];
        const n = Math.max(1, Math.round(L / (grid ? 0.45 : 1.5)));
        for (let i = 0; i <= n; i++) S.line([at((L * i) / n, 0), at((L * i) / n, h)]);
        const rails = grid ? [0.3, 0.65, 1] : [0.5, 0.9];
        for (const f of rails) S.line([at(0, h * f), at(L, h * f)]);
    }

    // Round-headed tree, drawn as a card facing the camera like the people.
    // With tones, the side away from the sun is hatched like a shaded roof.
    function roundTree(T, x, y, z, rng) {
        const S = T.S, ce = T.cam.ce, h = rng.range(5, 7);
        const R = h * rng.range(0.27, 0.32), cz = h - R / ce;
        const P = card(T, x, y, z, 0.25);
        const lobes = rng.int(7, 10), a0 = rng.range(0, TAU), seg = Math.max(3, Math.round(T.segs(R) / lobes));
        const pts = [];
        for (let l = 0; l < lobes; l++) {
            const bump = R * rng.range(0.06, 0.12);
            for (let i = 0; i < seg; i++) {
                const t = i / seg, a = a0 + ((l + t) * TAU) / lobes, rr = R + bump * Math.sin(Math.PI * t);
                pts.push([rr * Math.cos(a), cz + (rr * Math.sin(a)) / ce]);
            }
        }
        S.face(hull(pts).map(([u, w]) => P(u, w)));
        S.loop(pts.map(([u, w]) => P(u, w)));
        if (T.tones) {
            // canopy less the same circle nudged up and left, in page-round units (v = height * ce)
            const round = pts.map(([u, w]) => [u, (w - cz) * ce]);
            const lit = ring(24, (c, s) => [R * (c - 0.45), R * (s + 0.4)]);
            for (const [a, b] of geo.hatch([round, lit], T.hDark / T.k, 0.9)) {
                const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                if (m[0] * m[0] + m[1] * m[1] > R * R) continue;
                S.line([P(a[0], cz + a[1] / ce), P(b[0], cz + b[1] / ce)]);
            }
        }
        const tw = Math.max(0.1, R * 0.08), B = card(T, x, y, z, 0);
        S.face([B(-tw, 0), B(tw, 0), B(tw, cz), B(-tw, cz)]);
        S.line([B(-tw, cz), B(-tw, 0), B(tw, 0), B(tw, cz)]);
    }

    const TIERS = {
        2: [[0, 0.68, 1], [0.42, 1, 0.66]],
        3: [[0, 0.56, 1], [0.3, 0.8, 0.78], [0.58, 1, 0.55]],
        4: [[0, 0.44, 1], [0.22, 0.64, 0.82], [0.44, 0.84, 0.64], [0.64, 1, 0.46]],
    };

    // Silhouette of a cone seen from above: the apex, the two tangent lines and
    // the near side of the base ellipse
    function coneOutline(r, q, base, apex, n) {
        const phi = Math.asin(Math.min(0.95, q / Math.max(1e-6, apex - base)));
        const pts = [[0, apex]];
        for (let i = 0; i <= n; i++) {
            const t = -phi + ((Math.PI + 2 * phi) * i) / n;
            pts.push([r * Math.cos(t), base - q * Math.sin(t)]);
        }
        return pts;
    }

    // Spruce or fir as stacked cone cut-outs facing the camera, `h` tall
    function conifer(T, x, y, z, h, rng) {
        const S = T.S, te = T.cam.tanE;
        const tiers = h > 6.5 ? rng.pick([3, 3, 4]) : rng.pick([2, 3, 3, 3]);
        const R = h * rng.range(0.23, 0.29);
        const spec = TIERS[tiers];
        const trunk = R * te + 0.3;
        const Hc = h - trunk;
        spec.forEach(([fb, fa, fr], i) => {
            const P = card(T, x, y, z, 0.12 * (i + 1));
            const r = R * fr, q = r * te;
            const pts = coneOutline(r, q, trunk + fb * Hc, trunk + fa * Hc, T.segs(r)).map(([u, w]) => P(u, w));
            S.face(pts);
            S.loop(pts);
        });
        const P = card(T, x, y, z, 0);
        const tw = Math.max(0.12, R * 0.1);
        S.face([P(-tw, 0), P(tw, 0), P(tw, trunk), P(-tw, trunk)]);
        S.line([P(-tw, trunk), P(-tw, 0), P(tw, 0), P(tw, trunk)]);
    }

    // Round basin, a bowl on a stem, and water falling from both. Returns its radius.
    function fountain(T, x, y, z, rng) {
        const S = T.S, R = rng.range(2, 2.7), n = T.segs(R), b = 0.95;
        S.lathe(x, y, [[R + 0.15, z], [R, z + 0.55]], n);
        S.loop(ring(n, (c, s) => [x + (R - 0.25) * c, y + (R - 0.25) * s, z + 0.55]));
        S.frustum(x, y, z + 0.55, z + 1.5, 0.3, 0.2, 12);
        S.lathe(x, y, [[0.2, z + 1.5], [b, z + 1.8], [b, z + 1.9]], T.segs(b));
        S.frustum(x, y, z + 1.9, z + 2.5, 0.12, 0.08, 10);
        S.lathe(x, y, [[0.16, z + 2.5], [0.2, z + 2.62], [0, z + 2.8]], 10);
        const a0 = rng.range(0, TAU);
        inKind(S, T.waterKind, () => {
            for (let k = 0; k < 6; k++) {
                const a = a0 + (TAU * k) / 6, c = Math.cos(a), s = Math.sin(a);
                const arc = (r0, z0, r1, z1, lift) => {
                    const pts = [];
                    for (let i = 0; i <= 8; i++) {
                        const t = i / 8, r = geo.lerp(r0, r1, t);
                        pts.push([x + r * c, y + r * s, z + geo.lerp(z0, z1, t) + lift * 4 * t * (1 - t)]);
                    }
                    S.line(pts);
                };
                arc(0.1, 2.75, b - 0.12, 1.95, 0.35);
                arc(b + 0.05, 1.85, b + 0.8, 0.6, 0.15);
            }
        });
        return R + 0.15;
    }

    // Obelisk on a stepped base. Returns its radius.
    function obelisk(T, x, y, z, rng) {
        const S = T.S, F = frame(x, y, z, 0), h = rng.range(5.5, 7.5);
        S.box(F, -1.6, -1.6, 0, 1.6, 1.6, 0.3);
        S.box(F, -1.2, -1.2, 0.3, 1.2, 1.2, 0.6);
        S.box(F, -0.8, -0.8, 0.6, 0.8, 0.8, 1.9);
        S.box(F, -0.92, -0.92, 1.9, 0.92, 0.92, 2.1);
        S.lathe(x, y, [[0.45 * Math.SQRT2, z + 2.1], [0.3 * Math.SQRT2, z + 2.1 + h], [0, z + 2.7 + h]], 4, false, Math.PI / 4);
        return 1.7;
    }

    // Octagonal bandstand. Returns its radius.
    function bandstand(T, x, y, z, rng) {
        const S = T.S, r = rng.range(2.8, 3.3), h = 2.9, n = 8, rot = Math.PI / 8;
        const at = (i, rr, c) => { const a = rot + (TAU * i) / n; return [x + rr * Math.cos(a), y + rr * Math.sin(a), c]; };
        S.lathe(x, y, [[r + 0.2, z], [r + 0.2, z + 0.7]], n, false, rot);
        for (let i = 0; i < n; i++) {
            const [px, py] = at(i, r, 0);
            S.frustum(px, py, z + 0.7, z + 0.7 + h, 0.09, 0.09, 6);
        }
        S.loop(Array.from({ length: n }, (_, i) => at(i, r, z + 1.6)));
        const zr = z + 0.7 + h, R = r + 0.6, apex = [x, y, zr + R * 0.6];
        const base = Array.from({ length: n }, (_, i) => at(i, R, zr));
        S.solid(base.concat([apex]), [base.map((_, i) => i), ...base.map((_, i) => [i, (i + 1) % n, n])]);
        const centre = [x, y, zr + R * 0.2];
        for (let i = 0; i < n; i++) {
            const tri = [base[i], base[(i + 1) % n], apex];
            shade(T, tri, outward(tri, centre));
        }
        S.frustum(x, y, apex[2] - 0.1, apex[2] + 0.5, 0.06, 0.03, 6);
        return R;
    }

    // ------------------------------------------------------------------
    // Boats and bridges. Boats float at their frame's origin, with the bow
    // at +u.
    // ------------------------------------------------------------------

    // Half breadth along the hull, as a share of the beam, from the stern
    // (t = 0) to the bow (t = 1). Concave, so the outline stays convex.
    const breadth = t => t < 0.62 ? 0.8 + 0.2 * Math.sin((Math.PI / 2) * (t / 0.62))
        : Math.pow(Math.cos((Math.PI / 2) * ((t - 0.62) / 0.38)), 0.75);

    // Hull along u (bow at +u) floating at F's origin: the waterline outline,
    // a deck outline `free` higher that rises by `sheer` towards the bow, and
    // faceted sides between them. An open boat gets a flat deck to draw the
    // inside on. Returns deck height and half breadth along the boat.
    function hullSolid(T, F, L, B, free, sheer, open) {
        const n = 12, deckZ = t => free + sheer * t * t, topZ = open ? () => free : deckZ;
        const outline = (len, beam, zf, shift) => {
            const pts = [];
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                pts.push(F.P(-len / 2 + shift + t * len, -(beam / 2) * breadth(t), zf(t)));
            }
            for (let i = n - 1; i >= 0; i--) {
                const t = i / n;
                pts.push(F.P(-len / 2 + shift + t * len, (beam / 2) * breadth(t), zf(t)));
            }
            return pts;
        };
        const deck = outline(L, B, topZ, 0);
        const water = outline(L * 0.88, B * 0.84, () => 0, -L * 0.03);
        const m = deck.length, v = deck.concat(water), f = [], g = [];
        f.push(water.map((_, i) => m + i));
        g.push(0);
        for (let i = 0; i < m; i++) {
            const j = (i + 1) % m;
            // the transom (from the last port point back round to the first) is flat
            if (i === m - 1) {
                f.push([i, j, m + j, m + i]);
                g.push(0);
            } else {
                f.push([i, j, m + j], [i, m + j, m + i]);
                g.push(1, 1);
            }
        }
        if (open) {
            f.push(deck.map((_, i) => i));
            g.push(0);
        } else {
            let cx = 0, cy = 0, cz = 0;
            for (const p of deck) { cx += p[0] / m; cy += p[1] / m; cz += p[2] / m; }
            v.push([cx, cy, cz + sheer * 0.1]);
            for (let i = 0; i < m; i++) { f.push([2 * m, i, (i + 1) % m]); g.push(2); }
        }
        T.S.solid(v, f, g);
        // Point on side s (-1 or 1) at t from stern to bow, f of the way up from
        // the waterline to the deck edge. Pushed out a little so the facets,
        // which cut inside the curve, don't hide lines drawn on the hull.
        const on = (t, s, f) => {
            const b = breadth(t) * geo.lerp(B * 0.42, B / 2, f) * 1.04 + 0.02;
            return F.P(geo.lerp(-L * 0.47 + t * L * 0.88, -L / 2 + t * L, f), s * b, topZ(t) * f);
        };
        return {
            deck, on, F,
            z: u => topZ(geo.clamp((u + L / 2) / L, 0, 1)),
            half: u => (B / 2) * breadth(geo.clamp((u + L / 2) / L, 0, 1)),
        };
    }

    // Paint for Harbour's boats. T.hulls is a list of [weight, kind] for the
    // stripe under the deck edge (null for none), and the side out of the sun
    // gets hatched down to the water. Scenes without T.hulls keep plain boats.
    function paintHull(T, Hl, L, rng) {
        if (!T.hulls || !T.tones) return;
        const S = T.S, kind = rng.weighted(T.hulls), sun = S.sun, F = Hl.F;
        const along = (s, f) => Array.from({ length: 17 }, (_, i) => Hl.on(0.01 + (0.97 * i) / 16, s, f));
        for (const s of [-1, 1]) {
            if (kind !== null) inKind(S, kind, () => S.line(along(s, 0.74)));
            if (!sun) continue;
            const n = F.V(0, s, 0);
            if (n[0] * sun[0] + n[1] * sun[1] <= 0) continue;
            const dt = T.hDark / (T.k * L);
            inKind(S, T.tones.dark, () => {
                for (let t = 0.02; t < 0.93; t += dt) S.line([Hl.on(t, s, 0), Hl.on(t, s, kind === null ? 0.95 : 0.6)]);
            });
        }
    }

    // Box on deck, from the deck up to height h, with windows round it
    function deckhouse(T, F, Hl, u0, u1, w, h) {
        const S = T.S, P = F.P;
        const z0 = Math.min(Hl.z(u0), Hl.z(u1)) - 0.1, top = z0 + h;
        const fp = [u0, -w, u1, w];
        S.box(F, u0, -w, z0, u1, w, top);
        S.box(F, u0 - 0.15, -w - 0.15, top, u1 + 0.15, w + 0.15, top + 0.12);
        if (T.tones && T.tones.canopy !== undefined && T.sees([0, 0, 1])) {
            const roof = [P(u0 + 0.15, -w + 0.1, top + 0.12), P(u1 - 0.15, -w + 0.1, top + 0.12), P(u1 - 0.15, w - 0.1, top + 0.12), P(u0 + 0.15, w - 0.1, top + 0.12)];
            inKind(S, T.tones.canopy, () => S.hatch(roof, F.V(0, 1, 0), T.hLit * 0.8));
        }
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            const n = Math.max(1, Math.floor(W.len / 1.1));
            for (let i = 0; i < n; i++) {
                const s = ((i + 0.5) * W.len) / n;
                pane(T, W.at, s - 0.35, z0 + h * 0.5, 0.7, h * 0.32, null);
            }
        }
        return top + 0.12;
    }

    function fishingBoat(T, F, rng) {
        const S = T.S, L = rng.range(8, 11), B = rng.range(3, 3.6);
        const Hl = hullSolid(T, F, L, B, 1.1, 0.55, false);
        paintHull(T, Hl, L, rng);
        const u0 = -L * 0.12, u1 = u0 + rng.range(2.2, 2.8);
        const top = deckhouse(T, F, Hl, u0, u1, B * 0.3, 2.1);
        // mast with a cross spar, and a gantry over the stern or outrigger
        // booms raised up either side
        const mu = u1 + 0.8, mz = Hl.z(mu), mt = top + 2.4;
        S.line([F.P(mu, 0, mz), F.P(mu, 0, mt)]);
        S.line([F.P(mu, -0.8, top + 1.9), F.P(mu, 0.8, top + 1.9)]);
        const rig = T.hulls ? rng.weighted([[2, 'gantry'], [1.6, 'outriggers'], [1, 'none']]) : rng.chance(0.6) ? 'gantry' : 'none';
        const su = -L / 2 + 0.6, sz = Hl.z(su);
        if (rig === 'gantry') {
            const hw = Hl.half(su) * 0.8;
            S.line([F.P(su, -hw, sz), F.P(su, -hw * 0.7, sz + 2.3), F.P(su, hw * 0.7, sz + 2.3), F.P(su, hw, sz)]);
        } else if (rig === 'outriggers') {
            for (const s of [-1, 1]) {
                const tip = F.P(mu - 0.4, s * (B / 2 + 2.4), mz + 3.4);
                S.line([F.P(mu, s * 0.25, mz + 0.5), tip, F.P(mu, 0, mt - 0.2)]);
            }
        }
        // fish boxes stacked on the after deck
        if (T.hulls && rng.chance(0.5)) {
            for (const [a, b, c] of [[0, -0.7, 0], [0, 0.05, 0], [0.05, -0.35, 0.45]]) {
                S.box(F, su + 0.3 + a, b, sz - 0.1 + c, su + 1.1 + a, b + 0.65, sz + 0.35 + c);
            }
        }
        return L;
    }

    function launch(T, F, rng) {
        const L = rng.range(6, 7.5), B = rng.range(2.3, 2.7);
        const Hl = hullSolid(T, F, L, B, 0.85, 0.35, false);
        paintHull(T, Hl, L, rng);
        const u0 = -L * 0.05;
        const top = deckhouse(T, F, Hl, u0, u0 + rng.range(1.6, 2.1), B * 0.32, 1.5);
        T.S.line([F.P(u0 + 0.5, 0, top), F.P(u0 + 0.5, 0, top + 1.1)]);
        return L;
    }

    // Gaff-rigged sailboat. Under way it also sets a jib on the forestay.
    function sailboat(T, F, rng, jib = false) {
        const S = T.S, L = rng.range(6.5, 8), B = rng.range(2.3, 2.6);
        const Hl = hullSolid(T, F, L, B, 0.8, 0.3, false);
        paintHull(T, Hl, L, rng);
        const cu = -L * 0.2;
        deckhouse(T, F, Hl, cu, cu + 1.8, B * 0.28, 0.7);
        const mu = L * 0.12, mz = Hl.z(mu);
        const sail = [F.P(mu - 0.1, 0, mz + 0.9), F.P(mu - 0.1, 0, mz + 5.6), F.P(mu - 2.8, 0, mz + 7.1), F.P(mu - 3.5, 0, mz + 1)];
        S.line([F.P(mu, 0, mz), F.P(mu, 0, mz + 6)]);
        S.face(sail);
        S.loop(sail);
        S.line([F.P(mu, 0, mz + 0.9), F.P(mu - 3.8, 0, mz + 0.95)]);
        // tan sails, the old red-brown canvas fishing boats had
        if (T.hulls && T.tones && rng.chance(0.3)) inKind(S, T.tones.lit, () => S.hatch(sail, F.V(1, 0, 0), T.hLit));
        else if (T.detail) {
            for (const f of [0.35, 0.65]) S.line([lerp3(sail[0], sail[1], f), lerp3(sail[3], sail[2], f)]);
        }
        if (jib) {
            const bow = F.P(L / 2 - 0.15, 0, Hl.z(L / 2) + 0.05);
            const head = [F.P(mu + 0.05, 0, mz + 5.4), bow, F.P(mu + 0.5, 0, mz + 1.1)];
            S.face(head);
            S.loop(head);
            S.line([F.P(mu, 0, mz + 6), bow]);
        }
        return L;
    }

    // Open rowing boat, dark inside, with thwarts
    function rowboat(T, F, rng) {
        const S = T.S, L = rng.range(3.4, 4.2), B = rng.range(1.35, 1.55);
        const Hl = hullSolid(T, F, L, B, 0.5, 0, true);
        paintHull(T, Hl, L, rng);
        const inner = inset3(Hl.deck, 0.1);
        if (inner.length < 3) return L;
        S.loop(inner);
        for (const f of [-0.28, 0, 0.26]) {
            const u = L * f, h = Hl.half(u) - 0.1;
            S.box(F, u - 0.1, -h, 0.38, u + 0.1, h, 0.5);
        }
        return L;
    }

    // Boat of a kind (row, sail, launch or fishing) in frame F. Returns its length.
    function boat(T, F, kind, rng) {
        if (kind === 'row') return rowboat(T, F, rng);
        if (kind === 'sail') return sailboat(T, F, rng);
        if (kind === 'launch') return launch(T, F, rng);
        return fishingBoat(T, F, rng);
    }

    const BEAM = { row: 1.45, fishing: 3.3, launch: 2.5, sail: 2.5 };
    const LENGTH = { row: 4, fishing: 9.5, launch: 7.2, sail: 7.2 };

    // Frame turned to any angle (radians from +x), for boats under way
    function turned(ox, oy, oz, ang) {
        const c = Math.cos(ang), s = Math.sin(ang);
        return {
            P: (a, b, h) => [ox + a * c - b * s, oy + a * s + b * c, oz + h],
            V: (a, b, h) => [a * c - b * s, a * s + b * c, h],
        };
    }

    // Boat out on the water (at height z) with its wake behind it. Returns the
    // patch of water the wake covers, for water marks to keep out of.
    function underway(T, x, y, ang, rng, z = 0) {
        const F = turned(x, y, z, ang);
        const kind = rng.weighted([[3, 'fishing'], [2, 'launch'], [2, 'sail']]);
        const L = kind === 'sail' ? sailboat(T, F, rng, true) : kind === 'launch' ? launch(T, F, rng) : fishingBoat(T, F, rng);
        return wake(T, x, y, ang, L, rng, z);
    }

    // Wake behind a boat of length L heading `ang` from (x, y). Returns the
    // patch of water it covers. `reach` is how far back it runs, as a share of L.
    function wake(T, x, y, ang, L, rng, z = 0, reach = null) {
        const S = T.S;
        const c = Math.cos(ang), s = Math.sin(ang);
        const bow = [x + (c * L) / 2, y + (s * L) / 2], len = L * (reach || rng.range(2, 3.2));
        const ends = [];
        inKind(S, T.waterKind, () => {
            // the two arms spread from the bow, in dashes that get shorter further back
            for (const side of [-1, 1]) {
                const a = ang + Math.PI + side * geo.rad(19.5), dx = Math.cos(a), dy = Math.sin(a);
                for (let t = L * 0.3; t < len; ) {
                    const dl = geo.lerp(1.8, 0.6, t / len);
                    S.line([[bow[0] + dx * t, bow[1] + dy * t, z], [bow[0] + dx * (t + dl), bow[1] + dy * (t + dl), z]]);
                    t += dl + geo.lerp(0.4, 1.6, t / len);
                }
                ends.push([bow[0] + dx * len * 1.08, bow[1] + dy * len * 1.08]);
            }
            // churned water straight behind the stern
            for (let t = L + 0.6; t < L + len * 0.4; t += rng.range(1.6, 2.4)) {
                const o = rng.range(-0.4, 0.4), px = bow[0] - c * t - s * o, py = bow[1] - s * t + c * o;
                S.line([[px, py, z], [px - c * 1.1, py - s * 1.1, z]]);
            }
        });
        return [[bow[0] + c * 2, bow[1] + s * 2], ends[0], ends[1]];
    }

    // Boats in a row along the edge from p0 to p1 (world), bows towards p1,
    // lying off the edge on the side n points to, on water at height z. They
    // can run `over` past p1. With posts, each is tied up to the nearest one.
    function moorRow(T, p0, p1, n, posts, rng, kinds, over = 0, z = 0) {
        const S = T.S;
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 2) return;
        const d = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
        const dir = nearestDir(d[0], d[1]);
        let s = 0;
        while (s < len) {
            if (!rng.chance(0.25 + 0.7 * T.p.boats)) { s += rng.range(3, 6); continue; }
            const kind = rng.weighted(kinds), beam = BEAM[kind], L0 = LENGTH[kind];
            if (s + L0 > len + over) break;
            const c = s + L0 / 2, off = 0.35 + beam / 2;
            const cx = p0[0] + d[0] * c + n[0] * off, cy = p0[1] + d[1] * c + n[1] * off;
            const Lb = boat(T, frame(cx, cy, z, dir), kind, rng);
            if (posts && posts.length && T.detail) {
                // mooring line from the bow to the nearest post
                const f = Lb / 2 - 0.3;
                const bow = [cx + d[0] * f - n[0] * beam * 0.1, cy + d[1] * f - n[1] * beam * 0.1, z + (kind === 'row' ? 0.5 : 1.4)];
                const dist = q => Math.hypot(q[0] - bow[0], q[1] - bow[1]);
                const best = posts.reduce((u, v) => (dist(v) < dist(u) ? v : u));
                if (dist(best) < 5) S.line([bow, [(bow[0] + best[0]) / 2, (bow[1] + best[1]) / 2, Math.min(bow[2], best[2]) - 0.35], best]);
            }
            s += Lb + rng.range(0.8, 2.5);
        }
    }

    // How far a bridge over `span` metres of water runs on over the land each side
    const bridgeRamp = span => Math.min(3.5, 1 + span * 0.2);

    // Humped stone bridge. F is a frame with a along the road, b across it and
    // c the world height: the water runs between a = a0 and a1, and the bridge
    // is w wide from b = 0, which is the side we see. zr is the road and zw the
    // water. The slices it's built from stay quiet and the outline, arch and
    // voussoirs are drawn by hand. `ground` draws where it meets the ground,
    // off when that's already a quay edge.
    function bridge(T, F, a0, a1, w, zr, zw, ground) {
        const S = T.S, P = F.P, span = a1 - a0, ramp = bridgeRamp(span), hump = geo.clamp(span * 0.07, 0.45, 0.9);
        const A0 = a0 - ramp, A1 = a1 + ramp, pw = 0.3, ph = 0.85;
        const top = a => zr + 0.08 + hump * Math.pow(Math.max(0, Math.sin((Math.PI * (a - A0)) / (A1 - A0))), 0.7);
        // segmental arch springing just above the water, 0.5 m under the deck at the crown
        const am = (a0 + a1) / 2, spring = zw + 0.25, crown = top(am) - 0.5, rise = crown - spring;
        const R = (span * span) / (8 * rise) + rise / 2, zc = crown - R;
        const arch = a => zc + Math.sqrt(Math.max(0, R * R - (a - am) * (a - am)));
        const as = [];
        const run = (u, v, n) => { for (let i = 0; i < n; i++) as.push(u + ((v - u) * i) / n); };
        run(A0, a0, 4);
        run(a0, a1, 16);
        run(a1, A1, 4);
        as.push(A1);
        for (let i = 0; i + 1 < as.length; i++) {
            const a = as[i], b = as[i + 1], ta = top(a), tb = top(b);
            const over = a >= a0 - 1e-6 && b <= a1 + 1e-6;
            const ba = over ? arch(a) : zr - 0.05, bb = over ? arch(b) : zr - 0.05;
            S.prism([P(a, 0, ba), P(b, 0, bb), P(b, 0, tb), P(a, 0, ta)], F.V(0, w, 0), false, true);
            for (const pb of [0, w - pw]) S.prism([P(a, pb, ta), P(b, pb, tb), P(b, pb, tb + ph), P(a, pb, ta + ph)], F.V(0, pw, 0), false, true);
        }
        const along = (b, dz) => as.map(a => P(a, b, top(a) + dz));
        S.line(along(0, ph));
        S.line(along(pw, ph));
        S.line(along(w - pw, ph));
        S.line(along(w - pw, 0));
        S.line(along(w, ph));
        if (T.detail) S.line(along(0, 0));
        const t0 = top(A0), t1 = top(A1);
        S.line([P(A0, 0, zr), P(A0, 0, t0 + ph), P(A0, pw, t0 + ph), P(A0, pw, t0), P(A0, w - pw, t0), P(A0, w - pw, t0 + ph), P(A0, w, t0 + ph), P(A0, w, zr)]);
        S.line([P(A1, 0, zr), P(A1, 0, t1 + ph), P(A1, pw, t1 + ph)]);
        S.line([P(A1, pw, t1), P(A1, w - pw, t1), P(A1, w - pw, t1 + ph), P(A1, w, t1 + ph)]);
        if (ground) {
            S.line([P(A0, 0, zr), P(a0, 0, zr)]);
            S.line([P(a1, 0, zr), P(A1, 0, zr)]);
        }
        // the arch with a ring of voussoirs round it
        const f1 = Math.atan2(spring - zc, a1 - am), f0 = Math.PI - f1;
        const on = (f, r) => P(am + r * Math.cos(f), 0, zc + r * Math.sin(f));
        const curve = r => Array.from({ length: 25 }, (_, i) => on(geo.lerp(f0, f1, i / 24), r));
        S.line(curve(R));
        if (T.detail) {
            S.line(curve(R + 0.45));
            const n = Math.max(5, Math.round((R * (f0 - f1)) / 0.55));
            for (let i = 1; i < n; i++) {
                const f = geo.lerp(f0, f1, i / n);
                S.line([on(f, R), on(f, R + 0.45)]);
            }
        }
    }

    PG.isokit = {
        FLOOR, wall, rect, pane, door, garageDoor, windows, fascia, gableRoof, gableWindow, gableSlope,
        roofExtras, dormer, chimney, roofUnit, flatRoof, plinth, steps, porch, downpipe, hipRoof, cabin,
        wheels, car, fence, railing, patioSet, nearestDir, chair, bench, clothesline, bike, person, Occupancy,
        lerp3, unit, outward, inKind, withKind, shade, shadeGable, shadeRound, awning, vault, ribs, marketHall, clockTower,
        gableWall, stepGable, neckGable, hoist, terrace, arch, church, cart, bistro, crookLamp, railFence, roundTree, conifer,
        fountain, obelisk, bandstand,
        hullSolid, paintHull, boat, BEAM, LENGTH, turned, underway, wake, moorRow, bridgeRamp, bridge,
    };
})();
