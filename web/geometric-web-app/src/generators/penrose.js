/*
 * Penrose tilings by Robinson-triangle deflation. Every tile is split along
 * its axis into two mirror-image triangles, [type, A, B, C] with A the apex;
 * each deflation step replaces a triangle by smaller ones (scaled by 1/φ)
 * placed at golden-ratio points of its sides.
 *
 *  - P3 rhombs (Preshing's rules): a thin rhomb is two 36° golden
 *    triangles joined along their bases BC, a thick rhomb two 108° golden
 *    gnomons. Legs AB, AC are the rhomb edges.
 *  - P2 kites and darts: a half-kite is [tip, side vertex, tail] and a
 *    half-dart [notch, wing, nose]; the leg AC is the tile's axis. These
 *    rules were checked to give an edge-to-edge tiling showing exactly
 *    the seven legal vertex stars (sun, star, ace, deuce, jack, queen, king).
 *
 * The start patch (a wheel of ten half-rhombs, or a "sun" of five kites) is
 * sized so it covers the page after the number of deflations that brings
 * the edge down to the requested length; triangles that leave the page are
 * dropped as soon as they do, since their descendants stay inside them.
 *
 * Matching arcs are circular arcs about tile corners that cross every edge
 * at right angles, so arcs of neighbouring tiles join into smooth curves.
 * On kites and darts they are Penrose's own (radii 1 and ψ about the kite's
 * tip and tail, ψ and ψ² about the dart's nose and notch, in short-edge
 * units), cutting every edge in the golden ratio. The two families touch on
 * each tile's axis; that is forced (joining needs tip + nose = φ and
 * tail + notch = 1, so keeping them apart in the kite makes them cross in
 * the dart and vice versa). On rhombs, the radii
 * satisfy the joining constraints of the tiling while keeping the two arcs
 * of a thin rhomb apart.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const PHI = (1 + Math.sqrt(5)) / 2, PSI = 1 / PHI, PSI2 = PSI * PSI, PSI3 = PSI2 * PSI;
    const lerp = geo.lerpPt;

    // Deflation rules. P3: 0 = half thin rhomb, 1 = half thick rhomb. P2: 0 = half kite, 1 = half dart.
    const RULES = {
        P3([t, A, B, C]) {
            if (t === 0) { const P = lerp(A, B, PSI); return [[0, C, P, B], [1, P, C, A]]; }
            const Q = lerp(B, A, PSI), R = lerp(B, C, PSI);
            return [[1, R, C, A], [1, Q, R, B], [0, R, Q, A]];
        },
        P2([t, A, B, C]) {
            if (t === 0) {
                const X = lerp(A, C, PSI), Y = lerp(A, B, PSI2);
                return [[0, B, C, X], [0, B, Y, X], [1, Y, X, A]];
            }
            const Z = lerp(B, C, PSI2);
            return [[0, C, Z, A], [1, Z, A, B]];
        },
    };

    // Start patches of circumradius R around (cx, cy): the tile edge is R for both.
    function startPatch(kind, cx, cy, R, rot) {
        const T = [], at = (r, a) => [cx + r * Math.cos(a + rot), cy + r * Math.sin(a + rot)];
        if (kind === 'P3') {
            // wheel of ten thin half-rhombs, alternately mirrored so neighbours share like legs
            for (let i = 0; i < 10; i++) {
                let B = at(R, ((2 * i - 1) * Math.PI) / 10), C = at(R, ((2 * i + 1) * Math.PI) / 10);
                if (i % 2 === 0) [B, C] = [C, B];
                T.push([0, [cx, cy], B, C]);
            }
        } else {
            // sun: five kites with their tips at the centre (long edge R)
            for (let i = 0; i < 5; i++) {
                const a = (i * TAU) / 5;
                for (const s of [-1, 1]) T.push([0, [cx, cy], at(R, a + (s * Math.PI) / 5), at(R, a)]);
            }
        }
        return T;
    }

    // Tile edges of a half-tile (the axis / shared diagonal is internal).
    function tileEdges(kind, [, A, B, C]) {
        return kind === 'P3' ? [[A, B], [A, C]] : [[A, B], [B, C]];
    }

    // Matching arcs of a half-tile: { c: centre, from, to: points fixing the start/end
    // directions, r, fam }. Each arc runs from a tile edge to the internal axis.
    function tileArcs(kind, [t, A, B, C]) {
        if (kind === 'P3') {
            const e = geo.dist(A, B);
            // family 0 about B: thin ψ³, thick 1 − ψ³ (their centres sit at opposite ends
            // of shared edges); family 1 about C: ψ³ on both (same centres).
            return [
                { c: B, from: A, to: C, r: e * (t === 0 ? PSI3 : 1 - PSI3), fam: 0 },
                { c: C, from: A, to: B, r: e * PSI3, fam: 1 },
            ];
        }
        if (t === 0) { // kite: tip arc across the long edges, tail arc across the short ones
            const s = geo.dist(B, C);
            return [{ c: A, from: B, to: C, r: s, fam: 0 }, { c: C, from: B, to: A, r: s * PSI, fam: 1 }];
        }
        const s = geo.dist(A, B); // dart: nose arc across the long edges, notch arc across the short ones
        return [{ c: C, from: B, to: A, r: s * PSI, fam: 0 }, { c: A, from: B, to: C, r: s * PSI2, fam: 1 }];
    }

    // Inset a simple polygon (convex or not, like a dart) by moving every edge
    // inward by d and meeting neighbouring edges again. Returns [] once an edge
    // would flip over, i.e. the polygon has collapsed.
    function insetPoly(poly, d) {
        const n = poly.length, s = geo.polygonArea(poly) > 0 ? 1 : -1;
        const lines = poly.map((a, i) => {
            const b = poly[(i + 1) % n], L = geo.dist(a, b);
            const nx = (-s * (b[1] - a[1])) / L, ny = (s * (b[0] - a[0])) / L; // inward normal
            return { p: [a[0] + nx * d, a[1] + ny * d], dir: [b[0] - a[0], b[1] - a[1]] };
        });
        const out = [];
        for (let i = 0; i < n; i++) {
            const l0 = lines[(i + n - 1) % n], l1 = lines[i];
            const X = geo.lineIntersect(l0.p, l0.dir, l1.p, l1.dir);
            if (!X) return [];
            out.push([X.x, X.y]);
        }
        for (let i = 0; i < n; i++) {
            const a = out[i], b = out[(i + 1) % n], e = lines[i].dir;
            if ((b[0] - a[0]) * e[0] + (b[1] - a[1]) * e[1] <= 0) return [];
        }
        return out;
    }

    function arcPath({ c, from, to, r }) {
        const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
        let da = Math.atan2(to[1] - c[1], to[0] - c[0]) - a0;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        return geo.arc(c[0], c[1], r, a0, a0 + da);
    }

    PG.register({
        id: 'penrose',
        name: 'Penrose Tiling',
        category: 'Tiles',
        description: 'Aperiodic rhomb or kite-and-dart tilings with five-fold symmetry and matching arcs.',
        fit: false,
        params: [
            { type: 'section', label: 'Tiling' },
            { id: 'kind', label: 'Tiles', type: 'select', value: 'P3', random: true,
                options: [['P3', 'Rhombs (P3)'], ['P2', 'Kites & darts (P2)']] },
            { id: 'edge', label: 'Edge length (mm)', type: 'range', min: 3, max: 60, step: 0.5, value: 14, random: [8, 24],
                hint: 'Long edge for kites and darts' },
            { id: 'centre', label: 'Centre', type: 'select', value: 'sun', random: ['sun', 'sun', 'random'],
                options: [['sun', 'Five-fold centre'], ['random', 'Anywhere']] },
            { type: 'section', label: 'Style' },
            { id: 'outline', label: 'Tile outlines', type: 'checkbox', value: true },
            { id: 'decor', label: 'Decoration', type: 'select', value: 'arcs', random: ['arcs', 'arcs', 'hatch', 'nested', 'none'],
                options: [['arcs', 'Matching arcs'], ['hatch', 'Hatching'], ['nested', 'Nested outlines'], ['none', 'None']] },
            { id: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.5, max: 5, step: 0.05, value: 1.2, random: [0.9, 2],
                show: p => p.decor === 'hatch' || p.decor === 'nested' },
            { id: 'gap', label: 'Gap (mm)', type: 'range', min: 0, max: 4, step: 0.1, value: 0.8, random: [0.4, 1.6],
                show: p => p.decor === 'hatch' || p.decor === 'nested', hint: 'Space between the fill and the tile edges' },
            { id: 'which', label: 'Fill', type: 'select', value: 'both', random: true,
                show: p => p.decor === 'hatch' || p.decor === 'nested',
                options: [['both', 'Both tiles'], ['0', 'Thin rhombs / kites'], ['1', 'Thick rhombs / darts']] },
            { type: 'section', label: 'Pens' },
            { id: 'split', label: 'Decoration on pens 2–3', type: 'checkbox', value: true, random: false,
                hint: 'Outlines on pen 1; arc families or tile types on pens 2 and 3' },
        ],

        randomize(rng, p) {
            const out = {};
            // arcs read best with the tiles; hatching and nesting often look better alone
            if (p.decor === 'arcs' || p.decor === 'none') out.outline = p.decor === 'none' || rng.chance(0.6);
            else out.outline = rng.chance(0.5);
            if (p.decor === 'nested' || p.decor === 'hatch') {
                // filling one tile type leaves islands: bigger tiles and a slimmer gap keep them substantial
                out.edge = Math.max(p.edge, p.which === 'both' ? 12 : 16);
                if (p.which !== 'both') out.gap = Math.min(p.gap, 1);
            }
            return out;
        },

        generate(p, ctx) {
            const { width: W, height: H, rng } = ctx;
            const kind = p.kind === 'P2' ? 'P2' : 'P3';
            const rule = RULES[kind];
            const edge = Math.max(1, p.edge);

            // what must be covered: the visible region's bounding box
            const bb = geo.bbox([ctx.shape.polygon()]);
            let cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
            if (p.centre === 'random') {
                const a = rng.range(0, TAU), d = rng.range(0.6, 3) * Math.max(bb.w, bb.h);
                cx += d * Math.cos(a); cy += d * Math.sin(a);
            }
            let need = 0;
            for (const [x, y] of [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.minX, bb.maxY], [bb.maxX, bb.maxY]]) {
                need = Math.max(need, Math.hypot(x - cx, y - cy));
            }
            need /= Math.cos(Math.PI / 10); // the start patch is a decagon; its inradius must reach the corners
            const gens = Math.max(0, Math.ceil(Math.log(need / edge) / Math.log(PHI)));
            const R = edge * Math.pow(PHI, gens);

            // keep a tile's width of margin so a half on the page keeps its twin
            // (hatch and nested fills then fill edge tiles whole, not as triangles)
            const pad = 2 * edge;
            const onPage = ([, A, B, C]) =>
                Math.max(A[0], B[0], C[0]) >= bb.minX - pad && Math.min(A[0], B[0], C[0]) <= bb.maxX + pad &&
                Math.max(A[1], B[1], C[1]) >= bb.minY - pad && Math.min(A[1], B[1], C[1]) <= bb.maxY + pad;
            let tris = startPatch(kind, cx, cy, R, p.centre === 'random' ? rng.range(0, TAU) : -Math.PI / 2);
            for (let g = 0; g < gens && tris.length < 120000; g++) {
                const next = [];
                for (const t of tris) for (const c of rule(t)) if (onPage(c)) next.push(c);
                tris = next;
            }

            const split = p.split;
            const layers = [[], [], []];

            if (p.outline) {
                const seen = new Set();
                const key = q => `${Math.round(q[0] * 1e4)},${Math.round(q[1] * 1e4)}`;
                for (const t of tris) for (const [a, b] of tileEdges(kind, t)) {
                    const ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
                    if (!seen.has(k)) { seen.add(k); layers[0].push([a, b]); }
                }
            }

            if (p.decor === 'arcs') {
                for (const t of tris) for (const a of tileArcs(kind, t)) layers[split ? 1 + a.fam : 0].push(arcPath(a));
            } else if (p.decor === 'hatch' || p.decor === 'nested') {
                // pair the halves back into whole tiles (the twin shares the axis)
                const key = q => `${Math.round(q[0] * 1e4)},${Math.round(q[1] * 1e4)}`;
                const axis = ([, A, B, C]) => (kind === 'P3' ? [B, C] : [A, C]);
                const byAxis = new Map();
                for (const t of tris) {
                    const [u, v] = axis(t), ku = key(u), kv = key(v);
                    const k = ku < kv ? ku + '|' + kv : kv + '|' + ku;
                    if (byAxis.has(k)) byAxis.get(k).push(t); else byAxis.set(k, [t]);
                }
                for (const pair of byAxis.values()) {
                    const t = pair[0], type = t[0];
                    if (p.which !== 'both' && String(type) !== p.which) continue;
                    const [, A, B, C] = t;
                    // whole tile when both halves are present; a half at the page edge is still worth filling
                    let poly;
                    if (pair.length === 2) {
                        // the twin's vertex off the shared axis: its apex for rhombs, its B for kites and darts
                        const D = kind === 'P3' ? pair[1][1] : pair[1][2];
                        poly = kind === 'P3' ? [A, B, D, C] : [B, A, D, C];
                    } else poly = [A, B, C];
                    poly = geo.cleanPolygon(poly);
                    if (poly.length < 3) continue;
                    const out = layers[split ? 1 + type : 0];
                    const inner = p.gap > 0 ? insetPoly(poly, p.gap) : poly;
                    if (inner.length < 3) continue;
                    const convex = !(kind === 'P2' && type === 1 && poly.length === 4); // a whole dart is concave
                    if (p.decor === 'nested') {
                        if (convex) out.push(geo.insetSpiral(inner, p.spacing));
                        else for (let ring = inner; ring.length; ring = insetPoly(ring, p.spacing)) out.push(geo.close(ring));
                    } else {
                        // hatch parallel to a tile edge, so tiles of one orientation share a direction
                        const e0 = kind === 'P3' ? [B, A] : [A, B];
                        const ang = Math.atan2(e0[1][1] - e0[0][1], e0[1][0] - e0[0][0]);
                        if (convex) { const z = geo.hatchZigzag(inner, p.spacing, ang); if (z.length > 1) out.push(z); }
                        else out.push(...geo.hatch(inner, p.spacing, ang));
                    }
                }
            }
            return { layers };
        },
    });
})();
