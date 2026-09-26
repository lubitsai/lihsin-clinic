#!/bin/bash
#
# 舊分支清理：先打 archive tag 保存，確認 tag 真的在遠端，才刪除分支。
#
# 清單來源：internal/reports/branch-audit-20260926.md
#   86 支，最後提交早於 2026-09-19；盤點結論是沒有任何分支持有 main 缺少的
#   HTML 頁面，獨有檔案都是刻意刪除的過期公告圖與內部文件舊版。
#
# 為什麼要你在自己的電腦上跑：Claude session 的 GitHub 憑證可以建立／更新 ref，
# 但「建立 tag」與「刪除分支」都被回 HTTP 403（App 權限／組織政策），繞不過去。
#
# 用法（在 repo 目錄下）：
#   bash internal/reports/branch-cleanup-20260926.sh         # dry-run，只印不做
#   RUN=1 bash internal/reports/branch-cleanup-20260926.sh   # 確認無誤後真的執行
#
# 還原任何一支：git branch <名稱> archive/<名稱>
#
set -uo pipefail

RUN="${RUN:-}"
if [ -z "$RUN" ]; then
  echo "=== DRY RUN：只會印出要做什麼，不會改動任何東西（加 RUN=1 才執行）==="
fi

BRANCHES=(
  "agent-check-sitemap-4509"
  "agent-mascotpng-on-the-webpage-2408"
  "agent-add-indexnow-to-a-website-6686"
  "claude/ai-seo-aeo-geo-audit-i1ltt9"
  "claude/document-setup-wz5y3e"
  "claude/flu-vaccine-seo-h7n3f1"
  "claude/homepage-news-section-dvtvjw"
  "claude/meta-descriptions-backlinks-eor2rd"
  "claude/future-execution-plan-40fqau"
  "claude/hpv-vaccine-ai-seo-x0yzwh"
  "claude/shingrix-vaccine-seo-ambrof"
  "claude/legacy-batch-compression-13xl6a"
  "claude/website-health-check-0sht03"
  "claude/website-indexnow-list-vm9b8t"
  "claude/website-seo-aeo-geo-jed8n7"
  "claude/mainpi-clinic-optimization-795k7z"
  "claude/vaccine-articles-medical-xjrax1"
  "claude/clinic-social-media-reels-wi0m35"
  "claude/flu-vaccine-ai-seo-jhbusz"
  "claude/tainan-family-medicine-content-34u2ox"
  "claude/clinic-progress-query-updates-u5nqal"
  "claude/covid-19-article-news-pzu9zj"
  "claude/session-cgpttd"
  "claude/website-ai-seo-aeo-geo-l2w22j"
  "claude/website-clinic-updates-ahp4bf"
  "claude/update-global-claude-md-l73jbn"
  "claude/ai-writing-pattern-detection-wax674"
  "claude/google-reviews-update-225u38"
  "claude/clinic-ai-seo-optimization-kem5vs"
  "claude/clinic-no-show-rules-t9lgmo"
  "claude/clinic-appointment-rules-r9fum1"
  "claude/lisin-clinic-ai-search-vhy2xj"
  "claude/appendix-compress-two-batches-c1zpqm"
  "claude/clinic-services-review-rcyvcr"
  "claude/flu-vaccine-article-ybtbx7"
  "claude/tainan-allergen-test-seo-f5lld8"
  "claude/tainan-shingles-vaccine-seo-i44z10"
  "claude/fathers-day-notification-image-ep328d"
  "claude/lisin-trust-system-v1-tn0h41"
  "claude/pages-not-indexed-fkdjcq"
  "claude/ai-visibility-diagnosis-wqetr9"
  "claude/clinic-registration-times-ky46sa"
  "claude/bexsero-meningitis-vaccine-article-fpslma"
  "claude/doctor-schedule-clinic-hours-update-y76qq8"
  "claude/chatbase-content-consolidation-ghv2l9"
  "claude/seo-ai-search-strategy-h2oc6r"
  "claude/tainan-clinic-seo-aeo-geo-8mrjra"
  "claude/official-website-load-speed-gzpaja"
  "claude/oral-thrush-article-7i9pde"
  "claude/clinic-schedule-announcement-d25v0h"
  "claude/clinic-schedule-announcement-tb0p7a"
  "claude/bedwetting-education-article-9vkydn"
  "claude/pediatric-uti-education-p149j3"
  "claude/new-session-1c0gps"
  "claude/schedule-launch-consistency-check-o5531d"
  "claude/tainan-vaccine-flu-seo-aeo-geo-8zcapz"
  "claude/tainan-vaccine-seo-growth-k9bpst"
  "claude/google-reviews-analysis-5s700i"
  "claude/health-education-missing-images-0frgyl"
  "claude/flu-vaccine-how-to-choose-visible"
  "claude/pediatric-doctor-service-page-l8bo9h"
  "claude/tainan-flu-vaccine-clinic-recommend"
  "claude/tainan-child-ear-cleaning-seo-1fh2i8"
  "claude/tainan-flu-drugs-seo-mf5blz"
  "claude/tainan-flu-vaccine-seo-jbs6cg"
  "claude/atopic-march-education-article-p6ny7s"
  "claude/allergic-rhinitis-education-images-qn7i98"
  "claude/tainan-clinic-seo-aeo-geo-csz1b4"
  "claude/update-website-schedule-831-a2ts2y"
  "claude/adenovirus-health-article-xr5xc2"
  "claude/flu-vaccine-seo-aeo-geo-regqfe"
  "claude/hepatitis-c-education-article-zy2cqi"
  "claude/clinic-website-optimization-possz6"
  "claude/clinic-website-seo-assessment-ytsjfo"
  "claude/elegant-feynman-084ttp"
  "claude/medical-faq-update-dates-ord44x"
  "claude/allergen-detection-page-links-7j7bx9"
  "claude/cold-nutrition-article-8zqzpd"
  "claude/health-education-missing-images-p3xwc8"
  "claude/enterovirus-education-article-im8qyd"
  "claude/tainan-clinic-seo-optimization-raa3mv"
  "claude/child-preventive-care-update-kbn5nx"
  "claude/clinic-schedule-announcement-update-n0t2yf"
  "claude/patient-registration-closure-notice-uqyepf"
  "claude/brave-mccarthy-1um40m"
  "claude/new-session-nvi9i5"
)

