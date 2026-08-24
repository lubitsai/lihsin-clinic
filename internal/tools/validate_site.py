#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_site.py — 立欣診所全站驗證器 v1.1（2026-08-02b；v1.0＝2026-07-07）
    v1.0.1（07-10）：W-SITEMAP 首頁 loc「/」對映修正（院長核可待決⑨），無其他變更。
    v1.1（08-02b，院長核可 P5）：新增 **W-HSELF／W-HFORBID＝隱藏 #ai-knowledge-block
      禁語掃描**＋`HIDDEN_EXTRA_ALLOWLIST`／`HIDDEN_SELF_PROMO_PATTERNS` 兩張表。
      補的是 v1.0 起就存在的治理死角：可見禁語掃描依歷批協議**刻意排除**該區
      → 促銷語「合規閘門看不到、爬蟲看得到」。08-02b 稽核在該區抓到 60 次禁語命中、
      **23 頁**自稱式促銷句（8 頁由 P4-b 清除、**15 頁由本檢查首跑當場查獲**——
      那 15 頁不含「推薦」二字，用關鍵詞掃描永遠掃不到，只有比對句型才抓得出來）。
=========================================================
把《00_專案總覽索引.md》第四節合規規則與歷批驗證協議「程式化」。
任何未來 session（Claude Opus/Sonnet、GPT/Codex 系）在交付或部署前必跑本工具，
不得以散文自述取代腳本結果。

設計原則
--------
1. 純 Python 標準庫（無 bs4/lxml 依賴）→ 任何 AI 執行環境皆可直接跑。
2. 兩級嚴重度：
   - ERROR：硬性違規（部署前必須清零；exit code = 1）。
   - WARN ：需人工／AI 判讀（逐條檢視後決定修正或記錄為已知例外）。
3. 白名單即合規紀錄：VISIBLE_ALLOWLIST 的每一條都對應院長歷批核可措辭。
   ★ 修改 FORBIDDEN_TERMS / VISIBLE_ALLOWLIST 視同修改 00 第四節 → 需院長逐字核可。
4. 偵測歸機器、判斷歸規則文件（00 第四節、02 決策手冊）。本工具只回報，不自動修檔。

使用方式
--------
  python3 tools/validate_site.py --root <站點根目錄> [--stage deploy|pre-patch] [--partial]

  --stage deploy    （預設）驗證「可上線」的完整樹：強制 PWA 掛載檢查。
  --stage pre-patch  驗證接續包 site/ 原始檔（patch_pwa.py 之前）：跳過 PWA 檢查。
  --partial          樹不完整時（如只有根目錄檔）：跳過 sitemap 檔案存在性、
                     sitemap 反向覆蓋、站內連結解析三項需要全樹的檢查。

檢查項 ↔ 規則對照（可追溯性）
------------------------------
  E-DOCTYPE   HTML 檔首為 <!DOCTYPE html>                    ｜歷批驗證協議
  E-H1        H1 唯一                                        ｜歷批驗證協議
  E-CANON     canonical 存在、https、非 www                   ｜歷批驗證協議
  E-JSONLD    所有 ld+json 區塊 json.loads 通過               ｜00 §4-8
  E-TAGBAL    結構性標籤開閉平衡                              ｜00 §4-8
  E-FORBID    可見區禁語掃描（剝除 head/script/隱藏層）        ｜00 §4-1（白名單=歷批核可）
  E-AGGRT     全檔禁出現 aggregateRating                      ｜00 §4-3
  E-DATEFMT   dateModified/lastReviewed 完整 ISO8601+08:00    ｜00 §4-9（07-06 規範化）
  E-PWA       manifest link＋pwa-register.js＋theme-color      ｜00 部署疊加關係（stage=deploy）
  E-NOIDXMAP  noindex 頁不得列入 sitemap                       ｜歷批慣例（privacy/offline）
  E-LINK      站內絕對連結必須可解析（--partial 時跳過）        ｜07-06 稽核「內連零斷鏈」
  W-DESCLEN   description ≤ 80 字                             ｜07-06 批①政策
  W-OGSYNC    og:description 應與 description 同步（growth 例外）｜07-06 批①政策
  W-TWCARD    twitter:card 應為 summary_large_image            ｜07-06 批③政策
  W-LANG      html lang 應為 zh-Hant-TW                        ｜07-06 批③政策
  W-TWIND     Tailwind purge 偵測：頁面用到但 /tailwind.css 與
              頁內 <style> 皆未定義的 class                     ｜07-02 教訓（append 防線）
  W-SITEMAP   sitemap 反向覆蓋：可索引頁未列入（app.html 型回退）｜07-06 回退攔截
  W-LLMS      llms 雙檔關鍵條目在場（app/visit-guide/growth）    ｜07-06 回退攔截
  W-ROBOTS    robots.txt AI 爬蟲放行組在場                      ｜07-06 批③
  W-FAVICON   根目錄 favicon.ico 在場                          ｜07-06 批④
  W-HSELF     隱藏區出現自稱式促銷句型（不受任何 allowlist 豁免）｜08-02b 裁示 P4-b
  W-HFORBID   隱藏 #ai-knowledge-block 禁語掃描                 ｜08-02b P5（白名單=逐條複核）
  W-CITEDOC   醫療頁 citation 應為「文件層級」書目（有 publisher
              且非機構首頁），不得退化回「機構名＋首頁」        ｜08-03 回退攔截
  W-BCRUMB    可見麵包屑末項必須是該頁自己講過的詞（出現在 title／
              H1／BreadcrumbList 任一）                          ｜08-24b scaffold 抽段回退攔截

