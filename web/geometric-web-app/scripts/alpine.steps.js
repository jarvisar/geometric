const assert = (ok, message) => { if (!ok) throw new Error(message); };
const ready = async () => {
    for (let i = 0; i < 400; i++) {
        if (await evaluate(`!!plotterApp.result && document.querySelector('#busy').hidden`)) return;
        await sleep(50);
    }
    throw new Error('Alpine generation did not finish');
};
await open('index.html');
await ready();
await evaluate(`plotterApp.resetAll(); plotterApp.select('alpine');`);
await ready();
const setup = async () => evaluate(`
    window.__set = (id, value) => {
        const row = document.querySelector('[data-param="' + id + '"]');
        const input = row.querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    window.__hash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`plotterApp.state.params.alpine.framing === 'close' &&
    document.querySelector('[data-param="base"]').hidden && document.querySelector('[data-param="contour"]').hidden`), 'incorrect Alpine defaults or dependent controls');
const initial = await evaluate('__hash()');
await shot('alpine-app.png');

await evaluate(`__set('framing', 'whole'); __set('cutaway', true); __set('contours', true);`);
await ready();
assert(await evaluate(`!document.querySelector('[data-param="base"]').hidden && !document.querySelector('[data-param="contour"]').hidden`), 'cutaway/contour controls did not appear');
assert(await evaluate('__hash()') !== initial, 'Alpine controls did not change geometry');
const cutaway = await evaluate('__hash()');
await shot('alpine-cutaway.png');
await sleep(600);
await open('index.html'); await ready(); await setup();
assert(await evaluate('__hash()') === cutaway, 'Alpine geometry changed after reload');
assert(await evaluate(`plotterApp.state.params.alpine.framing === 'whole' && plotterApp.state.params.alpine.cutaway && plotterApp.state.params.alpine.contours`), 'new settings did not persist');

await evaluate(`plotterApp.resetParams()`); await ready();
assert(await evaluate('__hash()') === initial, 'reset did not restore Alpine default geometry');
for (const pens of [1, 4, 8]) {
    await evaluate(`__set('pens', ${pens})`); await ready();
    assert(await evaluate('plotterApp.result.layers.filter(l => l.paths.length).length') === pens, `expected ${pens} used pens`);
    await shot(`alpine-${pens}-pens.png`);
}
await evaluate(`
    window.__downloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __downloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
`);
await evaluate(`plotterApp.exportAs('svg')`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __downloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        finite: !/NaN|Infinity/.test(doc.documentElement.outerHTML), hasRecipe: doc.querySelector('desc').textContent.includes('"alpine"') };
})()`);
assert(exported.valid && exported.finite && exported.layers === 8 && exported.hasRecipe, `invalid Alpine SVG: ${JSON.stringify(exported)}`);
await evaluate(`__set('pens', 4)`); await ready();
await click('[data-tab="output"]');
assert(await evaluate(`document.querySelector('#penAssignmentHint').textContent.includes('red roofs') && document.querySelector('#penList').textContent.includes('Architecture')`), 'Alpine pen descriptions are stale');
log('Alpine browser controls, worker rendering, reload, reset, 1/4/8 pens and layered SVG export passed');
