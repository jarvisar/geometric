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
    function web(n, d, count, seen = new Set()) {
        const paths = [];
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
            // ink in mm on A4: the pipeline fits the rose's bounding box to the page
            const bb = geo.bbox([rose(n)]), mm = Math.min(180 / bb.w, 267 / bb.h);
            const ink = paths => paths.reduce((L, path) => L + geo.pathLength(path), 0) * mm;
            // Among steps that trace a real web, pick at random rather than the
            // densest: sparser webs (a few hundred chords) are just as lovely.
            // Steps whose chords hug the petals pile up ink along the rim, so
            // webs beyond the ink budget are passed over too. Steps near a
            // multiple of 180°/n creep along the rose (a moiré of the curve);
            // `hug` keeps a second web away from those so the two don't pile up.
            const pickD = (budget, seen, hug = 0) => {
                let best = null, bestScore = -1;
                for (let t = 0; t < 80; t++) {
                    const d = rng.int(2, 358);
                    if (d % 180 < 20 || d % 180 > 160) continue;
                    const off = d % (180 / n);
                    if (Math.min(off, 180 / n - off) < hug) continue;
                    const w = web(n, d, 361, new Set(seen)), L = ink(w.paths);
                    if (L > budget) continue;
                    if (w.segments >= 150) return { d, L };
                    if (w.segments > bestScore) { bestScore = w.segments; best = { d, L }; }
                }
                return best;
            };
            let budget = 38000 - (p.showRose ? ink([rose(n)]) : 0);
            const first = pickD(budget) || { d: 71, L: 0 };
            const out = { n, d: first.d, fine: false, count: 361, overlay: p.overlay };
            if (p.overlay) {
                // the second web skips chords the first already drew
                const seen = new Set();
                web(n, first.d, 361, seen);
                const second = budget - first.L > 6000 ? pickD(budget - first.L, seen, 6) : null;
                if (second) out.d2 = second.d;
                else out.overlay = false;
            }
            return out;
        },

        generate(p) {
            const n = Math.max(1, Math.round(p.n));
            const d = p.d + (p.fine ? p.dFine : 0);
            const count = Math.max(2, Math.round(p.count));
            const seen = new Set();
            const layers = [web(n, d, count, seen).paths];
            layers.push(p.showRose ? [rose(n)] : []);
            if (p.overlay) layers.push(web(n, p.d2, count, seen).paths); // skips chords already drawn
            return { layers };
        },
    });
})();
