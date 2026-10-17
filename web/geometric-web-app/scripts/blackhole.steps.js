const assert = (value, message) => { if (!value) throw new Error(message); };
const ready = async () => {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(`!!plotterApp.result && document.querySelector('#busy').hidden`)) return;
        await sleep(50);
    }
    throw new Error('Generation did not finish');
};
await open('index.html');
await ready();
await evaluate(`plotterApp.resetAll(); plotterApp.select('blackhole'); plotterApp.regenerate()`);
await ready();
const setup = () => evaluate(`
    window.__setBlackHole = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__blackHoleHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`plotterApp.result.gen === 'blackhole' && document.querySelector('#errorMsg').hidden`), 'Worker failed');
const initial = await evaluate('__blackHoleHash()');
await shot('blackhole-app.png');
for (const structure of ['rings', 'spiral', 'turbulent']) {
    await evaluate(`__setBlackHole('structure', '${structure}'); plotterApp.regenerate()`);
    await ready();
    assert(await evaluate(`document.querySelector('[data-param="flow"]').hidden`) === (structure === 'rings'), 'Flow visibility is wrong');
    if (structure !== 'turbulent') assert(await evaluate('__blackHoleHash()') !== initial, 'Pattern control did not change the drawing');
}
await evaluate(`__setBlackHole('flow', 0); plotterApp.regenerate()`);
assert(await evaluate(`document.querySelector('[data-param="winding"]').hidden`), 'Zero flow leaves winding visible');
await evaluate(`__setBlackHole('flow', 1); __setBlackHole('winding', 2.5); __setBlackHole('stars', 0); plotterApp.regenerate()`);
await ready();
const changed = await evaluate('__blackHoleHash()');
assert(changed !== initial, 'Flow and sky controls did not change the drawing');
await sleep(700);
await open('index.html');
await ready();
await setup();
assert(await evaluate('__blackHoleHash()') === changed, 'Reload changed saved settings');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
await ready();
assert(await evaluate('__blackHoleHash()') === initial, 'Reset did not restore defaults');
for (const pens of [1, 8]) {
    await evaluate(`__setBlackHole('pens', ${pens}); plotterApp.regenerate()`);
    await ready();
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__blackHoleDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __blackHoleDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const text = await __blackHoleDownloads.at(-1).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const recipe = JSON.parse(doc.querySelector('desc').textContent.slice('plotter-geometry:'.length));
    window.__blackHoleRecipe = recipe;
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        pattern: recipe.params.blackhole.structure, stars: recipe.params.blackhole.stars };
})()`);
assert(exported.valid && exported.layers === 8 && exported.pattern === 'turbulent' && exported.stars === 80, 'SVG lost layers or settings');
const eight = await evaluate('__blackHoleHash()');
const share = await evaluate(`'#s=' + btoa(JSON.stringify(__blackHoleRecipe))`);
await open('index.html' + share);
await ready();
await setup();
assert(await evaluate('__blackHoleHash()') === eight, 'Shared recipe changed geometry');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
await ready();
await protocol('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot('blackhole-mobile.png');
assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Mobile page overflows');
await protocol('Emulation.setDeviceMetricsOverride', { width: 1300, height: 1160, deviceScaleFactor: 1, mobile: false });
log('Black Hole: worker, pattern/flow/sky controls, persistence, reset, pens, SVG, share round trip and mobile passed');

for (const [name, params] of [
    ['default', {}], ['spiral', { structure: 'spiral', incl: 45, winding: 2 }],
    ['face-on', { incl: 0, flow: 1, winding: 3 }], ['edge-on', { incl: 89, tilt: 0 }],
    ['smooth', { structure: 'rings', stars: 0, incl: 80, outer: 30, rings: 96 }],
    ['one-pen', { pens: 1 }], ['redshift', { redshift: 12, pens: 8 }],
]) {
    await open('dev/sheet.html?' + new URLSearchParams({ gens: 'blackhole', variants: '0', size: '1000', set: JSON.stringify(params) }));
    assert(await evaluate(`document.title === 'done' && !document.querySelector('.err')`), `${name}: render failed`);
    await shot(`blackhole-${name}.png`);
}
log('Black Hole: seven visual variants rendered');
