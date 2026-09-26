# 舊分支盤點（2026-09-26）

判準：分支與 main **沒有共同祖先**（main 的歷史被重新 root 過，只剩 318 個 commit），
因此「領先 N 個 commit」是假訊號，完全不能用來判斷。改以**內容**比對：
這個分支有沒有 main 沒有的檔案。

## 關鍵結論

- **沒有任何分支持有 main 缺少的 HTML 頁面**——沒有頁面內容擱淺在分支上。
- 全部 105 個分支加起來，只存在於分支的檔案共 50 個，其中：
  - 18 個是 `images/notice/` 過期公告圖（依 SOP 下架時刻意刪除，院長 2026-08-25 入制）
  - 2 個是 `booking-system/src/app/my/identity-login.tsx`、`src/lib/sms/index.ts`（院長 2026-08-13 裁示取消簡訊時刪除）
  - 20 個是 `internal/` 內部文件舊版
  - 其餘為孤兒資產（見下方「唯一值得看一眼的東西」）

## 唯一值得看一眼的東西

| 檔案 | 只在哪個分支 | 判斷 |
|---|---|---|
| `netlify.toml`、`package.json`、`netlify/functions/deploy-succeeded-background.mts` | `agent-add-indexnow-to-a-website-6686`（2026-05-25） | 早期 IndexNow 自動化實驗，未採用；靜態站現在不靠這些也正常部署 |
| `images/covid-19-2026-thumb.jpg/.webp` | 多個舊分支 | main 沒有 covid 文章、全站零引用，孤兒縮圖 |

## ⛔ 2026-09-26 執行受阻：Claude session 的 GitHub 憑證刪不了分支

院長核可「打 tag 後刪除 86 個」後實際執行，卡在權限：

| 動作 | 結果 |
|---|---|
| 建立／更新分支 ref | ✅ 可以 |
| **建立 tag** | ❌ HTTP 403 |
| **刪除分支** | ❌ HTTP 403 |

代理本身健康（`recentRelayFailures: []`），是 GitHub App 權限／組織政策擋下，
GitHub MCP 也沒有刪除分支的工具，繞不過去。

**因此本批只產出清單與腳本，未刪除任何分支。** 兩條路擇一：

1. 到 <https://claude.ai/connect-github> 補上 tag 與分支刪除權限後，由我重跑；
2. 院長在自己的電腦上跑 `internal/reports/branch-cleanup-20260926.sh`
   （先不帶參數看 dry-run，確認無誤再 `RUN=1`）。**院長 2026-09-26 選擇此路。**

   腳本的安全設計：
   - 86 支分支名稱**逐一寫死在腳本裡**，不靠萬用字元比對，也不重新計算清單
   - 推 tag 的 refspec 逐一列出（`archive/claude/foo` 的 `*` 會跨斜線，不用萬用字元）
   - 推完後**逐一比對遠端 ref 名稱**確認 tag 真的在，只刪確認過的那些；
     一支都沒確認成功就中止，推 tag 失敗也中止且不刪任何分支
   - 遠端已不存在的分支自動略過，不會讓整批失敗
   - 順帶刪掉權限測試遺留的 `archive/agent-check-sitemap-4509`
   - 預設 dry-run；已驗證 `bash -n` 通過、dry-run 列出 87 筆（86＋遺留那支）

> ⚠️ 執行權限測試時，我在遠端留下一支 `archive/agent-check-sitemap-4509`，
> 刪除同樣被 403 擋住、我清不掉。**清理腳本已包含這一支**，跑完即一併移除。

## 建議保留（近 7 天仍有動靜，可能是進行中的 session）

