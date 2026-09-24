/*
 * Plotter Geometry — core: generator registry, seeded RNG and geometry helpers.
 *
 * Everything lives on the global `PG` namespace so the app works from file://
 * (no modules, no build step). Units are millimetres unless a generator is
 * marked `fit: true`, in which case it may draw in any unit and the pipeline
 * scales the result to the drawing area.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    const TAU = Math.PI * 2;
    PG.TAU = TAU;

    // ------------------------------------------------------------------
    // Generator registry
    // ------------------------------------------------------------------
    //
    // PG.register({
    //   id, name, category, description,
    //   fit: true|false,          // true: pipeline scales output to fit; false: draws into ctx.width × ctx.height mm
    //   params: [ { id, label, type: 'range'|'select'|'checkbox'|'text'|'image'|'section',
    //               min, max, step, value, options: [[value, label]...], show: p => bool,
    //               random: false | [min, max], hint } ],
    //   randomize(rng, params) -> partial params   (optional, curated randomisation)
    //   generate(params, ctx) -> paths | { layers: [paths, paths, ...] }
    // })
    PG.generators = [];
    PG.byId = {};
    PG.categories = ['Curves', 'Fields', 'Tiles', 'Packing', 'Image'];

    PG.register = function (def) {
        if (!def.id || !def.generate) throw new Error('Generator needs id and generate()');
        def.params = def.params || [];
        def.category = def.category || 'Curves';
        if (PG.byId[def.id]) {
            PG.generators = PG.generators.filter(g => g.id !== def.id);
        }
        PG.generators.push(def);
        PG.byId[def.id] = def;
        return def;
    };

    PG.defaultParams = function (def) {
        const p = {};
        for (const q of def.params) if (q.id) p[q.id] = q.value;
        return p;
    };

    // Uniformly randomise every param that allows it, then apply the generator's
    // curated overrides. `rng` only needs a random() method.
    PG.randomParams = function (def, current, rng) {
        const p = Object.assign({}, current);
        for (const q of def.params) {
            if (!q.id || q.random === false) continue;
            if (q.show && !q.show(p)) continue;
            if (q.type === 'range') {
                const [lo, hi] = Array.isArray(q.random) ? q.random : [q.min, q.max];
                const v = lo + rng.random() * (hi - lo);
                p[q.id] = PG.snap(v, q.step || 1, q.min);
            } else if (q.type === 'select' && q.random !== undefined) {
                const opts = Array.isArray(q.random) ? q.random : q.options.map(o => o[0]);
                p[q.id] = opts[Math.floor(rng.random() * opts.length)];
            } else if (q.type === 'checkbox' && q.random !== undefined) {
                p[q.id] = rng.random() < (typeof q.random === 'number' ? q.random : 0.5);
            }
        }
        if (def.randomize) Object.assign(p, def.randomize(rng, p) || {});
        return p;
    };

    PG.snap = function (v, step, base) {
        base = base || 0;
        const n = Math.round((v - base) / step);
        const decimals = (String(step).split('.')[1] || '').length;
        return +(base + n * step).toFixed(decimals);
    };

    // ------------------------------------------------------------------
    // Seeded RNG (mulberry32 on a splitmix-scrambled seed)
    // ------------------------------------------------------------------
    function scramble(seed) {
        let z = (seed >>> 0) + 0x9e3779b9;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
        return (z ^ (z >>> 16)) >>> 0;
    }

    class RNG {
        constructor(seed) {
            this.state = scramble(seed | 0);
        }
        random() {
            let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }
        range(a, b) { return a + (b - a) * this.random(); }
        int(a, b) { return a + Math.floor(this.random() * (b - a + 1)); } // inclusive
        pick(arr) { return arr[Math.floor(this.random() * arr.length)]; }
        chance(p) { return this.random() < p; }
        sign() { return this.random() < 0.5 ? -1 : 1; }
        gauss(mean = 0, sd = 1) {
            const u = 1 - this.random(), v = this.random();
            return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
        }
        shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(this.random() * (i + 1));
                const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
            return arr;
        }
        // Pick from [[weight, value], ...]
        weighted(pairs) {
            let total = 0;
            for (const [w] of pairs) total += w;
            let r = this.random() * total;
            for (const [w, v] of pairs) { if ((r -= w) <= 0) return v; }
            return pairs[pairs.length - 1][1];
        }
    }
    PG.RNG = RNG;

    // ------------------------------------------------------------------
    // Geometry helpers. Points are [x, y] arrays; paths are arrays of points.
    // ------------------------------------------------------------------
    const geo = (PG.geo = {});

    geo.lerp = (a, b, t) => a + (b - a) * t;
    geo.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    geo.smoothstep = (a, b, x) => { const t = geo.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    geo.lerpPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    geo.dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    geo.dist2 = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1]; return dx * dx + dy * dy; };
    geo.rad = deg => (deg * Math.PI) / 180;
    geo.deg = rad => (rad * 180) / Math.PI;

    geo.gcd = function (a, b) {
        a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
        while (b) { const t = b; b = a % b; a = t; }
        return a || 1;
    };

    geo.rotate = function (p, ang, cx = 0, cy = 0) {
        const c = Math.cos(ang), s = Math.sin(ang);
        const x = p[0] - cx, y = p[1] - cy;
        return [cx + x * c - y * s, cy + x * s + y * c];
    };

    geo.mapPaths = function (paths, fn) {
        return paths.map(path => path.map(fn));
    };

    geo.translatePaths = (paths, dx, dy) => geo.mapPaths(paths, p => [p[0] + dx, p[1] + dy]);
    geo.scalePaths = (paths, s, cx = 0, cy = 0) => geo.mapPaths(paths, p => [cx + (p[0] - cx) * s, cy + (p[1] - cy) * s]);
    geo.rotatePaths = (paths, ang, cx = 0, cy = 0) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        return geo.mapPaths(paths, p => {
            const x = p[0] - cx, y = p[1] - cy;
            return [cx + x * c - y * s, cy + x * s + y * c];
        });
    };

    // Number of segments so that a circular arc deviates < tol from the true curve.
    geo.segmentsFor = function (r, sweep = TAU, tol = 0.02) {
        r = Math.abs(r);
        if (r <= tol) return Math.max(3, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
        const step = 2 * Math.acos(1 - tol / r);
        return geo.clamp(Math.ceil(Math.abs(sweep) / step), 3, 2000);
    };

    // Closed circle (first point repeated at the end). Without `segs`, the count
    // keeps the chord error below `tol` (in the generator's units — for fit
    // generators drawing in unit coordinates pass a smaller tol or explicit segs).
    geo.circle = function (cx, cy, r, segs, a0 = 0, tol = 0.02) {
        segs = segs || geo.segmentsFor(r, TAU, tol);
        const pts = new Array(segs + 1);
        for (let i = 0; i <= segs; i++) {
            const a = a0 + (TAU * i) / segs;
            pts[i] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        }
        pts[segs] = [pts[0][0], pts[0][1]];
        return pts;
    };

    geo.ellipse = function (cx, cy, rx, ry, rot = 0, segs, tol = 0.02) {
        segs = segs || geo.segmentsFor(Math.max(rx, ry), TAU, tol);
        const c = Math.cos(rot), s = Math.sin(rot), pts = [];
        for (let i = 0; i <= segs; i++) {
            const a = (TAU * i) / segs, x = rx * Math.cos(a), y = ry * Math.sin(a);
            pts.push([cx + x * c - y * s, cy + x * s + y * c]);
        }
        return pts;
    };

    geo.arc = function (cx, cy, r, a0, a1, segs, tol = 0.02) {
        segs = segs || geo.segmentsFor(r, a1 - a0, tol);
        const pts = new Array(segs + 1);
        for (let i = 0; i <= segs; i++) {
            const a = a0 + ((a1 - a0) * i) / segs;
            pts[i] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        }
        return pts;
    };

    // Regular polygon, open list of vertices (not closed).
    geo.ngon = function (cx, cy, r, n, rot = 0) {
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = rot + (TAU * i) / n;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
    };

    // Return a copy of a vertex list with the first point appended (closed path).
    geo.close = function (poly) {
        if (!poly.length) return poly;
        const a = poly[0], b = poly[poly.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) return poly.slice();
        return poly.concat([[a[0], a[1]]]);
    };

    geo.bbox = function (paths) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const path of paths) for (const p of path) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    };

    geo.pathLength = function (path) {
        let L = 0;
        for (let i = 1; i < path.length; i++) {
            L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        }
        return L;
    };

    geo.polygonArea = function (poly) {
        let a = 0;
        for (let i = 0, n = poly.length; i < n; i++) {
            const p = poly[i], q = poly[(i + 1) % n];
            a += p[0] * q[1] - q[0] * p[1];
        }
        return a / 2;
    };

    geo.centroid = function (poly) {
        let cx = 0, cy = 0, a = 0;
        for (let i = 0, n = poly.length; i < n; i++) {
            const p = poly[i], q = poly[(i + 1) % n];
            const f = p[0] * q[1] - q[0] * p[1];
            a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
        }
        if (Math.abs(a) < 1e-12) {
            let sx = 0, sy = 0;
            for (const p of poly) { sx += p[0]; sy += p[1]; }
            return [sx / poly.length, sy / poly.length];
        }
        return [cx / (3 * a), cy / (3 * a)];
    };

    geo.pointInPolygon = function (x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };

    // Intersection of lines p + t*d and q + u*e. Returns {x, y, t, u} or null if parallel.
    geo.lineIntersect = function (p, d, q, e) {
        const den = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(den) < 1e-12) return null;
        const wx = q[0] - p[0], wy = q[1] - p[1];
        const t = (wx * e[1] - wy * e[0]) / den;
        const u = (wx * d[1] - wy * d[0]) / den;
        return { x: p[0] + d[0] * t, y: p[1] + d[1] * t, t, u };
    };

    // Clip a polygon by the half-plane (x - p)·n >= 0 (Sutherland–Hodgman).
    geo.clipPolygonHalfPlane = function (poly, p, n) {
        const out = [];
        const len = poly.length;
        if (!len) return out;
        const side = q => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
        for (let i = 0; i < len; i++) {
            const a = poly[i], b = poly[(i + 1) % len];
            const sa = side(a), sb = side(b);
            if (sa >= 0) out.push(a);
            if ((sa >= 0) !== (sb >= 0)) {
                const t = sa / (sa - sb);
                out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
        }
        return out;
    };

    // Inset a convex polygon (open vertex list) by distance d. Returns [] when it vanishes.
    geo.insetConvex = function (poly, d) {
        if (poly.length < 3) return [];
        const ccw = geo.polygonArea(poly) > 0;
        let out = poly;
        for (let i = 0; i < poly.length && out.length >= 3; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const ex = b[0] - a[0], ey = b[1] - a[1];
            const L = Math.hypot(ex, ey);
            if (L < 1e-12) continue;
            // inward normal
            const n = ccw ? [-ey / L, ex / L] : [ey / L, -ex / L];
            out = geo.clipPolygonHalfPlane(out, [a[0] + n[0] * d, a[1] + n[1] * d], n);
        }
        return out.length >= 3 ? out : [];
    };

    // Hatch the interior of one or more polygons (even-odd rule) with parallel lines.
    // polys: array of open vertex lists. Returns an array of 2-point segments,
    // alternating direction so a plotter can zig-zag through them.
    geo.hatch = function (polys, spacing, angle = 0, phase = 0.5) {
        if (!Array.isArray(polys[0][0])) polys = [polys];
        if (spacing <= 0) return [];
        const c = Math.cos(-angle), s = Math.sin(-angle);
        // rotate polygons so hatch lines are horizontal
        const rp = polys.map(poly => poly.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]));
        let minY = Infinity, maxY = -Infinity;
        for (const poly of rp) for (const p of poly) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        const out = [];
        const ci = Math.cos(angle), si = Math.sin(angle);
        const back = (x, y) => [x * ci - y * si, x * si + y * ci];
        let row = 0;
        const start = Math.ceil(minY / spacing - phase) + phase;
        for (let k = start; k * spacing <= maxY; k++, row++) {
            const y = k * spacing;
            const xs = [];
            for (const poly of rp) {
                for (let i = 0, n = poly.length; i < n; i++) {
                    const a = poly[i], b = poly[(i + 1) % n];
                    if ((a[1] > y) !== (b[1] > y)) {
                        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
                    }
                }
            }
            xs.sort((u, v) => u - v);
            const segs = [];
            for (let i = 0; i + 1 < xs.length; i += 2) {
                if (xs[i + 1] - xs[i] > 1e-9) segs.push([back(xs[i], y), back(xs[i + 1], y)]);
            }
            if (row % 2) { segs.reverse(); for (const sg of segs) sg.reverse(); }
            out.push(...segs);
        }
        return out;
    };

    // Drop consecutive near-duplicate vertices of a polygon (open vertex list),
    // including a repeated closing point. Returns [] if fewer than 3 remain.
    geo.cleanPolygon = function (poly, eps = 1e-4) {
        const out = [];
        for (const q of poly) {
            const last = out[out.length - 1];
            if (!last || Math.abs(q[0] - last[0]) > eps || Math.abs(q[1] - last[1]) > eps) out.push(q);
        }
        while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= eps &&
            Math.abs(out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
        return out.length >= 3 ? out : [];
    };

    // Hatch a convex polygon (open vertex list) as ONE stroke: the pen runs along
    // the boundary between consecutive hatch lines. Returns [] if no line fits.
    geo.hatchZigzag = function (poly, spacing, angle = 0) {
        const n = poly.length;
        if (n < 3 || spacing <= 0) return [];
        const c = Math.cos(angle), s = Math.sin(angle);
        const P = poly.map(q => [q[0] * c + q[1] * s, q[1] * c - q[0] * s]);
        let top = 0, bot = 0;
        for (let i = 1; i < n; i++) {
            if (P[i][1] < P[top][1]) top = i;
            if (P[i][1] > P[bot][1]) bot = i;
        }
        const v0 = P[top][1], v1 = P[bot][1];
        // the two boundary chains from the top vertex down to the bottom one
        const chains = [[], []];
        for (let i = top; ; i = (i + 1) % n) { chains[0].push(P[i]); if (i === bot) break; }
        for (let i = top; ; i = (i + n - 1) % n) { chains[1].push(P[i]); if (i === bot) break; }
        const k0 = Math.floor(v0 / spacing) + 1, k1 = Math.ceil(v1 / spacing) - 1;
        if (k1 < k0) return [];
        const seg = [0, 0], next = [1, 1];
        const at = (side, v) => {
            const ch = chains[side];
            while (seg[side] < ch.length - 2 && ch[seg[side] + 1][1] < v) seg[side]++;
            const a = ch[seg[side]], b = ch[seg[side] + 1];
            const t = b[1] > a[1] ? (v - a[1]) / (b[1] - a[1]) : 0;
            return [a[0] + (b[0] - a[0]) * t, v];
        };
        const out = [];
        let side = 0, prevV = v0;
        for (let k = k0; k <= k1; k++) {
            const v = k * spacing;
            // rim vertices passed since the previous line on the side we start from
            const ch = chains[side];
            while (next[side] < ch.length - 1 && ch[next[side]][1] <= prevV) next[side]++;
            if (k > k0) while (next[side] < ch.length - 1 && ch[next[side]][1] < v) out.push(ch[next[side]++]);
            out.push(at(side, v), at(1 - side, v));
            side = 1 - side;
            prevV = v;
        }
        return out.map(q => [q[0] * c - q[1] * s, q[0] * s + q[1] * c]);
    };

    // Fill a convex polygon with concentric insets drawn as ONE stroke: the outer
    // ring is closed, every inner ring skips its closing edge and runs on to the
    // next ring's matching corner, so the fill winds inward as a polygon spiral.
    // `round` (0..1) rounds the corners of every ring.
    geo.insetSpiral = function (poly, spacing, round = 0) {
        // start at the sharpest corner so the connecting steps hide in it
        let start = 0, bestCos = Infinity;
        for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
            const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
            const cs = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
            if (cs < bestCos - 1e-6) { bestCos = cs; start = i; }
        }
        const out = [];
        let cur = poly;
        for (let k = 0; k < 400 && cur.length >= 3; k++) {
            const n = cur.length;
            let ring = [];
            for (let i = 0; i <= n; i++) ring.push(cur[(start + i) % n]);
            if (round > 0) ring = geo.roundCorners(ring, round * 0.5, 6);
            const next = geo.cleanPolygon(geo.insetConvex(cur, spacing));
            out.push(...(k === 0 || !next.length ? ring : ring.slice(0, -1)));
            const anchor = cur[start];
            let bd = Infinity;
            next.forEach((q, i) => { const d = geo.dist2(q, anchor); if (d < bd) { bd = d; start = i; } });
            cur = next;
        }
        return out;
    };

    // Chaikin corner cutting.
    geo.chaikin = function (path, iterations = 1, closed = false) {
        let pts = path;
        for (let it = 0; it < iterations; it++) {
            const out = [];
            const n = pts.length;
            if (n < 3) return pts;
            if (!closed) out.push(pts[0]);
            for (let i = 0; i < n - 1; i++) {
                const p = pts[i], q = pts[i + 1];
                out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
                out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
            }
            if (closed) out.push([out[0][0], out[0][1]]);
            else out.push(pts[n - 1]);
            pts = out;
        }
        return pts;
    };

    // Resample a polyline at (approximately) fixed arc-length steps.
    geo.resample = function (path, step) {
        if (path.length < 2) return path.slice();
        const out = [path[0]];
        let carry = 0;
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            let d = step - carry;
            while (d <= L) {
                const t = d / L;
                out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
                d += step;
            }
            carry = L - (d - step);
        }
        const last = path[path.length - 1], tail = out[out.length - 1];
        if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
        return out;
    };

    // Round every interior corner of a polyline with a quadratic Bézier.
    // amount (0..0.5) is the fraction of each adjacent segment eaten by the curve.
    geo.roundCorners = function (path, amount, steps = 6) {
        if (amount <= 0 || path.length < 3) return path;
        const closed = path.length > 3 &&
            Math.abs(path[0][0] - path[path.length - 1][0]) < 1e-9 &&
            Math.abs(path[0][1] - path[path.length - 1][1]) < 1e-9;
        const pts = closed ? path.slice(0, -1) : path;
        const n = pts.length;
        const out = [];
        if (!closed) out.push(pts[0]);
        const first = closed ? 0 : 1, last = closed ? n : n - 1;
        for (let i = first; i < last; i++) {
            const P = pts[(i - 1 + n) % n], V = pts[i], N = pts[(i + 1) % n];
            const A = geo.lerpPt(V, P, amount), B = geo.lerpPt(V, N, amount);
            for (let k = 0; k <= steps; k++) {
                const t = k / steps, u = 1 - t;
                out.push([u * u * A[0] + 2 * u * t * V[0] + t * t * B[0], u * u * A[1] + 2 * u * t * V[1] + t * t * B[1]]);
            }
        }
        if (closed) out.push([out[0][0], out[0][1]]);
        else out.push(pts[n - 1]);
        return out;
    };

    // Split a single long path into `n` consecutive pieces (by point count), e.g. to
    // hand successive stretches of a curve to different pens.
    geo.splitPath = function (path, n) {
        if (n <= 1) return [path];
        const out = [];
        const len = path.length;
        for (let i = 0; i < n; i++) {
            const a = Math.floor((i * (len - 1)) / n);
            const b = Math.floor(((i + 1) * (len - 1)) / n);
            out.push(path.slice(a, b + 1));
        }
        return out;
    };

    // Distribute an array of paths over `pens` layers using an index function.
    geo.toLayers = function (paths, pens, indexFn) {
        const layers = Array.from({ length: Math.max(1, pens) }, () => []);
        paths.forEach((p, i) => layers[((indexFn ? indexFn(p, i) : i) % layers.length + layers.length) % layers.length].push(p));
        return { layers };
    };
})();
