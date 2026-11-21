#!/usr/bin/env node
/*
 * Layers: designs stacked on one sheet, drawn in the shapes of a lower layer, and covering the
 * layers below them. Checks the geometry against brute force, every design that has shapes, each
 * way of covering, grids, and reading layers from saved settings.
 *
 *   node scripts/check-layers.js
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
const L = PG.stack;

let checks = 0;
const ok = (cond, message) => { checks++; assert.ok(cond, message); };
const rng = new PG.RNG(12345);
const R = (a, b) => a + rng.random() * (b - a);

// Raw geometry, so distances to cut ends can be checked exactly
const RAW = { merge: false, simplify: false, sort: false };
const sheet = (extra = {}) => Object.assign({ seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect', opt: RAW }, extra);
const layer = (gen, params = {}, comp = {}, seed = 3) => ({ gen, params: Object.assign(PG.defaultParams(PG.byId[gen]), params), seed, comp });
const run = (gen, params, S) => PG.run(PG.byId[gen], Object.assign(PG.defaultParams(PG.byId[gen]), params), S);
const pathsOn = (res, pen) => res.layers.filter(l => l.pen === pen).flatMap(l => l.paths);

function inDrawingArea(res, S) {
    for (const l of res.layers) for (const p of l.paths) {
        assert.ok(p.length > 1, 'path with fewer than 2 points');
        for (const q of p) {
            assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]), 'non-finite point');
            assert.ok(q[0] >= S.margin - 1e-6 && q[1] >= S.margin - 1e-6 && q[0] <= S.paperW - S.margin + 1e-6 && q[1] <= S.paperH - S.margin + 1e-6,
                `point outside the drawing area: ${q}`);
        }
    }
    checks++;
}

// Points along paths every `step` mm, ends included
function* samples(paths, step = 0.25) {
    for (const p of paths) {
        for (let i = 1; i < p.length; i++) {
            const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(geo.dist(a, b) / step));
            for (let k = i === 1 ? 0 : 1; k <= n; k++) yield [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        }
    }
}

// Distance from a point to the nearest segment of these paths, through a bucket grid
function nearest(paths, cell = 2) {
    const grid = new Map(), key = (i, j) => i * 100003 + j;
    for (const p of paths) for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        for (let gx = Math.floor(Math.min(a[0], b[0]) / cell); gx <= Math.floor(Math.max(a[0], b[0]) / cell); gx++) {
            for (let gy = Math.floor(Math.min(a[1], b[1]) / cell); gy <= Math.floor(Math.max(a[1], b[1]) / cell); gy++) {
                const k = key(gx, gy);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push([a, b]);
            }
        }
    }
    return (x, y, reach) => {
        let best = Infinity;
        const r = Math.ceil(reach / cell);
        const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
        for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
            for (const [a, b] of grid.get(key(i, j)) || []) {
                const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
                let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
                t = Math.max(0, Math.min(1, t));
                best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y));
            }
        }
        return best;
    };
}

// ---------------------------------------------------------------- geometry against brute force

{
    // capsules: a point of a-b is in the interval exactly when it's within r of c-d
    const { capsuleHit } = L._internal;
    for (let n = 0; n < 3000; n++) {
        const s = [R(0, 20), R(0, 20), R(0, 20), R(0, 20)];
        const c = n % 50 ? [R(0, 20), R(0, 20), R(0, 20), R(0, 20)] : [5, 5, 5, 5];
        const r = R(0.1, 4);
        const out = [];
        capsuleHit(...s, ...c, r, out);
        for (let k = 0; k <= 200; k++) {
            const t = k / 200, x = s[0] + (s[2] - s[0]) * t, y = s[1] + (s[3] - s[1]) * t;
            const dx = c[2] - c[0], dy = c[3] - c[1], L2 = dx * dx + dy * dy;
            let u = L2 ? ((x - c[0]) * dx + (y - c[1]) * dy) / L2 : 0;
            u = Math.max(0, Math.min(1, u));
            const d = Math.hypot(c[0] + dx * u - x, c[1] + dy * u - y);
            if (Math.abs(d - r) < 1e-6) continue;
            const hit = out.length === 2 && t >= out[0] - 1e-9 && t <= out[1] + 1e-9;
            assert.equal(hit, d < r, `capsule interval wrong at t=${t}: ${JSON.stringify({ s, c, r, out })}`);
        }
    }
    checks++;

    // concave regions clip to exactly the parts inside
    const star = [];
    for (let i = 0; i < 10; i++) star.push([50 + Math.cos((i * Math.PI) / 5) * (i % 2 ? 12 : 30), 50 + Math.sin((i * Math.PI) / 5) * (i % 2 ? 12 : 30)]);
    const shape = L.regionShape({ poly: star });
    assert.equal(shape.type, 'region');
    for (let n = 0; n < 400; n++) {
        const path = [[R(10, 90), R(10, 90)], [R(10, 90), R(10, 90)], [R(10, 90), R(10, 90)]];
        const inside = shape.clipPaths([path]);
        for (const q of samples(inside, 0.5)) assert.ok(shape.dist(q[0], q[1]) > -1e-6, 'clipped point outside the region');
        // and nothing inside was lost: inside length equals the sampled inside length
        let want = 0, got = 0;
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i], steps = 2000;
            for (let k = 0; k < steps; k++) {
                const t = (k + 0.5) / steps;
                if (geo.pointInPolygon(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, star)) want += geo.dist(a, b) / steps;
            }
        }
        for (const p of inside) got += geo.pathLength(p);
        assert.ok(Math.abs(want - got) < 0.05 + want * 0.002, `clipped length ${got} instead of ${want}`);
    }
    checks++;

    // the largest circle inside
    const { pole } = L._internal;
    const hex = geo.ngon(0, 0, 10, 6);
    assert.ok(Math.abs(pole(hex).r - 10 * Math.cos(Math.PI / 6)) < 0.06, 'hexagon inradius');
    assert.ok(Math.abs(pole([[0, 0], [40, 0], [40, 10], [0, 10]]).r - 5) < 0.06, 'rectangle inradius');
    // an L with 10 mm arms: the circle in the corner, against both outer edges and the inner corner
    const ell = pole([[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]]);
    assert.ok(Math.abs(ell.r - (10 * Math.SQRT2) / (1 + Math.SQRT2)) < 0.06, `L-shape inradius ${ell.r}`);
    checks++;

    // paths nothing touches come back as the same objects; leftovers shorter than the speck go
    const p = [[0, 0], [10, 0]], q = [[0, 5], [10, 5]];
    const cut = L.cover().lines([[[5, -1], [5, 1]]], 0.5).cut([p, q], 1);
    assert.equal(cut.length, 3);
    assert.equal(cut[2], q);
    assert.ok(Math.abs(cut[0][1][0] - 4.5) < 1e-9 && Math.abs(cut[1][0][0] - 5.5) < 1e-9, 'cut ends at the clearance');
    const specks = L.cover().lines([[[1, -1], [1, 1]], [[2.2, -1], [2.2, 1]]], 0.5).cut([p], 1);
    assert.ok(specks.every(s => geo.pathLength(s) >= 1), 'a speck was kept');
    checks++;
}

// ---------------------------------------------------------------- the same drawing without layers

{
    // An empty list of layers and the new placement keys at their defaults change nothing
    for (const gen of ['spirograph', 'truchet', 'voronoi']) {
        const plain = run(gen, {}, sheet({ seed: 4, rotate: 20, clip: 'circle', frame: true }));
        const empty = run(gen, {}, sheet({ seed: 4, rotate: 20, clip: 'circle', frame: true, layers: [], size: 100, posX: 9, posY: 9, pen: -1, hidden: false }));
        assert.deepEqual(empty.layers, plain.layers, `${gen}: layer defaults changed the drawing`);
        assert.equal(empty.layerInfo, undefined);
    }
    checks++;
}

// ---------------------------------------------------------------- every design with shapes

const hosts = [
    ['circlepack', { style: 'outline', maxR: 30, minR: 6 }], ['circlepack', { style: 'mixed' }], ['apollonian', { style: 'outline' }],
    ['voronoi', {}], ['subdivide', {}], ['penrose', {}], ['penrose', { kind: 'P2', edge: 24 }], ['hyperbolic', {}],
    ['truchet', {}], ['truchet', { type: 'hex' }], ['whirl', {}], ['whirl', { layout: 'octagon' }], ['whirl', { layout: 'trihex' }],
];
{
    const designs = PG.generators.filter(d => d.regionKinds).map(d => d.id).sort();
    assert.deepEqual([...new Set(hosts.map(h => h[0]))].sort(), designs, 'a design with shapes is missing from this check');
    for (const [gen, params] of hosts) {
        for (const [guest, placement] of [['spirograph', {}], ['truchet', { rotate: 30 }], ['flowfield', { scale: 70 }]]) {
            for (const S of [sheet({ seed: 2 }), sheet({ seed: 5, rotate: 25, scale: 80, clip: 'hexagon' })]) {
                S.layers = [layer(guest, { pens: 1 }, Object.assign({ inside: 0, cover: 'area', inset: 1, minShape: 4 }, placement))];
                const res = run(gen, params, S);
                inDrawingArea(res, S);
                const info = res.layerInfo[1];
                assert.ok(info.regions > 0 && !info.noShapes, `${gen} ${JSON.stringify(params)} offered no shapes`);
                assert.ok(info.used > 0 && info.used <= info.shapes && info.shapes <= info.regions, `${gen}: shape counts ${JSON.stringify(info)}`);
            }
        }
        // Each kind it names picks some shapes, and together they're all of them
        const def = PG.byId[gen], kinds = def.regionKinds(Object.assign(PG.defaultParams(def), params));
        if (kinds.length) {
            const counts = kinds.map((_, k) => run(gen, params, sheet({ layers: [layer('spirograph', {}, { inside: 0, shapes: `kind:${k}`, minShape: 0, inset: 0 })] })).layerInfo[1].shapes);
            const all = run(gen, params, sheet({ layers: [layer('spirograph', {}, { inside: 0, minShape: 0, inset: 0 })] })).layerInfo[1].shapes;
            assert.equal(counts.reduce((a, b) => a + b, 0), all, `${gen}: kinds don't add up to all shapes`);
            assert.ok(counts.filter(Boolean).length >= Math.min(2, kinds.length), `${gen}: kinds pick nothing`);
        }
    }
    console.log(`${hosts.length} designs with shapes hold a curve, tiles and a flow field, rotated and cropped, and their kinds split the shapes`);
}

// Guests stay inside their circles, by the inset
{
    for (const [gen, params] of [['circlepack', { style: 'outline', maxR: 30, minR: 6 }], ['apollonian', { style: 'outline', outer: false }]]) {
        for (const guest of ['spirograph', 'truchet', 'moire']) {
            const inset = 1.5;
            const S = sheet({ seed: 7, pen: 0, layers: [layer(guest, { pens: 1 }, { inside: 0, inset, minShape: 3, pen: 5, scale: guest === 'spirograph' ? 140 : 100 })] });
            const res = run(gen, Object.assign({ pens: 1 }, params), S);
            // the host draws each circle as a closed path: center and radius from its points
            const circles = pathsOn(res, 0).filter(p => p.length > 8).map(p => {
                const c = p.slice(0, -1).reduce((s, q) => [s[0] + q[0] / (p.length - 1), s[1] + q[1] / (p.length - 1)], [0, 0]);
                return [c[0], c[1], p.reduce((m, q) => Math.max(m, geo.dist(q, c)), 0)];
            });
            const guestPaths = pathsOn(res, 5);
            assert.ok(circles.length > 5 && guestPaths.length, `${gen} / ${guest}: nothing to check`);
            for (const q of samples(guestPaths, 0.5)) {
                assert.ok(circles.some(([x, y, r]) => Math.hypot(q[0] - x, q[1] - y) <= r - inset + 0.02), `${gen} / ${guest}: guest outside its circle at ${q}`);
            }
        }
    }
    checks++;
    console.log('Designs drawn in circles stay inside them by the inset, even scaled up past them');
}

// ---------------------------------------------------------------- covering

{
    const gap = 1.5;
    // Near its lines: no line below comes closer than the clearance
    for (const [base, top] of [['flowfield', 'spirograph'], ['truchet', 'harmonograph'], ['moire', 'maurer']]) {
        const S = sheet({ seed: 9, pen: 0, layers: [layer(top, { pens: 1 }, { cover: 'lines', gap, pen: 1, scale: 70 })] });
        const res = run(base, { pens: 1 }, S);
        const dist = nearest(pathsOn(res, 1));
        let n = 0;
        // the covering lines are simplified to within 0.02 mm first
        for (const q of samples(pathsOn(res, 0), 0.2)) { assert.ok(dist(q[0], q[1], gap + 1) >= gap - 0.02, `${base} under ${top}: line at ${q} is closer than ${gap} mm`); n++; }
        assert.ok(n > 1000, 'nothing below to check');
    }
    checks++;

    // Inside its area: a smaller circle crop clears a disk round it
    {
        const S = sheet({ seed: 3, pen: 0, layers: [layer('truchet', { pens: 1 }, { cover: 'area', gap, pen: 1, clip: 'circle', size: 50, posX: 12, posY: -20 })] });
        const res = run('flowfield', { pens: 1 }, S);
        const cx = 105 + 12, cy = 148.5 - 20, r = Math.min(180, 267) * 0.5 / 2;
        for (const q of samples(pathsOn(res, 0), 0.2)) assert.ok(Math.hypot(q[0] - cx, q[1] - cy) >= r + gap - 1e-6, `line below inside the covered disk at ${q}`);
        for (const q of samples(pathsOn(res, 1), 0.5)) assert.ok(Math.hypot(q[0] - cx, q[1] - cy) <= r + 1e-6, `crop leaked at ${q}`);
        const box = run('flowfield', { pens: 1 }, sheet({ layers: [layer('truchet', {}, { cover: 'none', pen: 1, size: 40, posX: 30, posY: -25 })] }));
        for (const q of samples(pathsOn(box, 1), 0.5)) {
            assert.ok(Math.abs(q[0] - 135) <= 36 + 1e-6 && Math.abs(q[1] - 123.5) <= 53.4 + 1e-6, `smaller crop leaked at ${q}`);
        }
    }
    checks++;

    // Inside its outline: a closed outline clears what it encloses, and the clearance round it
    {
        const S = sheet({ seed: 3, pen: 0, layers: [layer('whirl', { layout: 'single', sides: 5, outline: true, pens: 1 }, { cover: 'outline', gap, pen: 1, scale: 50 })] });
        const res = run('flowfield', { pens: 1 }, S);
        const top = pathsOn(res, 1);
        const rim = top.reduce((a, b) => (geo.bbox([b]).w > geo.bbox([a]).w ? b : a));
        const poly = geo.bbox([rim]).w > 50 ? null : rim;
        // the outline comes as single edges: rebuild the pentagon from all edge ends
        const ends = top.filter(p => p.length === 2).flat();
        const hull = L._internal.hull(ends.length ? ends : poly);
        const dist = nearest(top);
        let inside = 0;
        for (const q of samples(pathsOn(res, 0), 0.2)) {
            if (geo.pointInPolygon(q[0], q[1], hull)) inside++;
            assert.ok(dist(q[0], q[1], gap + 1) >= gap - 0.02, `line below within the clearance at ${q}`);
        }
        assert.equal(inside, 0, 'lines below show inside the outline');
    }
    checks++;

    // Shapes cover inside themselves but leave the outline of the layer below
    {
        const S = sheet({ seed: 2, pen: 0, layers: [layer('spirograph', { pens: 1 }, { inside: 0, cover: 'area', gap: 5, inset: 1, pen: 1 })] });
        const res = run('circlepack', { style: 'rings', pens: 1, maxR: 30, minR: 8 }, S);
        const outer = run('circlepack', { style: 'outline', pens: 1, maxR: 30, minR: 8 }, sheet({ seed: 2 }));
        const rims = pathsOn(outer, 0);
        const kept = nearest(pathsOn(res, 0));
        for (const q of samples(rims, 1)) assert.ok(kept(q[0], q[1], 1) < 1e-6, `the outline of a shape was cut at ${q}`);
    }
    checks++;
    console.log('Covering keeps lines below clear by the clearance near lines, inside outlines and areas, and spares the outlines of shapes');
}

// ---------------------------------------------------------------- hidden layers, pens, grids, caps

{
    // A hidden layer still holds the layers drawn in its shapes
    const S = sheet({ pen: 0, hidden: true, layers: [layer('spirograph', {}, { inside: 0, pen: 2 })] });
    const res = run('voronoi', {}, S);
    assert.equal(pathsOn(res, 0).length, 0, 'a hidden layer was drawn');
    assert.ok(pathsOn(res, 2).length > 20, 'the layer in its shapes went missing');
    // Drawing in a design without shapes draws nothing
    const none = run('flowfield', { pens: 1 }, sheet({ pen: 0, layers: [layer('spirograph', {}, { inside: 0, pen: 2 })] }));
    assert.ok(none.layerInfo[1].noShapes && !pathsOn(none, 2).length, 'drew without shapes to draw in');
    // One pen for a whole layer, the frame on its own
    const pens = run('flowfield', {}, sheet({ layers: [layer('mystery', { pens: 3 }, { pen: 6, frame: true, framePen: 4, clip: 'circle', size: 60 })] }));
    assert.ok(pathsOn(pens, 6).length && pathsOn(pens, 4).length === 1, 'pen override or frame pen');
    checks++;

    // Grids repeat the whole stack, each cell with its own seeds, and a sweep can use any layer
    const grid = (sweep, vary = 'seed') => run('flowfield', { pens: 1 }, sheet({
        cols: 2, rows: 2, gutter: 6, cellVary: vary, sweep, pen: 0,
        layers: [layer('spirograph', { pens: 1 }, { pen: 1, clip: 'circle', size: 60, cover: 'outline', gap: 1 })],
    }));
    const plain = grid(null), swept = grid({ id: 'R', amount: 0.6, layer: 1 }), wrong = grid({ id: 'R', amount: 0.6, layer: 0 });
    inDrawingArea(plain, sheet());
    assert.equal(plain.outlines.length, 8, 'each cell outlines its drawing area and the smaller crop');
    assert.notDeepEqual(pathsOn(swept, 1), pathsOn(plain, 1), 'the sweep on layer 2 changed nothing');
    assert.deepEqual(pathsOn(wrong, 1), pathsOn(plain, 1), 'a sweep of a parameter the layer lacks changed it');
    const params = grid(null, 'params');
    assert.notDeepEqual(pathsOn(params, 1), pathsOn(plain, 1), 'random parameters per cell left the top layer alone');
    checks++;

    // Slow designs fill only their largest shapes
    const capped = run('circlepack', { style: 'outline', maxR: 12, minR: 5 }, sheet({ layers: [layer('alpine', {}, { inside: 0, minShape: 4, inset: 0.5 })] }));
    const info = capped.layerInfo[1];
    assert.ok(info.shapes > 24 && info.used === 24, `capped shapes: ${JSON.stringify(info)}`);
    checks++;

    // Every other shape, each with a seed of its own unless Identical
    const every = run('subdivide', {}, sheet({ layers: [layer('spirograph', {}, { inside: 0, shapes: 'alternate', minShape: 0, inset: 0 })] })).layerInfo[1];
    const all = run('subdivide', {}, sheet({ layers: [layer('spirograph', {}, { inside: 0, minShape: 0, inset: 0 })] })).layerInfo[1];
    assert.equal(every.shapes, Math.ceil(all.shapes / 2), 'every other shape');
    checks++;

    // Same settings, same drawing
    const S3 = () => sheet({ seed: 11, layers: [
        layer('flowfield', { pens: 1 }, { inside: 0, shapes: 'kind:1', cover: 'area', pen: 2 }, 5),
        layer('truchet', { pens: 1, cell: 3 }, { inside: 0, shapes: 'kind:0', cover: 'area', pen: 1, shapeVary: 'params' }, 8),
        layer('spirograph', {}, { cover: 'outline', scale: 40, pen: 3 }, 2),
    ] });
    assert.deepEqual(run('penrose', { decor: 'none', edge: 22 }, S3()).layers, run('penrose', { decor: 'none', edge: 22 }, S3()).layers, 'layers are not repeatable');
    checks++;
    console.log('Hidden layers hold their guests, pens, frames, grids, sweeps, caps and repeat runs all check out');
}

// ---------------------------------------------------------------- concave shapes

{
    // Moving the edges of a concave shape in folds them where short edges meet a sharp corner,
    // which used to lose the whole shape: an L with a chamfered corner, and curved Hyperbolic tiles
    const ell = [[0, 0], [29.3, 0], [30, 0.7], [30, 10], [10, 10], [10, 30], [0, 30]];
    for (const d of [0.5, 1, 3]) {
        const inner = L.inset({ poly: ell }, d);
        assert.ok(inner, `chamfered L lost at inset ${d}`);
        const shape = L.regionShape(inner);
        assert.ok(Math.abs(shape.size / 2 - (5.858 - d)) < 0.06, `chamfered L size at inset ${d}`);
        for (const q of samples(shape.clipPaths([[[-5, 5], [35, 5]], [[5, -5], [5, 35]], [[-5, -5], [35, 35]]]), 0.2)) {
            assert.ok(L._internal.polyDist(ell, q[0], q[1]) >= d - 1e-6, `inset clip leaked at ${q}`);
        }
        const ring = shape.outline();
        assert.ok(ring.length > 4 && ring.every(q => L._internal.polyDist(ell, q[0], q[1]) >= d * 0.98), `inset outline at ${d}`);
    }
    for (const [p, q] of [[5, 4], [3, 8], [7, 3]]) {
        const res = run('hyperbolic', { p, q }, sheet({ layers: [layer('spirograph', {}, { inside: 0, inset: 1.5, minShape: 5 })] }));
        const info = res.layerInfo[1];
        assert.ok(info.shapes > 20 && info.used === info.shapes, `{${p}, ${q}}: ${JSON.stringify(info)}`);
    }
    // A layer in the shapes of a layer drawn in concave shapes stays inside those too. Only the
    // darts here, since a kite sits in the notch of every dart.
    const S = sheet({ seed: 2, pen: 0, layers: [
        layer('subdivide', { pens: 1, minSize: 4 }, { inside: 0, shapes: 'kind:1', inset: 1, minShape: 2, pen: 1, cover: 'none' }),
        layer('spirograph', { pens: 1 }, { inside: 1, inset: 0.5, minShape: 1, pen: 2, scale: 150, cover: 'none' }),
    ] });
    const res = run('penrose', { kind: 'P2', edge: 40, decor: 'none' }, S);
    const darts = [];
    {
        // the darts again, as the pipeline places them
        const def = PG.byId.penrose, ctx = {
            width: 180, height: 267, seed: 2, rng: new PG.RNG(2), noise: PG.makeNoise(new PG.RNG(2 ^ 0x5bd1e995)), wantRegions: true,
            shape: { dist: () => 1e9, inside: () => true, polygon: () => [[0, 0], [180, 0], [180, 267], [0, 267]], kind: 'rect' },
        };
        for (const r of def.generate(Object.assign(PG.defaultParams(def), { kind: 'P2', edge: 40, decor: 'none' }), ctx).regions) {
            if (r.kind === 1 && r.poly.length === 4) darts.push(r.poly.map(q => [q[0] + 15, q[1] + 15]));
        }
    }
    let checked = 0;
    for (const q of samples(pathsOn(res, 2), 0.5)) {
        const dart = darts.find(d => geo.pointInPolygon(q[0], q[1], L._internal.hull(d)));
        if (!dart) continue;
        assert.ok(L._internal.polyDist(dart, q[0], q[1]) >= 1 - 1e-6, `a layer two up leaked into a dart's notch at ${q}`);
        checked++;
    }
    assert.ok(checked > 100, 'no points in darts to check');
    checks++;
    console.log('Concave shapes keep their inset exactly, and layers drawn in their shapes stay inside them');
}

// ---------------------------------------------------------------- Sampler

{
    // A design for every seed, even in a small cell, and the same one again for the same seed
    const def = PG.byId.sampler;
    for (let seed = 1; seed <= 60; seed++) {
        for (const from of ['all', 'Tiles']) {
            const S = sheet({ seed, paperW: 50, paperH: 60, margin: 3, clip: seed % 2 ? 'rect' : 'circle' });
            const res = PG.run(def, { from, settings: 'random', pens: 2 }, S);
            inDrawingArea(res, S);
            assert.ok(res.stats.paths > 0, `Sampler drew nothing for seed ${seed}`);
        }
    }
    const grid = () => PG.run(def, PG.defaultParams(def), sheet({ seed: 4, cols: 3, rows: 3, gutter: 5 }));
    assert.deepEqual(grid().layers, grid().layers, 'Sampler is not repeatable');
    // Every blank cell of a Subdivision big enough to hold something gets a design
    const res = run('subdivide', { wBlank: 1, wHatch: 0, wCross: 0, wNested: 0, pens: 1, minSize: 22 },
        sheet({ seed: 3, pen: 0, layers: [layer('sampler', { pens: 1 }, { inside: 0, cover: 'area', inset: 2, minShape: 8, pen: 2 }, 9)] }));
    const cells = pathsOn(res, 0).filter(p => p.length === 5).map(p => geo.bbox([p])).filter(b => Math.min(b.w, b.h) - 4 >= 8);
    const guest = pathsOn(res, 2).flat();
    assert.ok(cells.length > 10, 'no cells to check');
    for (const b of cells) assert.ok(guest.some(q => q[0] > b.minX && q[0] < b.maxX && q[1] > b.minY && q[1] < b.maxY), `an empty Sampler cell at ${b.minX},${b.minY}`);
    checks++;
    console.log('Sampler draws something for every seed and cell, the same each time');
}

// ---------------------------------------------------------------- saved settings

{
    const read = obj => PG.settings.read(obj);
    const recipe = { app: 'plotter-geometry', v: 3, gen: 'circlepack', seed: 4 };
    const good = {
        ...recipe, comp: { sweepId: 'R', sweepLayer: 2, size: 80, cover: 'lines', inside: 3 },
        layers: [
            { gen: 'flowfield', seed: 9, params: { flowfield: { pens: 2 } }, comp: { inside: 0, shapes: 'kind:3', cover: 'area', gap: 2.5, pen: 4 } },
            { gen: 'spirograph', seed: 7, locks: ['R'], comp: { inside: 1, hidden: true, size: 30, posX: -20 } },
        ],
    };
    const s = read(good);
    assert.equal(s.comp.inside, -1, 'the bottom layer cannot be inside another');
    assert.equal(s.layers.length, 2);
    assert.equal(s.layers[0].comp.inside, 0);
    assert.equal(s.layers[0].comp.shapes, 'kind:3');
    assert.equal(s.layers[0].params.flowfield.pens, 2);
    assert.equal(s.layers[1].comp.hidden, true);
    assert.deepEqual(s.layers[1].locks.spirograph, ['R']);
    assert.equal(s.layers[1].comp.scale, 100, 'missing layer settings take defaults');
    assert.equal(s.comp.sweepId, 'R');
    assert.equal(s.comp.sweepLayer, 2);
    assert.deepEqual(read(JSON.parse(JSON.stringify(s))), s, 'round trip');
    // A layer can only draw in the shapes of one below it
    assert.equal(read({ ...recipe, layers: [{ gen: 'flowfield', comp: { inside: 1 } }] }).layers[0].comp.inside, -1);
    // A sweep of a layer that isn't there, or of a parameter its design lacks, is dropped
    assert.equal(read({ ...recipe, comp: { sweepId: 'R', sweepLayer: 3 } }).comp.sweepId, '');
    assert.equal(read({ ...recipe, comp: { sweepId: 'maxR', sweepLayer: 1 }, layers: [{ gen: 'spirograph' }] }).comp.sweepId, '');
    // The selected layer is session state, kept within the layers there are
    assert.equal(PG.settings.read({ ...good, ui: { layer: 5 } }, true).ui.layer, 2);
    assert.equal(read({ ...good, ui: { layer: 2 } }).ui.layer, 0, 'a recipe chose the selected layer');
    const invalid = [
        { layers: {} }, { layers: Array(6).fill({ gen: 'spirograph' }) }, { layers: [null] }, { layers: [{}] }, { layers: [{ gen: 'missing' }] },
        { layers: [{ gen: '__proto__' }] }, { layers: [{ gen: 'spirograph', seed: -1 }] }, { layers: [{ gen: 'spirograph', params: { spirograph: { R: 1e9 } } }] },
        ...[{ cover: 'all' }, { gap: 0 }, { inside: 6 }, { inside: 1.5 }, { shapes: 'kind:x' }, { shapes: 'kind:20' }, { pen: 8 }, { size: 5 }, { hidden: 1 }, { shapeVary: 'x' }]
            .map(comp => ({ layers: [{ gen: 'spirograph', comp }] })),
        { comp: { sweepLayer: 6 } }, { comp: { cover: 'x' } },
        { layers: [{ gen: 'spirograph', images: { spirograph: { R: 'img-a' } } }] },
    ];
    for (const extra of invalid) assert.throws(() => read({ ...recipe, ...extra }), /Invalid settings/, JSON.stringify(extra));
    assert.throws(() => PG.settings.read({ ...recipe, ui: { layer: 9 } }, true), /Invalid settings/);
    checks++;
    console.log(`Layers read from settings, ${invalid.length} invalid ones are refused`);
}

console.log(`\nAll ${checks} layer checks passed`);
