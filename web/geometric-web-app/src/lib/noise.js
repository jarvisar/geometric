/*
 * Seeded simplex noise (2D + 3D), after Stefan Gustavson's reference
 * implementation, plus fractal (fBm) and curl helpers.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    const F3 = 1 / 3, G3 = 1 / 6;
    const GRAD3 = new Float32Array([
        1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
        1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
        0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
    ]);

    PG.makeNoise = function (rng) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng.random() * (i + 1));
            const t = p[i]; p[i] = p[j]; p[j] = t;
        }
        const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
        for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }

        function noise2(xin, yin) {
            let n0 = 0, n1 = 0, n2 = 0;
            const s = (xin + yin) * F2;
            const i = Math.floor(xin + s), j = Math.floor(yin + s);
            const t = (i + j) * G2;
            const x0 = xin - (i - t), y0 = yin - (j - t);
            const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
            const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
            const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
            const ii = i & 255, jj = j & 255;
            let t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0) { const g = pm12[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0); }
            let t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0) { const g = pm12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1); }
            let t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0) { const g = pm12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2); }
            return 70 * (n0 + n1 + n2);
        }

        function noise3(xin, yin, zin) {
            let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
            const s = (xin + yin + zin) * F3;
            const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
            const t = (i + j + k) * G3;
            const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
            let i1, j1, k1, i2, j2, k2;
            if (x0 >= y0) {
                if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
                else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
                else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
            } else {
                if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
                else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
                else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
            }
            const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
            const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
            const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
            const ii = i & 255, jj = j & 255, kk = k & 255;
            let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
            if (t0 >= 0) { const g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
            let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
            if (t1 >= 0) { const g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
            let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
            if (t2 >= 0) { const g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
            let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
            if (t3 >= 0) { const g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
            return 32 * (n0 + n1 + n2 + n3);
        }

        // Fractal Brownian motion, normalised to roughly [-1, 1].
        function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
            let sum = 0, amp = 1, norm = 0, f = 1;
            for (let o = 0; o < octaves; o++) {
                sum += amp * noise2(x * f + o * 17.31, y * f - o * 9.73);
                norm += amp; amp *= gain; f *= lacunarity;
            }
            return sum / norm;
        }

        function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
            let sum = 0, amp = 1, norm = 0, f = 1;
            for (let o = 0; o < octaves; o++) {
                sum += amp * noise3(x * f + o * 17.31, y * f - o * 9.73, z * f + o * 3.1);
                norm += amp; amp *= gain; f *= lacunarity;
            }
            return sum / norm;
        }

        // Divergence-free 2D vector field from the gradient of a scalar potential.
        function curl2(x, y, octaves = 1, eps = 0.001) {
            const n = octaves > 1 ? (a, b) => fbm2(a, b, octaves) : noise2;
            const dx = (n(x + eps, y) - n(x - eps, y)) / (2 * eps);
            const dy = (n(x, y + eps) - n(x, y - eps)) / (2 * eps);
            return [dy, -dx];
        }

        return { noise2, noise3, fbm2, fbm3, curl2 };
    };
})();
