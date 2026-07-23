# AGENTS.md（Codex 進入點）

> 本檔是 **OpenAI Codex** 開啟本 repo 時的自動載入治理入口，對等 `CLAUDE.md`。
> 立欣診所（LiHsin Clinic）官網——台南市北區小兒科・兒童過敏氣喘・疫苗接種・假日夜診。
> **事實層一律以 `internal/` 四文件為準**；本檔僅摘要，衝突時 `internal/` 勝。

## ⚠️ 動手前必讀:`internal/` 制度文件

任何涉及網站內容、SEO/AEO/GEO、結構化資料、部署的工作,**動手前先讀 `internal/` 四份文件**:

| 檔案 | 角色 |
|---|---|
| `internal/00_專案總覽索引.md` | **單一事實來源**:現況、合規規則(§4)、待辦與待決、歷批教訓 |
| `internal/01_新對話接續提示詞.md` | 開工程序:防呆兩層、版本指紋比對、標準工作流 |
| `internal/02_優化決策手冊.md` | 判斷手冊:優先序、決策樹 R1–R7、反模式 AP1–AP12、內容行事曆 |
| `internal/03_量測與回饋制度.md` | 月度量測 SOP、AI 引用測試 12 題、行動門檻 |
| `internal/tools/validate_site.py` | 全站驗證器:**任何批次交付前必跑**(`--stage deploy`,ERROR 清零才 push) |
| `.codex/skills/seo-geo-content/` | **Codex Skill**:SEO＋AEO＋GEO 關鍵字研究與內容生成 SOP;遇相關任務先讀本 skill 再動手 |

## 這個 repo 是什麼

- **技術架構**:純靜態 HTML,非 SPA。樣式用 Tailwind(`tailwind.css`),不引入前端框架、不引入建置工具鏈。
- **部署**:Netlify(`_redirects`、`_headers`);具 PWA(`manifest.webmanifest`、`sw.js`、`pwa-register.js`、`offline.html`)。
- **語系**:繁體中文(`lang="zh-Hant-TW"`)。
- **目錄**:`index.html`(主頁)、`health/`(衛教)、`news/`(最新消息)、`services/`(服務頁)、`team/`(醫師介紹 `dr-lee.html`/`dr-tsai.html`)、`images/`、`booking-system/`(自有 Next.js 預約系統,獨立部署、Netlify 端攔截)。
- **SEO/爬蟲檔**:`sitemap.xml`、`robots.txt`、`_redirects`、`_headers`、`llms.txt`、`llms-full.txt`;各頁 `<head>` 含 meta/OG/GA(gtag)。

⚠️ **本 repo 整棵樹由 Netlify 公開部署**;`internal/`、`.claude/`、`.codex/`、`CLAUDE.md`、`AGENTS.md`、`.mcp.json`、`booking-system/` 已由 `_redirects` 第 5 節強制 404 攔截。**新增內部檔案時記得同步攔截規則。**

## 使用者(院長)偏好

- **溝通語言**:一律「繁體中文」回覆與說明。
- **Commit 訊息**:用「英文」,清楚描述變更。
- **動手前先說明計畫**:實際改任何檔案前,先用繁體中文簡述打算怎麼做,待確認後再動手。
- **提交流程**:明確的小改動可直接 commit＋push 到指定分支;較大或有疑慮的改動先討論。除非明講,否則不要開 PR。

## 每次必守的合規紅線(權威版＝`internal/00` §4)

- 可見區禁自稱超級詞:推薦／最佳／第一／首選／權威／資深(「第一個」會誤觸「第一」過濾 → 寫「第 1 個」)。promotional 詞只進 `keywords` meta 與 llms 層,不進可見文字。
- 疫苗四但書齊備:依仿單＋醫師評估＋現貨來電確認＋接種禁忌/停打。
- 不寫價格數字;禁絕對宣稱(100%、完全不感染);單株抗體＝被動免疫、非傳統疫苗的誠實框架;比較他牌＝中性事實、不暗示本院庫存。
- 禁自評 `aggregateRating`／評分寫死;不宣稱未具專科、明示非急診;過敏檢測帶「不單以數值忌口」。
- 醫師資格一律「次專科訓練／研究醫師訓練」,不寫裸「次專科」;師承客觀不暗示背書。
- 外部實體 `sameAs` 須逐一查證條目正確性;症狀/非正式診斷/非疾病不硬連(誤連比不連更糟)。
- `description` ≤80 字、OG 同步。

## 可見內容變更一律先提案

任何會出現在使用者眼前的文字(title／description／H1／可見段落／醫師引言)→ **先提案、院長逐字核可才改**(merge＝核可)。技術層(schema、meta 結構、lang、favicon、`dateModified` 格式)可直接做,但仍要在交付說明講清楚。

## dateModified 判準(R4,一句話版)

家長讀到的醫療資訊有沒有被醫師重新審過?**沒有就不跳**。
`keywords`／FAQ schema／隱藏區／llms／desc／og／schema 技術修復 → 不跳。
新增可見區塊或卡片、醫療內文實質改寫(經核可)→ 跳,且 `sitemap` lastmod 同步。
完整 ISO 8601＋08:00。

## 標準工作流

**提案 → 院長逐字核可 → 外科式執行 → 逐檔驗證 → present → 交付說明(含部署/IndexNow/dateModified 政策)**。

- **逐檔驗證＝先跑 `python3 internal/tools/validate_site.py --root . --stage deploy`**:ERROR 必清零、WARN 逐條人工判讀寫進交付說明。
- **外科式編輯**:用 `apply_patch` 做最小字串替換,勿整檔重寫、勿以舊檔覆蓋優化版;HTML 實體(如 `Q&amp;A`)會讓字串搜尋失配 → 用平衡錨點,改後 DOM 驗證。
- **Tailwind purge 防線**:新增/改動含新 class 的頁面須納入 content glob 或 append `tailwind.css`,否則靜默 purge 破版。
- **版面有動時**:Playwright 實測 390／1280px 零橫向溢出。

## Codex 執行注意

- Codex 的 shell／`apply_patch` 在 sandbox 中執行;跑 `validate_site.py`、`patch_pwa.py` 等腳本或 `git` 動作若被 approval 擋下,向院長說明需求再放行,勿略過驗證步驟。
- 若某工具(web search、Playwright、firecrawl)在當前 Codex 環境不可用,如實標註限制,不要假裝執行——比照 `internal/01` 防呆 A 的環境邊界紀律。
- Commit/push 前務必跑過 deploy 驗證;push 到院長指定的工作分支,不擅自開 PR。
