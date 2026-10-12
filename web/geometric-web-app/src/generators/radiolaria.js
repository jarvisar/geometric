/*
 * Radiolaria Plate: a page of invented radiolarian skeletons, laid out like a
 * plate from Haeckel's Kunstformen der Natur.
 *
 * Every shell is a surface of revolution (a profile turned about the
 * specimen's axis), so spheres, bells and lens-shaped discs are all the same
 * thing here. A pore is a hole drilled through the wall along the surface
 * normal: a round or many-sided outline in the tangent plane, which keeps the
 * test for "is this point of the wall a hole" down to a few 2D checks.
 *
 * Hidden lines aren't done with iso.js, since that only knows solid faces. A
 * point is tested by walking its sight line back to the eye. Each time the
 * line crosses the front of a shell it has to go through a pore, and the back
 * of a shell hides everything. That's what lets an inner shell show only
 * through the pores of the shell in front of it. With a wall thickness the
 * line also has to clear the far end of the hole, and the rim down there is
 * drawn where it shows, as a crescent on the side of the pore away from you.
 *
 * Pores are picked for what they come to on paper. They're taken from the
 * middle of a shell outwards, and one is left out (and stays solid wall) when
 * it's squashed too thin, lands closer than CLEAR to a line already there, or
 * would be cut in half by a spine or a fold. What shows through a pore stops
 * HALO short of its rim, so lines at two depths never run into each other.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const SHELL = 0, INNER = 1, WALL = 2, SPINE = 3, BELL = 4, DISC = 5, BRISTLE = 6, LABEL = 7;
    const CLEAR = 0.6;  // mm. Lines of one shell running closer than this merge into one fat line.
    const SMALL = 0.8;  // mm. A pore squashed thinner than this on paper is left out.
    const SPECK = 0.9;  // mm. Shorter bits of line seen through a pore just look like dirt.
    const STUB = 2;     // mm. Less than this of a spine showing past a shell isn't worth a mark.
    const STEP = 0.3;   // mm between visibility samples along a line
    const LIFT = 0.06;  // mm. Lines on a shell are tested this far off it, so a shell never hides its own lines.
    const HALO = 0.45;  // mm. What's seen through a pore stops this short of its rim, so the two never run together.
    const THIN = 1.3;   // mm. A spine narrower than this at its foot is a single line.
    const FACING = 0.15; // pores turned further from the eye than this (cosine) aren't tried at all
    const MAX_SITES = 900; // pores on one shell, front and back. Bigger shells get bigger pores instead.

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const mad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    const rot = (axis, a) => {
        const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], j = (axis + 1) % 3, k = (axis + 2) % 3, c = Math.cos(a), s = Math.sin(a);
        m[j][j] = c; m[j][k] = -s; m[k][j] = s; m[k][k] = c;
        return m;
    };
    // View coordinates are x right, y up and depth towards the eye. Spin turns the specimen
    // about its own axis, pitch tips the axis (-90° stands it upright on the page) and roll
    // turns the picture.
    const pose = (spin, pitch, roll) => mul(rot(2, roll), mul(rot(0, pitch), rot(2, spin)));
    const view = (R, p) => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];

    // ---- shells

    // A shell from its profile, [radius, height] pairs from the top of the axis down.
    function shell(prof, part, depth) {
        const n = prof.length, sh = {
            n, part, depth, ell: null, sites: [], grid: null, clear: clearance(), reach: 0,
            r: new Float64Array(n), z: new Float64Array(n), S: new Float64Array(n), nr: new Float64Array(n), nz: new Float64Array(n),
            dr: new Float64Array(n), dz: new Float64Array(n), len: new Float64Array(n),
        };
        for (let i = 0; i < n; i++) {
            sh.r[i] = prof[i][0]; sh.z[i] = prof[i][1];
            sh.reach = Math.max(sh.reach, Math.hypot(prof[i][0], prof[i][1]));
        }
        for (let i = 0; i < n - 1; i++) {
            sh.dr[i] = sh.r[i + 1] - sh.r[i]; sh.dz[i] = sh.z[i + 1] - sh.z[i];
            sh.len[i] = Math.hypot(sh.dr[i], sh.dz[i]) || 1e-12;
            sh.S[i + 1] = sh.S[i] + sh.len[i];
        }
        // outward normals in the (r, z) plane, straight up or down at a pole
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dr = sh.r[b] - sh.r[a], dz = sh.z[b] - sh.z[a], l = Math.hypot(dr, dz) || 1;
            if (sh.r[i] < 1e-9) { sh.nr[i] = 0; sh.nz[i] = dr >= 0 ? 1 : -1; } else { sh.nr[i] = -dz / l; sh.nz[i] = dr / l; }
        }
        sh.L = sh.S[n - 1];
        return sh;
    }
    function spheroid(a, c, part, depth) {
        const m = 72, sh = shell(Array.from({ length: m + 1 }, (_, i) => [i % m ? a * Math.sin(Math.PI * i / m) : 0, c * Math.cos(Math.PI * i / m)]), part, depth);
        sh.ell = [a, c];
        return sh;
    }
    // Distance along the profile to a position between its points
    function along(sh, s) {
        let lo = 0, hi = sh.n - 1;
        s = geo.clamp(s, 0, sh.L);
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sh.S[mid] <= s) lo = mid; else hi = mid; }
        return lo + (s - sh.S[lo]) / sh.len[lo];
    }
    const radius = (sh, f) => { const i = Math.min(sh.n - 2, Math.floor(f)); return sh.r[i] + sh.dr[i] * (f - i); };
    function normal(sh, f, phi) {
        const i = Math.min(sh.n - 2, Math.max(0, Math.floor(f))), t = f - i;
        const a = sh.nr[i] + (sh.nr[i + 1] - sh.nr[i]) * t, b = sh.nz[i] + (sh.nz[i + 1] - sh.nz[i]) * t, l = Math.hypot(a, b) || 1;
        return [a / l * Math.cos(phi), a / l * Math.sin(phi), b / l];
    }
    function point(sh, f, phi) {
        const i = Math.min(sh.n - 2, Math.max(0, Math.floor(f))), t = f - i, r = sh.r[i] + sh.dr[i] * t;
        return [r * Math.cos(phi), r * Math.sin(phi), sh.z[i] + sh.dz[i] * t];
    }

    // Where the line o + l w crosses a shell, as pairs of l and a number that is positive
    // when the outside of the wall faces along w. Returns how many numbers were written.
    function hits(sh, ox, oy, oz, wx, wy, wz, out) {
        const wxy = wx * wx + wy * wy, bq = ox * wx + oy * wy, cq = ox * ox + oy * oy;
        let m = 0;
        if (sh.ell) {
            const ia = 1 / (sh.ell[0] * sh.ell[0]), ic = 1 / (sh.ell[1] * sh.ell[1]);
            const A = wxy * ia + wz * wz * ic, B = bq * ia + oz * wz * ic, D = B * B - A * (cq * ia + oz * oz * ic - 1);
            if (D <= 0) return 0;
            const q = Math.sqrt(D);
            out[0] = (-B - q) / A; out[1] = -q; out[2] = (-B + q) / A; out[3] = q;
            return 4;
        }
        for (let k = 0; k < sh.n - 1; k++) {
            const dz = sh.dz[k], dr = sh.dr[k], r0 = sh.r[k];
            if (dz > -1e-9 && dz < 1e-9) {
                // a flat ring
                if (wz > -1e-12 && wz < 1e-12) continue;
                const l = (sh.z[k] - oz) / wz, rho = Math.hypot(ox + l * wx, oy + l * wy);
                if ((rho - r0) * (rho - r0 - dr) > 0) continue;
                out[m++] = l; out[m++] = dr * wz;
                continue;
            }
            // a cone: the radius is linear in l too, so it's one quadratic
            const be = wz / dz, al = (oz - sh.z[k]) / dz, rt = r0 + dr * al, sl = dr * be;
            const A = wxy - sl * sl, B = bq - rt * sl, C = cq - rt * rt;
            let l1, l2 = NaN;
            if (A > -1e-12 && A < 1e-12) {
                if (B === 0) continue;
                l1 = -C / (2 * B);
            } else {
                const D = B * B - A * C;
                if (D < 0) continue;
                const q = Math.sqrt(D);
                l1 = (-B - q) / A; l2 = (-B + q) / A;
            }
            for (let c = 0; c < 2; c++) {
                const l = c ? l2 : l1, t = al + be * l;
                if (!(t >= -1e-9 && t <= 1 + 1e-9) || rt + sl * l < 0) continue;
                const x = ox + l * wx, y = oy + l * wy, rho = Math.hypot(x, y) || 1e-12;
                out[m++] = l; out[m++] = -dz * (x * wx + y * wy) / rho + dr * wz;
            }
        }
        return m;
    }
    const HIT = new Float64Array(256), DROP = new Float64Array(256);

    // Points already drawn on one shell, in mm on paper, for keeping new lines CLEAR of them
    function clearance() {
        const cells = new Map(), key = (i, j) => (i + 4096) * 8192 + j + 4096;
        const add = (x, y, id) => {
            const k = key(Math.floor(x), Math.floor(y));
            let c = cells.get(k);
            if (!c) cells.set(k, c = []);
            c.push(x, y, id);
        };
        return {
            line(pts, id) {
                for (let i = 0; i < pts.length; i++) {
                    add(pts[i][0], pts[i][1], id);
                    if (!i) continue;
                    const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3);
                    for (let k = 1; k < n; k++) add(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, id);
                }
            },
            near(x, y, id) {
                const i0 = Math.floor(x), j0 = Math.floor(y);
                for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
                    const c = cells.get(key(i, j));
                    if (!c) continue;
                    for (let k = 0; k < c.length; k += 3) {
                        if (c[k + 2] !== id && (c[k] - x) * (c[k] - x) + (c[k + 1] - y) * (c[k + 1] - y) < CLEAR * CLEAR) return true;
                    }
                }
                return false;
            },
        };
    }

    // ---- where the pores go

    function geodesic(f) {
        const t = (1 + Math.sqrt(5)) / 2;
        const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
        const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        const seen = new Set(), out = [];
        for (const [a, b, c] of F) for (let i = 0; i <= f; i++) for (let j = 0; j <= f - i; j++) {
            const k = f - i - j, q = unit([0, 1, 2].map(n => V[a][n] * i + V[b][n] * j + V[c][n] * k));
            const id = q.map(x => Math.round(x * 1e4)).join();
            if (!seen.has(id)) { seen.add(id); out.push(q); }
        }
        return out;
    }
    const spiral = n => Array.from({ length: n }, (_, i) => {
        const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z), a = i * 2.399963229728653;
        return [r * Math.cos(a), r * Math.sin(a), z];
    });

    // Sites spread over a whole spheroid, about `pitch` mm apart. Nothing if there'd only be a handful.
    function scatter(sh, pitch, pattern, rng, mesh) {
        const [a, c] = sh.ell, area = 4 * Math.PI * Math.pow((Math.pow(a * a, 1.6) + 2 * Math.pow(a * c, 1.6)) / 3, 1 / 1.6);
        const n = Math.min(MAX_SITES, Math.round(area / (0.866 * pitch * pitch)));
        if (n < 12) return;
        let dirs = pattern === 'geodesic' ? geodesic(Math.max(1, Math.round(Math.sqrt((n - 2) / 10)))) : spiral(n);
        if (pattern === 'loose') {
            // round pores can only be as big as the tightest gap allows, so they get less of a shake
            const j = (mesh ? 0.25 : 0.1) * Math.sqrt(4 * Math.PI / n);
            dirs = dirs.map(d => unit([d[0] + rng.range(-j, j), d[1] + rng.range(-j, j), d[2] + rng.range(-j, j)]));
        }
        for (const d of dirs) sh.sites.push({ c: [a * d[0], a * d[1], c * d[2]], n: unit([d[0] / a, d[1] / a, d[2] / c]) });
    }

    // Sites in rings round the axis, between s0 and s1 along the profile. `grow` makes them bigger towards s1.
    function rows(sh, s0, s1, pitch, grow, spin) {
        let last = 0, j = 0;
        for (let s = s0; s <= s1; j++) {
            const f = along(sh, s), r = radius(sh, f), q = pitch * (1 + grow * (s - s0) / Math.max(1e-6, s1 - s0));
            let n = Math.round(TAU * r / q);
            // the same number as the ring before where it nearly fits, so the pores line up in columns
            if (last && Math.abs(n - last) <= last * 0.16) n = last;
            if (n >= 5) {
                for (let k = 0; k < n; k++) {
                    const phi = spin + (k + (j % 2) / 2) * TAU / n;
                    sh.sites.push({ c: point(sh, f, phi), n: normal(sh, f, phi) });
                }
                last = n;
            } else if (r < q * 0.3) sh.sites.push({ c: point(sh, f, 0), n: normal(sh, f, 0) });
            s += q * 0.87;
        }
    }

    // Give every site that could face the eye its pore: the biggest outline that leaves
    // `bar` mm of wall to each neighbor. A mesh pore is its cell with the far corners rounded off.
    function pores(sh, w, bar, mesh) {
        const S = sh.sites;
        for (const q of S) {
            q.face = dot(q.n, w);
            if (q.solid || q.face < FACING) continue;
            const [x, y, z] = q.c, near = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
            for (const o of S) {
                let d = (o.c[0] - x) * (o.c[0] - x) + (o.c[1] - y) * (o.c[1] - y) + (o.c[2] - z) * (o.c[2] - z);
                if (o === q || d >= near[5]) continue;
                for (let k = 0; k < 6; k++) if (d < near[k]) { const t = near[k]; near[k] = d; d = t; }
            }
            // a single pore on its own shell has nothing to size it by
            if (near[0] === Infinity) continue;
            // Its neighbors are whatever lies within reach of the sixth nearest site, not of the nearest.
            // Two sites that happen to sit close together would miss the ones that really bound their cells.
            const reach = 1.6 * Math.sqrt(near.filter(d => d < Infinity).pop());
            const e1 = unit(cross(Math.abs(q.n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], q.n)), e2 = cross(q.n, e1), cuts = [];
            let rin = reach;
            for (const o of S) {
                const dx = o.c[0] - x, dy = o.c[1] - y, dz = o.c[2] - z;
                if (o === q || dx * dx + dy * dy + dz * dz > reach * reach) continue;
                const u = dx * e1[0] + dy * e1[1] + dz * e1[2], v = dx * e2[0] + dy * e2[1] + dz * e2[2], l = Math.sqrt(u * u + v * v);
                if (l < 1e-9) continue;
                cuts.push([u / l, v / l, l / 2 - bar / 2]);
                rin = Math.min(rin, l / 2 - bar / 2);
            }
            if (rin < 0.6) continue;
            const ring = (r, n) => geo.ngon(0, 0, r, n);
            const cut = poly => { for (const [cx, cy, b] of cuts) poly = geo.clipPolygonHalfPlane(poly, [cx * b, cy * b], [-cx, -cy]); return poly; };
            let rho = rin, poly;
            if (mesh) {
                let far = 0;
                for (const [u, v] of cut(ring(reach, 24))) far = Math.max(far, Math.hypot(u, v));
                // A cell that's open on one side, at the end of a row, is kept nearly round. The rest fill
                // their cells whatever shape those are, or an uneven lattice is all small pores and bare patches.
                rho = far > 0.95 * reach ? 1.35 * rin : rin + 0.8 * (far - rin);
                poly = cut(ring(rho, 36));
                if (poly.length < 3) continue;
            } else poly = ring(rho, geo.clamp(Math.ceil(TAU * rho / 0.35), 14, 48));
            // onto the wall, following the pore's axis
            let out = [];
            poly.push(poly[0]);
            for (let i = 0; i < poly.length && out; i++) {
                const a = poly[i ? i - 1 : 0], b = poly[i], n = i ? Math.ceil(geo.dist(a, b) / 0.4) : 1;
                for (let k = 1; k <= n && out; k++) {
                    const u = a[0] + (b[0] - a[0]) * k / n, v = a[1] + (b[1] - a[1]) * k / n;
                    const o = [q.c[0] + u * e1[0] + v * e2[0], q.c[1] + u * e1[1] + v * e2[1], q.c[2] + u * e1[2] + v * e2[2]];
                    const m = hits(sh, o[0], o[1], o[2], q.n[0], q.n[1], q.n[2], DROP);
                    let l = Infinity;
                    for (let h = 0; h < m; h += 2) if (Math.abs(DROP[h]) < Math.abs(l)) l = DROP[h];
                    // off the end of an open shell
                    if (Math.abs(l) > rho) out = null; else out.push(mad(o, q.n, l));
                }
            }
            if (!out) continue;
            Object.assign(q, { e1, e2, rho, cuts: mesh ? cuts : null, out });
        }
    }

    // ---- one specimen

    function specimen(R, cx, cy) {
        const sp = { R, w: R[2], cx, cy, sheets: [], lines: [], cards: [], fringe: clearance(), stout: clearance(), ids: 0 };
        // local points, with the points to test them at when they lie on a shell
        sp.line = (pts, part, o = {}) => {
            const L = { pts: pts.map(q => view(R, q)), tst: o.tst ? o.tst.map(q => view(R, q)) : null, part, through: o.through || 0, rim: o.rim || null, card: o.card || null };
            sp.lines.push(L);
            return L;
        };
        // Lines an outer shell's pores have to keep CLEAR of. Only the parts that show: a fold hidden
        // round the back would leave a bare stripe across the front.
        sp.edge = (sh, L) => { for (const run of sh.depth ? [L.pts] : shown(sp, L)) sh.clear.line(run, -1); };
        return sp;
    }

    // The outline of a shell: where its surface turns edge-on to the eye
    function contour(sp, sh) {
        const nx = 121, ny = sh.n, values = new Float64Array(nx * ny), w = sp.w;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const phi = TAU * i / (nx - 1);
            values[j * nx + i] = sh.nr[j] * (w[0] * Math.cos(phi) + w[1] * Math.sin(phi)) + sh.nz[j] * w[2];
        }
        for (const iso of PG.isolines({ values, nx, ny, x0: 0, y0: 0, dx: 1, dy: 1 }, 0)) {
            const pts = [], tst = [];
            for (const [x, y] of iso) {
                const phi = TAU * x / (nx - 1), q = point(sh, y, phi);
                pts.push(q); tst.push(mad(q, normal(sh, y, phi), LIFT));
            }
            sp.edge(sh, sp.line(pts, sh.part, { tst, through: sh.depth }));
        }
    }
    // A circle round the axis. A crease only shows where the wall faces the eye. The lip of an
    // open end goes all the way round, and its far side is seen from inside the shell.
    function hoop(sp, sh, f, lip) {
        const n = Math.max(24, Math.ceil(TAU * radius(sh, f) / 0.4));
        let pts = [], tst = [];
        const flush = () => {
            if (pts.length > 1) sp.edge(sh, sp.line(pts, sh.part, { tst }));
            pts = []; tst = [];
        };
        for (let i = 0; i <= n; i++) {
            const phi = TAU * i / n, q = point(sh, f, phi), nn = normal(sh, f, phi), face = dot(nn, sp.w);
            if (!lip && face < 0) { flush(); continue; }
            pts.push(q); tst.push(mad(q, nn, face < 0 ? -LIFT : LIFT));
        }
        flush();
    }

    // A spine from `base` along `dir`, tapering to a point. Thin ones are a single line.
    // Wider ones get two sides, and hide what's behind them like a flat card seen face on.
    // Returns false for one that points straight at you and comes to nothing on paper.
    function spine(sp, sh, base, dir, len, wb, o = {}) {
        const part = o.part === undefined ? SPINE : o.part, m = o.bend ? 10 : 2, A = [];
        for (let k = 0; k <= m; k++) {
            const t = k / m, q = mad(base, dir, LIFT + len * t);
            A.push(view(sp.R, o.bend ? mad(q, o.bend, len * t * t) : q));
        }
        const id = sp.ids++, keep = pts => { sp.fringe.line(pts, id); if (o.front) sh.clear.line(pts, -1); };
        const flat = Math.hypot(A[m][0] - A[0][0], A[m][1] - A[0][1]);
        if (wb < THIN) {
            // Not one that never gets past the edge of its shell, which is just a dash lying on the lattice.
            // And not one that lies along another spine on paper. Thin ones start close together, so
            // between those the first bit doesn't count.
            if (flat < (part === BRISTLE ? 1.8 : 2.5) || (o.front && covers(sp, sh, A[m][0], A[m][1]))) return false;
            for (let k = 0; k <= 24; k++) {
                const t = k / 24, i = Math.min(m - 1, Math.floor(t * m)), u = t * m - i, x = A[i][0] + (A[i + 1][0] - A[i][0]) * u, y = A[i][1] + (A[i + 1][1] - A[i][1]) * u;
                if (sp.stout.near(x, y, id) || (Math.hypot(x - A[0][0], y - A[0][1]) > 2 * CLEAR && sp.fringe.near(x, y, id))) return false;
            }
            sp.lines.push({ pts: A, tst: null, part, through: 0, least: STUB });
            keep(A);
            return true;
        }
        // end on, all there'd be to draw is the ring round its foot
        if (flat <= 2.5 * wb) return false;
        const towards = dot(dir, sp.w), card = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, quads: [] };
        const L = [], Rt = [], wide = t => wb * (1 - t), stop = 1 - 0.3 / wb;
        for (let k = 0; k <= m; k++) {
            const a = A[Math.max(0, k - 1)], b = A[Math.min(m, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const px = -(b[1] - a[1]) / l * wide(k / m) / 2, py = (b[0] - a[0]) / l * wide(k / m) / 2;
            L.push([A[k][0] + px, A[k][1] + py, A[k][2]]); Rt.push([A[k][0] - px, A[k][1] - py, A[k][2]]);
        }
        for (let k = 0; k < m; k++) {
            const quad = [L[k], L[k + 1], Rt[k + 1], Rt[k], A[k], A[k + 1]];
            card.quads.push(quad);
            for (const q of quad) { card.x0 = Math.min(card.x0, q[0]); card.x1 = Math.max(card.x1, q[0]); card.y0 = Math.min(card.y0, q[1]); card.y1 = Math.max(card.y1, q[1]); }
        }
        // One side runs to the tip. The other stops where the pen would already be going over the first.
        const part2 = (P, to) => {
            const out = [];
            for (let k = 0; k <= m && k / m < to; k++) out.push(P[k]);
            const k = Math.min(m - 1, Math.floor(to * m)), t = to * m - k;
            out.push([0, 1, 2].map(i => P[k][i] + (P[k + 1][i] - P[k][i]) * t));
            return out;
        };
        sp.lines.push({ pts: L, tst: null, part, through: 0, card, least: STUB });
        sp.lines.push({ pts: part2(Rt, stop), tst: null, part, through: 0, card, least: STUB });
        // the ridge of a three-bladed spine, as far as it stays clear of the sides
        if (o.blade && wb >= 2 * CLEAR + 0.9) sp.lines.push({ pts: part2(A, 1 - 2.2 * CLEAR / wb), tst: null, part, through: 0, card, least: STUB });
        sp.cards.push(card);
        keep(L); keep(Rt);
        sp.stout.line(L, id); sp.stout.line(Rt, id);
        // the foot of the spine, on the side towards you
        if (!o.bare && towards > 0.15 && wb * towards >= SMALL) {
            const f1 = unit(cross(dir, Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), f2 = cross(dir, f1), pts = [];
            for (let i = 0; i <= 24; i++) pts.push(mad(mad(base, f1, wb / 2 * Math.cos(TAU * i / 24)), f2, wb / 2 * Math.sin(TAU * i / 24)));
            sp.line(pts, part, { tst: pts.map(q => mad(q, dir, LIFT)) });
            keep(pts.map(q => view(sp.R, q)));
        }
        return true;
    }

    // Bristles standing all round the outline of a spheroid, where they don't cross the lattice
    function fringe(sp, sh, gap, len, rng) {
        const [a, c] = sh.ell, count = len < 2.6 ? 0 : Math.floor(TAU * Math.min(a, c) / gap);
        for (let k = 0; k < count; k++) {
            const t = (k + rng.range(-0.2, 0.2)) * TAU / count, n = mad(sp.R[0].map(x => x * Math.cos(t)), sp.R[1], Math.sin(t));
            const l = Math.hypot(a * n[0], a * n[1], c * n[2]);
            spine(sp, sh, [a * a * n[0] / l, a * a * n[1] / l, c * c * n[2] / l], n, len * rng.range(0.75, 1.2), 0, { part: BRISTLE });
        }
    }

    // Choose which pores of a shell get drawn and add their outlines
    function pierce(sp, sh, wall) {
        const R = sp.R, w = sp.w;
        const order = sh.sites.filter(q => q.out).sort((a, b) => b.face - a.face);
        order.forEach((q, id) => {
            const P = q.out.map(o => view(R, o));
            // how wide it is on paper, across the way it's tilted and along it
            const tx = dot(q.n, R[0]), ty = dot(q.n, R[1]), tl = Math.hypot(tx, ty), sx = tl > 1e-6 ? tx / tl : 1, sy = tl > 1e-6 ? ty / tl : 0;
            let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
            for (const o of P) {
                const a = o[0] * sx + o[1] * sy, b = o[1] * sx - o[0] * sy;
                a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
            }
            if (Math.min(a1 - a0, b1 - b0) < SMALL) return;
            for (const o of P) if (sh.clear.near(o[0], o[1], id)) return;
            // no half pores on an outer shell, cut off by a spine or a fold of the wall
            const tst = q.out.map(o => mad(o, q.n, LIFT));
            if (!sh.depth) for (const o of tst) { const v = view(R, o); if (!seen(sp, v[0], v[1], v[2], WHOLE)) return; }
            sh.clear.line(P, id);
            q.open = true; q.thick = 0;
            // on an outer shell it's just been checked all the way round
            sp.line(q.out, sh.part, { tst, through: sh.depth }).whole = !sh.depth;
            // The far end of the hole sits `shift` along the tilt from the near one. Under CLEAR the two
            // rims would be one line, so the pore is drawn as a plain hole. When the far rim would
            // leave no opening to speak of, you can't see through at all.
            const shift = wall * tl, gape = a1 - a0 - shift;
            if (gape < CLEAR) { q.open = false; return; }
            if (shift < CLEAR + 0.1 || gape < Math.max(CLEAR + 0.1, 0.55 * (a1 - a0))) return;
            q.thick = wall;
            q.su = -dot(w, q.e1) * wall / q.face; q.sv = -dot(w, q.e2) * wall / q.face;
            sp.line(q.out.map(o => mad(o, q.n, -wall)), WALL, { rim: q, through: sh.depth });
        });
        // buckets for finding the pore at a point of the wall
        const live = order.filter(q => q.open);
        if (!live.length) return;
        let cell = 0, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const q of live) {
            cell = Math.max(cell, 2.05 * q.rho);
            for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q.c[i]); hi[i] = Math.max(hi[i], q.c[i]); }
        }
        const dim = lo.map((v, i) => Math.floor((hi[i] - v) / cell) + 1), g = { cell, lo, dim, head: new Int32Array(dim[0] * dim[1] * dim[2]).fill(-1), next: new Int32Array(live.length), items: live };
        live.forEach((q, k) => {
            const c = q.c.map((v, i) => Math.floor((v - lo[i]) / cell)), at = (c[2] * dim[1] + c[1]) * dim[0] + c[0];
            g.next[k] = g.head[at]; g.head[at] = k;
        });
        sh.grid = g;
    }
    // The pore whose hole this point of the wall falls in. Leaves the point's place in the pore in PU, PV.
    let PU = 0, PV = 0;
    const inside = (q, u, v, inset = 0) => {
        if (inset >= q.rho || u * u + v * v >= (q.rho - inset) * (q.rho - inset)) return false;
        if (q.cuts) for (const c of q.cuts) if (u * c[0] + v * c[1] > c[2] - inset) return false;
        return true;
    };
    function poreAt(sh, x, y, z, halo) {
        const g = sh.grid;
        if (!g) return null;
        const i0 = Math.floor((x - g.lo[0]) / g.cell - 0.5), j0 = Math.floor((y - g.lo[1]) / g.cell - 0.5), k0 = Math.floor((z - g.lo[2]) / g.cell - 0.5);
        for (let k = k0; k <= k0 + 1; k++) {
            if (k < 0 || k >= g.dim[2]) continue;
            for (let j = j0; j <= j0 + 1; j++) {
                if (j < 0 || j >= g.dim[1]) continue;
                for (let i = i0; i <= i0 + 1; i++) {
                    if (i < 0 || i >= g.dim[0]) continue;
                    for (let n = g.head[(k * g.dim[1] + j) * g.dim[0] + i]; n >= 0; n = g.next[n]) {
                        const q = g.items[n], dx = x - q.c[0], dy = y - q.c[1], dz = z - q.c[2], h = dx * q.n[0] + dy * q.n[1] + dz * q.n[2];
                        if (h > q.rho || h < -q.rho) continue;
                        PU = dx * q.e1[0] + dy * q.e1[1] + dz * q.e1[2]; PV = dx * q.e2[0] + dy * q.e2[1] + dz * q.e2[2];
                        if (inside(q, PU, PV, halo)) return q;
                    }
                }
            }
        }
        return null;
    }

    // Can the eye see the point (x, y, d) of line L?
    function seen(sp, x, y, d, L) {
        for (const c of sp.cards) {
            if (c === L.card || x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) continue;
            for (const [p0, p1, p2, p3, a, b] of c.quads) {
                const s0 = (p1[0] - p0[0]) * (y - p0[1]) - (p1[1] - p0[1]) * (x - p0[0]), s1 = (p2[0] - p1[0]) * (y - p1[1]) - (p2[1] - p1[1]) * (x - p1[0]);
                const s2 = (p3[0] - p2[0]) * (y - p2[1]) - (p3[1] - p2[1]) * (x - p2[0]), s3 = (p0[0] - p3[0]) * (y - p3[1]) - (p0[1] - p3[1]) * (x - p3[0]);
                if (!((s0 > 0 && s1 > 0 && s2 > 0 && s3 > 0) || (s0 < 0 && s1 < 0 && s2 < 0 && s3 < 0))) continue;
                const ex = b[0] - a[0], ey = b[1] - a[1], t = geo.clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
                if (a[2] + (b[2] - a[2]) * t > d + 0.02) return false;
            }
        }
        const R = sp.R, w = R[2], ox = x * R[0][0] + y * R[1][0], oy = x * R[0][1] + y * R[1][1], oz = x * R[0][2] + y * R[1][2];
        let through = 0;
        for (const sh of sp.sheets) {
            if (x * x + y * y > sh.reach * sh.reach) continue;
            const m = hits(sh, ox, oy, oz, w[0], w[1], w[2], HIT);
            for (let i = 0; i < m; i += 2) {
                const l = HIT[i];
                if (l <= d + 1e-4) continue;
                // the inside of a far wall
                if (HIT[i + 1] <= 0) return false;
                // the far rim of a pore is looked at down its own hole
                const q = poreAt(sh, ox + l * w[0], oy + l * w[1], oz + l * w[2], L.rim ? 0 : HALO);
                if (!q) return false;
                if (q === L.rim) continue;
                if ((q.thick && !inside(q, PU + q.su, PV + q.sv, HALO)) || ++through > L.through) return false;
            }
        }
        return true;
    }

    const WHOLE = { through: 0 };
    // The parts of a line that show, in view coordinates. Bits too short to be worth a pen lift are left out.
    function shown(sp, L) {
        const P = L.pts, T = L.tst || P, runs = [];
        if (L.whole) return [P];
        let on = seen(sp, T[0][0], T[0][1], T[0][2], L), run = on ? [P[0]] : null, cut = false;
        const done = clipped => {
            if (run.length > 1 && !((cut || clipped) && geo.pathLength(run) < (L.least || SPECK))) runs.push(run);
            run = null;
        };
        for (let i = 1; i < P.length; i++) {
            const a = P[i - 1], b = P[i], ta = T[i - 1], tb = T[i];
            const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / STEP));
            const at = t => seen(sp, ta[0] + (tb[0] - ta[0]) * t, ta[1] + (tb[1] - ta[1]) * t, ta[2] + (tb[2] - ta[2]) * t, L);
            for (let k = 1; k <= n; k++) {
                const v = k === n ? seen(sp, tb[0], tb[1], tb[2], L) : at(k / n);
                if (v === on) continue;
                // home in on where it goes out of sight
                let lo = (k - 1) / n, hi = k / n;
                for (let it = 0; it < 9; it++) { const mid = (lo + hi) / 2; if (at(mid) === on) lo = mid; else hi = mid; }
                const t = (lo + hi) / 2, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                if (on) { run.push(q); done(true); } else { run = [q]; cut = true; }
                on = v;
            }
            if (on) run.push(b);
        }
        if (on) done(false);
        return runs;
    }
    // Is a shell in the way at (x, y) on paper, in front or behind?
    function covers(sp, sh, x, y) {
        const R = sp.R, w = R[2];
        return hits(sh, x * R[0][0] + y * R[1][0], x * R[0][1] + y * R[1][1], x * R[0][2] + y * R[1][2], w[0], w[1], w[2], HIT) > 0;
    }
    function trace(sp, out) {
        for (const L of sp.lines) for (const run of shown(sp, L)) out.of(L.part).push(run.map(q => [sp.cx + q[0], sp.cy - q[1]]));
    }

    // ---- the three kinds of skeleton. Each is described at unit size, then built once its size on paper is known.

    // What every kind needs to know about the plate
    const scaleOf = (p, K, f) => {
        // pores are sized in mm, until a shell would need more than MAX_SITES of them
        const want = Math.max(2.4, p.pore) * f, pitch = Math.max(want, K * Math.sqrt(4 * Math.PI / (0.866 * MAX_SITES))), k = pitch / want;
        const bar = Math.min(p.bar, Math.max(0.6, p.pore - 1.6)) * k;
        return { pitch, bar, wall: Math.min(p.wall * k, 0.45 * (pitch - bar)) };
    };
    const useMesh = (p, rng) => p.shape === 'mesh' || (p.shape === 'mixed' && rng.chance(0.5));

    function sphere(rng, p, must, hairy) {
        const q = rng.chance(0.3) ? rng.pick([rng.range(0.78, 0.9), rng.range(1.12, 1.35)]) : 1; // squashed or stretched along its axis
        const a = q > 1 ? 1 / q : 1, c = a * q;
        const inner = Math.min(Math.round(p.inner), must ? rng.int(1, 2) : rng.weighted([[2, 0], [5, 1], [2, 2]]));
        const sizes = [1, rng.range(0.5, 0.6)];
        sizes.push(sizes[1] * rng.range(0.45, 0.55));
        const kind = p.spines <= 0 ? 'none' : rng.weighted([[must ? 0 : 1.5, 'none'], [2, 'poles'], [2, 'cross'], [2, 'axes'], [3, 'radial']]);
        const dirs = kind === 'poles' ? [[0, 0, 1], [0, 0, -1]] : kind === 'cross' ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]
            : kind === 'axes' ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] : kind === 'radial' ? spiral(rng.pick([8, 12, 20])) : [];
        const len = p.spines * rng.range(0.6, 1.1) * (kind === 'poles' ? 1.2 : kind === 'radial' ? 0.6 : 1);
        // an odd spine or two can be longer, like the main spines of the real thing
        const lens = dirs.map((_, i) => len * (kind === 'radial' && i % 4 === 0 ? 1.5 : 1));
        const bristle = p.bristles && (hairy || (kind !== 'radial' && rng.chance(0.4))) ? rng.range(0.12, 0.22) : 0;
        const pattern = rng.weighted([[3, 'geodesic'], [2, 'spiral'], [2, 'loose']]), mesh = useMesh(p, rng), fine = rng.range(0.85, 1.3), stout = rng.range(0.8, 1.3), blade = rng.chance(0.5);
        // the axis lies near the page for polar spines, anywhere otherwise
        const R = pose(rng.range(0, TAU), kind === 'poles' || q !== 1 ? -Math.PI / 2 + rng.range(-0.4, 0.4) : rng.range(-Math.PI, Math.PI), kind === 'poles' || q !== 1 ? rng.range(-0.6, 0.6) : rng.range(0, TAU));
        const seed = rng.int(1, 1e9);
        return {
            R,
            extent() {
                const pts = spiral(60).map(d => [a * d[0], a * d[1], c * d[2]].map(x => x * (1 + 1.2 * bristle)));
                dirs.forEach((d, i) => pts.push([a * d[0] * (1 + lens[i]), a * d[1] * (1 + lens[i]), c * d[2] * (1 + lens[i])]));
                return pts;
            },
            build(sp, K) {
                const r = new PG.RNG(seed), { pitch, bar, wall } = scaleOf(p, K, fine);
                const bases = [];
                for (let d = 0; d <= inner; d++) {
                    const sh = spheroid(a * K * sizes[d], c * K * sizes[d], d ? INNER : SHELL, d);
                    sp.sheets.push(sh);
                    scatter(sh, d ? Math.max(2.6, pitch * 0.8) : pitch, pattern, r, mesh && !d);
                    if (d) continue;
                    // spines stand on a lattice node, which stays solid
                    dirs.forEach((dir, i) => {
                        let best = null;
                        for (const s of sh.sites) if (!s.solid && (!best || dot(s.c, dir) / Math.hypot(...s.c) > dot(best.c, dir) / Math.hypot(...best.c))) best = s;
                        const at = best ? best.c : [a * K * dir[0], a * K * dir[1], c * K * dir[2]];
                        bases.push(at);
                        const wb = Math.min(geo.clamp(0.085 * K * stout * (kind === 'radial' ? 0.6 : 1), 0.6, 3.4), pitch * 0.8);
                        if (spine(sp, sh, at, unit(at), lens[i] * K, wb, { blade, front: dot(best ? best.n : unit(at), sp.w) > 0 }) && best) best.solid = true;
                    });
                    if (bristle) fringe(sp, sh, Math.max(2.4, 0.7 * pitch), bristle * K, r);
                }
                // beams hold each shell inside the next, in line with the spines
                const struts = bases.length ? bases.map(unit) : spiral(8);
                for (let d = 0; d < inner; d++) for (const u of struts) {
                    const on = [a * u[0], a * u[1], c * u[2]], from = on.map(x => x * K * sizes[d + 1]), to = on.map(x => x * K * sizes[d]);
                    // Only the part that's clear of the inner shell on paper. Across its face a beam would cut through the lattice.
                    const A = view(sp.R, from), B = view(sp.R, to), flat = Math.hypot(B[0] - A[0], B[1] - A[1]);
                    let t = 0;
                    while (t < 1 && covers(sp, sp.sheets[d + 1], A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)) t += 0.02;
                    t += CLEAR / Math.max(flat, 1e-6);
                    if (t < 1 && (1 - t) * flat > 1.5) sp.line([mad(from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]], t), mad(to, u, -2 * LIFT)], BRISTLE, { through: d + 1 });
                }
                sp.sheets.forEach((sh, d) => {
                    contour(sp, sh);
                    // round pores inside, whose arcs are easier to make out in bits through a lattice
                    pores(sh, sp.w, d ? Math.max(0.7, bar * 0.8) : bar, mesh && !d);
                    pierce(sp, sh, d ? 0 : wall);
                });
            },
        };
    }

    // A smooth curve through points, sampled `per` times a span
    function spline(P, per) {
        const out = [], at = i => i < 0 ? [-P[1][0], P[1][1]] : i >= P.length ? mad2(P[P.length - 1], P[P.length - 2]) : P[i];
        for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < per; k++) {
            const t = k / per, a = at(i - 1), b = P[i], c = P[i + 1], d = at(i + 2);
            out.push([0, 1].map(n => 0.5 * (2 * b[n] + (c[n] - a[n]) * t + (2 * a[n] - 5 * b[n] + 4 * c[n] - d[n]) * t * t + (3 * b[n] - 3 * c[n] + d[n] - a[n]) * t * t * t)));
        }
        out.push(P[P.length - 1]);
        return out;
    }
    const mad2 = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];

    function bell(rng, p) {
        // The profile from the tip down: a small round head, a collar, then one or two wider chambers
        const rc = rng.range(0.22, 0.36), ctl = [[0, 0]], joints = [];
        for (const deg of [40, 80, 115]) ctl.push([rc * Math.sin(geo.rad(deg)), rc * (1 - Math.cos(geo.rad(deg)))]);
        let h = rc * rng.range(1.8, 2.1), r = rc * rng.range(0.72, 0.95), top = r;
        ctl.push([r, h]); joints.push(ctl.length - 1);
        const chambers = rng.weighted([[3, 1], [2, 2]]);
        for (let k = 0; k < chambers; k++) {
            const wide = k ? top * rng.range(0.95, 1.3) : rng.range(0.65, 1), tall = rng.range(0.75, 1.3) * (k ? 0.8 : 1), early = rng.range(0.5, 0.85);
            ctl.push([geo.lerp(r, wide, early), h + tall * 0.4], [wide, h + tall * 0.82]);
            h += tall; top = wide;
            if (k < chambers - 1) { r = wide * rng.range(0.82, 0.93); ctl.push([r, h]); joints.push(ctl.length - 1); }
        }
        ctl.push([top * rng.weighted([[2, 0.74], [3, 0.98], [2, 1.12]]), h + (chambers > 1 ? 0 : 0.05)]);
        // The curve through those, then in even steps. The shell is tested segment by segment, so not too many.
        const PER = 14, STEPS = 60, dense = spline(ctl, PER).map(([x, y]) => [Math.max(0, x), y]), run = [0], fine = [], creases = [];
        dense[0][0] = 0;
        for (let i = 1; i < dense.length; i++) run.push(run[i - 1] + geo.dist(dense[i - 1], dense[i]));
        for (let i = 0, k = 0; i <= STEPS; i++) {
            const at = run[run.length - 1] * i / STEPS;
            while (k < dense.length - 2 && run[k + 1] < at) k++;
            fine.push(geo.lerpPt(dense[k], dense[k + 1], (at - run[k]) / (run[k + 1] - run[k] || 1)));
        }
        for (const j of joints) creases.push(STEPS * run[j * PER] / run[run.length - 1]);
        const horn = p.spines > 0 && rng.chance(0.8) ? p.spines * rng.range(0.5, 1.1) : 0;
        const feet = p.spines > 0 ? rng.weighted([[2, 0], [4, 3], [1, 4], [1, 6], [2, rng.int(10, 16)]]) : 0;
        const teeth = feet > 6, footLen = p.spines * (teeth ? rng.range(0.15, 0.3) : rng.range(0.5, 1)), flare = rng.range(-0.15, 0.6), bend = teeth ? 0 : rng.range(-0.35, 0.35);
        const mesh = useMesh(p, rng), fineness = rng.range(0.85, 1.25), grow = rng.range(0.2, 0.9), blade = rng.chance(0.5), spin = rng.range(0, TAU);
        // tipped towards you more than away, where you'd mostly be looking up an empty mouth
        const R = pose(spin, -Math.PI / 2 + rng.range(-0.3, 0.5), rng.range(-0.2, 0.2));
        const prof = K => fine.map(([x, y]) => [x * K, (h / 2 - y) * K]);
        const foot = k => { const a = k * TAU / feet, o = [Math.cos(a), Math.sin(a), 0]; return { o, dir: unit(mad([0, 0, -1], o, Math.tan(flare))) }; };
        return {
            R,
            extent() {
                const pts = [[0, 0, h / 2 + horn]], end = fine[fine.length - 1];
                for (const [x, y] of fine) for (let i = 0; i < 12; i++) pts.push([x * Math.cos(TAU * i / 12), x * Math.sin(TAU * i / 12), h / 2 - y]);
                for (let k = 0; k < feet; k++) { const f = foot(k); pts.push(mad(mad([end[0] * f.o[0], end[0] * f.o[1], h / 2 - end[1]], f.dir, footLen), f.o, bend * footLen)); }
                return pts;
            },
            build(sp, K) {
                const sh = shell(prof(K), BELL, 0), { pitch, bar, wall } = scaleOf(p, K, fineness), end = sh.n - 1;
                sp.sheets.push(sh);
                const hw = horn ? geo.clamp(0.3 * rc * K, 0.6, 3) : 0;
                if (horn) spine(sp, sh, [0, 0, sh.z[0]], [0, 0, 1], horn * K, hw, { blade, front: sp.w[2] > 0 });
                for (let k = 0; k < feet; k++) {
                    const f = foot(k), base = point(sh, end, k * TAU / feet);
                    const wb = teeth ? 0 : Math.min(geo.clamp(0.07 * K, 0.6, 3), 0.5 * TAU * sh.r[end] / feet);
                    spine(sp, sh, base, f.dir, footLen * K, wb, { blade: false, bare: true, bend: bend ? [f.o[0] * bend, f.o[1] * bend, 0] : null, front: dot(normal(sh, end, k * TAU / feet), sp.w) > 0 });
                }
                contour(sp, sh);
                for (const f of creases) hoop(sp, sh, f, false);
                hoop(sp, sh, end, true);
                rows(sh, Math.max(0.75 * pitch, hw / 2 + 0.6 * pitch), sh.L - 0.6 * pitch, pitch * 0.75, grow, 0);
                pores(sh, sp.w, bar, mesh);
                pierce(sp, sh, wall);
            },
        };
    }

    function disc(rng, p, hairy) {
        const thick = rng.range(0.24, 0.4), core = p.inner > 0 && rng.chance(0.6) ? thick * rng.range(0.55, 0.75) : 0;
        const kind = p.spines > 0 ? rng.weighted([[1, 'none'], [3, 'spines'], [p.bristles ? 3 : 0, 'fringe']]) : 'none';
        const n = kind === 'spines' ? rng.pick([4, 6, 8, 12, 16]) : 0, len = p.spines * rng.range(0.3, 0.6);
        const bristle = p.bristles && (hairy || kind === 'fringe') ? rng.range(0.1, 0.18) : 0, out = Math.max(n ? len : 0, 1.2 * bristle);
        const mesh = useMesh(p, rng), fine = rng.range(0.85, 1.25), grow = rng.range(0, 0.6), blade = rng.chance(0.4);
        // seen from above, tipped back by up to 55°
        const R = pose(rng.range(0, TAU), rng.range(0, 0.95), rng.range(0, TAU));
        const seed = rng.int(1, 1e9);
        return {
            R,
            extent() {
                const pts = [];
                for (let i = 0; i < 24; i++) pts.push([(1 + out) * Math.cos(TAU * i / 24), (1 + out) * Math.sin(TAU * i / 24), 0], [0.7 * Math.cos(TAU * i / 24), 0.7 * Math.sin(TAU * i / 24), 0.72 * thick]);
                return pts;
            },
            build(sp, K) {
                const r = new PG.RNG(seed), { pitch, bar, wall } = scaleOf(p, K, fine), sh = spheroid(K, thick * K, DISC, 0);
                sp.sheets.push(sh);
                for (let k = 0; k < n; k++) {
                    const a = k * TAU / n, o = [Math.cos(a), Math.sin(a), 0];
                    spine(sp, sh, mad([0, 0, 0], o, K), o, len * K, Math.min(geo.clamp(0.07 * K, 0.6, 3), 0.5 * TAU * K / n), { blade, bare: true, front: dot(o, sp.w) > 0 });
                }
                if (bristle) fringe(sp, sh, Math.max(2.4, 0.7 * pitch), bristle * K, r);
                contour(sp, sh);
                // rings of pores on the face towards you, stopping short of the rim
                rows(sh, 0, sh.L / 2 - 0.9 * pitch, pitch * 0.85, grow, 0);
                pores(sh, sp.w, bar, mesh);
                pierce(sp, sh, wall);
                if (!core) return;
                const mid = spheroid(core * K, core * K, INNER, 1);
                sp.sheets.push(mid);
                scatter(mid, Math.max(2.4, pitch * 0.7), 'spiral', r);
                contour(sp, mid);
                pores(mid, sp.w, Math.max(0.7, bar * 0.8), false);
                pierce(sp, mid, 0);
            },
        };
    }

    // ---- the plate

    // Circles for the specimens: a big one, and the rest spread round it. A mirrored plate
    // puts them on the center line or in pairs either side of it.
    function layout(ctx, rng, n, mirror) {
        const bb = geo.bbox([ctx.shape.polygon()]), mx = (bb.minX + bb.maxX) / 2, my = (bb.minY + bb.maxY) / 2;
        const gap = geo.clamp(Math.min(bb.w, bb.h) * 0.035, 2.5, 9), slots = [{ w: 1, mid: mirror || n === 1 }];
        let left = n - 1;
        if (mirror && left % 2) { slots.push({ w: rng.range(0.5, 0.7), mid: true }); left--; }
        for (; left > 0; left -= mirror ? 2 : 1) slots.push({ w: rng.range(0.45, 0.72), pair: mirror });
        slots.sort((a, b) => b.w - a.w);
        const seed = rng.int(1, 1e9), aim = my + bb.h * rng.pick([-0.12, 0, 0, 0.12]);
        const room = (x, y, r, all, skip) => {
            let d = ctx.shape.dist(x, y) - r - 0.5;
            for (const c of all) if (c.slot !== skip) d = Math.min(d, Math.hypot(c.x - x, c.y - y) - c.r - r - gap);
            return d;
        };
        const attempt = k => {
            const r0 = new PG.RNG(seed), all = [];
            for (const s of slots) {
                const r = s.w * k;
                let best = null, score = -Infinity;
                for (let t = 0; t < 90; t++) {
                    const x = s.mid ? mx : r0.range(bb.minX + r, (s.pair ? mx - gap / 2 : bb.maxX) - r), y = r0.range(bb.minY + r, bb.maxY - r);
                    if (!(x >= bb.minX + r) || !(y >= bb.minY + r)) continue;
                    let d = room(x, y, r, all);
                    if (s.pair) d = Math.min(d, room(2 * mx - x, y, r, all), mx - x - r - gap / 2);
                    if (d < 0) continue;
                    // the big one near the middle, the rest as far from everything as they can get
                    const sc = s === slots[0] ? -Math.abs(y - aim) - Math.abs(x - mx) : d;
                    if (sc > score) { score = sc; best = [x, y]; }
                }
                if (!best) return null;
                all.push({ x: best[0], y: best[1], r, slot: s });
                if (s.pair) all.push({ x: 2 * mx - best[0], y: best[1], r, slot: s, twin: true });
            }
            return all;
        };
        let lo = 0, hi = Math.min(bb.w, bb.h) / 2, all = null;
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2, got = attempt(mid);
            if (got) { all = got; lo = mid; } else hi = mid;
        }
        if (!all) return { circles: [], mx, gap };
        // Then let them settle: each slides to where it has the most room and grows into it
        const most = Math.min(bb.w, bb.h) * 0.46, own = all.filter(c => !c.twin);
        const free = (c, x, y) => {
            let d = room(x, y, c.r, all, c.slot);
            if (c.slot.pair) d = Math.min(d, room(2 * mx - x, y, c.r, all, c.slot), mx - x - c.r - gap / 2);
            return d;
        };
        for (let it = 0; it < 60; it++) for (const c of own) {
            const twin = all.find(o => o.twin && o.slot === c.slot), step = 0.3 + c.r * 0.1 * (1 - it / 60);
            let best = free(c, c.x, c.y), bx = c.x, by = c.y;
            for (let k = 0; k < 8; k++) {
                const x = c.slot.mid ? mx : c.x + step * Math.cos(k * TAU / 8), y = c.y + step * Math.sin(k * TAU / 8), d = free(c, x, y);
                if (d > best) { best = d; bx = x; by = y; }
            }
            c.x = bx; c.y = by;
            c.r += Math.max(0, Math.min(best * 0.5, c.slot.w * lo * 1.7 - c.r, most - c.r));
            if (twin) { twin.x = 2 * mx - bx; twin.y = by; twin.r = c.r; }
        }
        return { circles: all, mx, gap };
    }

    const DIGITS = [
        [[[1, 0], [3, 0], [4, 1.2], [4, 4.8], [3, 6], [1, 6], [0, 4.8], [0, 1.2], [1, 0]]],
        [[[0.8, 1.2], [2.2, 0], [2.2, 6]]],
        [[[0, 1.2], [1, 0], [3, 0], [4, 1.1], [4, 2.3], [0, 6], [4, 6]]],
        [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1.6, 3]], [[3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]]],
        [[[3, 6], [3, 0], [0, 4.2], [4, 4.2]]],
        [[[3.8, 0], [0.5, 0], [0.1, 2.7], [1.2, 2.3], [3, 2.3], [4, 3.3], [4, 5], [3, 6], [1, 6], [0, 5]]],
        [[[3.7, 0.7], [3, 0], [1, 0], [0, 1.2], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.7], [3, 2.7], [1, 2.7], [0, 3.7]]],
        [[[0, 0], [4, 0], [1.6, 6]]],
        [[[1, 0], [3, 0], [4, 0.9], [4, 2.1], [3, 3], [1, 3], [0, 2.1], [0, 0.9], [1, 0]], [[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3]]],
        [[[4, 2.3], [3, 3.3], [1, 3.3], [0, 2.3], [0, 1], [1, 0], [3, 0], [4, 1], [4, 4.8], [3, 6], [1, 6], [0.3, 5.3]]],
    ];
    const TALL = 3.2; // mm, the height of a figure number
    function number(n, x, y, into) {
        const s = String(n), u = TALL / 6, wide = s.length * 4 * u + (s.length - 1) * 2 * u;
        [...s].forEach((ch, i) => {
            for (const stroke of DIGITS[+ch]) into.push(geo.chaikin(stroke.map(([a, b]) => [x - wide / 2 + (i * 6 + a) * u, y - TALL / 2 + b * u]), 1));
        });
    }

    PG.register({
        id: 'radiolaria',
        name: 'Radiolaria Plate',
        category: 'Studies',
        description: 'A plate of invented radiolarian skeletons after Haeckel: nested lattice spheres, bells, pored discs and spines, with the inner shells showing through the pores.',
        fit: false,
        params: [
            { type: 'section', label: 'Plate' },
            { id: 'count', label: 'Specimens', type: 'range', min: 1, max: 12, step: 1, value: 7, random: [4, 9] },
            { id: 'mix', label: 'Kinds', type: 'select', value: 'mixed', random: ['mixed', 'mixed', 'mixed', 'mixed', 'spheres', 'bells', 'discs'],
                options: [['mixed', 'Mixed'], ['spheres', 'Lattice spheres'], ['bells', 'Bells & helmets'], ['discs', 'Pored discs']] },
            { id: 'mirror', label: 'Mirrored layout', type: 'checkbox', value: true, random: 0.7,
                hint: 'One big specimen on the center line and the rest in pairs either side, like the plates in Kunstformen der Natur' },
            { id: 'labels', label: 'Figure numbers', type: 'checkbox', value: true, random: 0.8 },
            { type: 'section', label: 'Skeleton' },
            { id: 'pore', label: 'Pore spacing (mm)', type: 'range', min: 2.4, max: 8, step: 0.1, value: 3.6, random: [3, 5],
                hint: 'Between pore centers on the outer shells. Each specimen varies it a little, and big shells get bigger pores' },
            { id: 'bar', label: 'Bar width (mm)', type: 'range', min: 0.6, max: 2.5, step: 0.05, value: 1, random: [0.8, 1.4],
                hint: 'Wall left between two pores' },
            { id: 'shape', label: 'Pores', type: 'select', value: 'mixed', random: ['mixed', 'mixed', 'round', 'mesh'],
                options: [['mixed', 'Mixed'], ['round', 'Round'], ['mesh', 'Many-sided mesh']] },
            { id: 'wall', label: 'Wall thickness (mm)', type: 'range', min: 0, max: 2.5, step: 0.05, value: 1, random: [0.5, 1.6],
                hint: 'Shows as a crescent inside pores that are turned away from you. 0 draws paper-thin shells' },
            { id: 'inner', label: 'Inner shells', type: 'range', min: 0, max: 2, step: 1, value: 2, random: [1, 2],
                hint: 'The most shells nested inside a sphere. They only show through the pores of the shell in front' },
            { id: 'spines', label: 'Spine length', type: 'range', min: 0, max: 1.5, step: 0.05, value: 0.6, random: [0.3, 1] },
            { id: 'bristles', label: 'Bristles', type: 'checkbox', value: true, random: 0.7 },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],

        generate(p, ctx) {
            const rng = ctx.rng, out = PG.pens.partLayers('radiolaria', p);
            const { circles, mx, gap } = layout(ctx, rng, geo.clamp(Math.round(p.count), 1, 12), p.mirror);
            const slots = [...new Set(circles.map(c => c.slot))];
            // a mixed plate has one of each kind when there's room, and pairs are two of a kind
            const only = { spheres: 'sphere', bells: 'bell', discs: 'disc' }[p.mix];
            const kinds = only ? [] : rng.shuffle(['sphere', 'bell', 'disc']).slice(0, slots.length);
            while (kinds.length < slots.length) kinds.push(only || rng.weighted([[5, 'sphere'], [3, 'bell'], [2, 'disc']]));
            // the big one is a sphere or a bell
            if (kinds[0] === 'disc' && kinds.length > 1) { kinds[0] = kinds[1]; kinds[1] = 'disc'; }
            const kindOf = c => kinds[slots.indexOf(c.slot)], made = {};
            // one of them is sure to be bristly
            const hairy = rng.pick(circles.filter(c => kindOf(c) !== 'bell'));
            const all = circles.map(c => {
                const kind = kindOf(c), must = !made[kind];
                made[kind] = true;
                const S = kind === 'sphere' ? sphere(rng, p, must, c === hairy) : kind === 'bell' ? bell(rng, p) : disc(rng, p, c === hairy);
                // Its outline on paper at unit size, about the middle of the circle it has to fit in
                const pts = S.extent().map(q => view(S.R, q)), bb = geo.bbox([pts]), bx = (bb.minX + bb.maxX) / 2, by = (bb.minY + bb.maxY) / 2;
                const hull = PG.iso.hull(pts.map(q => [q[0] - bx, by - q[1]]));
                let reach = 0;
                for (const q of hull) reach = Math.max(reach, Math.hypot(q[0], q[1]));
                return { S, c, bx, by, hull, reach, K: c.r / reach, top: 1.5 * c.r / reach };
            });
            // Few of them are round, so most can grow a bit more into the corners of their circles
            const outline = s => s.hull.map(h => [s.c.x + s.K * h[0], s.c.y + s.K * h[1]]);
            const toSeg = (q, a, b) => {
                const ex = b[0] - a[0], ey = b[1] - a[1], t = geo.clamp(((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / (ex * ex + ey * ey || 1), 0, 1);
                return Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ey * t);
            };
            const toPoly = (q, P) => { let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, toSeg(q, P[i], P[(i + 1) % P.length])); return d; };
            const apart = (A, B) => { let d = Infinity; for (const q of A) d = Math.min(d, toPoly(q, B)); for (const q of B) d = Math.min(d, toPoly(q, A)); return d; };
            for (let it = 0; it < 14; it++) for (const s of all) {
                const K = s.K;
                if (K >= s.top) continue;
                s.K = Math.min(K * 1.035, s.top);
                const P = outline(s);
                if (P.some(q => ctx.shape.dist(q[0], q[1]) < 0.5) || all.some(o => o !== s && Math.hypot(o.c.x - s.c.x, o.c.y - s.c.y) < o.K * o.reach + s.K * s.reach + gap && apart(P, outline(o)) < gap)) s.K = K;
            }
            for (const s of all) {
                const sp = specimen(s.S.R, s.c.x - s.K * s.bx, s.c.y + s.K * s.by);
                s.S.build(sp, s.K);
                trace(sp, out);
            }
            // numbered in rows across the page, like reading
            const order = [], byY = all.slice().sort((a, b) => a.c.y - b.c.y);
            for (let i = 0; i < byY.length;) {
                let j = i + 1;
                while (j < byY.length && byY[j].c.y - byY[i].c.y < byY[i].c.r * 0.7) j++;
                order.push(...byY.slice(i, j).sort((a, b) => a.c.x - b.c.x));
                i = j;
            }
            const outlines = all.map(outline);
            if (p.labels) order.forEach((s, i) => {
                // just off its outline, below and to the outside, wherever there's room
                const side = s.c.x < mx - 1 ? -1 : 1;
                for (const deg of [50, 90, 130, 20, 160, -20, 200, -50, 230]) {
                    const a = geo.rad(deg), dx = side * Math.cos(a), dy = Math.sin(a);
                    let far = 0;
                    for (const h of s.hull) far = Math.max(far, h[0] * dx + h[1] * dy);
                    const x = s.c.x + dx * (s.K * far + 1.3 * TALL), y = s.c.y + dy * (s.K * far + 1.3 * TALL);
                    if (ctx.shape.dist(x, y) < TALL || outlines.some(P => geo.pointInPolygon(x, y, P) || toPoly([x, y], P) < 1.1 * TALL)) continue;
                    number(i + 1, x, y, out.of(LABEL));
                    break;
                }
            });
            return out.done();
        },
    });
})();
