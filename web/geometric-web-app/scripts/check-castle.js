/* Castle Town composition, camera bounds, repeatability and export contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/castle.js');
const def = PG.byId.castle, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let cases = 0, slowest = 0;
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, res = PG.run(def, { ...defaults, ...params }, s);
    assert.ok(res.stats.paths > 0, 'Empty town');
    assert.ok(res.stats.points < 300000, 'Unbounded scene complexity');
    for (const layer of res.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), 'Non-finite geometry');
        assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 && y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, 'Geometry escaped the drawing area');
    }
    slowest = Math.max(slowest, res.timing.generate);
    cases++;
    return res;
}
const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the town');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the town');
assert.ok(first.stats.draw < 60000, 'Default drawing is too dense to plot');

for (const keep of ['turrets', 'square', 'round']) {
    for (const [yaw, elev] of [[20, 25], [20, 60], [70, 25], [70, 60]]) {
        for (const [paperW, paperH] of [[210, 297], [297, 210]]) run({ keep, yaw, elev }, { paperW, paperH });
    }
}
for (const towerRoofs of ['mixed', 'cones', 'crenels']) run({ towerRoofs, gate2: false, castle: false });
run({ zoom: 1.6, size: 70 }, { paperW: 148, paperH: 148, seed: 101 });
for (const bound of ['min', 'max']) {
    const p = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
    run(p);
}
const plain = Object.fromEntries(def.params.filter(q => q.type === 'checkbox').map(q => [q.id, false]));
run({ ...plain, people: 0, gardens: 0, trees: 0, cottages: 0, moatLife: 0, pens: 1 });
for (let seed = 1; seed <= 12; seed++) run(PG.randomParams(def, defaults, new PG.RNG(seed * 7)), { seed });
run({ pens: 8 }, { rotate: 30, clip: 'circle', frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
const eight = run({ pens: 8 });
assert.equal(eight.layers.filter(l => l.paths.length).length, 8);
const svg = PG.exporters.svg(eight, { w: 210, h: 297 }, [], { title: def.name });
assert.ok(svg.includes('inkscape:groupmode="layer"') && !/NaN|Infinity/.test(svg));
console.log(`Castle Town: ${cases} cases passed (keeps, camera limits, paper sizes, parameter limits, random towns, grid, clipping and SVG). Slowest ${slowest.toFixed(0)} ms`);
