const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(src, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export'].forEach(n => load(`lib/${n}.js`));
const ids = ['ribbons', 'stairwell', 'tidal', 'cosmic', 'skyline'];
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
    if (id === 'ribbons') for (const form of ['chain', 'knot', 'rosette']) {
        cases.push([`wide ${form}`, { ...defaults, form, width: 0.65, loops: 5, ribs: 700, rails: 12, twists: 5, tilt: 60 }, {}]);
    }
    if (id === 'stairwell') cases.push(['deep twisted well', { ...defaults, levels: 100, tiles: 24, twist: 3, recede: 0.97, steps: 0.5 }, {}]);
    if (id === 'tidal') for (const style of ['ridges', 'contours', 'wire']) {
        cases.push([`high water ${style}`, { ...defaults, style, studies: 4, lines: 130, water: 75, rise: 65, relief: 60, elev: 20, layout: 'grid', waterLines: false, marks: false }, {}]);
    }
    if (id === 'cosmic') cases.push(['small dense panels', { ...defaults, cols: 5, rows: 8, gutter: 8, layers: 5, spacing: 0.35 }, { paperW: 105, paperH: 148 }]);
    if (id === 'skyline') cases.push(['tall dense city', { ...defaults, scale: 0.7, block: 24, height: 100, elev: 25, bridges: 1, antennas: 1 }, { paperW: 420, paperH: 594 }]);
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
const def = PG.byId.cosmic, params = { ...PG.defaultParams(def), layout: 'grid', cols: 4, rows: 6, gutter: 5, frames: false };
const result = PG.run(def, params, settings), width = settings.paperW - settings.margin * 2, height = settings.paperH - settings.margin * 2;
const cw = (width - (params.cols - 1) * params.gutter) / params.cols, ch = (height - (params.rows - 1) * params.gutter) / params.rows;
for (const layer of result.layers) for (const line of layer.paths) {
    const [x, y] = line[0], col = Math.min(params.cols - 1, Math.floor((x - settings.margin + 1e-6) / (cw + params.gutter))), row = Math.min(params.rows - 1, Math.floor((y - settings.margin + 1e-6) / (ch + params.gutter)));
    const left = settings.margin + col * (cw + params.gutter), top = settings.margin + row * (ch + params.gutter);
    for (const [px, py] of line) assert.ok(px >= left - 1e-5 && px <= left + cw + 1e-5 && py >= top - 1e-5 && py <= top + ch + 1e-5, 'Comic line crosses a panel gutter');
}
console.log(`${total} new-design cases passed: raw coordinates, paper sizes, seeds, controls, extremes, crops, SVG and repeatability. Comic gutters remain clear.`);

// Closed, rounded cloud outlines must mask their whole area, including concave lobes.
const chaikin = PG.geo.chaikin, face = PG.iso.Scene.prototype.face;
let cloudArea = 0, maskArea = 0;
try {
    PG.geo.chaikin = (...args) => {
        const points = chaikin(...args);
        if (args[2]) cloudArea += Math.abs(PG.geo.polygonArea(points));
        return points;
    };
    PG.iso.Scene.prototype.face = function (points, ...args) {
        if (points.every(p => p[2] === 4)) maskArea += Math.abs(PG.geo.polygonArea(points));
        return face.call(this, points, ...args);
    };
    label = 'cosmic: cloud masks';
    for (const seed of [1, 2, 3, 17]) PG.run(def, PG.defaultParams(def), { ...settings, seed });
    assert.ok(cloudArea > 0 && Math.abs(cloudArea - maskArea) < 1e-5, `Cloud masks leave holes: ${maskArea} of ${cloudArea} square millimetres covered`);
} finally { PG.geo.chaikin = chaikin; PG.iso.Scene.prototype.face = face; }
console.log('Rounded cloud masks cover their full silhouettes');
