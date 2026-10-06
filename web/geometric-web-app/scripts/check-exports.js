#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const OUT = path.resolve(__dirname, '../shots/exports/fixtures');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'export', 'loader'].forEach(n => load(`lib/${n}.js`));

const paper = { w: 210, h: 297 };
const pens = ['#102030', '#ef4367', '#1d70b8', '#eabb11', '#298741', '#bb26c2', '#00bbcc', '#fffdf2']
    .map((color, i) => ({ color, width: [0.05, 0.35, 0.7, 1, 2, 5, 0.3, 0.4][i], name: `Ink ${i + 1}`, visible: true }));
pens[0].name = 'Café 日本 / \\ <>&"\r\nPen';
pens[1].name = pens[0].name;
const meta = { title: 'Café 日本 🌻 (test) \\ %%EOF\nshowpage', description: '<>&"' };
const formats = ['svg', 'pdf', 'eps', 'dxf'];
fs.mkdirSync(OUT, { recursive: true });

function checkPdf(pdf) {
    assert.equal(Buffer.byteLength(pdf, 'utf8'), pdf.length, 'PDF must stay ASCII for byte offsets');
    const start = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)[1]);
    assert.equal(pdf.slice(start, start + 4), 'xref');
    const xref = pdf.slice(start).split('\n');
    const count = Number(xref[1].split(' ')[1]);
    for (let i = 1; i < count; i++) {
        const offset = Number(xref[i + 2].slice(0, 10));
        assert.equal(pdf.slice(offset, offset + `${i} 0 obj`.length), `${i} 0 obj`);
        assert.equal(xref[i + 2].length, 19);
    }
    const match = pdf.match(/\/Length (\d+) >>\nstream\n/);
    const streamStart = match.index + match[0].length;
    assert.equal(pdf.slice(streamStart + Number(match[1]), streamStart + Number(match[1]) + 9), 'endstream');
    assert(!pdf.includes('/Subtype /Image'));
}

function checkDxf(dxf) {
    assert(!/[^\x00-\x7f]/.test(dxf));
    const lines = dxf.trimEnd().split('\r\n');
    assert.equal(lines.length % 2, 0);
    assert.equal(lines.at(-1), 'EOF');
    const handles = [];
    let section = '';
    for (let i = 0; i < lines.length; i += 2) {
        if (lines[i] === '0' && lines[i + 1] === 'SECTION') section = lines[i + 3];
        if (section !== 'HEADER' && ['5', '105'].includes(lines[i])) handles.push(lines[i + 1]);
    }
    assert.equal(handles.length, new Set(handles).size, 'DXF handles must be unique');
    const seed = parseInt(lines[lines.indexOf('$HANDSEED') + 2], 16);
    assert(seed > Math.max(...handles.map(h => parseInt(h, 16))));
    for (let i = 0; i < lines.length; i += 2) {
        if (lines[i] === '330' && lines[i + 1] !== '0') assert(handles.includes(lines[i + 1]), 'dangling DXF owner');
    }
}

let count = 0;
function fixture(name, result, page = paper, inks = pens, onlyPen = null) {
    const before = JSON.stringify(result);
    for (const format of formats) {
        const file = PG.exporters[format](result, page, inks, meta, onlyPen);
        assert(!/NaN|Infinity|undefined/.test(file), `${name}.${format}: invalid values`);
        if (format === 'pdf') checkPdf(file);
        if (format === 'dxf') checkDxf(file);
        if (format === 'eps') {
            assert(file.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n'));
            assert(!/[^\x00-\x7f]/.test(file));
            assert.equal(file.split('\n').filter(l => l === 'showpage').length, 1, 'metadata escaped');
        }
        fs.writeFileSync(path.join(OUT, `${name}.${format}`), file);
    }
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({
        result: { layers: result.layers.filter(l => onlyPen === null || l.pen === onlyPen) }, paper: page, pens: inks, meta,
    }));
    assert.equal(JSON.stringify(result), before, 'export must not mutate geometry');
    count++;
}

const sample = { layers: [
    { pen: 0, paths: [[[10, 20], [60, 20], [60, 40]], [[75, 25], [100, 25]], [[100, 60], [110, 60], [110, 70], [100, 60]]] },
    { pen: 1, paths: [[[10, 80], [60, 80], [10, 80.0001]], [[75, 75], [75, 75]]] },
    { pen: 7, paths: [[[30, 90], [40, 110]]] },
] };
fixture('asymmetric', sample);
fixture('landscape', sample, { w: 297, h: 210 });
fixture('inch-page', sample, { w: 215.9, h: 279.4 });
fixture('fractional-page', sample, { w: 123.456, h: 234.567 });
fixture('only-pen', sample, paper, pens, 1);
fixture('fallback-pen', sample, paper, []);
fixture('empty', { layers: [] });
fixture('short-paths', { layers: [{ pen: 0, paths: [[], [[5, 5]], [[0, 0], [10, 0]]] }] }, paper, pens, 1);
fixture('page-edge', { layers: [{ pen: 5, paths: [[[0, 0], [210, 0], [210, 297], [0, 297], [0, 0]]] }] });
fixture('long-path', { layers: [{ pen: 2, paths: [Array.from({ length: 10001 }, (_, i) => [10 + i / 60, 50 + Math.sin(i / 40) * 25])] }] });
fixture('dense-eight-pens', { layers: pens.map((pen, i) => ({ pen: i,
    paths: [Array.from({ length: 25001 }, (_, j) => [10 + j / 140, 25 + i * 32 + Math.sin(j / 25) * 10])],
})) });
fixture('maximum-paper', sample, { w: 1200, h: 1200 });

for (const format of ['pdf', 'eps', 'dxf']) {
    for (const bad of [NaN, Infinity, -1, 0, 5081]) assert.throws(() => PG.exporters[format](sample, { w: bad, h: 297 }, pens));
    assert.throws(() => PG.exporters[format]({ layers: [{ pen: 0, paths: [[[0, 0], [NaN, 2]]] }] }, paper, pens));
    assert.throws(() => PG.exporters[format](sample, paper, [{ color: '#nope', width: 1 }]));
    assert.doesNotThrow(() => PG.exporters[format]({ layers: [{ pen: 0, paths: [[], [[5, 5]]] }] }, paper, pens));
}
// SVG keeps its existing recipe/layer behavior.
const svg = PG.exporters.svg(sample, paper, pens, meta);
assert(svg.includes('&lt;&gt;&amp;&quot;'));
assert.equal((svg.match(/inkscape:groupmode="layer"/g) || []).length, 3);

for (const name of PG.GENERATOR_FILES) {
    load(`generators/${name}.js`);
    const def = PG.byId[name];
    const params = PG.defaultParams(def);
    const penParam = def.params.find(p => p.id === 'pens');
    if (penParam) params.pens = penParam.max;
    const result = PG.run(def, params, {
        seed: 19, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 17, clip: 'rect',
        opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 },
    });
    fixture(`design-${name}`, result);
    console.log(`PASS ${name}: ${result.layers.reduce((n, l) => n + l.paths.length, 0)} paths`);
}
console.log(`${count} fixtures passed in all four formats. Files: ${OUT}`);
