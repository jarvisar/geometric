/*
 * Parts for building towns in an isometric scene (see iso.js): walls,
 * windows, doors and roofs, plus vehicles, fences, furniture and people.
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
    const { BOX, DIRS, frame, newell, card, ring } = PG.iso;
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
        const oh = 0.4, zb = zTop - 0.25, tp = Math.tan(pitch);
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
        const oh = 0.4, zb = zTop - 0.25;
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

    PG.isokit = {
        FLOOR, wall, rect, pane, door, garageDoor, windows, fascia, gableRoof, gableWindow, gableSlope,
        roofExtras, dormer, chimney, roofUnit, flatRoof, plinth, steps, porch, downpipe, hipRoof, cabin,
        wheels, car, fence, railing, patioSet, nearestDir, chair, bench, clothesline, bike, person, Occupancy,
    };
})();
