// UI smoke test for scripts/drive.js:  node scripts/drive.js scripts/smoke.steps.js shots
// Loads the app, visits every design, exercises exports, undo, simulation and the gallery.

await open('index.html');
await sleep(600);
await evaluate(`localStorage.clear()`);
await open('index.html');
await sleep(600);
await shot('01-app.png');

// Capture downloads instead of saving them.
await evaluate(`
    window.__downloads = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = b => { window.__downloads.push({ type: b.type, size: b.size, blob: b }); return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__downloads[window.__downloads.length - 1].name = this.download; };
`);

const ids = await evaluate(`PG.generators.map(g => g.id)`);
log(`${ids.length} designs:`, ids.join(', '));
const slow = [];
for (const id of ids) {
    await evaluate(`plotterApp.select(${JSON.stringify(id)})`);
    await sleep(40);
    const info = await evaluate(`(() => { plotterApp.regenerate(); const r = plotterApp.result; return r ? { paths: r.stats.paths, ms: Math.round(r.timing.total) } : null; })()`);
    if (!info || !info.paths) throw new Error(`${id} produced nothing`);
    if (info.ms > 400) slow.push(`${id} ${info.ms}ms`);
}
log('all designs render', slow.length ? `(slow: ${slow.join(', ')})` : '');

await evaluate(`plotterApp.select('spirograph')`);
await sleep(100);
for (const kind of ['svg', 'json', 'png']) {
    await evaluate(`plotterApp.exportAs(${JSON.stringify(kind)})`);
}
await sleep(800);
const dls = await evaluate(`window.__downloads.map(d => d.name + ' ' + d.size)`);
log('downloads:', dls.join(' | '));
const svg = await evaluate(`window.__downloads[0].blob.text()`);
if (!svg.includes('width="210mm"') || !svg.includes('inkscape:groupmode="layer"')) throw new Error('SVG missing mm size or layers');

// Slider edits must stick across regenerations
const slide = v => evaluate(`(() => {
    const r = document.querySelector('[data-param="R"] input[type=range]');
    r.value = ${v};
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
for (const v of [80, 70, 110]) {
    await slide(v);
    await sleep(250);
    const got = await evaluate(`[plotterApp.state.params.spirograph.R, plotterApp.result && plotterApp.result.stats.points]`);
    if (got[0] !== v) throw new Error(`slider value lost: wanted ${v}, state has ${got[0]}`);
}
log('slider edits ok');

// Randomize, undo, redo
const before = await evaluate(`JSON.stringify(plotterApp.state.params.spirograph) + plotterApp.state.seed`);
await key('r');
await sleep(500);
const after = await evaluate(`JSON.stringify(plotterApp.state.params.spirograph) + plotterApp.state.seed`);
if (before === after) throw new Error('randomize did nothing');
await key('z', { ctrl: true });
await sleep(400);
const undone = await evaluate(`JSON.stringify(plotterApp.state.params.spirograph) + plotterApp.state.seed`);
if (undone !== before) throw new Error('undo did not restore');
await key('z', { ctrl: true, shift: true });
await sleep(400);
const redone = await evaluate(`JSON.stringify(plotterApp.state.params.spirograph) + plotterApp.state.seed`);
if (redone !== after) throw new Error('redo did not re-apply');
log('randomize / undo / redo ok');

// Zoom + pan, then the plot simulation
await wheel(700, 450, -400);
await drag(700, 450, 640, 420);
await key('p');
await sleep(1500);
const simInfo = await evaluate(`({ active: plotterApp.sim.active, elapsed: plotterApp.sim.elapsed })`);
if (!simInfo.active || !(simInfo.elapsed > 0)) throw new Error('simulation did not run');
await shot('02-sim.png');
await key('f');
await key('p');

// Gallery
await click('#designBtn');
await sleep(4000);
await shot('03-gallery.png');
await key('Escape', { code: 'Escape' });

// Output panel with every section open
await evaluate(`document.querySelectorAll('.out-section').forEach(d => d.open = true)`);
await sleep(200);
await shot('04-output.png');
log('smoke test finished');
