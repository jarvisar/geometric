// Browser regressions for keyboard and screen reader access, short screens, redo timing and
// stored photo cleanup.
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const check = async (expr, message) => assert(await evaluate(expr), message);
const until = async (expr, message) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(50); }
    throw new Error(message);
};
const ready = () => until(`!!plotterApp.result && document.querySelector('#busy').hidden`, 'generation did not finish');
const helperSource = `
    window.__set = (sel, value) => {
        const input = document.querySelector(sel);
        input.value = value;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    window.__photo = async (name, shade) => {
        const c = document.createElement('canvas'); c.width = 40; c.height = 40;
        const g = c.getContext('2d'); g.fillStyle = shade; g.fillRect(0, 0, 40, 40);
        const dt = new DataTransfer();
        dt.items.add(new File([await new Promise(resolve => c.toBlob(resolve))], name, {type:'image/png'}));
        document.querySelector('#stage').dispatchEvent(new DragEvent('drop', {dataTransfer:dt,bubbles:true}));
    };
    window.__stored = () => new Promise((resolve, reject) => {
        const r = indexedDB.open('plotter-geometry:images', 1);
        r.onsuccess = () => { const q = r.result.transaction('images').objectStore('images').getAllKeys(); q.onsuccess = () => { r.result.close(); resolve(q.result.sort()); }; q.onerror = () => reject(q.error); };
    });
    window.__live = () => document.querySelector('#live').textContent;
`;
const helpers = () => evaluate(helperSource);
const restart = async () => { await sleep(450); await open('index.html'); await ready(); await helpers(); };
await open('index.html');
await ready();
await evaluate(`localStorage.clear(); plotterApp.resetAll(); plotterApp.select('spirograph');`);
await restart();

// Redo right after an edit, before the edit's commit has landed, keeps the edit
for (const seed of [100, 200]) { await evaluate(`__set('#seed', ${seed})`); await sleep(400); }
await evaluate(`plotterApp.undo()`);
await evaluate(`__set('#seed', 300); plotterApp.redo()`);
await sleep(400);
await check(`plotterApp.state.seed === 300 && document.querySelector('#redo').disabled`, 'redo during the commit delay replaced a new edit');
log('Redo right after an edit keeps the edit');

// G opens the whole gallery, an empty search says so
await evaluate(`document.activeElement.blur()`);
await key('g');
await check(`!document.querySelector('#gallery').hidden && document.querySelector('#gallerySearch').value === '' &&
    document.querySelector('#galleryEmpty').hidden`, 'G typed into the gallery search');
await evaluate(`__set('#gallerySearch', 'zzzz')`);
await check(`!document.querySelector('#galleryEmpty').hidden && document.querySelector('#galleryEmpty').textContent.includes('zzzz') &&
    __live().includes('No designs match')`, 'no-results message missing or not announced');
await check(`!document.querySelector('#live').inert`, 'live regions are inert while a dialog is open');
await evaluate(`__set('#gallerySearch', 'spiro')`);
await check(`document.querySelector('#galleryEmpty').hidden`, 'no-results message stayed up');
await key('Escape');
log('G opens an unfiltered gallery; empty searches are shown and announced');

// Hints open from the keyboard and describe their control
await evaluate(`document.querySelector('#params .hint').focus()`);
await key(' ', {code:'Space'});
await check(`(() => {
    const b = document.activeElement, hint = document.getElementById(b.getAttribute('aria-controls'));
    const input = b.closest('.ctl').querySelector('input, select');
    return b.classList.contains('hint') && b.getAttribute('aria-expanded') === 'true' && !hint.hidden && hint.textContent.length > 5 &&
        input.getAttribute('aria-describedby') === hint.id;
})()`, 'parameter hint cannot be opened from the keyboard');
await key(' ', {code:'Space'});
await check(`document.activeElement.getAttribute('aria-expanded') === 'false'`, 'parameter hint does not close');

// Toggle buttons expose their state, and every lock says what it locks
const lock = '[data-param="R"] .lock-btn';
await evaluate(`document.querySelector('${lock}').focus()`);
await sleep(200); // fades in
await check(`getComputedStyle(document.querySelector('${lock}')).opacity === '1'`, 'focused lock button is invisible');
await key(' ', {code:'Space'});
await check(`(() => { const b = document.querySelector('${lock}');
    return b.getAttribute('aria-pressed') === 'true' && b.getAttribute('aria-label') === 'Lock ' + b.closest('.ctl').querySelector('label').textContent; })()`, 'lock state or name missing');
