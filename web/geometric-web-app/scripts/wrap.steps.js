// Wrap under Composition in the browser: the controls each mode shows, the notes under Wrap and
// Arc°, the layer list, drawing in a wrapped layer's center, undo, and saving and loading.
// node scripts/drive.js scripts/wrap.steps.js shots/wrap 1300 1160
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const check = async (expr, message) => assert(await evaluate(expr), message);
const until = async (expr, message) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(50); }
    throw new Error(message);
};
const ready = () => until(`!!plotterApp.result && document.querySelector('#busy').hidden`, 'generation did not finish');
const helpers = () => evaluate(`
    window.__downloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { __downloads.push({ blob }); return create(blob); };
    HTMLAnchorElement.prototype.click = function () { __downloads.at(-1).name = this.download; };
    window.__set = (sel, value) => {
        const input = document.querySelector(sel);
        if (!input) throw new Error('no ' + sel);
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__drop = (text, name) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: name.endsWith('.svg') ? 'image/svg+xml' : 'application/json' }));
        document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    };
    window.__recipe = text => JSON.parse(new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('desc').textContent.slice('plotter-geometry:'.length));
    window.__shown = key => { const row = document.querySelector('[data-sec="comp"] [data-key="' + key + '"]'); return !!row && !row.hidden; };
    window.__note = () => { const n = document.querySelector('#coneNote'); return n && !n.hidden ? n.textContent : ''; };
    window.__status = () => { const n = document.querySelector('#wrapNote'); return n && !n.hidden ? n.querySelector('p').textContent : ''; };
    window.__meta = i => document.querySelector('[data-layer="' + i + '"] .layer-meta')?.textContent || '';
`);
const comp = key => `document.querySelector('[data-sec="comp"] [data-key="comp.${key}"]')`;

await open('index.html');
await ready();
await evaluate(`localStorage.clear(); plotterApp.resetAll(); plotterApp.select('truchet')`);
await ready();
await helpers();

// Off: one select, the crop as usual
await check(`[...${comp('wrap')}.querySelectorAll('option')].map(o => o.textContent).join() === 'None,Polar,Kaleidoscope' &&
    ${comp('wrap')}.querySelector('select').value === 'none'`, 'Wrap select');
await check(`!__shown('comp.inner') && !__shown('comp.arc') && !__shown('comp.repeats') && !__shown('comp.segments') && __shown('comp.clip') && !plotterApp.result.rings`,
    'wrap controls showing while Wrap is None');
await check(`${comp('wrap')}.querySelector('.hint') && ${comp('wrap')}.querySelector('select').getAttribute('aria-describedby').includes('wrapNoteText')`, 'Wrap has no hint');
await check(`document.querySelector('[data-sec="comp"] .controls').firstElementChild === ${comp('wrap')}`, 'Wrap is not first under Composition');
log('Wrap is the first control under Composition, off by default');

// Polar
await evaluate(`__set('[data-key="comp.wrap"] select', 'polar')`);
await ready();
await check(`__shown('comp.inner') && __shown('comp.arc') && __shown('comp.repeats') && !__shown('comp.segments') && !__shown('comp.clip') && __shown('comp.size')`,
    'controls for Polar');
await check(`plotterApp.result.rings && plotterApp.result.rings[0].arc === 360 && Math.abs(plotterApp.result.rings[0].r1 - 90) < 1e-9 && __meta(0) === 'Polar' && __note() === ''`,
    'Polar ring, layer list, or a cone note for a full ring');
await shot('01-polar.png');
log('Polar shows Inner radius, Arc, and Repeats, hides Crop to, and tags the layer');

// A fan says what cone it makes
await evaluate(`__set('[data-key="comp.arc"] input[type=number]', 200)`);
await ready();
await until(`__note().startsWith('Cone: 100 mm across at the base, 40 mm across at the top, and 44.9 mm tall.') && __note().includes('Turn on Draw frame')`, 'cone note for a fan');
await check(`(n => n.previousElementSibling === ${comp('arc')})(document.querySelector('#coneNote')) &&
    ${comp('arc')}.querySelector('input[type=range]').getAttribute('aria-describedby').includes('coneNote')`, 'cone note is not under Arc or not read with it');
