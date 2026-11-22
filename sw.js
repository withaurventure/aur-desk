// AUR Desk — service worker: lets the app open with no internet.
// Bump VERSION whenever you upload new files, so the phone picks them up.
const VERSION = 'aur-desk-v7';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/companies.js',
  'js/db.js',
  'js/ui.js',
  'js/lock.js',
  'js/clients.js',
  'js/settings.js',
  'js/docs.js',
  'js/quote.js',
  'js/pdf.js',
  'js/money.js',
  'js/calc.js',
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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: cache first. Fonts: cache after first load. Everything else: network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');
  if (url.origin === location.origin || isFont) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }))
    );
  }
});
