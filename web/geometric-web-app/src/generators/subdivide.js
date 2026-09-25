/*
 * Subdivision — a hatched quilt. The page is split recursively: rectangles
 * along their longer axis at a jittered ratio, triangles from a point near the
 * middle of their longest edge to the opposite corner (which keeps them well
 * shaped). Leaves are inset by half the gap and each gets a treatment —
 * parallel hatch, cross-hatch, concentric insets or nothing — at one of a few
 * discrete tones, so the page reads like a toned Mondrian study. Hatches run
 * as rim-following zig-zags and concentric insets as one polygon spiral.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Intersection of two convex polygons (clip `poly` by every edge of `by`).
    function intersectConvex(poly, by) {
        const ccw = geo.polygonArea(by) > 0;
        for (let i = 0; i < by.length && poly.length >= 3; i++) {
            const a = by[i], b = by[(i + 1) % by.length];
            const ex = b[0] - a[0], ey = b[1] - a[1];
            poly = geo.clipPolygonHalfPlane(poly, a, ccw ? [-ey, ex] : [ey, -ex]);
        }
        return geo.cleanPolygon(poly);
    }

    PG.register({
        id: 'subdivide',
        name: 'Subdivision',
        category: 'Packing',
        description: 'Recursive rectangle / triangle subdivision, each cell hatched, cross-hatched or nested at its own tone.',
        fit: false,
        params: [
            { type: 'section', label: 'Subdivision' },
            { id: 'shape', label: 'Cells', type: 'select', value: 'rects', random: ['rects', 'rects', 'triangles', 'mixed', 'mixed'],
                options: [['rects', 'Rectangles'], ['triangles', 'Triangles'], ['mixed', 'Mixed']] },
            { id: 'depth', label: 'Max depth', type: 'range', min: 1, max: 12, step: 1, value: 7, random: [4, 9] },
            { id: 'minSize', label: 'Min cell size (mm)', type: 'range', min: 3, max: 80, step: 0.5, value: 11, random: [6, 26] },
            { id: 'stop', label: 'Stop chance', type: 'range', min: 0, max: 0.7, step: 0.01, value: 0.14, random: [0, 0.3],
                hint: 'Chance a cell stays whole at each level — gives a mix of large and small cells' },
            { id: 'jitter', label: 'Split randomness', type: 'range', min: 0, max: 1, step: 0.01, value: 0.75, random: [0.2, 1] },
            { id: 'diagonal', label: 'Diagonal splits', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3, random: [0.1, 0.6],
                show: p => p.shape === 'mixed', hint: 'Chance a rectangle is cut into two triangles' },
            { id: 'gap', label: 'Gap (mm)', type: 'range', min: 0, max: 10, step: 0.1, value: 2.2, random: [0.8, 4],
                hint: 'At 0 every cut is drawn once and fills start inside the cut lines' },
            { type: 'section', label: 'Fill' },
            { id: 'outline', label: 'Outline cells', type: 'checkbox', value: true, random: 0.8 },
            { id: 'wHatch', label: 'Hatch', type: 'range', min: 0, max: 1, step: 0.01, value: 1, random: [0.3, 1] },
            { id: 'wCross', label: 'Cross-hatch', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
            { id: 'wNested', label: 'Concentric', type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
            { id: 'wBlank', label: 'Blank', type: 'range', min: 0, max: 1, step: 0.01, value: 0.25, random: [0, 0.5] },
            { id: 'angles', label: 'Hatch angles', type: 'select', value: 'four', random: ['four', 'four', 'diag', 'free'],
                options: [['four', '0° / 45° / 90° / 135°'], ['diag', 'Diagonals'], ['free', 'Any']] },
            { id: 'sMin', label: 'Darkest spacing (mm)', type: 'range', min: 0.5, max: 4, step: 0.05, value: 0.9, random: [0.9, 1.5] },
            { id: 'sMax', label: 'Lightest spacing (mm)', type: 'range', min: 1, max: 10, step: 0.1, value: 3.2, random: [2, 5] },
            { id: 'tones', label: 'Tones', type: 'range', min: 1, max: 8, step: 1, value: 4, random: false },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
        ],

        randomize(rng, p) {
            // without outlines a blank cell is a hole in the quilt: keep them rare
            return p.outline ? {} : { wBlank: +rng.range(0, 0.12).toFixed(2) };
        },

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const area = ctx.shape.polygon();
            if (!area.length) return [];
            const whole = area.length === 4 && area.every(v => (v[0] === 0 || v[0] === W) && (v[1] === 0 || v[1] === H));
            const minS = p.minSize, jit = p.jitter;
            const leaves = [], cuts = []; // cuts: every split line once, for gap 0

            const triSize = t => {
                let L = 0;
                for (let i = 0; i < 3; i++) L = Math.max(L, geo.dist(t[i], t[(i + 1) % 3]));
                return (2 * Math.abs(geo.polygonArea(t)) / L) * Math.SQRT2;
            };
            function splitTri(t, depth) {
                if (depth >= p.depth || (depth >= 2 && rng.chance(p.stop))) { leaves.push(t); return; }
                let k = 0, best = -1;
                for (let i = 0; i < 3; i++) {
                    const L = geo.dist2(t[i], t[(i + 1) % 3]);
                    if (L > best) { best = L; k = i; }
                }
                const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
                const m = geo.lerpPt(a, b, 0.5 + jit * rng.range(-0.15, 0.15));
                const t1 = [a, m, c], t2 = [m, b, c];
                if (Math.min(triSize(t1), triSize(t2)) < minS) { leaves.push(t); return; }
                cuts.push([m, c]);
                splitTri(t1, depth + 1);
                splitTri(t2, depth + 1);
            }
            function toTris(x0, y0, x1, y1, depth) {
                const A = [x0, y0], B = [x1, y0], C = [x1, y1], D = [x0, y1];
                if (rng.chance(0.5)) { cuts.push([A, C]); splitTri([A, B, C], depth); splitTri([A, C, D], depth); }
                else { cuts.push([B, D]); splitTri([A, B, D], depth); splitTri([B, C, D], depth); }
            }
            function splitRect(x0, y0, x1, y1, depth) {
                const w = x1 - x0, h = y1 - y0;
                const leaf = () => leaves.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
                if (depth >= p.depth || (depth >= 2 && rng.chance(p.stop))) return leaf();
                if (p.shape === 'mixed' && depth >= 1 && Math.min(w, h) >= minS * 1.4 && rng.chance(p.diagonal)) {
                    return toTris(x0, y0, x1, y1, depth + 1);
                }
                const t = 0.5 + jit * rng.range(-0.2, 0.2);
                let vert = w > h * 1.25 ? true : h > w * 1.25 ? false : rng.chance(0.5);
                const can = v => (v ? w : h) * Math.min(t, 1 - t) >= minS;
                if (!can(vert)) vert = !vert;
                if (!can(vert)) return leaf();
                if (vert) {
                    const x = x0 + w * t;
                    cuts.push([[x, y0], [x, y1]]);
                    splitRect(x0, y0, x, y1, depth + 1); splitRect(x, y0, x1, y1, depth + 1);
                } else {
                    const y = y0 + h * t;
                    cuts.push([[x0, y], [x1, y]]);
                    splitRect(x0, y0, x1, y, depth + 1); splitRect(x0, y, x1, y1, depth + 1);
                }
            }
            // start from the clip region's bounding box (the canvas for a plain page)
            const bb = geo.bbox([area]);
            if (p.shape === 'triangles') toTris(bb.minX, bb.minY, bb.maxX, bb.maxY, 0);
            else splitRect(bb.minX, bb.minY, bb.maxX, bb.maxY, 0);

            // ---- fills
            const nT = Math.max(1, Math.round(p.tones));
            const lo = Math.min(p.sMin, p.sMax), hi = Math.max(p.sMin, p.sMax);
            const tone = () => {
                const i = rng.int(0, nT - 1);
                return nT === 1 ? lo : lo * Math.pow(hi / lo, i / (nT - 1));
            };
            const angle = () => {
                if (p.angles === 'free') return rng.range(0, Math.PI);
                return geo.rad(rng.pick(p.angles === 'diag' ? [45, 135] : [0, 45, 90, 135]));
            };
            const weights = [[p.wHatch, 'hatch'], [p.wCross, 'cross'], [p.wNested, 'nested'], [p.wBlank, 'blank']];
            const anyFill = weights.some(w => w[0] > 0);
            const layers = Array.from({ length: Math.max(1, p.pens) }, () => []);

            // Gap 0: cells share their edges, so the outline is the boundary plus
            // every cut drawn once, and fills start inside it so none retrace it
            const shared = !(p.gap > 0);
            if (shared && p.outline) layers[0].push(geo.close(area), ...cuts);
            for (let poly of leaves) {
                if (!whole) poly = intersectConvex(poly, area);
                if (poly.length < 3) continue;
                if (p.gap > 0) poly = geo.cleanPolygon(geo.insetConvex(poly, p.gap / 2));
                if (poly.length < 3 || Math.abs(geo.polygonArea(poly)) < 1) continue;
                const out = layers[rng.int(0, layers.length - 1)];
                const kind = anyFill ? rng.weighted(weights) : 'blank';
                const s = tone();
                if (kind === 'nested') {
                    // at gap 0 the first ring sits one spacing inside the cut lines
                    // (half a spacing without them, so neighbours' rings stay one apart)
                    const ring = shared ? geo.cleanPolygon(geo.insetConvex(poly, p.outline ? s : s / 2)) : poly;
                    if (ring.length >= 3) out.push(geo.insetSpiral(ring, s));
                    continue;
                }
                if (p.outline && !shared) out.push(geo.close(poly));
                if (kind === 'hatch' || kind === 'cross') {
                    const a = angle();
                    const ss = kind === 'cross' ? s * 1.5 : s;
                    // at gap 0 the zig-zag's rim runs half a spacing in, off the cut lines
                    if (shared) poly = geo.cleanPolygon(geo.insetConvex(poly, ss / 2));
                    const z = geo.hatchZigzag(poly, ss, a);
                    if (z.length > 1) out.push(z);
                    if (kind === 'cross') {
                        const z2 = geo.hatchZigzag(poly, ss, a + Math.PI / 2);
                        if (z2.length > 1) out.push(z2);
                    }
                }
            }
            return p.pens > 1 ? { layers } : layers[0];
        },
    });
})();
