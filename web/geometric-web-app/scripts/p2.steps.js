// Browser regressions for images, keyboard access, cancellation and slow generation.
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const check = async (expr, message) => assert(await evaluate(expr), message);
const until = async (expr, message) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(50); }
    throw new Error(message);
};
const ready = () => until(`!!plotterApp.result && document.querySelector('#busy').hidden`, 'generation did not finish');
await open('index.html');
await ready();
await evaluate(`localStorage.clear(); plotterApp.resetAll(); plotterApp.select('spirograph');`);
await ready();
const helpers = async () => evaluate(`
    window.__hash = value => { let h = 2166136261; for (const c of JSON.stringify(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
    window.__set = (sel, value) => {
        const input = document.querySelector(sel);
        if (input.type === 'checkbox') input.checked = value; else input.value = value;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    window.__drop = file => {
        const dt = new DataTransfer(); dt.items.add(file);
        document.querySelector('#stage').dispatchEvent(new DragEvent('drop', {dataTransfer:dt,bubbles:true}));
    };
    window.__photo = async (name, invert = false) => {
        const c = document.createElement('canvas'); c.width = 48; c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 48, 64);
        grad.addColorStop(0, invert ? '#fff' : '#000'); grad.addColorStop(1, invert ? '#000' : '#fff');
        g.fillStyle = grad; g.fillRect(0, 0, 48, 64);
        __drop(new File([await new Promise(resolve => c.toBlob(resolve))], name, {type:'image/png'}));
    };
    window.__downloads = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => { if (blob.type !== 'text/javascript') __downloads.push({blob}); return create(blob); };
    HTMLAnchorElement.prototype.click = function () { __downloads.at(-1).name = this.download; };
`);
await helpers();

// Space belongs to native controls. The canvas shortcut must still work.
await click('[data-tab="output"]');
for (const field of ['paper.landscape', 'comp.frame', 'opt.merge']) {
    await evaluate(`document.querySelector('[data-key="${field}"]').closest('details').open = true;
        window.__beforeSeed = plotterApp.state.seed;
        window.__box = document.querySelector('[data-key="${field}"] input'); __box.focus(); window.__checked = __box.checked;`);
    await key(' ', {code:'Space'});
    await check(`__box.checked !== __checked && plotterApp.state.seed === __beforeSeed`, `${field}: Space did not toggle checkbox`);
}
await evaluate(`document.activeElement.blur()`);
await key(' ', {code:'Space'});
await check(`plotterApp.state.seed !== __beforeSeed`, 'Space shortcut no longer changes seed outside controls');
await evaluate(`plotterApp.resetAll()`);
await ready();
log('Space toggles checkboxes without changing the seed; global shortcut still works');

// Sections keep their state through rebuilding, design changes, and reload.
await click('[data-tab="design"]');
await check(`document.querySelector('#params details').dataset.paramSection === 'Pens'`, 'Pens is not first');
await evaluate(`document.querySelector('[data-param-section="Gears"] summary').focus()`);
await key(' ', {code:'Space'});
await check(`!document.querySelector('[data-param-section="Gears"]').open`, 'section cannot collapse with keyboard');
await evaluate(`plotterApp.randomize(); plotterApp.select('maze'); plotterApp.select('spirograph');`);
await check(`!document.querySelector('[data-param-section="Gears"]').open`, 'section collapsed state lost on rebuild');
await until(`JSON.parse(localStorage.getItem('plotter-geometry:state:v1')||'{}').ui?.paramClosed?.includes('spirograph/Gears') && JSON.parse(localStorage.getItem('plotter-geometry:state:v1')).gen==='spirograph'`, 'collapsed section was not saved');
await open('index.html'); await ready(); await helpers();
await check(`!document.querySelector('[data-param-section="Gears"]').open`, 'section collapsed state lost on reload');
await click('[data-tab="design"]');
await shot('collapsible-settings.png');
log('Pens is first; keyboard collapse state survives rebuilds and reload');

