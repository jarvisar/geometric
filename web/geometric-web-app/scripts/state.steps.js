// node scripts/drive.js scripts/state.steps.js shots/state
await open('index.html');
await sleep(400);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const check = async (expr, message) => assert(await evaluate(expr), message);
const installHelpers = async () => evaluate(`
    window.__downloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { __downloads.push({ blob }); return create(blob); };
    HTMLAnchorElement.prototype.click = function () { __downloads.at(-1).name = this.download; };
    window.__drop = (text, name = 'settings.json') => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: name.endsWith('.svg') ? 'image/svg+xml' : 'application/json' }));
        document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    };
    window.__set = (selector, value) => {
        const input = document.querySelector(selector);
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__svgParts = text => {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error('Invalid SVG');
        return JSON.stringify([...doc.querySelectorAll('g')].map(g => [g.id,
            [...g.querySelectorAll('path')].map(p => [p.getAttribute('d'), p.getAttribute('stroke'), p.getAttribute('stroke-width')])]));
    };
    window.__recipe = text => JSON.parse(new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('desc').textContent.slice('plotter-geometry:'.length));
`);
await installHelpers();
await evaluate(`
    plotterApp.resetAll();
    plotterApp.select('flower', { pens: 7 });
    plotterApp.select('spirograph');
    __set('[data-param="pens"] input[type=number]', 2);
`);
await click('[data-param="R"] .lock-btn');
await click('[data-param="pens"] .lock-btn');
await evaluate(`plotterApp.select('flower', { pens: 8 })`);
await check(`plotterApp.state.params.flower.pens === 2 && document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'switching to a visited design or preset lost the locked pen count');
await evaluate(`plotterApp.select('moire')`);
await check(`plotterApp.state.params.moire.pens === 2 && JSON.stringify(plotterApp.state.locks.moire) === '["pens"]' && plotterApp.state.locks.spirograph.includes('R')`, 'switching to a new design lost the pen lock or copied other locks');
await evaluate(`plotterApp.randomize(); plotterApp.surprise()`);
await check(`plotterApp.state.params[plotterApp.state.gen].pens === 2 && document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'Surprise lost the locked pen count');
await evaluate(`__set('[data-param="pens"] input[type=number]', 5); plotterApp.select('spirograph');`);
await check(`plotterApp.state.params.spirograph.pens === 5 && plotterApp.state.locks.spirograph.includes('R')`, 'editing a locked pen count did not carry to the next design');
await sleep(650);
await open('index.html');
await installHelpers();
await check(`plotterApp.state.params.spirograph.pens === 5 && document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'reload lost the locked pen count');
await evaluate(`plotterApp.select('moire')`);
await check(`plotterApp.state.params.moire.pens === 5`, 'switching designs after reload lost the locked pen count');
await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'pen-lock.png', { type: 'image/png' }));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    for (let i = 0; i < 100; i++) {
        if (plotterApp.state.gen === 'image') return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Image upload did not switch designs');
})()`);
await check(`plotterApp.state.params.image.pens === 5 && document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'image upload lost the locked pen count');
await click('[data-param="pens"] .lock-btn');
await evaluate(`plotterApp.select('flower', { pens: 8 })`);
await check(`plotterApp.state.params.flower.pens === 8 && !document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'unlocking failed to restore independent pen counts');
await evaluate(`plotterApp.select('moire')`);
await check(`plotterApp.state.params.moire.pens === 5 && !document.querySelector('[data-param="pens"] .lock-btn').classList.contains('locked')`, 'returning to a design reactivated the pen lock');
log('Locked pen counts follow new and visited designs, presets, Surprise and image uploads, survive reload, and stop following after unlocking');

