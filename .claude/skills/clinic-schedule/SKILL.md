---
name: clinic-schedule
description: 立欣診所官網「門診時間相關變更」的標準流程。當任務涉及門診異動公告（單日臨時停診/醫師進修/國定假日/颱風）、更新首頁「最新門診異動」公告圖、或變更常態門診時間（改週班表、新增/取消時段、改休診日）時使用。也涵蓋 HERO 開診狀態徽章的 SCHEDULE 週班表與 EXCEPTIONS 單日特例表更新。
---

# 門診異動與門診時間更新

**正本 SOP：`internal/SOP_門診異動與時間更新.md` — 動手前先完整讀過。** 本 skill 只是入口與速記；細節、全站同步清單、行號定位以 SOP 為準。

## ⭐ 六載體同步清單（院長 2026-08-23 指示，每次門診異動都要走完）

官網只是其中一個載體。**一次任務提醒兩次**（院長 2026-08-23 指示）：
**①第一則回覆就先列出六項**（讓院長能與改官網並行處理，別等做完才講）、**②交付訊息結尾再附一次完整表、逐項標 ✅／⬜**。
不可只回報官網做完就結束。

| # | 載體 | 誰做 |
|---|---|---|
| ① | 官網「最新門診異動」公告＋徽章 `EXCEPTIONS` | **Claude** |
| ② | Facebook 貼文 ＋ 限時動態（兩個都要） | 院長 |
| ③ | Instagram 限時動態 | 院長 |
| ④ | **Google 商家檔案「特殊營業時間」**（影響最大：地圖／搜尋／AI 直接讀） | 院長 |
| ⑤ | **BookNow**：只關閉休診當節的時段＋既有預約改期 | 院長／櫃檯 |
| ⑥ | **診所門口實體公告**（**A4 橫式**列印）：`python3 internal/tools/make_door_notice.py <公告圖>` → `internal/print/*-A4.pdf`（`--portrait` 可改直式） | 櫃檯 |

- **⑤ 現況**：線上是 **BookNow**，`booking-system/` 自建系統**尚未切換**；`sync_schedule.py` 對齊的是自建系統的班表，**不等於 ⑤ 已完成**。切換後 ⑤ 才改為自建系統（主機上 `npx tsx scripts/sync-schedule.ts`，先 `--dry-run`）。
- 建議順序 ⑤ → ④ → ⑥ → ① → ②③（**⑤④⑥＝實害組**：約到空診次／Google 說有開／走到門口才發現沒開）。
- **恢復日不必提醒任何事**（院長 2026-08-23 定案）：①④ 自動過期；**⑤ BookNow 不必開回來**（只關休診當節的時段，不動到其他診次）；**⑥ 門口撕掉＝櫃檯例行**。**提醒範圍只有異動當下的六項，不要排恢復日的鬧鐘。**
  ⚠️ ⑤ 的自建系統不同（改的是週班表、對所有未來日期生效，單日異動走 `EXCEPTIONS`／`SPECIAL_HOURS`），切換後別套用 BookNow 的習慣。
- 情境 B 另加：Google 商家「一般營業時間」、MainPi、Chatbase。詳見 SOP 檔頭同名章節。

## 先讀制度（鐵律）

依 `CLAUDE.md`：涉及網站內容/SEO/部署的工作，動手前先讀 `internal/` 四份文件（00 現況與 §4 合規、01 開工程序、02 R4 判準、03 量測）。可見文字逐字經院長核可才改。

## 兩種情境（先判別）

- **A. 臨時單日異動**（某天停診/提早截止/醫師進修/颱風，下週恢復）
  → 首頁 `#clinic-notice` 加／換公告圖 + 視情況加 HERO 徽章 `EXCEPTIONS` 單日特例 + `data-expires` 自動過期。**臨時公告不進 llms。**
  → **公告區塊可並列多則**（08-22c 起）：每則一個 `.notice-item` 各自帶 `data-expires`。**動手前先看現有公告在不在效期內——仍在效期就並列，不要覆蓋。**
  → **並列時依「適用日期」由近到遠排，不是依加入順序**（08-23c 定案；今天生效的排最前，未來日期的往後）。
  → **「視情況滾動式調整、稍後公布」的時段，`EXCEPTIONS` 先留空**，等院長公布再補；同時把公布時間寫進 `00` 第六節待辦。
  → **院長常設指示：對話貼圖公告走「即刻公告 + 立即部署」**（不設起始日、通過驗證即快進合併 `main` 部署，不再逐次徵詢文案核可／部署確認；紅線與驗證關卡照舊）。詳見 SOP §一「預設交付模式」。
