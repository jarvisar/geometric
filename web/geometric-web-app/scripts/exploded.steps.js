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
await evaluate(`plotterApp.resetAll(); plotterApp.select('exploded'); plotterApp.regenerate()`);
await ready();
const setup = () => evaluate(`
    window.__setExploded = (id, value) => {
        const input = document.querySelector('[data-param="' + id + '"]').querySelector('select, input');
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__explodedHash = () => {
        let h = 2166136261;
        for (const c of JSON.stringify(plotterApp.result.layers)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    };
`);
await setup();
assert(await evaluate(`plotterApp.result.gen === 'exploded' && document.querySelector('#errorMsg').hidden`), 'Worker failed');
assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === 2, 'Expected two pens by default');
const initial = await evaluate('__explodedHash()');
await shot('exploded-app.png');

// every machine, lying across the page and standing up it
const kinds = await evaluate(`[...document.querySelector('[data-param="kind"] select').options].map(o => o.value)`);
assert(kinds.length === 8, 'Expected eight machines');
const seen = new Set([initial]);
for (const kind of kinds) for (const axis of ['flat', 'up']) {
    await evaluate(`__setExploded('kind', '${kind}'); __setExploded('axis', '${axis}'); plotterApp.regenerate()`);
    await ready();
    assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.stats.paths > 100`), `${kind} ${axis} failed`);
    seen.add(await evaluate('__explodedHash()'));
    if (axis === 'up') await shot(`exploded-${kind}.png`);
}
assert(seen.size >= 16, 'Machines or layouts drew the same thing');

// Put back together there are fewer lines, and the annotations go one by one
await evaluate(`__setExploded('kind', 'gearbox'); __setExploded('axis', 'flat'); plotterApp.regenerate()`);
await ready();
const apart = await evaluate('plotterApp.result.stats.paths');
await evaluate(`__setExploded('explode', 0); plotterApp.regenerate()`);
await ready();
assert(await evaluate('plotterApp.result.stats.paths') < apart * 0.6, 'The assembled machine should have far fewer lines');
await shot('exploded-assembled.png');
await evaluate(`__setExploded('explode', 100); plotterApp.regenerate()`);
await ready();
assert(await evaluate('__explodedHash()') === initial, 'Settings did not come back to the default drawing');
for (const id of ['numbers', 'centers', 'header', 'assembled']) {
    const before = await evaluate('plotterApp.result.stats.draw');
    await evaluate(`__setExploded('${id}', false); plotterApp.regenerate()`);
    await ready();
    assert(await evaluate('plotterApp.result.stats.draw') < before, `Turning off ${id} did not remove any lines`);
}
await sleep(700);
const changed = await evaluate('__explodedHash()');
await open('index.html');
await ready();
await setup();
assert(await evaluate('__explodedHash()') === changed, 'Reload changed saved settings');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
await ready();
assert(await evaluate('__explodedHash()') === initial, 'Reset did not restore defaults');

// pens, and moving a part to another pen
for (const pens of [1, 8]) {
    await evaluate(`__setExploded('pens', ${pens}); plotterApp.regenerate()`);
    await ready();
    assert(await evaluate(`plotterApp.result.layers.filter(l => l.paths.length).length`) === pens, 'Incorrect pen mapping');
}
await shot('exploded-eight-pens.png');
await evaluate(`plotterApp.resetParams(); plotterApp.regenerate()`);
await ready();

// Randomize keeps drawing machines
for (let i = 0; i < 6; i++) {
    await key('r');
    await ready();
    assert(await evaluate(`document.querySelector('#errorMsg').hidden && plotterApp.result.gen === 'exploded' && plotterApp.result.stats.paths > 50`), 'Randomize failed');
}
await shot('exploded-random.png');
log('Exploded View app checks passed');
