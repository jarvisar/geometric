/*
 * Moon Base: a lunar garden colony in the illustrated isometric scene family.
 * The site is planned before drawing: pressure tunnels connect a spanning tree
 * of occupied lots, and craters, boulders and tracks respect those reservations.
 * Biospheres have opaque rear glazing and a clear viewing belt at the front;
 * the same depth-tested faces hide terrain behind the glass and reveal gardens.
 * All geometry stays in world coordinates, including dishes, rover wheels,
 * crater bowls and the triangular glazing. Nothing is a screen-space decal.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { makeCamera, Scene, ring, hash, segments } = PG.iso;
    const { turned, unit, inKind } = PG.isokit;
    const INK = 0, RED = 1, BLUE = 2, GOLD = 3, GREEN = 4, FIGURE = 5, GLASS = 6, DUST = 7;
    const Z = [0, 0, 1];
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const mul = (a, s) => a.map(v => v * s);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const circle = (S, x, y, r, z, n = 40, rot = 0) => S.loop(Array.from({ length: n }, (_, i) => {
        const a = TAU * i / n + rot; return [x + r * Math.cos(a), y + r * Math.sin(a), z];
    }));

    function tube(T, a, b, r, n = 8) {
        const d = b.map((v, i) => v - a[i]), axis = unit(d);
        const u = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? Z : [1, 0, 0])), v = cross(axis, u);
        T.S.prism(ring(n, (c, s) => add(a, add(mul(u, r * c), mul(v, r * s)))), d, true);
    }

    function panel(T, pts, kind = BLUE, gap = 1) {
        const { S } = T;
        S.face(pts);
        S.loop(pts);
        if (T.p.hatching) inKind(S, kind, () => S.hatch(pts, pts[1].map((v, i) => v - pts[0][i]), T.p.hatchGap * gap));
    }

    // Extrude a rounded pressure hull along a local frame's u axis.
    function hull(T, F, a, b, r, z, ribs = true) {
        const { S } = T;
        const profile = u => ring(24, (c, s) => F.P(u, r * c, z + r * s));
        S.prism(profile(a), F.V(b - a, 0, 0), true);
        if (ribs) for (let u = a + 0.45; u < b; u += 1.7) S.loop(profile(u));
        S.loop(profile(a)); S.loop(profile(b));
    }

    const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
    const STROKES = { a: [[0, 1], [0.6, 1]], b: [[0.6, 1], [0.6, 0.5]], c: [[0.6, 0.5], [0.6, 0]],
        d: [[0.6, 0], [0, 0]], e: [[0, 0], [0, 0.5]], f: [[0, 0.5], [0, 1]], g: [[0, 0.5], [0.6, 0.5]] };
    function number(S, str, at, size = 1) {
        [...str].forEach((c, i) => {
            for (const s of DIGITS[+c] || '') S.line(STROKES[s].map(([u, v]) => at((u + i * 0.95) * size, v * size)));
        });
    }

    // Intersect a docking ray with the actual pressure envelope, rather than
    // the circular reservation used to keep neighbouring lots apart.
    function dockingReach(lot, angle) {
        if (!lot.type) return lot.port;
        const u = Math.cos(angle - lot.angle), v = Math.sin(angle - lot.angle);
        const box = (x0, y0, x1, y1) => {
            let lo = 0, hi = Infinity;
            for (const [d, a, b] of [[u, x0, x1], [v, y0, y1]]) {
                if (Math.abs(d) < 1e-9) { if (a > 0 || b < 0) return 0; continue; }
                lo = Math.max(lo, Math.min(a / d, b / d));
                hi = Math.min(hi, Math.max(a / d, b / d));
            }
            return hi >= lo ? hi : 0;
        };
        switch (lot.type) {
            case 'dome': return lot.r - 0.9;
            case 'hub': return 4.15;
            case 'observatory': return 4.75;
            case 'hab': return Math.max(box(-6.5, -6.7, 6.5, -2.3), box(-6.5, 2.3, 6.5, 6.7), box(-1.35, -4.5, 1.35, 4.5)) - 0.45;
            case 'greenhouse': return box(-8.5, -3.55, 8.5, 3.55) - 0.45;
            case 'workshop': return box(-7.4, -5.3, 7.4, 5.3) - 0.4;
            default: return lot.port;
        }
    }

    function tunnel(T, a, b) {
        const { S } = T, angle = Math.atan2(b.y - a.y, b.x - a.x), d = Math.hypot(b.x - a.x, b.y - a.y);
        const F = turned(a.x, a.y, 0, angle), start = dockingReach(a, angle), end = d - dockingReach(b, angle + Math.PI);
        if (end <= start) return;
        // A square sill, curved roof, and heavy expansion collars make an
        // enclosed passage distinct from the exposed service pipes below it.
        const arch = (u, extra = 0) => [F.P(u, -1.35 - extra, 0.7), ...Array.from({ length: 13 }, (_, i) => {
            const t = Math.PI - Math.PI * i / 12;
            return F.P(u, (1.35 + extra) * Math.cos(t), 1.75 + (1.35 + extra) * Math.sin(t));
        }), F.P(u, 1.35 + extra, 0.7)];
        S.prism(arch(start), F.V(end - start, 0, 0), true);
        S.line([F.P(start, -1.37, 1), F.P(end, -1.37, 1)]);
        // Solid socket collars meet the hull at both ends. They also screen
        // the glazing behind each biosphere's pressure-tight entrance.
        for (const u of [start + 0.45, end - 0.8]) {
            S.prism(arch(u, 0.16), F.V(0.35, 0, 0), true);
            inKind(S, RED, () => S.line(arch(u + 0.18, 0.18)));
            S.box(F, u - 0.12, -1.65, 0, u + 0.47, 1.65, 0.7);
        }
        for (let u = start + 0.7; u < end; u += T.p.detail ? 1.4 : 2.8) {
            S.line(arch(u, 0.04));
                if (Math.round((u - start - 0.7) / (T.p.detail ? 1.4 : 2.8)) % 5 === 0) {
                inKind(S, RED, () => S.line(arch(u + 0.13, 0.06)));
                S.box(F, u - 0.2, -1.65, 0, u + 0.2, 1.65, 0.7);
            }
        }
        inKind(S, GOLD, () => {
            for (const v of [-1.75, -1.95]) tube(T, F.P(start, v, 0.38), F.P(end, v, 0.38), 0.075, 6);
        });
    }

    function garden(T, x, y, r, rng) {
        const { S } = T, F = turned(x, y, 1.05, 0);
        // Four growing beds leave a central cross-shaped promenade.
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const bx = sx * r * 0.28, by = sy * r * 0.28, w = r * 0.19;
            S.box(F, bx - w, by - w, 0, bx + w, by + w, 0.42);
            inKind(S, GREEN, () => {
                for (let u = -w + 0.45; u < w; u += 0.85) {
                    S.line([F.P(bx + u, by - w + 0.2, 0.48), F.P(bx + u, by + w - 0.2, 0.48)]);
                    if (T.p.detail) for (let v = -w + 0.5; v < w; v += 1.2) {
                        const q = F.P(bx + u, by + v, 0.5), h = rng.range(0.35, 0.65);
                        S.line([add(q, [-0.23, 0, h]), q, add(q, [0.23, 0, h])]);
                    }
                }
            });
        }
        // The grove sits on the viewing side of the dome, where the clear
        // glazing can reveal it instead of hiding it behind the roof.
        if (r > 9) inKind(S, GREEN, () => {
            for (const [u, v] of [[-0.24, 0.1], [0.06, 0.2], [0.28, 0.08]]) {
                const tx = x + r * (u * T.cam.rx - v * T.cam.fx), ty = y + r * (u * T.cam.ry - v * T.cam.fy);
                PG.isokit.roundTree(T, tx, ty, 1.5, rng);
            }
        });
        inKind(S, GLASS, () => {
            S.lathe(x, y, [[0.9, 1.1], [0.9, 1.5]], 16);
            circle(S, x, y, 0.65, 1.52, 16);
        });
    }

    function biosphere(T, lot, rng) {
        const { S, cam } = T, { x, y, r } = lot, z = 1.2, h = r * 0.84;
        S.lathe(x, y, [[r + 0.6, 0], [r + 0.6, 0.45], [r, 0.7], [r, z]], 48);
        inKind(S, RED, () => circle(S, x, y, r + 0.04, 0.88, 48));
        if (T.p.gardens) garden(T, x, y, r, rng);

        // One indexed triangular shell supplies glazing, ribs AND silhouette.
        // Independent circular ribs cut across flat panels and produce loose
        // ends; shared mesh edges meet exactly, even with the clear front belt.
        const tris = [], frequency = T.p.detail ? (r > 11 ? 6 : 4) : 3;
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2, b = (i + 1) * Math.PI / 2;
            const A = [Math.cos(a), Math.sin(a), 0], B = [Math.cos(b), Math.sin(b), 0];
            const vertex = (u, v) => unit(add(add(mul(A, frequency - u - v), mul(B, u)), mul(Z, v)));
            for (let u = 0; u < frequency; u++) for (let v = 0; v < frequency - u; v++) {
                tris.push([vertex(u, v), vertex(u + 1, v), vertex(u, v + 1)]);
                if (u + v < frequency - 1) tris.push([vertex(u + 1, v), vertex(u + 1, v + 1), vertex(u, v + 1)]);
            }
        }
        const at = q => [x + r * q[0], y + r * q[1], z + h * q[2]], edges = new Map();
        const pointKey = q => q.map(v => Math.round(v * 1e6)).join(',');
        for (let i = 0; i < tris.length; i++) {
            const tri = tris[i], mid = mul(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
            const normal = [mid[0] / r, mid[1] / r, mid[2] / h];
            const front = cam.facing(...normal), view = -(mid[0] * cam.fx + mid[1] * cam.fy);
            const clear = T.p.gardens && front && view > 0.12 && mid[2] < 0.93;
            const pts = tri.map(at);
            if (!clear) S.face(pts);
            for (let j = 0; j < 3; j++) {
                const a = tri[j], b = tri[(j + 1) % 3], ka = pointKey(a), kb = pointKey(b), key = ka < kb ? ka + '/' + kb : kb + '/' + ka;
                if (!edges.has(key)) edges.set(key, { a, b, fronts: [] });
                edges.get(key).fronts.push(front);
            }
            if (front) {
                if (!clear && T.p.hatching && i % 5 === 0) inKind(S, GLASS, () => S.hatch(pts, [1, -0.2, 1], T.p.hatchGap * 1.4));
            }
        }
        for (const { a, b, fronts } of edges.values()) {
            if (!fronts.some(Boolean)) continue;
            const silhouette = fronts.length === 1 || fronts.some(f => !f);
            const rib = [0, 1].some(i => Math.abs(a[i]) < 1e-6 && Math.abs(b[i]) < 1e-6);
            inKind(S, silhouette || rib ? INK : GLASS, () => S.line([at(a), at(b)]));
        }
        S.lathe(x, y, [[0.72, z + h - 0.05], [0.72, z + h + 0.4], [0.35, z + h + 0.65]], 12);
        // Buttresses, radial anchors and observation windows around the ring.
        for (let i = 0; i < 12; i++) {
            const a = TAU * i / 12, F = turned(x, y, 0, a);
            if ((lot.ports || []).some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 2.5 / r)) continue;
            S.box(F, r - 0.2, -0.25, 0, r + 1.05, 0.25, 1.25);
            if (T.p.detail) S.line([F.P(r + 0.05, 0, 1.3), F.P(r + 1.8, 0, 0)]);
        }
    }

    function habitat(T, lot, index) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle), L = 6.5, r = 2.65;
        for (const u of [-4.5, 4.5]) S.box(F, u - 0.45, -2.4, 0, u + 0.45, 2.4, 1.65);
        hull(T, F, -L, L, r, 3.65, false);
        for (const u of [-L + 0.3, -2.5, 2.5, L - 0.3]) {
            inKind(S, RED, () => S.loop(ring(24, (c, s) => F.P(u, (r + 0.03) * c, 3.65 + (r + 0.03) * s))));
        }
        // Portholes lie in the vertical tangent plane of the pressure hull.
        for (const side of [-1, 1]) {
            if (!T.cam.facing(...F.V(0, side, 0))) continue;
            for (const u of [-4.1, -1.4, 1.4, 4.1]) inKind(S, GLASS, () => {
                S.loop(ring(12, (c, s) => F.P(u + 0.63 * c, side * 2.68, 3.7 + 0.63 * s)));
                S.line([F.P(u - 0.44, side * 2.69, 3.7), F.P(u + 0.44, side * 2.69, 3.7)]);
            });
        }
        const end = T.cam.facing(...F.V(-1, 0, 0)) ? -L - 0.03 : L + 0.03;
        S.loop(ring(8, (c, s) => F.P(end, 1.15 * c, 3.25 + 1.5 * s)));
        S.line([F.P(end, -0.75, 3.25), F.P(end, 0.75, 3.25)]);
        // A short stair and landing make the end hatch an actual entrance.
        const sign = Math.sign(end);
        for (let i = 0; i < 4; i++) {
            const a = L + i * 0.48, b = a + 0.48;
            S.box(F, sign > 0 ? a : -b, -1.05, 0, sign > 0 ? b : -a, 1.05, 1.7 - i * 0.4);
        }
        for (const v of [-1.05, 1.05]) S.line([F.P(sign * (L + 0.15), v, 2.55), F.P(sign * (L + 1.9), v, 1), F.P(sign * (L + 1.9), v, 0)]);
        inKind(S, RED, () => number(S, String(index + 1).padStart(2, '0'), (u, v) => F.P(end, u - 0.65, 4.8 + v), 0.65));
        S.box(F, -1.6, -0.85, 5.9, 1.6, 0.85, 6.55);
        inKind(S, BLUE, () => {
            for (let u = -1.4; u < 1.5; u += 0.4) S.line([F.P(u, -0.85, 6.58), F.P(u, 0.85, 6.58)]);
        });
        S.line([F.P(4.5, 0, 6.1), F.P(4.5, 0, 8)]);
        S.line([F.P(3.75, 0, 7.4), F.P(5.25, 0, 7.4)]);
    }

    function habitatBlock(T, lot) {
        const F = turned(lot.x, lot.y, 0, lot.angle);
        for (const v of [-4.5, 4.5]) {
            const q = F.P(0, v, 0);
            habitat(T, { ...lot, x: q[0], y: q[1] }, lot.index * 2 + (v > 0 ? 1 : 0));
        }
        const a = F.P(0, -4.5, 0), b = F.P(0, 4.5, 0);
        tunnel(T, { x: a[0], y: a[1], port: 1.5 }, { x: b[0], y: b[1], port: 1.5 });
        const { S } = T;
        S.box(F, -4, -1.3, 0, -1.5, 1.3, 2.3);
        inKind(S, BLUE, () => {
            for (let u = -3.7; u < -1.5; u += 0.5) S.line([F.P(u, -1.3, 2.33), F.P(u, 1.3, 2.33)]);
        });
    }

    function workshop(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        // Chamfered pressure walls, an arched vehicle door and a roof with
        // radiator fins read as one substantial workshop at thumbnail size.
        const footprint = [[-8, -4], [-6.5, -5.5], [6.5, -5.5], [8, -4], [8, 4], [6.5, 5.5], [-6.5, 5.5], [-8, 4]];
        S.prism(footprint.map(([u, v]) => F.P(u, v, 0.6)), F.V(0, 0, 6));
        S.prism(footprint.map(([u, v]) => F.P(u * 1.02, v * 1.02, 6.6)), F.V(0, 0, 0.55));
        inKind(S, RED, () => S.loop(footprint.map(([u, v]) => F.P(u * 1.025, v * 1.025, 6.85))));
        for (const side of [-1, 1]) {
            const v = side * 5.53;
            if (!T.cam.facing(...F.V(0, side, 0))) continue;
            inKind(S, GLASS, () => {
                for (const u of [-4.9, -2.5, 0, 2.5, 4.9]) {
                    const pts = [F.P(u - 0.8, v, 3.9), F.P(u + 0.8, v, 3.9), F.P(u + 0.8, v, 5.4), F.P(u - 0.8, v, 5.4)];
                    S.loop(pts);
                    S.line([F.P(u, v, 3.9), F.P(u, v, 5.4)]);
                }
            });
            for (const u of [-6, 6]) S.line([F.P(u, v, 0.6), F.P(u, v, 6.6)]);
        }
        const side = T.cam.facing(...F.V(-1, 0, 0)) ? -1 : 1, u = side * 8.03;
        const door = [F.P(u, -2.8, 0.6), F.P(u, 2.8, 0.6), F.P(u, 2.8, 4.5), F.P(u, 2, 5.3), F.P(u, -2, 5.3), F.P(u, -2.8, 4.5)];
        S.loop(door);
        for (let z = 1.2; z < 4.6; z += 0.65) S.line([F.P(u, -2.7, z), F.P(u, 2.7, z)]);
        inKind(S, GOLD, () => {
            for (const v of [-3.1, 3.1]) S.line([F.P(u, v, 0.6), F.P(u, v, 4.6)]);
        });
        S.box(F, -5, -2, 7.15, 2, 2, 8);
        inKind(S, BLUE, () => {
            for (let a = -4.6; a < 2; a += 0.75) S.line([F.P(a, -2, 8.03), F.P(a, 2, 8.03)]);
        });
        for (const v of [-2, 2]) {
            const q = F.P(4.8, v, 0);
            S.lathe(q[0], q[1], [[0.8, 7.2], [0.8, 8.3], [1.1, 8.3], [1.1, 8.65]], 12);
        }
    }

    function greenhouse(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle), r = 4.2;
        S.box(F, -8.8, -r - 0.35, 0, 8.8, r + 0.35, 0.8);
        const arch = u => Array.from({ length: 17 }, (_, i) => {
            const a = Math.PI - Math.PI * i / 16;
            return F.P(u, r * Math.cos(a), 1.2 + r * Math.sin(a));
        });
        // Opaque rear half screens the landscape; open front glazing shows
        // simple, broad crop rows inside the long barrel-vault greenhouse.
        for (let j = 0; j < 16; j++) {
            const a = arch(-8.5)[j], b = arch(-8.5)[j + 1], c = arch(8.5)[j + 1], d = arch(8.5)[j];
            const normal = F.V(0, -Math.cos(Math.PI * (j + 0.5) / 16), Math.sin(Math.PI * (j + 0.5) / 16));
            if (!T.cam.facing(...normal) || j > 5 && j < 10) S.face([a, b, c, d]);
        }
        for (const v of [-r, r]) {
            S.box(F, -8.5, v - 0.12, 0.8, 8.5, v + 0.12, 1.25);
        }
        for (const u of [-8.5, 8.5]) {
            const end = [F.P(u, -r, 0.8), ...arch(u), F.P(u, r, 0.8)];
            if (!T.cam.facing(...F.V(Math.sign(u), 0, 0))) S.face(end);
            S.loop(end);
            // Uprights meet sampled roof vertices, with a central airlock
            // and fanlight that leave no diagonals running through the beds.
            for (const i of [4, 6, 10, 12]) {
                const q = arch(u)[i];
                S.line([F.P(u, -r * Math.cos(Math.PI * i / 16), 0.8), q]);
            }
            S.line([F.P(u, -r, 1.2), F.P(u, r, 1.2)]);
            const side = Math.sign(u), v = side * (8.5 + 0.035);
            if (T.cam.facing(...F.V(side, 0, 0))) {
                const door = [F.P(v, -1.05, 0.85), F.P(v, 1.05, 0.85), F.P(v, 1.05, 3.1), F.P(v, 0.7, 3.45), F.P(v, -0.7, 3.45), F.P(v, -1.05, 3.1)];
                S.face(door); S.loop(door);
                inKind(S, GLASS, () => S.loop([F.P(v + side * 0.01, -0.65, 2.15), F.P(v + side * 0.01, 0.65, 2.15), F.P(v + side * 0.01, 0.65, 2.95), F.P(v + side * 0.01, -0.65, 2.95)]));
                S.line([F.P(v + side * 0.015, 0.5, 1.6), F.P(v + side * 0.015, 0.8, 1.6)]);
                S.box(F, side > 0 ? 8.5 : -9.4, -1.3, 0, side > 0 ? 9.4 : -8.5, 1.3, 0.45);
            }
        }
        inKind(S, GLASS, () => {
            for (let u = -6.8; u < 8; u += 1.7) S.line(arch(u));
            for (const i of [3, 6, 8, 10, 13]) S.line([arch(-8.5)[i], arch(8.5)[i]]);
        });
        for (const v of [-2.4, 2.4]) {
            S.box(F, -7.5, v - 0.7, 0.82, 7.5, v + 0.7, 1.35);
            inKind(S, GREEN, () => {
                for (const d of [-0.3, 0.3]) {
                    S.line([F.P(-7.2, v + d, 1.4), F.P(7.2, v + d, 1.4)]);
                    for (let u = -6.7; u < 7; u += 1.45) S.line([F.P(u - 0.3, v + d, 1.95), F.P(u, v + d, 1.4), F.P(u + 0.3, v + d, 1.95)]);
                }
            });
        }
        inKind(S, RED, () => {
            S.line(arch(-8.3)); S.line(arch(8.3));
        });
    }

    function hub(T, lot) {
        const { S } = T, { x, y } = lot;
        S.lathe(x, y, [[5.8, 0], [5.8, 0.6], [4.6, 1], [4.6, 7], [5.7, 7.4], [5.7, 13.3], [6.1, 13.6], [6.1, 14.2], [4.7, 16], [0, 16]], 8, false, Math.PI / 8);
        for (const z of [7.5, 10.4, 13.5]) {
            inKind(S, RED, () => circle(S, x, y, z === 13.5 ? 6 : 5.72, z, 8, Math.PI / 8));
            if (z === 13.5) continue;
            for (let i = 0; i < 8; i++) {
                const a = (i + 0.5) * TAU / 8 + Math.PI / 8, F = turned(x, y, 0, a);
                if (!T.cam.facing(...F.V(1, 0, 0))) continue;
                inKind(S, GLASS, () => {
                    const pts = [F.P(5.3, -1.75, z + 0.6), F.P(5.3, 1.75, z + 0.6), F.P(5.3, 1.75, z + 2), F.P(5.3, -1.75, z + 2)];
                    S.loop(pts); S.line([F.P(5.3, 0, z + 0.6), F.P(5.3, 0, z + 2)]);
                    if (T.p.hatching) S.hatch(pts, Z, T.p.hatchGap);
                });
            }
        }
        S.lathe(x, y, [[1.3, 16], [1.3, 16.5], [0.7, 17.3]], 12);
        S.line([[x, y, 17.3], [x, y, 22]]);
        for (const z of [19.2, 20.8]) S.line([[x - 1.8, y, z], [x + 1.8, y, z]]);
        inKind(S, RED, () => circle(S, x, y, 0.3, 22, 8));
    }

    function launchSite(T, lot) {
        const { S } = T, { x, y } = lot, F = turned(x, y, 0, 0);
        S.lathe(x, y, [[12, 0], [12, 0.55]], 8, false, Math.PI / 8);
        inKind(S, GOLD, () => circle(S, x, y, 10.5, 0.58, 8, Math.PI / 8));
        // A broad two-stage shuttle, with side boosters and swept landing fins.
        const nose = Array.from({ length: 13 }, (_, i) => [i === 12 ? 0 : 3.1 * Math.cos(i * Math.PI / 24), 20 + 8.5 * Math.sin(i * Math.PI / 24)]);
        S.lathe(x, y, [[2, 1], [1.3, 3], [3.1, 3.5], ...nose], 32);
        for (const z of [6, 17.6, 19]) inKind(S, RED, () => circle(S, x, y, 3.13, z));
        for (const u of [-4.1, 4.1]) {
            const q = F.P(u, 0.5, 0);
            S.lathe(q[0], q[1], [[0.85, 1], [0.6, 2.5], [1.15, 3], [1.15, 15], [0.8, 17], [0, 18.8]], 20);
            inKind(S, RED, () => { circle(S, q[0], q[1], 1.18, 5.5, 20); circle(S, q[0], q[1], 1.18, 14, 20); });
        }
        for (let i = 0; i < 4; i++) {
            const A = turned(x, y, 0, i * Math.PI / 2 + Math.PI / 4);
            const pts = [A.P(2.9, -0.14, 9), A.P(6.3, -0.14, 2), A.P(6.3, -0.14, 0.9), A.P(2.9, -0.14, 3.5)];
            S.prism(pts, A.V(0, 0.28, 0));
            inKind(S, RED, () => S.line([A.P(2.95, -0.17, 8.3), A.P(5.8, -0.17, 2.3)]));
        }
        const windscreen = [F.P(-1.3, -3.14, 20.2), F.P(1.3, -3.14, 20.2), F.P(1.05, -3.09, 21.9), F.P(-1.05, -3.09, 21.9)];
        panel(T, windscreen, BLUE, 0.8);
        S.line([F.P(0, -3.15, 20.2), F.P(0, -3.1, 21.9)]);
        inKind(S, RED, () => number(S, '01', (u, v) => F.P(u - 0.75, -3.15, 12.4 + v), 1.1));
        // Service tower and access bridges are deliberately broad, with only
        // one diagonal in each bay so the lattice remains readable on paper.
        for (const u of [6.4, 9.4]) for (const v of [3.5, 6.5]) S.box(F, u - 0.2, v - 0.2, 0.55, u + 0.2, v + 0.2, 25);
        for (let z = 1; z < 24; z += 4) {
            S.line([F.P(6.4, 3.5, z), F.P(9.4, 3.5, z + 4)]);
            S.line([F.P(9.4, 3.5, z), F.P(9.4, 6.5, z + 4)]);
            S.box(F, 6.2, 3.3, z + 3.8, 9.6, 6.7, z + 4.1);
        }
        for (const z of [11, 20]) {
            S.box(F, 1.6, 2.5, z, 6.8, 4.1, z + 0.45);
            inKind(S, GOLD, () => {
                S.line([F.P(1.6, 2.5, z + 1.6), F.P(6.8, 2.5, z + 1.6)]);
                for (let u = 1.6; u < 7; u += 1.3) S.line([F.P(u, 2.5, z), F.P(u, 2.5, z + 1.6)]);
            });
        }
        // Ladder and complete guardrails make the launch tower usable.
        for (const u of [7.3, 8.5]) S.line([F.P(u, 6.73, 0.6), F.P(u, 6.73, 25)]);
        if (T.p.detail) for (let z = 1; z < 25; z += 0.65) S.line([F.P(7.3, 6.73, z), F.P(8.5, 6.73, z)]);
        inKind(S, GOLD, () => {
            for (const v of [3.3, 6.7]) {
                S.line([F.P(6.2, v, 26.1), F.P(9.6, v, 26.1)]);
                for (const u of [6.2, 7.9, 9.6]) S.line([F.P(u, v, 25), F.P(u, v, 26.1)]);
            }
        });
    }

    function solar(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle), rows = lot.small ? 2 : T.p.solarRows;
        for (let row = 0; row < rows; row++) for (let col = 0; col < 3; col++) {
            const u = (col - 1) * 6.2, v = (row - (rows - 1) / 2) * 6.5;
            S.box(F, u - 0.45, v - 0.45, 0, u + 0.45, v + 0.45, 2.7);
            const at = (a, b) => F.P(u + a, v + b, 2.8 + b * 0.48);
            const pts = [at(-2.7, -2.3), at(2.7, -2.3), at(2.7, 2.3), at(-2.7, 2.3)];
            S.face(pts);
            inKind(S, BLUE, () => {
                S.loop(pts);
                for (let a = -1.8; a <= 1.8; a += 0.9) S.line([at(a, -2.3), at(a, 2.3)]);
                for (let b = -1.55; b < 2; b += 0.77) S.line([at(-2.7, b), at(2.7, b)]);
            });
            S.line([F.P(u - 2.1, v, 0.3), at(-2, 1.7)]);
            S.line([F.P(u + 2.1, v, 0.3), at(2, 1.7)]);
            for (const a of [-2.1, 2.1]) S.box(F, u + a - 0.28, v - 0.28, 0, u + a + 0.28, v + 0.28, 0.3);
            if (T.p.detail) S.line([at(-2.7, 0), at(2.7, 0)]);
        }
        inKind(S, GOLD, () => {
            const v = -rows * 3.25 - 0.8;
            S.line([F.P(-8, v, 0.2), F.P(8, v, 0.2), F.P(10, v + 2, 0.2), F.P(10, 0, 0.2)]);
            for (let row = 0; row < rows; row++) {
                const b = (row - (rows - 1) / 2) * 6.5;
                S.line([F.P(-6.2, b, 0.2), F.P(9, b, 0.2)]);
            }
            S.line([F.P(9, -(rows - 1) * 3.25, 0.2), F.P(9, (rows - 1) * 3.25, 0.2)]);
            S.line([F.P(9, 0, 0.2), F.P(10, 0, 0.2)]);
        });
        S.box(F, 9.5, -1.4, 0, 12, 1.4, 2.3);
        if (T.p.detail) for (let u = 9.9; u < 11.8; u += 0.4) S.line([F.P(u, -1.42, 0.6), F.P(u, -1.42, 1.65)]);
    }

    function dish(T, x, y, r, angle, z = 0) {
        const { S } = T, F = turned(x, y, z, angle), tilt = 0.95, height = 7;
        S.lathe(x, y, [[2, z], [2, z + 0.5], [0.65, z + 0.9], [0.65, z + height - 0.5]], 12);
        for (const v of [-1, 1]) tube(T, F.P(0, v * 1.8, 0.6), F.P(0, v * 0.65, height - 0.6), 0.16);
        // Concave paraboloid, individually faced; treating this as a convex
        // solid would hide its own bowl and feed supports at some camera turns.
        const at = (rr, a) => {
            const u = rr * Math.cos(a), v = rr * Math.sin(a), w = rr * rr / (r * 2.5);
            return F.P(u, v * Math.cos(tilt) - w * Math.sin(tilt), height + v * Math.sin(tilt) + w * Math.cos(tilt));
        };
        for (let j = 0; j < 4; j++) for (let i = 0; i < 32; i++) {
            const a = i * TAU / 32, b = (i + 1) * TAU / 32, r0 = r * j / 4, r1 = r * (j + 1) / 4;
            const pts = j ? [at(r0, a), at(r1, a), at(r1, b), at(r0, b)] : [at(0, 0), at(r1, a), at(r1, b)];
            if (j) { S.face(pts.slice(0, 3)); S.face([pts[0], pts[2], pts[3]]); } else S.face(pts);
        }
        for (const t of [0.5, 1]) S.loop(Array.from({ length: 32 }, (_, i) => at(r * t, i * TAU / 32)));
        inKind(S, BLUE, () => {
            // Use the actual facet vertices: intermediate points on a true
            // parabola fall behind the concave mesh and become dotted lines.
            for (let i = 0; i < 8; i++) S.line(Array.from({ length: 5 }, (_, j) => at(r * j / 4, i * TAU / 8)));
        });
        const focus = F.P(0, -r * 1.1 * Math.sin(tilt), height + r * 1.1 * Math.cos(tilt));
        for (let i = 0; i < 3; i++) tube(T, at(r, Math.round(i * 32 / 3) * TAU / 32), focus, 0.07, 6);
        inKind(S, RED, () => tube(T, focus, add(focus, [0, 0, 0.65]), 0.2));
    }

    function lander(T, x, y) {
        const { S } = T;
        inKind(S, GOLD, () => {
            S.lathe(x, y, [[3.8, 3], [4.8, 4], [4.8, 6.8], [3.3, 7.5]], 8, false, Math.PI / 8);
        });
        S.lathe(x, y, [[1.7, 1.5], [0.9, 3.8]], 16);
        S.lathe(x, y, [[3.4, 7.5], [3.4, 11.7], [2.5, 13.5], [1.7, 13.5]], 8, false, Math.PI / 8);
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2, F = turned(x, y, 0, a);
            const foot = F.P(8, 0, 0.6);
            tube(T, F.P(3.8, 0, 6.5), foot, 0.24);
            S.line([F.P(4.1, -1.5, 4), foot, F.P(4.1, 1.5, 4)]);
            S.lathe(foot[0], foot[1], [[1.3, 0.38], [1.3, 0.7]], 12);
        }
        const F = turned(x, y, 0, 0);
        inKind(S, GLASS, () => {
            for (const side of [-1, 1]) {
                const pts = [F.P(side * 0.15, -3.17, 9.65), F.P(side * 1.2, -3.17, 9.65), F.P(side * 1.12, -3.17, 11.25), F.P(side * 0.15, -3.17, 11.25)];
                panel(T, pts, BLUE, 0.65);
            }
            // A second instrument window belongs to the adjacent octagonal
            // face; keeping it within that facet avoids floating corners.
            panel(T, [F.P(-3.17, -1.1, 9.75), F.P(-3.17, 1.1, 9.75), F.P(-3.17, 0.8, 11.2), F.P(-3.17, -0.8, 11.2)], BLUE, 0.9);
        });
        if (T.p.detail) {
            const apothem = 4.8 * Math.cos(Math.PI / 8) + 0.025;
            for (const angle of [Math.PI, Math.PI * 1.5]) {
                const wall = turned(x, y, 0, angle);
                const foil = [wall.P(apothem, -1.3, 4.45), wall.P(apothem, 1.3, 4.45), wall.P(apothem, 1.3, 6.35), wall.P(apothem, -1.3, 6.35)];
                inKind(S, GOLD, () => {
                    S.loop(foil);
                    if (T.p.hatching) S.hatch(foil, wall.V(0, 1, 0.7), T.p.hatchGap * 1.4);
                });
            }
        }
        // A proper hatch and small porch join the ladder to the ascent cabin.
        S.loop([F.P(-0.85, -3.18, 7.55), F.P(0.85, -3.18, 7.55), F.P(0.85, -3.18, 9.15), F.P(0.55, -3.18, 9.45), F.P(-0.55, -3.18, 9.45), F.P(-0.85, -3.18, 9.15)]);
        S.box(F, -1.15, -4.65, 7.35, 1.15, -3.05, 7.55);
        for (const u of [-0.85, 0.85]) S.line([F.P(u, -6.8, 0.6), F.P(u, -4.65, 7.55)]);
        for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            S.line([F.P(-0.85, geo.lerp(-6.8, -4.65, t), geo.lerp(0.6, 7.55, t)), F.P(0.85, geo.lerp(-6.8, -4.65, t), geo.lerp(0.6, 7.55, t))]);
        }
        for (const u of [-1.15, 1.15]) S.line([F.P(u, -4.65, 7.55), F.P(u, -4.65, 8.5), F.P(u, -3.18, 8.5)]);
        S.line([F.P(1, 1, 13.5), F.P(1, 1, 17)]);
        S.line([F.P(-0.6, 1, 16), F.P(2.6, 1, 16)]);
        inKind(S, RED, () => S.line([F.P(-2, -1, 12.6), F.P(2, -1, 12.6)]));
    }

    function landingPad(T, lot) {
        const { S } = T, { x, y, r } = lot;
        S.lathe(x, y, [[r, 0], [r, 0.35]], 8, false, Math.PI / 8);
        inKind(S, GOLD, () => {
            circle(S, x, y, r * 0.84, 0.38, 8, Math.PI / 8);
            circle(S, x, y, r * 0.78, 0.38, 8, Math.PI / 8);
            const F = turned(x, y, 0.38, 0);
            S.line([F.P(-2, -3, 0), F.P(-2, 3, 0)]); S.line([F.P(2, -3, 0), F.P(2, 3, 0)]);
            S.line([F.P(-2, 0, 0), F.P(2, 0, 0)]);
            for (let i = 0; i < 8; i++) {
                const a = i * TAU / 8 + Math.PI / 8, F = turned(x, y, 0.4, a);
                S.line([F.P(r * 0.87, -0.9, 0), F.P(r * 0.95, 0, 0), F.P(r * 0.87, 0.9, 0)]);
            }
        });
        for (let i = 0; i < 8; i++) {
            const a = i * TAU / 8 + Math.PI / 8, bx = x + r * 0.93 * Math.cos(a), by = y + r * 0.93 * Math.sin(a);
            S.lathe(bx, by, [[0.17, 0.35], [0.17, 1.2]], 6);
            inKind(S, RED, () => circle(S, bx, by, 0.3, 1.2, 8));
        }
        if (T.p.lander) lander(T, x, y);
    }

    function utilities(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        for (let i = 0; i < 3; i++) {
            const q = F.P((i - 1) * 4.2, 1, 0), r = 1.6;
            const cap = Array.from({ length: 9 }, (_, j) => [j === 8 ? 0 : r * Math.cos(j * Math.PI / 16), 6 + r * Math.sin(j * Math.PI / 16)]);
            S.lathe(q[0], q[1], [[r, 0.35], ...cap], 24);
            const hatch = F.P((i - 1) * 4.2, 1, 0);
            S.lathe(hatch[0], hatch[1], [[0.38, 7.55], [0.38, 7.9]], 12);
            inKind(S, RED, () => { circle(S, q[0], q[1], r + 0.025, 4.5); circle(S, q[0], q[1], r + 0.025, 5); });
            const p0 = F.P((i - 1) * 4.2, -0.65, 1.3), p1 = F.P((i - 1) * 4.2, -3.7, 1.3);
            inKind(S, GOLD, () => {
                tube(T, p0, p1, 0.18);
                if (T.p.detail) {
                    const u = (i - 1) * 4.2;
                    tube(T, F.P(u, -2.6, 1.3), F.P(u, -2.6, 1.95), 0.08, 6);
                    S.loop(ring(12, (c, s) => F.P(u + 0.4 * c, -2.6 + 0.4 * s, 1.95)));
                }
            });
        }
        inKind(S, GOLD, () => tube(T, F.P(-4.2, -3.7, 1.3), F.P(6, -3.7, 1.3), 0.18));
        S.box(F, 5, -5, 0, 8, -2.3, 2.6);
        for (let i = 0; i < 5; i++) S.line([F.P(5.3 + i * 0.45, -5.03, 0.6), F.P(5.3 + i * 0.45, -5.03, 2.2)]);
    }

    function observatory(T, lot) {
        const { S } = T, { x, y } = lot, r = 5.2;
        S.lathe(x, y, [[r + 0.6, 0], [r + 0.6, 0.6], [r, 0.9], [r, 5.4]], 32);
        inKind(S, RED, () => { circle(S, x, y, r + 0.04, 1.3); circle(S, x, y, r + 0.04, 4.7); });
        // Two shells leave a real slit for the telescope. Individual panels
        // retain the opening at every camera angle, including overhead views.
        const F = turned(x, y, 0, -0.65), at = (a, t) => F.P(r * Math.cos(a) * Math.cos(t), r * Math.sin(a) * Math.cos(t), 5.4 + r * Math.sin(t));
        const edges = new Map(), key = p => p.map(v => Math.round(v * 1e6)).join(',');
        for (let i = 0; i < 32; i++) {
            const a = i * TAU / 32, b = (i + 1) * TAU / 32;
            if (i === 0 || i === 15 || i === 16 || i === 31) continue;
            for (let j = 0; j < 10; j++) {
                const t = j * Math.PI / 20, u = (j + 1) * Math.PI / 20;
                const pts = [at(a, t), at(b, t), at(b, u), at(a, u)];
                S.face(pts.slice(0, 3)); S.face([pts[0], pts[2], pts[3]]);
                const facing = T.cam.facing(...F.V(Math.cos((a + b) / 2) * Math.cos((t + u) / 2), Math.sin((a + b) / 2) * Math.cos((t + u) / 2), Math.sin((t + u) / 2)));
                for (let k = 0; k < 4; k++) {
                    const p = pts[k], q = pts[(k + 1) % 4], kp = key(p), kq = key(q), id = kp < kq ? kp + '/' + kq : kq + '/' + kp;
                    if (kp === kq) continue;
                    if (!edges.has(id)) edges.set(id, { pts: [p, q], fronts: [] });
                    edges.get(id).fronts.push(facing);
                }
            }
            if (i % 4 === 0) S.line(Array.from({ length: 11 }, (_, j) => at(a, j * Math.PI / 20)));
        }
        for (const e of edges.values()) if (e.fronts.length === 1 || e.fronts.some(Boolean) && e.fronts.some(f => !f)) S.line(e.pts);
        circle(S, x, y, r + 0.03, 5.4);
        S.lathe(x, y, [[1.1, 5.4], [1.1, 7.3]], 12);
        S.line([F.P(0, -0.8, 7), F.P(-1, -1.15, 8.5), F.P(-1, 1.15, 8.5), F.P(0, 0.8, 7)]);
        const a = F.P(-1, 0, 8.5), b = F.P(-8, 0, 12.2), dir = unit(b.map((v, i) => v - a[i]));
        tube(T, a, b, 1, 16);
        inKind(S, RED, () => tube(T, b, add(b, mul(dir, 0.35)), 1.06, 16));
        const perp = unit(cross(dir, Z)), up = cross(dir, perp), end = add(b, mul(dir, 0.38));
        inKind(S, GLASS, () => S.loop(ring(20, (c, s) => add(end, add(mul(perp, 0.73 * c), mul(up, 0.73 * s))))));
        const front = turned(x, y, 0, Math.atan2(-T.cam.fy, -T.cam.fx));
        S.loop([front.P(r + 0.03, -0.85, 0.9), front.P(r + 0.03, 0.85, 0.9), front.P(r + 0.03, 0.85, 3.5), front.P(r + 0.03, -0.85, 3.5)]);
        for (let j = 0; j < 3; j++) S.box(front, r + j * 0.5, -1.2, 0, r + (j + 1) * 0.5, 1.2, 0.9 - j * 0.25);
    }

    function cargoPort(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        // Ribbed freight canisters stacked beside a lightweight unloading crane.
        for (const [u, v, z] of [[-3, -2, 0], [-3, 1.8, 0], [-3, 0, 2.6], [3.4, 2, 0]]) {
            S.box(F, u - 2.8, v - 1.35, z + 0.2, u + 2.8, v + 1.35, z + 2.55);
            inKind(S, v < 0 ? RED : GOLD, () => {
                for (let a = -2.5; a < 2.6; a += 0.75) {
                    S.line([F.P(u + a, v - 1.37, z + 0.3), F.P(u + a, v - 1.37, z + 2.55), F.P(u + a, v + 1.35, z + 2.55)]);
                }
            });
            S.line([F.P(u + 2.82, v, z + 0.35), F.P(u + 2.82, v, z + 2.4)]);
        }
        S.box(F, 2, -4.5, 0, 4, -2.5, 1);
        for (const u of [2.3, 3.7]) S.line([F.P(u, -3.5, 1), F.P(u, -3.5, 10)]);
        for (let z = 1; z < 10; z += 1.5) S.line([F.P(2.3, -3.5, z), F.P(3.7, -3.5, z + 1.5)]);
        inKind(S, GOLD, () => {
            S.loop([F.P(3, -3.5, 10), F.P(-5, -3.5, 10), F.P(-5, -3.5, 9.3), F.P(3, -3.5, 9.3)]);
            for (let u = -5; u < 3; u++) S.line([F.P(u, -3.5, 9.3), F.P(u + 1, -3.5, 10)]);
        });
        S.line([F.P(-4.6, -3.5, 9.3), F.P(-4.6, -3.5, 5), F.P(-4.3, -3.5, 4.7), F.P(-4, -3.5, 5)]);
        S.line([F.P(3, -3.5, 10), F.P(3, -3.5, 11.8), F.P(-4.8, -3.5, 10)]);
    }

    function rover(T, x, y, angle, cargo = false) {
        const { S } = T, base = turned(x, y, 0, angle), scale = 1.3;
        const F = { P: (u, v, z) => base.P(u * scale, v * scale, z * scale), V: (u, v, z) => base.V(u * scale, v * scale, z * scale) };
        for (const u of [-2.1, 0, 2.1]) for (const v of [-1.45, 1.45]) {
            const a = F.P(u, v - 0.3, 0.75), b = F.P(u, v + 0.3, 0.75);
            tube(T, a, b, 0.75 * scale, 12);
            const side = T.cam.facing(...F.V(0, -1, 0)) ? v - 0.32 : v + 0.32;
            S.loop(ring(12, (c, s) => F.P(u + 0.48 * c, side, 0.75 + 0.48 * s)));
            if (T.p.detail) for (let i = 0; i < 4; i++) {
                const a = i * TAU / 4;
                S.line([F.P(u + 0.22 * Math.cos(a), side, 0.75 + 0.22 * Math.sin(a)), F.P(u + 0.48 * Math.cos(a), side, 0.75 + 0.48 * Math.sin(a))]);
            }
        }
        S.box(F, -2.8, -1.15, 1.2, 2.8, 1.15, 1.8);
        S.prism([F.P(-0.5, -1.1, 1.8), F.P(2.5, -1.1, 1.8), F.P(2.5, -1.1, 2.9), F.P(1.7, -1.1, 4), F.P(-0.5, -1.1, 4)], F.V(0, 2.2, 0));
        inKind(S, BLUE, () => {
            panel(T, [F.P(2.52, -0.86, 2.9), F.P(2.52, 0.86, 2.9), F.P(1.88, 0.86, 3.78), F.P(1.88, -0.86, 3.78)], BLUE, 0.65);
            for (const side of [-1, 1]) {
                if (!T.cam.facing(...F.V(0, side, 0))) continue;
                const v = side * 1.12;
                S.loop([F.P(-0.2, v, 2.8), F.P(1.65, v, 2.8), F.P(1.3, v, 3.7), F.P(-0.2, v, 3.7)]);
                S.line([F.P(0.5, v, 2.8), F.P(0.5, v, 3.7)]);
            }
        });
        inKind(S, GOLD, () => {
            S.line([F.P(-0.5, -1.13, 2.1), F.P(2.5, -1.13, 2.1), F.P(2.5, 1.13, 2.1)]);
            S.box(F, -0.6, -1.15, 4, 1.6, 1.15, 4.2);
        });
        if (cargo) S.box(F, -2.5, -0.9, 1.8, -0.5, 0.9, 3);
        else {
            tube(T, F.P(-1.3, 0, 1.8), F.P(-2.3, 0, 3.5), 0.15);
            tube(T, F.P(-2.3, 0, 3.5), F.P(-3.8, 0, 2.7), 0.11);
        }
        S.line([F.P(0, 0.8, 4.2), F.P(0, 0.8, 5.8)]);
    }

    function astronaut(T, x, y, angle, flag = false) {
        const { S } = T, F = turned(x, y, 0, angle);
        inKind(S, FIGURE, () => {
            S.box(F, -0.38, 0.1, 0.75, 0.38, 0.55, 1.7);
            S.lathe(x, y, [[0.36, 0.8], [0.46, 1.55], [0.3, 1.8]], 8);
            S.lathe(x, y, [[0.22, 1.75], [0.44, 1.88], [0.44, 2.2], [0.25, 2.4], [0, 2.45]], 12);
            for (const s of [-1, 1]) {
                tube(T, F.P(s * 0.2, 0, 0.9), F.P(s * 0.3, -s * 0.12, 0.18), 0.16, 6);
                S.box(F, s * 0.3 - 0.18, -0.36, 0.06, s * 0.3 + 0.18, 0.13, 0.24);
                S.line([F.P(s * 0.43, 0, 1.55), F.P(s * 0.65, -0.18, 1.1), F.P(s * 0.78, -0.4, 1.3)]);
            }
        });
        inKind(S, GOLD, () => S.line([F.P(-0.29, -0.37, 2.02), F.P(0.29, -0.37, 2.02)]));
        if (flag) {
            S.line([F.P(0.9, -0.4, 0), F.P(0.9, -0.4, 4)]);
            inKind(S, RED, () => panel(T, [F.P(0.9, -0.4, 4), F.P(2.6, -0.4, 4), F.P(2.6, -0.4, 3), F.P(0.9, -0.4, 3)], RED));
        }
    }

    function crater(T, c, rng) {
        const { S } = T, n = c.r > 6 ? 48 : 28, wobble = [];
        for (let i = 0; i < n; i++) {
            const a = i * TAU / n;
            wobble.push(1 + 0.045 * Math.sin(a * 3 + c.phase) + 0.025 * Math.cos(a * 7 - c.phase));
        }
        const rings = [[1.22, 0], [1, c.r * 0.09], [0.8, -c.r * 0.05], [0.43, -c.r * 0.24]];
        const at = (i, scale, z) => { const a = i * TAU / n, r = c.r * scale * wobble[i % n]; return [c.x + r * Math.cos(a), c.y + r * Math.sin(a), z]; };
        // The depression is an open mesh, never a convex solid. Each annulus
        // is triangulated so the near lip correctly hides the lower floor.
        for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
            const a = at(i, ...rings[j]), b = at((i + 1) % n, ...rings[j]), d = at(i, ...rings[j + 1]), c1 = at((i + 1) % n, ...rings[j + 1]);
            S.face([a, b, c1], false); S.face([a, c1, d], false);
            // Shade a continuous side of the bowl, on its actual facets.
            // Sparse, sloping strokes describe depth without a ring of spokes.
            const angle = (i + 0.5) * TAU / n;
            if (T.p.hatching && j > 0 && Math.cos(angle + 0.8) > 0.45) inKind(S, BLUE, () => {
                S.hatch([a, b, c1], b.map((v, k) => v - c1[k]), T.p.hatchGap * 1.5);
                S.hatch([a, c1, d], b.map((v, k) => v - c1[k]), T.p.hatchGap * 1.5);
            });
        }
        S.face(Array.from({ length: n }, (_, i) => at(i, ...rings[3])), false);
        inKind(S, DUST, () => {
            S.loop(Array.from({ length: n }, (_, i) => at(i, ...rings[1])));
            for (let i = 0; i < n; i += 12) S.line(Array.from({ length: 7 }, (_, j) => at((i + j) % n, ...rings[3])));
            // Broken ejecta arcs and widely spaced irregular gullies keep the
            // bowl legible without turning every crater into a toothed gear.
            for (let i = 0; i < n; i += 8) S.line(Array.from({ length: 6 }, (_, j) => at((i + j) % n, 1.22, 0)));
            for (let i = 0; i < n; i++) {
                if (i % 4 !== 0) continue;
                const a = at(i, ...rings[1]), b = at(i, ...rings[2]), c1 = at(i, ...rings[3]), t = rng.range(0.25, 0.8);
                S.line([a, b, b.map((v, k) => geo.lerp(v, c1[k], t))]);
                if (T.p.detail && i % 8 === 0) S.line([a, at(i, ...rings[0])]);
            }
        });
    }

    function mine(T, lot, rng) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        crater(T, { x: lot.x, y: lot.y, r: 7.7, phase: rng.range(0, TAU) }, rng);
        for (const u of [-9.3, 9.3]) for (const v of [-3, 3]) {
            S.box(F, u - 0.85, v - 0.8, 0, u + 0.85, v + 0.8, 0.45);
            S.box(F, u - 0.45, v - 0.45, 0, u + 0.45, v + 0.45, 8);
            S.line([F.P(u, v, 1), F.P(u, -v, 7.5)]);
        }
        for (const v of [-3, 3]) {
            S.box(F, -9.9, v - 0.3, 7.8, 9.9, v + 0.3, 8.6);
            inKind(S, GOLD, () => {
                for (let u = -9.8; u < 9; u += 1.1) S.line([F.P(u, v - 0.32, 7.8), F.P(u + 0.65, v - 0.32, 8.6)]);
            });
        }
        S.box(F, -1.5, -3.4, 8.6, 1.5, 3.4, 9.3);
        tube(T, F.P(0, 0, -1), F.P(0, 0, 9), 0.35);
        inKind(S, RED, () => S.line(Array.from({ length: 100 }, (_, i) => {
            const t = i / 99; return F.P(0.52 * Math.cos(t * TAU * 7), 0.52 * Math.sin(t * TAU * 7), -0.9 + t * 6.7);
        })));
        for (const u of [5.6, 7.8]) S.box(F, u - 0.8, -7.5, 0, u + 0.8, -5.9, 1.3);
    }

    function distanceToSegment(x, y, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = geo.clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    }

    function plan(T, seed) {
        const { cam, W, H, p } = T, rng = new PG.RNG(hash(seed, 10)), lots = [], links = [];
        const put = (type, sx, sy, r, port = r) => {
            const [x, y] = cam.ground(W * sx, H * sy);
            const lot = { type, x, y, r, port, angle: rng.pick([0, Math.PI / 2]), index: lots.length };
            lots.push(lot); return lot;
        };
        // Positions describe districts on the page; every object itself still
        // follows the same world axes. Small seeded offsets vary each colony.
        const jitter = () => rng.range(-0.025, 0.025);
        const layouts = {
            gardens: [[0.48, 0.43], [0.52, 0.61], [0.22, 0.60], [0.76, 0.29], [0.22, 0.32], [0.73, 0.51], [0.68, 0.70], [0.40, 0.23]],
            crescent: [[0.37, 0.44], [0.56, 0.61], [0.78, 0.53], [0.64, 0.26], [0.21, 0.27], [0.77, 0.38], [0.35, 0.68], [0.44, 0.20]],
            spine: [[0.56, 0.38], [0.40, 0.56], [0.21, 0.44], [0.73, 0.65], [0.31, 0.23], [0.77, 0.27], [0.35, 0.71], [0.68, 0.52]],
        };
        const positions = layouts[p.layout] || layouts.gardens;
        const specs = [['dome', 13, 11.7], ['hub', 6, 4.2], ['dome', 8.5, 7.7], ['dome', 9.5, 8.5],
            ['hab', 11, 2.4], ['hab', 11, 2.4], ['hab', 11, 2.4], ['hab', 11, 2.4]];
        specs.forEach(([type, r, port], i) => put(type, positions[i][0] + jitter(), positions[i][1] + jitter(), r, port));
        const nodes = lots.slice();
        put('pad', 0.26, 0.85, 12.5);
        put('solar', 0.49, 0.10, Math.max(13, p.solarRows * 3.6));
        if (p.launchpad) put('launch', 0.16, 0.20, 14);
        else put('dish', 0.12, 0.15, 7);
        put('observatory', 0.78, 0.13, 9);
        put('utilities', 0.90, 0.65, 9);
        put('cargo', 0.49, 0.91, 9);
        if (p.excavation) put('mine', 0.86, 0.91, 11);
        if (p.density > 0.4) put('dish', 0.92, 0.44, 5);
        if (p.craters > 0) {
            put('crater', 0.12, 0.48, 10);
            put('crater', 0.76, 0.82, 9);
        }
        // Relax reserved footprints before routing. This is particularly useful
        // with a tall camera, large buildings, landscape paper or a different plan.
        for (let pass = 0; pass < 60; pass++) {
            let moved = false;
            for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
                const a = lots[i], b = lots[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
                const gap = a.r + b.r + 3;
                if (d >= gap - 1e-4) continue;
                const push = (gap - d) * 0.51;
                a.x -= dx / d * push; a.y -= dy / d * push;
                b.x += dx / d * push; b.y += dy / d * push;
                moved = true;
            }
            if (!moved) break;
        }
        const occupied = (x, y, r, skip) => lots.some(l => l !== skip && Math.hypot(l.x - x, l.y - y) < l.r + r + 1.5);
        // The principal facilities are connected with the shortest unobstructed
        // spanning tree. Extra branches make circuits without cutting through lots.
        const candidates = [];
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            if (lots.some(l => l !== a && l !== b && distanceToSegment(l.x, l.y, a, b) < l.r + 2.5)) continue;
            candidates.push({ a, b, d: Math.hypot(a.x - b.x, a.y - b.y) });
        }
        candidates.sort((a, b) => a.d - b.d);
        const parent = nodes.map((_, i) => i), root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
        for (const e of candidates) {
            const a = root(e.a.index), b = root(e.b.index);
            if (a !== b) { parent[a] = b; links.push(e); }
        }
        if (p.tunnelLoops) for (const e of candidates) {
            if (links.length >= nodes.length + 1) break;
            if (!links.includes(e) && !links.some(l => segmentsCross(e.a, e.b, l.a, l.b))) links.push(e);
        }
        const clear = (x, y, r) => !occupied(x, y, r) && !links.some(e => distanceToSegment(x, y, e.a, e.b) < r + 2.4);
        // Fill the frame with working districts on the same world grid as the
        // architecture. Peripheral buildings continue beyond the crop as they
        // do in Town and Trainyard. Packing uses whole facilities, not specks.
        const corners = [[-12, -14], [W + 12, -14], [W + 12, H + 18], [-12, H + 18]].map(([x, y]) => cam.ground(x, y));
        const step = 22, x0 = Math.floor(Math.min(...corners.map(q => q[0])) / step), x1 = Math.ceil(Math.max(...corners.map(q => q[0])) / step);
        const y0 = Math.floor(Math.min(...corners.map(q => q[1])) / step), y1 = Math.ceil(Math.max(...corners.map(q => q[1])) / step);
        const grid = [];
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
            const x = i * step, y = j * step, q = cam.project(x, y, 0);
            if (q[0] < -9 || q[0] > W + 9 || q[1] < -5 || q[1] > H + 12) continue;
            grid.push({ x, y, q, order: rng.random() });
        }
        grid.sort((a, b) => a.order - b.order);
        let added = 0;
        const supplementalStart = lots.length;
        for (const cell of grid) {
            if (added >= 48) break;
            const { x, y, q } = cell;
            if (!clear(x, y, 9.5)) continue;
            const district = q[1] / H;
            const type = rng.pick(district < 0.24 ? ['solar', 'solar', 'workshop', 'greenhouse'] : district > 0.73 ? ['cargo', 'workshop', 'utilities', 'workshop'] : ['hab', 'workshop', 'greenhouse', 'greenhouse', 'utilities']);
            const lot = { type, x, y, r: type === 'hab' ? 11 : type === 'solar' ? 13 : 9.5,
                port: type === 'hab' ? 2.4 : 4, small: true, angle: rng.chance(0.75) ? 0 : Math.PI / 2, index: lots.length };
            if (!clear(x, y, lot.r)) continue;
            lots.push(lot); added++;
        }
        // Density is a share of the facilities that actually fit, so the
        // slider remains useful even when a large camera scale limits capacity.
        lots.splice(supplementalStart + Math.round(added * p.density));
        // Short branches pull housing and research blocks into the colony.
        // Industrial yards and solar fields keep open access for surface vehicles.
        const connected = new Set(nodes);
        const pending = lots.filter(l => !connected.has(l) && ['hab', 'workshop', 'greenhouse', 'observatory'].includes(l.type));
        for (let pass = 0; pass < 3; pass++) for (const a of pending) {
            if (connected.has(a)) continue;
            const choices = [...connected].map(b => ({ a, b, d: Math.hypot(a.x - b.x, a.y - b.y) })).sort((a, b) => a.d - b.d);
            const edge = choices.find(e => e.d < 48 && !lots.some(l => l !== e.a && l !== e.b && distanceToSegment(l.x, l.y, e.a, e.b) < l.r + 2) &&
                !links.some(l => segmentsCross(e.a, e.b, l.a, l.b)));
            if (edge) { links.push(edge); connected.add(a); }
        }
        const roads = [], traffic = new Map(), roadNodes = lots.filter(l => l.type !== 'crater');
        const roadCandidates = [];
        for (let i = 0; i < roadNodes.length; i++) for (let j = i + 1; j < roadNodes.length; j++) {
            const a = roadNodes[i], b = roadNodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 57 || d < a.r + b.r + 4 || links.some(l => l.a === a && l.b === b || l.a === b && l.b === a)) continue;
            if (lots.some(l => l !== a && l !== b && distanceToSegment(l.x, l.y, a, b) < l.r + 3)) continue;
            if (links.some(l => segmentsCross(a, b, l.a, l.b))) continue;
            roadCandidates.push({ a, b, d });
        }
        roadCandidates.sort((a, b) => a.d - b.d);
        for (const road of roadCandidates) {
            if ((traffic.get(road.a) || 0) >= 3 || (traffic.get(road.b) || 0) >= 3) continue;
            if (roads.some(l => segmentsCross(road.a, road.b, l.a, l.b))) continue;
            roads.push(road);
            traffic.set(road.a, (traffic.get(road.a) || 0) + 1); traffic.set(road.b, (traffic.get(road.b) || 0) + 1);
        }
        const clearSurface = (x, y, r) => clear(x, y, r) && !roads.some(e => distanceToSegment(x, y, e.a, e.b) < r + 3.1);
        for (const lot of lots) lot.ports = links.filter(e => e.a === lot || e.b === lot).map(e => {
            const other = e.a === lot ? e.b : e.a;
            return Math.atan2(other.y - lot.y, other.x - lot.x);
        });
        return { lots, links, roads, clear: clearSurface };
    }

    // Clip an apron edge against the exact width of its access routes.
    // Road ends and apron openings then share the same intersection points.
    function apronEdge(S, a, b, routes) {
        let intervals = [[0, 1]];
        for (const e of routes) {
            const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, length = Math.hypot(dx, dy);
            const at = p => [((p[0] - e.a.x) * dx + (p[1] - e.a.y) * dy) / length,
                ((p[0] - e.a.x) * -dy + (p[1] - e.a.y) * dx) / length];
            const p = at(a), q = at(b), width = e.width;
            let lo = 0, hi = 1;
            for (const [i, min, max] of [[0, 0, length], [1, -width, width]]) {
                const d = q[i] - p[i];
                if (Math.abs(d) < 1e-9) { if (p[i] < min || p[i] > max) hi = -1; continue; }
                lo = Math.max(lo, Math.min((min - p[i]) / d, (max - p[i]) / d));
                hi = Math.min(hi, Math.max((min - p[i]) / d, (max - p[i]) / d));
            }
            if (lo >= hi) continue;
            intervals = intervals.flatMap(([u, v]) => hi <= u || lo >= v ? [[u, v]] : [[u, Math.min(lo, v)], [Math.max(hi, u), v]].filter(([c, d]) => d - c > 1e-6));
        }
        for (const [u, v] of intervals) S.line([a.map((c, i) => geo.lerp(c, b[i], u)), a.map((c, i) => geo.lerp(c, b[i], v))]);
    }

    function infrastructure(T, site) {
        const { S } = T;
        inKind(S, DUST, () => {
            for (const road of site.roads) {
                const { a, b, d } = road, F = turned(a.x, a.y, 0, Math.atan2(b.y - a.y, b.x - a.x));
                // The apron faces trim these lines at the actual perimeter.
                const start = 0, end = d;
                for (const v of [-2.7, 2.7]) S.line([F.P(start, v, 0.025), F.P(end, v, 0.025)]);
                for (let u = start + 1; u < end - 1; u += 3.3) S.line([F.P(u, 0, 0.025), F.P(Math.min(end - 0.5, u + 1.5), 0, 0.025)]);
            }
            for (const lot of site.lots) {
                if (['dome', 'pad', 'launch', 'crater', 'mine', 'hub', 'dish'].includes(lot.type)) continue;
                const F = turned(lot.x, lot.y, 0, lot.angle), u = lot.type === 'solar' ? 12.7 : lot.type === 'hab' ? 8.5 : 10;
                const v = lot.type === 'solar' ? (lot.small ? 8 : T.p.solarRows * 3.25 + 1.5) : lot.type === 'hab' ? 8.5 : 7;
                const rim = [[-u + 1, -v], [u - 1, -v], [u, -v + 1], [u, v - 1], [u - 1, v], [-u + 1, v], [-u, v - 1], [-u, -v + 1]];
                const pts = rim.map(([a, b]) => F.P(a, b, 0.04));
                S.face(pts, false);
                const routes = [...site.roads.filter(e => e.a === lot || e.b === lot).map(e => ({ ...e, width: 2.7 })),
                    ...site.links.filter(e => e.a === lot || e.b === lot).map(e => ({ ...e, width: 2.1 }))];
                for (let i = 0; i < pts.length; i++) apronEdge(S, pts[i], pts[(i + 1) % pts.length], routes);
                if (lot.type === 'cargo' || lot.type === 'workshop') inKind(S, GOLD, () => {
                    for (let a = -u + 2; a < u - 2; a += 1.3) S.line([F.P(a, -v + 0.1, 0.04), F.P(a + 0.6, -v + 0.8, 0.04)]);
                });
            }
        });
    }

    function segmentsCross(a, b, c, d) {
        if (a === c || a === d || b === c || b === d) return false;
        const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    }

    function surface(T, site, seed) {
        const { S, W, H, cam, p } = T, rng = new PG.RNG(hash(seed, 20)), craters = [];
        const empty = (x, y, r) => site.clear(x, y, r) && !craters.some(c => Math.hypot(x - c.x, y - c.y) < r + c.r * 1.4);
        const addCrater = (sx, sy, r) => {
            const [x, y] = cam.ground(sx * W, sy * H);
            if (!empty(x, y, r * 1.4)) return;
            const c = { x, y, r, phase: rng.range(0, TAU) };
            craters.push(c); crater(T, c, rng);
        };
        for (const lot of site.lots.filter(l => l.type === 'crater')) {
            const c = { x: lot.x, y: lot.y, r: lot.r / 1.3, phase: rng.range(0, TAU) };
            craters.push(c); crater(T, c, rng);
        }
        for (let i = 0; i < p.craters * 7; i++) addCrater(rng.range(-0.05, 1.05), rng.range(-0.05, 1.05), rng.range(3.2, 8));
        // Broken, gently bowed regolith lines leave white breathing room and
        // make the craters part of a landscape rather than isolated ellipses.
        inKind(S, DUST, () => {
            for (let i = 0; i < (p.detail ? 240 : 100); i++) {
                const [x, y] = cam.ground(rng.range(-5, W + 5), rng.range(-5, H + 5));
                const length = rng.range(0.4, 3.1);
                if (!empty(x, y, length)) continue;
                S.line(Array.from({ length: 5 }, (_, j) => [x + (j / 4 - 0.5) * length, y + Math.sin(j * Math.PI / 4) * length * 0.12, 0.015]));
                if (p.detail && rng.chance(0.28)) S.line([[x + 0.1, y + 0.48, 0.02], [x + 0.1 + length * 0.4, y + 0.51, 0.02]]);
            }
        });
        for (let i = 0; i < p.boulders * 110; i++) {
            const [x, y] = cam.ground(rng.range(0, W), rng.range(0, H)), r = rng.range(0.3, 1.4);
            if (!empty(x, y, r + 0.3)) continue;
            S.lathe(x, y, [[r, 0], [r * 0.85, r * 0.55], [r * 0.35, r * 1.1]], rng.int(4, 6), false, rng.range(0, TAU));
        }
        return empty;
    }

    function activity(T, site, empty, seed) {
        const { S, W, H, cam, p } = T, rng = new PG.RNG(hash(seed, 30));
        // Tracks share a curving center line with the rover heading. Every
        // sample is checked against both facilities and crater footprints.
        let made = 0;
        for (const road of site.roads.filter(e => e.d - e.a.r - e.b.r > 10).sort((a, b) => b.d - a.d)) {
            if (made >= p.rovers) break;
            const t = (road.a.r + (road.d - road.a.r - road.b.r) * 0.5) / road.d;
            const x = geo.lerp(road.a.x, road.b.x, t), y = geo.lerp(road.a.y, road.b.y, t);
            rover(T, x, y, Math.atan2(road.b.y - road.a.y, road.b.x - road.a.x), made % 2 === 1);
            made++;
        }
        for (let i = 0; i < 180 && made < p.rovers; i++) {
            const [x, y] = cam.ground(rng.range(0.08, 0.92) * W, rng.range(0.18, 0.94) * H);
            if (!empty(x, y, 4)) continue;
            const angle = rng.range(0, TAU), F = turned(x, y, 0, angle);
            rover(T, x, y, angle, made % 2 === 1);
            inKind(S, DUST, () => {
                for (const side of [-1.5, 1.5]) {
                    let pts = [];
                    for (let j = 0; j < 24; j++) {
                        const u = -3 - j * 0.45, v = side + 0.018 * (u + 3) * (u + 3), q = F.P(u, v, 0.025);
                        if (!empty(q[0], q[1], 0.25)) { if (pts.length > 1) S.line(pts); pts = []; continue; }
                        pts.push(q);
                        if (p.detail && j % 2 === 0) S.line([F.P(u - 0.12, v - 0.2, 0.03), F.P(u + 0.12, v + 0.2, 0.03)]);
                    }
                    if (pts.length > 1) S.line(pts);
                }
            });
            made++;
        }
        let people = 0;
        for (let i = 0; i < 150 && people < p.crew; i++) {
            const lot = rng.pick(site.lots), a = rng.range(0, TAU), r = lot.r + rng.range(2, 5);
            const x = lot.x + r * Math.cos(a), y = lot.y + r * Math.sin(a);
            const q = cam.project(x, y, 0);
            if (q[0] < 3 || q[0] > W - 3 || q[1] < 3 || q[1] > H - 3 || !empty(x, y, 0.7)) continue;
            astronaut(T, x, y, rng.range(-0.5, 0.5), people === 0); people++;
            if (p.detail) inKind(S, DUST, () => {
                for (let j = 1; j < 9; j++) {
                    const xx = x - 0.42 * j, yy = y + 0.25 * j + (j % 2 ? 0.2 : -0.2);
                    if (empty(xx, yy, 0.15)) S.line([[xx, yy, 0.02], [xx - 0.14, yy + 0.07, 0.02]]);
                }
            });
        }
    }

    PG.register({
        id: 'moonbase', name: 'Moon Base', category: 'Scenes', fit: false,
        description: 'A lunar garden colony with geodesic biospheres, ribbed pressure tunnels, a lander, solar fields and crater expeditions, drawn in isometric ink.',
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Colony scale', type: 'range', min: 0.75, max: 1.4, step: 0.025, value: 1.1, random: [1, 1.2], hint: 'Size of the buildings within the lunar landscape' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 25, max: 60, step: 0.5, value: 38, random: false, hint: '35.3 is true isometric' },
            { type: 'section', label: 'Settlement' },
            { id: 'layout', label: 'Colony plan', type: 'select', value: 'gardens', options: [['gardens', 'Garden constellation'], ['crescent', 'Crescent settlement'], ['spine', 'Research spine']], random: true },
            { id: 'gardens', label: 'Biosphere gardens', type: 'checkbox', value: true, hint: 'Clear front glazing reveals trees and hydroponic growing beds' },
            { id: 'tunnelLoops', label: 'Extra tunnel links', type: 'checkbox', value: true, random: 0.65 },
            { id: 'density', label: 'Settlement density', type: 'range', min: 0, max: 1, step: 0.05, value: 1, random: [0.75, 1], hint: 'Habitation blocks, workshops, growing houses and cargo yards around the biospheres' },
            { id: 'solarRows', label: 'Solar array rows', type: 'range', min: 1, max: 4, step: 1, value: 3, random: [2, 4] },
            { id: 'lander', label: 'Lunar lander', type: 'checkbox', value: true, random: 0.9 },
            { id: 'launchpad', label: 'Shuttle & launch gantry', type: 'checkbox', value: true, random: 0.9 },
            { id: 'excavation', label: 'Crater drilling rig', type: 'checkbox', value: true, random: 0.8 },
            { type: 'section', label: 'Lunar surface' },
            { id: 'craters', label: 'Impact craters', type: 'range', min: 0, max: 24, step: 1, value: 9, random: [6, 14] },
            { id: 'boulders', label: 'Boulders', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25, random: [0.1, 0.4] },
            { id: 'rovers', label: 'Exploration rovers', type: 'range', min: 0, max: 8, step: 1, value: 4, random: [2, 6] },
            { id: 'crew', label: 'Astronauts', type: 'range', min: 0, max: 24, step: 1, value: 8, random: [4, 12] },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true, hint: 'Finer dome glazing, crop leaves, wheel spokes, footprints and tracks in the dust' },
            { type: 'section', label: 'Shading' },
            { id: 'hatching', label: 'Glass & surface hatching', type: 'checkbox', value: true },
            { id: 'hatchGap', label: 'Hatch spacing (mm)', type: 'range', min: 0.4, max: 2, step: 0.05, value: 0.8, random: false, show: p => p.hatching },
            { id: 'shadows', label: 'Cast shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 48, random: [38, 60], show: p => p.shadows },
            { id: 'shadowGap', label: 'Shadow spacing (mm)', type: 'range', min: 0.4, max: 2, step: 0.05, value: 0.9, random: false, show: p => p.shadows },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H } = ctx, k = 1.55 * p.scale * Math.min(W / 180, H / 250);
            const cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0), S = new Scene(cam, W, H);
            const T = { S, p, cam, W, H, k, detail: p.detail, tones: p.hatching, hDark: p.hatchGap,
                segs: r => segments(r, k), sees: n => cam.facing(...n) };
            const site = plan(T, ctx.seed), empty = surface(T, site, ctx.seed);
            infrastructure(T, site);
            if (p.shadows) {
                const cot = 1 / Math.tan(geo.rad(p.sun));
                S.sun = [cot * 0.42, -cot * 0.91];
                S.shadowGroup(0.055, null, Math.atan2(cam.ry, cam.rx));
            }
            for (const e of site.links) tunnel(T, e.a, e.b);
            for (const lot of site.lots) {
                S.kind = INK;
                const rng = new PG.RNG(hash(ctx.seed, 40, lot.index));
                switch (lot.type) {
                    case 'dome': biosphere(T, lot, rng); break;
                    case 'hab': habitatBlock(T, lot); break;
                    case 'workshop': workshop(T, lot); break;
                    case 'greenhouse': greenhouse(T, lot); break;
                    case 'hub': hub(T, lot); break;
                    case 'pad': landingPad(T, lot); break;
                    case 'launch': launchSite(T, lot); break;
                    case 'solar': solar(T, lot); break;
                    case 'dish': dish(T, lot.x, lot.y, lot.r * 0.78, -0.55); break;
                    case 'utilities': utilities(T, lot); break;
                    case 'observatory': observatory(T, lot); break;
                    case 'cargo': cargoPort(T, lot); break;
                    case 'mine': mine(T, lot, rng); break;
                }
            }
            activity(T, site, empty, ctx.seed);
            if (p.shadows) { S.kind = BLUE; S.hatchShadows(p.shadowGap); }
            return PG.pens.renderScene('moonbase', S, p);
        },
    });
})();
