/* Ruled ribbon surfaces. The mesh hides the ribs behind other loops. */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    PG.register({
        id: 'ribbons', name: 'Ribbon Sculpture', category: 'Curves', fit: false,
        description: 'Interlocking ribbons and knotted bands, sculpted by hundreds of fine ribs with hidden lines removed.',
        params: [
            { type: 'section', label: 'Sculpture' },
            { id: 'form', label: 'Form', type: 'select', value: 'chain', random: ['chain', 'knot', 'rosette'], options: [['chain', 'Linked loops'], ['knot', 'Trefoil knot'], ['rosette', 'Folded rosette']] },
            { id: 'loops', label: 'Loops', type: 'range', min: 1, max: 5, step: 1, value: 3, random: [2, 4], show: p => p.form === 'chain' },
            { id: 'width', label: 'Ribbon width', type: 'range', min: 0.12, max: 0.65, step: 0.01, value: 0.38, random: [0.25, 0.48] },
            { id: 'twists', label: 'Half twists', type: 'range', min: 0, max: 6, step: 1, value: 2, random: [1, 3] },
            { id: 'separation', label: 'Loop spacing', type: 'range', min: 0.7, max: 1.7, step: 0.05, value: 1.25, random: [1.05, 1.45], show: p => p.form === 'chain' },
            { type: 'section', label: 'View & linework' },
            { id: 'tilt', label: 'Tilt (°)', type: 'range', min: -60, max: 60, step: 1, value: 24, random: [10, 40] },
            { id: 'turn', label: 'Turn (°)', type: 'range', min: -90, max: 90, step: 1, value: -12, random: [-25, 25] },
            { id: 'ribs', label: 'Ribs per loop', type: 'range', min: 60, max: 700, step: 10, value: 320, random: [230, 410] },
            { id: 'rails', label: 'Lengthwise threads', type: 'range', min: 0, max: 12, step: 1, value: 0, random: [0, 3] },
            { id: 'edge', label: 'Ribbon edges', type: 'checkbox', value: true },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx, count = p.form === 'chain' ? p.loops : 1;
            const phase = rng.range(0, TAU), bands = [], ribs = p.ribs, across = 6;
            const tilt = geo.rad(p.tilt), turn = geo.rad(p.turn);
            const rotate = ([x, y, z]) => {
                const yy = y * Math.cos(tilt) - z * Math.sin(tilt), zz = y * Math.sin(tilt) + z * Math.cos(tilt);
                return [x * Math.cos(turn) - yy * Math.sin(turn), x * Math.sin(turn) + yy * Math.cos(turn), zz];
            };
            for (let b = 0; b < count; b++) {
                const centre = t => {
                    if (p.form === 'knot') return [(2 + 0.7 * Math.cos(3 * t)) * Math.cos(2 * t), (2 + 0.7 * Math.cos(3 * t)) * Math.sin(2 * t), 0.9 * Math.sin(3 * t)];
                    if (p.form === 'rosette') { const r = 1 + 0.27 * Math.cos(5 * t); return [r * Math.cos(t), r * Math.sin(t), 0.45 * Math.sin(3 * t)]; }
                    const angle = b % 2 ? -0.58 : 0.58;
                    return [Math.cos(t) * Math.cos(angle), Math.sin(t) + (b - (count - 1) / 2) * p.separation, Math.cos(t) * Math.sin(angle)];
                };
                const row = t => {
                    const c = centre(t), a = centre(t - 0.0001), d = centre(t + 0.0001), tangent = unit(d.map((v, i) => v - a[i]));
                    const normal = unit(cross(tangent, [0, 0, 1])), binormal = cross(tangent, normal);
                    const spin = p.twists * t / 2 + phase + b * 0.8;
                    const n = normal.map((v, i) => v * Math.cos(spin) + binormal[i] * Math.sin(spin));
                    const width = p.width * (p.form === 'knot' ? 1.35 : 1);
                    return Array.from({ length: across + 1 }, (_, j) => rotate(c.map((v, i) => v + n[i] * width * (2 * j / across - 1))));
                };
                bands.push(Array.from({ length: ribs + 1 }, (_, i) => row(TAU * i / ribs)));
            }
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const band of bands) for (const row of band) for (const [x, y] of row) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
            const k = Math.min(W * 0.88 / (x1 - x0), H * 0.9 / (y1 - y0));
            const camera = { project: (x, y, z) => [W / 2 + k * (x - (x0 + x1) / 2), H / 2 - k * (y - (y0 + y1) / 2), -z * 30] };
            const S = new PG.iso.Scene(camera, W, H);
            for (let b = 0; b < bands.length; b++) {
                const band = bands[b];
                for (let i = 0; i < ribs; i++) {
                    for (let j = 0; j < across; j++) {
                        S.face([band[i][j], band[i + 1][j], band[i + 1][j + 1]], false);
                        S.face([band[i][j], band[i + 1][j + 1], band[i][j + 1]], false);
                    }
                    S.kind = PG.pens.band((i / ribs + b / count) % 1, p.pens);
                    S.line(band[i]);
                }
                const rails = [];
                if (p.edge) rails.push(0, 1);
                for (let j = 1; j <= p.rails; j++) rails.push(j / (p.rails + 1));
                for (const f of rails) {
                    for (let i = 0; i < ribs; i++) {
                        S.kind = PG.pens.band((i / ribs + b / count) % 1, p.pens);
                        const at = row => row[0].map((v, j) => geo.lerp(v, row[across][j], f));
                        S.line([at(band[i]), at(band[i + 1])]);
                    }
                }
            }
            return { layers: PG.iso.render(S) };
        },
    });
})();
