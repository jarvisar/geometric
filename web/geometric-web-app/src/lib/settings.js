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
    settings.defaults = () => ({
        v: 3, gen: 'spirograph', params: {}, locks: {}, images: {}, seed: 1,
        paper: { size: 'A4', landscape: false, w: 210, h: 297, margin: 15, color: '#fbfaf6' },
        comp: {
            scale: 100, rotate: 0, offsetX: 0, offsetY: 0, clip: 'rect', frame: false, framePen: 0, frameInset: 0,
            cols: 1, rows: 1, gutter: 8, cellVary: 'seed', sweepId: '', sweepAmount: 50,
        },
        pens: PG.pens.sets.fineliner.colors.map((color, i) => ({ name: `Pen ${i + 1}`, color, width: 0.35, visible: true })),
        opt: { merge: true, mergeTol: 0.1, simplify: true, simplifyTol: 0.02, sort: true, minLength: 0 },
        view: { margin: false, penWidth: true },
        ui: { tab: 'design', open: { paper: true, comp: true, pens: true }, paramClosed: [] },
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
    const schemas = {
        paper: {
            size: choice(settings.papers.map(p => p[0])), landscape: boolean,
            w: number(50, 1200), h: number(50, 1200), margin: number(0, 80), color,
        },
        comp: {
            scale: number(10, 300), rotate: number(-180, 180), offsetX: number(-150, 150), offsetY: number(-150, 150),
            clip: choice(['rect', 'circle', 'hexagon', 'diamond']), frame: boolean, framePen: number(0, 7, true),
            frameInset: number(0, 12), cols: number(1, 8, true), rows: number(1, 10, true), gutter: number(0, 40),
            cellVary: choice(['seed', 'params', 'none']), sweepId: string(100), sweepAmount: number(-100, 100),
        },
        opt: {
            merge: boolean, mergeTol: number(0.01, 1), simplify: boolean, simplifyTol: number(0.005, 0.5),
            sort: boolean, minLength: number(0, 5),
        },
        view: { margin: boolean, penWidth: boolean },
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
            const v = own(from, q.id) ? from[q.id] : q.value;
            if (v === undefined && q.type === 'image') continue;
            const name = `params.${id}.${q.id}`;
            const read = q.type === 'range' ? number(q.min, q.max, q.id === 'pens')
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
        return out;
    }

    function readLocks(id, locks) {
        if (!own(PG.byId, id) || !Array.isArray(locks) || locks.length > 100 || locks.some(k => typeof k !== 'string')) fail('locks');
        const ids = new Set(PG.byId[id].params.map(q => q.id));
        return [...new Set(locks.map(k => k === 'inks' ? 'pens' : k).filter(k => ids.has(k)))];
    }

    settings.read = function (obj, session = false) {
        object(obj, 'expected an object');
        checkKeys(obj);
        if (own(obj, 'app') && obj.app !== 'plotter-geometry') fail('not a Plotter Geometry recipe');
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
        if (own(obj, 'params')) {
            object(obj.params, 'params');
            for (const [id, params] of Object.entries(obj.params)) next.params[id] = readParams(id, params, session);
        }
        if (!own(next.params, next.gen)) next.params[next.gen] = readParams(next.gen, {});
        if (own(obj, 'images')) {
            object(obj.images, 'images');
            for (const [id, refs] of Object.entries(obj.images)) {
                if (!own(PG.byId, id)) fail('image design');
                object(refs, 'image references');
                next.images[id] = {};
                for (const [param, ref] of Object.entries(refs)) {
                    if (!PG.byId[id].params.some(q => q.id === param && q.type === 'image') ||
                        typeof ref !== 'string' || !/^img-[a-z0-9-]{1,100}$/.test(ref)) fail('image reference');
                    next.images[id][param] = ref;
                }
            }
        }
        if (own(obj, 'locks')) {
            if (Array.isArray(obj.locks)) next.locks[next.gen] = readLocks(next.gen, obj.locks);
            else {
                object(obj.locks, 'locks');
                for (const [id, locks] of Object.entries(obj.locks)) next.locks[id] = readLocks(id, locks);
            }
        }
        if (!own(next.locks, next.gen)) next.locks[next.gen] = [];
        const sweep = next.comp.sweepId;
        if (sweep && !PG.byId[next.gen].params.some(q => q.id === sweep && q.type === 'range')) next.comp.sweepId = '';
        if (session && own(obj, 'ui')) {
            fields(next.ui, obj.ui, { tab: choice(['design', 'output', 'preview']) }, 'ui');
            if (own(obj.ui, 'paramClosed')) {
                if (!Array.isArray(obj.ui.paramClosed) || obj.ui.paramClosed.length > 500) fail('collapsed sections');
                next.ui.paramClosed = [...new Set(obj.ui.paramClosed.map(k => string(200)(k, 'collapsed section')))];
            }
            if (own(obj.ui, 'open')) fields(next.ui.open, obj.ui.open,
                Object.fromEntries(['paper', 'comp', 'grid', 'pens', 'opt', 'snaps'].map(k => [k, boolean])), 'ui.open');
        }
        if (next.paper.size !== 'custom') {
            const paper = settings.papers.find(p => p[0] === next.paper.size);
            next.paper.w = paper[next.paper.landscape ? 2 : 1];
            next.paper.h = paper[next.paper.landscape ? 1 : 2];
        }
        return next;
    };
})();
