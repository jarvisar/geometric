/*
 * Town: an isometric suburb in the style of an illustrated map.
 *
 * The town is a small 3D scene: a grid of raised blocks with curbs and
 * sidewalks, lots with houses, apartments, A-frames and the odd windmill,
 * plus cars, fences, trees and yard clutter. Everything is built from boxes,
 * prisms and faceted cylinders, with flat upright cut-outs for trees and
 * people, and viewed through an orthographic camera.
 *
 * Hidden lines are removed exactly. Every edge is clipped against the
 * projected faces in front of it (a face only hides the part of a segment
 * where the face is nearer), so the plot has just the visible outlines. Solids
 * only draw edges next to a face that points at the camera, and curved
 * surfaces only draw their silhouettes. Sizes are in metres and Scale turns
 * them into millimetres on paper.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const HIDE_EPS = 0.002; // m, a face has to be this much nearer to hide a line
    const SHRINK = 1e-6;    // mm, faces shrink a hair so they never hide their own edges
    const FLOOR = 2.9;      // storey height (m)
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    // box corners: 0-3 bottom, 4-7 top
    const BOX = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]];
    // line kinds, split over pens
    const BUILDING = 0, GROUND = 1, PLANT = 2, THING = 3;

    function hash(...ns) {
        let h = 0x811c9dc5;
        for (const n of ns) {
            h = Math.imul(h ^ (n | 0), 0x01000193);
            h ^= h >>> 15;
        }
        return h | 0;
    }

    // Orthographic camera. yaw turns the town about the vertical, elev tilts the
    // view down from the horizon (35.26° is true isometric). Screen coordinates
    // are mm with y down, depth is metres away from the camera.
    function makeCamera(yaw, elev, k, W, H, cx, cy) {
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
            ground(sx, sy) {
                const a = (sx - X0) / k, b = (Y0 - sy) / (k * se);
                return [a * rx + b * fx, a * ry + b * fy];
            },
            // does a face with this outward normal point at the camera?
            facing: (nx, ny, nz) => (nx * fx + ny * fy) * ce - nz * se < -1e-9,
        };
    }

    // Local frame for a lot or an object: u runs along the street (left to right
    // seen from the street), v points into the lot, c is height.
    function frame(ox, oy, oz, dir) {
        const [ux, uy] = DIRS[dir & 3], vx = -uy, vy = ux;
        return {
            P: (a, b, c) => [ox + a * ux + b * vx, oy + a * uy + b * vy, oz + c],
            V: (a, b, c) => [a * ux + b * vx, a * uy + b * vy, c],
        };
    }

    function newell(pts) {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            nx += (a[1] - b[1]) * (a[2] + b[2]);
            ny += (a[2] - b[2]) * (a[0] + b[0]);
            nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        return [nx, ny, nz];
    }

    // Inset a planar convex polygon (world points) by d within its own plane.
    function inset3(pts, d) {
        const n = newell(pts), nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-12) return [];
        const p0 = pts[0];
        let e1 = [pts[1][0] - p0[0], pts[1][1] - p0[1], pts[1][2] - p0[2]];
        const l1 = Math.hypot(e1[0], e1[1], e1[2]);
        e1 = e1.map(v => v / l1);
        const nn = n.map(v => v / nl);
        const e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
        const flat = pts.map(p => {
            const x = p[0] - p0[0], y = p[1] - p0[1], z = p[2] - p0[2];
            return [x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2]];
        });
        return geo.insetConvex(flat, d).map(([u, v]) => [
            p0[0] + u * e1[0] + v * e2[0], p0[1] + u * e1[1] + v * e2[1], p0[2] + u * e1[2] + v * e2[2]]);
    }

    function hull(pts) {
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
    }

    class Scene {
        constructor(cam, W, H) {
            this.cam = cam;
            this.W = W;
            this.H = H;
            this.faces = [];
            this.lines = [];
            this.kind = 0;
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

        // A line to draw where nothing is in front of it
        line(pts) {
            const c = this.cam;
            const q = pts.map(p => c.project(p[0], p[1], p[2]));
            if (q.length > 1 && this.onPage(q)) this.lines.push({ q, kind: this.kind });
        }

        loop(pts) {
            this.line(pts.concat([pts[0]]));
        }

        // A convex planar polygon that hides whatever is behind it
        face(pts) {
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
                if (on) this.face(pts);
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
        prism(prof, e, smooth) {
            const m = prof.length;
            const v = prof.concat(prof.map(p => [p[0] + e[0], p[1] + e[1], p[2] + e[2]]));
            const f = [prof.map((_, i) => i), prof.map((_, i) => m + i)];
            const g = [0, 0];
            for (let i = 0; i < m; i++) {
                f.push([i, (i + 1) % m, m + (i + 1) % m, m + i]);
                g.push(smooth ? 1 : 0);
            }
            this.solid(v, f, g);
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
    }

    // Upright cut-out through (x, y, z) facing the camera. `off` pulls it towards
    // the camera so stacked cut-outs overlap in order.
    function card(T, x, y, z, off = 0) {
        const c = T.cam, ox = x - off * c.fx, oy = y - off * c.fy;
        return (u, w) => [ox + u * c.rx, oy + u * c.ry, z + w];
    }

    // n points around a circle, placed in whatever plane at(cos, sin) maps to
    function ring(n, at) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(at(Math.cos((TAU * i) / n), Math.sin((TAU * i) / n)));
        return out;
    }

    // ------------------------------------------------------------------
    // Hidden line removal
    // ------------------------------------------------------------------
    function render(S) {
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
        const out = [[], [], [], []];
        const hid = [], order = [];
        for (const L of lines) {
            const q = L.q, into = out[L.kind];
            let cur = null;
            for (let s = 1; s < q.length; s++) {
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
        }
        return out.map(paths => paths.filter(p => geo.pathLength(p) > 0.05));
    }

    // ------------------------------------------------------------------
    // Walls, windows and roofs. Footprints are [a0, b0, a1, b1] in a lot frame.
    // ------------------------------------------------------------------

    // One wall of a footprint (0 front, 1 right, 2 back, 3 left). at(s, c) gives
    // the world point, with s running left to right seen from outside.
    function wall(F, side, fp) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        if (side === 0) return { len: a1 - a0, at: (s, c) => P(a0 + s, b0, c), n: F.V(0, -1, 0) };
        if (side === 1) return { len: b1 - b0, at: (s, c) => P(a1, b0 + s, c), n: F.V(1, 0, 0) };
        if (side === 2) return { len: a1 - a0, at: (s, c) => P(a1 - s, b1, c), n: F.V(0, 1, 0) };
        return { len: b1 - b0, at: (s, c) => P(a0, b1 - s, c), n: F.V(-1, 0, 0) };
    }

    function rect(T, at, s, c, w, h) {
        T.S.loop([at(s, c), at(s + w, c), at(s + w, c + h), at(s, c + h)]);
    }

    function pane(T, at, s, c, w, h, style) {
        const S = T.S;
        rect(T, at, s, c, w, h);
        if (!T.detail || Math.min(w, h) * T.k < 1.1) return;
        if (style === 'bars') {
            S.line([at(s, c + h / 3), at(s + w, c + h / 3)]);
            S.line([at(s, c + (2 * h) / 3), at(s + w, c + (2 * h) / 3)]);
        } else if (style === 'split') {
            S.line([at(s + w / 2, c), at(s + w / 2, c + h)]);
        } else if (style === 'sash') {
            S.line([at(s, c + h / 2), at(s + w, c + h / 2)]);
        } else if (style === 'cross') {
            S.line([at(s + w / 2, c), at(s + w / 2, c + h)]);
            S.line([at(s, c + h * 0.55), at(s + w, c + h * 0.55)]);
        } else if (style === 'wide') {
            S.line([at(s + w / 3, c), at(s + w / 3, c + h)]);
            S.line([at(s + (2 * w) / 3, c), at(s + (2 * w) / 3, c + h)]);
        }
    }

    function door(T, at, s, base, w = 1, h = 2.1, double = false) {
        rect(T, at, s - w / 2, base, w, h);
        if (!T.detail) return;
        if (double) T.S.line([at(s, base), at(s, base + h)]);
        else if (w * T.k > 1.4) T.S.line([at(s + w * 0.3, base + h * 0.47), at(s + w * 0.3, base + h * 0.53)]);
    }

    function garageDoor(T, at, s, base, w = 2.6, h = 2.2) {
        rect(T, at, s, base, w, h);
        if (!T.detail) return;
        const n = w * T.k > 5 ? 4 : 3;
        for (let i = 1; i < n; i++) T.S.line([at(s, base + (h * i) / n), at(s + w, base + (h * i) / n)]);
    }

    // Windows on every floor of a wall the camera can see, leaving room for doors.
    // o: { base, floors, style, winW, winH, sill, gap, doors: [s centre...], skip: [[s0, s1]...] }
    function windows(T, W, o) {
        if (!T.sees(W.n)) return false;
        const ww = o.winW || 1.1, wh = o.winH || 1.35, sill = o.sill || 0.9, gap = o.gap || 1.1;
        let n = Math.floor((W.len - 0.5 + gap) / (ww + gap));
        if (n < 1 && W.len > ww + 0.5) n = 1;
        const step = W.len / Math.max(1, n);
        const skip = (o.skip || []).concat((o.doors || []).map(d => [d - 0.75, d + 0.75]));
        for (let f = 0; f < o.floors; f++) {
            const c = o.base + f * FLOOR + sill;
            for (let i = 0; i < n; i++) {
                const s = (i + 0.5) * step - ww / 2;
                if (f === 0 && skip.some(([k0, k1]) => s < k1 + 0.15 && s + ww > k0 - 0.15)) continue;
                pane(T, W.at, s, c, ww, wh, o.style);
            }
        }
        return true;
    }

    // Line inside the two rakes of a gable end, so the roof reads as having some thickness
    function fascia(T, G, hw, rise, zb) {
        const L = Math.hypot(hw, rise), t = 0.2;
        const dx = t * L / rise, dz = t * L / hw;
        if (hw - dx < 0.3) return;
        T.S.line([G(-hw + dx, zb), G(0, zb + rise - dz), G(hw - dx, zb)]);
    }

    // Gable roof over a footprint, ridge along u or v, sitting a little below the
    // wall tops with overhanging eaves. Returns its height function.
    function gableRoof(T, F, fp, zTop, alongU, pitch, rng, o = {}) {
        const S = T.S, [a0, b0, a1, b1] = fp;
        const oh = 0.4, zb = zTop - 0.25, tp = Math.tan(pitch);
        const P = F.P;
        const res = { zb, alongU, tp, oh, fp };
        if (alongU) {
            const hw = (b1 - b0) / 2 + oh, rise = hw * tp, bm = (b0 + b1) / 2;
            S.prism([P(a0 - oh, b0 - oh, zb), P(a0 - oh, b1 + oh, zb), P(a0 - oh, bm, zb + rise)], F.V(a1 - a0 + 2 * oh, 0, 0));
            for (const [a, n] of [[a0 - oh, -1], [a1 + oh, 1]]) {
                if (!T.sees(F.V(n, 0, 0))) continue;
                const G = (s, c) => P(a, bm - n * s, c);
                fascia(T, G, hw, rise, zb);
                if (o.attic !== false && rise > 1.7) gableWindow(T, G, rise, zb, rng);
            }
            Object.assign(res, { hw, rise, mid: bm, h: (a, b) => zb + rise - Math.abs(b - bm) * tp });
        } else {
            const hw = (a1 - a0) / 2 + oh, rise = hw * tp, am = (a0 + a1) / 2;
            S.prism([P(a0 - oh, b0 - oh, zb), P(a1 + oh, b0 - oh, zb), P(am, b0 - oh, zb + rise)], F.V(0, b1 - b0 + 2 * oh, 0));
            for (const [b, n] of [[b0 - oh, -1], [b1 + oh, 1]]) {
                if (!T.sees(F.V(0, n, 0))) continue;
                const G = (s, c) => P(am - n * s, b, c);
                fascia(T, G, hw, rise, zb);
                if (o.attic !== false && rise > 1.7) gableWindow(T, G, rise, zb, rng);
            }
            Object.assign(res, { hw, rise, mid: am, h: (a, b) => zb + rise - Math.abs(a - am) * tp });
        }
        res.ridge = zb + res.rise;
        return res;
    }

    function gableWindow(T, G, rise, zb, rng) {
        const kind = rng.int(0, 2);
        const c = zb + rise * 0.28;
        if (kind === 0) {
            const s = Math.min(0.9, rise * 0.3);
            pane(T, G, -s / 2, c, s, s, 'cross');
        } else if (kind === 1) {
            const r = Math.min(0.42, rise * 0.14);
            T.S.loop(ring(T.segs(r), (x, y) => G(x * r, c + r + y * r)));
        } else {
            const w = Math.min(0.7, rise * 0.22), h = w * 1.3;
            pane(T, G, -w - 0.2, c, w, h, 'split');
            pane(T, G, 0.2, c, w, h, 'split');
        }
    }

    // A point on one slope of a gable roof: s along the eave, t up the slope.
    // side -1 is the slope at the low end of the cross axis, +1 the other.
    function gableSlope(F, R, side) {
        const [a0, b0, a1, b1] = R.fp, oh = R.oh;
        const cs = 1 / Math.hypot(1, R.tp), sn = R.tp * cs;
        const P = F.P;
        const len = (R.alongU ? a1 - a0 : b1 - b0) + 2 * oh, up = R.hw / cs;
        let at, n;
        if (R.alongU) {
            if (side < 0) { at = (s, t) => P(a0 - oh + s, b0 - oh + t * cs, R.zb + t * sn); n = F.V(0, -sn, cs); }
            else { at = (s, t) => P(a1 + oh - s, b1 + oh - t * cs, R.zb + t * sn); n = F.V(0, sn, cs); }
        } else if (side < 0) {
            at = (s, t) => P(a0 - oh + t * cs, b1 + oh - s, R.zb + t * sn); n = F.V(-sn, 0, cs);
        } else {
            at = (s, t) => P(a1 + oh - t * cs, b0 - oh + s, R.zb + t * sn); n = F.V(sn, 0, cs);
        }
        return { at, n, len, up };
    }

    // Skylights, solar panels or a dormer on the slopes the camera can see
    function roofExtras(T, F, R, rng, allowDormer) {
        for (const side of [-1, 1]) {
            const sl = gableSlope(F, R, side);
            if (!T.sees(sl.n) || sl.up < 2.2) continue;
            const roll = rng.random();
            if (roll < 0.22 && sl.len > 4) {
                const w = Math.min(sl.len - 1.6, rng.range(2.6, 4.2)), h = Math.min(sl.up - 1.1, 2.1);
                const s0 = rng.range(0.8, sl.len - 0.8 - w), t0 = 0.6;
                T.S.loop([sl.at(s0, t0), sl.at(s0 + w, t0), sl.at(s0 + w, t0 + h), sl.at(s0, t0 + h)]);
                if (T.detail) {
                    const cols = Math.max(2, Math.round(w / 1.05));
                    for (let i = 1; i < cols; i++) T.S.line([sl.at(s0 + (w * i) / cols, t0), sl.at(s0 + (w * i) / cols, t0 + h)]);
                    T.S.line([sl.at(s0, t0 + h / 2), sl.at(s0 + w, t0 + h / 2)]);
                }
            } else if (roll < 0.45) {
                const n = sl.len > 7 && rng.chance(0.5) ? 2 : 1;
                for (let i = 0; i < n; i++) {
                    const s0 = ((i + 0.5) * sl.len) / n - 0.5 + rng.range(-0.6, 0.6);
                    const t0 = rng.range(0.7, Math.max(0.8, sl.up - 2.2));
                    T.S.loop([sl.at(s0, t0), sl.at(s0 + 1, t0), sl.at(s0 + 1, t0 + 1.2), sl.at(s0, t0 + 1.2)]);
                }
            } else if (roll < 0.62 && allowDormer && R.alongU) {
                dormer(T, F, R, side, rng);
            }
        }
    }

    // Shed dormer poking out of a gable slope (ridge along u only)
    function dormer(T, F, R, side, rng) {
        const [a0, b0, a1, b1] = R.fp, oh = R.oh, tp = R.tp;
        const hd = 1.25, wd = Math.min(2.2, (a1 - a0) * 0.35);
        const df = 1.0;                    // distance in from the eave
        if (df + hd / tp > R.hw - 0.3) return;
        const bE = side < 0 ? b0 - oh : b1 + oh;
        const bAt = d => bE - side * d;
        const zs = d => R.zb + d * tp;
        const ad = rng.range(a0 + 0.5, a1 - 0.5 - wd);
        const P = F.P, db = df + hd / tp, zt = zs(df) + hd;
        const v = [P(ad, bAt(df), zs(df)), P(ad + wd, bAt(df), zs(df)), P(ad + wd, bAt(df), zt), P(ad, bAt(df), zt),
            P(ad, bAt(db), zt), P(ad + wd, bAt(db), zt)];
        T.S.solid(v, [[0, 1, 2, 3], [3, 2, 5, 4], [0, 3, 4], [1, 5, 2], [0, 4, 5, 1]]);
        const at = side < 0 ? (s, c) => P(ad + s, bAt(df), c) : (s, c) => P(ad + wd - s, bAt(df), c);
        pane(T, at, 0.3, zs(df) + 0.25, wd - 0.6, hd - 0.5, 'split');
    }

    // Starts down at the eaves, so only the part above the roof shows
    function chimney(T, F, a, b, zFrom, zTo) {
        T.S.box(F, a - 0.35, b - 0.35, zFrom, a + 0.35, b + 0.35, zTo);
        T.S.box(F, a - 0.45, b - 0.45, zTo, a + 0.45, b + 0.45, zTo + 0.18);
    }

    function roofUnit(T, F, a, b, z, s = 1) {
        const r = 0.45 * s, leg = 0.35 * s, h = 0.45 * s;
        T.S.box(F, a - r, b - r, z + leg, a + r, b + r, z + leg + h);
        for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = a + da * (r - 0.08), y = b + db * (r - 0.08);
            T.S.line([F.P(x, y, z), F.P(x, y, z + leg)]);
        }
    }

    function flatRoof(T, F, fp, zTop, o = 0.25, t = 0.35) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        T.S.box(F, a0 - o, b0 - o, zTop, a1 + o, b1 + o, zTop + t);
        const d = 0.3, z = zTop + t;
        if (Math.min(a1 - a0, b1 - b0) > 3) {
            T.S.loop([P(a0 - o + d, b0 - o + d, z), P(a1 + o - d, b0 - o + d, z), P(a1 + o - d, b1 + o - d, z), P(a0 - o + d, b1 + o - d, z)]);
        }
        return z;
    }

    function plinth(T, F, fp, h, o = 0.25) {
        const [a0, b0, a1, b1] = fp;
        T.S.box(F, a0 - o, b0 - o, 0, a1 + o, b1 + o, h);
    }

    function steps(T, F, s, b, w, n, rise = 0.17, run = 0.3) {
        for (let i = 0; i < n; i++) T.S.box(F, s - w / 2, b - run * (n - i), rise * i, s + w / 2, b, rise * (i + 1));
    }

    function porch(T, F, s0, s1, b, depth, h) {
        const S = T.S;
        S.box(F, s0, b - depth, 0, s1, b, 0.3);
        for (const s of [s0 + 0.1, s1 - 0.25]) S.box(F, s, b - depth + 0.1, 0.3, s + 0.15, b - depth + 0.25, h);
        S.box(F, s0 - 0.15, b - depth - 0.15, h, s1 + 0.15, b, h + 0.22);
    }

    function downpipe(T, W, s, base, top) {
        const S = T.S;
        S.line([W.at(s, base), W.at(s, top - 0.35)]);
        S.line([W.at(s, top - 0.35), W.at(s - 0.25, top - 0.1)]);
    }

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

    function hipRoof(T, F, fp, zTop, pitch) {
        const [a0, b0, a1, b1] = fp, P = F.P;
        const oh = 0.4, zb = zTop - 0.25;
        const A0 = a0 - oh, A1 = a1 + oh, B0 = b0 - oh, B1 = b1 + oh;
        const hw = Math.min(A1 - A0, B1 - B0) / 2, rise = hw * Math.tan(pitch);
        const v = [P(A0, B0, zb), P(A1, B0, zb), P(A1, B1, zb), P(A0, B1, zb)];
        let f;
        if (A1 - A0 > B1 - B0 + 0.05) {
            const bm = (B0 + B1) / 2;
            v.push(P(A0 + hw, bm, zb + rise), P(A1 - hw, bm, zb + rise));
            f = [[0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5]];
        } else if (B1 - B0 > A1 - A0 + 0.05) {
            const am = (A0 + A1) / 2;
            v.push(P(am, B0 + hw, zb + rise), P(am, B1 - hw, zb + rise));
            f = [[0, 3, 2, 1], [3, 0, 4, 5], [1, 2, 5, 4], [0, 1, 4], [2, 3, 5]];
        } else {
            v.push(P((A0 + A1) / 2, (B0 + B1) / 2, zb + rise));
            f = [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
        }
        T.S.solid(v, f);
        return { zb, rise, ridge: zb + rise, fp };
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
            S.frustum(x, y, z - 0.3, z + 1.2, 0.16, 0.16, 8);
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
    // Cars
    // ------------------------------------------------------------------

    // Hexahedron with a box's topology: bottom a0..a1, top t0..t1
    function cabin(T, F, a0, a1, t0, t1, hw, c0, c1) {
        const P = F.P;
        const v = [P(a0, -hw, c0), P(a1, -hw, c0), P(a1, hw, c0), P(a0, hw, c0),
            P(t0, -hw, c1), P(t1, -hw, c1), P(t1, hw, c1), P(t0, hw, c1)];
        T.S.solid(v, BOX);
        if (!T.detail) return;
        // windows inset into the sides, windscreen and back window
        const faces = [[0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
        const mid = [(a0 + a1 + t0 + t1) / 4, 0, (c0 + c1) / 2];
        const centre = P(...mid);
        faces.forEach((f, i) => {
            const pts = f.map(j => v[j]);
            const n = newell(pts);
            let cx = 0, cy = 0, cz = 0;
            for (const p of pts) { cx += p[0] / 4; cy += p[1] / 4; cz += p[2] / 4; }
            const s = n[0] * (cx - centre[0]) + n[1] * (cy - centre[1]) + n[2] * (cz - centre[2]) < 0 ? -1 : 1;
            if (!T.cam.facing(s * n[0], s * n[1], s * n[2])) return;
            const ins = inset3(pts, Math.min(0.12, (c1 - c0) * 0.22));
            if (ins.length < 3) return;
            T.S.loop(ins);
            if (i < 2 && Math.abs(a1 - a0) > 1.8) {
                // pillar between the front and back side windows
                const e = geo.lerp(a0, a1, 0.52), et = geo.lerp(t0, t1, 0.52);
                const b = i === 0 ? -hw : hw;
                T.S.line([P(e, b, c0 + 0.1), P(et, b, c1 - 0.1)]);
            }
        });
    }

    function wheels(T, F, xs, hw, r) {
        const S = T.S, n = T.segs(r);
        for (const a of xs) {
            for (const side of [-1, 1]) {
                const b = side * (hw + 0.04);
                const pts = ring(n, (c, s) => F.P(a + r * c, b, r + r * s));
                S.face(pts);
                S.loop(pts);
                if (T.detail && r * T.k > 0.6) S.loop(ring(Math.max(6, n >> 1), (c, s) => F.P(a + r * 0.45 * c, b, r + r * 0.45 * s)));
            }
        }
    }

    // `street` lets in the box truck, which is too long for a driveway
    function car(T, x, y, z, dir, rng, street = false) {
        const S = T.S, F = frame(x, y, z, dir);
        S.kind = THING;
        const type = rng.weighted([[4, 'sedan'], [4, 'suv'], [2, 'pickup'], [1, 'van'], [street ? 0.6 : 0, 'truck']]);
        if (type === 'sedan') {
            const L = 4.2, hw = 0.9, r = 0.39;
            S.box(F, -L / 2, -hw, r * 0.75, L / 2, hw, 1.02);
            cabin(T, F, -1.45, 0.85, -1.1, 0.3, hw - 0.06, 1.02, 1.65);
            wheels(T, F, [-L / 2 + 0.8, L / 2 - 0.85], hw, r);
        } else if (type === 'suv') {
            const L = 4.5, hw = 0.95, r = 0.44;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.12);
            cabin(T, F, -2.15, 1.05, -2.1, 0.5, hw - 0.05, 1.12, 1.98);
            wheels(T, F, [-L / 2 + 0.8, L / 2 - 0.85], hw, r);
        } else if (type === 'pickup') {
            const L = 5, hw = 0.95, r = 0.44;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.15);
            cabin(T, F, -0.6, 1.0, -0.5, 0.55, hw - 0.05, 1.15, 1.9);
            S.box(F, -L / 2 + 0.05, -hw + 0.02, 1.15, -0.75, hw - 0.02, 1.55);
            if (T.detail) S.loop([F.P(-L / 2 + 0.2, -hw + 0.15, 1.55), F.P(-0.9, -hw + 0.15, 1.55), F.P(-0.9, hw - 0.15, 1.55), F.P(-L / 2 + 0.2, hw - 0.15, 1.55)]);
            wheels(T, F, [-L / 2 + 0.95, L / 2 - 0.95], hw, r);
        } else if (type === 'van') {
            const L = 5, hw = 0.98, r = 0.42;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2, hw, 1.2);
            cabin(T, F, -L / 2, L / 2 - 0.35, -L / 2, L / 2 - 1.1, hw, 1.2, 2.1);
            wheels(T, F, [-L / 2 + 0.9, L / 2 - 0.9], hw, r);
        } else {
            // box truck
            const L = 6.4, hw = 1.1, r = 0.45;
            S.box(F, -L / 2, -hw, r * 0.8, L / 2 - 1.9, hw, 3.2);
            S.box(F, L / 2 - 1.85, -hw + 0.05, r * 0.8, L / 2, hw - 0.05, 1.35);
            cabin(T, F, L / 2 - 1.85, L / 2 - 0.1, L / 2 - 1.85, L / 2 - 0.7, hw - 0.05, 1.35, 2.45);
            wheels(T, F, [-L / 2 + 1.1, L / 2 - 1.0], hw, r);
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

    // Picket fence between two world points on the same level
    function fence(T, p0, p1, h = 1, rails = false) {
        const S = T.S;
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 0.4) return;
        const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
        const at = (s, c) => [p0[0] + ux * s, p0[1] + uy * s, p0[2] + c];
        S.face([at(0, 0), at(L, 0), at(L, h * 0.8), at(0, h * 0.8)]);
        S.line([at(0, h * 0.7), at(L, h * 0.7)]);
        if (rails) S.line([at(0, h), at(L, h)]);
        const n = Math.max(1, Math.round(L / T.picket));
        for (let i = 0; i <= n; i++) S.line([at((L * i) / n, 0), at((L * i) / n, h)]);
    }

    // Balcony railing along a polyline, bars on a coarser spacing than pickets
    function railing(T, pts, h = 1) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const at = (s, c) => [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L, a[2] + c];
            T.S.face([at(0, 0), at(L, 0), at(L, h * 0.9), at(0, h * 0.9)]);
            T.S.line([at(0, h), at(L, h)]);
            const n = Math.max(1, Math.round(L / Math.max(0.35, T.picket * 1.2)));
            for (let j = 0; j <= n; j++) T.S.line([at((L * j) / n, 0), at((L * j) / n, h)]);
        }
    }

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

    function patioSet(T, F, a, b, rng) {
        const S = T.S;
        const [x, y, z] = F.P(a, b, 0);
        const tr = 0.55;
        const top = ring(T.segs(tr), (c, s) => [x + tr * c, y + tr * s, z + 0.75]);
        S.face(top);
        S.loop(top);
        S.line([[x, y, z], [x, y, z + 0.75]]);
        if (rng.chance(0.7)) {
            S.frustum(x, y, z + 2.05, z + 2.55, 1.35, 0, 8, rng.range(0, TAU), false);
            S.line([[x, y, z + 0.75], [x, y, z + 2.05]]);
        }
        const n = rng.int(2, 3), a0 = rng.range(0, TAU);
        for (let i = 0; i < n; i++) {
            const t = a0 + (TAU * i) / n, cx = Math.cos(t), cy = Math.sin(t);
            chair(T, x + cx, y + cy, z, nearestDir(-cx, -cy));
        }
    }

    // Which of the four frame directions is closest to (dx, dy)
    function nearestDir(dx, dy) {
        let best = 0;
        for (let i = 1; i < 4; i++) {
            if (DIRS[i][0] * dx + DIRS[i][1] * dy > DIRS[best][0] * dx + DIRS[best][1] * dy) best = i;
        }
        return best;
    }

    // Seat faces u, backrest behind it
    function chair(T, x, y, z, dir) {
        const F = frame(x, y, z, dir);
        T.S.box(F, -0.22, -0.22, 0.4, 0.22, 0.22, 0.46);
        T.S.box(F, -0.22, -0.22, 0.46, -0.16, 0.22, 0.9);
        for (const [a, b] of [[0.18, -0.18], [0.18, 0.18], [-0.18, 0.18], [-0.18, -0.18]]) T.S.line([F.P(a, b, 0), F.P(a, b, 0.4)]);
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

    function picnicTable(T, x, y, z, dir) {
        const G = frame(x, y, z, dir), S = T.S, l = 0.9;
        S.box(G, -l, -0.4, 0.7, l, 0.4, 0.77);
        S.box(G, -l, -0.78, 0.42, l, -0.52, 0.47);
        S.box(G, -l, 0.52, 0.42, l, 0.78, 0.47);
        for (const s of [-l + 0.2, l - 0.2]) {
            S.line([G.P(s, -0.7, 0), G.P(s, 0.3, 0.7)]);
            S.line([G.P(s, 0.7, 0), G.P(s, -0.3, 0.7)]);
        }
    }

    function bench(T, x, y, z, dir) {
        const F = frame(x, y, z, dir), S = T.S;
        S.box(F, -0.8, -0.22, 0.42, 0.8, 0.22, 0.48);
        S.box(F, -0.8, 0.16, 0.55, 0.8, 0.22, 0.9);
        for (const s of [-0.65, 0.65]) {
            S.line([F.P(s, -0.18, 0), F.P(s, -0.18, 0.42)]);
            S.line([F.P(s, 0.18, 0), F.P(s, 0.18, 0.42)]);
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
        const S = T.S, fp = [a - 0.45, b - 0.55, a + 0.45, b + 0.55];
        S.box(F, fp[0], fp[1], 0, fp[2], fp[3], 0.6);
        gableRoof(T, F, fp, 0.6, false, geo.rad(40), null, { attic: false });
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

    function clothesline(T, F, a, b, L, rng) {
        const S = T.S;
        for (const s of [a, a + L]) {
            S.line([F.P(s, b, 0), F.P(s, b, 1.9)]);
            S.line([F.P(s, b - 0.35, 1.9), F.P(s, b + 0.35, 1.9)]);
        }
        for (const o of [-0.3, 0.3]) S.line([F.P(a, b + o, 1.9), F.P(a + L, b + o, 1.85)]);
        let s = a + 0.3;
        while (s < a + L - 0.8) {
            const w = rng.range(0.4, 0.7), h = rng.range(0.5, 0.8);
            const pts = [F.P(s, b - 0.3, 1.88), F.P(s + w, b - 0.3, 1.88), F.P(s + w, b - 0.3, 1.88 - h), F.P(s, b - 0.3, 1.88 - h)];
            S.face(pts);
            S.loop(pts);
            s += w + 0.25;
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
            const p0 = pt(s - 0.18), p1 = pt(s + 0.18), tip = F.P(a + s, b, pt(s)[2] - 0.45);
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

    function person(T, x, y, z, rng) {
        const S = T.S, ce = T.cam.ce;
        S.kind = THING;
        const P = card(T, x, y, z, 0);
        const h = rng.range(1.6, 1.85), hr = 0.13;
        const body = [P(-0.2, 0.85), P(0.2, 0.85), P(0.23, h - 0.38), P(0.14, h - 0.28), P(-0.14, h - 0.28), P(-0.23, h - 0.38)];
        S.face(body);
        S.loop(body);
        const head = ring(T.segs(hr), (c, s) => P(hr * c, h - hr / ce + (hr * s) / ce));
        S.face(head);
        S.loop(head);
        const step = rng.range(-0.12, 0.12);
        S.line([P(-0.09, 0.85), P(-0.09 + step, 0)]);
        S.line([P(0.09, 0.85), P(0.09 - step, 0)]);
    }

    // Bicycle drawn in its own upright plane along `dir`, with a rider if asked
    function bike(T, x, y, z, dir, rng, rider) {
        const S = T.S, F = frame(x, y, z, dir);
        S.kind = THING;
        const P = (a, c) => F.P(a, 0, c);
        const r = 0.34, n = Math.max(8, T.segs(r));
        for (const a of [-0.52, 0.52]) S.loop(ring(n, (c, s) => P(a + r * c, r + r * s)));
        const rear = P(-0.52, r), front = P(0.52, r), bb = P(-0.05, 0.3);
        const seat = P(-0.18, 0.86), head = P(0.36, 0.84), bar = P(0.33, 1.0);
        S.line([rear, bb, seat, rear]);
        S.line([seat, head, bb]);
        S.line([front, head, bar]);
        if (!rider) return;
        const hr = 0.12, ce = T.cam.ce;
        const shoulder = P(0.08, 1.45);
        S.line([P(-0.15, 0.92), shoulder, bar]);
        const k = rng.range(-0.12, 0.12);
        S.line([P(-0.12, 0.92), P(0.05 + k, 0.62), P(-0.05 + k, 0.2)]);
        const [hx, hy, hz] = P(0.13, 1.45 + hr / ce + 0.04);
        const C = card(T, hx, hy, 0, 0);
        const headPts = ring(T.segs(hr), (c, s) => C(hr * c, hz + (hr * s) / ce));
        S.face(headPts);
        S.loop(headPts);
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
        const cx = W * rng.range(0.4, 0.6), cy = D * rng.range(0.4, 0.6), pr = Math.min(W, D) * rng.range(0.12, 0.17);
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

    // Keeps props from landing on each other within a lot
    class Occupancy {
        constructor(w, d) { this.w = w; this.d = d; this.rects = []; }
        add(a0, b0, a1, b1) { this.rects.push([a0, b0, a1, b1]); }
        free(a0, b0, a1, b1, pad = 0.3) {
            if (a0 < 0.3 || b0 < 0.3 || a1 > this.w - 0.3 || b1 > this.d - 0.3) return false;
            return !this.rects.some(r => a0 < r[2] + pad && a1 > r[0] - pad && b0 < r[3] + pad && b1 > r[1] - pad);
        }
        // random spot for a w × d footprint inside [a0, a1] × [b0, b1]
        place(rng, w, d, a0 = 0, b0 = 0, a1 = this.w, b1 = this.d, tries = 14) {
            if (a1 - w < a0 || b1 - d < b0) return null;
            for (let i = 0; i < tries; i++) {
                const a = rng.range(a0, a1 - w), b = rng.range(b0, b1 - d);
                if (this.free(a, b, a + w, b + d)) {
                    this.add(a, b, a + w, b + d);
                    return [a, b];
                }
            }
            return null;
        }
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
            apartment(T, F, fp, rng, { floors: geo.clamp(rng.int(3, 5), Math.min(3, maxF), maxF) });
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
            const kind = pr.weighted([
                [o.kind === 'park' ? 0 : 3, 'trampoline'], [3, 'patio'], [2, 'picnic'], [2, 'grill'],
                [o.kind === 'park' ? 0 : 1.5, 'bed'], [1.2, 'shed'], [1, 'dog'], [1, 'hives'],
                [o.kind === 'park' ? 0 : 1, 'clothes'], [1, 'swings'], [o.kind === 'park' ? 0 : 0.8, 'pool'],
                [0.6, 'bunting'], [o.kind === 'park' ? 3 : 0.5, 'bench'],
            ]);
            const size = {
                trampoline: [3.6, 3.6], patio: [3, 3], picnic: [2.2, 2], grill: [0.9, 0.9], bed: [3, 1.6],
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
            else if (kind === 'picnic') picnicTable(T, x, y, lot.z, (lot.dir + (sw > sd ? 0 : 1)) & 3);
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
                person(T, x, y, lot.z, pp);
            }
        }
        if (o.fp && pp.chance(p.people * 0.35)) {
            const at = occ.place(pp, 1.8, 0.6, 0.4, 0.6, w - 0.4, o.fp[1], 6);
            if (at) {
                const [x, y] = F.P(at[0] + 0.9, at[1] + 0.3, 0);
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
                // segments for a circle of radius r (m) that stays within 0.04 mm of round
                segs: r => geo.clamp(Math.ceil(Math.PI / Math.acos(1 - Math.min(0.9, 0.04 / Math.max(r * k, 0.05)))), 8, 48),
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
