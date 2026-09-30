/*
 * Ribbon sculptures: linked chains, knots and twisted bands built from fine
 * ribs, with hidden lines removed exactly. Each band is a ruled surface around
 * a closed centre curve. Its frame comes from the ring plane or torus it sits
 * on, or from a rotation minimizing frame, so the twist always closes up.
 * Ribs are spaced evenly along the band and thinned where it turns away, and
 * the side of the band facing the viewer picks the pen.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const apply = (m, a) => [dot(m[0], a), dot(m[1], a), dot(m[2], a)];
    const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    const rot = (axis, a) => {
        const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], j = (axis + 1) % 3, k = (axis + 2) % 3, c = Math.cos(a), s = Math.sin(a);
        m[j][j] = c; m[j][k] = -s; m[k][j] = s; m[k][k] = c;
        return m;
    };
    const BIAS = 0.35; // mm, lines sit this far in front of their own surface so the flat facets never hide them
    const BANDS = 12;  // color bands along each strand, merged as needed for the pen count
    const SLANT = ['chevron', 'twill', 'wave', 'ogee', 'lattice'];

    // Share of the total twist reached at each sample. sharp = 1 gathers the half twists into folds at `centres`.
    function twist(M, k, centres, sharp) {
        const g = new Float64Array(M + 1), bump = new Float64Array(M);
        if (!k) return g;
        let mean = 0;
        for (let i = 0; i < M; i++) {
            for (const c of centres) bump[i] += Math.exp(26 * (Math.cos(TAU * ((i + 0.5) / M - c)) - 1));
            mean += bump[i] / M;
        }
        for (let i = 0; i < M; i++) g[i + 1] = g[i] + (1 - sharp) + sharp * bump[i] / mean;
        const total = g[M];
        for (let i = 1; i <= M; i++) g[i] /= total;
        return g;
    }
    // Smallest spacing along the band (mm) that keeps copies of rib vector R, offset by D per mm, at least g apart on paper
    function spacing(D, R, g) {
        const L = Math.hypot(R[0], R[1]);
        if (L < 1e-9) return g / Math.max(Math.hypot(D[0], D[1]), 1e-9);
        const pa = Math.abs(D[0] * R[0] + D[1] * R[1]) / L, pp = Math.abs(D[0] * R[1] - D[1] * R[0]) / L, A = pp * pp + pa * pa;
        let a = pp > 1e-12 ? g / pp : 1e9;
        // short ribs can also clear each other end to end
        if (pa > 1e-12) a = Math.min(a, Math.max(L / pa, (L * pa + Math.sqrt(Math.max(0, L * L * pa * pa - A * (L * L - g * g)))) / A));
        return Math.min(a, 1e9);
    }
    // Contiguous groups of items with roughly equal weight, each with some weight when possible
    function split(w, K) {
        const total = w.reduce((a, b) => a + b, 0), out = [];
        let left = w.filter(x => x > 0).length, g = 0, acc = 0, mine = 0;
        for (const x of w) {
            if (x > 0 && mine > 0 && g < K - 1 && (acc >= total * (g + 1) / K || left <= K - 1 - g)) { g++; mine = 0; }
            out.push(g);
            if (x > 0) { acc += x; mine += x; left--; }
        }
        return out;
    }
    const spread = (k, off) => Array.from({ length: k }, (_, i) => (i + off) / k);
    const torusNormal = (a, b) => t => { const u = TAU * t; return [Math.cos(b * u) * Math.cos(a * u), Math.cos(b * u) * Math.sin(a * u), Math.sin(b * u)]; };
    const torusKnot = (a, b, R, r) => t => { const u = TAU * t, rr = R + r * Math.cos(b * u); return [rr * Math.cos(a * u), rr * Math.sin(a * u), r * Math.sin(b * u)]; };

    // Centre curves on t in [0, 1). ref is the normal of the plane or torus the band leans
    // against (angle 0 lies flat on it), null for a rotation minimizing frame. base is the
    // band angle each form looks best at, the lean param turns it from there.
    const BASE = { chain: 90, mobius: 30, knot: 30, eight: 20, borromean: 90, coil: 80, infinity: 110, hopf: 0, rosette: 0 };
    function sculpture(p, M, rng) {
        // the seed moves the folds around, but chain links and the Möbius keep them near their sides
        const k = p.twists, lean = geo.rad(BASE[p.form] + p.lean), strands = [];
        const jit = ['chain', 'mobius'].includes(p.form) ? rng.range(-0.03, 0.03) : rng.random();
        let pre = rot(0, 0), long = null;
        const add = (at, ref, hw, kk = k, centres = spread(kk, jit), wf = null) => strands.push({ at, ref, hw, k: kk, centres, wf });
        if (p.form === 'chain') {
            // Neighbouring links meet where each one's band crosses the other's plane. Space them so the
            // bands clear each other there, whatever the twist has done to the band by then.
            const n = p.loops, wide = 1.1, centres = spread(k, jit), g = twist(M, k, centres, p.folds);
            const flat = t => Math.abs(Math.cos(lean + Math.PI * k * g[Math.round(t * M) % M]));
            let hw = p.width / 2, lo, hi;
            for (let tries = 0; tries < 30; tries++) {
                lo = 1 + hw * (flat(0.25) + flat(0.75)) / 2 + 0.05;
                hi = 2 - hw * (flat(0.25) + flat(0.75)) - 3 * hw * hw / (wide * wide) - 0.06;
                if (lo <= hi) break;
                hw *= 0.94;
            }
            const d = geo.clamp(p.separation, lo, Math.max(lo, hi));
            for (let j = 0; j < n; j++) {
                const a = j % 2 ? -0.63 : 0.63, u = [Math.cos(a), 0, Math.sin(a)], nrm = [-Math.sin(a), 0, Math.cos(a)];
                const y0 = (j - (n - 1) / 2) * d;
                add(t => { const c = wide * Math.cos(TAU * t); return [u[0] * c, y0 + Math.sin(TAU * t), u[2] * c]; }, () => nrm, hw, k, centres);
            }
            long = 'y';
        } else if (p.form === 'mobius') {
            // Starts on the side of the ring so the twist, and the color swap at the seam, sit where
            // the band runs across the view. Seen end on a twist looks like a comb of spikes.
            add(t => { const u = TAU * (t + 0.25); return [Math.cos(u), 0.9 * Math.sin(u), 0.1 * Math.sin(2 * u)]; }, () => [0, 0, 1], p.width * 0.7, k % 2 ? k : Math.max(1, k - 1));
            pre = rot(0, -1.3);
            long = 'x';
        } else if (p.form === 'knot') {
            const [a, b] = p.knot.split(',').map(Number);
            add(torusKnot(a, b, 2, 0.85), torusNormal(a, b), p.width * 0.55);
        } else if (p.form === 'eight') {
            add(t => { const u = TAU * t, r = 2 + Math.cos(2 * u); return [r * Math.cos(3 * u), r * Math.sin(3 * u), Math.sin(4 * u)]; }, null, p.width * 0.55);
        } else if (p.form === 'borromean') {
            const A = 1.9, hw = p.width * 0.36;
            add(t => [A * Math.cos(TAU * t), Math.sin(TAU * t), 0], () => [0, 0, 1], hw);
            add(t => [0, A * Math.cos(TAU * t), Math.sin(TAU * t)], () => [1, 0, 0], hw);
            add(t => [Math.sin(TAU * t), 0, A * Math.cos(TAU * t)], () => [0, 1, 0], hw);
            // down the (1, 1, 1) diagonal at the default tilt and turn
            pre = mul(mul(rot(1, geo.rad(8)), rot(0, geo.rad(-18))), mul(rot(0, 0.6155), rot(1, -Math.PI / 4)));
        } else if (p.form === 'hopf') {
            // Villarceau circles: every pair of rings on the torus links once. The bands fill most of
            // the spacing between rings, since a gap in front lining up with one on the far side of
            // the tube leaves a see-through hole that just looks like a mistake.
            const n = p.rings, R = 2, r = 0.95, sb = r / R, cb = Math.sqrt(1 - sb * sb);
            const hw = (R - r) * TAU / n * sb / 2 * geo.clamp(0.55 + p.width * 0.95, 0.3, 0.96);
            for (let j = 0; j < n; j++) {
                const ca = Math.cos(TAU * j / n), sa = Math.sin(TAU * j / n);
                const at = t => { const u = TAU * t, x = R * Math.cos(u) * cb, y = r + R * Math.sin(u); return [x * ca - y * sa, x * sa + y * ca, R * Math.cos(u) * sb]; };
                add(at, t => { const q = at(t), l = Math.hypot(q[0], q[1]); return [q[0] * (1 - R / l), q[1] * (1 - R / l), q[2]]; },
                    hw, 0, [], t => (R + r * Math.sin(TAU * t)) / (R - r));
            }
            pre = rot(0, -0.85);
        } else if (p.form === 'rosette') {
            add(t => { const u = TAU * t, r = 1 + 0.12 * Math.cos(5 * u); return [r * Math.cos(u), r * Math.sin(u), 0.3 * Math.sin(3 * u)]; }, () => [0, 0, 1], p.width * 0.45);
            pre = rot(0, -0.8);
        } else if (p.form === 'coil') {
            add(torusKnot(1, p.coils, 2, 0.72), torusNormal(1, p.coils), Math.min(p.width * 0.5, 2.2 / p.coils));
            pre = rot(0, -0.9);
        } else {
            add(t => { const u = TAU * t, s = Math.sin(u), c = Math.cos(u); return [1.6 * c, 1.15 * s * c, 0.34 * s]; }, () => [0, 0, 1], p.width * 0.45);
            long = 'x';
        }
        return { strands, pre, long };
    }

    function frames(st, M) {
        const C = [], T = [], R = [];
        for (let i = 0; i < M; i++) C.push(st.at(i / M));
        C.push(C[0]);
        for (let i = 0; i <= M; i++) T.push(unit(sub(C[(i + 1) % M], C[(i + M - 1) % M])));
        if (st.ref) {
            for (let i = 0; i <= M; i++) { const r = st.ref(i / M), t = T[i]; R.push(unit(mad(r, t, -dot(r, t)))); }
            return { C, T, R };
        }
        // double reflection, then spread the holonomy evenly so the frame closes
        let r = unit(cross(T[0], Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
        R.push(r);
        for (let i = 0; i < M; i++) {
            const v1 = sub(C[i + 1], C[i]), c1 = dot(v1, v1) || 1e-12;
            const rL = mad(r, v1, -2 * dot(v1, r) / c1), tL = mad(T[i], v1, -2 * dot(v1, T[i]) / c1);
            const v2 = sub(T[i + 1], tL), c2 = dot(v2, v2);
            r = c2 > 1e-14 ? mad(rL, v2, -2 * dot(v2, rL) / c2) : rL;
            R.push(r);
        }
        const hol = Math.atan2(dot(cross(R[0], R[M]), T[0]), dot(R[0], R[M]));
        for (let i = 0; i <= M; i++) {
            const a = -hol * i / M, t = T[i], q = R[i];
            R[i] = unit(mad(q.map(x => x * Math.cos(a)), cross(t, q), Math.sin(a)));
        }
        return { C, T, R };
    }

    PG.register({
        id: 'ribbons', name: 'Ribbon Sculpture', category: 'Curves', fit: false,
        description: 'Linked chains, Möbius bands, knots and a torus of interlocking rings, sculpted from ribbons of fine chevron ribs. The side of the band facing you picks the pen, so every twist and fold shows.',
        params: [
            { type: 'section', label: 'Sculpture' },
            { id: 'form', label: 'Form', type: 'select', value: 'chain', random: true,
              options: [['chain', 'Linked chain'], ['mobius', 'Möbius band'], ['knot', 'Torus knot'], ['eight', 'Figure-eight knot'],
                  ['borromean', 'Borromean rings'], ['hopf', 'Linked ring torus'], ['coil', 'Coiled ring'], ['infinity', 'Infinity loop'], ['rosette', 'Wavy ring']] },
            { id: 'loops', label: 'Links', type: 'range', min: 2, max: 5, step: 1, value: 3, random: [2, 4], show: p => p.form === 'chain' },
            { id: 'separation', label: 'Link spacing', type: 'range', min: 1.1, max: 1.8, step: 0.05, value: 1.45, random: [1.3, 1.6], show: p => p.form === 'chain',
              hint: 'Distance between links. It tightens on its own if the bands would pass through each other.' },
            { id: 'knot', label: 'Knot', type: 'select', value: '2,3', random: true, show: p => p.form === 'knot',
              options: [['2,3', 'Trefoil'], ['2,5', 'Cinquefoil'], ['3,4', '(3, 4) knot'], ['3,5', '(3, 5) knot'], ['2,7', '(2, 7) knot']] },
            { id: 'rings', label: 'Rings', type: 'range', min: 4, max: 16, step: 1, value: 9, random: [6, 12], show: p => p.form === 'hopf' },
            { id: 'coils', label: 'Coils', type: 'range', min: 5, max: 24, step: 1, value: 11, random: [7, 16], show: p => p.form === 'coil' },
            { id: 'width', label: 'Ribbon width', type: 'range', min: 0.1, max: 0.7, step: 0.01, value: 0.42, random: [0.25, 0.55] },
            { id: 'twists', label: 'Half twists', type: 'range', min: 0, max: 6, step: 1, value: 2, random: [0, 3], show: p => p.form !== 'hopf',
              hint: 'Per loop. Möbius bands always get an odd number.' },
            { id: 'folds', label: 'Fold sharpness', type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, random: [0, 0.9],
              hint: 'Gathers the twists into sharp folds instead of spreading them evenly' },
            { id: 'lean', label: 'Band angle (°)', type: 'range', min: -90, max: 90, step: 5, value: 0, random: [-40, 40],
              hint: 'Turns the band about its centre line' },
            { id: 'swell', label: 'Width swell', type: 'range', min: 0, max: 0.8, step: 0.05, value: 0, random: [0, 0.5] },
            { id: 'waves', label: 'Swells per loop', type: 'range', min: 1, max: 8, step: 1, value: 3, random: [1, 5], show: p => p.swell > 0 },
            { type: 'section', label: 'Ribs' },
            { id: 'pattern', label: 'Pattern', type: 'select', value: 'chevron', random: true,
              options: [['chevron', 'Chevron'], ['straight', 'Straight'], ['twill', 'Diagonal twill'], ['wave', 'Wave'],
                  ['ogee', 'Swaying chevrons'], ['stripes', 'Grouped stripes'], ['lattice', 'Lattice']] },
            { id: 'gap', label: 'Rib spacing (mm)', type: 'range', min: 0.6, max: 3, step: 0.05, value: 0.9, random: [0.8, 1.3] },
            { id: 'slant', label: 'Slant', type: 'range', min: 0.1, max: 2, step: 0.05, value: 0.9, random: [0.4, 1.4], show: p => SLANT.includes(p.pattern) },
            { id: 'group', label: 'Group size', type: 'range', min: 2, max: 16, step: 1, value: 6, random: [3, 10], show: p => p.pattern === 'stripes' },
            { id: 'back', label: 'Back side', type: 'select', value: 'cross', random: ['cross', 'same', 'sparse'],
              options: [['same', 'Same ribs'], ['cross', 'Cross-ribbed'], ['sparse', 'Half the ribs'], ['bare', 'Outline only']] },
            { id: 'edges', label: 'Edges', type: 'select', value: 'solid', random: true,
              options: [['solid', 'Solid outline'], ['stitch', 'Stitched'], ['open', 'Open']],
              hint: 'Solid draws crisp edges and fold lines. Stitched joins the ribs into one zigzag stroke along the band, with far fewer pen lifts and a sawtooth edge.' },
            { id: 'rails', label: 'Lengthwise threads', type: 'range', min: 0, max: 8, step: 1, value: 0, random: [0, 1] },
            { id: 'shadow', label: 'Shadow on the wall', type: 'range', min: 0, max: 1, step: 0.05, value: 0, random: false,
              hint: 'How far the hatched shadow falls from the sculpture onto a wall behind it. 0 turns it off.' },
            { type: 'section', label: 'View' },
            { id: 'tilt', label: 'Tilt (°)', type: 'range', min: -60, max: 60, step: 1, value: 18, random: [5, 35] },
            { id: 'turn', label: 'Turn (°)', type: 'range', min: -90, max: 90, step: 1, value: -8, random: [-30, 30] },
            { id: 'spin', label: 'Spin (°)', type: 'range', min: -180, max: 180, step: 1, value: 0, random: [-20, 20] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        // Curated combinations, so each form gets twists, widths and views that suit it
        randomize(rng) {
            const snap = (a, b, step) => PG.snap(rng.range(a, b), step, 0);
            const form = rng.weighted([[3, 'chain'], [2, 'mobius'], [2, 'knot'], [2, 'hopf'], [1, 'borromean'], [1, 'eight'], [1, 'coil'], [1, 'infinity'], [1, 'rosette']]);
            const q = {
                form, width: snap(0.3, 0.5, 0.01), twists: rng.int(0, 3), folds: snap(0.2, 0.8, 0.05), lean: rng.int(-5, 5) * 5,
                swell: rng.chance(0.2) ? snap(0.15, 0.45, 0.05) : 0, waves: rng.int(1, 4),
                pattern: rng.weighted([[4, 'chevron'], [2, 'straight'], [2, 'twill'], [2, 'ogee'], [1, 'wave'], [1, 'stripes'], [1, 'lattice']]),
                back: rng.weighted([[4, 'cross'], [3, 'same'], [1, 'sparse']]),
                edges: rng.weighted([[5, 'solid'], [2, 'stitch'], [1, 'open']]),
                gap: snap(0.8, 1.25, 0.05), slant: snap(0.5, 1.3, 0.05), group: rng.int(3, 8), rails: rng.chance(0.15) ? rng.int(1, 3) : 0,
                tilt: rng.int(8, 30), turn: rng.int(-20, 20), spin: rng.chance(0.6) ? 0 : rng.int(-15, 15),
                shadow: form !== 'chain' && rng.chance(0.25) ? snap(0.2, 0.4, 0.05) : 0,
            };
            if (form === 'chain') Object.assign(q, { loops: rng.int(2, 4), twists: rng.int(1, 3), separation: snap(1.35, 1.6, 0.05) });
            else if (form === 'mobius') Object.assign(q, { twists: rng.chance(0.75) ? 1 : 3, width: snap(0.4, 0.65, 0.01), folds: snap(0, 0.5, 0.05) });
            else if (form === 'knot') Object.assign(q, { knot: rng.pick(['2,3', '2,3', '2,5', '3,4', '3,5', '2,7']), twists: rng.int(0, 2) });
            else if (form === 'hopf') Object.assign(q, { rings: rng.int(6, 12), width: snap(0.38, 0.45, 0.01), lean: rng.int(-2, 2) * 5, tilt: rng.int(0, 25) });
            else if (form === 'borromean') Object.assign(q, { width: snap(0.25, 0.4, 0.01), tilt: 18 + rng.int(-6, 6), turn: -8 + rng.int(-6, 6), spin: 0 });
            else if (form === 'coil') Object.assign(q, { coils: rng.int(7, 14), twists: rng.int(0, 2) });
            return q;
        },
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx, pens = PG.pens.count(p.pens);
            const M = p.form === 'coil' ? Math.max(2400, p.coils * 180) : p.form === 'knot' ? 3200 : p.form === 'eight' ? 3000 : p.form === 'hopf' ? 1200 : 2000;
            const form = sculpture(p, M, rng);
            const bands = form.strands.map(st => {
                const { C, T, R } = frames(st, M), g = twist(M, st.k, st.centres, p.folds), lean = geo.rad(BASE[p.form] + p.lean), ph = rng.range(0, TAU), D = [];
                for (let i = 0; i <= M; i++) {
                    const th = lean + Math.PI * st.k * g[i], w = st.hw * (st.wf ? st.wf(i / M) : 1) * (1 + p.swell * Math.cos(TAU * p.waves * i / M + ph));
                    const s = cross(T[i], R[i]), c = Math.cos(th) * w, n = Math.sin(th) * w;
                    D.push([s[0] * c + R[i][0] * n, s[1] * c + R[i][1] * n, s[2] * c + R[i][2] * n]);
                }
                return { C, D, flip: st.k % 2 ? -1 : 1 };
            });

            // View and fit to the visible region
            let spin = geo.rad(p.spin);
            if ((form.long === 'y' && W > H * 1.05) || (form.long === 'x' && H > W * 1.05)) spin += Math.PI / 2;
            const V = mul(rot(2, spin), mul(rot(0, geo.rad(p.tilt)), mul(rot(1, geo.rad(p.turn)), form.pre)));
            const toCam = V[2];
            const region = ctx.shape.polygon(), rb = geo.bbox([region]);
            let hull = [], zMin = Infinity;
            for (const B of bands) for (let i = 0; i < M; i += 4) for (const s of [-1, 1]) {
                const q = apply(V, mad(B.C[i], B.D[i], s));
                hull.push([q[0], -q[1], q[2]]);
                zMin = Math.min(zMin, q[2]);
            }
            // The shadow falls on a wall facing the viewer a little behind the sculpture, sliding further
            // down and right the further each point is from the wall
            const hb = geo.bbox([hull]), sd = [0.55 * p.shadow, 0.8 * p.shadow], wall = zMin - 0.15 * Math.max(hb.w, hb.h);
            if (p.shadow > 0) hull = hull.concat(hull.map(([x, y, z]) => [x + (z - wall) * sd[0], y + (z - wall) * sd[1]]));
            hull = PG.iso.hull(hull.map(q => [q[0], q[1]]));
            const bb = geo.bbox([hull]);
            let K = Math.min(rb.w * 0.9 / bb.w, rb.h * 0.92 / bb.h);
            const cx = rb.minX + rb.w / 2, cy = rb.minY + rb.h / 2, mx = bb.minX + bb.w / 2, my = bb.minY + bb.h / 2;
            const margin = Math.min(rb.w, rb.h) * 0.03;
            for (let i = 0; i < 40 && hull.some(([x, y]) => ctx.shape.dist(cx + K * (x - mx), cy + K * (y - my)) < margin); i++) K *= 0.97;
            const ox = cx - K * mx, oy = cy + K * -my;
            const scr = P => { const q = apply(V, P); return [ox + K * q[0], oy - K * q[1], -K * q[2]]; };
            const vec = P => { const q = apply(V, P); return [K * q[0], -K * q[1], -K * q[2]]; };

            const pattern = p.pattern, slanted = SLANT.includes(pattern), slant = slanted ? p.slant : 1, back = p.back;
            const along = p.gap * (slanted ? Math.sqrt(1 + slant * slant) : 1), soft = Math.max(0.35, p.gap * 0.5), least = Math.min(0.25, p.gap * 0.3);
            // Rib arms as [across, along] multiples of the half width: the main ribs, then the second
            // family (the lattice's other diagonal, or the crossing ribs on the back)
            const chev = ['chevron', 'wave', 'ogee'].includes(pattern);
            const arms = [
                chev ? [[1, slant], [-1, slant]].concat(pattern === 'ogee' ? [[1, -slant], [-1, -slant]] : [])
                    : pattern === 'twill' || pattern === 'lattice' ? [[2, 2 * slant]] : [[2, 0]],
                chev ? [[1, -slant], [-1, -slant]] : pattern === 'twill' ? [[2, -2 * slant]] : pattern === 'lattice' ? [[2, -2 * slant], [2, 0]] : [[2, 1.8], [2, 0]],
            ];
            const G = p.group, period = pattern === 'stripes' ? G + Math.max(2, Math.round(G * 0.6)) : 1;

            // Screen geometry, the facing function (f0 + v f1 > 0 where side 0 faces the viewer), arc
            // length, and how many times sparser each rib family has to be on paper to keep `least` apart
            const S = new PG.iso.Scene({ project: (x, y, z) => [x, y, z] }, W, H);
            let ribTotal = 0;
            for (const B of bands) {
                const c = B.C.map(scr), e = B.D.map(vec), f0 = new Float64Array(M + 1), f1 = new Float64Array(M + 1);
                for (let i = 0; i <= M; i++) {
                    const a = i ? i - 1 : M - 1, b = i < M ? i + 1 : 1, fa = i ? 1 : B.flip, fb = i < M ? 1 : B.flip;
                    const dC = sub(B.C[b], B.C[a]), dD = sub(B.D[b].map(x => x * fb), B.D[a].map(x => x * fa));
                    f0[i] = dot(cross(dC, B.D[i]), toCam);
                    f1[i] = dot(cross(dD, B.D[i]), toCam);
                }
                // side 0 is whichever side shows most (a Möbius band just swaps colors at its seam)
                if (f0.reduce((a, b) => a + b, 0) < 0) for (let i = 0; i <= M; i++) { f0[i] = -f0[i]; f1[i] = -f1[i]; }
                // Slanted arms lie along the band where it turns edge-on and would pile up there, so
                // flatten them (alpha < 1) just enough to keep neighbours `soft` apart on paper
                const len = new Float64Array(M + 1), need = arms.map(() => [0, 1, 2].map(() => new Float64Array(M + 1))), alpha = new Float64Array(M + 1);
                for (let i = 0; i < M; i++) {
                    // ribs are spaced by whichever of the edges and centre line runs fastest, so a fan
                    // around a fold stays dense at its wide end
                    const dC = sub(B.C[i + 1], B.C[i]), dD = sub(B.D[i + 1], B.D[i]);
                    const l3 = K * Math.max(Math.hypot(...dC), Math.hypot(...mad(dC, dD, 1)), Math.hypot(...mad(dC, dD, -1))) || 1e-9;
                    const hw = Math.hypot(...e[i]) || 1e-9, ex = e[i][0], ey = e[i][1];
                    const t = [(c[i + 1][0] - c[i][0]) / l3, (c[i + 1][1] - c[i][1]) / l3];
                    const tv = [-1, 0, 1].map(v => [t[0] + v * (e[i + 1][0] - ex) / l3, t[1] + v * (e[i + 1][1] - ey) / l3]);
                    len[i + 1] = len[i] + l3;
                    let d = slant * hw;
                    for (const [tx, ty] of tv) for (const sg of [-1, 1]) {
                        const r = along * Math.abs(tx * ey - ty * ex) / soft, tt = tx * tx + ty * ty, et = sg * (ex * tx + ey * ty);
                        const disc = et * et - tt * (ex * ex + ey * ey - r * r);
                        d = Math.min(d, disc < 0 || tt < 1e-12 ? 0 : Math.max(0, (Math.sqrt(disc) - et) / tt));
                    }
                    alpha[i] = d / (slant * hw);
                    arms.forEach((set, n) => {
                        for (const [ac, al] of set) {
                            const R = [ac * ex + al * alpha[i] * hw * t[0], ac * ey + al * alpha[i] * hw * t[1]];
                            tv.forEach((T, k) => { need[n][k][i] = Math.max(need[n][k][i], spacing(T, R, least) / along); });
                        }
                    });
                }
                alpha[M] = alpha[0];
                // Spread the worst spots a little so rib ends don't flicker. Two families that stitch
                // along the same edges have to be cut in the same places, so they share the worst of both.
                if (p.edges === 'stitch' && back === 'cross' && (chev || pattern === 'stripes')) need[0] = need[1] = need[0].map((a, k) => a.map((x, i) => Math.max(x, need[1][k][i])));
                for (const a of new Set(need.flat())) {
                    const src = a.slice();
                    for (let i = 0; i < M; i++) for (let j = -3; j <= 3; j++) a[i] = Math.max(a[i], src[(i + j + M) % M]);
                    a[M] = a[0];
                }
                Object.assign(B, { c, e, f0, f1, len, need, alpha });
                ribTotal += len[M] / along;
            }
            const cap = Math.max(1, ribTotal / 9000);

            const m = bands.length, SHADOW = 2 * m * BANDS, dw = -K * wall, shade = [];
            bands.forEach((B, j) => {
                const { c, e, f0, f1, len, need, alpha, flip } = B;
                let N = Math.max(period * 2, Math.round(len[M] / (along * cap) / period) * period);
                if (period === 1 && (N % 2 === 0) !== (flip > 0)) N++;
                const step = len[M] / N;
                const X = u => {
                    const s = u * step;
                    let lo = 0, hi = M;
                    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (len[mid] <= s) lo = mid; else hi = mid; }
                    return lo + (s - len[lo]) / (len[lo + 1] - len[lo] || 1);
                };
                const wrap = (u, v) => { while (u >= N) { u -= N; v *= flip; } while (u < 0) { u += N; v *= flip; } return [X(u), v]; };
                const Xu = u => { const w = Math.floor(u / N); return X(u - w * N) + w * M; };
                const lerp = (a, u) => { const x = X(((u % N) + N) % N), i = Math.min(M - 1, Math.floor(x)); return a[i] + (a[i + 1] - a[i]) * (x - i); };
                const hw = Float64Array.from(e, v => Math.hypot(...v)), ph = rng.random();
                // Slant offset of each rib in rib units for a full half width. It may only change a little
                // from one rib to the next, so the tips of neighbouring ribs never cross.
                const dr = Float64Array.from({ length: N }, (_, r) => slant * lerp(hw, r + ph) * lerp(alpha, r + ph) / step);
                for (let pass = 0; pass < 2; pass++) for (let r = 0; r < 2 * N; r++) {
                    const a = r % N, b = (r + 1) % N, c2 = (N - 1 - a + N) % N, d2 = (N - 1 - b + N) % N;
                    dr[b] = Math.min(dr[b], dr[a] + 0.4);
                    dr[d2] = Math.min(dr[d2], dr[c2] + 0.4);
                }
                // ogee tips sway forward and back, slowly enough that neighbouring tips never cross
                const sway = N / Math.max(1, Math.floor(N / (TAU * 2.2 * Math.max(...dr)))) / TAU;
                const at = (x, v) => {
                    const i = Math.min(M - 1, Math.floor(x)), t = x - i, a = c[i], b = c[i + 1], ea = e[i], eb = e[i + 1];
                    const px = a[0] + (b[0] - a[0]) * t + v * (ea[0] + (eb[0] - ea[0]) * t);
                    const py = a[1] + (b[1] - a[1]) * t + v * (ea[1] + (eb[1] - ea[1]) * t);
                    const pz = a[2] + (b[2] - a[2]) * t + v * (ea[2] + (eb[2] - ea[2]) * t);
                    return [px, py, pz, f0[i] + (f0[i + 1] - f0[i]) * t + v * (f1[i] + (f1[i + 1] - f1[i]) * t), x];
                };
                const bandOf = x => Math.min(BANDS - 1, Math.floor(BANDS * x / M));
                const kindOf = (side, x) => (side * m + j) * BANDS + bandOf(x);
                // How much sparser family n has to be at (x, v) to keep its lines apart on paper
                const crowd = (n, x, v) => {
                    const i = Math.min(M - 1, Math.floor(x)), t = x - i, g = k => need[n][k][i] + (need[n][k][i + 1] - need[n][k][i]) * t;
                    return v < 0 ? g(0) * -v + g(1) * (1 + v) : g(1) * (1 - v) + g(2) * v;
                };
                // (u, v, cap) polyline to screen runs, split where the band turns over. Parts where the lines
                // crowd past their cap are left out. only = 0 or 1 keeps one side.
                const emit = (uv, only, n = 0) => {
                    let run = [], last = null;
                    const put = (u, v, cap) => {
                        const [x, w] = wrap(u, v), q = at(x, w), k = crowd(n, x, w) - cap;
                        if (last && (last.k <= 0) !== (k <= 0)) {
                            const t = last.k / (last.k - k), mid = q.map((a, i) => last.q[i] + (a - last.q[i]) * t);
                            if (k > 0) { run.push(mid); if (run.length > 1) line(run, only); run = []; } else run = [mid];
                        }
                        if (k <= 0 && !(run.length && run[run.length - 1][4] === q[4] && run[run.length - 1][0] === q[0])) run.push(q);
                        last = { q, k };
                    };
                    for (let i = 1; i < uv.length; i++) {
                        const [u0, v0, c0 = 1e9] = uv[i - 1], [u, v, c1 = 1e9] = uv[i], cap = Math.min(c0, c1);
                        const steps = Math.min(64, Math.ceil(Math.max(Math.abs(Xu(u) - Xu(u0)), Math.abs(v - v0) * 4)));
                        for (let s = 0; s <= steps; s++) put(u0 + (u - u0) * s / steps, v0 + (v - v0) * s / steps, cap);
                    }
                    if (run.length > 1) line(run, only);
                };
                const line = (q, only, side0) => {
                    let run = [], kind = -1;
                    const flush = () => { if (run.length > 1) { S.kind = kind; S.line(run); } run = []; };
                    for (let n = 1; n < q.length; n++) {
                        let a = q[n - 1];
                        const b = q[n];
                        if (side0 === undefined && a[3] * b[3] < 0) {
                            const t = a[3] / (a[3] - b[3]), mid = [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);
                            mid.push(0, a[4]);
                            seg(a, mid, a[3] >= 0 ? 0 : 1);
                            a = mid;
                        }
                        seg(a, b, side0 !== undefined ? side0 : a[3] + b[3] >= 0 ? 0 : 1);
                    }
                    flush();
                    function seg(a, b, side) {
                        if (only !== undefined && side !== only) { flush(); kind = -1; return; }
                        const k = kindOf(side, a[4]);
                        if (k !== kind) { flush(); kind = k; run.push([a[0], a[1], a[2] - BIAS]); }
                        run.push([b[0], b[1], b[2] - BIAS]);
                    }
                };

                // Faces for hiding, rows about every 1.6 mm along the band
                const across = 8;
                let acc = 0;
                const row = i => Array.from({ length: across + 1 }, (_, n) => { const v = -1 + 2 * n / across; return [c[i][0] + v * e[i][0], c[i][1] + v * e[i][1], c[i][2] + v * e[i][2]]; });
                let ra = row(0);
                for (let i = 1; i <= M; i++) {
                    acc += Math.max(Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1], c[i][2] - c[i - 1][2]),
                        Math.hypot(c[i][0] + e[i][0] - c[i - 1][0] - e[i - 1][0], c[i][1] + e[i][1] - c[i - 1][1] - e[i - 1][1], c[i][2] + e[i][2] - c[i - 1][2] - e[i - 1][2]),
                        Math.hypot(c[i][0] - e[i][0] - c[i - 1][0] + e[i - 1][0], c[i][1] - e[i][1] - c[i - 1][1] + e[i - 1][1], c[i][2] - e[i][2] - c[i - 1][2] + e[i - 1][2]));
                    if (acc < 1.6 && i < M) continue;
                    const rb2 = row(i);
                    for (let n = 0; n < across; n++) {
                        S.face([ra[n], rb2[n], rb2[n + 1]], false);
                        S.face([ra[n], rb2[n + 1], ra[n + 1]], false);
                        if (p.shadow > 0) shade.push([ra[n], rb2[n], rb2[n + 1], ra[n + 1]].map(([x, y, z]) => [x + (dw - z) * sd[0], y + (dw - z) * sd[1]]));
                    }
                    ra = rb2; acc = 0;
                }

                // Ribs in rib units: rib r sits at u = r + ph and runs from v = -1 to v = 1. Where they crowd, rib r
                // only goes on while that part needs no more than every (2 ^ trailing zeros of r)th rib, so ribs
                // end one generation at a time into a fold instead of dropping out whole.
                const capOf = r => { let c = 1; while (c < 1024 && r % (c * 2) === 0) c *= 2; return c; };
                const rib = (r, dir = 1) => {
                    const u = r + ph, d = dr[r] * dir, c = capOf(r);
                    if (pattern === 'straight' || pattern === 'stripes') return [[u, -1, c], [u, 1, c]];
                    if (pattern === 'twill' || pattern === 'lattice') return [[u - d, -1, c], [u + d, 1, c]];
                    if (pattern === 'wave') return Array.from({ length: 9 }, (_, n) => { const v = -1 + n / 4; return [u + d * 0.8 * Math.sin(Math.PI * v), v, c]; });
                    if (pattern === 'ogee') return [[u, -1, c], [u + d * Math.cos(r / sway), 0, c], [u, 1, c]];
                    return [[u, -1, c], [u + d, 0, c], [u, 1, c]];
                };
                // the lattice's other diagonal, or the crossing ribs on the back
                const second = r => {
                    if (pattern === 'stripes') return rib(r);
                    if (pattern === 'straight') { const u = r + ph + 0.5, d = dr[r] * 0.9, c = capOf(r); return [[u - d, -1, c], [u + d, 1, c]]; }
                    return rib(r, -1);
                };
                // a mirrored rib whose slant has flattened out would land on top of its main rib
                const flat = r => pattern !== 'stripes' && pattern !== 'straight' && Math.abs(dr[r] * (pattern === 'ogee' ? Math.cos(r / sway) : 1)) < 0.6;
                const skip = r => pattern === 'stripes' && r % period >= G;
                const sparse = r => back === 'sparse' && r % 2 === 1;
                const only = back === 'bare' ? 0 : undefined;
                // One zigzag stroke along the band, stepping along the edges between neighbouring ribs. With
                // odd = 0 or 1 each rib's direction follows its index, so two families that share rib ends
                // step along opposite halves of the edges and never draw the same bit twice.
                const stitch = (use, make, side, n, odd, gap = 1) => {
                    const runs = [];
                    let path = [], prev = -1, r0 = -1;
                    for (let r = 0; r < N; r++) {
                        if (!use(r)) continue;
                        const pts = make(r);
                        if (prev >= 0 && r - prev > gap) { runs.push(path); path = []; }
                        if (odd === undefined ? path.length && path[path.length - 1][1] > 0 : (r + odd) % 2) pts.reverse();
                        path.push(...pts);
                        if (r0 < 0) r0 = r;
                        prev = r;
                    }
                    if (path.length) runs.push(path);
                    const head = runs[0], tail = runs[runs.length - 1];
                    if (runs.length && N - prev + r0 <= gap && tail[tail.length - 1][1] === head[0][1] * flip) {
                        // carry on across the seam into the first run, or close the loop
                        const more = head.map(([u, v, c]) => [u + N, v * flip, c]);
                        if (runs.length > 1) { tail.push(...more); runs.shift(); } else tail.push(more[0]);
                    }
                    for (const q of runs) emit(q, side, n);
                };
                const shared = chev || pattern === 'stripes';
                if (p.edges === 'stitch') {
                    if (back === 'sparse') {
                        stitch(r => !skip(r) && r % 2 === 0, rib, only, 0, undefined, 2);
                        for (let r = 1; r < N; r += 2) if (!skip(r)) emit(rib(r), 0);
                    } else stitch(r => !skip(r), rib, only, 0, shared && back === 'cross' ? 0 : undefined);
                    // The steps between ribs only reach the edge where every rib does. Past that the edge
                    // is drawn as a line of its own, so the outline never frays.
                    const cut = back === 'sparse' ? 2 : 1;
                    for (const [k, v] of [[0, -1], [2, 1]]) {
                        let run = [], was = null;
                        for (let i = 0; i <= M; i++) {
                            const q = at(i, v), d = need[0][k][i] - cut;
                            if (was && (was.d > 0) !== (d > 0)) {
                                const t = was.d / (was.d - d), mid = q.map((a, n) => was.q[n] + (a - was.q[n]) * t);
                                run.push(mid);
                                if (d <= 0) { if (run.length > 1) line(run, only); run = []; }
                            }
                            if (d > 0) run.push(q);
                            was = { q, d };
                        }
                        if (run.length > 1) line(run, only);
                    }
                } else {
                    for (let r = 0; r < N; r++) if (!skip(r)) emit(rib(r), sparse(r) ? 0 : only);
                }
                // the lattice's other diagonal goes everywhere, the crossing ribs only where the back shows
                if (pattern === 'lattice') for (let r = 0; r < N; r++) emit(second(r), only, 1);
                if (back === 'cross') {
                    const use = r => (pattern === 'stripes' ? skip(r) : !skip(r)) && !flat(r);
                    if (p.edges === 'stitch' && shared) stitch(use, second, 1, 1, 1);
                    else for (let r = 0; r < N; r++) if (use(r)) emit(pattern === 'lattice' ? [[r + ph + 0.5, -1, capOf(r)], [r + ph + 0.5, 1, capOf(r)]] : second(r), 1, 1);
                }

                // Edges, folds and lengthwise threads follow the dense samples
                const along3 = v => Array.from({ length: M + 1 }, (_, i) => at(i, v));
                const outline = p.edges === 'solid', bare = back === 'bare';
                if (outline || bare) for (const v of [-1, 1]) line(along3(v), outline ? undefined : 1);
                if (outline || bare || p.edges === 'stitch') {
                    let run = [];
                    for (let i = 0; i <= M; i++) {
                        const v = Math.abs(f1[i]) > 1e-12 ? -f0[i] / f1[i] : 2;
                        // where the fold hugs an edge on paper the edge already draws it
                        if (Math.abs(v) < 1 && Math.hypot(e[i][0], e[i][1]) * (1 - Math.abs(v)) > 0.25) { run.push(at(i, v)); continue; }
                        if (run.length > 1) line(run, undefined, 0);
                        run = [];
                    }
                    if (run.length > 1) line(run, undefined, 0);
                }
                for (let n = 1; n <= p.rails; n++) line(along3(-1 + 2 * n / (p.rails + 1)));
            });

            // Hatch the shadow as one merged region so overlapping facets never draw a line twice
            if (shade.length) {
                const gapH = Math.max(1.2, p.gap * 2.4), ca = Math.cos(0.12), sa = Math.sin(0.12), rows = new Map();
                for (const quad of shade) {
                    const q = quad.map(([x, y]) => [x * ca + y * sa, y * ca - x * sa]);
                    let w0 = Infinity, w1 = -Infinity;
                    for (const [, w] of q) { w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
                    for (let jj = Math.ceil(w0 / gapH); jj * gapH <= w1; jj++) {
                        const w = jj * gapH;
                        let lo = Infinity, hi = -Infinity;
                        for (let n = 0; n < 4; n++) {
                            const a = q[n], b = q[(n + 1) % 4];
                            if ((a[1] > w) === (b[1] > w)) continue;
                            const u = a[0] + (w - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                            lo = Math.min(lo, u); hi = Math.max(hi, u);
                        }
                        if (hi > lo) (rows.get(jj) || rows.set(jj, []).get(jj)).push([lo, hi]);
                    }
                }
                S.kind = SHADOW;
                for (const [jj, iv] of rows) {
                    const w = jj * gapH, back = u => [u * ca - w * sa, u * sa + w * ca, dw];
                    iv.sort((a, b) => a[0] - b[0]);
                    let run = null;
                    for (const r of iv.concat([[Infinity, Infinity]])) {
                        if (run && r[0] <= run[1] + 0.05) { run[1] = Math.max(run[1], r[1]); continue; }
                        if (run && run[1] - run[0] > 0.2) S.line([back(run[0]), back(run[1])]);
                        run = r.slice();
                    }
                }
            }

            // Pens alternate between the two sides, and from three pens up the shadow gets the third. Each
            // side's pens take whole strands, or runs along a strand when there are more pens than strands,
            // balanced by the ink actually visible.
            const out = PG.iso.render(S), ink = new Float64Array(SHADOW + 1), penOf = new Int32Array(SHADOW + 1);
            out.forEach((paths, kind) => { if (paths) for (const q of paths) ink[kind] += geo.pathLength(q); });
            const slots = Array.from({ length: pens }, (_, i) => i).filter(i => !(shade.length && pens > 2 && i === 2));
            penOf[SHADOW] = pens > 2 ? 2 : 0;
            if (pens > 1) for (const side of [0, 1]) {
                const K = side ? slots.length >> 1 : (slots.length + 1) >> 1, at = (j, b) => (side * m + j) * BANDS + b;
                const strandInk = Array.from({ length: m }, (_, j) => { let t = 0; for (let b = 0; b < BANDS; b++) t += ink[at(j, b)]; return t; });
                const set = (j, b, q) => { penOf[at(j, b)] = slots[2 * q + side]; };
                if (K <= m) split(strandInk, K).forEach((q, j) => { for (let b = 0; b < BANDS; b++) set(j, b, q); });
                else {
                    const n = strandInk.map(t => (t > 0 ? 1 : 0)), room = Array.from({ length: m }, (_, j) => { let c = 0; for (let b = 0; b < BANDS; b++) c += ink[at(j, b)] > 0; return c; });
                    for (let extra = K - n.reduce((a, b) => a + b, 0); extra > 0; extra--) {
                        let best = -1;
                        for (let j = 0; j < m; j++) if (n[j] < room[j] && (best < 0 || strandInk[j] / (n[j] + 1) > strandInk[best] / (n[best] + 1))) best = j;
                        if (best < 0) break;
                        n[best]++;
                    }
                    let q0 = 0;
                    for (let j = 0; j < m; j++) {
                        const bands = Array.from({ length: BANDS }, (_, b) => ink[at(j, b)]);
                        split(bands, Math.max(1, n[j])).forEach((q, b) => set(j, b, Math.min(K - 1, q0 + q)));
                        q0 += n[j];
                    }
                }
            }
            const layers = Array.from({ length: pens }, () => []);
            out.forEach((paths, kind) => { if (paths) for (const q of paths) layers[penOf[kind]].push(q); });
            return { layers };
        },
    });
})();
