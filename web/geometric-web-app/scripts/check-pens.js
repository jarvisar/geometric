#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export', 'loader'].forEach(name => load(`lib/${name}.js`));
PG.GENERATOR_FILES.forEach(name => load(`generators/${name}.js`));

function generate(def, params) {
    const shape = PG.shapes.rect(0, 0, 180, 267);
    const ctx = { width: 180, height: 267, seed: 1, rng: new PG.RNG(1), noise: PG.makeNoise(new PG.RNG(1 ^ 0x5bd1e995)),
        shape: { ...shape, polygon: () => shape.outline().slice(0, -1) }, images: {} };
    return PG.normalizeOutput(PG.pens.apply(def, def.generate(params, ctx), params)).filter(l => l.paths.length);
}

// Line integrals survive path reversal, splitting and regrouping. Missing or moved
// strokes change these even when their total length happens to stay the same.
function ink(layers) {
    const sums = [0, 0, 0, 0, 0, 0];
    for (const layer of layers) for (const path of layer.paths) for (let i = 1; i < path.length; i++) {
        const [x, y] = path[i - 1], [u, v] = path[i], len = Math.hypot(u - x, v - y);
        const values = [1, (x + u) / 2, (y + v) / 2, (x * x + x * u + u * u) / 3,
            (y * y + y * v + v * v) / 3, (2 * x * y + x * v + u * y + 2 * u * v) / 6];
        values.forEach((value, k) => { sums[k] += value * len; });
    }
    return sums;
}
function sameInk(a, b, label) {
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 1e-7 * Math.max(1, Math.abs(v)), `${label}: geometry changed (moment ${i}: ${v} vs ${b[i]})`));
}
const only = process.argv.slice(2);
for (const def of PG.generators.filter(d => !only.length || only.includes(d.id))) {
    const control = def.params.filter(q => q.id === 'pens');
    assert.equal(control.length, 1, `${def.id}: one pen control`);
    assert.equal(control[0].max, 8);
    assert.equal(control[0].show, undefined, `${def.id}: pens must be available in every mode`);
    const defaults = PG.defaultParams(def), counts = [];
    let reference;
    for (let pens = 1; pens <= 8; pens++) {
        const params = { ...defaults, pens }, layers = generate(def, params);
        assert.equal(layers.length, pens, `${def.id}: default drawing should use all ${pens} pens`);
        assert.ok(layers.every(l => Number.isInteger(l.pen) && l.pen >= 0 && l.pen < 8));
        const measure = ink(layers);
        if (pens === 1) { reference = measure; assert.equal(layers[0].pen, 0); }
        else sameInk(reference, measure, `${def.id}, ${pens} pens`);
        counts.push(layers.length);
        if (pens === 8) assert.deepEqual(generate(def, params), layers, `${def.id}: repeatability`);
    }
    for (let seed = 100; seed < 103; seed++) {
        const params = PG.randomParams(def, defaults, new PG.RNG(seed));
        sameInk(ink(generate(def, { ...params, pens: 1 })), ink(generate(def, { ...params, pens: 8 })), `${def.id}, random ${seed}`);
    }
    console.log(`${def.id.padEnd(14)} ${counts.join(' ')} used pens`);
}

const variants = {
    image: [{ mode: 'hatch' }, { mode: 'squiggle', join: true }, { mode: 'squiggle', join: false }, { mode: 'tsp', points: 800 }, { mode: 'tsp', points: 5000, budget: 0 }],
    whirl: [{ layout: 'single', style: 'spiral' }, { layout: 'single', style: 'nested' }],
    truchet: [{ type: 'triangles', otherHalf: true }, { type: 'triangles', otherHalf: false }],
    islamic: [{ showTiling: true, theta2: 35 }],
    penrose: [{ decor: 'hatch' }, { decor: 'nested' }, { decor: 'none' }],
    hyperbolic: [{ style: 'edges' }, { style: 'checker' }, { style: 'nested' }],
    phyllotaxis: [{ style: 'dots' }, { style: 'both' }, { style: 'spirals', para: 'pair' }],
    fieldlines: [{ kind: 'magnetic' }, { kind: 'electric', equip: false }],
    maze: [{ shape: 'circle' }, { solution: false }],
    apollonian: [{ penMode: 'random', style: 'mixed' }],
    circlepack: [{ penMode: 'random', style: 'mixed' }],
    voronoi: [{ penMode: 'random', style: 'mixed' }],
};
for (const [id, cases] of Object.entries(variants)) {
    if (only.length && !only.includes(id)) continue;
    const def = PG.byId[id];
    for (const variant of cases) {
        const params = { ...PG.defaultParams(def), ...variant };
        const one = generate(def, { ...params, pens: 1 }), eight = generate(def, { ...params, pens: 8 });
        sameInk(ink(one), ink(eight), `${id}, ${JSON.stringify(variant)}`);
        assert.ok(eight.length > 1 && eight.length <= 8, `${id}: alternate mode supports colors`);
    }
}

for (const id of ['harbour', 'fairground', 'alpine']) {
    for (const [inks, pens] of [['one', 1], ['three', 3], ['four', 4], ['six', 6], ['eight', 8]]) {
        assert.equal(PG.pens.migrate(PG.byId[id], { inks }).pens, pens);
    }
}
assert.equal(PG.pens.migrate(PG.byId.penrose, { split: false }).pens, 1);
assert.equal(PG.pens.migrate(PG.byId.hyperbolic, { split: true }).pens, 2);
assert.equal(PG.pens.migrate(PG.byId.moire, { separate: false }).pens, 1);
assert.equal(PG.pens.migrate(PG.byId.harbour, { inks: 'eight', pens: 2 }).pens, 2);

// A two-point stroke must also use all eight inks without gaps or overdraw.
const line = [[[0, 0], [80, 0]]];
const split = PG.pens.sequence(line, 8).layers;
assert.equal(split.filter(paths => paths.length).length, 8);
sameInk(ink([{ paths: line }]), ink(split.map(paths => ({ paths }))), 'two-point sequence');
console.log('Pen controls, geometry, determinism and legacy settings OK');
