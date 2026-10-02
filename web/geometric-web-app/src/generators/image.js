/*
 * Image — a photo translated into plotter lines. The luminance raster is
 * sampled bilinearly ('cover' or 'contain' fit), then shaped by contrast,
 * gamma and invert. Renderings:
 *   spiral   — one Archimedean spiral from the centre whose sideways squiggle
 *              grows with darkness (the "SpiralBetty" look), one stroke;
 *   squiggle — horizontal rows with the same darkness-driven squiggle;
 *   waves    — rows lifted by darkness with floating-horizon hidden lines,
 *              the "Unknown Pleasures" look;
 *   hatch    — up to four cross-hatch layers, each drawn only where darkness
 *              passes its threshold;
 *   flow     — engraving-style streamlines along the image's isophotes (from
 *              a smoothed structure tensor), packed closer where it's darker;
 *   contours — iso-lines of the blurred tones, like a topographic map;
 *   halftone — dots on a square, hex, radial or sunflower grid, sized by
 *              darkness and filled with a spiral or rings;
 *   stipple  — weighted Voronoi stippling, one small dot per stipple;
 *   tsp      — TSP art (after Kaplan & Bosch, 2005): darkness-weighted
 *              stipples by dart throwing, evened out by weighted Lloyd
 *              relaxation (Secord, 2002), then a single tour built by
 *              nearest-neighbour and improved with 2-opt and Or-opt moves on
 *              neighbour lists with a fixed work budget;
 *   scribble — the same tour drawn as a run of overlapping loops;
 *   hilbert  — an adaptive Hilbert curve, subdivided deeper where darker;
 *   string   — string art (after Petros Vrellis): one thread wound between
 *              pins, each chord picked greedily as the darkest remaining line.
 * Without an image one of the built-in still lifes is used.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const memo = new Map();

    // Slow modes keep their last result, so changing inks or a cosmetic setting is instant.
    function cached(name, img, key, make) {
        const hit = memo.get(name);
        if (hit && hit.img === img && hit.key === key) return hit.value;
        const value = make();
        memo.set(name, { img, key, value });
        return value;
    }

    // ---- built-in demos. Each is rendered once, at a fixed seed, and kept.
    const demos = {};
    function demoImage(name) {
        if (!demos[name]) demos[name] = (name === 'moon' ? moon : name === 'saturn' ? saturn : spheres)();
        return demos[name];
    }

    // Three spheres on a floor with soft shadows and occlusion (sphere shadow /
    // occlusion approximations after Inigo Quilez)
    function spheres() {
        const w = 240, h = 320, data = new Float32Array(w * h);
        const S = [[-0.42, 1.05, 0.45, 1.05], [1.02, 0.6, -0.7, 0.6], [-1.08, 0.36, -1.25, 0.36]];
        const nz = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
        const [Lx, Ly, Lz] = nz(-0.6, 0.72, -0.35);
        const ox = 0.3, oy = 1.85, oz = -5.9;
        const [fx, fy, fz] = nz(0.05 - ox, 0.62 - oy, 0 - oz);
        const [rx, , rz] = nz(fz, 0, -fx);
        const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
        // soft shadow toward the light from point p (skipping sphere `skip`)
        const shadow = (px, py, pz, skip) => {
            let res = 1;
            for (let i = 0; i < 3; i++) {
                if (i === skip) continue;
                const s = S[i], cx = px - s[0], cy = py - s[1], cz = pz - s[2];
                const b = cx * Lx + cy * Ly + cz * Lz, hh = b * b - (cx * cx + cy * cy + cz * cz - s[3] * s[3]);
                const t = -b - Math.sqrt(Math.max(hh, 0));
                if (t <= 0) continue;
                const d = Math.sqrt(Math.max(0, s[3] * s[3] - hh)) - s[3];
                res = Math.min(res, geo.smoothstep(0, 1, (8 * d) / t));
            }
            return res;
        };
        const occlusion = (px, py, pz, nx, ny, nzz, skip) => {
            let occ = 1;
            for (let i = 0; i < 3; i++) {
                if (i === skip) continue;
                const s = S[i], dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz, l2 = dx * dx + dy * dy + dz * dz, l = Math.sqrt(l2);
                occ *= 1 - (Math.max(0, (nx * dx + ny * dy + nzz * dz) / l) * s[3] * s[3]) / l2;
            }
            return occ;
        };
        const sky = dy => 0.66 + 0.06 * geo.smoothstep(0.2, 0, dy); // light backdrop, darker upward
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const u = ((2 * (i + 0.5)) / w - 1) * (w / h), v = 1 - (2 * (j + 0.5)) / h;
            const [dx, dy, dz] = nz(fx * 2.2 + rx * u + ux * v, fy * 2.2 + uy * v, fz * 2.2 + rz * u + uz * v);
            let t = Infinity, hit = -2;
            for (let k = 0; k < 3; k++) {
                const s = S[k], cx = ox - s[0], cy = oy - s[1], cz = oz - s[2];
                const b = cx * dx + cy * dy + cz * dz, hh = b * b - (cx * cx + cy * cy + cz * cz - s[3] * s[3]);
                if (hh >= 0) { const tk = -b - Math.sqrt(hh); if (tk > 0 && tk < t) { t = tk; hit = k; } }
            }
            if (dy < 0 && -oy / dy < t) { t = -oy / dy; hit = -1; }
            let lum;
            if (hit === -2) lum = sky(dy);
            else {
                const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
                if (hit === -1) {
                    const spot = 0.85 + 0.15 * Math.exp(-0.05 * (px * px + (pz + 0.4) * (pz + 0.4)));
                    lum = 1.02 * spot * (0.72 * Ly * shadow(px, py, pz, -1) + 0.3 * occlusion(px, py, pz, 0, 1, 0, -1));
                    lum = geo.lerp(sky(dy), lum, Math.exp(-0.0018 * t * t)); // fade into the backdrop
                } else {
                    const s = S[hit], nx = (px - s[0]) / s[3], ny = (py - s[1]) / s[3], nzz = (pz - s[2]) / s[3];
                    const dif = Math.max(0, nx * Lx + ny * Ly + nzz * Lz) * shadow(px, py, pz, hit);
                    const amb = (0.55 + 0.45 * ny) * occlusion(px, py, pz, nx, ny, nzz, hit);
                    const dn = dx * nx + dy * ny + dz * nzz;
                    const rl = (dx - 2 * dn * nx) * Lx + (dy - 2 * dn * ny) * Ly + (dz - 2 * dn * nzz) * Lz;
                    lum = 0.86 * (0.8 * dif + 0.2 * amb + 0.12 * Math.max(0, -ny)) + Math.pow(Math.max(0, rl), 40) * 0.6 * dif;
                }
            }
            data[j * w + i] = Math.pow(geo.clamp(lum, 0, 1), 0.85);
        }
        return { width: w, height: h, data };
    }

    // A gibbous moon: craters as bowls with raised rims placed on the sphere,
    // dark maria from low-frequency noise, lit from the upper left.
    function moon() {
        const w = 300, h = 400, data = new Float32Array(w * h).fill(0.98);
        const rng = new PG.RNG(11), noise = PG.makeNoise(rng);
        const craters = [];
        for (let k = 0; k < 150; k++) {
            const z = rng.range(-1, 1), a = rng.range(0, TAU), q = Math.sqrt(1 - z * z);
            const size = 0.02 + 0.17 * Math.pow(rng.random(), 3); // angular radius
            craters.push([q * Math.cos(a), q * Math.sin(a), z, size, Math.cos(size * 1.6)]);
        }
        const R = 0.44 * w, H = new Float32Array(w * h), A = new Float32Array(w * h);
        const L = [-0.72, -0.38, 0.58], Ll = Math.hypot(...L);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const u = (i + 0.5 - w / 2) / R, v = (j + 0.5 - h / 2) / R, r2 = u * u + v * v;
            if (r2 >= 1.02) continue;
            const z = Math.sqrt(Math.max(0, 1 - r2));
            let ht = 0.004 * noise.fbm3(u * 14, v * 14, z * 14, 3);
            for (const [cx, cy, cz, size, cosMax] of craters) {
                const c = u * cx + v * cy + z * cz;
                if (c < cosMax) continue;
                const t = Math.acos(Math.min(1, c)) / size;
                ht += size * ((t < 1 ? 0.9 * (t * t - 1) : 0) + 0.4 * Math.exp(-(((t - 1) / 0.22) ** 2)));
            }
            const mare = geo.smoothstep(0.02, 0.32, noise.fbm3(u * 1.7 + 3, v * 1.7, z * 1.7, 4));
            H[j * w + i] = ht;
            A[j * w + i] = 0.88 - 0.42 * mare + 0.05 * noise.fbm3(u * 9 - 7, v * 9, z * 9, 2);
        }
        for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
            const u = (i + 0.5 - w / 2) / R, v = (j + 0.5 - h / 2) / R, r = Math.hypot(u, v);
            if (r >= 1.01) continue;
            const k = j * w + i, z = Math.sqrt(Math.max(0, 1 - r * r));
            // height slope in sphere radii per radius, tilted onto the normal
            const gu = ((H[k + 1] - H[k - 1]) * R) / 2, gv = ((H[k + w] - H[k - w]) * R) / 2;
            let nx = u - 1.4 * gu, ny = v - 1.4 * gv, nzz = z;
            const nl = Math.hypot(nx, ny, nzz);
            nx /= nl; ny /= nl; nzz /= nl;
            const dif = Math.max(0, (nx * L[0] + ny * L[1] + nzz * L[2]) / Ll);
            const lum = A[k] * (0.05 + 0.95 * dif);
            data[k] = geo.lerp(0.98, Math.pow(geo.clamp(lum, 0, 1), 0.9), geo.smoothstep(1.01, 0.995, r));
        }
        return { width: w, height: h, data };
    }

    // Saturn with banded clouds, rings with the Cassini division, the ring
    // shadow on the planet and the planet's shadow on the rings. Orthographic,
    // 2×2 supersampled for clean ring edges.
    function saturn() {
        const w = 300, h = 380, data = new Float32Array(w * h);
        const noise = PG.makeNoise(new PG.RNG(5));
        const S = 0.3 * w;
        const tilt = geo.rad(24), roll = geo.rad(-24);
        // ring plane normal (the planet's north pole), tipped towards the viewer then rolled
        const n0y = -Math.cos(tilt), Nz = Math.sin(tilt);
        const Nx = -n0y * Math.sin(roll), Ny = n0y * Math.cos(roll);
        const Lraw = [-0.7, -0.32, 0.64], Lm = Math.hypot(...Lraw), L = Lraw.map(c => c / Lm);
        const LN = L[0] * Nx + L[1] * Ny + L[2] * Nz;
        const ringAlpha = r => {
            let a;
            if (r < 1.24 || r > 2.27) return 0;
            if (r < 1.53) a = 0.25;
            else if (r < 1.95) a = 0.9;
            else if (r < 2.03) a = 0.08;
            else if (r > 2.2 && r < 2.22) a = 0.1;
            else a = 0.7;
            return a * (0.82 + 0.18 * Math.sin(r * 95) * Math.sin(r * 37));
        };
        const bg = 0.98;
        const shade = (x, y) => {
            const r2 = x * x + y * y, zs = r2 < 1 ? Math.sqrt(1 - r2) : -Infinity;
            let planet = bg;
            if (r2 < 1) {
                const sinLat = x * Nx + y * Ny + zs * Nz;
                const lon = Math.atan2(y * Nx - x * Ny, zs);
                let alb = 0.7 + 0.09 * Math.sin(sinLat * 23 + 1.5 * noise.noise2(sinLat * 7, lon * 0.6))
                    + 0.04 * noise.fbm2(sinLat * 30, lon * 2, 3) - 0.18 * geo.smoothstep(0.7, 0.95, Math.abs(sinLat));
                let lit = 0.04 + 0.96 * Math.max(0, x * L[0] + y * L[1] + zs * L[2]);
                // ring shadow on the planet
                const t = -sinLat / LN;
                if (t > 0) {
                    const qx = x + t * L[0], qy = y + t * L[1], qz = zs + t * L[2];
                    lit *= 1 - 0.85 * ringAlpha(Math.hypot(qx, qy, qz));
                }
                planet = alb * lit;
            }
            let ring = 0, ringLum = 0, zr = -Infinity;
            if (Math.abs(Nz) > 1e-6) {
                zr = -(x * Nx + y * Ny) / Nz;
                ring = ringAlpha(Math.hypot(x, y, zr));
                if (ring > 0) {
                    ringLum = 0.62 * (0.6 + 0.4 * Math.abs(LN));
                    const tc = -(x * L[0] + y * L[1] + zr * L[2]);
                    if (tc > 0 && x * x + y * y + zr * zr - tc * tc < 1) ringLum *= 0.12;
                }
            }
            if (r2 < 1 && !(ring > 0 && zr > zs)) return planet;
            return geo.lerp(planet, ringLum, ring);
        };
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            let sum = 0;
            for (let s = 0; s < 4; s++) sum += shade((i + 0.25 + 0.5 * (s & 1) - w / 2) / S, (j + 0.25 + 0.5 * (s >> 1) - h / 2) / S);
            data[j * w + i] = Math.pow(geo.clamp(sum / 4, 0, 1), 0.9);
        }
        return { width: w, height: h, data };
    }

    // Bilinear luminance sampler fitted into a box. Outside the image it returns -1,
    // so contrast and invert can't turn the letterbox bars into ink.
    function sampler(img, bb, fit) {
        const iw = img.width, ih = img.height, D = img.data;
        const s = fit === 'contain' ? Math.min(bb.w / iw, bb.h / ih) : Math.max(bb.w / iw, bb.h / ih);
        const ox = bb.minX + (bb.w - iw * s) / 2, oy = bb.minY + (bb.h - ih * s) / 2;
        return (x, y) => {
            const u = (x - ox) / s - 0.5, v = (y - oy) / s - 0.5;
            if (u < -0.5 || v < -0.5 || u > iw - 0.5 || v > ih - 0.5) return -1;
            const uu = geo.clamp(u, 0, iw - 1), vv = geo.clamp(v, 0, ih - 1);
            const i0 = Math.floor(uu), j0 = Math.floor(vv);
            const i1 = Math.min(i0 + 1, iw - 1), j1 = Math.min(j0 + 1, ih - 1);
            const fx = uu - i0, fy = vv - j0;
            const a = D[j0 * iw + i0] + (D[j0 * iw + i1] - D[j0 * iw + i0]) * fx;
            const b = D[j1 * iw + i0] + (D[j1 * iw + i1] - D[j1 * iw + i0]) * fx;
            return a + (b - a) * fy;
        };
    }

    // ---- raster helpers

    // Two box blur passes, close enough to a gaussian. r in samples.
    function boxBlur(v, nx, ny, r) {
        if (r < 1) return;
        const tmp = new Float64Array(Math.max(nx, ny));
        const run = (off, stride, n) => {
            for (let k = 0; k < n; k++) tmp[k] = v[off + k * stride];
            let acc = 0;
            for (let k = -r; k <= r; k++) acc += tmp[geo.clamp(k, 0, n - 1)];
            for (let k = 0; k < n; k++) {
                v[off + k * stride] = acc / (2 * r + 1);
                acc += tmp[Math.min(n - 1, k + r + 1)] - tmp[Math.max(0, k - r)];
            }
        };
        for (let pass = 0; pass < 2; pass++) {
            for (let j = 0; j < ny; j++) run(j * nx, 1, nx);
            for (let i = 0; i < nx; i++) run(i, nx, ny);
        }
    }
    function fieldAt(f) {
        const { values: v, nx, ny, x0, y0, dx, dy } = f;
        return (x, y) => {
            const fx = geo.clamp((x - x0) / dx, 0, nx - 1.001), fy = geo.clamp((y - y0) / dy, 0, ny - 1.001);
            const i = fx | 0, j = fy | 0, u = fx - i, t = fy - j, k = j * nx + i;
            return (v[k] * (1 - u) + v[k + 1] * u) * (1 - t) + (v[k + nx] * (1 - u) + v[k + nx + 1] * u) * t;
        };
    }
    // Darkness on a grid of about `samples` cells over the box, blurred by `blur` mm.
    function darkField(dark, bb, samples, blur) {
        const cell = Math.max(0.2, Math.sqrt((bb.w * bb.h) / samples));
        const f = PG.sampleField(dark, bb.minX, bb.minY, bb.w, bb.h, cell);
        boxBlur(f.values, f.nx, f.ny, Math.round(blur / f.dx));
        f.at = fieldAt(f);
        return f;
    }

    // Span of a horizontal line inside a convex polygon.
    function rowSpan(area, y) {
        let x0 = Infinity, x1 = -Infinity;
        for (let i = 0, n = area.length; i < n; i++) {
            const a = area[i], c = area[(i + 1) % n];
            if ((a[1] - y) * (c[1] - y) > 0 || a[1] === c[1]) continue;
            const x = a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]);
            x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        }
        return x1 > x0 ? [x0, x1] : null;
    }

    // Each path to one pen, by a 0..1 value.
    function byValue(items, pens) {
        const layers = PG.pens.layers(pens);
        for (const [path, v] of items) layers[PG.pens.band(v, layers.length)].push(path);
        return { layers };
    }

    // Push each base point (even arc-length steps) along its unit normal by a
    // sine wave whose amplitude, and optionally frequency, follow darkness.
    function squiggleLine(pts0, normals, dark, p, s, wave) {
        const out = [];
        let ph = 0;
        const k = TAU / wave;
        for (let i = 0; i < pts0.length; i++) {
            const [x, y] = pts0[i];
            const d = dark(x, y);
            const a = p.amp * (s / 2) * d;
            out.push([x + normals[i][0] * a * Math.sin(ph), y + normals[i][1] * a * Math.sin(ph)]);
            ph += k * (i + 1 < pts0.length ? geo.dist(pts0[i], pts0[i + 1]) : 0) * (1 - p.fmod + p.fmod * d);
        }
        return out;
    }

    // A filled dot as one stroke: a spiral out from the centre, closed by a circle at r.
    function spiralDot(x, y, r, pitch, seg) {
        const b = pitch / TAU, pts = [];
        let th = 0;
        while (b * th < r) {
            const rr = b * th;
            pts.push([x + rr * Math.cos(th), y + rr * Math.sin(th)]);
            th += Math.min(0.7, seg / Math.max(rr, 0.08));
        }
        const n = Math.max(8, Math.ceil((TAU * r) / seg));
        for (let i = 0; i <= n; i++) pts.push([x + r * Math.cos(th + (TAU * i) / n), y + r * Math.sin(th + (TAU * i) / n)]);
        return pts;
    }
    // [x, y, r, value] dots to [path, value] items. Outlines use 0.15 mm chords,
    // longer if the whole set would pass about 600k points.
    function dots(list, style, pitch) {
        const filled = r => style !== 'circle' && r > pitch * 0.75;
        let length = 0;
        for (const d of list) length += TAU * d[2] + (filled(d[2]) ? (Math.PI * d[2] * d[2]) / pitch : 0);
        const seg = Math.max(0.15, length / 6e5), ring = r => geo.circle(0, 0, r, Math.max(8, Math.ceil((TAU * r) / seg)));
        const items = [];
        for (const [x, y, r, v] of list) {
            if (!filled(r)) items.push([geo.translatePaths([ring(r)], x, y)[0], v]);
            else if (style === 'spiral') items.push([spiralDot(x, y, r, pitch, seg), v]);
            else for (let rr = r; rr > pitch * 0.3; rr -= pitch) items.push([geo.translatePaths([ring(rr)], x, y)[0], v]);
        }
        return items;
    }

    // ------------------------------------------------------------------
    // TSP art helpers
    // ------------------------------------------------------------------
    function stipple(weight, inside, bb, N, rng) {
        // total weight from a coarse pass sets the Poisson-disk radius for the
        // local target density N·w/Σw: r = k / sqrt(w)
        const g = Math.max(0.5, Math.sqrt((bb.w * bb.h) / 20000));
        let sum = 0, wmax = 0;
        for (let y = bb.minY + g / 2; y < bb.maxY; y += g) for (let x = bb.minX + g / 2; x < bb.maxX; x += g) {
            const w = inside(x, y) ? weight(x, y) : 0;
            sum += w * g * g;
            if (w > wmax) wmax = w;
        }
        if (sum <= 0 || wmax <= 0) return [];
        const k = 0.7 * Math.sqrt(sum / N), rMin = k / Math.sqrt(wmax), rCap = rMin * 6;

        // weight raster shared by dart throwing and relaxation
        const px = Math.max(rMin / 1.6, Math.sqrt((bb.w * bb.h) / 2.5e5));
        const rw = Math.ceil(bb.w / px), rh = Math.ceil(bb.h / px);
        const Wt = new Float32Array(rw * rh);
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
            const x = bb.minX + (i + 0.5) * px, y = bb.minY + (j + 0.5) * px;
            Wt[j * rw + i] = inside(x, y) ? weight(x, y) : 0;
        }
        const R = { Wt, rw, rh, px, bb };
        const cdf = new Float64Array(rw * rh);
        let acc = 0;
        for (let q = 0; q < Wt.length; q++) cdf[q] = acc += Wt[q];
        if (acc <= 0) return [];

        const cell = rMin;
        const gx = Math.ceil(bb.w / cell) + 1, gy = Math.ceil(bb.h / cell) + 1;
        const grid = new Array(gx * gy);
        const X = [], Y = [];
        const tries = N * 12;
        for (let t = 0; t < tries && X.length < N; t++) {
            // pick a pixel with probability ∝ weight (binary search of the cumulative table)
            const target = rng.random() * acc;
            let lo = 0, hi = cdf.length - 1;
            while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] > target) hi = m; else lo = m + 1; }
            const w = Wt[lo], i = lo % rw, j = (lo - i) / rw;
            const x = bb.minX + (i + rng.random()) * px, y = bb.minY + (j + rng.random()) * px;
            if (x > bb.maxX || y > bb.maxY) continue;
            const r = Math.min(rCap, k / Math.sqrt(w)), r2 = r * r;
            const ci = Math.floor((x - bb.minX) / cell), cj = Math.floor((y - bb.minY) / cell), D = Math.ceil(r / cell);
            let ok = true;
            for (let jj = Math.max(0, cj - D); ok && jj <= Math.min(gy - 1, cj + D); jj++) {
                for (let ii = Math.max(0, ci - D); ii <= Math.min(gx - 1, ci + D); ii++) {
                    const arr = grid[jj * gx + ii];
                    if (!arr) continue;
                    for (const id of arr) {
                        const dx = X[id] - x, dy = Y[id] - y;
                        if (dx * dx + dy * dy < r2) { ok = false; break; }
                    }
                    if (!ok) break;
                }
            }
            if (!ok) continue;
            (grid[cj * gx + ci] || (grid[cj * gx + ci] = [])).push(X.length);
            X.push(x); Y.push(y);
        }
        const PX = Float64Array.from(X), PY = Float64Array.from(Y);
        relax(PX, PY, R, rCap, k);
        return [PX, PY];
    }

    // Weighted Lloyd relaxation on the raster (after Secord, 2002): every pixel
    // goes to its nearest stipple (each stipple claims a disc about its local
    // spacing, z-buffer style) and stipples move to the weighted centroid of
    // their pixels. A few rounds turn dart-throwing clumps into even flow.
    function relax(X, Y, R, maxReach, k) {
        const { Wt, rw: w, rh: h, px, bb } = R;
        const N = X.length;
        const best = new Float32Array(w * h), owner = new Int32Array(w * h);
        const sx = new Float64Array(N), sy = new Float64Array(N), sw = new Float64Array(N);
        for (let it = 0; it < 4; it++) {
            best.fill(Infinity);
            owner.fill(-1);
            for (let n = 0; n < N; n++) {
                const ci = (X[n] - bb.minX) / px - 0.5, cj = (Y[n] - bb.minY) / px - 0.5;
                const wl = Wt[geo.clamp(Math.round(cj), 0, h - 1) * w + geo.clamp(Math.round(ci), 0, w - 1)];
                const reach = Math.min(maxReach, (1.6 * k) / Math.sqrt(Math.max(wl, 1e-4))) / px;
                const i0 = Math.max(0, Math.floor(ci - reach)), i1 = Math.min(w - 1, Math.ceil(ci + reach));
                const j0 = Math.max(0, Math.floor(cj - reach)), j1 = Math.min(h - 1, Math.ceil(cj + reach));
                for (let j = j0; j <= j1; j++) {
                    const dy = j - cj, row = j * w;
                    for (let i = i0; i <= i1; i++) {
                        const dx = i - ci, d2 = dx * dx + dy * dy;
                        if (d2 < best[row + i]) { best[row + i] = d2; owner[row + i] = n; }
                    }
                }
            }
            sx.fill(0); sy.fill(0); sw.fill(0);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const q = j * w + i, o = owner[q], wt = Wt[q];
                if (o < 0 || wt <= 0) continue;
                sx[o] += (i + 0.5) * wt; sy[o] += (j + 0.5) * wt; sw[o] += wt;
            }
            for (let n = 0; n < N; n++) {
                if (sw[n] > 0) { X[n] = bb.minX + (sx[n] / sw[n]) * px; Y[n] = bb.minY + (sy[n] / sw[n]) * px; }
            }
        }
    }

    function tour(X, Y, budget) {
        const N = X.length;
        if (N < 3) return Array.from({ length: N }, (_, i) => i);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < N; i++) {
            minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]);
            minY = Math.min(minY, Y[i]); maxY = Math.max(maxY, Y[i]);
        }
        const cell = Math.max(1e-3, Math.sqrt(((maxX - minX) * (maxY - minY)) / N) * 1.5);
        const gx = Math.floor((maxX - minX) / cell) + 1, gy = Math.floor((maxY - minY) / cell) + 1;
        const cellOf = i => Math.floor((Y[i] - minY) / cell) * gx + Math.floor((X[i] - minX) / cell);
        const buckets = Array.from({ length: gx * gy }, () => []);
        for (let i = 0; i < N; i++) buckets[cellOf(i)].push(i);
        const d = (a, b) => { const dx = X[a] - X[b], dy = Y[a] - Y[b]; return Math.sqrt(dx * dx + dy * dy); };

        // Visit grid rings around point a until nothing closer can remain.
        function nearest(a, K) {
            const ci = Math.floor((X[a] - minX) / cell), cj = Math.floor((Y[a] - minY) / cell);
            const best = []; // [dist, id] sorted, at most K
            const maxR = Math.max(gx, gy);
            for (let r = 0; r <= maxR; r++) {
                for (let j = cj - r; j <= cj + r; j++) {
                    if (j < 0 || j >= gy) continue;
                    const edge = j === cj - r || j === cj + r;
                    for (let i = ci - r; i <= ci + r; i += edge || r === 0 ? 1 : 2 * r) {
                        if (i < 0 || i >= gx) continue;
                        for (const b of buckets[j * gx + i]) {
                            if (b === a) continue;
                            const dd = d(a, b);
                            if (best.length < K || dd < best[best.length - 1][0]) {
                                let k = best.length;
                                if (k === K) best.pop(), k--;
                                while (k > 0 && best[k - 1][0] > dd) k--;
                                best.splice(k, 0, [dd, b]);
                            }
                        }
                    }
                }
                if (best.length === K && best[best.length - 1][0] <= r * cell) break;
            }
            return best.map(q => q[1]);
        }

        // neighbour lists
        const KN = 8;
        const nbrs = new Array(N);
        for (let i = 0; i < N; i++) nbrs[i] = nearest(i, KN);

        // greedy nearest-neighbour tour; visited points leave their buckets
        const T = new Int32Array(N), pos = new Int32Array(N);
        const where = new Int32Array(N);
        buckets.forEach(bk => bk.forEach((id, k) => { where[id] = k; }));
        const take = i => {
            const bk = buckets[cellOf(i)], k = where[i], last = bk.pop();
            if (last !== i) { bk[k] = last; where[last] = k; }
        };
        let cur = 0;
        for (let i = 1; i < N; i++) if (X[i] + Y[i] < X[cur] + Y[cur]) cur = i;
        take(cur);
        for (let n = 0; n < N; n++) {
            T[n] = cur; pos[cur] = n;
            if (n === N - 1) break;
            const nx = nearest(cur, 1)[0];
            take(nx);
            cur = nx;
        }

        // 2-opt and Or-opt with neighbour lists and don't-look bits
        const reverse = (i, j) => { // reverse tour positions i..j (cyclic, inclusive)
            let len = ((j - i + N) % N) + 1;
            if (len * 2 > N) { const t = i; i = (j + 1) % N; j = (t - 1 + N) % N; len = N - len; }
            for (let k = 0; k < len >> 1; k++) {
                const a = (i + k) % N, b = (j - k + N) % N;
                const ta = T[a], tb = T[b];
                T[a] = tb; pos[tb] = a; T[b] = ta; pos[ta] = b;
            }
        };
        const next = c => T[(pos[c] + 1) % N], prev = c => T[(pos[c] - 1 + N) % N];
        // Replace tour edges {a,b}, {c,d} by {a,c}, {b,d}, whichever way the tour now runs.
        const swapEdges = (a, b, c, d) => {
            if (next(a) === b) reverse(pos[b], pos[c]); else reverse(pos[a], pos[d]);
        };
        const queue = [], inQ = new Uint8Array(N);
        for (let i = 0; i < N; i++) { queue.push(T[i]); inQ[T[i]] = 1; }
        const push = c => { if (!inQ[c]) { inQ[c] = 1; queue.push(c); } };

        function twoOpt(a) {
            for (let dir = 0; dir < 2; dir++) {
                const pa = pos[a];
                const b = dir === 0 ? T[(pa + 1) % N] : T[(pa - 1 + N) % N];
                const dab = d(a, b);
                for (const c of nbrs[a]) {
                    const dac = d(a, c);
                    if (dac >= dab) break;
                    const pc = pos[c];
                    const e = dir === 0 ? T[(pc + 1) % N] : T[(pc - 1 + N) % N];
                    if (c === b || e === a) continue;
                    if (dac + d(b, e) - dab - d(c, e) < -1e-10) {
                        if (dir === 0) reverse((pa + 1) % N, pc);
                        else reverse(pa, (pc - 1 + N) % N);
                        push(a); push(b); push(c); push(e);
                        return true;
                    }
                }
            }
            return false;
        }
        // Move the run of 1-3 cities starting at a between two cities near it.
        function orOpt(a) {
            if (N < 8) return false;
            let s2 = a;
            for (let L = 1; L <= 3; L++, s2 = next(s2)) {
                const s1 = a, p = prev(s1), n = next(s2);
                const seg = L === 1 ? [s1] : L === 2 ? [s1, s2] : [s1, next(s1), s2];
                const gain = d(p, s1) + d(s2, n) - d(p, n);
                if (gain <= 1e-10) continue;
                for (const c of nbrs[s1]) {
                    if (d(c, s1) >= gain) break;
                    if (seg.includes(c)) continue;
                    for (let opt = 0; opt < 2; opt++) {
                        const x = opt === 0 ? c : prev(c), y = opt === 0 ? next(c) : c;
                        if (x === p || y === p || x === n || y === n || seg.includes(x) || seg.includes(y)) continue;
                        const add = opt === 0 ? d(x, s1) + d(s2, y) - d(x, y) : d(x, s2) + d(s1, y) - d(x, y);
                        if (gain - add > 1e-10) {
                            // as 2-opt steps: p x .. n s2..s1 y, then p n .. x s2..s1 y, then flip the run
                            swapEdges(p, s1, x, y);
                            swapEdges(p, x, n, s2);
                            if (opt === 0) swapEdges(x, s2, s1, y);
                            [p, n, x, y, ...seg].forEach(push);
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        // Keep the legacy budget range, but count candidate visits instead of milliseconds.
        const maxVisits = Math.floor(budget * 128);
        let qi = 0, iter = 0;
        while (qi < queue.length && iter++ < maxVisits) {
            const a = queue[qi++];
            inQ[a] = 0;
            if (qi > 50000) { queue.splice(0, qi); qi = 0; }
            if (!twoOpt(a)) orOpt(a);
        }

        // open the loop at its longest edge
        let cut = 0, longest = -1;
        for (let i = 0; i < N; i++) {
            const L = d(T[i], T[(i + 1) % N]);
            if (L > longest) { longest = L; cut = i; }
        }
        const order = new Array(N);
        for (let i = 0; i < N; i++) order[i] = T[(cut + 1 + i) % N];
        return order;
    }

    // ------------------------------------------------------------------
    // Modes
    // ------------------------------------------------------------------

    // Floating horizon, front (bottom) row first: a row is visible only above
    // everything drawn in front of it, as if each were a filled silhouette.
    function waves(p, dark, area, bb) {
        const s = p.spacing, H = p.height * s;
        const tone = darkField(dark, bb, 1.5e5, Math.min(1.2, s * 0.4)).at;
        const dx = 0.3, nx = Math.ceil(bb.w / dx) + 1;
        const horizon = new Float64Array(nx).fill(Infinity);
        const out = [];
        for (let y = bb.maxY - s / 2; y > bb.minY; y -= s) {
            const span = rowSpan(area, y);
            if (!span || span[1] - span[0] < s) continue;
            const i0 = Math.max(0, Math.ceil((span[0] - bb.minX) / dx)), i1 = Math.min(nx - 1, Math.floor((span[1] - bb.minX) / dx));
            const ys = new Float64Array(i1 - i0 + 1);
            for (let i = i0; i <= i1; i++) ys[i - i0] = y - H * tone(bb.minX + i * dx, y);
            if (!p.hidden) {
                out.push(Array.from(ys, (yy, k) => [bb.minX + (i0 + k) * dx, yy]));
                continue;
            }
            let run = null;
            for (let i = i0; i <= i1; i++) {
                const x = bb.minX + i * dx, yy = ys[i - i0], hz = horizon[i];
                const vis = yy < hz - 1e-6;
                if (vis && !run) {
                    run = [];
                    // enter where the row crosses the horizon between the samples
                    if (i > i0 && isFinite(horizon[i - 1])) {
                        const a = ys[i - i0 - 1] - horizon[i - 1], b = yy - hz, t = a / (a - b);
                        if (t > 0 && t < 1) run.push([x - dx + t * dx, ys[i - i0 - 1] + t * (yy - ys[i - i0 - 1])]);
                    }
                    run.push([x, yy]);
                } else if (vis) run.push([x, yy]);
                else if (run) {
                    const a = ys[i - i0 - 1] - horizon[i - 1], b = yy - hz, t = a / (a - b);
                    if (isFinite(t) && t > 0 && t < 1) run.push([x - dx + t * dx, ys[i - i0 - 1] + t * (yy - ys[i - i0 - 1])]);
                    if (run.length > 1) out.push(run);
                    run = null;
                }
            }
            if (run && run.length > 1) out.push(run);
            for (let i = i0; i <= i1; i++) horizon[i] = Math.min(horizon[i], ys[i - i0]);
        }
        return out;
    }

    // Evenly spaced streamlines (Jobard & Lefer, 1997) through the tangents of
    // the tone's structure tensor, with spacing set by darkness. A little of a
    // fixed direction is mixed into the tensor so flat areas still have one.
    function flow(p, dark, bb, ctx, rng) {
        const f = darkField(dark, bb, 1.2e5, 1.2);
        const tone = f.at, { nx, ny, values: v } = f;
        const XX = new Float64Array(nx * ny), XY = new Float64Array(nx * ny), YY = new Float64Array(nx * ny);
        let mean = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            const gx = (v[j * nx + Math.min(nx - 1, i + 1)] - v[j * nx + Math.max(0, i - 1)]) / 2;
            const gy = (v[Math.min(ny - 1, j + 1) * nx + i] - v[Math.max(0, j - 1) * nx + i]) / 2;
            XX[k] = gx * gx; XY[k] = gx * gy; YY[k] = gy * gy;
            mean += XX[k] + YY[k];
        }
        mean /= nx * ny;
        const r = Math.round(3 / f.dx);
        boxBlur(XX, nx, ny, r); boxBlur(XY, nx, ny, r); boxBlur(YY, nx, ny, r);
        const b = geo.rad(p.angle), sb = Math.sin(b), cb = Math.cos(b);
        const e = (mean * (1 - p.follow)) / (p.follow + 0.02) + 1e-12;
        // doubled tangent angle, so opposite directions interpolate together
        const C2 = new Float32Array(nx * ny), S2 = new Float32Array(nx * ny);
        for (let k = 0; k < nx * ny; k++) {
            const a = XX[k] + e * sb * sb, c = YY[k] + e * cb * cb, xy = XY[k] - e * sb * cb;
            const th = 0.5 * Math.atan2(2 * xy, a - c) + Math.PI / 2;
            C2[k] = Math.cos(2 * th); S2[k] = Math.sin(2 * th);
        }
        const field = (x, y) => {
            const fx = geo.clamp((x - f.x0) / f.dx, 0, nx - 1.001), fy = geo.clamp((y - f.y0) / f.dy, 0, ny - 1.001);
            const i = fx | 0, j = fy | 0, u = fx - i, t = fy - j, k = j * nx + i;
            const c = (C2[k] * (1 - u) + C2[k + 1] * u) * (1 - t) + (C2[k + nx] * (1 - u) + C2[k + nx + 1] * u) * t;
            const s = (S2[k] * (1 - u) + S2[k + 1] * u) * (1 - t) + (S2[k + nx] * (1 - u) + S2[k + nx + 1] * u) * t;
            const a = Math.atan2(s, c) / 2;
            return [Math.cos(a), Math.sin(a)];
        };

        const minSep = p.spacing * 0.7, cutoff = 0.06;
        const sepAt = (x, y) => minSep * (1 + 3 * Math.pow(1 - geo.clamp(tone(x, y), 0, 1), 1.6));
        const test = 0.55, h = 0.35;
        const cell = Math.max(0.25, minSep * test * 0.75);
        const gx = Math.ceil(bb.w / cell) + 1, gy = Math.ceil(bb.h / cell) + 1;
        const grid = new Array(gx * gy);
        const cellIndex = (x, y) => {
            const i = Math.floor((x - bb.minX) / cell), j = Math.floor((y - bb.minY) / cell);
            return i < 0 || j < 0 || i >= gx || j >= gy ? -1 : j * gx + i;
        };
        const addPoint = (x, y) => { const c = cellIndex(x, y); if (c >= 0) (grid[c] || (grid[c] = [])).push(x, y); };
        function clear(x, y, d) {
            const d2 = d * d;
            const i0 = Math.max(0, Math.floor((x - d - bb.minX) / cell)), i1 = Math.min(gx - 1, Math.floor((x + d - bb.minX) / cell));
            const j0 = Math.max(0, Math.floor((y - d - bb.minY) / cell)), j1 = Math.min(gy - 1, Math.floor((y + d - bb.minY) / cell));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const arr = grid[j * gx + i];
                if (!arr) continue;
                for (let k = 0; k < arr.length; k += 2) {
                    const dx = arr[k] - x, dy = arr[k + 1] - y;
                    if (dx * dx + dy * dy < d2) return false;
                }
            }
            return true;
        }
        // the line being traced keeps its own grid so loops round a dark blob
        // stop when they come back to their start instead of retracing
        let own = null;
        const ownAdd = (x, y, idx) => {
            const c = cellIndex(x, y);
            let arr = own.get(c);
            if (!arr) own.set(c, (arr = []));
            arr.push(x, y, idx);
        };
        function ownClear(x, y, d, idx, window) {
            const d2 = d * d;
            const i0 = Math.floor((x - d - bb.minX) / cell), i1 = Math.floor((x + d - bb.minX) / cell);
            const j0 = Math.floor((y - d - bb.minY) / cell), j1 = Math.floor((y + d - bb.minY) / cell);
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const arr = own.get(j * gx + i);
                if (!arr) continue;
                for (let k = 0; k < arr.length; k += 3) {
                    if (Math.abs(arr[k + 2] - idx) < window) continue;
                    const dx = arr[k] - x, dy = arr[k + 1] - y;
                    if (dx * dx + dy * dy < d2) return false;
                }
            }
            return true;
        }
        const usable = (x, y) => x >= bb.minX && y >= bb.minY && x <= bb.maxX && y <= bb.maxY && ctx.shape.dist(x, y) > -h && tone(x, y) > cutoff;
        const maxSteps = Math.ceil(400 / h);
        function integrate(x, y, dir) {
            const pts = [];
            let idx = 0, prev = null;
            for (let s = 0; s < maxSteps; s++) {
                let v1 = field(x, y);
                if (prev ? v1[0] * prev[0] + v1[1] * prev[1] < 0 : dir < 0) v1 = [-v1[0], -v1[1]];
                let v2 = field(x + v1[0] * h * 0.5, y + v1[1] * h * 0.5);
                if (v2[0] * v1[0] + v2[1] * v1[1] < 0) v2 = [-v2[0], -v2[1]];
                const nx2 = x + v2[0] * h, ny2 = y + v2[1] * h;
                if (!usable(nx2, ny2)) break;
                idx += dir;
                const dtest = sepAt(nx2, ny2) * test;
                if (!clear(nx2, ny2, dtest) || !ownClear(nx2, ny2, dtest, idx, Math.ceil((dtest * 2.2) / h) + 2)) break;
                pts.push([nx2, ny2]);
                ownAdd(nx2, ny2, idx);
                x = nx2; y = ny2; prev = v2;
            }
            return pts;
        }
        const lines = [], queue = [];
        function tryLine(x, y) {
            if (!usable(x, y) || !clear(x, y, sepAt(x, y) * 0.999)) return 0;
            own = new Map();
            ownAdd(x, y, 0);
            const fwd = integrate(x, y, 1), back = integrate(x, y, -1);
            const pts = back.reverse().concat([[x, y]], fwd);
            if (geo.pathLength(pts) < Math.max(1.5, minSep * 1.5)) return pts.length;
            for (const q of pts) addPoint(q[0], q[1]);
            lines.push(pts);
            const every = Math.max(1, Math.round(minSep / h / 2));
            for (let i = 0; i < pts.length; i += every) {
                const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
                const tx = c[0] - a[0], ty = c[1] - a[1], L = Math.hypot(tx, ty) || 1;
                const d = sepAt(pts[i][0], pts[i][1]);
                queue.push([pts[i][0] - (ty / L) * d, pts[i][1] + (tx / L) * d]);
                queue.push([pts[i][0] + (ty / L) * d, pts[i][1] - (tx / L) * d]);
            }
            return pts.length;
        }
        const sweepStep = Math.max(minSep * 2, 2), sweep = [];
        for (let y = bb.minY + sweepStep / 2; y < bb.maxY; y += sweepStep) {
            for (let x = bb.minX + sweepStep / 2; x < bb.maxX; x += sweepStep) {
                sweep.push([x + rng.range(-0.3, 0.3) * sweepStep, y + rng.range(-0.3, 0.3) * sweepStep]);
            }
        }
        // darkest seeds first, so the main forms set the flow
        sweep.sort((a, c) => tone(c[0], c[1]) - tone(a[0], a[1]));
        // step budget rather than wall time, so a seed draws the same everywhere
        let si = 0, qi = 0, work = 0;
        while ((qi < queue.length || si < sweep.length) && work < 3e6) {
            const q = qi < queue.length ? queue[qi++] : sweep[si++];
            work += 1 + tryLine(q[0], q[1]);
        }
        return lines;
    }

    function contours(p, dark, bb) {
        const f = darkField(dark, bb, 2.5e5, p.blur);
        const n = Math.round(p.levels), items = [];
        for (let k = 1; k <= n; k++) {
            const level = k / (n + 1);
            for (const line of PG.isolines(f, level)) if (geo.pathLength(line) > 0.8) items.push([line, level]);
        }
        return items;
    }

    function halftone(p, dark, bb, ctx, cx, cy) {
        const s = p.cell, centres = [];
        const R = Math.hypot(bb.w, bb.h) / 2 + s;
        if (p.grid === 'radial') {
            centres.push([cx, cy]);
            for (let r = s, ring = 1; r <= R; r += s, ring++) {
                const n = Math.max(6, Math.round((TAU * r) / s)), a0 = ring * 0.7;
                for (let k = 0; k < n; k++) centres.push([cx + r * Math.cos(a0 + (TAU * k) / n), cy + r * Math.sin(a0 + (TAU * k) / n)]);
            }
        } else if (p.grid === 'sunflower') {
            // golden-angle spiral with one dot per s² of area
            const c = s / Math.sqrt(Math.PI), golden = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; c * Math.sqrt(i) <= R; i++) {
                const r = c * Math.sqrt(i + 0.5), a = i * golden;
                centres.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        } else {
            const a = geo.rad(p.angle), ca = Math.cos(a), sa = Math.sin(a);
            const hex = p.grid === 'hex', rowH = hex ? (s * Math.sqrt(3)) / 2 : s;
            for (let v = -R, row = 0; v <= R; v += rowH, row++) {
                for (let u = -R + (hex && row % 2 ? s / 2 : 0); u <= R; u += s) centres.push([cx + ca * u - sa * v, cy + sa * u + ca * v]);
            }
        }
        const tone = darkField(dark, bb, 1.5e5, s * 0.25).at;
        const list = [];
        for (const [x, y] of centres) {
            if (x < bb.minX - s || x > bb.maxX + s || y < bb.minY - s || y > bb.maxY + s || ctx.shape.dist(x, y) < -s) continue;
            const d = geo.clamp(tone(x, y), 0, 1);
            // radius by sqrt so the inked area tracks darkness
            const r = (s / 2) * p.dotSize * Math.sqrt(d);
            if (r >= 0.15) list.push([x, y, r, d]);
        }
        return dots(list, p.dot, p.fill);
    }

    // String art. The image is a residual raster; each step looks at every
    // chord from the current pin, takes the one with the darkest mean residual
    // and lightens the pixels it crosses by `opacity`. The residual can go
    // negative, so chords avoid areas that are light or already dark enough,
    // and the thread stops once no chord would help. Pins too close together,
    // on the same straight edge, or already joined are skipped.
    function stringArt(p, dark, area, bb, ctx, cx, cy) {
        const nP = Math.round(p.pins), pins = [], edgeOf = [];
        if (p.frame === 'circle') {
            const R = (ctx.shape.dist(cx, cy) > 1 ? ctx.shape.dist(cx, cy) : Math.min(bb.w, bb.h) / 2) - 0.5;
            for (let k = 0; k < nP; k++) {
                const a = -Math.PI / 2 + (TAU * k) / nP;
                pins.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
                edgeOf.push(-1);
            }
        } else {
            const loop = geo.insetConvex(area, 0.5);
            const poly = loop.length > 2 ? loop : area;
            const lens = poly.map((q, i) => geo.dist(q, poly[(i + 1) % poly.length]));
            const total = lens.reduce((a, b) => a + b, 0);
            // long straight edges count as one side; a circle clip has many short ones
            const straight = lens.map(L => L > total / 24);
            for (let k = 0, e = 0, acc = 0; k < nP; k++) {
                const at = (total * k) / nP;
                while (acc + lens[e] < at) acc += lens[e++];
                const a = poly[e], b = poly[(e + 1) % poly.length], t = (at - acc) / lens[e];
                pins.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
                edgeOf.push(straight[e] ? e : -1);
            }
        }
        const px = Math.max(0.35, Math.sqrt((bb.w * bb.h) / 9e4));
        const rw = Math.ceil(bb.w / px) + 1, rh = Math.ceil(bb.h / px) + 1;
        const Res = new Float32Array(rw * rh), Orig = new Float32Array(rw * rh);
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
            const x = bb.minX + (i + 0.5) * px, y = bb.minY + (j + 0.5) * px;
            Res[j * rw + i] = Orig[j * rw + i] = ctx.shape.dist(x, y) > 0 ? dark(x, y) : 0;
        }
        const P = pins.map(q => [geo.clamp((q[0] - bb.minX) / px - 0.5, 0, rw - 1), geo.clamp((q[1] - bb.minY) / px - 0.5, 0, rh - 1)]);
        // chords as DDA walks over the raster; `lighten` > 0 also subtracts it on the way
        const walk = (a, b, R, lighten) => {
            const ax = P[a][0] + 0.5, ay = P[a][1] + 0.5, bx = P[b][0] + 0.5, by = P[b][1] + 0.5;
            const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
            const sx = (bx - ax) / n, sy = (by - ay) / n;
            let sum = 0;
            for (let k = 0, x = ax, y = ay; k <= n; k++, x += sx, y += sy) {
                const q = (y | 0) * rw + (x | 0);
                sum += R[q];
                if (lighten) R[q] -= lighten;
            }
            return sum / (n + 1);
        };
        const mean = (a, b, R) => walk(a, b, R, 0);
        const gap = Math.max(2, Math.round(nP / 20));
        const used = new Set();
        let cur = 0;
        const seq = [0], tones = [];
        for (let t = 0; t < p.threads; t++) {
            let best = -1, score = 0;
            for (let j = 0; j < nP; j++) {
                const dd = Math.abs(j - cur), d = Math.min(dd, nP - dd);
                if (d < gap || (edgeOf[j] >= 0 && edgeOf[j] === edgeOf[cur])) continue;
                if (used.has(Math.min(cur, j) * nP + Math.max(cur, j))) continue;
                const m = mean(cur, j, Res);
                if (m > score) { score = m; best = j; }
            }
            if (best < 0) break;
            walk(cur, best, Res, p.opacity);
            used.add(Math.min(cur, best) * nP + Math.max(cur, best));
            tones.push(mean(cur, best, Orig));
            seq.push(best);
            cur = best;
        }
        return { path: seq.map(k => pins[k]), tones };
    }

    // Adaptive Hilbert curve: a cell splits into four while it's larger than
    // the size its darkest corner asks for. Neighbouring leaves of different
    // sizes join with short diagonals, which is part of the look.
    function hilbert(p, dark, bb, ctx, cx, cy) {
        const tone = darkField(dark, bb, 1.5e5, 0.6).at;
        const side = Math.max(bb.w, bb.h), range = Math.round(p.range);
        const maxDepth = Math.max(1, Math.ceil(Math.log2(side / p.spacing)));
        const pts = [];
        // A curve with cell size c inks about spacing / c of what the finest cells do,
        // so the target cell is spacing / darkness, capped at 2^range × spacing.
        // Halfway between the mean and the darkest sample keeps small dark details.
        const split = (x, y, size) => {
            if (ctx.shape.dist(x, y) < -size * 0.75) return false;
            let max = 0, sum = 0;
            for (let a = -0.4; a <= 0.41; a += 0.4) for (let b = -0.4; b <= 0.41; b += 0.4) {
                const d = tone(x + a * size, y + b * size);
                max = Math.max(max, d); sum += d;
            }
            const d = Math.max((max + sum / 9) / 2, Math.pow(2, -range));
            return size > (p.spacing / d) * Math.SQRT2;
        };
        (function rec(x0, y0, xi, xj, yi, yj, depth) {
            const mx = x0 + (xi + yi) / 2, my = y0 + (xj + yj) / 2, size = Math.abs(xi + xj);
            if (depth >= maxDepth || !split(mx, my, size)) { pts.push([mx, my]); return; }
            const hx = xi / 2, hj = xj / 2, hy = yi / 2, hyj = yj / 2;
            rec(x0, y0, hy, hyj, hx, hj, depth + 1);
            rec(x0 + hx, y0 + hj, hx, hj, hy, hyj, depth + 1);
            rec(x0 + hx + hy, y0 + hj + hyj, hx, hj, hy, hyj, depth + 1);
            rec(x0 + hx + yi, y0 + hj + yj, -hy, -hyj, -hx, -hj, depth + 1);
        })(cx - side / 2, cy - side / 2, side, 0, 0, side, 0);
        // lift the pen over blank paper instead of crossing it in huge cells
        const runs = [];
        let run = [];
        for (let i = 0; i < pts.length; i++) {
            const lit = i + 1 < pts.length && Math.max(tone(...pts[i]), tone(...pts[i + 1])) < 0.03;
            run.push(pts[i]);
            if (lit || i + 1 === pts.length) {
                if (run.length > 1) runs.push(p.round ? geo.chaikin(run, 2) : run);
                run = [];
            }
        }
        return runs;
    }

    // The tour as a chain of loops: an epicycle riding along the route, sized to
    // the local stipple spacing so the loops just overlap in dark areas. Capped
    // near the median spacing, or the sparse light areas fill in with big loops.
    function scribble(order, X, Y, size) {
        const N = order.length;
        if (N < 2) return [];
        const edge = k => Math.hypot(X[order[k + 1]] - X[order[k]], Y[order[k + 1]] - Y[order[k]]);
        const E = Array.from({ length: N - 1 }, (_, k) => edge(k));
        const sorted = E.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 1;
        const rad = E.map((e, k) => {
            const prev = k > 0 ? E[k - 1] : e;
            return geo.clamp(0.5 * size * Math.min((e + prev) / 2, med), 0.25, 6);
        });
        rad.push(rad[rad.length - 1]);
        const out = [];
        let ph = 0;
        for (let k = 0; k < N - 1; k++) {
            const a = order[k], b = order[k + 1], L = E[k], r0 = rad[k], r1 = rad[k + 1];
            const steps = Math.max(1, Math.ceil(L / (0.06 * Math.min(r0, r1))));
            for (let i = 0; i < steps; i++) {
                const t = i / steps, r = r0 + (r1 - r0) * t;
                out.push([X[a] + (X[b] - X[a]) * t + r * Math.cos(ph), Y[a] + (Y[b] - Y[a]) * t + r * Math.sin(ph)]);
                ph += (L / steps) * (TAU / (1.3 * r));
            }
        }
        return out;
    }

    const LINE_MODES = ['spiral', 'squiggle', 'waves', 'hatch', 'flow', 'hilbert'];
    const shows = (...modes) => p => modes.includes(p.mode);

    PG.register({
        id: 'image',
        name: 'Image',
        category: 'Image',
        description: 'Turn a photo into plotter lines: squiggle spirals, waves, engraving, halftone, stipples, TSP art, string art and more.',
        fit: false,
        // One gallery card per mode. They all open this design, so a loaded photo carries across.
        gallery: [
            ['spiral', 'spheres', 'Squiggle Spiral', 'One spiral from the centre that squiggles harder where the photo is darker.'],
            ['squiggle', 'moon', 'Squiggle Rows', 'Rows of squiggles whose height and pace follow the tones.'],
            ['waves', 'moon', 'Waves', 'Rows lifted by darkness with hidden lines removed, like the Unknown Pleasures cover.'],
            ['hatch', 'saturn', 'Cross-Hatch', 'Up to four layers of hatching, each one starting at a darker tone.'],
            ['flow', 'spheres', 'Flow Lines', 'Engraving-style lines that bend round the shapes in the photo.'],
            ['contours', 'moon', 'Contours', 'Iso-lines of the tones, like a topographic map of the photo.'],
            ['halftone', 'saturn', 'Halftone', 'Filled dots on a hex, square, radial or sunflower grid.'],
            ['stipple', 'spheres', 'Stipple', 'Weighted Voronoi stippling, one small dot per point.'],
            ['tsp', 'spheres', 'TSP Art', 'The whole photo as one continuous line through stippled points.'],
            ['scribble', 'saturn', 'Scribble', 'One line of overlapping loops that bunch up in the dark areas.'],
            ['hilbert', 'moon', 'Hilbert Curve', 'A space-filling curve that subdivides deeper where it is darker.'],
            ['string', 'moon', 'String Art', 'One thread wound between pins round a circle, like nail and thread portraits.'],
        ].map(([mode, sample, name, description]) => ({ name, description, params: { mode }, preview: { sample } })),
        params: [
            { type: 'section', label: 'Image' },
            { id: 'image', label: 'Image', type: 'image' },
            { id: 'sample', label: 'Sample', type: 'select', value: 'spheres', show: p => !p.image, random: ['spheres', 'moon', 'saturn'],
                options: [['spheres', 'Spheres'], ['moon', 'Moon'], ['saturn', 'Saturn']], hint: 'Built-in picture used until you load one' },
            { id: 'fit', label: 'Fit', type: 'select', value: 'cover', options: [['cover', 'Cover (crop)'], ['contain', 'Contain']] },
            { id: 'contrast', label: 'Contrast', type: 'range', min: 0.2, max: 3, step: 0.05, value: 1.2, random: [0.9, 1.6] },
            { id: 'brightness', label: 'Brightness', type: 'range', min: -1, max: 1, step: 0.01, value: 0, random: [-0.25, 0.25] },
            { id: 'invert', label: 'Invert', type: 'checkbox', value: false },
            { type: 'section', label: 'Lines' },
            { id: 'mode', label: 'Mode', type: 'select', value: 'spiral', random: true,
                options: [['spiral', 'Squiggle spiral'], ['squiggle', 'Squiggle rows'], ['waves', 'Waves'], ['hatch', 'Cross-hatch'],
                    ['flow', 'Flow lines (engraving)'], ['contours', 'Contours'], ['halftone', 'Halftone dots'], ['stipple', 'Stipple dots'],
                    ['tsp', 'TSP single line'], ['scribble', 'Scribble loops'], ['hilbert', 'Hilbert curve'], ['string', 'String art']] },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.6, max: 6, step: 0.05, value: 1.6, random: [1.2, 2.4],
                show: shows(...LINE_MODES), hint: 'For flow lines and the Hilbert curve this is the spacing in the darkest areas' },
            { id: 'amp', label: 'Amplitude', type: 'range', min: 0, max: 1.5, step: 0.01, value: 1, random: [0.75, 1.1],
                show: shows('spiral', 'squiggle'), hint: 'Squiggle height in the darkest areas, × line spacing' },
            { id: 'wave', label: 'Wavelength (mm)', type: 'range', min: 0.3, max: 6, step: 0.05, value: 1, random: [0.7, 1.8],
                show: shows('spiral', 'squiggle') },
            { id: 'fmod', label: 'Frequency modulation', type: 'range', min: 0, max: 1, step: 0.01, value: 0.4,
                show: shows('spiral', 'squiggle'), hint: 'Lighter areas get longer, lazier waves' },
            { id: 'extent', label: 'Spiral extent', type: 'select', value: 'circle', show: shows('spiral'),
                options: [['circle', 'Circle'], ['page', 'Whole area']] },
            { id: 'join', label: 'Join rows into one stroke', type: 'checkbox', value: false, show: shows('squiggle') },
            { id: 'height', label: 'Wave height', type: 'range', min: 0, max: 10, step: 0.1, value: 5, random: [3, 7],
                show: shows('waves'), hint: 'Lift in the darkest areas, × line spacing' },
            { id: 'hidden', label: 'Hide lines behind', type: 'checkbox', value: true, show: shows('waves') },
            { id: 'layers', label: 'Hatch layers', type: 'range', min: 1, max: 4, step: 1, value: 4, random: [3, 4], show: shows('hatch') },
            { id: 'angle', label: 'Angle°', type: 'range', min: 0, max: 180, step: 1, value: 45,
                show: p => p.mode === 'hatch' || p.mode === 'flow' || (p.mode === 'halftone' && (p.grid === 'square' || p.grid === 'hex')),
                hint: 'Hatch and grid angle, or the flow direction where the image is flat' },
            { id: 'follow', label: 'Follow image', type: 'range', min: 0, max: 1, step: 0.01, value: 0.85, random: [0.6, 1],
                show: shows('flow'), hint: 'How strongly lines bend round shapes in the image instead of keeping the angle' },
            { id: 'levels', label: 'Levels', type: 'range', min: 3, max: 40, step: 1, value: 14, random: [8, 22], show: shows('contours') },
            { id: 'blur', label: 'Smoothing (mm)', type: 'range', min: 0, max: 5, step: 0.1, value: 1, random: [0.5, 2], show: shows('contours') },
            { id: 'grid', label: 'Grid', type: 'select', value: 'hex', random: true, show: shows('halftone'),
                options: [['square', 'Square'], ['hex', 'Hexagonal'], ['radial', 'Radial'], ['sunflower', 'Sunflower']] },
            { id: 'cell', label: 'Dot spacing (mm)', type: 'range', min: 1.5, max: 12, step: 0.1, value: 3.2, random: [2.6, 5], show: shows('halftone') },
            { id: 'dotSize', label: 'Dot size', type: 'range', min: 0.3, max: 1.6, step: 0.01, value: 1.08, random: [0.9, 1.2],
                show: shows('halftone'), hint: 'Dot diameter in the darkest areas, × dot spacing' },
            { id: 'stippleSize', label: 'Dot size (mm)', type: 'range', min: 0.2, max: 4, step: 0.05, value: 0.9, random: [0.5, 1.4], show: shows('stipple') },
            { id: 'dot', label: 'Dot fill', type: 'select', value: 'spiral', random: true, show: shows('halftone', 'stipple'),
                options: [['spiral', 'Spiral'], ['rings', 'Rings'], ['circle', 'Outline only']] },
            { id: 'fill', label: 'Fill pitch (mm)', type: 'range', min: 0.2, max: 1.5, step: 0.05, value: 0.45, random: false,
                show: p => shows('halftone', 'stipple')(p) && p.dot !== 'circle', hint: 'Gap between turns of the fill. Match it to your pen width' },
            { id: 'dots', label: 'Dots', type: 'range', min: 300, max: 30000, step: 100, value: 5000, random: false, show: shows('stipple') },
            { id: 'points', label: 'Points', type: 'range', min: 500, max: 20000, step: 100, value: 10000, random: false, show: shows('tsp') },
            { id: 'budget', label: 'Tour refinement', type: 'range', min: 0, max: 3000, step: 50, value: 400, random: false,
                hint: 'Each unit allows 128 candidate visits. Higher values improve the route, with repeatable results.', show: shows('tsp') },
            { id: 'loops', label: 'Points', type: 'range', min: 200, max: 6000, step: 50, value: 1800, random: false, show: shows('scribble') },
            { id: 'loopSize', label: 'Loop size', type: 'range', min: 0.3, max: 2, step: 0.05, value: 0.9, random: [0.7, 1.3],
                show: shows('scribble'), hint: 'Loop diameter, × the distance between points' },
            { id: 'range', label: 'Tonal range', type: 'range', min: 1, max: 6, step: 1, value: 4, random: [3, 5],
                show: shows('hilbert'), hint: 'Each step doubles the cell size between the darkest and lightest areas' },
            { id: 'round', label: 'Round corners', type: 'checkbox', value: true, random: 0.5, show: shows('hilbert') },
            { id: 'frame', label: 'Pins', type: 'select', value: 'circle', show: shows('string'),
                options: [['circle', 'Circle'], ['shape', 'Around the edge']] },
            { id: 'pins', label: 'Pin count', type: 'range', min: 60, max: 500, step: 2, value: 260, random: false, show: shows('string') },
            { id: 'threads', label: 'Lines', type: 'range', min: 200, max: 8000, step: 50, value: 4000, random: false, show: shows('string'), hint: 'Upper limit. The thread stops early once no line would help' },
            { id: 'opacity', label: 'Line weight', type: 'range', min: 0.05, max: 1, step: 0.01, value: 0.3, random: [0.22, 0.45],
                show: shows('string'), hint: 'How much darkness each line uses up. Lower packs more lines into the dark areas' },
            { type: 'section', label: 'Pens' },
            { id: 'pens' },
        ],

        randomize(rng, p) {
            // full-page squiggle rows are the heaviest mode: give them more air
            if (p.mode === 'squiggle') return { spacing: +rng.range(1.7, 2.6).toFixed(2) };
            if (p.mode === 'waves') return { spacing: +rng.range(1.6, 3).toFixed(2) };
            return {};
        },

        generate(p, ctx) {
            const { rng } = ctx;
            const img = ctx.images && ctx.images.image && ctx.images.image.data ? ctx.images.image : demoImage(p.sample);
            const area = ctx.shape.polygon();
            const bb = geo.bbox([area]);
            const lum = sampler(img, bb, p.fit);
            const gamma = Math.pow(2, -1.5 * p.brightness);
            const dark = (x, y) => {
                const v = lum(x, y);
                if (v < 0) return 0;
                let l = (v - 0.5) * p.contrast + 0.5;
                l = Math.pow(geo.clamp(l, 0, 1), gamma);
                return p.invert ? l : 1 - l;
            };
            const pens = PG.pens.count(p.pens);
            const color = paths => PG.pens.tones(paths, pens, dark);
            const s = p.spacing;
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            // the stipple and tour inputs, for the modes that cache them
            const tone = [ctx.seed, area, ctx.shape.kind, p.fit, p.brightness, p.contrast, p.invert];
            const inside = (x, y) => ctx.shape.dist(x, y) > 0.2;
            // squared so light areas thin out quickly; paper-white stays empty
            const weight = (x, y) => { const d = Math.max(0, dark(x, y) - 0.03) / 0.97; return d * d; };

            if (p.mode === 'spiral' || p.mode === 'squiggle') {
                // ~10 samples per wave, coarser if the whole drawing would pass 300k points
                const baseLen = (p.mode === 'spiral' && p.extent === 'page' ? Math.PI * (bb.w * bb.w + bb.h * bb.h) / 4 : bb.w * bb.h) / s;
                const step = Math.max(Math.min(0.25, p.wave / 10), baseLen / 3e5);
                // when the point cap coarsens the step, a short wave would alias into a much longer one
                const wave = Math.max(p.wave, 4 * step);
                if (p.mode === 'spiral') {
                    // 'circle': the largest circle inside the clip shape around its centre
                    const inR = ctx.shape.dist(cx, cy) > s ? ctx.shape.dist(cx, cy) : Math.min(bb.w, bb.h) / 2;
                    const R = p.extent === 'page' ? Math.hypot(bb.w, bb.h) / 2 : inR - s / 2;
                    const b = s / TAU;
                    const base = [], nrm = [];
                    for (let th = 0; b * th <= R;) {
                        const r = b * th, c = Math.cos(th), sn = Math.sin(th);
                        base.push([cx + r * c, cy + r * sn]);
                        nrm.push([c, sn]);
                        th += step / Math.hypot(r, b);
                    }
                    return color([squiggleLine(base, nrm, dark, p, s, wave)]);
                }
                const rows = [];
                let k = 0;
                for (let y = bb.minY + s / 2; y < bb.maxY; y += s, k++) {
                    const span = rowSpan(area, y);
                    if (!span || span[1] - span[0] <= s) continue;
                    const [x0, x1] = span;
                    const n = Math.ceil((x1 - x0) / step), base = [], nrm = [];
                    for (let i = 0; i <= n; i++) {
                        base.push([x0 + ((x1 - x0) * i) / n, y]);
                        nrm.push([0, 1]);
                    }
                    if (p.join && k % 2) base.reverse();
                    rows.push(squiggleLine(base, nrm, dark, p, s, wave));
                }
                return color(p.join ? [[].concat(...rows)] : rows);
            }

            if (p.mode === 'waves') return color(waves(p, dark, area, bb));

            if (p.mode === 'hatch') {
                const nL = geo.clamp(Math.round(p.layers), 1, 4);
                const angles = [0, 90, -45, 45].map(a => p.angle + a);
                const layers = Array.from({ length: pens }, () => []);
                const R = Math.hypot(bb.w, bb.h) / 2 + s;
                const du = 0.3, minLen = 1.2, bridge = 0.6;
                for (let li = 0; li < nL; li++) {
                    const thr = (li + 1) / (nL + 1);
                    const a = geo.rad(angles[li]), ca = Math.cos(a), sa = Math.sin(a);
                    const out = layers[li % pens];
                    // offsets start at a per-layer phase so layers don't share lines
                    for (let v = -R + s * (0.5 + ((li * 0.37) % 1)); v <= R; v += s) {
                        const px = cx - sa * v, py = cy + ca * v;
                        const runs = [];
                        let start = null, prevD = -1, prevU = -R;
                        for (let u = -R; u <= R; u += du) {
                            const x = px + ca * u, y = py + sa * u;
                            const inBox = x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY;
                            const dv = inBox ? dark(x, y) - thr : -1;
                            // interpolate the threshold crossings for clean ends
                            if (dv > 0 && start === null) start = prevU + ((u - prevU) * prevD) / (prevD - dv);
                            else if (dv <= 0 && start !== null) {
                                runs.push([start, prevU + ((u - prevU) * prevD) / (prevD - dv)]);
                                start = null;
                            }
                            prevD = dv; prevU = u;
                        }
                        if (start !== null) runs.push([start, prevU]);
                        // bridge tiny gaps, drop crumbs
                        const merged = [];
                        for (const r of runs) {
                            const last = merged[merged.length - 1];
                            if (last && r[0] - last[1] < bridge) last[1] = r[1]; else merged.push(r);
                        }
                        for (const [u0, u1] of merged) {
                            if (u1 - u0 >= minLen) out.push([[px + ca * u0, py + sa * u0], [px + ca * u1, py + sa * u1]]);
                        }
                    }
                }
                return color(layers.flat());
            }

            if (p.mode === 'flow') {
                const key = JSON.stringify([...tone, p.spacing, p.angle, p.follow]);
                return color(cached('flow', img, key, () => flow(p, dark, bb, ctx, rng)));
            }

            if (p.mode === 'contours') return byValue(contours(p, dark, bb), pens);

            if (p.mode === 'halftone') return byValue(halftone(p, dark, bb, ctx, cx, cy), pens);

            if (p.mode === 'hilbert') return color(hilbert(p, dark, bb, ctx, cx, cy));

            if (p.mode === 'string') {
                const key = JSON.stringify([...tone, p.frame, p.pins, p.threads, p.opacity]);
                const { path, tones } = cached('string', img, key, () => stringArt(p, dark, area, bb, ctx, cx, cy));
                if (pens === 1 || path.length < 2) return [path];
                // chords split evenly between pens by how dark a line they cross. Chord
                // means bunch together, so rank them instead of banding the raw value
                const rank = new Float64Array(tones.length);
                tones.map((t, k) => [t, k]).sort((a, b) => a[0] - b[0]).forEach(([, k], i) => { rank[k] = (i + 0.5) / tones.length; });
                return byValue(tones.map((t, k) => [[path[k], path[k + 1]], rank[k]]), pens);
            }

            if (p.mode === 'stipple') {
                const key = JSON.stringify([...tone, p.dots]);
                const pts = cached('stipple', img, key, () => stipple(weight, inside, bb, Math.round(p.dots), rng));
                if (!pts.length) return [];
                const list = Array.from(pts[0], (x, i) => [x, pts[1][i], p.stippleSize / 2, dark(x, pts[1][i])]);
                return byValue(dots(list, p.dot, p.fill), pens);
            }

            if (p.mode === 'scribble') {
                const key = JSON.stringify([...tone, p.loops]);
                const t = cached('scribble', img, key, () => {
                    const pts = stipple(weight, inside, bb, Math.round(p.loops), rng);
                    return pts.length ? { X: pts[0], Y: pts[1], order: tour(pts[0], pts[1], 300) } : null;
                });
                return t ? color([scribble(t.order, t.X, t.Y, p.loopSize)]) : [];
            }

            // ---- TSP
            const key = JSON.stringify([...tone, p.points, p.budget]);
            const path = cached('tsp', img, key, () => {
                const pts = stipple(weight, inside, bb, Math.round(p.points), rng);
                if (!pts.length || pts[0].length < 2) return null;
                const [X, Y] = pts;
                return tour(X, Y, p.budget).map(i => [X[i], Y[i]]);
            });
            return path ? color([path]) : [];
        },
    });
})();
