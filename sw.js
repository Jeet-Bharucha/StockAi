const CACHE = 'stockai-v27-reliability-1';
const STATIC = [
  '/', '/index.html', '/login.html', '/register.html',
  '/forgot-password.html', '/reset-password.html', '/owner-recovery.html', '/verify-email.html',
  '/dashboard.html', '/profile.html', '/404.html',
  '/css/effects.css', '/css/pro-terminal.css', '/css/research-workspace.css',
  '/js/auth.js', '/js/dashboard.js', '/js/stockApi.js',
  '/js/researchWorkspace.js', '/js/aiPredictor.js', '/js/researchTools.js', '/js/signalEvidence.js', '/js/features.js', '/js/animations.js', '/js/chat.js',
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

  // Never cache login/API responses; an old HTML error must not masquerade as
  // a successful authentication response after the backend is redeployed.
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Prefer the current deployed login pages and auth JS. Fall back to the
  // offline cache for page navigation only when the network is unavailable.
  if (e.request.mode === 'navigate' ||
      url.pathname === '/js/auth.js' ||
      url.pathname === '/js/dashboard.js' ||
      url.pathname === '/js/stockApi.js' ||
      url.pathname === '/js/researchTools.js' ||
      url.pathname === '/js/researchWorkspace.js' ||
      url.pathname === '/css/research-workspace.css' ||
      url.pathname === '/css/pro-terminal.css') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for immutable/static assets
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
