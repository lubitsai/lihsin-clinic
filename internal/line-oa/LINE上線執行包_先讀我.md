# 立欣診所 LINE 上線執行包（2026-11-11，LINE 客服 2.54）

共三件事：**A 和 B 要在同一個時段一起完成**；C 等正式上線後再找時間設定（一次性）。（圖文選單另有一件 D：右下格改成「衛教專區」，可另外找時間做，見文末。）

| 資料夾 | 做什麼 | 誰做 | 時間 |
|---|---|---|---|
| `1_部署LINE客服/` | A. 把 LINE 客服 2.54 部署到 Google Cloud Run | 院長（要用 Google Cloud 帳號） | 約 40 分鐘 |
| `2_LINE後台_過敏氣喘諮詢/` | B. LINE 後台換圖、關掉兩組自動回應 | 院長或櫃檯 | 約 10 分鐘 |
| `1_部署LINE客服/部署操作步驟.md` 第九步 | C. 設定題庫自動更新（Cloud Build） | 院長（Google Cloud 帳號） | 約 15 分鐘，一次性 |

**⚠️ 開始前：確認官網已有小鹿醫師卡片圖**（PR #529 已於 2026-11-07 合併）。手機打開 https://lhpedclinic.com.tw/images/line/service-pediatrics.jpg 看得到圖才開始。

開始前先準備好：
- Google Cloud Console 登入帳號，要能管理目前跑 LINE 的 Cloud Run 服務
- LINE Developers 的 **Channel secret** 和 **Channel access token (long-lived)**
- 一支員工手機（當管理員和測試者用）
- 一支不是管理員的 LINE（最後確認一般家長看到的畫面）

---

## A. 部署 LINE 客服（`1_部署LINE客服/`）

照 **`部署操作步驟.md`** 的第一到第六步做。最常用的四行指令先列在這裡，`<…>` 換成你的值：

```
gcloud config set project <專案ID>
python3 -m zipfile -e 立欣診所_LINE客服_*.zip lh && cd lh/line-helpdesk
bash deploy_cloudrun.sh <服務名稱> <區域> --dry-run
bash deploy_cloudrun.sh <服務名稱> <區域>
```

- 第三行是**試跑**，不會改任何東西。先確認畫面上的「目前上線版本」和「Webhook 網址」都正確，再執行第四行。
- 第四行每一步都會先問，輸入 `y` 才做。部署完是**測試模式**，一般家長看到的和現在一樣。
- 測試全部打勾後，一行指令切成正式模式（`部署操作步驟.md` 第五步）。

## B. LINE 後台（`2_LINE後台_過敏氣喘諮詢/`）

在 A 的部署完成之後、**切成正式模式之前**做：

1. **LINE Official Account Manager → 自動回應訊息 → 關閉「最新門診異動」這組關鍵字回應。**
   之後改由新程式讀官網公告回答，不用再手動換圖。
2. **關閉「營業時間外」的通用自動回應**（「感謝您的訊息！我們將於營業時間盡快回覆您！」那則），否則夜間家長每問一句都會多收一則。
3. 「流感疫苗資訊」「過敏氣喘諮詢」「減重營養諮詢」三組**保留**。
4. 「過敏氣喘諮詢」的多頁訊息換成資料夾裡的 4 張圖，順序照檔名，每張卡的點擊動作設成：

   | 卡片 | 點擊後開啟 |
   |---|---|
   | 1_過敏氣喘特別門診 | https://liff.line.me/2005432137-reYdg0y3（線上掛號） |
   | 2_哪些問題可以看 | https://lhpedclinic.com.tw/services/pediatric-allergy-asthma.html |
   | 3_過敏專診內容 | https://lhpedclinic.com.tw/services/pediatric-allergy-asthma.html |
   | 4_過敏原檢測價目 | https://lhpedclinic.com.tw/services/allergy-testing.html |

5. 「減重營養諮詢」的 5 張圖不用動。

---

## C. 題庫自動更新（第五步正式上線後再做，一次性）

照 **`部署操作步驟.md` 第九步**：在 Cloud Build 連結 GitHub、建立觸發條件 `line-faq-autodeploy`、給權限、試跑一次。

設好之後：官網內容一改、題庫進 GitHub `main`，約 5～10 分鐘 LINE 就自動換新，**不用再下載 zip**。
- 只有題庫會自動更新；程式本身有改時會自動停下，改走 A 的手動部署＋測試模式。
- 部署前會先跑完整測試，沒過就不部署；失敗時 LINE 繼續用上一版題庫回答，不會中斷。
- **前提**：一定要先用 2.50 以後的 zip 做過一次 A，自動部署才能比對程式有沒有改。

---

## 做完請傳回給我

1. A 的 Cloud Shell 最後畫面截圖（看到「完成」那一段）
2. `部署操作步驟.md` 第四步的實測清單，是不是全部打勾
3. C 設好後，Cloud Build「記錄」裡第一次試跑的結果（綠色或紅色訊息截圖）

中途卡住，或出現看不懂的訊息，直接截圖傳給我。如果出現「此服務由 Cloud Functions 管理」之類的警告，**先回答 N 停下來**，截圖給我再繼續。

## 出問題時

- 新回答怪怪的，但服務還正常 → `部署操作步驟.md` 第六步：改成 `BOT_MODE=off`，原本的卡片照常回覆。
- LINE 完全沒有回應 → 在 Cloud Shell 執行 `bash -c "$(cat rollback_command.txt)"`，流量會切回部署前的版本；**退回後請把後台「最新門診異動」關鍵字回應重新打開**（營業時間外通用回應也可視需要打開）。

---

## D. 圖文選單右下格改成「衛教專區」（可另外找時間，約 10 分鐘）

資料夾 `3_圖文選單衛教專區/` 有兩個檔案：`line_menu_clinic_ready.py`（Colab 腳本）、`rich-menu-9area-health.jpg`（新選單圖）。

1. 打開 https://colab.research.google.com → 新增筆記本 → 貼上腳本全文 → 執行。
2. 貼上 Channel access token（畫面不顯示）→ 上傳 `rich-menu-9area-health.jpg`。
3. 核對 9 個區域：右下應為「衛教專區 → https://lhpedclinic.com.tw/health/」，中間品牌帶為「官網首頁」。輸入 `發布`。
4. 手機重開 LINE，點右下「衛教專區」確認開到官網衛教頁；把下載的 `line_menu_backup.json` 傳回來。

粉絲專頁改放在「診所資訊」卡片底下的按鈕（A 部署 2.54 後生效）。
