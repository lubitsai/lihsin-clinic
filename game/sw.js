const CACHE = 'lihsin-deer-doctor-sites-v11';
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
  // 2026-09-17：跨網域一律不攔截（GA4／Clarity／Google Fonts／Chatbase…），與站台根
  // sw.js 第 3 條同一政策。先前沒有這道判斷，本 SW 會把 /game/ 頁面發出的**所有**
  // 跨網域請求納管，造成兩個實測到的後果：
  //   ①下面的 cache-first 讓 GA4／Clarity 一旦快取就**永不重新驗證**（等同凍住）；
  //   ②網路失敗時落到下面的 catch，回傳 game.html 的 HTML 當成 JS
  //     → `SyntaxError: Unexpected token '<'`。擋廣告／DNS 封鎖 GA 的裝置每次必中。
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    // 只快取成功回應：原本連 404／500 也會被 put 進快取並在 cache-first 下永久命中。
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => (
    // game.html 後備**只給導覽請求**。原本不分請求型別一律回 game.html，等於把 64KB
    // 的 HTML 當成 JS／圖片／CSS 送出去——離線時遊戲頁的每個子資源都會拿到 HTML。
    event.request.mode === 'navigate' ? caches.match('./game.html') : Response.error()
  ))));
});
