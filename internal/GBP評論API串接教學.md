# Google 評論自動化串接教學（A 爬取＋B 官方 API）

> **版本**：v1，2026-11-25
> **用途**：讓 Claude Code session 能直接讀取立欣診所 Google 評論、產回覆初稿、經院長核可後送出，不必再手動複製貼上。
> **配套工具**：`internal/tools/gbp_reviews.py`（B 路線）；回覆規則以 `internal/04_Google評論回覆規則.md` 為準。
> ⚠️ **本 repo 為公開**：本檔與任何 commit 都**不寫入**金鑰、token、帳號 ID、地點 ID、評論者姓名或評論原文。

---

## 零、先看全貌

| | A：爬 Google 地圖頁 | B：Google 商家檔案 API（主力） |
|---|---|---|
| 能做什麼 | 只能**讀**評論 | **讀＋送出回覆** |
| 穩定度 | 低（雲端 IP 易被 Google 判為機器人、頁面改版就壞） | 高（官方介面） |
| 院長要做的 | 加 4 個網域（5 分鐘） | 申請 API 權限＋建立 OAuth（約 30 分鐘，另等 Google 審核數天～數週） |
| 每次使用 | 開 session 即可 | 先取一次 token（約 1 分鐘，效期 1 小時） |
| 定位 | B 審核期間的過渡 | 長期方案；B 通了 A 即可停用 |

**建議順序**：第一章（B 申請，最久的是等審核）→ 第二章（環境設定，A、B 共用）→ 審核通過後做第三章。

> 💡 全程用**管理立欣診所商家檔案的那個 Google 帳號**登入（擁有者或管理員）。用別的帳號會在最後一步得到「無權限」。

---

## 第一章　B：申請 Google 商家檔案 API 權限（一次性）

### 1-1 建立 Google Cloud 專案
1. 開 `https://console.cloud.google.com/`，用商家帳號登入（首次會要求同意服務條款）。
2. 上方專案選單 →「新增專案」→ 名稱填 `lihsin-gbp`（任意）→ 建立。
3. 確認上方已切換到這個專案。到「IAM 與管理 → 設定」記下**專案編號**（一串數字，申請表要用）。

> 費用：商家檔案 API 本身免費，不需綁信用卡。

### 1-2 送出 API 存取申請（最久的一步，先送）
1. 開 Google 官方說明 `https://developers.google.com/my-business/content/prereqs`，依「Request access to the API」連到申請表。
2. 申請類型選基本 API 存取（Basic API Access），填入 1-1 的**專案編號**、商家名稱、官網 `https://lhpedclinic.com.tw`、聯絡 Email（同商家帳號）。
3. 用途說明可寫：「本診所自行管理 Google 商家檔案的評論，讀取評論並由院長回覆」。
4. 送出。Google 的資格條件是：商家已驗證、營運滿 60 天以上、有代表商家的官網——立欣皆符合。

**怎麼知道核准了**：到「API 和服務 → 程式庫」搜尋 **My Business Account Management API** →「管理」→「配額」。每分鐘配額是 **0** = 尚未核准；變成 **300** 之類的數字 = 已核准。Google 通常也會寄信通知。

### 1-3 啟用 API（核准前就能先做）
「API 和服務 → 程式庫」逐一搜尋並按「啟用」：
- **Google My Business API**（讀寫評論用，v4）
- **My Business Account Management API**
- **My Business Business Information API**

### 1-4 設定 OAuth 同意畫面
1. 左側選單「Google Auth Platform」（舊介面叫「OAuth 同意畫面」）。
2. 尚未設定的話按「開始」：
   - 應用程式名稱：`立欣評論工具`（任意）；使用者支援 Email：商家帳號。
   - 目標對象（Audience）：**外部（External）**。
   - 聯絡資訊：商家帳號 Email → 同意政策 → 建立。
3. 「目標對象」頁：發布狀態維持**測試中（Testing）**即可，在「測試使用者」**加入商家帳號 Email**。

### 1-5 建立 OAuth 用戶端
1. 「Google Auth Platform → 用戶端（Clients）」→「建立用戶端」。
2. 應用程式類型：**網頁應用程式**；名稱任意。
3. 「已授權的重新導向 URI」新增，**一字不差**：
   `https://developers.google.com/oauthplayground`
4. 建立 → 畫面會顯示**用戶端 ID** 與**用戶端密碼**。按下載 JSON 自行保存（**不要貼進聊天、不要傳到任何 repo**）。

---

## 第二章　環境設定（A、B 共用，一次性）

立欣有一個專屬的雲端環境「**lihsin-clinic-sites**」。網域與帳號 ID 都設在這裡，**不要設在 Default**（Default 是所有專案共用的）。

1. 在 Claude Code（網頁 `claude.ai/code` 或 App）開任一 session，點標題列的**雲端環境選單** → 選 **lihsin-clinic-sites** →「Edit」。
2. **Network access**（A 才需要；只走 B 可略過這步）：
   - 維持 **Limited**，「Allow package managers」**保持勾選**。
   - 在 **Allowed domains** 逐行加入：
     ```
     www.google.com
     www.gstatic.com
     maps.gstatic.com
     consent.google.com
     ```
