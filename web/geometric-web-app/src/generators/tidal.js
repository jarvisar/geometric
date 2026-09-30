/* The same relief at successive sea levels, with true terrain occlusion. */
(function () {
    'use strict';
    const { geo } = PG;
    PG.register({
        id: 'tidal', name: 'Tidal Atlas', category: 'Scenes', fit: false,
        description: 'A series of tiny island worlds disappearing beneath a rising tide, drawn as contours, ridges or wire terrain.',
        params: [
            { type: 'section', label: 'Studies' },
            { id: 'studies', label: 'Studies', type: 'range', min: 1, max: 4, step: 1, value: 4, random: [2, 4] },
            { id: 'layout', label: 'Arrangement', type: 'select', value: 'column', random: ['column', 'grid'], options: [['column', 'Vertical sequence'], ['grid', 'Grid']] },
            { id: 'water', label: 'Starting sea level (%)', type: 'range', min: 0, max: 75, step: 1, value: 13, random: [5, 25] },
            { id: 'rise', label: 'Total tide rise (%)', type: 'range', min: 0, max: 65, step: 1, value: 55, random: [35, 60], show: p => p.studies > 1 },
            { type: 'section', label: 'Landforms' },
            { id: 'peaks', label: 'Peaks', type: 'range', min: 2, max: 12, step: 1, value: 6, random: [4, 9] },
            { id: 'relief', label: 'Relief', type: 'range', min: 10, max: 60, step: 1, value: 35, random: [25, 44] },
            { id: 'rough', label: 'Erosion', type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, random: [0.3, 0.7] },
            { id: 'yaw', label: 'Turn (°)', type: 'range', min: 10, max: 80, step: 1, value: 45, random: [32, 58] },
            { id: 'elev', label: 'View height (°)', type: 'range', min: 20, max: 65, step: 1, value: 35, random: [29, 44] },
            { type: 'section', label: 'Linework' },
            { id: 'style', label: 'Terrain lines', type: 'select', value: 'ridges', random: ['ridges', 'contours', 'wire'], options: [['ridges', 'Fine ridges'], ['contours', 'Elevation contours'], ['wire', 'Wire mesh']] },
            { id: 'lines', label: 'Terrain detail', type: 'range', min: 30, max: 130, step: 5, value: 85, random: [60, 100] },
            { id: 'waterLines', label: 'Water hatching', type: 'checkbox', value: true },
            { id: 'marks', label: 'Survey marks', type: 'checkbox', value: true },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng, noise } = ctx;
            const peaks = Array.from({ length: p.peaks }, () => ({ x: rng.range(-32, 32), y: rng.range(-32, 32), r: rng.range(12, 25), h: rng.range(0.55, 1) }));
            const height = (x, y) => {
                let z = 0;
                for (const peak of peaks) z = Math.max(z, peak.h * Math.exp(-((x - peak.x) ** 2 + (y - peak.y) ** 2) / (peak.r * peak.r)));
                const coast = Math.max(0, 1 - Math.pow(Math.max(Math.abs(x), Math.abs(y)) / 51, 6));
                return Math.max(0, (z + p.rough * 0.35 * noise.fbm2(x / 14, y / 14, 4)) * coast);
            };
            const field = PG.sampleField(height, -50, -50, 100, 100, 100 / p.lines);
            for (let i = 0; i < field.values.length; i++) field.values[i] = field.values[i] / field.max * p.relief;
            field.min = 0; field.max = p.relief;
            const { nx, ny, dx, dy, values } = field, point = (i, j) => [-50 + i * dx, -50 + j * dy, values[j * nx + i]];
            const columns = p.layout === 'grid' ? Math.min(2, p.studies) : 1;
            const rows = Math.ceil(p.studies / columns), gap = Math.min(W, H) * 0.025;
            const cw = (W - gap * (columns - 1)) / columns, ch = (H - gap * (rows - 1)) / rows;
            const layers = PG.pens.layers(p.pens), c0 = PG.iso.makeCamera(p.yaw, p.elev, 1, cw, ch, 0, 0);
            const water = study => p.relief * Math.min(0.97, (p.water + (p.studies === 1 ? 0 : p.rise * study / (p.studies - 1))) / 100);
            // One camera scale across the series keeps the rise in water readable.
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                const pt = point(i, j); pt[2] = Math.max(0, pt[2] - water(0));
                const q = c0.project(...pt); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
            }
            const k = Math.min(cw * 0.92 / (x1 - x0), ch * 0.83 / (y1 - y0));
            const mid = c0.ground((x0 + x1) / 2, (y0 + y1) / 2, 0);
            const landPen = z => p.pens === 1 ? 0 : 1 + PG.pens.band(z / p.relief, p.pens - 1);
            for (let study = 0; study < p.studies; study++) {
                const cam = PG.iso.makeCamera(p.yaw, p.elev, k, cw, ch, ...mid), sea = water(study), project = cam.project;
                cam.project = (x, y, z) => project(x, y, z - sea);
                const S = new PG.iso.Scene(cam, cw, ch);
                const terrainLine = (a, b) => {
                    if (a[2] <= sea && b[2] <= sea) return;
                    if ((a[2] < sea) !== (b[2] < sea)) {
                        const f = (sea - a[2]) / (b[2] - a[2]), q = a.map((v, i) => geo.lerp(v, b[i], f));
                        if (a[2] < sea) a = q; else b = q;
                    }
                    S.line([a, b]);
                };
                for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
                    const a = point(i, j), b = point(i + 1, j), c = point(i + 1, j + 1), d = point(i, j + 1);
                    S.face([a, b, c], false); S.face([a, c, d], false);
                }
                const surface = [[-50, -50, sea], [50, -50, sea], [50, 50, sea], [-50, 50, sea]];
                S.face(surface, false); S.kind = 0;
                S.loop(surface.map(([x, y, z]) => [x, y, z + 0.02]));
                if (p.waterLines) {
                    // Measure perpendicular spacing on paper, including camera foreshortening.
                    const a = cam.project(0, 0, sea), b = cam.project(1, 0, sea), c = cam.project(0, 1, sea);
                    const spacing = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
                    const step = Math.max(0.7, 0.65 / spacing);
                    for (let y = -50 + step / 2; y < 50; y += step) S.line([[-50, y, sea + 0.025], [50, y, sea + 0.025]]);
                }
                S.kind = landPen(sea);
                for (const line of PG.isolines(field, sea)) S.line(line.map(([x, y]) => [x, y, sea + 0.1]));
                if (p.style === 'contours') {
                    const step = Math.max(p.relief / p.lines, 0.45 / (k * cam.ce));
                    for (let z = step; z < p.relief; z += step) {
                        if (z <= sea) continue;
                        S.kind = landPen(z);
                        for (const line of PG.isolines(field, z)) S.line(line.map(([x, y]) => [x, y, z + 0.16]));
                    }
                } else {
                    for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) {
                        const a = point(i, j), b = point(i + 1, j);
                        S.kind = landPen((a[2] + b[2]) / 2);
                        terrainLine(a, b);
                        if (p.style === 'wire' && j + 1 < ny) {
                            terrainLine(a, point(i, j + 1));
                            if ((i + j) % 2 === 0) terrainLine(a, point(i + 1, j + 1));
                        }
                    }
                }
                const ox = (study % columns) * (cw + gap), oy = Math.floor(study / columns) * (ch + gap);
                PG.iso.render(S).forEach((paths, pen) => { for (const path of paths) layers[pen].push(path.map(([x, y]) => [x + ox, y + oy])); });
                if (p.marks) {
                    const x = ox + cw * 0.36, y = oy + ch * 0.96, len = cw * 0.28;
                    layers[0].push([[x, y], [x + len, y]]);
                    for (let i = 0; i <= 8; i++) layers[0].push([[x + len * i / 8, y - (i % 4 ? 0.7 : 1.4)], [x + len * i / 8, y + 0.7]]);
                }
            }
            return { layers };
        },
    });
})();
