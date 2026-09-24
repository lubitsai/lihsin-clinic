/* ============================================================
   立欣診所 PWA Service Worker
   版本：lhpc-pwa-v5（2026-09-24；v4＝2026-09-16、v3＝2026-09-10、v2＝2026-09-07、v1＝2026-07-04）
   ------------------------------------------------------------
   快取策略（保守設計，內容更新永遠優先）：
   1. HTML 導航請求 → network-first：
      永遠先抓網路最新版（門診異動、疫苗公告不會被舊快取蓋住），
      斷線時才退回快取，再退回 /offline.html。
   2. 同網域靜態資源（css/圖片/js）→ stale-while-revalidate：
      先給快取秒開，背景更新下次生效。
   3. 跨網域（MainPI、GA4、LINE、Google Fonts）→ 完全不攔截，
      交由瀏覽器原生處理，看診進度絕不吃到快取。
   4. /clinic-assistant/（線上小幫手，2026-09-24 起）→ 完全不攔截：
      knowledge.json 內含門診異動與有期限公告，走第 2 條快取優先的話，
      回訪者會先看到上一版（例如已過期的連假公告）；交給瀏覽器依
      Netlify 預設 must-revalidate 處理，每次開啟都是最新版。v5 即為此 bump。
   ------------------------------------------------------------
   更新方式：改動本檔任一位元組（例如把 VERSION 尾碼 +1）即觸發
   瀏覽器重新安裝並清除舊版快取。
   ⚠️ 反過來也成立（院長 2026-09-07 立規，見 01 防呆 18）：改動任何
      **同網域共用靜態資源**（/cta-track.js、/clarity.js、/pwa-register.js、
      /tailwind.css）都必須**同一個 commit 把本檔 VERSION 尾碼 +1**。
      因為上面第 2 條是 stale-while-revalidate（`cached || network`）＝
      快取優先：不 bump 的話，回訪者第一次載入拿到的仍是舊版資產，
      要再載入一次頁面才生效。它會自我修復，但每個回訪者慢一拍——
      掛新的 GA4 事件時，那一拍正好落在最需要資料的觀察窗裡。
      實例：09-05 掛 booking_click／directions_click 未 bump，
      09-05～09-07 的新事件量被壓低（量測紀錄_202609 B-5 ②）。
   ⚠️ 2026-09-10 擴充：**同檔名替換既有圖片也適用**，即使該圖不在
      check_sw_bump.py 的 SHARED_ASSETS 閘門清單內（該清單只收共用根資產，
      CI 不會擋內容圖）。理由同上——策略第 2 條明寫「css／圖片／js」（含圖片），
      回訪者第一次載入拿到的仍是舊圖。v3 即為此而 bump：covid-19-2026 的
      衛教圖換成 9/8 版，**舊圖寫「疫情升溫／NB.1.8.1」、新內文寫
      「疫情下降／PQ.16.1.1」**，不 bump 的話回訪者會看到圖文互相矛盾的
      醫療敘述——比單獨看到舊圖或舊文都更糟。
      判準：**換的圖若與同批的文字改動互為佐證，就必須 bump。**
      ⚠️ 2026-09-16 第 2 次踩到（v4 即為此 bump）：9/16 流感頁換版**覆蓋了 5 個
      同檔名圖片**（flu-vaccine-2026-infographic/.webp/-768.webp、-thumb.jpg/.webp）
      又同批改了文字，卻**未 bump** → 院長回報「首頁預覽圖沒改到」：文章頁已是新圖、
      **首頁最新消息卡仍是舊縮圖**（寫「預購中／即日起至 9/15 早鳥」）。
      **失效模式最惡劣的地方**：頁面文字已改成現況、圖卻還在喊早鳥預購，
      家長看到的是自相矛盾的服務資訊，比整批沒上線更糟。
      **根因是判斷而非疏忽**：同一天的前一批（09-15 輔流禦）確實是**新增**新檔名圖
      （新 URL、無舊快取），把那個結論套到本批的**覆蓋**就錯了。
      ⭐ 規則：**判斷依據是「這個 URL 之前存不存在」，不是「這批有沒有動圖」**——
      新檔名＝新 URL＝免 bump；同檔名覆蓋＝既有 URL＝一定要 bump。
      `git status` 顯示 `M`（modified）就是覆蓋、顯示 `??`／`A` 才是新檔。
   移除方式（kill switch）：見 docs/PWA部署包說明 §7。
   ============================================================ */
'use strict';

const VERSION = 'lhpc-pwa-v5';
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

  // 跨網域一律不攔截（MainPI 即時叫號、GA、字型…）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 線上小幫手的資料與程式一律走網路（見檔頭第 4 條）
  if (url.pathname.startsWith('/clinic-assistant/')) return;

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
