/* ============================================================
   立欣診所 PWA：全站共用註冊腳本（各頁 <head> 以 defer 載入）
   功能：
   1. 註冊 /sw.js（失敗僅記 console，不影響頁面）
   2. 攔存 Android/Chrome 的 beforeinstallprompt，
      供 /app.html 的「一鍵安裝」按鈕使用
   3. 安裝完成時回報 GA4 事件 pwa_installed
   ============================================================ */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('[LHPC PWA] Service Worker 註冊失敗：', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__lhpcInstallPrompt = e;
    try {
      document.dispatchEvent(new CustomEvent('lhpc-installable'));
    } catch (err) { /* 舊瀏覽器忽略 */ }
  });

  window.addEventListener('appinstalled', function () {
    window.__lhpcInstallPrompt = null;
    if (typeof gtag === 'function') {
      gtag('event', 'pwa_installed', { method: 'homescreen' });
    }
  });
})();
