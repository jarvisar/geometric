/* Immutable image assets. State and undo history keep IDs, IndexedDB keeps pixels. */
(function () {
    'use strict';
    const cache = new Map();
    let database;
    const open = () => database || (database = new Promise((resolve, reject) => {
        const req = indexedDB.open('plotter-geometry:images', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('images');
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => { db.close(); database = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Image storage is blocked by another tab'));
    }).catch(err => { database = null; throw err; }));

    async function stored(mode, action) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('images', mode);
            const req = action(tx.objectStore('images'));
            tx.oncomplete = () => resolve(req.result);
            tx.onabort = () => reject(tx.error || new Error('Image storage failed'));
            tx.onerror = () => reject(tx.error);
        });
    }
    const id = () => `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    async function put(asset) {
        const key = id();
        // Commit the pixels before any saved state can refer to them.
        await stored('readwrite', store => store.put(asset, key));
        cache.set(key, asset);
        return key;
    }
    async function load(refs) {
        const keys = [...new Set(Object.values(refs || {}).flatMap(row => Object.values(row)))];
        await Promise.all(keys.map(async key => {
            if (cache.has(key)) return;
            const asset = await stored('readonly', store => store.get(key));
            if (!asset) throw new Error('Saved image is missing. Load the photo again or clear it.');
            cache.set(key, asset);
        }));
    }
    function get(s, gen = s.gen) {
        const out = {};
        for (const q of PG.byId[gen].params.filter(q => q.type === 'image')) {
            const key = s.images[gen] && s.images[gen][q.id];
            const asset = key && cache.get(key);
            if (asset) out[q.id] = asset;
            else if (key || s.params[gen]?.[q.id]) throw new Error('Load the saved photo again or clear it to use the demo.');
        }
        return out;
    }
    function pack(refs) {
        const out = {};
        for (const key of new Set(Object.values(refs || {}).flatMap(row => Object.values(row)))) {
            const asset = cache.get(key);
            if (!asset) throw new Error('Cannot export a missing image. Load the photo again or clear it.');
            const bytes = new Uint8Array(asset.data.buffer, asset.data.byteOffset, asset.data.byteLength);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
            out[key] = { width: asset.width, height: asset.height, pixels: btoa(bin) };
        }
        return out;
    }
    async function unpack(s, assets) {
        if (!assets) return load(s.images);
        const decoded = new Map();
        for (const row of Object.values(s.images)) for (const key of Object.values(row)) {
            if (decoded.has(key)) continue;
            const a = Object.prototype.hasOwnProperty.call(assets, key) && assets[key];
            if (!a || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 1 || a.height < 1 ||
                a.width > 900 || a.height > 900 || typeof a.pixels !== 'string' || a.pixels.length !== 4 * Math.ceil(a.width * a.height * 4 / 3)) {
                throw new Error('Invalid image asset');
            }
            const bytes = Uint8Array.from(atob(a.pixels), c => c.charCodeAt(0));
            if (bytes.length !== a.width * a.height * 4) throw new Error('Invalid image pixels');
            const data = new Float32Array(bytes.buffer);
            if (data.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid image luminance');
            decoded.set(key, { width: a.width, height: a.height, data });
        }
        // Imported IDs never overwrite an image belonging to undo history or another recipe.
        const ids = new Map();
        for (const [key, asset] of decoded) ids.set(key, await put(asset));
        for (const row of Object.values(s.images)) for (const param of Object.keys(row)) row[param] = ids.get(row[param]);
    }
    PG.images = { put, load, get, pack, unpack, has: key => cache.has(key) };
})();
