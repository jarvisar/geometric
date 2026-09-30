/* An inhabited skyline of stepped towers, service roofs and elevated streets. */
(function () {
    'use strict';
    const { geo, TAU } = PG;
    const { Scene, makeCamera, frame, hash, segments } = PG.iso;
    const { wall, pane, door, roundTree, person, turned } = PG.isokit;
    const INK = 0, GLASS = 1, SHADE = 2, GOLD = 3, GARDEN = 4, BRIDGE = 5, LIFE = 6, ROOF = 7;
    function tower(T, B, rng) {
        const { S, p } = T, F = frame(B.x, B.y, 0, 0), levels = B.style === 'steps' ? 3 : 1;
        let last = 0;
        for (let tier = 0; tier < levels; tier++) {
            const w = B.w * (1 - tier * 0.2), d = B.d * (1 - tier * 0.18), top = B.h * (tier + 1) / levels;
            S.kind = INK;
            S.box(F, -w / 2, -d / 2, last, w / 2, d / 2, top);
            const fp = [-w / 2, -d / 2, w / 2, d / 2];
            for (let side = 0; side < 4; side++) {
                const W = wall(F, side, fp);
                if (!T.sees(W.n)) continue;
                const floors = Math.max(1, Math.floor((top - last) / 3.4)), step = (top - last) / floors;
                if (B.style === 'glass') {
                    S.kind = GLASS;
                    for (let s = 0.7; s < W.len - 0.3; s += 1.5) S.line([W.at(s, last + 0.3), W.at(s, top - 0.3)]);
                    S.kind = INK;
                    for (let f = 1; f <= floors; f++) S.line([W.at(0, last + f * step - 0.35), W.at(W.len, last + f * step - 0.35)]);
                } else {
                    const n = Math.max(2, Math.floor(W.len / 2.6)), pitch = W.len / n;
                    for (let f = 0; f < floors; f++) for (let j = 0; j < n; j++) {
                        const s = (j + 0.5) * pitch - 0.52, z = last + f * step + 1;
                        S.kind = INK;
                        pane(T, W.at, s, z, 1.05, Math.min(1.65, step - 1.1), 'split');
                        if (rng.chance(0.15)) {
                            S.kind = GOLD;
                            S.line([W.at(s + 0.27, z + 0.12), W.at(s + 0.27, z + 1.35)]);
                            S.line([W.at(s + 0.73, z + 0.12), W.at(s + 0.73, z + 1.35)]);
                        }
                    }
                    S.kind = INK;
                    if (p.detail) for (let f = 1; f < floors; f++) S.line([W.at(0.1, last + f * step), W.at(W.len - 0.1, last + f * step)]);
                }
                if (tier === 0 && side === 0) { S.kind = INK; door(T, W.at, W.len / 2, 0, 2, 2.8, true); }
            }
            S.kind = INK;
            S.box(F, -w / 2 - 0.35, -d / 2 - 0.35, top, w / 2 + 0.35, d / 2 + 0.35, top + 0.65);
            S.kind = ROOF;
            S.loop([F.P(-w / 2 + 0.7, -d / 2 + 0.7, top + 0.66), F.P(w / 2 - 0.7, -d / 2 + 0.7, top + 0.66), F.P(w / 2 - 0.7, d / 2 - 0.7, top + 0.66), F.P(-w / 2 + 0.7, d / 2 - 0.7, top + 0.66)]);
            if (tier + 1 < levels) {
                if (p.gardens) {
                    S.kind = GARDEN;
                    for (const x of [-w * 0.36, w * 0.36]) roundTree(T, B.x + x, B.y - d * 0.36, top + 0.7, rng);
                }
                S.kind = LIFE;
                person(T, B.x, B.y - d * 0.44, top + 0.7, rng);
            }
            last = top + 0.65;
        }
        const w = B.w * (levels === 3 ? 0.6 : 1), d = B.d * (levels === 3 ? 0.64 : 1), z = B.h + 0.7;
        S.kind = ROOF;
        S.box(F, -w * 0.25, -d * 0.12, z, w * 0.12, d * 0.2, z + 2.5);
        for (let a = -w * 0.25 + 0.4; a < w * 0.12; a += 0.6) S.line([F.P(a, -d * 0.12, z + 0.3), F.P(a, -d * 0.12, z + 2.2)]);
        if (p.detail && rng.chance(0.45)) {
            S.kind = INK;
            S.lathe(B.x + w * 0.24, B.y + d * 0.22, [[1.4, z + 0.6], [1.4, z + 3.5], [0, z + 4.1]], 10);
            for (const a of [0, 1, 2, 3]) {
                const t = a * Math.PI / 2;
                S.line([[B.x + Math.cos(t), B.y + Math.sin(t), z], [B.x + Math.cos(t), B.y + Math.sin(t), z + 0.6]].map(q => [q[0] + w * 0.24, q[1] + d * 0.22, q[2]]));
            }
        }
        if (rng.chance(p.antennas)) {
            const x = -w * 0.26, y = d * 0.25, height = rng.range(6, 15);
            S.kind = GOLD;
            S.line([F.P(x, y, z), F.P(x, y, z + height)]);
            for (const s of [-1, 1]) S.line([F.P(x + s, y, z), F.P(x, y, z + height)]);
            for (let h = 2; h < height - 1; h += 2) S.line([F.P(x - (1 - h / height), y, z + h), F.P(x + (1 - h / height), y, z + h + 1)]);
            for (const h of [0.6, 0.8]) S.line([F.P(x - 2, y, z + height * h), F.P(x + 2, y, z + height * h)]);
        }
        if (p.gardens && B.style !== 'steps' && rng.chance(0.45)) {
            S.kind = GARDEN;
            for (const x of [-0.28, 0.28]) roundTree(T, B.x + w * x, B.y - d * 0.32, z, rng);
        }
        S.kind = LIFE;
        person(T, B.x + w * 0.3, B.y - d * 0.27, z, rng);
    }
    function landmark(T, B) {
        const { S } = T, r = B.w * 0.55, levels = 12, sides = 12;
        const radius = t => r * (0.78 + 0.3 * Math.sin(Math.PI * t) - 0.65 * t ** 4);
        S.kind = INK;
        S.lathe(B.x, B.y, Array.from({ length: levels + 1 }, (_, j) => [radius(j / levels), B.h * j / levels]), sides, false, Math.PI / 12);
        for (let j = 0; j < levels; j++) for (let i = 0; i < sides; i++) {
            const a = TAU * i / sides + Math.PI / 12, b = TAU * (i + 1) / sides + Math.PI / 12;
            const t = j / levels, u = (j + 1) / levels;
            const p0 = [B.x + radius(t) * Math.cos(a), B.y + radius(t) * Math.sin(a), B.h * t];
            const p1 = [B.x + radius(u) * Math.cos(b), B.y + radius(u) * Math.sin(b), B.h * u];
            S.kind = GLASS;
            S.line([p0, p1]);
        }
        S.kind = GOLD;
        S.line([[B.x, B.y, B.h], [B.x, B.y, B.h + 12]]);
    }
    PG.register({
        id: 'skyline', name: 'Skyline District', category: 'Scenes', fit: false,
        description: 'A dense city of glass towers, stepped terraces, skybridges and rooftop gardens, with a faceted landmark at its heart.',
        params: [
            { type: 'section', label: 'City' },
            { id: 'scale', label: 'Scale (mm per m)', type: 'range', min: 0.7, max: 2.5, step: 0.05, value: 1.2, random: [1, 1.6] },
            { id: 'block', label: 'Block spacing (m)', type: 'range', min: 24, max: 45, step: 1, value: 31, random: [28, 35] },
            { id: 'height', label: 'Tower height (m)', type: 'range', min: 25, max: 100, step: 1, value: 62, random: [42, 78] },
            { id: 'variety', label: 'Height variety', type: 'range', min: 0, max: 1, step: 0.05, value: 0.8, random: [0.45, 0.9] },
            { id: 'landmark', label: 'Central landmark', type: 'checkbox', value: true },
            { type: 'section', label: 'Architecture' },
            { id: 'bridges', label: 'Skybridges', type: 'range', min: 0, max: 1, step: 0.05, value: 0.48, random: [0.2, 0.7] },
            { id: 'antennas', label: 'Rooftop antennas', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6, random: [0.3, 0.85] },
            { id: 'gardens', label: 'Roof gardens', type: 'checkbox', value: true },
            { id: 'detail', label: 'Facade & roof details', type: 'checkbox', value: true },
            { id: 'shadows', label: 'Street shadows', type: 'checkbox', value: true },
            { type: 'section', label: 'View' },
            { id: 'yaw', label: 'Turn (°)', type: 'range', min: 20, max: 70, step: 1, value: 38, random: [30, 55] },
            { id: 'elev', label: 'View height (°)', type: 'range', min: 25, max: 65, step: 1, value: 42, random: [36, 50] },
            { type: 'section', label: 'Pens' }, { id: 'pens' },
        ],
        generate(p, ctx) {
            const { width: W, height: H } = ctx;
            const k = Math.max(p.scale, Math.sqrt(W * H / 180) / p.block), cam = makeCamera(p.yaw, p.elev, k, W, H, 0, 0);
            const S = new Scene(cam, W, H), maxHeight = p.height * 1.4 + 16;
            const corners = [0, maxHeight].flatMap(z => [[0, 0], [W, 0], [W, H], [0, H]].map(q => cam.ground(...q, z)));
            const loX = Math.floor(Math.min(...corners.map(q => q[0])) / p.block) - 1, hiX = Math.ceil(Math.max(...corners.map(q => q[0])) / p.block) + 1;
            const loY = Math.floor(Math.min(...corners.map(q => q[1])) / p.block) - 1, hiY = Math.ceil(Math.max(...corners.map(q => q[1])) / p.block) + 1;
            const T = { S, cam, p, k, detail: p.detail, sees: n => cam.facing(...n), segs: r => segments(r, k), picket: Math.max(0.45, 0.75 / k) };
            if (p.shadows) { S.sun = [0.45, -0.6]; S.shadowGroup(0.05, null, Math.atan2(cam.ry, cam.rx)); }
            const blocks = new Map();
            for (let j = loY; j <= hiY; j++) for (let i = loX; i <= hiX; i++) {
                const rng = new PG.RNG(hash(ctx.seed, i, j, 812));
                const B = { x: i * p.block, y: j * p.block, w: p.block * rng.range(0.48, 0.64), d: p.block * rng.range(0.45, 0.65),
                    h: p.height * geo.lerp(0.78, rng.range(0.28, 1.12), p.variety), style: rng.pick(['glass', 'steps', 'stone']) };
                // Move the landmark slightly forward so its crown sits within the page.
                if (p.landmark && i === 0 && j === -1) { B.h = p.height * 1.35; B.special = true; }
                const projected = [0, B.h + 16].flatMap(z => [-B.w / 2, B.w / 2].flatMap(x => [-B.d / 2, B.d / 2].map(y => cam.project(B.x + x, B.y + y, z))));
                if (!S.onPage(projected)) continue;
                blocks.set(`${i},${j}`, B);
                S.kind = INK;
                const F = frame(B.x, B.y, 0, 0);
                S.box(F, -B.w / 2 - 1.4, -B.d / 2 - 1.4, 0, B.w / 2 + 1.4, B.d / 2 + 1.4, 0.6);
                if (B.special) landmark(T, B); else tower(T, B, rng);
                if (rng.chance(0.32)) {
                    S.kind = LIFE;
                    person(T, B.x - B.w / 2 - 2.2, B.y - B.d * 0.3, 0.1, rng);
                    person(T, B.x - B.w / 2 - 2.8, B.y - B.d * 0.3 - 1.5, 0.1, rng);
                }
            }
            for (let j = loY; j <= hiY; j++) for (let i = loX; i <= hiX; i++) {
                const A = blocks.get(`${i},${j}`);
                if (!A) continue;
                const rng = new PG.RNG(hash(ctx.seed, i, j, 913));
                for (const [di, dj] of [[1, 0], [0, 1]]) {
                    const B = blocks.get(`${i + di},${j + dj}`);
                    if (!B || A.special || B.special || !rng.chance(p.bridges)) continue;
                    const z = Math.min(A.h, B.h) * rng.range(0.32, 0.52), F = turned((A.x + B.x) / 2, (A.y + B.y) / 2, z, dj ? Math.PI / 2 : 0);
                    S.kind = BRIDGE;
                    S.box(F, -p.block / 2, -1.3, 0, p.block / 2, 1.3, 0.6);
                    for (const side of [-1, 1]) {
                        S.line([F.P(-p.block / 2, side * 1.3, 2.3), F.P(p.block / 2, side * 1.3, 2.3)]);
                        for (let x = -p.block / 2; x <= p.block / 2; x += 2.6) S.line([F.P(x, side * 1.3, 0.6), F.P(x, side * 1.3, 2.3)]);
                    }
                }
            }
            S.kind = ROOF;
            for (let i = loX; i <= hiX; i++) {
                const x = (i + 0.5) * p.block;
                for (let y = loY * p.block; y < hiY * p.block; y += 4) S.line([[x, y, 0.12], [x, y + 1.6, 0.12]]);
                for (const o of [-3.8, 3.8]) S.line([[x + o, loY * p.block, 0.1], [x + o, hiY * p.block, 0.1]]);
            }
            for (let j = loY; j <= hiY; j++) {
                const y = (j + 0.5) * p.block;
                for (const o of [-3.8, 3.8]) S.line([[loX * p.block, y + o, 0.1], [hiX * p.block, y + o, 0.1]]);
            }
            if (p.shadows) { S.kind = SHADE; S.hatchShadows(1.15); }
            return PG.pens.renderScene('skyline', S, p);
        },
    });
})();
