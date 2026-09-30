const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(src, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));

// Catch bad world coordinates before projection and pipeline cleanup can hide them.
let label;
const finite = points => {
    for (const point of points) assert.ok(point.every(Number.isFinite), `${label}: invalid scene point ${point}`);
};
const Scene = PG.iso.Scene;
PG.iso.Scene = class extends Scene {
    line(points, ...args) { finite(points); return super.line(points, ...args); }
    face(points, ...args) { finite(points); return super.face(points, ...args); }
};
load('generators/alpine.js');
const def = PG.byId.alpine, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 12, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const cases = [];
for (const [paperW, paperH] of [[148, 210], [210, 297], [297, 210], [420, 594]]) {
    for (let seed = 1; seed <= 8; seed++) {
        cases.push([`${paperW}x${paperH}, seed ${seed}`, PG.randomParams(def, defaults, new PG.RNG(seed * 1000)), { paperW, paperH, seed }]);
    }
}
for (const q of def.params.filter(q => q.type === 'range')) for (const value of [q.min, q.max]) {
    cases.push([`${q.id}=${value}`, { ...defaults, [q.id]: value }, {}]);
}
for (const framing of ['close', 'whole']) for (const cutaway of [false, true]) for (const contours of [false, true]) {
    cases.push([`${framing}, cutaway ${cutaway}, contours ${contours}`, { ...defaults, framing, cutaway, contours, pens: 8 }, {}]);
}
for (const clip of ['circle', 'hexagon', 'diamond']) {
    cases.push([clip, defaults, { clip, rotate: 35, frame: true }]);
}
const empty = { ...defaults, houses: 0, forest: 0, lake: 0, rock: 0, church: false, hut: false, cable: false, railway: false, falls: false, fliers: false };
cases.push(['empty valley', empty, {}]);
cases.push(['narrow steep valley', { ...defaults, size: 120, aspect: 0.6, relief: 240, valley: 0.1, elev: 20, yaw: 65, cutaway: true, contours: true, contour: 1 }, {}]);
cases.push(['large detailed valley', { ...defaults, size: 400, aspect: 2, relief: 30, forest: 1, houses: 1, valley: 0.5, pens: 8 }, { paperW: 420, paperH: 594 }]);
cases.push(['largest custom paper', { ...defaults, size: 400, aspect: 2, cutaway: true }, { paperW: 1200, paperH: 1200 }]);

let worst = 0;
for (const [name, params, changes] of cases) {
    label = name;
    const config = { ...settings, ...changes }, result = PG.run(def, params, config);
    assert.ok(result.stats.paths > 0, `${label}: empty drawing`);
    const shape = PG.makeShape(config.clip, config.margin, config.margin, config.paperW - 2 * config.margin, config.paperH - 2 * config.margin);
    for (const layer of result.layers) {
        assert.ok(layer.pen >= 0 && layer.pen < PG.MAX_PENS, `${label}: invalid pen`);
        for (const line of layer.paths) for (const [x, y] of line) {
            assert.ok(Number.isFinite(x) && Number.isFinite(y), `${label}: invalid output point`);
            assert.ok(shape.dist(x, y) >= -1e-5, `${label}: point outside crop`);
        }
    }
    const svg = PG.exporters.svg(result, { w: config.paperW, h: config.paperH }, [], { title: def.name });
    assert.ok(!/NaN|Infinity/.test(svg), `${label}: invalid SVG`);
    worst = Math.max(worst, result.timing.total);
}
label = 'repeatability';
const first = PG.run(def, defaults, settings).layers;
PG.run(def, { ...defaults, cutaway: true, contours: true, framing: 'whole', pens: 1 }, { ...settings, seed: 4294967295 });
assert.deepEqual(PG.run(def, defaults, settings).layers, first, 'intervening settings changed seeded output');
console.log(`${cases.length} Alpine cases passed: paper sizes, seeds, parameter limits, framing, contours, cutaway, crops and SVG. Worst ${Math.round(worst)}ms.`);
