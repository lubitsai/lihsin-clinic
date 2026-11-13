# LINE 官方帳號素材（後台現行版）

院長 2026-11-06 交付的 LINE 官方帳號後台素材原檔（`_redirects` 的 `/internal/*` 規則擋成 404，不公開）。
LINE 後台才是上線位置；這裡是留底與比對用，換圖時同步更新本資料夾與下表。

## 圖文選單（2500×1686）

`rich-menu-8grid.jpg`

**現行選單（2026-11-07 院長以 Colab 發布，九區）**：ID `richmenu-3a2fe334a0d45980122a6648dfdcec4e`，帳號 `@179tddtf`，設定備份 `current/line_menu_backup.json`（不含 Token）。前一版（10-01，八格）ID `richmenu-1f2a660df1cff1005a040f94d5c3bab7` 未刪，可退回，備份 `current/line_menu_backup_20261001.json`。OA Manager 原後台選單亦保留未刪。
（已完成）10-01 版可點區只有上排（y 0–610）與下排（y 1140–1686），中間品牌帶（y 610–1140）點了沒反應。**院長 2026-11-07 核可加第 9 區**：`current/line_menu_clinic_ready.py` 已改為九區（中間品牌帶 x 0／y 610／2500×530 → `https://lhpedclinic.com.tw/`），圖不用換（沿用 `rich-menu-8grid.jpg`，919 KB＜1 MB）。**✅ 2026-11-07 已發布**（見上方現行選單 ID）。

| 位置 | 按鈕 | 類型 | 動作 |
|---|---|---|---|
| 上排① | 線上掛號 | 網址 | https://liff.line.me/2005432137-reYdg0y3（BookNow；⚠️ 自建預約系統上線時要一起改） |
| 上排② | 看診進度 | 網址 | https://www.mainpi.com/query?i=2935 |
| 上排③ | 醫師介紹 | 文字 | 醫師介紹（LINE 客服程式以 `line-helpdesk/legacy_messages.json` 卡片回答） |
| 上排④ | 診所資訊 | 文字 | 診所資訊（同上；卡片上的「最新門診異動」按鈕自 2.37 起由程式讀官網公告回答） |
| 下排① | 流感疫苗資訊 | 文字 | 流感疫苗資訊（後台關鍵字回應） |
| 下排② | 過敏門診 | 文字 | 過敏氣喘諮詢（後台關鍵字回應） |
| 下排③ | 減重門診 | 文字 | 減重營養諮詢（後台關鍵字回應） |
| 下排④ | 粉絲專頁 → **衛教專區**（2026-11-11 改，待 Colab 發布） | 網址 | https://www.facebook.com/lhpedclinic/ → https://lhpedclinic.com.tw/health/ |
| 中間品牌帶 | （立欣診所 小兒專科、家庭醫學） | 網址 | https://lhpedclinic.com.tw/（2026-11-07 起） |

## 「過敏氣喘諮詢」多頁訊息（900×900，上下留白供多頁訊息使用，依序）

1. `allergy-1-banner.png` 過敏氣喘特別門診
2. `allergy-2-conditions.png` 哪些問題可以看
3. `allergy-3-services.png` 過敏專診內容
4. `allergy-4-test-prices.png` 過敏原檢測四套組價目（價格已進 LINE 客服 `prices_line.json` 的 `ALLERGY_TEST`，官網不報價；「最完整」標籤院長 2026-11-06 裁示維持，不外溢到其他素材）

## 「減重營養諮詢」多頁訊息（依序）

1. `weight-1-banner.png` 減重特別門診（1254×1254）
2. `weight-2-steps.png` 體重管理三步驟
3. `weight-3-course.png` 科學減重課程（4／8 週方案，無金額）；圖上「Cofit 營養師」未帶「本院與 Cofit 並無合作關係」但書，院長 2026-11-07 裁示先維持原圖
4. `weight-4-consult.png` 諮詢費 390 元（＝價目 W01）
5. `weight-5-team.png` 蔡醫師×杜昀憬營養師（官網本人照片）

減重營養課衛教影片只提供給付費學員，素材與回覆一律不得連結或提及。

## `archive/`：參考與舊版（不在後台使用）

