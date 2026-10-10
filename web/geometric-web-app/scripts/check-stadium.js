/* Stadium kinds, camera bounds, ink density, repeatability and export contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/stadium.js');
const def = PG.byId.stadium, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const kinds = def.params.find(q => q.id === 'type').options.map(o => o[0]).filter(k => k !== 'any');
let cases = 0, slowest = 0;
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, res = PG.run(def, { ...defaults, ...params }, s);
    assert.ok(res.stats.paths > 0, 'Empty stadium');
    assert.ok(res.stats.points < 300000, 'Unbounded scene complexity');
    for (const layer of res.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), 'Non-finite geometry');
        assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 && y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, 'Geometry escaped the drawing area');
    }
    slowest = Math.max(slowest, res.timing.generate);
    cases++;
    return res;
}
// The pipeline cuts everything to the margins, which would hide a line that ran off to nowhere
function raw(params = {}, seed = 1) {
    const W = 180, H = 267, out = def.generate({ ...defaults, ...params }, { width: W, height: H, seed });
    for (const layer of out.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(x > -W && x < 2 * W && y > -H && y < 2 * H, 'A line runs far off the page');
    }
    return out;
}
// How much of one pen's work is solid ink: 1.2 mm squares that a 0.35 mm pen fills at least 80% of
function blobs(res, pen = 0) {
    const cell = 0.1, W = Math.ceil(settings.paperW / cell), H = Math.ceil(settings.paperH / cell), ink = new Uint8Array(W * H), r = 0.35 / 2 / cell;
    for (const line of (res.layers.find(l => l.pen === pen) || { paths: [] }).paths) for (let i = 1; i < line.length; i++) {
        const ax = line[i - 1][0] / cell, ay = line[i - 1][1] / cell, dx = line[i][0] / cell - ax, dy = line[i][1] / cell - ay, L2 = dx * dx + dy * dy || 1;
        for (let y = Math.max(0, Math.floor(Math.min(ay, ay + dy) - r)); y <= Math.min(H - 1, Math.ceil(Math.max(ay, ay + dy) + r)); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(ax, ax + dx) - r)); x <= Math.min(W - 1, Math.ceil(Math.max(ax, ax + dx) + r)); x++) {
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
                if ((x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2 <= r * r) ink[y * W + x] = 1;
            }
        }
    }
    let hot = 0;
    for (let y = 0; y + 12 <= H; y += 6) for (let x = 0; x + 12 <= W; x += 6) {
        let s = 0;
        for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) s += ink[(y + j) * W + x + i];
        if (s >= 0.8 * 144) hot++;
    }
    return hot;
}
const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the stadium');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the stadium');

// Every kind on a few seeds: nothing too long to plot, and no pen laying down solid patches of ink
let worstInk = 0, longest = 0;
for (const type of kinds) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        const res = run({ type }, { seed });
        longest = Math.max(longest, res.stats.draw);
        assert.ok(res.stats.draw < 60000, `A ${type} is too dense to plot: ${(res.stats.draw / 1000).toFixed(1)} m`);
        for (const layer of res.layers) worstInk = Math.max(worstInk, blobs(res, layer.pen));
    }
}
// About 300 as it stands, nearly all of it people. It was 1800 when a full car park was rows of two-box cars.
assert.ok(worstInk < 600, `A pen lays down ${worstInk} solid patches of ink`);

// A seed picks the kind. Choosing the same kind from the menu has to give the same stadium, and
// twenty seeds should turn up most of the kinds.
const seen = new Set();
for (let seed = 1; seed <= 20; seed++) {
    const any = JSON.stringify(raw({}, seed).layers), kind = kinds.find(type => JSON.stringify(raw({ type }, seed).layers) === any);
    assert.ok(kind, `Seed ${seed}: no kind in the menu gives the stadium the seed picked`);
    seen.add(kind);
}
assert.ok(seen.size >= 5, `Twenty seeds only gave ${[...seen].join(', ')}`);
// the walls that run straight away from the camera are the ones with no width on paper
for (const type of kinds) for (const [yaw, elev] of [[45, 45], [20, 30], [20, 60], [70, 30], [70, 60]]) raw({ type, yaw, elev }, 3);
for (const type of kinds) {
    for (const [yaw, elev] of [[20, 30], [70, 60]]) for (const [paperW, paperH] of [[210, 297], [297, 210]]) run({ type, yaw, elev }, { paperW, paperH, seed: 4 });
    run({ type, zoom: 2 }, { paperW: 148, paperH: 148, seed: 101 });
    run({ type, around: false, players: false, grass: false, roofHatch: false, shadows: false, pens: 1 }, { seed: 5 });
}
// every choice in every menu, on a kind that takes it
for (const q of def.params.filter(q => q.type === 'select' && q.id !== 'type')) {
    for (const [value] of q.options) for (const type of ['ground', 'bowl', 'oval']) run({ type, [q.id]: value }, { seed: 7 });
}
for (const bound of ['min', 'max']) {
    const p = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
    for (const type of kinds) run({ ...p, type });
}
for (let seed = 1; seed <= 12; seed++) run(PG.randomParams(def, defaults, new PG.RNG(seed * 7)), { seed });
run({ pens: 8 }, { rotate: 30, clip: 'circle', frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
// seats spell a word along a stand that faces the camera
const plain = run({ type: 'ground', seats: 'plain', colors: 'redgold' }, { seed: 12 }), worded = run({ type: 'ground', seats: 'letters', colors: 'redgold' }, { seed: 12 });
assert.notDeepEqual(worded.layers, plain.layers, 'Lettering did not change the seats');
const eight = run({ type: 'bowl', pens: 8 });
assert.equal(eight.layers.filter(l => l.paths.length).length, 8);
const svg = PG.exporters.svg(eight, { w: 210, h: 297 }, [], { title: def.name });
assert.ok(svg.includes('inkscape:groupmode="layer"') && !/NaN|Infinity/.test(svg));
console.log(`Stadium: ${cases} cases passed (${kinds.length} kinds, camera limits, paper sizes, menus, parameter limits, random stadiums, grid, clipping and SVG). Longest ${(longest / 1000).toFixed(1)} m, ${worstInk} solid patches of ink at worst. Slowest ${slowest.toFixed(0)} ms`);
