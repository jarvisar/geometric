/* Moon Base composition, camera bounds, repeatability and export contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/moonbase.js');
const def = PG.byId.moonbase, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const option = id => def.params.find(q => q.id === id).options.map(o => o[0]);
const layouts = option('layout'), worlds = option('world');
let cases = 0;
// Hidden-line removal needs simple planar faces. In particular, joining an
// arch in the wrong direction makes its end wall cross itself and erases
// seemingly unrelated garden and frame lines behind it.
const face = PG.iso.Scene.prototype.face;
let checkedFaces = 0;
PG.iso.Scene.prototype.face = function (pts, ...args) {
    const normal = PG.iso.newell(pts), drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const projected = pts.map(p => p.filter((_, i) => i !== drop));
    const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < projected.length; i++) for (let j = i + 2; j < projected.length; j++) {
        if (i === 0 && j === projected.length - 1) continue;
        const a = projected[i], b = projected[(i + 1) % projected.length], c = projected[j], d = projected[(j + 1) % projected.length];
        assert.ok(!(side(a, b, c) * side(a, b, d) < -1e-8 && side(c, d, a) * side(c, d, b) < -1e-8), 'Self-crossing occlusion face');
    }
    checkedFaces++;
    return face.call(this, pts, ...args);
};
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, res = PG.run(def, { ...defaults, ...params }, s);
    assert.ok(res.stats.paths > 0, 'Empty colony');
    assert.ok(res.stats.points < 300000, 'Unbounded scene complexity');
    for (const layer of res.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), 'Non-finite geometry');
        assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 && y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, 'Geometry escaped the drawing area');
    }
    cases++;
    return res;
}
const first = run();
assert.ok(checkedFaces > 1000, 'Face validation did not inspect the colony');
// Every building variant goes through the face check too, on both worlds
for (const world of worlds) for (const domes of option('domes')) for (const habitats of option('habitats')) {
    run({ world, domes, habitats, layout: layouts[cases % layouts.length] }, { seed: 20 + cases });
}
PG.iso.Scene.prototype.face = face;
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the colony');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the colony');
assert.ok(first.stats.draw < 80000, 'Default drawing is too dense to plot');
const sparse = run({ density: 0 }), dense = run({ density: 1 });
assert.ok(dense.stats.draw > sparse.stats.draw * 1.1, 'Density must add substantial facilities');
const pen = (res, slot) => (res.layers.find(l => l.pen === slot) || { paths: [] }).paths;
const length = paths => paths.reduce((sum, line) => sum + PG.geo.pathLength(line), 0);
assert.notDeepEqual(run({ domes: 'shell', habitats: 'tower' }).layers, run({ domes: 'geodesic', habitats: 'cylinder' }).layers, 'Styles should change the buildings');

for (const world of worlds) for (const layout of layouts) {
    for (const [yaw, elev] of [[20, 25], [20, 60], [70, 25], [70, 60]]) {
        for (const [paperW, paperH] of [[210, 297], [297, 210]]) run({ world, layout, yaw, elev }, { paperW, paperH });
    }
    run({ world, layout, scale: 1.4 }, { paperW: 148, paperH: 148, seed: 101 });
    for (let seed = 40; seed < 46; seed++) run({ world, layout }, { seed });
}
for (const world of worlds) for (const bound of ['min', 'max']) {
    const p = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
    run({ ...p, world });
}
const plain = Object.fromEntries(def.params.filter(q => q.type === 'checkbox').map(q => [q.id, false]));
for (const world of worlds) run({ ...plain, world, craters: 0, dunes: 0, mesas: 0, devils: 0, rovers: 0, crew: 0, boulders: 0, pens: 1 });
run({ pens: 8 }, { rotate: 30, clip: 'circle', frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
const eight = run({ pens: 8 });
assert.equal(eight.layers.filter(l => l.paths.length).length, 8);
// Mars has its own ground, drawn with the red pen until brown takes it over at eight
const mars = run({ world: 'mars' }), marsEight = run({ world: 'mars', pens: 8 });
assert.notDeepEqual(mars.layers, first.layers, 'Mars should not be the Moon');
assert.ok(length(pen(mars, 1)) > length(pen(marsEight, 1)) * 2, 'Mars ground should be on the red pen');
assert.ok(length(pen(marsEight, 7)) > 1000, 'Eight pens should give Mars its ground back in brown');
assert.ok(PG.pens.roles(def, { world: 'mars', pens: 6 })[1].includes('Dust, dunes & tracks'), 'Pen legend should follow the world');
assert.ok(!PG.pens.roles(def, { world: 'moon', pens: 6 })[1].includes('Regolith & tracks'));
const svg = PG.exporters.svg(eight, { w: 210, h: 297 }, [], { title: def.name });
assert.ok(svg.includes('inkscape:groupmode="layer"') && !/NaN|Infinity/.test(svg));
console.log(`Moon Base: ${cases} cases passed (worlds, plans, building styles, camera limits, paper sizes, density, repeatability, grid, clipping and SVG)`);
