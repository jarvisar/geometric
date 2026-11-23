#!/usr/bin/env node
/*
 * Wrap under Composition: designs bent round a center (Polar), or in mirrored wedges
 * (Kaleidoscope). Checks that everything lands in the ring or fan, the symmetry of repeats and
 * mirrored wedges, frames, cones, the empty center as a shape for Draw in, covering, grids, and
 * reading the settings.
 *
 *   node scripts/check-wrap.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'stack', 'pipeline', 'settings', 'export', 'loader'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(n => load(`generators/${n}.js`));
const { geo } = PG;

let checks = 0;
const ok = (cond, message) => { checks++; assert.ok(cond, message); };

// Raw geometry, so points can be compared exactly
const RAW = { merge: false, simplify: false, sort: false };
const sheet = (extra = {}) => Object.assign({ seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect', opt: RAW }, extra);
const wrap = (extra = {}) => sheet(Object.assign({ wrap: 'polar', inner: 30, arc: 360, repeats: 1, segments: 8 }, extra));
const run = (gen, S, params = {}) => PG.run(PG.byId[gen], Object.assign(PG.defaultParams(PG.byId[gen]), params), S);
const layer = (gen, comp = {}, params = {}, seed = 3) => ({ gen, params: Object.assign(PG.defaultParams(PG.byId[gen]), params), seed, comp: Object.assign(PG.settings.layerComp(), comp) });
const points = res => res.layers.flatMap(l => l.paths.flat());
const pathsOn = (res, pen) => res.layers.filter(l => l.pen === pen).flatMap(l => l.paths);
// Angle clockwise from straight up, as the wrap measures it
const polar = (q, c) => ({ r: Math.hypot(q[0] - c[0], q[1] - c[1]), a: Math.atan2(q[0] - c[0], -(q[1] - c[1])) });

function inDrawingArea(res, S) {
    for (const q of points(res)) {
        assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]), 'non-finite point');
        assert.ok(q[0] >= S.margin - 1e-6 && q[1] >= S.margin - 1e-6 && q[0] <= S.paperW - S.margin + 1e-6 && q[1] <= S.paperH - S.margin + 1e-6,
            `point outside the drawing area: ${q}`);
    }
    checks++;
}

function inRing(res, c, r0, r1, tol = 1e-6) {
    for (const q of points(res)) {
        const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
        assert.ok(d >= r0 - tol && d <= r1 + tol, `point ${d.toFixed(4)} mm from the center, outside ${r0}..${r1}`);
    }
    checks++;
}

// Distance from each point to the nearest of `pts`, through a bucket grid
function near(pts, cell = 1) {
    const grid = new Map(), key = (i, j) => `${i},${j}`;
    for (const q of pts) {
        const k = key(Math.floor(q[0] / cell), Math.floor(q[1] / cell));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(q);
    }
    return q => {
        let best = Infinity;
        const i = Math.floor(q[0] / cell), j = Math.floor(q[1] / cell);
        for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) for (const p of grid.get(key(a, b)) || []) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
        return best;
    };
}
// Every point of `a` mapped by fn lands on a point of b
function same(a, b, fn, tol, message) {
    const dist = near(b);
    let worst = 0;
    for (const q of a) worst = Math.max(worst, dist(fn(q)));
    ok(worst <= tol, `${message}: off by ${worst.toFixed(4)} mm`);
}

const C = [105, 148.5];

// ---- off: unwrapped drawings don't change
for (const gen of ['truchet', 'spirograph', 'town', 'penrose']) {
    const plain = run(gen, sheet());
    const keys = run(gen, sheet(Object.assign(PG.settings.layerComp(), { inside: -1 })));
    ok(JSON.stringify(plain.layers) === JSON.stringify(keys.layers), `${gen}: the wrap settings changed an unwrapped drawing`);
    ok(!plain.rings, `${gen}: an unwrapped drawing has a ring`);
}
console.log('Wrap set to None leaves drawings as they were');

// ---- polar and kaleidoscope rings stay in the ring, at the size that fits
for (const gen of ['truchet', 'maze', 'flowfield', 'town', 'spirograph', 'penrose', 'ridgelines', 'image', 'sampler']) {
    for (const mode of ['polar', 'kaleido']) {
        const S = wrap({ wrap: mode }), res = run(gen, S);
        inDrawingArea(res, S);
        ok(res.rings && Math.abs(res.rings[0].r1 - 90) < 1e-9 && Math.abs(res.rings[0].r0 - 27) < 1e-9 && res.rings[0].arc === 360 && !res.rings[0].cut,
            `${gen} ${mode}: ring ${JSON.stringify(res.rings)}`);
        inRing(res, C, 27, 90);
        ok(res.stats.paths > 0, `${gen} ${mode}: nothing drawn`);
    }
}
console.log('Polar and Kaleidoscope fill the largest ring that fits, with every line in it');

// a curve keeps its proportions and covers part of the ring, until there are enough repeats
{
    const one = run('spirograph', wrap()).rings[0];
    ok(one.cover > 0.1 && one.cover < 0.25, `one Spirograph covers ${one.cover.toFixed(2)} of the ring`);
    const n = Math.round(1 / one.cover), many = run('spirograph', wrap({ repeats: n })).rings[0];
    ok(many.cover > 0.85, `${n} repeats cover ${many.cover.toFixed(2)} of the ring`);
    ok(run('truchet', wrap()).rings[0].cover > 0.99 && run('town', wrap()).rings[0].cover > 0.99, 'a design that fills the page does not fill the ring');
    const empty = run('celtic', wrap({ repeats: 24 }));
    ok(empty.rings[0].cover === 0 && empty.stats.paths === 0, 'Celtic in 24 repeats should draw nothing, and say so');
}
console.log('Curves keep their proportions, and the ring says how much of it the design covers');

// ---- symmetry: repeats turn, wedges mirror
{
    const S = wrap({ repeats: 3 }), pts = points(run('flowfield', S));
    const turn = a => q => { const x = q[0] - C[0], y = q[1] - C[1]; return [C[0] + x * Math.cos(a) - y * Math.sin(a), C[1] + x * Math.sin(a) + y * Math.cos(a)]; };
    same(pts, pts, turn((2 * Math.PI) / 3), 0.02, 'Repeats 3 is not the same turned a third');

    const K = wrap({ wrap: 'kaleido', segments: 8 }), kp = points(run('flowfield', K));
    // mirror across the line between the first two wedges, -180 + 45 degrees clockwise from up
    const a = -Math.PI + Math.PI / 4, u = [Math.sin(a), -Math.cos(a)];
    const mirror = q => { const x = q[0] - C[0], y = q[1] - C[1], d = x * u[0] + y * u[1]; return [C[0] + 2 * d * u[0] - x, C[1] + 2 * d * u[1] - y]; };
    same(kp, kp, mirror, 0.02, 'Kaleidoscope is not mirrored across its wedges');
    same(kp, kp, turn(Math.PI / 2), 0.02, 'Kaleidoscope with 8 segments is not the same turned a quarter');
}
console.log('Repeats turn the design round, and Kaleidoscope wedges mirror each other');

// ---- fans
for (const [arc, rotate, inner] of [[120, 0, 30], [200, 45, 50], [30, -90, 0], [270, 180, 10], [90, 0, 0]]) {
    const S = wrap({ arc, rotate, inner }), res = run('truchet', S), ring = res.rings[0];
    inDrawingArea(res, S);
    // the fan's box fills the drawing area one way
    const b = geo.bbox(pathsOn(run('truchet', Object.assign({}, S, { frame: true, framePen: 7 })), 7));
    ok(Math.abs(b.w - 180) < 0.5 || Math.abs(b.h - 267) < 0.5, `fan ${arc} at ${rotate}: box ${b.w.toFixed(1)} x ${b.h.toFixed(1)} does not fill the area`);
    // every point within the arc, measured from the ring's center
    const shape = PG.stack.ringShape(...ringCenter(res, S, arc, rotate, inner), ring.r0, ring.r1, geo.rad(rotate - arc / 2), geo.rad(arc), PG.shapes.rect(-1e4, -1e4, 1e4, 1e4));
    for (const q of points(res)) assert.ok(shape.dist(q[0], q[1]) > -1e-6, `fan ${arc} at ${rotate}: point outside it`);
    checks++;
}
// The ring's center, from the frame drawn for it: the corner of the fan's straight edges
function ringCenter(res, S, arc, rotate, inner) {
    const framed = run('truchet', Object.assign({}, S, { frame: true, framePen: 7 }));
    const outline = pathsOn(framed, 7)[0];
    const ring = res.rings[0], a0 = geo.rad(rotate - arc / 2);
    // the outline starts on the outer arc at angle a0
    return [outline[0][0] - ring.r1 * Math.sin(a0), outline[0][1] + ring.r1 * Math.cos(a0)];
}
console.log('Fans stay within their arc and fill the drawing area');

// ---- frames: the ring's circles, a fan's outline, and lines moved in from them
{
    const res = run('truchet', wrap({ frame: true, framePen: 7 })), frame = pathsOn(res, 7);
    ok(frame.length === 2, `a ring with a hole has ${frame.length} frame lines`);
    const radii = frame.map(p => p.map(q => polar(q, C).r));
    ok(radii.some(rs => rs.every(r => Math.abs(r - 90) < 0.01)) && radii.some(rs => rs.every(r => Math.abs(r - 27) < 0.01)), 'frame circles are not at the ring');
    const inset = pathsOn(run('truchet', wrap({ frame: true, framePen: 7, frameInset: 4 })), 7);
    ok(inset.length === 4, `a ring with a second frame line has ${inset.length} frame lines`);
    const solid = pathsOn(run('truchet', wrap({ inner: 0, frame: true, framePen: 7 })), 7);
    ok(solid.length === 1, 'a ring without a hole has an inner frame line');

    for (const [arc, inner, d] of [[120, 30, 4], [90, 0, 3], [240, 0, 3], [180, 0, 3], [40, 5, 6], [300, 60, 2]]) {
        const S = wrap({ arc, inner, frame: true, framePen: 7, frameInset: d }), lines = pathsOn(run('truchet', S), 7), ring = run('truchet', S).rings[0];
        ok(lines.length === 2, `fan ${arc} inner ${inner}: ${lines.length} frame lines`);
        const c = ringCenter(run('truchet', S), S, arc, 0, inner);
        const shape = PG.stack.ringShape(c[0], c[1], ring.r0, ring.r1, geo.rad(-arc / 2), geo.rad(arc), PG.shapes.rect(-1e4, -1e4, 1e4, 1e4));
        const outer = lines.find(p => p.some(q => Math.abs(shape.dist(q[0], q[1])) < 1e-6)), moved = lines.find(p => p !== outer);
        ok(outer && moved, `fan ${arc} inner ${inner}: no outline and second line`);
        for (const q of moved) assert.ok(Math.abs(shape.dist(q[0], q[1]) - d) < 0.02, `fan ${arc} inner ${inner}: second line ${shape.dist(q[0], q[1]).toFixed(3)} mm in, not ${d}`);
        ok(Math.hypot(moved[0][0] - moved.at(-1)[0], moved[0][1] - moved.at(-1)[1]) < 1e-9 && geo.pathLength(moved) > 10, `fan ${arc} inner ${inner}: second line is not closed`);
    }
}
console.log('Draw frame outlines the ring or fan, and the second frame line is moved in evenly');

// ---- glue tabs: a flap outside the fan's last edge, only on a fan's frame
for (const [arc, rotate, inner] of [[200, 0, 40], [120, 90, 30], [100, -30, 0], [340, 180, 60]]) {
    const S = wrap({ arc, rotate, inner, frame: true, framePen: 7, tab: 10 }), res = run('truchet', S), lines = pathsOn(res, 7);
    inDrawingArea(res, S);
    ok(lines.length === 2, `fan ${arc} with a tab: ${lines.length} frame lines`);
    const tab = lines.find(p => p.length === 4), ring = res.rings[0];
    ok(tab && !ring.cut, `fan ${arc}: no tab, or the tab is cut off`);
    // its far side is 10 mm from the edge it folds along
    const a = geo.rad(rotate + arc / 2), e = [Math.sin(a), -Math.cos(a)], n = [Math.cos(a), Math.sin(a)];
    const d = (tab[1][0] - tab[0][0]) * n[0] + (tab[1][1] - tab[0][1]) * n[1];
    ok(Math.abs(d - 10) < 1e-6 && Math.abs((tab[3][0] - tab[0][0]) * e[0] + (tab[3][1] - tab[0][1]) * e[1] - (ring.r1 - ring.r0)) < 1e-6, `fan ${arc}: tab ${d.toFixed(3)} mm wide`);
    const plain = run('truchet', wrap({ arc, rotate, inner, frame: true, framePen: 7 }));
    ok(plain.rings[0].r1 > ring.r1 - 1e-9, 'the fan grew with a tab');
}
ok(pathsOn(run('truchet', wrap({ frame: true, framePen: 7, tab: 10 })), 7).length === 2, 'a full ring got a tab');
ok(pathsOn(run('truchet', wrap({ arc: 200, tab: 10 })), 7).length === 0, 'a tab without the frame');
console.log('Glue tabs go along the last edge of a fan, outside it, and the fan shrinks to fit them');

// ---- cones: the ring info the cone note uses
{
    const S = wrap({ arc: 200 }), ring = run('truchet', S).rings[0];
    ok(Math.abs(ring.r1 - 90) < 1e-9 && Math.abs(ring.r0 - 27) < 1e-9 && ring.arc === 200 && !ring.cut, `fan ring ${JSON.stringify(ring)}`);
    ok(run('truchet', wrap({ scale: 150 })).rings[0].cut, 'a ring scaled past the crop is not marked as cut');
    ok(run('truchet', wrap({ offsetX: 30 })).rings[0].cut, 'a ring moved past the crop is not marked as cut');
    ok(!run('truchet', wrap({ scale: 60, offsetX: 20 })).rings[0].cut, 'a ring inside the crop is marked as cut');
}
console.log('Fans report their radii and whether the crop cuts them');

// ---- scale, offset, crop size, and grids
{
    const half = run('maze', wrap({ scale: 50 }));
    ok(Math.abs(half.rings[0].r1 - 45) < 1e-9, 'Scale 50% does not halve the ring');
    inRing(half, C, 13.5, 45);
    const big = wrap({ scale: 300, offsetX: 40, offsetY: -30 }), bres = run('town', big);
    inDrawingArea(bres, big);
    const moved = run('maze', wrap({ offsetX: 10, offsetY: -20, scale: 80 }));
    inRing(moved, [115, 128.5], 72 * 0.3, 72);
    const small = run('maze', wrap({ size: 40, posX: 30, posY: 40 }));
    inRing(small, [135, 188.5], 36 * 0.3, 36);
    for (const mode of ['polar', 'kaleido']) {
        const G = wrap({ wrap: mode, paperW: 297, paperH: 210, cols: 3, rows: 2, gutter: 6, cellVary: 'seed', frame: true }), g = run('truchet', G);
        inDrawingArea(g, G);
        const { m, cw, ch, gut } = PG.layoutSizes(G);
        for (const q of points(g)) {
            const i = Math.min(2, Math.floor((q[0] - m) / (cw + gut))), j = Math.min(1, Math.floor((q[1] - m) / (ch + gut)));
            const c = [m + i * (cw + gut) + cw / 2, m + j * (ch + gut) + ch / 2];
            assert.ok(Math.hypot(q[0] - c[0], q[1] - c[1]) <= Math.min(cw, ch) / 2 + 1e-6, `grid ${mode}: point outside its cell's ring`);
        }
        checks++;
    }
}
console.log('Scale, Offset, Crop size, and grids place the ring');

// ---- the empty center is a shape for Draw in
{
    ok(!PG.hasCenter({ wrap: 'none', inner: 40 }) && !PG.hasCenter({ wrap: 'polar', inner: 0 }) && PG.hasCenter({ wrap: 'polar', inner: 30 }) &&
        PG.hasCenter({ wrap: 'kaleido', inner: 5 }) && PG.hasCenter({ wrap: 'polar' }), 'which layers have a center');

    // a planet: topography in the center of a wrapped town
    const S = wrap({ inner: 40, layers: [layer('topo', { inside: 0, cover: 'area', inset: 2 })] }), res = run('town', S);
    ok(res.layerInfo[1].shapes === 1 && res.layerInfo[1].used === 1, `the center is not offered as a shape: ${JSON.stringify(res.layerInfo[1])}`);
    // the town on one pen and the topography on another, to tell them apart
    const P = wrap({ inner: 40, layers: [layer('topo', { inside: 0, cover: 'none', inset: 2, pen: 7 })] });
    const center = pathsOn(run('town', P, { pens: 1 }), 7);
    ok(center.length > 10, 'nothing drawn in the center');
    for (const q of center.flat()) assert.ok(Math.hypot(q[0] - C[0], q[1] - C[1]) <= 36 - 2 + 1e-6, 'a line drawn in the center leaves it');
    checks++;

    // only the center, by its kind
    const K = wrap({ inner: 30, layers: [layer('spirograph', { inside: 0, shapes: 'center', pen: 7 })] }), kres = run('penrose', K, { pens: 1 });
    ok(kres.layerInfo[1].shapes === 1, `Shapes set to Center picks ${kres.layerInfo[1].shapes} shapes`);
    for (const q of pathsOn(kres, 7).flat()) assert.ok(Math.hypot(q[0] - C[0], q[1] - C[1]) <= 27 + 1e-6, 'Center shape is not the center');
    checks++;

    // the design's own shapes are bent with it, and stay in the ring
    const T = wrap({ inner: 30, layers: [layer('spirograph', { inside: 0, shapes: 'kind:1', pen: 7, minShape: 2 })] }), tres = run('penrose', T, { pens: 1 });
    ok(tres.layerInfo[1].shapes > 20, `bent tiles offered: ${tres.layerInfo[1].shapes}`);
    for (const q of pathsOn(tres, 7).flat()) {
        const d = Math.hypot(q[0] - C[0], q[1] - C[1]);
        assert.ok(d >= 27 - 1e-6 && d <= 90 + 1e-6, 'a design in a bent tile leaves the ring');
    }
    checks++;

    // a fan's center is a pie slice
    const F = wrap({ arc: 120, inner: 40, layers: [layer('flowfield', { inside: 0, shapes: 'center', pen: 7 })] }), fres = run('truchet', F, { pens: 1 });
    ok(fres.layerInfo[1].used === 1 && pathsOn(fres, 7).length > 0, 'nothing drawn in a fan\'s center');
    // without a hole there is nothing to draw in
    const N = wrap({ inner: 0, layers: [layer('flowfield', { inside: 0, pen: 7 })] }), nres = run('town', N, { pens: 1 });
    ok(pathsOn(nres, 7).length === 0, 'drawn in a center that is not there');

    // the center stays the center when the design's own kinds change
    const M = wrap({ inner: 40, layers: [layer('flowfield', { inside: 0, shapes: 'center', pen: 7 })] });
    for (const style of ['outline', 'mixed']) {
        const mres = run('circlepack', M, { style, pens: 1 });
        ok(mres.layerInfo[1].shapes === 1, `Circle Packing ${style}: Center picks ${mres.layerInfo[1].shapes} shapes`);
        for (const q of pathsOn(mres, 7).flat()) assert.ok(Math.hypot(q[0] - C[0], q[1] - C[1]) <= 36 + 1e-6, `Circle Packing ${style}: Center is not the center`);
        checks++;
    }
    // own kinds still pick the design's shapes, never the center
    const own = run('penrose', wrap({ inner: 30, layers: [layer('spirograph', { inside: 0, shapes: 'kind:0', pen: 7, minShape: 2 })] }), { pens: 1 });
    ok(own.layerInfo[1].shapes > 10, 'a kind of tile picks nothing when wrapped');
    for (const q of pathsOn(own, 7).flat()) assert.ok(Math.hypot(q[0] - C[0], q[1] - C[1]) >= 27 - 1e-6, 'a kind of tile picked the center');
    checks++;
}
console.log('A wrapped layer offers its center, and its own shapes bent with it, to layers drawn in it');

// ---- wrapped layers in the shapes of another, and covering
{
    const S = sheet({ layers: [layer('maze', { inside: 0, wrap: 'kaleido', inner: 20, pen: 7, cover: 'area' })] });
    const res = run('circlepack', S, { style: 'outline', maxR: 40, minR: 12, pens: 1 });
    inDrawingArea(res, S);
    ok(res.layerInfo[1].used > 3 && pathsOn(res, 7).length > 20, 'no wrapped mazes in the circles');

    // covering in shapes leaves the ring's hole, and Outline each shape outlines the shape
    const H = sheet({ layers: [layer('maze', { inside: 0, wrap: 'polar', inner: 50, arc: 200, cover: 'area', frame: true, framePen: 6, pen: 7 })] });
    const P = { style: 'outline', maxR: 40, minR: 30, pens: 1 }, plain = run('circlepack', sheet(), P), hres = run('circlepack', H, P);
    const ink = r => r.layers.filter(l => l.pen === 0).reduce((t, l) => t + l.paths.reduce((a, p) => a + geo.pathLength(p), 0), 0);
    ok(ink(hres) > ink(plain) * 0.9, `covering in a shape removed ${(100 - (100 * ink(hres)) / ink(plain)).toFixed(1)}% of the circles below`);
    const outlines = pathsOn(hres, 6), circles = plain.layers.flatMap(l => l.paths);
    ok(outlines.length === hres.layerInfo[1].used, `${outlines.length} outlines for ${hres.layerInfo[1].used} shapes`);
    for (const o of outlines) {
        const b = geo.bbox([o]);
        ok(Math.abs(b.w - b.h) < 0.5, 'Outline each shape drew the fan, not the circle');
    }
    ok(circles.length > 0, 'no circles');

    // a ring covering a flow field: the hole and the outside keep their lines
    const cover = sheet({ layers: [layer('maze', { wrap: 'polar', inner: 40, cover: 'area', gap: 1, scale: 80, pen: 7 })] });
    const cres = run('flowfield', cover, { pens: 1 }), below = cres.layers.filter(l => l.pen !== 7).flatMap(l => l.paths).flat();
    const r1 = 72, r0 = 28.8;
    let hole = 0, outside = 0;
    for (const q of below) {
        const d = Math.hypot(q[0] - C[0], q[1] - C[1]);
        // covering simplifies outlines to within 0.02 mm
        assert.ok(d <= r0 - 1 + 0.03 || d >= r1 + 1 - 0.03, `a covered line at ${d.toFixed(3)} mm from the center`);
        if (d < r0) hole++; else outside++;
    }
    ok(hole > 50 && outside > 50, `covering a ring left ${hole} points in the hole and ${outside} outside`);
}
console.log('Wrapped layers fit in the shapes of a lower layer, and cover only their ring');

// ---- what Show drawing area outlines, and fans cut by a moved crop
{
    const both = run('truchet', wrap({ layers: [layer('flowfield', {})] }));
    ok(both.outlines.length === 3, `a full-area layer over a wrapped one: ${both.outlines.length} outlines`);
    const plain = run('truchet', sheet({ layers: [layer('flowfield', {})] }));
    ok(plain.outlines.length === 1, 'two full-area layers outline the area twice');
    const moved = run('truchet', wrap({ arc: 200, size: 50, posX: 100 }));
    ok(moved.rings[0].cut, 'a fan moved off the drawing area is not marked as cut');
    ok(!run('truchet', wrap({ arc: 200, size: 50 })).rings[0].cut, 'a fan in a smaller crop is marked as cut');
}
console.log('Show drawing area outlines every layer\'s area, and the cone note knows when the fan is cut off');

// ---- scenes keep the zoom they have on the page, so a thin ring or narrow segments stay quick
for (const gen of ['moonbase', 'castle', 'stadium', 'farmland', 'temple']) {
    const plain = run(gen, sheet()), plainPts = points(plain).length;
    for (const extra of [{ inner: 90 }, { wrap: 'kaleido', segments: 24, inner: 0 }]) {
        const t = performance.now(), res = run(gen, wrap(extra)), ms = performance.now() - t, pts = points(res).length;
        ok(pts < plainPts * 2.5 && ms < 2500, `${gen} ${JSON.stringify(extra)}: ${pts} points against ${plainPts} plain, ${Math.round(ms)} ms`);
    }
}
{
    // Ridgelines drops its side padding round a ring and keeps its lines apart
    const res = run('ridgelines', wrap({ inner: 40 })), ring = res.rings[0];
    ok(ring.cover > 0.99, `Ridgelines covers ${ring.cover.toFixed(2)} of the ring`);
    ok(res.stats.paths < 400, `Ridgelines in a ring has ${res.stats.paths} paths`);
}
console.log('Scenes and Ridgelines adapt to the strip');

// ---- edge cases
for (const [extra, label] of [
    [{ paperW: 50, paperH: 50, margin: 20, inner: 90 }, 'a 10 mm ring with a 90% hole'],
    [{ wrap: 'kaleido', segments: 24, inner: 0, arc: 30 }, '24 segments in 30 degrees'],
    [{ repeats: 24, inner: 90, paperW: 841, paperH: 594 }, '24 repeats in a thin ring on A1'],
    [{ scale: 10 }, 'Scale 10%'],
]) {
    for (const gen of ['truchet', 'town', 'spirograph', 'penrose', 'image']) {
        const S = wrap(extra), res = run(gen, S);
        inDrawingArea(res, S);
    }
    console.log(`No errors with ${label}`);
}

// ---- settings
{
    const comp = PG.settings.layerComp();
    ok(comp.wrap === 'none' && comp.inner === 40 && comp.arc === 360 && comp.repeats === 1 && comp.segments === 8, 'wrap defaults');
    const recipe = { app: 'plotter-geometry', v: 3, gen: 'truchet', comp: { wrap: 'kaleido', inner: 12.5, arc: 200, repeats: 3, segments: 12 },
        layers: [{ gen: 'town', comp: { wrap: 'polar', inner: 45, arc: 360, repeats: 2, segments: 8 } }] };
    const read = PG.settings.read(recipe);
    ok(read.comp.wrap === 'kaleido' && read.comp.inner === 12.5 && read.comp.arc === 200 && read.comp.segments === 12 && read.layers[0].comp.wrap === 'polar' && read.layers[0].comp.repeats === 2,
        'wrap settings did not read back');
    ok(PG.settings.read({ gen: 'truchet' }).comp.wrap === 'none', 'an old recipe is wrapped');
    ok(PG.settings.read({ gen: 'truchet', layers: [{ gen: 'topo', comp: { inside: 0, shapes: 'center' } }] }).layers[0].comp.shapes === 'center', 'Center did not read back');
    ok(PG.settings.read({ gen: 'truchet', comp: { tab: 7.5 } }).comp.tab === 7.5 && comp.tab === 0, 'glue tab setting');
    for (const bad of [{ wrap: 'spiral' }, { segments: 7 }, { segments: 26 }, { inner: 95 }, { shapes: 'centre' }, { tab: 25 }, { arc: 20 }, { arc: 361 }, { repeats: 0 }, { repeats: 1.5 }]) {
        assert.throws(() => PG.settings.read({ gen: 'truchet', comp: bad }), /Invalid settings/, `accepted ${JSON.stringify(bad)}`);
        checks++;
    }
}
console.log('Wrap settings read back, and bad values are rejected');

console.log(`${checks} checks passed`);