await evaluate(`plotterApp.resetAll(); plotterApp.select('spirograph'); localStorage.removeItem('plotter-geometry:snapshots:v1');`);
await sleep(400);
await evaluate(`plotterApp.resetParams()`);
await check(`!!document.querySelector('#snapGrid .snaps-empty')`, 'snapshot empty state missing');
await click('#snapshotBtn');
await check(`document.querySelectorAll('#snapGrid .snap').length === 1`, 'saved snapshot not displayed');
await evaluate(`
    __set('[data-param="R"] input[type=range]', 80);
    document.querySelector('#snapshotBtn').click();
`);
await sleep(400);
await check(`(() => {
    const snaps = JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1'));
    return document.querySelectorAll('#snapGrid .snap').length === 2 && snaps[0].state.params.spirograph.R === 80 && snaps[0].thumb !== snaps[1].thumb;
})()`, 'snapshot recipe and thumbnail did not include pending edit');
await sleep(350);
await click('#snapGrid .snap:last-child .snap-restore');
await check(`plotterApp.state.params.spirograph.R === 96`, 'snapshot restore failed');
await evaluate(`plotterApp.undo()`);
await sleep(100);
await check(`plotterApp.state.params.spirograph.R === 80`, 'snapshot restore could not be undone');
await click('#snapGrid .snap:first-child .del');
await check(`document.querySelectorAll('#snapGrid .snap').length === 1`, 'snapshot delete failed');
await shot('snapshots.png');
log('Snapshot display, restore, undo, deletion and pending-edit thumbnails OK');

await evaluate(`(async () => {
    __set('[data-key="opt.simplifyTol"] input[type=number]', 0.5);
    __set('[data-key="opt.minLength"] input[type=number]', 2);
    document.querySelector('#penList .pen-row[data-pen="1"] .eye').click();
    __set('#penList .pen-row[data-pen="2"] .pen-name', 'Blue & <細い>');
    __set('#penList .pen-row[data-pen="2"] .num', 0.15);
    await plotterApp.exportAs('svg'); await plotterApp.exportAs('json');
})()`);
const svg = await evaluate(`__downloads.at(-2).blob.text()`);
const json = await evaluate(`__downloads.at(-1).blob.text()`);
await check(`__svgParts(${JSON.stringify(svg)}) === __svgParts(PG.exporters.svg({layers:plotterApp.result.layers.filter(l=>plotterApp.state.pens[l.pen].visible)},plotterApp.state.paper,plotterApp.state.pens))`, 'SVG export used stale geometry');
await check(`JSON.stringify(__recipe(${JSON.stringify(svg)})) === JSON.stringify(JSON.parse(${JSON.stringify(json)}))`, 'SVG and JSON recipes differ');
const importText = async (text, name) => {
    await evaluate(`__drop(${JSON.stringify(text)}, ${JSON.stringify(name)})`);
    await sleep(400);
};
for (const [text, name] of [[svg, 'roundtrip.svg'], [json, 'roundtrip.json']]) {
    await evaluate(`plotterApp.resetAll(); plotterApp.select('maze');`);
    await sleep(300);
    await importText(text, name);
    await evaluate(`plotterApp.exportAs('svg')`);
    const same = await evaluate(`(async () => __svgParts(await __downloads.at(-1).blob.text()) === __svgParts(${JSON.stringify(svg)}))()`);
    assert(same, `${name}: visible SVG geometry/colors/widths changed after restoration`);
    await check(`plotterApp.state.opt.simplifyTol === 0.5 && plotterApp.state.opt.minLength === 2 && !plotterApp.state.pens[1].visible`, 'output settings were not restored');
}
await click('#snapshotBtn');
await evaluate(`plotterApp.resetAll()`);
await sleep(300);
await click('#snapGrid .snap:first-child .snap-restore');
await sleep(400);
await check(`plotterApp.state.opt.simplifyTol === 0.5 && !plotterApp.state.pens[1].visible`, 'snapshot omitted output settings');
log('SVG, JSON and snapshot round trips preserve output settings and visible geometry');

