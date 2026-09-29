/*
 * Fairground: an isometric funfair drawn for four to eight pens, in the same
 * illustrated-map style as Harbour.
 *
 * The park is cut up with a Voronoi diagram. Every ride gets a cell, and each
 * cell is shrunk in by half a path width, which leaves the gaps between them
 * as the paths. So the paths always run between the rides, never through
 * them, and they meet at odd angles like a real park. Big rides go in the
 * roomiest cells and the rest become gardens, game stalls or the food court.
 * The roller coaster takes two neighbouring cells and runs a figure of eight
 * over the path between them.
 *
 * Red is for stripes and lit roof slopes, blue for shadows and the lake,
 * yellow for gondolas, cars, flags and pennants. Six pens add green trees and
 * purple people, eight add light blue water and brown paths.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, hull, Scene, segments } = PG.iso;
    const {
        wall, rect, gableRoof, bench, unit, outward, shade, shadeGable, awning, marketHall, cart, bistro,
        crookLamp, railFence, fountain, bandstand, hullSolid, turned, withKind,
    } = PG.isokit;

    // line kinds. The last four only get pens of their own with six or eight pens.
    const INK = 0, RED = 1, BLUE = 2, YELLOW = 3, GREEN = 4, FIGURE = 5, WATER = 6, PATH = 7;
    const person = withKind(FIGURE, PG.isokit.person), roundTree = withKind(GREEN, PG.isokit.roundTree);
    const SUN_TURN = geo.rad(65); // as in Harbour: shadows fall along +x, turned this far towards -y

    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const Z = [0, 0, 1];

    // Frame from an origin and three axes (unit vectors), for things at any angle
    function axes(O, U, V, W) {
        return {
            P: (a, b, c) => [O[0] + a * U[0] + b * V[0] + c * W[0], O[1] + a * U[1] + b * V[1] + c * W[1], O[2] + a * U[2] + b * V[2] + c * W[2]],
            V: (a, b, c) => [a * U[0] + b * V[0] + c * W[0], a * U[1] + b * V[1] + c * W[1], a * U[2] + b * V[2] + c * W[2]],
        };
    }

    // Round bar between two world points, smooth so only its outline shows
    function tube(T, p0, p1, r, n = 8) {
        const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], a = unit(d);
        const e1 = unit(Math.abs(a[2]) < 0.9 ? cross(a, Z) : cross(a, [1, 0, 0])), e2 = cross(a, e1);
        T.S.prism(ring(n, (c, s) => add(p0, add(mul(e1, r * c), mul(e2, r * s)))), d, true);
    }

    // Draw in a kind for a moment
    function inKind(S, kind, fn) {
        const keep = S.kind;
        S.kind = kind;
        fn();
        S.kind = keep;
    }

    // Stripes down a surface of revolution at (x, y), from a lathe profile of
    // [r, z]: a seam between each of n sectors, and every other sector filled
    // with lines close enough to read as solid. Just the seams without tones.
    function stripes(T, x, y, prof, n, a0) {
        const S = T.S, rmax = Math.max(...prof.map(q => q[0]));
        const merid = a => prof.map(([r, z]) => [x + (r * 1.015 + 0.01) * Math.cos(a), y + (r * 1.015 + 0.01) * Math.sin(a), z]);
        const step = 0.3 / (T.k * rmax);
        for (let i = 0; i < n; i++) {
            const s0 = a0 + (TAU * i) / n, s1 = s0 + TAU / n;
            S.line(merid(s0));
            if (i % 2 || !T.tones) continue;
            inKind(S, RED, () => {
                for (let a = s0 + step / 2; a < s1 - step / 4; a += step) S.line(merid(a));
            });
        }
    }

    // Scalloped edge hanging from a circle, one scallop per sector
    function valance(T, x, y, r, z, n, drop = 0.3) {
        const pts = [], m = n * 8;
        for (let i = 0; i <= m; i++) {
            const a = (TAU * i) / m;
            pts.push([x + r * Math.cos(a), y + r * Math.sin(a), z - drop * Math.abs(Math.sin((Math.PI * i) / 8))]);
        }
        T.S.line(pts);
    }

    // Pole with a pennant flag, flying off to the right of the page
    function flag(T, x, y, z, h) {
        const S = T.S, c = T.cam;
        S.line([[x, y, z], [x, y, z + h]]);
        const at = (s, dz) => [x + c.rx * s, y + c.ry * s, z + h + dz];
        const f = [at(0, 0), at(1.3, -0.35), at(0, -0.75)];
        S.face(f);
        inKind(S, YELLOW, () => {
            S.loop(f);
            if (T.tones) S.hatch(f, [0, 0, 1], T.hLit);
        });
    }

    // String of pennants between two world points, sagging in the middle
    function pennants(T, p0, p1, rng) {
        const S = T.S, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 2) return;
        const sag = L * 0.08, at = t => [geo.lerp(p0[0], p1[0], t), geo.lerp(p0[1], p1[1], t), geo.lerp(p0[2], p1[2], t) - sag * 4 * t * (1 - t)];
        S.line(Array.from({ length: 13 }, (_, i) => at(i / 12)));
        const n = Math.floor(L / 0.7), flip = rng.chance(0.5);
        for (let i = 1; i < n; i++) {
            const q = at(i / n), w = 0.18, ux = ((p1[0] - p0[0]) / L) * w, uy = ((p1[1] - p0[1]) / L) * w;
            const tri = [[q[0] - ux, q[1] - uy, q[2]], [q[0] + ux, q[1] + uy, q[2]], [q[0], q[1], q[2] - 0.4]];
            S.face(tri, false);
            inKind(S, T.tones ? ((i % 2) === (flip ? 1 : 0) ? RED : YELLOW) : S.kind, () => S.loop(tri));
        }
    }

    // Someone sitting on a ride: head and shoulders
    function rider(T, x, y, z) {
        const S = T.S, ce = T.cam.ce, P = card(T, x, y, z, 0.05), hr = 0.13;
        const body = [P(-0.2, 0), P(0.2, 0), P(0.2, 0.45), P(0.12, 0.52), P(-0.12, 0.52), P(-0.2, 0.45)];
        S.face(body);
        S.loop(body);
        const head = ring(T.segs(hr), (c, s) => P(hr * c, 0.52 + hr / ce + (hr * s) / ce));
        S.face(head);
        S.loop(head);
    }

    // ------------------------------------------------------------------
    // Rides
    // ------------------------------------------------------------------

    // Carousel: horses on poles on a round platform, under a striped canopy
    // with a scalloped frieze, round a drum in the middle
    function carousel(T, x, y, r, rng) {
        const S = T.S, n = T.segs(r + 0.4), a0 = rng.range(0, TAU);
        S.lathe(x, y, [[r + 0.4, 0], [r + 0.4, 0.3]], n);
        S.lathe(x, y, [[r, 0.3], [r, 0.8]], n);
        S.lathe(x, y, [[1.6, 0.8], [1.6, 4.2]], T.segs(1.6));
        const zc = 4.3, rc = r + 0.35, roof = [[rc, zc + 0.7], [rc * 0.55, zc + 1.9], [0.5, zc + 2.6], [0, zc + 2.75]];
        S.lathe(x, y, [[rc, zc]].concat(roof), T.segs(rc));
        stripes(T, x, y, roof, 2 * Math.round(r * 1.3), a0);
        valance(T, x, y, rc + 0.02, zc, 2 * Math.round(r * 1.3), 0.35);
        flag(T, x, y, zc + 2.75, 1.4);
        // two rings of poles, each with a horse riding up or down it
        for (const [rr, m] of [[r - 1, Math.round(r * 2.2)], [r - 2.4, Math.round(r * 1.6)]]) {
            if (rr < 2.4) continue;
            for (let i = 0; i < m; i++) {
                const a = a0 + (TAU * (i + (rr < r - 1 ? 0.5 : 0))) / m, px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
                S.line([[px, py, 0.8], [px, py, zc]]);
                horse(T, px, py, 1.1 + 0.45 * Math.sin(a * 3 + a0), [-Math.sin(a), Math.cos(a)]);
            }
        }
    }

    // Galloping horse cut-out in the upright plane along t, pole through the middle
    const HORSE = [[-0.62, 0.92], [0.28, 0.95], [0.46, 1.2], [0.56, 1.5], [0.68, 1.56], [0.92, 1.36], [0.9, 1.26], [0.64, 1.28],
        [0.5, 1.02], [0.54, 0.72], [0.86, 0.56], [0.82, 0.46], [0.44, 0.6], [0.3, 0.52], [-0.42, 0.52], [-0.78, 0.3], [-0.86, 0.36],
        [-0.62, 0.66], [-0.92, 0.7], [-0.96, 0.84]];
    function horse(T, x, y, z, t) {
        const S = T.S, P = (s, c) => [x + t[0] * s, y + t[1] * s, z + c - 0.9];
        const pts = HORSE.map(([s, c]) => P(s, c));
        S.face(hull(HORSE).map(([s, c]) => P(s, c)));
        S.loop(pts);
    }

    // Circus big top: striped walls under a striped tent slung from a king
    // pole, a scalloped valance, guy ropes out to stakes and flags on top
    function bigTop(T, x, y, R, rng) {
        const S = T.S, n = Math.max(20, T.segs(R)), sec = 2 * Math.round(R * 0.75), a0 = rng.range(0, TAU), hw = 3.4;
        S.lathe(x, y, [[R, 0], [R, hw]], n);
        stripes(T, x, y, [[R, 0], [R, hw]], sec, a0 + Math.PI / sec);
        const roof = [[R + 0.5, hw - 0.15], [R * 0.76, hw + 3.3], [R * 0.5, hw + 6.6], [R * 0.28, hw + 9.6], [R * 0.1, hw + 12], [0.4, hw + 12.8]];
        S.lathe(x, y, roof.concat([[0.4, hw + 12.9]]), n);
        stripes(T, x, y, roof, sec, a0);
        valance(T, x, y, R + 0.52, hw - 0.15, sec, 0.45);
        // guy ropes and stakes
        for (let i = 0; i < sec; i++) {
            const a = a0 + (TAU * i) / sec, c = Math.cos(a), s = Math.sin(a);
            const e = [x + (R + 0.5) * c, y + (R + 0.5) * s, hw - 0.2], g = [x + (R + 3.4) * c, y + (R + 3.4) * s, 0];
            S.line([e, g]);
            S.line([g, [g[0] + c * 0.15, g[1] + s * 0.15, 0.35]]);
        }
        const top = hw + 12.9;
        flag(T, x, y, top, 2.2);
        // pennants from the king pole out to the eaves
        for (let i = 0; i < 4; i++) {
            const a = a0 + Math.PI / 4 + (i * Math.PI) / 2;
            pennants(T, [x, y, top + 1.6], [x + (R + 0.5) * Math.cos(a), y + (R + 0.5) * Math.sin(a), hw + 0.2], rng);
        }
        // way in on the side facing us, dark inside
        const c = T.cam, fa = Math.atan2(-c.fy, -c.fx), ux = -Math.sin(fa), uy = Math.cos(fa);
        const ox = x + (R + 0.12) * Math.cos(fa), oy = y + (R + 0.12) * Math.sin(fa), w = 1.4;
        const door = [[ox - ux * w, oy - uy * w, 0], [ox + ux * w, oy + uy * w, 0], [ox + ux * w * 0.6, oy + uy * w * 0.6, 2.7], [ox - ux * w * 0.6, oy - uy * w * 0.6, 2.7]];
        S.face(door, false);
        S.loop(door);
        S.hatch(door, [0, 0, 1], (T.hDark || 0.5) * 0.8);
        return fa;
    }

    // One gondola hanging under its pivot on the wheel, E across the wheel
    // and A along the axle
    function gondola(T, p, E, A) {
        const S = T.S, F = axes(p, E, A, Z);
        S.line([p, F.P(0, 0, -0.55)]);
        S.box(F, -0.8, -0.85, -2, 0.8, 0.85, -0.6);
        const c = [F.P(-0.95, -1, -0.6), F.P(0.95, -1, -0.6), F.P(0.95, 1, -0.6), F.P(-0.95, 1, -0.6)], apex = F.P(0, 0, -0.1);
        S.solid(c.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
        const centre = F.P(0, 0, -0.5);
        for (let i = 0; i < 4; i++) {
            const tri = [c[i], c[(i + 1) % 4], apex];
            shade(T, tri, outward(tri, centre), 'canopy');
        }
        if (T.detail) S.loop([F.P(-0.8, -0.85, -1.3), F.P(0.8, -0.85, -1.3), F.P(0.8, 0.85, -1.3), F.P(-0.8, 0.85, -1.3)]);
    }

    // Big wheel standing in the plane of E: two lattice rims on spokes round
    // an axle between A-frames, gondolas hanging from the rim and a boarding
    // platform underneath
    function bigWheel(T, x, y, R, E, rng) {
        const S = T.S, A = [-E[1], E[0], 0], hz = R + 2.8, O = [x, y, hz], wr = 1.3;
        const at = (t, r, side) => add(O, add(add(mul(E, r * Math.cos(t)), mul(Z, r * Math.sin(t))), mul(A, side * wr)));
        for (const side of [-1, 1]) {
            const top = add(O, mul(A, side * (wr + 0.9))), feet = [];
            for (const e of [-1, 1]) {
                const g = [x + E[0] * e * R * 0.45 + A[0] * side * (wr + 2.4), y + E[1] * e * R * 0.45 + A[1] * side * (wr + 2.4), 0];
                tube(T, g, top, 0.24, 8);
                feet.push(g);
            }
            for (const f of [0.35, 0.65]) S.line([geo.lerpPt(feet[0], top, f).concat([top[2] * f]), geo.lerpPt(feet[1], top, f).concat([top[2] * f])]);
        }
        tube(T, add(O, mul(A, -(wr + 1.3))), add(O, mul(A, wr + 1.3)), 0.35, 10);
        for (const side of [-1, 1]) tube(T, add(O, mul(A, side * wr - 0.25)), add(O, mul(A, side * wr + 0.25)), 1.1, 12);
        // rims with zigzag bracing between them, and spokes to the hubs
        const m = 96, ns = 2 * Math.round(R * 0.9), ri = R * 0.9;
        for (const side of [-1, 1]) {
            S.loop(Array.from({ length: m }, (_, i) => at((TAU * i) / m, R, side)));
            S.loop(Array.from({ length: m }, (_, i) => at((TAU * i) / m, ri, side)));
            if (T.detail) S.loop(Array.from({ length: ns * 2 }, (_, i) => at((Math.PI * i) / ns, i % 2 ? R : ri, side)));
            for (let i = 0; i < ns; i++) S.line([at((TAU * i) / ns, 1.1, side), at((TAU * i) / ns, ri, side)]);
        }
        const ng = Math.round(R * 1.1), t0 = rng.range(0, TAU);
        for (let i = 0; i < ng; i++) {
            const t = t0 + (TAU * i) / ng;
            S.line([at(t, R, -1), at(t, R, 1)]);
            gondola(T, at(t, R, 0), E, A);
        }
        // platform at the bottom, with steps up from the side we see
        const F = axes([x, y, 0], E, A, Z);
        S.box(F, -3.2, -(wr + 1.6), 0, 3.2, wr + 1.6, 0.8);
        for (let i = 0; i < 3; i++) S.box(F, -3.2 - 0.35 * (i + 1), -1, 0, -3.2 - 0.35 * i, 1, 0.8 - 0.27 * (i + 1));
        railFence(T, F.P(-3.1, -(wr + 1.5), 0.8), F.P(3.1, -(wr + 1.5), 0.8), 1);
        railFence(T, F.P(-3.1, wr + 1.5, 0.8), F.P(3.1, wr + 1.5, 0.8), 1);
    }

    // Helter skelter: a striped eight-sided tower with a hut and a pointed
    // roof on top, and a slide spiralling down round it
    function helterSkelter(T, x, y, rng) {
        const S = T.S, H = rng.range(11, 14), r0 = 2.4, r1 = 2, rot = rng.range(0, TAU);
        S.lathe(x, y, [[r0, 0], [r1, H]], 8, false, rot);
        if (T.tones) {
            // every other side painted
            const c = T.cam;
            for (let i = 0; i < 8; i += 2) {
                const a = rot + (TAU * i) / 8, b = rot + (TAU * (i + 1)) / 8, m = (a + b) / 2;
                if (Math.cos(m) * c.fx + Math.sin(m) * c.fy > 0.2) continue;
                const pt = (ang, r, z) => [x + r * Math.cos(ang), y + r * Math.sin(ang), z];
                const f = [pt(a, r0 + 0.01, 0), pt(b, r0 + 0.01, 0), pt(b, r1 + 0.01, H), pt(a, r1 + 0.01, H)];
                inKind(S, RED, () => S.hatch(f, [0, 0, 1], 0.3));
            }
        }
        S.lathe(x, y, [[3, H], [3, H + 0.3]], T.segs(3));
        S.lathe(x, y, [[2, H + 0.3], [2, H + 2.3]], 8, false, rot);
        const roof = [[2.6, H + 2.3], [0, H + 4.6]];
        S.lathe(x, y, roof, T.segs(2.6));
        stripes(T, x, y, roof, 10, rot);
        flag(T, x, y, H + 4.6, 1.2);
        // the slide: a ribbon of triangles with a lip along its outer edge
        const turns = rng.range(2.5, 3.3), N = Math.round(turns * 40), th0 = rng.range(0, TAU), dirn = rng.sign();
        const I = [], O = [], L = [];
        for (let i = 0; i <= N; i++) {
            const f = i / N, a = th0 + dirn * TAU * turns * f, z = H - 0.1 - (H - 0.55) * f, rt = geo.lerp(r0, r1, z / H) + 0.05;
            const c = Math.cos(a), s = Math.sin(a);
            I.push([x + rt * c, y + rt * s, z]);
            O.push([x + (rt + 1.6) * c, y + (rt + 1.6) * s, z]);
            L.push([x + (rt + 1.6) * c, y + (rt + 1.6) * s, z + 0.5]);
        }
        for (let i = 0; i < N; i++) {
            S.face([I[i], O[i], O[i + 1]]);
            S.face([I[i], O[i + 1], I[i + 1]]);
            S.face([O[i], O[i + 1], L[i + 1], L[i]]);
        }
        S.line(O);
        S.line(L);
        S.line(I);
        if (T.tones) inKind(S, YELLOW, () => S.line(L.map(q => [q[0], q[1], q[2] - 0.25])));
        const e = O[N], mat = frame(e[0], e[1], 0, 0);
        S.box(mat, -1.2, -1.2, 0, 1.2, 1.2, 0.25);
    }

    // Chair swing ride: a tower with a striped umbrella on top and seats
    // flying out on chains
    function swingRide(T, x, y, rng) {
        const S = T.S, H = rng.range(8.5, 10.5), rc = 4.8, n = 2 * rng.int(8, 11), a0 = rng.range(0, TAU);
        S.lathe(x, y, [[3.2, 0], [3.2, 0.45]], T.segs(3.2));
        S.lathe(x, y, [[0.9, 0.45], [0.7, H]], 16);
        const top = [[rc, H + 0.5], [0.8, H + 2.2], [0, H + 2.5]];
        S.lathe(x, y, [[rc, H]].concat(top), T.segs(rc));
        stripes(T, x, y, top, n, a0);
        valance(T, x, y, rc + 0.02, H, n, 0.3);
        flag(T, x, y, H + 2.5, 1.2);
        const al = rng.range(0.6, 0.8), len = 5.2;
        for (let i = 0; i < n; i++) {
            const a = a0 + (TAU * (i + 0.5)) / n, c = Math.cos(a), s = Math.sin(a), tx = -s, ty = c;
            const ax = x + rc * 0.92 * c, ay = y + rc * 0.92 * s, r2 = rc * 0.92 + len * Math.sin(al), sz = H - len * Math.cos(al);
            const sx = x + r2 * c, sy = y + r2 * s;
            for (const o of [-0.22, 0.22]) S.line([[ax + tx * o, ay + ty * o, H], [sx + tx * o, sy + ty * o, sz]]);
            const F = axes([sx, sy, sz], [tx, ty, 0], [c, s, 0], Z);
            S.box(F, -0.25, -0.22, -0.08, 0.25, 0.22, 0);
            if (rng.chance(0.7)) rider(T, sx, sy, sz);
        }
    }

    // Drop tower: a tall square mast with lattice on its sides, a ring of
    // seats partway up and a cap on top
    function dropTower(T, x, y, rng) {
        const S = T.S, H = rng.range(32, 44), w = 1.3, F = frame(x, y, 0, 0);
        S.box(F, -3, -3, 0, 3, 3, 0.6);
        S.box(F, -w, -w, 0.6, w, w, H);
        if (T.detail) {
            for (const [p0, p1] of [[[-w, -w], [w, -w]], [[-w, -w], [-w, w]]]) {
                const A = (u, c) => F.P(p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, c);
                for (let z = 0.6; z + 2.6 <= H; z += 2.6) {
                    S.line([A(0.1, z), A(0.9, z + 2.6)]);
                    S.line([A(0.9, z), A(0.1, z + 2.6)]);
                }
            }
        }
        S.box(F, -1.9, -1.9, H, 1.9, 1.9, H + 1.4);
        S.line([F.P(0, 0, H + 1.4), F.P(0, 0, H + 4)]);
        const g = rng.range(4, H - 8);
        S.lathe(x, y, [[1.5, g], [3.3, g + 0.3], [3.3, g + 1.3], [1.5, g + 1.5]], T.segs(3.3));
        if (T.tones) inKind(S, YELLOW, () => S.loop(ring(T.segs(3.3), (c, s) => [x + 3.36 * c, y + 3.36 * s, g + 0.8])));
        const m = 14;
        for (let i = 0; i < m; i++) {
            const a = (TAU * i) / m, rx = x + 3.1 * Math.cos(a), ry = y + 3.1 * Math.sin(a);
            rider(T, rx, ry, g + 1.25);
            S.line([[rx, ry, g + 0.3], [rx, ry, g - 0.5]]);
        }
    }

    // Swinging pirate ship caught mid-swing: a hull hanging from an axle
    // between two A-frames, with a mast and a black flag
    function pirateShip(T, x, y, D, rng) {
        const S = T.S, A = [-D[1], D[0], 0], hp = 11.5, L = rng.range(12, 14), B = 4.2;
        for (const side of [-1, 1]) {
            const top = [x + A[0] * side * (B / 2 + 1.3), y + A[1] * side * (B / 2 + 1.3), hp];
            for (const e of [-1, 1]) tube(T, [x + D[0] * e * 5.6 + A[0] * side * (B / 2 + 2), y + D[1] * e * 5.6 + A[1] * side * (B / 2 + 2), 0], top, 0.25, 8);
        }
        tube(T, [x - A[0] * (B / 2 + 1.6), y - A[1] * (B / 2 + 1.6), hp], [x + A[0] * (B / 2 + 1.6), y + A[1] * (B / 2 + 1.6), hp], 0.3, 8);
        const ph = rng.sign() * rng.range(0.3, 0.55), cp = Math.cos(ph), sp = Math.sin(ph);
        const U = [D[0] * cp, D[1] * cp, sp], W = [-D[0] * sp, -D[1] * sp, cp];
        const O = add([x, y, hp], mul(W, -8.6)), F = axes(O, U, A, W);
        const Hl = hullSolid(T, F, L, B, 1.9, 0.9, false);
        // arms from the axle down to the gunwales
        for (const side of [-1, 1]) {
            for (const u of [-L * 0.3, L * 0.3]) tube(T, [x + A[0] * side * (B / 2 + 0.9), y + A[1] * side * (B / 2 + 0.9), hp], F.P(u, side * Hl.half(u) * 0.9, Hl.z(u)), 0.14, 6);
        }
        // stripe along the side, mast and flag, and people along the deck
        if (T.tones) inKind(S, YELLOW, () => {
            for (const side of [-1, 1]) S.line(Array.from({ length: 21 }, (_, i) => { const u = -L / 2 + (L * i) / 20; return F.P(u, side * Hl.half(u) * 0.99, Hl.z(u) - 0.45); }));
        });
        const mz = Hl.z(0);
        S.line([F.P(0, 0, mz), F.P(0, 0, mz + 6)]);
        const fl = [F.P(0.05, 0, mz + 6), F.P(1.9, 0, mz + 6), F.P(1.9, 0, mz + 4.9), F.P(0.05, 0, mz + 4.9)];
        S.face(fl);
        S.loop(fl);
        S.hatch(fl, U, (T.hDark || 0.5) * 0.7);
        for (let u = -L * 0.35; u < L * 0.36; u += 1.1) {
            for (const v of [-0.9, 0.9]) {
                if (rng.chance(0.75)) rider(T, ...F.P(u, v, Hl.z(u) - 0.3));
            }
        }
    }

    // Teacups: three turntables of cups going round a big teapot
    function teacups(T, x, y, r, rng) {
        const S = T.S;
        S.lathe(x, y, [[r, 0], [r, 0.45]], T.segs(r));
        // teapot in the middle
        S.lathe(x, y, [[1.1, 0.45], [1.6, 1.3], [1.4, 2.2], [0.7, 2.5]], T.segs(1.6));
        S.lathe(x, y, [[0.5, 2.5], [0.25, 2.8], [0, 2.95]], 10);
        const c = T.cam;
        S.line([[x + c.rx * 1.4, y + c.ry * 1.4, 1.2], [x + c.rx * 2.3, y + c.ry * 2.3, 2.2], [x + c.rx * 2.5, y + c.ry * 2.5, 2.3]]);
        const a0 = rng.range(0, TAU);
        for (let k = 0; k < 3; k++) {
            const a = a0 + (TAU * k) / 3, tr = r * 0.34, tx = x + r * 0.58 * Math.cos(a), ty = y + r * 0.58 * Math.sin(a);
            S.lathe(tx, ty, [[tr, 0.45], [tr, 0.6]], T.segs(tr));
            const b0 = rng.range(0, TAU);
            for (let j = 0; j < 3; j++) {
                const b = b0 + (TAU * j) / 3;
                cup(T, tx + tr * 0.52 * Math.cos(b), ty + tr * 0.52 * Math.sin(b), 0.6, (k + j) % 2 ? RED : YELLOW, rng);
            }
        }
    }

    function cup(T, x, y, z, kind, rng) {
        const S = T.S, c = T.cam;
        S.lathe(x, y, [[0.55, z], [0.8, z + 0.3], [0.95, z + 0.9], [0.95, z + 1]], T.segs(0.95));
        S.loop(ring(T.segs(0.8), (u, v) => [x + 0.8 * u, y + 0.8 * v, z + 1]));
        if (T.tones) inKind(S, kind, () => S.loop(ring(T.segs(0.9), (u, v) => [x + 0.905 * u, y + 0.905 * v, z + 0.62])));
        const h = [];
        for (let i = 0; i <= 8; i++) {
            const t = (Math.PI * i) / 8, o = 0.95 + 0.28 * Math.sin(t);
            h.push([x + c.rx * o, y + c.ry * o, z + 0.3 + 0.55 * (1 - Math.cos(t)) / 2 + 0.05]);
        }
        S.line(h);
        if (rng.chance(0.6)) rider(T, x, y, z + 0.5);
    }

    // Bumper cars: a floor under a flat roof on posts, a striped frieze
    // and a sign, and cars going every which way underneath
    function bumperCars(T, x, y, D, r, rng) {
        const S = T.S, A = [-D[1], D[0], 0], L = Math.min(20, r * 1.6), W = Math.min(13, r * 1.1), h = 4;
        const F = axes([x, y, 0], D, A, Z);
        S.box(F, -L / 2, -W / 2, 0, L / 2, W / 2, 0.35);
        for (const b of [-W / 2, W / 2 - 0.25]) {
            const n = Math.max(2, Math.round(L / 5));
            for (let i = 0; i <= n; i++) {
                const a = -L / 2 + ((L - 0.25) * i) / n;
                S.box(F, a, b, 0.35, a + 0.25, b + 0.25, h);
            }
        }
        // beams round the top and an open grid for the ceiling, so the cars show through
        S.box(F, -L / 2 - 0.3, -W / 2 - 0.3, h, L / 2 + 0.3, -W / 2 + 0.2, h + 0.45);
        S.box(F, -L / 2 - 0.3, W / 2 - 0.2, h, L / 2 + 0.3, W / 2 + 0.3, h + 0.45);
        S.box(F, -L / 2 - 0.3, -W / 2 + 0.2, h, -L / 2 + 0.2, W / 2 - 0.2, h + 0.45);
        S.box(F, L / 2 - 0.2, -W / 2 + 0.2, h, L / 2 + 0.3, W / 2 - 0.2, h + 0.45);
        if (T.detail) {
            for (let a = -L / 2 + 1.5; a < L / 2 - 0.5; a += 1.5) S.line([F.P(a, -W / 2 + 0.2, h + 0.2), F.P(a, W / 2 - 0.2, h + 0.2)]);
            for (let b = -W / 2 + 1.5; b < W / 2 - 0.5; b += 1.5) S.line([F.P(-L / 2 + 0.2, b, h + 0.2), F.P(L / 2 - 0.2, b, h + 0.2)]);
        }
        // striped frieze along the two sides we see, and a sign on the roof
        const c = T.cam, see = v => v[0] * c.fx + v[1] * c.fy < 0;
        if (see(mul(A, -1))) awning(T, F, -L / 2, L / 2, -W / 2 - 0.3, h, 0.9, T.tones ? RED : undefined);
        const sgn = see(D) ? -1 : 1;
        S.box(F, -L * 0.3, sgn * (W / 2 - 0.1), h + 0.45, L * 0.3, sgn * (W / 2 + 0.1), h + 1.8);
        if (T.tones) {
            inKind(S, YELLOW, () => {
                const b = sgn < 0 ? -W / 2 - 0.12 : W / 2 + 0.12;
                const zig = [];
                for (let i = 0; i <= 16; i++) zig.push(F.P(-L * 0.28 + (L * 0.56 * i) / 16, b, h + 0.75 + (i % 2) * 0.7));
                S.line(zig);
            });
        }
        const n = Math.round((L * W) / 16);
        const spots = [];
        for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
            const a = rng.range(-L / 2 + 1.6, L / 2 - 1.6), b = rng.range(-W / 2 + 1.6, W / 2 - 1.6);
            if (spots.some(([p, q]) => Math.hypot(p - a, q - b) < 2.6)) continue;
            spots.push([a, b]);
            k++;
            const [cx, cy] = F.P(a, b, 0), G = turned(cx, cy, 0.35, rng.range(0, TAU));
            S.box(G, -1.1, -0.75, 0.05, 1.1, 0.75, 0.25);
            S.box(G, -0.95, -0.6, 0.25, 0.95, 0.6, 0.65);
            if (T.tones) inKind(S, YELLOW, () => S.hatch([G.P(-0.95, -0.6, 0.65), G.P(0.95, -0.6, 0.65), G.P(0.95, 0.6, 0.65), G.P(-0.95, 0.6, 0.65)], G.V(0, 1, 0), T.hLit));
            S.line([G.P(-0.8, 0, 0.65), G.P(-0.8, 0, h - 0.35)]);
            rider(T, ...G.P(0.1, 0, 0.5));
        }
    }

    // ------------------------------------------------------------------
    // Roller coaster
    // ------------------------------------------------------------------

    // Where a ray from p inside convex polygon Q heading at angle a leaves it
    function rayOut(Q, p, a) {
        const dx = Math.cos(a), dy = Math.sin(a);
        let best = Infinity;
        for (let i = 0; i < Q.length; i++) {
            const q0 = Q[i], q1 = Q[(i + 1) % Q.length];
            const hit = geo.lineIntersect(p, [dx, dy], q0, [q1[0] - q0[0], q1[1] - q0[1]]);
            if (hit && hit.t > 1e-9 && hit.u >= -1e-9 && hit.u <= 1 + 1e-9) best = Math.min(best, hit.t);
        }
        return [p[0] + dx * best, p[1] + dy * best];
    }

    // Figure of eight round two neighbouring lawns: the long way round the
    // first, over the path, the long way round the second the other way,
    // and back over the path, crossing the first pass. Returns the plan as
    // points about 1 m apart, and where it goes over to the second lawn.
    function eight(A, B, ca, cb) {
        const ab = Math.atan2(cb[1] - ca[1], cb[0] - ca[0]), ba = ab + Math.PI, gap = 0.55, n = 90;
        const arcA = [], arcB = [];
        for (let i = 0; i <= n; i++) arcA.push(rayOut(A, ca, ab + gap + ((TAU - 2 * gap) * i) / n));
        for (let i = 0; i <= n; i++) arcB.push(rayOut(B, cb, ba - gap - ((TAU - 2 * gap) * i) / n));
        const loop = geo.chaikin(arcA.concat(arcB, [arcA[0]]), 3, true);
        const pts = geo.resample(loop, 1);
        if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5) pts.pop();
        // the first point past the middle of the path, heading for B
        let best = 0, bd = Infinity;
        const mid = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2];
        for (let i = 0; i < pts.length / 1.5; i++) {
            const d = Math.hypot(pts[i][0] - mid[0], pts[i][1] - mid[1]);
            if (d < bd && i > pts.length * 0.2) { bd = d; best = i; }
        }
        return { pts, cross: best / pts.length };
    }

    // Height along the track: station, lift hill, a big drop, a hill over the
    // crossing, then smaller hills and back to the station low down
    function heights(H, u1) {
        const k = [[0, 1.8], [0.06 * u1, 1.4], [0.24 * u1, 1.4], [0.62 * u1, H], [0.68 * u1, H * 0.97], [0.86 * u1, 3], [u1, H * 0.62]];
        const b = f => u1 + (1 - u1) * f;
        k.push([b(0.25), 3], [b(0.45), H * 0.42], [b(0.65), 2.8], [b(0.8), H * 0.27], [b(0.93), 2], [1, 1.8]);
        return u => {
            let i = 0;
            while (i + 2 < k.length && k[i + 1][0] < u) i++;
            const [u0, z0] = k[i], [u2, z2] = k[i + 1], t = geo.clamp((u - u0) / Math.max(1e-9, u2 - u0), 0, 1);
            return z0 + (z2 - z0) * (1 - Math.cos(Math.PI * t)) / 2;
        };
    }

    // Roller coaster round two lawns as a figure of eight, over the path
    // between them. The track bed is thin faces so it hides what's behind it
    // and throws a shadow; rails and ties, posts where there's ground to stand
    // them on, a train on the lift hill and a station.
    function coaster(T, A, B, ca, cb, onLawn, rng) {
        const S = T.S, H = rng.range(15, 22);
        const { pts, cross: u1 } = eight(A, B, ca, cb), N = pts.length, zf = heights(H, u1);
        const zs = pts.map((_, i) => zf(i / N));
        const tan = i => {
            const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        };
        const Lr = [], Rr = [];
        for (let i = 0; i < N; i++) {
            const [tx, ty] = tan(i), [x, y] = pts[i];
            Lr.push([x - ty * 0.55, y + tx * 0.55, zs[i]]);
            Rr.push([x + ty * 0.55, y - tx * 0.55, zs[i]]);
        }
        const bed = p => [p[0], p[1], p[2] - 0.12];
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            S.face([bed(Lr[i]), bed(Rr[i]), bed(Rr[j])]);
            S.face([bed(Lr[i]), bed(Rr[j]), bed(Lr[j])]);
        }
        S.loop(Lr);
        S.loop(Rr);
        if (T.detail) for (let i = 0; i < N; i++) S.line([Lr[i], Rr[i]]);
        // chain up the middle of the lift hill
        const l0 = Math.round(0.26 * u1 * N), l1 = Math.round(0.6 * u1 * N);
        if (T.detail) for (let i = l0; i < l1; i += 2) S.line([[pts[i][0], pts[i][1], zs[i] + 0.02], [pts[i + 1][0], pts[i + 1][1], zs[i + 1] + 0.02]]);
        // posts, but not on the path or through the other pass of the track
        const under = (i, x, y) => pts.some((q, j) => Math.abs(j - i) > 8 && Math.abs(j - i) < N - 8 && zs[j] < zs[i] - 1 && Math.hypot(q[0] - x, q[1] - y) < 2.4);
        for (let i = 0; i < N; i += 3) {
            const z = zs[i] - 0.15, [x, y] = pts[i], [tx, ty] = tan(i);
            if (z < 1.6 || !onLawn(x, y) || under(i, x, y)) continue;
            if (z < 6) {
                tube(T, [x, y, 0], [x, y, z], 0.13, 6);
                continue;
            }
            const spread = 0.8 + z * 0.12, g = s => [x - ty * s * spread, y + tx * s * spread, 0], top = s => [x - ty * s * 0.45, y + tx * s * 0.45, z];
            tube(T, g(-1), top(-1), 0.13, 6);
            tube(T, g(1), top(1), 0.13, 6);
            if (T.detail) {
                for (let h = 0; h + 3 < z; h += 3) {
                    const f0 = h / z, f1 = Math.min(1, (h + 3) / z), at = (s, f) => geo.lerpPt(g(s), top(s), f).concat([z * f]);
                    S.line([at(-1, f0), at(1, f1)]);
                    S.line([at(1, f0), at(-1, f1)]);
                }
            }
        }
        // the train, climbing the lift
        const t0 = Math.round(0.5 * u1 * N);
        for (let c = 0; c < 5; c++) {
            const i = t0 - c * 2, j = i + 1, p0 = [pts[i][0], pts[i][1], zs[i]], p1 = [pts[j][0], pts[j][1], zs[j]];
            const U = unit([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), V = unit(cross(Z, U)), W = cross(U, V);
            const F = axes(add(p0, [0, 0, 0.1]), U, V, W);
            S.box(F, -0.85, -0.7, 0, 0.85, 0.7, 0.7);
            if (T.tones) inKind(S, YELLOW, () => S.hatch([F.P(-0.85, -0.7, 0.7), F.P(0.85, -0.7, 0.7), F.P(0.85, 0.7, 0.7), F.P(-0.85, 0.7, 0.7)], V, T.hLit));
            for (const v of [-0.35, 0.35]) rider(T, ...F.P(-0.1, v, 0.55));
        }
        // station over the flat stretch, with a gable roof
        const s0 = Math.round(0.07 * u1 * N), s1 = Math.round(0.23 * u1 * N), sm = Math.round((s0 + s1) / 2);
        const [dx, dy] = tan(sm), len = Math.max(6, s1 - s0), F = axes([pts[sm][0], pts[sm][1], 0], [dx, dy, 0], [-dy, dx, 0], Z);
        S.box(F, -len / 2, 0.8, 0, len / 2, 3.2, 1.2);
        for (const a of [-len / 2 + 0.2, len / 2 - 0.4]) for (const b of [-1.4, 3]) S.box(F, a, b, 0, a + 0.2, b + 0.2, 3.6);
        const R = gableRoof(T, F, [-len / 2, -1.4, len / 2, 3.2], 3.6, true, geo.rad(28), rng, { attic: false });
        shadeGable(T, F, R);
        return { pts, zs, station: F.P(0, 1.5, 0) };
    }

    // ------------------------------------------------------------------
    // Lake, stalls and gardens
    // ------------------------------------------------------------------

    // Swan pedalo: a little hull with a swan's neck up from the bow
    const NECK = [[0.95, 0.55], [1.05, 1.1], [0.88, 1.5], [0.96, 1.95], [1.22, 2.15], [1.52, 2.02], [1.28, 1.96], [1.14, 1.86],
        [1.12, 1.62], [1.34, 1.2], [1.3, 0.6]];
    function swan(T, x, y, ang, rng) {
        const S = T.S, F = turned(x, y, 0, ang);
        const Hl = hullSolid(T, F, 3.2, 1.9, 0.5, 0.2, false);
        S.face(hull(NECK).map(([u, c]) => F.P(u - 0.3, 0, c)));
        S.loop(NECK.map(([u, c]) => F.P(u - 0.3, 0, c)));
        if (T.tones) inKind(S, YELLOW, () => S.line([F.P(1.22, 0, 2.02), F.P(1.5, 0, 2.02)]));
        for (const v of [-1, 1]) S.line(Array.from({ length: 9 }, (_, i) => { const u = -1.4 + i * 0.25; return F.P(u, v * Hl.half(u) * 0.85, Hl.z(u) + 0.35 * Math.sin((Math.PI * i) / 8)); }));
        if (rng.chance(0.8)) rider(T, ...F.P(-0.3, rng.range(-0.3, 0.3), 0.35));
    }

    // Game stall facing the path, in frame F (u along the path, v back into
    // the lawn): a booth with a counter, a striped awning, a sign on top and
    // prizes hanging across the front
    function booth(T, F, w, rng) {
        const S = T.S, d = 2.4, h = 2.8;
        S.box(F, 0, 0.3, 0, w, 0.3 + d, h);
        S.box(F, -0.1, 0.2, h, w + 0.1, 0.4 + d, h + 0.2);
        const front = wall(F, 0, [0, 0.3, w, 0.3 + d]);
        if (T.sees(front.n)) {
            rect(T, front.at, 0.3, 1, w - 0.6, 1.5);
            if (T.detail) {
                const n = Math.max(2, Math.round((w - 0.8) / 0.45));
                for (let i = 0; i < n; i++) {
                    const s = 0.5 + ((w - 1) * (i + 0.5)) / n, r = 0.14, kind = i % 2 ? RED : YELLOW;
                    const pts = ring(T.segs(r), (c, q) => front.at(s + r * c, 2.2 + r * q));
                    inKind(S, T.tones ? kind : S.kind, () => S.loop(pts));
                    S.line([front.at(s, 2.5), front.at(s, 2.2 + r)]);
                }
            }
        }
        awning(T, F, 0, w, 0.3, h - 0.05, 0.9, T.tones ? RED : undefined);
        S.box(F, 0.2, 0.3, h + 0.2, w - 0.2, 0.45, h + 1);
        if (T.tones && T.sees(front.n)) {
            inKind(S, YELLOW, () => {
                const z = [];
                for (let i = 0; i <= 10; i++) z.push(F.P(0.35 + ((w - 0.7) * i) / 10, 0.28, h + 0.35 + (i % 2) * 0.45));
                S.line(z);
            });
        }
    }

    // Round flower bed with a low edge and flowers dotted about in colour
    function flowerBed(T, x, y, r, rng) {
        const S = T.S;
        S.lathe(x, y, [[r, 0], [r, 0.25]], T.segs(r));
        const n = Math.round(r * r * 2.2);
        for (let i = 0; i < n; i++) {
            const a = rng.range(0, TAU), d = r * 0.85 * Math.sqrt(rng.random()), fx = x + d * Math.cos(a), fy = y + d * Math.sin(a), fr = 0.12;
            const pts = ring(6, (c, s) => [fx + fr * c, fy + fr * s, 0.32]);
            inKind(S, T.tones ? (i % 2 ? RED : YELLOW) : S.kind, () => S.loop(pts));
        }
    }

    // Balloon seller with a bunch of balloons on strings
    function balloons(T, x, y, rng) {
        const S = T.S, ce = T.cam.ce;
        person(T, x, y, 0, rng);
        const hand = [x + T.cam.rx * 0.25, y + T.cam.ry * 0.25, 1.1];
        for (let i = rng.int(5, 8); i > 0; i--) {
            const bx = hand[0] + T.cam.rx * rng.range(-0.7, 0.9), by = hand[1] + T.cam.ry * rng.range(-0.7, 0.9), bz = rng.range(2.6, 3.6), r = 0.28;
            const P = card(T, bx, by, bz, 0.1 + i * 0.02), pts = ring(T.segs(r), (c, s) => P(r * c, (r * s) / ce));
            S.line([hand, P(0, -r / ce)]);
            S.face(pts);
            inKind(S, T.tones ? (i % 2 ? RED : YELLOW) : S.kind, () => S.loop(pts));
        }
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    // One lawn of the park (a polygon), keeping track of what's been put on
    // it so nothing lands on anything else
    class Lawn {
        constructor(poly) {
            this.poly = poly;
            this.discs = [];
            const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
            this.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        }

        // distance to the edge, and the nearest point on it
        edge(x, y) {
            let d = Infinity, at = null;
            const P = this.poly;
            for (let i = 0; i < P.length; i++) {
                const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1];
                const t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
                const q = [a[0] + ex * t, a[1] + ey * t], dq = Math.hypot(q[0] - x, q[1] - y);
                if (dq < d) { d = dq; at = q; }
            }
            return { d, at };
        }

        inside(x, y, m = 0) {
            return geo.pointInPolygon(x, y, this.poly) && (m <= 0 || this.edge(x, y).d >= m);
        }

        free(x, y, r) {
            return this.inside(x, y, r) && this.discs.every(([a, b, q]) => (a - x) ** 2 + (b - y) ** 2 >= (q + r) ** 2);
        }

        take(x, y, r) {
            this.discs.push([x, y, r]);
        }

        place(rng, r, tries = 24) {
            const [x0, y0, x1, y1] = this.box;
            for (let i = 0; i < tries; i++) {
                const x = rng.range(x0, x1), y = rng.range(y0, y1);
                if (this.free(x, y, r)) {
                    this.take(x, y, r);
                    return [x, y];
                }
            }
            return null;
        }

        // roughly the biggest circle that fits: the best of a grid, then a finer one round it
        roomiest() {
            let [x0, y0, x1, y1] = this.box, best = [(x0 + x1) / 2, (y0 + y1) / 2, -1];
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 0; i <= 8; i++) {
                    for (let j = 0; j <= 8; j++) {
                        const x = geo.lerp(x0, x1, i / 8), y = geo.lerp(y0, y1, j / 8);
                        if (!geo.pointInPolygon(x, y, this.poly)) continue;
                        const d = this.edge(x, y).d;
                        if (d > best[2]) best = [x, y, d];
                    }
                }
                const hx = (x1 - x0) / 8, hy = (y1 - y0) / 8;
                [x0, y0, x1, y1] = [best[0] - hx, best[1] - hy, best[0] + hx, best[1] + hy];
            }
            return best;
        }
    }

    // Voronoi cells for sites at least `gap` apart in the box, relaxed twice so
    // they come out much the same size. Each cell is the box clipped by the
    // half-planes between its site and the sites around it.
    function voronoi(rng, box, gap) {
        const [X0, Y0, X1, Y1] = box;
        let sites = [];
        const tries = Math.ceil(((X1 - X0) * (Y1 - Y0)) / (gap * gap)) * 30;
        for (let i = 0; i < tries; i++) {
            const q = [rng.range(X0, X1), rng.range(Y0, Y1)];
            if (sites.every(s => (s[0] - q[0]) ** 2 + (s[1] - q[1]) ** 2 > gap * gap)) sites.push(q);
        }
        const cells = () => sites.map((s, i) => {
            let poly = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
            sites.forEach((q, j) => {
                if (j === i || Math.abs(q[0] - s[0]) > 3 * gap || Math.abs(q[1] - s[1]) > 3 * gap) return;
                poly = geo.clipPolygonHalfPlane(poly, [(s[0] + q[0]) / 2, (s[1] + q[1]) / 2], [s[0] - q[0], s[1] - q[1]]);
            });
            return poly;
        });
        for (let k = 0; k < 2; k++) sites = cells().map(P => geo.centroid(P));
        return cells();
    }

    // Queue from the edge of a round ride at (x, y) out to the path: rails
    // either side, people waiting in it and a ticket booth at the end
    function queue(T, c, rr, rng) {
        const S = T.S, { at, d } = c.lawn.edge(c.x, c.y);
        const dx = (at[0] - c.x) / (d || 1), dy = (at[1] - c.y) / (d || 1), len = d - rr - 0.8;
        if (len < 2) return;
        const p = s => [c.x + dx * (rr + 0.4 + s), c.y + dy * (rr + 0.4 + s)], nx = -dy, ny = dx;
        for (const o of [-0.7, 0.7]) {
            const a = p(0), b = p(len);
            railFence(T, [a[0] + nx * o, a[1] + ny * o, 0], [b[0] + nx * o, b[1] + ny * o, 0], 1);
        }
        for (let s = 0.6; s < len - 0.3; s += rng.range(0.8, 1.2)) {
            if (!rng.chance(0.4 + T.p.people * 0.6)) continue;
            const [x, y] = p(s);
            person(T, x + nx * rng.range(-0.2, 0.2), y + ny * rng.range(-0.2, 0.2), 0, rng);
        }
        // ticket booth beside where the queue meets the path
        const [bx, by] = p(len - 0.6), tb = [bx + nx * 2, by + ny * 2];
        if (c.lawn.free(tb[0], tb[1], 1)) {
            const F = axes([tb[0], tb[1], 0], [dx, dy, 0], [nx, ny, 0], Z);
            S.box(F, -0.8, -0.7, 0, 0.8, 0.7, 2.3);
            const R = gableRoof(T, F, [-0.8, -0.7, 0.8, 0.7], 2.3, false, geo.rad(40), rng, { attic: false });
            shadeGable(T, F, R, 'canopy');
            const W = wall(F, 3, [-0.8, -0.7, 0.8, 0.7]);
            if (T.sees(W.n)) rect(T, W.at, 0.3, 1, 0.8, 0.8);
            c.lawn.take(tb[0], tb[1], 1.2);
        }
    }

    // Trees and benches in the spare room on a lawn, facing the path
    function greenery(T, c, rng, trees) {
        const S = T.S;
        for (let i = 0; i < trees; i++) {
            const at = c.lawn.place(rng, 1.4);
            if (at) roundTree(T, at[0], at[1], 0, rng);
        }
        for (let i = rng.int(0, 2); i > 0; i--) {
            const at = c.lawn.place(rng, 1, 16);
            if (!at) continue;
            const { at: e } = c.lawn.edge(at[0], at[1]);
            S.kind = INK;
            bench(T, at[0], at[1], 0, PG.isokit.nearestDir(e[1] - at[1], at[0] - e[0]));
        }
    }

    // Lamp posts along the edges of a lawn with pennants strung between them
    function bunting(T, c, rng) {
        const S = T.S, P = c.poly, gapL = 13;
        for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L < 8) continue;
            const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, into = geo.pointInPolygon(a[0] + (b[0] - a[0]) / 2 + nx, a[1] + (b[1] - a[1]) / 2 + ny, c.lawn.poly) ? 1 : -1;
            const n = Math.max(1, Math.round((L - 4) / gapL)), posts = [];
            for (let k = 0; k <= n; k++) {
                const t = (2 + ((L - 4) * k) / n) / L, x = geo.lerp(a[0], b[0], t) + nx * into * 0.7, y = geo.lerp(a[1], b[1], t) + ny * into * 0.7;
                if (!c.lawn.free(x, y, 0.35)) { posts.push(null); continue; }
                c.lawn.take(x, y, 0.5);
                S.kind = INK;
                crookLamp(T, x, y, 0);
                posts.push([x, y, 3.2]);
                T.posts.push({ c, p: [x, y, 3.2] });
            }
            for (let k = 0; k + 1 < posts.length; k++) {
                if (posts[k] && posts[k + 1] && rng.chance(T.p.bunting)) pennants(T, posts[k], posts[k + 1], rng);
            }
        }
    }

    // Boating lake inside a lawn: a wobbly bank, a jetty, swan pedalos and a
    // fountain jet in the middle. Returns the water outline and the boats'
    // spots, for the water marks.
    function lake(T, c, rng) {
        const S = T.S, core = geo.insetConvex(c.poly, 2.2);
        if (core.length < 3) return null;
        const ring0 = geo.resample(core.concat([core[0]]), 2), ph = rng.range(0, TAU), k = rng.int(2, 3), amp = Math.min(3, c.r * 0.25);
        const cx = c.x, cy = c.y;
        const wob = ring0.map(([x, y]) => {
            const a = Math.atan2(y - cy, x - cx), f = amp * (0.5 + 0.5 * Math.sin(k * a + ph));
            const d = Math.hypot(x - cx, y - cy) || 1;
            return [x - ((x - cx) / d) * f, y - ((y - cy) / d) * f];
        });
        const water = geo.chaikin(wob, 2, true);
        water.pop();
        S.kind = INK;
        S.loop(water.map(([x, y]) => [x, y, 0]));
        const inner = new Lawn(water), edgeLine = [];
        for (const [x, y] of water) {
            const d = Math.hypot(x - cx, y - cy) || 1;
            edgeLine.push([x - ((x - cx) / d) * 0.35, y - ((y - cy) / d) * 0.35, 0]);
        }
        if (T.detail) S.loop(edgeLine);
        c.lawn.take(cx, cy, c.r - 0.5);
        const boats = [];
        // jetty from the bank nearest the path, pedalos tied up along it
        const { at } = c.lawn.edge(cx, cy), jd = unit([cx - at[0], cy - at[1], 0]), bank = inner.edge(at[0], at[1]).at;
        const F = axes([bank[0] - jd[0] * 1.2, bank[1] - jd[1] * 1.2, 0], [jd[0], jd[1], 0], [-jd[1], jd[0], 0], Z), jl = Math.min(7, c.r * 0.6);
        S.box(F, 0, -1, 0.25, jl, 1, 0.45);
        if (T.detail) for (let u = 0.6; u < jl; u += 0.6) S.line([F.P(u, -1, 0.45), F.P(u, 1, 0.45)]);
        for (let u = 1.5; u < jl; u += 2.6) {
            for (const v of [-1, 1]) {
                const [px, py] = F.P(u, v * 2.1, 0);
                if (inner.free(px, py, 1.3)) {
                    swan(T, px, py, Math.atan2(jd[1], jd[0]), rng);
                    inner.take(px, py, 1.6);
                    boats.push([px, py, 2]);
                }
            }
        }
        inner.take(...F.P(jl / 2, 0, 0).slice(0, 2), jl / 2 + 0.5);
        boats.push([...F.P(jl / 2, 0, 0).slice(0, 2), jl / 2 + 1]);
        // the jet in the middle
        inKind(S, WATER, () => {
            const h = rng.range(3.5, 5.5);
            for (let i = 0; i < 8; i++) {
                const a = (TAU * i) / 8, pts = [];
                for (let q = 0; q <= 10; q++) {
                    const t = q / 10, r = 1.6 * t;
                    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), h * 4 * t * (1 - t) * 0.9 + h * (1 - t) * 0.1]);
                }
                S.line(pts);
            }
            S.line([[cx, cy, 0], [cx, cy, h]]);
        });
        inner.take(cx, cy, 2.4);
        boats.push([cx, cy, 2.4]);
        for (let i = Math.round(inner.poly.length / 12 * T.p.boats); i > 0; i--) {
            const at2 = inner.place(rng, 2);
            if (!at2) continue;
            swan(T, at2[0], at2[1], rng.range(0, TAU), rng);
            boats.push([at2[0], at2[1], 2.2]);
        }
        return { water, boats };
    }

    // Short blue dashes in rows across the lake, like the water in Harbour
    function waterMarks(T, lakes, shadows) {
        const { S, cam } = T;
        const rng = new PG.RNG(7);
        const rowGap = 5.2, colGap = 15, dash = 4;
        const shaded = (x, y) => shadows && shadows.polys.some(P => geo.pointInPolygon(x, y, P));
        S.kind = WATER;
        for (const lk of lakes) {
            const W = new Lawn(lk.water);
            const wet = ([x, y]) => W.inside(x, y, 0.9) && !lk.boats.some(([a, b, r]) => Math.hypot(a - x, b - y) < r) && !shaded(x, y);
            for (let row = 0, sy = rowGap * 0.6; sy < S.H; row++, sy += rowGap) {
                const off = (row % 2 ? colGap / 2 : 0) + rng.range(-2, 2);
                for (let sx = off - colGap; sx < S.W + colGap; sx += colGap) {
                    const cx = sx + rng.range(-0.18, 0.18) * colGap, len = dash * rng.range(0.75, 1.2);
                    const a = cam.ground(cx - len / 2, sy, 0), b = cam.ground(cx + len / 2, sy, 0);
                    if (!wet(cam.ground(cx, sy, 0)) || !wet(a) || !wet(b)) continue;
                    S.line([[a[0], a[1], 0], [b[0], b[1], 0]], true);
                }
            }
        }
        S.kind = INK;
    }

    // What goes where. Showpieces take the cells that suit them on the page,
    // the coaster a pair of neighbouring cells, then rides, the lake and the
    // food court, and whatever's left becomes stalls and gardens.
    function assign(T, cells, rng) {
        const { S, p } = T;
        const on = cells.filter(c => c.on);
        const toward = (fx, fy) => c => Math.hypot(c.pc[0] - S.W * fx, c.pc[1] - S.H * fy);
        const take = (need, score, flat = false) => {
            let best = null;
            for (const c of on) if (!c.kind && c.r >= need && (flat || !c.underWheel) && (!best || score(c) < score(best))) best = c;
            return best;
        };
        if (p.wheel) {
            const c = take(10, cc => toward(0.5, 0.38)(cc) + rng.range(0, 20));
            if (c) {
                c.kind = 'wheel';
                // turned a little off square to the camera so it shows some depth
                const f = rng.sign() * rng.range(0.25, 0.45), cm = T.cam;
                c.E = [cm.rx * Math.cos(f) - cm.ry * Math.sin(f), cm.rx * Math.sin(f) + cm.ry * Math.cos(f), 0];
                c.R = geo.clamp(c.r + 5, 13, 19);
                // nothing tall anywhere under the rim, which reaches well into the cells either side
                for (const o of on) {
                    const dx = o.x - c.x, dy = o.y - c.y;
                    if (o !== c && Math.abs(dx * c.E[0] + dy * c.E[1]) < c.R + o.r && Math.abs(dy * c.E[0] - dx * c.E[1]) < o.r + 4) o.underWheel = true;
                }
            }
        }
        if (p.coaster) {
            // two neighbours: they share an edge of the diagram
            const shared = (a, b) => a.cell.filter(q => b.cell.some(v => Math.abs(q[0] - v[0]) + Math.abs(q[1] - v[1]) < 1e-6)).length >= 2;
            let best = null, bs = Infinity;
            for (let i = 0; i < on.length; i++) {
                for (let j = i + 1; j < on.length; j++) {
                    const a = on[i], b = on[j];
                    if (a.kind || b.kind || a.underWheel || b.underWheel || a.r < 8 || b.r < 8 || !shared(a, b)) continue;
                    const s = Math.hypot((a.pc[0] + b.pc[0]) / 2 - S.W * 0.5, (a.pc[1] + b.pc[1]) / 2 - S.H * 0.5) - (a.r + b.r) * 2 + rng.range(0, 25);
                    if (s < bs) { bs = s; best = [a, b]; }
                }
            }
            if (best) {
                best[0].kind = 'coaster';
                best[0].partner = best[1];
                best[1].kind = 'coasterB';
            }
        }
        const one = (kind, need, score, flat) => { const c = take(need, score, flat); if (c) c.kind = kind; };
        if (p.bigtop) one('bigtop', 10.5, c => toward(0.42, 0.62)(c) + rng.range(0, 40));
        if (rng.chance(p.lake)) one('lake', 9, c => toward(0.5, 0.85)(c) + rng.range(0, 40), true);
        one('food', 8, c => toward(0.5, 0.5)(c) + rng.range(0, 60));
        const RIDES = [['carousel', 8.5, 3], ['swings', 10, 2.5], ['helter', 6.5, 2], ['drop', 6.5, 1.6], ['pirate', 9.5, 2], ['teacups', 8.5, 2], ['bumpers', 9, 2]];
        const used = {};
        let n = Math.round(on.filter(c => !c.kind).length * p.rides);
        for (const c of rng.shuffle(on.slice())) {
            if (n <= 0) break;
            if (c.kind || c.underWheel) continue;
            const fits = RIDES.filter(([k, need]) => c.r >= need && (used[k] || 0) < 2);
            if (!fits.length) continue;
            const k = rng.weighted(fits.map(([kind, , w]) => [w / (1 + 2 * (used[kind] || 0)), kind]));
            used[k] = (used[k] || 0) + 1;
            c.kind = k;
            n--;
        }
        for (const c of cells) if (!c.kind) c.kind = c.on && rng.chance(p.stalls) ? 'stalls' : 'garden';
    }

    // Everything on one cell's lawn
    function dressCell(T, c, cells, rng, lakes) {
        const { S, p, cam } = T;
        const { x, y, r } = c;
        S.kind = INK;
        const trees = n => Math.round(n * p.trees * rng.range(0.6, 1.4));
        if (c.kind === 'wheel') {
            const { R, E } = c;
            bigWheel(T, x, y, R, E, rng);
            // keep clear under the wheel, trees either side
            for (let q = -R; q <= R; q += 3) c.lawn.take(x + E[0] * q, y + E[1] * q, 4.8);
            greenery(T, c, rng, trees(3));
            return;
        }
        if (c.kind === 'coaster') {
            const A = geo.insetConvex(c.poly, 2.4), B = geo.insetConvex(c.partner.poly, 2.4);
            if (A.length < 3 || B.length < 3) return;
            const onLawn = (px, py) => c.lawn.inside(px, py, 0.5) || c.partner.lawn.inside(px, py, 0.5);
            const { pts, station } = coaster(T, A, B, [c.x, c.y], [c.partner.x, c.partner.y], onLawn, rng);
            // trees inside the loops, clear of the track
            for (const cc of [c, c.partner]) {
                for (let i = 0; i < pts.length; i += 2) cc.lawn.take(pts[i][0], pts[i][1], 2.8);
                cc.lawn.take(station[0], station[1], 6);
                greenery(T, cc, rng, trees(3));
            }
            return;
        }
        if (c.kind === 'coasterB') return;
        if (c.kind === 'lake') {
            const lk = lake(T, c, rng);
            if (lk) lakes.push(lk);
            greenery(T, c, rng, trees(3));
            return;
        }
        let rr = 0;
        if (c.kind === 'bigtop') {
            rr = Math.min(15, r - 3.5);
            bigTop(T, x, y, rr, rng);
            rr += 3.5;
        } else if (c.kind === 'carousel') {
            rr = Math.min(7.5, r - 1.8);
            carousel(T, x, y, rr, rng);
            rr += 0.4;
        } else if (c.kind === 'swings') {
            swingRide(T, x, y, rng);
            rr = 9;
        } else if (c.kind === 'helter') {
            helterSkelter(T, x, y, rng);
            rr = 4.6;
        } else if (c.kind === 'drop') {
            dropTower(T, x, y, rng);
            rr = 4.2;
        } else if (c.kind === 'pirate') {
            const a = rng.range(0, TAU);
            pirateShip(T, x, y, [Math.cos(a), Math.sin(a), 0], rng);
            rr = 8.8;
        } else if (c.kind === 'teacups') {
            rr = Math.min(7.5, r - 1.8);
            teacups(T, x, y, rr, rng);
        } else if (c.kind === 'bumpers') {
            const a = rng.range(0, TAU);
            bumperCars(T, x, y, [Math.cos(a), Math.sin(a), 0], r - 1, rng);
            rr = Math.hypot(Math.min(20, (r - 1) * 1.6), Math.min(13, (r - 1) * 1.1)) / 2;
        } else if (c.kind === 'food') {
            const a = rng.range(0, TAU), D = [Math.cos(a), Math.sin(a), 0], L = Math.min(16, r * 1.3), H = Math.min(8, r * 0.8);
            marketHall(T, axes([x, y, 0], D, [-D[1], D[0], 0], Z), [-L / 2, -H / 2, L / 2, H / 2], rng);
            c.lawn.take(x, y, Math.hypot(L, H) / 2 + 0.6);
            for (let i = rng.int(3, 7); i > 0; i--) {
                const at = c.lawn.place(rng, 1.3);
                if (at) bistro(T, at[0], at[1], 0, rng, rng.chance(0.7));
            }
            for (let i = rng.int(1, 3); i > 0; i--) {
                const at = c.lawn.place(rng, 1.4);
                if (at) { S.kind = INK; cart(T, at[0], at[1], 0, rng); }
            }
        } else if (c.kind === 'stalls') {
            stalls(T, c, rng);
        } else {
            garden(T, c, rng);
        }
        if (rr) {
            c.lawn.take(x, y, rr);
            if (c.kind !== 'helter') queue(T, c, rr, rng);
        }
        greenery(T, c, rng, trees(c.kind === 'garden' ? 5 : 2));
        if (p.bunting > 0) bunting(T, c, rng);
    }

    // Rows of game stalls along the edges of a lawn, facing the paths
    function stalls(T, c, rng) {
        const P = c.poly;
        for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L < 7) continue;
            const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
            // v points into the lawn
            const into = geo.pointInPolygon(a[0] + ux * L / 2 - uy, a[1] + uy * L / 2 + ux, c.lawn.poly) ? 1 : -1;
            const vx = -uy * into, vy = ux * into;
            // only along edges where we'd see the fronts, not a row of backs
            if (vx * T.cam.fx + vy * T.cam.fy < 0.15) continue;
            for (let s = 1.6; s < L - 4; ) {
                const w = rng.range(2.8, 3.6);
                if (s + w > L - 1.6) break;
                const mx = a[0] + ux * (s + w / 2) + vx * 1.6, my = a[1] + uy * (s + w / 2) + vy * 1.6;
                if (c.lawn.free(mx, my, 1.2) && c.lawn.inside(a[0] + ux * s + vx * 0.3, a[1] + uy * s + vy * 0.3, 0.1) && c.lawn.inside(a[0] + ux * (s + w) + vx * 0.3, a[1] + uy * (s + w) + vy * 0.3, 0.1)) {
                    T.S.kind = INK;
                    booth(T, axes([a[0] + ux * s + vx * 0.3, a[1] + uy * s + vy * 0.3, 0], [ux, uy, 0], [vx, vy, 0], Z), w, rng);
                    c.lawn.take(mx, my, w / 2 + 0.4);
                }
                s += w + rng.range(0.3, 1.2);
            }
        }
    }

    // Garden: a fountain, bandstand or flower bed in the middle, more beds about
    function garden(T, c, rng) {
        const S = T.S;
        S.kind = INK;
        const k = rng.weighted([[3, 'fountain'], [c.r >= 6 ? 2 : 0, 'bandstand'], [3, 'bed']]);
        let rad;
        if (k === 'fountain') rad = fountain(T, c.x, c.y, 0, rng);
        else if (k === 'bandstand') rad = bandstand(T, c.x, c.y, 0, rng);
        else {
            rad = Math.min(3.5, c.r - 1);
            flowerBed(T, c.x, c.y, rad, rng);
        }
        c.lawn.take(c.x, c.y, rad + 1);
        for (let i = rng.int(1, 3); i > 0; i--) {
            const r = rng.range(1.2, 2), at = c.lawn.place(rng, r + 0.5);
            if (at) flowerBed(T, at[0], at[1], r, rng);
        }
    }

    // A few strings of pennants across the paths, between lamps on either side
    function across(T, rng) {
        const P = T.posts, pw = T.p.paths;
        for (let i = 0; i < P.length; i++) {
            if (P[i].used || !rng.chance(T.p.bunting * 0.4)) continue;
            let best = null, bd = Infinity;
            for (const q of P) {
                if (q.c === P[i].c || q.used) continue;
                const d = Math.hypot(q.p[0] - P[i].p[0], q.p[1] - P[i].p[1]);
                if (d > pw + 0.6 && d < pw + 6 && d < bd) { bd = d; best = q; }
            }
            if (!best) continue;
            pennants(T, P[i].p, best.p, rng);
            P[i].used = best.used = true;
        }
    }

    // Entrance gate over a path: two towers with pointed roofs and flags, and
    // an arched sign between them with a sunburst on it
    function gate(T, mid, d, span) {
        const S = T.S, n = [-d[1], d[0], 0], D = [d[0], d[1], 0], hw = span / 2 + 1.3;
        S.kind = INK;
        for (const side of [-1, 1]) {
            const F = axes([mid[0] + n[0] * side * hw, mid[1] + n[1] * side * hw, 0], D, n, Z);
            S.box(F, -0.9, -0.9, 0, 0.9, 0.9, 6.2);
            S.box(F, -1.05, -1.05, 6.2, 1.05, 1.05, 6.45);
            const e = 1.25, cs = [F.P(-e, -e, 6.45), F.P(e, -e, 6.45), F.P(e, e, 6.45), F.P(-e, e, 6.45)], apex = F.P(0, 0, 8.7);
            S.solid(cs.concat([apex]), [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]);
            const ctr = F.P(0, 0, 7);
            for (let i = 0; i < 4; i++) {
                const tri = [cs[i], cs[(i + 1) % 4], apex];
                shade(T, tri, outward(tri, ctr), 'canopy');
            }
            flag(T, ...apex, 1.3);
            // red bands round the tower
            if (T.tones) {
                for (let side2 = 0; side2 < 4; side2++) {
                    const W = wall(F, side2, [-0.9, -0.9, 0.9, 0.9]);
                    if (!T.sees(W.n)) continue;
                    for (const z0 of [1.2, 3, 4.8]) inKind(S, RED, () => S.hatch([W.at(0, z0), W.at(W.len, z0), W.at(W.len, z0 + 0.7), W.at(0, z0 + 0.7)], [0, 0, 1], 0.3));
                }
            }
        }
        // the sign: straight along the bottom, arched over the top
        const w = hw - 0.9, P = (q, z) => [mid[0] + n[0] * q, mid[1] + n[1] * q, z], m = 16;
        const top = q => 5.9 + 1.3 * Math.cos((Math.PI * q) / (2 * w));
        const board = [P(-w, 4.8), P(w, 4.8)];
        for (let i = 0; i <= m; i++) { const q = w - (2 * w * i) / m; board.push(P(q, top(q))); }
        S.face(board);
        S.loop(board);
        if (T.detail) {
            const inner = [P(-w + 0.25, 5.05), P(w - 0.25, 5.05)];
            for (let i = 0; i <= m; i++) { const q = (w - 0.25) - (2 * (w - 0.25) * i) / m; inner.push(P(q, top(q) - 0.25)); }
            S.loop(inner);
        }
        if (T.tones) {
            for (let i = 1; i < 12; i++) {
                const q = -w + 0.4 + ((2 * w - 0.8) * i) / 12;
                inKind(S, i % 2 ? YELLOW : RED, () => S.line([P(0, 5.05), P(q, top(q) - 0.35)]));
            }
        }
    }

    // People out on the paths, and the odd balloon seller
    function crowds(T, cells, rng) {
        const { S, p, cam } = T;
        const near = new Map(), key = (x, y) => `${Math.floor(x / 2)},${Math.floor(y / 2)}`;
        const clear = (x, y, r) => {
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
                for (const [a, b, q] of near.get(`${Math.floor(x / 2) + i},${Math.floor(y / 2) + j}`) || []) if (Math.hypot(a - x, b - y) < q + r) return false;
            }
            return true;
        };
        const put = (x, y, r) => { const k = key(x, y); if (!near.has(k)) near.set(k, []); near.get(k).push([x, y, r]); };
        const onPath = (x, y) => !cells.some(c => x > c.lawn.box[0] - 0.3 && x < c.lawn.box[2] + 0.3 && y > c.lawn.box[1] - 0.3 && y < c.lawn.box[3] + 0.3 && geo.pointInPolygon(x, y, c.lawn.poly));
        const want = Math.round(((S.W * S.H) / (cam.k * cam.k * cam.se)) * 0.028 * p.people);
        let left = want, sellers = rng.int(1, 3);
        S.kind = INK;
        for (let i = 0; i < want * 3 && left > 0; i++) {
            const [x, y] = cam.ground(rng.range(0, S.W), rng.range(0, S.H + 10), 0);
            if (!onPath(x, y) || !clear(x, y, 0.45)) continue;
            put(x, y, 0.45);
            if (sellers > 0 && rng.chance(0.05)) {
                sellers--;
                balloons(T, x, y, rng);
            } else person(T, x, y, 0, rng);
            left--;
        }
    }

    function buildFair(T, seed) {
        const { S, p, cam } = T;
        const rng = new PG.RNG(hash(seed, 1));
        // the ground the page shows, with room below it for tall rides
        const tall = 30 * cam.ce * cam.k;
        const cs = [[0, 0], [S.W, 0], [S.W, S.H + tall], [0, S.H + tall]].map(([sx, sy]) => cam.ground(sx, sy, 0));
        const gap = p.spacing, pw = p.paths;
        const box = [Math.min(...cs.map(q => q[0])) - gap, Math.min(...cs.map(q => q[1])) - gap, Math.max(...cs.map(q => q[0])) + gap, Math.max(...cs.map(q => q[1])) + gap];
        const cells = [];
        for (const poly of voronoi(rng, box, gap)) {
            const core = geo.insetConvex(poly, pw / 2);
            if (core.length < 3) continue;
            const round = geo.roundCorners(core.concat([core[0]]), 0.22, 5);
            round.pop();
            const lawn = new Lawn(round), [x, y, r] = lawn.roomiest(), q = cam.project(x, y, 0);
            cells.push({ cell: poly, poly: core, lawn, x, y, r, pc: [q[0], q[1]], on: q[0] > 12 && q[0] < S.W - 12 && q[1] > 20 && q[1] < S.H + 15, kind: null });
        }
        assign(T, cells, rng);
        const ground = S.shadowGroup(0, null, Math.atan2(cam.ry, cam.rx));
        S.kind = PATH;
        for (const c of cells) S.loop(c.lawn.poly.map(([x, y]) => [x, y, 0]));
        S.kind = INK;
        // entrance gate over the path nearest the bottom middle of the page,
        // between two lawns that aren't taken up by something big
        let gt = null, gd = Infinity;
        const quiet = c => c.on && !['wheel', 'coaster', 'coasterB', 'lake', 'bigtop'].includes(c.kind);
        for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
                const a = cells[i], b = cells[j];
                if (!quiet(a) || !quiet(b)) continue;
                const sh = a.cell.filter(q => b.cell.some(v => Math.abs(q[0] - v[0]) + Math.abs(q[1] - v[1]) < 1e-6));
                if (sh.length < 2 || Math.hypot(sh[1][0] - sh[0][0], sh[1][1] - sh[0][1]) < 10) continue;
                const mid = [(sh[0][0] + sh[1][0]) / 2, (sh[0][1] + sh[1][1]) / 2], q = cam.project(mid[0], mid[1], 0);
                const dd = Math.hypot(q[0] - S.W * 0.5, q[1] - S.H * 0.88);
                if (dd < gd) { gd = dd; gt = { a, b, mid, d: unit([sh[1][0] - sh[0][0], sh[1][1] - sh[0][1], 0]) }; }
            }
        }
        if (gt && gd < S.H * 0.25) {
            gate(T, gt.mid, gt.d, pw);
            for (const c of [gt.a, gt.b]) {
                for (const sg of [1, -1]) c.lawn.take(gt.mid[0] - gt.d[1] * sg * (pw / 2 + 1.3), gt.mid[1] + gt.d[0] * sg * (pw / 2 + 1.3), 2);
            }
        }
        T.posts = [];
        const lakes = [];
        for (const c of cells) dressCell(T, c, cells, new PG.RNG(hash(seed, Math.round(c.x * 7), Math.round(c.y * 7))), lakes);
        across(T, new PG.RNG(hash(seed, 4)));
        crowds(T, cells, new PG.RNG(hash(seed, 5)));
        if (p.water && lakes.length) waterMarks(T, lakes, ground);
    }

    PG.register({
        id: 'fairground',
        name: 'Fairground',
        category: 'Scenes',
        description: 'An isometric funfair of rides, tents and stalls between winding paths, shaded for four to eight pens.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 1, max: 5, step: 0.05, value: 1.8, random: [1.5, 2.3],
                hint: 'How big a metre is on paper' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 15, max: 75, step: 0.5, value: 50, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.5, value: 39.5, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Park' },
            { id: 'spacing', label: 'Ride spacing (m)', type: 'range', min: 24, max: 45, step: 0.5, value: 32, random: [28, 37],
                hint: 'Roughly how far apart the rides are. Each one gets a patch of park about this size' },
            { id: 'paths', label: 'Path width (m)', type: 'range', min: 3, max: 9, step: 0.5, value: 5, random: [4, 6.5] },
            { id: 'wheel', label: 'Big wheel', type: 'checkbox', value: true, random: 0.85 },
            { id: 'coaster', label: 'Roller coaster', type: 'checkbox', value: true, random: 0.75 },
            { id: 'bigtop', label: 'Big top', type: 'checkbox', value: true, random: 0.75 },
            { id: 'rides', label: 'Other rides', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.3, 0.8],
                hint: 'Share of the patches on the page that get a ride' },
            { id: 'lake', label: 'Boating lake', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0, 1],
                hint: 'Chance of a lake with swan pedalos' },
            { id: 'stalls', label: 'Game stalls', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9],
                hint: 'Share of the leftover patches lined with stalls instead of gardens' },
            { type: 'section', label: 'Details' },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1] },
            { id: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 1] },
            { id: 'bunting', label: 'Bunting', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.3, 1],
                hint: 'Pennants strung between the lamp posts' },
            { id: 'boats', label: 'Pedalos', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1] },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Lattices, ties, planks and other small line work' },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Stripes & hatching', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Hatch spacing (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false,
                show: p => p.roofHatch, hint: 'Shaded faces are hatched closer, at 60% of this' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 50, random: [42, 60],
                show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.75, random: false,
                show: p => p.shadows },
            { id: 'water', label: 'Water marks', type: 'checkbox', value: true },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
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
                tones: p.roofHatch ? { lit: RED, dark: INK, canopy: YELLOW } : null,
                waterKind: WATER,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.6,
                // lit if the face gets at least 3/4 of the light a flat roof does
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
            };
            buildFair(T, ctx.seed | 0);
            if (p.shadows) {
                S.kind = BLUE;
                S.hatchShadows(p.shadowGap);
            }
            const out = PG.pens.renderScene('fairground', S, p);
            return out;
        },
    });
})();
