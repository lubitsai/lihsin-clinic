#!/bin/bash
# 舊分支清理：先打 archive tag 保存，再刪除遠端分支
# 清單來源：internal/reports/branch-audit-20260926.md（86 個，最後提交早於 2026-09-19）
#
# 為什麼要院長在自己的電腦上跑：Claude session 的 GitHub 憑證可以建立/更新 ref，
# 但「建立 tag」與「刪除分支」都被回 403（組織政策/App 權限），繞不過去。
#
# 用法：在 repo 目錄下執行
#   bash internal/reports/branch-cleanup-20260926.sh          # 先看會做什麼（預設 dry-run）
#   RUN=1 bash internal/reports/branch-cleanup-20260926.sh    # 真的執行
set -euo pipefail
DRY=${RUN:+}; [ -z "${RUN:-}" ] && echo "=== DRY RUN（加 RUN=1 才會真的執行）===" || true
git fetch origin --prune

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

# 1) 先打 tag（保存物件，之後永遠救得回來）
for b in "${BRANCHES[@]}"; do
  sha=$(git rev-parse "origin/$b" 2>/dev/null) || { echo "跳過（遠端已無此分支）：$b"; continue; }
  if [ -n "${RUN:-}" ]; then git tag -f "archive/$b" "$sha"; else echo "tag archive/$b -> ${sha:0:8}"; fi
done
[ -n "${RUN:-}" ] && git push origin "refs/tags/archive/*:refs/tags/archive/*"

# 2) 確認 tag 真的在遠端，再刪分支——順序不能顛倒
if [ -n "${RUN:-}" ]; then
  n=$(git ls-remote --tags origin 'archive/*' | wc -l)
  echo "遠端 archive tag 數：$n"
  [ "$n" -ge "${#BRANCHES[@]}" ] || { echo "⛔ tag 數不足，中止刪除"; exit 1; }
fi

# 3) 刪除遠端分支（分批，避免一次太多被斷線）
for b in "${BRANCHES[@]}"; do
  if [ -n "${RUN:-}" ]; then git push origin --delete "$b" || echo "刪除失敗：$b"; else echo "delete $b"; fi
done
echo "完成。要還原任何一支：git branch <名稱> archive/<名稱>"
