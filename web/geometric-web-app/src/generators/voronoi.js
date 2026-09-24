/*
 * Voronoi — cells built directly by half-plane clipping: each seed's cell
 * starts as the drawing area and is cut by the perpendicular bisector to every
 * nearby seed, visiting a bucket grid ring by ring and stopping once the
 * remaining seeds lie further than twice the cell's radius. Lloyd relaxation
 * then moves each seed to its cell's (density-weighted) centroid for even,
 * organic cells. Seeds can be uniform, clustered by noise, or crowd toward the
 * centre. Cells are drawn as nested insets (one joined stroke per cell),
 * zig-zag hatching, or outlines, optionally with rounded corners.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Closed ring starting at vertex `start`, optionally with rounded corners.
    function ring(poly, start, round) {
        const n = poly.length, pts = [];
        for (let i = 0; i <= n; i++) pts.push(poly[(start + i) % n]);
        return round > 0 ? geo.roundCorners(pts, round * 0.5, 6) : pts;
    }

    PG.register({
        id: 'voronoi',
        name: 'Voronoi',
        category: 'Packing',
        description: 'Relaxed Voronoi cells filled with nested insets, hatching or outlines.',
        fit: false,
        params: [
            { type: 'section', label: 'Cells' },
            { id: 'cells', label: 'Cells', type: 'range', min: 5, max: 600, step: 1, value: 90, random: [25, 220] },
            { id: 'relax', label: 'Relaxation', type: 'range', min: 0, max: 30, step: 1, value: 8, random: [3, 12],
                hint: 'Lloyd iterations — moves seeds to their cell centroids for even cells' },
            { id: 'dist', label: 'Seeds', type: 'select', value: 'uniform', random: true,
                options: [['uniform', 'Uniform'], ['noise', 'Noise clusters'], ['radial', 'Dense centre']] },
            { id: 'contrast', label: 'Density contrast', type: 'range', min: 0, max: 1, step: 0.01, value: 0.85, random: [0.5, 0.92],
                show: p => p.dist !== 'uniform' },
            { id: 'scale', label: 'Cluster size (mm)', type: 'range', min: 20, max: 400, step: 1, value: 90, random: [50, 200],
                show: p => p.dist === 'noise' },
            { type: 'section', label: 'Style' },
            { id: 'style', label: 'Style', type: 'select', value: 'nested', random: ['nested', 'nested', 'hatch', 'mixed', 'mixed', 'outline'],
                options: [['nested', 'Nested insets'], ['hatch', 'Hatch'], ['outline', 'Outline'], ['mixed', 'Mixed']] },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.6, max: 6, step: 0.05, value: 1.5, random: [1, 2.6],
                show: p => p.style !== 'outline' },
            { id: 'gap', label: 'Gap (mm)', type: 'range', min: 0, max: 10, step: 0.1, value: 3, random: [1.2, 4.5] },
            { id: 'round', label: 'Corner rounding', type: 'range', min: 0, max: 1, step: 0.01, value: 0, random: [0, 1] },
            { id: 'rim', label: 'Outline hatched cells', type: 'checkbox', value: true,
                show: p => p.style === 'hatch' || p.style === 'mixed' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Pen per', type: 'select', value: 'random', show: p => p.pens > 1,
                options: [['random', 'Random cell'], ['region', 'Region'], ['style', 'Style']] },
        ],

        randomize(rng, p) {
            // rounding is either off or clearly visible
            const out = { round: rng.chance(0.55) ? 0 : +rng.range(0.5, 1).toFixed(2) };
            // a density gradient only reads with enough cells; with few, the
            // sparse side becomes a handful of page-sized cells
            if (p.dist !== 'uniform') out.cells = Math.max(p.cells, rng.int(90, 220));
            return out;
        },

        generate(p, ctx) {
            const { rng, noise } = ctx;
            const area = ctx.shape.polygon();
            if (!area.length) return [];
            const bb = geo.bbox([area]);
            const sgn = geo.polygonArea(area) > 0 ? 1 : -1;
            const areaDist = (x, y) => { // signed distance to the (convex) area polygon, > 0 inside
                let d = Infinity;
                for (let i = 0, n = area.length; i < n; i++) {
                    const a = area[i], b = area[(i + 1) % n];
                    const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
                    d = Math.min(d, (sgn * ((x - a[0]) * -ey + (y - a[1]) * ex)) / L);
                }
                return d;
            };
            const inside = (x, y) => areaDist(x, y) >= 0 && ctx.shape.dist(x, y) > 0;

            // ---- density
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            const R = Math.hypot(bb.w, bb.h) / 2, sc = 1 / p.scale, k = p.contrast;
            let dens = () => 1;
            if (p.dist === 'noise') {
                dens = (x, y) => geo.lerp(1, 0.02 + 0.98 * geo.smoothstep(-0.25, 0.35, noise.fbm2(x * sc, y * sc, 2)), k);
            } else if (p.dist === 'radial') {
                dens = (x, y) => { const t = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / (R * 0.8)); return geo.lerp(1, 0.03 + 0.97 * t * t, k); };
            }

            // ---- seeds (rejection sampling)
            const N = Math.max(2, Math.round(p.cells));
            const seeds = [];
            for (let t = 0; t < N * 400 && seeds.length < N; t++) {
                const x = rng.range(bb.minX, bb.maxX), y = rng.range(bb.minY, bb.maxY);
                if (inside(x, y) && rng.random() < dens(x, y)) seeds.push([x, y]);
            }
            if (seeds.length < 2) return [geo.close(area)];

            // ---- Voronoi by half-plane clipping, neighbours from a bucket grid
            const cs = Math.sqrt((bb.w * bb.h) / seeds.length);
            const gx = Math.max(1, Math.ceil(bb.w / cs)), gy = Math.max(1, Math.ceil(bb.h / cs));
            const whole = area.length === 4 && area.every(v => (v[0] === 0 || v[0] === ctx.width) && (v[1] === 0 || v[1] === ctx.height));
            function voronoi() {
                const grid = Array.from({ length: gx * gy }, () => []);
                const cellOf = q => [geo.clamp(Math.floor((q[0] - bb.minX) / cs), 0, gx - 1), geo.clamp(Math.floor((q[1] - bb.minY) / cs), 0, gy - 1)];
                seeds.forEach((q, i) => { const [a, b] = cellOf(q); grid[b * gx + a].push(i); });
                const box = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]];
                return seeds.map((s, i) => {
                    let poly = box;
                    const [ci, cj] = cellOf(s);
                    for (let r = 0; r <= Math.max(gx, gy); r++) {
                        for (let j = cj - r; j <= cj + r; j++) {
                            if (j < 0 || j >= gy) continue;
                            const edge = j === cj - r || j === cj + r;
                            for (let a = ci - r; a <= ci + r; a += edge ? 1 : 2 * r) {
                                if (a < 0 || a >= gx) continue;
                                for (const o of grid[j * gx + a]) {
                                    if (o === i) continue;
                                    const q = seeds[o];
                                    const n = [s[0] - q[0], s[1] - q[1]];
                                    poly = geo.clipPolygonHalfPlane(poly, [(s[0] + q[0]) / 2, (s[1] + q[1]) / 2], n);
                                }
                            }
                        }
                        let rad = 0;
                        for (const v of poly) rad = Math.max(rad, geo.dist2(v, s));
                        if (r * cs >= 2 * Math.sqrt(rad)) break;
                    }
                    if (!whole && poly.some(v => areaDist(v[0], v[1]) < -1e-9)) {
                        for (let e = 0; e < area.length && poly.length >= 3; e++) {
                            const a = area[e], b = area[(e + 1) % area.length];
                            poly = geo.clipPolygonHalfPlane(poly, a, [-(b[1] - a[1]) * sgn, (b[0] - a[0]) * sgn]);
                        }
                    }
                    return geo.cleanPolygon(poly);
                });
            }
            // density-weighted centroid: fan triangles, each split in four
            function centroid(poly) {
                if (p.dist === 'uniform') return geo.centroid(poly);
                let sx = 0, sy = 0, sw = 0;
                const A = poly[0];
                for (let i = 1; i + 1 < poly.length; i++) {
                    const B = poly[i], C = poly[i + 1];
                    const a = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 8;
                    const ab = geo.lerpPt(A, B, 0.5), bc = geo.lerpPt(B, C, 0.5), ca = geo.lerpPt(C, A, 0.5);
                    for (const [u, v, w] of [[A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]]) {
                        const x = (u[0] + v[0] + w[0]) / 3, y = (u[1] + v[1] + w[1]) / 3;
                        const d = dens(x, y), wt = a * d * d * d; // CVT point density follows sqrt(weight), so sharpen it
                        sx += x * wt; sy += y * wt; sw += wt;
                    }
                }
                return sw > 0 ? [sx / sw, sy / sw] : geo.centroid(poly);
            }

            let cells = voronoi();
            for (let it = 0; it < p.relax; it++) {
                cells.forEach((c, i) => { if (c.length >= 3) seeds[i] = centroid(c); });
                cells = voronoi();
            }

            // ---- draw
            const pens = Math.max(1, p.pens);
            const layers = Array.from({ length: pens }, () => []);
            const STY = ['nested', 'hatch', 'outline'];
            cells.forEach((c, i) => {
                let poly = p.gap > 0 ? geo.cleanPolygon(geo.insetConvex(c, p.gap / 2)) : c;
                if (poly.length < 3 || Math.abs(geo.polygonArea(poly)) < 0.5) return;
                let style = p.style;
                if (style === 'mixed') style = rng.weighted([[5, 'nested'], [3, 'hatch'], [1.5, 'outline']]);
                let pen = 0;
                if (pens > 1) {
                    if (p.penMode === 'style') pen = STY.indexOf(style);
                    else if (p.penMode === 'region') {
                        const s = seeds[i], v = noise.noise2(s[0] * 0.006 + 31, s[1] * 0.006 - 17);
                        pen = Math.floor(geo.clamp((v + 1) / 2, 0, 0.999) * pens);
                    } else pen = rng.int(0, pens - 1);
                }
                const out = layers[pen % pens];
                if (style === 'nested') out.push(geo.insetSpiral(poly, p.spacing, p.round));
                else if (style === 'hatch') {
                    // a rounded convex cell is still convex, so hatch the rounded outline
                    const rim = ring(poly, 0, p.round);
                    const z = geo.hatchZigzag(p.round > 0 ? geo.cleanPolygon(rim.slice(0, -1), 1e-3) : poly, p.spacing, rng.range(0, Math.PI));
                    if (z.length > 1) out.push(z);
                    if (p.rim || z.length < 2) out.push(rim);
                } else out.push(ring(poly, 0, p.round));
            });
            return pens > 1 ? { layers } : layers[0];
        },
    });
})();
