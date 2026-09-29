/*
 * Town: an isometric suburb in the style of an illustrated map.
 *
 * The town is a small 3D scene: rows of raised blocks with curbs and
 * sidewalks, lots with houses, apartments, A-frames and the odd windmill,
 * plus cars, fences, trees and yard clutter. The rows don't have to line up
 * (see plan), some streets are boulevards or meet at roundabouts, and a river
 * with bridges can run through. Round a town centre the lots get denser, with
 * terraces and shops, squares and a church in its churchyard. The town centre
 * buildings, boats and bridges are shared with Harbour (lib/isokit.js).
 * Everything is built from boxes, prisms and faceted cylinders, with flat
 * upright cut-outs for trees and people, and viewed through an orthographic
 * camera.
 *
 * Hidden lines are removed exactly (see lib/iso.js), so the plot has just the
 * visible outlines. Sizes are in metres and Scale turns them into millimetres
 * on paper.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { DIRS, hash, makeCamera, frame, hull, card, ring, Scene, renderPens, segments } = PG.iso;
    const {
        FLOOR, wall, rect, pane, door, garageDoor, windows, gableRoof, roofExtras, chimney, roofUnit, flatRoof,
        plinth, steps, porch, downpipe, hipRoof, railing, patioSet, clothesline, Occupancy, nearestDir,
        awning, marketHall, clockTower, terrace, church, cart, bistro, fountain, obelisk, bandstand,
        bridge, bridgeRamp, inKind, withKind,
    } = PG.isokit;

    // line kinds, split over pens. The last four were part of things (or ground,
    // for water) until there were more than four pens.
    const BUILDING = 0, GROUND = 1, PLANT = 2, THING = 3, VEHICLE = 4, FIGURE = 5, WATER = 6, WOOD = 7;
    const kit = PG.isokit;
    const car = withKind(VEHICLE, kit.car), moorRow = withKind(VEHICLE, kit.moorRow), underway = withKind(VEHICLE, kit.underway);
    const person = withKind(FIGURE, kit.person), bike = withKind(FIGURE, kit.bike);
    const fence = withKind(WOOD, kit.fence), bench = withKind(WOOD, kit.bench);

    // ------------------------------------------------------------------
    // Buildings. Each takes the lot frame and a footprint.
    // ------------------------------------------------------------------

    function house(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = BUILDING;
        const [a0, b0, a1, b1] = fp;
        const base = 0.35, top = base + o.floors * FLOOR;
        plinth(T, F, fp, base);
        S.box(F, a0, b0, base, a1, b1, top);
        const pitch = geo.rad(rng.range(27, 38));
        const style = rng.pick(['split', 'split', 'sash', 'cross']);
        const doorS = (a1 - a0) * rng.range(0.3, 0.7);
        let R = null;
        if (o.roof === 'hip') {
            R = hipRoof(T, F, fp, top, pitch);
        } else if (o.roof === 'twin') {
            const am = (a0 + a1) / 2;
            R = gableRoof(T, F, [a0, b0, am, b1], top, false, pitch, rng);
            gableRoof(T, F, [am, b0, a1, b1], top, false, pitch, rng);
        } else {
            R = gableRoof(T, F, fp, top, o.alongU, pitch, rng);
        }
        if (rng.chance(0.55)) {
            let a, b;
            if (o.roof === 'hip') { a = rng.range(a0 + 1, a1 - 1); b = rng.range(b0 + 1, b1 - 1); }
            else if (R.alongU) { a = rng.range(a0 + 0.8, a1 - 0.8); b = R.mid + rng.range(-0.8, 0.8); }
            else { a = R.mid + rng.range(-0.3, 0.3); b = rng.range(b0 + 1, b1 - 1); }
            chimney(T, F, a, b, R.zb, R.ridge + rng.range(0.3, 0.8));
        }
        if (o.roof !== 'hip' && o.roof !== 'twin') roofExtras(T, F, R, rng, o.floors === 1 || rng.chance(0.4));
        const doors = o.roof === 'twin' ? [(a1 - a0) * 0.25, (a1 - a0) * 0.75] : [doorS];
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            for (const d of doors) door(T, front.at, d, base);
            if (o.porch && o.roof !== 'twin') {
                porch(T, F, a0 + doorS - 1.6, a0 + doorS + 1.6, b0, 1.8, base + 2.5);
            } else {
                for (const d of doors) steps(T, F, a0 + d, b0, 1.3, 2);
            }
        }
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), { base, floors: o.floors, style, doors: side === 0 ? doors : side === 2 && o.backDoor ? [(a1 - a0) - doorS] : [] });
        }
        const back = wall(F, 2, fp);
        if (o.backDoor && T.sees(back.n)) door(T, back.at, (a1 - a0) - doorS, base);
    }

    function aframe(T, F, fp, rng) {
        const S = T.S, P = F.P;
        S.kind = BUILDING;
        const [a0, b0, a1, b1] = fp;
        const deck = 0.45, am = (a0 + a1) / 2, w = a1 - a0;
        const h = w * rng.range(0.95, 1.15);
        S.box(F, a0 - 0.6, b0 - 2.2, 0, a1 + 0.6, b1 + 0.6, deck);
        S.prism([P(a0, b0, deck), P(a1, b0, deck), P(am, b0, deck + h)], F.V(0, b1 - b0, 0));
        for (const [b, n] of [[b0, -1], [b1, 1]]) {
            if (!T.sees(F.V(0, n, 0))) continue;
            const G = (s, c) => P(am - n * s, b, c);
            const hw = w / 2, t = 0.3, L = Math.hypot(hw, h);
            const ih = h - (t * L) / hw, iw = hw - (t * L) / h;
            // the rafters' thickness, then a glass gable at both ends
            S.line([G(-iw, deck), G(0, deck + ih), G(iw, deck)]);
            const tr = deck + ih * 0.36;
            const sw = iw * (1 - 0.36);
            S.line([G(-sw, tr), G(sw, tr)]);
            S.line([G(0, tr), G(0, deck + ih)]);
            if (T.detail) for (const s of [-sw / 2, sw / 2]) S.line([G(s, deck), G(s, tr)]);
            if (n < 0) door(T, G, 0, deck, 1.0, Math.min(2.1, tr - deck - 0.05), true);
            else S.line([G(0, deck), G(0, tr)]);
        }
        if (rng.chance(0.5)) {
            const a = am + rng.sign() * w * 0.18;
            const [x, y, z] = P(a, rng.range(b0 + 1.5, b1 - 1), deck + h * (1 - Math.abs(a - am) / (w / 2)));
            // start well under the slope: A-frame roofs drop ~0.37 m across the pipe's width
            S.frustum(x, y, z - 0.45, z + 1.2, 0.16, 0.16, 8);
        }
        S.kind = THING;
        fence(T, P(a0 - 0.5, b0 - 2.1, deck), P(a1 + 0.5, b0 - 2.1, deck), 0.9, true);
    }

    // Flat-roofed modern house: a two-storey box with a lower wing (garage)
    function modern(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = BUILDING;
        const [a0, b0, a1, b1] = fp;
        const base = 0.3;
        const L = a1 - a0, wing = L > 7.4 ? rng.range(3, Math.min(3.6, L * 0.45)) : 0;
        const left = rng.chance(0.5);
        const main = wing ? (left ? [a0 + wing, b0, a1, b1] : [a0, b0, a1 - wing, b1]) : fp;
        const floors = o.floors;
        const top = base + floors * FLOOR;
        plinth(T, F, fp, base, 0.2);
        S.box(F, main[0], main[1], base, main[2], main[3], top);
        const zr = flatRoof(T, F, main, top, 0.2, 0.3);
        if (rng.chance(0.7)) roofUnit(T, F, geo.lerp(main[0] + 1, main[2] - 1, rng.random()), geo.lerp(main[1] + 1, main[3] - 1, rng.random()), zr, 0.9);
        const style = rng.pick(['wide', 'split', 'sash']);
        const ww = style === 'wide' ? 2.1 : 1.2;
        const doorS = (main[2] - main[0]) * rng.range(0.25, 0.4);
        const mf = wall(F, 0, main);
        const balcony = floors > 1 && rng.chance(0.5) && T.sees(mf.n);
        let skip = [];
        if (balcony) {
            const bs0 = (main[2] - main[0]) * 0.45, bs1 = main[2] - main[0] - 0.4;
            skip = [[bs0, bs1]];
            const zb = base + FLOOR;
            S.box(F, main[0] + bs0, main[1] - 1.2, zb - 0.2, main[0] + bs1, main[1], zb);
            pane(T, mf.at, bs0 + 0.3, zb + 0.05, Math.min(2.2, bs1 - bs0 - 0.6), 2.1, 'split');
            S.kind = THING;
            const P = F.P;
            railing(T, [P(main[0] + bs0, main[1], zb), P(main[0] + bs0, main[1] - 1.2, zb), P(main[0] + bs1, main[1] - 1.2, zb), P(main[0] + bs1, main[1], zb)]);
            S.kind = BUILDING;
        }
        if (T.sees(mf.n)) {
            door(T, mf.at, doorS, base);
            steps(T, F, main[0] + doorS, main[1], 1.4, 1);
            windows(T, mf, { base: base + FLOOR, floors: floors - 1, style, winW: ww, winH: 1.3, skip });
            windows(T, mf, { base, floors: 1, style, winW: ww, winH: 1.3, doors: [doorS] });
        }
        for (const side of [1, 2, 3]) windows(T, wall(F, side, main), { base, floors, style, winW: ww, winH: 1.3 });
        if (wing) {
            const wf = left ? [a0, b0, a0 + wing, b1] : [a1 - wing, b0, a1, b1];
            const wt = base + FLOOR * 1.05;
            S.box(F, wf[0], wf[1], base, wf[2], wf[3], wt);
            flatRoof(T, F, wf, wt, 0.2, 0.25);
            const gw = wall(F, 0, wf);
            if (T.sees(gw.n)) garageDoor(T, gw.at, (wing - 2.6) / 2, base, 2.6, 2.2);
            for (const side of [1, 2, 3]) windows(T, wall(F, side, wf), { base, floors: 1, style: 'sash', winW: 1, winH: 0.6, sill: 1.5, gap: 2 });
        }
    }

    function apartment(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = BUILDING;
        const [a0, b0, a1, b1] = fp;
        const base = 0.35, floors = o.floors, top = base + floors * FLOOR;
        plinth(T, F, fp, base);
        S.box(F, a0, b0, base, a1, b1, top);
        const zr = flatRoof(T, F, fp, top, 0.3, 0.45);
        const units = rng.int(1, 2);
        for (let i = 0; i < units; i++) {
            roofUnit(T, F, geo.lerp(a0 + 1.2, a1 - 1.2, rng.random()), geo.lerp(b0 + 1.2, b1 - 1.2, rng.random()), zr, rng.range(0.9, 1.2));
        }
        const style = rng.pick(['bars', 'bars', 'sash', 'cross']);
        const doorS = (a1 - a0) / 2 + rng.pick([-1, 0, 1]) * (a1 - a0) * 0.2;
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            door(T, front.at, doorS, base + 0.51, 1.1, 2.2, rng.chance(0.5));
            steps(T, F, a0 + doorS, b0, 1.6, 3);
            S.box(F, a0 + doorS - 0.9, b0 - 0.9, base + 3.0, a0 + doorS + 0.9, b0, base + 3.15);
            downpipe(T, front, front.len - 0.25, 0, top);
        }
        // in the town centre the ground floor is shops, with awnings either side of the door
        const shops = o.shops && T.sees(front.n);
        for (let side = 0; side < 4; side++) {
            const sh = shops && side === 0;
            windows(T, wall(F, side, fp), {
                base: sh ? base + FLOOR : base, floors: sh ? floors - 1 : floors, style, winW: 1.1, winH: 1.5, gap: 0.85,
                doors: side === 0 && !sh ? [doorS] : [],
            });
        }
        if (shops) {
            for (const [s0, s1] of [[0.3, doorS - 1.1], [doorS + 1.1, a1 - a0 - 0.3]]) {
                if (s1 - s0 < 1.8) continue;
                pane(T, front.at, s0 + 0.15, base + 0.8, s1 - s0 - 0.3, 1.8, 'wide');
                awning(T, F, a0 + s0, a0 + s1, b0, base + 3.1, 1.2);
            }
        }
        const side = wall(F, 3, fp);
        if (T.sees(side.n) && rng.chance(0.5)) downpipe(T, side, 0.25, 0, top);
    }

    function windmill(T, x, y, z, faceDir, rng) {
        const S = T.S;
        S.kind = BUILDING;
        const r0 = rng.range(2.2, 2.6), r1 = r0 * 0.72, h = rng.range(6.5, 8);
        const n = 24;
        S.frustum(x, y, z, z + h, r0, r1, n);
        S.frustum(x, y, z + h, z + h + 0.3, r1 + 0.35, r1 + 0.35, n);
        // domed cap with a finial, a little inside the rim so the two outlines don't overlap
        const R = r1 + 0.22, zc = z + h + 0.3, hd = R * rng.range(0.9, 1.2), dome = [];
        for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * (Math.PI / 2);
            dome.push([R * Math.cos(a), zc + hd * Math.sin(a)]);
        }
        S.lathe(x, y, dome, n);
        S.line([[x, y, zc + hd], [x, y, zc + hd + 0.7]]);
        const [dx, dy] = DIRS[faceDir];
        const px = -dy, py = dx;
        const onTower = (s, c) => {
            const r = r0 + (r1 - r0) * (c / h);
            return [x + dx * r + px * s, y + dy * r + py * s, z + c];
        };
        rect(T, onTower, -0.55, 0, 1.1, 2.1);
        pane(T, onTower, -0.35, h * 0.55, 0.7, 0.9, 'cross');
        // sails in the plane facing out, hub just off the tower
        const hub = [x + dx * (r1 + 0.7), y + dy * (r1 + 0.7), z + h - 0.3];
        const at = (s, c) => [hub[0] + px * s, hub[1] + py * s, hub[2] + c];
        const hr = 0.38;
        const hubPts = ring(T.segs(hr), (cx, cy) => at(cx * hr, cy * hr));
        S.face(hubPts);
        S.loop(hubPts);
        const phi0 = rng.range(0, Math.PI / 2);
        for (let i = 0; i < 4; i++) {
            const a = phi0 + (i * Math.PI) / 2;
            const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
            const q = (s, t) => at(ux * s + vx * t, uy * s + vy * t);
            const s0 = hr + 0.3, s1 = rng.range(5, 5.8), w = 1.05;
            const sail = [q(s0, 0), q(s1, 0), q(s1, w), q(s0, w)];
            S.face(sail);
            S.loop(sail);
            S.line([q(hr, 0.02), q(s0, 0.02)]);
            if (T.detail) {
                const m = Math.max(3, Math.round((s1 - s0) / 0.75));
                for (let j = 1; j < m; j++) {
                    const s = s0 + ((s1 - s0) * j) / m;
                    S.line([q(s, 0), q(s, w)]);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Trees and plants (upright cut-outs)
    // ------------------------------------------------------------------

    function conifer(T, x, y, z, h, rng) {
        T.S.kind = PLANT;
        PG.isokit.conifer(T, x, y, z, h, rng);
    }

    function roundTree(T, x, y, z, h, rng) {
        const S = T.S, ce = T.cam.ce;
        S.kind = PLANT;
        const R = h * rng.range(0.28, 0.34), cz = h - R / ce;
        const P = card(T, x, y, z, 0.25);
        const lobes = rng.int(6, 9), a0 = rng.range(0, TAU);
        const ang = [];
        for (let l = 0; l <= lobes; l++) ang.push(a0 + ((l + (l && l < lobes ? rng.range(-0.2, 0.2) : 0)) * TAU) / lobes);
        const pts = [];
        const seg = Math.max(3, Math.round(T.segs(R) / lobes));
        for (let l = 0; l < lobes; l++) {
            const bump = R * rng.range(0.07, 0.15);
            for (let i = 0; i < seg; i++) {
                const t = i / seg, a = geo.lerp(ang[l], ang[l + 1], t), rr = R + bump * Math.sin(Math.PI * t);
                pts.push([rr * Math.cos(a), cz + (rr * Math.sin(a)) / ce]);
            }
        }
        S.face(hull(pts).map(([u, w]) => P(u, w)));
        S.loop(pts.map(([u, w]) => P(u, w)));
        // a fold in the lower canopy
        if (T.detail) {
            const f = [];
            const fa = rng.range(3.6, 4.1);
            for (let i = 0; i <= 6; i++) {
                const a = fa + (i / 6) * 1.1;
                f.push(P(R * 0.62 * Math.cos(a), cz + R * 0.18 / ce + (R * 0.62 * Math.sin(a)) / ce));
            }
            S.line(f);
        }
        const tw = Math.max(0.12, R * 0.09);
        const T0 = card(T, x, y, z, 0);
        S.line([T0(-tw, cz), T0(-tw, 0), T0(tw, 0), T0(tw, cz)]);
    }

    function octTree(T, x, y, z, h, rng) {
        const S = T.S;
        S.kind = PLANT;
        const r = rng.range(1.4, 2.1), t = rng.range(0.9, 1.6);
        S.frustum(x, y, z + h - t, z + h, r, r * 0.8, 8, rng.range(0, TAU), false);
        const w = 0.14;
        S.box(frame(x, y, z, 0), -w, -w, 0, w, w, h - t);
    }

    function bush(T, x, y, z, r, rng) {
        const S = T.S, ce = T.cam.ce;
        S.kind = PLANT;
        const P = card(T, x, y, z, 0);
        const pts = [], n = T.segs(r);
        const lumps = rng.int(3, 5);
        for (let i = 0; i <= n; i++) {
            const a = (Math.PI * i) / n;
            const rr = r * (1 + 0.1 * Math.abs(Math.sin(a * lumps)));
            pts.push([rr * Math.cos(a), (rr * Math.sin(a)) / ce]);
        }
        const q = pts.map(([u, w]) => P(u, w));
        S.face(q);
        S.line(q);
    }

    function tree(T, x, y, z, rng, big = 1) {
        const kind = rng.weighted([[7, 'conifer'], [1.5, 'round'], [1, 'oct']]);
        const h = rng.range(4.5, 7.5) * big;
        if (kind === 'conifer') conifer(T, x, y, z, h, rng);
        else if (kind === 'round') roundTree(T, x, y, z, h, rng);
        else octTree(T, x, y, z, h * 0.8, rng);
    }

    // ------------------------------------------------------------------
    // Fences and yard things
    // ------------------------------------------------------------------

    function trampoline(T, F, a, b) {
        const S = T.S, r = 1.6, n = T.segs(r);
        const circ = c => ring(n, (x, y) => F.P(a + r * x, b + r * y, c));
        const mat = circ(0.75);
        S.face(mat);
        S.loop(mat);
        S.loop(circ(1.95));
        for (let i = 0; i < 6; i++) {
            const t = (TAU * (i + 0.5)) / 6, x = a + r * Math.cos(t), y = b + r * Math.sin(t);
            S.line([F.P(x, y, 0.75), F.P(x, y, 1.95)]);
            S.line([F.P(x, y, 0), F.P(x, y, 0.75)]);
        }
    }

    function grill(T, x, y, z) {
        const S = T.S, P = card(T, x, y, z, 0), r = 0.33, rw = r / T.cam.ce, c = 0.85;
        const pts = ring(T.segs(r), (u, w) => P(r * u, c + rw * w * 0.85));
        S.face(pts);
        S.loop(pts);
        S.line([P(-r, c), P(r, c)]);
        S.line([P(-0.07, c + rw * 0.85), P(-0.07, c + rw * 0.85 + 0.1), P(0.07, c + rw * 0.85 + 0.1), P(0.07, c + rw * 0.85)]);
        S.line([P(-0.18, c - rw * 0.6), P(-0.3, 0)]);
        S.line([P(0.18, c - rw * 0.6), P(0.3, 0)]);
    }

    function picnicTable(T, x, y, z, dir, patch = false) {
        const G = frame(x, y, z, dir), S = T.S, l = 0.9;
        if (patch) {
            const kind = S.kind;
            S.kind = GROUND;
            S.loop(ring(T.segs(1.8), (c, s) => G.P(1.8 * c, 1.3 * s, 0)));
            S.kind = kind;
            for (const u of [-l - 0.45, l + 0.45]) S.frustum(...G.P(u, 0.25, 0).slice(0, 2), z, z + 0.45, 0.18, 0.18, 10);
        }
        S.box(G, -l, -0.4, 0.7, l, 0.4, 0.77);
        S.box(G, -l, -0.78, 0.42, l, -0.52, 0.47);
        S.box(G, -l, 0.52, 0.42, l, 0.78, 0.47);
        for (const s of [-l + 0.2, l - 0.2]) {
            S.line([G.P(s, -0.7, 0), G.P(s, 0.3, 0.7)]);
            S.line([G.P(s, 0.7, 0), G.P(s, -0.3, 0.7)]);
        }
    }

    function gardenBed(T, F, a, b, L, D) {
        const S = T.S;
        S.kind = THING;
        S.box(F, a, b, 0, a + L, b + D, 0.3);
        S.kind = PLANT;
        const nx = Math.max(1, Math.floor(L / 0.55)), ny = Math.max(1, Math.floor(D / 0.55));
        const r = 0.18;
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                const [x, y, z] = F.P(a + ((i + 0.5) * L) / nx, b + ((j + 0.5) * D) / ny, 0.3);
                const P = card(T, x, y, z, 0);
                const pts = [];
                const n = Math.max(6, T.segs(r));
                for (let k = 0; k <= n; k++) pts.push(P(r * Math.cos((Math.PI * k) / n), (r * 1.1 * Math.sin((Math.PI * k) / n)) / T.cam.ce));
                S.face(pts);
                S.line(pts);
            }
        }
        S.kind = THING;
    }

    function shed(T, F, fp, rng) {
        const S = T.S;
        S.kind = BUILDING;
        const [a0, b0, a1, b1] = fp;
        S.box(F, a0, b0, 0, a1, b1, 2.1);
        const along = a1 - a0 >= b1 - b0;
        gableRoof(T, F, fp, 2.1, along, geo.rad(rng.range(25, 35)), rng, { attic: false });
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            if (W.len > 1.6 && side !== 2) {
                door(T, W.at, W.len / 2, 0, 0.9, 1.8, rng.chance(0.4));
                break;
            }
        }
        S.kind = THING;
    }

    function doghouse(T, F, a, b) {
        const S = T.S, fp = [a - 0.45, b - 0.55, a + 0.45, b + 0.55], P = F.P;
        S.box(F, fp[0], fp[1], 0, fp[2], fp[3], 0.6);
        // a house roof's overhang would swallow walls this small
        const oh = 0.08, hw = 0.45 + oh, zb = 0.56;
        S.prism([P(a - hw, fp[1] - oh, zb), P(a + hw, fp[1] - oh, zb), P(a, fp[1] - oh, zb + hw * 0.8)], F.V(0, 1.1 + 2 * oh, 0));
        const W = wall(F, 0, fp);
        if (T.sees(W.n)) {
            const pts = [W.at(0.28, 0)];
            for (let i = 0; i <= 6; i++) pts.push(W.at(0.45 - 0.17 * Math.cos((Math.PI * i) / 6), 0.3 + 0.17 * Math.sin((Math.PI * i) / 6)));
            pts.push(W.at(0.62, 0));
            S.line(pts);
        }
    }

    function hives(T, F, a, b) {
        for (const o of [-0.45, 0.45]) {
            const s = a + o;
            T.S.box(F, s - 0.28, b - 0.25, 0.25, s + 0.28, b + 0.25, 0.55);
            T.S.box(F, s - 0.28, b - 0.25, 0.55, s + 0.28, b + 0.25, 0.85);
            T.S.box(F, s - 0.34, b - 0.31, 0.85, s + 0.34, b + 0.31, 0.95);
            for (const [da, db] of [[-0.22, -0.2], [0.22, -0.2], [0.22, 0.2], [-0.22, 0.2]]) T.S.line([F.P(s + da, b + db, 0), F.P(s + da, b + db, 0.25)]);
        }
    }

    function greenhouse(T, F, fp) {
        // glass: every edge shows, nothing hidden behind it
        const S = T.S, P = F.P, [a0, b0, a1, b1] = fp;
        const h = 1.9, rise = 0.9, bm = (b0 + b1) / 2;
        const bot = [P(a0, b0, 0), P(a1, b0, 0), P(a1, b1, 0), P(a0, b1, 0)];
        const top = [P(a0, b0, h), P(a1, b0, h), P(a1, b1, h), P(a0, b1, h)];
        S.loop(bot);
        S.loop(top);
        for (let i = 0; i < 4; i++) S.line([bot[i], top[i]]);
        S.line([P(a0, bm, h + rise), P(a1, bm, h + rise)]);
        for (const a of [a0, a1]) S.line([P(a, b0, h), P(a, bm, h + rise), P(a, b1, h)]);
        const n = Math.max(1, Math.round((a1 - a0) / 0.8));
        if (T.detail) {
            for (let i = 1; i < n; i++) {
                const a = a0 + ((a1 - a0) * i) / n;
                S.line([P(a, b0, 0), P(a, b0, h), P(a, bm, h + rise), P(a, b1, h), P(a, b1, 0)]);
            }
        }
    }

    function swingSet(T, F, a, b) {
        const S = T.S, L = 2.8, h = 2.2;
        S.line([F.P(a, b, h), F.P(a + L, b, h)]);
        for (const s of [a, a + L]) {
            S.line([F.P(s, b - 0.8, 0), F.P(s, b, h), F.P(s, b + 0.8, 0)]);
        }
        for (const s of [a + 0.7, a + 1.8]) {
            S.line([F.P(s, b, h), F.P(s, b, 0.45)]);
            S.line([F.P(s + 0.4, b, h), F.P(s + 0.4, b, 0.45)]);
            S.box(F, s - 0.05, b - 0.12, 0.4, s + 0.45, b + 0.12, 0.45);
        }
    }

    function pool(T, F, fp) {
        const [a0, b0, a1, b1] = fp, P = F.P, S = T.S;
        S.kind = GROUND;
        S.loop([P(a0, b0, 0), P(a1, b0, 0), P(a1, b1, 0), P(a0, b1, 0)]);
        const d = 0.35;
        S.loop([P(a0 + d, b0 + d, 0), P(a1 - d, b0 + d, 0), P(a1 - d, b1 - d, 0), P(a0 + d, b1 - d, 0)]);
        if (T.detail) {
            S.line([P(a1 - 1.2, b0 + d, 0.9), P(a1 - 1.2, b0 + d, 0), P(a1 - 1.2, b0 + d + 0.4, 0)]);
            S.line([P(a1 - 0.7, b0 + d, 0.9), P(a1 - 0.7, b0 + d, 0), P(a1 - 0.7, b0 + d + 0.4, 0)]);
        }
        S.kind = THING;
    }

    function bunting(T, F, a, b, L) {
        const S = T.S, h = 2.6;
        S.line([F.P(a, b, 0), F.P(a, b, h)]);
        S.line([F.P(a + L, b, 0), F.P(a + L, b, h)]);
        const sag = 0.45, n = Math.max(3, Math.round(L / 0.55));
        const pt = s => F.P(a + s, b, h - sag * 4 * (s / L) * (1 - s / L));
        const line = [];
        for (let i = 0; i <= 16; i++) line.push(pt((L * i) / 16));
        S.line(line);
        for (let i = 1; i < n; i++) {
            const s = (L * i) / n;
            // pt() is already in world space, so drop the tip there (F.P would add the lot height again)
            const p0 = pt(s - 0.18), p1 = pt(s + 0.18), tip = pt(s);
            tip[2] -= 0.45;
            S.face([p0, p1, tip]);
            S.loop([p0, p1, tip]);
        }
    }

    function hoop(T, F, a, b) {
        const S = T.S;
        const [x, y, z] = F.P(a, b, 0);
        S.line([[x, y, z], [x, y, z + 3.1]]);
        const bb = [F.P(a - 0.55, b - 0.05, 2.75), F.P(a + 0.55, b - 0.05, 2.75), F.P(a + 0.55, b - 0.05, 3.5), F.P(a - 0.55, b - 0.05, 3.5)];
        S.face(bb);
        S.loop(bb);
        S.loop(ring(T.segs(0.23), (c, s) => F.P(a + 0.23 * c, b - 0.3 + 0.23 * s, 3.0)));
    }

    function mailbox(T, F, a, b) {
        const S = T.S;
        S.line([F.P(a, b, 0), F.P(a, b, 1.0)]);
        S.box(F, a - 0.14, b - 0.25, 1.0, a + 0.14, b + 0.25, 1.28);
    }

    function bins(T, F, a, b, n = 2) {
        for (let i = 0; i < n; i++) {
            const s = a + i * 0.72;
            T.S.box(F, s, b, 0, s + 0.6, b + 0.65, 1.0);
            T.S.box(F, s - 0.04, b - 0.04, 1.0, s + 0.64, b + 0.69, 1.08);
        }
    }

    function lamp(T, x, y, z) {
        const S = T.S, P = card(T, x, y, z, 0), ce = T.cam.ce;
        S.kind = THING;
        const w = 0.08, h = 4.3;
        S.face([P(-w, 0), P(w, 0), P(w, h), P(-w, h)]);
        S.line([P(-w, h), P(-w, 0), P(w, 0), P(w, h)]);
        S.line([P(-0.22, 0), P(-0.22, 0.35), P(0.22, 0.35), P(0.22, 0)]);
        const r = 0.3, pts = ring(T.segs(r), (c, s) => P(r * c, h + r / ce + (r * s) / ce));
        S.face(pts);
        S.loop(pts);
    }

    function hydrant(T, x, y, z) {
        T.S.kind = THING;
        T.S.frustum(x, y, z, z + 0.55, 0.14, 0.14, 8);
        T.S.frustum(x, y, z + 0.55, z + 0.75, 0.17, 0.05, 8);
    }

    function silo(T, x, y, z, faceDir, rng) {
        const S = T.S;
        S.kind = BUILDING;
        const r = rng.range(1, 1.4), h = rng.range(4.5, 6.5), prof = [[r, z], [r, z + h]];
        for (let i = 1; i <= 10; i++) {
            const a = (i / 10) * (Math.PI / 2);
            prof.push([r * Math.cos(a), z + h + r * 0.7 * Math.sin(a)]);
        }
        S.lathe(x, y, prof, 24);
        const [dx, dy] = DIRS[faceDir], px = -dy, py = dx;
        const at = (s, c) => [x + dx * (r + 0.12) + px * s, y + dy * (r + 0.12) + py * s, z + c];
        S.kind = THING;
        for (const s of [-0.22, 0.22]) S.line([at(s, 0.4), at(s, h + 0.2)]);
        for (let c = 0.7; c < h; c += 0.4) S.line([at(-0.22, c), at(0.22, c)]);
    }

    function balloon(T, x, y, z, rng) {
        const S = T.S, ce = T.cam.ce;
        S.kind = THING;
        const R = rng.range(2.6, 3.4), lift = rng.range(7, 11);
        const P = card(T, x, y, z, 0);
        const Rw = R / ce, cz = lift + 1.2 + R * 1.25 / ce + Rw * 0.2;
        // envelope: round top, tapering to the mouth
        const n = T.segs(R);
        const env = [];
        for (let i = 0; i <= n; i++) {
            const a = (Math.PI * i) / n;
            env.push([R * Math.cos(a), cz + Rw * Math.sin(a)]);
        }
        // below the equator the sides carry on round, then taper to the mouth
        const mouth = lift + 1.2, mw = R * 0.22;
        const side = t => mw + (R - mw) * Math.cos((t * Math.PI) / 2);
        for (let i = 1; i <= 8; i++) env.push([-side(i / 8), geo.lerp(cz, mouth, i / 8)]);
        for (let i = 8; i >= 1; i--) env.push([side(i / 8), geo.lerp(cz, mouth, i / 8)]);
        S.face(hull(env).map(([u, w]) => P(u, w)));
        S.loop(env.map(([u, w]) => P(u, w)));
        // gores
        for (const k of [-0.5, 0, 0.5]) {
            const g = [];
            for (let i = 0; i <= 12; i++) {
                const t = i / 12;
                const w = t < 0.5 ? cz + Rw * Math.cos(t * Math.PI) : geo.lerp(cz, mouth, (t - 0.5) * 2);
                const wid = t < 0.5 ? R * Math.sin(t * Math.PI) : side((t - 0.5) * 2);
                g.push(P(k * wid, w));
            }
            S.line(g);
        }
        const F = frame(x, y, z, 0);
        const bs = 0.5, bz = lift - 0.1;
        S.box(F, -bs, -bs, bz - 0.9, bs, bs, bz);
        S.line([P(-mw, mouth), F.P(-bs, 0, bz)]);
        S.line([P(mw, mouth), F.P(bs, 0, bz)]);
        const sx = x + rng.range(2.5, 4), sy = y - rng.range(1, 3);
        S.line([F.P(0, 0, bz - 0.9), [sx, sy, z]]);
        S.loop(ring(8, (c, s) => [sx + 0.15 * c, sy + 0.15 * s, z]));
    }

    // ------------------------------------------------------------------
    // Streets, blocks and lots
    // ------------------------------------------------------------------

    function roundRect(x0, y0, x1, y1, r, n) {
        r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
        const pts = [];
        const corner = (cx, cy, a0) => {
            if (r < 1e-6) { pts.push([cx, cy]); return; }
            for (let i = 0; i <= n; i++) {
                const a = a0 + ((Math.PI / 2) * i) / n;
                pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        };
        corner(x1 - r, y0 + r, -Math.PI / 2);
        corner(x1 - r, y1 - r, 0);
        corner(x0 + r, y1 - r, Math.PI / 2);
        corner(x0 + r, y0 + r, Math.PI);
        return pts;
    }

    // The raised block with its curb, sidewalk, paving joints and whatever
    // stands on the sidewalk. Returns the rectangle inside the sidewalk.
    function curb(T, x0, y0, x1, y1, keys) {
        const { S, p } = T;
        const hc = T.curb, sw = p.sidewalk, rc = T.cornerR;
        S.kind = GROUND;
        const outline = roundRect(x0, y0, x1, y1, rc, 6);
        S.prism(outline.map(([x, y]) => [x, y, 0]), [0, 0, hc], true);
        if (sw > 0.3) {
            const ri = Math.max(0.4, rc - sw);
            S.loop(roundRect(x0 + sw, y0 + sw, x1 - sw, y1 - sw, ri, 5).map(([x, y]) => [x, y, hc]));
            // joints between the paving slabs
            const js = p.joints;
            if (js > 0) {
                const run = (ax, ay, bx, by, nx, ny) => {
                    const L = Math.hypot(bx - ax, by - ay), n = Math.round(L / js);
                    for (let i = 1; i < n; i++) {
                        const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
                        S.line([[x, y, hc], [x + nx * sw, y + ny * sw, hc]]);
                    }
                };
                const c = Math.max(rc, sw);
                run(x0 + c, y0, x1 - c, y0, 0, 1);
                run(x0 + c, y1, x1 - c, y1, 0, -1);
                run(x0, y0 + c, x0, y1 - c, 1, 0);
                run(x1, y0 + c, x1, y1 - c, -1, 0);
            }
        }
        // street furniture on the sidewalk: each side as a start on the curb line,
        // a direction along it and the inward normal
        if (sw > 1) {
            const deco = new PG.RNG(hash(...keys, 7));
            const c = rc + 1;
            const sides = [
                [x0 + c, y0, 1, 0, 0, 1, x1 - x0 - 2 * c], [x1, y0 + c, 0, 1, -1, 0, y1 - y0 - 2 * c],
                [x1 - c, y1, -1, 0, 0, -1, x1 - x0 - 2 * c], [x0, y1 - c, 0, -1, 1, 0, y1 - y0 - 2 * c],
            ];
            S.kind = THING;
            for (const [sx, sy, dx, dy, nx, ny, len] of sides) {
                const at = (s, t) => [sx + dx * s + nx * t, sy + dy * s + ny * t];
                if (deco.chance(0.35 * p.props + 0.15)) lamp(T, ...at(deco.range(0, 2), 0.45), hc);
                if (deco.chance(0.3 * p.props)) hydrant(T, ...at(deco.range(0.3, 0.7) * len, 0.4), hc);
                const n = deco.chance(p.people) ? deco.int(1, 2) : 0;
                for (let k = 0; k < n; k++) person(T, ...at(deco.range(0.05, 0.95) * len, sw * deco.range(0.35, 0.65)), hc, deco);
            }
        }
        return [x0 + sw, y0 + sw, x1 - sw, y1 - sw];
    }

    // A block of lots, or a park, a square or a churchyard (`special`)
    function block(T, x0, y0, x1, y1, keys, special = {}) {
        const { p } = T, hc = T.curb;
        const [ix0, iy0, ix1, iy1] = curb(T, x0, y0, x1, y1, keys);
        const W = ix1 - ix0, D = iy1 - iy0, F = frame(ix0, iy0, hc, 0);
        if (special.plaza && W >= 12 && D >= 12) return plaza(T, F, W, D, keys, special);
        if (special.church && W >= 16 && D >= 20) return churchyard(T, F, W, D, keys);
        const rng = new PG.RNG(hash(...keys, 1));
        if (rng.chance(p.parks * 0.2) || W < 6 || D < 6) {
            parkBlock(T, F, W, D, keys);
            return;
        }
        // Lots on a grid. Outer lots face the nearest street (corner lots pick
        // one), the ones in the middle are shared courtyards.
        const split = (total, n) => {
            const w = Array.from({ length: n }, () => rng.range(0.8, 1.2));
            const s = w.reduce((u, v) => u + v, 0);
            return w.map(v => (v * total) / s);
        };
        const cols = geo.clamp(Math.round(W / rng.range(8.5, 10.5)), 1, 8);
        const cw = split(W, cols);
        const rd = Math.min(12.5, D * rng.range(0.33, 0.4));
        const mid = D - 2 * rd;
        const rh = mid > 5 ? [rd, ...split(mid, Math.max(1, Math.round(mid / 10))), rd] : split(D, D > 14 ? 2 : 1);
        const rows = rh.length;
        let y = iy0;
        for (let j = 0; j < rows; j++) {
            let x = ix0;
            for (let i = 0; i < cols; i++) {
                const lx0 = x, lx1 = x + cw[i], ly0 = y, ly1 = y + rh[j];
                x = lx1;
                const sides = [];
                if (j === 0) sides.push(0);
                if (j === rows - 1) sides.push(2);
                if (i === 0) sides.push(3);
                if (i === cols - 1) sides.push(1);
                const lk = [...keys, j * 16 + i];
                const lr = new PG.RNG(hash(...lk, 2));
                let dir = sides.length ? lr.pick(sides) : -1;
                // a lot running right through the block faces one of the long streets
                if (sides.includes(0) && sides.includes(2)) dir = lr.pick([0, 2]);
                const lot = makeLot(lx0, ly0, lx1, ly1, dir, hc);
                fillLot(T, lot, lk);
            }
            y += rh[j];
        }
    }

    // A whole block of lawn: paths to a round plaza, trees, benches, maybe a pond
    function parkBlock(T, F, W, D, keys) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(...keys, 20));
        const occ = new Occupancy(W, D);
        S.kind = GROUND;
        const cx = W * rng.range(0.4, 0.6), cy = D * rng.range(0.4, 0.6), pr = Math.min(W, D) * rng.range(0.09, 0.12);
        const plaza = ring(T.segs(pr), (c, s) => F.P(cx + pr * c, cy + pr * s, 0));
        S.loop(plaza);
        occ.add(cx - pr, cy - pr, cx + pr, cy + pr);
        const pw = 0.8;
        const sides = rng.shuffle([0, 1, 2, 3]).slice(0, rng.int(2, 3));
        for (const s of sides) {
            const horiz = s === 1 || s === 3;
            const e = Math.sqrt(Math.max(0, pr * pr - pw * pw));
            for (const o of [-pw, pw]) {
                if (s === 0) S.line([F.P(cx + o, cy - e, 0), F.P(cx + o, 0, 0)]);
                if (s === 2) S.line([F.P(cx + o, cy + e, 0), F.P(cx + o, D, 0)]);
                if (s === 3) S.line([F.P(cx - e, cy + o, 0), F.P(0, cy + o, 0)]);
                if (s === 1) S.line([F.P(cx + e, cy + o, 0), F.P(W, cy + o, 0)]);
            }
            if (horiz) occ.add(s === 3 ? 0 : cx, cy - pw - 0.2, s === 3 ? cx : W, cy + pw + 0.2);
            else occ.add(cx - pw - 0.2, s === 0 ? 0 : cy, cx + pw + 0.2, s === 0 ? cy : D);
        }
        S.kind = THING;
        const [bx, by] = F.P(cx, cy + pr * 0.45, 0);
        bench(T, bx, by, F.P(0, 0, 0)[2], 2);
        if (rng.chance(0.5) && Math.min(W, D) > 16) {
            S.kind = GROUND;
            const at = occ.place(rng, 7, 5, 1, 1, W - 1, D - 1);
            if (at) {
                const pts = ring(T.segs(3.5), (c, s) => F.P(at[0] + 3.5 + 3.3 * c, at[1] + 2.5 + 2.2 * s, 0));
                S.loop(pts);
                S.loop(ring(T.segs(3), (c, s) => F.P(at[0] + 3.5 + 2.8 * c, at[1] + 2.5 + 1.75 * s, 0)));
            }
        }
        if (rng.chance(0.25 * p.props + 0.05)) {
            const at = occ.place(rng, 7, 7, 1, 1, W - 1, D - 1);
            if (at) {
                const [x, y, z] = F.P(at[0] + 3.5, at[1] + 3.5, 0);
                balloon(T, x, y, z, rng);
            }
        }
        yardDressing(T, { F, w: W, d: D, z: F.P(0, 0, 0)[2], dir: 0 }, keys, occ, { fp: null, drive: null, kind: 'park' });
    }

    function makeLot(x0, y0, x1, y1, dir, z) {
        const d = dir < 0 ? 0 : dir;
        const o = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]][d];
        const alongX = d === 0 || d === 2;
        return {
            F: frame(o[0], o[1], z, d), dir, z,
            w: alongX ? x1 - x0 : y1 - y0, d: alongX ? y1 - y0 : x1 - x0,
            x0, y0, x1, y1,
        };
    }

    function fillLot(T, lot, keys) {
        const { p } = T;
        const rng = new PG.RNG(hash(...keys, 3));
        // 1 in the middle of the town centre, 0 out in the suburbs
        lot.t = centreness(T, (lot.x0 + lot.x1) / 2, (lot.y0 + lot.y1) / 2);
        if (lot.dir < 0) return yard(T, lot, keys, 'court');
        const big = lot.w >= 7.5 && lot.d >= 8.8, t = lot.t, out = 1 - t;
        const kind = rng.weighted([
            [p.houses * (1 - 0.85 * t), 'house'],
            [p.flats * (1 - 0.3 * t), 'modern'],
            [lot.w >= 6.5 && lot.d >= 10 ? p.aframes * out * out : 0, 'aframe'],
            [big ? p.apartments * (1 + 2.5 * t) : 0, 'apartment'],
            [lot.w >= 8 && lot.d >= 8.5 ? p.terraces * (0.15 + 3 * t) : 0, 'terrace'],
            [lot.w >= 9 && lot.d >= 9 ? p.windmills * out * out : 0, 'windmill'],
            [p.parks * 0.8, 'park'],
            [p.parks * 0.5 * out, 'garden'],
            [0.001, 'park'],
        ]);
        if (kind === 'park' || kind === 'garden') return yard(T, lot, keys, kind);
        if (kind === 'windmill') return windmillLot(T, lot, keys);
        return buildingLot(T, lot, keys, kind);
    }

    function buildingLot(T, lot, keys, kind) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(...keys, 4));
        const { w, d, F } = lot;
        const occ = new Occupancy(w, d);
        let L, D;
        if (kind === 'apartment') { L = rng.range(6, 8.5); D = rng.range(6, 8.5); }
        else if (kind === 'aframe') { L = rng.range(5, 6.4); D = rng.range(6.5, 8.5); }
        else if (kind === 'modern') { L = rng.range(6, 9.5); D = rng.range(5.5, 7.5); }
        else if (kind === 'terrace') { L = w - 1.2; D = rng.range(7, 9); }
        else { L = rng.range(5.5, 8.5); D = rng.range(5, 7.5); }
        L = Math.min(L, w - 1.2);
        D = Math.min(D, d - (kind === 'aframe' ? 4 : 2.6));
        if (L < 4 || D < 4) return yard(T, lot, keys, 'park');
        const row = kind === 'apartment' || kind === 'terrace';
        // squeeze the house a little to fit a driveway beside it
        if (!row && w - L < 3.9 && w - 3.9 >= 4.8 && rng.chance(0.8)) L = w - 3.9;
        const room = w - L;
        const hasDrive = !row && room >= 3.9;
        const driveLeft = rng.chance(0.5);
        const setback = geo.clamp(rng.range(kind === 'aframe' ? 2.8 : 1.4, 3.6), kind === 'aframe' ? 2.6 : 1.2, Math.max(1.2, d - D - 1.2));
        let a0;
        if (hasDrive) a0 = driveLeft ? 3.6 + rng.range(0, room - 3.9) : 0.3 + rng.range(0, room - 3.9);
        else a0 = rng.range(0.6, Math.max(0.6, room - 0.6));
        const fp = [a0, setback, a0 + L, setback + D];
        occ.add(fp[0] - 0.4, fp[1] - (kind === 'aframe' ? 2.4 : 0.6), fp[2] + 0.4, fp[3] + 0.4);
        // keep the way to the front door clear
        occ.add(fp[0] + L * 0.25, 0, fp[2] - L * 0.25, fp[1]);
        const maxF = Math.max(1, p.floors);
        if (kind === 'apartment') {
            apartment(T, F, fp, rng, { floors: geo.clamp(rng.int(3, Math.max(5, maxF)), Math.min(3, maxF), maxF), shops: lot.t > 0.35 && rng.chance(0.7) });
        } else if (kind === 'terrace') {
            S.kind = BUILDING;
            terrace(T, F, fp, rng, { floors: maxF, shops: lot.t > 0.3 ? 0.6 : 0 });
        } else if (kind === 'aframe') {
            aframe(T, F, fp, rng);
        } else if (kind === 'modern') {
            modern(T, F, fp, rng, { floors: Math.min(maxF, rng.chance(0.75) ? 2 : 1) });
        } else {
            const roof = rng.weighted([[5, 'gable'], [3, 'hip'], [L > 7.6 && D > 5.5 ? 2 : 0, 'twin']]);
            const floors = Math.min(maxF, roof === 'twin' ? 2 : rng.chance(roof === 'hip' ? 0.35 : 0.6) ? 2 : 1);
            house(T, F, fp, rng, {
                roof, floors, alongU: rng.chance(0.6),
                porch: rng.chance(0.25) && setback > 2.6, backDoor: rng.chance(0.5),
            });
        }
        const cars = new PG.RNG(hash(...keys, 5));
        S.kind = GROUND;
        if (hasDrive) {
            const da0 = driveLeft ? 0.3 : w - 3.3, da1 = da0 + 3;
            const db1 = Math.min(d - 0.4, Math.max(5.6, setback + D * rng.range(0.45, 1)));
            S.loop([F.P(da0, 0, 0), F.P(da1, 0, 0), F.P(da1, db1, 0), F.P(da0, db1, 0)]);
            occ.add(da0, 0, da1, db1);
            if (cars.chance(p.cars)) {
                const [x, y] = F.P((da0 + da1) / 2, 0.4 + 2.6, 0);
                const heading = cars.chance(0.5) ? 1 : 3;
                S.kind = THING;
                car(T, x, y, lot.z, (lot.dir + heading) & 3, cars);
            }
            if (rng.chance(p.props * 0.35) && db1 > setback + 2) {
                S.kind = THING;
                hoop(T, F, driveLeft ? da0 + 0.2 : da1 - 0.2, db1 - 0.3);
            }
        } else if (kind === 'apartment' && cars.chance(p.cars * 0.6)) {
            // parked beside the building if there's room
            const a = w - (a0 + L) >= 2.6 ? a0 + L + 1.3 : a0 >= 2.6 ? a0 - 1.3 : null;
            if (a !== null && d - setback >= 5.2) {
                const [x, y] = F.P(a, setback + 2.5, 0);
                S.kind = THING;
                car(T, x, y, lot.z, (lot.dir + 1) & 3, cars);
                occ.add(a - 1.1, setback, a + 1.1, setback + 5);
            }
        }
        yardDressing(T, lot, keys, occ, { fp, drive: hasDrive ? (driveLeft ? [0.3, 3.3] : [w - 3.3, w - 0.3]) : null, kind });
    }

    function windmillLot(T, lot, keys) {
        const rng = new PG.RNG(hash(...keys, 4));
        const { w, d, F } = lot;
        const occ = new Occupancy(w, d);
        const a = w * rng.range(0.4, 0.6), b = Math.min(d - 4, rng.range(4.5, 6.5));
        const [x, y] = F.P(a, b, 0);
        // turn the sails to whichever side of the tower faces the camera most
        const face = [0, 1, 2, 3].map(i => [i, DIRS[i][0] * T.cam.fx + DIRS[i][1] * T.cam.fy]).sort((u, v) => u[1] - v[1]);
        windmill(T, x, y, lot.z, rng.chance(0.7) ? face[0][0] : face[1][0], rng);
        occ.add(a - 3.4, b - 3.4, a + 3.4, b + 3.4);
        if (rng.chance(0.4)) {
            const at = occ.place(rng, 3, 3, 0.4, 0.4, w - 0.4, d - 0.4);
            if (at) {
                const [sx, sy] = F.P(at[0] + 1.5, at[1] + 1.5, 0);
                silo(T, sx, sy, lot.z, face[0][0], rng);
            }
        }
        if (rng.chance(0.6)) {
            const fp = [Math.min(w - 3.2, a + 3.8), b - 1, Math.min(w - 0.6, a + 6.4), b + 1.4];
            if (fp[2] - fp[0] > 1.8) { shed(T, F, fp, rng); occ.add(fp[0], fp[1], fp[2], fp[3]); }
        }
        yardDressing(T, lot, keys, occ, { fp: null, drive: null, kind: 'windmill' });
    }

    // Parks, vegetable gardens and the shared courtyards in the middle of blocks
    function yard(T, lot, keys, kind) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(...keys, 4));
        const { w, d, F } = lot;
        const occ = new Occupancy(w, d);
        if (kind === 'garden') {
            const n = rng.int(2, 4);
            for (let i = 0; i < n; i++) {
                const L = rng.range(2.2, 3.4), D = rng.range(1, 1.4);
                const at = occ.place(rng, L, D, 0.8, 0.8, w - 0.8, d - 0.8);
                if (at) gardenBed(T, F, at[0], at[1], L, D);
            }
            if (rng.chance(0.6)) {
                const at = occ.place(rng, 3, 2.2, 0.8, 0.8, w - 0.8, d - 0.8);
                if (at) greenhouse(T, F, [at[0], at[1], at[0] + 3, at[1] + 2.2]);
            }
        } else if (kind === 'park') {
            S.kind = GROUND;
            const pr = Math.min(w, d) * 0.22;
            if (pr > 1.6) {
                const a = w / 2 + rng.range(-1, 1), b = d / 2 + rng.range(-1, 1);
                S.loop(ring(T.segs(pr), (c, s) => F.P(a + pr * c, b + pr * s, 0)));
                S.line([F.P(a - 0.7, b - pr * Math.cos(Math.asin(0.7 / pr)), 0), F.P(a - 0.7, 0, 0)]);
                S.line([F.P(a + 0.7, b - pr * Math.cos(Math.asin(0.7 / pr)), 0), F.P(a + 0.7, 0, 0)]);
                occ.add(a - pr, b - pr, a + pr, b + pr);
                occ.add(a - 0.8, 0, a + 0.8, b);
                S.kind = THING;
                const [x, y] = F.P(a, b + pr * 0.4, 0);
                bench(T, x, y, lot.z, (lot.dir + 2) & 3);
            }
            const r2 = new PG.RNG(hash(...keys, 9));
            if (r2.chance(0.12 * p.props) && w > 9 && d > 9) {
                const [x, y] = F.P(w * r2.range(0.25, 0.75), d * r2.range(0.3, 0.7), 0);
                balloon(T, x, y, lot.z, r2);
            }
        }
        yardDressing(T, lot, keys, occ, { fp: null, drive: null, kind });
    }

    // Fences, trees, yard props and people around whatever is on the lot
    function yardDressing(T, lot, keys, occ, o) {
        const { S, p } = T;
        const { w, d, F } = lot;
        const fr = new PG.RNG(hash(...keys, 6));
        // picket fence along the front, with gaps for the drive and the path
        S.kind = THING;
        if (o.kind !== 'court' && fr.chance(p.fences * (1 - 0.7 * (lot.t || 0)))) {
            const cuts = [];
            if (o.drive) cuts.push(o.drive);
            if (o.fp) {
                const mid = (o.fp[0] + o.fp[2]) / 2 + fr.range(-1, 1);
                cuts.push([mid - 0.6, mid + 0.6]);
            } else if (o.kind === 'park') cuts.push([w / 2 - 1.2, w / 2 + 1.2]);
            cuts.sort((u, v) => u[0] - v[0]);
            let s = 0.25;
            for (const [c0, c1] of cuts.concat([[w - 0.25, w]])) {
                if (c0 - s > 0.6) fence(T, F.P(s, 0.35, 0), F.P(c0, 0.35, 0), fr.range(0.8, 1.0));
                s = Math.max(s, c1);
            }
            occ.add(0, 0, w, 0.6);
        }
        if (o.kind !== 'park' && fr.chance(p.fences * 0.6)) {
            const h = fr.range(0.9, 1.3);
            const b0 = o.fp ? Math.min(d - 1, o.fp[3] - 1) : d * 0.4;
            if (fr.chance(0.5)) fence(T, F.P(0.2, b0, 0), F.P(0.2, d - 0.2, 0), h);
            if (fr.chance(0.5)) fence(T, F.P(w - 0.2, b0, 0), F.P(w - 0.2, d - 0.2, 0), h);
            if (fr.chance(0.6)) fence(T, F.P(0.2, d - 0.2, 0), F.P(w - 0.2, d - 0.2, 0), h);
        }
        const pr = new PG.RNG(hash(...keys, 8));
        if (o.fp && pr.chance(0.6 * p.props + 0.1)) {
            const a = o.drive ? (o.drive[0] < w / 2 ? o.drive[1] + 0.5 : o.drive[0] - 0.5) : 1;
            if (occ.free(a - 0.3, 0.4, a + 0.3, 1, 0)) mailbox(T, F, a, 0.8);
        }
        if (o.fp && pr.chance(0.35 * p.props)) {
            const b = Math.max(0.8, o.fp[1] + 0.3);
            const a = o.drive ? (o.drive[0] < w / 2 ? o.drive[1] + 0.3 : o.drive[0] - 1.8) : o.fp[2] + 0.5;
            if (occ.free(a, b, a + 1.5, b + 0.7, 0.05)) { bins(T, F, a, b); occ.add(a, b, a + 1.5, b + 0.7); }
        }
        // trees: they're drawn tall, so a small clear spot is enough
        const tr = new PG.RNG(hash(...keys, 10));
        const area = w * d;
        const nTrees = Math.round((area / (o.kind === 'park' ? 30 : 40)) * p.trees * tr.range(0.6, 1.4) + (o.kind === 'park' ? p.trees : 0));
        for (let i = 0; i < nTrees; i++) {
            const at = occ.place(tr, 1.3, 1.3, 0.2, 0.2, w - 0.2, d - 0.2, 12);
            if (!at) continue;
            const [x, y] = F.P(at[0] + 0.65, at[1] + 0.65, 0);
            if (tr.chance(0.15)) bush(T, x, y, lot.z, tr.range(0.6, 1), tr);
            else tree(T, x, y, lot.z, tr, o.kind === 'park' ? 1.15 : 1);
        }
        // shrubs along the front of the house
        if (o.fp && o.fp[1] > 2.2 && tr.chance(p.trees * 0.6)) {
            const n = tr.int(1, 3);
            for (let i = 0; i < n; i++) {
                const a = tr.range(o.fp[0] + 0.5, o.fp[2] - 0.5), b = o.fp[1] - 1.1;
                if (!occ.free(a - 0.5, b - 0.5, a + 0.5, b + 0.5, 0)) continue;
                occ.add(a - 0.5, b - 0.5, a + 0.5, b + 0.5);
                const [x, y] = F.P(a, b, 0);
                bush(T, x, y, lot.z, tr.range(0.45, 0.65), tr);
            }
        }
        const nProps = Math.round((area / 70) * p.props * pr.range(0.5, 1.5));
        const back = o.fp ? o.fp[3] + 0.6 : 0.8;
        for (let i = 0; i < nProps; i++) {
            const park = o.kind === 'park', home = park ? 0 : 1;
            const kind = pr.weighted([
                [3 * home, 'trampoline'], [park ? 2 : 3, 'patio'], [park ? 3 : 2, 'picnic'], [park ? 0.5 : 2, 'grill'],
                [1.5 * home, 'bed'], [1.2 * home, 'shed'], [1 * home, 'dog'], [1 * home, 'hives'],
                [1 * home, 'clothes'], [1, 'swings'], [0.8 * home, 'pool'],
                [0.6, 'bunting'], [park ? 3 : 0.5, 'bench'],
            ]);
            const size = {
                trampoline: [3.6, 3.6], patio: [3, 3], picnic: [3.7, 2.7], grill: [0.9, 0.9], bed: [3, 1.6],
                shed: [2.8, 2.4], dog: [1.2, 1.4], hives: [1.8, 0.9], clothes: [3.4, 1], swings: [3.2, 2],
                pool: [4.4, 3], bunting: [4.2, 0.6], bench: [1.8, 0.8],
            }[kind];
            const [sw, sd] = size;
            // behind the house when there is one
            const at = occ.place(pr, sw, sd, 0.4, Math.min(back, d - sd - 0.4), w - 0.4, d - 0.4, 10);
            if (!at) continue;
            const [a, b] = at;
            const ca = a + sw / 2, cb = b + sd / 2;
            const [x, y] = F.P(ca, cb, 0);
            S.kind = THING;
            if (kind === 'trampoline') trampoline(T, F, ca, cb);
            else if (kind === 'patio') patioSet(T, F, ca, cb, pr);
            else if (kind === 'picnic') inKind(S, WOOD, () => picnicTable(T, x, y, lot.z, (lot.dir + (sw > sd ? 0 : 1)) & 3, true));
            else if (kind === 'grill') grill(T, x, y, lot.z);
            else if (kind === 'bed') gardenBed(T, F, a + 0.2, b + 0.2, sw - 0.4, sd - 0.4);
            else if (kind === 'shed') shed(T, F, [a + 0.2, b + 0.2, a + sw - 0.2, b + sd - 0.2], pr);
            else if (kind === 'dog') doghouse(T, F, ca, cb);
            else if (kind === 'hives') hives(T, F, ca, cb);
            else if (kind === 'clothes') clothesline(T, F, a + 0.2, cb, sw - 0.4, pr);
            else if (kind === 'swings') swingSet(T, F, a + 0.2, cb);
            else if (kind === 'pool') pool(T, F, [a + 0.2, b + 0.2, a + sw - 0.2, b + sd - 0.2]);
            else if (kind === 'bunting') bunting(T, F, a + 0.2, cb, sw - 0.4);
            else bench(T, x, y, lot.z, (lot.dir + 2) & 3);
        }
        const pp = new PG.RNG(hash(...keys, 11));
        if (pp.chance(p.people * 0.5)) {
            const at = occ.place(pp, 0.6, 0.6, 0.4, 0.4, w - 0.4, d - 0.4, 6);
            if (at) {
                const [x, y] = F.P(at[0] + 0.3, at[1] + 0.3, 0);
                S.kind = THING;
                person(T, x, y, lot.z, pp);
            }
        }
        if (o.fp && pp.chance(p.people * 0.35)) {
            const at = occ.place(pp, 1.8, 0.6, 0.4, 0.6, w - 0.4, o.fp[1], 6);
            if (at) {
                const [x, y] = F.P(at[0] + 0.9, at[1] + 0.3, 0);
                S.kind = THING;
                bike(T, x, y, lot.z, lot.dir, pp, false);
            }
        }
    }

    // Street between two blocks: lane dashes, crosswalks and parked cars.
    // (x, y) is the start of the centre line, (dx, dy) its direction and st its
    // width. A boulevard gets a planted strip down the middle instead of dashes.
    function street(T, x, y, dx, dy, len, keys, st = T.p.street, boulevard = false) {
        const { S, p } = T;
        const nx = -dy, ny = dx;
        const at = (s, t) => [x + dx * s + nx * t, y + dy * s + ny * t, 0];
        const rng = new PG.RNG(hash(...keys, 12));
        S.kind = GROUND;
        if (boulevard && len > 8) {
            const hw = 1.4, a = 2.5, c = [at(a, -hw), at(len - a, hw)];
            const x0 = Math.min(c[0][0], c[1][0]), x1 = Math.max(c[0][0], c[1][0]), y0 = Math.min(c[0][1], c[1][1]), y1 = Math.max(c[0][1], c[1][1]);
            S.prism(roundRect(x0, y0, x1, y1, hw, 4).map(([px, py]) => [px, py, 0]), [0, 0, T.curb], true);
            const tr = new PG.RNG(hash(...keys, 14)), n = Math.max(1, Math.round((len - 2 * a) / 7));
            for (let i = 0; i < n; i++) {
                const [tx, ty] = at(a + ((len - 2 * a) * (i + 0.5)) / n, 0);
                if (tr.chance(0.25 + p.trees)) tree(T, tx, ty, T.curb, tr, 1.1);
            }
            S.kind = GROUND;
        }
        const cw = 3.2, m = 0.8;
        const ends = [rng.chance(p.crosswalks), rng.chance(p.crosswalks)];
        const zebra = s0 => {
            const n = Math.max(2, Math.floor((st - 1) / 1.1));
            const step = (st - 1) / n;
            for (let i = 0; i < n; i++) {
                const t0 = -st / 2 + 0.5 + i * step + step * 0.15, t1 = t0 + step * 0.55;
                S.loop([at(s0, t0), at(s0 + cw, t0), at(s0 + cw, t1), at(s0, t1)]);
            }
        };
        if (ends[0]) zebra(m);
        if (ends[1]) zebra(len - m - cw);
        if (p.dashes && !boulevard) {
            const s0 = (ends[0] ? m + cw : 0) + 2.2, s1 = len - (ends[1] ? m + cw : 0) - 2.2;
            const dash = 1.8, period = 4.6;
            const n = Math.floor((s1 - s0 + period - dash) / period);
            const pad = (s1 - s0 - (n * period - (period - dash))) / 2;
            for (let i = 0; i < n; i++) {
                const s = s0 + pad + i * period;
                S.line([at(s, 0), at(s + dash, 0)]);
            }
        }
        // parked cars along both curbs, the odd one driving
        const dir = dx > 0.5 ? 0 : dy > 0.5 ? 1 : dx < -0.5 ? 2 : 3;
        S.kind = THING;
        for (const side of [-1, 1]) {
            let s = rng.range(3, 9);
            while (s < len - 6) {
                if (rng.chance(p.cars * 0.35)) {
                    const t = side * (st / 2 - 1.15);
                    const [cx, cy] = at(s + 2.5, t);
                    car(T, cx, cy, 0, side < 0 ? dir : (dir + 2) & 3, rng, true);
                    s += rng.range(6, 9);
                } else s += rng.range(4, 10);
            }
            if (st >= 8.5 && rng.chance(p.cars * 0.25)) {
                const [cx, cy] = at(rng.range(6, Math.max(6.1, len - 6)), side * Math.max(1, st / 2 - 3.1));
                car(T, cx, cy, 0, side < 0 ? dir : (dir + 2) & 3, rng, true);
            }
        }
        const br = new PG.RNG(hash(...keys, 13));
        if (br.chance(p.people * 0.3)) {
            const side = br.sign();
            const [bx, by] = at(br.range(4, Math.max(4.1, len - 4)), side * 0.7);
            bike(T, bx, by, 0, side < 0 ? dir : (dir + 2) & 3, br, true);
        }
    }

    // ------------------------------------------------------------------
    // Squares, the churchyard and roundabouts
    // ------------------------------------------------------------------

    // How far (x, y) is into the town centre: 1 in the middle, 0 outside it
    function centreness(T, x, y) {
        if (!T.centre || !T.p.downtown) return 0;
        return T.p.downtown * geo.smoothstep(1, 0.2, Math.hypot(x - T.centre[0], y - T.centre[1]) / T.centreR);
    }

    // A block paved over for a square: a fountain, bandstand, obelisk, the
    // clock tower or a market hall in the middle, trees round the edge, benches,
    // market carts, café tables and people about
    function plaza(T, F, W, D, keys, o) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(...keys, 21));
        const occ = new Occupancy(W, D), z = F.P(0, 0, 0)[2], ca = W / 2, cb = D / 2;
        const at = (a, b) => F.P(a, b, 0);
        S.kind = GROUND;
        S.loop([at(1, 1), at(W - 1, 1), at(W - 1, D - 1), at(1, D - 1)]);
        const kind = o.tower ? 'tower' : rng.weighted([[3, 'fountain'], [2, 'bandstand'], [1.5, 'obelisk'], [Math.min(W, D) >= 22 ? 1.5 : 0, 'market']]);
        const [cx, cy] = at(ca, cb);
        S.kind = BUILDING;
        let rad = 0;
        if (kind === 'market') {
            const L = Math.min(W - 8, 16), H = Math.min(D - 9, 8);
            marketHall(T, F, [ca - L / 2, cb - H / 2, ca + L / 2, cb + H / 2], rng);
            occ.add(ca - L / 2 - 1, cb - H / 2 - 1, ca + L / 2 + 1, cb + H / 2 + 1);
        } else {
            if (kind === 'tower') { clockTower(T, F, ca, cb, rng); rad = 2.3; }
            else if (kind === 'fountain') rad = fountain(T, cx, cy, z, rng);
            else if (kind === 'bandstand') rad = bandstand(T, cx, cy, z, rng);
            else rad = obelisk(T, cx, cy, z, rng);
            occ.add(ca - rad - 0.4, cb - rad - 0.4, ca + rad + 0.4, cb + rad + 0.4);
            // a ring of paving round it with paths out to each side
            const rr = rad + 1.6;
            if (rr < Math.min(W, D) / 2 - 2.5) {
                S.kind = GROUND;
                S.loop(ring(T.segs(rr), (c, s) => at(ca + rr * c, cb + rr * s)));
                const e = Math.sqrt(rr * rr - 0.8 * 0.8);
                for (const o2 of [-0.8, 0.8]) {
                    S.line([at(ca + o2, cb - e), at(ca + o2, 1)]);
                    S.line([at(ca + o2, cb + e), at(ca + o2, D - 1)]);
                    S.line([at(ca - e, cb + o2), at(1, cb + o2)]);
                    S.line([at(ca + e, cb + o2), at(W - 1, cb + o2)]);
                }
                occ.add(ca - 1, 0, ca + 1, D);
                occ.add(0, cb - 1, W, cb + 1);
                // benches round the ring, facing in
                S.kind = THING;
                for (let i = 0; i < 4; i++) {
                    if (!rng.chance(0.3 + p.props * 0.6)) continue;
                    const a = Math.PI / 4 + (i * Math.PI) / 2, bx = ca + (rr + 0.6) * Math.cos(a), by = cb + (rr + 0.6) * Math.sin(a);
                    if (!occ.free(bx - 0.9, by - 0.9, bx + 0.9, by + 0.9, 0)) continue;
                    const [x, y] = at(bx, by);
                    bench(T, x, y, z, nearestDir(Math.sin(a), -Math.cos(a)));
                    occ.add(bx - 0.9, by - 0.9, bx + 0.9, by + 0.9);
                }
            }
        }
        // trees down each side, leaving the middle of the side open for the path
        const edge = [[0, 1, 0, 2.2], [0, 1, 0, D - 2.2], [1, 0, 2.2, 0], [1, 0, W - 2.2, 0]];
        for (const [ua, ub, a0, b0] of edge) {
            const L = ua ? D : W, n = Math.max(1, Math.round((L - 4) / 6.5));
            for (let i = 0; i < n; i++) {
                const s = 2 + ((L - 4) * (i + 0.5)) / n;
                if (Math.abs(s - L / 2) < 2.2) continue;
                const a = ua ? a0 : s, b = ua ? s : b0;
                if (!rng.chance(0.35 + p.trees * 0.6) || !occ.free(a - 0.6, b - 0.6, a + 0.6, b + 0.6, 0)) continue;
                const [x, y] = at(a, b);
                tree(T, x, y, z, rng);
                occ.add(a - 0.6, b - 0.6, a + 0.6, b + 0.6);
            }
        }
        S.kind = THING;
        if (rng.chance(0.3 + p.props * 0.6)) {
            for (let i = rng.int(1, 3); i > 0; i--) {
                const s = occ.place(rng, 2.1, 1.5, 1, 1, W - 1, D - 1);
                if (s) cart(T, ...at(s[0] + 1.05, s[1] + 0.75).slice(0, 2), z, rng);
            }
        }
        if (rng.chance(p.props)) {
            for (let i = rng.int(1, 3); i > 0; i--) {
                const s = occ.place(rng, 2.2, 2.2, 1, 1, W - 1, D - 1);
                if (s) bistro(T, ...at(s[0] + 1.1, s[1] + 1.1).slice(0, 2), z, rng, rng.chance(0.6));
            }
        }
        for (let i = Math.round(((W * D) / 60) * p.people * rng.range(0.6, 1.4)); i > 0; i--) {
            const s = occ.place(rng, 0.6, 0.6, 1, 1, W - 1, D - 1);
            if (s) person(T, ...at(s[0] + 0.3, s[1] + 0.3).slice(0, 2), z, rng);
        }
    }

    function headstone(T, F, a, b, rng) {
        const h = rng.range(0.6, 1);
        if (rng.chance(0.2)) {
            T.S.box(F, a - 0.06, b - 0.06, 0, a + 0.06, b + 0.06, h + 0.35);
            T.S.box(F, a - 0.28, b - 0.06, h - 0.05, a + 0.28, b + 0.06, h + 0.08);
        } else {
            const w = rng.range(0.45, 0.65);
            T.S.box(F, a - w / 2, b - 0.08, 0, a + w / 2, b + 0.08, h);
        }
    }

    // Church in its churchyard: the church facing the street at the front, a
    // path to the door, rows of headstones, a few trees and a low wall round it
    function churchyard(T, F, W, D, keys) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(...keys, 22));
        const occ = new Occupancy(W, D), z = F.P(0, 0, 0)[2];
        const Lc = Math.min(W - 5, rng.range(9, 11.5)), Dc = Math.min(D - 7, rng.range(14, 19));
        const a0 = (W - Lc) / 2 + rng.range(-1, 1) * Math.max(0, (W - Lc) / 2 - 3), fp = [a0, 3, a0 + Lc, 3 + Dc];
        const am = (fp[0] + fp[2]) / 2;
        S.kind = BUILDING;
        church(T, F, fp, rng);
        occ.add(fp[0] - 0.8, 0, fp[2] + 0.8, fp[3] + 0.8);
        S.kind = GROUND;
        for (const s of [-0.8, 0.8]) S.line([F.P(am + s, 0.4, 0), F.P(am + s, fp[1] - 0.1, 0)]);
        // low wall round the yard, open where the path comes in
        S.kind = BUILDING;
        const h = 0.8, t = 0.3, e = 0.1;
        S.box(F, e, e, 0, am - 1.2, e + t, h);
        S.box(F, am + 1.2, e, 0, W - e, e + t, h);
        S.box(F, e, D - e - t, 0, W - e, D - e, h);
        S.box(F, e, e + t, 0, e + t, D - e - t, h);
        S.box(F, W - e - t, e + t, 0, W - e, D - e - t, h);
        occ.add(0, 0, W, 0.6);
        // headstones in a few rows beside and behind the church, grass between
        S.kind = THING;
        for (let b = 2.2; b < D - 1.4; b += 2.4) {
            for (let a = 1.6; a < W - 1.6; a += 1.9) {
                if (!rng.chance(0.4)) continue;
                const aa = a + rng.range(-0.25, 0.25);
                if (!occ.free(aa - 0.35, b - 0.25, aa + 0.35, b + 0.25, 0)) continue;
                headstone(T, F, aa, b, rng);
            }
        }
        for (let i = rng.int(2, 5); i > 0; i--) {
            const s = occ.place(rng, 1.4, 1.4, 0.6, 0.6, W - 0.6, D - 0.6);
            if (s) tree(T, ...F.P(s[0] + 0.7, s[1] + 0.7, 0).slice(0, 2), z, rng);
        }
        if (rng.chance(p.people)) {
            S.kind = THING;
            person(T, ...F.P(am + rng.range(-3, 3), rng.range(0.8, 1.6), 0).slice(0, 2), z, rng);
        }
    }

    // Island in the middle of a crossing, with a tree or a statue on it
    function roundabout(T, x, y, r, rng) {
        const S = T.S, hc = T.curb;
        S.kind = GROUND;
        S.frustum(x, y, 0, hc, r, r, T.segs(r));
        if (r > 1.2) S.loop(ring(T.segs(r - 0.45), (c, s) => [x + (r - 0.45) * c, y + (r - 0.45) * s, hc]));
        if (rng.chance(0.5)) {
            tree(T, x, y, hc, rng, 1.2);
            return;
        }
        // somebody on a plinth
        S.kind = BUILDING;
        const F = frame(x, y, hc, 0);
        S.box(F, -0.6, -0.6, 0, 0.6, 0.6, 0.25);
        S.box(F, -0.45, -0.45, 0.25, 0.45, 0.45, 1.6);
        S.box(F, -0.55, -0.55, 1.6, 0.55, 0.55, 1.75);
        // a statue, so it stays with the buildings
        kit.person(T, x, y, hc + 1.75, rng);
    }

    // ------------------------------------------------------------------
    // The river
    // ------------------------------------------------------------------

    const ZW = -1.5;  // river level, below the streets (m)
    const PROM = 3.5; // walk along each side of the water (m)

    // River through the town, along x or y. R has the strip [lo, hi] across it
    // and the water between w0 and w1, `cross` the stretches along it where
    // streets go over on bridges, and s0..s1 how far it runs. Returns the
    // patches of water the wakes cover.
    function river(T, R, cross, s0, s1, seed) {
        const { S, p, cam } = T;
        const rng = new PG.RNG(hash(seed, 30));
        const X = R.alongX, Wp = (s, t, z) => (X ? [s, t, z] : [t, s, z]);
        const { w0, w1, lo, hi } = R, hc = T.curb, nt = X ? [0, 1] : [1, 0];
        S.kind = GROUND;
        // the far wall is the one we see, the near one only hides the water behind it
        S.face([Wp(s0, w1, ZW), Wp(s1, w1, ZW), Wp(s1, w1, 0), Wp(s0, w1, 0)], false);
        S.face([Wp(s0, w0, ZW), Wp(s1, w0, ZW), Wp(s1, w0, 0), Wp(s0, w0, 0)], false);
        S.line([Wp(s0, w1, ZW), Wp(s1, w1, ZW)]);
        S.line([Wp(s0, w1, -0.3), Wp(s1, w1, -0.3)]);
        if (T.detail) for (let s = Math.ceil(s0 / 4.5) * 4.5; s < s1; s += 4.5) S.line([Wp(s, w1, ZW + 0.05), Wp(s, w1, -0.3)]);
        // walks either side between the crossings, and the bare wall top where a street meets the water
        const walks = [];
        let s = s0;
        for (const [c0, c1] of cross) {
            if (c0 - s > 3) walks.push([s, c0]);
            for (const t of [w0, w1]) S.line([Wp(c0, t, 0), Wp(c1, t, 0)]);
            s = c1;
        }
        if (s1 - s > 3) walks.push([s, s1]);
        const benchDir = X ? 0 : 3;
        for (const [a, b] of walks) {
            S.kind = GROUND;
            for (const [t0, t1] of [[lo, w0], [w1, hi]]) {
                const c = [Wp(a, t0, 0), Wp(b, t1, 0)];
                const rr = roundRect(Math.min(c[0][0], c[1][0]), Math.min(c[0][1], c[1][1]), Math.max(c[0][0], c[1][0]), Math.max(c[0][1], c[1][1]), 1, 4);
                S.prism(rr.map(([x, y]) => [x, y, 0]), [0, 0, hc], true);
            }
            // railings along the water
            S.kind = THING;
            for (const t of [w0 - 0.2, w1 + 0.2]) {
                const n = Math.max(1, Math.round((b - a - 1.5) / 2));
                S.line([Wp(a + 0.8, t, hc + 1), Wp(b - 0.8, t, hc + 1)]);
                if (T.detail) S.line([Wp(a + 0.8, t, hc + 0.55), Wp(b - 0.8, t, hc + 0.55)]);
                for (let i = 0; i <= n; i++) {
                    const q = a + 0.8 + ((b - a - 1.6) * i) / n;
                    S.line([Wp(q, t, hc), Wp(q, t, hc + 1)]);
                }
            }
            // trees along the far side (on the near side they'd hide the river), lamps along the near
            const n = Math.max(1, Math.round((b - a - 2) / 7));
            for (let i = 0; i < n; i++) {
                const q = a + 1 + ((b - a - 2) * (i + 0.5)) / n;
                if (i % 3 !== 2 && rng.chance(0.3 + p.trees)) tree(T, ...Wp(q, w1 + PROM * 0.6, 0).slice(0, 2), hc, rng);
                else if (rng.chance(0.3 + p.props * 0.5)) {
                    S.kind = THING;
                    bench(T, ...Wp(q, w1 + 1.1, 0).slice(0, 2), hc, benchDir);
                }
                if (i % 2 === 0) lamp(T, ...Wp(q, w0 - 1, 0).slice(0, 2), hc);
            }
            if (rng.chance(p.people)) {
                S.kind = THING;
                person(T, ...Wp(rng.range(a + 1, b - 1), rng.chance(0.5) ? w1 + 1.8 : w0 - 1.8, 0).slice(0, 2), hc, rng);
            }
        }
        // stone bridges where the streets cross
        for (const [c0, c1] of cross) {
            const F = X ? { P: (a, b, c) => [c0 + b, a, c], V: (a, b, c) => [b, a, c] } : { P: (a, b, c) => [a, c0 + b, c], V: (a, b, c) => [a, b, c] };
            S.kind = GROUND;
            bridge(T, F, w0, w1, c1 - c0, 0, ZW, true);
        }
        // boats tied up along both walls between the bridges, and one or two going along
        S.kind = THING;
        const kinds = [[3, 'row'], [2, 'launch'], [1.2, 'sail']];
        const stretches = [];
        s = s0;
        for (const [c0, c1] of cross.concat([[s1, s1]])) {
            if (c0 - s > 6) stretches.push([s + 1.5, c0 - 1.5]);
            s = c1;
        }
        for (const [a, b] of stretches) {
            const [u, v] = rng.chance(0.5) ? [a, b] : [b, a];
            moorRow(T, Wp(u, w1, 0), Wp(v, w1, 0), [-nt[0], -nt[1]], null, rng, kinds, 0, ZW);
            moorRow(T, Wp(u, w0, 0), Wp(v, w0, 0), nt, null, rng, kinds, 0, ZW);
        }
        const wakes = [];
        const n = rng.chance(p.boats) ? rng.int(1, 2) : 0;
        for (let i = 0, tries = 0; i < n && tries < 20; tries++) {
            const [a, b] = rng.pick(stretches.length ? stretches : [[s0, s1]]);
            if (b - a < 24) continue;
            const q = rng.range(a + 10, b - 10), [x, y] = Wp(q, (w0 + w1) / 2 + rng.range(-0.8, 0.8), 0);
            const qp = cam.project(x, y, ZW);
            if (qp[0] < 8 || qp[1] < 8 || qp[0] > S.W - 8 || qp[1] > S.H - 8) continue;
            const ang = (X ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.08, 0.08);
            wakes.push(underway(T, x, y, ang, rng, ZW));
            i++;
        }
        return wakes;
    }

    // Short dashes across the river in rows, in page space like a printed
    // map, left out where they'd touch anything
    function riverMarks(T, R, wakes, seed) {
        const { S, cam } = T;
        const rng = new PG.RNG(hash(seed, 31));
        const rowGap = 5.2, colGap = 15, dash = 4, t = q => (R.alongX ? q[1] : q[0]);
        const wet = q => t(q) > R.w0 + 0.8 && t(q) < R.w1 - 0.8 && !wakes.some(P => geo.pointInPolygon(q[0], q[1], P));
        S.kind = WATER;
        for (let row = 0, sy = rowGap * 0.6; sy < S.H; row++, sy += rowGap) {
            const off = (row % 2 ? colGap / 2 : 0) + rng.range(-2, 2);
            for (let sx = off - colGap; sx < S.W + colGap; sx += colGap) {
                const cx = sx + rng.range(-0.18, 0.18) * colGap, len = dash * rng.range(0.75, 1.2);
                const a = cam.ground(cx - len / 2, sy, ZW), b = cam.ground(cx + len / 2, sy, ZW);
                if (!wet(cam.ground(cx, sy, ZW)) || !wet(a) || !wet(b)) continue;
                S.line([[a[0], a[1], ZW], [b[0], b[1], ZW]], true);
            }
        }
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    // The town is rows of blocks along x. Through streets run along y across
    // every row and each row gets its own cross streets between them, so with
    // `irregular` up the rows stop lining up. The street under a row can be a
    // boulevard, and one of those or one of the through streets can be a river.
    function plan(T, rng, X0, X1, Y0, Y1, mid) {
        const p = T.p, bw = p.blockW, bd = p.blockD, st = p.street, irr = p.irregular, ux = bw + st;
        // through streets, up to three blocks apart, and one past the far edge so the last blocks close off
        const mains = [];
        for (let x = X0 - rng.range(0, ux); ; ) {
            mains.push({ x, w: st });
            if (x > X1 + ux) break;
            x += rng.weighted([[1.2 - irr, 1], [irr * 1.5, 2], [irr * 0.6, 3]]) * ux * (1 + irr * rng.range(-0.12, 0.12));
        }
        let R = null;
        if (rng.chance(p.river)) {
            R = { alongX: rng.chance(0.5), w: rng.range(12, 18) };
            if (!R.alongX) {
                const m = mains.reduce((b, q) => (Math.abs(q.x - mid[0]) < Math.abs(b.x - mid[0]) ? q : b));
                // a street down each bank, then the walks and the water
                m.w = R.w + 2 * PROM + 2 * st;
                m.river = true;
                R.lo = m.x - m.w / 2 + st;
                R.hi = m.x + m.w / 2 - st;
            }
        }
        const riverY = R && R.alongX ? mid[1] + rng.range(-25, 25) : null;
        const rows = [];
        for (let y = Y0 - rng.range(0, bd + st), i = 0; y < Y1 + bd; i++) {
            let gap = { kind: 'street', w: st };
            if (riverY !== null && R.lo === undefined && y + bd > riverY) {
                gap = { kind: 'river', w: R.w + 2 * PROM + 2 * st };
                R.lo = y + st;
                R.hi = y + gap.w - st;
            } else if (i > 0 && rng.chance(p.boulevards * 0.3)) {
                gap = { kind: 'boulevard', w: st * 2 + 3 };
            }
            const d = bd * (1 + irr * rng.range(-0.2, 0.25));
            rows.push({ i, gap, y0: y + gap.w, y1: y + gap.w + d, cuts: [], blocks: [] });
            y += gap.w + d;
        }
        if (R) {
            R.w0 = R.lo + PROM;
            R.w1 = R.hi - PROM;
        }
        for (const row of rows) {
            mains.forEach((m, k) => {
                row.cuts.push({ x: m.x, w: m.w, main: true, river: m.river });
                if (k + 1 === mains.length) return;
                const span = mains[k + 1].x - m.x;
                let n = Math.round(span / ux);
                if (rng.chance(irr * 0.45)) n += rng.pick([-1, 1]);
                n = Math.max(1, Math.min(n, Math.floor(span / 24)));
                for (let q = 1; q < n; q++) {
                    const c = { x: m.x + (span * (q + irr * rng.range(-0.25, 0.25))) / n, w: rng.chance(irr * 0.25) ? Math.max(4, st * 0.6) : st };
                    // keep clear of the through streets either side, the river's especially
                    if (Math.abs(c.x - m.x) > m.w / 2 + c.w / 2 + 12 && Math.abs(mains[k + 1].x - c.x) > mains[k + 1].w / 2 + c.w / 2 + 12) row.cuts.push(c);
                }
            });
            for (let k = 0; k + 1 < row.cuts.length; k++) {
                const x0 = row.cuts[k].x + row.cuts[k].w / 2, x1 = row.cuts[k + 1].x - row.cuts[k + 1].w / 2;
                if (x1 - x0 >= 12) row.blocks.push({ x0, x1, y0: row.y0, y1: row.y1 });
            }
        }
        return { mains, rows, R };
    }

    function buildTown(T, seed) {
        const { S, p, cam } = T;
        const ph = new PG.RNG(hash(seed, 99));
        // the ground visible on the page, plus room for tall things standing below it
        const tall = 16 * cam.ce * cam.k;
        const corners = [[0, 0], [S.W, 0], [S.W, S.H + tall], [0, S.H + tall]].map(([x, y]) => cam.ground(x, y));
        const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
        const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
        const pad = 12;
        const seen = (x0, y0, x1, y1, h) => {
            const q = [];
            for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
                q.push(cam.project(x, y, 0), cam.project(x, y, h));
            }
            let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
            for (const v of q) { a = Math.min(a, v[0]); c = Math.max(c, v[0]); b = Math.min(b, v[1]); e = Math.max(e, v[1]); }
            return c > -pad && e > -pad && a < S.W + pad && b < S.H + pad;
        };
        // the town centre, where it's built up most
        T.centre = cam.ground(S.W * ph.range(0.3, 0.7), S.H * ph.range(0.3, 0.6));
        T.centreR = ph.range(55, 90);
        const { mains, rows, R } = plan(T, ph, X0, X1, Y0, Y1, cam.ground(S.W / 2, S.H / 2));
        // can't happen within the parameter limits, but don't loop forever if it does
        if (rows.reduce((n, r) => n + r.blocks.length, 0) > 20000) return;
        // squares near the centre, then a church a little way off
        const near = b => Math.hypot((b.x0 + b.x1) / 2 - T.centre[0], (b.y0 + b.y1) / 2 - T.centre[1]);
        const cands = [];
        for (const row of rows) for (const b of row.blocks) if (seen(b.x0 + 4, b.y0 + 4, b.x1 - 4, b.y1 - 4, 0)) cands.push({ b, d: near(b) + ph.range(0, 50) });
        cands.sort((u, v) => u.d - v.d);
        const want = ph.chance(p.plazas) ? (ph.chance(p.plazas * 0.6) ? 2 : 1) : 0, picked = [];
        const apart = (b, m) => picked.every(q => Math.hypot((q.x0 + q.x1 - b.x0 - b.x1) / 2, (q.y0 + q.y1 - b.y0 - b.y1) / 2) > m);
        for (const { b } of cands) {
            const w = b.x1 - b.x0, d = b.y1 - b.y0;
            if (picked.length >= want) break;
            if (w < 18 || d < 18 || w > 60 || d > 60 || !apart(b, 55)) continue;
            b.plaza = true;
            picked.push(b);
        }
        if (p.tower && picked.length) picked[0].tower = true;
        if (p.church) {
            for (const { b } of cands.slice().sort((u, v) => Math.abs(u.d - T.centreR * 0.8) - Math.abs(v.d - T.centreR * 0.8))) {
                if (b.plaza || b.x1 - b.x0 < 22 || b.y1 - b.y0 < 28 || !apart(b, 40)) continue;
                b.church = true;
                break;
            }
        }
        // streets up each row, then the streets between rows, broken where the rows' streets meet them
        const st = p.street;
        const streetX = (yc, w, cuts, keys, boulevard) => {
            const iv = cuts.map(c => [c.x - c.w / 2, c.x + c.w / 2]).sort((u, v) => u[0] - v[0]);
            let x = X0 - 30;
            iv.concat([[X1 + 30, X1 + 30]]).forEach(([c0, c1], k) => {
                if (c0 - x > 3 && seen(x, yc - w / 2, c0, yc + w / 2, 3)) street(T, x, yc, 1, 0, c0 - x, [...keys, k], w, boulevard);
                x = Math.max(x, c1);
            });
        };
        rows.forEach((row, r) => {
            const len = row.y1 - row.y0;
            row.cuts.forEach((c, k) => {
                if (!c.river) {
                    if (seen(c.x - c.w / 2, row.y0, c.x + c.w / 2, row.y1, 3)) street(T, c.x, row.y1, 0, -1, len, [seed, r, k, 1], c.w);
                    return;
                }
                for (const [xc, e] of [[R.lo - st / 2, 3], [R.hi + st / 2, 4]]) {
                    if (seen(xc - st / 2, row.y0, xc + st / 2, row.y1, 3)) street(T, xc, row.y1, 0, -1, len, [seed, r, k, e], st);
                }
            });
            const gap = row.gap, yc = row.y0 - gap.w / 2, below = r > 0 ? rows[r - 1].cuts : [];
            if (gap.kind === 'river') {
                streetX(R.lo - st / 2, st, below, [seed, r, 5]);
                streetX(R.hi + st / 2, st, row.cuts, [seed, r, 6]);
                return;
            }
            streetX(yc, gap.w, row.cuts.concat(below), [seed, r, 2], gap.kind === 'boulevard');
            // the odd roundabout where two through streets cross
            if (r > 0 && gap.kind === 'street') {
                const rr = new PG.RNG(hash(seed, r, 15));
                for (const m of mains) {
                    if (m.river || !rr.chance(p.roundabouts * 0.35) || !seen(m.x - 3, yc - 3, m.x + 3, yc + 3, 4)) continue;
                    roundabout(T, m.x, yc, Math.min(m.w, gap.w) * 0.32, rr);
                }
            }
        });
        rows.forEach((row, r) => {
            row.blocks.forEach((b, j) => {
                if (seen(b.x0, b.y0, b.x1, b.y1, 16)) block(T, b.x0, b.y0, b.x1, b.y1, [seed, r, j], b);
            });
        });
        if (R && R.lo !== undefined) {
            const cross = R.alongX
                ? mains.map(m => [m.x - m.w / 2, m.x + m.w / 2])
                : rows.map(row => [row.y0 - row.gap.w, row.y0]);
            const [s0, s1] = R.alongX ? [X0 - 30, X1 + 30] : [Y0 - 30, Y1 + 30];
            const wakes = river(T, R, cross.filter(([c0, c1]) => c1 > s0 && c0 < s1).sort((u, v) => u[0] - v[0]), s0, s1, seed);
            riverMarks(T, R, wakes, seed);
        }
    }

    PG.register({
        id: 'town',
        name: 'Town',
        category: 'Scenes',
        description: 'An isometric suburb of houses, streets, cars and trees, with hidden lines removed.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 1, max: 5, step: 0.05, value: 1.6, random: [1.2, 2.4],
                hint: 'How big a metre is on paper. Small details drop out when they get too small to plot' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 15, max: 75, step: 0.5, value: 52, random: false,
                hint: '45 is a classic symmetric isometric view' },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 38.5, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Streets' },
            { id: 'blockW', label: 'Block length (m)', type: 'range', min: 16, max: 90, step: 1, value: 36, random: [26, 48] },
            { id: 'blockD', label: 'Block depth (m)', type: 'range', min: 16, max: 90, step: 1, value: 40, random: [30, 50] },
            { id: 'street', label: 'Street width (m)', type: 'range', min: 5, max: 20, step: 0.5, value: 7, random: [6.5, 10] },
            { id: 'sidewalk', label: 'Sidewalk (m)', type: 'range', min: 0, max: 4, step: 0.1, value: 1.5, random: false },
            { id: 'joints', label: 'Paving slabs (m)', type: 'range', min: 0, max: 6, step: 0.1, value: 2.2, random: false,
                hint: 'Spacing of the joints across the sidewalk, 0 for none' },
            { id: 'crosswalks', label: 'Crosswalks', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0.1, 0.6] },
            { id: 'dashes', label: 'Lane dashes', type: 'checkbox', value: true },
            { id: 'irregular', label: 'Staggered streets', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0, 1],
                hint: 'At 0 the cross streets all line up. Higher and each row of blocks gets its own' },
            { id: 'boulevards', label: 'Boulevards', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.8],
                hint: 'Wide streets with trees down the middle' },
            { id: 'roundabouts', label: 'Roundabouts', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0, 0.7] },
            { type: 'section', label: 'Town' },
            { id: 'downtown', label: 'Town centre', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 1],
                hint: 'How built up the middle of town gets: apartments, terraces and shops' },
            { id: 'plazas', label: 'Squares', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1] },
            { id: 'tower', label: 'Clock tower', type: 'checkbox', value: true, random: 0.6, hint: 'On a square, when there is one' },
            { id: 'church', label: 'Church', type: 'checkbox', value: true, random: 0.7 },
            { id: 'river', label: 'River', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4, random: [0, 1],
                hint: 'Chance of a river through town, with bridges over it' },
            { id: 'boats', label: 'Boats', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1], show: p => p.river > 0 },
            { type: 'section', label: 'Buildings' },
            { id: 'houses', label: 'Pitched-roof houses', type: 'range', min: 0, max: 1, step: 0.01, value: 1, random: [0.5, 1] },
            { id: 'flats', label: 'Flat-roof houses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.6] },
            { id: 'aframes', label: 'A-frames', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2, random: [0, 0.4] },
            { id: 'apartments', label: 'Apartments', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.6] },
            { id: 'terraces', label: 'Terraced rows', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.7],
                hint: 'Narrow gable-fronted houses in a row, mostly in the town centre' },
            { id: 'windmills', label: 'Windmills', type: 'range', min: 0, max: 1, step: 0.01, value: 0.05, random: [0, 0.12] },
            { id: 'parks', label: 'Parks & gardens', type: 'range', min: 0, max: 1, step: 0.01, value: 0.1, random: [0, 0.25] },
            { id: 'floors', label: 'Max storeys', type: 'range', min: 1, max: 8, step: 1, value: 4, random: [3, 5] },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Window panes, car windows, sail lattices and other small line work' },
            { type: 'section', label: 'Details' },
            { id: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 0.9] },
            { id: 'cars', label: 'Cars', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 0.9] },
            { id: 'fences', label: 'Fences', type: 'range', min: 0, max: 1, step: 0.01, value: 0.65, random: [0.2, 0.9] },
            { id: 'props', label: 'Yard things', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 1] },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0, 0.7] },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 8, step: 1, value: 1, random: false,
                hint: '2 pens: buildings and things / streets and plants. 3 gives plants their own pen and 4 things. 5 to 8 split cars and boats, people, water, then fences and benches off onto a pen each' },
        ],

        randomize(rng) {
            return { yaw: rng.pick([45, 52, 52, 38, 60]), elev: rng.pick([35.5, 38.5, 38.5, 42]) };
        },

        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const k = p.scale;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0);
            const S = new Scene(cam, W, H);
            const T = {
                S, cam, p, k,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                // keep the two curb lines apart on paper
                curb: Math.max(0.2, 0.45 / (k * cam.ce)),
                cornerR: 3.5,
                // no roof hatching here (see isokit's shade)
                waterKind: WATER,
            };
            buildTown(T, ctx.seed | 0);
            const pens = Math.max(1, Math.min(8, p.pens | 0));
            // pen for each kind (buildings, ground, plants, things, vehicles, people, water, wood) by pen count
            const penOf = [
                [0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 1, 0], [0, 1, 2, 0, 0, 0, 1, 0], [0, 1, 2, 3, 3, 3, 1, 3],
                [0, 1, 2, 3, 4, 3, 1, 3], [0, 1, 2, 3, 4, 5, 1, 3], [0, 1, 2, 3, 4, 5, 6, 3], [0, 1, 2, 3, 4, 5, 6, 7],
            ][pens - 1];
            const byPen = renderPens(S, penOf, [BUILDING, GROUND, PLANT, THING, THING, THING, GROUND, THING]);
            return { layers: Array.from({ length: pens }, (_, i) => byPen[i] || []) };
        },
    });
})();
