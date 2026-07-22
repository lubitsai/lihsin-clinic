---
name: multi-agent
description: 啟動四角色多代理協作流水線(Architect 設計 → Engineer 開發 → Reviewer 審查 → Optimizer 優化)。當使用者要求「用多代理流程」「四角色協作」開發某功能或系統,或輸入 /multi-agent <任務描述> 時使用。產出:架構文件、實作、審查報告、最終優化版本。
---

# 多代理協作流水線(Multi-Agent Workflow)

以四個子代理依序完成一項開發任務。你是**協調者(Orchestrator)**:負責派工、把關交接、彙整結果;實質工作交給子代理。

## 前置

1. 從使用者輸入取得任務描述;若任務不明確(不知道要做什麼、做在哪個 repo),先用 AskUserQuestion 釐清,再啟動流水線。
2. 取一個簡短的英文任務代號 `<task>`(kebab-case),建立工作目錄 `workflow/<task>/`。
3. 交接檔案固定為:
   - `workflow/<task>/01_architecture.md`(Architect 產出)
   - `workflow/<task>/02_implementation.md`(Engineer 產出)
   - `workflow/<task>/03_review.md`(Reviewer 產出)
   - `workflow/<task>/04_optimization.md`(Optimizer 產出)

## 流水線(嚴格依序,前一棒完成才派下一棒)

每一棒都用 Agent 工具啟動對應的子代理(`subagent_type` 分別為 `architect`、`engineer`、`reviewer`、`optimizer`),prompt 中必須包含:任務描述、工作目錄路徑、前面各棒的交付檔案路徑。

1. **Architect**:產出 `01_architecture.md`。
   - 協調者檢查:文件存在、含工作項清單。若有「待決事項」,先用 AskUserQuestion 請使用者裁定,把裁定結果寫回文件後才派 Engineer。
2. **Engineer**:依 01 實作,產出程式碼與 `02_implementation.md`。
   - 協調者檢查:筆記中有實際執行/測試輸出;若 Engineer 回報設計不可行,帶著問題重派 Architect 修訂設計,再回到本步。
3. **Reviewer**:審查,產出 `03_review.md`。
   - 結論 `FAIL` → 把必修項派回 Engineer 修復,修完重派 Reviewer 複審;迴圈直到 `PASS`。連續 3 輪未過,停下向使用者回報卡點。
   - 結論 `PASS` → 下一步。
4. **Optimizer**:優化並產出 `04_optimization.md` 與最終程式碼。
   - 協調者檢查:報告含量測數據、測試全綠證據。

## 收尾

1. 確認四份交接文件齊全,程式碼已 commit(英文訊息)並 push 到指定分支。
2. 向使用者交付總結(繁體中文):
   - 架構摘要
   - 實作內容與檔案清單
   - 審查發現與處置
   - 優化成果(量測前後對比)
   - 未解事項/後續建議

## 原則

- 角色分工不可混:協調者與子代理都不得越權(例如 Reviewer 改碼、Engineer 改架構)。
- 交接以檔案為準,不依賴口頭轉述;派工 prompt 一律附上檔案路徑。
- 各 repo 的 CLAUDE.md 規範(語言、commit 慣例、合規紅線)優先於本流程的預設。
