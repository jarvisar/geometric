// node scripts/drive.js scripts/pen-colors.steps.js shots
await open('index.html');
await sleep(500);
const ids = await evaluate('PG.generators.map(g => g.id)');
for (const id of ids) {
    await evaluate(`plotterApp.select(${JSON.stringify(id)})`);
    await sleep(60);
    if (!await evaluate(`document.querySelectorAll('#params [data-param-section="Pens"]').length===1 &&
        document.querySelector('#params details').dataset.paramSection==='Pens' &&
        document.querySelectorAll('#params [data-param]').length===PG.byId[${JSON.stringify(id)}].params.filter(q=>q.id).length`)) {
        throw new Error(`${id}: parameter sections lost or duplicated controls`);
    }
    for (const count of [1, 8]) {
        const info = await evaluate(`(async () => {
            const slider = document.querySelector('[data-param="pens"] input[type="range"]');
            if (!slider || slider.max !== '8') throw new Error('Missing eight-pen control');
            slider.value = ${count};
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            await plotterApp.regenerate();
            return { pens: plotterApp.state.params[${JSON.stringify(id)}].pens,
                used: plotterApp.result.layers.filter(l => l.paths.length).length };
        })()`);
        if (info.pens !== count || info.used !== count) throw new Error(`${id}: ${JSON.stringify(info)}`);
    }
}
log(`All ${ids.length} browser controls render one and eight colors`);

await evaluate(`plotterApp.select('town')`);
await click('#resetMenuBtn');
await click('[data-reset="params"]');
await sleep(300);
await click('[data-tab="output"]');
await sleep(100);
const town = await evaluate(`({ pens: plotterApp.state.params.town.pens,
    legend: document.querySelector('#penList').textContent,
    hint: document.querySelector('#penAssignmentHint').textContent })`);
if (town.pens !== 4 || !town.legend.includes('Streets') || !town.hint.includes('green plants')) {
    throw new Error(`Town defaults or legend missing: ${JSON.stringify(town)}`);
}
await shot('town-color-default.png');

await evaluate(`(async () => {
    window.__downloads = [];
    URL.createObjectURL = blob => { window.__downloads.push(blob); return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
    await plotterApp.exportAs('svg');
})()`);
const svg = await evaluate('window.__downloads[0].text()');
for (const color of ['#161616', '#8b5a2b', '#1d8a4e', '#2456c8']) {
    if (!svg.includes(color)) throw new Error(`Missing town ink ${color} in SVG`);
}
log('Town default palette, semantic legend and SVG colors OK');

