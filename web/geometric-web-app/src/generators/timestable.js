/*
 * Times-table chord diagram (popularised by Mathologer): N points on a circle,
 * a chord from point i to point i·k (mod N). The chords envelope a cardioid
 * for k = 2, a nephroid for k = 3 and, in general, an epicycloid with k − 1
 * cusps. Fractional k simply ends each chord at angle 2π·i·k/N. For integer k
 * the "chain" mode follows orbits i → k·i → k²·i … so that many chords are
 * drawn as one stroke. Zero-length and repeated chords are skipped.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const at = (a) => [Math.cos(a), Math.sin(a)];

    function chords(N, k, start) {
        const out = [];
        const seen = new Set();
        const key = v => Math.round((((v % 1) + 1) % 1) * 1e7) % 10000000;
        for (let i = 0; i < N; i++) {
            const u = i / N, v = (i * k) / N; // positions in turns
            const ku = key(u), kv = key(v);
            if (ku === kv) continue;
            const id = ku < kv ? ku + ':' + kv : kv + ':' + ku;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push([at(start + TAU * u), at(start + TAU * v)]);
        }
        return out;
    }

    // Integer k: cover the functional graph i -> k·i mod N with few long strokes.
    function chains(N, k, start) {
        const f = i => (((i * k) % N) + N) % N;
        const indeg = new Int32Array(N);
        for (let i = 0; i < N; i++) indeg[f(i)]++;
        const used = new Uint8Array(N); // edge i -> f(i) done
        const seen = new Set();
        const out = [];
        const pt = i => at(start + (TAU * i) / N);
        const walk = s => {
            let cur = null, i = s;
            while (!used[i]) {
                used[i] = 1;
                const j = f(i);
                const id = Math.min(i, j) * N + Math.max(i, j);
                if (j === i || seen.has(id)) { cur = null; i = j; continue; }
                seen.add(id);
                if (!cur) { cur = [pt(i)]; out.push(cur); }
                cur.push(pt(j));
                i = j;
            }
        };
        for (let i = 0; i < N; i++) if (indeg[i] === 0) walk(i); // tails first
        for (let i = 0; i < N; i++) if (!used[i]) walk(i);        // then the cycles
        return out;
    }

    PG.register({
        id: 'timestable',
        name: 'Times Table',
        category: 'Curves',
        description: 'Chords from i to i·k around a circle: cardioids, nephroids and their moiré.',
        fit: true,
        params: [
            { type: 'section', label: 'Table' },
            { id: 'N', label: 'Points', type: 'range', min: 10, max: 720, step: 1, value: 200 },
            { id: 'k', label: 'Multiplier k', type: 'range', min: 0, max: 100, step: 0.01, value: 2 },
            { id: 'mode', label: 'Drawing', type: 'select', value: 'chain', random: false,
                options: [['chain', 'Orbits as strokes (integer k)'], ['chords', 'Separate chords']],
                hint: 'Orbit strokes need fewer pen lifts; fractional k always uses chords' },
            { id: 'circle', label: 'Circle outline', type: 'checkbox', value: true, random: 0.6 },
            { id: 'rotate', label: 'Start angle°', type: 'range', min: 0, max: 360, step: 1, value: 180, random: false },
            { type: 'section', label: 'Layers' },
            { id: 'layers', label: 'Layers', type: 'range', min: 1, max: 4, step: 1, value: 1,
                hint: 'Each layer adds Δ to k and goes on its own pen' },
            { id: 'delta', label: 'Δ per layer', type: 'range', min: -3, max: 3, step: 0.01, value: 0.5, show: p => p.layers > 1 },
        ],

        randomize(rng) {
            // An envelope with k − 1 cusps needs ~30 points per cusp to read
            // cleanly, so N follows k (capped so several layers stay light).
            const out = {};
            const style = rng.weighted([[5, 'int'], [3, 'frac'], [1, 'wide']]);
            out.layers = rng.chance(0.3) ? rng.int(2, 3) : 1;
            const cap = Math.round(out.layers > 1 ? 320 / out.layers : 400);
            if (style === 'wide') {
                // k near N/2: every other chord flips across the circle, overlaying
                // two small-multiplier patterns turned by half a turn
                out.N = 2 * rng.int(75, 180);
                out.k = out.N / 2 + rng.pick([2, 3, 4]);
                out.layers = 1;
            } else {
                out.k = style === 'int' ? rng.weighted([[3, 2], [3, 3], [2, 4], [2, 5], [1, 6], [1, 7], [1, 9]])
                    : +(rng.int(2, 6) + rng.pick([0.25, 0.5, 0.75, 1 / 3, 2 / 3])).toFixed(2);
                out.N = Math.round(geo.clamp(Math.max(120, 30 * (out.k - 1)) * rng.range(1, 1.6), 90, Math.max(cap, 90)));
            }
            if (out.layers > 1) out.delta = +(rng.sign() * rng.pick([rng.range(0.02, 0.1), 0.5, 1])).toFixed(2);
            return out;
        },

        generate(p) {
            const N = Math.max(2, Math.round(p.N));
            const start = geo.rad(p.rotate);
            const L = Math.max(1, Math.round(p.layers));
            const layers = [];
            for (let l = 0; l < L; l++) {
                const k = p.k + l * p.delta;
                const integer = Math.abs(k - Math.round(k)) < 1e-9;
                layers.push(p.mode === 'chain' && integer ? chains(N, Math.round(k), start) : chords(N, k, start));
            }
            if (p.circle) layers[0].push(geo.circle(0, 0, 1, Math.max(180, N)));
            return { layers };
        },
    });
})();