已知設計取捨（弱模型請勿「修正」這些行為）
------------------------------------------
- 禁語掃描只掃「文字節點」：keywords meta、alt、head 內容依四層架構本來就允許
  promotional 用語，不在掃描範圍（與歷批 BeautifulSoup 協議一致）。
- **E-FORBID 與 W-HFORBID 是兩套、掃兩個互斥區域，勿合併**：E-FORBID 掃可見層
  （剝除隱藏區）＝ERROR；W-HFORBID 只掃隱藏 #ai-knowledge-block＝WARN。
  隱藏區定為 WARN 是院長 08-02b 裁示：該區含大量醫療術語（`第一線`用藥、`第一劑`、
  `權威來源：疾管署`），設 ERROR 會誤殺並逼出「為消音而放寬偵測」的壞誘因。
  **WARN 不等於可以忽略**——同 W-TWIND 協議，每批逐條判讀寫進交付說明。
- **W-HFORBID 命中後一律用四分法判讀，不可全域取代**：自稱→改中性句型；
  醫療術語／權威引用／結構描述→提案加入 HIDDEN_EXTRA_ALLOWLIST（需院長核可）。
  08-02b 實測 60 次命中中只有 8 頁該改，其餘改了會**破壞醫療正確性**。
- **W-HSELF 為何要獨立於禁語清單**：08-02b 首跑查獲的 15 頁自稱句**完全不含**
  「推薦」等任何禁語（如「在找台南糖尿病門診的民眾，可以考慮立欣診所」）
  → 純關鍵詞掃描永遠掃不到。**問題型態是句型，不是詞**，故另立句型比對且不受豁免。
- W-TWIND 會有少量誤報（純 JS 掛鉤 class、schema 掛鉤 class）→ 收進 TAILWIND_IGNORE
  並附註來源，不要為了消音而放寬偵測邏輯。
- **W-BCRUMB 為什麼比對的是「有沒有講過」而不是「跟 schema 相不相等」**：站內慣例是
  可見麵包屑用**短標**、BreadcrumbList 用**完整敘述名**（「流感疫苗」vs
  「流感疫苗（公費與自費）」），全等比對會在 21 個正常頁誤報。改判「可見末項（去空白後）
  是否出現在 title＋H1＋BreadcrumbList 的合併字串中」，2026-08-24b 全樹實測**誤報 0**。
  抓的是 08-24b 的真實病灶：新頁由既有頁 scaffold 逐段抽取時，**可見麵包屑跟著被複製**，
  schema 改對了、DOM 沒改 → 一頁講尿床、麵包屑寫「兒童泌尿道感染」。設 WARN 而非 ERROR，
  是保留「同義短標」的正當空間，避免逼出為消音而放寬偵測的壞誘因。
- 本工具對「datePublished/datePosted 純日期 30 處」刻意不檢查：00 §4-9 記載該項
  待院長決定，未裁示前不得自行規範化。
"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

SITE_ORIGIN = "https://lhpedclinic.com.tw"

# ============================================================================
# 合規設定區 ★ 修改本區 = 修改 00 第四節 → 需院長逐字核可，並在 00 記錄批次
# ============================================================================

# 00 §4-1 可見區自稱禁語 + 06-25 稀缺語清零批（頂尖/唯一/少數）
FORBIDDEN_TERMS = ["推薦", "最佳", "第一", "首選", "權威", "資深", "頂尖", "唯一", "少數"]

# 白名單：出現在禁語 ±40 字脈絡（去空白後）中即豁免。每條附核可來源。
# 原則：只收「院長已核可的具體措辭」的精確片段（2026-07-07 由實際部署內容逐字抽出），
#       不收單獨裸詞。全樹首跑（services/health/team）預期出現新的待核 ERROR：
#       逐條比對 00 歷批核可紀錄後，提案院長核可再入本名單。
VISIBLE_ALLOWLIST = [
    # --- 00 §4-1 衛教成效語＋醫學事實（07-06 驗證註記逐字明列） ---
    "達最佳保養效果",
    "唯一的表現就是",      # 「有些孩子唯一的表現就是『久咳』」醫學事實（短錨避開內文引號）
    "少數寶寶",            # 「少數寶寶會出現暫時性乳糖不耐」醫學事實（06-25 保留包容型表述）
    "最常見",              # 「最常見疾病之一」等醫學事實（防未來擴詞誤殺；非「最佳」）
    # --- 通用時序／序數／比喻用語（非自稱超級詞；00 §4-1 禁的是自稱式，這些本不在禁列） ---
    "第一次",              # 首次就診、第一次健檢
    "第一步",              # 「健康成長的第一步」
    "第一線",              # 「第一線治療」
    "第一代",              # 「第一代抗組織胺」
    "第一時間",            # 「第一時間就醫」
    "第一、兩次",          # 「嬰兒第一、兩次喘鳴不等於氣喘」（＝一兩次，序數）
    "第一週",              # 「哺餵不足型（第一週）」（序數）
    "第一哩路",            # 「陪新手爸媽走過第一哩路」（比喻）
    # --- 07-02 院長核准 (A)：問句框架推薦（首頁表面化區，逐字抽出） ---
    "衛教資訊，非醫療推薦",
    "台南小兒科推薦：2026年家長如何選擇",
    "家長常搜尋「台南小兒科推薦」",
    "「台南兒童看診推薦」），建議家長",
    "小兒科推薦清單應具備哪些條件",
    "「台南兒童診所推薦」等搜尋",
    "台南過敏推薦：如何挑選",
    "「台南過敏門診推薦」是家長",
    "診所推薦怎麼選家長常搜尋",
    "氣喘診所推薦」「台南兒童氣喘評估",
    "台南耳鼻喉推薦）家長常搜尋",
    "「台南耳鼻喉推薦」。立欣診所為健保特約",
    "台南腸胃炎推薦：大人小孩",
    "台南腸胃炎推薦就診重點",
    # --- 2026-08-16 院長核可：小鹿醫師 3D 看診趣（/game/）遊戲結算獎勵語 ---
    #     「小鹿醫師最佳助手」＝遊戲對完成六關的小朋友的稱讚詞，主詞是孩子、
    #     不是診所或醫師自稱，不構成 00 §4-1 的自稱式超級詞。院長 2026-08-16
    #     裁示「加白名單、原文不動」。僅限 game/ 遊戲頁脈絡使用。
    "小鹿醫師最佳助手",
]

