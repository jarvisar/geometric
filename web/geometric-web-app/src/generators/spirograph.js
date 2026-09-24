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
            { id: 'type', label: 'Gear position', type: 'select', value: 'hypo',
                options: [['hypo', 'Inside ring (hypotrochoid)'], ['epi', 'Outside ring (epitrochoid)']] },
            { id: 'R', label: 'Ring teeth', type: 'range', min: 24, max: 160, step: 1, value: 96 },
            { id: 'r', label: 'Gear teeth', type: 'range', min: 5, max: 120, step: 1, value: 52 },
            { id: 'hole', label: 'Pen hole', type: 'range', min: 0.05, max: 1.6, step: 0.01, value: 0.82,
                hint: 'Distance of the pen from the gear centre, relative to gear radius' },
            { type: 'section', label: 'Rings' },
            { id: 'rings', label: 'Rings', type: 'range', min: 1, max: 16, step: 1, value: 3 },
            { id: 'holeStep', label: 'Hole change', type: 'range', min: -0.3, max: 0.3, step: 0.01, value: -0.14,
                show: p => p.rings > 1 },
            { id: 'ringRotate', label: 'Ring rotation°', type: 'range', min: 0, max: 90, step: 0.5, value: 0,
                show: p => p.rings > 1 },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng) {
            // Pick the look first: P lobes, Q trips around the ring (coprime,
            // so the curve really has P lobes), then scale both to real tooth
            // counts. The band the pen sweeps (pen offset over the radius of
            // the gear centre's path) must be wide enough to read as
            // interlaced loops rather than a thin ring.
            let epi = false, P = 7, Q = 3, hole = 0.8;
            for (let tries = 0; tries < 300; tries++) {
                const e = rng.chance(0.3);
                const p = rng.weighted([[3, rng.int(5, 12)], [3, rng.int(13, 24)], [1, rng.int(25, 40)]]);
                const q = rng.int(1, Math.min(16, p - 1));
                const f = q / p, h = rng.range(e ? 0.7 : 0.45, e ? 1.5 : 1.3);
                const band = e ? f * h / (1 + f) : f * h / (1 - f);
                if (geo.gcd(p, q) === 1 && band >= 0.4 && band <= 2 && f >= (e ? 0.25 : 0.15)) {
                    epi = e; P = p; Q = q; hole = +h.toFixed(2);
                    break;
                }
            }
            const mMin = Math.max(1, Math.ceil(24 / P), Math.ceil(5 / Q)), mMax = Math.max(mMin, Math.floor(Math.min(150 / P, 120 / Q)));
            const mult = rng.int(mMin, mMax);
            const R = P * mult, r = Q * mult;
            // ink per ring ≈ curve length / figure diameter (fit to ≈ 180 mm)
            const base = epi ? R + r : R - r, d = r * hole, k = base / r;
            let L = 0, px = base + (epi ? -d : d), py = 0;
            for (let i = 1; i <= 4000; i++) {
                const t = (TAU * Q * i) / 4000;
                const x = base * Math.cos(t) + (epi ? -d : d) * Math.cos(k * t), y = base * Math.sin(t) - d * Math.sin(k * t);
                L += Math.hypot(x - px, y - py); px = x; py = y;
            }
            const perRing = (L / (2 * (base + d))) * 180;
            const rings = geo.clamp(Math.round(rng.range(8000, 24000) / perRing), 1, 7);
            const holeStep = rings > 1 ? +Math.max(-0.3, -rng.range(0.4, 0.8) * hole / rings).toFixed(2) : -0.1;
            return {
                type: epi ? 'epi' : 'hypo', R, r, hole, rings, holeStep,
                ringRotate: rings > 1 ? PG.snap(rng.pick([0, 0, 0.5, 0.25]) * 360 / P, 0.5) : 0,
            };
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
