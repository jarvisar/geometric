#!/usr/bin/env node
/*
 * Headless sanity check: runs every generator through the full pipeline with
 * default and randomised parameters, and exercises the exporters.
 *
 *   node scripts/check.js            # all generators
 *   node scripts/check.js truchet    # just some
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', 'src');
// Run in this context (a vm sandbox makes global lookups several times slower and skews timings).
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
['lib/core.js', 'lib/noise.js', 'lib/contours.js', 'lib/optimize.js', 'lib/pipeline.js', 'lib/export.js', 'lib/loader.js'].forEach(load);

const PG = globalThis.PG;
const only = process.argv.slice(2);
for (const name of PG.GENERATOR_FILES) {
    if (only.length && !only.includes(name)) continue;
    const f = `generators/${name}.js`;
    if (!fs.existsSync(path.join(SRC, f))) { console.log(`- ${name}: (missing file)`); continue; }
    load(f);
}

const settings = seed => ({
    seed, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 },
});

let failures = 0;
const rows = [];
for (const def of PG.generators) {
    const runs = [['default', PG.defaultParams(def), settings(1)]];
    for (let i = 0; i < 6; i++) {
        runs.push([`random${i}`, PG.randomParams(def, PG.defaultParams(def), new PG.RNG(100 + i)), settings(7 + i)]);
    }
    runs.push(['rotated+circle', PG.defaultParams(def), Object.assign(settings(3), { rotate: 30, clip: 'circle', frame: true })]);
    const times = [];
    rows.push(`${def.id.padEnd(14)} (default failed)`);
    for (const [label, params, S] of runs) {
        try {
            const res = PG.run(def, params, S);
            const st = res.stats;
            if (!st.paths) throw new Error('no paths produced');
            for (const l of res.layers) for (const p of l.paths) for (const q of p) {
                if (!isFinite(q[0]) || !isFinite(q[1])) throw new Error('non-finite point');
                if (q[0] < S.margin - 1e-6 || q[1] < S.margin - 1e-6 || q[0] > S.paperW - S.margin + 1e-6 || q[1] > S.paperH - S.margin + 1e-6) {
                    throw new Error(`point outside drawing area: ${q}`);
                }
            }
            times.push(res.timing.total);
            if (label === 'default') {
                PG.exporters.svg(res, { w: 210, h: 297 }, [], { title: def.name });
                rows[rows.length - 1] = (`${def.id.padEnd(14)} ${String(Math.round(res.timing.generate)).padStart(5)}ms gen ${String(Math.round(res.timing.optimize)).padStart(5)}ms opt ` +
                    `${String(st.paths).padStart(6)} paths ${String(st.points).padStart(7)} pts ${(st.draw / 1000).toFixed(1).padStart(6)} m draw ${(st.travel / 1000).toFixed(1).padStart(5)} m travel (raw ${(res.rawStats.travel / 1000).toFixed(1)} m)`);
            }
        } catch (e) {
            failures++;
            console.log(`FAIL ${def.id} [${label}] ${e.stack || e}\n  params: ${JSON.stringify(params)}`);
        }
    }
    if (times.length) rows[rows.length - 1] += `  | worst ${Math.round(Math.max(...times))}ms`;
}
console.log(rows.join('\n'));
console.log(failures ? `\n${failures} failure(s)` : '\nAll generators OK');
process.exit(failures ? 1 : 0);
