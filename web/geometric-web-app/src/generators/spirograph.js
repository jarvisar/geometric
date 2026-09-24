/*
 * Spirograph — hypotrochoids (gear rolling inside a ring) and epitrochoids
 * (gear rolling outside). With integer tooth counts the curve closes after
 * r / gcd(R, r) trips around the ring, so we draw exactly one full cycle.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'spirograph',
        name: 'Spirograph',
        category: 'Curves',
        description: 'Gears rolling inside or outside a ring, with nested pen-hole rings.',
        fit: true,
        params: [
            { type: 'section', label: 'Gears' },
            { id: 'type', label: 'Gear position', type: 'select', value: 'hypo', random: ['hypo', 'hypo', 'epi'],
                options: [['hypo', 'Inside ring (hypotrochoid)'], ['epi', 'Outside ring (epitrochoid)']] },
            { id: 'R', label: 'Ring teeth', type: 'range', min: 24, max: 160, step: 1, value: 96 },
            { id: 'r', label: 'Gear teeth', type: 'range', min: 5, max: 120, step: 1, value: 52 },
            { id: 'hole', label: 'Pen hole', type: 'range', min: 0.05, max: 1.6, step: 0.01, value: 0.82,
                hint: 'Distance of the pen from the gear centre, relative to gear radius' },
            { type: 'section', label: 'Rings' },
            { id: 'rings', label: 'Rings', type: 'range', min: 1, max: 16, step: 1, value: 3, random: [1, 8] },
            { id: 'holeStep', label: 'Hole change', type: 'range', min: -0.3, max: 0.3, step: 0.01, value: -0.14,
                show: p => p.rings > 1 },
            { id: 'ringRotate', label: 'Ring rotation°', type: 'range', min: 0, max: 90, step: 0.5, value: 0,
                show: p => p.rings > 1 },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng) {
            const R = rng.int(60, 150);
            let r = 0;
            for (let tries = 0; tries < 200; tries++) {
                const c = rng.int(12, Math.min(120, R - 4));
                const q = c / geo.gcd(R, c);
                if (q >= 3 && q <= 30) { r = c; break; }
            }
            if (!r) r = Math.round(R * 0.4);
            return { R, r, hole: +rng.range(0.4, 1.3).toFixed(2), holeStep: +rng.range(-0.2, 0.1).toFixed(2) };
        },

        generate(p) {
            const R = Math.round(p.R), r = Math.max(1, Math.round(p.r));
            const g = geo.gcd(R, r);
            const P = R / g, Q = r / g; // lobes, trips around the ring
            const epi = p.type === 'epi';
            const k = epi ? (R + r) / r : (R - r) / r;
            const base = epi ? R + r : R - r;
            const innerTurns = Math.abs(epi ? P + Q : P - Q) + Q;
            const layers = Array.from({ length: p.pens }, () => []);
            if (!epi && r === R) {
                // a gear as big as the ring can't roll: the pen just circles the centre
                layers[0].push(geo.circle(0, 0, r * p.hole, 360));
                return { layers };
            }

            for (let ring = 0; ring < p.rings; ring++) {
                const hole = p.hole + ring * p.holeStep;
                if (hole < 0.01) break; // further rings would overdraw the same tiny curve
                const d = r * hole;
                const N = Math.min(250000, Math.ceil(innerTurns * 90 * p.quality * Math.max(1, d / r)));
                const rot = geo.rad(ring * p.ringRotate);
                const c = Math.cos(rot), s = Math.sin(rot);
                const tMax = TAU * Q;
                const path = new Array(N + 1);
                for (let i = 0; i <= N; i++) {
                    const t = (tMax * i) / N;
                    const x = base * Math.cos(t) + (epi ? -d : d) * Math.cos(k * t);
                    const y = base * Math.sin(t) - d * Math.sin(k * t);
                    path[i] = [x * c - y * s, x * s + y * c];
                }
                layers[ring % p.pens].push(path);
            }
            return { layers };
        },
    });
})();