await evaluate(`window.__stateBeforeBad = JSON.stringify(plotterApp.state); window.__resultBeforeBad = plotterApp.result;`);
for (const text of [
    '{"paper":null}',
    '{"gen":"spirograph","params":{"spirograph":null}}',
    '{"gen":"spirograph","paper":{"w":0}}',
    '{"gen":"spirograph","comp":{"rows":100000}}',
    '{"gen":"spirograph","params":{"spirograph":{"R":999999}}}',
    '{"gen":"constructor"}',
    '{"gen":"spirograph","paper":{"__proto__":{"qaPolluted":true}}}',
    '{"gen":"spirograph","unused":{"constructor":{"prototype":{"qaPolluted":true}}}}',
    '{"gen":"spirograph","v":999}',
    'this is not JSON',
]) {
    await importText(text, 'bad.json');
    await check(`JSON.stringify(plotterApp.state) === __stateBeforeBad && plotterApp.result === __resultBeforeBad && ({}).qaPolluted === undefined`, `invalid import damaged the session: ${text}`);
}
await evaluate(`window.__originalGenerate = PG.GenerationRunner.prototype.run; PG.GenerationRunner.prototype.run = async () => { throw new Error('test worker failure'); };`);
await importText('{"gen":"maze"}', 'generation-failure.json');
await evaluate(`PG.GenerationRunner.prototype.run = __originalGenerate`);
await check(`JSON.stringify(plotterApp.state) === __stateBeforeBad && plotterApp.result === __resultBeforeBad`, 'failed generation damaged the session');
await sleep(400);
await check(`JSON.stringify(JSON.parse(localStorage.getItem('plotter-geometry:state:v1'))) === __stateBeforeBad`, 'bad settings reached persistent storage');
log('Malformed files, prototype keys and generation failures leave the drawing and saved session intact');

await evaluate(`(async () => { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__shareLink=text}}}); await plotterApp.exportAs('link'); })()`);
const sharedUrl = await evaluate(`window.__shareLink`);
assert(typeof sharedUrl === 'string' && sharedUrl.includes('#s='), 'Copy share link did not produce a URL');
await evaluate(`plotterApp.resetAll(); plotterApp.state.opt.simplifyTol = 0.2; plotterApp.state.pens[1].visible = true;`);
await sleep(400);
await open('about:blank');
await open(sharedUrl);
await sleep(400);
await installHelpers();
await check(`plotterApp.state.opt.simplifyTol === 0.5 && !plotterApp.state.pens[1].visible && plotterApp.state.gen === 'spirograph'`, 'share link inherited recipient settings');
await evaluate(`plotterApp.exportAs('svg')`);
assert(await evaluate(`(async () => __svgParts(await __downloads.at(-1).blob.text()) === __svgParts(${JSON.stringify(svg)}))()`), 'share link changed drawing');

await importText('{"app":"plotter-geometry","v":1,"gen":"harbour","params":{"harbour":{"inks":"eight"}}}', 'legacy.json');
await check(`plotterApp.state.params.harbour.pens === 8 && plotterApp.state.opt.simplifyTol === 0.02 && plotterApp.state.pens.every(p=>p.visible)`, 'legacy recipe did not migrate with explicit defaults');
log('Shared links and legacy recipes restore independently of recipient settings');

await evaluate(`plotterApp.resetAll();plotterApp.select('spirograph');`);
await sleep(400);
await evaluate(`(async () => {
    __set('[data-param="R"] input[type=range]', 80);
    await plotterApp.exportAs('svg');
    await plotterApp.regenerate();
})()`);
await check(`(async () => {
    const text = await __downloads.at(-1).blob.text();
    return __recipe(text).params.spirograph.R === 80 && __svgParts(text) === __svgParts(PG.exporters.svg(plotterApp.result,plotterApp.state.paper,plotterApp.state.pens));
})()`, 'export before scheduled regeneration used stale paths');
await evaluate(`(async () => { __set('[data-param="pens"] input[type=range]',8); __downloads.length=0; await plotterApp.exportAs('svg-split'); })()`);
await sleep(150);
await evaluate(`__set('[data-param="R"] input[type=range]',110); plotterApp.newSeed(); __set('#penList .pen-row[data-pen="2"] input[type=color]','#abcdef'); __set('#penList .pen-row[data-pen="2"] .num',1.5); plotterApp.select('maze');`);
await sleep(2300);
await check(`(async () => {
    if (__downloads.length !== 8) return false;
    const texts = await Promise.all(__downloads.map(d=>d.blob.text()));
    const saved = __recipe(texts[0]);
    const S = {seed:saved.seed,paperW:saved.paper.w,paperH:saved.paper.h,margin:saved.paper.margin,scale:saved.comp.scale,rotate:saved.comp.rotate,clip:saved.comp.clip,opt:saved.opt};
    const res = PG.run(PG.byId[saved.gen],saved.params[saved.gen],S);
    return texts.every((text,i)=>JSON.stringify(__recipe(text))===JSON.stringify(saved) &&
        __downloads[i].name==='spirograph-1-pen'+(i+1)+'.svg' &&
        __svgParts(text)===__svgParts(PG.exporters.svg(res,saved.paper,saved.pens,{},i)));
})()`, 'split export changed while editing');
await evaluate(`__downloads.length=0; plotterApp.select('spirograph'); plotterApp.exportAs('png'); plotterApp.select('maze');`);
await sleep(500);
await check(`__downloads.length===1 && __downloads[0].name.startsWith('spirograph-') && __downloads[0].blob.type==='image/png'`, 'PNG filename changed during encoding');
log('Pending edits, split SVG batches and asynchronous PNG filenames stay consistent');

