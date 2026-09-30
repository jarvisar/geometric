/* A comic page drawn as stacked paper cutouts, so hatching stops at silhouettes. */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const triangle = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    function mask(S, poly, z) {
        // Ear clipping needs an open vertex list. Rounded paths repeat the first point.
        if (geo.dist(poly[0], poly.at(-1)) < 1e-9) poly = poly.slice(0, -1);
        const points = geo.polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
        const indices = points.map((_, i) => i);
        for (let guard = points.length ** 2; indices.length > 2 && guard > 0; guard--) {
            let clipped = false;
            for (let i = 0; i < indices.length; i++) {
                const ia = indices[(i + indices.length - 1) % indices.length], ib = indices[i], ic = indices[(i + 1) % indices.length];
                const a = points[ia], b = points[ib], c = points[ic];
                if (triangle(a, b, c) < 1e-9) continue;
                if (indices.some(j => j !== ia && j !== ib && j !== ic && triangle(a, b, points[j]) > -1e-9 && triangle(b, c, points[j]) > -1e-9 && triangle(c, a, points[j]) > -1e-9)) continue;
                S.face([a, b, c].map(([x, y]) => [x, y, z]), false);
                indices.splice(i, 1); clipped = true; break;
            }
            if (!clipped) break;
        }
    }
    function panel(p, w, h, rng, index) {
        const S = new PG.iso.Scene({ project: (x, y, z) => [x, y, -z] }, w, h);
        const accent = n => p.pens === 1 ? 0 : 1 + (index * 2 + n) % (p.pens - 1);
        const line = (pts, z = 0, pen = 0) => { S.kind = pen; S.line(pts.map(([x, y]) => [x, y, z])); };
        const polygon = (pts, z, pen = 0) => { mask(S, pts, z); line(geo.close(pts), z + 0.02, pen); };
        const hatch = (poly, z, pen, spacing = p.spacing, angle = -Math.PI / 4) => {
            for (const pts of geo.hatch([poly], spacing, angle)) line(pts, z + 0.025, pen);
        };
        const rect = [[0, 0], [w, 0], [w, h], [0, h]], m = Math.min(w, h);
        const landscape = p.world !== 'orbit' && (index % 5 !== 3 || p.layout === 'single');
        const desert = p.world === 'desert' || (p.world === 'mixed' && rng.chance(0.42));
        const night = rng.chance(p.night), sun = [w * rng.range(0.2, 0.8), h * rng.range(0.13, 0.36)];
        const sr = m * rng.range(0.075, 0.15), sunPoly = geo.ngon(...sun, sr, 48);
        if (!night) {
            if (rng.chance(0.64)) {
                const n = Math.min(190, Math.max(38, Math.round((w + h) / p.spacing * 0.7)));
                for (let i = 0; i < n; i++) {
                    const a = TAU * i / n, l = Math.hypot(w, h) * 2;
                    line([[sun[0] + sr * Math.cos(a), sun[1] + sr * Math.sin(a)], [sun[0] + l * Math.cos(a), sun[1] + l * Math.sin(a)]], 0, accent(0));
                }
            } else hatch(rect, 0, accent(0), p.spacing * 1.8, rng.pick([-0.55, 0, 0.55]));
            polygon(sunPoly, 1, accent(0));
        }
        const stars = Math.round(w * h * p.stars / 75);
        for (let i = 0; i < stars; i++) {
            const x = rng.range(1, w - 1), y = rng.range(1, h - 1), r = rng.range(0.18, 0.42);
            if (!night && Math.hypot(x - sun[0], y - sun[1]) < sr + 1) continue;
            if (rng.chance(0.3)) { line([[x - r, y], [x + r, y]], 2); line([[x, y - r], [x, y + r]], 2); }
            else line(geo.circle(x, y, r * 0.55, 7), 2);
        }
        // Planets have a shaded hemisphere and rings with separate front/back arcs.
        const planet = (x, y, r, ringed, color) => {
            const body = geo.ngon(x, y, r, 40);
            const ellipse = (a, scale) => {
                const u = r * scale * Math.cos(a), v = r * 0.38 * Math.sin(a), turn = -0.32;
                return [x + u * Math.cos(turn) - v * Math.sin(turn), y + u * Math.sin(turn) + v * Math.cos(turn)];
            };
            if (ringed) for (const f of [1.65, 1.9]) line(Array.from({ length: 65 }, (_, i) => ellipse(TAU * i / 64, f)), 2.5, color);
            polygon(body, 3);
            const shade = Array.from({ length: 25 }, (_, i) => { const a = Math.PI * i / 24; return [x + r * Math.cos(a), y + r * Math.sin(a)]; });
            hatch(shade, 3, color, p.spacing * 0.75, Math.PI / 3);
            if (ringed) for (const f of [1.65, 1.9]) line(Array.from({ length: 33 }, (_, i) => ellipse(Math.PI * i / 32, f)), 3.2, color);
        };
        const nPlanets = night || !landscape ? rng.int(2, 4) : rng.int(0, 2), occupied = night ? [] : [[...sun, sr]];
        if (!landscape) {
            const x = w * 0.55, y = h * 0.57, r = m * 0.22;
            planet(x, y, r, true, accent(1)); occupied.push([x, y, r * 2]);
        }
        for (let i = 0; i < nPlanets; i++) {
            const r = m * rng.range(0.028, 0.075), x = rng.range(r * 2, w - r * 2), y = rng.range(r * 1.5, h * (landscape ? 0.42 : 0.86));
            if (occupied.some(([u, v, rr]) => Math.hypot(x - u, y - v) < rr + r * 2.1)) continue;
            planet(x, y, r, i === 0 || rng.chance(0.35), accent(i + 1));
            occupied.push([x, y, r * 2]);
        }
        const cloud = (x, y, width, height) => {
            const top = Array.from({ length: 31 }, (_, i) => {
                const t = i / 30;
                return [x + width * t, y - height * (0.25 + 0.6 * Math.abs(Math.sin(t * Math.PI * 4))) * Math.sin(Math.PI * t)];
            });
            const poly = geo.chaikin(geo.close(top.concat([[x + width, y + height * 0.18], [x, y + height * 0.18]])), 1, true);
            polygon(poly, 4); hatch(poly, 4, 0, p.spacing * 0.7, -Math.PI / 3);
        };
        for (let i = 0, count = rng.int(0, 3); i < count; i++) cloud(w * rng.range(0.02, 0.75), h * rng.range(0.12, 0.4), m * rng.range(0.15, 0.35), m * 0.07);
        if (landscape) {
            const ground = [];
            for (let layer = 0; layer < p.layers; layer++) {
                const base = h * (0.57 + 0.36 * layer / Math.max(1, p.layers - 1)), amp = h * (0.27 - 0.15 * layer / p.layers);
                let ridge, peaks;
                if (desert && layer > 0) {
                    const phase = rng.range(0, TAU), frequency = rng.range(0.7, 1.4);
                    ridge = Array.from({ length: 41 }, (_, i) => [w * i / 40, base - amp * (0.6 + 0.4 * Math.sin(i / 40 * TAU * frequency + phase))]);
                } else {
                    const count = Math.max(4, Math.round(w / h * 3) * 2);
                    const anchors = Array.from({ length: count + 1 }, (_, i) => [w * (i === 0 || i === count ? i : i + rng.range(-0.3, 0.3)) / count,
                        base - amp * rng.range(i % 2 ? 0.6 : 0.05, i % 2 ? 1.1 : 0.4)]);
                    ridge = [anchors[0]]; peaks = [];
                    for (let i = 1; i < anchors.length; i++) {
                        const a = anchors[i - 1], b = anchors[i];
                        for (const t of [0.32, 0.68]) ridge.push([geo.lerp(a[0], b[0], t), geo.lerp(a[1], b[1], t) + amp * rng.range(-0.07, 0.07)]);
                        ridge.push(b);
                        if (i % 2) peaks.push(ridge.length - 1);
                    }
                }
                const z = 10 + layer * 5;
                for (let i = 1; i < ridge.length; i++) {
                    const a = ridge[i - 1], b = ridge[i];
                    S.face([[a[0], a[1], z], [b[0], b[1], z], [b[0], h, z], [a[0], h, z]], false);
                }
                line(ridge, z + 0.03);
                if (desert && layer > 0) {
                    const bottom = ridge.map(([x, y]) => [x, Math.min(h, y + amp * 0.7)]).reverse();
                    hatch(ridge.concat(bottom), z, layer % 2 ? accent(layer) : 0, p.spacing, -0.5);
                } else {
                    for (const i of peaks) {
                        const a = ridge[i], b = ridge[i + 3], dx = b[0] - a[0];
                        const seam = [a, [a[0] - dx * 0.12, a[1] + amp * 0.3], [a[0] + dx * 0.22, base + amp * 0.16], [a[0] + dx * 0.06, h]];
                        const facet = ridge.slice(i, i + 4).concat([[b[0], h]], seam.slice(1).reverse());
                        hatch(facet, z, layer % 2 ? accent(layer) : 0, p.spacing * 0.85, -0.65);
                        line(seam, z + 0.03);
                    }
                }
                ground.push({ ridge, z });
            }
            const base = ground.at(-1), groundY = x => {
                let i = 1; while (i + 1 < base.ridge.length && base.ridge[i][0] < x) i++;
                const a = base.ridge[i - 1], b = base.ridge[i];
                return geo.lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
            };
            for (let i = 0, count = rng.int(3, 7); i < count; i++) {
                const x = w * rng.range(0.06, 0.94), y = geo.lerp(groundY(x), h, rng.range(0.1, 0.75));
                const height = m * rng.range(0.08, 0.17), z = base.z + 2 + i * 0.02;
                if (desert) {
                    const d = height * 0.11, poly = [[x - d, y], [x - d, y - height * 0.35], [x - d * 3, y - height * 0.35], [x - d * 3, y - height * 0.73], [x - d * 2, y - height * 0.73], [x - d * 2, y - height * 0.48], [x - d, y - height * 0.48], [x - d, y - height], [x + d, y - height], [x + d, y - height * 0.55], [x + d * 2, y - height * 0.55], [x + d * 2, y - height * 0.83], [x + d * 3, y - height * 0.83], [x + d * 3, y - height * 0.4], [x + d, y - height * 0.4], [x + d, y]];
                    polygon(poly, z); hatch(poly, z, accent(2), p.spacing * 0.75, Math.PI / 2);
                } else {
                    line([[x, y], [x, y - height]], z);
                    for (let j = 0; j < 3; j++) {
                        const yy = y - height * (0.32 + j * 0.22), r = height * (0.28 - j * 0.06);
                        const poly = [[x - r, yy], [x, yy - height * 0.45], [x + r, yy]];
                        polygon(poly, z + 0.1 + j * 0.1); hatch(poly, z + 0.1 + j * 0.1, j % 2 ? 0 : accent(2), p.spacing * 0.8, 0.45);
                    }
                }
                line([[x - height * 0.2, y + 0.4], [x + height * 0.45, y + 0.4]], z, accent(2));
            }
            for (let i = 0; i < w * h / 75; i++) {
                const x = rng.range(0, w), y = rng.range(h * 0.65, h), len = rng.range(0.6, 2.2);
                if (y > groundY(x) + 1) line([[x, y], [x + len, y - 0.2]], base.z + 0.1, accent(1));
            }
        }
        const clipped = PG.iso.render(S).map(paths => PG.clipPaths(paths, PG.shapes.rect(0, 0, w, h)));
        if (p.frames) { clipped[0] ||= []; clipped[0].push(geo.close(rect)); }
        return clipped;
    }
    PG.register({
        id: 'cosmic', name: 'Cosmic Comics', category: 'Scenes', fit: false,
        description: 'Little voyages through alien mountains, ringed planets and sunlit dunes, arranged as a changing comic page.',
        params: [
            { type: 'section', label: 'Page' },
            { id: 'layout', label: 'Layout', type: 'select', value: 'story', random: ['story', 'story', 'grid', 'single'], options: [['story', 'Comic page'], ['grid', 'Contact sheet'], ['single', 'One postcard']] },
            { id: 'cols', label: 'Columns', type: 'range', min: 2, max: 5, step: 1, value: 3, random: [2, 4], show: p => p.layout !== 'single' },
            { id: 'rows', label: 'Rows', type: 'range', min: 2, max: 8, step: 1, value: 5, random: [3, 6], show: p => p.layout !== 'single' },
            { id: 'gutter', label: 'Gutter (mm)', type: 'range', min: 1, max: 8, step: 0.5, value: 3, random: [2, 4], show: p => p.layout !== 'single' },
            { id: 'frames', label: 'Panel frames', type: 'checkbox', value: true },
            { type: 'section', label: 'Worlds' },
            { id: 'world', label: 'Landscape', type: 'select', value: 'mixed', random: ['mixed', 'mountains', 'desert', 'orbit'], options: [['mixed', 'A journey'], ['mountains', 'Mountain worlds'], ['desert', 'Desert planets'], ['orbit', 'Deep space']] },
            { id: 'layers', label: 'Landscape depth', type: 'range', min: 2, max: 5, step: 1, value: 3, random: [2, 4], show: p => p.world !== 'orbit' },
            { id: 'night', label: 'Night skies', type: 'range', min: 0, max: 1, step: 0.05, value: 0.3, random: [0.1, 0.65] },
            { id: 'stars', label: 'Star density', type: 'range', min: 0, max: 2, step: 0.1, value: 0.9, random: [0.4, 1.4] },
            { id: 'spacing', label: 'Hatch spacing (mm)', type: 'range', min: 0.35, max: 2, step: 0.05, value: 0.8, random: [0.65, 1.1] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx, cols = p.layout === 'single' ? 1 : p.cols, rows = p.layout === 'single' ? 1 : p.rows;
            const gap = Math.min(p.gutter, W / cols * 0.25, H / rows * 0.25);
            const cw = (W - (cols - 1) * gap) / cols, ch = (H - (rows - 1) * gap) / rows;
            const used = new Set(), panels = [], hero = p.layout === 'story' ? [rng.int(0, cols - 2), rng.int(0, rows - 2)] : null;
            if (hero) {
                panels.push([hero[0], hero[1], 2, 2]);
                for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) used.add(`${hero[0] + x},${hero[1] + y}`);
            }
            for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
                if (used.has(`${x},${y}`)) continue;
                const wide = p.layout === 'story' && x + 1 < cols && !used.has(`${x + 1},${y}`) && rng.chance(0.3);
                panels.push([x, y, wide ? 2 : 1, 1]);
                if (wide) used.add(`${x + 1},${y}`);
            }
            panels.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
            const layers = PG.pens.layers(p.pens);
            panels.forEach(([x, y, sx, sy], index) => {
                const prng = new PG.RNG(PG.iso.hash(ctx.seed, index, 727));
                panel(p, cw * sx + gap * (sx - 1), ch * sy + gap * (sy - 1), prng, index).forEach((paths, pen) => {
                    for (const path of paths) layers[pen].push(path.map(([u, v]) => [x * (cw + gap) + u, y * (ch + gap) + v]));
                });
            });
            return { layers };
        },
    });
})();
