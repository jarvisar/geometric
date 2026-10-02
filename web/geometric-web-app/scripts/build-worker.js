/* A self-contained Blob worker also works when index.html is opened from disk. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = path.resolve(__dirname, '../src');
const registry = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(src, 'lib/loader.js'), 'utf8'), registry);
const files = ['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline'].map(n => `lib/${n}.js`)
    .concat(registry.PG.GENERATOR_FILES.map(n => `generators/${n}.js`));
const source = files.map(f => fs.readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n')).join('\n') + `
self.onmessage = ({ data: job }) => {
    try {
        const result = PG.packResult(PG.run(PG.byId[job.gen], job.params, job.settings, { images: job.images, motion: job.motion }));
        self.postMessage({ result }, PG.transferList(result));
    } catch (err) { self.postMessage({ error: err.message }); }
};
`;
const output = '// Built by scripts/build-worker.js. Edit the source libraries and generators.\nPG.workerSource = ' + JSON.stringify(source) + ';\n';
const target = path.join(src, 'lib/worker-source.js');
if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
        throw new Error('Worker bundle is stale. Run npm run build:worker.');
    }
    console.log('Worker bundle matches all source files');
} else {
    fs.writeFileSync(target, output);
    console.log('Built worker bundle');
}
