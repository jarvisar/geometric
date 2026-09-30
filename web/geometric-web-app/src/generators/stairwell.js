/*
 * Infinite Stairwell: looking straight down a stairwell, or up it from the
 * floor, in one-point perspective. The handrail and balusters wind away to a
 * floor pattern or a skylight at the far end.
 *
 * PG.iso.Scene removes the hidden lines. It interpolates depth linearly over
 * each projected face, which stays exact under perspective when depth is
 * -K / distance. Balusters and step edges thin out in powers of two as the
 * well recedes, so the far end doesn't fill in with ink.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { Scene } = PG.iso;

    const TREAD = 0, RAIL = 1, SHADE = 2, BOTTOM = 3, POST = 4, STRING = 5, WALL = 6, DEEP = 7;
    // Pen layer for each group, by pen count
    const MAPS = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 1, 0, 0, 0],
        [0, 1, 2, 0, 1, 0, 0, 0],
        [0, 1, 2, 3, 1, 0, 0, 0],
        [0, 1, 2, 3, 4, 0, 0, 0],
        [0, 1, 2, 3, 4, 5, 0, 0],
        [0, 1, 2, 3, 4, 5, 6, 0],
        [0, 1, 2, 3, 4, 5, 6, 7],
    ];
    const GAP = 0.45, RAIL_H = 0.45, INSET = 0.035;

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const at = (q, z) => [q[0], q[1], z];
    const pow2 = x => x <= 1 ? 1 : 2 ** Math.ceil(Math.log2(x));

    // Point at angle a on a well of apothem rho, round when k is 0
    function edge(k, rot, rho, a) {
        let d = rho;
        if (k) {
            const s = TAU / k;
            d = rho / Math.cos((((a - rot) % s) + s) % s - s / 2);
        }
        return [d * Math.cos(a), d * Math.sin(a)];
    }

    // A step of a round or polygonal stair between angles a0 and a1, cut into
    // m convex pieces (and at the polygon's corners, where the edges bend).
    function wedge(k, rot, r, a0, a1, m, posts) {
        const cuts = [a0], lo = Math.min(a0, a1), hi = Math.max(a0, a1), corner = [false];
        if (k) {
            const s = TAU / k, vs = [];
            for (let v = rot + Math.ceil((lo - rot) / s) * s; v < hi - 1e-9; v += s) if (v > lo + 1e-9) vs.push(v);
            if (a1 < a0) vs.reverse();
            for (const v of vs) { cuts.push(v); corner.push(true); }
        }
        cuts.push(a1); corner.push(false);
        const as = [a0], flags = [false];
        for (let i = 1; i < cuts.length; i++) {
            const n = Math.max(1, Math.round(m * Math.abs(cuts[i] - cuts[i - 1]) / Math.abs(a1 - a0)));
            for (let q = 1; q <= n; q++) { as.push(geo.lerp(cuts[i - 1], cuts[i], q / n)); flags.push(q === n && corner[i]); }
        }
        const inner = as.map(a => edge(k, rot, r, a)), outer = as.map(a => edge(k, rot, 1, a));
        const pieces = [];
        for (let i = 1; i < as.length; i++) pieces.push([inner[i - 1], outer[i - 1], outer[i], inner[i]]);
        return {
            pieces, inner, outer, corners: flags,
            rail: as.map(a => [...edge(k, rot, r + INSET, a), (a - a0) / (a1 - a0)]),
            posts: Array.from({ length: posts }, (_, q) => edge(k, rot, r + INSET, geo.lerp(a0, a1, (q + 0.5) / posts))),
        };
    }

    // Square stairwell: a landing in each corner and a straight flight of n
    // steps along each side. Units go landing, step, step... down the well.
    function squareUnit(u, n, b, posts, hand) {
        const side = Math.floor(u / (n + 1)), idx = u % (n + 1);
        const c = Math.cos(side * Math.PI / 2), s = Math.sin(side * Math.PI / 2);
        const T = ([x, y]) => [hand * (x * c - y * s), x * s + y * c];
        const e = b + INSET;
        if (idx === 0) {
            return {
                landing: true, pieces: [[[b, b], [1, b], [1, 1], [b, 1]].map(T)],
                inner: [T([b, b])], outer: [[1, b], [1, 1], [b, 1]].map(T), corners: [true],
                newel: T([e, e]), rail: null, posts: [],
            };
        }
        const w = 2 * b / n, xa = b - (idx - 1) * w, xb = b - idx * w;
        return {
            pieces: [[[xa, b], [xa, 1], [xb, 1], [xb, b]].map(T)],
            inner: [[xa, b], [xb, b]].map(T), outer: [[xa, 1], [xb, 1]].map(T), corners: [false, false],
            rail: [[...T([xa, e]), 0], [...T([xb, e]), 1]],
            posts: Array.from({ length: posts }, (_, q) => T([geo.lerp(xa, xb, (q + 0.5) / posts), e])),
        };
    }

    // Straight down or up, with the vanishing point at (vx, vy) on the page
    function makeCamera(o, f, vx, vy, s, K) {
        return {
            dist: z => s * (z - o[2]),
            project: (x, y, z) => {
                const d = s * (z - o[2]);
                return [vx + f * (x - o[0]) / d, vy + s * f * (y - o[1]) / d, -K / d];
            },
            // the point on the plane through P with normal n that shows at (sx, sy)
            lift: (sx, sy, n, P) => {
                const r = [(sx - vx) / f, s * (sy - vy) / f, s];
                const t = dot(n, sub(P, o)) / dot(n, r);
                return [o[0] + t * r[0], o[1] + t * r[1], o[2] + t * r[2]];
            },
        };
    }

    const newell = pts => {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        return [nx, ny, nz];
    };

    function build(p, W, H, rng) {
        const up = p.look === 'up', hand = rng.chance(0.5) ? 1 : -1;
        const square = p.section === 'square', k = { round: 0, square: 4, hexagon: 6, octagon: 8 }[p.section];
        const rot = k ? Math.PI / k : 0, r = p.eye, P = p.pitch;
        const U = square ? 4 * (p.steps + 1) : p.steps, rise = P / U, thick = p.stairs === 'solid' ? rise : rise * 0.4;
        const T = p.turns, J = T * U;
        const f = Math.min(W, H) / 2 / Math.tan(geo.rad(p.fov) / 2);
        const vx = W * p.cx / 100, vy = H * p.cy / 100, reach = Math.hypot(Math.max(vx, W - vx), Math.max(vy, H - vy));
        const phase = rng.range(0, 1), ang = rng.range(0, TAU), off = p.shift / 100 * (r - INSET) * 0.85;
        // The stair carries on past the camera, so the camera height only turns it.
        // Down looks from somewhere in the top turn, up from just over the floor.
        const o = [off * Math.cos(ang), off * Math.sin(ang), up ? P * (0.25 + 0.5 * phase) : T * P + P * (0.3 + 0.5 * phase)];
        const s = up ? 1 : -1, far = up ? T * P - o[2] + P : o[2];
        const cam = makeCamera(o, f, vx, vy, s, 10 * far * far / rise), dist = cam.dist;
        // anything nearer than this is off the page anyway
        const near = Math.max(0.12, f * Math.max(0.05, r - off) / reach);
        const S = new Scene(cam, W, H);

        const clipPoly = pts => {
            const out = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length], da = dist(a[2]) - near, db = dist(b[2]) - near;
                if (da >= 0) out.push(a);
                if ((da >= 0) !== (db >= 0)) out.push(mix(a, b, da / (da - db)));
            }
            return out;
        };
        const face = pts => { const q = clipPoly(pts); if (q.length >= 3) S.face(q, false); };
        const line = (pts, kind) => {
            S.kind = kind;
            let run = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], da = dist(a[2]) - near;
                if (da >= 0) run.push(a);
                if (i + 1 < pts.length) {
                    const b = pts[i + 1], db = dist(b[2]) - near;
                    if ((da >= 0) !== (db >= 0)) {
                        run.push(mix(a, b, da / (da - db)));
                        if (da >= 0) { if (run.length > 1) S.line(run); run = []; }
                    }
                }
            }
            if (run.length > 1) S.line(run);
        };
        // Hatching drawn evenly on paper, then lifted back onto its face
        const hatch = (pts, gap, angle, kind) => {
            const q = clipPoly(pts);
            if (q.length < 3) return;
            const n = newell(q), flat = q.map(v => cam.project(...v));
            for (const [a, b] of geo.hatch([flat], gap, angle)) line([cam.lift(a[0], a[1], n, q[0]), cam.lift(b[0], b[1], n, q[0])], kind);
        };
        const onPaper = (len, z) => f * len / Math.max(near, dist(z));
        // a vertical face shows when the camera is on the side its normal points to
        const facing = (a, n) => n[0] * (o[0] - a[0]) + n[1] * (o[1] - a[1]) > 0;
        const LIGHT = [-0.6, -0.8];

        const zOf = j => (J - j) * rise;
        const plans = [];
        for (let j = up ? 0 : Math.floor(J - o[2] / rise) - 1; j < J; j++) {
            const z = zOf(j);
            if (up ? dist(z) < near : dist(z - thick) < near) continue;
            let plan;
            if (square) plan = squareUnit(((j % U) + U) % U, p.steps, r, p.posts, hand);
            else {
                const a0 = hand * TAU * (j / U + phase), a1 = hand * TAU * ((j + 1) / U + phase);
                const m = geo.clamp(Math.ceil(Math.abs(a1 - a0) / (2 * Math.acos(Math.max(0, 1 - 0.04 / onPaper(1, z))))), 1, 24);
                plan = wedge(k, rot, r, a0, a1, m, p.posts);
            }
            plan.j = j; plan.z = z;
            plans.push(plan);
        }

        // A solid stair has a closed string along the eye and a smooth soffit
        // under it, both following the pitch line through the nosings
        const solid = p.stairs === 'solid', HS = rise + 0.12, SW = 0.006;
        const shadeFace = (quad, n, tone) => {
            if (!p.shade) return;
            const lit = (n[0] * LIGHT[0] + n[1] * LIGHT[1]) / (Math.hypot(n[0], n[1]) || 1) + tone;
            // spacings double so the lines of neighbouring faces meet up
            if (lit < 0.35) hatch(quad, lit < -0.25 ? 0.45 : 0.9, up ? 0.35 : -0.95, SHADE);
        };
        // step edges thin out in powers of two so they stay GAP apart on paper
        const going = square ? 2 * r / p.steps : TAU * r / U;
        const bandOf = z => Math.floor((up ? z : T * P - z) / P) % 2 ? DEEP : TREAD;
        for (const U1 of plans) {
            const { z, j } = U1, zb = z - thick, zs = up ? zb : z, band = bandOf(z);
            const every = U1.landing ? 1 : pow2(GAP / onPaper(going, zs));
            const back = [U1.inner[0], U1.outer[0]], front = [U1.inner.at(-1), U1.outer.at(-1)];
            const vertical = (a, b) => {
                const quad = [at(a, z), at(b, z), at(b, zb), at(a, zb)];
                let n = [b[1] - a[1], a[0] - b[0]];
                face(quad);
                if (!facing(a, n)) n = [-n[0], -n[1]];
                if (facing(a, n)) shadeFace(quad, n, 0);
            };
            // a solid stair seen from below is all soffit
            if (solid && up && !U1.landing) continue;
            for (const q of U1.pieces) face(q.map(v => at(v, zs)));
            if (!solid) for (let i = 1; i < U1.inner.length; i++) vertical(U1.inner[i - 1], U1.inner[i]);
            vertical(back[0], back[1]);
            vertical(front[0], front[1]);
            if (up && p.shade) for (const q of U1.pieces) hatch(q.map(v => at(v, zb)), 1.1, 0.9, SHADE);

            if (!solid) {
                line(U1.inner.map(v => at(v, z)), STRING);
                line(U1.inner.map(v => at(v, zb)), STRING);
            }
            line(U1.outer.map(v => at(v, zs)), WALL);
            if (j % every === 0) {
                line([at(back[0], z), at(back[1], z)], band);
                if (up) line([at(back[0], zb), at(back[1], zb)], band);
                if (!solid) line([at(back[0], zb), at(back[0], z)], STRING);
            }
            if (U1.landing || (j + 1) % every === 0) {
                line([at(front[0], z), at(front[1], z)], band);
                // the nosing's rounded edge, where the step is big enough on paper
                const q = U1.pieces.at(-1), w = Math.min(0.025, 0.2 * geo.dist(q[0], q[3]));
                if (!up && !U1.landing && onPaper(w, z) > 2 * GAP) {
                    const inset = (a, b) => { const l = geo.dist(a, b) || 1; return [b[0] + (a[0] - b[0]) * w / l, b[1] + (a[1] - b[1]) * w / l]; };
                    line([at(inset(q[0], q[3]), z), at(inset(q[1], q[2]), z)], band);
                }
                if (!solid) {
                    line([at(front[0], zb), at(front[1], zb)], band);
                    line([at(front[0], zb), at(front[0], z)], STRING);
                }
            }
            if (!solid) U1.inner.forEach((v, i) => { if (U1.corners[i] && i > 0 && i < U1.inner.length - 1) line([at(v, zb), at(v, z)], STRING); });
        }

        if (solid) {
            // runs of the string between landings, as samples of [inner, outer, pitch height]
            const runs = [];
            let run = null;
            for (const U1 of plans) {
                if (U1.landing) { run = null; continue; }
                if (!run) runs.push(run = []);
                U1.inner.forEach((v, i) => {
                    const h = U1.z + rise * (1 - U1.rail[i][2]), last = run.at(-1);
                    // a step starts where the last one ended, so mark that sample instead
                    if (last && geo.dist(last[0], v) < 1e-9) { if (i === 0) last[4] = U1.j; return; }
                    run.push([v, U1.outer[i], h, U1, i === 0 ? U1.j : null]);
                });
            }
            for (const pts of runs) {
                // the string sits a hair inside the eye, so it hides the ends of the treads
                const q = pts.map(([v]) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] * (1 - SW / l), v[1] * (1 - SW / l)]; });
                const top = pts.map(([, , h], i) => at(q[i], h + 0.04)), bot = pts.map(([, , h], i) => at(q[i], h - HS));
                for (let i = 1; i < pts.length; i++) {
                    const quad = [top[i - 1], top[i], bot[i], bot[i - 1]], a = q[i - 1], b = q[i];
                    let n = [b[1] - a[1], a[0] - b[0]];
                    if (n[0] * a[0] + n[1] * a[1] > 0) n = [-n[0], -n[1]];
                    face(quad);
                    shadeFace(quad, n, 0.15);
                }
                line(top, STRING);
                line(bot, STRING);
                if (!up) continue;
                // the soffit, with a line under every step and darker toward the wall
                const soffit = (i, rho) => {
                    const [v, w, h] = pts[i];
                    return [geo.lerp(q[i][0], w[0], rho), geo.lerp(q[i][1], w[1], rho), h - HS];
                };
                for (let i = 1; i < pts.length; i++) {
                    for (const [r0, r1, shaded] of [[0, 0.5, false], [0.5, 1, true]]) {
                        const A = soffit(i - 1, r0), B = soffit(i - 1, r1), C = soffit(i, r1), D = soffit(i, r0);
                        face([A, B, C]); face([A, C, D]);
                        if (p.shade && shaded) { hatch([A, B, C], 1.1, 0.9, SHADE); hatch([A, C, D], 1.1, 0.9, SHADE); }
                    }
                }
                line(pts.map((_, i) => soffit(i, 1)), WALL);
                pts.forEach(([, , h, , j], i) => {
                    if (j === null || j === undefined || j % pow2(GAP / onPaper(going, h - HS))) return;
                    line(Array.from({ length: 9 }, (_, s) => soffit(i, s / 8)), bandOf(h));
                });
            }
        }

        // stone courses on the wall, only really seen in the turn below the camera
        if (!up && p.courses) {
            const n = k ? k * 12 : 96, ring = (zz, d) => Array.from({ length: n + 1 }, (_, i) => at(edge(k, rot, 1 + d, rot + TAU * i / n), zz));
            const course = 0.24, z1 = o[2] - near;
            for (let c = 0, zz = 0; zz < z1; c++, zz += course) {
                if (onPaper(course, zz) < GAP * 2) continue;
                line(ring(zz, 0), WALL);
                const joints = Math.round(TAU / 0.3 / 2) * 2;
                for (let i = 0; i < joints; i++) {
                    const a = rot + TAU * (i + (c % 2) * 0.5) / joints, v = edge(k, rot, 1, a);
                    line([at(v, zz), at(v, Math.min(z1, zz + course))], WALL);
                }
            }
        }

        // handrail and balusters
        if (p.rail !== 'none') {
            const runs = [], posts = [], rw = 0.022, rh = 0.03, br = 0.009, spacing = going / p.posts;
            let run = null;
            for (const U1 of plans) {
                if (U1.newel) posts.push([U1.newel, U1.z, U1.z + rise + RAIL_H + 0.06, true]);
                if (!U1.rail) { run = null; continue; }
                if (!run) runs.push(run = []);
                for (const [x, y, t] of U1.rail) {
                    const q = [x, y, U1.z + rise * (1 - t) + RAIL_H];
                    if (!run.length || Math.hypot(q[0] - run.at(-1)[0], q[1] - run.at(-1)[1], q[2] - run.at(-1)[2]) > 1e-9) run.push(q);
                }
                U1.posts.forEach((v, i) => posts.push([v, U1.z, U1.z + rise * (1 - (i + 0.5) / U1.posts.length) + RAIL_H - rh]));
            }
            for (const pts of runs) {
                if (pts.length < 2) continue;
                const side = pts.map((q, i) => {
                    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
                    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
                    return [-dy / l * rw, dx / l * rw];
                });
                const L0 = pts.map((q, i) => [q[0] + side[i][0], q[1] + side[i][1], q[2]]);
                const R0 = pts.map((q, i) => [q[0] - side[i][0], q[1] - side[i][1], q[2]]);
                const lo = q => [q[0], q[1], q[2] - rh];
                // the rail is a bar, split into triangles because its faces twist a little round a helix
                for (let i = 1; i < pts.length; i++) {
                    for (const [A, B] of [[L0, R0], [L0.map(lo), L0], [R0.map(lo), R0], [L0.map(lo), R0.map(lo)]]) {
                        face([A[i - 1], B[i - 1], B[i]]);
                        face([A[i - 1], B[i], A[i]]);
                    }
                }
                // far down the four edges would run together, so it becomes one line
                const wide = pts.map(q => onPaper(2 * rw, up ? q[2] - rh : q[2]) > 2.5 * GAP);
                const pieces = (A, keep) => {
                    let part = [];
                    A.forEach((q, i) => {
                        if (keep(i)) part.push(q);
                        else { if (part.length > 1) line(part, RAIL); part = []; }
                        if (keep(i) && i + 1 < A.length && !keep(i + 1)) { part.push(A[i + 1]); line(part, RAIL); part = []; }
                    });
                    if (part.length > 1) line(part, RAIL);
                };
                for (const A of [L0, R0, L0.map(lo), R0.map(lo)]) pieces(A, i => wide[i]);
                pieces(pts.map(q => [q[0], q[1], q[2] + 0.001]), i => !wide[i]);
            }
            posts.forEach(([q, z0, z1, newel], i) => {
                if (!newel && (p.rail !== 'balusters' || i % pow2(GAP / onPaper(spacing, up ? z1 : z0)))) return;
                // near ones get both sides and hide what's behind them
                const wide = newel ? 1.8 * br : br;
                if (onPaper(2 * wide, up ? z0 : z1) < 0.6) { line([at(q, z0), at(q, z1)], POST); return; }
                const dx = q[0] - o[0], dy = q[1] - o[1], l = Math.hypot(dx, dy) || 1;
                const a = [q[0] - dy / l * wide, q[1] + dx / l * wide], b = [q[0] + dy / l * wide, q[1] - dx / l * wide];
                face([at(a, z0), at(b, z0), at(b, z1), at(a, z1)]);
                line([at(a, z0), at(a, z1)], POST);
                line([at(b, z0), at(b, z1)], POST);
            });
        }

        if (!up && p.bottom !== 'void') floor(p, k, rot, line, face, f, dist(0));
        if (up) skylight(p, k, rot, r, T * P, line, face);
        // corners of a polygonal well run the whole height
        for (let i = 0; i < k; i++) {
            const q = edge(k, rot, 1, rot + TAU * i / k);
            line([at(q, up ? 0 : o[2]), at(q, up ? T * P : 0)], WALL);
        }
        return S;
    }

    function floor(p, k, rot, line, face, f, d) {
        const ring = (rho, kk) => Array.from({ length: 97 }, (_, i) => at(edge(kk, rot, rho, TAU * i / 96), 0));
        line(ring(1, k), BOTTOM);
        const sp = 0.5 * d / f;
        if (p.bottom === 'checker') {
            const n = 8, s = 2 / n, lim = Array.from({ length: k || 48 }, (_, i) => edge(k, rot, 0.999, rot + TAU * i / (k || 48)));
            const clip = poly => {
                let out = poly;
                for (let i = 0; i < lim.length && out.length; i++) {
                    const a = lim[i], b = lim[(i + 1) % lim.length];
                    out = geo.clipPolygonHalfPlane(out, a, [a[1] - b[1], b[0] - a[0]]);
                }
                return out;
            };
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                const x = -1 + i * s, y = -1 + j * s, cell = clip([[x, y], [x + s, y], [x + s, y + s], [x, y + s]]);
                if (cell.length < 3) continue;
                line(geo.close(cell).map(v => at(v, 0)), BOTTOM);
                if ((i + j) % 2) for (const [a, b] of geo.hatch([cell], sp, Math.PI / 4)) line([at(a, 0), at(b, 0)], BOTTOM);
            }
            return;
        }
        // compass rose: rings, a band of ticks, and a star of points, each half hatched
        const r0 = 0.86, r1 = 0.76;
        line(ring(r0, 0), BOTTOM); line(ring(r1, 0), BOTTOM);
        for (let t = 0; t < 64; t++) {
            const a = TAU * t / 64;
            line([at(edge(0, 0, t % 4 ? (r0 + r1) / 2 : r1, a), 0), at(edge(0, 0, r0, a), 0)], BOTTOM);
        }
        // each tier sits a hair above the one under it so it hides those points
        [[16, TAU / 32, 0.42, 0.1], [8, TAU / 16, 0.58, 0.13], [4, 0, 0.74, 0.16]].forEach(([n, a0, tip, sh], lv) => {
            const z = 0.004 * (lv + 1);
            for (let q = 0; q < n; q++) {
                const a = a0 + TAU * q / n, half = Math.PI / n;
                const O = [0, 0], Tp = edge(0, 0, tip, a), A = edge(0, 0, sh, a - half), B = edge(0, 0, sh, a + half);
                face([O, A, Tp, B].map(v => at(v, z)));
                line([O, A, Tp, B, O].map(v => at(v, z)), BOTTOM);
                line([at(O, z), at(Tp, z)], BOTTOM);
                for (const [u, v] of geo.hatch([[O, Tp, B]], sp, a)) line([at(u, z), at(v, z)], BOTTOM);
            }
        });
    }

    // A glazed lantern over a round opening in the ceiling, seen from below
    function skylight(p, k, rot, r, zc, line, face) {
        const ro = Math.min(0.92, r + 0.25), n = 96;
        for (let i = 0; i < n; i++) {
            const a = TAU * i / n, b = TAU * (i + 1) / n;
            face([at(edge(0, 0, ro, a), zc), at(edge(k, rot, 1, a), zc), at(edge(k, rot, 1, b), zc), at(edge(0, 0, ro, b), zc)]);
        }
        const circle = (rho, z) => Array.from({ length: n + 1 }, (_, i) => at(edge(0, 0, rho, TAU * i / n), z));
        line(circle(ro, zc), BOTTOM);
        line(circle(ro * 0.96, zc + 0.04), BOTTOM);
        if (p.bottom === 'void') return;
        const h = ro * 0.7, ribs = 16, rings = 5;
        const pt = (t, a) => {
            const rr = ro * Math.cos(t * Math.PI / 2) * 0.96, zz = zc + 0.04 + h * Math.sin(t * Math.PI / 2);
            return [rr * Math.cos(a), rr * Math.sin(a), zz];
        };
        for (let q = 0; q < ribs; q++) line(Array.from({ length: 13 }, (_, i) => pt(0.88 * i / 12, TAU * q / ribs)), BOTTOM);
        for (let i = 1; i <= rings; i++) line(Array.from({ length: n + 1 }, (_, q) => pt(0.88 * i / rings, TAU * q / n)), BOTTOM);
        line(Array.from({ length: n + 1 }, (_, q) => pt(0.97, TAU * q / n)), BOTTOM);
    }

    PG.register({
        id: 'stairwell', name: 'Infinite Stairwell', category: 'Scenes', fit: false,
        description: 'Looking straight down a stairwell, or up it from the floor, in one-point perspective. The handrail and balusters wind away to a floor pattern or a skylight.',
        params: [
            { type: 'section', label: 'Stair' },
            { id: 'section', label: 'Well', type: 'select', value: 'round', random: ['round', 'round', 'square', 'octagon'],
              options: [['round', 'Round'], ['square', 'Square with landings'], ['octagon', 'Octagonal'], ['hexagon', 'Hexagonal']] },
            { id: 'steps', label: 'Steps per turn', type: 'range', min: 3, max: 40, step: 1, value: 22, random: [16, 28] },
            { id: 'eye', label: 'Open well', type: 'range', min: 0.2, max: 0.75, step: 0.01, value: 0.5, random: [0.38, 0.6] },
            { id: 'pitch', label: 'Turn height', type: 'range', min: 0.6, max: 2.4, step: 0.05, value: 1.1, random: [0.9, 1.5] },
            { id: 'turns', label: 'Turns deep', type: 'range', min: 1, max: 16, step: 1, value: 6, random: [4, 9] },
            { id: 'stairs', label: 'Steps', type: 'select', value: 'solid', random: true, options: [['solid', 'Solid stone'], ['open', 'Floating treads']] },
            { id: 'rail', label: 'Balustrade', type: 'select', value: 'balusters', random: ['balusters', 'balusters', 'rail'],
              options: [['balusters', 'Balusters'], ['rail', 'Handrail only'], ['none', 'None']] },
            { id: 'posts', label: 'Balusters per step', type: 'range', min: 1, max: 4, step: 1, value: 2, random: [1, 3], show: p => p.rail === 'balusters' },
            { id: 'shade', label: 'Shading', type: 'checkbox', value: true, random: 0.85 },
            { id: 'courses', label: 'Stone walls', type: 'checkbox', value: true, random: 0.7 },
            { type: 'section', label: 'View' },
            { id: 'look', label: 'Looking', type: 'select', value: 'down', random: ['down', 'down', 'up'], options: [['down', 'Down the well'], ['up', 'Up from the floor']] },
            { id: 'bottom', label: 'Far end', type: 'select', value: 'compass', random: ['compass', 'checker', 'compass', 'void'],
              options: [['compass', 'Compass floor / lantern'], ['checker', 'Checkered floor / lantern'], ['void', 'Open']] },
            { id: 'fov', label: 'Field of view (°)', type: 'range', min: 40, max: 120, step: 1, value: 80, random: [70, 95] },
            { id: 'shift', label: 'Camera off centre (%)', type: 'range', min: 0, max: 100, step: 1, value: 30, random: [0, 60] },
            { id: 'cx', label: 'Vanishing point X (%)', type: 'range', min: 30, max: 70, step: 1, value: 50, random: [44, 56] },
            { id: 'cy', label: 'Vanishing point Y (%)', type: 'range', min: 30, max: 70, step: 1, value: 50, random: [44, 56] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const S = build(p, W, H, rng), layers = PG.pens.layers(p.pens), map = MAPS[layers.length - 1];
            PG.iso.render(S).forEach((paths, kind) => { if (paths) for (const q of paths) layers[map[kind]].push(q); });
            return { layers };
        },
    });
})();
