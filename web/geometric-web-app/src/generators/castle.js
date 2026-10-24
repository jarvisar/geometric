/*
 * Castle Town: a walled town standing in its moat, drawn whole with the
 * fields round it, in the same isometric scene as Harbor (lib/iso.js) and
 * shaded the same way.
 *
 * Everything is planned in meters first and the camera is fitted round the
 * moat afterwards. The wall follows a rectangle with some corners cut off,
 * so every stretch of it is square to the streets or at 45 degrees. Towers
 * stand at the corners and along the walls, the gatehouses face the camera,
 * and the castle takes the back corner or the one on the right, with the
 * town in front of its keep. Inside, the streets are a grid like a planned
 * bastide town: the gate streets meet at the market square, the church has
 * a block next to it, and the other blocks are rows of narrow houses round
 * a yard. Outside there are roads out of the gates with cottages along
 * them, a post mill, and a tournament among fields, hedges, and woods. A
 * river runs in front of the town, where the roads cross it on stone
 * bridges, or behind it, with a water mill on it, and out past the town
 * there's an abbey in its walled grounds.
 *
 * The country is a grid of fields lined up on the roads. Woods are fields
 * picked out by a smooth noise, so they come in blocks, and some fields run
 * on into the next one. The river is a curve through points square to the
 * roads, so the bridges cross it straight, and the fields stop at the
 * meadows along it (see keepDry). The river and what's on it are placed by
 * the view at a zoom of 1, so zooming doesn't move them. The field grid is
 * cut to the view, though, so it does change with the zoom.
 *
 * The seed also picks what kind of town it is (see character): the shape
 * of the walls, round or square towers and how tall they are, and a hall
 * or a belfry on the square.
 *
 * Round towers are lathes and frustums, square ones boxes, curtain walls
 * are prisms and the battlements are rows of small boxes. The church, market hall and terraces
 * come from isokit. The moat is Harbor's water: the walls throw their
 * shadows onto it and ripple lines follow the banks.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, Scene, segments, BOX, hull } = PG.iso;
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
    // Lines closer than this on paper (mm) run together under a 0.35 mm pen.
    // Small details are spaced by it, and left out where they can't be.
    const FINE = 0.7;
    const UP = [0, 0, 1];

    // Paper distance (mm) between two lines along world vector a that are
    // world vector b apart
    function apart(T, a, b) {
        const c = T.cam, on = v => [v[0] * c.rx + v[1] * c.ry, (v[0] * c.fx + v[1] * c.fy) * c.se + v[2] * c.ce];
        const p = on(a), q = on(b);
        return (c.k * Math.abs(p[0] * q[1] - p[1] * q[0])) / (Math.hypot(p[0], p[1]) || 1);
    }

    // The same for a wall's at(s, c): mm between uprights a meter apart
    // (pu) and between level lines a meter apart (pz)
    function wallScale(T, at) {
        const a = at(0, 0), b = at(1, 0), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        return { pu: Math.max(apart(T, UP, u), 1e-6), pz: Math.max(apart(T, u, UP), 1e-6) };
    }

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

    // What gives one town a different character from the next: its outline,
    // where the castle stands, the build of its towers and what it has in the
    // middle. The first three come from their menus. The rest come from a
    // stream of their own, so changing a menu leaves them, and the streets
    // and houses, as they were.
    function character(p, rng) {
        // The seed used to pick the corner, the outline and the towers here.
        // Randomize does that now, but the three draws are still made so a
        // seed gives the same town it did before.
        for (let i = 0; i < 3; i++) rng.random();
        return {
            turn: !!p.castle && p.castleAt === 'right',
            shape: p.shape, towers: p.towers,
            // how far the towers stand above the walls, and how steep their roofs are
            lofty: rng.range(0.8, 1.5), spire: rng.range(1.8, 2.7),
            stretch: rng.range(0, 1), sideways: rng.chance(0.5), belfry: rng.chance(0.35), orchard: rng.chance(0.45),
        };
    }

    function plan(p, rng, look) {
        const t = WALL, sw = p.street, main = p.street + 2;
        // The castle stands in the back corner or the one on the right. For the
        // right the town is planned just the same and given a quarter turn at
        // the end, so until then a few things have to ask which walls will
        // face us.
        const turn = look.turn;
        const world = ([x, y]) => (turn ? [y, -x] : [x, y]);
        // The outline: about square with its corners cut off by different amounts,
        // by the same amount all round, or not at all, or a town up to half as
        // long again one way as the other. A small town is stretched less, to
        // leave room in front of the castle.
        const shape = look.shape;
        const stretch = shape === 'long' ? geo.lerp(1.2, geo.clamp(p.size / 65, 1.25, 1.45), look.stretch) : rng.range(0.9, 1.1);
        const asp = shape === 'long' && look.sideways ? 1 / stretch : stretch;
        const A = (p.size / 2) * asp, B = p.size / 2 / asp, m = Math.min(A, B);
        // cut corners, leaving every wall long enough for a gate or a couple of towers
        const even = shape === 'octagon' ? Math.min(m - 24, p.corners * m * rng.range(0.45, 0.65)) : 0;
        const cut = () => {
            if (shape === 'square') return 0;
            const v = shape === 'octagon' ? even : rng.chance(0.85) ? Math.min(m - 24, p.corners * m * rng.range(0.4, 0.75)) : 0;
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
            // where the seed used to pick the keep
            rng.random();
            const type = p.keep, h = LAND + rng.range(20, 24);
            castle.keep = { x: kx, y: ky, w: kw, h, type, top: h + (type === 'square' ? 5 : kw * 0.95) };
            castle.local = { ward, kx, ky };
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
        // the second gate goes in the other wall that faces us
        const second = turn ? right : left;
        if (p.gate2 && second) {
            const ly0 = Math.min(second.a[1], second.b[1]) + 16, ly1 = Math.min(Math.max(second.a[1], second.b[1]) - 16, castle ? yL - sw - 9 : Infinity);
            if (ly1 > ly0) {
                yg = rng.range(ly0, ly1);
                gates.push({ e: second, s: Math.abs(yg - second.a[1]), x: second.a[0], y: yg });
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
        const endOn = e => {
            const d = world(e.d);
            return diagonal(e) && e.len * Math.abs(d[0] * Math.cos(yaw) - d[1] * Math.sin(yaw)) < 10.5;
        };
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
            castle.edges = [side, fore];
            castle.gate = { e: fore, s: castle.gx - xc, x: castle.gx, y: yc, castle: true };
            fore.stops.push({ s: castle.gate.s, kind: 'gate', gate: castle.gate });
            const o = { z0: LAND, zi: LAND, H: castle.H, castle: true };
            run(side, [{ s: 0, r: 3.7, tw: castle.joins[0].tw }, { s: side.len, r: ct.r, tw: ct }], o);
            run(fore, [{ s: 0, r: ct.r, tw: ct }, ...stopsOf(fore, true), { s: fore.len, r: 3.7, tw: castle.joins[1].tw }], o);
        }

        // One town's towers are round, another's square, and some have square
        // ones along the walls between round ones at the corners and gates.
        // They also differ in how far they stand above the walls and how
        // steep their roofs are.
        const built = look.towers, { lofty, spire } = look;
        for (const tw of towers) {
            tw.z0 = tw.castle ? LAND : 0;
            const base = tw.castle ? castle.H : H;
            tw.h = base + (tw.kind === 'gate' ? rng.range(4, 5) : rng.range(3.2, 5)) * lofty + (tw.kind === 'corner' || tw.kind === 'castle' ? 1.6 : 0);
            tw.roof = towerRoof(p.towerRoofs, tw, rng);
            tw.spire = spire;
            tw.top = tw.h + (tw.roof === 'crenel' ? 2.4 : (tw.r + 1) * (spire + 0.25) + 1.5);
            if (built === 'square' || (built === 'mixed' && (tw.kind === 'wall' || tw.kind === 'join'))) tw.hw = tw.r * 0.88;
        }
        // the two towers of a gate match
        for (const g of gates.concat(castle ? [castle.gate] : [])) {
            const [t0, t1] = g.towers;
            Object.assign(t1, { h: t0.h, roof: t0.roof, top: t0.top, hw: t0.hw });
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
            const behind = y0 < qy0 + 1 || (turn ? x1 > qx1 - 1 : x0 < qx0 + 1) ? 14 : 0;
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
        // in some towns one of the smaller blocks is a walled orchard
        const plots = usable.filter(cl => cl.kind === 'houses' && cl.area < 420);
        if (look.orchard && plots.length > 3) rng.pick(plots).kind = 'orchard';

        // the quarter turn, and the castle's ground for the things that keep off it
        const turnRect = r => bounds([world([r[0], r[1]]), world([r[2], r[3]])]);
        if (castle) {
            Object.assign(castle, {
                zone: turnRect([castle.xc - castle.tc / 2, castle.yc - castle.tc / 2, A + 60, B + 60]), ward: turnRect(castle.ward),
                to: (x, y) => world([x, y]), turn: turn ? 3 : 0,
            });
        }
        if (turn) {
            for (const e of edges.concat(castle.edges)) {
                for (const k of ['a', 'b', 'd', 'n']) e[k] = world(e[k]);
                e.F = turned(e.a[0], e.a[1], 0, Math.atan2(e.d[1], e.d[0]));
            }
            for (const o of towers.concat(gates, [castle.gate, castle.keep])) [o.x, o.y] = world([o.x, o.y]);
            for (const cl of cells) {
                cl.rect = turnRect(cl.rect);
                cl.poly = cl.poly.map(world);
            }
        }
        const outline = poly.map(world);
        return {
            H, look, poly: outline, edges, inner: inner.map(world), gates, castle, towers, walls, cells, square: square && square.cl,
            wallIn: offset(outline, -t / 2), foot: offset(outline, t / 2 + 0.8), moat: offset(outline, t / 2 + p.moat),
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

    // Where the line v (in from the wall's center line) crosses a tower, as
    // [s0, s1] along the wall, or null when it misses. A square tower (one with
    // a half width hw) is square to the axes whatever way the wall runs. `grow`
    // makes the tower that much bigger, for its foot.
    function across(e, tw, v, grow = 0) {
        const dx = tw.x - e.a[0], dy = tw.y - e.a[1];
        const sc = dx * e.d[0] + dy * e.d[1], vc = -(dx * e.n[0] + dy * e.n[1]), r = (tw.hw || tw.r) + grow;
        if (!tw.hw) {
            const q = r * r - (v - vc) * (v - vc);
            return q > 0 ? [sc - Math.sqrt(q), sc + Math.sqrt(q)] : null;
        }
        // from the tower's center the line is o + u * d, and has to stay within r on both axes
        const o = [-(v - vc) * e.n[0], -(v - vc) * e.n[1]];
        let u0 = -Infinity, u1 = Infinity;
        for (const k of [0, 1]) {
            if (Math.abs(e.d[k]) < 1e-9) {
                if (Math.abs(o[k]) >= r) return null;
                continue;
            }
            const a = (-r - o[k]) / e.d[k], b = (r - o[k]) / e.d[k];
            u0 = Math.max(u0, Math.min(a, b));
            u1 = Math.min(u1, Math.max(a, b));
        }
        return u1 > u0 ? [sc + u0, sc + u1] : null;
    }

    // The same, as the middle of the tower when the line misses it
    function chord(e, tw, v) {
        const dx = tw.x - e.a[0], dy = tw.y - e.a[1], sc = dx * e.d[0] + dy * e.d[1];
        return across(e, tw, v) || [sc, sc];
    }

    // The crease up a wall face where a tower comes through it, from [v, height]
    // pairs up the face. `far` picks the tower's far side along the wall. The
    // scene only draws each solid's own edges, so without these the wall and
    // the tower run together and the tower's foot and string course stop in
    // mid air.
    function crease(T, e, tw, far, prof) {
        const pts = [];
        for (const [v, c] of prof) {
            // the battered foot is wider
            const hit = across(e, tw, v, tw.z0 < LAND - 0.5 ? 0.75 * geo.clamp(1 - (c - tw.z0) / (LAND - 0.05 - tw.z0), 0, 1) : 0);
            if (!hit) return;
            pts.push(e.F.P(hit[far ? 1 : 0], v, c));
        }
        T.S.line(pts);
    }

    // A battered foot's face as [v, height] pairs, out from v at its top
    const batter = (v, z0, out, h) => [0, 0.25, 0.5, 0.75, 1].map(f => [v - out * (1 - f), z0 + h * f]);

    // A few stones picked out on a wall face, in twos and threes like a brick
    // pattern. Too small on paper to show their faces, they're drawn as their
    // bed joints alone.
    function masonry(T, at, s0, s1, c0, c1, rng) {
        const S = T.S, { pu, pz } = wallScale(T, at);
        const open = 0.6 * pz >= 1.5 * FINE, bw = open ? 1.3 : Math.max(1.3, (2.4 * FINE) / pu), bh = open ? 0.6 : Math.max(0.6, FINE / pz);
        const stone = (u, c) => (open ? S.loop([at(u, c), at(u + bw, c), at(u + bw, c + bh), at(u, c + bh)])
            : S.line([at(u + bw * 0.2, c), at(u + bw * 0.8, c)]));
        for (let i = Math.floor((s1 - s0) / 9); i > 0; i--) {
            if (s1 - s0 < 2 * bw + 0.6 || c1 - c0 < 2 * bh + 0.3) return;
            const u = rng.range(s0 + 0.3, s1 - 2 * bw - 0.2), c = rng.range(c0, c1 - 2 * bh - 0.1);
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
        const vo = -t / 2, vi = vo + 0.55, top = H + 1.05;
        const [sA, sB] = span(vo, vi), seen = T.sees(F.V(0, -1, 0));
        const { pu, pz } = wallScale(T, (s, c) => P(s, 0, c));
        if (sB - sA > T.merlon) {
            along(S, F, [[vo, H], [vi, H], [vi, top], [vo, top]], sA, sB, k0, k1);
            // Merlons are stretched along a wall that runs away from us, so
            // they stay FINE across on paper. Seen nearly end on they'd stack
            // up into a ladder whatever their size, and the wall gets none.
            const mw = Math.max(T.merlon, FINE / pu), gap = mw, mh = T.merlon * 0.85;
            const n = mw > 2.5 * T.merlon ? 0 : Math.max(1, Math.floor((sB - sA + gap) / (mw + gap)));
            const lead = (sB - sA - n * mw - (n - 1) * gap) / 2;
            for (let i = 0; i < n; i++) {
                const s = sA + lead + i * (mw + gap);
                S.box(F, s, vo, top, s + mw, vi, top + mh);
                if (seen && T.detail && i % 2 === 0 && mw * pu >= 2 * FINE) S.line([P(s + mw / 2, vo - 0.01, top + 0.15), P(s + mw / 2, vo - 0.01, top + mh * 0.75)]);
            }
            if (seen && T.detail) masonry(T, (u, c) => P(u, vo - 0.01, c), sA, sB, w.z0 + 2.8, H - 0.3, rng);
        }
        // Tall enough that its top and the edge of the walk are two lines, up to
        // the height of the parapet. Along a wall seen too nearly end on for
        // that it's left out, where it would only thicken the edge of the walk.
        const [sC, sD] = span(t / 2 - 0.35, t / 2), bk = H + geo.clamp(FINE / pz, 0.75, 1.05);
        if (sD - sC > 1 && (bk - H) * pz >= 0.75 * FINE) along(S, F, [[t / 2 - 0.35, H], [t / 2, H], [t / 2, bk], [t / 2 - 0.35, bk]], sC, sD, k0, k1);
        // where the wall runs into its towers
        const foot = w.z0 < LAND - 0.5;
        [w.t0, w.t1].forEach((tw, i) => {
            if (!tw) return;
            crease(T, e, tw, !i, (foot ? batter(vo, w.z0, 0.8, 2.4) : [[vo, w.z0]]).concat([[vo, H]]));
            crease(T, e, tw, !i, [[t / 2, w.zi], [t / 2, H]]);
        });
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

    // Arrow loops up the side of a tower we see, each a slit with a cross arm.
    // None go across the string course, between heights b0 and b1.
    function loops(T, tw, z0, b0, b1) {
        if (!T.detail) return;
        const S = T.S, { x, y, r } = tw, face = Math.atan2(-T.cam.fy, -T.cam.fx), R = r + 0.02;
        const at = (a, u, c) => { const b = a + u / R; return [x + R * Math.cos(b), y + R * Math.sin(b), c]; };
        const levels = Math.max(1, Math.floor((tw.h - z0 - 2.5) / 3.4)), clear = FINE / (T.k * T.cam.ce);
        for (let i = 0; i < levels; i++) {
            const c = z0 + 1.8 + i * 3.4;
            if (c < b1 + clear && c + 1.3 > b0 - clear) continue;
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
        // corbels narrower than the pen only show as a row of dots
        if (0.3 * T.k >= 0.5) for (let i = 0; i < m; i++) S.box(turned(x, y, 0, a0 + (TAU * (i + 0.5)) / m), r - 0.3, -0.15, z - 0.7, R - 0.03, 0.15, z);
        S.frustum(x, y, z, z + 1.1, R, R, n);
        S.loop(ring(n, (c, s) => [x + (R - 0.5) * c, y + (R - 0.5) * s, z + 1.1]));
        for (let i = 0; i < m; i++) S.box(turned(x, y, 0, a0 + (TAU * i) / m), R - 0.5, -mw / 2, z + 1.1, R, mw / 2, z + 1.1 + mw * 0.85);
    }

    // Timber fighting gallery round the top of a tower, under its roof
    function hoarding(T, x, y, r, z, n) {
        const S = T.S, cam = T.cam, R = r + 0.6, face = Math.atan2(-cam.fy, -cam.fx);
        S.kind = WOOD;
        S.frustum(x, y, z, z + 1.7, R, R, n);
        if (T.detail) {
            // boards the same distance apart on paper all the way across, so
            // they don't close up where the gallery turns away at the sides
            const q = R * 1.015 + 0.01, step = Math.max(0.7, (1.2 * FINE) / T.k), m = Math.max(2, Math.round((2 * q) / step));
            for (let i = 1; i < m; i++) {
                const u = -q + (2 * q * i) / m, d = Math.sqrt(q * q - u * u), px = x + cam.rx * u - cam.fx * d, py = y + cam.ry * u - cam.fy * d;
                S.line([[px, py, z + 0.15], [px, py, z + 1.55]]);
            }
            // the braces under it are only ticks at a small scale
            for (let i = 0; T.k >= 1.8 && i < 7; i++) {
                const a = face - 1.2 + (2.4 * i) / 6, c = Math.cos(a), s = Math.sin(a);
                S.line([[x + r * c, y + r * s, z - 1], [x + R * c, y + R * s, z]]);
            }
        }
        S.kind = INK;
    }

    // Round tower (square ones go to squareTower): a battered foot where it stands in the moat, a string course,
    // arrow loops, and a cone roof, a timber gallery under a cone, or battlements
    function tower(T, tw, rng) {
        if (tw.hw) return squareTower(T, tw, rng);
        const S = T.S, { x, y, r } = tw, n = Math.max(28, T.segs(r + 0.8));
        S.kind = INK;
        let z = tw.z0;
        // the battered foot stops just under the ground, or its top would show
        // as a stray arc where the tower bulges into the town
        if (z < LAND - 0.5) {
            S.frustum(x, y, z, LAND - 0.05, r + 0.75, r, n);
            z = LAND - 0.05;
        }
        // the string course is deep enough for its two edges to show apart
        const zs = geo.lerp(z, tw.h, 0.6), band = Math.max(0.3, FINE / (T.k * T.cam.ce));
        drum(S, x, y, r, z, zs, n);
        S.frustum(x, y, zs, zs + band, r + 0.14, r + 0.14, n);
        drum(S, x, y, r, zs + band, tw.h, n);
        shadeRound(T, x, y, z, tw.h, r, r);
        loops(T, tw, Math.max(z, LAND), zs, zs + band);
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
        const hc = R * tw.spire;
        S.kind = INK;
        cone(T, x, y, R, zr, hc, n);
        if (T.p.banners) flag(T, x, y, zr + hc - 0.1, 2.6);
        else S.line([[x, y, zr + hc], [x, y, zr + hc + 1]]);
    }

    // Square tower, set square to the page whatever way its wall runs. It has
    // the same foot, string course, arrow loops and tops as a round one, with
    // the side away from the sun hatched.
    function squareTower(T, tw, rng) {
        const S = T.S, { x, y, hw } = tw, F = frame(x, y, 0, 0), P = F.P, fp = [-hw, -hw, hw, hw];
        S.kind = INK;
        let z = tw.z0;
        if (z < LAND - 0.5) {
            const g = hw + 0.75, top = LAND - 0.05;
            S.solid([P(-g, -g, z), P(g, -g, z), P(g, g, z), P(-g, g, z), P(-hw, -hw, top), P(hw, -hw, top), P(hw, hw, top), P(-hw, hw, top)], BOX);
            z = top;
        }
        const zs = geo.lerp(z, tw.h, 0.6), band = Math.max(0.3, FINE / (T.k * T.cam.ce));
        S.box(F, -hw, -hw, z, hw, hw, tw.h);
        S.box(F, -hw - 0.14, -hw - 0.14, zs, hw + 0.14, hw + 0.14, zs + band);
        // lines up or down a face we see, FINE or more apart, between heights c0 and c1
        const lines = (W, gap, c0, c1) => {
            const n = Math.max(1, Math.floor(W.len / Math.max(gap, FINE) * wallScale(T, W.at).pu));
            for (let i = 1; i < n; i++) S.line([W.at((W.len * i) / n, c0), W.at((W.len * i) / n, c1)]);
        };
        // the face towards -y is the one out of the sun, as on the houses
        const dark = wall(F, 0, fp), lit = wall(F, 3, fp);
        if (T.tones && T.sees(dark.n)) lines(dark, T.hLit, z, tw.h);
        if (T.detail && T.sees(lit.n)) {
            const z0 = Math.max(z, LAND), clear = FINE / (T.k * T.cam.ce);
            for (let i = 0, levels = Math.max(1, Math.floor((tw.h - z0 - 2.5) / 3.4)); i < levels; i++) {
                const c = z0 + 1.8 + i * 3.4;
                if (c < zs + band + clear && c + 1.3 > zs - clear) continue;
                for (const u of i % 2 ? [0.28, 0.72] : [0.5]) {
                    S.line([lit.at(2 * hw * u, c), lit.at(2 * hw * u, c + 1.3)]);
                    S.line([lit.at(2 * hw * u - 0.25, c + 0.75), lit.at(2 * hw * u + 0.25, c + 0.75)]);
                }
            }
        }
        if (tw.roof === 'crenel') {
            // A parapet standing out a little, with a block on each corner and
            // merlons between them where there's room. The keep's battlements
            // have a wall walk inside them, which at a tower's size is only
            // more lines next to these.
            const g = hw + 0.45, top = tw.h + 1.05, mw = Math.min(T.merlon, (2 * g) / 3), mh = T.merlon * 0.85;
            S.box(F, -g, -g, tw.h - 0.4, g, g, top);
            for (const u of [-g, g - mw]) for (const v of [-g, g - mw]) S.box(F, u, v, top, u + mw, v + mw, top + mh);
            const n = Math.floor((2 * g - mw) / (2 * mw)) - 1, th = 0.55;
            for (let i = 1; i <= n; i++) {
                const u = -g + ((2 * g - mw) * i) / (n + 1);
                S.box(F, u, -g, top, u + mw, -g + th, top + mh);
                S.box(F, u, g - th, top, u + mw, g, top + mh);
                S.box(F, -g, u, top, -g + th, u + mw, top + mh);
                S.box(F, g - th, u, top, g, u + mw, top + mh);
            }
            if (T.p.banners && rng.chance(0.4)) flag(T, x, y, top, 3.2);
            return;
        }
        let e = hw, zr = tw.h;
        if (tw.roof === 'hoard') {
            e = hw + 0.6;
            S.kind = WOOD;
            S.box(F, -e, -e, zr, e, e, zr + 1.7);
            if (T.detail) {
                for (const side of [0, 3]) {
                    const W = wall(F, side, [-e, -e, e, e]);
                    if (T.sees(W.n)) lines(W, 1.2 * FINE, zr + 0.15, zr + 1.55);
                }
            }
            S.kind = INK;
            zr += 1.7;
        }
        const g = e + 0.4, zb = zr - 0.25, apex = [x, y, zb + g * tw.spire];
        const rim = [P(-g, -g, zb), P(g, -g, zb), P(g, g, zb), P(-g, g, zb)];
        S.solid(rim.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        for (let i = 0; i < 4; i++) {
            const tri = [rim[i], rim[(i + 1) % 4], apex], n = outward(tri, [x, y, zb + 1]);
            // The side towards -x is red however steep the roof. A spire is too
            // steep to count as lit, and would come out black all round.
            shade(T, tri, n, n[0] < -Math.abs(n[1]) ? 'lit' : 'roof');
        }
        if (T.p.banners) flag(T, x, y, apex[2] - 0.1, 2.6);
        else S.line([apex, [x, y, apex[2] + 1]]);
    }

    // The foot of a tower where it stands on the ground inside the walls: the
    // part of its outline that isn't in a wall. The tower itself leaves its
    // bottom rim out, since most of that is under the ground or in the wall.
    function footing(T, tw, town) {
        // a square tower standing on the ground has its own bottom edges
        if (tw.hw && tw.z0 > LAND - 0.5) return;
        const S = T.S, R = (tw.hw || tw.r) * 1.015 + 0.003, n = 96, step = TAU / n, half = WALL / 2 - 0.01;
        const at = a => {
            const c = Math.cos(a), s = Math.sin(a), q = tw.hw ? R / Math.max(Math.abs(c), Math.abs(s)) : R;
            return [tw.x + q * c, tw.y + q * s, LAND];
        };
        const open = a => {
            const [x, y] = at(a);
            if (depth(town.wallIn, x, y) <= 0) return false;
            return !town.walls.some(w => {
                if (!w.castle) return false;
                const e = w.e, dx = x - e.a[0], dy = y - e.a[1], s = dx * e.d[0] + dy * e.d[1];
                return s > w.s0 && s < w.s1 && Math.abs(dx * e.n[0] + dy * e.n[1]) < half;
            });
        };
        // where the ground stops between a, which is on it, and b
        const edge = (a, b) => {
            for (let i = 0; i < 14; i++) {
                const m = (a + b) / 2;
                if (open(m)) a = m;
                else b = m;
            }
            return a;
        };
        const on = Array.from({ length: n }, (_, i) => open(i * step)), i0 = on.indexOf(false);
        S.kind = INK;
        if (i0 < 0) {
            S.loop(on.map((_, i) => at(i * step)));
            return;
        }
        let run = null;
        for (let j = 1; j <= n; j++) {
            const a = (i0 + j) * step;
            if (on[(i0 + j) % n]) {
                if (!run) run = [at(edge(a, a - step))];
                run.push(at(a));
            } else if (run) {
                run.push(at(edge(a - step, a)));
                S.line(run);
                run = null;
            }
        }
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
    // passage dark behind it, and a coat of arms over a gate with a drawbridge
    function gateArch(T, at, s, c, hw, drop) {
        const S = T.S, { pu, pz } = wallScale(T, at);
        const A = pointed(at, s, c, hw, c + (drop ? 3 : 2.6));
        S.line(A.pts);
        if (T.detail) {
            // bars FINE apart on paper, so the portcullis shows as a grille
            // and not a black hole
            const pb = c + 2.1, du = Math.max(0.42, FINE / pu), dz = Math.max(0.55, FINE / pz);
            const nb = Math.max(1, Math.floor((2 * hw - 0.3) / du)), bar = i => s + (i - (nb - 1) / 2) * du;
            for (let i = 0; i < nb; i++) S.line([at(bar(i), A.under(bar(i)) - 0.03), at(bar(i), pb - 0.25)]);
            for (let z = pb + 0.15; z < A.apex - 0.3; z += dz) {
                // as wide as the arch is at this height
                let u0 = s - hw;
                while (A.under(u0) < z && u0 < s) u0 += 0.05;
                S.line([at(u0, z), at(2 * s - u0, z)]);
            }
            // the passage behind it, hatched between the bars
            for (let i = 0; i <= nb; i++) {
                const u = bar(i) - du / 2;
                if (hw - Math.abs(u - s) >= du * 0.6) S.line([at(u, c + 0.02), at(u, pb - 0.3)]);
            }
        }
        if (drop) arms(T, at, s, c + drop + 0.7);
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
        const foot = z0 < LAND - 0.5;
        S.box(F, s - bw, vf, z0, s + bw, t / 2 + 0.4, top);
        if (foot) S.prism([P(s - bw, vf, z0), P(s - bw, vf - 0.7, z0), P(s - bw, vf, z0 + 2.2)], F.V(2 * bw, 0, 0));
        // corbels under a parapet standing out from the front, when they're
        // wide enough on paper to be more than a row of dots
        const pv = vf - 0.55, n = Math.max(3, Math.round((2 * bw) / 0.85));
        for (let i = 0; 0.26 * T.k >= 0.5 && i < n; i++) {
            const u = s - bw + (2 * bw * (i + 0.5)) / n;
            S.box(F, u - 0.13, pv + 0.03, top - 1.6, u + 0.13, vf, top - 0.95);
        }
        S.box(F, s - bw, pv, top - 0.95, s + bw, vf + 0.3, top + 0.15);
        // merlons in the part of the parapet that's clear of the towers
        const mw = T.merlon, m = Math.max(1, Math.floor((2 * bw - 0.6 + mw) / (2 * mw)));
        for (let i = 0; i < m; i++) {
            const u = s - (m - 0.5) * mw + 2 * mw * i;
            S.box(F, u, pv, top + 0.15, u + mw, pv + 0.5, top + 0.15 + mw * 0.85);
        }
        // where the block and its parapet run into the gate's towers
        g.towers.forEach((tw, i) => {
            crease(T, e, tw, !i, (foot ? batter(vf, z0, 0.7, 2.2) : [[vf, z0]]).concat([[vf, top - 0.95]]));
            crease(T, e, tw, !i, [[pv, top - 0.95], [pv, top + 0.15]]);
        });
        const R = gableRoof(T, F, [s - bw + 0.45, vf + 0.5, s + bw - 0.45, t / 2 + 0.3], top, true, geo.rad(50), rng, { attic: false });
        shadeGable(T, F, R);
        if (T.sees(F.V(0, -1, 0))) {
            const at = (u, c) => P(u, vf - 0.01, c);
            gateArch(T, at, s, LAND, hw, castleGate ? 0 : 4.6);
            if (castleGate) arms(T, at, s, LAND + 5.6);
        }
    }

    // Where the road out of a gate runs and where its bridge and drawbridge
    // go. a runs along the road towards the gate and b across it from the
    // side we see.
    function gateRoad(g, p) {
        const t = WALL, e = g.e;
        const r = [-e.n[0], -e.n[1]], across = e.n[1] !== 0 ? [1, 0] : [0, 1], wB = 4.4;
        const aC = g.x * r[0] + g.y * r[1], b0 = g.x * across[0] + g.y * across[1] - wB / 2;
        const F = {
            P: (a, b, c) => [r[0] * a + across[0] * (b0 + b), r[1] * a + across[1] * (b0 + b), c],
            V: (a, b, c) => [r[0] * a + across[0] * b, r[1] * a + across[1] * b, c],
        };
        const aGate = aC - t / 2 - 1.5, aBank = aC - t / 2 - p.moat, Ldb = 4.6;
        let aPier = aGate - Ldb, ramp = bridgeRamp(aPier - 3 - aBank);
        ramp = bridgeRamp(aPier - ramp - 0.3 - aBank);
        const aArch = aPier - ramp - 0.3, arched = aArch - aBank > 2.5;
        // a moat too narrow for the bridge, and the drawbridge comes down on the bank
        if (!arched) {
            aPier = aBank;
            ramp = 0;
        }
        return { F, aBank, ramp, wB, r, across, b0, aGate, aPier, aArch, arched, Ldb };
    }

    // The way over the moat to a gate: a stone bridge out to a pier, then the
    // drawbridge down from the gate, its chains up to the gatehouse
    function approach(T, g) {
        const S = T.S, { F, aBank, wB, aGate, aPier, aArch, arched, Ldb } = g.road;
        S.kind = INK;
        if (arched) {
            S.box(F, aArch, -0.25, 0, aPier, wB + 0.25, LAND - 0.05);
            kit.bridge(T, F, aBank, aArch, wB, LAND, 0, true);
        }
        S.kind = WOOD;
        S.box(F, aPier, 0.55, LAND - 0.22, aGate, wB - 0.55, LAND + 0.04);
        if (T.detail) {
            // planks, no closer on paper than the pen can keep apart
            const n = Math.max(1, Math.floor((aGate - aPier) / Math.max(0.45, (1.2 * FINE) / Math.max(apart(T, F.V(0, 1, 0), F.V(1, 0, 0)), 1e-6))));
            for (let i = 1; i < n; i++) {
                const a = aPier + ((aGate - aPier) * i) / n;
                S.line([F.P(a, 0.55, LAND + 0.04), F.P(a, wB - 0.55, LAND + 0.04)]);
            }
        }
        S.kind = INK;
        for (const b of [0.75, wB - 0.75]) S.line([F.P(aGate, b, LAND + Ldb + 0.55), F.P(aPier + 0.25, b, LAND + 0.06)]);
        g.keepOut = [Math.min(aBank, aPier) - 1, aGate];
    }

    // ------------------------------------------------------------------
    // The moat and the ground
    // ------------------------------------------------------------------

    // The ground faces that hide the water's shadows under them, and the stone
    // bank round the outside of the moat. The shadows are cut to the moat as
    // well, so the faces only go as far as the glacis and leave the river open.
    function banks(T, town) {
        const S = T.S, M = town.moat, n = M.length, far = offset(M, 7);
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
            for (const t of inTowers) d = Math.min(d, (t.hw ? Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) - t.hw : Math.hypot(x - t.x, y - t.y) - t.r) - 0.75);
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
            // each pad clear of the others and of the bank, and big enough on paper to show its notch
            const n = rng.int(3, 7), own = [], clear = 0.5 / T.k;
            for (let j = 0; j < n; j++) {
                const x = at[0] + rng.range(-2.2, 2.2), y = at[1] + rng.range(-2.2, 2.2), r = Math.max(rng.range(0.45, 0.8), 0.55 / T.k);
                if (dist(x, y) < r + clear || own.some(([u, v, q]) => Math.hypot(u - x, v - y) < q + r + clear)) continue;
                lily(T, x, y, r, rng);
                own.push([x, y, r]);
            }
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
    function swan(T, x, y, dir, z = 0) {
        const S = T.S, P0 = card(T, x, y, z, 0), P = (u, w) => P0(u * dir, w);
        const body = [P(-0.8, 0.02), P(0.62, 0.02), P(0.72, 0.2), P(0.45, 0.42), P(-0.35, 0.5), P(-0.85, 0.32)];
        S.kind = INK;
        S.face(body);
        S.loop(body);
        S.line([P(0.42, 0.38), P(0.58, 0.75), P(0.5, 1.1), P(0.56, 1.32), P(0.7, 1.36), P(0.9, 1.28)]);
        S.line([P(-0.4, 0.3), P(0.2, 0.36)]);
        S.kind = WATER;
        for (const s of [-1, 1]) S.line([P0(-0.95 * dir, 0), [x - dir * 1.9 * T.cam.rx + s * 0.6 * T.cam.fx, y - dir * 1.9 * T.cam.ry + s * 0.6 * T.cam.fy, z]]);
        S.kind = INK;
    }

    // Round leaf with a notch cut in it. It covers the water under it, so the
    // shadow hatching doesn't run through the leaf.
    function lily(T, x, y, r, rng) {
        const S = T.S, a0 = rng.range(0, TAU), pts = [[x, y, 0.01]];
        for (let i = 0; i <= 12; i++) {
            const a = a0 + 0.45 + ((TAU - 0.9) * i) / 12;
            pts.push([x + r * Math.cos(a), y + r * Math.sin(a), 0.01]);
        }
        S.face(pts.slice(1), false);
        inKind(S, GREEN, () => S.loop(pts));
    }

    // ------------------------------------------------------------------
    // Houses
    // ------------------------------------------------------------------

    // isokit's windows, kept FINE wide and FINE apart on paper. A wall that's
    // small on the page or turned away from us gets fewer, wider ones, and
    // none once they'd be twice their real width.
    function panes(T, W, o) {
        const { pu, pz } = wallScale(T, W.at), m = FINE / pu;
        if (m > 2 * o.winW) return false;
        return windows(T, W, { ...o, winW: Math.max(o.winW, m), gap: Math.max(o.gap, m), winH: geo.clamp(FINE / pz, o.winH, Math.max(o.winH, FLOOR - 1.2)) });
    }

    // Half-timbering over one story of a wall: posts, a rail under the windows
    // and one over them, and braces in the bays at the ends, leaning in towards
    // the middle. The windows are the middle bays between the two rails, with
    // the posts for their sides. Posts and rails keep FINE apart on paper: a
    // small or foreshortened wall gets fewer bays, and one rail if there isn't
    // the height for two, which leaves it no windows.
    function timbered(T, W, c0, c1) {
        if (!T.sees(W.n)) return;
        const S = T.S, L = W.len, at = W.at, { pu, pz } = wallScale(T, at);
        const n = Math.max(2, Math.round(L / Math.max(1.15, (2 * FINE) / pu))), bw = L / n;
        const tall = (c1 - c0) * pz, two = tall >= 3.5 * FINE;
        const sill = two ? c0 + Math.max(0.8, FINE / pz) : c0 + (c1 - c0) * 0.42, head = two ? c1 - Math.max(0.5, FINE / pz) : c1;
        const win = i => two && (n < 3 || (i > 0 && i < n - 1 && !(n >= 5 && i === (n - 1) / 2)));
        // a mullion down each window that's wide enough for one
        if (T.detail && bw * pu >= 2.4 * FINE) {
            for (let i = 0; i < n; i++) if (win(i)) S.line([at((i + 0.5) * bw, sill), at((i + 0.5) * bw, head)]);
        }
        S.kind = WOOD;
        for (let i = 1; i < n; i++) S.line([at(i * bw, c0), at(i * bw, c1)]);
        if (tall >= 2 * FINE) S.line([at(0, sill), at(L, sill)]);
        if (two) S.line([at(0, head), at(L, head)]);
        if (T.detail) {
            for (let i = 0; i < n; i++) {
                const s0 = i * bw, s1 = s0 + bw;
                if (!win(i)) {
                    // with one rail the middle bays stay plain
                    if (!two && i > 0 && i < n - 1) continue;
                    if ((i + 0.5) * bw < L / 2) S.line([at(s0, c0), at(s1, head)]);
                    else S.line([at(s1, c0), at(s0, head)]);
                } else if ((sill - c0) * pz >= 2 * FINE) {
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
        // king post, collar and braces in the gable, when it's wide enough on paper to keep them apart
        if (o.gable && o.timber && T.sees(F.V(0, -1, 0)) && T.detail && R.hw * wallScale(T, (u, c) => P(u, front, c)).pu >= 2.5 * FINE) {
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
            else panes(T, Wf, { base: c0 - 0.1, floors: 1, style: 'frame', winW: 0.9, winH: 1.4, gap: 0.65 });
        }
        panes(T, wall(F, 2, fp), { base: 0, floors: o.floors, style: 'frame', winW: 0.85, winH: 1.3, gap: 0.9 });
        for (const side of [3, 1]) {
            if (!o.ends[side === 3 ? 0 : 1]) continue;
            for (const [c0, , bf] of stories) panes(T, wall(F, side, [a0, bf, a1, b1]), { base: c0 - 0.1, floors: 1, style: 'frame', winW: 0.85, winH: 1.3, gap: 1.3 });
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
                // rows FINE apart on paper, evenly across the bed
                const rows = Math.max(1, Math.floor(bw / Math.max(0.55, FINE / Math.max(apart(T, [0, 1, 0], [1, 0, 0]), 1e-6))));
                for (let i = 1; i < rows; i++) S.line([[x + (bw * i) / rows, y + 0.2, LAND], [x + (bw * i) / rows, y + bd - 0.2, LAND]]);
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

    function marketSquare(T, cell, town, rng) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = cell.rect, w = x1 - x0, d = y1 - y0;
        S.kind = INK;
        S.loop(at3(rectPoly(cell.rect), LAND));
        S.loop(at3(rectPoly([x0 + 1.1, y0 + 1.1, x1 - 1.1, y1 - 1.1]), LAND));
        const F = frame(x0, y0, LAND, 0), occ = new Occupancy(w, d);
        // how far back the fountain or cross can go and stay clear of the hall
        let room = d - 1;
        if (p.market && w >= 15 && d >= 15) {
            if (town.look.belfry) {
                // a belfry where the hall would stand, isokit's clock tower a third bigger
                const m = 1.35, g = 1.9 * m, b = d - g - 1.6;
                kit.clockTower(T, scaled(frame(...F.P(w / 2, b, 0), 0), m), 0, 0, rng);
                occ.add(w / 2 - g - 0.6, b - g - 1, w / 2 + g + 0.6, b + g + 0.6);
                room = b - g - 1;
            } else {
                const L = Math.min(w - 4.5, rng.range(12, 16)), D = rng.range(6.5, 7.5), a = (w - L) / 2, b = d - D - 1.6;
                marketHall(T, F, [a, b, a + L, b + D], rng);
                occ.add(a - 0.6, b - 1, a + L + 0.6, b + D + 0.6);
                room = b - 1;
            }
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
                // stopping short of the yews in the back corners
                for (let v = b + 3; v < Math.min(V - 4.2, b + cd); v += 2.2) {
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

    // Orchard behind a low wall with a gap in the side we see: fruit trees in
    // rows round a well
    function orchardBlock(T, cell, rng) {
        const S = T.S, [x0, y0, x1, y1] = cell.rect, w = x1 - x0, d = y1 - y0, F = frame(x0, y0, LAND, 0);
        S.kind = INK;
        S.loop(at3(rectPoly(cell.rect), LAND));
        const m = 0.6, t = 0.4;
        for (const [u0, v0, u1, v1] of [[m, m, w / 2 - 1.4, m + t], [w / 2 + 1.4, m, w - m, m + t], [m, d - m - t, w - m, d - m], [m, m + t, m + t, d - m - t], [w - m - t, m + t, w - m, d - m - t]]) {
            S.box(F, u0, v0, 0, u1, v1, 1);
        }
        const wx = (x0 + x1) / 2, wy = (y0 + y1) / 2;
        well(T, wx, wy, rng);
        const nx = Math.max(1, Math.round((w - 5) / 5)), ny = Math.max(1, Math.round((d - 5) / 5));
        for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= ny; j++) {
                const x = x0 + 2.5 + ((w - 5) * i) / nx, y = y0 + 2.5 + ((d - 5) * j) / ny;
                if (Math.hypot(x - wx, y - wy) > 3.4) fruitTree(T, x + rng.range(-0.3, 0.3), y + rng.range(-0.3, 0.3), rng);
            }
        }
        S.kind = INK;
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
            const zs = geo.lerp(LAND + 1.8, K.h, 0.55), band = Math.max(0.35, FINE / (T.k * T.cam.ce));
            drum(S, x, y, r, LAND + 1.8, zs, n);
            S.frustum(x, y, zs, zs + band, r + 0.18, r + 0.18, n);
            drum(S, x, y, r, zs + band, K.h, n);
            shadeRound(T, x, y, LAND + 1.8, K.h, r, r);
            loops(T, { x, y, r, h: K.h }, LAND + 2, zs, zs + band);
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
        // laid out as the castle was planned, and placed through C.to in case the plan was turned
        const S = T.S, p = T.p, C = town.castle, K = C.keep, { kx, ky } = C.local, [wx0, wy0, wx1, wy1] = C.local.ward;
        S.kind = INK;
        // The great hall down the right-hand wall, in front of the keep. In a
        // turned castle that would have its back to us, and it goes along the
        // wall behind instead, beside the keep.
        const hallD = 8.5, taken = [[kx, ky, K.w * 0.75]];
        if (C.turn) {
            const hx1 = kx - K.w / 2 - 2.5;
            if (hx1 - wx0 > 12) {
                hall(T, frame(...C.to(wx0 + 1.2, wy1 - hallD - 0.6), LAND, C.turn), [0, 0, hx1 - wx0 - 1.2, hallD], rng);
                taken.push([(wx0 + hx1) / 2, wy1 - hallD / 2, Math.max(hallD, hx1 - wx0) / 2 + 1]);
            }
        } else {
            const hy1 = ky - K.w / 2 - 2.5;
            if (hy1 - wy0 > 12) {
                hall(T, frame(wx1 - hallD - 0.6, hy1, LAND, 3), [0, 0, hy1 - wy0 - 1.2, hallD], rng);
                taken.push([wx1 - hallD / 2, (wy0 + hy1) / 2, Math.max(hallD, hy1 - wy0) / 2 + 1]);
            }
        }
        const ok = (x, y, r) => inRect(C.local.ward, x, y, -r) && !taken.some(([u, v, q]) => Math.hypot(u - x, v - y) < q + r);
        const wellAt = [geo.lerp(wx0, wx1, 0.28), geo.lerp(wy0, wy1, 0.4)];
        if (ok(...wellAt, 1.5)) {
            well(T, ...C.to(...wellAt), rng);
            taken.push([...wellAt, 1.5]);
        }
        for (let i = Math.round(rng.range(3, 6) * (0.4 + p.people)); i > 0; i--) {
            const x = rng.range(wx0 + 1, wx1 - 1), y = rng.range(wy0 + 1, wy0 + (wy1 - wy0) * 0.6);
            if (!ok(x, y, 1.2)) continue;
            const at = C.to(x, y);
            if (rng.chance(0.4)) horse(T, at[0], at[1], LAND, rng.sign(), rng, rng.chance(0.6));
            else person(T, at[0], at[1], LAND, rng);
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

    // Ox or cow side on, facing dir: a heavy body, the head carried low, and
    // horns on an ox
    function beast(T, x, y, dir, horns) {
        const S = T.S, P0 = card(T, x, y, LAND, 0), P = (u, w) => P0(u * dir, w);
        S.kind = FIGURE;
        const body = [P(-0.95, 0.72), P(0.78, 0.72), P(0.95, 1.02), P(0.86, 1.42), P(-0.86, 1.48), P(-1, 1.22)];
        S.face(body);
        S.loop(body);
        const head = [P(0.82, 1.34), P(1.3, 1.16), P(1.34, 0.86), P(1.04, 0.82)];
        S.face(head);
        S.loop(head);
        if (horns) S.line([P(0.98, 1.3), P(1.06, 1.62), P(1.24, 1.66)]);
        for (const u of [-0.74, -0.52, 0.5, 0.72]) S.line([P(u, 0.74), P(u, 0)]);
        S.line([P(-0.98, 1.38), P(-1.1, 0.86)]);
        S.kind = INK;
    }

    // A plowman behind a pair of oxen, walking along w down the furrows
    function plowTeam(T, x, y, w, rng) {
        const dir = dot2(w, [T.cam.rx, T.cam.ry]) >= 0 ? 1 : -1, side = [-w[1] * 0.65, w[0] * 0.65];
        const pair = [[x + side[0], y + side[1]], [x - side[0], y - side[1]]];
        pair.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        for (const [u, v] of pair) beast(T, u, v, dir, true);
        // No beam or plow. At the size people come out on the page those were
        // only a tangle of lines between the oxen and the plowman.
        person(T, x - w[0] * 2.4, y - w[1] * 2.4, LAND, rng);
    }

    // Someone with a staff: a shepherd's crook, or a hay rake
    function worker(T, x, y, rng, tool) {
        person(T, x, y, LAND, rng);
        const P = card(T, x, y, LAND, 0), S = T.S;
        S.kind = WOOD;
        if (tool === 'crook') S.line([P(0.34, 0), P(0.34, 2.05), P(0.24, 2.3), P(0.08, 2.24)]);
        else {
            const s = rng.sign();
            S.line([P(0.3 * s, 1.15), P(1.4 * s, 0.05)]);
            S.line([P(1.15 * s, 0.05), P(1.65 * s, 0.05)]);
        }
        S.kind = INK;
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
        for (const side of [1, 2, 3]) panes(T, wall(F, side, fp), { base: -0.1, floors: 1, style: 'cross', winW: 0.85, winH: 0.85, gap: 2 });
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
                    const rows = Math.max(1, Math.floor(w / Math.max(0.6, FINE / Math.max(apart(T, F.V(0, 1, 0), F.V(1, 0, 0)), 1e-6))));
                    for (let i = 1; i < rows; i++) S.line([F.P(a + (w * i) / rows, v0 + 0.2, 0), F.P(a + (w * i) / rows, v1 - 0.2, 0)]);
                });
            }
            // a tree gets a gap of its own between this cottage and the next,
            // if that's still inside the field
            let gap = rng.range(3.5, 6);
            if (rng.chance(0.6)) {
                gap = rng.range(8, 9.5);
                const [tx, ty] = F.P(a + w + gap / 2, b + d * 0.7, 0);
                if (a + w + gap / 2 < L - 2) tree(T, tx, ty, LAND, rng);
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

    // A field's outline, less the stretches where a hedge stands in place of
    // its edge. Each of skip is {x or y, lo, hi}: a stretch of the line at that x or y.
    function outline(T, r, skip) {
        const S = T.S, [x0, y0, x1, y1] = r;
        if (!skip.length) return S.loop(at3(rectPoly(r), LAND));
        const sides = [['y', y0, x0, x1], ['x', x1, y0, y1], ['y', y1, x0, x1], ['x', x0, y0, y1]];
        for (const [k, c, lo, hi] of sides) {
            const cut = skip.filter(s => s[k] !== undefined && Math.abs(s[k] - c) < 1e-6).map(s => [s.lo, s.hi]).sort((u, v) => u[0] - v[0]);
            let from = lo;
            const draw = (u, v) => { if (v - u > 0.05) S.line(k === 'y' ? [[u, c, LAND], [v, c, LAND]] : [[c, u, LAND], [c, v, LAND]]); };
            for (const [u, v] of cut) {
                draw(from, Math.min(u, hi));
                from = Math.max(from, v);
            }
            draw(from, hi);
        }
    }

    // One field: an outline and furrows, strips, grass, an orchard, a hay
    // harvest, sheep, or a copse. ok(x, y, m) says where things can stand,
    // m meters clear of whatever the field stops at, and skip is for outline().
    function field(T, r, kind, rng, ok = () => true, skip = []) {
        const S = T.S, p = T.p, [x0, y0, x1, y1] = r, w = x1 - x0, d = y1 - y0;
        const gap = p.furrows, along = w >= d ? [1, 0, 0] : [0, 1, 0];
        const rect3 = q => at3(rectPoly(q), LAND);
        S.kind = GREEN;
        if (kind !== 'wood') outline(T, r, skip);
        if (kind === 'furrows') {
            const dir = rng.chance(0.7) ? along : [along[1], along[0], 0];
            S.hatch(rect3(r), dir, gap);
            // now and then a team out plowing, along the furrows
            if (rng.chance(0.5 * p.people) && w > 12 && d > 12) {
                const x = rng.range(x0 + 5, x1 - 5), y = rng.range(y0 + 5, y1 - 5), s = rng.sign();
                if (ok(x, y, 4) && ok(x - dir[0] * s * 5, y - dir[1] * s * 5, 2)) plowTeam(T, x, y, [dir[0] * s, dir[1] * s], rng);
            }
        } else if (kind === 'strips') {
            const n = rng.int(3, 5), lw = w >= d;
            for (let i = 0; i < n; i++) {
                const q = lw ? [x0, y0 + (d * i) / n, x1, y0 + (d * (i + 1)) / n] : [x0 + (w * i) / n, y0, x0 + (w * (i + 1)) / n, y1];
                if (i) S.line(rect3(q).slice(0, 2));
                if (i % 2 === 0) S.hatch(rect3(q), along, gap);
                else if (rng.chance(0.5)) S.hatch(rect3(q), [along[1], along[0], 0], gap * 1.4);
            }
        } else if (kind === 'meadow' || kind === 'pasture') {
            for (let i = Math.round((w * d) / 48); i > 0; i--) {
                const x = rng.range(x0 + 0.8, x1 - 0.8), y = rng.range(y0 + 0.8, y1 - 0.8);
                if (ok(x, y, 0.6)) tuft(T, x, y);
            }
            if (kind === 'pasture') {
                S.kind = INK;
                const flock = [];
                for (let i = rng.int(4, 8); i > 0; i--) flock.push([rng.range(x0 + 2, x1 - 2), rng.range(y0 + 2, y1 - 2)]);
                flock.sort((a, b) => (b[0] * T.cam.fx + b[1] * T.cam.fy) - (a[0] * T.cam.fx + a[1] * T.cam.fy));
                for (const [x, y] of flock) {
                    const dir = rng.sign();
                    if (ok(x, y, 1.2)) sheep(T, x, y, dir);
                }
                // and their shepherd, a little way off from the nearest of them
                if (rng.chance(0.7 * p.people)) {
                    const [fx, fy] = flock[flock.length - 1], x = geo.clamp(fx + rng.range(-3, 3), x0 + 1, x1 - 1), y = geo.clamp(fy - rng.range(2, 3.5), y0 + 1, y1 - 1);
                    if (ok(x, y, 1) && !flock.some(([u, v]) => Math.hypot(u - x, v - y) < 1.8)) worker(T, x, y, rng, 'crook');
                }
            }
        } else if (kind === 'orchard') {
            for (let x = x0 + 2.5; x < x1 - 1.5; x += 5.5) {
                for (let y = y0 + 2.5; y < y1 - 1.5; y += 5.5) {
                    const u = x + rng.range(-0.4, 0.4), v = y + rng.range(-0.4, 0.4);
                    if (ok(u, v, 1.4)) fruitTree(T, u, v, rng);
                }
            }
        } else if (kind === 'hay') {
            S.hatch(rect3(r), along, gap * 2.2);
            const stacks = [];
            for (let i = rng.int(2, 5); i > 0; i--) {
                const x = rng.range(x0 + 2, x1 - 2), y = rng.range(y0 + 2, y1 - 2);
                if (ok(x, y, 1.5)) {
                    haystack(T, x, y);
                    stacks.push([x, y]);
                }
            }
            // haymakers with their rakes, clear of the stacks
            for (let i = rng.chance(0.8 * p.people) ? rng.int(1, 3) : 0; i > 0; i--) {
                const x = rng.range(x0 + 2, x1 - 2), y = rng.range(y0 + 2, y1 - 2);
                if (ok(x, y, 1.5) && !stacks.some(([u, v]) => Math.hypot(u - x, v - y) < 3.2)) worker(T, x, y, rng, 'rake');
            }
        } else if (kind === 'vineyard') {
            // rows of vines as dashes, every other row starting half a dash further along
            const lw = w >= d, L = lw ? w : d, D = lw ? d : w, per = Math.max(apart(T, along, [along[1], along[0], 0]), 1e-6);
            const rows = Math.max(2, Math.floor(D / Math.max(2.4, (1.6 * gap) / per))), on = Math.max(1.8, 1.7 / T.k), off = on * 0.6;
            const at = (u, v) => (lw ? [x0 + u, y0 + v, LAND] : [x0 + v, y0 + u, LAND]);
            for (let i = 0; i < rows; i++) {
                const v = (D * (i + 0.5)) / rows;
                for (let u = 0.8 + ((i % 2) * (on + off)) / 2; u + on < L - 0.8; u += on + off) S.line([at(u, v), at(u + on, v)]);
            }
        } else if (kind === 'pond') {
            // an uneven round of water with a ripple in it and reeds on the bank
            const cx = (x0 + x1) / 2 + rng.range(-0.08, 0.08) * w, cy = (y0 + y1) / 2 + rng.range(-0.08, 0.08) * d;
            const R = Math.min(w, d) * rng.range(0.24, 0.31), f1 = rng.range(0, TAU), f2 = rng.range(0, TAU);
            const rim = (a, m) => {
                const q = R * m * (1 + 0.13 * Math.sin(2 * a + f1) + 0.08 * Math.sin(3 * a + f2));
                return [cx + q * Math.cos(a), cy + q * Math.sin(a), LAND];
            };
            S.kind = WATER;
            S.loop(Array.from({ length: 36 }, (_, i) => rim((TAU * i) / 36, 1)));
            if (R * T.k > 3) S.line(Array.from({ length: 13 }, (_, i) => rim(f1 + (TAU * 0.55 * i) / 12, 0.58)));
            S.kind = GREEN;
            for (let i = rng.int(4, 7); i > 0; i--) tuft(T, ...rim(rng.range(0, TAU), 1.2).slice(0, 2));
        } else if (kind === 'wood') {
            const spots = [];
            for (let i = Math.round((w * d) / 32); i > 0; i--) {
                const x = rng.range(x0 + 1.5, x1 - 1.5), y = rng.range(y0 + 1.5, y1 - 1.5);
                if (!ok(x, y, 1.5) || spots.some(([u, v]) => Math.hypot(u - x, v - y) < 3.4)) continue;
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

    // Length on paper (mm) of a meter of level ground along (dx, dy)
    function onPaper(T, dx, dy) {
        const c = T.cam;
        return c.k * Math.hypot(dx * c.rx + dy * c.ry, (dx * c.fx + dy * c.fy) * c.se);
    }

    // The runs of polyline E inside rectangle r, where on[i] says the point's in view
    function clipRun(E, on, [x0, y0, x1, y1]) {
        const out = [];
        let run = null;
        for (let i = 0; i + 1 < E.length; i++) {
            const A = E[i], B = E[i + 1], dx = B[0] - A[0], dy = B[1] - A[1];
            let t0 = 0, t1 = 1, ok = on[i] || on[i + 1];
            for (const [pp, q] of [[-dx, A[0] - x0], [dx, x1 - A[0]], [-dy, A[1] - y0], [dy, y1 - A[1]]]) {
                if (!ok) break;
                if (pp === 0) ok = q >= 0;
                else if (pp < 0) t0 = Math.max(t0, q / pp);
                else t1 = Math.min(t1, q / pp);
            }
            if (!ok || t1 - t0 < 1e-9) {
                run = null;
                continue;
            }
            const a = [A[0] + dx * t0, A[1] + dy * t0], b = [A[0] + dx * t1, A[1] + dy * t1];
            if (!run || t0 > 1e-9) out.push((run = [a]));
            run.push(b);
            if (t1 < 1 - 1e-9) run = null;
        }
        return out;
    }

    // One bushy lump of hedge: a round cut-out a bit wider than tall
    function bush(T, x, y, r, rng) {
        const S = T.S, ce = T.cam.ce, flat = 0.78, cz = (r * flat) / ce, P = card(T, x, y, LAND, 0), ph = rng.range(0, TAU), pts = [];
        for (let i = 0; i < 14; i++) {
            const a = (TAU * i) / 14, b = 1 + 0.07 * Math.sin(a * 4 + ph);
            pts.push([Math.cos(a) * r * b, cz + (Math.sin(a) * r * flat * b) / ce]);
        }
        S.face(hull(pts).map(([u, w]) => P(u, w)));
        S.loop(pts.map(([u, w]) => P(u, w)));
    }

    // A hedge down a line on the ground, its lumps spaced so they show apart
    // on paper, with an oak standing in it now and then. ok(x, y) says where it grows.
    function hedge(T, [a, b], rng, ok) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const step = Math.max(1.3, 1.2 / Math.max(0.05, onPaper(T, d[0], d[1]))), spots = [];
        let oak = rng.range(6, 30);
        for (let s = rng.range(0.3, 0.9); s < L - 0.3; s += step * rng.range(0.85, 1.15)) {
            const x = a[0] + d[0] * s, y = a[1] + d[1] * s;
            if (!ok(x, y)) continue;
            const tall = s > oak && rng.chance(0.3 + 0.5 * T.p.trees);
            if (tall) oak = s + rng.range(18, 45);
            spots.push([x, y, tall]);
        }
        spots.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        T.S.kind = GREEN;
        for (const [x, y, tall] of spots) {
            if (tall) tree(T, x, y, LAND, rng);
            else bush(T, x, y, rng.range(1.2, 1.5), rng);
        }
        T.S.kind = INK;
    }

    // The woods: their fields filled with trees, which run on over the gaps
    // between neighboring ones so a wood is one piece and thin out raggedly
    // at its edges. The noise that picked the fields also groups the firs
    // into stands of their own.
    function woodland(T, cells, N, rng, ok) {
        const keys = new Set(cells.map(c => c.i * 4096 + c.j)), wood = (c, di, dj) => keys.has((c.i + di) * 4096 + c.j + dj);
        // about as far apart as in the copses, or the crowns and their shading run together on paper
        const step = 4.8, gap = 3.4, spots = [], near = new Map(), at = (x, y) => Math.floor(x / gap) * 8192 + Math.floor(y / gap);
        const roomFor = (x, y) => {
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
                for (const [u, v] of near.get(at(x + i * gap, y + j * gap)) || []) if (Math.hypot(u - x, v - y) < gap) return false;
            }
            return true;
        };
        for (const c of cells) {
            const [x0, y0, x1, y1] = c.r, g = 0.95;
            const grow = [wood(c, -1, 0), wood(c, 0, -1), wood(c, 1, 0), wood(c, 0, 1)];
            const ex = [x0 - (grow[0] ? g : 0), y0 - (grow[1] ? g : 0), x1 + (grow[2] ? g : 0), y1 + (grow[3] ? g : 0)];
            for (let x = ex[0] + step * rng.range(0.2, 0.6); x < ex[2]; x += step) {
                for (let y = ex[1] + step * rng.range(0.2, 0.6); y < ex[3]; y += step) {
                    const u = x + rng.range(-1.1, 1.1), v = y + rng.range(-1.1, 1.1);
                    // how far in from an edge that isn't more wood
                    const inside = Math.min(grow[0] ? 9 : u - x0, grow[1] ? 9 : v - y0, grow[2] ? 9 : x1 - u, grow[3] ? 9 : y1 - v);
                    if (inside < rng.range(0.6, 3.2) || !ok(u, v) || !roomFor(u, v)) continue;
                    spots.push([u, v]);
                    const k = at(u, v);
                    if (near.has(k)) near.get(k).push([u, v]);
                    else near.set(k, [[u, v]]);
                }
            }
        }
        spots.sort((p, q) => (q[0] * T.cam.fx + q[1] * T.cam.fy) - (p[0] * T.cam.fx + p[1] * T.cam.fy));
        for (const [x, y] of spots) {
            if (N.noise2(x / 45, y / 45) > 0.1 + rng.range(-0.25, 0.25)) fir(T, x, y, LAND, rng.range(6, 9), rng);
            else tree(T, x, y, LAND, rng);
        }
    }

    // Roads out of the gates, fields in a grid lined up on them, a mill, a
    // tournament, trees and people on the roads, and the river with its bridges
    function country(T, town, rng, view, roads, river) {
        const { S, p, cam } = T;
        const [vx0, vy0, vx1, vy1] = bounds(view);
        const glacis = offset(town.moat, 7);
        // the river and the meadows along it, which fields and the things in them keep out of
        const zone = river ? SLOPE + river.meadow : 0, wet = (x, y, m = 0) => !!river && river.gap(x, y) < zone + m;
        const onBank = (x, y) => !!river && river.gap(x, y) < SLOPE + 2;
        const bridges = rd => (river ? river.crossings.filter(c => c.rd === rd).map(c => [c.a - c.hw - SLOPE - RAMP, c.a + c.hw + SLOPE + RAMP]) : []);
        for (const rd of roads) {
            const { a0, a1, hw, P } = rd, half = rd.g.road.wB / 2, gaps = bridges(rd).sort((u, v) => u[0] - v[0]);
            S.kind = INK;
            // the road is wider than the bridges, and narrows to meet the ends of their parapets
            const piece = (u, v, nu) => {
                for (const b of [-1, 1]) S.line([P(u, b * (nu ? half : hw)), ...(nu ? [P(u + 3, b * hw)] : []), P(v - 3, b * hw), P(v, b * half)]);
            };
            let from = a0;
            for (const [lo, hi] of gaps) {
                piece(from, lo, from !== a0);
                from = hi;
            }
            piece(from, a1, from !== a0);
            if (T.detail) {
                S.kind = WOOD;
                for (const b of [-0.8, 0.8]) {
                    for (let a = a1 - 1; a > a0; a -= 3.2) if (!gaps.some(([lo, hi]) => a > lo - 1 && a - 1.8 < hi + 1)) S.line([P(a, b), P(a - 1.8, b)], true);
                }
            }
        }
        if (river) {
            riverBanks(T, river);
            // One bridge is guarded at its far end: the main road's, or the
            // other one when the main one's tower would be off the page
            const towerAt = c => c.a - c.hw - SLOPE - RAMP + 0.3, shows = c => {
                const F = c.rd.g.road.F, w = c.rd.g.road.wB;
                return [F.P(towerAt(c), w / 2, LAND), F.P(towerAt(c), w / 2, LAND + 16)].every(q => (([x, y]) => x > 4 && x < S.W - 4 && y > 4 && y < S.H - 4)(T.home.project(...q)));
            };
            const guarded = p.bridgeGate && river.crossings.slice().sort((u, v) => (v.rd.g === town.gates[0]) - (u.rd.g === town.gates[0])).find(shows);
            for (const c of river.crossings) {
                const { F, wB, r, across, b0 } = c.rd.g.road;
                riverBridge(T, F, c.a - c.hw, c.a + c.hw, wB);
                if (c === guarded) bridgeGate(T, F, towerAt(c), wB, rng);
                // no ripples under it
                river.dry.push((x, y, m = 0) => Math.abs(x * across[0] + y * across[1] - b0 - wB / 2) < wB / 2 + 1.8 + m && Math.abs(x * r[0] + y * r[1] - c.a) < c.hw + 1 + m);
            }
            const mrng = new PG.RNG(rng.int(1, 1e9)), mill = p.watermill && millSite(T, river, town, mrng);
            if (mill) {
                waterMill(T, river, mill, mrng);
                // the fields and hedges keep clear of it the way they do of the water
                const base = river.gap, foot = mill.foot;
                river.gap = (x, y) => Math.min(base(x, y), (depth(foot, x, y) > 0 ? -depth(foot, x, y) : distOut(foot, x, y)) - 2.5 + zone);
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
                // A field the river runs by is cut off along its meadows, and one
                // that's mostly meadow is left to them
                let damp = false;
                if (river && river.gap((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) - Math.hypot(r[2] - r[0], r[3] - r[1]) / 2 < zone + 1) {
                    let n = 0;
                    for (let u = 0; u < 6; u++) for (let v = 0; v < 6; v++) if (wet(geo.lerp(r[0], r[2], (u + 0.5) / 6), geo.lerp(r[1], r[3], (v + 0.5) / 6))) n++;
                    if (n > 18) continue;
                    damp = true;
                }
                const q = T.home.project((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, LAND);
                const road = roads.find(rd => overlap(rectPoly([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3]), rectPoly(rd.rect)));
                const far = distOut(town.moat, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
                cells.push({ i, j, r, q, road, near: !!road, far, damp, skip: [] });
            }
        }
        const at = new Map(cells.map(c => [c.i * 4096 + c.j, c])), next = (c, di, dj) => at.get((c.i + di) * 4096 + c.j + dj);
        // the mill and the tournament go on fields we can see well, below the town
        const below = c => c.q[1] > S.H * 0.55 && c.q[1] < S.H * 0.95 && c.q[0] > S.W * 0.08 && c.q[0] < S.W * 0.92;
        const take = test => {
            const options = cells.filter(c => !c.kind && !c.damp && test(c));
            return options.length ? rng.pick(options) : null;
        };
        if (p.fair) {
            // deep enough to keep the stand, the lists and the pavilions apart
            const c = take(c => below(c) && c.near && Math.max(c.r[2] - c.r[0], c.r[3] - c.r[1]) > 20 && Math.min(c.r[2] - c.r[0], c.r[3] - c.r[1]) > 18);
            if (c) c.kind = 'fair';
        }
        // is a field next to one of this kind?
        const beside = (c, kind) => cells.some(o => o.kind === kind && overlap(rectPoly([c.r[0] - 9, c.r[1] - 9, c.r[2] + 9, c.r[3] + 9]), rectPoly(o.r)));
        if (p.mill) {
            // The sails reach 8 m out from the middle of the field. It takes a
            // field that holds them when there is one, and never one next to
            // the tournament, where they'd turn through the stand.
            const room = m => c => below(c) && c.r[2] - c.r[0] > m && c.r[3] - c.r[1] > m && !beside(c, 'fair');
            const c = take(room(18)) || take(room(15));
            if (c) c.kind = 'mill';
        }
        // cottages along the roads just out of the gates
        for (let i = Math.round(p.cottages * 3); i > 0; i--) {
            const options = cells.filter(c => !c.kind && !c.damp && c.road && c.far < 45 && c.r[2] - c.r[0] > 12 && c.r[3] - c.r[1] > 12 && !beside(c, 'mill'));
            if (!options.length) break;
            options.sort((a, b) => a.far - b.far);
            options[rng.int(0, Math.min(1, options.length - 1))].kind = 'hamlet';
        }
        // The abbey takes a block of four or six fields out past the town,
        // where the town doesn't stand in front of it on the page. Its gate is
        // in the front wall on the line between the block's two columns, and a
        // lane runs off from it along the gap in front of the block.
        const arng = new PG.RNG(rng.int(1, 1e9));
        let lane = null;
        if (p.abbey) {
            const front = hull(town.moat.map(([x, y]) => T.home.project(x, y, LAND)).concat(town.towers.map(t => T.home.project(t.x, t.y, t.top))).map(q => [q[0], q[1]]));
            const middle = T.home.project(0, 0, LAND), plain = c => c && !c.kind && !c.damp && c.far > 18;
            const options = [];
            for (const c of cells) {
                // two fields across, and two or three deep when two aren't deep enough for the church
                let block = [c, next(c, 1, 0), next(c, 0, 1), next(c, 1, 1)];
                if (!block.every(plain)) continue;
                if (block[3].r[3] - c.r[1] < 46) block = block.concat([next(c, 0, 2), next(c, 1, 2)]);
                if (!block.every(plain)) continue;
                const plot = [c.r[0], c.r[1], block[block.length - 1].r[2], block[block.length - 1].r[3]], W = plot[2] - plot[0], D = plot[3] - plot[1];
                if (D < 46 || W < 38 || D > 80 || W > 66) continue;
                const q = rectPoly(plot).map(([x, y]) => T.home.project(x, y, LAND)), top = T.home.project((plot[0] + plot[2]) / 2, (plot[1] + plot[3]) / 2, LAND + 42);
                if (q.some(([x, y]) => x < 5 || x > S.W - 5 || y > S.H - 5) || top[1] < 3 || q.some(([x, y]) => y > middle[1])) continue;
                if (q.some(([x, y]) => geo.pointInPolygon(x, y, front)) || geo.pointInPolygon(top[0], top[1], front)) continue;
                options.push({ block, plot, gate: xs[c.i + 1], score: Math.abs(top[1] - S.H * 0.06) + arng.range(0, 30) });
            }
            const best = options.sort((u, v) => u.score - v.score)[0];
            if (best) {
                const [c] = best.block;
                for (const o of best.block) {
                    o.kind = 'abbey';
                    o.parcel = c;
                }
                c.plot = best.plot;
                c.gate = best.gate;
                lane = { y: ys[c.j], x: best.gate, i: c.i, j: c.j };
            }
        }
        // Every town has its own country: more plowland round one, more woods
        // or pasture round another.
        const lean = () => rng.range(0.5, 1.7), plow = lean(), grass = lean(), woods = lean(), vines = rng.chance(0.5) ? lean() : 0;
        const kinds = () => [[3 * p.fields * plow, 'furrows'], [2 * p.fields * plow, 'strips'], [1.4 * grass, 'meadow'], [0.9 * grass, 'pasture'], [0.8, 'orchard'],
            [0.8 * p.fields, 'hay'], [1.2 * p.fields * vines, 'vineyard'], [0.3, 'pond'], [0.35 * p.trees * woods, 'wood']];
        // Woods are fields picked out by a smooth noise, so they come in blocks
        // of several, and the farther from town the more of them there are
        const N = PG.makeNoise(new PG.RNG(rng.int(1, 1e9))), wide = rng.range(110, 170);
        for (const c of cells) {
            if (c.kind || c.far < 22) continue;
            const v = N.fbm2((c.r[0] + c.r[2]) / 2 / wide, (c.r[1] + c.r[3]) / 2 / wide, 3, 2, 0.5);
            if (v + 0.5 * (p.trees * woods - 0.6) + Math.min(c.far, 170) / 400 > 0.62) c.kind = 'forest';
        }
        // far fields first, so nearer trees and haystacks stack over them in order
        cells.sort((a, b) => a.q[1] - b.q[1]);
        let ponds = 0;
        for (const c of cells) {
            c.parcel = c.parcel || c;
            if (c.kind) continue;
            c.kind = rng.weighted(kinds());
            if (c.kind === 'pond' && (c.damp || ++ponds > 2)) c.kind = 'meadow';
        }
        // some fields run on into the next one, so they aren't all one size
        const big = ['furrows', 'strips', 'meadow', 'pasture', 'hay'];
        for (const c of cells) {
            if (c.parcel !== c || c.merged || c.damp || !big.includes(c.kind) || !rng.chance(0.45)) continue;
            const o = rng.chance(0.5) ? next(c, 1, 0) : next(c, 0, 1);
            if (!o || o.parcel !== o || o.merged || o.damp || !big.includes(o.kind)) continue;
            o.parcel = c;
            c.merged = o;
            c.r = [Math.min(c.r[0], o.r[0]), Math.min(c.r[1], o.r[1]), Math.max(c.r[2], o.r[2]), Math.max(c.r[3], o.r[3])];
        }
        // Hedges along some of the edges between fields, most of them in the
        // closes near town. A hedge stands in place of the two fields' edges.
        const hedges = [], hedgeable = c => c.kind !== 'forest' && c.kind !== 'fair' && c.kind !== 'abbey';
        const onLane = (c, dj) => lane && dj && c.j === lane.j - 1 && c.i <= lane.i;
        for (const c of cells) {
            for (const [di, dj] of [[1, 0], [0, 1]]) {
                const o = next(c, di, dj);
                if (!o || o.parcel === c.parcel || !hedgeable(c) || !hedgeable(o) || onLane(c, dj)) continue;
                if (!rng.chance(p.hedges * geo.clamp(1.15 - Math.min(c.far, o.far) / 150, 0.2, 1))) continue;
                const X = xs[c.i + 1], Y = ys[c.j + 1];
                hedges.push(di ? [[X, ys[c.j]], [X, Y]] : [[xs[c.i], Y], [X, Y]]);
                for (const [f, s] of [[c, 1], [o, -1]]) f.parcel.skip.push(di ? { x: X - s * 0.9, lo: ys[c.j], hi: Y } : { y: Y - s * 0.9, lo: xs[c.i], hi: X });
            }
        }
        const outside = S.shadow, edges = river && [1, -1].map(sg => river.off(sg, zone));
        for (const c of cells) {
            if (c.parcel !== c) continue;
            S.shadow = outside;
            if (c.kind === 'fair') tournament(T, c.r, rng);
            else if (c.kind === 'mill') {
                field(T, c.r, 'meadow', rng, undefined, c.skip);
                postMill(T, (c.r[0] + c.r[2]) / 2, (c.r[1] + c.r[3]) / 2, rng);
            } else if (c.kind === 'hamlet') hamlet(T, c, rng);
            else if (c.kind === 'abbey') abbey(T, c.plot, c.gate, arng);
            else if (c.kind === 'forest') continue;
            else if (c.damp) {
                keepDry(T, river, zone, () => field(T, c.r, c.kind, rng, (x, y, m) => !wet(x, y, m), c.skip));
                // the field closed off along the edge of the meadows
                S.kind = GREEN;
                for (const E of edges) for (const run of clipRun(E, river.on, c.r)) S.line(run.map(([x, y]) => [x, y, LAND]));
                S.kind = INK;
            } else field(T, c.r, c.kind, rng, undefined, c.skip);
        }
        // the lane out of the abbey gate, two ruts down the gap between the fields as far as it goes
        const lanes = [];
        if (lane) {
            const blocked = x => wet(x, lane.y, -zone + SLOPE + 1) || roads.some(rd => inRect(rd.rect, x, lane.y, 1)) || depth(glacis, x, lane.y) > -1;
            // it's a farm track, so it ends after a few fields
            let x1 = lane.x;
            const end = lane.x - rng.range(55, 85);
            while (x1 > Math.max(vx0 - 20, end) && !blocked(x1 - 1.8)) x1 -= 3.2;
            lanes.push([x1, lane.x]);
            S.kind = WOOD;
            if (T.detail) for (let x = lane.x; x - 1.8 >= x1; x -= 3.2) for (const b of [-0.45, 0.45]) S.line([[x, lane.y + b, LAND], [x - 1.8, lane.y + b, LAND]], true);
            S.kind = INK;
        }
        const free = (x, y) => !wet(x, y, 0.5) && !roads.some(rd => inRect(rd.rect, x, y, 1.2)) && depth(glacis, x, y) < -2
            && !lanes.some(([u0, u1]) => x > u0 - 1 && x < u1 + 1 && Math.abs(y - lane.y) < 1.8);
        for (const h of hedges) hedge(T, h, rng, free);
        woodland(T, cells.filter(c => c.kind === 'forest'), N, rng, (x, y) => free(x, y) && depth(view, x, y) > -12);
        if (river) riverLife(T, river, rng);
        // fields with something built on them, which loose trees keep off
        const builtOn = (x, y) => cells.some(c => ['hamlet', 'fair', 'mill', 'abbey'].includes(c.kind) && inRect(c.plot || c.r, x, y, 3));
        // trees along the roads, people and wagons on them
        for (const rd of roads) {
            const { a0, a1, P } = rd;
            let side = 1;
            for (let a = a1 - 12; a > a0; a -= rng.range(9, 14)) {
                side = -side;
                if (!rng.chance(0.4 + 0.5 * p.trees)) continue;
                const [x, y] = P(a, side * 4.6);
                // the cottages have their own trees, and these would stand on their fences, in the
                // lists, or in front of a bridge's gate tower
                if (builtOn(x, y) || onBank(x, y) || bridges(rd).some(([lo]) => a > lo - 7 && a < lo + 5)) continue;
                tree(T, x, y, LAND, rng);
            }
            const sx = rd.g.road.r, dirOut = -(sx[0] * cam.rx + sx[1] * cam.ry) >= 0 ? 1 : -1;
            // starting back from where the road narrows to the bridge
            for (let a = a1 - 7; a > a0; a -= rng.range(14, 26)) {
                const [x, y] = P(a, rng.range(-1.6, 1.6));
                if (depth(view, x, y) < 0 || bridges(rd).some(([lo, hi]) => a > lo - 4 && a < hi + 4)) continue;
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
            if (g > 0 || g < -8 || depth(view, x, y) < 0 || roads.some(rd => inRect(rd.rect, x, y, 2.5)) || builtOn(x, y) || onBank(x, y)) continue;
            tree(T, x, y, LAND, rng);
        }
    }

    // ------------------------------------------------------------------
    // The abbey
    // ------------------------------------------------------------------

    // Pointed windows in a row along a wall from s0 to s1, h tall from c, at
    // least gap apart. Like panes(), they're kept FINE wide and apart on
    // paper, fewer and wider on a wall turned away from us, and left out
    // once that would make them twice as wide as they are.
    function lancets(T, at, s0, s1, c, h, w0, gap) {
        const { pu, pz } = wallScale(T, at), w = Math.max(w0, (1.1 * FINE) / pu);
        if (w > 2 * w0 || h * pz < 2 * FINE) return;
        const step = Math.max(gap, w + (1.5 * FINE) / pu), n = Math.floor((s1 - s0 - w) / step) + 1;
        for (let i = 0; i < n; i++) {
            const s = (s0 + s1) / 2 + (i - (n - 1) / 2) * step;
            T.S.line(pointed(at, s, c, w / 2, c + h - w * 0.69).pts);
        }
    }

    // Eight-sided spire on a square tower top centered on (x, y) at height z
    function spire(T, x, y, z, rs, hs) {
        const S = T.S, rim = Array.from({ length: 8 }, (_, i) => {
            const a = Math.PI / 8 + (TAU * i) / 8;
            return [x + rs * Math.cos(a), y + rs * Math.sin(a), z];
        });
        const apex = [x, y, z + hs];
        S.solid(rim.concat([apex]), [rim.map((_, i) => i), ...rim.map((_, i) => [i, (i + 1) % 8, 8])]);
        for (let i = 0; i < 8; i++) {
            const tri = [rim[i], rim[(i + 1) % 8], apex];
            shade(T, tri, outward(tri, [x, y, z + hs * 0.2]));
        }
        const P = card(T, x, y, apex[2], 0);
        S.line([P(0, 0), P(0, 1.5)]);
        S.line([P(-0.45, 1.05), P(0.45, 1.05)]);
    }

    // The abbey church: nave and choir along u with the transepts across
    // them, a tower over the crossing with a spire, a great window in the
    // west front and lancets along the sides we see. c is its layout from abbey().
    function abbeyChurch(T, F, c, rng) {
        const S = T.S, P = F.P, { u0, u1, x0, x1, v0, nw, tw } = c, pitch = geo.rad(rng.range(52, 56));
        const nave = [u0, v0, x0, v0 + nw], choir = [x1, v0 + 0.6, u1, v0 + nw - 0.6], tr = [x0, v0 - tw, x1, v0 + nw + tw];
        const he = c.he, hc = he - 1.2;
        S.kind = INK;
        S.box(F, nave[0], nave[1], 0, nave[2], nave[3], he);
        S.box(F, choir[0], choir[1], 0, choir[2], choir[3], hc);
        S.box(F, tr[0], tr[1], 0, tr[2], tr[3], he);
        for (const [fp, z, along] of [[nave, he, true], [choir, hc, true], [tr, he, false]]) shadeGable(T, F, gableRoof(T, F, fp, z, along, pitch, rng, { attic: false }));
        // buttresses down the choir, and lancets between them
        const Wc = wall(F, 0, choir), nb = Math.max(2, Math.round(Wc.len / 3.6));
        for (let i = 1; i < nb; i++) S.box(F, choir[0] + (Wc.len * i) / nb - 0.3, choir[1] - 0.7, 0, choir[0] + (Wc.len * i) / nb + 0.3, choir[1], hc - 1.2);
        if (T.detail && T.sees(Wc.n)) for (let i = 0; i < nb; i++) lancets(T, Wc.at, (Wc.len * i) / nb + 0.6, (Wc.len * (i + 1)) / nb - 0.6, 2.2, hc - 4, 1, 4);
        // clerestory over the cloister roof, and up the transept above the east walk
        const Wn = wall(F, 0, nave);
        if (T.detail && T.sees(Wn.n)) lancets(T, Wn.at, 1, Wn.len - 1, c.walk + 1.4, he - c.walk - 2.4, 1, 3.2);
        const Wt = wall(F, 3, tr);
        if (T.detail && T.sees(Wt.n)) {
            lancets(T, Wt.at, 0.8, tw - 0.8, 2.4, he - 4.4, 1, 2.6);
            lancets(T, Wt.at, tw + nw + 0.8, Wt.len - 0.8, c.walk + 1.4, he - c.walk - 2.4, 1, 2.6);
        }
        const Wte = wall(F, 0, tr);
        if (T.sees(Wte.n) && !c.range) lancets(T, Wte.at, 1, Wte.len - 1, 2.4, he - 4.2, 1.2, 2.6);
        // the west front: a door and the great window over it
        const Ww = wall(F, 3, nave);
        if (T.sees(Ww.n)) {
            S.line(pointed(Ww.at, nw / 2, 0, 1, 2.3).pts);
            const hw = Math.min(1.8, nw * 0.22);
            S.line(pointed(Ww.at, nw / 2, 3.6, hw, he - 1.2 - hw * 1.38).pts);
            if (T.detail && hw * wallScale(T, Ww.at).pu > 2.4 * FINE) S.line([Ww.at(nw / 2, 3.65), Ww.at(nw / 2, he - 1.3)]);
        }
        // the crossing tower, with paired openings at the top and a spire
        const tf = [x0 - 0.3, v0 - 0.3, x1 + 0.3, v0 + nw + 0.3], ht = he + rng.range(8, 11);
        S.box(F, tf[0], tf[1], he, tf[2], tf[3], ht);
        S.box(F, tf[0] - 0.2, tf[1] - 0.2, ht, tf[2] + 0.2, tf[3] + 0.2, ht + 0.4);
        for (const side of [0, 3]) {
            const W = wall(F, side, tf);
            if (!T.sees(W.n)) continue;
            for (const f of [0.32, 0.68]) S.line(pointed(W.at, W.len * f, ht - 4.2, 0.55, ht - 1.8).pts);
        }
        if (T.tones) {
            // hatched down the face out of the sun, the one towards -y
            const W = [0, 1, 2, 3].map(side => wall(F, side, tf)).find(w => w.n[1] < -0.5);
            if (T.sees(W.n)) {
                const { pu } = wallScale(T, W.at), n = Math.max(1, Math.floor((W.len * pu) / T.hLit));
                for (let i = 1; i < n; i++) S.line([W.at((W.len * i) / n, he + 0.1), W.at((W.len * i) / n, ht - 4.5)]);
            }
        }
        const [sx, sy] = P((tf[0] + tf[2]) / 2, (tf[1] + tf[3]) / 2, 0);
        spire(T, sx, sy, LAND + ht + 0.4, (tf[2] - tf[0]) / 2 - 0.2, rng.range(11, 15));
    }

    // The walks round the cloister garth, each a lean-to against the wall
    // behind it with an arcade on the garth side
    function cloisterWalks(T, F, q, walk) {
        const S = T.S, P = F.P, [qx0, qy0, qx1, qy1] = q, w = 3, lo = walk - 1.2, hi = walk;
        // [the line of the wall behind, the way into the garth, the run along it]
        const walks = [
            [[qx0, qy1], [0, -1], [1, 0], qx1 - qx0],
            [[qx1, qy0], [-1, 0], [0, 1], qy1 - qy0],
            [[qx0, qy0], [0, 1], [1, 0], qx1 - qx0],
            [[qx0, qy0], [1, 0], [0, 1], qy1 - qy0],
        ];
        S.kind = INK;
        for (const [[a, b], [ia, ib], [ua, ub], L] of walks) {
            const at = (s, d, c) => P(a + ua * s + ia * d, b + ub * s + ib * d, c);
            S.prism([at(0, 0, 0), at(0, w, 0), at(0, w, lo), at(0, 0, hi)], F.V(ua * L, ub * L, 0));
            const n = F.V(ia * (hi - lo), ib * (hi - lo), w);
            shade(T, [at(0, 0, hi), at(L, 0, hi), at(L, w, lo), at(0, w, lo)], n);
            // the arcade, round arches far enough apart on paper to stay open
            const face = (s, c) => at(s, w + 0.01, c), { pu } = wallScale(T, face);
            if (!T.detail || !T.sees(F.V(ia, ib, 0)) || 0.9 * pu < FINE) continue;
            const step = Math.max(1.7, (2.2 * FINE) / pu), k = Math.floor((L - 2 * w) / step);
            for (let i = 0; i < k; i++) arch(T, face, w + (L - 2 * w - (k - 1) * step) / 2 + i * step, 0.4, Math.min(1, step * 0.6), lo - 0.9);
        }
    }

    // The abbey in its walled precinct, plot [x0, y0, x1, y1], with the gate
    // in the front wall at x = gate: the church down the far side, the
    // cloister in front of it with the dormitory and the refectory round it,
    // fishponds, an orchard and a barn. It's laid out in a frame with u along
    // y and v along x, so the church's ridge runs along y and the slopes we
    // see are in the sun, the way the town turns its roofs.
    function abbey(T, plot, gate, rng) {
        const S = T.S, [X0, Y0, X1, Y1] = plot, W = Y1 - Y0, D = X1 - X0;
        const F = { P: (a, b, c) => [X0 + b, Y0 + a, LAND + c], V: (a, b, c) => [b, a, c] }, P = F.P;
        const nw = rng.range(8, 9), tw = rng.range(6, 7.5), Lc = Math.min(W - 13, rng.range(38, 46));
        // a forecourt between the gatehouse and the west front
        const u0 = 8, u1 = u0 + Lc, x0 = u0 + Lc * rng.range(0.5, 0.56), x1 = x0 + nw;
        const v0 = Math.min(D - nw - tw - 2.5, Math.max(22, D * 0.5)), walk = 4.4;
        const he = rng.range(10, 11.5), rw = 8, qy0 = Math.max(rw + 2.5, v0 - (x0 - u0));
        const q = [u0, qy0, x0, v0];
        abbeyChurch(T, F, { u0, u1, x0, x1, v0, nw, tw, he, walk, range: true }, rng);
        cloisterWalks(T, F, q, walk);
        // the dormitory down from the south transept, the refectory along the south walk
        const dorm = [x0, qy0 - rw, x1, v0 - tw], refec = [u0, qy0 - rw, x0, qy0];
        S.kind = INK;
        S.box(F, dorm[0], dorm[1], 0, dorm[2], dorm[3], 7);
        shadeGable(T, F, gableRoof(T, F, dorm, 7, false, geo.rad(52), rng, { attic: false }));
        S.box(F, refec[0], refec[1], 0, refec[2], refec[3], 6.6);
        shadeGable(T, F, gableRoof(T, F, refec, 6.6, true, geo.rad(50), rng, { attic: false }));
        const Wd = wall(F, 3, dorm), Wr = wall(F, 0, refec), We = wall(F, 3, refec);
        if (T.detail) {
            if (T.sees(Wd.n)) panes(T, { ...Wd, len: Wd.len - rw }, { base: walk + 0.5, floors: 1, style: 'frame', winW: 0.7, winH: 1, gap: 1.5 });
            if (T.sees(Wr.n)) lancets(T, Wr.at, 1.2, Wr.len - 1.2, 1.8, 3.4, 1, 3);
            if (T.sees(We.n)) lancets(T, We.at, rw / 2 - 1.4, rw / 2 + 1.4, 1.8, 3.4, 1, 2.8);
            const Ws = wall(F, 0, dorm);
            if (T.sees(Ws.n)) lancets(T, Ws.at, 1, Ws.len - 1, 3, 2.4, 0.8, 2.2);
        }
        // the garth: paths across it and a well in the middle
        const [gx, gy] = [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2];
        S.line([P(q[0] + 3, gy, 0), P(q[2] - 3, gy, 0)]);
        S.line([P(gx, q[1] + 3, 0), P(gx, q[3] - 3, 0)]);
        well(T, ...P(gx, gy, 0).slice(0, 2), rng);
        // fishponds in the corner past the dormitory, an orchard behind the choir
        const pond = [x1 + 4, 3, W - 3, v0 - tw - 3];
        if (pond[2] - pond[0] > 7 && pond[3] - pond[1] > 6) {
            const n = Math.max(1, Math.min(3, Math.floor((pond[3] - pond[1] + 2) / 7.5))), ph = (pond[3] - pond[1] - (n - 1) * 2) / n;
            const box = ([a0, b0, a1, b1]) => [P(a0, b0, 0), P(a1, b0, 0), P(a1, b1, 0), P(a0, b1, 0)];
            for (let i = 0; i < n; i++) {
                const r = [pond[0], pond[1] + i * (ph + 2), pond[2], pond[1] + i * (ph + 2) + ph];
                S.kind = INK;
                S.loop(box(r));
                S.kind = WATER;
                if (Math.min(r[2] - r[0], r[3] - r[1]) * T.k > 3.8) S.loop(box([r[0] + 0.7, r[1] + 0.7, r[2] - 0.7, r[3] - 0.7]));
                S.kind = INK;
            }
        }
        const orch = [u1 + 3, v0 - 2, W - 2.5, D - 2.5];
        for (let u = orch[0]; u < orch[2]; u += 5) for (let v = orch[1]; v < orch[3]; v += 5) fruitTree(T, ...P(u + rng.range(-0.4, 0.4), v + rng.range(-0.4, 0.4), 0).slice(0, 2), rng);
        // a tithe barn in the yard inside the gate, if there's room past the refectory
        const barn = [2.5, 2, Math.min(x0 - 2, 22), qy0 - rw - 3];
        if (barn[2] - barn[0] > 12 && barn[3] - barn[1] > 6) {
            barn[3] = barn[1] + Math.min(barn[3] - barn[1], 8);
            S.box(F, barn[0], barn[1], 0, barn[2], barn[3], 4.2);
            shadeGable(T, F, gableRoof(T, F, barn, 4.2, true, geo.rad(52), rng, { attic: false }));
            const Wb = wall(F, 0, barn);
            if (T.sees(Wb.n)) door(T, Wb.at, Wb.len / 2, 0, 2.8, 3.4, true);
        }
        // the precinct wall, open at the gatehouse
        const t = 0.5, h = 2.4, g = gate - X0;
        const run = (a0, b0, a1, b1) => { if (a1 - a0 > 0.3 && b1 - b0 > 0.3) S.box(F, a0, b0, 0, a1, b1, h); };
        S.kind = INK;
        run(0, 0, W, t);
        run(0, D - t, W, D);
        run(W - t, t, W, D - t);
        run(0, t, t, g - 2.5);
        run(0, g + 2.5, t, D - t);
        // the gatehouse over the way in, its arch to the lane
        const gh = [-1.2, g - 2.5, 3.2, g + 2.5];
        S.box(F, gh[0], gh[1], 0, gh[2], gh[3], 6.2);
        shadeGable(T, F, gableRoof(T, F, gh, 6.2, false, geo.rad(50), rng, { attic: false }));
        const Wg = wall(F, 3, gh);
        if (T.sees(Wg.n)) {
            S.line(pointed(Wg.at, 2.5, 0, 1.3, 2.4).pts);
            if (T.detail) arch(T, Wg.at, 2.5, 4.1, 0.8, 1.3);
        }
        // a few of the brothers about the place
        for (let i = qy0 - rw > 5 ? Math.round(2 + 4 * T.p.people) : 0; i > 0; i--) {
            const u = rng.range(u0, W - 3), v = rng.range(2, qy0 - rw - 1);
            if (u > barn[0] - 1 && u < barn[2] + 1 && v < barn[3] + 1) continue;
            person(T, ...P(u, v, 0).slice(0, 2), LAND, rng);
        }
    }

    // ------------------------------------------------------------------
    // The river
    // ------------------------------------------------------------------

    // The river lies lower than the moat, its banks slope out SLOPE from the
    // water's edge to the top, and a bridge runs on RAMP over the land each end (m)
    const ZR = -0.6, SLOPE = 1.8, RAMP = 3.6;
    const unit2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

    // The ground the page shows at the height of the land, and a way past
    // the top of the page for tall things standing beyond it
    function groundView(T) {
        const { S, cam } = T, tall = 16 * cam.ce * cam.k;
        const view = [[0, -tall * 0.3], [S.W, -tall * 0.3], [S.W, S.H + tall], [0, S.H + tall]].map(([sx, sy]) => cam.ground(sx, sy, LAND));
        return geo.polygonArea(view) < 0 ? view.reverse() : view;
    }

    // The roads, as strips running out from the end of each bridge to off the page
    function gateRoads(town, view) {
        const roads = [];
        for (const g of town.gates) {
            const { r, across, b0, wB, aBank, ramp } = g.road, a1 = aBank - ramp, hw = 2.9, bc = b0 + wB / 2;
            let a0 = a1;
            while (a0 > -2000 && depth(view, r[0] * a0 + across[0] * bc, r[1] * a0 + across[1] * bc) > -30) a0 -= 10;
            const P = (a, b) => [r[0] * a + across[0] * (bc + b), r[1] * a + across[1] * (bc + b), LAND];
            roads.push({ g, a0, a1, hw, P, bc, rect: bounds([P(a0, -hw), P(a1, hw)]) });
        }
        return roads;
    }

    // Points about `step` apart along cubic curves through nodes {x, y, t},
    // each curve's tangents scaled by its chord
    function hermite(nodes, step) {
        const out = [];
        for (let i = 0; i + 1 < nodes.length; i++) {
            const A = nodes[i], B = nodes[i + 1], L = Math.hypot(B.x - A.x, B.y - A.y), n = Math.max(2, Math.ceil((1.5 * L) / step));
            for (let j = i ? 1 : 0; j <= n; j++) {
                const u = j / n, u2 = u * u, u3 = u2 * u;
                const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * L, h01 = 3 * u2 - 2 * u3, h11 = (u3 - u2) * L;
                out.push([h00 * A.x + h10 * A.t[0] + h01 * B.x + h11 * B.t[0], h00 * A.y + h10 * A.t[1] + h01 * B.y + h11 * B.t[1]]);
            }
        }
        return geo.resample(out, step);
    }

    function lengths(pts) {
        const s = [0];
        for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        return s;
    }

    // Left-hand normals along a polyline
    function normals(pts) {
        return pts.map((_, i) => {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], t = unit2([b[0] - a[0], b[1] - a[1]]);
            return [-t[1], t[0]];
        });
    }

    // How far a point is from the edge of the water of a river with center
    // line pts and half widths hw, negative in the water. The nearest segment
    // comes from a grid of `cell` meter squares that each list the segments
    // within `reach` of them. Anything further comes back as about reach.
    function edgeDistance(pts, hw, cell, reach) {
        const grid = new Map(), key = (i, j) => (i + 2048) * 4096 + j + 2048;
        for (let s = 0; s + 1 < pts.length; s++) {
            const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
            for (let i = Math.floor((Math.min(ax, bx) - reach) / cell); i <= Math.floor((Math.max(ax, bx) + reach) / cell); i++) {
                for (let j = Math.floor((Math.min(ay, by) - reach) / cell); j <= Math.floor((Math.max(ay, by) + reach) / cell); j++) {
                    const list = grid.get(key(i, j));
                    if (list) list.push(s);
                    else grid.set(key(i, j), [s]);
                }
            }
        }
        return (x, y) => {
            const list = grid.get(key(Math.floor(x / cell), Math.floor(y / cell)));
            let best = reach, h = hw[0];
            if (list) {
                for (const s of list) {
                    const [ax, ay] = pts[s], ex = pts[s + 1][0] - ax, ey = pts[s + 1][1] - ay;
                    const t = geo.clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1), d = Math.hypot(x - ax - ex * t, y - ay - ey * t);
                    if (d < best) {
                        best = d;
                        h = hw[s] + (hw[s + 1] - hw[s]) * t;
                    }
                }
            }
            return best - h;
        };
    }

    // Where the river runs, as nodes for hermite(). In front of the town it
    // passes both walls that face us and the corner between them, and runs
    // on off the page both ways. Where a wall has a gate the river crosses
    // its road square to it, for the bridge. Behind, it crosses the page past
    // the far walls. Either way it runs left to right.
    function riverNodes(T, town, roads, edge, rng) {
        const { p, cam, S } = T, right = [cam.rx, cam.ry], into = [cam.fx, cam.fy], far = 420;
        if (p.river === 'front') {
            const [gx0, gy0, gx1, gy1] = bounds(offset(town.moat, 7));
            const xs = [[-1, 0], [0, -1]].map(out => {
                // the flow along this wall, left to right on the page
                const t = [-out[1], out[0]];
                const i = roads.findIndex(rd => Math.abs(rd.g.e.n[0] - out[0]) + Math.abs(rd.g.e.n[1] - out[1]) < 1e-6);
                // Well out from the moat, so the river doesn't read as a second one. The
                // main gate's bridge comes back towards the town until it's on the page,
                // and the other one can be off it.
                let d = rng.range(36, 58);
                const rd = roads[i];
                if (!rd) {
                    const f = rng.range(0.3, 0.7), x = out[0] ? gx0 - d + 7 : geo.lerp(gx0, gx1, f), y = out[1] ? gy0 - d + 7 : geo.lerp(gy0, gy1, f);
                    return { x, y, t, out };
                }
                while (i === 0 && d > 26) {
                    const q = T.home.project(...rd.P(rd.a1 - d - edge - 8, 0));
                    if (q[0] > 8 && q[0] < S.W - 8 && q[1] < S.H - 8) break;
                    d -= 2;
                }
                const [x, y] = rd.P(rd.a1 - d, 0);
                return { x, y, t, out, rd, a: rd.a1 - d, hold: true };
            });
            // round the corner well clear of it
            const [L, F] = xs, f = rng.range(0.22, 0.4);
            const corner = { x: geo.lerp(L.x, (L.x + F.x) / 2, f), y: geo.lerp(F.y, (L.y + F.y) / 2, f), t: unit2([F.x - L.x, F.y - L.y]) };
            const end = (c, s) => {
                const D = rng.range(-30, 70);
                return { x: c.x + s * c.t[0] * far + c.out[0] * D, y: c.y + s * c.t[1] * far + c.out[1] * D };
            };
            return [end(L, -1), L, corner, F, end(F, 1)];
        }
        let w0 = -Infinity, u0 = Infinity, u1 = -Infinity;
        for (const q of offset(town.moat, 7)) {
            w0 = Math.max(w0, dot2(q, into));
            u0 = Math.min(u0, dot2(q, right));
            u1 = Math.max(u1, dot2(q, right));
        }
        const at = (u, w) => ({ x: right[0] * u + into[0] * w, y: right[1] * u + into[1] * w });
        const w = w0 + edge + rng.range(8, 30);
        return [at(u0 - far, w + rng.range(-40, 60)), at(geo.lerp(u0, u1, rng.range(0.3, 0.7)), w), at(u1 + far, w + rng.range(-40, 60))];
    }

    // The river: its center line every 2 m with the normals, half widths and
    // distance along it, where it crosses the roads, and the pieces of water
    // and of bank on the page that the shadows get cut to
    function riverPlan(T, town, roads, view, rng) {
        if (T.p.river === 'none') return null;
        const hw0 = T.p.riverWidth / 2, edge = hw0 + SLOPE, step = 2;
        const nodes = riverNodes(T, town, roads, edge, rng);
        nodes.forEach((n, i) => {
            if (n.t) return;
            const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)];
            n.t = unit2([b.x - a.x, b.y - a.y]);
        });
        const holds = nodes.filter(n => n.hold);
        const nearest = (pts, n) => {
            let k = 0, b = Infinity;
            pts.forEach((q, i) => {
                const d = (q[0] - n.x) ** 2 + (q[1] - n.y) ** 2;
                if (d < b) { b = d; k = i; }
            });
            return k;
        };
        let pts = hermite(nodes, step), s = lengths(pts), N = normals(pts);
        // The river runs dead straight through each crossing for the bridge,
        // then eases into its bends. Crossings close together share the room.
        const sh = holds.map(n => s[nearest(pts, n)]), H1 = edge + 8;
        const H2 = Math.max(H1 + 6, Math.min(H1 + 30, ...sh.slice(1).map((v, i) => (v - sh[i]) / 2)));
        const freedom = (pts, s) => {
            const at = holds.map(n => s[nearest(pts, n)]);
            return s.map(v => at.reduce((m, h) => Math.min(m, geo.smoothstep(H1, H2, Math.abs(v - h))), 1));
        };
        let free = freedom(pts, s);
        // meanders, a long wave and a short one on top
        const waves = [[rng.range(5, 10) + hw0 * 0.3, rng.range(110, 170)], [rng.range(1.5, 4), rng.range(40, 65)]].map(([A, L]) => [A, L, rng.range(0, TAU)]);
        pts = pts.map((q, i) => {
            const m = free[i] * waves.reduce((sum, [A, L, ph]) => sum + A * Math.sin((TAU * s[i]) / L + ph), 0);
            return [q[0] + N[i][0] * m, q[1] + N[i][1] * m];
        });
        holds.forEach((n, j) => {
            pts = pts.map((q, i) => {
                const d = s[i] - sh[j], f = geo.smoothstep(H1, H2, Math.abs(d));
                return f >= 1 ? q : [geo.lerp(n.x + n.t[0] * d, q[0], f), geo.lerp(n.y + n.t[1] * d, q[1], f)];
            });
        });
        // pushed out where a bend comes too close to the moat
        const glacis = offset(town.moat, 7), need = edge + 5;
        const room = (x, y) => (depth(glacis, x, y) > 0 ? -depth(glacis, x, y) : distOut(glacis, x, y));
        for (let it = 0; it < 6; it++) {
            let moved = false;
            pts = pts.map((q, i) => {
                const c = room(q[0], q[1]);
                if (c >= need || free[i] <= 0) return q;
                moved = true;
                const l = Math.hypot(q[0], q[1]) || 1, m = need - c + 1;
                return [q[0] + (q[0] / l) * m, q[1] + (q[1] / l) * m];
            });
            if (!moved) break;
            pts = pts.map((q, i) => (i && i < pts.length - 1 && free[i] > 0 ? [(pts[i - 1][0] + 2 * q[0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * q[1] + pts[i + 1][1]) / 4] : q));
        }
        pts = geo.resample(pts, step);
        s = lengths(pts);
        N = normals(pts);
        free = freedom(pts, s);
        // a little wider in some reaches than others
        const [wa, wl, wp] = [rng.range(0.05, 0.12), rng.range(70, 120), rng.range(0, TAU)];
        const hw = s.map((v, i) => hw0 * (1 + free[i] * wa * Math.sin((TAU * v) / wl + wp)));
        const off = (sg, d) => pts.map((q, i) => [q[0] + N[i][0] * sg * (hw[i] + d), q[1] + N[i][1] * sg * (hw[i] + d)]);
        const on = pts.map(([x, y]) => depth(view, x, y) > -30);
        const L = off(1, 0), R = off(-1, 0), LT = off(1, SLOPE), RT = off(-1, SLOPE), water = [], bank = [];
        for (let i = 0; i + 1 < pts.length; i++) {
            if (!on[i] && !on[i + 1]) continue;
            water.push([R[i], R[i + 1], L[i + 1], L[i]]);
            bank.push([RT[i], RT[i + 1], LT[i + 1], LT[i]]);
        }
        if (!bank.length) return null;
        const crossings = holds.map(n => {
            const k = nearest(pts, n);
            return { ...n, k, s: s[k], hw: hw[k] };
        });
        // meadows along both banks, which the fields stop short of
        const meadow = rng.range(3, 7);
        return { pts, s, N, hw, on, off, crossings, water, bank, meadow, area: bounds(bank.flat()), gap: edgeDistance(pts, hw, 16, edge + 40), dry: [] };
    }

    // The parts of a polyline that keep at least r from the water's edge, as
    // polylines. Segments that come near it are walked in short steps and each
    // crossing found by halving.
    function offRiver(R, pts, r) {
        const out = [], at = (A, B, t) => A.map((v, i) => v + (B[i] - v) * t), keep = q => R.gap(q[0], q[1]) >= r;
        let cur = null;
        for (let i = 1; i < pts.length; i++) {
            const A = pts[i - 1], B = pts[i], L = Math.hypot(B[0] - A[0], B[1] - A[1]), m = at(A, B, 0.5);
            let k0 = R.gap(m[0], m[1]) - L / 2 > r + 0.5 || keep(A);
            if (!k0) cur = null;
            else if (!cur) out.push((cur = [A]));
            if (R.gap(m[0], m[1]) - L / 2 > r + 0.5) {
                cur.push(B);
                continue;
            }
            const n = Math.max(1, Math.ceil(L / 0.6));
            for (let j = 1; j <= n; j++) {
                const t1 = j / n, k1 = keep(at(A, B, t1));
                if (k1 !== k0) {
                    let lo = (j - 1) / n, hi = t1;
                    for (let b = 0; b < 12; b++) {
                        const mid = (lo + hi) / 2;
                        if (keep(at(A, B, mid)) === k0) lo = mid;
                        else hi = mid;
                    }
                    const X = at(A, B, (lo + hi) / 2);
                    if (k0) {
                        cur.push(X);
                        cur = null;
                    } else out.push((cur = [X]));
                    k0 = k1;
                }
            }
            if (k0) cur.push(B);
        }
        return out.filter(q => q.length > 1);
    }

    // Run fn with every line it lays flat on the land cut where it comes
    // within r of the water's edge. Lines that stand up, like trees and
    // tufts, go through as they are, so fn has to keep those off itself.
    function keepDry(T, R, r, fn) {
        if (!R) return fn();
        const S = T.S, draw = Scene.prototype.line;
        S.line = function (pts, whole) {
            if (pts.some(q => Math.abs(q[2] - LAND) > 1e-6)) return draw.call(this, pts, whole);
            for (const part of offRiver(R, pts, r)) draw.call(this, part, whole);
        };
        try {
            fn();
        } finally {
            delete S.line;
        }
    }

    // The banks: slopes down to the water as faces, with a strip of the land
    // along the top of each, so the near bank hides the water under it. The
    // top and the foot of each slope are drawn, and grass down the ones we see.
    function riverBanks(T, R) {
        const S = T.S, { pts, on } = R;
        for (const sg of [1, -1]) {
            const W = R.off(sg, 0), E = R.off(sg, SLOPE), O = R.off(sg, SLOPE + 4.5);
            S.kind = INK;
            let foot = [], top = [];
            const flush = () => {
                if (foot.length > 1) S.line(foot);
                if (top.length > 1) S.line(top);
                foot = [];
                top = [];
            };
            for (let i = 0; i < pts.length; i++) {
                if (!on[i]) {
                    flush();
                    continue;
                }
                foot.push([...W[i], ZR]);
                top.push([...E[i], LAND]);
                if (i + 1 < pts.length) {
                    const w0 = [...W[i], ZR], w1 = [...W[i + 1], ZR], e0 = [...E[i], LAND], e1 = [...E[i + 1], LAND];
                    S.face([w0, w1, e1], false);
                    S.face([w0, e1, e0], false);
                    S.face([e0, e1, [...O[i + 1], LAND], [...O[i], LAND]], false);
                }
            }
            flush();
            if (!T.detail) continue;
            // grass in strokes down the slope, far enough apart on paper to stay apart
            S.kind = GREEN;
            for (let i = 1, next = 0; i + 1 < pts.length; i++) {
                if (!on[i] || R.s[i] < next) continue;
                const n = R.N[i], t = [n[1], -n[0], 0], drop = LAND - ZR;
                if (!T.sees([-sg * n[0] * drop, -sg * n[1] * drop, SLOPE])) continue;
                const f0 = 0.12, f1 = 0.5 + 0.15 * Math.sin(i * 2.7), e = E[i], w = W[i];
                S.line([[geo.lerp(e[0], w[0], f0), geo.lerp(e[1], w[1], f0), LAND - drop * f0], [geo.lerp(e[0], w[0], f1), geo.lerp(e[1], w[1], f1), LAND - drop * f1]], true);
                next = R.s[i] + Math.max(1.6, 1.4 / Math.max(apart(T, UP, t), 0.05));
            }
            S.kind = INK;
        }
    }

    // Stone bridge over the river on round arches, with cutwaters on the
    // piers between them and a hump in the road. F is the road's frame from
    // gateRoad. The water runs from a0 to a1 along the road and the banks
    // slope up SLOPE further each side. The arches are dark under the side we see.
    function riverBridge(T, F, a0, a1, w) {
        const S = T.S, P = F.P, e0 = a0 - SLOPE, e1 = a1 + SLOPE, A0 = e0 - RAMP, A1 = e1 + RAMP, hump = 1.4, pw = 0.3, ph = 0.85;
        const top = a => LAND + 0.08 + hump * Math.pow(Math.max(0, Math.sin((Math.PI * (a - A0)) / (A1 - A0))), 0.7);
        const ground = a => (a <= e0 || a >= e1 ? LAND : a < a0 ? ZR + ((LAND - ZR) * (a0 - a)) / SLOPE : a > a1 ? ZR + ((LAND - ZR) * (a - a1)) / SLOPE : ZR);
        // Arches across the water, the outer ones springing from the foot of the
        // banks. Each is round on its piers where there's the height, and
        // flattened where there isn't.
        const z0 = a0 - 0.4, z1 = a1 + 0.4, n = Math.max(2, Math.round((z1 - z0 + 0.2) / 5.2)), pier = 1.4;
        const sp = (z1 - z0 - (n - 1) * pier) / n;
        const arches = Array.from({ length: n }, (_, i) => {
            const s0 = z0 + i * (sp + pier), m = s0 + sp / 2, crown = top(m) - 0.6;
            const spring = Math.max(ZR + 0.25, crown - sp / 2), rise = crown - spring, R = (sp * sp) / (8 * rise) + rise / 2;
            return { s0, s1: s0 + sp, m, R, spring, zc: crown - R };
        });
        const under = a => {
            for (const A of arches) if (a >= A.s0 - 1e-6 && a <= A.s1 + 1e-6) return A.zc + Math.sqrt(Math.max(0, A.R * A.R - (a - A.m) ** 2));
            return a > z0 && a < z1 ? ZR : Math.max(ZR, ground(a) - 0.05);
        };
        const as = [];
        const run = (u, v, k) => { for (let i = 0; i < k; i++) as.push(u + ((v - u) * i) / k); };
        run(A0, e0, 3);
        run(e0, z0, 2);
        arches.forEach((A, i) => {
            run(A.s0, A.s1, 14);
            if (i + 1 < n) run(A.s1, arches[i + 1].s0, 1);
        });
        run(z1, e1, 2);
        run(e1, A1, 3);
        as.push(A1);
        S.kind = INK;
        for (let i = 0; i + 1 < as.length; i++) {
            const a = as[i], b = as[i + 1], ta = top(a), tb = top(b), ba = under(a + 1e-4), bb = under(b - 1e-4);
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
        for (const [a, s] of [[A0, 1], [A1, -1]]) {
            const t = top(a);
            S.line([P(a, 0, LAND), P(a, 0, t + ph), P(a, pw, t + ph), P(a, pw, t), P(a, w - pw, t), P(a, w - pw, t + ph), P(a, w, t + ph), P(a, w, LAND)]);
            // where the bridge meets the bank, down to the first arch
            const g = s > 0 ? as.filter(u => u <= z0) : as.filter(u => u >= z1);
            S.line(g.map(u => P(u, 0, ground(u))));
        }
        const ring = Math.max(0.45, FINE / T.k), stone = Math.max(0.55, (1.2 * FINE) / T.k);
        arches.forEach((A, i) => {
            const f0 = Math.atan2(A.spring - A.zc, A.s0 - A.m), f1 = Math.atan2(A.spring - A.zc, A.s1 - A.m);
            const on = (f, r, b = 0) => P(A.m + r * Math.cos(f), b, A.zc + r * Math.sin(f));
            const curve = (r, b) => Array.from({ length: 25 }, (_, j) => on(geo.lerp(f0, f1, j / 24), r, b));
            // the arch and the piers down to the water, the opening a face so the
            // water doesn't show through it, hatched dark
            const hole = [P(A.s0, 0, ZR), ...curve(A.R), P(A.s1, 0, ZR)];
            S.face(hole, false);
            S.line([P(A.s0, 0, under(A.s0 - 0.01)), ...curve(A.R), P(A.s1, 0, under(A.s1 + 0.01))]);
            if (T.tones) inKind(S, T.tones.dark, () => S.hatch(hole, UP, T.hDark));
            // the voussoirs only once the arch is big enough on paper to keep them apart
            if (T.detail && A.R * T.k > 3.2) {
                S.line(curve(A.R + ring));
                const k = Math.max(5, Math.round((A.R * (f0 - f1)) / stone));
                for (let j = 1; j < k; j++) S.line([on(geo.lerp(f0, f1, j / k), A.R), on(geo.lerp(f0, f1, j / k), A.R + ring)]);
            }
            if (i + 1 < n) {
                // the cutwaters, a pointed buttress on each face of the pier, capped with a slope
                const B = arches[i + 1], u0 = A.s1, u1 = B.s0, um = (u0 + u1) / 2, zt = Math.min(A.spring, B.spring) + 0.45;
                for (const [b, d] of [[0, -1.1], [w, 1.1]]) {
                    S.prism([P(u0, b, ZR), P(u1, b, ZR), P(um, b + d, ZR)], [0, 0, zt - ZR]);
                    S.solid([P(u0, b, zt), P(u1, b, zt), P(um, b + d, zt), P(um, b, zt + 0.9)], [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]]);
                }
            }
        });
    }

    // Gate tower over the road at the outer end of a bridge: a square tower
    // the road runs through under a pointed arch, with arrow loops up the
    // side in the sun, the side out of it hatched like the town's square
    // towers, and a pyramid roof or battlements. F is the road's frame, a the
    // middle of the tower along the road and w the road's width.
    function bridgeGate(T, F, a, w, rng) {
        const S = T.S, P = F.P, hw = w / 2 + 1, bm = w / 2, h = LAND + rng.range(8.5, 10), fp = [a - 2.9, bm - hw, a + 2.9, bm + hw];
        S.kind = INK;
        S.box(F, fp[0], fp[1], LAND, fp[2], fp[3], h);
        const zs = geo.lerp(LAND, h, 0.62), band = Math.max(0.3, FINE / (T.k * T.cam.ce));
        S.box(F, fp[0] - 0.14, fp[1] - 0.14, zs, fp[2] + 0.14, fp[3] + 0.14, zs + band);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            // the way through, on the two ends the road comes out of
            const end = side === 1 || side === 3, A = end && pointed(W.at, W.len / 2, LAND, 1.7, LAND + 2.9);
            if (A) S.line(A.pts);
            if (W.n[1] < -0.5 && T.tones) {
                const n = Math.max(1, Math.floor((W.len * wallScale(T, W.at).pu) / T.hLit));
                for (let i = 1; i < n; i++) {
                    const s = (W.len * i) / n, c0 = A && Math.abs(s - W.len / 2) < 1.7 ? A.under(s) + 0.05 : LAND;
                    S.line([W.at(s, c0), W.at(s, zs - 0.05)]);
                    S.line([W.at(s, zs + band + 0.05), W.at(s, h)]);
                }
            } else if (T.detail && !A) {
                for (const c of [LAND + 2.2, zs + band + 1]) {
                    S.line([W.at(W.len / 2, c), W.at(W.len / 2, c + 1.3)]);
                    S.line([W.at(W.len / 2 - 0.25, c + 0.75), W.at(W.len / 2 + 0.25, c + 0.75)]);
                }
            }
        }
        const style = T.p.towerRoofs === 'crenels' || (T.p.towerRoofs === 'mixed' && rng.chance(0.5)) ? 'crenel' : 'roof';
        if (style === 'crenel') {
            const g = 0.45, top = h + 1.05, mw = T.merlon, mh = mw * 0.85, q = [fp[0] - g, fp[1] - g, fp[2] + g, fp[3] + g];
            S.box(F, q[0], q[1], h - 0.4, q[2], q[3], top);
            for (const u of [q[0], q[2] - mw]) for (const v of [q[1], q[3] - mw]) S.box(F, u, v, top, u + mw, v + mw, top + mh);
            for (const [u0, u1, v0, v1, along] of [[q[0], q[2], q[1], q[1] + 0.55, true], [q[0], q[2], q[3] - 0.55, q[3], true], [q[0], q[0] + 0.55, q[1], q[3], false], [q[2] - 0.55, q[2], q[1], q[3], false]]) {
                const L = along ? u1 - u0 : v1 - v0, k = Math.floor((L - mw) / (2 * mw)) - 1;
                for (let i = 1; i <= k; i++) {
                    const s = ((L - mw) * i) / (k + 1);
                    if (along) S.box(F, u0 + s, v0, top, u0 + s + mw, v1, top + mh);
                    else S.box(F, u0, v0 + s, top, u1, v0 + s + mw, top + mh);
                }
            }
            if (T.p.banners) flag(T, ...P(a, bm, 0).slice(0, 2), top, 3.2);
            return;
        }
        const g = 0.4, zb = h - 0.25, rim = [P(fp[0] - g, fp[1] - g, zb), P(fp[2] + g, fp[1] - g, zb), P(fp[2] + g, fp[3] + g, zb), P(fp[0] - g, fp[3] + g, zb)];
        const apex = P(a, bm, zb + (fp[2] - fp[0] + 2 * g) * 0.9);
        S.solid(rim.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        for (let i = 0; i < 4; i++) {
            const tri = [rim[i], rim[(i + 1) % 4], apex], n = outward(tri, [apex[0], apex[1], zb + 1]);
            shade(T, tri, n, n[0] < -Math.abs(n[1]) ? 'lit' : 'roof');
        }
        if (T.p.banners) flag(T, apex[0], apex[1], apex[2] - 0.1, 2.6);
        else S.line([apex, [apex[0], apex[1], apex[2] + 1]]);
    }

    // Where the water mill goes, in a frame F with a along the bank and b out
    // from its top. In front of the town it's on the far bank beside the main
    // road's bridge, a little way along on the side away from the arches we
    // see, so it hides neither them nor its own wheel. Behind the town it
    // takes a reach that isn't behind the walls. Null when there's no room.
    // It's placed by the view at a zoom of 1, so zooming doesn't move it.
    function millSite(T, R, town, rng) {
        const { cam, S } = T, f = [cam.fx, cam.fy], L = rng.range(9, 11.5), D = rng.range(6, 7.2);
        const site = (i, s) => {
            if (i < 2 || i > R.pts.length - 3) return null;
            const n = R.N[i], sg = dot2(n, f) > 0 ? 1 : -1, t = [n[1], -n[0]], u = sg > 0 ? t : [-t[0], -t[1]], o = R.hw[i] + SLOPE;
            const F = turned(R.pts[i][0] + n[0] * sg * o, R.pts[i][1] + n[1] * sg * o, LAND, Math.atan2(u[1], u[0]));
            const foot = [F.P(-L / 2, 0.4, 0), F.P(L / 2, 0.4, 0), F.P(L / 2, D + 0.4, 0), F.P(-L / 2, D + 0.4, 0)].map(q => [q[0], q[1]]);
            const q = [F.P(-L / 2, 0, 0), F.P(L / 2, 0, 0), F.P(0, D, 10)].map(v => T.home.project(...v));
            if (q.some(([x, y]) => x < 6 || x > S.W - 6 || y < 6 || y > S.H - 6)) return null;
            return { F, L, D, i, s, sg, t, foot };
        };
        const at = s => R.s.findIndex(v => v >= s);
        if (R.crossings.length) {
            // the main gate's bridge first, then the other, then the side of each we see the arches from
            const order = R.crossings.slice().sort((u, v) => (v.rd.g === town.gates[0]) - (u.rd.g === town.gates[0])), gap = rng.range(5, 8);
            for (const back of [1, -1]) {
                for (const c of order) {
                    const n = R.N[c.k], along = back * (dot2([n[1], -n[0]], c.rd.g.road.across) > 0 ? 1 : -1);
                    const s = c.s + along * (c.rd.g.road.wB / 2 + gap + L / 2), m = site(at(s), s);
                    if (m) return m;
                }
            }
            return null;
        }
        // behind the town, somewhere its walls and towers don't stand in front of
        const tall = town.towers.map(tw => [T.home.project(tw.x, tw.y, tw.top), T.home.project(tw.x, tw.y, 0)]);
        const clear = i => {
            const [x, y] = T.home.project(...R.pts[i], LAND);
            return !tall.some(([a, b]) => Math.abs(a[0] - x) < 22 && y > a[1] - 10 && y < b[1]);
        };
        const shown = i => (([x, y]) => x > 6 && x < S.W - 6 && y > 6 && y < S.H - 6)(T.home.project(...R.pts[i], LAND));
        const options = R.pts.map((_, i) => i).filter(i => i % 5 === 0 && shown(i) && clear(i));
        for (let k = 0; k < 6 && options.length; k++) {
            const i = rng.pick(options), m = site(i, R.s[i]);
            if (m) return m;
        }
        return null;
    }

    // Water mill: a stone ground floor, a timber-framed floor above under a
    // long roof with a hoist in the gable, and an undershot wheel in the
    // river in front of it, with a weir across the river just upstream
    function waterMill(T, R, m, rng) {
        const S = T.S, { F, L, D } = m, P = F.P, fp = [-L / 2, 0.4, L / 2, D + 0.4], g0 = 3.4, z1 = g0 + FLOOR;
        S.kind = INK;
        S.box(F, fp[0], fp[1], 0, fp[2], fp[3], g0);
        S.box(F, fp[0] - 0.2, fp[1] - 0.25, g0, fp[2] + 0.2, fp[3] + 0.25, z1);
        const up = [fp[0] - 0.2, fp[1] - 0.25, fp[2] + 0.2, fp[3] + 0.25];
        const roof = gableRoof(T, F, up, z1 + 0.25, true, geo.rad(rng.range(48, 54)), rng, { attic: false });
        shadeGable(T, F, roof);
        for (const side of [0, 1, 2, 3]) timbered(T, wall(F, side, up), g0, z1);
        // the hoist under the gable that faces the road
        for (const [ga, gn] of [[up[0] - roof.oh, -1], [up[2] + roof.oh, 1]]) {
            if (T.sees(F.V(gn, 0, 0))) kit.hoist(T, { P: (u, v, c) => P(ga + gn * (1 - v), u, c), V: F.V }, roof.mid, 1, roof.zb + roof.rise * 0.45);
        }
        const W0 = wall(F, 0, fp);
        if (T.sees(W0.n)) {
            door(T, W0.at, L * 0.22, 0, 1.1, 2.3);
            for (const f of [0.55, 0.8]) pane(T, W0.at, L * f - 0.45, 1.2, 0.9, 1, 'cross');
        }
        for (const side of [1, 3]) {
            const W = wall(F, side, fp);
            if (T.sees(W.n)) door(T, W.at, W.len * 0.5, 0, 1.3, 2.4, true);
        }
        // the wheel, its floats round the rim, turning in the water off the bank
        const r = Math.min(3, L * 0.28), bw = -SLOPE - 0.55, zc = ZR + r * 0.72, n = Math.max(24, T.segs(r));
        const at = (a, c, b = bw) => P(a, b, c - LAND);
        const rim = (rr, b) => Array.from({ length: n + 1 }, (_, j) => [rr * Math.cos((TAU * j) / n), zc + rr * Math.sin((TAU * j) / n)]).map(([a, c]) => [a, Math.max(c, ZR + 0.02), b]);
        S.kind = WOOD;
        const disc = rim(r, bw).slice(0, n).filter(([, c]) => c > ZR + 0.02).map(([a, c]) => at(a, c));
        if (disc.length > 2) S.face(disc);
        for (const b of [bw, bw + 0.7]) {
            const pts = rim(r, b);
            let run = [];
            for (const [a, c, bb] of pts) {
                if (c > ZR + 0.03) run.push(at(a, c, bb));
                else if (run.length) { S.line(run); run = []; }
            }
            if (run.length > 1) S.line(run);
        }
        S.loop(ring(T.segs(r * 0.25), (cs, sn) => at(r * 0.25 * cs, zc + r * 0.25 * sn)));
        const floats = Math.max(8, Math.min(16, Math.round((TAU * r * T.k) / (2.2 * FINE))));
        for (let j = 0; j < floats; j++) {
            const a = (TAU * (j + 0.5)) / floats, cs = Math.cos(a), sn = Math.sin(a);
            if (zc + r * sn < ZR + 0.1) continue;
            if (j % 2 === 0) S.line([at(r * 0.25 * cs, zc + r * 0.25 * sn), at(r * cs, zc + r * sn)]);
            S.line([at(r * cs, zc + r * sn), at((r + 0.4) * cs, zc + (r + 0.4) * sn)]);
        }
        // the axle into the bank
        S.line([at(0, zc, bw + 0.7), at(0, zc, -0.6)]);
        S.kind = INK;
        // the weir, slanting upstream across the river from just above the wheel
        const k0 = R.s.findIndex(v => v >= m.s - r - 0.8), k1 = R.s.findIndex(v => v >= m.s - r - 0.8 - R.hw[m.i] * 0.9);
        if (k0 > 0 && k1 > 0) {
            const side = (k, sg) => [R.pts[k][0] + R.N[k][0] * sg * (R.hw[k] + 0.3), R.pts[k][1] + R.N[k][1] * sg * (R.hw[k] + 0.3)];
            const A = side(k0, m.sg), B = side(k1, -m.sg), d = unit2([B[0] - A[0], B[1] - A[1]]), nn = [-d[1] * 0.35, d[0] * 0.35];
            const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
            S.prism([[A[0] - nn[0], A[1] - nn[1], ZR], [A[0] + nn[0], A[1] + nn[1], ZR], [A[0] + nn[0], A[1] + nn[1], ZR + 0.35], [A[0] - nn[0], A[1] - nn[1], ZR + 0.35]], [B[0] - A[0], B[1] - A[1], 0]);
            // white water below it, in short strokes
            const fall = m.t;
            S.kind = WATER;
            for (let u = 1; u < len - 0.6; u += Math.max(1.1, 1.4 / T.k)) {
                const x = A[0] + d[0] * u + fall[0] * rng.range(0.7, 1.4), y = A[1] + d[1] * u + fall[1] * rng.range(0.7, 1.4);
                S.line([[x, y, ZR], [x + fall[0] * rng.range(0.6, 1.2), y + fall[1] * rng.range(0.6, 1.2), ZR]]);
            }
            S.kind = INK;
            const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
            R.dry.push((x, y, e = 0) => Math.hypot(x - mid[0], y - mid[1]) < len / 2 + 3 + e);
        }
        const wc = at(0, ZR);
        R.dry.push((x, y, e = 0) => Math.hypot(x - wc[0], y - wc[1]) < r + 2 + e);
        R.dry.push((x, y, e = 0) => (depth(m.foot, x, y) > 0 ? 0 : distOut(m.foot, x, y)) < 2 + e);
    }

    // Pollard willow by the water: a stubby trunk with a ball of thin shoots on top
    function willow(T, x, y, rng) {
        const S = T.S, P = card(T, x, y, LAND, 0.1), th = rng.range(1.9, 2.6), r = rng.range(1.6, 2.1), ce = T.cam.ce;
        S.kind = GREEN;
        const crown = ring(18, (c, s) => P(r * c * (1 + 0.08 * Math.sin(c * 9 + s * 3)), th + r * 0.85 + (r * 0.85 * s) / ce));
        S.face(crown);
        S.loop(crown);
        if (T.detail && r * T.k > 1.6) for (const a of [-0.55, 0, 0.55]) S.line([P(a * 0.3, th + 0.15), P(a * r * 1.15, th + r * 1.45)]);
        const tw = 0.32, trunk = [P(-tw, 0), P(tw, 0), P(tw * 1.35, th), P(-tw * 1.35, th)];
        S.face(trunk);
        S.loop(trunk);
        S.kind = INK;
    }

    // A clump of reeds standing in the water at the edge
    function reeds(T, x, y, rng) {
        const P = card(T, x, y, ZR, 0), w = Math.max(0.45, FINE / T.k), h = rng.range(1, 1.5);
        T.S.kind = GREEN;
        for (const u of [-1, 0, 1]) T.S.line([P(u * w * 0.25, 0), P(u * w, h * (1 - 0.15 * Math.abs(u)))], true);
        T.S.kind = INK;
    }

    // Willows and reeds along the banks, and swans and a boat on the water.
    // The patches of water they take go in R.dry for the ripples.
    function riverLife(T, R, rng) {
        const { S, p } = T, { pts, on, s } = R;
        const busy = i => R.crossings.some(c => Math.abs(s[i] - c.s) < 11) || R.dry.some(f => f(...pts[i], 6)), stood = [];
        // a point on side sg of the river, d out from the edge of the water
        const bank = (i, sg, d) => [pts[i][0] + R.N[i][0] * sg * (R.hw[i] + d), pts[i][1] + R.N[i][1] * sg * (R.hw[i] + d)];
        for (const sg of [1, -1]) {
            const W = R.off(sg, 0);
            for (let i = rng.int(0, 6); i < pts.length; i += rng.int(3, 8)) {
                if (!on[i] || busy(i) || !rng.chance(0.3 + 0.6 * p.trees)) continue;
                const [x, y] = bank(i, sg, SLOPE + rng.range(1, 2.2));
                if (rng.chance(0.75)) willow(T, x, y, rng);
                else tree(T, x, y, LAND, rng);
                stood.push([x, y]);
            }
            // reeds where the water's edge shows, in twos and threes
            for (let i = rng.int(0, 5); i < pts.length; i += rng.int(4, 12)) {
                if (!on[i] || busy(i)) continue;
                for (let j = rng.int(1, 3); j > 0; j--) {
                    const k = Math.min(pts.length - 1, i + j), n = R.N[k], d = -rng.range(0.3, 0.9);
                    const [x, y] = [W[k][0] + n[0] * sg * d, W[k][1] + n[1] * sg * d];
                    reeds(T, x, y, rng);
                    R.dry.push(((u, v) => (q, w, m = 0) => Math.hypot(q - u, w - v) < 1.3 + m)(x, y));
                }
            }
        }
        // somewhere on the open water, clear of the bridges and of what's there already
        const spot = (m, side) => {
            for (let t = 0; t < 40; t++) {
                const i = rng.int(0, pts.length - 1), n = R.N[i], o = side != null ? side * (R.hw[i] - m) : rng.range(-1, 1) * (R.hw[i] - m - 0.5);
                if (!on[i] || R.hw[i] < m + 1 || R.crossings.some(c => Math.abs(s[i] - c.s) < 14 + m)) continue;
                const x = pts[i][0] + n[0] * o, y = pts[i][1] + n[1] * o;
                if (R.dry.some(f => f(x, y, m)) || T.cam.project(x, y, 0)[1] < 0) continue;
                return [x, y, i];
            }
            return null;
        };
        const patch = (x, y, r) => R.dry.push((u, v, m = 0) => Math.hypot(u - x, v - y) < r + m);
        for (let j = Math.round(p.moatLife * 4 + rng.range(-0.5, 0.5)); j > 0; j--) {
            const at = spot(2.4);
            if (!at) continue;
            swan(T, at[0], at[1], rng.sign(), ZR);
            patch(at[0], at[1], 2.6);
        }
        if (rng.chance(0.4 + 0.5 * p.people)) {
            const at = spot(1.2, rng.sign());
            if (at) {
                const t = unit2([pts[Math.min(at[2] + 1, pts.length - 1)][0] - pts[Math.max(at[2] - 1, 0)][0], pts[Math.min(at[2] + 1, pts.length - 1)][1] - pts[Math.max(at[2] - 1, 0)][1]]);
                S.kind = WOOD;
                kit.boat(T, turned(at[0], at[1], ZR, Math.atan2(t[1], t[0])), 'row', rng);
                S.kind = FIGURE;
                kit.person(T, at[0], at[1], ZR + 0.35, rng);
                S.kind = INK;
                patch(at[0], at[1], 3.4);
            }
        }
        // cattle grazing the meadows, where they're wide enough
        const roomy = (x, y, m) => !stood.some(([u, v]) => Math.hypot(u - x, v - y) < m) && !R.dry.some(f => f(x, y, m - 1.5));
        for (let g = R.meadow > 3.6 ? Math.round(p.people * 3 + rng.range(-0.5, 0.5)) : 0; g > 0; g--) {
            const i = rng.int(0, pts.length - 1), sg = rng.sign();
            if (!on[i] || busy(i)) continue;
            for (let j = rng.int(2, 4); j > 0; j--) {
                const k = geo.clamp(i + rng.int(-3, 3), 0, pts.length - 1), [x, y] = bank(k, sg, SLOPE + rng.range(1.6, R.meadow - 0.8));
                const dir = rng.sign();
                if (!on[k] || !roomy(x, y, 2.6)) continue;
                beast(T, x, y, dir, false);
                stood.push([x, y]);
            }
        }
        // and someone fishing off the bank, the line out from the rod's tip to the water
        for (let t = rng.chance(0.3 + 0.6 * p.people) ? 20 : 0; t > 0; t--) {
            const i = rng.int(0, pts.length - 1), sg = rng.sign();
            if (!on[i] || busy(i)) continue;
            const [x, y] = bank(i, sg, SLOPE + 0.7);
            if (!roomy(x, y, 2)) continue;
            person(T, x, y, LAND, rng);
            const o = [-R.N[i][0] * sg, -R.N[i][1] * sg], tip = [x + o[0] * 3.4, y + o[1] * 3.4, LAND + 2.4], bob = [x + o[0] * 4.8, y + o[1] * 4.8, ZR];
            S.kind = WOOD;
            S.line([[x + o[0] * 0.3, y + o[1] * 0.3, LAND + 1.1], tip]);
            S.line([tip, bob]);
            S.kind = INK;
            patch(bob[0], bob[1], 1.5);
            break;
        }
    }

    // Ripple lines along both banks of the river, as far out from the bank as
    // round the moat, solid and then dashed. Bits shorter than 2.5 mm are dropped.
    function riverRipples(T, R, clear) {
        const { S, k } = T, { pts, on, hw, N } = R, step = 0.3 / k;
        S.kind = WATER;
        for (const [mm, dash, gap] of [[1.9, Infinity, 0], [4.3, 9, 2.4]]) {
            // the lines off the two banks keep 1.8 mm apart in the middle
            const period = (dash + gap) / k, room = mm + 0.9;
            for (const sg of [1, -1]) {
                let run = [], t = sg > 0 ? 0.7 : 2.1;
                const flush = () => {
                    if (run.length * step * k >= 2.5) S.line(run.map(([x, y]) => [x, y, ZR]));
                    run = [];
                };
                for (let i = 0; i + 1 < pts.length; i++) {
                    const d0 = hw[i] - mm / k, d1 = hw[i + 1] - mm / k;
                    if (!on[i] || hw[i] * k < room) {
                        flush();
                        continue;
                    }
                    const a = [pts[i][0] + N[i][0] * sg * d0, pts[i][1] + N[i][1] * sg * d0], b = [pts[i + 1][0] + N[i + 1][0] * sg * d1, pts[i + 1][1] + N[i + 1][1] * sg * d1];
                    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    for (let u = 0; u < len; u += step, t += step) {
                        const x = a[0] + ((b[0] - a[0]) * u) / len, y = a[1] + ((b[1] - a[1]) * u) / len;
                        if ((t % period) * k < dash && clear(x, y)) run.push([x, y]);
                        else flush();
                    }
                }
                flush();
            }
        }
        S.kind = INK;
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
        const busy = (x, y) => town.cells.some(c => inRect(c.rect, x, y, 0.4)) || (town.castle && inRect(town.castle.zone, x, y, 3));
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
        // the roads out and the river are laid out first, so the town's shadows can fall on the river too
        for (const g of town.gates) g.road = gateRoad(g, p);
        const view = groundView(T), roads = gateRoads(town, view);
        const river = riverPlan(T, town, roads, view, new PG.RNG(hash(seed, 6)));
        // Shadows on the moat are hatched level across the page like Harbor's
        // water. Each piece of ground gets its own group, trimmed to it at the end.
        const level = Math.atan2(cam.ry, cam.rx), water = S.shadowGroup(0, null, level);
        const trims = water ? [{ g: water, keep: town.moat, minus: [] }] : [];
        const group = (keep, minus = []) => {
            const g = S.shadowGroup(LAND, null, 0);
            if (g) {
                trims.push({ g, keep, minus });
                if (keep) g.area = bounds(keep);
            }
            return g;
        };
        const corner = C ? rectPoly(C.zone) : null;
        const lane = group(town.wallIn, [town.inner].concat(corner ? [corner] : []));
        const outside = group(null, [town.moat].concat(river ? river.bank : []));
        for (const c of town.cells) if (!c.castle) c.group = group(c.poly);
        const yard = C ? group(rectPoly(C.ward)) : null;
        const stream = river ? S.shadowGroup(ZR, null, level) : null;
        if (stream) {
            stream.area = river.area;
            trims.push({ g: stream, pieces: river.water, minus: [] });
        }
        const everywhere = [water, lane, outside, yard, stream, ...town.cells.map(c => c.group)].filter(Boolean);

        S.shadow = null;
        banks(T, town);
        castAll(S, everywhere, () => {
            for (const w of town.walls) curtain(T, w, rng);
            for (const t of town.towers) {
                tower(T, t, rng);
                footing(T, t, town);
            }
            for (const g of town.gates) gatehouse(T, g, town, rng);
            if (C) {
                gatehouse(T, C.gate, town, rng);
                keep(T, C.keep, rng);
            }
        });
        S.shadow = water;
        for (const g of town.gates) approach(T, g);
        for (const c of town.cells) {
            if (c.castle) continue;
            S.shadow = c.group;
            if (c.kind === 'square') marketSquare(T, c, town, rng);
            else if (c.kind === 'church') churchBlock(T, c, rng);
            else if (c.kind === 'houses') block(T, c, town, rng);
            else if (c.kind === 'orchard') orchardBlock(T, c, rng);
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
        // things out in the country throw their shadows on the river as well as the land
        castAll(S, [outside, stream].filter(Boolean), () => country(T, town, new PG.RNG(hash(seed, 3)), view, roads, river));
        S.shadow = water;
        const life = moatLife(T, town, new PG.RNG(hash(seed, 4)));
        S.shadow = null;

        // A piece of ground keeps the parts of its shadows inside keep, or inside
        // any of pieces, and outside every one of minus
        const hit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
        for (const { g, keep: k0, minus, pieces } of trims) {
            const out = minus.map(M => ({ M, b: bounds(M) })), parts0 = pieces && pieces.map(Q => ({ Q, b: bounds(Q) }));
            g.polys = g.polys.flatMap(P => {
                const b = bounds(P);
                let parts = parts0 ? parts0.filter(q => hit(q.b, b)).map(q => clipConvex(P, q.Q)) : k0 ? [clipConvex(P, k0)] : [P];
                for (const { M, b: mb } of out) if (hit(mb, b)) parts = parts.flatMap(Q => (Q.length >= 3 ? minusConvex(Q, M) : []));
                return parts.filter(Q => Q.length >= 3);
            });
        }
        if (p.water) {
            // ripples keep a millimeter clear of the shadows, so they don't run
            // along the edges of the hatching or through narrow gaps in it
            const m = 1 / T.k, test = g => {
                const shaded = g ? g.polys.map(P => ({ P, b: bounds(P) })) : [];
                const dark = (x, y) => shaded.some(({ P, b }) => inRect(b, x, y) && geo.pointInPolygon(x, y, P));
                return (x, y) => ![[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].some(([dx, dy]) => dark(x + dx, y + dy));
            };
            const seen = inFront(T, town), light = test(water);
            ripples(T, town, (x, y) => seen(x, y) && !life.some(([u, v, r]) => Math.hypot(u - x, v - y) < r) && light(x, y));
            if (river) {
                const lit = test(stream);
                riverRipples(T, river, (x, y) => !river.dry.some(f => f(x, y)) && lit(x, y));
            }
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
        description: 'A walled town in its moat with round or square towers, gatehouses, a castle keep, a market square, and the country round it with a river, stone bridges, a water mill, and an abbey, in isometric ink. Every seed builds a different one.',
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
            { id: 'shape', label: 'Plan', type: 'select', value: 'long', was: { any: 'long' },
                random: ['ragged', 'ragged', 'ragged', 'long', 'long', 'long', 'octagon', 'octagon', 'square'],
                options: [['ragged', 'Uneven corners'], ['octagon', 'Octagon'], ['square', 'Square'], ['long', 'Long']] },
            { id: 'corners', label: 'Cut corners', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 1], show: p => p.shape !== 'square' },
            { id: 'wallHeight', label: 'Wall height (m)', type: 'range', min: 5, max: 10, step: 0.1, value: 7, random: [6, 8] },
            { id: 'towerGap', label: 'Tower spacing (m)', type: 'range', min: 14, max: 50, step: 1, value: 24, random: [18, 32] },
            { id: 'towers', label: 'Towers', type: 'select', value: 'square', was: { any: 'square' },
                random: ['round', 'round', 'round', 'square', 'square', 'mixed'],
                options: [['round', 'Round'], ['square', 'Square'], ['mixed', 'Square between round']] },
            { id: 'towerRoofs', label: 'Tower tops', type: 'select', value: 'mixed', random: ['mixed', 'mixed', 'cones', 'crenels'],
                options: [['mixed', 'Mixed'], ['cones', 'Pointed roofs'], ['crenels', 'Battlements']] },
            { id: 'moat', label: 'Moat width (m)', type: 'range', min: 9, max: 24, step: 0.5, value: 13, random: [11, 16] },
            { id: 'gate2', label: 'Second gate', type: 'checkbox', value: true, random: 0.6, hint: 'A gate in the other wall that faces us as well' },
            { id: 'castle', label: 'Castle', type: 'checkbox', value: true, random: 0.9 },
            { id: 'castleAt', label: 'Castle stands', type: 'select', value: 'right', was: { any: 'right' }, random: true, show: p => p.castle,
                options: [['back', 'At the back'], ['right', 'On the right']] },
            { id: 'keep', label: 'Keep', type: 'select', value: 'turrets', was: { any: 'turrets' }, show: p => p.castle,
                random: ['turrets', 'turrets', 'turrets', 'square', 'square', 'round', 'round'],
                options: [['turrets', 'Corner turrets'], ['square', 'Square keep'], ['round', 'Round donjon']] },
            { id: 'banners', label: 'Flags & banners', type: 'checkbox', value: true },
            { type: 'section', label: 'Town' },
            { id: 'block', label: 'Block size (m)', type: 'range', min: 16, max: 36, step: 0.5, value: 24, random: [20, 28] },
            { id: 'street', label: 'Street width (m)', type: 'range', min: 3.5, max: 7, step: 0.1, value: 4.6, random: [4, 5.5] },
            { id: 'stagger', label: 'Staggered streets', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0, 1] },
            { id: 'floors', label: 'Max stories', type: 'range', min: 2, max: 5, step: 1, value: 4, random: [3, 5] },
            { id: 'timber', label: 'Half-timbered houses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 0.9] },
            { id: 'church', label: 'Church', type: 'checkbox', value: true, random: 0.85 },
            { id: 'market', label: 'Market hall', type: 'checkbox', value: true, random: 0.7, hint: 'Some towns have a belfry in its place' },
            { id: 'gardens', label: 'Gardens', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.8] },
            { type: 'section', label: 'Country' },
            { id: 'fields', label: 'Plowed fields', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'furrows', label: 'Furrow spacing (mm)', type: 'range', min: 0.8, max: 4, step: 0.05, value: 1.8, random: false },
            { id: 'hedges', label: 'Hedgerows', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.8],
                hint: 'Hedges between the fields, most of them in the small closes near the town' },
            { id: 'trees', label: 'Trees & woods', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'river', label: 'River', type: 'select', value: 'front', random: ['front', 'front', 'front', 'back', 'back', 'none'],
                options: [['front', 'In front of the town'], ['back', 'Behind the town'], ['none', 'None']],
                hint: 'In front, the roads out of the gates cross it on stone bridges' },
            { id: 'riverWidth', label: 'River width (m)', type: 'range', min: 8, max: 24, step: 0.5, value: 14, random: [10, 18], show: p => p.river !== 'none' },
            { id: 'watermill', label: 'Water mill', type: 'checkbox', value: true, random: 0.8, show: p => p.river !== 'none' },
            { id: 'bridgeGate', label: 'Gate on the bridge', type: 'checkbox', value: true, random: 0.6, show: p => p.river === 'front',
                hint: 'A gate tower at the far end of the main road\'s bridge' },
            { id: 'mill', label: 'Windmill', type: 'checkbox', value: true, random: 0.7 },
            { id: 'abbey', label: 'Abbey', type: 'checkbox', value: true, random: 0.7,
                hint: 'An abbey in its walled grounds out past the town, with a lane to its gate' },
            { id: 'fair', label: 'Tournament', type: 'checkbox', value: true, random: 0.6 },
            { id: 'cottages', label: 'Cottages', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0, 1],
                hint: 'Thatched cottages along the roads out of the gates' },
            { id: 'moatLife', label: 'Swans & lilies', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1],
                hint: 'On the moat, and swans on the river too' },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Timber framing, arrow loops, stones, portcullis bars, and other small line work' },
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
            const town = plan(p, new PG.RNG(hash(seed, 1)), character(p, new PG.RNG(hash(seed, 5))));
            const view = fitCamera(p, town, W, H), k = view.k;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, view.cx, view.cy);
            const S = new Scene(cam, W, H);
            const cot = 1 / Math.tan(geo.rad(p.sun));
            const sun = [cot * Math.cos(SUN_TURN), -cot * Math.sin(SUN_TURN)];
            if (p.shadows) S.sun = sun;
            const toSun = kit.unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k,
                // the camera at a zoom of 1, which the river, its bridges, and the landmarks are placed
                // by, so zooming crops or widens the same country instead of moving them
                home: makeCamera(p.yaw, p.elev, k / p.zoom, W, H, view.cx, view.cy),
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
                // battlements oversized, 1.6 mm across on paper, so they still read when the town is small on the page
                merlon: Math.max(0.9, 1.6 / k),
            };
            build(T, town, seed);
            dedupe(S);
            return PG.pens.renderScene('castle', S, p);
        },
    });
})();