| 檔案 | 說明 |
|---|---|
| `screenshot-chat-latest-notice-reply.png` | 2026-11-06 院長手機截圖：點「最新門診異動」仍回 10/23 颱風舊圖（2.37 起改由程式回答的起因） |
| `screenshot-oa-profile.png` | 2026-11-06 官方帳號主頁截圖（好友 7,847、常見問題門診時間，已核對與官網一致） |
| `allergy-v1-banner.png`／`allergy-v1-conditions.png`／`allergy-v1-test-prices.png` | 「過敏氣喘諮詢」第一版（順序：價目→專診內容→哪些問題→主視覺），已被上方第二版取代；第一版的專診內容與第二版同檔，未重複存 |
| `allergy-4-test-prices_candidate-A.png`／`_candidate-B.png` | session 改字候選（「最完整」→ A「項目最多」／B「合檢」）；**院長 2026-11-06 裁示維持原圖，未採用** |

## `current/`：現行程式與設定（院長 2026-11-07 交付）

| 檔案 | 說明 |
|---|---|
| `old-webhook-main.py` | LINE 客服 2.x 上線前的原 Cloud Run webhook（關鍵字：立欣診所／過敏減重諮詢／醫師介紹／診療項目／診所資訊）。Token／secret 為空字串。卡片內容已移入 `line-helpdesk/legacy_messages.json`，比對結果一致，唯一差異是 2.x 把門診時間改成 24 小時制（02:30 → 14:30 等） |
| `line_menu_clinic_ready.py` | 發布圖文選單的 Colab 腳本（Token 執行時隱藏輸入，不入檔）；2026-11-07 起為九區版（加中間品牌帶 → 官網首頁） |
| `line_menu_backup.json` | 2026-11-07 九區版發布時下載的選單設定與新舊選單 ID |
| `line_menu_backup_20261001.json` | 2026-10-01 八格版發布備份（退回用） |

## 上線執行包

`LINE上線執行包_先讀我.md`：給院長照做的 A（部署 LINE 客服到 Cloud Run）＋B（LINE 後台設定）總步驟，搭配 `../line-helpdesk/部署操作步驟.md`。
執行包 zip 不入庫（可重產）：部署包用 `python3 internal/tools/sync_assistants.py --zip <資料夾>` 產生，後台 4 張圖即本資料夾 `allergy-1～4`。

## 2026-11-11 官方 LINE 優化

- `rich-menu-9area-health.jpg`：右下格「粉絲專頁」改為「衛教專區」（翻開的書圖示＋jf open 粉圓字型，其餘 8 格不變）；Colab 腳本 `current/line_menu_clinic_ready.py` 已同步，**待院長發布**。粉絲專頁改放「診所資訊」卡片按鈕。
- `推播稿_202611.md`：11 月 LINE 群發稿（主推燙傷、備選冬季保濕），待院長逐字核可後在 OA Manager 群發。
- 「診療項目」新增 4 卡的圖片暫用小鹿吉祥物：院長做好正式插圖後，直接覆蓋官網 `images/line/service-{newborn,weekend,development-screening,designated-physician}.jpg`（1:1、淺綠底 `#f0f7ed`、無字），LINE 不必重新部署。

## 2026-11-13 圖文選單 v3（院長「全部依建議修改」，待院長 Colab 發布）

- `rich-menu-9area-v3.jpg`：由原始 `rich-menu-8grid.jpg` 一次重製（`build_rich_menu_v3.py`，jf open 粉圓字型、字級對齊原圖 76px 字高）：下排②③改「過敏氣喘」「科學減重」、④「衛教專區」（取代 11-11 的 `rich-menu-9area-health.jpg`，那版字小一號）、中間品牌帶加膠囊標籤「週六、週日與平日夜間都有門診」（原擬「週六、週日都有門診｜平日夜診到 21:30」在手機上約 5pt 太小，改短句放大到約 8pt）。
- Colab 腳本：兩個官網連結加 UTM（`utm_source=line&utm_medium=richmenu&utm_campaign=line_oa&utm_content=health｜brand_band`）。API 建立的選單在 OA 後台沒有點擊統計，改由 GA4 看。線上掛號（BookNow LIFF）與看診進度（MainPi）是外部網址，不加。
- ⏳ 流感季結束（2027 年春）後，左下「流感疫苗資訊」換成全年適用的「疫苗接種」或「新生兒照護」（見 `00` 待辦）。
