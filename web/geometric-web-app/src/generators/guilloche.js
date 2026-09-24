/*
 * Guilloché rosette, as engraved on banknotes and watch dials. Each band is
 * filled by K copies of one wave, shifted by 1/K of a wavelength:
 *   r_k(θ) = inner(θ) + (outer(θ) − inner(θ)) · (0.5 + 0.5·wave(Nθ + 2πk/K))
 * with scalloped boundaries inner = Ri + ai·sin(mi·θ), outer = Ro + ao·sin(mo·θ)
 * and wave(s) = sign(sin s)·|sin s|^p. The shifted copies cross each other and
 * weave the characteristic mesh. "Loops" also swing each point along the
 * circle, which turns the waves into trochoid loops. Bands stack inwards
 * with gaps, around an optional small central rosette.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    const shaped = (s, pw) => (pw === 1 ? s : Math.sign(s) * Math.pow(Math.abs(s), pw));

    // K closed lines filling one band.
    function band(o) {
        const lines = [];
        const M = Math.min(20000, Math.ceil(Math.max(360, o.N * 18 * (1 + Math.min(o.loop, 3) * 0.6)) * o.quality));
        for (let k = 0; k < o.K; k++) {
            const ph = (TAU * k) / o.K;
            const pts = new Array(M + 1);
            for (let i = 0; i <= M; i++) {
                const th = (TAU * i) / M;
                const u = o.N * th + ph;
                const rin = o.ri + o.ai * Math.sin(o.mi * th);
                const rout = o.ro + o.ao * Math.sin(o.mo * th);
                const r = rin + (rout - rin) * (0.5 + 0.5 * shaped(Math.sin(u), o.pw));
                const a = th + o.rot + (o.loop * Math.cos(u)) / o.N;
                pts[i] = [r * Math.cos(a), r * Math.sin(a)];
            }
            pts[M] = [pts[0][0], pts[0][1]];
            lines.push(pts);
        }
        return lines;
    }

    PG.register({
        id: 'guilloche',
        name: 'Guilloché',
        category: 'Curves',
        description: 'Banknote-style rosette: bands of phase-shifted waves woven into a mesh.',
        fit: true,
        params: [
            { type: 'section', label: 'Bands' },
            { id: 'bands', label: 'Bands', type: 'range', min: 1, max: 4, step: 1, value: 3 },
            { id: 'lines', label: 'Lines per band', type: 'range', min: 2, max: 60, step: 1, value: 10 },
            { id: 'waves', label: 'Waves (outer band)', type: 'range', min: 3, max: 120, step: 1, value: 24, random: [12, 48],
                hint: 'Inner bands get proportionally fewer waves' },
            { id: 'shape', label: 'Wave shape', type: 'range', min: 0.3, max: 3, step: 0.05, value: 1.3, random: [0.6, 1.8],
                hint: '< 1 squarer crests, > 1 sharper crests' },
            { id: 'loop', label: 'Loops', type: 'range', min: 0, max: 3, step: 0.05, value: 0, random: false,
                hint: 'Swing along the circle; above 1 the waves curl into loops' },
            { id: 'gap', label: 'Gap between bands', type: 'range', min: 0, max: 0.2, step: 0.005, value: 0.05, random: [0.02, 0.08] },
            { id: 'taper', label: 'Band width taper', type: 'range', min: 0.5, max: 1.5, step: 0.01, value: 0.85, random: [0.65, 1.1] },
            { id: 'core', label: 'Core radius', type: 'range', min: 0, max: 0.6, step: 0.01, value: 0.22, random: [0.12, 0.35] },
            { type: 'section', label: 'Scallops' },
            { id: 'lobesOut', label: 'Outer lobes', type: 'range', min: 0, max: 24, step: 1, value: 12, random: [0, 16] },
            { id: 'ampOut', label: 'Outer depth', type: 'range', min: 0, max: 0.15, step: 0.005, value: 0.035, random: [0, 0.05] },
            { id: 'lobesIn', label: 'Inner lobes', type: 'range', min: 0, max: 24, step: 1, value: 12, random: [0, 16] },
            { id: 'ampIn', label: 'Inner depth', type: 'range', min: 0, max: 0.15, step: 0.005, value: 0.025, random: [0, 0.05] },
            { id: 'twist', label: 'Band twist°', type: 'range', min: -180, max: 180, step: 1, value: 0, random: false,
                hint: 'Rotation of each band relative to the one outside it, in fractions of a lobe (180° = half a lobe)' },
            { type: 'section', label: 'Centre' },
            { id: 'centre', label: 'Central rosette', type: 'checkbox', value: true, random: 0.7 },
            { id: 'centreWaves', label: 'Rosette petals', type: 'range', min: 3, max: 24, step: 1, value: 12, show: p => p.centre, random: [5, 16] },
            { type: 'section', label: 'Output' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false, hint: 'Pens alternate by band' },
            { id: 'quality', label: 'Smoothness', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1, random: false },
        ],

        randomize(rng, p) {
            const lobes = rng.pick([0, 6, 8, 10, 12, 12, 16, 18]);
            const out = {
                bands: rng.weighted([[1, 1], [3, 2], [4, 3], [2, 4]]),
                lobesOut: lobes, lobesIn: rng.chance(0.7) ? lobes : rng.pick([0, lobes / 2 | 0, lobes * 2]),
                twist: rng.pick([0, 0, 180, 90]),
                loop: rng.chance(0.25) ? +rng.range(1.1, 2) : 0,
            };
            if (out.bands === 1) out.core = +rng.range(0.3, 0.5).toFixed(2);
            const core = out.core || p.core;
            // Pick the wave count from the outer band's shape: a crest about as
            // wide as the band is tall weaves the classic diamond mesh.
            let wsum = 0;
            for (let b = 0; b < out.bands; b++) wsum += Math.pow(p.taper, b);
            const w0 = Math.max(0.05, (1 - core - out.bands * p.gap) / wsum);
            let N = Math.round((rng.range(0.6, 1.4) * TAU * (1 - w0 / 2)) / w0);
            if (lobes) N = lobes * Math.max(1, Math.round(N / lobes));
            out.waves = geo.clamp(N, 6, 60);
            // lines × waves sets the mesh density: keep it plottable with a 0.35 mm pen
            out.lines = geo.clamp(Math.round(rng.range(140, 260) / out.waves), 4, 16);
            out.ampOut = lobes ? p.ampOut : 0;
            out.ampIn = out.lobesIn ? p.ampIn : 0;
            // twisted bands put crest against trough: keep the scallops inside the gap
            const room = p.gap * 0.9;
            if (out.twist && out.ampOut + out.ampIn > room) {
                const k = room / (out.ampOut + out.ampIn);
                out.ampOut = +(out.ampOut * k).toFixed(3); out.ampIn = +(out.ampIn * k).toFixed(3);
            }
            if (out.loop) out.loop = +out.loop.toFixed(2);
            return out;
        },

        generate(p) {
            const B = Math.max(1, Math.round(p.bands));
            const K = Math.max(1, Math.round(p.lines));
            const N0 = Math.max(1, Math.round(p.waves));
            const pens = Math.max(1, Math.round(p.pens));
            const layers = Array.from({ length: pens }, () => []);
            const core = geo.clamp(p.core, 0, 0.9);
            let gap = p.gap;
            let avail = 1 - core - (B - 1) * gap - (p.centre ? gap : 0);
            if (avail < 0.05 * B) { gap = Math.max(0, (1 - core - 0.05 * B) / (B - 1 + (p.centre ? 1 : 0) || 1)); avail = 0.05 * B; }
            let wsum = 0;
            for (let b = 0; b < B; b++) wsum += Math.pow(p.taper, b);

            const mo = Math.round(p.lobesOut), mi = Math.round(p.lobesIn);
            const mid0 = 1 - avail / wsum / 2;
            let ro = 1;
            for (let b = 0; b < B; b++) {
                const w = (avail * Math.pow(p.taper, b)) / wsum;
                const ri = ro - w;
                // wave count follows the radius, snapped to whole waves per lobe
                let N = b === 0 ? N0 : Math.max(1, Math.round((N0 * (ro + ri)) / 2 / mid0));
                if (b > 0 && mo > 0 && N >= mo) N = mo * Math.round(N / mo);
                const lines = band({
                    K, N, pw: p.shape, loop: p.loop, quality: p.quality,
                    ro, ri, ao: p.ampOut, ai: p.ampIn, mo, mi,
                    rot: (geo.rad(p.twist) * b) / (mo || N), // twist is measured in lobes (or waves)
                });
                layers[b % pens].push(...lines);
                ro = ri - gap;
            }
            if (p.centre && core > 0.01) {
                const rc = Math.min(core, ro);
                const Nc = Math.max(1, Math.round(p.centreWaves));
                // same line spacing as the outer band, measured at 60% of the rosette radius
                const Kc = geo.clamp(Math.round((K * N0 * rc * 0.6) / (mid0 * Nc)), 2, 24);
                const lines = band({
                    K: Kc, N: Nc, pw: 1, loop: 0, quality: p.quality,
                    ro: rc, ri: rc * 0.12, ao: 0, ai: 0, mo: 0, mi: 0, rot: 0,
                });
                layers[B % pens].push(...lines);
            }
            return { layers };
        },
    });
})();
