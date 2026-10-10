#!/usr/bin/env bash
# make_short.sh — 一段錄音 → 9:16 短影音成品（去停頓、字幕、字卡、配樂、片頭尾）。
#
# 用途：院長錄好一段口述衛教，在自己的電腦上一條指令做成 Shorts／Reels／限動用直式影片。
# 本腳本只在本機跑，產出不進 repo（影片檔大且整棵樹公開部署）。
#
# 流程（注意：先去停頓、再轉字幕，否則字幕時間軸會整條錯位）：
#   ① Auto-Editor 去停頓 → ② Whisper 轉繁中字幕（停下來人工校稿）
#   → ③ ImageMagick 做字卡 → ④ ffmpeg 背景裁 9:16＋疊字卡＋燒字幕＋混配樂
#   → ⑤ 接片頭片尾（可省略）→ ⑥ 輸出 final_9x16.mp4
#
# 安裝（Mac）：brew install ffmpeg imagemagick；pip install openai-whisper auto-editor
#
# 用法：
#   internal/tools/make_short.sh <錄音> <背景圖> <配樂> "<字卡標題>" [片頭.mp4] [片尾.mp4]
#   例：internal/tools/make_short.sh voice.m4a bg.jpg bgm.mp3 "孩子發燒先看精神"
#
# 環境變數（選用）：
#   OUT_DIR        輸出資料夾（預設 ./short_out）
#   FONT_NAME      字幕字型名稱（預設 Noto Sans TC；用 fc-list :lang=zh 查系統有哪些）
#   CARD_FONT      字卡字型（ImageMagick 名稱或字型檔路徑，預設 Noto-Sans-TC-Bold）
#   WHISPER_MODEL  Whisper 模型（預設 medium；機器慢可改 small）
#   BGM_VOLUME     配樂音量（預設 0.12）
#   CARD_SECONDS   字卡顯示秒數（預設 3）
#
# ⚠️ 合規：字卡標題與字幕都是「可見文字」，上片前須依 internal/00 §4 對照合規紅線
#   （超級詞、疫苗四但書、價格數字、絕對宣稱），並經院長逐字核可。
# ⚠️ 片頭片尾須為 1080×1920、30fps 且帶音軌（靜音亦可），否則 concat 會失敗。
# ⚠️ 字幕 FontSize／MarginV 以 libass 預設 288 高為基準再放大到 1920：
#   FontSize=12 ≈ 80px、MarginV=40 ≈ 距底 267px；不要照像素填。
set -euo pipefail

if [[ $# -lt 4 || $# -gt 6 ]]; then
  sed -n '2,30p' "$0"; exit 1
fi

IN="$1"; BG="$2"; BGM="$3"; TITLE="$4"; INTRO="${5:-}"; OUTRO="${6:-}"
OUT_DIR="${OUT_DIR:-./short_out}"
FONT_NAME="${FONT_NAME:-Noto Sans TC}"
CARD_FONT="${CARD_FONT:-Noto-Sans-TC-Bold}"
WHISPER_MODEL="${WHISPER_MODEL:-medium}"
BGM_VOLUME="${BGM_VOLUME:-0.12}"
CARD_SECONDS="${CARD_SECONDS:-3}"

for cmd in ffmpeg ffprobe magick whisper auto-editor; do
  command -v "$cmd" >/dev/null || { echo "缺少 $cmd，請先安裝（見檔頭）" >&2; exit 1; }
done
for f in "$IN" "$BG" "$BGM" ${INTRO:+"$INTRO"} ${OUTRO:+"$OUTRO"}; do
  [[ -f "$f" ]] || { echo "找不到檔案：$f" >&2; exit 1; }
done
if command -v fc-list >/dev/null && ! fc-list | grep -qi "$FONT_NAME"; then
  echo "⚠️ 系統找不到字型「$FONT_NAME」，字幕可能變方框（用 fc-list :lang=zh 查名稱）" >&2
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"
abs() { [[ "$1" = /* ]] && echo "$1" || echo "$OLDPWD/$1"; }
IN="$(abs "$IN")"; BG="$(abs "$BG")"; BGM="$(abs "$BGM")"
[[ -n "$INTRO" ]] && INTRO="$(abs "$INTRO")"
[[ -n "$OUTRO" ]] && OUTRO="$(abs "$OUTRO")"

echo "① 去停頓"
auto-editor "$IN" --margin 0.2sec --no-open -o cut.m4a </dev/null

echo "② 轉字幕（對剪好的檔）"
whisper cut.m4a --model "$WHISPER_MODEL" --language zh \
  --initial_prompt "以下是繁體中文的句子。" --output_format srt --output_dir . </dev/null
read -r -p "請校對 $OUT_DIR/cut.srt（藥名、醫療用語、簡體字）後按 Enter 繼續…"

echo "③ 字卡"
magick -size 1080x1920 xc:none -font "$CARD_FONT" -pointsize 84 \
  -fill white -stroke black -strokewidth 3 -gravity north \
  -annotate +0+260 "$TITLE" card.png

echo "④ 合成本體"
# 背景圖與配樂都是無限循環，-shortest 經過 filter_complex 收不了尾，長度以人聲為準明確指定
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 cut.m4a)"
ffmpeg -nostdin -y -loop 1 -framerate 30 -i "$BG" -i cut.m4a -i card.png -stream_loop -1 -i "$BGM" \
  -filter_complex "
   [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];
   [bg][2:v]overlay=0:0:enable='lt(t,$CARD_SECONDS)'[v1];
   [v1]subtitles=cut.srt:force_style='FontName=$FONT_NAME,FontSize=12,Outline=2,MarginV=40'[v];
   [3:a]volume=$BGM_VOLUME[m];
   [1:a][m]amix=inputs=2:duration=first:normalize=0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -t "$DUR" body.mp4

echo "⑤⑥ 接片頭片尾、輸出"
if [[ -z "$INTRO" && -z "$OUTRO" ]]; then
  ffmpeg -nostdin -y -i body.mp4 -c copy -movflags +faststart final_9x16.mp4
else
  inputs=(); n=0; chain=""
  for f in ${INTRO:+"$INTRO"} body.mp4 ${OUTRO:+"$OUTRO"}; do
    inputs+=(-i "$f"); chain+="[$n:v][$n:a]"; n=$((n + 1))
  done
  ffmpeg -nostdin -y "${inputs[@]}" -filter_complex "${chain}concat=n=$n:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -c:v libx264 -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -movflags +faststart final_9x16.mp4
fi

echo "完成：$OUT_DIR/final_9x16.mp4"
