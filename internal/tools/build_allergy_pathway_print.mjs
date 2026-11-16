// 過敏追蹤路線紙本（提案 internal/提案_過敏長期照護路線_檢測環境追蹤_20261116.md）
// 產出 internal/print/ 三份 PDF＋對應 .html.txt：
//   allergy-pathway-card-YYYYMMDD    入口小卡（90×54mm，A4 每頁 10 張，流水號 T＝蔡醫師、L＝李醫師）
//   allergy-pathway-checklist-YYYYMMDD 居家環境檢核表（A5）
//   allergy-pathway-record-YYYYMMDD  回診追蹤記錄單＋試跑登記表（A4，院內用）
// 用法：node internal/tools/build_allergy_pathway_print.mjs [--date 20261116] [--count 100] [--start 1]
//   --count：每位醫師印幾張（取 10 的倍數），--start：流水號起始號（加印時接續上一批）
// ⚠️ 小卡與檢核表文字＝院長 2026-11-16 逐字核可版，改字前先取得核可。
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// playwright 裝在全域，ESM import 解析不到，用 require
const { chromium } = createRequire(import.meta.url)("playwright");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), [])
);
const DATE = args.date || "20261116";
const COUNT = Math.ceil(Number(args.count || 100) / 10) * 10;
const START = Number(args.start || 1);
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "print");

const BASE = `*{box-sizing:border-box}
body{font-family:"WenQuanYi Zen Hei","Noto Sans TC",sans-serif;color:#222;margin:0}
h1{text-align:center;letter-spacing:2pt;margin:0}
h2{color:#7a4a1f;border-bottom:1.5px solid #A0662F;padding-bottom:0.5mm}
.foot{color:#555;text-align:center;border-top:1px solid #ccc;padding-top:1.5mm}`;

// ── 1. 入口小卡 ─────────────────────────────────────────────
function card(serial) {
  return `<div class="card"><div class="top"><span class="clinic">立欣診所</span><span class="no">No. ${serial}</span></div>
<p class="t">孩子咳嗽、鼻塞常常好了又來？</p>
<p>咳嗽超過 2～3 週仍未改善、半夜或清晨反覆咳，或是長期鼻塞、打噴嚏、皮膚癢，有些和過敏有關。</p>
<p>可以預約過敏門診，由醫師依症狀和病史評估是否需要檢查。</p>
<p class="c">預約：LINE @lhpedclinic｜電話 06-2516086</p>
<p class="e">本院為門診、非急診；孩子若喘到說不出話、嘴唇發紫，請立即送急診或撥 119。</p></div>`;
}
const serials = [];
for (const p of ["T", "L"]) for (let i = 0; i < COUNT; i++) serials.push(p + String(START + i).padStart(3, "0"));
const pages = [];
for (let i = 0; i < serials.length; i += 10) pages.push(`<div class="sheet">${serials.slice(i, i + 10).map(card).join("")}</div>`);
const cardHtml = `<!DOCTYPE html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>過敏追蹤路線 入口小卡</title>
<style>${BASE}
@page{size:A4;margin:0}
.sheet{width:210mm;height:297mm;padding:13.5mm 15mm;display:grid;grid-template-columns:90mm 90mm;grid-auto-rows:54mm;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.card{border:0.3mm dashed #bbb;padding:3.2mm 4mm;font-size:8.6pt;line-height:1.45;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:0.4mm solid #A0662F;padding-bottom:0.6mm;margin-bottom:1.2mm}
.clinic{font-size:7.4pt;font-weight:bold;color:#7a4a1f;letter-spacing:1pt}
.no{font-size:7pt;color:#555;font-family:monospace}
p{margin:0 0 0.8mm;text-align:justify}
.t{font-size:12pt;font-weight:bold;color:#9b2c1f;margin-bottom:1.2mm}
.c{font-weight:bold;margin-top:auto}
.e{font-size:6.8pt;color:#555;margin:0}
</style></head><body>
${pages.join("\n")}
</body></html>`;

