/* Saved recipes and browser state. Read into fresh objects before touching the UI. */
(function () {
    'use strict';
    const settings = PG.settings = {};
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const fail = name => { throw new Error(`Invalid settings: ${name}`); };
    const object = (v, name) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) fail(name);
        return v;
    };
    const number = (lo, hi, integer = false) => (v, name) => {
        if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) fail(name);
        return v;
    };
    const boolean = (v, name) => { if (typeof v !== 'boolean') fail(name); return v; };
    const string = (max = 10000) => (v, name) => { if (typeof v !== 'string' || v.length > max) fail(name); return v; };
    const choice = values => (v, name) => { if (!values.includes(v)) fail(name); return v; };
    const color = (v, name) => { if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail(name); return v; };

    settings.papers = [
        ['A6', 105, 148], ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594],
        ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6], ['Tabloid', 279.4, 431.8],
        ['4×6 in', 101.6, 152.4], ['5×7 in', 127, 177.8], ['9×12 in', 228.6, 304.8], ['11×14 in', 279.4, 355.6],
        ['Square 20 cm', 200, 200], ['Square 12 in', 304.8, 304.8], ['custom', 0, 0],
    ];
    settings.pngDpis = [96, 150, 300, 600, 1200];
    settings.MAX_LAYERS = PG.MAX_LAYERS || 6;
    // Where a layer sits on the sheet and how it stacks. The bottom layer keeps these in comp,
    // next to the sheet's grid settings, and every other layer has its own comp.
    settings.layerComp = () => ({
        scale: 100, rotate: 0, offsetX: 0, offsetY: 0, clip: 'rect', frame: false, framePen: 0, frameInset: 0,
        size: 100, posX: 0, posY: 0, pen: -1, hidden: false,
        cover: 'none', gap: 1, inside: -1, shapes: 'all', minShape: 5, inset: 1.5, shapeVary: 'seed',
    });
    settings.LAYER_KEYS = Object.keys(settings.layerComp());
    settings.defaults = () => ({
        v: 3, gen: 'spirograph', params: {}, locks: {}, images: {}, seed: 1,
        paper: { size: 'A4', landscape: false, w: 210, h: 297, margin: 15, color: '#fbfaf6' },
        comp: Object.assign(settings.layerComp(), {
            cols: 1, rows: 1, gutter: 8, cellVary: 'seed', sweepId: '', sweepAmount: 50, sweepLayer: 0,
        }),
        // Layers on top of the bottom one: { gen, seed, params, locks, images, comp }, like the top level
        layers: [],
        pens: PG.pens.sets.fineliner.colors.map((color, i) => ({ name: `Pen ${i + 1}`, color, width: 0.35, visible: true })),
        opt: { merge: true, mergeTol: 0.1, simplify: true, simplifyTol: 0.02, sort: true, minLength: 0, overlap: false, overlapPct: 100, overlapMin: 1 },
        view: { margin: false, penWidth: true, pngDpi: 600 },
        ui: { tab: 'design', open: { paper: true, comp: true, pens: true, layers: true }, paramClosed: [], layer: 0 },
    });

    // Check even ignored legacy fields. Never walk inherited properties while merging.
    function checkKeys(value, depth = 0) {
        if (!value || typeof value !== 'object') return;
        if (depth > 20) fail('settings are too deeply nested');
        for (const key of Object.keys(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(key);
            checkKeys(value[key], depth + 1);
        }
    }
    function fields(into, from, schema, name) {
        object(from, name);
        for (const [key, read] of Object.entries(schema)) {
            if (own(from, key)) into[key] = read(from[key], `${name}.${key}`);
        }
    }
    // Which of the regions below a layer draws in: all, every other one, or one kind of them
    const shapes = (v, name) => { if (typeof v !== 'string' || !/^(all|alternate|kind:1?\d)$/.test(v)) fail(name); return v; };
    const layerComp = {
        scale: number(10, 300), rotate: number(-180, 180), offsetX: number(-150, 150), offsetY: number(-150, 150),
        clip: choice(['rect', 'circle', 'hexagon', 'diamond']), frame: boolean, framePen: number(0, 7, true),
        frameInset: number(0, 12), size: number(10, 100), posX: number(-150, 150), posY: number(-150, 150),
        pen: number(-1, 7, true), hidden: boolean, cover: choice(['none', 'lines', 'outline', 'area']), gap: number(0.2, 10),
        inside: number(-1, settings.MAX_LAYERS - 1, true), shapes, minShape: number(1, 100), inset: number(0, 10),
        shapeVary: choice(['seed', 'params', 'none']),
    };
    const schemas = {
        paper: {
            size: choice(settings.papers.map(p => p[0])), landscape: boolean,
            w: number(50, 1200), h: number(50, 1200), margin: number(0, 80), color,
        },
        comp: Object.assign({}, layerComp, {
            cols: number(1, 8, true), rows: number(1, 10, true), gutter: number(0, 40),
            cellVary: choice(['seed', 'params', 'none']), sweepId: string(100), sweepAmount: number(-100, 100),
            sweepLayer: number(0, settings.MAX_LAYERS - 1, true),
        }),
        layerComp,
        opt: {
            merge: boolean, mergeTol: number(0.01, 1), simplify: boolean, simplifyTol: number(0.005, 0.5),
            sort: boolean, minLength: number(0, 5), overlap: boolean, overlapPct: number(25, 100), overlapMin: number(0.2, 10),
        },
        view: { margin: boolean, penWidth: boolean, pngDpi: choice(settings.pngDpis) },
        pen: { name: string(200), color, width: number(0.05, 5), visible: boolean },
    };

    function readParams(id, from, session = false) {
        const def = PG.byId[id];
        if (!own(PG.byId, id)) fail(`unknown design ${id}`);
        object(from, `params.${id}`);
        const legacy = {};
        if (own(from, 'inks')) legacy.inks = choice(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'])(from.inks, 'inks');
        for (const key of ['split', 'separate']) if (own(from, key)) legacy[key] = boolean(from[key], key);
        const out = {};
        for (const q of def.params) {
            if (!q.id) continue;
            let v = own(from, q.id) ? from[q.id] : q.value;
            if (v === undefined && q.type === 'image') continue;
            // A choice the design has since renamed or dropped, as { old: new }
            if (q.was && typeof v === 'string' && own(q.was, v)) v = q.was[v];
            const name = `params.${id}.${q.id}`;
            // Whole-number steps are counts. The controls can't make a fraction, but an edited
            // link can, and some designs crash on one (e.g. 2.5 studies in Tidal Atlas)
            const read = q.type === 'range' ? number(q.min, q.max, Number.isInteger(q.step || 1) && Number.isInteger(q.min))
                : q.type === 'select' ? choice(q.options.map(o => o[0]))
                : q.type === 'checkbox' ? boolean
                : q.type === 'text' || q.type === 'image' ? string() : null;
            if (!read) continue;
            // A saved session outlives design updates, so a value from an older version of a
            // design goes back to its default instead of throwing away the whole session
            try { out[q.id] = read(v, name); } catch (err) {
                if (!session || v === q.value) throw err;
                out[q.id] = q.value;
            }
        }
        if (!own(from, 'pens')) {
            const migrated = PG.pens.migrate(def, { ...legacy, sets: out.sets });
            if (migrated.pens !== undefined) out.pens = migrated.pens;
        }
        // Not in def.params, it's set from the pen list. Left out when nothing was moved.
        if (own(from, 'penMap') && PG.pens.hasParts(def)) {
            try {
                const map = readPenMap(from.penMap, `params.${id}.penMap`);
                if (Object.keys(map).length) out.penMap = map;
            } catch (err) { if (!session) throw err; }
        }
        return out;
    }

    // Parts moved to another pen by hand, as { part: pen }
    function readPenMap(from, name) {
        object(from, name);
        const out = {};
        for (const [part, pen] of Object.entries(from)) {
            if (!/^(0|[1-9]\d?)$/.test(part) || +part >= PG.pens.MAX_PARTS) fail(name);
            out[part] = number(0, PG.MAX_PENS - 1, true)(pen, name);
        }
        return out;
    }

    function readLocks(id, locks) {
        if (!own(PG.byId, id) || !Array.isArray(locks) || locks.length > 100 || locks.some(k => typeof k !== 'string')) fail('locks');
        const ids = new Set(PG.byId[id].params.map(q => q.id));
        return [...new Set(locks.map(k => k === 'inks' ? 'pens' : k).filter(k => ids.has(k)))];
    }

    // The design of the recipe or of one of its layers: params and locks for each design (by
    // id, kept for switching back) and photo references. `into.gen` is already set.
    function readDesigns(into, from, session, name) {
        if (own(from, 'params')) {
            object(from.params, `${name}params`);
            for (const [id, params] of Object.entries(from.params)) into.params[id] = readParams(id, params, session);
        }
        if (!own(into.params, into.gen)) into.params[into.gen] = readParams(into.gen, {});
        if (own(from, 'images')) {
            object(from.images, `${name}images`);
            for (const [id, refs] of Object.entries(from.images)) {
                if (!own(PG.byId, id)) fail('image design');
                object(refs, 'image references');
                into.images[id] = {};
                for (const [param, ref] of Object.entries(refs)) {
                    if (!PG.byId[id].params.some(q => q.id === param && q.type === 'image') ||
                        typeof ref !== 'string' || !/^img-[a-z0-9-]{1,100}$/.test(ref)) fail('image reference');
                    into.images[id][param] = ref;
                }
            }
        }
        if (own(from, 'locks')) {
            if (Array.isArray(from.locks)) into.locks[into.gen] = readLocks(into.gen, from.locks);
            else {
                object(from.locks, `${name}locks`);
                for (const [id, locks] of Object.entries(from.locks)) into.locks[id] = readLocks(id, locks);
            }
        }
        if (!own(into.locks, into.gen)) into.locks[into.gen] = [];
    }

    settings.read = function (obj, session = false) {
        object(obj, 'expected an object');
        checkKeys(obj);
        if (own(obj, 'app') && obj.app !== 'plotter-geometry') fail('not an SVGeometric recipe');
        if (own(obj, 'v') && ![1, 2, 3].includes(obj.v)) fail('unsupported version');
        if (!own(obj, 'gen') || typeof obj.gen !== 'string' || !own(PG.byId, obj.gen)) fail('unknown design');
        const next = settings.defaults();
        next.gen = obj.gen;
        if (own(obj, 'seed')) next.seed = number(0, 999999999, true)(obj.seed, 'seed');
        for (const key of ['paper', 'comp', 'opt', 'view']) {
            if (own(obj, key)) fields(next[key], obj[key], schemas[key], key);
        }
        if (own(obj, 'pens')) {
            if (!Array.isArray(obj.pens) || !obj.pens.length || obj.pens.length > PG.MAX_PENS) fail('pens');
            obj.pens.forEach((pen, i) => fields(next.pens[i], pen, schemas.pen, `pens.${i}`));
        }
        readDesigns(next, obj, session, '');
        // The bottom layer has nothing below it to draw in
        next.comp.inside = -1;
        if (own(obj, 'layers')) {
            if (!Array.isArray(obj.layers) || obj.layers.length > settings.MAX_LAYERS - 1) fail('layers');
            next.layers = obj.layers.map((from, i) => {
                const name = `layers.${i}`;
                object(from, name);
                if (!own(from, 'gen') || typeof from.gen !== 'string' || !own(PG.byId, from.gen)) fail(`${name}: unknown design`);
                const layer = { gen: from.gen, seed: 1, params: {}, locks: {}, images: {}, comp: settings.layerComp() };
                if (own(from, 'seed')) layer.seed = number(0, 999999999, true)(from.seed, `${name}.seed`);
                if (own(from, 'comp')) fields(layer.comp, from.comp, schemas.layerComp, `${name}.comp`);
                // only regions of a layer below can hold it
                if (layer.comp.inside > i) layer.comp.inside = -1;
                readDesigns(layer, from, session, `${name}.`);
                return layer;
            });
        }
        const sweepLayer = next.comp.sweepLayer > next.layers.length ? 0 : next.comp.sweepLayer;
        next.comp.sweepLayer = sweepLayer;
        const sweep = next.comp.sweepId, sweepGen = sweepLayer ? next.layers[sweepLayer - 1].gen : next.gen;
        if (sweep && !PG.byId[sweepGen].params.some(q => q.id === sweep && q.type === 'range')) next.comp.sweepId = '';
        if (session && own(obj, 'ui')) {
            fields(next.ui, obj.ui, { tab: choice(['design', 'output', 'preview']), layer: number(0, settings.MAX_LAYERS - 1, true) }, 'ui');
            next.ui.layer = Math.min(next.ui.layer, next.layers.length);
            if (own(obj.ui, 'paramClosed')) {
                if (!Array.isArray(obj.ui.paramClosed) || obj.ui.paramClosed.length > 500) fail('collapsed sections');
                next.ui.paramClosed = [...new Set(obj.ui.paramClosed.map(k => string(200)(k, 'collapsed section')))];
            }
            if (own(obj.ui, 'open')) fields(next.ui.open, obj.ui.open,
                Object.fromEntries(['paper', 'layers', 'comp', 'grid', 'pens', 'opt', 'png', 'snaps'].map(k => [k, boolean])), 'ui.open');
        }
        if (next.paper.size !== 'custom') {
            const paper = settings.papers.find(p => p[0] === next.paper.size);
            next.paper.w = paper[next.paper.landscape ? 2 : 1];
            next.paper.h = paper[next.paper.landscape ? 1 : 2];
        }
        return next;
    };
})();
