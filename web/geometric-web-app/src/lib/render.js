/*
 * Canvas rendering of pipeline results (shared by the app preview, thumbnails
 * and the dev contact sheet).
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    // Build (and cache on the layer) a Path2D for each layer.
    PG.layerPath = function (layer) {
        if (layer._path2d) return layer._path2d;
        const path = new Path2D();
        for (const p of layer.paths) {
            path.moveTo(p[0][0], p[0][1]);
            for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]);
        }
        layer._path2d = path;
        return path;
    };

    // Draw a result onto ctx. view = { scale (px per mm), ox, oy (px) }.
    // opts = { paper: {w,h}, paperColor, pens, showMargin, minLinePx, hidden: Set }
    PG.drawResult = function (ctx, result, view, opts) {
        const { paper } = opts;
        ctx.save();
        ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
        if (opts.paperColor) {
            ctx.fillStyle = opts.paperColor;
            ctx.fillRect(0, 0, paper.w, paper.h);
        }
        if (opts.showMargin && result.outlines) {
            ctx.save();
            ctx.setLineDash([4 / view.scale, 6 / view.scale]);
            ctx.lineWidth = 1 / view.scale;
            ctx.strokeStyle = 'rgba(80,120,200,0.45)';
            ctx.beginPath();
            for (const o of result.outlines) {
                ctx.moveTo(o[0][0], o[0][1]);
                for (let i = 1; i < o.length; i++) ctx.lineTo(o[i][0], o[i][1]);
            }
            ctx.stroke();
            ctx.restore();
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const minW = (opts.minLinePx || 0.6) / view.scale;
        for (const layer of result.layers) {
            if (opts.hidden && opts.hidden.has(layer.pen)) continue;
            const pen = (opts.pens && opts.pens[layer.pen]) || { color: '#111', width: 0.3 };
            ctx.strokeStyle = pen.color;
            ctx.lineWidth = Math.max(minW, opts.hairline ? 0 : pen.width);
            ctx.globalAlpha = opts.alpha || 1;
            ctx.stroke(PG.layerPath(layer));
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    };
})();
