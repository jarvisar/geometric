const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = f => vm.runInThisContext(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f });
['core', 'pens', 'noise', 'contours', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
load('generators/blackhole.js');
const def = PG.byId.blackhole, defaults = PG.defaultParams(def);
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let cases = 0, slowest = 0, longest = 0;
function run(params = {}, options = {}) {
    const s = { ...settings, ...options }, p = { ...defaults, ...params };
    const res = PG.run(def, p, s), label = JSON.stringify({ ...params, ...options });
    assert.ok(res.stats.paths > 0, `Empty drawing: ${label}`);
    assert.ok(res.stats.points < 250000, `Unbounded detail: ${label}`);
    for (const layer of res.layers) {
        assert.ok(Number.isInteger(layer.pen) && layer.pen >= 0 && layer.pen < PG.MAX_PENS, `Invalid pen: ${label}`);
        for (const line of layer.paths) {
            assert.ok(line.length >= 2, `Empty stroke: ${label}`);
            for (const [x, y] of line) {
                assert.ok(Number.isFinite(x) && Number.isFinite(y), `Non-finite geometry: ${label}`);
                assert.ok(x >= s.margin - 1e-6 && x <= s.paperW - s.margin + 1e-6 &&
                    y >= s.margin - 1e-6 && y <= s.paperH - s.margin + 1e-6, `Escaped margins: ${label}`);
            }
        }
    }
    slowest = Math.max(slowest, res.timing.generate);
    longest = Math.max(longest, res.stats.draw);
    cases++;
    return res;
}
function raw(params = {}, seed = 1, width = 180, height = 267) {
    const shape = PG.makeShape('rect', 0, 0, width, height);
    return def.generate({ ...defaults, ...params }, {
        seed, rng: new PG.RNG(seed), width, height,
        shape: { inside: shape.inside, polygon: () => shape.outline() },
    }).layers;
}

const first = run();
assert.deepEqual(run().layers, first.layers, 'Same seed must reproduce the drawing');
assert.notDeepEqual(run({}, { seed: 2 }).layers, first.layers, 'Seed should vary the gas and stars');
for (const structure of ['rings', 'spiral', 'turbulent']) {
    for (const incl of [0, 55, 77, 89]) for (const outer of [10, 60]) run({ structure, incl, outer });
    for (const bound of ['min', 'max']) {
        const params = Object.fromEntries(def.params.filter(q => q.type === 'range').map(q => [q.id, q[bound]]));
        run({ ...params, structure });
    }
    for (const winding of [0.5, 3]) {
        // With shading and culling out of the way, every band must stay inside the next one.
        const rings = raw({ structure, flow: 1, winding, rings: 24, incl: 0, tilt: 0,
            stars: 0, shade: false, under: false, photon: false, pens: 1 }, 7, 1000, 1000)[0];
        assert.equal(rings.length, 25, 'Expected every full band at large scale');
        for (let i = 1; i < rings.length; i++) for (let j = 0; j < rings[i - 1].length; j += 12) {
            assert.ok(PG.geo.pointInPolygon(...rings[i - 1][j], rings[i]), `${structure}/${winding}: bands cross`);
        }
    }
}
for (const q of def.params.filter(q => q.type === 'range')) for (const value of [q.min, q.max]) run({ [q.id]: value });
for (const under of [false, true]) for (const photon of [false, true]) for (const shade of [false, true]) run({ under, photon, shade });
for (let seed = 1; seed <= 12; seed++) run(PG.randomParams(def, defaults, new PG.RNG(seed * 13)), { seed });
for (const [paperW, paperH] of [[105, 148], [420, 594], [297, 210], [100, 100]]) run({}, { paperW, paperH });
for (const clip of ['circle', 'hexagon', 'diamond']) run({}, { rotate: 30, clip, frame: true });
run({}, { paperW: 297, paperH: 210, cols: 2, rows: 2, gutter: 6, cellVary: 'seed' });
for (let pens = 1; pens <= 8; pens++) assert.equal(run({ pens }).layers.filter(l => l.paths.length).length, pens);

const smooth = raw({ structure: 'rings', stars: 0 });
for (const structure of ['spiral', 'turbulent']) {
    assert.deepEqual(raw({ structure, flow: 0, stars: 0 }), smooth, 'Zero flow should restore smooth rings');
    assert.notDeepEqual(raw({ structure, stars: 0 }), smooth, 'Pattern should change the disk');
}
assert.deepEqual(raw({ structure: 'rings', flow: 1, winding: 3, stars: 0 }), smooth, 'Hidden controls changed smooth rings');
for (const incl of [0, 77, 89]) for (const tilt of [-90, -12, 90]) {
    const disk = raw({ incl, tilt, stars: 0 }), sky = raw({ incl, tilt, stars: 240 });
    disk.forEach((layer, i) => assert.deepEqual(sky[i].slice(0, layer.length), layer, 'Stars changed disk strokes or pen assignments'));
    assert.equal(disk[0].length, 0, 'Disk drawn on the star pen');
    const stars = sky[0].slice(disk[0].length);
    assert.ok(stars.length >= 240, 'Sky failed to place the requested stars');
    // Every star segment must clear the visible disk lines, including its two rims.
    const buckets = new Map();
    for (const line of disk.flat()) for (let i = 1; i < line.length; i++) {
        const b = line[i - 1], c = line[i];
        for (let x = Math.floor((Math.min(b[0], c[0]) - 0.3) / 2); x <= Math.floor((Math.max(b[0], c[0]) + 0.3) / 2); x++) {
            for (let y = Math.floor((Math.min(b[1], c[1]) - 0.3) / 2); y <= Math.floor((Math.max(b[1], c[1]) + 0.3) / 2); y++) {
                const key = `${x},${y}`;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push([b, c]);
            }
        }
    }
    for (const star of stars) for (const a of star.concat(star.slice(1).map((b, i) => PG.geo.lerpPt(star[i], b, 0.5)))) {
        for (const [b, c] of buckets.get(`${Math.floor(a[0] / 2)},${Math.floor(a[1] / 2)}`) || []) {
            const dx = c[0] - b[0], dy = c[1] - b[1], d = dx * dx + dy * dy;
            const t = d ? Math.max(0, Math.min(1, ((a[0] - b[0]) * dx + (a[1] - b[1]) * dy) / d)) : 0;
            assert.ok(Math.hypot(a[0] - b[0] - t * dx, a[1] - b[1] - t * dy) > 0.3, 'Star touches disk');
        }
    }
}
// Face-on, the direct disk is an annulus. Its blank spaces are still opaque.
const face = { incl: 0, tilt: 0, pens: 1, under: false, photon: false, shade: false };
const annulus = raw({ ...face, stars: 0 })[0], faceSky = raw({ ...face, stars: 240 })[0].slice(annulus.length);
const center = [90, 133.5], distances = annulus.flat().map(q => PG.geo.dist(q, center));
const inner = Math.min(...distances), outer = Math.max(...distances);
for (const q of faceSky.flat()) {
    const r = PG.geo.dist(q, center);
    assert.ok(r < inner || r > outer, 'Star leaked through the opaque disk');
    assert.ok(r > inner * 0.7, 'Star leaked into the central shadow');
}
const eight = run({ pens: 8, redshift: 12 });
for (const kind of ['svg', 'pdf', 'eps', 'dxf']) {
    const exported = PG.exporters[kind](eight, { w: 210, h: 297 }, [], { title: def.name });
    assert.ok(exported.length > 1000 && !/NaN|Infinity|undefined/.test(exported), `Invalid ${kind} export`);
    if (kind === 'svg') assert.equal((exported.match(/inkscape:groupmode="layer"/g) || []).length, 8);
}
console.log(`Black Hole: ${cases} pipeline cases passed, plus nested bands, independent stars, disk clearance and four export formats. Longest ${(longest / 1000).toFixed(1)} m. Slowest generation ${slowest.toFixed(0)} ms.`);
