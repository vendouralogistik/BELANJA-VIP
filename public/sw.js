/* Service Worker Belanja VIP — JANGAN cache /api.
 * Strategi: network-first untuk app shell (agar update selalu sampai ke user),
 * cache sebagai fallback offline. Versi cache WAJIB dinaikkan setiap ada
 * perubahan sw.js agar klien lama dipaksa refresh. */
const CACHE = 'belanja-vip-v2';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];
// File yang harus selalu fresh (logika aplikasi): network-first.
const FRESH = ['/', '/index.html', '/app.js'];

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
  const butuhFresh = FRESH.some((p) => url.pathname === p);
  if (butuhFresh) {
    // Network-first: coba jaringan dulu, fallback ke cache (offline).
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then((hit) => {
        if (hit) return hit;
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        throw new Error('offline');
      }))
    );
    return;
  }
  // Aset statis lain (css/ikon/manifest): cache-first, update di background.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const ambil = fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => hit);
      return hit || ambil;
    })
  );
});
