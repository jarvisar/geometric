// Browser integration and visual contact sheets for the Castle Town scene.
const assert = (value, message) => { if (!value) throw new Error(message); };
await open('index.html');
await evaluate(`localStorage.clear()`);
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
await click('#designBtn');
assert(await evaluate(`document.querySelector('#galleryBody').textContent.includes('Castle Town')`), 'Castle Town missing from the locked gallery');
await evaluate(`document.querySelector('#gallerySearch').value = 'castle'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input', { bubbles: true }));`);
await key('Enter');
await evaluate(`plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'castle' && document.querySelector('#gallery').hidden`), 'Gallery search failed');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
const setup = () => evaluate(`
    window.__setCastle = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__castleHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 3000`), 'Worker failed to render the town');
const initial = await evaluate('__castleHash()');
await shot('castle-app.png');
await evaluate(`__setCastle('keep', 'round'); plotterApp.regenerate()`);
const changed = await evaluate('__castleHash()');
assert(changed !== initial, 'Keep control did not change geometry');
await sleep(650);
await open('index.html');
await evaluate(`plotterApp.regenerate()`); await setup();
assert(await evaluate('__castleHash()') === changed, 'Reload changed the saved town');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__castleHash()') === initial, 'Reset did not restore the default town');
for (const pens of [1, 8]) {
    await evaluate(`__setCastle('pens', ${pens}); plotterApp.regenerate()`);
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__castleDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __castleDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __castleDownloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        recipe: doc.querySelector('desc').textContent.includes('"castle"') };
})()`);
assert(exported.valid && exported.layers === 8 && exported.recipe, 'SVG export lost layers or recipe');
log('Castle Town: gallery, worker, controls, persistence, reset, 1/8 pens and SVG passed');
for (const keep of ['turrets', 'square', 'round']) {
    const query = new URLSearchParams({ gens: 'castle', variants: '0', size: '1050', set: JSON.stringify({ keep }) });
    await open('dev/sheet.html?' + query);
    await shot(`castle-${keep}.png`);
}
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'castle', variants: '0', size: '1050', set: JSON.stringify({ pens: 1, detail: false }) }));
await shot('castle-one-pen.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'castle', variants: '0', size: '1100', paper: '297x210', set: JSON.stringify({ yaw: 70, elev: 60, castle: false, towerRoofs: 'crenels' }) }));
await shot('castle-camera-extreme.png');
