/*
 * Pipeline: run a generator, place its output on the paper (fit / rotate /
 * offset), clip to the drawing area, optionally frame it, then optimise the
 * pen path per layer and collect statistics.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const geo = PG.geo;

    PG.MAX_PENS = 6;

    // ------------------------------------------------------------------
    // Clip shapes (convex). Each exposes inside(), dist() (signed, >0 inside),
    // clipSeg() -> [t0, t1] | null, and outline().
    // ------------------------------------------------------------------
    const shapes = (PG.shapes = {});
    // Geometry fitted exactly onto an edge can land a hair outside through
    // rounding; this tolerance (mm) keeps such lines instead of dropping them.
    const EPS = 1e-7;

    shapes.rect = function (x0, y0, x1, y1) {
        return {
            type: 'rect', x0, y0, x1, y1,
            inside: (x, y) => x >= x0 - EPS && x <= x1 + EPS && y >= y0 - EPS && y <= y1 + EPS,
            dist: (x, y) => Math.min(x - x0, x1 - x, y - y0, y1 - y),
            clipSeg(ax, ay, bx, by) { // Liang–Barsky
                let t0 = 0, t1 = 1;
                const dx = bx - ax, dy = by - ay;
                const p = [-dx, dx, -dy, dy], q = [ax - x0 + EPS, x1 - ax + EPS, ay - y0 + EPS, y1 - ay + EPS];
                for (let i = 0; i < 4; i++) {
                    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
                    const r = q[i] / p[i];
                    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
                    else { if (r < t0) return null; if (r < t1) t1 = r; }
                }
                return [t0, t1];
            },
            outline: () => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
        };
    };

    shapes.circle = function (cx, cy, r) {
        return {
            type: 'circle', cx, cy, r,
            inside: (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= (r + EPS) * (r + EPS),
            dist: (x, y) => r - Math.hypot(x - cx, y - cy),
            clipSeg(ax, ay, bx, by) {
                const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
                const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
                if (a === 0) return c <= 0 ? [0, 1] : null;
                const disc = b * b - 4 * a * c;
                if (disc < 0) return null;
                const s = Math.sqrt(disc);
                const t0 = Math.max(0, (-b - s) / (2 * a)), t1 = Math.min(1, (-b + s) / (2 * a));
                return t0 <= t1 ? [t0, t1] : null;
            },
            outline: () => geo.circle(cx, cy, r, geo.segmentsFor(r, PG.TAU, 0.005)),
        };
    };

    // Convex polygon (open vertex list, any winding) — Cyrus–Beck clipping.
    shapes.polygon = function (verts) {
        const ccw = geo.polygonArea(verts) > 0;
        const edges = verts.map((a, i) => {
            const b = verts[(i + 1) % verts.length];
            const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
            const n = ccw ? [-ey / L, ex / L] : [ey / L, -ex / L]; // inward normal
            return { a, n };
        });
        const dist = (x, y) => {
            let d = Infinity;
            for (const e of edges) d = Math.min(d, (x - e.a[0]) * e.n[0] + (y - e.a[1]) * e.n[1]);
            return d;
        };
        return {
            type: 'polygon', verts,
            inside: (x, y) => dist(x, y) >= -EPS,
            dist,
            clipSeg(ax, ay, bx, by) {
                let t0 = 0, t1 = 1;
                const dx = bx - ax, dy = by - ay;
                for (const e of edges) {
                    const num = (ax - e.a[0]) * e.n[0] + (ay - e.a[1]) * e.n[1] + EPS;
                    const den = dx * e.n[0] + dy * e.n[1];
                    if (den === 0) { if (num < 0) return null; continue; }
                    const t = -num / den;
                    if (den > 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; }
                    if (t0 > t1) return null;
                }
                return [t0, t1];
            },
            outline: () => geo.close(verts),
        };
    };

    // Build the drawing-area shape in paper coordinates.
    PG.makeShape = function (kind, x, y, w, h) {
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
        switch (kind) {
            case 'circle': return shapes.circle(cx, cy, r);
            case 'hexagon': return shapes.polygon(geo.ngon(cx, cy, r, 6, Math.PI / 6).map(p => [p[0], p[1]]));
            case 'diamond': return shapes.polygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]]);
            default: return shapes.rect(x, y, x + w, y + h);
        }
    };

    // Clip polylines to a shape; segments leaving and re-entering split the path.
    PG.clipPaths = function (paths, shape) {
        const out = [];
        for (const path of paths) {
            if (path.length < 2) continue;
            let cur = null;
            let prevInside = shape.inside(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                const a = path[i - 1], b = path[i];
                const bInside = shape.inside(b[0], b[1]);
                if (prevInside && bInside) {
                    if (!cur) { cur = [a]; out.push(cur); }
                    cur.push(b);
                } else {
                    const t = shape.clipSeg(a[0], a[1], b[0], b[1]);
                    if (!t || t[1] - t[0] < 1e-9) { cur = null; }
                    else {
                        const p0 = t[0] <= 0 ? a : [a[0] + (b[0] - a[0]) * t[0], a[1] + (b[1] - a[1]) * t[0]];
                        const p1 = t[1] >= 1 ? b : [a[0] + (b[0] - a[0]) * t[1], a[1] + (b[1] - a[1]) * t[1]];
                        if (!cur || t[0] > 0) { cur = [p0]; out.push(cur); }
                        cur.push(p1);
                        if (t[1] < 1) cur = null;
                    }
                }
                prevInside = bInside;
            }
        }
        return out.filter(p => p.length > 1);
    };

    // Normalise generator output to [{ pen, paths }], one entry per used pen.
    PG.normalizeOutput = function (out) {
        let layers;
        if (!out) layers = [];
        else if (Array.isArray(out)) layers = [out];
        else layers = out.layers || [];
        const byPen = [];
        layers.forEach((l, i) => {
            const pen = (l && l.pen !== undefined ? l.pen : i) % PG.MAX_PENS;
            const paths = Array.isArray(l) ? l : l.paths || [];
            (byPen[pen] || (byPen[pen] = [])).push(...paths);
        });
        const res = [];
        byPen.forEach((paths, pen) => {
            if (!paths) return;
            const clean = [];
            for (const p of paths) {
                if (!p || p.length < 2) continue;
                let ok = true;
                for (const q of p) if (!isFinite(q[0]) || !isFinite(q[1])) { ok = false; break; }
                if (ok) clean.push(p);
            }
            res.push({ pen, paths: clean });
        });
        return res;
    };

    // Generate one design into the rectangle (x, y, w, h) of the paper: place it
    // (fit / rotate / scale / offset), clip it to the crop shape and add the frame.
    function placeCell(def, params, S, extra, x, y, w, h, seed) {
        const shape = PG.makeShape(S.clip, x, y, w, h);
        const rot = geo.rad(S.rotate || 0);
        const scale = (S.scale || 100) / 100;
        const cxA = x + w / 2 + (S.offsetX || 0), cyA = y + h / 2 + (S.offsetY || 0);

        // Fill generators with rotation get a larger canvas so the rotated
        // canvas still covers the whole cell.
        let gw = w, gh = h;
        if (!def.fit && rot) {
            const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
            gw = w * c + h * s; gh = w * s + h * c;
        }
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const toPaper = (px, py) => {
            const u = (px - gw / 2) * scale, v = (py - gh / 2) * scale;
            return [cxA + u * cosR - v * sinR, cyA + u * sinR + v * cosR];
        };
        const fromPaper = (X, Y) => {
            const u = (X - cxA) / scale, v = (Y - cyA) / scale;
            return [gw / 2 + u * cosR + v * sinR, gh / 2 - u * sinR + v * cosR];
        };
        // The visible region as a convex polygon in generator coordinates
        // (circles become a circumscribed 180-gon; the pipeline trims the rest).
        let regionPoly = null;
        const region = () => {
            if (regionPoly) return regionPoly;
            let verts;
            if (shape.type === 'circle') {
                verts = geo.ngon(shape.cx, shape.cy, shape.r / Math.cos(Math.PI / 180), 180);
            } else if (shape.type === 'rect') {
                verts = [[shape.x0, shape.y0], [shape.x1, shape.y0], [shape.x1, shape.y1], [shape.x0, shape.y1]];
            } else {
                verts = shape.verts;
            }
            let poly = verts.map(v => fromPaper(v[0], v[1]));
            for (const [p, n] of [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[gw, gh], [-1, 0]], [[gw, gh], [0, -1]]]) {
                poly = geo.clipPolygonHalfPlane(poly, p, n);
            }
            poly = geo.cleanPolygon(poly);
            regionPoly = poly.length ? poly : [[0, 0], [gw, 0], [gw, gh], [0, gh]];
            return regionPoly;
        };
        const ctx = {
            width: gw, height: gh, seed,
            rng: new PG.RNG(seed),
            noise: PG.makeNoise(new PG.RNG(seed ^ 0x5bd1e995)),
            shape: {
                dist: (px, py) => { const p = toPaper(px, py); return shape.dist(p[0], p[1]) / scale; },
                inside: (px, py) => { const p = toPaper(px, py); return shape.inside(p[0], p[1]); },
                polygon: region,
                kind: S.clip || 'rect',
            },
            images: extra.images || {},
        };

        const t0 = performance.now();
        let layers = PG.normalizeOutput(def.generate(params, ctx));
        const genMs = performance.now() - t0;

        if (def.fit) {
            // rotate about the origin, then fit the bbox into the cell (or its inscribed square for round crops)
            const rotated = rot ? layers.map(l => ({ pen: l.pen, paths: geo.rotatePaths(l.paths, rot) })) : layers;
            const bb = geo.bbox(rotated.flatMap(l => l.paths));
            const square = S.clip && S.clip !== 'rect';
            const fw = square ? Math.min(w, h) : w, fh = square ? Math.min(w, h) : h;
            const k = bb.w > 0 || bb.h > 0 ? Math.min(fw / (bb.w || 1e-9), fh / (bb.h || 1e-9)) * scale : 1;
            const bx = (bb.minX + bb.maxX) / 2, by = (bb.minY + bb.maxY) / 2;
            layers = rotated.map(l => ({
                pen: l.pen,
                paths: l.paths.map(p => p.map(q => [cxA + (q[0] - bx) * k, cyA + (q[1] - by) * k])),
            }));
        } else {
            layers = layers.map(l => ({ pen: l.pen, paths: l.paths.map(p => p.map(q => toPaper(q[0], q[1]))) }));
        }

        // never draw outside the cell
        layers = layers.map(l => ({ pen: l.pen, paths: PG.clipPaths(l.paths, shape) }));

        if (S.frame) {
            const fp = (S.framePen || 0) % PG.MAX_PENS;
            let layer = layers.find(l => l.pen === fp);
            if (!layer) { layer = { pen: fp, paths: [] }; layers.push(layer); }
            layer.paths.push(shape.outline());
            const inset = S.frameInset || 0;
            if (inset > 0 && inset * 2 < Math.min(w, h)) {
                layer.paths.push(PG.makeShape(S.clip, x + inset, y + inset, w - 2 * inset, h - 2 * inset).outline());
            }
        }
        return { layers, shape, genMs };
    }

    // Parameters for grid cell t (0..1) when sweeping a range parameter across the grid.
    function sweepParams(def, params, sweep, t) {
        if (!sweep || !sweep.id || !sweep.amount) return params;
        const q = def.params.find(p => p.id === sweep.id && p.type === 'range');
        if (!q) return params;
        const v = params[q.id] + t * sweep.amount * (q.max - q.min);
        return Object.assign({}, params, { [q.id]: PG.snap(geo.clamp(v, q.min, q.max), q.step || 1, q.min) });
    }

    // ------------------------------------------------------------------
    // Run everything.
    //
    // S = {
    //   seed, paperW, paperH, margin,
    //   scale (%), rotate (deg), offsetX, offsetY (mm), clip: 'rect'|'circle'|'hexagon'|'diamond',
    //   frame, framePen, frameInset,
    //   cols, rows, gutter (mm), sweep: { id, amount (-1..1) },               (grid layouts)
    //   cellVary: 'seed' | 'params' | 'none', locks: [param ids kept when varying params]
    //   opt: { merge, mergeTol, sort, simplify, simplifyTol, minLength }
    // }
    // extra: { images } – non-serialisable inputs handed to the generator.
    // ------------------------------------------------------------------
    PG.run = function (def, params, S, extra = {}) {
        const T0 = performance.now();
        const m = S.margin;
        const W = Math.max(1, S.paperW - 2 * m), H = Math.max(1, S.paperH - 2 * m);
        const cols = Math.max(1, S.cols | 0 || 1), rows = Math.max(1, S.rows | 0 || 1);
        const n = cols * rows;
        const gut = n > 1 ? Math.max(0, S.gutter || 0) : 0;
        const cw = Math.max(1, (W - gut * (cols - 1)) / cols), ch = Math.max(1, (H - gut * (rows - 1)) / rows);

        const byPen = new Map();
        const outlines = [];
        let genMs = 0;
        const vary = n > 1 ? S.cellVary || 'seed' : 'none';
        for (let k = 0; k < n; k++) {
            const r = Math.floor(k / cols), c = k % cols;
            const seed = ((S.seed | 0) + (vary === 'none' ? 0 : k)) | 0;
            let p = params;
            if (vary === 'params' && k > 0) {
                // every cell but the first gets its own random parameters; locked ones stay put
                p = PG.randomParams(def, params, new PG.RNG(seed * 7919 + k));
                for (const id of S.locks || []) p[id] = params[id];
            }
            if (n > 1) p = sweepParams(def, p, S.sweep, k / (n - 1));
            const cell = placeCell(def, p, S, extra, m + c * (cw + gut), m + r * (ch + gut), cw, ch, seed);
            genMs += cell.genMs;
            outlines.push(cell.shape.outline());
            for (const l of cell.layers) {
                if (!byPen.has(l.pen)) byPen.set(l.pen, []);
                byPen.get(l.pen).push(...l.paths);
            }
        }
        let layers = [...byPen.entries()].sort((a, b) => a[0] - b[0]).map(([pen, paths]) => ({ pen, paths }));

        const T3 = performance.now();
        const rawStats = PG.optimize.stats(layers);

        // ---- optimise
        const o = S.opt || {};
        const O = PG.optimize;
        layers = layers.map(l => {
            let paths = l.paths;
            paths = paths.map(p => O.dedupe(p, 0.001));
            if (o.simplify) paths = paths.map(p => O.simplify(p, o.simplifyTol || 0.02));
            if (o.merge) paths = O.merge(paths, o.mergeTol || 0.1);
            if (o.minLength > 0) paths = paths.filter(p => geo.pathLength(p) >= o.minLength);
            paths = paths.filter(p => p.length > 1);
            if (o.sort) {
                // greedy ordering usually wins, but keep the generator's order when it's already better
                const sorted = O.sort(paths, [0, 0], true).paths;
                const travel = ps => O.stats([{ paths: ps }]).travel;
                if (travel(sorted) < travel(paths)) paths = sorted;
            }
            return { pen: l.pen, paths };
        }).filter(l => l.paths.length);

        const stats = PG.optimize.stats(layers);
        const T4 = performance.now();
        return {
            layers, stats, rawStats, outlines,
            area: { x: m, y: m, w: W, h: H },
            timing: { generate: genMs, place: T3 - T0 - genMs, optimize: T4 - T3, total: T4 - T0 },
        };
    };
})();
