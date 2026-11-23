/*
 * Exploded View: an invented machine pulled apart along its axes, drawn like a
 * sheet from an old patent, with center lines, leader lines, and part numbers.
 *
 * A machine is a list of parts. Each has a place in the assembled machine, an
 * axis, and a slot in a chain of parts that slide apart along one direction.
 * Parts are built from two kinds of solid: turned ones (a section swept round
 * the part's axis, with any bore) and extruded ones (an outline pushed along
 * the axis, with any opening, like a gear or a casing).
 *
 * PG.iso.Scene removes the hidden lines, but it only knows flat convex faces.
 * So every solid hands it facets to hide things with, and works out its own
 * lines: which stretch of each rim faces the camera, and where a round surface
 * turns edge-on. Rims are drawn on the true circle and the facets sit just
 * inside it, so a part never hides its own outline.
 *
 * Small details are sized by what they come to on paper. Threads, teeth, ball
 * races, and drilled holes are left out or simplified when their lines would
 * land closer together than the pen.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { Scene, makeCamera } = PG.iso;
    const PI = Math.PI;

    // Line kinds. They are the parts in pens.js, in the same order.
    const BODY = 0, MOVING = 1, FASTEN = 2, SEAL = 3, SHADE = 4, CENTER = 5, LABEL = 6, TEXT = 7;

    const FINE = 0.55;   // mm. Lines of one part closer than this run together.
    const SPECK = 0.35;  // mm. Shorter bits of line that touch nothing else are dropped.

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const mad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const neg = a => [-a[0], -a[1], -a[2]];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const wrap = a => { a %= TAU; return a > PI ? a - TAU : a <= -PI ? a + TAU : a; };
    const viewDir = (yaw, elev) => { const t = geo.rad(yaw), e = geo.rad(elev); return [Math.sin(t) * Math.cos(e), Math.cos(t) * Math.cos(e), -Math.sin(e)]; };

    // ------------------------------------------------------------------
    // Drawing context: one scene and its camera
    // ------------------------------------------------------------------

    // k is mm of paper per unit of machine, (X0, Y0) is where the origin lands.
    // A dry context only collects lines, for measuring a drawing before it's placed.
    function context(yaw, elev, k, X0, Y0, W, H, dry) {
        // the camera centers the origin on half its page size
        const cam = makeCamera(yaw, elev, k, 2 * X0, 2 * Y0, 0, 0), S = new Scene(cam, W, H);
        const d = [cam.fx * cam.ce, cam.fy * cam.ce, -cam.se], sx = [cam.rx, cam.ry, 0], sy = cross(d, sx);
        return {
            S, cam, k, d, dry,
            // angle between points of a circle of radius r that keeps it round on paper
            step: r => geo.clamp(2 * Math.acos(1 - Math.min(0.5, 0.012 / Math.max(r * k, 0.02))), 0.03, 0.4),
            facets: r => Math.min(120, Math.max(12, 4 * Math.ceil(PI / Math.acos(1 - Math.min(0.5, 0.03 / Math.max(r * k, 0.05))) / 4))),
            kind(n) { const was = S.kind; S.kind = n; return was; },
            line(pts) { S.line(pts); },
            face: dry ? () => {} : pts => S.face(pts, false),
            flat(P) { const q = cam.project(P[0], P[1], P[2]); return [q[0], q[1]]; },
            // a circle that faces the camera, like the outline of a ball
            disc(C, r) {
                const n = Math.max(8, Math.ceil(TAU / this.step(r))), pts = [];
                for (let i = 0; i <= n; i++) { const a = TAU * i / n, u = r * Math.cos(a), v = r * Math.sin(a); pts.push([C[0] + u * sx[0] + v * sy[0], C[1] + u * sx[1] + v * sy[1], C[2] + u * sx[2] + v * sy[2]]); }
                return pts;
            },
            // is something in front of this point?
            hidden(P) {
                const q = cam.project(P[0], P[1], P[2]);
                for (const f of S.faces) {
                    if (q[0] < f.x0 || q[0] > f.x1 || q[1] < f.y0 || q[1] > f.y1 || f.dmin >= q[2] - 0.01) continue;
                    let inside = true;
                    for (let e = 0; e < f.ex.length; e++) if (f.ex[e] * q[0] + f.ey[e] * q[1] - f.ec[e] <= 0) { inside = false; break; }
                    if (inside && f.da * q[0] + f.db * q[1] + f.dc < q[2] - 0.01) return true;
                }
                return false;
            },
        };
    }

    // A part's frame: s runs along its axis a, x and y across it along e1 and e2.
    // R gives polar points with the angle measured from the side of the axis
    // nearest the camera, which is what the visibility of a round part hangs on.
    function frame(G, o, a, e1) {
        const e2 = cross(a, e1), da = dot(G.d, a), c = Math.sqrt(Math.max(1e-9, 1 - da * da));
        const d1 = dot(G.d, e1), d2 = dot(G.d, e2), phi0 = Math.atan2(-d2, -d1);
        const P = (s, x, y) => [o[0] + s * a[0] + x * e1[0] + y * e2[0], o[1] + s * a[1] + x * e1[1] + y * e2[1], o[2] + s * a[2] + x * e1[2] + y * e2[2]];
        return {
            o, a, e1, e2, da, c, d1, d2, phi0, P,
            R: (s, r, phi) => P(s, r * Math.cos(phi0 + phi), r * Math.sin(phi0 + phi)),
            // a frame on another axis through a point of this one
            turn: (s, x, y, a2, e) => frame(G, P(s, x, y), a2, e),
        };
    }

    // ------------------------------------------------------------------
    // Which way round surfaces face
    // ------------------------------------------------------------------

    // A surface swept round the axis, with its outward normal ns along the axis and
    // nr away from it, faces the camera within `half` of the angle `mid`.
    function facing(F, ns, nr) {
        const g = ns * F.da;
        if (Math.abs(nr) < 1e-9) return { mid: 0, half: g < 0 ? PI : 0 };
        const q = g / (nr * F.c);
        if (nr > 0) return { mid: 0, half: q >= 1 ? 0 : q <= -1 ? PI : Math.acos(q) };
        return { mid: PI, half: q >= 1 ? PI : q <= -1 ? 0 : PI - Math.acos(q) };
    }
    const within = (R, phi) => R.half >= PI - 1e-9 || (R.half > 1e-9 && Math.abs(wrap(phi - R.mid)) < R.half);
    // The stretches of a rim between two surfaces that show: where 'either' faces the
    // camera on an outside corner, where 'both' do on an inside one, and where just
    // 'one' does on a curve, which is where the curve turns out of sight
    function spans(A, B, mode) {
        const cuts = [];
        for (const R of [A, B]) if (R.half > 1e-9 && R.half < PI - 1e-9) cuts.push(wrap(R.mid - R.half), wrap(R.mid + R.half));
        const on = phi => { const a = within(A, phi), b = within(B, phi); return mode === 'both' ? a && b : mode === 'one' ? a !== b : a || b; };
        if (!cuts.length) return on(0.1234) ? [[-PI, PI]] : [];
        cuts.sort((u, v) => u - v);
        const out = [];
        for (let i = 0; i < cuts.length; i++) {
            const a0 = cuts[i], a1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + TAU;
            if (a1 - a0 < 1e-9 || !on((a0 + a1) / 2)) continue;
            const last = out[out.length - 1];
            if (last && Math.abs(last[1] - a0) < 1e-9) last[1] = a1;
            else out.push([a0, a1]);
        }
        // the first and last stretch can meet across the join
        if (out.length > 1 && Math.abs(out[out.length - 1][1] - TAU - out[0][0]) < 1e-9) out[0][0] = out.pop()[0] - TAU;
        return out;
    }

    function arc(G, F, s, r, a0, a1, slope = 0) {
        const n = Math.max(2, Math.ceil((a1 - a0) / G.step(r))), pts = [];
        for (let i = 0; i <= n; i++) { const phi = a0 + (a1 - a0) * i / n; pts.push(F.R(s + slope * phi, r, phi)); }
        G.line(pts);
    }

    // Rings round a part at the positions ss along it, each over its own spans of
    // angle and moved slope * phi along the axis at angle phi. Rings that are well
    // apart at the near side of a part close up towards its edge on paper, so there
    // they thin out: the end ones run all the way, and the rest drop out in turn
    // wherever they'd come closer than the pen to one that's still drawn.
    function rings(G, F, ss, r, spanList, slope = 0) {
        const n = ss.length, kk = G.k * F.c, order = n > 1 ? [0, n - 1] : [0];
        for (const q = [[0, n - 1]]; q.length;) {
            const [lo, hi] = q.shift();
            if (hi - lo < 2) continue;
            const mid = (lo + hi) >> 1;
            order.push(mid);
            q.push([lo, mid], [mid, hi]);
        }
        const on = (i, phi) => spanList[i].some(([u, v]) => phi >= u && phi <= v || phi - TAU >= u && phi - TAU <= v || phi + TAU >= u && phi + TAU <= v);
        const m = Math.max(24, Math.ceil(TAU / Math.min(0.05, G.step(r)))), h = TAU / m, keep = ss.map(() => new Uint8Array(m));
        for (let k = 0; k < m; k++) {
            const phi = -PI + (k + 0.5) * h, f = kk * Math.abs(Math.cos(phi)), kept = [];
            for (const i of order) if (on(i, phi) && kept.every(j => Math.abs(ss[i] - ss[j]) * f >= FINE)) { kept.push(i); keep[i][k] = 1; }
        }
        ss.forEach((s, i) => {
            const mask = keep[i], parts = [], z = mask.indexOf(0);
            if (z < 0) parts.push([-PI, PI]);
            else for (let t = z + 1, from = -1; t <= z + m; t++) {
                const set = t < z + m && mask[t % m];
                if (set && from < 0) from = t;
                if (!set && from >= 0) { parts.push([-PI + from * h, -PI + t * h]); from = -1; }
            }
            for (const [u, v] of parts) for (const [a, b] of spanList[i]) for (const w of [-TAU, 0, TAU]) {
                const lo = Math.max(u + w, a), hi = Math.min(v + w, b);
                if (hi - lo > 1e-6) arc(G, F, s, r, lo, hi, slope);
            }
        });
    }

    // ------------------------------------------------------------------
    // Turned solids
    // ------------------------------------------------------------------

    // A solid swept round the axis from its section, a closed polygon of [s, r, flag]
    // going round with the metal on the left. Flag 1 marks a point on a curve, which
    // gets no rim of its own.
    function turned(G, F, poly) {
        const n = poly.length, E = [];
        let rmax = 0;
        for (let i = 0; i < n; i++) {
            const p = poly[i], q = poly[(i + 1) % n], ds = q[0] - p[0], dr = q[1] - p[1], L = Math.hypot(ds, dr);
            rmax = Math.max(rmax, p[1]);
            // nothing is swept by a stretch along the axis
            if (L < 1e-9 || (p[1] < 1e-9 && q[1] < 1e-9)) { E.push(null); continue; }
            const ns = dr / L, nr = -ds / L;
            E.push({ ds, dr, ns, nr, R: facing(F, ns, nr) });
        }
        const prev = i => { for (let k = 1; k < n; k++) { const e = E[(i - k + n) % n]; if (e) return e; } return null; };
        if (!G.dry) {
            // Facets. A bore's go just outside the true surface and the rest just inside it.
            const nf = G.facets(rmax), w = TAU / nf, out = 1 / Math.cos(PI / nf) + 1e-4;
            const rings = poly.map((p, i) => {
                if (p[1] < 1e-9) return null;
                const a = prev(i), b = E[i] || prev(i + 1), f = (a && a.nr < -0.3) || (b && b.nr < -0.3) ? out : 1, ring = [];
                for (let j = 0; j <= nf; j++) ring.push(F.R(p[0], p[1] * f, -PI + (j + 0.5) * w));
                return ring;
            });
            for (let i = 0; i < n; i++) {
                const e = E[i];
                if (!e || e.R.half < 1e-9) continue;
                const j1 = (i + 1) % n, A = rings[i], B = rings[j1], all = e.R.half >= PI - 1e-9;
                if (all && Math.abs(e.nr) < 1e-9 && (!A || !B)) { G.face((A || B).slice(0, nf)); continue; }
                for (let j = 0; j < nf; j++) {
                    const p0 = -PI + (j + 0.5) * w;
                    if (!all && !within(e.R, p0) && !within(e.R, p0 + w / 2) && !within(e.R, p0 + w)) continue;
                    if (!A) G.face([F.P(poly[i][0], 0, 0), B[j], B[j + 1]]);
                    else if (!B) G.face([A[j], A[j + 1], F.P(poly[j1][0], 0, 0)]);
                    else G.face([A[j], A[j + 1], B[j + 1], B[j]]);
                }
            }
        }
        // Rims. A curve is swept as a row of cones, so its outline is a line down
        // each cone and a step round the rim between one cone and the next.
        const rims = [], kk = G.k * F.c, cover = new Set();
        for (let i = 0; i < n; i++) {
            const p = poly[i], a = prev(i), b = E[i] || prev(i + 1);
            if (p[1] < 1e-9 || !a || !b || a === b) continue;
            const turn = a.ds * b.dr - a.dr * b.ds;
            if (Math.abs(turn) < 1e-9 || (p[2] && turn < 0)) continue;
            const sp = spans(a.R, b.R, p[2] ? 'one' : turn < 0 ? 'both' : 'either');
            if (sp.length) rims.push({ s: p[0], r: p[1], sp });
        }
        // Rims of one radius close together, like the fins round a cylinder, thin out
        // towards its edge, and one line runs along the edge past all of them
        rims.sort((u, v) => u.r - v.r || u.s - v.s);
        for (let g = 0; g < rims.length;) {
            let h = g + 1;
            while (h < rims.length && rims[h].r - rims[g].r < 1e-6 && (rims[h].s - rims[h - 1].s) * kk < 3 * FINE) h++;
            const grp = rims.slice(g, h), r = rims[g].r, s0 = grp[0].s, s1 = grp[grp.length - 1].s;
            g = h;
            if (grp.length === 1) { for (const [a0, a1] of grp[0].sp) arc(G, F, s0, r, a0, a1); continue; }
            rings(G, F, grp.map(q => q.s), r, grp.map(q => q.sp));
            if (grp.length < 3) continue;
            let edge = false;
            for (let i = 0; i < n; i++) {
                const e = E[i], q = poly[(i + 1) % n];
                if (e && Math.abs(e.ns) < 1e-9 && e.nr > 0 && Math.abs(poly[i][1] - r) < 1e-6 && Math.min(poly[i][0], q[0]) >= s0 - 1e-9 && Math.max(poly[i][0], q[0]) <= s1 + 1e-9) { cover.add(i); edge = true; }
            }
            if (edge) for (const sgn of [-1, 1]) G.line([F.R(s0, r, sgn * PI / 2), F.R(s1, r, sgn * PI / 2)]);
        }
        // Outlines, where a surface turns edge-on. A straight bore never shows one.
        for (let i = 0; i < n; i++) {
            const e = E[i], j = (i + 1) % n;
            if (!e || cover.has(i) || Math.abs(e.nr) < 1e-9 || e.R.half < 1e-9 || e.R.half > PI - 1e-9 || (e.nr < 0 && !poly[i][2] && !poly[j][2])) continue;
            const b = e.R.mid ? PI - e.R.half : e.R.half;
            for (const sgn of [-1, 1]) G.line([F.R(poly[i][0], poly[i][1], sgn * b), F.R(poly[j][0], poly[j][1], sgn * b)]);
        }
    }

    // A ring too thin for its two faces to show apart: just the face nearer the camera
    function leaf(G, F, s0, s1, ro, ri) {
        const s = F.da < 0 ? s1 : s0, nf = G.facets(ro), w = TAU / nf, at = (r, j) => F.R(s, r, -PI + (j + 0.5) * w);
        arc(G, F, s, ro, -PI, PI);
        if (ri > 1e-9) arc(G, F, s, ri, -PI, PI);
        if (ri > 1e-9) for (let j = 0; j < nf; j++) G.face([at(ri, j), at(ri, j + 1), at(ro, j + 1), at(ro, j)]);
        else G.face(Array.from({ length: nf }, (_, j) => at(ro, j)));
    }
    const tooThin = (G, F, len) => len * G.k * F.c < FINE * 0.8;

    // A turned part from its outside, [s, r] pairs from back to front, and its bore:
    // a radius, or [s, r] pairs from back to front for a stepped or blind one
    function lathe(G, F, outer, bore) {
        const s0 = outer[0][0], s1 = outer[outer.length - 1][0];
        const inner = Array.isArray(bore) ? bore : bore > 0 ? [[s0, bore], [s1, bore]] : [[s0, 0], [s1, 0]];
        const poly = [];
        const push = p => {
            const q = poly[poly.length - 1];
            if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) poly.push(p);
        };
        if (inner[0][0] > s0 + 1e-9) push([s0, 0]);
        inner.forEach(push);
        if (inner[inner.length - 1][0] < s1 - 1e-9) push([s1, 0]);
        for (let i = outer.length - 1; i >= 0; i--) push(outer[i]);
        const a = poly[0], b = poly[poly.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) poly.pop();
        turned(G, F, poly);
    }

    // ------------------------------------------------------------------
    // Extruded solids
    // ------------------------------------------------------------------

    // Where a ray from c at each of the angles leaves a polygon that is star-shaped about c
    function rayHits(poly, c, angles) {
        const n = poly.length, th = poly.map(p => Math.atan2(p[1] - c[1], p[0] - c[0]));
        return angles.map(t => {
            const ux = Math.cos(t), uy = Math.sin(t);
            let best = null, bd = Infinity;
            for (let i = 0; i < n; i++) {
                const a = wrap(th[i] - t), b = wrap(th[(i + 1) % n] - t);
                // the edge spans the ray if its ends are either side of it, the short way round
                if (a > 1e-12 || b < -1e-12 || b - a > PI) continue;
                const p = poly[i], q = poly[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], den = ux * ey - uy * ex;
                if (Math.abs(den) < 1e-12) continue;
                const l = ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / den;
                if (l > 0 && l < bd) { bd = l; best = [c[0] + ux * l, c[1] + uy * l]; }
            }
            return best || poly[0];
        });
    }

    // An outline pushed along the axis from s0 to s1. `outer` is a polygon of
    // [x, y, flag] going anticlockwise, flag 1 for a point on a curve. o.inner is an
    // opening of the same kind, star-shaped about o.center like the outline, cut
    // right through or down to o.floor. o.pieces are convex polygons that make up
    // the end face when the outline isn't star-shaped. o.thin leaves out the edges
    // along the axis that would land too close to the last one drawn. Sheet too
    // thin for its two faces to show apart is drawn as its near face alone.
    function extrude(G, F, s0, s1, outer, o = {}) {
        const front = F.da < 0 ? s1 : s0, back = F.da < 0 ? s0 : s1, slim = Math.abs(s1 - s0) * G.k * F.c < FINE * 0.8;
        const inner = o.inner || null, c = o.center || [0, 0];
        const sideways = (poly, sign) => poly.map((p, i) => {
            const q = poly[(i + 1) % poly.length];
            return sign * ((q[1] - p[1]) * F.d1 - (q[0] - p[0]) * F.d2) < 0;
        });
        const at = (p, s) => F.P(s, p[0], p[1]);
        const walls = (poly, on, a, b) => poly.forEach((p, i) => { if (on[i]) G.face([at(p, a), at(poly[(i + 1) % poly.length], a), at(poly[(i + 1) % poly.length], b), at(p, b)]); });
        // the edges of the far end that stand in front of a wall, joined into runs
        const rim = (poly, on, s) => {
            const n = poly.length, start = on.indexOf(false);
            if (start < 0) { G.line(poly.concat([poly[0]]).map(p => at(p, s))); return; }
            let run = null;
            for (let k = 1; k <= n; k++) {
                const i = (start + k) % n;
                if (on[i]) { if (!run) run = [at(poly[i], s)]; run.push(at(poly[(i + 1) % n], s)); }
                else if (run) { G.line(run); run = null; }
            }
            if (run) G.line(run);
        };
        // the edges along the axis: at an outside corner if either wall shows, at an
        // inside one if both do, and on a curve where the surface turns edge-on
        const ribs = (poly, on, hole, a, b) => {
            const n = poly.length, list = [];
            for (let i = 0; i < n; i++) {
                const p = poly[i], q = poly[(i + n - 1) % n], r = poly[(i + 1) % n], f0 = on[(i + n - 1) % n], f1 = on[i];
                const turn = (p[0] - q[0]) * (r[1] - p[1]) - (p[1] - q[1]) * (r[0] - p[0]);
                const edge = f0 !== f1, curve = p[2] || Math.abs(turn) < 1e-9;
                if (curve ? !hole && edge : (turn > 0) !== hole ? f0 || f1 : f0 && f1) list.push([p, edge || curve ? 2 : turn > 0 ? 1 : 0]);
            }
            if (!o.thin || hole) { for (const [p] of list) G.line([at(p, a), at(p, b)]); return; }
            // Edges of the outline first, then outside corners, then inside ones. They
            // are parallel on paper, so one number places each across the part.
            const kept = [], u = G.flat(F.P(0, 0, 0)), v = G.flat(F.P(1, 0, 0)), l = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
            for (const rank of [2, 1, 0]) for (const [p, r] of list) {
                if (r !== rank) continue;
                const q = G.flat(at(p, a)), t = ((q[0] - u[0]) * (v[1] - u[1]) - (q[1] - u[1]) * (v[0] - u[0])) / l;
                if (rank < 2 && kept.some(x => Math.abs(x - t) < FINE)) continue;
                kept.push(t);
                G.line([at(p, a), at(p, b)]);
            }
        };
        const on = sideways(outer, 1);
        G.line(outer.concat([outer[0]]).map(p => at(p, front)));
        if (!slim) {
            walls(outer, on, s0, s1);
            rim(outer, on, back);
            ribs(outer, on, false, s0, s1);
        }
        if (inner) {
            const deep = o.floor === undefined ? back : o.floor, in_ = sideways(inner, -1);
            G.line(inner.concat([inner[0]]).map(p => at(p, front)));
            if (!slim) {
                walls(inner, in_, front, deep);
                rim(inner, in_, deep);
                ribs(inner, in_, true, front, deep);
            }
            if (G.dry) return;
            // the end face between the two, as quads between rays from the center
            const angles = [...outer, ...inner].map(p => Math.atan2(p[1] - c[1], p[0] - c[0])).sort((u, v) => u - v);
            const th = [];
            for (let i = 0; i < angles.length; i++) {
                const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU;
                if (!th.length || a0 - th[th.length - 1] > 1e-7) th.push(a0);
                for (let m = Math.ceil((a1 - a0) / 1.2), k = 1; k < m; k++) th.push(a0 + (a1 - a0) * k / m);
            }
            const A = rayHits(outer, c, th), B = rayHits(inner, c, th);
            for (let i = 0; i < th.length; i++) {
                const j = (i + 1) % th.length;
                G.face([at(B[i], front), at(B[j], front), at(A[j], front), at(A[i], front)]);
            }
            if (o.floor !== undefined) for (let i = 0; i < inner.length; i++) G.face([at(c, deep), at(inner[i], deep), at(inner[(i + 1) % inner.length], deep)]);
        } else if (o.pieces) {
            for (const piece of o.pieces) G.face(piece.map(p => at(p, front)));
        } else if (o.center) {
            for (let i = 0; i < outer.length; i++) G.face([at(c, front), at(outer[i], front), at(outer[(i + 1) % outer.length], front)]);
        } else G.face(outer.map(p => at(p, front)));
    }

    // A box in a frame
    function block(G, F, s0, s1, x0, x1, y0, y1) {
        G.S.solid([F.P(s0, x0, y0), F.P(s0, x1, y0), F.P(s0, x1, y1), F.P(s0, x0, y1), F.P(s1, x0, y0), F.P(s1, x1, y0), F.P(s1, x1, y1), F.P(s1, x0, y1)], PG.iso.BOX);
    }

    // A round bar of radius w along a path. On paper its outline is the path moved
    // w to either side, wherever the bar isn't pointing straight at the camera.
    function tube(G, path, w, closed) {
        const n = path.length, d = G.d;
        if (w * G.k < 0.42) { G.line(closed ? path.concat([path[0]]) : path); return; }
        const idx = i => closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i));
        const T = path.map((p, i) => { const a = path[idx(i - 1)], b = path[idx(i + 1)]; return unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]); });
        const N = T.map(t => { const c = cross(t, d), l = Math.hypot(c[0], c[1], c[2]); return l < 0.06 ? null : [c[0] / l, c[1] / l, c[2] / l]; });
        const V = T.map((t, i) => N[i] && cross(t, N[i]));   // towards the camera
        const out = w * 1.012 + 0.0015, m = w * G.k > 1.6 ? 4 : 3, last = closed ? n : n - 1;
        for (const sgn of [-1, 1]) {
            let run = [];
            for (let k = 0; k <= last; k++) {
                const i = k % n;
                if (!N[i]) { if (run.length > 1) G.line(run); run = []; continue; }
                run.push(mad(path[i], N[i], sgn * out));
            }
            if (run.length > 1) G.line(run);
        }
        const at = (i, t) => { const c = w * Math.cos(t), s = w * Math.sin(t); return [path[i][0] + c * N[i][0] + s * V[i][0], path[i][1] + c * N[i][1] + s * V[i][1], path[i][2] + c * N[i][2] + s * V[i][2]]; };
        if (!G.dry) for (let k = 0; k < last; k++) {
            const i = k % n, j = (k + 1) % n;
            if (!N[i] || !N[j]) continue;
            for (let q = 0; q < m; q++) {
                const t0 = PI * q / m, t1 = PI * (q + 1) / m, a = at(i, t0), b = at(i, t1), c = at(j, t1), e = at(j, t0);
                G.face([a, b, c]);
                G.face([a, c, e]);
            }
        }
        if (closed) return;
        // the cut ends: all of one that faces the camera, the near half of one that doesn't
        for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
            if (!N[i]) continue;
            const seen = sign * dot(T[i], d) < 0, steps = Math.max(6, Math.ceil((seen ? TAU : PI) / G.step(w))), pts = [];
            for (let q = 0; q <= steps; q++) pts.push(at(i, (seen ? TAU : PI) * q / steps));
            G.line(pts);
            if (seen) G.face(pts.slice(0, -1));
        }
    }

    const ring = (r, n, rot = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(rot + TAU * i / n), r * Math.sin(rot + TAU * i / n), 1]);
    const ngon = (r, n, rot = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(rot + TAU * i / n), r * Math.sin(rot + TAU * i / n), 0]);
    // Mark the points of a sampled outline that sit on a corner
    function corners(poly, limit = 0.4) {
        const n = poly.length;
        return poly.map((p, i) => {
            const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
            const t = Math.abs(wrap(Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0])));
            return [p[0], p[1], t > limit ? 0 : 1];
        });
    }
    function roundRect(hx, hy, rad, n = 5) {
        const out = [];
        if (rad < 1e-6) return [[hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0], [-hx, -hy, 0]];
        [[hx - rad, -hy + rad, -PI / 2], [hx - rad, hy - rad, 0], [-hx + rad, hy - rad, PI / 2], [-hx + rad, -hy + rad, PI]].forEach(([cx, cy, a0]) => {
            for (let i = 0; i <= n; i++) out.push([cx + rad * Math.cos(a0 + PI / 2 * i / n), cy + rad * Math.sin(a0 + PI / 2 * i / n), 1]);
        });
        return out;
    }
    function gearOutline(teeth, root, tip, rot = 0) {
        const out = [], t = TAU / teeth;
        for (let i = 0; i < teeth; i++) {
            const a = rot + i * t;
            for (const [r, da] of [[root, -0.29], [tip, -0.15], [tip, 0.15], [root, 0.29]]) out.push([r * Math.cos(a + da * t), r * Math.sin(a + da * t), 0]);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Marks on parts
    // ------------------------------------------------------------------

    function capLoop(G, F, s, cx, cy, r, a0 = 0, a1 = TAU) {
        const n = Math.max(6, Math.ceil((a1 - a0) / G.step(r))), pts = [];
        for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(F.P(s, cx + r * Math.cos(a), cy + r * Math.sin(a))); }
        G.line(pts);
    }
    // A drilled hole in an end face the camera can see: its rim, and the far end of
    // it where that shows through
    function hole(G, F, s, x, y, h, depth) {
        const flat = Math.abs(F.da) * G.k;
        if (h * flat < 0.32) return;
        capLoop(G, F, s, x, y, h);
        const sig = depth * F.c / Math.abs(F.da), b = Math.acos(-Math.min(1, sig / (2 * h)));
        if (depth * F.c * G.k < FINE || (2 * h - sig) * flat < FINE) return;
        capLoop(G, F, s, x + sig * Math.cos(F.phi0), y + sig * Math.sin(F.phi0), h, F.phi0 + b, F.phi0 + TAU - b);
    }
    const holes = (G, F, s, pts, h, depth) => { for (const [x, y] of pts) hole(G, F, s, x, y, h, depth); };

    // A screw thread, as slanted lines across the near side of a round part
    function thread(G, F, s0, s1, r) {
        const kk = G.k * F.c;
        if (r * G.k < 0.7 || (s1 - s0) * kk < 2) return;
        const pitch = geo.clamp(r * 0.55 * kk, 0.8, 1.6) / kk, n = Math.floor((s1 - s0) / pitch - 0.3);
        const was = G.kind(SHADE), ss = Array.from({ length: Math.max(0, n) }, (_, j) => s0 + (j + 0.8) * pitch);
        if (n > 0) rings(G, F, ss, r, ss.map(() => [[-PI / 2, PI / 2]]), pitch * 0.4 / PI);
        G.kind(was);
    }
    // Diamond knurling: two sets of slanted lines, kept off the edges where they
    // would bunch up. Lines on a round surface need points close enough together
    // that the chords between them stay above its facets.
    function knurl(G, F, s0, s1, r, edges) {
        const kk = G.k * F.c, lim = 1.12;
        if (r * G.k < 2.2 || (s1 - s0) * kk < 2.5) return;
        const gap = 1.7 / kk, was = G.kind(SHADE), m = Math.max(8, Math.ceil(2 * lim / G.step(r)));
        for (const sg of [-1, 1]) {
            for (let c0 = s0 - r * lim; c0 < s1 + r * lim; c0 += gap) {
                let run = [];
                for (let i = 0; i <= m; i++) {
                    const phi = -lim + 2 * lim * i / m, s = c0 + sg * r * phi;
                    if (s < s0 || s > s1) { if (run.length > 1) G.line(run); run = []; continue; }
                    run.push(F.R(s, r, phi));
                }
                if (run.length > 1) G.line(run);
            }
        }
        if (edges) rings(G, F, [s0, s1], r, [[[-PI / 2, PI / 2]], [[-PI / 2, PI / 2]]]);
        G.kind(was);
    }
    // A slot with round ends along a round part, at an angle round the frame
    function keyway(G, F, s0, s1, r, ang, w) {
        if (w * G.k < 0.55 || (s1 - s0) * G.k * F.c < 2.4) return;
        const pc = wrap(ang - F.phi0), al = Math.asin(Math.min(0.9, w / r));
        // too near the edge of the part to read
        if (Math.abs(pc) + al > PI / 2 - 0.15) return;
        const pts = [], m = 8, e = Math.min(w, (s1 - s0) / 2);
        for (let i = 0; i <= m; i++) { const t = PI * i / m; pts.push(F.R(s1 - e + e * Math.sin(t), r, pc + Math.asin(w * Math.cos(t) / r))); }
        for (let i = 0; i <= m; i++) { const t = PI * i / m; pts.push(F.R(s0 + e - e * Math.sin(t), r, pc - Math.asin(w * Math.cos(t) / r))); }
        pts.push(pts[0]);
        G.line(pts);
    }
    // Lines round the near side of a round part
    function bands(G, F, list, r) {
        if (list.length) rings(G, F, list.slice().sort((a, b) => a - b), r, list.map(() => [[-PI / 2, PI / 2]]));
    }
    // Rope wound on a drum, or any close turns round a part
    function coils(G, F, s0, s1, r) {
        const kk = G.k * F.c, gap = Math.max(1 / kk, 0.17), was = G.kind(SHADE);
        const ss = [];
        for (let s = s0 + gap * 0.6; s < s1 - gap * 0.4; s += gap) ss.push(s);
        if (r * G.k >= 1.5 && ss.length) rings(G, F, ss, r, ss.map(() => [[-PI / 2, PI / 2]]));
        G.kind(was);
    }
    // The skewed bars of a rotor: slanted lines along the near side
    function bars(G, F, s0, s1, r) {
        if (r * G.k < 3 || (s1 - s0) * G.k * F.c < 4) return;
        const step = Math.max(1.6 / (r * G.k), 0.2), n = Math.floor(1.1 / step), was = G.kind(SHADE);
        for (let j = -n; j <= n; j++) {
            const pts = [];
            for (let i = 0; i <= 5; i++) pts.push(F.R(s0 + (s1 - s0) * i / 5, r, j * step + 0.16 * (i / 5 - 0.5)));
            G.line(pts);
        }
        G.kind(was);
    }
    // Where a round branch on the frame's axis runs into a round body of radius rb
    // whose own axis crosses it along the frame's y, or into a ball of that radius.
    // The join shows where both surfaces face the camera.
    function saddle(G, F, rb, rp, ball) {
        const n = Math.max(24, Math.ceil(TAU / G.step(rp)));
        let run = [];
        for (let i = 0; i <= n; i++) {
            const t = TAU * i / n, x = rp * Math.cos(t), y = rp * Math.sin(t), s = Math.sqrt(Math.max(0, rb * rb - x * x - (ball ? y * y : 0)));
            if (Math.cos(t) * F.d1 + Math.sin(t) * F.d2 < 0 && s * F.da + x * F.d1 + (ball ? y * F.d2 : 0) < 0) run.push(F.P(s, x, y));
            else { if (run.length > 1) G.line(run); run = []; }
        }
        if (run.length > 1) G.line(run);
    }

    // ------------------------------------------------------------------
    // Lettering: single strokes on a grid 6 units tall
    // ------------------------------------------------------------------

    // Each glyph is its width and its strokes. A stroke of three points or more gets
    // its corners rounded, so sharp corners are where two strokes meet.
    const O = [[2, 0], [3, 0], [4, 1.2], [4, 4.8], [3, 6], [1, 6], [0, 4.8], [0, 1.2], [1, 0], [2, 0]];
    const GLYPHS = {
        A: [4, [[0, 6], [2, 0]], [[2, 0], [4, 6]], [[0.75, 3.9], [3.25, 3.9]]],
        B: [4, [[0, 0], [0, 6]], [[0, 0], [2.4, 0], [3.6, 0.7], [3.6, 2.3], [2.4, 3], [0, 3]], [[2.4, 3], [2.9, 3], [4, 3.8], [4, 5.2], [2.9, 6], [0, 6]]],
        C: [4, [[4, 1.3], [3, 0], [1, 0], [0, 1.2], [0, 4.8], [1, 6], [3, 6], [4, 4.7]]],
        D: [4, [[0, 0], [0, 6]], [[0, 0], [2.2, 0], [4, 1.5], [4, 4.5], [2.2, 6], [0, 6]]],
        E: [3.6, [[3.6, 0], [0, 0]], [[0, 0], [0, 6]], [[0, 6], [3.6, 6]], [[0, 3], [2.8, 3]]],
        F: [3.6, [[3.6, 0], [0, 0]], [[0, 0], [0, 6]], [[0, 3], [2.8, 3]]],
        G: [4, [[4, 1.3], [3, 0], [1, 0], [0, 1.2], [0, 4.8], [1, 6], [3, 6], [4, 4.8], [4, 3.3]], [[4, 3.3], [2.3, 3.3]]],
        H: [4, [[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
        I: [0, [[0, 0], [0, 6]]],
        J: [3.2, [[3.2, 0], [3.2, 4.8], [2.2, 6], [1, 6], [0, 4.8]]],
        K: [4, [[0, 0], [0, 6]], [[4, 0], [0, 3.7]], [[1.4, 2.6], [4, 6]]],
        L: [3.4, [[0, 0], [0, 6]], [[0, 6], [3.4, 6]]],
        M: [5, [[0, 6], [0, 0]], [[0, 0], [2.5, 4.2]], [[2.5, 4.2], [5, 0]], [[5, 0], [5, 6]]],
        N: [4, [[0, 6], [0, 0]], [[0, 0], [4, 6]], [[4, 6], [4, 0]]],
        O: [4, O],
        P: [4, [[0, 6], [0, 0]], [[0, 0], [2.6, 0], [4, 0.9], [4, 2.4], [2.6, 3.3], [0, 3.3]]],
        Q: [4, O, [[2.4, 4.4], [4.2, 6.5]]],
        R: [4, [[0, 6], [0, 0]], [[0, 0], [2.6, 0], [4, 0.9], [4, 2.4], [2.6, 3.3], [0, 3.3]], [[2.2, 3.3], [4, 6]]],
        S: [4, [[4, 1.1], [3, 0], [1, 0], [0, 1], [0, 2.1], [1, 3], [3, 3], [4, 3.9], [4, 5], [3, 6], [1, 6], [0, 4.9]]],
        T: [4, [[0, 0], [4, 0]], [[2, 0], [2, 6]]],
        U: [4, [[0, 0], [0, 4.8], [1, 6], [3, 6], [4, 4.8], [4, 0]]],
        V: [4, [[0, 0], [2, 6]], [[2, 6], [4, 0]]],
        W: [5.6, [[0, 0], [1.3, 6]], [[1.3, 6], [2.8, 1.6]], [[2.8, 1.6], [4.3, 6]], [[4.3, 6], [5.6, 0]]],
        X: [4, [[0, 0], [4, 6]], [[4, 0], [0, 6]]],
        Y: [4, [[0, 0], [2, 3.1]], [[4, 0], [2, 3.1]], [[2, 3.1], [2, 6]]],
        Z: [4, [[0, 0], [4, 0]], [[4, 0], [0, 6]], [[0, 6], [4, 6]]],
        0: [4, O],
        1: [1.6, [[0, 1.5], [1.6, 0]], [[1.6, 0], [1.6, 6]]],
        2: [4, [[0, 1.3], [1, 0], [3, 0], [4, 1.1], [4, 2.4], [0, 6]], [[0, 6], [4, 6]]],
        3: [4, [[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1.6, 3]], [[3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]]],
        4: [4, [[3, 6], [3, 0]], [[3, 0], [0, 4.2]], [[0, 4.2], [4, 4.2]]],
        5: [4, [[3.8, 0], [0.5, 0]], [[0.5, 0], [0.2, 2.7]], [[0.2, 2.7], [1.2, 2.3], [3, 2.3], [4, 3.3], [4, 5], [3, 6], [1, 6], [0, 5]]],
        6: [4, [[3.7, 0.8], [3, 0], [1, 0], [0, 1.2], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.7], [3, 2.7], [1, 2.7], [0, 3.7]]],
        7: [4, [[0, 0], [4, 0]], [[4, 0], [1.6, 6]]],
        8: [4, [[2, 3], [1, 3], [0, 2.1], [0, 0.9], [1, 0], [3, 0], [4, 0.9], [4, 2.1], [3, 3], [2, 3]], [[2, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [2, 3]]],
        9: [4, [[4, 2.3], [3, 3.3], [1, 3.3], [0, 2.3], [0, 1], [1, 0], [3, 0], [4, 1], [4, 4.8], [3, 6], [1, 6], [0.3, 5.2]]],
        '.': [0.7, [[0, 5.3], [0.7, 5.3], [0.7, 6], [0, 6], [0, 5.3]]],
        ',': [0.7, [[0.2, 5.3], [0.7, 5.3]], [[0.7, 5.3], [0.7, 6.1]], [[0.7, 6.1], [0, 7.2]]],
        '-': [2.6, [[0, 3.3], [2.6, 3.3]]],
        ' ': [2.2],
    };
    const TRACK = 1.7;   // between letters

    function textWidth(str, h) {
        let w = 0;
        for (const ch of str) w += (GLYPHS[ch] || GLYPHS[' '])[0] + TRACK;
        return (w - TRACK) * h / 6;
    }
    // Text with its middle at (x, y), or its left or right end with o.align. Returns the strokes.
    function letter(str, x, y, h, o = {}) {
        const u = h / 6, w = textWidth(str, h), slant = o.slant || 0, out = [];
        let pen = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
        for (const ch of str) {
            const g = GLYPHS[ch] || GLYPHS[' '];
            for (let i = 1; i < g.length; i++) {
                const pts = g[i].map(([a, b]) => [pen + (a + (3 - b) * slant) * u, y + (b - 3) * u]);
                out.push(ch === '.' || pts.length < 3 ? pts : geo.chaikin(pts, 2));
            }
            pen += (g[0] + TRACK) * u;
        }
        return out;
    }

    // ------------------------------------------------------------------
    // The machine: parts, the chains they slide apart along, and center lines
    // ------------------------------------------------------------------

    // A is the main axis, pointing at the camera's end of the machine. E2 is the
    // side that keys, outlets and the like are on, which is up when the shaft lies
    // down, and E1 is across both.
    class Machine {
        constructor(A, E1, E2, flat, d) { Object.assign(this, { A, E1, E2, flat, d, parts: [], chains: [], axes: [] }); }
        // The angle from E1 round to E2 to set a second shaft off at, so that on
        // paper it lands beside the main one and not in line with it
        beside() {
            const d = this.d, r = unit([d[1], -d[0], 0]), u = cross(r, d), on = v => [dot(v, r), dot(v, u)];
            const a = on(this.A), e1 = on(this.E1), e2 = on(this.E2), l = Math.hypot(a[0], a[1]) || 1, n = [-a[1] / l, a[0] / l];
            return Math.atan2(e2[0] * n[0] + e2[1] * n[1], e1[0] * n[0] + e1[1] * n[1]);
        }
        pos(s, x = 0, y = 0) { const { A, E1, E2 } = this; return [s * A[0] + x * E1[0] + y * E2[0], s * A[1] + x * E1[1] + y * E2[1], s * A[2] + x * E1[2] + y * E2[2]]; }
        // the direction to measure x along for a part on axis a
        across(a) { return Math.abs(dot(a, this.A)) > 0.9 ? this.E1 : Math.abs(dot(a, this.E2)) > 0.9 ? this.A : this.E2; }
        // A part: { name, kind, s, x, y (or at), a, e1, s0, s1, r, draw(G, F) } and
        // optionally `spot` for where a leader can land, `wide` for how much room it
        // needs when pulled apart, and tag: false to leave it unnumbered.
        add(o) {
            const p = Object.assign({ kind: BODY, a: this.A, s0: 0, tag: true, off: [0, 0, 0] }, o);
            if (!p.e1) p.e1 = this.across(p.a);
            if (!p.at) p.at = this.pos(o.s || 0, o.x || 0, o.y || 0);
            this.parts.push(p);
            return p;
        }
        // Parts slide apart along dir from the base. The parts of a slot move together,
        // and slots are listed from the base outwards.
        chain(dir, base) {
            const C = { dir, base, slots: [] };
            C.add = (...parts) => { const s = parts.flat().filter(Boolean); if (s.length) C.slots.push(s); return C; };
            this.chains.push(C);
            return C;
        }
        // A center line through `at` along dir. A whole one runs from the first of its
        // parts to the last. Any other starts at its first part, a bolt say, and runs
        // on through the holes for it until the next one is a long way off.
        axis(parts, at, dir, whole) { this.axes.push({ parts: parts.flat().filter(Boolean), at, dir: dir || this.A, whole }); }
        // a point that moves with a part, for a center line to end on
        pin(host, at) { return { at, a: this.A, s0: 0, s1: 0, r: 0, host }; }
        // Give a part that isn't round the box it fits in, along A, E1 and E2
        boxed(p, s0, s1, x0, x1, y0, y1) {
            const pts = [];
            for (const s of [s0, s1]) for (const x of [x0, x1]) for (const y of [y0, y1]) pts.push(this.pos(s, x, y));
            p.bound = dir => { const t = pts.map(q => dot(q, dir)); return [Math.min(...t), Math.max(...t)]; };
            return p;
        }
    }

    // How far a part reaches along a direction in the assembled machine
    function reach(p, dir) {
        if (p.bound) return p.bound(dir);
        const t = dot(p.at, dir), ad = dot(p.a, dir), w = p.r * Math.sqrt(Math.max(0, 1 - ad * ad));
        const a = t + p.s0 * ad, b = t + p.s1 * ad;
        return [Math.min(a, b) - w, Math.max(a, b) + w];
    }

    // Slide the parts apart. Each slot moves out until it's clear of every slot
    // before it, plus a gap that keeps the part behind in view: on paper a part
    // hides about its own radius times `rho` of what follows it down the axis.
    const SPREAD = 0.6;
    function explode(M, E, d) {
        for (const p of M.parts) p.off = [0, 0, 0];
        for (const C of M.chains) {
            const dir = C.dir, dd = dot(d, dir), rho = Math.abs(dd) / Math.sqrt(Math.max(0.08, 1 - dd * dd));
            const base = C.base ? C.base.off : [0, 0, 0], done = C.base ? [{ parts: [C.base], off: 0 }] : [];
            const size = ps => Math.max(...ps.map(q => q.wide || q.r));
            for (const slot of C.slots) {
                const lo = Math.min(...slot.map(q => reach(q, dir)[0]));
                let off = 0;
                for (const e of done) off = Math.max(off, e.off + E * Math.max(0, Math.max(...e.parts.map(q => reach(q, dir)[1])) - lo));
                if (done.length) {
                    const prev = done[done.length - 1], rp = size(prev.parts), rq = size(slot);
                    const [rf, rb] = dd < 0 ? [rq, rp] : [rp, rq];
                    off = Math.max(off, prev.off) + E * (rho * SPREAD * (rf + Math.min(rf, rb)) + 0.25 + Math.max(0, ...slot.map(q => q.lead || 0)));
                }
                for (const q of slot) q.off = mad(base, dir, off);
                done.push({ parts: slot, off });
            }
        }
    }

    // ------------------------------------------------------------------
    // Parts
    // ------------------------------------------------------------------

    const HEX = PI / 6;
    const circleOf = (n, r, rot = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(rot + TAU * i / n), r * Math.sin(rot + TAU * i / n)]);
    const twin = group => { group.forEach(p => { p.twins = group; }); return group; };
    // The outline round a set of circles [x, y, r], like a link or a lobed flange
    function wrapOf(circles) {
        const pts = [];
        for (const [x, y, r] of circles) for (let i = 0; i < 40; i++) pts.push([x + r * Math.cos(TAU * i / 40), y + r * Math.sin(TAU * i / 40)]);
        const h = PG.iso.hull(pts);
        return (geo.polygonArea(h) < 0 ? h.reverse() : h).map(q => [q[0], q[1], 1]);
    }
    // A round bore with a keyway cut in it on the E2 side
    function keyedBore(G, r) {
        const w = r * 0.27, n = G.facets(r);
        if (w * 2 * G.k < 0.85) return ring(r, n);
        const de = Math.asin(w / r), out = [];
        for (let i = 0; i <= n; i++) { const a = PI / 2 + de + (TAU - 2 * de) * i / n; out.push([r * Math.cos(a), r * Math.sin(a), i > 0 && i < n ? 1 : 0]); }
        out.push([w, r + w * 0.8, 0], [-w, r + w * 0.8, 0]);
        return out;
    }

    // A ring or a disc, with any holes drilled through its face
    function addRing(M, o) {
        const { ro, ri = 0, len } = o;
        return M.add(Object.assign({ s1: len, r: ro, spot: [len, (ro + Math.max(ri, ro * 0.5)) / 2, 1],
            draw(G, F) {
                if (tooThin(G, F, len)) leaf(G, F, 0, len, ro, ri);
                else lathe(G, F, [[0, ro], [len, ro]], ri);
                if (o.holes && F.da < 0) holes(G, F, len, o.holes, o.hole, len);
            } }, o, { r: ro }));
    }

    // An outline cut from plate, with any opening and drilled holes
    function addPlate(M, o) {
        const { len, outline } = o, r = Math.max(...outline.map(q => Math.hypot(q[0], q[1])));
        return M.add(Object.assign({ s1: len, r,
            draw(G, F) {
                extrude(G, F, 0, len, outline, { inner: typeof o.inner === 'function' ? o.inner(G) : o.inner, center: o.center });
                if (o.holes && F.da < 0) holes(G, F, len, o.holes, o.hole, len);
            } }, o));
    }

    // A ball bearing: two rings with the balls showing in the race between them
    function addBearing(M, o) {
        const { ro, ri, len } = o;
        return M.add(Object.assign({ name: 'bearing', kind: SEAL, s1: len, r: ro, spot: [len, ro - (ro - ri) * 0.14, 1],
            draw(G, F) {
                const t = (ro - ri) * 0.28, ra = ro - t, rb = ri + t, g = Math.min(len * 0.3, (ra - rb) * 0.7), flat = Math.abs(F.da) * G.k;
                if (F.da > 0 || t * flat < FINE || (ra - rb) * flat < 2 * FINE) { lathe(G, F, [[0, ro], [len, ro]], ri); return; }
                turned(G, F, [[0, ri], [len, ri], [len, rb], [len - g, rb], [len - g, ra], [len, ra], [len, ro], [0, ro]]);
                const ball = (ra - rb) / 2 * 0.88, n = Math.max(5, Math.floor(PI * (ra + rb) / (ball * 2.6)));
                if (ball * G.k < 0.8) return;
                for (let i = 0; i < n; i++) {
                    const pts = G.disc(F.R(len - g, (ra + rb) / 2, TAU * (i + 0.5) / n), ball);
                    G.line(pts);
                    G.face(pts.slice(0, -1));
                }
            } }, o));
    }

    // A lip seal: a ring with a step in its face
    function addSeal(M, o) {
        const { ro, ri, len } = o;
        return M.add(Object.assign({ name: 'seal', kind: SEAL, s1: len, r: ro, spot: [len, ro - (ro - ri) * 0.2, 1],
            draw(G, F) {
                const rm = ri + (ro - ri) * 0.45, flat = Math.abs(F.da) * G.k;
                if (F.da > 0 || (ro - rm) * flat < FINE || (rm - ri) * flat < FINE) lathe(G, F, [[0, ro], [len, ro]], ri);
                else lathe(G, F, [[0, ro], [len, ro]], [[0, ri], [len * 0.5, ri], [len * 0.5, rm], [len, rm]]);
            } }, o));
    }

    // A coil spring with its end turns closed up
    function addSpring(M, o) {
        const { len, r, wire, turns } = o;
        return M.add(Object.assign({ name: 'spring', kind: SEAL, s1: len, r: r + wire, spot: [len * 0.5, r + wire],
            draw(G, F) {
                const n = Math.round(turns * 22), path = [];
                for (let i = 0; i <= n; i++) {
                    const u = i / n, a = TAU * turns * u;
                    path.push(F.P(wire + (len - 2 * wire) * (u - 0.12 * Math.sin(TAU * u)), r * Math.cos(a), r * Math.sin(a)));
                }
                tube(G, path, wire);
            } }, o, { r: r + wire }));
    }

    // Teeth too small to draw leave a plain wheel, with a line where they start
    const toothy = (G, F, pitch) => pitch * G.k * Math.abs(F.da) >= 1.5;
    function blank(G, F, s0, s1, root, tip, bore) {
        lathe(G, F, [[s0, tip], [s1, tip]], bore);
        if ((tip - root) * Math.abs(F.da) * G.k >= FINE) capLoop(G, F, F.da < 0 ? s1 : s0, 0, 0, root);
    }

    // A shaft from its lengths, [length, radius, mark] from back to front. The mark
    // is 'key', 'thread', 'knurl', 'rope', 'bars' or { teeth, tip } for a pinion cut on it.
    function addShaft(M, o) {
        const prof = [], keys = [];
        let L = 0, rmax = 0;
        const best = [];
        o.segs.forEach(([len, r, mark], i) => {
            const pinion = mark && mark.teeth, core = pinion ? o.segs[i - 1][1] : r;
            prof.push([L, core], [L + len, core]);
            if (mark === 'key') keys.push([L + len * 0.14, len * 0.72, r]);
            if (!pinion) best.push([L + len / 2, r, len * r]);
            L += len;
            rmax = Math.max(rmax, pinion ? mark.tip : r);
        });
        return M.add(Object.assign({ name: 'shaft', kind: MOVING, s1: L, r: rmax, spot: best.sort((a, b) => b[2] - a[2]).slice(0, 3).map(q => [q[0], q[1]]), keys,
            draw(G, F) {
                lathe(G, F, prof, 0);
                let s = 0;
                o.segs.forEach(([len, r, mark], i) => {
                    if (mark === 'thread') thread(G, F, s, s + len, r);
                    if (mark === 'knurl') knurl(G, F, s, s + len, r);
                    if (mark === 'rope') coils(G, F, s, s + len * 0.72, r);
                    if (mark === 'bars') bars(G, F, s, s + len, r);
                    if (mark === 'key') keyway(G, F, s + len * 0.14, s + len * 0.86, r, PI / 2, r * 0.27);
                    if (mark && mark.teeth) {
                        if (toothy(G, F, TAU * r / mark.teeth)) extrude(G, F, s, s + len, gearOutline(mark.teeth, r, mark.tip, mark.rot || 0), { center: [0, 0], thin: true });
                        else blank(G, F, s, s + len, r, mark.tip, 0);
                        // where the shaft comes out of the pinion's face
                        const next = o.segs[i + 1];
                        if (F.da < 0 && next) arc(G, F, s + len, next[1], -PI / 2, PI / 2);
                    }
                    s += len;
                });
            } }, o));
    }

    // A key in one of a shaft's keyways. It lifts out sideways.
    function addKey(M, host, which) {
        const [s, len, r] = host.keys[which], w = r * 0.27, at = mad(mad(host.at, host.a, s), M.E2, r);
        const key = M.add({ name: 'key', kind: FASTEN, at, a: host.a, e1: cross(M.E2, host.a), s1: len, r: w, wide: w * 2,
            spot: (G, F) => [[len * 0.5, 0, w], [len, 0, 0], [0, 0, 0], [len * 0.5, w, 0], [len * 0.5, -w, 0]].map(([u, x, y]) => [F.P(u, x, y), F.P(len * 0.5, 0, -r)]),
            draw(G, F) { if (w * G.k >= 0.55) block(G, F, 0, len, -w, w, -w, w); } });
        M.chain(M.E2, host).add(key);
        M.axis([key, M.pin(host, mad(at, M.E2, -r * 0.5))], mad(at, host.a, len / 2), M.E2);
        return key;
    }

    // A bolt with the seat of its head at `at`, pointing back along its axis
    function addBolt(M, o) {
        const { len, r } = o, head = o.head || M.head, hh = r * 1.25, rh = head === 'cap' ? r * 1.5 : r * 1.85;
        return M.add(Object.assign({ name: 'bolt', kind: FASTEN, s0: -len, s1: hh, r: rh, spot: [[-len * 0.45, r], [hh * 0.5, rh * 0.95]],
            draw(G, F) {
                lathe(G, F, [[-len, r], [0, r]], 0);
                thread(G, F, -len, -len * 0.3, r);
                if (head === 'cap') {
                    lathe(G, F, [[0, rh], [hh, rh]], 0);
                    if (F.da < 0 && r * G.k * Math.abs(F.da) > 0.9) G.line(ngon(r * 0.75, 6).concat([[r * 0.75, 0]]).map(p => F.P(hh, p[0], p[1])));
                } else extrude(G, F, 0, hh, ngon(rh, 6, HEX));
            } }, o, { r: rh }));
    }
    // A set of bolts, with a center line from each to what it goes into
    function addBolts(M, places, a, o, into) {
        const group = twin(places.map(at => addBolt(M, Object.assign({ at, a }, o))));
        if (into) group.forEach(b => M.axis([b, ...into], b.at, a));
        return group;
    }

    function addNut(M, o) {
        const r = o.r, rh = r * 1.85, len = o.len || r * 1.5;
        return M.add(Object.assign({ name: 'nut', kind: FASTEN, s1: len, r: rh, spot: [[len * 0.5, rh * 0.9], [len, rh * 0.6, 1], [0, rh * 0.6, 1]],
            draw(G, F) {
                const flat = Math.abs(F.da) * G.k;
                extrude(G, F, 0, len, ngon(rh, 6, HEX), r * flat < 0.45 ? {} : { inner: ring(r, G.facets(r)) });
                if (rh * 0.13 * flat >= 0.42) capLoop(G, F, F.da < 0 ? len : 0, 0, 0, rh * 0.87);
            } }, o, { r: rh }));
    }
    const addWasher = (M, o) => addRing(M, Object.assign({ name: 'washer', kind: FASTEN, ro: o.r * 2.1, ri: o.r, len: Math.max(0.07, o.r * 0.22) }, o));

    // A spur gear with a keyed bore, a hub on its face and holes through its web
    function addGear(M, o) {
        const { R, teeth, len, bore } = o, pitch = TAU * R / teeth, tip = R + 0.3 * pitch, root = R - 0.36 * pitch, rh = o.rh || Math.max(bore * 1.8, R * 0.3), hub = o.hub || 0;
        return M.add(Object.assign({ name: 'gear', kind: MOVING, s1: len + hub, r: tip, spot: [len, (root + rh) / 2, 1],
            draw(G, F) {
                const flat = Math.abs(F.da) * G.k, front = F.da < 0 ? len : 0;
                if (toothy(G, F, pitch)) extrude(G, F, 0, len, gearOutline(teeth, root, tip, o.rot || 0), { inner: keyedBore(G, bore), thin: true });
                else blank(G, F, 0, len, root, tip, bore);
                if (hub) lathe(G, F, [[len, rh], [len + hub, rh]], bore);
                const web = root - 0.3 - rh;
                if (web * flat < 2 * FINE) return;
                capLoop(G, F, front, 0, 0, root - 0.3);
                if (!hub || F.da > 0) capLoop(G, F, front, 0, 0, rh);
                const n = o.holes || 0, hr = Math.min(web * 0.3, PI * (rh + root) / 2 / (n || 1) * 0.3);
                if (n && F.da < 0 && hr * flat > 0.9) holes(G, F, front, circleOf(n, (rh + root - 0.3) / 2, o.rot || 0), hr, len);
            } }, o));
    }

    // A chain sprocket or a ratchet wheel: a thin toothed disc on a hub
    function addSprocket(M, o) {
        const { R, teeth, len, bore, ratchet } = o, pitch = TAU * R / teeth, tip = R + pitch * 0.3, root = R - pitch * (ratchet ? 0.3 : 0.25), rh = o.rh || bore * 1.8, hub = o.hub || 0;
        const outline = [];
        for (let i = 0; i < teeth; i++) {
            const a = TAU * i / teeth, t = TAU / teeth;
            for (const [r, da] of ratchet ? [[root, 0], [tip, 0.06]] : [[root, -0.3], [tip, -0.07], [tip, 0.07], [root, 0.3]]) outline.push([r * Math.cos(a + da * t), r * Math.sin(a + da * t), 0]);
        }
        return M.add(Object.assign({ name: ratchet ? 'ratchet' : 'sprocket', kind: MOVING, s1: len + hub, r: tip, spot: [len, (root + rh) / 2, 1],
            draw(G, F) {
                if (toothy(G, F, pitch)) extrude(G, F, 0, len, outline, { inner: keyedBore(G, bore), thin: true });
                else blank(G, F, 0, len, root, tip, bore);
                if (hub) lathe(G, F, [[len, rh], [len + hub, rh]], bore);
            } }, o));
    }

    // A belt pulley: a rim with V grooves on a dished web, and its hub
    function addPulley(M, o) {
        const { r, len, bore } = o, rh = o.rh || Math.max(bore * 1.9, r * 0.3), n = o.grooves || 1, hf = len + 0.2;
        return M.add(Object.assign({ name: 'pulley', kind: MOVING, s1: hf, r, spot: [len * 0.5, r],
            draw(G, F) {
                // as many grooves as leave their lines apart on paper
                const ri = r - Math.max(0.3, r * 0.17), wf = len * 0.62, e = Math.max(0.1, FINE / (G.k * F.c));
                let m = o.flat ? 0 : n;
                while (m && (len - (m + 1) * e) / m < 2 * e) m--;
                const gw = m ? (len - (m + 1) * e) / m : 0, gd = Math.min(0.26, r * 0.15, gw * 0.75);
                const flat = Math.abs(F.da) * G.k, dish = F.da < 0 && (ri - rh) * flat >= 2.5 * FINE, top = [[len, r]];
                for (let i = 0; i < m; i++) { const a = len - e - i * (gw + e); top.push([a, r], [a - gw / 2, r - gd], [a - gw, r]); }
                top.push([0, r]);
                turned(G, F, [[0, bore], [hf, bore], [hf, rh], ...(dish ? [[wf, rh], [wf, ri], [len, ri]] : [[len, rh]]), ...top]);
                const hn = o.holes || 0, hr = Math.min((ri - rh) * 0.3, PI * (rh + ri) / 2 / (hn || 1) * 0.3);
                if (dish && hn && hr * flat > 0.9) holes(G, F, wf, circleOf(hn, (rh + ri) / 2, 0.3), hr, len * 0.3);
            } }, o));
    }

    // A handwheel: a round rim on spokes
    function addHandwheel(M, o) {
        const { r, bore } = o, rt = Math.max(0.13, r * 0.085), rh = Math.min(bore * 2, r * 0.36), hl = 0.5, n = o.spokes || 5, sc = hl * 0.6;
        return M.add(Object.assign({ name: 'handwheel', kind: MOVING, s1: hl, r: r + rt, spot: [sc, r + rt],
            draw(G, F) {
                lathe(G, F, [[0, rh], [hl, rh]], bore);
                if (rt * G.k < 0.5) arc(G, F, sc, r, -PI, PI);
                else { const m = geo.clamp(4 * Math.ceil(rt * G.k * 2.5), 16, 40); turned(G, F, Array.from({ length: m }, (_, i) => [sc + rt * Math.sin(TAU * (i + 0.5) / m), r - rt * Math.cos(TAU * (i + 0.5) / m), 1])); }
                for (const [x, y] of circleOf(n, 1, o.rot || 0.3)) tube(G, [F.P(sc, x * rh * 0.8, y * rh * 0.8), F.P(sc, x * (r - rt * 0.3), y * (r - rt * 0.3))], rt * 0.72);
            } }, o, { r: r + rt }));
    }

    // A crank arm, with the hole for its handle at the far end
    function addCrank(M, o) {
        const { len, bore, ang, t = 0.26 } = o, hx = len * Math.cos(ang), hy = len * Math.sin(ang), outline = wrapOf([[0, 0, bore * 2.1], [hx, hy, 0.3]]);
        return M.add(Object.assign({ name: 'crank', kind: MOVING, s1: t, r: len + 0.3, wide: bore * 2.1, hand: [hx, hy],
            spot: (G, F) => [[F.P(t, hx * 0.55, hy * 0.55), F.P(t, hx * 0.55 - hy * 0.5, hy * 0.55 + hx * 0.5)], [F.P(t, hx * 0.3, hy * 0.3), F.P(t, hx * 0.3 + hy * 0.5, hy * 0.3 - hx * 0.5)]],
            draw(G, F) {
                extrude(G, F, 0, t, outline, { inner: keyedBore(G, bore) });
                if (F.da < 0) hole(G, F, t, hx, hy, 0.15, t);
            } }, o));
    }
    // The handle of a crank, a grip on a pin
    function addGrip(M, o) {
        const len = o.len || 1.3, r = o.r || 0.3;
        return M.add(Object.assign({ name: 'handle', kind: MOVING, s0: -0.3, s1: len, r,
            draw(G, F) { lathe(G, F, [[-0.3, 0.14], [0, 0.14], [0, r * 0.8], [len * 0.2, r, 1], [len * 0.8, r, 1], [len, r * 0.7]], 0); } }, o));
    }

    // A pipe flange with a stub of pipe on it
    function addFlange(M, o) {
        const { ro, len, rp, rb, pipe } = o;
        return M.add(Object.assign({ name: 'flange', s1: len + pipe, r: ro, spot: [len, (ro + rp) / 2, 1],
            draw(G, F) {
                lathe(G, F, [[0, ro], [len, ro], [len, rp], [len + pipe, rp]], [[0, rb], [len + pipe, rb]]);
                if (o.holes) holes(G, F, F.da < 0 ? len : 0, o.holes, o.hole, len);
            } }, o));
    }
    // A bolted pipe joint on the end of a nozzle: gasket, flange and bolts, sliding off along a
    function pipeJoint(M, base, at, a, o) {
        const { ro, rp, rb, n, br } = o, pts = circleOf(n, (ro + rp) / 2 + 0.02, PI / n), C = M.chain(a, base);
        const gasket = addRing(M, { name: 'gasket', kind: SEAL, at, a, ro, ri: rb, len: 0.05, holes: pts, hole: br * 1.15 });
        const flange = addFlange(M, { at: mad(at, a, 0.05), a, ro, len: 0.3, rp, rb, pipe: o.pipe, holes: pts, hole: br * 1.15 });
        const e1 = M.across(a), e2 = cross(a, e1);
        const bolts = addBolts(M, pts.map(([x, y]) => mad(mad(mad(at, a, 0.35), e1, x), e2, y)), a, { len: 0.8, r: br }, [flange, gasket, M.pin(base, at)]);
        C.add(gasket).add(flange).add(bolts);
        M.axis([flange, gasket, M.pin(base, at)], at, a, true);
        return { gasket, flange, bolts, pts };
    }

    // An open impeller: a disc with its hub and vanes curving back from the eye
    function addImpeller(M, o) {
        const { R, rs, rh, hl, hv, vanes } = o, t = 0.13, rin = rh + 0.14, m = 9;
        const lines = Array.from({ length: vanes }, (_, j) => {
            const c = [];
            for (let i = 0; i <= m; i++) { const f = i / m, r = rin + (R * 0.97 - rin) * f, a = TAU * j / vanes - o.sweep * Math.pow(f, 0.85); c.push([r * Math.cos(a), r * Math.sin(a)]); }
            return c;
        });
        return M.add(Object.assign({ name: 'impeller', kind: MOVING, s1: Math.max(hl, t + hv), r: R, spot: [t * 0.5, R],
            draw(G, F) {
                lathe(G, F, [[0, R], [t, R], [t, rh], [hl, rh]], rs);
                const th = Math.max(0.055, 0.3 / G.k);
                for (const c of lines) {
                    const L = [], Rt = [];
                    for (let i = 0; i <= m; i++) {
                        const a = c[Math.max(0, i - 1)], b = c[Math.min(m, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
                        L.push([c[i][0] + nx * th, c[i][1] + ny * th, i > 0 && i < m ? 1 : 0]);
                        Rt.push([c[i][0] - nx * th, c[i][1] - ny * th, i > 0 && i < m ? 1 : 0]);
                    }
                    let poly = Rt.concat(L.slice().reverse());
                    if (geo.polygonArea(poly) < 0) poly = poly.reverse();
                    extrude(G, F, t, t + hv, poly, { pieces: L.slice(0, -1).map((q, i) => [L[i], L[i + 1], Rt[i + 1], Rt[i]]) });
                }
            } }, o));
    }

    // ------------------------------------------------------------------
    // Machines. Each builds its parts into M and returns its title.
    // P.extras from 0 to 1 says how many of the smaller parts to include.
    // ------------------------------------------------------------------

    // Something on the end of a shaft to drive it or be driven by it, with its washer and nut
    function driveEnd(M, rng, o) {
        const { s, x = 0, y = 0, bore, size } = o;
        const kind = o.kind || rng.pick(['pulley', 'pulley', 'sprocket', 'coupling', 'handwheel']);
        let part;
        if (kind === 'pulley') part = addPulley(M, { s, x, y, r: size, len: rng.range(0.55, 0.8), bore, grooves: rng.int(1, 2), holes: rng.pick([0, 4, 5, 6]) });
        else if (kind === 'flat') part = addPulley(M, { s, x, y, r: size, len: rng.range(0.7, 0.95), bore, flat: true, holes: rng.pick([0, 4, 6]) });
        else if (kind === 'sprocket') part = addSprocket(M, { s, x, y, R: size * 0.9, teeth: Math.round(TAU * size * 0.9 / 0.55), len: 0.16, bore, hub: 0.35 });
        else if (kind === 'handwheel') part = addHandwheel(M, { s, x, y, r: size * 1.1, bore, spokes: rng.int(3, 6) });
        else {
            const pts = circleOf(rng.int(4, 6), size * 0.78, 0.4);
            part = M.add({ name: 'coupling', kind: MOVING, s, x, y, s1: 0.95, r: size, spot: [0.95, size * 0.78, 1],
                draw(G, F) { lathe(G, F, [[0, bore * 2], [0.65, bore * 2], [0.65, size], [0.95, size]], bore); if (F.da < 0) holes(G, F, 0.95, pts, 0.13, 0.3); } });
        }
        const end = s + part.s1 + 0.02, washer = o.nut ? addWasher(M, { s: end, x, y, r: o.nut }) : null, nut = o.nut ? addNut(M, { s: end + washer.s1, x, y, r: o.nut }) : null;
        return { part, washer, nut };
    }

    // An end suction pump: a bearing frame with its shaft, the impeller on the end
    // of it, and a volute casing bolted on over the lot
    function pump(M, rng, P) {
        // The casing is drawn in its own frame, X across it and Y towards the outlet. Lying
        // down the outlet points sideways, towards the camera: pointing up it would come
        // apart into the parts further up the shaft.
        const { A, E1, E2 } = M, X = M.flat ? (dot(M.d, cross(A, E2)) < 0 ? E2 : neg(E2)) : E1, Y = cross(A, X);
        const cpos = (s, x, y) => [s * A[0] + x * X[0] + y * Y[0], s * A[1] + x * X[1] + y * Y[1], s * A[2] + x * X[2] + y * Y[2]];
        const rs = 0.5, R = rng.range(2.05, 2.55), depth = rng.range(1.2, 1.5), br = 0.15;
        const r0 = R + 0.28, r1 = r0 + rng.range(0.75, 1.05), xi = r0 * rng.range(0.82, 0.95), yd = r1 + rng.range(0.9, 1.4);
        const nb = rng.int(4, 6), lr = 0.36, spiral = al => r0 + (r1 - r0) * al / (1.5 * PI);
        const lugs = Array.from({ length: nb }, (_, i) => { const al = PI * (0.1 + 1.28 * i / (nb - 1)), r = spiral(al) + 0.1; return [r * Math.cos(PI / 2 + al), r * Math.sin(PI / 2 + al)]; });
        const rf = Math.max(...lugs.map(q => Math.hypot(q[0], q[1]))) + lr + 0.05, lugsB = lugs.map(([x, y]) => { const w = cpos(0, x, y); return [dot(w, E1), dot(w, E2)]; });

        const L = rng.range(2.6, 3.4), rb = 1.4, tf = 0.38, seat = 1.08, bore = 0.8;
        const body = M.add({ name: 'frame', s: 0, s0: -L, s1: 0, r: rf, wide: rb * 1.5, spot: [-tf / 2, rf],
            draw(G, F) {
                lathe(G, F, [[-L, rb], [-tf, rb], [-tf, rf], [0, rf]], [[-L, bore], [-0.75, bore], [-0.75, seat], [0, seat]]);
                holes(G, F, 0, lugsB, br * 1.15, tf);
                if (!M.flat) return;
                const hy = rf + 0.25, wy = 1.1;
                block(G, F, -L + 0.35, -tf - 0.5, -wy, wy, -hy, -rb * 0.75);
                block(G, F, -L, -tf - 0.15, -rb * 1.55, rb * 1.55, -hy - 0.3, -hy);
            } });
        const front = M.chain(A, body), back = M.chain(neg(A), body);
        const bearing = addBearing(M, { s: -0.7, ro: seat, ri: rs, len: 0.55 });
        const sh0 = -L - 1.4, shaft = addShaft(M, { s: sh0, segs: [[1.4, 0.42, 'key'], [L - 1, 0.56], [0.25, 0.72], [1, rs], [0.8, 0.42, 'key'], [0.45, 0.3, 'thread']] });
        const slinger = P.extras > 0.5 && addRing(M, { name: 'slinger', kind: SEAL, s: -0.12, ro: 0.92, ri: rs, len: 0.1 });
        const seal = addSeal(M, { s: 0.02, ro: 0.95, ri: rs, len: 0.2 });
        const imp = addImpeller(M, { s: 0.3, R, rs: 0.42, rh: 0.78, hl: 0.75, hv: rng.range(0.4, 0.55), vanes: rng.int(5, 7), sweep: rng.range(0.9, 1.5) });
        const washer = addWasher(M, { s: 1.05, r: 0.3 }), nut = addNut(M, { s: 1.05 + washer.s1, r: 0.3, len: 0.36 });
        const gasket = P.extras > 0.2 && addRing(M, { name: 'gasket', kind: SEAL, s: -0.05, ro: r0 + 0.05, ri: R + 0.12, len: 0.05 });

        // the casing: a spiral growing anticlockwise from the top round to the outlet side,
        // with a lug for each bolt, then a straight throat up to the outlet
        const m = 320, pts = [];
        for (let i = 0; i <= m; i++) {
            const al = 1.5 * PI * i / m, th = PI / 2 + al, ux = Math.cos(th), uy = Math.sin(th);
            let r = spiral(al);
            for (const [lx, ly] of lugs) {
                const b = ux * lx + uy * ly, disc = b * b - (lx * lx + ly * ly - lr * lr);
                if (disc > 0) r = Math.max(r, b + Math.sqrt(disc));
            }
            pts.push([r * ux, r * uy]);
        }
        const yt = r0 * 0.55, tongue = [[r1, yd], [xi, yd], [xi, yt]];
        for (let i = 0; i < 6; i++) { const th = PI / 4 + PI / 4 * i / 6; tongue.push([r0 * Math.cos(th), r0 * Math.sin(th)]); }
        const outline = corners(pts.concat(tongue)), pieces = [];
        for (let i = 0; i < m; i++) pieces.push([[0, 0], pts[i], pts[i + 1]]);
        pieces.push([[xi, 0], [r1, 0], [r1, yd], [xi, yd]], [[0, 0], [xi, 0], [xi, yt]]);
        for (let i = 2; i < tongue.length; i++) pieces.push([[0, 0], tongue[i], tongue[i + 1] || pts[0]]);
        const rn = rng.range(1.0, 1.25), neck = rng.range(0.55, 0.9), rsf = rn + 0.75, sb = circleOf(4, (rsf + rn) / 2 + 0.02, PI / 4);
        const xm = (xi + r1) / 2, hx = (r1 - xi) / 2 + 0.4, hz = depth / 2 + 0.3, db = [[-hz + 0.22, -hx + 0.22], [hz - 0.22, -hx + 0.22], [hz - 0.22, hx - 0.22], [-hz + 0.22, hx - 0.22]];
        const outlet = Math.min(r1 - xi, depth) * 0.36, face = depth + neck + 0.3;
        const casing = M.add({ name: 'casing', s: 0, e1: X, s1: face, r: yd + 0.3, wide: r1,
            spot: (G, F) => [[-0.75, -0.6], [-0.2, -0.85], [-0.85, 0.1], [0.5, -0.75]].map(([x, y]) => [F.P(depth, x * r0, y * r0), F.P(depth, 0, 0)]),
            draw(G, F) {
                extrude(G, F, 0, depth, outline, { pieces });
                if (F.da < 0) holes(G, F, depth, lugs, br * 1.15, depth);
                lathe(G, F, [[depth, rn], [depth + neck, rn], [depth + neck, rsf], [face, rsf]], [[depth, 0], [depth + 0.1, 0], [depth + 0.1, rn - 0.22], [face, rn - 0.22]]);
                holes(G, F, face, sb, br * 1.15, 0.3);
                // the outlet flange, in a frame that looks down on it
                const T = F.turn(depth / 2, xm, yd, Y, A);
                block(G, T, 0, 0.3, -hz, hz, -hx, hx);
                if (T.da < 0) { hole(G, T, 0.3, 0, 0, outlet, 2); holes(G, T, 0.3, db, br * 1.15, 0.3); }
            } });
        const cb = addBolts(M, lugs.map(([x, y]) => cpos(depth, x, y)), A, { len: depth + tf * 0.8, r: br }, [casing]);
        front.add(bearing).add(shaft).add(slinger).add(seal).add(imp).add(washer).add(nut).add(gasket).add(casing).add(cb);
        addKey(M, shaft, 1);
        const pipeS = rng.range(0.7, 1.3), pipeU = rng.range(0.8, 1.5);
        if (P.extras > 0.35) pipeJoint(M, casing, M.pos(face), A, { ro: rsf, rp: rn, rb: rn - 0.22, n: 4, br, pipe: pipeS });

        if (P.extras > 0.6) {
            const top = cpos(depth / 2, xm, yd + 0.3), plate = roundRect(hz, hx, 0.12), rad = Math.hypot(hx, hz), pipe = pipeU;
            const og = M.add({ name: 'gasket', kind: SEAL, at: top, a: Y, e1: A, s1: 0.05, r: rad, wide: hx,
                draw(G, F) { extrude(G, F, 0, 0.05, plate, { inner: ring(outlet, G.facets(outlet)) }); if (F.da < 0) holes(G, F, 0.05, db, br * 1.15, 0.05); } });
            const of = M.add({ name: 'flange', at: mad(top, Y, 0.05), a: Y, e1: A, s1: 0.3 + pipe, r: rad, wide: hx,
                spot: (G, F) => [[F.R(0.3 + pipe * 0.5, outlet + 0.15, 0.9), F.P(0.3 + pipe * 0.5, 0, 0)], [F.R(0.3 + pipe * 0.5, outlet + 0.15, -0.9), F.P(0.3 + pipe * 0.5, 0, 0)]],
                draw(G, F) {
                    extrude(G, F, 0, 0.3, plate);
                    lathe(G, F, [[0.3, outlet + 0.15], [0.3 + pipe, outlet + 0.15]], [[0.3, 0], [0.4, 0], [0.4, outlet], [0.3 + pipe, outlet]]);
                    if (F.da < 0) holes(G, F, 0.3, db, br * 1.15, 0.3);
                } });
            const mouth = M.pin(casing, top);
            const ob = addBolts(M, db.map(([x, y]) => mad(mad(mad(top, Y, 0.35), A, x), X, y)), Y, { len: 0.8, r: br }, [of, og, mouth]);
            M.chain(Y, casing).add(og).add(of).add(ob);
            M.axis([of, og, mouth], top, Y, true);
        }

        const drive = driveEnd(M, rng, { s: sh0 + 0.1, bore: 0.42, size: rng.range(1.3, 1.7), kind: rng.pick(['coupling', 'pulley', 'flat']) });
        back.add(drive.part);
        if (P.extras > 0.45) addKey(M, shaft, 0);
        M.axis([body, bearing, shaft, slinger, seal, imp, washer, nut, gasket, casing, drive.part], M.pos(0), A, true);
        return rng.pick(['CENTRIFUGAL PUMP', 'ROTARY PUMP', 'VOLUTE PUMP', 'WATER PUMP']);
    }

    // A reduction gearbox: a case with two shafts in it, the pinion on one driving the gear on the other
    function gearbox(M, rng, P) {
        const { A, E1, E2 } = M, r1 = 0.5, r2 = 0.36, bw = 0.42, br = 0.12;
        const Rg = rng.range(1.9, 2.5), Ng = Math.round(TAU * Rg / 0.5), Np = Math.max(9, Math.round(Ng / rng.range(2.3, 3.4))), Rp = Rg * Np / Ng, pitch = TAU * Rg / Ng;
        const beta = M.beside() + rng.pick([0, PI]) + rng.range(-0.45, 0.45), cd = Rg + Rp, px = cd * Math.cos(beta), py = cd * Math.sin(beta), fw = rng.range(0.8, 1.1);
        // The case is a box, or it wraps round the two gears
        const tip = 0.3 * pitch + 0.45, wall = 0.45, dc = fw + 0.75, round = rng.chance(0.5);
        const b0 = { x0: -Rg - tip, x1: Math.max(Rg, px + Rp) + tip, y0: -Rg - tip, y1: Math.max(Rg, py + Rp) + tip };
        if (round) Object.assign(b0, { x0: Math.min(-Rg, px - Rp) - tip, y0: Math.min(-Rg, py - Rp) - tip });
        const { x0, x1, y0, y1 } = b0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, c = round ? [px * 0.3, py * 0.3] : [cx, cy];
        const shell = (grow, rad) => round ? wrapOf([[0, 0, Rg + tip + grow], [px, py, Rp + tip + grow]]) : roundRect(hx + grow, hy + grow, rad).map(q => [q[0] + cx, q[1] + cy, q[2]]);
        const inner = shell(0, 0.55), outer = shell(wall, 0.8), mid = shell(wall / 2, 0.68), bolts = [];
        // bolts round the joint, in the middle of the wall
        if (round) {
            const n = rng.int(6, 9), len = mid.map((q, i) => geo.dist(q, mid[(i + 1) % mid.length])), total = len.reduce((u, v) => u + v, 0);
            for (let k = 0, i = 0, run = 0; k < n; k++) {
                const at = total * (k + 0.5) / n;
                while (run + len[i] < at) run += len[i++];
                bolts.push(geo.lerpPt(mid[i], mid[(i + 1) % mid.length], (at - run) / len[i]));
            }
        } else {
            const bx = rng.int(2, 3), by = rng.int(1, 2);
            for (let i = 0; i <= bx; i++) for (const sy of [-1, 1]) bolts.push([cx + (hx - 0.2) * (2 * i / bx - 1), cy + sy * (hy + wall / 2)]);
            for (let i = 1; i <= by; i++) for (const sx of [-1, 1]) bolts.push([cx + sx * (hx + wall / 2), cy + (hy - 0.2) * (2 * i / (by + 1) - 1)]);
        }
        // places for a leader to land: out along rays from the middle of the case
        const rays = (poly, angles, f = 1) => rayHits(poly, c, angles).map(q => [c[0] + (q[0] - c[0]) * f, c[1] + (q[1] - c[1]) * f]);
        const crown = outer.reduce((u, v) => (v[1] > u[1] ? v : u)), reachOut = Math.max(...outer.map(q => Math.hypot(q[0], q[1])));
        const ro1 = r1 * 2.15, ro2 = r2 * 2.3;

        const body = M.add({ name: 'case', s: 0, s0: -dc - 0.3, s1: 0, r: reachOut, wide: Math.max(hx, hy) + wall,
            spot: (G, F) => rays(outer, [-0.5, 0.5, 1.6, -1.6, 2.6, -2.6]).map(([x, y]) => [F.P(-dc * 0.5, x, y), F.P(-dc * 0.5, c[0], c[1])]),
            draw(G, F) {
                extrude(G, F, -dc - 0.3, 0, outer, { inner, floor: -dc, center: c });
                if (F.da < 0) {
                    holes(G, F, 0, bolts, br * 1.15, 0.5);
                    // seats for the bearings on the floor of the case
                    for (const [x, y, r] of [[0, 0, ro1], [px, py, ro2]]) { capLoop(G, F, -dc, x, y, r + 0.14); capLoop(G, F, -dc, x, y, r); }
                }
                if (M.flat) block(G, F, -dc - 0.1, -0.45, x0 - wall - 0.55, x1 + wall + 0.55, y0 - wall - 0.3, y0 - wall + (round ? 0.45 : 0.02));
            } });
        const front = M.chain(A, body), z0 = -dc + 0.02, sg = z0 + bw + 0.17, sc = 0.05, boss = 0.5, out = sc + 0.3 + boss;
        const rear = [addBearing(M, { s: z0, ro: ro1, ri: r1, len: bw }), addBearing(M, { s: z0, x: px, y: py, ro: ro2, ri: r2, len: bw })];
        const ext1 = rng.range(1.2, 1.7), ext2 = rng.range(1.0, 1.5);
        const shaft = addShaft(M, { s: z0, segs: [[bw + 0.03, r1], [0.14, r1 * 1.4], [fw + 0.12, r1 * 1.15, 'key'], [out - (z0 + bw + 0.29 + fw), r1], [ext1, r1 * 0.85, 'key'], [0.4, r1 * 0.55, 'thread']] });
        const rootP = Rp - 0.36 * pitch;
        const pinion = addShaft(M, { name: 'pinion', s: z0, x: px, y: py, segs: [[bw + 0.12, r2], [fw + 0.1, rootP, { teeth: Np, tip: Rp + 0.3 * pitch, rot: beta + PI + PI / Np }], [out - (z0 + bw + 0.22 + fw), r2], [ext2, r2 * 0.9, 'key'], [0.35, r2 * 0.6, 'thread']] });
        const gear = addGear(M, { s: sg, R: Rg, teeth: Ng, len: fw, bore: r1 * 1.15, hub: 0.2, holes: rng.pick([0, 4, 5, 6]), rot: beta });
        const fore = [addBearing(M, { s: sc + 0.05, ro: ro1, ri: r1, len: bw }), addBearing(M, { s: sc + 0.05, x: px, y: py, ro: ro2, ri: r2, len: bw })];
        const gasket = P.extras > 0.2 && addPlate(M, { name: 'gasket', kind: SEAL, s: 0, len: sc, outline: outer, inner, center: c, holes: bolts, hole: br * 1.15,
            spot: (G, F) => rays(mid, [0.2, 1.7, -1.4, 3]).map(([x, y]) => [F.P(sc, x, y), F.P(sc, c[0], c[1])]) });
        const bosses = [[0, 0, ro1 + 0.3, r1], [px, py, ro2 + 0.28, r2]];
        const cover = M.add({ name: 'cover', s: sc, s1: 0.3 + boss, r: body.r, wide: body.wide,
            spot: (G, F) => rays(inner, [2.4, -2.4, 0.8, -0.8, 1.6, -1.6], 0.86).map(([x, y]) => [F.P(0.3, x, y), F.P(0.3, c[0], c[1])]),
            draw(G, F) {
                extrude(G, F, 0, 0.3, outer);
                if (F.da < 0) holes(G, F, 0.3, bolts, br * 1.15, 0.3);
                for (const [x, y, r, rs] of bosses) lathe(G, F.turn(0, x, y, F.a, F.e1), [[0.3, r], [0.3 + boss, r]], [[0.3, 0], [0.35, 0], [0.35, rs + 0.03], [0.3 + boss - 0.2, rs + 0.03], [0.3 + boss - 0.2, rs + 0.22], [0.3 + boss, rs + 0.22]]);
            } });
        const cb = addBolts(M, bolts.map(([x, y]) => M.pos(sc + 0.3, x, y)), A, { len: 0.9, r: br }, [cover, gasket, M.pin(body, M.pos(0))]);
        const seals = P.extras > 0.3 ? [addSeal(M, { s: out - 0.2, ro: r1 + 0.22, ri: r1, len: 0.2 }), addSeal(M, { s: out - 0.2, x: px, y: py, ro: r2 + 0.22, ri: r2, len: 0.2 })] : [];
        const d1 = driveEnd(M, rng, { s: out + 0.12, bore: r1 * 0.85, size: rng.range(1.2, 1.6), nut: r1 * 0.55, kind: rng.pick(['sprocket', 'coupling', 'pulley']) });
        const d2 = driveEnd(M, rng, { s: out + 0.12, x: px, y: py, bore: r2 * 0.9, size: rng.range(0.9, 1.25), nut: r2 * 0.6, kind: rng.pick(['pulley', 'flat', 'handwheel', 'pulley']) });
        front.add(rear).add(shaft).add(gear, pinion).add(fore).add(gasket).add(cover).add(cb).add(seals).add(d1.part, d2.part).add(d1.washer, d2.washer).add(d1.nut, d2.nut);
        addKey(M, shaft, 0);
        if (P.extras > 0.45) { addKey(M, shaft, 1); addKey(M, pinion, 0); }

        // on top: a filler plug, and a lifting eye when there's room for one
        if (P.extras > 0.55) {
            const top = round ? M.pos(-dc * 0.5, crown[0], crown[1]) : M.pos(-dc * 0.5, cx - hx * 0.4, y1 + wall), up = M.chain(E2, body);
            const plug = addBolt(M, { name: 'plug', at: mad(top, E2, 0.0), a: E2, len: 0.35, r: 0.2 });
            up.add(plug);
            M.axis([plug, M.pin(body, top)], top, E2);
            if (P.extras > 0.8 && hx > 1.6 && !round) {
                const at = M.pos(-dc * 0.5, cx + hx * 0.45, y1 + wall);
                const eye = M.add({ name: 'eye', kind: FASTEN, at, a: E2, s0: -0.3, s1: 0.75, r: 0.4, spot: [0.4, 0.38],
                    draw(G, F) {
                        lathe(G, F, [[-0.3, 0.13], [0.06, 0.13]], 0);
                        const path = Array.from({ length: 24 }, (_, i) => F.P(0.4 + 0.28 * Math.sin(TAU * i / 24), 0.28 * Math.cos(TAU * i / 24), 0));
                        tube(G, path, 0.085, true);
                    } });
                up.add(eye);
                M.axis([eye, M.pin(body, at)], at, E2);
            }
        }
        M.axis([body, rear[0], shaft, gear, fore[0], gasket, cover, seals[0], d1.part, d1.washer, d1.nut], M.pos(0), A, true);
        M.axis([body, rear[1], pinion, fore[1], gasket, cover, seals[1], d2.part, d2.washer, d2.nut], M.pos(0, px, py), A, true);
        return rng.pick(['GEAR REDUCER', 'SPEED REDUCER', 'REDUCTION GEAR', 'GEAR TRANSMISSION', 'POWER TRANSMISSION']);
    }

    // A hand winch: a rope drum between two side plates, turned by a crank through a pinion and gear
    function winch(M, rng, P) {
        const { A, E1, E2 } = M, Ld = rng.range(2.6, 3.4), Rf = rng.range(1.9, 2.4), Rb = Rf * rng.range(0.5, 0.62), tp = 0.22, rs = 0.42, fw = 0.45;
        const Np = rng.int(9, 12), Rp = Np * 0.5 / TAU, Ng = Math.round(TAU * Math.max(Rf - Rp + 0.6, Rf * 0.85) / 0.5), Rg = Ng * 0.5 / TAU, pitch = 0.5;
        // the crank shaft goes on the side away from the base
        const b0 = M.beside(), beta = (Math.sin(b0) > 0 ? b0 : b0 + PI) + rng.range(-0.35, 0.35), cd = Rg + Rp, px = cd * Math.cos(beta), py = cd * Math.sin(beta);
        const hb = Rf + 0.45, bw = Rf * 0.9, ties = [[-bw, -hb + 0.32], [bw, -hb + 0.32]];
        const outline = wrapOf([[0, 0, 1.0], [px, py, 0.62], [-bw, -hb + 0.32, 0.32], [bw, -hb + 0.32, 0.32]]);
        const bore = G => ring(rs + 0.02, G.facets(rs)), lows = (G, F, s) => [[bw * 0.5, -hb * 0.7], [-bw * 0.5, -hb * 0.7], [0, -hb + 0.3]].map(([x, y]) => [F.P(s, x, y), F.P(s, 0, 0)]);
        const plate = (G, F, s0, s1) => {
            extrude(G, F, s0, s1, outline, { inner: bore(G) });
            if (F.da < 0) { hole(G, F, s1, px, py, 0.32, tp); holes(G, F, s1, ties, 0.12, tp); }
        };

        const body = M.add({ name: 'frame', s: 0, s0: -tp, s1: 0, r: hb + 0.3, wide: 1.2, spot: (G, F) => lows(G, F, 0),
            draw(G, F) {
                plate(G, F, -tp, 0);
                block(G, F, -tp - 0.35, Ld + tp + 0.35, -bw - 0.75, bw + 0.75, -hb - 0.28, -hb);
            } });
        M.boxed(body, -tp, 0, -bw - 0.75, bw + 0.75, -hb - 0.28, 1);
        const front = M.chain(A, body), back = M.chain(neg(A), body), ds0 = 0.04 - tp - 0.6, sp = Ld + tp;
        const drum = addShaft(M, { name: 'drum', s: ds0, segs: [[0.5, 0.28, 'thread'], [tp + 0.1, rs], [0.2, Rf], [Ld - 0.48, Rb, 'rope'], [0.2, Rf], [tp + 0.2, rs], [fw + 0.75, rs * 0.9, 'key'], [0.45, 0.28, 'thread']] });
        const spacers = twin(ties.map(([x, y]) => addRing(M, { name: 'spacer', s: 0, x, y, ro: 0.2, ri: 0.11, len: Ld, spot: [Ld * 0.5, 0.2] })));
        const side = M.add({ name: 'side plate', s: Ld, s1: tp, r: hb + 0.3, wide: 1.2, spot: (G, F) => lows(G, F, tp), draw(G, F) { plate(G, F, 0, tp); } });
        M.boxed(side, Ld, sp, -bw - 0.32, bw + 0.32, -hb, 1);
        const tb = addBolts(M, ties.map(([x, y]) => M.pos(sp, x, y)), A, { len: Ld + 2 * tp + 0.3, r: 0.1 }, [side]);
        const ratchet = P.extras > 0.3 && addSprocket(M, { s: sp + 0.2, R: 0.95, teeth: 12, len: 0.18, bore: rs * 0.9, ratchet: true });
        // the pawl hangs on a stud beside the ratchet, away from the crank shaft
        const qa = beta + PI + rng.range(-0.6, 0.6), qx = 1.55 * Math.cos(qa), qy = 1.55 * Math.sin(qa);
        const pawl = ratchet && M.add({ name: 'pawl', kind: MOVING, s: sp + 0.2, x: qx, y: qy, s1: 0.18, r: 0.5, wide: 0.2,
            spot: (G, F) => [[F.P(0.18, -qx * 0.15, -qy * 0.15), F.P(0.18, -qx, -qy)]],
            draw(G, F) {
                extrude(G, F, 0, 0.18, wrapOf([[0, 0, 0.18], [-qx * 0.3 - qy * 0.12, -qy * 0.3 + qx * 0.12, 0.07]]));
                if (F.da < 0) hole(G, F, 0.18, 0, 0, 0.08, 0.18);
            } });
        const stud = pawl && addBolt(M, { name: 'stud', at: M.pos(sp + 0.38, qx, qy), a: A, len: 0.5, r: 0.07, head: 'cap' });
        if (stud) M.axis([stud, pawl, M.pin(side, M.pos(sp, qx, qy))], stud.at, A);
        const rootP = Rp - 0.36 * pitch, gs = sp + 0.45;
        const pinion = addShaft(M, { name: 'pinion', s: -tp - 0.2, x: px, y: py, segs: [[tp + 0.25, 0.3], [Ld - 0.1, 0.36], [tp + 0.4, 0.3], [fw + 0.1, rootP, { teeth: Np, tip: Rp + 0.3 * pitch, rot: beta + PI + PI / Np }], [0.25, 0.3], [0.5, 0.26, 'key'], [0.3, 0.18, 'thread']] });
        const gear = addGear(M, { s: gs, R: Rg, teeth: Ng, len: fw, bore: rs * 0.9, hub: 0.25, holes: rng.pick([4, 5, 6]), rot: beta });
        const we = sp + 0.16 + fw + 0.75, washer = addWasher(M, { s: we, r: 0.28 }), nut = addNut(M, { s: we + washer.s1, r: 0.28 });
        const cs = gs + fw + 0.37, crank = addCrank(M, { s: cs, x: px, y: py, len: rng.range(2, 2.7), bore: 0.26, ang: beta + rng.range(-0.6, 0.6) });
        const grip = addGrip(M, { at: M.pos(cs + 0.26, px + crank.hand[0], py + crank.hand[1]), a: A, len: rng.range(1.1, 1.5) });
        const cn = addNut(M, { s: cs + 0.28, x: px, y: py, r: 0.18 });
        front.add(spacers, drum).add(side).add(tb).add(ratchet, pawl, pinion).add(stud).add(gear).add(washer, crank).add(nut, grip).add(cn);
        const rw = addWasher(M, { s: -tp - 0.07, r: 0.28, len: 0.07 }), rn = addNut(M, { s: -tp - 0.5, r: 0.28, len: 0.42 });
        const tn = twin(ties.map(([x, y]) => addNut(M, { s: -tp - 0.18, x, y, r: 0.1, len: 0.18 })));
        back.add(rw, tn).add(rn);
        addKey(M, drum, 0);
        if (P.extras > 0.5) addKey(M, pinion, 0);
        M.axis([rn, rw, body, drum, side, ratchet, gear, washer, nut], M.pos(0), A, true);
        M.axis([pinion, crank, cn, M.pin(side, M.pos(sp, px, py))], M.pos(0, px, py), A, true);
        M.axis([grip, M.pin(crank, M.pos(cs + 0.26, px + crank.hand[0], py + crank.hand[1]))], grip.at, A);
        ties.forEach(([x, y], i) => M.axis([tn[i], M.pin(body, M.pos(-tp, x, y))], M.pos(0, x, y), A));
        return rng.pick(['HAND WINCH', 'WINDLASS', 'HOISTING WINCH', 'CABLE HOIST', 'CRAB WINCH']);
    }

    // A gate valve: a body with a pipe flange either side, the gate on its stem, the
    // bonnet bolted on over them, and the packing, gland and handwheel on top
    function valve(M, rng, P) {
        const { A, E1, E2 } = M, rB = rng.range(1.5, 1.9), rN = rB * 0.86, rF = rN + 0.75, tf = 0.3, nb = rng.pick([6, 8]), br = 0.13;
        const globe = rng.chance(0.45), dome = rB * 0.6, rp = rB * rng.range(0.5, 0.6), rpf = rp + 0.7, np = rp > 1 ? 6 : 4, sN = -1.2 - rp, Rg = rB * 1.12;
        const Hb = globe ? Rg - sN : dome + 2 * rp + 1.4 + rng.range(0, 0.3), Lx = (globe ? Rg : rB) + rng.range(1, 1.5), rw = globe ? Rg : rB;
        const bc = circleOf(nb, (rF + rN) / 2 + 0.04, PI / nb), jp = circleOf(np, (rpf + rp) / 2 + 0.02, PI / np), prof = [[-Hb, 0]];
        if (globe) {
            // round from the bottom up to where the neck starts
            const t1 = Math.acos(-(sN + 1) / Rg);
            for (let i = 1; i <= 30; i++) { const t = t1 * i / 30; prof.push([sN - Rg * Math.cos(t), Rg * Math.sin(t), i < 30 ? 1 : 0]); }
        } else {
            for (let i = 1; i <= 18; i++) { const t = PI / 2 * i / 18; prof.push([-Hb + dome * (1 - Math.cos(t)), rB * Math.sin(t), 1]); }
            prof.push([-1, rB]);
        }
        prof.push([-0.72, rN], [-tf, rN], [-tf, rF], [0, rF]);
        const body = M.add({ name: 'body', s: 0, s0: -Hb, s1: 0, r: Lx, wide: rF, spot: [-tf / 2, rF],
            draw(G, F) {
                lathe(G, F, prof, [[-Hb, 0], [-Hb + 0.4, 0], [-Hb + 0.4, rN - 0.22], [0, rN - 0.22]]);
                if (F.da < 0) holes(G, F, 0, bc, br * 1.15, tf);
                for (const a of [E1, neg(E1)]) {
                    const T = F.turn(sN, 0, 0, a, E2);
                    // the branch starts where its side meets the body, so none of it shows inside
                    const sb = Math.sqrt(rw * rw - rp * rp);
                    lathe(G, T, [[sb, rp], [Lx - 0.3, rp], [Lx - 0.3, rpf], [Lx, rpf]], [[sb, 0], [Lx - 0.8, 0], [Lx - 0.8, rp - 0.2], [Lx, rp - 0.2]]);
                    if (T.da < 0) holes(G, T, Lx, jp, br * 1.15, 0.3);
                    saddle(G, T, rw, rp, globe);
                }
            } });
        const front = M.chain(A, body), Hn = rng.range(2, 2.6), top = 0.05 + Hn, rg = rp + 0.1;
        const gasket = P.extras > 0.2 && addRing(M, { name: 'gasket', kind: SEAL, s: 0, ro: rF, ri: rN - 0.22, len: 0.05, holes: bc, hole: br * 1.15 });
        const rq = rp * 0.85, gate = globe
            ? M.add({ name: 'plug', kind: MOVING, s: sN + 0.1, s1: 0.55, r: rq, spot: [0.25, rq],
                draw(G, F) { lathe(G, F, [[0, rq * 0.7], [0.12, rq], [0.3, rq], [0.3, 0.32], [0.55, 0.32]], 0); } })
            : M.add({ name: 'gate', kind: MOVING, at: M.pos(sN), a: E1, s0: -0.17, s1: 0.17, r: rg + 0.4, wide: rg, spot: [0.17, rg * 0.6, 1],
                draw(G, F) { lathe(G, F, [[-0.17, rg], [0.17, rg]], 0); block(G, F, -0.24, 0.24, -0.3, 0.3, rg - 0.08, rg + 0.4); } });
        const st0 = globe ? sN + 0.65 : sN + rg + 0.3, Ls = top + 1.35 - st0;
        const stem = addShaft(M, { name: 'stem', s: st0, segs: [[Ls - 1.5, 0.2, 'thread'], [0.9, 0.2], [0.35, 0.16], [0.25, 0.12, 'thread']] });
        const h1 = 0.35, bonnet = M.add({ name: 'bonnet', s: 0.05, s1: Hn, r: rF, spot: [0.3, (rF + rN) / 2, 1],
            draw(G, F) {
                lathe(G, F, [[0, rF], [0.3, rF], [0.3, rN], [0.3 + h1, rN], [Hn - 0.75, 0.62], [Hn, 0.62]], [[0, 0.24], [Hn - 0.55, 0.24], [Hn - 0.55, 0.42], [Hn, 0.42]]);
                if (F.da < 0) holes(G, F, 0.3, bc, br * 1.15, 0.3);
                thread(G, F, Hn - 0.5, Hn, 0.62);
            } });
        const bolts = addBolts(M, bc.map(([x, y]) => M.pos(0.35, x, y)), A, { len: 0.8, r: br }, [bonnet, gasket, M.pin(body, M.pos(0))]);
        const packs = rng.int(2, 3), pipes = [rng.range(0.7, 1.2), rng.range(0.7, 1.2)];
        const packing = P.extras > 0.4 ? twin(Array.from({ length: packs }, (_, i) => addRing(M, { name: 'packing', kind: SEAL, s: top - 0.55 + i * 0.16, ro: 0.42, ri: 0.2, len: 0.14 }))) : [];
        const gland = M.add({ name: 'gland', s: top - 0.2, s1: 0.42, r: 0.55, spot: [0.36, 0.55],
            draw(G, F) { lathe(G, F, [[0, 0.4], [0.3, 0.4], [0.3, 0.55], [0.42, 0.55]], 0.21); } });
        const cap = M.add({ name: 'packing nut', kind: FASTEN, s: top - 0.35, s1: 0.68, r: 0.95, spot: [0.25, 0.9],
            draw(G, F) {
                extrude(G, F, 0, 0.5, ngon(0.95, 6, HEX), { inner: ring(0.64, G.facets(0.64)) });
                lathe(G, F, [[0.5, 0.8], [0.68, 0.55]], 0.24);
            } });
        const wheel = addHandwheel(M, { s: top + 0.78, r: rng.range(1.5, 2.1), bore: 0.16, spokes: rng.int(3, 6) });
        const washer = addWasher(M, { s: top + 1.3, r: 0.12 }), nut = addNut(M, { s: top + 1.3 + washer.s1, r: 0.12 });
        front.add(gasket).add(gate).add(stem).add(bonnet).add(bolts);
        for (const q of packing) front.add(q);
        front.add(gland).add(cap).add(wheel).add(washer).add(nut);
        // pipe joints, the one facing the camera first
        const sides = (dot(M.d, E1) < 0 ? [E1, neg(E1)] : [neg(E1), E1]).slice(0, P.extras > 0.75 ? 2 : P.extras > 0.3 ? 1 : 0);
        const joints = sides.map((a, i) => pipeJoint(M, body, mad(M.pos(sN), a, Lx), a, { ro: rpf, rp, rb: rp - 0.2, n: np, br, pipe: pipes[i] }));
        if (joints.length > 1) for (const k of ['gasket', 'flange', 'bolts']) twin(joints.flatMap(j => j[k]));
        M.axis([body, gasket, stem, bonnet, ...packing, gland, cap, wheel, washer, nut], M.pos(0), A, true);
        return rng.pick(globe ? ['GLOBE VALVE', 'STOP VALVE', 'FLUID CONTROL VALVE'] : ['GATE VALVE', 'SLUICE VALVE', 'SHUTOFF VALVE']);
    }

    // An electric motor: a finned frame with the rotor drawn out of it, an end bell
    // either side, and a fan under its cowl on the far end
    function motor(M, rng, P) {
        const { A, E1, E2 } = M, Rm = rng.range(1.9, 2.35), Lm = rng.range(3.2, 4.4), h = Lm / 2, rs = Rm * 0.62, rsh = 0.42, hf = 0.2, br = 0.11, ra = Rm - 0.5;
        // the shell: fins all round but for the side it stands on and a gap under the terminal box
        const shell = [], a0 = -PI / 4, a1 = PI * 1.25, n = Math.floor((a1 - a0) * Rm / 0.34), tau = (a1 - a0) / n;
        for (let i = 0; i < n; i++) {
            const a = a0 + (i + 0.5) * tau;
            if (Math.abs(a - PI / 2) < 0.34) { shell.push([Rm * Math.cos(a), Rm * Math.sin(a), 1]); continue; }
            for (const [r, da] of [[Rm, -0.25], [Rm + hf, -0.2], [Rm + hf, 0.2], [Rm, 0.25]]) shell.push([r * Math.cos(a + da * tau), r * Math.sin(a + da * tau), 0]);
        }
        for (let i = 1; i < 10; i++) { const a = a1 + (TAU - (a1 - a0)) * i / 10; shell.push([Rm * Math.cos(a), Rm * Math.sin(a), 1]); }
        const fb = circleOf(4, Rm - 0.25, PI / 4), bx = 0.62, bs = 0.68, ty = Rm + hf + 0.4, mount = rng.chance(0.4), RF = Rm + rng.range(0.5, 0.8), fh = circleOf(rng.pick([4, 4, 6]), RF - 0.28, PI / 4);
        const feet = [[-h + 0.55, -Rm - 0.05], [h - 0.55, -Rm - 0.05], [h - 0.55, Rm + 0.05], [-h + 0.55, Rm + 0.05]];
        const body = M.add({ name: 'frame', s: 0, s0: -h, s1: h, r: Rm + hf, spot: [0, Rm + hf],
            draw(G, F) {
                extrude(G, F, -h, h, shell, { inner: ring(rs, G.facets(rs)), thin: true });
                const flat = Math.abs(F.da) * G.k;
                if (F.da < 0 && 0.24 * flat >= FINE) {
                    // the stator: its core and the slots in it
                    capLoop(G, F, h, 0, 0, rs + 0.24);
                    for (const [x, y] of circleOf(Math.max(8, Math.min(24, Math.floor(TAU * rs * flat / 2.2))), 1)) G.line([F.P(h, x * rs, y * rs), F.P(h, x * (rs + 0.24), y * (rs + 0.24))]);
                }
                block(G, F, -bs, bs, -bx, bx, Rm - 0.15, ty);
                if (!M.flat || mount) return;
                block(G, F, -h + 0.2, h - 0.2, -Rm - 0.35, Rm + 0.35, -Rm - 0.3, -Rm + 0.15);
                const T = F.turn(0, 0, -Rm + 0.15, E2, A);
                if (T.da < 0) holes(G, T, 0, feet, 0.12, 0.45);
            } });
        M.boxed(body, -h, h, -Rm - 0.35, Rm + 0.35, -Rm - 0.3, ty);
        const front = M.chain(A, body), back = M.chain(neg(A), body), Lc = Lm - 0.9, r0 = -Lc / 2 - 1.53, ext = rng.range(1.3, 1.8);
        const rotor = addShaft(M, { name: 'rotor', s: r0, segs: [[0.55, 0.3], [0.7, rsh], [0.15, rsh * 1.3], [0.13, rs - 0.2], [Lc, rs - 0.06, 'bars'], [0.13, rs - 0.2], [0.15, rsh * 1.3], [0.6, rsh], [ext, rsh * 0.85, 'key']] });
        const ro = rsh * 2.1, b1 = addBearing(M, { s: h + 0.02, ro, ri: rsh, len: 0.4 }), b2 = addBearing(M, { s: -h - 0.53, ro, ri: rsh, len: 0.4 });
        // the bolts that hold the end bell on go in from its face, or from behind its flange
        const bell = M.add({ name: mount ? 'flange' : 'end bell', s: h, s1: 1, r: mount ? RF : Rm, spot: mount ? [0.62, RF - 0.1, 1] : [0.3, (Rm + ra) / 2, 1],
            draw(G, F) {
                const out = mount ? [[0, Rm], [0.3, Rm], [0.3, ra], [0.45, ra], [0.45, RF], [0.62, RF], [0.62, Rm * 0.78], [0.72, Rm * 0.78], [0.72, 1], [1, 1]] : [[0, Rm], [0.3, Rm], [0.3, ra], [0.75, 1], [1, 1]];
                lathe(G, F, out, [[0, ro + 0.02], [0.45, ro + 0.02], [0.45, rsh + 0.03], [0.8, rsh + 0.03], [0.8, rsh + 0.22], [1, rsh + 0.22]]);
                if (F.da < 0) holes(G, F, mount ? 0.62 : 0.3, mount ? fh : fb, br * 1.15, 0.3);
            } });
        const fbolts = mount ? [] : addBolts(M, fb.map(([x, y]) => M.pos(h + 0.3, x, y)), A, { len: 0.75, r: br }, [bell, M.pin(body, M.pos(h))]);
        const drive = driveEnd(M, rng, { s: h + 1.1, bore: rsh * 0.85, size: rng.range(1, 1.5), kind: rng.pick(['pulley', 'pulley', 'flat', 'sprocket', 'coupling']) });
        front.add(rotor).add(b1).add(bell).add(fbolts).add(drive.part);
        if (P.extras > 0.3) addKey(M, rotor, 0);
        const rear = M.add({ name: 'end bell', s: -h, s0: -1, s1: 0, r: Rm, spot: [0, Rm - 0.11, 1],
            draw(G, F) { lathe(G, F, [[-1, 1], [-0.75, 1], [-0.3, ra], [-0.3, Rm], [0, Rm]], [[-1, rsh + 0.03], [-0.55, rsh + 0.03], [-0.55, ro + 0.02], [-0.12, ro + 0.02], [-0.12, Rm - 0.22], [0, Rm - 0.22]]); } });
        twin([bell, rear]);
        const rbolts = addBolts(M, fb.map(([x, y]) => M.pos(-h - 0.3, x, y)), neg(A), { len: 0.75, r: br });
        twin([...fbolts, ...rbolts]);
        const blades = rng.int(5, 8), Rfan = Rm - 0.45, fan = [], bt = TAU / blades;
        for (let i = 0; i < blades; i++) for (const [r, da] of [[0.55, -0.34], [Rfan, -0.3], [Rfan, 0.3], [0.55, 0.34]]) fan.push([r * Math.cos(i * bt + da * bt), r * Math.sin(i * bt + da * bt), 0]);
        const blower = P.extras > 0.25 && M.add({ name: 'fan', kind: MOVING, s: r0 + 0.04, s1: 0.5, r: Rfan, spot: [0.12, Rfan * 0.75, 1],
            draw(G, F) { extrude(G, F, 0, 0.12, fan, { inner: ring(0.3, G.facets(0.3)) }); lathe(G, F, [[0.12, 0.55], [0.5, 0.55]], 0.3); } });
        const c0 = r0 - 0.35, c1 = -h - 0.32, cowl = blower && M.add({ name: 'cowl', s: c0, s1: c1 - c0, r: Rm, spot: [(c1 - c0) * 0.5, Rm],
            draw(G, F) { const L = c1 - c0; lathe(G, F, [[0, Rm - 0.3], [0.3, Rm], [L, Rm]], [[0, 0], [0.08, 0], [0.08, Rm - 0.1], [L, Rm - 0.1]]); } });
        back.add(b2).add(rear).add(rbolts).add(blower).add(cowl);
        if (P.extras > 0.5) {
            const top = M.pos(0, 0, ty), lid = addPlate(M, { name: 'lid', at: top, a: E2, len: 0.08, outline: roundRect(bs, bx, 0.1), wide: bx,
                spot: (G, F) => [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([i, j]) => [F.P(0.08, i * bs * 0.5, j * bx * 0.5), F.P(0.08, 0, 0)]) });
            const sp = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => mad(mad(mad(top, E2, 0.08), A, i * (bs - 0.15)), E1, j * (bx - 0.15)));
            const screws = addBolts(M, sp, E2, { len: 0.4, r: 0.06, head: 'cap' }, [lid, M.pin(body, top)]);
            M.chain(E2, body).add(lid).add(screws);
        }
        M.axis([cowl, blower, rear, b2, body, rotor, b1, bell, drive.part], M.pos(0), A, true);
        return rng.pick(['ELECTRIC MOTOR', 'INDUCTION MOTOR', 'DYNAMO-ELECTRIC MACHINE', 'ALTERNATING CURRENT MOTOR']);
    }

    // A flashlight: a tube for the cells with a flared head, the reflector, bulb and
    // lens in front of it, and a spring and a screw cap behind
    function torch(M, rng, P) {
        const { A, E2 } = M, rb = rng.range(0.85, 1.05), Lb = rng.range(4.6, 6), rh = rb * rng.range(1.3, 2.1), wall = 0.09, hl = rng.range(1, 1.9), sw = -rng.range(1.2, 1.9);
        const body = M.add({ name: 'case', s: 0, s0: -Lb, s1: hl, r: rh, wide: rb, spot: [sw - 0.9, rb],
            draw(G, F) {
                lathe(G, F, [[-Lb, rb], [0, rb], [hl * 0.7, rh], [hl, rh]], [[-Lb, rb - wall], [0, rb - wall], [hl * 0.7, rh - wall], [hl, rh - wall]]);
                thread(G, F, -Lb, -Lb + 0.45, rb);
                knurl(G, F, -Lb + 0.8, sw - 1.1, rb, true);
                block(G, F, sw - 0.55, sw + 0.55, -0.26, 0.26, rb - 0.06, rb + 0.1);
            } });
        const front = M.chain(A, body), back = M.chain(neg(A), body), R1 = rh - wall - 0.03, Lr = hl - 0.35;
        const dish = (r0, r1) => Array.from({ length: 9 }, (_, i) => [Lr * i / 8, r0 + (r1 - r0) * Math.sqrt(i / 8), i > 0 && i < 8 ? 1 : 0]);
        const reflector = M.add({ name: 'reflector', s: 0.1, s1: Lr, r: R1, spot: [[Lr * 0.5, 0.34 + (R1 - 0.34) * Math.SQRT1_2], [Lr, R1, 1], [Lr * 0.75, 0.34 + (R1 - 0.34) * Math.sqrt(0.75)]],
            draw(G, F) { lathe(G, F, dish(0.34, R1), dish(0.26, R1 - 0.07)); } });
        const glass = [];
        for (let i = 0; i <= 12; i++) { const t = 0.68 + (PI - 0.68) * i / 12; glass.push([0.61 - 0.27 * Math.cos(t), Math.max(0, 0.27 * Math.sin(t)), i > 0 && i < 12 ? 1 : 0]); }
        const bulb = M.add({ name: 'bulb', s: -0.2, s1: 0.88, r: 0.27, spot: [0.2, 0.17],
            draw(G, F) { lathe(G, F, [[0, 0.17], ...glass], 0); thread(G, F, 0, 0.38, 0.17); } });
        const lens = addRing(M, { name: 'lens', s: hl - 0.14, ro: R1 + 0.02, len: 0.06 });
        const bezel = M.add({ name: 'bezel', s: hl - 0.3, s1: 0.5, r: rh + 0.09, spot: [0.25, rh + 0.09],
            draw(G, F) {
                lathe(G, F, [[0, rh + 0.09], [0.5, rh + 0.09]], [[0, rh + 0.005], [0.36, rh + 0.005], [0.36, rh - 0.2], [0.5, rh - 0.2]]);
                knurl(G, F, 0.12, 0.38, rh + 0.09);
            } });
        front.add(reflector).add(bulb).add(lens).add(bezel);
        // the cells come out of the back, the front one last
        const n = Lb > 5.4 ? 3 : 2, rc = rb - wall - 0.04, Lc = (Lb - 0.75) / n;
        const cells = twin(Array.from({ length: n }, (_, i) => M.add({ name: 'cell', s: -0.1 - (i + 1) * Lc, s1: Lc, r: rc, spot: [Lc * 0.5, rc],
            draw(G, F) { lathe(G, F, [[0, rc], [Lc - 0.1, rc], [Lc - 0.1, 0.24], [Lc, 0.24]], 0); bands(G, F, [Lc * 0.1, Lc * 0.82], rc); } })));
        const spring = addSpring(M, { s: -Lb + 0.14, len: 0.5, r: rc * 0.6, wire: 0.05, turns: 4 });
        const cap = M.add({ name: 'cap', s: -Lb - 0.3, s1: 0.75, r: rb + 0.1, spot: [0.4, rb + 0.1],
            draw(G, F) {
                lathe(G, F, [[0, rb + 0.1], [0.75, rb + 0.1]], [[0, 0], [0.12, 0], [0.12, rb + 0.005], [0.75, rb + 0.005]]);
                knurl(G, F, 0.16, 0.6, rb + 0.1);
            } });
        for (const c of cells) back.add(c);
        back.add(spring).add(cap);
        // the switch slides on a seat on the side
        if (P.extras > 0.3) {
            const at = M.pos(sw, 0, rb + 0.1), slide = M.add({ name: 'switch', kind: MOVING, at, a: E2, s1: 0.16, r: 0.3, wide: 0.2,
                spot: (G, F) => [[F.P(0.16, 0.2, 0), F.P(0.16, 0, 0)], [F.P(0.16, -0.2, 0), F.P(0.16, 0, 0)]],
                draw(G, F) { block(G, F, 0, 0.16, -0.3, 0.3, -0.17, 0.17); if (F.da < 0 && 0.2 * G.k * F.c > FINE) for (const x of [-0.1, 0.1]) G.line([F.P(0.16, x, -0.17), F.P(0.16, x, 0.17)]); } });
            M.chain(E2, body).add(slide);
            M.axis([slide, M.pin(body, at)], at, E2);
        }
        M.axis([cap, spring, ...cells, body, reflector, bulb, lens, bezel], M.pos(0), A, true);
        return rng.pick(['ELECTRIC TORCH', 'FLASH LIGHT', 'PORTABLE ELECTRIC LIGHT', 'HAND LAMP']);
    }

    // An engine cylinder: the crankcase with its shaft out of the side, the connecting rod
    // and piston, the finned barrel over them, and the head with its bolts and plug
    function engine(M, rng, P) {
        const { A, E2 } = M, rc = rng.range(1.25, 1.55), ro = rc + 0.16, Hc = rng.range(3.2, 4.2), rfin = ro + rng.range(0.5, 0.75), rfl = ro + 0.62, br = 0.12;
        const bq = (ro + 0.36) * Math.SQRT1_2, studs = [[bq, bq], [-bq, bq], [-bq, -bq], [bq, -bq]], cw = rfl + 0.25, Hk = rng.range(2.4, 3), sb = -Hk * 0.55, fins = rng.int(6, 9);
        const body = M.add({ name: 'crankcase', s: 0, s0: -Hk, s1: 0, r: cw * 1.3, wide: cw,
            spot: (G, F) => [[cw, -cw * 0.5], [-cw * 0.5, cw], [cw, cw * 0.4]].map(([x, y]) => [F.P(-Hk * 0.8, x, y), F.P(-Hk * 0.8, 0, 0)]),
            draw(G, F) {
                extrude(G, F, -Hk, 0, roundRect(cw, cw, 0.45), { inner: ring(ro + 0.02, G.facets(ro)), floor: -Hk + 0.4 });
                if (F.da < 0) holes(G, F, 0, studs, br * 1.15, 0.5);
                // the crankshaft comes out of the side that faces the camera
                const T = F.turn(sb, 0, cw, E2, A);
                lathe(G, T, [[0, 1], [0.3, 1], [0.3, 0.42], [1.75, 0.42]], 0);
                thread(G, T, 1.35, 1.75, 0.42);
            } });
        M.boxed(body, -Hk, 0, -cw, cw, -cw, cw + 1.75);
        const front = M.chain(A, body), Lr = rng.range(2.6, 3.2), sp = sb + Lr, rp = rc - 0.02, hp = rc * 1.5, p0 = sp - hp * 0.5;
        const gasket = P.extras > 0.2 && addRing(M, { name: 'gasket', kind: SEAL, s: 0, ro: rfl, ri: ro + 0.02, len: 0.05, holes: studs, hole: br * 1.15 });
        const link = wrapOf([[-Lr / 2, 0, 0.62], [Lr / 2, 0, 0.36]]);
        const rod = M.add({ name: 'connecting rod', kind: MOVING, at: M.pos(sb + Lr / 2), a: E2, s0: -0.2, s1: 0.2, r: Lr / 2 + 0.62, wide: 0.62,
            spot: (G, F) => [[F.P(0.2, 0, 0.28), F.P(0.2, 0, 0)], [F.P(0.2, 0, -0.28), F.P(0.2, 0, 0)]],
            draw(G, F) {
                extrude(G, F, -0.2, 0.2, link, { inner: ring(0.4, G.facets(0.4)).map(q => [q[0] - Lr / 2, q[1], 1]), center: [-Lr / 2, 0] });
                if (F.da > 0) return;
                hole(G, F, 0.2, Lr / 2, 0, 0.2, 0.4);
                if (0.16 * G.k * Math.abs(F.da) >= FINE) for (const y of [-1, 1]) G.line([F.P(0.2, -Lr / 2 + 0.75, y * 0.24), F.P(0.2, Lr / 2 - 0.5, y * 0.15)]);
            } });
        const piston = M.add({ name: 'piston', kind: MOVING, s: p0, s1: hp, r: rp, spot: [hp * 0.25, rp],
            draw(G, F) {
                lathe(G, F, [[0, rp], [hp, rp]], [[0, rp - 0.14], [hp - 0.3, rp - 0.14], [hp - 0.3, 0], [hp, 0]]);
                const gap = Math.max(0.14, FINE / (G.k * F.c));
                bands(G, F, [1, 2, 3].map(i => hp - 0.04 - i * gap).filter(s => s > hp * 0.62), rp);
                saddle(G, F.turn(hp * 0.5, 0, 0, E2, cross(F.a, E2)), rp, 0.2);
            } });
        const pin = M.add({ name: 'pin', kind: FASTEN, at: M.pos(sp), a: E2, s0: -rp * 0.85, s1: rp * 0.85, r: 0.2, spot: [rp * 0.5, 0.2],
            draw(G, F) { lathe(G, F, [[-rp * 0.85, 0.2], [rp * 0.85, 0.2]], 0.11); } });
        const rings = twin(Array.from({ length: rng.int(2, 3) }, (_, i) => addRing(M, { name: 'ring', kind: SEAL, s: p0 + hp - 0.2 - i * 0.15, ro: rc, ri: rc - 0.13, len: 0.07 })));
        const barrel = M.add({ name: 'cylinder', s: 0.05, s1: Hc, r: rfl, wide: rfin, spot: [Hc - 0.08, ro],
            draw(G, F) {
                // as many fins as stay apart on paper
                const n = Math.max(2, Math.min(fins, Math.floor((Hc - 0.75) * G.k * F.c / (2.6 * FINE)))), pitch = (Hc - 0.75) / n, t = pitch * 0.42, outer = [[0, rfl], [0.3, rfl], [0.3, ro]];
                for (let i = 0; i < n; i++) { const z = 0.6 + i * pitch; outer.push([z, ro], [z, rfin], [z + t, rfin], [z + t, ro]); }
                lathe(G, F, outer.concat([[Hc, ro]]), rc);
                if (F.da < 0) holes(G, F, 0.3, studs, br * 1.15, 0.3);
            } });
        const hg = P.extras > 0.2 && addRing(M, { name: 'gasket', kind: SEAL, s: 0.05 + Hc, ro: ro + 0.25, ri: rc, len: 0.05 });
        if (gasket && hg) twin([gasket, hg]);
        const rH = Math.max(rfin, ro + 0.68), hs = 0.1 + Hc;
        const head = M.add({ name: 'head', s: hs, s1: 0.95, r: rH, spot: [0.14, rH],
            draw(G, F) {
                lathe(G, F, [[0, rH], [0.28, rH], [0.28, ro + 0.06], [0.5, ro + 0.06], [0.5, rH * 0.5], [0.72, rH * 0.5], [0.72, 0.45], [0.95, 0.45]], [[0, rc], [0.12, rc], [0.12, 0.14], [0.95, 0.14]]);
                if (F.da < 0) holes(G, F, 0.28, studs, br * 1.15, 0.28);
            } });
        const Ls = hs + 0.28 + 0.4 + 0.5, posts = twin(studs.map(([x, y]) => addShaft(M, { name: 'stud', kind: FASTEN, s: -0.5, x, y, segs: [[0.5, br, 'thread'], [Ls - 1, br], [0.5, br, 'thread']] })));
        const hb = twin(studs.map(([x, y]) => addNut(M, { s: hs + 0.28, x, y, r: br, len: 0.26 })));
        studs.forEach(([x, y], i) => M.axis([hb[i], M.pin(head, M.pos(hs + 0.28, x, y)), M.pin(barrel, M.pos(0.35, x, y)), posts[i]], M.pos(0, x, y), A));
        const plug = M.add({ name: 'plug', kind: FASTEN, s: hs + 0.95, s0: -0.3, s1: 1.02, r: 0.3, spot: [0.6, 0.16],
            draw(G, F) {
                lathe(G, F, [[-0.3, 0.13], [0, 0.13]], 0);
                extrude(G, F, 0, 0.22, ngon(0.3, 6, HEX));
                lathe(G, F, [[0.22, 0.22], [0.32, 0.22], [0.85, 0.11], [0.85, 0.07], [1.02, 0.07]], 0);
            } });
        front.add(gasket).add(rod).add(piston);
        for (const q of rings) front.add(q);
        front.add(barrel).add(hg).add(head).add(hb).add(plug);
        M.chain(E2, piston).add(pin);
        M.axis([pin, M.pin(piston, M.pos(sp))], M.pos(sp), E2);
        const shaft = M.pos(sb, 0, cw), wheel = addPulley(M, { name: 'flywheel', at: mad(shaft, E2, 0.42), a: E2, r: rng.range(1.5, 2), len: rng.range(0.5, 0.7), bore: 0.42, flat: true, holes: rng.pick([0, 4, 6]) });
        const washer = addWasher(M, { at: mad(shaft, E2, 0.44 + wheel.s1), a: E2, r: 0.42, ro: 0.72 }), nut = addNut(M, { at: mad(shaft, E2, 0.44 + wheel.s1 + washer.s1), a: E2, r: 0.42, len: 0.3 });
        M.chain(E2, body).add(wheel).add(washer).add(nut);
        M.axis([nut, washer, wheel, M.pin(body, shaft)], shaft, E2, true);
        M.axis([body, gasket, piston, ...rings, barrel, hg, head, plug], M.pos(0), A, true);
        return rng.pick(['INTERNAL COMBUSTION ENGINE', 'ENGINE CYLINDER', 'AIR COMPRESSOR', 'MOTOR CYLINDER']);
    }

    // A friction clutch: the flywheel, the lined disc on its splined hub, the pressure
    // plate with its springs, and the cover bolted on over them
    function clutch(M, rng, P) {
        const { A } = M, R = rng.range(2.7, 3.3), Rd = R - 0.55, ri = R * 0.52, nb = rng.pick([6, 8]), ns = rng.pick([6, 6, 9]), br = 0.11, rs = (Rd + ri) / 2;
        const bc = circleOf(nb, R - 0.22, PI / nb), sc = circleOf(ns, rs, 0.2), teeth = Math.round(TAU * R / 0.36), slots = rng.pick([8, 12, 16]);
        const spline = (G, F) => toothy(G, F, 0.283) ? gearOutline(10, 0.42, 0.52) : ring(0.5, G.facets(0.5));
        const body = M.add({ name: 'flywheel', kind: MOVING, s: 0, s0: -0.95, s1: 0, r: R + 0.16, spot: [-0.12, R],
            draw(G, F) {
                const cut = toothy(G, F, TAU * R / teeth), rim = cut ? [] : [[-0.55, R + 0.16], [-0.25, R + 0.16], [-0.25, R]];
                lathe(G, F, [[-0.95, R * 0.4], [-0.55, R * 0.4], ...(cut ? [[-0.55, R]] : rim), [0, R]], [[-0.95, 0], [-0.4, 0], [-0.4, 0.34], [-0.12, 0.34], [-0.12, ri - 0.15], [0, ri - 0.15]]);
                // the ring gear for the starter
                if (cut) extrude(G, F, -0.55, -0.25, gearOutline(teeth, R, R + 0.16), { center: [0, 0], thin: true });
                if (F.da < 0) holes(G, F, 0, bc, br * 1.15, 0.4);
            } });
        const front = M.chain(A, body);
        const disc = M.add({ name: 'disc', kind: MOVING, s: 0.02, s1: 0.5, r: Rd, spot: [0.12, (Rd + ri) / 2, 1],
            draw(G, F) {
                lathe(G, F, [[0, Rd], [0.12, Rd]], 0.56);
                extrude(G, F, 0.12, 0.5, ring(0.95, G.facets(0.95)), { inner: spline(G, F) });
                if (F.da > 0) return;
                capLoop(G, F, 0.12, 0, 0, ri);
                // the gaps between the pads of the lining
                const n = Math.min(slots, Math.floor(TAU * ri * G.k * Math.abs(F.da) / 2.5));
                for (const [x, y] of circleOf(n, 1, 0.1)) G.line([F.P(0.12, x * (ri + 0.12), y * (ri + 0.12)), F.P(0.12, x * (Rd - 0.12), y * (Rd - 0.12))]);
            } });
        const plate = M.add({ name: 'pressure plate', s: 0.16, s1: 0.3, r: Rd, spot: [0.15, Rd],
            draw(G, F) {
                lathe(G, F, [[0, Rd], [0.3, Rd]], ri);
                if (!diaphragm && F.da < 0 && 0.12 * G.k * Math.abs(F.da) >= FINE) for (const [x, y] of sc) capLoop(G, F, 0.3, x, y, 0.42);
            } });
        const diaphragm = rng.chance(0.45), rin = ri * 0.62, rd = Rd - 0.12, fingers = rng.pick([12, 16, 18]);
        const springs = diaphragm ? [M.add({ name: 'diaphragm spring', kind: SEAL, s: 0.5, s1: 0.42, r: rd, spot: [0.21, (rd + rin) / 2 + 0.03],
            draw(G, F) {
                // a dished plate, slit into fingers from the middle out to about half way
                turned(G, F, [[0.36, rin], [0.42, rin], [0.06, rd], [0, rd]]);
                if (F.da > 0) return;
                const rm = rin + (rd - rin) * 0.55, at = r => 0.42 - 0.36 * (r - rin) / (rd - rin) + 0.004, n = Math.min(fingers, Math.floor(TAU * rin * G.k * Math.abs(F.da) / 2));
                for (const [x, y] of circleOf(n, 1, 0.13)) G.line([F.P(at(rin), x * rin, y * rin), F.P(at(rm), x * rm, y * rm)]);
            } })] : twin(sc.map(([x, y]) => addSpring(M, { s: 0.48, x, y, len: 0.8, r: 0.24, wire: 0.055, turns: 4.5 })));
        if (!diaphragm) springs.forEach((q, i) => M.axis([q, M.pin(plate, M.pos(0.46, sc[i][0], sc[i][1]))], M.pos(0, sc[i][0], sc[i][1]), A));
        const rop = ri * 0.8, cover = M.add({ name: 'cover', s: 0.02, s1: 1.35, r: R, spot: [0.7, Rd + 0.1],
            draw(G, F) {
                turned(G, F, [[0, Rd + 0.03], [1.27, Rd + 0.03], [1.27, rop], [1.35, rop], [1.35, Rd - 0.05], [1.2, Rd + 0.1], [0.1, Rd + 0.1], [0.1, R], [0, R]]);
                if (F.da < 0) holes(G, F, 0.1, bc, br * 1.15, 0.1);
            } });
        const bolts = addBolts(M, bc.map(([x, y]) => M.pos(0.12, x, y)), A, { len: 0.6, r: br }, [cover, M.pin(body, M.pos(0))]);
        const bearing = addBearing(M, { name: 'release bearing', s: 1.55, ro: 0.98, ri: 0.52, len: 0.4 });
        const shaft = addShaft(M, { s: -0.38, segs: [[0.28, 0.33], [0.65, 0.4, { teeth: 10, tip: 0.5 }], [rng.range(2, 2.6), 0.52], [rng.range(0.9, 1.3), 0.42, 'key']] });
        front.add(disc).add(plate).add(springs).add(cover).add(bolts).add(bearing).add(shaft);
        if (P.extras > 0.4) addKey(M, shaft, 0);
        M.axis([body, disc, plate, cover, bearing, shaft], M.pos(0), A, true);
        return rng.pick(['FRICTION CLUTCH', 'CLUTCH MECHANISM', 'DISK CLUTCH', 'POWER COUPLING']);
    }

    // ------------------------------------------------------------------
    // Drawing a machine
    // ------------------------------------------------------------------

    function drawParts(G, M, whole) {
        for (const p of M.parts) {
            p.F = null;
            // smaller than a dot of the pen, or a gasket squeezed between two flanges
            if (!G.dry && (p.r * G.k < 0.5 || (whole && p.name === 'gasket'))) continue;
            G.kind(p.kind);
            p.F = frame(G, [p.at[0] + p.off[0], p.at[1] + p.off[1], p.at[2] + p.off[2]], p.a, p.e1);
            p.draw(G, p.F);
        }
    }

    // Center lines: long and short dashes along every axis. They are lines in the
    // scene like any other, so parts hide them.
    const DASH = [7, 1.3, 1.1, 1.3], FAR = 30;
    function centerLines(G, M) {
        G.kind(CENTER);
        for (const L of M.axes) {
            // a small drawing only has room for the main ones
            if (!L.whole && (G.T < 0.5 || L.parts[0].r * G.k < 0.5)) continue;
            const dir = L.dir, moved = p => (p.host || p).off, off = moved(L.parts[0]), side = mad(off, dir, -dot(off, dir)), t0 = dot(L.at, dir);
            const dd = dot(G.d, dir), per = G.k * Math.sqrt(Math.max(0.02, 1 - dd * dd));   // mm of paper per unit along it
            const spans = L.parts.map(p => { const [a, b] = reach(p, dir), o = dot(moved(p), dir); return [a + o, b + o, p.host ? 0 : L.whole ? 3.5 : 2.2]; });
            let [lo, hi, padLo] = spans[0], padHi = padLo;
            // take in the rest, nearest first, as far as the first long gap
            const rest = spans.slice(1).map(q => [Math.max(0, q[0] - hi, lo - q[1]), q]).sort((u, v) => u[0] - v[0]);
            for (const [, q] of rest) {
                if (!L.whole && Math.max(0, q[0] - hi, lo - q[1]) * per > FAR * G.T) break;
                if (q[0] < lo) { lo = q[0]; padLo = q[2]; }
                if (q[1] > hi) { hi = q[1]; padHi = q[2]; }
            }
            if ((hi - lo) * per < 4) continue;
            const P = t => [L.at[0] + side[0] + dir[0] * (t - t0), L.at[1] + side[1] + dir[1] * (t - t0), L.at[2] + side[2] + dir[2] * (t - t0)];
            const end = hi + padHi / per, size = Math.min(1, G.T * 1.4);
            for (let t = lo - padLo / per, i = 0; t < end; i++) {
                const len = DASH[i % 4] * size / per;
                if (i % 2 === 0) G.line([P(t), P(Math.min(end, t + len))]);
                t += len;
            }
        }
    }

    // The outline of a drawing on paper at 1 mm to the unit, about where the origin lands
    function outlineOf(M, yaw, elev, lines) {
        const K = 8, B = 2e5, G = context(yaw, elev, K, B, B, 2 * B, 2 * B, true), pts = [];
        G.T = 1;
        drawParts(G, M);
        if (lines) centerLines(G, M);
        for (const L of G.S.lines) for (const q of L.q) pts.push([(q[0] - B) / K, (q[1] - B) / K]);
        return PG.iso.hull(pts);
    }

    // The gap between two convex polygons, negative when they overlap
    function apart(A, B) {
        let gap = -Infinity;
        for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
            const p = poly[i], q = poly[(i + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (l < 1e-9) continue;
            const nx = (q[1] - p[1]) / l, ny = -(q[0] - p[0]) / l;
            let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
            for (const v of A) { const t = v[0] * nx + v[1] * ny; if (t < a0) a0 = t; if (t > a1) a1 = t; }
            for (const v of B) { const t = v[0] * nx + v[1] * ny; if (t < b0) b0 = t; if (t > b1) b1 = t; }
            gap = Math.max(gap, b0 - a1, a0 - b1);
        }
        return gap;
    }

    // Scale and place the figures: [{ k, x, y }], the mm per unit and where the origin
    // goes. The first is the exploded view. An assembled view goes in a corner at the
    // same scale if there's room, or smaller, with the exploded view moved over to suit.
    function arrange(ctx, hulls, T, top, plain, cap) {
        const W = ctx.width, H = ctx.height, pad = 9 * T, pad2 = 5 * T;
        const bb = hulls.map(h => geo.bbox([h])), a = bb[0];
        const grow = fits => { let lo = 0, hi = 400; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } return lo; };
        if (!plain) {
            // a crop or a turned page: fit the one figure about the middle of what shows
            const R = geo.bbox([ctx.shape.polygon()]), cx = (R.minX + R.maxX) / 2, cy = (R.minY + R.maxY) / 2, mx = (a.minX + a.maxX) / 2, my = (a.minY + a.maxY) / 2;
            const k = grow(k => hulls[0].every(q => ctx.shape.dist(cx + k * (q[0] - mx), cy + k * (q[1] - my)) >= pad * 0.6));
            return [{ k, x: cx - k * mx, y: cy - k * my }];
        }
        const one = Math.min((W - 2 * pad) / a.w, (H - top - 2 * pad - cap) / a.h);
        const mid = k => ({ k, x: W / 2 - k * (a.minX + a.maxX) / 2, y: top + (H - top - cap) / 2 - k * (a.minY + a.maxY) / 2 });
        if (hulls.length < 2) return [mid(one)];
        const b = bb[1];
        let best = null;
        for (const [right, low] of [[1, 1], [0, 0], [1, 0], [0, 1]]) for (const ratio of [1, 0.8, 0.65, 0.5]) {
            const place = k => {
                const k2 = k * ratio;
                if (k * a.w + 2 * pad > W || k * a.h + 2 * pad + cap > H - top || k2 * b.w + 2 * pad2 > W || k2 * b.h + 2 * pad2 + cap > H - top) return null;
                const x2 = right ? W - pad2 - k2 * b.maxX : pad2 - k2 * b.minX, y2 = low ? H - cap - pad2 - k2 * b.maxY : top + pad2 - k2 * b.minY;
                const x1 = right ? pad - k * a.minX : W - pad - k * a.maxX, y1 = low ? top + pad - k * a.minY : H - cap - pad - k * a.maxY;
                // the second figure with its caption under it
                const B = hulls[1].map(q => [x2 + k2 * q[0], y2 + k2 * q[1]]), bx = x2 + k2 * (b.minX + b.maxX) / 2, by = y2 + k2 * b.maxY + cap;
                const B2 = PG.iso.hull(B.concat([[bx - 9 * T, by], [bx + 9 * T, by]]));
                const sep = (x, y) => apart(hulls[0].map(q => [x + k * q[0], y + k * q[1]]), B2);
                if (sep(x1, y1) < pad) return null;
                // slide the first figure back towards the middle as far as the second allows
                const c = mid(k), t = grow(t => t <= 1 && sep(x1 + (c.x - x1) * t, y1 + (c.y - y1) * t) >= pad);
                return [{ k, x: x1 + (c.x - x1) * t, y: y1 + (c.y - y1) * t }, { k: k2, x: x2, y: y2 }];
            };
            const k = grow(k => k <= one && !!place(k)), score = k * Math.pow(ratio, 0.3);
            if (k > 0 && (!best || score > best.score * 1.02)) best = { score, figs: place(k) };
        }
        return best && best.figs ? best.figs : [mid(one)];
    }

    // ------------------------------------------------------------------
    // Part numbers
    // ------------------------------------------------------------------

    // Where the ink is, on a grid, so numbers and captions can go where there's room.
    // Center lines are marked apart from the rest: a leader can cross them, a number can't sit on them.
    function inkMap(W, H) {
        const cell = 0.6, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1, g = new Uint8Array(gw * gh);
        const ci = x => Math.min(gw - 1, Math.max(0, Math.floor(x / cell))), cj = y => Math.min(gh - 1, Math.max(0, Math.floor(y / cell)));
        return {
            at: (x, y) => x < 0 || y < 0 || x > W || y > H ? 0 : g[cj(y) * gw + ci(x)],
            add(path, bit = 1) {
                for (let i = 1; i < path.length; i++) {
                    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(geo.dist(a, b) / (cell * 0.5)));
                    for (let k = 0; k <= n; k++) g[cj(a[1] + (b[1] - a[1]) * k / n) * gw + ci(a[0] + (b[0] - a[0]) * k / n)] |= bit;
                }
            },
            box(x0, y0, x1, y1, fill) {
                for (let j = cj(y0); j <= cj(y1); j++) for (let i = ci(x0); i <= ci(x1); i++) {
                    if (fill) g[j * gw + i] = 1;
                    else if (g[j * gw + i]) return true;
                }
                return false;
            },
        };
    }

    // Points on a part that a leader can end on, each with the middle of the part
    // there, which says which way is out
    function spots(p, G) {
        const F = p.F;
        if (!F) return [];
        if (typeof p.spot === 'function') return p.spot(G, F);
        const list = p.spot && Array.isArray(p.spot[0]) ? p.spot : [p.spot || [(p.s0 + p.s1) / 2, p.r]];
        return list.flatMap(([s, r, face]) => (face ? [1.1, -1.1, 2, -2, 0.4, -0.4, 2.8] : [0.95, -0.95, 0.5, -0.5, 1.3, -1.3])
            .map(phi => [F.R(s, face ? r : r * 1.004 + 0.002, phi), F.P(s, 0, 0)]));
    }

    // A number for every part, in a clear spot off the part, with a leader curving in
    // to a point on it that the camera can see. Bolts of one set share a number.
    function numberParts(G, M, ink, ctx, T, into) {
        const h = 3.1 * T, groups = [], marks = inkMap(ctx.width, ctx.height), placed = [];
        for (const p of M.parts) {
            if (!p.tag || (p.twins && p.twins.done)) continue;
            groups.push(p.twins || [p]);
            if (p.twins) p.twins.done = true;
        }
        // room for two digits, whatever the number turns out to be
        const hw = textWidth('88', h) / 2 + 1, hh = h / 2 + 1;
        const DIST = [5, 6.5, 8, 10, 12.5, 15.5, 19, 23, 28].map(v => v * T), BEND = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.3, -1.3];
        // the usual distances and bends, and for a part that gets nowhere with those, further out
        const tries = [[DIST, BEND], [[32, 38, 45].map(v => v * T), [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2]]];
        for (const parts of groups) {
            let best = null;
            for (const [DIST, BEND] of tries) {
                if (best) break;
                parts.forEach((p, pi) => spots(p, G).forEach(([P, C], ai) => {
                    if (G.hidden(P)) return;
                    const a = G.flat(P), c = G.flat(C), base = Math.atan2(a[1] - c[1], a[0] - c[0]), own = geo.clamp(0.3 * p.r * G.k, 1.5, 6);
                    for (const turn of BEND) for (const dist of DIST) {
                        const cost = dist + 4 * Math.abs(turn) + 2 * ai + 0.5 * pi;
                        if (best && cost >= best.cost) continue;
                        const ux = Math.cos(base + turn), uy = Math.sin(base + turn), te = Math.min(hw / (Math.abs(ux) || 1e-9), hh / (Math.abs(uy) || 1e-9));
                        const x = a[0] + ux * (dist + te), y = a[1] + uy * (dist + te);
                        if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].some(([i, j]) => ctx.shape.dist(x + i * hw, y + j * hh) < 1)) continue;
                        if (ink.box(x - hw - 0.5, y - hh - 0.5, x + hw + 0.5, y + hh + 0.5) || marks.box(x - hw - 1, y - hh - 1, x + hw + 1, y + hh + 1)) continue;
                        // the leader bows a little, like one drawn along a curve
                        const sx = a[0] + ux * dist, sy = a[1] + uy * dist, bow = 0.09 * dist, n = Math.ceil(dist / 0.3), path = [];
                        let hits = 0, was = false, crossed = false;
                        for (let i = 0; i <= n; i++) {
                            const f = i / n, w = 4 * f * (1 - f) * bow, q = [sx + (a[0] - sx) * f - uy * w, sy + (a[1] - sy) * f + ux * w];
                            path.push(q);
                            if (marks.at(q[0], q[1])) { crossed = true; break; }
                            const on = (1 - f) * dist > own && !!(ink.at(q[0], q[1]) & 1);
                            if (on && !was) hits++;
                            was = on;
                        }
                        if (crossed || hits > 1 || (best && cost + 7 * hits >= best.cost)) continue;
                        best = { cost: cost + 7 * hits, x, y, path };
                    }
                }));
            }
            if (!best) continue;
            placed.push(best);
            for (const m of [ink, marks]) {
                m.add(best.path);
                m.box(best.x - hw, best.y - hh, best.x + hw, best.y + hh, true);
            }
        }
        placed.forEach((q, i) => {
            into.push(q.path);
            for (const stroke of letter(String(10 + i), q.x, q.y, h)) into.push(stroke);
        });
    }

    // A caption under a figure: below its middle if that's clear, or as near to
    // that as there's room, then moved up into any clear space under the drawing
    function caption(str, hull, fig, ink, T, W, into) {
        const h = 4 * T, b = geo.bbox([hull]), hw = textWidth(str, h) / 2 + 3 * T, hh = h / 2 + 2.5 * T;
        const mid = fig.x + fig.k * (b.minX + b.maxX) / 2, floor = fig.y + fig.k * b.maxY + 2 * T + hh, ceil = fig.y + fig.k * (b.minY + b.maxY) / 2, half = fig.k * b.w / 2;
        let x = mid, y = floor;
        for (let i = 0; i * 4 * T <= half; i++) {
            const at = [mid + i * 4 * T, mid - i * 4 * T].find(c => c - hw >= 0 && c + hw <= W && !ink.box(c - hw, floor - hh, c + hw, floor + hh));
            if (at !== undefined) { x = at; break; }
        }
        while (y > ceil && !ink.box(x - hw, y - 1 - hh, x + hw, y - 1 + hh)) y -= 1;
        for (const q of letter(str, x, y, h, { slant: 0.2 })) into.push(q);
        ink.box(x - hw, y - hh, x + hw, y + hh, true);
    }

    // ------------------------------------------------------------------

    const MACHINES = { gearbox, pump, winch, valve, motor, engine, clutch, torch };
    const YAW = [20, 68];

    PG.register({
        id: 'exploded', name: 'Exploded View', category: 'Studies', fit: false,
        description: 'A sheet from an invented patent: a gearbox, pump, winch, valve, motor, engine, clutch, or flashlight pulled apart along its axes, with center lines, leader lines, and part numbers.',
        params: [
            { type: 'section', label: 'Machine' },
            { id: 'kind', label: 'Type', type: 'select', value: 'gearbox', random: true, options: [['gearbox', 'Gear reducer'], ['pump', 'Centrifugal pump'], ['winch', 'Hand winch'], ['valve', 'Gate valve'], ['motor', 'Electric motor'], ['engine', 'Engine cylinder'], ['clutch', 'Friction clutch'], ['torch', 'Flashlight']] },
            { id: 'explode', label: 'Pulled apart (%)', type: 'range', min: 0, max: 150, step: 1, value: 100, random: [85, 125], hint: '0 puts the machine back together' },
            { id: 'extras', label: 'Small parts', type: 'range', min: 0, max: 1, step: 0.05, value: 0.7, random: [0.4, 1], hint: 'Gaskets, keys, seals, and pipe fittings are added as this goes up' },
            { type: 'section', label: 'Sheet' },
            { id: 'axis', label: 'Layout', type: 'select', value: 'flat', random: true, options: [['flat', 'Across the page'], ['up', 'Up the page']] },
            { id: 'flip', label: 'Mirror', type: 'checkbox', value: false, random: 0.5, hint: 'Draws the machine mirrored' },
            { id: 'assembled', label: 'Assembled view', type: 'checkbox', value: true, random: 0.75, hint: 'Adds the machine put together as Fig. 2' },
            { id: 'numbers', label: 'Part numbers', type: 'checkbox', value: true },
            { id: 'centers', label: 'Center lines', type: 'checkbox', value: true },
            { id: 'header', label: 'Lettering', type: 'checkbox', value: true, random: 0.85, hint: 'A patent number, title, and date along the top, and a caption under each figure' },
            { type: 'section', label: 'View' },
            { id: 'turn', label: 'Camera turn (°)', type: 'range', min: -25, max: 25, step: 0.5, value: 0, random: [-8, 8], hint: 'At 0 a machine drawn across the page runs along its diagonal' },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 55, step: 0.25, value: 35.25, random: [30, 42], hint: '35.25 is true isometric' },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx, out = PG.pens.partLayers('exploded', p);
            const flat = p.axis !== 'up', poly = ctx.shape.polygon(), small = Math.min(W, H) < 70;
            const plain = (!ctx.shape.kind || ctx.shape.kind === 'rect') && poly.length === 4 && poly.every(q => Math.min(Math.abs(q[0]), Math.abs(q[0] - W)) < 1e-6 && Math.min(Math.abs(q[1]), Math.abs(q[1] - H)) < 1e-6);
            const T = geo.clamp(Math.min(W, H) / 180, small ? 0.2 : 0.62, 1.5), top = plain && p.header && !small ? 9 * T : 0;
            // A shaft lying down runs up the page at about the slope of its diagonal
            const slope = geo.clamp(Math.atan2(H - top - 20 * T, W - 18 * T) * 0.95, 0.4, 0.92);
            const fit = flat ? geo.deg(Math.atan(Math.tan(slope) / Math.sin(geo.rad(p.elev)))) : 45;
            const yaw = geo.clamp(fit + p.turn, YAW[0], YAW[1]) * (p.flip ? -1 : 1), d = viewDir(yaw, p.elev);
            const A = flat ? [p.flip ? 1 : -1, 0, 0] : [0, 0, 1], E2 = flat ? [0, 0, 1] : [0, -1, 0];
            const M = new Machine(A, cross(E2, A), E2, flat, d);
            // one kind of bolt head through a machine: hexagons, or round heads with a socket
            M.head = rng.pick(['hex', 'hex', 'cap']);
            const info = (MACHINES[p.kind] || gearbox)(M, rng, p);
            const E = p.explode / 100, apartNow = E > 0.04, lines = apartNow && p.centers;

            explode(M, E, d);
            const hulls = [outlineOf(M, yaw, p.elev, lines)];
            if (p.assembled && apartNow && plain && !small) { explode(M, 0, d); hulls.push(outlineOf(M, yaw, p.elev, false)); explode(M, E, d); }
            const figs = arrange(ctx, hulls, T, top, plain, p.header ? 8 * T : 0), ink = inkMap(W, H);
            const figure = (fig, whole) => {
                const G = context(yaw, p.elev, fig.k, fig.x, fig.y, W, H);
                G.T = T;
                drawParts(G, M, whole);
                if (fig === figs[0] && lines) centerLines(G, M);
                const done = PG.iso.render(G.S), ends = new Map(), cell = q => Math.round(q[0] * 8) + ':' + Math.round(q[1] * 8);
                // The hidden line pass leaves short bits where a line just shows past an edge.
                // A short bit that carries on into another line is part of the drawing, so
                // only the ones that touch nothing go.
                const tips = q => [q[0], q[q.length - 1]];
                done.forEach(paths => { for (const q of paths) for (const e of tips(q)) ends.set(cell(e), (ends.get(cell(e)) || 0) + 1); });
                const alone = e => { let n = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += ends.get(cell([e[0] + i / 8, e[1] + j / 8])) || 0; return n < 2; };
                done.forEach((paths, kind) => {
                    const into = out.of(kind);
                    for (const q of paths) {
                        const len = geo.pathLength(q);
                        if (len < (kind === CENTER ? 0.45 : SPECK) && (kind === CENTER || tips(q).every(alone))) continue;
                        into.push(q);
                        ink.add(q, kind === CENTER ? 2 : 1);
                    }
                });
                return G;
            };
            if (top) {
                // the heading of a patent sheet: its number, the title and the date
                const hr = new PG.RNG(ctx.seed * 31 + Object.keys(MACHINES).indexOf(p.kind) + 0x51ed), year = hr.int(1889, 1958), h = 2.5 * T, y = 3.6 * T, into = out.of(TEXT);
                const no = Math.round(geo.lerp(395000, 2870000, Math.pow((year - 1889) / 70, 1.25)) + hr.int(0, 30000)).toString().replace(/\B(?=(\d{3})+$)/g, ',');
                const date = `${hr.pick(['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUNE', 'JULY', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.'])} ${hr.int(1, 28)}, ${year}`;
                for (const q of letter(info, W / 2, y, 4.8 * T)) into.push(q);
                if (textWidth(info, 4.8 * T) + 2 * Math.max(textWidth('NO. ' + no, h), textWidth(date, h)) + 16 * T < W) {
                    for (const q of letter('NO. ' + no, 1, y + 1.1 * T, h, { align: 'left' })) into.push(q);
                    for (const q of letter(date, W - 1, y + 1.1 * T, h, { align: 'right' })) into.push(q);
                }
                // numbers and captions keep out of it
                ink.box(0, 0, W, top, true);
            }
            // the assembled view goes down first, so the numbers of the other keep off it
            if (figs[1]) { explode(M, 0, d); figure(figs[1], true); explode(M, E, d); }
            const G = figure(figs[0], !apartNow);
            if (p.numbers && !small) numberParts(G, M, ink, ctx, T, out.of(LABEL));
            if (plain && !small && p.header) {
                if (figs[1]) caption('FIG. 2', hulls[1], figs[1], ink, T, W, out.of(TEXT));
                caption('FIG. 1', hulls[0], figs[0], ink, T, W, out.of(TEXT));
            }
            return out.done();
        },
    });
})();
