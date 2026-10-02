/*
 * Skyline District: a crowded city seen from above, after the dense ink
 * drawings of cyberpunk cities. Blocks are cut into lots and every lot gets
 * one of about fifteen building types. Neighbouring blocks share a district
 * (downtown glass, midtown deco, the old Kowloon quarter or a leafy one) so
 * the page reads as parts of a city rather than a catalogue of towers.
 * Walls facing away from the sun are hatched to match the ground shadows,
 * a river with bridges and boats opens up the middle distance, and viaducts,
 * skybridges and overhead cables tie the blocks together.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { Scene, makeCamera, frame, hash, segments, ring, newell, BOX } = PG.iso;
    const kit = PG.isokit;
    const { lerp3, unit, inKind, turned } = kit;

    // line kinds, mapped to pens by P.scenes.skyline in pens.js
    const ARCH = 0, SIGN = 1, SHADE = 2, PAD = 3, GLASS = 4, CABLE = 5, PARK = 6, LIFE = 7, ROAD = 8, WATER = 9, ROOF = 10;
    const FL = 3.6; // storey (m)
    const WALK = 2.6; // sidewalk (m)
    const PROM = 6; // riverside promenade (m)
    const ZW = -2.6; // river surface, below the streets so the quay walls show
    // Most ground the page may show (m²). Big paper zooms in instead of building thousands of towers.
    const AREA = 125000;
    const F0 = frame(0, 0, 0, 0);
    const tree = kit.withKind(PARK, kit.roundTree);

    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const lift = (poly, z) => poly.map(q => [q[0], q[1], z]);
    const chamfer = (x0, y0, x1, y1, c) => [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
    const NROT = n => -Math.PI / 2 + Math.PI / n;
    // regular n-gon of circumradius r with a flat side facing -y, anticlockwise
    const ngon = (x, y, r, n) => Array.from({ length: n }, (_, i) => [x + r * Math.cos(NROT(n) + TAU * i / n), y + r * Math.sin(NROT(n) + TAU * i / n)]);

    // Small things whose shadows would mostly land inside their building's anyway
    function quiet(S, fn) {
        const keep = S.shadow;
        S.shadow = null;
        fn();
        S.shadow = keep;
    }

    // Push a convex footprint out by d, keeping its corners sharp
    function grow(poly, d) {
        const n = poly.length;
        return poly.map((q, i) => {
            const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
            const l1 = Math.hypot(q[0] - a[0], q[1] - a[1]), l2 = Math.hypot(b[0] - q[0], b[1] - q[1]);
            const n1 = [(q[1] - a[1]) / l1, -(q[0] - a[0]) / l1], n2 = [(b[1] - q[1]) / l2, -(b[0] - q[0]) / l2];
            const s = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
            return [q[0] + (n1[0] + n2[0]) * s, q[1] + (n1[1] + n2[1]) * s];
        });
    }

    // Walls of a convex footprint (anticlockwise). at(s, z, o) runs left to
    // right seen from outside, o out from the wall.
    function walls(T, poly) {
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 1e-6) continue;
            const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, n = [uy, -ux, 0];
            out.push({ len, u: [ux, uy, 0], n, seen: T.sees(n), dark: T.dark(n),
                at: (s, z, o = 0) => [a[0] + ux * s + uy * o, a[1] + uy * s - ux * o, z] });
        }
        return out;
    }

    function prism(T, poly, z0, z1) {
        T.S.prism(lift(poly, z0), [0, 0, z1 - z0]);
        return walls(T, poly);
    }

    function wallBox(S, W, s0, s1, z0, z1, o0, o1) {
        S.solid([W.at(s0, z0, o0), W.at(s1, z0, o0), W.at(s1, z0, o1), W.at(s0, z0, o1),
            W.at(s0, z1, o0), W.at(s1, z1, o0), W.at(s1, z1, o1), W.at(s0, z1, o1)], BOX);
    }

    // paper mm per metre along a wall
    const across = (T, W) => T.k * Math.max(0.15, Math.abs(W.u[0] * T.cam.rx + W.u[1] * T.cam.ry));

    // A plane standing at (x, y) facing n, w wide, for signs: at(s, z, o)
    const plane = (x, y, n, w) => (s, z, o = 0) => [x - n[1] * (s - w / 2) + n[0] * o, y + n[0] * (s - w / 2) + n[1] * o, z];

    // ------------------------------------------------------------------
    // Shading
    // ------------------------------------------------------------------

    function shadeWall(T, W, s0, s1, z0, z1, gap = T.gap * 1.15) {
        if (!T.shade || !W.seen || !W.dark || s1 - s0 < 0.05 || z1 - z0 < 0.05) return;
        inKind(T.S, SHADE, () => T.S.hatch([W.at(s0, z0), W.at(s1, z0), W.at(s1, z1), W.at(s0, z1)], [W.u[0], W.u[1], 1.1], gap));
    }

    // Any flat face turned from the sun, closer lines the further it turns
    function shadeFace(T, pts, n, dir) {
        if (!T.shade || !T.sees(n)) return;
        const lit = T.light(n);
        if (lit > 0) return;
        inKind(T.S, SHADE, () => T.S.hatch(pts, dir || [-n[1], n[0], 0], lit < -0.25 ? T.gap : T.gap * 1.7));
    }

    // Upright lines down the shaded side of a round shaft, or all the way across it
    function shadeRound(T, x, y, z0, z1, r0, r1, all = false, gap = T.gap) {
        if (!T.shade && !all) return;
        const c = T.cam, R = Math.max(r0, r1), step = gap / T.k;
        inKind(T.S, SHADE, () => {
            for (let t = -R + step / 2; t < R; t += step) {
                const f = t / R;
                if (Math.abs(f) > 0.985) continue;
                const d = Math.sqrt(1 - f * f), n = [c.rx * f - c.fx * d, c.ry * f - c.fy * d, 0];
                if (!all && !T.dark(n)) continue;
                T.S.line([[x + n[0] * (r0 + 0.04), y + n[1] * (r0 + 0.04), z0], [x + n[0] * (r1 + 0.04), y + n[1] * (r1 + 0.04), z1]]);
            }
        });
    }

    function outward(pts, centre) {
        const n = newell(pts);
        let cx = 0, cy = 0, cz = 0;
        for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; cz += p[2] / pts.length; }
        const s = n[0] * (cx - centre[0]) + n[1] * (cy - centre[1]) + n[2] * (cz - centre[2]) < 0 ? -1 : 1;
        return [n[0] * s, n[1] * s, n[2] * s];
    }

    // ------------------------------------------------------------------
    // Facades
    // ------------------------------------------------------------------

    const STROKES = [[0, 2, 2, 2], [0, 1, 2, 1], [0, 0, 2, 0], [0, 0, 0, 2], [1, 0, 1, 2], [2, 0, 2, 2], [0, 2, 2, 0], [0, 0, 2, 2],
        [0, 1, 1, 2], [1, 2, 2, 1], [0, 2, 1, 1], [1, 1, 2, 0], [0, 1, 1, 0], [1, 0, 2, 1], [1, 1, 1, 2], [0, 1, 1, 1]];

    // Made-up lettering, n glyphs of side sz from (u, v) in the plane at(u, v), along u or down v
    function glyphs(T, at, u, v, sz, n, rng, down = false) {
        const S = T.S, h = sz / 2;
        for (let g = 0; g < n; g++) {
            const u0 = down ? u : u + g * sz * 1.4, v0 = down ? v - sz - g * sz * 1.4 : v;
            for (const [a, b, c, d] of rng.shuffle(STROKES.slice()).slice(0, rng.int(2, 4))) S.line([at(u0 + a * h, v0 + b * h), at(u0 + c * h, v0 + d * h)]);
        }
    }

    // A couple of diagonal streaks of reflection across a lit glass wall
    function glint(T, W, z0, z1, rng) {
        const m = rng.range(1.3, 2.4);
        for (let k = rng.int(1, 2); k > 0; k--) {
            const c = rng.range(z0 - W.len * m * 0.5, z1 - W.len * m * 0.5), w = rng.range(2, 5);
            let poly = [[0, z0], [W.len, z0], [W.len, z1], [0, z1]];
            poly = geo.clipPolygonHalfPlane(poly, [0, c], [-m, 1]);
            poly = geo.clipPolygonHalfPlane(poly, [0, c + w], [m, -1]);
            if (poly.length >= 3) T.S.hatch(poly.map(([s, z]) => W.at(s, z, 0.01)), [W.u[0], W.u[1], m], 0.6);
        }
    }

    function facade(T, W, z0, z1, style, rng) {
        if (!W.seen || z1 - z0 < 1.5) return;
        const S = T.S, L = W.len, floors = Math.max(1, Math.round((z1 - z0) / FL)), fh = (z1 - z0) / floors;
        const px = across(T, W), pz = T.k * T.cam.ce, keep = S.kind;
        const floorLines = () => { for (let f = 1; f < floors; f++) S.line([W.at(0, z0 + f * fh), W.at(L, z0 + f * fh)]); };
        const bays = step => Math.max(1, Math.round(L / Math.max(step, 0.9 / px)));
        S.kind = ARCH;
        // shaded walls are left to the hatching. Floor lines on top turned them into crosshatch.
        if (T.shade && W.dark && style !== 'dark' && style !== 'bands') {
            S.kind = keep;
            return;
        }
        if (style === 'glass') {
            S.kind = GLASS;
            const n = bays(2.4);
            for (let i = 1; i < n; i++) S.line([W.at(L * i / n, z0), W.at(L * i / n, z1)]);
            floorLines();
            if (!W.dark && T.detail && rng.chance(0.55)) glint(T, W, z0, z1, rng);
        } else if (style === 'ribbon') {
            for (let f = 0; f < floors; f++) {
                const z = z0 + f * fh;
                S.line([W.at(0, z + 1), W.at(L, z + 1)]);
                S.line([W.at(0, z + fh - 0.7), W.at(L, z + fh - 0.7)]);
            }
            if (T.detail && px * 4.5 > 2) {
                const n = bays(4.5);
                for (let i = 1; i < n; i++) for (let f = 0; f < floors; f++) S.line([W.at(L * i / n, z0 + f * fh + 1), W.at(L * i / n, z0 + f * fh + fh - 0.7)]);
            }
        } else if (style === 'grid') {
            const n = bays(2.7), bw = L / n, ww = Math.min(1.4, bw * 0.55), wh = Math.min(1.8, fh - 1.4);
            if (!T.detail || ww * px < 0.8 || wh * pz < 0.9) floorLines();
            else for (let f = 0; f < floors; f++) for (let i = 0; i < n; i++) {
                const s = (i + 0.5) * bw - ww / 2, z = z0 + f * fh + 1.05;
                S.loop([W.at(s, z), W.at(s + ww, z), W.at(s + ww, z + wh), W.at(s, z + wh)]);
            }
        } else if (style === 'piers') {
            const sep = Math.max(0.6, 0.55 / px), n = Math.max(2, Math.round(L / Math.max(2.6, sep * 3.5)));
            for (let i = 1; i < n; i++) for (const d of [-sep / 2, sep / 2]) S.line([W.at(L * i / n + d, z0), W.at(L * i / n + d, z1)]);
            for (let f = 1; f < floors; f++) {
                const z = z0 + f * fh - 0.9;
                S.line([W.at(0, z), W.at(L, z)]);
            }
        } else if (style === 'bands') {
            // every third floor a dark band, the others with strip windows
            for (let f = 0; f < floors; f++) {
                const z = z0 + f * fh;
                if (f % 3 === 1) {
                    S.line([W.at(0, z + 0.4), W.at(L, z + 0.4)]);
                    S.line([W.at(0, z + fh - 0.4), W.at(L, z + fh - 0.4)]);
                    S.hatch([W.at(0, z + 0.4), W.at(L, z + 0.4), W.at(L, z + fh - 0.4), W.at(0, z + fh - 0.4)], [0, 0, 1], 0.62);
                } else if (T.detail) S.line([W.at(0, z + fh - 0.9), W.at(L, z + fh - 0.9)]);
            }
        } else if (style === 'dark') {
            // dark cladding with a slit every four floors. It's a material, not
            // shade, so it stays in black ink while the shade goes blue.
            const gap = W.dark ? 0.62 : 0.85;
            inKind(S, ARCH, () => {
                for (let z = z0; z < z1 - 0.5; z += 4 * fh) {
                    const zt = Math.min(z1, z + 4 * fh - 0.9);
                    S.hatch([W.at(0, z), W.at(L, z), W.at(L, zt), W.at(0, zt)], [0, 0, 1], gap);
                    if (zt < z1) S.line([W.at(0, zt + 0.45), W.at(L, zt + 0.45)]);
                }
            });
        }
        S.kind = keep;
    }

    function shaft(T, L, poly, z0, z1, style, rng, anchors = true) {
        const S = T.S;
        S.kind = ARCH;
        const ws = prism(T, poly, z0, z1);
        for (const W of ws) {
            facade(T, W, z0, z1, style, rng);
            if (style !== 'dark') shadeWall(T, W, 0, W.len, z0, z1);
            if (anchors && W.len > 3 && z1 > 7) for (let k = W.len > 12 ? 2 : 1; k > 0; k--) T.anchor(W.at(rng.range(0.6, W.len - 0.6), rng.range(Math.max(4, z0 + 1), Math.max(z0 + 2, z1 - 1.5)), 0.03), W.n, L.id);
        }
        T.block(poly, z1, L.id);
        return ws;
    }

    function parapet(T, poly, z, t = 0.8) {
        const S = T.S, g = grow(poly, 0.22);
        S.kind = ARCH;
        S.prism(lift(g, z), [0, 0, t]);
        const inner = geo.insetConvex(g, 0.45);
        if (inner.length >= 3) S.loop(lift(inner, z + t));
        return z + t;
    }

    // ------------------------------------------------------------------
    // Signs, pipes and clutter
    // ------------------------------------------------------------------

    // Blade sign standing out from a wall, lettered down whichever side we see
    function blade(T, W, s, z0, z1, rng) {
        if (!W.seen || z1 - z0 < 3) return;
        const S = T.S, out = rng.range(1.5, 2.3), t = 0.3;
        S.kind = SIGN;
        wallBox(S, W, s - t / 2, s + t / 2, z0, z1, 0.1, out);
        const side = T.sees([-W.u[0], -W.u[1], 0]) ? s - t / 2 - 0.01 : s + t / 2 + 0.01;
        const at = (o, z) => W.at(side, z, o);
        if (T.detail) {
            S.loop([at(0.3, z0 + 0.3), at(out - 0.2, z0 + 0.3), at(out - 0.2, z1 - 0.3), at(0.3, z1 - 0.3)]);
            const sz = out - 0.8, n = Math.floor((z1 - z0 - 0.8) / (sz * 1.4));
            if (sz * T.k > 1.2) glyphs(T, at, 0.5, z1 - 0.3, sz, n, rng, true);
        }
        S.kind = ARCH;
    }

    // Lettered panel flat on a wall. It hides the facade lines behind it.
    function panel(T, W, s0, s1, z0, z1, rng) {
        if (!W.seen) return;
        const S = T.S, at = (s, z) => W.at(s, z, 0.12);
        S.kind = SIGN;
        const q = [at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1)];
        S.face(q, false);
        S.loop(q);
        if (T.detail) {
            S.loop([at(s0 + 0.35, z0 + 0.35), at(s1 - 0.35, z0 + 0.35), at(s1 - 0.35, z1 - 0.35), at(s0 + 0.35, z1 - 0.35)]);
            const sz = Math.min(z1 - z0 - 1.4, 3), n = Math.floor((s1 - s0 - 1) / (sz * 1.4));
            if (sz * T.k > 1.2 && n > 0) glyphs(T, at, (s0 + s1) / 2 - (n * sz * 1.4 - sz * 0.4) / 2, (z0 + z1) / 2 - sz / 2, sz, n, rng);
        }
        S.kind = ARCH;
    }

    function pipe(T, W, s, z0, z1, rng) {
        if (!W.seen) return;
        const S = T.S, r = 0.24, zj = geo.lerp(z0, z1, rng.range(0.25, 0.75));
        const s2 = geo.clamp(s + rng.range(-5, 5), 0.6, W.len - 0.6);
        S.kind = SIGN;
        wallBox(S, W, s - r, s + r, z0, zj - r, 0.05, 0.05 + 2 * r);
        wallBox(S, W, Math.min(s, s2) - r, Math.max(s, s2) + r, zj - r, zj + r, 0.08, 0.08 + 2 * r);
        wallBox(S, W, s2 - r, s2 + r, zj + r, z1, 0.05, 0.05 + 2 * r);
        S.kind = ARCH;
    }

    // Height of the neighbour standing in front of wall W of lot L, between s0 and s1 along it
    function cover(L, W, s0, s1) {
        const spans = L.cover && L.cover[W.n[0] < -0.5 ? 0 : W.n[0] > 0.5 ? 1 : W.n[1] < -0.5 ? 2 : 3];
        if (!spans) return 0;
        const k = Math.abs(W.u[0]) > 0.5 ? 0 : 1, a = W.at(s0, 0)[k], b = W.at(s1, 0)[k];
        let h = 0;
        for (const [c0, c1, ch] of spans) if (c0 < Math.max(a, b) && c1 > Math.min(a, b)) h = Math.max(h, ch);
        return h;
    }

    // Rooms, cages and air conditioners hung all over a wall, Kowloon style
    function barnacles(T, W, z0, z1, rng, amount, L) {
        if (!W.seen || amount <= 0) return;
        const cw = 1.3, cols = Math.floor((W.len - 0.4) / cw), rows = Math.floor((z1 - z0 - 1) / FL);
        if (cols < 2 || rows < 1) return;
        const used = new Uint8Array(cols * rows);
        const free = (c0, c1, r0, r1) => {
            for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (used[r * cols + c]) return false;
            return true;
        };
        for (let t = Math.round(cols * rows * 0.4 * amount); t > 0; t--) {
            const w = rng.int(2, 3), c = rng.int(0, cols - w), r = rng.int(0, rows - 1), n = Math.min(rows - r, rng.weighted([[4, 1], [2, 2], [1, 3]]));
            if (c < 0 || !free(c, c + w, r, r + n)) continue;
            const s0 = 0.2 + c * cw + 0.12, s1 = 0.2 + (c + w) * cw - 0.12, zb = z0 + r * FL + 0.5;
            // below the roof of a close neighbour it's hidden anyway, or pokes up through it
            if (zb < cover(L, W, s0 - 0.5, s1 + 0.5)) continue;
            for (let rr = r; rr < r + n; rr++) for (let cc = c; cc < c + w; cc++) used[rr * cols + cc] = 1;
            room(T, W, s0, s1, zb, z0 + (r + n) * FL - 0.4, rng.range(0.8, 1.8), rng);
        }
    }

    function room(T, W, s0, s1, zb, zt, out, rng) {
        const S = T.S, at = (s, z) => W.at(s, z, out), px = across(T, W);
        S.kind = ARCH;
        wallBox(S, W, s0, s1, zb, zt, 0, out);
        const rows = Math.max(1, Math.round((zt - zb) / FL)), rh = (zt - zb) / rows, ww = Math.min(s1 - s0 - 0.6, rng.range(1, 1.7));
        if (T.detail && ww * px > 0.9) for (let r = 0; r < rows; r++) {
            const z = zb + r * rh + 0.8, h = Math.min(1.4, rh - 1.2), s = s0 + (s1 - s0 - ww) / 2;
            if (h < 0.5) continue;
            S.loop([at(s, z), at(s + ww, z), at(s + ww, z + h), at(s, z + h)]);
            if (rng.chance(0.45) && ww * px > 1.8) for (let i = 1; i < 3; i++) S.line([at(s + ww * i / 3, z), at(s + ww * i / 3, z + h)]);
            else if (rng.chance(0.4)) wallBox(S, W, s + 0.1, s + 0.8, z - 0.65, z - 0.15, out, out + 0.45);
        }
        for (const [s, sg] of [[s0, -1], [s1, 1]]) {
            const n = [W.u[0] * sg, W.u[1] * sg, 0];
            if (T.shade && T.sees(n) && T.dark(n)) inKind(S, SHADE, () => S.hatch([W.at(s, zb, 0), W.at(s, zb, out), W.at(s, zt, out), W.at(s, zt, 0)], [W.n[0], W.n[1], 1.1], T.gap));
        }
    }

    // Two-pole aerials with crossbars, a Kowloon rooftop forest
    function aerials(T, x0, y0, x1, y1, z, n, rng) {
        const S = T.S;
        inKind(S, CABLE, () => {
            for (let i = 0; i < n; i++) {
                const x = rng.range(x0, x1), y = rng.range(y0, y1), h = rng.range(2.5, 6), a = rng.range(0, Math.PI);
                const dx = Math.cos(a), dy = Math.sin(a);
                S.line([[x, y, z], [x, y, z + h]]);
                for (let k = rng.int(1, 3); k > 0; k--) {
                    const zz = z + h - k * 0.6, w = 0.5 + 0.25 * k;
                    S.line([[x - dx * w, y - dy * w, zz], [x + dx * w, y + dy * w, zz]]);
                }
            }
        });
    }

    function shack(T, x, y, z, w, d, rng) {
        const S = T.S, h = rng.range(2.2, 2.8), F = frame(x, y, z, 0);
        S.box(F, 0, 0, 0, w, d, h);
        S.solid([F.P(-0.2, -0.3, h), F.P(w + 0.2, -0.3, h), F.P(w + 0.2, d + 0.2, h), F.P(-0.2, d + 0.2, h),
            F.P(-0.2, -0.3, h + 0.15), F.P(w + 0.2, -0.3, h + 0.15), F.P(w + 0.2, d + 0.2, h + 0.7), F.P(-0.2, d + 0.2, h + 0.7)], BOX);
        if (T.detail && w > 1.6) S.loop([F.P(0.4, 0, 0), F.P(1.2, 0, 0), F.P(1.2, 0, 2), F.P(0.4, 0, 2)]);
    }

    // ------------------------------------------------------------------
    // Rooftops
    // ------------------------------------------------------------------

    // Lattice mast with guy wires and a beacon on top
    function mast(T, x, y, z, h, reach) {
        const S = T.S, w = geo.clamp(h * 0.04, 0.3, 0.9), t = w * 0.3;
        const at = (sx, sy, f) => { const r = geo.lerp(w, t, f); return [x + sx * r, y + sy * r, z + h * f]; };
        const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        if (w * T.k < 1) {
            // too thin on paper for a lattice: a pole with a few crossbars
            inKind(S, CABLE, () => {
                S.line([[x, y, z], [x, y, z + h]]);
                for (let f = 0.55; f < 0.95; f += 0.18) S.line([[x - T.cam.rx * w * 1.5, y - T.cam.ry * w * 1.5, z + h * f], [x + T.cam.rx * w * 1.5, y + T.cam.ry * w * 1.5, z + h * f]]);
                if (reach > 1.5) for (const [sx, sy] of C) S.line([[x, y, z + h * 0.6], [x + sx * reach * 0.7, y + sy * reach * 0.7, z]]);
            });
            inKind(S, SIGN, () => S.line([[x, y, z + h], [x, y, z + h + 1]]));
            return;
        }
        inKind(S, CABLE, () => {
            for (const [sx, sy] of C) S.line([at(sx, sy, 0), at(sx, sy, 1)]);
            const n = Math.max(2, Math.round(h / (w * 2.4))) * 2;
            for (const [i, j] of [[0, 1], [3, 0]]) {
                const pts = [];
                for (let k = 0; k <= n; k++) pts.push(at(...C[k % 2 ? j : i], k / n));
                S.line(pts);
            }
            if (reach > 1.5) for (const [sx, sy] of C) S.line([at(sx, sy, 0.6), [x + sx * reach * 0.7, y + sy * reach * 0.7, z]]);
        });
        inKind(S, SIGN, () => S.line([[x, y, z + h], [x, y, z + h + 1]]));
    }

    function waterTower(T, x, y, z, rng) {
        const S = T.S, r = rng.range(1.2, 1.7), zb = z + rng.range(1.6, 2.4), h = r * rng.range(1.4, 1.8), n = T.segs(r), e = r * 0.7;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) S.line([[x + a * e, y + b * e, z], [x + a * e, y + b * e, zb]]);
        S.line([[x - e, y - e, z], [x + e, y - e, zb]]);
        S.line([[x - e, y + e, z], [x - e, y - e, zb]]);
        S.frustum(x, y, zb, zb + h, r, r, n);
        S.lathe(x, y, [[r + 0.2, zb + h], [0, zb + h + r * 0.7]], n);
        if (T.detail) for (let f = 1; f <= 2; f++) S.loop(ring(n, (c, s) => [x + (r + 0.03) * c, y + (r + 0.03) * s, zb + h * f / 3]));
    }

    function plantRoom(T, x0, y0, x1, y1, z, h) {
        const S = T.S, ws = prism(T, rect(x0, y0, x1, y1), z, z + h);
        const step = Math.max(0.5, 0.6 / (T.k * T.cam.ce));
        for (const W of ws) {
            if (!W.seen) continue;
            if (W.dark) shadeWall(T, W, 0, W.len, z, z + h);
            else if (T.detail) for (let c = z + 0.5; c < z + h - 0.3; c += step) S.line([W.at(0.35, c), W.at(W.len - 0.35, c)]);
        }
        S.box(F0, x0 - 0.15, y0 - 0.15, z + h, x1 + 0.15, y1 + 0.15, z + h + 0.3);
    }

    function helipad(T, x, y, z, R) {
        const S = T.S;
        T.pad(x, y, z + 0.5, R);
        S.kind = ARCH;
        S.lathe(x, y, [[R, z], [R, z + 0.5]], 8, false, Math.PI / 8);
        const zt = z + 0.51, r = R * 0.74, a = r * 0.34, b = r * 0.5;
        inKind(S, PAD, () => {
            S.loop(ring(T.segs(r), (c, s) => [x + r * c, y + r * s, zt]));
            S.line([[x - a, y - b, zt], [x - a, y + b, zt]]);
            S.line([[x + a, y - b, zt], [x + a, y + b, zt]]);
            S.line([[x - a, y, zt], [x + a, y, zt]]);
        });
    }

    function billboard(T, x, y, z, w, h, n, rng) {
        const S = T.S, at = plane(x, y, n, w), z0 = z + rng.range(1.2, 2.2), z1 = z0 + h;
        S.kind = ARCH;
        for (const s of [w * 0.18, w * 0.82]) {
            S.line([at(s, z, -0.3), at(s, z0, -0.3)]);
            S.line([at(s, z, -1.3), at(s, z0, -0.35)]);
        }
        S.kind = SIGN;
        S.solid([at(0, z0, 0), at(w, z0, 0), at(w, z0, -0.3), at(0, z0, -0.3), at(0, z1, 0), at(w, z1, 0), at(w, z1, -0.3), at(0, z1, -0.3)], BOX);
        if (T.detail && T.sees([n[0], n[1], 0])) {
            const f = (s, c) => at(s, c, 0.01);
            S.loop([f(0.35, z0 + 0.35), f(w - 0.35, z0 + 0.35), f(w - 0.35, z1 - 0.35), f(0.35, z1 - 0.35)]);
            const sz = Math.min(h - 1.4, 2.6), k = Math.floor((w - 1.2) / (sz * 1.4));
            if (sz * T.k > 1.2 && k > 0) glyphs(T, f, w / 2 - (k * sz * 1.4 - sz * 0.4) / 2, (z0 + z1) / 2 - sz / 2, sz, k, rng);
        }
        S.kind = ARCH;
    }

    function dish(T, x, y, z, rng) {
        const S = T.S, r = rng.range(0.7, 1.1), a = rng.range(0, TAU), tilt = rng.range(0.5, 0.9);
        const c = [x, y, z + 1.1 + r * 0.5], e1 = [-Math.sin(a), Math.cos(a), 0], e2 = [Math.cos(a) * Math.cos(tilt), Math.sin(a) * Math.cos(tilt), Math.sin(tilt)];
        S.line([[x, y, z], c]);
        const pts = ring(T.segs(r), (u, v) => [c[0] + r * (u * e1[0] + v * e2[0]), c[1] + r * (u * e1[1] + v * e2[1]), c[2] + r * v * e2[2]]);
        S.face(pts, false);
        S.loop(pts);
        const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const sg = nrm[2] > 0 ? 1 : -1;
        S.line([c, [c[0] + nrm[0] * sg * r, c[1] + nrm[1] * sg * r, c[2] + nrm[2] * sg * r]]);
    }

    // Rooftop pool with a raised rim, water hatched across it and loungers along the -y side
    function pool(T, x0, y0, x1, y1, z, rng) {
        const S = T.S, q = lift(rect(x0, y0, x1, y1), z + 0.36);
        S.kind = ARCH;
        S.box(F0, x0 - 0.3, y0 - 0.3, z, x1 + 0.3, y1 + 0.3, z + 0.35);
        S.loop(q);
        inKind(S, WATER, () => S.hatch(q, [1, 0, 0], T.gap * 1.3));
        for (let x = x0 + 0.3; x < x1 - 0.8; x += rng.range(1.3, 2)) S.box(F0, x, y0 - 1.6, z, x + 0.7, y0 - 0.5, z + 0.35);
        if (rng.chance(0.6)) inKind(S, LIFE, () => kit.person(T, rng.range(x0, x1), y0 - 1, z, rng));
    }

    // Fenced ball court, markings in the pad ink
    function court(T, x0, y0, x1, y1, z) {
        const S = T.S, zc = z + 0.02, alongX = x1 - x0 > y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.min(x1 - x0, y1 - y0) * 0.16;
        inKind(S, PAD, () => {
            S.loop(lift(rect(x0 + 0.6, y0 + 0.6, x1 - 0.6, y1 - 0.6), zc));
            S.line(alongX ? [[cx, y0 + 0.6, zc], [cx, y1 - 0.6, zc]] : [[x0 + 0.6, cy, zc], [x1 - 0.6, cy, zc]]);
            S.loop(ring(T.segs(r), (c, s) => [cx + r * c, cy + r * s, zc]));
        });
        inKind(S, CABLE, () => {
            const h = 2.6, pts = lift(rect(x0, y0, x1, y1), z + h);
            S.loop(pts);
            for (const [x, y] of rect(x0, y0, x1, y1)) S.line([[x, y, z], [x, y, z + h]]);
        });
    }

    function rooftop(T, x0, y0, x1, y1, z, rng, o = {}) {
        const S = T.S, w = x1 - x0, d = y1 - y0;
        if (w < 2.5 || d < 2.5) return;
        quiet(S, () => {
            const occ = new kit.Occupancy(w, d);
            const spot = (a, b) => {
                const q = occ.place(rng, a, b);
                if (!q) return null;
                // o.poly is a chamfered roof, whose cut corners aren't there to stand on
                if (o.poly && ![[0, 0], [a, 0], [a, b], [0, b]].every(([u, v]) => geo.pointInPolygon(x0 + q[0] + u, y0 + q[1] + v, o.poly))) {
                    occ.rects.pop();
                    return null;
                }
                return [x0 + q[0], y0 + q[1]];
            };
            S.kind = ARCH;
            if (o.pad && Math.min(w, d) > 9) {
                const R = Math.min(Math.min(w, d) / 2 - 0.5, 9);
                helipad(T, (x0 + x1) / 2, (y0 + y1) / 2, z, R);
                occ.add(w / 2 - R, d / 2 - R, w / 2 + R, d / 2 + R);
            } else if (rng.chance(0.8) && w > 5 && d > 5) {
                const pw = geo.clamp(w * rng.range(0.3, 0.5), 2.5, 10), pd = geo.clamp(d * rng.range(0.3, 0.5), 2.5, 10), q = spot(pw, pd);
                if (q) plantRoom(T, q[0], q[1], q[0] + pw, q[1] + pd, z, rng.range(2.4, 3.8));
            }
            if (rng.chance(o.pool || 0) && w > 9 && d > 7) {
                const pw = Math.min(w - 3, rng.range(6, 10)), pd = Math.min(d - 4, rng.range(3, 4.5)), q = spot(pw + 1.2, pd + 2.4);
                if (q) pool(T, q[0] + 0.6, q[1] + 1.8, q[0] + 0.6 + pw, q[1] + 1.8 + pd, z, rng);
            }
            if (rng.chance(o.court || 0) && w > 12 && d > 9) {
                const q = spot(11, 7);
                if (q) court(T, q[0], q[1], q[0] + 11, q[1] + 7, z);
            }
            if (rng.chance(o.garden || 0)) {
                for (let i = rng.int(2, 5); i > 0; i--) {
                    const q = spot(3.4, 3.4);
                    if (q) tree(T, q[0] + 1.7, q[1] + 1.7, z, rng);
                }
            }
            if (rng.chance(o.sign || 0)) {
                const bw = Math.min(rng.range(6, 11), (Math.max(w, d) - 1) * 0.9), n = w > d ? [0, -1] : [-1, 0];
                const q = n[1] ? spot(bw, 1.6) : spot(1.6, bw);
                if (q && bw > 3) billboard(T, q[0] + (n[1] ? bw / 2 : 0.8), q[1] + (n[1] ? 0.8 : bw / 2), z, bw, rng.range(2.8, 4.2), n, rng);
            }
            if (T.detail) {
                for (let i = rng.int(0, 3); i > 0; i--) { const q = spot(1.3, 1.3); if (q) kit.roofUnit(T, F0, q[0] + 0.65, q[1] + 0.65, z, 1.2); }
                if (rng.chance(o.tank || 0.3)) { const q = spot(4, 4); if (q) waterTower(T, q[0] + 2, q[1] + 2, z, rng); }
                if (rng.chance(0.2)) { const q = spot(2.4, 2.4); if (q) dish(T, q[0] + 1.2, q[1] + 1.2, z, rng); }
            }
            if (rng.chance(o.mast || 0)) {
                const q = spot(3, 3);
                if (q) mast(T, q[0] + 1.5, q[1] + 1.5, z, rng.range(7, 16), 1.5);
            }
            if (rng.chance(o.people || 0.15)) {
                const q = spot(1, 1);
                if (q) inKind(S, LIFE, () => kit.person(T, q[0] + 0.5, q[1] + 0.5, z, rng));
            }
        });
    }

    // ------------------------------------------------------------------
    // Building types. Each builds on lot L = { id, x0, y0, x1, y1, h, rng }.
    // ------------------------------------------------------------------

    function extras(T, L, ws, z0, z1, rng) {
        const p = T.p;
        for (const W of ws) {
            if (!W.seen || W.len < 5) continue;
            if (rng.chance(p.signs * 0.45) && z1 - z0 > 12) {
                const s = rng.chance(0.5) ? rng.range(0.8, 2) : W.len - rng.range(0.8, 2), zb = Math.max(z0 + rng.range(4, 9), cover(L, W, s - 0.5, s + 0.5));
                blade(T, W, s, zb, Math.min(z1 - 2, zb + rng.range(6, 14)), rng);
            }
            if (rng.chance(p.signs * 0.35) && z1 - z0 > 16) {
                const w = Math.min(W.len - 2, rng.range(6, 12)), s = rng.range(1, W.len - 1 - w), zb = z0 + rng.range(6, Math.max(7, z1 - z0 - 10));
                panel(T, W, s, s + w, zb, zb + rng.range(3, 5), rng);
            }
            if (rng.chance(p.signs * 0.2)) pipe(T, W, rng.range(1, W.len - 1), z0, Math.min(z1, z0 + rng.range(10, 40)), rng);
        }
    }

    function glassTower(T, L) {
        const { rng } = L, S = T.S, x0 = L.x0 + 0.4, y0 = L.y0 + 0.4, x1 = L.x1 - 0.4, y1 = L.y1 - 0.4, m = Math.min(x1 - x0, y1 - y0);
        const poly = rng.chance(0.35) ? chamfer(x0, y0, x1, y1, m * rng.range(0.1, 0.2)) : rect(x0, y0, x1, y1);
        const crown = rng.weighted([[3, 'flat'], [poly.length === 4 ? 2.5 : 0, 'slant'], [2, 'setback']]);
        const top = crown === 'setback' ? L.h - 2 * FL : L.h, lobby = 1.3 * FL;
        S.kind = ARCH;
        const inner = geo.insetConvex(poly, 1.2);
        const lw = prism(T, inner, 0, lobby);
        for (const W of lw) if (W.seen && T.detail) {
            const n = Math.max(1, Math.round(W.len / 3));
            for (let i = 1; i < n; i++) S.line([W.at(W.len * i / n, 0), W.at(W.len * i / n, lobby)]);
        }
        if (poly.length === 4) for (const [x, y] of poly) {
            const sx = x < (x0 + x1) / 2 ? 1 : -1, sy = y < (y0 + y1) / 2 ? 1 : -1;
            S.box(F0, Math.min(x + sx * 0.1, x + sx * 0.9), Math.min(y + sy * 0.1, y + sy * 0.9), 0, Math.max(x + sx * 0.1, x + sx * 0.9), Math.max(y + sy * 0.1, y + sy * 0.9), lobby);
        }
        const ws = shaft(T, L, poly, lobby, top, 'glass', rng);
        extras(T, L, ws, lobby, top, rng);
        if (poly.length === 4) L.flat = [x0, y0, x1, y1, top, 8];
        if (crown === 'slant') {
            const g = grow(poly, 0.18), rise = m * rng.range(0.45, 0.8), alongX = rng.chance(0.5);
            const [a, b, , d] = g;
            S.kind = ARCH;
            if (alongX) S.prism([[a[0], a[1], top], [d[0], d[1], top], [d[0], d[1], top + rise]], [b[0] - a[0], 0, 0]);
            else S.prism([[a[0], a[1], top], [b[0], b[1], top], [b[0], b[1], top + rise]], [0, d[1] - a[1], 0]);
            const lo0 = a, lo1 = alongX ? b : d, hi0 = alongX ? d : b, hi1 = g[2];
            const pts = [[...lo0, top], [...lo1, top], [...hi1, top + rise], [...hi0, top + rise]];
            const n = outward(pts, [(a[0] + g[2][0]) / 2, (a[1] + g[2][1]) / 2, top + rise * 0.3]);
            if (T.sees(n)) {
                S.kind = GLASS;
                const len = Math.hypot(lo1[0] - lo0[0], lo1[1] - lo0[1]), k = Math.max(2, Math.round(len / 1.8));
                for (let i = 1; i < k; i++) S.line([lerp3(pts[0], pts[1], i / k), lerp3(pts[3], pts[2], i / k)]);
                shadeFace(T, pts, n, [lo1[0] - lo0[0], lo1[1] - lo0[1], 0]);
            }
            if (rng.chance(0.3)) quiet(S, () => mast(T, (hi0[0] + hi1[0]) / 2, (hi0[1] + hi1[1]) / 2, top + rise, rng.range(8, 18), 0));
        } else {
            let z = parapet(T, poly, top), rp = poly;
            if (crown === 'setback') {
                rp = geo.insetConvex(poly, Math.min(2.2, m * 0.15));
                shaft(T, L, rp, z, L.h, 'ribbon', rng);
                z = parapet(T, rp, L.h);
            }
            const b = geo.bbox([rp]);
            rooftop(T, b.minX + 0.8, b.minY + 0.8, b.maxX - 0.8, b.maxY - 0.8, z, rng, { pad: L.h > 50 && rng.chance(0.4), mast: 0.15, tank: 0.2, sign: 0.1, pool: 0.35, garden: 0.15, poly: rp.length > 4 ? rp : null });
        }
    }

    function officeTower(T, L) {
        const { rng } = L, style = L.facade && rng.chance(0.75) ? L.facade : rng.weighted([[3, 'ribbon'], [3, 'grid'], [2, 'piers'], [1.5, 'bands']]);
        let x0 = L.x0 + 0.4, y0 = L.y0 + 0.4, x1 = L.x1 - 0.4, y1 = L.y1 - 0.4, z = 0;
        const tiers = Math.min(x1 - x0, y1 - y0) > 13 ? rng.weighted([[3, 1], [3, 2], [1.5, 3]]) : 1;
        for (let t = 0; t < tiers; t++) {
            const top = t === tiers - 1 ? L.h : Math.max(z + 2 * FL, Math.round(L.h * (0.5 + 0.2 * t) / FL) * FL);
            if (top <= z + 1) break;
            const poly = rect(x0, y0, x1, y1), ws = shaft(T, L, poly, z, top, style, rng);
            if (t === 0) {
                extras(T, L, ws, 0, top, rng);
                // flat walls a skybridge can meet: [x0, y0, x1, y1, top, bottom]
                L.flat = [x0, y0, x1, y1, top, 8];
                // squatters' rooms crusted over the lower floors, so no bridge down there
                if (rng.chance(T.p.clutter * 0.5)) {
                    const zt = Math.min(top - 1, rng.range(12, 34));
                    quiet(T.S, () => { for (const W of ws) barnacles(T, W, FL + 0.5, zt, rng, T.p.clutter, L); });
                    L.flat[5] = zt + 1;
                }
            }
            z = parapet(T, poly, top);
            if (t < tiers - 1) {
                const w = x1 - x0, d = y1 - y0, nx0 = x0 + w * rng.range(0.12, 0.25), ny0 = y0 + d * rng.range(0.12, 0.25);
                const nx1 = x1 - w * rng.range(0, 0.1), ny1 = y1 - d * rng.range(0, 0.1);
                // life on the terrace we step back from
                if (rng.chance(0.5)) quiet(T.S, () => tree(T, (x0 + nx0) / 2, (y0 + ny0) / 2 + d * 0.3, z, rng));
                x0 = nx0; y0 = ny0; x1 = nx1; y1 = ny1;
            }
        }
        rooftop(T, x0 + 0.7, y0 + 0.7, x1 - 0.7, y1 - 0.7, z, rng, { pad: L.h > 55 && rng.chance(0.3), mast: 0.12, tank: 0.45, sign: 0.25, court: 0.2, pool: 0.12, garden: 0.2 });
    }

    function decoTower(T, L) {
        const { rng } = L, S = T.S, cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2;
        const hw = (L.x1 - L.x0) / 2 - 0.4, hd = (L.y1 - L.y0) / 2 - 0.4, steps = [0.5, 0.7, 0.86, 1], body = L.h * 0.86;
        let z = 0;
        steps.forEach((f, t) => {
            const s = 1 - t * 0.16, poly = rect(cx - hw * s, cy - hd * s, cx + hw * s, cy + hd * s), top = body * f;
            const ws = shaft(T, L, poly, z, top, 'piers', rng);
            if (t === 0) {
                extras(T, L, ws, 0, top, rng);
                L.flat = [cx - hw, cy - hd, cx + hw, cy + hd, top, 8];
            }
            z = parapet(T, poly, top, 1.1);
        });
        const s = 1 - 3 * 0.16;
        let r = Math.min(hw, hd) * s * 0.8;
        for (let k = 0; k < 3 && r > 1; k++) {
            S.box(F0, cx - r, cy - r, z, cx + r, cy + r, z + 2.2);
            z += 2.2;
            r *= 0.72;
        }
        const top = z + Math.max(6, L.h - z);
        S.lathe(cx, cy, [[r * Math.SQRT2, z], [0, top]], 4, false, Math.PI / 4);
        const centre = [cx, cy, z + (top - z) * 0.25];
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2, b = a + Math.PI / 2, R = r * Math.SQRT2;
            const tri = [[cx + R * Math.cos(a), cy + R * Math.sin(a), z], [cx + R * Math.cos(b), cy + R * Math.sin(b), z], [cx, cy, top]];
            shadeFace(T, tri, outward(tri, centre), [Math.cos(b) - Math.cos(a), Math.sin(b) - Math.sin(a), 0]);
        }
        inKind(S, PAD, () => S.line([[cx, cy, top], [cx, cy, top + (top - z) * 0.5]]));
    }

    function drumTower(T, L) {
        const { rng } = L, S = T.S, cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2, r = Math.min(L.x1 - L.x0, L.y1 - L.y0) / 2 - 0.5, h = L.h;
        if (rng.chance(0.45)) {
            const poly = ngon(cx, cy, r / Math.cos(Math.PI / 8), 8), ws = shaft(T, L, poly, 0, h, rng.pick(['bands', 'ribbon', 'glass', 'bands']), rng);
            extras(T, L, ws.filter(W => W.len > 6), 0, h, rng);
            let z = parapet(T, poly, h);
            const q = ngon(cx, cy, r * 0.62 / Math.cos(Math.PI / 8), 8);
            shaft(T, L, q, z, z + 2 * FL, 'ribbon', rng);
            z = parapet(T, q, z + 2 * FL);
            quiet(S, () => mast(T, cx, cy, z, rng.range(8, 20), r * 0.5));
            return;
        }
        const n = T.segs(r), style = rng.pick(['rings', 'bands', 'glass']), floors = Math.round(h / FL), fh = h / floors;
        S.kind = ARCH;
        S.lathe(cx, cy, [[r, 0], [r, h]], n);
        T.block([[cx - r, cy - r], [cx + r, cy + r]], h, L.id);
        const circle = (z, rr = r + 0.04) => S.loop(ring(Math.max(n, 24), (c, s) => [cx + rr * c, cy + rr * s, z]));
        S.kind = style === 'glass' ? GLASS : ARCH;
        for (let f = 1; f < floors; f++) circle(f * fh);
        if (style === 'glass') {
            // mullions crowd together towards the edges, so drop any that land too close on paper
            const m = Math.max(8, Math.round(TAU * r / Math.max(1.8, 1.2 / T.k))), cam = T.cam, xs = [];
            for (let i = 0; i < m; i++) {
                const a = TAU * i / m, c = Math.cos(a), s = Math.sin(a);
                if (c * cam.fx + s * cam.fy < 0) xs.push([r * T.k * (c * cam.rx + s * cam.ry), c, s]);
            }
            xs.sort((u, v) => u[0] - v[0]);
            let last = -Infinity;
            for (const [x, c, s] of xs) {
                if (x - last < 0.5) continue;
                last = x;
                S.line([[cx + (r + 0.04) * c, cy + (r + 0.04) * s, 0], [cx + (r + 0.04) * c, cy + (r + 0.04) * s, h]]);
            }
        }
        S.kind = ARCH;
        if (style === 'bands') for (let f = 1; f < floors; f += 3) shadeRound(T, cx, cy, f * fh + 0.3, (f + 1) * fh - 0.3, r, r, true, 0.5);
        shadeRound(T, cx, cy, 0, h, r, r);
        for (let k = 0; k < 2; k++) {
            const a = rng.range(0, TAU);
            T.anchor([cx + (r + 0.05) * Math.cos(a), cy + (r + 0.05) * Math.sin(a), rng.range(5, Math.min(h - 1, 32))], [Math.cos(a), Math.sin(a), 0], L.id);
        }
        S.lathe(cx, cy, [[r + 0.5, h], [r + 0.5, h + 0.8]], n);
        const r2 = r * rng.range(0.5, 0.7), h2 = rng.range(1.5, 3) * FL;
        S.lathe(cx, cy, [[r2, h + 0.8], [r2, h + 0.8 + h2]], T.segs(r2));
        shadeRound(T, cx, cy, h + 0.8, h + 0.8 + h2, r2, r2);
        if (rng.chance(0.5) && r2 > 5) helipad(T, cx, cy, h + 0.8 + h2, r2 + 0.6);
        else quiet(S, () => mast(T, cx, cy, h + 0.8 + h2, rng.range(8, 18), r2 * 0.7));
    }

    function taperTower(T, L) {
        const { rng } = L, S = T.S, cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2, n = rng.pick([4, 4, 6, 8]);
        // a hexagon's corners point along x, past its flat sides
        const hx = (L.x1 - L.x0) / 2 - 0.4, hy = (L.y1 - L.y0) / 2 - 0.4, rin = Math.min(hy, n === 6 ? hx * Math.cos(Math.PI / 6) : hx);
        const R0 = rin / Math.cos(Math.PI / n), t = rng.range(0.4, 0.7), h = L.h;
        S.kind = ARCH;
        S.lathe(cx, cy, [[R0, 0], [R0 * t, h]], n, false, NROT(n));
        T.block(ngon(cx, cy, R0, n), h, L.id);
        const floors = Math.round(h / FL), fh = h / floors, glass = rng.chance(0.5);
        const r = z => R0 * geo.lerp(1, t, z / h);
        for (let f = 1; f < floors; f++) {
            S.kind = glass ? GLASS : ARCH;
            S.loop(lift(ngon(cx, cy, r(f * fh), n), f * fh));
        }
        const b0 = ngon(cx, cy, R0, n), b1 = ngon(cx, cy, R0 * t, n), centre = [cx, cy, h * 0.3];
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, q = [[...b0[i], 0], [...b0[j], 0], [...b1[j], h], [...b1[i], h]], nn = outward(q, centre);
            if (!T.sees(nn)) continue;
            // paper width of the facet, so edge-on ones don't fill up with lines
            const wide = T.k * Math.abs((b0[j][0] - b0[i][0]) * T.cam.rx + (b0[j][1] - b0[i][1]) * T.cam.ry);
            if (glass) {
                const k = Math.min(Math.floor(wide / 0.7), Math.max(2, Math.round(Math.hypot(b0[j][0] - b0[i][0], b0[j][1] - b0[i][1]) / 2.2)));
                inKind(S, GLASS, () => { for (let m = 1; m < k; m++) S.line([lerp3(q[0], q[1], m / k), lerp3(q[3], q[2], m / k)]); });
            }
            shadeFace(T, q, nn, [b0[j][0] - b0[i][0], b0[j][1] - b0[i][1], 0]);
            if (!glass && T.detail && wide * t > 2.5) {
                const seg = [q[0], q[1]], k = Math.max(1, Math.min(Math.floor(wide * t / 2.5), Math.round(Math.hypot(b0[j][0] - b0[i][0], b0[j][1] - b0[i][1]) / 3)));
                for (let f = 0; f < floors; f++) for (let m = 0; m < k; m++) {
                    const z = f * fh + 1, z2 = z + Math.min(1.6, fh - 1.4), g = (m + 0.3) / k, g2 = (m + 0.7) / k;
                    const P = (u, zz) => { const s = r(zz) / R0, A = lerp3(seg[0], seg[1], u); return [cx + (A[0] - cx) * s, cy + (A[1] - cy) * s, zz]; };
                    S.loop([P(g, z), P(g2, z), P(g2, z2), P(g, z2)]);
                }
            }
        }
        S.kind = ARCH;
        const top = ngon(cx, cy, R0 * t, n), z = parapet(T, top, h);
        quiet(S, () => {
            if (R0 * t > 4) mast(T, cx, cy, z, rng.range(10, 24), R0 * t * 0.6);
            else S.line([[cx, cy, z], [cx, cy, z + 10]]);
        });
    }

    function twistTower(T, L) {
        const { rng } = L, S = T.S, cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2, half = Math.min(L.x1 - L.x0, L.y1 - L.y0) / 2 - 0.4;
        const total = rng.range(0.7, 1.2) * rng.sign(), floors = Math.max(4, Math.round(L.h / FL)), th0 = rng.range(0, Math.PI / 2), plate = 0.4;
        // sized by the widest any floor gets once turned, so none pokes out of the lot
        let e = 1;
        for (let f = 0; f < floors; f++) {
            const th = th0 - total / 2 + total * f / (floors - 1);
            e = Math.max(e, Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)));
        }
        const a = half / e - 0.5;
        S.kind = ARCH;
        T.block([[cx - half, cy - half], [cx + half, cy + half]], L.h, L.id);
        for (let f = 0; f < floors; f++) {
            const th = th0 - total / 2 + total * f / (floors - 1), F = turned(cx, cy, f * FL, th);
            S.box(F, -a, -a, 0, a, a, FL - plate);
            S.box(F, -a - 0.45, -a - 0.45, FL - plate, a + 0.45, a + 0.45, FL);
            for (let k = 0; k < 4; k++) {
                const c = Math.cos(th + k * Math.PI / 2), s = Math.sin(th + k * Math.PI / 2), nn = [s, -c, 0];
                if (!T.sees(nn)) continue;
                const W = { at: (u, z) => [cx + c * u + s * a, cy + s * u - c * a, f * FL + z] };
                if (T.shade && T.dark(nn)) inKind(S, SHADE, () => S.hatch([W.at(-a, 0), W.at(a, 0), W.at(a, FL - plate), W.at(-a, FL - plate)], [c, s, 0], T.gap));
                else if (T.detail) inKind(S, GLASS, () => { for (let i = -2; i <= 2; i++) S.line([W.at(i * a / 3, 0), W.at(i * a / 3, FL - plate)]); });
            }
        }
        const z = floors * FL;
        quiet(S, () => {
            if (rng.chance(0.5)) helipad(T, cx, cy, z, a * 0.9);
            else mast(T, cx, cy, z, rng.range(10, 20), a * 0.7);
        });
    }

    function podiumTower(T, L) {
        const { rng } = L, S = T.S, hp = FL * rng.int(2, 3) + 1.5, poly = rect(L.x0 + 0.3, L.y0 + 0.3, L.x1 - 0.3, L.y1 - 0.3);
        S.kind = ARCH;
        const ws = prism(T, poly, 0, hp);
        T.block(poly, hp, L.id);
        for (const W of ws) {
            if (!W.seen) continue;
            shopfront(T, W, 0, rng);
            facade(T, W, FL + 1.5, hp, 'ribbon', rng);
            shadeWall(T, W, 0, W.len, 0, hp);
        }
        const z = parapet(T, poly, hp);
        const w = L.x1 - L.x0, d = L.y1 - L.y0, tw = w * rng.range(0.5, 0.62), td = d * rng.range(0.5, 0.62);
        const sub = { id: L.id, x0: L.x1 - 1.2 - tw, y0: L.y1 - 1.2 - td, x1: L.x1 - 1.2, y1: L.y1 - 1.2, h: L.h, rng };
        const tower = rng.weighted([[3, 'glass'], [2, 'office'], [1.5, 'drum']]);
        withBase(T, z, () => (tower === 'glass' ? glassTower : tower === 'office' ? officeTower : drumTower)(T, sub));
        garden(T, L.x0 + 1.2, L.y0 + 1.2, sub.x0 - 1, L.y1 - 1.5, z, rng);
        garden(T, sub.x0, L.y0 + 1.2, L.x1 - 1.5, sub.y0 - 1, z, rng);
    }

    // Build something standing on a podium, by lifting everything it draws.
    // solid() draws its own faces and edges through face() and line(), which
    // mustn't lift them a second time.
    function withBase(T, z0, fn) {
        const S = T.S, keepSolid = S.solid, keepFace = S.face, keepLine = S.line, up = p => [p[0], p[1], p[2] + z0];
        let inside = 0;
        S.solid = function (v, f, g, q) {
            inside++;
            try { return keepSolid.call(this, v.map(up), f, g, q); } finally { inside--; }
        };
        S.face = function (pts, cast) { return keepFace.call(this, inside ? pts : pts.map(up), cast); };
        S.line = function (pts, whole) { return keepLine.call(this, inside ? pts : pts.map(up), whole); };
        const keepAnchor = T.anchor, keepBlock = T.block, keepPad = T.pad;
        T.anchor = (p, n, id) => keepAnchor([p[0], p[1], p[2] + z0], n, id);
        T.block = (poly, z, id) => keepBlock(poly, z + z0, id);
        T.pad = (x, y, z, r) => keepPad(x, y, z + z0, r);
        try { fn(); } finally {
            S.solid = keepSolid; S.face = keepFace; S.line = keepLine;
            T.anchor = keepAnchor; T.block = keepBlock; T.pad = keepPad;
        }
    }

    function garden(T, x0, y0, x1, y1, z, rng) {
        const S = T.S, w = x1 - x0, d = y1 - y0;
        if (w < 3 || d < 3) return;
        quiet(S, () => {
            if (w > 8 && d > 5 && rng.chance(0.5)) {
                const pw = Math.min(w - 3, rng.range(6, 12)), pd = Math.min(d - 2, rng.range(3, 5)), px = x0 + 1, py = y0 + 1;
                inKind(S, ARCH, () => S.loop([[px, py, z + 0.02], [px + pw, py, z + 0.02], [px + pw, py + pd, z + 0.02], [px, py + pd, z + 0.02]]));
                inKind(S, GLASS, () => { for (let yy = py + 0.8; yy < py + pd - 0.4; yy += 1.1) S.line([[px + 0.6, yy, z + 0.02], [px + pw * rng.range(0.4, 0.9), yy, z + 0.02]]); });
                for (let i = rng.int(0, 2); i > 0; i--) inKind(S, LIFE, () => kit.person(T, px + rng.range(0, pw), py + pd + 0.8, z, rng));
                return;
            }
            const n = Math.min(6, Math.floor(w * d / 30));
            for (let i = 0; i < n; i++) tree(T, rng.range(x0 + 1.5, x1 - 1.5), rng.range(y0 + 1.5, y1 - 1.5), z, rng);
            if (rng.chance(0.6)) inKind(S, LIFE, () => kit.person(T, rng.range(x0 + 1, x1 - 1), rng.range(y0 + 1, y1 - 1), z, rng));
        });
    }

    function shopfront(T, W, z0, rng) {
        const S = T.S, n = Math.max(1, Math.round(W.len / 6)), bw = W.len / n;
        for (let i = 0; i < n; i++) {
            const s0 = i * bw + 0.5, s1 = (i + 1) * bw - 0.5;
            S.kind = ARCH;
            S.loop([W.at(s0, z0 + 0.3), W.at(s1, z0 + 0.3), W.at(s1, z0 + 2.7), W.at(s0, z0 + 2.7)]);
            if (T.detail) S.line([W.at(s0 + 1.2, z0 + 0.3), W.at(s0 + 1.2, z0 + 2.7)]);
            if (rng.chance(0.6 * T.p.signs + 0.2)) {
                const q = [W.at(s0, z0 + 2.9, 0.15), W.at(s1, z0 + 2.9, 0.15), W.at(s1, z0 + 3.7, 0.15), W.at(s0, z0 + 3.7, 0.15)];
                S.kind = SIGN;
                S.face(q, false);
                S.loop(q);
                // lettering when there's room on paper, otherwise a neon tube along the board
                const sz = 0.55;
                if (!T.detail) continue;
                if (sz * T.k > 1) glyphs(T, (a, b) => W.at(a, b, 0.16), s0 + 0.3, z0 + 3.03, sz, Math.floor((s1 - s0 - 0.6) / (sz * 1.4)), rng);
                else S.line([W.at(s0 + 0.4, z0 + 3.3, 0.16), W.at(s1 - 0.4, z0 + 3.3, 0.16)]);
            }
        }
        S.kind = ARCH;
    }

    function clutterBlock(T, L) {
        const { rng } = L, S = T.S, poly = rect(L.x0 + 0.2, L.y0 + 0.2, L.x1 - 0.2, L.y1 - 0.2), h = L.h;
        const ws = shaft(T, L, poly, 0, h, rng.pick(['grid', 'ribbon', 'grid']), rng);
        for (const W of ws) {
            if (!W.seen) continue;
            shopfront(T, W, 0, rng);
            quiet(S, () => barnacles(T, W, FL + 0.5, h - 1.5, rng, T.p.clutter, L));
            if (rng.chance(T.p.signs)) {
                const s = rng.chance(0.5) ? 0.8 : W.len - 0.8;
                blade(T, W, s, Math.max(rng.range(5, 9), cover(L, W, s - 0.5, s + 0.5)), Math.min(h - 2, rng.range(14, 24)), rng);
            }
            for (let k = rng.int(0, Math.round(3 * T.p.signs)); k > 0; k--) pipe(T, W, rng.range(0.8, W.len - 0.8), rng.range(0, 6), h + 0.2, rng);
        }
        const z = parapet(T, poly, h);
        quiet(S, () => {
            const x0 = L.x0 + 1.2, y0 = L.y0 + 1.2, x1 = L.x1 - 1.2, y1 = L.y1 - 1.2;
            const k = Math.floor((x1 - x0) * (y1 - y0) / 45);
            for (let i = 0; i < k; i++) {
                const w = rng.range(2, 3.5), d = rng.range(2, 3), x = rng.range(x0, x1 - w), y = rng.range(y0, y1 - d);
                if (rng.chance(0.55)) shack(T, x, y, z, w, d, rng);
            }
            aerials(T, x0, y0, x1, y1, z, Math.round((x1 - x0) * (y1 - y0) / 25), rng);
        });
        rooftop(T, L.x0 + 1, L.y0 + 1, L.x1 - 1, L.y1 - 1, z, rng, { tank: 0.7, sign: T.p.signs * 0.6 });
    }

    function monolith(T, L) {
        const { rng } = L, S = T.S, x0 = L.x0 + 0.8, y0 = L.y0 + 0.8, x1 = L.x1 - 0.8, y1 = L.y1 - 0.8, m = Math.min(x1 - x0, y1 - y0);
        const poly = rng.chance(0.3) ? chamfer(x0, y0, x1, y1, m * 0.18) : rect(x0, y0, x1, y1), crown = L.h - 1.5 * FL;
        const ws = shaft(T, L, poly, 0, crown, 'dark', rng);
        if (poly.length === 4) L.flat = [x0, y0, x1, y1, crown, 8];
        S.kind = ARCH;
        const inner = geo.insetConvex(poly, 0.5), band = prism(T, inner, crown, crown + FL * 0.8);
        for (const W of band) if (W.seen) inKind(S, PAD, () => {
            const n = Math.max(2, Math.round(W.len / 1.2));
            for (let i = 1; i < n; i++) S.line([W.at(W.len * i / n, crown + 0.3), W.at(W.len * i / n, crown + FL * 0.8 - 0.3)]);
        });
        const cap = prism(T, poly, crown + FL * 0.8, L.h);
        for (const W of cap) if (W.seen) inKind(S, ARCH, () => S.hatch([W.at(0, crown + FL * 0.8), W.at(W.len, crown + FL * 0.8), W.at(W.len, L.h), W.at(0, L.h)], [0, 0, 1], W.dark ? 0.62 : 0.85));
        const z = parapet(T, poly, L.h, 0.5);
        if (rng.chance(0.3)) extras(T, L, ws, 0, crown, rng);
        quiet(S, () => { if (rng.chance(0.4)) mast(T, (x0 + x1) / 2, (y0 + y1) / 2, z, rng.range(10, 26), m * 0.35); });
    }

    // Tower going up: concrete core, bare slabs and columns, and a crane
    function construction(T, L) {
        const { rng } = L, S = T.S, x0 = L.x0 + 0.8, y0 = L.y0 + 0.8, x1 = L.x1 - 0.8, y1 = L.y1 - 0.8;
        const floors = Math.max(4, Math.round(L.h / FL)), clad = rng.int(1, Math.floor(floors * 0.5)), built = floors - rng.int(1, 2);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cr = Math.min(x1 - x0, y1 - y0) * 0.15;
        S.kind = ARCH;
        shaft(T, L, rect(x0, y0, x1, y1), 0, clad * FL, rng.pick(['glass', 'ribbon']), rng);
        T.block(rect(x0, y0, x1, y1), floors * FL, L.id);
        for (let f = clad; f <= built; f++) S.box(F0, x0 - 0.1, y0 - 0.1, f * FL, x1 + 0.1, y1 + 0.1, f * FL + 0.35);
        const nx = Math.max(2, Math.round((x1 - x0) / 6)), ny = Math.max(2, Math.round((y1 - y0) / 6));
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
            if (i && j && i < nx && j < ny) continue;
            const x = geo.lerp(x0 + 0.6, x1 - 0.6, i / nx), y = geo.lerp(y0 + 0.6, y1 - 0.6, j / ny);
            S.box(F0, x - 0.3, y - 0.3, clad * FL, x + 0.3, y + 0.3, floors * FL);
        }
        const core = rect(cx - cr, cy - cr, cx + cr, cy + cr), cw = prism(T, core, clad * FL, floors * FL + 1.5);
        for (const W of cw) shadeWall(T, W, 0, W.len, clad * FL, floors * FL + 1.5);
        // scaffold and netting on the edge floors the camera sees
        quiet(S, () => {
            const ws = walls(T, rect(x0, y0, x1, y1));
            for (const W of ws) {
                if (!W.seen || !T.detail) continue;
                for (let f = clad; f < built; f++) {
                    if (!rng.chance(0.35)) continue;
                    inKind(S, CABLE, () => {
                        const z = f * FL + 0.35, n = Math.max(2, Math.round(W.len / 2));
                        for (let i = 0; i <= n; i++) S.line([W.at(W.len * i / n, z, 0.6), W.at(W.len * i / n, z + FL - 0.35, 0.6)]);
                        S.line([W.at(0, z + 1.1, 0.6), W.at(W.len, z + 1.1, 0.6)]);
                        S.line([W.at(0, z + FL - 0.35, 0.6), W.at(W.len, z + FL - 0.35, 0.6)]);
                    });
                }
            }
        });
        // built once every lot is standing, so the jib can swing clear of the neighbours
        const hm = floors * FL + rng.range(10, 18), ang = rng.range(0, TAU);
        T.cranes.push(() => crane(T, cx + cr + 1.6, cy + cr + 1.6, 0, hm, ang, rng, floors * FL, L.id));
    }

    // Tower crane: lattice mast and jib, counter jib with its weight, a hook on a line
    function crane(T, x, y, z0, hm, ang, rng, work, id) {
        const S = T.S, m = 0.85, keep = S.kind, Lj = rng.range(26, 40), Lc = rng.range(9, 12), d = rng.range(0.35, 0.85) * Lj, hz = Math.max(work + 3, 8) - (z0 + hm);
        // turn it until the jib clears the roofs round about and the hook hangs in the open
        const hits = a => {
            const c = Math.cos(a), s = Math.sin(a), P = (u, v = 0) => [x + c * u - s * v, y + s * u + c * v];
            for (let u = -Lc; u <= Lj; u += 2) if (T.solids.hit(...P(u), z0 + hm - 2, id, id)) return true;
            for (const u of [d - 2.2, d, d + 2.2]) for (const v of [-0.6, 0.6]) {
                const q = P(u, v);
                if (T.solids.hit(...q, z0 + hm + hz - 2.4, id, id) || T.paths.some(([path, half, , hi]) => z0 + hm + hz - 2.4 < hi && path.dist(...q) < half + 2.2)) return true;
            }
            return false;
        };
        for (let k = 0; k < 12 && hits(ang); k++) ang += TAU / 12;
        S.kind = PAD;
        const C = [[-m, -m], [m, -m], [m, m], [-m, m]];
        for (const [a, b] of C) S.line([[x + a, y + b, z0], [x + a, y + b, z0 + hm]]);
        const n = Math.round(hm / (2 * m)) * 2;
        for (const [i, j] of [[0, 1], [3, 0]]) {
            const pts = [];
            for (let k = 0; k <= n; k++) { const c = C[k % 2 ? j : i]; pts.push([x + c[0], y + c[1], z0 + hm * k / n]); }
            S.line(pts);
        }
        const F = turned(x, y, z0 + hm, ang);
        S.box(F, -1.3, -1.3, 0, 1.3, 1.3, 1);
        S.box(F, 0.3, -2.8, -1.4, 2.3, -1.1, 1);
        const bot = s => [F.P(1.3, s, 1), F.P(Lj, s, 1)], topc = [F.P(1.3, 0, 2.6), F.P(Lj, 0, 1.8)];
        for (const s of [-0.75, 0.75]) S.line(bot(s));
        S.line(topc);
        const k = Math.round((Lj - 1.3) / 1.6);
        for (const s of [-0.75, 0.75]) {
            const pts = [];
            for (let i = 0; i <= k; i++) pts.push(lerp3(...(i % 2 ? topc : bot(s)), i / k));
            S.line(pts);
        }
        for (const s of [-0.8, 0.8]) S.line([F.P(-1.3, s, 1), F.P(-Lc, s, 1)]);
        S.box(F, -Lc, -1, 1, -Lc + 2.6, 1, 3.4);
        const apex = F.P(0, 0, 7.5);
        S.line([F.P(-1.2, -1.2, 1), apex, F.P(1.2, 1.2, 1)]);
        S.line([F.P(-1.2, 1.2, 1), apex, F.P(1.2, -1.2, 1)]);
        S.line([F.P(Lj * 0.7, 0, 2.1), apex, F.P(-Lc + 1.3, 0, 3.4)]);
        S.box(F, d - 0.6, -0.8, 0.6, d + 0.6, 0.8, 1);
        S.line([F.P(d, 0, 0.6), F.P(d, 0, hz + 0.7)]);
        S.box(F, d - 0.35, -0.25, hz, d + 0.35, 0.25, hz + 0.7);
        if (rng.chance(0.7)) {
            S.line([F.P(d, 0, hz), F.P(d - 1.6, 0, hz - 1.8)]);
            S.line([F.P(d, 0, hz), F.P(d + 1.6, 0, hz - 1.8)]);
            S.box(F, d - 2.2, -0.6, hz - 2.4, d + 2.2, 0.6, hz - 1.8);
        }
        S.kind = keep;
    }

    function geodesic(T, x, y, z, r, n = 18, m = 6) {
        const S = T.S, verts = [], faces = [], rings = [];
        for (let j = 0; j < m; j++) {
            const ph = Math.PI / 2 * j / m, rr = r * Math.cos(ph), off = (j % 2) * Math.PI / n;
            rings.push(verts.length);
            for (let i = 0; i < n; i++) verts.push([x + rr * Math.cos(off + TAU * i / n), y + rr * Math.sin(off + TAU * i / n), z + r * Math.sin(ph)]);
        }
        const apex = verts.length;
        verts.push([x, y, z + r]);
        faces.push(Array.from({ length: n }, (_, i) => i));
        strips(faces, rings, n);
        const a = rings[m - 1];
        for (let i = 0; i < n; i++) faces.push([a + i, a + (i + 1) % n, apex]);
        S.solid(verts, faces);
        shadeSolid(T, verts, faces, [x, y, z + r * 0.3]);
    }

    // Every other ring is turned half a step, so the strips between them are triangles
    function strips(faces, rings, n) {
        for (let j = 0; j + 1 < rings.length; j++) {
            const a = rings[j], b = rings[j + 1];
            for (let i = 0; i < n; i++) {
                const i1 = (i + 1) % n;
                if (j % 2 === 0) faces.push([a + i, a + i1, b + i], [b + i, a + i1, b + i1]);
                else faces.push([a + i, a + i1, b + i1], [b + i, a + i, b + i1]);
            }
        }
    }

    function shadeSolid(T, verts, faces, centre) {
        if (!T.shade) return;
        for (const f of faces) {
            if (f.length !== 3) continue;
            const pts = f.map(i => verts[i]), n = outward(pts, centre);
            shadeFace(T, pts, n);
        }
    }

    function domeHall(T, L) {
        // leaves room on the -y side for the entrance, which sticks out 2.5 m
        const { rng } = L, S = T.S, cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2, r = Math.min(L.x1 - L.x0, L.y1 - L.y0 - 3) / 2 - 1, hb = rng.range(4, 7);
        S.kind = ARCH;
        S.lathe(cx, cy, [[r, 0], [r, hb]], T.segs(r));
        S.loop(ring(T.segs(r), (c, s) => [cx + (r + 0.04) * c, cy + (r + 0.04) * s, hb - 1]));
        shadeRound(T, cx, cy, 0, hb, r, r);
        T.block([[cx - r, cy - r], [cx + r, cy + r]], hb + r * 0.9, L.id);
        geodesic(T, cx, cy, hb, r - 0.6, r > 12 ? 20 : 16, r > 12 ? 7 : 6);
        const F = frame(cx, cy - r, 0, 0);
        S.box(F, -3, -2.5, 0, 3, 0.8, 3.4);
        inKind(S, SIGN, () => { if (T.sees([0, -1, 0])) S.loop([F.P(-2.2, -2.5, 3.6), F.P(2.2, -2.5, 3.6), F.P(2.2, -2.5, 4.6), F.P(-2.2, -2.5, 4.6)]); });
    }

    function lowRise(T, L) {
        const { rng } = L, S = T.S, poly = rect(L.x0 + 0.3, L.y0 + 0.3, L.x1 - 0.3, L.y1 - 0.3), h = L.h;
        S.kind = ARCH;
        const ws = prism(T, poly, 0, h);
        T.block(poly, h, L.id);
        for (const W of ws) {
            if (!W.seen) continue;
            shopfront(T, W, 0, rng);
            facade(T, W, FL + 0.3, h, 'grid', rng);
            shadeWall(T, W, 0, W.len, 0, h);
            if (rng.chance(T.p.signs * 0.25)) pipe(T, W, rng.range(0.8, W.len - 0.8), 0, h + 0.2, rng);
            if (h > 11 && rng.chance(T.p.clutter * 0.6)) quiet(S, () => barnacles(T, W, FL + 0.5, h - 1, rng, T.p.clutter * 0.8, L));
            if (W.len > 3 && rng.chance(0.7)) T.anchor(W.at(rng.range(0.5, W.len - 0.5), h - 0.8, 0.03), W.n, L.id);
        }
        const z = parapet(T, poly, h, 0.6);
        rooftop(T, L.x0 + 1, L.y0 + 1, L.x1 - 1, L.y1 - 1, z, rng, { tank: 0.5, sign: T.p.signs * 0.5, people: 0.3, garden: 0.3, court: 0.2 });
        quiet(S, () => aerials(T, L.x0 + 1, L.y0 + 1, L.x1 - 1, L.y1 - 1, z, rng.int(0, 4), rng));
    }

    // Car park: open decks with a dark gap between each, cars on the roof
    function garage(T, L) {
        const { rng } = L, S = T.S, poly = rect(L.x0 + 0.3, L.y0 + 0.3, L.x1 - 0.3, L.y1 - 0.3), decks = Math.max(2, Math.round(L.h / 3.1)), dh = 3.1;
        S.kind = ARCH;
        T.block(poly, decks * dh, L.id);
        const ws = walls(T, poly);
        for (let i = 0; i < decks; i++) {
            const z = i * dh;
            S.prism(lift(poly, z), [0, 0, 1.1]);
            if (i === 0) continue;
            for (const W of ws) if (W.seen) inKind(S, SHADE, () => S.hatch([W.at(0, z - dh + 1.1, -1.2), W.at(W.len, z - dh + 1.1, -1.2), W.at(W.len, z, -1.2), W.at(0, z, -1.2)], [W.u[0], W.u[1], 0], 0.55));
        }
        const inner = geo.insetConvex(poly, 1.2);
        S.prism(lift(inner, 1.1), [0, 0, (decks - 1) * dh - 1.1]);
        for (const W of ws) {
            const n = Math.max(1, Math.round(W.len / 7.5));
            for (let i = 0; i <= n; i++) {
                const s = geo.clamp(W.len * i / n, 0.3, W.len - 0.3);
                wallBox(S, W, s - 0.3, s + 0.3, 1.1, (decks - 1) * dh, -0.6, 0);
            }
        }
        const z = (decks - 1) * dh + 1.1;
        quiet(S, () => {
            const [x0, y0, x1, y1] = [L.x0 + 1, L.y0 + 1, L.x1 - 1, L.y1 - 1], alongX = x1 - x0 > y1 - y0;
            for (let s = 1.6; s < (alongX ? x1 - x0 : y1 - y0) - 1.6; s += 2.8) {
                if (!rng.chance(0.55)) continue;
                const x = alongX ? x0 + s : x0 + 2.8, y = alongX ? y0 + 2.8 : y0 + s;
                inKind(S, LIFE, () => kit.car(T, x, y, z, alongX ? 1 : 0, rng));
            }
            inKind(S, ROAD, () => {
                for (let s = 0; s < (alongX ? x1 - x0 : y1 - y0); s += 2.8) {
                    const a = alongX ? [x0 + s, y0 + 0.5, z + 0.01] : [x0 + 0.5, y0 + s, z + 0.01], b = alongX ? [x0 + s, y0 + 5, z + 0.01] : [x0 + 5, y0 + s, z + 0.01];
                    S.line([a, b]);
                }
            });
        });
    }

    function pocketPark(T, L) {
        const { rng } = L, S = T.S, x0 = L.x0 + 0.5, y0 = L.y0 + 0.5, x1 = L.x1 - 0.5, y1 = L.y1 - 0.5;
        S.kind = PARK;
        S.loop([[x0, y0, 0.01], [x1, y0, 0.01], [x1, y1, 0.01], [x0, y1, 0.01]]);
        S.kind = ROAD;
        const cx = geo.lerp(x0, x1, rng.range(0.35, 0.65)), cy = geo.lerp(y0, y1, rng.range(0.35, 0.65));
        for (const [a, b] of [[[x0, y0], [x1, y1]], [[x1, y0], [x0, y1]]]) {
            S.line([[a[0], a[1], 0.01], [cx, cy, 0.01]]);
            S.line([[cx, cy, 0.01], [b[0], b[1], 0.01]]);
        }
        const w = x1 - x0, d = y1 - y0;
        if (w > 12 && d > 12 && rng.chance(0.6)) {
            quiet(S, () => inKind(S, ARCH, () => kit.fountain(T, cx, cy, 0, rng)));
        }
        const n = Math.min(14, Math.floor(w * d / 40));
        for (let i = 0; i < n; i++) {
            const x = rng.range(x0 + 2, x1 - 2), y = rng.range(y0 + 2, y1 - 2);
            if (Math.hypot(x - cx, y - cy) < 4) continue;
            tree(T, x, y, 0, rng);
        }
        quiet(S, () => {
            for (let i = rng.int(1, 4); i > 0; i--) inKind(S, LIFE, () => kit.person(T, rng.range(x0 + 1, x1 - 1), rng.range(y0 + 1, y1 - 1), 0, rng));
            if (rng.chance(0.6)) inKind(S, ARCH, () => kit.bench(T, geo.lerp(x0, cx, 0.5), cy - 1.5, 0, 0));
        });
    }

    // Gothic church left standing among the towers: two spired towers on the
    // front, a tall nave under a steep roof, lower aisles with flying
    // buttresses, and a round apse at the back
    function cathedral(T, L) {
        const { rng } = L, S = T.S, alongY = L.y1 - L.y0 >= L.x1 - L.x0;
        const ox = L.x0 + 0.8, oy = alongY ? L.y0 + 0.8 : L.y1 - 0.8;
        const A = (alongY ? L.x1 - L.x0 : L.y1 - L.y0) - 1.6, D = (alongY ? L.y1 - L.y0 : L.x1 - L.x0) - 1.6;
        // a runs across the nave, b along it from the front. Turned so the front
        // always faces the camera side (-y, or -x for a lot long in x).
        const Q = (a, b) => (alongY ? [ox + a, oy + b] : [ox + b, oy - a]);
        const F = alongY ? frame(ox, oy, 0, 0) : frame(ox, oy, 0, 3);
        const lrect = (a0, b0, a1, b1) => [Q(a0, b0), Q(a1, b0), Q(a1, b1), Q(a0, b1)];
        const P3 = (a, b, z) => [...Q(a, b), z];
        const tw = geo.clamp(A * 0.27, 4, 7), n0 = tw - 0.5, n1 = A - tw + 0.5, ra = (n1 - n0) / 2, bEnd = D - ra - 0.3;
        const ze = geo.clamp(A * 0.85, 12, 19), za = ze * 0.55, zt = ze + rng.range(7, 11), hs = rng.range(11, 16);
        S.kind = ARCH;
        T.block(lrect(0, 0, A, D), ze, L.id);
        // steps up to the doors
        for (let k = 0; k < 3; k++) S.box(F, n0 + 0.5, -1.4 + k * 0.45, 0, n1 - 0.5, 0.4, 0.17 * (k + 1));

        // aisles under lean-to roofs, flying buttresses over them
        for (const [a0, a1, side] of [[0, n0, -1], [n1, A, 1]]) {
            const ws = prism(T, lrect(a0, tw, a1, bEnd), 0, za), inner = side < 0 ? a1 : a0, outer = side < 0 ? a0 : a1;
            const prof = [P3(outer, tw, za), P3(inner, tw, za), P3(inner, tw, za + 2.6)];
            const e = [Q(outer, bEnd)[0] - Q(outer, tw)[0], Q(outer, bEnd)[1] - Q(outer, tw)[1], 0];
            S.prism(prof, e);
            const slope = [P3(outer, tw, za), P3(outer, bEnd, za), P3(inner, bEnd, za + 2.6), P3(inner, tw, za + 2.6)];
            kit.shade(T, slope, outward(slope, P3((a0 + a1) / 2, (tw + bEnd) / 2, za - 3)));
            const W = ws[side < 0 ? 3 : 1], bays = Math.max(2, Math.round((bEnd - tw) / 4.2));
            for (let i = 0; i < bays; i++) {
                const s = (i + 0.5) * W.len / bays;
                if (W.seen && (!T.shade || !W.dark)) kit.arch(T, (u, c) => W.at(u, c, 0.03), s, 1.6, 1.3, za - 3.4);
                if (i === 0) continue;
                // buttress pier at the bay line with a flyer up to the clerestory
                const b = tw + (bEnd - tw) * i / bays, pa = outer - side * 0.2;
                S.box(F, Math.min(pa, pa + side * 0.9), b - 0.4, 0, Math.max(pa, pa + side * 0.9), b + 0.4, za + 3.2);
                S.line([P3(pa + side * 0.45, b, za + 3.2), P3(pa + side * 0.45, b, za + 5.2)]);
                S.line([P3(pa, b, za + 2.6), P3(inner, b, ze - 1.2)]);
                S.line([P3(pa, b, za + 1.6), P3(inner, b, ze - 2.6)]);
            }
            shadeWall(T, W, 0, W.len, 0, za);
        }

        // nave, its roof, and the clerestory windows over the aisle roofs
        const nave = prism(T, lrect(n0, 0.4, n1, bEnd), 0, ze);
        const R = kit.gableRoof(T, F, [n0, 0.4, n1, bEnd], ze, false, geo.rad(58), rng, { attic: false });
        kit.shadeGable(T, F, R);
        for (const [W, right] of [[nave[1], true], [nave[3], false]]) {
            if (!W.seen) continue;
            shadeWall(T, W, 0, W.len, za + 2.6, ze);
            if (T.shade && W.dark) continue;
            // the right wall runs front to back, the left one back to front
            const bays = Math.max(2, Math.round((bEnd - tw) / 4.2));
            for (let i = 0; i < bays; i++) {
                const b = tw + (i + 0.5) * (bEnd - tw) / bays;
                kit.arch(T, (u, c) => W.at(u, c, 0.03), right ? b - 0.4 : bEnd - b, za + 3.4, 1.2, ze - za - 4.8);
            }
        }
        // rose window and portal on the front between the towers
        const front = (a, z) => P3(a, 0.38, z), am = A / 2, rr = Math.min(ra * 0.62, ze * 0.2), zr = ze * 0.66;
        S.loop(ring(T.segs(rr), (c, s) => front(am + rr * c, zr + rr * s)));
        if (T.detail) {
            S.loop(ring(T.segs(rr * 0.35), (c, s) => front(am + rr * 0.35 * c, zr + rr * 0.35 * s)));
            for (let i = 0; i < 12; i++) {
                const t = TAU * i / 12;
                S.line([front(am + rr * 0.35 * Math.cos(t), zr + rr * 0.35 * Math.sin(t)), front(am + rr * Math.cos(t), zr + rr * Math.sin(t))]);
            }
        }
        kit.arch(T, front, am, 0.51, Math.min(3.2, ra), Math.min(6.5, zr - rr - 1.2));
        if (T.detail) kit.arch(T, front, am, 0.51, Math.min(3.2, ra) + 0.9, Math.min(6.5, zr - rr - 1.2) + 0.7);

        // apse with a conical roof
        const [cx, cy] = Q(am, bEnd), za2 = ze * 0.85;
        S.lathe(cx, cy, [[ra, 0], [ra, za2]], T.segs(ra));
        shadeRound(T, cx, cy, 0, za2, ra, ra);
        S.lathe(cx, cy, [[ra + 0.4, za2], [0, za2 + ra * 1.1]], T.segs(ra));
        shadeRound(T, cx, cy, za2, za2 + ra * 1.1, ra + 0.4, 0.1);

        // the two towers, a belfry and a spire on each
        for (const a0 of [0, A - tw]) {
            const ws = prism(T, lrect(a0, 0, a0 + tw, tw), 0, zt);
            for (const W of ws) {
                if (!W.seen) continue;
                shadeWall(T, W, 0, W.len, 0, zt);
                if (T.shade && W.dark) continue;
                for (const f of [0.35, 0.62]) S.line([W.at(0, zt * f, 0.02), W.at(W.len, zt * f, 0.02)]);
                for (const s of [0.32, 0.68]) kit.arch(T, (u, c) => W.at(u, c, 0.03), W.len * s, zt - 7.2, Math.min(1.1, tw * 0.2), 5.6);
                kit.arch(T, (u, c) => W.at(u, c, 0.03), W.len / 2, zt * 0.42, 1.2, 3.2);
            }
            S.box(F, a0 - 0.3, -0.3, zt, a0 + tw + 0.3, tw + 0.3, zt + 0.7);
            T.block(lrect(a0, 0, a0 + tw, tw), zt + hs, L.id);
            for (const [u, v] of [[a0, 0], [a0 + tw, 0], [a0 + tw, tw], [a0, tw]]) S.line([P3(u, v, zt + 0.7), P3(u, v, zt + 3.2)]);
            const [sx, sy] = Q(a0 + tw / 2, tw / 2), rs = tw / 2 - 0.15, z0 = zt + 0.7;
            S.lathe(sx, sy, [[rs, z0], [0, z0 + hs]], 8, false, Math.PI / 8);
            for (let i = 0; i < 8; i++) {
                const t0 = Math.PI / 8 + i * TAU / 8, t1 = t0 + TAU / 8;
                const tri = [[sx + rs * Math.cos(t0), sy + rs * Math.sin(t0), z0], [sx + rs * Math.cos(t1), sy + rs * Math.sin(t1), z0], [sx, sy, z0 + hs]];
                shadeFace(T, tri, outward(tri, [sx, sy, z0 + hs * 0.25]), [Math.cos(t1) - Math.cos(t0), Math.sin(t1) - Math.sin(t0), 0]);
            }
            S.line([[sx, sy, z0 + hs], [sx, sy, z0 + hs + 1.6]]);
            S.line([[sx - T.cam.rx * 0.5, sy - T.cam.ry * 0.5, z0 + hs + 1.1], [sx + T.cam.rx * 0.5, sy + T.cam.ry * 0.5, z0 + hs + 1.1]]);
        }
        quiet(S, () => {
            for (let i = rng.int(2, 5); i > 0; i--) inKind(S, LIFE, () => kit.person(T, ...Q(rng.range(n0, n1), rng.range(-2.4, -1.5)), 0, rng));
        });
    }

    // Tower wrapped in planted balconies, a vertical forest
    function gardenTower(T, L) {
        const { rng } = L, S = T.S, o = 1.3, x0 = L.x0 + o + 0.4, y0 = L.y0 + o + 0.4, x1 = L.x1 - o - 0.4, y1 = L.y1 - o - 0.4;
        const poly = rect(x0, y0, x1, y1), floors = Math.max(6, Math.round(L.h / FL)), top = floors * FL, every = rng.pick([1, 2, 2]);
        shaft(T, L, poly, 0, top, rng.pick(['glass', 'ribbon']), rng, false);
        T.block(rect(x0 - o, y0 - o, x1 + o, y1 + o), top, L.id);
        const edges = walls(T, rect(x0 - o, y0 - o, x1 + o, y1 + o));
        quiet(S, () => {
            for (let f = 2; f < floors; f += every) {
                const z = f * FL;
                S.kind = ARCH;
                S.box(F0, x0 - o, y0 - o, z - 0.3, x1 + o, y1 + o, z);
                // a row of bushes along the edge of each balcony we see
                for (const W of edges) {
                    if (!W.seen) continue;
                    const n = Math.max(2, Math.round(W.len / 1.1)), hump = (s0, s1) => {
                        const pts = [];
                        for (let k = 0; k <= 6; k++) pts.push(W.at(geo.lerp(s0, s1, k / 6), z + 0.35 + 0.55 * Math.sin(Math.PI * k / 6), -0.3));
                        return pts;
                    };
                    S.face([W.at(0.2, z, -0.3), W.at(W.len - 0.2, z, -0.3), W.at(W.len - 0.2, z + 0.7, -0.3), W.at(0.2, z + 0.7, -0.3)], false);
                    inKind(S, PARK, () => {
                        const pts = [W.at(0.2, z, -0.3)];
                        for (let i = 0; i < n; i++) pts.push(...hump(0.2 + (W.len - 0.4) * i / n, 0.2 + (W.len - 0.4) * (i + 1) / n).slice(i ? 1 : 0));
                        pts.push(W.at(W.len - 0.2, z, -0.3));
                        S.line(pts);
                    });
                }
            }
        });
        const z = parapet(T, poly, top);
        rooftop(T, x0 + 0.6, y0 + 0.6, x1 - 0.6, y1 - 0.6, z, rng, { garden: 1, tank: 0, mast: 0.1 });
    }

    const TYPES = { glass: glassTower, office: officeTower, deco: decoTower, drum: drumTower, taper: taperTower, twist: twistTower,
        podium: podiumTower, clutter: clutterBlock, dark: monolith, build: construction, dome: domeHall, low: lowRise, parking: garage, park: pocketPark,
        church: cathedral, green: gardenTower };

    // ------------------------------------------------------------------
    // Landmarks
    // ------------------------------------------------------------------

    // Faceted bullet of a tower, triangulated like a diagrid
    function cone(T, x, y, R, H, rng) {
        const S = T.S, n = 14, m = 12, rot = rng.range(0, TAU), verts = [], rings = [];
        const radius = t => R * Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), 0.62);
        for (let j = 0; j < m; j++) {
            const t = 0.955 * j / (m - 1), r = radius(t), off = rot + (j % 2) * Math.PI / n;
            rings.push(verts.length);
            for (let i = 0; i < n; i++) verts.push([x + r * Math.cos(off + TAU * i / n), y + r * Math.sin(off + TAU * i / n), H * t]);
        }
        const faces = [Array.from({ length: n }, (_, i) => i)];
        strips(faces, rings, n);
        faces.push(Array.from({ length: n }, (_, i) => rings[m - 1] + i));
        S.kind = ARCH;
        S.solid(verts, faces);
        T.block([[x - R, y - R], [x + R, y + R]], H, -1);
        shadeSolid(T, verts, faces, [x, y, H * 0.3]);
        const zt = H * 0.955, rt = radius(0.955);
        S.lathe(x, y, [[rt * 0.7, zt], [rt * 0.7, zt + 3], [rt * 0.4, zt + 6]], 12, false);
        quiet(S, () => mast(T, x, y, zt + 6, H * 0.16, 0));
        S.lathe(x, y, [[R + 3, 0], [R + 3, 4.2], [R + 1, 5]], n, false, rot);
        for (let i = 0; i < 4; i++) {
            const a = rot + TAU * (i + 0.5) / 4;
            T.anchor([x + (R + 3) * Math.cos(a), y + (R + 3) * Math.sin(a), 4], [Math.cos(a), Math.sin(a), 0], -1);
        }
    }

    // TV tower: three splayed legs, a tapering shaft, a pod and an antenna
    function needle(T, x, y, R, H, rng) {
        const S = T.S, zp = H * 0.64, r0 = Math.min(8, R * 0.3), r1 = r0 * 0.45, rp = Math.min(R * 0.75, 17);
        T.lm.foot = r0 + 12;
        S.kind = ARCH;
        for (let i = 0; i < 3; i++) {
            const a = TAU * i / 3 + rng.range(0, 1), c = Math.cos(a), s = Math.sin(a), px = -s, py = c, foot = r0 + 12, top = H * 0.2;
            // inner face sunk a little into the shaft, which tapers faster than the leg leans in
            const i0 = r0 - 0.3, i1 = geo.lerp(r0, r1, top / zp) - 0.3;
            S.solid([[x + c * i0 + px, y + s * i0 + py, 0], [x + c * foot + px, y + s * foot + py, 0], [x + c * foot - px, y + s * foot - py, 0], [x + c * i0 - px, y + s * i0 - py, 0],
                [x + c * i1 + px, y + s * i1 + py, top], [x + c * (foot - 0.8) + px, y + s * (foot - 0.8) + py, 3], [x + c * (foot - 0.8) - px, y + s * (foot - 0.8) - py, 3], [x + c * i1 - px, y + s * i1 - py, top]], BOX);
        }
        S.lathe(x, y, [[r0, 0], [r1, zp]], T.segs(r0));
        shadeRound(T, x, y, 0, zp, r0, r1);
        T.block([[x - r0, y - r0], [x + r0, y + r0]], H, -1);
        const pod = [[r1, zp], [rp * 0.8, zp + 3], [rp, zp + 5.5], [rp * 0.96, zp + 7.5], [rp * 0.5, zp + 10], [r1, zp + 11]];
        S.lathe(x, y, pod, T.segs(rp));
        for (const zz of [zp + 5.9, zp + 7]) S.loop(ring(T.segs(rp), (c, s) => [x + (rp * 1.005 + 0.05) * c, y + (rp * 1.005 + 0.05) * s, zz]));
        shadeRound(T, x, y, zp + 3.2, zp + 5.3, rp * 0.82, rp * 0.98);
        const z2 = H * 0.85;
        S.lathe(x, y, [[r1 * 0.8, zp + 11], [r1 * 0.5, z2]], T.segs(r1));
        S.lathe(x, y, [[r1 * 1.6, z2], [r1 * 1.6, z2 + 3], [r1 * 0.5, z2 + 4]], T.segs(r1 * 1.6));
        quiet(S, () => mast(T, x, y, z2 + 4, H - z2 - 4 + H * 0.06, 0));
    }

    // Squat faceted frustum with hatched sides round the foot of the landmark
    function satellite(T, x, y, r, h, n, rng) {
        const S = T.S, rot = rng.range(0, TAU), t = rng.range(0.45, 0.6);
        S.kind = ARCH;
        S.lathe(x, y, [[r, 0], [r * t, h]], n, false, rot);
        T.block([[x - r, y - r], [x + r, y + r]], h, -2);
        const centre = [x, y, h * 0.3];
        for (let i = 0; i < n; i++) {
            const a = rot + TAU * i / n, b = rot + TAU * (i + 1) / n;
            const q = [[x + r * Math.cos(a), y + r * Math.sin(a), 0], [x + r * Math.cos(b), y + r * Math.sin(b), 0], [x + r * t * Math.cos(b), y + r * t * Math.sin(b), h], [x + r * t * Math.cos(a), y + r * t * Math.sin(a), h]];
            const nn = outward(q, centre);
            if (!T.sees(nn)) continue;
            if (T.light(nn) < 0.08 && T.shade) inKind(S, SHADE, () => S.hatch(q, [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]], T.gap));
            else if (T.detail) {
                const k = 3;
                for (let m = 1; m < k; m++) S.line([lerp3(q[0], q[1], m / k), lerp3(q[3], q[2], m / k)]);
            }
        }
        S.lathe(x, y, [[r * t + 0.4, h], [r * t + 0.4, h + 0.8]], n, false, rot);
        if (rng.chance(0.6)) helipad(T, x, y, h + 0.8, r * t * 0.9);
        else rooftop(T, x - r * t * 0.6, y - r * t * 0.6, x + r * t * 0.6, y + r * t * 0.6, h + 0.8, rng, { mast: 0.8 });
    }

    // The plaza the landmark stands in, rings of paving, trees and people
    function plaza(T, x0, y0, x1, y1, lm, rng) {
        const S = T.S, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = lm.R;
        S.kind = ROAD;
        for (const r of [R + 6, R + 10]) S.loop(ring(T.segs(r), (c, s) => [cx + r * c, cy + r * s, 0.01]));
        for (let i = 0; i < 24; i++) {
            const a = TAU * i / 24;
            S.line([[cx + (R + 6) * Math.cos(a), cy + (R + 6) * Math.sin(a), 0.01], [cx + (R + 10) * Math.cos(a), cy + (R + 10) * Math.sin(a), 0.01]]);
        }
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const w = x1 - x0, spare = (Math.min(w, y1 - y0) / 2 - R - 10) * Math.SQRT2 + (Math.min(w, y1 - y0) / 2 - R) * 0.4, sats = [];
        for (const [x, y] of corners) {
            const dx = Math.sign(cx - x), dy = Math.sign(cy - y), r = geo.clamp(spare * 0.45, 5, 11), sx = x + dx * (r + 1.5), sy = y + dy * (r + 1.5);
            satellite(T, sx, sy, r, rng.range(1.6, 2.6) * r, rng.pick([6, 8]), rng);
            sats.push([sx, sy, r + 2]);
        }
        // on small blocks the ring of trees runs into the satellites
        const open = (x, y) => sats.every(([sx, sy, sr]) => Math.hypot(x - sx, y - sy) > sr);
        const a = lm.foot + 1.5, b = R + 4.5;
        if (lm.kind === 'needle' && b - a > 3) {
            inKind(S, ARCH, () => { for (const r of [a, b]) S.loop(ring(T.segs(r), (c, s) => [cx + r * c, cy + r * s, 0.02])); });
            inKind(S, GLASS, () => {
                for (let k = 0; k < 90; k++) {
                    const t = rng.range(0, TAU), r = rng.range(a + 1, b - 1), l = rng.range(1, 3) / r;
                    S.line([0, 0.5, 1].map(f => [cx + r * Math.cos(t + l * f), cy + r * Math.sin(t + l * f), 0.02]));
                }
            });
        }
        const rr = R + 13;
        for (let i = 0; i < 20; i++) {
            const a = TAU * (i + 0.5) / 20, x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
            if (x < x0 + 2 || x > x1 - 2 || y < y0 + 2 || y > y1 - 2 || !open(x, y)) continue;
            tree(T, x, y, 0, rng);
        }
        quiet(S, () => {
            for (let i = 0; i < 16; i++) {
                const a = rng.range(0, TAU), r = rng.range(R + 5, R + 12), x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                if (open(x, y)) inKind(S, LIFE, () => kit.person(T, x, y, 0, rng));
            }
        });
    }

    // Airship drifting over the towers with a lettered band down its side
    function airship(T, x, y, z, L, ang, rng) {
        const S = T.S, R = L * 0.15, n = 24, m = 16, c = Math.cos(ang), s = Math.sin(ang);
        const rad = u => R * Math.pow(Math.sin(Math.PI * u), 0.62) * (0.8 + 0.2 * u);
        const at = (u, th, rr = rad(u)) => [x + c * L * (u - 0.5) - s * rr * Math.cos(th), y + s * L * (u - 0.5) + c * rr * Math.cos(th), z + rr * Math.sin(th)];
        const verts = [at(0, 0, 0)], faces = [], rings = [];
        for (let i = 1; i < m; i++) {
            rings.push(verts.length);
            for (let j = 0; j < n; j++) verts.push(at(i / m, TAU * j / n));
        }
        const nose = verts.length;
        verts.push(at(1, 0, 0));
        for (let j = 0; j < n; j++) {
            const j1 = (j + 1) % n;
            faces.push([0, rings[0] + j1, rings[0] + j]);
            faces.push([nose, rings[m - 2] + j, rings[m - 2] + j1]);
            for (let i = 0; i + 1 < rings.length; i++) faces.push([rings[i] + j, rings[i] + j1, rings[i + 1] + j1, rings[i + 1] + j]);
        }
        S.kind = ARCH;
        S.solid(verts, faces, faces.map(() => 1));
        for (const u of [0.2, 0.4, 0.6, 0.8]) S.loop(ring(n * 2, (cc, ss) => at(u, Math.atan2(ss, cc), rad(u) + 0.08)));
        const cam = T.cam, side = [-s, c, 0], face = side[0] * cam.fx + side[1] * cam.fy > 0 ? Math.PI : 0;
        // spaced by how far apart they land on paper across the hull
        if (T.shade) inKind(S, SHADE, () => {
            const o = cam.project(x, y, z), e = cam.project(x + c, y + s, z), el = Math.hypot(e[0] - o[0], e[1] - o[1]) || 1;
            const px = -(e[1] - o[1]) / el, py = (e[0] - o[0]) / el;
            let last = null;
            for (let th = 0; th < TAU; th += 0.004) {
                const nrm = [-s * Math.cos(th), c * Math.cos(th), Math.sin(th)];
                if (!T.sees(nrm) || !T.dark(nrm)) { last = null; continue; }
                const q = cam.project(...at(0.5, th)), off = Math.floor(((q[0] - o[0]) * px + (q[1] - o[1]) * py) / T.gap);
                if (off === last) continue;
                last = off;
                const pts = [];
                for (let u = 0.08; u <= 0.93; u += 0.05) pts.push(at(u, th, rad(u) + 0.08));
                S.line(pts);
            }
        });
        // the sign band on the side we see, up a little from the waist
        const th0 = face + (face ? -0.35 : 0.35), band = 0.42, u0 = 0.28, u1 = 0.78;
        const on = (u, th) => at(u, th, rad(u) + 0.25);
        inKind(S, SIGN, () => {
            for (const th of [th0 - band, th0 + band]) {
                const pts = [];
                for (let u = u0; u <= u1 + 1e-9; u += 0.025) pts.push(on(u, th));
                S.line(pts);
            }
            for (const u of [u0, u1]) {
                const pts = [];
                for (let k = 0; k <= 8; k++) pts.push(on(u, th0 - band + 2 * band * k / 8));
                S.line(pts);
            }
            if (T.detail) {
                const sz = R * band * 1.1, k = Math.floor((u1 - u0) * L / (sz * 1.4)) - 1, flip = face ? -1 : 1;
                glyphs(T, (a, b) => on(u0 + (a + sz * 0.7) / L, th0 + flip * (b - sz / 2) / R), 0, 0, sz, k, rng);
            }
        });
        const F = turned(x, y, z, ang);
        S.box(F, -L * 0.1, -1.6, -rad(0.5) - 2.4, L * 0.08, 1.6, -rad(0.5) + 0.4);
        for (const [dy, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const P = (u, r) => F.P(-L * 0.5 + u, dy * r, dz * r);
            const fin = [P(L * 0.04, rad(0.04) + 0.2), P(L * 0.2, rad(0.2) + 0.2), P(L * 0.1, rad(0.2) + R * 0.55), P(-0.5, rad(0.04) + R * 0.6)];
            S.face(fin);
            S.loop(fin);
        }
        T.solids.add(x - L / 2, y - L / 2, x + L / 2, y + L / 2, 1e4, -7);
    }

    // Helicopter hovering over a helipad, the rotor drawn as a blurred disc
    function helicopter(T, x, y, z, ang, rng) {
        const S = T.S, F = turned(x, y, z, ang);
        S.kind = ARCH;
        const prof = [[-1.6, 0.4], [1, 0], [2.3, 0.6], [2.2, 1.5], [0.8, 2.1], [-1.6, 1.9]];
        S.prism(prof.map(([u, c]) => F.P(u, -0.9, c)), F.V(0, 1.8, 0));
        S.box(F, -7.2, -0.22, 1.2, -1.6, 0.22, 1.65);
        const fin = [F.P(-7.5, 0, 1.2), F.P(-6.7, 0, 1.2), F.P(-6.9, 0, 3), F.P(-7.6, 0, 3)];
        S.face(fin);
        S.loop(fin);
        for (const v of [-1, 1]) {
            S.line([F.P(-1.4, v, -0.6), F.P(1.8, v, -0.6), F.P(2.3, v, -0.3)]);
            for (const u of [-0.8, 1]) S.line([F.P(u, v * 0.85, 0.15), F.P(u, v, -0.6)]);
        }
        S.line([F.P(0, 0, 2.1), F.P(0, 0, 2.6)]);
        inKind(S, CABLE, () => {
            const r = 5.6, a = rng.range(0, Math.PI);
            S.loop(ring(T.segs(r), (c, s) => F.P(c * r, s * r, 2.6)));
            for (const t of [a, a + Math.PI / 2]) S.line([F.P(Math.cos(t) * r, Math.sin(t) * r, 2.62), F.P(-Math.cos(t) * r, -Math.sin(t) * r, 2.62)]);
            S.loop(ring(12, (c, s) => F.P(-7.1 + c * 1.1, 0.3, 2.2 + s * 1.1)));
        });
    }

    // ------------------------------------------------------------------
    // Streets
    // ------------------------------------------------------------------

    function lamp(T, x, y, nx, ny) {
        const S = T.S;
        S.kind = ARCH;
        S.line([[x, y, 0.2], [x, y, 6.4], [x + nx * 1.4, y + ny * 1.4, 6.9]]);
        S.box(frame(x + nx * 1.4, y + ny * 1.4, 6.5, 0), -0.3, -0.18, 0, 0.3, 0.18, 0.4);
        T.anchor([x, y, 6.2], [nx, ny, 0], -10);
    }

    // Markings, crossings, lamps, cars and people along one street, from a to b
    // along its axis (0 runs along x) and centred on c
    function street(T, axis, c, a, b, w, rng) {
        const S = T.S, busy = [], P = (u, v, z = 0.02) => axis === 0 ? [u, c + v, z] : [c + v, u, z], len = b - a, p = T.p;
        if (len < 3) return;
        S.kind = PAD;
        if (w >= 14) for (const v of [-0.2, 0.2]) S.line([P(a, v), P(b, v)]);
        else for (let u = a + 1; u < b - 1; u += 6) S.line([P(u, 0), P(Math.min(b - 1, u + 3), 0)]);
        S.kind = ROAD;
        if (w >= 14) for (const v of [-w / 4, w / 4]) for (let u = a + 1; u < b - 1; u += 7) S.line([P(u, v), P(Math.min(b - 1, u + 3), v)]);
        for (const [end, dir] of [[a, 1], [b, -1]]) {
            if (!rng.chance(0.75)) continue;
            for (let v = -w / 2 + 0.9; v < w / 2 - 0.6; v += 1) S.line([P(end + dir * 0.6, v), P(end + dir * 3.2, v)]);
            S.line([P(end + dir * 4, -w / 2 + 0.4), P(end + dir * 4, w / 2 - 0.4)]);
            if (T.detail && rng.chance(0.45) && len > 20) inKind(S, PAD, () => {
                const v = rng.pick([-1, 1]) * w / 4, sz = 2.2;
                glyphs(T, (x, y) => P(end + dir * (6 + y), v - x + sz * 1.3, 0.02), 0, 0, sz, 2, rng);
            });
        }
        const lanes = w >= 14 ? [-w / 4 - 1, -1.8, 1.8, w / 4 + 1] : [-1.7, 1.7];
        const cars = Math.round(len / 14 * p.traffic * rng.range(0.6, 1.4));
        quiet(S, () => {
            for (let i = 0; i < cars; i++) {
                const v = rng.pick(lanes), u = rng.range(a + 5, b - 5), dir = axis === 0 ? (v < 0 ? 0 : 2) : (v < 0 ? 3 : 1), [x, y] = P(u, v);
                // inner lanes pass close to the piers of the highway overhead
                if (busy.some(q => Math.abs(q[0] - u) < 6.5 && q[1] === v) || T.piers.some(q => Math.hypot(q[0] - x, q[1] - y) < 4.5)) continue;
                busy.push([u, v]);
                // about a third are yellow cabs, in the pad ink
                inKind(S, rng.chance(0.32) ? PAD : LIFE, () => kit.car(T, x, y, 0, dir, rng, true));
            }
        });
    }

    function sidewalk(T, x0, y0, x1, y1, rng, wide) {
        const S = T.S, p = T.p;
        S.kind = ROAD;
        S.box(F0, x0, y0, 0, x1, y1, 0.2);
        const edges = [[[x0, y0], [x1, y0], [0, -1]], [[x0, y1], [x0, y0], [-1, 0]], [[x1, y0], [x1, y1], [1, 0]], [[x1, y1], [x0, y1], [0, 1]]];
        for (const [a, b, n] of edges) {
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
            const at = (s, o) => [a[0] + ux * s - n[0] * o, a[1] + uy * s - n[1] * o];
            for (let s = 4 + rng.range(0, 6); s < len - 3; s += rng.range(14, 20)) lamp(T, ...at(s, 0.6), n[0], n[1]);
            if (wide[n[0] ? (n[0] < 0 ? 0 : 1) : (n[1] < 0 ? 2 : 3)]) {
                for (let s = 7; s < len - 4; s += rng.range(8, 11)) tree(T, ...at(s, 1.2), 0.2, rng);
            }
            quiet(S, () => {
                for (let k = Math.round(len / 12 * p.traffic * rng.range(0.3, 1.2)); k > 0; k--) inKind(S, LIFE, () => kit.person(T, ...at(rng.range(1, len - 1), rng.range(0.7, 1.9)), 0.2, rng));
            });
        }
    }

    // ------------------------------------------------------------------
    // Viaducts
    // ------------------------------------------------------------------

    // Plan polyline with arc length and mitred normals (to the left)
    function makePath(pts) {
        const s = [0];
        for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const tan = i => {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + (i ? 0 : 1))];
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        };
        const nrm = pts.map((_, i) => {
            const t1 = tan(i), t2 = tan(Math.min(pts.length - 1, i + 1)), n1 = [-t1[1], t1[0]], n2 = [-t2[1], t2[0]];
            const m = [n1[0] + n2[0], n1[1] + n2[1]], d = m[0] * n1[0] + m[1] * n1[1] || 1;
            return [m[0] / d, m[1] / d];
        });
        const at = d => {
            let i = 1;
            while (i < pts.length - 1 && s[i] < d) i++;
            const a = pts[i - 1], b = pts[i], f = geo.clamp((d - s[i - 1]) / (s[i] - s[i - 1] || 1), 0, 1), l = s[i] - s[i - 1] || 1;
            return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
        };
        const off = (i, o, z) => [pts[i][0] + nrm[i][0] * o, pts[i][1] + nrm[i][1] * o, z];
        const dist = (x, y) => {
            let best = Infinity;
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
                const f = geo.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1);
                best = Math.min(best, Math.hypot(x - a[0] - dx * f, y - a[1] - dy * f));
            }
            return best;
        };
        return { pts, s, len: s[s.length - 1], at, off, dist };
    }

    // Swept deck: convex pieces as quiet solids, then the long edges drawn once each
    function sweep(T, path, pieces, edges) {
        const S = T.S, n = path.pts.length;
        for (const [o0, o1, z0, z1] of pieces) for (let i = 0; i + 1 < n; i++) {
            const A = [path.off(i, o0, z0), path.off(i, o1, z0), path.off(i, o1, z1), path.off(i, o0, z1)];
            const B = [path.off(i + 1, o0, z0), path.off(i + 1, o1, z0), path.off(i + 1, o1, z1), path.off(i + 1, o0, z1)];
            S.solid(A.concat(B), BOX, null, true);
        }
        for (const [o, z] of edges) S.line(path.pts.map((_, i) => path.off(i, o, z)));
    }

    function highway(T, path, rng, avoid) {
        const S = T.S, wd = 13, zd = 11.5, zb = zd - 2.2, gw = 5, half = wd / 2;
        S.kind = ARCH;
        sweep(T, path, [[-half, half, zd - 0.6, zd], [-half, -half + 0.4, zd, zd + 1.1], [half - 0.4, half, zd, zd + 1.1], [-gw / 2, gw / 2, zb, zd - 0.6]],
            [[-half, zd + 1.1], [half, zd + 1.1], [-half + 0.4, zd + 1.1], [half - 0.4, zd + 1.1], [-half + 0.4, zd], [half - 0.4, zd], [-half, zd - 0.6], [half, zd - 0.6], [-gw / 2, zb], [gw / 2, zb]]);
        for (let d = rng.range(4, 12); d < path.len; d += 24) {
            const { p, t } = path.at(d), F = turned(p[0], p[1], 0, Math.atan2(t[1], t[0])), Rv = T.river;
            // piers standing in the river go down to the water
            S.box(F, -0.9, -1.1, Rv && p[1] > Rv.ya && p[1] < Rv.yb ? ZW : 0, 0.9, 1.1, zb - 1.3);
            S.box(F, -1.1, -gw / 2 - 1.2, zb - 1.3, 1.1, gw / 2 + 1.2, zb);
            T.piers.push(p);
        }
        inKind(S, PAD, () => { for (const o of [-0.2, 0.2]) S.line(path.pts.map((_, i) => path.off(i, o, zd + 0.02))); });
        inKind(S, ROAD, () => {
            for (const o of [-half / 2, half / 2]) for (let d = 1; d < path.len - 3; d += 8) {
                const A = path.at(d), B = path.at(d + 3.5), n0 = [-A.t[1], A.t[0]], n1 = [-B.t[1], B.t[0]];
                S.line([[A.p[0] + n0[0] * o, A.p[1] + n0[1] * o, zd + 0.02], [B.p[0] + n1[0] * o, B.p[1] + n1[1] * o, zd + 0.02]]);
            }
        });
        for (let d = 10, k = 0; d < path.len; d += 30, k++) {
            const { p, t } = path.at(d), o = k % 2 ? half - 0.2 : -half + 0.2, n = [-t[1], t[0]], sg = Math.sign(o);
            S.line([[p[0] + n[0] * o, p[1] + n[1] * o, zd + 1.1], [p[0] + n[0] * o, p[1] + n[1] * o, zd + 7], [p[0] + n[0] * (o - sg * 2), p[1] + n[1] * (o - sg * 2), zd + 7.4]]);
        }
        const g = path.len * rng.range(0.3, 0.7), { p, t } = path.at(g), F = turned(p[0], p[1], zd, Math.atan2(t[1], t[0]));
        // the sign gantry would reach up into the monorail where the two cross
        if ((Math.abs(t[0]) > 0.99 || Math.abs(t[1]) > 0.99) && !(avoid && avoid.dist(p[0], p[1]) < 3)) {
            for (const s of [-half, half]) S.box(F, -0.3, s - 0.3, 1.1, 0.3, s + 0.3, 7.5);
            S.box(F, -0.4, -half, 7.5, 0.4, half, 8.3);
            const side = T.sees([-t[0], -t[1], 0]) ? -0.45 : 0.45;
            S.kind = SIGN;
            for (const [b0, b1] of [[-half + 0.8, -0.6], [0.6, half - 0.8]]) {
                S.box(F, -0.35, b0, 5.4, 0.35, b1, 7.5);
                const at = (u, v) => F.P(side, b1 - u, v);
                if (T.detail && T.k > 0.9) glyphs(T, at, 0.4, 5.8, 1.1, Math.floor((b1 - b0 - 0.6) / 1.55), rng);
            }
            S.kind = ARCH;
        }
        quiet(S, () => {
            for (let d = rng.range(3, 12); d < path.len; d += rng.range(9, 22)) {
                const { p, t } = path.at(d);
                if (Math.abs(t[0]) < 0.999 && Math.abs(t[1]) < 0.999) continue;
                const lane = rng.pick([-1, 1]), o = lane * rng.pick([1.8, 4.6]), n = [-t[1], t[0]];
                const fwd = o < 0, dir = Math.abs(t[0]) > 0.5 ? ((t[0] > 0) === fwd ? 0 : 2) : ((t[1] > 0) === fwd ? 1 : 3);
                inKind(S, LIFE, () => kit.car(T, p[0] + n[0] * o, p[1] + n[1] * o, zd, dir, rng, true));
            }
        });
    }

    function monorail(T, path, zm, avoid, rng) {
        const S = T.S;
        S.kind = ARCH;
        sweep(T, path, [[-0.55, 0.55, zm - 1.8, zm]], [[-0.55, zm], [0.55, zm], [-0.55, zm - 1.8], [0.55, zm - 1.8]]);
        for (let d = rng.range(2, 14); d < path.len; d += 26) {
            const { p, t } = path.at(d);
            if (avoid && avoid.dist(p[0], p[1]) < 9) continue;
            const F = turned(p[0], p[1], 0, Math.atan2(t[1], t[0]));
            S.lathe(p[0], p[1], [[0.75, 0], [0.75, zm - 4]], T.segs(0.75));
            S.solid([F.P(-0.8, -1.8, zm - 4), F.P(0.8, -1.8, zm - 4), F.P(0.8, 1.8, zm - 4), F.P(-0.8, 1.8, zm - 4),
                F.P(-0.6, -0.55, zm - 1.8), F.P(0.6, -0.55, zm - 1.8), F.P(0.6, 0.55, zm - 1.8), F.P(-0.6, 0.55, zm - 1.8)], BOX);
        }
        // a train where the line crosses the view of the landmark, or near the middle of the page
        let best = 0, bd = Infinity;
        const aim = T.cam.project(0, 0, 0), ax = aim[0] + rng.range(-0.12, 0.12) * T.W;
        for (let d = 0; d < path.len; d += 2) {
            const sc = T.cam.project(...path.at(d).p, zm), e = Math.abs(sc[0] - ax) + (sc[1] < 0 || sc[1] > T.H ? 1e6 : 0);
            if (e < bd) { bd = e; best = d; }
        }
        const { p, t } = path.at(best), n = [-t[1], t[0]], cars = 3, cl = 11;
        S.kind = LIFE;
        for (let c = 0; c < cars; c++) {
            const u = (c - cars / 2) * (cl + 0.8), o = [p[0] + t[0] * u, p[1] + t[1] * u];
            const prof = [[-1.45, zm - 0.9], [1.45, zm - 0.9], [1.6, zm + 1.5], [1.15, zm + 2.5], [-1.15, zm + 2.5], [-1.6, zm + 1.5]]
                .map(([v, z]) => [o[0] + n[0] * v, o[1] + n[1] * v, z]);
            S.prism(prof, [t[0] * cl, t[1] * cl, 0]);
            for (const sg of [-1, 1]) {
                if (!T.sees([n[0] * sg, n[1] * sg, 0])) continue;
                const side = (f, z) => { const v = sg * geo.lerp(1.45, 1.6, (z - zm + 0.9) / 2.4) + sg * 0.02; return [o[0] + t[0] * f + n[0] * v, o[1] + t[1] * f + n[1] * v, z]; };
                S.line([side(0.6, zm + 0.5), side(cl - 0.6, zm + 0.5)]);
                S.line([side(0.6, zm + 1.4), side(cl - 0.6, zm + 1.4)]);
                if (T.detail) for (let f = 1.6; f < cl - 1; f += 1.3) S.line([side(f, zm + 0.5), side(f, zm + 1.4)]);
            }
        }
    }

    // ------------------------------------------------------------------
    // Cables and skybridges
    // ------------------------------------------------------------------

    // Grid of what's standing, for keeping cables and bridges out of buildings
    class Solids {
        constructor() { this.cells = new Map(); }
        key(i, j) { return i * 73856093 ^ j * 19349663; }
        add(x0, y0, x1, y1, z, id) {
            const b = [x0, y0, x1, y1, z, id];
            for (let i = Math.floor(x0 / 16); i <= Math.floor(x1 / 16); i++) for (let j = Math.floor(y0 / 16); j <= Math.floor(y1 / 16); j++) {
                const k = this.key(i, j);
                (this.cells.get(k) || this.cells.set(k, []).get(k)).push(b);
            }
        }
        top(x, y) {
            let t = 0;
            for (const q of this.cells.get(this.key(Math.floor(x / 16), Math.floor(y / 16))) || []) if (q[4] < 1e3 && x > q[0] && x < q[2] && y > q[1] && y < q[3]) t = Math.max(t, q[4]);
            return t;
        }
        hit(x, y, z, a, b) {
            const list = this.cells.get(this.key(Math.floor(x / 16), Math.floor(y / 16)));
            if (!list) return false;
            for (const q of list) if (q[5] !== a && q[5] !== b && x > q[0] - 0.3 && x < q[2] + 0.3 && y > q[1] - 0.3 && y < q[3] + 0.3 && z < q[4] + 0.6) return true;
            return false;
        }
    }

    function cables(T, rng, paths) {
        const S = T.S, A = T.anchors, cells = new Map(), key = (i, j) => i * 92821 + j;
        for (const a of A) {
            const k = key(Math.floor(a.p[0] / 20), Math.floor(a.p[1] / 20));
            (cells.get(k) || cells.set(k, []).get(k)).push(a);
        }
        const blocked = (x, y, z, a, b) => {
            if (T.solids.hit(x, y, z, a, b)) return true;
            for (const [P, half, lo, hi] of paths) if (z > lo && z < hi && P.dist(x, y) < half) return true;
            return false;
        };
        S.kind = CABLE;
        for (const a of A) {
            if (!rng.chance(T.p.cables)) continue;
            const i0 = Math.floor(a.p[0] / 20), j0 = Math.floor(a.p[1] / 20), cand = [];
            for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) for (const b of cells.get(key(i, j)) || []) {
                if (b === a || b.id === a.id) continue;
                const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], L = Math.hypot(dx, dy);
                if (L < 6 || L > 45 || Math.abs(b.p[2] - a.p[2]) > L * 0.35 + 2 || b.used > 1) continue;
                if (T.river && Math.min(a.p[1], b.p[1]) < T.river.yb && Math.max(a.p[1], b.p[1]) > T.river.ya) continue;
                if (dx * a.n[0] + dy * a.n[1] < 0.3 * L || -dx * b.n[0] - dy * b.n[1] < 0.3 * L) continue;
                cand.push(b);
            }
            if (!cand.length) continue;
            const b = rng.pick(cand), L = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
            // more than a couple of cables into one point makes a spider's web
            if (a.used > 1) continue;
            a.used = (a.used || 0) + 1;
            b.used = (b.used || 0) + 1;
            const wires = rng.weighted([[3, 1], [2, 2], [1, 3]]), sag0 = L * rng.range(0.04, 0.1);
            for (let w = 0; w < wires; w++) {
                const sag = sag0 * (1 + 0.45 * w);
                const at = f => [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f - 4 * sag * f * (1 - f)];
                // tested every metre, finer than it's drawn, or it cuts through building corners
                let ok = true;
                for (let k = 1, n = Math.ceil(L); k < n && ok; k++) {
                    const q = at(k / n);
                    if (q[2] < 2.5 || blocked(q[0], q[1], q[2], a.id, b.id)) ok = false;
                }
                if (ok) S.line(Array.from({ length: 13 }, (_, k) => at(k / 12)));
            }
        }
    }

    function skybridges(T, lots, rng, transitLines) {
        const S = T.S, flat = lots.filter(L => L.flat);
        for (const A of flat) for (const B of flat) {
            if (A === B) continue;
            for (const axis of [0, 1]) {
                const a1 = axis ? A.flat[3] : A.flat[2], b0 = axis ? B.flat[1] : B.flat[0], gap = b0 - a1;
                if (gap < 6 || gap > 26) continue;
                const lo = Math.max(axis ? A.flat[0] : A.flat[1], axis ? B.flat[0] : B.flat[1]) + 1.5, hi = Math.min(axis ? A.flat[2] : A.flat[3], axis ? B.flat[2] : B.flat[3]) - 1.5;
                if (hi - lo < 3.5) continue;
                const mid = (a1 + b0) / 2, lineKey = (axis ? 'y' : 'x') + Math.round(mid / T.B);
                if (transitLines.has(lineKey)) continue;
                const top = Math.min(A.flat[4], B.flat[4]) - 4, bottom = Math.max(A.flat[5], B.flat[5]);
                if (top - bottom < 4 || !rng.chance(T.p.bridges * 0.9)) continue;
                const z = Math.ceil(rng.range(bottom, top - 3.8) / FL) * FL, c = rng.range(lo + 1.6, hi - 1.6);
                if (z + 3.8 > top + 4) continue;
                const box = axis ? [c - 1.6, a1, c + 1.6, b0] : [a1, c - 1.6, b0, c + 1.6];
                // a lot between the two in the same block would be in the way
                let clear = true;
                for (let u = 0.5; u < gap && clear; u += 1) for (const v of [-1.6, 0, 1.6]) if (T.solids.hit(axis ? c + v : a1 + u, axis ? a1 + u : c + v, 0, A.id, B.id)) clear = false;
                if (!clear) continue;
                S.kind = ARCH;
                const ws = prism(T, rect(...box), z, z + 3.4);
                S.box(F0, box[0] - 0.15, box[1] - 0.15, z + 3.4, box[2] + 0.15, box[3] + 0.15, z + 3.8);
                for (const W of ws) {
                    if (!W.seen || W.len < 5) continue;
                    inKind(S, GLASS, () => {
                        S.line([W.at(0, z + 1), W.at(W.len, z + 1)]);
                        S.line([W.at(0, z + 2.9), W.at(W.len, z + 2.9)]);
                        for (let s = 1.5; s < W.len - 0.5; s += 1.5) S.line([W.at(s, z + 1), W.at(s, z + 2.9)]);
                    });
                    shadeWall(T, W, 0, W.len, z, z + 3.4);
                }
                T.solids.add(box[0], box[1], box[2], box[3], z + 4, -5);
            }
        }
    }

    // ------------------------------------------------------------------
    // The river
    // ------------------------------------------------------------------

    // R is the river: land from y0 to y1 across the whole map (x0 to x1), the
    // promenades running down to the quay edges at ya and yb, water between,
    // and the streets that cross it on bridges (R.bridges, [x, half width]).
    const offBridge = (R, x, pad) => R.bridges.every(([bx, bh]) => Math.abs(x - bx) > bh + pad);

    function riverBanks(T, R, rng) {
        const S = T.S, { x0, x1, y0, y1, ya, yb } = R;
        S.kind = ARCH;
        S.face(lift(rect(x0, ya, x1, yb), ZW), false);
        S.box(F0, x0, y0, ZW, x1, ya, 0.2);
        S.box(F0, x0, yb, ZW, x1, y1, 0.2);
        // coping and a tide line along the far quay wall, the one we see
        S.line([[x0, yb - 0.02, -0.25], [x1, yb - 0.02, -0.25]]);
        inKind(S, WATER, () => {
            for (let x = x0 + rng.range(0, 6); x < x1; x += rng.range(4, 9)) S.line([[x, yb - 0.02, ZW + 0.6], [x + rng.range(2, 5), yb - 0.02, ZW + 0.6]]);
        });
        // railings along both edges, then trees, lamps and people on the promenades
        for (const [ye, side] of [[ya - 0.3, -1], [yb + 0.3, 1]]) {
            S.line([[x0, ye, 1.25], [x1, ye, 1.25]]);
            for (let x = Math.ceil(x0 / 2.5) * 2.5; x < x1; x += 2.5) if (offBridge(R, x, 0.3)) S.line([[x, ye, 0.2], [x, ye, 1.25]]);
            const mid = ye + side * (PROM / 2 - 0.3);
            for (let x = x0 + rng.range(0, 9); x < x1; x += rng.range(8, 11)) if (offBridge(R, x, 3)) tree(T, x, mid, 0.2, rng);
            for (let x = x0 + rng.range(0, 18); x < x1; x += rng.range(16, 22)) if (offBridge(R, x, 1.5)) lamp(T, x, ye + side * 0.4, 0, -side);
            quiet(S, () => {
                for (let x = x0 + rng.range(0, 30); x < x1; x += rng.range(20, 40)) if (offBridge(R, x, 2) && rng.chance(0.5)) inKind(S, ARCH, () => kit.bench(T, x, ye + side * 1.4, 0.2, side > 0 ? 3 : 1));
                for (let k = Math.round((x1 - x0) / 9 * T.p.traffic); k > 0; k--) {
                    const x = rng.range(x0, x1);
                    if (offBridge(R, x, 1)) inKind(S, LIFE, () => kit.person(T, x, ye + side * rng.range(0.8, PROM - 0.8), 0.2, rng));
                }
            });
        }
    }

    // Steel bridge carrying the street at x over the river, w wide. The deck runs
    // the whole width of the land band, sunk into the promenades.
    function riverBridge(T, R, x, w, style, rng) {
        const S = T.S, { y0, y1, ya, yb } = R, zd = 0.32, zp = zd + 1.1, h = w / 2, span = yb - ya;
        S.kind = ARCH;
        S.box(F0, x - h, y0, zd - 1.5, x + h, y1, zd);
        for (const s of [-1, 1]) S.box(F0, x + s * h - (s > 0 ? 0.35 : 0), ya - 3, zd, x + s * h + (s < 0 ? 0.35 : 0), yb + 3, zp);
        inKind(S, PAD, () => { for (let y = y0 + 1; y < y1 - 1; y += 6) S.line([[x, y, zd + 0.01], [x, Math.min(y1 - 1, y + 3), zd + 0.01]]); });
        inKind(S, ROAD, () => { for (const s of [-1, 1]) S.line([[x + s * (h - 2.2), y0, zd + 0.01], [x + s * (h - 2.2), y1, zd + 0.01]]); });
        const curve = (f, n = 32) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
        if (style === 'girder') {
            for (let k = 1, n = Math.ceil(span / 22); k < n; k++) {
                const y = ya + span * k / n;
                S.box(F0, x - h + 0.8, y - 0.9, ZW, x + h - 0.8, y + 0.9, zd - 1.5);
            }
        } else if (style === 'arch') {
            // tied arches either side with hangers down to the deck, braced across the top
            const rise = span * 0.2, top = (t, d = 0) => zp + (rise - d) * Math.sin(Math.PI * t);
            for (const s of [-1, 1]) {
                const xs = x + s * (h - 0.2);
                S.line(curve(t => [xs, geo.lerp(ya, yb, t), top(t)]));
                S.line(curve(t => [xs, geo.lerp(ya, yb, t), top(t, 0.9)]));
                for (let y = ya + 3.5; y < yb - 3; y += 3.5) S.line([[xs, y, zp], [xs, y, top((y - ya) / span, 0.9)]]);
            }
            for (let t = 0.3; t < 0.71; t += 0.1) S.line([[x - h + 0.2, geo.lerp(ya, yb, t), top(t)], [x + h - 0.2, geo.lerp(ya, yb, t), top(t)]]);
        } else if (style === 'truss') {
            // Warren truss either side, end posts sloping down to the banks
            const ht = 5.5, n = Math.max(4, Math.round(span / 5)), dy = span / n;
            for (const s of [-1, 1]) {
                const xs = x + s * (h - 0.2);
                S.line([[xs, ya, zp], [xs, ya + dy, zp + ht], [xs, yb - dy, zp + ht], [xs, yb, zp]]);
                const zig = [];
                for (let k = 1; k < n; k++) zig.push([xs, ya + k * dy, k % 2 ? zp + ht : zp]);
                S.line([[xs, ya + dy, zp + ht], ...zig.slice(1)]);
                for (let k = 2; k < n - 1; k += 2) S.line([[xs, ya + k * dy, zp], [xs, ya + k * dy, zp + ht]]);
            }
            for (let k = 1; k < n; k++) S.line([[x - h + 0.2, ya + k * dy, zp + ht], [x + h - 0.2, ya + k * dy, zp + ht]]);
            for (let k = 1; k < n - 1; k++) S.line([[x - h + 0.2, ya + k * dy, zp + ht], [x + h - 0.2, ya + (k + 1) * dy, zp + ht]]);
        } else if (style === 'suspension') {
            // two towers standing in the water near the banks, main cables slung between
            const ht = geo.clamp(span * 0.32, 14, 26), ys = [ya + span * 0.16, yb - span * 0.16], zt = zd + ht;
            for (const yt of ys) {
                for (const s of [-1, 1]) S.box(F0, x + s * (h + 0.4) - 0.6, yt - 0.7, ZW, x + s * (h + 0.4) + 0.6, yt + 0.7, zt);
                S.box(F0, x - h - 0.4, yt - 0.5, zt - 1.6, x + h + 0.4, yt + 0.5, zt - 0.4);
                S.box(F0, x - h - 0.4, yt - 0.5, zd + ht * 0.45, x + h + 0.4, yt + 0.5, zd + ht * 0.45 + 1);
                T.block([[x - h - 1, yt - 0.7], [x + h + 1, yt + 0.7]], zt, -6);
            }
            const sag = y => {
                if (y < ys[0]) return geo.lerp(zp + 0.4, zt - 0.2, (y - y0) / (ys[0] - y0));
                if (y > ys[1]) return geo.lerp(zt - 0.2, zp + 0.4, (y - ys[1]) / (y1 - ys[1]));
                const f = (y - ys[0]) / (ys[1] - ys[0]);
                return zp + 1.2 + (zt - 0.2 - zp - 1.2) * (2 * f - 1) ** 2;
            };
            inKind(S, CABLE, () => {
                for (const s of [-1, 1]) {
                    const xs = x + s * (h + 0.4);
                    S.line(curve(t => { const y = geo.lerp(y0 + 1, y1 - 1, t); return [xs, y, sag(y)]; }, 60));
                    for (let y = ys[0] + 2.5; y < ys[1] - 1; y += 2.5) S.line([[xs, y, zp], [xs, y, sag(y)]]);
                }
            });
        } else if (style === 'stayed') {
            // one A-frame pylon mid river and a fan of stays to both edges of the deck
            const ym = (ya + yb) / 2, ht = geo.clamp(span * 0.45, 16, 30), zt = zd + ht;
            for (const s of [-1, 1]) S.solid([[x + s * (h + 1.4), ym - 0.9, ZW], [x + s * (h + 0.2), ym - 0.9, ZW], [x + s * (h + 0.2), ym + 0.9, ZW], [x + s * (h + 1.4), ym + 0.9, ZW],
                [x + s * 0.8, ym - 0.6, zt], [x, ym - 0.6, zt], [x, ym + 0.6, zt], [x + s * 0.8, ym + 0.6, zt]], BOX);
            T.block([[x - h - 1.4, ym - 0.9], [x + h + 1.4, ym + 0.9]], zt, -6);
            S.box(F0, x - 0.9, ym - 0.7, zt, x + 0.9, ym + 0.7, zt + 1.6);
            inKind(S, CABLE, () => {
                for (const s of [-1, 1]) for (const d of [-1, 1]) for (let k = 1; k <= 7; k++) {
                    const y = ym + d * (span / 2 + 2) * k / 7, z = zt - 0.6 - k * 0.55;
                    S.line([[x + s * 0.4 * (1 - z / zt), ym + d * 0.4, z], [x + s * (h - 0.2), y, zp]]);
                }
            });
        }
        quiet(S, () => {
            for (let y = y0 + rng.range(2, 8); y < y1 - 4; y += rng.range(9, 16)) {
                const v = rng.pick([-1.7, 1.7]);
                inKind(S, rng.chance(0.3) ? PAD : LIFE, () => kit.car(T, x + v, y, zd, v < 0 ? 3 : 1, rng, true));
            }
        });
    }

    // Long barge with containers on it and the wheelhouse at the stern. Some
    // containers are painted in the roof ink.
    function barge(T, x, y, ang, rng) {
        const S = T.S, L = rng.range(26, 34), F = turned(x, y, ZW, ang);
        const Hl = kit.hullSolid(T, F, L, 6.4, 1.3, 0.3, false), zd = Hl.z(0) + 0.05;
        for (let u = -L * 0.28; u < L * 0.38 - 6; u += 6.3) for (const v of [-1.3, 1.3]) {
            if (!rng.chance(0.85)) continue;
            const stack = rng.chance(0.35) ? 2 : 1, painted = rng.chance(0.45);
            for (let k = 0; k < stack; k++) {
                const z0 = zd + k * 2.6;
                S.box(F, u, v - 1.2, z0, u + 6, v + 1.2, z0 + 2.5);
                if (!painted || !T.detail) continue;
                const n = F.V(0, v < 0 ? -1 : 1, 0), side = v < 0 ? v - 1.21 : v + 1.21;
                if (T.sees(n)) inKind(S, ROOF, () => S.hatch([F.P(u, side, z0), F.P(u + 6, side, z0), F.P(u + 6, side, z0 + 2.5), F.P(u, side, z0 + 2.5)], [0, 0, 1], T.gap * 0.8));
            }
        }
        const us = -L * 0.46;
        S.box(F, us, -2.2, zd, us + 4, 2.2, zd + 2.6);
        S.box(F, us + 0.6, -1.6, zd + 2.6, us + 3.4, 1.6, zd + 4.4);
        S.box(F, us + 0.3, -1.9, zd + 4.4, us + 3.7, 1.9, zd + 4.7);
        S.line([F.P(us + 2, 0, zd + 4.7), F.P(us + 2, 0, zd + 6.5)]);
        return kit.wake(T, x, y, ang, L, rng, ZW, 1.4);
    }

    // Boats, a barge and the ripples on the water. Wakes come back as patches
    // the ripples keep out of.
    function riverTraffic(T, R, rng) {
        const S = T.S, { x0, x1, ya, yb } = R, ym = (ya + yb) / 2, span = yb - ya;
        // the stretch of river on the page
        let lo = Infinity, hi = -Infinity;
        for (let x = x0; x < x1; x += 4) for (const y of [ya, yb]) {
            const q = T.cam.project(x, y, ZW);
            if (q[0] > 0 && q[0] < T.W && q[1] > 0 && q[1] < T.H) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
        }
        if (!(hi > lo)) return;
        const patches = [], clear = (x, pad) => offBridge(R, x, pad) && patches.every(P => !(Math.abs(P.x - x) < P.r));
        if (span > 30 && rng.chance(0.7)) {
            const x = rng.range(lo + 20, hi - 20);
            if (clear(x, 22)) {
                const ang = rng.chance(0.5) ? 0 : Math.PI, y = ym + (ang ? 1 : -1) * span * 0.18;
                patches.push({ x, r: 40, poly: barge(T, x, y, ang, rng) });
            }
        }
        for (let k = Math.round((hi - lo) / 70 * (span > 30 ? 2 : 1)); k > 0; k--) {
            const x = rng.range(lo, hi);
            if (!clear(x, 12)) continue;
            const ang = rng.chance(0.5) ? 0 : Math.PI, y = ym + (ang ? 1 : -1) * rng.range(0.1, 0.32) * span;
            patches.push({ x, r: 18, poly: kit.underway(T, x, y, ang + rng.range(-0.08, 0.08), rng, ZW) });
        }
        // a few boats tied up along the far quay
        quiet(S, () => {
            for (let x = lo + rng.range(0, 30); x < hi; x += rng.range(25, 60)) {
                if (!clear(x, 10) || !rng.chance(0.6)) continue;
                const kind = rng.weighted([[3, 'launch'], [2, 'row'], [1, 'sail']]);
                kit.boat(T, frame(x, yb - kit.BEAM[kind] / 2 - 0.4, ZW, rng.chance(0.5) ? 0 : 2), kind, rng);
                patches.push({ x, r: 6 });
            }
        });
        // ripples as short dashes along the page, the way Harbour does its water
        const r = [T.cam.rx, T.cam.ry];
        inKind(S, WATER, () => {
            for (let k = Math.round((hi - lo + 40) * span / 85); k > 0; k--) {
                const x = rng.range(lo - 20, hi + 20), y = rng.range(ya + 1.2, yb - 1.2), l = rng.range(1.5, 4.5);
                if (!offBridge(R, x, 2) || patches.some(P => P.poly && geo.pointInPolygon(x, y, P.poly))) continue;
                S.line([[x - r[0] * l / 2, y - r[1] * l / 2, ZW], [x + r[0] * l / 2, y + r[1] * l / 2, ZW]]);
            }
        });
    }

    // Street shadows land on the ground at 0.2 m, except over the river where
    // they fall further, onto the water. Every shadow is split between the two.
    function riverShadows(S, R, land) {
        const water = S.shadowGroup(ZW, [R.x0, R.ya, R.x1, R.yb], land.ang), cast = S.castShadow;
        S.shadow = land;
        S.castShadow = function (pts) {
            if (this.shadow !== land) return cast.call(this, pts);
            const [sx, sy] = this.sun, at = z => PG.iso.hull(pts.map(p => { const h = Math.max(0, p[2] - z); return [p[0] + h * sx, p[1] + h * sy]; }));
            const s = at(land.z);
            for (const piece of [geo.clipPolygonHalfPlane(s, [0, R.ya], [0, -1]), geo.clipPolygonHalfPlane(s, [0, R.yb], [0, 1])]) if (piece.length >= 3) land.polys.push(piece);
            const w = at(ZW);
            if (w.length >= 3 && w.some(q => q[1] > R.ya) && w.some(q => q[1] < R.yb)) water.polys.push(w);
        };
    }

    // ------------------------------------------------------------------
    // The district
    // ------------------------------------------------------------------

    // Each district scales the odds of the building types, and the heights. A
    // type left out keeps its usual odds.
    const DISTRICTS = {
        downtown: { height: 1.1, glass: 2.2, taper: 1.6, twist: 1.6, podium: 1.5, dark: 1.4, build: 1.3, office: 0.8, deco: 0.5, green: 0.8, clutter: 0.1, low: 0.15, parking: 0.2, park: 0.4, church: 0.3 },
        midtown: { height: 0.85, deco: 2.4, office: 2, drum: 1.2, glass: 0.5, taper: 0.4, twist: 0.3, dark: 0.6, clutter: 0.5, low: 1.1, church: 1.4, park: 1.2 },
        old: { height: 0.62, clutter: 3.2, low: 2, parking: 1.2, office: 0.7, glass: 0.1, taper: 0.1, twist: 0.1, podium: 0.2, dark: 0.2, deco: 0.4, green: 0.2, church: 0.8 },
        leafy: { height: 0.75, park: 3, green: 3, dome: 2, church: 1.5, low: 1.4, glass: 0.6, clutter: 0.3, dark: 0.3, build: 0.6 },
    };

    // Big soft patches from noise, with downtown near the middle of the page
    function district(T, cx, cy) {
        const core = 1 / (1 + (Math.hypot(cx, cy) / (T.B * 2.4)) ** 2), v = T.noise.noise2(cx / (T.B * 2.6) + 7.3, cy / (T.B * 2.6) - 2.1);
        if (core > 0.55 && v > -0.45) return 'downtown';
        if (v > 0.22 + T.p.clutter * -0.25) return 'old';
        if (v < -0.38 + T.p.parks * 0.3) return 'leafy';
        return 'midtown';
    }

    // low keeps to the short types, for lots under a viaduct or in front of the landmark
    function pickType(rng, w, d, prev, low, p, dist, oneOff) {
        const m = Math.min(w, d), M = Math.max(w, d), D = DISTRICTS[dist];
        const church = m > 15 && M > 24 ? 0.5 : 0;
        const opts = (low ? [[3, 'low'], [1.2, 'parking'], [2 * p.clutter, 'clutter'], [0.5 + p.parks * 3, 'park'], [m > 20 ? 0.8 : 0, 'dome'], [church, 'church']] : [
            [m > 12 ? 2.2 : 0.5, 'glass'], [1.3, 'office'], [m > 13 ? 1.4 : 0, 'deco'], [m > 9 ? 1.5 : 0.4, 'drum'], [m > 11 ? 1.2 : 0, 'taper'],
            [m > 12 ? 1 : 0, 'twist'], [m > 17 && M > 21 ? 3 : 0, 'podium'], [1.8 * (0.3 + p.clutter), 'clutter'], [m > 9 ? 0.7 : 0.2, 'dark'],
            [p.cranes && m > 14 ? 0.7 : 0, 'build'], [m > 20 ? 0.4 : 0, 'dome'], [m < 12 ? 1.4 : 0.4, 'low'], [p.parks * 2, 'park'], [0.2, 'parking'],
            [m > 13 ? 0.5 : 0, 'green'], [church, 'church']]).map(([w, t]) => [w * (D[t] ?? 1), t]);
        // a cathedral is a one-off, two in sight looks like a mistake
        if (oneOff) opts.forEach(o => { if (o[1] === 'church') o[0] = 0; });
        let t = rng.weighted(opts);
        for (let k = 0; k < 3 && t === prev; k++) t = rng.weighted(opts);
        return t;
    }

    const HEIGHT = { glass: [0.95, 1.3], office: [0.6, 1.05], deco: [0.85, 1.2], drum: [0.7, 1.15], taper: [0.85, 1.25], twist: [1, 1.4], podium: [0.95, 1.3],
        clutter: [0.4, 0.6], dark: [1, 1.4], build: [0.55, 0.85], dome: [0, 0], low: [0.12, 0.25], parking: [0.15, 0.22], park: [0, 0], green: [0.75, 1.1], church: [0, 0] };

    function blockLots(T, i, j, x0, y0, x1, y1, hw) {
        const p = T.p, rng = new PG.RNG(hash(T.seed, i, j, 5)), MIN = 8, out = [], stop = [0.18, 0.5, 0.7, 1];
        const dist = district(T, (x0 + x1) / 2, (y0 + y1) / 2), D = DISTRICTS[dist];
        // office towers on one block mostly share a facade, which ties the block together
        const facade = rng.weighted([[3, 'ribbon'], [3, 'grid'], [2, 'piers'], [1.5, 'bands']]);
        const split = (a0, b0, a1, b1, depth) => {
            const w = a1 - a0, d = b1 - b0, canX = w > 2 * MIN + 1, canY = d > 2 * MIN + 1;
            if ((!canX && !canY) || rng.chance(stop[depth])) { out.push([a0, b0, a1, b1]); return; }
            const alongX = canX && (!canY || w > d * rng.range(0.75, 1.3)), gap = rng.chance(0.35) ? rng.range(1.5, 3) : 0;
            if (alongX) {
                const m = geo.lerp(a0 + MIN, a1 - MIN, rng.range(0.25, 0.75));
                split(a0, b0, m - gap / 2, b1, depth + 1);
                split(m + gap / 2, b0, a1, b1, depth + 1);
            } else {
                const m = geo.lerp(b0 + MIN, b1 - MIN, rng.range(0.25, 0.75));
                split(a0, b0, a1, m - gap / 2, depth + 1);
                split(a0, m + gap / 2, a1, b1, depth + 1);
            }
        };
        const park = rng.chance(p.parks * 0.3);
        if (park) out.push([x0, y0, x1, y1]);
        else split(x0, y0, x1, y1, 0);
        let prev = null;
        const lots = out.map(([a0, b0, a1, b1], k) => {
            const cx = (a0 + a1) / 2, cy = (b0 + b1) / 2;
            let cap = Infinity;
            if (hw && hw.dist(cx, cy) - Math.hypot(a1 - a0, b1 - b0) / 2 < 9) cap = 18;
            // keep the lots between the camera and the landmark low so its plaza shows
            if (T.lm) {
                const c = T.cam, ahead = -(cx * c.fx + cy * c.fy) - T.B, side = Math.abs(cx * c.rx + cy * c.ry);
                if (ahead > 0) cap = Math.min(cap, p.height * (0.2 + 0.8 * geo.clamp(Math.max(side / (2.2 * T.B), ahead / (4 * T.B)), 0, 1) ** 1.5));
            }
            // and the ones in front of the river, so the water isn't all behind towers
            if (T.river && cy < T.river.y0) cap = Math.min(cap, p.height * (0.22 + 0.78 * geo.clamp((T.river.y0 - cy) / (2.6 * T.B), 0, 1) ** 1.3));
            const type = park ? 'park' : pickType(rng, a1 - a0, b1 - b0, prev, cap < 30, p, dist, T.churches > 0);
            prev = type;
            if (type === 'church') T.churches++;
            const core = 1 / (1 + (Math.hypot(cx, cy) / (T.B * 2.8)) ** 2), [lo, hi] = HEIGHT[type];
            let h = p.height * (0.5 + 0.7 * core) * D.height * geo.lerp((lo + hi) / 2, rng.range(lo, hi), 0.5 + p.variety * 0.5) * (1 + p.variety * rng.range(-0.3, 0.3));
            if (type === 'low') h = rng.range(2, 4) * FL + 1;
            if (type === 'parking') h = rng.range(3, 5) * 3.1;
            if (type === 'clutter') h = Math.min(h, 52);
            // spires included, for the visibility test
            if (type === 'church') h = 40;
            h = Math.max(type === 'low' || type === 'parking' || type === 'church' ? h : 14, Math.min(h, cap));
            return { id: hash(i, j, k), x0: a0, y0: b0, x1: a1, y1: b1, h: Math.round(h / FL) * FL + 0.4, type, facade, rng: new PG.RNG(hash(T.seed, i, j, k, 9)), i, j };
        });
        // Neighbours right beside each side (-x, +x, -y, +y) as [from, to, height] along it,
        // so rooms and blade signs don't hang into them
        for (const L of lots) L.cover = [0, 1, 2, 3].map(s => lots.filter(M => {
            const d = [L.x0 - M.x1, M.x0 - L.x1, L.y0 - M.y1, M.y0 - L.y1][s];
            return M !== L && M.type !== 'park' && d > -0.01 && d < 4 && (s < 2 ? M.y0 < L.y1 && M.y1 > L.y0 : M.x0 < L.x1 && M.x1 > L.x0);
        }).map(M => s < 2 ? [M.y0, M.y1, M.h + 1] : [M.x0, M.x1, M.h + 1]));
        return lots;
    }

    PG.register({
        id: 'skyline', name: 'Skyline District', category: 'Scenes', fit: false,
        description: 'A crowded city in isometric ink: glass, deco and garden towers grouped into districts, a river with steel bridges, Kowloon clutter, a cathedral, elevated roads and neon signs round a faceted landmark.',
        params: [
            { type: 'section', label: 'City' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 0.7, max: 2.5, step: 0.05, value: 1.05, random: [0.95, 1.3] },
            { id: 'block', label: 'Block size (m)', type: 'range', min: 36, max: 70, step: 1, value: 48, random: [42, 56] },
            { id: 'height', label: 'Tower height (m)', type: 'range', min: 25, max: 120, step: 1, value: 72, random: [50, 90] },
            { id: 'variety', label: 'Height variety', type: 'range', min: 0, max: 1, step: 0.05, value: 0.7, random: [0.4, 0.95] },
            { id: 'landmark', label: 'Landmark', type: 'select', value: 'cone', options: [['none', 'None'], ['cone', 'Diagrid cone'], ['needle', 'TV tower']], random: ['cone', 'cone', 'needle', 'none'] },
            { id: 'water', label: 'River', type: 'select', value: 'river', options: [['none', 'None'], ['canal', 'Canal'], ['river', 'Wide river']], random: ['river', 'river', 'canal', 'none'] },
            { id: 'parks', label: 'Parks & gardens', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25, random: [0.05, 0.5] },
            { id: 'airship', label: 'Airship', type: 'checkbox', value: true, random: 0.6 },
            { id: 'heli', label: 'Helicopter', type: 'checkbox', value: true, random: 0.6 },
            { type: 'section', label: 'Streets' },
            { id: 'transit', label: 'Elevated transit', type: 'select', value: 'both', options: [['none', 'None'], ['highway', 'Highway'], ['monorail', 'Monorail'], ['both', 'Highway & monorail']], random: ['both', 'both', 'highway', 'monorail'] },
            { id: 'cables', label: 'Overhead cables', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25, random: [0.1, 0.55] },
            { id: 'bridges', label: 'Skybridges', type: 'range', min: 0, max: 1, step: 0.05, value: 0.35, random: [0.1, 0.7] },
            { id: 'traffic', label: 'Traffic & people', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6, random: [0.3, 0.9] },
            { type: 'section', label: 'Buildings' },
            { id: 'clutter', label: 'Kowloon clutter', type: 'range', min: 0, max: 1, step: 0.05, value: 0.3, random: [0.1, 0.65] },
            { id: 'signs', label: 'Signs & pipes', type: 'range', min: 0, max: 1, step: 0.05, value: 0.4, random: [0.2, 0.7] },
            { id: 'cranes', label: 'Construction cranes', type: 'checkbox', value: true, random: 0.75 },
            { id: 'detail', label: 'Windows & small details', type: 'checkbox', value: true },
            { type: 'section', label: 'Light' },
            { id: 'shade', label: 'Hatch shaded walls', type: 'checkbox', value: true },
            { id: 'gap', label: 'Hatch spacing (mm)', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1, random: false, show: p => p.shade || p.shadows },
            { id: 'shadows', label: 'Street shadows', type: 'checkbox', value: true },
            { id: 'sun', label: 'Sun from', type: 'select', value: 'left', options: [['left', 'Left'], ['right', 'Right']], random: true },
            { type: 'section', label: 'View' },
            { id: 'yaw', label: 'Turn (°)', type: 'range', min: 20, max: 70, step: 1, value: 36, random: [28, 55] },
            { id: 'elev', label: 'View height (°)', type: 'range', min: 25, max: 65, step: 1, value: 40, random: [34, 50] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H } = ctx, seed = ctx.seed | 0, B = p.block;
            const se = Math.sin(geo.rad(p.elev)), th = geo.rad(p.yaw), fx = Math.sin(th), fy = Math.cos(th);
            const k = Math.max(p.scale, Math.sqrt(W * H / (se * AREA)));
            const rng = new PG.RNG(hash(seed, 1));
            // landmark used to be a checkbox
            const kind = p.landmark === true ? 'cone' : p.landmark === false ? 'none' : p.landmark;
            // Landmark in a superblock at the origin, pushed down the page so its top stays on it
            const lm = kind === 'none' ? null : { kind, H: Math.max(p.height * (kind === 'needle' ? 2.6 : 1.75), 60), R: 0, foot: 0 };
            const ce = Math.cos(geo.rad(p.elev)), D = lm ? geo.clamp(k * lm.H * ce - 0.4 * H, 0, 0.32 * H) : 0.05 * H;
            const cam = makeCamera(p.yaw, p.elev, k, W, H, fx * D / (k * se), fy * D / (k * se));
            const S = new Scene(cam, W, H), dir = p.sun === 'left' ? [0.3, -0.42] : [-0.42, 0.3], toSun = unit([-dir[0], -dir[1], 1]);
            // ground shadows shorter than the walls' light would give, or tower shadows swallow every street
            const sun = [dir[0] * 0.7, dir[1] * 0.7];
            const light = n => (n[0] * toSun[0] + n[1] * toSun[1] + (n[2] || 0) * toSun[2]) / (Math.hypot(n[0], n[1], n[2] || 0) || 1);
            const T = {
                S, cam, p, k, B, W, H, seed, detail: p.detail, sees: n => cam.facing(n[0], n[1], n[2] || 0), segs: r => segments(r, k),
                picket: Math.max(0.45, 0.75 / k), tones: p.shade ? { lit: ROOF, dark: SHADE } : null, hLit: p.gap, hDark: p.gap, gap: p.gap, shade: p.shade,
                light, lit: n => light(n) >= 0.02, dark: n => light(n) < 0.02, anchors: [], solids: new Solids(), waterKind: WATER, lm, piers: [], paths: [], cranes: [],
                noise: ctx.noise, churches: 0, pads: [], river: null,
            };
            T.anchor = (q, n, id) => T.anchors.push({ p: q, n, id });
            T.pad = (x, y, z, r) => T.pads.push([x, y, z, r]);
            T.block = (poly, z, id) => {
                const b = geo.bbox([poly]);
                T.solids.add(b.minX, b.minY, b.maxX, b.maxY, z, id);
            };
            const land = p.shadows ? (S.sun = sun, S.shadowGroup(0.2, null, Math.atan2(cam.ry, cam.rx))) : null;

            const zMax = Math.max(p.height * 2.2, lm ? lm.H * 1.2 : 0) + 20;
            const corners = [0, zMax].flatMap(z => [[0, 0], [W, 0], [W, H], [0, H]].map(q => cam.ground(q[0], q[1], z)));
            const gx0 = Math.min(...corners.map(q => q[0])), gx1 = Math.max(...corners.map(q => q[0]));
            const gy0 = Math.min(...corners.map(q => q[1])), gy1 = Math.max(...corners.map(q => q[1]));
            const i0 = Math.floor(gx0 / B) - 1, i1 = Math.ceil(gx1 / B) + 1, j0 = Math.floor(gy0 / B) - 1, j1 = Math.ceil(gy1 / B) + 1;

            // elevated roads follow the street lines next to the superblock
            const transitLines = new Set();
            let hw = null, mono = null;
            const trng = new PG.RNG(hash(seed, 77));
            const ix = trng.pick([-1, 1]), jy = trng.pick([-2, 2]), turn = trng.pick([-1, 1]), jm = -1;
            if (p.transit === 'highway' || p.transit === 'both') {
                // up one street and round a corner into the cross street
                const X = ix * B, Y = jy * B, R = B * 0.42, far = Y > 0 ? gy0 - 40 : gy1 + 40, sgnA = Math.sign(Y - far);
                const c = [X + turn * R, Y - sgnA * R], start = Math.atan2(0, X - c[0]);
                let sweepA = Math.atan2(Y - c[1], 0) - start;
                while (sweepA > Math.PI) sweepA -= TAU;
                while (sweepA < -Math.PI) sweepA += TAU;
                const pts = [[X, far]];
                for (let s = 0; s <= 12; s++) pts.push([c[0] + R * Math.cos(start + sweepA * s / 12), c[1] + R * Math.sin(start + sweepA * s / 12)]);
                pts.push([turn > 0 ? gx1 + 40 : gx0 - 40, Y]);
                hw = makePath(pts);
                transitLines.add('x' + ix).add('y' + jy);
            }
            if (p.transit === 'monorail' || p.transit === 'both') {
                mono = makePath([[gx0 - 40, jm * B], [gx1 + 40, jm * B]]);
                transitLines.add('y' + jm);
            }
            const widthX = i => transitLines.has('x' + i) ? 20 : (hash(seed, 11, i) & 3) === 0 ? 15 : 10;
            const widthY = j => transitLines.has('y' + j) ? 20 : (hash(seed, 12, j) & 3) === 0 ? 15 : 10;
            const superblock = (i, j) => lm && (i === -1 || i === 0) && (j === -1 || j === 0);

            // The river takes a row of blocks (two for a wide one) across the lower
            // part of the page, in front of the landmark. No transit line may run
            // down the middle of it, a riverside one is fine.
            let R = null;
            if (p.water === 'canal' || p.water === 'river') {
                const rows = p.water === 'river' ? 2 : 1, rr = new PG.RNG(hash(seed, 41));
                const want = cam.ground(W * 0.5, H * rr.range(0.6, 0.74), 0)[1] / B - rows / 2;
                const ok = j => !(lm && j <= 0 && j + rows - 1 >= -1) && Array.from({ length: rows - 1 }, (_, m) => j + m + 1).every(l => !transitLines.has('y' + l));
                const j = Array.from({ length: 9 }, (_, d) => Math.round(want) + d - 4).filter(ok).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
                const y0 = j * B + widthY(j) / 2, y1 = (j + rows) * B - widthY(j + rows) / 2;
                R = T.river = { j, rows, x0: gx0 - 60, x1: gx1 + 60, y0, y1, ya: y0 + PROM, yb: y1 - PROM, bridges: [] };
                const span = R.yb - R.ya, styles = span > 40 ? [[3, 'suspension'], [3, 'stayed'], [2, 'arch'], [1.5, 'truss']] : [[3, 'arch'], [2.5, 'truss'], [1.5, 'girder']];
                for (let i = i0; i <= i1 + 1; i++) {
                    const brng = new PG.RNG(hash(seed, i, 63));
                    if (!transitLines.has('x' + i) && brng.chance(widthX(i) >= 15 ? 0.85 : 0.45)) R.bridges.push([i * B, widthX(i) / 2, brng.weighted(styles), brng]);
                }
                if (land) riverShadows(S, R, land);
            }
            const wet = j => R && j >= R.j && j < R.j + R.rows;

            const lots = [];
            const visible = (x0, y0, x1, y1, h) => S.onPage([0, h].flatMap(z => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(q => cam.project(q[0], q[1], z))));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                if (superblock(i, j) && (i !== -1 || j !== -1) || wet(j)) continue;
                const sb = superblock(i, j), ie = sb ? i + 2 : i + 1, je = sb ? j + 2 : j + 1;
                const x0 = i * B + widthX(i) / 2, x1 = ie * B - widthX(ie) / 2, y0 = j * B + widthY(j) / 2, y1 = je * B - widthY(je) / 2;
                if (!visible(x0, y0, x1, y1, sb ? lm.H * 1.2 : p.height * 2.2 + 10)) continue;
                const brng = new PG.RNG(hash(seed, i, j, 3));
                // tall lots behind the top edge can still reach into the page, their kerbs can't
                if (visible(x0, y0, x1, y1, 8)) sidewalk(T, x0, y0, x1, y1, brng, [widthX(i) >= 15, widthX(ie) >= 15, widthY(j) >= 15, widthY(je) >= 15]);
                if (sb) {
                    lm.R = Math.min(x1 - x0, y1 - y0) * 0.3;
                    withBase(T, 0.2, () => {
                        if (lm.kind === 'cone') cone(T, (x0 + x1) / 2, (y0 + y1) / 2, lm.R, lm.H, brng);
                        else needle(T, (x0 + x1) / 2, (y0 + y1) / 2, lm.R, lm.H, brng);
                        plaza(T, x0 + WALK, y0 + WALK, x1 - WALK, y1 - WALK, lm, brng);
                    });
                    continue;
                }
                for (const L of blockLots(T, i, j, x0 + WALK, y0 + WALK, x1 - WALK, y1 - WALK, hw)) {
                    if (!visible(L.x0, L.y0, L.x1, L.y1, L.h + 20)) continue;
                    // everything on a lot stands on the kerb
                    withBase(T, 0.2, () => TYPES[L.type](T, L));
                    lots.push(L);
                }
            }

            // elevated roads before the streets, so the cars below keep clear of the highway piers
            const paths = T.paths;
            if (hw) { highway(T, hw, rng, mono); paths.push([hw, 8, 7, 14]); }
            if (mono) { monorail(T, mono, 21, hw, rng); paths.push([mono, 2.5, 16, 25]); }

            for (let i = i0; i <= i1 + 1; i++) for (let j = j0; j <= j1; j++) {
                if (lm && i === 0 && (j === -1 || j === 0) || wet(j)) continue;
                const a = j * B + widthY(j) / 2, b = (j + 1) * B - widthY(j + 1) / 2, w = widthX(i);
                if (!visible(i * B - w / 2, a, i * B + w / 2, b, 8)) continue;
                street(T, 1, i * B, a, b, w, new PG.RNG(hash(seed, i, j, 21)));
            }
            for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1; i++) {
                if (lm && j === 0 && (i === -1 || i === 0) || R && j > R.j && j < R.j + R.rows) continue;
                const a = i * B + widthX(i) / 2, b = (i + 1) * B - widthX(i + 1) / 2, w = widthY(j);
                if (!visible(a, j * B - w / 2, b, j * B + w / 2, 8)) continue;
                street(T, 0, j * B, a, b, w, new PG.RNG(hash(seed, i, j, 22)));
            }

            if (R) {
                const rrng = new PG.RNG(hash(seed, 43));
                riverBanks(T, R, rrng);
                for (const [x, h, style, brng] of R.bridges) if (visible(x - h, R.y0, x + h, R.y1, 30)) riverBridge(T, R, x, h * 2, style, brng);
                riverTraffic(T, R, rrng);
            }

            skybridges(T, lots, rng, transitLines);
            for (const f of T.cranes) withBase(T, 0.2, () => quiet(S, f));
            if (p.heli) {
                // over whichever helipad sits nearest the middle of the page, if it's clear above
                const hrng = new PG.RNG(hash(seed, 37)), mid = q => Math.hypot(q[0] - W / 2, q[1] - H * 0.45);
                const pads = T.pads.map(q => [q, cam.project(q[0], q[1], q[2])]).filter(([, q]) => q[0] > W * 0.1 && q[0] < W * 0.9 && q[1] > H * 0.15 && q[1] < H * 0.9).sort((a, b) => mid(a[1]) - mid(b[1]));
                for (const [[x, y, z]] of pads) {
                    const hz = z + hrng.range(10, 16), hx = x + hrng.range(-4, 4), hy = y + hrng.range(-4, 4);
                    let top = 0;
                    for (let dx = -8; dx <= 8; dx += 4) for (let dy = -8; dy <= 8; dy += 4) top = Math.max(top, T.solids.top(hx + dx, hy + dy));
                    if (top > hz - 5) continue;
                    helicopter(T, hx, hy, hz, hrng.range(0, TAU), hrng);
                    break;
                }
            }
            if (p.airship) {
                // high over one side of the page, clear of the tallest roof under it
                const arng = new PG.RNG(hash(seed, 31)), len = arng.range(55, 68), sg = arng.chance(0.5) ? -1 : 1, lx = cam.project(0, 0, 0)[0];
                const sx = lm ? lx + sg * Math.max(W * 0.26, lm.R * k * 0.75 + len * k * 0.5 + 4) : W * (0.5 + sg * 0.26), sy = H * arng.range(0.1, 0.2);
                let z = p.height * 1.3 + 20, q = cam.ground(sx, sy, z);
                for (let tries = 0; tries < 6; tries++) {
                    let top = 0;
                    for (let dx = -30; dx <= 30; dx += 6) for (let dy = -30; dy <= 30; dy += 6) top = Math.max(top, T.solids.top(q[0] + dx, q[1] + dy));
                    if (top < z - 14) break;
                    z = top + 16;
                    q = cam.ground(sx, sy, z);
                }
                airship(T, q[0], q[1], z, len, Math.atan2(cam.ry, cam.rx) + arng.range(-0.4, 0.4) + (arng.chance(0.5) ? Math.PI : 0), arng);
            }
            cables(T, rng, paths);
            // street shadows sparser than the walls, or the whole ground goes grey
            if (p.shadows) { S.kind = SHADE; S.hatchShadows(Math.max(1.2, p.gap * 2.8)); }
            return PG.pens.renderScene('skyline', S, p);
        },
    });
})();
