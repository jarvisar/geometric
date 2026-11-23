#!/usr/bin/env node
/* Exploded View: every machine, layout and setting draws inside the margins, repeats for a seed and keeps its parts on their pens. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'optimize', 'stack', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/exploded.js');
const def = PG.byId.exploded, defaults = PG.defaultParams(def);
const kinds = def.params.find(q => q.id === 'kind').options.map(o => o[0]);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let cases = 0, slowest = 0, longest = 0;
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, p = { ...defaults, ...params };
    const res = PG.run(def, p, s), label = JSON.stringify({ ...params, ...options });
    assert.ok(res.stats.paths > 0, `Empty drawing: ${label}`);
    assert.ok(res.stats.points < 120000, `Unbounded detail: ${label}`);
    for (const layer of res.layers) {
        assert.ok(Number.isInteger(layer.pen) && layer.pen >= 0 && layer.pen < PG.MAX_PENS, `Invalid pen: ${label}`);
        for (const line of layer.paths) {
            assert.ok(line.length >= 2, `Empty stroke: ${label}`);
            for (const [x, y] of line) {
                assert.ok(Number.isFinite(x) && Number.isFinite(y), `Non-finite geometry: ${label}`);
                assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 &&
                    y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, `Escaped margins: ${label}`);
            }
        }
    }
    slowest = Math.max(slowest, res.timing.generate);
    longest = Math.max(longest, res.stats.draw);
    cases++;
    return res;
}
// The drawing by part, straight from the generator: 0 housings, 1 moving parts, 2 fasteners,
// 3 bearings, seals and springs, 4 threads, 5 center lines, 6 part numbers, 7 lettering
function parts(params = {}, seed = 1, width = 180, height = 267) {
    const shape = PG.shapes.rect(0, 0, width, height), order = PG.pens.designs.exploded.order;
    const out = def.generate({ ...defaults, ...params, pens: 8 }, {
        seed, rng: new PG.RNG(seed), width, height,
        shape: { ...shape, kind: 'rect', polygon: () => shape.outline().slice(0, -1) },
    });
    // with eight pens every part has a pen of its own
    const pens = PG.pens.scenes.exploded.maps[7];
    return pens.map(pen => (out.layers.find(l => l.pen === pen) || { paths: [] }).paths);
}
const length = paths => paths.reduce((sum, q) => sum + PG.geo.pathLength(q), 0);
const BODY = 0, FASTEN = 2, CENTER = 5, LABEL = 6, TEXT = 7;

const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the drawing');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seed should vary the machine');

for (const kind of kinds) {
    for (const axis of ['flat', 'up']) for (const flip of [false, true]) {
        for (const [explode, extras] of [[100, 0.7], [0, 1], [150, 0], [40, 0.35]]) run({ kind, axis, flip, explode, extras });
    }
    // Every machine has housings and fasteners or working parts, a center line down its main
    // axis, numbers for its parts and its captions
    for (let seed = 1; seed <= 4; seed++) {
        const P = parts({ kind }, seed);
        assert.ok(length(P[BODY]) > 100, `${kind}: no housing`);
        assert.ok(length(P[CENTER]) > 40, `${kind}: no center lines`);
        assert.ok(P[LABEL].length >= 12, `${kind}: parts are missing their numbers`);
        assert.ok(P[TEXT].length >= 10, `${kind}: no title or captions`);
        // Put back together there's nothing for a center line to join up, and no second figure
        const whole = parts({ kind, explode: 0 }, seed);
        assert.equal(whole[CENTER].length, 0, `${kind}: center lines in the assembled machine`);
        assert.ok(length(whole[BODY]) < length(P[BODY]) * 1.6, `${kind}: assembled view drawn beside the assembled machine`);
        // Each of these only takes its own lines away
        const bare = parts({ kind, numbers: false, centers: false, header: false, assembled: false }, seed);
        assert.equal(bare[CENTER].length + bare[LABEL].length + bare[TEXT].length, 0, `${kind}: annotations left on`);
        assert.deepEqual(parts({ kind, numbers: false }, seed).slice(0, 6), P.slice(0, 6), `${kind}: part numbers changed the drawing`);
        // More small parts means more to draw
        assert.ok(length(parts({ kind, extras: 1 }, seed)[FASTEN]) >= length(parts({ kind, extras: 0 }, seed)[FASTEN]) * 0.8, `${kind}: small parts went missing`);
    }
}
// Small parts only adds and takes away small parts: the title, which comes from the
// same random numbers as the rest of the machine, stays the same
for (const kind of kinds) for (let seed = 1; seed <= 4; seed++) {
    const title = extras => JSON.stringify(parts({ kind, extras }, seed)[TEXT].filter(q => q.every(p => p[1] < 8)));
    assert.equal(title(0), title(1), `${kind}: Small parts changed the rest of the machine`);
}
for (const q of def.params.filter(q => q.type === 'range')) for (const value of [q.min, q.max]) run({ [q.id]: value });
for (const turn of [-25, 25]) for (const elev of [20, 55]) for (const axis of ['flat', 'up']) run({ turn, elev, axis });
for (let seed = 1; seed <= 24; seed++) run(PG.randomParams(def, defaults, new PG.RNG(seed * 13)), { seed });
for (const [paperW, paperH] of [[105, 148], [420, 594], [297, 210], [100, 100], [74, 105], [60, 40]]) {
    for (const kind of kinds) run({ kind }, { paperW, paperH, margin: Math.min(15, paperW / 12) });
}
for (const clip of ['circle', 'hexagon', 'diamond']) run({}, { rotate: 30, clip, frame: true });
run({}, { rotate: 90 });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'params' });
for (let pens = 1; pens <= 8; pens++) assert.equal(run({ pens }).layers.filter(l => l.paths.length).length, pens);

assert.ok(slowest < 3000, `Too slow: ${slowest.toFixed(0)} ms`);
assert.ok(longest < 40000, `Too much line: ${(longest / 1000).toFixed(1)} m`);
console.log(`Exploded View OK: ${cases} drawings, slowest ${slowest.toFixed(0)} ms, longest ${(longest / 1000).toFixed(1)} m`);
