/* Temple Garden: every kind of garden, rake pattern, building and paper shape, camera and parameter limits, repeatability and export contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/temple.js');
const def = PG.byId.temple, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const options = id => def.params.find(q => q.id === id).options.map(o => o[0]);
const gardens = options('garden'), rakes = options('rake'), annexes = options('annex'), roofs = options('roof'), sides = options('side');

// A coordinate that isn't a number makes a face hide lines it has nothing to do with, so nothing may add one
const scene = PG.iso.Scene.prototype, addFace = scene.face, addLine = scene.line;
const finite = pts => pts.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]));
scene.face = function (pts, cast) { assert.ok(finite(pts), 'A face has a coordinate that is not a number'); return addFace.call(this, pts, cast); };
scene.line = function (pts, whole) { assert.ok(finite(pts), 'A line has a coordinate that is not a number'); return addLine.call(this, pts, whole); };

let cases = 0, slowest = 0, slowestCase = '', longest = 0;
function run(params = {}, extra = {}) {
    const s = { ...settings, ...extra }, res = PG.run(def, { ...defaults, ...params }, s);
    const label = JSON.stringify({ ...params, seed: s.seed, paper: `${s.paperW}x${s.paperH}` });
    assert.ok(res.stats.paths > 0, `Empty garden ${label}`);
    assert.ok(res.stats.points < 600000, `Unbounded scene complexity ${label}`);
    for (const layer of res.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `Non-finite geometry ${label}`);
        assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 && y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, `Geometry escaped the drawing area ${label}`);
    }
    if (res.timing.generate > slowest) { slowest = res.timing.generate; slowestCase = label; }
    if (s.paperW * s.paperH <= 210 * 297) longest = Math.max(longest, res.stats.draw);
    cases++;
    return res;
}
// meters of line on each pen
const inkOn = (res, pen) => res.layers.filter(l => l.pen === pen).reduce((sum, l) => sum + l.paths.reduce((a, q) => a + PG.geo.pathLength(q), 0), 0);
const GOLD = 4;

const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the garden');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the garden');
// the gravel is the main thing: most of the ink at the default settings
const total = first.layers.reduce((sum, l) => sum + inkOn(first, l.pen), 0);
assert.ok(inkOn(first, GOLD) > 0.4 * total, 'The raked gravel should be most of the drawing');

// every kind of garden on a few seeds, and the way each one is drawn
const ink = res => res.layers.reduce((sum, l) => sum + inkOn(res, l.pen), 0);
for (const garden of gardens) {
    for (const seed of [1, 2, 3, 4]) {
        const res = run({ garden }, { seed });
        assert.ok(res.stats.draw < 60000, `${garden} seed ${seed} has ${(res.stats.draw / 1000).toFixed(0)} m of line`);
        for (const rake of rakes) run({ garden, rake }, { seed });
    }
}
// they don't look alike: gravel is most of a dry garden and a court, and only a little of a moss garden
const share = garden => { const res = run({ garden, shadows: false }, { seed: 5 }); return inkOn(res, GOLD) / ink(res); };
assert.ok(share('dry') > 0.35 && share('court') > 0.25, 'Dry gardens and courts should be mostly gravel');
assert.ok(share('pond') < 0.15 && share('tea') < 0.15, 'Pond and tea gardens should be mostly moss');
for (const [a, b] of [['dry', 'pond'], ['dry', 'tea'], ['dry', 'court'], ['pond', 'tea']]) assert.notDeepEqual(run({ garden: a }).layers, run({ garden: b }).layers, `${a} and ${b} came out the same`);

// every pattern beside every building, with and without a pond, on a few seeds
for (const rake of rakes) {
    for (const annex of annexes) {
        for (const pond of [false, true]) {
            const seed = 1 + cases % 5, res = run({ rake, annex, pond }, { seed });
            assert.ok(res.stats.draw < 60000, `${rake} ${annex} seed ${seed} has ${(res.stats.draw / 1000).toFixed(0)} m of line`);
        }
    }
}
// each control changes the drawing
const base = run({ pond: true, annex: 'tea' }, { seed: 4 });
for (const [id, value] of [['garden', 'pond'], ['garden', 'tea'], ['garden', 'court'], ['side', 'right'], ['roof', 'gable'], ['annex', 'pagoda'], ['pond', false], ['cones', true], ['path', true], ['rake', 'waves'], ['rings', 6], ['border', 3],
    ['rakeTurn', 90], ['rocks', 0.9], ['moss', 0.9], ['pines', 1], ['maples', 0], ['shrubs', 0], ['lanterns', 0], ['woods', 0.1], ['people', 1], ['shadows', false], ['roofHatch', false], ['detail', false]]) {
    assert.notDeepEqual(run({ pond: true, annex: 'tea', [id]: value }, { seed: 4 }).layers, base.layers, `${id} did not change the garden`);
}
// the view only moves the camera: a wider one shows more woods, and the same gravel as far as it showed before
const wide = run({ size: 70 }), close = run({ size: 30 });
assert.ok(inkOn(wide, 3) > inkOn(first, 3), 'A wider view should show more of the woods');
assert.notDeepEqual(close.layers, first.layers, 'View size did not change the drawing');

// Where things stand, as the scene is built: rocks by their first corner, cut-outs and turned shapes by their middle
function placed(params, extra = {}) {
    const seen = [], solid = scene.solid, lathe = scene.lathe, card = PG.iso.card;
    scene.solid = function (v, f, g) { if (/at rock /.test(new Error().stack)) seen.push(`rock ${v[0][0].toFixed(3)},${v[0][1].toFixed(3)}`); return solid.call(this, v, f, g); };
    scene.lathe = function (x, y, prof, n, sm, rot) { seen.push(`lathe ${x.toFixed(3)},${y.toFixed(3)} ${prof[0][0].toFixed(3)}`); return lathe.call(this, x, y, prof, n, sm, rot); };
    PG.iso.card = (T, x, y, z, off) => { seen.push(`card ${x.toFixed(3)},${y.toFixed(3)}`); return card(T, x, y, z, off); };
    try { run(params, extra); } finally { scene.solid = solid; scene.lathe = lathe; PG.iso.card = card; }
    return seen;
}
const rocksOf = list => new Set(list.filter(q => q.startsWith('rock')));
// Controls that are about something else leave the rock islands where they were
for (const seed of [3, 4]) {
    const before = rocksOf(placed({}, { seed }));
    for (const change of [{ rings: 5 }, { border: 3 }, { cones: true }, { lanterns: 0.9 }, { pines: 0.9 }, { maples: 0 }, { shrubs: 1 }, { people: 1 }, { rake: 'waves' }]) {
        const after = rocksOf(placed(change, { seed }));
        assert.ok([...before].every(q => after.has(q)), `${JSON.stringify(change)} moved the rocks on seed ${seed}`);
    }
}
// Zooming out shows the same things in the same places, and more of them
for (const garden of gardens) {
    for (const seed of [1, 2]) {
        const near = new Set(placed({ garden }, { seed })), far = new Set(placed({ garden, size: 80 }, { seed }));
        const lost = [...near].filter(q => !far.has(q));
        assert.ok(lost.length === 0, `Zooming out of a ${garden} garden changed ${lost.length} things on seed ${seed}, like ${lost[0]}`);
    }
}
// The lines along the edges ring the islands too, and the open pattern stops at the outermost of them.
// So with four of them, no more rings than that are drawn and the pattern stops in the same place.
assert.deepEqual(run({ rings: 0, border: 4 }).layers, run({ rings: 4, border: 4 }).layers, 'The open pattern ran inside the lines round the islands');
// Ripples with no islands still rake the gravel, along its edges
const bareRipples = run({ rake: 'ripples', rocks: 0, shadows: false });
assert.ok(inkOn(bareRipples, GOLD) > 0.6 * inkOn(run({ rocks: 0, shadows: false }), GOLD), 'Ripples with no islands left the gravel bare');
// no shadows, no shadow pen. One pen draws everything.
assert.ok(inkOn(run({ shadows: false, roofHatch: false, pond: false }), 2) === 0, 'Blue ink with the shadows, roof tiles and pond all off');
// zero on a slider means none
const bare = run({ rocks: 0, moss: 0, pines: 0, maples: 0, shrubs: 0, lanterns: 0, woods: 0, people: 0, annex: 'none' });
assert.ok(inkOn(bare, 3) === 0 && inkOn(bare, 1) === 0, 'Plants were drawn with every amount at zero');

// camera limits, view sizes, and paper shapes
for (const side of sides) {
    for (const garden of gardens) for (const [yaw, elev] of [[20, 25], [20, 60], [70, 25], [70, 60]]) run({ garden, side, yaw, elev, pond: true });
    for (const garden of gardens) for (const size of [26, 90]) run({ garden, side, size });
    for (const size of [26, 90]) for (const annex of annexes) run({ side, size, annex });
    for (const roof of roofs) run({ side, roof, annex: 'hall' }, { seed: 3 });
}
for (const [paperW, paperH] of [[297, 210], [210, 210], [148, 210], [420, 297], [110, 297], [297, 110], [90, 90]]) {
    for (const garden of gardens) run({ garden, pond: true }, { paperW, paperH, seed: 6 });
    run({ pond: false }, { paperW, paperH, seed: 6 });
}
for (const bound of ['min', 'max']) {
    const p = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
    for (const rake of rakes) for (const garden of gardens) run({ ...p, rake, garden, pond: true }, { seed: 4 });
}
const plain = Object.fromEntries(def.params.filter(q => q.type === 'checkbox').map(q => [q.id, false]));
for (const rake of rakes) for (const garden of gardens) run({ ...plain, rake, garden, pens: 1 });
// Randomize picks the kind of garden, the side, the roof, the building, and the pattern. They shouldn't all come out alike.
const picked = { garden: new Set(), side: new Set(), roof: new Set(), annex: new Set(), rake: new Set() };
for (let seed = 1; seed <= 16; seed++) {
    const p = PG.randomParams(def, defaults, new PG.RNG(seed * 7));
    for (const id of Object.keys(picked)) picked[id].add(p[id]);
    run(p, { seed });
}
assert.ok(picked.garden.size >= 3 && picked.side.size === 2 && picked.annex.size >= 3 && picked.rake.size >= 4 && picked.roof.size >= 2, 'Sixteen randomized gardens were too much alike');
run({ pens: 8 }, { rotate: 30, clip: 'circle', frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
for (const pens of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const res = run({ pens, pond: true, annex: annexes[pens % annexes.length], garden: gardens[pens % gardens.length] }, { seed: 12 });
    assert.ok(res.layers.filter(l => l.paths.length).length <= pens, `${pens} pens drew with more pens than that`);
}
const eight = run({ pens: 8, pond: true, people: 1 }, { seed: 2 });
assert.ok(eight.layers.filter(l => l.paths.length).length === 8, 'Eight pens should use all of them');
const svg = PG.exporters.svg(eight, { w: 210, h: 297 }, [], { title: def.name });
assert.ok(svg.includes('inkscape:groupmode="layer"') && !/NaN|Infinity/.test(svg));
console.log(`Temple Garden: ${cases} cases passed (${gardens.length} kinds of garden, ${rakes.length} rake patterns beside ${annexes.length} buildings, controls, camera limits, view sizes, paper shapes, parameter limits, random gardens, grid, clipping, and SVG). Longest on A4 ${(longest / 1000).toFixed(1)} m. Slowest ${slowest.toFixed(0)} ms ${slowestCase}`);
