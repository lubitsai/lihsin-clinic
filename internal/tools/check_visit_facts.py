#!/usr/bin/env python3
"""
「我現在可以怎麼就醫？」營運事實一致性檢查（唯讀，不改任何檔案）。

為什麼需要這支工具
------------------
門診時間、疫苗停打時間、結構化資料的營業時段，全站散落在幾十個載體
（可見段落、FAQ schema、隱藏 AI 區、llms 雙檔、小幫手知識庫）。
`validate_site.py` 不檢查時間一致性，門診批一直靠 SOP 清單人工防漏——
改一處漏三處的風險就在這裡。

本工具以官網首頁的**可見門診時間表**為唯一事實來源（與 `sync_schedule.py` 同一個解析器），
推導出其他載體應該寫什麼，再逐一比對：

    index.html 可見門診時間表
        ├─→ 各日最後一診結束時間 − 1 小時 ＝ 疫苗停止施打時間
        │       └─ 比對：任何「停止施打」後面列出的逐日時間（visit-guide、小幫手知識庫…）
        └─→ 各日各診次的最早開始／最晚結束
                └─ 比對：各頁 JSON-LD openingHoursSpecification

    index.html #clinic-notice 各則 data-expires（未過期者）
        └─ 比對：/notices/notices.json 各則 end（服務頁橫幅的資料，2026-09-25g 起）
           兩邊要一一對應——首頁上架了公告卻忘了寫 notices.json，服務頁就看不到；
           反過來 notices.json 多一則，服務頁會顯示首頁沒有的公告。

另有 `--inventory`：盤點「最後一診前 1 小時」措辭在各檔、各層（可見／JSON-LD／隱藏區／純文字）
的分布，供可見文字提案列「現行值逐欄位對照表」用（00 §附 C-6）。

用法
----
    python3 internal/tools/check_visit_facts.py              # 檢查；不一致時 exit 1
    python3 internal/tools/check_visit_facts.py --inventory  # 另印措辭分布盤點

能力邊界
--------
- 只比對「寫成逐日時間」的停打時間；只寫「最後一診前 1 小時」而不列時間的句子，
  本工具只能盤點、不能判對錯（那句話本身沒有數字）。
- 單日公告（EXCEPTIONS／公告圖）改變的是當天，不影響常態停打時間，本工具不處理。
- notices.json 的 summary 文字是否與首頁公告說明段相符，本工具不判斷（只比日期）。
- 不檢查站外載體（Google 商家、BookNow、MainPi、門口公告）。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

from sync_schedule import ScheduleError, minutes_to_time, parse_visible_table  # noqa: E402
from validate_site import hidden_block_text, visible_text  # noqa: E402

VACCINE_CUTOFF_MINUTES = 60  # 每日最後一診結束前 1 小時停止疫苗施打

DAY_CHARS = "日一二三四五六"  # 0=日…6=六，與 sync_schedule 的 weekday 一致
SCHEMA_DAYS = {
    "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3,
    "Thursday": 4, "Friday": 5, "Saturday": 6,
}

# 公開部署但不屬於官網內容的目錄（與 _redirects 第 5 節攔截範圍一致）
SKIP_DIRS = {"internal", "archive", "booking-system", ".git", ".claude", ".codex", "docs", "node_modules"}
# 例外：小幫手知識庫正本在 internal/，但它是線上小幫手的來源，停打時間也要對
EXTRA_FILES = ["internal/AI客服知識庫_立欣診所_正本_20260924.md"]

CUTOFF_ANCHOR_RE = re.compile(r"停止(?:施打)?疫苗(?:施打)?|停止施打")
# 兩種寫法都要抓：「週六：<strong>17:00</strong> 前」與 2026-09-25g 起的「週一至週五 20:30、週六 17:00」。
# 時間後面不得緊接「–」或數字，排除「週六 08:00–11:30」這種門診時段。
DAY_TIME_RE = re.compile(
    r"(?:週([一二三四五六日])(?:\s*[至到～~\-–]\s*週([一二三四五六日]))?|(平日))"
    r"\s*[：:]?\s*(?:請於\s*)?(?:<[^>]+>\s*)*(\d{1,2}:\d{2})(?![–\-~～:\d])"
)
WINDOW = 160  # 停打句之後掃描逐日時間的字數
LDJSON_RE = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S)
PHRASE = "最後一診前"  # 舊寫法（2026-09-25g 全站改為「最後一診結束前」）


def to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def day_label(d: int) -> str:
    return f"週{DAY_CHARS[d]}"


def expand_days(a: str, b: str | None) -> list[int]:
    start = DAY_CHARS.index(a)
    if not b:
        return [start]
    end = DAY_CHARS.index(b)
    # 「週一至週日」這種跨週末的寫法：依週一→週日的順序展開
    order = [1, 2, 3, 4, 5, 6, 0]
    i, j = order.index(start), order.index(end)
    return order[i : j + 1] if i <= j else []


def derive(weekly: dict[int, list[dict]]):
    cutoffs: dict[int, str] = {}
    hours: set[tuple[int, str, str]] = set()
    for day, slots in weekly.items():
        if not slots:
            continue
        last_end = max(to_min(s["end"]) for s in slots)
        cutoffs[day] = minutes_to_time(last_end - VACCINE_CUTOFF_MINUTES)
        by_session: dict[str, list[dict]] = {}
        for s in slots:
            by_session.setdefault(s["session"], []).append(s)
        for group in by_session.values():
            opens = min(to_min(s["start"]) for s in group)
            closes = max(to_min(s["end"]) for s in group)
            hours.add((day, minutes_to_time(opens), minutes_to_time(closes)))
    return cutoffs, hours


def site_files(root: Path) -> list[Path]:
    out = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in {".html", ".txt", ".json", ".md"}:
            continue
        rel = p.relative_to(root)
        if rel.parts[0] in SKIP_DIRS or rel.name in {"CLAUDE.md", "AGENTS.md", "README.md"}:
            continue
        out.append(p)
    for extra in EXTRA_FILES:
        p = root / extra
        if p.exists():
            out.append(p)
    return out


def check_cutoffs(root: Path, files: list[Path], expected: dict[int, str]) -> tuple[list[str], int]:
    problems: list[str] = []
    checked = 0
    for p in files:
        text = p.read_text(encoding="utf-8", errors="replace")
        rel = p.relative_to(root)
        for anchor in CUTOFF_ANCHOR_RE.finditer(text):
            window = text[anchor.end() : anchor.end() + WINDOW]
            nxt = CUTOFF_ANCHOR_RE.search(window)
            if nxt:
                window = window[: nxt.start()]
            for m in DAY_TIME_RE.finditer(window):
                days = [1, 2, 3, 4, 5] if m.group(3) else expand_days(m.group(1), m.group(2))
                for d in days:
                    checked += 1
                    got = m.group(4).zfill(5)
                    want = expected.get(d)
                    if want is None:
                        problems.append(f"{rel}：{day_label(d)} 寫停打 {got}，但門診表當天休診")
                    elif got != want:
                        line = text.count("\n", 0, anchor.end() + m.start()) + 1
                        problems.append(
                            f"{rel}:{line}：{day_label(d)} 疫苗停打寫 {got}，"
                            f"門診表推導應為 {want}（最後一診結束 − {VACCINE_CUTOFF_MINUTES} 分）"
                        )
    return problems, checked


def check_opening_hours(root: Path, files: list[Path], expected: set) -> tuple[list[str], int]:
    problems: list[str] = []
    pages = 0
    for p in files:
        if p.suffix != ".html":
            continue
        html = p.read_text(encoding="utf-8", errors="replace")
        if "openingHoursSpecification" not in html:
            continue
        rel = p.relative_to(root)
        for block in LDJSON_RE.findall(html):
            if "openingHoursSpecification" not in block:
                continue
            try:
                data = json.loads(block)
            except json.JSONDecodeError as e:
                problems.append(f"{rel}：含 openingHoursSpecification 的 JSON-LD 解析失敗（{e}）")
                continue
            for spec_list in find_key(data, "openingHoursSpecification"):
                pages += 1
                got: set[tuple[int, str, str]] = set()
                for spec in spec_list if isinstance(spec_list, list) else [spec_list]:
                    days = spec.get("dayOfWeek", [])
                    days = days if isinstance(days, list) else [days]
                    for d in days:
                        name = str(d).rsplit("/", 1)[-1]
                        got.add((SCHEMA_DAYS[name], spec.get("opens"), spec.get("closes")))
                for d, o, c in sorted(got - expected):
                    problems.append(f"{rel}：schema 有 {day_label(d)} {o}–{c}，門診表沒有這個診次")
                for d, o, c in sorted(expected - got):
                    problems.append(f"{rel}：門診表有 {day_label(d)} {o}–{c}，schema 缺這個診次")
    return problems, pages


def check_notices(root: Path) -> tuple[list[str], int]:
    """首頁 #clinic-notice 未過期的各則 ↔ /notices/notices.json 未過期的各則，以適用末日比對。"""
    problems: list[str] = []
    today = (dt.datetime.utcnow() + dt.timedelta(hours=8)).date().isoformat()
    html = (root / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<section id="clinic-notice".*?</section>', html, re.S)
    page = set()
    if m:
        page = {e for e in re.findall(r'class="notice-item[^"]*"[^>]*data-expires="([\d-]+)"', m.group(0)) if e >= today}
    path = root / "notices" / "notices.json"
    if not path.exists():
        return ([f"缺 notices/notices.json，但首頁有進行中的公告（到期日 {sorted(page)}）"] if page else []), 0
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"notices/notices.json 解析失敗（{e}）"], 0
    items = data.get("notices", [])
    for n in items:
        for k in ("id", "start", "end", "dates", "summary"):
            if not n.get(k):
                problems.append(f"notices.json「{n.get('id', '?')}」缺欄位 {k}")
        if n.get("start", "") > n.get("end", ""):
            problems.append(f"notices.json「{n.get('id')}」start 晚於 end")
    feed = {n.get("end") for n in items if n.get("end", "") >= today}
    for e in sorted(page - feed):
        problems.append(f"首頁 #clinic-notice 有一則到期日 {e} 的公告，notices.json 沒有對應的一則（服務頁看不到）")
    for e in sorted(feed - page):
        problems.append(f"notices.json 有一則 end={e} 的公告，首頁 #clinic-notice 沒有對應的一則")
    return problems, len(feed)


