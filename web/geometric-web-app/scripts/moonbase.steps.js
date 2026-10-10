// Browser integration and visual contact sheets for the Moon Base scene.
const assert = (value, message) => { if (!value) throw new Error(message); };
await open('index.html');
await evaluate(`localStorage.clear()`);
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
await click('#designBtn');
assert(await evaluate(`document.querySelector('#galleryBody').textContent.includes('Moon Base')`), 'Moon Base missing from the locked gallery');
await evaluate(`document.querySelector('#gallerySearch').value = 'moon'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input', { bubbles: true }));`);
await key('Enter');
await evaluate(`plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'moonbase' && document.querySelector('#gallery').hidden`), 'Gallery search failed');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
const setup = () => evaluate(`
    window.__setMoon = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__moonHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 3000`), 'Worker failed to render the colony');
const initial = await evaluate('__moonHash()');
await shot('moonbase-app.png');
await evaluate(`__setMoon('layout', 'crescent'); plotterApp.regenerate()`);
const changed = await evaluate('__moonHash()');
assert(changed !== initial, 'Colony plan control did not change geometry');
await sleep(650);
await open('index.html');
await evaluate(`plotterApp.regenerate()`); await setup();
assert(await evaluate('__moonHash()') === changed, 'Reload changed the saved colony');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__moonHash()') === initial, 'Reset did not restore the default colony');
// Mars has controls of its own, and the pen legend follows the world
const hidden = ids => evaluate(`${JSON.stringify(ids)}.map(id => document.querySelector('[data-param="' + id + '"]').hidden).join()`);
const marsOnly = ['dunes', 'mesas', 'devils', 'turbines', 'heli'];
assert(await hidden(marsOnly) === 'true,true,true,true,true' && await hidden(['telescope']) === 'false', 'Mars controls should stay hidden on the Moon');
await evaluate(`__setMoon('world', 'mars'); plotterApp.regenerate()`);
assert(await evaluate('__moonHash()') !== initial, 'World control did not change geometry');
assert(await hidden(marsOnly) === 'false,false,false,false,false' && await hidden(['telescope']) === 'true', 'Mars controls did not appear');
assert(await evaluate(`document.querySelector('#penList').textContent.includes('Dust, dunes & tracks')`), 'Pen legend did not follow the world');
await shot('moonbase-mars-app.png');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__moonHash()') === initial, 'Reset did not return to the Moon');
for (const pens of [1, 8]) {
    await evaluate(`__setMoon('pens', ${pens}); plotterApp.regenerate()`);
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__moonDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __moonDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __moonDownloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        recipe: doc.querySelector('desc').textContent.includes('"moonbase"') };
})()`);
assert(exported.valid && exported.layers === 8 && exported.recipe, 'SVG export lost layers or recipe');
log('Moon Base: gallery, worker, controls, worlds, persistence, reset, 1/8 pens and SVG passed');
for (const layout of ['gardens', 'crescent', 'spine', 'ring', 'twin']) {
    const query = new URLSearchParams({ gens: 'moonbase', variants: '0', size: '1050', set: JSON.stringify({ layout }) });
    await open('dev/sheet.html?' + query);
    await shot(`moonbase-${layout}.png`);
}
// The default next to three randomized colonies, to see that they don't repeat
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'moonbase', variants: '3', size: '560' }));
await shot('moonbase-variants.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'moonbase', variants: '0', size: '1050', set: JSON.stringify({ world: 'mars' }) }));
await shot('moonbase-mars.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'moonbase', variants: '0', size: '1050', set: JSON.stringify({ pens: 1, detail: false }) }));
await shot('moonbase-one-pen.png');
await open('dev/sheet.html?' + new URLSearchParams({ gens: 'moonbase', variants: '0', size: '1100', paper: '297x210', set: JSON.stringify({ yaw: 70, elev: 60, scale: 1.4, density: 1 }) }));
await shot('moonbase-camera-extreme.png');
