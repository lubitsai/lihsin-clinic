# CLAUDE.md

立欣診所官網。**事實層一律以 `internal/` 四份文件為準**，本檔只寫「不看就會做錯」的事。

## 動手前必讀

涉及網站內容、SEO/AEO/GEO、結構化資料、部署的工作，先讀 `internal/00_專案總覽索引.md`（單一事實來源：現況、合規規則 §4、待辦待決、歷批教訓），再依任務讀 `01`（開工程序）、`02`（決策樹／反模式）、`03`（量測制度）。與本檔衝突時以 `internal/` 為準。

## 鐵律

- 可見文字（title / description / H1 / 可見段落 / 醫師引言）**逐字經院長核可**才改；技術層（schema、meta 結構、lang、favicon、dateModified 格式）可直接做，但交付說明要講清楚。
- 合規紅線完整清單見 `internal/00` §4，**每次對照**。最常踩線的是：可見區超級詞（推薦／最佳／第一／權威／資深）、疫苗四但書、價格數字、絕對宣稱、自評 aggregateRating。
- 寫任何可見文字（衛教文、公告、卡標題）前，讀 `.claude/skills/seo-geo-content/references/anti-ai-tone.md` 去 AI 味 38 項；該檔 §0 列出 SOP 要件的豁免（FAQ、四但書、危險徵象條列不算 AI 味）。
- dateModified 判準（`02` R4）：家長讀到的醫療資訊有沒有被醫師重新審過？沒有就不跳。
- 改 `00`／`01` 前先備份至 `archive/`，合規規則與待決狀態需院長核可（`00` §8）。
- 任何批次交付前跑 `python3 internal/tools/validate_site.py --root . --stage deploy`，**ERROR 清零才 push**，WARN 逐條判讀寫進交付說明。

## 這個 repo 的兩個陷阱

- **整棵樹由 Netlify 公開部署。** `internal/`、`.claude/`、`.codex/`、`CLAUDE.md`、`AGENTS.md`、`.mcp.json`、`booking-system/` 靠 `_redirects` 第 5 節強制 404 擋住；新增內部檔案時必須同步攔截規則。
- **`booking-system/` 不是官網頁面。** 獨立的 Next.js＋PostgreSQL 應用，走 Docker 部署到獨立網域，改官網時不要動它。
  **唯一的例外是門診時間**：預約系統的班表以官網 `index.html` 的門診時間表為準，動到門診時間就要跑
  `python3 internal/tools/sync_schedule.py`（push 前用 `--check` 把關），詳見 `clinic-schedule` skill。

## 編輯手法（踩過的雷）

- **外科式最小替換**，不整檔重寫、不用舊檔覆蓋優化版。HTML 實體（如 `Q&amp;A`）會讓字串搜尋失配 → 用平衡錨點，改完驗 DOM。
- **Tailwind purge 防線**：新增或改動帶新 class 的頁面，必須納入 content glob 或 append 進 `tailwind.css`，否則靜默 purge 破版。
- **版面有動**：Playwright 實測 390／1280px 零橫向溢出。

## 架構約束

- 維持靜態多頁 HTML＋Tailwind utility class；不要改成 SPA、不要引入建置工具鏈、不要另寫獨立 CSS，除非先討論。
- `FIRECRAWL_API_KEY` 一律走環境變數，**不得**寫進 `.mcp.json` 或任何 commit。
