/*
 * Harbour: an isometric fishing town on the water, drawn for four pens.
 *
 * It's a 3D scene like Town, with hidden lines removed (lib/iso.js). Rows of
 * houses, apartments and barrel-roofed warehouses face the avenues that run
 * along the quay, and out on the water there are piers with moored boats, a
 * breakwater with a lighthouse, and buoys.
 *
 * The colour work is in the style of an illustrated map. Lit roof slopes are
 * hatched in red and shaded ones in black, a low sun casts blue hatched
 * shadows onto the ground and the water, the water gets rows of short blue
 * dashes, and cart canopies and boat cabin roofs are yellow. Shadows are cut
 * off at the edge of the lot they fall in, which keeps the streets clean.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, newell, Scene, render, segments } = PG.iso;
    const {
        FLOOR, wall, rect, pane, door, garageDoor, windows, gableRoof, gableSlope, chimney, flatRoof, plinth,
        steps, car, bike, person, chair, bench, clothesline, Occupancy,
    } = PG.isokit;

    // line kinds
    const INK = 0, RED = 1, BLUE = 2, YELLOW = 3;
    const LAND = 1.6;             // the quay and the town stand this high above the water (m)
    const SUN_TURN = geo.rad(65); // shadows fall along +x, turned this far towards -y (to the right on the page)
    const WORLD = frame(0, 0, 0, 0);

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

    // ------------------------------------------------------------------
    // Roof hatching
    // ------------------------------------------------------------------

    // Hatch a roof face down its fall line (flat roofs along x). Lit faces go in
    // `litKind`, shaded ones in black and closer together. n is the outward normal.
    function hatchRoof(T, pts, n, litKind = RED, lit = T.lit(n)) {
        if (!T.p.roofHatch || !T.sees(n)) return;
        const S = T.S;
        const flat = Math.hypot(n[0], n[1]) < 1e-6 * Math.abs(n[2]);
        const n2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
        const dir = flat ? [1, 0, 0] : [n[0] * n[2], n[1] * n[2], n[2] * n[2] - n2];
        S.kind = lit ? litKind : INK;
        S.hatch(pts, dir, lit ? T.hLit : T.hDark);
        S.kind = INK;
    }

    function hatchGable(T, F, R, litKind) {
        for (const side of [-1, 1]) {
            const sl = gableSlope(F, R, side);
            hatchRoof(T, [sl.at(0, 0), sl.at(sl.len, 0), sl.at(sl.len, sl.up), sl.at(0, sl.up)], sl.n, litKind);
        }
    }

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

    // Striped canvas awning over a shop front, with a scalloped valance. Every
    // other stripe is filled with lines close enough to read as solid.
    function awning(T, F, a0, a1, b, z, depth) {
        const S = T.S, P = F.P, drop = depth * 0.42, val = 0.3, lo = z - drop - val;
        S.prism([P(a0, b, z), P(a0, b - depth, z - drop), P(a0, b - depth, lo), P(a0, b, lo)], F.V(a1 - a0, 0, 0));
        const n = Math.max(3, Math.round((a1 - a0) / 0.34) | 1), sw = (a1 - a0) / n;
        const fill = T.detail ? Math.max(1, Math.ceil((sw * T.k) / 0.3)) : 1;
        for (let i = 1; i < n; i += 2) {
            for (let j = 0; j <= fill; j++) {
                const a = a0 + sw * (i + j / fill);
                S.line([P(a, b, z), P(a, b - depth, z - drop), P(a, b - depth, lo)]);
            }
        }
        if (!T.detail) return;
        const pts = [];
        for (let i = 0; i < n; i++) {
            for (let k = i ? 1 : 0; k <= 6; k++) pts.push(P(a0 + sw * (i + k / 6), b - depth, lo - 0.1 * Math.sin((Math.PI * k) / 6)));
        }
        S.line(pts);
    }

    // Double doors with a brace across each leaf, the pair making a W
    function barnDoors(T, at, s, base, w, h) {
        const S = T.S;
        rect(T, at, s - w / 2, base, w, h);
        S.line([at(s, base), at(s, base + h)]);
        if (!T.detail) return;
        for (const x0 of [s - w / 2, s]) S.line([at(x0, base + h), at(x0 + w / 4, base), at(x0 + w / 2, base + h)]);
    }

    // Gable-roofed house, 1 to 3 storeys, ridge along the street. `twin` makes
    // it a pair of houses sharing the middle wall.
    function house(T, F, fp, rng, o) {
        const S = T.S;
        S.kind = INK;
        const [a0, b0, a1, b1] = fp, L = a1 - a0;
        const base = 0.3, top = base + o.floors * FLOOR;
        plinth(T, F, fp, base, 0.15);
        S.box(F, a0, b0, base, a1, b1, top);
        const R = gableRoof(T, F, fp, top, true, geo.rad(rng.range(30, 40)), rng, { attic: !o.twin && rng.chance(0.3) });
        if (o.twin) {
            // party wall between the pair, standing a little proud of the roof
            const P = F.P, m = (a0 + a1) / 2, e = 0.14, run = e / R.tp;
            S.prism([P(m - 0.13, b0 - R.oh - run, R.zb), P(m - 0.13, b1 + R.oh + run, R.zb), P(m - 0.13, R.mid, R.ridge + e)], F.V(0.26, 0, 0));
        }
        const stacks = o.twin ? [a0 + L * 0.25, a0 + L * 0.75] : rng.chance(0.45) ? [rng.range(a0 + 0.8, a1 - 0.8)] : [];
        for (const a of stacks) chimney(T, F, a, R.mid + rng.range(0.4, 0.9), R.zb, R.ridge + rng.range(0.4, 0.7));
        if (!o.twin && rng.chance(0.3)) skylights(T, F, R, rng);
        hatchGable(T, F, R);
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
        hatchRoof(T, [P(a0 - d, b0 - d, zr), P(a1 + d, b0 - d, zr), P(a1 + d, b1 + d, zr), P(a0 - d, b1 + d, zr)], [0, 0, 1]);
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

    // Seams over a vault: a few (warehouses) or close enough to read as hatching
    function seams(T, V, gap) {
        if (!T.p.roofHatch) return;
        const n = Math.max(1, Math.round((V.y1 - V.y0) / gap));
        T.S.kind = RED;
        for (let i = 0; i < n; i++) T.S.line(V.arc(V.y0 + ((V.y1 - V.y0) * (i + 0.5)) / n));
        T.S.kind = INK;
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
        seams(T, V, o.stacks ? 1.6 : 1.8);
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
            hatchRoof(T, [P(a, b, top + ht), P(a + e, b, top + ht), P(a + e, b + dv, top), P(a, b + dv, top)], F.V(0, ht, dv), RED, true);
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

    // Open market hall: posts, beams and a double barrel roof, stalls underneath
    function marketHall(T, F, fp, rng) {
        const S = T.S;
        S.kind = INK;
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
            seams(T, V, T.hLit / T.k);
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

    // Square clock tower with a pyramid roof
    function clockTower(T, F, a, b, rng) {
        const S = T.S, P = F.P;
        S.kind = INK;
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
            hatchRoof(T, tri, outward(tri, centre));
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

    // ------------------------------------------------------------------
    // Props
    // ------------------------------------------------------------------

    // Crook lamp post with a lantern hanging from it
    function lamp(T, x, y, z) {
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

    // Low clipped hedge: a scalloped outline round a rounded strip along u
    function hedge(T, F, a0, a1, b, wid) {
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

    // Market cart: a counter on two wheels under a small gable canopy
    function cart(T, x, y, z, rng) {
        const S = T.S, F = frame(x, y, z, 3), L = 1.7, D = 0.9, zb = 0.45, zc = zb + 0.8, zt = zc + 1.15;
        S.kind = INK;
        S.box(F, -L / 2, -D / 2, zb, L / 2, D / 2, zc);
        const r = 0.36;
        for (const a of [-L / 2 + 0.4, L / 2 - 0.4]) {
            const pts = ring(T.segs(r), (c, s) => F.P(a + r * c, -D / 2 - 0.05, r + r * s));
            S.face(pts);
            S.loop(pts);
        }
        for (const [a, b] of [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]]) S.line([F.P(a, b, zc), F.P(a, b, zt - 0.25)]);
        const R = gableRoof(T, F, [-L / 2, -D / 2, L / 2, D / 2], zt, true, geo.rad(24), rng, { attic: false });
        hatchGable(T, F, R, YELLOW);
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
            chair(T, x + cx, y + cy, z, PG.isokit.nearestDir(-cx, -cy));
        }
    }

    // ------------------------------------------------------------------
    // Boats
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
        const n = 12, deckZ = t => free + sheer * t * t;
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
        const deck = outline(L, B, open ? () => free : deckZ, 0);
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
        return {
            deck,
            z: u => (open ? free : deckZ(geo.clamp((u + L / 2) / L, 0, 1))),
            half: u => (B / 2) * breadth(geo.clamp((u + L / 2) / L, 0, 1)),
        };
    }

    // Box on deck, from the deck up to height h, with windows round it
    function deckhouse(T, F, Hl, u0, u1, w, h, rng) {
        const S = T.S, P = F.P;
        const z0 = Math.min(Hl.z(u0), Hl.z(u1)) - 0.1, top = z0 + h;
        const fp = [u0, -w, u1, w];
        S.box(F, u0, -w, z0, u1, w, top);
        S.box(F, u0 - 0.15, -w - 0.15, top, u1 + 0.15, w + 0.15, top + 0.12);
        if (T.p.roofHatch && T.sees([0, 0, 1])) {
            S.kind = YELLOW;
            S.hatch([P(u0 + 0.15, -w + 0.1, top + 0.12), P(u1 - 0.15, -w + 0.1, top + 0.12), P(u1 - 0.15, w - 0.1, top + 0.12), P(u0 + 0.15, w - 0.1, top + 0.12)],
                F.V(0, 1, 0), T.hLit * 0.8);
            S.kind = INK;
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
        const u0 = -L * 0.12, u1 = u0 + rng.range(2.2, 2.8);
        const top = deckhouse(T, F, Hl, u0, u1, B * 0.3, 2.1, rng);
        // mast with a cross spar, and a gantry over the stern
        const mu = u1 + 0.8, mz = Hl.z(mu);
        S.line([F.P(mu, 0, mz), F.P(mu, 0, top + 2.4)]);
        S.line([F.P(mu, -0.8, top + 1.9), F.P(mu, 0.8, top + 1.9)]);
        if (rng.chance(0.6)) {
            const su = -L / 2 + 0.6, sz = Hl.z(su), hw = Hl.half(su) * 0.8;
            S.line([F.P(su, -hw, sz), F.P(su, -hw * 0.7, sz + 2.3), F.P(su, hw * 0.7, sz + 2.3), F.P(su, hw, sz)]);
        }
        return L;
    }

    function launch(T, F, rng) {
        const L = rng.range(6, 7.5), B = rng.range(2.3, 2.7);
        const Hl = hullSolid(T, F, L, B, 0.85, 0.35, false);
        const u0 = -L * 0.05;
        const top = deckhouse(T, F, Hl, u0, u0 + rng.range(1.6, 2.1), B * 0.32, 1.5, rng);
        T.S.line([F.P(u0 + 0.5, 0, top), F.P(u0 + 0.5, 0, top + 1.1)]);
        return L;
    }

    function sailboat(T, F, rng) {
        const S = T.S, L = rng.range(6.5, 8), B = rng.range(2.3, 2.6);
        const Hl = hullSolid(T, F, L, B, 0.8, 0.3, false);
        const cu = -L * 0.2;
        deckhouse(T, F, Hl, cu, cu + 1.8, B * 0.28, 0.7, rng);
        const mu = L * 0.12, mz = Hl.z(mu);
        const sail = [F.P(mu - 0.1, 0, mz + 0.9), F.P(mu - 0.1, 0, mz + 5.6), F.P(mu - 2.8, 0, mz + 7.1), F.P(mu - 3.5, 0, mz + 1)];
        S.line([F.P(mu, 0, mz), F.P(mu, 0, mz + 6)]);
        S.face(sail);
        S.loop(sail);
        S.line([F.P(mu, 0, mz + 0.9), F.P(mu - 3.8, 0, mz + 0.95)]);
        if (T.detail) {
            for (const f of [0.35, 0.65]) S.line([lerp3(sail[0], sail[1], f), lerp3(sail[3], sail[2], f)]);
        }
        return L;
    }

    // Open rowing boat, dark inside, with thwarts and oars
    function rowboat(T, F, rng) {
        const S = T.S, L = rng.range(3.4, 4.2), B = rng.range(1.35, 1.55);
        const Hl = hullSolid(T, F, L, B, 0.5, 0, true);
        const inner = PG.iso.inset3(Hl.deck, 0.1);
        if (inner.length < 3) return L;
        S.loop(inner);
        for (const f of [-0.28, 0, 0.26]) {
            const u = L * f, h = Hl.half(u) - 0.1;
            S.box(F, u - 0.1, -h, 0.38, u + 0.1, h, 0.5);
        }
        return L;
    }

    // Moored boat of a random kind, pointing along the pier. Returns its length.
    function boat(T, x, y, dir, rng, kind) {
        const F = frame(x, y, 0, dir);
        T.S.kind = INK;
        if (kind === 'row') return rowboat(T, F, rng);
        if (kind === 'sail') return sailboat(T, F, rng);
        if (kind === 'launch') return launch(T, F, rng);
        return fishingBoat(T, F, rng);
    }

    function buoy(T, x, y) {
        const S = T.S;
        S.kind = INK;
        S.lathe(x, y, [[0.55, 0], [0.75, 0.25], [0.6, 0.5], [0.2, 0.62]], 16);
        S.frustum(x, y, 0.62, 1.6, 0.22, 0.08, 10);
        S.lathe(x, y, [[0, 1.55], [0.3, 1.85], [0, 2.2]], 10);
    }

    // Wooden pier out from the quay along -x, planked, on posts
    function pier(T, xq, y, len, wid, rng) {
        const S = T.S, z = 0.9, x0 = xq - len;
        S.kind = INK;
        S.box(WORLD, x0, y - wid / 2, z - 0.25, xq, y + wid / 2, z);
        if (T.detail) {
            const n = Math.max(2, Math.round(len / 0.8));
            for (let i = 1; i < n; i++) {
                const x = x0 + (len * i) / n;
                S.line([[x, y - wid / 2, z], [x, y + wid / 2, z]]);
            }
        }
        const posts = [];
        const n = Math.max(1, Math.round(len / 3.4));
        for (let i = 0; i <= n; i++) {
            const x = x0 + 0.2 + ((len - 0.8) * i) / n;
            for (const s of [-1, 1]) {
                const py = y + s * (wid / 2 + 0.12);
                S.box(WORLD, x - 0.12, py - 0.12, 0, x + 0.12, py + 0.12, z + (i % 2 ? 0.1 : 0.5));
                posts.push([x, py, z + 0.5]);
            }
        }
        return posts;
    }

    // ------------------------------------------------------------------
    // Quay, breakwater and lighthouse
    // ------------------------------------------------------------------

    // Stone quay along y at x = xq, from ya to yb, with coping and bollards.
    // `gaps` are y ranges left open for slipways.
    function quayWall(T, xq, ya, yb, gaps, rng) {
        const S = T.S;
        S.kind = INK;
        S.box(WORLD, xq, ya, 0, xq + 3, yb, LAND);
        let y = ya;
        for (const [g0, g1] of gaps.concat([[yb, yb]])) {
            if (g0 - y > 0.5) S.box(WORLD, xq - 0.25, y, LAND - 0.3, xq + 0.6, g0, LAND + 0.06);
            y = g1;
        }
        if (T.detail) {
            for (let j = Math.ceil(ya / 4.5); j * 4.5 < yb; j++) {
                const jy = j * 4.5;
                if (!gaps.some(([g0, g1]) => jy > g0 - 0.5 && jy < g1 + 0.5)) S.line([[xq, jy, 0.05], [xq, jy, LAND - 0.3]]);
            }
        }
        for (let j = Math.ceil(ya / 10); j * 10 < yb; j++) {
            const by = j * 10 + rng.range(-1.5, 1.5);
            if (gaps.some(([g0, g1]) => by > g0 - 1 && by < g1 + 1)) continue;
            bollard(T, xq + 0.25, by, LAND + 0.06);
        }
    }

    function bollard(T, x, y, z) {
        T.S.lathe(x, y, [[0.14, z], [0.14, z + 0.4], [0.2, z + 0.46], [0.2, z + 0.54], [0, z + 0.56]], 12);
    }

    // Slipway down the quay into the water, with rungs across it
    function slipway(T, xq, y0, y1) {
        const S = T.S, len = 7, top = LAND + 0.05;
        S.kind = INK;
        S.prism([[xq + 0.6, y0, top], [xq - len, y0, 0.02], [xq - len, y0, -0.25], [xq + 0.6, y0, top - 0.3]], [0, y1 - y0, 0]);
        const n = Math.round((len + 0.6) / 0.7);
        for (let i = 1; i < n; i++) {
            const t = i / n, x = geo.lerp(xq + 0.6, xq - len, t), z = geo.lerp(top, 0.02, t);
            S.line([[x, y0 + 0.2, z], [x, y1 - 0.2, z]]);
        }
    }

    // Breakwater out from the quay, with a lighthouse at the end
    function breakwater(T, xq, y, len, rng) {
        const S = T.S, w = 5.5, x0 = xq - len;
        S.kind = INK;
        S.box(WORLD, x0, y - w / 2, 0, xq, y + w / 2, LAND);
        S.box(WORLD, x0 - 0.2, y - w / 2 - 0.2, LAND - 0.3, xq - 0.25, y + w / 2 + 0.2, LAND + 0.06);
        for (let x = x0 + 5; x < xq - 3; x += 7) bollard(T, x, y - w / 2 + 0.25, LAND + 0.06);
        S.shadowGroup(LAND, [x0 - 0.2, y - w / 2 - 0.2, xq, y + w / 2 + 0.2]);
        lighthouse(T, x0 + 2.8, y, LAND + 0.06, rng);
    }

    function lighthouse(T, x, y, z, rng) {
        const S = T.S, cam = T.cam;
        S.kind = INK;
        const h = rng.range(9, 11), r0 = 1.75, r1 = 1.15;
        S.frustum(x, y, z, z + 0.5, 2.3, 2.3, 32);
        const zt = z + 0.5, zg = zt + h;
        S.frustum(x, y, zt, zg, r0, r1, 32);
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
                [w >= 6.5 && d >= 8 ? p.apartments * 1.5 : 0, 'apartment'],
                [w >= 6.5 && d >= 10 ? p.warehouses * 1.3 : 0, 'warehouse'],
                [w >= 8 && d >= 10 ? p.workshops : 0, 'workshop'],
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
        const pad = fp && kind !== 'tower' && kind !== 'market' ? Math.max(0.35, fp[1] - 1.4) : null;
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
            // lots run along u, which is -y
            let y = iy1;
            widths.forEach((wd, i) => {
                lot(T, x, y - wd, x + depth, y, [...keys, r * 16 + i], { kind: kinds[i], nearWater: special.nearWater && r === 0 });
                y -= wd;
            });
            x += depth;
        });
    }

    // The quay road: lamps and benches, a van, people on foot and on bikes
    function quayRoad(T, xq, ya, yb, seed) {
        const { S, p } = T;
        const rng = new PG.RNG(hash(seed, 60));
        const x1 = xq + p.avenue;
        S.shadowGroup(LAND, [xq + 0.6, ya, x1, yb]);
        S.kind = INK;
        for (let y = ya + rng.range(2, 10); y < yb; y += rng.range(16, 24)) {
            if (rng.chance(p.lamps)) lamp(T, x1 - 1.1, y, LAND);
            if (rng.chance(p.props * 0.5)) bench(T, xq + 1.6, y + 5, LAND, 1);
        }
        if (rng.chance(0.3 + 0.6 * p.people)) car(T, xq + p.avenue * 0.55, geo.lerp(ya, yb, rng.range(0.2, 0.8)), LAND, rng.pick([1, 3]), rng, true, 'van');
        const walkers = Math.round((yb - ya) / 40 * p.people * rng.range(0.5, 1.5));
        for (let i = 0; i < walkers; i++) {
            const y = rng.range(ya, yb), xx = rng.range(xq + 1.5, x1 - 2);
            if (rng.chance(0.4)) bike(T, xx, y, LAND, rng.pick([1, 3]), rng, true);
            else person(T, xx, y, LAND, rng);
        }
        S.shadow = null;
    }

    // Piers with boats, a slipway, buoys and the breakwater. Returns the
    // shadows on the water so the water marks can keep out of them.
    function harbour(T, xq, ya, yb, seed) {
        const { S, p, cam } = T;
        const rng = new PG.RNG(hash(seed, 50));
        const onPage = (x, y, z, pad = 0) => {
            const q = cam.project(x, y, z);
            return q[0] > -pad && q[1] > -pad && q[0] < S.W + pad && q[1] < S.H + pad;
        };
        const taken = [];
        const free = (y0, y1) => !taken.some(([t0, t1]) => y0 < t1 && y1 > t0);
        // breakwater towards the bottom of the page, short enough for the lighthouse to show
        let bw = null;
        if (p.lighthouse) {
            for (let tries = 0; tries < 12 && !bw; tries++) {
                const y = geo.lerp(ya, yb, rng.range(0.1, 0.4));
                let len = rng.range(24, 34);
                while (len > 10 && !onPage(xq - len + 2.8, y, LAND + 14, -4)) len -= 2;
                if (len > 10 && onPage(xq - len + 2.8, y, LAND, -4)) bw = { y, len };
            }
            if (bw) taken.push([bw.y - 8, bw.y + 8]);
        }
        const slip = rng.chance(0.7) ? geo.lerp(ya, yb, rng.range(0.3, 0.9)) : null;
        const gaps = [];
        if (slip !== null && free(slip - 4, slip + 4)) {
            gaps.push([slip - 1.8, slip + 1.8]);
            taken.push([slip - 5, slip + 5]);
        }
        S.shadow = null;
        quayWall(T, xq, ya - 30, yb + 30, gaps, rng);
        if (gaps.length) slipway(T, xq, gaps[0][0], gaps[0][1]);
        // shadows on the water hatch level across the page, like the water marks
        const water = S.shadowGroup(0, null, Math.atan2(cam.ry, cam.rx));
        // piers
        const nPiers = Math.round(((yb - ya) / 45) * p.piers * 2);
        for (let i = 0, tries = 0; i < nPiers && tries < 40; tries++) {
            const y = geo.lerp(ya, yb, rng.random()), len = rng.range(14, 24), wid = rng.range(2.4, 3.1);
            if (!free(y - 9, y + 9) || !onPage(xq - len / 2, y, 1)) continue;
            taken.push([y - 9, y + 9]);
            i++;
            const posts = pier(T, xq, y, len, wid, rng);
            // boats along both sides, bows out to sea
            for (const s of [-1, 1]) {
                let x = xq - 1.5;
                while (x > xq - len - 2) {
                    if (!rng.chance(0.25 + 0.7 * p.boats)) { x -= rng.range(3, 6); continue; }
                    const kind = rng.weighted([[3, 'fishing'], [2, 'row'], [1.5, 'launch'], [1, 'sail']]);
                    const beam = kind === 'row' ? 1.45 : kind === 'fishing' ? 3.3 : 2.5;
                    const L0 = kind === 'row' ? 4 : kind === 'fishing' ? 9.5 : 7.2;
                    const cx = x - L0 / 2, cy = y + s * (wid / 2 + 0.35 + beam / 2);
                    if (cx - L0 / 2 < xq - len - 4) break;
                    const Lb = boat(T, cx, cy, 2, rng, kind);
                    // mooring line from the bow to the nearest post
                    const bow = [cx - Lb / 2 + 0.3, cy - s * beam * 0.1, kind === 'row' ? 0.5 : 1.4];
                    let best = posts[0];
                    for (const q of posts) if (Math.abs(q[0] - bow[0]) < Math.abs(best[0] - bow[0])) best = q;
                    if (T.detail) S.line([bow, [(bow[0] + best[0]) / 2, (bow[1] + best[1]) / 2, Math.min(bow[2], best[2]) - 0.35], best]);
                    x -= Lb + rng.range(0.8, 2.5);
                }
            }
        }
        // a couple of dinghies tied up at the quay, and buoys out in the open
        for (let i = 0; i < 3; i++) {
            const y = geo.lerp(ya, yb, rng.random());
            if (!free(y - 3, y + 3) || !rng.chance(p.boats)) continue;
            taken.push([y - 3, y + 3]);
            boat(T, xq - 1.2, y, rng.pick([1, 3]), rng, 'row');
        }
        const nBuoys = rng.int(1, 3);
        for (let i = 0; i < nBuoys; i++) {
            const x = xq - rng.range(28, 48), y = geo.lerp(ya, yb, rng.random());
            if (onPage(x, y, 0, -8)) buoy(T, x, y);
        }
        if (bw) {
            S.shadow = water;
            breakwater(T, xq, bw.y, bw.len, rng);
        }
        S.shadow = null;
        return water;
    }

    // Rows of short dashes across the open water, in page space like a
    // printed map, left out where they'd touch anything
    function waterMarks(T, xq, water, seed) {
        const { S, cam } = T;
        const rng = new PG.RNG(hash(seed, 70));
        const rowGap = 5.2, colGap = 15, dash = 4;
        const inShadow = (x, y) => water && water.polys.some(P => PG.geo.pointInPolygon(x, y, P));
        S.kind = BLUE;
        for (let row = 0, sy = rowGap * 0.6; sy < S.H; row++, sy += rowGap) {
            const off = (row % 2 ? colGap / 2 : 0) + rng.range(-2, 2);
            for (let sx = off - colGap; sx < S.W + colGap; sx += colGap) {
                const cx = sx + rng.range(-0.18, 0.18) * colGap, len = dash * rng.range(0.75, 1.2);
                const [x, y] = cam.ground(cx, sy, 0);
                if (x > xq - 1.2 || inShadow(x, y)) continue;
                const a = cam.ground(cx - len / 2, sy, 0), b = cam.ground(cx + len / 2, sy, 0);
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
        const bw = p.blockW, bd = p.blockD, av = p.avenue, st = p.street;
        const PX = bd + av, PY = bw + st;
        const gy = ph.range(-PY, 0);
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
        // where the quay crosses the page
        let ya = Infinity, yb = -Infinity;
        for (let y = Y0 - 20; y <= Y1 + 20; y += 1) {
            const q = cam.project(xq, y, LAND);
            if (q[0] > -20 && q[1] > -20 && q[0] < S.W + 20 && q[1] < S.H + 20) { ya = Math.min(ya, y); yb = Math.max(yb, y); }
        }
        const x0 = xq + Math.max(av, 9);
        const median = ph.int(0, 1);
        const i1 = Math.ceil((X1 - x0) / PX);
        const j0 = Math.floor((Y0 - gy) / PY) - 1, j1 = Math.ceil((Y1 - gy) / PY);
        if (i1 < 0 || (i1 + 1) * (j1 - j0 + 1) > 20000) return;
        // the clock tower goes in the block nearest the middle of the page
        let tower = null, bestD = Infinity;
        if (p.tower) {
            for (let i = 0; i <= i1; i++) {
                for (let j = j0; j <= j1; j++) {
                    const q = cam.project(x0 + i * PX + bd / 2, gy + j * PY + bw / 2, LAND);
                    const dd = Math.hypot(q[0] - S.W * 0.55, q[1] - S.H * 0.45);
                    if (dd < bestD) { bestD = dd; tower = `${i},${j}`; }
                }
            }
        }
        for (let i = 0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                const bx = x0 + i * PX, by = gy + j * PY;
                if (!seen(bx, by, bx + bd, by + bw, 14)) continue;
                const keys = [seed, i, j];
                const r = new PG.RNG(hash(...keys, 2));
                block(T, bx, by, bx + bd, by + bw, keys, {
                    market: i <= 1 && r.chance(p.market * 0.4), tower: tower === `${i},${j}`, nearWater: i === 0,
                });
                // every other street gets a strip down the middle
                const mx = bx + bd + av / 2;
                if (i < i1 && (i + median) % 2 === 0 && av >= 7 && seen(mx - 0.5, by, mx + 0.5, by + bw, 0)) {
                    S.shadow = null;
                    S.kind = INK;
                    S.loop([[mx - 0.45, by + 1.5, LAND], [mx + 0.45, by + 1.5, LAND], [mx + 0.45, by + bw - 1.5, LAND], [mx - 0.45, by + bw - 1.5, LAND]]);
                }
            }
        }
        if (ya < yb) {
            quayRoad(T, xq, ya, yb, seed);
            const water = harbour(T, xq, ya, yb, seed);
            if (p.water) waterMarks(T, xq, water, seed);
        }
    }

    PG.register({
        id: 'harbour',
        name: 'Harbour',
        category: 'Scenes',
        description: 'An isometric fishing town with a quay, piers and a lighthouse, shaded for four pens.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 1, max: 5, step: 0.05, value: 1.8, random: [1.4, 2.4],
                hint: 'How big a metre is on paper' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 15, max: 75, step: 0.5, value: 50, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 39.5, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Harbour' },
            { id: 'shore', label: 'Waterline', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45, random: [0.3, 0.6],
                hint: 'How far down the left edge of the page the quay starts' },
            { id: 'piers', label: 'Piers', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9] },
            { id: 'boats', label: 'Boats', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.4, 1] },
            { id: 'lighthouse', label: 'Lighthouse', type: 'checkbox', value: true },
            { type: 'section', label: 'Streets' },
            { id: 'blockW', label: 'Block length (m)', type: 'range', min: 18, max: 80, step: 1, value: 44, random: [34, 56] },
            { id: 'blockD', label: 'Lot depth (m)', type: 'range', min: 8, max: 40, step: 0.5, value: 12.5, random: [11, 14],
                hint: 'Blocks are one row of lots, or two rows from 24 m' },
            { id: 'avenue', label: 'Street width (m)', type: 'range', min: 5, max: 20, step: 0.5, value: 7.5, random: [6.5, 9],
                hint: 'Streets between the rows of lots. From 7 m every other one gets a median strip' },
            { id: 'street', label: 'Cross street width (m)', type: 'range', min: 4, max: 16, step: 0.5, value: 7, random: [6, 8] },
            { type: 'section', label: 'Buildings' },
            { id: 'houses', label: 'Houses', type: 'range', min: 0, max: 1, step: 0.01, value: 1, random: [0.6, 1] },
            { id: 'apartments', label: 'Apartments', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35, random: [0.1, 0.6] },
            { id: 'warehouses', label: 'Warehouses', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0.1, 0.5] },
            { id: 'workshops', label: 'Workshops', type: 'range', min: 0, max: 1, step: 0.01, value: 0.12, random: [0, 0.3] },
            { id: 'market', label: 'Market halls', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0, 0.6] },
            { id: 'tower', label: 'Clock tower', type: 'checkbox', value: true },
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
                options: [['four', 'Black, red, blue, yellow'], ['three', 'Black, red, blue'], ['one', 'One pen']],
                hint: 'Colours go to pens 1, 2, 3 and 5, matching the default pen set' },
        ],

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
                // roof hatching, in mm on paper
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
            const kinds = render(S);
            const penOf = { four: [0, 1, 2, 4], three: [0, 1, 2, 1], one: [0, 0, 0, 0] }[p.inks] || [0, 1, 2, 4];
            const byPen = [];
            kinds.forEach((paths, kind) => {
                const into = byPen[penOf[kind]] || (byPen[penOf[kind]] = []);
                for (const q of paths) into.push(q);
            });
            const layers = [];
            byPen.forEach((paths, pen) => layers.push({ pen, paths }));
            return { layers };
        },
    });
})();
