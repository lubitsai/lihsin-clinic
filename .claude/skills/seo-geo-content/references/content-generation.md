# 模式 B｜新頁生產（衛教文章／最新消息／服務頁）

適用：R2 三題全過、確定開新頁。藍本＝health 模板歷批先例
（07-12 健檢＋代謝、07-12b 疫苗兩篇、07-16d EV71＋RSV）。
**可見文字全屬新增內容 → 一律待院長逐字核可（merge＝核可），不得先斬後奏。**

## 步驟 1｜選題

- 依 02 §5-2「台南兒科 12 月內容行事曆」＋ §5-3 準則：搜尋需求 > 撰寫方便、
  症狀詞 > 病名詞、一題一頁不與既有文章競食。
- 院長提供海報時：內容忠實海報事實；無原始圖檔時以 Playwright＋sharp 重製
  忠實資訊圖（同檔名供院長日後替換），主圖 1254² jpg＋webp、縮圖 480²。
- 掛名：兒童過敏氣喘／兒科 → 蔡宗儒院長；新生兒 → 李佳玲醫師；
  家醫成人 → 蔡院長家庭醫學專欄。

## 步驟 2｜頁面要件清單（health 模板）

結構（缺一即不完整）：
- [ ] `lang="zh-Hant-TW"`、canonical 非 www、title 含在地尾綴、desc ≤80 字答案前置、
      og/twitter 全欄同步（twitter:card=summary_large_image）、keywords meta 分層
- [ ] **3 Schema**：BreadcrumbList＋MedicalWebPage（含 speakable→`.speakable-summary`
      實掛 DOM、author/reviewedBy/lastReviewed、about MedicalCondition sameAs、
      citation 指向可見權威外連同一機構）＋FAQPage ≥6 題
- [ ] ⚡快速重點速覽定義句（`speakable-summary` class 實際掛在該段上——寫了 ≠ 生效，
      schema 指向的 selector 必對 DOM 實測）
- [ ] 危險徵象紅框（沿用站內既有紅框樣式 `bg-[#fdeeee]`/`border-[#f5c6c6]`/
      `text-[#c0392b]`，避免新 class 被 Tailwind purge）＋就醫時機段＋「非急診」定位段
- [ ] 對應服務頁內連＋權威來源外連（疾管署/國健署/醫學會）＋byline 參考來源
- [ ] 疫苗題：四但書齊備；價格一律不寫數字，以來電/LINE 洽詢帶過
- [ ] sameAs：逐一 web_search 核對中文維基條目名；查不到就略過（誤連比不連更糟）

日期三件組：新頁 datePublished＝dateModified＝lastReviewed＝當日，完整 ISO 8601＋08:00。

## 步驟 3｜六步整合（新頁不是孤島）

1. **首頁專欄卡**：對應專欄 +1 卡（卡標題＝待核可可見文字）；展開鈕「共 N 篇」
   字樣 +1；index 主 WebPage/MedicalWebPage dateModified 跳當日（新增可見卡片）。
2. **sitemap.xml**：+URL（含 image 條目、lastmod）＋首頁 lastmod 同步。
3. **llms.txt／llms-full.txt**：各 +1 條目（時效性公告除外——臨時公告不進 llms）。
4. **作者頁**（dr-tsai/dr-lee）：文章清單 +1（連結文字＝首頁卡標題）、desc/og
   「N 篇」+1、可見最後更新與 dateModified 跳當日、sitemap lastmod 同步。
5. **舊文互連**:相關既有文章加內連（外科式插入，插入後驗證位置）。
6. **驗證**：回 SKILL.md 第 4 步。

## 步驟 4｜技術掛載

- `python3 internal/tools/patch_pwa.py .`（PWA 三件頭；冪等）＋
  `internal/tools/patch_cta.py`（GA4 cta-track；冪等）。
- **Tailwind purge 防線**：新頁若用到 `/tailwind.css` 394 class 之外的 class，
  須 append 進 tailwind.css 或改 inline style，否則靜默 purge 破版
  （W-TWIND 會抓，但動手時就避免）。
- 外科式字串替換，勿 BeautifulSoup 整檔重序列化；HTML 實體（`Q&amp;A`）會讓
  字串搜尋失配 → 用平衡錨點。

## 步驟 5｜交付說明模板

```
## 本批交付說明
- 新增頁面：<路徑>（datePublished/dateModified/lastReviewed＝當日）
- 可見文字變更清單（待院長逐字核可，merge＝核可）：新頁全文＋首頁卡＋作者頁清單項
- dateModified 政策:新頁三日期＝當日；index/作者頁跳當日（新增可見項目）；其餘不跳
- 六步整合：首頁卡／sitemap +N／llms +N／作者頁 N→N+1 篇／舊文互連 N 處
- 驗證：validate_site.py --stage deploy ERROR 0／WARN 逐條判讀：…
- Playwright 390/1280px：零橫向溢出
- merge 後動作：IndexNow 提交（新頁＋index＋作者頁）
```
