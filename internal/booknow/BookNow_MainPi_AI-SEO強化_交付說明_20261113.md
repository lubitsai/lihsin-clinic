# BookNow／MainPi｜AI SEO・SEO・AEO・GEO 強化交付說明（2026-11-13）

> 院長指示：「優化 BookNow 及 MainPi 的 AI SEO/SEO/AEO/GEO」。只動 `internal/**`，兩平台後台由院長貼上。

## 一、兩個平台能被搜尋引擎與 AI 讀到的範圍（2026-11-13 實測）

| | BookNow `lhpedclinic.booknow.com.tw` | MainPi `www.mainpi.com/query?i=2935` |
|---|---|---|
| title／meta | title「立欣診所 \| BookNow」；**description、keywords 皆空** | title「立欣診所」、og 為平台預設；**不可自訂**（07-15 廠商回覆） |
| robots | robots.txt 404（不擋）、頁面無 noindex | 只擋 serpstatbot；07-15 廠商回覆無 noindex |
| 伺服器端輸出（爬蟲讀得到） | H1「立欣診所」、**「關於我們」富文字**、聯繫我們、營業時間 | 佈告欄全文＋JSON-LD（07-15 廠商確認可放 script） |
| 前端 AJAX 載入（多數 AI 爬蟲讀不到） | 四個服務項目的說明 | — |
| 本週 AI 搜尋實測 | 搜「立欣診所 booknow 預約」「立欣診所 看診進度 mainpi」**都沒有命中這兩頁**；命中的是 LINE 官方帳號公開頁 `page.line.me/179tddtf` | 同左 |

**結論**：BookNow 唯一有搜尋價值的欄位是「關於我們」；四個服務說明是給已進入預約流程的家長看的（11-12j 稿已處理），對 SEO 沒有作用。MainPi 的稿件早已做滿（WebPage＋MedicalClinic＋FAQ 10 題），**最大的落差是線上仍是 9 月版**——貼上去本身就是最有效的一步。

## 二、本批改了什麼

### BookNow（`internal/booknow/貼上用_20261112/`）

| 檔 | 改動 | 為什麼 |
|---|---|---|
| 1 店家介紹（**改寫**，取代 11-12j 版） | 第一段改為答案前置的實體描述（名稱・地址・地標・開業・健保特約・醫師・服務）；+看診醫師兩行（專科＋證書字號＋醫事查詢入口）；+4 題問答（預約≠掛號、週末門診、看診進度、非急診） | 「關於我們」是伺服器端輸出，搜尋摘要與 AI 引用都從這裡取；問答格式讓 AEO 直接抽答案。每句取自官網已核可文字（`llms.txt` 摘要、`visit-guide` 規則、首頁） |
| 7 SEO 描述（新增，選用） | 72 字 description | 線上 description 是空的；**後台有欄位才貼** |
| 8 結構化資料（新增，選用） | `WebPage`（含 `ReserveAction`）＋`MedicalClinic`（`@id` 指回官網 `#organization`，地址・電話・7 組營業時間・sameAs 照官網＋LINE 公開頁） | 讓搜尋引擎與 AI 把預約頁認成同一家診所。富文字編輯器可能剝除 `<script>`：貼後檢視原始碼搜 `ld+json`，沒有就刪掉，不影響其他內容 |

2～6 號檔（四服務說明＋聯繫我們）維持 11-12j 版不動。

### MainPi（`internal/mainpi/貼上用_20261112/`，同步改 `MainPi佈告欄_整合版_20261112.html.txt`、`MainPi_AI搜尋提示詞_整合版_20261112.md`）

| 改動 | 為什麼 |
|---|---|
| 佈告欄 JSON-LD `MedicalClinic.sameAs` +`https://page.line.me/179tddtf` | AI 搜尋實測唯一命中的立欣頁面；加入實體連結讓三個站外頁互相背書 |
| `WebPage` +`dateModified: 2026-11-13` | 新鮮度訊號（title／meta 不可改，只能靠結構化資料） |
| AI 搜尋提示詞：LINE 官方帳號條 +公開頁網址；重要連結 +1 條 | 同上 |

## 三、建議但本批沒做（需院長裁示）

- **官網首頁 `sameAs` 加 `https://page.line.me/179tddtf`**：官網目前 7 條沒有這頁。屬 schema 變更（判準②）→ 要開 PR。說「做」就開。
- **BookNow 店名不要加關鍵字**（例如「立欣診所｜台南小兒科」）：與 GBP 名稱塞字同類（`02` §3-3 紅線），也會破壞 NAP 一致。

## 四、合規自檢

可見超級詞 0；價格 0；評分數字 0；aggregateRating 0；非急診句照首頁原文；證書只寫字號（無身分證字號）；JSON-LD `json.loads` 通過（BookNow 選用塊、MainPi 佈告欄）。

## 五、貼上後核對（院長回報「已貼」後由 session 讀線上頁）

- BookNow 頁面搜尋：「醫字第」**2**｜「非急診」**1**｜「新診所」**0**｜原始碼「ld+json」有＝選用塊生效
- MainPi 原始碼：「page.line.me/179tddtf」**1**｜「dateModified」**1**｜「早鳥」**0**
