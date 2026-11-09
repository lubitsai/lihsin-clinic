#!/usr/bin/env bash
# 立欣診所 LINE 客服：Cloud Shell 一鍵部署到「現有的」Cloud Run 函式服務（不改 Webhook 網址）。
# 用法（在解壓後的 line-helpdesk 資料夾內）：
#   bash deploy_cloudrun.sh <服務名稱> <區域> [--mode pilot|live|off] [--dry-run]
# 例：bash deploy_cloudrun.sh linebot asia-east1
#     bash deploy_cloudrun.sh linebot asia-east1 --mode live
# 先跑 --dry-run 只看會做什麼；所有「會改東西」的步驟執行前都會再問一次。
# 本腳本不含、也不會存任何 Token：Token／Secret 只在 Secret Manager 建立時隱藏輸入一次。
set -euo pipefail

SERVICE="${1:-}"; REGION="${2:-}"
[ -n "$SERVICE" ] && [ -n "$REGION" ] || { sed -n '2,8p' "$0"; exit 2; }
shift 2
MODE=pilot; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "不認得的參數：$1"; exit 2 ;;
  esac
done
case "$MODE" in pilot|live|off) ;; *) echo "--mode 只能是 pilot、live 或 off"; exit 2 ;; esac

DB='(default)'
PREFIX="${FIRESTORE_PREFIX:-lh_helpdesk_}"
SECRET_TOKEN=lh-line-channel-access-token
SECRET_SECRET=lh-line-channel-secret
FILES=(main.py core.py faq.json legacy_messages.json requirements.txt)
cd "$(dirname "$0")"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
ask()  { [ "$DRY" = 1 ] && { echo "  （試跑：略過「$1」）"; return 1; }; read -r -p "  $1 輸入 y 繼續：" a; [ "$a" = y ]; }
run()  { echo "  \$ $*"; [ "$DRY" = 1 ] || "$@"; }

say "0. 檢查程式包"
for f in "${FILES[@]}"; do [ -f "$f" ] || { echo "  ✗ 缺少 $f，請在解壓後的 line-helpdesk 資料夾內執行"; exit 1; }; done
python3 -c "import json; d=json.load(open('faq.json', encoding='utf-8')); assert d['items'] and d['replies']" \
  || { echo "  ✗ faq.json 格式錯誤"; exit 1; }
ok "五個必要檔案齊全：${FILES[*]}"
ok "版本：$(head -1 README_設定步驟.md 2>/dev/null | sed 's/^# //')"
ok "模式：BOT_MODE=$MODE$([ "$DRY" = 1 ] && echo '（試跑，不會改任何東西）')"

say "1. 確認專案與現有服務"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT" ] || { echo "  ✗ 尚未選專案：gcloud config set project <專案ID>"; exit 1; }
ok "專案：$PROJECT"
DESC="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json)" \
  || { echo "  ✗ 找不到服務 $SERVICE（$REGION）。用 gcloud run services list 查名稱與區域"; exit 1; }
