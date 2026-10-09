#!/usr/bin/env node
// Overlap removal: small hand-made cases, random strokes checked by brute force, then every design
// with it turned on.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SRC = path.resolve(__dirname, '../src');
const load = file => vm.runInThisContext(fs.readFileSync(path.join(SRC, file), 'utf8'), { filename: file });
['core', 'pens', 'noise', 'contours', 'iso', 'isokit', 'optimize', 'pipeline', 'loader'].forEach(n => load(`lib/${n}.js`));
PG.GENERATOR_FILES.forEach(id => load(`generators/${id}.js`));
const O = PG.optimize, len = ps => ps.reduce((n, p) => n + PG.geo.pathLength(p), 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, `${msg}: ${a} vs ${b}`);

// 0.35 mm pen, skip only what's fully inked, keep overlaps under 1 mm
const w = 0.35, minRun = 1;
const cut = (paths, cover = 1) => O.overlaps(paths, w, cover, minRun);
const line = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];

let r = cut([line(0, 0, 20, 0), line(0, 0, 20, 0)]);
assert.equal(r.paths.length, 1, 'exact duplicate is dropped');
near(r.removed, 20, 'duplicate length');
assert.equal(cut([line(0, 0, 20, 0), line(0, 0.02, 20, 0.02)]).paths.length, 1, 'near duplicate is dropped');

// A line a third of a pen width off is mostly on ink, but its far edge isn't
assert.equal(cut([line(0, 0, 20, 0), line(0, 0.1, 20, 0.1)]).paths.length, 2, 'half covered line stays at 100%');
assert.equal(cut([line(0, 0, 20, 0), line(0, 0.08, 20, 0.08)], 0.75).paths.length, 1, 'mostly covered line goes at 75%');
assert.equal(cut([line(0, 0, 20, 0), line(0, 0.25, 20, 0.25)], 0.5).paths.length, 2, 'line under half covered stays at 50%');

// Dense hatching: the middle line is covered by its two neighbors together
r = cut([line(0, 0, 20, 0), line(0, 0.3, 20, 0.3), line(1, 0.15, 19, 0.15)]);
assert.equal(r.paths.length, 2, 'line covered by two neighbors is dropped');

const cross = [line(0, 0, 20, 0), line(10, -10, 10, 10), line(0, -5, 20, 5)];
r = cut(cross);
assert.equal(r.paths.length, 3, 'crossings never lift the pen');
r.paths.forEach((p, i) => assert.equal(p, cross[i], 'untouched strokes come back as the same array'));

// short stroke repeating the middle of a long one, then running off on its own
r = cut([line(0, 0, 40, 0), [[10, 0], [20, 0], [20, 10]]]);
assert.equal(r.paths.length, 2);
near(r.removed, 10, 'shared stretch');
assert.equal(r.paths[0].length, 2, 'the long line stays whole');
near(PG.geo.pathLength(r.paths[1]), 10, 'the new part stays');

// longest first: the repeat goes even when it comes first
r = cut([line(10, 0, 20, 0), line(0, 0, 40, 0)]);
assert.equal(r.paths.length, 1);
near(PG.geo.pathLength(r.paths[0]), 40, 'long line kept');

// a stroke repeated in the middle by another one splits in two
r = cut([line(0, 0, 40, 0), [[0, 5], [10, 5], [10, 0], [25, 0], [25, -5], [40, -5]]]);
assert.equal(r.paths.length, 3);
near(r.removed, 15, 'middle overlap');

// doubling back on itself
r = cut([[[0, 0], [20, 0], [20, 0.02], [5, 0.02]]]);
assert.equal(r.paths.length, 1);
assert.ok(r.removed > 14, `hairpin return is dropped: ${r.removed}`);

// closed loops and sharp corners don't see themselves
const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const zigzag = [[0, 0], [5, 3], [10, 0], [15, 3], [20, 0]];
const spike = [[0, 0], [10, 1], [0, 2]];
r = cut([square, zigzag.map(([x, y]) => [x, y + 20]), spike.map(([x, y]) => [x + 30, y])]);
assert.equal(r.paths.length, 3);
assert.equal(r.removed, 0, 'no self overlap');

// overlaps shorter than minRun stay
r = cut([line(0, 0, 40, 0), [[10, 5], [10, 0], [10.5, 0], [10.5, 5]]]);
assert.equal(r.paths.length, 2);
assert.equal(r.removed, 0, 'short touch stays');