await evaluate(`plotterApp.resetAll(); plotterApp.select('maze');`);
await sleep(400);
await evaluate(`(async () => {
    __set('[data-key="comp.cols"] input[type=number]',8);
    __set('[data-key="comp.rows"] input[type=number]',10);
    __set('[data-key="comp.gutter"] input[type=number]',40);
    __set('[data-key="comp.frame"] input[type=checkbox]',true);
    await plotterApp.exportAs('svg');
    await plotterApp.regenerate();
})()`);
await check(`plotterApp.state.comp.gutter===24.5 && document.querySelector('[data-key="comp.gutter"] input[type=number]').value==='24.5'`, 'grid gutter correction missing from controls');
await check(`plotterApp.result.layers.every(l=>l.paths.every(p=>p.every(([x,y])=>x>=15-1e-6&&x<=195+1e-6&&y>=15-1e-6&&y<=282+1e-6)))`, 'grid escaped paper');
await evaluate(`__set('[data-key="paper.size"] select','A6'); __set('[data-key="paper.margin"] input[type=number]',80); plotterApp.exportAs('svg');`);
await check(`plotterApp.state.paper.margin===52 && plotterApp.state.comp.cols===1 && document.querySelector('[data-key="comp.cols"] input[type=number]').value==='1' && document.querySelector('[data-sec="grid"] .badge').textContent==='1 × 10'`, 'small-paper grid corrections missing from UI');
await shot('constrained-grid.png');
await evaluate(`__set('[data-key="paper.size"] select','custom'); __set('[data-key="paper.w"] input[type=number]',50); __set('[data-key="paper.h"] input[type=number]',50); plotterApp.exportAs('svg');`);
await check(`plotterApp.state.comp.cols===1 && plotterApp.state.comp.rows===1 && document.querySelector('[data-key="comp.gutter"]').hidden && document.querySelector('[data-sec="grid"] .badge').textContent==='off'`, 'collapsed grid left stale controls visible');
log('Paper, margins, grid counts and gutter stay synchronized with bounded output');

// Let normal saves settle before deliberately corrupting the saved session.
await sleep(700);
await evaluate(`localStorage.setItem('plotter-geometry:state:v1',JSON.stringify({v:1,gen:'spirograph',paper:null})); localStorage.setItem('plotter-geometry:snapshots:v1',JSON.stringify([null,{time:1,title:'Broken',thumb:'',state:{gen:'spirograph',paper:null}}]));`);
await open('index.html');
await sleep(400);
await check(`!!plotterApp.result && plotterApp.state.paper.w===210`, 'corrupt saved state prevented startup');
await click('#snapGrid .snap-restore');
await check(`!!plotterApp.result && plotterApp.state.paper.w===210`, 'corrupt legacy snapshot damaged recovered session');
await click('#snapGrid .snap .del');
await check(`!!document.querySelector('#snapGrid .snaps-empty')`, 'corrupt snapshot could not be deleted');
await open('index.html');
await sleep(400);
await check(`!!plotterApp.result`, 'recovered session failed on second reload');
log('Corrupt saved state recovers on startup; invalid old snapshots remain deletable');
log('State regression checks finished');
