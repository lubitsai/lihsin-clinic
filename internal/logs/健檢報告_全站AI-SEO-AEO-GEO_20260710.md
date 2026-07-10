# 全站 AI-SEO／SEO／AEO／GEO 完整健檢報告

> **日期**:2026-07-10(健檢批,Claude Code session,分支 `claude/ai-seo-aeo-geo-audit-i1ltt9`)
> **任務定性**:院長指示「加強全網域 AI SEO/SEO/AEO/GEO、提升網頁與 AI 可見度、做一次完整健檢」。依 02 決策樹 **R1**:站點已成熟(02 §1-1),正解=程式化稽核找真缺口,不堆疊加料(AP7)。
> **方法**:`validate_site.py --stage deploy` 全樹(無 --partial)+ 驗證器未涵蓋層面的自寫程式化稽核(meta 層/speakable-DOM 實測/llms-sitemap 交叉覆蓋/孤兒頁/重複 title-desc/og 完整性/攔截規則實效/git 歷史)。
> **紅線遵守**:可見文字(title/desc/H1/正文)零變更;dateModified 全數不跳(R4:技術層);無新增關鍵字。

---

## 一、總體判定

**網站體質:優。** 制度化檢查集(E 級 11 項+W 級 9 項)全綠;介紹層、結構化資料層、AI 配套層(llms/robots/sitemap)、追蹤層(GA4)、PWA 層皆齊備且互相一致。本次健檢發現的真缺口集中在**部署攔截層**(內部檔案外洩面)與少量技術層小洞,均已於本批修復(見第三節);**無任何影響排名或 AI 引用的重大缺陷**。

目前全站可見度的最大瓶頸**不在站內**,而在:①量測制度尚未啟動(15+ 批優化零成效數據,03 制度已備、待院長首跑);②GBP 評論引擎等站外槓桿(02 §1-3 順位 1)。站內已無「還能靠加料變強」的空間。

## 二、健檢通過項(逐層)

### 2-1 技術 SEO 基線
- `validate_site.py --stage deploy`(37 檔、完整檢查集含 E-LINK):**ERROR 0/WARN 0**。
- 全 35 可索引頁:DOCTYPE/H1 唯一/canonical 非 www/標籤平衡/JSON-LD 全數可解析。
- `lang="zh-Hant-TW"` 全站統一;內連全 `.html` 直連零 301 hop(07-10 待決⑧成果維持)。
- **孤兒頁:0**(sitemap 35 URL 每頁皆有站內連結指向)。
- _redirects:www→非 www、/index.html→/、無副檔名→.html 皆備;404 為真 404(無 soft-404 fallback)。
- _headers:五項安全標頭齊備(X-Frame-Options/nosniff/Referrer-Policy/HSTS/Permissions-Policy)。

### 2-2 介紹層(SERP)
- **35 頁 title 零重複、description 零重複**;desc 全數 ≤80 字(63–80);title 23–36 字。
- canonical、og:title/description/url/image、twitter:card=summary_large_image、keywords meta:全站齊備(privacy 為 noindex 頁,無 og:image/keywords 屬正常)。

### 2-3 結構化資料(AEO)
- **speakable cssSelector 對 DOM 實測:全數命中**(AP9 專項複驗——21 篇文章+7 服務頁+growth/visit-guide/index 的 `.speakable-summary` 等 selector 皆存在於 DOM)。
- index:JSON-LD 22 區塊、FAQ 65 題、MedicalClinic(geo/營業時段)、主 WebPage dateModified=2026-07-02(ISO 8601+08:00 格式全站合規)。
- 文章 3 Schema×21、服務 3 Schema×7、作者頁 ProfilePage+Physician×2;17 篇 MedicalCondition sameAs 維持;禁自評 aggregateRating=0。

### 2-4 AI 可見度配套(GEO)
- **llms.txt/llms-full.txt:sitemap 全 35 URL 至少一檔提及,零遺漏**;內容與現況一致(app.html、visit-guide 新框架皆在)。
- robots.txt:AI 爬蟲放行完整(OpenAI×3/Anthropic×5/Perplexity×2/Google-Extended/Meta×2/Applebot-Extended/Cohere/YouBot/Amazonbot/Diffbot/MistralAI-User/CCBot);且預設 `User-agent: *` Allow 全開,**未來新爬蟲不會被擋**,無需追加名單(避免無效 churn)。Bytespider/PetalBot 等封鎖維持。
- sitemap:35 URL 全有 lastmod+changefreq+priority,10 條 `<image:image>`(00 記載「+9」,實為 10,計數勘誤、無實害);含 PDF 高權重資源。
- 隱藏 #ai-knowledge-block 維持(GLP-1 品牌 5 條留隱藏,合規);四層關鍵字架構未動。

### 2-5 追蹤與 PWA
- cta-track.js 35 頁全掛(offline/404 除外);PWA 三件頭全站齊備(validator E-PWA 通過)。

## 三、真缺口與本批修復(全部技術層,不涉可見文字)