def find_key(obj, key):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            else:
                yield from find_key(v, key)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_key(v, key)


def inventory(root: Path, files: list[Path]) -> None:
    print(f"\n〔盤點〕「{PHRASE}」措辭分布（可見＝剝除 script/隱藏區後的文字）")
    print(f"{'檔案':<44}{'可見':>5}{'JSON-LD':>9}{'隱藏區':>7}{'純文字':>7}")
    totals = [0, 0, 0, 0]
    for p in files:
        text = p.read_text(encoding="utf-8", errors="replace")
        if PHRASE not in text.replace(" ", ""):
            continue
        rel = str(p.relative_to(root))
        norm = lambda s: s.replace(" ", "").count(PHRASE)  # noqa: E731
        if p.suffix == ".html":
            row = [
                norm(visible_text(text)),
                sum(norm(b) for b in LDJSON_RE.findall(text)),
                norm(hidden_block_text(text)),
                0,
            ]
        else:
            row = [0, 0, 0, norm(text)]
        totals = [a + b for a, b in zip(totals, row)]
        print(f"{rel:<44}{row[0]:>5}{row[1]:>9}{row[2]:>7}{row[3]:>7}")
    print(f"{'合計':<44}{totals[0]:>5}{totals[1]:>9}{totals[2]:>7}{totals[3]:>7}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".", help="repo 根目錄（預設 .）")
    ap.add_argument("--inventory", action="store_true", help="另印「最後一診前」措辭分布盤點")
    args = ap.parse_args()
    root = Path(args.root).resolve()

    try:
        weekly = parse_visible_table((root / "index.html").read_text(encoding="utf-8"))
    except ScheduleError as e:
        print(f"❌ 無法解析首頁門診時間表：{e}")
        return 1

    cutoffs, hours = derive(weekly)
    print("〔事實來源〕index.html 可見門診時間表 → 推導值")
    for d in [1, 2, 3, 4, 5, 6, 0]:
        spans = "、".join(f"{o}–{c}" for dd, o, c in sorted(hours) if dd == d) or "休診"
        cut = cutoffs.get(d, "—")
        print(f"  {day_label(d)}：門診 {spans}｜疫苗停打 {cut}")

    files = site_files(root)
    cut_problems, cut_checked = check_cutoffs(root, files, cutoffs)
    oh_problems, oh_pages = check_opening_hours(root, files, hours)

    print(f"\n〔比對〕疫苗停打逐日時間：{cut_checked} 筆｜openingHoursSpecification：{oh_pages} 組")
    nt_problems, nt_active = check_notices(root)
    print(f"〔比對〕進行中公告 ↔ notices.json：{nt_active} 則")
    problems = cut_problems + oh_problems + nt_problems
    for msg in problems:
        print(f"  ❌ {msg}")
    if not problems:
        print("  ✅ 全部與門診時間表一致")

    if args.inventory:
        inventory(root, files)

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
