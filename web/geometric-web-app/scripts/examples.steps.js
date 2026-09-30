const assert = (ok, message) => { if (!ok) throw new Error(message); };
const ids = ['ribbons', 'stairwell', 'tidal', 'cosmic', 'skyline'];
await open('index.html');
await evaluate(`plotterApp.regenerate()`);
const setup = async () => evaluate(`
    window.__set = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    window.__hash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
    window.__downloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __downloads.push(blob); return create(blob); };
    HTMLAnchorElement.prototype.click = function () {};
`);
const modes = { ribbons: ['form', 'rosette'], stairwell: ['section', 'octagon'], tidal: ['style', 'contours'], cosmic: ['layout', 'single'], skyline: ['landmark', false] };
await setup();
for (const id of ids) {
    await evaluate(`plotterApp.select('${id}'); plotterApp.resetParams(); plotterApp.regenerate()`);
    assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 0`), `${id}: worker generation failed`);
    assert(await evaluate(`document.querySelector('#params details').dataset.paramSection === 'Pens'`), `${id}: pens missing from top`);
    const initial = await evaluate('__hash()');
    await shot(`${id}-app.png`);
    const [control, value] = modes[id];
    await evaluate(`__set('${control}', ${JSON.stringify(value)}); plotterApp.regenerate()`);
    const changed = await evaluate('__hash()');
    assert(changed !== initial, `${id}: control did not change geometry`);
    if (id === 'ribbons') assert(await evaluate(`document.querySelector('[data-param="loops"]').hidden`), 'Ribbon loop control remains visible for rosette');
    if (id === 'stairwell') assert(await evaluate(`document.querySelector('[data-param="steps"]').hidden`), 'Step control remains visible for octagon');
    if (id === 'cosmic') assert(await evaluate(`document.querySelector('[data-param="cols"]').hidden && document.querySelector('[data-param="rows"]').hidden`), 'Comic grid controls remain visible for postcard');
    await sleep(650);
    await open('index.html'); await evaluate(`plotterApp.regenerate()`); await setup();
    assert(await evaluate('__hash()') === changed, `${id}: reload changed geometry`);
    await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
    assert(await evaluate('__hash()') === initial, `${id}: reset did not restore geometry`);
    for (const pens of [1, 8]) {
        await evaluate(`__set('pens', ${pens}); plotterApp.regenerate()`);
        assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, `${id}: expected ${pens} used pens`);
    }
    await evaluate(`plotterApp.exportAs('svg')`);
    const exported = await evaluate(`(async () => {
        const doc = new DOMParser().parseFromString(await __downloads.at(-1).text(), 'image/svg+xml');
        return { valid: !doc.querySelector('parsererror'), layers: doc.querySelectorAll('g').length,
            finite: !/NaN|Infinity/.test(doc.documentElement.outerHTML), recipe: doc.querySelector('desc').textContent.includes('"${id}"') };
    })()`);
    assert(exported.valid && exported.finite && exported.layers === 8 && exported.recipe, `${id}: invalid SVG ${JSON.stringify(exported)}`);
    log(`${id}: controls, dependent fields, reload, reset, 1/8 pens and SVG passed`);
}
await click('#designBtn');
assert(await evaluate(`['ribbons', 'stairwell', 'tidal', 'cosmic', 'skyline'].every(id => document.querySelector('#galleryBody').textContent.includes(PG.byId[id].name))`), 'New designs missing from gallery');
await evaluate(`document.querySelector('#gallerySearch').value = 'cosmic'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input', {bubbles: true}));`);
await sleep(200);
await key('Enter');
await evaluate(`plotterApp.regenerate()`);
assert(await evaluate(`plotterApp.state.gen === 'cosmic' && document.querySelector('#gallery').hidden`), 'Gallery search did not select Cosmic Comics');
log('New designs are available through gallery search and keyboard selection');
