/* A comic page of alien worlds. Each panel is a little scene drawn as stacked
   cut-outs (iso.Scene with a flat camera and z as layer order), so hatching
   stops at silhouettes. Panels in one row can share a single wide landscape. */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const PI = Math.PI, clamp = geo.clamp, lerp = geo.lerp;
    const INK = 0, WARM = 1, COOL = 2, GOLD = 3, VIOLET = 4, GREEN = 5, CYAN = 6, BROWN = 7;
    // Roles past the pen count fold back onto earlier accents, so the pen count never changes the geometry.
    const FOLD = [0, 0, 1, 1, 2, 2, 2, 3];
    const penOf = (role, pens) => { if (pens < 2) return 0; while (role >= pens) role = FOLD[role]; return role; };
    const rngOf = (...n) => new PG.RNG(PG.iso.hash(...n));
    const shift = (poly, dx, dy) => poly.map(([x, y]) => [x + dx, y + dy]);
    const bounds = (paths, pad = 0) => { const b = geo.bbox(paths); return [b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad]; };

    // Scanline intervals inside the union of some polygons (each one even-odd)
    function spans(polys, y) {
        const iv = [];
        for (const P of polys) {
            const xs = [];
            for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) {
                const a = P[j], b = P[i];
                if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
            }
            xs.sort((u, v) => u - v);
            for (let i = 0; i + 1 < xs.length; i += 2) iv.push([xs[i], xs[i + 1]]);
        }
        if (polys.length < 2) return iv;
        iv.sort((u, v) => u[0] - v[0]);
        const out = [];
        for (const r of iv) {
            const last = out[out.length - 1];
            if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r);
        }
        return out;
    }
    function subtract(a, b) {
        const out = [];
        for (let [x0, x1] of a) {
            for (const [u0, u1] of b) {
                if (u1 <= x0 || u0 >= x1) continue;
                if (u0 > x0) out.push([x0, u0]);
                x0 = Math.max(x0, u1);
                if (x0 >= x1) break;
            }
            if (x0 < x1) out.push([x0, x1]);
        }
        return out;
    }
    // Parallel lines over the union of `inc` minus the union of `exc`. Rows sit on a
    // page-wide grid, so fills with the same spacing and angle line up across panels.
    function fill(inc, gap, angle = 0, exc = null) {
        inc = inc.filter(P => P.length > 2);
        if (!inc.length || !(gap > 0)) return [];
        // pens are 0.3 to 0.5 mm, anything closer just piles up ink
        gap = Math.max(gap, 0.35);
        const c = Math.cos(angle), s = Math.sin(angle), rot = P => P.map(([x, y]) => [x * c + y * s, y * c - x * s]);
        const A = inc.map(rot), B = exc ? exc.filter(P => P.length > 2).map(rot) : [];
        let y0 = Infinity, y1 = -Infinity;
        for (const P of A) for (const q of P) { if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
        const out = [];
        for (let k = Math.ceil(y0 / gap - 0.5); (k + 0.5) * gap < y1; k++) {
            const y = (k + 0.5) * gap;
            let iv = spans(A, y);
            if (B.length && iv.length) iv = subtract(iv, spans(B, y));
            for (const [a, b] of iv) if (b - a > 0.25) out.push([[a * c - y * s, a * s + y * c], [b * c - y * s, b * s + y * c]]);
        }
        return out;
    }
    // Long segments test far fewer faces once they're cut into short pieces
    function chop(path, step = 8) {
        const out = [path[0]];
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
            for (let j = 1; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
            out.push(b);
        }
        return out;
    }
    function heightAt(pts, x) {
        let lo = 0, hi = pts.length - 1;
        if (x <= pts[0][0]) return pts[0][1];
        if (x >= pts[hi][0]) return pts[hi][1];
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= x) lo = mid; else hi = mid; }
        const a = pts[lo], b = pts[hi];
        return b[0] > a[0] ? lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0])) : a[1];
    }
    function dashes(rng, xa, xb, y, density, len, out = []) {
        for (let x = xa - rng.range(0, len); x < xb;) {
            const l = len * rng.range(0.5, 1.5), a = Math.max(xa, x), b = Math.min(xb, x + l);
            if (rng.chance(density) && b - a > 0.5) out.push([[a, y], [b, y]]);
            x += l + len * rng.range(0.25, 0.9);
        }
        return out;
    }

    // One panel's scene in page coordinates. The camera moves the panel corner to the origin.
    function canvas(X, Y, W, H) {
        const S = new PG.iso.Scene({ project: (x, y, z) => [x - X, y - Y, -z] }, W, H);
        const win = PG.shapes.rect(X - 0.5, Y - 0.5, X + W + 0.5, Y + H + 0.5);
        const put = (pts, z) => S.line(chop(pts).map(([x, y]) => [x, y, z]));
        const D = {
            S, X, Y, W, H,
            sees: b => !b || (b[2] >= X - 1 && b[0] <= X + W + 1 && b[3] >= Y - 1 && b[1] <= Y + H + 1),
            line(pts, z, role = INK, raw = false) {
                S.kind = role;
                if (raw) return put(pts, z);
                if (pts.length === 2) {
                    const [a, b] = pts, t = win.clipSeg(a[0], a[1], b[0], b[1]);
                    if (t && t[1] - t[0] > 1e-9) put([geo.lerpPt(a, b, t[0]), geo.lerpPt(a, b, t[1])], z);
                    return;
                }
                for (const q of PG.clipPaths([pts], win)) put(q, z);
            },
            // Small marks are dropped rather than cut when anything covers them
            mark(pts, z, role = INK) { S.kind = role; S.line(pts.map(([x, y]) => [x, y, z]), true); },
            face(pts, z) { S.face(pts.map(([x, y]) => [x, y, z]), false); },
            // Masks for an x-monotone shape: columns between the top profile and the bottom one (or the panel bottom)
            columns(top, bot, z, cull = true) {
                const yb = Y + H + 2;
                for (let i = 1; i < top.length; i++) {
                    const a = top[i - 1], b = top[i];
                    if (cull && (b[0] < X - 1 || a[0] > X + W + 1)) continue;
                    if (bot) D.face([a, b, bot[i], bot[i - 1]], z);
                    else D.face([[a[0], Math.min(a[1], yb)], [b[0], Math.min(b[1], yb)], [b[0], yb], [a[0], yb]], z);
                }
            },
        };
        return D;
    }
    // A shape is plain data: masks (convex), lines with a role and depth offset, and fills.
    function draw(D, s) {
        if (!D.sees(s.box)) return;
        const S = D.S, raw = s.part === 'cloud';
        S.part = s.part;
        if (s.top) D.columns(s.top, s.bot, s.z, !raw);
        if (s.masks) for (const m of s.masks) D.face(m, s.z);
        if (s.lines) for (const [pts, role, dz = 0.01] of s.lines) D.line(pts, s.z + dz, role, raw);
        if (s.fills) for (const [segs, role] of s.fills) for (const q of segs) D.line(q, s.z + 0.005, role);
        if (s.marks) for (const [pts, role] of s.marks) D.mark(pts, s.z + 0.01, role);
        S.part = undefined;
    }

    // ------------------------------------------------------------------
    // Page layout
    // ------------------------------------------------------------------
    const SPLITS = [[3, 0.5], [2, 1 / 3], [2, 2 / 3], [1.2, 0.4], [1.2, 0.6], [0.7, 0.25], [0.7, 0.75]];
    function layout(p, W, H, rng) {
        if (p.layout === 'single') return { rects: [[0, 0, W, H]], gap: 0 };
        if (p.layout === 'grid') {
            const gap = Math.min(p.gutter, W / p.cols * 0.25, H / p.rows * 0.25), rects = [];
            const cw = (W - (p.cols - 1) * gap) / p.cols, ch = (H - (p.rows - 1) * gap) / p.rows;
            for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) rects.push([c * (cw + gap), r * (ch + gap), cw, ch]);
            return { rects, gap };
        }
        // Recursive guillotine cuts. Wide pieces get cut into columns, tall ones into tiers,
        // and one or two mid-sized pieces are kept whole as feature panels.
        const target = W * H / p.panels, unit = Math.sqrt(target), gap = Math.min(p.gutter, unit * 0.2);
        const min = Math.max(5, unit * 0.42), rects = [];
        let heroes = p.panels >= 6 ? 1 + (p.panels >= 18) : 0;
        const split = (x, y, w, h, depth) => {
            const area = w * h;
            if (heroes && depth && area > target * 2.2 && area < target * 5 && w < h * 2.2 && h < w * 1.6 && rng.chance(0.6)) { heroes--; rects.push([x, y, w, h]); return; }
            if (rects.length > 150 || area < target * rng.range(0.7, 1.4)) { rects.push([x, y, w, h]); return; }
            const first = w > h * 1.3 ? rng.chance(0.85) : h > w * 1.3 ? rng.chance(0.12) : rng.chance(0.5);
            for (const vertical of [first, !first]) {
                const len = (vertical ? w : h) - gap, cross = vertical ? h : w;
                const ok = SPLITS.filter(([, t]) => Math.min(t, 1 - t) * len >= min && cross / (Math.min(t, 1 - t) * len) < (vertical ? 3.2 : 4.5));
                if (!ok.length) continue;
                const a = len * rng.weighted(ok);
                if (vertical) { split(x, y, a, h, depth + 1); split(x + a + gap, y, len - a, h, depth + 1); }
                else { split(x, y, w, a, depth + 1); split(x, y + a + gap, w, len - a, depth + 1); }
                return;
            }
            rects.push([x, y, w, h]);
        };
        split(0, 0, W, H, 0);
        return { rects, gap };
    }

    // ------------------------------------------------------------------
    // Terrain
    // ------------------------------------------------------------------
    // Jagged ridge: alternating peaks and saddles, filled in by midpoint displacement.
    function jagged(rng, xa, xb, base, amp, spread, step, rough = 0.3) {
        const n = Math.max(1, Math.round((xb - xa) / spread)), anchors = [];
        for (let i = 0; i <= 2 * n; i++) {
            const jitter = i && i < 2 * n ? rng.range(-0.3, 0.3) : 0;
            anchors.push([xa + (xb - xa) * (i + jitter) / (2 * n), base - amp * (i % 2 ? rng.range(0.4, 1) : rng.range(0, 0.45))]);
        }
        const pts = [anchors[0]], idx = [0];
        const sub = (a, b, depth) => {
            const dx = b[0] - a[0];
            if (dx <= step || depth > 9) { pts.push(b); return; }
            const t = rng.range(0.35, 0.65);
            const m = [a[0] + dx * t, clamp(lerp(a[1], b[1], t) + rng.range(-rough, rough) * dx, base - amp * 1.08, base)];
            sub(a, m, depth + 1); sub(m, b, depth + 1);
        };
        for (let i = 1; i < anchors.length; i++) { sub(anchors[i - 1], anchors[i], 0); idx.push(pts.length - 1); }
        return { pts, idx };
    }
    // Creases run down from peaks (slanting toward the shadow side) and saddles and split the
    // range into facets. Every crease has 5 points: top, two bends, base, foot.
    function facets(E, rng, s, r, base, foot, angle, tint, snow) {
        const { pts, idx } = r, g = E.gap, L = E.light, last = pts.length - 1, x0 = pts[0][0], x1 = pts[last][0];
        // shading stops at the foot of the range, whatever stands in front of it
        snow = (snow || []).concat([[[x0 - 1, base], [x1 + 1, base], [x1 + 1, foot + 10], [x0 - 1, foot + 10]]]);
        const edge = i => { const [x, y] = pts[i]; return { i, path: [[x, y], [x, lerp(y, base, 0.35)], [x, lerp(y, base, 0.7)], [x, base], [x, foot]] }; };
        const cr = [edge(0)];
        for (let k = 1; k < idx.length - 1; k++) {
            const i = idx[k], [x, y] = pts[i], prev = x - pts[idx[k - 1]][0], next = pts[idx[k + 1]][0] - x, near = Math.min(prev, next), peak = k % 2 === 1;
            const d = peak ? (L > 0 ? next : -prev) * rng.range(0.3, 0.7) : rng.range(-0.15, 0.15) * near, drop = Math.max(0, base - y), wob = near * 0.06;
            cr.push({ i, peak, path: [[x, y], [x + d * 0.35 + rng.range(-wob, wob), y + drop * 0.35], [x + d * 0.7 + rng.range(-wob, wob), y + drop * 0.7], [x + d, base], [x + d, foot]] });
        }
        cr.push(edge(last));
        // extra creases from the middle of long faces
        for (let k = cr.length - 1; k > 0; k--) {
            const a = cr[k - 1], b = cr[k];
            if (b.i - a.i < 5 || !rng.chance(0.6)) continue;
            const j = a.i + Math.round((b.i - a.i) * rng.range(0.3, 0.7)), [x, y] = pts[j];
            const u = (x - pts[a.i][0]) / (pts[b.i][0] - pts[a.i][0]), drop = Math.max(0, base - y), path = [[x, y]];
            for (let q = 1; q < 5; q++) {
                const f = [0, 0.35, 0.7, 1, 1][q];
                path.push([lerp(x, lerp(a.path[q][0], b.path[q][0], u), Math.min(1, f * 1.2)), q < 4 ? y + drop * f : foot]);
            }
            cr.splice(k, 0, { i: j, path });
        }
        let dark = 0;
        for (let k = 1; k < cr.length; k++) {
            const a = cr[k - 1], b = cr[k];
            const poly = pts.slice(a.i, b.i + 1).concat(b.path.slice(1), a.path.slice(1).reverse());
            if ((pts[b.i][1] - pts[a.i][1]) * L > 0) s.fills.push([fill([poly], g * (dark % 2 ? 0.8 : 1.05), angle + (dark++ % 2) * 0.25, snow), INK]);
            else if (tint !== null && rng.chance(0.4)) s.fills.push([fill([poly], g * 1.4, angle - 0.9 * L, snow), tint]);
            if ((pts[b.i][1] - pts[a.i][1]) * L <= 0 && b.i - a.i >= 4 && rng.chance(0.3 + 0.6 * E.p.detail)) {
                // a jagged patch of shade hanging under the ridge
                const j0 = a.i + 1 + rng.int(0, Math.max(0, b.i - a.i - 4)), j1 = Math.min(b.i - 1, j0 + rng.int(2, 5));
                const top = pts.slice(j0, j1 + 1), depth = (base - pts[j0][1]) * rng.range(0.12, 0.35) + 0.5;
                const under = top.map(([x, y]) => [x + rng.range(-0.2, 0.2) * depth, y + depth * rng.range(0.4, 1.1)]).reverse();
                s.fills.push([fill([top.concat(under)], g * 0.85, angle, snow), INK]);
            }
        }
        for (const c of cr.slice(1, -1)) s.lines.push([c.path.slice(0, c.peak ? 4 : c.peak === false ? 2 : rng.int(2, 3)), INK]);
    }
    // Snow caps: nothing above this line gets hatched
    function snowcap(rng, xa, xb, y, amp) {
        const line = [];
        for (let x = xb; x >= xa - 1; x -= Math.max(0.8, amp / 14)) line.push([x, y + rng.range(-0.12, 0.12) * amp + (line.length % 2 ? amp * 0.08 : 0)]);
        return [[[xa - 1, y - amp * 3], [xb, y - amp * 3]].concat(line)];
    }
    // Gentle swell plus a few rounded knolls
    function rolling(rng, xa, xb, base, amp, step) {
        const f1 = TAU / (amp * rng.range(6, 12) + 8), p1 = rng.range(0, TAU), knolls = [];
        for (let x = xa - amp * rng.range(0, 3); x < xb + amp * 2; x += amp * rng.range(2, 5)) knolls.push([x, amp * rng.range(1.2, 3.2), rng.range(0.35, 1)]);
        const n = Math.min(900, Math.ceil((xb - xa) / step)), pts = [];
        for (let i = 0; i <= n; i++) {
            const x = xa + (xb - xa) * i / n;
            let k = 0;
            for (const [c, wd, ht] of knolls) k = Math.max(k, ht * Math.exp(-(((x - c) / wd) ** 2)));
            pts.push([x, base - amp * Math.min(1.1, 0.3 * (0.5 + 0.5 * Math.sin(f1 * x + p1)) + 0.8 * k)]);
        }
        return pts;
    }
    // Lens-shaped patches hanging from the crest on each slope that faces away from the light
    function patches(rng, pts, L, chance, deep = 1) {
        const out = [];
        for (let i = 1; i < pts.length;) {
            if ((pts[i][1] - pts[i - 1][1]) * L <= 0) { i++; continue; }
            const s0 = i - 1;
            while (i < pts.length && (pts[i][1] - pts[i - 1][1]) * L > 0) i++;
            const run = pts.slice(s0, i);
            if (run.length < 4 || !rng.chance(chance)) continue;
            const top = run.slice(Math.floor(run.length * rng.range(0, 0.2)), Math.ceil(run.length * rng.range(0.8, 1)));
            if (top.length < 3) continue;
            const depth = (Math.abs(run[run.length - 1][1] - run[0][1]) * rng.range(0.8, 1.5) + 1) * deep;
            out.push(top.concat(top.map(([x, y], k) => [x, y + depth * Math.pow(Math.sin(PI * k / (top.length - 1)), 0.6)]).reverse()));
        }
        return out;
    }
    // Receding ground lines: denser near the horizon, dashes getting longer toward the viewer
    function plainLines(rng, xa, xb, top, bottom, g, density) {
        const out = [], n = clamp(Math.round((bottom - top) / (g * 3.4)), 2, 60);
        for (let k = 1; k <= n; k++) dashes(rng, xa, xb, top + (bottom - top) * Math.pow(k / (n + 0.6), 1.7), density, 2.5 + 12 * k / n, out);
        return out;
    }
    function tableland(rng, xa, xb, base, amp) {
        const pts = [[xa, base - amp * rng.range(0, 0.3)]];
        for (let x = xa; x < xb;) {
            const run = amp * rng.range(1.5, 6), y = base - amp * (rng.chance(0.35) ? rng.range(0, 0.15) : rng.range(0.4, 1)), side = amp * rng.range(0.15, 0.5);
            pts.push([x + side, y], [x + side + run, y + rng.range(-0.04, 0.04) * amp]);
            x += side + run;
        }
        return pts.filter((q, i) => i === 0 || q[0] > pts[i - 1][0]);
    }
    function mesa(E, rng, xc, base, width, height, z) {
        const top = base - height, hw = width / 2, cliff = width * rng.range(0.05, 0.1), talus = height * rng.range(0.25, 0.4), L = E.light;
        const pts = [[xc - hw - talus * 0.9, base], [xc - hw, base - talus], [xc - hw + cliff, top]];
        for (let k = 1, n = rng.int(1, 3); k < n; k++) pts.push([xc - hw + cliff + (width - 2 * cliff) * k / n, top + rng.range(-0.04, 0.04) * height]);
        pts.push([xc + hw - cliff, top], [xc + hw, base - talus], [xc + hw + talus * 0.9, base]);
        const poly = pts.concat([[xc + hw + talus, base + 0.5], [xc - hw - talus, base + 0.5]]);
        return {
            z, top: pts, bot: pts.map(([x]) => [x, base + 0.3]), lines: [[pts, INK]], box: bounds([poly]),
            fills: [[fill([poly], height / rng.int(3, 6), rng.range(-0.05, 0.05)), BROWN],
                [fill([poly], E.gap * 0.8, L * 0.9, [shift(poly, -L * (cliff + width * 0.12), 0)]), INK]],
        };
    }
    function dunes(rng, xa, xb, base, amp, step) {
        const pts = [], lam = amp * rng.range(3.5, 6);
        const phase = rng.range(0, 1);
        for (let x = xa; x <= xb + step; x += step) {
            const u = ((x / lam + phase) % 1 + 1) % 1, crest = 0.72;
            const f = u < crest ? Math.sin(PI / 2 * u / crest) : Math.cos(PI / 2 * (u - crest) / (1 - crest)) ** 1.5;
            pts.push([x, base - amp * (0.3 + 0.7 * f * (0.75 + 0.25 * Math.sin(x / lam * 1.7)))]);
        }
        return pts;
    }

    // ------------------------------------------------------------------
    // Props
    // ------------------------------------------------------------------
    function lollipop(E, rng, x, y, size, z, role) {
        const r = size * rng.range(0.26, 0.36), cy = y - size + r, pts = [];
        for (let j = 0, n = rng.int(7, 11); j < n; j++) { const a = TAU * j / n + rng.range(-0.2, 0.2); pts.push([x + r * Math.cos(a) * rng.range(0.9, 1.05), cy + r * Math.sin(a) * rng.range(0.9, 1.05)]); }
        const crown = PG.iso.hull(pts), s = { z, masks: [crown], lines: [[geo.close(crown), INK], [[[x, y], [x, cy]], INK, -0.01]], fills: [], box: [x - r, cy - r, x + r, y] };
        if (r > E.gap * 2) s.fills.push([fill([crown], E.gap * 0.8, rng.pick([0.8, -0.8, PI / 2]), [shift(crown, -E.light * r * 0.45, -r * 0.45)]), role]);
        return s;
    }
    function pine(E, rng, x, y, size, z, role) {
        const out = [], tiers = rng.int(2, 3), w = size * rng.range(0.26, 0.34);
        out.push({ z, lines: [[[[x, y], [x, y - size * 0.3]], INK]] });
        for (let k = 0; k < tiers; k++) {
            const yb = y - size * (0.14 + 0.62 * k / tiers), yt = yb - size * (0.5 - 0.06 * k), hw = w * (1 - 0.22 * k);
            const tri = [[x - hw, yb], [x + hw, yb], [x, yt]], half = E.light > 0 ? [[x, yb], [x + hw, yb], [x, yt]] : [[x - hw, yb], [x, yb], [x, yt]];
            out.push({ z: z + 0.02 * (k + 1), masks: [tri], lines: [[geo.close(tri), INK]], fills: [[fill([half], E.gap * 0.85, PI / 2), role]] });
        }
        return out;
    }
    function capsule(cx, yb, yt, r, round, n = 5) {
        const pts = [];
        for (let j = 0; j <= n; j++) { const a = PI + PI * j / n; pts.push([cx + r * Math.cos(a), yt + r * Math.sin(a)]); }
        if (round) for (let j = 0; j <= n; j++) { const a = PI * j / n; pts.push([cx + r * Math.cos(a), yb + r * Math.sin(a)]); }
        else pts.push([cx + r, yb], [cx - r, yb]);
        return pts;
    }
    // Saguaro from overlapping pieces. Their outlines sit just behind the masks, so only the union's edge shows.
    function cactus(E, rng, x, y, size, z, role) {
        const rw = size * rng.range(0.085, 0.11), pieces = [capsule(x, y, y - size + rw, rw, false)];
        for (const side of rng.shuffle([-1, 1]).slice(0, rng.int(size > 8 ? 1 : 0, 2))) {
            const ya = y - size * rng.range(0.3, 0.55), ax = x + side * size * rng.range(0.22, 0.3), ar = rw * 0.85;
            pieces.push([[x, ya - ar], [ax, ya - ar], [ax, ya + ar], [x, ya + ar]], capsule(ax, ya, ya - size * rng.range(0.18, 0.32), ar, true));
        }
        return { z, masks: pieces, lines: pieces.map(P => [geo.close(P), INK, -0.01]), fills: [[fill(pieces, E.gap * 1.1, PI / 2), role]], box: [x - size * 0.4, y - size, x + size * 0.4, y] };
    }
    function boulder(E, rng, x, y, size, z, role) {
        const pts = [];
        for (let j = 0; j < 8; j++) { const a = TAU * j / 8 + rng.range(-0.3, 0.3); pts.push([x + Math.cos(a) * size * rng.range(0.7, 1), Math.min(y, y - size * 0.45 + Math.sin(a) * size * 0.55 * rng.range(0.7, 1))]); }
        const hull = PG.iso.hull(pts);
        return { z, masks: [hull], lines: [[geo.close(hull), INK]], box: bounds([hull]), fills: [[fill([hull], E.gap * 0.75, 0.9, [shift(hull, -E.light * size * 0.4, -size * 0.35)]), role]] };
    }
    function crystal(E, rng, x, y, size, z, role) {
        const w = size * rng.range(0.16, 0.24), t = rng.range(-0.35, 0.35), c = Math.cos(t), s = Math.sin(t);
        const P = (u, h) => [x + u * c + h * s, y - h * c + u * s];
        const body = [P(-w, 0), P(w, 0), P(w, size * 0.76), P(0, size), P(-w, size * 0.76)];
        const half = E.light > 0 ? [P(0, 0), P(w, 0), P(w, size * 0.76), P(0, size)] : [P(-w, 0), P(0, 0), P(0, size), P(-w, size * 0.76)];
        return { z, masks: [body], lines: [[geo.close(body), INK], [[P(0, 0), P(0, size)], INK], [[P(-w, size * 0.76), P(0, size * 0.62), P(w, size * 0.76)], INK]], fills: [[fill([half], E.gap * 0.8, t + PI / 2 + 0.4), role]], box: bounds([body]) };
    }
    function mushroom(E, rng, x, y, size, z, role) {
        const rx = size * rng.range(0.32, 0.45), ry = size * rng.range(0.22, 0.32), cy = y - size + ry, sw = size * 0.06;
        const cap = [];
        for (let j = 0; j <= 10; j++) { const a = PI + PI * j / 10; cap.push([x + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
        const gills = [];
        for (let j = 0; j <= 10; j++) { const a = PI * j / 10; gills.push([x + rx * Math.cos(a), cy + ry * 0.28 * Math.sin(a)]); }
        const stem = [[x - sw, y], [x + sw, y], [x + sw * 0.7, cy], [x - sw * 0.7, cy]];
        const spots = [];
        for (let k = 0; k < 3; k++) { const u = rng.range(-0.55, 0.55), v = rng.range(0.35, 0.7); spots.push(geo.circle(x + rx * u, cy - ry * v * Math.sqrt(1 - u * u), size * 0.045, 7)); }
        return [
            { z, masks: [stem], lines: [[[stem[3], stem[0]], INK], [[stem[1], stem[2]], INK]] },
            { z: z + 0.02, masks: [cap, gills], lines: [[cap.concat(gills.slice(1, -1).reverse(), [cap[0]]), INK]].concat(spots.map(q => [q, role])), fills: [[fill([gills], E.gap * 0.9, PI / 2), role]], box: [x - rx, cy - ry, x + rx, y] },
        ];
    }
    function crater(E, rng, x, y, rx, z) {
        const ry = rx * rng.range(0.22, 0.3), rim = geo.ellipse(x, y, rx, ry, 0, 28).slice(0, -1);
        return { z, masks: [rim], lines: [[geo.close(rim), INK]], box: [x - rx, y - ry, x + rx, y + ry], fills: [[fill([rim], E.gap * 0.75, 0.5, [shift(rim, E.light * rx * 0.35, ry * 0.45)]), INK]] };
    }
    function rock(E, rng, x, y, r, z) {
        const pts = [];
        for (let j = 0, n = rng.int(7, 10); j < n; j++) { const a = TAU * j / n + rng.range(-0.25, 0.25), d = r * rng.range(0.7, 1); pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * rng.range(0.75, 1)]); }
        const hull = PG.iso.hull(pts), s = { z, masks: [hull], lines: [[geo.close(hull), INK]], fills: [], box: [x - r, y - r, x + r, y + r] };
        if (r > E.gap * 2) s.fills.push([fill([hull], E.gap * 0.75, 0.9, [shift(hull, E.lightVec[0] * r * 0.45, E.lightVec[1] * r * 0.45)]), INK]);
        if (r > 3) s.lines.push([geo.ellipse(x - r * 0.25, y - r * 0.2, r * 0.22, r * 0.14, 0, 12), INK]);
        return s;
    }
    // Moon base: glass domes with ribs and a door, and a mast with a dish
    function dome(E, rng, x, y, r, z, role) {
        const n = clamp(Math.ceil(r * 3), 10, 40), shell = [], L = E.light;
        for (let j = 0; j <= n; j++) { const a = PI + PI * j / n; shell.push([x + r * Math.cos(a), y + r * 0.85 * Math.sin(a)]); }
        const s = { z, masks: [shell], lines: [[geo.close(shell), INK]], fills: [[fill([shell], E.gap * 0.8, 0.8 * L, [shift(shell, -L * r * 0.4, -r * 0.35)]), role]], box: [x - r, y - r, x + r, y] };
        for (const k of [-0.5, 0.5]) s.lines.push([Array.from({ length: 13 }, (_, j) => { const a = PI + PI * j / 12; return [x + r * k * Math.cos(a), y + r * 0.85 * Math.sin(a)]; }), INK]);
        const lat = Math.sqrt(1 - 0.45 ** 2) * r;
        s.lines.push([[[x - lat, y - r * 0.85 * 0.45], [x + lat, y - r * 0.85 * 0.45]], INK]);
        const dw = r * 0.16, door = [[x + r * 0.62 - dw, y]];
        for (let j = 0; j <= 6; j++) { const a = PI + PI * j / 6; door.push([x + r * 0.62 + dw * Math.cos(a), y - r * 0.2 + dw * Math.sin(a)]); }
        door.push([x + r * 0.62 + dw, y]);
        s.lines.push([door, INK, 0.02]);
        return s;
    }
    function mast(E, x, y, size, z) {
        const top = y - size, dish = [];
        for (let j = 0; j <= 8; j++) { const a = -0.3 + PI * 0.55 * j / 8; dish.push([x + size * 0.2 * Math.cos(a + PI * 0.75), top + size * 0.15 + size * 0.2 * Math.sin(a + PI * 0.75)]); }
        return { z, lines: [[[[x - size * 0.08, y], [x, top], [x + size * 0.08, y]], INK], [[[x, y], [x, top]], INK], [dish, INK], [geo.circle(x, top - 0.8, 0.5, 8), WARM]] };
    }
    // Rock arch from two legs and a curved lintel. The pieces overlap, so their outlines only show on the union's edge.
    function arch(E, rng, xc, base, width, height, z) {
        const ro = width / 2, ri = ro * rng.range(0.55, 0.72), ys = base - height + ro * 0.75, L = E.light, m = 14, lintel = [];
        const P = (r, a, k) => [xc + r * Math.cos(a), ys + r * k * Math.sin(a)];
        for (let j = 0; j <= m; j++) lintel.push(P(ro, PI + PI * j / m, 1));
        for (let j = m; j >= 0; j--) lintel.push(P(ri, PI + PI * j / m, 0.8));
        const flare = ro * 0.12, legs = [[[xc - ro - flare, base], [xc - ro, ys - ro * 0.05], [xc - ri, ys - ro * 0.05], [xc - ri + flare * 0.5, base]],
            [[xc + ri - flare * 0.5, base], [xc + ri, ys - ro * 0.05], [xc + ro, ys - ro * 0.05], [xc + ro + flare, base]]];
        const masks = legs.slice();
        for (let j = 1; j <= m; j++) masks.push([lintel[j - 1], lintel[j], lintel[2 * m + 1 - j], lintel[2 * m + 2 - j]]);
        const pieces = legs.concat([lintel]);
        return {
            z, masks, box: [xc - ro - flare, base - height, xc + ro + flare, base],
            lines: pieces.map(P => [geo.close(P), INK, -0.01]),
            fills: [[fill(pieces, height / rng.int(4, 7), rng.range(-0.06, 0.06)), BROWN], [fill(pieces, E.gap * 0.8, L * 0.8, [shift(lintel, -L * ro * 0.2, -ro * 0.08)].concat(legs.map(q => shift(q, -L * ro * 0.12, -ro * 0.08)))), INK]],
        };
    }
    // Retro sci-fi towers: a capsule, a stepped spire or a tapered block, some with a ring deck
    // and an antenna, lit windows on the sunny side
    function tower(E, rng, x, base, w, height, z) {
        const top = base - height, hw = w / 2, L = E.light, kind = rng.int(0, 2);
        const body = kind === 0 ? capsule(x, base, top + hw, hw, false) : kind === 1 ? [[x - hw, base], [x - hw, top + w], [x, top], [x + hw, top + w], [x + hw, base]]
            : [[x - hw, base], [x - hw * 0.65, top], [x + hw * 0.65, top], [x + hw, base]];
        const pieces = [body], lines = [];
        if (rng.chance(0.55)) pieces.push(geo.ellipse(x, top + height * rng.range(0.12, 0.4), w * rng.range(0.9, 1.3), w * 0.22, 0, 20).slice(0, -1));
        if (rng.chance(0.6)) { const a = height * rng.range(0.1, 0.25); lines.push([[[x, top], [x, top - a]], INK], [geo.circle(x, top - a - 0.6, 0.5, 8), WARM]); }
        for (let y = top + w * 1.2; y < base - 1.5; y += E.gap * 3) {
            for (let k = 0, n = Math.max(1, Math.floor(w / 1.6)); k < n; k++) {
                const u = x - hw + w * (k + 0.5) / n;
                if (rng.chance(0.55) && (u - x) * L < hw * 0.2) lines.push([[[u - 0.35, y], [u + 0.35, y]], GOLD, 0.012]);
            }
        }
        return {
            z, masks: pieces, box: [x - w * 1.3, top - height * 0.3, x + w * 1.3, base],
            lines: pieces.map(P => [geo.close(P), INK, -0.01]).concat(lines),
            fills: [[fill(pieces, E.gap * 0.85, L * 1.2, pieces.map(P => shift(P, -L * w * 0.4, 0))), INK]],
        };
    }
    // A cluster of towers under a glass dome, sitting on the horizon
    function city(E, rng, xc, base, width, height, z, u) {
        const out = [], n = clamp(Math.round(width / (u * 0.07)), 4, 14);
        for (let k = 0; k < n; k++) {
            const v = (k + 0.5) / n, x = xc + width * (v - 0.5) * 0.85 + rng.range(-0.3, 0.3) * width / n, bulge = Math.sin(PI * v);
            out.push(tower(E, rng, x, base, u * rng.range(0.03, 0.06), height * (0.25 + 0.75 * bulge) * rng.range(0.6, 1.1), z + rng.range(0, 0.3)));
        }
        if (rng.chance(0.6)) {
            const dome = Array.from({ length: 41 }, (_, j) => { const a = PI + PI * j / 40; return [xc + width * 0.55 * Math.cos(a), base + height * 1.15 * Math.sin(a)]; });
            out.push({ z: z + 0.5, lines: [[dome, CYAN], [dome.map(([x, y]) => [xc + (x - xc) * 0.96, base + (y - base) * 0.96]), CYAN]] });
        }
        return out;
    }
    // Smoke, steam and exhaust
    function puff(E, rng, x, y, r, z, role = INK) {
        return cloud(E, rng, x, y + r * 0.5, r * 2.2, r * 1.3, z, { part: 'puff', lumps: 1.4, role });
    }
    function bolt(E, rng, D, x, y0, y1, z) {
        if (y1 - y0 < 4) return;
        const main = [[x, y0]], step = (y1 - y0) / rng.int(5, 8);
        for (let y = y0; y < y1;) { y = Math.min(y1, y + step * rng.range(0.6, 1.2)); x += step * rng.range(-0.7, 0.7); main.push([x, y]); }
        D.line(main, z, GOLD);
        const k = rng.int(1, main.length - 2), branch = [main[k]];
        for (let j = 0, s = rng.sign(); j < 3; j++) { const [bx, by] = branch[branch.length - 1]; branch.push([bx + s * step * rng.range(0.4, 0.9), by + step * rng.range(0.4, 0.8)]); }
        D.line(branch, z, GOLD);
    }

    // ------------------------------------------------------------------
    // Sky things
    // ------------------------------------------------------------------
    // Cumulus from a row of lumps: scalloped top, flat base, and the underside hatched
    // wherever the lumps shifted toward the light don't reach. Bushes use it too.
    function cloud(E, rng, cx, base, width, height, z, o = {}) {
        const n = clamp(Math.round(width / height * (o.lumps || 2)), 3, 16), lumps = [], L = E.light;
        const xs0 = Array.from({ length: n }, (_, i) => cx + width * (i / (n - 1) - 0.5) * 0.84 + rng.range(-0.3, 0.3) * width / n).sort((a, b) => a - b);
        for (let i = 0; i < n; i++) {
            const u = i / (n - 1), bulge = Math.sin(PI * (0.08 + 0.84 * u)), r = height * (0.24 + 0.36 * bulge) * rng.range(0.7, 1.3);
            // the end lumps sit low so the rounded ends meet the flat base without a step
            const end = i === 0 || i === n - 1;
            lumps.push([xs0[i], base - r * (end ? rng.range(0.3, 0.5) : rng.range(0.05, 0.5)) - (end ? 0 : height * 0.35 * bulge * rng.range(0.6, 1.1)), r]);
        }
        const lit = lumps.map(([x, y, r]) => [x - L * r * 0.3, y - r * (o.storm ? 1 : 0.72), r * 0.86]);
        const env = (list, x, up) => {
            let v = up ? Infinity : -Infinity;
            for (const [cx, cy, r] of list) {
                const d = x - cx;
                if (d * d >= r * r) continue;
                const s = Math.sqrt(r * r - d * d);
                v = up ? Math.min(v, cy - s) : Math.max(v, cy + s);
            }
            return v;
        };
        // Sample each lump at a few angles (the low-poly look) plus the cusps between neighbours
        const xs = [], F = 6;
        for (const [x, , r] of lumps.concat(lit)) for (let j = 0; j <= F; j++) xs.push(x - r * Math.cos(PI * j / F));
        for (let i = 1; i < lumps.length; i++) {
            const [ax, ay, ar] = lumps[i - 1], [bx, by, br] = lumps[i];
            let lo = Math.max(ax - ar, bx - br), hi = Math.min(ax + ar, bx + br);
            const f = x => (ay - Math.sqrt(Math.max(0, ar * ar - (x - ax) ** 2))) - (by - Math.sqrt(Math.max(0, br * br - (x - bx) ** 2)));
            if (hi <= lo || f(lo) * f(hi) > 0) continue;
            for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
            xs.push((lo + hi) / 2);
        }
        xs.sort((a, b) => a - b);
        const x0 = lumps[0][0], x1 = lumps[lumps.length - 1][0], top = [], bot = [], shade = [];
        for (const x of xs) {
            if (top.length && x - top[top.length - 1][0] < 0.05) continue;
            const t = env(lumps, x, true);
            if (!isFinite(t)) continue;
            const b = x >= x0 && x <= x1 ? base : Math.min(base, env(lumps, x, false));
            if (b < t) continue;
            const l = env(lit, x, false);
            top.push([x, t]); bot.push([x, b]); shade.push([x, isFinite(l) ? clamp(l, t, b) : t]);
        }
        if (top.length < 3) return null;
        const outline = top.concat(bot.slice().reverse(), [top[0]]);
        return {
            z, top, bot, part: o.part || 'cloud', box: bounds([outline]), lines: [[outline, INK]],
            fills: [[fill([shade.concat(bot.slice().reverse())], E.gap * (o.storm ? 0.6 : 0.7), o.angle ?? E.cloudAngle), o.role || INK]],
        };
    }
    // A sphere seen a little from above the equator (sin of that angle is pl.flat) with its axis
    // turned by pl.tilt on the page. Bands are latitude circles, rings sit in the equator plane.
    function planet(E, pl, x, y, r, z, light) {
        const g = E.gap, out = [], segs = clamp(Math.ceil(r * 2.5), 18, 120);
        const body = geo.ngon(x, y, r, segs), b = { z, masks: [body], lines: [[geo.close(body), INK]], fills: [], box: [x - r, y - r, x + r, y + r] };
        out.push(b);
        const [lx, ly] = light, n = segs >> 1, dark = [], term = [];
        for (let j = 0; j <= n; j++) {
            const a = -PI / 2 + PI * j / n, c = Math.cos(a), s = Math.sin(a);
            dark.push([x - r * (c * lx + s * ly), y + r * (s * lx - c * ly)]);
        }
        for (let j = n; j >= 0; j--) {
            const a = -PI / 2 + PI * j / n, c = -pl.phase * Math.cos(a), s = Math.sin(a);
            term.push([x - r * (c * lx + s * ly), y + r * (s * lx - c * ly)]);
        }
        if (r > g * 2) b.fills.push([fill([dark.concat(term)], g * pl.shadeGap, pl.shadeAngle), pl.shade]);
        b.lines.push([term, INK]);
        const ct = Math.cos(pl.tilt), st = Math.sin(pl.tilt), si = pl.flat, ci = Math.sqrt(1 - si * si), inc = Math.asin(si);
        const S = (u, v) => [x + u * ct - v * st, y + u * st + v * ct];
        // the part of a latitude circle on the near side, which always ends on the limb
        const lat = phi => {
            const k = -Math.tan(phi) * si / ci, rc = r * Math.cos(phi), rs = r * Math.sin(phi);
            if (k >= 1) return null;
            const t0 = k <= -1 ? 0 : Math.asin(k), t1 = k <= -1 ? TAU : PI - t0, m = clamp(Math.ceil(rc * (t1 - t0) * 0.6), 8, 120);
            return Array.from({ length: m + 1 }, (_, j) => { const t = t0 + (t1 - t0) * j / m; return S(rc * Math.cos(t), rc * Math.sin(t) * si - rs * ci); });
        };
        if (r > 4.5) for (let k = 0; k + 1 < pl.bands.length; k += 2) {
            const p0 = pl.bands[k], p1 = pl.bands[k + 1];
            // latitude lines at least 1.5 gaps apart where they crowd, so they don't turn solid
            for (let phi = p0, step = 0; phi < p1; phi += step) {
                step = Math.max((p1 - p0) / 150, g * 1.5 / (r * Math.max(0.15, Math.cos(Math.min(1.45, Math.abs(phi) + inc)))));
                const q = phi > p0 && lat(phi);
                if (q) b.lines.push([q, pl.band, 0.006]);
            }
            if (r > 12) for (const phi of [p0, p1]) { const q = lat(phi); if (q) b.lines.push([q, INK]); }
        }
        if (pl.ring) {
            const ri = r * pl.inner, ro = r * pl.outer, m = clamp(Math.ceil(ro * 0.8), 16, 90);
            const P = (rad, a) => S(rad * Math.cos(a), rad * si * Math.sin(a));
            // grooves as smaller ellipses, as many as fit at the ring's narrowest
            const grooves = Math.floor((ro - ri) * si / (g * 1.2)), cassini = grooves >= 4 ? Math.round(grooves * 0.6) : -1;
            for (const front of [false, true]) {
                const arc = rad => Array.from({ length: m + 1 }, (_, j) => P(rad, (front ? 0 : PI) + PI * j / m));
                const outer = arc(ro), inner = arc(ri), masks = [];
                for (let j = 1; j <= m; j++) masks.push([outer[j - 1], outer[j], inner[j], inner[j - 1]]);
                const ring = { z: z + (front ? 0.3 : -0.3), masks, lines: [[outer, INK], [inner, INK]], box: bounds([outer, inner]) };
                if (grooves < 2) ring.lines.push([arc((ri + ro) / 2), pl.ringRole]);
                else for (let j = 1; j < grooves; j++) ring.lines.push([arc(lerp(ri, ro, j / grooves)), j === cassini ? INK : pl.ringRole]);
                out.push(ring);
            }
        }
        return out;
    }
    function lightFrom(E, sun, x, y) {
        if (sun) { const dx = sun[0] - x, dy = sun[1] - y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
        return E.lightVec;
    }
    function sunDisc(E, D, sun, stripes, z = 2) {
        const [x, y, r] = sun, poly = geo.ngon(x, y, r, clamp(Math.ceil(r * 4), 24, 90));
        D.face(poly, z);
        D.line(geo.close(poly), z + 0.01, E.cast.sun);
        if (stripes && r > 3) for (let k = 0, v = 0.12, step = 0.2; v < 0.97 && k < 12 && step * r > 0.45; k++, v += step, step *= 0.78) {
            const h = r * Math.sqrt(1 - v * v);
            D.line([[x - h, y + r * v], [x + h, y + r * v]], z + 0.005, E.cast.sun);
        }
    }
    function skyStyle(E, rng, phase, sun) {
        const st = { style: 'none', role: COOL, role2: WARM, angle: rng.pick([PI / 4, -PI / 4, PI / 6, -PI / 3, 0]), k: rng.range(2, 3), q: rng.range(1.08, 1.16), alt: rng.chance(0.3) };
        if (phase === 'night') { st.style = rng.chance(0.3) ? 'hatch' : 'none'; st.role = rng.pick([VIOLET, COOL]); st.k *= 1.5; st.angle = 0; }
        else if (phase === 'set') { st.style = rng.weighted([[3.5, 'bands'], [2.5, 'rays'], [1, 'glow'], [1.2, 'split']]); st.role = rng.pick([WARM, GOLD, VIOLET]); st.role2 = rng.pick([WARM, GOLD]); }
        else if (phase === 'low') { st.style = rng.weighted([[3, 'rays'], [2, 'bands'], [1.2, 'glow'], [1.5, 'hatch'], [1.5, 'split']]); st.role = rng.pick([WARM, GOLD, VIOLET, COOL]); st.role2 = rng.pick([WARM, GOLD]); }
        else { st.style = rng.weighted([[2.2, 'rays'], [3, 'hatch'], [1.3, 'cross'], [1.2, 'split'], [1, 'none']]); st.role = rng.pick([COOL, COOL, CYAN, VIOLET, GREEN]); }
        if (!sun && (st.style === 'rays' || st.style === 'glow' || st.style === 'bands')) st.style = phase === 'night' ? 'none' : 'hatch';
        const warm = role => role === WARM || role === GOLD, other = role => warm(role) ? rng.pick([COOL, VIOLET, CYAN]) : rng.pick([WARM, GOLD]);
        // the second color comes from the other family, so crossings mix two inks
        if (st.style === 'cross') { st.role2 = other(st.role); if (!st.angle) st.angle = PI / 4; }
        if (st.style === 'rays') st.rays = phase === 'day' && rng.chance(0.5) ? st.role : E.cast.sun;
        // No more than two skies in a row in the same family of inks
        if (st.style !== 'none' && st.style !== 'cross') {
            const key = st.style === 'rays' ? 'rays' : 'role', fam = warm(st[key]);
            if (E.run.n >= 2 && E.run.fam === fam) { st[key] = other(st[key]); if (key === 'rays') st.role = st.rays; }
            if (E.run.fam === warm(st[key])) E.run.n++; else E.run = { fam: warm(st[key]), n: 1 };
        }
        if (st.role === st.role2) st.role2 = other(st.role);
        return st;
    }
    function sky(E, rng, D, st, sun, bottom, horizon) {
        const { X, Y, W } = D, g = E.gap, y1 = Math.min(bottom, Y + D.H) + 0.5;
        if (y1 <= Y) return;
        const rect = [[X - 1, Y - 1], [X + W + 1, Y - 1], [X + W + 1, y1], [X - 1, y1]], win = PG.shapes.rect(X - 1, Y - 1, X + W + 1, y1);
        const seg = (a, b, role) => { const t = win.clipSeg(a[0], a[1], b[0], b[1]); if (t && t[1] - t[0] > 1e-6) D.line([geo.lerpPt(a, b, t[0]), geo.lerpPt(a, b, t[1])], 0, role); };
        const reach = sun ? Math.max(...rect.map(([x, y]) => Math.hypot(x - sun[0], y - sun[1]))) + 1 : 0;
        const bands = (from, to, role) => { for (let y = from - g * 1.5, step = g * 1.5, k = 0; y > to && k < 300; k++, step *= st.q, y -= step) seg([X - 1, y], [X + W + 1, y], role); };
        if (st.style === 'hatch' || st.style === 'cross') {
            for (const q of fill([rect], g * st.k, st.angle)) D.line(q, 0, st.role);
            if (st.style === 'cross') for (const q of fill([rect], g * st.k * 1.15, st.angle + PI / 2)) D.line(q, 0.001, st.role2);
        } else if (st.style === 'split') {
            // diagonal hatch overhead, glowing bands down by the horizon
            const cut = horizon - (horizon - Y) * rng.range(0.3, 0.5);
            for (const q of fill([[[X - 1, Y - 1], [X + W + 1, Y - 1], [X + W + 1, cut], [X - 1, cut]]], g * st.k, st.angle || PI / 4)) D.line(q, 0, st.role);
            st.q = 1.04;
            bands(horizon, cut, st.role2);
        } else if (st.style === 'bands') {
            bands(horizon, Y, st.role);
        } else if (st.style === 'rays') {
            // rays start far enough out that they're still 0.6 mm apart around a small sun
            const [cx, cy, r] = sun, n = clamp(Math.round(TAU * Math.min(reach, 180) * 0.55 / (g * 5)), 28, 200), a0 = rng.range(0, TAU), start = Math.max(r * 1.3, n * 0.6 / TAU);
            for (let k = 0; k < n; k++) {
                const a = a0 + TAU * k / n, c = Math.cos(a), s = Math.sin(a), r0 = start * (st.alt && k % 2 ? 1.4 : 1);
                seg([cx + c * r0, cy + s * r0], [cx + c * reach, cy + s * reach], st.rays ?? E.cast.sun);
            }
        } else if (st.style === 'glow') {
            for (let rr = sun[2] * 1.35, k = 0; rr < reach && k < 40; rr = rr * st.q + g * 1.2, k++) {
                for (const q of PG.clipPaths([geo.circle(sun[0], sun[1], rr)], win)) D.line(q, 0, st.role);
            }
        }
    }
    function stars(E, rng, D, bottom, density, avoid) {
        const { X, Y, W } = D, y1 = Math.min(bottom, Y + D.H) - 1.3, area = W * (y1 - Y);
        if (area <= 0 || density <= 0) return;
        const n = Math.min(700, Math.round(area * density / 55)), band = rng.chance(0.3) ? [rng.range(-0.8, 0.8), rng.range(0.2, 0.8)] : null;
        for (let i = 0; i < n; i++) {
            let x = rng.range(X + 1.3, X + W - 1.3), y = rng.range(Y + 1.3, y1);
            // a milky way: some stars pulled toward a diagonal band
            if (band && i % 2) { const u = rng.random(); x = X + W * u; y = Y + (y1 - Y) * (band[1] + band[0] * (u - 0.5)) + rng.gauss(0, W * 0.05); if (x < X + 1.3 || x > X + W - 1.3 || y < Y + 1.3 || y > y1) continue; }
            const kind = rng.random(), s = rng.range(0.55, 1.1), role = rng.chance(0.2) ? rng.pick(E.starRoles) : INK;
            if (avoid.some(([u, v, r]) => Math.hypot(x - u, y - v) < r + 1.5)) continue;
            if (kind < 0.5) D.mark(geo.circle(x, y, rng.range(0.22, 0.38), 6), 1, role);
            else if (kind < 0.9) { D.mark([[x - s, y], [x + s, y]], 1, role); D.mark([[x, y - s], [x, y + s]], 1, role); }
            else if (kind < 0.97) D.mark(geo.close(Array.from({ length: 8 }, (_, j) => { const rr = j % 2 ? s * 0.35 : s * 1.7, a = PI * j / 4; return [x + rr * Math.cos(a), y + rr * Math.sin(a)]; })), 1, role);
            else D.mark(geo.circle(x, y, s * 0.8, 10), 1, role);
        }
    }
    function aurora(E, rng, D, horizon) {
        const { X, Y, W } = D, g = E.gap, y0 = Y + (horizon - Y) * rng.range(0.2, 0.45), amp = (horizon - Y) * 0.08, f = TAU / (W * rng.range(0.5, 1.2)), ph = rng.range(0, TAU);
        for (let x = X + g; x < X + W; x += g * 1.7) {
            const yb = y0 + amp * Math.sin(f * x + ph), len = (horizon - Y) * (0.12 + 0.18 * (0.5 + 0.5 * Math.sin(f * 2.3 * x + ph * 2)));
            D.line([[x, yb - len], [x, yb]], 0.5, Math.sin(f * 0.7 * x + ph) > 0 ? GREEN : CYAN);
        }
    }
    function comet(E, rng, D, x, y, size, away, z) {
        const r = size * 0.08, a = Math.atan2(away[1], away[0]), head = geo.ngon(x, y, r, 12);
        D.face(head, z); D.line(geo.close(head), z + 0.01, INK);
        for (let k = -2; k <= 2; k++) {
            const t = a + k * 0.07, l = size * (1 - Math.abs(k) * 0.18) * rng.range(0.85, 1.1), o = Math.max(0.45, r * 0.6) * k;
            D.line([[x + Math.cos(t) * r - Math.sin(a) * o, y + Math.sin(t) * r + Math.cos(a) * o], [x + Math.cos(t) * l, y + Math.sin(t) * l]], z - 0.01, k ? CYAN : INK);
        }
    }
    function shootingStar(D, rng, X, Y, W, H) {
        const x = X + W * rng.range(0.2, 0.8), y = Y + H * rng.range(0.1, 0.35), a = rng.range(0.25, 0.7), l = Math.min(W, H) * rng.range(0.2, 0.35), dx = Math.cos(a) * l * rng.sign(), dy = Math.sin(a) * l;
        D.line([[x, y], [x + dx, y + dy]], 1.5, INK);
        D.line([[x + dy * 0.04, y - dx * 0.04], [x + dx * 0.6 + dy * 0.04, y + dy * 0.6 - dx * 0.04]], 1.5, COOL);
        const s = 1.2, tx = x + dx, ty = y + dy;
        D.mark([[tx - s, ty], [tx + s, ty]], 1.6, INK); D.mark([[tx, ty - s], [tx, ty + s]], 1.6, INK);
    }
    function saucer(E, rng, D, x, y, size, z, ground, move = 0) {
        const rx = size, ry = size * 0.26, body = geo.ellipse(x, y, rx, ry, 0, 32).slice(0, -1), dome = [];
        for (let j = 0; j <= 12; j++) { const a = PI + PI * j / 12; dome.push([x + rx * 0.42 * Math.cos(a), y - ry * 0.2 + ry * 1.7 * Math.sin(a)]); }
        const shapes = [
            { z, masks: [body], lines: [[geo.close(body), INK], [geo.ellipse(x, y + ry * 0.1, rx * 0.93, ry * 0.45, 0, 24).slice(0, 13), INK]], fills: [] },
            { z: z - 0.1, masks: [dome], lines: [[dome, INK]], fills: [[fill([dome], E.gap * 0.8, 0.9, [shift(dome, -E.light * rx * 0.2, -ry * 0.5)]), CYAN]] },
        ];
        for (let k = -2; k <= 2; k++) shapes[0].lines.push([geo.circle(x + k * rx * 0.33, y + ry * 0.35 * (1 - (k * 0.33) ** 2), size * 0.05, 7), GOLD]);
        if (ground && ground > y + ry * 2) {
            const beam = [[x - rx * 0.3, y + ry * 0.7], [x + rx * 0.3, y + ry * 0.7], [x + rx * 0.85, ground], [x - rx * 0.85, ground]];
            shapes.push({ z: z - 0.2, masks: [beam], lines: [[[beam[0], beam[3]], GOLD], [[beam[1], beam[2]], GOLD]], fills: [[fill([beam], E.gap * 1.6, PI / 2), GOLD]] });
        }
        // comic speed lines
        if (move) for (let k = -1; k <= 1; k++) D.line([[x - move * rx * 1.2, y + k * ry * 0.7], [x - move * rx * (1.9 + rng.range(0, 0.8)), y + k * ry * 0.7]], z, INK);
        for (const s of shapes) draw(D, s);
    }
    function rocket(E, rng, D, x, y, size, a, z) {
        const w = size * 0.16, ca = Math.cos(a), sa = Math.sin(a);
        const P = (u, h) => [x + u * ca + h * sa, y - h * ca + u * sa];
        const body = [P(-w, 0), P(w, 0), P(w, size * 0.55), P(w * 0.6, size * 0.82), P(0, size), P(-w * 0.6, size * 0.82), P(-w, size * 0.55)];
        const fins = [-1, 1].map(s => [P(s * w, size * 0.3), P(s * w * 2.1, -size * 0.06), P(s * w, size * 0.04)]);
        const flame = [P(-w * 0.7, 0), P(-w * 0.35, -size * 0.3), P(0, -size * 0.5), P(w * 0.35, -size * 0.3), P(w * 0.7, 0)];
        draw(D, { z: z - 0.1, masks: fins, lines: fins.map(f => [geo.close(f), INK]), fills: [[fill(fins, E.gap * 0.8, a), WARM]] });
        draw(D, { z: z - 0.2, masks: [flame], lines: [[flame, WARM]], fills: [[fill([flame], E.gap * 1.2, a + PI / 2), GOLD]] });
        const win = geo.circle(...P(0, size * 0.56), w * 0.5, 12);
        draw(D, { z, masks: [body], lines: [[geo.close(body), INK], [win, INK], [[P(-w, size * 0.3), P(w, size * 0.3)], INK]], fills: [[fill([body], E.gap * 0.9, a + 0.8, [shift(body, -E.light * w * 0.9, 0)]), INK]] });
        for (let k = 0; k < 6; k++) {
            const [px, py] = P(rng.range(-0.3, 0.3) * size * 0.3, -size * (0.7 + k * 0.36)), pr = size * (0.1 + k * 0.04);
            if (py > D.Y + D.H + pr) break;
            const c = puff(E, rng, px, py, pr, z - 0.3 - k * 0.01);
            if (c) draw(D, c);
        }
    }

    // ------------------------------------------------------------------
    // Scenes. Each one returns shared shapes (built once for panels that share a
    // landscape) and a local() that adds each panel's sky, sun and visitors.
    // ------------------------------------------------------------------
    const phaseOf = e => e > 0.45 ? 'day' : e > 0.12 ? 'low' : e > -0.15 ? 'set' : 'night';
    function sunAt(rng, D, horizon, e, m) {
        if (e <= -0.15) return null;
        const r = m * rng.range(0.07, 0.12), top = D.Y + r + 2, x = D.X + D.W * rng.range(0.18, 0.82);
        return [x, e > 0 ? lerp(horizon + r * 0.15, top, Math.min(1, e)) : horizon + r * 0.15 - e * r * 4, r];
    }
    // Planets from the page's cast, placed where they don't collide
    function scatter(E, rng, D, count, yMax, avoid, z0, size, sun) {
        const m = Math.min(D.W, D.H);
        for (let i = 0, tries = 0; i < count && tries < 40; tries++) {
            const pl = rng.pick(E.pool), r = m * rng.range(size[0], size[1]), reach = r * (pl.ring ? pl.outer * 0.9 : 1.1);
            const x = rng.range(D.X + reach * 0.6, D.X + D.W - reach * 0.6), y = rng.range(D.Y + r * 1.3, Math.max(D.Y + r * 1.4, yMax - r * 1.4));
            if (avoid.some(([u, v, rr]) => Math.hypot(x - u, y - v) < rr + reach + 1)) continue;
            avoid.push([x, y, reach]);
            for (const s of planet(E, pl, x, y, r, z0 + i, lightFrom(E, sun, x, y))) draw(D, s);
            i++;
        }
    }
    function featured(E, rng, D, t, yMax, avoid, sun) {
        const pl = E.cast.planets[0], m = Math.min(D.W, D.H), r = m * lerp(0.04, 0.24, t ** 1.4);
        const x = D.X + D.W * rng.range(0.3, 0.7), y = Math.min(D.Y + D.H * rng.range(0.25, 0.45), yMax - r * 0.6);
        avoid.push([x, y, r * pl.outer]);
        for (const s of planet(E, pl, x, y, r, 8, lightFrom(E, sun, x, y))) draw(D, s);
    }
    function clouds(E, rng, D, count, yTop, yBot, z, scale, o = {}) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const width = scale * rng.range(0.3, 0.65), height = width * rng.range(0.22, 0.34), x = D.X + D.W * rng.range(0.05, 0.95), y = rng.range(yTop + height, Math.max(yTop + height, yBot));
            const storm = rng.chance(0.07), c = cloud(E, rng, x, y, width, height, z + i * 0.05, { storm, ...o });
            if (!c) continue;
            draw(D, c); out.push([x, y, width]);
            if (storm) for (let u = x - width * 0.35; u < x + width * 0.35; u += E.gap * 2.2) {
                let v = y + rng.range(0, 1);
                for (let k = 0, n = rng.int(1, 3); k < n; k++) {
                    const l = height * rng.range(0.4, 1.1), dx = l * 0.25;
                    D.line([[u + (v - y) * 0.25, v], [u + (v - y) * 0.25 + dx, v + l]], z - 0.02, COOL);
                    v += l + height * rng.range(0.2, 0.6);
                }
            }
        }
        return out;
    }

    const BIOMES = {
        peaks: [[4, 'peaks'], [3, 'lake'], [2, 'snow'], [1.5, 'hills']],
        desert: [[5, 'desert'], [1.5, 'moon'], [1.5, 'alien']],
        skies: [[2, 'hills'], [2, 'lake'], [1, 'peaks'], [1, 'desert']],
        space: [[3, 'moon'], [1.5, 'alien'], [1, 'desert']],
    };
    function land(E, rng, R, biome, pw, t, hero, count) {
        const [x0, y0, w, h] = R, xa = x0 - 3, xb = x0 + w + 3, yb = y0 + h, g = E.gap, L = E.light, detail = E.p.detail;
        // Props grow with the panel but slower, so big panels get more of them rather than giant ones
        const m = Math.min(h, pw), u = Math.min(m, 30 + m * 0.35), big = m > 70, tall = pw < h * 0.75, shared = [];
        const ang = rng.pick([-0.35, -0.55, 0.4, 0.25, -0.8]) * L;
        const hz = y0 + h * (tall ? rng.range(0.52, 0.66) : big ? rng.range(0.4, 0.5) : rng.range(0.4, 0.54));
        const tint = rng.pick([VIOLET, COOL, CYAN, VIOLET]), green = rng.pick([GREEN, GREEN, CYAN, INK]);
        let far = null, water = null;
        const add = s => { if (Array.isArray(s)) shared.push(...s); else if (s) shared.push(s); return s; };
        const layer = (top, z, role = INK) => { if (!far) far = top; return add({ z, top, lines: [[top, role]], fills: [], marks: [], box: bounds([top.concat([[top[0][0], yb]])]) }); };
        const distant = (base, amp) => {
            const r = jagged(rng, xa, xb, base, amp, Math.min(amp * rng.range(0.9, 1.8), pw * 0.3), Math.max(0.45, amp / 9)), s = layer(r.pts, 20);
            if (rng.chance(0.8)) s.fills.push([fill([r.pts.concat([[xb, base + amp], [xa, base + amp]])], g * rng.range(1.1, 1.5), rng.pick([0, 0, PI / 4, -PI / 4])), tint]);
            return s;
        };
        const range = (base, amp, z, snow) => {
            const r = jagged(rng, xa, xb, base, amp, Math.min(amp * (big ? rng.range(0.8, 1.5) : rng.range(1.2, 2.2)), pw * rng.range(0.3, 0.55)), Math.max(0.5, amp / 18));
            const s = layer(r.pts, z);
            facets(E, rng, s, r, base, base + amp * 0.6, ang, rng.chance(0.5) ? tint : null, snow ? snowcap(rng, xa, xb, base - amp * rng.range(0.55, 0.72), amp) : null);
            return s;
        };
        // A cone with a shaded flank, lava runs and a plume of smoke drifting off the crater
        const volcano = (base, amp, z) => {
            const xc = x0 + w * rng.range(0.25, 0.75), half = Math.min(amp * rng.range(1.3, 1.9), pw * 0.5), crater = half * rng.range(0.12, 0.2), top = base - amp;
            const flank = s => Array.from({ length: 13 }, (_, i) => [lerp(xc + s * half, xc + s * crater, i / 12), base - amp * (i / 12) ** 1.7 + (i % 12 ? rng.range(-0.03, 0.03) * amp : 0)]);
            const pts = [[xa, base], ...flank(-1), [xc - crater * 0.3, top + amp * 0.05], [xc + crater * 0.3, top + amp * 0.05], ...flank(1).reverse(), [xb, base]].filter((q, i, a) => !i || q[0] > a[i - 1][0]);
            const s = layer(pts, z);
            const crease = [[xc + L * crater * 0.3, top + amp * 0.05], [xc + L * half * 0.12, top + amp * 0.45], [xc + L * half * 0.3, base]];
            const lit = [[xc - L * half * 3, top - amp], [crease[0][0], top - amp], ...crease, [crease[2][0], base + amp], [xc - L * half * 3, base + amp]];
            s.fills.push([fill([pts.concat([[xb, base + 1], [xa, base + 1]])], g * 0.85, ang, [lit]), INK]);
            s.lines.push([crease, INK]);
            for (let k = 0; k < rng.int(2, 4); k++) {
                const side = rng.sign(), run = [[xc + side * crater * rng.range(0.2, 0.9), top + amp * 0.06]];
                for (let j = 0; j < 5; j++) { const [x, y] = run[run.length - 1]; run.push([x + side * half * rng.range(0.03, 0.1), y + amp * rng.range(0.07, 0.14)]); }
                s.lines.push([run, WARM, 0.012]);
            }
            const drift = rng.sign() * amp * rng.range(0.08, 0.16);
            for (let k = 0, y = top; k < 9; k++) {
                const r = amp * (0.07 + k * 0.045);
                y -= r * 1.05;
                const c = puff(E, rng, xc + drift * k * (1 + k * 0.25) + rng.range(-0.2, 0.2) * r, y, r, z - 0.6 - k * 0.01);
                if (c) add(c);
            }
            return s;
        };
        const hill = (base, amp, z, role, chance = 0.85) => {
            const pts = rolling(rng, xa, xb, base, amp, Math.max(0.5, amp / 10)), s = layer(pts, z);
            const ps = patches(rng, pts, L, chance);
            if (ps.length) s.fills.push([fill(ps, g * rng.range(0.9, 1.2), ang + rng.range(-0.2, 0.2)), role]);
            const lit = rng.chance(0.35) ? patches(rng, pts, -L, 0.7, 0.6) : [];
            if (lit.length) s.fills.push([fill(lit, g * 1.6, -ang), role === tint ? green : tint]);
            if (rng.chance(0.25 * detail)) {
                // striped fields following the hill
                const rows = [];
                for (let k = 1; k < 7; k++) rows.push(pts.map(([x, y]) => [x, y + k * g * 2.6]));
                s.fills.push([rows, role === INK ? GREEN : role]);
            }
            s.pts = pts;
            return s;
        };
        const flat = (y, z, role, density) => { const s = layer([[xa, y], [xb, y]], z); s.fills.push([plainLines(rng, xa, xb, y, yb + 2, g, density), role]); return s; };
        // Props along a profile in small groves, lower ones (nearer) in front
        const props = (pts, z, count, depth, make, grove = 1, lo = x0 + 1, hi = x0 + w - 1) => {
            const list = [];
            while (list.length < Math.min(120, count)) {
                const cx = rng.range(lo, hi), f = rng.range(0.1, 1), k = rng.int(1, grove);
                for (let j = 0; j < k && list.length < 120; j++) {
                    const x = clamp(cx + rng.gauss(0, u * 0.06) * (j > 0), lo, hi);
                    list.push([x, heightAt(pts, x) + depth * clamp(f + rng.range(-0.2, 0.2) * (j > 0), 0.05, 1)]);
                }
            }
            list.sort((a, b) => a[1] - b[1]).forEach(([x, y], k) => add(make(x, y, z + 0.3 + k * 0.01)));
        };
        const bush = (x, y, size, z) => cloud(E, rng, x, y, size, size * rng.range(0.4, 0.6), z, { part: 'bush', role: green, lumps: 1.5, angle: ang });
        // little patches of grass stripes
        const tufts = (s, count, depth) => {
            const c = Math.cos(-L * 1.1), d = Math.sin(-L * 1.1);
            for (let k = 0; k < Math.min(80, count); k++) {
                const x = rng.range(x0 + 1, x0 + w - 1), y = heightAt(s.top, x) + depth * rng.range(0.15, 1), q = u * rng.range(0.02, 0.035) + 0.8;
                for (let j = 0, n = rng.int(3, 6); j < n; j++) {
                    const v = x + j * g * 1.5, l = q * rng.range(0.6, 1), yy = y + rng.range(-0.15, 0.15) * q;
                    s.marks.push([[[v, yy], [v + c * l, yy + d * l]], green]);
                }
            }
        };
        const many = per => Math.round(w / u * per * (0.4 + detail) * rng.range(0.7, 1.3));
        const tree = (size, kind = 'round') => (x, y, z) => kind === 'pine' ? pine(E, rng, x, y, size * rng.range(0.8, 1.25), z, green)
            : rng.chance(0.25) ? bush(x, y, size * rng.range(0.4, 0.6), z) : rng.chance(0.12) ? boulder(E, rng, x, y, size * rng.range(0.2, 0.35), z, BROWN) : lollipop(E, rng, x, y, size * rng.range(0.75, 1.25), z, green);
        const rising = (pl, z) => {
            const r = Math.min(w * 0.32, h * 0.42) * rng.range(0.8, 1.1);
            add(planet(E, pl, x0 + w * rng.range(0.25, 0.75), hz + r * rng.range(-0.25, 0.3), r, z, E.lightVec));
        };
        // A giant planet rising behind the horizon in feature panels
        if (hero && biome !== 'moon' && rng.chance(0.5)) rising(E.cast.planets[2], 15);
        const amp = Math.min(h * (big ? rng.range(0.18, 0.26) : rng.range(0.24, 0.34)), pw * rng.range(0.4, 0.6));
        if (biome === 'peaks' || biome === 'snow' || biome === 'lake') {
            if (rng.chance(0.65)) distant(hz - h * 0.02, h * rng.range(0.05, 0.1));
            const lake = biome === 'lake' || (biome === 'snow' && rng.chance(0.35)), base = hz + (lake ? 0 : h * 0.05), snow = biome === 'snow';
            const main = !snow && !lake && rng.chance(0.2) ? volcano(base, amp * 0.9, 22) : range(base, amp * (lake ? 0.85 : 1), 22, snow);
            const trees = tree(u * rng.range(0.1, 0.15), snow ? 'pine' : 'round');
            if (lake) {
                water = { y: base, ridge: main.top, z: 24 };
                add({ z: 24, top: [[xa, base], [xb, base]], lines: [[[[xa, base], [xb, base]], INK]], box: [xa, base, xb, yb] });
                const shore = hill(yb - h * (big ? rng.range(0.1, 0.18) : rng.range(0.03, 0.1)), h * rng.range(0.06, 0.12), 26, green);
                props(shore.pts, 26, many(3), h * 0.05, trees, 4);
                tufts(shore, many(6), h * 0.08);
            } else {
                // the plain starts right at the foot of whatever stands behind it
                let foot = base;
                if (rng.chance(0.55)) { range(hz + h * 0.1, amp * rng.range(0.4, 0.6), 23, snow); foot = hz + h * 0.1; }
                else if (rng.chance(0.6)) { const f = hill(hz + h * 0.13, h * rng.range(0.04, 0.08), 24, rng.pick([green, INK, tint])); props(f.pts, 24, many(2), h * 0.03, tree(u * 0.06, snow ? 'pine' : 'round'), 5); foot = hz + h * 0.13; }
                foot += h * rng.range(0.01, 0.03);
                flat(foot, 26, rng.pick([GREEN, BROWN, GOLD]), 0.6);
                if (big) { const mid = hill(lerp(foot, yb, 0.5), h * rng.range(0.04, 0.07), 27, rng.pick([green, tint])); props(mid.pts, 27, many(3), h * 0.04, tree(u * 0.08, snow ? 'pine' : 'round'), 6); }
                const fore = hill(yb - h * 0.02, h * rng.range(0.07, 0.12), 28, green);
                props(fore.pts, 28, many(3), h * 0.06, trees, 4);
                tufts(fore, many(8), h * 0.1);
            }
        } else if (biome === 'hills') {
            if (rng.chance(0.55)) distant(hz, h * rng.range(0.05, 0.1));
            const n = clamp(Math.round(h / u * 1.6), 3, 6) + (tall ? 1 : 0);
            for (let i = 0; i < n; i++) {
                const v = i / (n - 1), base = lerp(hz + h * 0.07, yb - h * 0.01, v), a = h * lerp(0.05, 0.14, v) * rng.range(0.8, 1.2) * 4 / n;
                const s = hill(base, a, 22 + i * 2, [green, INK, tint, green][i % 4]);
                if (i && rng.chance(0.8)) props(s.pts, 22 + i * 2, many(1.5 + i), a * 0.5, tree(u * (0.05 + 0.08 * v)), 5);
                if (i === n - 1) tufts(s, many(8), a);
            }
        } else if (biome === 'desert') {
            // mesa country, a sea of dunes, or arches and hoodoos
            const kind = rng.weighted([[4, 'mesas'], [2.5, 'dunes'], [2, 'arches']]), sand = rng.pick([GOLD, GOLD, BROWN, WARM]);
            if (kind !== 'dunes' && rng.chance(0.7)) { const s = layer(tableland(rng, xa, xb, hz, h * rng.range(0.05, 0.1)), 20); s.fills.push([fill([s.top.concat([[xb, hz + h * 0.1], [xa, hz + h * 0.1]])], g * 1.5, 0), rng.pick([GOLD, WARM, VIOLET])]); }
            if (kind === 'dunes') {
                if (rng.chance(0.6)) distant(hz, h * rng.range(0.04, 0.08));
                const n = clamp(Math.round(h / u * 1.4), 2, 5) + (tall ? 1 : 0);
                for (let i = 0; i < n; i++) {
                    const v = (i + 1) / n, d = layer(dunes(rng, xa, xb, lerp(hz + h * 0.04, yb - h * 0.02, v), h * lerp(0.05, 0.14, v), Math.max(0.5, h / 80)), 21 + i * 2);
                    const ps = patches(rng, d.top, L, 0.95);
                    if (ps.length) d.fills.push([fill(ps, g * (i % 2 ? 0.9 : 1.2), ang + (i % 2) * 0.3), i % 2 ? INK : sand]);
                    if (i === n - 1) props(d.top, 21 + i * 2, many(0.8), h * 0.04, (x, y, z) => rng.chance(0.5) ? cactus(E, rng, x, y, u * rng.range(0.12, 0.22), z, green) : boulder(E, rng, x, y, u * rng.range(0.025, 0.05), z, BROWN), 2);
                }
            } else {
                flat(hz, 21, rng.pick([BROWN, GOLD]), 0.55);
                for (let k = 0, n = Math.max(1, Math.round(w / (h * 0.6) * rng.range(0.6, 1.2) * (kind === 'arches' ? 1.6 : 1))); k < n; k++) {
                    const base = hz + h * rng.range(0.02, 0.16), size = Math.min(h * rng.range(0.14, 0.32), pw * 0.45), x = x0 + w * rng.range(0.05, 0.95), z = 22 + (base - hz) / h;
                    if (kind === 'mesas') add(rng.chance(0.15) ? arch(E, rng, x, base, size * rng.range(0.8, 1.3), size, z) : mesa(E, rng, x, base, size * rng.range(0.5, 2.4), size, z));
                    else add(k === 0 || rng.chance(0.3) ? arch(E, rng, x, base, size * rng.range(0.8, 1.3), size * 1.1, z) : mesa(E, rng, x, base, size * rng.range(0.18, 0.35), size * rng.range(0.8, 1.3), z));
                }
                const d = layer(dunes(rng, xa, xb, yb - h * (tall ? 0.08 : 0.02), h * rng.range(0.08, 0.13), Math.max(0.5, h / 60)), 26);
                const ps = patches(rng, d.top, L, 0.9);
                if (ps.length) d.fills.push([fill(ps, g, ang), sand]);
                props(d.top, 26, many(1.8), h * 0.04, (x, y, z) => rng.chance(0.65) ? cactus(E, rng, x, y, u * rng.range(0.12, 0.24), z, green) : boulder(E, rng, x, y, u * rng.range(0.025, 0.05), z, BROWN), 3);
            }
        } else if (biome === 'moon') {
            if (rng.chance(0.55)) rising(E.cast.planets[1], 15);
            range(hz, h * rng.range(0.06, 0.12), 20);
            const plain = flat(hz + h * 0.05, 22, INK, 0.3);
            for (let k = 0, n = Math.min(40, many(3)); k < n; k++) {
                const v = rng.random() ** 0.7, y = lerp(hz + h * 0.08, yb - h * 0.03, v);
                add(crater(E, rng, x0 + w * rng.range(0.03, 0.97), y, u * lerp(0.03, 0.12, v) * rng.range(0.6, 1.3), 22.3 + v));
            }
            const outpost = rng.weighted([[2, 'domes'], [1.2, 'city'], [2, 'none']]);
            if (outpost === 'city') add(city(E, rng, x0 + w * rng.range(0.3, 0.7), hz + h * 0.055, Math.min(w * 0.5, pw * 0.8) * rng.range(0.6, 1), h * rng.range(0.18, 0.3), 21.5, u));
            if (outpost === 'domes') {
                const bx = x0 + w * rng.range(0.2, 0.8), by = hz + h * rng.range(0.1, 0.22), r = u * rng.range(0.08, 0.13), s = rng.sign();
                add(dome(E, rng, bx, by, r, 23.5, CYAN));
                if (rng.chance(0.7)) add(dome(E, rng, bx + s * r * 1.5, by + r * 0.15, r * 0.6, 23.6, CYAN));
                add(mast(E, bx - s * r * 1.5, by - r * 0.05, r * 2, 23.4));
            }
            props(plain.top, 24, many(1), h * 0.3, (x, y, z) => boulder(E, rng, x, y, u * rng.range(0.03, 0.07), z, INK), 3);
        } else {
            if (rng.chance(0.3)) volcano(hz + h * 0.02, h * rng.range(0.14, 0.22), 20);
            else distant(hz, h * rng.range(0.06, 0.12));
            flat(hz + h * 0.04, 22, rng.pick([CYAN, VIOLET]), 0.45);
            if (rng.chance(0.35)) add(city(E, rng, x0 + w * rng.range(0.25, 0.75), hz + h * 0.045, Math.min(w * 0.5, pw * 0.8) * rng.range(0.6, 1), h * rng.range(0.2, 0.34), 21.5, u));
            for (let c = 0, n = Math.max(1, Math.round(w / h * rng.range(0.5, 1))); c < n; c++) {
                const cx = x0 + w * rng.range(0.1, 0.9), cy = hz + h * rng.range(0.06, 0.16), size = Math.min(h * rng.range(0.15, 0.3), pw * 0.5);
                const list = Array.from({ length: rng.int(3, 6) }, () => [cx + rng.range(-1, 1) * size * 0.35, cy + rng.range(0, 1) * h * 0.03, size * rng.range(0.4, 1)]).sort((a, b) => a[1] - b[1] || b[2] - a[2]);
                list.forEach(([x, y, s], k) => add(crystal(E, rng, x, y, s, 23 + c * 0.2 + k * 0.02, CYAN)));
            }
            const s = hill(yb - h * 0.02, h * rng.range(0.07, 0.13), 26, rng.pick([VIOLET, CYAN, green]));
            props(s.pts, 26, many(1.8), h * 0.06, (x, y, z) => mushroom(E, rng, x, y, u * rng.range(0.1, 0.2), z, rng.pick([WARM, VIOLET, GOLD])), 3);
            tufts(s, many(6), h * 0.08);
        }
        // Big panels get a slope rising into one corner, right up front, with bigger props on it
        if (big && rng.chance(0.6)) {
            const edge = rng.chance(0.5) ? x0 : x0 + w, reach = w * rng.range(0.3, 0.55), rise = h * rng.range(0.14, 0.24), pts = [];
            for (let x = xa; x <= xb + 0.5; x += Math.max(0.6, w / 300)) {
                const v = clamp(1 - Math.abs(x - edge) / reach, 0, 1);
                pts.push([x, yb + 2 - (rise + 2) * geo.smoothstep(0, 1, v) * (1 + 0.04 * Math.sin(x * 0.7))]);
            }
            const s = layer(pts, 36), ps = patches(rng, pts, L, 1);
            if (ps.length) s.fills.push([fill(ps, g, ang), green]);
            const near = pts.filter(q => q[1] < yb - rise * 0.3);
            if (near.length > 2) props(pts, 36, Math.round(many(1.5) * reach / w * 2) + 1, rise * 0.3,
                biome === 'desert' ? (x, y, z) => cactus(E, rng, x, y, u * rng.range(0.25, 0.4), z, green) : biome === 'alien' ? (x, y, z) => crystal(E, rng, x, y, u * rng.range(0.2, 0.4), z, CYAN)
                    : biome === 'moon' ? (x, y, z) => boulder(E, rng, x, y, u * rng.range(0.06, 0.12), z, INK) : tree(u * rng.range(0.2, 0.3), biome === 'snow' ? 'pine' : 'round'), 3,
                Math.max(x0 + 1, near[0][0]), Math.min(x0 + w - 1, near[near.length - 1][0]));
        }
        // a saucer crossing a shared panorama left to right, either arriving and beaming down
        // in the last panel or beaming in the first and flying off
        const flight = count > 1 && E.p.visitors && rng.chance(0.35) ? rng.sign() : 0;
        const skyline = D => {
            let y = -Infinity;
            if (!far) return D.Y + D.H;
            for (const [x, v] of far) if (x >= D.X - 1 && x <= D.X + D.W + 1 && v > y) y = v;
            return Math.max(y, heightAt(far, D.X), heightAt(far, D.X + D.W));
        };

        const local = (D, prng, e) => {
            const phase = biome === 'moon' ? 'night' : phaseOf(e), dm = Math.min(D.W, D.H), bottom = skyline(D);
            const sun = phase === 'night' ? null : sunAt(prng, D, hz, e, Math.min(dm, h));
            const st = skyStyle(E, prng, phase, sun), avoid = sun ? [[sun[0], sun[1], sun[2] * 1.4]] : [];
            sky(E, prng, D, st, sun, bottom, hz);
            if (sun) sunDisc(E, D, sun, phase === 'set' && prng.chance(0.6));
            stars(E, prng, D, bottom, E.p.stars * (biome === 'moon' ? 1.4 : phase === 'night' ? 1 : phase === 'set' ? 0.25 : 0.08), avoid);
            if (phase === 'night' && (biome === 'snow' || biome === 'peaks') && prng.chance(0.3)) aurora(E, prng, D, hz);
            if (E.p.story === 'approach') featured(E, prng, D, t, hz, avoid, sun);
            scatter(E, prng, D, prng.int(phase === 'night' ? 1 : 0, phase === 'night' ? 3 : 1), hz - h * 0.08, avoid, 3, [0.03, 0.07], sun);
            if (phase === 'night' && prng.chance(0.25)) shootingStar(D, prng, D.X, D.Y, D.W, hz - D.Y);
            // the moon has no air, so no weather at all
            const airless = biome === 'moon', weather = !airless && prng.chance(0.6) ? prng.int(1, big ? 4 : 3) : 0;
            const made = clouds(E, prng, D, weather, D.Y + (hz - D.Y) * 0.08, hz - (hz - D.Y) * 0.3, 10, Math.min(dm, u * 1.6));
            if (made.length > 1 && phase !== 'day' && prng.chance(0.35)) { const [x, y] = prng.pick(made); bolt(E, prng, D, x, y, hz + h * 0.02, 19.5); }
            // cloud banks sitting on the far horizon, or caught between the ranges
            if (!airless && prng.chance(0.25)) clouds(E, prng, D, prng.int(1, 2), hz - h * 0.2, hz - h * 0.04, 19, dm * 0.8);
            if (biome === 'peaks' && prng.chance(0.3)) clouds(E, prng, D, 1, hz - h * 0.2, hz, 22.5, dm * 0.7);
            if (water) {
                // ripples: sun colored under the sun, ink inside the range's reflection, the rest cool
                const segs = [], n = clamp(Math.round((D.Y + D.H - water.y) / (g * 2.2)), 3, 80);
                for (let k = 1; k <= n; k++) dashes(prng, D.X - 1, D.X + D.W + 1, water.y + (D.Y + D.H - water.y) * Math.pow(k / (n + 0.4), 1.5), 0.7, 3 + 9 * k / n, segs);
                for (const [[x0, y], [x1]] of segs) {
                    let from = x0, role = null;
                    for (let x = x0; ; x = Math.min(x1, x + 0.8)) {
                        const glow = sun && Math.abs(x - sun[0]) < sun[2] * (0.7 + 1.6 * (y - water.y) / h);
                        const rr = glow ? E.cast.sun : (y - water.y) < (water.y - heightAt(water.ridge, x)) * 0.45 ? INK : COOL;
                        if (role !== null && rr !== role) { D.line([[from, y], [x, y]], water.z + 0.01, role); from = x; }
                        role = rr;
                        if (x >= x1) break;
                    }
                    if (x1 > from) D.line([[from, y], [x1, y]], water.z + 0.01, role);
                }
            }
            if (flight) {
                const u = (D.X + D.W / 2 - x0) / w, v = flight > 0 ? u : 1 - u, x = D.X + D.W * prng.range(0.35, 0.65), beam = flight > 0 ? D.X + D.W > x0 + w - 1 : D.X < x0 + 1;
                saucer(E, prng, D, x, y0 + (hz - y0) * lerp(0.15, 0.5, v), Math.min(dm, h) * 0.12, 34, beam ? Math.min(D.Y + D.H, heightAt(far, x) + h * 0.15) : 0, beam ? 0 : 1);
            } else if (E.visit(prng, D)) {
                const kind = prng.weighted([[3, 'saucer'], [1.5, 'rocket'], [2, 'comet']]);
                if (kind === 'saucer') {
                    const x = D.X + D.W * prng.range(0.25, 0.75), y = D.Y + (hz - D.Y) * prng.range(0.25, 0.6);
                    saucer(E, prng, D, x, y, dm * prng.range(0.1, 0.16), 34, prng.chance(0.6) ? Math.min(D.Y + D.H, heightAt(far, x) + h * 0.15) : 0);
                } else if (kind === 'rocket') rocket(E, prng, D, D.X + D.W * prng.range(0.3, 0.7), D.Y + (hz - D.Y) * prng.range(0.5, 0.9), dm * prng.range(0.14, 0.22), prng.range(-0.5, 0.5), 34);
                else comet(E, prng, D, D.X + D.W * prng.range(0.2, 0.8), D.Y + (hz - D.Y) * prng.range(0.15, 0.45), dm * prng.range(0.25, 0.45), [prng.sign() * 0.8, -0.6], 9);
            }
        };
        return { shared, local };
    }

    function cloudscape(E, R, t) {
        const [, , w, h] = R;
        return {
            shared: [], local: (D, prng, e) => {
                const phase = e > -0.15 ? phaseOf(Math.max(e, 0.2)) : 'night', m = Math.min(w, h);
                const sun = phase === 'night' ? null : [D.X + D.W * prng.range(0.2, 0.8), D.Y + D.H * prng.range(0.15, 0.45), m * prng.range(0.08, 0.14)];
                const st = skyStyle(E, prng, phase, sun), avoid = sun ? [[sun[0], sun[1], sun[2] * 1.4]] : [];
                if (st.style === 'bands') st.style = 'rays';
                sky(E, prng, D, st, sun, D.Y + D.H, D.Y + D.H);
                if (sun) sunDisc(E, D, sun, false);
                stars(E, prng, D, D.Y + D.H, E.p.stars * (phase === 'night' ? 0.8 : 0.1), avoid);
                if (E.p.story === 'approach') featured(E, prng, D, t, D.Y + D.H * 0.7, avoid, sun);
                const rows = prng.int(2, 4);
                for (let k = 0; k < rows; k++) {
                    const y = D.Y + D.H * lerp(0.22, 0.95, k / (rows - 1));
                    clouds(E, prng, D, prng.int(1, Math.max(1, Math.round(w / h * 2))), y - h * 0.08, y, 10 + k * 2, m * (0.9 + k * 0.25));
                    if (k < rows - 1) scatter(E, prng, D, prng.int(0, 1), y, avoid, 11 + k * 2, [0.04, 0.1], sun);
                }
                if (prng.chance(0.4)) { const c = cloud(E, prng, D.X + D.W / 2, D.Y + D.H + h * 0.05, D.W * 1.5, h * 0.25, 20); if (c) draw(D, c); }
                if (E.visit(prng, D)) saucer(E, prng, D, D.X + D.W * prng.range(0.25, 0.75), D.Y + D.H * prng.range(0.3, 0.6), m * 0.12, 15, 0);
            },
        };
    }
    function space(E, t, kind) {
        return {
            shared: [], local: (D, prng) => {
                const m = Math.min(D.W, D.H), avoid = [];
                if (prng.chance(0.2)) sky(E, prng, D, { style: 'hatch', role: prng.pick([VIOLET, COOL]), angle: prng.pick([PI / 4, -PI / 4]), k: 3.2 }, null, D.Y + D.H, 0);
                if (kind === 'giant') {
                    const pl = E.p.story === 'approach' ? E.cast.planets[0] : prng.pick(E.cast.planets), r = m * prng.range(0.26, 0.4);
                    const x = D.X + D.W * prng.range(0.35, 0.65), y = D.Y + D.H * prng.range(0.4, 0.6);
                    avoid.push([x, y, r * (pl.ring ? pl.outer : 1.1)]);
                    for (const s of planet(E, pl, x, y, r, 8, E.lightVec)) draw(D, s);
                    scatter(E, prng, D, prng.int(1, 3), D.Y + D.H, avoid, 3, [0.025, 0.06], null);
                } else if (kind === 'orbit') {
                    // the curve of a planet from above, with the sun coming up over its rim
                    const R0 = Math.max(D.W, D.H) * prng.range(0.9, 1.5), cx = D.X + D.W * prng.range(0.3, 0.7), cy = D.Y + D.H * prng.range(0.72, 0.85) + R0;
                    const body = geo.ngon(cx, cy, R0, clamp(Math.ceil(R0 * 1.5), 90, 400));
                    D.face(body, 12); D.line(geo.close(body), 12.01, INK);
                    // a thin glowing atmosphere that the sun's rays stop at
                    const halo = E.gap * 5.5, win = PG.shapes.rect(D.X - 1, D.Y - 1, D.X + D.W + 1, D.Y + D.H + 1);
                    D.face(geo.ngon(cx, cy, R0 + halo, clamp(Math.ceil(R0 * 1.5), 90, 400)), 11);
                    for (let k = 1; k <= 3; k++) for (const q of PG.clipPaths([geo.circle(cx, cy, R0 + halo * k / 3)], win)) D.line(q, 11.01, COOL);
                    const a = -PI / 2 + prng.range(-0.25, 0.25), sun = [cx + Math.cos(a) * (R0 + halo * 0.5), cy + Math.sin(a) * (R0 + halo * 0.5), m * 0.07];
                    sky(E, prng, D, { style: 'rays', alt: true }, sun, D.Y + D.H, 0);
                    sunDisc(E, D, sun, false, 11.5); avoid.push([sun[0], sun[1], sun[2] * 1.5]);
                    // night side as a crescent: the body minus a copy of itself nudged toward the sun
                    const side = prng.sign(), lit = shift(body, side * Math.max(D.W * prng.range(0.3, 0.6), R0 * 0.25), -m * 0.08);
                    for (const q of fill([body], E.gap * 0.85, 0.5, [lit])) D.line(q, 12.005, INK);
                    for (const q of PG.clipPaths([geo.close(lit)], PG.shapes.polygon(body))) D.line(q, 12.01, INK);
                    for (let k = 1; k <= 5; k++) {
                        const rr = R0 - k * k * m * 0.012;
                        for (const q of dashes(prng, cx - R0, cx + R0, 0, 0.6, m * 0.25)) {
                            const a0 = -PI / 2 + (q[0][0] - cx) / R0, a1 = -PI / 2 + (q[1][0] - cx) / R0;
                            D.line(geo.arc(cx, cy, rr, a0, a1), 12.01, prng.pick([VIOLET, CYAN, GREEN]));
                        }
                    }
                    scatter(E, prng, D, prng.int(0, 1), D.Y + D.H * 0.55, avoid, 3, [0.04, 0.08], sun);
                    if (E.visit(prng, D)) rocket(E, prng, D, D.X + D.W * prng.range(0.2, 0.8), D.Y + D.H * prng.range(0.3, 0.5), m * 0.16, prng.range(-1.2, 1.2), 20);
                } else {
                    const tallish = D.H > D.W * 1.3;
                    if (E.p.story === 'approach') featured(E, prng, D, t, D.Y + D.H, avoid, null);
                    if (prng.chance(0.3)) {
                        // an asteroid belt across the panel, big rocks in front
                        const n = clamp(Math.round(D.W * D.H / 90), 8, 70), a = prng.range(-0.6, 0.6), c = Math.cos(a), sn = Math.sin(a), rocks = [];
                        for (let k = 0; k < n; k++) {
                            const u = prng.range(-0.6, 0.6) * Math.hypot(D.W, D.H), v = prng.gauss(0, D.H * 0.1), r = m * 0.07 * prng.random() ** 2.5 + 0.8;
                            const x = D.X + D.W / 2 + u * c - v * sn, y = D.Y + D.H / 2 + u * sn + v * c;
                            if (x > D.X - r && x < D.X + D.W + r && y > D.Y - r && y < D.Y + D.H + r && !avoid.some(([p, q, rr]) => Math.hypot(x - p, y - q) < rr + r)) rocks.push([x, y, r]);
                        }
                        rocks.sort((p, q) => p[2] - q[2]).forEach(([x, y, r], k) => { draw(D, rock(E, prng, x, y, r, 4 + k * 0.01)); avoid.push([x, y, r]); });
                    }
                    scatter(E, prng, D, prng.int(tallish ? 2 : 1, tallish ? 4 : 3), D.Y + D.H, avoid, 3, [0.04, 0.12], null);
                    const cx = D.X + D.W * prng.range(0.2, 0.8), cy = D.Y + D.H * prng.range(0.2, 0.8), size = m * prng.range(0.25, 0.4);
                    if ((E.visit(prng, D) || prng.chance(0.2)) && !avoid.some(([x, y, r]) => Math.hypot(cx - x, cy - y) < r + size)) comet(E, prng, D, cx, cy, size, [prng.sign(), prng.range(-0.6, 0.6)], 7);
                }
                stars(E, prng, D, D.Y + D.H, E.p.stars * 1.3, avoid);
            },
        };
    }

    function makeCast(rng) {
        const accents = rng.shuffle([COOL, WARM, VIOLET, CYAN, GOLD, GREEN]);
        const planets = [0, 1, 2].map(i => {
            // bands as pairs of latitudes (radians), spread from south to north
            const bands = [], n = rng.chance(i === 1 ? 0.85 : 0.45) ? rng.int(2, 4) : 0;
            for (let k = 0; k < n; k++) {
                const c = lerp(-0.95, 0.95, (k + 0.5) / n) + rng.range(-0.12, 0.12), w = rng.range(0.1, 0.28);
                bands.push(c - w / 2, c + w / 2);
            }
            return {
                ring: i === 0 || rng.chance(0.3), bands,
                // never exactly half, so the terminator is always a curve
                phase: rng.pick([0.25, -0.3, -0.45, -0.6]), tilt: rng.range(-0.5, 0.5), flat: rng.range(0.18, 0.34), inner: rng.range(1.3, 1.45), outer: rng.range(1.75, 2.2),
                shade: i === 0 ? INK : accents[i], band: accents[(i + 2) % 6], ringRole: accents[(i + 3) % 6], shadeGap: rng.range(0.7, 0.95), shadeAngle: rng.pick([PI / 4, -PI / 4, PI / 3, 0.2]),
            };
        });
        return { planets, sun: rng.pick([WARM, WARM, GOLD]) };
    }

    PG.register({
        id: 'cosmic', name: 'Cosmic Comics', category: 'Scenes', fit: false,
        description: 'Comic pages of alien worlds: faceted mountains, lakes, deserts and cloud banks under sunbursts, ringed planets and starfields, with a little story running across the panels.',
        params: [
            { type: 'section', label: 'Page' },
            { id: 'layout', label: 'Layout', type: 'select', value: 'story', random: ['story', 'story', 'story', 'grid', 'single'], options: [['story', 'Comic page'], ['grid', 'Contact sheet'], ['single', 'One postcard']] },
            { id: 'panels', label: 'Panels', type: 'range', min: 3, max: 40, step: 1, value: 14, random: [7, 24], show: p => p.layout === 'story' },
            { id: 'cols', label: 'Columns', type: 'range', min: 2, max: 5, step: 1, value: 3, random: [2, 4], show: p => p.layout === 'grid' },
            { id: 'rows', label: 'Rows', type: 'range', min: 2, max: 8, step: 1, value: 4, random: [2, 6], show: p => p.layout === 'grid' },
            { id: 'gutter', label: 'Gutter (mm)', type: 'range', min: 1, max: 8, step: 0.5, value: 3, random: [2, 4.5], show: p => p.layout !== 'single' },
            { id: 'frame', label: 'Panel frames', type: 'select', value: 'bold', random: ['bold', 'bold', 'thin'], options: [['bold', 'Bold'], ['thin', 'Thin'], ['none', 'None']] },
            { type: 'section', label: 'Worlds' },
            { id: 'world', label: 'Worlds', type: 'select', value: 'journey', random: true, options: [['journey', 'A journey'], ['peaks', 'Mountain worlds'], ['desert', 'Desert planets'], ['skies', 'Cloud worlds'], ['space', 'Deep space']] },
            { id: 'story', label: 'Story', type: 'select', value: 'dusk', random: true, options: [['dusk', 'Day into night'], ['dawn', 'Night into day'], ['approach', 'Planet approach'], ['free', 'Anything goes']] },
            { id: 'detail', label: 'Scenery', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6, random: [0.35, 0.9], hint: 'Trees, rocks, cacti and other props.' },
            { id: 'stars', label: 'Star density', type: 'range', min: 0, max: 2, step: 0.1, value: 1, random: [0.5, 1.5] },
            { id: 'visitors', label: 'Visitors', type: 'checkbox', value: true, random: 0.75, hint: 'The odd saucer, rocket or comet.' },
            { id: 'spacing', label: 'Hatch spacing (mm)', type: 'range', min: 0.35, max: 2, step: 0.05, value: 0.75, random: [0.6, 1] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        // Mostly comic pages, leaning toward the journey and the day running out
        randomize(rng) {
            return {
                layout: rng.weighted([[6, 'story'], [1.3, 'grid'], [1.2, 'single']]),
                panels: rng.weighted([[1, rng.int(6, 10)], [2.5, rng.int(10, 18)], [1, rng.int(18, 26)]]),
                world: rng.weighted([[3, 'journey'], [2, 'peaks'], [1.5, 'desert'], [1.2, 'skies'], [1, 'space']]),
                story: rng.weighted([[3, 'dusk'], [2, 'dawn'], [1.2, 'approach'], [1.5, 'free']]),
                frame: rng.weighted([[4, 'bold'], [2, 'thin'], [0.2, 'none']]),
            };
        },
        generate(p, ctx) {
            const { width: W, height: H, seed } = ctx, pens = PG.pens.count(p.pens), layers = PG.pens.layers(pens);
            const { rects, gap } = layout(p, W, H, rngOf(seed, 1)), n = rects.length, crng = rngOf(seed, 2);
            const E = { p, gap: p.spacing, light: crng.sign(), cast: makeCast(crng), starRoles: [COOL, WARM, GOLD, CYAN] };
            const ll = Math.hypot(1, 0.75);
            E.lightVec = [-E.light / ll, -0.75 / ll];
            E.cloudAngle = crng.pick([-0.95, -0.7, 0.8]) * E.light;
            E.run = { fam: null, n: 0 };
            // the approaching planet only turns up through featured()
            E.pool = p.story === 'approach' ? E.cast.planets.slice(1) : E.cast.planets;
            // The biggest panel gets a feature scene when it clearly stands out
            const areas = rects.map(r => r[2] * r[3]), median = areas.slice().sort((a, b) => a - b)[n >> 1];
            const hero = n === 1 || areas.some(a => a > median * 1.55) ? areas.indexOf(Math.max(...areas)) : -1;
            // Visitors: a couple per page at most
            let visits = p.visitors ? 1 + (n > 10) + (n > 25) : 0;
            E.visit = (rng, D) => visits > 0 && Math.min(D.W, D.H) > 18 && rng.chance(Math.min(0.35, 2.5 / n + 0.05)) && visits-- > 0;
            const time = Array.from({ length: n }, (_, i) => n > 1 ? i / (n - 1) : 0.5);
            const elev = time.map(t => p.story === 'dusk' ? 1.05 - 1.5 * t + crng.range(-0.08, 0.08) : p.story === 'dawn' ? 1.05 - 1.5 * (1 - t) + crng.range(-0.08, 0.08) : crng.range(-0.55, 1));
            // A journey opens in the mountains (mostly ink linework) and the rest follows in any order
            const chapters = [crng.pick(['peaks', 'lake', 'snow'])];
            chapters.push(...crng.shuffle(['peaks', 'lake', 'hills', 'desert', 'snow', 'alien', 'moon'].filter(c => c !== chapters[0])).slice(0, 1 + (n > 8) + (n > 16)));
            // The airless moon is always dark, so it goes where the story reaches night
            if (chapters.includes('moon') && p.story !== 'free') { chapters.splice(chapters.indexOf('moon'), 1); if (p.story === 'dawn') chapters.unshift('moon'); else chapters.push('moon'); }
            // Neighbours in one tier can share a landscape, like one view cut into panels
            const groups = [], grng = rngOf(seed, 3);
            const same = (a, b) => Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[3] - b[3]) < 1e-6 && Math.abs(b[0] - a[0] - a[2] - gap) < 1e-6;
            for (let i = 0; i < n;) {
                let j = i + 1;
                while (p.layout === 'story' && j < n && j - i < 4 && same(rects[j - 1], rects[j])) j++;
                if (j - i > 1 && grng.chance(0.5)) { groups.push(Array.from({ length: j - i }, (_, k) => i + k)); i = j; }
                else groups.push([i++]);
            }
            let prev = null;
            groups.forEach((grp, gi) => {
                const rng = rngOf(seed, 4, gi), first = rects[grp[0]], lastR = rects[grp[grp.length - 1]], i = grp[0];
                const R = [first[0], first[1], lastR[0] + lastR[2] - first[0], first[3]], pw = R[2] / grp.length - gap;
                let kind = 'land';
                if (grp.length === 1) {
                    const w = { journey: [6, 1.2, 0.9, 0.5, 0.4], peaks: [8, 1, 0.5, 0.4, 0.2], desert: [8, 0.4, 0.8, 0.6, 0.4], skies: [2, 6, 0.8, 1, 0.3], space: [1.5, 0, 4, 2.5, 2] }[p.world].slice();
                    const aspect = first[2] / first[3], names = ['land', 'clouds', 'space', 'giant', 'orbit'];
                    if (aspect < 0.62) { w[2] *= 2; w[3] *= 1.3; }
                    if (aspect > 2) { w[0] *= 1.6; w[3] *= 0.3; w[4] *= 0.5; }
                    if (Math.min(first[2], first[3]) < 20) w[4] = 0;
                    if (prev && prev !== 'land') w[names.indexOf(prev)] *= 0.3;
                    if (i === hero) { w[0] *= 4; w[1] *= 0.5; w[2] = 0; }
                    if (p.story === 'approach') w[3] = 0;
                    kind = rng.weighted(names.map((k, q) => [w[q], k]));
                    if (p.story === 'approach' && n > 2 && i === n - 1) kind = 'giant';
                }
                prev = kind;
                const biome = p.world === 'journey' ? chapters[Math.min(chapters.length - 1, Math.floor(time[i] * chapters.length))] : rng.weighted(BIOMES[p.world]);
                const scene = kind === 'land' ? land(E, rng, R, biome, pw, time[i], grp.includes(hero), grp.length) : kind === 'clouds' ? cloudscape(E, R, time[i]) : space(E, time[i], kind);
                for (const idx of grp) {
                    const [X, Y, w, h] = rects[idx], D = canvas(X, Y, w, h);
                    for (const s of scene.shared) draw(D, s);
                    scene.local(D, rngOf(seed, 5, idx), elev[idx]);
                    const f = p.frame === 'bold' ? 0.4 : 0, inner = PG.shapes.rect(f, f, w - f, h - f);
                    PG.iso.render(D.S).forEach((paths, role) => {
                        const into = layers[penOf(role, pens)];
                        for (const q of PG.clipPaths(paths, inner)) into.push(q.map(([u, v]) => [u + X, v + Y]));
                    });
                    if (p.frame !== 'none') layers[0].push(geo.close([[X, Y], [X + w, Y], [X + w, Y + h], [X, Y + h]]));
                    if (p.frame === 'bold') layers[0].push(geo.close([[X + f, Y + f], [X + w - f, Y + f], [X + w - f, Y + h - f], [X + f, Y + h - f]]));
                }
            });
            return { layers };
        },
    });
})();
