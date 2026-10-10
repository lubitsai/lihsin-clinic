---
name: short-video
description: 立欣診所「一段錄音 → 9:16 短影音（Shorts／Reels／限動）」的標準流程。凡院長要把口述衛教錄音做成直式短影片、問怎麼上字幕／去停頓／做字卡／配樂／接片頭尾、交來一份 SRT 字幕要校稿、要擬影片字卡標題，或改動 internal/tools/make_short.sh——一律先載入本 Skill 再動手。本 Skill 封裝已實測的 make_short.sh 一鍵流程、踩過的雷與可見文字合規關卡。
---

# 錄音 → 9:16 短影音（SOP）

本 Skill 是**流程封裝**。事實、合規規則、待決狀態以 `internal/00_專案總覽索引.md`
為準；與 internal/ 衝突時 internal/ 勝。工具＝`internal/tools/make_short.sh`
（2026-10-10e 入庫，用法與參數全寫在檔頭，**先讀檔頭再回答**）。

適用：口述衛教、門診提醒等「一段人聲＋背景圖」的直式短片。
不適用：多機位剪輯、實拍畫面調色、動畫製作（那不是腳本能做的事，直說並建議剪輯軟體）。

## 分工：誰在哪裡跑

- **腳本在院長自己的電腦跑**（Mac：`brew install ffmpeg imagemagick`；
  `pip install openai-whisper auto-editor`）。雲端 session 沒有 Whisper／Auto-Editor，
  也拿不到院長的錄音檔，**不要假裝在 session 裡產出成片**。
- **session 能做的**：①擬字卡標題（附備選）②校稿院長貼回來的 `cut.srt`
  ③合規把關 ④依院長回報的錯誤訊息除錯、調參數 ⑤改腳本本身。
- **影片、錄音、SRT 一律不進 repo**（檔案大，且整棵樹公開部署）。

## 流程（順序不能換）

1. **Auto-Editor 去停頓** → `cut.m4a`
2. **Whisper 轉字幕**（對**剪好的**檔）→ `cut.srt`，腳本停下等人工校稿
3. **ImageMagick 字卡**（透明底 1080×1920）
4. **ffmpeg 合成**：背景裁 9:16＋前 N 秒疊字卡＋燒字幕＋混配樂
5. **接片頭片尾**（可省略）
6. 輸出 `short_out/final_9x16.mp4`

⚠️ **先去停頓、再轉字幕。** 反過來做，字幕時間軸會整條錯位（院長原稿就是顛倒的）。

```bash
internal/tools/make_short.sh voice.m4a bg.jpg bgm.mp3 "字卡標題" [片頭.mp4] [片尾.mp4]
```

環境變數：`OUT_DIR`、`FONT_NAME`、`CARD_FONT`、`WHISPER_MODEL`（預設 medium）、
`BGM_VOLUME`（預設 0.12）、`CARD_SECONDS`（預設 3）。

## 可見文字合規關卡（上片前必過）

字卡標題與字幕都是**可見文字**，比照官網：

- 寫字卡標題前讀 `.claude/skills/seo-geo-content/references/anti-ai-tone.md`，
  並依 `references/marketing-toolkit.md` 自選工具，交付時列出選用工具與備選版本。
- 對照 `internal/00` §4 紅線：超級詞（推薦／最佳／第一／權威／資深）、疫苗四但書、
  價格數字、絕對宣稱（保證／一定／根治）、評分數字。
- **字幕是院長口述的逐字稿**：只改錯字、簡體字、藥名與醫療用語；講出口的內容踩線時
  **標出來請院長決定重錄或剪掉**，不要在字幕裡偷改成跟聲音不一樣的話。
- 字卡與字幕**經院長逐字核可**才上片。

## 校稿 SRT 的檢查清單

- 簡體字殘留（Whisper 已加 `--initial_prompt` 但不保證）：发→發、烧→燒、疫苗名稱等
- 藥名、疫苗名、病名與官網用字一致（例：「B 型腦膜炎雙球菌疫苗」不寫舊稱）
- 每條字幕一行、建議 ≤16 字（1080 寬、約 80px 字高）；過長拆條，**時間碼不動**
- 數字與單位（體溫 38.5°C、劑量）逐一對照聲音

## 踩過的雷（已寫進腳本，改腳本時別改回去）

| 症狀 | 原因 | 腳本做法 |
|---|---|---|
| 合成永遠跑不完 | 背景圖 `-loop 1`、配樂 `-stream_loop -1` 皆無限，`-shortest` 經 `filter_complex` 收不了尾 | ffprobe 量人聲長度給 `-t` |
| 校稿暫停被跳過 | ffmpeg 讀 stdin 吃掉 Enter | ffmpeg 一律 `-nostdin`；whisper／auto-editor 接 `</dev/null` |
| 人聲變小 | `amix` 預設把各軌音量平均 | `normalize=0` |
| 字幕巨大或跑到畫面中間 | libass 以 288 高為基準換算 | `FontSize=12`（≈80px）、`MarginV=40`（≈距底 267px），不要照像素填 |
| 中文變方框 | 字型名稱不存在 | 腳本會警告；`fc-list :lang=zh` 查名稱後設 `FONT_NAME`／`CARD_FONT` |
| 接片頭失敗 | 規格不一或沒有音軌 | 片頭尾須 1080×1920、30fps、帶音軌（靜音亦可） |

想要「說話時配樂自動降低」：把 `volume` 改成 `asplit`＋`sidechaincompress`，改完必實跑驗證。

## 改腳本時的驗證

session 沒有 Whisper／Auto-Editor → 在 scratchpad 放替代程式跑全流程：
`auto-editor` 替身＝`ffmpeg -nostdin -i "$1" -c:a aac "$6"`；`whisper` 替身＝寫一份兩條的
`cut.srt`；`magick` 替身＝`exec convert "$@"`。以 `ffmpeg -f lavfi` 生測試音、背景、片頭，
`echo | timeout 100 env PATH=替身目錄:$PATH … make_short.sh …` 實跑，確認：
exit 0、ffprobe 為 1080×1920／30fps、總長＝片頭＋人聲、抽兩格截圖目視字卡與中文字幕。
**一定要加 `timeout`**（合成不收尾時會卡死 session）。

## 交付與登錄

- `internal/tools/make_short.sh`、本 Skill 屬內部檔，三條判準皆不成立 → **直進 `main`、不開 PR**。
  改 `00` 前先備份到 `internal/archive/`，push 前跑 `validate_site.py --stage deploy`。
- 影片要放上官網（嵌入頁面、加 VideoObject schema）是另一回事：屬判準①②，走 PR，
  並須先和院長討論託管位置（影片檔不進 repo）。