await check(`!__shown('comp.tab')`, 'Glue tab showing without the frame');
await evaluate(`__set('[data-key="comp.frame"] input', true)`);
await ready();
await until(`__note() && !__note().includes('Draw frame')`, 'cone note still asks for the frame');
await check(`__shown('comp.tab')`, 'no Glue tab for a framed fan');
await evaluate(`__set('[data-key="comp.tab"] input[type=number]', 8)`);
await ready();
await check(`plotterApp.state.comp.tab === 8 && plotterApp.result.layers.find(l => l.pen === plotterApp.state.comp.framePen).paths.some(p => p.length === 4)`, 'no glue tab drawn');
await evaluate(`__set('[data-key="comp.scale"] input[type=number]', 150)`);
await ready();
await until(`__note().includes('cut off')`, 'no note for a fan the crop cuts');
await shot('02-fan.png');
await evaluate(`__set('[data-key="comp.scale"] input[type=number]', 100)`);
await evaluate(`__set('[data-key="comp.arc"] input[type=number]', 360)`);
await ready();
await until(`__note() === '' && document.querySelector('#wrapNote').hidden`, 'cone note left up for a full ring');
log('A fan shows the size of its cone, asks for the frame, and warns when the crop cuts it');

// A curve covers part of the ring, and the note offers enough repeats to go round
await evaluate(`plotterApp.select('spirograph')`);
await ready();
await until(`__status().includes('covers only part of the ring') && /^Repeat it \\d+ times$/.test(document.querySelector('#wrapNote button')?.textContent)`, 'no note for a curve that covers part of the ring');
await shot('03-curve.png');
const repeats = await evaluate(`+document.querySelector('#wrapNote button').textContent.match(/\\d+/)[0]`);
await click('#wrapNote button');
await ready();
await until(`plotterApp.state.comp.repeats === ${repeats} && __status() === '' && document.activeElement === ${comp('repeats')}.querySelector('input[type=number]')`, 'the button did not set Repeats');
await check(`+${comp('repeats')}.querySelector('input[type=number]').value === ${repeats}`, 'Repeats box not updated');
await shot('04-wreath.png');
// Nothing fits: Celtic in many repeats
await evaluate(`plotterApp.select('celtic'); __set('[data-key="comp.repeats"] input[type=number]', 24)`);
await ready();
await until(`__status().startsWith('Nothing fits')`, 'no note when nothing fits');
await evaluate(`__set('[data-key="comp.repeats"] input[type=number]', 1); plotterApp.select('truchet')`);
await ready();
await check(`__status() === ''`, 'a note left up for a full ring');
log('A curve that covers part of the ring gets a button for enough repeats, and an empty ring says nothing fits');

// Kaleidoscope: Segments instead of Repeats, in pairs
await evaluate(`__set('[data-key="comp.wrap"] select', 'kaleido')`);
await ready();
await check(`__shown('comp.segments') && !__shown('comp.repeats') && __meta(0) === 'Kaleidoscope'`, 'controls for Kaleidoscope');
await evaluate(`__set('[data-key="comp.segments"] input[type=number]', 7)`);
await ready();
await check(`plotterApp.state.comp.segments % 2 === 0 && +${comp('segments')}.querySelector('input[type=number]').value === plotterApp.state.comp.segments`, 'an odd number of segments');
await shot('05-kaleidoscope.png');
log('Kaleidoscope shows Segments, which stay even');

// The drawing area outline follows the ring
await evaluate(`__set('[data-key="comp.inner"] input[type=number]', 55)`);
await ready();
await check(`plotterApp.result.outlines.length === 2`, 'the drawing area outline is not the ring');
await click('#toggleMargin');
await sleep(200);
await shot('06-outline.png');
await click('#toggleMargin');
log('Show drawing area outlines the ring');

// Undo goes back through the wrap settings
await sleep(400);
await evaluate(`plotterApp.undo()`);
await ready();
await check(`plotterApp.state.comp.inner === 40`, 'undo did not go back to the inner radius before');
await evaluate(`plotterApp.redo()`);
await ready();
await check(`plotterApp.state.comp.inner === 55`, 'redo');
log('Undo and redo step through wrap changes');

// A planet: another layer in the center of a wrapped town
await evaluate(`plotterApp.resetAll(); plotterApp.select('town')`);
await ready();
await evaluate(`plotterApp.addLayer('topo')`);
await ready();
await check(`(o => o && o.disabled && o.textContent.endsWith('(no shapes)'))(document.querySelector('[data-layer-key="inside"] option[value="0"]'))`,
    'an unwrapped town offers shapes');
