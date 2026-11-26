// Offline support: the app shell is cached on install, so the game opens and Classic games
// play with no connection. Game-server calls always go to the network.
const VERSION = 'v9';
const SHELL = `lor-shell-${VERSION}`;
const FONTS = 'lor-fonts';
const FILES = [
  '/', '/styles.css', '/manifest.webmanifest',
  '/src/main.js', '/src/core.js', '/src/api.js', '/src/config.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/icon-32.png', '/icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lor-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: serve from cache, refresh in the background
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // server functions are never cached

  // Pages: network first so updates arrive, cached shell when offline
  if (req.mode === 'navigate') {
    // cache the page under '/' (Vercel's clean URLs redirect /index.html, and a redirected
    // response can't be used for a navigation)
    e.respondWith(fetch(req).then(res => {
      if (res.ok && !res.redirected && url.pathname === '/') { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/', { ignoreSearch: true })));
    return;
  }
  // Static files: cache first, then network (and keep a copy)
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
    return res;
  })));
});
