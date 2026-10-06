const assert = (condition, message) => { if (!condition) throw new Error(message); };
const until = async expression => {
    for (let i = 0; i < 300; i++) {
        if (await evaluate(expression)) return;
        await sleep(50);
    }
    throw new Error('Timed out: ' + expression);
};
await open('index.html');
await until(`!!plotterApp.result && document.querySelector('#busy').hidden`);
await evaluate(`
    window.__files = [];
    window.__blobs = new Map();
    window.__createURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
        const url = __createURL(blob);
        __blobs.set(url, blob);
        return url;
    };
    HTMLAnchorElement.prototype.click = function () {
        if (this.download) __files.push({ name: this.download, blob: __blobs.get(this.href) });
    };
    plotterApp.resetAll();
    plotterApp.select('flower', { pens: 3 });
`);
await until(`plotterApp.result?.gen === 'flower' && document.querySelector('#busy').hidden`);
const types = { svg: 'image/svg+xml', pdf: 'application/pdf', dxf: 'image/vnd.dxf', eps: 'application/postscript' };
for (const [format, mime] of Object.entries(types)) {
    await evaluate(`__files.length = 0`);
    await click('#exportMenuBtn');
    await click(`[data-export="${format}"]`);
    await until(`__files.length === 1`);
    const file = await evaluate(`({ name: __files[0].name, type: __files[0].blob.type, size: __files[0].blob.size })`);
    assert(file.name.endsWith('.' + format) && file.type === mime && file.size > 100, `Bad ${format} download`);
    assert(await evaluate(`document.querySelector('#exportMenu').hidden`), 'menu stays open');
    log('PASS download', format, file.size, 'bytes');
}

// Hiding a pen filters the geometry before all four exporters run.
await evaluate(`plotterApp.state.pens[1].visible = false; window.__originalExporters = { ...PG.exporters }; window.__seenPens = [];
    for (const kind of ['svg', 'pdf', 'eps', 'dxf']) {
        PG.exporters[kind] = (...args) => { __seenPens.push(args[0].layers.map(l => l.pen)); return __originalExporters[kind](...args); };
    }
`);
for (const kind of Object.keys(types)) await evaluate(`plotterApp.exportAs('${kind}')`);
assert(await evaluate(`__seenPens.length === 4 && __seenPens.every(p => p.length === 2 && !p.includes(1))`), 'hidden pen was exported');
log('PASS hidden pens in every vector format');

// Exports capture their own geometry if the controls changed before preview completion.
await evaluate(`Object.assign(PG.exporters, __originalExporters); window.__captured = null;
    PG.exporters.pdf = (...args) => { __captured = args; return __originalExporters.pdf(...args); };
    plotterApp.state.paper.w = 215.9;
    plotterApp.state.paper.h = 279.4;
    plotterApp.state.seed = 456;
    plotterApp.state.params.flower.layers = 9;
    window.__exportJob = plotterApp.exportAs('pdf');
    plotterApp.state.seed = 789;
`);
await evaluate(`__exportJob`);
assert(await evaluate(`__captured[1].w === 215.9 && __captured[1].h === 279.4 && __captured[3].title.includes('456')`), 'export mixed pending and later settings');
const matches = await evaluate(`(() => {
    const recipe = JSON.parse(__captured[3].description.slice('plotter-geometry:'.length));
    const r = PG.run(PG.byId.flower, recipe.params.flower, { seed: recipe.seed, paperW: recipe.paper.w, paperH: recipe.paper.h,
        margin: recipe.paper.margin, ...recipe.comp, opt: recipe.opt });
    const visible = r.layers.filter(l => recipe.pens[l.pen].visible);
    return JSON.stringify(visible) === JSON.stringify(__captured[0].layers);
})()`);
assert(matches, 'pending export used stale geometry');
log('PASS export during regeneration and subsequent edits');

await evaluate(`Object.assign(PG.exporters, __originalExporters); __files.length = 0; plotterApp.state.pens.forEach(p => p.visible = false)`);
for (const kind of ['pdf', 'dxf', 'eps']) await evaluate(`plotterApp.exportAs('${kind}')`);
assert(await evaluate(`__files.length === 0 && [...document.querySelectorAll('.toast')].some(t => t.textContent === 'Nothing to export')`), 'all-hidden export');
await evaluate(`plotterApp.state.pens.forEach(p => p.visible = true); PG.exporters.pdf = () => { throw new Error('Export test failure'); }`);
await evaluate(`plotterApp.exportAs('pdf')`);
assert(await evaluate(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Could not export: Export test failure'))`), 'export failures are not shown: ' + await evaluate(`document.querySelector('#toasts').textContent`));
await evaluate(`Object.assign(PG.exporters, __originalExporters); document.querySelector('#toasts').replaceChildren()`);
log('PASS empty drawing and export error handling');

await protocol('Emulation.setDeviceMetricsOverride', { width: 390, height: 600, deviceScaleFactor: 1, mobile: true });
await click('#exportMenuBtn');
assert(await evaluate(`(() => { const r = document.querySelector('#exportMenu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`), 'mobile export menu overflows');
await shot('export-menu-mobile.png');
log('PASS mobile export menu');
await protocol('Emulation.setDeviceMetricsOverride', { width: 700, height: 320, deviceScaleFactor: 1, mobile: true });
assert(await evaluate(`(() => { const e = document.querySelector('#exportMenu'); const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && e.scrollHeight > e.clientHeight; })()`), 'short-screen menu does not scroll');
log('PASS short-screen menu scrolling');