3. **Environment variables**（B 用；非機密，可放）：新增兩個變數，數值請向 Claude 索取（已由先前的評論匯出檔取得，刻意不寫進公開 repo）：
   ```
   GBP_ACCOUNT=（帳號 ID，一串數字）
   GBP_LOCATION=（地點 ID，一串數字）
   ```
4. 儲存。設定**只對新開的 session 生效**：之後要處理評論，請**選 lihsin-clinic-sites 環境＋lihsin-clinic repo 開新 session**。

官方說明：`https://code.claude.com/docs/en/cloud-environments#network-access`

---

## 第三章　B：每次使用流程（核准後）

### 3-1 取得 access token（約 1 分鐘，效期 1 小時）
1. 開 `https://developers.google.com/oauthplayground`。
2. 右上**齒輪** → 勾選「**Use your own OAuth credentials**」→ 貼上 1-5 的用戶端 ID 與用戶端密碼 → 關閉。
3. 左側 Step 1 最下方輸入框填：
   `https://www.googleapis.com/auth/business.manage`
   →「Authorize APIs」→ 用**商家帳號**登入。
   - 出現「Google 尚未驗證這個應用程式」：按「進階」→「前往（不安全）」。這是你自己的測試用 App，屬正常。
4. Step 2 按「**Exchange authorization code for tokens**」→ 畫面上的 **Access token**（`ya29.` 開頭）就是要用的。

### 3-2 交給 Claude
1. 在 lihsin-clinic-sites 環境的 session 跟 Claude 說：「**token 好了，抓評論**」。
2. Claude 會跳出一張**安全表單**（主機 `mybusiness.googleapis.com`）→ 把 token 貼進表單 → 儲存。
   - **絕對不要把 token 貼在聊天訊息裡。** 表單裡的值 Claude 看不到，由系統代為帶入。
3. Claude 會依序：
   1. 列出所有**尚未回覆**的評論（只顯示在對話裡，不存檔、不 commit）。
   2. 依 04 規則逐則產生回覆初稿；三星以下或含申訴的，會加 ⚠️ 提醒行，建議先打電話。
   3. **你逐則確認或修改**。
   4. 你說「送出」後才逐則送出，送完回報結果。

token 一小時後失效。下次使用從 3-1 重來即可，不需重做第一、二章。

---

## 第四章　A：爬取流程（第二章網域設好後）

在 lihsin-clinic-sites 環境的新 session 跟 Claude 說「**用 A 抓 Google 評論**」。Claude 會用內建的 Chromium 開 Google 地圖商家頁讀取評論，再依 04 規則產初稿。

- A **不能送出回覆**：初稿核可後，仍由院長到 Google 商家檔案（或 Google 地圖 App）手動貼上。
- 若 Google 跳出驗證碼或「異常流量」，代表雲端 IP 被擋，A 就無法使用，請改等 B 或直接貼評論給 Claude。
- 第一次測試時若發現還缺其他網域，Claude 會列出來，再回第二章補上。

---

## 第五章　常見錯誤

| 現象 | 原因 | 處理 |
|---|---|---|
| HTTP 401 `UNAUTHENTICATED` | token 過期（超過 1 小時）或沒存進表單 | 重做 3-1、3-2 |
| HTTP 403 `has not been used in project` / `disabled` | 1-3 的 API 沒啟用 | 回 1-3 啟用，等幾分鐘再試 |
| HTTP 429 或配額 0 | 1-2 尚未核准 | 等 Google 核准通知 |
| HTTP 403 `PERMISSION_DENIED`（caller does not have permission） | 3-1 登入的不是商家擁有者／管理員帳號 | 換商家帳號重新取 token |
| OAuth Playground 顯示 `redirect_uri_mismatch` | 1-5 重新導向 URI 不完全一致 | 確認為 `https://developers.google.com/oauthplayground`，結尾不加斜線 |
| `access_denied` / 不在測試使用者名單 | 1-4 沒加測試使用者 | 回 1-4 加入商家帳號 Email |
| A 出現驗證碼／異常流量 | 雲端 IP 被 Google 擋 | 改走 B 或手動貼評論 |
| Claude 說連不到 `www.google.com` | 第二章網域沒加，或 session 不是開在 lihsin-clinic-sites | 檢查環境設定後開新 session |

---

## 第六章　隱私與合規（不變的規則）

1. **回覆一律院長逐則核可後才送出。** 工具預設只預演；必須另外下確認參數才會真的送。
2. 回覆內容依 **04 規則**：回應主題、不確認個案、不提就診日期與療效（02 §3-4）。
3. **評論資料不落地**：評論者姓名、評論原文只出現在對話與 session 暫存區，**不 commit 進本 repo**，因為 repo 為公開。
4. **金鑰不落地**：用戶端密碼由院長自行保管；access token 只走安全表單；帳號 ID、地點 ID 存在環境變數，不寫進 repo。
5. 若不再使用：到 Google Cloud「Google Auth Platform → 用戶端」刪除該用戶端，即可讓所有 token 失效。
