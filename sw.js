// AUR Desk — service worker: lets the app open with no internet.
// Bump VERSION whenever you upload new files. Updates show on the next open (or right away while open).
const VERSION = 'aur-desk-v12';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/companies.js',
  'js/db.js',
  'js/ui.js',
  'js/security/lock.js',
  'js/security/privacy.js',
  'js/clients.js',
  'js/settings.js',
  'js/docs.js',
  'js/quote.js',
  'js/pdf.js',
  'js/money.js',
  'js/calc.js',
  'js/finance.js',
  'js/backup.js',
  'vendor/qrcode.js',
  'vendor/jspdf.umd.min.js',
  'fonts/Montserrat-Regular.ttf',
  'fonts/Montserrat-SemiBold.ttf',
  'fonts/Montserrat-Bold.ttf',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'logos/aur-ventures.jpg',
  'logos/aur-studio.png',
  'logos/aur-printing-studio.png',
];

// Install: download every file fresh (skip the browser's own cache) so an update is never half old.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: try the internet first (so updates appear at once), fall back to the saved copy offline.
// Fonts: saved copy first. Everything else: untouched.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');

  if (isFont) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([
        fetch(req, { cache: 'no-cache' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
