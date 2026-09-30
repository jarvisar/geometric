/* Nested architectural sections joined by perspective grid lines. */
(function () {
    'use strict';
    const { geo } = PG;
    PG.register({
        id: 'stairwell', name: 'Infinite Stairwell', category: 'Scenes', fit: false,
        description: 'A tiled shaft falling toward a distant vanishing point, with stepped walls and twisting architectural ribs.',
        params: [
            { type: 'section', label: 'Architecture' },
            { id: 'section', label: 'Section', type: 'select', value: 'steps', random: ['steps', 'square', 'octagon'], options: [['steps', 'Stepped well'], ['square', 'Square atrium'], ['octagon', 'Octagonal shaft']] },
            { id: 'levels', label: 'Depth levels', type: 'range', min: 15, max: 100, step: 1, value: 58, random: [40, 75] },
            { id: 'tiles', label: 'Tiles per wall', type: 'range', min: 4, max: 24, step: 1, value: 13, random: [9, 17] },
            { id: 'recede', label: 'Perspective strength', type: 'range', min: 0.84, max: 0.97, step: 0.005, value: 0.935, random: [0.915, 0.95] },
            { id: 'steps', label: 'Step depth', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.26, random: [0.16, 0.36], show: p => p.section === 'steps' },
            { type: 'section', label: 'View' },
            { id: 'twist', label: 'Twist per level (°)', type: 'range', min: -3, max: 3, step: 0.1, value: 0, random: [-0.8, 0.8] },
            { id: 'cx', label: 'Vanishing point X (%)', type: 'range', min: 25, max: 75, step: 1, value: 53, random: [43, 60] },
            { id: 'cy', label: 'Vanishing point Y (%)', type: 'range', min: 25, max: 75, step: 1, value: 47, random: [40, 57] },
            { id: 'shade', label: 'Shade the ledges', type: 'checkbox', value: true, random: 0.8 },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx, layers = PG.pens.layers(p.pens);
            const cx = W * p.cx / 100, cy = H * p.cy / 100, phase = rng.int(0, 3);
            const sideCount = p.section === 'octagon' ? 8 : 4, N = sideCount * p.tiles;
            const corners = p.section === 'octagon' ? geo.ngon(0, 0, 1.08, 8, Math.PI / 8) : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            const rings = [];
            for (let level = 0; level <= p.levels; level++) {
                const radius = Math.pow(p.recede, level), angle = geo.rad(p.twist * level);
                const ring = [];
                for (let j = 0; j < N; j++) {
                    const side = Math.floor(j / p.tiles), f = (j % p.tiles) / p.tiles;
                    const a = corners[side], b = corners[(side + 1) % sideCount];
                    let x = geo.lerp(a[0], b[0], f), y = geo.lerp(a[1], b[1], f);
                    if (p.section === 'steps') {
                        const step = Math.floor(f * 5), active = (side + phase) % 2 === 0;
                        const notch = active && step > 0 && step < 4 ? p.steps * (step === 2 ? 1 : 0.5) : 0;
                        if (side === 0) y += notch;
                        if (side === 1) x -= notch;
                        if (side === 2) y -= notch;
                        if (side === 3) x += notch;
                    }
                    const xx = x * Math.cos(angle) - y * Math.sin(angle), yy = x * Math.sin(angle) + y * Math.cos(angle);
                    ring.push([cx + (W * 0.49 * xx + W / 2 - cx) * radius, cy + (H * 0.49 * yy + H / 2 - cy) * radius]);
                }
                rings.push(ring);
            }
            const pen = (j, level) => PG.pens.band(((j / N) + 0.18 * level / p.levels) % 1, p.pens);
            for (let l = 0; l < p.levels; l++) for (let j = 0; j < N; j++) {
                const next = (j + 1) % N, a = rings[l][j], b = rings[l][next], c = rings[l + 1][next], d = rings[l + 1][j];
                layers[pen(j, l)].push([a, b], [a, d]);
                if (p.shade && l % 6 === 2 && Math.floor(j / p.tiles) % 2 === 0 && geo.dist(a, d) > 0.8) {
                    const count = Math.min(10, Math.floor(geo.dist(a, b) / 0.65));
                    for (let k = 1; k <= count; k++) layers[pen(j, l)].push([geo.lerpPt(a, b, k / (count + 1)), geo.lerpPt(d, c, k / (count + 1))]);
                }
            }
            const last = rings.at(-1);
            for (let j = 0; j < N; j++) layers[pen(j, p.levels)].push([last[j], last[(j + 1) % N]]);
            return { layers };
        },
    });
})();
