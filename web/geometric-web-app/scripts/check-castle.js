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
// The pipeline cuts everything to the margins, which would hide a line that ran off to nowhere
function raw(params = {}) {
    const W = 180, H = 267, out = def.generate({ ...defaults, ...params }, { width: W, height: H, seed: 1 });
    for (const layer of out.layers) for (const line of layer.paths) for (const [x, y] of line) {
        assert.ok(x > -W && x < 2 * W && y > -H && y < 2 * H, 'A line runs far off the page');
    }
}
// How much of the black pen's work is solid ink: 1.2 mm squares that a 0.35 mm pen fills at least 80% of
function blobs(res) {
    const cell = 0.1, W = Math.ceil(settings.paperW / cell), H = Math.ceil(settings.paperH / cell), ink = new Uint8Array(W * H), r = 0.35 / 2 / cell;
    for (const line of res.layers.find(l => l.pen === 0).paths) for (let i = 1; i < line.length; i++) {
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
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the town');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seeds should vary the town');
assert.ok(first.stats.draw < 60000, 'Default drawing is too dense to plot');
// Measured on one kind of town, so the number means the same from one change to the next. About 850 as it
// stands. It was over 2000 when the timber framing, battlements and gates filled in.
const solid = blobs(run({ shape: 'ragged', towers: 'round', castleAt: 'back' }));
assert.ok(solid < 1200, `Drawing has ${solid} solid patches of black ink`);
// the walls that run straight away from the camera are the ones with no width on paper
for (const [yaw, elev] of [[45, 40], [20, 25], [20, 60], [70, 25], [70, 60]]) {
    for (const castleAt of ['back', 'right']) raw({ yaw, elev, castleAt, towers: 'mixed' });
}

// Every plan with every build of tower, and the castle in both corners. A square town is the smallest on the
// page, and the one most likely to fill in.
const menus = { shape: ['ragged', 'octagon', 'square', 'long'], towers: ['round', 'square', 'mixed'], castleAt: ['back', 'right'] };
let heaviest = 0;
for (const shape of menus.shape) for (const towers of menus.towers) for (const castleAt of menus.castleAt) {
    const res = run({ shape, towers, castleAt }, { seed: 3 });
    if (shape === 'square') heaviest = Math.max(heaviest, blobs(res));
}
assert.ok(heaviest < 1700, `A square town has ${heaviest} solid patches of black ink`);
run({ shape: 'long', towers: 'square', castle: false, size: 70 });
run({ shape: 'long', towers: 'mixed', castleAt: 'right', size: 150 });
// A seed picks a plan, a build of tower and a corner for the castle. Choosing the same from the menus has
// to give the same town, and the seeds shouldn't all pick alike.
const picked = { shape: new Set(), towers: new Set(), castleAt: new Set() };
// not assert.deepEqual, which builds a diff of both drawings when they differ
const drawn = res => JSON.stringify(res.layers);
for (let seed = 1; seed <= 8; seed++) {
    const any = drawn(run({}, { seed }));
    for (const [id, options] of Object.entries(menus)) {
        const same = options.filter(v => drawn(run({ [id]: v }, { seed })) === any);
        assert.equal(same.length, 1, `Seed ${seed} matches ${same.length} choices of ${id}`);
        picked[id].add(same[0]);
    }
}
assert.ok(picked.shape.size >= 3 && picked.towers.size >= 2 && picked.castleAt.size === 2, 'Eight seeds gave towns too much alike');

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
console.log(`Castle Town: ${cases} cases passed (plans, towers, keeps, camera limits, paper sizes, parameter limits, random towns, grid, clipping and SVG). ${solid} solid patches of black ink, ${heaviest} in a square town. Slowest ${slowest.toFixed(0)} ms`);
