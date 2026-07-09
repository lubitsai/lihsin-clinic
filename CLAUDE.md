# CLAUDE.md

本檔記錄與 Claude 協作時的偏好與專案背景。

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
