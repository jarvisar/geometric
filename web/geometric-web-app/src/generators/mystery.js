/*
 * Mystery Curves — Frank Farris's wheels on wheels on wheels:
 *   z(t) = Σ a_k · e^{i(n_k t + φ_k)},  t ∈ [0, 2π].
 * Each term is a wheel of radius a_k turning n_k times per revolution. When
 * every n_k ≡ m (mod s) with gcd(m, s) = 1, the curve has s-fold rotational
 * symmetry (F. Farris, "Creating Symmetry", 2015), so frequencies are entered
 * as n_k = j_k·s + m. The default wheels are his classic
 * e^{it} + ½e^{6it} + (i/3)e^{−14it} (set Echoes to 1 to see it alone).
 * Echoes redraw the curve while one wheel grows, shrinks or turns; by default
 * wheel 2 shrinks to nothing, which twists the copies into ribbons.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    function wheelParams(k, j, a, ph, label) {
        return [
            { type: 'section', label },
            { id: 'j' + k, label: 'Multiplier j', type: 'range', min: -6, max: 6, step: 1, value: j,
                hint: 'Wheel frequency n = j·symmetry + residue' },
            { id: 'a' + k, label: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, value: a },
            { id: 'p' + k, label: 'Phase°', type: 'range', min: 0, max: 360, step: 1, value: ph },
        ];
    }

    PG.register({
        id: 'mystery',
        name: 'Mystery Curves',
        category: 'Curves',
        description: "Frank Farris's wheels on wheels: sums of circular motions with exact rotational symmetry.",
        fit: true,
        params: [
            { type: 'section', label: 'Symmetry' },
            { id: 's', label: 'Symmetry', type: 'range', min: 2, max: 12, step: 1, value: 5 },
            { id: 'm', label: 'Residue', type: 'range', min: 1, max: 11, step: 1, value: 1,
                hint: 'Every frequency ≡ residue (mod symmetry). Values ≥ symmetry wrap around. A residue sharing a factor with symmetry lowers the symmetry (e.g. 6 and 2 give 3-fold).' },
            ...wheelParams(1, 0, 1, 0, 'Wheel 1'),
            ...wheelParams(2, 1, 0.5, 0, 'Wheel 2'),
            ...wheelParams(3, -3, 0.33, 90, 'Wheel 3'),
            ...wheelParams(4, 2, 0, 0, 'Wheel 4'),
            { type: 'section', label: 'Echoes' },
            { id: 'echoes', label: 'Echoes', type: 'range', min: 1, max: 24, step: 1, value: 8 },
            { id: 'echoWheel', label: 'Varied wheel', type: 'select', value: '2', show: p => p.echoes > 1,
                options: [['1', 'Wheel 1'], ['2', 'Wheel 2'], ['3', 'Wheel 3'], ['4', 'Wheel 4']] },
            { id: 'echoScale', label: 'Last amplitude ×', type: 'range', min: -1.5, max: 2, step: 0.01, value: 0,
                show: p => p.echoes > 1, hint: 'Amplitude multiplier of the varied wheel on the last echo' },
            { id: 'echoTurn', label: 'Phase step°', type: 'range', min: -45, max: 45, step: 0.5, value: 0,
                show: p => p.echoes > 1, hint: 'Extra phase given to the varied wheel on each echo' },
            { type: 'section', label: 'Output' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Echoes alternate between pens' },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng) {
            const s = rng.weighted([[3, 3], [4, 4], [5, 5], [4, 6], [3, 7], [2, 8], [2, 9], [1, 10], [1, 12]]);
            const residues = [];
            for (let r = 1; r < s; r++) if (geo.gcd(r, s) === 1) residues.push(r);
            const m = rng.pick(residues);
            // Frequencies grow wheel by wheel; amplitudes are set from each wheel's
            // speed a·|n| (Farris's classic has speeds 1 : 3 : 4.7), which keeps
            // loops and cusps without the fast wheels drowning the shape.
            const j = [rng.chance(0.75) ? 0 : -1];
            const n = [j[0] * s + m];
            for (let k = 1; k < 4; k++) {
                let best = null;
                for (let t = 0; t < 40 && !best; t++) {
                    const jj = rng.sign() * rng.int(1, k === 1 ? 2 : 3 + (s <= 4 ? 2 : 0));
                    const nn = jj * s + m;
                    if (!j.includes(jj) && Math.abs(nn) > Math.abs(n[k - 1]) && nn !== -n[0]) best = [jj, nn];
                }
                if (!best) best = [j[k - 1] + (j[k - 1] >= 0 ? 1 : -1), 0];
                j.push(best[0]);
                n.push(best[0] * s + m);
            }
            const a = [1];
            let speed = Math.abs(n[0]);
            for (let k = 1; k < 4; k++) {
                speed *= k === 1 ? rng.range(1.5, 3.5) : rng.range(0.9, 1.8);
                a.push(Math.min(a[k - 1] * (k === 1 ? 0.65 : 0.7), speed / Math.abs(n[k])));
            }
            if (rng.chance(0.65)) a[3] = 0;
            const quarter = rng.chance(0.5);
            const ph = () => (quarter ? 90 * rng.int(0, 3) : rng.int(0, 359));
            const out = { s, m, p1: 0, p2: ph(), p3: ph(), p4: ph(), echoes: 1, echoTurn: 0 };
            for (let k = 0; k < 4; k++) { out['j' + (k + 1)] = j[k]; out['a' + (k + 1)] = +a[k].toFixed(2); }
            // estimated ink per copy (mm on A4) caps the echo count; a lone
            // curve is kept only when it carries enough line to fill the page
            let v = 0, ext = 0;
            for (let k = 0; k < 4; k++) { v += a[k] * Math.abs(n[k]); ext += a[k]; }
            const perCopy = 0.6 * TAU * v * 90 / ext;
            if (perCopy < 3500 || rng.chance(0.8)) {
                out.echoes = geo.clamp(Math.floor(20000 / perCopy), 3, rng.int(5, 10));
                out.echoWheel = rng.pick(a[3] > 0 ? ['2', '3', '4'] : ['2', '3']);
                out.echoScale = +rng.pick([rng.range(-0.8, 0.4), rng.range(1.4, 2)]).toFixed(2);
                if (rng.chance(0.3)) out.echoTurn = +rng.range(-10, 10).toFixed(1);
            }
            return out;
        },

        generate(p) {
            const s = Math.max(2, Math.round(p.s));
            const m = Math.round(p.m) % s || 1;
            const base = [];
            for (let k = 1; k <= 4; k++) {
                base.push({ n: Math.round(p['j' + k]) * s + m, a: p['a' + k] || 0, ph: geo.rad(p['p' + k] || 0) });
            }
            if (!base.some(w => w.a !== 0)) base[0].a = 1;

            const K = Math.max(1, Math.round(p.echoes));
            const vary = geo.clamp((+p.echoWheel || 3) - 1, 0, 3);
            const pens = Math.max(1, Math.round(p.pens));
            const layers = Array.from({ length: pens }, () => []);
            const seen = new Set();

            for (let e = 0; e < K; e++) {
                const f = K > 1 ? e / (K - 1) : 0;
                const wheels = base.map((w, i) => i !== vary ? w : {
                    n: w.n, a: w.a * geo.lerp(1, p.echoScale, f), ph: w.ph + geo.rad(e * (p.echoTurn || 0)),
                }).filter(w => Math.abs(w.a) > 1e-6);
                if (!wheels.length) continue;
                // skip echoes identical to an earlier one
                const key = wheels.map(w => `${w.n}:${w.a.toFixed(4)}:${(((w.ph % TAU) + TAU) % TAU).toFixed(4)}`).join('|');
                if (seen.has(key)) continue;
                seen.add(key);

                // the curve repeats after 2π/G when all frequencies share a factor G
                let G = 0, maxN = 1;
                for (const w of wheels) { G = G ? geo.gcd(G, w.n) : Math.abs(w.n); maxN = Math.max(maxN, Math.abs(w.n)); }
                const T = TAU / Math.max(1, G);
                const N = Math.min(40000, Math.ceil((400 + maxN * 110) * p.quality / Math.max(1, G)));
                const path = new Array(N + 1);
                for (let i = 0; i <= N; i++) {
                    const t = (T * i) / N;
                    let x = 0, y = 0;
                    for (const w of wheels) {
                        const a = w.n * t + w.ph;
                        x += w.a * Math.cos(a);
                        y += w.a * Math.sin(a);
                    }
                    path[i] = [x, -y]; // y up, as in the complex plane
                }
                path[N] = [path[0][0], path[0][1]];
                layers[e % pens].push(path);
            }
            return { layers };
        },
    });
})();
