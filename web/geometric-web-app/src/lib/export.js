// Vector writers use the finished millimeter paths, including their plotting order.
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});
    const ex = (PG.exporters = {});

    const fmt = (v, d = 3) => {
        const s = v.toFixed(d);
        return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
    };
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // One <path> per pen, with each stroke as a subpath in plotting order. Bambu Suite and
    // similar importers make an object per path element, so the scenes used to come in as
    // thousands of objects. Huge layers still get split, Inkscape's XML parser gives up on
    // attributes over 10 MB.
    const MAX_D = 1000000;

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
            const style = `fill="none" stroke="${esc(pen.color)}" stroke-width="${fmt(pen.width)}" stroke-linecap="round" stroke-linejoin="round"`;
            lines.push(`  <g inkscape:groupmode="layer" id="layer${layer.pen + 1}" inkscape:label="${esc(label)}" ${style}>`);
            // the style is repeated on the path for importers that ignore what it inherits from the group
            const flush = d => { if (d.length) lines.push(`    <path ${style} d="${d.join('')}"/>`); };
            let d = [], size = 0;
            for (const p of layer.paths) {
                let s = `M${fmt(p[0][0])} ${fmt(p[0][1])}`;
                if (p.length > 1) s += 'L' + p.slice(1).map(q => `${fmt(q[0])} ${fmt(q[1])}`).join(' ');
                if (size + s.length > MAX_D) { flush(d); d = []; size = 0; }
                d.push(s);
                size += s.length;
            }
            flush(d);
            lines.push('  </g>');
        }
        lines.push('</svg>');
        return lines.join('\n');
    };

    const PT = 72 / 25.4;
    const num = v => fmt(v, 5);
    const rgb = color => {
        const hex = color.replace(/^#/, '').replace(/^([\da-f])([\da-f])([\da-f])$/i, '$1$1$2$2$3$3');
        if (!/^[\da-f]{6}$/i.test(hex)) throw new Error('Invalid pen color');
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    };
    function drawing(result, paper, pens, onlyPen) {
        if (![paper.w, paper.h].every(n => Number.isFinite(n) && n > 0 && n <= 5080)) {
            throw new Error('Vector export needs a paper size between 0 and 5080 mm');
        }
        return result.layers.filter(l => onlyPen === null || l.pen === onlyPen).map(layer => {
            const pen = pens[layer.pen] || { color: '#000000', width: 0.3 };
            if (!Number.isFinite(pen.width) || pen.width <= 0) throw new Error('Invalid pen width');
            const paths = layer.paths.filter(p => p.length >= 2);
            for (const p of paths) for (const q of p) {
                if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) throw new Error('Invalid path coordinates');
            }
            return { ...layer, paths, width: pen.width, color: rgb(pen.color), name: pen.name || `Pen ${layer.pen + 1}` };
        });
    }

    // Older PostScript interpreters have small path limits. Overlapping round caps
    // preserve round joins when a long, opaque stroke is split at a vertex.
    function* chunks(paths) {
        for (const p of paths) {
            for (let start = 0; start < p.length - 1; start += 1000) yield p.slice(start, start + 1001);
        }
    }

    // UTF-16BE hex strings keep the entire PDF ASCII, including Unicode titles.
    // String lengths then equal the byte offsets required by the xref table.
    function pdfString(value) {
        let hex = 'FEFF';
        for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0');
        return `<${hex}>`;
    }

    ex.pdf = function (result, paper, pens, meta = {}, onlyPen = null) {
        const layers = drawing(result, paper, pens, onlyPen);
        const commands = ['q', '1 J 1 j', '[] 0 d'];
        for (const layer of layers) {
            commands.push(`${layer.color.map(c => num(c / 255)).join(' ')} RG`, `${num(layer.width * PT)} w`);
            for (const p of chunks(layer.paths)) {
                p.forEach((q, i) => commands.push(`${num(q[0] * PT)} ${num((paper.h - q[1]) * PT)} ${i ? 'l' : 'm'}`));
                commands.push('S');
            }
        }
        commands.push('Q');
        const stream = commands.join('\n') + '\n';
        const box = `0 0 ${num(paper.w * PT)} ${num(paper.h * PT)}`;
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /CropBox [${box}] /Resources << >> /Contents 4 0 R >>`,
            `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
            `<< /Title ${pdfString(String(meta.title || 'Plotter Geometry'))} /Creator (Plotter Geometry) >>`,
        ];
        let file = '%PDF-1.4\n';
        const offsets = [0];
        objects.forEach((obj, i) => {
            offsets.push(file.length);
            file += `${i + 1} 0 obj\n${obj}\nendobj\n`;
        });
        const xref = file.length;
        file += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
        for (const offset of offsets.slice(1)) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
        file += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return file;
    };

    ex.eps = function (result, paper, pens, meta = {}, onlyPen = null) {
        const layers = drawing(result, paper, pens, onlyPen);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const layer of layers) for (const p of layer.paths) for (const q of p) {
            const r = layer.width / 2;
            minX = Math.min(minX, q[0] - r); maxX = Math.max(maxX, q[0] + r);
            minY = Math.min(minY, paper.h - q[1] - r); maxY = Math.max(maxY, paper.h - q[1] + r);
        }
        // EPS bounds include the ink, clipped to the paper just like SVG and PDF.
        const bounds = Number.isFinite(minX)
            ? [Math.max(0, minX), Math.max(0, minY), Math.min(paper.w, maxX), Math.min(paper.h, maxY)].map(n => n * PT)
            : [0, 0, 0, 0];
        const title = String(meta.title || 'Plotter Geometry').replace(/[^\x20-\x7e]/g, ' ').slice(0, 200);
        const lines = [
            '%!PS-Adobe-3.0 EPSF-3.0',
            `%%BoundingBox: ${bounds.map((n, i) => i < 2 ? Math.floor(n) : Math.ceil(n)).join(' ')}`,
            `%%HiResBoundingBox: ${bounds.map((n, i) => num((i < 2 ? Math.floor(n * 1e5) : Math.ceil(n * 1e5)) / 1e5)).join(' ')}`,
            `%%Title: ${title}`, '%%Creator: Plotter Geometry', '%%Pages: 1',
            '%%LanguageLevel: 2', '%%DocumentData: Clean7Bit', '%%EndComments',
            '%%Page: 1 1', 'gsave', '1 setlinecap 1 setlinejoin', '[] 0 setdash',
            'false setstrokeadjust false setoverprint',
            `0 0 ${num(paper.w * PT)} ${num(paper.h * PT)} rectclip`,
        ];
        for (const layer of layers) {
            lines.push(`${layer.color.map(c => num(c / 255)).join(' ')} setrgbcolor`, `${num(layer.width * PT)} setlinewidth`);
            for (const p of chunks(layer.paths)) {
                lines.push('newpath');
                p.forEach((q, i) => lines.push(`${num(q[0] * PT)} ${num((paper.h - q[1]) * PT)} ${i ? 'lineto' : 'moveto'}`));
                lines.push('stroke');
            }
        }
        lines.push('grestore', 'showpage', '%%Trailer', '%%EOF', '');
        return lines.join('\n');
    };

    ex.dxf = function (result, paper, pens, meta = {}, onlyPen = null) {
        const layers = drawing(result, paper, pens, onlyPen);
        const lines = [];
        const put = (...pairs) => { for (const value of pairs) lines.push(String(value)); };
        let nextHandle = 1;
        const handle = () => (nextHandle++).toString(16).toUpperCase();
        const root = handle(), groups = handle(), model = handle(), space = handle();
        const section = name => put(0, 'SECTION', 2, name);
        const end = () => put(0, 'ENDSEC');
        const table = (name, count) => {
            const id = handle();
            put(0, 'TABLE', 2, name, 5, id, 330, 0, 100, 'AcDbSymbolTable', 70, count);
            if (name === 'DIMSTYLE') put(100, 'AcDbDimStyleTable', 71, 1);
            return id;
        };
        const record = (type, owner, subclass, id = handle()) => {
            put(0, type, type === 'DIMSTYLE' ? 105 : 5, id, 330, owner, 100, 'AcDbSymbolTableRecord', 100, subclass);
        };
        const entity = (type, owner, subclass, id = handle(), name = '0') => {
            put(0, type, 5, id, 330, owner, 100, 'AcDbEntity', 8, name, 100, subclass);
        };
        // R2004 adds true color. A basic ACI fallback also helps older importers.
        const palette = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [0, 0, 0], [128, 128, 128], [192, 192, 192]];
        const aci = color => {
            const distances = palette.map(p => p.reduce((sum, c, i) => sum + (c - color[i]) ** 2, 0));
            return distances.indexOf(Math.min(...distances)) + 1;
        };
        const trueColor = c => (c[0] << 16) | (c[1] << 8) | c[2];
        const names = layers.map(l => `Pen_${l.pen + 1}_${l.name.normalize('NFKD').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}`);
        const colors = layers.map(l => ({ index: aci(l.color), rgb: trueColor(l.color) }));

        section('HEADER');
        put(9, '$ACADVER', 1, 'AC1018', 9, '$HANDSEED', 5, 'HANDSEED');
        const seedIndex = lines.length - 1;
        put(9, '$DWGCODEPAGE', 3, 'ANSI_1252', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1,
            9, '$LUNITS', 70, 2, 9, '$LUPREC', 70, 5, 9, '$INSBASE', 10, 0, 20, 0, 30, 0,
            9, '$LIMMIN', 10, 0, 20, 0, 9, '$LIMMAX', 10, num(paper.w), 20, num(paper.h));
        end();
        section('CLASSES'); end();
        section('TABLES');
        const vp = table('VPORT', 1);
        record('VPORT', vp, 'AcDbViewportTableRecord');
        put(2, '*ACTIVE', 70, 0, 10, 0, 20, 0, 11, 1, 21, 1,
            12, num(paper.w / 2), 22, num(paper.h / 2), 16, 0, 26, 0, 36, 1,
            17, 0, 27, 0, 37, 0, 40, num(paper.h * 1.1), 41, num(paper.w / paper.h));
        put(0, 'ENDTAB');
        const lt = table('LTYPE', 3);
        for (const name of ['BYBLOCK', 'BYLAYER', 'CONTINUOUS']) {
            record('LTYPE', lt, 'AcDbLinetypeTableRecord');
            put(2, name, 70, 0, 3, '', 72, 65, 73, 0, 40, 0);
        }
        put(0, 'ENDTAB');
        const la = table('LAYER', layers.length + 1);
        record('LAYER', la, 'AcDbLayerTableRecord');
        put(2, '0', 70, 0, 62, 7, 6, 'CONTINUOUS');
        layers.forEach((l, i) => {
            record('LAYER', la, 'AcDbLayerTableRecord');
            put(2, names[i], 70, 0, 62, colors[i].index, 420, colors[i].rgb, 6, 'CONTINUOUS');
        });
        put(0, 'ENDTAB');
        const st = table('STYLE', 1);
        record('STYLE', st, 'AcDbTextStyleTableRecord');
        put(2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '');
        put(0, 'ENDTAB');
        for (const name of ['VIEW', 'UCS']) { table(name, 0); put(0, 'ENDTAB'); }
        const ap = table('APPID', 1);
        record('APPID', ap, 'AcDbRegAppTableRecord'); put(2, 'ACAD', 70, 0); put(0, 'ENDTAB');
        const ds = table('DIMSTYLE', 1);
        record('DIMSTYLE', ds, 'AcDbDimStyleTableRecord'); put(2, 'STANDARD', 70, 0); put(0, 'ENDTAB');
        const br = table('BLOCK_RECORD', 2);
        for (const [id, name] of [[model, '*Model_Space'], [space, '*Paper_Space']]) {
            record('BLOCK_RECORD', br, 'AcDbBlockTableRecord', id); put(2, name);
        }
        put(0, 'ENDTAB'); end();
        section('BLOCKS');
        for (const [id, name] of [[model, '*Model_Space'], [space, '*Paper_Space']]) {
            entity('BLOCK', id, 'AcDbBlockBegin');
            put(2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '');
            entity('ENDBLK', id, 'AcDbBlockEnd');
        }
        end();
        section('ENTITIES');
        layers.forEach((l, i) => {
            for (const p of l.paths) {
                put(0, 'LWPOLYLINE', 5, handle(), 330, model, 100, 'AcDbEntity', 8, names[i],
                    62, colors[i].index, 420, colors[i].rgb, 100, 'AcDbPolyline');
                // Only exact closed paths are closed. Never bridge a nearly closed stroke.
                const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
                const count = p.length - (closed ? 1 : 0);
                put(90, count, 70, closed ? 1 : 0);
                for (let j = 0; j < count; j++) put(10, num(p[j][0]), 20, num(paper.h - p[j][1]));
            }
        });
        end();
        section('OBJECTS');
        put(0, 'DICTIONARY', 5, root, 330, 0, 100, 'AcDbDictionary', 281, 1, 3, 'ACAD_GROUP', 350, groups,
            0, 'DICTIONARY', 5, groups, 330, root, 100, 'AcDbDictionary', 281, 1);
        end(); put(0, 'EOF');
        lines[seedIndex] = handle();
        return lines.join('\r\n') + '\r\n';
    };
})();
