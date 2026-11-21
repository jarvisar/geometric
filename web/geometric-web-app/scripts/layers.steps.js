// Layers in the browser: the list, adding layers from the gallery, the Layer and Composition
// sections, undo, saving and loading, focus, screen reader labels and phones.
// node scripts/drive.js scripts/layers.steps.js shots/layers
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
    window.__live = () => document.querySelector('#live').textContent;
    window.__rows = () => [...document.querySelectorAll('#layers .layer-row')].map(r => r.querySelector('.layer-name').textContent);
    window.__focus = () => { const e = document.activeElement; return (e.closest('[data-layer]')?.dataset.layer ?? '') + ':' + (e.dataset.act || e.tagName); };
`);
const state = expr => evaluate(`(s => ${expr})(plotterApp.state)`);

await open('index.html');
await ready();
await evaluate(`localStorage.clear(); plotterApp.resetAll(); plotterApp.select('circlepack', { style: 'outline', maxR: 30, minR: 8 })`);
await ready();
await helpers();

// One layer: a single row, nothing to move, delete or hide, and no Layer section
await check(`__rows().join() === 'Circle Packing' && !document.querySelector('#layers [data-act="delete"], #layers .eye') &&
    document.querySelector('#designLayer').hidden && !document.querySelector('[data-param-section="Layer"]') &&
    document.querySelector('#layers .out-note') && document.querySelector('[data-sec="comp"] .badge').textContent === ''`, 'single layer view');
await check(`document.querySelector('#layers .layer-pick').getAttribute('aria-pressed') === 'true'`, 'the only layer is not marked as selected');
log('One layer shows one row, no layer controls, and a note about adding layers');

// Add layer opens the gallery for a new layer. Closing it adds nothing and goes back to the button.
await click('#layers [data-act="add"]');
await check(`!document.querySelector('#gallery').hidden && document.querySelector('#galleryTitle').textContent === 'Add a layer' &&
    !document.querySelector('#galleryBody .card.current')`, 'gallery for a new layer');
await key('Escape');
await check(`plotterApp.state.layers.length === 0 && document.activeElement.dataset.act === 'add'`, 'closing the gallery added a layer or lost focus');
await click('#layers [data-act="add"]');
await click('#galleryBody .card[data-id="spirograph"]');
await ready();
await check(`plotterApp.state.layers.length === 1 && plotterApp.state.ui.layer === 1 && __rows().join() === 'Spirograph,Circle Packing'`, 'adding a layer');
await check(`__focus() === '1:pick' && document.querySelector('[data-layer="1"] .layer-pick').getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-layer="0"] .layer-pick').getAttribute('aria-pressed') === 'false'`, 'focus and pressed state after adding');
await check(`__live().includes('Added layer 2, Spirograph')`, 'adding a layer was not announced');
await check(`document.querySelector('#designLayer').textContent === 'Layer 2 of 2' && document.querySelector('#designTitle').textContent === 'Spirograph' &&
    document.querySelector('#designCat').textContent === 'Layer 2 · Curves' && document.querySelector('[data-sec="comp"] .badge').textContent === 'Layer 2' &&
    document.querySelector('[data-param-section="Layer"]') && +document.querySelector('#seed').value === plotterApp.state.layers[0].seed`, 'panels after adding');
await check(`plotterApp.result.layers.length && plotterApp.result.layerInfo && plotterApp.result.layerInfo.length === 2`, 'the drawing has no second layer');
await shot('01-two-layers.png');
log('Add layer adds from the gallery, selects the new layer and points the panels at it');

