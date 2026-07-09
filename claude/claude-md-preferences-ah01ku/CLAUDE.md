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