read -r CUR_REV SA URL ENVNAMES < <(python3 -c '
import json, sys
d = json.load(sys.stdin)
spec = d["spec"]["template"]["spec"]
env = spec["containers"][0].get("env", [])
names = ",".join(e["name"] + (":secret" if "valueFrom" in e else ":plain") for e in env) or "-"
live = [t["revisionName"] for t in d["status"].get("traffic", []) if t.get("percent") == 100 and t.get("revisionName")]
print(live[0] if live else d["status"].get("latestReadyRevisionName", "-"), spec.get("serviceAccountName") or "-",
      d["status"].get("url", "-"), names)' <<<"$DESC")
if [ "$SA" = "-" ]; then
  SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi
ok "目前上線版本：$CUR_REV"
ok "服務帳戶：$SA"
ok "Webhook 網址（不會改變）：$URL"
ROLLBACK="gcloud run services update-traffic $SERVICE --region $REGION --to-revisions=$CUR_REV=100"
echo "$ROLLBACK" > rollback_command.txt
ok "回退指令已存成 rollback_command.txt：$ROLLBACK"
has_env() { [[ ",$ENVNAMES," == *",$1:$2,"* ]]; }
if [[ ",$ENVNAMES," == *",OA_PASSTHROUGH_KEYWORDS:"* ]]; then
  warn "服務上手動設過 OA_PASSTHROUGH_KEYWORDS：請到 Cloud Run 確認裡面沒有「最新門診異動」（2.37 起由程式回答）"
fi

say "2. Firestore（轉專人案件清單用；已設定過會自動略過）"
if gcloud firestore databases describe --database="$DB" --format='value(name)' >/dev/null 2>&1; then
  ok "Firestore 資料庫已存在"
else
  warn "尚無 Firestore 資料庫"
  if ask "要在 asia-east1（台灣）建立 Native mode 資料庫嗎？建立後區域不能改。"; then
    run gcloud firestore databases create --database="$DB" --location=asia-east1 --type=firestore-native
  else
    echo "  未建立。新程式需要 Firestore，請先建立再部署。"; [ "$DRY" = 1 ] || exit 1
  fi
fi
if ask "授予服務帳戶 Firestore 讀寫權限（roles/datastore.user，只給這個帳戶）？"; then
  run gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
      --role=roles/datastore.user --condition=None --format=none
fi
if ask "為 ${PREFIX}events 的 expires_at 開啟 TTL（自動清七天以上事件記錄；不影響案件）？"; then
  run gcloud firestore fields ttls update expires_at --collection-group="${PREFIX}events" \
      --enable-ttl --database="$DB" --async
fi

say "3. LINE Token／Secret"
SECRET_FLAG=""
if has_env LINE_CHANNEL_ACCESS_TOKEN plain || has_env LINE_CHANNEL_SECRET plain; then
  warn "服務上已有明碼環境變數 LINE_CHANNEL_*，沿用現值、不改成 Secret Manager"
elif has_env LINE_CHANNEL_ACCESS_TOKEN secret && has_env LINE_CHANNEL_SECRET secret; then
  ok "已用 Secret Manager 掛入，沿用"
else
  echo "  舊程式把 Token 寫在程式碼裡；新程式改從 Secret Manager 讀（不出現在程式碼與畫面上）。"
  for pair in "$SECRET_TOKEN:Channel access token（長效）" "$SECRET_SECRET:Channel secret"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if gcloud secrets describe "$name" --format='value(name)' >/dev/null 2>&1; then
      ok "Secret $name 已存在"
    elif [ "$DRY" = 1 ]; then
      echo "  （試跑：會請您隱藏輸入 $label，建立 Secret $name）"
    else
      read -r -s -p "  請貼上 $label（輸入不會顯示），按 Enter：" v; echo
      [ -n "$v" ] || { echo "  ✗ 不可空白"; exit 1; }
      printf '%s' "$v" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic --format=none
      unset v; ok "已建立 Secret $name"
    fi
    run gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$SA" \
        --role=roles/secretmanager.secretAccessor --condition=None --format=none
  done
  SECRET_FLAG="LINE_CHANNEL_ACCESS_TOKEN=$SECRET_TOKEN:latest,LINE_CHANNEL_SECRET=$SECRET_SECRET:latest"
fi

say "4. 部署新版本（函式入口 linebot、Python 3.12；只上傳五個必要檔案）"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp "${FILES[@]}" "$STAGE"/
# 程式指紋寫進服務標籤 lh_code：Cloud Build 題庫自動部署（cloudbuild.yaml）靠它判斷「程式沒改、只換題庫」
CODE_HASH="$(cat main.py core.py requirements.txt | sha256sum | cut -c1-40)"
ARGS=(run deploy "$SERVICE" --source "$STAGE" --function linebot --base-image python312
      --region "$REGION" --update-env-vars "BOT_MODE=$MODE" --update-labels "lh_code=$CODE_HASH")
[ -n "$SECRET_FLAG" ] && ARGS+=(--update-secrets "$SECRET_FLAG")
if [ "$MODE" = live ]; then
  warn "live＝所有民眾立即使用新問答。請確認 pilot 實測（部署操作步驟 第四步）已全部通過。"
fi
if ask "部署 $SERVICE（BOT_MODE=$MODE）？"; then
  run gcloud "${ARGS[@]}"
  say "完成"
  ok "Webhook 網址不變：$URL"
  ok "接著照《部署操作步驟》第三、四步：LINE 後台設定與實測"
  ok "出問題時回退：bash -c \"\$(cat rollback_command.txt)\"（或 Cloud Run → 修訂版本 → 管理流量）"
else
  echo "  未部署。實際會執行（--source 為只放五個必要檔案的暫存資料夾）："; echo "  \$ gcloud ${ARGS[*]}"
fi
