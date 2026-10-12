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

// Designs with named parts let each one be moved to another pen. A moved part keeps its
// pen at every pen count, and moving parts never adds or drops a line.
const parted = [...PG.generators.map(def => [def, {}]), [PG.byId.moonbase, { world: 'mars' }], [PG.byId.megastructure, { shade: 'left' }]]
    .filter(([def]) => PG.pens.hasParts(def) && (!only.length || only.includes(def.id)));
for (const [def, variant] of parted) {
    const defaults = { ...PG.defaultParams(def), ...variant };
    const label = `${def.id}${Object.keys(variant).length ? ' ' + JSON.stringify(variant) : ''}`;
    const reference = ink(generate(def, { ...defaults, pens: 1 }));
    const count = PG.pens.parts(def, defaults).length;
    assert.ok(count > 1 && count <= PG.pens.MAX_PARTS, `${label}: part count`);
    assert.equal(new Set(PG.pens.parts(def, defaults).map(q => q.name)).size, count, `${label}: part names must differ`);
    for (let pens = 1; pens <= 8; pens++) {
        const plain = PG.pens.parts(def, { ...defaults, pens });
        assert.ok(plain.every(q => q.pen === q.default), `${label}: nothing is moved by default`);
        // every part on the last pen
        const all = Object.fromEntries(plain.map(q => [q.part, 7]));
        const single = generate(def, { ...defaults, pens, penMap: all });
        assert.deepEqual(single.map(l => l.pen), [7], `${label}: all parts moved to pen 8 at ${pens} pens`);
        sameInk(reference, ink(single), `${label}, all parts on one pen at ${pens} pens`);
        // one part moved, the rest left where the pen count puts them
        for (const q of plain) {
            const to = (q.default + 3) % 8, params = { ...defaults, pens, penMap: { [q.part]: to } };
            const now = PG.pens.parts(def, params);
            assert.equal(now[q.part].pen, to, `${label}: ${q.name} moved`);
            assert.ok(now.every(r => r.part === q.part || r.pen === r.default), `${label}: moving ${q.name} moved something else`);
            assert.ok(PG.pens.roles(def, params)[to].includes(q.name), `${label}: legend misses ${q.name}`);
            if (pens !== 5) continue;
            const before = generate(def, { ...defaults, pens }), after = generate(def, params);
            sameInk(reference, ink(after), `${label}, ${q.name} moved`);
            // pens that neither gave nor took the part are untouched
            for (const layer of before) {
                if (layer.pen !== q.default && layer.pen !== to) assert.deepEqual(after.find(l => l.pen === layer.pen), layer, `${label}: moving ${q.name} changed pen ${layer.pen + 1}`);
            }
        }
    }
    // A map with junk in it is ignored instead of sending lines to a pen that isn't there
    const junk = generate(def, { ...defaults, penMap: { 0: 9, 1: -1, 2: 1.5, 3: '2', 99: 1 } });
    assert.deepEqual(junk, generate(def, defaults), `${label}: bad moves must be ignored`);
    console.log(`${label.padEnd(28)} ${count} parts can be moved`);
}
assert.ok(parted.length >= 13, 'scenes lost their parts');
assert.equal(PG.pens.parts(PG.byId.spirograph, PG.defaultParams(PG.byId.spirograph)), null);

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