// ── 2. 居家環境檢核表 ───────────────────────────────────────
const box = `<span class="bx"></span>`;
const checklistHtml = `<!DOCTYPE html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>居家環境檢核表</title>
<style>${BASE}
@page{size:A5;margin:11mm 12mm 10mm}
body{font-size:10pt;line-height:1.5}
h1{font-size:16pt;margin-bottom:3mm}
h2{font-size:10.5pt;margin:4mm 0 1.5mm}
.head{border:1px solid #A0662F;background:#fbf3ea;padding:2mm 3mm;line-height:2.1}
.blank{display:inline-block;border-bottom:1px solid #444;min-width:28mm;margin-right:4mm}
.bx{display:inline-block;width:4mm;height:4mm;border:1.2px solid #444;vertical-align:-0.6mm;margin:0 0.8mm}
ol{margin:0;padding-left:0;list-style:none}
li{margin:0 0 1.6mm;padding-left:8mm;text-indent:-8mm}
li .bx{margin:0 2mm 0 0}
.n{display:inline-block;width:0;overflow:visible}
.tail{margin-top:4mm;font-size:8.8pt;background:#fbf3ea;border-left:4px solid #A0662F;padding:1.5mm 3mm}
.tail p{margin:0 0 0.8mm}
.foot{font-size:8pt;margin-top:3mm}
</style></head><body>
<h1>居家環境檢核表</h1>
<div class="head">孩子姓名<span class="blank"></span>日期<span class="blank"></span><br>醫師勾選本次先做：${box}${box}${box}</div>

<h2>甲部分：塵蟎（檢測塵蟎陽性，或醫師判斷與塵蟎有關時使用）</h2>
<ol>
<li>${box}1. 床墊和枕頭用防蟎套包起來（選有 IBT 防蟎認證、六面全包式的）</li>
<li>${box}2. 床單、被套、枕套每 1～2 週清洗一次：先用 55℃ 以上熱水泡 10 分鐘，或用洗烘脫洗衣機先烘過，再正常清洗</li>
<li>${box}3. 室內濕度維持在 50～60%，保持通風</li>
<li>${box}4. 孩子房間少放厚重布窗簾、布地毯、布沙發和絨毛玩偶</li>
</ol>

<h2>乙部分：其他誘發因子（只勾選，回診時跟醫師討論）</h2>
<ol>
<li>${box}5. 家裡有人抽菸</li>
<li>${box}6. 浴室、牆角或衣櫃有看得到的黴斑</li>
<li>${box}7. 家裡有養有毛的寵物</li>
<li>${box}8. 家裡常看到蟑螂</li>
</ol>

<div class="tail">
<p>做好環境整理之後，症狀仍反覆發作或持續變嚴重，請回診讓醫師評估。檢測結果要搭配症狀與病史判讀，不單以數值決定處置。</p>
<p>本院為門診、非急診；孩子若喘到說不出話、嘴唇發紫，請立即送急診或撥 119。</p>
</div>
<p class="foot">立欣診所｜台南市北區育德路467號｜06-2516086｜LINE @lhpedclinic</p>
</body></html>`;

// ── 3. 回診追蹤記錄單＋試跑登記表（院內用） ─────────────────
const visitRows = ["首次評估", "第 1 次回診", "第 2 次回診", "第 3 次回診", "第 4 次回診", "第 5 次回診"]
  .map((v) => `<tr><th>${v}</th><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`)
  .join("");
