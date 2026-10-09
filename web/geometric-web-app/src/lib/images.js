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
    // Cleanup (collect below) has to know about every open tab and never delete a photo another
    // tab is storing. Each tab holds TABS from the moment it loads until it closes. Photos are only
    // stored while holding CLEAN, which a cleanup holds on its own, so a tab that opens during one
    // waits for it to finish before storing anything.
    const TABS = 'plotter-geometry:tabs', CLEAN = 'plotter-geometry:image-cleanup';
    const locks = navigator.locks;
    // Resolves to true once this tab holds TABS, false without Web Locks
    const present = !locks ? Promise.resolve(false) : new Promise(resolve => {
        locks.request(TABS, { mode: 'shared' }, () => { resolve(true); return new Promise(() => {}); }).catch(() => resolve(false));
    });

    const id = () => `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    async function put(asset) {
        const key = id();
        // Commit the pixels before any saved state can refer to them.
        const write = () => stored('readwrite', store => store.put(asset, key));
        if (await present) await locks.request(CLEAN, { mode: 'shared' }, write);
        else await write();
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
    // Photos stay stored after they're cleared or replaced, since undo can bring them back. Once
    // nothing refers to them they're deleted at the next start, but not while another tab is open:
    // its undo history could still need one. refs() lists the photos the saved session and
    // snapshots use. It's only read once this tab is alone and holds CLEAN, so it includes
    // whatever a tab that just closed saved last.
    async function collect(refs) {
        if (!await present) return 0;
        return locks.request(CLEAN, { ifAvailable: true }, async lock => {
            if (!lock) return 0;
            const { held } = await locks.query();
            if (held.filter(l => l.name === TABS).length > 1) return 0;
            const keep = refs();
            if (!keep) return 0;
            const keys = await stored('readonly', store => store.getAllKeys());
            // The cache has everything this tab stored or loaded, which covers its own undo history
            const drop = keys.filter(key => !keep.has(key) && !cache.has(key));
            if (drop.length) await stored('readwrite', store => drop.map(key => store.delete(key)).pop());
            return drop.length;
        });
    }
    PG.images = { put, load, get, pack, unpack, collect, has: key => cache.has(key) };
})();
