/*
 * Layers: the shapes a design leaves for another design to draw in, and cutting the lines of
 * lower layers where a layer above covers them.
 *
 * A region is { circle: [cx, cy, r] } or { poly: [[x, y], ...] } (an open vertex list, any
 * winding, convex or not), with an optional kind: the index of a name in the design's
 * regionKinds(params).
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const geo = PG.geo;
    const L = (PG.stack = {});
    const T0 = 1e-12, T1 = 1 - 1e-12;

    // ---------------------------------------------------------------- polygons

    function bounds(poly) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const q of poly) {
            if (q[0] < minX) minX = q[0];
            if (q[0] > maxX) maxX = q[0];
            if (q[1] < minY) minY = q[1];
            if (q[1] > maxY) maxY = q[1];
        }
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }

    function convex(poly) {
        let sign = 0;
        for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
            const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            if (Math.abs(z) < 1e-9) continue;
            if (!sign) sign = Math.sign(z);
            else if (Math.sign(z) !== sign) return false;
        }
        return true;
    }

    const axisRect = poly => poly.length === 4 && poly.every((a, i) => {
        const b = poly[(i + 1) % 4];
        return Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;
    });

    // Convex hull, counterclockwise (monotone chain)
    function hull(points) {
        const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (p.length < 3) return p;
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [], upper = [];
        for (const q of p) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
            lower.push(q);
        }
        for (let i = p.length - 1; i >= 0; i--) {
            const q = p[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
            upper.push(q);
        }
        lower.pop(); upper.pop();
        return lower.concat(upper);
    }

    function segDist2(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - px, ey = ay + dy * t - py;
        return ex * ex + ey * ey;
    }

    // Signed distance to the outline, > 0 inside
    function polyDist(poly, x, y) {
        let d = Infinity;
        for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            d = Math.min(d, segDist2(x, y, a[0], a[1], b[0], b[1]));
        }
        d = Math.sqrt(d);
        return geo.pointInPolygon(x, y, poly) ? d : -d;
    }

    // An outline moved in by d, for drawing it: every edge moved in and joined at mitered
    // corners. Short edges at sharp corners turn round on the way in, so those drop out and their
    // neighbors meet instead. [] when what's left isn't d clear of the original all round.
    function insetOutline(poly, d) {
        const s = geo.polygonArea(poly) > 0 ? 1 : -1;
        let lines = [];
        for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 1e-9) continue;
            const nx = (-s * (b[1] - a[1])) / len, ny = (s * (b[0] - a[0])) / len;
            lines.push({ p: [a[0] + nx * d, a[1] + ny * d], dir: [b[0] - a[0], b[1] - a[1]] });
        }
        for (let guard = 0; guard <= poly.length && lines.length >= 3; guard++) {
            const n = lines.length, pts = [];
            for (let i = 0; i < n; i++) {
                const l0 = lines[(i + n - 1) % n], l1 = lines[i];
                const X = geo.lineIntersect(l0.p, l0.dir, l1.p, l1.dir);
                pts.push(X ? [X.x, X.y] : l1.p);
            }
            const keep = lines.filter((l, i) => {
                const a = pts[i], b = pts[(i + 1) % n];
                return (b[0] - a[0]) * l.dir[0] + (b[1] - a[1]) * l.dir[1] > 0;
            });
            if (keep.length === n) {
                return geo.polygonArea(pts) * s > 0 && pts.every(q => polyDist(poly, q[0], q[1]) > d * 0.98) ? pts : [];
            }
            lines = keep;
        }
        return [];
    }

    // Pole of inaccessibility: the center and radius of the largest circle inside a polygon
    // (after Agafonkin's polylabel), to within `precision` mm.
    function pole(poly, precision = 0.05) {
        const b = bounds(poly), size = Math.min(b.w, b.h);
        if (!(size > 0)) return { x: b.minX, y: b.minY, r: 0 };
        const heap = [];
        const push = c => {
            heap.push(c);
            for (let i = heap.length - 1; i > 0;) {
                const j = (i - 1) >> 1;
                if (heap[j].max >= heap[i].max) break;
                [heap[i], heap[j]] = [heap[j], heap[i]];
                i = j;
            }
        };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                for (let i = 0; ;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < heap.length && heap[l].max > heap[m].max) m = l;
                    if (r < heap.length && heap[r].max > heap[m].max) m = r;
                    if (m === i) break;
                    [heap[i], heap[m]] = [heap[m], heap[i]];
                    i = m;
                }
            }
            return top;
        };
        const cell = (x, y, h) => { const d = polyDist(poly, x, y); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
        const h = size / 2;
        for (let x = b.minX; x < b.maxX; x += size) for (let y = b.minY; y < b.maxY; y += size) push(cell(x + h, y + h, h));
        const c = geo.centroid(poly);
        let best = cell(c[0], c[1], 0);
        const mid = cell(b.minX + b.w / 2, b.minY + b.h / 2, 0);
        if (mid.d > best.d) best = mid;
        for (let guard = 0; heap.length && guard < 20000; guard++) {
            const c = pop();
            if (c.d > best.d) best = c;
            if (c.max - best.d <= precision) continue;
            const q = c.h / 2;
            push(cell(c.x - q, c.y - q, q)); push(cell(c.x + q, c.y - q, q));
            push(cell(c.x - q, c.y + q, q)); push(cell(c.x + q, c.y + q, q));
        }
        return { x: best.x, y: best.y, r: Math.max(0, best.d) };
    }

    // Parts of segment a-b inside a polygon (even-odd), as [t0, t1] pairs pushed into out.
    // Each piece between crossings is tested at its middle, so vertices and touching edges
    // need no special cases. `inner` ([x, y, r]) is a circle inside the polygon: a segment
    // with both ends in it is inside, which spares the edge tests for most of a drawing.
    function polyHits(poly, box, ax, ay, bx, by, out, inner) {
        if (Math.max(ax, bx) < box.minX || Math.min(ax, bx) > box.maxX || Math.max(ay, by) < box.minY || Math.min(ay, by) > box.maxY) return;
        if (inner) {
            const r2 = inner[2] * inner[2] * 0.999;
            if ((ax - inner[0]) ** 2 + (ay - inner[1]) ** 2 < r2 && (bx - inner[0]) ** 2 + (by - inner[1]) ** 2 < r2) { out.push(0, 1); return; }
        }
        const dx = bx - ax, dy = by - ay;
        const ts = [0, 1];
        for (let i = 0, n = poly.length; i < n; i++) {
            const p = poly[i], q = poly[(i + 1) % n];
            const ex = q[0] - p[0], ey = q[1] - p[1];
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-15) continue;
            const wx = p[0] - ax, wy = p[1] - ay;
            const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
            if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
        }
        if (ts.length > 2) ts.sort((a, b) => a - b);
        for (let i = 1; i < ts.length; i++) {
            const t0 = ts[i - 1], t1 = ts[i];
            if (t1 - t0 < 1e-12) continue;
            const tm = (t0 + t1) / 2;
            if (geo.pointInPolygon(ax + dx * tm, ay + dy * tm, poly)) out.push(t0, t1);
        }
    }

    // Segment a-b against a disk.
    function diskHit(ax, ay, bx, by, cx, cy, r, out) {
        const dx = bx - ax, dy = by - ay, fx = ax - cx, fy = ay - cy;
        const a = dx * dx + dy * dy, c = fx * fx + fy * fy - r * r;
        if (a < 1e-24) { if (c <= 0) out.push(0, 1); return; }
        const b = 2 * (fx * dx + fy * dy), disc = b * b - 4 * a * c;
        if (disc <= 0) return;
        const s = Math.sqrt(disc);
        const t0 = Math.max(0, (-b - s) / (2 * a)), t1 = Math.min(1, (-b + s) / (2 * a));
        if (t1 > t0) out.push(t0, t1);
    }

    // Segment a-b against the capsule of radius r round segment c-d: a box along c-d and a disk
    // at each end. The capsule is convex, so the parts where it overlaps are one interval.
    function capsuleHit(ax, ay, bx, by, cx, cy, ex, ey, r, out) {
        let lo = Infinity, hi = -Infinity;
        const tmp = [];
        diskHit(ax, ay, bx, by, cx, cy, r, tmp);
        diskHit(ax, ay, bx, by, ex, ey, r, tmp);
        const ux = ex - cx, uy = ey - cy, len = Math.hypot(ux, uy);
        if (len > 1e-12) {
            // Liang-Barsky in the frame of c-d: 0 <= u <= len, -r <= v <= r
            const kx = ux / len, ky = uy / len;
            const au = (ax - cx) * kx + (ay - cy) * ky, av = -(ax - cx) * ky + (ay - cy) * kx;
            const du = (bx - ax) * kx + (by - ay) * ky, dv = -(bx - ax) * ky + (by - ay) * kx;
            let t0 = 0, t1 = 1, ok = true;
            for (const [p, q] of [[-du, au], [du, len - au], [-dv, av + r], [dv, r - av]]) {
                if (p === 0) { if (q < 0) { ok = false; break; } continue; }
                const t = q / p;
                if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
                else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
            }
            if (ok && t1 > t0) tmp.push(t0, t1);
        }
        for (let i = 0; i < tmp.length; i += 2) { if (tmp[i] < lo) lo = tmp[i]; if (tmp[i + 1] > hi) hi = tmp[i + 1]; }
        if (hi > lo) out.push(lo, hi);
    }

    // Sorted, merged [t0, t1] pairs in 0..1 from unsorted ones, or what's left of 0..1 outside them.
    const NONE = [], ALL = [0, 1];
    function merged(iv, complement) {
        let out;
        if (!iv.length) out = NONE;
        else if (iv.length === 2) {
            const a = Math.max(0, iv[0]), b = Math.min(1, iv[1]);
            out = b > a ? [a, b] : NONE;
        } else {
            const n = iv.length / 2;
            const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => iv[2 * a] - iv[2 * b]);
            out = [];
            for (const i of idx) {
                const a = Math.max(0, iv[2 * i]), b = Math.min(1, iv[2 * i + 1]);
                if (b <= a) continue;
                if (out.length && a <= out[out.length - 1] + 1e-9) out[out.length - 1] = Math.max(out[out.length - 1], b);
                else out.push(a, b);
            }
        }
        if (!complement) return out;
        if (!out.length) return ALL;
        const rest = [];
        let at = 0;
        for (let i = 0; i < out.length; i += 2) {
            if (out[i] > at + T0) rest.push(at, out[i]);
            at = Math.max(at, out[i + 1]);
        }
        if (at < T1) rest.push(at, 1);
        return rest;
    }

    // Where two sorted, merged interval lists overlap, and what's left of a outside b
    function intersect(a, b) {
        const out = [];
        for (let i = 0, j = 0; i < a.length && j < b.length;) {
            const lo = Math.max(a[i], b[j]), hi = Math.min(a[i + 1], b[j + 1]);
            if (hi > lo) out.push(lo, hi);
            if (a[i + 1] < b[j + 1]) i += 2; else j += 2;
        }
        return out;
    }
    function subtract(a, b) {
        const out = [];
        for (let i = 0, j = 0; i < a.length; i += 2) {
            let lo = a[i];
            const hi = a[i + 1];
            while (j < b.length && b[j + 1] <= lo) j += 2;
            for (let k = j; k < b.length && b[k] < hi; k += 2) {
                if (b[k] > lo) out.push(lo, b[k]);
                lo = Math.max(lo, b[k + 1]);
            }
            if (hi > lo) out.push(lo, hi);
        }
        return out;
    }

    // Splits paths where hits(ax, ay, bx, by, out) marks parts of a segment, pushing [t0, t1]
    // pairs into out. Keeps the marked parts when keepHits is true, otherwise the rest. Pieces a
    // cut leaves shorter than speck mm are dropped. Paths nothing touches come back as they were.
    L.split = function (paths, hits, keepHits, speck = 0) {
        const out = [], iv = [];
        for (const path of paths) {
            if (path.length < 2) continue;
            const pieces = [];
            let piece = null, touched = false;
            for (let i = 1; i < path.length; i++) {
                const a = path[i - 1], b = path[i];
                iv.length = 0;
                hits(a[0], a[1], b[0], b[1], iv);
                const keep = merged(iv, !keepHits);
                if (keep.length === 2 && keep[0] <= T0 && keep[1] >= T1) {
                    if (!piece) { piece = [a]; pieces.push(piece); }
                    piece.push(b);
                    continue;
                }
                touched = true;
                if (!keep.length) { piece = null; continue; }
                for (let k = 0; k < keep.length; k += 2) {
                    const t0 = keep[k], t1 = keep[k + 1];
                    const p1 = t1 >= T1 ? b : [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
                    if (piece && t0 <= T0) piece.push(p1);
                    else {
                        piece = [t0 <= T0 ? a : [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1];
                        pieces.push(piece);
                    }
                    if (t1 < T1) piece = null;
                }
            }
            if (!touched) { if (pieces.length) out.push(path); continue; }
            for (const p of pieces) if (p.length > 1 && (!speck || geo.pathLength(p) >= speck)) out.push(p);
        }
        return out;
    };

    // ---------------------------------------------------------------- regions as drawing areas

    L.mapRegion = (r, fn, k) => r.circle
        ? { circle: [...fn(r.circle[0], r.circle[1]), r.circle[2] * k], kind: r.kind }
        : { poly: r.poly.map(q => fn(q[0], q[1])), kind: r.kind };

    // A region moved in by d, or null when nothing is left. Circles and convex polygons move in
    // exactly. A concave polygon keeps its outline and adds d to its inset, and regionShape leaves
    // out what's that close to the outline: moving the edges in folds them over wherever short
    // edges meet at a sharp corner, like on the curved tiles of Hyperbolic Tiling.
    L.inset = function (r, d) {
        if (r.circle) return r.circle[2] - d > 1e-6 ? { ...r, circle: [r.circle[0], r.circle[1], r.circle[2] - d] } : null;
        let poly = r.inset ? r.poly : geo.cleanPolygon(r.poly, 1e-6);
        if (poly.length < 3 || Math.abs(geo.polygonArea(poly)) < 1e-6) return null;
        if (!(d > 0)) return { ...r, poly };
        if (!r.inset && convex(poly)) {
            poly = geo.cleanPolygon(geo.insetConvex(poly, d), 1e-6);
            return poly.length >= 3 && Math.abs(geo.polygonArea(poly)) > 1e-6 ? { ...r, poly } : null;
        }
        const inset = (r.inset || 0) + d, p = r.pole || pole(poly);
        return p.r - inset > 1e-6 ? { ...r, poly, inset, pole: p } : null;
    };

    // Vertices of a convex drawing area from PG.makeShape, circles as a circumscribed polygon.
    const convexVerts = shape => shape.type === 'circle'
        ? geo.ngon(shape.cx, shape.cy, shape.r / Math.cos(Math.PI / 96), 96)
        : shape.type === 'rect' ? [[shape.x0, shape.y0], [shape.x1, shape.y0], [shape.x1, shape.y1], [shape.x0, shape.y1]]
            : shape.hull || shape.verts;

    // A region cut down to what's inside a drawing area, or null when none of it is. The cut is
    // to the area's convex hull. When the area is concave (type 'region') the region keeps it as
    // `within`, and regionShape cuts to it exactly.
    L.clipRegion = function (r, area) {
        const verts = convexVerts(area);
        const b = bounds(verts);
        const within = area.type === 'region' ? [area] : r.within;
        const done = out => (out && within ? { ...out, within } : out);
        if (r.circle) {
            const [cx, cy, rad] = r.circle;
            if (cx + rad < b.minX || cx - rad > b.maxX || cy + rad < b.minY || cy - rad > b.maxY) return null;
            if (area.dist(cx, cy) >= rad - 1e-9) return done(r);
            r = { poly: geo.ngon(cx, cy, rad, Math.max(24, Math.min(96, Math.ceil(rad * 4)))), kind: r.kind };
        }
        const rb = bounds(r.poly);
        if (rb.maxX < b.minX || rb.minX > b.maxX || rb.maxY < b.minY || rb.minY > b.maxY) return null;
        const ccw = geo.polygonArea(verts) > 0;
        let poly = r.poly;
        for (let i = 0; i < verts.length && poly.length >= 3; i++) {
            const a = verts[i], c = verts[(i + 1) % verts.length];
            const ex = c[0] - a[0], ey = c[1] - a[1];
            if (Math.abs(ex) + Math.abs(ey) < 1e-12) continue;
            poly = geo.clipPolygonHalfPlane(poly, a, ccw ? [-ey, ex] : [ey, -ex]);
        }
        poly = geo.cleanPolygon(poly, 1e-6);
        return poly.length >= 3 && Math.abs(geo.polygonArea(poly)) > 1e-3 ? done({ poly, kind: r.kind }) : null;
    };

    // A region as a drawing area for placeCell. Besides what PG.shapes give (inside, dist, outline)
    // it has the box to generate into, where designs that fit themselves (curves) go (fitCircle,
    // the largest circle inside, except for rectangles which fit their box), its size across
    // that circle, hits() for the parts of a segment inside it, and a convex hull for designs that
    // expect a convex area. Concave regions and ones within another (type 'region') also clip.
    L.regionShape = function (r) {
        let s;
        if (r.circle) {
            const [cx, cy, rad] = r.circle;
            s = Object.assign(PG.shapes.circle(cx, cy, rad), {
                kind: 'circle', box: { x: cx - rad, y: cy - rad, w: 2 * rad, h: 2 * rad }, fitCircle: [cx, cy, rad], size: 2 * rad,
                hits: (ax, ay, bx, by, out) => diskHit(ax, ay, bx, by, cx, cy, rad, out),
            });
        } else {
            const poly = r.poly, b = bounds(poly), d = r.inset || 0;
            const box = { x: b.minX, y: b.minY, w: b.w, h: b.h };
            const clipSeg = shape => (ax, ay, bx, by, out) => { const t = shape.clipSeg(ax, ay, bx, by); if (t && t[1] > t[0]) out.push(t[0], t[1]); };
            if (!d && axisRect(poly)) {
                s = PG.shapes.rect(b.minX, b.minY, b.maxX, b.maxY);
                Object.assign(s, { kind: 'rect', box, size: Math.min(b.w, b.h), hits: clipSeg(s) });
            } else {
                const p = r.pole || pole(poly);
                const fit = { kind: 'polygon', box, fitCircle: [p.x, p.y, p.r - d], size: 2 * (p.r - d) };
                if (!d && convex(poly)) {
                    s = Object.assign(PG.shapes.polygon(poly), fit);
                    s.hits = clipSeg(s);
                } else {
                    // Inside the outline, less what's within d of it
                    const edges = [];
                    for (let i = 0; i < poly.length; i++) {
                        const a = poly[i], c = poly[(i + 1) % poly.length];
                        edges.push([a[0], a[1], c[0], c[1], Math.min(a[0], c[0]) - d, Math.min(a[1], c[1]) - d, Math.max(a[0], c[0]) + d, Math.max(a[1], c[1]) + d]);
                    }
                    const inner = fit.fitCircle, r2 = inner[2] * inner[2] * 0.999;
                    const hits = (ax, ay, bx, by, out) => {
                        if ((ax - inner[0]) ** 2 + (ay - inner[1]) ** 2 < r2 && (bx - inner[0]) ** 2 + (by - inner[1]) ** 2 < r2) { out.push(0, 1); return; }
                        const iv = [];
                        polyHits(poly, b, ax, ay, bx, by, iv);
                        if (!iv.length) return;
                        let keep = merged(iv, false);
                        if (d > 0) {
                            const band = [], x0 = Math.min(ax, bx), y0 = Math.min(ay, by), x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
                            for (const e of edges) if (e[6] >= x0 && e[4] <= x1 && e[7] >= y0 && e[5] <= y1) capsuleHit(ax, ay, bx, by, e[0], e[1], e[2], e[3], d, band);
                            if (band.length) keep = subtract(keep, merged(band, false));
                        }
                        for (const t of keep) out.push(t);
                    };
                    s = Object.assign({
                        type: 'region', verts: poly, hull: hull(poly), hits,
                        inside: (x, y) => (d > 0 ? polyDist(poly, x, y) >= d : geo.pointInPolygon(x, y, poly)),
                        dist: (x, y) => polyDist(poly, x, y) - d,
                        clipPaths: paths => L.split(paths, hits, true),
                        outline: () => geo.close(d > 0 ? insetOutline(poly, d) : poly),
                    }, fit);
                }
            }
        }
        s.region = r;
        if (!r.within || !r.within.length) return s;
        // In a concave region of the layer below: inside both
        const within = r.within, own = s.hits;
        const hits = (ax, ay, bx, by, out) => {
            const a = [];
            own(ax, ay, bx, by, a);
            if (!a.length) return;
            let keep = merged(a, false);
            for (const w of within) {
                const c = [];
                w.hits(ax, ay, bx, by, c);
                keep = c.length ? intersect(keep, merged(c, false)) : [];
                if (!keep.length) return;
            }
            for (const t of keep) out.push(t);
        };
        const inWithin = paths => L.split(paths, (ax, ay, bx, by, out) => {
            let keep = ALL;
            for (const w of within) { const c = []; w.hits(ax, ay, bx, by, c); keep = c.length ? intersect(keep, merged(c, false)) : []; if (!keep.length) return; }
            for (const t of keep) out.push(t);
        }, true);
        return Object.assign({}, s, {
            type: 'region', hull: s.hull || convexVerts(s), hits,
            inside: (x, y) => s.inside(x, y) && within.every(w => w.inside(x, y)),
            dist: (x, y) => Math.min(s.dist(x, y), ...within.map(w => w.dist(x, y))),
            clipPaths: paths => L.split(paths, hits, true),
            // its outline only where it's inside what holds it
            frameLines: () => inWithin([s.outline()]),
        });
    };

    // The regions a layer draws in: one kind, every other one, or all of them, each moved in by
    // `inset` and at least `min` mm across. When there are more than `max`, the largest are kept.
    // Each keeps its index in the full list, which picks its seed, so changing the filters doesn't
    // reshuffle the rest.
    L.pick = function (regions, { which = 'all', inset = 0, min = 0, max = Infinity } = {}) {
        const kind = /^kind:\d+$/.test(which) ? +which.slice(5) : -1;
        let picked = [];
        regions.forEach((r, index) => {
            if (which === 'alternate' && index % 2) return;
            if (kind >= 0 && r.kind !== kind) return;
            // the empty center of a wrapped layer
            if (which === 'center' && r.kind !== 'center') return;
            // nothing wider than its box fits inside, which rules out most of a long list cheaply
            let across;
            if (r.circle) across = 2 * r.circle[2];
            else { const b = bounds(r.poly); across = Math.min(b.w, b.h); }
            if (!(across - 2 * inset >= min)) return;
            const inner = L.inset(r, inset);
            if (!inner) return;
            const shape = L.regionShape(inner);
            if (shape.size >= min && shape.size > 0) picked.push({ shape, index, region: r });
        });
        const found = picked.length;
        if (picked.length > max) {
            picked = picked.slice().sort((a, b) => b.shape.size - a.shape.size || a.index - b.index).slice(0, max)
                .sort((a, b) => a.index - b.index);
        }
        return { picked, found };
    };

    // ---------------------------------------------------------------- rings

    // Segment a-b against the half-plane where n . (p - c) >= 0
    function halfHit(ax, ay, bx, by, cx, cy, n, out) {
        const s0 = n[0] * (ax - cx) + n[1] * (ay - cy), ds = n[0] * (bx - ax) + n[1] * (by - ay);
        if (Math.abs(ds) < 1e-15) { if (s0 >= 0) out.push(0, 1); return; }
        const t = -s0 / ds;
        if (ds > 0) { if (t < 1) out.push(Math.max(0, t), 1); } else if (t > 0) out.push(0, Math.min(1, t));
    }

    const hitsOf = shape => shape.hits || ((ax, ay, bx, by, out) => {
        const t = shape.clipSeg(ax, ay, bx, by);
        if (t && t[1] > t[0]) out.push(t[0], t[1]);
    });

    // The area of a wrapped layer: the ring from radius r0 to r1 round (cx, cy), or the part of
    // it from angle a0 through arc, cut to `within` (the cell or the region the layer is in).
    // Angles go clockwise from straight up. Besides inside, dist, and hits it gives the outlines
    // to frame, and frameInset(d) for the second frame line.
    L.ringShape = function (cx, cy, r0, r1, a0, arc, within) {
        const full = arc >= PG.TAU - 1e-9, a1 = a0 + arc;
        // inward normals of the straight edges
        const nA = [Math.cos(a0), Math.sin(a0)], nB = [-Math.cos(a1), -Math.sin(a1)];
        const edge = a => [cx + r0 * Math.sin(a), cy - r0 * Math.cos(a), cx + r1 * Math.sin(a), cy - r1 * Math.cos(a)];
        const eA = edge(a0), eB = edge(a1);
        // Signed distance to the outline, > 0 inside. Outside it's only a lower bound.
        const dist = (x, y) => {
            const r = Math.hypot(x - cx, y - cy), radial = Math.min(r1 - r, r0 > 0 ? r - r0 : Infinity);
            let d = radial;
            if (!full) {
                const turn = ((Math.atan2(x - cx, cy - y) - a0) % PG.TAU + PG.TAU) % PG.TAU;
                const e = Math.sqrt(Math.min(segDist2(x, y, ...eA), segDist2(x, y, ...eB)));
                d = turn <= arc + 1e-12 ? Math.min(radial, e) : radial < 0 ? Math.min(radial, -e) : -e;
            }
            return Math.min(d, within.dist(x, y));
        };
        const inHits = hitsOf(within);
        const hits = (ax, ay, bx, by, out) => {
            const iv = [];
            diskHit(ax, ay, bx, by, cx, cy, r1, iv);
            if (!iv.length) return;
            let keep = merged(iv, false);
            if (r0 > 0) {
                const hole = [];
                diskHit(ax, ay, bx, by, cx, cy, r0, hole);
                if (hole.length) keep = subtract(keep, merged(hole, false));
            }
            if (!full && keep.length) {
                const a = [], b = [];
                halfHit(ax, ay, bx, by, cx, cy, nA, a);
                halfHit(ax, ay, bx, by, cx, cy, nB, b);
                keep = intersect(keep, arc <= Math.PI ? intersect(merged(a, false), merged(b, false)) : merged(a.concat(b), false));
            }
            if (!keep.length) return;
            const c = [];
            inHits(ax, ay, bx, by, c);
            keep = c.length ? intersect(keep, merged(c, false)) : [];
            for (const t of keep) out.push(t);
        };
        const at = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
        const arcPts = (r, from, to) => geo.arc(cx, cy, r, from - Math.PI / 2, to - Math.PI / 2, 0, 0.005);
        // The outline moved in by d: arcs at r1 - d and r0 + d, and the straight edges moved over
        // by d, which meet at a point when the arc is too narrow to reach the inner circle.
        const rings = (d = 0) => {
            const o = r1 - d, i = r0 + d;
            if (!(o > 1e-6) || (r0 > 0 && o <= i + 1e-6)) return [];
            if (full) return [arcPts(o, 0, PG.TAU), ...(r0 > 0 ? [arcPts(i, PG.TAU, 0)] : [])];
            if (!d) {
                const outer = arcPts(r1, a0, a1);
                return [r0 > 0 ? [...outer, ...arcPts(r0, a1, a0), outer[0]] : [...outer, [cx, cy], outer[0]]];
            }
            if (!(o > d)) return [];
            const so = Math.asin(d / o);
            if (arc - 2 * so <= 1e-6) return [];
            const outer = arcPts(o, a0 + so, a1 - so);
            const si = r0 > 0 ? Math.asin(d / i) : Math.PI / 2, span = arc - 2 * si;
            let inner;
            if (span > 1e-6) inner = arcPts(i, a1 - si, a0 + si);
            // at 180 degrees round the center the moved edges are one line
            else if (span > -1e-6 && !(r0 > 0)) inner = [];
            else {
                // the moved edges cross on the middle line before they reach the inner circle
                const apex = d / Math.sin(arc / 2);
                if (!(arc < Math.PI) || apex >= o) return [];
                inner = [at(apex, a0 + arc / 2)];
            }
            return [[...outer, ...inner, outer[0]]];
        };
        const cut = paths => L.split(paths, inHits, true);
        const outlines = () => cut(rings());
        const box = bounds(full ? [at(r1, 0), at(r1, Math.PI / 2), at(r1, Math.PI), at(r1, -Math.PI / 2)] : rings()[0] || [[cx, cy]]);
        return {
            type: 'ring', cx, cy, r0, r1, a0, arc,
            box: { x: box.minX, y: box.minY, w: box.w, h: box.h },
            inside: (x, y) => dist(x, y) >= -1e-7,
            dist, hits,
            clipPaths: paths => L.split(paths, hits, true),
            outline: () => outlines()[0] || [],
            outlines, frameLines: outlines,
            frameInset: d => cut(rings(d)),
        };
    };

    // ---------------------------------------------------------------- covering

    // Where a layer covers the layers below it: capsules round its lines, solid shapes and a
    // raster of what its lines enclose. Lower lines are cut wherever they run into any of them.
    class Cover {
        constructor() {
            this.caps = [];     // x0, y0, x1, y1, r for every capsule
            this.solids = [];   // { box, hit(ax, ay, bx, by, out) }
            this.built = false;
        }

        // Clearance r round every segment of these paths. Dense curves are simplified to within
        // 0.02 mm first, which moves the edge of the clearance by no more than that and saves
        // testing thousands of tiny overlapping capsules.
        lines(paths, r) {
            if (!(r > 0)) return this;
            const tol = Math.min(0.02, r / 10);
            for (const path of paths) {
                const p = path.length > 2 && PG.optimize ? PG.optimize.simplify(path, tol) : path;
                for (let i = 1; i < p.length; i++) this.caps.push(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], r);
            }
            return this;
        }

        // The inside of a drawing area or region, plus clearance r round its outline.
        area(shape, r) {
            // a region shape knows its own inside, including any region it's within
            if (shape.hits && (!(r > 0) || shape.type === 'ring')) {
                const b = shape.box;
                this.solids.push({ box: { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h }, hit: shape.hits });
                if (r > 0) this.lines(shape.outlines(), r);
                return this;
            }
            if (shape.type === 'circle') {
                const R = shape.r + Math.max(0, r);
                const { cx, cy } = shape;
                this.solids.push({ box: { minX: cx - R, minY: cy - R, maxX: cx + R, maxY: cy + R }, hit: (ax, ay, bx, by, out) => diskHit(ax, ay, bx, by, cx, cy, R, out) });
                return this;
            }
            const verts = shape.type === 'rect' ? convexVerts(shape) : shape.verts;
            const box = bounds(verts);
            const hit = shape.clipSeg
                ? (ax, ay, bx, by, out) => { const t = shape.clipSeg(ax, ay, bx, by); if (t && t[1] > t[0]) out.push(t[0], t[1]); }
                : (ax, ay, bx, by, out) => polyHits(verts, box, ax, ay, bx, by, out, shape.fitCircle);
            this.solids.push({ box, hit });
            if (r > 0) this.lines([geo.close(verts)], r);
            return this;
        }

        // Everything a layer's lines enclose, from a raster: cells the lines don't reach from
        // outside. `reach` (mm) thickens the lines first so near misses still close a shape.
        enclosed(paths, reach = 0.3) {
            const b = geo.bbox(paths);
            if (!(b.w >= 0) || !(b.h >= 0)) return this;
            const pad = reach + 1;
            const W = b.w + 2 * pad, H = b.h + 2 * pad;
            const res = Math.max(0.2, Math.sqrt((W * H) / 4e6));
            const nx = Math.ceil(W / res) + 1, ny = Math.ceil(H / res) + 1;
            const x0 = b.minX - pad, y0 = b.minY - pad;
            const grid = new Uint8Array(nx * ny);
            const rad = Math.max(reach, res * 0.75), rc = Math.ceil(rad / res), r2 = rad * rad;
            for (const p of paths) {
                for (let i = 1; i < p.length; i++) {
                    const ax = p[i - 1][0], ay = p[i - 1][1], dx = p[i][0] - ax, dy = p[i][1] - ay;
                    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (res * 0.5)));
                    for (let s = 0; s <= steps; s++) {
                        const x = ax + (dx * s) / steps, y = ay + (dy * s) / steps;
                        const ci = Math.floor((x - x0) / res), cj = Math.floor((y - y0) / res);
                        for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) {
                            const yy = y0 + (j + 0.5) * res - y;
                            for (let k = Math.max(0, ci - rc); k <= Math.min(nx - 1, ci + rc); k++) {
                                const xx = x0 + (k + 0.5) * res - x;
                                if (xx * xx + yy * yy <= r2) grid[j * nx + k] = 1;
                            }
                        }
                    }
                }
            }
            // Flood the outside (2) from the border
            const queue = new Int32Array(nx * ny);
            let head = 0, tail = 0;
            const seed = i => { if (grid[i] === 0) { grid[i] = 2; queue[tail++] = i; } };
            for (let k = 0; k < nx; k++) { seed(k); seed((ny - 1) * nx + k); }
            for (let j = 0; j < ny; j++) { seed(j * nx); seed(j * nx + nx - 1); }
            while (head < tail) {
                const i = queue[head++], k = i % nx;
                if (k > 0) seed(i - 1);
                if (k < nx - 1) seed(i + 1);
                if (i >= nx) seed(i - nx);
                if (i < nx * (ny - 1)) seed(i + nx);
            }
            const inside = (x, y) => {
                const k = Math.floor((x - x0) / res), j = Math.floor((y - y0) / res);
                return k >= 0 && j >= 0 && k < nx && j < ny && grid[j * nx + k] !== 2;
            };
            const step = res * 0.5;
            const hit = (ax, ay, bx, by, out) => {
                const dx = bx - ax, dy = by - ay;
                const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
                let prev = inside(ax, ay), start = 0, tp = 0;
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps, cur = inside(ax + dx * t, ay + dy * t);
                    if (cur !== prev) {
                        // the boundary to within a few hundredths of a cell
                        let lo = tp, hi = t;
                        for (let it = 0; it < 6; it++) {
                            const mid = (lo + hi) / 2;
                            if (inside(ax + dx * mid, ay + dy * mid) === prev) lo = mid; else hi = mid;
                        }
                        const tb = (lo + hi) / 2;
                        if (cur) start = tb; else out.push(start, tb);
                        prev = cur;
                    }
                    tp = t;
                }
                if (prev) out.push(start, 1);
            };
            this.solids.push({ box: { minX: x0, minY: y0, maxX: x0 + nx * res, maxY: y0 + ny * res }, hit });
            return this;
        }

        // Bucket grid over every solid and capsule, stored flat (counts, then ids). Solids get the
        // low ids, so they're tested first: one often covers a whole segment, which ends its test.
        build() {
            this.built = true;
            const caps = this.caps, nc = caps.length / 5, ns = this.solids.length, n = nc + ns;
            this.n = n;
            if (!n) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, reach = 0;
            const boxOf = new Float64Array(n * 4);
            this.solids.forEach((s, i) => {
                boxOf[i * 4] = s.box.minX; boxOf[i * 4 + 1] = s.box.minY; boxOf[i * 4 + 2] = s.box.maxX; boxOf[i * 4 + 3] = s.box.maxY;
            });
            for (let c = 0; c < nc; c++) {
                const i = ns + c;
                const x0 = caps[c * 5], y0 = caps[c * 5 + 1], x1 = caps[c * 5 + 2], y1 = caps[c * 5 + 3], r = caps[c * 5 + 4];
                boxOf[i * 4] = Math.min(x0, x1) - r; boxOf[i * 4 + 1] = Math.min(y0, y1) - r;
                boxOf[i * 4 + 2] = Math.max(x0, x1) + r; boxOf[i * 4 + 3] = Math.max(y0, y1) + r;
                reach = Math.max(reach, r);
            }
            for (let i = 0; i < n; i++) {
                minX = Math.min(minX, boxOf[i * 4]); minY = Math.min(minY, boxOf[i * 4 + 1]);
                maxX = Math.max(maxX, boxOf[i * 4 + 2]); maxY = Math.max(maxY, boxOf[i * 4 + 3]);
            }
            const area = (maxX - minX + 1) * (maxY - minY + 1);
            // at least the clearance across, or a wide clearance files each capsule in hundreds of cells
            const cell = Math.max(Math.sqrt(area / Math.max(1, n)) * 1.5, Math.sqrt(area / 1e6), 0.25, reach);
            const gx = Math.floor((maxX - minX) / cell) + 1, gy = Math.floor((maxY - minY) / cell) + 1;
            const range = i => [
                Math.max(0, Math.floor((boxOf[i * 4] - minX) / cell)), Math.max(0, Math.floor((boxOf[i * 4 + 1] - minY) / cell)),
                Math.min(gx - 1, Math.floor((boxOf[i * 4 + 2] - minX) / cell)), Math.min(gy - 1, Math.floor((boxOf[i * 4 + 3] - minY) / cell)),
            ];
            const start = new Int32Array(gx * gy + 1);
            for (let i = 0; i < n; i++) {
                const [a, b, c, d] = range(i);
                for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) start[y * gx + x + 1]++;
            }
            for (let k = 0; k < gx * gy; k++) start[k + 1] += start[k];
            const fill = start.slice(0, gx * gy), ids = new Int32Array(start[gx * gy]);
            for (let i = 0; i < n; i++) {
                const [a, b, c, d] = range(i);
                for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) ids[fill[y * gx + x]++] = i;
            }
            Object.assign(this, { minX, minY, cell, gx, gy, start, ids, stamp: new Int32Array(n), query: 0 });
        }

        hits(ax, ay, bx, by, out) {
            if (!this.n) return;
            const { minX, minY, cell, gx, gy, start, ids, stamp, caps, solids } = this;
            const ns = solids.length;
            const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - minX) / cell)), x1 = Math.min(gx - 1, Math.floor((Math.max(ax, bx) - minX) / cell));
            const y0 = Math.max(0, Math.floor((Math.min(ay, by) - minY) / cell)), y1 = Math.min(gy - 1, Math.floor((Math.max(ay, by) - minY) / cell));
            if (x0 > x1 || y0 > y1) return;
            const q = ++this.query;
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const k = y * gx + x;
                    for (let j = start[k]; j < start[k + 1]; j++) {
                        const i = ids[j];
                        if (stamp[i] === q) continue;
                        stamp[i] = q;
                        const at = out.length;
                        if (i < ns) solids[i].hit(ax, ay, bx, by, out);
                        else {
                            const c = (i - ns) * 5;
                            capsuleHit(ax, ay, bx, by, caps[c], caps[c + 1], caps[c + 2], caps[c + 3], caps[c + 4], out);
                        }
                        // covered from end to end: nothing else can change that
                        for (let t = at; t < out.length; t += 2) if (out[t] <= T0 && out[t + 1] >= T1) return;
                    }
                }
            }
        }

        // Lower lines with the covered parts cut out. Leftovers shorter than speck mm are dropped.
        cut(paths, speck = 1) {
            if (!this.built) this.build();
            if (!this.n) return paths;
            return L.split(paths, (ax, ay, bx, by, out) => this.hits(ax, ay, bx, by, out), false, speck);
        }
    }
    L.cover = () => new Cover();

    // For tests
    L._internal = { pole, polyDist, insetOutline, convex, hull, capsuleHit, merged, intersect, subtract };
})();
