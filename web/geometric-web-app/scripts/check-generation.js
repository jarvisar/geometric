const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'loader', 'worker-source'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(n => load(`generators/${n}.js`));
const settings = { seed: 42, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
const worker = new Worker(`const {parentPort} = require('node:worker_threads');
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
${PG.workerSource}
parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
const run = job => new Promise((resolve, reject) => {
    const onError = err => { worker.off('message', onMessage); reject(err); };
    const onMessage = data => { worker.off('error', onError); data.error ? reject(new Error(data.error)) : resolve(data.result); };
    worker.once('error', onError);
    worker.once('message', onMessage);
    worker.postMessage(job);
});
(async () => {
    try {
        for (const def of PG.generators) {
            const params = PG.defaultParams(def);
            const result = PG.run(def, params, settings);
            const background = await run({ gen: def.id, params, settings, images: {} });
            assert.deepEqual(background.layers, result.layers, `${def.id}: worker changed geometry`);
            assert.deepEqual(background.stats, result.stats);
        }
        console.log(`All ${PG.generators.length} worker results match the synchronous pipeline`);
        const clock = globalThis.performance;
        try {
            for (const points of [500, 2500, 10000]) for (const budget of [0, 400]) {
                const outputs = [];
                for (const tick of [0.01, 100000]) {
                    load('generators/image.js'); // Cold tour cache on each run.
                    let now = 0;
                    globalThis.performance = { now: () => now += tick };
                    const params = { ...PG.defaultParams(PG.byId.image), mode: 'tsp', points, budget };
                    outputs.push(PG.run(PG.byId.image, params, settings).layers);
                }
                assert.deepEqual(outputs[0], outputs[1], `TSP changes with clock: ${points}/${budget}`);
            }
        } finally { globalThis.performance = clock; }
        console.log('Cold TSP output is identical with fast and slow clocks at 500, 2500 and 10000 points, including zero refinement');
    } finally { await worker.terminate(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
