/*
 * Plotter Geometry — application UI.
 *
 * state (persisted) -> PG.run (generate + place + clip + optimise) -> result
 * result -> canvas preview / SVG and PNG export
 */
(function () {
    'use strict';

    // ------------------------------------------------------------------ utils

    const $ = (sel, root = document) => root.querySelector(sel);
    const SVGNS = 'http://www.w3.org/2000/svg';

    function el(tag, attrs, ...kids) {
        const e = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v === undefined || v === null || v === false) continue;
                if (k === 'class') e.className = v;
                else if (k === 'text') e.textContent = v;
                else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
                else if (v === true) e.setAttribute(k, '');
                else e.setAttribute(k, v);
            }
        }
        for (const k of kids.flat()) {
            if (k === null || k === undefined || k === false) continue;
            e.append(k.nodeType ? k : document.createTextNode(String(k)));
        }
        return e;
    }

    function icon(name) {
        const s = document.createElementNS(SVGNS, 'svg');
        s.setAttribute('class', 'ic');
        const u = document.createElementNS(SVGNS, 'use');
        u.setAttribute('href', `#i-${name}`);
        s.append(u);
        return s;
    }

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const decimalsOf = step => (String(step).split('.')[1] || '').length;
    const fmtNum = (v, step) => (+v).toFixed(Math.min(4, decimalsOf(step || 1)));
    const fmtMM = v => (Math.round(v * 10) / 10).toString();

    function fmtCount(n) {
        if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e4) return `${Math.round(n / 1000)}k`;
        if (n >= 1e3) return `${(n / 1000).toFixed(1)}k`;
        return String(n);
    }

    const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
    function setPath(obj, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], obj)[last] = value;
    }

    function b64encode(text) {
        let bin = '';
        for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64decode(text) {
        const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    }

    const randomSeed = () => 1 + Math.floor(Math.random() * 999998);

    function storageGet(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }

    function toast(msg, isError) {
        const t = el('div', { class: 'toast' + (isError ? ' error' : ''), text: msg });
        $('#toasts').append(t);
        setTimeout(() => t.remove(), isError ? 5000 : 2400);
    }

    function download(name, data, type) {
        const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ------------------------------------------------------------------ constants

    const STORAGE_KEY = 'plotter-geometry:state:v1';
    const SNAPS_KEY = 'plotter-geometry:snapshots:v1';
    // Scenes stay out of the gallery until unlocked (Konami code, or 6 quick clicks on the logo)
    const SCENES_KEY = 'plotter-geometry:scenes:v1';
    let scenesUnlocked = storageGet(SCENES_KEY) === true;
    const listedGenerators = () => PG.generators.filter(g => scenesUnlocked || g.category !== 'Scenes');
    const MM_PER_CSS_PX = 25.4 / 96;

    const PAPERS = PG.settings.papers;
    const PEN_SETS = PG.pens.sets;
    const defaultState = PG.settings.defaults;

    // ------------------------------------------------------------------ state

    let state = defaultState();
    let result = null;
    let lastGenMs = 0;
    const preview = new PG.PreviewQueue();
    // Every request gets a version. A drawing only goes up if it's newer than the one on screen.
    let generationVersion = 0, shownVersion = 0, resultKey = '';
    const waiters = [];

    const currentDef = () => PG.byId[state.gen] || PG.generators[0];

    // Params for a design, with defaults filled in place (controls hold on to this object).
    function currentParams(def = currentDef()) {
        const p = state.params[def.id] || (state.params[def.id] = {});
        PG.pens.migrate(def, p);
        for (const q of def.params) if (q.id && !(q.id in p)) p[q.id] = q.value;
        return p;
    }

    function applyPaperSize() {
        const P = state.paper;
        if (P.size === 'custom') return;
        let e = PAPERS.find(x => x[0] === P.size);
        if (!e) { e = PAPERS[2]; P.size = e[0]; }
        P.w = P.landscape ? e[2] : e[1];
        P.h = P.landscape ? e[1] : e[2];
    }

    function paperLabel() {
        const P = state.paper;
        return `${P.size === 'custom' ? 'Custom' : P.size} · ${fmtMM(P.w)} × ${fmtMM(P.h)} mm`;
    }

    function pipelineSettings(s = state) {
        const c = s.comp;
        return {
            seed: s.seed, paperW: s.paper.w, paperH: s.paper.h, margin: s.paper.margin,
            scale: c.scale, rotate: c.rotate, offsetX: c.offsetX, offsetY: c.offsetY, clip: c.clip,
            frame: c.frame, framePen: c.framePen, frameInset: c.frameInset, opt: s.opt,
            cols: c.cols, rows: c.rows, gutter: c.gutter, cellVary: c.cellVary, locks: s.locks[s.gen] || [],
            sweep: c.sweepId ? { id: c.sweepId, amount: c.sweepAmount / 100 } : null,
        };
    }

    function constrainLayout(s = state) {
        const L = PG.layoutSizes(pipelineSettings(s));
        s.paper.margin = L.m;
        s.comp.cols = L.cols; s.comp.rows = L.rows; s.comp.gutter = L.gutter;
        if (s === state) {
            for (const key of ['paper.margin', 'comp.cols', 'comp.rows', 'comp.gutter']) {
                const row = $(`[data-key="${key}"]`);
                if (row) row.sync();
            }
            const badge = $('[data-sec="grid"] .badge');
            if (badge) badge.textContent = L.cols * L.rows > 1 ? `${L.cols} × ${L.rows}` : 'off';
            const controls = $('[data-sec="grid"] .controls');
            if (controls) updateVisibility(controls, s);
        }
    }

    // What travels in share links, exported SVGs and settings files.
    function shareable() {
        const def = currentDef();
        return JSON.parse(JSON.stringify({
            app: 'plotter-geometry', v: 3, gen: def.id, params: { [def.id]: currentParams(def) }, seed: state.seed,
            images: state.images[def.id] ? { [def.id]: state.images[def.id] } : {},
            paper: state.paper, comp: state.comp, locks: state.locks[def.id] || [],
            pens: state.pens, opt: state.opt, view: state.view,
        }));
    }

    function sharedState(obj) {
        const next = PG.settings.read(obj);
        next.params = { ...state.params, ...next.params };
        next.locks = { ...state.locks, ...next.locks };
        next.ui = state.ui;
        constrainLayout(next);
        return next;
    }

    let restoreVersion = 0;
    async function restoreShared(obj) {
        const version = ++restoreVersion, before = JSON.stringify({ ...state, ui: undefined });
        const next = sharedState(obj);
        await PG.images.unpack(next, obj.assets);
        next.images = { ...state.images, ...next.images, [next.gen]: next.images[next.gen] || {} };
        const runner = new PG.GenerationRunner();
        let nextResult;
        try { nextResult = await runner.run({ ...generationJob(next), motion: true }); }
        finally { runner.dispose(); }
        if (version !== restoreVersion || before !== JSON.stringify({ ...state, ui: undefined })) throw new Error('Settings changed while loading. Try again.');
        const previous = { state, result, lastGenMs, resultKey };
        clearTimeout(commitTimer);
        pushUndo();
        try {
            state = next;
            result = nextResult;
            resultKey = geometryKey(next);
            lastGenMs = nextResult.timing.total;
            rebuildAll();
        } catch (err) {
            ({ state, result, lastGenMs, resultKey } = previous);
            rebuildAll();
            throw err;
        }
        // Preview jobs still running for the old settings finish, but their versions are now too old to show
        preview.drop();
        cachePut(resultKey, result);
        clearTimeout(genTimer);
        genTimer = 0;
        setError(null);
        settle(++generationVersion);
        renderStats();
        renderPenUsage();
        beginTransition(previous.result);
        draw();
        commit();
        scheduleSave();
    }

    let saveTimer = 0;
    function saveNow() {
        clearTimeout(saveTimer);
        saveTimer = 0;
        return storageSet(STORAGE_KEY, state);
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 300);
    }

    // ------------------------------------------------------------------ undo / redo

    const undoStack = { items: [], index: -1 };
    let commitTimer = 0;

    // Locks stay out of undo, otherwise undoing a randomize also unlocks whatever was locked since the last step.
    function snapshotForUndo() {
        const s = Object.assign({}, state);
        delete s.ui; delete s.view; delete s.locks;
        return JSON.stringify(s);
    }
    function commit() {
        clearTimeout(commitTimer);
        commitTimer = setTimeout(pushUndo, 250);
    }
    function pushUndo() {
        const snap = snapshotForUndo();
        if (undoStack.items[undoStack.index] === snap) return;
        undoStack.items.length = undoStack.index + 1;
        undoStack.items.push(snap);
        if (undoStack.items.length > 200) undoStack.items.shift();
        undoStack.index = undoStack.items.length - 1;
        updateUndoButtons();
        scheduleSave();
    }
    function restoreUndo(i) {
        if (i < 0 || i >= undoStack.items.length) return;
        const keep = { ui: state.ui, view: state.view, locks: state.locks };
        state = PG.settings.read(JSON.parse(undoStack.items[i]), true);
        Object.assign(state, keep);
        undoStack.index = i;
        rebuildAll();
        requestGenerate();
        updateUndoButtons();
        scheduleSave();
    }
    const undo = () => { clearTimeout(commitTimer); pushUndo(); restoreUndo(undoStack.index - 1); };
    const redo = () => restoreUndo(undoStack.index + 1);
    function updateUndoButtons() {
        $('#undo').disabled = undoStack.index <= 0;
        $('#redo').disabled = undoStack.index >= undoStack.items.length - 1;
    }

    // ------------------------------------------------------------------ generation

    let genTimer = 0;

    function geometryKey(s = state) {
        return JSON.stringify([s.gen, s.params[s.gen], pipelineSettings(s), s.images[s.gen] || {}]);
    }
    function generationJob(s = state) {
        return { gen: s.gen, params: structuredClone(s.params[s.gen]), settings: structuredClone(pipelineSettings(s)), images: PG.images.get(s) };
    }

    // The last drawing stays up while the next one generates. live is set while dragging a slider.
    function requestGenerate(live) {
        clearTimeout(genTimer);
        generationVersion++;
        constrainLayout();
        setBusy(true);
        // Redrawing a big scene takes tens of ms, too slow to repeat on every slider tick for nothing
        if (lookKey() !== drawnLook) draw();
        scheduleSave();
        genTimer = setTimeout(() => generate(live, false), 0);
    }

    // Startup and scripted checks (plotterApp.regenerate) always generate again.
    function regenerate() {
        clearTimeout(genTimer);
        generationVersion++;
        return generate(false, true);
    }

    // Resolves once the drawing for this version or a newer one is up, or the newest one failed.
    function generate(live, force) {
        genTimer = 0;
        const version = generationVersion;
        const done = new Promise(resolve => waiters.push({ version, resolve }));
        const def = currentDef();
        if (!def) {
            settle(version);
            return done;
        }
        currentParams(def);
        constrainLayout();
        const key = geometryKey();
        let job = null, failure = null;
        // generationJob throws when a saved photo is missing, which should show up like any failed run
        try { job = generationJob(); } catch (err) { failure = err; }
        if (!failure && !force) {
            // e.g. letting go of a slider at the value that's already drawn
            if (key === resultKey) {
                settle(version);
                return done;
            }
            const hit = cacheGet(key);
            if (hit) {
                preview.drop();
                present(hit, key, version);
                return done;
            }
        }
        setBusy(true);
        const run = failure ? Promise.reject(failure) : preview.run({ ...job, motion: true }, { live, key: force ? null : key });
        run.then(next => {
            if (!next || version <= shownVersion) return;
            // Requests for the same settings share a job, and the first one already put it up
            if (next === result) {
                settle(version);
                return;
            }
            present(next, key, version);
        }, err => {
            if (err.name === 'AbortError' || version !== generationVersion) return;
            setError(`${def.name}: ${err.message}`);
            const prev = result;
            result = null;
            resultKey = '';
            showResult(version, prev);
        });
        return done;
    }

    function present(next, key, version) {
        cachePut(key, next);
        const prev = result;
        result = next;
        resultKey = key;
        lastGenMs = next.timing.total;
        setError(null);
        showResult(version, prev);
    }

    function showResult(version, prev) {
        settle(version);
        renderStats();
        renderPenUsage();
        beginTransition(prev);
        draw();
        scheduleSave();
    }

    // Recent drawings by geometry key, so dragging back over a value, undo and redo put them up
    // without generating again. Limited by the size of their flat geometry.
    const CACHE_BYTES = 64 * 1024 * 1024;
    const resultCache = new Map();
    let cacheBytes = 0;
    const sizeOf = r => r.packed.xy.byteLength + (r.motion ? r.motion.xy.byteLength : 0);
    function cacheGet(key) {
        const r = resultCache.get(key);
        if (r) { resultCache.delete(key); resultCache.set(key, r); }
        return r;
    }
    function cachePut(key, r) {
        if (!r.packed || resultCache.has(key)) return;
        resultCache.set(key, r);
        cacheBytes += sizeOf(r);
        for (const [k, old] of resultCache) {
            if (cacheBytes <= CACHE_BYTES || old === r) break;
            resultCache.delete(k);
            cacheBytes -= sizeOf(old);
        }
    }

    // Anything older than a version that's up won't be shown, so its waiters are done too.
    function settle(version) {
        shownVersion = Math.max(shownVersion, version);
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].version <= shownVersion) waiters.splice(i, 1)[0].resolve();
        }
        if (shownVersion >= generationVersion) setBusy(false);
    }

    const hiddenPens = () => new Set(state.pens.map((p, i) => (p.visible ? -1 : i)).filter(i => i >= 0));
    // Per-pen stats come with the result, so the stats bar never rebuilds the nested paths
    const layerStats = r => r.layerStats || r.layers.map(l => Object.assign({ pen: l.pen }, PG.optimize.stats([l])));

    function setBusy(on) { $('#busy').hidden = !on; }
    function setError(msg) {
        const e = $('#errorMsg');
        e.hidden = !msg;
        e.textContent = msg || '';
    }

    // ------------------------------------------------------------------ stats

    function renderStats() {
        const bar = $('#stats');
        bar.innerHTML = '';
        if (!result) return;
        const hidden = hiddenPens();
        const vis = layerStats(result).filter(l => !hidden.has(l.pen));
        const paths = vis.reduce((n, l) => n + l.paths, 0), points = vis.reduce((n, l) => n + l.points, 0);
        const stat = (cls, ...kids) => el('span', { class: 'stat ' + (cls || '') }, ...kids);
        const items = [
            stat('', el('b', { text: fmtCount(paths) }), paths === 1 ? 'path' : 'paths'),
            stat('', el('b', { text: fmtCount(points) }), 'points'),
            vis.length > 1 ? stat('', el('b', { text: vis.length }), 'pens') : null,
            stat('dim', `${Math.round(lastGenMs)} ms`),
        ];
        bar.append(...items.filter(Boolean));
    }

    // ------------------------------------------------------------------ canvas view

    const canvas = $('#view');
    const stage = $('#stage');
    const view = { zoom: 1, panX: 0, panY: 0 };
    let dpr = 1, cw = 0, ch = 0;
    let padTop = 62, padBottom = 72;

    function resizeCanvas() {
        const r = stage.getBoundingClientRect();
        if (!r.width || !r.height) return;
        dpr = window.devicePixelRatio || 1;
        cw = r.width; ch = r.height;
        // Keep the paper clear of the floating toolbar and stats (the layout hides them on small screens).
        const tools = $('.stage-tools');
        padTop = tools.offsetParent ? tools.getBoundingClientRect().bottom - r.top + 16 : 16;
        padBottom = $('#stats').offsetParent ? 72 : 30;
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        if (glLines) glLines.resize(canvas.width, canvas.height);
        draw();
    }

    function viewTransform() {
        const P = state.paper;
        const availH = ch - padTop - padBottom;
        const fit = Math.max(0.05, Math.min((cw - 48) / P.w, availH / P.h));
        const s = fit * view.zoom;
        const ox = cw / 2 - (P.w / 2) * s + view.panX;
        const oy = padTop + availH / 2 - (P.h / 2) * s + view.panY;
        return { scale: s * dpr, ox: ox * dpr, oy: oy * dpr, css: { s, ox, oy } };
    }

    function drawPaper(ctx, v) {
        const P = state.paper;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 28 * dpr;
        ctx.shadowOffsetY = 8 * dpr;
        ctx.fillStyle = P.color;
        ctx.fillRect(v.ox, v.oy, P.w * v.scale, P.h * v.scale);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
        ctx.font = `${11 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText(paperLabel(), v.ox + (P.w * v.scale) / 2, v.oy + P.h * v.scale + 17 * dpr);
        ctx.restore();
    }

    // Everything draw() shows apart from the geometry. requestGenerate only redraws when this changed.
    let drawnLook = '';
    function lookKey() {
        const { margin, ...paper } = state.paper;
        return JSON.stringify([paper, state.pens, state.view.margin, state.view.penWidth]);
    }

    // With WebGL2 the lines go on a second canvas over this one (lib/gl.js). Canvas2D is the fallback.
    const glLines = PG.GLLines ? PG.GLLines.create($('#lines')) : null;
    const useGL = () => !!glLines && glLines.ok;

    // While the paper size changes, the last drawing is scaled onto the new sheet until its replacement is in
    function placement(area, v) {
        const P = state.paper, pw = area.x * 2 + area.w, ph = area.y * 2 + area.h;
        const k = Math.min(P.w / pw, P.h / ph);
        return { scale: v.scale * k, ox: v.ox + ((P.w - pw * k) / 2) * v.scale, oy: v.oy + ((P.h - ph * k) / 2) * v.scale };
    }

    function draw() {
        if (!cw) return;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const v = viewTransform();
        drawPaper(ctx, v);
        if (result && state.view.margin) {
            PG.drawResult(ctx, { layers: [], outlines: result.outlines }, placement(result.area, v), { paper: state.paper, showMargin: true });
        }
        drawLines(v);
        drawnLook = lookKey();
        $('#zoomLabel').textContent = `${Math.round(v.css.s * MM_PER_CSS_PX * 100)}%`;
    }

    // Transition frames only redraw the lines. On the Canvas2D fallback that means the whole canvas.
    function drawLines(v = viewTransform()) {
        const items = frameItems(performance.now());
        const opts = { pens: state.pens, hidden: hiddenPens(), minLinePx: 0.8 * dpr, hairline: !state.view.penWidth };
        if (useGL()) {
            const clip = { x: v.ox, y: v.oy, w: state.paper.w * v.scale, h: state.paper.h * v.scale };
            glLines.draw(items.map(it => ({ ...it, transform: placement(it.area, v) })), { ...opts, clip });
        } else {
            const ctx = canvas.getContext('2d');
            for (const it of items) {
                if (it.opacity > 0) PG.drawResult(ctx, { layers: paths2d(it) }, placement(it.area, v), { ...opts, alpha: it.opacity });
            }
        }
        if (trans && !transFrame) transFrame = requestAnimationFrame(stepTransition);
    }

    // Canvas2D fallback: Path2D layers for an item. The last couple of static ones are kept.
    const paths2dMemo = new Map();
    function paths2d(it) {
        if (it.xy2) return PG.pathLayers(it.geo, lerpPoints(it.xy, it.xy2, it.t));
        let layers = paths2dMemo.get(it.xy);
        if (!layers) {
            paths2dMemo.set(it.xy, (layers = PG.pathLayers(it.geo, it.xy)));
            if (paths2dMemo.size > 2) paths2dMemo.delete(paths2dMemo.keys().next().value);
        }
        return layers;
    }

    // ---- transitions
    // A new drawing morphs from the last one when both have the same paths (most curves while
    // dragging, some Randomize results), otherwise it crossfades. Morphs use the unoptimised
    // geometry from the worker and the real drawing goes up when they end.
    //
    // Each lasts as long as the time since the last drawing. Dragging a fast design already
    // changes it every frame, and a long transition there just smears it. One that's still
    // running keeps at least the time it had left, so a drawing landing right after another
    // doesn't cut it off.
    const FADE_MS = 150, MORPH_MS = 220;
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
    let trans = null, transFrame = 0, lastShownAt = 0;

    const itemOf = (r, opacity = 1) => {
        if (!r.packed) r.packed = PG.packLayers(r.layers);
        return { geo: r.packed, xy: r.packed.xy, area: r.area, opacity };
    };
    const progress = (tr, now) => Math.min(1, Math.max(0, (now - tr.start) / tr.dur));
    const smooth = t => t * t * (3 - 2 * t);
    function lerpPoints(a, b, t) {
        const out = new Float64Array(b.length);
        for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
        return out;
    }

    // What's on the paper at this moment, as items to draw in order.
    function frameItems(now) {
        if (trans && (progress(trans, now) >= 1 || (trans.kind === 'morph' && !result))) trans = null;
        if (!trans) return result ? [itemOf(result)] : [];
        const t = progress(trans, now);
        if (trans.kind === 'morph') {
            return [{ geo: trans.geo, xy: trans.from, xy2: trans.to, t: trans.steady ? t : smooth(t), area: result.area, opacity: 1 }];
        }
        const items = trans.from.map(f => ({ ...f, opacity: f.opacity * (1 - t) }));
        if (result) items.push(itemOf(result, t));
        return items;
    }

    // Call right before draw() puts up a new drawing. prev is the drawing it replaces.
    function beginTransition(prev) {
        const now = performance.now();
        const since = now - lastShownAt, left = trans ? trans.start + trans.dur - now : 0;
        const running = trans && progress(trans, now) < 1 ? trans : null;
        // What's on screen becomes the start of the next transition. Mid-fade the drawing that was
        // fading in keeps the strength it had got to, and at most two older ones stay behind it.
        let shown = [];
        if (running && running.kind === 'morph' && prev) {
            const t = progress(running, now);
            shown = [{ geo: running.geo, xy: lerpPoints(running.from, running.to, running.steady ? t : smooth(t)), area: prev.area, opacity: 1 }];
        } else if (running) {
            const t = progress(running, now);
            shown = running.from.map(f => ({ ...f, opacity: f.opacity * (1 - t) }));
            if (prev) shown.push(itemOf(prev, t));
            shown = shown.filter(f => f.opacity > 0.02).slice(-3);
        } else if (prev) shown = [itemOf(prev)];
        lastShownAt = now;
        trans = null;
        if (!cw || REDUCED_MOTION.matches) return;
        const morphDur = Math.max(Math.min(MORPH_MS, since), left);
        if (morphDur >= 34 && beginMorph(prev, running, shown, morphDur, now)) return;
        const dur = Math.max(Math.min(FADE_MS, since), left);
        if (dur >= 34 && (shown.length || result)) trans = { kind: 'fade', from: shown, start: now, dur };
    }

    const paperOf = r => `${r.area.x * 2 + r.area.w}x${r.area.y * 2 + r.area.h}`;
    function sameShape(a, b) {
        if (a.pens.length !== b.pens.length || a.ends.length !== b.ends.length) return false;
        for (let i = 0; i < a.pens.length; i++) if (a.pens[i] !== b.pens[i] || a.layerEnds[i] !== b.layerEnds[i]) return false;
        return true;
    }

    // Arc length resample of path s..e (point indices) of xy to n points.
    function resample(xy, s, e, n, out, at) {
        const m = e - s;
        if (m < 2) {
            for (let i = 0; i < n; i++) { out[(at + i) * 2] = xy[s * 2]; out[(at + i) * 2 + 1] = xy[s * 2 + 1]; }
            return;
        }
        const cum = new Float64Array(m);
        for (let i = 1; i < m; i++) {
            const a = (s + i - 1) * 2, b = (s + i) * 2;
            cum[i] = cum[i - 1] + Math.hypot(xy[b] - xy[a], xy[b + 1] - xy[a + 1]);
        }
        const L = cum[m - 1];
        let j = 1;
        for (let i = 0; i < n; i++) {
            const d = n > 1 ? (i / (n - 1)) * L : 0;
            while (j < m - 1 && cum[j] < d) j++;
            const t = cum[j] > cum[j - 1] ? (d - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
            const a = (s + j - 1) * 2, b = (s + j) * 2;
            out[(at + i) * 2] = xy[a] + (xy[b] - xy[a]) * t;
            out[(at + i) * 2 + 1] = xy[a + 1] + (xy[b + 1] - xy[a + 1]) * t;
        }
    }

    // Line up two drawings with the same paths point for point. Paths whose point counts differ
    // are both resampled to the larger count.
    function align(a, aXY, b) {
        let same = true;
        for (let i = 0; i < a.ends.length && same; i++) same = a.ends[i] === b.ends[i];
        if (same) return { shape: b, from: aXY, to: b.xy };
        const ends = new Uint32Array(a.ends.length);
        let total = 0;
        for (let i = 0; i < a.ends.length; i++) {
            total += Math.max(a.ends[i] - (i ? a.ends[i - 1] : 0), b.ends[i] - (i ? b.ends[i - 1] : 0));
            ends[i] = total;
        }
        const from = new Float64Array(total * 2), to = new Float64Array(total * 2);
        for (let i = 0; i < ends.length; i++) {
            const at = i ? ends[i - 1] : 0, n = ends[i] - at;
            resample(aXY, i ? a.ends[i - 1] : 0, a.ends[i], n, from, at);
            resample(b.xy, i ? b.ends[i - 1] : 0, b.ends[i], n, to, at);
        }
        return { shape: { pens: b.pens, layerEnds: b.layerEnds, ends }, from, to };
    }

    // Starts a morph to the current result, or returns false when it needs a crossfade instead.
    function beginMorph(prev, running, shown, dur, now) {
        const next = result;
        if (!prev || !next || !next.motion || prev.gen !== next.gen || paperOf(prev) !== paperOf(next)) return false;
        // A morph that's still running carries on from wherever it has got to
        const chained = !!running && running.kind === 'morph';
        const base = chained ? { geo: running.geo, xy: shown[0].xy } : prev.motion && { geo: prev.motion, xy: prev.motion.xy };
        if (!base || !sameShape(base.geo, next.motion)) return false;
        const { shape, from, to } = align(base.geo, base.xy, next.motion);
        // Chained morphs while dragging move at a steady speed, a single one eases in and out
        trans = { kind: 'morph', geo: shape, from, to, start: now, dur, steady: chained };
        return true;
    }

    function stepTransition() {
        transFrame = 0;
        if (!trans) return;
        if (!cw) { trans = null; return; }
        if (useGL()) drawLines(); else draw();
    }

    function fitView() {
        view.zoom = 1; view.panX = 0; view.panY = 0;
        draw();
    }

    function zoomAt(x, y, factor) {
        const before = viewTransform().css;
        const px = (x - before.ox) / before.s, py = (y - before.oy) / before.s;
        view.zoom = clamp(view.zoom * factor, 0.25, 60);
        const after = viewTransform().css;
        view.panX += x - (after.ox + px * after.s);
        view.panY += y - (after.oy + py * after.s);
        draw();
    }

    function bindCanvas() {
        new ResizeObserver(resizeCanvas).observe(stage);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const r = canvas.getBoundingClientRect();
            zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
        }, { passive: false });

        const pointers = new Map();
        let pinch = null;
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            canvas.classList.add('panning');
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            }
        });
        canvas.addEventListener('pointermove', e => {
            const prev = pointers.get(e.pointerId);
            if (!prev) return;
            const cur = { x: e.clientX, y: e.clientY };
            pointers.set(e.pointerId, cur);
            if (pointers.size === 2 && pinch) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const r = canvas.getBoundingClientRect();
                view.panX += mx - pinch.x; view.panY += my - pinch.y;
                zoomAt(mx - r.left, my - r.top, d / (pinch.d || d));
                pinch = { d, x: mx, y: my };
            } else if (pointers.size === 1) {
                view.panX += cur.x - prev.x;
                view.panY += cur.y - prev.y;
                draw();
            }
        });
        const end = e => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinch = null;
            if (!pointers.size) canvas.classList.remove('panning');
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('dblclick', fitView);

        // drag & drop: images and settings files
        let dragDepth = 0;
        stage.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#dropHint').hidden = false; });
        stage.addEventListener('dragover', e => e.preventDefault());
        stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
        stage.addEventListener('drop', e => {
            e.preventDefault();
            dragDepth = 0;
            $('#dropHint').hidden = true;
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) handleDroppedFile(file);
        });
    }

    function handleDroppedFile(file) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.json') || name.endsWith('.svg') || file.type === 'image/svg+xml') {
            loadSettingsFile(file);
            return;
        }
        if (file.type.startsWith('image/')) {
            let def = currentDef();
            let q = def.params.find(p => p.type === 'image');
            if (!q && PG.byId.image) {
                state.gen = 'image';
                def = currentDef();
                q = def.params.find(p => p.type === 'image');
                designChanged();
            }
            if (q) loadImageFile(file, def.id, q.id);
            else toast('This design does not use images', true);
        }
    }

    // ------------------------------------------------------------------ controls

    // Generic control builder shared by generator params and the output panel.
    // q: { id|key, label, type, min, max, step, options, hint, multiline }
    // get(): current value; set(value, live): apply; opts: { onReset, lockable, locked, onLock }
    function makeControl(q, get, set, opts = {}) {
        const id = `c-${(q.key || q.id).replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
        const row = el('div', { class: `ctl ctl-${q.type === 'checkbox' ? 'check' : q.type}` });
        const label = el('label', { for: id, text: q.label || q.id });
        const head = el('div', { class: 'ctl-head' }, label);
        if (q.hint) head.append(el('span', { class: 'hint', title: q.hint, text: '?' }));
        if (opts.onReset) {
            label.title = (q.hint ? q.hint + '\n' : '') + 'Double-click to reset';
            label.addEventListener('dblclick', opts.onReset);
        }
        if (opts.lockable) {
            const lock = el('button', { class: 'lock-btn' + (opts.locked ? ' locked' : ''), title: 'Keep fixed when randomizing', type: 'button' });
            lock.append(icon(opts.locked ? 'lock' : 'unlock'));
            lock.addEventListener('click', () => {
                const on = opts.onLock();
                lock.classList.toggle('locked', on);
                lock.replaceChildren(icon(on ? 'lock' : 'unlock'));
            });
            head.append(lock);
        }
        row.append(head);

        const ctlRow = el('div', { class: 'ctl-row' });
        row.append(ctlRow);

        if (q.type === 'range') {
            const step = q.step || 1;
            const range = el('input', { type: 'range', id, min: q.min, max: q.max, step });
            const num = el('input', { type: 'number', class: 'num', min: q.min, max: q.max, step, 'aria-label': q.label });
            // fill from zero for signed ranges, from the left otherwise
            const zero = q.min < 0 && q.max > 0 ? ((0 - q.min) / (q.max - q.min)) * 100 : 0;
            const paint = () => {
                const at = ((range.value - q.min) / (q.max - q.min)) * 100;
                range.style.setProperty('--from', `${Math.min(zero, at)}%`);
                range.style.setProperty('--to', `${Math.max(zero, at)}%`);
            };
            row.sync = () => { range.value = get(); num.value = fmtNum(get(), step); paint(); };
            range.addEventListener('input', () => { num.value = fmtNum(range.value, step); paint(); set(+range.value, true); });
            range.addEventListener('change', () => set(+range.value, false));
            num.addEventListener('change', () => {
                // a cleared box reads as 0, so put the old value back instead of jumping to the minimum
                let v = num.value.trim() === '' ? NaN : +num.value;
                if (!isFinite(v)) v = get();
                v = PG.snap(clamp(v, q.min, q.max), step, q.min);
                range.value = v; num.value = fmtNum(v, step); paint();
                set(v, false);
            });
            ctlRow.append(range, num);
        } else if (q.type === 'select') {
            const sel = el('select', { id });
            for (const [value, text] of q.options) sel.append(el('option', { value: String(value), text }));
            row.sync = () => { sel.value = String(get()); };
            sel.addEventListener('change', () => {
                const opt = q.options.find(o => String(o[0]) === sel.value);
                set(opt ? opt[0] : sel.value, false);
            });
            ctlRow.append(sel);
        } else if (q.type === 'checkbox') {
            const box = el('input', { type: 'checkbox', id });
            row.sync = () => { box.checked = !!get(); };
            box.addEventListener('change', () => set(box.checked, false));
            // move label into the row so it sits next to the switch
            head.remove();
            ctlRow.append(head, el('span', { class: 'switch' }, box, el('span')));
            head.style.marginBottom = '0';
        } else if (q.type === 'color') {
            const input = el('input', { type: 'color', id, class: 'color-input' });
            row.sync = () => { input.value = get(); };
            input.addEventListener('input', () => set(input.value, true));
            input.addEventListener('change', () => set(input.value, false));
            head.remove();
            ctlRow.append(head, input);
            ctlRow.style.justifyContent = 'space-between';
            head.style.marginBottom = '0';
        } else if (q.type === 'text') {
            const input = q.multiline
                ? el('textarea', { id, rows: q.rows || 2, spellcheck: 'false', maxlength: 10000 })
                : el('input', { type: 'text', id, class: 'text-input', spellcheck: 'false', maxlength: 10000 });
            let t = 0;
            row.sync = () => { input.value = get(); };
            input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set(input.value, true), 450); });
            input.addEventListener('change', () => { clearTimeout(t); set(input.value, false); });
            ctlRow.append(input);
        } else if (q.type === 'image') {
            row.classList.add('image-ctl');
            const name = el('span', { class: 'file-name' });
            const pick = el('button', { class: 'btn', type: 'button', text: 'Load image…' });
            const clear = el('button', { class: 'icon-btn', type: 'button', title: 'Use the built-in demo image' }, icon('x'));
            pick.addEventListener('click', () => opts.onPickImage && opts.onPickImage());
            clear.addEventListener('click', () => opts.onClearImage && opts.onClearImage());
            row.sync = () => {
                const loaded = opts.hasImage && opts.hasImage();
                const v = get();
                name.textContent = loaded ? v || 'Saved image' : v ? `${v} (load again)` : 'Demo image — or drop one on the preview';
                clear.hidden = !loaded && !v && !opts.hasImageReference?.();
            };
            ctlRow.append(pick, name, clear);
        }
        row.sync && row.sync();
        return row;
    }

    // Hide controls whose show() is false, and section labels with nothing visible under them.
    function updateVisibility(container, values) {
        let section = null, sectionHasVisible = false;
        const finish = () => { if (section) section.hidden = !sectionHasVisible; };
        for (const node of container.children) {
            if (node.classList.contains('param-section')) {
                const body = node.querySelector('.controls');
                updateVisibility(body, values);
                node.hidden = ![...body.children].some(child => !child.hidden);
                continue;
            }
            if (node.classList.contains('section-label')) {
                finish();
                section = node;
                sectionHasVisible = false;
                continue;
            }
            if (node.showFn) node.hidden = !node.showFn(values);
            if (!node.hidden) sectionHasVisible = true;
        }
        finish();
    }

    // ---- generator parameters (left panel)

    function buildParams() {
        const def = currentDef();
        const params = currentParams(def);
        const root = $('#params');
        root.replaceChildren();
        $('#designTitle').textContent = def.name;
        $('#designDesc').textContent = def.description || '';
        $('#designName').textContent = def.name;
        $('#designCat').textContent = def.category;
        document.title = `${def.name} · Plotter Geometry`;

        const locks = new Set(state.locks[def.id] || []);
        const groups = [{ label: 'Pens', controls: def.params.filter(q => q.id === 'pens') }];
        let group = { label: 'Parameters', controls: [] };
        groups.push(group);
        for (const q of def.params) {
            if (q.type === 'section') {
                if (q.label === 'Pens') group = groups[0];
                else { group = { label: q.label, controls: [] }; groups.push(group); }
            }
            else if (q.id !== 'pens') group.controls.push(q);
        }
        for (const group of groups.filter(g => g.controls.length)) {
            const sectionKey = `${def.id}/${group.label}`;
            const det = el('details', { class: 'out-section param-section', 'data-param-section': group.label });
            det.open = !state.ui.paramClosed.includes(sectionKey);
            const summary = el('summary', {}, el('span', { text: group.label }), icon('chev'));
            const body = el('div', { class: 'controls' });
            det.append(summary, body);
            det.addEventListener('toggle', () => {
                if (!det.isConnected) return;
                if (state.ui.paramClosed.includes(sectionKey) === !det.open) return;
                const closed = new Set(state.ui.paramClosed);
                det.open ? closed.delete(sectionKey) : closed.add(sectionKey);
                state.ui.paramClosed = [...closed];
                scheduleSave();
            });
            root.append(det);
            for (const q of group.controls) {
                const row = makeControl(q, () => params[q.id], (v, live) => {
                    params[q.id] = v;
                    if (!live) commit();
                    updateVisibility(root, params);
                    requestGenerate(live);
                }, {
                    lockable: q.type !== 'image' && q.type !== 'text',
                    locked: locks.has(q.id),
                    onLock() {
                        const set = new Set(state.locks[def.id] || []);
                        set.has(q.id) ? set.delete(q.id) : set.add(q.id);
                        state.locks[def.id] = [...set];
                        scheduleSave();
                        if (isGrid(state) && state.comp.cellVary === 'params') requestGenerate();
                        return set.has(q.id);
                    },
                    // an image param only holds the file name, the x button is what drops the picture
                    onReset: q.type === 'image' ? null : () => {
                        params[q.id] = q.value;
                        row.sync();
                        commit();
                        updateVisibility(root, params);
                        requestGenerate();
                    },
                    onPickImage() { pickImage(def.id, q.id); },
                    onClearImage() {
                        imageLoadVersion++;
                        clearTimeout(commitTimer);
                        pushUndo();
                        if (state.images[def.id]) delete state.images[def.id][q.id];
                        params[q.id] = '';
                        row.sync();
                        commit();
                        requestGenerate();
                    },
                    hasImage: () => PG.images.has(state.images[def.id]?.[q.id]),
                    hasImageReference: () => !!state.images[def.id]?.[q.id],
                });
                row.dataset.param = q.id;
                if (q.show) row.showFn = q.show;
                body.append(row);
            }
        }
        updateVisibility(root, params);
    }

    // ---- images

    let pendingImageTarget = null;
    let imageLoadVersion = 0;
    function pickImage(genId, paramId) {
        pendingImageTarget = { genId, paramId };
        const input = $('#imageFile');
        input.value = '';
        input.click();
    }

    function loadImageFile(file, genId, paramId) {
        const version = ++imageLoadVersion;
        const params = currentParams(PG.byId[genId]);
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = async () => {
            try {
                const max = 900;
                const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
                const c = el('canvas', { width: w, height: h });
                const g = c.getContext('2d', { willReadFrequently: true });
                g.fillStyle = '#fff';
                g.fillRect(0, 0, w, h);
                g.drawImage(img, 0, 0, w, h);
                const px = g.getImageData(0, 0, w, h).data;
                const data = new Float32Array(w * h);
                for (let i = 0; i < w * h; i++) {
                    data[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
                }
                const key = await PG.images.put({ width: w, height: h, data });
                if (version !== imageLoadVersion || state.params[genId] !== params) return;
                clearTimeout(commitTimer);
                pushUndo();
                (state.images[genId] || (state.images[genId] = {}))[paramId] = key;
                params[paramId] = file.name;
                if (state.gen === genId) buildParams();
                commit();
                requestGenerate();
                if (saveNow()) toast(`Loaded ${file.name}`);
                else toast('Image loaded, but browser settings storage is full. Export a settings JSON to keep this drawing.', true);
            } catch (err) { toast(`Could not save image: ${err.message}`, true); }
            finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image', true); };
        img.src = url;
    }

    // ---- output panel (right)

    const penOptions = () => state.pens.map((p, i) => [i, `${i + 1} · ${p.name}`]);
    const isGrid = s => s.comp.cols * s.comp.rows > 1;

    function outputSections() {
        return [
            {
                id: 'paper', title: 'Paper', badge: paperLabel, controls: [
                    { key: 'paper.size', label: 'Size', type: 'select',
                        options: PAPERS.map(([n, w, h]) => [n, n === 'custom' ? 'Custom size' : `${n} — ${fmtMM(w)} × ${fmtMM(h)} mm`]),
                        then: () => { applyPaperSize(); fitView(); } },
                    { key: 'paper.landscape', label: 'Landscape', type: 'checkbox',
                        then: () => {
                            if (state.paper.size === 'custom') { const P = state.paper; [P.w, P.h] = [P.h, P.w]; }
                            applyPaperSize();
                            fitView();
                        } },
                    { key: 'paper.w', label: 'Width (mm)', type: 'range', min: 50, max: 1200, step: 0.5, show: s => s.paper.size === 'custom' },
                    { key: 'paper.h', label: 'Height (mm)', type: 'range', min: 50, max: 1200, step: 0.5, show: s => s.paper.size === 'custom' },
                    { key: 'paper.margin', label: 'Margin (mm)', type: 'range', min: 0, max: 80, step: 0.5 },
                    { key: 'paper.color', label: 'Paper colour (preview only)', type: 'color', effect: 'draw' },
                ],
            },
            {
                id: 'comp', title: 'Composition', controls: [
                    { key: 'comp.scale', label: 'Scale %', type: 'range', min: 10, max: 300, step: 1 },
                    { key: 'comp.rotate', label: 'Rotation°', type: 'range', min: -180, max: 180, step: 0.5 },
                    { key: 'comp.offsetX', label: 'Offset X (mm)', type: 'range', min: -150, max: 150, step: 0.5 },
                    { key: 'comp.offsetY', label: 'Offset Y (mm)', type: 'range', min: -150, max: 150, step: 0.5 },
                    { key: 'comp.clip', label: 'Crop to', type: 'select',
                        options: [['rect', 'Rectangle (margins)'], ['circle', 'Circle'], ['hexagon', 'Hexagon'], ['diamond', 'Diamond']] },
                    { key: 'comp.frame', label: 'Draw frame', type: 'checkbox' },
                    { key: 'comp.framePen', label: 'Frame pen', type: 'select', options: penOptions(), show: s => s.comp.frame },
                    { key: 'comp.frameInset', label: 'Second frame line (mm in)', type: 'range', min: 0, max: 12, step: 0.5, show: s => s.comp.frame },
                ],
            },
            {
                id: 'grid', title: 'Grid layout', badge: () => (isGrid(state) ? `${state.comp.cols} × ${state.comp.rows}` : 'off'), controls: [
                    { key: 'comp.cols', label: 'Columns', type: 'range', min: 1, max: 8, step: 1 },
                    { key: 'comp.rows', label: 'Rows', type: 'range', min: 1, max: 10, step: 1 },
                    { key: 'comp.gutter', label: 'Gutter (mm)', type: 'range', min: 0, max: 40, step: 0.5, show: isGrid },
                    { key: 'comp.cellVary', label: 'Each cell', type: 'select', show: isGrid,
                        options: [['seed', 'New seed per cell'], ['params', 'Random parameters per cell'], ['none', 'Identical']] },
                    { key: 'comp.sweepId', label: 'Sweep a parameter across cells', type: 'select', show: isGrid,
                        options: [['', 'None']].concat(currentDef().params.filter(q => q.type === 'range').map(q => [q.id, q.label || q.id])) },
                    { key: 'comp.sweepAmount', label: 'Sweep amount (% of range)', type: 'range', min: -100, max: 100, step: 1,
                        show: s => isGrid(s) && !!s.comp.sweepId },
                ],
                note: el('p', { class: 'out-note', text: 'Repeat the design on one sheet. Random parameters keep the first cell as it is and respect locked parameters; a sweep steps one parameter from cell to cell.' }),
            },
            { id: 'pens', title: 'Pens', custom: buildPensSection },
            {
                id: 'opt', title: 'Optimize', controls: [
                    { key: 'opt.merge', label: 'Join touching strokes', type: 'checkbox' },
                    { key: 'opt.mergeTol', label: 'Join tolerance (mm)', type: 'range', min: 0.01, max: 1, step: 0.01, show: s => s.opt.merge },
                    { key: 'opt.simplify', label: 'Simplify points', type: 'checkbox' },
                    { key: 'opt.simplifyTol', label: 'Simplify tolerance (mm)', type: 'range', min: 0.005, max: 0.5, step: 0.005, show: s => s.opt.simplify },
                    { key: 'opt.minLength', label: 'Drop strokes shorter than (mm)', type: 'range', min: 0, max: 5, step: 0.1 },
                ],
            },
            { id: 'snaps', title: 'Snapshots', custom: buildSnapshotsSection },
        ];
    }

    function buildOutputPanel() {
        const panel = $('#outputPanel');
        const scroll = panel.scrollTop;
        panel.replaceChildren();
        for (const sec of outputSections()) {
            const det = el('details', { class: 'out-section', 'data-sec': sec.id });
            det.open = !!state.ui.open[sec.id];
            det.addEventListener('toggle', () => { state.ui.open[sec.id] = det.open; scheduleSave(); });
            const summary = el('summary', null, el('span', { text: sec.title }));
            if (sec.badge) summary.append(el('span', { class: 'badge', text: sec.badge() }));
            summary.append(icon('chev'));
            det.append(summary);
            const body = el('div', { class: 'controls' });
            det.append(body);
            if (sec.custom) sec.custom(body);
            const rows = [];
            for (const q of sec.controls || []) {
                const row = makeControl(q, () => getPath(state, q.key), (v, live) => {
                    setPath(state, q.key, v);
                    if (q.then) {
                        q.then();
                        // e.g. paper size and orientation also change the custom width and height
                        for (const r of rows) if (r !== row) r.sync();
                    }
                    updateVisibility(body, state);
                    if (sec.badge) summary.querySelector('.badge').textContent = sec.badge();
                    applyEffect(q.effect || 'generate', live);
                    if (!live) commit();
                });
                if (q.show) row.showFn = q.show;
                row.dataset.key = q.key;
                rows.push(row);
                body.append(row);
            }
            if (sec.note) body.append(sec.note);
            updateVisibility(body, state);
            panel.append(det);
        }
        panel.scrollTop = scroll;
        renderStats();
        // the pen list has to be on the page first, it's looked up by id
        renderPenUsage();
    }

    function applyEffect(effect, live) {
        if (effect === 'generate') requestGenerate(live);
        else if (effect === 'draw') draw();
        scheduleSave();
    }

    // ---- pens

    function buildPensSection(body) {
        const sel = el('select', { 'aria-label': 'Pen set' },
            el('option', { value: '', text: 'Apply a pen set…' }),
            ...Object.entries(PEN_SETS).map(([k, v]) => el('option', { value: k, text: v.label })));
        sel.addEventListener('change', () => {
            const set = PEN_SETS[sel.value];
            if (!set) return;
            state.pens.forEach((p, i) => { p.color = set.colors[i]; });
            state.paper.color = set.paper;
            buildOutputPanel();
            draw();
            commit();
        });
        body.append(el('div', { class: 'ctl' }, sel));
        body.append(el('p', { id: 'penAssignmentHint', class: 'out-note' }));

        const list = el('div', { id: 'penList' });
        state.pens.forEach((pen, i) => {
            const eye = el('button', { class: 'eye' + (pen.visible ? '' : ' off'), type: 'button', title: 'Show / hide this pen (hidden pens are not exported)' }, icon(pen.visible ? 'eye' : 'eye-off'));
            eye.addEventListener('click', () => {
                pen.visible = !pen.visible;
                eye.classList.toggle('off', !pen.visible);
                eye.replaceChildren(icon(pen.visible ? 'eye' : 'eye-off'));
                draw();
                renderStats();
                commit();
            });
            const color = el('input', { type: 'color', class: 'color-input', value: pen.color, title: 'Pen colour' });
            color.addEventListener('input', () => { pen.color = color.value; draw(); });
            color.addEventListener('change', commit);
            const name = el('input', { class: 'pen-name', value: pen.name, spellcheck: 'false', maxlength: 200, title: 'Pen name (used for SVG layer names)' });
            name.addEventListener('change', () => {
                pen.name = name.value || `Pen ${i + 1}`;
                const opt = document.querySelector(`[data-key="comp.framePen"] option[value="${i}"]`);
                if (opt) opt.textContent = `${i + 1} · ${pen.name}`;
                commit();
            });
            const width = el('input', { type: 'number', class: 'num', min: 0.05, max: 5, step: 0.05, value: pen.width, title: 'Pen width in mm' });
            width.addEventListener('change', () => {
                pen.width = clamp(+width.value || pen.width, 0.05, 5);
                width.value = pen.width;
                syncAllWidth();
                draw();
                commit();
            });
            const meta = el('div', { class: 'pen-meta', 'data-pen': i });
            list.append(el('div', { class: 'pen-row', 'data-pen': i }, eye, color, name, width, meta));
        });
        body.append(list);

        // blank when the pens have different widths
        const allWidth = el('input', { type: 'number', class: 'num', min: 0.05, max: 5, step: 0.05, placeholder: 'mixed', title: 'Set the width of every pen in mm' });
        const syncAllWidth = () => {
            const w = state.pens[0]?.width;
            allWidth.value = state.pens.every(p => p.width === w) ? w : '';
        };
        allWidth.addEventListener('change', () => {
            if (allWidth.value === '') return syncAllWidth();
            const w = clamp(+allWidth.value || state.pens[0].width, 0.05, 5);
            state.pens.forEach(p => { p.width = w; });
            list.querySelectorAll('.pen-row .num').forEach(input => { input.value = w; });
            allWidth.value = w;
            draw();
            commit();
        });
        syncAllWidth();
        body.append(el('div', { class: 'pen-row pen-all' }, el('span'), el('span'), el('span', { class: 'pen-all-label', text: 'All pens' }), allWidth));
        body.append(el('p', { class: 'out-note', text: 'Width is in mm — the preview draws true-to-scale line widths. Each pen exports as its own Inkscape layer.' }));
    }

    function renderPenUsage() {
        const rows = document.querySelectorAll('#penList .pen-row');
        if (!rows.length) return;
        const usage = {};
        if (result) for (const l of layerStats(result)) usage[l.pen] = l;
        const def = currentDef(), params = currentParams(def);
        const roles = PG.pens.roles(def, params);
        const hint = $('#penAssignmentHint');
        if (hint) hint.textContent = PG.pens.designs[def.id]?.hint || '';
        rows.forEach(row => {
            const i = +row.dataset.pen;
            const u = usage[i];
            row.classList.toggle('unused', !u);
            const assignment = roles[i]?.join(', ');
            row.querySelector('.pen-meta').textContent = u
                ? `${assignment ? assignment + ' · ' : ''}${fmtCount(u.paths)} ${u.paths === 1 ? 'path' : 'paths'}`
                : assignment ? `${assignment} · no paths in this drawing` : 'unused at this pen count';
        });
    }

    // ---- snapshots

    function loadSnaps() {
        const snaps = storageGet(SNAPS_KEY);
        return Array.isArray(snaps) ? snaps.filter(s => s && Number.isFinite(s.time) && typeof s.title === 'string' &&
            typeof s.thumb === 'string' && s.state && typeof s.state === 'object').slice(0, 30) : [];
    }

    function buildSnapshotsSection(body) {
        const btn = el('button', { class: 'btn', type: 'button' }, icon('camera'), el('span', { text: 'Save snapshot' }));
        btn.addEventListener('click', saveSnapshot);
        body.append(el('div', { class: 'ctl' }, btn));
        const grid = el('div', { class: 'snaps', id: 'snapGrid' });
        body.append(grid);
        renderSnaps(grid);
    }

    function renderSnaps(grid = $('#snapGrid')) {
        if (!grid) return;
        grid.replaceChildren();
        const snaps = loadSnaps();
        if (!snaps.length) {
            grid.append(el('p', { class: 'snaps-empty', text: 'Snapshots keep designs you like (stored in this browser). Press S to save one.' }));
            return;
        }
        for (const s of snaps) {
            const b = el('button', { class: 'snap', type: 'button', title: `${s.title}\n${new Date(s.time).toLocaleString()}` }, el('img', { src: s.thumb, alt: s.title }));
            const del = el('span', { class: 'del', title: 'Delete snapshot' }, icon('x'));
            del.addEventListener('click', e => {
                e.stopPropagation();
                storageSet(SNAPS_KEY, loadSnaps().filter(x => x.time !== s.time));
                renderSnaps();
            });
            b.append(del);
            b.addEventListener('click', async () => {
                try {
                    await restoreShared(s.state);
                    toast(`Restored ${s.title}`);
                } catch (err) { toast(`Could not restore snapshot: ${err.message}`, true); }
            });
            grid.append(b);
        }
    }

    async function saveSnapshot() {
        let captured;
        try { captured = await captureDrawing(); }
        catch (err) { toast(`Could not save snapshot: ${err.message}`, true); return; }
        const { recipe, res } = captured;
        if (!res) return;
        const P = recipe.paper;
        const k = 160 / Math.max(P.w, P.h);
        const c = el('canvas', { width: Math.round(P.w * k * 1.5), height: Math.round(P.h * k * 1.5) });
        PG.drawResult(c.getContext('2d'), res, { scale: k * 1.5, ox: 0, oy: 0 },
            { paper: { w: P.w, h: P.h }, paperColor: P.color, pens: recipe.pens, minLinePx: 0.6, hairline: true });
        const def = PG.byId[recipe.gen];
        const snaps = loadSnaps();
        snaps.unshift({ time: Date.now(), title: `${def.name} #${recipe.seed}`, thumb: c.toDataURL('image/png'), state: recipe });
        while (snaps.length > 30) snaps.pop();
        if (!storageSet(SNAPS_KEY, snaps)) { toast('Browser storage is full — delete some snapshots', true); return; }
        state.ui.open.snaps = true;
        buildOutputPanel();
        toast('Snapshot saved');
    }

    // ------------------------------------------------------------------ gallery

    let activeDialog = null, dialogOpener = null;
    const inertBefore = new Map();
    const dialogControls = dlg => [...dlg.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    function openDialog(dlg, first) {
        if (activeDialog === dlg) return;
        if (activeDialog) closeDialog(activeDialog);
        dialogOpener = document.activeElement;
        activeDialog = dlg;
        dlg.hidden = false;
        for (const node of document.body.children) {
            if (node === dlg || ['SCRIPT', 'SVG'].includes(node.tagName)) continue;
            inertBefore.set(node, node.inert);
            node.inert = true;
        }
        (first || dialogControls(dlg)[0] || dlg).focus();
    }
    function closeDialog(dlg) {
        dlg.hidden = true;
        if (activeDialog !== dlg) return;
        activeDialog = null;
        for (const [node, inert] of inertBefore) node.inert = inert;
        inertBefore.clear();
        (dialogOpener?.isConnected && dialogOpener.getClientRects().length && !dialogOpener.disabled
            ? dialogOpener : $('#designBtn')).focus();
        dialogOpener = null;
    }

    const thumbCache = new Map();
    let thumbColors = '';
    let thumbQueue = [];
    let thumbTimer = 0;
    const thumbRunner = new PG.GenerationRunner();
    let thumbVersion = 0;

    function openGallery() {
        const g = $('#gallery');
        openDialog(g, $('#gallerySearch'));
        buildGallery();
        const search = $('#gallerySearch');
        search.value = '';
        filterGallery('');
    }
    function closeGallery() {
        closeDialog($('#gallery'));
        thumbVersion++;
        thumbRunner.dispose();
        clearTimeout(thumbTimer);
        thumbQueue = [];
    }

    function buildGallery() {
        thumbVersion++;
        thumbRunner.cancel();
        const body = $('#galleryBody');
        body.replaceChildren();
        thumbQueue = [];
        // Thumbnails use the current pen and paper colours, which can also change through undo or loaded settings
        const colors = JSON.stringify([state.paper.color, state.pens.map(p => p.color)]);
        if (colors !== thumbColors) { thumbCache.clear(); thumbColors = colors; }
        const listed = listedGenerators();
        const cats = PG.categories.concat([...new Set(listed.map(g => g.category))].filter(c => !PG.categories.includes(c)));
        for (const cat of cats) {
            const gens = listed.filter(g => g.category === cat);
            if (!gens.length) continue;
            const section = el('section', { 'data-cat': cat }, el('h3', { class: 'gallery-cat', text: cat }));
            const cards = el('div', { class: 'cards' });
            for (const def of gens) {
                const thumb = el('canvas', { class: 'thumb', width: 320, height: 320 });
                const card = el('button', { class: 'card' + (def.id === state.gen ? ' current' : ''), type: 'button', 'data-id': def.id,
                    'data-search': `${def.name} ${def.description || ''} ${def.category} ${def.id}`.toLowerCase() },
                thumb,
                el('div', { class: 'card-text' }, el('div', { class: 'card-name', text: def.name }), el('div', { class: 'card-desc', text: def.description || '' })));
                card.addEventListener('click', () => selectGenerator(def.id));
                cards.append(card);
                const cached = thumbCache.get(def.id);
                if (cached) thumb.getContext('2d').drawImage(cached, 0, 0);
                else thumbQueue.push([def, thumb]);
            }
            section.append(cards);
            body.append(section);
        }
        // Links out to my other plotter tools, not designs. Kept as plain links so they never go through selectGenerator
        const tool = el('a', { class: 'card', href: 'https://svgmap.jarvisar.com/', target: '_blank', rel: 'noopener',
            'data-search': 'svgmap svg map city street maps openstreetmap more tools' },
        el('img', { class: 'thumb', src: 'images/svgmap-square.webp', alt: '', loading: 'lazy' }),
        el('div', { class: 'card-text' }, el('div', { class: 'card-name' }, 'SVGmap ', icon('external')),
            el('div', { class: 'card-desc', text: 'Street maps of any city, for plotting or laser engraving' })));
        body.append(el('section', { 'data-cat': 'More Tools' }, el('h3', { class: 'gallery-cat', text: 'More Tools' }), el('div', { class: 'cards' }, tool)));
        pumpThumbs();
    }

    function pumpThumbs() {
        clearTimeout(thumbTimer);
        if (!thumbQueue.length) return;
        const version = thumbVersion;
        thumbTimer = setTimeout(async () => {
            const [def, canvasEl] = thumbQueue.shift();
            await renderThumb(def, canvasEl);
            if (version === thumbVersion) pumpThumbs();
        }, 16);
    }

    async function renderThumb(def, canvasEl) {
        // near-A4 scale, since fill designs size their features in real millimetres
        const size = 190;
        const S = {
            seed: 1, paperW: size, paperH: size, margin: 10, scale: 100, rotate: 0, clip: 'rect',
            opt: { simplify: true, simplifyTol: 0.05 },
        };
        const g = canvasEl.getContext('2d');
        try {
            const res = await thumbRunner.run({ gen: def.id, params: PG.defaultParams(def), settings: S, images: {} });
            const k = canvasEl.width / size;
            PG.drawResult(g, res, { scale: k, ox: 0, oy: 0 },
                { paper: { w: size, h: size }, paperColor: state.paper.color, pens: state.pens, minLinePx: 0.9, hairline: true });
        } catch (e) {
            if (e.name === 'AbortError') return;
            g.fillStyle = '#300'; g.fillRect(0, 0, canvasEl.width, canvasEl.height);
        }
        const copy = el('canvas', { width: canvasEl.width, height: canvasEl.height });
        copy.getContext('2d').drawImage(canvasEl, 0, 0);
        thumbCache.set(def.id, copy);
    }

    function filterGallery(text) {
        const t = text.trim().toLowerCase();
        document.querySelectorAll('#galleryBody section').forEach(sec => {
            let any = false;
            sec.querySelectorAll('.card').forEach(card => {
                const ok = !t || card.dataset.search.includes(t);
                card.hidden = !ok;
                if (ok) any = true;
            });
            sec.hidden = !any;
        });
    }

    function selectGenerator(id) {
        if (!PG.byId[id]) return;
        state.gen = id;
        closeGallery();
        designChanged();
        requestGenerate();
        commit();
    }

    // The sweep parameter list in the grid section depends on the design.
    function designChanged() {
        const def = currentDef();
        if (state.comp.sweepId && !def.params.some(q => q.id === state.comp.sweepId)) state.comp.sweepId = '';
        buildParams();
        buildOutputPanel();
    }

    function surprise() {
        const others = listedGenerators().filter(g => g.id !== state.gen);
        const def = others[Math.floor(Math.random() * others.length)] || currentDef();
        state.gen = def.id;
        closeGallery();
        designChanged();
        randomize();
    }

    // ------------------------------------------------------------------ actions

    function randomize() {
        const def = currentDef();
        const current = currentParams(def);
        state.params[def.id] = PG.randomParams(def, current, new PG.RNG(randomSeed() * 7919), state.locks[def.id] || []);
        state.seed = randomSeed();
        buildParams();
        syncSeed();
        requestGenerate();
        commit();
    }

    function newSeed() {
        state.seed = randomSeed();
        syncSeed();
        requestGenerate();
        commit();
    }

    // Resetting parameters keeps the current photo. Clear removes it and can be undone.
    function defaultsFor(def) {
        const p = PG.defaultParams(def);
        for (const q of def.params) if (q.type === 'image' && state.params[def.id]?.[q.id]) p[q.id] = state.params[def.id][q.id];
        return p;
    }

    function resetParams() {
        $('#resetMenu').hidden = true;
        const def = currentDef();
        state.params[def.id] = defaultsFor(def);
        buildParams();
        requestGenerate();
        commit();
    }

    // Back to a fresh start, but staying on the current design. Undo brings it all back
    // except the locks, which never go through undo.
    function resetAll() {
        $('#resetMenu').hidden = true;
        clearTimeout(commitTimer);
        pushUndo();
        const imageParams = Object.fromEntries(Object.keys(state.images).map(id => [id, defaultsFor(PG.byId[id])]));
        state = Object.assign(defaultState(), { gen: state.gen, ui: state.ui, images: state.images, params: imageParams });
        rebuildAll();
        fitView();
        requestGenerate();
        commit();
        toast('Everything reset to defaults');
    }

    function syncSeed() { $('#seed').value = state.seed; }

    function toggleView(key) {
        state.view[key] = !state.view[key];
        syncViewButtons();
        draw();
        scheduleSave();
    }
    function syncViewButtons() {
        $('#toggleMargin').classList.toggle('on', state.view.margin);
        $('#togglePenWidth').classList.toggle('on', state.view.penWidth);
    }

    // ------------------------------------------------------------------ export

    async function captureDrawing() {
        currentParams();
        constrainLayout();
        const recipe = shareable();
        let res = resultKey === geometryKey() ? result : null;
        if (!res) {
            const runner = new PG.GenerationRunner();
            try { res = await runner.run(generationJob()); }
            finally { runner.dispose(); }
        }
        res = { ...res, layers: res.layers.filter(l => recipe.pens[l.pen]?.visible) };
        return { recipe, res, base: `${recipe.gen}-${recipe.seed}` };
    }

    async function doExport(kind) {
        $('#exportMenu').hidden = true;
        if (kind === 'load') { $('#settingsFile').value = ''; $('#settingsFile').click(); return; }
        if (kind === 'install') { installApp(); return; }
        // Saving settings must also work if rendering fails or is still running.
        if (kind === 'json' || kind === 'link') {
            try {
                currentParams();
                constrainLayout();
                const recipe = shareable();
                if (kind === 'link') { copyLink(recipe); return; }
                const assets = PG.images.pack(recipe.images);
                if (Object.keys(assets).length) recipe.assets = assets;
                download(`${recipe.gen}-${recipe.seed}.json`, JSON.stringify(recipe, null, 2), 'application/json');
            } catch (err) { toast(`Could not export: ${err.message}`, true); }
            return;
        }
        let captured;
        try {
            captured = await captureDrawing();
            if (kind.startsWith('svg')) {
                const assets = PG.images.pack(captured.recipe.images);
                if (Object.keys(assets).length) captured.recipe.assets = assets;
            }
        } catch (err) { toast(`Could not export: ${err.message}`, true); return; }
        const { recipe, res, base } = captured;
        if (!res || !res.layers.length) { toast('Nothing to export', true); return; }
        const paper = { w: recipe.paper.w, h: recipe.paper.h };
        const meta = { title: `${PG.byId[recipe.gen].name} — seed ${recipe.seed}`,
            description: 'plotter-geometry:' + JSON.stringify(recipe) };
        if (kind === 'svg') {
            download(`${base}.svg`, PG.exporters.svg(res, paper, recipe.pens, meta), 'image/svg+xml');
        } else if (kind === 'svg-split') {
            res.layers.forEach((l, i) => setTimeout(() => {
                download(`${base}-pen${l.pen + 1}.svg`, PG.exporters.svg(res, paper, recipe.pens, meta, l.pen), 'image/svg+xml');
            }, i * 300));
        } else if (kind === 'png') {
            const k = 200 / 25.4;
            const c = el('canvas', { width: Math.round(paper.w * k), height: Math.round(paper.h * k) });
            PG.drawResult(c.getContext('2d'), res, { scale: k, ox: 0, oy: 0 },
                { paper, paperColor: recipe.paper.color, pens: recipe.pens, minLinePx: 1, hairline: !recipe.view.penWidth });
            // toBlob hands back null when the canvas is over the browser's size limit (big custom paper, iOS)
            c.toBlob(b => (b ? download(`${base}.png`, b) : toast('Paper is too large for a PNG export', true)));
        }
    }

    function shareUrl(recipe) {
        const base = location.href.split('#')[0];
        return `${base}#s=${b64encode(JSON.stringify(recipe))}`;
    }

    function copyLink(recipe) {
        if (Object.values(recipe.images || {}).some(refs => Object.keys(refs).length)) {
            toast('This drawing includes a photo. Export a settings JSON or SVG to share the complete drawing.', true);
            return;
        }
        const url = shareUrl(recipe);
        const done = () => toast('Share link copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, () => { window.prompt('Copy this link:', url); });
        } else {
            window.prompt('Copy this link:', url);
        }
    }

    function loadSettingsFile(file) {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                let text = String(reader.result).trim();
                if (text.startsWith('<')) {
                    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
                    const desc = doc.querySelector('desc');
                    const d = desc ? desc.textContent : '';
                    if (!d.startsWith('plotter-geometry:')) throw new Error('This SVG was not made here (no embedded settings)');
                    text = d.slice('plotter-geometry:'.length);
                }
                await restoreShared(JSON.parse(text));
                toast(`Loaded settings from ${file.name}`);
            } catch (e) {
                toast(`Could not load ${file.name}: ${e.message}`, true);
            }
        };
        reader.readAsText(file);
    }

    // ------------------------------------------------------------------ install prompt

    // Chrome / Edge / Android hand us their install prompt (beforeinstallprompt),
    // which the first-visit toast and the "Install app" menu item both use. iOS
    // Safari has no prompt, so there we explain Add to Home Screen instead.
    const INSTALL_KEY = 'plotter-geometry:install-offered:v1';
    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let installEvent = null;
    let installToast = null;

    function setupInstallPrompt() {
        let offered = !!storageGet(INSTALL_KEY) || isStandalone();
        const offer = () => {
            if (offered) return;
            offered = true;
            setTimeout(showInstallToast, 2500); // let the first drawing land first
        };
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            installEvent = e;
            offer();
        });
        window.addEventListener('appinstalled', () => {
            installEvent = null;
            storageSet(INSTALL_KEY, true);
            hideInstallToast();
            syncInstallItem();
        });
        if (isIOS() && /^https?:$/.test(location.protocol)) offer();
    }

    // The permanent entry in the export menu; hidden once running as the installed app.
    function syncInstallItem() {
        const item = $('#installItem');
        if (item) item.hidden = isStandalone();
    }

    function installApp() {
        hideInstallToast();
        if (installEvent) {
            installEvent.prompt();
            installEvent = null; // each prompt can only be shown once
        } else if (!/^https?:$/.test(location.protocol)) {
            toast('Installing needs the web version of the app', true);
        } else if (isIOS()) {
            toast('To install: tap Share, then Add to Home Screen');
        } else {
            toast('To install, use your browser menu: Install app or Add to Home Screen');
        }
    }

    // The larger toast with the logo, used for install and update offers. `action` is optional.
    function cardToast(title, text, action, onAction, onClose) {
        const logo = $('.brand .logo').cloneNode(true);
        logo.setAttribute('class', 'install-logo');
        const card = el('div', { class: 'toast install', role: 'status' }, el('span', { class: 'install-icon' }, logo),
            el('div', { class: 'install-text' }, el('b', { text: title }), el('span', { text })));
        if (action) {
            const btn = el('button', { class: 'btn accent', type: 'button', text: action });
            btn.addEventListener('click', onAction);
            card.append(btn);
        }
        const close = el('button', { class: 'icon-btn', type: 'button', title: 'Not now', 'aria-label': 'Not now' }, icon('x'));
        close.addEventListener('click', onClose);
        card.append(close);
        $('#toasts').append(card);
        return card;
    }

    function showInstallToast() {
        storageSet(INSTALL_KEY, true);
        installToast = cardToast('Install Plotter Geometry',
            installEvent ? 'Works offline, in its own window.' : 'Tap Share, then Add to Home Screen.',
            installEvent && 'Install', installApp, hideInstallToast);
        setTimeout(hideInstallToast, 20000);
    }

    function hideInstallToast() {
        if (installToast) { installToast.remove(); installToast = null; }
    }

    // ------------------------------------------------------------------ update check

    // Deploys stamp the commit into <meta name="build"> and version.json. If those stop
    // matching while the app is open, a newer deploy is live and a reload picks it up.
    // Local copies say "dev" and skip this.
    const BUILD = document.querySelector('meta[name="build"]')?.content || 'dev';
    let lastUpdateCheck = 0, updateToast = null, dismissedBuild = null;

    async function checkForUpdate() {
        if (updateToast || document.hidden || Date.now() - lastUpdateCheck < 60 * 1000) return;
        lastUpdateCheck = Date.now();
        try {
            const res = await fetch('version.json', { cache: 'no-store' });
            const { build } = res.ok ? await res.json() : {};
            if (build && build !== BUILD && build !== dismissedBuild && !updateToast) showUpdateToast(build);
        } catch (e) { /* offline */ }
    }

    function setupUpdateCheck() {
        if (BUILD === 'dev' || !/^https?:$/.test(location.protocol)) return;
        // shortly after load too, in case this page itself came from a stale cache
        setTimeout(checkForUpdate, 5000);
        setInterval(checkForUpdate, 10 * 60 * 1000);
        document.addEventListener('visibilitychange', checkForUpdate);
    }

    // Stays up until used or closed. Closing it only skips this build, a later deploy offers again.
    function showUpdateToast(build) {
        updateToast = cardToast('Update available', 'Reload to get the latest version.', 'Reload', () => location.reload(), () => {
            dismissedBuild = build;
            updateToast.remove();
            updateToast = null;
        });
    }

    // ------------------------------------------------------------------ wiring

    function rebuildAll() {
        constrainLayout();
        buildParams();
        buildOutputPanel();
        syncSeed();
        syncViewButtons();
    }

    function bindTopbar() {
        $('#designBtn').addEventListener('click', openGallery);
        $('#randomize').addEventListener('click', randomize);
        $('#newSeed').addEventListener('click', newSeed);
        $('#resetParams').addEventListener('click', resetParams);
        $('#resetMenuBtn').addEventListener('click', e => {
            e.stopPropagation();
            $('#exportMenu').hidden = true;
            $('#resetMenu').hidden = !$('#resetMenu').hidden;
        });
        $('#resetMenu').addEventListener('click', e => {
            const b = e.target.closest('button[data-reset]');
            if (b) b.dataset.reset === 'all' ? resetAll() : resetParams();
        });
        $('#undo').addEventListener('click', undo);
        $('#redo').addEventListener('click', redo);
        $('#snapshotBtn').addEventListener('click', saveSnapshot);
        $('#keysBtn').addEventListener('click', () => openDialog($('#keysDialog')));
        $('#seed').addEventListener('change', () => {
            const v = Math.floor(+$('#seed').value);
            state.seed = isFinite(v) ? clamp(v, 0, 999999999) : 1;
            syncSeed();
            requestGenerate();
            commit();
        });

        $('#exportSvg').addEventListener('click', () => doExport('svg'));
        $('#exportMenuBtn').addEventListener('click', e => {
            e.stopPropagation();
            $('#resetMenu').hidden = true;
            $('#exportMenu').hidden = !$('#exportMenu').hidden;
        });
        $('#exportMenu').addEventListener('click', e => {
            const b = e.target.closest('button[data-export]');
            if (b) doExport(b.dataset.export);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.export')) $('#exportMenu').hidden = true;
            if (!e.target.closest('.reset')) $('#resetMenu').hidden = true;
        });
        $('#settingsFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadSettingsFile(f); });
        $('#imageFile').addEventListener('change', e => {
            const f = e.target.files[0];
            if (f && pendingImageTarget) loadImageFile(f, pendingImageTarget.genId, pendingImageTarget.paramId);
        });

        $('#fitView').addEventListener('click', fitView);
        $('#toggleMargin').addEventListener('click', () => toggleView('margin'));
        $('#togglePenWidth').addEventListener('click', () => toggleView('penWidth'));

        $('#gallerySearch').addEventListener('input', e => filterGallery(e.target.value));
        $('#gallerySearch').addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const first = document.querySelector('#galleryBody .card:not([hidden])');
                if (first) first.click();
            }
        });
        $('#galleryClose').addEventListener('click', closeGallery);
        $('#surprise').addEventListener('click', surprise);
        for (const dlg of [$('#gallery'), $('#keysDialog')]) {
            dlg.addEventListener('click', e => { if (e.target === dlg) { dlg === $('#gallery') ? closeGallery() : closeDialog(dlg); } });
        }
        document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog($('#' + b.dataset.close))));

        document.querySelectorAll('#panelTabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    }

    function setTab(tab) {
        state.ui.tab = tab;
        $('#layout').dataset.tab = tab;
        document.querySelectorAll('#panelTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        if (tab === 'preview') requestAnimationFrame(resizeCanvas);
        scheduleSave();
    }

    // The phone top bar has no room for the seed and reset controls, so they move to the top of the Design panel.
    const PHONE = window.matchMedia('(max-width: 720px)');
    function placeSeedControls() {
        const seed = $('.seed-box'), reset = $('.reset');
        if (PHONE.matches) {
            $('#phoneTools').append(seed, reset);
        } else {
            $('#randomize').before(seed);
            $('#randomize').after(reset);
            // only phones have a Preview tab (e.g. rotating to landscape)
            if (state.ui.tab === 'preview') setTab('design');
        }
    }

    function bindKeys() {
        document.addEventListener('focusin', e => {
            if (activeDialog && !activeDialog.contains(e.target)) (dialogControls(activeDialog)[0] || activeDialog).focus();
        });
        document.addEventListener('keydown', e => {
            const t = e.target;
            if (activeDialog) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    activeDialog === $('#gallery') ? closeGallery() : closeDialog(activeDialog);
                } else if (e.key === 'Tab') {
                    const controls = dialogControls(activeDialog), first = controls[0], last = controls.at(-1);
                    if (!first || (e.shiftKey ? t === first : t === last) || !controls.includes(t)) {
                        e.preventDefault();
                        (e.shiftKey ? last || activeDialog : first || activeDialog).focus();
                    }
                }
                return;
            }
            const typing = (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type)) ||
                t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
            if (e.key === 'Escape') {
                if (!$('#gallery').hidden) closeGallery();
                $('#exportMenu').hidden = true;
                $('#resetMenu').hidden = true;
                if (typing) t.blur();
                return;
            }
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
            if (typing || mod || e.altKey) return;
            if (!$('#gallery').hidden) return;
            switch (e.key) {
                // caps lock also gives 'R', so check shift itself
                case 'r': case 'R': e.shiftKey ? surprise() : randomize(); break;
                case ' ':
                    if (t.closest('button, input, select, textarea, summary, a[href], [role="button"], [contenteditable]')) return;
                    e.preventDefault(); newSeed(); break;
                case 'g': case 'G': openGallery(); break;
                case 'e': case 'E': doExport('svg'); break;
                case 's': case 'S': saveSnapshot(); break;
                case 'f': case 'F': fitView(); break;
                case '?': openDialog($('#keysDialog')); break;
                default: return;
            }
        });
    }

    function unlockScenes() {
        if (scenesUnlocked) return;
        scenesUnlocked = true;
        storageSet(SCENES_KEY, true);
        toast('Scenes unlocked');
        if (!$('#gallery').hidden) { buildGallery(); filterGallery($('#gallerySearch').value); }
    }

    function bindScenesUnlock() {
        const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        let pos = 0;
        document.addEventListener('keydown', e => {
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            pos = key === code[pos] ? pos + 1 : key === code[0] ? 1 : 0;
            if (pos === code.length) { pos = 0; unlockScenes(); }
        });

        // The logo links to the about page, so hold a plain click briefly to see if more follow
        const link = $('.brand a');
        let clicks = 0, timer = 0;
        link.addEventListener('click', e => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            clearTimeout(timer);
            if (++clicks >= 6) { clicks = 0; unlockScenes(); return; }
            timer = setTimeout(() => { clicks = 0; location.href = link.href; }, 350);
        });
    }

    // Initial state: share link (#s=…) > saved state > defaults. `#gen=<id>` picks a design.
    async function loadInitialState() {
        const saved = storageGet(STORAGE_KEY);
        if (saved) {
            try { state = PG.settings.read(saved, true); }
            catch (err) { toast(`Saved settings could not be restored. Using defaults. ${err.message}`, true); }
            // saved from before scenes were hidden; share links below can still open one
            if (!scenesUnlocked && PG.byId[state.gen] && PG.byId[state.gen].category === 'Scenes') state.gen = PG.generators[0].id;
        }
        const hash = location.hash.slice(1);
        if (hash) {
            const q = new URLSearchParams(hash);
            try {
                const recipe = q.get('s') ? JSON.parse(b64decode(q.get('s'))) : null;
                const next = recipe ? sharedState(recipe) : JSON.parse(JSON.stringify(state));
                if (recipe) {
                    await PG.images.unpack(next, recipe.assets);
                    next.images = { ...state.images, ...next.images, [next.gen]: next.images[next.gen] || {} };
                }
                if (q.has('gen')) {
                    if (!Object.prototype.hasOwnProperty.call(PG.byId, q.get('gen'))) throw new Error('Unknown design');
                    next.gen = q.get('gen');
                }
                if (q.has('seed')) {
                    const seed = Number(q.get('seed'));
                    if (!q.get('seed').trim() || !Number.isInteger(seed) || seed < 0 || seed > 999999999) throw new Error('Invalid seed');
                    next.seed = seed;
                }
                if (q.has('tab')) {
                    if (!['design', 'output', 'preview'].includes(q.get('tab'))) throw new Error('Invalid tab');
                    next.ui.tab = q.get('tab');
                }
                state = next;
            } catch (e) {
                toast(`Could not open share link: ${e.message}`, true);
            }
            // Drop the hash so later reloads use the live (saved) state.
            try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { /* file:// */ }
        }
        if (!PG.byId[state.gen]) state.gen = PG.generators[0] ? PG.generators[0].id : state.gen;
        applyPaperSize();
        try { await PG.images.load(state.images); }
        catch (err) { toast(`Could not restore image: ${err.message}`, true); }
    }

    async function init() {
        await PG.loadGenerators();
        if (!PG.generators.length) {
            setError('No designs could be loaded.');
            return;
        }
        await loadInitialState();
        window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
        bindTopbar();
        bindKeys();
        bindScenesUnlock();
        bindCanvas();
        rebuildAll();
        syncInstallItem();
        placeSeedControls();
        PHONE.addEventListener('change', placeSeedControls);
        // phones open on the full-size drawing; wider screens always show it
        setTab(PHONE.matches ? 'preview' : state.ui.tab === 'output' ? 'output' : 'design');
        resizeCanvas();
        regenerate();
        pushUndo();
        // offline use and "install app"; needs http(s), so opening index.html from disk skips it
        if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
            navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
        }
        setupUpdateCheck();
    }

    // Handle for scripted checks (scripts/drive.js) and console tinkering.
    window.plotterApp = {
        get state() { return state; },
        get result() { return result; },
        select: selectGenerator, randomize, surprise, resetParams, resetAll, newSeed, undo, redo, exportAs: doExport, regenerate,
    };

    setupInstallPrompt(); // before init: the browser's install event can arrive while designs load
    init();
})();
