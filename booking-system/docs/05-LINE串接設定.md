# 05｜LINE 官方帳號串接設定

> 所有 channel 由**立欣診所自己的 LINE Business ID** 建立與持有，不經任何第三方平台。
> **未完成設定前系統仍可正常上線**：前台自動隱藏 LINE 登入、民眾改用手機驗證碼、通知改以簡訊發送。
> 設定完成後，到後台「系統設定 → LINE 官方帳號串接 → 檢測連線」即可確認是否接通。

---

## 一、需要準備的東西

| 項目 | 說明 |
|---|---|
| LINE Business ID | 診所自己的帳號（就是管理 LINE 官方帳號的那組） |
| 診所的 LINE 官方帳號 | 已有的話直接沿用，會連結到 Messaging API |
| 預約系統網址 | 例：`https://booking.lhpedclinic.com.tw`（需 https，LINE 不接受 http） |

全部步驟約 20 分鐘，需在 https://developers.line.biz/console/ 操作。

---

## 二、建立 Provider

登入 LINE Developers Console → 建立 Provider，名稱填「立欣診所」。
（Provider 是容器，底下會放兩個 channel。）

---

## 三、Channel A：LINE Login（民眾快速登入用）

1. 在 Provider 底下 **Create a LINE Login channel**
2. App type 選 **Web app**
3. 建好後到 **LINE Login** 分頁，Callback URL 填：

   ```
   https://booking.lhpedclinic.com.tw/api/line/callback
   ```

   > 正確網址可在後台「系統設定 → LINE 官方帳號串接 → 檢測連線」直接複製，不會填錯。
   > 若要在本機測試，可多加一行 `http://localhost:3000/api/line/callback`。

4. 到 **Basic settings** 分頁抄下兩個值 → 填入環境變數：

   | LINE Console 欄位 | 環境變數 |
   |---|---|
   | Channel ID | `LINE_LOGIN_CHANNEL_ID` |
   | Channel secret | `LINE_LOGIN_CHANNEL_SECRET` |

5. **重要**：到 **LINE Login → Linked OA**，把診所的官方帳號連結上去。
   系統登入時會帶 `bot_prompt=aggressive` 參數詢問民眾是否加入好友——
   **沒有加好友就無法推播，通知只能改發簡訊（要花錢）**，所以這一步別跳過。

---

## 四、Channel B：Messaging API（推播通知用）

1. 在 Provider 底下 **Create a Messaging API channel**，或從既有官方帳號啟用 Messaging API
2. 到 **Messaging API** 分頁：
   - **Channel access token (long-lived)** → 按 Issue，抄下來填入 `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
   - **Webhook URL** 填：

     ```
     https://booking.lhpedclinic.com.tw/api/line/webhook
     ```

   - 開啟 **Use webhook**
   - 按 **Verify**，應回覆成功（用途：偵測民眾封鎖／解除封鎖官方帳號，被封鎖者自動改發簡訊）
3. 到 **Basic settings** 抄下 **Channel secret** → 填入 `LINE_MESSAGING_CHANNEL_SECRET`
   （用於驗證 webhook 來源，沒填的話 webhook 會被拒絕）
4. 到 LINE Official Account Manager → **回應設定**，把「自動回應訊息」**關閉**，避免干擾通知

---

## 五、加好友連結（前台顯示用）

LINE Official Account Manager → 取得加好友網址（形如 `https://lin.ee/xxxxx`）
→ 填入 `NEXT_PUBLIC_LINE_OA_URL`，首頁才會顯示「加入好友接收看診提醒」。

---

## 六、環境變數總表

填在部署主機的 `.env`（見 `06-部署與備份.md`）：

```bash
APP_BASE_URL="https://booking.lhpedclinic.com.tw"

LINE_LOGIN_CHANNEL_ID="……"
LINE_LOGIN_CHANNEL_SECRET="……"
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN="……"
LINE_MESSAGING_CHANNEL_SECRET="……"
NEXT_PUBLIC_LINE_OA_URL="https://lin.ee/……"
```

改完需重新啟動服務（`docker compose up -d`）才會生效。

> ⚠️ 這四把金鑰等同官方帳號的鑰匙，**不可貼進對話、email 或寫進程式碼**。
> 若外流，到 LINE Console 重新發行（Issue）即可失效舊的。

---

## 七、設定完成後的確認

後台 → 系統設定 → **LINE 官方帳號串接** → **檢測連線**，會逐項顯示：

| 檢測項目 | 通過代表 |
|---|---|
| 對外網址 APP_BASE_URL | 是 https 正式網域（LINE 不接受 http） |
| Messaging API | token 有效，並顯示接到的官方帳號名稱 |
| Messaging Channel secret | 已設定，webhook 可驗章 |
| LINE Login | Channel ID 與 secret 配對正確 |

同一畫面也會列出要貼進 LINE Console 的 Callback URL 與 Webhook URL，可直接複製。

**再做一次實地測試**（建議上線前必做）：

1. 用自己的手機到前台按「以 LINE 登入」→ 應出現授權畫面，並詢問是否加入官方帳號
2. 完成一筆測試預約 → LINE 應收到預約成立通知
3. 到後台把該筆預約取消 → LINE 應收到取消通知
4. 封鎖官方帳號後再測一次 → 應自動改收簡訊（代表 webhook 有生效）

---

## 八、系統內的 LINE 行為（供理解，不需設定）

| 情境 | 行為 |
|---|---|
| LINE 登入成功 | 建立／更新 `line_accounts`，開民眾 session |
| 首次替某病人預約（LINE 登入中） | 仍需手機驗證碼，通過後自動綁定病人 ↔ LINE |
| 已綁定病人再預約 | 免驗證碼，通知走 LINE 推播 |
| 一個 LINE 帳號多位家庭成員 | 可於「查詢我的預約」頁自行綁定／解除，各成員限制分開計算 |
| LINE 登入失敗或民眾取消授權 | 導回查詢頁改用手機驗證碼，**預約流程不中斷** |
| 民眾封鎖官方帳號 | webhook 標記為非好友，之後通知自動改發簡訊 |
| 通知內容 | 一律不含完整證件號與病情資訊 |

安全註記：串接完全依 LINE 官方 OAuth 2.0（authorization code flow），
系統**不會**也無法接觸民眾的 LINE 密碼；access token 僅在換取 profile 當下使用，不落地保存。

---

## 九、常見問題

| 狀況 | 處理 |
|---|---|
| 檢測顯示「LINE 回應 HTTP 401」 | token 打錯或已重新發行，回 Console 重新 Issue 後更新環境變數 |
| 檢測顯示「HTTP 400」（Login） | Channel ID 與 secret 不是同一個 channel 的，請重新核對 |
| 授權後回到頁面卻沒登入 | Callback URL 與 `APP_BASE_URL` 不一致（含結尾斜線、http/https）|
| Webhook Verify 失敗 | 網址打錯，或 `LINE_MESSAGING_CHANNEL_SECRET` 未設定 |
| 民眾收不到 LINE 通知 | 多半是沒加官方帳號為好友；病人頁可看綁定狀態，也可在總覽點「傳送通知」補發 |