// Randomize, New seed and Reset work on the selected layer only
const bottom = await state(`JSON.stringify([s.params.circlepack, s.seed])`);
await evaluate(`plotterApp.randomize(); plotterApp.newSeed();`);
await ready();
await check(`JSON.stringify([plotterApp.state.params.circlepack, plotterApp.state.seed]) === ${JSON.stringify(bottom)}`, 'Randomize changed the bottom layer');
await check(`+document.querySelector('#seed').value === plotterApp.state.layers[0].seed`, 'seed box is not the selected layer');
await check(`document.querySelector('#gallery').hidden`, 'gallery left open');
await evaluate(`document.activeElement.blur()`);
await key('g');
await check(`document.querySelector('#galleryTitle').textContent === 'Design for layer 2' && document.querySelector('#galleryBody .card.current[data-id="spirograph"]')`, 'gallery for the selected layer');
await key('Escape');
log('Randomize, New seed and the gallery work on the selected layer');

// Picking a layer points the panels at it without an undo step
await click('[data-layer="0"] [data-act="pick"]');
await check(`plotterApp.state.ui.layer === 0 && document.querySelector('#designTitle').textContent === 'Circle Packing' &&
    +document.querySelector('#seed').value === plotterApp.state.seed && document.querySelector('[data-sec="comp"] .badge').textContent === 'Layer 1' &&
    !document.querySelector('[data-layer-key="cover"]') && __focus() === '0:pick'`, 'selecting the bottom layer');
await evaluate(`plotterApp.undo()`);
await check(`plotterApp.state.ui.layer === 0 && JSON.stringify([plotterApp.state.params.circlepack, plotterApp.state.seed]) === ${JSON.stringify(bottom)}`, 'undo undid a selection or the bottom layer');
await evaluate(`plotterApp.redo()`);
await click('[data-layer="1"] [data-act="pick"]');
log('Picking a layer is not an undo step');

// Drawing in the shapes of the layer below turns on covering, and Composition follows
await evaluate(`__set('#params [data-layer-key="inside"] select', '0')`);
await ready();
await check(`plotterApp.state.layers[0].comp.inside === 0 && plotterApp.state.layers[0].comp.cover === 'area' &&
    document.querySelector('[data-layer-key="cover"] select').value === 'area' && !document.querySelector('[data-layer-key="shapes"]').hidden &&
    !document.querySelector('[data-layer-key="inset"]').hidden && document.querySelector('[data-key="comp.clip"]').hidden &&
    document.querySelector('[data-key="comp.frame"] label').textContent === 'Outline each shape'`, 'Draw in did not set up the layer');
await check(`plotterApp.result.layerInfo[1].used > 3 && document.querySelector('[data-layer="1"] .layer-meta').textContent === 'In layer 1 · Covers below'`, 'not drawn in the shapes');
await check(`document.activeElement === document.querySelector('[data-layer-key="inside"] select')`, 'focus left Draw in');
await shot('02-inside-shapes.png');
await evaluate(`__set('#params [data-layer-key="minShape"] input[type=number]', 100)`);
await ready();
await check(`!document.querySelector('#layerNote').hidden && document.querySelector('#layerNote').textContent.startsWith('None of the shapes')`, 'no note for shapes too small');
await evaluate(`__set('#params [data-layer-key="minShape"] input[type=number]', 5)`);
await ready();
await check(`document.querySelector('#layerNote').hidden`, 'note stayed up');
log('Draw in turns on covering, hides the crop and shows notes about the shapes');

// Kinds of shapes follow the design below
await click('[data-layer="0"] [data-act="pick"]');
await evaluate(`__set('[data-param="style"] select', 'mixed')`);
await ready();
await click('[data-layer="1"] [data-act="pick"]');
await check(`[...document.querySelectorAll('[data-layer-key="shapes"] option')].map(o => o.textContent).join() ===
    'All shapes,Every other shape,Eccentric bubbles,Spirals,Concentric rings,Hatched,Outlines'`, 'shape kinds of Circle Packing');
