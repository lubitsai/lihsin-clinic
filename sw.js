/* ============================================================
   立欣診所 PWA Service Worker
   版本：lhpc-pwa-v1（2026-07-04）
   ------------------------------------------------------------
   快取策略（保守設計，內容更新永遠優先）：
   1. HTML 導航請求 → network-first：
      永遠先抓網路最新版（門診異動、疫苗公告不會被舊快取蓋住），
      斷線時才退回快取，再退回 /offline.html。
   2. 同網域靜態資源（css/圖片/js）→ stale-while-revalidate：
      先給快取秒開，背景更新下次生效。
   3. 跨網域（MainPI、GA4、Chatbase、LINE、Google Fonts）→ 完全不攔截，
      交由瀏覽器原生處理，看診進度絕不吃到快取。
   ------------------------------------------------------------
   更新方式：改動本檔任一位元組（例如把 VERSION 尾碼 +1）即觸發
   瀏覽器重新安裝並清除舊版快取。
   移除方式（kill switch）：見 docs/PWA部署包說明 §7。
   ============================================================ */
'use strict';

const VERSION = 'lhpc-pwa-v1';
const PRECACHE = [
  '/offline.html',
  '/tailwind.css',
  '/manifest.webmanifest',
  '/images/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理 GET；POST 等一律放行
  if (req.method !== 'GET') return;

  // 跨網域一律不攔截（MainPI 即時叫號、GA、Chatbase、字型…）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ── 1) HTML 導航：network-first ──
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // ── 2) 同網域靜態資源：stale-while-revalidate ──
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