# ---------------------------------------------------------------------------
# 隱藏 #ai-knowledge-block 禁語掃描（W-HFORBID / W-HSELF）
#   2026-08-02b 新增（P5，院長核可）。要解決的問題：
#   VisibleTextExtractor 依歷批協議「刻意排除」#ai-knowledge-block 與 aria-hidden
#   子樹 → 該區的促銷語**合規閘門看不到、而爬蟲看得到**。08-02b 稽核在該區抓到
#   60 次禁語命中、其中 8 頁為自稱式促銷（已於同批 P4-b 清除）。本檢查是防止復發的閘門。
#   ★ 定性為 WARN 而非 ERROR（院長裁示）：該區含大量醫療術語，硬性擋死會誤殺；
#     WARN 要求每批逐條判讀寫進交付說明（同 W-TWIND 協議），不得消音。
# ---------------------------------------------------------------------------

# 隱藏區專用豁免（沿用 VISIBLE_ALLOWLIST 後仍需補的條目）。
# 每條均為 2026-08-02b 實測殘餘 23 例逐條複核後認定「不可改」者，附類別與理由。
HIDDEN_EXTRA_ALLOWLIST = [
    # --- 醫療術語：改了會破壞醫療正確性（08-02b 逐條複核）---
    "第一劑",              # EV71／疫苗劑次：「接種第一劑（基礎劑）時未滿 2 歲」
    "第一線",              # 「孟魯司特…並非第一線」「常見的第一線口服藥」（VISIBLE 已有，此處備援）
    "第一代",              # 「第一代抗組織胺（兒童應避免）」
    "第一次",              # 「寶寶第一次看兒科」「孩子第一次打要幾劑」
    # --- 權威來源引用：引用外部機構，非自稱（00 §4-1 禁的是自稱式）---
    "權威來源",            # 「權威來源：衛生福利部疾病管制署」（measles）
    "權威建議",            # 「權威建議：世界衛生組織（WHO）、美國 ACIP」（shingles-vaccine）
    # --- 臨床與站內結構描述 ---
    "唯一的表現就是",      # 咳嗽變異型氣喘臨床事實（VISIBLE 已有，此處備援）
    "唯一主頁",            # 「本站假日與夜間門診主題的唯一主頁」＝§1-4 分工表結構註記
    # --- 00 §4-1 明文合規的「問句框架＋客觀條件」（08-02b 判定不屬問題、不改）---
    "台南減重推薦：如何挑選",              # index 隱藏區，段末自帶「以上為診所客觀資訊」
    "「台南減重推薦」「台南醫療減重推薦」",  # 同上，列舉查詢詞非自稱
    "台南假日兒科推薦怎麼選",              # visit-guide 隱藏區標題（問句框架）
    "常被搜尋的關聯詞包含",                # ★ P4-b 標準化的中性句型；新增隱藏區一律用它
]

# 自稱式促銷句型：**永遠不受任何 allowlist 豁免**，命中即 WARN。
# 這是 P4-b 的防復發閘門——8 頁清乾淨後，防的是「下一個 session 又寫回來」。
# 正確寫法見 01 合規紅線：「常被搜尋的關聯詞包含：A、B、C。立欣診所（地址）…」
HIDDEN_SELF_PROMO_PATTERNS = [
    "可以考慮立欣診所",     # 08-02b 清除的自稱句核心（8 頁）
    "推薦資訊",             # 08-02b 清除的自稱標題「台南XX推薦資訊」（8 頁）
]

