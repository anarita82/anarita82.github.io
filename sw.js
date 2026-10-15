const CACHE_PREFIX = 'oxpc-app-';
const CACHE_NAME = CACHE_PREFIX + '20261016-seoulmouse-chat';
const ASSETS = ['app.html', 'app.css', 'app.js', 'pwa.js', 'offline.html', 'index.html',
  'styles.css', 'script.js', 'spec-details.css', 'fps-seats.html', 'benq-540hz.html',
  'rtx5080-pc.html', 'privacy.html', 'manifest.webmanifest', 'hero-pcroom.png',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'seoulmouse-192.png', 'seoulmouse-512.png', 'seoulmouse-apple-touch-icon.png'];
const allowedPaths = new Set(ASSETS.map((path) => new URL(path, self.registration.scope).pathname));
const cacheKey = (url) => new URL(url.pathname, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isHome = url.pathname === new URL('./', self.registration.scope).pathname;
  if (!allowedPaths.has(url.pathname) && !isHome) return;
  const key = isHome ? new URL('index.html', self.registration.scope).href : cacheKey(url);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') await cache.put(key, response.clone());
      return response;
    } catch {
      const cached = await cache.match(key);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return cache.match(new URL('offline.html', self.registration.scope).href);
      return Response.error();
    }
  })());
});
