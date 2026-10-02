#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export', 'loader'].forEach(n => load(`lib/${n}.js`));
load('generators/spirograph.js');
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let failures = 0, cases = 0;
for (const type of ['hypo', 'epi']) for (const teeth of [24, 96, 120]) for (const pens of [1, 8]) {
    const label = `spirograph ${type}, R=r=${teeth}, ${pens} pens`;
    try {
        const params = { ...PG.defaultParams(PG.byId.spirograph), type, R: teeth, r: teeth, pens };
        const result = PG.run(PG.byId.spirograph, params, settings);
        assert.ok(result.stats.paths > 0, 'equal gear counts should produce geometry');
        for (const l of result.layers) for (const p of l.paths) for (const [x, y] of p) {
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
            assert.ok(x >= 15 - 1e-6 && x <= 195 + 1e-6 && y >= 15 - 1e-6 && y <= 282 + 1e-6);
        }
        const svg = PG.exporters.svg(result, { w: 210, h: 297 }, []);
        assert.ok(svg.includes('<path ') && !/NaN|Infinity/.test(svg));
        console.log(`PASS ${label}`);
    } catch (err) {
        failures++;
        console.error(`FAIL ${label}: ${err.message}`);
    }
    cases++;
}
console.log(`${cases} equal-gear cases, ${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;
