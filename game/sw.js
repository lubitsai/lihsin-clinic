const CACHE = 'lihsin-deer-doctor-sites-v9';
const ASSETS = [
  './', './game.html', './manifest.webmanifest', './brand-3d.png', './mascot-3d.png', './app-icon-3d.png',
  './patient-3d.png', './patient-mouth-3d.png', './tool-stethoscope-3d.png', './tool-otoscope-3d.png',
  './tool-throat-3d.png', './tool-nose-3d.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./game.html'))));
});
