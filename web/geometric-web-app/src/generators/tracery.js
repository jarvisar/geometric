/*
 * Gothic window tracery, set out the way the masons did it: pointed arches
 * struck from two centers on the springing line, and circles that touch them.
 *
 * A window is a skeleton of center lines (arcs, circles and straight
 * mullions). The stone is everything within half a bar's width of one, and
 * every gap left inside the frame is a pane of glass, so bars that touch run
 * into each other and the leftover spandrels come out glazed, as in real bar
 * tracery. Each level of the design is an "order" with thinner bars than the
 * one before.
 *
 * Offsetting all those arcs and trimming them where they meet is the fiddly
 * part, so it isn't done. The distance to the nearest bar is sampled on a
 * fine grid and the edges are traced as contours of it. Cusps and foils are
 * solid shapes cut out of the same field, moulding lines are a second, thinner
 * copy of the bars, and the glass is found by flood fill.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const STONE = 0, MOULD = 1, FRAME = 2, LIGHT = 3, LIGHT2 = 4, FOIL = 5, FOIL2 = 6, SPANDREL = 7;
    const FAR = 1e9;
    const SPECK = 3; // mm round
    const SMALL = 2.5; // mm. A lobe has to be this much bigger than the glass border to be worth drawing.
    const CLEAR = 0.6; // mm. Lines of the same pen running closer than this merge into one fat line.
    const LOBES = 0.85; // gap between the centers of neighbouring lobes, in lobe diameters. Under 1 they overlap into a pointed cusp.

    // A pointed arch standing on the chord a -> b. `sharp` is the radius of its two arcs
    // in chord lengths: 0.5 is a round arch, 1 equilateral, more than that a lancet.
    function arch(a, b, sharp) {
        const w = geo.dist(a, b), u = [(b[0] - a[0]) / w, (b[1] - a[1]) / w];
        const n = [u[1], -u[0]]; // the side it stands on: up, for a chord running left to right
        const R = sharp * w, rise = w * Math.sqrt(sharp - 0.25), mid = geo.lerpPt(a, b, 0.5);
        return {
            a, b, w, u, n, R, mid, off: R - w / 2,
            cl: [a[0] + u[0] * R, a[1] + u[1] * R], // center of the arc rising from a
            cr: [b[0] - u[0] * R, b[1] - u[1] * R],
            apex: [mid[0] + n[0] * rise, mid[1] + n[1] * rise],
        };
    }

    PG.register({
        id: 'tracery',
        name: 'Gothic Tracery',
        category: 'Tiles',
        description: 'Cathedral windows drawn with compass and straightedge: pointed lights under foiled circles, rose windows and intersecting tracery, glazed in color.',
        fit: false,
        params: [
            { type: 'section', label: 'Window' },
            { id: 'style', label: 'Style', type: 'select', value: 'geometric',
                random: ['geometric', 'geometric', 'geometric', 'rose', 'rose', 'intersecting'],
                options: [['geometric', 'Geometric'], ['intersecting', 'Intersecting'], ['rose', 'Rose window']] },
            { id: 'lights', label: 'Lights', type: 'range', min: 1, max: 8, step: 1, value: 4, random: [2, 8],
                show: p => p.style !== 'rose', hint: 'Even numbers split in two under a circle, again and again. Odd ones stand in a row' },
            { id: 'sharp', label: 'Arch sharpness', type: 'range', min: 0.6, max: 1.8, step: 0.01, value: 1, random: [0.8, 1.4],
                show: p => p.style !== 'rose', hint: 'Radius of the arcs in widths of the arch. 1 is equilateral, more is a lancet' },
            { id: 'tall', label: 'Height', type: 'range', min: 1, max: 2.6, step: 0.05, value: 1.5, random: [1.3, 2],
                show: p => p.style !== 'rose', hint: 'Height of the opening in widths' },
            { id: 'petals', label: 'Petals', type: 'range', min: 6, max: 16, step: 2, value: 12, random: [8, 14], show: p => p.style === 'rose' },
            { id: 'tiers', label: 'Rings of petals', type: 'range', min: 1, max: 2, step: 1, value: 2, show: p => p.style === 'rose',
                hint: 'The outer ring has twice the petals' },
            { type: 'section', label: 'Stone' },
            { id: 'bar', label: 'Mullion width (mm)', type: 'range', min: 2, max: 10, step: 0.1, value: 5, random: [3.5, 6.5] },
            { id: 'taper', label: 'Taper', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.7, random: [0.6, 0.8],
                hint: 'How much thinner each order of tracery is than the one it springs from' },
            { id: 'oculus', label: 'Large circles', type: 'select', value: 'foil', random: ['foil', 'foil', 'wheel', 'circles'],
                show: p => p.style === 'geometric', hint: 'What the big circles hold. Small ones always get foils',
                options: [['foil', 'Foils'], ['wheel', 'Wheel of lights'], ['circles', 'Ring of circles']] },
            { id: 'foils', label: 'Foils', type: 'range', min: 3, max: 8, step: 1, value: 5, random: [3, 8],
                hint: 'Lobes in the largest foiled circle' },
            { id: 'cusps', label: 'Cusped heads', type: 'checkbox', value: true, random: 0.8 },
            { id: 'mould', label: 'Moulding lines', type: 'checkbox', value: true, random: 0.8 },
            { type: 'section', label: 'Glass' },
            { id: 'fill', label: 'Glazing', type: 'select', value: 'quarry', random: ['quarry', 'quarry', 'hatch', 'echo'],
                options: [['quarry', 'Diamond quarries'], ['hatch', 'Hatching'], ['echo', 'Nested outlines'], ['none', 'Outline only']] },
            { id: 'spacing', label: 'Spacing (mm)', type: 'range', min: 1, max: 10, step: 0.1, value: 4, random: [3, 6],
                show: p => p.fill !== 'none' },
            { id: 'inset', label: 'Border (mm)', type: 'range', min: 0.5, max: 3, step: 0.05, value: 1, random: false,
                hint: 'Gap between the stone and the glass lines, so colored ink stays off the black' },
        ],

        randomize(rng, p) {
            // thick bars swallow the lights of a busy window
            if (p.style !== 'rose' && p.lights > 5) return { bar: +rng.range(3, 4.5).toFixed(1) };
        },

        generate(p, ctx) {
            const bb = geo.bbox([ctx.shape.polygon()]);
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            const taper = geo.clamp(p.taper, 0.3, 1);
            const hwOf = order => Math.max(0.4, (p.bar / 2) * Math.pow(taper, order));
            const hw0 = hwOf(0), HOOD = Math.max(1.5, hw0 * 0.8), SILL = Math.max(2.5, hw0 * 1.4);
            const out = PG.pens.partLayers('tracery', p), frame = out.of(FRAME);
            const inset = Math.max(0.3, p.inset), spacing = Math.max(0.8, p.spacing);

            // ---- the skeleton
            const bars = [], solids = [], seeds = [];
            const seg = (a, b, order) => bars.push({ line: true, ax: a[0], ay: a[1], bx: b[0], by: b[1], order,
                box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
            const ring = (c, r, order) => bars.push({ full: true, cx: c[0], cy: c[1], r, order, box: [c[0] - r, c[1] - r, c[0] + r, c[1] + r] });
            // the arc of the circle round c from a to b, the short way
            const arc = (c, a, b, order) => {
                const r = geo.dist(c, a), ux = (a[0] - c[0]) / r, uy = (a[1] - c[1]) / r, vx = (b[0] - c[0]) / r, vy = (b[1] - c[1]) / r;
                const mx = ux + vx, my = uy + vy, ml = Math.hypot(mx, my) || 1, m = [c[0] + (r * mx) / ml, c[1] + (r * my) / ml];
                const sag = r * (1 - Math.cos(Math.acos(geo.clamp(ux * vx + uy * vy, -1, 1)) / 4));
                bars.push({ cx: c[0], cy: c[1], r, ux, uy, vx, vy, dir: ux * vy - uy * vx < 0 ? -1 : 1, ax: a[0], ay: a[1], bx: b[0], by: b[1], order,
                    box: [Math.min(a[0], b[0], m[0]) - sag, Math.min(a[1], b[1], m[1]) - sag, Math.max(a[0], b[0], m[0]) + sag, Math.max(a[1], b[1], m[1]) + sag] });
            };
            const seed = (q, part) => seeds.push([q[0], q[1], part]);
            const head = (A, order) => { arc(A.cl, A.a, A.apex, order); arc(A.cr, A.b, A.apex, order); };

            // A foiled circle: n round lobes inside the ring of radius rho, as a solid cusp
            // between each pair. `rot` points one lobe.
            const foil = (c, rho, n, rot, hw) => {
                const rin = rho - hw, lobe = m => rin - rin / (1 + Math.sin(Math.PI / m) / LOBES);
                // fewer lobes if they'd be too small to draw, and none if three are
                while (n > 3 && lobe(n) < inset + SMALL) n--;
                if (lobe(n) < inset + SMALL) return;
                const f = lobe(n), d = rin - f;
                const cs = Array.from({ length: n }, (_, i) => [c[0] + d * Math.cos(rot + (TAU * i) / n), c[1] + d * Math.sin(rot + (TAU * i) / n)]);
                solids.push({ box: [c[0] - rho, c[1] - rho, c[0] + rho, c[1] + rho], fn(x, y) {
                    const dc = Math.hypot(x - c[0], y - c[1]);
                    if (dc >= rho) return FAR;
                    let v = d - dc; // the middle is open
                    for (const q of cs) v = Math.max(v, f - Math.hypot(x - q[0], y - q[1]));
                    return Math.max(v, dc - rho);
                } });
            };
            // A trefoil in the head of an arch: a round lobe at each springing and one under
            // the apex, all touching the arch, with a cusp where two of them cross. Above
            // the top lobe the glass carries on up into the point. Below the chord the light
            // is left open, so it works for the wedge lights of a rose too.
            const cusp = (A, hw) => {
                const hwi = A.w / 2 - hw, Rg = A.R - hw;
                if (!p.cusps || hwi < 3) return;
                // the lobe radius that leaves the top lobe LOBES diameters from the side ones
                const topAt = f => Math.sqrt(Math.max(0, (Rg - f) * (Rg - f) - A.off * A.off));
                let f = 0, hi = hwi;
                for (let i = 0; i < 40; i++) {
                    const m = (f + hi) / 2;
                    if (Math.hypot(hwi - m, topAt(m)) > 2 * m * LOBES) f = m; else hi = m;
                }
                if (f < inset + SMALL) return;
                const ht = topAt(f), sl = hwi - f, touch = (ht * Rg) / (Rg - f); // where the top lobe meets the arch
                solids.push({ box: [Math.min(A.a[0], A.b[0], A.apex[0]), Math.min(A.a[1], A.b[1], A.apex[1]), Math.max(A.a[0], A.b[0], A.apex[0]), Math.max(A.a[1], A.b[1], A.apex[1])],
                    fn(x, y) {
                        const dx = x - A.mid[0], dy = y - A.mid[1], s = Math.abs(dx * A.u[0] + dy * A.u[1]), t = dx * A.n[0] + dy * A.n[1];
                        if (t <= 0) return FAR;
                        const dl = Math.hypot(x - A.cl[0], y - A.cl[1]), dr = Math.hypot(x - A.cr[0], y - A.cr[1]);
                        // the two kinds of lobe, and the middle between their centers
                        let v = Math.max(f - Math.hypot(s - sl, t), f - Math.hypot(s, t - ht), Math.min(sl - s, ht - t));
                        v = Math.max(v, Math.min(Rg - Math.max(dl, dr), t - touch));
                        return Math.max(v, Math.max(dl, dr) - A.R);
                    } });
            };

            // A ring of pointed lights between the circles rin and rho, like the spokes of a wheel
            const tier = (c, rin, rho, n, rot, order) => {
                const half = Math.PI / n, ra = rho / (Math.cos(half) + Math.sqrt(3) * Math.sin(half)); // heads touch the rim
                if (ra - rin < 3) return;
                const at = (r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
                for (let j = 0; j < n; j++) {
                    const a0 = rot + j * 2 * half, A = arch(at(ra, a0), at(ra, a0 + 2 * half), 1);
                    seg(at(rin, a0), A.a, order);
                    head(A, order);
                    cusp(A, hwOf(order));
                    seed(at((rin + ra) / 2, a0 + half), j % 2 ? LIGHT2 : LIGHT);
                    // a small circle in the gap over each spoke, touching the rim and the heads either side
                    let lo = ra, hi = rho;
                    for (let i = 0; i < 40; i++) {
                        const t = (lo + hi) / 2;
                        if (geo.dist(at(t, a0), A.cl) - A.R - (rho - t) < 0) lo = t; else hi = t;
                    }
                    const q = rho - lo, hw = hwOf(order + 1);
                    if (q - hw < inset + 1) continue; // no room for a pane
                    ring(at(lo, a0), q, order + 1);
                    foil(at(lo, a0), q, q - hw < 6 ? 3 : 4, a0, hw);
                    seed(at(lo, a0), FOIL2);
                }
            };
            const wheel = (c, rho, n, rot, order) => {
                const rh = rho * 0.24;
                ring(c, rh, order);
                foil(c, rh, Math.max(3, Math.min(8, n / 2)), rot, hwOf(order));
                seed(c, FOIL);
                tier(c, rh, rho, n, rot, order);
            };

            const UP = -Math.PI / 2;
            const oculus = (c, rho, order) => {
                ring(c, rho, order);
                const hw = hwOf(order), open = rho - hw, kind = open < 24 ? 'foil' : p.oculus;
                if (kind === 'wheel') wheel(c, rho, open > 34 ? 8 : 6, UP, order + 1);
                else if (kind === 'circles') {
                    const n = open > 30 ? 6 : 5, k = Math.sin(Math.PI / n), q = (rho * k) / (1 + k), h2 = hwOf(order + 1);
                    for (let i = 0; i < n; i++) {
                        const a = UP + (TAU * i) / n, m = [c[0] + (rho - q) * Math.cos(a), c[1] + (rho - q) * Math.sin(a)];
                        ring(m, q, order + 1);
                        foil(m, q, 4, a, h2);
                        seed(m, FOIL2);
                    }
                    ring(c, rho - 2 * q, order + 1);
                    foil(c, rho - 2 * q, n, UP + Math.PI / n, h2);
                    seed(c, FOIL);
                } else {
                    foil(c, rho, order === 1 ? Math.round(p.foils) : open < 7 ? 3 : 4, UP, hw);
                    seed(c, order === 1 ? FOIL : FOIL2);
                }
            };

            // Lights under one arch. An even number splits in two under a circle and each
            // half splits again. An odd number stands in a row with the circle on the middle one.
            const total = Math.max(1, Math.round(p.lights));
            const win = (a, b, sharp, lights, order, sill, first) => {
                const A = arch(a, b, sharp);
                head(A, order);
                seg(a, [a[0], sill], order); seg(b, [b[0], sill], order);
                if (lights <= 1) {
                    cusp(A, hwOf(order));
                    seed(A.mid, Math.min(first, total - 1 - first) % 2 ? LIGHT2 : LIGHT);
                    return;
                }
                const parts = lights % 2 ? lights : 2, wc = A.w / parts, r = sharp * wc;
                for (let i = 0; i < parts; i++) {
                    win([a[0] + A.u[0] * wc * i, a[1]], [a[0] + A.u[0] * wc * (i + 1), a[1]], sharp, lights / parts, order + 1, sill, first + (i * lights) / parts);
                }
                // The circle touches the main arch inside and stands on the two arcs nearest
                // the middle, whose centers are xc either side of it
                const xc = parts === 2 ? r : Math.abs(r - wc / 2);
                const rho = (A.R * A.R - A.off * A.off - r * r + xc * xc) / (2 * (A.R + r));
                const up = Math.sqrt(Math.max(0, (A.R - rho) * (A.R - rho) - A.off * A.off));
                oculus([A.mid[0], A.mid[1] - up], rho, order + 1);
            };

            // ---- lay the window out on the page
            let region, box;
            if (p.style === 'rose') {
                const rho = Math.max(15, Math.min(bb.w, bb.h) / 2 - hw0 - HOOD - 0.5), c = [cx, cy], n = Math.max(4, 2 * Math.round(p.petals / 2));
                ring(c, rho, 0);
                if (p.tiers > 1) {
                    const r1 = rho * 0.46;
                    ring(c, r1, 1);
                    wheel(c, r1, n, UP, 2);
                    tier(c, r1, rho, 2 * n, UP, 1);
                } else wheel(c, rho, n, UP, 1);
                region = (x, y) => rho - Math.hypot(x - cx, y - cy);
                box = [cx - rho, cy - rho, cx + rho, cy + rho];
                frame.push(geo.circle(cx, cy, rho + hw0), geo.circle(cx, cy, rho + hw0 + HOOD));
            } else {
                const sharp = geo.clamp(p.sharp, 0.5, 3), rise = Math.sqrt(sharp - 0.25), T = Math.max(p.tall, rise + 0.2);
                const o2 = hw0 + HOOD, lip = 1.5;
                // the outer hood is mitred, so it stands a little taller than the arch plus its width
                const peak = w => Math.sqrt((sharp * w + o2) * (sharp * w + o2) - (sharp - 0.5) * (sharp - 0.5) * w * w);
                let w = Math.max(20, Math.min(bb.w - 2 * (o2 + lip) - 1, (bb.h - 2 * o2 - SILL - 1) / T));
                for (let i = 0; i < 4; i++) w = Math.min(w, (bb.h - 1 - (hw0 + SILL)) / ((T - rise) + peak(w) / w));
                const tall = peak(w) + (T - rise) * w + hw0 + SILL;
                const ys = cy - tall / 2 + peak(w), yb = ys + (T - rise) * w, x0 = cx - w / 2, x1 = cx + w / 2;
                const A = arch([x0, ys], [x1, ys], sharp);
                seg([x0, yb], [x1, yb], 0);
                if (p.style === 'intersecting' && total > 1) {
                    // every mullion carries on as two arcs struck with the main arch's radius
                    head(A, 0);
                    seg(A.a, [x0, yb], 0); seg(A.b, [x1, yb], 0);
                    for (let j = 0; j <= total; j++) {
                        if (j < total) seed([x0 + ((j + 0.5) * w) / total, ys], Math.min(j, total - 1 - j) % 2 ? LIGHT2 : LIGHT);
                        if (j === 0 || j === total) continue;
                        const s = (j * w) / total, m = [x0 + s, ys];
                        seg(m, [m[0], yb], 1);
                        const sr = (s + w) / 2, sl = s / 2; // where they run into the main arch
                        arc([m[0] + A.R, ys], m, [x0 + sr, ys - Math.sqrt(A.R * A.R - (sr - s - A.R) * (sr - s - A.R))], 1);
                        arc([m[0] - A.R, ys], m, [x0 + sl, ys - Math.sqrt(A.R * A.R - (sl - s + A.R) * (sl - s + A.R))], 1);
                    }
                } else win(A.a, A.b, sharp, total, 0, yb, 0);
                region = (x, y) => y >= ys ? Math.min(x - x0, x1 - x, yb - y)
                    : Math.min(A.R - Math.hypot(x - A.cl[0], y - A.cl[1]), A.R - Math.hypot(x - A.cr[0], y - A.cr[1]));
                box = [x0, A.apex[1], x1, yb];
                // outer edge of the frame and the hood round it, standing on the sill
                for (const o of [hw0, o2]) {
                    const r = A.R + o, h = Math.sqrt(r * r - A.off * A.off), foot = yb + hw0;
                    frame.push([[x0 - o, foot], ...geo.arc(A.cl[0], ys, r, Math.PI, Math.atan2(-h, -A.off) + TAU),
                        ...geo.arc(A.cr[0], ys, r, Math.atan2(-h, A.off), 0), [x1 + o, foot]]);
                }
                const sx = x0 - o2 - lip, sy = yb + hw0;
                frame.push([[sx, sy], [2 * cx - sx, sy], [2 * cx - sx, sy + SILL], [sx, sy + SILL], [sx, sy]]);
            }

            // ---- sample the stone
            const nest = p.fill === 'echo' ? Math.max(1, Math.min(8, Math.floor(9 / spacing))) : 0;
            // the grid goes past the skeleton far enough for the moulding line outside it
            const edge = hw0 + 1, gw = box[2] - box[0] + 2 * edge, gh = box[3] - box[1] + 2 * edge, cell = Math.max(0.2, Math.sqrt((gw * gh) / 7e5));
            const reach = inset + nest * spacing + 3 * cell; // the field only has to be right this far from a bar
            const F = PG.sampleField(region, box[0] - edge, box[1] - edge, gw, gh, cell), { nx, ny, x0: gx, y0: gy, dx, dy } = F;
            const G = { values: new Float64Array(nx * ny).fill(FAR), nx, ny, x0: gx, y0: gy, dx, dy };
            const each = (b, pad, fn) => {
                const i0 = Math.max(0, Math.floor((b[0] - pad - gx) / dx)), i1 = Math.min(nx - 1, Math.ceil((b[2] + pad - gx) / dx));
                const j0 = Math.max(0, Math.floor((b[1] - pad - gy) / dy)), j1 = Math.min(ny - 1, Math.ceil((b[3] + pad - gy) / dy));
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(gx + i * dx, gy + j * dy, j * nx + i);
            };
            const ends = (s, x, y) => Math.min(Math.hypot(x - s.ax, y - s.ay), Math.hypot(x - s.bx, y - s.by));
            const distTo = (s, x, y) => {
                if (s.line) {
                    const ex = s.bx - s.ax, ey = s.by - s.ay, t = geo.clamp(((x - s.ax) * ex + (y - s.ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
                    return Math.hypot(x - s.ax - ex * t, y - s.ay - ey * t);
                }
                const wx = x - s.cx, wy = y - s.cy;
                if (!s.full && (s.dir * (s.ux * wy - s.uy * wx) < 0 || s.dir * (wx * s.vy - wy * s.vx) < 0)) return ends(s, x, y);
                return Math.abs(Math.hypot(wx, wy) - s.r);
            };
            for (const s of bars) {
                const hw = hwOf(s.order), next = hwOf(s.order + 1);
                // a thick bar shows the next order's width as a line down each side
                const hm = p.mould && hw - next >= 0.45 ? next : 0;
                each(s.box, hw + reach, (x, y, k) => {
                    const d = distTo(s, x, y);
                    if (d - hw < F.values[k]) F.values[k] = d - hw;
                    if (hm && d - hm < G.values[k]) G.values[k] = d - hm;
                });
            }
            for (const s of solids) each(s.box, 0, (x, y, k) => { const v = s.fn(x, y); if (v < F.values[k]) F.values[k] = v; });

            // Contours worth drawing. Not the pinholes left where three bars nearly close a
            // gap, and not loops so thin their two sides would plot as one fat dash.
            const trace = (field, level, least = SPECK) => PG.isolines(field, level).filter(line => {
                const len = geo.pathLength(line);
                return len > least && !(geo.dist(line[0], line[line.length - 1]) < 1e-6 && Math.abs(geo.polygonArea(line)) < 0.25 * len);
            });
            for (const line of trace(F, 0)) out.of(STONE).push(line);
            // moulding lines close up into little loops in the corners of a small wheel, which just look like dirt
            if (p.mould) for (const line of trace(G, 0, 4 * SPECK)) out.of(MOULD).push(line);

            // ---- the glass: one region per pane
            const lab = new Int32Array(nx * ny), panes = [null], stack = [];
            for (let k0 = 0; k0 < lab.length; k0++) {
                if (lab[k0] || !(F.values[k0] > 0)) continue;
                const id = panes.length, pane = { part: SPANDREL, i0: nx, j0: ny, i1: 0, j1: 0, sx: 0, n: 0, deep: 0 };
                panes.push(pane);
                lab[k0] = id; stack.push(k0);
                while (stack.length) {
                    const k = stack.pop(), i = k % nx, j = (k - i) / nx;
                    pane.i0 = Math.min(pane.i0, i); pane.i1 = Math.max(pane.i1, i); pane.j0 = Math.min(pane.j0, j); pane.j1 = Math.max(pane.j1, j);
                    pane.sx += i; pane.n++; pane.deep = Math.max(pane.deep, F.values[k]);
                    const join = q => { if (!lab[q] && F.values[q] > 0) { lab[q] = id; stack.push(q); } };
                    if (i > 0) join(k - 1);
                    if (i < nx - 1) join(k + 1);
                    if (j > 0) join(k - nx);
                    if (j < ny - 1) join(k + nx);
                }
            }
            // the pane at a point: the highest of the four grid nodes round it
            const paneAt = (x, y) => {
                const i = geo.clamp(Math.floor((x - gx) / dx), 0, nx - 2), j = geo.clamp(Math.floor((y - gy) / dy), 0, ny - 2), k = j * nx + i;
                let best = 0, v = 0;
                for (const q of [k, k + 1, k + nx, k + nx + 1]) if (lab[q] && F.values[q] > v) { v = F.values[q]; best = lab[q]; }
                return best;
            };
            const value = (x, y) => {
                const fx = geo.clamp((x - gx) / dx, 0, nx - 1.001), fy = geo.clamp((y - gy) / dy, 0, ny - 1.001);
                const i = Math.floor(fx), j = Math.floor(fy), k = j * nx + i, tx = fx - i, ty = fy - j, v = F.values;
                return (v[k] * (1 - tx) + v[k + 1] * tx) * (1 - ty) + (v[k + nx] * (1 - tx) + v[k + nx + 1] * tx) * ty;
            };
            for (const [x, y, part] of seeds) { const id = paneAt(x, y); if (id) panes[id].part = part; }

            const glass = level => {
                for (const line of trace(F, level, 2 * SPECK)) {
                    const id = paneAt(line[0][0], line[0][1]);
                    if (id) out.of(panes[id].part).push(line);
                }
            };
            glass(inset);
            for (let i = 1; i <= nest; i++) glass(inset + i * spacing);

            // Straight lines across one pane, cut where they leave the glass. The lines of
            // every pane sit on one lattice through the middle of the window.
            const rule = (id, angle) => {
                const pane = panes[id], ux = Math.cos(angle), uy = Math.sin(angle);
                const xs = [gx + pane.i0 * dx, gx + pane.i1 * dx], ys = [gy + pane.j0 * dy, gy + pane.j1 * dy];
                let t0 = Infinity, t1 = -Infinity, n0 = Infinity, n1 = -Infinity;
                for (const x of xs) for (const y of ys) {
                    const t = (x - cx) * ux + (y - box[1]) * uy, n = (y - box[1]) * ux - (x - cx) * uy;
                    t0 = Math.min(t0, t); t1 = Math.max(t1, t); n0 = Math.min(n0, n); n1 = Math.max(n1, n);
                }
                const h = Math.min(dx, dy), into = out.of(pane.part);
                for (let m = Math.ceil(n0 / spacing); m * spacing <= n1; m++) {
                    const bx = cx - uy * m * spacing, by = box[1] + ux * m * spacing;
                    const at = t => { const x = bx + ux * t, y = by + uy * t; return paneAt(x, y) === id ? value(x, y) - inset : -1; };
                    let from = null, pv = -1, deep = 0;
                    for (let t = t0 - h; t <= t1 + h; t += h) {
                        const v = at(t);
                        if (v > 0 && pv <= 0) { from = t - (h * v) / (v - pv); deep = 0; }
                        else if (v <= 0 && pv > 0) {
                            const to = t - h + (h * pv) / (pv - v);
                            // not the ones that only skim along just inside the border line
                            if (deep > CLEAR) into.push([[bx + ux * from, by + uy * from], [bx + ux * to, by + uy * to]]);
                        }
                        deep = Math.max(deep, v);
                        pv = v;
                    }
                }
            };
            // one direction of hatching per kind of pane, like the tinctures of a coat of arms
            const HATCH = { [LIGHT]: 60, [LIGHT2]: 30, [FOIL]: 90, [FOIL2]: 0, [SPANDREL]: 45 };
            for (let id = 1; id < panes.length && nest === 0; id++) {
                const pane = panes[id];
                // a pane too small to hold a whole diamond keeps just its outline
                if (pane.deep - inset < spacing) continue;
                if (p.fill === 'quarry') { rule(id, geo.rad(60)); rule(id, geo.rad(120)); }
                else if (p.fill === 'hatch') {
                    // mirrored on the far side of the middle, so the window stays symmetrical
                    const a = HATCH[pane.part], right = gx + (pane.sx / pane.n) * dx > cx + 1;
                    rule(id, geo.rad(right ? 180 - a : a));
                }
            }
            return out.done();
        },
    });
})();
