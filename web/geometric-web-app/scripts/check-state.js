#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'settings', 'loader'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(n => load(`generators/${n}.js`));
const json = value => JSON.parse(JSON.stringify(value));
const read = obj => PG.settings.read(obj);
const recipe = { app: 'plotter-geometry', v: 2, gen: 'spirograph', seed: 0 };

const invalid = [
    null, [], {}, { ...recipe, v: 3 }, { ...recipe, app: 'other' },
    ...['__proto__', 'constructor', 'toString', 'missing'].map(gen => ({ ...recipe, gen })),
    ...[null, [], 'bad', 12].flatMap(value => ['paper', 'comp', 'params', 'opt', 'view'].map(key => ({ ...recipe, [key]: value }))),
    ...[null, [], [null], ['bad'], Array(9).fill({})].map(pens => ({ ...recipe, pens })),
    ...[-1, 1.5, 1e10, Infinity, NaN, '1', null].map(seed => ({ ...recipe, seed })),
    { ...recipe, paper: { w: 0 } }, { ...recipe, paper: { w: '210' } }, { ...recipe, paper: { landscape: 'false' } },
    { ...recipe, paper: { color: 'url(bad)' } }, { ...recipe, comp: { rows: 11 } }, { ...recipe, comp: { cols: 1.5 } },
    { ...recipe, opt: { simplifyTol: 100 } }, { ...recipe, pens: [{ width: -1 }] },
    { ...recipe, params: { spirograph: null } }, { ...recipe, params: { missing: {} } },
    { ...recipe, params: { spirograph: { R: 1e8 } } }, { ...recipe, params: { spirograph: { type: 'missing' } } },
    { ...recipe, params: { spirograph: { pens: null } } }, { ...recipe, locks: 'R' }, { ...recipe, locks: [null] },
];
for (const obj of invalid) assert.throws(() => read(obj), /Invalid settings/);
for (const key of ['__proto__', 'constructor', 'prototype']) {
    for (const at of ['paper', 'params', 'unused']) {
        const obj = JSON.parse(`{"gen":"spirograph","${at}":{"${key}":{"qaPolluted":true}}}`);
        assert.throws(() => read(obj), /Invalid settings/);
        assert.equal(({}).qaPolluted, undefined);
    }
}
const partial = read({ ...recipe, opt: { simplify: false }, pens: [{ visible: false }] });
assert.equal(partial.seed, 0);
assert.equal(partial.opt.simplify, false);
assert.equal(partial.opt.mergeTol, 0.1);
assert.equal(partial.pens[0].visible, false);
assert.equal(partial.pens[1].visible, true);
assert.equal(partial.params.spirograph.R, PG.defaultParams(PG.byId.spirograph).R);
assert.equal(read({ ...recipe, paper: { size: 'Letter', landscape: true } }).paper.w, 279.4);
assert.equal(read({ ...recipe, paper: { size: 'custom', w: 123.5, h: 321 } }).paper.h, 321);
const original = json(partial);
const restored = PG.settings.read(partial, true);
restored.paper.w = 500;
assert.deepEqual(partial, original, 'validation must not mutate its input');
assert.equal(read({ ...recipe, comp: { sweepId: 'missing' } }).comp.sweepId, '');
assert.deepEqual(read({ ...recipe, locks: ['R', 'removed', 'R'] }).locks.spirograph, ['R']);
assert.throws(() => PG.settings.read({ ...recipe, ui: { open: null } }, true), /Invalid settings/);

for (const gen of ['harbour', 'fairground', 'alpine']) for (const [inks, pens] of [['one', 1], ['four', 4], ['eight', 8]]) {
    assert.equal(read({ gen, v: 1, params: { [gen]: { inks } } }).params[gen].pens, pens);
}
assert.equal(read({ gen: 'penrose', params: { penrose: { split: true } } }).params.penrose.pens, 3);
assert.equal(read({ gen: 'hyperbolic', params: { hyperbolic: { split: false } } }).params.hyperbolic.pens, 1);
assert.equal(read({ gen: 'moire', params: { moire: { separate: true, sets: 3 } } }).params.moire.pens, 3);
assert.equal(read({ gen: 'harbour', params: { harbour: { inks: 'eight', pens: 2 } } }).params.harbour.pens, 2);

let count = 0;
for (const def of PG.generators) {
    const defaults = PG.defaultParams(def);
    for (let seed = 0; seed < 100; seed++) {
        const params = seed ? PG.randomParams(def, defaults, new PG.RNG(seed)) : defaults;
        const input = json({ ...recipe, gen: def.id, params: { [def.id]: params } });
        const output = read(input);
        assert.deepEqual(json(output.params[def.id]), json(params), `${def.id}: saved parameters changed`);
        assert.deepEqual(json(PG.settings.read(output, true)), json(output), `${def.id}: session round trip changed`);
        count++;
    }
}
console.log(`${count} default/random recipe and session round trips OK; invalid inputs and legacy pens OK`);

const def = { id: 'test-grid', params: [], generate: (p, ctx) => [[[0, 0], [ctx.width, ctx.height]]] };
let grids = 0;
for (const [paperW, paperH] of [[210, 297], [105, 148], [50, 50], [215.9, 279.4]]) {
    for (const margin of [0, 15, 80]) for (const [cols, rows] of [[1, 1], [1, 10], [8, 1], [8, 10]]) {
        for (const gutter of [0, 8, 40]) for (const clip of ['rect', 'circle', 'hexagon', 'diamond']) {
            const S = { paperW, paperH, margin, cols, rows, gutter, clip, seed: 1, frame: true, frameInset: 0.5,
                opt: { merge: true, simplify: true, sort: true } };
            const res = PG.run(def, {}, S);
            const { x, y, w, h } = res.area;
            assert.ok(res.stats.paths, 'grid should still draw');
            for (const pts of [...res.layers.flatMap(l => l.paths), ...res.outlines]) for (const [X, Y] of pts) {
                assert.ok(Number.isFinite(X) && Number.isFinite(Y));
                assert.ok(X >= x - 1e-6 && X <= x + w + 1e-6 && Y >= y - 1e-6 && Y <= y + h + 1e-6,
                    `grid escaped drawing area: ${JSON.stringify(S)}, ${X},${Y}`);
            }
            grids++;
        }
    }
}
console.log(`${grids} grid layouts stay inside the drawing area, including frames and all crops`);
