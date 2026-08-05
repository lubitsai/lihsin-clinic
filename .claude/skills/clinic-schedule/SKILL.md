---
name: clinic-schedule
description: 立欣診所官網「門診時間相關變更」的標準流程。當任務涉及門診異動公告（單日臨時停診/醫師進修/國定假日/颱風）、更新首頁「最新門診異動」公告圖、或變更常態門診時間（改週班表、新增/取消時段、改休診日）時使用。也涵蓋 HERO 開診狀態徽章的 SCHEDULE 週班表與 EXCEPTIONS 單日特例表更新。
---

# 門診異動與門診時間更新

**正本 SOP：`internal/SOP_門診異動與時間更新.md` — 動手前先完整讀過。** 本 skill 只是入口與速記；細節、全站同步清單、行號定位以 SOP 為準。

## 先讀制度（鐵律）

依 `CLAUDE.md`：涉及網站內容/SEO/部署的工作，動手前先讀 `internal/` 四份文件（00 現況與 §4 合規、01 開工程序、02 R4 判準、03 量測）。可見文字逐字經院長核可才改。

## 兩種情境（先判別）

- **A. 臨時單日異動**（某天停診/提早截止/醫師進修/颱風，下週恢復）
  → 換首頁 `#clinic-notice` 公告圖 + 視情況加 HERO 徽章 `EXCEPTIONS` 單日特例 + `data-expires` 自動過期。**臨時公告不進 llms。**
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
   > 限制：官網單日公告的「某醫師代診」只存在於公告圖與說明文字，沒有結構化資料，
   > **同步不到**；代診要另外在預約系統後台「排班管理」建立。
4. 動到徽章 `SCHEDULE`/`EXCEPTIONS` → Chromium 模擬時間實測四態與跨日。
5. 可見文字待院長逐字核可；改 00/01 前先備份至 `archive/`（§8）。
6. 情境 B（多頁）部署後補送 IndexNow（`internal/tools/submit_indexnow.py`）。

## 工具

- `internal/tools/make_infographic.py` — 公告圖改名＋轉 webp/jpg（院長只給貼圖時重製 1000² 方圖）。
- `internal/tools/validate_site.py` — 全站驗證器。
- `internal/tools/sync_schedule.py` — 官網門診時間表 → 預約系統班表（單向，官網為主）；`--check` 供 push 前把關。
- `internal/tools/submit_indexnow.py` — IndexNow 提交。