# 權限測試時遺留在遠端的分支，一併清掉
STRAY="archive/agent-check-sitemap-4509"

echo "取得遠端最新狀態…"
git fetch origin --prune --quiet || { echo "⛔ fetch 失敗，中止"; exit 1; }

# ── 1) 打 tag ────────────────────────────────────────────
TAGGED=()
MISSING=()
for b in "${BRANCHES[@]}"; do
  if ! sha=$(git rev-parse --verify --quiet "refs/remotes/origin/$b"); then
    MISSING+=("$b"); continue
  fi
  if [ -n "$RUN" ]; then
    git tag -f "archive/$b" "$sha" >/dev/null
  else
    echo "  tag archive/$b -> ${sha:0:8}"
  fi
  TAGGED+=("$b")
done
echo "可處理 ${#TAGGED[@]} 支；遠端已不存在而略過 ${#MISSING[@]} 支"

# ── 2) 推 tag 上遠端（逐一列出 refspec，不用萬用字元）──────
if [ -n "$RUN" ]; then
  echo "推送 tag…"
  batch=()
  for b in "${TAGGED[@]}"; do
    batch+=("refs/tags/archive/$b:refs/tags/archive/$b")
    if [ "${#batch[@]}" -ge 25 ]; then
      git push origin "${batch[@]}" || { echo "⛔ tag 推送失敗，中止（尚未刪除任何分支）"; exit 1; }
      batch=()
    fi
  done
  [ "${#batch[@]}" -gt 0 ] && { git push origin "${batch[@]}" || { echo "⛔ tag 推送失敗，中止"; exit 1; }; }
fi

# ── 3) 逐一確認 tag 真的在遠端，只刪確認過的 ─────────────
CONFIRMED=()
if [ -n "$RUN" ]; then
  echo "核對遠端 tag…"
  remote_tags=$(git ls-remote --tags origin | awk '{print $2}')
  for b in "${TAGGED[@]}"; do
    if grep -qxF "refs/tags/archive/$b" <<< "$remote_tags"; then
      CONFIRMED+=("$b")
    else
      echo "  ⚠ 遠端找不到 archive/$b，這支不刪"
    fi
  done
  echo "已確認 ${#CONFIRMED[@]} / ${#TAGGED[@]} 支有 tag 保護"
  if [ "${#CONFIRMED[@]}" -eq 0 ]; then echo "⛔ 沒有任何 tag 確認成功，中止"; exit 1; fi
else
  CONFIRMED=("${TAGGED[@]}")
fi

# ── 4) 刪除遠端分支 ──────────────────────────────────────
FAILED=()
for b in "${CONFIRMED[@]}"; do
  if [ -n "$RUN" ]; then
    git push origin --delete "$b" --quiet || FAILED+=("$b")
  else
    echo "  delete $b"
  fi
done

# 遺留的測試分支
if git rev-parse --verify --quiet "refs/remotes/origin/$STRAY" >/dev/null; then
  if [ -n "$RUN" ]; then
    git push origin --delete "$STRAY" --quiet || FAILED+=("$STRAY")
  else
    echo "  delete $STRAY（權限測試遺留）"
  fi
fi

echo
if [ -n "$RUN" ]; then
  echo "完成：刪除 $(( ${#CONFIRMED[@]} - ${#FAILED[@]} )) 支，失敗 ${#FAILED[@]} 支"
  [ "${#FAILED[@]}" -gt 0 ] && printf '  失敗：%s\n' "${FAILED[@]}"
  echo "要還原任何一支：git branch <名稱> archive/<名稱>"
else
  echo "以上為 dry-run。確認無誤後執行：RUN=1 bash $0"
fi