await evaluate(`plotterApp.selectLayer(0)`);
await evaluate(`__set('[data-key="comp.wrap"] select', 'polar')`);
await ready();
await evaluate(`plotterApp.selectLayer(1)`);
await check(`(o => o && !o.disabled && !o.textContent.includes('no shapes'))(document.querySelector('[data-layer-key="inside"] option[value="0"]'))`,
    'a wrapped town does not offer its center');
await check(`document.querySelector('[data-layer-key="inside"] .ctl-hint').textContent.includes('empty center')`, 'Draw in hint does not mention the center');
await evaluate(`__set('#params [data-layer-key="inside"] select', '0')`);
await ready();
await check(`[...document.querySelectorAll('[data-layer-key="shapes"] option')].map(o => o.textContent).join() === 'All shapes,Every other shape,Center' &&
    plotterApp.result.layerInfo[1].used === 1 && plotterApp.state.layers[0].comp.cover === 'area'`, 'drawing in the center');
await check(`__meta(1) === 'In layer 1 · Covers below' && __meta(0) === 'Polar'`, 'layer list after drawing in the center');
await shot('07-planet.png');

// No hole, no center: both layers say so
await evaluate(`plotterApp.selectLayer(0)`);
await evaluate(`__set('[data-key="comp.inner"] input[type=number]', 0)`);
await ready();
await check(`__status() === 'Layer 2 draws in the center of this layer, which needs an Inner radius % above 0.'`, 'no note on the layer that lost its center');
await evaluate(`__set('[data-key="comp.wrap"] select', 'none')`);
await ready();
await check(`__status().endsWith('which needs Wrap set to Polar or Kaleidoscope.')`, 'no note on the unwrapped layer');
await evaluate(`__set('[data-key="comp.wrap"] select', 'polar')`);
await ready();
await evaluate(`plotterApp.selectLayer(1)`);
await check(`(n => !n.hidden && n.textContent.startsWith('Layer 1 has no center') && n.textContent.includes('Inner radius %'))(document.querySelector('#layerNote'))`,
    'no note for a wrapped layer without a center');
await evaluate(`plotterApp.selectLayer(0)`);
await evaluate(`__set('[data-key="comp.inner"] input[type=number]', 35)`);
await ready();
await evaluate(`plotterApp.selectLayer(1)`);
await check(`document.querySelector('#layerNote').hidden && plotterApp.result.layerInfo[1].used === 1`, 'center back with an inner radius');
log('A wrapped layer with an inner radius offers its center for Draw in, and says so when it has none');

// Saving and loading keep the wrap of every layer
await evaluate(`plotterApp.selectLayer(1)`);
await evaluate(`__set('[data-key="comp.wrap"] select', 'kaleido')`);
await ready();
await evaluate(`__downloads.length = 0; plotterApp.exportAs('svg')`);
await until(`__downloads.length === 1 && __downloads[0].name`, 'no SVG download');
const svg = await evaluate(`__downloads[0].blob.text()`);
await check(`(r => r.comp.wrap === 'polar' && r.comp.inner === 35 && r.layers[0].comp.wrap === 'kaleido')(__recipe(${JSON.stringify(svg)}))`, 'SVG recipe without wrap');
await evaluate(`plotterApp.resetAll()`);
await ready();
await check(`plotterApp.state.comp.wrap === 'none'`, 'Reset everything kept the wrap');
await evaluate(`__drop(${JSON.stringify(svg)}, 'planet.svg')`);
await until(`plotterApp.state.layers.length === 1 && plotterApp.state.comp.wrap === 'polar'`, 'dropping the SVG did not bring the wrap back');
await ready();
await check(`plotterApp.state.layers[0].comp.wrap === 'kaleido' && plotterApp.result.rings && plotterApp.result.rings.length === 2`, 'wrap of the top layer after loading');
await sleep(500);
await open('index.html');
await ready();
await check(`plotterApp.state.comp.wrap === 'polar' && plotterApp.state.comp.inner === 35 && plotterApp.state.layers[0].comp.wrap === 'kaleido'`, 'reload lost the wrap');
log('Wrap survives SVG export, loading it back, and a reload');
