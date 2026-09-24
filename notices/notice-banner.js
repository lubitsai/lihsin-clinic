/* notice-banner.js — 立欣診所門診異動橫幅 v1.0（2026-09-25g）
   讀 /notices/notices.json，把「仍在效期內」的門診異動顯示在頁面上，讓從服務頁直接進站的家長
   也看得到首頁 #clinic-notice 的公告（院長 2026-09-25 裁示題 5「共用公告檔＋共用小程式」）。
   - 頁面有 [data-notice-slot] → 在該處顯示一行提示（首頁門診時間表上方用，連到同頁 #clinic-notice）。
   - 否則 → 在 <main> 最前面插一條橫幅，連到首頁公告。
   - end 當日（含）仍顯示、翌日起隱藏，以 UTC+8 判斷（與首頁 data-expires 同規則）。
   - 讀取失敗或沒有進行中的公告 → 什麼都不顯示（不影響頁面其他部分）。
   樣式全部 inline：不依賴 tailwind.css，免得新 class 被 purge。
   本檔與 notices.json 放在 /notices/，sw.js 不攔截（見 sw.js 檔頭第 5 條），改動不必 bump。 */
(function () {
  function today() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function track(id) {
    try { if (window.gtag) window.gtag('event', 'notice_click', { notice_id: id }); } catch (e) {}
  }
  var BOX = 'display:block;border:2px solid #E8A23A;background:#FFF8EC;color:#5B4A2E;' +
    'border-radius:1rem;padding:.75rem 1rem;line-height:1.7;font-size:.95rem;text-decoration:none;';
  var LINK = 'color:#7C9A6E;font-weight:700;text-decoration:underline;white-space:nowrap;';

  function render(items) {
    var slots = document.querySelectorAll('[data-notice-slot]');
    if (slots.length) {
      var dates = items.map(function (n) { return esc(n.dates); }).join('；');
      for (var i = 0; i < slots.length; i++) {
        slots[i].innerHTML = '<a href="#clinic-notice" style="' + BOX + 'text-align:center;">' +
          '📢 近期門診異動：' + dates + '。<span style="' + LINK + '">看公告 ↓</span></a>';
        slots[i].querySelector('a').addEventListener('click', function () { track('slot'); });
        slots[i].hidden = false;
      }
      return;
    }
    var main = document.querySelector('main');
    if (!main) return;
    var wrap = document.createElement('aside');
    wrap.setAttribute('aria-label', '門診異動公告');
    wrap.style.cssText = 'max-width:64rem;margin:1rem auto;padding:0 1rem;';
    wrap.innerHTML = items.map(function (n) {
      return '<div style="' + BOX + 'margin-bottom:.5rem;">📢 <strong>' + esc(n.summary) + '</strong> ' +
        '<a href="/#clinic-notice" data-notice-id="' + esc(n.id) + '" style="' + LINK + '">看完整公告 →</a></div>';
    }).join('');
    var links = wrap.querySelectorAll('a[data-notice-id]');
    for (var j = 0; j < links.length; j++) {
      links[j].addEventListener('click', function () { track(this.getAttribute('data-notice-id')); });
    }
    main.insertBefore(wrap, main.firstChild);
  }

  function load() {
    fetch('/notices/notices.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.notices) return;
        var t = today();
        var items = data.notices.filter(function (n) {
          return n.end >= t && (!n.show_from || n.show_from <= t);
        }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
        if (items.length) render(items);
      })
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
