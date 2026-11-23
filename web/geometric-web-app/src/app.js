/*
 * SVGeometric — application UI.
 *
 * state (persisted) -> PG.run (generate + place + clip + optimize) -> result
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

    // Screen readers get toasts and errors through two hidden live regions that are always on the
    // page. A new line is added each time, so the same message twice is read twice.
    function announce(msg, urgent) {
        const line = el('div', { text: msg });
        $(urgent ? '#liveAlert' : '#liveStatus').append(line);
        setTimeout(() => line.remove(), 7000);
    }

    function toast(msg, isError) {
        const t = el('div', { class: 'toast' + (isError ? ' error' : ''), text: msg });
        $('#toasts').append(t);
        announce(msg, isError);
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

    // 'plotter-geometry' is from the app's old name. It stays in storage keys, share links and
    // exported SVGs because renaming it would lose saved work and stop old files from loading.
    const STORAGE_KEY = 'plotter-geometry:state:v1';
    const SNAPS_KEY = 'plotter-geometry:snapshots:v1';
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

    // Layers. The top level of the state is the bottom layer (gen, seed, params, locks, images
    // and the layer keys of comp), and state.layers holds the ones on top, each with the same
    // fields. The Design panel, the seed, Randomize and the gallery work on the selected layer,
    // state.ui.layer, numbered from 0 at the bottom.
    const MAX_LAYERS = PG.settings.MAX_LAYERS;
    const LAYER_KEYS = PG.settings.LAYER_KEYS;
    const layerAt = (i, s = state) => (i > 0 ? s.layers[i - 1] : s);
    const layerCount = (s = state) => s.layers.length + 1;
    const activeIndex = () => Math.min(Math.max(0, state.ui.layer | 0), state.layers.length);
    const activeLayer = () => layerAt(activeIndex());
    const layerName = (i, s = state) => (PG.byId[layerAt(i, s).gen] || {}).name || layerAt(i, s).gen;

    const currentDef = () => PG.byId[activeLayer().gen] || PG.generators[0];

    // Params for a design, with defaults filled in place (controls hold on to this object).
    // s is a layer, or a state for its bottom layer.
    function currentParams(def = currentDef(), s = activeLayer()) {
        const p = s.params[def.id] || (s.params[def.id] = {});
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
        const S = {
            seed: s.seed, paperW: s.paper.w, paperH: s.paper.h, margin: s.paper.margin,
            scale: c.scale, rotate: c.rotate, offsetX: c.offsetX, offsetY: c.offsetY, clip: c.clip,
            wrap: c.wrap, inner: c.inner, arc: c.arc, repeats: c.repeats, segments: c.segments, tab: c.tab,
            frame: c.frame, framePen: c.framePen, frameInset: c.frameInset, opt: s.opt,
            size: c.size, posX: c.posX, posY: c.posY, pen: c.pen, hidden: c.hidden,
            // Only overlap removal depends on pen width. Otherwise a width change is just a redraw.
            penWidths: s.opt.overlap ? s.pens.map(p => p.width) : null,
            cols: c.cols, rows: c.rows, gutter: c.gutter, cellVary: c.cellVary,
            locks: s.locks[s.gen] || [],
            sweep: c.sweepId ? { id: c.sweepId, amount: c.sweepAmount / 100, layer: c.sweepLayer } : null,
        };
        if (s.layers.length) {
            S.layers = s.layers.map(L => ({ gen: L.gen, params: currentParams(PG.byId[L.gen], L), seed: L.seed, comp: L.comp, locks: L.locks[L.gen] || [] }));
        }
        return S;
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

    // What travels in share links, exported SVGs and settings files. Each layer only takes the
    // settings of the design it shows.
    function shareable() {
        const def = PG.byId[state.gen];
        const recipe = {
            app: 'plotter-geometry', v: 3, gen: def.id, params: { [def.id]: currentParams(def, state) }, seed: state.seed,
            images: state.images[def.id] ? { [def.id]: state.images[def.id] } : {},
            paper: state.paper, comp: state.comp, locks: state.locks[def.id] || [],
            pens: state.pens, opt: state.opt, view: state.view,
        };
        if (state.layers.length) {
            recipe.layers = state.layers.map(L => ({
                gen: L.gen, seed: L.seed, params: { [L.gen]: currentParams(PG.byId[L.gen], L) },
                images: L.images[L.gen] ? { [L.gen]: L.images[L.gen] } : {}, locks: L.locks[L.gen] || [], comp: L.comp,
            }));
        }
        return JSON.parse(JSON.stringify(recipe));
    }

    // Names of the sheet's designs from the bottom up, for titles: "Spirograph + Flow Field"
    const sheetName = (s = state) => Array.from({ length: layerCount(s) }, (_, i) => layerName(i, s)).join(' + ');
    const recipeName = r => [r.gen, ...(r.layers || []).map(l => l.gen)].map(id => PG.byId[id]?.name || id).join(' + ');

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
        renderLayerNote();
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
        s.layers = state.layers.map(L => { const copy = Object.assign({}, L); delete copy.locks; return copy; });
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
        const keep = { ui: state.ui, view: state.view };
        const before = [state, ...state.layers].map((L, k) => ({ k, gen: L.gen, locks: L.locks }));
        const selected = activeIndex(), pensLocked = (activeLayer().locks[activeLayer().gen] || []).includes('pens');
        state = PG.settings.read(JSON.parse(undoStack.items[i]), true);
        Object.assign(state, keep);
        // Each layer keeps its locks: the one at the same place with the same design, else the one
        // with its design (undoing a move), else the one at its place (undoing a design switch).
        // A layer that comes back starts without any.
        const after = [state, ...state.layers], found = new Map();
        for (const pick of [(L, k) => b => b.k === k && b.gen === L.gen, L => b => b.gen === L.gen, (_, k) => b => b.k === k]) {
            after.forEach((L, k) => {
                if (found.has(L)) return;
                const match = before.find(b => !b.used && pick(L, k)(b));
                if (match) { match.used = true; found.set(L, match); }
            });
        }
        for (const [L, match] of found) L.locks = match.locks;
        // Undoing back to another design on the selected layer is a design switch too, so the pens
        // lock follows it like in switchGenerator. A layer that moved there brought its own locks.
        const L = activeLayer();
        if (found.get(L)?.k === selected) {
            const locks = new Set(L.locks[L.gen] || []);
            pensLocked ? locks.add('pens') : locks.delete('pens');
            L.locks[L.gen] = [...locks];
        }
        undoStack.index = i;
        rebuildAll();
        requestGenerate();
        updateUndoButtons();
        scheduleSave();
    }
    const undo = () => { clearTimeout(commitTimer); pushUndo(); restoreUndo(undoStack.index - 1); };
    // An edit still waiting for its commit goes in first. Being newer, it also drops the redo steps
    const redo = () => { clearTimeout(commitTimer); pushUndo(); restoreUndo(undoStack.index + 1); };
    function updateUndoButtons() {
        $('#undo').disabled = undoStack.index <= 0;
        $('#redo').disabled = undoStack.index >= undoStack.items.length - 1;
    }

    // ------------------------------------------------------------------ generation

    let genTimer = 0;

    function geometryKey(s = state) {
        return JSON.stringify([s.gen, s.params[s.gen], pipelineSettings(s), s.images[s.gen] || {}, s.layers.map(L => L.images[L.gen] || {})]);
    }
    function generationJob(s = state) {
        const job = { gen: s.gen, params: structuredClone(currentParams(PG.byId[s.gen], s)), settings: structuredClone(pipelineSettings(s)), images: PG.images.get(s) };
        if (s.layers.length) job.layerImages = s.layers.map(L => PG.images.get(L, L.gen));
        return job;
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
        const def = PG.byId[state.gen];
        if (!def) {
            settle(version);
            return done;
        }
        currentParams(def, state);
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
            setError(`${sheetName()}: ${err.message}`);
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
        renderLayerNote();
        renderWrapNotes();
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
        // Dragging a slider through a failing value repeats the same error, only read it out once
        if (msg && msg !== e.textContent) announce(msg, true);
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
        const skipped = vis.reduce((n, l) => n + ((result.overlap || {})[l.pen] || 0), 0);
        const stat = (cls, ...kids) => el('span', { class: 'stat ' + (cls || '') }, ...kids);
        const items = [
            stat('', el('b', { text: fmtCount(paths) }), paths === 1 ? 'path' : 'paths'),
            stat('', el('b', { text: fmtCount(points) }), 'points'),
            vis.length > 1 ? stat('', el('b', { text: vis.length }), 'pens') : null,
            result.overlap ? stat('', el('b', { text: skipped >= 1000 ? `${(skipped / 1000).toFixed(1)} m` : `${Math.round(skipped)} mm` }), 'overlap skipped') : null,
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
    // The lost context blanks the lines canvas, so put the drawing back with Canvas2D straight away
    $('#lines').addEventListener('webglcontextlost', () => draw());

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
    // dragging, some Randomize results), otherwise it crossfades. Morphs use the unoptimized
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
            // Switch to the Image design only once the photo is in, so a bad file leaves the current drawing alone
            let switchFrom = null;
            if (!q && PG.byId.image) {
                switchFrom = activeLayer().gen;
                def = PG.byId.image;
                q = def.params.find(p => p.type === 'image');
            }
            if (q) loadImageFile(file, def.id, q.id, switchFrom);
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
        const labelText = q.label || q.id;
        const label = el('label', { for: id, text: labelText });
        const head = el('div', { class: 'ctl-head' }, label);
        // The ? opens the hint under the control, for keyboards and touch where the tooltip never shows.
        // The inputs are described by it either way.
        let hint = null;
        if (q.hint) {
            hint = el('p', { class: 'ctl-hint', id: `${id}-hint`, text: q.hint, hidden: true });
            const btn = el('button', { class: 'hint', type: 'button', title: q.hint, text: '?',
                'aria-label': `About ${labelText}`, 'aria-expanded': 'false', 'aria-controls': hint.id });
            btn.addEventListener('click', () => {
                hint.hidden = !hint.hidden;
                btn.setAttribute('aria-expanded', String(!hint.hidden));
            });
            head.append(btn);
        }
        if (opts.onReset) {
            label.title = (q.hint ? q.hint + '\n' : '') + 'Double-click to reset';
            label.addEventListener('dblclick', opts.onReset);
        }
        if (opts.lockable) {
            const lock = el('button', { class: 'lock-btn' + (opts.locked ? ' locked' : ''), type: 'button',
                title: q.id === 'pens' ? 'Keep fixed when randomizing or switching designs' : 'Keep fixed when randomizing',
                'aria-label': `Lock ${labelText}`, 'aria-pressed': String(!!opts.locked) });
            lock.append(icon(opts.locked ? 'lock' : 'unlock'));
            lock.addEventListener('click', () => {
                const on = opts.onLock();
                lock.classList.toggle('locked', on);
                lock.setAttribute('aria-pressed', String(on));
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
            // options: [value, text, disabled] or { group, options } for an optgroup
            const sel = el('select', { id });
            const option = ([value, text, disabled]) => el('option', { value: String(value), text, disabled: !!disabled });
            for (const o of q.options) sel.append(o.group ? el('optgroup', { label: o.group }, o.options.map(option)) : option(o));
            const flat = q.options.flatMap(o => (o.group ? o.options : [o]));
            row.sync = () => { sel.value = String(get()); };
            sel.addEventListener('change', () => {
                const opt = flat.find(o => String(o[0]) === sel.value);
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
        if (hint) {
            row.append(hint);
            for (const input of row.querySelectorAll('input, select, textarea')) input.setAttribute('aria-describedby', hint.id);
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

    // A collapsible section of the Design panel. Returns the element its controls go in.
    function paramSection(root, label, sectionKey) {
        const det = el('details', { class: 'out-section param-section', 'data-param-section': label });
        det.open = !state.ui.paramClosed.includes(sectionKey);
        const body = el('div', { class: 'controls' });
        det.append(el('summary', {}, el('span', { text: label }), icon('chev')), body);
        det.addEventListener('toggle', () => {
            if (!det.isConnected) return;
            if (state.ui.paramClosed.includes(sectionKey) === !det.open) return;
            const closed = new Set(state.ui.paramClosed);
            det.open ? closed.delete(sectionKey) : closed.add(sectionKey);
            state.ui.paramClosed = [...closed];
            scheduleSave();
        });
        root.append(det);
        return body;
    }

    function buildParams() {
        const def = currentDef();
        const params = currentParams(def);
        const L = activeLayer(), multi = layerCount() > 1;
        const root = $('#params');
        root.replaceChildren();
        $('#designTitle').textContent = def.name;
        $('#designDesc').textContent = def.description || '';
        $('#designName').textContent = def.name;
        $('#designCat').textContent = multi ? `Layer ${activeIndex() + 1} · ${def.category}` : def.category;
        $('#designLayer').textContent = multi ? `Layer ${activeIndex() + 1} of ${layerCount()}` : '';
        $('#designLayer').hidden = !multi;
        document.title = `${def.name} · SVGeometric`;
        renderLayers();
        if (multi) buildLayerSection(root);

        const locks = new Set(L.locks[def.id] || []);
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
            const body = paramSection(root, group.label, `${def.id}/${group.label}`);
            for (const q of group.controls) {
                const row = makeControl(q, () => params[q.id], (v, live) => {
                    params[q.id] = v;
                    if (!live) commit();
                    updateVisibility(root, params);
                    // the pen count moves parts between pens, and some options add or rename one
                    if (PG.pens.hasParts(def)) renderPenUsage();
                    requestGenerate(live);
                }, {
                    lockable: q.type !== 'image' && q.type !== 'text',
                    locked: locks.has(q.id),
                    onLock() {
                        const set = new Set(L.locks[def.id] || []);
                        set.has(q.id) ? set.delete(q.id) : set.add(q.id);
                        L.locks[def.id] = [...set];
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
                        if (PG.pens.hasParts(def)) renderPenUsage();
                        requestGenerate();
                    },
                    onPickImage() { pickImage(def.id, q.id); },
                    onClearImage() {
                        imageLoadVersion++;
                        clearTimeout(commitTimer);
                        pushUndo();
                        if (L.images[def.id]) delete L.images[def.id][q.id];
                        params[q.id] = '';
                        row.sync();
                        commit();
                        requestGenerate();
                    },
                    hasImage: () => PG.images.has(L.images[def.id]?.[q.id]),
                    hasImageReference: () => !!L.images[def.id]?.[q.id],
                });
                row.dataset.param = q.id;
                if (q.show) row.showFn = q.show;
                body.append(row);
            }
        }
        updateVisibility(root, params);
        renderPenUsage();
    }

    // ---- images

    let pendingImageTarget = null;
    let imageLoadVersion = 0;
    function pickImage(genId, paramId) {
        pendingImageTarget = { genId, paramId, layer: activeLayer() };
        const input = $('#imageFile');
        input.value = '';
        input.click();
    }

    function loadImageFile(file, genId, paramId, switchFrom = null, target = activeLayer()) {
        const version = ++imageLoadVersion;
        const params = currentParams(PG.byId[genId], target);
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
                // The layer goes by its parameters: moving layers keeps those while the layer
                // objects change, and undo or loading settings replaces them, which drops the photo
                const layer = [state, ...state.layers].find(L => L.params[genId] === params);
                if (version !== imageLoadVersion || !layer) return;
                clearTimeout(commitTimer);
                pushUndo();
                (layer.images[genId] || (layer.images[genId] = {}))[paramId] = key;
                params[paramId] = file.name;
                // Skip the switch if another design was picked while the photo loaded
                if (switchFrom && layer.gen === switchFrom) {
                    switchGenerator(genId, null, layer);
                    designChanged();
                } else if (layer.gen === genId && activeLayer() === layer) buildParams();
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

    // Photos the session, its saved copy or a snapshot still use. Null when storage can't be read,
    // since then there's no telling what's still needed.
    function imageRefs() {
        try { localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
        const refs = new Set();
        const add = s => {
            if (!s || typeof s !== 'object') return;
            for (const images of [s.images, ...(Array.isArray(s.layers) ? s.layers.map(L => L && L.images) : [])]) {
                for (const row of Object.values(images || {})) for (const key of Object.values(row || {})) refs.add(key);
            }
        };
        add(state);
        add(storageGet(STORAGE_KEY));
        for (const s of loadSnaps()) add(s.state);
        return refs;
    }

    // ---- output panel (right)

    const penOptions = () => state.pens.map((p, i) => [i, `${i + 1} · ${p.name}`]);
    const isGrid = s => s.comp.cols * s.comp.rows > 1;

    // Range parameters of every layer, grouped by layer when there's more than one
    function sweepOptions() {
        const ranges = i => PG.byId[layerAt(i).gen].params.filter(q => q.type === 'range').map(q => [`${i}:${q.id}`, q.label || q.id]);
        if (layerCount() === 1) return [['', 'None'], ...ranges(0)];
        return [['', 'None'], ...Array.from({ length: layerCount() }, (_, i) => ({ group: `Layer ${i + 1}, ${layerName(i)}`, options: ranges(i) }))];
    }

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
                    { key: 'paper.color', label: 'Paper color (preview only)', type: 'color', effect: 'draw' },
                ],
            },
            {
                // the selected layer's placement
                id: 'comp', title: 'Composition', target: activeLayer, badge: () => (layerCount() > 1 ? `Layer ${activeIndex() + 1}` : ''), controls: [
                    { key: 'comp.wrap', label: 'Wrap', type: 'select', options: [['none', 'None'], ['polar', 'Polar'], ['kaleido', 'Kaleidoscope']],
                        note: el('div', { class: 'wrap-note', id: 'wrapNote', hidden: true }, el('p', { class: 'out-note', id: 'wrapNoteText' })),
                        hint: 'Polar bends the design round a center: across becomes the angle, and the top goes on the outside. In a full ring the side edges meet in a seam at the bottom, which Rotation° turns. Kaleidoscope mirrors every other segment, so it has no seam. Scale %, Rotation°, and the offsets move the whole ring. Works best with designs that fill the page, like tiles, fields, and scenes.' },
                    { key: 'comp.inner', label: 'Inner radius %', type: 'range', min: 0, max: 90, step: 1, show: wrapped,
                        hint: 'Leaves the middle empty, where lines would crowd together. To fill it, add a layer and set its Draw in to this layer and its Shapes to Center.' },
                    { key: 'comp.arc', label: 'Arc°', type: 'range', min: 30, max: 360, step: 1, show: wrapped, note: el('p', { class: 'out-note', id: 'coneNote', hidden: true }),
                        hint: 'Below 360 the design fills a fan instead of a ring. Cut it out along the frame and join the straight edges to make a cone, like a lampshade.' },
                    { key: 'comp.repeats', label: 'Repeats', type: 'range', min: 1, max: 24, step: 1, show: L => L.comp.wrap === 'polar',
                        hint: 'Copies of the design round the ring.' },
                    { key: 'comp.segments', label: 'Segments', type: 'range', min: 2, max: 24, step: 2, show: L => L.comp.wrap === 'kaleido',
                        hint: 'Segments round the ring. Every other one is mirrored, so they meet without a seam.' },
                    { key: 'comp.scale', label: 'Scale %', type: 'range', min: 10, max: 300, step: 1 },
                    { key: 'comp.rotate', label: 'Rotation°', type: 'range', min: -180, max: 180, step: 0.5 },
                    { key: 'comp.offsetX', label: 'Offset X (mm)', type: 'range', min: -150, max: 150, step: 0.5 },
                    { key: 'comp.offsetY', label: 'Offset Y (mm)', type: 'range', min: -150, max: 150, step: 0.5 },
                    { key: 'comp.clip', label: 'Crop to', type: 'select', show: L => !inShapes(L) && !wrapped(L),
                        options: [['rect', 'Rectangle (margins)'], ['circle', 'Circle'], ['hexagon', 'Hexagon'], ['diamond', 'Diamond']] },
                    { key: 'comp.size', label: 'Crop size %', type: 'range', min: 10, max: 100, step: 1, show: L => !inShapes(L),
                        hint: 'Shrinks the crop to part of the drawing area, keeping its proportions. The design fills the smaller crop.' },
                    { key: 'comp.posX', label: 'Crop position X (mm)', type: 'range', min: -150, max: 150, step: 0.5, show: L => !inShapes(L) && L.comp.size < 100 },
                    { key: 'comp.posY', label: 'Crop position Y (mm)', type: 'range', min: -150, max: 150, step: 0.5, show: L => !inShapes(L) && L.comp.size < 100 },
                    { key: 'comp.frame', label: inShapes() ? 'Outline each shape' : 'Draw frame', type: 'checkbox' },
                    { key: 'comp.framePen', label: 'Frame pen', type: 'select', options: penOptions(), show: L => L.comp.frame },
                    { key: 'comp.frameInset', label: 'Second frame line (mm in)', type: 'range', min: 0, max: 12, step: 0.5, show: L => L.comp.frame },
                    { key: 'comp.tab', label: 'Glue tab (mm)', type: 'range', min: 0, max: 20, step: 0.5,
                        show: L => L.comp.frame && wrapped(L) && L.comp.arc < 360 && !inShapes(L),
                        hint: 'Adds a flap along one straight edge of the fan, to glue under the other edge when it rolls into a cone. The frame folds along that edge.' },
                ],
            },
            {
                id: 'grid', title: 'Grid layout', badge: () => (isGrid(state) ? `${state.comp.cols} × ${state.comp.rows}` : 'off'), controls: [
                    { key: 'comp.cols', label: 'Columns', type: 'range', min: 1, max: 8, step: 1 },
                    { key: 'comp.rows', label: 'Rows', type: 'range', min: 1, max: 10, step: 1 },
                    { key: 'comp.gutter', label: 'Gutter (mm)', type: 'range', min: 0, max: 40, step: 0.5, show: isGrid },
                    { key: 'comp.cellVary', label: 'Each cell', type: 'select', show: isGrid,
                        options: [['seed', 'New seed per cell'], ['params', 'Random parameters per cell'], ['none', 'Identical']] },
                    { key: 'comp.sweepId', label: 'Sweep a parameter across cells', type: 'select', show: isGrid, options: sweepOptions(),
                        // as layer:param, since any layer's parameter can sweep
                        get: () => (state.comp.sweepId ? `${state.comp.sweepLayer}:${state.comp.sweepId}` : ''),
                        set: v => {
                            const at = String(v).indexOf(':');
                            Object.assign(state.comp, at > 0 ? { sweepLayer: +String(v).slice(0, at), sweepId: String(v).slice(at + 1) } : { sweepLayer: 0, sweepId: '' });
                        } },
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
                    { key: 'opt.overlap', label: 'Skip lines already drawn', type: 'checkbox',
                        hint: 'Lifts the pen where it would go back over ink from the same pen, so markers don\'t pick up ink and dry out. Uses each pen\'s width.' },
                    { key: 'opt.overlapPct', label: 'Skip when already inked (% of pen width)', type: 'range', min: 25, max: 100, step: 5, show: s => s.opt.overlap,
                        hint: 'At 100% only lines that are fully on ink go, so the plot looks the same. Lower values also skip lines that partly overlap, which can leave thin gaps in dense hatching.' },
                    { key: 'opt.overlapMin', label: 'Keep overlaps shorter than (mm)', type: 'range', min: 0.2, max: 10, step: 0.1, show: s => s.opt.overlap,
                        hint: 'Shorter overlaps, like where lines cross or meet, are drawn anyway so they don\'t cost an extra pen lift.' },
                ],
            },
            {
                id: 'png', title: 'PNG export', badge: () => `${state.view.pngDpi} dpi`, controls: [
                    { key: 'view.pngDpi', label: 'Resolution', type: 'select', effect: 'none', then: syncViewButtons,
                        options: PG.settings.pngDpis.map(d => [d, `${d} dpi${d === 96 ? ' (screen)' : d === 300 ? ' (print)' : ''}`]),
                        hint: 'Paper too big for this resolution exports at the highest one the browser allows. Phones and iPads allow far fewer pixels than desktop browsers.' },
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
            // Composition works on the selected layer, the rest on the sheet
            const target = sec.target || (() => state);
            const rows = [];
            for (const q of sec.controls || []) {
                const row = makeControl(q, q.get || (() => getPath(target(), q.key)), (v, live) => {
                    if (q.set) q.set(v); else setPath(target(), q.key, v);
                    if (q.then) {
                        q.then();
                        // e.g. paper size and orientation also change the custom width and height
                        for (const r of rows) if (r !== row) r.sync();
                    }
                    updateVisibility(body, target());
                    if (sec.badge) summary.querySelector('.badge').textContent = sec.badge();
                    applyEffect(q.effect || 'generate', live);
                    if (!live) commit();
                    if (['comp.size', 'comp.clip', 'comp.wrap'].includes(q.key)) renderLayerNote();
                    if (q.key === 'comp.wrap') renderLayers();
                    if (q.key.startsWith('comp.')) renderWrapNotes();
                });
                if (q.show) row.showFn = q.show;
                row.dataset.key = q.key;
                rows.push(row);
                body.append(row);
                if (q.note) {
                    // filled in by renderWrapNotes, and hidden with its control
                    const shown = q.show || (() => true), text = q.note.matches('p') ? q.note : q.note.querySelector('p');
                    q.note.showFn = v => shown(v) && !!text.textContent;
                    for (const input of row.querySelectorAll('input, select')) {
                        input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), text.id].filter(Boolean).join(' '));
                    }
                    body.append(q.note);
                }
            }
            if (sec.note) body.append(sec.note);
            updateVisibility(body, target());
            panel.append(det);
        }
        panel.scrollTop = scroll;
        renderStats();
        // the pen list has to be on the page first, it's looked up by id
        renderPenUsage();
        renderWrapNotes();
    }

    // The ring of layer i in the last drawing, if that drawing was made for the layer that is
    // layer i now. Layers move and get deleted before the next drawing is ready.
    let ringsFor = { key: null, ids: [] };
    function ringOf(i) {
        if (!result?.rings) return null;
        if (ringsFor.key !== resultKey) {
            let ids = [];
            try {
                const [gen, , S] = JSON.parse(resultKey);
                ids = [[gen, S.seed], ...(S.layers || []).map(L => [L.gen, L.seed])].map(x => x.join(':'));
            } catch (e) { /* no key yet */ }
            ringsFor = { key: resultKey, ids };
        }
        const L = layerAt(i);
        return ringsFor.ids[i] === `${L.gen}:${L.seed}` ? result.rings[i] : null;
    }

    // Notes for the selected layer under Wrap (what keeps the drawing from filling the ring, or a
    // layer above that lost the center it draws in) and under Arc° (the cone a fan makes)
    function renderWrapNotes() {
        const box = $('#wrapNote'), cone = $('#coneNote');
        if (!box || !cone) return;
        const i = activeIndex(), L = activeLayer(), c = L.comp, ring = wrapped(L) ? ringOf(i) : null;
        const mm = v => `${fmtMM(v)} mm`;

        let text = '', fix = null;
        const guest = state.layers.findIndex((G, k) => k + 1 > i && G.comp.inside === i && (G.comp.shapes === 'center' || !PG.byId[L.gen].regionKinds));
        if (guest >= 0 && !PG.hasCenter(c)) {
            text = `Layer ${guest + 2} draws in the center of this layer, which needs ${wrapped(L) ? 'an Inner radius % above 0' : 'Wrap set to Polar or Kaleidoscope'}.`;
        } else if (ring && !ring.cover) {
            text = c.wrap === 'kaleido' ? 'Nothing fits in segments this narrow. Lower Segments or Inner radius %.' : 'Nothing fits in a ring this thin. Lower Inner radius % or Repeats.';
        } else if (ring && ring.cover < 0.6) {
            // one object in the middle of the strip: more copies take it all the way round
            const key = c.wrap === 'kaleido' ? 'segments' : 'repeats', now = c[key];
            const n = key === 'segments' ? Math.min(24, 2 * Math.round(now / ring.cover / 2)) : Math.min(24, Math.round(now / ring.cover));
            if (n > now) {
                text = 'The design covers only part of the ring.';
                fix = { key, n, label: key === 'segments' ? `Use ${n} segments` : `Repeat it ${n} times` };
            }
        }
        box.querySelector('p').textContent = text;
        box.querySelector('button')?.remove();
        if (fix) {
            const btn = el('button', { class: 'btn', type: 'button', text: fix.label });
            btn.addEventListener('click', () => {
                c[fix.key] = fix.n;
                $(`[data-sec="comp"] [data-key="comp.${fix.key}"]`)?.sync?.();
                requestGenerate();
                commit();
                announce(`${fix.key === 'segments' ? 'Segments' : 'Repeats'} set to ${fix.n}`);
                // the button goes once the ring is full
                $(`[data-sec="comp"] [data-key="comp.${fix.key}"] input[type=number]`)?.focus();
            });
            box.append(btn);
        }
        box.hidden = !text;

        let about = '';
        if (ring && c.arc < 360 && ring.arc < 360) {
            const a = (ring.arc * Math.PI) / 180, base = (a * ring.r1) / Math.PI, top = (a * ring.r0) / Math.PI;
            const tall = Math.sqrt(Math.max(0, (ring.r1 - ring.r0) ** 2 - ((base - top) / 2) ** 2));
            about = top > 0.05 ? `Cone: ${mm(base)} across at the base, ${mm(top)} across at the top, and ${mm(tall)} tall.` : `Cone: ${mm(base)} across and ${mm(tall)} tall.`;
            if (ring.cut) about += ' Part of the fan is cut off. Lower Scale % or move it with Offset X (mm) and Offset Y (mm).';
            else if (!c.frame) about += ' Turn on Draw frame to plot the cutting line.';
        }
        cone.textContent = about;
        cone.hidden = !about || !!$('[data-sec="comp"] [data-key="comp.arc"]')?.hidden;
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
            // Named by number, the name field can change and every row would otherwise read the same
            const eye = el('button', { class: 'eye' + (pen.visible ? '' : ' off'), type: 'button', title: 'Show / hide this pen (hidden pens are not exported)',
                'aria-label': `Show pen ${i + 1}`, 'aria-pressed': String(pen.visible) }, icon(pen.visible ? 'eye' : 'eye-off'));
            eye.addEventListener('click', () => {
                pen.visible = !pen.visible;
                eye.classList.toggle('off', !pen.visible);
                eye.setAttribute('aria-pressed', String(pen.visible));
                eye.replaceChildren(icon(pen.visible ? 'eye' : 'eye-off'));
                draw();
                renderStats();
                renderPenUsage();
                commit();
            });
            const color = el('input', { type: 'color', class: 'color-input', value: pen.color, title: 'Pen color', 'aria-label': `Pen ${i + 1} color` });
            color.addEventListener('input', () => { pen.color = color.value; draw(); });
            color.addEventListener('change', commit);
            const name = el('input', { class: 'pen-name', value: pen.name, spellcheck: 'false', maxlength: 200, title: 'Pen name (used for SVG layer names)', 'aria-label': `Pen ${i + 1} name` });
            name.addEventListener('change', () => {
                pen.name = name.value || `Pen ${i + 1}`;
                for (const opt of document.querySelectorAll(`[data-key="comp.framePen"] option[value="${i}"], [data-layer-key="pen"] option[value="${i}"]`)) {
                    opt.textContent = `${i + 1} · ${pen.name}`;
                }
                renderPenUsage();
                commit();
            });
            const width = el('input', { type: 'number', class: 'num', min: 0.05, max: 5, step: 0.05, value: pen.width, title: 'Pen width in mm', 'aria-label': `Pen ${i + 1} width (mm)` });
            width.addEventListener('change', () => {
                pen.width = clamp(+width.value || pen.width, 0.05, 5);
                width.value = pen.width;
                syncAllWidth();
                if (state.opt.overlap) requestGenerate(); else draw();
                commit();
            });
            const meta = el('div', { class: 'pen-meta', 'data-pen': i }, el('span', { class: 'pen-parts' }), el('span', { class: 'pen-count' }));
            list.append(el('div', { class: 'pen-row', 'data-pen': i }, eye, color, name, width, meta));
        });
        body.append(list);
        partsKey = '';
        const reset = el('button', { class: 'btn', id: 'partsReset', type: 'button', text: 'Reset',
            title: 'Put every part back on its default pen', 'aria-label': 'Reset parts to their default pens' });
        reset.addEventListener('click', resetParts);
        body.append(el('div', { id: 'partsMoved', class: 'parts-moved', hidden: true }, el('p', { class: 'out-note' }), reset));

        // blank when the pens have different widths
        const allWidth = el('input', { type: 'number', class: 'num', min: 0.05, max: 5, step: 0.05, placeholder: 'mixed', title: 'Set the width of every pen in mm', 'aria-label': 'Width of every pen (mm)' });
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
            if (state.opt.overlap) requestGenerate(); else draw();
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
        const a = activeIndex(), one = activeLayer().comp.pen, multi = layerCount() > 1;
        // A layer on one pen has no parts to move
        const parts = one >= 0 ? null : PG.pens.parts(def, params);
        const hint = $('#penAssignmentHint');
        if (hint) {
            const own = one >= 0 ? `Layer ${a + 1} draws everything with pen ${one + 1}. Change it under Layer in the Design panel.`
                : [PG.pens.designs[def.id]?.hint, parts && 'Select a part below to move it to another pen.'].filter(Boolean).join(' ');
            hint.textContent = multi && one < 0 && own ? `Layer ${a + 1}, ${def.name}: ${own}` : own;
        }
        renderParts(rows, parts);
        if (multi) {
            // What every shown layer puts on each pen, numbered by layer. Parts of the selected
            // layer are already listed as controls.
            const roles = {};
            for (let i = 0; i < layerCount(); i++) {
                const L = layerAt(i);
                if (L.comp.hidden || (i === a && parts)) continue;
                const d = PG.byId[L.gen];
                const r = L.comp.pen >= 0 ? { [L.comp.pen]: ['everything'] } : PG.pens.roles(d, currentParams(d, L));
                for (const [pen, names] of Object.entries(r)) (roles[pen] ||= []).push(`Layer ${i + 1}: ${names.join(', ')}`);
            }
            rows.forEach(row => {
                const i = +row.dataset.pen, u = usage[i];
                row.classList.toggle('unused', !u);
                const listed = (roles[i] || []).join('; '), ownParts = !!parts && parts.some(q => q.pen === i);
                row.querySelector('.pen-count').textContent = u
                    ? [listed, `${fmtCount(u.paths)} ${u.paths === 1 ? 'path' : 'paths'}`].filter(Boolean).join(' · ')
                    : listed || ownParts ? [listed, 'no paths in this drawing'].filter(Boolean).join(' · ') : 'nothing on this pen';
            });
            return;
        }
        const roles = one >= 0 ? { [one]: ['Everything'] } : PG.pens.roles(def, params);
        rows.forEach(row => {
            const i = +row.dataset.pen;
            const u = usage[i];
            row.classList.toggle('unused', !u);
            const count = u ? `${fmtCount(u.paths)} ${u.paths === 1 ? 'path' : 'paths'}` : '';
            const assignment = roles[i]?.join(', ');
            // Scenes list their parts as controls (see renderParts), the rest name their colors here
            row.querySelector('.pen-count').textContent = parts
                ? count || (assignment ? 'no paths in this drawing' : 'nothing on this pen')
                : u ? `${assignment ? assignment + ' · ' : ''}${count}` : assignment ? `${assignment} · no paths in this drawing` : 'unused at this pen count';
        });
    }

    // ---- parts
    // Scenes show the parts each pen draws under it. A part is a label with an invisible
    // <select> over it, so picking another pen there moves the part and it works the same
    // with a mouse, a keyboard, a screen reader or a phone's picker.

    let partsKey = '';
    function renderParts(rows, parts) {
        // Only rebuilt when something changed. This also runs for every new drawing, and
        // rebuilding would close a list the user has open.
        // A part is moved while it has a pin in penMap, even when the pin matches the default
        // at this pen count. It still keeps that pen when the count changes again.
        const pinned = currentParams().penMap || {};
        const key = JSON.stringify([parts, pinned, state.pens.map(p => [p.name, p.visible])]);
        if (key === partsKey) return;
        partsKey = key;
        const focused = document.activeElement?.closest?.('#penList .part')?.dataset.part;
        const options = state.pens.map((p, i) => `${i + 1} · ${p.name}${p.visible ? '' : ' (hidden)'}`);
        rows.forEach(row => {
            const here = (parts || []).filter(q => q.pen === +row.dataset.pen);
            row.querySelector('.pen-parts').replaceChildren(...here.map(q => {
                const moved = Object.hasOwn(pinned, q.part);
                const sel = el('select', { 'aria-label': `Pen for ${q.name}${moved ? ' (moved by hand)' : ''}`,
                    title: moved ? `${q.name} was moved by hand. The default is pen ${q.default + 1}.` : `Move ${q.name} to another pen` },
                options.map((text, pen) => el('option', { value: pen, text })));
                sel.value = q.pen;
                sel.addEventListener('change', () => movePart(q.part, +sel.value));
                return el('span', { class: 'part' + (moved ? ' moved' : ''), 'data-part': q.part }, el('span', { 'aria-hidden': 'true', text: q.name }), sel);
            }));
        });
        const moved = (parts || []).filter(q => Object.hasOwn(pinned, q.part)).length;
        $('#partsMoved').hidden = !moved;
        $('#partsMoved p').textContent = `${moved} ${moved === 1 ? 'part' : 'parts'} moved by hand. Moved parts keep their pen when the pen count changes.`;
        // A part that just moved takes the focus along to its new pen
        if (focused !== undefined) {
            const sel = $(`#penList .part[data-part="${focused}"] select`);
            if (sel) { sel.focus({ preventScroll: true }); sel.scrollIntoView({ block: 'nearest' }); }
        }
    }

    function movePart(part, pen) {
        const def = currentDef(), params = currentParams(def);
        const map = { ...params.penMap };
        // Back on its default pen it follows the pen count again
        if (pen === PG.pens.parts(def, params)[part].default) delete map[part];
        else map[part] = pen;
        if (Object.keys(map).length) params.penMap = map;
        else delete params.penMap;
        renderPenUsage();
        requestGenerate();
        commit();
    }

    function resetParts() {
        delete currentParams().penMap;
        renderPenUsage();
        requestGenerate();
        commit();
        announce('Every part is back on its default pen');
        // the Reset button is hidden now
        ($('#penList .part select') || $('#penList .eye')).focus();
    }

    // ---- layers
    // The list at the top of the Design panel. Picking a layer there points the Design panel, the
    // seed, Randomize, the gallery and Composition at it. Everything else is the sheet's.

    const designsWithShapes = () => PG.generators.filter(g => g.regionKinds).map(g => g.name);
    const inShapes = (L = activeLayer()) => L !== state && L.comp.inside >= 0;
    const wrapped = (L = activeLayer()) => PG.wrapped(L.comp);

    // Shape kinds a design names for these params, like Thin rhombs and Thick rhombs
    function shapeKinds(i) {
        const L = layerAt(i), def = PG.byId[L.gen];
        return def.regionKinds ? def.regionKinds(currentParams(def, L)) || [] : [];
    }
    // A layer's design has shapes, or it's wrapped with an empty center
    const hasShapes = i => !!PG.byId[layerAt(i).gen].regionKinds || PG.hasCenter(layerAt(i).comp);

    function layerMeta(i) {
        const c = layerAt(i).comp, out = [];
        if (i > 0 && c.inside >= 0 && c.inside < i) out.push(`In layer ${c.inside + 1}`);
        if (PG.wrapped(c)) out.push(c.wrap === 'kaleido' ? 'Kaleidoscope' : 'Polar');
        if (i > 0 && c.cover !== 'none') out.push('Covers below');
        if (c.pen >= 0) out.push(`Pen ${c.pen + 1}`);
        if (c.hidden) out.push('Hidden');
        return out;
    }

    // Rebuilding the list loses focus, so actions say where it goes next as { layer, act }
    let layerFocus = null;
    function renderLayers() {
        const root = $('#layers');
        const n = layerCount(), active = activeIndex();
        const det = el('details', { class: 'out-section layers-section', 'data-sec': 'layers' });
        det.open = state.ui.open.layers !== false;
        det.addEventListener('toggle', () => { state.ui.open.layers = det.open; scheduleSave(); });
        det.append(el('summary', null, el('span', { text: 'Layers' }), el('span', { class: 'badge', text: n === 1 ? '1 layer' : `${n} layers` }), icon('chev')));
        const body = el('div', { class: 'controls' });
        const list = el('ol', { class: 'layer-list', 'aria-label': 'Layers, top first' });
        for (let i = n - 1; i >= 0; i--) {
            const c = layerAt(i).comp, name = layerName(i), meta = layerMeta(i);
            const row = el('li', { class: 'layer-row' + (i === active ? ' active' : '') + (c.hidden ? ' off' : ''), 'data-layer': i });
            if (n > 1) {
                row.append(el('button', { class: 'eye' + (c.hidden ? ' off' : ''), type: 'button', 'data-act': 'eye',
                    title: 'Show / hide this layer (hidden layers are not exported)', 'aria-label': `Show layer ${i + 1}`, 'aria-pressed': String(!c.hidden) },
                icon(c.hidden ? 'eye-off' : 'eye')));
            }
            row.append(el('button', { class: 'layer-pick', type: 'button', 'data-act': 'pick', 'aria-pressed': String(i === active),
                title: i === active ? 'The Design panel shows this layer' : 'Show this layer in the Design panel',
                'aria-label': [`Layer ${i + 1}: ${name}`, ...meta].join(', ') },
            el('span', { class: 'layer-num', text: i + 1 }),
            el('span', { class: 'layer-text' }, el('span', { class: 'layer-name', text: name }), meta.length ? el('span', { class: 'layer-meta', text: meta.join(' · ') }) : null)));
            if (n > 1) {
                row.append(
                    el('button', { class: 'icon-btn layer-act up', type: 'button', 'data-act': 'up', title: 'Move up', 'aria-label': `Move layer ${i + 1} up`, disabled: i === n - 1 }, icon('chev')),
                    el('button', { class: 'icon-btn layer-act', type: 'button', 'data-act': 'down', title: 'Move down', 'aria-label': `Move layer ${i + 1} down`, disabled: i === 0 }, icon('chev')),
                    el('button', { class: 'icon-btn layer-act', type: 'button', 'data-act': 'delete', title: 'Delete layer', 'aria-label': `Delete layer ${i + 1}` }, icon('x')));
            }
            list.append(row);
        }
        const full = n >= MAX_LAYERS;
        body.append(list, el('div', { class: 'layer-tools' },
            el('button', { class: 'btn', type: 'button', 'data-act': 'add', disabled: full, title: full ? `A sheet holds up to ${MAX_LAYERS} layers` : 'Add a design on top' },
                icon('plus'), el('span', { text: 'Add layer' })),
            el('button', { class: 'btn', type: 'button', 'data-act': 'duplicate', disabled: full, title: full ? `A sheet holds up to ${MAX_LAYERS} layers` : 'Copy the selected layer above it' },
                icon('copy'), el('span', { text: 'Duplicate' }))));
        if (n === 1) body.append(el('p', { class: 'out-note', text: 'Add a layer to draw another design on this sheet, on top of this one or inside its shapes.' }));
        det.append(body);
        root.replaceChildren(det);
        if (layerFocus) {
            const { layer, act } = layerFocus;
            layerFocus = null;
            const target = $(`#layers [data-layer="${layer}"] [data-act="${act}"]`) || $(`#layers [data-act="${act}"]`);
            (target && !target.disabled ? target : $(`#layers [data-layer="${layer}"] .layer-pick`))?.focus();
        }
    }

    function bindLayers() {
        $('#layers').addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const i = +b.closest('[data-layer]')?.dataset.layer;
            switch (b.dataset.act) {
                case 'pick': selectLayer(i); break;
                case 'eye': toggleLayer(i); break;
                case 'up': moveLayer(i, 1); break;
                case 'down': moveLayer(i, -1); break;
                case 'delete': deleteLayer(i); break;
                // Safari doesn't focus a clicked button, and closing the gallery returns focus to it
                case 'add': b.focus(); openGallery('add'); break;
                case 'duplicate': duplicateLayer(activeIndex()); break;
            }
        });
    }

    // A layer as a plain record. The bottom one comes from the top level of the state.
    function layerRecord(i) {
        const L = layerAt(i);
        return {
            gen: L.gen, seed: L.seed, params: L.params, locks: L.locks, images: L.images,
            comp: i ? L.comp : Object.fromEntries(LAYER_KEYS.map(k => [k, state.comp[k]])),
        };
    }
    function setLayers(records) {
        const [base, ...rest] = records;
        Object.assign(state, { gen: base.gen, seed: base.seed, params: base.params, locks: base.locks, images: base.images });
        Object.assign(state.comp, base.comp, { inside: -1 });
        state.layers = rest.map(r => ({ gen: r.gen, seed: r.seed, params: r.params, locks: r.locks, images: r.images, comp: r.comp }));
    }
    // Layers in a new order, given as old indices. Layers drawn in the shapes of another follow
    // it, or go back to the whole area when it's no longer below them, and so does the sweep.
    function reorder(order) {
        const records = order.map(i => layerRecord(i));
        const pos = [];
        order.forEach((old, at) => { pos[old] = at; });
        records.forEach((r, at) => {
            if (r.comp.inside < 0) return;
            const host = pos[r.comp.inside];
            if (host === undefined || host >= at) {
                r.comp.inside = -1;
                if (r.comp.cover === 'area') r.comp.cover = 'none';
            } else r.comp.inside = host;
        });
        if (pos[state.comp.sweepLayer] === undefined) Object.assign(state.comp, { sweepId: '', sweepLayer: 0 });
        else state.comp.sweepLayer = pos[state.comp.sweepLayer];
        setLayers(records);
    }

    function layersChanged(focus) {
        layerFocus = focus;
        buildParams();
        buildOutputPanel();
        syncSeed();
        requestGenerate();
        commit();
    }

    function selectLayer(i) {
        if (i === activeIndex()) { layerFocus = { layer: i, act: 'pick' }; renderLayers(); return; }
        state.ui.layer = i;
        layerFocus = { layer: i, act: 'pick' };
        buildParams();
        buildOutputPanel();
        syncSeed();
        scheduleSave();
    }

    function toggleLayer(i) {
        const c = layerAt(i).comp;
        c.hidden = !c.hidden;
        layerFocus = { layer: i, act: 'eye' };
        renderLayers();
        requestGenerate();
        commit();
    }

    function addLayer(id, preset, random = false) {
        const def = PG.byId[id];
        if (!def) return;
        if (layerCount() >= MAX_LAYERS) { toast(`A sheet holds up to ${MAX_LAYERS} layers`, true); return; }
        clearTimeout(commitTimer);
        pushUndo();
        const L = { gen: id, seed: randomSeed(), params: {}, locks: { [id]: [] }, images: {}, comp: PG.settings.layerComp() };
        const params = currentParams(def, L);
        if (preset) Object.assign(params, preset);
        if (random) L.params[id] = PG.randomParams(def, params, new PG.RNG(randomSeed() * 7919), []);
        state.layers.push(L);
        state.ui.layer = state.layers.length;
        closeGallery();
        layersChanged({ layer: activeIndex(), act: 'pick' });
        announce(`Added layer ${activeIndex() + 1}, ${def.name}`);
    }

    function duplicateLayer(i) {
        if (layerCount() >= MAX_LAYERS) return;
        clearTimeout(commitTimer);
        pushUndo();
        const records = Array.from({ length: layerCount() }, (_, k) => layerRecord(k));
        records.splice(i + 1, 0, structuredClone(layerRecord(i)));
        // layers above it shift up one, and so do the ones drawn in their shapes
        records.forEach((r, at) => { if (at > i + 1 && r.comp.inside > i) r.comp.inside++; });
        if (state.comp.sweepId && state.comp.sweepLayer > i) state.comp.sweepLayer++;
        setLayers(records);
        state.ui.layer = i + 1;
        layersChanged({ layer: i + 1, act: 'pick' });
        announce(`Duplicated ${layerName(i)} as layer ${i + 2}`);
    }

    function moveLayer(i, dir) {
        const j = i + dir, n = layerCount();
        if (j < 0 || j >= n) return;
        clearTimeout(commitTimer);
        pushUndo();
        const name = layerName(i), active = activeIndex();
        const order = Array.from({ length: n }, (_, k) => k);
        [order[i], order[j]] = [order[j], order[i]];
        reorder(order);
        state.ui.layer = active === i ? j : active === j ? i : active;
        layersChanged({ layer: j, act: dir > 0 ? 'up' : 'down' });
        announce(`Moved ${name} to layer ${j + 1}`);
    }

    function deleteLayer(i) {
        const n = layerCount();
        if (n < 2) return;
        clearTimeout(commitTimer);
        pushUndo();
        const name = layerName(i), active = activeIndex();
        reorder(Array.from({ length: n }, (_, k) => k).filter(k => k !== i));
        state.ui.layer = active === i ? Math.max(0, i - 1) : active > i ? active - 1 : active;
        layersChanged({ layer: Math.max(0, i - 1), act: 'pick' });
        announce(`Deleted layer ${i + 1}, ${name}`);
    }

    // Settings of the selected layer, at the top of the Design panel when there's more than one
    function buildLayerSection(root) {
        const i = activeIndex(), c = activeLayer().comp;
        const body = paramSection(root, 'Layer', 'layers/Layer');
        const kinds = c.inside >= 0 ? shapeKinds(c.inside) : [];
        const shapeValue = () => (/^kind:/.test(c.shapes) && +c.shapes.slice(5) >= kinds.length ? 'all' : c.shapes);
        const withShapes = designsWithShapes();
        const controls = [
            i > 0 && {
                key: 'inside', label: 'Draw in', type: 'select',
                options: [[-1, 'Whole drawing area'], ...Array.from({ length: i }, (_, j) => {
                    const shapes = hasShapes(j);
                    return [j, `Shapes of layer ${j + 1}, ${layerName(j)}${shapes ? '' : ' (no shapes)'}`, !shapes && c.inside !== j];
                })],
                hint: `Draws this design once in each shape of a lower layer. Designs with shapes: ${withShapes.slice(0, -1).join(', ')}, and ${withShapes.at(-1)}. A layer wrapped with an inner radius also has its empty center.`,
            },
            { key: 'shapes', label: 'Shapes', type: 'select', show: () => inShapes(),
                options: [['all', 'All shapes'], ['alternate', 'Every other shape'], ...kinds.map((k, n) => [`kind:${n}`, k]),
                    ...(c.inside >= 0 && (PG.hasCenter(layerAt(c.inside).comp) || c.shapes === 'center') ? [['center', 'Center']] : [])] },
            { key: 'shapeVary', label: 'Each shape', type: 'select', show: () => inShapes(),
                options: [['seed', 'New seed per shape'], ['params', 'Random parameters per shape'], ['none', 'Identical']] },
            { key: 'inset', label: 'Inset (mm)', type: 'range', min: 0, max: 10, step: 0.1, show: () => inShapes(),
                hint: 'Space between the outline of each shape and the design inside it.' },
            { key: 'minShape', label: 'Smallest shape (mm)', type: 'range', min: 1, max: 100, step: 0.5, show: () => inShapes(),
                hint: 'Shapes narrower than this, after the inset, are left empty.' },
            i > 0 && {
                key: 'cover', label: 'Covers layers below', type: 'select',
                options: [['none', 'No'], ['lines', 'Near its lines'], ['outline', 'Inside its outline'], ['area', inShapes() ? 'Inside its shapes' : 'Inside its area']],
                hint: 'Leaves out the lines of lower layers where this layer covers them. Near its lines leaves a gap along its lines, so they pass over the lines below. Inside its outline also clears everything its lines enclose. Inside its area clears its whole crop, or each shape it draws in.',
            },
            i > 0 && { key: 'gap', label: 'Clearance (mm)', type: 'range', min: 0.2, max: 10, step: 0.1, show: () => c.cover !== 'none',
                hint: 'How far the lines below stay from this layer.' },
            { key: 'pen', label: 'Pen', type: 'select', options: [[-1, 'Design\'s pens'], ...penOptions()],
                hint: 'Draws everything on this layer with one pen. The frame keeps its own pen.' },
        ].filter(Boolean);
        const defaults = PG.settings.layerComp();
        for (const q of controls) {
            const apply = (v, live) => {
                c[q.key] = v;
                // Drawing in shapes usually means hiding what's under them, the whole area hardly ever
                if (q.key === 'inside') {
                    if (v >= 0 && c.cover === 'none') c.cover = 'area';
                    if (v < 0 && c.cover === 'area') c.cover = 'none';
                }
                if (!live) commit();
                if (['inside', 'cover', 'pen'].includes(q.key)) {
                    layerFocus = null;
                    buildParams();
                    buildOutputPanel();
                    $(`#params [data-layer-key="${q.key}"] select`)?.focus();
                } else {
                    updateVisibility(root, currentParams());
                    renderLayerNote();
                }
                requestGenerate(live);
            };
            const row = makeControl(q, () => (q.key === 'shapes' ? shapeValue() : c[q.key]), apply,
                { onReset: () => { apply(defaults[q.key], false); row.sync?.(); } });
            row.dataset.layerKey = q.key;
            if (q.show) row.showFn = q.show;
            body.append(row);
        }
        body.append(el('p', { class: 'out-note', id: 'layerNote', hidden: true }));
        renderLayerNote();
    }

    // What the last drawing says about the selected layer: shapes it couldn't draw in, or a cover
    // that hides everything
    function renderLayerNote() {
        const note = $('#layerNote');
        if (!note) return;
        const i = activeIndex(), c = activeLayer().comp, info = result?.layerInfo?.[i];
        let text = '';
        if (inShapes()) {
            const host = PG.byId[layerAt(c.inside).gen];
            if (!hasShapes(c.inside) || (c.shapes === 'center' && !PG.hasCenter(layerAt(c.inside).comp))) {
                text = c.shapes === 'center' || wrapped(layerAt(c.inside))
                    ? `Layer ${c.inside + 1} has no center, so this layer draws nothing. Under Composition, set its Wrap and an Inner radius % above 0.`
                    : `${host.name} has no shapes to draw in, so this layer draws nothing.`;
            } else if (info?.noShapes) text = `Layer ${c.inside + 1} has no shapes on the paper, so this layer draws nothing.`;
            else if (info && info.regions && !info.shapes) text = 'None of the shapes are wide enough. Lower Smallest shape or Inset, or choose other Shapes.';
            else if (info && info.used < info.shapes) text = `Drawn in the ${info.used} largest of ${info.shapes} shapes, which keeps generating quick.`;
        } else if (i > 0 && c.cover === 'area' && !(c.size < 100) && c.clip === 'rect' && !wrapped()) {
            text = 'While this layer fills the drawing area, Inside its area hides every layer below it. Lower Crop size under Composition.';
        }
        note.textContent = text;
        note.hidden = !text;
    }

    // ---- snapshots

    function loadSnaps() {
        const snaps = storageGet(SNAPS_KEY);
        return Array.isArray(snaps) ? snaps.filter(s => s && Number.isFinite(s.time) && typeof s.title === 'string' &&
            typeof s.thumb === 'string' && s.state && typeof s.state === 'object').slice(0, 30) : [];
    }

    function buildSnapshotsSection(body) {
        const btn = el('button', { class: 'btn', id: 'snapSave', type: 'button' }, icon('camera'), el('span', { text: 'Save snapshot' }));
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
            const b = el('button', { class: 'snap-restore', type: 'button', title: `${s.title}\n${new Date(s.time).toLocaleString()}`,
                'aria-label': `Restore ${s.title}` }, el('img', { src: s.thumb, alt: '' }));
            const del = el('button', { class: 'del', type: 'button', title: 'Delete snapshot (Delete)', 'aria-label': `Delete ${s.title}` }, icon('x'));
            const item = el('div', { class: 'snap' }, b, del);
            const remove = () => {
                const focused = item.contains(document.activeElement);
                const at = [...grid.children].indexOf(item);
                storageSet(SNAPS_KEY, loadSnaps().filter(x => x.time !== s.time));
                renderSnaps(grid);
                announce(`Deleted ${s.title}`);
                // The focused button is gone, so move to the snapshot that took its place
                if (focused) {
                    const left = grid.querySelectorAll('.snap-restore');
                    (left[Math.min(at, left.length - 1)] || $('#snapSave')).focus();
                }
            };
            del.addEventListener('click', remove);
            b.addEventListener('keydown', e => { if (e.key === 'Delete') { e.preventDefault(); remove(); } });
            b.addEventListener('click', async () => {
                try {
                    await restoreShared(s.state);
                    toast(`Restored ${s.title}`);
                } catch (err) { toast(`Could not restore snapshot: ${err.message}`, true); }
            });
            grid.append(item);
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
        const snaps = loadSnaps();
        snaps.unshift({ time: Date.now(), title: `${recipeName(recipe)} #${recipe.seed}`, thumb: c.toDataURL('image/png'), state: recipe });
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
            // Inert content is hidden from screen readers, live regions included
            if (node === dlg || node.id === 'live' || ['SCRIPT', 'svg'].includes(node.tagName)) continue;
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

    // 'switch' changes the design of the selected layer, 'add' adds a layer with the design picked
    let galleryMode = 'switch';
    function openGallery(mode) {
        galleryMode = mode === 'add' ? 'add' : 'switch';
        $('#galleryTitle').textContent = galleryMode === 'add' ? 'Add a layer'
            : layerCount() > 1 ? `Design for layer ${activeIndex() + 1}` : 'Designs';
        const g = $('#gallery');
        // Focus the dialog, not the search, so mobile doesn't pop up the keyboard
        openDialog(g, g);
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
        // Thumbnails use the current pen and paper colors, which can also change through undo or loaded settings
        const colors = JSON.stringify([state.paper.color, state.pens.map(p => p.color)]);
        if (colors !== thumbColors) { thumbCache.clear(); thumbColors = colors; }
        const cats = PG.categories.concat([...new Set(PG.generators.map(g => g.category))].filter(c => !PG.categories.includes(c)));
        for (const cat of cats) {
            const gens = PG.generators.filter(g => g.category === cat);
            if (!gens.length) continue;
            const section = el('section', { 'data-cat': cat }, el('h3', { class: 'gallery-cat', text: cat }));
            const cards = el('div', { class: 'cards' });
            for (const def of gens) {
                // A design with gallery presets (Image) gets a card per preset instead of one for itself
                const entries = def.gallery ? def.gallery.map((g, i) => ({ ...g, key: `${def.id}:${i}` }))
                    : [{ name: def.name, description: def.description, key: def.id }];
                const shown = galleryMode === 'switch' && def.id === activeLayer().gen;
                const params = shown ? currentParams(def) : null;
                for (const entry of entries) {
                    // `params` picks the card's highlight, `preview` (e.g. a demo picture) is applied too so the result matches the thumbnail
                    const preset = { ...entry.preview, ...entry.params };
                    const current = shown && Object.entries(entry.params || {}).every(([k, v]) => params[k] === v);
                    const thumb = el('canvas', { class: 'thumb', width: 320, height: 320 });
                    const card = el('button', { class: 'card' + (current ? ' current' : ''), type: 'button', 'data-id': def.id,
                        'data-search': `${entry.name} ${entry.description || ''} ${def.name} ${def.category} ${def.id}`.toLowerCase() },
                    thumb,
                    el('div', { class: 'card-text' }, el('div', { class: 'card-name', text: entry.name }), el('div', { class: 'card-desc', text: entry.description || '' })));
                    card.addEventListener('click', () => (galleryMode === 'add' ? addLayer(def.id, preset) : selectGenerator(def.id, preset)));
                    cards.append(card);
                    const cached = thumbCache.get(entry.key);
                    if (cached) thumb.getContext('2d').drawImage(cached, 0, 0);
                    else thumbQueue.push([def, thumb, Object.assign(PG.defaultParams(def), preset), entry.key]);
                }
            }
            section.append(cards);
            body.append(section);
        }
        // Links out to my other apps, not designs. Kept as plain links so they never go through selectGenerator
        const app = (href, image, name, desc, search) => el('a', { class: 'card', href, target: '_blank', rel: 'noopener', 'data-search': `${search} more apps` },
            el('img', { class: 'thumb', src: image, alt: '', loading: 'lazy' }),
            el('div', { class: 'card-text' }, el('div', { class: 'card-name' }, `${name} `, icon('external'), el('span', { class: 'sr-only', text: ' (opens in a new tab)' })),
                el('div', { class: 'card-desc', text: desc })));
        body.append(el('section', { 'data-cat': 'More Apps' }, el('h3', { class: 'gallery-cat', text: 'More Apps' }), el('div', { class: 'cards' },
            app('https://svgmap.jarvisar.com/', 'images/svgmap-square.webp', 'SVGmap', 'Street maps of any city, for plotting or laser engraving',
                'svgmap svg map city street maps openstreetmap'),
            app('https://citymodel.jarvisar.com/', 'images/citymodel-square.webp', 'City Model', '3D printable city models of any place',
                'city model 3d print printable models terrain buildings'))));
        pumpThumbs();
    }

    function pumpThumbs() {
        clearTimeout(thumbTimer);
        if (!thumbQueue.length) return;
        const version = thumbVersion;
        thumbTimer = setTimeout(async () => {
            await renderThumb(...thumbQueue.shift());
            if (version === thumbVersion) pumpThumbs();
        }, 16);
    }

    async function renderThumb(def, canvasEl, params = PG.defaultParams(def), key = def.id) {
        // near-A4 scale, since fill designs size their features in real millimeters
        const size = 190;
        const S = {
            seed: 1, paperW: size, paperH: size, margin: 10, scale: 100, rotate: 0, clip: 'rect',
            opt: { simplify: true, simplifyTol: 0.05 },
        };
        const g = canvasEl.getContext('2d');
        try {
            const res = await thumbRunner.run({ gen: def.id, params, settings: S, images: {} });
            const k = canvasEl.width / size;
            PG.drawResult(g, res, { scale: k, ox: 0, oy: 0 },
                { paper: { w: size, h: size }, paperColor: state.paper.color, pens: state.pens, minLinePx: 0.9, hairline: true });
        } catch (e) {
            if (e.name === 'AbortError') return;
            g.fillStyle = '#300'; g.fillRect(0, 0, canvasEl.width, canvasEl.height);
        }
        const copy = el('canvas', { width: canvasEl.width, height: canvasEl.height });
        copy.getContext('2d').drawImage(canvasEl, 0, 0);
        thumbCache.set(key, copy);
    }

    function filterGallery(text) {
        const t = text.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('#galleryBody section').forEach(sec => {
            let any = false;
            sec.querySelectorAll('.card').forEach(card => {
                const ok = !t || card.dataset.search.includes(t);
                card.hidden = !ok;
                if (ok) { any = true; shown++; }
            });
            sec.hidden = !any;
        });
        const empty = $('#galleryEmpty');
        empty.textContent = `No designs match "${text.trim()}". Clear the search to see them all.`;
        // Only read out when the results run out, not again for every letter typed after that
        if (!shown && empty.hidden) announce(empty.textContent);
        empty.hidden = shown > 0;
    }

    // The pen count lock follows design switches; other parameter locks belong to their design.
    function switchGenerator(id, preset, L = activeLayer()) {
        const pensLocked = (L.locks[L.gen] || []).includes('pens');
        const pens = currentParams(PG.byId[L.gen], L).pens;
        L.gen = id;
        const params = currentParams(PG.byId[id], L);
        if (preset) Object.assign(params, preset);
        if (pensLocked) params.pens = pens;
        const locks = new Set(L.locks[id] || []);
        pensLocked ? locks.add('pens') : locks.delete('pens');
        L.locks[id] = [...locks];
    }

    function selectGenerator(id, preset) {
        if (!PG.byId[id]) return;
        switchGenerator(id, preset);
        closeGallery();
        designChanged();
        requestGenerate();
        commit();
    }

    // The sweep parameter list in the grid section depends on the designs.
    function designChanged() {
        const at = state.comp.sweepLayer, sweepDef = at < layerCount() ? PG.byId[layerAt(at).gen] : null;
        if (state.comp.sweepId && !sweepDef?.params.some(q => q.id === state.comp.sweepId)) Object.assign(state.comp, { sweepId: '', sweepLayer: 0 });
        buildParams();
        buildOutputPanel();
    }

    function surprise() {
        const others = PG.generators.filter(g => g.id !== activeLayer().gen);
        const def = others[Math.floor(Math.random() * others.length)] || currentDef();
        switchGenerator(def.id);
        closeGallery();
        designChanged();
        randomize();
    }

    // ------------------------------------------------------------------ actions

    // Randomize, New seed and Reset work on the selected layer
    function randomize() {
        const def = currentDef(), L = activeLayer();
        const current = currentParams(def);
        L.params[def.id] = PG.randomParams(def, current, new PG.RNG(randomSeed() * 7919), L.locks[def.id] || []);
        L.seed = randomSeed();
        buildParams();
        syncSeed();
        requestGenerate();
        commit();
    }

    function newSeed() {
        activeLayer().seed = randomSeed();
        syncSeed();
        requestGenerate();
        commit();
    }

    // Resetting parameters keeps the current photo. Clear removes it and can be undone.
    function defaultsFor(def, L = activeLayer()) {
        const p = PG.defaultParams(def);
        for (const q of def.params) if (q.type === 'image' && L.params[def.id]?.[q.id]) p[q.id] = L.params[def.id][q.id];
        return p;
    }

    function resetParams() {
        closeMenus();
        const def = currentDef();
        activeLayer().params[def.id] = defaultsFor(def);
        buildParams();
        requestGenerate();
        commit();
    }

    // Back to a fresh start with one layer, showing the design of the selected one. Undo brings
    // it all back except the locks, which never go through undo.
    function resetAll() {
        closeMenus();
        clearTimeout(commitTimer);
        pushUndo();
        const L = activeLayer();
        const imageParams = Object.fromEntries(Object.keys(L.images).map(id => [id, defaultsFor(PG.byId[id], L)]));
        state = Object.assign(defaultState(), { gen: L.gen, ui: Object.assign(state.ui, { layer: 0 }), images: L.images, params: imageParams });
        rebuildAll();
        fitView();
        requestGenerate();
        commit();
        toast('Everything reset to defaults');
    }

    function syncSeed() { $('#seed').value = activeLayer().seed; }

    function toggleView(key) {
        state.view[key] = !state.view[key];
        syncViewButtons();
        draw();
        scheduleSave();
    }
    function syncViewButtons() {
        for (const [sel, on] of [['#toggleMargin', state.view.margin], ['#togglePenWidth', state.view.penWidth]]) {
            $(sel).classList.toggle('on', on);
            $(sel).setAttribute('aria-pressed', String(on));
        }
        $('[data-export="png"] small').textContent = `${state.view.pngDpi} dpi`;
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
        closeMenus();
        if (kind === 'load') { $('#settingsFile').value = ''; $('#settingsFile').click(); return; }
        if (kind === 'install') { installApp(); return; }
        // Saving settings must also work if rendering fails or is still running.
        if (kind === 'json' || kind === 'link') {
            try {
                currentParams();
                constrainLayout();
                const recipe = shareable();
                if (kind === 'link') { copyLink(recipe); return; }
                const assets = PG.images.pack(PG.images.refsOf(recipe));
                if (Object.keys(assets).length) recipe.assets = assets;
                download(`${recipe.gen}-${recipe.seed}.json`, JSON.stringify(recipe, null, 2), 'application/json');
            } catch (err) { toast(`Could not export: ${err.message}`, true); }
            return;
        }
        let captured;
        try {
            captured = await captureDrawing();
            if (kind.startsWith('svg')) {
                const assets = PG.images.pack(PG.images.refsOf(captured.recipe));
                if (Object.keys(assets).length) captured.recipe.assets = assets;
            }
        } catch (err) { toast(`Could not export: ${err.message}`, true); return; }
        const { recipe, res, base } = captured;
        if (!res || !res.layers.length) { toast('Nothing to export', true); return; }
        const paper = { w: recipe.paper.w, h: recipe.paper.h };
        const meta = { title: `${recipeName(recipe)} — seed ${recipe.seed}`,
            description: 'plotter-geometry:' + JSON.stringify(recipe) };
        const vectorTypes = { svg: 'image/svg+xml', pdf: 'application/pdf', dxf: 'image/vnd.dxf', eps: 'application/postscript' };
        if (Object.hasOwn(vectorTypes, kind)) {
            try {
                download(`${base}.${kind}`, PG.exporters[kind](res, paper, recipe.pens, meta), vectorTypes[kind]);
            } catch (err) { toast(`Could not export: ${err.message}`, true); }
        } else if (kind === 'svg-split') {
            res.layers.forEach((l, i) => setTimeout(() => {
                download(`${base}-pen${l.pen + 1}.svg`, PG.exporters.svg(res, paper, recipe.pens, meta, l.pen), 'image/svg+xml');
            }, i * 300));
        } else if (kind === 'png') {
            const want = recipe.view.pngDpi, dpi = pngDpi(paper, want);
            if (!dpi) { toast('Paper is too large for a PNG export in this browser', true); return; }
            const k = dpi / 25.4;
            // floor keeps a fitted size under the limit, rounding could tip it a pixel over
            const c = el('canvas', { width: Math.floor(paper.w * k), height: Math.floor(paper.h * k) });
            try {
                PG.drawResult(c.getContext('2d'), res, { scale: k, ox: 0, oy: 0 },
                    { paper, paperColor: recipe.paper.color, pens: recipe.pens, minLinePx: 1, hairline: !recipe.view.penWidth });
            } catch (err) { toast(`Could not export: ${err.message}`, true); return; }
            // toBlob still hands back null if the browser runs out of memory for the canvas
            c.toBlob(b => {
                if (!b) { toast('Paper is too large for a PNG export at this resolution. Try a lower one.', true); return; }
                download(`${base}.png`, b);
                if (dpi < want) toast(`Saved at ${dpi} dpi. ${want} dpi is over this browser's limit for this paper size.`);
            });
        }
    }

    // Browsers refuse canvases over a size limit. iOS Safari allows about 16.7 million pixels, which
    // A5 at 600 dpi already passes. Desktop browsers allow about 268 million and 32767 px a side.
    // Past that the PNG drops to the highest whole dpi that fits, or 0 if not even 72 dpi does.
    function pngDpi(paper, want) {
        const w = paper.w / 25.4, h = paper.h / 25.4;
        const area = isIOS() ? 16777216 : 268435456;
        const fit = Math.floor(Math.min(Math.sqrt(area / (w * h)), 32767 / Math.max(w, h)));
        const dpi = Math.min(want, fit);
        return dpi >= 72 ? dpi : 0;
    }

    function shareUrl(recipe) {
        const base = location.href.split('#')[0];
        return `${base}#s=${b64encode(JSON.stringify(recipe))}`;
    }

    function copyLink(recipe) {
        if (PG.images.refsOf(recipe).some(refs => Object.keys(refs || {}).length)) {
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
        const card = el('div', { class: 'toast install' }, el('span', { class: 'install-icon' }, logo),
            el('div', { class: 'install-text' }, el('b', { text: title }), el('span', { text })));
        announce(`${title}. ${text}`);
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
        installToast = cardToast('Install SVGeometric',
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

    // ---- menus (export and reset). Each opens under its caret button, which tracks aria-expanded
    const menuButton = menu => $(`[aria-controls="${menu.id}"]`);
    function closeMenus() {
        for (const menu of document.querySelectorAll('#exportMenu, #resetMenu')) {
            menu.hidden = true;
            menuButton(menu).setAttribute('aria-expanded', 'false');
        }
    }
    function toggleMenu(menu) {
        const open = menu.hidden;
        closeMenus();
        if (!open) return;
        menu.hidden = false;
        menuButton(menu).setAttribute('aria-expanded', 'true');
        // On a short phone the reset menu opens inside the scrolling Design panel, below what's showing
        const panel = menu.closest('.panel');
        if (panel) {
            const m = menu.getBoundingClientRect(), p = panel.getBoundingClientRect();
            if (m.bottom > p.bottom) panel.scrollTop += Math.min(m.bottom - p.bottom + 8, m.top - p.top);
        }
    }

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
            toggleMenu($('#resetMenu'));
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
            activeLayer().seed = isFinite(v) ? clamp(v, 0, 999999999) : 1;
            syncSeed();
            requestGenerate();
            commit();
        });

        $('#exportSvg').addEventListener('click', () => doExport('svg'));
        $('#exportMenuBtn').addEventListener('click', e => {
            e.stopPropagation();
            toggleMenu($('#exportMenu'));
        });
        $('#exportMenu').addEventListener('click', e => {
            const b = e.target.closest('button[data-export]');
            if (b) doExport(b.dataset.export);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.export, .reset')) closeMenus();
        });
        // Tabbing past a menu closes it. relatedTarget is null when Safari clicks a button without
        // focusing it, and closing then would swallow the click on the menu item.
        for (const wrap of document.querySelectorAll('.export, .reset')) {
            wrap.addEventListener('focusout', e => { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) closeMenus(); });
        }
        $('#settingsFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadSettingsFile(f); });
        $('#imageFile').addEventListener('change', e => {
            const f = e.target.files[0];
            if (f && pendingImageTarget) loadImageFile(f, pendingImageTarget.genId, pendingImageTarget.paramId, null, pendingImageTarget.layer);
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
        $('#surprise').addEventListener('click', () => {
            if (galleryMode !== 'add') { surprise(); return; }
            const def = PG.generators[Math.floor(Math.random() * PG.generators.length)];
            addLayer(def.id, null, true);
        });
        for (const dlg of [$('#gallery'), $('#keysDialog')]) {
            dlg.addEventListener('click', e => { if (e.target === dlg) { dlg === $('#gallery') ? closeGallery() : closeDialog(dlg); } });
        }
        document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog($('#' + b.dataset.close))));

        document.querySelectorAll('#panelTabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    }

    function setTab(tab) {
        state.ui.tab = tab;
        $('#layout').dataset.tab = tab;
        document.querySelectorAll('#panelTabs button').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
            b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
        });
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
                // Focus would be left on a hidden menu item, so take it back to the menu's button
                const menu = t.closest && t.closest('.menu');
                closeMenus();
                if (menu) menuButton(menu).focus();
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
            // Otherwise the key also types into whatever got focus, like the G into the gallery search
            e.preventDefault();
        });
    }

    // Initial state: share link (#s=…) > saved state > defaults. `#gen=<id>` picks a design.
    async function loadInitialState() {
        const saved = storageGet(STORAGE_KEY);
        if (saved) {
            try { state = PG.settings.read(saved, true); }
            catch (err) { toast(`Saved settings could not be restored. Using defaults. ${err.message}`, true); }
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
        try { await PG.images.load(PG.images.refsOf(state)); }
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
        bindCanvas();
        bindLayers();
        rebuildAll();
        syncInstallItem();
        placeSeedControls();
        PHONE.addEventListener('change', placeSeedControls);
        // phones open on the full-size drawing; wider screens always show it
        setTab(PHONE.matches ? 'preview' : state.ui.tab === 'output' ? 'output' : 'design');
        resizeCanvas();
        regenerate();
        pushUndo();
        PG.images.collect(imageRefs).catch(err => console.warn('Could not clean up stored photos:', err));
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
        addLayer, selectLayer, moveLayer, deleteLayer, duplicateLayer, toggleLayer,
    };

    setupInstallPrompt(); // before init: the browser's install event can arrive while designs load
    init();
})();
