#!/usr/bin/env bash
# Netlify「是否跳過建置」判斷（由 /netlify.toml 的 [build] ignore 呼叫）
#   exit 0 ＝ 跳過這次建置；exit 1 ＝ 照常建置
#
# 院長 2026-11-10 裁示「加 netlify.toml，內部檔案跳過建置」：
# 只改內部檔案的 commit（00／01 紀錄、skill、工具、workflow）每次推上 main 都會
# 觸發正式站建置、消耗 Netlify credit，網站內容卻零變更。
#
# 規則：本次與上次部署之間改到的檔案，「全部」屬於 _redirects §5 已攔成 404 的路徑
#       （網站本來就不對外提供）→ 跳過；只要有任何一個其他檔案 → 建置。
#       ⚠️ 新增 §5 攔截規則時，同步更新下面的 case 清單（兩邊是同一套範圍）。
# 保守原則：拿不到比對基準（首次部署、手動重新部署同一個 commit、淺層 clone
#           找不到舊 commit、diff 失敗、沒有任何變更）一律建置，不擋人工觸發的部署。
set -u
# 中文檔名：core.quotepath=off 讓 git 輸出原始檔名，否則會加引號並轉成八進位跳脫碼（"internal/00_\345..."），
# 開頭的引號讓 internal/* 比對失敗、內部 commit 被誤判成要建置（2026-11-10 本機測試實際抓到）。
base="${CACHED_COMMIT_REF:-}"
head="${COMMIT_REF:-HEAD}"

if [ -z "$base" ] || [ "$base" = "$head" ]; then
  echo "[netlify-ignore] 沒有可比對的上次部署（或重新部署同一個 commit）→ 建置"; exit 1
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "[netlify-ignore] 找不到上次部署的 commit ${base} → 建置"; exit 1
fi
if ! changed="$(git -c core.quotepath=off diff --name-only "$base" "$head" 2>/dev/null)"; then
  echo "[netlify-ignore] git diff 失敗 → 建置"; exit 1
fi
if [ -z "$changed" ]; then
  echo "[netlify-ignore] 沒有檔案變更 → 建置"; exit 1
fi

while IFS= read -r f; do
  case "$f" in
    internal/*|archive/*|booking-system/*|.claude/*|.codex/*|.github/*|workflow/*) ;;
    CLAUDE.md|AGENTS.md|.mcp.json|mcp.json|README.md|.gitignore|gitignore|_gitignore|_headers_proposed.txt) ;;
    *) echo "[netlify-ignore] 網站檔案有變更：${f} → 建置"; exit 1 ;;
  esac
done <<< "$changed"

echo "[netlify-ignore] 本次只改內部檔案（$(printf '%s\n' "$changed" | wc -l) 檔）→ 跳過建置"
exit 0
