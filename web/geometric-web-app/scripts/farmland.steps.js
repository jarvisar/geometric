// Browser integration and visual contact sheets for the Farmland scene.
const assert = (value, message) => { if (!value) throw new Error(message); };
await open('index.html');
await evaluate(`localStorage.clear()`);
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
await click('#designBtn');
assert(await evaluate(`document.querySelector('#galleryBody').textContent.includes('Farmland')`), 'Farmland missing from the gallery');
await evaluate(`document.querySelector('#gallerySearch').value = 'farmland'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input', { bubbles: true }));`);
await key('Enter');
await evaluate(`plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'farmland' && document.querySelector('#gallery').hidden`), 'Gallery search failed');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
const setup = () => evaluate(`
    window.__setFarm = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__farmHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 2000`), 'Worker failed to render the farm');
const initial = await evaluate('__farmHash()');
await shot('farmland-app.png');
await evaluate(`__setFarm('holdings', false); plotterApp.regenerate()`);
assert(await evaluate('__farmHash()') !== initial, 'Outlying farmyards control did not change geometry');
await evaluate(`__setFarm('holdings', true); plotterApp.regenerate()`);
assert(await evaluate('__farmHash()') === initial, 'Restoring outlying farmyards changed the seed');
await evaluate(`__setFarm('country', 'polder'); plotterApp.regenerate()`);
const changed = await evaluate('__farmHash()');
assert(changed !== initial, 'Landscape control did not change geometry');
// the polder is flat and has ditches instead of a creek
assert(await evaluate(`['hills', 'creek'].every(id => document.querySelector('[data-param="' + id + '"]').hidden)`), 'Controls the polder ignores remain visible');
await sleep(650);
await open('index.html');
await evaluate(`plotterApp.regenerate()`); await setup();
assert(await evaluate('__farmHash()') === changed, 'Reload changed the saved farm');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__farmHash()') === initial, 'Reset did not restore the default farm');
for (const pens of [1, 8]) {
    await evaluate(`__setFarm('pens', ${pens}); plotterApp.regenerate()`);
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__farmDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __farmDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __farmDownloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        recipe: doc.querySelector('desc').textContent.includes('"farmland"') };
})()`);
assert(exported.valid && exported.layers === 8 && exported.recipe, 'SVG export lost layers or recipe');
log('Farmland: gallery, worker, controls, persistence, reset, 1/8 pens and SVG passed');
for (const country of ['prairie', 'hedgerows', 'tuscan', 'polder']) {
    const query = new URLSearchParams({ gens: 'farmland', variants: '0', size: '1050', seed: '3', set: JSON.stringify({ country }) });
    await open('dev/sheet.html?' + query);
    await shot(`farmland-${country}.png`);
}
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'farmland', variants: '0', size: '1050', set: JSON.stringify({ pens: 1 }) }));
await shot('farmland-one-pen.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'farmland', variants: '0', size: '1100', paper: '297x210', set: JSON.stringify({ country: 'tuscan', yaw: 70, elev: 60 }) }));
await shot('farmland-camera-extreme.png');
