/* cta-track.js — 立欣診所 GA4 轉換事件共用腳本 v1.0（2026-07-10）
   來源：00 §6「GA4 轉換事件重掛」提案，院長 2026-07-10 核可（全站掛載、growth 例外納入）。
   事件定義（03 §7）：call_click（電話）／line_click（LINE）／queue_click（看診進度）
                     ／growth_open（生長工具開啟，於 growth 頁載入時計一次）。
   行為：頁面已有 gtag（index/visit-guide/app）→ 沿用；沒有 → 自動補載 GA4。
   隱私：privacy.html 已揭露全站 GA4 匿名統計；本腳本不蒐集個資、不讀表單內容。 */
(function () {
  var GA_ID = 'G-F5R274YH9N';
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
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    var name = h.indexOf('tel:') === 0 ? 'call_click'
      : (h.indexOf('line.me') !== -1 || h.indexOf('lin.ee') !== -1) ? 'line_click'
        : h.indexOf('mainpi.com') !== -1 ? 'queue_click' : null;
    if (name) window.gtag('event', name, { link_url: h, from_path: location.pathname });
  }, true);
  if (location.pathname === '/growth.html' || location.pathname === '/growth') {
    window.gtag('event', 'growth_open', { from_path: location.pathname });
  }
})();
