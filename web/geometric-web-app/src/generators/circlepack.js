/*
 * Circle packing — random placement in shrinking size classes. Radii step
 * geometrically from the largest size to the smallest; at each size many
 * random centres are tried and a circle is kept, grown until it meets its
 * neighbours, when it clears every placed circle and the clip boundary by the
 * gap. A bucket grid keeps the overlap tests local. Each circle is then
 * filled: concentric rings, one Archimedean spiral, eccentric "bubble" rings
 * that bunch toward a common direction, or a zig-zag hatch that runs along
 * the rim between lines so it plots as a single stroke.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const STYLES = ['eccentric', 'spiral', 'rings', 'hatch', 'outline'];

    function spiral(cx, cy, r, s, a0, dir) {
        // one lap on the rim, then wind inward to the centre
        const pts = [];
        const end = TAU * (1 + r / s);
        let th = 0;
        while (true) {
            const rad = th < TAU ? r : Math.max(0, r - (s * (th - TAU)) / TAU);
            const a = a0 + dir * th;
            pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
            if (th >= end) break;
            th = Math.min(end, th + geo.clamp(2 * Math.acos(1 - 0.02 / Math.max(rad, 0.05)), 0.03, 0.6));
        }
        return pts;
    }

    PG.register({
        id: 'circlepack',
        name: 'Circle Packing',
        category: 'Packing',
        description: 'Randomly packed circles filled with rings, spirals, eccentric bubbles or hatching.',
        fit: false,
        params: [
            { type: 'section', label: 'Packing' },
            { id: 'maxR', label: 'Largest radius (mm)', type: 'range', min: 3, max: 80, step: 0.5, value: 28, random: [10, 45] },
            { id: 'minR', label: 'Smallest radius (mm)', type: 'range', min: 0.5, max: 15, step: 0.1, value: 1.6, random: [1, 4] },
            { id: 'gap', label: 'Gap (mm)', type: 'range', min: 0, max: 8, step: 0.1, value: 1.2, random: [0.5, 3] },
            { id: 'attempts', label: 'Attempts', type: 'range', min: 0.2, max: 4, step: 0.1, value: 1, random: false,
                hint: 'Placement tries per size class — more gives a tighter packing' },
            { type: 'section', label: 'Fill' },
            { id: 'style', label: 'Style', type: 'select', value: 'eccentric',
                random: ['eccentric', 'eccentric', 'spiral', 'rings', 'hatch', 'hatch', 'mixed', 'mixed', 'outline'],
                options: [['eccentric', 'Eccentric bubbles'], ['spiral', 'Spiral'], ['rings', 'Concentric rings'],
                    ['hatch', 'Hatch'], ['outline', 'Outline'], ['mixed', 'Mixed']] },
            { id: 'spacing', label: 'Fill spacing (mm)', type: 'range', min: 0.6, max: 5, step: 0.05, value: 1.4, random: [1.1, 2.4] },
            { id: 'ecc', label: 'Eccentricity', type: 'range', min: 0, max: 1, step: 0.01, value: 0.72, random: [0.45, 0.8],
                show: p => p.style === 'eccentric' || p.style === 'mixed' },
            { id: 'shift', label: 'Shift direction°', type: 'range', min: 0, max: 360, step: 1, value: 45,
                show: p => p.style === 'eccentric' || p.style === 'mixed' },
            { id: 'spread', label: 'Direction spread°', type: 'range', min: 0, max: 180, step: 1, value: 25, random: [0, 60],
                show: p => p.style === 'eccentric' || p.style === 'mixed' },
            { id: 'rim', label: 'Outline hatched circles', type: 'checkbox', value: true,
                show: p => p.style === 'hatch' || p.style === 'mixed' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Pen per', type: 'select', value: 'random', show: p => p.pens > 1,
                options: [['random', 'Random circle'], ['size', 'Size'], ['style', 'Style']] },
        ],

        generate(p, ctx) {
            const { width: W, height: H, rng, shape } = ctx;
            const maxR = Math.max(p.maxR, p.minR), minR = Math.min(p.minR, p.maxR);
            const gap = p.gap;

            // ---- bucket grid; each circle is filed in every cell its (r + gap) box touches
            const cell = Math.max(2, (minR + gap) * 3);
            const gx = Math.ceil(W / cell) + 1, gy = Math.ceil(H / cell) + 1;
            const grid = new Array(gx * gy);
            const circles = [];
            const span = (v, r, g) => [Math.max(0, Math.floor((v - r) / cell)), Math.min(g - 1, Math.floor((v + r) / cell))];
            function add(x, y, r) {
                const c = [x, y, r];
                circles.push(c);
                const [i0, i1] = span(x, r + gap, gx), [j0, j1] = span(y, r + gap, gy);
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (grid[j * gx + i] || (grid[j * gx + i] = [])).push(c);
            }
            // Largest radius (capped at rq) a circle at (x, y) could have.
            function room(x, y, rq) {
                let best = Math.min(rq, shape.dist(x, y) - gap);
                if (best <= 0) return best;
                const [i0, i1] = span(x, rq, gx), [j0, j1] = span(y, rq, gy);
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                    const arr = grid[j * gx + i];
                    if (!arr) continue;
                    for (const c of arr) {
                        const d = Math.hypot(c[0] - x, c[1] - y) - c[2] - gap;
                        if (d < best) { best = d; if (best <= 0) return best; }
                    }
                }
                return best;
            }

            const q = 0.82;
            let prev = maxR;
            for (let r = maxR; r >= minR * 0.999; r *= q) {
                const tries = Math.min(80000, Math.ceil((p.attempts * 2.5 * W * H) / (Math.PI * r * r)));
                for (let t = 0; t < tries; t++) {
                    const x = rng.range(0, W), y = rng.range(0, H);
                    const fit = room(x, y, prev);
                    if (fit >= r) add(x, y, fit);
                }
                prev = r;
            }

            // ---- fills
            const s = p.spacing;
            const shift = geo.rad(p.shift), spread = geo.rad(p.spread);
            const lnSpan = Math.log(maxR / minR) || 1;
            const out = [];
            for (const [x, y, r] of circles) {
                let style = p.style;
                if (style === 'mixed') {
                    style = rng.weighted(r > 5 * s
                        ? [[3, 'eccentric'], [2, 'spiral'], [1.5, 'rings'], [2, 'hatch'], [0.3, 'outline']]
                        : [[2, 'eccentric'], [1, 'spiral'], [1, 'rings'], [2, 'hatch'], [1.5, 'outline']]);
                }
                if (r < s * 0.9) style = 'outline';
                const paths = [];
                if (style === 'spiral') {
                    paths.push(spiral(x, y, r, s, rng.range(0, TAU), rng.sign()));
                } else if (style === 'rings') {
                    for (let rr = r; rr > s * 0.3; rr -= s) paths.push(geo.circle(x, y, rr));
                } else if (style === 'eccentric') {
                    const a = shift + rng.range(-1, 1) * spread;
                    const ux = Math.cos(a) * p.ecc, uy = Math.sin(a) * p.ecc;
                    for (let rr = r; rr > s * 0.3; rr -= s) paths.push(geo.circle(x + (r - rr) * ux, y + (r - rr) * uy, rr));
                } else if (style === 'hatch') {
                    const rim = geo.circle(x, y, r);
                    const z = geo.hatchZigzag(rim.slice(0, -1), s, rng.range(0, Math.PI));
                    if (z.length) paths.push(z);
                    if (p.rim || r < 3 * s) paths.push(rim);
                } else {
                    paths.push(geo.circle(x, y, r));
                }
                let pen = 0;
                if (p.pens > 1) {
                    if (p.penMode === 'size') pen = Math.min(p.pens - 1, Math.floor((1 - Math.log(r / minR) / lnSpan) * p.pens));
                    else if (p.penMode === 'style') pen = STYLES.indexOf(style);
                    else pen = rng.int(0, p.pens - 1);
                }
                for (const path of paths) out.push([path, pen]);
            }
            if (p.pens <= 1) return out.map(o => o[0]);
            const layers = Array.from({ length: p.pens }, () => []);
            for (const [path, pen] of out) layers[pen % p.pens].push(path);
            return { layers };
        },
    });
})();
