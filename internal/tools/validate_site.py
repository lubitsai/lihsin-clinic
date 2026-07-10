#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_site.py — 立欣診所全站驗證器 v1.0（2026-07-07）
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

已知設計取捨（弱模型請勿「修正」這些行為）
------------------------------------------
- 禁語掃描只掃「文字節點」：keywords meta、alt、head 內容依四層架構本來就允許
  promotional 用語，不在掃描範圍（與歷批 BeautifulSoup 協議一致）。
- W-TWIND 會有少量誤報（純 JS 掛鉤 class、schema 掛鉤 class）→ 收進 TAILWIND_IGNORE
  並附註來源，不要為了消音而放寬偵測邏輯。
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
]

# 各檢查的豁免頁（相對路徑）。來源：00 現況「404／privacy 未動」「offline noindex」。
EXEMPT = {
    # app.html 已於 2026-07-07 對齊 07-06 政策（lang=zh-Hant-TW、desc 75 字、og 同步），
    # 不再豁免，回歸與其他頁相同的完整檢查。
    "lang":       {"404.html", "privacy.html", "offline.html"},
    "twcard":     {"404.html", "privacy.html", "offline.html"},
    "desc":       {"404.html", "offline.html"},
    "ogsync":     {"growth.html", "404.html", "privacy.html", "offline.html"},  # growth og 68字維持=07-06裁定
    "canonical":  {"offline.html", "404.html"},
    "pwa":        {"offline.html", "404.html"},   # patch_pwa.py 排除頁；growth 是否納入以 patch_pwa.py 為準
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
    if h1 != 1:
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
            in_map = {l[len(SITE_ORIGIN):].lstrip("/") for l in page_locs}
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
    for p in sorted(root.rglob("*.html")):
        if any(seg in ("tools", "archive", "node_modules") for seg in p.parts):
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
