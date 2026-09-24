/*
 * Plotter-ready SVG export: mm units and one Inkscape layer per pen, which
 * AxiDraw's Inkscape extension, vpype and saxi all understand.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const ex = (PG.exporters = {});

    const fmt = (v, d = 3) => {
        const s = v.toFixed(d);
        return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
    };
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // result: output of PG.run; pens: [{ color, width, name }]; meta: { title, description }
    ex.svg = function (result, paper, pens, meta = {}, onlyPen = null) {
        const W = paper.w, H = paper.h;
        const lines = [];
        lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
            `width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`);
        if (meta.title) lines.push(`  <title>${esc(meta.title)}</title>`);
        if (meta.description) lines.push(`  <desc>${esc(meta.description)}</desc>`);
        for (const layer of result.layers) {
            if (onlyPen !== null && layer.pen !== onlyPen) continue;
            const pen = pens[layer.pen] || { color: '#000', width: 0.3 };
            const label = `${layer.pen + 1} ${pen.name || 'Pen ' + (layer.pen + 1)}`;
            lines.push(`  <g inkscape:groupmode="layer" id="layer${layer.pen + 1}" inkscape:label="${esc(label)}" ` +
                `fill="none" stroke="${esc(pen.color)}" stroke-width="${fmt(pen.width)}" stroke-linecap="round" stroke-linejoin="round">`);
            for (const p of layer.paths) {
                let d = `M${fmt(p[0][0])} ${fmt(p[0][1])}`;
                if (p.length > 1) d += 'L' + p.slice(1).map(q => `${fmt(q[0])} ${fmt(q[1])}`).join(' ');
                lines.push(`    <path d="${d}"/>`);
            }
            lines.push('  </g>');
        }
        lines.push('</svg>');
        return lines.join('\n');
    };
})();
