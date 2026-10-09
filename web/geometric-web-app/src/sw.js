/*
 * Service worker: makes the app installable and usable offline.
 *
 * Every request goes to the network first, so a new deploy shows up on the
 * next load, and each response refreshes the cache. app.js polls version.json
 * to offer that reload when a deploy lands while the app is open. Offline, the cached copy
 * is served instead. The app shell and every design are cached on install, so
 * the whole app works offline from the first visit.
 */
importScripts('lib/loader.js'); // PG.GENERATOR_FILES: the list of designs

const CACHE = 'plotter-geometry-v1';
const SHELL = [
    './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
    // The About page, linked from the app. The design pages are left to the offline notice
    // below unless they were opened online, their previews are a few MB.
    'about/', 'pages.css', 'images/app.webp', 'images/gallery.webp',
    'lib/core.js', 'lib/pens.js', 'lib/noise.js', 'lib/contours.js', 'lib/iso.js', 'lib/isokit.js', 'lib/optimize.js',
    'lib/pipeline.js', 'lib/settings.js', 'lib/images.js', 'lib/generation.js', 'lib/worker-source.js',
    'lib/render.js', 'lib/gl.js', 'lib/export.js', 'lib/loader.js',
    'icons/favicon.svg', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'images/svgmap-square.webp',
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
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    // The update check only makes sense against the network, never a cached copy
    if (url.pathname.endsWith('/version.json')) return;
    event.respondWith(
        // GitHub Pages sends max-age=600, so revalidate or a plain reload can still get the old deploy
        fetch(req, { cache: 'no-cache' })
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => {
                if (hit || req.mode !== 'navigate') return hit || Response.error();
                // The app's HTML uses relative links, so it only works at the root
                return url.origin + url.pathname === self.registration.scope ? caches.match('index.html') : offlinePage();
            })),
    );
});

// For a page that was never opened online, e.g. a single design's page
function offlinePage() {
    const app = self.registration.scope;
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline · Plotter Geometry</title>
    <link rel="stylesheet" href="${app}pages.css">
</head>
<body>
    <main class="page narrow">
        <h1>You're offline</h1>
        <p class="lead">This page hasn't been saved for offline use yet. The app itself still works offline.</p>
        <div class="actions"><a class="btn accent" href="${app}">Open the app</a></div>
    </main>
</body>
</html>
`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
