# CLAUDE.md

本檔記錄與 Claude 協作時的偏好與專案背景。

## ⚠️ 網站修改前必讀:`internal/` 制度文件

任何涉及網站內容、SEO/AEO/GEO、結構化資料、部署的工作,**動手前先讀 `internal/` 四份文件**,並以其為準:

| 檔案 | 角色 |
|---|---|
| `internal/00_專案總覽索引.md` | **單一事實來源**:現況、合規規則(§4)、待辦與待決、歷批教訓 |
| `internal/01_新對話接續提示詞.md` | 開工程序:防呆兩層、版本指紋比對、標準工作流 |
| `internal/02_優化決策手冊.md` | 判斷手冊:優先序、決策樹 R1–R7、反模式 AP1–AP12、內容行事曆 |
| `internal/03_量測與回饋制度.md` | 月度量測 SOP、AI 引用測試 12 題、行動門檻 |
| `internal/tools/validate_site.py` | 全站驗證器:**任何批次交付前必跑**(`--stage deploy`,ERROR 清零才 push) |
| `internal/tools/patch_pwa.py` | PWA 三件頭冪等掛載(排除 offline/404) |
| `.claude/skills/seo-geo-content/` | **專案 Skill**:SEO＋GEO 關鍵字研究與內容生成 SOP(四層補強/新頁生產);遇相關任務自動觸發,流程層以此為入口、事實層仍以 internal/ 為準 |

**鐵律摘要**(詳見文件):可見文字(title/desc/H1/正文)逐字經院長核可才改;合規紅線見 00 §4;dateModified 判準見 02 R4;文件維護協議見 00 §8(改 00/01 前備份至 archive/、合規規則與待決狀態需院長核可)。

**注意**:本 repo 整棵樹由 Netlify 公開部署;`internal/`、`.claude/`、`CLAUDE.md`、`.mcp.json` 已由 `_redirects` 第 5 節強制 404 攔截,新增內部檔案時記得同步攔截規則。

## 使用者偏好

- **溝通語言**:一律使用「繁體中文」回覆與說明。
- **Commit 訊息**:使用「英文」撰寫,清楚描述變更內容。
- **動手前先說明計畫**:在實際修改任何檔案前,先用繁體中文簡述打算怎麼做,待確認後再動手。
- **提交流程**:明確的小改動可直接 commit 並 push 到指定分支;較大或有疑慮的改動先討論。除非明講,否則不要開 PR。

## 專案背景

- **立欣診所(LiHsin Clinic)** 官方網站 — 台南市北區小兒科・兒童過敏氣喘・疫苗接種・假日夜診。
- **技術架構**:純靜態 HTML,非 SPA。樣式使用 Tailwind(`tailwind.css`),不引入前端框架。
- **部署**:Netlify(`_redirects`、`_headers`);具 PWA 設定(`manifest.webmanifest`、`sw.js`、`pwa-register.js`、`offline.html`)。
- **語系**:網站主要為繁體中文(`lang="zh-Hant-TW"`)。

### 目錄結構

- `index.html` — 主頁面(單頁為主的診所資訊)。
- `health/` — 衛教文章(過敏、新生兒照護、兒童常見疾病等)。
- `news/` — 最新消息/公告(如流感疫苗預購);首頁 `#news` 區塊以預覽圖＋標題卡片呈現,點入為整頁介紹(比照衛教文章模板)。
- `services/` — 服務項目頁(過敏檢測、疫苗、假日兒科等)。
- `team/` — 醫師介紹(`dr-lee.html`、`dr-tsai.html`)。
- `docs/` — 內部文件與簡介 PDF。
- `images/` — 圖片資源(logo 等)。
- `app.html`、`growth.html`、`visit-guide.html`、`privacy.html`、`404.html`、`offline.html` — 其他功能頁。

### SEO / 爬蟲相關檔案(改動時留意)

- `sitemap.xml`、`robots.txt`、`_redirects`、`_headers`。
- `llms.txt`、`llms-full.txt` — 提供給 LLM 的網站摘要。
- 各頁面 `<head>` 內含 meta、Open Graph、GA(gtag)等設定。

## 工作準則

- 樣式一律沿用 Tailwind utility class,避免另寫獨立 CSS。
- 新增或修改頁面時,同步檢查 SEO(title、meta description、canonical、sitemap)是否需要更新。
- 保持既有的靜態多頁架構,不要改成 SPA 或引入建置工具鏈,除非事先討論。

## 爬蟲工具偏好

- **工具設定**:MCP server 設定於根目錄 `.mcp.json`,已安裝 **Playwright** 與 **Firecrawl** 兩個爬蟲工具。
- **工具選擇原則**:
  - 需登入、點擊、處理 JavaScript 動態內容的頁面(多數社群網站)→ 用 **Playwright**(真實瀏覽器)。
  - 批量抓取、整站爬取、把網頁轉成乾淨 Markdown → 用 **Firecrawl**。
- **API key**:Firecrawl 需 `FIRECRAWL_API_KEY`,一律以環境變數提供,**不得**寫入 `.mcp.json` 或任何 commit。
- **爬取須遵守**:
  - 尊重目標網站的 `robots.txt` 與服務條款(ToS)。
  - 控制請求頻率、避免高頻大量請求造成對方負擔。
  - 留意個資與著作權;抓取的內容僅供整理分析,引用時註明來源。
