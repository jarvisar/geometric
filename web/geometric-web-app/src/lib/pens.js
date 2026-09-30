/* Shared pen controls, palettes and assignments. Groups are zero-based ink slots. */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const P = PG.pens = {};
    PG.MAX_PENS = 8;
    P.sets = {
        fineliner: { label: 'Fineliners on white', paper: '#fbfaf6', colors: ['#161616', '#d1342f', '#2456c8', '#1d8a4e', '#d99a00', '#7b3fc0', '#2fa3d6', '#8b5a2b'] },
        gel: { label: 'Gel pens on black', paper: '#16181b', colors: ['#f4f1ea', '#e7c35a', '#aab7c1', '#f08bb0', '#7fcfe6', '#b5de7a', '#c8a6f2', '#f4a261'] },
        riso: { label: 'Riso brights', paper: '#f7f4ec', colors: ['#0078bf', '#ff48b0', '#ffb511', '#00a95c', '#ff665e', '#765ba7', '#00838a', '#925f52'] },
        sepia: { label: 'Sepia on cream', paper: '#f2e8d5', colors: ['#3a2a1c', '#8b4a2b', '#b8864e', '#556b2f', '#7a2e2e', '#2f4f6f', '#5f7f8f', '#9a7b4f'] },
        blueprint: { label: 'White on blueprint', paper: '#1d3f78', colors: ['#f2f6ff', '#9cc7ff', '#ffd66b', '#ff9f8a', '#b8f2d0', '#d5b8ff', '#7fe3ff', '#ffc48a'] },
    };

    const INK = 0, RED = 1, BLUE = 2, GREEN = 3, GOLD = 4, PURPLE = 5, CYAN = 6, BROWN = 7;
    const jewel = [BLUE, RED, PURPLE, GREEN, GOLD, CYAN, BROWN, INK];
    const cool = [BLUE, CYAN, PURPLE, GREEN, INK, RED, GOLD, BROWN];
    const earth = [GREEN, BROWN, GOLD, BLUE, RED, CYAN, PURPLE, INK];
    const botanical = [GREEN, GOLD, RED, PURPLE, BLUE, CYAN, BROWN, INK];
    // The order is also used in the pen legend. A single pen always uses slot 1.
    const profile = (value, hint, order = jewel, style) => ({ value, hint, order, style });
    P.designs = {
        spirograph: profile(3, 'Colors follow the curve through its loops and successive rings.', jewel, 'sequence'),
        mystery: profile(3, 'Echoes form color bands. A single echo changes color along the curve.', jewel, 'families'),
        harmonograph: profile(3, 'Color follows the pendulums as their motion decays.', cool),
        maurer: profile(3, 'Chord progress forms color bands, with a separate rose and overlay.', jewel, 'families'),
        superformula: profile(3, 'Nested shapes form color bands. A single shape changes color around its outline.', cool, 'families'),
        guilloche: profile(4, 'Bands and their interwoven threads share the pens.', jewel),
        timestable: profile(3, 'Colors follow the chord sequence, with the boundary on pen 1.'),
        flower: profile(4, 'Each petal family has its own color. The inner ring shifts the palette.', botanical),
        phyllotaxis: profile(4, 'Seed growth bands and Fibonacci spiral families share the pens.', botanical),
        attractor: profile(3, 'Colors reveal depth or progress along the orbit.', cool),
        ribbons: profile(2, 'The first two pens are the two sides of the ribbon, so every twist and fold shows. From three pens the wall shadow gets its own color, and more pens split each side by loop, then along the band.', [BLUE, GOLD, CYAN, RED, PURPLE, BROWN, GREEN, INK]),
        stairwell: profile(3, 'Black steps and walls, a blue handrail and balusters, and light blue shading. More pens split out the floor or skylight, the balusters, the string, the walls and every other turn.', [INK, BLUE, CYAN, GOLD, PURPLE, RED, BROWN, GREEN]),
        tidal: profile(3, 'Blue water and black land. More pens add the cut block, lowland and hill bands, red survey marks and a lighter sea surface.', [BLUE, INK, BROWN, GREEN, RED, CYAN, GOLD, PURPLE]),
        cosmic: profile(3, 'Dark outlines, a warm sun and sunsets, and cool skies and water. More pens split off sand, distant ranges, plants, crystals and rock.', [INK, RED, BLUE, GOLD, PURPLE, GREEN, CYAN, BROWN]),
        skyline: profile(3, 'Black architecture and shade, red signs and pipes, yellow pads, road markings and cranes. More pens separate glass, trees, traffic, cables and streets.'),
        flowfield: profile(4, 'Color follows flow direction, position or patches of noise.', cool),
        ridgelines: profile(4, 'Colors separate near and distant ridges.', cool),
        topo: profile(4, 'Elevation bands share the colors. Index contours stay on the first pen.', [INK, GREEN, BROWN, BLUE, GOLD, RED, PURPLE, CYAN]),
        chladni: profile(4, 'Nodal lines anchor the drawing. Colors distinguish vibration bands on either side.', [INK, BLUE, RED, CYAN, GOLD, PURPLE, GREEN, BROWN]),
        fieldlines: profile(4, 'Source fans and potential levels form color families.', [INK, BLUE, RED, CYAN, PURPLE, GOLD, GREEN, BROWN]),
        moire: profile(3, 'Each line family gets a palette, split into broad bands as more pens are added.', jewel, 'families'),
        warp: profile(4, 'Color bands follow the woven directions and warped stripes.', jewel, 'families'),
        truchet: profile(4, 'Connected curves keep one color. Triangle tiles form colored patches.', jewel),
        islamic: profile(4, 'Whole woven strands keep their color. Optional outlines and the second pattern share the selected pens.'),
        penrose: profile(4, 'Tile orientation and decoration family choose the color.', [INK, BLUE, RED, GOLD, GREEN, PURPLE, CYAN, BROWN]),
        hyperbolic: profile(4, 'Color bands radiate from the centre toward the disk edge.', cool),
        celtic: profile(4, 'Each continuous woven loop keeps one color.'),
        whirl: profile(4, 'Colors follow pursuit depth, including in a single cell.', cool),
        maze: profile(3, 'Walls form broad bands. The solution gets a separate color.', [BLUE, CYAN, PURPLE, GREEN, GOLD, BROWN, INK, RED], 'maze'),
        lsystem: profile(4, 'Colors follow branch depth, or progress along an unbranched curve.', earth),
        circlepack: profile(4, 'Circles are colored by size, fill style or a repeatable scatter.', botanical),
        apollonian: profile(4, 'Recursive generations or circle sizes choose the color.', jewel),
        subdivide: profile(4, 'Quilt patches use color to distinguish their fill tones.', earth),
        voronoi: profile(4, 'Neighboring cells form color regions, or colors follow fill style.', botanical),
        town: profile(4, 'Default palette: dark buildings, brown streets and fences, green plants, blue water. More pens separate cars, people and details.'),
        harbour: profile(4, 'Roofs, shadows and awnings use separate inks. More pens separate plants, figures, water and wood.'),
        fairground: profile(4, 'Rides, tents and shadows use separate inks. More pens separate plants, people, water and paths.'),
        trainyard: profile(5, 'Black trains and buildings, red roofs and paint, blue shadows, gold trim and brown track. More pens separate plants, people and steam.'),
        alpine: profile(4, 'Dark architecture, red roofs, blue shade and gold details. More pens separate fir woods, people, water and timber.'),
        image: profile(3, 'Colors follow image darkness in every drawing mode.', [BLUE, PURPLE, INK, RED, BROWN, GREEN, CYAN, GOLD]),
    };

    const illustrated = [
        [INK, INK, INK, INK, INK, INK, INK, INK],
        [INK, RED, INK, RED, INK, INK, INK, INK],
        [INK, RED, BLUE, RED, INK, INK, BLUE, INK],
        [INK, RED, BLUE, GOLD, INK, INK, BLUE, INK],
        [INK, RED, BLUE, GOLD, GREEN, INK, BLUE, INK],
        [INK, RED, BLUE, GOLD, GREEN, PURPLE, BLUE, INK],
        [INK, RED, BLUE, GOLD, GREEN, PURPLE, CYAN, INK],
        [INK, RED, BLUE, GOLD, GREEN, PURPLE, CYAN, BROWN],
    ];
    const scene = (maps, groups, roles) => ({ maps, groups, roles });
    P.scenes = {
        skyline: scene([
            [INK, INK, INK, INK, INK, INK, INK, INK, INK],
            [INK, RED, INK, RED, INK, INK, INK, INK, INK],
            [INK, RED, INK, GOLD, INK, INK, INK, INK, INK],
            [INK, RED, INK, GOLD, BLUE, INK, INK, INK, INK],
            [INK, RED, INK, GOLD, BLUE, INK, GREEN, INK, INK],
            [INK, RED, INK, GOLD, BLUE, INK, GREEN, PURPLE, INK],
            [INK, RED, INK, GOLD, BLUE, CYAN, GREEN, PURPLE, INK],
            [INK, RED, INK, GOLD, BLUE, CYAN, GREEN, PURPLE, BROWN],
        ], [0, 1, 2, 3, 4, 5, 6, 7, 8], ['Architecture', 'Signs & pipes', 'Shade & shadows', 'Pads, markings & cranes', 'Glass', 'Cables & masts', 'Trees', 'People & traffic', 'Streets & crossings']),
        town: scene([
            [INK, INK, INK, INK, INK, INK, INK, INK],
            [INK, BROWN, INK, INK, INK, INK, INK, BROWN],
            [INK, BROWN, GREEN, INK, INK, INK, INK, BROWN],
            [INK, BROWN, GREEN, BLUE, INK, INK, BLUE, BROWN],
            [INK, BROWN, GREEN, BLUE, RED, INK, BLUE, BROWN],
            [INK, BROWN, GREEN, BLUE, RED, PURPLE, BLUE, BROWN],
            [INK, BROWN, GREEN, BLUE, RED, PURPLE, BLUE, GOLD],
            [INK, BROWN, GREEN, BLUE, RED, PURPLE, CYAN, GOLD],
        ], [0, 1, 2, 3, 3, 3, 1, 3], ['Buildings', 'Streets', 'Plants', 'Details', 'Vehicles', 'People', 'Water', 'Fences & benches']),
        harbour: scene(illustrated, [0, 1, 2, 3, 0, 0, 2, 0], ['Structure', 'Roofs', 'Shadows', 'Awnings', 'Plants', 'Figures', 'Water', 'Wood']),
        fairground: scene(illustrated, [0, 1, 2, 3, 0, 0, 2, 0], ['Structure', 'Tents', 'Shadows', 'Rides & flags', 'Plants', 'People', 'Water', 'Paths']),
        // Track is most of the drawing, so it gets its own pen before plants and people do
        trainyard: scene([
            [INK, INK, INK, INK, INK, INK, INK, INK],
            [INK, RED, INK, RED, INK, INK, INK, INK],
            [INK, RED, BLUE, RED, INK, INK, BLUE, INK],
            [INK, RED, BLUE, GOLD, INK, INK, BLUE, INK],
            [INK, RED, BLUE, GOLD, INK, INK, BLUE, BROWN],
            [INK, RED, BLUE, GOLD, GREEN, INK, BLUE, BROWN],
            [INK, RED, BLUE, GOLD, GREEN, PURPLE, BLUE, BROWN],
            [INK, RED, BLUE, GOLD, GREEN, PURPLE, CYAN, BROWN],
        ], [0, 1, 2, 3, 4, 5, 6, 7], ['Structure & trains', 'Roofs & paint', 'Shadows', 'Signals & trim', 'Plants', 'People', 'Steam & water', 'Track']),
        alpine: scene(illustrated, [0, 1, 2, 3, 0, 0, 2, 0], ['Architecture & rock', 'Roofs & trains', 'Shade & snow', 'Shutters & balconies', 'Fir woods', 'People & fliers', 'Water', 'Timber & paths']),
    };

    P.count = n => Math.max(1, Math.min(PG.MAX_PENS, Math.round(Number(n)) || 1));
    P.layers = n => Array.from({ length: P.count(n) }, () => []);
    P.band = (t, n) => Math.max(0, Math.min(n - 1, Math.floor(t * n)));
    P.configure = def => {
        const config = P.designs[def.id];
        if (!config) return;
        const control = { id: 'pens', label: 'Pens', type: 'range', min: 1, max: PG.MAX_PENS, step: 1,
            value: config.value, random: false, hint: config.hint };
        let found = false;
        def.params = def.params.map(q => {
            if (q.id !== 'pens' && q.id !== 'inks') return q;
            found = true;
            return control;
        });
        if (!found) {
            if (def.params.at(-1)?.label !== 'Pens') def.params.push({ type: 'section', label: 'Pens' });
            def.params.push(control);
        }
    };
    P.migrate = (def, p) => {
        if (p.pens !== undefined) { p.pens = P.count(p.pens); return p; }
        if (p.inks !== undefined) p.pens = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 })[p.inks] || 4;
        else if (['penrose', 'hyperbolic'].includes(def.id) && p.split !== undefined) p.pens = p.split ? (def.id === 'penrose' ? 3 : 2) : 1;
        else if (def.id === 'moire' && p.separate !== undefined) p.pens = p.separate ? P.count(p.sets || 2) : 1;
        return p;
    };

    // Split at equal travelled distances, retaining the shared boundary point.
    P.sequence = (paths, n) => {
        const layers = P.layers(n);
        n = layers.length;
        if (n === 1) { layers[0] = paths; return { layers }; }
        const total = paths.reduce((sum, path) => sum + PG.geo.pathLength(path), 0);
        if (!total) return { layers };
        let walked = 0, pen = 0;
        for (const path of paths) {
            if (path.length < 2) continue;
            let run = [path[0]];
            for (let i = 1; i < path.length; i++) {
                let a = path[i - 1];
                const b = path[i];
                let length = PG.geo.dist(a, b);
                while (pen < n - 1 && walked + length >= total * (pen + 1) / n) {
                    const step = Math.max(0, total * (pen + 1) / n - walked);
                    const cut = PG.geo.lerpPt(a, b, length ? step / length : 0);
                    run.push(cut);
                    if (run.length > 1) layers[pen].push(run);
                    run = [cut]; a = cut; walked += step; length -= step; pen++;
                }
                run.push(b); walked += length;
            }
            if (run.length > 1) layers[pen].push(run);
        }
        return { layers };
    };
    P.bands = (paths, n) => {
        if (paths.length < n) return P.sequence(paths, n);
        return { layers: paths.reduce((layers, path, i) => {
            layers[P.band(i / paths.length, layers.length)].push(path); return layers;
        }, P.layers(n)) };
    };
    P.families = (groups, n) => {
        const layers = P.layers(n), active = groups.filter(paths => paths.length);
        active.forEach((paths, i) => {
            const start = active.length <= n ? Math.floor(i * n / active.length) : i % n;
            const count = active.length <= n ? Math.floor((i + 1) * n / active.length) - start : 1;
            P.bands(paths, count).layers.forEach((part, j) => { for (const path of part) layers[start + j].push(path); });
        });
        return { layers };
    };
    P.tones = (paths, n, sample) => {
        const layers = P.layers(n);
        if (layers.length === 1) return { layers: [paths] };
        for (const path of paths) {
            let run = [], pen = -1;
            for (let i = 1; i < path.length; i++) {
                const a = path[i - 1], b = path[i];
                const value = sample((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                // A little hysteresis keeps tiny brightness changes from making specks.
                const next = pen >= 0 && value >= (pen - 0.15) / n && value <= (pen + 1.15) / n
                    ? pen : P.band(value, n);
                if (next !== pen) {
                    if (run.length > 1) layers[pen].push(run);
                    run = [a]; pen = next;
                }
                run.push(b);
            }
            if (run.length > 1) layers[pen].push(run);
        }
        return { layers };
    };
    P.renderScene = (id, S, p) => {
        const config = P.scenes[id];
        const pens = p.pens === undefined ? P.migrate({ id }, { ...p }).pens || 4 : p.pens;
        const layers = [];
        PG.iso.renderPens(S, config.maps[P.count(pens) - 1], config.groups).forEach((paths, pen) => layers.push({ pen, paths }));
        return { layers };
    };
    P.slots = (def, p) => {
        const n = P.count(p.pens), scene = P.scenes[def.id];
        const order = P.designs[def.id]?.order || [INK, RED, BLUE, GREEN, GOLD, PURPLE, CYAN, BROWN];
        return scene ? [...new Set(scene.maps[n - 1])] : n === 1 ? [INK] : order.slice(0, n);
    };
    P.roles = (def, p) => {
        const scene = P.scenes[def.id], roles = {};
        if (scene) scene.maps[P.count(p.pens) - 1].forEach((pen, i) => (roles[pen] ||= []).push(scene.roles[i]));
        else P.slots(def, p).forEach((pen, i) => { roles[pen] = [`Color ${i + 1}`]; });
        return roles;
    };
    P.apply = (def, out, p) => {
        const config = P.designs[def.id];
        if (!config || !out || P.scenes[def.id]) return out;
        const n = P.count(p.pens);
        const groups = Array.isArray(out) ? [out] : (out.layers || []).map(l => Array.isArray(l) ? l : l.paths);
        if (config.style === 'sequence') out = P.sequence(groups.flat(), n);
        else if (config.style === 'families') out = P.families(groups, n);
        else if (config.style === 'maze') {
            const walls = groups[0] || [], solution = groups[1] || [];
            const bounds = PG.geo.bbox(walls);
            const layers = P.layers(n), wallPens = solution.length && n > 1 ? n - 1 : n;
            for (const path of walls) {
                const centre = PG.geo.bbox([path]);
                layers[P.band(((centre.minY + centre.maxY) / 2 - bounds.minY) / (bounds.h || 1), wallPens)].push(path);
            }
            for (const path of solution) layers[n - 1].push(path);
            out = { layers };
        }
        const slots = P.slots(def, p);
        const layers = Array.isArray(out) ? [out] : out.layers || [];
        return { layers: layers.map((layer, i) => ({ pen: slots[i % n], paths: Array.isArray(layer) ? layer : layer.paths })) };
    };
})();
