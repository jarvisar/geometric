/*
 * Apollonian gasket: start with a circle holding two tangent circles and a
 * third that touches all of them, then keep filling every curvilinear
 * triangular gap with the one circle tangent to its three sides.
 *
 * Descartes' circle theorem says four mutually tangent circles with
 * curvatures k (negative for the enclosing one) satisfy
 * (Σk)² = 2·Σk², so given three of them the two possible fourth circles
 * have k + k' = 2(k₁ + k₂ + k₃); the complex form gives the same relation
 * for centre × curvature. Each new circle is therefore the "reflection" of
 * the circle on the other side of its gap:
 *   k' = 2(k₁ + k₂ + k₃) − k,   k'z' = 2(k₁z₁ + k₂z₂ + k₃z₃) − kz,
 * which is exact and numerically stable, and the gap it fills splits into
 * three new gaps. Circles below the smallest radius end the recursion.
 *
 * Integer curvatures give the classic integral gaskets, e.g. (−1, 2, 2, 3)
 * or (−6, 11, 14, 15); every circle in them then has an integer curvature.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Integral gaskets (outer, first, second): every curvature in them is an integer.
    const INTEGRAL = [[1, 2, 2], [2, 3, 6], [3, 4, 12], [3, 5, 8], [6, 10, 15], [6, 11, 14], [10, 14, 35]];

    function spiral(cx, cy, r, s, a0, dir) {
        // one lap on the rim, then wind inward to the centre
        const pts = [];
        const end = TAU * (1 + r / s);
        for (let th = 0; ; ) {
            const rad = th < TAU ? r : Math.max(0, r - (s * (th - TAU)) / TAU);
            const a = a0 + dir * th;
            pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
            if (th >= end) break;
            th = Math.min(end, th + geo.clamp(2 * Math.acos(1 - 0.02 / Math.max(rad, 0.05)), 0.03, 0.6));
        }
        return pts;
    }

    PG.register({
        id: 'apollonian',
        name: 'Apollonian Gasket',
        category: 'Packing',
        description: 'Circles packed into every gap between three tangent circles, forever (Descartes\' theorem).',
        fit: false,
        params: [
            { type: 'section', label: 'Gasket' },
            { id: 'r1', label: 'First circle (× outer)', type: 'range', min: 0.1, max: 0.9, step: 0.001, value: 0.5,
                hint: 'Radius of the first inner circle relative to the outer one' },
            { id: 'r2', label: 'Second circle (× room left)', type: 'range', min: 0.05, max: 1, step: 0.001, value: 1,
                hint: '1 = the two circles span a diameter' },
            { id: 'minR', label: 'Smallest radius (mm)', type: 'range', min: 0.3, max: 10, step: 0.1, value: 1, random: [0.8, 2.5] },
            { id: 'outer', label: 'Outer circle', type: 'checkbox', value: true, random: 0.8 },
            { type: 'section', label: 'Fill' },
            { id: 'style', label: 'Style', type: 'select', value: 'rings',
                random: ['outline', 'rings', 'rings', 'eccentric', 'eccentric', 'spiral', 'hatch', 'mixed'],
                options: [['outline', 'Outline'], ['rings', 'Concentric rings'], ['eccentric', 'Eccentric bubbles'],
                    ['spiral', 'Spiral'], ['hatch', 'Hatch'], ['mixed', 'Mixed']] },
            { id: 'spacing', label: 'Fill spacing (mm)', type: 'range', min: 0.5, max: 6, step: 0.05, value: 1.6, random: [1.1, 2.6],
                show: p => p.style !== 'outline' },
            { id: 'ecc', label: 'Eccentricity', type: 'range', min: 0, max: 1, step: 0.01, value: 0.7, random: [0.4, 0.85],
                show: p => p.style === 'eccentric' || p.style === 'mixed', hint: 'Rings bunch toward the centre of the gasket' },
            { id: 'gap', label: 'Gap (mm)', type: 'range', min: 0, max: 4, step: 0.05, value: 0, random: [0, 1],
                hint: 'Shrinks every circle so neighbours no longer touch' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Pen per', type: 'select', value: 'generation', show: p => p.pens > 1,
                options: [['generation', 'Generation'], ['size', 'Size'], ['random', 'Random circle']] },
        ],

        randomize(rng, p) {
            if (rng.chance(0.55)) {
                // an integral gasket, either way round
                const [a, b, c] = rng.pick(INTEGRAL);
                const r1 = a / b, r2 = Math.min(1, a / c / (1 - r1));
                return rng.chance(0.5) ? { r1: +r1.toFixed(3), r2: +r2.toFixed(3) } : { r1: +(a / c).toFixed(3), r2: +Math.min(1, r1 / (1 - a / c)).toFixed(3) };
            }
            return { r1: +rng.range(0.3, 0.66).toFixed(3), r2: +rng.range(0.35, 1).toFixed(3) };
        },

        generate(p, ctx) {
            const { rng } = ctx;
            const bb = geo.bbox([ctx.shape.polygon()]);
            const ox = (bb.minX + bb.maxX) / 2, oy = (bb.minY + bb.maxY) / 2;
            const R = Math.max(1, ctx.shape.dist(ox, oy)); // the largest circle the visible area holds

            // ---- the starting four circles: { x, y, k, g (generation) }, outer k < 0
            const a = geo.clamp(p.r1, 0.02, 0.98) * R;
            const b = geo.clamp(p.r2, 0.02, 1) * (R - a);
            const O = { x: ox, y: oy, k: -1 / R, g: 0 };
            const C1 = { x: ox - (R - a), y: oy, k: 1 / a, g: 0 };
            // C2 touches O inside (|X| = R − b) and C1 outside (|X − C1| = a + b)
            const x2 = -((R - b) ** 2 - (a + b) ** 2 + (R - a) ** 2) / (2 * (R - a));
            const C2 = { x: ox + x2, y: oy - Math.sqrt(Math.max(0, (R - b) ** 2 - x2 * x2)), k: 1 / b, g: 0 };
            // C3: the larger Descartes root, placed where it touches O and C1 and checked against C2
            const k3 = O.k + C1.k + C2.k - 2 * Math.sqrt(Math.max(0, O.k * C1.k + C1.k * C2.k + C2.k * O.k));
            const r3 = 1 / k3;
            let C3 = null, best = Infinity;
            {
                // intersect |X − O| = R − r3 and |X − C1| = a + r3
                const d = geo.dist([O.x, O.y], [C1.x, C1.y]), ra = R - r3, rb = a + r3;
                const l = (ra * ra - rb * rb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, ra * ra - l * l));
                const ux = (C1.x - O.x) / d, uy = (C1.y - O.y) / d;
                for (const s of [-1, 1]) {
                    const x = O.x + ux * l - uy * h * s, y = O.y + uy * l + ux * h * s;
                    const err = Math.abs(Math.hypot(x - C2.x, y - C2.y) - (b + r3));
                    if (err < best) { best = err; C3 = { x, y, k: k3, g: 0 }; }
                }
            }

            // ---- recursive filling: each gap (A, B, C) holds D on its far side
            const minR = Math.max(0.1, p.minR);
            const circles = [O, C1, C2, C3];
            const MAX = 30000;
            const stack = [[C1, C2, C3, O], [O, C1, C2, C3], [O, C2, C3, C1], [O, C1, C3, C2]];
            while (stack.length && circles.length < MAX) {
                const [A, B, C, D] = stack.pop();
                const k = 2 * (A.k + B.k + C.k) - D.k;
                if (!(k > 0) || 1 / k < minR) continue;
                const E = {
                    x: (2 * (A.k * A.x + B.k * B.x + C.k * C.x) - D.k * D.x) / k,
                    y: (2 * (A.k * A.y + B.k * B.y + C.k * C.y) - D.k * D.y) / k,
                    k, g: Math.max(A.g, B.g, C.g) + 1,
                };
                circles.push(E);
                stack.push([E, A, B, C], [E, B, C, A], [E, A, C, B]);
            }

            // ---- draw
            const s = p.spacing, gap = p.gap / 2;
            const pens = Math.max(1, p.pens | 0);
            const layers = Array.from({ length: pens }, () => []);
            const maxG = Math.max(1, ...circles.map(c => c.g));
            const lnSpan = Math.log(R / minR) || 1;
            for (const c of circles) {
                const outer = c.k < 0;
                if (outer && !p.outer) continue;
                const r = Math.abs(1 / c.k) + (outer ? 0 : -gap);
                if (r < 0.15) continue;
                let pen = 0;
                if (pens > 1) {
                    if (p.penMode === 'size') pen = Math.min(pens - 1, Math.floor((Math.log(R / r) / lnSpan) * pens));
                    else if (p.penMode === 'random') pen = rng.int(0, pens - 1);
                    else pen = Math.min(pens - 1, Math.floor((c.g / (maxG + 1)) * pens));
                }
                const out = layers[pen];
                let style = outer ? 'outline' : p.style;
                if (style === 'mixed') style = rng.weighted([[3, 'rings'], [3, 'eccentric'], [2, 'spiral'], [2, 'hatch'], [1, 'outline']]);
                if (r < s * 0.9) style = 'outline';
                if (style === 'rings') {
                    for (let rr = r; rr > s * 0.3; rr -= s) out.push(geo.circle(c.x, c.y, rr));
                } else if (style === 'eccentric') {
                    // rings bunch toward the gasket's centre (the first circles bunch toward their own)
                    const d = Math.hypot(ox - c.x, oy - c.y);
                    const ux = d > 1e-9 ? (ox - c.x) / d : 0, uy = d > 1e-9 ? (oy - c.y) / d : 0;
                    for (let rr = r; rr > s * 0.3; rr -= s) out.push(geo.circle(c.x + (r - rr) * ux * p.ecc, c.y + (r - rr) * uy * p.ecc, rr));
                } else if (style === 'spiral') {
                    out.push(spiral(c.x, c.y, r, s, rng.range(0, TAU), rng.sign()));
                } else if (style === 'hatch') {
                    const rim = geo.circle(c.x, c.y, r);
                    const z = geo.hatchZigzag(rim.slice(0, -1), s, rng.range(0, Math.PI));
                    if (z.length) out.push(z);
                    out.push(rim);
                } else {
                    out.push(geo.circle(c.x, c.y, r));
                }
            }
            return pens > 1 ? { layers } : layers[0];
        },
    });
})();