await evaluate(`__set('#params [data-layer-key="shapes"] select', 'kind:4')`);
await ready();
const outlinesOnly = await evaluate(`plotterApp.result.layerInfo[1].shapes`);
await click('[data-layer="0"] [data-act="pick"]');
await evaluate(`__set('[data-param="style"] select', 'outline')`);
await ready();
await click('[data-layer="1"] [data-act="pick"]');
await check(`document.querySelector('[data-layer-key="shapes"] select').value === 'all' && plotterApp.state.layers[0].comp.shapes === 'kind:4' &&
    plotterApp.result.layerInfo[1].shapes > ${outlinesOnly}`, 'a kind the design no longer names should mean all shapes');
log('Shapes lists the kinds the layer below names, and falls back to all of them');

// Moving a layer below the one it draws in puts it back on the whole area. Undo keeps each
// layer's locks with it, the pen count lock too.
await click('[data-param="R"] .lock-btn');
await click('[data-param="pens"] .lock-btn');
await sleep(400);
await click('[data-layer="1"] [data-act="down"]');
await ready();
await check(`__rows().join() === 'Circle Packing,Spirograph' && plotterApp.state.gen === 'spirograph' && plotterApp.state.ui.layer === 0 &&
    plotterApp.state.comp.inside === -1 && plotterApp.state.layers[0].gen === 'circlepack' && plotterApp.state.layers[0].comp.cover === 'none'`, 'moving down');
await check(`__focus() === '0:pick' && __live().includes('Moved Spirograph to layer 1')`, 'focus or announcement after moving to the bottom');
await evaluate(`plotterApp.undo()`);
await ready();
await check(`__rows().join() === 'Spirograph,Circle Packing' && plotterApp.state.layers[0].comp.inside === 0 && plotterApp.state.layers[0].comp.cover === 'area'`, 'undo of a move');
await check(`plotterApp.state.layers[0].locks.spirograph.includes('R') && !(plotterApp.state.locks.spirograph || []).includes('R')`, 'undoing a move swapped the locks of the layers');
await check(`plotterApp.state.layers[0].locks.spirograph.includes('pens') && !(plotterApp.state.locks.circlepack || []).includes('pens')`, 'undoing a move moved the pen count lock');
await click('[data-param="pens"] .lock-btn');
await evaluate(`plotterApp.redo()`);
await ready();
await click('[data-layer="0"] [data-act="up"]');
await ready();
await check(`__rows().join() === 'Spirograph,Circle Packing' && plotterApp.state.ui.layer === 1 && __focus() === '1:pick'`, 'moving up to the top');
log('Moving layers reorders them, follows the selection and focus, and undoes');

// Duplicate copies the selected layer above it; locks stay through undo
await evaluate(`__set('#params [data-layer-key="inside"] select', '0')`);
await ready();
await click('#layers [data-act="duplicate"]');
await ready();
await check(`plotterApp.state.layers.length === 2 && plotterApp.state.ui.layer === 2 && plotterApp.state.layers[1].comp.inside === 0 &&
    plotterApp.state.layers[1].seed === plotterApp.state.layers[0].seed && __rows().join() === 'Spirograph,Spirograph,Circle Packing'`, 'duplicating');
await evaluate(`__set('#params [data-layer-key="pen"] select', '6')`);
await ready();
await check(`plotterApp.result.layers.some(l => l.pen === 6) && document.querySelector('#penAssignmentHint').textContent.startsWith('Layer 3 draws everything with pen 7') &&
    document.querySelector('.pen-row[data-pen="6"] .pen-count').textContent.includes('Layer 3: everything')`, 'one pen for a layer');
// the copy has the lock of the layer it copies; edits within the commit delay share an undo step
await check(`plotterApp.state.layers[1].locks.spirograph.includes('R') && document.querySelector('[data-param="R"] .lock-btn').classList.contains('locked')`, 'the copy lost the lock');
await sleep(400);
await evaluate(`plotterApp.randomize()`);
await ready();
await sleep(400);
await evaluate(`plotterApp.undo()`);
await check(`plotterApp.state.layers[1].locks.spirograph.includes('R') && document.querySelector('[data-param="R"] .lock-btn').classList.contains('locked')`, 'undo dropped a layer lock');
log('Duplicate copies the layer above it, one pen per layer works, and locks survive undo');

