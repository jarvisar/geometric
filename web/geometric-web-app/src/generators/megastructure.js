/*
 * Megastructure: a tower block crammed with slab stacks, fin arrays, piers
 * and recessed grilles, drawn in isometric outline like a machine the size of
 * a building.
 *
 * The block is built on a grid of small cells by filling and carving boxes.
 * Every cell remembers the part it belongs to, so boxes of one part merge
 * into one solid and a line is only drawn where the surface bends or two
 * parts meet. PG.iso.Scene removes the hidden lines.
 */
(function () {
    'use strict';
    const { geo } = PG;
    const { Scene, makeCamera } = PG.iso;

    // Line groups in order of priority: an edge between two parts takes the higher one.
    // BODY and BODY2 are the tiers, turn about.
    const BODY = 0, BODY2 = 1, BASE = 2, BLOCK = 3, STACK = 4, DUCT = 5, FIN = 6, BITS = 7, SHADE = 8;
    // Pen layer for each group, by pen count. Hatching isn't in here: when it's on
    // it takes the second pen and the rest share what's left.
    const MAPS = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 2, 0, 1, 0],
        [0, 0, 0, 0, 2, 0, 1, 3],
        [0, 0, 0, 0, 2, 4, 1, 3],
        [0, 0, 0, 5, 2, 4, 1, 3],
        [0, 0, 6, 5, 2, 4, 1, 3],
        [0, 7, 6, 5, 2, 4, 1, 3],
    ];
    const MAX_CELLS = 6e6;
    // Faces grow a hair so a hidden line can't show through the joint between two of them
    const GROW = 1e-4;

    // The block stands on z = 0 with its near corner at the origin, and the camera
    // sees the faces at x = 0 and y = 0. The margins leave room for the plinth and
    // for anything that sticks out. Cell 0 is empty, anything else is a part.
    class Grid {
        constructor(a, b, h, near, below, flip) {
            const nx = a + near + 4, ny = b + near + 4;
            this.flip = flip;
            this.near = near;
            this.below = below;
            this.nx = flip ? ny : nx;
            this.ny = flip ? nx : ny;
            this.nz = h + below + 2;
            this.cells = new Uint16Array(this.nx * this.ny * this.nz);
            this.kinds = [0];
            this.used = [];
            // x and y bounds of what's filled on each level, so the scans can skip the empty margins
            this.lo = [0, 1].map(() => new Int32Array(this.nz).fill(1 << 30));
            this.hi = [0, 1].map(() => new Int32Array(this.nz));
        }

        // A new part of one of the line groups. Cells hold 16 bits, so past that parts get shared.
        part(kind) {
            if (this.kinds.length > 65000) return Math.max(1, this.kinds.lastIndexOf(kind));
            this.kinds.push(kind);
            return this.kinds.length - 1;
        }

        // Fill a box of cells with a part, or carve it out with 0
        box(x0, y0, z0, x1, y1, z1, id) {
            if (this.flip) { let t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
            x0 = Math.max(1, x0 + this.near); x1 = Math.min(this.nx - 1, x1 + this.near);
            y0 = Math.max(1, y0 + this.near); y1 = Math.min(this.ny - 1, y1 + this.near);
            z0 = Math.max(1, z0 + this.below); z1 = Math.min(this.nz - 1, z1 + this.below);
            if (x0 >= x1 || y0 >= y1 || z0 >= z1) return;
            const { lo, hi } = this;
            if (id) this.used[this.kinds[id]] = true;
            for (let z = z0; z < z1; z++) {
                if (id) {
                    if (x0 < lo[0][z]) lo[0][z] = x0;
                    if (x1 > hi[0][z]) hi[0][z] = x1;
                    if (y0 < lo[1][z]) lo[1][z] = y0;
                    if (y1 > hi[1][z]) hi[1][z] = y1;
                }
                for (let y = y0; y < y1; y++) {
                    const o = (z * this.ny + y) * this.nx;
                    this.cells.fill(id, o + x0, o + x1);
                }
            }
        }
    }

    // Which of the 16 ways of filling the four cells round a grid line show an
    // edge: 1 always, 2 only between two different parts. fb and fc say whether
    // the visible faces across the line point up their axis (z) or down it.
    function edgeTable(fb, fc) {
        const t = new Uint8Array(16);
        // one cell: an outside corner, seen if either of its faces is
        t[1] = fb || fc; t[2] = !fb || fc; t[4] = fb || !fc; t[8] = !fb || !fc;
        // three cells: an inside corner, hidden by its own solid unless both faces are seen
        t[14] = !fb && !fc; t[13] = fb && !fc; t[11] = !fb && fc; t[7] = fb && fc;
        // two side by side: a flat surface
        t[3] = fc ? 2 : 0; t[12] = fc ? 0 : 2; t[5] = fb ? 2 : 0; t[10] = fb ? 0 : 2;
        t[6] = t[9] = 1;
        return t;
    }

    // Every edge the camera could see, as runs along the grid lines
    function outline(G, line) {
        const { cells, kinds, lo, hi } = G, n = [G.nx, G.ny, G.nz], st = [1, G.nx, G.nx * G.ny];
        // A level line has cells of its own level and the one under it round it, so
        // it's scanned over the bounds of both. Upright lines use the bounds of everything.
        const pair = (arr, pick) => Int32Array.from(arr, (q, z) => z ? pick(q, arr[z - 1]) : q);
        const x0 = pair(lo[0], Math.min), x1 = pair(hi[0], Math.max), y0 = pair(lo[1], Math.min), y1 = pair(hi[1], Math.max);
        const used = Array.from(hi[0], (q, z) => q ? z : -1).filter(z => z >= 0);
        if (!used.length) return;
        const all = [Math.min(...lo[0]), Math.max(...hi[0]), Math.min(...lo[1]), Math.max(...hi[1]), used[0], used[used.length - 1] + 1];
        for (let a = 0; a < 3; a++) {
            const b = (a + 1) % 3, c = (a + 2) % 3, sa = st[a], sb = st[b], sc = st[c];
            const table = edgeTable(b === 2, c === 2);
            for (let k = 1; k < n[c]; k++) for (let j = 1; j < n[b]; j++) {
                let i0, i1;
                if (a === 0) { if (j < y0[k] || j > y1[k]) continue; i0 = x0[k]; i1 = x1[k]; }
                else if (a === 1) { if (k < x0[j] || k > x1[j]) continue; i0 = y0[j]; i1 = y1[j]; }
                else { if (j < all[0] || j > all[1] || k < all[2] || k > all[3]) continue; i0 = all[4]; i1 = all[5]; }
                let o = i0 * sa + j * sb + k * sc, from = i0, kind = -1;
                for (let i = i0; i <= i1; i++, o += sa) {
                    let now = -1;
                    if (i < i1) {
                        const q11 = cells[o], q01 = cells[o - sb], q10 = cells[o - sc], q00 = cells[o - sb - sc];
                        const m = (q00 ? 1 : 0) | (q10 ? 2 : 0) | (q01 ? 4 : 0) | (q11 ? 8 : 0);
                        if (m !== 0 && m !== 15) {
                            const t = table[m];
                            if (t === 1 || (t === 2 && (m === 3 ? q00 !== q10 : m === 12 ? q01 !== q11 : m === 5 ? q00 !== q01 : q10 !== q11))) {
                                now = Math.max(kinds[q00], kinds[q10], kinds[q01], kinds[q11]);
                            }
                        }
                    }
                    if (now !== kind) {
                        if (kind >= 0) line(kind, a, from, i, j, k);
                        kind = now;
                        from = i;
                    }
                }
            }
        }
    }

    // The faces that look at the camera, as rectangles: runs along each row,
    // joined to the same run in the row before. Rows run along x (along y for the
    // faces across x) and stack up in z (in y for the tops).
    const ROWS = [[1, 2], [0, 2], [0, 1]];
    function skin(G, quad) {
        const { cells, lo, hi } = G, n = [G.nx, G.ny, G.nz], st = [1, G.nx, G.nx * G.ny];
        for (let a = 0; a < 3; a++) {
            const [u, v] = ROWS[a], sa = st[a], su = st[u], sv = st[v], nv = n[v];
            // tops have the solid cell under the face, sides have it behind
            const full = a === 2 ? -sa : 0, open = a === 2 ? 0 : -sa;
            for (let i = 1; i < n[a]; i++) {
                let prev = [];
                for (let y = 1; y <= nv; y++) {
                    const cur = [], z = a === 2 ? i - 1 : y;
                    if (y < nv && (a === 2 ? y >= lo[1][z] && y < hi[1][z] : i >= lo[a][z] && i < hi[a][z])) {
                        const u1 = hi[u][z];
                        let x = lo[u][z], o = i * sa + y * sv + x * su, x0 = -1;
                        for (; x <= u1; x++, o += su) {
                            if (x < u1 && cells[o + full] !== 0 && cells[o + open] === 0) { if (x0 < 0) x0 = x; }
                            else if (x0 >= 0) { cur.push([x0, x, y]); x0 = -1; }
                        }
                    }
                    let ci = 0;
                    for (const q of prev) {
                        while (ci < cur.length && cur[ci][0] < q[0]) ci++;
                        if (ci < cur.length && cur[ci][0] === q[0] && cur[ci][1] === q[1]) cur[ci][2] = q[2];
                        else quad(a, i, q[0], q[2], q[1], y);
                    }
                    prev = cur;
                }
            }
        }
    }

    // Starts of as many w wide items as fit in a0..a1 with `gap` between them, centered
    function row(a0, a1, w, gap) {
        const n = Math.floor((a1 - a0 + gap) / (w + gap));
        if (n < 1) return [];
        const off = (a1 - a0 - n * w - (n - 1) * gap) >> 1;
        return Array.from({ length: n }, (_, i) => a0 + off + i * (w + gap));
    }

    // One of the two faces of a block that the camera sees, as a box function.
    // u runs along the face, v is height and w is depth into the block, so
    // negative w sticks out of it.
    const frame = (G, axis, o) => axis
        ? (u0, v0, w0, u1, v1, w1, id) => G.box(u0, o + w0, v0, u1, o + w1, v1, id)
        : (u0, v0, w0, u1, v1, w1, id) => G.box(o + w0, u0, v0, o + w1, u1, v1, id);

    // ------------------------------------------------------------------
    // Walls: things cut into or stuck onto a face, no deeper than D
    // ------------------------------------------------------------------

    // Stepped frames round a sunken panel, with a grille or studs in it
    function panel(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T, m = rng.int(1, 2), want = rng.int(1, 3);
        let n = 0;
        while (n < want && n < D && Math.min(u1 - u0, v1 - v0) - 2 * n * m >= 5) {
            F(u0 + n * m, v0 + n * m, 0, u1 - n * m, v1 - n * m, n + 1, 0);
            n++;
        }
        if (!n) return;
        const i = (n - 1) * m + 1, a0 = u0 + i, a1 = u1 - i, b0 = v0 + i, b1 = v1 - i;
        if (a1 - a0 < 3 || b1 - b0 < 3) return;
        const t = Math.min(n, rng.int(1, 2)), g = rng.pick([1, 1, 2]);
        // long bars are cut into bays about 20 cells long, or a big grille turns into one dark slab of lines
        const bays = (c0, c1) => {
            const k = Math.max(1, Math.round((c1 - c0) / 20)), w = Math.floor((c1 - c0 - 2 * (k - 1)) / k);
            return row(c0, c1, w, 2).map(q => [q, q + w]);
        };
        switch (rng.weighted([[4, 'bars'], [2, 'louvers'], [1.5, 'studs'], [1.5, 'core'], [1, 'none']])) {
            case 'bars': {
                const id = G.part(FIN);
                for (const [q0, q1] of bays(b0, b1)) for (const u of row(a0, a1, 1, g)) F(u, q0, n - t, u + 1, q1, n, id);
                break;
            }
            case 'louvers': {
                const id = G.part(FIN);
                for (const [q0, q1] of bays(a0, a1)) for (const v of row(b0, b1, 1, g)) F(q0, v, n - t, q1, v + 1, n, id);
                break;
            }
            case 'studs': {
                const id = G.part(BITS);
                for (const u of row(a0, a1, 2, 2)) for (const v of row(b0, b1, 2, 2)) F(u, v, n - 1, u + 2, v + 2, n, id);
                break;
            }
            case 'core':
                F(a0 + 1, b0 + 1, rng.int(-1, n - 1), a1 - 1, b1 - 1, n, G.part(BLOCK));
                break;
        }
    }

    // A row of piers with the bays between them cut back, and teeth or rungs in the bays
    function piers(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T, d = Math.min(D, rng.int(3, 5)), pw = rng.int(3, 5), gap = rng.int(4, 7);
        const us = row(u0, u1, pw, gap);
        if (us.length < 2) { panel(T, F, u0, v0, u1, v1, D); return; }
        const step = rng.chance(0.4) ? rng.int(1, 2) * rng.sign() : 0;
        const style = rng.pick(['teeth', 'teeth', 'rungs', 'grooves', 'plain']);
        const id = G.part(BITS), vt = v0 + Math.round((v1 - v0) * rng.range(0.45, 0.8));
        for (let i = 0; i + 1 < us.length; i++) {
            const a0 = us[i] + pw, a1 = us[i + 1];
            const top = v1 - (step > 0 ? i : us.length - 2 - i) * Math.abs(step);
            F(a0, v0, 0, a1, Math.max(v0 + 3, top), d, 0);
            if (style === 'teeth') for (let v = v0 + 1; v < vt; v += 2) F(a0, v, 0, a0 + 2, v + 1, Math.min(d, 2), id);
            if (style === 'rungs') for (let v = v0 + 2; v < vt; v += 3) F(a0, v, 1, a1, v + 1, 2, id);
        }
        if (style === 'grooves') for (const u of us) for (let v = v0 + 2; v < v1 - 1; v += 3) F(u, v, 0, u + pw, v + 1, 1, 0);
    }

    // Joints across the face, so it reads as a pile of slabs
    function ribs(T, F, u0, v0, u1, v1) {
        const t = T.rng.int(2, 4);
        for (let v = v0 + t; v < v1 - 1; v += t + 1) F(u0, v, 0, u1, v + 1, 1, 0);
    }

    function slots(T, F, u0, v0, u1, v1, D) {
        const { rng } = T, d = Math.min(D, rng.int(1, 3));
        for (const u of row(u0, u1, 1, rng.pick([1, 2, 2, 3]))) F(u, v0, 0, u + 1, v1, d, 0);
    }

    function windows(T, F, u0, v0, u1, v1, D) {
        const { rng } = T, w = rng.int(2, 4), hgt = rng.int(2, 4), gu = rng.int(2, 3), gv = rng.int(2, 3), d = Math.min(D, rng.int(1, 2));
        for (const u of row(u0, u1, w, gu)) for (const v of row(v0, v1, hgt, gv)) F(u, v, 0, u + w, v + hgt, d, 0);
    }

    function studs(T, F, u0, v0, u1, v1) {
        const { G, rng } = T, id = G.part(BITS), g = rng.int(2, 3);
        for (const u of row(u0, u1, 2, g)) for (const v of row(v0, v1, 2, g)) F(u, v, -1, u + 2, v + 2, 0, id);
    }

    // Boxes sticking out of the face, in a row or a staircase
    function jut(T, F, u0, v0, u1, v1) {
        const { G, rng } = T, V = v1 - v0, bw = Math.min(rng.int(4, 7), u1 - u0), bh = Math.min(rng.int(3, 6), V);
        const out = rng.int(2, 5), us = row(u0, u1, bw, rng.int(1, 3)), vs = row(v0, v1, bh, rng.int(1, 3));
        const stair = rng.chance(0.6), up = rng.chance(0.5), at = rng.int(0, vs.length - 1);
        us.forEach((u, i) => vs.forEach((v, j) => {
            if (j !== (stair ? Math.min(up ? i : us.length - 1 - i, vs.length - 1) : at)) return;
            F(u, v, -out, u + bw, v + bh, 0, G.part(BLOCK));
        }));
    }

    // A deep bay with a row of slab stacks standing in it
    function rack(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T, V = v1 - v0, d = Math.max(3, Math.min(D, rng.int(4, 8))), cw = rng.int(3, 6), t = rng.int(2, 3);
        const id = G.part(STACK), us = row(u0 + 1, u1 - 1, cw, rng.int(1, 2)), lean = rng.pick([-1, 0, 0, 1]);
        F(u0, v0, 0, u1, v1, d, 0);
        us.forEach((u, i) => {
            const f = us.length > 1 ? i / (us.length - 1) : 1;
            const n = Math.max(1, Math.floor(V * (lean ? 0.45 + 0.55 * (lean > 0 ? f : 1 - f) : 1) * rng.range(0.7, 1) / (t + 1)));
            for (let q = 0; q < n; q++) {
                const v = v0 + q * (t + 1);
                F(u, v, 1, u + cw, v + t, d, id);
                if (q < n - 1) F(u + 1, v + t, 2, u + cw - 1, v + t + 1, d, id);
            }
        });
    }

    // Piers standing proud of the face, the lower part stepping out further
    function buttress(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T, V = v1 - v0, out = rng.int(2, Math.max(2, Math.min(D, 4))), pw = rng.int(2, 4), id = G.part(T.body);
        const foot = rng.chance(0.6) ? Math.round(V * rng.range(0.25, 0.6)) : 0, us = row(u0, u1, pw, rng.int(4, 9));
        for (const u of us) {
            F(u, v0, -out, u + pw, v1, 0, id);
            if (foot) F(u, v0, -out - rng.int(1, 2), u + pw, v0 + foot, 0, id);
        }
        // slats between them
        if (us.length > 1 && rng.chance(0.5)) {
            const fin = G.part(FIN), g = rng.int(1, 3), top = v0 + Math.round(V * rng.range(0.4, 1));
            for (let i = 0; i + 1 < us.length; i++) for (const v of row(v0 + 1, top, 1, g)) F(us[i] + pw, v, -1, us[i + 1], v + 1, 0, fin);
        }
    }

    // Long slabs sticking out one above the other, each a step shorter than the last
    function shelves(T, F, u0, v0, u1, v1) {
        const { G, rng } = T, U = u1 - u0, t = rng.int(1, 2), id = G.part(BLOCK), out = rng.int(1, 3);
        const vs = row(v0, v1, t, rng.int(2, 4)), step = rng.chance(0.4) ? Math.min(rng.int(1, 4), Math.floor(U * 0.6 / vs.length)) : 0;
        const left = rng.chance(0.5), up = rng.chance(0.5);
        vs.forEach((v, i) => {
            const cut = step * (up ? i : vs.length - 1 - i);
            F(u0 + (left ? cut : 0), v, -out, u1 - (left ? 0 : cut), v + t, 0, id);
        });
    }

    // Just the joints between cladding panels
    function cladding(T, F, u0, v0, u1, v1) {
        const { G, rng } = T, nu = Math.max(1, Math.round((u1 - u0) / rng.int(6, 14))), nv = Math.max(1, Math.round((v1 - v0) / rng.int(6, 14)));
        const ids = [G.part(T.body), G.part(T.body)], at = (a0, a1, i, n) => a0 + Math.round((a1 - a0) * i / n);
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            F(at(u0, u1, i, nu), at(v0, v1, j, nv), 0, at(u0, u1, i + 1, nu), at(v0, v1, j + 1, nv), 1, ids[(i + j) % 2]);
        }
    }

    // Fins or shelves standing in a recess
    function wallFins(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T, d = Math.min(D, rng.int(2, 4)), id = G.part(FIN), back = d > 2 ? rng.int(0, 1) : 0;
        F(u0, v0, 0, u1, v1, d, 0);
        if (rng.chance(0.6)) for (const u of row(u0 + 1, u1 - 1, 1, 1)) F(u, v0, back, u + 1, v1, d, id);
        else for (const v of row(v0 + 1, v1 - 1, 1, 1)) F(u0, v, back, u1, v + 1, d, id);
    }

    // A flat duct up the face with a jog in it, and maybe a collar round it every so often
    function duct(T, F, u0, v0, u1, v1, collars) {
        const { G, rng } = T, U = u1 - u0, V = v1 - v0, id = G.part(DUCT), out = rng.int(1, 2);
        const w = geo.clamp(Math.round(U * rng.range(0.3, 0.5)), 3, 8);
        if (U - w < 2 || V < w * 3) { F(u0, v0, -out, u1, v1, 0, id); return; }
        const left = rng.chance(0.5), ua = left ? u0 : u1 - w, ub = left ? u1 - w : u0;
        const vm = v0 + Math.round((V - w) * rng.range(0.3, 0.7));
        F(ua, v0, -out, ua + w, vm + w, 0, id);
        F(Math.min(ua, ub), vm, -out, Math.max(ua, ub) + w, vm + w, 0, id);
        F(ub, vm, -out, ub + w, v1, 0, id);
        if (!collars) return;
        const ring = G.part(BITS), gap = rng.int(6, 12);
        for (const v of row(v0 + 2, vm - 1, 1, gap)) F(ua - 1, v, -out - 1, ua + w + 1, v + 1, 0, ring);
        for (const v of row(vm + w + 1, v1 - 2, 1, gap)) F(ub - 1, v, -out - 1, ub + w + 1, v + 1, 0, ring);
    }

    // A strip too narrow for anything else: one slot, or a line of notches or teeth
    function notches(T, F, u0, v0, u1, v1, D) {
        const { G, rng } = T;
        if (rng.chance(0.3)) { F(u0, v0, 0, u1, v1, Math.min(D, rng.int(1, 3)), 0); return; }
        const tall = v1 - v0 > u1 - u0, w = rng.int(1, 2), g = rng.int(1, 2), out = rng.chance(0.4);
        const id = out ? G.part(BITS) : 0, d0 = out ? -rng.int(1, 2) : 0, d1 = out ? 0 : Math.min(D, rng.int(1, 2));
        for (const q of row(tall ? v0 : u0, tall ? v1 : u1, w, g)) {
            if (tall) F(u0, q, d0, u1, q + w, d1, id);
            else F(q, v0, d0, q + w, v1, d1, id);
        }
    }

    // Cut a face up into bays with solid strips between them and treat each one
    function facade(T, F, u0, v0, u1, v1, D, depth = 0) {
        const { rng, p } = T, U = u1 - u0, V = v1 - v0, L = Math.max(U, V), small = Math.min(U, V);
        if (U < 3 || V < 3) return;
        if (depth < 3 && (L >= 34 || (L >= 16 && rng.chance(depth ? 0.45 : 0.7)))) {
            const g = rng.int(2, 3);
            let c = rng.chance(0.3) ? rng.int(3, 5) : Math.round((L - g) * rng.range(0.3, 0.7));
            if (rng.chance(0.5)) c = L - g - c;
            if (c >= 3 && L - g - c >= 3) {
                if (U >= V) {
                    facade(T, F, u0, v0, u0 + c, v1, D, depth + 1);
                    facade(T, F, u0 + c + g, v0, u1, v1, D, depth + 1);
                } else {
                    facade(T, F, u0, v0, u1, v0 + c, D, depth + 1);
                    facade(T, F, u0, v0 + c + g, u1, v1, D, depth + 1);
                }
                return;
            }
        }
        if (small < 7) { if (rng.chance(p.density)) notches(T, F, u0, v0, u1, v1, D); return; }
        // big bays always get something, if only cladding joints
        if (!rng.chance(p.density)) { if (small >= 14 && rng.chance(0.6)) cladding(T, F, u0, v0, u1, v1); return; }
        // fine textures only in moderate doses
        const fine = U * V > 800 ? 0.2 : 1;
        rng.weighted([
            [4 * p.panels, panel], [U >= 14 && V >= 8 ? 3 : 0, piers], [D >= 4 && V >= 8 ? 5 * p.stacks : 0, rack],
            [U >= 10 && V >= 8 ? 1.5 : 0, buttress], [U >= 8 ? 1.2 : 0, shelves], [1.2 * p.stacks * fine, ribs], [1.2 * fine, slots],
            [0.5 * fine, windows], [0.5 * fine, studs], [1, jut], [2.5 * p.fins * fine, wallFins], [V >= 12 && U <= 24 ? 1.5 : 0, duct], [0.5, cladding],
        ])(T, F, u0, v0, u1, v1, D);
    }

    // ------------------------------------------------------------------
    // Equipment: things standing on a floor, no taller than hh
    // ------------------------------------------------------------------

    // Columns of slabs in rows
    function stacks(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, cw = rng.int(4, 7), cd = rng.int(3, 6), g = rng.int(1, 2), t = rng.int(2, 3);
        const xs = row(x0, x1, cw, g), ys = row(y0, y1, cd, g);
        if (!xs.length || !ys.length) return false;
        const style = rng.pick(['notch', 'notch', 'seam', 'flare']), a = G.part(STACK), b = G.part(STACK);
        xs.forEach((x, i) => ys.forEach((y, j) => {
            // taller towards the back, so the front ones don't hide the rest
            const lift = xs.length + ys.length > 2 ? (i + j) / (xs.length + ys.length - 2) : 1;
            const n = Math.max(1, Math.round(hh * (0.55 + 0.45 * lift) * rng.range(0.8, 1) / (t + 1)));
            for (let q = 0; q < n; q++) {
                const zz = z + q * (t + 1);
                if (style === 'seam') G.box(x, y, zz, x + cw, y + cd, zz + t + 1, q % 2 ? a : b);
                else if (style === 'flare') {
                    G.box(x + 1, y + 1, zz, x + cw - 1, y + cd - 1, zz + t, a);
                    G.box(x, y, zz + t, x + cw, y + cd, zz + t + 1, a);
                } else {
                    G.box(x, y, zz, x + cw, y + cd, zz + t, a);
                    if (q < n - 1) G.box(x + 1, y + 1, zz + t, x + cw - 1, y + cd - 1, zz + t + 1, a);
                }
            }
        }));
        return true;
    }

    // A bank of thin fins on a base plate
    function finBank(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, id = G.part(FIN), alongX = rng.chance(0.5), pitch = rng.pick([2, 2, 3]);
        const fh = geo.clamp(Math.round(hh * rng.range(0.3, 0.75)), 2, 12), base = rng.int(1, 2);
        const shape = rng.pick(['flat', 'flat', 'ramp', 'step']);
        G.box(x0, y0, z, x1, y1, z + base, id);
        const q0 = (alongX ? y0 : x0) + 1, q1 = (alongX ? y1 : x1) - 1, n = Math.ceil((q1 - q0) / pitch);
        for (let i = 0; i < n; i++) {
            const q = q0 + i * pitch, t = n > 1 ? i / (n - 1) : 1;
            const f = shape === 'ramp' ? Math.max(1, Math.round(fh * (0.35 + 0.65 * t))) : shape === 'step' && t < 0.5 ? Math.max(1, fh >> 1) : fh;
            if (alongX) G.box(x0 + 1, q, z + base, x1 - 1, q + 1, z + base + f, id);
            else G.box(q, y0 + 1, z + base, q + 1, y1 - 1, z + base + f, id);
        }
        return true;
    }

    // A plain block with something done to its top or its near edge
    function block(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, id = G.part(BLOCK), dx = x1 - x0, dy = y1 - y0;
        const h1 = Math.max(2, Math.round(hh * rng.range(0.35, 0.9))), zt = z + h1;
        G.box(x0, y0, z, x1, y1, zt, id);
        const big = dx >= 12 && dy >= 12 && h1 >= 8;
        switch (rng.weighted([[2, 'comb'], [2, 'steps'], [1.5, 'vent'], [big ? 3 : 0, 'walls'], [1, 'plain']])) {
            case 'comb': {
                // slots down through the near edge
                const g = rng.int(1, 2), lo = z + Math.min(h1 - 1, rng.int(1, 2)), d = rng.int(3, 8);
                if (rng.chance(0.5)) for (const x of row(x0 + 1, x1 - 1, 1, g)) G.box(x, y0, lo, x + 1, y0 + Math.min(dy - 2, d), zt, 0);
                else for (const y of row(y0 + 1, y1 - 1, 1, g)) G.box(x0, y, lo, x0 + Math.min(dx - 2, d), y + 1, zt, 0);
                break;
            }
            case 'steps': {
                const n = rng.int(1, 3), sx = rng.int(1, 3), sy = rng.int(1, 3), sh = rng.int(1, 2);
                for (let i = 1; i <= n; i++) G.box(x0 + i * sx, y0 + i * sy, zt + (i - 1) * sh, x1, y1, zt + i * sh, id);
                break;
            }
            case 'vent': {
                if (dx < 6 || dy < 6) break;
                const fin = G.part(FIN);
                G.box(x0 + 1, y0 + 1, zt - 1, x1 - 1, y1 - 1, zt, 0);
                if (dx >= dy) for (const x of row(x0 + 2, x1 - 2, 1, 1)) G.box(x, y0 + 2, zt - 1, x + 1, y1 - 2, zt, fin);
                else for (const y of row(y0 + 2, y1 - 2, 1, 1)) G.box(x0 + 2, y, zt - 1, x1 - 2, y + 1, zt, fin);
                break;
            }
            case 'walls': {
                const D = Math.min(3, Math.floor(Math.min(dx, dy) / 4));
                facade(T, frame(G, 0, x0), y0 + D + 1, z + 1, y1 - 1, zt - 1, D, 1);
                facade(T, frame(G, 1, y0), x0 + D + 1, z + 1, x1 - 1, zt - 1, D, 1);
                break;
            }
        }
        return true;
    }

    // Frames standing one behind the other
    function portals(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, id = G.part(DUCT), t = rng.int(1, 2), alongX = x1 - x0 >= y1 - y0;
        if (Math.min(x1 - x0, y1 - y0) < 6) return false;
        const hgt = Math.max(4, Math.round(hh * rng.range(0.5, 0.95)));
        const qs = row(alongX ? x0 : y0, alongX ? x1 : y1, t, rng.int(3, 7));
        for (const q of qs) {
            if (alongX) {
                G.box(q, y0, z, q + t, y0 + t, z + hgt, id);
                G.box(q, y1 - t, z, q + t, y1, z + hgt, id);
                G.box(q, y0, z + hgt - t, q + t, y1, z + hgt, id);
            } else {
                G.box(x0, q, z, x0 + t, q + t, z + hgt, id);
                G.box(x1 - t, q, z, x1, q + t, z + hgt, id);
                G.box(x0, q, z + hgt - t, x1, q + t, z + hgt, id);
            }
        }
        // something low under them
        if (hgt - t >= 5) equip(T, x0 + t + 1, y0 + t + 1, x1 - t - 1, y1 - t - 1, z, hgt - t - 2, true);
        return true;
    }

    // Thin boards standing in a rack
    function boards(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, id = G.part(BLOCK), t = rng.int(1, 2), alongX = rng.chance(0.5), gap = rng.int(2, 4);
        for (const q of row(alongX ? y0 : x0, alongX ? y1 : x1, t, gap)) {
            const hgt = Math.max(3, Math.round(hh * rng.range(0.6, 1)));
            if (alongX) G.box(x0, q, z, x1, q + t, z + hgt, id);
            else G.box(q, y0, z, q + t, y1, z + hgt, id);
            if (!rng.chance(0.6)) continue;
            // a bite out of the near top corner
            const n = rng.int(2, 5), m = rng.int(2, Math.max(2, hgt >> 1));
            if (alongX) G.box(x0, q, z + hgt - m, x0 + n, q + t, z + hgt, 0);
            else G.box(q, y0, z + hgt - m, q + t, y0 + n, z + hgt, 0);
        }
        return true;
    }

    function crates(T, x0, y0, x1, y1, z, hh) {
        const { G, rng } = T, c = rng.int(3, 6), g = rng.int(1, 2), xs = row(x0, x1, c, g), ys = row(y0, y1, c, g);
        if (!xs.length || !ys.length) return false;
        const most = Math.max(1, Math.floor(hh / c));
        for (const x of xs) for (const y of ys) {
            for (let q = 0, n = rng.int(0, most); q < n; q++) G.box(x, y, z + q * c, x + c, y + c, z + (q + 1) * c, G.part(BLOCK));
        }
        return true;
    }

    function equip(T, x0, y0, x1, y1, z, hh, low) {
        const { rng, p } = T;
        if (x1 - x0 < 3 || y1 - y0 < 3 || hh < 2) return;
        const make = rng.weighted([[4 * p.stacks, stacks], [3 * p.fins, finBank], [1.5, block], [low ? 0 : 1.2, portals], [1, boards], [0.8, crates]]);
        if (!make(T, x0, y0, x1, y1, z, hh)) block(T, x0, y0, x1, y1, z, hh);
    }

    // Cut a floor up into plots with aisles between them and stand something on each.
    // Plots towards the far corner of the root rectangle get more height.
    function field(T, x0, y0, x1, y1, z, hh, root, depth = 0) {
        const { rng, p } = T, dx = x1 - x0, dy = y1 - y0, L = Math.max(dx, dy);
        if (dx < 3 || dy < 3 || hh < 2) return;
        root = root || [x0, y0, x1, y1];
        if (depth < 6 && L > T.plot && (L > T.plot * 1.5 || rng.chance(0.8))) {
            const g = rng.int(1, 3), c = Math.round((L - g) * rng.range(0.35, 0.65));
            if (c >= 4 && L - g - c >= 4) {
                if (dx >= dy) {
                    field(T, x0, y0, x0 + c, y1, z, hh, root, depth + 1);
                    field(T, x0 + c + g, y0, x1, y1, z, hh, root, depth + 1);
                } else {
                    field(T, x0, y0, x1, y0 + c, z, hh, root, depth + 1);
                    field(T, x0, y0 + c + g, x1, y1, z, hh, root, depth + 1);
                }
                return;
            }
        }
        if (!rng.chance(0.5 + 0.5 * p.density)) return;
        const far = ((x0 + x1) / 2 - root[0]) / (root[2] - root[0]) / 2 + ((y0 + y1) / 2 - root[1]) / (root[3] - root[1]) / 2;
        equip(T, x0, y0, x1, y1, z, Math.round(hh * (0.45 + 0.55 * far) * rng.range(0.8, 1)));
    }

    // ------------------------------------------------------------------
    // The tower
    // ------------------------------------------------------------------

    // A solid tier with both of its faces worked
    function mass(T, R, z0, z1, laminate) {
        const { G, rng } = T, [x0, y0, x1, y1] = R, id = G.part(T.body);
        if (laminate) {
            // floor plates with a gap between each, some of them pulled back
            const t = rng.int(2, 4), ragged = rng.chance(0.5);
            for (let z = z0; z < z1; z += t + 1) {
                const in0 = ragged ? rng.int(0, 2) : 0, in1 = ragged ? rng.int(0, 2) : 0;
                G.box(x0 + in0, y0 + in1, z, x1, y1, Math.min(z1, z + t), id);
                G.box(x0 + 3, y0 + 3, z + t, x1, y1, Math.min(z1, z + t + 1), id);
            }
            return;
        }
        G.box(x0, y0, z0, x1, y1, z1, id);
        const D = T.D, m = D + rng.int(1, 2);
        facade(T, frame(G, 0, x0), y0 + m, z0 + 2, y1 - 2, z1 - 2, D);
        facade(T, frame(G, 1, y0), x0 + m, z0 + 2, x1 - 2, z1 - 2, D);
    }

    // An open top tier: a floor full of equipment with two walls behind it
    function crown(T, R, z0, z1) {
        const { G, rng } = T, [x0, y0, x1, y1] = R, t = rng.int(2, 3), id = G.part(T.body), hgt = z1 - z0;
        for (const side of [0, 1]) {
            // the walls step down towards their near ends
            const len = side ? y1 - y0 : x1 - x0, F = frame(G, side ? 0 : 1, side ? x1 - t : y1 - t), o = side ? y0 : x0;
            let top = Math.round(hgt * rng.range(0.6, 1)), from = 0;
            for (let i = rng.int(1, 3); i > 0 && top >= 3; i--) {
                const to = i > 1 ? Math.min(len, from + Math.round(len * rng.range(0.2, 0.5))) : len;
                F(o + len - to, z0, 0, o + len - from, z0 + top, t, id);
                // openings through it
                if (to - from >= 8 && top >= 8 && rng.chance(0.7)) rng.pick([slots, windows, ribs])(T, F, o + len - to + 2, z0 + 2, o + len - from - 2, z0 + top - 2, t);
                from = to;
                top = Math.round(top * rng.range(0.45, 0.8));
            }
        }
        field(T, x0 + 1, y0 + 1, x1 - t - 1, y1 - t - 1, z0, Math.round(hgt * 0.95));
    }

    // Low blocks on the ground against the near faces
    function annexes(T, a, b, h1) {
        const { G, rng, p } = T, list = [];
        for (const side of [0, 1]) {
            if (!rng.chance(0.25 + 0.35 * p.setback)) continue;
            const len = side ? a : b, w = Math.round(len * rng.range(0.25, 0.6)), at = rng.int(T.D + 2, Math.max(T.D + 2, len - w - 2));
            const out = rng.int(4, Math.max(4, T.reach - 3)), hgt = Math.max(4, Math.round(h1 * rng.range(0.2, 0.65)));
            const R = side ? [at, -out, at + w, 0] : [-out, at, 0, at + w];
            G.box(R[0], R[1], 0, R[2], R[3], hgt, G.part(BODY));
            const D = Math.min(3, out >> 1);
            if (hgt >= 8) {
                facade(T, frame(G, 0, R[0]), R[1] + 2, 1, R[3] - 2, hgt - 1, D);
                facade(T, frame(G, 1, R[1]), R[0] + 2, 1, R[2] - 2, hgt - 1, D);
            }
            field(T, R[0] + 1, R[1] + 1, R[2] - 1, R[3] - 1, hgt, Math.round(h1 * rng.range(0.1, 0.3)));
            list.push(out);
        }
        return Math.max(0, ...list);
    }

    function tower(T, a, b, h) {
        const { G, rng, p, s } = T;
        // headroom for what stands on the roof
        const head = geo.clamp(Math.round(s * 0.16), 3, 18), top = Math.max(6, h - head);
        const n = geo.clamp(p.tiers, 1, Math.max(1, Math.floor(top / 10)));
        const w = Array.from({ length: n }, (_, i) => rng.range(0.7, 1.4) * (i ? 1 : 1.3));
        const total = w.reduce((x, y) => x + y, 0), cuts = [];
        for (let i = 0, acc = 0; i < n; i++) { acc += w[i]; cuts.push(i === n - 1 ? top : Math.round(top * acc / total)); }
        const out = annexes(T, a, b, cuts[0]);
        if (T.ph) {
            const ex = Math.max(out + 2, rng.int(3, T.reach)), ey = Math.max(out + 2, rng.int(3, T.reach));
            G.box(-ex, -ey, -T.ph, a + 2, b + 2, 0, G.part(BASE));
        }
        let R = [0, 0, a, b], z = 0, open = false, laminated = false;
        const flush = [0, 0];
        for (let i = 0; i < n; i++) {
            const z1 = cuts[i];
            let N = R, belt = 0;
            T.body = i % 2 ? BODY2 : BODY;
            if (i) {
                const big = () => Math.round(s * rng.range(0.14, 0.3));
                let dx = rng.pick([0, 0, 1, 2, 3]), dy = rng.pick([0, 0, 1, 2, 3]);
                if (rng.chance(p.setback)) {
                    const m = rng.pick(['x', 'y', 'both', 'both']);
                    if (m !== 'y') dx = big();
                    if (m !== 'x') dy = big();
                }
                // keep at least 40% of the footprint
                dx = Math.max(0, Math.min(dx, R[2] - R[0] - Math.round(a * 0.4)));
                dy = Math.max(0, Math.min(dy, R[3] - R[1] - Math.round(b * 0.4)));
                N = [R[0] + dx, R[1] + dy, R[2], R[3]];
                // what stands on the terrace this leaves
                const hh = Math.round((z1 - z) * rng.range(0.5, 0.95));
                if (dy >= 6) field(T, R[0] + 1, R[1] + 1, R[2] - 1, N[1] - 1, z, hh);
                if (dx >= 6) field(T, R[0] + 1, N[1], N[0] - 1, R[3] - 1, z, hh);
                if (z1 - z >= 8) {
                    // there's always a row of blocks somewhere
                    const kind = G.used[BITS] || i > 1 ? rng.weighted([[3, 'none'], [3, 'neck'], [2, 'cornice']]) : 'neck';
                    if (kind === 'neck') {
                        // a waist with a row of blocks round it
                        belt = rng.int(2, 4);
                        const d = rng.int(2, 3), bw = rng.int(2, 3), g = rng.int(1, 3), id = G.part(BITS);
                        G.box(N[0] + d, N[1] + d, z, N[2], N[3], z + belt, G.part(T.body));
                        for (const q of row(N[1], N[3] - 1, bw, g)) G.box(N[0], q, z, N[0] + d, q + bw, z + belt, id);
                        for (const q of row(N[0], N[2] - 1, bw, g)) G.box(q, N[1], z, q + bw, N[1] + d, z + belt, id);
                    } else if (kind === 'cornice') {
                        belt = rng.int(1, 2);
                        const d = rng.int(1, 3);
                        G.box(N[0] - d, N[1] - d, z, N[2], N[3], z + belt, G.part(T.body));
                    }
                }
            }
            open = i > 0 && i === n - 1 && rng.chance(0.55);
            // a pile of floor plates is only good in a short band, and not twice running
            const laminate = !open && !laminated && z1 - z - belt >= 8 && z1 - z <= h * 0.3 && rng.chance(0.45 * p.stacks);
            if (open) crown(T, N, z + belt, z1);
            else mass(T, N, z + belt, z1, laminate);
            laminated = laminate;
            for (const side of [0, 1]) if (!open && !N[side] && flush[side] === z) flush[side] = z1;
            R = N;
            z = z1;
        }
        // A duct up a near face, across every tier that keeps to the building line.
        // If nothing else made a duct, the last face that can take one gets it.
        const runs = [0, 1].map(side => {
            const len = side ? a : b, wide = Math.min(rng.int(10, 22), len - 2 * T.D - 6);
            return { side, len, wide };
        }).filter(q => q.wide >= 6 && flush[q.side] >= 12);
        runs.forEach((q, i) => {
            const wanted = flush[q.side] >= h * 0.4 && rng.chance(0.45);
            if (!wanted && (i < runs.length - 1 || G.used[DUCT])) return;
            const at = rng.int(T.D + 3, q.len - q.wide - 3);
            duct(T, frame(G, q.side, 0), at, 0, at + q.wide, flush[q.side] - rng.int(1, 4), rng.chance(0.5));
        });
        if (open) return;
        // roof: a curb and whatever fits in the headroom
        if (rng.chance(0.5)) {
            const id = G.part(T.body);
            G.box(R[0], R[1], z, R[2], R[3], z + 1, id);
            G.box(R[0] + 1, R[1] + 1, z, R[2] - 1, R[3] - 1, z + 1, 0);
        }
        field(T, R[0] + 2, R[1] + 2, R[2] - 2, R[3] - 2, z, h - z);
    }

    function build(p, rng, a, b, h, s) {
        const ph = p.plinth ? geo.clamp(Math.round(s * 0.03), 2, 4) : 0, reach = Math.max(6, Math.round(s * 0.14));
        const G = new Grid(a, b, h, reach + 8, ph + 1, p.mirror);
        tower({ G, rng, p, s, ph, reach, body: BODY, plot: rng.int(14, 26), D: geo.clamp(Math.round(s * 0.07), 3, 8) }, a, b, h);
        return G;
    }

    PG.register({
        id: 'megastructure', name: 'Megastructure', category: 'Scenes', fit: true,
        description: 'A tower block crammed with slab stacks, fin arrays, piers and recessed grilles, drawn in isometric outline like a machine the size of a building.',
        params: [
            { type: 'section', label: 'Structure' },
            { id: 'height', label: 'Height', type: 'range', min: 0.5, max: 3, step: 0.05, value: 1.75, random: [1.2, 2.4], hint: 'Height against width' },
            { id: 'skew', label: 'Footprint', type: 'range', min: -0.4, max: 0.4, step: 0.05, value: 0, random: [-0.25, 0.25], hint: 'Above zero makes the right face wider, below zero the left' },
            { id: 'tiers', label: 'Tiers', type: 'range', min: 1, max: 7, step: 1, value: 4, random: [2, 6] },
            { id: 'setback', label: 'Setbacks', type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, random: [0.2, 0.9], hint: 'How often a tier steps back and leaves a terrace' },
            { id: 'plinth', label: 'Plinth', type: 'checkbox', value: true, random: 0.8 },
            { id: 'mirror', label: 'Mirror', type: 'checkbox', value: false, random: 0.5 },
            { type: 'section', label: 'Detail' },
            { id: 'cell', label: 'Finest detail (mm)', type: 'range', min: 0.8, max: 2.5, step: 0.05, value: 1.25, random: false, hint: 'Size of the grid the block is built on. Lines come no closer than about 0.7 of this' },
            { id: 'density', label: 'Density', type: 'range', min: 0, max: 1, step: 0.05, value: 1, random: [0.7, 1], hint: 'How much of each face and floor gets worked. The rest is left plain' },
            { id: 'stacks', label: 'Slab stacks', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6, random: [0.2, 1] },
            { id: 'fins', label: 'Fin arrays', type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, random: [0.2, 1] },
            { id: 'panels', label: 'Recessed panels', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6, random: [0.2, 1] },
            { type: 'section', label: 'View' },
            { id: 'yaw', label: 'Camera turn (°)', type: 'range', min: 20, max: 70, step: 0.5, value: 45, random: false },
            { id: 'elev', label: 'Camera height (°)', type: 'range', min: 20, max: 60, step: 0.25, value: 35.25, random: false, hint: '35.25 is true isometric' },
            { type: 'section', label: 'Shading' },
            { id: 'shade', label: 'Hatched faces', type: 'select', value: 'none', options: [['none', 'None'], ['left', 'Left'], ['right', 'Right']], random: ['none', 'none', 'none', 'none', 'left', 'right'] },
            { id: 'shadeGap', label: 'Hatch spacing (mm)', type: 'range', min: 0.5, max: 3, step: 0.05, value: 1.2, random: false, show: p => p.shade !== 'none' },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            // The pipeline fits the drawing to the page, into a square for the round crops. It's
            // drawn at that size here already, so a cell and the hatching come out in real millimeters.
            const { rng } = ctx, round = !!ctx.shape.kind && ctx.shape.kind !== 'rect', W = round ? Math.min(ctx.width, ctx.height) : ctx.width, H = round ? W : ctx.height;
            const unit = makeCamera(p.yaw, p.elev, 1, 0, 0, 0, 0);
            // paper size of an a by b by h block at 1 mm a cell
            const span = (a, b, h) => {
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (let i = 0; i < 8; i++) {
                    const q = unit.project(i & 1 ? a : 0, i & 2 ? b : 0, i & 4 ? h : 0);
                    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
                }
                return [x1 - x0, y1 - y0];
            };
            // Pick the cell counts so a cell comes out near the size asked for, with some
            // allowance for the plinth. Big sheets hit the cell limit and get bigger cells.
            // mirroring swaps the faces, so the footprint swaps back to keep the wider one on the same side
            const skew = p.mirror ? -p.skew : p.skew, fa = 1 + skew, fb = 1 - skew, [uw, uh] = span(fa + 0.12, fb + 0.12, p.height + 0.04);
            const s = geo.clamp(Math.min(W / uw, H / uh) / p.cell, 12, Math.cbrt(MAX_CELLS / (1.3 * fa * fb * p.height)));
            const a = Math.max(8, Math.round(s * fa)), b = Math.max(8, Math.round(s * fb)), h = Math.max(8, Math.round(s * p.height));
            const G = build(p, rng, a, b, h, Math.round(s));

            const segs = [];
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            outline(G, (kind, ax, from, to, j, k) => {
                const A = [0, 0, 0], B = [0, 0, 0], bx = (ax + 1) % 3, cx = (ax + 2) % 3;
                A[ax] = from; B[ax] = to; A[bx] = B[bx] = j; A[cx] = B[cx] = k;
                segs.push([kind, A, B]);
                for (const P of [A, B]) {
                    const q = unit.project(P[0], P[1], P[2]);
                    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
                }
            });
            const layers = PG.pens.layers(p.pens), n = layers.length, hatched = p.shade !== 'none' && n > 1, map = MAPS[hatched ? n - 2 : n - 1];
            if (!segs.length) return { layers };
            const k = Math.min(W / (x1 - x0), H / (y1 - y0));
            // the camera centers on half its page size, so this puts the middle of the drawing in the middle of ours
            const cam = makeCamera(p.yaw, p.elev, k, W - k * (x0 + x1), H - k * (y0 + y1), 0, 0), S = new Scene(cam, W, H);
            for (const [kind, A, B] of segs) { S.kind = kind; S.line([A, B]); }

            // Hatching runs evenly across the paper, so it lines up from one face to the next
            const side = p.shade === 'left' ? 0 : p.shade === 'right' ? 1 : -1, nrm = side ? [-Math.SQRT1_2, Math.SQRT1_2] : [Math.SQRT1_2, Math.SQRT1_2];
            S.kind = SHADE;
            skin(G, (ax, i, u0, v0, u1, v1) => {
                const [ux, vx] = ROWS[ax];
                const P = (u, v) => { const q = [0, 0, 0]; q[ax] = i; q[ux] = u; q[vx] = v; return q; };
                S.face([P(u0 - GROW, v0 - GROW), P(u1 + GROW, v0 - GROW), P(u1 + GROW, v1 + GROW), P(u0 - GROW, v1 + GROW)], false);
                if (ax !== side) return;
                const o = cam.project(...P(0, 0)), eu = cam.project(...P(1, 0)), ev = cam.project(...P(0, 1));
                const A = nrm[0] * (eu[0] - o[0]) + nrm[1] * (eu[1] - o[1]), B = nrm[0] * (ev[0] - o[0]) + nrm[1] * (ev[1] - o[1]);
                const C = nrm[0] * o[0] + nrm[1] * o[1], den = A * A + B * B;
                const f = [A * u0 + B * v0, A * u1 + B * v0, A * u0 + B * v1, A * u1 + B * v1];
                const lo = (Math.min(...f) + C) / p.shadeGap, hi = (Math.max(...f) + C) / p.shadeGap;
                for (let j = Math.ceil(lo + 1e-6); j <= hi - 1e-6; j++) {
                    // the line A u + B v = c, cut to the rectangle
                    const c = j * p.shadeGap - C, pu = A * c / den, pv = B * c / den;
                    let t0 = -Infinity, t1 = Infinity;
                    for (const [q, d, a0, a1] of [[pu, -B, u0, u1], [pv, A, v0, v1]]) {
                        if (Math.abs(d) < 1e-12) { if (q < a0 || q > a1) t0 = Infinity; continue; }
                        const ta = (a0 - q) / d, tb = (a1 - q) / d;
                        t0 = Math.max(t0, Math.min(ta, tb));
                        t1 = Math.min(t1, Math.max(ta, tb));
                    }
                    if (t1 - t0 > 1e-6) S.line([P(pu - B * t0, pv + A * t0), P(pu - B * t1, pv + A * t1)]);
                }
            });
            PG.iso.render(S).forEach((paths, kind) => {
                const pen = kind === SHADE ? Math.min(1, n - 1) : map[kind] && hatched ? map[kind] + 1 : map[kind];
                for (const q of paths) layers[pen].push(q);
            });
            return { layers };
        },
    });
})();