// Random walks on a 1 mm lattice, some nudged off it, so lots of strokes share or nearly share
// lines. Checked by brute force: no kept stroke may lie on another kept stroke's ink for longer
// than minRun. Only the later of the two was checked against the other, so one of the directions
// has to pass.
const segDist = (q, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
};
// Same samples as the code, a hair stricter so float noise at the edge can't fail the check
const reach = w / 2 - 0.002, inner = w / 2 - Math.min(w * 0.1, 0.05);
const onInk = (p, other) => {
    let best = 0, run = 0;
    for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i], L = PG.geo.dist(a, b), n = Math.max(1, Math.ceil(L / 0.01));
        const ux = (a[1] - b[1]) / L, uy = (b[0] - a[0]) / L;
        for (let j = 0; j < n; j++) {
            const x = a[0] + (b[0] - a[0]) * (j + 0.5) / n, y = a[1] + (b[1] - a[1]) * (j + 0.5) / n;
            let covered = true;
            for (let k = -8; k <= 8 && covered; k++) {
                const q = [x + ux * k / 8 * inner, y + uy * k / 8 * inner];
                let d = Infinity;
                for (let s = 1; s < other.length && d > reach; s++) d = Math.min(d, segDist(q, other[s - 1], other[s]));
                covered = d <= reach;
            }
            run = covered ? run + L / n : 0;
            best = Math.max(best, run);
        }
    }
    return best;
};
let randomRemoved = 0;
for (let trial = 0; trial < 4; trial++) {
    const rng = new PG.RNG(trial + 1), strokes = [];
    for (let i = 0; i < 120; i++) {
        const nudge = () => rng.pick([0, 0, 0, 0, 0.01, -0.02, 0.05, 0.12, -0.2]);
        const ox = nudge(), oy = nudge();
        let x = rng.int(0, 12), y = rng.int(0, 12);
        const p = [[x + ox, y + oy]];
        for (let s = rng.int(1, 5); s > 0; s--) {
            if (rng.chance(0.5)) x += rng.pick([-4, -3, -2, -1, 1, 2, 3, 4]); else y += rng.pick([-4, -3, -2, -1, 1, 2, 3, 4]);
            p.push([x + ox, y + oy]);
        }
        strokes.push(p);
    }
    const res = cut(strokes);
    near(len(res.paths) + res.removed, len(strokes), `random ${trial} drawn + removed`);
    randomRemoved += res.removed;
    // Runs are found in pieces a quarter pen width long, so either end can be a piece out
    const limit = minRun + w / 2 + 0.02;
    for (let i = 0; i < res.paths.length; i++) for (let j = i + 1; j < res.paths.length; j++) {
        const A = res.paths[i], B = res.paths[j];
        const shared = Math.min(onInk(A, B), onInk(B, A));
        assert.ok(shared < limit, `random ${trial}: kept strokes share ${shared.toFixed(2)} mm\n  ${JSON.stringify(A)}\n  ${JSON.stringify(B)}`);
    }
}
assert.ok(randomRemoved > 100, `random strokes have overlaps to remove: ${randomRemoved}`);
console.log('Overlap cases pass');

const settings = { seed: 1, paperW: 210, paperH: 297, margin: 15, scale: 100, rotate: 0, clip: 'rect',
    opt: { merge: true, mergeTol: 0.1, sort: true, simplify: true, simplifyTol: 0.02 } };
let failures = 0, total = 0, worst = ['', 0];
for (const def of PG.generators) {
    try {
        const params = PG.defaultParams(def);
        const before = PG.run(def, params, settings);
        for (const pct of [100, 50]) {
            const on = { ...settings, opt: { ...settings.opt, overlap: true, overlapPct: pct, overlapMin: 1 }, penWidths: Array(8).fill(0.5) };
            const after = PG.run(def, params, on);
            assert.ok(after.overlap, 'removed lengths are reported');
            for (const layer of after.layers) {
                for (const p of layer.paths) for (const [x, y] of p) {
                    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'non-finite point');
                    assert.ok(x >= 15 - 1e-6 && x <= 195 + 1e-6 && y >= 15 - 1e-6 && y <= 282 + 1e-6, 'point outside margins');
                }
                const was = before.layers.find(l => l.pen === layer.pen);
                assert.ok(was, 'no new pens');
                near(len(layer.paths) + after.overlap[layer.pen], len(was.paths), `${pct}% pen ${layer.pen + 1} drawn + removed`);
                if (pct === 100) total += after.overlap[layer.pen];
            }
            const ms = after.timing.optimize - before.timing.optimize;
            if (ms > worst[1]) worst = [`${def.id} at ${pct}%`, ms];
        }
    } catch (err) {
        failures++;
        console.error(`FAIL ${def.id}: ${err.message}`);
    }
}
if (failures) { console.error(`${failures} designs failed`); process.exit(1); }
console.log(`All ${PG.generators.length} designs pass with overlap removal (${(total / 1000).toFixed(1)} m of 0.5 mm ink skipped at 100%), slowest ${worst[0]} at +${Math.round(worst[1])} ms`);
