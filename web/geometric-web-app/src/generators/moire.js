/*
 * Moiré — two or three identical line sets overlaid with a small offset,
 * rotation or stretch. Where the sets fall in and out of step the eye sees
 * large, slow interference fringes: hyperbolae and ellipses for offset
 * circles, broad bands for rotated gratings, rosettes for spirals and rays.
 * Each set goes on its own pen; two colours make the fringes glow.
 *
 * "Wobble" displaces the later sets by a smooth noise field. Overlaying a
 * grating with a distorted copy of itself makes the moiré trace contour lines
 * of the displacement (the principle behind moiré strain measurement).
 * Rays start at staggered radii so their hub never becomes a blot of ink.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'moire',
        name: 'Moiré',
        category: 'Fields',
        description: 'Overlaid circles, gratings, spirals or rays whose interference draws giant fringes.',
        fit: false,
        params: [
            { type: 'section', label: 'Pattern' },
            { id: 'pattern', label: 'Pattern', type: 'select', value: 'circles', random: ['circles', 'circles', 'lines', 'spirals', 'rays'],
                options: [['circles', 'Concentric circles'], ['lines', 'Parallel lines'], ['spirals', 'Archimedean spirals'], ['rays', 'Radial rays']] },
            { id: 'spacing', label: 'Spacing (mm)', type: 'range', min: 1, max: 10, step: 0.05, value: 2.6, random: [2.6, 4.2],
                hint: 'Rays: gap at a quarter of the page width from the hub' },
            { id: 'sets', label: 'Sets', type: 'range', min: 2, max: 3, step: 1, value: 2 },
            { id: 'offset', label: 'Offset (mm)', type: 'range', min: 0, max: 150, step: 0.5, value: 12, random: [6, 30],
                hint: 'Distance between the set centres', show: p => p.pattern !== 'lines' },
            { id: 'direction', label: 'Offset direction°', type: 'range', min: 0, max: 180, step: 1, value: 90,
                show: p => p.pattern !== 'lines' },
            { id: 'rotation', label: 'Rotation between sets°', type: 'range', min: -30, max: 30, step: 0.1, value: 4, random: [-8, 8],
                show: p => p.pattern !== 'circles' },
            { id: 'stretch', label: 'Spacing change (%)', type: 'range', min: -10, max: 10, step: 0.1, value: 0, random: false,
                hint: 'Each set is this much finer or coarser than the previous one' },
            { id: 'mirror', label: 'Alternate handedness', type: 'checkbox', value: false, random: 0.5,
                show: p => p.pattern === 'spirals' },
            { type: 'section', label: 'Wobble' },
            { id: 'wobble', label: 'Wobble (mm)', type: 'range', min: 0, max: 15, step: 0.1, value: 0, random: false,
                hint: 'Displace the later sets by a smooth noise field' },
            { id: 'wobbleScale', label: 'Wobble size (mm)', type: 'range', min: 20, max: 400, step: 1, value: 120,
                show: p => p.wobble > 0 },
            { type: 'section', label: 'Pens' },
            { id: 'separate', label: 'Each set on its own pen', type: 'checkbox', value: true, random: false },
        ],

        randomize(rng, p) {
            const out = { wobble: 0, stretch: 0, wobbleScale: rng.int(150, 300) };
            const three = p.sets === 3;
            // gentle wobble: lines stay nearly straight but shift by a few spacings
            const wobble = () => +rng.range(1.5, 4.5).toFixed(1);
            if (p.pattern === 'lines') {
                // fringe spacing = spacing / (2 sin(rotation / 2))
                if (rng.chance(0.6)) out.wobble = wobble();
                out.rotation = +(rng.sign() * (out.wobble ? rng.range(0.8, 3) : rng.range(2.5, 6))).toFixed(1);
            } else if (p.pattern === 'rays') {
                out.rotation = rng.chance(0.6) ? 0 : +rng.range(-2, 2).toFixed(1);
                out.offset = +rng.range(8, three ? 20 : 30).toFixed(1);
            } else if (p.pattern === 'spirals') {
                out.rotation = +rng.range(-30, 30).toFixed(1);
                out.offset = rng.chance(0.3) ? 0 : +rng.range(4, 20).toFixed(1);
                if (out.offset < 3) out.mirror = true; // co-centred, same-handed spirals don't interfere
            } else {
                out.offset = +rng.range(5, three ? 14 : 22).toFixed(1);
                if (rng.chance(0.3)) out.stretch = +(rng.sign() * rng.range(1, 3)).toFixed(1);
                if (rng.chance(0.2)) out.wobble = wobble();
            }
            if (three) out.spacing = +rng.range(3.2, 4.5).toFixed(2); // three sets need more air
            return out;
        },

        generate(p, ctx) {
            const { width: W, height: H, noise } = ctx;
            const sets = Math.round(p.sets);
            const cx = W / 2, cy = H / 2;
            const dirA = geo.rad(p.direction);
            const rotStep = geo.rad(p.rotation);

            // Centres on a circle of radius offset/2 (2 sets: `offset` apart).
            const centres = [];
            for (let k = 0; k < sets; k++) {
                const a = dirA + (TAU * k) / sets;
                const r = sets === 2 ? p.offset / 2 : p.offset / Math.sqrt(3);
                centres.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
            // Radius that reaches every corner of the area from a centre.
            const reach = c => Math.max(
                Math.hypot(c[0], c[1]), Math.hypot(W - c[0], c[1]),
                Math.hypot(c[0], H - c[1]), Math.hypot(W - c[0], H - c[1])) + 1;

            const layers = [], flat = [];
            for (let k = 0; k < sets; k++) {
                const sp = Math.max(0.5, p.spacing * Math.pow(1 + p.stretch / 100, k));
                const c = p.pattern === 'lines' ? [cx, cy] : centres[k];
                const R = reach(c);
                const rot = rotStep * k;
                let paths = [];

                if (p.pattern === 'circles') {
                    for (let r = sp; r <= R; r += sp) paths.push(geo.circle(c[0], c[1], r));
                } else if (p.pattern === 'lines') {
                    // grating through the centre, rotated about it, long enough to cover
                    const n = Math.ceil(R / sp);
                    const cs = Math.cos(rot), sn = Math.sin(rot);
                    for (let i = -n; i <= n; i++) {
                        const o = i * sp;
                        const a = [-R, o], b = [R, o];
                        const seg = i & 1 ? [b, a] : [a, b];
                        paths.push(seg.map(q => [c[0] + q[0] * cs - q[1] * sn, c[1] + q[0] * sn + q[1] * cs]));
                    }
                } else if (p.pattern === 'spirals') {
                    const hand = p.mirror && k % 2 ? -1 : 1;
                    const thMax = (TAU * R) / sp;
                    const pts = [];
                    let th = 0;
                    while (th <= thMax) {
                        const r = (sp * th) / TAU;
                        const a = hand * th + rot;
                        pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
                        // chord tolerance ~0.02 mm
                        th += Math.min(0.25, 2 * Math.sqrt(0.04 / Math.max(r, 0.05)));
                    }
                    paths.push(pts);
                } else {
                    // rays: n spokes; spoke i starts where it and its surviving
                    // neighbours are far enough apart (by powers of two) that the
                    // overlapping hubs of all sets together stay below ~1 ink line/mm
                    const ref = Math.max(10, ctx.shape.dist(cx, cy) / 2);
                    const n = Math.max(8, Math.round((TAU * ref) / sp / 8) * 8);
                    const minGap = 0.75 * sets;
                    const L = Math.max(0, Math.floor(Math.log2(n)) - 2);
                    for (let i = 0; i < n; i++) {
                        let lvl = 0;
                        while (lvl < L && i % (2 << lvl) === 0) lvl++;
                        const r0 = (minGap * n) / (TAU * (1 << lvl));
                        const a = rot + (TAU * i) / n;
                        const u = [Math.cos(a), Math.sin(a)];
                        const seg = [[c[0] + u[0] * r0, c[1] + u[1] * r0], [c[0] + u[0] * R, c[1] + u[1] * R]];
                        paths.push(i & 1 ? seg.reverse() : seg);
                    }
                }

                // a set identical to an earlier one (no offset, rotation or stretch
                // between them, and no wobble) would only redraw the same lines
                if (!(p.wobble > 0) && flat.some(q => samePaths(q, paths))) continue;
                flat.push(paths);

                if (p.wobble > 0 && k > 0) {
                    const s = 1 / p.wobbleScale, amp = p.wobble, o = k * 57.3; // independent field per set
                    paths = paths.map(path => geo.resample(path, 1).map(q => [
                        q[0] + amp * noise.fbm2(q[0] * s + o, q[1] * s, 2),
                        q[1] + amp * noise.fbm2(q[0] * s + 31.7, q[1] * s - 12.9 + o, 2),
                    ]));
                }
                layers.push(paths);
            }
            return p.separate ? { layers } : [].concat(...layers);
        },
    });

    function samePaths(A, B) {
        if (A.length !== B.length) return false;
        for (let i = 0; i < A.length; i++) {
            const a = A[i], b = B[i];
            if (a.length !== b.length) return false;
            for (let j = 0; j < a.length; j++) {
                if (Math.abs(a[j][0] - b[j][0]) > 1e-6 || Math.abs(a[j][1] - b[j][1]) > 1e-6) return false;
            }
        }
        return true;
    }
})();