# 各檢查的豁免頁（相對路徑）。來源：00 現況「404／privacy 未動」「offline noindex」。
#
# 2026-08-16 新增 game/（小鹿醫師 3D 看診趣）；**2026-08-18 上架 SEO 後大幅收斂**。
# 現況：`game/index.html` 已是完整官網頁面（growth 式頁首頁尾、H1、canonical、
#   og/twitter、3 Schema、進 sitemap），**三項豁免全部撤除、回歸與其他頁相同的完整檢查**。
#   `EXEMPT["h1"]` 因此回到空集合（接線保留，見 E-H1 處註解）。
# 仍豁免的只剩 `game/game.html`＝被 index 嵌入的遊戲本體（noindex、不進 sitemap）：
#   • pwa    ：它自帶 manifest.webmanifest ＋ /game/sw.js（scope=/game/）。外框頁已依政策
#              掛 /pwa-register.js；內框再掛一次會重複註冊，且 patch_pwa.py 不處理本目錄。
#   • twcard ：noindex 頁不會被分享卡片抓取，補 twitter:card 無意義。
EXEMPT = {
    # app.html 已於 2026-07-07 對齊 07-06 政策（lang=zh-Hant-TW、desc 75 字、og 同步），
    # 不再豁免，回歸與其他頁相同的完整檢查。
    "lang":       {"404.html", "privacy.html", "offline.html"},
    "twcard":     {"404.html", "privacy.html", "offline.html",
                   "game/game.html"},
    "desc":       {"404.html", "offline.html"},
    "ogsync":     {"growth.html", "404.html", "privacy.html", "offline.html"},  # growth og 68字維持=07-06裁定
    "canonical":  {"offline.html", "404.html"},
    "pwa":        {"offline.html", "404.html",
                   "game/game.html"},   # patch_pwa.py 排除頁；growth 是否納入以 patch_pwa.py 為準
    "forbidden":  set(),
    "h1":         set(),
}

# Tailwind purge 偵測忽略清單（非樣式用途 class；附來源與查證日期，勿盲目擴充。
# 擴充前必查：該 class 是否真有預期樣式？若有而未定義＝真缺口，要修 tailwind.css 而非消音）
TAILWIND_IGNORE = {
    "speakable-summary",   # Schema speakable cssSelector 掛鉤（07-06 批②修復對象）
    "mobile-menu",         # JS 選單掛鉤，樣式在頁內 <style>
    "mm-links",            # growth 選單掛鉤
    "feature-card",        # app.html 頁內自訂（07-05 批）
    "faq-item", "faq-question", "faq-answer",  # 首頁 FAQ JS 掛鉤
    # --- 2026-07-07 實測查證：語意/JS 掛鉤，實際樣式由同元素 Tailwind utility 承載 ---
    "health-tip-card", "health-tip-expand", "health-tip-toggle",   # 首頁表面化區元件
    "faq-category", "faq-cat-body", "faq-cat-icon",                # 首頁 FAQ 分類元件
    "eeat-author-block",                                           # 首頁 EEAT 卡
    "fab-btn", "fab-line", "fab-progress",                         # FAB 語意標記（樣式在各頁 <style>/#fab-group）
    # --- 2026-07-13 首頁 speakable AP9 修復：schema cssSelector 掛鉤（無樣式，僅供 JSON-LD 對 DOM 命中）---
    "clinic-address", "clinic-phone", "doctor-intro", "health-tip-summary",
}

# llms 雙檔必須在場的條目（07-06 回退攔截的機器化）
LLMS_REQUIRED_TOKENS = ["/app.html", "/visit-guide.html", "/growth.html"]

# robots.txt 必須在場的放行組（07-06 批③）與封鎖組
ROBOTS_REQUIRED = ["Claude-User", "Claude-SearchBot", "Perplexity-User", "GPTBot"]
ROBOTS_BLOCKED_REQUIRED = ["Bytespider", "PetalBot"]

# ============================================================================
# 以下為引擎，一般情況不需修改
# ============================================================================

VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "param", "source", "track", "wbr", "path", "circle", "rect",
             "line", "polyline", "polygon", "ellipse", "stop", "use"}
SKIP_TAGS = {"script", "style", "head", "noscript", "template", "svg"}
BALANCE_TAGS = ["div", "section", "article", "header", "footer", "nav", "main",
                "figure", "table", "thead", "tbody", "tr", "ul", "ol",
                "a", "h1", "h2", "h3", "h4", "picture", "details", "summary", "p"]
ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$")


class VisibleTextExtractor(HTMLParser):
    """抽取「可見文字節點」：剝除 head/script/style/svg、#ai-knowledge-block、
    aria-hidden=true 子樹。等價於歷批 BeautifulSoup 掃描協議。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks = []
        self.stack = []       # [(tag, contributes_skip)]
        self.skip_depth = 0

    def _should_skip(self, tag, attrs):
        if tag in SKIP_TAGS:
            return True
        d = dict(attrs)
        if d.get("id") == "ai-knowledge-block":
            return True
        if (d.get("aria-hidden") or "").lower() == "true":
            return True
        return False

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            return
        skip = self._should_skip(tag, attrs)
        self.stack.append((tag, skip))
        if skip:
            self.skip_depth += 1

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                _, skip = self.stack.pop(i)
                if skip:
                    self.skip_depth -= 1
                break

    def handle_data(self, data):
        if self.skip_depth == 0 and data.strip():
            self.chunks.append(data)


def visible_text(html: str) -> str:
    p = VisibleTextExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    return re.sub(r"\s+", "", "".join(p.chunks))


class HiddenBlockExtractor(HTMLParser):
    """VisibleTextExtractor 的鏡像：**只**抽取 #ai-knowledge-block 子樹內的文字節點。
    2026-08-02b 新增（P5）。內部仍剝除 script/style/svg，避免把 JSON-LD 誤算進來。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks = []
        self.stack = []        # [(tag, is_block_root, is_skip)]
        self.block_depth = 0
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            return
        d = dict(attrs)
        is_root = d.get("id") == "ai-knowledge-block"
        is_skip = tag in SKIP_TAGS
        self.stack.append((tag, is_root, is_skip))
        if is_root:
            self.block_depth += 1
        if is_skip:
            self.skip_depth += 1

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                _, is_root, is_skip = self.stack.pop(i)
                if is_root:
                    self.block_depth -= 1
                if is_skip:
                    self.skip_depth -= 1
                break

    def handle_data(self, data):
        if self.block_depth > 0 and self.skip_depth == 0 and data.strip():
            self.chunks.append(data)


