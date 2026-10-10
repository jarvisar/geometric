/*
 * Stadium: a sports ground drawn whole from above, in the same isometric
 * scene as Harbor and Castle Town (lib/iso.js) and shaded the same way.
 *
 * Everything is built round the edge of the field. That edge is a convex
 * outline of straights and arcs, cut into bays about a gangway apart, and a
 * stand is its cross section swept along it: front wall, raked tiers with a
 * wall of boxes between them and a back wall. So a straight stand is a
 * prism, a corner is a fan of wedges, and every patch of seating and wall is
 * flat. A roof is another cross section swept over the top. An old ground
 * with four odd stands, a bowl, a running track, a horseshoe, a ballpark, a
 * cricket ground and a bullring are the same thing with different outlines
 * and different stands on each stretch.
 *
 * The seat rows are the hatching. They follow the bays, break at the
 * gangways and take their pen from the club's colors, so blocks, hoops,
 * stripes and lettering in the seats all come out of which pen a stretch of
 * row gets. Rows, rafters and anything else repeated are spaced by what they
 * come to on paper, and thin out where a stand is seen from behind.
 *
 * The camera is fitted round the stadium once it's planned. The rest of
 * the page is the block it stands in, with the crowd on it, and a grid of
 * streets beyond: terraces, car parks, parks, training pitches and courts.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, Scene, segments, newell } = PG.iso;
    const kit = PG.isokit;
    const { inKind, withKind, lerp3, unit } = kit;

    // Line kinds. With fewer pens the last ones share a pen (see pens.js).
    const INK = 0, RED = 1, BLUE = 2, GOLD = 3, GREEN = 4, FIGURE = 5, GLASS = 6, TRACK = 7, PAVE = 8;
    const person = withKind(FIGURE, kit.person);
    const tree = withKind(GREEN, kit.roundTree);
    const SUN_TURN = geo.rad(65); // as Harbor, shadows fall along +x turned this far towards -y
    // Lines closer than this on paper (mm) run together under a 0.35 mm pen
    const FINE = 0.7;
    const UP = [0, 0, 1];

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mix = (a, b, t) => a + (b - a) * t;

    // Paper distance (mm) between two lines along world vector a that are
    // world vector b apart
    function apart(T, a, b) {
        const c = T.cam, on = v => [v[0] * c.rx + v[1] * c.ry, (v[0] * c.fx + v[1] * c.fy) * c.se + v[2] * c.ce];
        const p = on(a), q = on(b);
        return (c.k * Math.abs(p[0] * q[1] - p[1] * q[0])) / (Math.hypot(p[0], p[1]) || 1);
    }

    // Paper distance (mm) between two world points
    function paper(T, a, b) {
        const p = T.cam.project(a[0], a[1], a[2]), q = T.cam.project(b[0], b[1], b[2]);
        return Math.hypot(q[0] - p[0], q[1] - p[1]);
    }

    // ------------------------------------------------------------------
    // The edge of the field
    // ------------------------------------------------------------------

    // A convex polygon (anticlockwise) with its corners rounded, as arcs and
    // the straights left between them. Radii too big for an edge are shrunk.
    function outline(verts, radii) {
        const n = verts.length;
        const edges = verts.map((a, i) => {
            const b = verts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            return { a, L, u, out: [u[1], -u[0]] };
        });
        const turn = verts.map((_, i) => {
            const u = edges[(i + n - 1) % n].u, v = edges[i].u;
            return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
        });
        const r = radii.slice();
        for (let pass = 0; pass < 4; pass++) {
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n, t = r[i] * Math.tan(turn[i] / 2) + r[j] * Math.tan(turn[j] / 2);
                if (t > edges[i].L) { r[i] *= edges[i].L / t; r[j] *= edges[i].L / t; }
            }
        }
        const pieces = [];
        for (let i = 0; i < n; i++) {
            const e0 = edges[(i + n - 1) % n], e = edges[i], t = r[i] * Math.tan(turn[i] / 2), v = verts[i];
            if (r[i] > 0.01) {
                pieces.push({
                    arc: true, corner: i, r: r[i], turn: turn[i], a0: Math.atan2(e0.out[1], e0.out[0]),
                    c: [v[0] - e0.u[0] * t - e0.out[0] * r[i], v[1] - e0.u[1] * t - e0.out[1] * r[i]],
                });
            }
            const t1 = r[(i + 1) % n] * Math.tan(turn[(i + 1) % n] / 2), len = e.L - t - t1;
            if (len > 0.05) pieces.push({ arc: false, edge: i, a: [e.a[0] + e.u[0] * t, e.a[1] + e.u[1] * t], u: e.u, out: e.out, len });
        }
        return pieces;
    }

    // The outline cut into bays. Each station is a point on it with the way
    // out from the field there, and bay i runs from station i to the next.
    // Bays are about `bay` wide at the back of a stand `reach` deep, which is
    // where a corner's bays are widest.
    class Ring {
        constructor(pieces, bay, reach) {
            this.pieces = pieces;
            this.st = [];
            pieces.forEach((pc, k) => {
                pc.first = this.st.length;
                if (pc.arc) {
                    const m = Math.max(2, Math.ceil(pc.turn / Math.min(bay / (pc.r + reach), 0.16)));
                    for (let j = 0; j < m; j++) {
                        const a = pc.a0 + (pc.turn * j) / m, nx = Math.cos(a), ny = Math.sin(a);
                        this.st.push({ x: pc.c[0] + pc.r * nx, y: pc.c[1] + pc.r * ny, nx, ny, piece: k });
                    }
                    pc.count = m;
                } else {
                    const m = Math.max(1, Math.round(pc.len / bay));
                    for (let j = 0; j < m; j++) {
                        const s = (pc.len * j) / m;
                        this.st.push({ x: pc.a[0] + pc.u[0] * s, y: pc.a[1] + pc.u[1] * s, nx: pc.out[0], ny: pc.out[1], piece: k });
                    }
                    pc.count = m;
                }
            });
            this.n = this.st.length;
            // how much deeper the top tier is at each station, for a swept rim
            this.ext = new Array(this.n).fill(0);
        }

        s(i) { return this.st[((i % this.n) + this.n) % this.n]; }

        // d out from station i, z up
        pt(i, d, z = 0) {
            const s = this.s(i);
            return [s.x + d * s.nx, s.y + d * s.ny, z];
        }

        // u of the way along bay i
        at(i, u, d, z = 0) { return lerp3(this.pt(i, d, z), this.pt(i + 1, d, z), u); }

        // the way out from the middle of bay i
        out(i) {
            const a = this.s(i), b = this.s(i + 1);
            return unit([a.nx + b.nx, a.ny + b.ny, 0]);
        }

        // the way bay i runs
        run(i) {
            const o = this.out(i);
            return [-o[1], o[0], 0];
        }

        width(i, d) {
            const a = this.pt(i, d), b = this.pt(i + 1, d);
            return Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
    }

    // ------------------------------------------------------------------
    // Swept surfaces
    // ------------------------------------------------------------------

    // Surface through a row of ribs, each the same number of points: flat
    // patches between neighboring ribs that hide what's behind them, and the
    // lines along its creases, edges and outline. Ribs run anticlockwise
    // round the field and their points from the front over the top to the
    // back, which is what tells the outside of a patch from the inside. A
    // `solid` is the skin of something closed, so patches facing away are
    // left out and an edge shows when a patch next to it does. Otherwise
    // it's a sheet, whose ends and edges always show. o.along(j, i) and
    // o.across(i, j) can force a line on or off. Returns which patches face
    // the camera.
    function loft(T, ribs, o = {}) {
        const { S, cam } = T, nb = ribs.length - 1, m = ribs[0].length - 1;
        const front = [];
        for (let i = 0; i < nb; i++) {
            const row = [];
            for (let j = 0; j < m; j++) {
                const a = ribs[i][j], b = ribs[i + 1][j], c = ribs[i + 1][j + 1], d = ribs[i][j + 1];
                const quad = [a, d, c, b], n = newell(quad), len = Math.hypot(n[0], n[1], n[2]);
                if (len < 1e-7) { row.push(null); continue; }
                // a patch that isn't flat goes in as two triangles
                let off = 0;
                for (const q of [d, c, b]) off = Math.max(off, Math.abs((q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1] + (q[2] - a[2]) * n[2]) / len);
                let see = false;
                for (const f of off < 4e-4 ? [quad] : [[a, d, c], [a, c, b]]) {
                    const nf = newell(f);
                    if (Math.hypot(nf[0], nf[1], nf[2]) < 1e-7) continue;
                    const on = cam.facing(nf[0], nf[1], nf[2]);
                    see = see || on;
                    if (on || !o.solid) S.face(f, !!o.cast);
                }
                row.push(see);
            }
            front.push(row);
        }
        const flush = cur => { if (cur.length > 1) S.line(cur); };
        for (let j = 0; j <= m; j++) {
            let cur = [];
            for (let i = 0; i < nb; i++) {
                const lo = j > 0 ? front[i][j - 1] : undefined, hi = j < m ? front[i][j] : undefined;
                const want = o.along ? o.along(j, i) : undefined;
                let draw;
                if (want === false) draw = false;
                else if (o.solid) draw = !!(lo || hi);
                else draw = want === true || lo === undefined || hi === undefined || !lo !== !hi;
                if (draw) {
                    if (!cur.length) cur.push(ribs[i][j]);
                    cur.push(ribs[i + 1][j]);
                } else {
                    flush(cur);
                    cur = [];
                }
            }
            flush(cur);
        }
        for (let i = 0; i <= nb; i++) {
            if (o.closed && i === nb) break;
            let cur = [];
            for (let j = 0; j < m; j++) {
                const lo = i > 0 ? front[i - 1][j] : o.closed ? front[nb - 1][j] : undefined;
                const hi = i < nb ? front[i][j] : undefined;
                const want = o.across ? o.across(i, j) : undefined;
                let draw;
                if (want === false) draw = false;
                else if (lo === undefined || hi === undefined) draw = !o.solid;
                else if (o.solid) draw = want === true ? !!(lo || hi) : !lo !== !hi;
                else draw = want === true || !lo !== !hi;
                if (draw) {
                    if (!cur.length) cur.push(ribs[i][j]);
                    cur.push(ribs[i][j + 1]);
                } else {
                    flush(cur);
                    cur = [];
                }
            }
            flush(cur);
        }
        return front;
    }

    // The parts of polyline A (flat points) that don't run along polyline B
    function offLine(A, B) {
        const out = [], eps = 1e-3;
        const near = (p, a, b) => {
            const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
            const t = L2 ? geo.clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2, 0, 1) : 0;
            return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t) < eps;
        };
        const on = p => B.some((b, k) => k > 0 && near(p, B[k - 1], b));
        for (let k = 1; k < A.length; k++) {
            const p = A[k - 1], q = A[k], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
            if (L2 < 1e-9) continue;
            const ts = [0, 1];
            for (let j = 0; j < B.length; j++) {
                const b = B[j];
                // where B's corners land on this stretch, and where B crosses it
                const t = ((b[0] - p[0]) * dx + (b[1] - p[1]) * dy) / L2;
                if (t > 0 && t < 1 && Math.hypot(b[0] - p[0] - dx * t, b[1] - p[1] - dy * t) < eps) ts.push(t);
                if (!j) continue;
                const a = B[j - 1], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
                if (Math.abs(den) < 1e-9) continue;
                const u = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, v = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
                if (u > 0 && u < 1 && v >= 0 && v <= 1) ts.push(u);
            }
            ts.sort((u, v) => u - v);
            let cur = null;
            for (let j = 1; j < ts.length; j++) {
                const t0 = ts[j - 1], t1 = ts[j], tm = (t0 + t1) / 2;
                if (t1 - t0 < 1e-6) continue;
                if (on([p[0] + dx * tm, p[1] + dy * tm])) { cur = null; continue; }
                const a = [p[0] + dx * t0, p[1] + dy * t0], b = [p[0] + dx * t1, p[1] + dy * t1];
                if (cur) cur.push(b);
                else out.push(cur = [a, b]);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Stands
    // ------------------------------------------------------------------

    // Cross section of a stand whose top tier is `ext` deeper than planned:
    // its outline as [d, z] from the foot of the front wall over the seats
    // to the foot of the back wall, the convex pieces that make it up, and
    // where each tier lies. With a roof the back wall carries on up to it.
    function section(sp, ext) {
        const pts = [[0, 0]], solids = [], tiers = [];
        let d = 0, z = sp.front;
        sp.tiers.forEach((t, k) => {
            const top = k === sp.tiers.length - 1, depth = t.depth + (top ? ext : 0);
            pts.push([d, z]);
            tiers.push({ strip: pts.length - 1, d0: d, z0: z, d1: d + depth, rake: t.rake });
            solids.push([[d, 0], [d + depth, 0], [d + depth, z + depth * t.rake], [d, z]]);
            d += depth;
            z += depth * t.rake;
            pts.push([d, z]);
            if (!top) z += t.gap;
        });
        const rows = d, top = z, b = sp.back;
        if (b.walk > 0) {
            solids.push([[d, 0], [d + b.walk, 0], [d + b.walk, z], [d, z]]);
            d += b.walk;
            pts.push([d, z]);
        }
        const wall = z + (sp.roof ? sp.roof.clear : b.rise);
        solids.push([[d, 0], [d + b.thick, 0], [d + b.thick, wall], [d, wall]]);
        pts.push([d, wall], [d + b.thick, wall], [d + b.thick, 0]);
        return { pts, solids, tiers, rows, top, wall, depth: d + b.thick };
    }

    // Runs of neighboring bays for which key(bay) is the same thing, as
    // { i0, n, key, closed }. Bays with no key belong to no run.
    function runs(R, key) {
        const n = R.n, out = [];
        let start = 0;
        while (start < n && key(start) === key((start + n - 1) % n)) start++;
        if (start === n) return key(0) ? [{ i0: 0, n, key: key(0), closed: true }] : [];
        for (let k = 0; k < n; ) {
            const i0 = (start + k) % n, kk = key(i0);
            let len = 1;
            while (k + len < n && key((start + k + len) % n) === kk) len++;
            if (kk) out.push({ i0, n: len, key: kk, closed: false });
            k += len;
        }
        return out;
    }

    // A stretch of stand: the solid, its outline, and its seats and walls
    function stand(T, R, run) {
        const { S } = T, sp = run.key, cuts = [];
        for (let k = 0; k <= run.n; k++) cuts.push(section(sp, sp.sweep ? R.ext[(run.i0 + k) % R.n] : 0));
        const ribs = cuts.map((c, k) => c.pts.map(([d, z]) => R.pt(run.i0 + k, d, z)));
        S.kind = INK;
        if (S.shadow) {
            for (let k = 0; k < run.n; k++) {
                cuts[k].solids.forEach((pc, j) => {
                    const far = cuts[k + 1].solids[j];
                    S.castShadow(pc.map(([d, z]) => R.pt(run.i0 + k, d, z)).concat(far.map(([d, z]) => R.pt(run.i0 + k + 1, d, z))));
                });
            }
        }
        const front = loft(T, ribs, { solid: true, closed: run.closed });
        return { run, sp, cuts, ribs, front };
    }

    // Where a stand stops, or meets one of another shape, at station i: the
    // end wall, and the outline of whatever part of it shows. A and B are
    // the cross sections on the near and far side of the station going
    // round, either of which can be missing.
    function standEnd(T, R, i, A, B) {
        const { S } = T, at = ([d, z]) => R.pt(i, d, z);
        S.kind = INK;
        for (const [C, sgn, bay] of [[A, 1, i - 1], [B, -1, i]]) {
            if (!C) continue;
            const t = R.run(bay);
            if (T.sees([sgn * t[0], sgn * t[1], 0])) for (const pc of C.solids) S.face(pc.map(at), false);
        }
        // each outline closed along the ground, so the foot of the wall shows too wherever the other stand isn't
        const shut = C => (C ? C.pts.concat([[0, 0]]) : []), a = shut(A), b = shut(B);
        for (const line of offLine(a, b).concat(offLine(b, a))) S.line(line.map(at));
    }

    // ------------------------------------------------------------------
    // Seats
    // ------------------------------------------------------------------

    // Seat rows over the tiers of a stand. A row is a line along the bay at
    // one depth, broken at the gangways, and it's drawn in the pen its seats
    // are painted. Rows are `step` apart up the rake, which is what the
    // steepest view of any stand needs to keep them `rowGap` apart on
    // paper. A bay seen more from behind drops every other row, or three in
    // four, to keep that spacing.
    function seats(T, R, st) {
        const { S } = T, { run, sp, cuts, front } = st, step = T.rowStep;
        sp.tiers.forEach((tier, k) => {
            for (let b = 0; b < run.n; b++) {
                const i = run.i0 + b, c0 = cuts[b].tiers[k], c1 = cuts[b + 1].tiers[k];
                if (!front[b][c0.strip]) continue;
                const o = R.out(i), q = apart(T, R.run(i), [o[0], o[1], tier.rake]);
                let every = 1;
                while (every < 8 && every * step * q < 0.8 * T.p.rowGap) every *= 2;
                if (every * step * q < 0.8 * T.p.rowGap) continue;
                const rows = Math.floor((Math.max(c0.d1, c1.d1) - c0.d0 - 0.6) / step);
                // round a tight corner the bays are slivers, and several share a gangway
                const pc = R.pieces[R.s(i).piece], lane = (i - pc.first + R.n) % R.n;
                const gang = Math.max(1, Math.round(5.5 / R.width(i, (c0.d0 + c0.d1) / 2)));
                for (let r = 0; r < rows; r += every) {
                    const d = c0.d0 + (r + 0.7) * step, z = c0.z0 + (d - c0.d0) * tier.rake, w = R.width(i, d);
                    // a gangway each side, and the back wall where the rim sweeps down
                    const g = Math.min(0.55, w * 0.12) / w;
                    let u0 = lane % gang ? 0 : g, u1 = (lane + 1) % gang && lane + 1 < pc.count ? 1 : 1 - g;
                    const e0 = c0.d1 - 0.5 - d, e1 = c1.d1 - 0.5 - d;
                    if (e0 <= 0 && e1 <= 0) continue;
                    if (e0 < 0) u0 = Math.max(u0, e0 / (e0 - e1));
                    if (e1 < 0) u1 = Math.min(u1, e0 / (e0 - e1));
                    if (u1 - u0 < 0.08) continue;
                    // one pen a column, joined up where neighbors match
                    const cols = sp.cols || 3;
                    let from = u0, kind = null;
                    for (let c = 0; c <= cols; c++) {
                        const next = c < cols ? T.seat(st, k, b, c, cols, r, rows) : null;
                        const u = geo.clamp(c / cols, u0, u1);
                        if (c && next === kind) continue;
                        if (kind !== null && kind >= 0 && u - from > 1e-6) {
                            S.kind = kind;
                            S.line([R.at(i, from, d, z), R.at(i, u, d, z)]);
                        }
                        from = u;
                        kind = next;
                    }
                }
            }
        });
        S.kind = INK;
    }

    // The small things on a stand: glazed boxes along the wall between two
    // tiers, and boards round the pitch in front of it
    function trim(T, R, st, colors) {
        const { S } = T, { run, sp, cuts, ribs, front } = st;
        for (let b = 0; b < run.n; b++) {
            const i = run.i0 + b, run3 = R.run(i), pz = apart(T, run3, UP);
            cuts[b].tiers.forEach((t, k) => {
                const j = t.strip - 1, lo = ribs[b][j], hi = ribs[b][j + 1], lo1 = ribs[b + 1][j], gap = hi[2] - lo[2];
                if (!k || !front[b][j] || gap * pz < 2.6 * FINE) return;
                const w = Math.hypot(lo1[0] - lo[0], lo1[1] - lo[1]), pu = apart(T, UP, sub(lo1, lo)) / (w || 1);
                if (w * pu < 3 * FINE) return;
                const at = (u, f) => [mix(lo[0], lo1[0], u), mix(lo[1], lo1[1], u), lo[2] + gap * f];
                inKind(S, GLASS, () => {
                    S.loop([at(0.08, 0.28), at(0.92, 0.28), at(0.92, 0.76), at(0.08, 0.76)]);
                    if (w * pu > 6 * FINE) S.line([at(0.5, 0.28), at(0.5, 0.76)]);
                });
            });
            // a board to each bay, where the front wall can be seen behind it
            if (!sp.boards || !front[b][0] || R.width(i, -1) < 3) continue;
            const a = R.at(i, 0.06, -1, 0), c = R.at(i, 0.94, -1, 0), top = q => [q[0], q[1], 0.95];
            if (0.95 * pz < 0.9 * FINE) continue;
            S.face([a, c, top(c), top(a)], false);
            S.line([a, c]);
            const kind = colors[(i + (i >> 2)) % colors.length];
            inKind(S, kind, () => S.line([a, top(a), top(c), c]));
        }
        S.kind = INK;
    }

    // ------------------------------------------------------------------
    // Roofs
    // ------------------------------------------------------------------

    // Height of the seats d out from the field on cross section c
    function surface(c, d) {
        let z = 0;
        for (const t of c.tiers) if (d >= t.d0) z = t.z0 + (Math.min(d, t.d1) - t.d0) * t.rake;
        return z;
    }

    // Cross section of a roof over the stand cut c, as [d, z] from the bottom
    // of the front edge over the top to the bottom of the back edge. `base`
    // is how deep the seats are without any sweep, which is what the front
    // edge is set out from. With `up`, it's the cut half way along a bay of
    // a folded roof (the ridge of the fold) or a tent roof (its peak).
    function roofCut(rf, c, base, up = 0) {
        const zo = c.wall + rf.thick, dOut = c.depth + rf.hang, dIn = base * (1 - rf.cover), zi = zo + rf.rise;
        const fold = rf.type === 'folded' ? up * rf.peak : 0, fi = fold ? fold * rf.foldIn : 0;
        const pts = [[dIn, zi - rf.fascia + fi], [dIn, zi + fi]];
        if (rf.type === 'pitched') pts.push([mix(dIn, dOut, rf.ridge), Math.max(zi, zo) + rf.peak]);
        else if (rf.type === 'barrel') for (let j = 1; j < 6; j++) pts.push([mix(dIn, dOut, j / 6), mix(zi, zo, j / 6) + rf.peak * Math.sin((Math.PI * j) / 6)]);
        else if (rf.type === 'tent') pts.push([mix(dIn, dOut, 0.5), mix(zi, zo, 0.5) + up * rf.peak]);
        pts.push([dOut, zo + fold], [dOut, c.wall]);
        return pts;
    }

    // Lines over strip j of a lofted surface, from one edge to the other at
    // even shares of the way along each bay, so they fan out round a corner.
    // At least `gap` mm apart on paper where they're closest. A patch that
    // isn't flat was lofted as two triangles, and the lines bend where they
    // cross from one to the other.
    function hatchStrip(T, ribs, front, j, gap) {
        const { S } = T;
        for (let i = 0; i + 1 < ribs.length; i++) {
            if (!front[i][j]) continue;
            const a = ribs[i][j], b = ribs[i + 1][j], c = ribs[i + 1][j + 1], d = ribs[i][j + 1];
            const dir = sub(lerp3(d, c, 0.5), lerp3(a, b, 0.5));
            const n = Math.floor(Math.min(apart(T, dir, sub(b, a)), apart(T, dir, sub(c, d))) / gap);
            for (let q = 0; q < n; q++) {
                const u = (q + 0.5) / n, p0 = lerp3(a, b, u), p1 = lerp3(d, c, u);
                const X = geo.lineIntersect(p0, [p1[0] - p0[0], p1[1] - p0[1]], a, [c[0] - a[0], c[1] - a[1]]);
                if (X && X.t > 0.02 && X.t < 0.98 && X.u > 0 && X.u < 1) S.line([p0, lerp3(a, c, X.u), p1]);
                else S.line([p0, p1]);
            }
        }
    }

    function flag(T, x, y, z, len, kind) {
        const S = T.S, P = card(T, x, y, z, 0);
        S.kind = INK;
        S.line([P(0, 0), P(0, len)]);
        const w = len * 0.6, h = len * 0.3, top = len - 0.05;
        const pts = [P(0, top), P(w, top - h * 0.5), P(0, top - h)];
        S.face(pts);
        inKind(S, kind, () => {
            S.loop(pts);
            if (T.tones && w * T.k > 1.6) S.line([P(w * 0.5, top - h * 0.25), P(w * 0.5, top - h * 0.75)]);
        });
    }

    // The gable in the middle of an old grandstand roof: a little roof run
    // out square to the big one, with a clock in its end and a flag on top
    function gable(T, R, run, ribs, rf) {
        const S = T.S, mid = run.n >> 1, pc = R.s(run.i0 + mid).piece;
        if (R.pieces[pc].arc || R.s(run.i0 + mid - 1).piece !== pc || R.s(run.i0 + mid + 1).piece !== pc) return;
        const e0 = ribs[mid - 1][1], e1 = ribs[mid + 1][1], eave = ribs[mid][1], ridge = ribs[mid][2];
        const g = Math.min(4.6, (ridge[2] - eave[2]) * 0.92), top = [eave[0], eave[1], eave[2] + g], back = lerp3(eave, ridge, g / (ridge[2] - eave[2]));
        S.kind = INK;
        for (const f of [[e0, e1, top], [e0, top, back], [e1, back, top]]) S.face(f, false);
        S.line([e0, top, e1]);
        S.line([e0, back, e1]);
        S.line([top, back]);
        const o = R.out(run.i0 + mid);
        if (T.sees([-o[0], -o[1], 0])) {
            const r = Math.min(1.25, g * 0.26), t = R.run(run.i0 + mid), n = T.segs(r);
            if (r * T.k > 0.9 * FINE) S.loop(ring(n, (c, sn) => [eave[0] + t[0] * r * c - o[0] * 0.02, eave[1] + t[1] * r * c - o[1] * 0.02, eave[2] + g * 0.4 + r * sn]));
        }
        flag(T, top[0], top[1], top[2], 5, rf.flagKind);
    }

    // Roof over a stretch of stand
    function roof(T, R, run) {
        const { S } = T, rf = run.key, sp = rf.stand, base = section(sp, 0).rows, half = rf.type === 'folded' || rf.type === 'tent';
        const cuts = [], ribs = [];
        for (let k = 0; k <= run.n; k++) cuts.push(section(sp, sp.sweep ? R.ext[(run.i0 + k) % R.n] : 0));
        for (let k = 0; k <= run.n; k++) {
            ribs.push(roofCut(rf, cuts[k], base).map(([d, z]) => R.pt(run.i0 + k, d, z)));
            if (!half || k === run.n) continue;
            const a = roofCut(rf, cuts[k], base, 1), b = roofCut(rf, cuts[k + 1], base, 1);
            ribs.push(a.map(([d, z], j) => lerp3(R.pt(run.i0 + k, d, z), R.pt(run.i0 + k + 1, b[j][0], b[j][1]), 0.5)));
        }
        const m = ribs[0].length - 1, per = half ? 2 : 1;
        S.kind = INK;
        const front = loft(T, ribs, {
            closed: run.closed, cast: true,
            // a barrel only shows its edges and where it curves out of sight
            along: j => (rf.type === 'barrel' && j > 1 && j < m - 1 ? undefined : true),
            // rafters over the top, not down the fascias
            across: (i, j) => (j > 0 && j < m - 1 && (half || (rf.rafters && (i / per) % rf.rafters === 0)) ? true : undefined),
        });
        if (rf.tone && T.tones) {
            for (let j = 1; j < m - 1; j++) {
                for (let i = 0; i + 1 < ribs.length; i++) {
                    if (!front[i][j]) continue;
                    const a = ribs[i][j], b = ribs[i + 1][j], c = ribs[i + 1][j + 1], d = ribs[i][j + 1];
                    const lit = T.lit(newell([a, d, c, b]));
                    // only an old pitched roof gets its far slope filled in dark
                    if (!lit && rf.type !== 'pitched') continue;
                    S.kind = lit ? rf.kind : T.tones.dark;
                    hatchStrip(T, [ribs[i], ribs[i + 1]], [front[i]], j, lit ? T.hLit : T.hDark);
                }
            }
            S.kind = INK;
        }
        // a strip of lamps along the front edge
        if (rf.lamps) {
            inKind(S, GOLD, () => {
                for (let i = 0; i + 1 < ribs.length; i++) {
                    if (!front[i][0]) continue;
                    const lo = lerp3(ribs[i][0], ribs[i][1], 0.5), hi = lerp3(ribs[i + 1][0], ribs[i + 1][1], 0.5);
                    if (paper(T, ribs[i][0], ribs[i][1]) > 1.2 * FINE) S.line([lerp3(lo, hi, 0.15), lerp3(lo, hi, 0.85)]);
                }
            });
        }
        // posts under the front edge of an old roof, standing on the seats
        if (rf.posts) {
            for (let k = 0; k <= run.n; k += rf.posts) {
                if (run.closed && k === run.n) break;
                const c = cuts[k], d = base * (1 - rf.cover) + 0.4, top = ribs[k * per][0];
                S.line([R.pt(run.i0 + k, d, surface(c, d)), [top[0], top[1], top[2]]]);
            }
        }
        if (rf.gable && rf.type === 'pitched' && run.n >= 6) gable(T, R, run, ribs, rf);
        // flags along the back
        if (rf.flags) {
            for (let k = rf.flags >> 1; k < run.n; k += rf.flags) {
                const q = ribs[k * per][m - 1];
                flag(T, q[0], q[1], q[2], 4.5, rf.flagKind);
            }
        }
        return { run, rf, ribs, front, cuts, per };
    }

    // ------------------------------------------------------------------
    // Walls
    // ------------------------------------------------------------------

    // The back wall of a stretch of stand, bay by bay, in the style of its
    // stand. Everything is spaced by what it comes to on paper.
    function facade(T, R, st) {
        const { S } = T, { run, sp, cuts, ribs, front } = st, m = ribs[0].length - 1, style = sp.face;
        const level = (b0, b1, frac, c) => {
            // a line round the wall at height c, or a share of the way up it
            const pts = [];
            for (let b = b0; b <= b1; b++) {
                const base = ribs[b][m];
                pts.push([base[0], base[1], c === undefined ? frac * cuts[b].wall : c]);
            }
            S.line(pts);
        };
        // stretches of wall the camera sees
        const spans = [];
        for (let b = 0; b < run.n; b++) {
            if (!front[b][m - 1]) continue;
            const last = spans[spans.length - 1];
            if (last && last[1] === b) last[1] = b + 1;
            else spans.push([b, b + 1]);
        }
        S.kind = INK;
        for (let b = 0; b < run.n; b++) {
            if (!front[b][m - 1]) continue;
            const p0 = ribs[b][m], p1 = ribs[b + 1][m], w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h0 = cuts[b].wall, h1 = cuts[b + 1].wall;
            const at = (s, c) => [mix(p0[0], p1[0], s / w), mix(p0[1], p1[1], s / w), c], H = u => mix(h0, h1, u), h = Math.min(h0, h1);
            const run3 = [(p1[0] - p0[0]) / w, (p1[1] - p0[1]) / w, 0], pu = apart(T, UP, run3), pz = apart(T, run3, UP);
            if (pu < 1e-6) continue;
            const i = run.i0 + b, gate = sp.gates && i % sp.gates === 0;
            if (style === 'fins') {
                // upright fins over a glazed ground floor
                const n = Math.max(1, Math.floor((w * pu) / (1.7 * FINE))), base = 4.2;
                for (let q = 0; q < n; q++) {
                    const u = (q + 0.5) / n;
                    if (H(u) - 1 > base + 1) S.line([at(u * w, base), at(u * w, H(u) - 1)]);
                }
            } else if (style === 'lattice') {
                // a diagrid: every bay is crossed, and the crossings stack into diamonds
                const n = Math.min(Math.max(2, Math.round(h / (w * 0.9))), Math.floor((h * pz) / (3 * FINE)));
                if (w * pu < 3 * FINE) continue;
                for (let q = 0; q < n; q++) {
                    S.line([at(0, 0.6 + ((h0 - 1.2) * q) / n), at(w, 0.6 + ((h1 - 1.2) * (q + 1)) / n)]);
                    S.line([at(0, 0.6 + ((h0 - 1.2) * (q + 1)) / n), at(w, 0.6 + ((h1 - 1.2) * q) / n)]);
                }
            } else if (style === 'arcade') {
                // stories of round arches
                const n = Math.max(1, Math.round((h - 1) / 7.5)), sh = (h - 1) / n, aw = Math.min(w * 0.62, sh * 0.62);
                for (let q = 0; q < n; q++) {
                    if (aw * pu < 2.2 * FINE) break;
                    kit.arch(T, at, w / 2, q * sh + (q ? 0.9 : 0), aw, sh * 0.8 - (q ? 0.9 : 0));
                }
            } else if (style === 'bands') {
                // glazing bars along every other floor
                const n = Math.max(2, Math.round(h / 4.2)), fh = h / n, bars = Math.max(1, Math.floor((w * pu) / (1.9 * FINE)));
                inKind(S, GLASS, () => {
                    for (let q = 1; q < n; q += 2) {
                        if (fh * pz < 2 * FINE) break;
                        for (let e = 0; e < bars; e++) {
                            const u = (e + 0.5) / bars;
                            S.line([at(u * w, (q + 0.12) * fh * (H(u) / h)), at(u * w, (q + 0.88) * fh * (H(u) / h))]);
                        }
                    }
                });
            } else if (style === 'brick') {
                // a row of windows under the eaves
                const ww = Math.min(1.6, w * 0.3), wh = 1.5, c = h - 3.2;
                if (c > 4 && ww * pu > 1.6 * FINE && wh * pz > 1.6 * FINE) {
                    const n = w > 6 ? 2 : 1;
                    for (let e = 0; e < n; e++) kit.rect(T, at, ((e + 0.5) * w) / n - ww / 2, c, ww, wh);
                }
            }
            // ways in
            if (gate && w > 4 && 2.6 * pz > 1.8 * FINE) {
                const gw = Math.min(3.4, w * 0.5);
                kit.rect(T, at, w / 2 - gw / 2, 0, gw, 2.7);
                if (gw * pu > 3 * FINE) S.line([at(w / 2, 0), at(w / 2, 2.7)]);
            }
        }
        // the lines that run on round the wall from bay to bay
        for (const [b0, b1] of spans) {
            const h = Math.min(...cuts.slice(b0, b1 + 1).map(c => c.wall));
            if (style === 'fins' && h > 6.2) level(b0, b1, 0, 4.2);
            else if (style === 'arcade') {
                const n = Math.max(1, Math.round((h - 1) / 7.5));
                for (let q = 1; q < n; q++) level(b0, b1, 0, (q * (h - 1)) / n);
                level(b0, b1, 0, h - 1);
            } else if (style === 'bands') {
                const n = Math.max(2, Math.round(h / 4.2));
                for (let q = 1; q < n; q++) level(b0, b1, q / n);
            } else if (style === 'brick' && h > 4.8) {
                level(b0, b1, 0, 3.4);
            }
        }
    }

    // ------------------------------------------------------------------
    // Lights and landmarks
    // ------------------------------------------------------------------

    // Bank of floodlights with its bottom edge at (x, y, z), aimed along the
    // flat unit vector `aim` and tilted down. The lamps are a grid on the
    // side the pitch sees. From behind it's a braced frame.
    function lampHead(T, x, y, z, aim, w, h) {
        const S = T.S, tilt = geo.rad(18), ct = Math.cos(tilt), st = Math.sin(tilt);
        const side = [-aim[1], aim[0]], up = [aim[0] * st, aim[1] * st, ct];
        const P = (a, b) => [x + side[0] * a + up[0] * b, y + side[1] * a + up[1] * b, z + up[2] * b];
        const quad = [P(-w / 2, 0), P(w / 2, 0), P(w / 2, h), P(-w / 2, h)];
        S.kind = INK;
        S.face(quad);
        S.loop(quad);
        const pw = paper(T, quad[0], quad[1]), ph = paper(T, quad[1], quad[2]);
        if (T.sees([aim[0] * ct, aim[1] * ct, -st])) {
            const cols = geo.clamp(Math.floor(pw / (1.6 * FINE)), 1, 6), rows = geo.clamp(Math.floor(ph / (1.6 * FINE)), 1, 4);
            inKind(S, GOLD, () => {
                for (let i = 1; i < cols; i++) S.line([P(-w / 2 + (w * i) / cols, 0), P(-w / 2 + (w * i) / cols, h)]);
                for (let j = 1; j < rows; j++) S.line([P(-w / 2, (h * j) / rows), P(w / 2, (h * j) / rows)]);
            });
        } else if (pw > 3 * FINE && ph > 3 * FINE) {
            S.line([quad[0], quad[2]]);
            S.line([quad[1], quad[3]]);
        }
    }

    // Floodlight pylon: a tapering lattice tower, braced on the two sides
    // the camera sees in as many panels as stay apart on paper
    function pylon(T, x, y, h, aim) {
        const S = T.S, r0 = 1.2 + h * 0.045, r1 = r0 * 0.42, cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const at = (c, t) => [x + c[0] * mix(r0, r1, t), y + c[1] * mix(r0, r1, t), h * t];
        S.kind = INK;
        if (S.shadow) S.castShadow(cs.map(c => at(c, 0)).concat(cs.map(c => at(c, 1))));
        const n = geo.clamp(Math.floor((h * T.cam.ce * T.k) / (4.5 * FINE)), 2, 10);
        for (const c of cs) S.line([at(c, 0), at(c, 1)]);
        for (let e = 0; e < 4; e++) {
            const a = cs[e], b = cs[(e + 1) % 4];
            if (!T.sees([a[0] + b[0], a[1] + b[1], 0.3])) continue;
            for (let q = 0; q < n; q++) {
                S.line([at(a, (q + 1) / n), at(b, (q + 1) / n)]);
                S.line(q % 2 ? [at(a, q / n), at(b, (q + 1) / n)] : [at(b, q / n), at(a, (q + 1) / n)]);
            }
        }
        lampHead(T, x, y, h, aim, h * 0.2, h * 0.13);
    }

    // Floodlight mast: one tapering pole
    function mast(T, x, y, h, aim) {
        const S = T.S;
        S.kind = INK;
        S.frustum(x, y, 0, h, 0.75, 0.35, 8);
        lampHead(T, x + aim[0] * 0.5, y + aim[1] * 0.5, h - h * 0.05, aim, h * 0.17, h * 0.1);
    }

    // Lit segments of the digits 0 to 9: top, top right, bottom right, bottom, bottom left, top left, middle
    const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

    // Scoreboard standing at (x, y, z) and facing along `aim`: a slab,
    // on legs if they have any height, with the score on the side that
    // faces the pitch
    function scoreboard(T, x, y, z, aim, w, h, legs, score) {
        const S = T.S, F = kit.turned(x, y, z, Math.atan2(aim[0], -aim[1]));
        S.kind = INK;
        if (legs > 0) for (const a of [-w * 0.3, w * 0.3]) S.box(F, a - 0.4, -0.4, 0, a + 0.4, 0.4, legs);
        S.box(F, -w / 2, -0.6, legs, w / 2, 0.6, legs + h);
        if (!T.sees([aim[0], aim[1], 0])) return;
        // left to right as it reads on the page
        const flip = cam => cam.project(...F.P(1, 0, 0))[0] < cam.project(...F.P(0, 0, 0))[0];
        const sx = flip(T.cam) ? -1 : 1, at = (s, c) => F.P(sx * (s - w / 2), -0.61, legs + c);
        const m = Math.min(0.9, h * 0.12);
        S.loop([at(m, m), at(w - m, m), at(w - m, h - m), at(m, h - m)]);
        const dh = h - 4 * m, dw = dh * 0.5;
        if (paper(T, at(0, 0), at(0, dh)) < 4 * FINE || paper(T, at(0, 0), at(dw, 0)) < 2.5 * FINE) return;
        inKind(S, GOLD, () => {
            const seg = (s, c) => [[0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 1, 0], [0, 0, 1, 0], [0, 0.5, 0, 0], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5]]
                .map(([a0, b0, a1, b1]) => [at(s + a0 * dw, c + b0 * dh), at(s + a1 * dw, c + b1 * dh)]);
            score.forEach((d, i) => {
                const s = w / 2 + (i ? 1 : -1) * dw * 1.1 - dw / 2;
                seg(s, 2 * m).forEach((line, b) => { if (DIGITS[d] & (1 << b)) S.line(line); });
            });
            S.line([at(w / 2 - dw * 0.22, 2 * m + dh / 2), at(w / 2 + dw * 0.22, 2 * m + dh / 2)]);
        });
    }

    // Round ramp tower: a drum with the ramp winding up it, a turn for
    // every stretch of height that keeps the turns apart on paper
    function rampTower(T, x, y, r, h) {
        const S = T.S, n = T.segs(r), rise = Math.max(3.4, (2.6 * FINE) / (T.cam.ce * T.k)), turns = Math.max(1, Math.floor((h - 1.5) / rise));
        S.kind = INK;
        S.frustum(x, y, 0, h, r, r, n);
        S.frustum(x, y, h, h + 1.4, r * 0.55, r * 0.55, Math.max(8, n >> 1));
        const pts = [], m = turns * 48, ro = r * 1.015 + 0.01;
        for (let i = 0; i <= m; i++) {
            const a = (TAU * i) / 48;
            pts.push([x + ro * Math.cos(a), y + ro * Math.sin(a), 0.8 + ((h - 1.6) * i) / m]);
        }
        S.line(pts);
    }

    // Round bar between two world points, smooth so only its outline shows
    function tube(T, p0, p1, r, n = 8) {
        const d = sub(p1, p0), a = unit(d);
        const e1 = unit(Math.abs(a[2]) < 0.9 ? [a[1], -a[0], 0] : [0, a[2], -a[1]]);
        const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
        T.S.prism(ring(n, (c, s) => [p0[0] + r * (e1[0] * c + e2[0] * s), p0[1] + r * (e1[1] * c + e2[1] * s), p0[2] + r * (e1[2] * c + e2[2] * s)]), d, true);
    }

    // The great arch: a tube on a parabola between two feet, leaning over by
    // `lean` at its crown. Returns a function for the points along it.
    function greatArch(T, p0, p1, h, lean, r) {
        const at = t => {
            const q = 4 * t * (1 - t);
            return [mix(p0[0], p1[0], t) + lean[0] * q, mix(p0[1], p1[1], t) + lean[1] * q, h * q];
        };
        T.S.kind = INK;
        const n = 30;
        for (let i = 0; i < n; i++) tube(T, at(i / n), at((i + 1) / n), r);
        return at;
    }

    // Olympic cauldron: a bowl on a stem with the flame alight
    function cauldron(T, x, y, z, h) {
        const S = T.S, r = h * 0.28, n = T.segs(r);
        S.kind = INK;
        S.lathe(x, y, [[r * 0.5, z], [r * 0.22, z + h * 0.12], [r * 0.2, z + h * 0.55], [r * 0.75, z + h * 0.8], [r, z + h]], n);
        const P = card(T, x, y, z + h, 0.2), fl = h * 0.55;
        const tongue = (s, w, t) => [P(s - w, 0), P(s - w * 0.7, t * 0.45), P(s + w * 0.15, t), P(s + w * 0.5, t * 0.5), P(s + w, 0)];
        inKind(S, RED, () => S.line(tongue(0, r * 0.62, fl)));
        if (r * T.k > 2 * FINE) inKind(S, GOLD, () => S.line(tongue(-r * 0.05, r * 0.3, fl * 0.55)));
    }

    // Press box along the top of a stand: a glazed cabin at (x, y, z), `w`
    // long across the way it faces
    function pressBox(T, x, y, z, aim, w) {
        const S = T.S, F = kit.turned(x, y, z, Math.atan2(aim[0], -aim[1])), d = 4.4, h = 4.2;
        S.kind = INK;
        S.box(F, -w / 2, -d / 2, 0, w / 2, d / 2, h);
        S.box(F, -w / 2 - 0.4, -d / 2 - 0.9, h, w / 2 + 0.4, d / 2 + 0.4, h + 0.4);
        if (!T.sees([aim[0], aim[1], 0])) return;
        const at = (s, c) => F.P(s - w / 2, -d / 2 - 0.01, c), n = Math.max(1, Math.floor(paper(T, at(0, 0), at(w, 0)) / (2.2 * FINE)));
        if (paper(T, at(0, 1.2), at(0, h - 0.8)) < 1.8 * FINE) return;
        inKind(S, GLASS, () => {
            S.loop([at(0.6, 1.2), at(w - 0.6, 1.2), at(w - 0.6, h - 0.8), at(0.6, h - 0.8)]);
            for (let i = 1; i < n; i++) S.line([at(0.6 + ((w - 1.2) * i) / n, 1.2), at(0.6 + ((w - 1.2) * i) / n, h - 0.8)]);
        });
    }

    // ------------------------------------------------------------------
    // The field
    // ------------------------------------------------------------------

    // The part of convex polygon P inside convex polygon Q (both anticlockwise)
    function clipConvex(P, Q) {
        let out = P;
        for (let i = 0; i < Q.length && out.length >= 3; i++) {
            const a = Q[i], b = Q[(i + 1) % Q.length];
            out = geo.clipPolygonHalfPlane(out, a, [a[1] - b[1], b[0] - a[0]]);
        }
        return out.length >= 3 ? out : [];
    }

    // Hatch a flat patch of ground (world points) along `dir`, `gap` mm apart
    // on paper, but not where a shadow falls. Shadows get their own hatching,
    // and two lots of lines over each other plot as a dark smudge. The lines
    // are drawn once everything has cast its shadow.
    function groundHatch(T, pts, dir, gap, kind, holes = []) {
        T.later.push(() => {
            const S = T.S, per = apart(T, dir, [-dir[1], dir[0], 0]);
            if (per < 1e-6) return;
            const shade = (S.shadowGroups[0] ? S.shadowGroups[0].polys : []).map(P => {
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
                return { P, x0, y0, x1, y1, s: geo.polygonArea(P) > 0 ? 1 : -1 };
            });
            let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
            for (const q of pts) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
            const near = shade.filter(h => h.x1 > bx0 && h.x0 < bx1 && h.y1 > by0 && h.y0 < by1);
            S.kind = kind;
            for (const [a, b] of geo.hatch([pts].concat(holes).map(loop => loop.map(q => [q[0], q[1]])), gap / per, Math.atan2(dir[1], dir[0]))) {
                const dx = b[0] - a[0], dy = b[1] - a[1], cuts = [];
                for (const h of near) {
                    if (h.x1 < Math.min(a[0], b[0]) || h.x0 > Math.max(a[0], b[0]) || h.y1 < Math.min(a[1], b[1]) || h.y0 > Math.max(a[1], b[1])) continue;
                    let t0 = 0, t1 = 1;
                    for (let i = 0, n = h.P.length; i < n && t0 < t1; i++) {
                        const u = h.P[i], v = h.P[(i + 1) % n], nx = (v[1] - u[1]) * h.s, ny = (u[0] - v[0]) * h.s;
                        const num = (a[0] - u[0]) * nx + (a[1] - u[1]) * ny, den = dx * nx + dy * ny;
                        if (Math.abs(den) < 1e-12) { if (num > 0) t1 = -1; continue; }
                        if (den > 0) t1 = Math.min(t1, -num / den);
                        else t0 = Math.max(t0, -num / den);
                    }
                    if (t1 - t0 > 1e-6) cuts.push([t0, t1]);
                }
                cuts.sort((u, v) => u[0] - v[0]);
                let t = 0;
                const piece = (u0, u1) => { if ((u1 - u0) * Math.hypot(dx, dy) * T.k > 0.6) S.line([[a[0] + dx * u0, a[1] + dy * u0, 0], [a[0] + dx * u1, a[1] + dy * u1, 0]]); };
                for (const [c0, c1] of cuts) {
                    if (c0 > t) piece(t, c0);
                    t = Math.max(t, c1);
                }
                if (t < 1) piece(t, 1);
            }
            S.kind = INK;
        });
    }

    const circle = (r, n, cu = 0, cv = 0) => Array.from({ length: n }, (_, i) => [cu + r * Math.cos((TAU * i) / n), cv + r * Math.sin((TAU * i) / n)]);

    // Mown grass over the convex patch `poly` (flat points in frame F), in
    // `bands` across a length L: every other band hatched, in squares, or
    // on the diagonal. `holes` (in the same frame) are left unmown.
    function mowing(T, F, poly, L, style, bands, holes = []) {
        const { S, p } = T;
        if (style === 'plain' || !p.grass) return;
        S.kind = GREEN;
        const bw = L / bands, hl = L / 2, big = 400;
        const fill = (patch, dir) => {
            const cut = clipConvex(patch, poly);
            if (cut.length < 3) return;
            // a hole only counts where it's inside this patch
            const gaps = holes.map(h => clipConvex(h, cut)).filter(h => h.length >= 3);
            groundHatch(T, cut.map(([u, v]) => F.P(u, v, 0)), F.V(dir[0], dir[1], 0), p.grassGap, GREEN, gaps.map(h => h.map(([u, v]) => F.P(u, v, 0))));
        };
        if (style === 'stripes') {
            for (let i = 0; i < bands; i += 2) fill([[-hl + i * bw, -big], [-hl + (i + 1) * bw, -big], [-hl + (i + 1) * bw, big], [-hl + i * bw, big]], [0, 1]);
        } else if (style === 'checker') {
            const half = Math.ceil(bands / 2);
            for (let i = 0; i < bands; i++) {
                for (let j = -half; j < half; j++) {
                    if ((i + j) & 1) continue;
                    fill([[-hl + i * bw, j * bw], [-hl + (i + 1) * bw, j * bw], [-hl + (i + 1) * bw, (j + 1) * bw], [-hl + i * bw, (j + 1) * bw]], i & 1 ? [1, 0] : [0, 1]);
                }
            }
        } else {
            const s = Math.SQRT1_2;
            // a band across the diagonal from a to a + bw along it
            const band = a => [[(a - big) * s, (a + big) * s], [(a + big) * s, (a - big) * s], [(a + bw + big) * s, (a + bw - big) * s], [(a + bw - big) * s, (a + bw + big) * s]];
            for (let t = -L; t < L; t += 2 * bw) fill(band(t), [-s, s]);
        }
    }

    const rectPoly = (hl, hw) => [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];

    // Points round an arc in frame F, on the ground
    function arcPts(T, F, cu, cv, r, a0, a1) {
        const n = Math.max(6, Math.round((T.segs(r) * Math.abs(a1 - a0)) / TAU)), pts = [];
        for (let i = 0; i <= n; i++) {
            const a = mix(a0, a1, i / n);
            pts.push(F.P(cu + r * Math.cos(a), cv + r * Math.sin(a), 0));
        }
        return pts;
    }

    // A team of little people at [u, v] spots in frame F, jittered
    function team(T, F, spots, kind, rng, jit = 0) {
        for (const [u, v] of spots) {
            const [x, y] = F.P(u + rng.range(-jit, jit), v + rng.range(-jit, jit), 0);
            inKind(T.S, kind, () => kit.person(T, x, y, 0, rng));
        }
    }

    // The two colors the teams play in
    const kits = colors => [colors[0], colors[1] > 0 ? colors[1] : colors[0] === BLUE ? RED : BLUE];

    // Dugouts along the touchline on side `bench` (1 or -1 along v), and a
    // flag at each corner
    function touchline(T, F, hl, hw, bench) {
        const S = T.S;
        S.kind = INK;
        for (const u of [-11, 11]) S.box(F, u - 4, bench * (hw + 2.4) - 0.9, 0, u + 4, bench * (hw + 2.4) + 0.9, 1.9);
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const [x, y] = F.P(su * hl, sv * hw, 0), P = card(T, x, y, 0, 0);
            S.line([P(0, 0), P(0, 1.6)]);
            inKind(S, GOLD, () => S.loop([P(0, 1.6), P(0.6, 1.4), P(0, 1.2)]));
        }
    }

    // Football pitch round the origin of frame F, u along it
    function football(T, F, o, rng) {
        const S = T.S, hl = 52.5, hw = 34, P = (u, v, c = 0) => F.P(u, v, c);
        mowing(T, F, rectPoly(hl, hw), 2 * hl, o.mow, o.bands);
        S.kind = GREEN;
        S.loop([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)]);
        S.line([P(0, -hw), P(0, hw)]);
        S.line(arcPts(T, F, 0, 0, 9.15, 0, TAU));
        for (const s of [-1, 1]) {
            const e = s * hl;
            S.kind = GREEN;
            S.line([P(e, -20.16), P(e - s * 16.5, -20.16), P(e - s * 16.5, 20.16), P(e, 20.16)]);
            S.line([P(e, -9.16), P(e - s * 5.5, -9.16), P(e - s * 5.5, 9.16), P(e, 9.16)]);
            const a = Math.acos(5.5 / 9.15), mid = s > 0 ? Math.PI : 0;
            S.line(arcPts(T, F, e - s * 11, 0, 9.15, mid - a, mid + a));
            // goal: posts, bar and the net behind
            S.kind = INK;
            const g = 3.66, gh = 2.44, back = e + s * 2;
            S.line([P(e, -g), P(e, -g, gh), P(e, g, gh), P(e, g)]);
            S.line([P(e, -g, gh), P(back, -g), P(back, g), P(e, g, gh)]);
        }
        if (!rng) return;
        touchline(T, F, hl, hw, o.bench);
        // 4-4-2 against 4-3-3, pushed up towards whichever end has the ball
        const push = rng.range(-0.25, 0.25) * hl, ks = kits(o.colors);
        const shapes = [[[0.92, [0]], [0.62, [-0.36, -0.12, 0.12, 0.36]], [0.3, [-0.38, -0.13, 0.13, 0.38]], [0.04, [-0.14, 0.14]]],
            [[0.92, [0]], [0.6, [-0.36, -0.12, 0.12, 0.36]], [0.32, [-0.28, 0, 0.28]], [0.08, [-0.34, 0, 0.34]]]];
        shapes.forEach((shape, side) => {
            const spots = shape.flatMap(([back, vs]) => vs.map(v => [geo.clamp((side ? 1 : -1) * back * hl + push, -hl + 4, hl - 4), v * 2 * hw]));
            team(T, F, spots, ks[side], rng, 3);
        });
        team(T, F, [[push, 5]], INK, rng, 5);
    }

    function rugby(T, F, o, rng) {
        const S = T.S, hl = 50, hw = 35, ig = 8, P = (u, v, c = 0) => F.P(u, v, c);
        mowing(T, F, rectPoly(hl, hw), 2 * hl, o.mow, o.bands);
        S.kind = GREEN;
        S.loop([P(-hl - ig, -hw), P(hl + ig, -hw), P(hl + ig, hw), P(-hl - ig, hw)]);
        for (const u of [-hl, -28, 0, 28, hl]) S.line([P(u, -hw), P(u, hw)]);
        for (const u of [-10, 10]) for (let v = -hw + 1.5; v < hw - 4; v += 7) S.line([P(u, v), P(u, v + 4)]);
        S.kind = INK;
        for (const s of [-1, 1]) {
            const e = s * hl;
            S.line([P(e, -2.8), P(e, -2.8, 11)]);
            S.line([P(e, 2.8), P(e, 2.8, 11)]);
            S.line([P(e, -2.8, 3), P(e, 2.8, 3)]);
        }
        if (!rng) return;
        touchline(T, F, hl + ig, hw, o.bench);
        // two lines facing each other across the gain line, backs strung out behind
        const u0 = rng.range(-0.4, 0.4) * hl, ks = kits(o.colors);
        for (const side of [0, 1]) {
            const s = side ? 1 : -1, spots = [];
            for (let i = 0; i < 8; i++) spots.push([u0 + s * (1.2 + (i % 2) * 1.3), -6 + (i >> 1) * 1.6 - 14]);
            for (let i = 0; i < 7; i++) spots.push([u0 + s * (5 + i * 2.6), -6 + i * 6]);
            team(T, F, spots.map(([u, v]) => [geo.clamp(u, -hl, hl), geo.clamp(v, -hw + 1, hw - 1)]), ks[side], rng, 0.5);
        }
        team(T, F, [[u0, -10]], INK, rng, 2);
    }

    function gridiron(T, F, o, rng) {
        const S = T.S, hl = 54.86, hw = 24.38, gl = 45.72, yd = 4.572, P = (u, v, c = 0) => F.P(u, v, c), ks = kits(o.colors);
        mowing(T, F, rectPoly(gl, hw), 2 * gl, o.mow, 20);
        S.kind = GREEN;
        S.loop([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)]);
        for (let i = -10; i <= 10; i++) S.line([P(i * yd, -hw), P(i * yd, hw)]);
        // hash marks between the yard lines, when there's room for them on paper
        if (apart(T, F.V(0, 1, 0), F.V(yd / 5, 0, 0)) > 1.4 * FINE) {
            for (let i = -50; i <= 50; i++) {
                if (i % 5 === 0) continue;
                for (const v of [-hw + 0.3, -3.1, 2.5, hw - 0.9]) S.line([P((i * yd) / 5, v), P((i * yd) / 5, v + 0.6)]);
            }
        }
        // the logo at midfield and the end zones painted in each side's colors
        inKind(S, ks[0], () => S.line(arcPts(T, F, 0, 0, 5.5, 0, TAU)));
        for (const s of [-1, 1]) {
            const zone = s < 0 ? [P(-hl, -hw), P(-gl, -hw), P(-gl, hw), P(-hl, hw)] : [P(gl, -hw), P(hl, -hw), P(hl, hw), P(gl, hw)];
            groundHatch(T, zone, unit(F.V(1, s, 0)), T.p.grassGap, ks[s < 0 ? 0 : 1]);
            // gooseneck posts
            inKind(S, GOLD, () => {
                S.line([P(s * (hl + 1.8), 0), P(s * (hl + 1.8), 0, 2.5), P(s * hl, 0, 3.05)]);
                S.line([P(s * hl, -2.82, 10.5), P(s * hl, -2.82, 3.05), P(s * hl, 2.82, 3.05), P(s * hl, 2.82, 10.5)]);
            });
        }
        if (!rng) return;
        // benches, and the two elevens lined up over the ball
        S.kind = INK;
        for (const s of [-1, 1]) S.box(F, -20, s * (hw + 4.5) - 0.5, 0, 20, s * (hw + 4.5) + 0.5, 0.6);
        const u0 = Math.round(rng.range(-7, 7)) * yd;
        for (const side of [0, 1]) {
            const s = side ? 1 : -1, spots = [];
            for (let i = 0; i < 7; i++) spots.push([u0 + s * 0.9, (i - 3) * 1.6]);
            spots.push([u0 + s * 0.9, -11], [u0 + s * 0.9, 12], [u0 + s * 5, 0], [u0 + s * (side ? 9 : 7), side ? 6 : -1.5]);
            team(T, F, spots, ks[side], rng, 0.3);
        }
        team(T, F, [[u0 - 1, -17], [u0 + 14, 8], [u0 - 12, 3]], INK, rng, 1);
    }

    // Running track with a football pitch inside it and the jumps in the
    // two ends. The lanes drop to every other line when they'd run together.
    function athletics(T, F, o, rng) {
        const S = T.S, st = 42.195, r0 = 36.5, lw = 1.22, lanes = 8, P = (u, v, c = 0) => F.P(u, v, c), b = o.bench;
        football(T, F, o, null);
        const lap = r => arcPts(T, F, st, 0, r, -Math.PI / 2, Math.PI / 2).concat(arcPts(T, F, -st, 0, r, Math.PI / 2, 1.5 * Math.PI), [P(st, -r)]);
        S.kind = TRACK;
        const every = lw * T.k * T.cam.se < 0.8 * FINE ? 2 : 1;
        for (let i = 0; i <= lanes; i += every) {
            S.line(lap(r0 + i * lw));
            // the sprint straight runs on back past the bend
            S.line([P(-st, b * (r0 + i * lw)), P(-st - 16, b * (r0 + i * lw))]);
        }
        S.line([P(-st - 16, b * r0), P(-st - 16, b * (r0 + lanes * lw))]);
        S.line([P(st, b * r0), P(st, b * (r0 + lanes * lw))]);
        // long jump: a runway across one end to a sand pit
        const lu = -60;
        S.line([P(lu - 0.6, -24), P(lu - 0.6, 9)]);
        S.line([P(lu + 0.6, -24), P(lu + 0.6, 9)]);
        const pit = [P(lu - 1.5, 9), P(lu + 1.5, 9), P(lu + 1.5, 18), P(lu - 1.5, 18)];
        S.loop(pit);
        inKind(S, GOLD, () => S.hatch(pit, F.V(1, 0, 0), 1.2 * FINE));
        // high jump: the fan it's run up on, and the mat
        S.line(arcPts(T, F, 71, 0, 15, Math.PI * 0.56, Math.PI * 1.44));
        S.kind = INK;
        S.box(F, 70, -3, 0, 74, 3, 0.7);
        S.line([P(69.6, -2.2), P(69.6, -2.2, 2.3)]);
        S.line([P(69.6, 2.2), P(69.6, 2.2, 2.3)]);
        S.line([P(69.6, -2.2, 2), P(69.6, 2.2, 2)]);
        // shot put circle and its sector
        inKind(S, GREEN, () => {
            S.line(arcPts(T, F, -70, -10, 1.07, 0, TAU));
            for (const a of [-0.3, 0.3]) S.line([P(-70, -10), P(-70 + 17 * Math.cos(a + 0.35), -10 + 17 * Math.sin(a + 0.35))]);
        });
        if (!rng) return;
        // a race coming off the bend into the home straight
        const ks = [o.colors[0], BLUE, GOLD, RED, INK, GREEN, BLUE, RED], lead = rng.range(-15, 25);
        for (let i = 0; i < lanes; i++) team(T, F, [[lead + rng.range(-9, 6), b * (r0 + (i + 0.5) * lw)]], ks[i], rng, 0);
        team(T, F, [[lu, -22], [67, -9], [-66, -12], [st + 1, b * (r0 - 2)], [st + 1, b * (r0 + lanes * lw + 1.5)]], INK, rng, 0.5);
    }

    // Cricket: a round outfield inside the rope, the square in the middle
    // with the wicket on it, and the 30 yard circle
    function cricket(T, F, o, rng) {
        const S = T.S, r = o.r, P = (u, v, c = 0) => F.P(u, v, c);
        mowing(T, F, circle(r, 48), 2 * r, o.mow, o.bands);
        S.kind = GREEN;
        S.line(arcPts(T, F, 0, 0, r, 0, TAU));
        S.loop([P(-11, -13), P(11, -13), P(11, 13), P(-11, 13)]);
        // the inner ring is dashed
        const ringPts = arcPts(T, F, 10.06, 0, 27.43, -Math.PI / 2, Math.PI / 2).concat(arcPts(T, F, -10.06, 0, 27.43, Math.PI / 2, 1.5 * Math.PI));
        ringPts.push(ringPts[0]);
        for (let i = 0; i + 1 < ringPts.length; i += 2) S.line([ringPts[i], ringPts[i + 1]]);
        inKind(S, TRACK, () => {
            S.loop([P(-10.06, -1.52), P(10.06, -1.52), P(10.06, 1.52), P(-10.06, 1.52)]);
            for (const s of [-1, 1]) S.line([P(s * 8.84, -1.8), P(s * 8.84, 1.8)]);
        });
        // sight screens behind the bowler's arm at each end
        S.kind = INK;
        for (const s of [-1, 1]) {
            const u = s * (r + 1.6);
            S.box(F, Math.min(u, u + s * 0.8), -6, 0, Math.max(u, u + s * 0.8), 6, 4.6);
        }
        if (!rng) return;
        const ks = kits(o.colors), field = [[13, 0]];
        for (let i = 0; i < 9; i++) {
            const a = rng.range(0, TAU), d = rng.range(0.25, 0.92) * r;
            field.push([d * Math.cos(a), d * Math.sin(a)]);
        }
        field.push([-24, 3]);
        team(T, F, field, ks[0], rng, 0);
        team(T, F, [[9.2, 0.9], [-9.2, -0.9]], ks[1], rng, 0);
        team(T, F, [[-12, 0], [0, 16]], INK, rng, 0);
    }

    // Bullring: the sand with its two rings, and the fence round it with
    // shields to slip behind
    function bullring(T, F, o, rng) {
        const S = T.S, r = o.r, P = (u, v, c = 0) => F.P(u, v, c);
        inKind(S, TRACK, () => {
            S.line(arcPts(T, F, 0, 0, r * 0.74, 0, TAU));
            S.line(arcPts(T, F, 0, 0, r * 0.56, 0, TAU));
        });
        S.kind = INK;
        S.line(arcPts(T, F, 0, 0, r, 0, TAU));
        S.line(arcPts(T, F, 0, 0, r, 0, TAU).map(q => [q[0], q[1], 1.5]));
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + (TAU * i) / 4, c = Math.cos(a), s = Math.sin(a), q = r - 0.9;
            const pts = [P(q * c + 1.3 * s, q * s - 1.3 * c), P(q * c - 1.3 * s, q * s + 1.3 * c)];
            S.face([pts[0], pts[1], [pts[1][0], pts[1][1], 1.5], [pts[0][0], pts[0][1], 1.5]]);
            S.loop([pts[0], pts[1], [pts[1][0], pts[1][1], 1.5], [pts[0][0], pts[0][1], 1.5]]);
        }
        if (!rng) return;
        team(T, F, [[2.5, 1]], o.colors[0] > 0 ? RED : INK, rng, 1);
        team(T, F, [[r * 0.6, -r * 0.5], [-r * 0.7, 0.2 * r], [-r * 0.2, r * 0.75]], GOLD, rng, 1);
        // the bull
        const B = kit.turned(...F.P(-3.5, -1.5, 0), rng.range(0, TAU));
        S.box(B, -1.1, -0.38, 0.55, 0.9, 0.38, 1.35);
        S.box(B, 0.9, -0.25, 0.9, 1.45, 0.25, 1.4);
        for (const a of [-0.9, 0.7]) for (const b of [-0.3, 0.3]) S.line([B.P(a, b, 0), B.P(a, b, 0.55)]);
    }

    // Baseball: home plate at the origin of F with the foul lines along u
    // and v. `poly` is the wall round the field in the same frame.
    function baseball(T, F, o, rng) {
        const S = T.S, P = (u, v, c = 0) => F.P(u, v, c), base = 27.43, m = 18.44 * Math.SQRT1_2, far = Math.sqrt(29 * 29 - m * m) + m;
        // the skin of the infield: out to an arc round the mound, less the grass inside the bases
        const a0 = Math.atan2(-m - 1.5, far - m), a1 = Math.atan2(far - m, -m - 1.5), skin = [[-3.2, -3.2]];
        for (let i = 0; i <= 28; i++) {
            const a = mix(a0, a1, i / 28);
            skin.push([m + 29 * Math.cos(a), m + 29 * Math.sin(a)]);
        }
        const grass = [[3.6, 3.6], [base - 3.6, 3.6], [base - 3.6, base - 3.6], [3.6, base - 3.6]], mound = circle(2.7, 14, m, m);
        mowing(T, F, o.poly, 2 * o.span, o.mow, o.bands * 2, [skin]);
        const at = loop => loop.map(([u, v]) => P(u, v));
        groundHatch(T, at(skin), unit(F.V(1, -1, 0)), T.p.grassGap * 0.9, TRACK, [at(grass), at(mound)]);
        inKind(S, TRACK, () => {
            S.loop(at(skin));
            S.loop(at(grass));
            S.loop(at(mound));
        });
        S.kind = GREEN;
        S.line([P(o.pole, 0), P(far, 0)]);
        S.line([P(0, o.pole), P(0, far)]);
        // foul poles, and the dugouts along each line
        inKind(S, GOLD, () => {
            S.line([P(o.pole, 0), P(o.pole, 0, 12)]);
            S.line([P(0, o.pole), P(0, o.pole, 12)]);
        });
        S.kind = INK;
        S.box(F, 9, -9.5, 0, 27, -7.6, 1.8);
        S.box(F, -9.5, 9, 0, -7.6, 27, 1.8);
        if (!rng) return;
        const ks = kits(o.colors);
        team(T, F, [[m, m], [-1.6, -1.6], [25, 3.5], [35, 20], [20, 35], [3.5, 25], [29, 73], [64, 64], [73, 29]], ks[0], rng, 1.5);
        team(T, F, [[0.2, -1.1], [base - 1, 1.6]], ks[1], rng, 0);
        team(T, F, [[-3, -3], [base + 2, -2.5]], INK, rng, 0);
    }

    // Airship: a smooth hull along `dir` (a flat unit vector) with its fins
    // and a car slung underneath
    function blimp(T, x, y, z, dir, L, kind) {
        const S = T.S, r = L * 0.14, n = 14, rings = 11, side = [-dir[1], dir[0]];
        const at = (t, a, k = 1) => {
            // fat towards the nose, drawn out to the tail
            const rr = k * r * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.72), u = (0.5 - t) * L;
            return [x + dir[0] * u + side[0] * rr * Math.cos(a), y + dir[1] * u + side[1] * rr * Math.cos(a), z + rr * Math.sin(a)];
        };
        const v = [at(0, 0)], f = [], g = [];
        for (let i = 1; i < rings; i++) for (let j = 0; j < n; j++) v.push(at(i / rings, (TAU * j) / n));
        v.push(at(1, 0));
        const id = (i, j) => 1 + (i - 1) * n + (j % n), tail = v.length - 1;
        for (let j = 0; j < n; j++) {
            f.push([0, id(1, j), id(1, j + 1)], [tail, id(rings - 1, j + 1), id(rings - 1, j)]);
            g.push(1, 1);
            for (let i = 1; i < rings - 1; i++) { f.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]); g.push(1); }
        }
        S.kind = INK;
        S.solid(v, f, g);
        // a band of color along its side, a hair off the hull
        inKind(S, kind, () => {
            const face = S.cam.fx * side[0] + S.cam.fy * side[1] < 0 ? 0 : Math.PI;
            for (const a of [-0.35, 0.25]) S.line(Array.from({ length: 15 }, (_, i) => at(0.2 + (0.5 * i) / 14, face + a, 1.03)));
        });
        for (const a of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
            const q = [at(0.8, a, 0.95), at(0.84, a, 2.5), at(0.97, a, 2.7), at(0.97, a, 0.4)];
            S.face(q);
            S.loop(q);
        }
        const F = kit.turned(x, y, z - r - 1.7, Math.atan2(dir[1], dir[0]));
        S.box(F, -L * 0.07, -1, 0, L * 0.07, 1, 1.9);
    }

    // ------------------------------------------------------------------
    // Round about
    // ------------------------------------------------------------------

    // Spots already taken on open ground, as circles
    class Claims {
        constructor() { this.c = []; }
        add(x, y, r) { this.c.push([x, y, r]); }
        free(x, y, r) { return !this.c.some(c => Math.hypot(c[0] - x, c[1] - y) < c[2] + r); }
    }

    // Frame for a block [x0, y0, x1, y1] with u along its longer side, and
    // its size along u and v
    function blockFrame([x0, y0, x1, y1], flip = false) {
        const w = x1 - x0, h = y1 - y0, wide = w >= h;
        if (wide) return flip ? { F: frame(x1, y1, 0, 2), L: w, B: h } : { F: frame(x0, y0, 0, 0), L: w, B: h };
        return flip ? { F: frame(x0, y1, 0, 3), L: h, B: w } : { F: frame(x1, y0, 0, 1), L: h, B: w };
    }

    // A parked car, with as much to it as shows at its size on paper: the
    // whole thing, two boxes, or one box with the line of its windscreen.
    // Any more than that and a full car park plots as a row of black lumps.
    function parked(T, x, y, dir, rng) {
        const S = T.S;
        S.kind = INK;
        if (T.k >= 1.7) return kit.car(T, x, y, 0, dir, rng);
        const F = frame(x, y, 0, dir), L = rng.range(3.9, 4.6), w = 0.85;
        if (T.k < 1.05) {
            S.box(F, -L / 2, -w, 0.2, L / 2, w, 1.3);
            return S.line([F.P(L * 0.12, -w, 1.3), F.P(L * 0.12, w, 1.3)]);
        }
        if (rng.chance(0.12)) return S.box(F, -L / 2, -w, 0.25, L / 2, w, 1.95);
        S.box(F, -L / 2, -w, 0.25, L / 2, w, 0.95);
        S.box(F, -L * 0.3, -w + 0.08, 0.95, L * 0.18, w - 0.08, 1.5);
    }

    // How far apart parked cars stand, wider than a real bay when that
    // would have them touching on paper
    const bay = T => Math.max(2.7, 2.6 / T.k);

    function coach(T, x, y, dir) {
        const S = T.S, F = frame(x, y, 0, dir);
        S.kind = INK;
        S.box(F, -6, -1.25, 0.35, 6, 1.25, 3.2);
        if (2.2 * T.k * T.cam.ce < 1.4 * FINE) return;
        inKind(S, GLASS, () => {
            for (const b of [-1.26, 1.26]) if (T.sees(F.V(0, b, 0))) S.line([F.P(-5.4, b, 2.1), F.P(5.4, b, 2.1)]);
        });
    }

    // Rows of cars either side of each aisle, backed onto the next row
    function carPark(T, r, rng) {
        const { S, p } = T, { F, L, B } = blockFrame(r), P = (a, b) => F.P(a, b, 0);
        S.kind = PAVE;
        S.loop([P(0, 0), P(L, 0), P(L, B), P(0, B)]);
        const row = Math.max(5.2, 4.6 + 0.9 / T.k), mod = 2 * row + 6.2, n = Math.max(1, Math.floor((B - 3) / mod)), b0 = (B - n * mod) / 2, full = p.cars * rng.range(0.55, 1.1);
        const dirs = [0, 1, 2, 3], du = dirs.find(d => F.V(1, 0, 0)[0] === PG.iso.DIRS[d][0] && F.V(1, 0, 0)[1] === PG.iso.DIRS[d][1]);
        for (let i = 0; i < n; i++) {
            const base = b0 + i * mod;
            if (i) S.line([P(4, base), P(L - 4, base)]);
            for (const [b, turn] of [[base + row / 2, 1], [base + mod - row / 2, 3]]) {
                for (let a = 5.5; a < L - 5.5; a += bay(T)) {
                    if (!rng.chance(full)) continue;
                    const [x, y] = F.P(a, b + rng.range(-0.25, 0.25), 0);
                    parked(T, x, y, (du + turn) & 3, rng);
                }
            }
        }
        // a tree at each corner
        for (const [a, b] of [[1.8, 1.8], [L - 1.8, 1.8], [L - 1.8, B - 1.8], [1.8, B - 1.8]]) {
            if (rng.chance(p.trees)) tree(T, ...F.P(a, b, 0), rng);
        }
    }

    // Row of terraced houses under one long roof, from u = 0 to L in frame
    // F with the fronts on v = 0: chimneys on the party walls and walled
    // yards behind. Doors and windows only when they're big enough to plot.
    function terraceRow(T, F, L, rng) {
        const S = T.S, FLOOR = kit.FLOOR, D = 7.5, Y = 6.5, base = 0.25, n = Math.max(2, Math.round(L / 5.4)), w = L / n, top = base + 2 * FLOOR;
        S.kind = INK;
        S.box(F, 0, 0, 0, L, D, top);
        const Rf = kit.gableRoof(T, F, [0, 0, L, D], top, true, geo.rad(rng.range(32, 40)), rng, { attic: false });
        kit.shadeGable(T, F, Rf);
        if (T.k > 0.6) for (let i = 1; i < n; i += T.k < 1.1 ? 2 : 1) kit.chimney(T, F, i * w, D / 2 + 0.6, Rf.zb, Rf.ridge + 0.5);
        if (T.k > 1.5) {
            const doors = Array.from({ length: n }, (_, i) => i * w + (i % 2 ? w - 1 : 1)), front = kit.wall(F, 0, [0, 0, L, D]);
            if (T.sees(front.n)) for (const d of doors) kit.door(T, front.at, d, base, 0.95, 2.1);
            for (let side = 0; side < 4; side++) {
                kit.windows(T, kit.wall(F, side, [0, 0, L, D]), { base, floors: 2, style: 'sash', winW: 0.95, winH: 1.35, gap: 1.3, doors: side === 0 ? doors : [] });
            }
        }
        S.box(F, 0, D + Y - 0.25, 0, L, D + Y, 1.6);
        for (let i = 0; i <= n; i += T.k < 1.1 ? 2 : 1) S.box(F, Math.min(L - 0.2, i * w), D, 0, Math.min(L, i * w + 0.2), D + Y - 0.25, 1.6);
    }

    // Terraced streets: a row along each long side of the block with its
    // yards behind, back to back when there's room for two
    function houses(T, r, rng) {
        const { S, p } = T, need = 14.5;
        for (const flip of [false, true]) {
            const { F, L, B } = blockFrame(r, flip);
            if (flip && B < 2 * need + 2) break;
            if (B < need + 1 || L < 14) return park(T, r, rng);
            const G = { P: (a, b, c) => F.P(a, b + 1.6, c), V: F.V }, len = L - 3, parts = len > 76 ? 2 : 1, each = (len - (parts - 1) * 6) / parts;
            for (let k = 0; k < parts; k++) {
                const a0 = 1.5 + k * (each + 6);
                terraceRow(T, { P: (a, b, c) => G.P(a0 + a, b, c), V: F.V }, each, rng);
            }
            if (B < 2 * need + 2 && B > need + 8) {
                // room behind the yards for a few trees
                for (let i = Math.round((L / 16) * p.trees); i > 0; i--) tree(T, ...F.P(rng.range(4, L - 4), rng.range(need + 5, B - 3), 0), rng);
            }
        }
        S.kind = PAVE;
        S.loop([[r[0], r[1], 0], [r[2], r[1], 0], [r[2], r[3], 0], [r[0], r[3], 0]]);
    }

    // Park: trees, a pond or a ring of path
    function park(T, r, rng) {
        const { S, p } = T, w = r[2] - r[0], h = r[3] - r[1], cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, taken = new Claims();
        S.kind = GREEN;
        S.loop([[r[0] + 1, r[1] + 1, 0], [r[2] - 1, r[1] + 1, 0], [r[2] - 1, r[3] - 1, 0], [r[0] + 1, r[3] - 1, 0]]);
        const kind = Math.min(w, h) > 30 ? rng.weighted([[2, 'pond'], [2, 'path'], [2, 'none']]) : 'none';
        const ell = (rx, ry, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((TAU * i) / n), cy + ry * Math.sin((TAU * i) / n), 0]);
        if (kind === 'pond') {
            const rx = w * rng.range(0.16, 0.26), ry = h * rng.range(0.16, 0.26);
            inKind(S, GLASS, () => {
                S.line(ell(rx, ry));
                if (Math.min(rx, ry) * T.k > 4) S.line(ell(rx * 0.55, ry * 0.55).slice(4, 22));
            });
            taken.add(cx, cy, Math.max(rx, ry) + 2);
        } else if (kind === 'path') {
            inKind(S, PAVE, () => {
                S.line(ell(w * 0.3, h * 0.3));
                S.line(ell(w * 0.3 - 2.4, h * 0.3 - 2.4));
            });
            for (let i = 0; i < 40; i++) taken.add(cx + (w * 0.3 - 1.2) * Math.cos((TAU * i) / 40), cy + (h * 0.3 - 1.2) * Math.sin((TAU * i) / 40), 2.6);
        }
        for (let i = Math.round(((w * h) / 110) * p.trees), tries = 0; i > 0 && tries < 400; tries++) {
            const x = rng.range(r[0] + 4, r[2] - 4), y = rng.range(r[1] + 4, r[3] - 4);
            if (!taken.free(x, y, 3.2)) continue;
            taken.add(x, y, 3.2);
            tree(T, x, y, 0, rng);
            i--;
        }
    }

    // Training pitches side by side, as many as the block holds
    function pitches(T, r, rng) {
        const S = T.S, { F, L, B } = blockFrame(r);
        const along = L >= 2 * B * 0.9, n = along ? Math.max(1, Math.floor(L / (B * 1.45))) : 1, cell = L / n;
        for (let i = 0; i < n; i++) {
            const hl = Math.min(50, cell / 2 - 5), hw = Math.min(32, B / 2 - 5, hl * 0.66);
            if (hl < 14 || hw < 9) continue;
            const cu = (i + 0.5) * cell, cv = B / 2, P = (u, v, c = 0) => F.P(cu + u, cv + v, c), s = hl / 52.5;
            S.kind = GREEN;
            S.loop([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)]);
            S.line([P(0, -hw), P(0, hw)]);
            S.line(arcPts(T, { P }, 0, 0, 9.15 * s, 0, TAU));
            for (const e of [-1, 1]) {
                S.kind = GREEN;
                S.line([P(e * hl, -20 * s), P(e * (hl - 16.5 * s), -20 * s), P(e * (hl - 16.5 * s), 20 * s), P(e * hl, 20 * s)]);
                S.kind = INK;
                S.line([P(e * hl, -3.6 * s), P(e * hl, -3.6 * s, 2.4), P(e * hl, 3.6 * s, 2.4), P(e * hl, 3.6 * s)]);
            }
        }
        S.kind = PAVE;
        S.loop([[r[0], r[1], 0], [r[2], r[1], 0], [r[2], r[3], 0], [r[0], r[3], 0]]);
    }

    // Clay tennis courts in rows
    function courts(T, r, rng) {
        const S = T.S, { F, L, B } = blockFrame(r), cw = 18.5, cl = 36, nu = Math.floor((L - 4) / cw), nv = Math.floor((B - 4) / cl);
        if (nu < 1 || nv < 1) return park(T, r, rng);
        const u0 = (L - nu * cw) / 2, v0 = (B - nv * cl) / 2;
        for (let i = 0; i < nu; i++) {
            for (let j = 0; j < nv; j++) {
                const P = (a, b, c = 0) => F.P(u0 + (i + 0.5) * cw + a, v0 + (j + 0.5) * cl + b, c);
                S.kind = TRACK;
                S.loop([P(-5.49, -11.89), P(5.49, -11.89), P(5.49, 11.89), P(-5.49, 11.89)]);
                if (1.37 * T.k > 1.1 * FINE) {
                    S.line([P(-4.11, -11.89), P(-4.11, 11.89)]);
                    S.line([P(4.11, -11.89), P(4.11, 11.89)]);
                }
                S.line([P(-4.11, -6.4), P(4.11, -6.4)]);
                S.line([P(-4.11, 6.4), P(4.11, 6.4)]);
                S.line([P(0, -6.4), P(0, 6.4)]);
                S.kind = INK;
                S.line([P(-6.4, 0, 1), P(6.4, 0, 1)]);
                S.line([P(-6.4, 0), P(-6.4, 0, 1)]);
                S.line([P(6.4, 0), P(6.4, 0, 1)]);
            }
        }
        S.kind = PAVE;
        S.loop([[r[0], r[1], 0], [r[2], r[1], 0], [r[2], r[3], 0], [r[0], r[3], 0]]);
    }

    // A big shed or two: the club shop, a sports hall, a warehouse
    function sheds(T, r, rng) {
        const { S, p } = T, { F, L, B } = blockFrame(r), n = L > 70 ? 2 : 1, each = L / n;
        for (let i = 0; i < n; i++) {
            const a0 = i * each + rng.range(4, 7), a1 = (i + 1) * each - rng.range(4, 7), b0 = rng.range(4, 7), b1 = Math.min(B - 12, b0 + rng.range(18, 32));
            if (a1 - a0 < 12 || b1 - b0 < 10) continue;
            const h = rng.range(6.5, 10), fp = [a0, b0, a1, b1];
            S.kind = INK;
            S.box(F, a0, b0, 0, a1, b1, h);
            if (rng.chance(0.6)) kit.shadeGable(T, F, kit.gableRoof(T, F, fp, h, a1 - a0 >= b1 - b0, geo.rad(rng.range(12, 20)), rng, { attic: false }));
            else {
                const z = kit.flatRoof(T, F, fp, h);
                for (let q = rng.int(1, 3); q > 0; q--) kit.roofUnit(T, F, rng.range(a0 + 2, a1 - 2), rng.range(b0 + 2, b1 - 2), z, 1.6);
            }
            // loading doors along the front
            const W = kit.wall(F, 2, fp);
            if (T.sees(W.n) && 3.4 * T.k * T.cam.ce > 2 * FINE) for (let s = 3; s < W.len - 5; s += 7) kit.garageDoor(T, W.at, s, 0, 3.4, 3.6);
            // and cars along the far edge of the yard
            for (let a = a0; a < a1 - 3; a += bay(T)) if (rng.chance(p.cars * 0.7)) parked(T, ...F.P(a + 1.4, B - 3.5, 0).slice(0, 2), rng.int(0, 3) | 1, rng);
        }
        S.kind = PAVE;
        S.loop([[r[0], r[1], 0], [r[2], r[1], 0], [r[2], r[3], 0], [r[0], r[3], 0]]);
    }

    // Tent with a pointed top on four poles
    function tent(T, x, y, r, rng) {
        const S = T.S, z0 = 2.3, cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * r, y + b * r, z0]), apex = [x, y, z0 + r * 0.95];
        S.kind = INK;
        S.solid(cs.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        for (const c of cs) S.line([[c[0], c[1], 0], c]);
        for (let i = 0; i < 4; i++) {
            const tri = [cs[i], cs[(i + 1) % 4], apex];
            kit.shade(T, tri, kit.outward(tri, [x, y, z0 + 0.3]), 'canopy');
        }
    }

    // What goes in one corner of the stadium's own block, a square of side
    // `s` with its outer corner at (x, y) and (sx, sy) pointing back in
    function cornerPlot(T, x, y, sx, sy, s, what, rng, taken) {
        const { S, p } = T, P = (a, b) => [x + sx * a, y + sy * b];
        if (what === 'tents') {
            const n = Math.max(1, Math.floor((s - 4) / 7));
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i + j >= n || !rng.chance(0.8)) continue;
                    const [tx, ty] = P(5 + i * 7, 5 + j * 7);
                    if (!taken.free(tx, ty, 3.4)) continue;
                    tent(T, tx, ty, 2.2, rng);
                    taken.add(tx, ty, 3.4);
                }
            }
        } else if (what === 'coaches') {
            const n = Math.min(6, Math.floor((s * 0.7 - 4) / 3.6));
            for (let i = 0; i < n; i++) {
                const [tx, ty] = P(9, 4 + i * 3.6);
                if (s < 24 || ![-4, 0, 4].every(a => taken.free(tx + a, ty, 2.5))) break;
                coach(T, tx, ty, 0);
                taken.add(tx - 4, ty, 2.5);
                taken.add(tx + 4, ty, 2.5);
                taken.add(tx, ty, 2.5);
            }
        } else if (what === 'fountain' && s > 16) {
            const [tx, ty] = P(s * 0.38, s * 0.38);
            S.kind = INK;
            if (taken.free(tx, ty, 4.5)) taken.add(tx, ty, kit.fountain(T, tx, ty, 0, rng) + 1.5);
        } else if (what === 'statue' && s > 12) {
            const [tx, ty] = P(s * 0.38, s * 0.38);
            S.kind = INK;
            if (taken.free(tx, ty, 3.5)) taken.add(tx, ty, kit.obelisk(T, tx, ty, 0, rng) + 1.5);
        }
        // trees in what's left
        for (let i = Math.round(((s * s) / 120) * p.trees * (what === 'trees' ? 2 : 0.7)), tries = 0; i > 0 && tries < 80; tries++) {
            const a = rng.range(3, s - 2), b = rng.range(3, s - 2);
            if (a + b > s * 1.15) continue;
            const [tx, ty] = P(a, b);
            if (!taken.free(tx, ty, 3)) continue;
            taken.add(tx, ty, 3);
            tree(T, tx, ty, 0, rng);
            i--;
        }
    }

    // Street center lines across [lo, hi]: one each side of the stadium's
    // own block [a, b], that block's width cut into blocks about `size`
    // across, and more on out to the edges of the page
    function streetLines(lo, hi, a, b, size, rng) {
        const out = [a, b], n = Math.max(1, Math.round((b - a) / size));
        for (let i = 1; i < n; i++) out.push(a + ((b - a) * (i + rng.range(-0.12, 0.12))) / n);
        for (let x = a - size * rng.range(0.8, 1.25); x > lo - size * 1.3; x -= size * rng.range(0.8, 1.25)) out.push(x);
        for (let x = b + size * rng.range(0.8, 1.25); x < hi + size * 1.3; x += size * rng.range(0.8, 1.25)) out.push(x);
        return out.sort((u, v) => u - v);
    }

    // Everything outside the walls: the apron round the stadium with the
    // crowd on it, and blocks of streets, car parks, parks and pitches out
    // to the edges of the page
    function surround(T, D, fit, seed) {
        const { S, cam, p } = T, R = D.ring, rng = new PG.RNG(hash(seed, 11));
        let reach = 0;
        const depth = R.st.map((_, i) => { const c = fit.cut(i); return c ? c.depth : 0; });
        for (const d of depth) reach = Math.max(reach, d);
        const ap = reach + D.apron, apron = R.st.map((_, i) => R.pt(i, ap).slice(0, 2));
        const wallAt = R.st.map((_, i) => R.pt(i, depth[i] + 0.6).slice(0, 2));
        S.kind = PAVE;
        S.loop(apron.map(([x, y]) => [x, y, 0]));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of apron) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const cell = [x0 - 3, y0 - 3, x1 + 3, y1 + 3], sw = D.street;
        S.loop([[cell[0], cell[1], 0], [cell[2], cell[1], 0], [cell[2], cell[3], 0], [cell[0], cell[3], 0]]);
        const taken = new Claims();
        for (const l of fit.lights) taken.add(l.x, l.y, 5);
        for (const t of fit.towers) taken.add(t.x, t.y, 8);
        for (const q of fit.keep) taken.add(q[0], q[1], q[2]);

        // the four corners of the stadium's block, each as big a square as clears the apron
        const whats = ['trees', 'tents', 'coaches', 'fountain', 'statue', 'trees'];
        [[cell[0], cell[1], 1, 1], [cell[2], cell[1], -1, 1], [cell[2], cell[3], -1, -1], [cell[0], cell[3], 1, -1]].forEach(([x, y, sx, sy]) => {
            let s = 0;
            while (s < 80 && !geo.pointInPolygon(x + sx * (s + 3), y + sy * (s + 3), apron)) s += 1;
            if (s > 8) cornerPlot(T, x, y, sx, sy, s, rng.pick(whats), rng, taken);
        });

        // the crowd: queues out from the gates, and people about the apron
        const inWall = (x, y) => geo.pointInPolygon(x, y, wallAt);
        if (p.people > 0) {
            for (let i = 0; i < R.n; i++) {
                const sp = D.bays[i];
                if (!sp || !sp.gates || i % sp.gates || !rng.chance(0.35 + 0.6 * p.people)) continue;
                const o = R.out(i), d0 = Math.max(depth[i], depth[(i + 1) % R.n]) + 1.2, lean = rng.range(-0.25, 0.25);
                for (let q = 0, n = rng.int(2, Math.round(3 + 9 * p.people)); q < n; q++) {
                    const [x, y] = R.at(i, 0.5 + lean * q * 0.08, d0 + q * rng.range(0.95, 1.25));
                    if (!taken.free(x, y, 0.4)) continue;
                    taken.add(x, y, 0.45);
                    person(T, x + o[1] * rng.range(-0.2, 0.2), y - o[0] * rng.range(-0.2, 0.2), 0, rng);
                }
            }
            const area = (cell[2] - cell[0]) * (cell[3] - cell[1]) - geo.polygonArea(wallAt.slice().reverse());
            // the rest stand about in knots, with a few on their own
            for (let i = Math.round((Math.abs(area) / 120) * p.people), tries = 0; i > 0 && tries < 3000; tries++) {
                const cx = rng.range(cell[0] + 3, cell[2] - 3), cy = rng.range(cell[1] + 3, cell[3] - 3);
                if (inWall(cx, cy)) continue;
                for (let q = rng.chance(0.3) ? 1 : rng.int(2, 7); q > 0 && i > 0; q--) {
                    const a = rng.range(0, TAU), d = rng.range(0, 2.6), x = cx + d * Math.cos(a), y = cy + d * Math.sin(a);
                    if (inWall(x, y) || !taken.free(x, y, 0.5)) continue;
                    taken.add(x, y, 0.5);
                    person(T, x, y, 0, rng);
                    i--;
                }
            }
        }
        // a ring of trees just inside the kerb
        const ringD = ap - 2.5;
        for (let i = 0; i < R.n; i++) {
            const w = R.width(i, ringD), n = Math.max(1, Math.round(w / 13));
            for (let q = 0; q < n; q++) {
                if (!rng.chance(p.trees * 0.75)) continue;
                const [x, y] = R.at(i, (q + 0.5) / n, ringD);
                if (!taken.free(x, y, 2.6)) continue;
                taken.add(x, y, 2.6);
                tree(T, x, y, 0, rng);
            }
        }

        // the blocks beyond, on a grid of streets
        const gs = [[0, 0], [S.W, 0], [S.W, S.H], [0, S.H]].map(([sx, sy]) => cam.ground(sx, sy, 0));
        const lo = [Math.min(...gs.map(g => g[0])), Math.min(...gs.map(g => g[1]))], hi = [Math.max(...gs.map(g => g[0])), Math.max(...gs.map(g => g[1]))];
        const xs = streetLines(lo[0], hi[0], cell[0] - sw / 2, cell[2] + sw / 2, D.block, rng);
        const ys = streetLines(lo[1], hi[1], cell[1] - sw / 2, cell[3] + sw / 2, D.block, rng);
        const onPage = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].some(([x, y]) => {
            const q = cam.project(x, y, 0);
            return q[0] > -25 && q[0] < S.W + 25 && q[1] > -12 && q[1] < S.H + 40;
        });
        const uses = { carPark, houses, park, pitches, courts, sheds };
        for (let i = 0; i + 1 < xs.length; i++) {
            for (let j = 0; j + 1 < ys.length; j++) {
                const r = [xs[i] + sw / 2, ys[j] + sw / 2, xs[i + 1] - sw / 2, ys[j + 1] - sw / 2];
                if (r[0] > cell[0] - sw && r[2] < cell[2] + sw && r[1] > cell[1] - sw && r[3] < cell[3] + sw) continue;
                if (r[2] - r[0] < 12 || r[3] - r[1] < 12 || !onPage(r)) continue;
                const brng = new PG.RNG(hash(seed, 31, i, j));
                uses[brng.weighted(D.uses)](T, r, brng);
            }
        }
    }

    // ------------------------------------------------------------------
    // What to build
    // ------------------------------------------------------------------

    // Seat colors a club can have, as [main, second] line kinds. A second
    // color of -1 leaves those seats blank.
    const COLORS = {
        red: [RED, -1], redblue: [RED, BLUE], blue: [BLUE, -1], bluegold: [BLUE, GOLD], redgold: [RED, GOLD],
        gold: [GOLD, INK], redblack: [RED, INK], bluered: [BLUE, RED], green: [GREEN, GOLD],
    };

    // Which of two colors a seat gets, from where it is in its stand
    const PATTERNS = {
        plain: () => 0,
        tiers: q => q.tier % 2,
        hoops: q => Math.floor(q.row / q.band) % 2,
        stripes: q => q.bay % 2,
        pairs: q => (q.bay >> 1) % 2,
        checker: q => (q.bay + Math.floor(q.row / q.band)) % 2,
        chevron: q => Math.floor((Math.abs(q.col - q.cols / 2) / 2.2 + q.row) / q.band) % 2,
        blocks: q => ((hash(q.seed, q.bay, q.tier) >>> 3) % 3 === 0 ? 1 : 0),
        fade: q => ((hash(q.seed, q.col, q.row) >>> 4) % 97 < 97 * (q.row / q.rows) ** 1.5 ? 1 : 0),
        // a bullring sells its seats in the sun and in the shade
        sun: q => (q.shade ? 1 : 0),
        letters: q => q.letter,
    };

    // Capital letters five seats wide and seven rows tall, a row to a number
    const FONT = {
        A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
        E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
        K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
        O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30],
        T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17],
        Y: [17, 17, 10, 4, 4, 4, 4],
    };
    const WORDS = ['CITY', 'UNITED', 'ROVERS', 'COUNTY', 'TOWN', 'ALBION', 'ATHLETIC', 'PLOT', 'INK', 'LINES', 'HOME', 'KOP', 'FC'];

    // Where a word sits in a block of seats `cols` wide and `rows` deep, in
    // letters as tall as fit, with seats `aspect` times as wide as a row is
    // deep on paper. Nothing if even the smallest letters don't fit.
    function lettering(word, cols, rows, aspect) {
        const w = word.length * 6 - 1;
        for (let ph = Math.min(3, Math.floor((rows - 2) / 7)); ph >= 1; ph--) {
            const pw = Math.max(1, Math.round(ph / aspect));
            if (w * pw <= cols - 2) return { word, pw, ph, col0: (cols - w * pw) >> 1, row0: (rows - 7 * ph) >> 1 };
        }
        return null;
    }

    // Is the seat at (col, row) part of a letter?
    function inLetter(lay, col, row) {
        const gx = Math.floor((col - lay.col0) / lay.pw), gy = Math.floor((row - lay.row0) / lay.ph);
        if (col < lay.col0 || row < lay.row0 || gy > 6 || gx % 6 === 5 || gx >= lay.word.length * 6) return 0;
        return (FONT[lay.word[Math.floor(gx / 6)]][6 - gy] >> (4 - (gx % 6))) & 1;
    }

    const ROOFS = {
        // a flat deck hung out over the seats from the back wall
        cantilever: rng => ({ type: 'flat', clear: rng.range(4.5, 6.5), thick: 0.9, hang: 1.4, cover: rng.range(0.7, 0.95), rise: rng.range(-1, 3.5), fascia: 1.2, rafters: 1 }),
        // an old double pitch on posts
        pitched: rng => ({ type: 'pitched', clear: rng.range(2.8, 3.8), thick: 0.5, hang: 0.9, cover: rng.range(0.85, 1), rise: rng.range(-0.6, 0.6), fascia: 0.7,
            rafters: 0, ridge: rng.range(0.52, 0.7), peak: rng.range(3, 4.6), posts: 2, tone: true }),
        barrel: rng => ({ type: 'barrel', clear: rng.range(3, 4.5), thick: 0.6, hang: 1.2, cover: rng.range(0.85, 1.02), rise: rng.range(-0.5, 2), fascia: 0.9, rafters: 1, peak: rng.range(3, 5) }),
        folded: rng => ({ type: 'folded', clear: rng.range(4.5, 6), thick: 0.6, hang: 1.6, cover: rng.range(0.7, 0.95), rise: rng.range(0, 3), fascia: 0.8, peak: rng.range(2, 3.4), foldIn: rng.range(0.3, 1) }),
        tent: rng => ({ type: 'tent', clear: rng.range(4, 5.5), thick: 0.5, hang: 1.6, cover: rng.range(0.7, 0.95), rise: rng.range(0, 2.5), fascia: 0.6, peak: rng.range(4, 6.5), tone: false }),
    };

    // A stand of a given sort, with the roof it's given (or none)
    function makeStand(rng, sort, rf, seat, face, size = 1) {
        const t = (depth, rake, gap = 0) => ({ depth: depth * size, rake, gap });
        const tiers = {
            bank: () => [t(rng.range(6, 9), rng.range(0.3, 0.36))],
            terrace: () => [t(rng.range(8, 12), rng.range(0.34, 0.42))],
            small: () => [t(rng.range(9, 13), rng.range(0.42, 0.5))],
            side: () => [t(rng.range(14, 19), rng.range(0.45, 0.52))],
            kop: () => [t(rng.range(21, 27), rng.range(0.5, 0.56))],
            huge: () => [t(rng.range(28, 36), rng.range(0.46, 0.52))],
            main: () => [t(rng.range(10, 13), rng.range(0.42, 0.47), rng.range(3.4, 4)), t(rng.range(11, 15), rng.range(0.58, 0.66))],
            double: () => [t(rng.range(12, 15), rng.range(0.42, 0.47), rng.range(3.4, 4)), t(rng.range(14, 19), rng.range(0.58, 0.66))],
            triple: () => [t(rng.range(10, 13), 0.42, 3.4), t(rng.range(7, 9.5), 0.54, 3.4), t(rng.range(12, 16), rng.range(0.62, 0.68))],
            plaza: () => [t(rng.range(9, 12), rng.range(0.48, 0.54), 1.3), t(rng.range(4.5, 6), 0.6)],
            // no seats at all: the outfield wall of a ballpark
            fence: () => [],
        }[sort]();
        const low = sort === 'bank' || sort === 'terrace';
        if (sort === 'fence') return { sort, front: 0, tiers, sweep: false, cols: 1, seat, face: 'none', gates: 0, boards: false, back: { walk: 0, rise: rng.range(3, 4.5), thick: 0.7 }, roof: null };
        const sp = {
            sort, front: sort === 'plaza' ? 2.3 : rng.range(1.3, 2.1), tiers, sweep: false, cols: 4, seat, face, gates: 3, boards: sort !== 'plaza',
            back: rf ? { walk: 0, rise: 0, thick: 3 } : { walk: low ? 1.6 : 2.6, rise: 1.1, thick: 0.5 },
            roof: rf,
        };
        if (rf) rf.stand = sp;
        return sp;
    }

    const SPORTS = { football: [58.5, 39], rugby: [62.5, 39.5], gridiron: [61, 34] };

    // What the blocks round about are used for, as weights
    const SETTINGS = {
        town: [[7, 'houses'], [1, 'park'], [0.8, 'sheds'], [0.5, 'pitches'], [1, 'carPark']],
        park: [[4.5, 'park'], [2.5, 'pitches'], [1.5, 'courts'], [1.5, 'carPark'], [0.6, 'houses']],
        lots: [[6, 'carPark'], [1.3, 'sheds'], [1, 'park'], [0.4, 'courts']],
        campus: [[3, 'pitches'], [2, 'courts'], [2.5, 'park'], [1.6, 'carPark'], [1.2, 'sheds']],
    };
    // and the settings each kind of stadium turns up in
    const HOME = {
        ground: [[5, 'town'], [1, 'park'], [1, 'lots']], bowl: [[3, 'lots'], [2, 'park'], [2, 'campus'], [1, 'town']],
        oval: [[3, 'park'], [3, 'campus'], [1, 'lots'], [1, 'town']], horseshoe: [[3, 'lots'], [3, 'campus'], [1, 'park']],
        cricket: [[3, 'park'], [3, 'town'], [1, 'campus']], bullring: [[5, 'town'], [1, 'park']], ballpark: [[3, 'town'], [3, 'lots'], [1, 'park']],
    };

    function design(p, rng) {
        const yaw = geo.rad(p.yaw), f = [Math.sin(yaw), Math.cos(yaw)];
        // Every menu left on Any takes its pick from the seed. The pick is made either way, so choosing
        // from a menu what the seed had picked gives the same stadium.
        const any = (value, pairs) => {
            const pick = rng.weighted(pairs);
            return value === 'any' ? pick : value;
        };
        const type = any(p.type, [[3.5, 'ground'], [3.5, 'bowl'], [2.2, 'oval'], [1.6, 'horseshoe'], [1.5, 'ballpark'], [1.2, 'cricket'], [1, 'bullring']]);
        const D = { type, edges: [], corners: [], sweep: 0, landmark: 'none', lights: 'none', lightH: 40, press: false, cauldron: false };
        // Nothing here can depend on how many pens there are: the same lines have to come out
        // whatever they're drawn with. Green seats are left to be asked for, they get lost against the grass.
        const hue = rng.pick(Object.keys(COLORS).filter(c => c !== 'green'));
        D.colors = COLORS[p.colors === 'any' ? hue : p.colors];
        const pat = () => any(p.seats, [[3, 'plain'], [2, 'tiers'], [2, 'hoops'], [2, 'stripes'], [1, 'pairs'], [1.5, 'checker'], [1.5, 'chevron'], [1.5, 'blocks'], [1, 'fade'], [2, 'letters']]);
        const seat = () => ({ pat: pat(), band: rng.int(3, 5), seed: rng.int(1, 1e6), swap: rng.chance(0.25), word: rng.pick(WORDS), lay: new Map() });
        const kinds = D.colors.filter(k => k > 0);
        const roofOf = name => {
            if (name === 'none') return null;
            const rf = ROOFS[name](rng);
            // hatched roofs are red like every other roof in these scenes, plain ones stay white
            rf.kind = RED;
            if (rf.tone === undefined) rf.tone = rng.chance(0.45);
            rf.flagKind = kinds.length ? rng.pick(kinds) : GOLD;
            return rf;
        };
        const modern = () => rng.weighted([[2, 'fins'], [2, 'lattice'], [2, 'bands'], [1.5, 'arcade'], [1, 'brick']]);

        const turn = rng.chance(0.5) ? 1 : 0;   // the field runs along y, not x
        const field = D.field = { turn, colors: D.colors, mow: any(p.mow, [[4, 'stripes'], [2, 'checker'], [1.5, 'diagonal'], [0.6, 'plain']]), bands: rng.pick([14, 18, 18, 22]) };
        const rect = (hl, hw) => {
            const hx = turn ? hw : hl, hy = turn ? hl : hw;
            D.half = [hx, hy];
            D.verts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
        };
        const outs = [[0, -1], [1, 0], [0, 1], [-1, 0]], far = e => outs[e][0] * f[0] + outs[e][1] * f[1] > 0;
        const isLong = e => (e % 2 === 0) !== !!turn;
        // unit vectors to the far end and the far side of the field
        D.axis = turn ? [0, 1] : [1, 0];
        D.cross = turn ? [1, 0] : [0, 1];
        D.side = D.cross;
        const sportOf = pairs => (field.sport = any(p.sport, pairs));

        if (type === 'ground') {
            rect(...SPORTS[sportOf([[6, 'football'], [1, 'rugby']])]);
            D.radii = [4, 4, 4, 4];
            D.bay = 7.2;
            const face = rng.weighted([[4, 'brick'], [1, 'bands'], [1, 'arcade']]);
            let gabled = -1;
            for (let e = 0; e < 4; e++) {
                let sort, rname;
                if (far(e) && isLong(e)) { sort = rng.weighted([[3, 'main'], [1, 'double'], [1, 'kop']]); rname = rng.weighted([[3, 'pitched'], [3, 'cantilever'], [1, 'barrel']]); gabled = e; }
                else if (far(e)) { sort = rng.weighted([[3, 'kop'], [2, 'side'], [1, 'main']]); rname = rng.weighted([[3, 'pitched'], [2, 'cantilever'], [1.5, 'barrel'], [1, 'none']]); }
                else if (isLong(e)) { sort = rng.weighted([[3, 'side'], [2, 'small'], [1.5, 'terrace']]); rname = sort === 'terrace' ? 'none' : rng.weighted([[2, 'pitched'], [2, 'cantilever'], [1, 'none']]); }
                else { sort = rng.weighted([[2, 'terrace'], [2, 'small'], [1, 'side']]); rname = sort === 'terrace' ? 'none' : rng.weighted([[2, 'pitched'], [1, 'cantilever'], [2, 'none']]); }
                D.edges.push(makeStand(rng, sort, roofOf(p.roof === 'any' || rname === 'none' ? rname : p.roof), seat(), face, p.size));
            }
            if (gabled >= 0 && D.edges[gabled].roof) D.edges[gabled].roof.gable = rng.chance(0.75);
            // a stand can carry on round a corner into the next one
            for (let c = 0; c < 4; c++) D.corners.push(rng.chance(far((c + 3) % 4) && far(c) ? 0.4 : 0.15) ? D.edges[rng.chance(0.5) ? c : (c + 3) % 4] : null);
            D.lights = any(p.lights, [[5, 'pylons'], [1, 'masts'], [0.6, 'none']]);
            D.lightH = rng.range(38, 50);
            D.score = true;
        } else if (type === 'bowl') {
            rect(...SPORTS[sportOf([[6, 'football'], [2.5, 'gridiron'], [1.5, 'rugby']])]);
            const rc = rng.range(16, 34);
            D.radii = [rc, rc, rc, rc];
            D.bay = 7.8;
            const rf = roofOf(any(p.roof, [[3, 'cantilever'], [2, 'folded'], [2, 'tent'], [1.5, 'barrel'], [1, 'pitched'], [1, 'none']]));
            if (rf) { rf.posts = 0; rf.flags = rng.chance(0.4) ? rng.int(2, 4) : 0; }
            const sp = makeStand(rng, rng.weighted([[1, 'kop'], [3, 'double'], [2, 'triple']]), rf, seat(), modern(), p.size);
            sp.sweep = true;
            D.sweep = rng.chance(0.55) ? rng.range(3, 11) : 0;
            for (let e = 0; e < 4; e++) { D.edges.push(sp); D.corners.push(sp); }
            D.landmark = any(p.landmark, [[5, 'none'], [rf ? 2 : 0, 'arch'], [2, 'towers']]);
            D.lights = any(p.lights, [[rf ? 4 : 0, 'rim'], [D.landmark === 'towers' ? 0 : 2, 'pylons'], [2, 'masts'], [0.5, 'none']]);
            D.lightH = section(sp, D.sweep).wall + rng.range(18, 26);
            D.score = true;
        } else if (type === 'oval') {
            field.sport = 'athletics';
            rect(91.5, 49.3);
            const rc = rng.chance(0.6) ? 49.3 : rng.range(30, 42);
            D.radii = [rc, rc, rc, rc];
            D.bay = 8;
            const plan = rng.weighted([[3, 'ring'], [3, 'main'], [2, 'sides']]), face = modern();
            const rname = any(p.roof, [[3, 'cantilever'], [2, 'tent'], [1.5, 'folded'], [1, 'barrel'], [plan === 'ring' ? 3 : 0, 'none']]);
            if (plan === 'ring') {
                const rf = roofOf(rname);
                if (rf) rf.posts = 0;
                const sp = makeStand(rng, rng.weighted([[2, 'side'], [2, 'kop'], [2, 'double']]), rf, seat(), face, p.size);
                sp.sweep = true;
                D.sweep = rng.chance(0.6) ? rng.range(4, 12) : 0;
                for (let e = 0; e < 4; e++) { D.edges.push(sp); D.corners.push(sp); }
            } else {
                // a low bank all the way round, with a grandstand along one straight or both
                const low = makeStand(rng, rng.weighted([[2, 'terrace'], [2, 'small']]), null, seat(), face, p.size);
                const rf = roofOf(rname === 'none' ? 'cantilever' : rname);
                rf.posts = 0;
                const big = makeStand(rng, rng.weighted([[2, 'double'], [1, 'kop'], [1, 'main']]), rf, seat(), face, p.size);
                // the same lower tier, so the grandstand rises out of the bank
                big.front = low.front;
                for (let e = 0; e < 4; e++) { D.edges.push(isLong(e) && (far(e) || plan === 'sides') ? big : low); D.corners.push(low); }
            }
            D.lights = any(p.lights, [[3, 'masts'], [3, 'pylons'], [D.edges[0].roof ? 2 : 0, 'rim']]);
            D.lightH = rng.range(42, 54);
            D.cauldron = rng.chance(0.6);
            D.score = !D.cauldron;
            D.flags = rng.chance(0.6);
        } else if (type === 'horseshoe') {
            rect(...SPORTS[sportOf([[4, 'gridiron'], [1, 'football']])]);
            const open = [0, 1, 2, 3].find(e => !far(e) && !isLong(e)), rc = rng.range(20, 32);
            // corner c lies between edge c - 1 and edge c
            D.radii = [0, 1, 2, 3].map(c => (c === open || c === (open + 1) % 4 ? 4 : rc));
            D.bay = 7.8;
            const rf = roofOf(any(p.roof, [[5, 'none'], [1, 'cantilever']]));
            if (rf) rf.posts = 0;
            const sp = makeStand(rng, rng.weighted([[3, 'huge'], [2, 'kop'], [2, 'double']]), rf, seat(), rng.weighted([[3, 'arcade'], [2, 'brick'], [1, 'fins']]), p.size);
            sp.sweep = true;
            D.sweep = rng.chance(0.5) ? rng.range(3, 9) : 0;
            const closeIt = rng.chance(0.35) ? makeStand(rng, 'terrace', null, seat(), sp.face, p.size) : null;
            for (let e = 0; e < 4; e++) {
                D.edges.push(e === open ? closeIt : sp);
                D.corners.push(e === open || e === (open + 1) % 4 ? null : sp);
            }
            D.lights = any(p.lights, [[4, 'masts'], [2, 'pylons'], [0.5, 'none']]);
            D.lightH = section(sp, D.sweep).wall + rng.range(18, 26);
            D.press = !rf && rng.chance(0.75);
            D.score = true;
        } else if (type === 'cricket') {
            field.sport = 'cricket';
            field.r = rng.range(64, 72);
            const Rb = field.r + 4.5, rv = Rb / Math.cos(Math.PI / 8), a0 = Math.atan2(f[1], f[0]);
            // eight arcs, the first facing the camera from the far side
            D.verts = Array.from({ length: 8 }, (_, i) => [rv * Math.cos(a0 + (TAU * i) / 8), rv * Math.sin(a0 + (TAU * i) / 8)]);
            D.radii = D.verts.map(() => Rb);
            D.half = [Rb, Rb];
            D.bay = 7.5;
            D.axis = f;
            D.cross = [-f[1], f[0]];
            field.frame = a0;
            const face = rng.weighted([[3, 'brick'], [1, 'bands'], [1, 'arcade']]);
            for (let c = 0; c < 8; c++) {
                const back = Math.min(c, 8 - c);   // 0 at the far side, 4 nearest
                let sort, rname;
                if (back === 0) { sort = 'main'; rname = 'pitched'; }
                else if (back === 1) { sort = rng.weighted([[2, 'side'], [2, 'double'], [1, 'small']]); rname = rng.weighted([[2, 'cantilever'], [1, 'pitched'], [1, 'barrel'], [1, 'none']]); }
                else if (back === 2) { sort = rng.weighted([[2, 'small'], [2, 'side'], [1, 'terrace']]); rname = sort === 'terrace' ? 'none' : rng.weighted([[1, 'cantilever'], [1, 'pitched'], [2, 'none']]); }
                else { sort = rng.weighted([[2, 'bank'], [2, 'terrace'], [1, 'small']]); rname = 'none'; }
                const rf = roofOf(rname);
                if (rf && back) rf.posts = rf.type === 'pitched' ? 2 : 0;
                if (rf && !back) rf.gable = true;
                D.corners.push(makeStand(rng, sort, rf, seat(), face, p.size));
            }
            D.lights = any(p.lights, [[5, 'masts'], [1, 'pylons'], [0.5, 'none']]);
            D.lightH = rng.range(48, 60);
            D.lightEvery = 2;
            D.score = true;
            D.scoreAt = [Math.cos(a0 + TAU / 8), Math.sin(a0 + TAU / 8)];
        } else if (type === 'ballpark') {
            field.sport = 'baseball';
            // home plate in the near corner or the far one, the foul lines along x and y
            const s = rng.chance(0.5) ? 1 : -1, c = 45, pole = rng.range(96, 103), deep = rng.range(84, 90);
            const wing0 = -14 + (9 * 72) / (pole + 18);
            const local = [[-14, -14], [58, wing0], [pole + 4, -5], [pole + 7, 38], [deep, deep], [38, pole + 7], [-5, pole + 4], [wing0, 58]];
            D.verts = local.map(([a, b]) => [s * (a - c), s * (b - c)]);
            D.radii = [20, 0, 10, 45, 55, 45, 10, 0];
            D.half = [70, 70];
            D.bay = 7.5;
            field.home = [-s * c, -s * c, s > 0 ? 0 : 2];
            field.poly = local;
            field.pole = pole;
            field.span = pole + 12;
            D.axis = [f[1], -f[0]];
            D.cross = f;
            const face = rng.weighted([[3, 'brick'], [2, 'arcade'], [1, 'bands'], [1, 'fins']]);
            const rf = roofOf(any(p.roof, [[4, 'cantilever'], [1, 'barrel'], [1, 'pitched'], [1.5, 'none']]));
            if (rf) Object.assign(rf, { cover: rng.range(0.35, 0.6), posts: rf.type === 'pitched' ? 2 : 0 });
            // the grandstand wraps round behind home, lower stands run on down the lines and bleachers stand in the outfield
            const main = makeStand(rng, rng.weighted([[3, 'double'], [2, 'triple'], [1, 'main']]), rf, seat(), face, p.size);
            const wing = () => makeStand(rng, rng.weighted([[2, 'side'], [2, 'small'], [1, 'kop']]), null, seat(), face, p.size);
            // where there are no bleachers the outfield still has its wall
            const wall = makeStand(rng, 'fence', null, seat(), face, p.size);
            const out = () => (rng.chance(0.7) ? makeStand(rng, rng.weighted([[2, 'small'], [2, 'terrace'], [1, 'side']]), null, seat(), face, p.size) : wall);
            const w1 = wing(), w3 = rng.chance(0.6) ? w1 : wing(), o1 = out(), o2 = out(), o3 = rng.chance(0.5) ? o1 : out();
            D.edges = [main, w1, o1, o2, o2, o3, w3, main];
            D.corners = [main, null, rng.chance(0.5) ? w1 : wall, o1, o2, o3, rng.chance(0.5) ? w3 : wall, null];
            D.lights = any(p.lights, [[5, 'pylons'], [2, 'masts']]);
            D.lightAt = [2, 3, 5, 6];
            D.lightH = rng.range(40, 50);
            D.score = true;
            D.scoreAt = f;
        } else {
            field.sport = 'bullring';
            field.r = rng.range(24, 28);
            const Rb = field.r + 2.4;
            D.verts = [[-Rb, -Rb], [Rb, -Rb], [Rb, Rb], [-Rb, Rb]];
            D.radii = [Rb, Rb, Rb, Rb];
            D.half = [Rb, Rb];
            D.bay = 6;
            // the covered gallery round the top, under a tiled roof on posts
            const rf = roofOf('pitched');
            Object.assign(rf, { cover: 0.34, posts: 1, clear: 3.2, ridge: 0.5, peak: rng.range(1.6, 2.4), flags: rng.chance(0.7) ? 3 : 0 });
            const sp = makeStand(rng, 'plaza', rf, { pat: 'sun', band: 3, seed: 1, swap: false }, rng.weighted([[4, 'arcade'], [1, 'brick']]), p.size);
            for (let c = 0; c < 4; c++) D.corners.push(sp);
            D.colors = COLORS[p.colors === 'any' ? 'bluegold' : p.colors];
            field.colors = D.colors;
            D.reach = section(sp, 0).depth;
            D.lights = any(p.lights, [[3, 'none'], [1, 'masts']]);
            D.lightH = section(sp, 0).wall + 14;
        }
        if (D.landmark === 'arch' && (D.lights === 'pylons' || D.lights === 'masts')) D.lights = 'rim';
        if (D.lights === 'rim') for (const sp of D.edges.concat(D.corners)) if (sp && sp.roof) sp.roof.lamps = true;
        if (!D.reach) D.reach = Math.max(...D.edges.concat(D.corners).filter(Boolean).map(sp => section(sp, sp.sweep ? D.sweep : 0).depth));
        D.score = D.score && rng.chance(0.85) ? [rng.int(0, 4), rng.int(0, 3)] : null;
        D.apron = rng.range(16, 24);
        D.street = 10;
        D.block = p.block;
        D.uses = SETTINGS[any(p.setting, HOME[type])];
        D.blimp = p.blimp ? { at: rng.chance(0.5) ? 0.2 : 0.8, turn: rng.range(-25, 25) } : null;
        return D;
    }

    // Camera scale and center that fit the stadium on the page
    function fitCamera(p, pts, W, H) {
        const cam = makeCamera(p.yaw, p.elev, 1, 0, 0, 0, 0);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y, z] of pts) {
            const [sx, sy] = cam.project(x, y, z);
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const k = p.zoom * Math.min((W * 0.92) / (x1 - x0), (H * 0.8) / (y1 - y0));
        const u = (x0 + x1) / 2, v = -(y0 + y1) / 2 / cam.se;
        return { k, cx: u * cam.rx + v * cam.fx, cy: u * cam.ry + v * cam.fy };
    }

    // Where each light, tower and landmark stands, worked out before the
    // camera is fitted so they all end up on the page
    function fittings(D) {
        const R = D.ring, out = { lights: [], towers: [], keep: [], tall: [], arch: null };
        const cut = i => (D.bays[i] ? section(D.bays[i], D.bays[i].sweep ? R.ext[i] : 0) : null);
        // the station that looks most squarely along `dir`
        const facing = dir => {
            let best = 0, bv = -Infinity;
            R.st.forEach((s, i) => {
                const v = s.nx * dir[0] + s.ny * dir[1] - 1e-3 * Math.abs(s.x * dir[1] - s.y * dir[0]);
                if (v > bv) { bv = v; best = i; }
            });
            return best;
        };
        Object.assign(out, { cut, facing });
        R.pieces.forEach(pc => {
            if (!pc.arc || (D.lightEvery && pc.corner % D.lightEvery !== 1) || (D.lightAt && !D.lightAt.includes(pc.corner))) return;
            const i = pc.first + (pc.count >> 1), c = cut(i);
            if (D.landmark === 'towers' && c) {
                // clear of the roof's overhang
                const [x, y] = R.pt(i, c.depth + 9);
                out.towers.push({ x, y, h: c.wall + 4 });
            } else if (D.lights === 'pylons' || D.lights === 'masts') {
                const [x, y] = R.pt(i, c ? c.depth + (D.lights === 'pylons' ? 6 : 3.5) : 12);
                out.lights.push({ x, y, h: D.lightH });
            }
        });
        // whatever stands on top of the far end, and the press box along the far side
        out.end = facing(D.scoreAt || D.axis);
        out.side = facing(D.cross);
        const cEnd = cut(out.end), cSide = cut(out.side);
        if (cEnd && (D.score || D.cauldron)) out.tall.push(R.pt(out.end, cEnd.depth, cEnd.wall + 14));
        if (D.landmark === 'arch' && cSide) {
            const mid = R.pt(out.side, cSide.depth * 0.75), a = D.axis;
            const half = Math.abs(D.half[0] * a[0]) + Math.abs(D.half[1] * a[1]) + cSide.depth + 14;
            out.arch = { half, h: half * 0.62, lean: [-D.cross[0] * 14, -D.cross[1] * 14], p0: [mid[0] - a[0] * half, mid[1] - a[1] * half, 0], p1: [mid[0] + a[0] * half, mid[1] + a[1] * half, 0] };
            out.tall.push([mid[0] + out.arch.lean[0], mid[1] + out.arch.lean[1], out.arch.h + 2], out.arch.p0, out.arch.p1);
            out.keep.push([out.arch.p0[0], out.arch.p0[1], 5], [out.arch.p1[0], out.arch.p1[1], 5]);
        }
        return out;
    }

    function build(T, D, fit, seed) {
        const { S, cam, p } = T, R = D.ring, { cut } = fit, fd = D.field;
        S.shadowGroup(0, null, Math.atan2(cam.ry, cam.rx));
        const F = fd.home ? frame(fd.home[0], fd.home[1], 0, fd.home[2]) : fd.frame !== undefined ? kit.turned(0, 0, 0, fd.frame) : frame(0, 0, 0, fd.turn ? 1 : 0);
        // the dugouts go on the far side
        const v = F.V(0, 1, 0);
        fd.bench = v[0] * D.cross[0] + v[1] * D.cross[1] > 0 ? 1 : -1;
        ({ football, rugby, gridiron, athletics, cricket, bullring, baseball })[fd.sport](T, F, fd, p.players ? new PG.RNG(hash(seed, 7)) : null);
        if (p.around) surround(T, D, fit, seed);

        const made = runs(R, i => D.bays[i]).map(run => stand(T, R, run));
        // the ends of each stretch of stand
        for (const st of made) {
            if (st.run.closed) continue;
            const { run, cuts } = st, i1 = (run.i0 + run.n) % R.n;
            const before = made.find(o => (o.run.i0 + o.run.n) % R.n === run.i0 % R.n), after = made.find(o => o.run.i0 % R.n === i1);
            if (!before) standEnd(T, R, run.i0, null, cuts[0]);
            standEnd(T, R, i1, cuts[run.n], after ? after.cuts[0] : null);
        }
        for (const st of made) {
            seats(T, R, st);
            facade(T, R, st);
            trim(T, R, st, [...new Set(D.colors.concat([GOLD, RED, BLUE]).filter(k => k > 0))]);
        }
        const tops = runs(R, i => (D.bays[i] ? D.bays[i].roof : null)).map(run => roof(T, R, run));
        // flags of all nations round the rim of the open stands, leaving room for the flame
        if (D.flags) {
            const hues = [RED, BLUE, GOLD, GREEN];
            for (let i = 0; i < R.n; i += 2) {
                const c = cut(i), gap = Math.abs(i - fit.end);
                if (!c || D.bays[i].roof || Math.min(gap, R.n - gap) < 2) continue;
                const [x, y] = R.pt(i, c.depth - 0.25);
                flag(T, x, y, c.wall, 5, hues[(i >> 1) % 4]);
            }
        }
        const aim = (x, y) => unit([-x, -y, 0]);
        for (const l of fit.lights) (D.lights === 'pylons' ? pylon : mast)(T, l.x, l.y, l.h, aim(l.x, l.y));
        for (const t of fit.towers) {
            rampTower(T, t.x, t.y, 6.4, t.h);
            if (D.lights !== 'none' && D.lights !== 'rim') lampHead(T, t.x, t.y, t.h + 1.4, aim(t.x, t.y), 8, 5);
        }
        // whatever stands on top of the far end: the scoreboard or the flame
        const iEnd = fit.end, cEnd = cut(iEnd);
        if (cEnd) {
            const sp = D.bays[iEnd], o = R.s(iEnd), [x, y] = R.pt(iEnd, cEnd.depth - 1.5);
            const z = cEnd.wall + (sp.roof ? sp.roof.thick : 0), up = sp.roof ? (sp.roof.type === 'folded' ? sp.roof.peak : 0) + 1.5 : 0.6;
            if (D.score) scoreboard(T, x, y, z, [-o.nx, -o.ny], 20, 9, up, D.score);
            else if (D.cauldron) cauldron(T, x, y, z, 11);
        }
        // press box along the top of the far side
        const iSide = fit.side, cSide = cut(iSide);
        if (D.press && cSide) {
            const o = R.s(iSide), [x, y] = R.pt(iSide, cSide.depth - 2.4);
            pressBox(T, x, y, cSide.wall, [-o.nx, -o.ny], 44);
        }
        // an arch over the far side, with cables down to the front of its roof
        if (fit.arch) {
            const { half, h, lean, p0, p1 } = fit.arch, a = D.axis;
            // no shadow from it: a dark stripe across the pitch reads as a mistake
            const keep = S.shadow;
            S.shadow = null;
            const at = greatArch(T, p0, p1, h, lean, 1.9);
            S.kind = INK;
            for (const top of tops) {
                for (let b = 0; b <= top.run.n; b++) {
                    const s = R.s(top.run.i0 + b), rib = top.ribs[b * top.per];
                    if (s.nx * D.cross[0] + s.ny * D.cross[1] < 0.98 || !rib) continue;
                    S.line([at(0.5 + (0.48 * (s.x * a[0] + s.y * a[1])) / half), rib[1]]);
                }
            }
            S.shadow = keep;
        }
        if (D.blimp) {
            // over one of the top corners of the page, its shadow on the streets below
            const z = 75, [x, y] = cam.ground(S.W * D.blimp.at, S.H * 0.1, z), a = geo.rad(p.yaw + D.blimp.turn);
            blimp(T, x, y, z, [Math.cos(a), -Math.sin(a)], Math.min(46, 62 / T.k), D.colors[0]);
        }
        for (const job of T.later) job();
        if (p.shadows) {
            S.kind = BLUE;
            S.hatchShadows(p.shadowGap);
        }
    }

    PG.register({
        id: 'stadium',
        name: 'Stadium',
        category: 'Scenes',
        description: 'A stadium seen whole from above with the streets round it: an old ground, a bowl, a running track, a horseshoe, a ballpark, a cricket ground or a bullring, in isometric ink.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'zoom', label: 'Zoom', type: 'range', min: 0.6, max: 2, step: 0.01, value: 1, random: false,
                hint: 'At 1 the whole stadium just fits on the page. More crops in on it' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 30, max: 60, step: 0.5, value: 45, random: false,
                hint: '35.3 is true isometric. Higher shows more of the pitch over the near stands' },
            { type: 'section', label: 'Stadium' },
            { id: 'type', label: 'Kind', type: 'select', value: 'any', random: false, hint: 'Any picks one from the seed',
                options: [['any', 'Any'], ['ground', 'Old ground'], ['bowl', 'Bowl'], ['oval', 'Athletics'], ['horseshoe', 'Horseshoe'], ['ballpark', 'Ballpark'],
                    ['cricket', 'Cricket ground'], ['bullring', 'Bullring']] },
            { id: 'sport', label: 'Sport', type: 'select', value: 'any', random: false, show: p => ['any', 'ground', 'bowl', 'horseshoe'].includes(p.type),
                hint: 'For an old ground, a bowl or a horseshoe. The others are built for one sport',
                options: [['any', 'Any'], ['football', 'Football'], ['rugby', 'Rugby'], ['gridiron', 'American football']] },
            { id: 'size', label: 'Stand size', type: 'range', min: 0.7, max: 1.4, step: 0.01, value: 1, random: [0.85, 1.2],
                hint: 'How deep the stands are. Deeper ones are taller too' },
            { id: 'roof', label: 'Roof', type: 'select', value: 'any', random: false, show: p => p.type !== 'cricket' && p.type !== 'bullring',
                hint: 'Stands that never have a roof, like an open terrace, stay open',
                options: [['any', 'Any'], ['none', 'Open'], ['cantilever', 'Cantilever'], ['pitched', 'Pitched'], ['barrel', 'Barrel'], ['folded', 'Folded'], ['tent', 'Tents']] },
            { id: 'lights', label: 'Floodlights', type: 'select', value: 'any', random: false,
                options: [['any', 'Any'], ['pylons', 'Corner pylons'], ['masts', 'Masts'], ['rim', 'Along the roof'], ['none', 'None']] },
            { id: 'landmark', label: 'Landmark', type: 'select', value: 'any', random: false, show: p => p.type === 'any' || p.type === 'bowl',
                hint: 'On a bowl: an arch over the far side with cables down to its roof, or a ramp tower at each corner',
                options: [['any', 'Any'], ['none', 'None'], ['arch', 'Arch'], ['towers', 'Ramp towers']] },
            { id: 'colors', label: 'Club colors', type: 'select', value: 'any', random: false,
                hint: 'The seats, the boards round the pitch and the home kit. With few pens some colors share one',
                options: [['any', 'Any'], ['red', 'Red & white'], ['redblue', 'Red & blue'], ['blue', 'Blue & white'], ['bluegold', 'Blue & gold'], ['redgold', 'Red & gold'],
                    ['gold', 'Gold & black'], ['redblack', 'Red & black'], ['bluered', 'Blue & red'], ['green', 'Green & gold']] },
            { id: 'seats', label: 'Seat pattern', type: 'select', value: 'any', random: false, show: p => p.type !== 'bullring',
                hint: 'Lettering spells a word along the stands that face the camera',
                options: [['any', 'Any'], ['plain', 'Plain'], ['tiers', 'By tier'], ['hoops', 'Hoops'], ['stripes', 'Stripes'], ['pairs', 'Wide stripes'], ['checker', 'Checks'], ['chevron', 'Chevrons'],
                    ['blocks', 'Odd blocks'], ['fade', 'Fade'], ['letters', 'Lettering']] },
            { id: 'players', label: 'Match on', type: 'checkbox', value: true, hint: 'The teams and officials out on the field' },
            { id: 'blimp', label: 'Airship', type: 'checkbox', value: false, random: 0.3 },
            { type: 'section', label: 'Round about' },
            { id: 'around', label: 'Streets round it', type: 'checkbox', value: true },
            { id: 'setting', label: 'Setting', type: 'select', value: 'any', random: false, show: p => p.around,
                options: [['any', 'Any'], ['town', 'Terraced streets'], ['park', 'Parkland'], ['lots', 'Car parks'], ['campus', 'Sports grounds']] },
            { id: 'block', label: 'Block size (m)', type: 'range', min: 40, max: 110, step: 1, value: 64, random: [52, 84], show: p => p.around },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.3, 0.9], show: p => p.around },
            { id: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9], show: p => p.around },
            { id: 'cars', label: 'Cars', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.25, 0.85], show: p => p.around },
            { type: 'section', label: 'Shading' },
            { id: 'rowGap', label: 'Seat row spacing (mm)', type: 'range', min: 0.6, max: 3, step: 0.05, value: 1, random: false,
                hint: 'Between rows of seats on paper. Stands seen from behind drop rows to keep to it' },
            { id: 'grass', label: 'Mown stripes', type: 'checkbox', value: true },
            { id: 'mow', label: 'Mowing', type: 'select', value: 'any', random: false, show: p => p.grass && p.type !== 'bullring',
                options: [['any', 'Any'], ['stripes', 'Stripes'], ['checker', 'Checks'], ['diagonal', 'Diagonal'], ['plain', 'Plain']] },
            { id: 'grassGap', label: 'Grass hatch spacing (mm)', type: 'range', min: 0.6, max: 4, step: 0.05, value: 1, random: false, show: p => p.grass },
            { id: 'roofHatch', label: 'Roof hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Roof hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false,
                show: p => p.roofHatch, hint: 'Shaded slopes are hatched a little closer' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 52, random: [44, 60],
                show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false,
                show: p => p.shadows },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        generate(p, ctx) {
            const { width: W, height: H } = ctx, seed = ctx.seed | 0;
            const D = design(p, new PG.RNG(hash(seed, 1)));
            const R = D.ring = new Ring(outline(D.verts, D.radii), D.bay, D.reach);
            D.bays = R.st.map(s => { const pc = R.pieces[s.piece]; return pc.arc ? D.corners[pc.corner] : D.edges[pc.edge]; });
            // the rim sweeps up along the sides and down round the ends
            R.st.forEach((s, i) => {
                const side = Math.abs(s.nx * D.side[0] + s.ny * D.side[1]), along = Math.abs(s.x * D.side[1] + s.y * D.side[0]) / Math.max(D.half[0], D.half[1]);
                R.ext[i] = D.sweep * side * side * (1 - 0.45 * along * along);
            });
            const fit = fittings(D), pts = [];
            for (let i = 0; i < R.n; i++) {
                const sp = D.bays[i];
                pts.push(R.pt(i, 0, 0));
                if (!sp) continue;
                const c = section(sp, sp.sweep ? R.ext[i] : 0);
                pts.push(R.pt(i, c.depth, 0), R.pt(i, c.depth, c.wall));
                if (sp.roof) for (const [d, z] of roofCut(sp.roof, c, section(sp, 0).rows, 1)) pts.push(R.pt(i, d, z + (sp.roof.flags ? 4.5 : 0)));
            }
            for (const l of fit.lights) pts.push([l.x, l.y, l.h * 1.14], [l.x, l.y, 0]);
            for (const t of fit.towers) pts.push([t.x, t.y, t.h + 7], [t.x, t.y, 0]);
            for (const q of fit.tall) pts.push(q);
            const view = fitCamera(p, pts, W, H), k = view.k;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, view.cx, view.cy);
            const S = new Scene(cam, W, H);
            const cot = 1 / Math.tan(geo.rad(p.sun));
            const sun = [cot * Math.cos(SUN_TURN), -cot * Math.sin(SUN_TURN)];
            if (p.shadows) S.sun = sun;
            const toSun = unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k,
                detail: true,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: GOLD } : null,
                waterKind: GLASS,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.85,
                later: [],
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
            };
            // rows as close as the most open view of a rake allows
            let q = 0;
            for (let i = 0; i < R.n; i++) {
                const sp = D.bays[i];
                if (!sp) continue;
                const o = R.out(i);
                for (const t of sp.tiers) if (T.sees([-o[0] * t.rake, -o[1] * t.rake, 1])) q = Math.max(q, apart(T, R.run(i), [o[0], o[1], t.rake]));
            }
            T.rowStep = Math.max(0.8, p.rowGap / (q || 1));
            T.seat = (st, tier, b, c, cols, row, rows) => {
                const sp = st.sp, i = (st.run.i0 + b) % R.n, pc = R.pieces[R.s(i).piece], bay = (i - pc.first + R.n) % R.n, o = R.out(i);
                const q = { tier, row, rows, bay, col: bay * cols + c, cols: pc.count * cols, band: sp.seat.band, seed: sp.seat.seed, shade: o[0] * sun[0] + o[1] * sun[1] < 0, letter: 0 };
                if (sp.seat.pat === 'letters') {
                    // a word along a straight stand that faces the camera, set out once for each tier of it
                    const key = pc.first * 8 + tier, t = R.run(i), rake = sp.tiers[tier].rake;
                    if (!sp.seat.lay.has(key)) {
                        const wide = (R.width(i, 0) / cols) * k * Math.hypot(t[0] * cam.rx + t[1] * cam.ry, (t[0] * cam.fx + t[1] * cam.fy) * cam.se);
                        const up = (o[0] * cam.fx + o[1] * cam.fy) * cam.se + rake * cam.ce > 0.2;
                        sp.seat.lay.set(key, !pc.arc && up ? lettering(sp.seat.word, q.cols, rows, wide / (T.rowStep * apart(T, t, [o[0], o[1], rake]))) : null);
                    }
                    const lay = sp.seat.lay.get(key);
                    // going round the field runs right to left across the far side of the page
                    if (lay) q.letter = inLetter(lay, t[0] * cam.rx + t[1] * cam.ry < 0 ? q.cols - 1 - q.col : q.col, row);
                }
                const which = PATTERNS[sp.seat.pat](q);
                // swapping the colors round would empty a stand whose second color is no seats at all
                return D.colors[sp.seat.swap && D.colors[1] >= 0 ? 1 - which : which];
            };
            build(T, D, fit, seed);
            return PG.pens.renderScene('stadium', S, p);
        },
    });
})();
