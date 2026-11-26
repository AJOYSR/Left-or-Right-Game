// Scripts and styles live at content-hashed addresses (/assets/main.<hash>.js, made by
// scripts/release.mjs), so a cache from an older release can never hand a new page an old script,
// and old files stay on the server for old tabs. The release script also updates the list below.
// Offline support: the app shell is cached on install, so the game opens and Classic games
// play with no connection. Game-server calls always go to the network.
const VERSION = 'r-8d14cac488';
const SHELL = `lor-shell-${VERSION}`;
const FONTS = 'lor-fonts';
const FILES = [
  '/', '/assets/styles.37a744cdcf.css', '/manifest.webmanifest',
  '/assets/main.7bec0a7cf4.js', '/assets/core.373fb97d34.js', '/assets/api.85c113d010.js', '/assets/queue.91786d6ba2.js', '/assets/config.6c2d557f76.js', '/privacy', '/assets/doc.2be06cfe06.css',
  '/fonts/fonts.css', '/fonts/inter-latin.woff2', '/fonts/inter-latin-ext.woff2', '/fonts/bricolage-grotesque-latin.woff2', '/fonts/bricolage-grotesque-latin-ext.woff2',
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
  // Hashed release files, fonts and icons never change: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Code and styles: network first, so a page never mixes a new HTML file with old scripts
  // (or the reverse). The cached copy is only used offline.
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});

// Daily reminders: show the notification the server sends, and open the Daily when it's tapped.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Today’s Daily is ready', {
    body: d.body || 'Same 20 questions for everyone. One try.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'daily',
    data: { url: d.url || '/?view=daily' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) { open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
