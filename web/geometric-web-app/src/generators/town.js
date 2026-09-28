/*
 * Town: an isometric suburb in the style of an illustrated map.
 *
 * The town is a small 3D scene: a grid of raised blocks with curbs and
 * sidewalks, lots with houses, apartments, A-frames and the odd windmill,
 * plus cars, fences, trees and yard clutter. Everything is built from boxes,
 * prisms and faceted cylinders, with flat upright cut-outs for trees and
 * people, and viewed through an orthographic camera.
 *
 * Hidden lines are removed exactly (see lib/iso.js), so the plot has just the
 * visible outlines. Sizes are in metres and Scale turns them into millimetres
 * on paper.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { DIRS, hash, makeCamera, frame, hull, card, ring, Scene, render, segments } = PG.iso;
    const {
        FLOOR, wall, rect, pane, door, garageDoor, windows, gableRoof, roofExtras, chimney, roofUnit, flatRoof,
        plinth, steps, porch, downpipe, hipRoof, car, fence, railing, patioSet, bench, clothesline, bike,
        person, Occupancy,
    } = PG.isokit;

    // line kinds, split over pens
    const BUILDING = 0, GROUND = 1, PLANT = 2, THING = 3;

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
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), { base, floors, style, winW: 1.1, winH: 1.5, gap: 0.85, doors: side === 0 ? [doorS] : [] });
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

    function conifer(T, x, y, z, h, rng) {
        const S = T.S, te = T.cam.tanE;
        S.kind = PLANT;
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

    function block(T, x0, y0, x1, y1, keys) {
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
        const rng = new PG.RNG(hash(...keys, 1));
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
        const ix0 = x0 + sw, iy0 = y0 + sw, ix1 = x1 - sw, iy1 = y1 - sw;
        const W = ix1 - ix0, D = iy1 - iy0;
        if (rng.chance(p.parks * 0.2) || W < 6 || D < 6) {
            parkBlock(T, frame(ix0, iy0, hc, 0), W, D, keys);
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
        if (lot.dir < 0) return yard(T, lot, keys, 'court');
        const big = lot.w >= 7.5 && lot.d >= 8.8;
        const kind = rng.weighted([
            [p.houses * 1.0, 'house'],
            [p.flats * 1.0, 'modern'],
            [lot.w >= 6.5 && lot.d >= 10 ? p.aframes : 0, 'aframe'],
            [big ? p.apartments : 0, 'apartment'],
            [lot.w >= 9 && lot.d >= 9 ? p.windmills : 0, 'windmill'],
            [p.parks * 0.8, 'park'],
            [p.parks * 0.5, 'garden'],
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
        else { L = rng.range(5.5, 8.5); D = rng.range(5, 7.5); }
        L = Math.min(L, w - 1.2);
        D = Math.min(D, d - (kind === 'aframe' ? 4 : 2.6));
        if (L < 4 || D < 4) return yard(T, lot, keys, 'park');
        // squeeze the house a little to fit a driveway beside it
        if (kind !== 'apartment' && w - L < 3.9 && w - 3.9 >= 4.8 && rng.chance(0.8)) L = w - 3.9;
        const room = w - L;
        const hasDrive = kind !== 'apartment' && room >= 3.9;
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
            apartment(T, F, fp, rng, { floors: geo.clamp(rng.int(3, Math.max(5, maxF)), Math.min(3, maxF), maxF) });
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
        if (o.kind !== 'court' && fr.chance(p.fences)) {
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
            else if (kind === 'picnic') picnicTable(T, x, y, lot.z, (lot.dir + (sw > sd ? 0 : 1)) & 3, true);
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
    // (x, y) is the start of the centre line, (dx, dy) its direction.
    function street(T, x, y, dx, dy, len, keys) {
        const { S, p } = T;
        const st = p.street, nx = -dy, ny = dx;
        const at = (s, t) => [x + dx * s + nx * t, y + dy * s + ny * t, 0];
        const rng = new PG.RNG(hash(...keys, 12));
        S.kind = GROUND;
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
        if (p.dashes) {
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

    function buildTown(T, seed) {
        const { S, p, cam } = T;
        const bw = p.blockW, bd = p.blockD, st = p.street;
        const PX = bw + st, PY = bd + st;
        const ph = new PG.RNG(hash(seed, 99));
        const gx = ph.range(-PX, 0), gy = ph.range(-PY, 0);
        // the ground visible on the page, plus room for tall things standing below it
        const tall = 16 * cam.ce * cam.k;
        const corners = [[0, 0], [S.W, 0], [S.W, S.H + tall], [0, S.H + tall]].map(([x, y]) => cam.ground(x, y));
        const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
        const i0 = Math.floor((Math.min(...xs) - gx) / PX) - 1, i1 = Math.ceil((Math.max(...xs) - gx) / PX);
        const j0 = Math.floor((Math.min(...ys) - gy) / PY) - 1, j1 = Math.ceil((Math.max(...ys) - gy) / PY);
        // can't happen within the parameter limits, but don't loop forever if it does
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 20000) return;
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
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                const x0 = gx + i * PX, y0 = gy + j * PY;
                const keys = [seed, i, j];
                if (seen(x0 - st, y0 - st, x0, y0 + bd, 3)) street(T, x0 - st / 2, y0 + bd, 0, -1, bd, [...keys, 1]);
                if (seen(x0, y0 - st, x0 + bw, y0, 3)) street(T, x0, y0 - st / 2, 1, 0, bw, [...keys, 2]);
                if (seen(x0, y0, x0 + bw, y0 + bd, 16)) block(T, x0, y0, x0 + bw, y0 + bd, keys);
            }
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
            { type: 'section', label: 'Buildings' },
            { id: 'houses', label: 'Pitched-roof houses', type: 'range', min: 0, max: 1, step: 0.01, value: 1, random: [0.5, 1] },
            { id: 'flats', label: 'Flat-roof houses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.6] },
            { id: 'aframes', label: 'A-frames', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2, random: [0, 0.4] },
            { id: 'apartments', label: 'Apartments', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0, 0.6] },
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
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: '2 pens: buildings and things / streets and plants. 3 gives plants their own pen, 4 splits off cars and props' },
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
            };
            buildTown(T, ctx.seed | 0);
            const kinds = render(S);
            const pens = Math.max(1, Math.min(4, p.pens | 0));
            // pen for each kind (buildings, ground, plants, things) by pen count
            const penOf = [[0, 0, 0, 0], [0, 1, 1, 0], [0, 1, 2, 0], [0, 1, 2, 3]][pens - 1];
            const layers = Array.from({ length: pens }, () => []);
            kinds.forEach((paths, i) => { for (const q of paths) layers[penOf[i]].push(q); });
            return { layers };
        },
    });
})();