| # | 等級 | 發現 | 根因 | 修復 |
|---|---|---|---|---|
| 1 | **P1** | `mcp.json`、`gitignore` 兩個**無點重複檔**在 main 上=Netlify 公開部署中,且 `_redirects` §5 只攔截 `.mcp.json`,無點版**正對外可抓** | 院長網頁上傳時 dotfile 產生無點副本(git log:「Add files via upload」);07-10 制度規則(新增非站點檔案同批補攔截)制定前已混入 | `git rm mcp.json gitignore`(與 dotfile 版逐 byte 相同,零資訊損失);§5 擴充攔截 `/mcp.json`、`/gitignore`、`/_gitignore`、`/README.md`、`/:dir/README.md`(防再混入+攔截目錄空占位 README)。**注:.mcp.json 內容無金鑰**(Firecrawl key 走環境變數),屬設定曝光而非憑證外洩 |
| 2 | P2 | visit-guide.html 缺 `og:locale`+`og:site_name`(全站唯一缺這兩項的可索引頁) | 07-06 主題轉向批六處同步時未含此二欄 | 補 2 行 meta(格式對齊 weekend 頁) |
| 3 | P2 | `_redirects` §4 無副檔名 301 缺 `/app`、`/privacy` | §4 於 07-03 制定,app/privacy 為 07-04/07-05 後出生頁,漏補 | 補 2 條 301(維持非強制、對齊既有模式) |
| 4 | P3 | `_headers` 尾註仍稱「網站使用 Tailwind CDN、Google Fonts、cdnjs」——CDN 相依 06-20/07-04 已消滅,註解誤導未來 session 對 CSP 的判斷 | 歷批未同步註解 | 註解改寫為現況(現存外部源=Google Fonts/GA/Chatbase;CSP 草案待 Deploy Preview,00 §6 既列) |
| 5 | P3 | robots.txt 檔頭「最後更新 2026-05-21」過時(07-06 曾+3 AI 爬蟲) | 同上 | 檔頭日期勘誤(規則內容零變動) |

**diff 核對**:visit-guide +2 行;_redirects +7 行(§4 二條+§5 五條)+註解 3 行;_headers 註解 5 行對換;robots.txt 檔頭 2 行;刪除檔 2 個。與預期一致、無預期外變動。

## 四、本 session 未能執行、需補驗的項目

本 session 網路政策**未放行 lhpedclinic.com.tw 與 api.firecrawl.dev**(curl 000/proxy 403;即 00 已載教訓:允許清單於 session 啟動時快照)。以下線上抽測請於**下個放行網域的 session** 或院長瀏覽器完成:

1. `https://lhpedclinic.com.tw/mcp.json` — **本批合併前預期 200(外洩中)**;合併部署後應 404。
2. `/gitignore`、`/_gitignore`、`/health/README.md` — 合併後應 404。
3. `/CLAUDE.md`、`/.mcp.json`、`/internal/00_專案總覽索引.md` — 應已 404(§5 既有規則,順手複驗)。
4. `/app`、`/privacy` — 合併後應 301 至 .html。
5. 例行:`/llms.txt`、`/sitemap.xml`、`/robots.txt` 應 200 且與 repo 一致。

## 五、審視後判定「不動」的項目(避免 AP7 為改而改)

- **圖片重量**(懶人包 jpg 275–321KB、hero-bg 226KB、og-image 215KB):02 §2 明訂 **field LCP>2.5s 連兩月才啟動效能批**;webp 版已存在且頁面優先載 webp。量測前不動。
- **robots.txt 追加新 AI 爬蟲名單**:預設全開,新爬蟲不受阻;追加名單=零邊際效益。
- **index.html 366KB 單頁架構**:已定案取捨,同上量測前提。
- **關鍵字四層/schema**:已收斂,無新增(R7:本批零新關鍵字)。
- **hreflang**:單語系站,無需。
- **HowTo/其他 rich result 擴掛**:07-06 已判定不做(Google 停顯)。

## 六、已知待決重申(權責在院長,本批未動)

- 待決①hmpv sameAs 英文維基(現值 en:Human_metapneumovirus,合規暫置)/②Wikidata 第二 sameAs/③datePublished 純日期 30 處/④「5.0★」數字(index 8 處+llms 雙檔 3 處)/⑤index 可見「專業」8 處。
- 量測制度啟動(03)=**當前最高價值行動**:院長首跑 10 分鐘 SOP+AI 引用測試 12 題首輪。GA4 已全站掛好,下月月報 B 段即有數據。
- Chatbase 155 題上傳、Bing Places 待審、CSP Deploy Preview、資安帳戶勾稽。

## 七、部署與政策聲明

- **dateModified:全數不跳**(R4:無任何醫療內容再審;visit-guide 加 og 二欄屬社群 meta 技術層)。
- **IndexNow:不需提交**(無 SERP 層/內容變更;meta 補欄與攔截規則不觸發)。sitemap lastmod 不動。
- **驗證**:修復後 `validate_site.py --root . --stage deploy`(無 --partial)= ERROR 0/WARN 0(見交付訊息)。
- 本批推送至分支 `claude/ai-seo-aeo-geo-audit-i1ltt9`,**經院長 merge 至 main 才會部署生效**——P1 外洩檔在 merge 前持續公開,建議儘速合併。

## 八、教訓(三段式,已同步 00)

- 無點重複檔 `mcp.json`/`gitignore` 公開部署數日且 §5 攔截失手(現象)→ 網頁上傳會把 dotfile 產出無點副本,而攔截規則按「已知檔名」逐字列舉、不含變體(根因)→ **§5 攔截內部檔案時,同時列 dotfile 與無點變體;每次健檢用 `git ls-files` 對照 §5 清單找漏網檔**(規則)。

---

## 補記:線上抽測已完成(2026-07-10 同日,GitHub Actions 通道)

§4 清單已由 `.github/workflows/spot-check.yml`(新資產,在 GitHub runner 上跑、不受 session 網路政策限制)執行完畢:P1 封鎖全數生效(/mcp.json /gitignore /_gitignore=404)、既有攔截與站點資產全綠、visit-guide og:locale 上線。兩項修正:空 README 佔位檔直接刪除(佔位符攔截不生效);**勘誤=§4 無副檔名 301 從未觸發**(Netlify 隱含 .html 解析優先回 200,canonical 收斂雙版本、無實害、勿改強制 301!)。詳見 00〈本批 2026-07-10b〉續 2。