await key(' ', {code:'Space'});
await check(`document.querySelector('${lock}').getAttribute('aria-pressed') === 'false'`, 'unlock state missing');
await check(`new Set([...document.querySelectorAll('#params .lock-btn')].map(b => b.getAttribute('aria-label'))).size === document.querySelectorAll('#params .lock-btn').length`, 'lock buttons share a name');
await click('#toggleMargin');
await check(`document.querySelector('#toggleMargin').getAttribute('aria-pressed') === String(plotterApp.state.view.margin)`, 'preview toggle state missing');
await click('#toggleMargin');
await click('[data-tab="output"]');
await check(`document.querySelector('[data-tab="output"]').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-tab="design"]').getAttribute('aria-pressed') === 'false'`, 'panel tab state missing');
await click('#penList .pen-row[data-pen="1"] .eye');
await check(`(() => { const b = document.querySelector('#penList .pen-row[data-pen="1"] .eye');
    return b.getAttribute('aria-pressed') === 'false' && b.getAttribute('aria-label') === 'Show pen 2' && !plotterApp.state.pens[1].visible; })()`, 'pen visibility state missing');
await click('#penList .pen-row[data-pen="1"] .eye');
await click('[data-tab="design"]');
log('Hints, locks, pen visibility, preview toggles and panel tabs work from the keyboard and expose their state');

// Menus track aria-expanded, Escape hands focus back to the menu button, tabbing out closes them
await evaluate(`document.querySelector('#exportMenuBtn').focus()`);
await click('#exportMenuBtn');
await check(`document.querySelector('#exportMenuBtn').getAttribute('aria-expanded') === 'true' && !document.querySelector('#exportMenu').hidden`, 'export menu state missing');
await evaluate(`document.querySelector('#exportMenu button').focus()`);
await key('Escape');
await check(`document.querySelector('#exportMenu').hidden && document.querySelector('#exportMenuBtn').getAttribute('aria-expanded') === 'false' &&
    document.activeElement.id === 'exportMenuBtn'`, 'Escape lost focus or left the menu marked open');
await click('#resetMenuBtn');
await evaluate(`document.querySelector('[data-reset="all"]').focus()`);
await key('Tab');
await check(`document.querySelector('#resetMenu').hidden && document.querySelector('#resetMenuBtn').getAttribute('aria-expanded') === 'false'`, 'reset menu stayed open after tabbing out');
log('Menus expose their state and close with Escape or by tabbing out');

// Toasts and errors reach the live regions
await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['not json'], 'broken.json', {type:'application/json'}));
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop', {dataTransfer:dt,bubbles:true})); })()`);
await until(`document.querySelector('#liveAlert').textContent.includes('Could not load broken.json')`, 'error toast was not announced');

// Snapshots restore and delete from the keyboard, and focus lands on what's left
for (const seed of [11, 22, 33]) {
    await evaluate(`__set('#seed', ${seed})`); await ready();
    await click('#snapshotBtn');
    await until(`JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1') || '[]').length === ${[11, 22, 33].indexOf(seed) + 1}`, 'snapshot did not save');
}
await click('[data-tab="output"]');
await check(`__live().includes('Snapshot saved')`, 'snapshot toast was not announced');
await evaluate(`document.querySelector('#snapGrid .snap-restore').focus()`);
await key('Tab');
await check(`document.activeElement.matches('#snapGrid .snap:first-child .del') && document.activeElement.getClientRects().length > 0`, 'delete button cannot be reached with Tab');
await key(' ', {code:'Space'});
await check(`document.querySelectorAll('#snapGrid .snap').length === 2 && document.activeElement.matches('#snapGrid .snap:first-child .snap-restore') &&
    __live().includes('Deleted Spirograph #33')`, 'keyboard delete removed the wrong snapshot, lost focus or was not announced');
await evaluate(`document.querySelector('#snapGrid .snap:last-child .snap-restore').focus()`);
await key('Delete');
await check(`document.querySelectorAll('#snapGrid .snap').length === 1 && document.activeElement.matches('#snapGrid .snap-restore') &&
    JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1')).map(s => s.state.seed).join() === '22'`, 'Delete key removed the wrong snapshot or lost focus');
await key('Delete');
await check(`!!document.querySelector('#snapGrid .snaps-empty') && document.activeElement.id === 'snapSave'`, 'focus lost after deleting the last snapshot');
await key(' ', {code:'Space'});
await until(`document.querySelectorAll('#snapGrid .snap-restore').length === 1`, 'Save snapshot did not work from the keyboard');
await evaluate(`__set('#seed', 44)`); await ready();
await evaluate(`document.querySelector('#snapGrid .snap-restore').focus()`);
await key(' ', {code:'Space'});
await until(`plotterApp.state.seed === 33`, 'snapshot did not restore from the keyboard');
await click('[data-tab="design"]');
log('Snapshots restore and delete with the keyboard, focus stays put and changes are announced');

