/*
 * Isometric scenes: a small 3D line drawing engine, shared by the Town and
 * Harbour designs.
 *
 * A scene is built from convex solids, flat faces and loose lines, seen
 * through an orthographic camera. Hidden lines are removed exactly. Every
 * line is clipped against the projected faces in front of it (a face only
 * hides the part of a segment where the face is nearer), so the plot has just
 * the visible outlines. Solids only draw edges next to a face that points at
 * the camera, and curved surfaces only draw their silhouettes.
 *
 * With a sun set, every solid and face also casts a shadow onto the ground of
 * the current shadow group (a lot, the water) and hatchShadows() fills the
 * shadows with lines, merging any that overlap so nothing is drawn twice.
 * Sizes are in metres and the camera scale turns them into millimetres.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const geo = PG.geo, TAU = PG.TAU;
    const iso = (PG.iso = {});

    const HIDE_EPS = 0.002; // m, a face has to be this much nearer to hide a line
    const SHRINK = 1e-6;    // mm, faces shrink a hair so they never hide their own edges
    const DIRS = (iso.DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]);
    // box corners: 0-3 bottom, 4-7 top
    const BOX = (iso.BOX = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]]);

    iso.hash = function (...ns) {
        let h = 0x811c9dc5;
        for (const n of ns) {
            h = Math.imul(h ^ (n | 0), 0x01000193);
            h ^= h >>> 15;
        }
        return h | 0;
    };

    // Orthographic camera. yaw turns the scene about the vertical, elev tilts the
    // view down from the horizon (35.26° is true isometric). Screen coordinates
    // are mm with y down, depth is metres away from the camera.
    iso.makeCamera = function (yaw, elev, k, W, H, cx, cy) {
        const th = geo.rad(yaw), el = geo.rad(elev);
        const fx = Math.sin(th), fy = Math.cos(th); // view direction along the ground
        const rx = fy, ry = -fx;                    // screen right
        const se = Math.sin(el), ce = Math.cos(el);
        const X0 = W / 2 - k * (cx * rx + cy * ry);
        const Y0 = H / 2 + k * se * (cx * fx + cy * fy);
        return {
            k, se, ce, fx, fy, rx, ry, tanE: se / ce,
            project: (x, y, z) => [
                X0 + k * (x * rx + y * ry),
                Y0 - k * ((x * fx + y * fy) * se + z * ce),
                (x * fx + y * fy) * ce - z * se,
            ],
            // the point at height z that shows at screen position (sx, sy)
            ground(sx, sy, z = 0) {
                const a = (sx - X0) / k, b = (Y0 - sy) / (k * se) - (z * ce) / se;
                return [a * rx + b * fx, a * ry + b * fy];
            },
            // does a face with this outward normal point at the camera?
            facing: (nx, ny, nz) => (nx * fx + ny * fy) * ce - nz * se < -1e-9,
        };
    };

    // Local frame for a lot or an object: u runs along the street (left to right
    // seen from the street), v points into the lot, c is height.
    const frame = (iso.frame = function (ox, oy, oz, dir) {
        const [ux, uy] = DIRS[dir & 3], vx = -uy, vy = ux;
        return {
            P: (a, b, c) => [ox + a * ux + b * vx, oy + a * uy + b * vy, oz + c],
            V: (a, b, c) => [a * ux + b * vx, a * uy + b * vy, c],
        };
    });

    const newell = (iso.newell = function (pts) {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            nx += (a[1] - b[1]) * (a[2] + b[2]);
            ny += (a[2] - b[2]) * (a[0] + b[0]);
            nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        return [nx, ny, nz];
    });

    // A 2D frame in the plane of a polygon (world points): origin, unit axes
    // e1 (along `dir` when given, else the first edge) and e2, and flatten /
    // lift to go between world points and plane coordinates.
    function planeFrame(pts, dir) {
        const n = newell(pts), nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-12) return null;
        const nn = [n[0] / nl, n[1] / nl, n[2] / nl], o = pts[0];
        let e1 = dir || [pts[1][0] - o[0], pts[1][1] - o[1], pts[1][2] - o[2]];
        const dn = e1[0] * nn[0] + e1[1] * nn[1] + e1[2] * nn[2];
        e1 = [e1[0] - dn * nn[0], e1[1] - dn * nn[1], e1[2] - dn * nn[2]];
        const l1 = Math.hypot(e1[0], e1[1], e1[2]);
        if (l1 < 1e-12) return null;
        e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
        const e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
        return {
            e1, e2,
            flatten: p => {
                const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
                return [x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2]];
            },
            lift: ([u, v]) => [o[0] + u * e1[0] + v * e2[0], o[1] + u * e1[1] + v * e2[1], o[2] + u * e1[2] + v * e2[2]],
        };
    }

    // Inset a planar convex polygon (world points) by d within its own plane.
    iso.inset3 = function (pts, d) {
        const pf = planeFrame(pts);
        if (!pf) return [];
        return geo.insetConvex(pts.map(pf.flatten), d).map(pf.lift);
    };

    const hull = (iso.hull = function (pts) {
        const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lo = [], hi = [];
        for (const q of p) {
            while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
            lo.push(q);
        }
        for (let i = p.length - 1; i >= 0; i--) {
            const q = p[i];
            while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
            hi.push(q);
        }
        return lo.slice(0, -1).concat(hi.slice(0, -1));
    });

    // n points around a circle, placed in whatever plane at(cos, sin) maps to
    const ring = (iso.ring = function (n, at) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(at(Math.cos((TAU * i) / n), Math.sin((TAU * i) / n)));
        return out;
    });

    // Upright cut-out through (x, y, z) facing the camera. `off` pulls it towards
    // the camera so stacked cut-outs overlap in order.
    iso.card = function (T, x, y, z, off = 0) {
        const c = T.cam, ox = x - off * c.fx, oy = y - off * c.fy;
        return (u, w) => [ox + u * c.rx, oy + u * c.ry, z + w];
    };

    class Scene {
        constructor(cam, W, H) {
            this.cam = cam;
            this.W = W;
            this.H = H;
            this.faces = [];
            this.lines = [];
            this.kind = 0;
            // shadow offset on the ground per metre of height, null for no shadows
            this.sun = null;
            this.shadow = null;
            this.shadowGroups = [];
        }

        onPage(q) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const p of q) {
                if (p[0] < x0) x0 = p[0];
                if (p[0] > x1) x1 = p[0];
                if (p[1] < y0) y0 = p[1];
                if (p[1] > y1) y1 = p[1];
            }
            return x1 >= 0 && y1 >= 0 && x0 <= this.W && y0 <= this.H;
        }

        // A line to draw where nothing is in front of it. A `whole` line is
        // dropped instead of cut when anything covers part of it or it runs off
        // the page (for small marks that look broken when clipped).
        line(pts, whole = false) {
            const c = this.cam;
            const q = pts.map(p => c.project(p[0], p[1], p[2]));
            if (q.length < 2 || !this.onPage(q)) return;
            if (whole && !q.every(p => p[0] >= 0 && p[1] >= 0 && p[0] <= this.W && p[1] <= this.H)) return;
            this.lines.push({ q, kind: this.kind, whole });
        }

        loop(pts) {
            this.line(pts.concat([pts[0]]));
        }

        // A convex planar polygon that hides whatever is behind it
        face(pts, cast = true) {
            if (cast && this.shadow) this.castShadow(pts);
            const c = this.cam, n = pts.length;
            const q = pts.map(p => c.project(p[0], p[1], p[2]));
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, dmin = Infinity;
            let Nx = 0, Ny = 0, Nd = 0;
            for (let i = 0; i < n; i++) {
                const a = q[i], b = q[(i + 1) % n];
                Nx += (a[1] - b[1]) * (a[2] + b[2]);
                Ny += (a[2] - b[2]) * (a[0] + b[0]);
                Nd += (a[0] - b[0]) * (a[1] + b[1]);
                if (a[0] < x0) x0 = a[0];
                if (a[0] > x1) x1 = a[0];
                if (a[1] < y0) y0 = a[1];
                if (a[1] > y1) y1 = a[1];
                if (a[2] < dmin) dmin = a[2];
            }
            // edge-on faces hide nothing
            if (Math.abs(Nd) < 1e-7 || x1 < 0 || y1 < 0 || x0 > this.W || y0 > this.H) return;
            // depth over the face as a plane over the screen
            const da = -Nx / Nd, db = -Ny / Nd, dc = q[0][2] - da * q[0][0] - db * q[0][1];
            if (Nd < 0) q.reverse();
            const ex = [], ey = [], ec = [];
            for (let i = 0; i < n; i++) {
                const a = q[i], b = q[(i + 1) % n];
                const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
                if (L < 1e-9) continue;
                ex.push(-dy / L);
                ey.push(dx / L);
                ec.push((a[1] * dx - a[0] * dy) / L);
            }
            this.faces.push({ ex, ey, ec, x0, y0, x1, y1, dmin, da, db, dc });
        }

        // Closed convex solid from faces given as vertex indices (either winding).
        // Faces sharing a smoothing group > 0 are facets of one curved surface:
        // the edges between them only show on the silhouette. `quiet` skips the
        // lines altogether, for callers that draw exact outlines themselves.
        solid(verts, faces, groups, quiet) {
            if (this.shadow) this.castShadow(verts);
            let mx = 0, my = 0, mz = 0;
            for (const v of verts) { mx += v[0]; my += v[1]; mz += v[2]; }
            mx /= verts.length; my /= verts.length; mz /= verts.length;
            const front = faces.map(f => {
                const pts = f.map(i => verts[i]);
                const n = newell(pts);
                let cx = 0, cy = 0, cz = 0;
                for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
                const s = n[0] * (cx / f.length - mx) + n[1] * (cy / f.length - my) + n[2] * (cz / f.length - mz) < 0 ? -1 : 1;
                const on = this.cam.facing(s * n[0], s * n[1], s * n[2]);
                if (on) this.face(pts, false);
                return on;
            });
            if (quiet) return;
            const edges = new Map();
            faces.forEach((f, fi) => {
                for (let i = 0; i < f.length; i++) {
                    const a = f[i], b = f[(i + 1) % f.length];
                    const key = a < b ? a * 4096 + b : b * 4096 + a;
                    const e = edges.get(key);
                    if (e) e.push(fi);
                    else edges.set(key, [a, b, fi]);
                }
            });
            for (const [a, b, f1, f2] of edges.values()) {
                let draw;
                if (f2 === undefined) draw = front[f1];
                else if (groups && groups[f1] > 0 && groups[f1] === groups[f2]) draw = front[f1] !== front[f2];
                else draw = front[f1] || front[f2];
                if (draw) this.line([verts[a], verts[b]]);
            }
        }

        box(F, a0, b0, c0, a1, b1, c1) {
            const P = F.P;
            this.solid([P(a0, b0, c0), P(a1, b0, c0), P(a1, b1, c0), P(a0, b1, c0),
                P(a0, b0, c1), P(a1, b0, c1), P(a1, b1, c1), P(a0, b1, c1)], BOX);
        }

        // Extrude a convex planar polygon (world points) along vector e
        prism(prof, e, smooth, quiet) {
            const m = prof.length;
            const v = prof.concat(prof.map(p => [p[0] + e[0], p[1] + e[1], p[2] + e[2]]));
            const f = [prof.map((_, i) => i), prof.map((_, i) => m + i)];
            const g = [0, 0];
            for (let i = 0; i < m; i++) {
                f.push([i, (i + 1) % m, m + (i + 1) % m, m + i]);
                g.push(smooth ? 1 : 0);
            }
            this.solid(v, f, g, quiet);
        }

        // Solid of revolution about a vertical axis from [radius, height] pairs,
        // bottom to top. A radius of 0 makes a point. Smooth ones get an exact
        // silhouette, faceted ones (umbrellas, low-poly trees) show every facet.
        lathe(x, y, prof, n, smooth = true, rot = 0) {
            const v = [], f = [], g = [], rings = [];
            for (const [r, z] of prof) {
                rings.push(v.length);
                if (r <= 1e-9) { v.push([x, y, z]); continue; }
                for (let i = 0; i < n; i++) {
                    const a = rot + (TAU * i) / n;
                    v.push([x + r * Math.cos(a), y + r * Math.sin(a), z]);
                }
            }
            const pt = k => prof[k][0] <= 1e-9;
            const idx = Array.from({ length: n }, (_, i) => i);
            if (!pt(0)) { f.push(idx.map(i => rings[0] + i)); g.push(0); }
            for (let k = 0; k + 1 < prof.length; k++) {
                const s0 = rings[k], s1 = rings[k + 1];
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    if (pt(k + 1)) f.push([s0 + i, s0 + j, s1]);
                    else if (pt(k)) f.push([s0, s1 + j, s1 + i]);
                    else f.push([s0 + i, s0 + j, s1 + j, s1 + i]);
                    g.push(smooth ? 1 : 0);
                }
            }
            const last = prof.length - 1;
            if (!pt(last)) { f.push(idx.map(i => rings[last] + i)); g.push(0); }
            this.solid(v, f, g, smooth);
            if (!smooth) return;
            // Exact outline: the silhouette where the surface turns edge-on to the
            // camera (per ring, from the profile's slope there), the near side of
            // the bottom rim and the whole top rim. Pushed out a hair so the
            // facets, which sit just inside the true surface, never hide it.
            const c = this.cam, phiF = Math.atan2(c.fy, c.fx);
            const at = (k, a) => {
                const r = prof[k][0] * 1.015 + 0.003;
                return [x + r * Math.cos(a), y + r * Math.sin(a), prof[k][1]];
            };
            const arc = (k, a0, a1) => {
                const m = Math.max(2, Math.ceil((Math.abs(a1 - a0) / TAU) * Math.max(16, n * 2)));
                const pts = [];
                for (let i = 0; i <= m; i++) pts.push(at(k, a0 + ((a1 - a0) * i) / m));
                this.line(pts);
            };
            // cosine of the silhouette angle from the far side, > 1 when the whole
            // ring faces the camera, < -1 when it all faces away
            const cosSil = k => {
                const a = prof[Math.max(0, k - 1)], b = prof[Math.min(last, k + 1)];
                const dr = b[0] - a[0], dz = b[1] - a[1];
                return dz > 1e-9 ? (-dr / dz) * c.tanE : dr < 0 ? 2 : -2;
            };
            const angle = k => {
                const cv = cosSil(k);
                return prof[k][0] > 1e-9 && Math.abs(cv) <= 1 ? Math.acos(cv) : null;
            };
            const ends = [];
            for (const sgn of [-1, 1]) {
                let run = [], lastK = -1;
                for (let k = 0; k <= last; k++) {
                    const a = angle(k);
                    if (a === null) {
                        if (run.length > 1) this.line(run);
                        run = [];
                        continue;
                    }
                    run.push(at(k, phiF + sgn * a));
                    lastK = k;
                }
                if (run.length > 1) this.line(run);
                ends.push(lastK);
            }
            if (!pt(0)) {
                const a = angle(0);
                if (a !== null) arc(0, phiF + a, phiF + TAU - a);
                else if (cosSil(0) > 1) arc(0, 0, TAU);
            }
            if (!pt(last)) arc(last, 0, TAU);
            // close a dome's silhouette over the back
            const k = ends[0];
            if (k > 0 && k === ends[1] && k < last) {
                const a = angle(k);
                arc(k, phiF - a, phiF + a);
            }
        }

        frustum(x, y, z0, z1, r0, r1, n, rot = 0, smooth = true) {
            this.lathe(x, y, [[r0, z0], [r1, z1]], n, smooth, rot);
        }

        // Parallel lines across a flat convex polygon (world points), running
        // along `dir` and `gap` mm apart on paper, whatever the face's angle to
        // the camera. Faces hide them like any other line, so hatch only faces
        // the camera can see.
        hatch(pts, dir, gap, phase = 0.5) {
            const pf = planeFrame(pts, dir);
            if (!pf || !(gap > 0)) return;
            // paper distance between neighbouring lines per metre of spacing
            const c = this.cam, o = c.project(0, 0, 0);
            const scr = v => { const q = c.project(v[0], v[1], v[2]); return [q[0] - o[0], q[1] - o[1]]; };
            const s1 = scr(pf.e1), s2 = scr(pf.e2), l1 = Math.hypot(s1[0], s1[1]);
            const per = l1 > 1e-9 ? Math.abs(s1[0] * s2[1] - s1[1] * s2[0]) / l1 : Math.hypot(s2[0], s2[1]);
            if (per < 1e-6) return;
            const spacing = gap / per;
            for (const [a, b] of geo.hatch([pts.map(pf.flatten)], spacing, 0, phase)) {
                this.line([pf.lift(a), pf.lift(b)]);
            }
        }

        // Start collecting the shadows cast onto flat ground at height z, cut to
        // the world rectangle `clip` ([x0, y0, x1, y1]) when given and hatched
        // along the ground direction at angle `ang` (radians from +x). Returns
        // nothing when the scene has no sun.
        shadowGroup(z, clip = null, ang = 0) {
            this.shadow = this.sun ? { z, clip, ang, polys: [] } : null;
            if (this.shadow) this.shadowGroups.push(this.shadow);
            return this.shadow;
        }

        castShadow(pts) {
            const g = this.shadow, [sx, sy] = this.sun;
            const q = pts.map(p => {
                const h = Math.max(0, p[2] - g.z);
                return [p[0] + h * sx, p[1] + h * sy];
            });
            const s = hull(q);
            if (s.length >= 3) g.polys.push(s);
        }

        // Fill every shadow group with lines `gap` mm apart on paper, merging
        // shadows that overlap. Lines of groups with the same angle line up, so
        // neighbouring shadows hatch as one.
        hatchShadows(gap) {
            const cam = this.cam;
            for (const g of this.shadowGroups) {
                if (!g.polys.length) continue;
                // work in a frame where the hatch lines run along x
                const ca = Math.cos(g.ang), sa = Math.sin(g.ang);
                const dr = ca * cam.rx + sa * cam.ry, df = ca * cam.fx + sa * cam.fy;
                const spacing = (gap * Math.hypot(dr, cam.se * df)) / (cam.k * cam.se);
                const polys = g.polys.map(P => {
                    const Q = P.map(p => [p[0] * ca + p[1] * sa, p[1] * ca - p[0] * sa]);
                    let lo = Infinity, hi = -Infinity;
                    for (const p of Q) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
                    return { Q, lo, hi };
                }).sort((a, b) => a.lo - b.lo);
                const back = (u, v) => [u * ca - v * sa, u * sa + v * ca, g.z];
                let y0 = Infinity, y1 = -Infinity;
                for (const P of polys) { if (P.lo < y0) y0 = P.lo; if (P.hi > y1) y1 = P.hi; }
                // sweep down the lines, only checking the shadows each one crosses
                let next = 0, live = [];
                for (let j = Math.ceil(y0 / spacing); j * spacing <= y1; j++) {
                    const y = j * spacing, iv = [];
                    while (next < polys.length && polys[next].lo <= y) live.push(polys[next++]);
                    live = live.filter(P => P.hi >= y);
                    for (const { Q: P } of live) {
                        let lo = Infinity, hi = -Infinity;
                        for (let i = 0, n = P.length; i < n; i++) {
                            const a = P[i], b = P[(i + 1) % n];
                            if ((a[1] > y) !== (b[1] > y)) {
                                const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
                                if (x < lo) lo = x;
                                if (x > hi) hi = x;
                            }
                        }
                        if (hi > lo) iv.push([lo, hi]);
                    }
                    iv.sort((u, v) => u[0] - v[0]);
                    let run = null;
                    const emit = () => {
                        let A = back(run[0], y), B = back(run[1], y);
                        if (g.clip) {
                            const t = clipToRect(A, B, g.clip);
                            if (!t) return;
                            [A, B] = t;
                        }
                        if (Math.abs(B[0] - A[0]) + Math.abs(B[1] - A[1]) > 1e-6) this.line([A, B]);
                    };
                    for (const r of iv) {
                        if (run && r[0] <= run[1]) run[1] = Math.max(run[1], r[1]);
                        else { if (run) emit(); run = r.slice(); }
                    }
                    if (run) emit();
                }
            }
        }
    }

    // The part of segment A-B (world points) inside the rectangle [x0, y0, x1, y1]
    function clipToRect(A, B, [x0, y0, x1, y1]) {
        let t0 = 0, t1 = 1;
        const dx = B[0] - A[0], dy = B[1] - A[1];
        const p = [-dx, dx, -dy, dy], q = [A[0] - x0, x1 - A[0], A[1] - y0, y1 - A[1]];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return null; continue; }
            const r = q[i] / p[i];
            if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        if (t1 - t0 < 1e-9) return null;
        const at = t => [A[0] + dx * t, A[1] + dy * t, A[2]];
        return [at(t0), at(t1)];
    }
    iso.Scene = Scene;

    // ------------------------------------------------------------------
    // Hidden line removal. Returns the visible paths (screen mm) by line kind,
    // or by slot when `slotOf` maps kinds to output slots.
    // ------------------------------------------------------------------
    iso.render = function (S, slotOf = null) {
        const { faces, lines, W, H } = S;
        const cell = 4;
        const gw = Math.max(1, Math.ceil(W / cell)), gh = Math.max(1, Math.ceil(H / cell));
        const grid = Array.from({ length: gw * gh }, () => []);
        const ci = x => Math.min(gw - 1, Math.max(0, Math.floor(x / cell)));
        const cj = y => Math.min(gh - 1, Math.max(0, Math.floor(y / cell)));
        faces.forEach((f, n) => {
            for (let j = cj(f.y0), j1 = cj(f.y1); j <= j1; j++) {
                for (let i = ci(f.x0), i1 = ci(f.x1); i <= i1; i++) grid[j * gw + i].push(n);
            }
        });
        const stamp = new Int32Array(faces.length);
        let tick = 0;
        const out = [];
        const hid = [], order = [];
        for (const L of lines) {
            const slot = slotOf ? slotOf[L.kind] : L.kind;
            const q = L.q, into = out[slot] || (out[slot] = []), mark = into.length;
            let cur = null, broken = false;
            for (let s = 1; s < q.length && !broken; s++) {
                const A = q[s - 1], B = q[s];
                const ax = A[0], ay = A[1], ad = A[2];
                const dx = B[0] - ax, dy = B[1] - ay, dd = B[2] - ad;
                if (Math.abs(dx) + Math.abs(dy) < 1e-9) continue;
                const bx0 = Math.min(ax, B[0]), bx1 = Math.max(ax, B[0]);
                const by0 = Math.min(ay, B[1]), by1 = Math.max(ay, B[1]);
                const far = Math.max(ad, B[2]) - HIDE_EPS;
                hid.length = 0;
                tick++;
                for (let j = cj(by0), j1 = cj(by1); j <= j1; j++) {
                    for (let i = ci(bx0), i1 = ci(bx1); i <= i1; i++) {
                        const bucket = grid[j * gw + i];
                        for (let m = 0; m < bucket.length; m++) {
                            const n = bucket[m];
                            if (stamp[n] === tick) continue;
                            stamp[n] = tick;
                            const f = faces[n];
                            if (f.dmin >= far || f.x0 > bx1 || f.x1 < bx0 || f.y0 > by1 || f.y1 < by0) continue;
                            // part of the segment inside the face (Cyrus-Beck)
                            let t0 = 0, t1 = 1;
                            const ex = f.ex, ey = f.ey, ec = f.ec;
                            for (let e = 0; e < ex.length; e++) {
                                const num = ex[e] * ax + ey[e] * ay - ec[e] - SHRINK;
                                const den = ex[e] * dx + ey[e] * dy;
                                if (den === 0) {
                                    if (num <= 0) { t1 = -1; break; }
                                    continue;
                                }
                                const t = -num / den;
                                if (den > 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
                                if (t0 >= t1) break;
                            }
                            if (t0 >= t1) continue;
                            // and of that, where the face is nearer than the segment
                            const g0 = ad - (f.da * ax + f.db * ay + f.dc) - HIDE_EPS;
                            const g1 = dd - (f.da * dx + f.db * dy);
                            if (g1 === 0) {
                                if (g0 <= 0) continue;
                            } else {
                                const tc = -g0 / g1;
                                if (g1 > 0) { if (tc > t0) t0 = tc; } else if (tc < t1) t1 = tc;
                                if (t0 >= t1) continue;
                            }
                            hid.push(t0, t1);
                        }
                    }
                }
                if (L.whole && hid.length) { broken = true; break; }
                // walk the gaps between hidden intervals
                order.length = 0;
                for (let k = 0; k < hid.length; k += 2) order.push(k);
                if (order.length > 1) order.sort((u, v) => hid[u] - hid[v]);
                let next = null, t = 0;
                const emit = (u0, u1) => {
                    if (u1 - u0 < 1e-9) return;
                    const p1 = [ax + dx * u1, ay + dy * u1];
                    if (u0 < 1e-9 && cur) cur.push(p1);
                    else {
                        cur = [[ax + dx * u0, ay + dy * u0], p1];
                        into.push(cur);
                    }
                    if (u1 > 1 - 1e-9) next = cur;
                };
                for (const k of order) {
                    if (hid[k] > t) emit(t, hid[k]);
                    if (hid[k + 1] > t) t = hid[k + 1];
                }
                if (t < 1) emit(t, 1);
                cur = next;
            }
            if (broken) into.length = mark;
        }
        return out.map(paths => paths.filter(p => geo.pathLength(p) > 0.05));
    };

    // Visible paths by pen. penOf maps line kinds to pens. Within a pen, lines
    // come grouped by group[kind] and in drawing order inside each group. The
    // scenes pass the kind each line had before they split out more kinds for
    // six and eight pens, so the older pen options give exactly the same paths
    // (the optimizer's stroke joining depends on the order).
    iso.renderPens = function (S, penOf, group) {
        const G = Math.max(...group) + 1;
        const byPen = [];
        iso.render(S, penOf.map((pen, k) => pen * G + group[k])).forEach((paths, slot) => {
            const into = byPen[Math.floor(slot / G)] || (byPen[Math.floor(slot / G)] = []);
            for (const q of paths) into.push(q);
        });
        return byPen;
    };

    // Segments for a circle of radius r (m) that stays within 0.04 mm of round
    // at scale k (mm per m).
    iso.segments = (r, k) => geo.clamp(Math.ceil(Math.PI / Math.acos(1 - Math.min(0.9, 0.04 / Math.max(r * k, 0.05)))), 8, 48);
})();
