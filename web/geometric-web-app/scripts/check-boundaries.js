#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'loader'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(id => load(`generators/${id}.js`));
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let cases = 0, failures = 0;
for (const def of PG.generators) {
    const defaults = PG.defaultParams(def);
    const variations = [];
    for (const q of def.params) {
        const values = q.type === 'range' ? [q.min, q.max]
            : q.type === 'select' ? q.options.map(o => o[0])
            : q.type === 'checkbox' ? [!q.value] : [];
        for (const value of values) if (value !== defaults[q.id]) {
            variations.push([`${q.id}=${value}`, { ...defaults, [q.id]: value }]);
        }
    }
    // Curated randomize avoids many difficult combinations. Exercise permitted endpoints together too.
    for (let i = 0; i < 6; i++) {
        const params = { ...defaults }, rng = new PG.RNG(1000 + i);
        for (const q of def.params) {
            if (q.type === 'range') params[q.id] = i === 0 ? q.min : i === 1 ? q.max : rng.pick([q.min, q.max, q.value]);
            else if (q.type === 'select') params[q.id] = rng.pick(q.options.map(o => o[0]));
            else if (q.type === 'checkbox') params[q.id] = rng.chance(0.5);
        }
        variations.push([`combined endpoints ${i}`, params]);
    }
    let worst = 0;
    for (const [label, params] of variations) {
        cases++;
        try {
            const result = PG.run(def, params, settings);
            assert.ok(result.stats.paths > 0, 'no paths');
            for (const layer of result.layers) {
                assert.ok(Number.isInteger(layer.pen) && layer.pen >= 0 && layer.pen < PG.MAX_PENS, 'invalid pen');
                for (const line of layer.paths) for (const [x, y] of line) {
                    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'non-finite point');
                    assert.ok(x >= 15 - 1e-6 && x <= 195 + 1e-6 && y >= 15 - 1e-6 && y <= 282 + 1e-6, 'point outside margins');
                }
            }
            worst = Math.max(worst, result.timing.total);
        } catch (err) {
            failures++;
            console.error(`FAIL ${def.id} [${label}]: ${err.message}\n  ${JSON.stringify(params)}`);
        }
    }
    console.log(`${def.id}: ${variations.length} cases, worst ${Math.round(worst)} ms`);
}
console.log(`${cases} boundary and interaction cases, ${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;
