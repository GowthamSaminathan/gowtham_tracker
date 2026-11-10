/* Service worker: makes the app installable and fully offline. Only same-origin app files are cached;
 * calls to Google / Microsoft (backups) are never intercepted and no data is ever stored here. */
const VERSION = '5.4.0', CACHE = 'tracker-' + VERSION;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'backup-config.js?v=' + VERSION, 'oauth.html',
    'assets/css/tailwind.css?v=' + VERSION, 'assets/css/fontawesome.min.css', 'assets/webfonts/fa-solid-900.woff2',
    'assets/js/sql-wasm.js', 'assets/js/sql-wasm-binary.js', 'assets/js/chart.umd.js', 'assets/js/alpine.min.js',
    'assets/js/backup.js?v=' + VERSION, 'assets/js/core.js?v=' + VERSION, 'assets/js/app.js?v=' + VERSION,
    'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tracker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const r = e.request, u = new URL(r.url);
    if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('/oauth.html')) return;
    if (r.mode === 'navigate') {            // pages: newest from the network when online, the cached copy when offline
        e.respondWith(fetch(r).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html').then(m => m || caches.match('./'))));
        return;
    }
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })));
});
