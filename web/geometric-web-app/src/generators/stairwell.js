/*
 * Infinite Stairwell: a stair shaft seen straight down (or up) in one-point
 * perspective. Walls, steps, landings and doorways are all cells of one grid,
 * so the tiles run on across every step. Round and octagonal wells bend the
 * same grid into wedges.
 *
 * PG.iso.Scene removes the hidden lines. It interpolates depth linearly over
 * each projected face, which stays exact under perspective when depth is
 * -K / distance. Grid lines that would sit closer than GAP on paper thin out
 * in powers of two as the shaft recedes, so the far end never turns into a blot.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, Scene } = PG.iso;

    const WALL = 0, STAIR = 1, SHADE = 2, DEEP = 3, RAIL = 4, DOOR = 5, FLOOR = 6, LAND = 7, REFLECT = 8;
    // Pen layer for each group, by pen count. Doorways and the bottom stay in
    // the dark ink until they get pens of their own.
    const MAPS = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 1, 0, 1, 0, 0, 1],
        [0, 1, 2, 0, 1, 0, 0, 1],
        [0, 1, 2, 3, 1, 0, 0, 1],
        [0, 1, 2, 3, 4, 0, 0, 1],
        [0, 1, 2, 3, 4, 5, 0, 1],
        [0, 1, 2, 3, 4, 5, 6, 1],
        [0, 1, 2, 3, 4, 5, 6, 7],
    ];
    // face types, the highest one names an edge shared by several faces
    const T_WALL = 1, T_FLOOR = 2, T_STAIR = 3, T_LAND = 4, T_DOOR = 5;
    const GROUP = [WALL, WALL, FLOOR, STAIR, LAND, DOOR];
    const GAP = 0.5, HATCH = 0.6, MIN_STEP = 1.2, RAIL_H = 3;
    const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const STEP = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const LIGHT = [-0.339, -0.565, 0.753];

    const key = (i, j, k) => ((k + 8) * 4096 + j + 64) * 4096 + i + 64;
    const mod = (a, n) => ((a % n) + n) % n;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

    // Lattice corners of the face between cell (i, j, k) and its neighbour in direction d
    function quad(i, j, k, d) {
        if (d < 2) { const I = i + (d === 0 ? 1 : 0); return [[I, j, k], [I, j + 1, k], [I, j + 1, k + 1], [I, j, k + 1]]; }
        if (d < 4) { const J = j + (d === 2 ? 1 : 0); return [[i, J, k], [i + 1, J, k], [i + 1, J, k + 1], [i, J, k + 1]]; }
        const K = k + (d === 4 ? 1 : 0);
        return [[i, j, K], [i + 1, j, K], [i + 1, j + 1, K], [i, j + 1, K]];
    }

    // The shaft's cross-section as a grid of cells. Square wells use plain
    // cubes. Polygon wells run i around the wall and j inward, shrinking each
    // ring toward the axis, so every face is still a flat convex quad.
    function makeWell(p, W, H) {
        const N = p.tiles;
        if (p.section === 'square' || p.section === 'rect') {
            let Nx = N, Ny = N;
            if (p.section === 'rect') {
                if (H >= W) Ny = geo.clamp(Math.round(N * H / W), N, 2 * N);
                else Nx = geo.clamp(Math.round(N * W / H), N, 2 * N);
            }
            const x0 = -Nx / 2, y0 = -Ny / 2, rim = [], floor = [];
            for (let i = 0; i < Nx; i++) rim.push([i, 0], [i, Ny - 1]);
            for (let j = 1; j < Ny - 1; j++) rim.push([0, j], [Nx - 1, j]);
            for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) floor.push([i, j]);
            return {
                M: 0, size: Math.min(Nx, Ny), rim, floor, maxWidth: Math.floor(Math.min(Nx, Ny) / 2) - 2,
                // clockwise on paper, each from the corner it starts at: along s, inward b
                walls: [
                    { len: Nx, at: (s, b) => [s, b] },
                    { len: Ny, at: (s, b) => [Nx - b, s] },
                    { len: Nx, at: (s, b) => [Nx - s, Ny - b] },
                    { len: Ny, at: (s, b) => [b, Ny - s] },
                ],
                wrap: i => i,
                inside: (i, j) => i >= 0 && j >= 0 && i < Nx && j < Ny,
                V: (i, j, k) => [x0 + i, y0 + j, -k],
                outline: [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0]],
                camera: (fx, fy) => [x0 + Nx * fx, y0 + Ny * fy],
            };
        }
        const round = p.section === 'round';
        const n = round ? Math.max(24, 8 * Math.round(Math.PI * N / 8)) : 8;
        const m = round ? 1 : Math.max(2, Math.round(N / (1 + Math.SQRT2)));
        const M = n * m, Ra = m / (2 * Math.tan(Math.PI / n)), Rc = m / (2 * Math.sin(Math.PI / n));
        const C = [];
        for (let s = 0; s <= n; s++) {
            const a = TAU * (s - 0.5) / n - Math.PI / 2;
            C.push([Rc * Math.cos(a), Rc * Math.sin(a)]);
        }
        const rim = [];
        for (let i = 0; i < M; i++) rim.push([i, 0]);
        return {
            M, Ra, size: 2 * Ra, rim, maxWidth: Math.floor(Ra) - 2,
            walls: [{ len: M, at: (s, b) => [s, b] }],
            wrap: i => mod(i, M),
            inside: (i, j) => j >= 0,
            V: (i, j, k) => {
                i = mod(i, M);
                const s = Math.min(n - 1, Math.floor(i / m)), t = i / m - s, g = 1 - j / Ra, a = C[s], b = C[s + 1];
                return [(a[0] + (b[0] - a[0]) * t) * g, (a[1] + (b[1] - a[1]) * t) * g, -k];
            },
            outline: C.slice(0, n),
            camera: null,
        };
    }

    // Smallest scale (mm per unit at the camera's distance from the near rim)
    // that keeps the page inside the rim, seen from o with the vanishing point
    // at (vx, vy). Also returns the distance from o to the nearest wall.
    function fitRim(outline, o, W, H, vx, vy) {
        let k = 0, clear = Infinity;
        for (let s = 0; s < outline.length; s++) {
            const a = outline[s], b = outline[(s + 1) % outline.length];
            let nx = b[1] - a[1], ny = a[0] - b[0];
            const l = Math.hypot(nx, ny);
            nx /= l; ny /= l;
            if (nx * a[0] + ny * a[1] < 0) { nx = -nx; ny = -ny; }
            const room = nx * (a[0] - o[0]) + ny * (a[1] - o[1]);
            clear = Math.min(clear, room);
            for (const [cx, cy] of [[0, 0], [W, 0], [W, H], [0, H]]) k = Math.max(k, ((cx - vx) * nx + (cy - vy) * ny) / room);
        }
        return { k, clear };
    }

    function makeCamera(o, f, vx, vy, up, K) {
        const s = up ? 1 : -1;
        return {
            project: (x, y, z) => {
                const d = s * (z - o[2]);
                return [vx + f * (x - o[0]) / d, vy + f * (y - o[1]) / d, -K / d];
            },
            // the point on the plane through P with normal n that shows at (sx, sy)
            lift: (sx, sy, n, P) => {
                const r = [(sx - vx) / f, (sy - vy) / f, s];
                const t = dot(n, sub(P, o)) / dot(n, r);
                return [o[0] + t * r[0], o[1] + t * r[1], o[2] + t * r[2]];
            },
        };
    }

    // Stair units for one turn, in walking order: corner landings and runs of
    // steps, each a list of cells plus handrail points (lattice x, y).
    function stairPlan(well, w, L, dw) {
        const U = [], eps = 0.3;
        const cells = (wall, a0, a1) => {
            const out = [];
            for (let a = a0; a < a1; a++) for (let b = 0; b < w; b++) {
                const q = wall.at(a + 0.5, b + 0.5);
                out.push([Math.floor(q[0]), Math.floor(q[1])]);
            }
            return out;
        };
        const steps = (wall, a0, a1) => {
            const run = a1 - a0, ns = Math.max(1, Math.floor(run / L));
            for (let t = 0; t < ns; t++) {
                const s0 = a0 + Math.floor(t * run / ns), s1 = a0 + Math.floor((t + 1) * run / ns);
                if (s1 > s0) U.push({
                    cells: cells(wall, s0, s1), rail: [wall.at((s0 + s1) / 2, w - eps)],
                    window: t === Math.floor(ns / 2) ? { wall, a0: s0 + Math.floor((s1 - s0 - 1) / 2) } : null,
                });
            }
        };
        const landing = (wall, a0, a1, rail) => U.push({
            // square wells keep the door off the corner so the corner line stays whole
            land: true, cells: cells(wall, a0, a1), rail, door: { wall, a0: well.M ? a0 + Math.floor((a1 - a0 - dw) / 2) : Math.max(1, Math.floor((a1 - a0 - dw) / 2)) },
        });
        if (!well.M) {
            for (const wall of well.walls) {
                landing(wall, 0, w, [wall.at(w - eps, w - eps)]);
                if (wall.len > 2 * w) steps(wall, w, wall.len - w);
            }
        } else {
            const wall = well.walls[0], Q = well.M / 4, lw = Math.min(Q - 1, Math.max(2, w));
            for (let q = 0; q < 4; q++) {
                const a0 = q * Q - Math.floor(lw / 2);
                landing(wall, a0, a0 + lw, [wall.at(a0 + eps, w - eps), wall.at(a0 + lw - eps, w - eps)]);
                steps(wall, a0 + lw, a0 + Q);
            }
        }
        return U;
    }

    // Cut paths into dashes of 1 to 3.5 mm. Each path seeds its own pattern from
    // where it starts, so the pen count never changes the dashes.
    function dashes(paths) {
        const out = [];
        for (const path of paths) {
            const r = new PG.RNG(hash(Math.round(path[0][0] * 100), Math.round(path[0][1] * 100), path.length));
            let on = r.chance(0.7), left = on ? r.range(1, 3.5) : r.range(0.4, 1.2), run = on ? [path[0]] : null;
            for (let i = 1; i < path.length; i++) {
                let a = path[i - 1];
                const b = path[i];
                let seg = geo.dist(a, b);
                while (seg > left) {
                    const c = geo.lerpPt(a, b, left / seg);
                    if (on) { run.push(c); out.push(run); run = null; } else run = [c];
                    seg -= left;
                    a = c;
                    on = !on;
                    left = on ? r.range(1, 3.5) : r.range(0.4, 1.2);
                }
                left -= seg;
                if (on) run.push(b);
            }
            if (on && run && run.length > 1) out.push(run);
        }
        return out.filter(q => geo.pathLength(q) > 0.3);
    }

    // A compass rose set into the floor. Each tier of points sits a hair
    // higher than the one below so its faces hide the points underneath.
    function compass(S, R, z, sp, square) {
        const at = (r, a, zz) => [r * Math.cos(a), r * Math.sin(a), zz];
        const ring = (r, zz) => {
            const pts = [];
            for (let i = 0; i <= 96; i++) pts.push(at(r, TAU * i / 96, zz));
            S.line(pts);
        };
        // in a polygon well the edge of the floor tiles is already the outer ring
        const r0 = square ? R : 0.9 * R, r1 = r0 * 0.88;
        ring(r0, z);
        ring(r1, z);
        for (let t = 0; t < 32; t++) {
            const a = TAU * t / 32 - Math.PI / 2;
            S.line([at(t % 4 ? (r0 + r1) / 2 : r1, a, z), at(r0, a, z)]);
        }
        // [points, offset, tip, shoulder radius, half width]
        const tiers = [[8, TAU / 16, 0.46, 0.13, TAU / 16], [4, TAU / 8, 0.66, 0.17, TAU / 8], [4, 0, 0.84, 0.21, TAU / 8]];
        tiers.forEach(([n, off, tip, sh, half], lv) => {
            const zz = z + 0.06 * (lv + 1);
            for (let q = 0; q < n; q++) {
                const a = off + TAU * q / n - Math.PI / 2, T = at(tip * r1, a, zz), L = at(sh * r1, a - half, zz), Rt = at(sh * r1, a + half, zz), O = [0, 0, zz];
                S.face([O, L, T, Rt], false);
                S.line([O, L, T, Rt, O]);
                S.line([O, T]);
                const tri = [[0, 0], [T[0], T[1]], [Rt[0], Rt[1]]];
                for (const [u, v] of geo.hatch([tri], sp, a)) S.line([[u[0], u[1], zz], [v[0], v[1], zz]]);
            }
        });
        const zc = z + 0.3, rc = 0.07 * r1, disc = [];
        for (let i = 0; i < 24; i++) disc.push(at(rc, TAU * i / 24, zc));
        S.face(disc, false);
        ring(rc, zc);
    }

    PG.register({
        id: 'stairwell', name: 'Infinite Stairwell', category: 'Scenes', fit: false,
        description: 'Looking straight down a tiled stair shaft into the dark, or up at the sky, in one-point perspective. Steps, landings and doorways share one grid, with hidden lines removed.',
        params: [
            { type: 'section', label: 'Shaft' },
            { id: 'section', label: 'Section', type: 'select', value: 'round', random: ['round', 'round', 'square', 'square', 'rect', 'octagon'],
              options: [['round', 'Round well'], ['square', 'Square'], ['rect', 'Page shaped'], ['octagon', 'Octagonal']] },
            { id: 'tiles', label: 'Tiles across', type: 'range', min: 8, max: 32, step: 1, value: 20, random: [12, 24] },
            { id: 'levels', label: 'Depth (levels)', type: 'range', min: 30, max: 240, step: 1, value: 110, random: [60, 160] },
            { id: 'pattern', label: 'Wall tiles', type: 'select', value: 'brick', random: true,
              options: [['grid', 'Square grid'], ['brick', 'Running bond'], ['ashlar', 'Large blocks']] },
            { id: 'openings', label: 'Openings', type: 'select', value: 'doors', random: ['none', 'doors', 'doors', 'both'],
              options: [['none', 'None'], ['doors', 'Doorways'], ['both', 'Doorways & windows']] },
            { id: 'bottom', label: 'Bottom', type: 'select', value: 'void', random: ['void', 'void', 'floor', 'pool'], show: p => p.look !== 'up',
              options: [['void', 'Dark void'], ['floor', 'Compass floor'], ['pool', 'Still pool']] },
            { type: 'section', label: 'Stairs' },
            { id: 'stairs', label: 'Stairs', type: 'select', value: 'single', random: ['single', 'single', 'single', 'double'],
              options: [['single', 'Single spiral'], ['double', 'Double helix'], ['none', 'Empty shaft']] },
            { id: 'width', label: 'Stair width', type: 'range', min: 2, max: 6, step: 1, value: 3, random: [2, 4], show: p => p.stairs !== 'none' },
            { id: 'run', label: 'Step length', type: 'range', min: 1, max: 3, step: 1, value: 1, random: [1, 2], show: p => p.stairs !== 'none' },
            { id: 'steps', label: 'Step thickness', type: 'range', min: 1, max: 6, step: 1, value: 2, random: [1, 3], show: p => p.stairs !== 'none' },
            { id: 'rails', label: 'Handrails', type: 'checkbox', value: true, random: 0.7, show: p => p.stairs !== 'none' },
            { id: 'shade', label: 'Shade the stairs', type: 'checkbox', value: true, random: 0.85, show: p => p.stairs !== 'none' },
            { type: 'section', label: 'View' },
            { id: 'look', label: 'Looking', type: 'select', value: 'down', random: ['down', 'down', 'down', 'up'],
              options: [['down', 'Down the shaft'], ['up', 'Up at the sky']] },
            { id: 'fov', label: 'Field of view (°)', type: 'range', min: 40, max: 110, step: 1, value: 75, random: [60, 82] },
            { id: 'cx', label: 'Vanishing point X (%)', type: 'range', min: 30, max: 70, step: 1, value: 50, random: [42, 58] },
            { id: 'cy', label: 'Vanishing point Y (%)', type: 'range', min: 30, max: 70, step: 1, value: 50, random: [42, 58] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        // Stairs in proportion to the shaft, and a depth that leaves the bottom
        // a sensible size: a small dark hole, or a floor or pool big enough to see.
        randomize(rng, p) {
            const h = p.tiles / (2 * Math.tan(geo.rad(p.fov) / 2)), out = {};
            out.width = geo.clamp(Math.round(p.tiles / rng.range(5, 7.5)), 2, p.stairs === 'double' ? 3 : 5);
            if (p.stairs === 'double') out.steps = Math.min(p.steps, 2);
            const deep = p.look === 'up' ? rng.range(5, 9) : p.bottom === 'void' ? rng.range(6, 10) : rng.range(2.2, 3.6);
            out.levels = geo.clamp(Math.round(h * deep), 30, 240);
            return out;
        },
        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const rng = new PG.RNG(hash(ctx.seed | 0, 41));
            const layers = PG.pens.layers(p.pens), pens = layers.length;
            const well = makeWell(p, W, H), { V, wrap } = well;
            const up = p.look === 'up', Dm = Math.round(p.levels), floorSolid = !up && p.bottom === 'floor';
            // A pool mirrors the whole shaft below the water line, so the model
            // just carries on upside down to a second rim.
            const pool = !up && p.bottom === 'pool', Dt = pool ? 2 * Dm : Dm;

            // camera
            const vx = W * p.cx / 100, vy = H * p.cy / 100;
            let o;
            if (well.camera) o = well.camera(p.cx / 100, p.cy / 100);
            else {
                const k0 = fitRim(well.outline, [0, 0], W, H, W / 2, H / 2).k;
                o = [(vx - W / 2) / k0, (vy - H / 2) / k0];
            }
            const rim = fitRim(well.outline, o, W, H, vx, vy);
            const h = well.size / (2 * Math.tan(geo.rad(p.fov) / 2)), f = rim.k * 1.02 * h;
            const eye = [o[0], o[1], up ? -Dm - h : h];
            const dist = k => up ? h + Dm - k : h + k;
            const cam = makeCamera(eye, f, vx, vy, up, 0.2 * (h + Dt) ** 2);
            const S = new Scene(cam, W, H);

            // stairs
            const blocks = new Map(), blockCells = [], carved = new Set(), carvedCells = [], rails = [], doors = [], windows = [];
            const w = geo.clamp(Math.round(p.width), 1, Math.max(1, well.maxWidth));
            const T = Math.round(p.steps), dw = w >= 3 ? 2 : 1;
            const setBlock = (i, j, k, type) => {
                const c = key(wrap(i), j, k);
                if (!blocks.has(c)) blockCells.push([wrap(i), j, k]);
                blocks.set(c, type);
            };
            if (p.stairs !== 'none' && well.maxWidth >= 1) {
                const U = stairPlan(well, w, Math.round(p.run), dw);
                if (rng.chance(0.5)) { U.reverse(); for (const u of U) u.rail.reverse(); }
                const lands = [];
                U.forEach((u, i) => { if (u.land) lands.push(i); });
                const first = rng.int(0, lands.length - 1), starts = [lands[first]];
                if (p.stairs === 'double') starts.push(lands[(first + 2) % lands.length]);
                const pitch = U.length / starts.length;
                for (const s0 of starts) {
                    let rail = [];
                    for (let u = 0, k = 1; k < Dm; u++, k++) {
                        const unit = U[(s0 + u) % U.length];
                        if (f / dist(k) < MIN_STEP) {
                            if (rail.length) rails.push(rail);
                            rail = [];
                            continue;
                        }
                        for (const [i, j] of unit.cells) for (let t = 0; t < T && k + t < Dm; t++) setBlock(i, j, k + t, unit.land ? T_LAND : T_STAIR);
                        for (const q of unit.rail) rail.push([q, k]);
                        if (unit.land && p.openings !== 'none') doors.push({ ...unit.door, k });
                        if (unit.window && p.openings === 'both') windows.push({ ...unit.window, k: k - Math.round(pitch / 2) });
                    }
                    if (rail.length) rails.push(rail);
                }
            }

            // doorways cut into the wall behind each landing, as tall as the flight above allows
            const holes = [];
            const cut = (wall, a0, width, k0, k1, depth) => {
                for (let a = a0; a < a0 + width; a++) {
                    const c = wall.at(a + 0.5, 0.5), e = wall.at(a + 0.5, -0.5);
                    const ci = Math.floor(c[0]), cj = Math.floor(c[1]), ei = Math.floor(e[0]) - ci, ej = Math.floor(e[1]) - cj;
                    for (let r = 1; r <= depth; r++) for (let k = k0; k < k1; k++) {
                        const cc = [wrap(ci + ei * r), cj + ej * r, k], ck = key(cc[0], cc[1], k);
                        if (!carved.has(ck)) { carved.add(ck); carvedCells.push(cc); }
                    }
                }
                holes.push({ wall, a0, width, k0, k1, depth });
            };
            const free = (wall, a0, width, k) => {
                if (k < 1 || k >= Dm) return false;
                for (let a = a0 - 1; a <= a0 + width; a++) {
                    const c = wall.at(a + 0.5, 0.5), ci = Math.floor(c[0]), cj = Math.floor(c[1]);
                    if (well.inside(ci, cj) && blocks.has(key(wrap(ci), cj, k))) return false;
                    const e = wall.at(a + 0.5, -0.5);
                    if (carved.has(key(wrap(Math.floor(e[0])), Math.floor(e[1]), k))) return false;
                }
                return true;
            };
            // right under the camera a doorway is mostly a big dark blot
            const far = k => Math.min(dist(k), dist(k - 5)) > 1.8 * h;
            for (const d of doors) {
                if (!far(d.k)) continue;
                let dh = 0;
                while (dh < 5 && free(d.wall, d.a0 + 1, dw - 2, d.k - dh - 1)) dh++;
                if (dh >= 3) cut(d.wall, d.a0, dw, d.k - dh, d.k, 3);
            }
            // windows halfway between flights
            for (const s of windows) {
                let ok = far(s.k + 3);
                for (let k = s.k - 2; k <= s.k + 3 && ok; k++) ok = free(s.wall, s.a0, dw, k);
                if (ok) cut(s.wall, s.a0, dw, s.k, s.k + 3, 2);
            }

            if (pool) {
                for (const [i, j, k] of blockCells.slice()) setBlock(i, j, 2 * Dm - 1 - k, blocks.get(key(i, j, k)));
                for (const [i, j, k] of carvedCells.slice()) {
                    const cc = [i, j, 2 * Dm - 1 - k];
                    carved.add(key(i, j, cc[2]));
                    carvedCells.push(cc);
                }
                for (const hl of holes.slice()) holes.push({ ...hl, k0: 2 * Dm - hl.k1, k1: 2 * Dm - hl.k0 });
                for (const rail of rails.slice()) rails.push(rail.map(([q, k]) => [q, k, true]));
            }
            const wet = (k, ax) => pool && (ax === 2 ? k >= Dm : k > Dm);

            const isSolid = (i, j, k) => {
                if (k < 0) return false;
                if (k >= Dt) return floorSolid;
                const c = key(wrap(i), j, k);
                if (carved.has(c)) return false;
                return blocks.has(c) || !well.inside(i, j);
            };

            // every cell that could border something solid
            const cand = new Map();
            const add = (i, j, k) => {
                if (k < 0 || k >= Dt) return;
                i = wrap(i);
                const c = key(i, j, k);
                if (!cand.has(c)) cand.set(c, [i, j, k]);
            };
            for (let k = 0; k < Dt; k++) for (const [i, j] of well.rim) add(i, j, k);
            for (const [i, j, k] of blockCells) for (const d of NB) add(i + d[0], j + d[1], k + d[2]);
            for (const [i, j, k] of carvedCells) add(i, j, k);
            if (floorSolid) {
                if (well.M) for (let i = 0; i < well.M; i++) for (let b = 0; b <= w; b++) add(i, b, Dm - 1);
                else for (const [i, j] of well.floor) add(i, j, Dm - 1);
            }

            // camera-facing faces, and the lattice edges they share
            const faces = [], edges = new Map();
            for (const [c, [i, j, k]] of cand) {
                if (isSolid(i, j, k)) continue;
                const hole = carved.has(c);
                for (let d = 0; d < 6; d++) {
                    const ni = i + NB[d][0], nj = j + NB[d][1], nk = k + NB[d][2];
                    if (!isSolid(ni, nj, nk)) continue;
                    const lat = quad(i, j, k, d), pts = lat.map(q => V(q[0], q[1], q[2]));
                    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
                    if (dot(n, sub(V(i + 0.5, j + 0.5, k + 0.5), pts[0])) < 0) n = [-n[0], -n[1], -n[2]];
                    // edge-on faces (the camera sits right on a grid plane when centred) count as hidden
                    const toEye = sub(eye, pts[0]);
                    if (dot(n, toEye) <= 1e-6 * Math.hypot(toEye[0], toEye[1], toEye[2])) continue;
                    const type = hole ? T_DOOR : nk >= Dt ? T_FLOOR : blocks.get(key(wrap(ni), nj, nk)) || T_WALL;
                    // A block face seen almost edge-on would only add a second line a hair
                    // from the first, so treat it as hidden. Walls keep theirs, the grid
                    // lines on them thin out separately.
                    if (type === T_STAIR || type === T_LAND) {
                        const q = pts.map(P => cam.project(P[0], P[1], P[2]));
                        let long = 0;
                        for (let e = 0; e < 4; e++) long = Math.max(long, geo.dist(q[e], q[(e + 1) % 4]));
                        if (Math.abs(geo.polygonArea(q)) < 0.3 * long) continue;
                    }
                    const face = { pts, n, type, d, wet: pool && k >= Dm };
                    faces.push(face);
                    for (let e = 0; e < 4; e++) {
                        const a = lat[e], b = lat[(e + 1) % 4];
                        const ax = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2, s = a[ax] < b[ax] ? a : b;
                        const ek = key(wrap(s[0]), s[1], s[2]) * 3 + ax, rec = edges.get(ek);
                        if (rec) rec.f.push(face);
                        else edges.set(ek, { p: [wrap(s[0]), s[1], s[2]], ax, f: [face] });
                    }
                }
            }

            // Which grid lines to keep. Creases always stay. Flat grid lines follow
            // the tile pattern and thin out once they crowd together on paper, a
            // bit sooner in a pool's reflection so it reads paler.
            const lod = (s, k) => {
                const gap = k > Dm && pool ? 1.7 * GAP : GAP;
                return s >= gap ? 1 : 1 << Math.min(12, Math.ceil(Math.log2(gap / s)));
            };
            const ringStep = k => lod(f * rim.clear * Math.abs(1 / dist(k) - 1 / dist(k + 1)), k);
            const colStep = k => lod(f / dist(k + 0.5), k + 0.5);
            const tileStep = k => lod(f / dist(k), k);
            const joint = (u, k) => p.pattern === 'brick' ? mod(u + k, 2) === 0 : p.pattern === 'ashlar' ? mod(u - 2 * Math.floor(k / 2), 4) === 0 : true;
            const course = k => p.pattern !== 'ashlar' || mod(k, 2) === 0;
            const dNear = dist(up ? Dm : 0), dFar = dist(up ? 0 : Dm);
            const band = k => Math.floor(5 * Math.log(dist(k) / dNear) / Math.log(dFar / dNear)) % 2 === 1;
            const medal = floorSolid ? (well.M ? well.Ra - w - 1 : well.size / 2 - w - 1.5) : 0;
            const kept = new Map(), loose = [];
            for (const [ek, e] of edges) {
                const fs = e.f, [i, j, k] = e.p;
                let type = 0;
                for (const x of fs) type = Math.max(type, x.type);
                const waterline = pool && k === Dm && e.ax !== 2;
                if (fs.length === 2 && dot(fs[0].n, fs[1].n) > 0.85 && !waterline) {
                    if (Math.abs(fs[0].n[2]) > 0.5) {
                        if (mod(e.ax === 0 ? j : i, tileStep(k)) !== 0) continue;
                    } else if (e.ax === 2) {
                        const u = fs[0].d < 2 ? j : i;
                        if (!joint(u, k) || mod(u, colStep(k)) !== 0) continue;
                    } else if (!course(k) || mod(up ? Dm - k : k, ringStep(k)) !== 0) continue;
                }
                let g = GROUP[type];
                if (g === WALL && band(e.ax === 2 ? k + 0.5 : k)) g = DEEP;
                if (waterline) g = FLOOR;
                else if (wet(k, e.ax)) g = REFLECT;
                // tiles stop at the edge of the compass rose
                if (type === T_FLOOR && medal > 2.5 && e.ax !== 2 && !well.M) {
                    const A = V(i, j, k), B = V(i + STEP[e.ax][0], j + STEP[e.ax][1], k), a = Math.hypot(A[0], A[1]) < medal, b = Math.hypot(B[0], B[1]) < medal;
                    if (a && b) continue;
                    if (a || b) {
                        const [P, Q] = a ? [B, A] : [A, B], dx = Q[0] - P[0], dy = Q[1] - P[1];
                        const qa = dx * dx + dy * dy, qb = P[0] * dx + P[1] * dy, qc = P[0] * P[0] + P[1] * P[1] - medal * medal;
                        const t = geo.clamp((-qb - Math.sqrt(Math.max(0, qb * qb - qa * qc))) / qa, 0, 1);
                        if (t > 1e-6) loose.push([g, [P, [P[0] + dx * t, P[1] + dy * t, P[2]]]]);
                        continue;
                    }
                }
                kept.set(ek, g);
            }
            for (const [g, pts] of loose) { S.kind = g; S.line(pts); }

            // join runs of kept edges into long lines
            const done = new Set();
            for (const [ek, g] of kept) {
                if (done.has(ek)) continue;
                const { ax } = edges.get(ek), [di, dj, dk] = STEP[ax];
                let [i, j, k] = edges.get(ek).p;
                for (let n = 0; n < 4096; n++) {
                    const b = key(wrap(i - di), j - dj, k - dk) * 3 + ax;
                    if (b === ek || kept.get(b) !== g || done.has(b)) break;
                    i -= di; j -= dj; k -= dk;
                }
                const pts = [V(i, j, k)];
                for (;;) {
                    const c = key(wrap(i), j, k) * 3 + ax;
                    if (kept.get(c) !== g || done.has(c)) break;
                    done.add(c);
                    i += di; j += dj; k += dk;
                    pts.push(V(i, j, k));
                }
                S.kind = g;
                S.line(pts);
            }

            // steps, landings and doorway insides hide what's behind them
            for (const fc of faces) if (fc.type >= T_STAIR) S.face(fc.pts, false);
            // and the wall around a doorway hides the parts of its inside you can't see
            for (const hl of holes) {
                const { wall } = hl;
                const c = wall.at(hl.a0 + hl.width / 2, 0), P = V(c[0], c[1], hl.k1);
                const e = wall.at(hl.a0 + hl.width / 2, -1), Q = V(e[0], e[1], hl.k1), inward = norm(sub(P, Q));
                const g = wall.at(hl.a0 + hl.width / 2 + 1, 0), along = norm(sub(V(g[0], g[1], hl.k1), P));
                const lat = Math.max(0.5, dot(sub(eye, P), inward)), side = Math.abs(dot(sub(eye, P), along)) + hl.width;
                const reach = Math.ceil(dist(up ? hl.k0 : hl.k1) * hl.depth / (lat + hl.depth)) + 1;
                const mo = Math.ceil(side * hl.depth / (lat + hl.depth)) + 1;
                const kA = up ? hl.k0 : Math.max(0, hl.k0 - reach), kB = up ? Math.min(Dt, hl.k1 + reach) : hl.k1;
                for (let a = hl.a0 - mo; a < hl.a0 + hl.width + mo; a++) {
                    const q = wall.at(a + 0.5, 0.5), ci = Math.floor(q[0]), cj = Math.floor(q[1]);
                    if (!well.inside(ci, cj)) continue;
                    const ws = wall.at(a + 0.5, -0.5), d = NB.findIndex(v => v[0] === Math.floor(ws[0]) - ci && v[1] === Math.floor(ws[1]) - cj);
                    const spans = a >= hl.a0 && a < hl.a0 + hl.width ? [[kA, hl.k0], [hl.k1, kB]] : [[kA, kB]];
                    for (const [k0, k1] of spans) {
                        if (k1 <= k0) continue;
                        // Overlap neighbouring strips a little. A reveal lying edge-on to the
                        // camera projects exactly onto their shared edge and would show through.
                        const lt = quad(ci, cj, k0, d), A = V(lt[0][0], lt[0][1], 0), B = V(lt[1][0], lt[1][1], 0);
                        const ex = (B[0] - A[0]) * 0.02, ey = (B[1] - A[1]) * 0.02;
                        S.face([[A[0] - ex, A[1] - ey, -k0], [B[0] + ex, B[1] + ey, -k0], [B[0] + ex, B[1] + ey, -k1], [A[0] - ex, A[1] - ey, -k1]], false);
                    }
                }
            }

            // hatching drawn evenly on paper, then lifted back onto its face
            const hatchFace = (fc, gap, ang) => {
                const q = fc.pts.map(P => cam.project(P[0], P[1], P[2]));
                if (Math.abs(geo.polygonArea(q)) < 0.05) return;
                for (const [a, b] of geo.hatch([q], gap, ang)) S.line([cam.lift(a[0], a[1], fc.n, fc.pts[0]), cam.lift(b[0], b[1], fc.n, fc.pts[0])]);
            };
            if (p.shade) {
                S.kind = SHADE;
                for (const fc of faces) {
                    if (fc.wet || (fc.type !== T_STAIR && fc.type !== T_LAND) || dot(fc.n, LIGHT) >= -0.1) continue;
                    hatchFace(fc, fc.n[2] < -0.5 ? 1.8 * HATCH : HATCH, geo.rad(45));
                }
            }
            S.kind = DOOR;
            for (const fc of faces) if (fc.type === T_DOOR && !fc.wet) { hatchFace(fc, HATCH, geo.rad(45)); hatchFace(fc, HATCH, geo.rad(-45)); }

            // handrails with a baluster on every step
            for (const rail of rails) {
                // right under the camera a rail would just be a few long lines across the page
                const pts = rail.filter(([, k]) => dist(k) - RAIL_H > 2.2 * h).map(([q, k, flip]) => {
                    const P = V(q[0], q[1], k);
                    return flip ? [P[0], P[1], -2 * Dm - P[2] - RAIL_H] : [P[0], P[1], P[2] + RAIL_H];
                });
                S.kind = rail[0][2] ? REFLECT : RAIL;
                if (pts.length > 1) S.line(pts);
                const drop = rail[0][2] ? RAIL_H : -RAIL_H;
                for (const P of pts) S.line([[P[0], P[1], P[2] + drop], P]);
            }

            // the bottom
            if (!up && p.bottom === 'void') {
                const sp = GAP * dist(Dm) / f;
                S.kind = FLOOR;
                if (p.section === 'round') {
                    // a smooth spiral, the polygon one leaves a radial seam of tiny steps
                    const R0 = well.Ra - sp, turns = Math.floor(R0 / sp), pts = [];
                    for (let t = 0; t <= turns * 96; t++) {
                        const a = TAU * t / 96, r = R0 - sp * t / 96;
                        pts.push([r * Math.cos(a), r * Math.sin(a), -Dm]);
                    }
                    if (pts.length > 1) S.line(pts);
                } else {
                    const poly = geo.insetConvex(well.outline, sp);
                    if (poly.length) S.line(geo.insetSpiral(poly, sp).map(q => [q[0], q[1], -Dm]));
                }
            }
            S.kind = FLOOR;
            if (medal > 2.5) compass(S, medal, -Dm, HATCH * dist(Dm) / f, !well.M);
            if (pool) {
                // rings spreading from a drop somewhere in the open water
                const open = Math.max(1, well.size / 2 - w - 1), a = rng.range(0, TAU), r = rng.range(0, 0.5) * open;
                const cx = r * Math.cos(a), cy = r * Math.sin(a), inside = geo.insetConvex(well.outline, 0.05);
                for (let rr = 0.7; rr < 1.5 * well.size; rr *= 1.5) {
                    const n = Math.max(24, Math.ceil(rr * 12)), run = [];
                    for (let t = 0; t <= n; t++) {
                        const q = [cx + rr * Math.cos(TAU * t / n), cy + rr * Math.sin(TAU * t / n)];
                        if (geo.pointInPolygon(q[0], q[1], inside)) run.push([q[0], q[1], -Dm]);
                        else { if (run.length > 1) S.line(run); run.length = 0; }
                    }
                    if (run.length > 1) S.line(run);
                }
            }

            const out = PG.iso.render(S), map = MAPS[pens - 1];
            // the reflection breaks up like light on moving water
            if (out[REFLECT]) out[FLOOR] = (out[FLOOR] || []).concat(dashes(out[REFLECT]));
            for (let g = 0; g < 8; g++) for (const path of out[g] || []) layers[map[g]].push(path);
            return { layers };
        },
    });
})();
