---
name: infographic-upload
description: 立欣診所官網「對話上傳圖片 → 改名轉檔 → 上 GitHub」的標準流程。凡院長在對話中直接上傳一張衛教圖／資訊圖／海報（poster），並要求放到網站、換掉某頁的圖、做成首頁最新消息卡圖、或說「幫我改名轉檔／轉成 webp／做縮圖／上傳 github」——一律先載入本 Skill 再動手。本 Skill 封裝已驗證的 5 檔衍生規格（1254²主圖 jpg/webp＋768²行動 webp＋480²縮圖 jpg/webp）與掛載慣例，用 internal/tools/make_infographic.py 一鍵產檔，避免尺寸／檔名／品質不一致與漏檔。
---

# 對話上傳圖片 → 改名轉檔 → 上 GitHub（SOP）

本 Skill 是**流程封裝**。事實、合規規則、待決狀態以 `internal/00_專案總覽索引.md`
為準；判斷方法以 `internal/02_優化決策手冊.md` 為準；與 internal/ 衝突時 internal/ 勝。

適用：院長在對話中**直接上傳一張圖**（衛教資訊圖／海報），要放上網站。
不適用：多圖批次、非資訊圖的 UI 素材、需重新繪製內容（那走 seo-geo-content 的 Mode B
「重製資訊圖」或請院長提供原稿）。本 Skill 只做**忠實搬運＋標準轉檔**，不改圖內容。

## 標準產物（5 檔，與 flu-vaccine-2026 / covid-19-2026 既有圖組一致）

| 檔名 | 尺寸 | 格式 | 用途 |
|---|---|---|---|
| `<slug>-infographic.jpg` | 1254² | JPEG q86 progressive | 內文主圖 fallback／og:image |
| `<slug>-infographic.webp` | 1254² | WebP q82 | 內文主圖 |
| `<slug>-infographic-768.webp` | 768² | WebP q82 | 行動版 source（sizes 切換）|
| `<slug>-thumb.jpg` | 480² | JPEG q86 | 首頁最新消息卡 fallback |
| `<slug>-thumb.webp` | 480² | WebP q82 | 首頁最新消息卡縮圖 |

`slug` ＝承載頁檔名主幹（例：`covid-19-2026`、`flu-vaccine-2026`）。工具會自動接
`-infographic` / `-thumb` 尾綴，**slug 不要自己再打 -infographic**。

## 步驟

### 0 前置
- 確認**承載頁與 slug**：是新頁的主圖，還是替換某既有頁的舊圖？slug 取該頁檔名主幹。
- 上傳圖的實體路徑通常在 `/root/.claude/uploads/<session>/<檔名>`（院長訊息會帶 `@"…"`）。

### 1 讀圖驗證（動手前必做）
- 用 **Read** 開啟上傳圖，**親眼確認**：
  - 內容與要搭配的文章／頁面一致（數字、變異株、症狀、來源、電話、LINE）。
  - 無錯字、無誇大或絕對宣稱（推薦／第一／100%／完全不感染）、有標註資料來源與日期。
  - 疫苗／醫療圖：合規紅線同 00 §4（不寫價格數字可入圖但需謹慎、非急診定位）。
- 有疑慮先回報院長，不逕自上稿。**沒讀過的圖不上傳。**

### 2 產檔（一鍵）
```
python3 internal/tools/make_infographic.py "<上傳圖路徑>" <slug>
# 先看檔名清單可加 --dry；非正方來源預設置中裁切，補白邊用 --crop pad
```
輸出寫入 `images/`，覆寫同名檔（冪等：同來源產出 byte-identical）。

### 3 掛載
- **替換既有頁的圖**：檔名相同 → HTML 免動，直接進第 4 步。
- **新頁主圖／新首頁卡**：HTML 用下列標準片段（比照 flu/covid 模板），檔名對齊 slug：
  - 內文 `<figure>`：
    ```html
    <picture>
    <source type="image/webp" srcset="/images/<slug>-infographic-768.webp 768w, /images/<slug>-infographic.webp 1254w" sizes="(max-width: 767px) 82vw, 700px">
    <img src="/images/<slug>-infographic.jpg" width="1254" height="1254" loading="lazy" decoding="async" alt="…忠實描述圖內重點…" class="w-full max-w-2xl mx-auto rounded-2xl shadow-md">
    </picture>
    ```
  - 首頁最新消息卡：
    ```html
    <source type="image/webp" srcset="/images/<slug>-thumb.webp">
    <img src="/images/<slug>-thumb.jpg" width="480" height="480" loading="lazy" decoding="async" alt="…" class="w-full">
    ```
  - og:image 指向 `/images/<slug>-infographic.jpg`。**width/height 必填**（防 CLS）。

### 4 驗證（ERROR 清零才能 push）
```
python3 internal/tools/validate_site.py --root . --stage deploy
```
E-LINK（圖不存在）代表檔名沒對上或漏檔——回第 2/3 步。WARN 逐條判讀。

### 5 commit ＋ push（上 GitHub）
- commit 訊息用**英文**，清楚描述（見 00 使用者偏好）。
- push 到當前工作分支：`git push -u origin <branch>`（網路失敗才指數退避重試）。
- 除非院長明講，**不主動開 PR**。

### 6 merge 後
- 若圖對應**新頁**或**可見內容實質變更** → 提交 IndexNow
  （`python3 internal/tools/submit_indexnow.py <URL…>`）。純換圖不改醫療內文 → 見下。

## dateModified 判準（R4）
換圖屬**可見素材更新、非醫療內文重審** → 一般**不跳** dateModified
（同 desc/og/schema 技術層）。唯有同時實質改寫醫療內文並經醫師核可才跳。
新頁首度上圖：新頁三日期本就＝發布當日，照舊。

## 相依與環境
- 工具用 **Pillow**；容器為臨時環境，缺少時 `make_infographic.py` 會自動 `pip install Pillow`。
- 不需要 sharp／cwebp／ImageMagick／Playwright；本流程純 Pillow 即可完成全部轉檔。
- `images/` 為公開部署目錄；`internal/`、`.claude/` 已由 `_redirects` §5 強制 404，本 Skill
  與工具不對外。
