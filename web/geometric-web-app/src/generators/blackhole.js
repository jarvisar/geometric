/*
 * A thin accretion disk round a black hole, seen from far away, after
 * Jean-Pierre Luminet's 1979 picture (Astron. Astrophys. 75, 228).
 *
 * The hole doesn't spin (Schwarzschild), and lengths are in units of its mass
 * with G = c = 1, so the horizon is at 2 and the disk's inner edge at 6, the
 * last stable orbit. A light ray stays in one plane through the hole. With
 * u = 1/r and phi the angle turned through since leaving the observer, its
 * path obeys u'' = 3u² - u, starting from u = 0, u' = 1/b, where b is the
 * impact parameter: how far from the hole the ray lands on the picture. The
 * paths only depend on b, so they're integrated once into a table, and every
 * point of the drawing is a lookup of "which b is at radius r after turning
 * through phi".
 *
 * A ray landing at angle alpha round the picture meets the plane of the disk
 * after turning through gamma, then again every half turn after that. The
 * first meeting is the direct image. The second is the underside of the disk,
 * seen by light bent right round the hole, and the third hugs the edge of the
 * hole's shadow. The disk is opaque, so each image is hidden wherever an
 * earlier one is in the way.
 *
 * The gas orbits anticlockwise, so the left side comes towards the viewer and
 * is blueshifted and brighter, and all of it is reddened by climbing out of
 * the hole's gravity.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const BC = 3 * Math.sqrt(3); // rays landing closer than this fall in
    const RIN = 6;
    const SHORT = 9; // mm
    const DPHI = 0.008, NPHI = Math.ceil((3 * Math.PI + 0.1) / DPHI) + 1;
    // Layers from the bluest band to the reddest. Follows the pen order in pens.js
    // (blue, red, gold, light blue, purple, green, brown, ink).
    const SPECTRUM = [4, 0, 3, 5, 2, 6, 1, 7];

    // u along the ray for each impact parameter in b, a row each. Rows are packed
    // close to BC, where a hair's difference in b is another turn round the hole.
    let TABLE = null;
    function orbits() {
        if (TABLE) return TABLE;
        const b = [];
        for (let x = 0.04; x < 2.6; x *= 1.05) b.push(x);
        for (let s = Math.log(BC - 2.6); s > -14; s -= 0.08) b.push(BC - Math.exp(s));
        for (let s = -14; s < Math.log(90); s += 0.08) b.push(BC + Math.exp(s));
        const u = new Float32Array(b.length * NPHI), acc = y => 3 * y * y - y;
        b.forEach((bi, i) => {
            const sub = Math.ceil(2 / Math.min(1, bi)), h = DPHI / sub;
            let y = 0, v = 1 / bi, done = null;
            for (let j = 1; j < NPHI; j++) {
                for (let k = 0; k < sub && done === null; k++) {
                    // Back out at infinity. It carries on down in a straight line from here, so
                    // rows either side of the last ray to arrive still interpolate. Left to the
                    // equation, a wide ray comes back round as a second ray that isn't there.
                    if (y < 0) { y += v * h; if (y < -0.05) done = -0.05; continue; }
                    const a1 = acc(y), v2 = v + (h / 2) * a1, a2 = acc(y + (h / 2) * v);
                    const v3 = v + (h / 2) * a2, a3 = acc(y + (h / 2) * v2), v4 = v + h * a3, a4 = acc(y + h * v3);
                    y += (h / 6) * (v + 2 * v2 + 2 * v3 + v4);
                    v += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
                    if (y > 0.6) done = 1; // fallen in
                }
                u[i * NPHI + j] = done === null ? y : done;
            }
        });
        return (TABLE = { b, u });
    }
    const uAt = (T, i, phi) => {
        const x = phi / DPHI, j = Math.min(NPHI - 2, Math.floor(x)), o = i * NPHI + j;
        return T.u[o] + (T.u[o + 1] - T.u[o]) * (x - j);
    };
    // The impact parameter of the ray that is at radius r after turning through phi
    function impact(T, phi, r) {
        const ut = 1 / r;
        let lo = 0, hi = T.b.length - 1;
        if (uAt(T, lo, phi) < ut) return r * Math.sin(phi);
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (uAt(T, mid, phi) >= ut) lo = mid; else hi = mid; }
        const a = uAt(T, lo, phi), c = uAt(T, hi, phi);
        // far from the hole r is close to b / sin(phi), so r is the one to interpolate
        const t = c > 0 ? (r - 1 / a) / (1 / c - 1 / a) : (a - ut) / (a - c);
        return T.b[lo] + (T.b[hi] - T.b[lo]) * geo.clamp(t, 0, 1);
    }
    // Where the ray with impact parameter b is after turning through phi
    function radius(T, b, phi) {
        let lo = 0, hi = T.b.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T.b[mid] <= b) lo = mid; else hi = mid; }
        const t = geo.clamp((b - T.b[lo]) / (T.b[hi] - T.b[lo]), 0, 1);
        const u = uAt(T, lo, phi) + (uAt(T, hi, phi) - uAt(T, lo, phi)) * t;
        return u > 0 ? 1 / u : Infinity;
    }
    // Light given off by the surface of the disk at radius r (Page & Thorne). Nothing at the inner edge.
    const flux = r => {
        const s = Math.sqrt(r), s3 = Math.sqrt(3), s6 = Math.sqrt(6);
        return (s - s6 + (s3 / 3) * Math.log(((s + s3) * (s6 - s3)) / ((s - s3) * (s6 + s3)))) / ((r - 3) * r * r * s);
    };

    PG.register({
        id: 'blackhole',
        name: 'Black Hole',
        category: 'Fields',
        description: 'Spiraling gas and distant stars round a black hole, with the disk bent over its shadow by gravity, after Luminet\'s 1979 picture.',
        fit: false,
        params: [
            { type: 'section', label: 'View' },
            { id: 'incl', label: 'Inclination (°)', type: 'range', min: 0, max: 89, step: 1, value: 77, random: [55, 87],
                hint: '0 looks straight down on the disk, 90 is edge-on' },
            { id: 'tilt', label: 'Tilt (°)', type: 'range', min: -90, max: 90, step: 1, value: -12, random: [-35, 35] },
            { type: 'section', label: 'Disk' },
            { id: 'structure', label: 'Disk pattern', type: 'select', value: 'turbulent', random: true,
                options: [['rings', 'Smooth rings'], ['spiral', 'Spiral bands'], ['turbulent', 'Turbulent bands']],
                hint: 'Stylized gas patterns on the same light-bending model' },
            { id: 'flow', label: 'Flow strength', type: 'range', min: 0, max: 1, step: 0.05, value: 0.85, random: [0.4, 1],
                show: p => p.structure !== 'rings' },
            { id: 'winding', label: 'Winding (turns)', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1.3, random: [0.7, 2],
                show: p => p.structure !== 'rings' && p.flow > 0 },
            { id: 'outer', label: 'Outer radius', type: 'range', min: 10, max: 60, step: 1, value: 22, random: [16, 44],
                hint: 'In units of the hole\'s mass. The inner edge is at 6, the last stable orbit' },
            { id: 'rings', label: 'Rings', type: 'range', min: 4, max: 192, step: 1, value: 128, random: [48, 140],
                hint: 'Uses the nearest of 4, 6, 8, 12, 16, 24 and so on, so they thin out evenly' },
            { id: 'under', label: 'Underside image', type: 'checkbox', value: true,
                hint: 'The bottom of the disk, seen by light bent right round the hole' },
            { id: 'photon', label: 'Photon ring', type: 'checkbox', value: true },
            { type: 'section', label: 'Light' },
            { id: 'shade', label: 'Shade by brightness', type: 'checkbox', value: true, random: 0.75,
                hint: 'Rings thin out where the disk is dim' },
            { id: 'contrast', label: 'Contrast', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.25, random: [0.15, 0.45],
                show: p => p.shade },
            { id: 'redshift', label: 'Redshift contours', type: 'range', min: 0, max: 40, step: 1, value: 0, random: false },
            { id: 'gap', label: 'Finest spacing (mm)', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.5, random: false,
                hint: 'Rings closer than this drop out. Keep it above the pen width' },
            { type: 'section', label: 'Sky' },
            { id: 'stars', label: 'Stars', type: 'range', min: 0, max: 240, step: 10, value: 80, random: [30, 120],
                hint: 'Distant stars behind the disk. Set to 0 for the disk alone' },
        ],

        generate(p, ctx) {
            const T = orbits(), { rng } = ctx;
            const inc = geo.rad(geo.clamp(p.incl, 0, 89)), si = Math.sin(inc), ci = Math.cos(inc);
            const rout = Math.max(RIN + 2, p.outer), M = 720;
            // Rings drop out by halves where they crowd or the disk is dim, which only stays
            // even if the gaps between them halve exactly: 2, 4, 8... or 3, 6, 12... of them
            let gaps = 2;
            for (const n of [3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192]) if (Math.abs(n - p.rings) < Math.abs(gaps - p.rings)) gaps = n;
            const N = gaps + 1;
            const pens = PG.pens.count(p.pens), layers = PG.pens.layers(pens);
            const flowRng = new PG.RNG((ctx.seed || 0) ^ 0x4b1d);
            const phase = flowRng.range(0, TAU), eddy = flowRng.range(0, TAU);
            const winding = TAU * geo.clamp(p.winding ?? 1.3, 0.5, 3);
            const flow = p.structure === 'spiral' || p.structure === 'turbulent' ? geo.clamp(p.flow ?? 0.85, 0, 1) : 0;
            const pattern = (t, psi) => {
                let wave = Math.sin(2 * psi - winding * t + phase);
                if (p.structure === 'turbulent') wave = 0.7 * wave + 0.3 * Math.sin(5 * psi + 0.65 * winding * t + eddy);
                return wave;
            };
            const diskRadius = (r, psi) => {
                if (!flow || r === RIN || r === rout) return r;
                const t = (r - RIN) / (rout - RIN);
                // Bound the radial derivative so neighboring bands never cross. Both rims stay fixed.
                return r + (rout - RIN) * flow * 0.9 / (Math.PI + winding) * Math.sin(Math.PI * t) * pattern(t, psi);
            };

            const turn = al => Math.atan2(ci, -Math.sin(al) * si);
            // Image `order` of the disk at radius r and angle psi round it: x, y, impact
            // parameter, angle on the picture, 1 + redshift and brightness
            const image = (order, r, psi) => {
                const al = Math.atan2(Math.sin(psi) * ci, Math.cos(psi)) + order * Math.PI;
                const b = impact(T, turn(al) + order * Math.PI, r), x = b * Math.cos(al);
                const g = (1 + (x * si) / (r * Math.sqrt(r))) / Math.sqrt(1 - 3 / r);
                const light = flow ? 1 - flow + flow * (0.15 + 1.85 * Math.pow((1 + pattern((r - RIN) / (rout - RIN), psi)) / 2, 2)) : 1;
                return { x, y: -b * Math.sin(al), b, al, g, f: flux(r) * light / (g * g * g * g) };
            };
            const hidden = (order, q) => {
                for (let m = 0; m < order; m++) {
                    const r = radius(T, q.b, turn(q.al) + m * Math.PI);
                    if (r >= RIN && r <= rout) return true;
                }
                return false;
            };

            const radii = Array.from({ length: N }, (_, k) => RIN + ((rout - RIN) * k) / (N - 1));
            // Angles round the disk to sample at: half spread evenly round the disk and half
            // evenly round the picture. Nearly edge-on, the first kind all land at the two
            // ends of the picture and the second kind all at the front and back of the disk.
            const psis = [];
            for (let j = 0; j < M / 2; j++) {
                const al = ((j + 0.5) * 2 * TAU) / M;
                psis.push((TAU * 2 * j) / M, (Math.atan2(Math.sin(al), Math.cos(al) * ci) + TAU) % TAU);
            }
            psis.sort((a, b) => a - b);
            const psiAt = j => psis[j % M] + (j >= M ? TAU : 0);
            const ringPoint = (order, r, psi) => image(order, order < 2 ? diskRadius(r, psi) : r, psi);
            const ringOf = (order, r) => psis.map(psi => ringPoint(order, r, psi));
            const images = [radii.map(r => ringOf(0, r))];
            if (p.under) images.push(radii.map(r => ringOf(1, r)));

            // ---- fit the picture to the page
            const rot = geo.rad(p.tilt || 0), cr = Math.cos(rot), sr = Math.sin(rot);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const im of images) for (const q of im[N - 1]) {
                const x = q.x * cr - q.y * sr, y = q.x * sr + q.y * cr;
                x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
            const bb = geo.bbox([ctx.shape.polygon()]);
            const K = 0.96 * Math.min(bb.w / (x1 - x0), bb.h / (y1 - y0));
            const ox = (bb.minX + bb.maxX) / 2 - (K * (x0 + x1)) / 2, oy = (bb.minY + bb.maxY) / 2 - (K * (y0 + y1)) / 2;
            const place = q => [ox + K * (q.x * cr - q.y * sr), oy + K * (q.x * sr + q.y * cr), q.g];

            // ---- which rings to draw where
            // step[k] is how far apart the rings are once ring k is the finest still drawn.
            // The two edges are always drawn.
            const step = radii.map((_, k) => {
                let s = gaps;
                if (k % gaps) for (s = gaps % 3 ? gaps / 2 : gaps / 3; k % s; s /= 2);
                return s;
            });
            let peak = 0;
            for (const ring of images[0]) for (const q of ring) peak = Math.max(peak, q.f);
            // A different threshold on every ring, or they would all stop along the same
            // curves and the tone would jump there. The spacing one only ever asks for more room.
            const jitter = radii.map(() => Math.pow(2, rng.range(-0.5, 0.5)));
            const room = radii.map(() => Math.pow(2, rng.range(0, 1)));
            const gap = Math.max(0.1, p.gap);

            const strokes = []; // paths of [x, y, 1 + redshift]
            const emit = (order, r, ring, keep) => {
                let cur = null;
                for (let j = 0; j <= M; j++) {
                    const q = ring[j % M], show = keep(j % M) && !hidden(order, q);
                    if (show) {
                        if (!cur) {
                            cur = []; strokes.push(cur);
                            // start where it comes out from behind the disk, not at the next sample
                            const prev = ring[(j + M - 1) % M];
                            if (j > 0 && keep((j - 1) % M) && hidden(order, prev)) cur.push(place(edge(order, r, psiAt(j), psiAt(j - 1))));
                        }
                        cur.push(place(q));
                    } else {
                        if (cur && keep(j % M)) cur.push(place(edge(order, r, psiAt(j - 1), psiAt(j))));
                        cur = null;
                    }
                }
            };
            const edge = (order, r, seen, gone) => {
                for (let i = 0; i < 12; i++) {
                    const mid = (seen + gone) / 2;
                    if (hidden(order, ringPoint(order, r, mid))) gone = mid; else seen = mid;
                }
                return ringPoint(order, r, seen);
            };
            images.forEach((im, order) => {
                im.forEach((ring, k) => {
                    const need = j => {
                        const q = ring[j], a = ring[(j + M - 1) % M], c = ring[(j + 1) % M];
                        const tx = c.x - a.x, ty = c.y - a.y, tl = Math.hypot(tx, ty) || 1;
                        // distance to the rings either side, across this one
                        let s = 0, n = 0;
                        for (const o of [im[k - 1], im[k + 1]]) if (o) { s += Math.abs(tx * (o[j].y - q.y) - ty * (o[j].x - q.x)) / tl; n++; }
                        const rim = k === 0 || k === gaps;
                        if (k > 0 && step[k] * (s / n) * K < gap * (rim ? 1 : room[k])) return false;
                        if (!p.shade || rim) return true;
                        return step[k] * Math.pow(q.f / peak, p.contrast) * jitter[k] >= 1;
                    };
                    // A ring that only gets through for a few mm reads as a tick, not as a ring
                    const keep = ring.map((_, j) => need(j)), first = keep.indexOf(false);
                    for (let j = first, from = -1, len = 0; first >= 0 && j <= first + M; j++) {
                        const on = keep[j % M] && j < first + M;
                        if (on) {
                            if (from < 0) { from = j; len = 0; }
                            const a = ring[j % M], c = ring[(j + 1) % M];
                            len += Math.hypot(c.x - a.x, c.y - a.y) * K;
                        } else if (from >= 0) {
                            if (len < SHORT) for (let i = from; i < j; i++) keep[i % M] = false;
                            from = -1;
                        }
                    }
                    emit(order, radii[k], ring, j => keep[j]);
                });
            });
            if (p.photon) {
                // It runs just inside the underside image. Leave it out where the two would touch.
                const under = images[1] && images[1][0];
                const ring = ringOf(2, (RIN + rout) / 2);
                emit(2, (RIN + rout) / 2, ring, j => !under || (under[(j + M / 2) % M].b - ring[j].b) * K >= gap);
            }

            // slivers of an image showing through a gap between two others
            for (let i = strokes.length - 1; i >= 0; i--) if (geo.pathLength(strokes[i]) < SHORT / 3) strokes.splice(i, 1);

            // ---- curves of equal redshift across the direct image
            if (p.redshift > 0) {
                // on a grid of sample angle against radius, both as indexes
                const R = 96, at = (j, k) => {
                    const i = Math.min(M - 1, Math.floor(j));
                    return image(0, RIN + ((rout - RIN) * k) / R, psiAt(i) + (psiAt(i + 1) - psiAt(i)) * (j - i));
                };
                const f = PG.sampleField((j, k) => at(j, k).g, 0, 0, M, R, 1);
                // equal shares of the disk between them. At equal steps of redshift they'd
                // all be bunched round the inner edge.
                const sorted = Float64Array.from(f.values).sort(), count = Math.round(p.redshift);
                for (let i = 0; i < count; i++) {
                    const level = sorted[Math.floor(((i + 0.5) / count) * sorted.length)];
                    for (const line of PG.isolines(f, level)) strokes.push(line.map(([j, k]) => place(at(j, k))));
                }
            }

            // ---- pens: equal lengths of line from the bluest light to the reddest
            const BINS = 2000;
            let g0 = Infinity, g1 = -Infinity;
            for (const s of strokes) for (const q of s) { g0 = Math.min(g0, q[2]); g1 = Math.max(g1, q[2]); }
            const hist = new Float64Array(BINS), bin = g => Math.min(BINS - 1, Math.floor(((g - g0) / (g1 - g0 || 1)) * BINS));
            let total = 0;
            for (const s of strokes) for (let i = 1; i < s.length; i++) {
                const len = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
                hist[bin((s[i][2] + s[i - 1][2]) / 2)] += len; total += len;
            }
            const band = new Uint8Array(BINS);
            for (let i = 0, run = 0; i < BINS; i++) { band[i] = Math.min(pens - 1, Math.floor((run / (total || 1)) * pens)); run += hist[i]; }
            const order = SPECTRUM.filter(i => i < pens);
            for (const s of strokes) {
                let cur = null, at = -1;
                for (let i = 1; i < s.length; i++) {
                    const to = band[bin((s[i][2] + s[i - 1][2]) / 2)];
                    if (to !== at) { cur = [[s[i - 1][0], s[i - 1][1]]]; layers[order[to]].push(cur); at = to; }
                    cur.push([s[i][0], s[i][1]]);
                }
            }
            // Keep sky randomness separate so adding stars never changes the disk or its colors.
            const skyRng = new PG.RNG((ctx.seed || 0) ^ 0x735a);
            const count = geo.clamp(Math.round(p.stars || 0), 0, 240), stars = [];
            const clearSky = (x, y) => {
                if (!ctx.shape.inside(x, y)) return false;
                const dx = (x - ox) / K, dy = (y - oy) / K;
                const qx = dx * cr + dy * sr, qy = -dx * sr + dy * cr;
                const b = Math.hypot(qx, qy);
                if (b < BC + gap / K) return false;
                if (b > rout + BC) return true;
                const gamma = turn(Math.atan2(-qy, qx));
                for (let m = 0; m < 3; m++) {
                    const r = radius(T, b, gamma + m * Math.PI);
                    if (r >= RIN && r <= rout) return false;
                }
                return true;
            };
            for (let attempt = 0; stars.length < count && attempt < count * 20; attempt++) {
                const x = skyRng.range(bb.minX, bb.maxX), y = skyRng.range(bb.minY, bb.maxY);
                const bright = skyRng.chance(0.14), size = skyRng.range(0.28, 0.55) * (bright ? 2 : 1);
                const clearance = size + gap * 1.5;
                if (stars.some(s => Math.hypot(x - s.x, y - s.y) < clearance + s.size + 3)) continue;
                if (!clearSky(x, y)) continue;
                let clear = true;
                for (let j = 0; j < 16 && clear; j++) {
                    const a = TAU * j / 16;
                    clear = clearSky(x + clearance * Math.cos(a), y + clearance * Math.sin(a));
                }
                if (!clear) continue;
                stars.push({ x, y, size });
                if (bright) {
                    layers[0].push([[x - size, y], [x + size, y]], [[x, y - size], [x, y + size]]);
                } else layers[0].push(geo.circle(x, y, size, 12));
            }
            return { layers };
        },
    });
})();
