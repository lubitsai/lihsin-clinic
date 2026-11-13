/* ============================================================
   立欣診所 PWA Service Worker
   版本：lhpc-pwa-v15（2026-11-13 衛教總覽搜尋索引不攔截；v14＝2026-11-11 離線可用：急症／發燒／燙傷衛教、生長評估、小幫手離線版、離線頁常態門診表；v13＝2026-11-09 學員專區；v12＝2026-11-08；v11＝2026-11-07 PR #532；v10＝2026-10-19、v9＝2026-09-29b、v8＝2026-09-29、v7＝2026-09-26、v6＝2026-09-25、v5＝2026-09-24、v4＝2026-09-16、v3＝2026-09-10、v2＝2026-09-07、v1＝2026-07-04）
   ------------------------------------------------------------
   快取策略（保守設計，內容更新永遠優先）：
   1. HTML 導航請求 → network-first：
      永遠先抓網路最新版（門診異動、疫苗公告不會被舊快取蓋住），
      斷線時才退回快取，再退回 /offline.html。
   2. 同網域靜態資源（css/圖片/js）→ stale-while-revalidate：
      先給快取秒開，背景更新下次生效。
   3. 跨網域（MainPI、GA4、LINE、Google Fonts）→ 完全不攔截，
      交由瀏覽器原生處理，看診進度絕不吃到快取。
   4. /clinic-assistant/（線上小幫手，2026-09-24 起）→ network-first（2026-11-11 v14 起）：
      knowledge.json 內含門診異動與有期限公告，**不能**走第 2 條快取優先
      （回訪者會先看到上一版，v5 即為此改成不攔截）。v14 改成「網路優先、斷線才用快取」：
      有網路時永遠是最新版（與 v5～v13 相同），沒網路時用上次存下的版本，
      小幫手自己會顯示「目前離線中」提醒；過期公告由 search.js 依 valid_until 自動隱藏。
   5. /notices/（門診異動橫幅，2026-09-25 起）→ 完全不攔截：
      notices.json 是有期限的公告，理由同第 4 條；notice-banner.js 同目錄一併放行，
      日後改這兩個檔都不必 bump。v6 即為此 bump。
   6. /videos/（宣傳短片，2026-11-08 起）→ 完全不攔截：
      <video> 用 Range 請求分段抓，206 回應進不了 Cache Storage，
      走第 2 條還會把 10 MB 影片整支塞進快取；交給瀏覽器原生處理。v12 即為此 bump。
   7. /members/（減重營養課學員專區，2026-11-09 起）→ 完全不攔截：
      加密教材每份 1～14 MB，走第 2 條會整份塞進快取；學員專區也不該離線留存。v13 即為此 bump。
   7b. /health/search-index.json（衛教總覽頁搜尋索引，2026-11-13 起）→ 完全不攔截：
      每新增一篇衛教文章就會重產；走第 2 條的話回訪者會拿到上一版索引，
      新文章用口語關鍵字搜不到，還得每次 bump。斷線時總覽頁會退回只比對卡片文字。
      日後重產本檔不必 bump。v15 即為此 bump。
   8. 離線可用清單（2026-11-11 v14，院長「部分功能讓使用者離線也可以使用」→「全部」）：
      PRECACHE 加 3 篇衛教（急症判斷／發燒／燙傷）、/growth.html、小幫手 3 檔，
      第一次開官網就先存好，沒看過也能離線打開。
      ⚠️ 這幾個檔**刻意不列入** check_sw_bump.py 受管清單：它們走 network-first
      （HTML 導航與 /clinic-assistant/），連線時每次都抓最新並回寫快取，
      不像 /offline.html 只會從快取讀出；改它們**不必** bump。
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
   ⚠️ 2026-09-26 v7：同網址覆蓋 /docs/lihsin-clinic-intro-2026.pdf（疫苗停打句改
      「最後一診結束前」），PDF 同屬第 2 條快取範圍，依上列判準 bump。
   ⚠️ 2026-09-29 v8：同網址覆蓋 /docs/lihsin-clinic-intro-2026.pdf（衛教文章對齊官網四專欄
      63 篇、20→21 頁），依上列判準 bump。
   ⚠️ 2026-09-29b v9：同日再次同網址覆蓋該 PDF（全篇對齊官網 9 月版），依同一判準 bump。
   ⚠️ 2026-10-19 v10：同網址覆蓋 /favicon.ico（院長提供卡通小鹿向量檔重製，圖案不變、
      提高畫質並增加 64／128px），依上列判準 bump。
   移除方式（kill switch）：見 docs/PWA部署包說明 §7。
   ============================================================ */
'use strict';

const VERSION = 'lhpc-pwa-v15';
const PRECACHE = [
  '/offline.html',
  '/tailwind.css',
  '/manifest.webmanifest',
  '/images/logo.png',
  // 離線可用（v14）：家長沒網路時最可能需要的內容；走 network-first，連線時自動更新
  '/health/child-emergency-signs.html',
  '/health/child-fever.html',
  '/health/child-burns.html',
  '/growth.html',
  '/clinic-assistant/widget.js',
  '/clinic-assistant/search.js',
  '/clinic-assistant/knowledge.json'
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

  // 線上小幫手：網路優先，斷線才用快取（見檔頭第 4 條）
  if (url.pathname.startsWith('/clinic-assistant/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => cached || Response.error()))
    );
    return;
  }
  // 門診異動公告資料與橫幅腳本一律走網路（見檔頭第 5 條）
  if (url.pathname.startsWith('/notices/')) return;
  // 宣傳短片一律走網路（見檔頭第 6 條）
  if (url.pathname.startsWith('/videos/')) return;
  // 學員專區（加密教材）一律走網路（見檔頭第 7 條）
  if (url.pathname.startsWith('/members/')) return;
  // 衛教總覽頁搜尋索引一律走網路（見檔頭第 7b 條）
  if (url.pathname === '/health/search-index.json') return;

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
