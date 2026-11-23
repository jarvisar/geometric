// Browser integration and visual contact sheets for the Temple Garden scene.
const assert = (value, message) => { if (!value) throw new Error(message); };
await open('index.html');
await evaluate(`localStorage.clear()`);
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
await click('#designBtn');
assert(await evaluate(`document.querySelector('#galleryBody').textContent.includes('Temple Garden')`), 'Temple Garden missing from the gallery');
await key('Escape');
await evaluate(`plotterApp.select('temple'); plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'temple'`), 'Could not select the garden');
const setup = () => evaluate(`
    window.__setGarden = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__gardenHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 1000`), 'Worker failed to render the garden');
const initial = await evaluate('__gardenHash()');
await shot('temple-app.png');
// controls that only apply to some gardens stay out of the way
assert(await evaluate(`['koi', 'ripples', 'wave', 'check'].every(id => document.querySelector('[data-param="' + id + '"]').hidden)`), 'Pond and pattern controls show with no pond and a straight rake');
await evaluate(`__setGarden('pond', true); plotterApp.regenerate()`);
const pond = await evaluate('__gardenHash()');
assert(pond !== initial, 'Pond control did not change geometry');
assert(await evaluate(`['koi', 'ripples'].every(id => !document.querySelector('[data-param="' + id + '"]').hidden)`), 'Pond controls stay hidden with a pond');
await evaluate(`__setGarden('pond', false); plotterApp.regenerate()`);
assert(await evaluate('__gardenHash()') === initial, 'Taking the pond away again changed the garden');
// each kind of garden shows only the controls it uses
const shown = id => evaluate(`!document.querySelector('[data-param="${id}"]').hidden`);
await evaluate(`__setGarden('garden', 'court'); plotterApp.regenerate()`);
assert(await evaluate('__gardenHash()') !== initial, 'Garden control did not change geometry');
assert(!(await shown('annex')) && !(await shown('path')) && !(await shown('pond')) && !(await shown('rocks')) && await shown('cones'), 'A temple court shows controls it ignores');
await evaluate(`__setGarden('garden', 'pond'); plotterApp.regenerate()`);
assert(await shown('annex') && await shown('koi') && !(await shown('pond')) && !(await shown('cones')), 'A pond garden shows the wrong controls');
await shot('temple-pond-garden.png');
await evaluate(`__setGarden('garden', 'dry'); plotterApp.regenerate()`);
assert(await evaluate('__gardenHash()') === initial, 'Going back to a dry garden changed it');
await evaluate(`__setGarden('rake', 'ripples'); plotterApp.regenerate()`);
const changed = await evaluate('__gardenHash()');
assert(changed !== initial, 'Rake pattern did not change geometry');
// ripples are rings all the way out, so the ring count and the direction don't apply
assert(await evaluate(`['rings', 'rakeTurn'].every(id => document.querySelector('[data-param="' + id + '"]').hidden)`), 'Controls ripples ignore remain visible');
await sleep(650);
await open('index.html');
await evaluate(`plotterApp.regenerate()`); await setup();
assert(await evaluate('__gardenHash()') === changed, 'Reload changed the saved garden');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
assert(await evaluate('__gardenHash()') === initial, 'Reset did not restore the default garden');
await evaluate(`__setGarden('pond', true); __setGarden('people', 1); plotterApp.regenerate()`);
for (const pens of [1, 8]) {
    await evaluate(`__setGarden('pens', ${pens}); plotterApp.regenerate()`);
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await evaluate(`
    window.__gardenDownloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __gardenDownloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
    plotterApp.exportAs('svg');
`);
const exported = await evaluate(`(async () => {
    const doc = new DOMParser().parseFromString(await __gardenDownloads.at(-1).text(), 'image/svg+xml');
    return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
        recipe: doc.querySelector('desc').textContent.includes('"temple"') };
})()`);
assert(exported.valid && exported.layers === 8 && exported.recipe, 'SVG export lost layers or recipe');
log('Temple Garden: gallery, worker, controls, persistence, reset, 1/8 pens and SVG passed');
const sheet = (name, set, extra = {}) => open('dev/sheet.html?' + new URLSearchParams({ gens: 'temple', variants: '0', size: '1050', ...extra, set: JSON.stringify(set) })).then(() => shot(name));
for (const rake of ['straight', 'waves', 'ripples', 'checks', 'scallops']) await sheet(`temple-${rake}.png`, { rake }, { seed: '3' });
for (const garden of ['pond', 'tea', 'court']) await sheet(`temple-${garden}.png`, { garden }, { seed: '2' });
await sheet('temple-pond-tea.png', { pond: true, annex: 'tea', side: 'right' }, { seed: '4' });
await sheet('temple-one-pen.png', { pens: 1 });
await sheet('temple-landscape.png', { pond: true }, { size: '1100', paper: '297x210' });
await sheet('temple-camera-extreme.png', { yaw: 70, elev: 60, annex: 'hall' }, { size: '1100', paper: '297x210' });
