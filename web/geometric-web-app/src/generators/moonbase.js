/*
 * Moon Base: a garden colony on the Moon or Mars in the illustrated isometric
 * scene family. The site is planned before drawing: pressure tunnels connect a
 * spanning tree of occupied lots, and craters, dunes, boulders and tracks
 * respect those reservations.
 * The seed picks the shape of the plan, where each facility goes and a house
 * style for the domes and habitats, so two colonies don't share a skeleton.
 * Biospheres have opaque rear glazing and a clear viewing belt at the front;
 * the same depth-tested faces hide terrain behind the glass and reveal gardens.
 * All geometry stays in world coordinates, including dishes, rover wheels,
 * crater bowls and the triangular glazing. Nothing is a screen-space decal.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { makeCamera, Scene, ring, hash, segments } = PG.iso;
    const { turned, unit, inKind, outward } = PG.isokit;
    const INK = 0, RED = 1, BLUE = 2, GOLD = 3, GREEN = 4, FIGURE = 5, GLASS = 6, DUST = 7;
    const Z = [0, 0, 1];
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const mul = (a, s) => a.map(v => v * s);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
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

    // Rectangular buildings only take tunnels square on, through a short port
    // tunnel to an airlock pod outside one end (axis 0) or side (axis 1).
    // The long run then goes pod to pod, so it never hits a hull at an angle
    // or comes in through a door. `at` is the pod's distance from the center.
    const PORTS = { hab: { axis: 0, at: 10.3 }, greenhouse: { axis: 0, at: 11.3 }, workshop: { axis: 1, at: 8 } };
    const POD = 1.9;

    // Where a tunnel meets a round building along `angle`: the collar goes at
    // `s` from the center, just outside the wall, and the body runs on to `e`
    // so the joint is hidden inside.
    function dockAt(lot, angle) {
        switch (lot.type) {
            case 'dome': return [lot.r - 0.5, lot.r - 1.2];
            case 'hub': {
                // Octagon with faces square to the world axes
                const q = Math.PI / 4, off = angle - Math.round(angle / q) * q, s = 4.6 * Math.cos(Math.PI / 8) / Math.cos(off);
                return [s, s - 0.8];
            }
            case 'observatory': return [5.25, 4.4];
            default: return [POD, 1];
        }
    }

    // A pressure tunnel from a to b. Collars sit at sa from a and sb from b,
    // the body runs from ea to d - eb.
    function tunnel(T, a, b, sa, ea, sb, eb) {
        const { S } = T, angle = Math.atan2(b.y - a.y, b.x - a.x), d = Math.hypot(b.x - a.x, b.y - a.y);
        const F = turned(a.x, a.y, 0, angle), start = sa, end = d - sb;
        if (end - start < 0.1) return;
        // A square sill, curved roof, and heavy expansion collars make an
        // enclosed passage distinct from the exposed service pipes below it.
        const arch = (u, extra = 0) => [F.P(u, -1.35 - extra, 0.7), ...Array.from({ length: 13 }, (_, i) => {
            const t = Math.PI - Math.PI * i / 12;
            return F.P(u, (1.35 + extra) * Math.cos(t), 1.75 + (1.35 + extra) * Math.sin(t));
        }), F.P(u, 1.35 + extra, 0.7)];
        S.prism(arch(ea), F.V(d - eb - ea, 0, 0), true);
        S.line([F.P(start, -1.37, 1), F.P(end, -1.37, 1)]);
        // Collars sit right against the wall at each end. Short port tunnels
        // only have room for one.
        const collars = end - start > 1.2 ? [start, end - 0.35] : [start];
        for (const u of collars) {
            S.prism(arch(u, 0.16), F.V(0.35, 0, 0), true);
            inKind(S, RED, () => S.line(arch(u + 0.18, 0.18)));
            S.box(F, u - 0.12, -1.65, 0, u + 0.47, 1.65, 0.7);
        }
        const step = T.p.detail ? 1.4 : 2.8;
        for (let u = start + 0.85, i = 0; u < end - 0.6; u += step, i++) {
            S.line(arch(u, 0.04));
            if (i % 5 === 4) {
                inKind(S, RED, () => S.line(arch(u + 0.13, 0.06)));
                S.box(F, u - 0.2, -1.65, 0, u + 0.2, 1.65, 0.7);
            }
        }
        inKind(S, GOLD, () => {
            for (const v of [-1.75, -1.95]) tube(T, F.P(start, v, 0.38), F.P(end, v, 0.38), 0.075, 6);
        });
    }

    // Airlock pod where a port tunnel turns onto a long run
    function pod(T, x, y) {
        const { S } = T;
        S.lathe(x, y, [[POD, 0], [POD, 3.6], [POD - 0.5, 4.2], [0.7, 4.45], [0, 4.45]], 20);
        inKind(S, RED, () => circle(S, x, y, POD + 0.03, 3.2, 20));
    }

    function tunnelNetwork(T, site) {
        for (const e of site.links) {
            const A = e.pa, B = e.pb, angle = Math.atan2(B.y - A.y, B.x - A.x);
            const [sa, ea] = A === e.a ? dockAt(e.a, angle) : [POD, 1];
            const [sb, eb] = B === e.b ? dockAt(e.b, angle + Math.PI) : [POD, 1];
            tunnel(T, A, B, sa, ea, sb, eb);
        }
        for (const lot of site.lots) {
            if (!lot.dock) continue;
            const { axis, at } = PORTS[lot.type], F = turned(lot.x, lot.y, 0, lot.angle);
            for (const side of lot.dock) {
                const q = axis ? F.P(0, side * at, 0) : F.P(side * at, 0, 0);
                // The port tunnel leaves from the building's own wall: the
                // cross tunnel between the hab hulls (or the end of the heap
                // over them), a greenhouse end wall or a workshop side wall.
                const [s, e] = { hab: lot.style === 'bermed' ? [5.02, 4.3] : [1.5, 0], greenhouse: [8.85, 8.5], workshop: [5.55, 4.8] }[lot.type];
                tunnel(T, lot, { x: q[0], y: q[1] }, s, e, POD, 1);
                pod(T, q[0], q[1]);
            }
        }
    }

    function garden(T, lot, rng) {
        const { S } = T, { x, y, r } = lot, F = turned(x, y, 1.05, 0);
        let top = 1.05;
        if (lot.garden === 'terrace') {
            // Stepped planting rings, like a wedding cake, in place of the beds
            for (const f of [0.6, 0.42, 0.24]) {
                S.lathe(x, y, [[r * f, top], [r * f, top + 0.5]], 32);
                top += 0.5;
                const rr = r * (f - 0.09), n = Math.round(rr * 2.4);
                inKind(S, GREEN, () => {
                    circle(S, x, y, rr, top + 0.02, 32);
                    if (T.p.detail) for (let i = 0; i < n; i++) {
                        const a = TAU * i / n, q = [x + rr * Math.cos(a), y + rr * Math.sin(a), top + 0.03], h = rng.range(0.35, 0.65);
                        S.line([add(q, [-0.23, 0, h]), q, add(q, [0.23, 0, h])]);
                    }
                });
            }
        } else for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            // Four growing beds leave a central cross-shaped promenade.
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
        // The big dome gets one tree in the middle, the others a pond.
        // Several trees piled up over the beds and each other.
        if (r > 11) inKind(S, GREEN, () => PG.isokit.roundTree(T, x, y, top, rng));
        else inKind(S, GLASS, () => {
            S.lathe(x, y, [[0.9, top + 0.05], [0.9, top + 0.45]], 16);
            circle(S, x, y, 0.65, top + 0.47, 16);
        });
    }

    // Triangles of a geodesic hemisphere on the unit dome
    function geodesic(frequency) {
        const panels = [];
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2, b = (i + 1) * Math.PI / 2;
            const A = [Math.cos(a), Math.sin(a), 0], B = [Math.cos(b), Math.sin(b), 0];
            const vertex = (u, v) => unit(add(add(mul(A, frequency - u - v), mul(B, u)), mul(Z, v)));
            for (let u = 0; u < frequency; u++) for (let v = 0; v < frequency - u; v++) {
                panels.push({ q: [vertex(u, v), vertex(u + 1, v), vertex(u, v + 1)], glass: true });
                if (u + v < frequency - 1) panels.push({ q: [vertex(u + 1, v), vertex(u + 1, v + 1), vertex(u, v + 1)], glass: true });
            }
        }
        return panels;
    }

    // Panels of a dome of revolution with m meridians. `profile` is [radius,
    // height] on the unit dome from the base up, closed by a flat cap. Every
    // panel has two level edges, so the quads stay flat. glass(i, k) says
    // whether panel i of band k is glazed, and k past the last band is the cap.
    function latLong(profile, m, glass = () => true) {
        const panels = [], last = profile.length - 1;
        const at = (i, k) => { const a = TAU * (i % m) / m; return [profile[k][0] * Math.cos(a), profile[k][0] * Math.sin(a), profile[k][1]]; };
        for (let k = 0; k < last; k++) for (let i = 0; i < m; i++) {
            panels.push({ q: [at(i, k), at(i + 1, k), at(i + 1, k + 1), at(i, k + 1)], glass: glass(i, k) });
        }
        panels.push({ q: Array.from({ length: m }, (_, i) => at(i, last)), glass: glass(0, last) });
        return panels;
    }

    // One set of panels supplies glazing, ribs AND silhouette.
    // Independent circular ribs cut across flat panels and produce loose
    // ends; shared panel edges meet exactly, even with the clear front belt.
    // edgeKind(a, b, sides) picks the pen for an edge off the outline, or null.
    function shell(T, lot, z, h, panels, edgeKind) {
        const { S, cam } = T, { x, y, r } = lot, edges = new Map();
        const at = q => [x + r * q[0], y + r * q[1], z + h * q[2]];
        const pointKey = q => q.map(v => Math.round(v * 1e6)).join(',');
        panels.forEach((panel, i) => {
            const pts = panel.q.map(at), mid = mul(panel.q.reduce(add), 1 / panel.q.length);
            const front = cam.facing(...outward(pts, [x, y, z])), view = -(mid[0] * cam.fx + mid[1] * cam.fy);
            const clear = panel.glass && T.p.gardens && front && view > 0.12 && mid[2] < 0.93;
            if (!clear) S.face(pts);
            panel.q.forEach((a, j) => {
                const b = panel.q[(j + 1) % panel.q.length], ka = pointKey(a), kb = pointKey(b), key = ka < kb ? ka + '/' + kb : kb + '/' + ka;
                if (!edges.has(key)) edges.set(key, { a, b, sides: [] });
                edges.get(key).sides.push({ front, glass: panel.glass });
            });
            if (front && !clear && panel.glass && T.p.hatching && i % 5 === 0) inKind(S, GLASS, () => S.hatch(pts, [1, -0.2, 1], T.p.hatchGap * 1.4));
        });
        for (const { a, b, sides } of edges.values()) {
            if (!sides.some(s => s.front)) continue;
            const kind = sides.length === 1 || sides.some(s => !s.front) ? INK : edgeKind(a, b, sides);
            if (kind !== null) inKind(S, kind, () => S.line([at(a), at(b)]));
        }
    }

    function biosphere(T, lot, rng) {
        const { S, cam } = T, { x, y, r } = lot, z = 1.2, level = (a, b) => Math.abs(a[2] - b[2]) < 1e-6;
        S.lathe(x, y, [[r + 0.6, 0], [r + 0.6, 0.45], [r, 0.7], [r, z]], 48);
        inKind(S, RED, () => circle(S, x, y, r + 0.04, 0.88, 48));
        if (T.p.gardens) garden(T, lot, rng);
        let h = r * 0.84;
        if (lot.style === 'ribbed') {
            // Conservatory: a glazed drum under a shallow dome, with eight
            // of the meridians as structural ribs
            const m = T.p.detail ? (r > 11 ? 24 : 16) : 12, step = m === 16 ? 2 : 3;
            const profile = [[1, 0], [1, 0.27], [0.95, 0.48], [0.83, 0.67], [0.64, 0.83], [0.4, 0.94], [0.15, 1]];
            h = r * 0.9;
            shell(T, lot, z, h, latLong(profile, m), (a, b) => {
                if (level(a, b)) return Math.abs(a[2] - 0.27) < 1e-6 ? INK : GLASS;
                return Math.round(Math.atan2(a[1], a[0]) / TAU * m + m) % step ? GLASS : INK;
            });
            S.lathe(x, y, [[r * 0.15, z + h - 0.05], [r * 0.15, z + h + 0.55], [r * 0.07, z + h + 1.05]], 12);
            inKind(S, RED, () => circle(S, x, y, r * 0.15 + 0.03, z + h + 0.3, 12));
        } else if (lot.style === 'shell') {
            // Printed regolith: a pointed beehive laid down in courses, opaque
            // apart from an oculus and a glazed bay turned to the viewer
            const m = 24, bands = T.p.detail ? 14 : 8, toward = Math.atan2(-cam.fy, -cam.fx) + 0.2;
            const profile = Array.from({ length: bands + 1 }, (_, k) => {
                const t = 1.2025 * k / bands; return [1.25 * Math.cos(t) - 0.25, 1.029 * Math.sin(t)];
            });
            const bay = (i, k) => k === bands || k > 0 && k < bands * 0.62 && Math.abs(wrap(TAU * (i + 0.5) / m - toward)) < 0.72;
            h = r * 1.02;
            shell(T, lot, z, h, latLong(profile, m, bay), (a, b, sides) =>
                sides.every(s => s.glass) ? GLASS : sides.some(s => s.glass) ? INK : level(a, b) ? DUST : null);
            S.lathe(x, y, [[r * 0.2 + 0.2, z + h * 0.96 - 0.25], [r * 0.2 + 0.2, z + h * 0.96 + 0.3]], 24);
            inKind(S, GLASS, () => {
                circle(S, x, y, r * 0.2 - 0.15, z + h * 0.96 + 0.32, 24);
                for (const a of [0, Math.PI / 2]) {
                    const c = (r * 0.2 - 0.15) * Math.cos(a), s = (r * 0.2 - 0.15) * Math.sin(a);
                    S.line([[x - c, y - s, z + h * 0.96 + 0.32], [x + c, y + s, z + h * 0.96 + 0.32]]);
                }
            });
        } else {
            const frequency = T.p.detail ? (r > 11 ? 6 : 4) : 3;
            shell(T, lot, z, h, geodesic(frequency), (a, b) =>
                [0, 1].some(i => Math.abs(a[i]) < 1e-6 && Math.abs(b[i]) < 1e-6) ? INK : GLASS);
            S.lathe(x, y, [[0.72, z + h - 0.05], [0.72, z + h + 0.4], [0.35, z + h + 0.65]], 12);
        }
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
            });
        }
        // Round-topped hatch. An octagon with a bar across it read as a face.
        const end = T.cam.facing(...F.V(-1, 0, 0)) ? -L - 0.03 : L + 0.03;
        S.line([F.P(end, -1, 1.75), F.P(end, -1, 3.6), ...Array.from({ length: 9 }, (_, i) => {
            const a = Math.PI - Math.PI * i / 8; return F.P(end, Math.cos(a), 3.6 + Math.sin(a));
        }), F.P(end, 1, 1.75), F.P(end, -1, 1.75)]);
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

    // Text on a wall has to run left to right on the page, whichever way the wall faces
    const reads = (T, v) => v[0] * T.cam.rx + v[1] * T.cam.ry < 0 ? -1 : 1;

    // Upright habitat on a ring footing: a squat two-deck can, or a tall tower
    // printed in courses. `outer` is the angle of its side away from the corridor.
    function upright(T, lot, index, outer) {
        const { S, cam } = T, { x, y } = lot, tall = lot.style === 'tower';
        const prof = tall ? [[2.75, 0.5], [3.1, 2.6], [3.15, 5.5], [2.85, 8.4], [2.2, 10.9], [1.25, 12.7], [0.55, 13.4]]
            : [[3.05, 0.5], [3.05, 5.9], [2.6, 6.7], [1, 7.1]];
        const rad = z => {
            let k = 0;
            while (k < prof.length - 2 && z > prof[k + 1][1]) k++;
            return geo.lerp(prof[k][0], prof[k + 1][0], (z - prof[k][1]) / (prof[k + 1][1] - prof[k][1]));
        };
        // A hair outside the wall, otherwise the facets hide what is drawn on it
        const on = (a, z) => [x + (rad(z) + 0.04) * Math.cos(a), y + (rad(z) + 0.04) * Math.sin(a), z];
        const toward = Math.atan2(-cam.fy, -cam.fx), top = prof[prof.length - 1][1];
        S.lathe(x, y, [[3.35, 0], [3.35, 0.5]], 24);
        S.lathe(x, y, prof, 24);
        inKind(S, RED, () => { for (const z of tall ? [1.4, 8.4] : [1.3, 5.6]) circle(S, x, y, rad(z) + 0.03, z, 24); });
        if (tall) {
            inKind(S, DUST, () => {
                for (let z = 2.5; z < 13; z += 1.1) if (Math.abs(z - 8.4) > 0.3) circle(S, x, y, rad(z) + 0.03, z, 24);
            });
            // A slot window on each of three decks
            inKind(S, GLASS, () => {
                for (const z of [3, 5.8, 8.8]) for (const da of [-0.75, 0, 0.75]) {
                    const side = s => Array.from({ length: 4 }, (_, i) => on(toward + da + s * 0.1, z + i * 0.55));
                    S.loop([...side(-1), ...side(1).reverse()]);
                }
                circle(S, x, y, 0.35, top + 0.02, 12);
            });
            S.line([[x, y, top], [x, y, top + 2.2]]);
        } else {
            inKind(S, GLASS, () => {
                for (const z of [2.4, 4.4]) for (const da of [-0.95, -0.32, 0.32, 0.95]) {
                    S.loop(ring(12, (c, s) => on(toward + da + 0.17 * c, z + 0.52 * s)));
                }
            });
            S.lathe(x, y, [[1, 7.1], [1, 7.45], [0.6, 7.7]], 12);
            S.line([[x + 1.9, y, 6.85], [x + 1.9, y, 9.4]]);
            S.line([[x + 1.15, y, 8.8], [x + 2.65, y, 8.8]]);
        }
        // The door goes on whichever free side faces the viewer most
        const door = [lot.angle, lot.angle + Math.PI, outer].sort((a, b) => Math.cos(b - toward) - Math.cos(a - toward))[0];
        S.line([on(door - 0.3, 0.9), on(door - 0.3, 2.3), on(door - 0.2, 2.75), on(door + 0.2, 2.75), on(door + 0.3, 2.3), on(door + 0.3, 0.9)]);
        S.box(turned(x, y, 0, door), 3, -1, 0, 4, 1, 0.85);
        const way = reads(T, [-Math.sin(door), Math.cos(door)]);
        inKind(S, RED, () => number(S, String(index + 1).padStart(2, '0'), (u, v) => on(door + way * (u - 0.62) / 3.1, 3.3 + v), 0.6));
    }

    // Twin hulls under one heap of regolith. Only the hull ends, a few vents
    // and the skylights show. The cross tunnel is somewhere inside.
    function bermed(T, lot) {
        const { S, cam } = T, F = turned(lot.x, lot.y, 0, lot.angle), L = 5, W = 7.9, H = 5.3, r = 2.3, zc = 2.9;
        const arch = u => Array.from({ length: 17 }, (_, i) => {
            const t = Math.PI * (1 - i / 16);
            return F.P(u, W * Math.cos(t), H * Math.pow(Math.max(0, Math.sin(t)), 0.7));
        });
        S.prism(arch(-L), F.V(2 * L, 0, 0), true);
        inKind(S, DUST, () => {
            // Courses of sandbags, with the joints staggered like brickwork
            for (let i = 2; i < 16; i += 2) S.line([arch(-L)[i], arch(L)[i]]);
            if (T.p.detail) for (let i = 0; i < 16; i += 2) for (let u = -L + (i % 4 ? 0.9 : 1.8); u < L - 0.3; u += 1.8) S.line(arch(u).slice(i, i + 3));
        });
        const way = reads(T, F.V(0, 1, 0));
        for (const v of [-4.4, 4.4]) for (const end of [-1, 1]) {
            const hoop = (u, rr) => ring(20, (c, s) => F.P(u, v + rr * c, zc + rr * s));
            S.prism(hoop(end * (L - 0.5), r), F.V(end * 2, 0, 0), true);
            S.loop(hoop(end * (L + 0.01), r + 0.05));
            if (!cam.facing(...F.V(end, 0, 0))) continue;
            inKind(S, RED, () => S.loop(hoop(end * (L + 0.4), r + 0.03)));
            const u = end * (L + 1.53);
            S.line([F.P(u, v - 0.85, 1.6), F.P(u, v - 0.85, 3.1), ...Array.from({ length: 9 }, (_, i) => {
                const a = Math.PI - Math.PI * i / 8; return F.P(u, v + 0.85 * Math.cos(a), 3.1 + 0.85 * Math.sin(a));
            }), F.P(u, v + 0.85, 1.6), F.P(u, v - 0.85, 1.6)]);
            for (let i = 0; i < 3; i++) {
                const a = L + 1.5 + i * 0.5, b = a + 0.5;
                S.box(F, end > 0 ? a : -b, v - 0.95, 0, end > 0 ? b : -a, v + 0.95, 1.5 - i * 0.5);
            }
            const index = lot.index * 2 + (v > 0 ? 1 : 0);
            inKind(S, RED, () => number(S, String(index + 1).padStart(2, '0'), (a, b) => F.P(u, v + way * (a - 0.5), 4.15 + b), 0.5));
        }
        for (const u of [-2.6, 0.4, 3.1]) {
            const q = F.P(u, 0, 0);
            S.lathe(q[0], q[1], [[0.4, H - 0.2], [0.4, H + 0.8], [0.65, H + 0.8], [0.65, H + 1.05]], 10);
        }
        inKind(S, GLASS, () => {
            for (const u of [-2, 2]) for (const v of [-4.4, 4.4]) {
                const q = F.P(u, v, 0), z = H * Math.pow(1 - (v / W) ** 2, 0.35) - 0.25;
                S.lathe(q[0], q[1], [[0.85, z], [0.75, z + 0.45], [0.4, z + 0.75], [0, z + 0.82]], 12);
            }
        });
    }

    function habitatBlock(T, lot) {
        if (lot.style === 'bermed') return bermed(T, lot);
        const F = turned(lot.x, lot.y, 0, lot.angle), stands = lot.style === 'can' || lot.style === 'tower';
        for (const v of [-4.5, 4.5]) {
            const q = F.P(0, v, 0), module = { ...lot, x: q[0], y: q[1] }, index = lot.index * 2 + (v > 0 ? 1 : 0);
            if (stands) upright(T, module, index, lot.angle + Math.sign(v) * Math.PI / 2);
            else habitat(T, module, index);
        }
        // The cross tunnel runs into each hull as far as its axis, which keeps
        // the joint hidden even under the curve of the hull
        const a = F.P(0, -4.5, 0), b = F.P(0, 4.5, 0), wall = stands ? 3.07 : 2.66;
        tunnel(T, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, wall, 0, wall, 0);
        // Battery box in the corridor between the hulls, unless a port tunnel needs it
        const { S } = T;
        for (const side of [-1, 1]) {
            if ((lot.dock || []).includes(side) || side > 0 && !(lot.dock || []).includes(-1)) continue;
            S.box(F, side * 4, -1.3, 0, side * 1.5, 1.3, 2.3);
            inKind(S, BLUE, () => {
                for (let u = 1.8; u < 4; u += 0.5) S.line([F.P(side * u, -1.3, 2.33), F.P(side * u, 1.3, 2.33)]);
            });
        }
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
        if (lot.roof === 'sawtooth') {
            // North lights: the upright side of each tooth is glazed
            const lit = T.cam.facing(...F.V(-1, 0, 0));
            for (let a = -6; a < 5; a += 2.9) {
                S.prism([F.P(a, -4.4, 7.15), F.P(a + 2.6, -4.4, 7.15), F.P(a, -4.4, 9)], F.V(0, 8.8, 0));
                if (lit) inKind(S, GLASS, () => {
                    S.loop([F.P(a - 0.02, -4, 7.45), F.P(a - 0.02, 4, 7.45), F.P(a - 0.02, 4, 8.7), F.P(a - 0.02, -4, 8.7)]);
                    for (let v = -2; v < 3; v += 2) S.line([F.P(a - 0.02, v, 7.45), F.P(a - 0.02, v, 8.7)]);
                });
                else inKind(S, BLUE, () => {
                    for (const t of [0.35, 0.65]) S.line([F.P(a + 2.6 * t, -4.4, 9 - 1.85 * t + 0.02), F.P(a + 2.6 * t, 4.4, 9 - 1.85 * t + 0.02)]);
                });
            }
            return;
        }
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
        // Seventeen points across the roof, either a barrel vault or a pitched
        // roof on low walls. Everything below works off the same points.
        const peak = lot.style === 'peak', section = Array.from({ length: 17 }, (_, i) => {
            const a = Math.PI - Math.PI * i / 16, k = Math.min(i, 16 - i), side = i < 8 ? -1 : 1;
            if (!peak) return [r * Math.cos(a), 1.2 + r * Math.sin(a)];
            return k < 3 ? [side * r, 1.2 + k * 0.7] : [side * r * (8 - k) / 6, 2.6 + (k - 2) * 2.8 / 6];
        });
        const arch = u => section.map(([v, z]) => F.P(u, v, z));
        // Opaque rear half screens the landscape; open front glazing shows
        // simple, broad crop rows inside the long greenhouse.
        for (let j = 0; j < 16; j++) {
            const a = arch(-8.5)[j], b = arch(-8.5)[j + 1], c = arch(8.5)[j + 1], d = arch(8.5)[j];
            const normal = F.V(0, section[j][1] - section[j + 1][1], section[j + 1][0] - section[j][0]);
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
                S.line([F.P(u, section[i][0], 0.8), q]);
            }
            S.line([F.P(u, -r, 1.2), F.P(u, r, 1.2)]);
            const side = Math.sign(u), v = side * (8.5 + 0.035);
            if (T.cam.facing(...F.V(side, 0, 0)) && !(lot.dock || []).includes(side)) {
                const door = [F.P(v, -1.05, 0.85), F.P(v, 1.05, 0.85), F.P(v, 1.05, 3.1), F.P(v, 0.7, 3.45), F.P(v, -0.7, 3.45), F.P(v, -1.05, 3.1)];
                S.face(door); S.loop(door);
                inKind(S, GLASS, () => S.loop([F.P(v + side * 0.01, -0.65, 2.15), F.P(v + side * 0.01, 0.65, 2.15), F.P(v + side * 0.01, 0.65, 2.95), F.P(v + side * 0.01, -0.65, 2.95)]));
                S.line([F.P(v + side * 0.015, 0.5, 1.6), F.P(v + side * 0.015, 0.8, 1.6)]);
                S.box(F, side > 0 ? 8.5 : -9.4, -1.3, 0, side > 0 ? 9.4 : -8.5, 1.3, 0.45);
            }
        }
        inKind(S, GLASS, () => {
            for (let u = -6.8; u < 8; u += 1.7) S.line(arch(u));
            for (const i of peak ? [2, 5, 8, 11, 14] : [3, 6, 8, 10, 13]) S.line([arch(-8.5)[i], arch(8.5)[i]]);
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

    // Profile of a ball for S.lathe, from polar angle a0 up to the top
    const ball = (z, r, a0 = -Math.PI / 2, n = 12) => Array.from({ length: n + 1 }, (_, j) => {
        const t = a0 + (Math.PI / 2 - a0) * j / n, flat = j === n || j === 0 && a0 <= -Math.PI / 2;
        return [flat ? 0 : r * Math.cos(t), z + r * Math.sin(t)];
    });

    function hub(T, lot) {
        const { S, cam } = T, { x, y } = lot, tiers = lot.tiers || 2, top = 7.4 + tiers * 2.95, roof = top + 2.7;
        S.lathe(x, y, [[5.8, 0], [5.8, 0.6], [4.6, 1], [4.6, 7], [5.7, 7.4], [5.7, top], [6.1, top + 0.3], [6.1, top + 0.9], [4.7, roof], [0, roof]], 8, false, Math.PI / 8);
        inKind(S, RED, () => circle(S, x, y, 6, top + 0.2, 8, Math.PI / 8));
        for (let tier = 0; tier < tiers; tier++) {
            const z = 7.5 + tier * 2.9;
            inKind(S, RED, () => circle(S, x, y, 5.72, z, 8, Math.PI / 8));
            for (let i = 0; i < 8; i++) {
                const a = (i + 0.5) * TAU / 8 + Math.PI / 8, F = turned(x, y, 0, a);
                if (!cam.facing(...F.V(1, 0, 0))) continue;
                inKind(S, GLASS, () => {
                    const pts = [F.P(5.3, -1.75, z + 0.6), F.P(5.3, 1.75, z + 0.6), F.P(5.3, 1.75, z + 2), F.P(5.3, -1.75, z + 2)];
                    S.loop(pts); S.line([F.P(5.3, 0, z + 0.6), F.P(5.3, 0, z + 2)]);
                    if (T.p.hatching) S.hatch(pts, Z, T.p.hatchGap);
                });
            }
        }
        if (lot.cap === 'radome') {
            S.lathe(x, y, [[1.5, roof], [1.5, roof + 0.4]], 12);
            S.lathe(x, y, ball(roof + 2.3, 2.3, -1, 10), 20);
            inKind(S, RED, () => circle(S, x, y, 2.33, roof + 2.3, 20));
        } else if (lot.cap === 'dish') {
            dish(T, x, y, 3.2, Math.atan2(-cam.fx, cam.fy) + 0.9, roof);
        } else {
            S.lathe(x, y, [[1.3, roof], [1.3, roof + 0.5], [0.7, roof + 1.3]], 12);
            S.line([[x, y, roof + 1.3], [x, y, roof + 6]]);
            for (const z of [3.2, 4.8]) S.line([[x - 1.8, y, roof + z], [x + 1.8, y, roof + z]]);
            inKind(S, RED, () => circle(S, x, y, 0.3, roof + 6, 8));
        }
    }

    // A broad two-stage shuttle, with side boosters and swept landing fins.
    function shuttle(T, x, y, F) {
        const { S } = T;
        const nose = Array.from({ length: 13 }, (_, i) => [i === 12 ? 0 : 3.1 * Math.cos(i * Math.PI / 24), 20 + 8.5 * Math.sin(i * Math.PI / 24)]);
        S.lathe(x, y, [[2, 1], [1.3, 3], [3.1, 3.5], ...nose], 32);
        for (const z of [6, 17.6, 19]) inKind(S, RED, () => circle(S, x, y, 3.13, z));
        for (const u of [-4.1, 4.1]) {
            const q = F.P(u, 0, 0);
            S.lathe(q[0], q[1], [[0.85, 1], [0.6, 2.5], [1.15, 3], [1.15, 15], [0.8, 17], [0, 18.8]], 20);
            inKind(S, RED, () => { circle(S, q[0], q[1], 1.18, 5.5, 20); circle(S, q[0], q[1], 1.18, 14, 20); });
        }
        // Fins point along the world axes. The camera turn stays within 20 to
        // 70 degrees, so none of them is ever seen edge-on as a single line.
        // The sides get full fins, the boosters smaller ones on their outer face.
        for (const [a, r0, r1, z1] of [[Math.PI / 2, 2.9, 6.3, 9], [-Math.PI / 2, 2.9, 6.3, 9], [0, 5.1, 6.9, 6], [Math.PI, 5.1, 6.9, 6]]) {
            const A = turned(x, y, 0, a), z0 = r0 > 3 ? 3 : 3.5;
            S.prism([A.P(r0, -0.14, z1), A.P(r1, -0.14, 2), A.P(r1, -0.14, 0.9), A.P(r0, -0.14, z0)], A.V(0, 0.28, 0));
            inKind(S, RED, () => S.line([A.P(r0 + 0.05, -0.17, z1 - 0.7), A.P(r1 - 0.5, -0.17, 2.3)]));
        }
        const windscreen = [F.P(-1.3, -3.14, 20.2), F.P(1.3, -3.14, 20.2), F.P(1.05, -3.09, 21.9), F.P(-1.05, -3.09, 21.9)];
        panel(T, windscreen, BLUE, 0.8);
        S.line([F.P(0, -3.15, 20.2), F.P(0, -3.1, 21.9)]);
        inKind(S, RED, () => number(S, '01', (u, v) => F.P(u - 0.75, -3.15, 12.4 + v), 1.1));
    }

    // One slim stage that lands on its tail, steered by two pairs of flaps
    function ship(T, x, y, F) {
        const { S } = T, R = 2.7;
        const nose = Array.from({ length: 13 }, (_, i) => [i === 12 ? 0 : R * Math.cos(i * Math.PI / 24), 20 + 8.5 * Math.sin(i * Math.PI / 24)]);
        S.lathe(x, y, [[3.5, 0.55], [3.5, 1.1]], 8, false, Math.PI / 8);
        S.lathe(x, y, [[2.1, 1.1], [R, 2.4], ...nose], 32);
        for (const z of [8, 14, 19.5]) inKind(S, RED, () => circle(S, x, y, R + 0.03, z));
        // Flaps on the same axes as the shuttle's side fins, for the same reason
        for (const a of [Math.PI / 2, -Math.PI / 2]) {
            const A = turned(x, y, 0, a);
            S.prism([A.P(R - 0.3, -0.14, 9), A.P(R + 2.5, -0.14, 5.5), A.P(R + 2.5, -0.14, 2.4), A.P(R - 0.3, -0.14, 2.4)], A.V(0, 0.28, 0));
            S.prism([A.P(R - 0.9, -0.12, 24), A.P(R + 1.5, -0.12, 21.5), A.P(R + 1.5, -0.12, 19.6), A.P(R - 0.3, -0.12, 19.6)], A.V(0, 0.24, 0));
            inKind(S, RED, () => S.line([A.P(R + 0.1, -0.17, 8.2), A.P(R + 2.1, -0.17, 5.7)]));
        }
        for (const u of [-0.75, 0.75]) panel(T, [F.P(u - 0.5, -2.72, 21), F.P(u + 0.5, -2.72, 21), F.P(u + 0.42, -2.64, 22.3), F.P(u - 0.42, -2.64, 22.3)], BLUE, 0.8);
        inKind(S, RED, () => number(S, '02', (u, v) => F.P(u - 0.75, -R - 0.05, 15.2 + v), 1.1));
    }

    // Squat ascent vehicle: a cone on four legs that goes back up to orbit
    function ascent(T, x, y, F) {
        const { S } = T;
        S.lathe(x, y, [[1.9, 0.9], [1.2, 2.3]], 16);
        S.lathe(x, y, [[3.3, 2.2], [4.3, 3], [4.3, 3.8], [2.3, 10.6], [1.5, 12.2], [0, 12.9]], 32);
        inKind(S, RED, () => { circle(S, x, y, 4.33, 3.82); circle(S, x, y, 2.33, 10.6); });
        for (let i = 0; i < 4; i++) {
            const A = turned(x, y, 0, Math.PI / 4 + i * Math.PI / 2), foot = A.P(7.4, 0, 0.9);
            tube(T, A.P(3.9, 0, 3.6), foot, 0.26);
            S.line([A.P(3.4, -1.5, 2.4), foot, A.P(3.4, 1.5, 2.4)]);
            S.lathe(foot[0], foot[1], [[1.2, 0.55], [1.2, 0.9]], 12);
        }
        const wall = z => 4.3 - 2 * (z - 3.8) / 6.8 + 0.04;
        panel(T, [F.P(-0.8, -wall(8.6), 8.6), F.P(0.8, -wall(8.6), 8.6), F.P(0.65, -wall(9.9), 9.9), F.P(-0.65, -wall(9.9), 9.9)], BLUE, 0.8);
        inKind(S, RED, () => number(S, '03', (u, v) => F.P(u - 0.6, -wall(5.6 + v), 5.6 + v), 0.9));
    }

    // Service tower and access bridges are deliberately broad, with only
    // one diagonal in each bay so the lattice remains readable on paper.
    function gantry(T, F, top, decks) {
        const { S } = T;
        for (const u of [6.4, 9.4]) for (const v of [3.5, 6.5]) S.box(F, u - 0.2, v - 0.2, 0.55, u + 0.2, v + 0.2, top);
        for (let z = 1; z < top - 1; z += 4) {
            S.line([F.P(6.4, 3.5, z), F.P(9.4, 3.5, z + 4)]);
            S.line([F.P(9.4, 3.5, z), F.P(9.4, 6.5, z + 4)]);
            S.box(F, 6.2, 3.3, z + 3.8, 9.6, 6.7, z + 4.1);
        }
        for (const z of decks) {
            S.box(F, 1.6, 2.5, z, 6.8, 4.1, z + 0.45);
            inKind(S, GOLD, () => {
                S.line([F.P(1.6, 2.5, z + 1.6), F.P(6.8, 2.5, z + 1.6)]);
                for (let u = 1.6; u < 7; u += 1.3) S.line([F.P(u, 2.5, z), F.P(u, 2.5, z + 1.6)]);
            });
        }
        // Ladder and complete guardrails make the launch tower usable.
        for (const u of [7.3, 8.5]) S.line([F.P(u, 6.73, 0.6), F.P(u, 6.73, top)]);
        if (T.p.detail) for (let z = 1; z < top; z += 0.65) S.line([F.P(7.3, 6.73, z), F.P(8.5, 6.73, z)]);
        inKind(S, GOLD, () => {
            for (const v of [3.3, 6.7]) {
                S.line([F.P(6.2, v, top + 1.1), F.P(9.6, v, top + 1.1)]);
                for (const u of [6.2, 7.9, 9.6]) S.line([F.P(u, v, top), F.P(u, v, top + 1.1)]);
            }
        });
    }

    function launchSite(T, lot) {
        const { S } = T, { x, y } = lot, F = turned(x, y, 0, 0);
        S.lathe(x, y, [[12, 0], [12, 0.55]], 8, false, Math.PI / 8);
        inKind(S, GOLD, () => circle(S, x, y, 10.5, 0.58, 8, Math.PI / 8));
        if (lot.craft === 'ship') ship(T, x, y, F);
        else if (lot.craft === 'ascent') ascent(T, x, y, F);
        else shuttle(T, x, y, F);
        if (lot.craft === 'ascent') gantry(T, F, 13, [8]);
        else gantry(T, F, 25, [11, 20]);
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

    // Gumdrop capsule on four legs, with its heat shield still on
    function capsule(T, x, y) {
        const { S } = T, F = turned(x, y, 0, 0);
        inKind(S, GOLD, () => S.lathe(x, y, [[1.6, 2.3], [3.9, 3.1], [4.1, 3.7]], 24));
        S.lathe(x, y, [[4.1, 3.7], [1.6, 8.4], [1.15, 9.2], [0, 9.45]], 24);
        inKind(S, RED, () => circle(S, x, y, 4.13, 3.72, 24));
        for (let i = 0; i < 4; i++) {
            const A = turned(x, y, 0, Math.PI / 4 + i * Math.PI / 2), foot = A.P(7.3, 0, 0.6);
            tube(T, A.P(3.8, 0, 3.5), foot, 0.22);
            S.line([A.P(2.9, -1.3, 2.8), foot, A.P(2.9, 1.3, 2.8)]);
            S.lathe(foot[0], foot[1], [[1.2, 0.38], [1.2, 0.7]], 12);
        }
        // Points on the cone, a from the side facing the viewer. Level edges
        // need a point in the middle or they cut inside the curve.
        const on = (a, z) => { const r = 4.1 - 2.5 * (z - 3.7) / 4.7 + 0.05; return [x + r * Math.sin(a), y - r * Math.cos(a), z]; };
        const pane = (a0, a1, z0, z1) => [on(a0, z0), on((a0 + a1) / 2, z0), on(a1, z0), on(a1, z1), on((a0 + a1) / 2, z1), on(a0, z1)];
        S.loop(pane(-0.22, 0.22, 4.3, 6.1));
        inKind(S, BLUE, () => { for (const s of [-1, 1]) S.loop(pane(s * 0.42, s * 0.8, 5.1, 6.2)); });
        for (const u of [-0.6, 0.6]) S.line([F.P(u, -7, 0.4), F.P(u, -3.85, 4.3)]);
        for (let i = 1; i < 9; i++) {
            const t = i / 9;
            S.line([F.P(-0.6, geo.lerp(-7, -3.85, t), geo.lerp(0.4, 4.3, t)), F.P(0.6, geo.lerp(-7, -3.85, t), geo.lerp(0.4, 4.3, t))]);
        }
        S.line([F.P(0.5, 0.5, 9.3), F.P(0.5, 0.5, 12.2)]);
        inKind(S, RED, () => circle(S, x, y, 1.18, 9.2, 24));
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
        if (T.p.lander) (lot.craft === 'capsule' ? capsule : lander)(T, x, y);
    }

    function utilities(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        if (lot.tanks === 'sphere') {
            // Propellant plant: three balls on legs feed one low manifold
            for (let i = 0; i < 3; i++) {
                const u = (i - 1) * 4.7, q = F.P(u, 1, 0), r = 2.05;
                for (let k = 0; k < 4; k++) {
                    const A = turned(q[0], q[1], 0, Math.PI / 4 + k * Math.PI / 2);
                    tube(T, A.P(1.75, 0, 0), A.P(1.75, 0, 2.6), 0.1, 6);
                }
                S.lathe(q[0], q[1], ball(3.5, r), 24);
                inKind(S, RED, () => circle(S, q[0], q[1], r + 0.03, 3.5, 24));
                S.lathe(q[0], q[1], [[0.38, 5.5], [0.38, 5.85]], 12);
                inKind(S, GOLD, () => { tube(T, F.P(u, 1, 1.5), F.P(u, 1, 0.6), 0.16); tube(T, F.P(u, 1, 0.6), F.P(u, -3.7, 0.6), 0.16); });
            }
            inKind(S, GOLD, () => tube(T, F.P(-4.7, -3.7, 0.6), F.P(6, -3.7, 0.6), 0.16));
            S.box(F, 5, -5, 0, 8, -2.3, 2.6);
            for (let i = 0; i < 5; i++) S.line([F.P(5.3 + i * 0.45, -5.03, 0.6), F.P(5.3 + i * 0.45, -5.03, 2.2)]);
            return;
        }
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
        // The slit is a straight band of constant width running from the eaves
        // on the near-left side over the crown. The dome is turned so the slit
        // and the telescope in it always face the viewer, at any camera turn.
        const cam = T.cam, w = 1.05, z0 = 5.4;
        const F = turned(x, y, 0, Math.atan2(0.95 * cam.ry + 0.3 * cam.fy, 0.95 * cam.rx + 0.3 * cam.fx));
        S.lathe(x, y, Array.from({ length: 11 }, (_, j) => {
            const t = j * Math.PI / 20; return [j === 10 ? 0 : r * Math.cos(t), z0 + r * Math.sin(t)];
        }), 32);
        // Drawn a little outside the sphere, otherwise the facets hide the slit
        const R = r + 0.06, edge = (v, u) => F.P(u, v, z0 + Math.sqrt(Math.max(0, R * R - u * u - v * v)));
        const reach = Math.sqrt(R * R - w * w), stops = Array.from({ length: 25 }, (_, i) => -reach + (reach + 1.6) * i / 24);
        for (const v of [-w, w]) S.line(stops.map(u => edge(v, u)));
        S.line([edge(-w, stops[24]), edge(w, stops[24])]);
        // Narrow strips, so the hatching doesn't sag under the facets either
        if (T.p.hatching) inKind(S, BLUE, () => {
            for (let i = 0; i < 24; i++) for (let j = 0; j < 4; j++) {
                const v0 = -w + w * j / 2, v1 = v0 + w / 2;
                levelHatch(T, [edge(v0, stops[i]), edge(v0, stops[i + 1]), edge(v1, stops[i + 1]), edge(v1, stops[i])], T.p.hatchGap);
            }
        });
        circle(S, x, y, r + 0.03, z0);
        // Telescope tilted 35 degrees up out of the slit. The part inside is
        // hidden by the dome, so it just needs to start below the surface.
        const dir = unit(F.V(-Math.cos(0.6), 0, Math.sin(0.6))), centre = F.P(0, 0, z0);
        const a = add(centre, mul(dir, r - 1.5)), b = add(centre, mul(dir, r + 3.4));
        tube(T, a, b, 0.85, 16);
        inKind(S, RED, () => tube(T, b, add(b, mul(dir, 0.3)), 0.86, 16));
        const perp = unit(cross(dir, Z)), up = cross(perp, dir), end = add(b, mul(dir, 0.33));
        inKind(S, GLASS, () => S.loop(ring(20, (c, s) => add(end, add(mul(perp, 0.58 * c), mul(up, 0.58 * s))))));
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

    // Hatch a flat polygon with lines that run level across the page, at fixed
    // page heights. Neighbouring facets share the same lines, so a curved
    // surface shades as one patch and matches the cast shadow hatching.
    function levelHatch(T, pts, gap) {
        const { S, cam } = T, q = pts.map(p => cam.project(...p));
        const ys = q.map(p => p[1]);
        for (let y = Math.ceil(Math.min(...ys) / gap) * gap; y < Math.max(...ys); y += gap) {
            const hits = [];
            for (let i = 0; i < q.length; i++) {
                const a = q[i], b = q[(i + 1) % q.length];
                if ((a[1] > y) === (b[1] > y)) continue;
                const t = (y - a[1]) / (b[1] - a[1]);
                hits.push({ x: geo.lerp(a[0], b[0], t), p: pts[i].map((v, k) => geo.lerp(v, pts[(i + 1) % q.length][k], t)) });
            }
            if (hits.length < 2) continue;
            hits.sort((a, b) => a.x - b.x);
            S.line([hits[0].p, hits[hits.length - 1].p]);
        }
    }

    function crater(T, c, rng) {
        const { S } = T, n = c.r > 6 ? 48 : 32, wobble = [];
        for (let i = 0; i < n; i++) {
            const a = i * TAU / n;
            wobble.push(1 + 0.045 * Math.sin(a * 3 + c.phase) + 0.025 * Math.cos(a * 7 - c.phase));
        }
        const rings = [[1.22, 0], [1, c.r * 0.09], [0.8, -c.r * 0.05], [0.43, -c.r * 0.24]];
        const at = (i, scale, z) => { const a = i * TAU / n, r = c.r * scale * wobble[i % n]; return [c.x + r * Math.cos(a), c.y + r * Math.sin(a), z]; };
        // The sun sits opposite the cast shadows (see generate), so the inner
        // wall nearest it is the one in shade.
        const sun = [-0.42, 0.91];
        // The depression is an open mesh, never a convex solid. Each annulus
        // is triangulated so the near lip correctly hides the lower floor.
        for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
            const a = at(i, ...rings[j]), b = at((i + 1) % n, ...rings[j]), d = at(i, ...rings[j + 1]), c1 = at((i + 1) % n, ...rings[j + 1]);
            S.face([a, b, c1], false); S.face([a, c1, d], false);
            const angle = (i + 0.5) * TAU / n, shade = Math.cos(angle) * sun[0] + Math.sin(angle) * sun[1];
            if (T.p.hatching && j > 0 && shade > 0.35) inKind(S, BLUE, () => {
                levelHatch(T, [a, b, c1], T.p.shadowGap);
                levelHatch(T, [a, c1, d], T.p.shadowGap);
            });
        }
        S.face(Array.from({ length: n }, (_, i) => at(i, ...rings[3])), false);
        inKind(S, DUST, () => {
            S.loop(Array.from({ length: n }, (_, i) => at(i, ...rings[1])));
            S.loop(Array.from({ length: n }, (_, i) => at(i, ...rings[3])));
            // A few short arcs of ejecta around the outside of the rim
            const arcs = c.r > 6 ? 5 : 3, start = rng.int(0, n - 1);
            for (let k = 0; k < arcs; k++) {
                const i0 = start + Math.round(k * n / arcs), len = rng.int(3, 5);
                S.line(Array.from({ length: len }, (_, j) => at((i0 + j) % n, rng.range(1.2, 1.3), 0)));
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

    // Small fission units: a core buried under a heap of regolith, with an
    // umbrella radiator on a mast over each one
    function reactors(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, lot.angle);
        for (const [u, v] of [[-6, -1.8], [-2, 2.4], [2, -1.8], [6, 2.4]]) {
            const q = F.P(u, v, 0);
            inKind(S, DUST, () => S.lathe(q[0], q[1], [[1.7, 0], [1.3, 0.9], [0.6, 1.2]], 7, false, u));
            tube(T, [q[0], q[1], 1.1], [q[0], q[1], 6.5], 0.2);
            S.lathe(q[0], q[1], [[2.6, 6.3], [0.3, 7.25], [0, 7.25]], 10, false);
            inKind(S, RED, () => circle(S, q[0], q[1], 1.5, 6.79, 10));
            inKind(S, GOLD, () => S.line([F.P(u, v - 1.75, 0.1), F.P(u, -5.2, 0.1)]));
        }
        inKind(S, GOLD, () => S.line([F.P(-6, -5.2, 0.1), F.P(5.5, -5.2, 0.1)]));
        S.box(F, 5.5, -5.9, 0, 8.3, -3.4, 2.4);
        if (T.p.detail) for (let u = 5.9; u < 8.1; u += 0.4) S.line([F.P(u, -5.93, 0.6), F.P(u, -5.93, 1.8)]);
    }

    // Three rotors in a row across the wind. T.wind is never square to the
    // view, so a rotor is never seen edge-on as a single line.
    function turbines(T, lot) {
        const { S } = T, F = turned(lot.x, lot.y, 0, T.wind), top = 11;
        for (const v of [-6.2, 0, 6.2]) {
            const q = F.P(0, v, 0), hub = F.P(-1.15, v, top + 0.35);
            S.lathe(q[0], q[1], [[1.3, 0], [1.3, 0.45]], 8, false, T.wind);
            S.lathe(q[0], q[1], [[0.5, 0.45], [0.26, top]], 10);
            S.box(F, -1, v - 0.45, top - 0.1, 1.2, v + 0.45, top + 0.8);
            for (let i = 0; i < 3; i++) {
                const a = lot.index + v + i * TAU / 3, d = F.V(0, Math.cos(a), Math.sin(a)), n = F.V(0, -Math.sin(a), Math.cos(a));
                const at = (s, t) => add(hub, add(mul(d, s), mul(n, t)));
                const blade = [at(0.3, -0.32), at(4.6, -0.08), at(4.6, 0.08), at(0.3, 0.32)];
                S.face(blade); S.loop(blade);
            }
            inKind(S, RED, () => S.loop(ring(8, (c, s) => add(hub, F.V(-0.02, 0.42 * c, 0.42 * s)))));
        }
        inKind(S, GOLD, () => S.line([F.P(0.9, -6.2, 0.1), F.P(0.9, 6.2, 0.1), F.P(3.4, 6.2, 0.1)]));
    }

    // Radio telescope: a wire mesh reflector laid in a crater, with the
    // receiver hung over the middle from three masts on the rim
    function craterScope(T, lot, rng) {
        const { S } = T, { x, y } = lot, R = lot.r * 0.74, n = 36, phase = rng.range(0, TAU);
        const rings = [[1.2, 0], [1, R * 0.08], [0.86, -R * 0.05], [0.66, -R * 0.2], [0.42, -R * 0.31], [0.18, -R * 0.36]];
        const at = (i, [s, z]) => { const a = i * TAU / n; return [x + R * s * Math.cos(a), y + R * s * Math.sin(a), z]; };
        const hoop = j => Array.from({ length: n }, (_, i) => at(i, rings[j]));
        const sun = [-0.42, 0.91];
        // An open bowl like the craters, so the near lip hides the floor
        for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < n; i++) {
            const quad = [at(i, rings[j]), at(i + 1, rings[j]), at(i + 1, rings[j + 1]), at(i, rings[j + 1])];
            S.face(quad, false);
            const angle = (i + 0.5) * TAU / n;
            if (T.p.hatching && j > 0 && Math.cos(angle) * sun[0] + Math.sin(angle) * sun[1] > 0.35) inKind(S, BLUE, () => levelHatch(T, quad, T.p.shadowGap));
        }
        S.face(hoop(5), false);
        inKind(S, DUST, () => S.loop(hoop(1)));
        inKind(S, GOLD, () => {
            for (let j = 2; j < 6; j++) S.loop(hoop(j));
            for (let i = 0; i < n; i += 3) S.line(rings.slice(2).map(level => at(i, level)));
        });
        const deck = 6.6, corners = [];
        for (let k = 0; k < 3; k++) {
            const a = phase + k * TAU / 3, F = turned(x, y, 0, a), head = F.P(R * 1.1, 0, 9.5), corner = F.P(1.2, 0, deck + 0.4);
            S.box(F, R * 1.1 - 0.7, -0.7, 0, R * 1.1 + 0.7, 0.7, 0.8);
            tube(T, F.P(R * 1.1, 0, 0.8), head, 0.2);
            S.line([head, corner]);
            S.line([head, F.P(R * 1.5, 0, 0)]);
            corners.push(F.P(1.2, 0, deck));
        }
        S.prism(corners, [0, 0, 0.4]);
        S.lathe(x, y, [[0.45, deck - 1.5], [0.45, deck]], 10);
        inKind(S, RED, () => S.lathe(x, y, [[0.75, deck - 2.1], [0.45, deck - 1.5]], 10));
    }

    // Layered butte. Each tier tapers to a smaller copy of its own outline,
    // which keeps its sides flat. The next tier starts from that outline
    // pulled in unevenly, so the ledges and corners don't line up.
    function mesa(T, lot, rng) {
        const { S, cam } = T, sun = [-0.42, 0.91];
        let z = 0, c = [lot.x, lot.y], outline = PG.iso.hull(Array.from({ length: 10 }, (_, i) => {
            const a = (i + rng.range(-0.35, 0.35)) * TAU / 10, r = lot.r * rng.range(0.6, 0.95);
            return [lot.x + r * Math.cos(a), lot.y + r * Math.sin(a)];
        }));
        const toward = (q, f) => [c[0] + (q[0] - c[0]) * f, c[1] + (q[1] - c[1]) * f];
        for (let tier = rng.int(2, 3); tier > 0 && outline.length > 2; tier--) {
            const n = outline.length, h = rng.range(2.4, 4.4), taper = rng.range(0.8, 0.88);
            c = mul(outline.reduce(add), 1 / n);
            const low = outline.map(q => [...q, z]), high = outline.map(q => [...toward(q, taper), z + h]);
            const sides = low.map((_, i) => [i, (i + 1) % n, n + (i + 1) % n, n + i]);
            inKind(S, DUST, () => {
                S.solid([...low, ...high], [low.map((_, i) => i), high.map((_, i) => n + i), ...sides]);
                // Strata follow the sides, a little off level
                for (const f of [0.3, 0.62]) S.loop(low.map((q, i) => mix(q, high[i], f + 0.06 * Math.sin(i * 2.3 + tier))));
            });
            if (T.p.hatching) inKind(S, BLUE, () => {
                for (const side of sides) {
                    const quad = side.map(i => i < n ? low[i] : high[i - n]), normal = outward(quad, [c[0], c[1], z + h / 2]);
                    if (cam.facing(...normal) && normal[0] * sun[0] + normal[1] * sun[1] < -0.25 * Math.hypot(normal[0], normal[1])) levelHatch(T, quad, T.p.shadowGap);
                }
            });
            outline = PG.iso.hull(high.map(q => toward(q, rng.range(0.5, 0.8))));
            z += h;
        }
        // Survey beacon on the summit
        S.line([[c[0], c[1], z], [c[0], c[1], z + 2.6]]);
        inKind(S, RED, () => circle(S, c[0], c[1], 0.3, z + 2.6, 8));
    }

    // Barchan dune: a crescent with its horns pointing downwind. The crest
    // stands a little way back from the slip face between the horns.
    function dune(T, d) {
        const { S } = T, F = turned(d.x, d.y, 0, T.wind), R = d.r, n = 24;
        // k is 0 for the windward foot, 1 the crest, 2 the foot of the slip face
        const at = (t, k) => {
            const s = Math.sin(Math.PI * t), back = [1.75 * Math.pow(s, 0.8), 1.1 * s, 0.82 * s][k];
            return F.P(R * (0.9 - back), R * 0.92 * Math.cos(Math.PI * t), k === 1 ? d.h * Math.pow(s, 0.7) : 0);
        };
        for (let i = 0; i < n; i++) for (const k of [0, 1]) {
            const a = at(i / n, k), b = at((i + 1) / n, k), c = at((i + 1) / n, k + 1), e = at(i / n, k + 1);
            S.face([a, b, c], false); S.face([a, c, e], false);
        }
        const line = (k, t0, t1) => Array.from({ length: Math.round((t1 - t0) * n) + 1 }, (_, i) => at(t0 + i / n, k));
        inKind(S, DUST, () => {
            for (const k of [0, 1, 2]) S.line(line(k, 0, 1));
            // Strokes down the slip face, uneven so they don't read as a comb
            for (let i = 2; i < n - 1; i += T.p.detail ? 1 : 2) S.line([at(i / n, 1), mix(at(i / n, 1), at(i / n, 2), [0.8, 0.4, 0.62, 0.3][i % 4])]);
            // Ripples up the windward slope. Lifted a hair, the two triangles of each strip aren't quite one plane.
            if (T.p.detail) for (const f of [0.4, 0.7]) {
                S.line(Array.from({ length: n * 0.6 + 1 }, (_, i) => add(mix(at(0.2 + i / n, 0), at(0.2 + i / n, 1), f), [0, 0, 0.05])));
            }
        });
    }

    // A dust devil is only a spiral of dust, so it hides nothing behind it.
    // Its track wanders off upwind, where the ground is clear.
    function dustDevil(T, x, y, rng, empty) {
        const { S } = T, turns = rng.range(5, 7), top = rng.range(11, 16), lean = rng.range(1.5, 3.5);
        const c = Math.cos(T.wind), s = Math.sin(T.wind), phase = rng.range(0, TAU);
        inKind(S, DUST, () => {
            S.line(Array.from({ length: 240 }, (_, i) => {
                const t = i / 239, a = phase + t * turns * TAU, r = 0.35 + 2.5 * Math.pow(t, 1.3), d = lean * t * t;
                return [x + d * c + r * Math.cos(a), y + d * s + r * Math.sin(a), 0.1 + top * t];
            }));
            let pts = [];
            for (let i = 2; i < 90; i++) {
                const u = i * 0.45, v = 1.1 * Math.sin(u * 0.33 + phase) + 0.5 * Math.sin(u * 0.9), q = [x - u * c - v * s, y - u * s + v * c, 0.02];
                if (!empty(q[0], q[1], 0.3)) { if (pts.length > 1) S.line(pts); pts = []; continue; }
                pts.push(q);
            }
            if (pts.length > 1) S.line(pts);
        });
    }

    // Scout helicopter with two rotors on one mast, the thin air needs both
    function helicopter(T, x, y, angle) {
        const { S } = T, F = turned(x, y, 6.5, angle);
        S.box(F, -0.7, -0.6, 0, 0.7, 0.6, 0.9);
        for (const u of [-1, 1]) for (const v of [-1, 1]) S.line([F.P(u * 0.6, v * 0.5, 0), F.P(u * 1.4, v * 1.2, -1)]);
        S.line([F.P(0, 0, 0.9), F.P(0, 0, 2.1)]);
        for (const [h, a] of [[1.5, 0.5], [1.95, 0.5 + Math.PI / 2]]) {
            S.line([F.P(-2.7 * Math.cos(a), -2.7 * Math.sin(a), h), F.P(2.7 * Math.cos(a), 2.7 * Math.sin(a), h)]);
        }
        inKind(S, BLUE, () => S.loop([F.P(-0.45, -0.4, 2.12), F.P(0.45, -0.4, 2.12), F.P(0.45, 0.4, 2.12), F.P(-0.45, 0.4, 2.12)]));
        inKind(S, DUST, () => S.loop(ring(24, (c, s) => F.P(2.7 * c, 2.7 * s, 1.95))));
    }

    function distanceToSegment(x, y, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = geo.clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    }

    // Where the tunnelled core of the colony goes, for n buildings. Points are
    // meters on the ground, a across the page and b into it, so a ring is a
    // true circle and a spine a straight street at any camera angle. They come
    // most important first: main dome, control tower, the other domes, then
    // housing. `heart` is a spot the plan leaves open for a landmark.
    const SPACING = 27;
    const PLANS = {
        // Loose constellation around the main dome
        gardens(n, rng, A, B) {
            const pts = [[rng.range(-8, 8), rng.range(-14, 14)]];
            while (pts.length < n) {
                let best = null, far = -1;
                for (let i = 0; i < 14; i++) {
                    const a = rng.range(0, TAU), s = Math.sqrt(rng.random()), q = [A * s * Math.cos(a), B * s * Math.sin(a)];
                    const d = Math.min(...pts.map(o => Math.hypot(o[0] - q[0], o[1] - q[1])));
                    if (d > far) { far = d; best = q; }
                }
                pts.push(best);
            }
            return { pts };
        },
        // An arc open to one side of the page, with the tower in its hollow
        crescent(n, rng, A, B) {
            const open = (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.45, 0.45), R = Math.min(B * 0.85, (n - 2) * SPACING / 2.6);
            const span = (n - 2) * SPACING / R, c = Math.cos(open), s = Math.sin(open);
            // The arc is centered a little toward the opening, so its middle sits back from the page center
            const arc = Array.from({ length: n - 1 }, (_, i) => {
                const a = open + Math.PI + (i / (n - 2) - 0.5) * span;
                return [R * (0.62 * c + Math.cos(a)), R * (0.62 * s + Math.sin(a))];
            });
            const off = q => Math.hypot(q[0] + 0.38 * R * c, q[1] + 0.38 * R * s);
            arc.sort((p, q) => off(p) - off(q));
            return { pts: [arc[0], [R * 0.08 * c, R * 0.08 * s], ...arc.slice(1)] };
        },
        // A street running into the page, with housing off either side
        spine(n, rng) {
            const tilt = rng.range(-0.4, 0.4), m = Math.ceil(n / 2) + (n > 7 ? 1 : 0), step = SPACING * 1.08, side = rng.sign();
            const along = s => [s * Math.sin(tilt), s * Math.cos(tilt)];
            const chain = Array.from({ length: m }, (_, i) => along((i - (m - 1) / 2) * step));
            chain.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
            const wings = Array.from({ length: n - m }, (_, i) => {
                const q = along((Math.floor(i / 2) - (Math.ceil((n - m) / 2) - 1) / 2) * step), w = (i % 2 ? -side : side) * SPACING * 0.98;
                return [q[0] + w * Math.cos(tilt), q[1] - w * Math.sin(tilt)];
            });
            return { pts: [...chain, ...wings] };
        },
        // Everything in a circle around a landmark
        ring(n, rng) {
            const R = Math.max(31, n * SPACING / TAU), turn = rng.range(0, TAU);
            const pts = Array.from({ length: n }, (_, i) => {
                const a = turn + (i + rng.range(-0.12, 0.12)) * TAU / n, r = R + rng.range(-2.5, 2.5);
                return [r * Math.cos(a), r * Math.sin(a)];
            });
            return { pts: rng.shuffle(pts), heart: [0, 0], room: R - 15 };
        },
        // Two clusters at opposite corners, joined through the control tower
        twin(n, rng, A, B) {
            const s = rng.sign(), centres = [[-s * A * 0.3, -B * 0.66], [s * A * 0.3, B * 0.66]], around = [[], []];
            for (let i = 0; i < n - 3; i++) around[i % 2].push(i);
            const moons = around.map((list, k) => {
                const turn = rng.range(0, TAU);
                return list.map((_, i) => {
                    const a = turn + i * TAU / list.length;
                    return [centres[k][0] + SPACING * Math.cos(a), centres[k][1] + SPACING * Math.sin(a)];
                });
            });
            return { pts: [centres[0], [rng.range(-4, 4), rng.range(-4, 4)], centres[1], ...moons[0], ...moons[1]] };
        },
    };

    function plan(T, seed) {
        const { cam, W, H, p, mars } = T, rng = new PG.RNG(hash(seed, 10)), lots = [], links = [];
        const put = (type, x, y, r) => {
            const lot = { type, x, y, r, angle: rng.pick([0, Math.PI / 2]), index: lots.length };
            lots.push(lot); return lot;
        };
        // A smaller page or a bigger scale leaves room for fewer buildings
        const [ox, oy] = cam.ground(W * 0.5, H * 0.47), A = 0.36 * W / cam.k, B = 0.3 * H / (cam.k * cam.se);
        const most = geo.clamp(Math.floor(Math.PI * A * B / 800), 5, 9);
        const specs = [['dome', rng.pick([12, 13, 14])], ['hub', 6]];
        for (let i = rng.int(1, 3); i > 0; i--) specs.push(['dome', rng.pick([8, 8.5, 9.5, 10.5])]);
        for (let i = rng.int(3, 5); i > 0; i--) specs.push(['hab', 11]);
        specs.length = Math.min(specs.length, most);
        const core = (PLANS[p.layout] || PLANS.gardens)(specs.length, rng, A, B);
        const world = ([a, b]) => [ox + a * cam.rx + b * cam.fx, oy + a * cam.ry + b * cam.fy];
        specs.forEach(([type, r], i) => put(type, ...world(core.pts[i]), r));
        const nodes = lots.slice();
        // Each facility takes one of the roomiest spots left on the page, with
        // enough noise that it lands somewhere new in every colony. `top` keeps
        // tall things far enough down the page to fit.
        const spots = [];
        for (let i = 0; i < 7; i++) for (let j = 0; j < 9; j++) spots.push([0.07 + 0.86 * i / 6, 0.07 + 0.86 * j / 8]);
        const place = (type, r, top = 0) => {
            let best = null, score = -Infinity;
            for (const [sx, sy] of spots) {
                if (sy < top) continue;
                const [x, y] = cam.ground(W * sx, H * sy);
                const room = Math.min(...lots.map(l => Math.hypot(l.x - x, l.y - y) - l.r)) - r;
                const s = Math.min(room, 12) + rng.range(0, 8);
                if (s > score) { score = s; best = [x, y]; }
            }
            return put(type, best[0] + rng.range(-2, 2), best[1] + rng.range(-2, 2), r);
        };
        const landmarks = [['pad', 12.5]];
        if (mars) landmarks.push(['mesa', 13], ['crater', 15]);
        else landmarks.push(['crater', 16], ...(p.telescope ? [['scope', 14], ['scope', 14]] : []));
        const heart = core.heart && rng.pick(landmarks.filter(([, r]) => r <= core.room + 1));
        if (heart) put(heart[0], ...world(core.heart), Math.min(heart[1], core.room));
        const has = type => lots.some(l => l.type === type);
        if (!has('pad')) place('pad', 12.5);
        if (p.launchpad) place('launch', 14, 0.26);
        else place('dish', 7);
        place('solar', Math.max(13, p.solarRows * 3.6));
        if (p.reactors) place('reactor', 10);
        place('observatory', 9);
        place('utilities', 9);
        place('cargo', 9);
        if (p.excavation) place('mine', 11);
        if (!mars && p.telescope && !has('scope')) place('scope', 13);
        if (mars && p.turbines) place('turbines', 9.5);
        if (p.density > 0.4) place('dish', 5);
        if (mars) for (let i = has('mesa') ? 1 : 0; i < p.mesas; i++) place('mesa', rng.range(7.5, 12));
        // Open ground for a few dunes. On a full page they wouldn't fit anywhere otherwise.
        if (mars) for (let i = 0; i < p.dunes / 4; i++) place('dunes', rng.range(9, 12));
        if (p.craters > 0) {
            if (!has('crater')) place('crater', 10);
            place('crater', 9);
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
            if (a !== b && !links.some(l => segmentsCross(e.a, e.b, l.a, l.b))) { parent[a] = b; links.push(e); }
        }
        if (p.tunnelLoops) for (const e of candidates) {
            if (links.length >= nodes.length + 1) break;
            if (!links.includes(e) && !links.some(l => segmentsCross(e.a, e.b, l.a, l.b))) links.push(e);
        }
        // Once ports are picked a tunnel follows its path through the pods
        const near = (x, y, e, r) => e.path ? e.path.slice(1).some((q, i) => distanceToSegment(x, y, e.path[i], q) < r) : distanceToSegment(x, y, e.a, e.b) < r;
        const clear = (x, y, r) => !occupied(x, y, r) && !links.some(e => near(x, y, e, r + 2.4));
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
        // Power sits toward one side of the page and freight toward the other.
        // Which sides, and what the colony mostly does, change with the seed.
        const lean = rng.range(0, TAU), bent = rng.pick(['farm', 'works', 'homes', 'mixed']);
        const power = ['solar', 'solar', 'workshop', 'greenhouse', ...(mars && p.turbines ? ['turbines'] : [])];
        const middle = ['hab', 'workshop', 'greenhouse', 'greenhouse', 'utilities',
            ...({ farm: ['greenhouse', 'greenhouse', 'greenhouse'], works: ['workshop', 'workshop', 'utilities'], homes: ['hab', 'hab', 'hab'] }[bent] || [])];
        const size = { hab: 11, greenhouse: 11, solar: 13 };
        let added = 0;
        const supplementalStart = lots.length;
        for (const cell of grid) {
            if (added >= 48) break;
            const { x, y, q } = cell;
            if (!clear(x, y, 9.5)) continue;
            const district = 0.5 + 1.25 * ((q[0] / W - 0.5) * Math.cos(lean) + (q[1] / H - 0.5) * Math.sin(lean));
            const type = rng.pick(district < 0.24 ? power : district > 0.73 ? ['cargo', 'workshop', 'utilities', 'workshop'] : middle);
            const lot = { type, x, y, r: size[type] || 9.5, small: true, angle: rng.chance(0.75) ? 0 : Math.PI / 2, index: lots.length };
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
        // The seed settles on a house style and most buildings follow it, with
        // the odd one out. Its own random stream keeps the plan above the
        // same when a style is forced.
        const look = new PG.RNG(hash(seed, 11));
        const house = (forced, table) => {
            const usual = look.weighted(table);
            return () => { const style = look.chance(0.78) ? usual : look.weighted(table); return forced && forced !== 'auto' ? forced : style; };
        };
        const domes = house(p.domes, mars ? [[2, 'shell'], [2, 'ribbed'], [1.2, 'geodesic']] : [[3, 'geodesic'], [2, 'ribbed'], [1.4, 'shell']]);
        const habs = house(p.habitats, mars ? [[2, 'tower'], [2, 'bermed'], [2, 'can'], [1, 'cylinder']] : [[3, 'cylinder'], [2, 'can'], [2, 'bermed'], [1, 'tower']]);
        const glass = house(null, [[1, 'vault'], [1, 'peak']]), roofs = house(null, [[1, 'radiator'], [1, 'sawtooth']]);
        const tanks = house(null, mars ? [[1, 'silo'], [2, 'sphere']] : [[2, 'silo'], [1, 'sphere']]);
        for (const lot of lots) {
            if (lot.type === 'dome') { lot.style = domes(); lot.garden = look.pick(['beds', 'beds', 'terrace']); }
            else if (lot.type === 'hab') lot.style = habs();
            else if (lot.type === 'greenhouse') lot.style = glass();
            else if (lot.type === 'workshop') lot.roof = roofs();
            else if (lot.type === 'utilities') lot.tanks = tanks();
            else if (lot.type === 'hub') { lot.tiers = look.int(1, 3); lot.cap = look.pick(['mast', 'mast', 'radome', 'dish']); }
            else if (lot.type === 'launch') lot.craft = look.weighted(mars ? [[3, 'ship'], [2, 'ascent'], [1, 'shuttle']] : [[3, 'shuttle'], [1.5, 'ship'], [1.5, 'ascent']]);
            else if (lot.type === 'pad') lot.craft = look.weighted(mars ? [[3, 'capsule'], [1, 'lander']] : [[3, 'lander'], [1.5, 'capsule']]);
        }
        // Turn each rectangular building so its ports face its tunnels as
        // squarely as they can, then dock every tunnel at the nearer port.
        const toward = (lot, o) => Math.atan2(o.y - lot.y, o.x - lot.x);
        const portAxis = (lot, angle = lot.angle) => angle + (PORTS[lot.type].axis ? Math.PI / 2 : 0);
        for (const lot of lots) {
            const dirs = links.filter(e => e.a === lot || e.b === lot).map(e => toward(lot, e.a === lot ? e.b : e.a));
            if (!PORTS[lot.type] || !dirs.length) continue;
            const fit = angle => Math.min(...dirs.map(d => Math.abs(Math.cos(d - portAxis(lot, angle)))));
            lot.angle = fit(0) >= fit(Math.PI / 2) ? 0 : Math.PI / 2;
            lot.dock = [];
        }
        const anchor = (lot, other) => {
            if (!lot.dock) return lot;
            const a = portAxis(lot), side = Math.cos(toward(lot, other) - a) >= 0 ? 1 : -1, at = PORTS[lot.type].at;
            if (!lot.dock.includes(side)) lot.dock.push(side);
            return { x: lot.x + side * at * Math.cos(a), y: lot.y + side * at * Math.sin(a) };
        };
        for (const e of links) {
            e.pa = anchor(e.a, e.b); e.pb = anchor(e.b, e.a);
            e.path = [e.a, e.pa, e.pb, e.b].filter((q, i, all) => q !== all[i - 1]);
        }
        // Roads keep clear of tunnels, including where both leave the same lot
        const crossesTunnel = (a, b) => links.some(l => l.path.slice(1).some((q, i) => segmentsCross(a, b, l.path[i], q)));
        const alongTunnel = (lot, other) => links.some(l => {
            if (l.a !== lot && l.b !== lot) return false;
            const next = l.a === lot ? l.path[1] : l.path[l.path.length - 2];
            return Math.cos(toward(lot, next) - toward(lot, other)) > Math.cos(0.5);
        });
        const roads = [], traffic = new Map(), roadNodes = lots.filter(l => !['crater', 'mesa', 'dunes'].includes(l.type));
        const roadCandidates = [];
        for (let i = 0; i < roadNodes.length; i++) for (let j = i + 1; j < roadNodes.length; j++) {
            const a = roadNodes[i], b = roadNodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 57 || d < a.r + b.r + 4 || links.some(l => l.a === a && l.b === b || l.a === b && l.b === a)) continue;
            if (lots.some(l => l !== a && l !== b && distanceToSegment(l.x, l.y, a, b) < l.r + 3)) continue;
            if (crossesTunnel(a, b) || alongTunnel(a, b) || alongTunnel(b, a)) continue;
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
        for (const lot of lots) lot.ports = links.filter(e => e.a === lot || e.b === lot).map(e => toward(lot, e.a === lot ? e.pb : e.pa));
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
            // Lots with an apron hide their own road ends. The rest stop the road
            // at their base, so it doesn't run across a crater bowl or a dish mount.
            const reach = { dome: l => l.r + 0.6, hub: () => 5.8, pad: l => l.r, launch: () => 12, mine: () => 9.6, dish: () => 2.2, scope: l => l.r * 0.9, turbines: () => 1.6 };
            for (const road of site.roads) {
                const { a, b, d } = road, F = turned(a.x, a.y, 0, Math.atan2(b.y - a.y, b.x - a.x));
                const start = reach[a.type] ? reach[a.type](a) : 0, end = d - (reach[b.type] ? reach[b.type](b) : 0);
                for (const v of [-2.7, 2.7]) S.line([F.P(start, v, 0.025), F.P(end, v, 0.025)]);
                for (let u = start + 1; u < end - 1; u += 3.3) S.line([F.P(u, 0, 0.025), F.P(Math.min(end - 0.5, u + 1.5), 0, 0.025)]);
            }
            for (const lot of site.lots) {
                if (['dome', 'pad', 'launch', 'crater', 'mine', 'hub', 'dish', 'scope', 'mesa', 'dunes', 'turbines'].includes(lot.type)) continue;
                const F = turned(lot.x, lot.y, 0, lot.angle), u = lot.type === 'solar' ? 12.7 : lot.type === 'hab' ? 8.5 : 10;
                const v = lot.type === 'solar' ? (lot.small ? 8 : T.p.solarRows * 3.25 + 1.5) : lot.type === 'hab' ? 8.5 : 7;
                const rim = [[-u + 1, -v], [u - 1, -v], [u, -v + 1], [u, v - 1], [u - 1, v], [-u + 1, v], [-u, v - 1], [-u, -v + 1]];
                const pts = rim.map(([a, b]) => F.P(a, b, 0.04));
                S.face(pts, false);
                const routes = [...site.roads.filter(e => e.a === lot || e.b === lot).map(e => ({ ...e, width: 2.7 })),
                    ...site.links.filter(e => e.a === lot || e.b === lot).map(e => ({ a: lot, b: e.a === lot ? e.path[1] : e.path[e.path.length - 2], width: 2.1 }))];
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
        const { S, W, H, cam, p, mars } = T, rng = new PG.RNG(hash(seed, 20)), taken = [], craters = [];
        // Craters and dunes reserve a margin around themselves as they go down
        const empty = (x, y, r) => site.clear(x, y, r) && !taken.some(c => Math.hypot(x - c.x, y - c.y) < r + c.r);
        const take = (x, y, r) => taken.push({ x, y, r });
        const addCrater = (x, y, r) => {
            const c = { x, y, r, phase: rng.range(0, TAU) };
            take(x, y, r * 1.4); craters.push(c); crater(T, c, rng);
        };
        for (const lot of site.lots.filter(l => l.type === 'crater')) addCrater(lot.x, lot.y, lot.r / 1.3);
        // Mars keeps fewer craters, the wind has filled most of them in
        for (let i = 0; i < p.craters * (mars ? 3 : 7); i++) {
            const [x, y] = cam.ground(rng.range(-0.05, 1.05) * W, rng.range(-0.05, 1.05) * H), r = rng.range(3.2, 8);
            if (empty(x, y, r * 1.4)) addCrater(x, y, r);
        }
        if (mars) {
            // A big dune leads each field, with up to two small ones coming up behind it
            let made = 0;
            for (const lot of site.lots.filter(l => l.type === 'dunes')) {
                const F = turned(lot.x, lot.y, 0, T.wind), behind = rng.shuffle([[-0.62, 0.42, 0.3], [-0.62, -0.42, 0.3]]).slice(0, rng.int(0, 2));
                for (const [u, v, s] of [[0.3, 0, 0.6], ...behind]) {
                    const q = F.P(u * lot.r, v * lot.r, 0);
                    dune(T, { x: q[0], y: q[1], r: s * lot.r, h: s * lot.r * rng.range(0.26, 0.36) }); made++;
                }
            }
            for (let i = 0; i < p.dunes * 8 && made < p.dunes; i++) {
                const [x, y] = cam.ground(rng.range(0, 1) * W, rng.range(0, 1) * H), r = rng.range(3, 6.5);
                if (!empty(x, y, r * 1.25)) continue;
                take(x, y, r * 1.25); dune(T, { x, y, r, h: r * rng.range(0.26, 0.36) }); made++;
            }
            // Streaks of dust trail downwind from the crater rims
            inKind(S, DUST, () => {
                for (const c of craters) {
                    const F = turned(c.x, c.y, 0.02, T.wind);
                    for (const v of [-0.8, -0.4, 0, 0.4, 0.8]) {
                        const to = rng.range(2.4, 3.8) * (1 - 0.35 * Math.abs(v));
                        let pts = [];
                        for (let u = 1.45; u < to; u += 0.2) {
                            const q = F.P(c.r * u, c.r * v * (1 - 0.1 * (u - 1.45)), 0);
                            if (!empty(q[0], q[1], 0.3) || rng.chance(0.12)) { if (pts.length > 1) S.line(pts); pts = []; continue; }
                            pts.push(q);
                        }
                        if (pts.length > 1) S.line(pts);
                    }
                }
            });
        }
        // Broken, gently bowed regolith lines leave white breathing room and
        // make the craters part of a landscape rather than isolated ellipses.
        // On Mars they are ripples, all lying across the wind.
        inKind(S, DUST, () => {
            for (let i = 0; i < (p.detail ? 240 : 100); i++) {
                const [x, y] = cam.ground(rng.range(-5, W + 5), rng.range(-5, H + 5));
                const length = rng.range(0.4, 3.1);
                if (!empty(x, y, length)) continue;
                if (mars) {
                    const F = turned(x, y, 0.015, T.wind + Math.PI / 2);
                    const ripple = (shift, n) => S.line(Array.from({ length: n }, (_, j) => F.P((j / (n - 1) - 0.5) * length * n / 4, shift + 0.13 * Math.sin(j * 1.1), 0)));
                    ripple(0, 7);
                    if (p.detail && rng.chance(0.5)) ripple(0.5, 4);
                    continue;
                }
                S.line(Array.from({ length: 5 }, (_, j) => [x + (j / 4 - 0.5) * length, y + Math.sin(j * Math.PI / 4) * length * 0.12, 0.015]));
                if (p.detail && rng.chance(0.28)) S.line([[x + 0.1, y + 0.48, 0.02], [x + 0.1 + length * 0.4, y + 0.51, 0.02]]);
            }
        });
        // Mars is rockier, and its rocks are the color of the ground
        inKind(S, mars ? DUST : INK, () => {
            for (let i = 0; i < p.boulders * (mars ? 170 : 110); i++) {
                const [x, y] = cam.ground(rng.range(0, W), rng.range(0, H)), r = rng.range(0.3, 1.4);
                if (!empty(x, y, r + 0.3)) continue;
                S.lathe(x, y, [[r, 0], [r * 0.85, r * 0.55], [r * 0.35, r * 1.1]], rng.int(4, 6), false, rng.range(0, TAU));
                // A drift of sand in the lee of each rock
                if (mars && p.detail) {
                    const F = turned(x, y, 0.02, T.wind), tip = F.P(r * rng.range(2.6, 4), 0, 0);
                    if (empty(tip[0], tip[1], 0.2)) S.line([F.P(r * 1.5, 0, 0), tip]);
                }
            }
        });
        return { empty, take };
    }

    function activity(T, site, { empty, take }, seed) {
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
            take(x, y, 4);
            made++;
        }
        if (T.mars) {
            for (let i = 0, devils = 0; i < 120 && devils < p.devils; i++) {
                const [x, y] = cam.ground(rng.range(0.1, 0.9) * W, rng.range(0.25, 0.92) * H);
                if (!empty(x, y, 3.5)) continue;
                dustDevil(T, x, y, rng, empty); take(x, y, 3.5); devils++;
            }
            for (let i = 0; i < 120 && p.heli; i++) {
                const [x, y] = cam.ground(rng.range(0.12, 0.88) * W, rng.range(0.2, 0.9) * H);
                if (!empty(x, y, 3)) continue;
                helicopter(T, x, y, rng.range(0, TAU)); take(x, y, 3);
                break;
            }
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

    const onMars = p => p.world === 'mars';
    PG.register({
        id: 'moonbase', name: 'Moon Base', category: 'Scenes', fit: false,
        description: 'A garden colony on the Moon or Mars with glass and printed biospheres, ribbed pressure tunnels, a lander, solar fields and reactors, drawn in isometric ink. Every seed plans a different settlement.',
        // Mars draws its ground with the red pen, see pens.js
        penScene: p => onMars(p) ? 'marsbase' : 'moonbase',
        params: [
            { type: 'section', label: 'View' },
            { id: 'scale', label: 'Colony scale', type: 'range', min: 0.75, max: 1.4, step: 0.025, value: 1.1, random: [1, 1.2], hint: 'Size of the buildings within the landscape' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 25, max: 60, step: 0.5, value: 38, random: false, hint: '35.3 is true isometric' },
            { type: 'section', label: 'Settlement' },
            { id: 'world', label: 'World', type: 'select', value: 'moon', options: [['moon', 'The Moon'], ['mars', 'Mars']], random: true, hint: 'Mars trades most craters for dunes, mesas and dust devils, favors printed and buried buildings, and draws its ground in red' },
            { id: 'layout', label: 'Colony plan', type: 'select', value: 'gardens', options: [['gardens', 'Garden constellation'], ['crescent', 'Crescent settlement'], ['spine', 'Research spine'], ['ring', 'Ring around a landmark'], ['twin', 'Twin outposts']], random: true, hint: 'The seed still moves everything within a plan' },
            { id: 'domes', label: 'Dome style', type: 'select', value: 'auto', options: [['auto', 'Varies with seed'], ['geodesic', 'Geodesic glass'], ['ribbed', 'Ribbed conservatory'], ['shell', 'Printed regolith shell']], random: false },
            { id: 'habitats', label: 'Habitat style', type: 'select', value: 'auto', options: [['auto', 'Varies with seed'], ['cylinder', 'Pressure cylinders'], ['can', 'Upright cans'], ['tower', 'Printed towers'], ['bermed', 'Buried under regolith']], random: false },
            { id: 'gardens', label: 'Biosphere gardens', type: 'checkbox', value: true, hint: 'Clear front glazing reveals the growing beds, with a tree in the main dome' },
            { id: 'tunnelLoops', label: 'Extra tunnel links', type: 'checkbox', value: true, random: 0.65 },
            { id: 'density', label: 'Settlement density', type: 'range', min: 0, max: 1, step: 0.05, value: 1, random: [0.75, 1], hint: 'Habitation blocks, workshops, growing houses and cargo yards around the biospheres' },
            { id: 'solarRows', label: 'Solar array rows', type: 'range', min: 1, max: 4, step: 1, value: 3, random: [2, 4] },
            { id: 'reactors', label: 'Fission reactors', type: 'checkbox', value: true, random: 0.6 },
            { id: 'turbines', label: 'Wind turbines', type: 'checkbox', value: true, random: 0.7, show: onMars },
            { id: 'lander', label: 'Lander', type: 'checkbox', value: true, random: 0.9 },
            { id: 'launchpad', label: 'Rocket & launch gantry', type: 'checkbox', value: true, random: 0.9 },
            { id: 'excavation', label: 'Crater drilling rig', type: 'checkbox', value: true, random: 0.8 },
            { id: 'telescope', label: 'Crater radio telescope', type: 'checkbox', value: true, random: 0.7, show: p => !onMars(p) },
            { type: 'section', label: 'Surface' },
            { id: 'craters', label: 'Impact craters', type: 'range', min: 0, max: 24, step: 1, value: 9, random: [6, 14] },
            { id: 'dunes', label: 'Barchan dunes', type: 'range', min: 0, max: 16, step: 1, value: 7, random: [3, 12], show: onMars },
            { id: 'mesas', label: 'Mesas', type: 'range', min: 0, max: 4, step: 1, value: 2, random: [0, 3], show: onMars },
            { id: 'devils', label: 'Dust devils', type: 'range', min: 0, max: 3, step: 1, value: 1, random: [0, 2], show: onMars },
            { id: 'boulders', label: 'Boulders', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25, random: [0.1, 0.4] },
            { id: 'rovers', label: 'Exploration rovers', type: 'range', min: 0, max: 8, step: 1, value: 4, random: [2, 6] },
            { id: 'heli', label: 'Scout helicopter', type: 'checkbox', value: true, random: 0.7, show: onMars },
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
            const cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0), S = new Scene(cam, W, H), mars = onMars(p);
            // The wind blows at a slant to the view, toward the viewer or away.
            // Dunes, streaks and rotors all follow it. Square across the view a
            // rotor would be edge-on, and straight along it a dune hides one of its slopes.
            const gust = new PG.RNG(hash(ctx.seed, 50));
            const T = { S, p, cam, W, H, k, mars, detail: p.detail, tones: p.hatching, hDark: p.hatchGap,
                wind: Math.atan2(cam.fy, cam.fx) + (gust.chance(0.5) ? Math.PI : 0) + gust.sign() * gust.range(0.55, 1),
                segs: r => segments(r, k), sees: n => cam.facing(...n) };
            const site = plan(T, ctx.seed), ground = surface(T, site, ctx.seed);
            infrastructure(T, site);
            if (p.shadows) {
                const cot = 1 / Math.tan(geo.rad(p.sun));
                S.sun = [cot * 0.42, -cot * 0.91];
                S.shadowGroup(0.055, null, Math.atan2(cam.ry, cam.rx));
            }
            tunnelNetwork(T, site);
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
                    // Turn the bowl most of the way towards the camera, otherwise it's just a back
                    case 'dish': dish(T, lot.x, lot.y, lot.r * 0.78, Math.atan2(-cam.fx, cam.fy) + 0.9); break;
                    case 'utilities': utilities(T, lot); break;
                    case 'observatory': observatory(T, lot); break;
                    case 'cargo': cargoPort(T, lot); break;
                    case 'mine': mine(T, lot, rng); break;
                    case 'reactor': reactors(T, lot); break;
                    case 'turbines': turbines(T, lot); break;
                    case 'scope': craterScope(T, lot, rng); break;
                    case 'mesa': mesa(T, lot, rng); break;
                }
            }
            activity(T, site, ground, ctx.seed);
            if (p.shadows) { S.kind = BLUE; S.hatchShadows(p.shadowGap); }
            return PG.pens.renderScene(mars ? 'marsbase' : 'moonbase', S, p);
        },
    });
})();
