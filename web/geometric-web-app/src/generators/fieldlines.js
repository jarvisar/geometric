/*
 * Field lines of point charges or of currents, as in a physics textbook, but
 * computed properly. Everything is two-dimensional: the "charges" are long
 * wires of charge (or current) crossing the page, so fields fall off as 1/r
 * and field lines are conserved in the plane.
 *
 * Electric: E = Σ qᵢ (r − rᵢ)/|r − rᵢ|². Lines leave every positive charge
 * at equal angles, as many as the charge is large (so the number of lines
 * through any curve measures the flux), and are integrated with RK4 along
 * E/|E| until they reach a negative charge or run far off the page. Lines
 * are started from a tiny radius, where the field really is radial, so
 * their spacing is right. Negative charges are traced backwards the same
 * way, keeping only lines that come in from far away — the rest were
 * already drawn from their positive end. Equipotentials are contours of
 * V = −Σ qᵢ ln|r − rᵢ| at equal steps of V, so they crowd where the field
 * is strong.
 *
 * Magnetic: wires carrying currents Iᵢ out of (⊙) or into (⊗) the page.
 * Their field lines are exactly the level curves of Σ Iᵢ ln|r − rᵢ|, so
 * contours at equal steps are field lines whose density follows |B|.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    PG.register({
        id: 'fieldlines',
        name: 'Field Lines',
        category: 'Fields',
        description: 'Electric field lines and equipotentials of charges, or the magnetic field around wires.',
        fit: false,
        params: [
            { type: 'section', label: 'Sources' },
            { id: 'kind', label: 'Field', type: 'select', value: 'electric', random: ['electric', 'electric', 'magnetic'],
                options: [['electric', 'Electric (charges)'], ['magnetic', 'Magnetic (wires)']] },
            { id: 'layout', label: 'Arrangement', type: 'select', value: 'random',
                random: ['random', 'random', 'random', 'dipole', 'quadrupole', 'ring', 'plates', 'like'],
                options: [['random', 'Random'], ['dipole', 'Dipole'], ['quadrupole', 'Quadrupole'], ['ring', 'Ring'],
                    ['plates', 'Parallel plates'], ['like', 'Two like charges']] },
            { id: 'count', label: 'Sources', type: 'range', min: 2, max: 12, step: 1, value: 5, random: [3, 7],
                show: p => p.layout === 'random' || p.layout === 'ring' },
            { id: 'spread', label: 'Spread', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.6, random: [0.4, 0.8],
                hint: 'How much of the page the sources occupy' },
            { id: 'balance', label: 'Positive share', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, random: [0.3, 0.7],
                show: p => p.layout === 'random', hint: 'Chance that a random source is positive' },
            { type: 'section', label: 'Lines' },
            { id: 'density', label: 'Lines per unit', type: 'range', min: 2, max: 60, step: 1, value: 18, random: [10, 28],
                hint: 'Field lines per unit of charge, or contour count for wires' },
            { id: 'equip', label: 'Equipotentials (pen 2)', type: 'checkbox', value: true, random: 0.6,
                show: p => p.kind === 'electric' },
            { id: 'equipCount', label: 'Equipotentials', type: 'range', min: 4, max: 80, step: 1, value: 24, random: [12, 40],
                show: p => p.kind === 'electric' && p.equip },
            { id: 'marker', label: 'Marker radius (mm)', type: 'range', min: 0, max: 8, step: 0.1, value: 2.4, random: [1.5, 3.5],
                hint: '0 hides the charge / wire symbols' },
            { id: 'step', label: 'Step (mm)', type: 'range', min: 0.1, max: 2, step: 0.05, value: 0.5, random: false,
                hint: 'Integration step for the field lines' },
        ],

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const bb = geo.bbox([ctx.shape.polygon()]);
            const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            const S = (Math.min(bb.w, bb.h) / 2) * p.spread;

            // ---- sources { x, y, q }
            const src = [];
            const at = (u, v, q) => src.push({ x: cx + u * S, y: cy + v * S, q });
            if (p.layout === 'dipole') { at(-0.6, 0, 1); at(0.6, 0, -1); }
            else if (p.layout === 'like') { at(-0.6, 0, 1); at(0.6, 0, 1); }
            else if (p.layout === 'quadrupole') { at(-0.6, -0.6, 1); at(0.6, -0.6, -1); at(0.6, 0.6, 1); at(-0.6, 0.6, -1); }
            else if (p.layout === 'ring') {
                const n = Math.max(2, Math.round(p.count));
                for (let i = 0; i < n; i++) { const a = (TAU * i) / n - Math.PI / 2; at(0.8 * Math.cos(a), 0.8 * Math.sin(a), i % 2 || n % 2 ? 1 : -1); }
                if (n % 2) at(0, 0, -n); // odd rings: one balancing charge in the middle
            } else if (p.layout === 'plates') {
                const n = 9;
                for (let i = 0; i < n; i++) { const u = -0.8 + (1.6 * i) / (n - 1); at(u, -0.35, 0.5); at(u, 0.35, -0.5); }
            } else {
                const n = Math.max(2, Math.round(p.count)), minD = (1.6 * S) / Math.sqrt(n);
                for (let t = 0; t < 400 * n && src.length < n; t++) {
                    const u = rng.range(-1, 1), v = rng.range(-1, 1) * (bb.h / bb.w > 1 ? Math.min(1.4, bb.h / bb.w) : 1);
                    if (src.some(s => Math.hypot(s.x - (cx + u * S), s.y - (cy + v * S)) < minD)) continue;
                    at(u, v, (rng.chance(p.balance) ? 1 : -1) * rng.pick([1, 1, 2, 3]));
                }
                // always something to flow between
                if (src.every(s => s.q > 0)) src[src.length - 1].q *= -1;
                else if (src.every(s => s.q < 0)) src[0].q *= -1;
            }

            const mk = Math.max(0, p.marker);
            const layers = [[], [], []];

            // ψ = Σ q ln r: minus the electric potential, or the magnetic flux function
            const psi = (x, y) => {
                let v = 0;
                for (const s of src) v += s.q * Math.log(Math.max(1e-9, Math.hypot(x - s.x, y - s.y)));
                return v;
            };
            // contours of ψ at equal steps, cut away inside the markers
            const contours = (count, out) => {
                const pad = 2, cell = 0.5;
                const f = PG.sampleField(psi, bb.minX - pad, bb.minY - pad, bb.w + 2 * pad, bb.h + 2 * pad, cell);
                // levels spanning the page, not the singular values right at the sources
                const vals = Float64Array.from(f.values).sort();
                const lo = vals[Math.floor(vals.length * 0.01)], hi = vals[Math.floor(vals.length * 0.99)];
                const cut = mk + 0.6;
                for (const level of PG.contourLevels(f, Math.max(1, Math.round(count)), lo, hi)) {
                    for (const line of PG.isolines(f, level)) {
                        let cur = null;
                        for (const q of line) {
                            if (src.some(s => Math.hypot(q[0] - s.x, q[1] - s.y) < cut)) { cur = null; continue; }
                            if (!cur) { cur = []; out.push(cur); }
                            cur.push(q);
                        }
                    }
                }
            };

            if (p.kind === 'magnetic') {
                contours(p.density * 1.5, layers[0]);
            } else {
                // ---- field line tracing
                const field = (x, y) => {
                    let ex = 0, ey = 0;
                    for (const s of src) {
                        const dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy || 1e-18;
                        ex += (s.q * dx) / d2; ey += (s.q * dy) / d2;
                    }
                    return [ex, ey];
                };
                const dir = (x, y, sg) => {
                    const [ex, ey] = field(x, y), L = Math.hypot(ex, ey);
                    return L > 1e-12 ? [(sg * ex) / L, (sg * ey) / L] : null;
                };
                const reach = 0.6 * Math.max(bb.w, bb.h);
                const box = [bb.minX - reach, bb.minY - reach, bb.maxX + reach, bb.maxY + reach];
                const maxLen = 6 * (bb.w + bb.h);
                const r0 = 0.05, hMax = Math.max(0.05, p.step);
                // returns { path, end: source index | -1 }
                const trace = (from, a, sg) => {
                    let x = from.x + r0 * Math.cos(a), y = from.y + r0 * Math.sin(a);
                    const pts = [[x, y]];
                    let len = 0;
                    while (len < maxLen) {
                        let dmin = Infinity, near = -1;
                        for (let i = 0; i < src.length; i++) {
                            const s = src[i];
                            if (s === from && len < 1) continue;
                            const d = Math.hypot(x - s.x, y - s.y);
                            if (d < dmin) { dmin = d; near = i; }
                        }
                        // arrived at a sink (a charge the line flows into)
                        if (near >= 0 && dmin < Math.max(r0, 0.02) * 4 && src[near].q * sg < 0) return { path: pts, end: near };
                        const off = x < bb.minX || y < bb.minY || x > bb.maxX || y > bb.maxY;
                        const h = geo.clamp(0.25 * dmin, 0.01, off ? 4 * hMax : hMax);
                        const k1 = dir(x, y, sg); if (!k1) break;
                        const k2 = dir(x + (h / 2) * k1[0], y + (h / 2) * k1[1], sg); if (!k2) break;
                        const k3 = dir(x + (h / 2) * k2[0], y + (h / 2) * k2[1], sg); if (!k3) break;
                        const k4 = dir(x + h * k3[0], y + h * k3[1], sg); if (!k4) break;
                        x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
                        y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
                        pts.push([x, y]);
                        len += h;
                        if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) break;
                    }
                    return { path: pts, end: -1 };
                };
                // cut out the parts inside markers, and thin the tiny steps taken near charges
                const tidy = path => {
                    const out = [];
                    let cur = null;
                    for (const q of path) {
                        if (mk > 0 && src.some(s => Math.hypot(q[0] - s.x, q[1] - s.y) < mk)) { cur = null; continue; }
                        if (!cur) { cur = []; out.push(cur); }
                        const last = cur[cur.length - 1];
                        if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.05) cur.push(q);
                    }
                    return out.filter(c => c.length > 1);
                };
                const phase = rng.range(0, 1);
                for (const s of src) {
                    const n = Math.max(1, Math.round(p.density * Math.abs(s.q)));
                    const sg = s.q > 0 ? 1 : -1;
                    for (let i = 0; i < n; i++) {
                        const { path, end } = trace(s, (TAU * (i + phase)) / n, sg);
                        if (sg < 0 && end >= 0) continue; // drawn from its positive end already
                        for (const t of tidy(path)) layers[0].push(t);
                    }
                }
                if (p.equip) contours(p.equipCount, layers[1]);
            }

            // ---- markers: ⊕ / ⊖ for charges, ⊙ / ⊗ for currents
            if (mk > 0) {
                for (const s of src) {
                    const r = mk, g = r * 0.5, out = layers[0];
                    out.push(geo.circle(s.x, s.y, r));
                    if (p.kind === 'magnetic') {
                        if (s.q > 0) out.push(geo.circle(s.x, s.y, r * 0.18));
                        else { const d = g * Math.SQRT1_2; out.push([[s.x - d, s.y - d], [s.x + d, s.y + d]], [[s.x - d, s.y + d], [s.x + d, s.y - d]]); }
                    } else {
                        out.push([[s.x - g, s.y], [s.x + g, s.y]]);
                        if (s.q > 0) out.push([[s.x, s.y - g], [s.x, s.y + g]]);
                    }
                }
            }
            return { layers };
        },
    });
})();
