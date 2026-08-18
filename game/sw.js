const CACHE = 'lihsin-deer-doctor-sites-v10';
// 2026-08-18：'./'（＝/game/ 外框頁）已移出預快取清單。該頁上架 SEO 後是官網內容頁，
// 必須沿站台政策由根 /sw.js 以 network-first 供應，內容更新才會立刻生效；
// 留在這裡會被本 SW 的 cache-first 凍住，改了首頁文案玩過的裝置永遠看不到。
const ASSETS = [
  './game.html', './manifest.webmanifest', './brand-3d.png', './mascot-3d.png', './app-icon-3d.png',
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
  // 外框頁（/game/ 與 /game/index.html）是官網 SEO 頁：不攔截，交給站台根 SW 的
  // network-first。本 SW 只負責遊戲本體與 3D 圖等自有資產的離線快取。
  const url = new URL(event.request.url);
  const scope = new URL('./', self.location).pathname;
  if (url.pathname === scope || url.pathname === scope + 'index.html') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./game.html'))));
});