// Scenes list their parts under the pen that draws them, and each one can be moved to another pen
const until = async (expr, message) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(50); }
    throw new Error(message);
};
const drawn = () => until(`!!plotterApp.result && document.querySelector('#busy').hidden`, 'generation did not finish');
const pick = (part, pen) => evaluate(`(() => { const s = document.querySelector('#penList .part[data-part="${part}"] select');
    s.value = '${pen}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const setPens = n => evaluate(`(() => { const s = document.querySelector('[data-param="pens"] input[type="range"]'); s.value = ${n};
    s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const under = () => evaluate(`[...document.querySelectorAll('#penList .pen-row[data-pen]')].map(r =>
    [...r.querySelectorAll('.part > span')].map(s => s.textContent).join('|')).join(';')`);
const expect = async (expr, message) => { if (!await evaluate(expr)) throw new Error(message); };
const layers = () => evaluate(`plotterApp.result.layers.map(l => l.pen).join()`);

await evaluate(`plotterApp.select('castle'); plotterApp.resetParams()`);
await drawn();
const start = await under();
if (start !== 'Masonry & buildings|People & horses|Timber & tracks;Roofs & banners;Shadows|Moat;Trees & fields;Awnings & heraldry;;;') {
    throw new Error(`Castle parts are not under their default pens: ${start}`);
}
await expect(`document.querySelector('#partsMoved').hidden && document.querySelector('#penAssignmentHint').textContent.includes('move it to another pen')`,
    'parts hint missing or reset shown too early');

await pick(1, 6);
await until(`plotterApp.result.layers.some(l => l.pen === 6)`, 'moved part was not redrawn');
if (await layers() !== '0,2,3,4,6' || (await under()).split(';')[6] !== 'Roofs & banners') throw new Error(`Roofs did not move to pen 7: ${await layers()} ${await under()}`);
await expect(`JSON.stringify(plotterApp.state.params.castle.penMap) === '{"1":6}' && !document.querySelector('#partsMoved').hidden &&
    document.querySelector('#partsMoved p').textContent.startsWith('1 part moved') &&
    document.querySelector('#penList .part[data-part="1"]').classList.contains('moved') &&
    document.querySelectorAll('#penList .part.moved').length === 1 &&
    document.querySelector('#penList .pen-row[data-pen="1"] .pen-count').textContent === 'nothing on this pen'`, 'moved part is not saved or not marked');
await shot('castle-part-moved.png');

await evaluate(`plotterApp.exportAs('svg')`);
await until(`window.__downloads.length === 2`, 'SVG did not export');
const movedSvg = await evaluate('window.__downloads[1].text()');
if (movedSvg.includes('id="layer2"') || !movedSvg.includes('id="layer7"')) throw new Error('SVG layers ignore the moved part');

// It stays on its pen at any pen count, next to whatever the count puts there
await setPens(8);
await until(`plotterApp.result.layers.length === 7`, 'pen count did not redraw');
if ((await under()).split(';')[6] !== 'Roofs & banners|Moat' || (await under()).split(';')[1] !== '') throw new Error(`Moved part did not keep its pen at 8 pens: ${await under()}`);
await setPens(1);
await until(`plotterApp.result.layers.length === 2`, 'pen count did not redraw');
if (await layers() !== '0,6') throw new Error(`Moved part did not keep its pen at 1 pen: ${await layers()}`);
await setPens(5);
await until(`plotterApp.result.layers.length === 5`, 'pen count did not redraw');

// A share link carries it
await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__link = text; } } }); plotterApp.exportAs('link')`);
await until(`!!window.__link`, 'share link was not copied');
const link = await evaluate('window.__link');

// Back on its default pen it's no longer moved, and undo brings the move back
await sleep(400);
await pick(1, 1);
await until(`plotterApp.result.layers.some(l => l.pen === 1)`, 'part did not move back');
await expect(`plotterApp.state.params.castle.penMap === undefined && document.querySelector('#partsMoved').hidden`, 'a part back on its default pen is still marked as moved');
if (await under() !== start) throw new Error(`Parts are not back where they started: ${await under()}`);
await sleep(400);
await evaluate(`plotterApp.undo()`);
await until(`plotterApp.result.layers.some(l => l.pen === 6)`, 'undo did not redraw');
await expect(`JSON.stringify(plotterApp.state.params.castle.penMap) === '{"1":6}' && !document.querySelector('#partsMoved').hidden`, 'undo lost the moved part');
if ((await under()).split(';')[6] !== 'Roofs & banners') throw new Error('undo did not put the part back under its pen');
await evaluate(`plotterApp.redo()`);
await until(`plotterApp.result.layers.some(l => l.pen === 1)`, 'redo did not redraw');
await expect(`plotterApp.state.params.castle.penMap === undefined`, 'redo kept the moved part');

// a link opened on the page it came from is only a hash change, which the app doesn't reload for
await open('about:blank');
await open(link);
await drawn();
await expect(`plotterApp.state.gen === 'castle' && JSON.stringify(plotterApp.state.params.castle.penMap) === '{"1":6}'`, 'share link lost the moved part');
await click('[data-tab="output"]');
if ((await under()).split(';')[6] !== 'Roofs & banners') throw new Error('moved part not shown after opening a share link');

// Reset puts every part back
await pick(5, 3);
await pick(7, 3);
await expect(`document.querySelector('#partsMoved p').textContent.startsWith('3 parts moved')`, 'moved count is wrong');
await click('#partsReset');
await until(`plotterApp.result.layers.some(l => l.pen === 1)`, 'reset did not redraw');
await expect(`plotterApp.state.params.castle.penMap === undefined && document.querySelector('#partsMoved').hidden`, 'Reset left parts moved');
if (await under() !== start) throw new Error(`Reset left parts moved: ${await under()}`);

// Options that add or rename a part
await evaluate(`plotterApp.select('megastructure'); plotterApp.resetParams()`);
await drawn();
await expect(`document.querySelectorAll('#penList .part').length === 8`, 'Megastructure should list 8 parts');
await evaluate(`(() => { const s = document.querySelector('[data-param="shade"] select'); s.value = 'left'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await setPens(3);
if ((await under()).split(';')[1] !== 'Hatching') throw new Error(`Hatching is not listed on the second pen: ${await under()}`);
await evaluate(`plotterApp.resetParams(); plotterApp.select('moonbase'); plotterApp.resetParams()`);
await expect(`document.querySelector('#penList').textContent.includes('Regolith & tracks')`, 'Moon Base parts missing');
await evaluate(`(() => { const s = document.querySelector('[data-param="world"] select'); s.value = 'mars'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await expect(`document.querySelector('#penList').textContent.includes('Dust, dunes & tracks')`, 'Mars did not rename its ground');
await evaluate(`plotterApp.resetParams()`);

// Other designs have nothing to move
await evaluate(`plotterApp.select('spirograph')`);
await drawn();
await expect(`!document.querySelector('#penList .part') && document.querySelector('#partsMoved').hidden &&
    !document.querySelector('#penAssignmentHint').textContent.includes('another pen') &&
    document.querySelector('#penList').textContent.includes('Color 1')`, 'a design without parts shows some');
log('Scene parts move between pens, keep them at any pen count and through undo, share links and export, and reset');
