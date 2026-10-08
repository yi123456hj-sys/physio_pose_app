// sw.js — cache-first service worker. Model and WASM files are fetched
// at runtime from CDNs and cached by the browser's HTTP cache, not here.
const CACHE = 'physiopose-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/i18n.js',
  './js/mediapipe.js',
  './js/pose_math.js',
  './js/sts_detector.js',
  './js/tug.js',
  './js/rom.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        // cache same-origin static assets for offline use
        if (resp.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