- 2026-09-19 ｜ claude/upbeat-galileo-53ltbc
- 2026-09-21 ｜ claude/flu-vaccine-tainan-seo-r57889
- 2026-09-22 ｜ claude/liching-clinic-flu-vaccine-seo-8pbjsa
- 2026-09-22 ｜ claude/new-session-gvvz0o
- 2026-09-22 ｜ claude/tainan-flu-vaccine-seo-28sl70
- 2026-09-22 ｜ claude/vaccine-fridge-temp-monitoring-m0y5pe
- 2026-09-24 ｜ claude/ai-customer-service-db-w4l5sz
- 2026-09-24 ｜ claude/determined-carson-yiqw40
- 2026-09-24 ｜ claude/elegant-goodall-a62t01
- 2026-09-24 ｜ claude/rsv-vaccine-seo-optimization-at4i2n
- 2026-09-25 ｜ claude/exciting-einstein-rs31ux
- 2026-09-25 ｜ claude/flu-vaccine-site-cleanup-7iwum6
- 2026-09-25 ｜ claude/gsc-core-query-tracking-ch33qc
- 2026-09-25 ｜ claude/tainan-vaccine-seo-strategy-eqpbiq
- 2026-09-26 ｜ claude/clinic-announcement-pinned-o8nlr2
- 2026-09-26 ｜ claude/clinic-appointment-rules-3up5dr
- 2026-09-26 ｜ claude/flu-vaccine-operations-79rywh
- 2026-09-26 ｜ claude/li-hsin-clinic-booking-9q4z69
- 2026-09-26 ｜ claude/upbeat-wozniak-0gys0b

## 可安全刪除（86 個，最後提交早於 2026-09-19）

