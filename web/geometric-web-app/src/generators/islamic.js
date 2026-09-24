/*
 * Islamic star patterns by Hankin's "polygons in contact" method, following
 * Craig Kaplan, "Islamic star patterns from polygons in contact" (GI 2005).
 *
 * A periodic tiling of regular polygons (edge length 1, lattice vectors a, b)
 * is laid over the page. From two contact points on every edge, M ± δ·u, a ray
 * enters the polygon at the contact angle θ, one leaning towards each end of
 * the edge. The ray heading for vertex P(i+1) meets the ray from the next edge
 * heading back to the same vertex; each such pair becomes a "V"
 * (contact → meeting point → contact). Rays of neighbouring polygons meet on
 * the shared edge, so the V's chain into long strands that are joined here
 * (straightest continuation first) before they reach the pipeline.
 *
 * Strands can be drawn as straps: two mitred offset lines per strand. Where
 * straps cross, over/under is assigned so that it alternates along every
 * strand (propagated breadth-first through the crossings, always possible
 * for such planar arrangements), and the lines of the lower strap are cut
 * back a small gap from the upper one — the classic interlaced strapwork.
 */
(function () {
    'use strict';
    const { geo } = PG;
    const S2 = Math.SQRT2, S3 = Math.sqrt(3), D = Math.PI / 180;

    const R = n => 1 / (2 * Math.sin(Math.PI / n)); // circumradius, unit edge
    const AP = n => 1 / (2 * Math.tan(Math.PI / n)); // apothem, unit edge
    const ngon = (cx, cy, n, rotDeg) => geo.ngon(cx, cy, R(n), n, rotDeg * D);
    const polar = (r, deg) => [r * Math.cos(deg * D), r * Math.sin(deg * D)];

    // Unit cells: lattice vectors and the polygons of one period.
    const TILINGS = {
        square: { a: [1, 0], b: [0, 1], polys: [ngon(0, 0, 4, 45)], angles: [60, 67.5, 72, 78], sizes: [18, 36] },
        triangular: {
            a: [1, 0], b: [0.5, S3 / 2], angles: [50, 60, 70], sizes: [16, 30],
            polys: [[[0, 0], [1, 0], [0.5, S3 / 2]], [[1, 0], [1.5, S3 / 2], [0.5, S3 / 2]]],
        },
        hexagonal: { a: [S3, 0], b: [S3 / 2, 1.5], polys: [ngon(0, 0, 6, 30)], angles: [45, 55, 60, 70], sizes: [24, 44] },
        trihex: {
            a: [2, 0], b: [1, S3], angles: [45, 55, 60, 70], sizes: [28, 52],
            polys: [ngon(0, 0, 6, 0), [[1, 0], [1.5, S3 / 2], [0.5, S3 / 2]], [[0.5, -S3 / 2], [1.5, -S3 / 2], [1, 0]]],
        },
        octagon: (() => {
            const h = 0.5 + S2 / 2, w = 1 + S2;
            return { a: [w, 0], b: [0, w], polys: [ngon(0, 0, 8, 22.5), ngon(h, h, 4, 0)], angles: [60, 67.5, 72, 75], sizes: [30, 56] };
        })(),
        dodecagon: (() => {
            const s = 2 + S3, t = s / S3;
            return {
                a: [s, 0], b: [s / 2, (s * S3) / 2], angles: [60, 67, 70, 75, 80], sizes: [40, 72],
                polys: [ngon(0, 0, 12, 15), ngon(...polar(t, 30), 3, 30), ngon(...polar(t, -30), 3, -30)],
            };
        })(),
        '4.6.12': (() => {
            const s = 3 + S3, d4 = AP(12) + 0.5, d6 = AP(12) + S3 / 2;
            const polys = [ngon(0, 0, 12, 15)];
            for (const f of [0, 60, 120]) polys.push(ngon(...polar(d4, f), 4, f + 45));
            for (const f of [30, -30]) polys.push(ngon(...polar(d6, f), 6, 0));
            return { a: [s, 0], b: [s / 2, (s * S3) / 2], polys, angles: [55, 60, 65, 70, 75], sizes: [46, 84] };
        })(),
        '3.4.6.4': (() => {
            const s = 1 + S3, t = s / S3, d4 = S3 / 2 + 0.5;
            const polys = [ngon(0, 0, 6, 30)];
            for (const f of [0, 60, 120]) polys.push(ngon(...polar(d4, f), 4, f + 45));
            polys.push(ngon(...polar(t, 30), 3, 210), ngon(...polar(t, -30), 3, 150));
            return { a: [s, 0], b: [s / 2, (s * S3) / 2], polys, angles: [45, 55, 60, 67.5], sizes: [30, 56] };
        })(),
    };
    // Counter-clockwise (positive signed area) so the left normal points inwards.
    for (const t of Object.values(TILINGS)) t.polys = t.polys.map(P => (geo.polygonArea(P) < 0 ? P.slice().reverse() : P));

    // Hankin motif of one polygon: a list of 3-point "V" paths.
    function motif(P, theta, delta) {
        const n = P.length, c = Math.cos(theta), s = Math.sin(theta);
        const E = P.map((p, i) => {
            const q = P[(i + 1) % n], L = geo.dist(p, q);
            const u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
            return { u, nrm: [-u[1], u[0]], M: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], d: delta * L };
        });
        const out = [];
        for (let i = 0; i < n; i++) {
            const e = E[i], f = E[(i + 1) % n];
            const A = [e.M[0] + e.d * e.u[0], e.M[1] + e.d * e.u[1]];
            const dA = [c * e.u[0] + s * e.nrm[0], c * e.u[1] + s * e.nrm[1]];
            const B = [f.M[0] - f.d * f.u[0], f.M[1] - f.d * f.u[1]];
            const dB = [-c * f.u[0] + s * f.nrm[0], -c * f.u[1] + s * f.nrm[1]];
            const X = geo.lineIntersect(A, dA, B, dB);
            if (X && X.t > 1e-9 && X.u > 1e-9) { out.push([A, [X.x, X.y], B]); continue; }
            // rays running head-on along one line (e.g. triangles at 60°): a straight piece
            const ab = [B[0] - A[0], B[1] - A[1]];
            if (Math.abs(ab[0] * dA[1] - ab[1] * dA[0]) < 1e-9 && ab[0] * dA[0] + ab[1] * dA[1] > 0 && dA[0] * dB[0] + dA[1] * dB[1] < 0) {
                out.push([A, B]);
            }
        }
        return out;
    }

    // Join paths end to end, pairing the ends that meet at a point so that the
    // strand continues as straight as possible. Ends of pieces from the same
    // group (polygon) are never paired: at the edge of the patch that would
    // fold a strand back on itself.
    function chain(pieces, keyOf, group) {
        const ends = new Map();
        const dirAt = (p, end) => {
            const a = end ? p[p.length - 1] : p[0], b = end ? p[p.length - 2] : p[1];
            const L = geo.dist(a, b) || 1;
            return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        };
        pieces.forEach((p, i) => {
            for (let end = 0; end < 2; end++) {
                const k = keyOf(end ? p[p.length - 1] : p[0]);
                let arr = ends.get(k);
                if (!arr) ends.set(k, (arr = []));
                arr.push({ id: i * 2 + end, d: dirAt(p, end) });
            }
        });
        const link = new Int32Array(pieces.length * 2).fill(-1);
        for (const arr of ends.values()) {
            if (arr.length < 2) continue;
            const pairs = [];
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const a = arr[i].id >> 1, b = arr[j].id >> 1;
                    if (a === b || (group && group[a] === group[b])) continue;
                    pairs.push([arr[i].d[0] * arr[j].d[0] + arr[i].d[1] * arr[j].d[1], arr[i].id, arr[j].id]);
                }
            }
            pairs.sort((x, y) => x[0] - y[0]);
            for (const [, a, b] of pairs) if (link[a] < 0 && link[b] < 0) { link[a] = b; link[b] = a; }
        }
        const used = new Uint8Array(pieces.length);
        const out = [];
        const walk = (startId) => {
            // startId: the end we enter from; returns concatenated path
            const path = [];
            let id = startId;
            while (id >= 0 && !used[id >> 1]) {
                const pi = id >> 1;
                used[pi] = 1;
                const p = pieces[pi];
                const seq = id & 1 ? p.slice().reverse() : p;
                for (let k = path.length ? 1 : 0; k < seq.length; k++) path.push(seq[k]);
                id = link[id ^ 1];
            }
            return path;
        };
        for (let i = 0; i < pieces.length; i++) {
            if (used[i]) continue;
            // find the start of an open chain (or any point of a loop)
            let id = i * 2, guard = 0;
            while (link[id] >= 0 && guard++ < pieces.length) {
                const prev = link[id];
                if (prev >> 1 === i) break;
                id = prev ^ 1;
            }
            out.push(walk(id));
        }
        return out;
    }

    // Drop vertices where the path runs straight on (strands pass straight
    // through contact points; crossings are then interior to one segment).
    function straighten(path) {
        const out = [path[0]];
        for (let i = 1; i < path.length - 1; i++) {
            const a = out[out.length - 1], b = path[i], c = path[i + 1];
            const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
            const cr = ux * vy - uy * vx, dt = ux * vx + uy * vy;
            if (Math.abs(cr) > 1e-6 * Math.hypot(ux, uy) * Math.hypot(vx, vy) || dt < 0) out.push(b);
        }
        out.push(path[path.length - 1]);
        return out;
    }

    // Closed strands start at a contact point, which is usually a crossing; start
    // them at a real corner instead, so no crossing sits on the seam.
    function startAtCorner(s) {
        if (!(s.length > 3 && geo.dist(s[0], s[s.length - 1]) < 1e-6)) return s;
        const q = s.slice(0, -1), n = q.length;
        for (let i = 0; i < n; i++) {
            const a = q[(i + n - 1) % n], b = q[i], c = q[(i + 1) % n];
            const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.abs(cr) > 1e-6 * geo.dist(a, b) * geo.dist(b, c)) {
                const r = q.slice(i).concat(q.slice(0, i));
                r.push(r[0]);
                return r;
            }
        }
        return s;
    }

    // Offset a polyline sideways by o (mitred joins, bevelled past a limit).
    // Returns the points and, per centreline segment, the index of its first offset point.
    function offsetPath(path, o, closed) {
        const pts = closed ? path.slice(0, -1) : path;
        const n = pts.length, m = closed ? n : n - 1;
        const N = [];
        for (let i = 0; i < m; i++) {
            const a = pts[i], b = pts[(i + 1) % n], L = geo.dist(a, b) || 1;
            N.push([-(b[1] - a[1]) / L, (b[0] - a[0]) / L]);
        }
        const out = [], segStart = new Array(m);
        for (let v = 0; v < n; v++) {
            const P = pts[v];
            const na = closed || v > 0 ? N[(v - 1 + m) % m] : null, nb = closed || v < n - 1 ? N[v % m] : null;
            if (!na || !nb) {
                const q = na || nb;
                out.push([P[0] + o * q[0], P[1] + o * q[1]]);
            } else {
                const mx = na[0] + nb[0], my = na[1] + nb[1], L = Math.hypot(mx, my);
                const cosH = L / 2; // cos of half the turning angle
                if (cosH < 0.2) {
                    out.push([P[0] + o * na[0], P[1] + o * na[1]], [P[0] + o * nb[0], P[1] + o * nb[1]]);
                } else {
                    const f = o / (cosH * L);
                    out.push([P[0] + mx * f, P[1] + my * f]);
                }
            }
            if (v < m) segStart[v] = out.length - 1;
        }
        if (closed) out.push(out[0].slice());
        return { pts: out, segStart };
    }

    // Remove arclength intervals from a polyline; returns the remaining pieces.
    function cutPath(pts, cuts) {
        if (!cuts.length) return [pts];
        cuts.sort((x, y) => x[0] - y[0]);
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + geo.dist(pts[i - 1], pts[i]));
        const at = s => {
            let i = 1;
            while (i < pts.length - 1 && cum[i] < s) i++;
            const L = cum[i] - cum[i - 1] || 1, t = geo.clamp((s - cum[i - 1]) / L, 0, 1);
            return { i, p: geo.lerpPt(pts[i - 1], pts[i], t) };
        };
        const keep = [];
        let s = 0;
        for (const [c0, c1] of cuts) {
            if (c1 <= s) continue;
            if (c0 > s) keep.push([s, c0]);
            s = Math.max(s, c1);
        }
        if (s < cum[cum.length - 1]) keep.push([s, cum[cum.length - 1]]);
        const out = [];
        for (const [s0, s1] of keep) {
            if (s1 - s0 < 1e-3) continue;
            const A = at(s0), B = at(s1);
            const piece = [A.p];
            for (let i = A.i; i < B.i; i++) piece.push(pts[i]);
            piece.push(B.p);
            out.push(piece);
        }
        return out;
    }

    // Turn strands into straps of width w. mode: 'weave' (alternating
    // over/under with a gap), 'flat' (outline of the union), 'overlap'.
    // Returns the strap lines grouped per input strand.
    function straps(strands, w, gap, mode) {
        const S = strands.map(startAtCorner).map(straighten);
        const segs = [];
        S.forEach((s, si) => {
            for (let i = 0; i + 1 < s.length; i++) segs.push({ si, i, a: s[i], b: s[i + 1] });
        });
        // uniform grid over segments to find crossings
        let cell = 0;
        for (const g of segs) cell += geo.dist(g.a, g.b);
        cell = Math.max(1, cell / Math.max(1, segs.length));
        const grid = new Map();
        segs.forEach((g, k) => {
            const x0 = Math.floor(Math.min(g.a[0], g.b[0]) / cell), x1 = Math.floor(Math.max(g.a[0], g.b[0]) / cell);
            const y0 = Math.floor(Math.min(g.a[1], g.b[1]) / cell), y1 = Math.floor(Math.max(g.a[1], g.b[1]) / cell);
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                const key = x * 100003 + y;
                let arr = grid.get(key);
                if (!arr) grid.set(key, (arr = []));
                arr.push(k);
            }
        });
        const closedS = S.map(s => s.length > 3 && geo.dist(s[0], s[s.length - 1]) < 1e-6);
        const crossings = [];
        const tested = new Set();
        for (const arr of grid.values()) {
            for (let x = 0; x < arr.length; x++) {
                for (let y = x + 1; y < arr.length; y++) {
                    const k1 = Math.min(arr[x], arr[y]), k2 = Math.max(arr[x], arr[y]);
                    const pk = k1 * segs.length + k2;
                    if (tested.has(pk)) continue;
                    tested.add(pk);
                    const g = segs[k1], h = segs[k2];
                    if (g.si === h.si) {
                        const n = S[g.si].length - 1;
                        if (Math.abs(g.i - h.i) <= 1 || (closedS[g.si] && Math.abs(g.i - h.i) === n - 1)) continue;
                    }
                    const d = [g.b[0] - g.a[0], g.b[1] - g.a[1]], e = [h.b[0] - h.a[0], h.b[1] - h.a[1]];
                    const X = geo.lineIntersect(g.a, d, h.a, e);
                    if (!X || X.t <= 1e-6 || X.t >= 1 - 1e-6 || X.u <= 1e-6 || X.u >= 1 - 1e-6) continue;
                    crossings.push({ p: [X.x, X.y], s: [{ seg: g, t: X.t }, { seg: h, t: X.u }], over: -1 });
                }
            }
        }
        // order crossings along each strand
        const along = S.map(() => []);
        crossings.forEach((c, ci) => c.s.forEach((sl, k) => along[sl.seg.si].push({ ci, k, pos: sl.seg.i + sl.t })));
        for (const l of along) l.sort((x, y) => x.pos - y.pos);
        if (mode === 'weave') {
            // over[ci] = which slot passes over; consecutive crossings on a strand alternate
            const nbrs = crossings.map(() => []);
            along.forEach((l, si) => {
                const n = l.length;
                for (let j = 0; j + 1 < n + (closedS[si] && n > 1 ? 1 : 0); j++) {
                    const A = l[j], B = l[(j + 1) % n];
                    nbrs[A.ci].push([A.k, B.ci, B.k]);
                    nbrs[B.ci].push([B.k, A.ci, A.k]);
                }
            });
            for (let c0 = 0; c0 < crossings.length; c0++) {
                if (crossings[c0].over >= 0) continue;
                crossings[c0].over = 0;
                const queue = [c0];
                while (queue.length) {
                    const ci = queue.pop();
                    for (const [k, cj, kj] of nbrs[ci]) {
                        if (crossings[cj].over >= 0) continue;
                        // slot k of ci is over  <=>  slot kj of cj is under
                        const kOver = crossings[ci].over === k;
                        crossings[cj].over = kOver ? 1 - kj : kj;
                        queue.push(cj);
                    }
                }
            }
        }
        const h = w / 2;
        const out = S.map(() => []);
        S.forEach((s, si) => {
            const closed = closedS[si];
            for (const o of [h, -h]) {
                const off = offsetPath(s, o, closed);
                const cum = [0];
                for (let i = 1; i < off.pts.length; i++) cum.push(cum[i - 1] + geo.dist(off.pts[i - 1], off.pts[i]));
                const cuts = [];
                if (mode !== 'overlap') {
                    for (const { ci, k } of along[si]) {
                        const c = crossings[ci];
                        if (mode === 'weave' && c.over === k) continue;
                        const me = c.s[k].seg, other = c.s[1 - k].seg;
                        const L1 = geo.dist(me.a, me.b), L2 = geo.dist(other.a, other.b);
                        const dU = [(me.b[0] - me.a[0]) / L1, (me.b[1] - me.a[1]) / L1];
                        const dO = [(other.b[0] - other.a[0]) / L2, (other.b[1] - other.a[1]) / L2];
                        const nU = [-dU[1], dU[0]], nO = [-dO[1], dO[0]];
                        const sinA = dU[0] * nO[0] + dU[1] * nO[1];
                        if (Math.abs(sinA) < 0.05) continue;
                        const half = h + (mode === 'weave' ? gap : 0);
                        const cc = o * (nU[0] * nO[0] + nU[1] * nO[1]);
                        let t0 = (-half - cc) / sinA, t1 = (half - cc) / sinA;
                        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
                        const q = off.pts[off.segStart[me.i]];
                        const base = cum[off.segStart[me.i]] + (c.p[0] + o * nU[0] - q[0]) * dU[0] + (c.p[1] + o * nU[1] - q[1]) * dU[1];
                        cuts.push([base + t0, base + t1]);
                        if (closed) {
                            // a gap straddling the seam of a closed strand wraps round to its other end
                            const T = cum[cum.length - 1];
                            if (base + t0 < 0) cuts.push([base + t0 + T, T]);
                            if (base + t1 > T) cuts.push([0, base + t1 - T]);
                        }
                    }
                }
                for (const piece of cutPath(off.pts, cuts)) if (geo.pathLength(piece) > 0.4) out[si].push(piece);
            }
        });
        return out;
    }

    PG.register({
        id: 'islamic',
        name: 'Islamic Stars',
        category: 'Tiles',
        description: "Hankin's polygons-in-contact star patterns over eight periodic tilings.",
        fit: false,
        params: [
            { type: 'section', label: 'Tiling' },
            { id: 'tiling', label: 'Tiling', type: 'select', value: '4.6.12',
                options: [['square', 'Squares (4.4.4.4)'], ['triangular', 'Triangles (3.3.3.3.3.3)'], ['hexagonal', 'Hexagons (6.6.6)'],
                    ['trihex', 'Trihexagonal (3.6.3.6)'], ['octagon', 'Octagons (4.8.8)'], ['dodecagon', 'Dodecagons (3.12.12)'],
                    ['4.6.12', 'Dodecagons (4.6.12)'], ['3.4.6.4', 'Rhombitrihexagonal (3.4.6.4)']] },
            { id: 'size', label: 'Repeat (mm)', type: 'range', min: 8, max: 200, step: 1, value: 54, random: false,
                hint: 'Length of the lattice period' },
            { type: 'section', label: 'Pattern' },
            { id: 'theta', label: 'Contact angle°', type: 'range', min: 10, max: 85, step: 0.5, value: 69, random: false },
            { id: 'delta', label: 'Contact offset', type: 'range', min: -0.4, max: 0.4, step: 0.01, value: 0, random: false,
                hint: 'Splits each contact point in two, ± this fraction of the edge' },
            { id: 'theta2', label: 'Second angle° (own pen)', type: 'range', min: 0, max: 85, step: 0.5, value: 0, random: false,
                hint: '0 = off. A second pattern with another contact angle, overlaid on its own pen' },
            { id: 'showTiling', label: 'Show tiling (own pen)', type: 'checkbox', value: false, random: 0.2 },
            { type: 'section', label: 'Straps' },
            { id: 'strap', label: 'Strap width (mm)', type: 'range', min: 0, max: 8, step: 0.1, value: 1.8, random: false,
                hint: '0 = single lines. Otherwise every strand is drawn as a band of this width' },
            { id: 'weave', label: 'Crossings', type: 'select', value: 'weave', random: ['weave', 'weave', 'weave', 'flat'],
                show: p => p.strap > 0,
                options: [['weave', 'Interlaced over / under'], ['flat', 'Flat (outline only)'], ['overlap', 'Overlapping']] },
            { id: 'gap', label: 'Interlace gap (mm)', type: 'range', min: 0, max: 3, step: 0.05, value: 0.6, random: [0.4, 1.1],
                show: p => p.strap > 0 && p.weave === 'weave' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Strand pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Each strand gets a random pen; the tiling and second pattern follow on the next pens' },
        ],

        randomize(rng) {
            const tiling = rng.pick(Object.keys(TILINGS));
            const t = TILINGS[tiling];
            const size = Math.round(rng.range(t.sizes[0], t.sizes[1]));
            const edge = size / Math.hypot(t.a[0], t.a[1]);
            const theta = rng.pick(t.angles);
            return {
                tiling, theta, size,
                // positive offsets break strands into loops around the vertices; keep to small negative ones
                delta: rng.chance(0.8) ? 0 : -rng.range(0.04, 0.15).toFixed(2),
                theta2: rng.chance(0.12) ? rng.pick(t.angles.filter(a => a !== theta)) : 0,
                strap: rng.chance(0.2) ? 0 : +geo.clamp(edge * rng.range(0.14, 0.24), 1, 3.2).toFixed(1),
            };
        },

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const T = TILINGS[p.tiling] || TILINGS.square;
            const k = p.size / Math.hypot(T.a[0], T.a[1]);
            const a = [T.a[0] * k, T.a[1] * k], b = [T.b[0] * k, T.b[1] * k];
            const ox = W / 2, oy = H / 2;

            // lattice range covering the page plus one period
            const det = a[0] * b[1] - a[1] * b[0];
            const pad = Math.hypot(a[0], a[1]) + Math.hypot(b[0], b[1]);
            let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
            for (const [x, y] of [[-pad, -pad], [W + pad, -pad], [-pad, H + pad], [W + pad, H + pad]]) {
                const dx = x - ox, dy = y - oy;
                const i = (dx * b[1] - dy * b[0]) / det, j = (a[0] * dy - a[1] * dx) / det;
                i0 = Math.min(i0, Math.floor(i)); i1 = Math.max(i1, Math.ceil(i));
                j0 = Math.min(j0, Math.floor(j)); j1 = Math.max(j1, Math.ceil(j));
            }
            const edgeMM = k;
            const visible = (poly) => {
                const bb = geo.bbox([poly]);
                return bb.maxX > -edgeMM && bb.minX < W + edgeMM && bb.maxY > -edgeMM && bb.minY < H + edgeMM;
            };
            const place = (pts, dx, dy) => pts.map(q => [ox + dx + q[0] * k, oy + dy + q[1] * k]);
            const copies = [];
            for (let i = i0; i <= i1; i++) {
                for (let j = j0; j <= j1; j++) {
                    const dx = i * a[0] + j * b[0], dy = i * a[1] + j * b[1];
                    T.polys.forEach((P, pi) => {
                        const poly = place(P, dx, dy);
                        if (visible(poly)) copies.push({ pi, dx, dy, poly });
                    });
                }
            }

            const keyOf = q => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;
            const pattern = theta => {
                const unit = T.polys.map(P => motif(P, theta * D, p.delta));
                const pieces = [], group = [];
                copies.forEach((c, ci) => {
                    for (const v of unit[c.pi]) { pieces.push(place(v, c.dx, c.dy)); group.push(ci); }
                });
                const strands = chain(pieces, keyOf, group);
                return p.strap > 0 ? straps(strands, p.strap, p.gap, p.weave) : strands.map(s => [s]);
            };

            // strands (and so whole straps) are coloured at random across the pattern pens
            const pens = Math.max(1, p.pens | 0);
            const layers = Array.from({ length: pens }, () => []);
            for (const group of pattern(p.theta)) layers[rng.int(0, pens - 1)].push(...group);
            if (p.showTiling) {
                const seen = new Set(), edges = [];
                for (const c of copies) {
                    const P = c.poly;
                    for (let i = 0; i < P.length; i++) {
                        const q0 = P[i], q1 = P[(i + 1) % P.length];
                        const k0 = keyOf(q0), k1 = keyOf(q1);
                        const key = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        edges.push([q0, q1]);
                    }
                }
                layers.push(chain(edges, keyOf));
            }
            if (p.theta2 > 0) layers.push(pattern(p.theta2).flat());
            return layers.length === 1 ? layers[0] : { layers };
        },
    });
})();
