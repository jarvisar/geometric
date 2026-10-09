/*
 * Castle Town: a walled town standing in its moat, drawn whole with the
 * fields round it, in the same isometric scene as Harbor (lib/iso.js) and
 * shaded the same way.
 *
 * Everything is planned in meters first and the camera is fitted round the
 * moat afterwards. The wall follows a rectangle with some corners cut off,
 * so every stretch of it is square to the streets or at 45 degrees. Round
 * towers stand at the corners and along the walls, the gatehouses face the
 * camera, and the castle takes the back corner so its keep has the whole
 * town in front of it. Inside, the streets are a grid like a planned bastide
 * town: the gate streets meet at the market square, the church has a block
 * next to it, and the other blocks are rows of narrow houses round a yard.
 * Outside there are roads out of the gates with cottages along them, a
 * patchwork of fields and woods, a post mill and a tournament.
 *
 * Round towers are lathes and frustums, curtain walls are prisms and the
 * battlements are rows of small boxes. The church, market hall and terraces
 * come from isokit. The moat is Harbor's water: the walls throw their
 * shadows onto it and ripple lines follow the banks.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, Scene, segments } = PG.iso;
    const kit = PG.isokit;
    const {
        FLOOR, wall, pane, door, windows, gableRoof, hipRoof, chimney, dormer, inKind, withKind, outward, shade,
        shadeGable, shadeRound, awning, marketHall, terrace, church, cart, fountain, arch, gableWall, stepGable,
        Occupancy, turned, bridgeRamp,
    } = kit;

    // Line kinds. With fewer pens the last ones share a pen (see pens.js).
    const INK = 0, RED = 1, BLUE = 2, GOLD = 3, GREEN = 4, FIGURE = 5, WATER = 6, WOOD = 7;
    const person = withKind(FIGURE, kit.person);
    const tree = withKind(GREEN, kit.roundTree), fir = withKind(GREEN, kit.conifer);
    const LAND = 1.8;             // the town and the fields stand this high above the moat (m)
    const WALL = 2.6;             // curtain wall thickness
    const LANE = 4;               // lane round the inside of the walls
    const SUN_TURN = geo.rad(65); // as Harbor, shadows fall along +x turned this far towards -y

    // ------------------------------------------------------------------
    // Flat geometry. Polygons run anticlockwise, x right and y up.
    // ------------------------------------------------------------------

    const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const at3 = (pts, z) => pts.map(([x, y]) => [x, y, z]);
    const inRect = (r, x, y, m = 0) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;

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

    // Every edge of a convex polygon moved out by d
    function offset(poly, d) {
        const n = poly.length;
        const lines = poly.map((a, i) => {
            const b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
            return [[a[0] + nx * d, a[1] + ny * d], [b[0] - a[0], b[1] - a[1]]];
        });
        return lines.map((l, i) => {
            const m = lines[(i + n - 1) % n], X = geo.lineIntersect(m[0], m[1], l[0], l[1]);
            return X ? [X.x, X.y] : l[0];
        });
    }

    // Distance in from the edges of a convex polygon, negative outside
    function depth(poly, x, y) {
        let d = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
            const L = Math.hypot(ex, ey);
            if (L > 1e-9) d = Math.min(d, (ex * (y - a[1]) - ey * (x - a[0])) / L);
        }
        return d;
    }

    // Distance to a convex polygon from a point outside it
    function distOut(poly, x, y) {
        let d = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
            const t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
            d = Math.min(d, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t));
        }
        return d;
    }

    // The part of convex polygon P inside convex polygon Q
    function clipConvex(P, Q) {
        let out = P;
        for (let i = 0; i < Q.length && out.length >= 3; i++) {
            const a = Q[i], b = Q[(i + 1) % Q.length];
            out = geo.clipPolygonHalfPlane(out, a, [a[1] - b[1], b[0] - a[0]]);
        }
        return out.length >= 3 ? out : [];
    }

    // The parts of convex polygon P outside convex polygon Q, as convex pieces
    function minusConvex(P, Q) {
        const out = [];
        let rest = P;
        for (let i = 0; i < Q.length && rest.length >= 3; i++) {
            const a = Q[i], b = Q[(i + 1) % Q.length], n = [a[1] - b[1], b[0] - a[0]];
            const piece = geo.clipPolygonHalfPlane(rest, a, [-n[0], -n[1]]);
            if (piece.length >= 3) out.push(piece);
            rest = geo.clipPolygonHalfPlane(rest, a, n);
        }
        return out;
    }

    // Do two convex polygons overlap? (separating axes)
    function overlap(P, Q) {
        for (const R of [P, Q]) {
            for (let i = 0; i < R.length; i++) {
                const a = R[i], b = R[(i + 1) % R.length], nx = a[1] - b[1], ny = b[0] - a[0];
                let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
                for (const [x, y] of P) { const v = x * nx + y * ny; p0 = Math.min(p0, v); p1 = Math.max(p1, v); }
                for (const [x, y] of Q) { const v = x * nx + y * ny; q0 = Math.min(q0, v); q1 = Math.max(q1, v); }
                if (p1 < q0 || q1 < p0) return false;
            }
        }
        return true;
    }

    // Street lines across [lo, hi] as [center, width]: the ones given, and more
    // between them so no block is much longer than `size`. `jitter` shifts the
    // added ones, so neighboring columns of blocks don't have to line up.
    function streetLines(mains, lo, hi, size, sw, rng, jitter) {
        const keep = mains.filter(([c]) => c > lo + 6 && c < hi - 6).sort((u, v) => u[0] - v[0]);
        const all = [[lo, 0], ...keep, [hi, 0]], out = [];
        for (let i = 0; i + 1 < all.length; i++) {
            out.push(all[i]);
            const [c0, w0] = all[i], [c1, w1] = all[i + 1];
            const span = c1 - w1 / 2 - (c0 + w0 / 2), n = Math.max(1, Math.round((span + sw) / (size + sw) + 0.2));
            const step = (span + sw) / n;
            for (let k = 1; k < n; k++) out.push([c0 + w0 / 2 + step * k - sw / 2 + rng.range(-1, 1) * jitter * step * 0.2, sw]);
        }
        out.push(all[all.length - 1]);
        return out;
    }

    // ------------------------------------------------------------------
    // The plan: walls, towers, gates, the castle and the street grid, in meters
    // ------------------------------------------------------------------

    function plan(p, rng) {
        const t = WALL, sw = p.street, main = p.street + 2;
        const asp = rng.range(0.9, 1.1), A = (p.size / 2) * asp, B = p.size / 2 / asp, m = Math.min(A, B);
        // cut corners, leaving every wall long enough for a gate or a couple of towers
        const cut = () => {
            const v = rng.chance(0.85) ? Math.min(m - 24, p.corners * m * rng.range(0.4, 0.75)) : 0;
            return v < 5 ? 0 : v;
        };
        // the back corner stays square for the castle
        const c = [cut(), cut(), p.castle ? 0 : cut(), cut()];
        const raw = [[-A + c[0], -B], [A - c[1], -B], [A, -B + c[1]], [A, B - c[2]], [A - c[2], B], [-A + c[3], B], [-A, B - c[3]], [-A, -B + c[0]]];
        const poly = raw.filter((q, i) => {
            const r = raw[(i + 1) % raw.length];
            return Math.hypot(q[0] - r[0], q[1] - r[1]) > 0.5;
        });
        const edge = (a, b) => {
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
            // the frame has u along the wall and v pointing in
            return { a, b, len, d, n: [d[1], -d[0]], F: turned(a[0], a[1], 0, Math.atan2(d[1], d[0])), stops: [] };
        };
        const edges = poly.map((a, i) => edge(a, poly[(i + 1) % poly.length]));
        const facing = (nx, ny) => edges.find(e => Math.abs(e.n[0] - nx) + Math.abs(e.n[1] - ny) < 1e-6);
        const front = facing(0, -1), left = facing(-1, 0), back = facing(0, 1), right = facing(1, 0);
        const inner = geo.insetConvex(poly, t / 2 + LANE);
        const [qx0, qy0, qx1, qy1] = bounds(inner);
        const H = LAND + p.wallHeight;

        let castle = null;
        if (p.castle) {
            const tc = 2.8;
            const ww = geo.clamp(2 * A * rng.range(0.36, 0.42), 26, 40), wd = geo.clamp(2 * B * rng.range(0.36, 0.42), 26, 40);
            const xc = A - t / 2 - ww - tc / 2, yc = B - t / 2 - wd - tc / 2;
            const ward = [xc + tc / 2, yc + tc / 2, A - t / 2, B - t / 2];
            castle = { tc, xc, yc, ward, H: H + 2.2, gx: (xc + A) / 2 + rng.range(-2.5, 2.5) };
            // the castle's own walls meet the town wall at towers
            castle.joins = [{ s: back.a[0] - xc, kind: 'join', r: 3.7 }, { s: yc - right.a[1], kind: 'join', r: 3.7 }];
            back.stops.push(castle.joins[0]);
            right.stops.push(castle.joins[1]);
            // the keep stands back in the ward, leaving the yard inside the gate open
            const kw = rng.range(11, 13), [wx0, wy0, wx1, wy1] = ward;
            const kx = geo.clamp(wx0 + (wx1 - wx0) * rng.range(0.56, 0.66), wx0 + kw / 2 + 4, wx1 - kw / 2 - 3);
            const ky = geo.clamp(wy0 + (wy1 - wy0) * rng.range(0.56, 0.64), wy0 + kw / 2 + 7, wy1 - kw / 2 - 3);
            const type = p.keep === 'any' ? rng.weighted([[3, 'turrets'], [2, 'square'], [2, 'round']]) : p.keep;
            const h = LAND + rng.range(20, 24);
            castle.keep = { x: kx, y: ky, w: kw, h, type, top: h + (type === 'square' ? 5 : kw * 0.95) };
        }

        // The front gate lines up with the castle gate when it can, so the main
        // street runs from one to the other
        const gates = [];
        const xL = castle ? castle.xc - castle.tc / 2 - sw / 2 : null, yL = castle ? castle.yc - castle.tc / 2 - sw / 2 : null;
        const fx0 = front.a[0] + 16, fx1 = front.b[0] - 16;
        let xg = castle && castle.gx > fx0 && castle.gx < fx1 ? castle.gx : rng.range(fx0, fx1);
        if (castle && Math.abs(xg - xL) < sw + 9) xg = xL - sw - 9 > fx0 ? xL - sw - 9 : xL + sw + 9;
        gates.push({ e: front, s: xg - front.a[0], x: xg, y: front.a[1] });
        let yg = null;
        if (p.gate2 && left) {
            const ly0 = left.b[1] + 16, ly1 = Math.min(left.a[1] - 16, castle ? yL - sw - 9 : Infinity);
            if (ly1 > ly0) {
                yg = rng.range(ly0, ly1);
                gates.push({ e: left, s: left.a[1] - yg, x: left.a[0], y: yg });
            }
        }
        for (const g of gates) g.e.stops.push({ s: g.s, kind: 'gate', gate: g });

        // Towers at every corner, either side of the gates and where the castle
        // joins on, then more along any wall that runs on too far without one
        const towers = [], walls = [];
        // The cut corners get no towers between their two corner towers. Seen
        // from the default camera two of them run straight away from us, and
        // extra towers would all stand in a line on the page. Where a cut runs
        // so nearly away from us that even its two corner towers would stand one
        // in front of the other, it gets a single tower in the middle instead,
        // and the walls meet at mitred angles at its ends.
        const diagonal = e => Math.abs(e.n[0]) > 0.1 && Math.abs(e.n[1]) > 0.1;
        const yaw = geo.rad(p.yaw);
        const endOn = e => diagonal(e) && e.len * Math.abs(e.d[0] * Math.cos(yaw) - e.d[1] * Math.sin(yaw)) < 10.5;
        const mk = (e, s, v, r, kind) => {
            const [x, y] = e.F.P(s, v, 0), tw = { x, y, r, kind };
            towers.push(tw);
            return tw;
        };
        const corners = poly.map((v, i) => {
            const e0 = edges[(i + poly.length - 1) % poly.length], e1 = edges[i];
            const bx = e0.n[0] + e1.n[0], by = e0.n[1] + e1.n[1], bl = Math.hypot(bx, by), r = rng.range(3.6, 4.1);
            if (endOn(e0) || endOn(e1)) return { r, bare: true };
            const tw = { x: v[0] + (bx / bl) * r * 0.4, y: v[1] + (by / bl) * r * 0.4, r, kind: 'corner' };
            towers.push(tw);
            return tw;
        });
        const run = (e, list, o) => {
            for (let j = 0; j + 1 < list.length; j++) {
                const p0 = list[j], p1 = list[j + 1];
                if (p1.gate) continue;
                const n = diagonal(e) ? 1 : Math.max(1, Math.round((p1.s - p0.s) / p.towerGap));
                let prev = p0;
                for (let k = 1; k <= n; k++) {
                    let next = p1;
                    if (k < n) {
                        const s = p0.s + ((p1.s - p0.s) * k) / n, r = rng.range(2.9, 3.3);
                        next = { s, r, tw: mk(e, s, -r * 0.35, r, o.castle ? 'castle' : 'wall') };
                        next.tw.castle = o.castle;
                    }
                    walls.push({ e, s0: prev.s, s1: next.s, t0: prev.tw, t1: next.tw, ...o });
                    prev = next;
                }
            }
        };
        const stopsOf = (e, castleSide) => {
            const out = [];
            for (const st of e.stops.sort((u, v) => u.s - v.s)) {
                if (st.kind === 'gate') {
                    const g = st.gate, rg = castleSide ? 2.6 : 3.1, h = (castleSide ? 1.4 : 1.6) + 1 + rg;
                    g.towers = [mk(e, st.s - h, -rg * 0.55, rg, 'gate'), mk(e, st.s + h, -rg * 0.55, rg, 'gate')];
                    for (const tw of g.towers) tw.castle = castleSide;
                    out.push({ s: st.s - h, r: rg, tw: g.towers[0] }, { s: st.s + h, r: rg, tw: g.towers[1], gate: g });
                } else {
                    st.tw = mk(e, st.s, -st.r * 0.3, st.r, 'join');
                    out.push({ s: st.s, r: st.r, tw: st.tw });
                }
            }
            return out;
        };
        const end = (c, s) => ({ s, r: c.r, tw: c.bare ? null : c });
        edges.forEach((e, i) => {
            const c0 = corners[i], c1 = corners[(i + 1) % poly.length];
            const mid = endOn(e) ? [{ s: e.len / 2, r: c0.r, tw: mk(e, e.len / 2, -c0.r * 0.35, c0.r, 'corner') }] : [];
            run(e, [end(c0, 0), ...mid, ...stopsOf(e, false), end(c1, e.len)], { z0: 0, zi: LAND, H });
        });

        if (castle) {
            const { xc, yc } = castle;
            const ct = { x: xc - 0.8, y: yc - 0.8, r: 4.3, kind: 'castle', castle: true };
            towers.push(ct);
            const side = edge([xc, B], [xc, yc]), fore = edge([xc, yc], [A, yc]);
            castle.gate = { e: fore, s: castle.gx - xc, x: castle.gx, y: yc, castle: true };
            fore.stops.push({ s: castle.gate.s, kind: 'gate', gate: castle.gate });
            const o = { z0: LAND, zi: LAND, H: castle.H, castle: true };
            run(side, [{ s: 0, r: 3.7, tw: castle.joins[0].tw }, { s: side.len, r: ct.r, tw: ct }], o);
            run(fore, [{ s: 0, r: ct.r, tw: ct }, ...stopsOf(fore, true), { s: fore.len, r: 3.7, tw: castle.joins[1].tw }], o);
        }

        for (const tw of towers) {
            tw.z0 = tw.castle ? LAND : 0;
            const base = tw.castle ? castle.H : H;
            tw.h = base + (tw.kind === 'gate' ? rng.range(4, 5) : rng.range(3.2, 5)) + (tw.kind === 'corner' || tw.kind === 'castle' ? 1.6 : 0);
            tw.roof = towerRoof(p.towerRoofs, tw, rng);
            tw.top = tw.h + (tw.roof === 'crenel' ? 2.4 : (tw.r + 1) * 2.5 + 1.5);
        }
        // the two towers of a gate match
        for (const g of gates.concat(castle ? [castle.gate] : [])) {
            const [t0, t1] = g.towers;
            Object.assign(t1, { h: t0.h, roof: t0.roof, top: t0.top });
        }

        // Streets: a grid lined up on the gates, with the castle's corner left out
        const cross = yg !== null ? yg : geo.lerp(qy0, castle ? yL : qy1, rng.range(0.4, 0.6));
        const X = streetLines([[xg, main]].concat(castle ? [[xL, sw]] : []), qx0, qx1, p.block, sw, rng, 0);
        const cells = [];
        for (let i = 0; i + 1 < X.length; i++) {
            const x0 = X[i][0] + X[i][1] / 2, x1 = X[i + 1][0] - X[i + 1][1] / 2;
            if (x1 - x0 < 5) continue;
            const Y = streetLines([[cross, yg !== null ? main : sw]].concat(castle ? [[yL, sw]] : []), qy0, qy1, p.block * rng.range(0.85, 1.1), sw, rng, p.stagger);
            for (let j = 0; j + 1 < Y.length; j++) {
                const y0 = Y[j][0] + Y[j][1] / 2, y1 = Y[j + 1][0] - Y[j + 1][1] / 2;
                if (y1 - y0 < 5) continue;
                const rect = [x0, y0, x1, y1], cp = clipConvex(rectPoly(rect), inner);
                if (cp.length < 3) continue;
                const area = geo.polygonArea(cp);
                const isCastle = !!castle && x0 >= xL && y0 >= yL;
                const kind = Math.min(x1 - x0, y1 - y0) < 6.5 || area < 60 ? 'green' : 'houses';
                cells.push({ rect, poly: cp, area, full: area > 0.97 * (x1 - x0) * (y1 - y0), castle: isCastle, kind });
            }
        }
        const usable = cells.filter(cl => !cl.castle && cl.full && cl.kind === 'houses');
        const mid = r => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
        let square = null;
        for (const cl of usable) {
            const [x0, y0, x1, y1] = cl.rect;
            if (x1 - x0 < 14 || y1 - y0 < 13) continue;
            // right behind the front walls the square would mostly be hidden
            const behind = y0 < qy0 + 1 || x0 < qx0 + 1 ? 14 : 0;
            const [mx, my] = mid(cl.rect), d = Math.hypot(mx - xg, my - cross) + behind + rng.range(0, 4);
            if (!square || d < square.d) square = { cl, d };
        }
        if (square) square.cl.kind = 'square';
        if (p.church) {
            let best = null;
            for (const cl of usable) {
                if (cl.kind !== 'houses') continue;
                const [x0, y0, x1, y1] = cl.rect;
                if (Math.min(x1 - x0, y1 - y0) < 14 || Math.max(x1 - x0, y1 - y0) < 23) continue;
                const [mx, my] = mid(cl.rect), q = square ? mid(square.cl.rect) : [xg, cross];
                const d = Math.hypot(mx - q[0], my - q[1]) + rng.range(0, 8);
                if (!best || d < best.d) best = { cl, d };
            }
            if (best) best.cl.kind = 'church';
        }

        return {
            A, B, H, poly, edges, inner, gates, castle, towers, walls, cells, square: square && square.cl,
            wallIn: offset(poly, -t / 2), foot: offset(poly, t / 2 + 0.8), moat: offset(poly, t / 2 + p.moat),
        };
    }

    function towerRoof(style, tw, rng) {
        if (style === 'cones') return rng.chance(0.2) ? 'hoard' : 'cone';
        if (style === 'crenels') return 'crenel';
        if (tw.kind === 'corner' || tw.kind === 'castle') return rng.weighted([[5, 'cone'], [2, 'hoard'], [2, 'crenel']]);
        if (tw.kind === 'gate') return rng.weighted([[3, 'cone'], [2, 'crenel']]);
        return rng.weighted([[4, 'cone'], [3, 'crenel'], [1, 'hoard']]);
    }

    // Camera scale and center that fit the moat and everything standing up
    // inside it on the page
    function fitCamera(p, town, W, H) {
        const cam = makeCamera(p.yaw, p.elev, 1, 0, 0, 0, 0);
        const pts = at3(offset(town.poly, WALL / 2 + p.moat + 3), LAND);
        for (const t of town.towers) pts.push([t.x, t.y, t.top]);
        if (town.castle) {
            const K = town.castle.keep;
            pts.push([K.x, K.y, K.top]);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y, z] of pts) {
            const [sx, sy] = cam.project(x, y, z);
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        const k = p.zoom * Math.min((W * 0.97) / (x1 - x0), (H * 0.97) / (y1 - y0));
        const u = (x0 + x1) / 2, v = -(y0 + y1) / 2 / cam.se;
        return { k, cx: u * cam.rx + v * cam.fx, cy: u * cam.ry + v * cam.fy };
    }

    // ------------------------------------------------------------------
    // Walls and towers
    // ------------------------------------------------------------------

    // Upright cylinder that leaves its bottom rim to whatever it stands on
    const drum = (S, x, y, r, z0, z1, n) => S.lathe(x, y, [[0, z0], [r, z0], [r, z0 + 0.01], [r, z1]], n);

    // Where the line v (in from the wall's center line) leaves a tower's circle, as [s0, s1] along the wall
    function chord(e, tw, v) {
        const dx = tw.x - e.a[0], dy = tw.y - e.a[1];
        const sc = dx * e.d[0] + dy * e.d[1], vc = -(dx * e.n[0] + dy * e.n[1]);
        const h = Math.sqrt(Math.max(0, tw.r * tw.r - (v - vc) * (v - vc)));
        return [sc - h, sc + h];
    }

    // A few stones picked out on a wall face, in twos and threes like a brick pattern
    function masonry(T, at, s0, s1, c0, c1, rng) {
        const S = T.S, bw = 1.3, bh = 0.6;
        const stone = (u, c) => S.loop([at(u, c), at(u + bw, c), at(u + bw, c + bh), at(u, c + bh)]);
        for (let i = Math.floor((s1 - s0) / 9); i > 0; i--) {
            if (s1 - s0 < 3 || c1 - c0 < 1.5) return;
            const u = rng.range(s0 + 0.3, s1 - 2.8), c = rng.range(c0, c1 - 1.3);
            stone(u, c);
            if (rng.chance(0.65)) stone(u + bw / 2, c + bh);
            if (rng.chance(0.45)) stone(u + bw, c);
        }
    }

    // A cut corner turns the wall through 45 degrees. Where two walls meet there
    // without a tower, each end is cut back along the bisector by this much
    // for every meter out from the wall's center line.
    const MITRE = Math.tan(Math.PI / 8);

    // Solid along a wall from s0 to s1 with the cross section prof, as convex
    // [v, height] pairs. An end with k set is mitred: it moves along the wall
    // by k * v, so the outside runs on past the corner and the inside stops short.
    function along(S, F, prof, s0, s1, k0, k1) {
        const m = prof.length;
        const verts = prof.map(([v, c]) => F.P(s0 + k0 * v, v, c)).concat(prof.map(([v, c]) => F.P(s1 - k1 * v, v, c)));
        const faces = [prof.map((_, i) => i), prof.map((_, i) => m + i)];
        for (let i = 0; i < m; i++) faces.push([i, (i + 1) % m, m + (i + 1) % m, m + i]);
        S.solid(verts, faces);
    }

    // Curtain wall between two towers, or mitred into the next wall where
    // there's no tower: a prism, with a battered foot where it stands in the
    // moat, a parapet with merlons on the outside and a low wall along the
    // back of the wall walk
    function curtain(T, w, rng) {
        const S = T.S, e = w.e, F = e.F, P = F.P, t = WALL, H = w.H;
        const k0 = w.t0 ? 0 : MITRE, k1 = w.t1 ? 0 : MITRE;
        S.kind = INK;
        along(S, F, [[-t / 2, w.z0], [-t / 2, H], [t / 2, H], [t / 2, w.zi]], w.s0, w.s1, k0, k1);
        if (w.z0 < LAND - 0.5) along(S, F, [[-t / 2, w.z0], [-t / 2 - 0.8, w.z0], [-t / 2, w.z0 + 2.4]], w.s0, w.s1, k0, k1);
        // the parapet and the back wall start and stop where they come clear of the towers
        const span = (v0, v1) => [
            w.t0 ? Math.max(chord(e, w.t0, v0)[1], chord(e, w.t0, v1)[1]) + 0.05 : w.s0,
            w.t1 ? Math.min(chord(e, w.t1, v0)[0], chord(e, w.t1, v1)[0]) - 0.05 : w.s1,
        ];
        const vo = -t / 2, vi = vo + 0.55, mw = T.merlon, top = H + 1.05;
        const [sA, sB] = span(vo, vi), seen = T.sees(F.V(0, -1, 0));
        const edgeOn = Math.abs(e.n[0] * T.cam.fx + e.n[1] * T.cam.fy) < 0.2;
        if (sB - sA > mw) {
            along(S, F, [[vo, H], [vi, H], [vi, top], [vo, top]], sA, sB, k0, k1);
            // seen edge on, the merlons would stack up into a ladder
            const gap = mw * 0.8, n = edgeOn ? 0 : Math.max(1, Math.floor((sB - sA + gap) / (mw + gap)));
            const lead = (sB - sA - n * mw - (n - 1) * gap) / 2;
            for (let i = 0; i < n; i++) {
                const s = sA + lead + i * (mw + gap);
                S.box(F, s, vo, top, s + mw, vi, top + mw * 0.85);
                if (seen && T.detail && i % 2 === 0) S.line([P(s + mw / 2, vo - 0.01, top + 0.15), P(s + mw / 2, vo - 0.01, top + mw * 0.65)]);
            }
            if (seen && T.detail) masonry(T, (u, c) => P(u, vo - 0.01, c), sA, sB, w.z0 + 2.8, H - 0.3, rng);
        }
        const [sC, sD] = span(t / 2 - 0.35, t / 2);
        if (sD - sC > 1) along(S, F, [[t / 2 - 0.35, H], [t / 2, H], [t / 2, H + 0.75], [t / 2 - 0.35, H + 0.75]], sC, sD, k0, k1);
    }

    // Lines down a cone roof, from the eaves most of the way to the top: red
    // where the sun is on it and closer and black where it isn't
    function shadeCone(T, x, y, R, z, h) {
        if (!T.tones) return;
        const S = T.S, cam = T.cam, Re = R * 1.015 + 0.003;
        const rim = a => [x + Re * Math.cos(a), y + Re * Math.sin(a), z + 0.01];
        const apex = cam.project(x, y, z + h);
        let i = 0;
        for (let a = 0; a < TAU - 1e-6;) {
            const c = Math.cos(a), s = Math.sin(a), n = [c * h, s * h, R];
            const lit = T.lit(n), gap = lit ? T.hLit : T.hLit * 0.75;
            // paper distance between neighboring lines, measured across them at the eaves
            const q0 = cam.project(...rim(a)), q1 = cam.project(...rim(a + 0.01));
            const tx = (q1[0] - q0[0]) / 0.01, ty = (q1[1] - q0[1]) / 0.01;
            const lx = apex[0] - q0[0], ly = apex[1] - q0[1], ll = Math.hypot(lx, ly) || 1;
            const across = Math.abs(tx * ly - ty * lx) / ll;
            if (T.sees(n)) {
                // Lines stop at different heights so they never close up to
                // less than half a lit gap on paper as they run in to the top.
                // Every line reaches f(0), every other one f(1), and so on.
                const j = i++ % 8, lv = j ? Math.log2(j & -j) : 3;
                const f = geo.clamp(1 - (T.hLit * 0.55) / (gap * 2 ** lv), 0.15, 0.9);
                const top = [x + Re * (1 - f) * c, y + Re * (1 - f) * s, z + h * f];
                inKind(S, lit ? T.tones.lit : T.tones.dark, () => S.line([rim(a), top]));
            }
            a += geo.clamp(gap / Math.max(across, 1e-3), 0.02, 0.5);
        }
    }

    function cone(T, x, y, R, z, h, n) {
        T.S.lathe(x, y, [[R, z], [R * 0.025, z + h * 0.975], [0, z + h]], n);
        shadeCone(T, x, y, R, z, h);
    }

    // Pennant on a pole. They all stream off to the right, the way the wind blows.
    function flag(T, x, y, z, len) {
        const S = T.S, P = card(T, x, y, z, 0);
        S.kind = INK;
        S.line([P(0, 0), P(0, len)]);
        const w = len * 0.95, h = len * 0.34, top = len - 0.05;
        const pts = [P(0, top), P(w * 0.55, top - h * 0.16), P(w, top - h * 0.5), P(0, top - h)];
        S.face(pts);
        S.loop(pts);
        if (T.tones) inKind(S, RED, () => S.hatch(pts, [0, 0, 1], T.hLit * 0.5));
    }

    // Arrow loops up the side of a tower we see, each a slit with a cross arm
    function loops(T, tw, z0) {
        if (!T.detail) return;
        const S = T.S, { x, y, r } = tw, face = Math.atan2(-T.cam.fy, -T.cam.fx), R = r + 0.02;
        const at = (a, u, c) => { const b = a + u / R; return [x + R * Math.cos(b), y + R * Math.sin(b), c]; };
        const levels = Math.max(1, Math.floor((tw.h - z0 - 2.5) / 3.4));
        for (let i = 0; i < levels; i++) {
            const c = z0 + 1.8 + i * 3.4;
            for (const da of i % 2 ? [-0.62, 0.5] : [-0.05]) {
                const a = face + da + (i % 3) * 0.1;
                S.line([at(a, 0, c), at(a, 0, c + 1.3)]);
                S.line([at(a, -0.25, c + 0.75), at(a, 0.25, c + 0.75)]);
            }
        }
    }

    // Overhanging parapet on a ring of corbels, with merlons round it
    function crenels(T, x, y, r, z, n, rng) {
        const S = T.S, R = r + 0.5, mw = T.merlon;
        const m = Math.max(6, Math.round((TAU * R) / (mw * 1.9))), a0 = rng.range(0, TAU);
        for (let i = 0; i < m; i++) S.box(turned(x, y, 0, a0 + (TAU * (i + 0.5)) / m), r - 0.3, -0.15, z - 0.7, R - 0.03, 0.15, z);
        S.frustum(x, y, z, z + 1.1, R, R, n);
        S.loop(ring(n, (c, s) => [x + (R - 0.5) * c, y + (R - 0.5) * s, z + 1.1]));
        for (let i = 0; i < m; i++) S.box(turned(x, y, 0, a0 + (TAU * i) / m), R - 0.5, -mw / 2, z + 1.1, R, mw / 2, z + 1.1 + mw * 0.85);
    }

    // Timber fighting gallery round the top of a tower, under its roof
    function hoarding(T, x, y, r, z, n) {
        const S = T.S, R = r + 0.6, face = Math.atan2(-T.cam.fy, -T.cam.fx);
        S.kind = WOOD;
        S.frustum(x, y, z, z + 1.7, R, R, n);
        if (T.detail) {
            const m = Math.max(8, Math.round((Math.PI * R) / 0.7));
            for (let i = 1; i < m; i++) {
                const a = face - Math.PI / 2 + (Math.PI * i) / m, c = Math.cos(a), s = Math.sin(a), q = R * 1.015 + 0.01;
                S.line([[x + q * c, y + q * s, z + 0.15], [x + q * c, y + q * s, z + 1.55]]);
            }
            for (let i = 0; i < 7; i++) {
                const a = face - 1.2 + (2.4 * i) / 6, c = Math.cos(a), s = Math.sin(a);
                S.line([[x + r * c, y + r * s, z - 1], [x + R * c, y + R * s, z]]);
            }
        }
        S.kind = INK;
    }

    // Round tower: a battered foot where it stands in the moat, a string course,
    // arrow loops, and a cone roof, a timber gallery under a cone, or battlements
    function tower(T, tw, rng) {
        const S = T.S, { x, y, r } = tw, n = Math.max(28, T.segs(r + 0.8));
        S.kind = INK;
        let z = tw.z0;
        // the battered foot stops just under the ground, or its top would show
        // as a stray arc where the tower bulges into the town
        if (z < LAND - 0.5) {
            S.frustum(x, y, z, LAND - 0.05, r + 0.75, r, n);
            z = LAND - 0.05;
        }
        const zs = geo.lerp(z, tw.h, 0.6);
        drum(S, x, y, r, z, zs, n);
        S.frustum(x, y, zs, zs + 0.3, r + 0.14, r + 0.14, n);
        drum(S, x, y, r, zs + 0.3, tw.h, n);
        shadeRound(T, x, y, z, tw.h, r, r);
        loops(T, tw, Math.max(z, LAND));
        if (tw.roof === 'crenel') {
            crenels(T, x, y, r, tw.h, n, rng);
            if (T.p.banners && rng.chance(0.4)) flag(T, x, y, tw.h + 1.1, 3.2);
            return;
        }
        let R = r + 0.55, zr = tw.h;
        if (tw.roof === 'hoard') {
            hoarding(T, x, y, r, tw.h, n);
            R = r + 1;
            zr += 1.7;
        }
        const hc = R * 2.25;
        S.kind = INK;
        cone(T, x, y, R, zr, hc, n);
        if (T.p.banners) flag(T, x, y, zr + hc - 0.1, 2.6);
        else S.line([[x, y, zr + hc], [x, y, zr + hc + 1]]);
    }

    // ------------------------------------------------------------------
    // Gates and bridges
    // ------------------------------------------------------------------

    // Pointed arch on a wall from c up, hw either side of s. Returns its outline
    // and the height of its underside at u.
    function pointed(at, s, c, hw, spring) {
        const r = hw * 1.45, off = r - hw, pts = [at(s - hw, c), at(s - hw, spring)];
        const ta = Math.acos(-off / r), tb = Math.acos(off / r);
        for (let i = 1; i <= 10; i++) { const a = Math.PI + ((ta - Math.PI) * i) / 10; pts.push(at(s + off + r * Math.cos(a), spring + r * Math.sin(a))); }
        for (let i = 1; i <= 10; i++) { const a = tb - (tb * i) / 10; pts.push(at(s - off + r * Math.cos(a), spring + r * Math.sin(a))); }
        pts.push(at(s + hw, c));
        const under = u => (Math.abs(u - s) >= hw ? spring : spring + Math.sqrt(Math.max(0, r * r - (Math.abs(u - s) + off) ** 2)));
        return { pts, under, apex: spring + Math.sqrt(r * r - off * off) };
    }

    // Gate passage: a pointed arch with the portcullis partway down and the
    // passage dark behind it, a recess for the drawbridge and a coat of arms
    function gateArch(T, at, s, c, hw, drop) {
        const S = T.S, k = T.k;
        const A = pointed(at, s, c, hw, c + (drop ? 3 : 2.6));
        S.line(A.pts);
        if (T.detail) {
            const pb = c + 2.1;
            for (let u = s - hw + 0.32; u < s + hw - 0.15; u += 0.42) {
                S.line([at(u, A.under(u) - 0.03), at(u, pb - 0.25)]);
            }
            for (let z = pb + 0.15; z < A.apex - 0.3; z += 0.55) {
                // as wide as the arch is at this height
                let u0 = s - hw;
                while (A.under(u0) < z && u0 < s) u0 += 0.05;
                S.line([at(u0, z), at(2 * s - u0, z)]);
            }
            // the passage behind it
            const gap = T.hDark / k;
            for (let u = s - hw + gap / 2; u < s + hw; u += gap) S.line([at(u, c + 0.02), at(u, pb - 0.3)]);
        }
        if (drop) {
            // recess the raised drawbridge fits into
            const top = c + drop + 0.2;
            S.line([at(s - hw - 0.3, c), at(s - hw - 0.3, top), at(s + hw + 0.3, top), at(s + hw + 0.3, c)]);
            arms(T, at, s, top + 0.5);
        }
    }

    // Shield in gold with a red chevron
    function arms(T, at, s, c) {
        const S = T.S, w = 0.85, h = 2;
        const pts = [at(s - w, c + h), at(s + w, c + h), at(s + w, c + h * 0.45)];
        for (let i = 1; i < 8; i++) { const a = (Math.PI / 2) * (i / 8); pts.push(at(s + w * Math.cos(a), c + h * 0.45 * (1 - Math.sin(a)))); }
        pts.push(at(s, c));
        for (let i = 1; i < 8; i++) { const a = (Math.PI / 2) * (1 - i / 8); pts.push(at(s - w * Math.cos(a), c + h * 0.45 * (1 - Math.sin(a)))); }
        pts.push(at(s - w, c + h * 0.45));
        inKind(S, GOLD, () => S.loop(pts));
        if (T.detail) inKind(S, RED, () => S.line([at(s - w + 0.1, c + h * 0.35), at(s, c + h * 0.8), at(s + w - 0.1, c + h * 0.35)]));
    }

    // Square gate block between a gate's two towers, with machicolations along
    // the front, a roof behind the battlements and the arch below
    function gatehouse(T, g, town, rng) {
        const S = T.S, e = g.e, F = e.F, P = F.P, t = WALL, s = g.s, castleGate = !!g.castle;
        const z0 = castleGate ? LAND : 0, H = castleGate ? town.castle.H : town.H;
        const hw = castleGate ? 1.4 : 1.6, bw = hw + 1.6, vf = -t / 2 - (castleGate ? 0.6 : 1.5), top = H + 3.2;
        S.kind = INK;
        S.box(F, s - bw, vf, z0, s + bw, t / 2 + 0.4, top);
        if (z0 < LAND - 0.5) S.prism([P(s - bw, vf, z0), P(s - bw, vf - 0.7, z0), P(s - bw, vf, z0 + 2.2)], F.V(2 * bw, 0, 0));
        // corbels under a parapet standing out from the front
        const pv = vf - 0.55, n = Math.max(3, Math.round((2 * bw) / 0.85));
        for (let i = 0; i < n; i++) {
            const u = s - bw + (2 * bw * (i + 0.5)) / n;
            S.box(F, u - 0.13, pv + 0.03, top - 1.6, u + 0.13, vf, top - 0.95);
        }
        S.box(F, s - bw, pv, top - 0.95, s + bw, vf + 0.3, top + 0.15);
        const mw = T.merlon, m = Math.max(2, Math.floor((2 * bw + 0.8 * mw) / (1.8 * mw)));
        for (let i = 0; i < m; i++) {
            const u = s - bw + ((2 * bw - mw) * i) / (m - 1);
            S.box(F, u, pv, top + 0.15, u + mw, pv + 0.5, top + 0.15 + mw * 0.85);
        }
        const R = gableRoof(T, F, [s - bw + 0.45, vf + 0.5, s + bw - 0.45, t / 2 + 0.3], top, true, geo.rad(50), rng, { attic: false });
        shadeGable(T, F, R);
        if (T.sees(F.V(0, -1, 0))) {
            const at = (u, c) => P(u, vf - 0.01, c);
            gateArch(T, at, s, LAND, hw, castleGate ? 0 : 4.6);
            if (castleGate) arms(T, at, s, LAND + 5.6);
            else if (T.detail) for (const u of [s - hw - 0.75, s + hw + 0.75]) S.line([at(u, LAND + 5.3), at(u, LAND + 5.8)]);
        }
    }

    // The way over the moat to a gate: a stone bridge out to a pier, then the
    // drawbridge down from the gate, its chains up to the gatehouse
    function approach(T, g, town) {
        const S = T.S, p = T.p, t = WALL, e = g.e;
        const r = [-e.n[0], -e.n[1]], across = e.n[1] !== 0 ? [1, 0] : [0, 1], wB = 4.4;
        const aC = g.x * r[0] + g.y * r[1], b0 = g.x * across[0] + g.y * across[1] - wB / 2;
        // a runs along the road towards the gate and b across it from the side we see
        const F = {
            P: (a, b, c) => [r[0] * a + across[0] * (b0 + b), r[1] * a + across[1] * (b0 + b), c],
            V: (a, b, c) => [r[0] * a + across[0] * b, r[1] * a + across[1] * b, c],
        };
        const aGate = aC - t / 2 - 1.5, aBank = aC - t / 2 - p.moat, Ldb = 4.6;
        let aPier = aGate - Ldb, ramp = bridgeRamp(aPier - 3 - aBank);
        ramp = bridgeRamp(aPier - ramp - 0.3 - aBank);
        const aArch = aPier - ramp - 0.3;
        S.kind = INK;
        if (aArch - aBank > 2.5) {
            S.box(F, aArch, -0.25, 0, aPier, wB + 0.25, LAND - 0.05);
            kit.bridge(T, F, aBank, aArch, wB, LAND, 0, true);
        } else aPier = aBank;
        g.road = { F, aBank, ramp, wB, r, across, b0 };
        S.kind = WOOD;
        S.box(F, aPier, 0.55, LAND - 0.22, aGate, wB - 0.55, LAND + 0.04);
        if (T.detail) for (let a = aPier + 0.45; a < aGate - 0.2; a += 0.45) S.line([F.P(a, 0.55, LAND + 0.04), F.P(a, wB - 0.55, LAND + 0.04)]);
        S.kind = INK;
        for (const b of [0.75, wB - 0.75]) S.line([F.P(aGate, b, LAND + Ldb + 0.55), F.P(aPier + 0.25, b, LAND + 0.06)]);
        g.keepOut = [Math.min(aBank, aPier) - 1, aGate];
    }

    // ------------------------------------------------------------------
    // The moat and the ground
    // ------------------------------------------------------------------

    // The ground faces that hide the water's shadows under them, and the stone
    // bank round the outside of the moat
    function banks(T, town) {
        const S = T.S, M = town.moat, n = M.length, far = offset(M, 600);
        S.kind = INK;
        S.face(at3(town.wallIn, LAND), false);
        for (let i = 0; i < n; i++) {
            const a = M[i], b = M[(i + 1) % n], A = far[i], B = far[(i + 1) % n];
            S.face([[a[0], a[1], LAND], [b[0], b[1], LAND], [B[0], B[1], LAND], [A[0], A[1], LAND]], false);
            S.face([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], LAND], [a[0], a[1], LAND]], false);
            S.line([[a[0], a[1], LAND], [b[0], b[1], LAND]]);
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
            if (!T.sees([-dy, dx, 0])) continue;
            S.line([[a[0], a[1], 0], [b[0], b[1], 0]]);
            S.line([[a[0], a[1], LAND - 0.3], [b[0], b[1], LAND - 0.3]]);
            if (T.detail) {
                for (let s = 2.2; s < L - 1; s += 4.4) S.line([[a[0] + dx * s, a[1] + dy * s, 0.05], [a[0] + dx * s, a[1] + dy * s, LAND - 0.3]]);
            }
        }
        S.loop(at3(offset(M, 0.6), LAND));
    }

    // Distance (m) from a point on the moat to its nearest bank: the outer
    // bank, the foot of the walls, the towers and the bridges. Negative on land.
    function moatDistance(town) {
        const { moat, foot } = town, inTowers = town.towers.filter(t => t.z0 < 1);
        const blocks = town.gates.filter(g => g.road).map(g => {
            const { F, aBank, wB } = g.road, [a0, a1] = g.keepOut;
            return bounds([F.P(a0, -0.4, 0), F.P(a1, wB + 0.4, 0), F.P(aBank, -0.4, 0)]);
        });
        return (x, y) => {
            const inMoat = depth(moat, x, y);
            if (inMoat < 0 || depth(foot, x, y) > 0) return -1;
            let d = Math.min(inMoat, distOut(foot, x, y));
            for (const t of inTowers) d = Math.min(d, Math.hypot(x - t.x, y - t.y) - t.r - 0.75);
            for (const b of blocks) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3])));
            return d;
        };
    }

    // Is a point on the moat in front of the walls as the camera sees them?
    // Behind the back walls only a sliver of water shows, and anything drawn
    // on it reads as part of the wall walk.
    function inFront(T, town) {
        const { cam } = T, P = town.poly;
        return (x, y) => {
            let best = Infinity, n = null;
            for (const e of town.edges) {
                const d = distOut([e.a, e.b], x, y);
                if (d < best) { best = d; n = e.n; }
            }
            return n[0] * cam.fx + n[1] * cam.fy < 0.3 || depth(P, x, y) > 0;
        };
    }

    // Ripple lines following the banks a little way out on paper, as round the
    // coast on an old chart: the nearest solid, the next in dashes. Bits shorter
    // than 2.5 mm, left where the shadows cut them up, are dropped.
    function ripples(T, town, clear) {
        const { S, k } = T, dist = moatDistance(town), [x0, y0, x1, y1] = bounds(town.moat);
        const field = PG.sampleField(dist, x0, y0, x1 - x0, y1 - y0, Math.max(0.9, 0.8 / k));
        const step = 0.3 / k;
        S.kind = WATER;
        for (const [mm, on, off] of [[1.9, Infinity, 0], [4.3, 9, 2.4]]) {
            const period = (on + off) / k;
            for (const path of PG.isolines(field, mm / k, dist)) {
                let run = [], t = (path.length * 1.7) % 3;
                const flush = () => {
                    if (run.length * step * k >= 2.5) S.line(run.map(([x, y]) => [x, y, 0]));
                    run = [];
                };
                for (let i = 0; i + 1 < path.length; i++) {
                    const [ax, ay] = path[i], [bx, by] = path[i + 1], len = Math.hypot(bx - ax, by - ay);
                    for (let s = 0; s < len; s += step, t += step) {
                        const x = ax + ((bx - ax) * s) / len, y = ay + ((by - ay) * s) / len;
                        if ((t % period) * k < on && clear(x, y)) run.push([x, y]);
                        else flush();
                    }
                }
                flush();
            }
        }
        S.kind = INK;
    }

    // Swans, lily pads and a boat on the moat. Returns patches of water for
    // the ripple lines to keep out of.
    function moatLife(T, town, rng) {
        const S = T.S, p = T.p, dist = moatDistance(town), seen = inFront(T, town), out = [];
        const [x0, y0, x1, y1] = bounds(town.moat);
        const spot = (m, tries = 60) => {
            for (let i = 0; i < tries; i++) {
                const x = rng.range(x0, x1), y = rng.range(y0, y1);
                if (dist(x, y) > m && seen(x, y) && !out.some(([u, v, r]) => Math.hypot(u - x, v - y) < r + m)) return [x, y];
            }
            return null;
        };
        const swans = Math.round(p.moatLife * 5 + rng.range(-0.5, 0.5));
        for (let i = 0; i < swans; i++) {
            const at = spot(2.6);
            if (!at) continue;
            swan(T, at[0], at[1], rng.sign());
            out.push([at[0], at[1], 2.6]);
        }
        const pads = Math.round(p.moatLife * 6);
        for (let i = 0; i < pads; i++) {
            const at = spot(1.6);
            if (!at) continue;
            const n = rng.int(3, 7);
            for (let j = 0; j < n; j++) lily(T, at[0] + rng.range(-2.2, 2.2), at[1] + rng.range(-2.2, 2.2), rng.range(0.45, 0.8), rng);
            out.push([at[0], at[1], 3.4]);
        }
        if (rng.chance(p.moatLife)) {
            const at = spot(3.4);
            if (at) {
                const d = moatDirection(town, at[0], at[1]);
                S.kind = WOOD;
                kit.boat(T, turned(at[0], at[1], 0, Math.atan2(d[1], d[0])), 'row', rng);
                S.kind = FIGURE;
                kit.person(T, at[0], at[1], 0.35, rng);
                S.kind = INK;
                out.push([at[0], at[1], 3.6]);
            }
        }
        return out;
    }

    // Which way the moat runs at a point, along the nearest stretch of bank
    function moatDirection(town, x, y) {
        const M = town.moat;
        let best = null, bd = Infinity;
        for (let i = 0; i < M.length; i++) {
            const a = M[i], b = M[(i + 1) % M.length], d = distOut([a, b], x, y);
            if (d < bd) { bd = d; best = [b[0] - a[0], b[1] - a[1]]; }
        }
        const L = Math.hypot(best[0], best[1]);
        return [best[0] / L, best[1] / L];
    }

    // Swan side on, with a short wake behind it
    function swan(T, x, y, dir) {
        const S = T.S, P0 = card(T, x, y, 0, 0), P = (u, w) => P0(u * dir, w);
        const body = [P(-0.8, 0.02), P(0.62, 0.02), P(0.72, 0.2), P(0.45, 0.42), P(-0.35, 0.5), P(-0.85, 0.32)];
        S.kind = INK;
        S.face(body);
        S.loop(body);
        S.line([P(0.42, 0.38), P(0.58, 0.75), P(0.5, 1.1), P(0.56, 1.32), P(0.7, 1.36), P(0.9, 1.28)]);
        S.line([P(-0.4, 0.3), P(0.2, 0.36)]);
        S.kind = WATER;
        for (const s of [-1, 1]) S.line([P0(-0.95 * dir, 0), [x - dir * 1.9 * T.cam.rx + s * 0.6 * T.cam.fx, y - dir * 1.9 * T.cam.ry + s * 0.6 * T.cam.fy, 0]]);
        S.kind = INK;
    }

    // Round leaf with a notch cut in it
    function lily(T, x, y, r, rng) {
        const S = T.S, a0 = rng.range(0, TAU), pts = [[x, y, 0.01]];
        for (let i = 0; i <= 12; i++) {
            const a = a0 + 0.45 + ((TAU - 0.9) * i) / 12;
            pts.push([x + r * Math.cos(a), y + r * Math.sin(a), 0.01]);
        }
        inKind(S, GREEN, () => S.loop(pts));
    }

    // ------------------------------------------------------------------
    // Houses
    // ------------------------------------------------------------------

    // Half-timbering over one story of a wall: posts, a rail under the windows
    // and one over them, windows in the middle bays and braces in the ones at
    // the ends, leaning in towards the middle
    function timbered(T, W, c0, c1) {
        if (!T.sees(W.n)) return;
        const S = T.S, L = W.len, at = W.at;
        const n = Math.max(2, Math.round(L / Math.max(1.15, 1.5 / T.k))), bw = L / n;
        const sill = c0 + 0.8, head = c1 - 0.5;
        const win = i => n < 3 || (i > 0 && i < n - 1 && !(n >= 5 && i === (n - 1) / 2));
        for (let i = 0; i < n; i++) if (win(i)) pane(T, at, i * bw + 0.16, sill + 0.08, bw - 0.32, head - sill - 0.16, bw > 1.1 ? 'cross' : null);
        S.kind = WOOD;
        for (let i = 1; i < n; i++) S.line([at(i * bw, c0), at(i * bw, c1)]);
        S.line([at(0, sill), at(L, sill)]);
        S.line([at(0, head), at(L, head)]);
        if (T.detail) {
            for (let i = 0; i < n; i++) {
                const s0 = i * bw, s1 = s0 + bw;
                if (!win(i)) {
                    if ((i + 0.5) * bw < L / 2) S.line([at(s0, c0), at(s1, head)]);
                    else S.line([at(s1, c0), at(s0, head)]);
                } else {
                    // a cross under each window
                    S.line([at(s0, c0), at(s1, sill)]);
                    S.line([at(s1, c0), at(s0, sill)]);
                }
            }
        }
        S.kind = INK;
    }

    // Narrow town house on its lot: a stone ground floor, upper floors that
    // are half-timbered and jettied out over the street, or plain stone, and a
    // steep roof with its gable or its eaves to the street. o: { floors,
    // gable, timber, step, shop, ends: [left, right] }
    function townhouse(T, F, fp, rng, o) {
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp, w = a1 - a0;
        S.kind = INK;
        const g0 = 3.2, jet = o.timber ? 0.32 : 0;
        S.box(F, a0, b0, 0, a1, b1, g0);
        const stories = [[0, g0, b0]];
        let z = g0, front = b0;
        for (let f = 1; f < o.floors; f++) {
            front = b0 - jet * f;
            S.box(F, a0, front, z, a1, b1, z + FLOOR);
            stories.push([z, z + FLOOR, front]);
            z += FLOOR;
        }
        const step = o.gable && o.step, th = 0.35;
        const pitch = geo.rad(o.gable ? rng.range(52, 58) : rng.range(46, 52));
        const rf = [a0 + 0.4, step ? front + th + 0.3 : front, a1 - 0.4, b1];
        const R = gableRoof(T, F, rf, z + 0.25, !o.gable, pitch, rng, { attic: o.gable && !o.timber && !step && rng.chance(0.6) });
        shadeGable(T, F, R);
        if (step) gableWall(T, F, a0, front, th, stepGable(w, z, R.rise, w > 5.6 ? 3 : 2));
        if (o.gable && o.timber && T.sees(F.V(0, -1, 0)) && T.detail) {
            // king post, collar and braces in the gable
            const bg = front - R.oh - 0.01, am = (a0 + a1) / 2, zb = R.zb, hw = R.hw;
            const G = (u, c) => P(am + u, bg, c), cz = zb + R.rise * 0.42, cw = hw * 0.58 - 0.25;
            inKind(S, WOOD, () => {
                S.line([G(0, zb), G(0, zb + R.rise * 0.8)]);
                S.line([G(-cw, cz), G(cw, cz)]);
                S.line([G(-hw * 0.6, zb), G(-0.12, cz)]);
                S.line([G(hw * 0.6, zb), G(0.12, cz)]);
            });
        }
        if (!o.gable && rng.chance(0.35) && w > 4.4) dormer(T, F, R, -1, rng);
        if (rng.chance(0.4)) {
            const ca = o.gable ? geo.lerp(a0, a1, rng.chance(0.5) ? 0.3 : 0.7) : rng.range(a0 + 1, a1 - 1);
            chimney(T, F, ca, o.gable ? rng.range(front + 2, b1 - 1.5) : R.mid + 0.6, R.zb, R.ridge + rng.range(0.3, 0.7));
        }
        // the street front: door and shop window or windows below, then each story above
        const W0 = wall(F, 0, fp), d = w * rng.range(0.2, 0.32);
        if (T.sees(W0.n)) {
            door(T, W0.at, d, 0, 1, 2.3);
            if (o.shop) pane(T, W0.at, d + 0.75, 0.6, w - d - 1.1, 1.7, 'wide');
            else if (w - d > 2.4) pane(T, W0.at, d + 0.95, 1, Math.min(1.2, w - d - 1.4), 1.3, 'cross');
        }
        if (o.shop) awning(T, F, a0 + 0.2, a1 - 0.2, b0, 2.85, 1, GOLD);
        for (let f = 1; f < stories.length; f++) {
            const [c0, c1, bf] = stories[f], Wf = wall(F, 0, [a0, bf, a1, b1]);
            if (o.timber) timbered(T, Wf, c0, c1);
            else windows(T, Wf, { base: c0 - 0.1, floors: 1, style: 'frame', winW: 0.9, winH: 1.4, gap: 0.65 });
        }
        windows(T, wall(F, 2, fp), { base: 0, floors: o.floors, style: 'frame', winW: 0.85, winH: 1.3, gap: 0.9 });
        for (const side of [3, 1]) {
            if (!o.ends[side === 3 ? 0 : 1]) continue;
            for (const [c0, , bf] of stories) windows(T, wall(F, side, [a0, bf, a1, b1]), { base: c0 - 0.1, floors: 1, style: 'frame', winW: 0.85, winH: 1.3, gap: 1.3 });
        }
        return R;
    }

    // A block of houses: rows down its long sides, shorter rows across the ends
    // when there's room, and a yard in the middle with gardens and trees
    function block(T, cell, town, rng) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = cell.rect, w = x1 - x0, d = y1 - y0;
        S.kind = INK;
        S.loop(at3(cell.poly, LAND));
        const alongX = w >= d, long = alongX ? w : d, short = alongX ? d : w;
        const D = Math.min(rng.range(7.5, 9.5), short - 0.5), both = short >= 2 * D + 2.5, ends = both && long >= 2 * D + 5;
        // each side of the block as a row frame, u along the street and v into the block
        const sides = {
            front: { F: frame(x0, y0, LAND, 0), L: w, face: [0, -1] },
            back: { F: frame(x1, y1, LAND, 2), L: w, face: [0, 1] },
            left: { F: frame(x0, y1, LAND, 3), L: d, face: [-1, 0] },
            right: { F: frame(x1, y0, LAND, 1), L: d, face: [1, 0] },
        };
        // a block with room for one row has it face the camera
        const main = alongX ? (both ? ['front', 'back'] : ['front']) : (both ? ['left', 'right'] : ['left']);
        const rows = main.map(k => ({ ...sides[k], k, a0: 0, a1: sides[k].L }));
        if (ends) for (const k of alongX ? ['left', 'right'] : ['front', 'back']) rows.push({ ...sides[k], k, a0: D, a1: sides[k].L - D });
        const sq = town.square && town.square.rect;
        const onSquare = r => {
            if (!sq) return false;
            const [mx, my] = r.F.P((r.a0 + r.a1) / 2, -p.street - 1.5, 0);
            return inRect(sq, mx, my, 0.5);
        };
        const built = [];
        const ok = (F, a, b, a2, b2) => [[a, b], [a2, b], [a2, b2], [a, b2]].every(([u, v]) => { const q = F.P(u, v, 0); return depth(town.inner, q[0], q[1]) > -0.05; });
        for (const r of rows) {
            if (onSquare(r) && cell.full && r.a1 - r.a0 > 8) {
                terrace(T, r.F, [r.a0 + 0.2, 0.2, r.a1 - 0.2, D - 0.6], rng, { floors: p.floors, shops: 0.75, stripe: GOLD });
                built.push(bounds([r.F.P(r.a0, 0, 0), r.F.P(r.a1, D, 0)]));
                continue;
            }
            const lots = [];
            for (let a = r.a0; a < r.a1 - 3.4;) {
                let lw = rng.range(4.2, 6.6);
                if (r.a1 - a - lw < 3.8) lw = r.a1 - a;
                const dp = D - rng.range(0, 1.6);
                // where the corner of the town cuts across, try a shallower house first
                const fit = [dp, dp - 2.5, dp - 4].find(v => v >= 5 && ok(r.F, a, 0, a + lw, v));
                lots.push({ fp: [a, 0, a + lw, fit || dp], ok: !!fit });
                a += lw;
            }
            // The sun is round the back, so slopes facing -x are lit and slopes facing -y
            // are in shade. Rows along x mostly turn their gables to the street and rows
            // along y their eaves, which keeps most of the roofs we see in the sun.
            const sunny = r.face[1] !== 0, uniform = rng.chance(0.3);
            lots.forEach((lot, i) => {
                if (!lot.ok) return;
                const timber = rng.chance(p.timber);
                const gable = uniform ? sunny : rng.chance(sunny ? 0.75 : 0.25);
                const floors = Math.max(2, Math.min(p.floors, rng.weighted([[3, 2], [4, 3], [2, 4], [0.6, 5]])));
                const ends = [i === 0 || !lots[i - 1].ok, i === lots.length - 1 || !lots[i + 1].ok];
                townhouse(T, r.F, lot.fp, rng, { floors, gable, timber, step: !timber && rng.chance(0.4), shop: rng.chance(0.15), ends });
                built.push(bounds([r.F.P(lot.fp[0], lot.fp[1] - 1, 0), r.F.P(lot.fp[2], lot.fp[3], 0)]));
            });
        }
        // the yard in the middle
        const has = k => rows.some(r => r.k === k) ? D + 0.8 : 0.8;
        const yard = [x0 + has('left'), y0 + has('front'), x1 - has('right'), y1 - has('back')];
        // gardens in the yard, and in any corner the town wall cut off the block
        if (!cell.full) garden(T, cell.rect, town, rng, built);
        else if (yard[2] - yard[0] > 3 && yard[3] - yard[1] > 3) garden(T, yard, town, rng, built);
    }

    // Trees, vegetable beds and a well in a yard or on a scrap of open ground
    function garden(T, r, town, rng, built = []) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = r, taken = [];
        const free = (x, y, m) => depth(town.inner, x, y) > m && inRect(r, x, y, -m) && !built.some(b => inRect(b, x, y, m + 0.3))
            && !taken.some(([u, v, q]) => Math.hypot(u - x, v - y) < q + m);
        const area = (x1 - x0) * (y1 - y0);
        for (let i = Math.round((area / 70) * p.gardens + rng.range(0, 0.8)); i > 0; i--) {
            const x = rng.range(x0, x1), y = rng.range(y0, y1);
            if (!free(x, y, 1.6)) continue;
            tree(T, x, y, LAND, rng);
            taken.push([x, y, 1.6]);
        }
        for (let i = Math.round((area / 90) * p.gardens); i > 0; i--) {
            const bw = rng.range(2.5, 4), bd = rng.range(1.6, 2.6), x = rng.range(x0, x1 - bw), y = rng.range(y0, y1 - bd);
            if (!free(x + bw / 2, y + bd / 2, Math.max(bw, bd) / 2)) continue;
            inKind(S, GREEN, () => {
                S.loop(at3(rectPoly([x, y, x + bw, y + bd]), LAND));
                for (let u = x + 0.5; u < x + bw - 0.2; u += 0.55) S.line([[u, y + 0.2, LAND], [u, y + bd - 0.2, LAND]]);
            });
            taken.push([x + bw / 2, y + bd / 2, Math.max(bw, bd) / 2]);
        }
    }

    // ------------------------------------------------------------------
    // The market square and the church
    // ------------------------------------------------------------------

    // Gable canopy along u from a0 to a1 over b0..b1, every other band of it
    // filled in `kind`, wide enough bands to read at any scale
    function canopy(T, F, a0, a1, b0, b1, z, rise, kind) {
        const S = T.S, P = F.P, bm = (b0 + b1) / 2;
        S.prism([P(a0, b0, z), P(a0, b1, z), P(a0, bm, z + rise)], F.V(a1 - a0, 0, 0));
        const n = Math.max(3, Math.round((a1 - a0) / Math.max(0.8, 1 / T.k)) | 1), sw = (a1 - a0) / n;
        for (const [e, sgn] of [[b0, -1], [b1, 1]]) {
            const nrm = F.V(0, sgn * rise, Math.abs(bm - e));
            if (!T.sees(nrm)) continue;
            inKind(S, kind, () => {
                for (let i = 1; i < n; i += 2) {
                    S.hatch([P(a0 + sw * i, e, z), P(a0 + sw * (i + 1), e, z), P(a0 + sw * (i + 1), bm, z + rise), P(a0 + sw * i, bm, z + rise)], F.V(0, bm - e, rise), T.hLit * 0.45);
                }
            });
        }
    }

    // Stall with a striped canopy over a counter of baskets
    function stall(T, x, y, rng) {
        const S = T.S, F = frame(x, y, LAND, 0), P = F.P, L = 2.4, D = 1.1;
        S.kind = INK;
        S.box(F, -L / 2, -D / 2, 0, L / 2, D / 2, 0.85);
        for (let i = 0; i < 3; i++) {
            const [bx, by, bz] = P(-L / 2 + 0.45 + i * 0.75, rng.range(-0.15, 0.15), 0.85);
            S.lathe(bx, by, [[0.2, bz], [0.28, bz + 0.22]], 10);
        }
        for (const u of [-L / 2 + 0.06, L / 2 - 0.06]) for (const v of [-D / 2 - 0.2, D / 2 + 0.2]) S.line([P(u, v, 0), P(u, v, 2.1)]);
        canopy(T, F, -L / 2 - 0.15, L / 2 + 0.15, -D / 2 - 0.45, D / 2 + 0.45, 2.1, 0.6, GOLD);
    }

    // Market cross: a base of two steps and a tall shaft with a cross on top.
    // Returns its radius. More, thinner steps just fill in at this scale.
    function marketCross(T, x, y) {
        const S = T.S, F = frame(x, y, LAND, 0);
        S.kind = INK;
        S.box(F, -1.5, -1.5, 0, 1.5, 1.5, 0.45);
        S.box(F, -0.9, -0.9, 0.45, 0.9, 0.9, 0.9);
        S.frustum(x, y, LAND + 0.9, LAND + 5.2, 0.22, 0.16, 10);
        const P = card(T, x, y, LAND + 5.2, 0);
        S.line([P(0, 0), P(0, 1.2)]);
        S.line([P(-0.4, 0.75), P(0.4, 0.75)]);
        return 1.6;
    }

    function marketSquare(T, cell, rng) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = cell.rect, w = x1 - x0, d = y1 - y0;
        S.kind = INK;
        S.loop(at3(rectPoly(cell.rect), LAND));
        S.loop(at3(rectPoly([x0 + 1.1, y0 + 1.1, x1 - 1.1, y1 - 1.1]), LAND));
        const F = frame(x0, y0, LAND, 0), occ = new Occupancy(w, d);
        // how far back the fountain or cross can go and stay clear of the hall
        let room = d - 1;
        if (p.market && w >= 15 && d >= 15) {
            const L = Math.min(w - 4.5, rng.range(12, 16)), D = rng.range(6.5, 7.5), a = (w - L) / 2, b = d - D - 1.6;
            marketHall(T, F, [a, b, a + L, b + D], rng);
            occ.add(a - 0.6, b - 1, a + L + 0.6, b + D + 0.6);
            room = b - 1;
        }
        // a fountain is up to 2.85 m across the basin, the cross 1.6 m
        const big = rng.chance(0.55) && room >= 7.4;
        const fx = w / 2, fy = Math.max(big ? 3.7 : 2.4, Math.min(d * 0.38, d - 13, room - (big ? 3.7 : 2.4)));
        const [cx, cy] = F.P(fx, fy, 0);
        const rr = big ? fountain(T, cx, cy, LAND, rng) : marketCross(T, cx, cy);
        S.kind = INK;
        const pave = rr + 1.2;
        if (pave < Math.min(fx, fy) - 0.5) S.loop(ring(T.segs(pave), (c, s) => [cx + pave * c, cy + pave * s, LAND]));
        occ.add(fx - pave, fy - pave, fx + pave, fy + pave);
        for (let i = Math.round(rng.range(3, 6) * (0.4 + p.people)); i > 0; i--) {
            const s = occ.place(rng, 3, 2.4, 1, 1, w - 1, d - 1);
            if (!s) break;
            const [x, y] = F.P(s[0] + 1.5, s[1] + 1.2, 0);
            if (rng.chance(0.65)) stall(T, x, y, rng);
            else cart(T, x, y, LAND, rng);
        }
        for (let i = Math.round(((w * d) / 30) * p.people * rng.range(0.7, 1.3)); i > 0; i--) {
            const s = occ.place(rng, 0.6, 0.6, 0.6, 0.6, w - 0.6, d - 0.6);
            if (!s) continue;
            const [x, y] = F.P(s[0] + 0.3, s[1] + 0.3, 0);
            person(T, x, y, LAND, rng);
        }
    }

    // The church in its churchyard, with a low wall round it, gravestones and yews
    function churchBlock(T, cell, rng) {
        const S = T.S, [x0, y0, x1, y1] = cell.rect;
        S.kind = INK;
        S.loop(at3(rectPoly(cell.rect), LAND));
        // the tower goes on the street end that faces the camera
        const alongY = y1 - y0 >= x1 - x0;
        const F = alongY ? frame(x0, y0, LAND, 0) : frame(x0, y1, LAND, 3);
        const U = alongY ? x1 - x0 : y1 - y0, V = alongY ? y1 - y0 : x1 - x0;
        const cw = Math.min(U - 5, rng.range(8.5, 10)), cd = Math.min(V - 4.5, 26), a = (U - cw) / 2, b = 2.6;
        church(T, F, [a, b, a + cw, b + cd], rng);
        // churchyard wall, open in front of the door
        const lw = (u0, v0, u1, v1) => { if (u1 - u0 > 0.3 && v1 - v0 > 0.3) S.box(F, u0, v0, 0, u1, v1, 1); };
        const m = 0.5, t = 0.4, am = a + cw / 2;
        lw(m, m, am - 1.3, m + t);
        lw(am + 1.3, m, U - m, m + t);
        lw(m, V - m - t, U - m, V - m);
        lw(m, m + t, m + t, V - m - t);
        lw(U - m - t, m + t, U - m, V - m - t);
        S.line([F.P(am, m, 0), F.P(am, b, 0)]);
        // gravestones in rows either side of the nave
        for (const [u0, u1] of [[m + t + 0.8, a - 0.9], [a + cw + 0.9, U - m - t - 0.8]]) {
            for (let u = u0; u < u1 - 0.5; u += 1.6) {
                for (let v = b + 3; v < Math.min(V - 2, b + cd); v += 2.2) {
                    if (!rng.chance(0.6)) continue;
                    const uu = u + rng.range(-0.2, 0.2);
                    if (rng.chance(0.3)) {
                        const [cx, cy] = F.P(uu + 0.3, v, 0), C = card(T, cx, cy, LAND, 0);
                        S.line([C(0, 0), C(0, 1)]);
                        S.line([C(-0.3, 0.7), C(0.3, 0.7)]);
                    } else S.box(F, uu, v, 0, uu + 0.6, v + 0.15, 0.8);
                }
            }
        }
        for (const [u, v] of [[1.6, 1.7], [U - 1.6, 1.7], [1.6, V - 1.8], [U - 1.6, V - 1.8]]) {
            if (rng.chance(0.75)) {
                const [x, y] = F.P(u, v, 0);
                fir(T, x, y, LAND, rng.range(4.5, 6.5), rng);
            }
        }
    }

    // ------------------------------------------------------------------
    // The castle
    // ------------------------------------------------------------------

    // isokit's hip roof faces, rebuilt from the same corners it uses, to shade
    function hatchHip(T, F, R) {
        const [a0, b0, a1, b1] = R.fp, P = F.P, oh = 0.4, zb = R.zb, zr = R.ridge;
        const A0 = a0 - oh, A1 = a1 + oh, B0 = b0 - oh, B1 = b1 + oh, hw = Math.min(A1 - A0, B1 - B0) / 2;
        const c = [P(A0, B0, zb), P(A1, B0, zb), P(A1, B1, zb), P(A0, B1, zb)];
        let faces;
        if (A1 - A0 > B1 - B0 + 0.05) {
            const bm = (B0 + B1) / 2, r0 = P(A0 + hw, bm, zr), r1 = P(A1 - hw, bm, zr);
            faces = [[c[0], c[1], r1, r0], [c[2], c[3], r0, r1], [c[3], c[0], r0], [c[1], c[2], r1]];
        } else if (B1 - B0 > A1 - A0 + 0.05) {
            const am = (A0 + A1) / 2, r0 = P(am, B0 + hw, zr), r1 = P(am, B1 - hw, zr);
            faces = [[c[3], c[0], r0, r1], [c[1], c[2], r1, r0], [c[0], c[1], r0], [c[2], c[3], r1]];
        } else {
            const apex = P((A0 + A1) / 2, (B0 + B1) / 2, zr);
            faces = [[c[0], c[1], apex], [c[1], c[2], apex], [c[2], c[3], apex], [c[3], c[0], apex]];
        }
        const centre = P((A0 + A1) / 2, (B0 + B1) / 2, zb);
        for (const f of faces) shade(T, f, outward(f, centre));
    }

    // Parapet and merlons round the top of a rectangle, the walk inside at z
    function battlements(T, F, [a0, b0, a1, b1], z) {
        const S = T.S, th = 0.5, mw = T.merlon, top = z + 1;
        S.box(F, a0, b0, z, a1, b0 + th, top);
        S.box(F, a0, b1 - th, z, a1, b1, top);
        S.box(F, a0, b0 + th, z, a0 + th, b1 - th, top);
        S.box(F, a1 - th, b0 + th, z, a1, b1 - th, top);
        const row = (len, fn, ends) => {
            const n = Math.max(2, Math.floor((len + mw * 0.8) / (mw * 1.8)) + 1);
            for (let i = ends ? 0 : 1; i < (ends ? n : n - 1); i++) fn(((len - mw) * i) / (n - 1));
        };
        const h = top + mw * 0.85;
        row(a1 - a0, u => { S.box(F, a0 + u, b0, top, a0 + u + mw, b0 + th, h); S.box(F, a0 + u, b1 - th, top, a0 + u + mw, b1, h); }, true);
        row(b1 - b0, v => { S.box(F, a0, b0 + v, top, a0 + th, b0 + v + mw, h); S.box(F, a1 - th, b0 + v, top, a1, b0 + v + mw, h); }, false);
    }

    // The keep: a square tower with flat buttresses and battlements, the same
    // with round corner turrets under a steep roof, or a round donjon
    function keep(T, K, rng) {
        const S = T.S, { x, y, w } = K, zt = K.h - LAND, n = Math.max(32, T.segs(w));
        S.kind = INK;
        if (K.type === 'round') {
            const r = w / 2;
            S.frustum(x, y, LAND, LAND + 1.8, r + 0.9, r, n);
            const zs = geo.lerp(LAND + 1.8, K.h, 0.55);
            drum(S, x, y, r, LAND + 1.8, zs, n);
            S.frustum(x, y, zs, zs + 0.35, r + 0.18, r + 0.18, n);
            drum(S, x, y, r, zs + 0.35, K.h, n);
            shadeRound(T, x, y, LAND + 1.8, K.h, r, r);
            loops(T, { x, y, r, h: K.h }, LAND + 2);
            crenels(T, x, y, r, K.h, n, rng);
            const R = r - 0.2, hc = R * 1.9;
            cone(T, x, y, R, K.h + 1.1, hc, n);
            if (T.p.banners) flag(T, x, y, K.h + 1.1 + hc - 0.1, 4);
            return;
        }
        const F = frame(x - w / 2, y - w / 2, LAND, 0), P = F.P;
        S.box(F, -0.6, -0.6, 0, w + 0.6, w + 0.6, 1.5);
        S.box(F, 0, 0, 1.5, w, w, zt);
        const top = zt - 0.9, square = K.type === 'square';
        if (square) {
            for (const [u, v] of [[0, 0], [w, 0], [w, w], [0, w]]) S.box(F, u - 0.55, v - 0.55, 1.5, u + 0.55, v + 0.55, top);
            for (const [u0, v0, u1, v1] of [[w / 2 - 0.45, -0.3, w / 2 + 0.45, 0], [w / 2 - 0.45, w, w / 2 + 0.45, w + 0.3], [-0.3, w / 2 - 0.45, 0, w / 2 + 0.45], [w, w / 2 - 0.45, w + 0.3, w / 2 + 0.45]]) {
                S.box(F, u0, v0, 1.5, u1, v1, top - 1);
            }
        }
        for (let side = 0; side < 4; side++) {
            const Wl = wall(F, side, [0, 0, w, w]);
            if (!T.sees(Wl.n)) continue;
            for (const f of [0.27, 0.73]) {
                arch(T, Wl.at, w * f, 3.5, 0.35, 1.5);
                arch(T, Wl.at, w * f, zt * 0.45, 0.8, 2.1);
                arch(T, Wl.at, w * f - 0.5, zt * 0.7, 0.6, 1.9);
                arch(T, Wl.at, w * f + 0.5, zt * 0.7, 0.6, 1.9);
            }
            if (side === 0) arch(T, Wl.at, w * 0.27, 1.5, 1.3, 2.5);
            if (T.p.banners && !square) {
                // a long banner down the face
                const nn = Wl.n, at = (u, c) => { const q = Wl.at(u, c); return [q[0] + nn[0] * 0.05, q[1] + nn[1] * 0.05, q[2]]; };
                const u = w * 0.5, c1 = zt - 1.6, c0 = c1 - 6.5;
                const b = [at(u - 0.75, c1), at(u + 0.75, c1), at(u + 0.75, c0), at(u, c0 + 0.7), at(u - 0.75, c0)];
                S.face([b[0], b[1], b[2], b[4]]);
                S.loop(b);
                if (T.tones) inKind(S, RED, () => S.hatch(b, [0, 0, 1], T.hLit * 0.5));
                inKind(S, GOLD, () => {
                    S.line([at(u, c1 - 1), at(u, c0 + 1.6)]);
                    S.line([at(u - 0.5, c1 - 2.2), at(u + 0.5, c1 - 2.2)]);
                });
            }
        }
        if (K.type === 'turrets') {
            // a cornice, the roof, and a turret corbelled out from each corner
            S.box(F, -0.25, -0.25, zt, w + 0.25, w + 0.25, zt + 0.35);
            const R = hipRoof(T, F, [0, 0, w, w], zt + 0.6, geo.rad(62));
            hatchHip(T, F, R);
            if (T.p.banners) flag(T, ...P(w / 2, w / 2, 0).slice(0, 2), R.ridge, 4);
            for (const [u, v] of [[0, 0], [w, 0], [w, w], [0, w]]) {
                const [cx, cy] = P(u, v, 0), r = 1.7, zb = K.h - 4.5, nt = Math.max(20, T.segs(r));
                S.lathe(cx, cy, [[0, zb - 2.2], [0.06, zb - 2.15], [r, zb]], nt);
                drum(S, cx, cy, r, zb, K.h + 1.6, nt);
                shadeRound(T, cx, cy, zb, K.h + 1.6, r, r);
                const Rc = r + 0.35, hc = Rc * 2.6;
                cone(T, cx, cy, Rc, K.h + 1.6, hc, nt);
                S.line([[cx, cy, K.h + 1.6 + hc], [cx, cy, K.h + 2.4 + hc]]);
            }
        } else {
            battlements(T, F, [-0.55, -0.55, w + 0.55, w + 0.55], zt);
            // square turrets rising from the corners
            for (const [u, v] of [[0, 0], [w, 0], [w, w], [0, w]]) {
                const tf = [u - 1.4, v - 1.4, u + 1.4, v + 1.4];
                S.box(F, tf[0], tf[1], zt, tf[2], tf[3], zt + 3.4);
                battlements(T, F, [tf[0] - 0.15, tf[1] - 0.15, tf[2] + 0.15, tf[3] + 0.15], zt + 3.4);
            }
            if (T.p.banners) flag(T, ...P(w, w, 0).slice(0, 2), K.h + 4.4, 4);
        }
    }

    // Great hall along the ward wall: tall windows between buttresses, a steep roof
    function hall(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, L = a1 - a0, h = rng.range(6.8, 8);
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, h);
        const R = gableRoof(T, F, fp, h, true, geo.rad(rng.range(50, 55)), rng, { attic: false });
        shadeGable(T, F, R);
        const W = wall(F, 0, fp), n = Math.max(3, Math.round(L / 3.4));
        for (let i = 1; i < n; i++) S.box(F, a0 + (L * i) / n - 0.3, b0 - 0.6, 0, a0 + (L * i) / n + 0.3, b0, h - 1.4);
        if (T.sees(W.n)) {
            for (let i = 0; i < n; i++) {
                const s = (L * (i + 0.5)) / n;
                if (i === 0) door(T, W.at, s, 0, 1.4, 2.6, true);
                else S.loop(pointed(W.at, s, 1.8, 0.55, 4.6).pts);
            }
        }
        chimney(T, F, a0 + L * 0.68, R.mid + 0.8, R.zb, R.ridge + 1.2);
        for (const side of [1, 3]) {
            const Ws = wall(F, side, fp);
            if (T.sees(Ws.n)) arch(T, Ws.at, Ws.len / 2, 2, 1.1, 3.4);
        }
    }

    function well(T, x, y, rng) {
        const S = T.S, F = frame(x, y, LAND, 0);
        S.kind = INK;
        S.lathe(x, y, [[0.85, LAND], [0.85, LAND + 0.8]], T.segs(0.85));
        S.loop(ring(T.segs(0.6), (c, s) => [x + 0.6 * c, y + 0.6 * s, LAND + 0.8]));
        for (const u of [-0.78, 0.62]) S.box(F, u, -0.08, 0.8, u + 0.16, 0.08, 2.2);
        S.line([F.P(-0.62, 0, 1.6), F.P(0.62, 0, 1.6)]);
        shadeGable(T, F, gableRoof(T, F, [-0.85, -0.5, 0.85, 0.5], 2.35, true, geo.rad(40), rng, { attic: false }));
    }

    // Inside the castle ward: a great hall, a well, and people and horses
    // about the yard. The keep is drawn with the walls.
    function ward(T, town, rng) {
        const S = T.S, p = T.p, C = town.castle, [wx0, wy0, wx1, wy1] = C.ward, K = C.keep;
        S.kind = INK;
        // the great hall down the right-hand wall, in front of the keep
        const hallD = 8.5, hy1 = K.y - K.w / 2 - 2.5, taken = [[K.x, K.y, K.w * 0.75]];
        if (hy1 - wy0 > 12) {
            hall(T, frame(wx1 - hallD - 0.6, hy1, LAND, 3), [0, 0, hy1 - wy0 - 1.2, hallD], rng);
            taken.push([wx1 - hallD / 2, (wy0 + hy1) / 2, Math.max(hallD, hy1 - wy0) / 2 + 1]);
        }
        const ok = (x, y, r) => inRect(C.ward, x, y, -r) && !taken.some(([u, v, q]) => Math.hypot(u - x, v - y) < q + r);
        const wellAt = [geo.lerp(wx0, wx1, 0.28), geo.lerp(wy0, wy1, 0.4)];
        if (ok(...wellAt, 1.5)) {
            well(T, wellAt[0], wellAt[1], rng);
            taken.push([...wellAt, 1.5]);
        }
        for (let i = Math.round(rng.range(3, 6) * (0.4 + p.people)); i > 0; i--) {
            const x = rng.range(wx0 + 1, wx1 - 1), y = rng.range(wy0 + 1, wy0 + (wy1 - wy0) * 0.6);
            if (!ok(x, y, 1.2)) continue;
            if (rng.chance(0.4)) horse(T, x, y, LAND, rng.sign(), rng, rng.chance(0.6));
            else person(T, x, y, LAND, rng);
            taken.push([x, y, 1.4]);
        }
    }

    // ------------------------------------------------------------------
    // Things in the country and on the roads
    // ------------------------------------------------------------------

    // Horse side on, facing dir (1 to the right on the page), with a rider if asked
    function horse(T, x, y, z, dir, rng, rider, lance) {
        const S = T.S, P0 = card(T, x, y, z, 0), P = (u, w) => P0(u * dir, w);
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
        if (rider) {
            const tor = [P(-0.2, 1.45), P(0.12, 1.45), P(0.1, 2.25), P(-0.16, 2.25)];
            S.face(tor);
            S.loop(tor);
            const hr = 0.15, ce = T.cam.ce, hd = ring(T.segs(hr), (c, s) => P(-0.03 + hr * c, 2.25 + hr / ce + (hr * s) / ce));
            S.face(hd);
            S.loop(hd);
            S.line([P(0, 1.45), P(0.1, 1), P(0.04, 0.75)]);
            if (lance) {
                S.kind = INK;
                S.line([P(-0.6, 1.5), P(1.6, 3.4)]);
                const pn = [P(1.45, 3.27), P(1.05, 3.2), P(1.3, 3.0)];
                S.face(pn);
                S.loop(pn);
            }
        }
        S.kind = INK;
    }

    // Covered wagon pulled by a horse along `dir` (a frame direction)
    function wagon(T, x, y, dir, rng) {
        const S = T.S, F = frame(x, y, LAND, dir), P = F.P;
        S.kind = WOOD;
        S.box(F, -1.5, -0.75, 0.75, 1.5, 0.75, 1.25);
        const r = 0.8, prof = [];
        for (let i = 0; i <= 10; i++) { const a = (Math.PI * i) / 10; prof.push(P(-1.45, 0.78 * Math.cos(a), 1.25 + r * Math.sin(a) * 1.1)); }
        S.prism(prof, F.V(2.6, 0, 0), true);
        if (T.detail) for (const u of [-0.6, 0.3]) S.line(Array.from({ length: 11 }, (_, i) => { const a = (Math.PI * i) / 10; return P(u, 0.8 * Math.cos(a), 1.25 + r * Math.sin(a) * 1.1); }));
        kit.wheels(T, F, [-0.95, 0.95], 0.75, 0.48);
        S.line([P(1.5, 0, 0.9), P(2.6, 0, 0.9)]);
        S.kind = INK;
        const [hx, hy] = P(3.6, 0, 0), sx = F.V(1, 0, 0);
        horse(T, hx, hy, LAND, sx[0] * T.cam.rx + sx[1] * T.cam.ry >= 0 ? 1 : -1, rng, false);
    }

    // A frame with everything in it m times bigger
    const scaled = (F, m) => ({ P: (a, b, c) => F.P(a * m, b * m, c * m), V: (a, b, c) => F.V(a * m, b * m, c * m) });

    // Post mill: a timber body on a trestle up on a mound. A post mill turns on
    // its post to face the wind, so this one faces nearly into the camera,
    // with its sails seen full on.
    function postMill(T, x, y, rng) {
        const S = T.S, cam = T.cam, m = 1.4;
        S.kind = INK;
        S.lathe(x, y, [[7.5, LAND], [5.8, LAND + 1.2], [3.8, LAND + 1.8]], T.segs(7.5));
        const z = LAND + 1.8, F = scaled(frame(x, y, z, 0), m), P = F.P;
        for (const [u, v] of [[-1.6, 0], [1.6, 0], [0, -1.6], [0, 1.6]]) S.box(F, u - 0.35, v - 0.35, 0, u + 0.35, v + 0.35, 0.5);
        S.box(F, -1.7, -0.15, 0.5, 1.7, 0.15, 0.75);
        S.box(F, -0.15, -1.7, 0.5, 0.15, 1.7, 0.75);
        S.box(F, -0.2, -0.2, 0.75, 0.2, 0.2, 3.3);
        for (const [u, v] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) S.line([P(u, v, 0.75), P(u * 0.1, v * 0.1, 2.6)]);
        const B = scaled(turned(x, y, z, Math.atan2(-cam.fx, cam.fy) + rng.sign() * 0.45), m), bw = 2.2, bd = 2.9;
        S.kind = WOOD;
        S.box(B, -bw / 2, -bd / 2, 3.2, bw / 2, bd / 2, 7.4);
        // boards and sail bars at least 1.6 and 2 mm apart on paper, or the
        // body fills in behind the sails
        const board = Math.max(0.45, 1.6 / (T.k * m)), bar = Math.max(0.8, 2 / (T.k * m));
        if (T.detail) {
            for (const side of [0, 1, 3]) {
                const W = wall(B, side, [-bw / 2, -bd / 2, bw / 2, bd / 2]);
                if (T.sees(W.n)) for (let c = 3.2 + board; c < 7.3; c += board) S.line([W.at(0, c), W.at(W.len, c)]);
            }
        }
        S.kind = INK;
        shadeGable(T, B, gableRoof(T, B, [-bw / 2, -bd / 2, bw / 2, bd / 2], 7.4, false, geo.rad(45), rng, { attic: false }));
        // steps up the back to the door, and the tail pole
        S.line([B.P(-0.4, bd / 2, 4.2), B.P(-0.4, bd / 2 + 3.4, 0.2)]);
        S.line([B.P(0.4, bd / 2, 4.2), B.P(0.4, bd / 2 + 3.4, 0.2)]);
        S.line([B.P(0, bd / 2, 3.6), B.P(0, bd / 2 + 4.5, 0.8)]);
        // sails on the front
        const hub = B.P(0, -bd / 2 - 0.5, 6.4), ux = B.V(1, 0, 0), uz = B.V(0, 0, 1);
        const at = (s, c) => [hub[0] + ux[0] * s, hub[1] + ux[1] * s, hub[2] + uz[2] * c];
        // sails set in an X, so the body shows between the top two and the trestle between the bottom two
        const phi0 = Math.PI / 4 + rng.range(-0.1, 0.1);
        for (let i = 0; i < 4; i++) {
            const a = phi0 + (i * Math.PI) / 2, cx = Math.cos(a), cy = Math.sin(a);
            const q = (s, t) => at(cx * s - cy * t, cy * s + cx * t);
            const s0 = 0.5, s1 = rng.range(5.2, 5.8), wd = 1.05;
            const sail = [q(s0, 0), q(s1, 0), q(s1, wd), q(s0, wd)];
            S.face(sail);
            S.loop(sail);
            S.line([q(0, 0.02), q(s0, 0.02)]);
            if (T.detail) {
                const n = Math.max(3, Math.round((s1 - s0) / bar));
                for (let j = 1; j < n; j++) S.line([q(s0 + ((s1 - s0) * j) / n, 0), q(s0 + ((s1 - s0) * j) / n, wd)]);
                S.line([q(s0, wd / 2), q(s1, wd / 2)]);
            }
        }
        const hr = 0.35, hubPts = ring(T.segs(hr * m), (c, s) => at(c * hr, s * hr));
        S.face(hubPts);
        S.loop(hubPts);
    }

    // Round pavilion with a striped wall, a striped cone and a pennant
    function pavilion(T, x, y, r, rng) {
        const S = T.S, n = Math.max(24, T.segs(r)), h = 2, R = r + 0.3, hc = R * 1.25;
        const stripe = rng.chance(0.5) ? RED : GOLD;
        S.kind = INK;
        drum(S, x, y, r, LAND, LAND + h, n);
        S.lathe(x, y, [[R, LAND + h], [R * 0.03, LAND + h + hc * 0.97], [0, LAND + h + hc]], n);
        if (T.detail) {
            const m = 12;
            inKind(S, stripe, () => {
                for (let i = 0; i < m; i += 2) {
                    for (let j = 0; j <= 4; j++) {
                        const a = (TAU * (i + j / 4)) / m, c = Math.cos(a), s = Math.sin(a), q = r * 1.015 + 0.01, Q = R * 1.015 + 0.01;
                        S.line([[x + q * c, y + q * s, LAND + 0.05], [x + q * c, y + q * s, LAND + h - 0.05]]);
                        S.line([[x + Q * c, y + Q * s, LAND + h + 0.02], [x + Q * c * 0.3, y + Q * s * 0.3, LAND + h + hc * 0.7]]);
                    }
                }
            });
        }
        // scalloped valance round the eaves
        const val = [];
        for (let i = 0; i <= 48; i++) {
            const a = (TAU * i) / 48, Q = R * 1.02 + 0.01;
            val.push([x + Q * Math.cos(a), y + Q * Math.sin(a), LAND + h - 0.25 * Math.abs(Math.sin(a * 6))]);
        }
        S.line(val);
        flag(T, x, y, LAND + h + hc, 1.8);
    }

    // Tournament: a tilt barrier with a knight riding at each end, pavilions
    // along the far side and a stand for the crowd. The stand goes right on the
    // near edge of the field, low and well back from the barrier, or its
    // canopy covers the lists on the page.
    function tournament(T, r, rng) {
        const S = T.S, [x0, y0, x1, y1] = r, long = x1 - x0 >= y1 - y0;
        const F = long ? frame(x0, y0, LAND, 0) : frame(x0, y1, LAND, 3), U = long ? x1 - x0 : y1 - y0, V = long ? y1 - y0 : x1 - x0;
        S.kind = WOOD;
        const vm = Math.min(V - 7.5, Math.max(8.3, V * 0.45)), L = Math.min(U - 6, 34), u0 = (U - L) / 2;
        S.box(F, u0, vm - 0.12, 0, u0 + L, vm + 0.12, 1.3);
        if (T.detail) for (let u = u0 + 2; u < u0 + L - 1; u += 2) S.line([F.P(u, vm - 0.13, 0), F.P(u, vm - 0.13, 1.3)]);
        // the stand: two rows of benches under a striped roof
        const sw = Math.min(10, L * 0.4), su = U / 2 - sw / 2;
        for (let i = 0; i < 2; i++) S.box(F, su, 1.7 - i * 0.7, 0, su + sw, 2.4 - i * 0.7, 0.45 * (i + 1));
        for (const u of [su + 0.1, su + sw - 0.1]) for (const v of [2.3, 1.1]) S.line([F.P(u, v, v > 2 ? 0 : 0.9), F.P(u, v, 3)]);
        S.kind = INK;
        canopy(T, F, su - 0.2, su + sw + 0.2, 0.7, 2.9, 3, 0.5, RED);
        for (let i = 0; i < 8; i++) {
            const [px, py] = F.P(su + 0.6 + (sw - 1.2) * (i / 7), 2.05 - (i % 2) * 0.7, 0);
            person(T, px, py, LAND + 0.45 * ((i % 2) + 1), rng);
        }
        // knights at either end, one each side of the barrier
        const sx = F.V(1, 0, 0), dir = sx[0] * T.cam.rx + sx[1] * T.cam.ry >= 0 ? 1 : -1;
        const [ax, ay] = F.P(u0 + 3, vm - 1.4, 0), [bx, by] = F.P(u0 + L - 3, vm + 1.4, 0);
        horse(T, ax, ay, LAND, dir, rng, true, true);
        horse(T, bx, by, LAND, -dir, rng, true, true);
        // pavilions behind, far enough apart along the field that they don't
        // overlap on the page when it runs away from the camera
        const across = Math.max(0.25, Math.abs(sx[0] * T.cam.rx + sx[1] * T.cam.ry));
        for (let u = 3.5; u < U - 3; u += Math.max(rng.range(6, 8), 6.4 / across)) {
            const [px, py] = F.P(u, Math.min(V - 3, vm + 6.5) + rng.range(-0.5, 0.5), 0);
            pavilion(T, px, py, rng.range(1.8, 2.4), rng);
        }
    }

    // Grass tuft: three short strokes on a card
    function tuft(T, x, y) {
        const P = card(T, x, y, LAND, 0);
        T.S.line([P(-0.35, 0.5), P(-0.05, 0), P(0, 0.7)], true);
        T.S.line([P(0.05, 0), P(0.35, 0.5)], true);
    }

    // Haystack, its straw drawn down the side we see in gold
    function haystack(T, x, y) {
        const S = T.S, prof = [[1.25, 0], [1.3, 0.7], [1.05, 1.6], [0.55, 2.4], [0.12, 2.8], [0, 2.85]];
        S.kind = INK;
        S.lathe(x, y, prof.map(([r, z]) => [r, LAND + z]), T.segs(1.3));
        const face = Math.atan2(-T.cam.fy, -T.cam.fx);
        inKind(S, GOLD, () => {
            for (let i = -4; i <= 4; i++) {
                const a = face + i * 0.3, c = Math.cos(a), s = Math.sin(a);
                S.line(prof.slice(0, 5 - (i & 1)).map(([r, z]) => [x + (r * 1.02 + 0.01) * c, y + (r * 1.02 + 0.01) * s, LAND + z]));
            }
        });
    }

    function sheep(T, x, y, dir) {
        const S = T.S, P0 = card(T, x, y, LAND, 0), P = (u, w) => P0(u * dir, w);
        // a woolly body of bumps, a dark head and stick legs
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

    // Small fruit tree: a round crown on a short trunk
    function fruitTree(T, x, y, rng) {
        const S = T.S, P = card(T, x, y, LAND, 0.1), r = rng.range(1, 1.3), cz = 1.5 + r * 0.8;
        S.kind = GREEN;
        const crown = ring(T.segs(r), (c, s) => P(c * r, cz + s * r));
        S.face(crown);
        S.loop(crown);
        const B = card(T, x, y, LAND, 0);
        S.line([B(0, 0), B(0, cz - r)]);
        S.kind = INK;
    }

    // One-story cottage under a steep hip roof, thatched in gold
    function cottage(T, F, fp, rng) {
        const S = T.S, [a0, b0, a1, b1] = fp, w = a1 - a0;
        S.kind = INK;
        S.box(F, a0, b0, 0, a1, b1, 2.5);
        const R = hipRoof(T, F, fp, 2.5, geo.rad(rng.range(50, 56)));
        const keep = T.tones;
        if (keep) T.tones = { ...keep, lit: GOLD };
        hatchHip(T, F, R);
        T.tones = keep;
        if (rng.chance(0.6)) chimney(T, F, rng.range(a0 + 1, a1 - 1), (b0 + b1) / 2, R.zb, R.ridge + 0.3);
        const W = wall(F, 0, fp);
        if (T.sees(W.n)) {
            door(T, W.at, w * 0.3, 0, 0.95, 2);
            pane(T, W.at, w * 0.55, 0.9, 0.9, 0.85, 'cross');
            if (w > 6) pane(T, W.at, w * 0.78, 0.9, 0.9, 0.85, 'cross');
        }
        for (const side of [1, 2, 3]) windows(T, wall(F, side, fp), { base: -0.1, floors: 1, style: 'cross', winW: 0.85, winH: 0.85, gap: 2 });
    }

    // A few cottages facing the road, picket fences in front and vegetable
    // beds behind, and the rest of the field left to grass
    function hamlet(T, c, rng) {
        const S = T.S, [x0, y0, x1, y1] = c.r, rd = c.road, along = rd.g.road.across[0] !== 0;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const side = along
            ? (mx < rd.bc ? { F: frame(x1, y0, LAND, 1), L: y1 - y0 } : { F: frame(x0, y1, LAND, 3), L: y1 - y0 })
            : (my < rd.bc ? { F: frame(x1, y1, LAND, 2), L: x1 - x0 } : { F: frame(x0, y0, LAND, 0), L: x1 - x0 });
        const { F, L } = side, D = along ? x1 - x0 : y1 - y0, picket = withKind(WOOD, kit.fence);
        for (let a = rng.range(1, 3); a < L - 8;) {
            const w = rng.range(6, 7.5), d = rng.range(4.6, 5.4), b = rng.range(2.6, 3.4);
            cottage(T, F, [a, b, a + w, b + d], rng);
            const g = a + w * 0.3;
            picket(T, F.P(a - 1, 1, 0), F.P(g - 0.6, 1, 0), 0.9);
            picket(T, F.P(g + 0.6, 1, 0), F.P(a + w + 1, 1, 0), 0.9);
            S.kind = INK;
            S.line([F.P(g, 1, 0), F.P(g, b, 0)]);
            if (D > b + d + 5) {
                inKind(S, GREEN, () => {
                    const v0 = b + d + 1.2, v1 = Math.min(D - 1, v0 + 3.5);
                    S.loop([F.P(a, v0, 0), F.P(a + w, v0, 0), F.P(a + w, v1, 0), F.P(a, v1, 0)]);
                    for (let u = a + 0.6; u < a + w - 0.3; u += 0.6) S.line([F.P(u, v0 + 0.2, 0), F.P(u, v1 - 0.2, 0)]);
                });
            }
            // a tree gets a gap of its own between this cottage and the next
            let gap = rng.range(3.5, 6);
            if (rng.chance(0.6)) {
                gap = rng.range(8, 9.5);
                const [tx, ty] = F.P(a + w + gap / 2, b + d * 0.7, 0);
                tree(T, tx, ty, LAND, rng);
            }
            a += w + gap;
        }
        S.kind = GREEN;
        for (let i = Math.round(((x1 - x0) * (y1 - y0)) / 90); i > 0; i--) {
            const [u, v] = [rng.range(1, L - 1), rng.range(Math.min(D - 1, 12), D - 1)];
            const [tx, ty] = F.P(u, v, 0);
            tuft(T, tx, ty);
        }
        S.kind = INK;
    }

    // One field: an outline and furrows, strips, grass, an orchard, a hay
    // harvest, sheep, or a copse
    function field(T, r, kind, rng) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = r, w = x1 - x0, d = y1 - y0;
        const gap = p.furrows, along = w >= d ? [1, 0, 0] : [0, 1, 0];
        const rect3 = q => at3(rectPoly(q), LAND);
        S.kind = GREEN;
        if (kind !== 'wood') S.loop(rect3(r));
        if (kind === 'furrows') S.hatch(rect3(r), rng.chance(0.7) ? along : [along[1], along[0], 0], gap);
        else if (kind === 'strips') {
            const n = rng.int(3, 5), lw = w >= d;
            for (let i = 0; i < n; i++) {
                const q = lw ? [x0, y0 + (d * i) / n, x1, y0 + (d * (i + 1)) / n] : [x0 + (w * i) / n, y0, x0 + (w * (i + 1)) / n, y1];
                if (i) S.line(rect3(q).slice(0, 2));
                if (i % 2 === 0) S.hatch(rect3(q), along, gap);
                else if (rng.chance(0.5)) S.hatch(rect3(q), [along[1], along[0], 0], gap * 1.4);
            }
        } else if (kind === 'meadow' || kind === 'pasture') {
            for (let i = Math.round((w * d) / 48); i > 0; i--) tuft(T, rng.range(x0 + 0.8, x1 - 0.8), rng.range(y0 + 0.8, y1 - 0.8));
            if (kind === 'pasture') {
                S.kind = INK;
                const flock = [];
                for (let i = rng.int(4, 8); i > 0; i--) flock.push([rng.range(x0 + 2, x1 - 2), rng.range(y0 + 2, y1 - 2)]);
                flock.sort((a, b) => (b[0] * T.cam.fx + b[1] * T.cam.fy) - (a[0] * T.cam.fx + a[1] * T.cam.fy));
                for (const [x, y] of flock) sheep(T, x, y, rng.sign());
            }
        } else if (kind === 'orchard') {
            for (let x = x0 + 2.5; x < x1 - 1.5; x += 5.5) for (let y = y0 + 2.5; y < y1 - 1.5; y += 5.5) fruitTree(T, x + rng.range(-0.4, 0.4), y + rng.range(-0.4, 0.4), rng);
        } else if (kind === 'hay') {
            S.hatch(rect3(r), along, gap * 2.2);
            for (let i = rng.int(2, 5); i > 0; i--) haystack(T, rng.range(x0 + 2, x1 - 2), rng.range(y0 + 2, y1 - 2));
        } else if (kind === 'wood') {
            const spots = [];
            for (let i = Math.round((w * d) / 32); i > 0; i--) {
                const x = rng.range(x0 + 1.5, x1 - 1.5), y = rng.range(y0 + 1.5, y1 - 1.5);
                if (spots.some(([u, v]) => Math.hypot(u - x, v - y) < 3.4)) continue;
                spots.push([x, y]);
            }
            spots.sort((a, b) => (b[0] * T.cam.fx + b[1] * T.cam.fy) - (a[0] * T.cam.fx + a[1] * T.cam.fy));
            for (const [x, y] of spots) {
                if (rng.chance(0.55)) fir(T, x, y, LAND, rng.range(6, 9), rng);
                else tree(T, x, y, LAND, rng);
            }
        }
        S.kind = INK;
    }

    // Roads out of the gates, fields in a grid lined up on them, a mill, a
    // tournament, trees and people on the roads
    function country(T, town, rng) {
        const { S, p, cam } = T;
        const tall = 16 * cam.ce * cam.k;
        let view = [[0, -tall * 0.3], [S.W, -tall * 0.3], [S.W, S.H + tall], [0, S.H + tall]].map(([sx, sy]) => cam.ground(sx, sy, LAND));
        if (geo.polygonArea(view) < 0) view.reverse();
        const [vx0, vy0, vx1, vy1] = bounds(view);
        const glacis = offset(town.moat, 7);
        // the roads, as strips running out from the end of each bridge
        const roads = [];
        for (const g of town.gates) {
            if (!g.road) continue;
            const { r, across, b0, wB, aBank, ramp } = g.road, a1 = aBank - ramp, hw = 2.9, bc = b0 + wB / 2;
            let a0 = a1;
            while (a0 > -2000 && [0, 1].some(() => depth(view, r[0] * a0 + across[0] * bc, r[1] * a0 + across[1] * bc) > -30)) a0 -= 10;
            const P = (a, b) => [r[0] * a + across[0] * (bc + b), r[1] * a + across[1] * (bc + b), LAND];
            roads.push({ g, a0, a1, hw, P, bc, rect: bounds([P(a0, -hw), P(a1, hw)]) });
        }
        for (const rd of roads) {
            const { a0, a1, hw, P } = rd;
            S.kind = INK;
            S.line([P(a0, -hw), P(a1, -hw)]);
            S.line([P(a0, hw), P(a1, hw)]);
            if (T.detail) {
                S.kind = WOOD;
                for (const b of [-0.8, 0.8]) for (let a = a1 - 1; a > a0; a -= 3.2) S.line([P(a, b), P(a - 1.8, b)], true);
            }
        }
        // field grid, with lines either side of each road so no field crosses one
        const fw = rng.range(24, 32), fd = rng.range(19, 25);
        // edges stepping out both ways from the two sides of a road, or from a
        // line anywhere when there's no road
        const cuts = (lo, hi, size, road) => {
            const out = [], [c0, c1] = road || (c => [c, c])(rng.range(lo, hi));
            for (let c = c1; c < hi + size; c += size * rng.range(0.8, 1.2)) out.push(c);
            for (let c = road ? c0 : c0 - size; c > lo - size; c -= size * rng.range(0.8, 1.2)) out.push(c);
            return out.sort((a, b) => a - b);
        };
        const sRoad = roads.find(rd => rd.g.e.n[1] !== 0), wRoad = roads.find(rd => rd.g.e.n[0] !== 0);
        const xs = cuts(vx0, vx1, fw, sRoad ? [sRoad.rect[0] - 0.8, sRoad.rect[2] + 0.8] : null);
        const ys = cuts(vy0, vy1, fd, wRoad ? [wRoad.rect[1] - 0.8, wRoad.rect[3] + 0.8] : null);
        const cells = [];
        for (let i = 0; i + 1 < xs.length; i++) {
            for (let j = 0; j + 1 < ys.length; j++) {
                const r = [xs[i] + 0.9, ys[j] + 0.9, xs[i + 1] - 0.9, ys[j + 1] - 0.9];
                if (r[2] - r[0] < 8 || r[3] - r[1] < 8) continue;
                const P = rectPoly(r);
                if (!overlap(P, view) || overlap(P, glacis) || roads.some(rd => overlap(P, rectPoly(rd.rect)))) continue;
                const q = cam.project((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, LAND);
                const road = roads.find(rd => overlap(rectPoly([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3]), rectPoly(rd.rect)));
                const far = distOut(town.moat, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
                cells.push({ r, q, road, near: !!road, far });
            }
        }
        // the mill and the tournament go on fields we can see well, below the town
        const below = c => c.q[1] > S.H * 0.55 && c.q[1] < S.H * 0.95 && c.q[0] > S.W * 0.08 && c.q[0] < S.W * 0.92;
        const take = test => {
            const options = cells.filter(c => !c.kind && test(c));
            return options.length ? rng.pick(options) : null;
        };
        if (p.fair) {
            // deep enough to keep the stand, the lists and the pavilions apart
            const c = take(c => below(c) && c.near && Math.max(c.r[2] - c.r[0], c.r[3] - c.r[1]) > 20 && Math.min(c.r[2] - c.r[0], c.r[3] - c.r[1]) > 18);
            if (c) c.kind = 'fair';
        }
        if (p.mill) {
            const c = take(c => below(c) && c.r[2] - c.r[0] > 15 && c.r[3] - c.r[1] > 15);
            if (c) c.kind = 'mill';
        }
        // cottages along the roads just out of the gates
        for (let i = Math.round(p.cottages * 3); i > 0; i--) {
            const options = cells.filter(c => !c.kind && c.road && c.far < 45 && c.r[2] - c.r[0] > 12 && c.r[3] - c.r[1] > 12);
            if (!options.length) break;
            options.sort((a, b) => a.far - b.far);
            options[rng.int(0, Math.min(1, options.length - 1))].kind = 'hamlet';
        }
        // the farther from town, the more of it is woodland
        const kinds = c => [[3 * p.fields, 'furrows'], [2 * p.fields, 'strips'], [1.4, 'meadow'], [0.9, 'pasture'], [0.8, 'orchard'], [0.8 * p.fields, 'hay'],
            [1.6 * p.trees * (0.25 + c.far / 45), 'wood']];
        // far fields first, so nearer trees and haystacks stack over them in order
        cells.sort((a, b) => a.q[1] - b.q[1]);
        const outside = S.shadow;
        for (const c of cells) {
            S.shadow = outside;
            if (c.kind === 'fair') tournament(T, c.r, rng);
            else if (c.kind === 'mill') {
                field(T, c.r, 'meadow', rng);
                postMill(T, (c.r[0] + c.r[2]) / 2, (c.r[1] + c.r[3]) / 2, rng);
            } else if (c.kind === 'hamlet') hamlet(T, c, rng);
            else field(T, c.r, rng.weighted(kinds(c)), rng);
        }
        // trees along the roads, people and wagons on them
        for (const rd of roads) {
            const { a0, a1, P } = rd;
            let side = 1;
            for (let a = a1 - 12; a > a0; a -= rng.range(9, 14)) {
                side = -side;
                if (!rng.chance(0.4 + 0.5 * p.trees)) continue;
                const [x, y] = P(a, side * 4.6);
                // the cottages have their own trees, and these would stand on their fences
                if (cells.some(c => c.kind === 'hamlet' && inRect(c.r, x, y, 3))) continue;
                tree(T, x, y, LAND, rng);
            }
            const sx = rd.g.road.r, dirOut = -(sx[0] * cam.rx + sx[1] * cam.ry) >= 0 ? 1 : -1;
            for (let a = a1 - 4; a > a0; a -= rng.range(14, 26)) {
                const [x, y] = P(a, rng.range(-1.6, 1.6));
                if (depth(view, x, y) < 0) continue;
                const roll = rng.random() / Math.max(0.05, p.people);
                if (roll < 0.25) wagon(T, x, y, rd.g.e.n[1] !== 0 ? (rng.chance(0.5) ? 1 : 3) : (rng.chance(0.5) ? 0 : 2), rng);
                else if (roll < 0.45) horse(T, x, y, LAND, rng.chance(0.5) ? dirOut : -dirOut, rng, true);
                else if (roll < 1) for (let i = rng.int(1, 3); i > 0; i--) person(T, x + rng.range(-1, 1), y + rng.range(-1, 1), LAND, rng);
            }
        }
        // a few trees scattered round the edge of the meadow outside the moat
        for (let i = Math.round(14 * p.trees); i > 0; i--) {
            const x = rng.range(vx0, vx1), y = rng.range(vy0, vy1);
            const g = depth(glacis, x, y);
            if (g > 0 || g < -8 || depth(view, x, y) < 0 || roads.some(rd => inRect(rd.rect, x, y, 2.5))) continue;
            tree(T, x, y, LAND, rng);
        }
    }

    // ------------------------------------------------------------------
    // Putting it together
    // ------------------------------------------------------------------

    // Draw with every shadow cast into all the given groups at once, skipping
    // groups whose ground (g.area, when known) the shadow can't reach
    function castAll(S, groups, fn) {
        if (!groups.length) {
            S.shadow = null;
            fn();
            return;
        }
        const own = Scene.prototype.castShadow, [sx, sy] = S.sun;
        S.castShadow = function (pts) {
            const keep = this.shadow;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 0;
            for (const p of pts) {
                if (p[0] < x0) x0 = p[0];
                if (p[0] > x1) x1 = p[0];
                if (p[1] < y0) y0 = p[1];
                if (p[1] > y1) y1 = p[1];
                if (p[2] > top) top = p[2];
            }
            x0 = Math.min(x0, x0 + sx * top); x1 = Math.max(x1, x1 + sx * top);
            y0 = Math.min(y0, y0 + sy * top); y1 = Math.max(y1, y1 + sy * top);
            for (const g of groups) {
                const a = g.area;
                if (a && (a[0] > x1 || a[2] < x0 || a[1] > y1 || a[3] < y0)) continue;
                this.shadow = g;
                own.call(this, pts);
            }
            this.shadow = keep;
        };
        S.shadow = groups[0];
        fn();
        delete S.castShadow;
        S.shadow = null;
    }

    // People about the streets and guards on the walls
    function townsfolk(T, town, rng) {
        const { S, p } = T, [x0, y0, x1, y1] = bounds(town.inner);
        const busy = (x, y) => town.cells.some(c => inRect(c.rect, x, y, 0.4)) || (town.castle && x > town.castle.xc - 3 && y > town.castle.yc - 3);
        for (let i = Math.round((((x1 - x0) * (y1 - y0)) / 220) * p.people); i > 0; i--) {
            const x = rng.range(x0, x1), y = rng.range(y0, y1);
            if (depth(town.inner, x, y) < 0.6 || busy(x, y)) continue;
            person(T, x, y, LAND, rng);
        }
        for (const w of town.walls) {
            if (!rng.chance(0.35 * p.people + 0.1) || w.s1 - w.s0 < 8) continue;
            const s = rng.range(w.s0 + 4, w.s1 - 4), [x, y] = w.e.F.P(s, 0.1, 0);
            person(T, x, y, w.H, rng);
            const P = card(T, x, y, w.H, 0);
            S.kind = FIGURE;
            S.line([P(0.3, 0.2), P(0.3, 2.5)]);
            S.kind = INK;
        }
    }

    function build(T, town, seed) {
        const { S, cam, p } = T;
        const rng = new PG.RNG(hash(seed, 2));
        const C = town.castle;
        // Shadows on the moat are hatched level across the page like Harbor's
        // water. Each piece of ground gets its own group, trimmed to it at the end.
        const water = S.shadowGroup(0, null, Math.atan2(cam.ry, cam.rx));
        const trims = [];
        const group = (keep, minus = []) => {
            const g = S.shadowGroup(LAND, null, 0);
            if (g) {
                trims.push({ g, keep, minus });
                if (keep) g.area = bounds(keep);
            }
            return g;
        };
        const corner = C ? rectPoly([C.xc - C.tc / 2, C.yc - C.tc / 2, town.A + 60, town.B + 60]) : null;
        const lane = group(town.wallIn, [town.inner].concat(corner ? [corner] : []));
        const outside = group(null, [town.moat]);
        for (const c of town.cells) if (!c.castle) c.group = group(c.poly);
        const yard = C ? group(rectPoly(C.ward)) : null;
        const everywhere = [water, lane, outside, yard, ...town.cells.map(c => c.group)].filter(Boolean);

        S.shadow = null;
        banks(T, town);
        castAll(S, everywhere, () => {
            for (const w of town.walls) curtain(T, w, rng);
            for (const t of town.towers) tower(T, t, rng);
            for (const g of town.gates) gatehouse(T, g, town, rng);
            if (C) {
                gatehouse(T, C.gate, town, rng);
                keep(T, C.keep, rng);
            }
        });
        S.shadow = water;
        for (const g of town.gates) approach(T, g, town);
        for (const c of town.cells) {
            if (c.castle) continue;
            S.shadow = c.group;
            if (c.kind === 'square') marketSquare(T, c, rng);
            else if (c.kind === 'church') churchBlock(T, c, rng);
            else if (c.kind === 'houses') block(T, c, town, rng);
            else {
                S.kind = INK;
                S.loop(at3(c.poly, LAND));
                garden(T, bounds(c.poly), town, rng);
            }
        }
        S.shadow = lane;
        townsfolk(T, town, rng);
        if (C) {
            S.shadow = yard;
            ward(T, town, rng);
        }
        S.shadow = outside;
        country(T, town, new PG.RNG(hash(seed, 3)));
        S.shadow = water;
        const life = moatLife(T, town, new PG.RNG(hash(seed, 4)));
        S.shadow = null;

        for (const { g, keep: k0, minus } of trims) {
            g.polys = g.polys.flatMap(P => {
                let parts = k0 ? [clipConvex(P, k0)] : [P];
                for (const M of minus) parts = parts.flatMap(Q => (Q.length >= 3 ? minusConvex(Q, M) : []));
                return parts.filter(Q => Q.length >= 3);
            });
        }
        if (p.water) {
            // ripples keep a millimeter clear of the shadows, so they don't run
            // along the edges of the hatching or through narrow gaps in it
            const shaded = water ? water.polys.map(P => ({ P, b: bounds(P) })) : [], seen = inFront(T, town), m = 1 / T.k;
            const dark = (x, y) => shaded.some(({ P, b }) => inRect(b, x, y) && geo.pointInPolygon(x, y, P));
            const clear = (x, y) => seen(x, y) && !life.some(([u, v, r]) => Math.hypot(u - x, v - y) < r)
                && ![[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].some(([dx, dy]) => dark(x + dx, y + dy));
            ripples(T, town, clear);
        }
        if (p.shadows) {
            S.kind = BLUE;
            S.hatchShadows(p.shadowGap);
        }
    }

    // Straight lines that lie along the same line as another of the same kind
    // and overlap it, as where two houses share a wall, are drawn once
    function dedupe(S) {
        const groups = new Map(), out = [];
        const key = v => Math.round(v * 2000);
        for (const L of S.lines) {
            if (L.whole || L.q.length > 5) { out.push(L); continue; }
            for (let i = 1; i < L.q.length; i++) {
                const A = L.q[i - 1], B = L.q[i];
                let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
                const len = Math.hypot(dx, dy, dz);
                if (len < 1e-9) continue;
                dx /= len; dy /= len; dz /= len;
                if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && (dy < -1e-9 || (Math.abs(dy) <= 1e-9 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
                const ta = A[0] * dx + A[1] * dy + A[2] * dz, tb = B[0] * dx + B[1] * dy + B[2] * dz;
                const ox = A[0] - ta * dx, oy = A[1] - ta * dy, oz = A[2] - ta * dz;
                const k = [key(dx), key(dy), key(dz), key(ox), key(oy), key(oz), L.kind].join();
                let g = groups.get(k);
                if (!g) {
                    g = { kind: L.kind, d: [dx, dy, dz], o: [ox, oy, oz], spans: [] };
                    groups.set(k, g);
                    out.push(g);
                }
                g.spans.push([Math.min(ta, tb), Math.max(ta, tb)]);
            }
        }
        S.lines = [];
        for (const L of out) {
            if (!L.spans) { S.lines.push(L); continue; }
            const { d, o, kind } = L, spans = L.spans.sort((u, v) => u[0] - v[0]);
            let cur = spans[0].slice();
            const emit = ([t0, t1]) => S.lines.push({ kind, whole: false, q: [t0, t1].map(t => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]) });
            for (let i = 1; i < spans.length; i++) {
                if (spans[i][0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], spans[i][1]);
                else { emit(cur); cur = spans[i].slice(); }
            }
            emit(cur);
        }
    }

    PG.register({
        id: 'castle',
        name: 'Castle Town',
        category: 'Scenes',
        description: 'A walled town in its moat with round towers, gatehouses, a castle keep, a market square and the fields round it, in isometric ink.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'zoom', label: 'Zoom', type: 'range', min: 0.6, max: 1.6, step: 0.01, value: 1, random: false,
                hint: 'At 1 the whole moat just fits across the page. More crops in on the town' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 25, max: 60, step: 0.5, value: 40, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Walls' },
            { id: 'size', label: 'Town size (m)', type: 'range', min: 70, max: 150, step: 1, value: 104, random: [90, 120],
                hint: 'Across the walls. The camera zooms out to fit a bigger town' },
            { id: 'corners', label: 'Cut corners', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 1] },
            { id: 'wallHeight', label: 'Wall height (m)', type: 'range', min: 5, max: 10, step: 0.1, value: 7, random: [6, 8] },
            { id: 'towerGap', label: 'Tower spacing (m)', type: 'range', min: 14, max: 50, step: 1, value: 24, random: [18, 32] },
            { id: 'towerRoofs', label: 'Tower tops', type: 'select', value: 'mixed', random: ['mixed', 'mixed', 'cones', 'crenels'],
                options: [['mixed', 'Mixed'], ['cones', 'Cone roofs'], ['crenels', 'Battlements']] },
            { id: 'moat', label: 'Moat width (m)', type: 'range', min: 9, max: 24, step: 0.5, value: 13, random: [11, 16] },
            { id: 'gate2', label: 'Second gate', type: 'checkbox', value: true, random: 0.6, hint: 'A gate in the left-hand wall as well as the front' },
            { id: 'castle', label: 'Castle', type: 'checkbox', value: true, random: 0.9 },
            { id: 'keep', label: 'Keep', type: 'select', value: 'any', random: false, show: p => p.castle,
                options: [['any', 'Any'], ['turrets', 'Corner turrets'], ['square', 'Square keep'], ['round', 'Round donjon']] },
            { id: 'banners', label: 'Flags & banners', type: 'checkbox', value: true },
            { type: 'section', label: 'Town' },
            { id: 'block', label: 'Block size (m)', type: 'range', min: 16, max: 36, step: 0.5, value: 24, random: [20, 28] },
            { id: 'street', label: 'Street width (m)', type: 'range', min: 3.5, max: 7, step: 0.1, value: 4.6, random: [4, 5.5] },
            { id: 'stagger', label: 'Staggered streets', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0, 1] },
            { id: 'floors', label: 'Max stories', type: 'range', min: 2, max: 5, step: 1, value: 4, random: [3, 5] },
            { id: 'timber', label: 'Half-timbered houses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 0.9] },
            { id: 'church', label: 'Church', type: 'checkbox', value: true, random: 0.85 },
            { id: 'market', label: 'Market hall', type: 'checkbox', value: true, random: 0.7 },
            { id: 'gardens', label: 'Gardens', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.8] },
            { type: 'section', label: 'Country' },
            { id: 'fields', label: 'Plowed fields', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'furrows', label: 'Furrow spacing (mm)', type: 'range', min: 0.8, max: 4, step: 0.05, value: 1.8, random: false },
            { id: 'trees', label: 'Trees & woods', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'mill', label: 'Windmill', type: 'checkbox', value: true, random: 0.7 },
            { id: 'fair', label: 'Tournament', type: 'checkbox', value: true, random: 0.6 },
            { id: 'cottages', label: 'Cottages', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0, 1],
                hint: 'Thatched cottages along the roads out of the gates' },
            { id: 'moatLife', label: 'Swans & lilies', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1] },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Timber framing, arrow loops, stones, portcullis bars and other small line work' },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Roof hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Roof hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false,
                show: p => p.roofHatch, hint: 'Shaded slopes are hatched closer, at 60% of this' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 52, random: [44, 60],
                show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false,
                show: p => p.shadows },
            { id: 'water', label: 'Ripples', type: 'checkbox', value: true, hint: 'Ripple lines along the banks of the moat' },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        generate(p, ctx) {
            const { width: W, height: H } = ctx, seed = ctx.seed | 0;
            const town = plan(p, new PG.RNG(hash(seed, 1)));
            const view = fitCamera(p, town, W, H), k = view.k;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, view.cx, view.cy);
            const S = new Scene(cam, W, H);
            const cot = 1 / Math.tan(geo.rad(p.sun));
            const sun = [cot * Math.cos(SUN_TURN), -cot * Math.sin(SUN_TURN)];
            if (p.shadows) S.sun = sun;
            const toSun = kit.unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: GOLD } : null,
                waterKind: WATER,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.6,
                // lit if the face gets at least 3/4 of the light a flat roof does
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
                // battlements a little oversized, so they still read when the town is small on the page
                merlon: Math.max(0.9, 1.15 / k),
            };
            build(T, town, seed);
            dedupe(S);
            return PG.pens.renderScene('castle', S, p);
        },
    });
})();