// Modal focus wraps in both directions and cannot move into background controls.
for (const [button, dialog] of [['#designBtn','#gallery'], ['#keysBtn','#keysDialog']]) {
    const visible = await evaluate(`!!document.querySelector('${button}').getClientRects().length`);
    const opener = visible ? button : '#designBtn';
    await evaluate(`document.querySelector('${opener}').focus()`);
    if (visible) await click(button); else await key('?');
    await check(`document.querySelector('${dialog}').contains(document.activeElement) && document.querySelector('${dialog}').getAttribute('aria-modal')==='true' && document.querySelector('#layout').inert`, 'modal semantics or initial focus missing');
    await evaluate(`window.__focusable = [...document.querySelector('${dialog}').querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length); __focusable.at(-1).focus();`);
    await key('Tab');
    await check(`document.activeElement === __focusable[0]`, 'Tab escaped dialog');
    await key('Tab', {shift:true});
    await check(`document.activeElement === __focusable.at(-1)`, 'Shift+Tab escaped dialog');
    await evaluate(`document.querySelector('#seed').focus(); window.__modalState=JSON.stringify(plotterApp.state);`);
    await check(`document.querySelector('${dialog}').contains(document.activeElement)`, 'programmatic focus escaped modal');
    await key('r'); await key('z', {ctrl:true});
    await check(`JSON.stringify(plotterApp.state)===__modalState`, 'background shortcuts operated through dialog');
    await key('Escape');
    await check(`document.activeElement===document.querySelector('${opener}') && !document.querySelector('#layout').inert`, `${dialog}: focus or background interaction not restored`);
}
await click('#designBtn');
await evaluate(`document.querySelector('#gallerySearch').value='no-such-design'; document.querySelector('#gallerySearch').dispatchEvent(new Event('input'));`);
await key('Tab', {shift:true});
await check(`document.activeElement.id==='galleryClose'`, 'empty gallery filter breaks focus containment');
await click('#galleryClose');
log('Gallery and shortcut dialogs contain focus, suppress background shortcuts and restore focus');

await evaluate(`plotterApp.resetAll(); plotterApp.select('image'); __photo('first.png')`);
await until(`plotterApp.state.params.image.image==='first.png'`, 'photo did not load'); await ready();
const photoA = await evaluate(`__hash(PG.images.get(plotterApp.state).image.data)`);
const drawingA = await evaluate(`__hash(plotterApp.result.layers)`);
await sleep(450);
await open('index.html'); await ready(); await helpers();
await check(`plotterApp.state.params.image.image==='first.png' && __hash(PG.images.get(plotterApp.state).image.data)===${photoA} && __hash(plotterApp.result.layers)===${drawingA}`, 'reload lost image pixels or changed drawing');
const clearImage = '[data-param="image"] button.icon-btn';
await click(clearImage); await ready();
await check(`!PG.images.get(plotterApp.state).image`, 'clear retained the photo');
await evaluate(`plotterApp.undo()`); await ready();
await check(`__hash(plotterApp.result.layers)===${drawingA}`, 'undo clear did not restore image contents');
await evaluate(`plotterApp.redo()`); await ready();
await check(`!PG.images.get(plotterApp.state).image`, 'redo clear did not remove the image');
await evaluate(`plotterApp.undo()`); await ready();
await evaluate(`__photo('second.png', true)`);
await until(`plotterApp.state.params.image.image==='second.png'`, 'replacement photo did not load'); await ready();
await check(`__hash(PG.images.get(plotterApp.state).image.data)!==${photoA}`, 'replacement photo reused old pixels');
await evaluate(`plotterApp.undo()`); await ready();
await check(`__hash(plotterApp.result.layers)===${drawingA}`, 'undo replacement did not restore old photo');
await click('#snapshotBtn');
await until(`JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1')||'[]').length===1`, 'image snapshot did not save');
await evaluate(`plotterApp.exportAs('json')`);
const portable = await evaluate(`__downloads.at(-1).blob.text()`);
assert(JSON.parse(portable).assets, 'JSON omitted photo contents');
await click(clearImage); await ready(); await sleep(450);
await open('index.html'); await ready(); await helpers();
await click('#snapGrid .snap');
await until(`plotterApp.state.params.image.image==='first.png'`, 'snapshot did not restore photo'); await ready();
await check(`__hash(plotterApp.result.layers)===${drawingA}`, 'snapshot restored filename without correct pixels');