// Short screens: the shortcuts list scrolls and keeps its close button, the reset menu stays in view
const viewport = async (width, height, touch) => {
    await protocol('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!touch });
    await protocol('Emulation.setTouchEmulationEnabled', { enabled: !!touch, maxTouchPoints: touch ? 5 : 1 });
    await protocol('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'hover', value: touch ? 'none' : 'hover' }, { name: 'pointer', value: touch ? 'coarse' : 'fine' }] });
    await sleep(300);
};
for (const [w, h] of [[844, 320], [1024, 300]]) {
    await viewport(w, h);
    await evaluate(`document.activeElement.blur()`);
    await key('?');
    await check(`(() => { const close = document.querySelector('[data-close="keysDialog"]').getBoundingClientRect(), keys = document.querySelector('.keys');
        const inner = document.querySelector('.keys-inner').getBoundingClientRect();
        return close.top >= 0 && close.bottom <= innerHeight && inner.top >= 0 && inner.bottom <= innerHeight && keys.scrollHeight > keys.clientHeight; })()`, `shortcuts dialog overflows at ${w}x${h}`);
    await shot(`keys-${w}x${h}.png`);
    await key('Escape');
}
await viewport(568, 320, true);
await click('[data-tab="design"]');
await click('#resetMenuBtn');
await check(`(() => { const all = document.querySelector('[data-reset="all"]').getBoundingClientRect(), panel = document.querySelector('.panel.left').getBoundingClientRect();
    return all.top >= panel.top && all.bottom <= panel.bottom; })()`, 'Reset everything is out of view on a short phone');
await shot('reset-menu-568x320.png');
await key('Escape');
await viewport(1500, 950);
log('Shortcuts dialog and reset menu fit short screens');

// Stored photos nothing refers to are deleted on the next start, unless another tab is open
await evaluate(`plotterApp.select('image'); __photo('kept-by-snapshot.png', '#222')`);
await until(`plotterApp.state.params.image.image === 'kept-by-snapshot.png'`, 'photo did not load'); await ready();
await click('#snapshotBtn');
await until(`JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1')).length === 2`, 'photo snapshot did not save');
for (const [name, shade] of [['replaced.png', '#555'], ['current.png', '#888']]) {
    await evaluate(`__photo('${name}', '${shade}')`);
    await until(`plotterApp.state.params.image.image === '${name}'`, 'photo did not load'); await ready();
}
const refs = await evaluate(`JSON.stringify({ current: plotterApp.state.images.image.image,
    snapshot: JSON.parse(localStorage.getItem('plotter-geometry:snapshots:v1'))[0].state.images.image.image })`);
assert((await evaluate('__stored()')).length === 3, 'expected three stored photos before cleanup');
// A second tab could still undo back to the replaced photo, so it has to stay
const url = await evaluate('location.href');
const { targetId } = await protocol('Target.createTarget', { url });
await until(`navigator.locks.query().then(q => q.held.filter(l => l.name === 'plotter-geometry:tabs').length === 2)`, 'second tab did not start');
await restart();
assert((await evaluate('__stored()')).length === 3, 'a photo was deleted while another tab was open');
await protocol('Target.closeTarget', { targetId });
await sleep(300);
await restart();
const left = await evaluate('__stored()');
assert(JSON.stringify(left) === JSON.stringify(Object.values(JSON.parse(refs)).sort()), `wrong photos left after cleanup: ${JSON.stringify(left)} vs ${refs}`);
await check(`plotterApp.state.params.image.image === 'current.png' && document.querySelector('#errorMsg').hidden`, 'cleanup removed the current photo');
await click('[data-tab="output"]');
await click('#snapGrid .snap:first-child .snap-restore');
await until(`plotterApp.state.params.image.image === 'kept-by-snapshot.png'`, 'snapshot photo did not restore'); await ready();
await check(`document.querySelector('#errorMsg').hidden`, 'cleanup removed a photo a snapshot uses');
log('Unused photos are cleaned up on start, kept while another tab is open, and photos in use survive');

// Cleanup in one tab never deletes what other tabs store or save while it runs. Cleanup is slowed
// down at two points so the other tabs get a turn: before it checks for other open tabs, and
// between that check and the delete.
const inTab = async (session, expr) => {
    const r = await protocol('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, session);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
};
const untilIn = async (session, expr, message) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await inTab(session, expr)) return; await sleep(50); }
    throw new Error(message);
};
const openTab = async () => {
    const { targetId } = await protocol('Target.createTarget', { url });
    const { sessionId } = await protocol('Target.attachToTarget', { targetId, flatten: true });
    await protocol('Runtime.enable', {}, sessionId);
    await untilIn(sessionId, `!!window.plotterApp && !!plotterApp.result && document.querySelector('#busy').hidden`, 'other tab did not start');
    await inTab(sessionId, helperSource);
    return { targetId, session: sessionId };
};
const upload = async (session, name, shade) => {
    await inTab(session, `__photo('${name}', '${shade}')`);
    await untilIn(session, `plotterApp.state.params.image.image === '${name}'`, `${name} did not load`);
    return inTab(session, `plotterApp.state.images.image.image`);
};
const { identifier: slow } = await protocol('Page.addScriptToEvaluateOnNewDocument', { source: `
    const request = navigator.locks.request.bind(navigator.locks), query = navigator.locks.query.bind(navigator.locks);
    const pause = (phase, ms) => { window.__cleanup = phase; return new Promise(r => setTimeout(r, ms)); };
    navigator.locks.request = (name, opts, cb) => name === 'plotter-geometry:image-cleanup' && opts.ifAvailable
        ? request(name, opts, async lock => { if (lock) await pause('before-check', 5000); const out = await cb(lock); window.__cleanup = 'done'; return out; })
        : request(name, opts, cb);
    navigator.locks.query = async () => { const held = await query(); await pause('after-check', 6000); return held; };
    // When this tab last saved its session, so the test can let those saves settle
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'plotter-geometry:state:v1') window.__savedAt = Date.now(); return setItem.call(this, key, value); };
` });