- **B. 常態門診時間變更**（改固定週班表：新增/取消時段、改起訖、改休診日）
  → 改 HERO `SCHEDULE` 表 **＋ 全站散落的門診時間**（JSON-LD `openingHoursSpecification`、首頁時間表、多處 FAQ/正文、`visit-guide.html`、`services/weekend-pediatrics.html`、多頁 meta desc、`llms.txt`/`llms-full.txt`、站外 Google 商家與 MainPi）。
  ⚠️ `validate_site.py` **不檢查時間一致性**，全靠 SOP 清單防漏。先跑 SOP 的探查 grep、改完回頭複跑確認零殘留。

> **預約系統會跟著官網走（2026-08-05 起）**：`booking-system` 的班表以官網為唯一事實來源。
> 情境 A、B 只要動到門診時間表或 `SCHEDULE`／`EXCEPTIONS`，都必須跑 `sync_schedule.py`（見〈共同尾段〉第 3 點），
> 否則家長會在預約系統約到診所實際沒開的時段。

## 共同尾段

1. dateModified 跳 + `sitemap.xml` lastmod 同步（R4：門診時間屬營運資訊）。
2. `python3 internal/tools/validate_site.py --stage deploy` → ERROR 清零才 push。
3. **同步預約系統班表**（官網為主）：
   ```
   python3 internal/tools/sync_schedule.py          # 重產 booking-system/prisma/schedule.json
   python3 internal/tools/sync_schedule.py --check  # push 前確認，非 0 就是還沒同步
   ```
   產生的 JSON 要一併 commit。**已上線的預約系統另需在主機執行** `npx tsx scripts/sync-schedule.ts`
   （可先 `--dry-run` 看會改什麼）。此工具同時逐格比對可見表與 `SCHEDULE` 常數，
   只改一邊會直接報錯——等於順手把官網自己的兩份副本也對過一次。
   > **同步會被既有預約擋下是正常的**（院長 2026-08-06 裁示）：新班表若讓某些預約失去時段，
   > 整批不寫入、印出名單並以 exit code 2 結束。請櫃檯先逐筆改期後再跑一次，或確認要一併
   > 取消並通知家長時改用 `--cancel-affected`。**不要為了讓指令過就直接加這個旗標。**
   > 限制：官網單日公告的「某醫師代診」只存在於公告圖與說明文字，沒有結構化資料，
   > **同步不到**；代診要另外在預約系統後台「排班管理」建立。
4. 動到徽章 `SCHEDULE`/`EXCEPTIONS` → Chromium 模擬時間實測四態與跨日。
5. **🧹 過期公告檔案清理**（院長 2026-08-25 入制）：公告下架後，該則的公告圖與門口 A4 PDF **一併刪掉、只留當期那一組**；刪前 grep 全樹確認零引用（`data-expires` 只隱藏 DOM，檔案仍在 repo 積著）。詳見 SOP §一.6。
5. 可見文字待院長逐字核可；改 00/01 前先備份至 `archive/`（§8）。
6. 情境 B（多頁）部署後補送 IndexNow（`internal/tools/submit_indexnow.py`）。

## 工具

- `internal/tools/make_infographic.py` — 公告圖改名＋轉 webp/jpg。
  ⚠️ **院長對話貼的圖，原始檔就在 `/root/.claude/uploads/<session-id>/`——先 `ls` 那裡再說。**
  不要因為「只有貼圖」就自己重畫；重繪是最後手段（詳見 `infographic-upload` skill 與 SOP §一.1）。
- `internal/tools/validate_site.py` — 全站驗證器。
- `internal/tools/sync_schedule.py` — 官網門診時間表 → 預約系統班表（單向，官網為主）；`--check` 供 push 前把關。
- `internal/tools/submit_indexnow.py` — IndexNow 提交。
