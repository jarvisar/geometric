/*
 * Sampler: a different design for every seed, with random settings or its defaults. In a grid
 * with a new seed per cell, or drawn in the shapes of another layer with a new seed per shape,
 * every cell gets a design of its own, which makes a sampler sheet. Only designs that generate
 * quickly take part, so a sheet of a few hundred cells stays quick.
 */
(function () {
    'use strict';
    const { geo } = PG;
    const GROUPS = ['Curves', 'Fields', 'Tiles', 'Packing'];
    // Slow to generate, need a photo, or need more room than a cell gives them
    const LEFT_OUT = ['ribbons', 'blackhole', 'tidal', 'image', 'sampler'];

    PG.register({
        id: 'sampler',
        name: 'Sampler',
        category: 'Mixed',
        description: 'A different design for every seed, with random settings. In a grid or in the shapes of another layer it makes a sampler sheet.',
        fit: false,
        params: [
            { type: 'section', label: 'Designs' },
            { id: 'from', label: 'Designs from', type: 'select', value: 'all', random: false,
                options: [['all', 'Curves, fields, tiles, and packings'], ['Curves', 'Curves'], ['Fields', 'Fields'], ['Tiles', 'Tiles'], ['Packing', 'Packing']] },
            { id: 'settings', label: 'Settings', type: 'select', value: 'random', random: false,
                options: [['random', 'Random'], ['defaults', 'Defaults']],
                hint: 'Random settings are the ones Randomize would pick for each design.' },
            { type: 'section', label: 'Pens' },
            // Not a pen profile in pens.js: each design drawn maps its own colors to these pens
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: PG.MAX_PENS, step: 1, value: 3, random: false,
                hint: 'Each design gets this many pens, in its own colors.' },
        ],

        generate(p, ctx) {
            const pool = PG.generators.filter(d => GROUPS.includes(d.category) && !LEFT_OUT.includes(d.id) && (p.from === 'all' || d.category === p.from));
            if (!pool.length) return [];
            // Some settings need more room than a small cell has (a few Voronoi, Celtic Knot and
            // Subdivision ones draw nothing there), so another design gets a go
            let def, layers;
            for (let tries = 0; tries < 4; tries++) {
                def = pool[ctx.rng.int(0, pool.length - 1)];
                let params = PG.defaultParams(def);
                if (p.settings === 'random') params = PG.randomParams(def, params, ctx.rng);
                params.pens = PG.pens.count(p.pens);
                layers = PG.normalizeOutput(PG.pens.apply(def, def.generate(params, { ...ctx, wantRegions: false }), params));
                if (def.fit ? layers.some(l => l.paths.length) : layers.some(l => l.paths.some(path => path.some(q => ctx.shape.inside(q[0], q[1]))))) break;
            }
            if (!def.fit) return { layers };

            // A design that fits itself is centered and scaled into the area like the pipeline does:
            // a rectangle holds its box, any other shape the circle round it
            const all = layers.flatMap(l => l.paths), bb = geo.bbox(all);
            if (!(bb.w > 0 || bb.h > 0)) return { layers };
            const area = geo.bbox([ctx.shape.polygon()]);
            const cx = (area.minX + area.maxX) / 2, cy = (area.minY + area.maxY) / 2;
            const bx = (bb.minX + bb.maxX) / 2, by = (bb.minY + bb.maxY) / 2;
            let k;
            if (ctx.shape.kind === 'rect') k = Math.min(area.w / (bb.w || 1e-9), area.h / (bb.h || 1e-9));
            else {
                let R = 0;
                for (const path of all) for (const q of path) R = Math.max(R, (q[0] - bx) ** 2 + (q[1] - by) ** 2);
                k = Math.max(0.5, ctx.shape.dist(cx, cy)) / (Math.sqrt(R) || 1);
            }
            return { layers: layers.map(l => ({ pen: l.pen, paths: l.paths.map(path => path.map(q => [cx + (q[0] - bx) * k, cy + (q[1] - by) * k])) })) };
        },
    });
})();
