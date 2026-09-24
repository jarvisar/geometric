/*
 * L-systems (Lindenmayer; Prusinkiewicz & Lindenmayer, "The Algorithmic
 * Beauty of Plants", 1990) drawn with turtle graphics. The string is expanded
 * lazily, depth first, so it never has to be held in memory; the iteration
 * count is clamped so the expansion stays below ~2M symbols / 400k strokes.
 *
 * Turtle: F G A B draw a unit step, f moves with the pen up, + − turn by the
 * angle, | turns 180°, [ ] push / pop the state; any other letter is only a
 * rewriting variable. Headings are kept as integer multiples of the angle so
 * straight runs collapse into single segments; corners can then be rounded
 * with a fixed radius (a fraction of the step), which turns space-filling
 * curves into flowing, maze-like ribbons.
 */
(function () {
    'use strict';
    const { geo } = PG;
    const D = Math.PI / 180;

    const PRESETS = {
        hilbert: { name: 'Hilbert curve', axiom: 'X', rules: { X: '+YF-XFX-FY+', Y: '-XF+YFY+FX-' }, angle: 90, iter: 6 },
        moore: { name: 'Moore curve', axiom: 'LFL+F+LFL', rules: { L: '-RF+LFL+FR-', R: '+LF-RFR-FL+' }, angle: 90, iter: 5 },
        peano: { name: 'Peano curve', axiom: 'X', rules: { X: 'XFYFX+F+YFXFY-F-XFYFX', Y: 'YFXFY-F-XFYFX+F+YFXFY' }, angle: 90, iter: 4 },
        sierpinskiCurve: { name: 'Sierpiński curve', axiom: 'F+XF+F+XF', rules: { X: 'XF-F+F-XF+F+XF-F+F-X' }, angle: 90, iter: 4 },
        gosper: { name: 'Gosper flowsnake', axiom: 'A', rules: { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' }, angle: 60, iter: 4 },
        koch: { name: 'Koch snowflake', axiom: 'F--F--F', rules: { F: 'F+F--F+F' }, angle: 60, iter: 5 },
        kochIsland: { name: 'Quadratic Koch island', axiom: 'F-F-F-F', rules: { F: 'F-F+F+FF-F-F+F' }, angle: 90, iter: 3 },
        pentigree: { name: 'Pentigree', axiom: 'F-F-F-F-F', rules: { F: 'F-F++F+F-F-F' }, angle: 72, iter: 4 },
        kolam: { name: 'Kolam (Anklets of Krishna)', axiom: '-X--X', rules: { X: 'XFX--XFX' }, angle: 45, iter: 5 },
        quadGosper: {
            name: 'Quadratic Gosper', axiom: '-YF', angle: 90, iter: 2,
            rules: {
                X: 'XFX-YF-YF+FX+FX-YF-YFFX+YF+FXFXYF-FX+YF+FXFX+YF-FXYF-YF-FX+FX+YFYF-',
                Y: '+FXFX-YF-YF+FX+FXYF+FX-YFYF-FX-YF+FXYFYF-FX-YFFX+FX+YF-YF-FX+FX+YFY',
            },
        },
        arrowhead: { name: 'Sierpiński arrowhead', axiom: 'A', rules: { A: 'B-A-B', B: 'A+B+A' }, angle: 60, iter: 7 },
        sierpinski: { name: 'Sierpiński triangle', axiom: 'F-G-G', rules: { F: 'F-G+F+G-F', G: 'GG' }, angle: 120, iter: 6 },
        dragon: { name: 'Heighway dragon', axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, iter: 13 },
        levy: { name: 'Lévy C curve', axiom: 'F', rules: { F: '+F--F+' }, angle: 45, iter: 13, dedupe: true }, // self-overlapping
        terdragon: { name: 'Terdragon', axiom: 'F', rules: { F: 'F+F-F' }, angle: 120, iter: 8 },
        plant: { name: 'Fractal plant', axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, iter: 6, heading: -90 },
        bush: { name: 'Bush', axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22.5, iter: 4, heading: -90 },
        penrose: {
            name: 'Penrose tiling (P3)', axiom: '[N]++[N]++[N]++[N]++[N]', angle: 36, iter: 5, dedupe: true,
            rules: { M: 'OF++PF----NF[-OF----MF]++', N: '+OF--PF[---MF--NF]+', O: '-MF++NF[+++OF++PF]-', P: '--OF++++MF[+PF++++NF]--NF', F: '' },
        },
    };
    const DRAW = { F: 1, G: 1, A: 1, B: 1 };
    const MAX_LEN = 2e6, MAX_DRAW = 4e5;

    function parseRules(text) {
        const rules = {};
        for (const part of String(text || '').split(/[;,\n]+/)) {
            const m = part.match(/^\s*(\S)\s*(?:=|->|:|→)\s*(\S*)\s*$/);
            if (m) rules[m[1]] = m[2];
        }
        return rules;
    }

    // Largest iteration count ≤ want whose expansion stays within the limits.
    function clampIterations(axiom, rules, want) {
        let counts = {};
        for (const ch of axiom) counts[ch] = (counts[ch] || 0) + 1;
        for (let k = 0; k < want; k++) {
            const next = {};
            let len = 0, draw = 0;
            for (const ch in counts) {
                const body = rules[ch] !== undefined ? rules[ch] : ch;
                for (const d of body) {
                    next[d] = (next[d] || 0) + counts[ch];
                    len += counts[ch];
                    if (DRAW[d]) draw += counts[ch];
                }
            }
            if (len > MAX_LEN || draw > MAX_DRAW) return k;
            counts = next;
        }
        return want;
    }

    // Round every corner with a quadratic curve that starts `r` before and ends `r` after it.
    function roundPath(path, r) {
        if (r <= 0 || path.length < 3) return path;
        const n = path.length;
        const closed = geo.dist(path[0], path[n - 1]) < 1e-6;
        const pts = closed ? path.slice(0, -1) : path;
        const m = pts.length;
        const out = [];
        if (!closed) out.push(pts[0]);
        for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
            const P = pts[(i - 1 + m) % m], V = pts[i], Q = pts[(i + 1) % m];
            const L1 = geo.dist(P, V), L2 = geo.dist(V, Q);
            const d = Math.min(r, L1 / 2, L2 / 2);
            const A = geo.lerpPt(V, P, d / L1), B = geo.lerpPt(V, Q, d / L2);
            const turn = Math.acos(geo.clamp(((V[0] - P[0]) * (Q[0] - V[0]) + (V[1] - P[1]) * (Q[1] - V[1])) / (L1 * L2), -1, 1));
            const steps = Math.max(2, Math.ceil(turn / (Math.PI / 16)));
            for (let k = 0; k <= steps; k++) {
                const t = k / steps, u = 1 - t;
                out.push([u * u * A[0] + 2 * u * t * V[0] + t * t * B[0], u * u * A[1] + 2 * u * t * V[1] + t * t * B[1]]);
            }
        }
        if (closed) out.push(out[0].slice());
        else out.push(pts[m - 1]);
        return out;
    }

    const presetOptions = Object.entries(PRESETS).map(([k, v]) => [k, v.name]).concat([['custom', 'Custom…']]);

    PG.register({
        id: 'lsystem',
        name: 'L-System',
        category: 'Tiles',
        description: 'Space-filling curves, fractals and plants from string-rewriting turtle graphics.',
        fit: true,
        params: [
            { type: 'section', label: 'System' },
            { id: 'preset', label: 'Preset', type: 'select', value: 'hilbert', options: presetOptions,
                random: Object.keys(PRESETS) },
            { id: 'iterations', label: 'Iterations (0 = auto)', type: 'range', min: 0, max: 16, step: 1, value: 0, random: false,
                hint: '0 uses a good default for the preset; large values are clamped to keep the drawing plottable' },
            { id: 'axiom', label: 'Axiom', type: 'text', value: 'F+F+F+F', show: p => p.preset === 'custom' },
            { id: 'rules', label: 'Rules', type: 'text', value: 'F=F+F-F-FF+F+F-F', show: p => p.preset === 'custom',
                hint: 'e.g. X=+YF-XFX-FY+; Y=-XF+YFY+FX-   (F G A B draw, f moves, + - turn, | reverses, [ ] branch)' },
            { id: 'customAngle', label: 'Angle°', type: 'range', min: 1, max: 180, step: 0.5, value: 90, random: false,
                show: p => p.preset === 'custom' },
            { type: 'section', label: 'Shape' },
            { id: 'round', label: 'Corner rounding', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.5, random: false,
                hint: 'Fraction of a step eaten by each rounded corner' },
            { id: 'tweak', label: 'Angle tweak°', type: 'range', min: -20, max: 20, step: 0.25, value: 0, random: false,
                hint: 'Added to the turn angle — distorts the figure into new forms' },
            { id: 'jitter', label: 'Angle jitter°', type: 'range', min: 0, max: 15, step: 0.5, value: 0, random: false,
                hint: 'Random variation per turn (organic plants)' },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false,
                hint: 'Branching systems colour by branch depth; curves are split into consecutive stretches' },
        ],

        randomize(rng, p) {
            const pr = PRESETS[p.preset];
            const branching = pr && /\[/.test(Object.values(pr.rules).join('') + pr.axiom);
            return {
                iterations: rng.chance(0.75) || !pr ? 0 : Math.max(1, pr.iter - 1),
                round: branching ? 0 : rng.pick([0, 0.2, 0.35, 0.5, 0.5]),
                tweak: rng.chance(0.75) || p.preset === 'penrose' ? 0 : +(rng.sign() * rng.range(0.5, 3.5)).toFixed(1),
                jitter: branching && rng.chance(0.6) ? +rng.range(2, 8).toFixed(1) : 0,
            };
        },

        generate(p, ctx) {
            const { rng } = ctx;
            let axiom, rules, angle, want, heading0 = 0, dedupe;
            const pr = PRESETS[p.preset];
            if (pr) {
                ({ axiom, rules, angle } = pr);
                want = p.iterations > 0 ? p.iterations : pr.iter;
                heading0 = (pr.heading || 0) * D;
                dedupe = !!pr.dedupe || /\[/.test(axiom + Object.values(rules).join('')); // branches can retrace
            } else {
                axiom = String(p.axiom || 'F');
                rules = parseRules(p.rules);
                angle = p.customAngle;
                want = p.iterations > 0 ? p.iterations : 4;
                dedupe = true;
            }
            const iters = clampIterations(axiom, rules, Math.min(16, want));
            const delta = (angle + p.tweak) * D;
            const jit = p.jitter * D;

            // turtle state; heading = h·delta + flip·π + drift (drift only with jitter)
            let x = 0, y = 0, h = 0, flip = 0, drift = 0, depth = 0;
            const stack = [];
            const paths = []; // { pts, depth }
            let cur = null, lastH = null;
            const seen = dedupe ? new Set() : null;
            const key = (ax, ay, bx, by) => {
                const a = `${Math.round(ax * 1e4)},${Math.round(ay * 1e4)}`, b = `${Math.round(bx * 1e4)},${Math.round(by * 1e4)}`;
                return a < b ? a + '|' + b : b + '|' + a;
            };
            const endPath = () => { if (cur && cur.pts.length > 1) paths.push(cur); cur = null; lastH = null; };
            const turn = s => { h += s; if (jit) drift += (rng.random() * 2 - 1) * jit; };

            const act = ch => {
                if (DRAW[ch]) {
                    const a = heading0 + h * delta + flip * Math.PI + drift;
                    const nx = x + Math.cos(a), ny = y + Math.sin(a);
                    if (seen) {
                        const k = key(x, y, nx, ny);
                        if (seen.has(k)) { endPath(); x = nx; y = ny; return; }
                        seen.add(k);
                    }
                    const hk = jit ? null : h * 2 + flip;
                    if (!cur) cur = { pts: [[x, y]], depth };
                    if (hk !== null && hk === lastH) cur.pts[cur.pts.length - 1] = [nx, ny];
                    else cur.pts.push([nx, ny]);
                    lastH = hk;
                    x = nx; y = ny;
                } else if (ch === 'f') {
                    const a = heading0 + h * delta + flip * Math.PI + drift;
                    endPath();
                    x += Math.cos(a); y += Math.sin(a);
                } else if (ch === '+') turn(1);
                else if (ch === '-') turn(-1);
                else if (ch === '|') { flip ^= 1; lastH = null; }
                else if (ch === '[') {
                    stack.push([x, y, h, flip, drift, depth]);
                    depth++;
                    if (p.pens > 1) endPath();
                } else if (ch === ']') {
                    if (!stack.length) return;
                    endPath();
                    [x, y, h, flip, drift, depth] = stack.pop();
                }
            };

            // lazy depth-first expansion: frames of [string, index, level]
            const frames = [[axiom, 0, 0]];
            while (frames.length) {
                const f = frames[frames.length - 1];
                if (f[1] >= f[0].length) { frames.pop(); continue; }
                const ch = f[0][f[1]++];
                if (f[2] < iters && rules[ch] !== undefined) frames.push([rules[ch], 0, f[2] + 1]);
                else act(ch);
            }
            endPath();

            const r = geo.clamp(p.round, 0, 0.5);
            const out = paths.map(q => ({ pts: roundPath(q.pts, r), depth: q.depth }));
            const pens = Math.max(1, p.pens | 0);
            if (pens === 1) return out.map(q => q.pts);
            const layers = Array.from({ length: pens }, () => []);
            const maxDepth = out.reduce((m, q) => Math.max(m, q.depth), 0);
            if (maxDepth > 0) {
                // split the depth range so each pen draws a similar amount of line
                const perDepth = new Array(maxDepth + 1).fill(0);
                for (const q of out) perDepth[q.depth] += geo.pathLength(q.pts);
                const total = perDepth.reduce((s, v) => s + v, 0);
                const penOf = [];
                let acc = 0;
                perDepth.forEach((len, d) => { penOf[d] = Math.min(pens - 1, Math.floor(((acc + len / 2) / total) * pens)); acc += len; });
                for (const q of out) layers[penOf[q.depth]].push(q.pts);
            } else {
                // one long curve: hand consecutive stretches to successive pens
                const total = out.reduce((s, q) => s + q.pts.length, 0);
                let acc = 0;
                for (const q of out) {
                    if (out.length === 1) { geo.splitPath(q.pts, pens).forEach((piece, i) => layers[i].push(piece)); break; }
                    layers[Math.min(pens - 1, Math.floor((acc / total) * pens))].push(q.pts);
                    acc += q.pts.length;
                }
            }
            return { layers };
        },
    });
})();
