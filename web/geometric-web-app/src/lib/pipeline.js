/*
 * Pipeline: run a generator, place its output on the paper (fit / rotate /
 * offset), clip to the drawing area, optionally frame it, then optimize the
 * pen path per layer and collect statistics.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const geo = PG.geo;

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

    // Normalize generator output to [{ pen, paths }], one entry per used pen.
    PG.normalizeOutput = function (out) {
        let layers;
        if (!out) layers = [];
        else if (Array.isArray(out)) layers = [out];
        else layers = out.layers || [];
        const byPen = [];
        layers.forEach((l, i) => {
            const pen = (l && l.pen !== undefined ? l.pen : i) % PG.MAX_PENS;
            const paths = Array.isArray(l) ? l : l.paths || [];
            const into = byPen[pen] || (byPen[pen] = []);
            for (const p of paths) into.push(p); // not push(...paths): huge outputs overflow the stack
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
    // (fit / rotate / scale / offset), clip it to the crop shape and add the frame. With `area`
    // the design goes in a region of another layer instead (area.shape, from
    // PG.stack.regionShape). With wantRegions the design's own regions come back too, placed
    // like its lines.
    function placeCell(def, params, S, extra, x, y, w, h, seed, area, wantRegions) {
        if (PG.wrapped(S)) return placeWrapped(def, params, S, extra, x, y, w, h, seed, area, wantRegions);
        const shape = area ? area.shape : PG.makeShape(S.clip, x, y, w, h);
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
                // a concave region gives designs its hull, and the clip below trims the rest
                verts = shape.hull || shape.verts;
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
                kind: area ? shape.kind : S.clip || 'rect',
            },
            images: extra.images || {},
        };
        if (wantRegions) ctx.wantRegions = true;
        if (S.strip) ctx.wrap = S.strip;

        const t0 = performance.now();
        const raw = def.generate(params, ctx);
        let layers = PG.normalizeOutput(PG.pens.apply(def, raw, params));
        const genMs = performance.now() - t0;
        let regions = wantRegions && raw && !Array.isArray(raw) && Array.isArray(raw.regions) ? raw.regions : null;

        if (def.fit) {
            // rotate about the origin, then fit the bbox into the cell (or its inscribed square for round crops)
            const rotated = rot ? layers.map(l => ({ pen: l.pen, paths: geo.rotatePaths(l.paths, rot) })) : layers;
            const bb = geo.bbox(rotated.flatMap(l => l.paths));
            let k, bx = (bb.minX + bb.maxX) / 2, by = (bb.minY + bb.maxY) / 2, cx = cxA, cy = cyA;
            if (area && shape.fitCircle) {
                // in a region: the drawing's bounding circle fills the largest circle the region holds
                let R = 0;
                for (const l of rotated) for (const p of l.paths) for (const q of p) R = Math.max(R, (q[0] - bx) ** 2 + (q[1] - by) ** 2);
                R = Math.sqrt(R);
                k = R > 0 ? (shape.fitCircle[2] / R) * scale : 1;
                cx = shape.fitCircle[0] + (S.offsetX || 0);
                cy = shape.fitCircle[1] + (S.offsetY || 0);
            } else {
                const square = !area && S.clip && S.clip !== 'rect';
                const fw = square ? Math.min(w, h) : w, fh = square ? Math.min(w, h) : h;
                k = bb.w > 0 || bb.h > 0 ? Math.min(fw / (bb.w || 1e-9), fh / (bb.h || 1e-9)) * scale : 1;
            }
            layers = rotated.map(l => ({
                pen: l.pen,
                paths: l.paths.map(p => p.map(q => [cx + (q[0] - bx) * k, cy + (q[1] - by) * k])),
            }));
            if (regions) {
                const cs = Math.cos(rot), sn = Math.sin(rot);
                regions = regions.map(r => PG.stack.mapRegion(r, (u, v) => {
                    const ru = rot ? u * cs - v * sn : u, rv = rot ? u * sn + v * cs : v;
                    return [cx + (ru - bx) * k, cy + (rv - by) * k];
                }, k));
            }
        } else {
            layers = layers.map(l => ({ pen: l.pen, paths: l.paths.map(p => p.map(q => toPaper(q[0], q[1]))) }));
            if (regions) regions = regions.map(r => PG.stack.mapRegion(r, toPaper, scale));
        }

        // never draw outside the cell
        layers = layers.map(l => ({ pen: l.pen, paths: shape.clipPaths ? shape.clipPaths(l.paths) : PG.clipPaths(l.paths, shape) }));
        if (regions) regions = regions.map(r => PG.stack.clipRegion(r, shape)).filter(Boolean);

        // a layer can put everything it draws on one pen; its frame keeps the frame pen
        if (S.pen >= 0 && layers.length) layers = [{ pen: S.pen % PG.MAX_PENS, paths: layers.flatMap(l => l.paths) }];

        if (S.frame) {
            const fp = (S.framePen || 0) % PG.MAX_PENS;
            let layer = layers.find(l => l.pen === fp);
            if (!layer) { layer = { pen: fp, paths: [] }; layers.push(layer); }
            // a region within a concave one of the layer below only outlines what's inside both
            const rings = s => (s.frameLines ? s.frameLines() : [s.outline()]).filter(ring => ring.length > 1);
            for (const ring of rings(shape)) layer.paths.push(ring);
            const inset = S.frameInset || 0;
            if (area) {
                const inner = inset > 0 && PG.stack.inset(shape.region, inset);
                if (inner) for (const ring of rings(PG.stack.regionShape(inner))) layer.paths.push(ring);
            } else if (inset > 0 && inset * 2 < Math.min(w, h)) {
                layer.paths.push(PG.makeShape(S.clip, x + inset, y + inset, w - 2 * inset, h - 2 * inset).outline());
            }
        }
        return { layers, shape, genMs, regions };
    }

    // ------------------------------------------------------------------
    // Wrap. 'polar' bends a design round a center: across it becomes the angle, clockwise from
    // the left end, and down it the distance from the center, its top on the outside.
    // 'kaleido' does the same in wedges with every other one mirrored, so they meet without
    // a seam. The design is drawn into a strip as long as the middle circle of the ring (or of
    // one wedge) and as deep as the ring, so it keeps its proportions halfway out and its sizes
    // in millimeters, like line spacing, hold there. Scale, rotation, and offset then move the
    // whole ring, and the ring is the crop.
    // ------------------------------------------------------------------
    PG.wrapped = S => !!S && (S.wrap === 'polar' || S.wrap === 'kaleido');

    function wrapOf(S) {
        const kaleido = S.wrap === 'kaleido';
        const deg = geo.clamp(+(S.arc ?? 360) || 360, 30, 360), arc = geo.rad(deg);
        // wedges come in mirrored pairs
        const n = kaleido ? 2 * geo.clamp(Math.ceil((S.segments ?? 8) / 2) || 1, 1, 12) : geo.clamp(S.repeats | 0 || 1, 1, 24);
        // a glue tab only goes on a fan's frame
        const tab = S.frame && deg < 360 ? geo.clamp(+S.tab || 0, 0, 20) : 0;
        return { kaleido, deg, arc, n, tab, inner: geo.clamp(+(S.inner ?? 40) || 0, 0, 90) / 100, a0: geo.rad(S.rotate || 0) - arc / 2 };
    }

    // A wrapped layer with an inner radius offers its empty center to the layers drawn in it,
    // as a shape of kind 'center' next to the design's own
    PG.hasCenter = S => PG.wrapped(S) && wrapOf(S).inner > 0;

    // Points that bound the ring of radius 1 (and inner radius f) from angle a0 through arc:
    // the ends of both arcs, where the arcs face straight up, down, or sideways, and the center
    // of a pie.
    function sectorPoints(a0, arc, f) {
        const pts = [], at = (r, a) => pts.push([r * Math.sin(a), -r * Math.cos(a)]);
        for (const r of f > 0 ? [1, f] : [1]) {
            at(r, a0);
            at(r, a0 + arc);
            for (let k = Math.ceil(a0 / (Math.PI / 2)); (k * Math.PI) / 2 <= a0 + arc; k++) at(r, (k * Math.PI) / 2);
        }
        if (!(f > 0)) pts.push([0, 0]);
        return pts;
    }

    // Center and radii of the ring in the box (x, y, w, h), or in the largest circle of a region:
    // as big as fits at Scale 100%, then scaled about the middle and offset. R is the outer radius
    // at 100%, which sizes the strip.
    function ringIn(W, S, x, y, w, h, area) {
        const pts = sectorPoints(W.a0, W.arc, W.inner);
        let b = geo.bbox([pts]), mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
        let R, bx, by;
        if (!area && W.tab > 0) {
            // the glue tab is in millimeters, so its size against the fan depends on the fit
            R = Math.min(w / b.w, h / b.h);
            for (let i = 0; i < 6; i++) {
                b = geo.bbox([pts.concat(glueTab(W, 0, 0, W.inner, 1, W.tab / R))]);
                R = Math.min(w / b.w, h / b.h);
            }
            mx = (b.minX + b.maxX) / 2;
            my = (b.minY + b.maxY) / 2;
            bx = x + w / 2;
            by = y + h / 2;
        } else if (area && area.shape.fitCircle) {
            let far = 0;
            for (const q of pts) far = Math.max(far, Math.hypot(q[0] - mx, q[1] - my));
            for (const r of [1, W.inner]) {
                for (let i = 0; i <= 96; i++) {
                    const a = W.a0 + (W.arc * i) / 96;
                    far = Math.max(far, Math.hypot(r * Math.sin(a) - mx, -r * Math.cos(a) - my));
                }
            }
            [bx, by] = area.shape.fitCircle;
            R = area.shape.fitCircle[2] / far;
        } else {
            R = Math.min(w / b.w, h / b.h);
            bx = x + w / 2;
            by = y + h / 2;
        }
        const k = (S.scale || 100) / 100;
        return { R, r1: R * k, r0: R * k * W.inner, cx: bx - mx * R * k + (S.offsetX || 0), cy: by - my * R * k + (S.offsetY || 0) };
    }

    // The glue tab of a fan: a flap t mm wide along its last straight edge, outside it, from
    // radius r0 to r1 round (cx, cy), with its ends cut at 45 degrees. An open path, since the
    // fan's outline closes it along the fold.
    function glueTab(W, cx, cy, r0, r1, t) {
        const a = W.a0 + W.arc, c = Math.min(t, (r1 - r0) / 2);
        const at = (r, d) => [cx + r * Math.sin(a) + d * Math.cos(a), cy - r * Math.cos(a) + d * Math.sin(a)];
        return [at(r0, 0), at(r0 + c, t), at(r1 - c, t), at(r1, 0)];
    }

    // A box (x, y, w, h) reaching past a rect shape or another box
    function outside(b, c) {
        const [x0, y0, x1, y1] = c.box ? [c.box.x, c.box.y, c.box.x + c.box.w, c.box.y + c.box.h] : [c.x0, c.y0, c.x1, c.y1];
        return b.x < x0 - 0.05 || b.y < y0 - 0.05 || b.x + b.w > x1 + 0.05 || b.y + b.h > y1 + 0.05;
    }

    // Bends paths from the strip (0..SW across, 0..T down) into wedge k of the ring. Segments are
    // split so the curve they become stays within 0.01 mm of its chords.
    function bender(W, ring, SW, T) {
        const { cx, cy, r0, r1 } = ring, wedge = W.arc / W.n;
        const radius = v => r1 - (v / T) * (r1 - r0);
        return (path, k) => {
            const flip = W.kaleido && k % 2 === 1, base = W.a0 + k * wedge;
            const pt = (u, v) => {
                const a = base + (flip ? 1 - u / SW : u / SW) * wedge, r = radius(v);
                return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
            };
            const out = [pt(path[0][0], path[0][1])];
            for (let i = 1; i < path.length; i++) {
                const x0 = path[i - 1][0], y0 = path[i - 1][1], x1 = path[i][0], y1 = path[i][1];
                const turn = (Math.abs(x1 - x0) / SW) * wedge, r = Math.max(radius(y0), radius(y1));
                const n = turn > 0 && r > 0 ? Math.min(2000, Math.ceil(turn / Math.sqrt(0.08 / r))) : 1;
                for (let j = 1; j <= n; j++) out.push(pt(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n));
            }
            return out;
        };
    }

    function placeWrapped(def, params, S, extra, x, y, w, h, seed, area, wantRegions) {
        const W = wrapOf(S);
        const clip = area ? area.shape : PG.makeShape('rect', x, y, w, h);
        const ring = ringIn(W, S, x, y, w, h, area);
        const shape = PG.stack.ringShape(ring.cx, ring.cy, ring.r0, ring.r1, W.a0, W.arc, clip);
        const T = ring.R * (1 - W.inner), SW = (W.arc / W.n) * ring.R * ((1 + W.inner) / 2);
        // For the notes about the ring: its size, whether the crop cuts it, and how much of the
        // strip across the design covers (one object in the middle covers little of it)
        const tab = W.tab > 0 && !area ? glueTab(W, ring.cx, ring.cy, ring.r0, ring.r1, W.tab) : null;
        const tb = tab && geo.bbox([tab]), box = tb ? { x: Math.min(shape.box.x, tb.minX), y: Math.min(shape.box.y, tb.minY) } : shape.box;
        if (tb) Object.assign(box, { w: Math.max(shape.box.x + shape.box.w, tb.maxX) - box.x, h: Math.max(shape.box.y + shape.box.h, tb.maxY) - box.y });
        const info = { r0: ring.r0, r1: ring.r1, arc: W.deg, strip: [SW, T], cut: outside(box, clip), cover: 0 };
        if (!(T > 0.05 && SW > 0.05)) return { layers: [], shape, genMs: 0, regions: wantRegions ? [] : null, ring: info };

        // ctx.wrap tells the design it's in a strip, and the page it would otherwise fill, so
        // designs that size themselves to the page don't zoom out to fit a thin strip
        const flat = Object.assign({}, S, { wrap: 'none', scale: 100, rotate: 0, offsetX: 0, offsetY: 0, clip: 'rect', frame: false, pen: -1, strip: { page: [w, h] } });
        const strip = placeCell(def, params, flat, extra, 0, 0, SW, T, seed, null, wantRegions && !!def.regionKinds);
        let x0 = Infinity, x1 = -Infinity;
        for (const l of strip.layers) for (const p of l.paths) for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; }
        info.cover = x1 > x0 ? Math.min(1, (x1 - x0) / SW) : 0;
        const bend = bender(W, ring, SW, T);
        const ks = Array.from({ length: W.n }, (_, k) => k);
        let layers = strip.layers.map(l => ({ pen: l.pen, paths: ks.flatMap(k => l.paths.map(p => bend(p, k))) }));
        let regions = null;
        if (wantRegions) {
            regions = [];
            // the center first, so its seed stays put when the design's own shapes change
            if (ring.r0 > 1e-6) {
                regions.push(W.arc >= PG.TAU - 1e-9 ? { circle: [ring.cx, ring.cy, ring.r0], kind: 'center' }
                    : { poly: [[ring.cx, ring.cy], ...geo.arc(ring.cx, ring.cy, ring.r0, W.a0 - Math.PI / 2, W.a0 + W.arc - Math.PI / 2, 0, 0.01)], kind: 'center' });
            }
            for (const k of ks) {
                for (const r of strip.regions || []) {
                    const poly = r.circle ? geo.ngon(r.circle[0], r.circle[1], r.circle[2], Math.max(12, Math.min(64, Math.ceil(r.circle[2] * 3)))) : r.poly;
                    const bent = bend([...poly, poly[0]], k);
                    bent.pop();
                    regions.push({ poly: bent, kind: r.kind });
                }
            }
        }

        layers = layers.map(l => ({ pen: l.pen, paths: clip.clipPaths ? clip.clipPaths(l.paths) : PG.clipPaths(l.paths, clip) }));
        if (regions) regions = regions.map(r => PG.stack.clipRegion(r, clip)).filter(Boolean);
        if (S.pen >= 0 && layers.length) layers = [{ pen: S.pen % PG.MAX_PENS, paths: layers.flatMap(l => l.paths) }];
        if (S.frame) {
            const fp = (S.framePen || 0) % PG.MAX_PENS;
            let layer = layers.find(l => l.pen === fp);
            if (!layer) { layer = { pen: fp, paths: [] }; layers.push(layer); }
            const add = paths => { for (const p of paths) if (p.length > 1) layer.paths.push(p); };
            if (area) {
                // in the shapes of another layer the frame outlines each shape, as it does unwrapped
                const rings = s => (s.frameLines ? s.frameLines() : [s.outline()]);
                add(rings(clip));
                const inner = S.frameInset > 0 && PG.stack.inset(clip.region, S.frameInset);
                if (inner) add(rings(PG.stack.regionShape(inner)));
            } else {
                add(shape.frameLines());
                if (S.frameInset > 0) add(shape.frameInset(S.frameInset));
                if (tab) add(clip.clipPaths ? clip.clipPaths([tab]) : PG.clipPaths([tab], clip));
            }
        }
        return { layers, shape, genMs: strip.genMs, regions, ring: info };
    }

    // ------------------------------------------------------------------
    // Layers. The design in the main settings is the bottom layer, S.layers go on top of it in
    // order. Each has its own design, parameters, seed and placement (layer.comp), and can:
    //   - fill only part of the drawing area: comp.size (%) and comp.posX / posY (mm)
    //   - draw in the regions of a lower layer (comp.inside, its index), one copy per region
    //   - cover the layers below it (comp.cover): 'lines' leaves a gap of comp.gap mm along its
    //     lines, 'outline' also hides everything its lines enclose, 'area' hides its whole area
    //     (or each region)
    //   - draw everything on one pen (comp.pen), or be hidden (comp.hidden). A hidden layer's
    //     regions still hold the layers drawn in them.
    // ------------------------------------------------------------------
    PG.MAX_LAYERS = 6;
    // Designs that take long to generate fill fewer regions, the largest ones, so a sheet of them
    // still generates in a few seconds. Tiers from the time each design takes in a 30 mm circle.
    const REGION_CAPS = [
        [120, ['superformula', 'guilloche', 'attractor', 'wireframe', 'voronoi', 'cosmic', 'radiolaria', 'exploded', 'stairwell', 'fairground']],
        [80, ['ribbons', 'tidal', 'stadium', 'temple']],
        [40, ['blackhole', 'castle', 'farmland']],
        [24, ['moonbase', 'alpine']],
    ];
    const regionCap = def => (REGION_CAPS.find(([, ids]) => ids.includes(def.id)) || [def.category === 'Scenes' ? 120 : 400])[0];

    function layerStack(def, params, S, extra) {
        const base = { def, params, seed: S.seed | 0, place: S, locks: S.locks || [], extra, cover: 'none', inside: -1, hidden: !!S.hidden };
        const stack = [base];
        (S.layers || []).slice(0, PG.MAX_LAYERS - 1).forEach((L, i) => {
            const d = PG.byId[L.gen];
            if (!d) throw new Error(`Unknown design in layer ${i + 2}`);
            const p = Object.assign(PG.defaultParams(d), PG.pens.migrate(d, { ...L.params }));
            p.pens = PG.pens.count(p.pens);
            const c = L.comp || {};
            const at = i + 1;
            stack.push({
                def: d, params: p, seed: L.seed | 0, place: c, locks: L.locks || [],
                extra: { images: (extra.layerImages && extra.layerImages[i]) || {} },
                cover: at > 0 ? c.cover || 'none' : 'none', gap: Math.max(0, c.gap ?? 1),
                inside: Number.isInteger(c.inside) && c.inside >= 0 && c.inside < at ? c.inside : -1,
                which: c.shapes || 'all', inset: Math.max(0, c.inset ?? 1.5), min: Math.max(0, c.minShape ?? 8), vary: c.shapeVary || 'seed',
                hidden: !!c.hidden,
            });
        });
        // regions are only placed for layers another layer draws in
        for (const e of stack) if (e.inside >= 0) stack[e.inside].wanted = true;
        return stack;
    }

    // The rectangle a layer fills within the cell: the whole cell, or a smaller one of the same
    // proportions moved by posX / posY.
    function areaOf(P, x, y, w, h) {
        const s = P.size;
        if (!(s > 0 && s < 100)) return null;
        const k = s / 100, aw = w * k, ah = h * k;
        return { x: x + (w - aw) / 2 + (P.posX || 0), y: y + (h - ah) / 2 + (P.posY || 0), w: aw, h: ah };
    }

    // One cell of the sheet: every layer from the bottom up, each covering the ones below it.
    function runCell(stack, x, y, w, h, info) {
        const outs = [], outlines = [];
        let genMs = 0;
        const cellRect = shapes.rect(x, y, x + w, y + h);
        stack.forEach((e, i) => {
            const host = e.inside >= 0 ? outs[e.inside] : null;
            let out;
            if (host && host.regions && host.regions.length) {
                // A kind the layer below no longer names (its settings changed) means all of them
                const below = stack[e.inside], kinds = below.def.regionKinds ? below.def.regionKinds(below.params) || [] : [];
                const which = /^kind:/.test(e.which) && +e.which.slice(5) >= kinds.length ? 'all' : e.which;
                const { picked, found } = PG.stack.pick(host.regions, { which, inset: e.inset, min: e.min, max: regionCap(e.def) });
                info[i].regions += host.regions.length;
                info[i].shapes += found;
                info[i].used += picked.length;
                const byPen = new Map(), regions = [], covers = [];
                // Covering reaches the clearance out from where this layer draws, but stops short of
                // the region's outline, which is usually a line of the layer below
                const reach = Math.max(0.3, e.inset - Math.max(0.2, e.gap));
                for (const { shape, index, region } of picked) {
                    const seed = e.vary === 'none' ? e.seed : (e.seed + index) | 0;
                    let p = e.params;
                    if (e.vary === 'params' && index > 0) p = PG.randomParams(e.def, e.params, new PG.RNG(seed * 7919 + index), e.locks);
                    const b = shape.box;
                    const cell = placeCell(e.def, p, e.place, e.extra, b.x, b.y, b.w, b.h, seed, { shape }, e.wanted);
                    genMs += cell.genMs;
                    for (const l of cell.layers) {
                        if (!byPen.has(l.pen)) byPen.set(l.pen, []);
                        const into = byPen.get(l.pen);
                        for (const path of l.paths) into.push(path);
                    }
                    if (cell.regions) for (const r of cell.regions) regions.push(r);
                    if (e.cover === 'area') {
                        // a wrapped layer covers its ring, and leaves the rest of the shape and the hole
                        const solid = !PG.wrapped(e.place) && PG.stack.inset(region, reach);
                        if (PG.wrapped(e.place)) covers.push([cell.shape, Math.max(0.2, Math.min(e.gap, e.inset - 0.2))]);
                        else if (solid) covers.push([PG.stack.regionShape(solid), 0]);
                    }
                }
                out = { layers: [...byPen].map(([pen, paths]) => ({ pen, paths })), regions, covers };
            } else if (e.inside >= 0) {
                // the layer it draws in has no regions here, so there is nothing to draw in
                info[i].noShapes = true;
                out = { layers: [], regions: e.wanted ? [] : null, covers: [] };
            } else {
                const a = areaOf(e.place, x, y, w, h);
                const cell = a ? placeCell(e.def, e.params, e.place, e.extra, a.x, a.y, a.w, a.h, e.seed, null, e.wanted)
                    : placeCell(e.def, e.params, e.place, e.extra, x, y, w, h, e.seed, null, e.wanted);
                genMs += cell.genMs;
                let layers = cell.layers, regions = cell.regions;
                if (a) {
                    // a moved area can run past the cell, which still bounds everything
                    layers = layers.map(l => ({ pen: l.pen, paths: PG.clipPaths(l.paths, cellRect) }));
                    if (regions) regions = regions.map(r => PG.stack.clipRegion(r, cellRect)).filter(Boolean);
                    if (cell.ring && outside(cell.shape.box, cellRect)) cell.ring.cut = true;
                }
                // the outline of this layer's area, unless it's the same as the bottom layer's
                const crop = P => (PG.wrapped(P) ? 'wrap' : P.clip || 'rect');
                if (i === 0 || a || PG.wrapped(e.place) || crop(e.place) !== crop(stack[0].place)) {
                    for (const o of cell.shape.outlines ? cell.shape.outlines() : [cell.shape.outline()]) outlines.push(o);
                }
                if (cell.ring && !info[i].ring) info[i].ring = cell.ring;
                out = { layers, regions, covers: [[cell.shape, Math.max(0.2, e.gap)]] };
            }
            if (!e.hidden && i > 0 && e.cover !== 'none') {
                const cover = PG.stack.cover();
                const lines = out.layers.flatMap(l => l.paths);
                const gap = Math.max(0.2, e.gap);
                if (e.cover === 'area') for (const [s, g] of out.covers) cover.area(s, g);
                else {
                    if (e.cover === 'outline') cover.enclosed(lines);
                    cover.lines(lines, gap);
                }
                for (let j = 0; j < i; j++) {
                    if (stack[j].hidden) continue;
                    outs[j].layers = outs[j].layers.map(l => ({ pen: l.pen, paths: cover.cut(l.paths) }));
                }
            }
            outs.push(out);
        });
        return { layers: outs.filter((o, i) => !stack[i].hidden).flatMap(o => o.layers), outlines, genMs };
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
    //   frame, framePen, frameInset, size (%), posX, posY (mm), pen, hidden,  (the bottom layer)
    //   layers: [{ gen, params, seed, comp, locks }]                           (layers on top, see layerStack)
    //   cols, rows, gutter (mm), sweep: { id, amount (-1..1), layer },        (grid layouts)
    //   cellVary: 'seed' | 'params' | 'none', locks: [param ids kept when varying params]
    //   opt: { merge, mergeTol, sort, simplify, simplifyTol, minLength, overlap, overlapPct, overlapMin },
    //   penWidths: [mm per pen]                                                (overlap removal)
    // }
    // extra: { images, layerImages }, the non-serializable inputs handed to the generators.
    // ------------------------------------------------------------------
    PG.layoutSizes = function (S) {
        if (!Number.isFinite(S.paperW) || !Number.isFinite(S.paperH) || S.paperW < 1 || S.paperH < 1) {
            throw new Error('Invalid paper dimensions');
        }
        const m = Math.max(0, Math.min(S.margin, Math.min(S.paperW, S.paperH) / 2 - 0.5));
        const W = Math.max(1, S.paperW - 2 * m), H = Math.max(1, S.paperH - 2 * m);
        const cols = Math.min(8, Math.floor(W), Math.max(1, S.cols | 0 || 1));
        const rows = Math.min(10, Math.floor(H), Math.max(1, S.rows | 0 || 1));
        // Reserve at least 1 mm for each cell. Round the limit down to a UI gutter step.
        const limit = Math.max(0, Math.min(cols > 1 ? (W - cols) / (cols - 1) : 40,
            rows > 1 ? (H - rows) / (rows - 1) : 40));
        const gutter = Math.min(Math.max(0, S.gutter || 0), Math.floor((limit + 1e-9) * 2) / 2);
        const gut = cols * rows > 1 ? gutter : 0;
        return { m, W, H, cols, rows, gutter, gut, cw: (W - gut * (cols - 1)) / cols, ch: (H - gut * (rows - 1)) / rows };
    };

    PG.run = function (def, params, S, extra = {}) {
        params = Object.assign(PG.defaultParams(def), PG.pens.migrate(def, { ...params }));
        params.pens = PG.pens.count(params.pens);
        const T0 = performance.now();
        const { m, W, H, cols, rows, gut, cw, ch } = PG.layoutSizes(S);
        const n = cols * rows;

        // pen -> paths of each cell, kept apart so strokes are only joined within their own cell
        const byPen = new Map();
        const outlines = [];
        let genMs = 0;
        const vary = n > 1 ? S.cellVary || 'seed' : 'none';
        const stack = layerStack(def, params, S, extra);
        // per layer: regions offered by the layer it draws in, how many passed its filters and
        // how many it drew in (fewer when capped), or noShapes when there were none to draw in
        const info = stack.map(() => ({ regions: 0, shapes: 0, used: 0, noShapes: false }));
        const sweepAt = S.sweep && Number.isInteger(S.sweep.layer) ? S.sweep.layer : 0;
        for (let k = 0; k < n; k++) {
            const r = Math.floor(k / cols), c = k % cols;
            // every layer of every cell gets its own seed, and with 'params' every cell but the
            // first gets its own random parameters; locked ones stay put
            const cellStack = stack.map((e, i) => {
                const seed = ((e.seed | 0) + (vary === 'none' ? 0 : k)) | 0;
                let p = e.params;
                if (vary === 'params' && k > 0) p = PG.randomParams(e.def, e.params, new PG.RNG(seed * 7919 + k), e.locks);
                if (n > 1 && i === sweepAt) p = sweepParams(e.def, p, S.sweep, k / (n - 1));
                return Object.assign({}, e, { seed, params: p });
            });
            const cell = runCell(cellStack, m + c * (cw + gut), m + r * (ch + gut), cw, ch, info);
            genMs += cell.genMs;
            for (const o of cell.outlines) outlines.push(o);
            for (const l of cell.layers) {
                if (!byPen.has(l.pen)) byPen.set(l.pen, []);
                byPen.get(l.pen).push(l.paths);
            }
        }
        let layers = [...byPen.entries()].sort((a, b) => a[0] - b[0]).map(([pen, cells]) => ({ pen, paths: cells.flat(), cells }));
        // The preview morphs between drawings using the geometry from before optimizing, since
        // merging and sorting change the path order from one drawing to the next
        const motion = extra.motion ? layers.map(({ pen, paths }) => ({ pen, paths })) : null;

        const T3 = performance.now();
        const rawStats = PG.optimize.stats(layers);

        // ---- optimize
        const o = S.opt || {};
        const O = PG.optimize;
        const paperBounds = shapes.rect(m, m, m + W, m + H);
        const outsidePaper = p => p[0] < m - 1e-6 || p[0] > m + W + 1e-6 || p[1] < m - 1e-6 || p[1] > m + H + 1e-6;
        const overlap = {};
        layers = layers.map(l => {
            // A join between two cells would draw across the gutter, or outside both
            // circle crops where they touch. Crops are convex, so joins inside one cell stay in it.
            let paths = l.cells.flatMap(cell => {
                let ps = cell.map(p => O.dedupe(p, 0.001));
                if (o.simplify) ps = ps.map(p => O.simplify(p, o.simplifyTol || 0.02));
                return o.merge ? O.merge(ps, o.mergeTol || 0.1) : ps;
            });
            if (o.overlap) {
                // 0.35 mm is the default pen width, for callers that don't pass widths
                const width = (S.penWidths && S.penWidths[l.pen]) || 0.35;
                const cut = O.overlaps(paths, width, (o.overlapPct || 100) / 100, o.overlapMin ?? 1);
                paths = cut.paths;
                overlap[l.pen] = cut.removed;
            }
            if (o.minLength > 0) paths = paths.filter(p => geo.pathLength(p) >= o.minLength);
            paths = paths.filter(p => p.length > 1);
            if (o.sort) {
                // greedy ordering usually wins, but keep the generator's order when it's already better
                const sorted = O.sort(paths, [0, 0], true).paths;
                const travel = ps => O.stats([{ paths: ps }]).travel;
                if (travel(sorted) < travel(paths)) paths = sorted;
            }
            // Don't split already clipped strokes again for floating-point roundoff.
            if (paths.some(p => p.some(outsidePaper))) paths = PG.clipPaths(paths, paperBounds);
            return { pen: l.pen, paths };
        }).filter(l => l.paths.length);

        const stats = PG.optimize.stats(layers);
        const T4 = performance.now();
        const res = {
            gen: def.id, layers, stats, rawStats, outlines,
            area: { x: m, y: m, w: W, h: H },
            timing: { generate: genMs, place: T3 - T0 - genMs, optimize: T4 - T3, total: T4 - T0 },
        };
        if (o.overlap) res.overlap = overlap;
        if (motion) res.motion = motion;
        if (stack.length > 1) res.layerInfo = info;
        // the first cell's ring of each wrapped layer, for the size of the cone it rolls into
        if (info.some(x => x.ring)) res.rings = info.map(x => x.ring || null);
        return res;
    };

    // ------------------------------------------------------------------
    // Results cross from the worker as flat arrays: x, y pairs in one Float64Array plus the
    // index where each path and layer ends. Structured clone of nested [x, y] arrays took
    // 10-25 ms on the main thread for the big scenes. Float64 keeps exports exact.
    // ------------------------------------------------------------------
    PG.packLayers = function (layers) {
        let points = 0, paths = 0;
        for (const l of layers) { paths += l.paths.length; for (const p of l.paths) points += p.length; }
        const xy = new Float64Array(points * 2), ends = new Uint32Array(paths);
        const pens = new Uint8Array(layers.length), layerEnds = new Uint32Array(layers.length);
        let k = 0, n = 0;
        layers.forEach((l, i) => {
            pens[i] = l.pen;
            for (const p of l.paths) {
                for (const q of p) { xy[k++] = q[0]; xy[k++] = q[1]; }
                ends[n++] = k / 2;
            }
            layerEnds[i] = n;
        });
        return { xy, ends, pens, layerEnds };
    };

    PG.unpackLayers = function ({ xy, ends, pens, layerEnds }) {
        const layers = [];
        let path = 0, start = 0;
        for (let i = 0; i < pens.length; i++) {
            const paths = [];
            for (; path < layerEnds[i]; path++) {
                const end = ends[path], p = new Array(end - start);
                for (let j = start; j < end; j++) p[j - start] = [xy[j * 2], xy[j * 2 + 1]];
                paths.push(p);
                start = end;
            }
            layers.push({ pen: pens[i], paths });
        }
        return layers;
    };

    // Morphing redraws the whole drawing every frame, so bigger ones only get the crossfade
    const MOTION_POINTS = 150000;
    PG.packResult = function (result) {
        const { layers, motion, ...rest } = result;
        const out = Object.assign(rest, {
            packed: PG.packLayers(layers),
            layerStats: layers.map(l => Object.assign({ pen: l.pen }, PG.optimize.stats([l]))),
        });
        let points = 0;
        if (motion) for (const l of motion) for (const p of l.paths) points += p.length;
        if (motion && points <= MOTION_POINTS) out.motion = PG.packLayers(motion);
        return out;
    };
    PG.transferList = r => [r.packed, r.motion].filter(Boolean).flatMap(p => [p.xy.buffer, p.ends.buffer, p.pens.buffer, p.layerEnds.buffer]);

    // layers is only rebuilt as nested arrays when something asks for it (exports, thumbnails).
    // The preview draws straight from the flat arrays.
    PG.unpackResult = function (data) {
        let layers = null;
        return Object.defineProperty(data, 'layers', {
            enumerable: true, configurable: true,
            get: () => layers || (layers = PG.unpackLayers(data.packed)),
        });
    };
})();
