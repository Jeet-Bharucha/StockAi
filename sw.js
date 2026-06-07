const CACHE = 'stockai-v9';
const STATIC = [
  '/', '/index.html', '/login.html', '/register.html',
  '/dashboard.html', '/profile.html', '/404.html',
  '/css/effects.css',
  '/js/auth.js', '/js/dashboard.js', '/js/stockApi.js',
  '/js/aiPredictor.js', '/js/features.js', '/js/animations.js', '/js/chat.js',
  '/favicon.svg', '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC.map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {}) // don't fail install if a file is missing
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for API calls and external resources
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
