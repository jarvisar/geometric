/*
 * Maurer rose (Peter Maurer, "A Rose is a Rose...", 1987): walk the rose
 * r = sin(nθ) in jumps of d degrees, θ_k = k·d, and join the visited points
 * with straight lines. Segments the walk has already drawn are skipped, so a
 * walk that retraces itself doesn't ink the same chord twice.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // Rose point for angle in degrees.
    function rosePt(n, deg) {
        const a = geo.rad(deg), r = Math.sin(n * a);
        return [r * Math.cos(a), -r * Math.sin(a)];
    }

    // The web for step d: one polyline, broken wherever it would repeat a chord.
    function web(n, d, count) {
        const paths = [];
        const seen = new Set();
        const key = p => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
        let cur = null, prev = rosePt(n, 0), prevKey = key(prev);
        for (let k = 1; k < count; k++) {
            const q = rosePt(n, k * d), qKey = key(q);
            const seg = prevKey < qKey ? prevKey + '|' + qKey : qKey + '|' + prevKey;
            if (qKey === prevKey || seen.has(seg)) {
                cur = null;
            } else {
                seen.add(seg);
                if (!cur) { cur = [prev]; paths.push(cur); }
                cur.push(q);
            }
            prev = q; prevKey = qKey;
        }
        return { paths, segments: seen.size };
    }

    // The rose itself: n petals over 180° for odd n, 2n petals over 360° for even n.
    function rose(n) {
        const sweep = n % 2 ? 180 : 360;
        const N = Math.ceil(sweep * Math.max(2, n) / 3);
        const pts = [];
        for (let i = 0; i <= N; i++) pts.push(rosePt(n, (sweep * i) / N));
        return pts;
    }

    PG.register({
        id: 'maurer',
        name: 'Maurer Rose',
        category: 'Curves',
        description: 'Straight chords hopping around a rose curve in fixed angle steps.',
        fit: true,
        params: [
            { type: 'section', label: 'Rose' },
            { id: 'n', label: 'Petal number n', type: 'range', min: 1, max: 12, step: 1, value: 6 },
            { id: 'd', label: 'Step d°', type: 'range', min: 1, max: 359, step: 1, value: 71 },
            { id: 'fine', label: 'Fractional step', type: 'checkbox', value: false },
            { id: 'dFine', label: 'Step fine-tune°', type: 'range', min: -1, max: 1, step: 0.001, value: 0.1,
                show: p => p.fine, hint: 'Added to d; a fractional step no longer closes, so the web drifts' },
            { id: 'count', label: 'Points', type: 'range', min: 50, max: 3600, step: 1, value: 361, random: false },
            { type: 'section', label: 'Layers' },
            { id: 'showRose', label: 'Rose curve (pen 2)', type: 'checkbox', value: true, random: 0.5 },
            { id: 'overlay', label: 'Second web', type: 'checkbox', value: false, random: 0.3 },
            { id: 'd2', label: 'Second step d°', type: 'range', min: 1, max: 359, step: 1, value: 151, show: p => p.overlay },
        ],

        randomize(rng, p) {
            // Good webs visit many distinct chords. Steps near 0° or 180° just
            // trace the rose again, and steps that land on its zeros collapse
            // to a few lines, so score candidates by their distinct chords.
            const n = rng.weighted([[1, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [1, 8], [1, 9], [0.5, 10]]);
            const pickD = () => {
                let best = 71, bestScore = -1;
                for (let t = 0; t < 40; t++) {
                    const d = rng.int(2, 358);
                    if (d % 180 < 20 || d % 180 > 160) continue;
                    const score = web(n, d, 361).segments + 20 * rng.random();
                    if (score > bestScore) { bestScore = score; best = d; }
                    if (score > 300) break;
                }
                return best;
            };
            const ink = w => w.paths.reduce((L, path) => L + geo.pathLength(path), 0) * 90; // ≈ mm on A4
            const out = { n, d: pickD(), fine: false, count: 361, overlay: p.overlay };
            if (p.overlay) {
                out.d2 = pickD();
                if (ink(web(n, out.d, 361)) + ink(web(n, out.d2, 361)) > 45000) out.overlay = false;
            }
            return out;
        },

        generate(p) {
            const n = Math.max(1, Math.round(p.n));
            const d = p.d + (p.fine ? p.dFine : 0);
            const count = Math.max(2, Math.round(p.count));
            const layers = [web(n, d, count).paths];
            if (p.showRose) layers.push([rose(n)]);
            if (p.overlay) layers.push(web(n, p.d2, count).paths);
            return { layers };
        },
    });
})();
