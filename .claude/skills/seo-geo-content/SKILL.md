---
name: seo-geo-content
description: 立欣診所官網 SEO／AEO／GEO 關鍵字研究與內容生成的標準流程（可複製 SOP）。凡任務涉及「加強／優化某頁或某主題的 SEO、AI SEO、GEO、AEO」、院長貼來關鍵字詞表或指定要補的字詞、要求關鍵字研究或佈局、新增衛教文章／服務頁／最新消息頁、補強 keywords／FAQ schema／隱藏 AI 區塊／llms 雙檔——一律先載入本 Skill 再動手，即使指令只有一句「幫我加強 XX」或「優化網站」也適用。本 Skill 封裝歷批已驗證的四層補強模式與新文章生產 SOP，防止跳過盤點直接加料、防止合規踩線。
---

# SEO＋GEO 關鍵字研究與內容生成流程

本 Skill 是**流程封裝**，不是事實來源。事實、合規規則、待決狀態一律以
`internal/00_專案總覽索引.md` 為準；判斷方法以 `internal/02_優化決策手冊.md` 為準。
本 Skill 與 internal/ 文件衝突時，internal/ 勝，並回修本 Skill。

> **Codex 版對應**：本 Skill 有一個 Codex 可執行版 `.codex/skills/seo-geo-content/SKILL.md`
> （由 `AGENTS.md` 作為 Codex 進入點導引）。兩版是同一套 SOP 的兩個進入點，**深層 reference
> （本目錄 `references/`）兩版共用**——改流程時兩個 SKILL.md 都要同步檢查。

## 第 0 步：前置程序（每次必做，不可跳過）

1. 讀 `internal/00_專案總覽索引.md` 檔頭版本區與 §4 合規規則、
   `internal/01_新對話接續提示詞.md` 的「現在狀態」與「防呆」兩節。
   歷批可能已補強過同一主題——先確認現況，避免重工或撞版本。
2. 跑基線驗證：`python3 internal/tools/validate_site.py --root . --stage deploy`
   ——動手前 ERROR 必須為 0，否則先處理既有問題（或回報院長），不在髒基線上疊加。
3. 對照 02 §1-4「一頁一意圖主題分工表」：確認這次要動的意圖歸屬哪一頁。

## 第 1 步：模式判定

| 情境 | 模式 | 流程 |
|---|---|---|
| 院長貼來詞表／指定關鍵字，且站內已有承載頁 | **A：四層補強** | 讀 `references/keyword-research.md`，照其七步執行 |
| 指定新主題（海報、新服務、行事曆選題），站內無承載頁 | **B：新頁生產** | 先過 R2 三題（見下），通過才讀 `references/content-generation.md` |
| 模糊指令（「優化網站」「加強 SEO」無具體對象） | **R1 稽核** | 依 02 R1：跑驗證器＋差距盤點 → 產出真缺口提案給院長選，**禁止**直接加關鍵字、加 schema、加頁面 |

**R2 三題（要不要開新頁）**：(a) 主攻意圖是否已被分工表某頁佔據？是 → 轉模式 A 強化既有頁。
(b) 是否有 ≥800 字真實內容量與獨立搜尋需求？(c) 能否通過合規（不宣稱未具專科、非急診）？
三題全過才開新頁。撞題但內容過時 → 更新舊文，dateModified 依 R4 判。

## 第 2 步：執行（依模式讀對應 reference）

- **模式 A** → `references/keyword-research.md`：詞表分層 → 事實查證 → 四層盤點
  → 只補最薄層 → 合規自檢。核心鐵律：**零可見文字變更、不開新頁、dateModified 不跳**。
- **模式 B** → `references/content-generation.md`：選題 → 模板要件撰寫 → 六步整合
  → PWA/CTA 掛載。核心鐵律：**可見文字全屬新增內容，一律待院長逐字核可（merge＝核可）**。

## 第 3 步：合規快查（動筆時隨手核，權威版＝00 §4）

- 可見區禁自稱超級詞：推薦／最佳／第一／首選／權威／資深（「第一個」會誤觸
  「第一」過濾 → 寫「第 1 個」）。promotional 詞只進 keywords meta 與 llms 層。
- 疫苗四但書齊備：依仿單＋醫師評估＋現貨來電確認＋接種禁忌/停打。
- 不寫價格數字；禁絕對宣稱（100%、完全不感染）；單株抗體＝被動免疫、非傳統疫苗
  的誠實框架；比較他牌＝中性事實陳述、不暗示本院庫存。
- 禁自評 aggregateRating；不宣稱未具專科、明示非急診；過敏檢測帶「不單以數值忌口」。
- 外部實體 sameAs 逐一 web_search 核對條目正確性——誤連比不連更糟，不確定就略過。
- description ≤80 字、og 同步；dateModified 完整 ISO 8601＋08:00。

## 第 4 步：驗證與交付（每批固定收尾）

1. 模式 B 新增頁面先跑 `python3 internal/tools/patch_pwa.py .` 與
   `internal/tools/patch_cta.py`（皆冪等；offline/404 除外）。
2. `python3 internal/tools/validate_site.py --root . --stage deploy`
   —— **ERROR 清零才可 push**；WARN 逐條寫出人工判讀，不消音。
3. diff 行數與預期比對：超出預期＝停下來查（外科式字串替換，勿整檔重序列化）。
4. 版面有動時 Playwright 實測 390／1280px 零橫向溢出。
5. **交付說明**必含：改了什麼與為什麼／dateModified 政策（跳或不跳＋R4 理由）／
   可見文字變更清單（待院長逐字核可；merge＝核可）／merge 後 IndexNow 提交清單
   （`internal/tools/submit_indexnow.py`；僅新 URL 或可見內容實質變更需要）。
6. 依 00 §8-3 更新文件：備份 00/01 至 `internal/archive/` → 00 檔頭版本行＋文末
   本批附錄（append-only）→ 01 狀態段同步。

## dateModified 判準（R4，一句話版）

家長讀到的醫療資訊有沒有被醫師重新審過？**沒有就不跳**。
keywords／FAQ schema／隱藏區／llms／desc／og／schema 技術修復 → 不跳。
新增可見區塊或卡片、醫療內文實質改寫（經核可）→ 跳，且 sitemap lastmod 同步。