// Clear both forms of browser storage to simulate importing on a different machine.
await sleep(700);
await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('plotter-geometry:images',1); r.onsuccess=()=>{ const db=r.result; const tx=db.transaction('images','readwrite'); tx.objectStore('images').clear(); tx.oncomplete=()=>{db.close();localStorage.clear();resolve()}; tx.onerror=()=>reject(tx.error); };})`);
await open('index.html'); await ready(); await helpers();
await evaluate(`__drop(new File([${JSON.stringify(portable)}], 'portable.json', {type:'application/json'}))`);
await until(`plotterApp.state.params.image?.image==='first.png'`, 'portable image recipe failed to import'); await ready();
await check(`__hash(PG.images.get(plotterApp.state).image.data)===${photoA} && __hash(plotterApp.result.layers)===${drawingA}`, 'portable recipe changed image or geometry');
await evaluate(`plotterApp.exportAs('svg')`);
const imageSVG = await evaluate(`__downloads.at(-1).blob.text()`);
await click(clearImage); await ready();
await evaluate(`__drop(new File([${JSON.stringify(imageSVG)}], 'portable.svg', {type:'image/svg+xml'}))`);
await until(`plotterApp.state.params.image?.image==='first.png'`, 'SVG photo recipe failed to import'); await ready();
await check(`__hash(plotterApp.result.layers)===${drawingA}`, 'SVG photo import changed geometry');

await evaluate(`window.__beforeBad=JSON.stringify(plotterApp.state); window.__beforeDrawing=plotterApp.result;`);
const corrupt = JSON.parse(portable); Object.values(corrupt.assets)[0].pixels = 'bad';
await evaluate(`__drop(new File([${JSON.stringify(JSON.stringify(corrupt))}], 'bad-image.json', {type:'application/json'}))`);
await sleep(300);
await check(`JSON.stringify(plotterApp.state)===__beforeBad && plotterApp.result===__beforeDrawing`, 'invalid image damaged current session');
await evaluate(`window.__put=PG.images.put; PG.images.put=async()=>{throw new Error('Storage full')}; __photo('cannot-save.png')`);
await sleep(300);
await check(`JSON.stringify(plotterApp.state)===__beforeBad`, 'failed image persistence replaced current photo');
await evaluate(`PG.images.put=__put`);
await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__shareLink=text}}); plotterApp.exportAs('link')`);
await check(`!window.__shareLink && [...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('Export a settings JSON or SVG'))`, 'photo sharing offered an incomplete link');
await sleep(700);
const otherDesignLink = await evaluate(`location.href.split('#')[0]+'#s='+btoa(JSON.stringify({app:'plotter-geometry',v:3,gen:'spirograph'}))`);
await open('about:blank'); await open(otherDesignLink); await ready(); await helpers();
await evaluate(`plotterApp.select('image'); plotterApp.regenerate()`);
await check(`__hash(plotterApp.result.layers)===${drawingA}`, 'opening another design share link lost the saved photo');

