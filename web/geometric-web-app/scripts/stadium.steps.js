// Browser integration and visual contact sheets for the Stadium scene.
const assert = (value, message) => { if (!value) throw new Error(message); };
await open('index.html');
await evaluate(`localStorage.clear()`);
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
await click('#designBtn');
assert(await evaluate(`document.querySelector('#galleryBody').textContent.includes('Stadium')`), 'Stadium missing from the locked gallery');
await evaluate(`document.querySelector('#gallerySearch').value = 'stadium'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input', { bubbles: true }));`);
await key('Enter');
await evaluate(`plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'stadium' && document.querySelector('#gallery').hidden`), 'Gallery search failed');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
const setup = () => evaluate(`
    window.__setStadium = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__stadiumHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 2000`), 'Worker failed to render the stadium');
const initial = await evaluate('__stadiumHash()');
await shot('stadium-app.png');
await evaluate(`__setStadium('type', 'bullring'); plotterApp.regenerate()`);
const changed = await evaluate('__stadiumHash()');
assert(changed !== initial, 'Kind control did not change geometry');
// a bullring has no choice of sport, roof or seat pattern
assert(await evaluate(`['sport', 'roof', 'seats', 'landmark'].every(id => document.querySelector('[data-param="' + id + '"]').hidden)`), 'Controls a bullring ignores remain visible');
await sleep(650);
await open('index.html');
await evaluate(`plotterApp.regenerate()`); await setup();
assert(await evaluate('__stadiumHash()') === changed, 'Reload changed the saved stadium');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__stadiumHash()') === initial, 'Reset did not restore the default stadium');
for (const pens of [1, 8]) {
    await evaluate(`__setStadium('pens', ${pens}); plotterApp.regenerate()`);
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__stadiumDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __stadiumDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __stadiumDownloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        recipe: doc.querySelector('desc').textContent.includes('"stadium"') };
})()`);
assert(exported.valid && exported.layers === 8 && exported.recipe, 'SVG export lost layers or recipe');
log('Stadium: gallery, worker, controls, persistence, reset, 1/8 pens and SVG passed');
for (const type of ['ground', 'bowl', 'oval', 'horseshoe', 'ballpark', 'cricket', 'bullring']) {
    const query = new URLSearchParams({ gens: 'stadium', variants: '0', size: '1050', seed: '3', set: JSON.stringify({ type }) });
    await open('dev/sheet.html?' + query);
    await shot(`stadium-${type}.png`);
}
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'stadium', variants: '0', size: '1050', set: JSON.stringify({ pens: 1 }) }));
await shot('stadium-one-pen.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'stadium', variants: '0', size: '1100', paper: '297x210', set: JSON.stringify({ type: 'bowl', yaw: 70, elev: 60, landmark: 'arch' }) }));
await shot('stadium-camera-extreme.png');