// Hiding the bottom layer keeps the shapes the others draw in
await click('[data-layer="0"] [data-act="eye"]');
await ready();
await check(`plotterApp.state.comp.hidden && document.querySelector('[data-layer="0"] .eye').getAttribute('aria-pressed') === 'false' &&
    __focus() === '0:eye' && plotterApp.result.layerInfo[1].used > 0 && document.querySelector('[data-layer="0"]').classList.contains('off')`, 'hiding the bottom layer');
await click('[data-layer="0"] [data-act="eye"]');
await ready();
log('Hidden layers still hold the layers drawn in their shapes');

// Deleting moves focus to the layer below; the sheet holds up to six
await click('[data-layer="2"] [data-act="delete"]');
await ready();
await check(`plotterApp.state.layers.length === 1 && __focus() === '1:pick' && __live().includes('Deleted layer 3, Spirograph')`, 'deleting');
for (const id of ['truchet', 'moire', 'maze', 'flowfield']) await evaluate(`plotterApp.addLayer('${id}')`);
await ready();
await check(`plotterApp.state.layers.length === 5 && document.querySelector('#layers [data-act="add"]').disabled &&
    document.querySelector('#layers [data-act="duplicate"]').disabled`, 'six layers should be the limit');
await evaluate(`plotterApp.addLayer('spirograph')`);
await check(`plotterApp.state.layers.length === 5 && [...document.querySelectorAll('.toast.error')].some(t => t.textContent.includes('up to 6 layers'))`, 'a seventh layer was added');
await shot('03-six-layers.png');
log('Delete hands focus to the layer below, and a sheet holds six layers');

// Every control in the list has a name, and ids stay unique
await check(`[...document.querySelectorAll('#layers button')].every(b => (b.getAttribute('aria-label') || b.textContent).trim())`, 'a layer button has no accessible name');
await check(`(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return new Set(ids).size === ids.length; })()`, 'duplicate ids');
await evaluate(`document.querySelector('[data-layer="3"] [data-act="pick"]').focus()`);
await key('Tab');
await check(`__focus() === '3:up'`, 'Tab from a layer goes to its Move up button');
await key('Tab');
await key('Tab');
await check(`__focus() === '3:delete'`, 'Tab order in a layer row');
log('Layer controls are named and in reading order');

// Saving, loading and reloading keep the layers
for (let i = 5; i > 2; i--) await evaluate(`plotterApp.deleteLayer(${i})`);
await ready();
await evaluate(`__downloads.length = 0; plotterApp.exportAs('svg')`);
await until(`__downloads.length === 1 && __downloads[0].name`, 'no SVG download');
const svg = await evaluate(`__downloads[0].blob.text()`);
await check(`(r => r.layers.length === 2 && r.layers[0].gen === 'spirograph' && r.layers[0].comp.inside === 0 && r.layers[1].gen === 'truchet' &&
    Object.keys(r.layers[0].params).join() === 'spirograph')(__recipe(${JSON.stringify(svg)}))`, 'SVG recipe without layers');