const logRows = Array.from({ length: 26 }, () => `<tr>${"<td></td>".repeat(8)}</tr>`).join("");
const recordHtml = `<!DOCTYPE html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>過敏追蹤路線 回診追蹤記錄單與試跑登記表</title>
<style>${BASE}
@page{size:A4;margin:12mm 13mm 11mm}
body{font-size:9.5pt;line-height:1.45}
h1{font-size:15pt;margin-bottom:1mm}
.sub{text-align:center;color:#555;font-size:8.5pt;margin:0 0 3mm}
h2{font-size:10.5pt;margin:4mm 0 1.5mm}
.blank{display:inline-block;border-bottom:1px solid #444;min-width:30mm;margin-right:4mm}
.bx{display:inline-block;width:3.6mm;height:3.6mm;border:1.2px solid #444;vertical-align:-0.5mm;margin:0 1mm 0 0}
.line{margin:0 0 2.2mm}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #888;padding:1mm;font-size:8.3pt;text-align:center;vertical-align:middle}
thead th{background:#fbf3ea;color:#5a3412}
tbody td{height:17mm}
.log tbody td{height:8.6mm}
.note{background:#fbf3ea;border-left:4px solid #A0662F;padding:1.5mm 3mm;margin:3mm 0 0;font-size:8.3pt}
.note p{margin:0 0 0.6mm}
.pb{page-break-before:always}
</style></head><body>
<h1>過敏追蹤路線｜回診追蹤記錄單</h1>
<p class="sub">院內用，夾入病歷。負責：蔡醫師</p>
<p class="line">姓名<span class="blank"></span>病歷號<span class="blank"></span>小卡流水號<span class="blank" style="min-width:22mm"></span><span style="font-size:8pt;color:#555">T＝蔡醫師、L＝李醫師</span></p>
<p class="line">首次評估日<span class="blank"></span>年齡<span class="blank" style="min-width:14mm"></span>主要問題：<span class="bx"></span>氣喘 <span class="bx"></span>異位性皮膚炎 <span class="bx"></span>過敏性鼻炎</p>
<p class="line">檢測結果重點<span class="blank" style="min-width:140mm"></span></p>
<p class="line">LINE 回診提醒：<span class="bx"></span>已回傳同意，日期<span class="blank" style="min-width:20mm"></span><span class="bx"></span>未回覆（不發、不追問）<span class="bx"></span>停止提醒，日期<span class="blank" style="min-width:20mm"></span></p>

<h2>追蹤紀錄</h2>
<table>
<colgroup><col style="width:15%"><col style="width:10%"><col style="width:10%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:12%"><col style="width:17%"></colgroup>
<thead>
<tr><th rowspan="2"></th><th rowspan="2">日期</th><th rowspan="2">C-ACT／ACT<br>總分</th><th rowspan="2">POEM<br>總分</th><th colspan="3">鼻炎：過去 7 天有幾天（0～7）</th><th rowspan="2">檢核表<br>先做／做到</th><th rowspan="2">備註</th></tr>
<tr><th>鼻塞</th><th>打噴嚏</th><th>影響睡眠</th></tr>
</thead>
<tbody>${visitRows}</tbody>
</table>

<div class="note">
<p>首次評估後 4～8 週回診，之後由醫師依控制狀況決定間隔。家長回傳同意後才可用 LINE 提醒（邱律師 2026-11-16 確認）。</p>
<p>C-ACT（4～11 歲）／ACT（12 歲以上）、POEM 用另外印製的問卷填寫，本表只記總分。鼻炎三項為院內自訂題目（院長 2026-11-16 定稿），不是標準量表。</p>
<p>分數只給醫師判斷與跟家長說明，不對外發表、不寫成成效宣傳。</p>
</div>

<div class="pb"></div>
<h1>過敏追蹤路線｜試跑登記表</h1>
<p class="sub">試跑 2026-12-01～2027-02-28。<b>不寫姓名與病歷號。</b>2027-03 結果寫進 03 月報。</p>
<table class="log">
<colgroup><col style="width:11%"><col style="width:12%"><col style="width:13%"><col style="width:15%"><col style="width:13%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>
<thead><tr><th>小卡流水號</th><th>發卡日</th><th>評估日</th><th>LINE 同意<br>（日期／未回覆）</th><th>8 週內回診<br>（是／否）</th><th>先做項目數</th><th>做到項目數</th><th>備註</th></tr></thead>
<tbody>${logRows}</tbody>
</table>
</body></html>`;

// ── 輸出 ───────────────────────────────────────────────────
const files = [
  [`allergy-pathway-card-${DATE}`, cardHtml],
  [`allergy-pathway-checklist-${DATE}`, checklistHtml],
  [`allergy-pathway-record-${DATE}`, recordHtml],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, html] of files) {
  writeFileSync(join(OUT, `${name}.html.txt`), html);
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: join(OUT, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
  console.log("wrote", name);
}
await browser.close();