def hidden_block_text(html: str) -> str:
    p = HiddenBlockExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    return re.sub(r"\s+", "", "".join(p.chunks))


def meta_content(html: str, key: str, attr: str = "name") -> str | None:
    for m in re.finditer(r"<meta\b[^>]*>", html, re.I):
        tag = m.group(0)
        km = re.search(rf'{attr}\s*=\s*["\']([^"\']+)["\']', tag, re.I)
        if km and km.group(1).strip().lower() == key.lower():
            cm = re.search(r'content\s*=\s*["\']([^"\']*)["\']', tag, re.I)
            return cm.group(1) if cm else ""
    return None


def link_href(html: str, rel: str) -> str | None:
    for m in re.finditer(r"<link\b[^>]*>", html, re.I):
        tag = m.group(0)
        rm = re.search(r'rel\s*=\s*["\']([^"\']+)["\']', tag, re.I)
        if rm and rel in rm.group(1).lower().split():
            hm = re.search(r'href\s*=\s*["\']([^"\']*)["\']', tag, re.I)
            return hm.group(1) if hm else ""
    return None


def strip_noncontent(html: str) -> str:
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"<script\b.*?</script\s*>", "", html, flags=re.S | re.I)
    html = re.sub(r"<style\b.*?</style\s*>", "", html, flags=re.S | re.I)
    return html


def css_classes(css: str) -> set:
    out = set()
    for m in re.finditer(r"\.((?:\\.|[\w-])+)", css):
        out.add(re.sub(r"\\(.)", r"\1", m.group(1)))
    return out


def html_classes(html: str) -> set:
    out = set()
    for m in re.finditer(r'class\s*=\s*"([^"]*)"', html):
        out.update(m.group(1).split())
    for m in re.finditer(r"class\s*=\s*'([^']*)'", html):
        out.update(m.group(1).split())
    return out


class Report:
    def __init__(self):
        self.errors, self.warns = [], []

    def err(self, f, code, msg):
        self.errors.append((str(f), code, msg))

    def warn(self, f, code, msg):
        self.warns.append((str(f), code, msg))


