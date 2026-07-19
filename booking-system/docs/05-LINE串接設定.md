# 05｜LINE 串接設定說明

所有 LINE 帳號與 channel 由**立欣診所自有** LINE Business ID 建立與持有，不經任何第三方平台。
未完成設定前，系統自動以「手機驗證碼＋簡訊」運作，民眾仍可正常預約。

## 一、建立 Channel（一次性，約 20 分鐘）

1. 前往 https://developers.line.biz/console/，以**診所自己的 LINE Business ID** 登入。
2. 建立 Provider（例：`立欣診所`）。
3. 在 Provider 下建立兩個 channel：

### A. LINE Login channel（民眾快速登入用）

- Channel type：**LINE Login**
- App type：Web app
- **Callback URL**：`https://booking.lhpedclinic.com.tw/api/line/callback`
  （測試環境另加 `http://localhost:3000/api/line/callback`）
- 記下 **Channel ID** 與 **Channel secret** → 填入環境變數：
  - `LINE_LOGIN_CHANNEL_ID`
  - `LINE_LOGIN_CHANNEL_SECRET`

### B. Messaging API channel（推播通知用，綁定診所官方帳號）

- Channel type：**Messaging API**（會連結／建立 LINE 官方帳號）
- 在 Messaging API 分頁：
  - 發行 **Channel access token (long-lived)** → `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
  - 記下 **Channel secret** → `LINE_MESSAGING_CHANNEL_SECRET`
  - **Webhook URL**：`https://booking.lhpedclinic.com.tw/api/line/webhook`，開啟 Use webhook
    （用途：偵測封鎖/解除封鎖，被封鎖者自動改發簡訊）
  - 關閉「自動回應訊息」（Official Account Manager → 回應設定），避免干擾。
- 官方帳號加好友連結（`https://lin.ee/…`）→ `NEXT_PUBLIC_LINE_OA_URL`

## 二、系統內的 LINE 行為

| 情境 | 行為 |
|---|---|
| LINE Login 成功 | 建立/更新 `line_accounts`，開民眾 session |
| 首次替某病人預約（LINE 登入中） | 仍需手機 OTP 驗證，通過後自動綁定病人 ↔ LINE |
| 已綁定病人再預約 | 免 OTP，通知走 LINE 推播 |
| 一個 LINE 帳號多位家庭成員 | 各自綁定各自計限制，互不影響 |
| LINE 登入失敗/取消授權 | 導回 `/my`，改用證件＋OTP 流程（不阻斷預約） |
| 病人封鎖官方帳號 | webhook 標記 `is_following=false`，通知自動退回簡訊 |
| 通知內容 | 不含完整證件號與敏感醫療資訊 |

安全註記：LINE 串接完全依官方 OAuth 2.0（authorization code flow），系統**絕不**接觸或保存使用者的 LINE 密碼；
access token 僅在交換 profile 當下使用，不落地保存。

## 三、驗證清單

- [ ] `/my` 頁出現「以 LINE 登入」按鈕（環境變數已生效）
- [ ] LINE 登入 → 授權 → 導回後顯示登入狀態
- [ ] 完成一筆預約後，LINE 收到預約成立推播
- [ ] LINE Developers console → webhook「Verify」回 200
- [ ] 封鎖官方帳號後再取消預約 → 改收簡訊
