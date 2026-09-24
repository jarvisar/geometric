/*
 * Flower — the original design of this app. Every petal owns an equal sector
 * of the circle and is filled with nested copies of one curve, scaled from
 * the centre outwards. Along a petal (t = 0..1 across its sector):
 *   r = R · (j / lines) · rose · sin(πt)^sharpness · (1 + organic·sin(3·nθ + πt))
 * where rose = (1 − width) + width·cos(nθ) dips in the middle of the sector,
 * which splits each petal into two lobes (and past width 0.5 pushes the
 * middle through the centre). Extras: a twist that turns the outer lines,
 * and an optional second ring of petals, offset by half a petal, on pen 2.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // One ring of petals. Angles in radians, rotated by `offset`.
    function ring(p, n, scale, offset, clearR) {
        const paths = [];
        const L = Math.max(1, Math.round(p.lines));
        const M = Math.max(4, Math.round(p.points));
        const sector = TAU / n;
        for (let i = 0; i < n; i++) {
            const a0 = offset + sector * i;
            for (let j = 1; j <= L; j++) {
                const ratio = j / L;
                const twist = geo.rad(p.twist) * ratio;
                let cur = null;
                for (let k = 0; k <= M; k++) {
                    const t = k / M;
                    const ang = a0 + t * sector + twist;
                    const pa = n * (sector * i + t * sector); // petal angle, as in the original
                    const rose = (1 - p.width) + p.width * Math.cos(pa);
                    const fall = Math.pow(Math.sin(Math.PI * t), p.sharpness);
                    const organic = 1 + p.organic * Math.sin(3 * pa + t * Math.PI);
                    const r = scale * ratio * rose * fall * organic;
                    // keep the centre disc clear so the lines don't pile up in one spot
                    if (clearR > 0 && Math.abs(r) < clearR) { cur = null; continue; }
                    if (!cur) { cur = []; paths.push(cur); }
                    cur.push([r * Math.cos(ang), r * Math.sin(ang)]);
                }
            }
        }
        return paths.filter(q => q.length > 1);
    }

    PG.register({
        id: 'flower',
        name: 'Flower',
        category: 'Curves',
        description: 'Petals filled with nested contour lines around a round centre.',
        fit: true,
        params: [
            { type: 'section', label: 'Petals' },
            { id: 'petals', label: 'Petals', type: 'range', min: 3, max: 24, step: 1, value: 12 },
            { id: 'lines', label: 'Lines per petal', type: 'range', min: 1, max: 60, step: 1, value: 20 },
            { id: 'sharpness', label: 'Petal sharpness', type: 'range', min: 0.5, max: 3, step: 0.05, value: 1.2, random: [0.6, 2.2] },
            { id: 'width', label: 'Petal width', type: 'range', min: 0, max: 0.8, step: 0.01, value: 0.4, random: [0.1, 0.7] },
            { id: 'organic', label: 'Organic variation', type: 'range', min: 0, max: 0.3, step: 0.01, value: 0.1, random: [0, 0.25] },
            { id: 'twist', label: 'Twist°', type: 'range', min: -90, max: 90, step: 1, value: 0, random: [-30, 30],
                hint: 'Turns each line by this much times its size, so outer lines swirl' },
            { type: 'section', label: 'Centre' },
            { id: 'centre', label: 'Centre size', type: 'range', min: 0, max: 0.3, step: 0.01, value: 0.1 },
            { id: 'clear', label: 'Keep centre clear', type: 'checkbox', value: true, random: false,
                hint: 'Stop the petal lines at the centre circle instead of meeting in one point' },
            { type: 'section', label: 'Second ring' },
            { id: 'ring2', label: 'Second ring (pen 2)', type: 'checkbox', value: false },
            { id: 'ring2Scale', label: 'Size', type: 'range', min: 0.2, max: 1.2, step: 0.01, value: 0.6, show: p => p.ring2 },
            { id: 'ring2Lines', label: 'Lines per petal', type: 'range', min: 1, max: 60, step: 1, value: 12, show: p => p.ring2 },
            { type: 'section', label: 'Quality' },
            { id: 'points', label: 'Points per line', type: 'range', min: 20, max: 300, step: 1, value: 100, random: false },
        ],

        randomize(rng, p) {
            const out = {
                petals: rng.weighted([[1, 5], [1, 6], [1, 7], [1, 8], [2, rng.int(9, 12)], [1, rng.int(13, 18)]]),
                twist: rng.chance(0.6) ? 0 : rng.sign() * rng.int(5, 30),
                ring2: rng.chance(0.3),
            };
            // Measure one outer petal line: how far it reaches (sets the page
            // scale) and how long it is, then pick the line count for ~22 m of ink.
            const n = out.petals, sector = TAU / n;
            let reach = 0, len = 0, prev = null;
            for (let k = 0; k <= 100; k++) {
                const t = k / 100, pa = TAU * t, ang = t * sector;
                const r = ((1 - p.width) + p.width * Math.cos(pa)) * Math.pow(Math.sin(Math.PI * t), p.sharpness) *
                    (1 + p.organic * Math.sin(3 * pa + t * Math.PI));
                const q = [r * Math.cos(ang), r * Math.sin(ang)];
                if (prev) len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
                prev = q;
                reach = Math.max(reach, Math.abs(r));
            }
            const perLine = (n * len / Math.max(reach, 1e-3)) * 90 * 0.4; // mm, averaged over nested sizes
            const budget = out.ring2 ? 17000 : 22000;
            out.lines = geo.clamp(Math.round(budget / perLine), 4, 30);
            out.centre = +(reach * rng.range(0.08, 0.3)).toFixed(2);
            if (out.ring2) {
                out.ring2Scale = +rng.range(0.45, 0.8).toFixed(2);
                out.ring2Lines = Math.max(3, Math.round(out.lines * rng.range(0.4, 0.7)));
            }
            return out;
        },

        generate(p) {
            const n = Math.max(1, Math.round(p.petals));
            const cr = Math.max(0, p.centre);
            const clearR = p.clear ? cr : 0;
            const layers = [ring(p, n, 1, 0, clearR)];
            if (p.ring2) {
                const q = Object.assign({}, p, { lines: p.ring2Lines });
                layers.push(ring(q, n, p.ring2Scale, Math.PI / n, clearR));
            }
            if (cr > 0) layers[0].push(geo.circle(0, 0, cr, 180));
            return { layers };
        },
    });
})();