// Missing browser assets must be recoverable and must not silently use the demo.
await sleep(700);
await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('plotter-geometry:images',1); r.onsuccess=()=>{const db=r.result;const tx=db.transaction('images','readwrite');tx.objectStore('images').clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})`);
await open('index.html'); await helpers();
await until(`!document.querySelector('#errorMsg').hidden && document.querySelector('#busy').hidden`, 'missing saved image did not report an error');
await check(`!plotterApp.result && !document.querySelector('[data-param="image"] button.icon-btn').hidden`, 'missing image silently used demo or could not be cleared');
await click(clearImage); await ready();
await evaluate(`__drop(new File([${JSON.stringify(portable)}], 'restore-photo.json', {type:'application/json'}))`);
await until(`plotterApp.state.params.image?.image==='first.png'`, 'photo could not be restored after missing-asset recovery'); await ready();
log('Photo reload, clear/replace undo and redo, snapshots, portable JSON/SVG and storage failures OK');

// A cold worker must produce the same TSP drawing under CPU throttling.
await evaluate(`(async()=>{__set('[data-param="mode"] select','tsp'); __set('[data-param="points"] input[type=number]',2500); await plotterApp.regenerate()})()`);
const tour = await evaluate(`__hash(plotterApp.result.layers)`);
await protocol('Emulation.setCPUThrottlingRate', {rate:6});
await evaluate(`plotterApp.regenerate()`);
await check(`__hash(plotterApp.result.layers)===${tour}`, 'CPU throttling changed TSP geometry');
await protocol('Emulation.setCPUThrottlingRate', {rate:1});

// Sample the main-thread heartbeat while workers handle A2 scenes.
for (const gen of ['fairground', 'town']) {
    await evaluate(`plotterApp.select('${gen}'); plotterApp.resetAll(); __set('[data-key="paper.size"] select','A2');`);
    await ready();
    await protocol('Emulation.setCPUThrottlingRate', {rate:6});
    const metrics = await evaluate(`(async()=>{
        let last=performance.now(), gaps=[], ticks=0;
        const timer=setInterval(()=>{const now=performance.now(); gaps.push(now-last); last=now; ticks++},16);
        const start=performance.now(); await plotterApp.regenerate();
        await new Promise(r=>setTimeout(r,32)); clearInterval(timer);
        return {elapsed:Math.round(performance.now()-start),maxGap:Math.round(Math.max(...gaps)),ticks};
    })()`);
    log(`${gen} A2 at 6x CPU throttling:`, JSON.stringify(metrics));
    assert(metrics.ticks >= 5 && metrics.maxGap < 500, `${gen}: generation blocked the UI`);
    await protocol('Emulation.setCPUThrottlingRate', {rate:1});
}
await evaluate(`plotterApp.select('fairground'); plotterApp.state.paper={...plotterApp.state.paper,size:'A2',w:420,h:594};
    plotterApp.regenerate(); setTimeout(()=>plotterApp.select('maze'),20);`);
await until(`plotterApp.state.gen==='maze' && !!plotterApp.result && document.querySelector('#busy').hidden`, 'cancellation left stale generation busy');
const finalDrawing = await evaluate(`__hash(plotterApp.result.layers)`);
await sleep(1200);
await check(`plotterApp.state.gen==='maze' && __hash(plotterApp.result.layers)===${finalDrawing}`, 'cancelled worker overwrote new drawing');
await evaluate(`window.__originalRun=PG.GenerationRunner.prototype.run; PG.GenerationRunner.prototype.run=async()=>{throw new Error('test failure')}; plotterApp.regenerate()`);
await check(`!document.querySelector('#errorMsg').hidden && document.querySelector('#busy').hidden && !plotterApp.result`, 'worker failure left stale drawing or spinner');
await evaluate(`plotterApp.exportAs('json')`);
await check(`(async()=>JSON.parse(await __downloads.at(-1).blob.text()).gen==='maze')()`, 'worker failure prevented saving settings');
await evaluate(`PG.GenerationRunner.prototype.run=__originalRun; plotterApp.regenerate()`); await ready();
await check(`document.querySelector('#errorMsg').hidden`, 'generation did not recover from worker failure');
log('TSP throttling, worker responsiveness, cancellation and error recovery OK');

// Gate import generation to exercise edits while its validation is still pending.
const gatedImport = async gen => {
    await evaluate(`
        window.__runImport=PG.GenerationRunner.prototype.run; window.__importStarted=false;
        PG.GenerationRunner.prototype.run=async function(job) {
            __importStarted=true;
            await new Promise(resolve=>window.__continueImport=resolve);
            return __runImport.call(this,job);
        };
        __drop(new File([JSON.stringify({gen:'${gen}',seed:123})],'pending.json',{type:'application/json'}));
    `);
    await until(`__importStarted`, 'import did not reach generation');
};
await gatedImport('fairground');
await click('[data-tab="output"]');
await evaluate(`PG.GenerationRunner.prototype.run=__runImport; __continueImport()`);
await until(`plotterApp.state.gen==='fairground' && plotterApp.state.seed===123`, 'changing tabs cancelled import');
await check(`plotterApp.state.ui.tab==='output'`, 'import reset the selected tab');
await gatedImport('harbour');
await evaluate(`PG.GenerationRunner.prototype.run=__runImport; plotterApp.newSeed(); window.__editedSeed=plotterApp.state.seed; __continueImport()`);
await until(`[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('Settings changed while loading'))`, 'import overwrote an edit made during validation');
await ready();
await check(`plotterApp.state.gen==='fairground' && plotterApp.state.seed===__editedSeed`, 'edit made during import was lost');
log('Pending imports allow panel navigation and preserve later drawing edits');
await shot('final.png');
