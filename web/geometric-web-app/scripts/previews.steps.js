// Preview images for the design pages and screenshots for the about page.
// Renders each design's defaults in the real app so pen colors match what people see.
const fs = process.getBuiltinModule('fs');
const path = process.getBuiltinModule('path');
const SRC = path.resolve('src'); // run from web/geometric-web-app (npm run previews)
const save = (file, b64) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    log('wrote', path.relative(SRC, file), Math.round(fs.statSync(file).size / 1024) + ' KB');
};

await open('index.html');
// Scenes are left off the public pages for now
const ids = await evaluate(`PG.generators.filter(g => g.category !== 'Scenes').map(g => g.id)`);
for (const id of ids) {
    await evaluate(`plotterApp.select('${id}'); plotterApp.resetParams(); plotterApp.regenerate()`);
    // 800px for the design page, 360px for the designs list
    const data = await evaluate(`[800, 360].map(width => {
        const s = plotterApp.state, res = plotterApp.result;
        if (!res || !res.stats.paths) return null;
        const paper = { w: s.paper.w, h: s.paper.h }, k = width / paper.w;
        const c = document.createElement('canvas');
        c.width = width; c.height = Math.round(paper.h * k);
        PG.drawResult(c.getContext('2d'), res, { scale: k, ox: 0, oy: 0 }, { paper, paperColor: s.paper.color, pens: s.pens, minLinePx: 1 });
        return c.toDataURL('image/webp', 0.85).split(',')[1];
    })`);
    if (!data[0]) { log(`${id}: nothing drawn with the defaults, skipped`); continue; }
    save(path.join(SRC, 'images', 'designs', `${id}.webp`), data[0]);
    save(path.join(SRC, 'images', 'designs', 'thumbs', `${id}.webp`), data[1]);
}

const capture = async name => {
    const r = await protocol('Page.captureScreenshot', { format: 'webp', quality: 88 });
    save(path.join(SRC, 'images', name), r.data);
};
await evaluate(`plotterApp.select('topo'); plotterApp.resetParams(); plotterApp.regenerate()`);
await key('f');
await sleep(500);
await capture('app.webp');
await click('#designBtn'); // the G shortcut would also type into the search box
await sleep(12000); // gallery thumbnails render one at a time
await capture('gallery.webp');
