const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(src, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
const ids = ['ribbons', 'stairwell', 'tidal', 'cosmic', 'skyline', 'trainyard'];
let label;
const finite = points => {
    for (const point of points) assert.ok(point.every(Number.isFinite), `${label}: invalid coordinate ${point}`);
};
// Validate before clipping or optimization can discard invalid geometry.
const Scene = PG.iso.Scene;
PG.iso.Scene = class extends Scene {
    line(points, ...args) { finite(points); return super.line(points, ...args); }
    face(points, ...args) { finite(points); return super.face(points, ...args); }
};
ids.forEach(id => load(`generators/${id}.js`));
const settings = { seed: 1, paperW: 210, paperH: 297, margin: 12, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let total = 0;
for (const id of ids) {
    const def = PG.byId[id], defaults = PG.defaultParams(def), generate = def.generate;
    def.generate = (params, ctx) => {
        const result = generate(params, ctx);
        for (const layer of result.layers) for (const line of (layer.paths || layer)) finite(line);
        return result;
    };
    const cases = [];
    for (const [paperW, paperH] of [[105, 148], [210, 297], [297, 210], [420, 594]]) for (const seed of [1, 17, 4294967295]) {
        cases.push([`${paperW}x${paperH}, seed ${seed}`, PG.randomParams(def, defaults, new PG.RNG(seed)), { paperW, paperH, seed }]);
    }
    for (const q of def.params) {
        const values = q.type === 'range' ? [q.min, q.max] : q.type === 'select' ? q.options.map(o => o[0]) : q.type === 'checkbox' ? [false, true] : [];
        for (const value of values) cases.push([`${q.id}=${value}`, { ...defaults, [q.id]: value }, {}]);
    }
    for (const clip of ['circle', 'hexagon', 'diamond']) cases.push([clip, defaults, { clip, rotate: 37, frame: true }]);
    cases.push(['largest custom paper', defaults, { paperW: 1200, paperH: 1200 }]);
    if (id === 'ribbons') for (const form of ['chain', 'mobius', 'knot', 'eight', 'borromean', 'hopf', 'coil', 'infinity', 'rosette']) {
        cases.push([`wide ${form}`, { ...defaults, form, width: 0.7, loops: 5, rings: 16, coils: 24, knot: '2,7', gap: 0.6, rails: 8, twists: 6, folds: 1, swell: 0.8, waves: 8, tilt: 60, pattern: 'lattice', back: 'cross', edges: 'solid' }, {}]);
        cases.push([`edge-on ${form}`, { ...defaults, form, tilt: -60, turn: 90, lean: 90, pattern: 'ogee', slant: 2, back: 'sparse' }, { paperW: 105, paperH: 148 }]);
    }
    if (id === 'stairwell') for (const section of ['round', 'square', 'octagon', 'hexagon']) for (const look of ['down', 'up']) {
        cases.push([`deep ${section} ${look}`, { ...defaults, section, look, steps: 40, turns: 16, pitch: 0.6, eye: 0.2, fov: 120, shift: 100, posts: 4 }, {}]);
    }
    if (id === 'tidal') for (const style of ['ridges', 'contours', 'hachures', 'wire']) {
        cases.push([`high water ${style}`, { ...defaults, style, studies: 6, first: 90, last: 99, relief: 60, elev: 20, layout: 'grid', sea: 'both', ripples: 14, marks: false }, {}]);
        cases.push([`dense ${style} stack`, { ...defaults, style, studies: 6, first: 0, last: 99, relief: 60, spacing: 0.35, land: 'volcano', layout: 'stack', cutaway: false }, { paperW: 420, paperH: 594 }]);
    }
    if (id === 'cosmic') for (const layout of ['story', 'grid']) {
        cases.push([`small dense ${layout}`, { ...defaults, layout, panels: 40, cols: 5, rows: 8, gutter: 8, detail: 1, stars: 2, spacing: 0.35 }, { paperW: 105, paperH: 148 }]);
    }
    if (id === 'skyline') cases.push(['tall dense city', { ...defaults, scale: 0.7, block: 36, height: 120, variety: 1, elev: 25, bridges: 1, cables: 1, clutter: 1, signs: 1, parks: 0 }, { paperW: 420, paperH: 594 }]);
    let worst = 0;
    for (const [name, params, changes] of cases) {
        label = `${id}: ${name}`;
        const config = { ...settings, ...changes }, result = PG.run(def, params, config);
        assert.ok(result.stats.paths > 0, `${label}: empty drawing`);
        const shape = PG.makeShape(config.clip, config.margin, config.margin, config.paperW - 2 * config.margin, config.paperH - 2 * config.margin);
        for (const layer of result.layers) {
            assert.ok(layer.pen >= 0 && layer.pen < PG.MAX_PENS, `${label}: invalid pen`);
            for (const line of layer.paths) for (const [x, y] of line) {
                assert.ok(Number.isFinite(x) && Number.isFinite(y), `${label}: invalid output`);
                assert.ok(shape.dist(x, y) >= -1e-5, `${label}: point outside crop`);
            }
        }
        const svg = PG.exporters.svg(result, { w: config.paperW, h: config.paperH }, [], { title: def.name });
        assert.ok(!/NaN|Infinity/.test(svg), `${label}: invalid SVG`);
        worst = Math.max(worst, result.timing.total);
    }
    label = `${id}: repeatability`;
    const first = PG.run(def, defaults, settings).layers;
    PG.run(def, PG.randomParams(def, defaults, new PG.RNG(982)), { ...settings, seed: 173 });
    assert.deepEqual(PG.run(def, defaults, settings).layers, first, `${label}: intervening generation changed output`);
    console.log(`${id}: ${cases.length} cases passed, worst ${Math.round(worst)}ms`);
    total += cases.length;
}

// Comic panel masks must preserve empty gutters, even with dense sun rays and planets.
const def = PG.byId.cosmic, params = { ...PG.defaultParams(def), layout: 'grid', cols: 4, rows: 6, gutter: 5, frame: 'none' };
const result = PG.run(def, params, settings), width = settings.paperW - settings.margin * 2, height = settings.paperH - settings.margin * 2;
const cw = (width - (params.cols - 1) * params.gutter) / params.cols, ch = (height - (params.rows - 1) * params.gutter) / params.rows;
for (const layer of result.layers) for (const line of layer.paths) {
    const [x, y] = line[0], col = Math.min(params.cols - 1, Math.floor((x - settings.margin + 1e-6) / (cw + params.gutter))), row = Math.min(params.rows - 1, Math.floor((y - settings.margin + 1e-6) / (ch + params.gutter)));
    const left = settings.margin + col * (cw + params.gutter), top = settings.margin + row * (ch + params.gutter);
    for (const [px, py] of line) assert.ok(px >= left - 1e-5 && px <= left + cw + 1e-5 && py >= top - 1e-5 && py <= top + ch + 1e-5, 'Comic line crosses a panel gutter');
}
// The comic layout has uneven panels, so read them back from the thin frames the generator
// draws, then check a frameless page stays inside them.
const raw = (params, seed, W, H) => {
    const shape = PG.shapes.rect(0, 0, W, H);
    return def.generate(params, { width: W, height: H, seed, rng: new PG.RNG(seed), noise: PG.makeNoise(new PG.RNG(seed)), images: {},
        shape: { ...shape, polygon: () => shape.outline().slice(0, -1) } }).layers;
};
for (const [seed, W, H, panels] of [[1, 186, 273, 14], [5, 186, 273, 30], [9, 273, 186, 8], [12, 81, 124, 40]]) {
    const story = { ...PG.defaultParams(def), panels, gutter: 4 };
    const rects = raw({ ...story, frame: 'thin' }, seed, W, H)[0].filter(q => q.length === 5 && q[0][0] === q[3][0] && q[0][1] === q[1][1] && q[1][0] === q[2][0] && q[2][1] === q[3][1])
        .map(q => [q[0][0], q[0][1], q[2][0], q[2][1]]);
    assert.ok(rects.length >= Math.min(panels, 8), `Comic layout seed ${seed}: panel frames not found`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i], rects[j]];
        assert.ok(a[2] <= b[0] + 1e-6 || b[2] <= a[0] + 1e-6 || a[3] <= b[1] + 1e-6 || b[3] <= a[1] + 1e-6, `Comic layout seed ${seed}: panels overlap`);
    }
    for (const layer of raw({ ...story, frame: 'none' }, seed, W, H)) for (const line of layer) {
        const [x, y] = line[0], r = rects.find(r => x >= r[0] - 1e-6 && x <= r[2] + 1e-6 && y >= r[1] - 1e-6 && y <= r[3] + 1e-6);
        assert.ok(r && line.every(([px, py]) => px >= r[0] - 1e-6 && px <= r[2] + 1e-6 && py >= r[1] - 1e-6 && py <= r[3] + 1e-6), `Comic layout seed ${seed}: line crosses a gutter`);
    }
}
console.log(`${total} new-design cases passed: raw coordinates, paper sizes, seeds, controls, extremes, crops, SVG and repeatability. Comic gutters remain clear.`);

