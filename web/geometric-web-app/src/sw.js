/*
 * Service worker: makes the app installable and usable offline.
 *
 * Every request goes to the network first, so a new deploy shows up on the
 * next load, and each response refreshes the cache. Offline, the cached copy
 * is served instead. The app shell and every design are cached on install, so
 * the whole app works offline from the first visit.
 */
importScripts('lib/loader.js'); // PG.GENERATOR_FILES: the list of designs

const CACHE = 'plotter-geometry-v1';
const SHELL = [
    './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
    'lib/core.js', 'lib/noise.js', 'lib/contours.js', 'lib/optimize.js',
    'lib/pipeline.js', 'lib/render.js', 'lib/export.js', 'lib/loader.js',
    'icons/favicon.svg', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
    ...PG.GENERATOR_FILES.map(name => `generators/${name}.js`),
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true })
                .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
    );
});
