/*
 * Whirls — pursuit polygons. Each vertex of a polygon chases the next one:
 * the next polygon's vertices are lerp(v_i, v_i+1, t), and repeating this
 * traces the classic whirling spiral whose envelopes are pursuit curves
 * (the "mice problem"). In spiral style the whole cell is one stroke: with
 * Q_0..Q_n-1 the polygon's vertices, Q_j = lerp(Q_j-n, Q_j-n+1, t), and
 * consecutive Q's are joined. Tiled with alternating chirality this gives the
 * well-known whirl patterns; cell outlines are drawn once as a separate,
 * de-duplicated layer so shared edges are never plotted twice.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const S2 = Math.SQRT2, S3 = Math.sqrt(3), D = Math.PI / 180;
    const ngon = (cx, cy, n, rotDeg) => geo.ngon(cx, cy, 1 / (2 * Math.sin(Math.PI / n)), n, rotDeg * D);

    // Unit-edge tilings: lattice a, b; polygons with a colour class;
    // class of a copy at lattice (i, j) = (cls + ci·i + cj·j) mod m.
    const TILINGS = {
        square: { a: [1, 0], b: [0, 1], ci: 1, cj: 1, m: 2, polys: [[ngon(0, 0, 4, 45), 0]] },
        triangle: {
            a: [1, 0], b: [0.5, S3 / 2], ci: 0, cj: 0, m: 2,
            polys: [[[[0, 0], [1, 0], [0.5, S3 / 2]], 0], [[[1, 0], [1.5, S3 / 2], [0.5, S3 / 2]], 1]],
        },
        hex: { a: [S3, 0], b: [S3 / 2, 1.5], ci: 1, cj: 2, m: 3, polys: [[ngon(0, 0, 6, 30), 0]] },
        octagon: (() => {
            const h = 0.5 + S2 / 2, w = 1 + S2;
            return { a: [w, 0], b: [0, w], ci: 0, cj: 0, m: 2, polys: [[ngon(0, 0, 8, 22.5), 0], [ngon(h, h, 4, 0), 1]] };
        })(),
        trihex: {
            a: [2, 0], b: [1, S3], ci: 0, cj: 0, m: 3,
            polys: [[ngon(0, 0, 6, 0), 0], [[[1, 0], [1.5, S3 / 2], [0.5, S3 / 2]], 1], [[[0.5, -S3 / 2], [1.5, -S3 / 2], [1, 0]], 2]],
        },
    };

    // Shrink factor of a regular n-gon per pursuit step.
    const shrink = (n, t) => Math.sqrt(t * t + (1 - t) * (1 - t) - 2 * t * (1 - t) * Math.cos(Math.PI - TAU / n));

    // Radius of a vertex set about its mean.
    function radius(pts) {
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p[0]; cy += p[1]; }
        cx /= pts.length; cy /= pts.length;
        let r = 0;
        for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy));
        return r;
    }

    PG.register({
        id: 'whirl',
        name: 'Whirls',
        category: 'Tiles',
        description: 'Pursuit polygons spiralling inwards, alone or tiled with alternating chirality.',
        fit: false,
        params: [
            { type: 'section', label: 'Layout' },
            { id: 'layout', label: 'Layout', type: 'select', value: 'square',
                options: [['single', 'Single polygon'], ['square', 'Squares'], ['triangle', 'Triangles'], ['hex', 'Hexagons'],
                    ['octagon', 'Octagons + squares (4.8.8)'], ['trihex', 'Hexagons + triangles (3.6.3.6)']] },
            { id: 'sides', label: 'Sides', type: 'range', min: 3, max: 12, step: 1, value: 5, show: p => p.layout === 'single' },
            { id: 'cell', label: 'Edge length (mm)', type: 'range', min: 6, max: 120, step: 1, value: 44, random: false,
                show: p => p.layout !== 'single' },
            { id: 'chirality', label: 'Direction', type: 'select', value: 'alternate', show: p => p.layout !== 'single',
                options: [['alternate', 'Alternate neighbours'], ['same', 'All the same'], ['random', 'Random']] },
            { type: 'section', label: 'Pursuit' },
            { id: 't', label: 'Step (t)', type: 'range', min: 0.02, max: 0.5, step: 0.005, value: 0.12, random: false,
                hint: 'How far each vertex moves towards the next one per step' },
            { id: 'steps', label: 'Steps (0 = auto)', type: 'range', min: 0, max: 300, step: 1, value: 0, random: false },
            { id: 'minSize', label: 'Stop at radius (mm)', type: 'range', min: 0.3, max: 20, step: 0.1, value: 1.5, random: [0.8, 3.5],
                show: p => p.steps === 0, hint: 'Auto mode stops once the polygon is this small' },
            { id: 'style', label: 'Style', type: 'select', value: 'spiral', random: ['spiral', 'spiral', 'spiral', 'nested'],
                options: [['spiral', 'One continuous spiral'], ['nested', 'Nested polygons']] },
            { id: 'outline', label: 'Cell outlines', type: 'checkbox', value: true, random: 0.75 },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 3, step: 1, value: 1, random: false,
                hint: 'Alternate cells between pens (outlines stay on pen 1)' },
        ],

        randomize(rng) {
            const layout = rng.weighted([[2, 'single'], [3, 'square'], [2, 'triangle'], [2, 'hex'], [1, 'octagon'], [1, 'trihex']]);
            const out = { layout, chirality: rng.weighted([[6, 'alternate'], [2, 'same'], [2, 'random']]), steps: 0 };
            if (layout === 'single') {
                out.sides = rng.weighted([[3, 3], [4, 4], [3, 5], [3, 6], [1, 7], [2, 8], [1, 10]]);
                out.t = +rng.range(0.03, 0.09).toFixed(3);
                out.minSize = +rng.range(1.5, 5).toFixed(1);
                return out;
            }
            // dominant polygon, and the largest edge that still shows a pattern on A4
            const [n, maxE] = { square: [4, 80], triangle: [3, 100], hex: [6, 48], octagon: [8, 42], trihex: [6, 56] }[layout];
            let t = n <= 4 ? rng.range(0.07, 0.2) : rng.range(0.14, 0.3);
            // total line on A4 ≈ area · perimeter/area / (1 − f); aim for 15–40 m
            const len = (e, tt) => (48000 * 4 * Math.tan(Math.PI / n)) / (e * (1 - shrink(n, tt)));
            const target = rng.range(15000, 38000);
            let e = geo.clamp(len(1, t) / target, 12, maxE);
            while (len(e, t) > 45000 && t < 0.45) t += 0.01;
            out.t = +t.toFixed(3);
            out.cell = Math.round(e);
            return out;
        },

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const t = geo.clamp(p.t, 0.005, 0.5);
            // auto mode runs until the polygon reaches the stop radius (small steps on
            // big polygons can need well over 300); the point budget below still applies
            const maxSteps = p.steps > 0 ? Math.min(300, p.steps | 0) : 3000;
            const minR = p.steps > 0 ? 0 : Math.max(0.05, p.minSize);

            // cells: { poly (open vertex list), cls }
            const cells = [];
            if (p.layout === 'single') {
                const n = Math.max(3, p.sides | 0);
                const poly = geo.ngon(0, 0, 1, n, Math.PI / 2 - Math.PI / n); // flat bottom edge
                const bb = geo.bbox([poly]);
                const k = Math.min(W / bb.w, H / bb.h);
                const cx = W / 2 - ((bb.minX + bb.maxX) / 2) * k, cy = H / 2 - ((bb.minY + bb.maxY) / 2) * k;
                cells.push({ poly: poly.map(q => [cx + q[0] * k, cy + q[1] * k]), cls: 0 });
            } else {
                const T = TILINGS[p.layout] || TILINGS.square;
                const k = p.cell;
                const a = [T.a[0] * k, T.a[1] * k], b = [T.b[0] * k, T.b[1] * k];
                const det = a[0] * b[1] - a[1] * b[0];
                const pad = 2 * k;
                let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
                for (const [x, y] of [[-pad, -pad], [W + pad, -pad], [-pad, H + pad], [W + pad, H + pad]]) {
                    const dx = x - W / 2, dy = y - H / 2;
                    const i = (dx * b[1] - dy * b[0]) / det, j = (a[0] * dy - a[1] * dx) / det;
                    i0 = Math.min(i0, Math.floor(i)); i1 = Math.max(i1, Math.ceil(i));
                    j0 = Math.min(j0, Math.floor(j)); j1 = Math.max(j1, Math.ceil(j));
                }
                for (let i = i0; i <= i1; i++) {
                    for (let j = j0; j <= j1; j++) {
                        const ox = W / 2 + i * a[0] + j * b[0], oy = H / 2 + i * a[1] + j * b[1];
                        for (const [P, c] of T.polys) {
                            const poly = P.map(q => [ox + q[0] * k, oy + q[1] * k]);
                            const bb = geo.bbox([poly]);
                            if (bb.maxX < 0 || bb.minX > W || bb.maxY < 0 || bb.minY > H) continue;
                            cells.push({ poly, cls: (((c + T.ci * i + T.cj * j) % T.m) + T.m) % T.m });
                        }
                    }
                }
            }

            // guard: keep the total number of points bounded
            const budget = 400000;
            let perCell = maxSteps;
            const est = cells.reduce((s, c) => s + c.poly.length, 0);
            if (est * perCell > budget) perCell = Math.max(4, Math.floor(budget / est));

            const pens = Math.max(1, p.pens | 0);
            const layers = Array.from({ length: pens }, () => []);
            const outline = [];
            const seen = new Set();
            const key = q => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;

            for (const cell of cells) {
                let poly = cell.poly;
                if (geo.polygonArea(poly) < 0) poly = poly.slice().reverse();
                const flip = p.layout === 'single' ? false
                    // every trihex edge joins a hexagon (class 0) to a triangle (classes 1, 2)
                    : p.chirality === 'alternate' ? (p.layout === 'trihex' ? cell.cls > 0 : cell.cls % 2 === 1)
                        : p.chirality === 'random' ? rng.chance(0.5) : false;
                if (flip) poly = poly.slice().reverse();
                const n = poly.length;
                const out = layers[cell.cls % pens];

                if (p.outline) {
                    for (let i = 0; i < n; i++) {
                        const q0 = poly[i], q1 = poly[(i + 1) % n];
                        const k0 = key(q0), k1 = key(q1), kk = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
                        if (!seen.has(kk)) { seen.add(kk); outline.push([q0, q1]); }
                    }
                }

                if (p.style === 'nested') {
                    let cur = poly;
                    for (let s = 0; s < perCell; s++) {
                        const next = cur.map((q, i) => geo.lerpPt(q, cur[(i + 1) % n], t));
                        if (radius(next) < minR) break;
                        out.push(geo.close(next));
                        cur = next;
                    }
                } else {
                    // one pursuit sequence; start at Q_n (on the first edge) so the
                    // outline itself is left to the de-duplicated outline layer
                    const Q = poly.slice();
                    const path = [];
                    for (let j = n; j < n * (perCell + 1); j++) {
                        Q.push(geo.lerpPt(Q[j - n], Q[j - n + 1], t));
                        path.push(Q[j]);
                        if ((j + 1) % n === 0 && radius(Q.slice(j + 1 - n, j + 1)) < minR) break;
                    }
                    if (path.length > 1) out.push(path);
                }
            }
            layers[0].push(...outline);
            return pens > 1 ? { layers } : layers[0];
        },
    });
})();
