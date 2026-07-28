/* clarity.js — 立欣診所 Microsoft Clarity 行為分析共用腳本 v1.0（2026-07-28）
   專案 ID：x1upcbb7fw（院長 2026-07-28 於 Clarity 後台建立並指示掛載）。
   內容：Microsoft 官方 <head> 片段原封不動封裝成同網域外部檔，
        比照 /cta-track.js 慣例以 <script src="/clarity.js" defer> 掛在 </head> 前，
        避免 58 頁各自內嵌一份、日後換 ID 要改 58 個檔。
   用途：熱圖（heatmap）與工作階段錄影（session recording），
        用於看家長在哪一段內容停住、CTA 有沒有被看到（03 量測制度）。
   ⚠️ 隱私：Clarity 會寫入 _clck／_clsk cookie 並錄製滑鼠／捲動／點擊軌跡，
        揭露程度高於 GA4 匿名統計。privacy.html 之揭露文字屬可見文字，
        須經院長逐字核可後另批補上（本檔掛載時尚未補；見 00 §6 待辦）。
   ⚠️ 新增頁面須一併掛載：跑 internal/tools/patch_clarity.py（冪等）。 */
(function (c, l, a, r, i, t, y) {
  c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
  t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
  y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
})(window, document, "clarity", "script", "x1upcbb7fw");