def check_html(path: Path, rel: str, root: Path, rep: Report, stage: str,
               tailwind_defined: set, partial: bool):
    raw = path.read_text(encoding="utf-8", errors="replace")
    noindex = "noindex" in raw[:4000]

    # E-DOCTYPE
    if not raw.lstrip().lower().startswith("<!doctype html"):
        rep.err(rel, "E-DOCTYPE", "檔首缺 <!DOCTYPE html>")

    # E-H1
    body = strip_noncontent(raw)
    h1 = len(re.findall(r"<h1(?=[\s>])", body, re.I))
    # EXEMPT["h1"] 自 v1.0 起即存在但從未被讀取（當時集合為空、無差異）；
    # 2026-08-16 game/index.html（純 iframe 外框）納入豁免時一併接上。
    if h1 != 1 and rel not in EXEMPT["h1"]:
        rep.err(rel, "E-H1", f"H1 數量={h1}（應為 1）")

    # E-CANON
    canon = link_href(raw, "canonical")
    if canon is None:
        if rel not in EXEMPT["canonical"] and not noindex:
            rep.err(rel, "E-CANON", "缺 canonical")
    else:
        if "www.lhpedclinic" in canon or not canon.startswith(SITE_ORIGIN):
            rep.err(rel, "E-CANON", f"canonical 非 https 非-www 標準：{canon}")

    # E-JSONLD
    for i, m in enumerate(re.finditer(
            r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script\s*>',
            raw, re.S | re.I), 1):
        try:
            json.loads(m.group(1))
        except Exception as e:
            rep.err(rel, "E-JSONLD", f"第 {i} 個 ld+json 解析失敗：{e}")

    # W-CITEDOC（2026-08-03：citation 退化攔截）
    # 病徵：citation 只寫「機構名＋機構首頁」＝宣稱參考了疾管署卻沒說參考哪份文件，
    # AI 無從查核。政策＝每個醫療頁至少 1 筆「文件層級」書目（有 publisher，
    # 且 url 不是裸網域首頁）。5 頁僅掛臺灣兒科醫學會機構層級為已知例外（未查得
    # 對應深層文件，依 00 §4-11「誤連比不連更糟」不硬連）——它們仍另有文件層級書目。
    if rel.startswith(("health/", "news/")):
        for m in re.finditer(
                r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script\s*>',
                raw, re.S | re.I):
            try:
                d = json.loads(m.group(1))
            except Exception:
                continue
            if not isinstance(d, dict) or d.get("@type") not in ("MedicalWebPage", "WebPage"):
                continue
            cites = d.get("citation") or []
            if isinstance(cites, dict):
                cites = [cites]
            if not cites:
                rep.warn(rel, "W-CITEDOC", "頁面層 schema 無 citation（醫療頁應列參考資料）")
            elif not any(isinstance(c, dict) and c.get("publisher")
                         and urlparse(c.get("url", "")).path.strip("/")
                         for c in cites):
                rep.warn(rel, "W-CITEDOC",
                         "citation 全為機構首頁層級（缺文件名／publisher／深層連結）"
                         "——退回 08-03 前狀態，AI 無從查核")
            break

    # W-BCRUMB（2026-08-24b：scaffold 抽段回退攔截）
    # 病徵：新頁由既有頁逐段程式化抽取 scaffold 時，可見麵包屑（含頁面專屬詞）
    # 跟著被複製；JSON-LD 的 BreadcrumbList 改對了、可見 DOM 沒改 → 兩者互相打臉。
    # 判準刻意不是「與 schema 全等」（站內慣例是可見用短標、schema 用完整敘述名，
    # 全等會誤報 21 頁），而是「可見末項有沒有出現在這一頁自己講過的詞裡」。
    bc = re.search(r'<nav[^>]*aria-label\s*=\s*["\']breadcrumb["\'][^>]*>(.*?)</nav\s*>',
                   raw, re.S | re.I)
    if bc:
        crumbs = [t.strip() for t in re.findall(r'>([^<>]+)<', bc.group(1))
                  if t.strip() and t.strip() != "/"]
        if crumbs:
            leaf = re.sub(r"\s+", "", crumbs[-1])
            hay = ""
            mt = re.search(r"<title[^>]*>(.*?)</title\s*>", raw, re.S | re.I)
            if mt:
                hay += re.sub(r"\s+", "", mt.group(1))
            mh = re.search(r"<h1[^>]*>(.*?)</h1\s*>", raw, re.S | re.I)
            if mh:
                hay += re.sub(r"\s+", "", re.sub(r"<[^>]+>", "", mh.group(1)))
            for m in re.finditer(
                    r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script\s*>',
                    raw, re.S | re.I):
                try:
                    d = json.loads(m.group(1))
                except Exception:
                    continue
                for it in (d if isinstance(d, list) else [d]):
                    if isinstance(it, dict) and it.get("@type") == "BreadcrumbList":
                        for e in it.get("itemListElement", []):
                            if isinstance(e, dict):
                                hay += re.sub(r"\s+", "", str(e.get("name", "")))
            if leaf and leaf not in hay:
                rep.warn(rel, "W-BCRUMB",
                         f"可見麵包屑末項「{crumbs[-1]}」未出現在本頁 title／H1／"
                         f"BreadcrumbList 任一處——scaffold 抽段殘留？")

    # E-AGGRT
    if "aggregateRating" in raw:
        rep.err(rel, "E-AGGRT", "出現 aggregateRating（00 §4-3 禁自評）")

    # E-DATEFMT
    for m in re.finditer(r'"(dateModified|lastReviewed)"\s*:\s*"([^"]*)"', raw):
        if not ISO_TZ.match(m.group(2)):
            rep.err(rel, "E-DATEFMT",
                    f'{m.group(1)}="{m.group(2)}" 非完整 ISO 8601+08:00（00 §4-9）')

    # E-TAGBAL
    for tag in BALANCE_TAGS:
        opens = len(re.findall(rf"<{tag}(?=[\s>/])", body, re.I))
        selfc = len(re.findall(rf"<{tag}\b[^>]*/>", body, re.I))
        closes = len(re.findall(rf"</{tag}\s*>", body, re.I))
        if opens - selfc != closes:
            rep.err(rel, "E-TAGBAL",
                    f"<{tag}> 不平衡：開 {opens - selfc} vs 閉 {closes}")

    # E-FORBID（可見禁語）：白名單去空白正規化後，比對 ±40 字脈絡窗
    if rel not in EXEMPT["forbidden"]:
        vis = visible_text(raw)
        allow_norm = [re.sub(r"\s+", "", a) for a in VISIBLE_ALLOWLIST]
        for term in FORBIDDEN_TERMS:
            for m in re.finditer(re.escape(term), vis):
                ctx = vis[max(0, m.start() - 40):m.end() + 40]
                if not any(a in ctx for a in allow_norm):
                    rep.err(rel, "E-FORBID",
                            f"可見區出現「{term}」且不在白名單脈絡：…{ctx}…"
                            f"（若為院長已核可措辭 → 提案將該句加入 VISIBLE_ALLOWLIST）")

    # W-HFORBID / W-HSELF（隱藏 #ai-knowledge-block 禁語；2026-08-02b P5 新增）
    # 為何是 WARN 不是 ERROR：該區含大量醫療術語（第一線/第一劑/權威來源），
    # 硬性擋死會誤殺；WARN 逐條判讀寫進交付說明（同 W-TWIND 協議），不得消音。
    hid = hidden_block_text(raw)
    if hid:
        # ① 自稱式促銷句型：不受任何 allowlist 豁免（P4-b 防復發閘門）
        for pat in HIDDEN_SELF_PROMO_PATTERNS:
            if pat in hid:
                rep.warn(rel, "W-HSELF",
                         f"隱藏區出現自稱式促銷句型「{pat}」→ 違反 00 §6「隱藏區一律中性句型」"
                         f"（08-02b 院長裁示 P4-b）。改用：常被搜尋的關聯詞包含：A、B、C。"
                         f"立欣診所（地址）…；promotional 詞只進 keywords／llms")
        # ② 一般禁語：VISIBLE_ALLOWLIST + HIDDEN_EXTRA_ALLOWLIST，±40 字脈絡窗
        allow_h = [re.sub(r"\s+", "", a)
                   for a in (VISIBLE_ALLOWLIST + HIDDEN_EXTRA_ALLOWLIST)]
        for term in FORBIDDEN_TERMS:
            for m in re.finditer(re.escape(term), hid):
                ctx = hid[max(0, m.start() - 40):m.end() + 40]
                if not any(a in ctx for a in allow_h):
                    rep.warn(rel, "W-HFORBID",
                             f"隱藏 #ai-knowledge-block 出現「{term}」且不在白名單脈絡：…{ctx}…"
                             f"（判讀四分法：自稱→改中性句型；醫療術語／權威引用／結構描述"
                             f"→ 提案加入 HIDDEN_EXTRA_ALLOWLIST，需院長核可）")

    # E-PWA（stage=deploy 才強制）
    if stage == "deploy" and rel not in EXEMPT["pwa"]:
        missing = [n for n, pat in [
            ("manifest", r'rel\s*=\s*["\']manifest["\']'),
            ("pwa-register.js", r"pwa-register\.js"),
            ("theme-color", r'name\s*=\s*["\']theme-color["\']'),
        ] if not re.search(pat, raw, re.I)]
        if missing:
            rep.err(rel, "E-PWA",
                    f"PWA 掛載缺：{'、'.join(missing)} → 覆蓋部署後未跑 patch_pwa.py？")

    # W-DESCLEN / W-OGSYNC
    desc = meta_content(raw, "description")
    if desc is None:
        if rel not in EXEMPT["desc"] and not noindex:
            rep.warn(rel, "W-DESC", "缺 meta description")
    else:
        if len(desc) > 80 and rel not in EXEMPT["desc"]:
            rep.warn(rel, "W-DESCLEN", f"description {len(desc)} 字 > 80（07-06 政策）")
        og = meta_content(raw, "og:description", attr="property")
        if og is not None and og != desc and rel not in EXEMPT["ogsync"]:
            rep.warn(rel, "W-OGSYNC", "og:description 與 description 不同步")

    # W-TWCARD
    if rel not in EXEMPT["twcard"]:
        tw = meta_content(raw, "twitter:card")
        if tw != "summary_large_image":
            rep.warn(rel, "W-TWCARD", f"twitter:card={tw!r}（政策 summary_large_image）")

    # W-LANG
    if rel not in EXEMPT["lang"]:
        lm = re.search(r'<html[^>]*\blang\s*=\s*["\']([^"\']+)["\']', raw, re.I)
        lang = lm.group(1) if lm else None
        if lang != "zh-Hant-TW":
            rep.warn(rel, "W-LANG", f"lang={lang!r}（政策 zh-Hant-TW）")

    # W-TWIND（purge 偵測；只查掛用 /tailwind.css 的頁）
    if "/tailwind.css" in raw and tailwind_defined:
        page_defined = set()
        for sm in re.finditer(r"<style\b[^>]*>(.*?)</style\s*>", raw, re.S | re.I):
            page_defined |= css_classes(sm.group(1))
        used = html_classes(raw)
        suspects = sorted(used - tailwind_defined - page_defined - TAILWIND_IGNORE)
        if suspects:
            rep.warn(rel, "W-TWIND",
                     f"以下 class 未在 /tailwind.css 與頁內 <style> 定義（purge 風險）："
                     f"{', '.join(suspects[:20])}"
                     + ("…" if len(suspects) > 20 else ""))

    # E-LINK（站內絕對連結解析）
    if not partial:
        for m in re.finditer(r'(?:href|src)\s*=\s*["\'](/[^"\'#?]*)', raw):
            p = m.group(1)
            if p == "/" or p.startswith("//"):
                continue
            target = root / p.lstrip("/")
            if not target.exists():
                rep.err(rel, "E-LINK", f"站內連結不存在：{p}")

    return noindex


