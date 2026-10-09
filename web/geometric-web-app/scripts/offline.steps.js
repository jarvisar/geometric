// Serve src on localhost:8127 before running this check.
const url = 'http://127.0.0.1:8127/';
await open(url);
await evaluate(`navigator.serviceWorker.ready`);
await open(url);
await evaluate(`plotterApp.regenerate()`);
const cached = await evaluate(`(async()=>{
    const cache = await caches.open('plotter-geometry-v1');
    return (await cache.keys()).map(r=>new URL(r.url).pathname);
})()`);
for (const name of ['images', 'generation', 'worker-source']) {
    if (!cached.includes(`/lib/${name}.js`)) throw new Error(`${name} missing from offline cache`);
}
await evaluate(`(async()=>{
    plotterApp.select('image');
    const c=document.createElement('canvas'); c.width=32;c.height=32;
    const g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,32,32);
    const file=new File([await new Promise(r=>c.toBlob(r))],'offline-photo.png',{type:'image/png'});
    const dt=new DataTransfer();dt.items.add(file);
    document.querySelector('#stage').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}));
})()`);
await sleep(600);
await evaluate(`plotterApp.regenerate()`);
const before = await evaluate(`JSON.stringify(plotterApp.result.layers)`);
// The service worker fetches through its own target, so it has to be taken offline too.
// Otherwise its network-first fetches still get through and nothing comes from the cache.
const offline = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
const sw = (await protocol('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(url));
if (!sw) throw new Error('Service worker target not found');
const { sessionId } = await protocol('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
for (const session of [sessionId, undefined]) {
    await protocol('Network.enable', {}, session);
    await protocol('Network.emulateNetworkConditions', offline, session);
}
// About is cached on install. A design page that was never opened gets the offline notice,
// not the app's HTML at the wrong path where its scripts and styles don't load.
await open(url + 'about/');
// The second screenshot is lazy loaded, so fetch them rather than check they've loaded
if (!await evaluate(`(async () => !document.querySelector('#params') && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    (await Promise.all([...document.images].map(img => fetch(img.src).then(r => r.ok, () => false)))).every(Boolean))()`)) {
    throw new Error('About page is broken offline');
}
for (const page of ['designs/', 'designs/spirograph/']) {
    await open(url + page);
    if (!await evaluate(`document.title.startsWith('Offline') && !!document.querySelector('a.btn[href="${url}"]')`)) throw new Error(`${page} has no offline notice`);
}
await open(url);
await evaluate(`plotterApp.regenerate()`);
if (!await evaluate(`plotterApp.state.params.image.image==='offline-photo.png' && JSON.stringify(plotterApp.result.layers)===${JSON.stringify(before)}`)) {
    throw new Error('Offline reload lost photo contents or geometry');
}
const designs = await evaluate(`PG.generators.map(g=>g.id)`);
for (const gen of designs) {
    await evaluate(`plotterApp.select('${gen}'); plotterApp.regenerate()`);
    if (!await evaluate(`!!plotterApp.result && document.querySelector('#errorMsg').hidden`)) throw new Error(`Offline ${gen} failed`);
}
await click('#designBtn'); await sleep(1500);
await shot('offline-gallery.png');
await key('Escape');
log(`Offline reload, uploaded photo, all ${designs.length} worker designs, gallery, About page and offline notice OK (${cached.length} cached resources)`);
