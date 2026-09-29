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
await protocol('Network.enable');
await protocol('Network.emulateNetworkConditions', {offline:true, latency:0, downloadThroughput:0, uploadThroughput:0});
await open(url);
await evaluate(`plotterApp.regenerate()`);
if (!await evaluate(`plotterApp.state.params.image.image==='offline-photo.png' && JSON.stringify(plotterApp.result.layers)===${JSON.stringify(before)}`)) {
    throw new Error('Offline reload lost photo contents or geometry');
}
for (const gen of await evaluate(`PG.generators.map(g=>g.id)`)) {
    await evaluate(`plotterApp.select('${gen}'); plotterApp.regenerate()`);
    if (!await evaluate(`!!plotterApp.result && document.querySelector('#errorMsg').hidden`)) throw new Error(`Offline ${gen} failed`);
}
await click('#designBtn'); await sleep(1500);
await shot('offline-gallery.png');
await key('Escape');
log(`Offline reload, uploaded photo, all 34 worker designs and gallery OK (${cached.length} cached resources)`);
