/* cta-track.js — 立欣診所 GA4 轉換事件共用腳本 v1.1（2026-08-02）
   v1.0（2026-07-10）來源：00 §6「GA4 轉換事件重掛」提案，院長 2026-07-10 核可（全站掛載、growth 例外納入）。
   事件定義（03 §7）：call_click（電話）／line_click（LINE）／queue_click（看診進度）
                     ／growth_open（生長工具開啟，於 growth 頁載入時計一次）。
   行為：頁面已有 gtag（index/visit-guide/app）→ 沿用；沒有 → 自動補載 GA4。
   v1.1 新增「AI 引薦分類」：GA4 預設把 ChatGPT／Perplexity／Gemini／Copilot 等一律丟進
        Referral 同一桶，看不出 AI 助理實際帶進多少家長（＝03 的 GEO 成效無法量化）。
        本版於進站時判斷來源，送一次 `ai_referral` 事件，並把 `ai_source` 掛到本 session
        後續所有事件（含四個既有 CTA 事件）。**GA4 後台須註冊自訂維度才看得到**，
        步驟見 `internal/03_量測與回饋制度.md` §八。既有事件名一律不動（保持可比較性）。
   隱私：只取來源**網域（hostname）**，**不取 referrer 完整網址**——Perplexity 等平台的
        來源網址會帶提問內容，送進 GA4 等於把家長的問句存進第三方。本腳本不蒐集個資、
        不讀表單內容；privacy.html 已揭露全站 GA4 匿名統計，本版未新增第三方或新資料類別。 */
(function () {
  var GA_ID = 'G-F5R274YH9N';
  var SESSION_KEY = 'lh_ai_ref';

  /* AI 助理網域 → 分類代號。比對前已去 www.；採「完全相同或其子網域」比對，
     故 perplexity.ai 一列即涵蓋 www.perplexity.ai。新增平台只要加一列。 */
  var AI_HOSTS = [
    ['chatgpt.com', 'chatgpt'],
    ['chat.openai.com', 'chatgpt'],
    ['openai.com', 'chatgpt'],
    ['perplexity.ai', 'perplexity'],
    ['gemini.google.com', 'gemini'],
    ['bard.google.com', 'gemini'],
    ['claude.ai', 'claude'],
    ['copilot.microsoft.com', 'copilot'],
    ['edgeservices.bing.com', 'copilot'],
    ['m365.cloud.microsoft', 'copilot'],
    ['grok.com', 'grok'],
    ['x.ai', 'grok'],
    ['meta.ai', 'meta_ai'],
    ['deepseek.com', 'deepseek'],
    ['mistral.ai', 'mistral'],
    ['poe.com', 'poe'],
    ['you.com', 'you'],
    ['phind.com', 'phind'],
    ['kimi.com', 'kimi'],
    ['moonshot.cn', 'kimi'],
    ['doubao.com', 'doubao'],
    ['felo.ai', 'felo'],
    ['genspark.ai', 'genspark'],
    ['iask.ai', 'iask']
  ];

  /* utm_source／ref 參數用的關鍵詞（ChatGPT 會自動加 ?utm_source=chatgpt.com，
     部分平台只給 perplexity 這種非網域字串）。只收辨識度高、不致誤判的詞。 */
  var AI_TOKENS = [
    ['chatgpt', 'chatgpt'],
    ['openai', 'chatgpt'],
    ['perplexity', 'perplexity'],
    ['gemini', 'gemini'],
    ['claude', 'claude'],
    ['copilot', 'copilot'],
    ['bingchat', 'copilot'],
    ['grok', 'grok'],
    ['deepseek', 'deepseek'],
    ['mistral', 'mistral'],
    ['genspark', 'genspark']
  ];

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function normHost(h) {
    h = (h || '').toLowerCase().trim();
    return h.indexOf('www.') === 0 ? h.slice(4) : h;
  }

  function matchHost(host) {
    for (var i = 0; i < AI_HOSTS.length; i++) {
      var d = AI_HOSTS[i][0];
      if (host === d || (host.length > d.length && host.slice(-(d.length + 1)) === '.' + d)) {
        return AI_HOSTS[i][1];
      }
    }
    return null;
  }

  function matchToken(v) {
    for (var i = 0; i < AI_TOKENS.length; i++) {
      if (v.indexOf(AI_TOKENS[i][0]) !== -1) return AI_TOKENS[i][1];
    }
    return null;
  }

  /* 只取 hostname；完整網址（可能含提問內容）一律不進 GA4 */
  function referrerHost() {
    var m = /^https?:\/\/([^/?#]+)/i.exec(document.referrer || '');
    return m ? normHost(m[1].split(':')[0]) : '';
  }

  function queryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).toLowerCase().trim(); }
    catch (e) { return m[1].toLowerCase().trim(); }
  }

  function detect() {
    var host = referrerHost();
    if (host && host !== normHost(location.hostname)) {
      var byHost = matchHost(host);
      if (byHost) return { source: byHost, host: host, method: 'referrer' };
    }
    var names = ['utm_source', 'ref', 'ref_src'];
    for (var i = 0; i < names.length; i++) {
      var v = normHost(queryParam(names[i]));
      if (!v) continue;
      var bySource = matchHost(v) || matchToken(v);
      if (bySource) return { source: bySource, host: v.slice(0, 100), method: 'utm' };
    }
    return null;
  }

  function readSession() {
    try { return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function writeSession(o) {
    try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(o)); } catch (e) { /* 隱私模式：略過 */ }
  }

  /* 本次進站判得出 AI 來源＝新偵測；判不出但同 session 稍早有＝沿用
     （站內瀏覽的 referrer 是自家網域、也不帶 utm，故只會在落地頁判到一次） */
  var hit = detect();
  var stored = readSession();
  var isNew = !!hit && (!stored || stored.source !== hit.source);
  var aiRef = hit || stored;

  if (aiRef && aiRef.source) {
    window.__lhAiReferral = aiRef;                    // 供驗證讀取，僅網域層級、無個資
    window.gtag('set', { ai_source: aiRef.source });  // 本 session 後續事件一併帶上
  }
  if (isNew) {
    writeSession(hit);
    window.gtag('event', 'ai_referral', {
      ai_source: hit.source,
      ai_referrer: hit.host,
      ai_detect: hit.method,
      landing_path: location.pathname
    });
  }

  function withAi(params) {
    if (aiRef && aiRef.source) params.ai_source = aiRef.source;
    return params;
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    var name = h.indexOf('tel:') === 0 ? 'call_click'
      : (h.indexOf('line.me') !== -1 || h.indexOf('lin.ee') !== -1) ? 'line_click'
        : h.indexOf('mainpi.com') !== -1 ? 'queue_click' : null;
    if (name) window.gtag('event', name, withAi({ link_url: h, from_path: location.pathname }));
  }, true);
  if (location.pathname === '/growth.html' || location.pathname === '/growth') {
    window.gtag('event', 'growth_open', withAi({ from_path: location.pathname }));
  }
})();
