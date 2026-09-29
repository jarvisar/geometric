/*
 * Harbour: an isometric fishing town on the water, drawn for four to eight pens.
 *
 * It's a 3D scene like Town, with hidden lines removed (lib/iso.js). Rows of
 * blocks face the avenues that run along the quay. Each row gets its own cross
 * streets so they don't have to line up, and a block can turn into a square.
 * Canals and a dock can cut into the land, and wharves and the breakwater
 * stick out into the water. All of those are rectangles, so the quay walls
 * are worked out from them in one go (see Shore). Out on the water there are
 * piers of a few shapes, moored boats, boats under way, buoys and the
 * lighthouse, on the breakwater or on an island of its own.
 *
 * The colour work is in the style of an illustrated map. Lit roof slopes are
 * hatched in red and shaded ones in black, a low sun casts blue hatched
 * shadows onto the ground and the water, the water gets rows of short blue
 * dashes, and cart canopies and boat cabin roofs are yellow. Shadows are cut
 * off at the edge of the lot they fall in, which keeps the streets clean.
 * With six pens trees and hedges go green and people and cars purple, and
 * with eight the water marks go light blue and the piers and boats brown.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { DIRS, hash, makeCamera, frame, card, ring, hull, Scene, renderPens, segments } = PG.iso;
    const {
        FLOOR, wall, rect, pane, door, garageDoor, windows, gableRoof, gableSlope, hipRoof, chimney, flatRoof, plinth,
        steps, bench, clothesline, Occupancy, withKind,
        lerp3, unit, outward, shade, shadeGable, shadeRound, awning, vault, ribs, marketHall, clockTower,
        gableWall, stepGable, hoist, terrace, church, cart, bistro, fountain, obelisk, bandstand,
        hullSolid, turned, bridgeRamp, LENGTH, crookLamp: lamp, railFence,
    } = PG.isokit;

    // line kinds. The last four only get pens of their own with six or eight pens.
    const INK = 0, RED = 1, BLUE = 2, YELLOW = 3, GREEN = 4, FIGURE = 5, WATER = 6, WOOD = 7;
    const kit = PG.isokit;
    const person = withKind(FIGURE, kit.person), bike = withKind(FIGURE, kit.bike), car = withKind(FIGURE, kit.car);
    const moorRow = withKind(WOOD, kit.moorRow), underway = withKind(WOOD, kit.underway);
    const LAND = 1.6;             // the quay and the town stand this high above the water (m)
    const SUN_TURN = geo.rad(65); // shadows fall along +x, turned this far towards -y (to the right on the page)
    const WORLD = frame(0, 0, 0, 0);

    // Roof windows standing a little proud of the front slope, so they break
    // the hatching, with dark glass
    function skylights(T, F, R, rng) {
        const S = T.S, sl = gableSlope(F, R, -1);
        if (!T.sees(sl.n) || sl.up < 2.4 || sl.len < 3.5) return;
        const nn = unit(sl.n).map(v => v * 0.08);
        const n = sl.len > 7 && rng.chance(0.5) ? 2 : 1;
        for (let i = 0; i < n; i++) {
            const w = 0.85, h = 1.05;
            const s0 = ((i + 0.5) * sl.len) / n - w / 2 + rng.range(-0.4, 0.4), t0 = sl.up * rng.range(0.25, 0.4);
            const base = [sl.at(s0, t0), sl.at(s0 + w, t0), sl.at(s0 + w, t0 + h), sl.at(s0, t0 + h)];
            const top = base.map(p => [p[0] + nn[0], p[1] + nn[1], p[2] + nn[2]]);
            S.solid(base.concat(top), PG.iso.BOX);
            if (!T.detail) continue;
            for (const f of [0.3, 0.5, 0.7]) S.line([lerp3(top[0], top[1], f), lerp3(top[3], top[2], f)]);
        }
    }

    // ------------------------------------------------------------------
    // Buildings. Each takes the lot frame (u along the street, v into the lot)
    // and a footprint [a0, b0, a1, b1].
    // ------------------------------------------------------------------

    // Double doors with a brace across each leaf, the pair making a W
    function barnDoors(T, at, s, base, w, h) {
        const S = T.S;
        rect(T, at, s - w / 2, base, w, h);
        S.line([at(s, base), at(s, base + h)]);
        if (!T.detail) return;
        for (const x0 of [s - w / 2, s]) S.line([at(x0, base + h), at(x0 + w / 4, base), at(x0 + w / 2, base + h)]);
    }

    // The faces of isokit's hip roof, rebuilt from the same corners it uses
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

    // House, 1 to 3 storeys, under a gable roof with the ridge along the street
    // or a hip roof. `twin` makes it a pair of houses sharing the middle wall.
    function house(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0;
        const base = 0.3, top = base + o.floors * FLOOR;
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        const hip = !o.twin && rng.chance(0.3), pitch = geo.rad(rng.range(30, 40));
        const R = hip ? hipRoof(T, F, fp, top, pitch) : gableRoof(T, F, fp, top, true, pitch, rng, { attic: !o.twin && rng.chance(0.3) });
        if (o.twin) {
            // party wall between the pair, standing a little proud of the roof
            const P = F.P, m = (a0 + a1) / 2, e = 0.14, run = e / R.tp;
            S.prism([P(m - 0.13, b0 - R.oh - run, R.zb), P(m - 0.13, b1 + R.oh + run, R.zb), P(m - 0.13, R.mid, R.ridge + e)], F.V(0.26, 0, 0));
        }
        const mid = hip ? (b0 + b1) / 2 : R.mid;
        const stacks = o.twin ? [a0 + L * 0.25, a0 + L * 0.75] : rng.chance(0.45) ? [rng.range(a0 + 0.8, a1 - 0.8)] : [];
        for (const a of stacks) chimney(T, F, a, mid + rng.range(0.4, 0.9), R.zb, R.ridge + rng.range(0.4, 0.7));
        if (!o.twin && !hip && rng.chance(0.3)) skylights(T, F, R, rng);
        if (hip) hatchHip(T, F, R);
        else shadeGable(T, F, R);
        const front = wall(F, 0, fp);
        const doors = o.twin ? [L * 0.2, L * 0.8] : [L * rng.range(0.2, 0.4)];
        if (T.sees(front.n)) {
            for (const d of doors) {
                door(T, front.at, d, base);
                steps(T, F, a0 + d, b0, 1.2, 1);
            }
        }
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), {
                base, floors: o.floors, style: 'frame', winW: 1, winH: 1.2, gap: 1,
                doors: side === 0 ? doors : [],
            });
        }
        let aw = null;
        if (o.awning && !o.twin && L - doors[0] > 3.2) {
            aw = [a0 + doors[0] + 0.75, a1 - 0.15];
            awning(T, F, aw[0], aw[1], b0, base + 2.75, 1.3);
        }
        return { doors, awning: aw };
    }

    // 3 to 5 storey block of flats with a flat roof inside a parapet
    function apartment(T, F, fp, rng, o) {
        const S = T.S, P = F.P;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0;
        const base = 0.3, top = base + o.floors * FLOOR;
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        const ov = 0.3, zr = flatRoof(T, F, fp, top, ov, 0.45), d = 0.3 - ov;
        shade(T, [P(a0 - d, b0 - d, zr), P(a1 + d, b0 - d, zr), P(a1 + d, b1 + d, zr), P(a0 - d, b1 + d, zr)], [0, 0, 1]);
        if (rng.chance(0.4)) {
            // stair hut, sometimes with someone up there
            const ha = rng.range(a0 + 1.2, a1 - 2.6), hb = rng.range(b0 + 1.4, b1 - 2.4);
            S.box(F, ha, hb, zr, ha + 1.4, hb + 1.4, zr + 2.2);
            flatRoof(T, F, [ha, hb, ha + 1.4, hb + 1.4], zr + 2.2, 0.12, 0.15);
            if (rng.chance(0.4)) {
                const [x, y] = F.P(ha + rng.range(-0.9, -0.6), hb - 0.8, 0);
                person(T, x, y, zr, rng);
            }
        }
        const doorS = L * rng.range(0.25, 0.45);
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            door(T, front.at, doorS, base, 1.1, 2.2);
            steps(T, F, a0 + doorS, b0, 1.5, 2);
            S.box(F, a0 + doorS - 0.8, b0 - 0.8, base + 2.6, a0 + doorS + 0.8, b0, base + 2.75);
        }
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), {
                base, floors: o.floors, style: 'frame', winW: 1, winH: 1.3, gap: 0.8,
                doors: side === 0 ? [doorS] : [],
            });
        }
        return { doors: [doorS], awning: null };
    }

    // Warehouse under a barrel roof, barn doors on the end facing the street.
    // With `stacks` the barrel runs along the street instead, with chimney stacks.
    function warehouse(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0;
        const base = 0.3, top = base + rng.range(4.3, 5.2);
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        const span = o.stacks ? b1 - b0 : L;
        const V = vault(T, F, fp, top - 0.1, !o.stacks, span * rng.range(0.24, 0.3));
        ribs(T, V, o.stacks ? 1.6 : 1.8);
        if (o.stacks) {
            const n = L > 7 ? 3 : 2;
            for (let i = 0; i < n; i++) {
                const a = a0 + (L * (i + 0.5)) / n;
                chimney(T, F, a, (b0 + b1) / 2, top, V.ridge + rng.range(1.2, 1.8));
            }
        }
        const front = wall(F, 0, fp);
        const dw = Math.min(3, L * 0.45);
        if (T.sees(front.n)) barnDoors(T, front.at, L / 2, base, dw, 2.9);
        for (let side = 0; side < 4; side++) {
            const W = wall(F, side, fp);
            if (!T.sees(W.n)) continue;
            const skip = side === 0 ? [[L / 2 - dw / 2 - 0.2, L / 2 + dw / 2 + 0.2]] : [];
            windows(T, W, { base, floors: 1, style: 'bars', winW: 0.8, winH: 0.9, sill: 1.4, gap: 1.2, skip });
            windows(T, W, { base: base + 1.9, floors: 1, style: 'bars', winW: 0.8, winH: 0.7, sill: 0.8, gap: 1.2, skip });
        }
        return { doors: [L / 2], awning: null };
    }

    // Workshop with a sawtooth roof and a roller door
    function workshop(T, F, fp, rng) {
        const S = T.S, P = F.P;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0;
        const base = 0.3, top = base + rng.range(3.8, 4.4);
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        // sawtooth: each tooth's glazed upright face looks towards the street
        const n = Math.max(2, Math.round((b1 - b0) / 2.6)), dv = (b1 - b0) / n, ht = dv * 0.5;
        const a = a0 - 0.15, e = L + 0.3;
        for (let i = 0; i < n; i++) {
            const b = b0 + dv * i;
            S.prism([P(a, b, top), P(a, b, top + ht), P(a, b + dv, top)], F.V(e, 0, 0));
            // always in the lit colour, as the teeth read better that way
            shade(T, [P(a, b, top + ht), P(a + e, b, top + ht), P(a + e, b + dv, top), P(a, b + dv, top)], F.V(0, ht, dv), 'lit');
            if (!T.detail || !T.sees(F.V(0, -1, 0))) continue;
            const m = Math.max(2, Math.round(e / 0.9)), g = 0.12;
            S.line([P(a + g, b, top + ht / 2), P(a + e - g, b, top + ht / 2)]);
            for (let j = 1; j < m; j++) S.line([P(a + (e * j) / m, b, top + g), P(a + (e * j) / m, b, top + ht - g)]);
        }
        const front = wall(F, 0, fp);
        const dw = Math.min(3.4, L * 0.5), ds = L * rng.range(0.3, 0.45);
        if (T.sees(front.n)) {
            garageDoor(T, front.at, ds - dw / 2, base, dw, 3);
            door(T, front.at, Math.min(L - 0.8, ds + dw / 2 + 1.1), base);
        }
        for (let side = 1; side < 4; side++) windows(T, wall(F, side, fp), { base, floors: 1, style: 'bars', winW: 1.1, winH: 0.9, sill: 1.5, gap: 1.4 });
        return { doors: [ds], awning: null };
    }

    // Tall warehouse with its gable to the street, loading doors up the front
    // and a hoist beam under the peak. Sometimes with a stepped gable.
    function storehouse(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0, mid = L / 2, base = 0.3, t = 0.35;
        const floors = Math.max(2, Math.min(o.floors, rng.int(3, 4))), top = base + floors * FLOOR;
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        const stepped = rng.chance(0.4);
        const rf = stepped ? [a0 + 0.4, b0 + t + 0.3, a1 - 0.4, b1] : fp;
        const R = gableRoof(T, F, rf, stepped ? top + 0.25 : top, false, geo.rad(rng.range(42, 50)), rng, { attic: false });
        shadeGable(T, F, R);
        if (stepped) gableWall(T, F, a0, b0, t, stepGable(L, top, R.rise, L > 7.5 ? 4 : 3));
        hoist(T, F, a0 + mid, stepped ? b0 : b0 - 0.4, R.zb + R.rise * (stepped ? 0.7 : 0.5));
        const front = wall(F, 0, fp);
        if (T.sees(front.n)) {
            barnDoors(T, front.at, mid, base, 2.4, 2.8);
            for (let f = 1; f < floors; f++) {
                const c = base + f * FLOOR + 0.15;
                rect(T, front.at, mid - 0.75, c, 1.5, 2.1);
                if (T.detail) S.line([front.at(mid, c), front.at(mid, c + 2.1)]);
                if (L >= 7) for (const s of [L * 0.17, L * 0.83]) pane(T, front.at, s - 0.4, c + 0.6, 0.8, 1, 'bars');
            }
        }
        for (const side of [1, 3]) windows(T, wall(F, side, fp), { base, floors, style: 'bars', winW: 0.8, winH: 1, gap: 1.4 });
        return { doors: [mid], awning: null };
    }

    // Grain silos in a row with an elevator tower at one end and a gallery
    // along the tops
    function silos(T, F, fp, rng) {
        const S = T.S;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0, bm = (b0 + b1) / 2, base = 0.3;
        const ew = 3.4, h = rng.range(11, 14), gap = 0.5;
        // at least two silos, thinner ones on a narrow lot
        const r = Math.min((b1 - b0) / 2, rng.range(1.9, 2.4), (L - ew) / 4 - gap / 2);
        const pitch = 2 * r + gap, n = Math.max(2, Math.floor((L - ew) / pitch));
        const left = rng.chance(0.5), ea = left ? a0 : a1 - ew, sa = left ? a0 + ew : a1 - ew - n * pitch;
        plinth(T, F, fp, base, 0.15);
        // lathe heights are world heights, the rest go through the lot frame
        const z0 = F.P(0, 0, base)[2], cone = h + r * 0.55;
        const centre = i => F.P(sa + gap / 2 + r + i * pitch, bm, 0);
        for (let i = 0; i < n; i++) {
            const [x, y] = centre(i);
            S.lathe(x, y, [[r, z0], [r, z0 + h], [0.4, z0 + cone], [0.4, z0 + cone + 0.15]], T.segs(r));
            shadeRound(T, x, y, z0, z0 + h, r, r);
        }
        // ladder up the first one
        const [lx, ly] = centre(0), c = T.cam;
        const at = (s, z) => [lx - c.fx * (r + 0.1) + c.rx * s, ly - c.fy * (r + 0.1) + c.ry * s, z0 + z];
        for (const s of [-0.22, 0.22]) S.line([at(s, 0.4), at(s, h)]);
        if (T.detail) for (let z = 0.8; z < h; z += 0.45) S.line([at(-0.22, z), at(0.22, z)]);
        // elevator tower and the gallery over to the far silo, resting on the cone tops
        const top = base + cone + 2.8, ef = [ea, bm - 1.6, ea + ew, bm + 1.6];
        S.box(F, ef[0], ef[1], base, ef[2], ef[3], top);
        shadeGable(T, F, gableRoof(T, F, ef, top, true, geo.rad(35), rng, { attic: false }));
        for (let side = 0; side < 4; side++) windows(T, wall(F, side, ef), { base: base + 2, floors: 3, style: 'bars', winW: 0.7, winH: 0.8, sill: 1, gap: 1.2 });
        const g0 = left ? ea + ew : sa + gap / 2 + r, g1 = left ? sa + n * pitch - gap / 2 - r : ea;
        S.box(F, g0, bm - 0.4, base + cone + 0.15, g1, bm + 0.4, base + cone + 1.05);
        const front = wall(F, 0, ef);
        if (T.sees(front.n)) door(T, front.at, ew / 2, base, 1.2, 2.3, true);
        return { doors: [ea - a0 + ew / 2], awning: null };
    }

    // Tower windmill, as in the Town design, sails on the side facing `faceDir`
    function windmill(T, x, y, z, faceDir, rng) {
        const S = T.S;
        S.kind = INK;
        const r0 = rng.range(2.2, 2.6), r1 = r0 * 0.72, h = rng.range(6.5, 8), n = 24;
        S.frustum(x, y, z, z + h, r0, r1, n);
        shadeRound(T, x, y, z, z + h, r0, r1);
        S.frustum(x, y, z + h, z + h + 0.3, r1 + 0.35, r1 + 0.35, n);
        // domed cap with a finial, a little inside the rim so the two outlines don't overlap
        const R = r1 + 0.22, zc = z + h + 0.3, hd = R * rng.range(0.9, 1.2), dome = [];
        for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * (Math.PI / 2);
            dome.push([R * Math.cos(a), zc + hd * Math.sin(a)]);
        }
        S.lathe(x, y, dome, n);
        S.line([[x, y, zc + hd], [x, y, zc + hd + 0.7]]);
        const [dx, dy] = DIRS[faceDir], px = -dy, py = dx;
        const onTower = (s, c) => {
            const r = r0 + (r1 - r0) * (c / h);
            return [x + dx * r + px * s, y + dy * r + py * s, z + c];
        };
        rect(T, onTower, -0.55, 0, 1.1, 2.1);
        pane(T, onTower, -0.35, h * 0.55, 0.7, 0.9, 'cross');
        // sails in the plane facing out, hub just off the tower
        const hub = [x + dx * (r1 + 0.7), y + dy * (r1 + 0.7), z + h - 0.3];
        const at = (s, c) => [hub[0] + px * s, hub[1] + py * s, hub[2] + c];
        const hr = 0.38, hubPts = ring(T.segs(hr), (cx, cy) => at(cx * hr, cy * hr));
        S.face(hubPts);
        S.loop(hubPts);
        const phi0 = rng.range(0, Math.PI / 2);
        for (let i = 0; i < 4; i++) {
            const a = phi0 + (i * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
            const q = (s, t) => at(ux * s + vx * t, uy * s + vy * t);
            const s0 = hr + 0.3, s1 = rng.range(5, 5.8), w = 1.05;
            const sail = [q(s0, 0), q(s1, 0), q(s1, w), q(s0, w)];
            S.face(sail);
            S.loop(sail);
            S.line([q(hr, 0.02), q(s0, 0.02)]);
            if (T.detail) {
                const m = Math.max(3, Math.round((s1 - s0) / 0.75));
                for (let j = 1; j < m; j++) S.line([q(s0 + ((s1 - s0) * j) / m, 0), q(s0 + ((s1 - s0) * j) / m, w)]);
            }
        }
    }

    // ------------------------------------------------------------------
    // Props
    // ------------------------------------------------------------------

    // Low clipped hedge: a scalloped outline round a rounded strip along u
    const hedge = withKind(GREEN, (T, F, a0, a1, b, wid) => {
        const S = T.S, h = 0.6, r = wid / 2, cam = T.cam;
        if (a1 - a0 < wid) return;
        const cap = n => Array.from({ length: n + 1 }, (_, i) => i / n);
        // centre line of the strip and the outline around it, walked by arc length
        const base = [];
        for (const t of cap(8)) base.push([a1 - r + r * Math.sin(Math.PI * t), b - r * Math.cos(Math.PI * t)]);
        for (const t of cap(8)) base.push([a0 + r - r * Math.sin(Math.PI * t), b + r * Math.cos(Math.PI * t)]);
        const solid = base.map(([a, v]) => F.P(a, v, 0));
        S.prism(solid, [0, 0, h], true, true);
        // scallops: the outline pushed out in bumps about 0.45 m long
        const out = [];
        let run = 0;
        const ctr = [(a0 + a1) / 2, b];
        const walk = base.concat([base[0]]);
        for (let i = 0; i + 1 < walk.length; i++) {
            const p0 = walk[i], p1 = walk[i + 1], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const m = Math.max(1, Math.ceil(L / 0.08));
            for (let k = 0; k < m; k++) {
                const t = k / m, pa = p0[0] + (p1[0] - p0[0]) * t, pb = p0[1] + (p1[1] - p0[1]) * t;
                const s = run + L * t;
                // push away from the nearest point of the centre segment
                const ca = geo.clamp(pa, a0 + r, a1 - r), da = pa - ca, db = pb - ctr[1], dl = Math.hypot(da, db) || 1;
                const bump = 0.09 * Math.abs(Math.sin((Math.PI * s) / 0.45));
                out.push([pa + (da / dl) * bump, pb + (db / dl) * bump]);
            }
            run += L;
        }
        S.loop(out.map(([a, v]) => F.P(a, v, h)));
        S.loop(out.map(([a, v]) => F.P(a, v, 0.02)));
        // the two ends of the outline as seen from the camera
        let lo = null, hi = null, lov = Infinity, hiv = -Infinity;
        for (const [a, v] of out) {
            const q = F.P(a, v, 0), sx = q[0] * cam.rx + q[1] * cam.ry;
            if (sx < lov) { lov = sx; lo = [a, v]; }
            if (sx > hiv) { hiv = sx; hi = [a, v]; }
        }
        for (const [a, v] of [lo, hi]) S.line([F.P(a, v, 0.02), F.P(a, v, h)]);
    });

    // A few crates, maybe one stacked, and a barrel
    function crates(T, F, a, b, rng) {
        const S = T.S, s = 0.6;
        const spots = [[a, b, 0], [a + 0.66, b, 0], [a + 0.2, b + 0.64, 0]];
        if (rng.chance(0.5)) spots.push([a + 0.3, b + 0.05, s]);
        for (const [x, y, z] of spots.slice(0, rng.int(2, spots.length))) {
            S.box(F, x, y, z, x + s, y + s, z + s);
            if (!T.detail) continue;
            for (const [side, fp] of [[0, [x, y, x + s, y + s]], [1, [x, y, x + s, y + s]]]) {
                const W = wall(F, side, fp);
                if (T.sees(W.n)) S.line([W.at(0.08, z + 0.08), W.at(s - 0.08, z + s - 0.08)]);
            }
        }
        const [x, y, z] = F.P(a + 1.7, b + 0.35, 0);
        S.lathe(x, y, [[0.26, z], [0.31, z + 0.42], [0.26, z + 0.84]], 16);
        if (T.detail) {
            for (const c of [0.2, 0.64]) S.loop(ring(T.segs(0.3), (u, v) => [x + 0.305 * u, y + 0.305 * v, z + c]));
        }
    }

    // ------------------------------------------------------------------
    // Boats
    // ------------------------------------------------------------------

    // Moored boat of a random kind, pointing along the pier. Returns its length.
    function boat(T, x, y, dir, rng, kind) {
        T.S.kind = WOOD;
        return PG.isokit.boat(T, frame(x, y, 0, dir), kind, rng);
    }

    function buoy(T, x, y) {
        const S = T.S;
        S.kind = INK;
        S.lathe(x, y, [[0.55, 0], [0.75, 0.25], [0.6, 0.5], [0.2, 0.62]], 16);
        S.frustum(x, y, 0.62, 1.6, 0.22, 0.08, 10);
        S.lathe(x, y, [[0, 1.55], [0.3, 1.85], [0, 2.2]], 10);
    }

    // ------------------------------------------------------------------
    // Piers
    // ------------------------------------------------------------------

    // Wooden deck on posts at height z, planked across its length. Returns
    // the tops of the tall posts, for the mooring lines.
    function deck(T, x0, y0, x1, y1, z) {
        const S = T.S, alongX = x1 - x0 >= y1 - y0;
        const L = alongX ? x1 - x0 : y1 - y0, wd = alongX ? y1 - y0 : x1 - x0;
        const at = (s, t, c) => (alongX ? [x0 + s, y0 + t, c] : [x0 + t, y0 + s, c]);
        S.kind = WOOD;
        S.box(WORLD, x0, y0, z - 0.25, x1, y1, z);
        if (T.detail) {
            const n = Math.max(2, Math.round(L / 0.8));
            for (let i = 1; i < n; i++) S.line([at((L * i) / n, 0, z), at((L * i) / n, wd, z)]);
        }
        const posts = [], n = Math.max(1, Math.round(L / 3.4));
        for (let i = 0; i <= n; i++) {
            const s = 0.2 + ((L - 0.4) * i) / n;
            for (const t of [-0.12, wd + 0.12]) {
                const [px, py] = at(s, t, 0);
                S.box(WORLD, px - 0.12, py - 0.12, 0, px + 0.12, py + 0.12, z + (i % 2 ? 0.1 : 0.5));
                if (i % 2 === 0) posts.push([px, py, z + 0.5]);
            }
        }
        return posts;
    }

    // Wooden pier out from the quay along -x, plain or with a T or L shaped
    // head, and boats tied up along it
    function pier(T, xq, pr, rng) {
        const { y, len, wid, kind } = pr, z = 0.9, xe = xq - len;
        const kinds = [[3, 'fishing'], [2, 'row'], [1.5, 'launch'], [1, 'sail']];
        let posts = deck(T, xe, y - wid / 2, xq, y + wid / 2, z);
        if (kind === 'plain') {
            for (const s of [-1, 1]) moorRow(T, [xq - 1.5, y + s * wid / 2], [xe, y + s * wid / 2], [0, s], posts, rng, kinds, 2.5);
            return;
        }
        const [h0, h1] = pr.head;
        posts = posts.concat(deck(T, xe - pr.hd, h0, xe, h1, z));
        for (const s of [-1, 1]) {
            // the side an L doesn't turn to runs straight on to the end of the head
            const open = kind === 'L' && s !== pr.side;
            moorRow(T, [xq - 1.5, y + s * wid / 2], [open ? xe - pr.hd : xe + 1, y + s * wid / 2], [0, s], posts, rng, kinds, open ? 2.5 : 0);
        }
        const a = pr.fwd > 0 ? h0 + 0.5 : h1 - 0.5, b = pr.fwd > 0 ? h1 : h0;
        moorRow(T, [xe - pr.hd, a], [xe - pr.hd, b], [-1, 0], posts, rng, kinds, 1.5);
        if (kind === 'L') {
            // inside the L, far enough along to clear the boats on the stem
            const y0 = y + pr.side * (wid / 2 + 4);
            moorRow(T, [xe, y0], [xe, pr.side > 0 ? h1 : h0], [1, 0], posts, rng, [[2, 'row'], [1.5, 'launch']]);
        }
    }

    // Floating pontoon for small boats: a gangway down from the quay, then a
    // walkway out with fingers either side and a boat in most of the gaps
    function marina(T, xq, pr, rng) {
        const S = T.S, { y, len, fl } = pr, z = 0.45, hw = 1, gx = xq - 4, x0 = xq - len;
        S.kind = WOOD;
        S.prism([[xq, y - 0.6, LAND + 0.05], [gx, y - 0.6, z + 0.05], [gx, y - 0.6, z - 0.08], [xq, y - 0.6, LAND - 0.08]], [0, 1.2, 0]);
        for (const s of [-0.6, 0.6]) {
            S.line([[xq, y + s, LAND + 1], [gx, y + s, z + 1]]);
            S.line([[gx + 0.2, y + s, z + 0.05], [gx + 0.2, y + s, z + 1]]);
        }
        S.box(WORLD, x0, y - hw, z - 0.3, gx + 0.8, y + hw, z);
        for (const px of [x0 + 0.3, gx + 0.5]) {
            for (const s of [-1, 1]) S.frustum(px, y + s * (hw + 0.2), 0, 2.4, 0.16, 0.16, T.segs(0.16));
        }
        const xs = [];
        for (let x = gx - 1.4; x > x0 + 0.6; x -= 3.8) xs.push(x);
        for (const x of xs) {
            for (const s of [-1, 1]) {
                const b0 = y + s * hw, b1 = y + s * (hw + fl);
                S.box(WORLD, x - 0.4, Math.min(b0, b1), z - 0.25, x + 0.4, Math.max(b0, b1), z - 0.06);
            }
        }
        const kinds = [[3, 'row'], [2, 'sail'], [1, 'launch']];
        for (let i = 0; i + 1 < xs.length; i++) {
            const cx = (xs[i] + xs[i + 1]) / 2;
            for (const s of [-1, 1]) {
                if (!rng.chance(0.3 + 0.65 * T.p.boats)) continue;
                const kind = rng.weighted(kinds), bowIn = rng.chance(0.6);
                boat(T, cx, y + s * (hw + 0.4 + LENGTH[kind] / 2), (s > 0) === bowIn ? 3 : 1, rng, kind);
            }
        }
    }

    // ------------------------------------------------------------------
    // Quay walls, bridges, the lighthouse and cranes
    // ------------------------------------------------------------------

    const inRect = (r, x, y, m = 0) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;
    const overlaps = (r, s) => r[0] < s[2] && r[2] > s[0] && r[1] < s[3] && r[3] > s[1];

    // Land and water. Land is everything past the quay line at xq, less the
    // cuts (canals, the dock) and plus the moles out in the water (wharves,
    // the breakwater). They're all rectangles, so the shoreline comes off a
    // grid of cells between their edges.
    class Shore {
        constructor(xq, box) {
            this.xq = xq;
            this.box = box;
            this.cuts = [];
            this.moles = [];
        }

        land(x, y) {
            if (this.cuts.some(r => inRect(r, x, y))) return false;
            return x >= this.xq || this.moles.some(r => inRect(r, x, y));
        }

        // water at least m from any land
        water(x, y, m = 0) {
            for (const [dx, dy] of [[0, 0], [-m, -m], [m, -m], [m, m], [-m, m]]) if (this.land(x + dx, y + dy)) return false;
            return true;
        }

        // the same for bigger m, checked on a grid so narrow moles don't slip through
        open(x, y, m) {
            const n = Math.ceil(m / 3);
            for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (this.land(x + (m * i) / n, y + (m * j) / n)) return false;
            return true;
        }

        cells() {
            const [X0, Y0, X1, Y1] = this.box;
            const xs = [X0, X1, this.xq], ys = [Y0, Y1];
            for (const r of this.cuts.concat(this.moles)) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
            const edges = (v, lo, hi) => [...new Set(v.map(t => geo.clamp(t, lo, hi)))].sort((a, b) => a - b);
            const X = edges(xs, X0, X1), Y = edges(ys, Y0, Y1), land = [];
            for (let j = 0; j + 1 < Y.length; j++) {
                land.push([]);
                for (let i = 0; i + 1 < X.length; i++) land[j].push(this.land((X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2));
            }
            return { X, Y, land };
        }

        // Runs of wall between land and water, a to b in increasing x or y,
        // with n pointing out over the water
        walls() {
            const { X, Y, land } = this.cells(), nx = X.length - 1, ny = Y.length - 1, out = [];
            for (let i = 1; i < nx; i++) {
                let run = null;
                for (let j = 0; j <= ny; j++) {
                    const s = j < ny && land[j][i - 1] !== land[j][i] ? (land[j][i] ? -1 : 1) : 0;
                    if (run && run.s !== s) { out.push({ a: [X[i], run.t], b: [X[i], Y[j]], n: [run.s, 0] }); run = null; }
                    if (s && !run) run = { s, t: Y[j] };
                }
            }
            for (let j = 1; j < ny; j++) {
                let run = null;
                for (let i = 0; i <= nx; i++) {
                    const s = i < nx && land[j - 1][i] !== land[j][i] ? (land[j][i] ? -1 : 1) : 0;
                    if (run && run.s !== s) { out.push({ a: [run.t, Y[j]], b: [X[i], Y[j]], n: [0, run.s] }); run = null; }
                    if (s && !run) run = { s, t: X[i] };
                }
            }
            return out;
        }

        // the land as strips of cells
        ground() {
            const { X, Y, land } = this.cells(), out = [];
            for (let j = 0; j < land.length; j++) {
                let i0 = -1;
                for (let i = 0; i < X.length; i++) {
                    const on = i < X.length - 1 && land[j][i];
                    if (on && i0 < 0) i0 = i;
                    if (!on && i0 >= 0) { out.push([X[i0], Y[j], X[i], Y[j + 1]]); i0 = -1; }
                }
            }
            return out;
        }
    }

    // Stone walls round all the land. The faces we can see get the waterline,
    // a coping line and joints, all of them get the coping's back edge and
    // bollards. Walls facing -y or +x throw a strip of shadow on the water.
    function drawShore(T, shore, groupAt, busy, rng) {
        const S = T.S, sun = S.sun;
        S.shadow = null;
        S.kind = INK;
        // the ground itself hides whatever is under it (canal and dock walls, shadows on the water)
        for (const [x0, y0, x1, y1] of shore.ground()) S.face([[x0, y0, LAND], [x1, y0, LAND], [x1, y1, LAND], [x0, y1, LAND]], false);
        for (const w of shore.walls()) {
            const [ax, ay] = w.a, [bx, by] = w.b, [nx, ny] = w.n;
            const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
            const at = (s, z, inn = 0) => [ax + dx * s - nx * inn, ay + dy * s - ny * inn, z];
            S.face([at(0, 0), at(len, 0), at(len, LAND), at(0, LAND)], false);
            S.line([at(0, LAND), at(len, LAND)]);
            // back of the coping, run on or cut short to meet the next wall round
            const inland = (x, y) => shore.land(x - nx * 0.05, y - ny * 0.05);
            const s0 = inland(ax - dx * 0.05, ay - dy * 0.05) ? -0.6 : 0.6;
            const s1 = inland(bx + dx * 0.05, by + dy * 0.05) ? len + 0.6 : len - 0.6;
            if (s1 > s0) S.line([at(s0, LAND, 0.6), at(s1, LAND, 0.6)]);
            const c0 = dx ? ax : ay;
            if (T.sees([nx, ny, 0])) {
                S.line([at(0, 0), at(len, 0)]);
                S.line([at(0, LAND - 0.3), at(len, LAND - 0.3)]);
                // joints on a fixed grid so they line up along the quay
                if (T.detail) {
                    for (let j = Math.ceil((c0 + 0.3) / 4.5); j * 4.5 < c0 + len - 0.3; j++) S.line([at(j * 4.5 - c0, 0.05), at(j * 4.5 - c0, LAND - 0.3)]);
                }
            }
            if (sun && (ny < 0 || nx > 0)) {
                const sx = sun[0] * LAND, sy = sun[1] * LAND;
                let poly = [[ax, ay], [bx, by], [bx + sx, by + sy], [ax + sx, ay + sy]];
                poly = geo.clipPolygonHalfPlane(poly, [ax, ay], [dx, dy]);
                poly = geo.clipPolygonHalfPlane(poly, [bx, by], [-dx, -dy]);
                const g = groupAt(ax + (dx * len) / 2 + nx, ay + (dy * len) / 2 + ny);
                if (g && poly.length >= 3) g.polys.push(poly);
            }
            for (let j = Math.ceil(c0 / 10); j * 10 < c0 + len; j++) {
                const s = j * 10 - c0 + rng.range(-1.5, 1.5);
                if (s < 1.2 || s > len - 1.2) continue;
                const [x, y] = at(s, 0, 0.3);
                if (!busy(x, y)) bollard(T, x, y, LAND);
            }
        }
    }

    function bollard(T, x, y, z) {
        T.S.lathe(x, y, [[0.14, z], [0.14, z + 0.4], [0.2, z + 0.46], [0.2, z + 0.54], [0, z + 0.56]], 12);
    }

    // Slipway down the quay into the water, with rungs across it
    function slipway(T, xq, y0, y1) {
        const S = T.S, len = 7, top = LAND + 0.03;
        S.kind = INK;
        S.prism([[xq, y0, top], [xq - len, y0, 0.02], [xq - len, y0, -0.25], [xq, y0, top - 0.3]], [0, y1 - y0, 0]);
        const n = Math.round(len / 0.7);
        for (let i = 1; i < n; i++) {
            const t = i / n, x = geo.lerp(xq, xq - len, t), z = geo.lerp(top, 0.02, t);
            S.line([[x, y0 + 0.2, z], [x, y1 - 0.2, z]]);
        }
    }

    // Bridge taking a road along y over the water from y0 to y1, between x = xa
    // and xb. We see its -x side.
    function bridge(T, xa, xb, y0, y1, ground) {
        const F = { P: (a, b, c) => [xa + b, a, c], V: (a, b, c) => [b, a, c] };
        T.S.kind = INK;
        PG.isokit.bridge(T, F, y0, y1, xb - xa, LAND, 0, ground);
    }

    // Shadow of `pts` in another group than the current one, for tall things
    // that throw their shadow off the edge they stand on and out over the water
    function castInto(S, g, pts) {
        if (!g) return;
        const keep = S.shadow;
        S.shadow = g;
        S.castShadow(pts);
        S.shadow = keep;
    }

    // Returns points round the tower to cast its shadow elsewhere with castInto
    function lighthouse(T, x, y, z, rng) {
        const S = T.S, cam = T.cam;
        S.kind = INK;
        const h = rng.range(9, 11), r0 = 1.75, r1 = 1.15;
        S.frustum(x, y, z, z + 0.5, 2.3, 2.3, 32);
        const zt = z + 0.5, zg = zt + h;
        S.frustum(x, y, zt, zg, r0, r1, 32);
        shadeRound(T, x, y, zt, zg, r0, r1);
        S.frustum(x, y, zg, zg + 0.25, r1 + 0.55, r1 + 0.55, 32);
        const zl = zg + 0.25;
        S.frustum(x, y, zl, zl + 1.5, 0.8, 0.8, 24);
        S.frustum(x, y, zl + 1.5, zl + 1.85, 1, 1, 24);
        S.frustum(x, y, zl + 1.85, zl + 2.05, 0.5, 0.5, 16);
        // gallery railing: posts and a rail round the rim
        const rr = r1 + 0.5, face = Math.atan2(-cam.fy, -cam.fx);
        for (let i = 0; i < 16; i++) {
            const a = (TAU * i) / 16, px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
            S.line([[px, py, zl], [px, py, zl + 0.9]]);
        }
        S.loop(ring(32, (c, s) => [x + rr * c, y + rr * s, zl + 0.9]));
        // lantern mullions, then windows and a door facing us
        if (T.detail) {
            for (const da of [-0.9, -0.3, 0.3, 0.9]) {
                const a = face + da;
                S.line([[x + 0.82 * Math.cos(a), y + 0.82 * Math.sin(a), zl], [x + 0.82 * Math.cos(a), y + 0.82 * Math.sin(a), zl + 1.5]]);
            }
        }
        const onTower = (s, c) => {
            const r = geo.lerp(r0, r1, (c - zt) / h) + 0.03, a = face + s / r;
            return [x + r * Math.cos(a), y + r * Math.sin(a), c];
        };
        for (const f of [0.3, 0.62, 0.85]) rect(T, onTower, -0.22, zt + h * f, 0.44, 0.7);
        rect(T, onTower, -0.45, zt, 0.9, 1.9);
        const pts = [];
        for (const [r, c] of [[2.3, z], [r0, zt], [r1 + 0.55, zg + 0.25], [1, zl + 2.05]]) {
            pts.push(...ring(12, (u, v) => [x + r * u, y + r * v, c]));
        }
        return pts;
    }

    // Keep only the part of convex polygon P inside convex polygon Q (anticlockwise)
    function clipConvex(P, Q) {
        let out = P;
        for (let i = 0; i < Q.length && out.length >= 3; i++) {
            const a = Q[i], b = Q[(i + 1) % Q.length];
            out = geo.clipPolygonHalfPlane(out, a, [a[1] - b[1], b[0] - a[0]]);
        }
        return out;
    }

    // Lumpy faceted rock sitting in the water, about s across
    function rock(T, x, y, s, rng) {
        const n = rng.int(5, 7), a0 = rng.range(0, TAU), v = [];
        for (let i = 0; i < n; i++) {
            const a = a0 + ((i + rng.range(-0.3, 0.3)) * TAU) / n, r = s * rng.range(0.75, 1.1);
            v.push([x + r * Math.cos(a), y + r * Math.sin(a), 0]);
        }
        v.push([x + s * rng.range(-0.3, 0.3), y + s * rng.range(-0.3, 0.3), s * rng.range(0.6, 0.95)]);
        const f = [v.slice(0, n).map((_, i) => i)];
        for (let i = 0; i < n; i++) f.push([i, (i + 1) % n, n]);
        T.S.solid(v, f);
    }

    // Lighthouse on its own round stone islet, with rocks round the foot
    function islet(T, isl, rng, water) {
        const S = T.S, { x, y, r } = isl, n = T.segs(r);
        S.kind = INK;
        S.shadow = water;
        S.lathe(x, y, [[r + 0.4, 0], [r, LAND], [r, LAND + 0.12]], n);
        S.loop(ring(n, (c, s) => [x + (r + 0.02) * c, y + (r + 0.02) * s, LAND]));
        // rocks in a heap or two round the foot
        for (let k = rng.int(1, 2); k > 0; k--) {
            const a0 = rng.range(0, TAU);
            for (let i = rng.int(3, 6); i > 0; i--) {
                const a = a0 + rng.range(-0.5, 0.5), d = r + rng.range(0.3, 1.4);
                rock(T, x + d * Math.cos(a), y + d * Math.sin(a), rng.range(0.5, 1.2), rng);
            }
        }
        const top = S.shadowGroup(LAND + 0.12);
        castInto(S, water, lighthouse(T, x, y, LAND + 0.12, rng));
        // the top is round, so trim its shadows to it by hand
        if (top) {
            const disc = ring(24, (c, s) => [x + (r - 0.05) * c, y + (r - 0.05) * s]);
            top.polys = top.polys.map(P => clipConvex(P, disc)).filter(P => P.length >= 3);
        }
        S.shadow = null;
    }

    // Heading for a crane jib out over the water (-x) that runs across the
    // page. Pointed at the camera it foreshortens to a stub.
    const across = (T, rng) => Math.atan2(T.cam.fx, -T.cam.fy) + rng.range(-0.3, 0.3);

    // Harbour crane: a portal on four legs, a machinery house on a turntable,
    // and a lattice jib reaching out at `ang` (radians from +x)
    function crane(T, x, y, z, ang, rng) {
        const S = T.S, W = frame(x, y, z, 0), g = 2.1, t = 0.17, h = rng.range(5, 6.2);
        S.kind = INK;
        for (const [a, b] of [[-g, -g], [g, -g], [g, g], [-g, g]]) S.box(W, a - t, b - t, 0, a + t, b + t, h);
        S.box(W, -g - 0.3, -g - 0.3, h, g + 0.3, g + 0.3, h + 0.55);
        // cross braces on the two sides we see
        for (const [p0, p1] of [[[-g, -g], [g, -g]], [[-g, -g], [-g, g]]]) {
            const A = (u, c) => W.P(p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, c);
            S.line([A(0.08, 0.4), A(0.92, h - 0.3)]);
            S.line([A(0.92, 0.4), A(0.08, h - 0.3)]);
        }
        const zt = z + h + 0.55;
        S.frustum(x, y, zt, zt + 0.3, 1.4, 1.4, T.segs(1.4));
        const F = turned(x, y, zt + 0.3, ang), fp = [-2.4, -1.3, 1.5, 1.3];
        S.box(F, fp[0], fp[1], 0, fp[2], fp[3], 2.6);
        S.box(F, -3.3, -1.1, 0.4, fp[0], 1.1, 1.9);
        const R = gableRoof(T, F, fp, 2.6, true, geo.rad(33), rng, { attic: false });
        shadeGable(T, F, R);
        for (let side = 0; side < 4; side++) {
            windows(T, wall(F, side, fp), { base: 0, floors: 1, style: 'split', winW: 0.75, winH: 0.8, sill: 1.2, gap: 0.8 });
        }
        // lattice jib, pinned low on the front of the house
        const lj = rng.range(13, 18), al = geo.rad(rng.range(30, 52));
        const ca = Math.cos(al), sa = Math.sin(al), n = Math.max(8, Math.round(lj / 1.1));
        const upper = [], lower = [];
        for (let i = 0; i <= n; i++) {
            const s = (lj * i) / n, dp = geo.lerp(0.9, 0.3, i / n) / 2, u = 1.2 + s * ca, c = 0.9 + s * sa;
            upper.push(F.P(u - sa * dp, 0, c + ca * dp));
            lower.push(F.P(u + sa * dp, 0, c - ca * dp));
        }
        S.line(upper);
        S.line(lower);
        if (T.detail) S.line(upper.map((q, i) => (i % 2 ? q : lower[i])));
        // A-frame on the roof with stays to the jib tip and the counterweight
        const tip = upper[n], mast = F.P(-1.2, 0, R.ridge + 2.2);
        S.line([F.P(-1.2, -0.9, R.ridge - 0.4), mast, F.P(-1.2, 0.9, R.ridge - 0.4)]);
        S.line([F.P(-3.3, 0, 1.9), mast, tip]);
        // hook, sometimes with a crate on it
        const hz = rng.range(z + 2.2, Math.max(z + 2.4, tip[2] - 3));
        S.line([tip, [tip[0], tip[1], hz + 0.45]]);
        const hk = frame(tip[0], tip[1], hz, 0);
        S.box(hk, -0.18, -0.12, 0, 0.18, 0.12, 0.45);
        if (rng.chance(0.5) && hz - 2 > 0.6) {
            S.box(hk, -0.55, -0.45, -1.9, 0.55, 0.45, -1.05);
            for (const [a, b] of [[-0.5, -0.4], [0.5, -0.4], [0.5, 0.4], [-0.5, 0.4]]) S.line([hk.P(0, 0, 0), hk.P(a, b, -1.05)]);
        }
    }

    // Someone fishing off the edge, rod out over the water along (dx, dy)
    function angler(T, x, y, z, dx, dy, rng) {
        const S = T.S;
        S.kind = INK;
        person(T, x, y, z, rng);
        const L = rng.range(2.4, 3.2), hand = [x + dx * 0.2, y + dy * 0.2, z + 1.05];
        const tip = [hand[0] + dx * L * 0.85, hand[1] + dy * L * 0.85, hand[2] + L * 0.5];
        S.line([hand, tip]);
        if (T.detail) S.line([tip, [tip[0] + dx * 0.4, tip[1] + dy * 0.4, 0.05]]);
    }

    // ------------------------------------------------------------------
    // Squares
    // ------------------------------------------------------------------

    const tree = withKind(GREEN, kit.roundTree);

    // Town square in place of a block: paving round a fountain, monument or
    // bandstand (or the clock tower), trees along the back with benches under
    // them, and a few carts, tables and people
    function square(T, x0, y0, x1, y1, keys, tower) {
        const { S, p } = T;
        const ins = 0.8, lx0 = x0 + ins, lx1 = x1 - ins, ly0 = y0 + ins, ly1 = y1 - ins;
        if (lx1 - lx0 < 7 || ly1 - ly0 < 10) return;
        const rng = new PG.RNG(hash(...keys, 8));
        S.shadow = null;
        S.kind = INK;
        S.loop([[lx0, ly0, LAND], [lx1, ly0, LAND], [lx1, ly1, LAND], [lx0, ly1, LAND]]);
        S.shadowGroup(LAND, [lx0, ly0, lx1, ly1]);
        const F = frame(lx0, ly1, LAND, 3), w = ly1 - ly0, d = lx1 - lx0, at = (a, b) => F.P(a, b, 0);
        const occ = new Occupancy(w, d);
        const e = 1.3, ca = w / 2, cb = d / 2;
        S.loop([at(e, e), at(w - e, e), at(w - e, d - e), at(e, d - e)]);
        const kind = tower ? 'tower' : rng.weighted([[3, 'fountain'], [2, 'obelisk'], [2, 'bandstand']]);
        const [cx, cy] = at(ca, cb);
        let rad;
        if (kind === 'tower') { clockTower(T, F, ca, cb, rng); rad = 2.3; }
        else if (kind === 'fountain') rad = fountain(T, cx, cy, LAND, rng);
        else if (kind === 'obelisk') rad = obelisk(T, cx, cy, LAND, rng);
        else rad = bandstand(T, cx, cy, LAND, rng);
        occ.add(ca - rad - 0.4, cb - rad - 0.4, ca + rad + 0.4, cb + rad + 0.4);
        const rr = rad + 1.3;
        if (rr < d / 2 - e - 0.3) S.loop(ring(T.segs(rr), (c, s) => at(ca + rr * c, cb + rr * s)));
        // trees along the back, and the front too on a deep square
        const nt = Math.max(2, Math.round((w - 3) / 6));
        for (let i = 0; i < nt; i++) {
            const a = 1.5 + ((w - 3) * (i + 0.5)) / nt;
            for (const b of d > 15 ? [1.7, d - 1.7] : [d - 1.7]) {
                if (!occ.free(a - 0.6, b - 0.6, a + 0.6, b + 0.6, 0)) continue;
                const [x, y] = at(a, b);
                tree(T, x, y, LAND, rng);
                occ.add(a - 0.6, b - 0.6, a + 0.6, b + 0.6);
                if (i % 2 === 0 && b > d / 2 && occ.free(a - 0.9, b - 1.3, a + 0.9, b - 0.7, 0)) {
                    const [bx, by] = at(a, b - 1);
                    bench(T, bx, by, LAND, 3);
                    occ.add(a - 0.9, b - 1.3, a + 0.9, b - 0.7);
                }
            }
        }
        if (rng.chance(p.lamps)) {
            for (const [a, b] of [[0.9, 0.9], [w - 0.9, 0.9]]) {
                const [x, y] = at(a, b);
                lamp(T, x, y, LAND);
                occ.add(a - 0.4, b - 0.4, a + 0.4, b + 0.4);
            }
        }
        if (rng.chance(p.carts)) {
            for (let i = rng.int(1, 3); i > 0; i--) {
                const s = occ.place(rng, 2.1, 1.5, 0.8, 1.2, w - 0.8, d * 0.6);
                if (!s) break;
                const [x, y] = at(s[0] + 1.05, s[1] + 0.75);
                cart(T, x, y, LAND, rng);
            }
        }
        if (rng.chance(p.props)) {
            for (let i = rng.int(1, 3); i > 0; i--) {
                const s = occ.place(rng, 2.2, 2.2, 0.8, 0.8, w - 0.8, d - 0.8);
                if (!s) break;
                const [x, y] = at(s[0] + 1.1, s[1] + 1.1);
                bistro(T, x, y, LAND, rng, rng.chance(0.6));
            }
        }
        const nPeople = Math.round(((w * d) / 45) * p.people * rng.range(0.6, 1.4));
        for (let i = 0; i < nPeople; i++) {
            const s = occ.place(rng, 0.6, 0.6, 0.6, 0.6, w - 0.6, d - 0.6);
            if (!s) continue;
            const [x, y] = at(s[0] + 0.3, s[1] + 0.3);
            person(T, x, y, LAND, rng);
        }
        S.shadow = null;
    }

    // ------------------------------------------------------------------
    // Blocks and lots
    // ------------------------------------------------------------------

    // Everything on one lot: the building on its paved pad, a lamp, hedge and
    // cart out front and clutter in the back yard. Shadows stay inside the lot.
    function lot(T, x0, y0, x1, y1, keys, special) {
        const { S, p } = T;
        const ins = 0.5;
        const lx0 = x0 + ins, lx1 = x1 - ins, ly0 = y0 + ins, ly1 = y1 - ins;
        if (lx1 - lx0 < 3 || ly1 - ly0 < 3) return;
        S.shadow = null;
        S.kind = INK;
        S.loop([[lx0, ly0, LAND], [lx1, ly0, LAND], [lx1, ly1, LAND], [lx0, ly1, LAND]]);
        S.shadowGroup(LAND, [lx0, ly0, lx1, ly1]);
        const F = frame(lx0, ly1, LAND, 3), w = ly1 - ly0, d = lx1 - lx0;
        const rng = new PG.RNG(hash(...keys, 3));
        const occ = new Occupancy(w, d);
        let kind = special.kind;
        if (!kind) {
            kind = rng.weighted([
                [p.houses * 3, 'house'], [w >= 8.5 ? p.houses * 0.7 : 0, 'twin'], [p.houses * 0.6, 'cottage'],
                [w >= 8 && d >= 8 ? p.terraces * 1.5 : 0, 'terrace'],
                [w >= 6.5 && d >= 8 ? p.apartments * 1.5 : 0, 'apartment'],
                [w >= 6.5 && d >= 10 ? p.warehouses * 1.3 : 0, 'warehouse'],
                [w >= 7.5 && d >= 10 ? p.warehouses * 0.9 : 0, 'storehouse'],
                [w >= 8 && d >= 10 ? p.workshops : 0, 'workshop'],
                [w >= 9 && d >= 9 ? p.windmills : 0, 'windmill'],
                [w >= 8 && d >= 9 && special.nearWater ? p.boats * 0.5 : 0, 'boatyard'],
                [w >= 5 ? p.carts * 0.3 : 0, 'carts'],
                [0.04, 'yard'],
            ]);
        }
        const floors = f => Math.max(1, Math.min(p.floors, f));
        let fp = null, info = null;
        const place = (L, D, setback) => {
            // on shallow lots give up some of the front and back yard first
            const back = Math.min(1.5, Math.max(0.6, d - setback - D));
            setback = Math.max(0.9, Math.min(setback, d - back - D));
            L = Math.min(L, w - 1.2);
            D = Math.min(D, d - setback - back);
            if (L < 3.5 || D < 3.5) return null;
            // roughly centred, so neighbouring buildings keep a gap between them
            const room = (w - L) / 2, a = room + rng.range(-1, 1) * Math.max(0, Math.min(1.2, room - 0.6));
            const f = [a, setback, a + L, setback + D];
            occ.add(f[0] - 0.2, f[1] - 0.2, f[2] + 0.2, f[3] + 0.3);
            return f;
        };
        if (kind === 'tower') {
            const a = w / 2, b = Math.min(d / 2, 4);
            info = clockTower(T, F, a, b, rng);
            fp = [a - 1.9, b - 1.9, a + 1.9, b + 1.9];
            occ.add(fp[0], fp[1] - 0.6, fp[2], fp[3]);
            railFence(T, F.P(fp[2] + 0.6, b + 1.6, 0), F.P(Math.min(w - 0.4, fp[2] + 3), b + 1.6, 0), 1.6, true);
        } else if (kind === 'market') {
            fp = place(w - 1.6, Math.min(d - 3, rng.range(7.5, 9)), rng.range(1.6, 2.4));
            if (fp) info = marketHall(T, F, fp, rng);
        } else if (kind === 'boatyard') {
            boatyard(T, F, w, d, rng, occ);
        } else if (kind === 'carts') {
            const n = geo.clamp(Math.floor((w - 0.8) / 2.3), 1, 3), b = rng.range(1.6, Math.max(1.7, d * 0.3));
            for (let i = 0; i < n; i++) {
                const a = (w * (i + 0.5)) / n;
                const [x, y] = F.P(a, b, 0);
                cart(T, x, y, LAND, rng);
                occ.add(a - 1, b - 0.7, a + 1, b + 0.7);
            }
        } else if (kind === 'apartment') {
            fp = place(rng.range(6, 7.5), rng.range(6, 7.5), rng.range(1.8, 2.8));
            if (fp) info = apartment(T, F, fp, rng, { floors: floors(rng.int(3, 4)) });
        } else if (kind === 'warehouse') {
            const stacks = rng.chance(0.3);
            fp = stacks ? place(rng.range(8, 10), rng.range(6, 7), rng.range(1.8, 2.8)) : place(rng.range(6, 7.5), rng.range(8, 10), rng.range(1.8, 2.8));
            if (fp) info = warehouse(T, F, fp, rng, { stacks });
        } else if (kind === 'workshop') {
            fp = place(rng.range(7.5, 9.5), rng.range(7.5, 9.5), rng.range(1.8, 2.8));
            if (fp) info = workshop(T, F, fp, rng);
        } else if (kind === 'terrace') {
            fp = place(w - 1.2, rng.range(6.5, 8.5), rng.range(1.4, 2.2));
            if (fp) info = terrace(T, F, fp, rng, { floors: p.floors });
        } else if (kind === 'storehouse') {
            fp = place(rng.range(7, 8.5), rng.range(8.5, 10), rng.range(1.6, 2.4));
            if (fp) info = storehouse(T, F, fp, rng, { floors: p.floors });
        } else if (kind === 'silos') {
            fp = place(w - 1.6, rng.range(4.2, 5), rng.range(2, 3));
            if (fp) info = silos(T, F, fp, rng);
        } else if (kind === 'church') {
            fp = place(Math.min(w - 1.2, rng.range(8.5, 10)), d - 2.2, 1.2);
            if (fp) info = church(T, F, fp, rng);
        } else if (kind === 'windmill') {
            const a = w * rng.range(0.4, 0.6), b = Math.min(d - 4, rng.range(4.5, 6.5));
            const [x, y] = F.P(a, b, 0);
            // sails on whichever side of the tower faces the camera most
            const face = [0, 1, 2, 3].sort((i, j) => DIRS[i][0] * T.cam.fx + DIRS[i][1] * T.cam.fy - (DIRS[j][0] * T.cam.fx + DIRS[j][1] * T.cam.fy));
            windmill(T, x, y, LAND, rng.chance(0.7) ? face[0] : face[1], rng);
            fp = [a - 2.6, b - 2.6, a + 2.6, b + 2.6];
            info = { doors: [2.6], awning: null };
            occ.add(a - 3.4, b - 3.4, a + 3.4, b + 3.4);
        } else if (kind !== 'yard') {
            const cottage = kind === 'cottage', twin = kind === 'twin';
            fp = cottage ? place(rng.range(5, 6.2), rng.range(4.5, 5.5), rng.range(2, 3))
                : place(twin ? rng.range(8, 9.5) : rng.range(5.8, 7.4), rng.range(5.2, 6.4), rng.range(1.8, 2.8));
            if (fp) {
                info = house(T, F, fp, rng, {
                    floors: floors(cottage ? 1 : twin ? 2 : rng.weighted([[1, 1], [6, 2], [2, 3]])),
                    twin, awning: !cottage && rng.chance(p.awnings),
                });
            }
        }
        // the paved pad the building stands on, showing in front of it
        const pad = fp && kind !== 'tower' && kind !== 'market' && kind !== 'windmill' ? Math.max(0.35, fp[1] - 1.4) : null;
        if (pad !== null) {
            S.kind = INK;
            S.loop([F.P(fp[0] - 0.4, pad, 0), F.P(fp[2] + 0.4, pad, 0), F.P(fp[2] + 0.4, fp[3] + 0.4, 0), F.P(fp[0] - 0.4, fp[3] + 0.4, 0)]);
        }
        dress(T, F, w, d, occ, fp, info, pad, keys);
        S.shadow = null;
    }

    // Boatyard: a hull up on trestles, a tank on a cradle, crates and a barrel
    function boatyard(T, F, w, d, rng, occ) {
        const S = T.S;
        S.kind = INK;
        const L = Math.min(w - 1.6, rng.range(6.5, 8)), B = rng.range(2.1, 2.5);
        const a = w / 2, b = geo.clamp(d * rng.range(0.4, 0.5), B / 2 + 1.2, d - B / 2 - 1);
        for (const s of [-L * 0.25, L * 0.25]) S.box(F, a + s - 0.12, b - B * 0.5, 0, a + s + 0.12, b + B * 0.5, 0.75);
        const [x, y, z] = F.P(a, b, 0.75);
        hullSolid(T, frame(x, y, z, 3), L, B, 1.05, 0.35, false);
        occ.add(a - L / 2 - 0.3, b - B / 2 - 0.4, a + L / 2 + 0.3, b + B / 2 + 0.4);
        const spot = occ.place(rng, 3.2, 1.8, 0.4, 0.4, w - 0.4, d - 0.4);
        if (spot) {
            const r = 0.62, ta = spot[0] + 0.3, tb = spot[1] + 0.9, zc = 0.3 + r;
            S.prism(ring(16, (c, s) => F.P(ta, tb + r * c, zc + r * s)), F.V(2.6, 0, 0), true);
            for (const s of [0.45, 2.15]) S.box(F, ta + s - 0.1, tb - r * 0.75, 0, ta + s + 0.1, tb + r * 0.75, zc - r * 0.55);
        }
        const c = occ.place(rng, 2.2, 1.4, 0.4, 0.4, w - 0.4, d - 0.4);
        if (c) crates(T, F, c[0], c[1], rng);
    }

    // Lamp by the street, a hedge on the front of the pad, a cart beside the
    // building, bikes under an awning, a table out the side, and a washing
    // line, fence, crates or bikes out the back
    function dress(T, F, w, d, occ, fp, info, pad, keys) {
        const { S, p } = T;
        const r = new PG.RNG(hash(...keys, 6));
        S.kind = INK;
        const at = (a, b) => F.P(a, b, 0);
        if (r.chance(p.lamps)) {
            const a = r.chance(0.5) ? 0.45 : w - 0.45;
            const [x, y] = at(a, 0.45);
            lamp(T, x, y, LAND);
            occ.add(a - 0.35, 0, a + 0.35, 0.9);
        }
        if (pad !== null && r.chance(p.hedges)) {
            const len = r.range(1.8, 2.8), door = fp[0] + (info ? info.doors[0] : 0), b = pad + 0.15;
            const opts = [[fp[0] - 0.3, door - 0.8], [door + 0.8, fp[2] + 0.3]].filter(([u0, u1]) => u1 - u0 >= len);
            if (opts.length) {
                const [u0, u1] = r.pick(opts), a = r.range(u0, u1 - len);
                if (occ.free(a, b - 0.35, a + len, b + 0.35, 0)) {
                    hedge(T, F, a, a + len, b, 0.7);
                    occ.add(a, b - 0.35, a + len, b + 0.35);
                }
            }
        }
        if (fp && r.chance(p.carts)) {
            // beside the building, or out front when there is room
            const spots = [];
            if (w - fp[2] >= 2.3) spots.push([fp[2] + 1.2, fp[1] + r.range(0.2, 1.2)]);
            if (fp[0] >= 2.3) spots.push([fp[0] - 1.2, fp[1] + r.range(0.2, 1.2)]);
            if (pad !== null && pad >= 1.6) spots.push([r.range(1.2, w - 1.2), pad - 0.9]);
            for (const [a, b] of r.shuffle(spots)) {
                if (!occ.free(a - 0.95, b - 0.65, a + 0.95, b + 0.65, 0.05)) continue;
                const [x, y] = at(a, b);
                cart(T, x, y, LAND, r);
                occ.add(a - 0.95, b - 0.65, a + 0.95, b + 0.65);
                break;
            }
        }
        if (info && info.awning && r.chance(0.7)) {
            const [a0, a1] = info.awning, b = fp[1] - 0.7;
            for (let a = a0 + 0.5; a < a1 - 0.3; a += 0.75) {
                if (!occ.free(a - 0.3, b - 0.5, a + 0.3, b + 0.5, 0)) continue;
                const [x, y] = at(a, b);
                bike(T, x, y, LAND, 0, r, false);
            }
        }
        if (fp && r.chance(p.props * 0.35)) {
            const spot = occ.place(r, 2.2, 2.2, 0.3, fp[1] - 0.5, w - 0.3, d - 0.3, 6);
            if (spot) {
                const [x, y] = at(spot[0] + 1.1, spot[1] + 1.1);
                bistro(T, x, y, LAND, r, r.chance(0.7));
            }
        }
        // back yard
        const back = fp ? fp[3] + 0.8 : 0.8;
        const nProps = Math.round((w * d) / (fp ? 45 : 18) * p.props * r.range(0.6, 1.4));
        for (let i = 0; i < nProps; i++) {
            const kind = r.weighted([[3, 'line'], [2, 'crates'], [2, 'fence'], [1, 'trellis'], [1.5, 'bikes'], [1, 'bench'], [p.people * 2, 'person']]);
            const size = { line: [3.2, 1], crates: [2.2, 1.4], fence: [3, 0.4], trellis: [2.4, 0.4], bikes: [1.8, 1.2], bench: [1.8, 0.9], person: [0.6, 0.6] }[kind];
            const spot = occ.place(r, size[0], size[1], 0.3, Math.min(back, d - size[1] - 0.3), w - 0.3, d - 0.2, 8);
            if (!spot) continue;
            const [a, b] = spot, ca = a + size[0] / 2, cb = b + size[1] / 2;
            if (kind === 'line') clothesline(T, F, a + 0.1, cb, size[0] - 0.2, r);
            else if (kind === 'crates') crates(T, F, a, b, r);
            else if (kind === 'fence') railFence(T, at(a, cb), at(a + size[0], cb), 1.05);
            else if (kind === 'trellis') railFence(T, at(a, cb), at(a + size[0], cb), 1.5, true);
            else if (kind === 'bikes') {
                for (let k = 0; k < 2; k++) {
                    const [x, y] = at(a + 0.5 + k * 0.8, cb);
                    bike(T, x, y, LAND, 0, r, false);
                }
            } else if (kind === 'bench') {
                const [x, y] = at(ca, cb);
                bench(T, x, y, LAND, 3);
            } else {
                const [x, y] = at(ca, cb);
                person(T, x, y, LAND, r);
            }
        }
    }

    // A block: rows of lots, all facing the street on the camera side
    function block(T, x0, y0, x1, y1, keys, special) {
        const rng = new PG.RNG(hash(...keys, 1));
        const m = 0.3, ix0 = x0 + m, ix1 = x1 - m, iy0 = y0 + m, iy1 = y1 - m;
        const D = ix1 - ix0, W = iy1 - iy0;
        const split = (total, n) => {
            const w = Array.from({ length: n }, () => rng.range(0.85, 1.15));
            const s = w.reduce((u, v) => u + v, 0);
            return w.map(v => (v * total) / s);
        };
        const rows = D >= 24 ? split(D, 2) : [D];
        let x = ix0;
        rows.forEach((depth, r) => {
            const widths = split(W, geo.clamp(Math.round(W / rng.range(10.5, 13)), 1, 8));
            const kinds = widths.map(() => null);
            if (r === 0 && special.market && widths.length >= 2) {
                const i = rng.int(0, widths.length - 2);
                widths.splice(i, 2, widths[i] + widths[i + 1]);
                kinds.splice(i, 2, 'market');
            }
            if (r === 0 && special.tower) kinds[Math.floor(widths.length / 2)] = 'tower';
            if (r === 0 && special.church) {
                // on a lot wide enough, taking in the next one if it has to
                const mid = (widths.length - 1) / 2;
                let i = kinds.reduce((best, k, j) => (!k && (best < 0 || Math.abs(j - mid) < Math.abs(best - mid)) ? j : best), -1);
                if (i >= 0 && widths[i] < 11 && i + 1 < widths.length && !kinds[i + 1]) {
                    widths.splice(i, 2, widths[i] + widths[i + 1]);
                    kinds.splice(i, 2, null);
                }
                if (i >= 0) kinds[i] = 'church';
            }
            if (r === 0 && special.silos) {
                const i = kinds.findIndex((k, j) => !k && j + 1 < kinds.length && !kinds[j + 1]);
                if (i >= 0) {
                    widths.splice(i, 2, widths[i] + widths[i + 1]);
                    kinds.splice(i, 2, 'silos');
                }
            }
            // lots run along u, which is -y
            let y = iy1;
            widths.forEach((wd, i) => {
                lot(T, x, y - wd, x + depth, y, [...keys, r * 16 + i], { kind: kinds[i], nearWater: special.nearWater && r === 0 });
                y -= wd;
            });
            x += depth;
        });
    }

    const WALK = 3; // path along each side of a canal (m)

    // The town is rows of blocks up from the quay. Through streets run all the
    // way up, and each row gets its own streets in between, so with `irregular`
    // up the rows stop lining up. Returns each row's blocks as y ranges.
    function streetPlan(T, rng, x0, nRows, Y0, Y1) {
        const p = T.p, bw = p.blockW, st = p.street, irr = p.irregular, PX = p.blockD + p.avenue;
        const mains = [];
        // up to three blocks apart, and one past the far end so the last blocks close off
        for (let y = Y0 - rng.range(0, bw + st); ; ) {
            mains.push(y);
            if (y > Y1 + bw + st) break;
            y += rng.weighted([[1.2 - irr, 1], [irr * 1.5, 2], [irr * 0.6, 3]]) * (bw + st) * (1 + irr * rng.range(-0.12, 0.12));
        }
        const rows = [];
        for (let i = 0; i <= nRows; i++) {
            const cuts = [];
            for (let k = 0; k < mains.length; k++) {
                cuts.push({ y: mains[k], w: st });
                if (k + 1 === mains.length) break;
                const span = mains[k + 1] - mains[k];
                let n = Math.round(span / (bw + st));
                if (rng.chance(irr * 0.45)) n += rng.pick([-1, 1]);
                n = Math.max(1, Math.min(n, Math.floor(span / 20)));
                // the odd one is a narrow alley
                for (let q = 1; q < n; q++) {
                    cuts.push({ y: mains[k] + (span * (q + irr * rng.range(-0.25, 0.25))) / n, w: rng.chance(irr * 0.25) ? Math.max(3.5, st * 0.55) : st });
                }
            }
            const blocks = [];
            for (let k = 0; k + 1 < cuts.length; k++) blocks.push([cuts[k].y + cuts[k].w / 2, cuts[k + 1].y - cuts[k + 1].w / 2]);
            rows.push({ i, x: x0 + i * PX, blocks });
        }
        return { mains, rows };
    }

    // y ranges less [y0, y1], dropping scraps too short to build on
    const cutSpans = (spans, y0, y1) => spans
        .flatMap(([a, b]) => (b <= y0 || a >= y1 ? [[a, b]] : [[a, Math.min(b, y0)], [Math.max(a, y1), b]]))
        .filter(([a, b]) => b - a > 8);

    // Rectangles less rectangle c
    function subtract(rects, c) {
        const out = [];
        for (const r of rects) {
            if (!overlaps(r, c)) { out.push(r); continue; }
            if (c[0] > r[0]) out.push([r[0], r[1], c[0], r[3]]);
            if (c[2] < r[2]) out.push([c[2], r[1], r[2], r[3]]);
            const x0 = Math.max(r[0], c[0]), x1 = Math.min(r[2], c[2]);
            if (c[1] > r[1]) out.push([x0, r[1], x1, c[1]]);
            if (c[3] < r[3]) out.push([x0, c[3], x1, r[3]]);
        }
        return out.filter(r => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5);
    }

    // The quay road: a crane or two, lamps and benches, a van, people on foot
    // and on bikes. `pieces` are the bits of road left between the canals and
    // the dock.
    function quayRoad(T, pieces, busy, xq, ya, yb, seed) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(seed, 60));
        S.kind = INK;
        const groups = pieces.map(r => [r, S.shadowGroup(LAND, r)]);
        const find = (x0, y0, x1, y1) => groups.find(([r]) => r[0] <= x0 && r[1] <= y0 && r[2] >= x1 && r[3] >= y1);
        const cranes = [];
        const nCranes = rng.chance(p.wharves) ? rng.int(1, 2) : 0;
        for (let tries = 0; tries < 12 && cranes.length < nCranes; tries++) {
            const y = geo.lerp(ya, yb, rng.range(0.15, 0.85)), x = xq + 3;
            const hit = find(x - 2.5, y - 2.6, x + 2.5, y + 2.6);
            if (!hit || busy(x, y - 3) || busy(x, y + 3) || cranes.some(c => Math.abs(c - y) < 25)) continue;
            S.shadow = hit[1];
            crane(T, x, y, LAND, across(T, rng), rng);
            cranes.push(y);
        }
        const clear = (x, y) => !busy(x, y) && !cranes.some(c => Math.abs(c - y) < 3.5);
        for (const [r, g] of groups) {
            if (r[2] - r[0] < 3) continue;
            S.shadow = g;
            for (let y = r[1] + rng.range(2, 10); y < r[3] - 1; y += rng.range(16, 24)) {
                if (rng.chance(p.lamps) && clear(r[2] - 1.1, y)) lamp(T, r[2] - 1.1, y, LAND);
                if (rng.chance(p.props * 0.5) && y + 6 < r[3] && clear(r[0] + 1, y + 5)) bench(T, r[0] + 1, y + 5, LAND, 1);
            }
        }
        if (rng.chance(0.3 + 0.6 * p.people)) {
            for (let tries = 0; tries < 6; tries++) {
                const x = xq + p.avenue * 0.55, y = geo.lerp(ya, yb, rng.range(0.2, 0.8));
                const hit = find(x - 1.1, y - 3, x + 1.1, y + 3);
                if (!hit || !clear(x, y - 3) || !clear(x, y + 3)) continue;
                S.shadow = hit[1];
                car(T, x, y, LAND, rng.pick([1, 3]), rng, true, 'van');
                break;
            }
        }
        const walkers = Math.round(((yb - ya) / 40) * p.people * rng.range(0.5, 1.5));
        for (let i = 0; i < walkers; i++) {
            const y = rng.range(ya, yb), x = rng.range(xq + 1.5, xq + p.avenue - 2);
            const hit = find(x - 0.5, y - 0.8, x + 0.5, y + 0.8);
            const bikeRider = rng.chance(0.4);
            if (!hit || !clear(x, y)) continue;
            S.shadow = hit[1];
            if (bikeRider) bike(T, x, y, LAND, rng.pick([1, 3]), rng, true);
            else person(T, x, y, LAND, rng);
        }
        S.shadow = null;
    }

    // What goes along the quay and out on the water. Canal mouths and the dock
    // entrance are already in `taken`. The breakwater and wharves join the
    // shore as moles.
    function planWater(T, shore, taken, xq, ya, yb, seed) {
        const { p } = T;
        const rng = new PG.RNG(hash(seed, 50));
        const free = (y0, y1) => !taken.some(([t0, t1]) => y0 < t1 && y1 > t0);
        // stretches where anything off the quay has to stop short of x
        const reach = [];
        const room = (y0, y1) => reach.reduce((m, r) => (y0 < r.y1 && y1 > r.y0 ? Math.min(m, xq - r.x) : m), Infinity);
        const W = { bw: null, island: null, wharves: [], slip: null, piers: [], dinghies: [], buoys: [], boats: [] };
        if (p.lighthouse) {
            const type = p.breakwater === 'any' ? rng.weighted([[3, 'straight'], [2.2, 'bent'], [1.6, 'island']]) : p.breakwater;
            if (type === 'island') {
                for (let tries = 0; tries < 16 && !W.island; tries++) {
                    const x = xq - rng.range(26, 46), y = geo.lerp(ya, yb, rng.range(0.1, 0.6)), r = rng.range(5, 6.5);
                    if (T.onPage(x, y, LAND + 15, -4) && T.onPage(x, y - r, 0, -6) && T.onPage(x + r, y, 0, -6)) {
                        W.island = { x, y, r };
                        reach.push({ y0: y - r - 8, y1: y + r + 8, x: x + r + 6 });
                    }
                }
            } else {
                // straight out from the quay, or out and then turning up along it
                const w = 5.5, bent = type === 'bent';
                for (let tries = 0; tries < 12 && !W.bw; tries++) {
                    const y = geo.lerp(ya, yb, rng.range(0.1, bent ? 0.3 : 0.4));
                    let len = rng.range(24, 34), arm = bent ? rng.range(16, 32) : 0;
                    const tip = () => (bent ? [xq - len + w / 2, y + w / 2 + arm - 2.8] : [xq - len + 2.8, y]);
                    // short enough for the lighthouse to show
                    while (len > 10 && !T.onPage(...tip(), LAND + 14, -4)) {
                        if (arm > 10) arm -= 2;
                        else len -= 2;
                    }
                    if (len > 10 && T.onPage(...tip(), LAND, -4)) W.bw = { y, len, arm, w, tip: tip() };
                }
                if (W.bw) {
                    const { y, len, arm } = W.bw;
                    W.bw.rect = arm ? [xq - len, y - w / 2, xq - len + w, y + w / 2 + arm] : [xq - len, y - w / 2, xq, y + w / 2];
                    shore.moles.push([xq - len, y - w / 2, xq, y + w / 2]);
                    if (arm) {
                        shore.moles.push(W.bw.rect);
                        reach.push({ y0: y + w / 2, y1: y + w / 2 + arm + 6, x: xq - len + w + 6 });
                    }
                    taken.push([y - 8, y + 8]);
                }
            }
        }
        // stone wharves sticking out into the harbour
        const nw = rng.chance(p.wharves) ? (rng.chance(p.wharves * 0.5) ? 2 : 1) : 0;
        for (let tries = 0; tries < 24 && W.wharves.length < nw; tries++) {
            const wd = rng.range(16, 28), y0 = geo.lerp(ya, yb, rng.random()) - wd / 2, y1 = y0 + wd;
            const dep = Math.min(rng.range(9, 15), room(y0 - 4, y1 + 4) - 8);
            if (dep < 8 || y0 < ya + 8 || y1 > yb - 8 || !free(y0 - 7, y1 + 7) || !T.onPage(xq - dep, (y0 + y1) / 2, LAND, -6)) continue;
            const r = [xq - dep, y0, xq, y1];
            W.wharves.push(r);
            shore.moles.push(r);
            taken.push([y0 - 7, y1 + 7]);
        }
        if (rng.chance(0.7)) {
            const y = geo.lerp(ya, yb, rng.range(0.3, 0.9));
            if (free(y - 4, y + 4)) {
                W.slip = [y - 1.8, y + 1.8];
                taken.push([y - 5, y + 5]);
            }
        }
        const nPiers = Math.round(((yb - ya) / 45) * p.piers * 2);
        for (let i = 0, tries = 0; i < nPiers && tries < 40; tries++) {
            const y = geo.lerp(ya, yb, rng.random());
            const kind = rng.weighted([[3, 'plain'], [1.5, 'T'], [1.2, 'L'], [1.2, 'marina']]);
            const pr = { y, kind, len: rng.range(14, 24), wid: rng.range(2.4, 3.1), hd: rng.range(3.2, 4.2), side: rng.sign(), fwd: rng.sign() };
            pr.e0 = y - 9;
            pr.e1 = y + 9;
            if (kind === 'T') {
                const hl = rng.range(6, 10);
                pr.head = [y - hl, y + hl];
            } else if (kind === 'L') {
                const hl = rng.range(8, 13);
                pr.head = pr.side > 0 ? [y - pr.wid / 2, y + pr.wid / 2 + hl] : [y - pr.wid / 2 - hl, y + pr.wid / 2];
            } else if (kind === 'marina') {
                pr.fl = rng.range(5, 6);
                pr.wid = 2;
            }
            if (pr.head) {
                pr.e0 = Math.min(pr.e0, pr.head[0] - 5);
                pr.e1 = Math.max(pr.e1, pr.head[1] + 5);
            }
            pr.len = Math.min(pr.len, room(pr.e0, pr.e1) - (pr.head ? pr.hd + 4 : 3));
            if (pr.len < 9 || !free(pr.e0, pr.e1) || !T.onPage(xq - pr.len / 2, y, 1)) continue;
            taken.push([pr.e0, pr.e1]);
            W.piers.push(pr);
            i++;
        }
        // a couple of dinghies tied up at the quay, and buoys out in the open
        for (let i = 0; i < 3; i++) {
            const y = geo.lerp(ya, yb, rng.random());
            if (!free(y - 3, y + 3) || !rng.chance(p.boats)) continue;
            taken.push([y - 3, y + 3]);
            W.dinghies.push([y, rng.pick([1, 3])]);
        }
        const clearOf = (x, y, m) => !W.island || Math.hypot(x - W.island.x, y - W.island.y) > W.island.r + m;
        const nBuoys = rng.int(1, 3);
        for (let i = 0; i < nBuoys; i++) {
            const x = xq - rng.range(28, 48), y = geo.lerp(ya, yb, rng.random());
            if (T.onPage(x, y, 0, -8) && shore.water(x, y, 4) && clearOf(x, y, 4)) W.buoys.push([x, y]);
        }
        // boats heading in or out, clear of everything else
        const nb = rng.chance(0.3 + 0.5 * p.boats) ? rng.int(1, 2) : 0;
        for (let tries = 0; tries < 30 && W.boats.length < nb; tries++) {
            const x = xq - rng.range(20, 70), y = geo.lerp(ya - 30, yb + 30, rng.random()), ang = rng.range(0, TAU);
            if (!T.onPage(x, y, 0, -12) || !shore.open(x, y, 16) || !clearOf(x, y, 18)) continue;
            if (W.boats.some(b => Math.hypot(b[0] - x, b[1] - y) < 30) || W.buoys.some(b => Math.hypot(b[0] - x, b[1] - y) < 8)) continue;
            if (W.piers.some(pr => y + 14 > pr.e0 && y - 14 < pr.e1 && x > xq - pr.len - 18)) continue;
            W.boats.push([x, y, ang]);
        }
        return W;
    }

    // Stone wharf out in the harbour: a crane on the front, a harbour office
    // or cargo, and boats along the sides we can see
    function wharf(T, r, rng, water) {
        const { S, p } = T;
        const [x0, y0, x1, y1] = r;
        const kinds = [[3, 'fishing'], [1.5, 'launch'], [1, 'row']];
        S.kind = INK;
        S.shadow = water;
        moorRow(T, [x0, y0 + 1], [x0, y1], [-1, 0], null, rng, kinds);
        moorRow(T, [x1 - 1.5, y0], [x0, y0], [0, -1], null, rng, kinds, 2);
        S.shadowGroup(LAND, r);
        // v runs in from the front edge
        const F = frame(x0, y1, LAND, 3), w = y1 - y0, d = x1 - x0;
        const occ = new Occupancy(w, d);
        const ca = rng.range(3.5, w - 3.5), cb = 2.9;
        const [cx, cy] = F.P(ca, cb, 0);
        crane(T, cx, cy, LAND, across(T, rng), rng);
        occ.add(ca - 2.6, cb - 2.6, ca + 2.6, cb + 2.6);
        if (d >= 10 && rng.chance(0.6)) {
            const L = rng.range(4.2, 5.2), a = rng.chance(0.5) ? 0.8 : w - 0.8 - L, fp = [a, d - 4.6, a + L, d - 0.9];
            if (occ.free(fp[0], fp[1] - 1, fp[2], fp[3], 0.2)) {
                house(T, F, fp, rng, { floors: 1, twin: false, awning: false });
                occ.add(fp[0] - 0.3, fp[1] - 1, fp[2] + 0.3, fp[3]);
            }
        }
        for (let i = rng.int(1, 3); i > 0; i--) {
            const s = occ.place(rng, 2.2, 1.4, 0.5, 0.5, w - 0.5, d - 0.5);
            if (s) crates(T, F, s[0], s[1], rng);
        }
        const n = Math.round(rng.range(0.5, 2.5) * p.people * 2);
        for (let i = 0; i < n; i++) {
            const a = rng.range(1, w - 1);
            if (!occ.free(a - 0.4, 0.3, a + 0.4, 1.1, 0)) continue;
            const [x, y] = F.P(a, 0.7, 0);
            angler(T, x, y, LAND, -1, 0, rng);
            occ.add(a - 0.4, 0.3, a + 0.4, 1.1);
        }
        S.shadow = null;
    }

    // Piers, boats, the lighthouse and wharves. Returns the patches of water
    // the wakes cover.
    function drawWater(T, W, xq, water, seed) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(seed, 52));
        S.kind = INK;
        S.shadow = null;
        if (W.slip) slipway(T, xq, W.slip[0], W.slip[1]);
        S.shadow = water;
        for (const pr of W.piers) {
            if (pr.kind === 'marina') marina(T, xq, pr, rng);
            else pier(T, xq, pr, rng);
        }
        for (const [y, dir] of W.dinghies) boat(T, xq - 1.2, y, dir, rng, 'row');
        for (const [x, y] of W.buoys) buoy(T, x, y);
        S.shadow = water;
        const wakes = W.boats.map(([x, y, ang]) => underway(T, x, y, ang, rng));
        for (const r of W.wharves) wharf(T, r, rng, water);
        if (W.island) islet(T, W.island, rng, water);
        if (W.bw) {
            const { tip, rect } = W.bw;
            S.shadowGroup(LAND, rect);
            castInto(S, water, lighthouse(T, tip[0], tip[1], LAND, rng));
            // someone fishing off the side we can see
            for (let i = 0; i < 2; i++) {
                if (!rng.chance(0.3 + p.people)) continue;
                const long = rect[2] - rect[0] > rect[3] - rect[1];
                const x = long ? rng.range(rect[0] + 6, rect[2] - 3) : rect[0] + 0.6;
                const y = long ? rect[1] + 0.6 : rng.range(rect[1] + 3, tip[1] - 4);
                if (long) angler(T, x, y, LAND, 0, -1, rng);
                else angler(T, x, y, LAND, -1, 0, rng);
            }
        }
        S.shadow = null;
        return wakes;
    }

    // Boats tied up in the canals and the dock, lamps and trees along the
    // canal sides, a crane on the back of the dock
    function waterways(T, canals, basin, bridges, groupAt, xq, x1, seed) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(seed, 80));
        S.kind = INK;
        // stretches of [a, b] along x clear of the bridges over y0..y1
        const clear = (a, b, y0, y1) => {
            let out = [[a, b]];
            for (const br of bridges) {
                if (br.y1 <= y0 || br.y0 >= y1) continue;
                out = out.flatMap(([u, v]) => (br.xb + 0.8 <= u || br.xa - 0.8 >= v ? [[u, v]] : [[u, br.xa - 0.8], [br.xb + 0.8, v]]));
            }
            return out.filter(([u, v]) => v - u > 2);
        };
        const small = [[3, 'row'], [2, 'launch']];
        for (const c of canals) {
            S.shadow = groupAt((c.rect[0] + c.rect[2]) / 2, (c.y0 + c.y1) / 2);
            for (const [u, v] of clear(xq + 0.5, c.xe - 0.4, c.y0, c.y1)) {
                moorRow(T, [v, c.y1], [u, c.y1], [0, -1], null, rng, small);
                moorRow(T, [v, c.y0], [u, c.y0], [0, 1], null, rng, small);
            }
            // lamps down both sides, trees on the far one (on the near side they'd hide the canal)
            for (const side of [1, -1]) {
                const edge = side > 0 ? c.y1 : c.y0;
                S.shadowGroup(LAND, side > 0 ? [xq, c.y1, c.xe, c.y1 + WALK] : [xq, c.y0 - WALK, c.xe, c.y0]);
                for (const [u, v] of clear(x1 + 1, c.xe - 1, c.y0 - WALK, c.y1 + WALK)) {
                    const n = Math.max(1, Math.round((v - u) / 6.5));
                    for (let i = 0; i < n; i++) {
                        const x = u + ((v - u) * (i + 0.5)) / n;
                        if (side > 0 && i % 3 !== 1) tree(T, x, edge + 1.5, LAND, rng);
                        else if (i % 2 === (side > 0 ? 1 : 0) && rng.chance(p.lamps)) lamp(T, x, edge + side * 0.6, LAND);
                    }
                }
            }
            S.shadow = null;
            S.kind = INK;
            railFence(T, [c.xe + 0.35, c.y0 + 0.3, LAND], [c.xe + 0.35, c.y1 - 0.3, LAND], 1);
        }
        if (basin) {
            const [bx0, by0, bx1, by1] = basin.rect, kinds = [[3, 'fishing'], [2, 'launch'], [1, 'row']];
            S.shadow = groupAt((bx0 + bx1) / 2, (by0 + by1) / 2);
            moorRow(T, [bx1, by0 + 4], [bx1, by1 - 4], [-1, 0], null, rng, kinds);
            moorRow(T, [bx1 - 4.5, by1], [bx0 + 0.5, by1], [0, -1], null, rng, kinds);
            moorRow(T, [bx1 - 4.5, by0], [bx0 + 0.5, by0], [0, 1], null, rng, kinds);
            // crane on the back quay, reaching out over the dock
            const back = [bx1, by0, bx1 + 5, by1];
            S.shadowGroup(LAND, back);
            const y = geo.lerp(by0 + 4, by1 - 4, rng.random());
            crane(T, bx1 + 2.6, y, LAND, across(T, rng), rng);
            for (let yy = by0 + 3; yy < by1 - 2; yy += rng.range(5, 8)) {
                if ((yy < y - 2.6 || yy - 2.4 > y + 2.6) && rng.chance(p.props)) crates(T, frame(bx1 + 1, yy, LAND, 3), 0, 0, rng);
            }
            S.shadow = null;
        }
    }

    // Rows of short dashes across the open water, in page space like a
    // printed map, left out where they'd touch anything
    function waterMarks(T, shore, groups, wakes, seed) {
        const { S, cam } = T;
        const rng = new PG.RNG(hash(seed, 70));
        const rowGap = 5.2, colGap = 15, dash = 4;
        const shaded = (x, y) => groups.some(g => (!g.clip || inRect(g.clip, x, y)) && g.polys.some(P => geo.pointInPolygon(x, y, P)));
        const inWake = (x, y) => wakes.some(P => geo.pointInPolygon(x, y, P));
        S.kind = WATER;
        for (let row = 0, sy = rowGap * 0.6; sy < S.H; row++, sy += rowGap) {
            const off = (row % 2 ? colGap / 2 : 0) + rng.range(-2, 2);
            for (let sx = off - colGap; sx < S.W + colGap; sx += colGap) {
                const cx = sx + rng.range(-0.18, 0.18) * colGap, len = dash * rng.range(0.75, 1.2);
                const [x, y] = cam.ground(cx, sy, 0);
                const a = cam.ground(cx - len / 2, sy, 0), b = cam.ground(cx + len / 2, sy, 0);
                if (!shore.water(x, y, 1.2) || !shore.water(a[0], a[1], 0.6) || !shore.water(b[0], b[1], 0.6)) continue;
                if (shaded(x, y) || inWake(x, y)) continue;
                S.line([[a[0], a[1], 0], [b[0], b[1], 0]], true);
            }
        }
        S.kind = INK;
    }

    function buildHarbour(T, seed) {
        const { S, p, cam } = T;
        const ph = new PG.RNG(hash(seed, 99));
        // the quay meets the left edge of the page `shore` of the way down
        const xq = cam.ground(0, p.shore * S.H, LAND)[0];
        const bd = p.blockD, av = p.avenue;
        // the ground the page shows, with room below it for tall things
        const tall = 14 * cam.ce * cam.k;
        const pts = [];
        for (const z of [0, LAND]) {
            for (const [sx, sy] of [[0, 0], [S.W, 0], [S.W, S.H + tall], [0, S.H + tall]]) pts.push(cam.ground(sx, sy, z));
        }
        const X1 = Math.max(...pts.map(q => q[0]));
        const Y0 = Math.min(...pts.map(q => q[1])), Y1 = Math.max(...pts.map(q => q[1]));
        const pad = 12;
        const seen = (x0, y0, x1, y1, h) => {
            let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
            for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
                for (const z of [LAND, LAND + h]) {
                    const q = cam.project(x, y, z);
                    a = Math.min(a, q[0]); c = Math.max(c, q[0]); b = Math.min(b, q[1]); e = Math.max(e, q[1]);
                }
            }
            return c > -pad && e > -pad && a < S.W + pad && b < S.H + pad;
        };
        T.onPage = (x, y, z, m = 0) => {
            const q = cam.project(x, y, z);
            return q[0] > -m && q[1] > -m && q[0] < S.W + m && q[1] < S.H + m;
        };
        // where the quay crosses the page
        let ya = Infinity, yb = -Infinity;
        for (let y = Y0 - 20; y <= Y1 + 20; y += 1) {
            if (T.onPage(xq, y, LAND, 20)) { ya = Math.min(ya, y); yb = Math.max(yb, y); }
        }
        const x0 = xq + Math.max(av, 9);
        const nRows = Math.ceil((X1 - x0) / (bd + av));
        if (nRows < 0) return;
        const plan = streetPlan(T, ph, x0, nRows, Y0 - 30, Y1 + 30);
        if (plan.rows.reduce((n, r) => n + r.blocks.length, 0) > 20000) return;
        const shore = new Shore(xq, [xq - 300, Y0 - 60, X1 + 30, Y1 + 60]);
        const taken = [], zones = [], canals = [], bridges = [];
        let basin = null;
        const hasQuay = ya < yb;
        const lr = new PG.RNG(hash(seed, 97));
        const free = (a, b) => !taken.some(([t0, t1]) => a < t1 && b > t0);
        const alongQuay = (a, b) => a > ya + 10 && b < yb - 10;
        if (hasQuay) {
            // canals up into the town in place of a through street
            const want = lr.chance(p.canals) ? (lr.chance(p.canals * 0.6) ? 2 : 1) : 0;
            for (const m of lr.shuffle(plan.mains.slice())) {
                if (canals.length >= want) break;
                const cw = lr.range(8.5, 12.5), k = Math.min(plan.rows.length, lr.int(1, 3));
                const c = { y0: m - cw / 2, y1: m + cw / 2, xe: plan.rows[k - 1].x + bd, rows: k };
                if (!alongQuay(c.y0 - WALK, c.y1 + WALK) || !free(c.y0 - 12, c.y1 + 12)) continue;
                c.rect = [xq, c.y0, c.xe, c.y1];
                canals.push(c);
                shore.cuts.push(c.rect);
                zones.push({ rows: k, y0: c.y0 - WALK, y1: c.y1 + WALK });
                taken.push([c.y0 - 5, c.y1 + 5]);
                bridges.push({ xa: xq, xb: xq + Math.min(av, x0 - xq - 0.5), y0: c.y0, y1: c.y1, ground: false });
                for (let i = 0; i + 1 < k; i++) {
                    const mx = plan.rows[i].x + bd + av / 2, hw = Math.min(av - 1, 5.5) / 2;
                    bridges.push({ xa: mx - hw, xb: mx + hw, y0: c.y0, y1: c.y1, ground: true });
                }
            }
            // a dock in place of a block on the front row, through a narrow
            // entrance under the quay road
            if (lr.chance(p.basin)) {
                for (const [b0, b1] of lr.shuffle(plan.rows[0].blocks.slice())) {
                    if (b1 - b0 < 24 || b1 - b0 > 60 || !alongQuay(b0, b1) || !free(b0 - 8, b1 + 8)) continue;
                    const deep = plan.rows.length > 1 && lr.chance(0.4) ? 2 : 1;
                    const rect = [xq + 6, b0 + 2.5, plan.rows[deep - 1].x + bd - 5, b1 - 2.5];
                    const ew = lr.range(9, 11.5), e0 = lr.range(rect[1] + 1.5, rect[3] - 1.5 - ew);
                    basin = { rect, mouth: [xq, e0, xq + 6, e0 + ew] };
                    shore.cuts.push(basin.rect, basin.mouth);
                    zones.push({ rows: deep, y0: b0, y1: b1 });
                    taken.push([e0 - 6, e0 + ew + 6]);
                    bridges.push({ xa: xq, xb: xq + 6, y0: e0, y1: e0 + ew, ground: false });
                    break;
                }
            }
        }
        for (const row of plan.rows) {
            let spans = row.blocks;
            for (const z of zones) if (row.i < z.rows) spans = cutSpans(spans, z.y0, z.y1);
            row.blocks = spans.map(([y0, y1]) => ({ y0, y1 }));
        }
        // squares in place of a block or two near the water
        const nSq = ph.chance(p.squares) ? (ph.chance(p.squares * 0.5) ? 2 : 1) : 0;
        const squares = [];
        for (const row of ph.shuffle(plan.rows.slice(0, 3))) {
            for (const b of ph.shuffle(row.blocks.slice())) {
                if (squares.length >= nSq) break;
                const L = b.y1 - b.y0, cy = (b.y0 + b.y1) / 2;
                if (L < 16 || L > 46 || !seen(row.x + 4, b.y0 + 4, row.x + bd - 4, b.y1 - 4, 0)) continue;
                if (squares.some(s => Math.hypot(s.x - row.x, s.y - cy) < 45)) continue;
                b.square = true;
                squares.push({ b, x: row.x, y: cy });
            }
        }
        // the clock tower goes in the block nearest the middle of the page,
        // or on a square
        if (p.tower) {
            let best = null, bestD = Infinity;
            for (const row of plan.rows) {
                for (const b of row.blocks) {
                    const q = cam.project(row.x + bd / 2, (b.y0 + b.y1) / 2, LAND);
                    const dd = Math.hypot(q[0] - S.W * 0.55, q[1] - S.H * 0.45);
                    if (dd < bestD) { bestD = dd; best = b; }
                }
            }
            if (squares.length && ph.chance(0.5)) best = squares[0].b;
            if (best) best.tower = true;
        }
        // and a church off to one side of it
        if (p.church) {
            let best = null, bestD = Infinity;
            const aim = [S.W * ph.pick([0.25, 0.75]), S.H * ph.range(0.2, 0.4)];
            for (const row of plan.rows) {
                for (const b of row.blocks) {
                    if (b.tower || b.square || b.y1 - b.y0 < 14) continue;
                    const q = cam.project(row.x + bd / 2, (b.y0 + b.y1) / 2, LAND);
                    const dd = Math.hypot(q[0] - aim[0], q[1] - aim[1]);
                    if (dd < bestD) { bestD = dd; best = b; }
                }
            }
            if (best) best.church = true;
        }
        for (const row of plan.rows) {
            row.blocks.forEach((b, j) => {
                if (!seen(row.x, b.y0, row.x + bd, b.y1, 14)) return;
                const keys = [seed, row.i, j];
                if (b.square) {
                    square(T, row.x, b.y0, row.x + bd, b.y1, keys, b.tower);
                    return;
                }
                const r = new PG.RNG(hash(...keys, 2));
                block(T, row.x, b.y0, row.x + bd, b.y1, keys, {
                    market: row.i <= 1 && r.chance(p.market * 0.4), tower: b.tower, church: b.church, nearWater: row.i === 0,
                    silos: row.i === 0 && r.chance(p.silos * 0.4),
                });
            });
        }
        // every other street gets a strip down the middle, broken where a cross street meets it
        const median = ph.int(0, 1);
        S.shadow = null;
        S.kind = INK;
        for (let i = 0; i + 1 < plan.rows.length; i++) {
            if ((i + median) % 2 || av < 7) continue;
            const mx = plan.rows[i].x + bd + av / 2;
            for (const a of plan.rows[i].blocks) {
                for (const b of plan.rows[i + 1].blocks) {
                    const y0 = Math.max(a.y0, b.y0) + 1.2, y1 = Math.min(a.y1, b.y1) - 1.2;
                    if (y1 - y0 < 3 || !seen(mx - 0.5, y0, mx + 0.5, y1, 0)) continue;
                    S.loop([[mx - 0.45, y0, LAND], [mx + 0.45, y0, LAND], [mx + 0.45, y1, LAND], [mx - 0.45, y1, LAND]]);
                }
            }
        }
        if (!hasQuay) return;
        const W = planWater(T, shore, taken, xq, ya, yb, seed);
        const busy = (x, y) => bridges.some(br => {
            const ramp = bridgeRamp(br.y1 - br.y0);
            return inRect([br.xa, br.y0 - ramp, br.xb, br.y1 + ramp], x, y, 0.5);
        }) || (W.slip && inRect([xq - 1, W.slip[0], xq + 1, W.slip[1]], x, y, 0.5));
        // shadows on the water hatch level across the page, like the water marks
        const flat = Math.atan2(cam.ry, cam.rx);
        const water = S.shadowGroup(0, null, flat);
        const cutGroups = shore.cuts.map(r => [r, S.shadowGroup(0, r, flat)]);
        const groupAt = (x, y) => (cutGroups.find(([r]) => inRect(r, x, y)) || [null, water])[1];
        S.shadow = null;
        drawShore(T, shore, groupAt, busy, new PG.RNG(hash(seed, 55)));
        for (const br of bridges) {
            S.shadow = groupAt((br.xa + br.xb) / 2, (br.y0 + br.y1) / 2);
            bridge(T, br.xa, br.xb, br.y0, br.y1, br.ground);
        }
        S.shadow = null;
        let road = [[xq + 0.6, ya - 30, xq + av, yb + 30]];
        for (const c of shore.cuts) road = subtract(road, c);
        quayRoad(T, road, busy, xq, ya, yb, seed);
        waterways(T, canals, basin, bridges, groupAt, xq, x0, seed);
        const wakes = drawWater(T, W, xq, water, seed);
        if (p.water) waterMarks(T, shore, [water, ...cutGroups.map(c => c[1])].filter(Boolean), wakes, seed);
    }

    PG.register({
        id: 'harbour',
        name: 'Harbour',
        category: 'Scenes',
        description: 'An isometric fishing town with a quay, piers and a lighthouse, shaded for four to eight pens.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 1, max: 5, step: 0.05, value: 1.8, random: [1.4, 2.4],
                hint: 'How big a metre is on paper' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 15, max: 75, step: 0.5, value: 50, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 39.5, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Harbour' },
            { id: 'side', label: 'Water on', type: 'select', value: 'left', random: ['left', 'right'],
                options: [['left', 'Left'], ['right', 'Right']] },
            { id: 'shore', label: 'Waterline', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0.3, 0.6],
                hint: 'How far down the edge of the page the quay starts' },
            { id: 'piers', label: 'Piers', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'boats', label: 'Boats', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.4, 1] },
            { id: 'lighthouse', label: 'Lighthouse', type: 'checkbox', value: true },
            { id: 'breakwater', label: 'Lighthouse on', type: 'select', value: 'any', random: false, show: p => p.lighthouse,
                options: [['any', 'Any'], ['straight', 'Straight breakwater'], ['bent', 'Bent breakwater'], ['island', 'Island']] },
            { id: 'wharves', label: 'Wharves & cranes', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4, random: [0, 0.8] },
            { id: 'basin', label: 'Dock basin', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0, 0.7],
                hint: 'Chance of a dock cut into the front row of blocks' },
            { id: 'canals', label: 'Canals', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0, 0.9],
                hint: 'Chance of a canal or two up into the town' },
            { type: 'section', label: 'Streets' },
            { id: 'blockW', label: 'Block length (m)', type: 'range', min: 18, max: 80, step: 1, value: 44, random: [34, 56] },
            { id: 'blockD', label: 'Lot depth (m)', type: 'range', min: 8, max: 40, step: 0.5, value: 12.5, random: [11, 14],
                hint: 'Blocks are one row of lots, or two rows from 24 m' },
            { id: 'avenue', label: 'Street width (m)', type: 'range', min: 5, max: 20, step: 0.5, value: 7.5, random: [6.5, 9],
                hint: 'Streets between the rows of lots. From 7 m every other one gets a median strip' },
            { id: 'street', label: 'Cross street width (m)', type: 'range', min: 4, max: 16, step: 0.5, value: 7, random: [6, 8] },
            { id: 'irregular', label: 'Staggered streets', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0, 1],
                hint: 'At 0 the cross streets all line up. Higher and each row of blocks gets its own' },
            { id: 'squares', label: 'Squares', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0, 0.8] },
            { type: 'section', label: 'Buildings' },
            { id: 'houses', label: 'Houses', type: 'range', min: 0, max: 1, step: 0.01, value: 1, random: [0.6, 1] },
            { id: 'terraces', label: 'Canal houses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0.1, 0.9],
                hint: 'Rows of narrow houses with their gables to the street' },
            { id: 'apartments', label: 'Apartments', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0.1, 0.6] },
            { id: 'warehouses', label: 'Warehouses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0.1, 0.5] },
            { id: 'workshops', label: 'Workshops', type: 'range', min: 0, max: 1, step: 0.01, value: 0.12, random: [0, 0.3] },
            { id: 'market', label: 'Market halls', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0, 0.6] },
            { id: 'silos', label: 'Grain silos', type: 'range', min: 0, max: 1, step: 0.01, value: 0.2, random: [0, 0.5],
                hint: 'Only on the front row, by the water' },
            { id: 'windmills', label: 'Windmills', type: 'range', min: 0, max: 1, step: 0.01, value: 0.06, random: [0, 0.15] },
            { id: 'tower', label: 'Clock tower', type: 'checkbox', value: true },
            { id: 'church', label: 'Church', type: 'checkbox', value: true, random: 0.7 },
            { id: 'floors', label: 'Max storeys', type: 'range', min: 1, max: 6, step: 1, value: 4, random: [3, 4] },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Window frames, planks, stripes and other small line work' },
            { type: 'section', label: 'Details' },
            { id: 'awnings', label: 'Awnings', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.8] },
            { id: 'carts', label: 'Market carts', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.2, 0.8] },
            { id: 'hedges', label: 'Hedges', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 1] },
            { id: 'lamps', label: 'Lamp posts', type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, random: [0.4, 1] },
            { id: 'props', label: 'Yard things', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1] },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4, random: [0, 0.7] },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Roof hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Roof hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false,
                show: p => p.roofHatch, hint: 'Shaded slopes are hatched closer, at 60% of this' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 50, random: [42, 58],
                show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false,
                show: p => p.shadows },
            { id: 'water', label: 'Water marks', type: 'checkbox', value: true },
            { type: 'section', label: 'Pens' },
            { id: 'inks', label: 'Pens', type: 'select', value: 'four', random: false,
                options: [['eight', 'Eight, adding light blue and brown'], ['six', 'Six, adding green and purple'],
                    ['four', 'Black, red, blue, yellow'], ['three', 'Black, red, blue'], ['one', 'One pen']],
                hint: 'Each colour goes to its pen in the default pen set, so four uses pens 1, 2, 3 and 5. Six adds green trees and hedges and purple people and cars, eight adds light blue water and brown piers and boats' },
        ],

        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const k = p.scale;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0);
            const S = new Scene(cam, W, H);
            const cot = 1 / Math.tan(geo.rad(p.sun));
            const sun = [cot * Math.cos(SUN_TURN), -cot * Math.sin(SUN_TURN)];
            // Water on the right is the same town drawn mirrored, shadows and all.
            // Keeping the shadows on the right would shade the big front roof slopes.
            const mirror = p.side === 'right';
            if (p.shadows) S.sun = sun;
            const toSun = unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                // roof hatching, in mm on paper, and the pens for it (see isokit's shade)
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: YELLOW } : null,
                waterKind: WATER,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.6,
                // lit if the face gets at least 3/4 of the light a flat roof does
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
            };
            buildHarbour(T, ctx.seed | 0);
            if (p.shadows) {
                S.kind = BLUE;
                S.hatchShadows(p.shadowGap);
            }
            // pen for each kind (ink, red, blue, yellow, green, figures, water, wood)
            const penOf = {
                eight: [0, 1, 2, 4, 3, 5, 6, 7], six: [0, 1, 2, 4, 3, 5, 2, 0], four: [0, 1, 2, 4, 0, 0, 2, 0],
                three: [0, 1, 2, 1, 0, 0, 2, 0], one: [0, 0, 0, 0, 0, 0, 0, 0],
            }[p.inks] || [0, 1, 2, 4, 0, 0, 2, 0];
            // green, figures and wood used to be drawn in ink, and water in blue
            const byPen = renderPens(S, penOf, [INK, RED, BLUE, YELLOW, INK, INK, BLUE, INK]);
            if (mirror) for (const paths of byPen) for (const q of paths || []) for (const v of q) v[0] = W - v[0];
            const layers = [];
            byPen.forEach((paths, pen) => layers.push({ pen, paths }));
            return { layers };
        },
    });
})();
