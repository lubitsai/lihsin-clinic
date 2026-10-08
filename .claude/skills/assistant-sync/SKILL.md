---
name: assistant-sync
description: 立欣診所「官網線上小幫手＋LINE 線上小幫手」同步更新的標準流程。凡院長說「依目前網頁內容更新到最新版」「小幫手同步」「LINE 小幫手更新」「重新打包 LINE」、交付新的自費價目或要小幫手回答某類問題、或改動 clinic-assistant/search.js、internal/AI客服_自費價目.json、internal/line-helpdesk/ 任一檔——一律先載入本 Skill。也適用於審查別人交來的 LINE 程式包新版本。
---

# 官網＋LINE 小幫手同步

院長 2026-10-06 裁示：**官網小幫手與 LINE 小幫手都要同步更新**。兩邊回答同一份資料、走同一套規則；LINE 只多兩樣東西：LINE 用語（「在此聊天室輸入『專人服務』」）與 LINE 專用優惠文字。

## 資料怎麼流

```
各頁 FAQ schema ─┐
首頁公告／門診表 ─┼─ build_chatbot_kb.py ─→ internal/AI客服知識庫_立欣診所_正本_*.md
                 │                              │（第一～四節手寫：系統指示、基本事實、收費、預約規則）
                 │                              ▼
internal/AI客服_自費價目.json ──────── build_assistant_kb.py ─→ clinic-assistant/knowledge.json（公開）
                                                                │      ＋ clinic-assistant/search.js（官網分流規則）
                                                                ▼
internal/line-helpdesk/aliases.json、prices_line.json ── build_faq.py ─→ internal/line-helpdesk/faq.json（LINE）
```

- **小幫手只認得 FAQ**：只寫在頁面可見區、沒進該頁 FAQ schema 的事實，兩個小幫手都答不出來（2026-10-06 醫師專科資格就是這樣漏的）。新增可見事實時，問一句「家長會不會問小幫手這件事？」會的話同步補進 FAQ（可見文字，需院長逐字核可）。
- **搜尋以題目標題為主**：答案裡有、標題沒有的關鍵字，口語問法常常找不到。

## 標準流程（一鍵）

1. **同步 main**：`git fetch origin main && git merge origin/main`，看自上次以來改了什麼：
   `git diff --stat <上次> origin/main -- clinic-assistant/ internal/AI客服_自費價目.json internal/line-helpdesk/`
2. **一條指令完成重產＋測試＋兩邊一致性比對＋validate_site＋打包**
   ```
   python3 internal/tools/sync_assistants.py --zip <scratchpad> --ask <這批新增內容家長會怎麼問…>
   ```
   - 重產：正本 Q&A 區 → `knowledge.json` → LINE `faq.json`（各自先 `--check`，不同步才重產；Claude Code 內 hook 通常已先跑過）
   - 測試：`test_assistant.mjs`（官網）＋ LINE unittest（缺 Flask／Firestore 時只跑題庫與價目兩檔；完整版用裝好 `requirements.lock.txt` 的 Python 執行本腳本）
   - **一致性比對**：Node 實跑官網 `search.js`、Python 實跑 LINE `core.py`，對 `internal/line-helpdesk/parity_queries.json`（165 句）＋ `--ask` 問句比三件事——緊急判斷、自費價目命中哪條、相似題前 3 名。設計上必須完全相同，任何一處不同即失敗
   - `validate_site --stage deploy`（E-ASSISTANT／W-LINE 任一出現即失敗）
   - `--ask`：兩邊回答並排印出，用來抽查新內容家長問不問得到。查不到就回報缺口，不要自己加 FAQ
   - `--zip`：全部通過才打包 `立欣診所_LINE客服_<README 版本>_main-<HEAD>.zip`，用 SendUserFile 交付
   - `--check`：只檢查不寫檔（push 前把關）；結束碼 0＝全過、1＝有 ✗
3. 新增常見問法時，把句子加進 `parity_queries.json`，比對範圍就跟著變大。
4. LINE 有改程式／規則時，更新 `line-helpdesk/測試結果.txt` 與 README 版本行；部署步驟見 `line-helpdesk/README_設定步驟.md`（LINE 跑在 Cloud Run，repo 內的 faq.json 不會自己上線）。
5. **PR 判準**（CLAUDE.md）：只重產衍生檔、沒改頁面 → 跟著改動來源的那一批走；只動 `internal/**` → 直推 main；改了 FAQ／search.js（小幫手的回答）→ 判準① 開 PR。00／01 照 §8 先備份再登錄。

### 已知的設計差異（`--ask` 會看到，不算失敗）

2026-10-08o 起 search.js 每一步分流（含第 7～10 步：跨診次、遲到／掛號反問、現貨、新冠、指定日期、假日、門診時間與聯絡資料）都已移植到 LINE `core.py`（`Catalog.tail_route`、`parse_date`），regex、固定句、反問按鈕由 `build_faq.py` 逐字核對。剩下的差異都是刻意的：
- LINE 先比對整句問法（aliases.json、歡迎詞），所以「掛號」「今天有看診嗎」走固定回答，不走官網的反問／日期卡。
- 官網的卡片（門診表、聯絡資料）在 LINE 是純文字＋相關題目按鈕。
- 不存在的日期（2/30）：LINE 視為沒有日期；官網照字面顯示（官網小瑕疵，未修）。
- search.js 新增分流步驟時，三處要同步：`core.ROUTE_SRC`／`tail_route`、`build_faq.py` 固定句清單、`parity_queries.json` 補問句。

## 改規則時的鐵律

- **search.js 的分流 regex、PIN_* 標題、固定句改了，`internal/line-helpdesk/core.py`（`ROUTE_SRC`、`PINS`）與 `build_faq.py`（`CLINICAL`／`ACTION_TEXT`）要逐字同步**，否則 `build_faq.py` 會拒絕重產（這是刻意的）。緊急字詞 `URGENT`／`SOON` 同理（`core.URGENT_SRC`／`SOON_SRC`）。改完用 Node 實跑官網、Python 實跑 LINE，同一批問句比對結果。
- **直接回某一題時用標題，不用 Q 編號**：Q 編號重產時會依頁面順序順移（2026-10-05zg）。
- **緊急判斷不做否定處理**（院長 2026-10-03 裁示 (a)）：「沒有呼吸困難」也回 119，與官網一致。
- **自費價目**：只改 `internal/AI客服_自費價目.json`（官網版回覆，`PRICE_FORBIDDEN` 擋原價／推廣／優惠／同行／藥物俗名）；LINE 的優惠文字只放 `line-helpdesk/prices_line.json`，**絕不進公開的 knowledge.json**。藥物寫「醫師評估後開立的藥物」。庫存狀態（如「已售完」）改了要重產兩邊。
- **LINE 用語改寫**在 `build_faq.py` 的 `LINE_RULES`，每次重產會寫 `LINE用語改寫對照.csv` 供抽查；新規則是可見文字，需院長核可。
- 小幫手文字一律來自官網既有內容或院長核可句；**不自行新增答案**。

## 審查別人交來的 LINE 新版本

逐檔 diff 對照 `internal/line-helpdesk/`；覆蓋進 repo 後跑 `sync_assistants.py --check`（外部版本常因手上沒有官網檔而略過比對測試）；特別看：緊急判斷有沒有被放寬、分流順序是否仍與 search.js 一致（SOON 先於前置規則）、有沒有用 Q 編號、有沒有新文字未經核可。採用後覆蓋進 `internal/line-helpdesk/` 並登錄 00。
