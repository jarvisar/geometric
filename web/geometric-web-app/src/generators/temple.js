/*
 * Temple Garden: a walled Japanese temple garden, drawn in the same
 * isometric scene as Castle Town and Farmland (lib/iso.js).
 *
 * The garden is planned in meters on a patch of ground shaped like the page,
 * so the view width only moves the camera. The hall stands along one of the
 * two back walls with its veranda to the garden, and the gate faces it
 * across the gravel.
 *
 * The ground is a set of distance fields (see Ground). The land field is how
 * far a point is into the gravel from the nearest shore: a wall, the stone
 * edging of a building, the moss along the walls, the pond. The island field
 * is the distance to the nearest island of moss and rock. The rake lines are
 * isolines of those fields: rings round each island, lines along the shore,
 * and the open pattern everywhere else, which stops on the outermost ring.
 * Shadows on the gravel are the same lines again, half a spacing over.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { hash, makeCamera, frame, card, ring, Scene, segments, hull, newell } = PG.iso;
    const kit = PG.isokit;
    const { inKind, withKind, unit } = kit;

    // Line kinds, in the order of the parts in pens.js
    const INK = 0, GRAVEL = 1, MOSS = 2, MAPLE = 3, SHADOW = 4, ROOF = 5, WATER = 6, FIGURE = 7, WOOD = 8;
    // Lines closer than this on paper (mm) run together under a 0.35 mm pen
    const FINE = 0.7;
    // The garden is planned for this view size, with the camera at this height
    const SIZE0 = 44, SE0 = Math.sin(geo.rad(40));
    // How tall an upright page is for its width (A4 inside its margins). The view size is
    // the ground across such a page. A wider page shows the same depth and more to the sides.
    const UPRIGHT = 267 / 180;
    const viewScale = (W, H, size) => Math.min(W / size, H / (size * UPRIGHT));
    // About how far apart the rake lines are on the ground at that view (m). Islands are spaced by it.
    const RAKE0 = 0.45;
    // The ground's fields are only read this close to a shore (m). Further out a lower bound will do.
    const FAR = 9;
    // Radius of a mound of gravel at its foot (m)
    const CONE = 1.25;
    const UP = [0, 0, 1];
    const { lerp, clamp } = geo;
    const smooth = geo.smoothstep;

    // Paper distance (mm) between two lines along world vector a that are
    // world vector b apart
    function apart(T, a, b) {
        const c = T.cam, on = v => [v[0] * c.rx + v[1] * c.ry, (v[0] * c.fx + v[1] * c.fy) * c.se + (v[2] || 0) * c.ce];
        const p = on(a), q = on(b);
        return (c.k * Math.abs(p[0] * q[1] - p[1] * q[0])) / (Math.hypot(p[0], p[1]) || 1);
    }

    // ------------------------------------------------------------------
    // Flat geometry
    // ------------------------------------------------------------------

    const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const grow = ([x0, y0, x1, y1], d) => [x0 - d, y0 - d, x1 + d, y1 + d];
    const at3 = (pts, z) => pts.map(([x, y]) => [x, y, z]);

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

    // Distance to a rectangle, negative inside
    function sdRect(r, x, y) {
        const dx = Math.max(r[0] - x, x - r[2]), dy = Math.max(r[1] - y, y - r[3]);
        return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
    }

    // Distance to a polygon (open vertex list), negative inside
    function sdPoly(poly, x, y) {
        let d = Infinity, inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[j], b = poly[i], ex = b[0] - a[0], ey = b[1] - a[1];
            const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
            const dx = x - a[0] - ex * t, dy = y - a[1] - ey * t, q = dx * dx + dy * dy;
            if (q < d) d = q;
            if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside ? -Math.sqrt(d) : Math.sqrt(d);
    }

    function distToPath(pts, x, y) {
        let best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1];
            const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
            const d = Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t);
            if (d < best) best = d;
        }
        return best;
    }

    // Union of two distance fields with the crease between them rounded off over k
    const smin = (a, b, k) => {
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        return Math.min(a, b) - h * h * k * 0.25;
    };

    // A closed blob round (cx, cy): radius r, stretched by `long` along angle rot
    function blob(cx, cy, r, long, rot, rng, n = 36, rough = 1) {
        const a2 = 0.16 * rough * rng.range(0.4, 1), a3 = 0.11 * rough * rng.range(0.3, 1), a5 = 0.05 * rough * rng.range(0, 1);
        const p2 = rng.range(0, TAU), p3 = rng.range(0, TAU), p5 = rng.range(0, TAU);
        const c = Math.cos(rot), s = Math.sin(rot), out = [];
        for (let i = 0; i < n; i++) {
            const t = (TAU * i) / n, rr = r * (1 + a2 * Math.cos(2 * t + p2) + a3 * Math.cos(3 * t + p3) + a5 * Math.cos(5 * t + p5));
            const u = rr * long * Math.cos(t), v = (rr / long) * Math.sin(t);
            out.push([cx + u * c - v * s, cy + u * s + v * c]);
        }
        return out;
    }

    // The pieces of a plan polyline where ok(x, y) holds. It's tested every
    // `step` meters and the ends of each piece are found by bisection.
    function pieces(pts, ok, step) {
        const out = [];
        let run = [], px = 0, py = 0, prevOk = false, first = true;
        const visit = (x, y, vertex) => {
            const good = ok(x, y);
            if (!first && good !== prevOk) {
                let lo = 0, hi = 1;
                for (let k = 0; k < 9; k++) {
                    const m = (lo + hi) / 2;
                    if (ok(lerp(px, x, m), lerp(py, y, m)) === prevOk) lo = m; else hi = m;
                }
                const t = prevOk ? lo : hi;
                run.push([lerp(px, x, t), lerp(py, y, t)]);
                if (prevOk) {
                    if (run.length > 1) out.push(run);
                    run = [];
                }
            }
            if (good && vertex) run.push([x, y]);
            px = x; py = y; prevOk = good; first = false;
        };
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
            for (let k = 0; k < n; k++) visit(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), k === 0);
        }
        const e = pts[pts.length - 1];
        visit(e[0], e[1], true);
        if (run.length > 1) out.push(run);
        return out;
    }

    // Where things stand, so nothing is put down on top of something else
    class Claims {
        constructor() { this.c = []; }
        free(x, y, r) { return !this.c.some(q => Math.hypot(q[0] - x, q[1] - y) < q[2] + r); }
        take(x, y, r) { this.c.push([x, y, r]); }
    }

    // ------------------------------------------------------------------
    // Values on a grid over a rectangle of ground
    // ------------------------------------------------------------------

    class Grid {
        constructor([x0, y0, x1, y1], cell) {
            this.x0 = x0;
            this.y0 = y0;
            this.nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1);
            this.ny = Math.max(2, Math.ceil((y1 - y0) / cell) + 1);
            this.dx = (x1 - x0) / (this.nx - 1);
            this.dy = (y1 - y0) / (this.ny - 1);
        }
        fill(fn) {
            const { nx, ny, x0, y0, dx, dy } = this, v = new Float32Array(nx * ny);
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = fn(x0 + i * dx, y0 + j * dy);
            return v;
        }
        // The same for a field that's about a distance, which is only read
        // between lo and hi: every fourth point is worked out, and the ones
        // between them too unless the four round them are all well out of
        // that range, where they're interpolated instead.
        fillNear(fn, lo, hi) {
            const { nx, ny, x0, y0, dx, dy } = this, v = new Float32Array(nx * ny), done = new Uint8Array(nx * ny), st = 4, slack = 1.5 * st * Math.hypot(dx, dy);
            const exact = (i, j) => { v[j * nx + i] = fn(x0 + i * dx, y0 + j * dy); done[j * nx + i] = 1; };
            const is = [], js = [];
            for (let i = 0; i < nx - 1; i += st) is.push(i);
            is.push(nx - 1);
            for (let j = 0; j < ny - 1; j += st) js.push(j);
            js.push(ny - 1);
            for (const j of js) for (const i of is) exact(i, j);
            for (let b = 0; b + 1 < js.length; b++) {
                for (let a = 0; a + 1 < is.length; a++) {
                    const i0 = is[a], i1 = is[a + 1], j0 = js[b], j1 = js[b + 1];
                    const c00 = v[j0 * nx + i0], c10 = v[j0 * nx + i1], c01 = v[j1 * nx + i0], c11 = v[j1 * nx + i1];
                    const far = Math.min(c00, c10, c01, c11) > hi + slack || Math.max(c00, c10, c01, c11) < lo - slack;
                    for (let j = j0; j <= j1; j++) {
                        for (let i = i0; i <= i1; i++) {
                            const o = j * nx + i;
                            if (done[o]) continue;
                            if (!far) { exact(i, j); continue; }
                            const s = (i - i0) / (i1 - i0), t = (j - j0) / (j1 - j0);
                            v[o] = (c00 * (1 - s) + c10 * s) * (1 - t) + (c01 * (1 - s) + c11 * s) * t;
                            done[o] = 1;
                        }
                    }
                }
            }
            return v;
        }
        // The same for a smooth field such as a distance: every fourth point
        // is worked out, and the ones between them too unless a few of them
        // come out within tol of the blend of the four round them. Where the
        // field creases, as halfway between two islands, they're all worked out.
        fillSmooth(fn, tol) {
            const { nx, ny, x0, y0, dx, dy } = this, v = new Float32Array(nx * ny), done = new Uint8Array(nx * ny), st = 4;
            const exact = (i, j) => {
                const o = j * nx + i;
                if (!done[o]) { v[o] = fn(x0 + i * dx, y0 + j * dy); done[o] = 1; }
                return v[o];
            };
            const is = [], js = [];
            for (let i = 0; i < nx - 1; i += st) is.push(i);
            is.push(nx - 1);
            for (let j = 0; j < ny - 1; j += st) js.push(j);
            js.push(ny - 1);
            for (let b = 0; b + 1 < js.length; b++) {
                for (let a = 0; a + 1 < is.length; a++) {
                    const i0 = is[a], i1 = is[a + 1], j0 = js[b], j1 = js[b + 1];
                    const c00 = exact(i0, j0), c10 = exact(i1, j0), c01 = exact(i0, j1), c11 = exact(i1, j1);
                    const blend = (i, j) => {
                        const s = (i - i0) / (i1 - i0), t = (j - j0) / (j1 - j0);
                        return (c00 * (1 - s) + c10 * s) * (1 - t) + (c01 * (1 - s) + c11 * s) * t;
                    };
                    let smooth = i1 - i0 > 2 && j1 - j0 > 2 && [c00, c10, c01, c11].every(Number.isFinite);
                    for (const [i, j] of [[(i0 + i1) >> 1, (j0 + j1) >> 1], [i0 + 1, j1 - 1], [i1 - 1, j0 + 1]]) {
                        if (!smooth) break;
                        if (Math.abs(exact(i, j) - blend(i, j)) > tol) smooth = false;
                    }
                    for (let j = j0; j <= j1; j++) {
                        for (let i = i0; i <= i1; i++) {
                            const o = j * nx + i;
                            if (done[o]) continue;
                            if (smooth) { v[o] = blend(i, j); done[o] = 1; } else exact(i, j);
                        }
                    }
                }
            }
            return v;
        }
        // for PG.isolines
        field(values) { return { values, nx: this.nx, ny: this.ny, x0: this.x0, y0: this.y0, dx: this.dx, dy: this.dy }; }
        // values between the grid points, `out` beyond the grid
        sampler(v, out = -1) {
            const { nx, ny, x0, y0, dx, dy } = this;
            return (x, y) => {
                const fx = (x - x0) / dx, fy = (y - y0) / dy;
                if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return out;
                const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), s = fx - i, t = fy - j, o = j * nx + i;
                return (v[o] * (1 - s) + v[o + 1] * s) * (1 - t) + (v[o + nx] * (1 - s) + v[o + nx + 1] * s) * t;
            };
        }
    }

    // ------------------------------------------------------------------
    // The ground
    // ------------------------------------------------------------------

    // What's gravel and what isn't. land(x, y) is how far into the gravel a
    // point is from the nearest shore (negative on the shore side), and
    // isle(x, y) how far it is from the nearest island.
    class Ground {
        constructor(rect) {
            this.rect = rect;
            this.solids = [];   // rectangles the gravel stops at: buildings on their stone edging
            this.mossy = [];    // fields, negative where moss grows
            this.clear = [];    // rectangles kept clear of moss
            this.paths = [];    // { pts, hw }: stepping stones across the gravel
            this.water = null;  // field, negative in the pond
            this.islands = [];  // { poly, box, c, r }
            this.discs = [];    // [x, y, r]: mounds of gravel
            this.round = 1.6;   // how far the moss fields run into one another (m)
        }
        // negative in the moss along the walls and in the corners
        moss(x, y) {
            let m = 1e6;
            for (const f of this.mossy) {
                // a grove whose edge is no nearer than m plus the rounding can't change m
                if (f.c && Math.hypot(x - f.c[0], y - f.c[1]) - f.R >= m + this.round) continue;
                m = smin(m, f(x, y), this.round);
            }
            for (const c of this.clear) m = Math.max(m, -sdRect(c, x, y));
            return m;
        }
        // how far inside the walls, less the buildings
        open(x, y) {
            const r = this.rect;
            let d = Math.min(x - r[0], r[2] - x, y - r[1], r[3] - y);
            for (const s of this.solids) d = Math.min(d, sdRect(s, x, y));
            for (const q of this.paths) {
                const near = sdRect(q.box, x, y);
                d = Math.min(d, near > FAR ? near : distToPath(q.pts, x, y) - q.hw);
            }
            if (this.water) d = Math.min(d, this.water(x, y));
            for (const [cx, cy, r] of this.discs) d = Math.min(d, Math.hypot(x - cx, y - cy) - r);
            return d;
        }
        land(x, y) { return Math.min(this.open(x, y), this.moss(x, y)); }
        addIsland(poly, extra = {}) {
            const b = bounds(poly), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
            let r = 0;
            for (const q of poly) r = Math.max(r, Math.hypot(q[0] - c[0], q[1] - c[1]));
            const isle = { poly, c, r, ...extra };
            this.islands.push(isle);
            return isle;
        }
        isle(x, y, cap = Infinity) {
            let best = cap;
            // the nearest outline is no further away than an island's middle plus its radius
            for (const I of this.islands) {
                const u = Math.hypot(x - I.c[0], y - I.c[1]) + I.r;
                if (u < best) best = u;
            }
            for (const I of this.islands) {
                if (Math.hypot(x - I.c[0], y - I.c[1]) - I.r >= best) continue;
                const d = sdPoly(I.poly, x, y);
                if (d < best) best = d;
            }
            return best;
        }
    }

    // ------------------------------------------------------------------
    // Raked gravel
    // ------------------------------------------------------------------

    // Lay a plan polyline on the gravel
    const GZ = 0.02;
    function lay(T, pts) {
        if (pts.length > 1) T.S.line(pts.map(q => [q[0], q[1], GZ]));
    }

    // The open pattern: every line of it as a plan polyline, `phase` spacings
    // over from where the pattern starts. Clipped afterwards.
    function openPattern(T, plan, phase) {
        const { p } = T, s = T.rakeS, [x0, y0, x1, y1] = plan.rect;
        const ang = plan.rakeAngle, d = [Math.cos(ang), Math.sin(ang)], n = [-d[1], d[0]];
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + s;
        const at = (u, v) => [cx + u * d[0] + v * n[0], cy + u * d[1] + v * n[1]];
        const out = [], J = Math.ceil(R / s);
        if (p.rake === 'waves') {
            const wl = p.wave, amp = wl * 0.09, step = wl / 16;
            for (let j = -J; j <= J; j++) {
                const line = [];
                for (let u = -R; u <= R + 1e-9; u += step) line.push(at(u, (j + phase) * s + amp * Math.sin((TAU * u) / wl)));
                out.push(line);
            }
        } else if (p.rake === 'checks') {
            // squares of lines turned a quarter turn from their neighbors
            const m = Math.max(3, Math.round(p.check / s)), c = m * s, K = Math.ceil(R / c) + 1;
            for (let i = -K; i < K; i++) {
                for (let j = -K; j < K; j++) {
                    for (let q = 0; q < m; q++) {
                        const o = (q + 0.5 + phase) * s;
                        if (o > c - 1e-6) continue;
                        if ((i + j) & 1) out.push([at(i * c, j * c + o), at((i + 1) * c, j * c + o)]);
                        else out.push([at(i * c + o, j * c), at(i * c + o, (j + 1) * c)]);
                    }
                }
            }
        } else if (p.rake === 'scallops') {
            // Overlapping fans, each hidden by the two rows in front of it
            const m = Math.max(2, Math.round(p.check / (2 * s))), Rf = m * s, K = Math.ceil(R / (Rf / 2)) + 2, I = Math.ceil(R / (2 * Rf)) + 1;
            const centre = (i, j) => [(2 * i + (j & 1)) * Rf, j * Rf * 0.5];
            for (let j = -K; j <= K; j++) {
                for (let i = -I; i <= I; i++) {
                    const [u0, v0] = centre(i, j);
                    // the fans in front that cover this one
                    const front = [[u0 - Rf, v0 - Rf / 2], [u0 + Rf, v0 - Rf / 2], [u0, v0 - Rf]];
                    for (let q = 1; q <= m; q++) {
                        const r = (q - phase) * s;
                        if (r < s * 0.4) continue;
                        const arc = [];
                        const steps = Math.max(8, Math.ceil((Math.PI * r) / (s * 0.5)));
                        for (let a = 0; a <= steps; a++) {
                            const t = (Math.PI * a) / steps;
                            arc.push([u0 + r * Math.cos(t), v0 + r * Math.sin(t)]);
                        }
                        const seen = pieces(arc, (u, v) => front.every(f => Math.hypot(u - f[0], v - f[1]) > Rf + 1e-6), s * 0.25);
                        for (const part of seen) out.push(part.map(([u, v]) => at(u, v)));
                    }
                }
            }
        } else if (p.rake === 'straight') {
            for (let j = -J; j <= J; j++) out.push([at(-R, (j + phase) * s), at(R, (j + phase) * s)]);
        }
        return out;
    }

    // The ground's fields sampled once over the part of the garden in view.
    // Everything laid on the ground afterwards reads them from here. Small
    // pockets of gravel shut in by moss are left unraked, as bare patches in
    // the moss: a few rake lines in a hole a meter across are only clutter.
    function survey(T, plan) {
        const { p } = T, G = plan.ground, s = T.rakeS, r = plan.rect;
        const view = bounds([[0, 0], [T.W, 0], [T.W, T.H], [0, T.H]].map(([x, y]) => T.cam.ground(x, y)));
        const box = [Math.max(r[0], view[0] - 3), Math.max(r[1], view[1] - 3), Math.min(r[2], view[2] + 3), Math.min(r[3], view[3] + 3)];
        if (box[2] - box[0] < 1 || box[3] - box[1] < 1) return null;
        const grid = new Grid(box, clamp(0.75 / T.k, 0.12, Math.max(0.12, s * 0.5))), { nx, ny } = grid;
        const ripples = p.rake === 'ripples', reach = ripples ? Infinity : (Math.max(p.rings, p.border) + 1.5) * s + 1;
        // Nothing reads these further from a shore than the lines along it
        // reach, except for ripples, which run all the way across
        const lo = -1.5, hi = p.border * s + 2, tol = 0.15 / T.k;
        const fill = fn => (ripples ? grid.fillSmooth(fn, tol) : grid.fillNear(fn, lo, hi));
        const open = fill((x, y) => G.open(x, y)), moss = fill((x, y) => G.moss(x, y));
        const isle = grid.fillSmooth((x, y) => G.isle(x, y, reach), tol), land = open.map((v, i) => Math.min(v, moss[i]));
        const n = nx * ny, gravel = i => land[i] > 0 && isle[i] > 0;
        // Gravel too narrow for more than a line or two is left plain: a neck
        // between a hall and the moss, a sliver along a wall. A point is in
        // the open if it's within reach of gravel that's a good way from
        // every shore, by a distance swept across the grid.
        const wideAt = 2.6 * s, far = new Float32Array(n).fill(1e6), d1 = grid.dx, d2 = Math.hypot(grid.dx, grid.dy), bare = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (land[i] > wideAt) far[i] = 0;
        const relax = (i, q, d) => { if (far[q] + d < far[i]) far[i] = far[q] + d; };
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const c = j * nx + i;
                if (!(land[c] > 0)) continue;
                if (i > 0) relax(c, c - 1, d1);
                if (j > 0) { relax(c, c - nx, d1); if (i > 0) relax(c, c - nx - 1, d2); if (i < nx - 1) relax(c, c - nx + 1, d2); }
            }
        }
        for (let j = ny - 1; j >= 0; j--) {
            for (let i = nx - 1; i >= 0; i--) {
                const c = j * nx + i;
                if (!(land[c] > 0)) continue;
                if (i < nx - 1) relax(c, c + 1, d1);
                if (j < ny - 1) { relax(c, c + nx, d1); if (i < nx - 1) relax(c, c + nx + 1, d2); if (i > 0) relax(c, c + nx - 1, d2); }
            }
        }
        for (let i = 0; i < n; i++) if (land[i] > 0 && far[i] > wideAt * 1.15) bare[i] = 1;
        // What's left, flooded from each unvisited point of it. A small patch
        // cut off from the rest is moss if moss shuts it in, and plain if not.
        const mark = new Int32Array(n), pocket = new Uint8Array(n), stack = [], parts = [];
        for (let start = 0; start < n; start++) {
            if (mark[start] || bare[start] || !gravel(start)) continue;
            const cells = [];
            let edge = false, hard = false;
            mark[start] = 1;
            stack.push(start);
            while (stack.length) {
                const c = stack.pop(), i = c % nx, j = (c - i) / nx;
                cells.push(c);
                if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) edge = true;
                for (const q of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1]) {
                    if (q < 0 || mark[q]) continue;
                    if (bare[q] || open[q] <= 0) hard = true;
                    else if (gravel(q)) { mark[q] = 1; stack.push(q); }
                }
            }
            parts.push({ cells, edge, hard });
        }
        const most = Math.max(0, ...parts.map(q => q.cells.length)), small = Math.max(70 / (grid.dx * grid.dy), most * 0.06);
        for (const q of parts) {
            // gravel that runs off the survey is cut by the view, not shut in
            if (q.edge || q.cells.length >= small) continue;
            for (const c of q.cells) { if (q.hard) bare[c] = 1; else { pocket[c] = 1; land[c] = -0.2; } }
        }
        const flags = v => (x, y) => {
            const i = clamp(Math.floor((x - grid.x0) / grid.dx), 0, nx - 2), j = clamp(Math.floor((y - grid.y0) / grid.dy), 0, ny - 2), o = j * nx + i;
            return v[o] + v[o + 1] + v[o + nx] + v[o + nx + 1];
        };
        const near = flags(pocket), plain = flags(bare);
        return {
            grid, box, land, isle, moss, open,
            landAt: grid.sampler(land), isleAt: grid.sampler(isle, 1e6), mossAt: grid.sampler(moss, 1), openAt: grid.sampler(open),
            // touching a pocket, and right inside one
            byPocket: (x, y) => near(x, y) > 0, inPocket: (x, y) => near(x, y) === 4,
            // gravel that's left unraked
            bare: (x, y) => plain(x, y) > 1,
        };
    }

    // Rake the gravel: rings round the islands, lines along the shore and the
    // open pattern between them. With `shade` set, the lines half a spacing
    // over are laid as well, wherever shade(x, y) holds.
    function rake(T, plan, F, shade) {
        const { S, p } = T, s = T.rakeS, { grid, land, isle, landAt, isleAt } = F;
        const ripples = p.rake === 'ripples';
        const M = p.border, N = p.rings;
        const both = land.map((v, i) => Math.min(v, isle[i])), bothAt = grid.sampler(both);
        // ripples are lines along the shores and round the islands as far out as the gravel goes
        const shoreLines = ripples ? Math.floor(both.reduce((m, v) => (v < 1e5 && v > m ? v : m), 0) / s) + 1 : M;
        const step = grid.dx;
        const pass = (phase, also) => {
            const keep = also ? (x, y) => !F.bare(x, y) && also(x, y) : (x, y) => !F.bare(x, y);
            // scraps too short to read as lines are left out, like the dot a ring shrinks to between islands
            const emit = (lines, ok, least) => {
                for (const line of lines) for (const part of pieces(line, ok, step)) if (geo.pathLength(part) * T.k > least) lay(T, part);
            };
            // lines along every shore, which join up with the islands' rings
            for (let j = 1; j <= shoreLines; j++) emit(PG.isolines(grid.field(both), (j - phase) * s), keep, 3);
            if (ripples) return;
            // the rest of the rings, as far as the shore's lines
            const edge = M * s;
            for (let j = M + 1; j <= N; j++) emit(PG.isolines(grid.field(isle), (j - phase) * s), (x, y) => landAt(x, y) > edge && keep(x, y), 3);
            // and the open gravel, which stops at the outermost line round each island
            const far = Math.max(N, M) * s;
            emit(openPattern(T, plan, phase), (x, y) => landAt(x, y) > edge && isleAt(x, y) > far && bothAt(x, y) > 0 && keep(x, y), 1.2);
        };
        S.kind = GRAVEL;
        pass(0, null);
        if (shade) {
            S.kind = SHADOW;
            pass(0.5, shade);
        }
    }

    // ------------------------------------------------------------------
    // Curved roofs
    // ------------------------------------------------------------------

    // A mesh of flat faces drawn like a solid: creases and outlines show, and
    // the edges inside a smoothing group only where the surface turns away
    // from us. hints[i] points roughly out of face i, to orient it by, since
    // a roof with its corners turned up isn't convex.
    function shell(T, verts, faces, groups, hints) {
        const S = T.S, cam = T.cam;
        if (S.shadow) S.castShadow(verts);
        const front = faces.map((f, i) => {
            const pts = f.map(v => verts[v]), h = hints[i];
            let n = newell(pts);
            if (n[0] * h[0] + n[1] * h[1] + n[2] * h[2] < 0) n = [-n[0], -n[1], -n[2]];
            const on = cam.facing(n[0], n[1], n[2]);
            if (on) S.face(pts, false);
            return on;
        });
        const edges = new Map();
        faces.forEach((f, fi) => {
            for (let i = 0; i < f.length; i++) {
                const a = f[i], b = f[(i + 1) % f.length], key = a < b ? a * 65536 + b : b * 65536 + a;
                const e = edges.get(key);
                if (e) e.push(fi);
                else edges.set(key, [a, b, fi]);
            }
        });
        for (const [a, b, f1, f2] of edges.values()) {
            let draw;
            if (f2 === undefined) draw = front[f1];
            else if (groups[f1] > 0 && groups[f1] === groups[f2]) draw = front[f1] !== front[f2];
            else draw = front[f1] || front[f2];
            if (draw) S.line([verts[a], verts[b]]);
        }
    }

    // A tiled roof over the rectangle r ([a0, b0, a1, b1] in frame F, the line
    // of the eaves), with its ridge along the longer side. The slopes are
    // hollow, steeper towards the ridge, and the eaves turn up at the corners.
    // o.gable is how far in from the end eaves the gables stand: 0 is a plain
    // gable roof, half the width (the default) is a hip roof, and anything
    // between is a hip-and-gable. o.seat = [inset, z] sets the eaves so the
    // roof passes through height z that far in from them, on top of a wall.
    // Tile lines run down the slopes when the scene hatches its roofs.
    function curvedRoof(T, F, r, zEave, o = {}) {
        const S = T.S;
        let A = (r[2] - r[0]) / 2, B = (r[3] - r[1]) / 2;
        const ca = (r[0] + r[2]) / 2, cb = (r[1] + r[3]) / 2, turn = B > A + 1e-6;
        if (turn) [A, B] = [B, A];
        const P = turn ? (a, b, c) => F.P(ca + b, cb + a, c) : (a, b, c) => F.P(ca + a, cb + b, c);
        const V = turn ? (a, b, c) => F.V(b, a, c) : (a, b, c) => F.V(a, b, c);
        const rise = o.rise === undefined ? B * 0.8 : o.rise;
        const g = o.gable === undefined ? B : clamp(o.gable, 0, B);
        const lift = o.lift === undefined ? 0.5 : o.lift;
        // how far along the eaves, and up the slope, the corners turn up
        const q0 = Math.min(o.sweep || 4.5, A * 0.95), t0 = g > 1e-6 ? Math.min(q0, g) : B;
        const c1 = o.flat === undefined ? 0.42 : o.flat;
        const hgt = t => rise * (c1 * (t / B) + (1 - c1) * (t / B) ** 2);
        const z = o.seat ? o.seat[1] - hgt(o.seat[0]) : zEave;
        const up = (q, t) => lift * Math.max(0, 1 - q / q0) ** 2 * Math.max(0, 1 - t / t0) ** 2;
        // a point on a long slope (side sb) at a along the ridge and t in from the eave, and the same on an end slope
        const main = (a, sb, t) => [a, sb * (B - t), z + hgt(t) + up(A - Math.abs(a), t)];
        const end = (sa, b, t) => [sa * (A - t), b, z + hgt(t) + up(B - Math.abs(b), t)];

        // levels up the slope, with one where the gables start
        const nl = clamp(Math.round((B * T.k) / 2.2), 3, 7), levels = Array.from({ length: nl + 1 }, (_, i) => (B * i) / nl);
        if (g > 1e-6 && g < B - 1e-6) {
            let near = 0;
            levels.forEach((t, i) => { if (Math.abs(t - g) < Math.abs(levels[near] - g)) near = i; });
            if (near > 0 && near < nl && Math.abs(levels[near] - g) < (0.35 * B) / nl) levels[near] = g;
            else { levels.push(g); levels.sort((u, v) => u - v); }
        }
        // extra points along the eaves where they turn up
        const cols = half => (lift > 0 ? [-1, -0.66, -0.33] : []).flatMap(c => [-(half + q0 * c), half + q0 * c]).filter(c => Math.abs(c) < half && Math.abs(c) > 1e-6).concat([0]).sort((u, v) => u - v);
        const verts = [], ids = new Map(), faces = [], groups = [], hints = [];
        const vidW = w => {
            const key = `${Math.round(w[0] * 2000)},${Math.round(w[1] * 2000)},${Math.round(w[2] * 2000)}`;
            let i = ids.get(key);
            if (i === undefined) { i = verts.length; verts.push(w); ids.set(key, i); }
            return i;
        };
        const vid = q => vidW(P(q[0], q[1], q[2]));
        const add = (f, grp, hint) => {
            const u = f.filter((v, i) => v !== f[(i + 1) % f.length]);
            if (u.length >= 3) { faces.push(u); groups.push(grp); hints.push(hint); }
        };
        const row = (half, list, pt) => {
            const xs = half < 1e-6 ? [0] : [-half, ...list.filter(c => Math.abs(c) < half - 1e-3), half];
            return { xs, ids: xs.map(x => vid(pt(x))) };
        };
        // triangles between two rows of points
        const stitch = (lo, hi, grp, hint) => {
            let i = 0, j = 0;
            while (i < lo.xs.length - 1 || j < hi.xs.length - 1) {
                const canI = i < lo.xs.length - 1, canJ = j < hi.xs.length - 1;
                if (canI && (!canJ || lo.xs[i + 1] <= hi.xs[j + 1])) { add([lo.ids[i], lo.ids[i + 1], hi.ids[j]], grp, hint); i++; }
                else { add([lo.ids[i], hi.ids[j + 1], hi.ids[j]], grp, hint); j++; }
            }
        };
        const up3 = V(0, 0, 1), colsA = cols(A), colsB = cols(B), eaves = [];
        for (const sb of [-1, 1]) {
            const rows = levels.map(t => row(A - Math.min(t, g), colsA, a => main(a, sb, t)));
            for (let j = 0; j + 1 < rows.length; j++) stitch(rows[j], rows[j + 1], sb < 0 ? 1 : 2, up3);
            eaves.push([rows[0], V(0, sb, 0)]);
        }
        if (g > 1e-6) {
            const lv = levels.filter(t => t <= g + 1e-6);
            for (const sa of [-1, 1]) {
                const rows = lv.map(t => row(B - t, colsB, b => end(sa, b, t)));
                for (let j = 0; j + 1 < rows.length; j++) stitch(rows[j], rows[j + 1], sa < 0 ? 3 : 4, up3);
                eaves.push([rows[0], V(sa, 0, 0)]);
            }
        }
        // the gables, in upright slices
        const zb = g > 1e-6 ? z + hgt(g) : z + up(0, 0);
        if (g < B - 1e-6) {
            const lv = levels.filter(t => t >= g - 1e-6);
            for (const sa of [-1, 1]) {
                const a = sa * (A - g);
                for (let j = 0; j + 1 < lv.length; j++) {
                    for (const sb of [-1, 1]) {
                        add([vid([a, sb * (B - lv[j]), zb]), vid([a, sb * (B - lv[j + 1]), zb]), vid(main(a, sb, lv[j + 1])), vid(main(a, sb, lv[j]))], sa < 0 ? 5 : 6, V(sa, 0, 0));
                    }
                }
            }
        }
        // the thickness of the eaves
        const fas = o.fascia === undefined ? 0.3 : o.fascia;
        if (fas > 0) {
            eaves.forEach(([rw, out], e) => {
                for (let i = 0; i + 1 < rw.ids.length; i++) {
                    const p = verts[rw.ids[i]], q = verts[rw.ids[i + 1]];
                    add([rw.ids[i], rw.ids[i + 1], vidW([q[0], q[1], q[2] - fas]), vidW([p[0], p[1], p[2] - fas])], 7 + e, out);
                }
            });
        }
        shell(T, verts, faces, groups, hints);

        const R = { P, V, A, B, g, z, rise, ridge: z + rise, half: A - g, main, end, hgt, zb };
        // tile lines down the slopes, closer together on the slopes out of the sun
        if (T.tones && o.tiles !== false) {
            const LIFT = 0.03;
            const run = (pts, along) => {
                let cur = [];
                for (let i = 0; i + 1 < pts.length; i++) {
                    const p = pts[i], q = pts[i + 1], d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
                    let n = [along[1] * d[2] - along[2] * d[1], along[2] * d[0] - along[0] * d[2], along[0] * d[1] - along[1] * d[0]];
                    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
                    if (T.sees(n)) { if (!cur.length) cur.push(p); cur.push(q); }
                    else { if (cur.length > 1) S.line(cur); cur = []; }
                }
                if (cur.length > 1) S.line(cur);
            };
            // a point of the mesh's own rows, which run straight between their extra points
            const onRow = (half, list, pt, x) => {
                const xs = [-half, ...list.filter(c => Math.abs(c) < half - 1e-3), half];
                let i = 0;
                while (i + 2 < xs.length && xs[i + 1] < x) i++;
                const p = pt(xs[i]), q = pt(xs[i + 1]), f = clamp((x - xs[i]) / (xs[i + 1] - xs[i] || 1), 0, 1);
                return P(lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f) + LIFT);
            };
            const slope = (len, nrm, fall, along, line) => {
                // not the slopes seen nearly edge-on, where the lines would close up
                const c = T.cam, u = unit(nrm);
                if (-((u[0] * c.fx + u[1] * c.fy) * c.ce - u[2] * c.se) < 0.3) return;
                const gap = T.lit(nrm) ? T.hLit : T.hDark, per = apart(T, unit(fall), along);
                if (per < 1e-6) return;
                const n = Math.max(1, Math.round((2 * len) / (gap / per))), st = (2 * len) / n;
                for (let i = 0; i < n; i++) run(line(-len + (i + 0.5) * st), along);
            };
            inKind(S, ROOF, () => {
                for (const sb of [-1, 1]) {
                    slope(A, V(0, sb * rise, B), V(0, -sb * B, rise), V(1, 0, 0), a => {
                        const ta = A - Math.abs(a), tmax = ta < g ? ta : B;
                        const pts = levels.filter(t => t < tmax - 1e-3).map(t => onRow(A - Math.min(t, g), colsA, x => main(x, sb, t), a));
                        const e = main(a, sb, tmax);
                        pts.push(P(e[0], e[1], e[2] + LIFT));
                        return pts;
                    });
                }
                if (g > 1e-6) {
                    for (const sa of [-1, 1]) {
                        slope(B, V(sa * rise, 0, B), V(-sa * B, 0, rise), V(0, 1, 0), b => {
                            const tmax = Math.min(B - Math.abs(b), g);
                            const pts = levels.filter(t => t < tmax - 1e-3).map(t => onRow(B - t, colsB, x => end(sa, x, t), b));
                            const e = end(sa, b, tmax);
                            pts.push(P(e[0], e[1], e[2] + LIFT));
                            return pts;
                        });
                    }
                }
            });
        }
        // thatch and bark roofs get a line or two along the slopes, like the edges of their layers
        if (T.tones && o.tiles === false && o.layers) {
            inKind(S, ROOF, () => {
                for (let i = 1; i <= o.layers; i++) {
                    const t = (B * i) / (o.layers + 1.4), za = 0.03;
                    for (const sb of [-1, 1]) {
                        if (!T.sees(V(0, sb * rise, B))) continue;
                        const h = A - Math.min(t, g), pts = [-h, ...colsA.filter(c => Math.abs(c) < h - 1e-3), h].map(a => { const q = main(a, sb, t); return P(q[0], q[1], q[2] + za); });
                        S.line(pts);
                    }
                    if (t >= g) continue;
                    for (const sa of [-1, 1]) {
                        if (!T.sees(V(sa * rise, 0, B))) continue;
                        const h = B - t, pts = [-h, ...colsB.filter(c => Math.abs(c) < h - 1e-3), h].map(b => { const q = end(sa, b, t); return P(q[0], q[1], q[2] + za); });
                        S.line(pts);
                    }
                }
            });
        }
        // ridge tiles along the top, with a block at each end
        if (o.ridge !== false && R.half > 0.4) {
            const w = Math.max(0.2, 0.55 / T.k), h = Math.max(0.3, 0.9 / (T.k * T.cam.ce)), e = 0.25, zr = z + hgt(B - w);
            S.box({ P }, -R.half - e, -w, zr, R.half + e, w, R.ridge + h);
            if (T.detail && w * T.k > 0.9) for (const sa of [-1, 1]) S.box({ P }, sa * (R.half + e) - 0.22, -w * 1.4, zr - 0.1, sa * (R.half + e) + 0.22, w * 1.4, R.ridge + h * 1.7);
            R.top = R.ridge + h;
        }
        return R;
    }

    // Paper millimeters per meter along a wall (pu) and up it (pz)
    function wallScale(T, at) {
        const a = at(0, 0), b = at(1, 0), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        return { pu: Math.max(apart(T, UP, u), 1e-6), pz: Math.max(apart(T, u, UP), 1e-6) };
    }

    // ------------------------------------------------------------------
    // Stones
    // ------------------------------------------------------------------

    // A standing or lying rock as a faceted solid. q is { x, y, r, h, top,
    // long, seed }: its radius on the ground, its height, and how much
    // smaller the top is. Only the top and a facet edge or two are drawn, the
    // rest is outline.
    function rock(T, q, z) {
        const S = T.S, rng = new PG.RNG(q.seed), { x, y, r, h } = q, n = 7, rot = rng.range(0, TAU);
        const long = q.long || 1, la = rng.range(0, TAU), lc = Math.cos(la), ls = Math.sin(la);
        const stretch = (u, v) => { const a = (u * lc + v * ls) * long, b = (v * lc - u * ls) / long; return [a * lc - b * ls, a * ls + b * lc]; };
        const top = q.top, ox = rng.range(-0.15, 0.15) * r, oy = rng.range(-0.15, 0.15) * r;
        const tilt = rng.range(0.08, 0.3) * h, ta = rng.range(0, TAU), v = [];
        const angs = Array.from({ length: n }, (_, i) => rot + (TAU * (i + rng.range(-0.2, 0.2))) / n);
        for (const a of angs) {
            const rr = r * rng.range(0.8, 1), [u, w] = stretch(rr * Math.cos(a), rr * Math.sin(a));
            v.push([x + u, y + w, z]);
        }
        for (const a of angs) {
            const [u, w] = stretch(r * top * Math.cos(a + 0.25), r * top * Math.sin(a + 0.25));
            v.push([x + ox + u, y + oy + w, z + h + (tilt * (u * Math.cos(ta) + w * Math.sin(ta))) / (r * top)]);
        }
        const f = [Array.from({ length: n }, (_, i) => n + i), Array.from({ length: n }, (_, i) => n - 1 - i)], g = [0, 0];
        // big rocks show a facet edge or two down their sides
        const facets = r * T.k > 5 ? 3 : r * T.k > 2.6 ? 2 : 1, turn = rng.int(0, n - 1);
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, grp = 1 + Math.floor((((i + turn) % n) * facets) / n);
            f.push([i, j, n + j], [i, n + j, n + i]);
            g.push(grp, grp);
        }
        S.kind = INK;
        unshaded(S, () => S.solid(v, f, g));
        // lines down the faces turned from the sun
        if (!T.detail || r * T.k < 2.2) return;
        const mid = [x + ox / 2, y + oy / 2, z + h / 2];
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, quad = [v[i], v[j], v[n + j], v[n + i]], nrm = kit.outward(quad, mid);
            if (T.lit(nrm) || !T.sees(nrm)) continue;
            const wide = apart(T, [v[n + i][0] - v[i][0], v[n + i][1] - v[i][1], v[n + i][2] - v[i][2]], [v[j][0] - v[i][0], v[j][1] - v[i][1], 0]);
            const m = Math.floor(wide / 0.85), u = unit(nrm);
            for (let q = 1; q < m; q++) {
                const a = kit.lerp3(v[i], v[j], q / m), b = kit.lerp3(v[n + i], v[n + j], q / m);
                S.line([[a[0] + u[0] * 0.02, a[1] + u[1] * 0.02, a[2]], [b[0] + u[0] * 0.02, b[1] + u[1] * 0.02, b[2]]]);
            }
        }
    }

    // Plan a group of rocks round (x, y): a main stone with lower ones
    // leaning on it. `size` is the main stone's radius.
    function planRocks(x, y, size, count, rng) {
        const tall = rng.chance(0.65), out = [];
        const put = (px, py, r, h, top, long) => out.push({ x: px, y: py, r, h, top, long, seed: rng.int(1, 1e9) });
        if (tall) put(x, y, size, size * rng.range(1.7, 2.6), rng.range(0.28, 0.45), rng.range(1, 1.2));
        else put(x, y, size * 1.15, size * rng.range(0.7, 1.05), rng.range(0.5, 0.7), rng.range(1.1, 1.4));
        const a0 = rng.range(0, TAU);
        for (let i = 1; i < count; i++) {
            const a = a0 + ((TAU * i) / Math.max(3, count - 1)) * rng.range(0.75, 1.15), r = size * rng.range(0.45, 0.8);
            const d = out[0].r + r * rng.range(0.85, 1.4), flat = rng.chance(0.55);
            put(x + d * Math.cos(a), y + d * Math.sin(a), r, flat ? r * rng.range(0.4, 0.65) : r * rng.range(1, 1.6), flat ? rng.range(0.6, 0.8) : rng.range(0.35, 0.5), flat ? rng.range(1.2, 1.5) : 1);
        }
        return out;
    }

    // An outline round a set of circles ([x, y, r]), `m` clear of them, a little uneven
    function outlineRound(circles, m, rng, n = 56) {
        let cx = 0, cy = 0, w = 0;
        for (const [x, y, r] of circles) { cx += x * r; cy += y * r; w += r; }
        cx /= w; cy /= w;
        const p2 = rng.range(0, TAU), p3 = rng.range(0, TAU), a2 = rng.range(0.03, 0.09), a3 = rng.range(0.02, 0.07), out = [];
        for (let i = 0; i < n; i++) {
            const t = (TAU * i) / n, c = Math.cos(t), s = Math.sin(t);
            let h = 0;
            for (const [x, y, r] of circles) h = Math.max(h, (x - cx) * c + (y - cy) * s + r + m);
            const rr = h * (1 + a2 * (1 + Math.cos(2 * t + p2)) + a3 * (1 + Math.cos(3 * t + p3)));
            out.push([cx + rr * c, cy + rr * s]);
        }
        return out;
    }

    // Short strokes of moss wherever inside(x, y) holds, level across the page
    function tufts(T, inside, box, gap, rng, z = 0.03) {
        const { S, cam } = T, len = Math.max(0.9, FINE * 1.3) / T.k, step = gap / T.k;
        S.kind = MOSS;
        for (let y = box[1]; y < box[3]; y += step) {
            for (let x = box[0]; x < box[2]; x += step) {
                const px = x + rng.range(0.1, 0.9) * step, py = y + rng.range(0.1, 0.9) * step;
                const ax = px - (cam.rx * len) / 2, ay = py - (cam.ry * len) / 2, bx = px + (cam.rx * len) / 2, by = py + (cam.ry * len) / 2;
                if (!inside(px, py) || !inside(ax, ay) || !inside(bx, by)) continue;
                S.line([[ax, ay, z], [bx, by, z]], true);
            }
        }
    }

    // An island in the gravel: its rocks, and the moss they stand in
    function island(T, I, seed) {
        const S = T.S, rng = new PG.RNG(seed);
        for (const q of I.rocks) rock(T, q, 0);
        if (I.pine) pine(T, I.pine[0], I.pine[1], 0, rng, I.scale || 0.7);
        if (I.lantern) lantern(T, I.lantern[0], I.lantern[1], 0, I.scale || 1);
        if (I.tower) stoneTower(T, I.tower[0], I.tower[1], 0, 1.15, 5);
        if (!I.moss) return;
        S.kind = MOSS;
        S.loop(at3(I.poly, 0.02));
        const spot = I.pine || I.lantern || I.tower;
        const clear = (x, y) => sdPoly(I.poly, x, y) < -0.3 && I.rocks.every(q => Math.hypot(q.x - x, q.y - y) > q.r * (q.long || 1) + 0.25) && (!spot || Math.hypot(spot[0] - x, spot[1] - y) > 0.6);
        if (T.detail) tufts(T, clear, bounds(I.poly), 2.6, rng);
    }

    // ------------------------------------------------------------------
    // Trees and shrubs
    // ------------------------------------------------------------------

    // Draw without casting shadows, for cut-outs that cast a shape of their own
    function unshaded(S, fn) {
        const keep = S.shadow;
        S.shadow = null;
        fn();
        S.shadow = keep;
    }

    // The shadow of a level disc
    function castDisc(S, x, y, z, r) {
        if (S.shadow) S.castShadow(ring(8, (c, s) => [x + r * c, y + r * s, z]));
    }

    // One pad of a cloud-pruned pine: a level disc of needles with a lumpy
    // rim, and its thickness showing on the side nearest the camera
    function pad(T, x, y, z, r, rng) {
        const S = T.S, c = T.cam, lobes = rng.int(5, 7), a0 = rng.range(0, TAU), n = Math.max(lobes * 4, T.segs(r));
        const th = Math.min(0.42, r * 0.4), bump = r * 0.13, phi = Math.atan2(-c.fy, -c.fx);
        const rim = [];
        for (let i = 0; i < n; i++) {
            const a = (TAU * i) / n, rr = r - bump + bump * Math.abs(Math.sin((lobes * (a - a0)) / 2));
            rim.push([x + rr * Math.cos(a), y + rr * Math.sin(a), z]);
        }
        S.face(hull(rim.map(q => [q[0], q[1]])).map(q => [q[0], q[1], z]));
        S.loop(rim);
        // the near half of the rim again, lower down
        const m = Math.max(8, n >> 1), under = [];
        for (let i = 0; i <= m; i++) {
            const a = phi - Math.PI / 2 + (Math.PI * i) / m, rr = r - bump * 0.5;
            under.push([x + rr * Math.cos(a), y + rr * Math.sin(a), z - th * Math.max(0, Math.sin((Math.PI * i) / m)) ** 0.6]);
        }
        if (th * T.k * c.ce > FINE) {
            for (let i = 0; i < m; i++) {
                const a = under[i], b = under[i + 1];
                S.face([[a[0], a[1], z], [b[0], b[1], z], b, a], false);
            }
            S.line(under);
        }
    }

    // A cloud-pruned pine: a leaning trunk with a pad of needles at the end
    // of each branch and one on top
    function pine(T, x, y, z, rng, big = 1) {
        const S = T.S, H = rng.range(3.4, 5.2) * big, lean = rng.range(0.15, 0.4) * H, la = rng.range(0, TAU);
        const bend = rng.range(-0.25, 0.25) * H, lx = Math.cos(la), ly = Math.sin(la);
        // the trunk leans one way and bows the other
        const trunk = s => {
            const o = lean * s + bend * Math.sin(Math.PI * s) * 0.5;
            return [x + lx * o - ly * bend * 0.3 * Math.sin(Math.PI * s), y + ly * o + lx * bend * 0.3 * Math.sin(Math.PI * s), z + H * s];
        };
        const pads = [], n = big < 0.8 ? rng.int(2, 3) : rng.int(3, 5), turn = rng.range(0, TAU);
        for (let i = 0; i < n; i++) {
            const s = lerp(0.38, 0.86, n > 1 ? i / (n - 1) : 0.5) + rng.range(-0.04, 0.04), q = trunk(s);
            const a = turn + i * 2.4 + rng.range(-0.3, 0.3), reach = H * rng.range(0.24, 0.36) * (1.15 - 0.5 * s) * (big < 0.8 ? 1.35 : 1);
            pads.push({ from: q, x: q[0] + reach * Math.cos(a), y: q[1] + reach * Math.sin(a), z: q[2] + rng.range(0.1, 0.35), r: H * rng.range(0.19, 0.25) * (1.2 - 0.55 * s) });
        }
        const tip = trunk(1);
        pads.push({ from: null, x: tip[0], y: tip[1], z: tip[2], r: H * rng.range(0.17, 0.21) });
        S.kind = WOOD;
        const tw = 0.11 * big, stem = [], c = T.cam;
        for (let i = 0; i <= 8; i++) stem.push(trunk(i / 8));
        // drawn as two lines with a face between them, so it hides what's behind it
        unshaded(S, () => {
            for (let i = 0; i < 8; i++) {
                const a = stem[i], b = stem[i + 1], wa = tw * (1 - (0.6 * i) / 8), wb = tw * (1 - (0.6 * (i + 1)) / 8);
                S.face([[a[0] - c.rx * wa, a[1] - c.ry * wa, a[2]], [a[0] + c.rx * wa, a[1] + c.ry * wa, a[2]], [b[0] + c.rx * wb, b[1] + c.ry * wb, b[2]], [b[0] - c.rx * wb, b[1] - c.ry * wb, b[2]]]);
            }
            if (tw * T.k > FINE * 0.75) {
                for (const sgn of [-1, 1]) S.line(stem.map((q, i) => { const w = tw * (1 - (0.6 * i) / 8) * sgn; return [q[0] + c.rx * w, q[1] + c.ry * w, q[2]]; }));
            } else S.line(stem);
            for (const q of pads) if (q.from) S.line([q.from, [q.x, q.y, q.z - 0.1]]);
        });
        S.kind = MOSS;
        for (const q of pads) pad(T, q.x, q.y, q.z, q.r, rng);
        if (S.shadow) S.castShadow([[x - 0.1, y, z], [x + 0.1, y, z], tip]);
    }

    // A maple: round cut-outs facing the camera with pointed leaves round their
    // edges, on a forked trunk
    function maple(T, x, y, z, rng, big = 1) {
        const S = T.S, ce = T.cam.ce, H = rng.range(4, 6) * big, R = H * rng.range(0.3, 0.36);
        const lobes = rng.int(3, 4), a0 = rng.range(0, TAU), tops = [];
        S.kind = MAPLE;
        unshaded(S, () => {
            for (let l = 0; l < lobes; l++) {
                const a = a0 + (TAU * l) / lobes, d = l === 0 ? 0 : R * rng.range(0.55, 0.8), r = R * (l === 0 ? 1 : rng.range(0.62, 0.8));
                const lx = x + d * Math.cos(a), ly = y + d * Math.sin(a), cz = H - R / ce - (l === 0 ? 0 : R * rng.range(0.1, 0.5));
                const P = card(T, lx, ly, z, 0.2), tips = Math.max(7, Math.round((TAU * r * T.k) / 2.6)), seg = 4, ph = rng.range(0, TAU), pts = [];
                for (let i = 0; i < tips * seg; i++) {
                    const t = (TAU * i) / (tips * seg), rr = r * (1 - 0.13 * Math.abs(Math.sin((tips * (t - ph)) / 2)) + 0.05 * Math.sin(3 * t + ph));
                    pts.push([rr * Math.cos(t), cz + (rr * Math.sin(t)) / ce]);
                }
                S.face(hull(pts).map(([u, w]) => P(u, w)));
                S.loop(pts.map(([u, w]) => P(u, w)));
                tops.push([lx, ly, z + cz - r * 0.4, r]);
            }
        });
        for (const q of tops) castDisc(S, q[0], q[1], q[2] + q[3] * 0.4, q[3]);
        // the trunk forks low down, a stem to each part of the crown
        S.kind = WOOD;
        const fork = [x, y, z + H * 0.22];
        S.line([[x, y, z], fork]);
        for (const q of tops) S.line([fork, [lerp(x, q[0], 0.6), lerp(y, q[1], 0.6), lerp(fork[2], q[2], 0.55)], q]);
    }

    // Clipped azaleas: a huddle of round mounds
    function shrubs(T, x, y, z, rng, count, size = 1) {
        const S = T.S, out = [];
        S.kind = MOSS;
        for (let i = 0; i < count; i++) {
            const a = rng.range(0, TAU), d = i ? rng.range(0.5, 1.1) * size * Math.sqrt(i) : 0, r = size * rng.range(0.45, 0.85) * (i ? 0.85 : 1);
            const px = x + d * Math.cos(a), py = y + d * Math.sin(a), h = r * rng.range(0.75, 0.95), prof = [];
            for (let j = 0; j <= 6; j++) prof.push([r * Math.cos((j / 6) * (Math.PI / 2)), z + h * Math.sin((j / 6) * (Math.PI / 2))]);
            prof[6][0] = 0;
            S.lathe(px, py, prof, T.segs(r));
            out.push([px, py, r]);
        }
        return out;
    }

    // Bamboo in a clump: tall canes that bend over at the top, with leaves
    // in a zigzag down each side of them
    function bamboo(T, x, y, z, rng, count, spread) {
        const S = T.S, c = T.cam;
        const canes = Array.from({ length: count }, () => { const a = rng.range(0, TAU), d = spread * Math.sqrt(rng.random()); return [x + d * Math.cos(a), y + d * Math.sin(a)]; });
        // far ones first, so the near ones overlap them
        canes.sort((p, q) => (q[0] * c.fx + q[1] * c.fy) - (p[0] * c.fx + p[1] * c.fy));
        S.kind = MOSS;
        unshaded(S, () => {
            for (const [cx, cy] of canes) {
                const H = rng.range(7, 10.5), lean = rng.range(0.5, 1.4) * rng.sign(), w = rng.range(0.55, 0.85), P = card(T, cx, cy, z, 0);
                const top = rng.range(0.42, 0.52), n = Math.max(3, Math.round((top * H * T.k * c.ce) / 2.4));
                const at = f => [lean * f ** 3, H * f];
                const zig = [];
                for (let i = 0; i <= n; i++) {
                    zig.push(at(1 - top * (i / n)));
                    if (i === n) break;
                    const m = at(1 - top * ((i + 0.8) / n)), ww = w * Math.max(0, Math.sin(Math.PI * clamp((i + 0.7) / (n + 0.4), 0, 1))) ** 0.5;
                    zig.push([m[0] + (i & 1 ? ww : -ww), m[1] - 0.2]);
                }
                S.face(hull(zig).map(([u, v]) => P(u, v)));
                S.line(zig.map(([u, v]) => P(u, v)));
                const cane = [];
                for (let i = 0; i <= 8; i++) cane.push(at(i / 8));
                S.line(cane.map(([u, v]) => P(u, v)));
                if (T.detail && 0.18 * T.k > FINE) for (let j = 1; j < 4; j++) { const q = at(((1 - top) * j) / 4); S.line([P(q[0] - 0.09, q[1]), P(q[0] + 0.09, q[1])], true); }
            }
        });
    }

    // A cedar: a tall narrow spire of tiers, cut out facing the camera like the kit's firs
    function cedar(T, x, y, z, rng, h) {
        const S = T.S, te = T.cam.tanE, tiers = rng.int(6, 7), R = h * rng.range(0.085, 0.105), trunk = h * rng.range(0.08, 0.12);
        S.kind = MOSS;
        unshaded(S, () => {
            for (let i = 0; i < tiers; i++) {
                const f0 = i / tiers, f1 = Math.min(1, (i + 2) / tiers);
                const r = R * (1 - 0.7 * f0), q = r * te, base = trunk + (h - trunk) * f0, apex = trunk + (h - trunk) * f1;
                const P = card(T, x, y, z, 0.1 * (i + 1));
                // the apex, the two edges and the near side of the skirt
                const phi = Math.asin(Math.min(0.95, q / Math.max(1e-6, apex - base))), n = Math.max(6, T.segs(r)), pts = [P(0, apex)];
                for (let j = 0; j <= n; j++) { const t = -phi + ((Math.PI + 2 * phi) * j) / n; pts.push(P(r * Math.cos(t), base - q * Math.sin(t))); }
                S.face(pts);
                S.loop(pts);
            }
            const P = card(T, x, y, z, 0), tw = Math.max(0.12, R * 0.14);
            S.face([P(-tw, 0), P(tw, 0), P(tw, trunk), P(-tw, trunk)]);
            S.line([P(-tw, trunk), P(-tw, 0), P(tw, 0), P(tw, trunk)]);
        });
        castDisc(S, x, y, z + h * 0.45, R);
    }

    // ------------------------------------------------------------------
    // Stone lanterns and the like
    // ------------------------------------------------------------------

    // A mound of raked gravel with a flat top, and rake lines round its side
    // as far apart on paper as the ones on the ground
    function mound(T, x, y, r0) {
        const S = T.S, c = T.cam, h = r0 * 0.85, r1 = r0 * 0.6;
        S.kind = GRAVEL;
        unshaded(S, () => S.lathe(x, y, [[r0, 0], [r1, h]], T.segs(r0)));
        const n = Math.floor((T.k * (h * c.ce + (r0 - r1) * c.se)) / T.p.rakeGap) - 1;
        for (let i = 1; i <= n; i++) {
            const t = i / (n + 1), r = lerp(r0, r1, t) * 1.01 + 0.005;
            S.loop(ring(T.segs(r), (cs, sn) => [x + r * cs, y + r * sn, h * t]));
        }
    }

    // A tall lantern on a post: base, post, a six-sided light box under a
    // cap with a jewel on top. s scales it.
    function lantern(T, x, y, z, s = 1) {
        const S = T.S, n = T.segs(0.36 * s), six = Math.PI / 6;
        // too small for its six sides to show apart, it's drawn round
        const round = 0.6 * s * T.k < 2.4;
        S.kind = INK;
        S.lathe(x, y, [[0.36 * s, z], [0.24 * s, z + 0.22 * s]], n);
        S.frustum(x, y, z + 0.22 * s, z + 1.0 * s, 0.12 * s, 0.1 * s, Math.max(8, n >> 1));
        S.lathe(x, y, [[0.1 * s, z + 1.0 * s], [0.3 * s, z + 1.12 * s]], n);
        S.lathe(x, y, [[0.3 * s, z + 1.12 * s], [0.3 * s, z + 1.5 * s]], round ? n : 6, round, six);
        S.lathe(x, y, [[0.5 * s, z + 1.5 * s], [0.42 * s, z + 1.6 * s], [0.08 * s, z + 1.84 * s]], round ? n : 6, round, six);
        S.lathe(x, y, [[0.08 * s, z + 1.84 * s], [0, z + 2.02 * s]], Math.max(6, n >> 1));
    }

    // A low snow-viewing lantern: a wide cap over the light on three legs
    function snowLantern(T, x, y, z, s = 1) {
        const S = T.S, n = T.segs(0.6 * s);
        S.kind = INK;
        for (let i = 0; i < 3; i++) {
            const a = 0.5 + (TAU * i) / 3, c = Math.cos(a), sn = Math.sin(a);
            S.line([[x + 0.42 * s * c, y + 0.42 * s * sn, z], [x + 0.3 * s * c, y + 0.3 * s * sn, z + 0.3 * s], [x + 0.2 * s * c, y + 0.2 * s * sn, z + 0.48 * s]]);
        }
        S.lathe(x, y, [[0.26 * s, z + 0.48 * s], [0.26 * s, z + 0.56 * s]], n);
        S.lathe(x, y, [[0.2 * s, z + 0.56 * s], [0.2 * s, z + 0.82 * s]], 6, false, Math.PI / 6);
        S.lathe(x, y, [[0.66 * s, z + 0.82 * s], [0.56 * s, z + 0.92 * s], [0.1 * s, z + 1.08 * s], [0, z + 1.2 * s]], n);
    }

    // A little stone pagoda: square stories under wide caps
    function stoneTower(T, x, y, z, s = 1, tiers = 5) {
        const S = T.S, q = Math.PI / 4;
        S.kind = INK;
        S.lathe(x, y, [[0.36 * s, z], [0.36 * s, z + 0.2 * s]], 4, false, q);
        let c = z + 0.2 * s;
        for (let i = 0; i < tiers; i++) {
            const w = (0.21 - 0.02 * i) * s, e = (0.44 - 0.045 * i) * s;
            S.lathe(x, y, [[w, c], [w, c + 0.2 * s]], 4, false, q);
            S.lathe(x, y, [[e, c + 0.2 * s], [w * 0.85, c + 0.36 * s]], 4, false, q);
            c += 0.36 * s;
        }
        S.lathe(x, y, [[0.05 * s, c], [0.05 * s, c + 0.25 * s], [0, c + 0.34 * s]], 4, false, q);
    }

    // ------------------------------------------------------------------
    // The garden wall: plaster on a stone footing, under a tiled coping
    // ------------------------------------------------------------------

    const WALL = { t: 0.6, h: 2.1, foot: 0.32, eave: 0.42, rise: 0.5 };

    // One run of wall from a to b (plan points on its center line), garden on
    // the left. Each end is cut square or to a miter for a corner.
    function wallRun(T, a, b, miterA, miterB, ledge) {
        const S = T.S, { t, h, eave, rise } = WALL, foot = ledge ? WALL.foot : 0;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) return;
        const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [d[1], -d[0]]; // n points out of the garden
        const P = (s, o, z) => [a[0] + d[0] * s + n[0] * o, a[1] + d[1] * s + n[1] * o, z];
        // at an outside corner the outer face runs on and the inner one stops short
        const cut = (m, o) => (m ? o : 0);
        const body = (w, z0, z1) => S.prism([P(-cut(miterA, w), w, z0), P(L + cut(miterB, w), w, z0), P(L - cut(miterB, w), -w, z0), P(cut(miterA, w), -w, z0)], [0, 0, z1 - z0]);
        S.kind = INK;
        if (ledge) body(t / 2 + ledge, 0, foot);
        body(t / 2, foot, h);
        const c = t / 2 + eave, zr = h + rise;
        const v = [P(cut(miterA, c), -c, h), P(L - cut(miterB, c), -c, h), P(L + cut(miterB, c), c, h), P(-cut(miterA, c), c, h), P(0, 0, zr), P(L, 0, zr)];
        S.solid(v, [[0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 5, 4], [0, 3, 4], [1, 5, 2]]);
        const pu = apart(T, UP, [d[0], d[1], 0]), pz = T.k * T.cam.ce;
        for (const side of [-1, 1]) {
            // the plaster's stripes, on whichever face shows
            if (T.sees([n[0] * side, n[1] * side, 0])) {
                // the coping hangs over the face and hides the top of it, this much on paper
                const toward = -(n[0] * side * T.cam.fx + n[1] * side * T.cam.fy), top = h - eave * Math.max(0, toward) * T.cam.tanE;
                const lines = clamp(Math.floor(((top - foot) * pz) / 1.5) - 1, 0, 3), w = (t / 2 + 0.01) * side, e = (t / 2) * side;
                for (let i = 1; i <= lines; i++) {
                    const z = foot + ((top - foot) * i) / (lines + 1);
                    S.line([P(miterA ? -e : 0, w, z), P(miterB ? L + e : L, w, z)]);
                }
            }
            // and the coping's tiles
            if (!T.detail || !T.sees([n[0] * side * rise, n[1] * side * rise, c]) || c * apart(T, [d[0], d[1], 0], [n[0], n[1], 0]) < FINE * 1.6) continue;
            const s0 = miterA ? c * 1.1 : 0.25, s1 = L - (miterB ? c * 1.1 : 0.25), m = Math.max(1, Math.round(((s1 - s0) * pu) / 1.9));
            for (let i = 0; i <= m; i++) {
                const s = lerp(s0, s1, m ? i / m : 0.5);
                S.line([P(s, side * c * 0.94, h + rise * 0.06 + 0.012), P(s, side * c * 0.12, h + rise * 0.88 + 0.012)]);
            }
        }
    }

    // The wall round the garden, with an opening for each gate
    function gardenWall(T, plan) {
        const [x0, y0, x1, y1] = grow(plan.rect, WALL.t / 2);
        // The footing sticks out far enough for its edge to stand clear of the
        // wall's on paper, the same on every wall so the corners meet. On a
        // small drawing that would be too far, and there's no footing.
        const per = Math.min(apart(T, [1, 0, 0], [0, 1, 0]), apart(T, [0, 1, 0], [1, 0, 0]));
        const need = (FINE * 1.2) / Math.max(per, 1e-6), ledge = need > 0.3 ? 0 : Math.max(0.1, need);
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        for (let i = 0; i < 4; i++) {
            const a = corners[i], b = corners[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const gaps = plan.gates.filter(g => g.side === i).map(g => [g.s - g.open / 2, g.s + g.open / 2]).sort((u, v) => u[0] - v[0]);
            const at = s => [lerp(a[0], b[0], s / L), lerp(a[1], b[1], s / L)];
            let s = 0, miter = true;
            for (const [g0, g1] of gaps) {
                wallRun(T, at(s), at(g0), miter, false, ledge);
                s = g1;
                miter = false;
            }
            wallRun(T, at(s), at(L), miter, true, ledge);
        }
    }

    // A gate in the wall at s along side `side` of the garden: where it
    // stands, as a lot with its front to the outside
    function gateLot(plan, side, s, open) {
        const [x0, y0, x1, y1] = grow(plan.rect, WALL.t / 2);
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], a = corners[side], b = corners[(side + 1) % 4];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), c = [lerp(a[0], b[0], s / L), lerp(a[1], b[1], s / L)];
        const hw = open / 2 + 1.5, hd = 1.7;
        const rect = side & 1 ? [c[0] - hd, c[1] - hw, c[0] + hd, c[1] + hw] : [c[0] - hw, c[1] - hd, c[0] + hw, c[1] + hd];
        return { side, s, open, c, rect, face: side };
    }

    // A roofed gate: two posts with a beam across, a pair of plank doors and
    // a tiled gable roof along the wall
    function gate(T, g) {
        const S = T.S, F = lotFrame(g.rect, g.face), { P, W: L, D } = F, am = L / 2, bm = D / 2;
        const half = g.open / 2, pw = 0.34, ph = 3.6;
        S.kind = WOOD;
        for (const s of [-1, 1]) S.box(F, am + s * (half - pw / 2) - pw / 2, bm - pw / 2, 0, am + s * (half - pw / 2) + pw / 2, bm + pw / 2, ph);
        S.box(F, am - half - 0.35, bm - 0.14, ph - 0.34, am + half + 0.35, bm + 0.14, ph);
        const d0 = am - half + pw, d1 = am + half - pw;
        S.box(F, d0, bm - 0.05, 0.06, d1, bm + 0.05, ph - 0.34);
        for (const side of [0, 2]) {
            const Wd = kit.wall(F, side, [d0, bm - 0.05, d1, bm + 0.05]);
            if (!T.sees(Wd.n)) continue;
            S.line([Wd.at(Wd.len / 2, 0.06), Wd.at(Wd.len / 2, ph - 0.34)]);
            if (T.detail) for (const f of [0.3, 0.72]) S.line([Wd.at(0, (ph - 0.34) * f), Wd.at(Wd.len, (ph - 0.34) * f)]);
        }
        S.kind = INK;
        // a stone sill, and a step down outside
        S.box(F, d0 - 0.2, bm - 1.25, 0, d1 + 0.2, bm + 0.6, 0.12);
        curvedRoof(T, F, [am - half - 1.25, bm - 1.45, am + half + 1.25, bm + 1.45], ph + 0.12, { gable: 0, rise: 1.3, lift: 0.2, fascia: 0.22, flat: 0.6 });
    }

    // ------------------------------------------------------------------
    // Buildings. Each stands on a lot: a rectangle of ground with a front.
    // ------------------------------------------------------------------

    // Frame for a rectangle of ground whose front faces `face` (0: -y, 1: +x,
    // 2: +y, 3: -x). u runs along the front and v back from it. W and D are
    // how long and how deep it is.
    function lotFrame([x0, y0, x1, y1], face, z = 0) {
        const o = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]][face];
        return Object.assign(frame(o[0], o[1], z, face), { W: face & 1 ? y1 - y0 : x1 - x0, D: face & 1 ? x1 - x0 : y1 - y0 });
    }

    // Sliding paper screens along a wall from s0 to s1, between a sill and a
    // lintel: the posts between the bays, the bars across and one upright
    // down the middle of each screen
    function screens(T, W, s0, s1, c0, c1, bars = true) {
        if (!T.sees(W.n)) return;
        const S = T.S, { pu, pz } = wallScale(T, W.at), len = s1 - s0;
        const bays = Math.max(1, Math.round(len / 1.9)), bw = len / bays;
        for (let i = 0; i <= bays; i++) S.line([W.at(s0 + i * bw, c0), W.at(s0 + i * bw, c1)]);
        if (!T.detail) return;
        if ((bw / 2) * pu > FINE * 1.6) for (let i = 0; i < bays; i++) S.line([W.at(s0 + (i + 0.5) * bw, c0), W.at(s0 + (i + 0.5) * bw, c1)]);
        if (!bars) return;
        const rows = clamp(Math.floor(((c1 - c0) * pz) / 1.15), 1, 5);
        for (let i = 1; i < rows; i++) S.line([W.at(s0, lerp(c0, c1, i / rows)), W.at(s1, lerp(c0, c1, i / rows))]);
    }

    // A hall: a timber frame on a raised floor with a veranda along the
    // front and both ends, paper screens all round, and a big tiled roof
    // that comes out over the veranda. The lot says how: { veranda, eave,
    // wall (height), roof, pitch, lift }.
    function hall(T, lot) {
        const S = T.S, F = lotFrame(lot.rect, lot.face), { P, W: L, D } = F, o = lot;
        const vw = o.veranda, zf = 0.7, zt = zf + o.wall, top = Math.min(2.2, o.wall - 0.9);
        const body = [vw, vw, L - vw, D];
        // the floor, on short posts
        S.kind = WOOD;
        S.box(F, 0.3, 0.3, 0, L - 0.3, D, zf - 0.2);
        S.box(F, 0, 0, zf - 0.2, L, D, zf);
        for (const side of [0, 1, 3]) {
            const E = kit.wall(F, side, [0.02, 0.02, L - 0.02, D]);
            if (!T.sees(E.n)) continue;
            const n = Math.max(1, Math.round(E.len / 1.9));
            for (let i = 0; i <= n; i++) S.line([E.at((E.len * i) / n, 0), E.at((E.len * i) / n, zf - 0.2)]);
        }
        // its boards, mitered at the corners
        if (T.detail) {
            const per = apart(T, F.V(1, 0, 0), F.V(0, 1, 0)), n = clamp(Math.floor((vw * per) / 2), 1, 3), z = zf + 0.004;
            for (let i = 1; i < n; i++) {
                const d = (vw * i) / n;
                S.line([P(d, D, z), P(d, d, z), P(L - d, d, z), P(L - d, D, z)]);
            }
            S.line([P(0, 0, z), P(vw, vw, z)]);
            S.line([P(L, 0, z), P(L - vw, vw, z)]);
        }
        // walls of paper screens between the posts
        S.box(F, body[0], body[1], zf, body[2], body[3], zt - 0.1);
        for (let side = 0; side < 4; side++) {
            const Wl = kit.wall(F, side, body);
            if (!T.sees(Wl.n)) continue;
            S.line([Wl.at(0, zf + top), Wl.at(Wl.len, zf + top)]);
            screens(T, Wl, 0, Wl.len, zf, zf + top, false);
        }
        // steps up to the veranda from a stone
        const sx = L / 2;
        if (T.sees(F.V(0, -1, 0))) {
            const sw = Math.min(2.6, L * 0.2);
            kit.steps(T, F, sx, 0, sw, 2, (zf - 0.02) / 3, 0.32);
            S.kind = INK;
            S.box(F, sx - sw * 0.42, -1.5, 0, sx + sw * 0.42, -0.72, 0.2);
        }
        S.kind = INK;
        const B = (D - vw) / 2 + o.eave;
        const R = curvedRoof(T, F, [vw - o.eave, vw - o.eave, L - vw + o.eave, D + o.eave], 0, {
            seat: [o.eave, zt], rise: B * o.pitch, gable: o.roof === 'gable' ? 0 : o.roof === 'hip' ? undefined : B * 0.52, lift: o.roof === 'gable' ? o.lift * 0.4 : o.lift, sweep: 5,
        });
        gableDress(T, R);
        return R;
    }

    // A pagoda: square stories one above the other, each under a wide roof
    // with its corners turned up, on a stone base, and a spire of rings on
    // top. Stands on (x, y), square to the garden.
    function pagoda(T, x, y, z, stories, rng) {
        const S = T.S, F = { P: (a, b, c) => [x + a, y + b, z + c], V: (a, b, c) => [a, b, c] };
        S.kind = INK;
        S.box(F, -4, -4, 0, 4, 4, 0.5);
        let w = 2.15, zc = 0.5, R = null;
        for (let i = 0; i < stories; i++) {
            const tall = stories > 3, last = i === stories - 1, sh = i ? (tall ? 2.1 : 2.3) : 3.3, oh = 2.2 - (tall ? 0.12 : 0.18) * i, fp = [-w, -w, w, w];
            S.kind = WOOD;
            S.box(F, -w, -w, zc, w, w, zc + sh - 0.05);
            // a balcony round the upper stories, with a rail
            if (i) {
                S.box(F, -w - 0.55, -w - 0.55, zc - 0.12, w + 0.55, w + 0.55, zc);
                if (T.detail && 0.55 * T.k * T.cam.ce > FINE) {
                    const e = w + 0.5;
                    S.line([F.P(-e, e, zc + 0.5), F.P(-e, -e, zc + 0.5), F.P(e, -e, zc + 0.5)]);
                }
            }
            for (let side = 0; side < 4; side++) {
                const W = kit.wall(F, side, fp);
                if (!T.sees(W.n)) continue;
                const { pu } = wallScale(T, W.at), third = W.len / 3;
                // a door in the middle bay and a lattice window either side
                if (third * pu > FINE * 2) for (const s of [third, 2 * third]) S.line([W.at(s, zc), W.at(s, zc + sh - 0.5)]);
                S.line([W.at(0, zc + sh - 0.5), W.at(W.len, zc + sh - 0.5)]);
                if (T.detail && (third / 2) * pu > FINE * 1.4) S.line([W.at(W.len / 2, zc), W.at(W.len / 2, zc + sh - 0.5)]);
            }
            S.kind = INK;
            const B = w + oh;
            R = curvedRoof(T, F, [-B, -B, B, B], 0, { seat: [oh, zc + sh], rise: last ? B * 0.72 : B * 0.44, lift: 0.5, sweep: 3.2, fascia: 0.26, flat: last ? 0.35 : 0.6 });
            if (last) break;
            // the next story stands in the roof: where its walls meet the slopes
            const wn = w - (tall ? 0.3 : 0.42), t = B - wn, up = 0.02;
            for (const s of [-1, 1]) {
                S.line([R.main(-wn, s, t), R.main(wn, s, t)].map(q => F.P(q[0], q[1], q[2] + up)));
                S.line([R.end(s, -wn, t), R.end(s, wn, t)].map(q => F.P(q[0], q[1], q[2] + up)));
            }
            zc = R.z + R.hgt(t) - 0.15;
            w = wn;
        }
        // the spire: a bowl, rings up a pole and a jewel
        const top = R.ridge, n = T.segs(0.5), rings = 5, gap = Math.max(0.42, (FINE * 1.25) / (T.k * T.cam.ce));
        S.lathe(x, y, [[0.55, z + top - 0.15], [0.42, z + top + 0.35], [0.14, z + top + 0.5]], n);
        S.frustum(x, y, z + top + 0.5, z + top + 0.9 + rings * gap + 0.7, 0.07, 0.05, 6);
        for (let i = 0; i < rings; i++) {
            const c = z + top + 0.9 + i * gap, r = 0.5 - 0.05 * i;
            S.lathe(x, y, [[r, c], [r, c + Math.min(0.14, gap * 0.4)]], n);
        }
        S.lathe(x, y, [[0.06, z + top + 1.5 + rings * gap], [0.16, z + top + 1.7 + rings * gap], [0, z + top + 2.05 + rings * gap]], Math.max(6, n >> 1));
    }

    // A bronze incense burner: a bowl on three legs under a little roof on posts
    function censer(T, x, y) {
        const S = T.S, n = T.segs(0.8);
        S.kind = INK;
        S.lathe(x, y, [[0.85, 0], [0.85, 0.22]], n);
        for (let i = 0; i < 3; i++) {
            const a = 0.4 + (TAU * i) / 3;
            S.line([[x + 0.5 * Math.cos(a), y + 0.5 * Math.sin(a), 0.22], [x + 0.45 * Math.cos(a), y + 0.45 * Math.sin(a), 0.55]]);
        }
        S.lathe(x, y, [[0.42, 0.55], [0.72, 0.8], [0.78, 1.05], [0.66, 1.15]], n);
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + (TAU * i) / 4;
            S.line([[x + 0.5 * Math.cos(a), y + 0.5 * Math.sin(a), 1.15], [x + 0.5 * Math.cos(a), y + 0.5 * Math.sin(a), 1.6]]);
        }
        S.lathe(x, y, [[0.98, 1.6], [0.82, 1.72], [0.16, 2.05], [0.08, 2.1], [0.08, 2.3], [0, 2.4]], n);
    }

    // A bell tower: a stone base, four posts with beams across their tops,
    // a bell hanging between them, and a hip-and-gable roof
    function belfry(T, x, y, rng) {
        const S = T.S, F = { P: (a, b, c) => [x + a, y + b, c], V: (a, b, c) => [a, b, c] };
        const zb = 1, h = 4.2, w = 1.6, pw = 0.16, zt = zb + h;
        S.kind = INK;
        S.box(F, -2.6, -2.6, 0, 2.6, 2.6, zb);
        kit.steps(T, F, 0, -2.6, 1.4, 4, zb / 4, 0.3);
        S.kind = WOOD;
        for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) S.box(F, sa * w - pw, sb * w - pw, zb, sa * w + pw, sb * w + pw, zt);
        // the beams, as four bars so the bell shows between them
        for (const s of [-1, 1]) {
            S.box(F, -w - 0.3, s * w - 0.14, zt - 0.36, w + 0.3, s * w + 0.14, zt);
            S.box(F, s * w - 0.14, -w - 0.3, zt - 0.36, s * w + 0.14, w + 0.3, zt);
        }
        // a rail round the platform
        if (T.detail) {
            const e = 2.3, zr = zb + 0.75;
            S.line([F.P(-e, e, zr), F.P(-e, -e, zr), F.P(-0.75, -e, zr)]);
            S.line([F.P(0.75, -e, zr), F.P(e, -e, zr), F.P(e, e, zr)]);
        }
        S.kind = INK;
        const top = zt - 0.55, bot = top - 1.8, n = T.segs(0.75);
        S.lathe(x, y, [[0.72, bot], [0.7, bot + 0.12], [0.6, bot + 0.55], [0.56, bot + 1.35], [0.46, bot + 1.62], [0, bot + 1.72]], n);
        S.line([[x, y, top - 0.05], [x, y, zt - 0.36]]);
        // two bands round the bell
        if (0.6 * T.k > 2) for (const f of [0.32, 0.75]) S.loop(ring(n, (c, s) => [x + (0.6 - f * 0.05) * 1.02 * c, y + (0.6 - f * 0.05) * 1.02 * s, bot + 0.2 + f * 1.2]).filter(q => (q[0] - x) * T.cam.fx + (q[1] - y) * T.cam.fy < 0.05));
        const R = curvedRoof(T, F, [-3.1, -3.1, 3.1, 3.1], 0, { seat: [1.35, zt + 0.1], rise: 3.1 * 0.8, gable: 3.1 * 0.52, lift: 0.55, sweep: 2.4, fascia: 0.24 });
        gableDress(T, R);
    }

    // A low bamboo fence of posts and rails from plan point a to b
    function bambooFence(T, a, b, h = 1.15) {
        const S = T.S, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) return;
        const at = (s, c) => [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L, c];
        S.kind = WOOD;
        const n = Math.max(1, Math.round(L / Math.max(1.5, 2.4 / T.k)));
        for (let i = 0; i <= n; i++) S.line([at((L * i) / n, 0), at((L * i) / n, h)]);
        const rails = h * T.k * T.cam.ce > FINE * 5 ? [0.35, 0.68, 1] : [0.5, 1];
        for (const f of rails) S.line([at(0, h * f), at(L, h * f)]);
    }

    // A bench to wait on before the tea, under a little roof of bark, with
    // a back wall behind it
    function waitingBench(T, x, y, ang) {
        const S = T.S, F = kit.turned(x, y, 0, ang), L = 1.6, D = 0.75, h = 2.1;
        S.kind = WOOD;
        S.box(F, -L, 0.2, 0, L, D, h - 0.1);
        S.box(F, -L + 0.1, -0.4, 0.42, L - 0.1, 0.2, 0.5);
        for (const s of [-1, 1]) {
            S.box(F, s * (L - 0.1) - 0.07, -0.65, 0, s * (L - 0.1) + 0.07, -0.51, h - 0.15);
            S.line([F.P(s * (L - 0.3), -0.3, 0), F.P(s * (L - 0.3), -0.3, 0.42)]);
        }
        S.kind = INK;
        curvedRoof(T, F, [-L - 0.3, -1, L + 0.3, D + 0.35], 0, { seat: [0.4, h], rise: 0.75, gable: 0, lift: 0.06, fascia: 0.12, tiles: false, layers: 1, ridge: false, flat: 0.7 });
    }

    // The little gate in a tea garden's fence: two posts under a roof of bark
    function wicketGate(T, x, y, ang) {
        const S = T.S, F = kit.turned(x, y, 0, ang), half = 0.85, ph = 2.25;
        S.kind = WOOD;
        for (const s of [-1, 1]) S.box(F, s * half - 0.09, -0.09, 0, s * half + 0.09, 0.09, ph);
        S.box(F, -half - 0.25, -0.08, ph - 0.22, half + 0.25, 0.08, ph);
        S.kind = INK;
        curvedRoof(T, F, [-1.35, -0.75, 1.35, 0.75], 0, { seat: [0.45, ph + 0.05], rise: 0.6, gable: 0, lift: 0.08, fascia: 0.12, tiles: false, layers: 1, ridge: false, flat: 0.7 });
    }

    // What shows in a gable: the bargeboards as a second line inside the
    // verge, and a grille of uprights under them
    function gableDress(T, R) {
        if (R.g > R.B - 1e-6 || !T.detail) return;
        const S = T.S, { P, V, A, B, g } = R;
        for (const sa of [-1, 1]) {
            if (!T.sees(V(sa, 0, 0))) continue;
            const a = sa * (A - g) + sa * 0.01, w = B - g, at = (b, c) => P(a, b, c);
            // the verge, from one foot over the top to the other
            const verge = [];
            for (let i = 0; i <= 12; i++) { const b = -w + (2 * w * i) / 12, q = R.main(sa * (A - g), b < 0 ? -1 : 1, B - Math.abs(b)); verge.push([b, q[2]]); }
            const { pu, pz } = wallScale(T, (s, c) => at(s, c)), top = verge[6][1], hgt = top - R.zb;
            const k = 1 - Math.max(0.28, (FINE * 1.5) / Math.min(pu, pz)) / Math.min(w, hgt);
            if (k < 0.35) continue;
            const inner = verge.map(([b, c]) => [b * k, R.zb + (c - R.zb) * k]);
            S.line(inner.map(([b, c]) => at(b, c)));
            const n = Math.floor((2 * w * k * pu) / 1.15);
            for (let i = 1; i < n; i++) {
                const b = -w * k + (2 * w * k * i) / n;
                let j = 0;
                while (j + 2 < inner.length && inner[j + 1][0] < b) j++;
                const c = lerp(inner[j][1], inner[j + 1][1], (b - inner[j][0]) / (inner[j + 1][0] - inner[j][0] || 1));
                if ((c - R.zb) * pz > FINE) S.line([at(b, R.zb), at(b, c)]);
            }
        }
    }

    // ------------------------------------------------------------------
    // The pond
    // ------------------------------------------------------------------

    // Find room for a pond and add it to the ground: lobes run together into
    // one shore, with moss round most of it and islets in the biggest lobe
    // when there's room. o: { room (x, y) how far a point is from anything in
    // the way, r its radius, lobes, islets, big }. Returns nothing when it won't fit.
    function planPond(T, plan, rng, N, o) {
        const { p } = T, G = plan.ground, [x0, y0, x1, y1] = plan.rect, room = o.room;
        let r = o.r * rng.range(0.85, 1.08), c1 = null;
        // as big as that if it fits somewhere, and smaller until it does
        for (let shrink = 0; shrink < 5 && !c1; shrink++, r *= c1 ? 1 : 0.8) {
            let score = -Infinity;
            for (let k = 0; k < 90; k++) {
                const x = rng.range(x0, x1), y = rng.range(y0, y1), rm = room(x, y);
                if (rm < r * 1.25 + 3) continue;
                const v = (plan.inView(x, y, r * 1.9) ? 24 : plan.inView(x, y, r * 0.8) ? 8 : 0) + Math.min(rm, 16) * 0.4 + rng.range(0, 4);
                if (v > score) { score = v; c1 = [x, y]; }
            }
        }
        if (!c1) return null;
        const wobble = (cx, cy, rr) => {
            const ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
            return (x, y) => {
                const d = Math.hypot(x - cx, y - cy);
                if (d - rr * 1.2 > FAR + 4) return d - rr * 1.2;
                const t = Math.atan2(y - cy, x - cx);
                return d - rr * (1 + 0.12 * Math.sin(2 * t + ph) + 0.08 * Math.sin(3 * t + ph2));
            };
        };
        const lobes = [{ c: c1, r, f: wobble(c1[0], c1[1], r) }];
        // more lobes, each off to whichever side has the most room
        for (let j = 1; j < o.lobes; j++) {
            const rj = r * rng.range(0.5, 0.7);
            let best = null, most = 0;
            for (let k = 0; k < 14; k++) {
                const a = rng.range(0, TAU), q = [c1[0] + r * 1.12 * Math.cos(a), c1[1] + r * 1.12 * Math.sin(a)];
                const rm = room(q[0], q[1]) - rj - 2.5 - (lobes.some(L => Math.hypot(L.c[0] - q[0], L.c[1] - q[1]) < L.r * 0.9) ? 99 : 0);
                if (rm > most) { most = rm; best = q; }
            }
            if (best) lobes.push({ c: best, r: rj, f: wobble(best[0], best[1], rj) });
        }
        const shore = (x, y) => {
            let d = lobes[0].f(x, y);
            for (let j = 1; j < lobes.length; j++) d = smin(d, lobes[j].f(x, y), r * 0.5);
            return d;
        };
        const R = Math.max(...lobes.map(L => Math.hypot(L.c[0] - c1[0], L.c[1] - c1[1]) + L.r * 1.2));
        const pond = { c: c1, r, R, shore, big: !!o.big, islets: [], box: grow(bounds(lobes.flatMap(L => [[L.c[0] - L.r * 1.2, L.c[1] - L.r * 1.2], [L.c[0] + L.r * 1.2, L.c[1] + L.r * 1.2]])), 1.5) };
        // islets, well out in the water and clear of each other
        const isles = [];
        for (let i = 0; i < o.islets && r > 4.4; i++) {
            const ri = r * (i ? rng.range(0.16, 0.2) : rng.range(0.25, 0.3));
            for (let k = 0; k < 40; k++) {
                // the second goes out into any of the lobes
                const L = i ? lobes[k % lobes.length] : lobes[0], a = rng.range(0, TAU), d = i ? rng.range(0.2, 0.75) * L.r : r * 0.14;
                const ci = [L.c[0] + d * Math.cos(a), L.c[1] + d * Math.sin(a)];
                if (shore(ci[0], ci[1]) > -(ri * 1.2 + 2) || isles.some(q => Math.hypot(q.c[0] - ci[0], q.c[1] - ci[1]) < q.r + ri + 2.5)) continue;
                isles.push({ c: ci, r: ri, f: wobble(ci[0], ci[1], ri) });
                break;
            }
        }
        pond.islets = isles.map(q => ({ c: q.c, r: q.r }));
        pond.islet = pond.islets[0];
        pond.water = isles.length ? (x, y) => { let d = shore(x, y); for (const q of isles) d = Math.max(d, -q.f(x, y)); return d; } : shore;
        for (const q of isles) G.mossy.push(q.f);
        G.water = pond.water;
        // moss round the shore, with stretches where the gravel comes down to the water
        const lush = Math.min(1, 2 * p.moss) * (0.5 + p.moss), ox = rng.range(0, 99);
        G.mossy.push((x, y) => {
            const d = shore(x, y);
            return d - 3.2 * lush > FAR ? d - 3.2 * lush : d - clamp(2.6 * (0.3 + 1.3 * N.noise2(x / 8 + ox, y / 8)), 0, 3.2) * lush;
        });
        return pond;
    }

    // A flat bridge of two long stone slabs from a to b, offset at the middle
    function slabBridge(T, a, b) {
        const S = T.S, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const F = kit.turned(a[0], a[1], 0, ang), w = 0.75, m = L / 2;
        S.kind = INK;
        S.box(F, -0.2, -w / 2 - 0.25, 0.08, m + 0.15, w / 2 - 0.25, 0.32);
        S.box(F, m - 0.15, -w / 2 + 0.25, 0.08, L + 0.2, w / 2 + 0.25, 0.32);
    }

    // An arched footbridge from a to b (plan points), w wide
    function archBridge(T, a, b, w, rng) {
        const S = T.S, L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
        const rise = clamp(L * 0.24, 0.5, 1.5), th = 0.16, hw = w / 2, m = Math.max(8, Math.round((L * T.k) / 1.6));
        const zs = s => 0.08 + rise * Math.max(0, Math.sin(Math.PI * clamp(s / L, 0, 1))) ** 0.85;
        const P = (s, o, c) => [a[0] + d[0] * s + n[0] * o, a[1] + d[1] * s + n[1] * o, c];
        S.kind = MAPLE;
        for (let i = 0; i < m; i++) {
            const s0 = (L * i) / m, s1 = (L * (i + 1)) / m;
            S.prism([P(s0, -hw, zs(s0) - th), P(s1, -hw, zs(s1) - th), P(s1, -hw, zs(s1)), P(s0, -hw, zs(s0))], [n[0] * w, n[1] * w, 0], false, true);
        }
        const along = (o, dz) => Array.from({ length: m + 1 }, (_, i) => P((L * i) / m, o, zs((L * i) / m) + dz));
        for (const o of [-hw, hw]) {
            S.line(along(o, 0));
            if (T.sees([n[0] * o, n[1] * o, 0]) && th * T.k * T.cam.ce > FINE * 0.6) S.line(along(o, -th));
        }
        for (const s of [0, L]) S.line([P(s, -hw, zs(s)), P(s, hw, zs(s))]);
        // the rails, on posts with a cap at each end
        const hr = 0.8, posts = Math.max(2, Math.round(L / Math.max(1.1, 2.6 / T.k)));
        for (const o of [-hw + 0.06, hw - 0.06]) {
            S.line(along(o, hr));
            if (T.detail && hr * T.k * T.cam.ce > FINE * 3) S.line(along(o, hr * 0.5));
            for (let i = 0; i <= posts; i++) {
                const s = (L * i) / posts, top = i === 0 || i === posts ? hr + 0.22 : hr;
                S.line([P(s, o, zs(s)), P(s, o, zs(s) + top)]);
            }
        }
        if (S.shadow) S.castShadow(along(-hw, 0).concat(along(hw, 0)));
    }

    // A koi seen from above: a body that tapers to a forked tail
    function koi(T, x, y, ang, len) {
        const S = T.S, c = Math.cos(ang), s = Math.sin(ang), w = len * 0.17;
        const P = (u, v) => [x + u * c - v * s, y + u * s + v * c, 0.01];
        S.line([P(-len * 0.5, w * 0.9), P(-len * 0.3, 0), P(0, w), P(len * 0.35, w * 0.6), P(len * 0.5, 0), P(len * 0.35, -w * 0.6), P(0, -w), P(-len * 0.3, 0), P(-len * 0.5, -w * 0.9)], true);
    }

    // The pond: its shore, ripples along it, rocks at the water's edge, a
    // lantern, lily pads, koi, and bridges out to the islets
    function drawPond(T, plan, rng, claims) {
        const { S, p, cam } = T, pond = plan.pond, G = plan.ground;
        const grid = new Grid(pond.box, clamp(0.7 / T.k, 0.1, 0.35)), water = grid.fill(pond.water);
        S.kind = INK;
        for (const line of PG.isolines(grid.field(water), 0)) S.line(at3(line, 0.01));
        if (p.ripples) {
            S.kind = WATER;
            const gap = Math.max(0.55, (FINE * 1.5) / (T.k * cam.se));
            for (const d of pond.big ? [gap, gap * 2.2, gap * 3.6] : [gap, gap * 2.3]) {
                for (const line of PG.isolines(grid.field(water), -d)) if (geo.pathLength(line) * T.k > 6) S.line(at3(line, 0.01));
            }
        }
        // a point of the shore out from c at angle a
        const shoreAt = (c, a, f) => {
            let lo = 0, hi = pond.R * 3;
            for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (f(c[0] + m * Math.cos(a), c[1] + m * Math.sin(a)) < 0) lo = m; else hi = m; }
            return [c[0] + lo * Math.cos(a), c[1] + lo * Math.sin(a), lo];
        };
        pond.bridges = [];
        pond.islets.forEach((I, n) => {
            // the bridge takes a short way over, side on to the camera if it can be, so the arch shows
            let best = null;
            for (let k = 0; k < 24; k++) {
                const a = (TAU * k) / 24, q = shoreAt(I.c, a, (x, y) => (Math.hypot(x - I.c[0], y - I.c[1]) < I.r * 0.8 ? -1 : pond.shore(x, y)));
                const span = q[2] - I.r, cost = span * (1 + 2.5 * (Math.cos(a) * cam.fx + Math.sin(a) * cam.fy) ** 2);
                const land = [q[0] + 1.2 * Math.cos(a), q[1] + 1.2 * Math.sin(a)];
                if (span > 1.8 && span < (n ? 6 : 8) && G.open(land[0], land[1]) > 0.8 && (!best || cost < best.cost)) best = { a, span, q, cost };
            }
            if (best && rng.chance(n ? 0.7 : 1)) {
                const a = best.a, from = [I.c[0] + (I.r - 0.7) * Math.cos(a), I.c[1] + (I.r - 0.7) * Math.sin(a)], to = [best.q[0] + 0.9 * Math.cos(a), best.q[1] + 0.9 * Math.sin(a)];
                if (n === 0) archBridge(T, from, to, 1.3, rng);
                else slabBridge(T, from, to);
                pond.bridges.push([from, to]);
                claims.take(to[0], to[1], 1.2);
            }
            claims.take(I.c[0], I.c[1], 0.9);
            const roll = rng.random();
            if (n === 0) {
                if (roll < 0.3 + 0.5 * p.pines) pine(T, I.c[0], I.c[1], 0, rng, pond.big ? 0.95 : 0.75);
                else snowLantern(T, I.c[0], I.c[1], 0, 1.1);
            } else {
                // a turtle island: rocks, with a small pine among them
                for (const st of planRocks(I.c[0], I.c[1], I.r * 0.35, 3, rng)) rock(T, st, 0);
                if (roll < 0.6) pine(T, I.c[0] + I.r * 0.4, I.c[1] - I.r * 0.2, 0, rng, 0.65);
            }
        });
        const nearBridge = (x, y) => pond.bridges.some(b => distToPath(b, x, y) < 1.3);
        // rocks along the shore, half in the water
        for (let i = pond.big ? rng.int(10, 15) : rng.int(5, 8); i > 0; i--) {
            const q = shoreAt(pond.c, rng.range(0, TAU), pond.shore), size = rng.range(0.3, 0.5), n = rng.int(1, 2);
            if (nearBridge(q[0], q[1]) || !claims.free(q[0], q[1], 0.9)) continue;
            claims.take(q[0], q[1], 0.8);
            for (const st of planRocks(q[0], q[1], size, n, rng)) rock(T, st, 0);
        }
        // a snow lantern at the water's edge on the near side
        const la = Math.atan2(-cam.fy, -cam.fx) + rng.range(-0.9, 0.9);
        if (p.lanterns > 0) {
            const q = shoreAt(pond.c, la, pond.shore), x = q[0] + 0.8 * Math.cos(la), y = q[1] + 0.8 * Math.sin(la);
            if (claims.free(x, y, 0.9) && G.open(x, y) > 0.5) { claims.take(x, y, 0.9); snowLantern(T, x, y, 0, 1); }
        }
        const wet = (x, y, d) => pond.water(x, y) < -d && !nearBridge(x, y);
        const [bx0, by0, bx1, by1] = pond.box, things = [];
        const room = (x, y, r) => things.every(q => Math.hypot(q[0] - x, q[1] - y) > q[2] + r);
        S.kind = MOSS;
        const pad = 0.3, pads = pad * T.k * cam.se > FINE * 0.6;
        for (let clumps = pond.big ? rng.int(2, 4) : rng.int(1, 3), tries = 40; clumps > 0 && tries > 0; tries--) {
            const cx = rng.range(bx0, bx1), cy = rng.range(by0, by1);
            if (!wet(cx, cy, pad * 3)) continue;
            clumps--;
            for (let j = rng.int(4, 7); j > 0; j--) {
                const x = cx + rng.range(-1.4, 1.4) * pad * 3, y = cy + rng.range(-1.4, 1.4) * pad * 3, r = pad * rng.range(0.8, 1.15), a0 = rng.range(0, TAU);
                if (!wet(x, y, r + 0.3) || !room(x, y, r + pad * 0.5)) continue;
                things.push([x, y, r]);
                if (!pads) continue;
                // a round leaf with a notch cut out of it
                const n = 12, leaf = Array.from({ length: n + 1 }, (_, k) => { const a = a0 + 0.3 + ((TAU - 0.6) * k) / n; return [x + r * Math.cos(a), y + r * Math.sin(a), 0.012]; });
                S.line(leaf.concat([[x + r * 0.25 * Math.cos(a0), y + r * 0.25 * Math.sin(a0), 0.012], leaf[0]]), true);
            }
        }
        S.kind = MAPLE;
        const len = 0.65, fish = len * T.k > 2.2;
        for (let n = Math.round(rng.range(4, 8) * p.koi * (pond.big ? 1.8 : 1)), tries = 160; n > 0 && tries > 0; tries--) {
            const x = rng.range(bx0, bx1), y = rng.range(by0, by1), a = rng.range(0, TAU), f = rng.range(0.85, 1.15);
            if (!wet(x, y, len * 0.75) || !room(x, y, len * 0.8)) continue;
            n--;
            things.push([x, y, len * 0.6]);
            if (fish) koi(T, x, y, a, len * f);
        }
        // Out on open water, level strokes across the page in staggered rows,
        // clear of the shore, the islets, and the bridges
        if (pond.big && p.ripples) {
            S.kind = WATER;
            const row = 3.4 / (T.k * cam.se), u0 = Math.min(...[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => x * cam.rx + y * cam.ry));
            const u1 = Math.max(...[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => x * cam.rx + y * cam.ry));
            const v0 = Math.min(...[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => x * cam.fx + y * cam.fy));
            const v1 = Math.max(...[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => x * cam.fx + y * cam.fy));
            const at = (u, v) => [u * cam.rx + v * cam.fx, u * cam.ry + v * cam.fy];
            const clearOf = Math.max(1.6, (FINE * 4) / (T.k * cam.se));
            for (let v = v0 + row / 2, j = 0; v < v1; v += row, j++) {
                for (let u = u0 + (j & 1 ? 3.5 : 0) / T.k; u < u1; ) {
                    const len2 = rng.range(3, 6) / T.k, gap = rng.range(4, 9) / T.k, a = at(u, v), b = at(u + len2, v), m = at(u + len2 / 2, v);
                    if ([a, b, m].every(q => wet(q[0], q[1], clearOf)) && room(m[0], m[1], 0.4)) S.line([[a[0], a[1], 0.01], [b[0], b[1], 0.01]], true);
                    u += len2 + gap;
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // The tea house and its garden
    // ------------------------------------------------------------------

    // A tea house: a small thatched hut with a crawl door and a round window
    function teaHouse(T, lot) {
        const S = T.S, F = lotFrame(lot.rect, lot.face), { P, W: L, D } = F, zf = 0.4, zt = zf + 2.5;
        const body = [0.5, 1, L - 0.5, D - 0.3];
        S.kind = WOOD;
        S.box(F, body[0] - 0.1, body[1] - 0.1, 0, body[2] + 0.1, body[3] + 0.1, zf);
        S.box(F, body[0], body[1], zf, body[2], body[3], zt - 0.05);
        const front = kit.wall(F, 0, body);
        if (T.sees(front.n)) {
            const { pu, pz } = wallScale(T, front.at);
            // the crawl door, low down, and the round window with its lattice
            const ds = front.len * 0.26, ws = front.len * 0.7, wr = 0.5, wz = zf + 0.8;
            kit.rect(T, front.at, ds - 0.36, zf + 0.05, 0.72, 0.75);
            if (wr * Math.min(pu, pz) > FINE * 1.3) {
                S.loop(ring(T.segs(wr), (c, s) => front.at(ws + wr * c, wz + wr * s)));
                if (T.detail && wr * Math.min(pu, pz) > FINE * 2.4) {
                    S.line([front.at(ws, wz - wr), front.at(ws, wz + wr)]);
                    S.line([front.at(ws - wr, wz), front.at(ws + wr, wz)]);
                }
            }
            S.kind = INK;
            S.box(F, body[0] + ds - 0.4, body[1] - 0.75, 0, body[0] + ds + 0.4, body[1] - 0.15, 0.22);
            S.kind = WOOD;
        }
        for (const side of [1, 3]) {
            const Wl = kit.wall(F, side, body);
            if (T.sees(Wl.n)) kit.pane(T, Wl.at, Wl.len * 0.3, zf + 0.75, Wl.len * 0.4, 0.8, 'split');
        }
        S.kind = INK;
        const R = curvedRoof(T, F, [-0.1, 0.4, L + 0.1, D + 0.3], 0, { seat: [0.6, zt], rise: ((D - 0.1) / 2) * 0.95, lift: 0.1, tiles: false, layers: 2, fascia: 0.34, flat: 0.8, ridge: false });
        // a bark ridge cap held down with bamboo
        if (R.half > 0.3) S.box({ P: R.P }, -R.half - 0.15, -0.28, R.ridge - 0.12, R.half + 0.15, 0.28, R.ridge + 0.16);
        return { door: P(body[0] + (L - 1) * 0.26, body[1] - 0.95, 0) };
    }

    // A stone water basin with a bamboo spout, and the stones round it
    function basin(T, x, y, rng) {
        const S = T.S, n = T.segs(0.36), a = rng.range(0, TAU);
        S.kind = INK;
        S.lathe(x, y, [[0.3, 0], [0.38, 0.22], [0.36, 0.42]], n);
        if (0.24 * T.k * T.cam.se > FINE * 0.6) S.loop(ring(n, (c, s) => [x + 0.24 * c, y + 0.24 * s, 0.425]));
        for (const st of planRocks(x + 0.75 * Math.cos(a), y + 0.75 * Math.sin(a), 0.26, 1, rng)) rock(T, { ...st, h: 0.22, top: 0.7 }, 0);
        S.kind = WOOD;
        const bx = x + 0.6 * Math.cos(a + 2.2), by = y + 0.6 * Math.sin(a + 2.2);
        S.line([[bx, by, 0], [bx, by, 0.75], [x + 0.08 * Math.cos(a + 2.2), y + 0.08 * Math.sin(a + 2.2), 0.6]]);
    }

    // Stepping stones along a path (plan points), a stride apart
    function steppingStones(T, pts, rng, ok) {
        const S = T.S, stride = 0.78, r0 = stride * 0.29, big = r0 * T.k * T.cam.se > FINE * 0.55;
        let carry = stride * 0.5;
        S.kind = INK;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L < 1e-6) continue;
            const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            let s = carry;
            for (; s < L; s += stride) {
                const side = rng.range(-0.1, 0.1) * stride, x = a[0] + d[0] * s - d[1] * side, y = a[1] + d[1] * s + d[0] * side;
                const n = 7, a0 = rng.range(0, TAU), ang = Math.atan2(d[1], d[0]), stone = [];
                for (let k = 0; k < n; k++) {
                    const t = a0 + (TAU * k) / n, rr = r0 * rng.range(0.85, 1.1), u = rr * 0.85 * Math.cos(t), v = rr * 1.2 * Math.sin(t);
                    stone.push([x + u * Math.cos(ang) - v * Math.sin(ang), y + u * Math.sin(ang) + v * Math.cos(ang), 0.05]);
                }
                if (!big || (ok && !ok(x, y))) continue;
                S.face(stone, false);
                S.loop(stone);
            }
            carry = s - L;
        }
    }

    // A smooth path through plan points
    const curve = pts => geo.chaikin(pts, 3, false);

    // ------------------------------------------------------------------
    // People
    // ------------------------------------------------------------------

    // Someone in a robe, a cut-out facing the camera. hat: a wide straw hat. With
    // `rake`, they hold one out in front of them along (dx, dy).
    function robed(T, x, y, z, rng, hat, rake) {
        const S = T.S, ce = T.cam.ce, P = card(T, x, y, z, 0), h = rng.range(1.55, 1.75), hr = 0.13;
        S.kind = FIGURE;
        unshaded(S, () => {
            const body = [P(-0.26, 0), P(0.26, 0), P(0.2, h - 0.34), P(0.12, h - 0.26), P(-0.12, h - 0.26), P(-0.2, h - 0.34)];
            S.face(body);
            S.loop(body);
            if (hat) {
                const brim = [P(-0.36, h - 0.1), P(0.36, h - 0.1), P(0, h + 0.18 / ce)];
                S.face(brim);
                S.loop(brim);
            } else {
                const head = ring(T.segs(hr), (c, s) => P(hr * c, h - hr / ce + (hr * s) / ce));
                S.face(head);
                S.loop(head);
            }
            if (rake) {
                const [dx, dy] = rake, tip = [x + dx * 1.7, y + dy * 1.7, z + 0.03], nx = -dy * 0.32, ny = dx * 0.32;
                S.line([P(0.16, h - 0.6), tip]);
                S.line([[tip[0] - nx, tip[1] - ny, tip[2]], [tip[0] + nx, tip[1] + ny, tip[2]]]);
            }
        });
        castDisc(S, x, y, z + h * 0.5, 0.22);
    }

    // Someone sitting on the edge of a veranda at (x, y), floor height z, facing `out`
    function seated(T, x, y, z, out, rng) {
        const S = T.S, ce = T.cam.ce, P = card(T, x, y, z, 0), hr = 0.12, h = rng.range(0.78, 0.9);
        S.kind = FIGURE;
        unshaded(S, () => {
            const body = [P(-0.22, 0), P(0.22, 0), P(0.17, h - 0.3), P(-0.17, h - 0.3)];
            S.face(body);
            S.loop(body);
            const head = ring(T.segs(hr), (c, s) => P(hr * c, h - 0.18 - hr / ce + ((hr * s) / ce) + 0.2));
            S.face(head);
            S.loop(head);
            // legs over the edge
            for (const o of [-0.1, 0.1]) S.line([[x - out[1] * o, y + out[0] * o, z], [x - out[1] * o + out[0] * 0.42, y + out[0] * o + out[1] * 0.42, z], [x - out[1] * o + out[0] * 0.45, y + out[0] * o + out[1] * 0.45, z - 0.42]]);
        });
    }

    // ------------------------------------------------------------------
    // The plan
    // ------------------------------------------------------------------

    function makePlan(T, seed) {
        return T.p.garden === 'court' ? planCourt(T, seed) : planGarden(T, seed);
    }

    // A dry garden, a pond garden, or a tea garden, seen across a corner
    function planGarden(T, seed) {
        const { p } = T, rng = new PG.RNG(hash(seed, 1)), kind = p.garden;
        // Each feature draws from a stream of its own, and so does each
        // island, so a control only changes what it's about
        const own = (...k) => new PG.RNG(hash(seed, ...k));
        // The patch of ground the page shows at the default view size. The garden
        // is the same size on any page: its far and near corners just fit an
        // upright one, with the corners to either side off the page.
        const k0 = viewScale(T.PW, T.PH, SIZE0), U0 = T.PW / k0, V0 = T.PH / (k0 * SE0);
        const total = rng.range(110, 120), skew = rng.range(-0.06, 0.06);
        const A = (total * (0.5 + skew)) / 2, B = (total * (0.5 - skew)) / 2;
        const mirror = p.side === 'right';
        // Planned with the hall along the far wall on the left, and turned over for the right
        const W2 = (a, b) => (mirror ? [b, a] : [a, b]);
        const R2 = ([a0, b0, a1, b1]) => (mirror ? [b0, a0, b1, a1] : [a0, b0, a1, b1]);
        const face = f => (mirror ? 3 - f : f);
        const plan = { kind, mirror, W2, R2, A, B, rect: R2([-A, -B, A, B]), gates: [], halls: [], cones: [], groves: [] };
        // what the page shows at the default view: across it and into it, in meters from the middle
        const across = (a, b) => (a - b) / Math.SQRT2, into = (a, b) => (a + b) / Math.SQRT2;
        plan.inView = (x, y, m = 0) => Math.abs(across(x, y)) < U0 / 2 - m && Math.abs(into(x, y)) < V0 / 2 - m;
        const G = (plan.ground = new Ground(plan.rect)), N = PG.makeNoise(rng);
        plan.rakeAngle = (mirror ? Math.PI / 2 : 0) + geo.rad(p.rakeTurn) * (mirror ? -1 : 1);
        // 1 at the default, nothing at none
        const lush = p.moss <= 0.5 ? 2 * p.moss : 1 + 0.9 * (p.moss - 0.5);
        const grove = (a, b, r, gr) => {
            const [cx, cy] = W2(a, b), ph = gr.range(0, TAU), ph2 = gr.range(0, TAU);
            if (!(r > 0.3)) return;
            // where a tree would stand in it: in from the wall, or from the corner
            const d = clamp(r * 0.5, 2.6, 4.4), ta = Math.abs(a) > A - 0.01 ? a - Math.sign(a) * d : a, tb = Math.abs(b) > B - 0.01 ? b - Math.sign(b) * d : b;
            if (r > 4.4 && (ta !== a || tb !== b)) plan.groves.push({ at: W2(ta, tb), r });
            const f = (x, y) => {
                const d = Math.hypot(x - cx, y - cy);
                if (d - r * 1.31 > FAR) return d - r * 1.31;
                const t = Math.atan2(y - cy, x - cx);
                return d - r * (1 + 0.2 * Math.sin(2 * t + ph) + 0.11 * Math.sin(5 * t + ph2));
            };
            G.mossy.push(Object.assign(f, { c: [cx, cy], R: r * 1.31 }));
        };

        // The hall along the far wall, as much of it in view as will fit
        const vw = 1.7, eave = 2;
        const hl = kind === 'tea' ? clamp(A * rng.range(0.6, 0.78), 11, 17) : clamp(A * rng.range(1.02, 1.2), 13, 23);
        const hd = clamp(0.42 * hl, 7.5, 9.5) + vw, back = B - eave - 1.2, front = back - hd;
        const ha = clamp(A - rng.range(4.5, 7) - hl / 2, -A + hl / 2 + 4, A - hl / 2 - 4);
        plan.hall = {
            rect: R2([ha - hl / 2, front, ha + hl / 2, back]), face: face(0), veranda: vw, eave, wall: 4,
            roof: p.roof, pitch: rng.range(0.74, 0.86), lift: rng.range(0.45, 0.7),
        };
        G.solids.push(grow(plan.hall.rect, 0.6));
        plan.halls.push(plan.hall);

        // Beside it, along the other far wall and in front of the hall: a
        // smaller hall, a pagoda, or a tea house
        const arng = own(11), room = front - 3.5 + B - 9;
        // a tea garden has its tea house out in the middle instead
        let annex = room >= 7.5 && kind !== 'tea' ? p.annex : 'none';
        if (annex === 'pagoda') {
            // it has to fit on the page, spire and all
            const tall = 16.5 * (Math.cos(geo.rad(40)) / SE0), wide = 4.4 * Math.SQRT2, a = A - 8.4;
            const hi = Math.min(front - 9, (V0 / 2 - tall - 0.5) * Math.SQRT2 - a), lo = Math.max(-B + 10, a - (U0 / 2 - wide - 0.3) * Math.SQRT2);
            if (hi >= lo) {
                const b = lerp(lo, hi, arng.range(0.6, 1));
                plan.pagoda = W2(a, b);
                G.solids.push(R2([a - 4.5, b - 4.5, a + 4.5, b + 4.5]));
            } else annex = 'hall';
        }
        if (annex === 'hall') {
            const sd = 6.4, se = 1.6, a1 = A - se - 1.2, b1 = Math.min(front - 3.5, A - sd - se + U0 / Math.SQRT2 - 26), sl = Math.min(arng.range(9, 11.5), room), b0 = Math.max(b1 - sl, -B + 9);
            plan.wing = {
                rect: R2([a1 - sd, b0, a1, b0 + sl]), face: face(3), veranda: 1.3, eave: se, wall: 3.3,
                roof: arng.pick(['hip', 'gable', 'irimoya']), pitch: arng.range(0.74, 0.86), lift: arng.range(0.3, 0.5),
            };
            G.solids.push(grow(plan.wing.rect, 0.6));
            plan.halls.push(plan.wing);
        }
        if (annex === 'tea') {
            // the tea house stands in moss, with stepping stones over to it from beside the hall's steps
            const tl = 5.4, td = 4.6, a1 = A - arng.range(4.5, 6), b1 = Math.min(front - arng.range(5, 8), A - td + U0 / Math.SQRT2 - 24), rect = [a1 - td, b1 - tl, a1, b1];
            plan.tea = { rect: R2(rect), face: face(3) };
            G.solids.push(grow(plan.tea.rect, 0.15));
            grove(a1 - td * 0.6, b1 - tl / 2, arng.range(7.5, 9.5) * clamp(lush, 0.9, 1.2), arng);
            const door = [a1 - td - 1.3, b1 - tl * 0.72], bend = arng.range(-2, 2), start = [ha + 2, front - 2.2];
            plan.tea.path = curve([start, [ha + 3.2, front - 5 + bend * 0.3], [lerp(ha, door[0], 0.6), lerp(front - 5, door[1], 0.5) + bend], [door[0] - 1.6, door[1] - 0.6], door].map(q => W2(q[0], q[1])));
            plan.tea.basin = W2(door[0] - 0.4, door[1] - 2.4);
            G.paths.push({ pts: plan.tea.path, hw: 0.62, box: bounds(plan.tea.path) });
        }

        // The gate, in the near wall the hall looks out at, where the page shows it
        const open = 3, reach = U0 / Math.SQRT2 - 12;
        const ga = clamp(ha, -A + 5, Math.min(A - 5, -B + reach));
        plan.gate = gateLot(plan, mirror ? 3 : 0, A + WALL.t / 2 + (mirror ? -ga : ga), open);
        plan.gates.push(plan.gate);
        // the path up to it from outside
        const out = W2(0, -1);
        plan.gate.path = [[plan.gate.c[0] + out[0] * 1.6, plan.gate.c[1] + out[1] * 1.6], [plan.gate.c[0] + out[0] * 90, plan.gate.c[1] + out[1] * 90]];
        // a stone landing inside it, with no moss round it
        const landing = R2([ga - open / 2 - 0.4, -B, ga + open / 2 + 0.4, -B + 1.5]);
        G.solids.push(landing);
        G.clear.push(grow(landing, 1.2));
        // and a paved path from there to the stone in front of the hall's steps, turning square
        if (p.path && kind === 'dry') {
            const b0 = -B + 1.5, b1 = front - 1.3, hw = 0.85, bm = lerp(b0, b1, own(16).range(0.55, 0.8));
            const pts = (Math.abs(ga - ha) < 0.5 ? [[ga, b0], [ga, b1]] : [[ga, b0], [ga, bm], [ha, bm], [ha, b1]]).map(q => W2(q[0], q[1]));
            plan.path = { pts, hw };
            G.paths.push({ pts, hw, box: grow(bounds(pts), hw) });
            G.clear.push(grow(bounds(pts.slice(-2)), hw + 1.4));
        }

        // In a pond garden or a tea garden the ground is moss, but for a court
        // of raked gravel in front of the hall
        if (kind !== 'dry') {
            const cr = own(19), cd = kind === 'pond' ? cr.range(8, 10.5) : cr.range(6.5, 8.5), court = R2([ha - hl / 2 - 2.5, front - cd, ha + hl / 2 + 2.5, front + 1]);
            plan.court = court;
            plan.courtFront = W2(ha, front - cd);
            plan.courtB0 = front - cd;
            G.mossy.push((x, y) => -sdRect(court, x, y));
        }
        const courtRoom = (x, y) => (plan.court ? sdRect(plan.court, x, y) : Infinity);

        // The tea garden: the tea house out in the moss, reached by stepping
        // stones from the gate through a bamboo fence with a little gate in it
        if (kind === 'tea') {
            const tr = own(18), tl = tr.range(6.6, 7.6), td = tr.range(5.6, 6.2);
            let best = null, score = -Infinity;
            for (let k = 0; k < 60; k++) {
                const ca = tr.range(-A + 8, A - 8), cb = tr.range(-B + 13, front - 2), jitter = tr.range(0, 10);
                const [x, y] = W2(ca, cb);
                if (!plan.inView(x, y, 8) || courtRoom(x, y) < 7 || Math.hypot(ca - ga, cb + B) < 16) continue;
                const v = Math.hypot(ca - ga, cb + B) * 0.15 + jitter;
                if (v > score) { score = v; best = [ca, cb]; }
            }
            if (!best) best = [lerp(-A, ha, 0.35), lerp(-B, front, 0.6)];
            const [ca, cb] = best, rect = [ca - tl / 2, cb - td / 2, ca + tl / 2, cb + td / 2];
            plan.tea = { rect: R2(rect), face: face(0) };
            G.solids.push(grow(plan.tea.rect, 0.15));
            // the crawl door is on the front, a quarter of the way along
            const door = [rect[0] + 0.5 + 0.26 * (tl - 1), rect[1] - 1.7], start = [ga, -B + 2.4];
            const dx = door[0] - start[0], dy = door[1] - start[1], dl = Math.hypot(dx, dy), n = [-dy / dl, dx / dl], w = tr.range(2.5, 4.5) * tr.sign();
            const m1 = [lerp(start[0], door[0], 0.35) + n[0] * w, lerp(start[1], door[1], 0.35) + n[1] * w];
            const m2 = [lerp(start[0], door[0], 0.72) - n[0] * w * 0.7, lerp(start[1], door[1], 0.72) - n[1] * w * 0.7];
            const pts = curve([start, m1, m2, [door[0], door[1] - 1.4], door]);
            plan.tea.path = pts.map(q => W2(q[0], q[1]));
            G.paths.push({ pts: plan.tea.path, hw: 0.62, box: bounds(plan.tea.path) });
            // the basin beside the path just before the door
            const e = pts[pts.length - 4], f = pts[pts.length - 1], el = Math.hypot(f[0] - e[0], f[1] - e[1]) || 1;
            plan.tea.basin = W2(f[0] - ((f[0] - e[0]) / el) * 1.2 + ((f[1] - e[1]) / el) * 1.6, f[1] - ((f[1] - e[1]) / el) * 1.2 - ((f[0] - e[0]) / el) * 1.6);
            // the fence runs across the garden between the gate and the tea house, and the path goes through its gate
            const bf = Math.min(lerp(start[1], door[1], 0.52), (plan.court ? plan.courtB0 : front) - 2);
            let gx = null;
            for (let i = 0; i + 1 < pts.length && gx === null; i++) {
                const [a0, b0] = pts[i], [a1, b1] = pts[i + 1];
                if ((b0 - bf) * (b1 - bf) <= 0 && b1 !== b0) gx = a0 + ((bf - b0) * (a1 - a0)) / (b1 - b0);
            }
            if (gx !== null) {
                const half = 1.05, toLeft = gx < 0, reach = tr.range(5, 9);
                const ends = toLeft ? [[-A + 0.35, gx - half], [gx + half, gx + half + reach]] : [[gx - half - reach, gx - half], [gx + half, A - 0.35]];
                // on the gate's side of the fence, a step along it
                const bs = toLeft ? gx + half + 2.4 : gx - half - 2.4, bb = bf - 2.4;
                plan.tea.bench = { at: W2(bs, bb), ang: mirror ? Math.PI / 2 : 0, face: mirror ? -1 : 1 };
                plan.tea.fence = ends.filter(([u, v]) => v - u > 1).map(([u, v]) => [W2(u, bf), W2(v, bf)]);
                plan.tea.wicket = { at: W2(gx, bf), ang: mirror ? Math.PI / 2 : 0 };
                for (const [u, v] of ends) if (v - u > 1) G.paths.push({ pts: [W2(u, bf), W2(v, bf)], hw: 0.4, box: grow(bounds([W2(u, bf), W2(v, bf)]), 0.4) });
            }
            // lanterns beside the path
            plan.tea.lanterns = [];
            for (const f0 of [0.22, 0.5, 0.8]) {
                const i = Math.floor(f0 * (pts.length - 2)), q = pts[i], r = pts[i + 1], l = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1, s = tr.sign();
                plan.tea.lanterns.push(W2(q[0] - ((r[1] - q[1]) / l) * 1.5 * s, q[1] + ((r[0] - q[0]) / l) * 1.5 * s));
            }
        }

        // Moss along the walls, wider in places and gone in others, with a
        // grove in each corner and more that swell out from the walls every
        // so often. The near walls hide a few meters of ground behind them,
        // so the groves along those are bigger.
        const gr = own(12), [x0, y0, x1, y1] = plan.rect, wide = (2 + 3.5 * p.moss) * Math.min(1, 2 * p.moss);
        const band = (d, s, k) => (d - wide * 1.15 > FAR ? d - wide * 1.15 : d - wide * (0.15 + N.noise2(s / 12, k * 7.3)));
        if (wide > 0) G.mossy.push((x, y) => Math.min(band(x - x0, y, 0), band(x1 - x, y, 1), band(y - y0, x, 2), band(y1 - y, x, 3)));
        grove(-A, -B, gr.range(9, 12) * lush, gr);
        grove(A, B, gr.range(8, 11) * lush, gr);
        grove(-A, B, gr.range(6, 9) * lush, gr);
        grove(A, -B, gr.range(6, 9) * lush, gr);
        const along = (from, to, put, r0, r1) => {
            for (let s = from + gr.range(12, 18); s < to - 8; s += gr.range(11, 17)) {
                const r = gr.range(r0, r1) * lush;
                if (gr.chance(0.8)) put(s, r);
            }
        };
        along(-A, A, (s, r) => grove(s, -B, r, gr), 5, 7.5);
        along(-B, B, (s, r) => grove(-A, s, r, gr), 5, 7.5);
        along(-A, A, (s, r) => grove(s, B, r, gr), 3.5, 6);
        along(-B, B, (s, r) => grove(A, s, r, gr), 3.5, 6);

        // The pond: the middle of a pond garden, or a smaller one in the gravel or the moss
        if (kind === 'pond' || p.pond) {
            const room = kind === 'dry' ? (x, y) => G.land(x, y) : (x, y) => Math.min(G.open(x, y), courtRoom(x, y));
            const big = kind === 'pond';
            plan.pond = planPond(T, plan, own(13), PG.makeNoise(own(17)), {
                room, r: big ? clamp(0.36 * Math.min(A, B), 6, 11) : clamp(0.27 * Math.min(A, B), 3.4, 8.5), lobes: big ? 3 : 2, islets: big ? 2 : 1, big,
            });
        }
        // In a pond garden, stepping stones from the gate round the pond to the court
        if (kind === 'pond') {
            const sr = own(20), s0 = W2(ga, -B + 2.4), s1 = plan.courtFront;
            const dx = s1[0] - s0[0], dy = s1[1] - s0[1], dl = Math.hypot(dx, dy) || 1, n = [-dy / dl, dx / dl];
            let mid = [lerp(s0[0], s1[0], 0.5) + n[0] * sr.range(2, 4), lerp(s0[1], s1[1], 0.5) + n[1] * sr.range(2, 4)];
            const P = plan.pond;
            if (P) {
                // round the pond on whichever side has more room
                const sides = [1, -1].map(s => [P.c[0] + n[0] * s * (P.R + 2.5), P.c[1] + n[1] * s * (P.R + 2.5)]);
                const free = q => Math.min(G.open(q[0], q[1]), courtRoom(q[0], q[1]));
                if (distToPath([s0, s1], P.c[0], P.c[1]) < P.R + 2.5) mid = free(sides[0]) >= free(sides[1]) ? sides[0] : sides[1];
            }
            plan.stones = curve([s0, [lerp(s0[0], mid[0], 0.6), lerp(s0[1], mid[1], 0.6)], mid, [lerp(mid[0], s1[0], 0.5), lerp(mid[1], s1[1], 0.5)], s1]);
            G.paths.push({ pts: plan.stones, hw: 0.62, box: bounds(plan.stones) });
        }

        // Two mounds of gravel in front of the hall, either side of the way up
        // to its steps. The islands keep off their spots with or without them,
        // so turning them on doesn't move the rocks.
        const spots = [], mr = own(14), gap = mr.range(6.6, 8), d = mr.range(6.5, 8.5);
        for (const s of [-1, 1]) {
            const [cx, cy] = W2(ha + (s * gap) / 2, front - d);
            if (kind === 'dry' && G.land(cx, cy) >= CONE + 2.4) spots.push([cx, cy]);
        }

        // How the islands are set out: spread over the gravel, gathered in a
        // few groups, or a few big ones with open gravel round them
        const cr = own(15), style = cr.weighted([[3, 'spread'], [3, 'groups'], [2, 'few']]), centers = [];
        plan.style = style;
        if (style === 'groups') {
            for (let k = 0, n = cr.int(2, 3); k < 80 && centers.length < n; k++) {
                const x = cr.range(x0, x1), y = cr.range(y0, y1);
                if (!plan.inView(x, y, 9) || G.land(x, y) < 8 || centers.some(c => Math.hypot(c[0] - x, c[1] - y) < 15)) continue;
                centers.push([x, y]);
            }
        }
        // Each island stands this far from the shore and from the others, room for a few rings
        const KEEP = 5 * RAKE0 + 0.5, big = style === 'few' ? 1.35 : 1;
        // the rock islands stand in a dry garden's gravel
        const want = kind !== 'dry' ? 0 : Math.round(((4 * A * B * p.rocks) / 165) * (plan.pond ? 0.75 : 1) * (style === 'few' ? 0.45 : 1));
        for (let i = 0; i < want; i++) {
            const r = own(61, i);
            const size = big * (i === 0 ? r.range(0.95, 1.2) : i < 3 ? r.range(0.7, 0.95) : r.range(0.42, 0.7));
            const pick = r.weighted([[2, 1], [3, 2], [4, 3], [size > 0.7 ? 2.5 : 0, 5]]), count = style === 'few' && i === 0 ? 5 : pick;
            const space = size * (count > 1 ? 3.2 : 1.6) + 0.9;
            let best = null, score = -Infinity;
            for (let k = 0; k < 40; k++) {
                const x = r.range(x0, x1), y = r.range(y0, y1), jitter = r.range(0, 5);
                if (G.land(x, y) < space + KEEP) continue;
                const near = G.isle(x, y) - space;
                if (near < KEEP || spots.some(([u, v]) => Math.hypot(x - u, y - v) < space + KEEP + CONE)) continue;
                let v = (plan.inView(x, y, 4) ? 6 : 0) + jitter;
                if (centers.length) v += Math.min(near, 3) - 0.8 * Math.min(...centers.map(c => Math.hypot(c[0] - x, c[1] - y)));
                else v += Math.min(near, 14);
                if (v > score) { score = v; best = [x, y]; }
            }
            // everything the island might need is drawn before the sliders are looked at
            const roll = [r.random(), r.random(), r.random(), r.random(), r.random()], margin = r.range(0.5, 0.95), a = r.range(0, TAU), reach = r.range(1.2, 1.7);
            if (!best) continue;
            const rocks = planRocks(best[0], best[1], size, count, r), moss = p.moss > 0 && roll[0] < 0.35 + 0.6 * p.moss;
            const circles = rocks.map(q => [q.x, q.y, q.r * (q.long || 1)]), extra = {};
            // the bigger islands can have a small pine, a lantern, or a stone tower among the rocks
            if (moss && size > 0.7 && roll[1] < 0.5) {
                const d = rocks[0].r + reach, q = [best[0] + d * Math.cos(a), best[1] + d * Math.sin(a)];
                if (circles.every(c => Math.hypot(c[0] - q[0], c[1] - q[1]) > c[2] + 0.5)) {
                    if (roll[2] < 0.3 + 0.5 * p.pines) extra.pine = q;
                    else if (roll[3] < p.lanterns) extra[roll[4] < 0.35 ? 'tower' : 'lantern'] = q;
                    if (extra.pine || extra.lantern || extra.tower) circles.push([q[0], q[1], 0.5]);
                }
            }
            G.addIsland(outlineRound(circles, moss ? margin : 0.12, r), { rocks, moss, seed: hash(seed, 62, i), ...extra });
        }
        if (p.cones) {
            for (const [cx, cy] of spots) G.discs.push([cx, cy, CONE + 0.05]);
            plan.cones = spots;
        }
        return plan;
    }

    // A temple court, seen nearly from the front: the gate in the middle of
    // the near wall, a paved way between pairs of lanterns up to the hall at
    // the back, and a pagoda and a bell tower either side of it
    function planCourt(T, seed) {
        const { p } = T, rng = new PG.RNG(hash(seed, 1)), own = (...k) => new PG.RNG(hash(seed, ...k));
        const k0 = viewScale(T.PW, T.PH, SIZE0), U0 = T.PW / k0, V0 = T.PH / (k0 * SE0);
        // a long court, about as wide as an upright page shows at the default view
        const A = rng.range(16.5, 18), B = rng.range(27, 30), mirror = p.side === 'right';
        const W2 = (a, b) => [a, b], R2 = r => r.slice();
        const plan = { kind: 'court', mirror, W2, R2, A, B, rect: [-A, -B, A, B], gates: [], halls: [], cones: [], groves: [], lanterns: [] };
        plan.inView = (x, y, m = 0) => Math.abs(x) < U0 / 2 - m && Math.abs(y) < V0 / 2 - m;
        const G = (plan.ground = new Ground(plan.rect)), N = PG.makeNoise(rng);
        plan.rakeAngle = geo.rad(p.rakeTurn);
        const lush = p.moss <= 0.5 ? 2 * p.moss : 1 + 0.9 * (p.moss - 0.5);

        // the hall across the back
        const hl = clamp(2 * A - rng.range(10, 13), 18, 24), hd = rng.range(11, 12.5), back = B - 3.4, front = back - hd;
        plan.hall = { rect: [-hl / 2, front, hl / 2, back], face: 0, veranda: 1.7, eave: 2, wall: 4.4, roof: p.roof, pitch: rng.range(0.74, 0.86), lift: rng.range(0.45, 0.7) };
        G.solids.push(grow(plan.hall.rect, 0.6));
        plan.halls.push(plan.hall);

        // the gate, and the way out of it
        const open = 3.4;
        plan.gate = gateLot(plan, 0, A + WALL.t / 2, open);
        plan.gates.push(plan.gate);
        plan.gate.path = [[0, -B - WALL.t - 1.6], [0, -B - 90]];
        const landing = [-open / 2 - 0.4, -B, open / 2 + 0.4, -B + 1.5];
        G.solids.push(landing);
        G.clear.push(grow(landing, 1.2));
        // How the court is laid out: a pagoda on one side and a bell tower
        // across from it, a pagoda either side, or a pagoda on the way up to
        // the hall with a bell tower and a smaller hall either side of it
        const lay = own(22), layout = lay.weighted([[3, 'pair'], [2, 'twin'], [2, 'axis']]), stories = lay.chance(0.4) ? 5 : 3;
        const sp = mirror ? 1 : -1, pb = lerp(-B + 9, front - 5, lay.range(0.42, 0.62)), drift = lay.range(-3, 1.5);
        plan.layout = layout;
        plan.pagodas = [];
        const pagodaAt = (x, y) => {
            plan.pagodas.push({ at: [x, y], stories });
            G.solids.push([x - 4.5, y - 4.5, x + 4.5, y + 4.5]);
        };
        const belfryAt = (x, y) => {
            plan.belfry = [x, y];
            G.solids.push(grow([x - 2.6, y - 2.6, x + 2.6, y + 2.6], 0.4));
        };
        const hw = 1.1;
        plan.paths = [];
        const way = pts => {
            plan.paths.push({ pts, hw });
            G.paths.push({ pts, hw, box: grow(bounds(pts), hw) });
        };
        let axisAt = null;
        if (layout === 'pair') {
            pagodaAt(sp * (A - 7.6), pb);
            belfryAt(-sp * (A - 6.2), pb + drift);
        } else if (layout === 'twin') {
            for (const s of [-1, 1]) pagodaAt(s * (A - 7.6), pb);
        } else {
            axisAt = lerp(-B + 13, front - 7, lay.range(0.35, 0.55));
            pagodaAt(0, axisAt);
            belfryAt(sp * (A - 6.2), axisAt + drift);
            // a smaller hall on the other side, facing the way
            const sd = 6.2, sl = lay.range(9, 11), a1 = -sp * (A - 1.4), b0 = axisAt - sl / 2 + drift * 0.5;
            const rect = sp > 0 ? [a1, b0, a1 + sd, b0 + sl] : [a1 - sd, b0, a1, b0 + sl];
            plan.wing = { rect, face: sp > 0 ? 3 : 1, veranda: 1.3, eave: 1.6, wall: 3.3, roof: lay.pick(['hip', 'gable', 'irimoya']), pitch: lay.range(0.74, 0.86), lift: lay.range(0.3, 0.5) };
            G.solids.push(grow(rect, 0.6));
            plan.halls.push(plan.wing);
        }
        // the paved way up the middle, round the pagoda when it stands on it
        if (axisAt === null) way([[0, -B + 1.5], [0, front - 1.3]]);
        else {
            way([[0, -B + 1.5], [0, axisAt - 4.5]]);
            way([[0, axisAt + 4.5], [0, front - 1.3]]);
        }
        plan.path = plan.paths[0];
        // the incense burner on the way, in front of the hall
        plan.censer = [0, front - 4.2];

        // Pairs of lanterns along the way, each on a little island of its
        // own in the gravel so the rake goes round it, and a pair of pines in
        // front of the hall
        const isle = (x, y, r, extra) => G.addIsland(ring(28, (c, s) => [x + r * c, y + r * s]), { rocks: [], moss: false, seed: hash(seed, 63, G.islands.length), ...extra });
        const lr = own(21), first = -B + 6, last = front - 6, n = Math.max(2, Math.round((last - first) / lr.range(6.5, 8.5)) + 1);
        for (let i = 0; i < n; i++) {
            const b = lerp(first, last, n > 1 ? i / (n - 1) : 0.5);
            // not beside a pagoda on the way, nor right by the incense burner
            if ((axisAt !== null && Math.abs(b - axisAt) < 6) || Math.abs(b - plan.censer[1]) < 2) continue;
            for (const s of [-1, 1]) {
                const x = s * (hw + 1.6);
                plan.lanterns.push([x, b]);
                if (p.lanterns > 0) isle(x, b, 0.65, { lantern: [x, b], scale: 1.15 });
            }
        }
        if (p.pines > 0) for (const s of [-1, 1]) isle(s * (hl / 2 + 0.5), front - 2.6, 1.5, { moss: p.moss > 0, pine: [s * (hl / 2 + 0.5), front - 2.6], scale: 1.1 + 0.25 * p.pines });

        // moss in narrow bands along the walls, and groves in the back corners
        const gr = own(12), [x0, y0, x1, y1] = plan.rect, wide = (1.2 + 2.2 * p.moss) * Math.min(1, 2 * p.moss);
        const band = (d, s, k) => (d - wide * 1.15 > FAR ? d - wide * 1.15 : d - wide * (0.15 + N.noise2(s / 12, k * 7.3)));
        if (wide > 0) G.mossy.push((x, y) => Math.min(band(x - x0, y, 0), band(x1 - x, y, 1), band(y - y0, x, 2), band(y1 - y, x, 3)));
        const grove = (cx, cy, r) => {
            if (!(r > 0.3)) return;
            const ph = gr.range(0, TAU), ph2 = gr.range(0, TAU);
            const f = (x, y) => {
                const d = Math.hypot(x - cx, y - cy);
                if (d - r * 1.31 > FAR) return d - r * 1.31;
                const t = Math.atan2(y - cy, x - cx);
                return d - r * (1 + 0.2 * Math.sin(2 * t + ph) + 0.11 * Math.sin(5 * t + ph2));
            };
            G.mossy.push(Object.assign(f, { c: [cx, cy], R: r * 1.31 }));
            if (r > 4.4) plan.groves.push({ at: [cx - Math.sign(cx) * clamp(r * 0.5, 2.6, 4.4), cy - Math.sign(cy) * clamp(r * 0.5, 2.6, 4.4)], r });
        };
        for (const s of [-1, 1]) {
            grove(s * A, B, gr.range(6.5, 9) * lush);
            grove(s * A, -B, gr.range(4, 6) * lush);
        }

        // two mounds of gravel either side of the way, in front of the hall
        if (p.cones) {
            for (const s of [-1, 1]) {
                const c = [s * (hw + 4.2), front - 7.5];
                if (G.land(c[0], c[1]) >= CONE + 1.5 && G.isle(c[0], c[1]) > CONE + 1.5) {
                    G.discs.push([c[0], c[1], CONE + 0.05]);
                    plan.cones.push(c);
                }
            }
        }
        return plan;
    }

    // ------------------------------------------------------------------
    // Planting
    // ------------------------------------------------------------------

    // Trees, clipped shrubs, lanterns, and odd rocks in the moss along the walls
    function dressGarden(T, plan, seed, claims, F) {
        const { p, cam } = T, G = plan.ground, [x0, y0, x1, y1] = plan.rect, step = 2.1, span = (plan.A + plan.B) * 1.2;
        const spots = [], lit = [], apartL = lerp(22, 8, p.lanterns);
        // Everything is planted all over the garden and only drawn where it's
        // in sight, so what grows by the edge of the view stays put as it moves
        const shows = (x, y) => sdRect(F.box, x, y) <= 6;
        for (let j = 0; y0 + j * step < y1; j++) for (let i = 0; x0 + i * step < x1; i++) spots.push([i, j, hash(seed, 51, i, j)]);
        spots.sort((a, b) => a[2] - b[2]);
        // a tree in most groves, where it can stand clear of things: pines by the near walls, which
        // the garden shows through between their pads, and maples by the far ones
        plan.groves.forEach((g, n) => {
            const rng = new PG.RNG(hash(seed, 52, n)), [x, y] = g.at, roll = rng.random(), kind = rng.random(), size = rng.random();
            if (G.moss(x, y) > -1 || G.open(x, y) < 1.6 || !claims.free(x, y, 2.6)) return;
            const near = clamp(0.5 - (x * cam.fx + y * cam.fy) / span, 0, 1) > 0.5;
            const wp = p.pines * (near ? 1.6 : 0.7), wm = p.maples * (near ? 0.6 : 1.5);
            if (roll >= Math.min(1, 0.4 + 1.1 * Math.max(p.pines, p.maples)) || wp + wm <= 0) return;
            claims.take(x, y, 3);
            if (!shows(x, y)) return;
            if (kind * (wp + wm) < wp) pine(T, x, y, 0, rng, lerp(0.95, 1.25, size));
            else maple(T, x, y, 0, rng, lerp(0.85, 1.15, size));
        });
        for (const [i, j, h] of spots) {
            const rng = new PG.RNG(h), x = x0 + (i + rng.range(0.15, 0.85)) * step, y = y0 + (j + rng.range(0.15, 0.85)) * step;
            // every roll this spot might need, before the sliders are looked at
            const roll = rng.random(), lantern1 = rng.random(), shrub1 = rng.random(), stone1 = rng.random(), size = rng.random();
            const m = -G.moss(x, y), o = G.open(x, y), hid = Math.min(x - x0, y - y0) < 2.4;
            if (m < 0.7 || o < 0.8) continue;
            // 0 by the far walls, 1 by the near ones, where a tall tree hides the garden behind it
            const near = clamp(0.5 - (x * cam.fx + y * cam.fy) / span, 0, 1), show = shows(x, y);
            const few = (1 - 0.5 * smooth(0.45, 0.8, near)) * (plan.kind === 'dry' ? 1 : plan.kind === 'court' ? 0.8 : plan.kind === 'tea' ? 0.78 : 0.62);
            if (m > 1.3 && o > 1.7 && claims.free(x, y, 3) && roll < 0.6 * (p.pines + p.maples) * few) {
                claims.take(x, y, 3);
                if (!show) continue;
                if (roll < 0.6 * p.pines * few) pine(T, x, y, 0, rng, lerp(0.85, 1.15, size));
                else maple(T, x, y, 0, rng, lerp(0.8, 1.1, size));
            } else if (p.lanterns > 0 && !hid && m < 2.2 && o > 1.3 && claims.free(x, y, 1.1) && lit.every(q => Math.hypot(q[0] - x, q[1] - y) > apartL) && lantern1 < 0.5) {
                claims.take(x, y, 1.1);
                lit.push([x, y]);
                if (show) lantern(T, x, y, 0, lerp(0.95, 1.15, size));
            } else if (!hid && m > 0.9 && o > 1 && claims.free(x, y, 1.6) && shrub1 < 0.75 * p.shrubs) {
                const n = 1 + Math.floor(size * (m > 1.6 ? 4 : 2));
                claims.take(x, y, 1 + 0.35 * n);
                if (show) shrubs(T, x, y, 0, rng, n, rng.range(0.8, 1.15));
            } else if (!hid && m > 0.8 && o > 0.9 && claims.free(x, y, 1.3) && stone1 < 0.07) {
                claims.take(x, y, 1.2);
                if (show) for (const q of planRocks(x, y, lerp(0.35, 0.55, size), rng.int(1, 2), rng)) rock(T, q, 0);
            }
        }
    }

    // The woods outside the walls: cedars, maples, and bamboo behind the
    // garden, and a few trees in front where they don't hide it. Planted on
    // a grid fixed to the ground, so a wider view shows more of the same wood.
    function outskirts(T, plan, seed) {
        const { p, cam } = T, N = PG.makeNoise(new PG.RNG(hash(seed, 6)));
        const view = bounds([[-14, -30], [T.W + 14, -30], [T.W + 14, T.H + 40], [-14, T.H + 40]].map(([x, y]) => cam.ground(x, y)));
        const wall = grow(plan.rect, WALL.t), step = 4.6;
        const path = plan.gate && plan.gate.path, S = T.S, shadow = S.shadow;
        // the woods cast no shadows: out there they'd only be clutter
        S.shadow = null;
        for (let j = Math.floor(view[1] / step); j <= Math.ceil(view[3] / step); j++) {
            for (let i = Math.floor(view[0] / step); i <= Math.ceil(view[2] / step); i++) {
                const rng = new PG.RNG(hash(seed, 31, i, j));
                const x = (i + rng.range(0.15, 0.85)) * step, y = (j + rng.range(0.15, 0.85)) * step, d = sdRect(wall, x, y);
                if (d < 1.6) continue;
                if (path && distToPath(path, x, y) < 4) continue;
                if ([plan.pagoda, ...(plan.pagodas || []).map(q => q.at)].some(q => q && Math.max(Math.abs(x - q[0]), Math.abs(y - q[1])) < 7)) continue;
                // behind the garden or in front of it?
                const behind = x * cam.fx + y * cam.fy > (wall[0] + wall[2]) / 2 * cam.fx + (wall[1] + wall[3]) / 2 * cam.fy, grove = N.noise2(x / 34, y / 34);
                // in front, nothing tall enough to stand in the way of the garden
                const top = cam.project(x, y, 10), g = cam.ground(top[0], top[1]);
                if (!behind && sdRect(wall, g[0], g[1]) < 2) continue;
                const thick = (behind ? 0.85 : 0.4) * Math.min(1, 0.2 + 0.8 * p.woods) * Math.min(1, 6 * p.woods) * (1 - 0.5 * smooth(18, 45, d));
                const here = rng.random(), kind = rng.random(), cane = rng.random(), size = rng.random();
                if (here >= thick) continue;
                // a tree standing below the page would only poke the top of it up into the drawing
                if (cam.project(x, y, 0)[1] > T.H + 1) continue;
                if (grove > 0.3 && cane < p.bamboo) { bamboo(T, x, y, 0, rng, 3 + Math.floor(size * 3), 2); continue; }
                // maples gather in some parts of the wood, and cedars make up the rest
                const wm = (grove < -0.25 ? 5 : 0.15) * 2 * p.maples, wp = 0.43 * 2 * p.pines, u = kind * (wm + wp + 1);
                if (u < wm) maple(T, x, y, 0, rng, lerp(0.9, 1.25, size));
                else if (u < wm + wp) pine(T, x, y, 0, rng, lerp(1.1, 1.4, size));
                else cedar(T, x, y, 0, rng, lerp(8, 12, size));
            }
        }
        S.shadow = shadow;
    }

    // A polyline moved o to its left, with square turns mitered
    function offsetPath(pts, o) {
        const left = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
        return pts.map((q, i) => {
            const n1 = left(pts[Math.max(0, i - 1)], pts[Math.max(1, i)]), n2 = left(pts[Math.min(i, pts.length - 2)], pts[Math.min(i + 1, pts.length - 1)]);
            const m = [n1[0] + n2[0], n1[1] + n2[1]], dot = m[0] * n1[0] + m[1] * n1[1] || 1;
            return [q[0] + (m[0] * o) / dot, q[1] + (m[1] * o) / dot];
        });
    }

    // A paved path along plan points, hw either side of them, with its slabs
    // in two rows and their joints staggered
    function paving(T, pts, hw) {
        const S = T.S;
        S.kind = INK;
        for (const o of [-hw, hw]) S.line(at3(offsetPath(pts, o), 0.01));
        if (!T.detail) return;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]], P = (s, o) => [a[0] + d[0] * s + n[0] * o, a[1] + d[1] * s + n[1] * o, 0.01];
            if (hw * apart(T, [d[0], d[1], 0], [n[0], n[1], 0]) < FINE * 1.5) continue;
            // a turn is one square slab, so each leg stops short of it
            const s0 = i > 0 ? hw : 0, s1 = i + 2 < pts.length ? L - hw : L;
            const per = apart(T, [n[0], n[1], 0], [d[0], d[1], 0]), gap = Math.max(1.5, 2.6 / per);
            S.line([P(s0, 0), P(s1, 0)]);
            if (i > 0) S.line([P(s0, -hw), P(s0, hw)]);
            if (i + 2 < pts.length) S.line([P(s1, -hw), P(s1, hw)]);
            for (let s = s0 + gap / 2, j = 0; s < s1 - 0.3; s += gap / 2, j++) S.line(j & 1 ? [P(s, -hw), P(s, 0)] : [P(s, 0), P(s, hw)]);
        }
    }

    // The paved path up to the gate from outside, with lanterns along it
    function approach(T, plan, seed) {
        const { p } = T, [a, b] = plan.gate.path, L = Math.hypot(b[0] - a[0], b[1] - a[1]), hw = 1.5;
        const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]], P = (s, o, z = 0.01) => [a[0] + d[0] * s + n[0] * o, a[1] + d[1] * s + n[1] * o, z];
        paving(T, [a, b], hw);
        const rng = new PG.RNG(hash(seed, 7));
        for (let s = 5, i = 0; s < L && p.lanterns > 0; s += lerp(16, 7, p.lanterns), i++) {
            const q = P(s, (i & 1 ? 1 : -1) * (hw + 1.1), 0);
            lantern(T, q[0], q[1], 0, rng.range(1, 1.15));
        }
    }

    // ------------------------------------------------------------------
    // People
    // ------------------------------------------------------------------

    // A monk raking the gravel, people sitting on the edge of the hall's
    // veranda, and pilgrims on the path up to the gate
    function people(T, plan, seed, claims) {
        const { p } = T, G = plan.ground, rng = new PG.RNG(hash(seed, 8)), [x0, y0, x1, y1] = plan.rect;
        if (!(p.people > 0)) return;
        if (p.rake !== 'ripples' && rng.chance(0.35 + 0.65 * p.people)) {
            for (let k = 0; k < 80; k++) {
                const x = rng.range(x0, x1), y = rng.range(y0, y1);
                if (!plan.inView(x, y, 6) || G.land(x, y) < 3 || G.isle(x, y, 8) < 5) continue;
                robed(T, x, y, 0, rng, false, [Math.cos(plan.rakeAngle), Math.sin(plan.rakeAngle)]);
                break;
            }
        }
        const F = lotFrame(plan.hall.rect, plan.hall.face), out = F.V(0, -1, 0), sat = [];
        for (let i = Math.round(p.people * rng.range(1, 3.6)); i > 0; i--) {
            const s = rng.range(1.2, F.W - 1.2);
            if (Math.abs(s - F.W / 2) < 2.2 || sat.some(q => Math.abs(q - s) < 0.9)) continue;
            sat.push(s);
            const q = F.P(s, 0.1, 0.7);
            seated(T, q[0], q[1], 0.7, out, rng);
        }
        const [a, b] = plan.gate.path, L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        for (let i = Math.round(p.people * rng.range(0.6, 3)); i > 0; i--) {
            const s = rng.range(2.5, 26), o = rng.range(-0.9, 0.9), x = a[0] + d[0] * s - d[1] * o, y = a[1] + d[1] * s + d[0] * o;
            if (!claims.free(x, y, 0.5)) continue;
            claims.take(x, y, 0.5);
            robed(T, x, y, 0, rng, rng.chance(0.7));
        }
        if (plan.tea && rng.chance(0.3 + 0.6 * p.people)) {
            const q = plan.tea.path[Math.floor(plan.tea.path.length * rng.range(0.55, 0.8))];
            robed(T, q[0] + 0.5, q[1] + 0.3, 0, rng, false);
        }
    }

    // ------------------------------------------------------------------
    // Shadows
    // ------------------------------------------------------------------

    // The shadows as one test: is (x, y) in any of them?
    function shadeTest(polys, cell = 3) {
        const cells = new Map();
        for (const poly of polys) {
            const b = bounds(poly), item = { poly, b };
            for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) {
                for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++) {
                    const key = i * 100003 + j;
                    let a = cells.get(key);
                    if (!a) cells.set(key, (a = []));
                    a.push(item);
                }
            }
        }
        return (x, y) => {
            const a = cells.get(Math.floor(x / cell) * 100003 + Math.floor(y / cell));
            if (!a) return false;
            for (const { poly, b } of a) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && geo.pointInPolygon(x, y, poly)) return true;
            return false;
        };
    }

    // Hatch the shadows that fall on anything but gravel, level across the
    // page. On the gravel they're raked instead (see rake).
    function groundShadows(T, group, ok) {
        const S = T.S, segs = [], groups = S.shadowGroups;
        S.line = pts => segs.push(pts);
        S.shadowGroups = [group];
        S.hatchShadows(T.p.shadowGap);
        S.shadowGroups = groups;
        delete S.line;
        S.kind = SHADOW;
        for (const [a, b] of segs) for (const part of pieces([a, b], ok, 0.25)) S.line(at3(part, 0.04));
    }

    // ------------------------------------------------------------------
    // Putting it together
    // ------------------------------------------------------------------

    function build(T, seed) {
        const { S, p } = T;
        const plan = makePlan(T, seed), G = plan.ground;
        const group = p.shadows ? ((S.sun = T.sun), S.shadowGroup(0, null, Math.atan2(T.cam.ry, T.cam.rx))) : null;
        gardenWall(T, plan);
        gate(T, plan.gate);
        const brng = new PG.RNG(hash(seed, 4)), claims = new Claims();
        for (const h of plan.halls) hall(T, h);
        if (plan.pagoda) pagoda(T, plan.pagoda[0], plan.pagoda[1], 0, 3, brng);
        for (const q of plan.pagodas || []) pagoda(T, q.at[0], q.at[1], 0, q.stories, brng);
        if (plan.censer) censer(T, plan.censer[0], plan.censer[1]);
        if (plan.belfry) belfry(T, plan.belfry[0], plan.belfry[1], brng);
        if (plan.tea) {
            teaHouse(T, plan.tea);
            steppingStones(T, plan.tea.path, brng);
            basin(T, plan.tea.basin[0], plan.tea.basin[1], brng);
            for (const q of plan.tea.path) claims.take(q[0], q[1], 0.8);
            claims.take(plan.tea.basin[0], plan.tea.basin[1], 1.3);
            for (const [a, b] of plan.tea.fence || []) {
                bambooFence(T, a, b);
                const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                for (let s = 0; s <= L; s += 1.2) claims.take(lerp(a[0], b[0], s / L), lerp(a[1], b[1], s / L), 0.6);
            }
            if (plan.tea.wicket) wicketGate(T, plan.tea.wicket.at[0], plan.tea.wicket.at[1], plan.tea.wicket.ang);
            if (plan.tea.bench && claims.free(plan.tea.bench.at[0], plan.tea.bench.at[1], 1.2)) {
                waitingBench(T, plan.tea.bench.at[0], plan.tea.bench.at[1], plan.tea.bench.ang);
                claims.take(plan.tea.bench.at[0], plan.tea.bench.at[1], 2);
            }
            if (p.lanterns > 0) {
                for (const [x, y] of plan.tea.lanterns || []) {
                    if (!claims.free(x, y, 0.8)) continue;
                    claims.take(x, y, 1);
                    lantern(T, x, y, 0, 1);
                }
            }
        }
        if (plan.stones) {
            const pond = plan.pond;
            steppingStones(T, plan.stones, brng, pond ? (x, y) => pond.water(x, y) > 0.5 : null);
            for (const q of plan.stones) claims.take(q[0], q[1], 0.8);
        }
        for (const q of plan.paths || (plan.path ? [plan.path] : [])) paving(T, q.pts, q.hw);
        for (const [x, y] of plan.cones) mound(T, x, y, CONE);

        const F = survey(T, plan);
        if (F) {
            // the moss's edge, where it isn't under something else
            S.kind = MOSS;
            for (const line of PG.isolines(F.grid.field(F.moss), 0)) {
                for (const part of pieces(line, (x, y) => F.openAt(x, y) > 0.02 && !F.byPocket(x, y), F.grid.dx)) S.line(at3(part, 0.02));
            }
            for (const I of G.islands) if (sdRect(F.box, I.c[0], I.c[1]) < I.r + 8) island(T, I, I.seed);
            if (plan.pond) drawPond(T, plan, new PG.RNG(hash(seed, 9)), claims);
            dressGarden(T, plan, seed, claims, F);
        }
        approach(T, plan, seed);
        people(T, plan, seed, claims);
        outskirts(T, plan, seed);

        S.shadow = null;
        const shade = group && group.polys.length ? shadeTest(group.polys) : null;
        if (F) {
            // moss in tufts, but not in the shadows, which are hatched
            if (T.detail) {
                // where moss covers the ground it comes in patches, or the tufts would only be a grey film
                const M = PG.makeNoise(new PG.RNG(hash(seed, 23))), patchy = plan.kind !== 'dry';
                const patch = (x, y) => !patchy || M.noise2(x / 6, y / 6) + 0.6 * M.noise2(x / 2.2, y / 2.2) > 0.15;
                tufts(T, (x, y) => (F.mossAt(x, y) < -0.3 || F.inPocket(x, y)) && F.openAt(x, y) > 0.3 && !(shade && shade(x, y)) && patch(x, y), F.box, patchy ? 3.2 : 3.8, new PG.RNG(hash(seed, 3)));
            }
            rake(T, plan, F, T.rakedShade ? shade : null);
        }
        if (shade) {
            // On the gravel the shadows are raked, unless the rake lines are too
            // close together to fit more between them. Then they're hatched like
            // the rest, across the rake lines.
            const [x0, y0, x1, y1] = plan.rect, bare = G.islands.filter(I => !I.moss);
            // the strip of gravel round the rocks of an island with no moss counts as gravel
            const inBare = (x, y) => bare.some(I => Math.hypot(x - I.c[0], y - I.c[1]) < I.r && sdPoly(I.poly, x, y) < 0);
            const gravel = (x, y) => x > x0 && x < x1 && y > y0 && y < y1 && F && F.landAt(x, y) > 0 && (F.isleAt(x, y) > 0 || inBare(x, y));
            groundShadows(T, group, T.rakedShade ? (x, y) => !gravel(x, y) : () => true);
        }
    }

    // Straight lines that lie along the same line as another of the same kind
    // and overlap it, as where two runs of wall meet at a corner, are drawn once
    function dedupe(S) {
        const groups = new Map(), out = [];
        const key = v => Math.round(v * 500);
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

    const hasPond = p => p.garden === 'pond' || (p.pond && (p.garden === 'dry' || p.garden === 'tea'));

    PG.register({
        id: 'temple',
        name: 'Temple Garden',
        category: 'Scenes',
        description: 'A walled Japanese temple garden in isometric ink: a dry garden of raked gravel round islands of rock, a pond garden, a tea garden, or a temple court with a pagoda and a bell tower.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'size', label: 'View size (m)', type: 'range', min: 26, max: 90, step: 1, value: SIZE0, random: [44, 56],
                hint: 'How much ground fits across an upright page. Smaller brings the garden closer. A wide page shows more to the sides' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 25, max: 60, step: 0.5, value: 40, random: false,
                hint: '35.3 is true isometric' },
            { type: 'section', label: 'Garden' },
            { id: 'garden', label: 'Garden', type: 'select', value: 'dry', random: true,
                options: [['dry', 'Dry garden'], ['pond', 'Pond garden'], ['tea', 'Tea garden'], ['court', 'Temple court']],
                hint: 'A dry garden is raked gravel round islands of rock. A pond garden is moss round a pond, and a tea garden moss with a path to a tea house. A temple court is seen from the front, with a pagoda and a bell tower' },
            { id: 'side', label: 'Hall side', type: 'select', value: 'left', random: true, options: [['left', 'Left'], ['right', 'Right']],
                hint: 'In a temple court, the side the pagoda stands on' },
            { id: 'roof', label: 'Hall roof', type: 'select', value: 'irimoya', random: ['irimoya', 'irimoya', 'hip', 'gable'],
                options: [['irimoya', 'Hip and gable'], ['hip', 'Hipped'], ['gable', 'Gabled']] },
            { id: 'annex', label: 'Beside the hall', type: 'select', value: 'pagoda', random: ['pagoda', 'pagoda', 'hall', 'hall', 'tea', 'tea', 'none'],
                options: [['hall', 'Smaller hall'], ['pagoda', 'Pagoda'], ['tea', 'Tea house'], ['none', 'Nothing']], show: p => p.garden === 'dry' || p.garden === 'pond' },
            { id: 'path', label: 'Stone path', type: 'checkbox', value: false, random: 0.4, hint: 'A paved path from the gate to the hall', show: p => p.garden === 'dry' },
            { id: 'pond', label: 'Pond', type: 'checkbox', value: false, random: 0.45, show: p => p.garden === 'dry' || p.garden === 'tea',
                hint: 'A koi pond with moss round its shore, and a bridge to its islet when it\'s big enough for one' },
            { id: 'koi', label: 'Koi', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.2, 1], show: hasPond },
            { id: 'ripples', label: 'Pond ripples', type: 'checkbox', value: true, show: hasPond, hint: 'Lines along the shore of the pond' },
            { type: 'section', label: 'Gravel' },
            { id: 'rake', label: 'Rake pattern', type: 'select', value: 'straight', random: true,
                options: [['straight', 'Straight'], ['waves', 'Waves'], ['ripples', 'Ripples'], ['checks', 'Checks'], ['scallops', 'Scallops']],
                hint: 'Ripples run round the islands and along the edges all the way across' },
            { id: 'rakeGap', label: 'Rake spacing (mm)', type: 'range', min: 0.9, max: 3, step: 0.05, value: 1.4, random: false },
            { id: 'rings', label: 'Rings round the rocks', type: 'range', min: 0, max: 8, step: 1, value: 3, random: [2, 5], show: p => p.rake !== 'ripples' },
            { id: 'border', label: 'Lines along the edges', type: 'range', min: 0, max: 4, step: 1, value: 1, random: [0, 2], show: p => p.rake !== 'ripples',
                hint: 'Along the walls, the moss, the buildings, and the paths. They ring the islands as well' },
            { id: 'rakeTurn', label: 'Rake direction (°)', type: 'range', min: 0, max: 175, step: 5, value: 0, random: false, show: p => p.rake !== 'ripples' },
            { id: 'wave', label: 'Wave length (m)', type: 'range', min: 2, max: 12, step: 0.1, value: 5, random: [3.5, 7], show: p => p.rake === 'waves' },
            { id: 'check', label: 'Pattern size (m)', type: 'range', min: 2, max: 12, step: 0.1, value: 4.5, random: [3.5, 6], show: p => p.rake === 'checks' || p.rake === 'scallops' },
            { id: 'rocks', label: 'Rock islands', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.25, 0.85], show: p => p.garden === 'dry' },
            { id: 'cones', label: 'Gravel mounds', type: 'checkbox', value: false, random: 0.3, hint: 'Two flat-topped mounds of gravel in front of the hall', show: p => p.garden === 'dry' || p.garden === 'court' },
            { type: 'section', label: 'Planting' },
            { id: 'moss', label: 'Moss', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9],
                hint: 'Along the walls and round the pond. The trees, shrubs, and lanterns inside the walls grow in the moss' },
            { id: 'pines', label: 'Pines', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9] },
            { id: 'maples', label: 'Maples', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.1, 0.9] },
            { id: 'shrubs', label: 'Clipped shrubs', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9] },
            { id: 'lanterns', label: 'Stone lanterns', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.2, 0.9] },
            { id: 'woods', label: 'Woods outside', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0.3, 0.9],
                hint: 'Cedars, with pines, maples, and bamboo as the sliders for them say' },
            { id: 'bamboo', label: 'Bamboo', type: 'range', min: 0, max: 1, step: 0.01, value: 0.6, random: [0, 1], show: p => p.woods > 0,
                hint: 'How much of the woods outside is bamboo' },
            { id: 'people', label: 'People', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0, 0.9],
                hint: 'A monk raking the gravel, visitors on the veranda, and pilgrims on the path to the gate' },
            { id: 'detail', label: 'Fine details', type: 'checkbox', value: true,
                hint: 'Tufts of moss, coping tiles, veranda boards, gable grilles, and other small line work' },
            { type: 'section', label: 'Shading' },
            { id: 'roofHatch', label: 'Roof tiles', type: 'checkbox', value: true },
            { id: 'roofGap', label: 'Roof tile spacing (mm)', type: 'range', min: 0.9, max: 3, step: 0.05, value: 1, random: false,
                show: p => p.roofHatch, hint: 'Slopes out of the sun are drawn closer together' },
            { id: 'shadows', label: 'Shadows', type: 'checkbox', value: true,
                hint: 'On the gravel a shadow is raked, with the lines twice as close, where the rake spacing leaves room for that. Otherwise it is hatched' },
            { id: 'sun', label: 'Sun height (°)', type: 'range', min: 25, max: 75, step: 1, value: 50, random: [42, 60], show: p => p.shadows, hint: 'Lower sun, longer shadows' },
            { id: 'shadowGap', label: 'Shadow hatch spacing (mm)', type: 'range', min: 0.6, max: 2, step: 0.05, value: 0.9, random: false, show: p => p.shadows,
                hint: 'For shadows on the moss and outside the walls' },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        randomize(rng) {
            return { yaw: rng.pick([45, 45, 45, 40, 50]), elev: rng.pick([36, 40, 40, 44, 48]), rakeTurn: rng.pick([0, 0, 0, 0, 90, 90, 45, 135]) };
        },

        generate(p, ctx) {
            const { width: W, height: H } = ctx, seed = ctx.seed | 0;
            // a wrapped layer's strip is sized like the page it's on, not zoomed out to fit
            const [PW, PH] = ctx.wrap ? ctx.wrap.page : [W, H];
            const k = viewScale(PW, PH, p.size);
            // a temple court is seen from the front, turned a little, where the other gardens are seen across a corner
            const cam = makeCamera(p.garden === 'court' ? p.yaw - 36 : p.yaw, p.elev, k, W, H, 0, 0);
            const S = new Scene(cam, W, H);
            // the sun is high on the left and a little behind, so shadows fall to the right and towards the camera
            const cot = 1 / Math.tan(geo.rad(p.sun)), sd = unit([0.85 * cam.rx - 0.4 * cam.fx, 0.85 * cam.ry - 0.4 * cam.fy, 0]);
            const sun = [sd[0] * cot, sd[1] * cot], toSun = unit([-sun[0], -sun[1], 1]);
            const T = {
                S, cam, p, k, W, H, PW, PH, seed,
                detail: p.detail,
                sees: n => cam.facing(n[0], n[1], n[2]),
                segs: r => segments(r, k),
                picket: Math.max(0.28, 0.9 / k),
                sun,
                tones: p.roofHatch ? { lit: ROOF, dark: ROOF, canopy: ROOF } : null,
                hLit: p.roofGap,
                hDark: p.roofGap * 0.72,
                lit: n => (n[0] * toSun[0] + n[1] * toSun[1] + n[2] * toSun[2]) / Math.hypot(n[0], n[1], n[2]) >= 0.75 * toSun[2],
                waterKind: WATER,
                // rake lines this far apart on the ground come out the spacing asked for on paper, give or take the foreshortening
                rakeS: p.rakeGap / (k * Math.sqrt(cam.se)),
                // Shadows on the gravel are raked, with lines in between the rake lines, when
                // those come out at least half a millimeter apart where they're closest
                rakedShade: (p.rakeGap * Math.sqrt(cam.se)) / 2 >= 0.5,
            };
            build(T, seed);
            dedupe(S);
            return PG.pens.renderScene('temple', S, p);
        },
    });
})();