// A tab saves a state with an older photo from its undo history and closes before the check.
// Any save still pending here would overwrite the other tab's.
await ready(); await sleep(500);
let other = await openTab();
await inTab(other.session, `plotterApp.select('image')`);
const older = await upload(other.session, 'older.png', '#333');
const newer = await upload(other.session, 'newer.png', '#999');
await untilIn(other.session, `JSON.parse(localStorage.getItem('plotter-geometry:state:v1'))?.images?.image?.image === '${newer}'`, 'other tab did not save');
await open('index.html');
await helpers();
await until(`window.__cleanup === 'before-check'`, 'cleanup did not start');
// This tab saves its own session as it starts. The other tab's save has to come after that.
await until(`!!plotterApp.result && window.__savedAt && Date.now() - window.__savedAt > 600`, 'this tab did not save');
await inTab(other.session, `plotterApp.undo()`);
await untilIn(other.session, `JSON.parse(localStorage.getItem('plotter-geometry:state:v1'))?.images?.image?.image === '${older}'`, 'undo was not saved');
await protocol('Target.closeTarget', { targetId: other.targetId });
await until(`window.__cleanup === 'done'`, 'cleanup did not finish');
assert((await evaluate('__stored()')).includes(older), 'cleanup deleted the photo a closing tab saved');

// A tab opens after the check and uploads while the delete is still to come
await open('index.html');
await helpers();
await until(`window.__cleanup === 'after-check'`, 'cleanup did not reach its check');
other = await openTab();
assert(await evaluate(`window.__cleanup === 'after-check'`), 'the other tab started too late to upload during the cleanup');
// Stored but not yet in any saved session, which is when a cleanup could take it. It has to wait.
const unsaved = await inTab(other.session, `PG.images.put({ width: 1, height: 1, data: new Float32Array(1) })`);
const late = await upload(other.session, 'late.png', '#666');
await until(`window.__cleanup === 'done'`, 'cleanup did not finish');
const after = await evaluate('__stored()');
assert(after.includes(unsaved) && after.includes(late) && !after.includes(newer), `cleanup deleted another tab's new photo or never ran: ${JSON.stringify(after)}`);
await protocol('Page.reload', {}, other.session);
await sleep(300);
await untilIn(other.session, `!!window.plotterApp && document.querySelector('#busy').hidden && (!!plotterApp.result || !document.querySelector('#errorMsg').hidden)`, 'other tab did not reload');
assert(await inTab(other.session, `plotterApp.state.params.image.image === 'late.png' && document.querySelector('#errorMsg').hidden`), 'other tab lost its photo after reloading');
await protocol('Target.closeTarget', { targetId: other.targetId });
await protocol('Page.removeScriptToEvaluateOnNewDocument', { identifier: slow });
log('Cleanup keeps photos another tab saves or stores while it runs');