| 最後提交 | 分支 |
|---|---|
| 2026-04-30 | `agent-check-sitemap-4509` |
| 2026-04-30 | `agent-mascotpng-on-the-webpage-2408` |
| 2026-05-25 | `agent-add-indexnow-to-a-website-6686` |
| 2026-07-10 | `claude/ai-seo-aeo-geo-audit-i1ltt9` |
| 2026-07-11 | `claude/document-setup-wz5y3e` |
| 2026-07-11 | `claude/flu-vaccine-seo-h7n3f1` |
| 2026-07-11 | `claude/homepage-news-section-dvtvjw` |
| 2026-07-11 | `claude/meta-descriptions-backlinks-eor2rd` |
| 2026-07-12 | `claude/future-execution-plan-40fqau` |
| 2026-07-12 | `claude/hpv-vaccine-ai-seo-x0yzwh` |
| 2026-07-12 | `claude/shingrix-vaccine-seo-ambrof` |
| 2026-07-13 | `claude/legacy-batch-compression-13xl6a` |
| 2026-07-13 | `claude/website-health-check-0sht03` |
| 2026-07-13 | `claude/website-indexnow-list-vm9b8t` |
| 2026-07-13 | `claude/website-seo-aeo-geo-jed8n7` |
| 2026-07-16 | `claude/mainpi-clinic-optimization-795k7z` |
| 2026-07-16 | `claude/vaccine-articles-medical-xjrax1` |
| 2026-07-18 | `claude/clinic-social-media-reels-wi0m35` |
| 2026-07-20 | `claude/flu-vaccine-ai-seo-jhbusz` |
| 2026-07-22 | `claude/tainan-family-medicine-content-34u2ox` |
| 2026-07-23 | `claude/clinic-progress-query-updates-u5nqal` |
| 2026-07-23 | `claude/covid-19-article-news-pzu9zj` |
| 2026-07-23 | `claude/session-cgpttd` |
| 2026-07-23 | `claude/website-ai-seo-aeo-geo-l2w22j` |
| 2026-07-23 | `claude/website-clinic-updates-ahp4bf` |
| 2026-07-25 | `claude/update-global-claude-md-l73jbn` |
| 2026-07-28 | `claude/ai-writing-pattern-detection-wax674` |
| 2026-07-28 | `claude/google-reviews-update-225u38` |
| 2026-07-29 | `claude/clinic-ai-seo-optimization-kem5vs` |
| 2026-07-30 | `claude/clinic-no-show-rules-t9lgmo` |
| 2026-07-31 | `claude/clinic-appointment-rules-r9fum1` |
| 2026-08-05 | `claude/lisin-clinic-ai-search-vhy2xj` |
| 2026-08-07 | `claude/appendix-compress-two-batches-c1zpqm` |
| 2026-08-07 | `claude/clinic-services-review-rcyvcr` |
| 2026-08-07 | `claude/flu-vaccine-article-ybtbx7` |
| 2026-08-07 | `claude/tainan-allergen-test-seo-f5lld8` |
| 2026-08-07 | `claude/tainan-shingles-vaccine-seo-i44z10` |
| 2026-08-08 | `claude/fathers-day-notification-image-ep328d` |
| 2026-08-08 | `claude/lisin-trust-system-v1-tn0h41` |
| 2026-08-08 | `claude/pages-not-indexed-fkdjcq` |
| 2026-08-09 | `claude/ai-visibility-diagnosis-wqetr9` |
| 2026-08-09 | `claude/clinic-registration-times-ky46sa` |
| 2026-08-12 | `claude/bexsero-meningitis-vaccine-article-fpslma` |
| 2026-08-12 | `claude/doctor-schedule-clinic-hours-update-y76qq8` |
| 2026-08-13 | `claude/chatbase-content-consolidation-ghv2l9` |
| 2026-08-14 | `claude/seo-ai-search-strategy-h2oc6r` |
| 2026-08-14 | `claude/tainan-clinic-seo-aeo-geo-8mrjra` |
| 2026-08-20 | `claude/official-website-load-speed-gzpaja` |
| 2026-08-22 | `claude/oral-thrush-article-7i9pde` |
| 2026-08-23 | `claude/clinic-schedule-announcement-d25v0h` |
| 2026-08-23 | `claude/clinic-schedule-announcement-tb0p7a` |
| 2026-08-24 | `claude/bedwetting-education-article-9vkydn` |
| 2026-08-24 | `claude/pediatric-uti-education-p149j3` |
| 2026-08-25 | `claude/new-session-1c0gps` |
| 2026-08-25 | `claude/schedule-launch-consistency-check-o5531d` |
| 2026-08-25 | `claude/tainan-vaccine-flu-seo-aeo-geo-8zcapz` |
| 2026-08-25 | `claude/tainan-vaccine-seo-growth-k9bpst` |
| 2026-08-26 | `claude/google-reviews-analysis-5s700i` |
| 2026-08-26 | `claude/health-education-missing-images-0frgyl` |
| 2026-08-28 | `claude/flu-vaccine-how-to-choose-visible` |
| 2026-08-28 | `claude/pediatric-doctor-service-page-l8bo9h` |
| 2026-08-28 | `claude/tainan-flu-vaccine-clinic-recommend` |
| 2026-08-29 | `claude/tainan-child-ear-cleaning-seo-1fh2i8` |
| 2026-08-29 | `claude/tainan-flu-drugs-seo-mf5blz` |
| 2026-08-29 | `claude/tainan-flu-vaccine-seo-jbs6cg` |
| 2026-08-31 | `claude/atopic-march-education-article-p6ny7s` |
| 2026-09-01 | `claude/allergic-rhinitis-education-images-qn7i98` |
| 2026-09-01 | `claude/tainan-clinic-seo-aeo-geo-csz1b4` |
| 2026-09-01 | `claude/update-website-schedule-831-a2ts2y` |
| 2026-09-02 | `claude/adenovirus-health-article-xr5xc2` |
| 2026-09-03 | `claude/flu-vaccine-seo-aeo-geo-regqfe` |
| 2026-09-03 | `claude/hepatitis-c-education-article-zy2cqi` |
| 2026-09-05 | `claude/clinic-website-optimization-possz6` |
| 2026-09-08 | `claude/clinic-website-seo-assessment-ytsjfo` |
| 2026-09-09 | `claude/elegant-feynman-084ttp` |
| 2026-09-10 | `claude/medical-faq-update-dates-ord44x` |
| 2026-09-12 | `claude/allergen-detection-page-links-7j7bx9` |
| 2026-09-12 | `claude/cold-nutrition-article-8zqzpd` |
| 2026-09-12 | `claude/health-education-missing-images-p3xwc8` |
| 2026-09-13 | `claude/enterovirus-education-article-im8qyd` |
| 2026-09-13 | `claude/tainan-clinic-seo-optimization-raa3mv` |
| 2026-09-14 | `claude/child-preventive-care-update-kbn5nx` |
| 2026-09-14 | `claude/clinic-schedule-announcement-update-n0t2yf` |
| 2026-09-14 | `claude/patient-registration-closure-notice-uqyepf` |
| 2026-09-16 | `claude/brave-mccarthy-1um40m` |
| 2026-09-17 | `claude/new-session-nvi9i5` |
