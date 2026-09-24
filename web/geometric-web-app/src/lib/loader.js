/*
 * Lists every generator file and loads them in order. Plain <script> tags
 * keep the app working when index.html is opened straight from disk.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    PG.GENERATOR_FILES = [
        // Curves
        'spirograph', 'mystery', 'harmonograph', 'maurer', 'superformula', 'guilloche',
        'timestable', 'flower', 'phyllotaxis', 'attractor',
        // Fields
        'flowfield', 'ridgelines', 'topo', 'chladni', 'moire', 'warp',
        // Tiles
        'truchet', 'islamic', 'whirl', 'maze', 'lsystem',
        // Packing
        'circlepack', 'subdivide', 'voronoi',
        // Image
        'image',
    ];

    PG.loadGenerators = function (base = 'generators/') {
        const load = (name, retries) => new Promise(resolve => {
            const s = document.createElement('script');
            s.src = `${base}${name}.js`;
            s.async = false; // execute in list order
            s.onload = () => resolve(true);
            s.onerror = () => {
                s.remove();
                // a flaky connection shouldn't cost a design: retry before giving up
                if (retries > 0) { setTimeout(() => load(name, retries - 1).then(resolve), 300); return; }
                console.warn(`Generator "${name}" failed to load`);
                resolve(false);
            };
            document.head.appendChild(s);
        });
        return Promise.all(PG.GENERATOR_FILES.map(name => load(name, 2))).then(ok => {
            // retried files register late; restore the listed order
            const order = id => PG.GENERATOR_FILES.indexOf(id);
            PG.generators.sort((a, b) => order(a.id) - order(b.id));
            return ok;
        });
    };
})();
