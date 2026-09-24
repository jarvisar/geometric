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
    const MM_PER_CSS_PX = 25.4 / 96;

    const PAPERS = [
        ['A6', 105, 148], ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594],
        ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6], ['Tabloid', 279.4, 431.8],
        ['4×6 in', 101.6, 152.4], ['5×7 in', 127, 177.8], ['9×12 in', 228.6, 304.8], ['11×14 in', 279.4, 355.6],
        ['Square 20 cm', 200, 200], ['Square 12 in', 304.8, 304.8], ['custom', 0, 0],
    ];

    const PEN_SETS = {
        fineliner: { label: 'Fineliners on white', paper: '#fbfaf6', colors: ['#161616', '#d1342f', '#2456c8', '#1d8a4e', '#d99a00', '#7b3fc0'] },
        gel: { label: 'Gel pens on black', paper: '#16181b', colors: ['#f4f1ea', '#e7c35a', '#aab7c1', '#f08bb0', '#7fcfe6', '#b5de7a'] },
        riso: { label: 'Riso brights', paper: '#f7f4ec', colors: ['#0078bf', '#ff48b0', '#ffb511', '#00a95c', '#ff665e', '#765ba7'] },
        sepia: { label: 'Sepia on cream', paper: '#f2e8d5', colors: ['#3a2a1c', '#8b4a2b', '#b8864e', '#556b2f', '#7a2e2e', '#2f4f6f'] },
        blueprint: { label: 'White on blueprint', paper: '#1d3f78', colors: ['#f2f6ff', '#9cc7ff', '#ffd66b', '#ff9f8a', '#b8f2d0', '#d5b8ff'] },
    };

    function defaultState() {
        return {
            v: 1,
            gen: 'spirograph',
            params: {},
            locks: {},
            seed: 1,
            paper: { size: 'A4', landscape: false, w: 210, h: 297, margin: 15, color: '#fbfaf6' },
            comp: {
                scale: 100, rotate: 0, offsetX: 0, offsetY: 0, clip: 'rect', frame: false, framePen: 0, frameInset: 0,
                cols: 1, rows: 1, gutter: 8, cellVary: 'seed', sweepId: '', sweepAmount: 50,
            },
            pens: PEN_SETS.fineliner.colors.map((color, i) => ({ name: `Pen ${i + 1}`, color, width: 0.35, visible: true })),
            opt: { merge: true, mergeTol: 0.1, simplify: true, simplifyTol: 0.02, sort: true, minLength: 0 },
            view: { margin: false, penWidth: true },
            ui: { tab: 'design', open: { paper: true, comp: true, pens: true } },
        };
    }

    function mergeInto(base, over) {
        if (!over || typeof over !== 'object') return base;
        for (const k of Object.keys(over)) {
            const b = base[k], o = over[k];
            if (k === 'pens' && Array.isArray(o)) {
                base.pens = base.pens.map((p, i) => Object.assign({}, p, o[i] || {}));
            } else if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) {
                mergeInto(b, o);
            } else if (o !== undefined) {
                base[k] = o;
            }
        }
        return base;
    }

    // ------------------------------------------------------------------ state

    let state = defaultState();
    let result = null;
    let lastGenMs = 0;
    const imageStore = {}; // genId -> { paramId: { width, height, data, name } }

    const currentDef = () => PG.byId[state.gen] || PG.generators[0];

    // Params for a design, with defaults filled in place (controls hold on to this object).
    function currentParams(def = currentDef()) {
        const p = state.params[def.id] || (state.params[def.id] = {});
        for (const q of def.params) if (q.id && !(q.id in p)) p[q.id] = q.value;
        return p;
    }

    function applyPaperSize() {
        const P = state.paper;
        if (P.size === 'custom') return;
        const e = PAPERS.find(x => x[0] === P.size) || PAPERS[2];
        P.w = P.landscape ? e[2] : e[1];
        P.h = P.landscape ? e[1] : e[2];
    }

    function paperLabel() {
        const P = state.paper;
        return `${P.size === 'custom' ? 'Custom' : P.size} · ${fmtMM(P.w)} × ${fmtMM(P.h)} mm`;
    }

    function pipelineSettings() {
        const c = state.comp;
        return {
            seed: state.seed, paperW: state.paper.w, paperH: state.paper.h, margin: state.paper.margin,
            scale: c.scale, rotate: c.rotate, offsetX: c.offsetX, offsetY: c.offsetY, clip: c.clip,
            frame: c.frame, framePen: c.framePen, frameInset: c.frameInset, opt: state.opt,
            cols: c.cols, rows: c.rows, gutter: c.gutter, cellVary: c.cellVary, locks: state.locks[state.gen] || [],
            sweep: c.sweepId ? { id: c.sweepId, amount: c.sweepAmount / 100 } : null,
        };
    }

    // What travels in share links, exported SVGs and settings files.
    function shareable() {
        const def = currentDef();
        return {
            app: 'plotter-geometry', v: 1, gen: def.id, params: { [def.id]: currentParams(def) }, seed: state.seed,
            paper: state.paper, comp: state.comp,
            pens: state.pens.map(p => ({ name: p.name, color: p.color, width: p.width })),
        };
    }

    function applyShared(obj) {
        if (!obj || typeof obj !== 'object') throw new Error('Not a settings file');
        const next = mergeInto(JSON.parse(JSON.stringify(state)), {
            seed: obj.seed, paper: obj.paper, comp: obj.comp, pens: obj.pens,
            opt: obj.opt,
        });
        if (obj.gen && PG.byId[obj.gen]) next.gen = obj.gen;
        if (obj.params) for (const [id, p] of Object.entries(obj.params)) next.params[id] = Object.assign({}, next.params[id] || {}, p);
        state = next;
    }

    let saveTimer = 0;
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => storageSet(STORAGE_KEY, state), 300);
    }

    // ------------------------------------------------------------------ undo / redo

    const undoStack = { items: [], index: -1 };
    let commitTimer = 0;

    function snapshotForUndo() {
        const s = Object.assign({}, state);
        delete s.ui; delete s.view;
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
        state = mergeInto(defaultState(), JSON.parse(undoStack.items[i]));
        state.params = JSON.parse(undoStack.items[i]).params || {};
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

    function requestGenerate(live) {
        clearTimeout(genTimer);
        const slow = lastGenMs > 90;
        if (slow) setBusy(true);
        genTimer = setTimeout(regenerate, slow ? (live ? 150 : 20) : 0);
    }

    function regenerate() {
        const def = currentDef();
        if (!def) return;
        const t0 = performance.now();
        try {
            result = PG.run(def, currentParams(def), pipelineSettings(), { images: imageStore[def.id] || {} });
            setError(null);
        } catch (err) {
            console.error(err);
            setError(`${def.name}: ${err.message}`);
            result = null;
        }
        lastGenMs = performance.now() - t0;
        setBusy(false);
        renderStats();
        renderPenUsage();
        draw();
        scheduleSave();
    }

    const hiddenPens = () => new Set(state.pens.map((p, i) => (p.visible ? -1 : i)).filter(i => i >= 0));

    function visibleResult() {
        if (!result) return null;
        const hidden = hiddenPens();
        return Object.assign({}, result, { layers: result.layers.filter(l => !hidden.has(l.pen)) });
    }

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
        const vis = visibleResult();
        const st = PG.optimize.stats(vis.layers);
        const stat = (cls, ...kids) => el('span', { class: 'stat ' + (cls || '') }, ...kids);
        const items = [
            stat('', el('b', { text: fmtCount(st.paths) }), st.paths === 1 ? 'path' : 'paths'),
            stat('', el('b', { text: fmtCount(st.points) }), 'points'),
            vis.layers.length > 1 ? stat('', el('b', { text: vis.layers.length }), 'pens') : null,
            stat('dim', `${Math.round(lastGenMs)} ms`),
        ];
        bar.append(...items.filter(Boolean));
    }

    // ------------------------------------------------------------------ canvas view

    const canvas = $('#view');
    const stage = $('#stage');
    const view = { zoom: 1, panX: 0, panY: 0 };
    let dpr = 1, cw = 0, ch = 0;

    function resizeCanvas() {
        const r = stage.getBoundingClientRect();
        if (!r.width || !r.height) return;
        dpr = window.devicePixelRatio || 1;
        cw = r.width; ch = r.height;
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        draw();
    }

    function viewTransform() {
        const P = state.paper;
        const fit = Math.max(0.05, Math.min((cw - 48) / P.w, (ch - 150) / P.h));
        const s = fit * view.zoom;
        const ox = cw / 2 - (P.w / 2) * s + view.panX;
        const oy = ch / 2 + 2 - (P.h / 2) * s + view.panY;
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

    function draw() {
        if (!cw) return;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const v = viewTransform();
        drawPaper(ctx, v);
        if (result) {
            PG.drawResult(ctx, result, v, {
                paper: { w: state.paper.w, h: state.paper.h },
                pens: state.pens,
                showMargin: state.view.margin,
                hidden: hiddenPens(),
                minLinePx: 0.8 * dpr,
                hairline: !state.view.penWidth,
            });
        }
        $('#zoomLabel').textContent = `${Math.round(v.css.s * MM_PER_CSS_PX * 100)}%`;
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
                rebuildAll();
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
                let v = +num.value;
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
                ? el('textarea', { id, rows: q.rows || 2, spellcheck: 'false' })
                : el('input', { type: 'text', id, class: 'text-input', spellcheck: 'false' });
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
                name.textContent = loaded ? v : v ? `${v} (load again)` : 'Demo image — or drop one on the preview';
                clear.hidden = !loaded;
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
        for (const q of def.params) {
            if (q.type === 'section') { root.append(el('div', { class: 'section-label', text: q.label })); continue; }
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
                    return set.has(q.id);
                },
                onReset() {
                    params[q.id] = q.value;
                    row.sync();
                    commit();
                    updateVisibility(root, params);
                    requestGenerate();
                },
                onPickImage() { pickImage(def.id, q.id); },
                onClearImage() {
                    if (imageStore[def.id]) delete imageStore[def.id][q.id];
                    params[q.id] = '';
                    row.sync();
                    commit();
                    requestGenerate();
                },
                hasImage: () => !!(imageStore[def.id] && imageStore[def.id][q.id]),
            });
            row.dataset.param = q.id;
            if (q.show) row.showFn = q.show;
            root.append(row);
        }
        updateVisibility(root, params);
    }

    // ---- images

    let pendingImageTarget = null;
    function pickImage(genId, paramId) {
        pendingImageTarget = { genId, paramId };
        const input = $('#imageFile');
        input.value = '';
        input.click();
    }

    function loadImageFile(file, genId, paramId) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
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
            URL.revokeObjectURL(url);
            (imageStore[genId] || (imageStore[genId] = {}))[paramId] = { width: w, height: h, data, name: file.name };
            state.params[genId] = Object.assign(currentParams(PG.byId[genId]), { [paramId]: file.name });
            if (state.gen === genId) buildParams();
            commit();
            requestGenerate();
            toast(`Loaded ${file.name}`);
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
            for (const q of sec.controls || []) {
                const row = makeControl(q, () => getPath(state, q.key), (v, live) => {
                    setPath(state, q.key, v);
                    if (q.then) q.then();
                    updateVisibility(body, state);
                    if (sec.badge) summary.querySelector('.badge').textContent = sec.badge();
                    applyEffect(q.effect || 'generate', live);
                    if (!live) commit();
                });
                if (q.show) row.showFn = q.show;
                body.append(row);
            }
            if (sec.note) body.append(sec.note);
            updateVisibility(body, state);
            panel.append(det);
        }
        panel.scrollTop = scroll;
        renderStats();
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
            thumbCache.clear();
            draw();
            commit();
        });
        body.append(el('div', { class: 'ctl' }, sel));

        const list = el('div', { id: 'penList' });
        state.pens.forEach((pen, i) => {
            const eye = el('button', { class: 'eye' + (pen.visible ? '' : ' off'), type: 'button', title: 'Show / hide this pen (hidden pens are not exported)' }, icon(pen.visible ? 'eye' : 'eye-off'));
            eye.addEventListener('click', () => {
                pen.visible = !pen.visible;
                eye.classList.toggle('off', !pen.visible);
                eye.replaceChildren(icon(pen.visible ? 'eye' : 'eye-off'));
                draw();
                renderStats();
                scheduleSave();
            });
            const color = el('input', { type: 'color', class: 'color-input', value: pen.color, title: 'Pen colour' });
            color.addEventListener('input', () => { pen.color = color.value; draw(); });
            color.addEventListener('change', () => { thumbCache.clear(); commit(); });
            const name = el('input', { class: 'pen-name', value: pen.name, spellcheck: 'false', title: 'Pen name (used for SVG layer names)' });
            name.addEventListener('change', () => { pen.name = name.value || `Pen ${i + 1}`; commit(); });
            const width = el('input', { type: 'number', class: 'num', min: 0.05, max: 5, step: 0.05, value: pen.width, title: 'Pen width in mm' });
            width.addEventListener('change', () => {
                pen.width = clamp(+width.value || 0.35, 0.05, 5);
                width.value = pen.width;
                draw();
                commit();
            });
            const meta = el('div', { class: 'pen-meta', 'data-pen': i });
            list.append(el('div', { class: 'pen-row', 'data-pen': i }, eye, color, name, width, meta));
        });
        body.append(list);
        body.append(el('p', { class: 'out-note', text: 'Width is in mm — the preview draws true-to-scale line widths. Each pen exports as its own Inkscape layer.' }));
        renderPenUsage();
    }

    function renderPenUsage() {
        const rows = document.querySelectorAll('#penList .pen-row');
        if (!rows.length) return;
        const usage = {};
        if (result) for (const l of result.layers) usage[l.pen] = PG.optimize.stats([l]);
        rows.forEach(row => {
            const i = +row.dataset.pen;
            const u = usage[i];
            row.classList.toggle('unused', !u);
            row.querySelector('.pen-meta').textContent = u ? `${fmtCount(u.paths)} ${u.paths === 1 ? 'path' : 'paths'}` : 'not used by this design';
        });
    }

    // ---- snapshots

    function loadSnaps() { return storageGet(SNAPS_KEY) || []; }

    function buildSnapshotsSection(body) {
        const btn = el('button', { class: 'btn', type: 'button' }, icon('camera'), el('span', { text: 'Save snapshot' }));
        btn.addEventListener('click', saveSnapshot);
        body.append(el('div', { class: 'ctl' }, btn));
        const grid = el('div', { class: 'snaps', id: 'snapGrid' });
        body.append(grid);
        renderSnaps();
    }

    function renderSnaps() {
        const grid = $('#snapGrid');
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
            b.addEventListener('click', () => {
                applyShared(s.state);
                rebuildAll();
                requestGenerate();
                commit();
                toast(`Restored ${s.title}`);
            });
            grid.append(b);
        }
    }

    function saveSnapshot() {
        if (!result) return;
        const P = state.paper;
        const k = 160 / Math.max(P.w, P.h);
        const c = el('canvas', { width: Math.round(P.w * k * 1.5), height: Math.round(P.h * k * 1.5) });
        PG.drawResult(c.getContext('2d'), visibleResult(), { scale: k * 1.5, ox: 0, oy: 0 },
            { paper: { w: P.w, h: P.h }, paperColor: P.color, pens: state.pens, minLinePx: 0.6, hairline: true });
        const def = currentDef();
        const snaps = loadSnaps();
        snaps.unshift({ time: Date.now(), title: `${def.name} #${state.seed}`, thumb: c.toDataURL('image/png'), state: shareable() });
        while (snaps.length > 30) snaps.pop();
        if (!storageSet(SNAPS_KEY, snaps)) { toast('Browser storage is full — delete some snapshots', true); return; }
        state.ui.open.snaps = true;
        buildOutputPanel();
        toast('Snapshot saved');
    }

    // ------------------------------------------------------------------ gallery

    const thumbCache = new Map();
    let thumbQueue = [];
    let thumbTimer = 0;

    function openGallery() {
        const g = $('#gallery');
        g.hidden = false;
        buildGallery();
        const search = $('#gallerySearch');
        search.value = '';
        filterGallery('');
        setTimeout(() => search.focus(), 0);
    }
    function closeGallery() {
        $('#gallery').hidden = true;
        clearTimeout(thumbTimer);
        thumbQueue = [];
    }

    function buildGallery() {
        const body = $('#galleryBody');
        body.replaceChildren();
        thumbQueue = [];
        const cats = PG.categories.concat([...new Set(PG.generators.map(g => g.category))].filter(c => !PG.categories.includes(c)));
        for (const cat of cats) {
            const gens = PG.generators.filter(g => g.category === cat);
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
        pumpThumbs();
    }

    function pumpThumbs() {
        clearTimeout(thumbTimer);
        if (!thumbQueue.length) return;
        thumbTimer = setTimeout(() => {
            const [def, canvasEl] = thumbQueue.shift();
            renderThumb(def, canvasEl);
            pumpThumbs();
        }, 16);
    }

    function renderThumb(def, canvasEl) {
        // near-A4 scale, since fill designs size their features in real millimetres
        const size = 190;
        const S = {
            seed: 1, paperW: size, paperH: size, margin: 10, scale: 100, rotate: 0, clip: 'rect',
            opt: { simplify: true, simplifyTol: 0.05 },
        };
        const g = canvasEl.getContext('2d');
        try {
            const res = PG.run(def, PG.defaultParams(def), S);
            const k = canvasEl.width / size;
            PG.drawResult(g, res, { scale: k, ox: 0, oy: 0 },
                { paper: { w: size, h: size }, paperColor: state.paper.color, pens: state.pens, minLinePx: 0.9, hairline: true });
        } catch (e) {
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
        const others = PG.generators.filter(g => g.id !== state.gen);
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
        const locked = state.locks[def.id] || [];
        const next = PG.randomParams(def, current, new PG.RNG(randomSeed() * 7919));
        for (const id of locked) next[id] = current[id];
        state.params[def.id] = next;
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

    function resetParams() {
        const def = currentDef();
        state.params[def.id] = PG.defaultParams(def);
        buildParams();
        requestGenerate();
        commit();
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

    const fileBase = () => `${currentDef().id}-${state.seed}`;
    const exportMeta = () => ({
        title: `${currentDef().name} — seed ${state.seed}`,
        description: 'plotter-geometry:' + JSON.stringify(shareable()),
    });

    function doExport(kind) {
        $('#exportMenu').hidden = true;
        if (kind === 'load') { $('#settingsFile').value = ''; $('#settingsFile').click(); return; }
        if (kind === 'json') {
            const data = Object.assign(shareable(), { opt: state.opt });
            download(`${fileBase()}.json`, JSON.stringify(data, null, 2), 'application/json');
            return;
        }
        if (kind === 'link') { copyLink(); return; }
        if (kind === 'install') { installApp(); return; }
        const res = visibleResult();
        if (!res || !res.layers.length) { toast('Nothing to export', true); return; }
        const paper = { w: state.paper.w, h: state.paper.h };
        if (kind === 'svg') {
            download(`${fileBase()}.svg`, PG.exporters.svg(res, paper, state.pens, exportMeta()), 'image/svg+xml');
        } else if (kind === 'svg-split') {
            res.layers.forEach((l, i) => setTimeout(() => {
                download(`${fileBase()}-pen${l.pen + 1}.svg`, PG.exporters.svg(res, paper, state.pens, exportMeta(), l.pen), 'image/svg+xml');
            }, i * 300));
        } else if (kind === 'png') {
            const k = 200 / 25.4;
            const c = el('canvas', { width: Math.round(paper.w * k), height: Math.round(paper.h * k) });
            PG.drawResult(c.getContext('2d'), res, { scale: k, ox: 0, oy: 0 },
                { paper, paperColor: state.paper.color, pens: state.pens, minLinePx: 1, hairline: !state.view.penWidth });
            c.toBlob(b => download(`${fileBase()}.png`, b));
        }
    }

    function shareUrl() {
        const base = location.href.split('#')[0];
        return `${base}#s=${b64encode(JSON.stringify(shareable()))}`;
    }

    function copyLink() {
        const url = shareUrl();
        const done = () => toast('Share link copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, () => { window.prompt('Copy this link:', url); });
        } else {
            window.prompt('Copy this link:', url);
        }
    }

    function loadSettingsFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                let text = String(reader.result).trim();
                if (text.startsWith('<')) {
                    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
                    const desc = doc.querySelector('desc');
                    const d = desc ? desc.textContent : '';
                    if (!d.startsWith('plotter-geometry:')) throw new Error('This SVG was not made here (no embedded settings)');
                    text = d.slice('plotter-geometry:'.length);
                }
                applyShared(JSON.parse(text));
                rebuildAll();
                requestGenerate();
                commit();
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

    function showInstallToast() {
        storageSet(INSTALL_KEY, true);
        const logo = $('.brand .logo').cloneNode(true);
        logo.setAttribute('class', 'install-logo');
        const text = el('div', { class: 'install-text' },
            el('b', { text: 'Install Plotter Geometry' }),
            el('span', { text: installEvent ? 'Works offline, in its own window.' : 'Tap Share, then Add to Home Screen.' }));
        installToast = el('div', { class: 'toast install', role: 'status' }, el('span', { class: 'install-icon' }, logo), text);
        if (installEvent) {
            const install = el('button', { class: 'btn accent', type: 'button', text: 'Install' });
            install.addEventListener('click', installApp);
            installToast.append(install);
        }
        const close = el('button', { class: 'icon-btn', type: 'button', title: 'Not now', 'aria-label': 'Not now' }, icon('x'));
        close.addEventListener('click', hideInstallToast);
        installToast.append(close);
        $('#toasts').append(installToast);
        setTimeout(hideInstallToast, 20000);
    }

    function hideInstallToast() {
        if (installToast) { installToast.remove(); installToast = null; }
    }

    // ------------------------------------------------------------------ wiring

    function rebuildAll() {
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
        $('#undo').addEventListener('click', undo);
        $('#redo').addEventListener('click', redo);
        $('#snapshotBtn').addEventListener('click', saveSnapshot);
        $('#keysBtn').addEventListener('click', () => { $('#keysDialog').hidden = false; });
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
            $('#exportMenu').hidden = !$('#exportMenu').hidden;
        });
        $('#exportMenu').addEventListener('click', e => {
            const b = e.target.closest('button[data-export]');
            if (b) doExport(b.dataset.export);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.export')) $('#exportMenu').hidden = true;
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
            dlg.addEventListener('click', e => { if (e.target === dlg) { dlg === $('#gallery') ? closeGallery() : (dlg.hidden = true); } });
        }
        document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.close).hidden = true; }));

        document.querySelectorAll('#panelTabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    }

    function setTab(tab) {
        state.ui.tab = tab;
        $('#layout').dataset.tab = tab;
        document.querySelectorAll('#panelTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        if (tab === 'preview') requestAnimationFrame(resizeCanvas);
        scheduleSave();
    }

    function bindKeys() {
        document.addEventListener('keydown', e => {
            const t = e.target;
            const typing = (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type)) ||
                t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
            if (e.key === 'Escape') {
                if (!$('#gallery').hidden) closeGallery();
                $('#keysDialog').hidden = true;
                $('#exportMenu').hidden = true;
                if (typing) t.blur();
                return;
            }
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
            if (typing || mod || e.altKey) return;
            if (!$('#gallery').hidden) return;
            switch (e.key) {
                case 'r': case 'R': randomize(); break;
                case ' ':
                    if (t.tagName === 'BUTTON') return;
                    e.preventDefault(); newSeed(); break;
                case 'g': case 'G': openGallery(); break;
                case 'e': case 'E': doExport('svg'); break;
                case 's': case 'S': saveSnapshot(); break;
                case 'f': case 'F': fitView(); break;
                case '?': $('#keysDialog').hidden = false; break;
                default: return;
            }
        });
    }

    // Initial state: share link (#s=…) > saved state > defaults. `#gen=<id>` picks a design.
    function loadInitialState() {
        const saved = storageGet(STORAGE_KEY);
        if (saved && saved.v === 1) {
            state = mergeInto(defaultState(), saved);
            state.params = saved.params || {};
            state.locks = saved.locks || {};
        }
        const hash = location.hash.slice(1);
        if (hash) {
            const q = new URLSearchParams(hash);
            try {
                if (q.get('s')) applyShared(JSON.parse(b64decode(q.get('s'))));
                if (q.get('gen') && PG.byId[q.get('gen')]) state.gen = q.get('gen');
                if (q.get('seed')) state.seed = +q.get('seed') || 1;
                if (q.get('tab')) state.ui.tab = q.get('tab');
            } catch (e) {
                console.warn('Bad share link', e);
            }
            // Drop the hash so later reloads use the live (saved) state.
            try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { /* file:// */ }
        }
        if (!PG.byId[state.gen]) state.gen = PG.generators[0] ? PG.generators[0].id : state.gen;
        applyPaperSize();
    }

    async function init() {
        await PG.loadGenerators();
        if (!PG.generators.length) {
            setError('No designs could be loaded.');
            return;
        }
        loadInitialState();
        bindTopbar();
        bindKeys();
        bindCanvas();
        rebuildAll();
        syncInstallItem();
        // phones open on the drawing; wider screens always show it
        const phone = window.matchMedia('(max-width: 720px)').matches;
        setTab(phone ? 'preview' : state.ui.tab === 'output' ? 'output' : 'design');
        resizeCanvas();
        regenerate();
        pushUndo();
        // offline use and "install app"; needs http(s), so opening index.html from disk skips it
        if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
            navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
        }
    }

    // Handle for scripted checks (scripts/drive.js) and console tinkering.
    window.plotterApp = {
        get state() { return state; },
        get result() { return result; },
        select: selectGenerator, randomize, newSeed, undo, redo, exportAs: doExport, regenerate,
    };

    setupInstallPrompt(); // before init: the browser's install event can arrive while designs load
    init();
})();
