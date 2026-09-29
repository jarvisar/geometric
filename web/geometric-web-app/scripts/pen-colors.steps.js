// node scripts/drive.js scripts/pen-colors.steps.js shots
await open('index.html');
await sleep(500);
const ids = await evaluate('PG.generators.map(g => g.id)');
for (const id of ids) {
    await evaluate(`plotterApp.select(${JSON.stringify(id)})`);
    await sleep(60);
    for (const count of [1, 8]) {
        const info = await evaluate(`(() => {
            const slider = document.querySelector('[data-param="pens"] input[type="range"]');
            if (!slider || slider.max !== '8') throw new Error('Missing eight-pen control');
            slider.value = ${count};
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            plotterApp.regenerate();
            return { pens: plotterApp.state.params[${JSON.stringify(id)}].pens,
                used: plotterApp.result.layers.filter(l => l.paths.length).length };
        })()`);
        if (info.pens !== count || info.used !== count) throw new Error(`${id}: ${JSON.stringify(info)}`);
    }
}
log('All 34 browser controls render one and eight colors');

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

await evaluate(`
    window.__downloads = [];
    URL.createObjectURL = blob => { window.__downloads.push(blob); return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const svg = await evaluate('window.__downloads[0].text()');
for (const color of ['#161616', '#8b5a2b', '#1d8a4e', '#2456c8']) {
    if (!svg.includes(color)) throw new Error(`Missing town ink ${color} in SVG`);
}
log('Town default palette, semantic legend and SVG colors OK');
