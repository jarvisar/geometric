/*
 * Topographic map — contour lines of a fractal height field.
 *
 * Height is fBm (or ridged multifractal) sampled through a domain warp,
 * h(p + w·(fbm(p + a), fbm(p + b))), after Inigo Quilez's "warping" article,
 * which bends the blobby noise into drainage-like, organic landforms. An
 * optional radial falloff lifts an island out of the sea, and soft terracing
 * bunches contours into cliffs between flat benches. Iso-lines come from
 * marching squares (PG.isolines); every Nth "index contour" goes to pen 2,
 * as on printed survey maps.
 */
(function () {
    'use strict';
    const { geo } = PG;

    PG.register({
        id: 'topo',
        name: 'Topographic',
        category: 'Fields',
        description: 'Contour map of a domain-warped fractal landscape, with index contours on a second pen.',
        fit: false,
        params: [
            { type: 'section', label: 'Landscape' },
            { id: 'relief', label: 'Relief', type: 'select', value: 'fbm', random: ['fbm', 'fbm', 'ridged', 'marble'],
                options: [['fbm', 'Rolling hills'], ['ridged', 'Ridged mountains'], ['marble', 'Marbled (double warp)']] },
            { id: 'scale', label: 'Feature size (mm)', type: 'range', min: 20, max: 400, step: 1, value: 220, random: [120, 300] },
            { id: 'octaves', label: 'Octaves', type: 'range', min: 1, max: 7, step: 1, value: 5, random: [3, 5] },
            { id: 'rough', label: 'Roughness', type: 'range', min: 0.2, max: 0.7, step: 0.01, value: 0.42, random: [0.32, 0.55],
                hint: 'Amplitude kept per octave (fBm gain)' },
            { id: 'warp', label: 'Warp amount', type: 'range', min: 0, max: 3, step: 0.01, value: 0.35, random: [0.1, 0.6] },
            { id: 'peaks', label: 'Peakiness', type: 'range', min: 0.5, max: 3, step: 0.01, value: 1.5, random: [1, 2.2],
                hint: 'Exponent on height: >1 flattens lowlands and steepens summits' },
            { id: 'island', label: 'Island falloff', type: 'range', min: 0, max: 1, step: 0.01, value: 0, random: false,
                hint: 'Lift the centre and sink the edges' },
            { id: 'sea', label: 'Sea level', type: 'range', min: 0, max: 0.8, step: 0.01, value: 0, random: false,
                hint: 'Skip contours below this fraction of the height range' },
            { id: 'terrace', label: 'Terracing', type: 'range', min: 0, max: 1, step: 0.01, value: 0, random: false },
            { id: 'terraces', label: 'Terraces', type: 'range', min: 2, max: 20, step: 1, value: 7, show: p => p.terrace > 0 },
            { type: 'section', label: 'Contours' },
            { id: 'levels', label: 'Levels', type: 'range', min: 4, max: 120, step: 1, value: 40, random: [25, 55] },
            { id: 'index', label: 'Index every', type: 'range', min: 0, max: 10, step: 1, value: 5, random: false,
                hint: 'Every Nth contour goes to pen 2 (0 = off)' },
            { id: 'bold', label: 'Double-stroke index lines', type: 'checkbox', value: false,
                show: p => p.index > 0, hint: 'Adds a parallel stroke 0.4 mm away so index lines read bolder' },
            { id: 'minGap', label: 'Min spacing (mm)', type: 'range', min: 0, max: 3, step: 0.05, value: 0.8, random: false,
                hint: 'On steep slopes drop intermediate contours closer than this (0 = draw all)' },
            { id: 'smooth', label: 'Smoothing', type: 'range', min: 0, max: 3, step: 1, value: 2, random: false },
            { id: 'minLen', label: 'Min loop length (mm)', type: 'range', min: 0, max: 20, step: 0.5, value: 3, random: false },
            { id: 'cell', label: 'Grid resolution (mm)', type: 'range', min: 0.4, max: 3, step: 0.05, value: 0.9, random: false },
        ],

        randomize(rng, p) {
            const out = {};
            // ridged and marbled relief turn to noise when rough; keep them broad
            if (p.relief === 'ridged') {
                Object.assign(out, { rough: +rng.range(0.3, 0.4).toFixed(2), octaves: rng.int(3, 4), scale: rng.int(200, 320) });
            } else if (p.relief === 'marble') {
                Object.assign(out, { rough: +rng.range(0.3, 0.4).toFixed(2), octaves: rng.int(3, 4), scale: rng.int(220, 340),
                    warp: +rng.range(0.15, 0.5).toFixed(2) });
            } else {
                out.rough = +rng.range(0.3, 0.42).toFixed(2);
            }
            if (rng.chance(0.3)) {
                out.island = +rng.range(0.5, 0.9).toFixed(2);
                out.sea = +rng.range(0.3, 0.5).toFixed(2);
            } else {
                out.island = 0; out.sea = 0;
            }
            // Terraces bunch contours into risers; the spacing thinner then cuts
            // most of them, so keep it gentle, and off for sharp ridges.
            out.terrace = p.relief !== 'ridged' && rng.chance(0.25) ? +rng.range(0.3, 0.6).toFixed(2) : 0;
            out.terraces = rng.int(4, 8);
            return out;
        },

        generate(p, ctx) {
            const { width: W, height: H, noise } = ctx;
            const sc = 1 / p.scale;
            const oct = Math.round(p.octaves);

            // Ridged multifractal (Musgrave): sharp crests where the noise crosses zero.
            const ridged = (x, y) => {
                let sum = 0, amp = 1, f = 1, norm = 0, prev = 1;
                for (let o = 0; o < oct; o++) {
                    let n = 1 - Math.abs(noise.noise2(x * f + o * 17.31, y * f - o * 9.73));
                    n *= n;
                    sum += n * amp * prev;
                    norm += amp;
                    prev = n;
                    amp *= p.rough; f *= 2;
                }
                return (sum / norm) * 2 - 1;
            };
            const base = p.relief === 'ridged' ? ridged : (x, y) => noise.fbm2(x, y, oct, 2, p.rough);
            const cx = W / 2, cy = H / 2;
            // island falloff fits the page, or the clip circle when there is one
            const round = ctx.shape.kind === 'circle';
            const ir = Math.max(1, ctx.shape.dist(cx, cy));
            const rx = round ? ir : W / 2, ry = round ? ir : H / 2;
            // Warp noise is lower-frequency than the relief, so it bends rather
            // than shreds; being so smooth it is sampled on a coarse grid.
            const ws = 0.6;
            const warpAt = p.warp > 0 ? coarseVectorField((x, y) => {
                const u = x * sc, v = y * sc;
                let wx = noise.fbm2(u * ws + 3.1, v * ws - 7.7, 3), wy = noise.fbm2(u * ws - 5.2, v * ws + 1.3, 3);
                if (p.relief === 'marble') {
                    const qx = wx, qy = wy;
                    wx = noise.fbm2((u + 2 * qx) * ws + 1.7, (v + 2 * qy) * ws + 9.2, 3);
                    wy = noise.fbm2((u + 2 * qx) * ws + 8.3, (v + 2 * qy) * ws + 2.8, 3);
                }
                return [wx, wy];
            }, W, H, Math.min(4, p.scale / 40)) : null;
            const height = (x, y) => {
                let u = x * sc, v = y * sc;
                if (warpAt) {
                    const w = warpAt(x, y);
                    u += p.warp * w[0]; v += p.warp * w[1];
                }
                let h = base(u, v);
                if (p.island > 0) {
                    const dx = (x - cx) / rx, dy = (y - cy) / ry;
                    const r2 = dx * dx + dy * dy;
                    h = h * (1 - 0.4 * p.island) + p.island * (0.6 - 1.2 * r2);
                }
                return h;
            };

            // Cap the grid at ~250k samples.
            const cell = Math.max(p.cell, Math.sqrt((W * H) / 250000));
            const field = PG.sampleField(height, 0, 0, W, H, cell);

            // Normalise to [0, 1], raise to `peaks` (flat lowlands, steep summits),
            // then optionally terrace: within each step f -> f^k / (f^k + (1-f)^k)
            // flattens benches and steepens the risers between them.
            const vals = field.values, span = field.max - field.min || 1;
            const k = 1 + 5 * p.terrace, T = Math.round(p.terraces);
            for (let i = 0; i < vals.length; i++) {
                let h = Math.pow((vals[i] - field.min) / span, p.peaks);
                if (p.terrace > 0) {
                    const t = h * T, n = Math.floor(t), f = t - n;
                    const a = Math.pow(f, k), b = Math.pow(1 - f, k);
                    h = (n + a / (a + b)) / T;
                }
                vals[i] = h;
            }
            field.min = 0; field.max = 1;

            const L = Math.round(p.levels);
            const N = Math.round(p.index);
            const lo = p.sea;
            const delta = (1 - lo) / (L + 1);
            const gradAt = p.minGap > 0 ? gradientSampler(field) : null;

            const plain = [], index = [];
            for (let i = 1; i <= L; i++) {
                const level = lo + delta * i;
                const isIndex = N > 0 && i % N === 0;
                // On steep slopes the gap between neighbouring contours is
                // delta / |grad h|. A contour of multiplicity m only has neighbours
                // m levels away once finer ones are cut, so it is kept while
                // m·gap >= minGap: intermediate contours vanish first and index
                // contours last (without index lines: odd levels, then 2s, 4s...).
                const mult = N > 0 ? (isIndex ? N : 1) : Math.min(8, i & -i);
                const maxGrad = p.minGap > 0 ? (delta * mult) / p.minGap : Infinity;
                for (let line of PG.isolines(field, level)) {
                    const a = line[0], b = line[line.length - 1];
                    const closed = line.length > 3 && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
                    if (closed && geo.pathLength(line) < p.minLen) continue;
                    if (p.smooth > 0) line = geo.chaikin(line, p.smooth, closed);
                    const pieces = gradAt ? thin(line, pt => gradAt(pt[0], pt[1]) <= maxGrad) : [line];
                    for (const piece of pieces) {
                        if (isIndex) {
                            index.push(piece);
                            if (p.bold) index.push(offsetPath(piece, 0.4, closed && piece === line));
                        } else plain.push(piece);
                    }
                }
            }
            return N > 0 ? { layers: [plain, index] } : plain;
        },
    });

    // Sample a smooth 2D vector field on a coarse grid over [0, W] × [0, H];
    // returns a bilinear interpolator.
    function coarseVectorField(fn, W, H, step) {
        const nx = Math.ceil(W / step) + 2, ny = Math.ceil(H / step) + 2;
        const fx = new Float64Array(nx * ny), fy = new Float64Array(nx * ny);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const v = fn(i * step, j * step);
                fx[j * nx + i] = v[0]; fy[j * nx + i] = v[1];
            }
        }
        const out = [0, 0];
        return (x, y) => {
            const gx = geo.clamp(x / step, 0, nx - 1.001), gy = geo.clamp(y / step, 0, ny - 1.001);
            const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j;
            const k = j * nx + i;
            for (let c = 0; c < 2; c++) {
                const f = c ? fy : fx;
                const a = f[k], b = f[k + 1], d = f[k + nx], e = f[k + nx + 1];
                out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
            }
            return out;
        };
    }

    // Bilinear sampler of |grad h| (per mm) for a sampled field.
    function gradientSampler(field) {
        const { values: v, nx, ny, x0, y0, dx, dy } = field;
        const g = new Float32Array(nx * ny);
        for (let j = 0; j < ny; j++) {
            const jm = Math.max(0, j - 1), jp = Math.min(ny - 1, j + 1);
            for (let i = 0; i < nx; i++) {
                const im = Math.max(0, i - 1), ip = Math.min(nx - 1, i + 1);
                const gx = (v[j * nx + ip] - v[j * nx + im]) / ((ip - im) * dx);
                const gy = (v[jp * nx + i] - v[jm * nx + i]) / ((jp - jm) * dy);
                g[j * nx + i] = Math.hypot(gx, gy);
            }
        }
        return (x, y) => {
            const fx = geo.clamp((x - x0) / dx, 0, nx - 1.001), fy = geo.clamp((y - y0) / dy, 0, ny - 1.001);
            const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
            const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i], d = g[(j + 1) * nx + i + 1];
            return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        };
    }

    // Split a polyline into the runs where keep(pt) holds; drops crumbs < 1.5 mm.
    function thin(line, keep) {
        const out = [];
        let run = null;
        for (const pt of line) {
            if (keep(pt)) (run || (run = [])).push(pt);
            else if (run) { out.push(run); run = null; }
        }
        if (run) out.push(run);
        if (out.length === 1 && out[0].length === line.length) return [line];
        return out.filter(r => r.length > 1 && geo.pathLength(r) >= 1.5);
    }

    // Offset a polyline sideways by d along its (averaged) vertex normals.
    function offsetPath(path, d, closed) {
        const n = path.length, out = new Array(n);
        for (let i = 0; i < n; i++) {
            const a = path[i > 0 ? i - 1 : closed ? n - 2 : 0];
            const b = path[i < n - 1 ? i + 1 : closed ? 1 : n - 1];
            const tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
            out[i] = [path[i][0] - (ty / len) * d, path[i][1] + (tx / len) * d];
        }
        if (closed) out[n - 1] = [out[0][0], out[0][1]];
        return out;
    }
})();
