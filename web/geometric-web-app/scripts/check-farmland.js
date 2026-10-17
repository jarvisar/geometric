/* Farmland: every landscape and season, camera and parameter limits, repeatability and export contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/farmland.js');
const def = PG.byId.farmland, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const countries = def.params.find(q => q.id === 'country').options.map(o => o[0]);
const seasons = ['spring', 'summer', 'harvest'];
let cases = 0, slowest = 0, slowestCase = '', longest = 0;
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, res = PG.run(def, { ...defaults, ...params }, s);
    const label = JSON.stringify({ ...params, seed: s.seed });
    assert.ok(res.stats.paths > 0, `Empty farm ${label}`);
    assert.ok(res.stats.points < 400000, `Unbounded scene complexity ${label}`);
    for (const layer of res.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `Non-finite geometry ${label}`);
        assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 && y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, `Geometry escaped the drawing area ${label}`);
    }
    if (res.timing.generate > slowest) { slowest = res.timing.generate; slowestCase = label; }
    longest = Math.max(longest, res.stats.draw);
    cases++;
    return res;
}

const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the farm');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the farm');

// every landscape in every season, on a few seeds
for (const country of countries) {
    for (const season of seasons) {
        for (const seed of [1, 2, 3]) {
            const res = run({ country, season }, { seed });
            assert.ok(res.stats.draw < 90000, `${country} ${season} seed ${seed} has ${(res.stats.draw / 1000).toFixed(0)} m of line`);
        }
    }
}
// the camera limits, small and large views, flat and hilly ground
for (const country of countries) {
    const settled = run({ country, holdings: true }, { seed: 3 });
    const isolated = run({ country, holdings: false }, { seed: 3 });
    assert.notDeepEqual(settled.layers, isolated.layers, `${country}: outlying farmyards did not change the scene`);
    for (const [yaw, elev] of [[20, 25], [20, 60], [70, 25], [70, 60]]) run({ country, yaw, elev });
    for (const size of [140, 420]) run({ country, size });
    for (const hills of [0, 1]) for (const fieldSize of [0.5, 1.6]) run({ country, hills, fieldSize });
    run({ country, creek: false, pond: false, work: 0, animals: 0, trees: 0 });
    run({ country, work: 1, animals: 1, trees: 1 });
    run({ country }, { paperW: 297, paperH: 210 });
    run({ country, size: 140 }, { paperW: 148, paperH: 148, seed: 101 });
}
for (const bound of ['min', 'max']) {
    const p = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
    for (const country of countries) run({ ...p, country });
}
const plain = Object.fromEntries(def.params.filter(q => q.type === 'checkbox').map(q => [q.id, false]));
for (const country of countries) run({ ...plain, country, pens: 1 });
// Randomize picks the landscape and the season. They shouldn't all come out alike.
const picked = { country: new Set(), season: new Set() };
for (let seed = 1; seed <= 12; seed++) {
    const p = PG.randomParams(def, defaults, new PG.RNG(seed * 7));
    for (const id of Object.keys(picked)) picked[id].add(p[id]);
    run(p, { seed });
}
assert.ok(picked.country.size >= 3 && picked.season.size >= 2, 'Twelve randomized farms were too much alike');
run({ pens: 8 }, { rotate: 30, clip: 'circle', frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
for (const pens of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const res = run({ pens, country: countries[pens % countries.length] });
    assert.ok(res.layers.filter(l => l.paths.length).length <= pens, `${pens} pens drew with more pens than that`);
}
const eight = run({ pens: 8 });
assert.ok(eight.layers.filter(l => l.paths.length).length >= 7, 'Eight pens should use nearly all of them');
const svg = PG.exporters.svg(eight, { w: 210, h: 297 }, [], { title: def.name });
assert.ok(svg.includes('inkscape:groupmode="layer"') && !/NaN|Infinity/.test(svg));
console.log(`Farmland: ${cases} cases passed (${countries.length} landscapes in ${seasons.length} seasons, camera limits, view sizes, paper sizes, parameter limits, random farms, grid, clipping and SVG). Longest ${(longest / 1000).toFixed(1)} m. Slowest ${slowest.toFixed(0)} ms ${slowestCase}`);