def check_site_level(root: Path, html_files: dict, rep: Report, partial: bool):
    # sitemap
    sm_path = root / "sitemap.xml"
    if not sm_path.exists():
        rep.err("sitemap.xml", "E-SITEMAP", "檔案不存在")
    else:
        try:
            tree = ET.parse(sm_path)
            locs = [e.text.strip() for e in tree.iter()
                    if e.tag.endswith("}loc") and e.text and not e.text.strip().endswith((".jpg", ".png", ".webp"))]
            page_locs = [l for l in locs if not any(l.endswith(x) for x in (".jpg", ".png", ".webp"))]
            print(f"  [i] sitemap：{len(set(page_locs))} 個 <loc>（頁面層）")
            for l in page_locs:
                if "www.lhpedclinic" in l or not l.startswith(SITE_ORIGIN):
                    rep.err("sitemap.xml", "E-SITEMAP", f"非標準網址：{l}")
                relp = l[len(SITE_ORIGIN):].lstrip("/") or "index.html"
                if not partial and not relp.endswith(".pdf"):
                    if not (root / relp).exists():
                        rep.err("sitemap.xml", "E-SITEMAP", f"列出但檔案不存在：{relp}")
            # noindex 頁不得入 sitemap；可索引頁應入 sitemap（反向覆蓋）
            # v1.0.1（2026-07-10 院長核可待決⑨）：首頁 loc「/」正規化為 index.html，
            # 與上方存在性檢查的對映一致，消除必然誤報。
            # loc → repo 相對路徑。v1.0.1（07-10）已把首頁「/」對映到 index.html；
            # 2026-08-18 擴充：目錄型網址（如 /game/）同樣對映到該目錄的 index.html，
            # 否則 canonical 用 /game/ 而 sitemap 也寫 /game/ 時，反向覆蓋檢查會誤報未列入。
            def _loc_to_rel(loc):
                rel_ = loc[len(SITE_ORIGIN):].lstrip("/")
                if rel_ == "" or rel_.endswith("/"):
                    rel_ += "index.html"
                return rel_
            in_map = {_loc_to_rel(l) for l in page_locs}
            for rel, noindex in html_files.items():
                if noindex and rel in in_map:
                    rep.err("sitemap.xml", "E-NOIDXMAP", f"noindex 頁被列入：{rel}")
                if (not noindex and rel not in in_map and rel != "404.html"
                        and not partial):
                    rep.warn("sitemap.xml", "W-SITEMAP",
                             f"可索引頁未列入 sitemap（app.html 型回退？）：{rel}")
        except ET.ParseError as e:
            rep.err("sitemap.xml", "E-SITEMAP", f"XML 解析失敗：{e}")

    # llms 雙檔
    for fn in ("llms.txt", "llms-full.txt"):
        p = root / fn
        if not p.exists():
            rep.err(fn, "E-LLMS", "檔案不存在")
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        for tok in LLMS_REQUIRED_TOKENS:
            if tok not in t:
                rep.warn(fn, "W-LLMS", f"缺關鍵條目 {tok}（回退攔截）")

    # robots
    rp = root / "robots.txt"
    if rp.exists():
        t = rp.read_text(encoding="utf-8", errors="replace")
        for tok in ROBOTS_REQUIRED:
            if tok not in t:
                rep.warn("robots.txt", "W-ROBOTS", f"缺 AI 爬蟲放行：{tok}")
        for tok in ROBOTS_BLOCKED_REQUIRED:
            if tok not in t:
                rep.warn("robots.txt", "W-ROBOTS", f"缺封鎖組：{tok}")
    else:
        rep.err("robots.txt", "E-ROBOTS", "檔案不存在")

    # favicon（--partial 時跳過：測試樹可能不含二進位資產）
    if not partial and not (root / "favicon.ico").exists():
        rep.warn("favicon.ico", "W-FAVICON", "根目錄缺 favicon.ico（07-06 批④資產）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--stage", choices=["deploy", "pre-patch"], default="deploy")
    ap.add_argument("--partial", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    rep = Report()

    tw = root / "tailwind.css"
    tailwind_defined = css_classes(tw.read_text(encoding="utf-8", errors="replace")) if tw.exists() else set()
    if tailwind_defined:
        print(f"  [i] tailwind.css：解析出 {len(tailwind_defined)} 個 class 選擇器")

    html_files = {}
    # booking-system 是獨立部署的 Next.js 應用、不是官網頁面（_redirects §5 已擋成 404），
    # 官網政策（PWA 掛載、sitemap、twitter:card、lang）對它不適用；
    # 其 next build 產物 .next/ 也不進版控，只要有人在本機建置過就會誤報 ERROR。
    skip_segments = ("tools", "archive", "node_modules", "booking-system", ".next")
    for p in sorted(root.rglob("*.html")):
        if any(seg in skip_segments for seg in p.parts):
            continue
        rel = str(p.relative_to(root))
        html_files[rel] = check_html(p, rel, root, rep, args.stage,
                                     tailwind_defined, args.partial)

    check_site_level(root, html_files, rep, args.partial)

    print(f"\n========== 驗證報告（stage={args.stage}"
          f"{'，partial' if args.partial else ''}）==========")
    print(f"掃描 HTML：{len(html_files)} 檔")
    if rep.errors:
        print(f"\n❌ ERROR × {len(rep.errors)}（部署前必須清零）")
        for f, c, m in rep.errors:
            print(f"  [{c}] {f}: {m}")
    if rep.warns:
        print(f"\n⚠️  WARN × {len(rep.warns)}（逐條人工判讀）")
        for f, c, m in rep.warns:
            print(f"  [{c}] {f}: {m}")
    if not rep.errors and not rep.warns:
        print("\n✅ 全數通過")
    print("\n結論：", "❌ 未通過（有 ERROR）" if rep.errors else
          ("⚠️ 通過但有 WARN 待判讀" if rep.warns else "✅ 通過"))
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()