await check(`(${JSON.stringify(svg)}).includes('<title>Circle Packing + Spirograph + Truchet')`, 'SVG title should name every layer');
await evaluate(`__downloads.length = 0; plotterApp.exportAs('json')`);
await until(`__downloads.length === 1`, 'no settings download');
const json = await evaluate(`__downloads[0].blob.text()`);
await evaluate(`plotterApp.resetAll()`);
await ready();
await check(`plotterApp.state.layers.length === 0 && __rows().length === 1`, 'Reset everything kept layers');
await evaluate(`__drop(${JSON.stringify(svg)}, 'stack.svg')`);
await until(`plotterApp.state.layers.length === 2`, 'dropping the SVG did not bring the layers back');
await ready();
await check(`__rows().join() === 'Truchet,Spirograph,Circle Packing' && plotterApp.state.layers[0].comp.inside === 0`, 'layers from the SVG');
await evaluate(`plotterApp.resetAll()`);
await ready();
await evaluate(`__drop(${JSON.stringify(json)}, 'stack.json')`);
await until(`plotterApp.state.layers.length === 2`, 'dropping the settings did not bring the layers back');
await ready();
await evaluate(`plotterApp.selectLayer(1)`);
await sleep(500);
await open('index.html');
await ready();
await helpers();
await check(`plotterApp.state.layers.length === 2 && plotterApp.state.ui.layer === 1 && document.querySelector('#designTitle').textContent === 'Spirograph' &&
    document.querySelector('[data-layer="1"] .layer-pick').getAttribute('aria-pressed') === 'true'`, 'reload lost the layers or the selection');
log('Layers survive SVG and settings export, loading either back, and a reload');

// Grids sweep a parameter of any layer
await evaluate(`__set('[data-key="comp.cols"] input[type=number]', 2)`);
await check(`[...document.querySelectorAll('[data-key="comp.sweepId"] optgroup')].map(g => g.label).join('|') ===
    'Layer 1, Circle Packing|Layer 2, Spirograph|Layer 3, Truchet'`, 'sweep options by layer');
await evaluate(`__set('[data-key="comp.sweepId"] select', '1:R')`);
await ready();
await check(`plotterApp.state.comp.sweepLayer === 1 && plotterApp.state.comp.sweepId === 'R'`, 'sweeping a parameter of layer 2');
await evaluate(`plotterApp.deleteLayer(1)`);
await check(`plotterApp.state.comp.sweepId === '' && plotterApp.state.comp.sweepLayer === 0`, 'the sweep of a deleted layer stayed');
await evaluate(`__set('[data-key="comp.cols"] input[type=number]', 1)`);
await ready();
log('Grids sweep a parameter of any layer, and drop the sweep with its layer');

// Crop size and position for a layer that fills part of the sheet
await evaluate(`plotterApp.selectLayer(1); __set('[data-key="comp.clip"] select', 'circle'); __set('[data-key="comp.size"] input[type=number]', 50)`);
await check(`!document.querySelector('[data-key="comp.posX"]').hidden`, 'crop position hidden for a smaller crop');
await evaluate(`__set('[data-key="comp.posX"] input[type=number]', 20); __set('#params [data-layer-key="cover"] select', 'area')`);
await ready();
await check(`document.querySelector('#layerNote').hidden`, 'a note for a smaller crop that covers');
await evaluate(`__set('[data-key="comp.size"] input[type=number]', 100)`);
await ready();
await check(`document.querySelector('#layerNote').hidden`, 'a full size circle still leaves the layers below showing round it');
await evaluate(`__set('[data-key="comp.clip"] select', 'rect')`);
await ready();
await check(`!document.querySelector('#layerNote').hidden && document.querySelector('#layerNote').textContent.includes('hides every layer below')`, 'no note when covering the whole area');
await shot('04-crop.png');
log('A layer can fill a smaller crop, and covering the whole area is called out');

// Phones: the list and Layer section fit the Design tab
await protocol('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await protocol('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await open('index.html');
await ready();
await helpers();
await evaluate(`document.querySelector('#panelTabs [data-tab="design"]').click()`);
await sleep(300);
await check(`(() => { const p = document.querySelector('.panel.left'); return p.scrollWidth <= p.clientWidth; })()`, 'the Design panel scrolls sideways on a phone');
await check(`[...document.querySelectorAll('#layers .layer-act')].every(b => b.getBoundingClientRect().width >= 30 || b.offsetParent === null)`, 'layer buttons too small to tap');
await shot('05-phone.png');
log('The layer list fits a phone, with buttons big enough to tap');
