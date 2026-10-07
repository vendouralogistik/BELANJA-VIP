/* Service Worker Belanja VIP — cache app shell saja, JANGAN cache /api */
const CACHE = 'belanja-vip-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // JANGAN pernah cache endpoint API
  if (url.pathname.startsWith('/api')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback: tampilkan halaman utama (navigasi hash ditangani app.js)
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return caches.match(e.request);
      });
    })
  );
});