// Cloud masks (columns between the top and bottom profiles) must cover the whole closed outline.
const { face, line } = PG.iso.Scene.prototype;
let cloudArea = 0, maskArea = 0;
try {
    PG.iso.Scene.prototype.face = function (points, ...args) {
        if (this.part === 'cloud') maskArea += Math.abs(PG.geo.polygonArea(points));
        return face.call(this, points, ...args);
    };
    PG.iso.Scene.prototype.line = function (points, ...args) {
        const a = points[0], b = points[points.length - 1];
        if (this.part === 'cloud' && points.length > 3 && a[0] === b[0] && a[1] === b[1]) cloudArea += Math.abs(PG.geo.polygonArea(points));
        return line.call(this, points, ...args);
    };
    label = 'cosmic: cloud masks';
    for (const seed of [1, 2, 3, 17]) PG.run(def, PG.defaultParams(def), { ...settings, seed });
    PG.run(def, { ...PG.defaultParams(def), world: 'skies' }, settings);
    assert.ok(cloudArea > 0 && Math.abs(cloudArea - maskArea) < 1e-9 * cloudArea, `Cloud masks leave holes: ${maskArea} of ${cloudArea} square millimetres covered`);
} finally { Object.assign(PG.iso.Scene.prototype, { face, line }); }
console.log('Cloud masks cover their full silhouettes');
