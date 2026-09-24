/*
 * Flow field — evenly spaced streamlines (Jobard & Lefer, 1997) through a
 * vector field. Each streamline grows from a seed in both directions until it
 * gets closer than `test × spacing` to an existing line; new seeds are spawned
 * one spacing to either side of every accepted line. Optional density
 * variation modulates the spacing with noise, which reads as shading.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'flowfield',
        name: 'Flow Field',
        category: 'Fields',
        description: 'Evenly spaced streamlines through noise, curl, vortex or wave fields.',
        fit: false,
        params: [
            { type: 'section', label: 'Field' },
            { id: 'field', label: 'Field', type: 'select', value: 'noise', random: ['noise', 'curl', 'vortex', 'waves', 'spiral'],
                options: [['noise', 'Noise angle'], ['curl', 'Curl noise'], ['vortex', 'Vortices'], ['waves', 'Sine waves'], ['spiral', 'Spiral']] },
            { id: 'scale', label: 'Feature size (mm)', type: 'range', min: 15, max: 400, step: 1, value: 140, random: [60, 320] },
            { id: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 4, step: 0.05, value: 1.4, show: p => p.field !== 'curl', random: [0.5, 1.9] },
            { id: 'octaves', label: 'Octaves', type: 'range', min: 1, max: 5, step: 1, value: 2, random: [1, 3],
                show: p => p.field === 'noise' || p.field === 'curl' || p.field === 'spiral' },
            { id: 'vortices', label: 'Vortices', type: 'range', min: 1, max: 14, step: 1, value: 5, show: p => p.field === 'vortex' },
            { id: 'twist', label: 'Spiral twist°', type: 'range', min: -90, max: 90, step: 1, value: 35, show: p => p.field === 'spiral' },
            { type: 'section', label: 'Lines' },
            { id: 'spacing', label: 'Spacing (mm)', type: 'range', min: 0.6, max: 12, step: 0.1, value: 2.2, random: [1.5, 4.5] },
            { id: 'variation', label: 'Density variation', type: 'range', min: 0, max: 0.9, step: 0.01, value: 0, random: [0, 0.6] },
            { id: 'test', label: 'Closeness', type: 'range', min: 0.2, max: 0.95, step: 0.01, value: 0.55, random: [0.4, 0.75],
                hint: 'How close a line may approach its neighbours before stopping (× spacing)' },
            { id: 'minLen', label: 'Min length (mm)', type: 'range', min: 0, max: 80, step: 1, value: 8, random: [2, 24] },
            { id: 'maxLen', label: 'Max length (mm)', type: 'range', min: 10, max: 2000, step: 10, value: 600, random: [250, 1500] },
            { id: 'step', label: 'Step (mm)', type: 'range', min: 0.2, max: 2, step: 0.05, value: 0.5, random: false },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Split pens by', type: 'select', value: 'angle', show: p => p.pens > 1,
                options: [['angle', 'Direction'], ['region', 'Region'], ['random', 'Random']] },
        ],

        generate(p, ctx) {
            const { width: W, height: H, noise, rng } = ctx;
            const sc = 1 / p.scale;

            // ---- vector field (returns unit vector or null)
            let field;
            if (p.field === 'curl') {
                field = (x, y) => {
                    const v = noise.curl2(x * sc, y * sc, p.octaves);
                    const L = Math.hypot(v[0], v[1]);
                    return L < 1e-9 ? null : [v[0] / L, v[1] / L];
                };
            } else if (p.field === 'vortex') {
                const vs = [];
                for (let i = 0; i < p.vortices; i++) {
                    vs.push({ x: rng.range(0, W), y: rng.range(0, H), s: rng.sign() * rng.range(0.5, 1.5) });
                }
                const soft = (p.scale * 0.25) ** 2;
                const bg = rng.range(0, TAU);
                field = (x, y) => {
                    let vx = Math.cos(bg) * 0.002, vy = Math.sin(bg) * 0.002;
                    for (const v of vs) {
                        const dx = x - v.x, dy = y - v.y, r2 = dx * dx + dy * dy + soft;
                        vx += (-dy * v.s) / r2; vy += (dx * v.s) / r2;
                    }
                    const ang = Math.atan2(vy, vx) + p.turbulence * 0.35 * noise.noise2(x * sc, y * sc);
                    return [Math.cos(ang), Math.sin(ang)];
                };
            } else if (p.field === 'waves') {
                field = (x, y) => {
                    const a = Math.sin(x * sc * TAU) * p.turbulence + Math.cos(y * sc * TAU * 0.7) * p.turbulence * 0.8;
                    return [Math.cos(a), Math.sin(a)];
                };
            } else if (p.field === 'spiral') {
                const cx = W / 2, cy = H / 2, tw = geo.rad(90 + p.twist);
                field = (x, y) => {
                    const a = Math.atan2(y - cy, x - cx) + tw + p.turbulence * 0.4 * noise.fbm2(x * sc, y * sc, p.octaves);
                    return [Math.cos(a), Math.sin(a)];
                };
            } else {
                field = (x, y) => {
                    const a = noise.fbm2(x * sc, y * sc, p.octaves) * Math.PI * p.turbulence;
                    return [Math.cos(a), Math.sin(a)];
                };
            }

            // Cache the field on a grid (vectors, not angles, so branch cuts interpolate cleanly).
            {
                const raw = field;
                const res = geo.clamp(p.scale / 24, 0.4, 2);
                const nx = Math.ceil(W / res) + 3, ny = Math.ceil(H / res) + 3;
                const VX = new Float32Array(nx * ny), VY = new Float32Array(nx * ny);
                for (let j = 0; j < ny; j++) {
                    for (let i = 0; i < nx; i++) {
                        const v = raw((i - 1) * res, (j - 1) * res);
                        if (v) { VX[j * nx + i] = v[0]; VY[j * nx + i] = v[1]; }
                    }
                }
                field = (x, y) => {
                    const fx = geo.clamp(x / res + 1, 0, nx - 1.001), fy = geo.clamp(y / res + 1, 0, ny - 1.001);
                    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, t = fy - j;
                    const k = j * nx + i;
                    const vx = (VX[k] * (1 - u) + VX[k + 1] * u) * (1 - t) + (VX[k + nx] * (1 - u) + VX[k + nx + 1] * u) * t;
                    const vy = (VY[k] * (1 - u) + VY[k + 1] * u) * (1 - t) + (VY[k + nx] * (1 - u) + VY[k + nx + 1] * u) * t;
                    const L = Math.hypot(vx, vy);
                    return L < 0.05 ? null : [vx / L, vy / L];
                };
            }

            // ---- local spacing
            const minSep = p.spacing * (1 - p.variation);
            const sepAt = p.variation > 0
                ? (x, y) => p.spacing * (1 + p.variation * noise.fbm2(x * sc * 0.7 + 50, y * sc * 0.7 - 50, 2))
                : () => p.spacing;

            // ---- spatial grid of accepted streamline points
            const cell = Math.max(0.25, minSep * p.test * 0.75);
            const gx = Math.ceil(W / cell) + 1, gy = Math.ceil(H / cell) + 1;
            const grid = new Array(gx * gy);
            const cellIndex = (x, y) => {
                const i = Math.floor(x / cell), j = Math.floor(y / cell);
                return i < 0 || j < 0 || i >= gx || j >= gy ? -1 : j * gx + i;
            };
            function addPoint(x, y) {
                const c = cellIndex(x, y);
                if (c >= 0) (grid[c] || (grid[c] = [])).push(x, y);
            }
            // Is (x, y) at least d away from every accepted streamline?
            function clear(x, y, d) {
                const d2 = d * d;
                const i0 = Math.max(0, Math.floor((x - d) / cell)), i1 = Math.min(gx - 1, Math.floor((x + d) / cell));
                const j0 = Math.max(0, Math.floor((y - d) / cell)), j1 = Math.min(gy - 1, Math.floor((y + d) / cell));
                for (let j = j0; j <= j1; j++) {
                    for (let i = i0; i <= i1; i++) {
                        const arr = grid[j * gx + i];
                        if (!arr) continue;
                        for (let k = 0; k < arr.length; k += 2) {
                            const dx = arr[k] - x, dy = arr[k + 1] - y;
                            if (dx * dx + dy * dy < d2) return false;
                        }
                    }
                }
                return true;
            }
            // The line being traced keeps its own small grid so it can't spiral into
            // itself; samples within `window` steps of the head are its own tail.
            let own = null;
            function ownAdd(x, y, idx) {
                const c = cellIndex(x, y);
                let arr = own.get(c);
                if (!arr) own.set(c, (arr = []));
                arr.push(x, y, idx);
            }
            function ownClear(x, y, d, idx, window) {
                const d2 = d * d;
                const i0 = Math.floor((x - d) / cell), i1 = Math.floor((x + d) / cell);
                const j0 = Math.floor((y - d) / cell), j1 = Math.floor((y + d) / cell);
                for (let j = j0; j <= j1; j++) {
                    for (let i = i0; i <= i1; i++) {
                        const arr = own.get(j * gx + i);
                        if (!arr) continue;
                        for (let k = 0; k < arr.length; k += 3) {
                            if (Math.abs(arr[k + 2] - idx) < window) continue;
                            const dx = arr[k] - x, dy = arr[k + 1] - y;
                            if (dx * dx + dy * dy < d2) return false;
                        }
                    }
                }
                return true;
            }

            const h = p.step;
            const maxSteps = Math.ceil(p.maxLen / 2 / h); // per direction: a line grows both ways from its seed
            const inBounds = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H && ctx.shape.dist(x, y) > -h;

            function integrate(x, y, dir) {
                const pts = [];
                let idx = 0, prev = null;
                for (let s = 0; s < maxSteps; s++) {
                    const v1 = field(x, y);
                    if (!v1) break;
                    const mx = x + v1[0] * dir * h * 0.5, my = y + v1[1] * dir * h * 0.5;
                    const v2 = field(mx, my);
                    if (!v2) break;
                    const nx = x + v2[0] * dir * h, ny = y + v2[1] * dir * h;
                    if (!inBounds(nx, ny)) break;
                    // stop on sharp reversals (sinks / sources)
                    if (prev && prev[0] * v2[0] + prev[1] * v2[1] < -0.2) break;
                    idx += dir;
                    const dtest = sepAt(nx, ny) * p.test;
                    if (!clear(nx, ny, dtest) || !ownClear(nx, ny, dtest, idx, Math.ceil((dtest * 2.2) / h) + 2)) break;
                    pts.push([nx, ny]);
                    ownAdd(nx, ny, idx);
                    x = nx; y = ny; prev = v2;
                }
                return pts;
            }

            const lines = [];
            const queue = [];

            function tryLine(x, y) {
                if (!inBounds(x, y) || !clear(x, y, sepAt(x, y) * 0.999)) return;
                own = new Map();
                ownAdd(x, y, 0);
                const fwd = integrate(x, y, 1);
                const back = integrate(x, y, -1);
                const pts = back.reverse().concat([[x, y]], fwd);
                if (pts.length < 2 || geo.pathLength(pts) < Math.max(Math.min(p.minLen, p.maxLen), h * 2)) return;
                for (const q of pts) addPoint(q[0], q[1]);
                lines.push(pts);
                // seed candidates one spacing to either side
                const every = Math.max(1, Math.round(sepAt(x, y) / h / 2));
                for (let i = 0; i < pts.length; i += every) {
                    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
                    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
                    const d = sepAt(pts[i][0], pts[i][1]);
                    queue.push([pts[i][0] - (ty / L) * d, pts[i][1] + (tx / L) * d]);
                    queue.push([pts[i][0] + (ty / L) * d, pts[i][1] - (tx / L) * d]);
                }
            }

            // Seed from the centre, flood outwards, then sweep a jittered grid for gaps.
            tryLine(W / 2, H / 2);
            const sweepStep = Math.max(p.spacing * 2, 2);
            const sweep = [];
            for (let y = sweepStep / 2; y < H; y += sweepStep) {
                for (let x = sweepStep / 2; x < W; x += sweepStep) {
                    sweep.push([x + rng.range(-0.3, 0.3) * sweepStep, y + rng.range(-0.3, 0.3) * sweepStep]);
                }
            }
            rng.shuffle(sweep);
            let si = 0, qi = 0;
            const budget = performance.now() + 2500;
            while ((qi < queue.length || si < sweep.length) && performance.now() < budget) {
                const q = qi < queue.length ? queue[qi++] : sweep[si++];
                tryLine(q[0], q[1]);
            }

            if (p.pens <= 1) return lines;
            const n = p.pens;
            return geo.toLayers(lines, n, (line, i) => {
                if (p.penMode === 'random') return Math.floor(rng.random() * n);
                const mid = line[Math.floor(line.length / 2)];
                if (p.penMode === 'region') {
                    const v = noise.noise2(mid[0] * sc * 0.5 + 99, mid[1] * sc * 0.5 - 99);
                    return Math.min(n - 1, Math.floor(((v + 1) / 2) * n));
                }
                const a = line[0], b = line[line.length - 1];
                let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
                if (ang < 0) ang += Math.PI;
                if (ang >= Math.PI) ang -= Math.PI;
                return Math.min(n - 1, Math.floor((ang / Math.PI) * n));
            });
        },
    });
})();
