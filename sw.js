/* JamKoi service worker: app shell + OSM tile caching. Firestore traffic is never touched (it has its own offline cache). */
const VERSION = 'jamkoi-fb-v1';
const SHELL = ['offline.html', 'favicon.svg', 'assets/css/app.css', 'assets/icons/icon-192.png', 'data/locations.json'];
const SCOPE = self.registration.scope;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((p) => new URL(p, SCOPE).href))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== VERSION + '-tiles').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {                      // pages: network first, offline fallback
    e.respondWith(fetch(req).catch(() => caches.match(new URL('offline.html', SCOPE).href)));
    return;
  }
  if (url.hostname.endsWith('tile.openstreetmap.org')) {   // tiles: cache first, capped
    e.respondWith(caches.open(VERSION + '-tiles').then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { cache.put(req, res.clone()); cache.keys().then((k) => { if (k.length > 300) cache.delete(k[0]); }); }
      return res;
    }).catch(() => Response.error()));
    return;
  }
  if (url.origin === location.origin && (url.pathname.includes('/assets/') || url.pathname.endsWith('/locations.json'))) {   // own static files: stale-while-revalidate
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
