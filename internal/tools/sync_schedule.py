#!/usr/bin/env python3
"""
官網門診時間表 → 預約系統班表的單向同步（官網為主）。

為什麼需要這支工具
------------------
官網的門診時間表與預約系統的班表原本各自維護，改了一邊忘了另一邊，
家長就會約到診所實際沒開的時段。本工具把官網訂為唯一事實來源：

    index.html（院長維護）
        ├── 可見的門診時間表 ── 醫師 + 時間
        └── JS 的 SCHEDULE/EXCEPTIONS ── 時間（HERO 開診徽章用）
                    │
                    ▼  本工具解析並交叉核對
        booking-system/prisma/schedule.json（產生檔，勿手改）
                    │
                    ▼  seed.ts / scripts/sync-schedule.ts
              預約系統的 weekly_schedule_templates 與 schedule_exceptions

順便解掉一個既有風險：官網「可見表」與「SCHEDULE 常數」本來就是兩份副本，
本工具每次都逐格比對，只要有人只改其中一邊就會報錯。

用法
----
    python3 internal/tools/sync_schedule.py            # 產生／更新 schedule.json
    python3 internal/tools/sync_schedule.py --check    # 只檢查是否同步（不寫檔，不同步時 exit 1）

輸出的 JSON 用「蔡」「李」這種姓氏標籤而不是資料庫 id，
對應到實際醫師是在 TypeScript 端做的（比對 doctors.name 開頭），
這樣新增醫師時不必動這支工具。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SESSION_BY_ROW = {"上午": "MORNING", "下午": "AFTERNOON", "晚上": "EVENING"}
SESSION_BY_NAME = {"早診": "MORNING", "午診": "AFTERNOON", "晚診": "EVENING"}
# 表頭的星期 → 0=日…6=六（與 JS Date.getDay()、系統 weekday 欄位一致）
WEEKDAY_BY_LABEL = {"週日": 0, "週一": 1, "週二": 2, "週三": 3, "週四": 4, "週五": 5, "週六": 6}
SESSION_ORDER = {"MORNING": 0, "AFTERNOON": 1, "EVENING": 2}


class ScheduleError(RuntimeError):
    pass


def strip_tags(html: str) -> str:
    return re.sub(r"<[^>]*>", "", html).strip()


def minutes_to_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def parse_visible_table(html: str) -> dict[int, list[dict]]:
    """解析可見的門診時間表 → {weekday: [{session, start, end, doctors}]}"""
    m = re.search(r'<table class="schedule-table.*?</table>', html, re.S)
    if not m:
        raise ScheduleError("找不到 <table class=\"schedule-table\">，官網結構可能已改版")
    table = m.group(0)

    head = re.search(r"<thead>.*?</thead>", table, re.S)
    if not head:
        raise ScheduleError("門診時間表缺少 <thead>")
    headers = [strip_tags(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", head.group(0), re.S)]
    # 第一欄是「時段」，其後依序為星期
    weekdays: list[int] = []
    for label in headers[1:]:
        if label not in WEEKDAY_BY_LABEL:
            raise ScheduleError(f"表頭出現未知的星期：{label!r}")
        weekdays.append(WEEKDAY_BY_LABEL[label])
    if len(weekdays) != 7:
        raise ScheduleError(f"表頭應有 7 個星期，實得 {len(weekdays)} 個")

    body = re.search(r"<tbody>.*?</tbody>", table, re.S)
    if not body:
        raise ScheduleError("門診時間表缺少 <tbody>")

    result: dict[int, list[dict]] = {w: [] for w in weekdays}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body.group(0), re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if not cells:
            continue
        row_label = strip_tags(cells[0]).split()[0][:2]
        session = SESSION_BY_ROW.get(row_label)
        if session is None:
            raise ScheduleError(f"未知的診次列標題：{strip_tags(cells[0])!r}")
        if len(cells) - 1 != len(weekdays):
            raise ScheduleError(
                f"「{row_label}」列有 {len(cells) - 1} 個欄位，與表頭的 {len(weekdays)} 個不符"
            )

        for weekday, cell in zip(weekdays, cells[1:]):
            for group in parse_cell(cell, f"週{weekday} {row_label}"):
                # 明確列出鍵的順序：JSON 是逐字比對的產出檔，
                # 用 **group 展開會把 doctors 排到 start/end 前面，平白製造一整份 diff
                result[weekday].append(
                    {
                        "session": session,
                        "start": group["start"],
                        "end": group["end"],
                        "doctors": group["doctors"],
                    }
                )

    for weekday, slots in result.items():
        result[weekday] = merge_same_span(slots)
    return result


# 一格內的 badge 與時間 <p>，依原始順序取出。
# badge 可能是巢狀的 <span class="badge-green"><span style="…">蔡醫師</span></span>，
# 非貪婪的 (.*?) 會停在內層 </span>，後面的 \s*(?:</span>)? 再把外層吃掉。
CELL_TOKEN_RE = re.compile(
    r'<span class="badge-[^"]*"[^>]*>(?P<badge>.*?)</span>\s*(?:</span>)?'
    r"|<p[^>]*>(?P<para>.*?)</p>",
    re.S,
)
TIME_SPAN_RE = re.compile(r"^\d{2}:\d{2}[–-]\d{2}:\d{2}$")


def parse_cell(cell: str, where: str) -> list[dict]:
    """解析一格 → [{start, end, doctors}]。

    一格可以有多組「badge ＋ 時間」，用來表達**同一診次、不同醫師不同起訖**
    （2026-09-01 起的週一晚診與週日早診就是這種）：

        <span class="badge-green">蔡醫師</span>
        <p …>18:30–21:00</p>
        <span class="badge-green" style="…">李醫師</span>
        <p …>18:30–21:30</p>

    時間歸屬於它前面最近的那個 badge。整格休診（badge 寫「休診」）回傳空 list；
    休診格後面的說明文字（如「※ 晚間有診」）不是時間、會被略過。
    """
    groups: list[dict] = []
    current: dict | None = None

    for m in CELL_TOKEN_RE.finditer(cell):
        if m.group("badge") is not None:
            label = strip_tags(m.group("badge"))
            if not label:
                continue
            if label == "休診":
                current = None
                continue
            doctors = [d.strip() for d in re.split(r"[/／、]", label) if d.strip()]
            doctors = [re.sub(r"醫師$", "", d) for d in doctors]
            current = {"doctors": doctors}
            groups.append(current)
        else:
            text = strip_tags(m.group("para"))
            if not TIME_SPAN_RE.match(text):
                continue
            if current is None:
                raise ScheduleError(f"{where} 的時間「{text}」前面沒有醫師標籤")
            if "start" in current:
                raise ScheduleError(
                    f"{where} 的「{'／'.join(current['doctors'])}」有兩組時間"
                    f"（{current['start']}–{current['end']} 與 {text}）"
                )
            current["start"], current["end"] = re.split(r"[–-]", text)

    if not groups and not re.search(r'<span class="badge-[^"]*"', cell):
        raise ScheduleError(f"{where} 的欄位找不到醫師／休診標籤")
    for g in groups:
        if "start" not in g:
            raise ScheduleError(f"{where} 的「{'／'.join(g['doctors'])}」找不到時間")
    return groups


def merge_same_span(slots: list[dict]) -> list[dict]:
    """同診次且起訖完全相同的組別合併成一筆（醫師併入同一個 doctors 陣列）。

    這樣「蔡／李 同為 18:30–21:30」不論寫成一個 badge 還是兩個 badge，
    產出的 JSON 都一樣，換寫法不會平白製造 diff。
    """
    merged: list[dict] = []
    index: dict[tuple, dict] = {}
    for s in slots:
        key = (s["session"], s["start"], s["end"])
        hit = index.get(key)
        if hit is None:
            hit = dict(s)
            index[key] = hit
            merged.append(hit)
        else:
            for d in s["doctors"]:
                if d not in hit["doctors"]:
                    hit["doctors"].append(d)
    merged.sort(key=lambda s: (SESSION_ORDER[s["session"]], s["start"], s["end"]))
    return merged


def parse_js_ranges(block: str) -> list[dict]:
    """[[480,720,'早診'],…] → [{session,start,end}]"""
    out = []
    for start, end, name in re.findall(r"\[\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\s*\]", block):
        if name not in SESSION_BY_NAME:
            raise ScheduleError(f"SCHEDULE 出現未知診次名稱：{name!r}")
        out.append(
            {
                "session": SESSION_BY_NAME[name],
                "start": minutes_to_time(int(start)),
                "end": minutes_to_time(int(end)),
            }
        )
    out.sort(key=lambda s: SESSION_ORDER[s["session"]])
    return out


def parse_js_schedule(html: str) -> dict[int, list[dict]]:
    m = re.search(r"var SCHEDULE\s*=\s*\{(.*?)\n\s*\};", html, re.S)
    if not m:
        raise ScheduleError("找不到 JS 的 var SCHEDULE（HERO 開診徽章用）")
    result: dict[int, list[dict]] = {}
    for line in m.group(1).splitlines():
        entry = re.match(r"\s*(\d)\s*:\s*(\[.*?\])\s*,?\s*(?://.*)?$", line)
        if entry:
            result[int(entry.group(1))] = parse_js_ranges(entry.group(2))
    if len(result) != 7:
        raise ScheduleError(f"SCHEDULE 應涵蓋 7 天，實得 {sorted(result)}")
    return result


def parse_js_exceptions(html: str) -> dict[str, list[dict]]:
    m = re.search(r"var EXCEPTIONS\s*=\s*\{(.*?)\n\s*\};", html, re.S)
    if not m:
        raise ScheduleError("找不到 JS 的 var EXCEPTIONS（單日特例表）")
    result: dict[str, list[dict]] = {}
    # 外層中括號要整段抓（值是 [[…],[…]] 這種一層巢狀），
    # 用 \[.*?\] 會在第一個 ] 就停住、把當日的第二個診次吃掉
    outer = r"\[(?:[^\[\]]*|\[[^\[\]]*\])*\]"
    for date, block in re.findall(rf"'(\d{{4}}-\d{{2}}-\d{{2}})'\s*:\s*({outer})", m.group(1), re.S):
        result[date] = parse_js_ranges(block)
    return dict(sorted(result.items()))


def session_union(slots: list[dict]) -> list[tuple]:
    """把一天的醫師級時段收斂成診所級時段：同診次取 min(start)、max(end)。

    `SCHEDULE` 常數餵的是 HERO 開診徽章＝「診所這個時間開不開」，
    與哪位醫師無關。所以同診次有兩位醫師不同起訖時（如 2026-09-01 起的
    週一晚診 蔡至 21:00／李至 21:30），要拿**聯集**去跟 SCHEDULE 比，
    逐筆比會誤報。時間是零填補的 HH:MM，字串比大小即等於時間比大小。
    """
    agg: dict[str, list[str]] = {}
    for s in slots:
        cur = agg.get(s["session"])
        if cur is None:
            agg[s["session"]] = [s["start"], s["end"]]
        else:
            cur[0] = min(cur[0], s["start"])
            cur[1] = max(cur[1], s["end"])
    return sorted(
        ((k, v[0], v[1]) for k, v in agg.items()), key=lambda t: SESSION_ORDER[t[0]]
    )


def cross_check(table: dict[int, list[dict]], js: dict[int, list[dict]]) -> list[str]:
    """可見表 vs SCHEDULE 常數逐格比對；兩份是官網自己的副本，本來就該一致"""
    problems = []
    names = ["日", "一", "二", "三", "四", "五", "六"]
    for weekday in range(7):
        a = session_union(table.get(weekday, []))
        b = session_union(js.get(weekday, []))
        if a != b:
            problems.append(
                f"週{names[weekday]}：可見表 {a} ≠ SCHEDULE 常數 {b}"
                "（其中一邊改了、另一邊沒跟上；可見表已收斂成診所級時段再比對）"
            )
    return problems


def build(html: str) -> dict:
    table = parse_visible_table(html)
    js = parse_js_schedule(html)
    problems = cross_check(table, js)
    if problems:
        raise ScheduleError("官網內部不一致：\n  - " + "\n  - ".join(problems))
    return {
        "_comment": "由 internal/tools/sync_schedule.py 從 index.html 產生，請勿手動編輯",
        "weekly": {str(w): table[w] for w in sorted(table)},
        "exceptions": parse_js_exceptions(html),
    }


def _cell(label: str, span: str | None = None, nested: bool = False) -> str:
    inner = f'<span style="font-size: 16px;">{label}</span>' if nested else label
    out = f'<span class="badge-green" style="">{inner}</span>'
    if span:
        out += f'<p class="text-sm text-gray-600 mt-1 font-english">{span}</p>'
    return out


# 2026-09-01 起的新班表夾具：涵蓋兩種「同診次不同醫師不同起訖」的寫法
# （週一晚診、週日早診），以及巢狀 badge、休診格與休診格後的說明文字。
SELFTEST_ROWS = {
    "上午": [
        _cell("蔡醫師", "08:00–12:00"),
        _cell("蔡醫師", "08:00–12:00", nested=True),
        _cell("蔡醫師", "08:00–12:00"),
        _cell("李醫師", "08:00–12:00"),
        _cell("蔡醫師", "08:00–12:00"),
        _cell("蔡醫師", "08:00–11:30"),
        _cell("蔡醫師", "08:00–11:00") + _cell("李醫師", "08:00–11:30"),
    ],
    "下午": [
        _cell("蔡醫師", "14:30–18:00"),
        _cell("蔡醫師", "14:30–18:00"),
        _cell("蔡醫師", "14:30–18:00"),
        _cell("李醫師", "14:30–18:00"),
        _cell("蔡醫師", "14:30–18:00"),
        _cell("李醫師", "14:30–18:00"),
        '<span class="badge-gray">休診</span><p class="text-sm">※ 晚間有診</p>',
    ],
    "晚上": [
        _cell("蔡醫師", "18:30–21:00") + _cell("李醫師", "18:30–21:30"),
        _cell("蔡醫師", "18:30–21:30"),
        _cell("李醫師", "18:30–21:30"),
        _cell("蔡醫師", "18:30–21:30"),
        _cell("蔡醫師", "18:30–21:30"),
        '<span class="badge-gray">休診</span>',
        _cell("蔡醫師", "18:30–21:00"),
    ],
}

SELFTEST_EXPECTED = {
    0: [("MORNING", "08:00", "11:00", ["蔡"]), ("MORNING", "08:00", "11:30", ["李"]),
        ("EVENING", "18:30", "21:00", ["蔡"])],
    1: [("MORNING", "08:00", "12:00", ["蔡"]), ("AFTERNOON", "14:30", "18:00", ["蔡"]),
        ("EVENING", "18:30", "21:00", ["蔡"]), ("EVENING", "18:30", "21:30", ["李"])],
    4: [("MORNING", "08:00", "12:00", ["李"]), ("AFTERNOON", "14:30", "18:00", ["李"]),
        ("EVENING", "18:30", "21:30", ["蔡"])],
    6: [("MORNING", "08:00", "11:30", ["蔡"]), ("AFTERNOON", "14:30", "18:00", ["李"])],
}


def selftest() -> int:
    """驗證解析器吃得下 9/1 新表（不動 index.html）。"""
    days = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
    head = "".join(f"<th>{d}</th>" for d in days)
    body = "".join(
        f"<tr><td>{row}</td>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
        for row, cells in SELFTEST_ROWS.items()
    )
    html = (
        f'<table class="schedule-table"><thead><tr><th>時段</th>{head}</tr></thead>'
        f"<tbody>{body}</tbody></table>"
        "<script>var SCHEDULE = {\n"
        "  1: [[480,720,'早診'],[870,1080,'午診'],[1110,1290,'晚診']],\n"
        "  2: [[480,720,'早診'],[870,1080,'午診'],[1110,1290,'晚診']],\n"
        "  3: [[480,720,'早診'],[870,1080,'午診'],[1110,1290,'晚診']],\n"
        "  4: [[480,720,'早診'],[870,1080,'午診'],[1110,1290,'晚診']],\n"
        "  5: [[480,720,'早診'],[870,1080,'午診'],[1110,1290,'晚診']],\n"
        "  6: [[480,690,'早診'],[870,1080,'午診']],\n"
        "  0: [[480,690,'早診'],[1110,1260,'晚診']]\n"
        "};\nvar EXCEPTIONS = {\n};</script>"
    )

    failures = []
    table = parse_visible_table(html)
    for weekday, expected in SELFTEST_EXPECTED.items():
        got = [(s["session"], s["start"], s["end"], s["doctors"]) for s in table[weekday]]
        if got != expected:
            failures.append(f"週{weekday}：得到 {got}\n           期望 {expected}")

    # 診所級聯集必須仍等於 SCHEDULE（週一晚診 18:30–21:30、週日早診 08:00–11:30）
    problems = cross_check(table, parse_js_schedule(html))
    failures.extend(problems)

    # 負向：時間沒有對應的醫師標籤要報錯，不能默默吞掉
    try:
        parse_cell('<p class="x">18:30–21:00</p>', "負向測試")
    except ScheduleError:
        pass
    else:
        failures.append("負向測試失敗：孤兒時間沒有報錯")

    if failures:
        print("✗ selftest 失敗：\n  - " + "\n  - ".join(failures), file=sys.stderr)
        return 1
    print("✅ selftest 通過（9/1 新表可解析、診所級聯集與 SCHEDULE 一致、負向測試如期報錯）")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="官網門診時間表 → 預約系統班表")
    parser.add_argument("--root", default=".", help="repo 根目錄")
    parser.add_argument("--check", action="store_true", help="只檢查是否同步，不寫檔")
    parser.add_argument(
        "--selftest", action="store_true",
        help="用內建的 2026-09-01 新表夾具驗證解析器（不讀 index.html、不寫檔）",
    )
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    root = Path(args.root).resolve()
    source = root / "index.html"
    target = root / "booking-system" / "prisma" / "schedule.json"
    if not source.exists():
        print(f"✗ 找不到 {source}", file=sys.stderr)
        return 2

    try:
        data = build(source.read_text(encoding="utf-8"))
    except ScheduleError as e:
        print(f"✗ 解析官網門診時間表失敗：{e}", file=sys.stderr)
        return 2

    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        if not target.exists():
            print(f"✗ 尚未產生 {target.relative_to(root)}，請執行不帶 --check 的同一指令", file=sys.stderr)
            return 1
        if target.read_text(encoding="utf-8") != rendered:
            print(
                "✗ 預約系統班表與官網不同步。\n"
                "  官網門診時間表已變更，請執行：\n"
                "    python3 internal/tools/sync_schedule.py\n"
                "  再將產生的 booking-system/prisma/schedule.json 一併提交；\n"
                "  已上線的系統另需執行 npx tsx scripts/sync-schedule.ts 套用到資料庫。",
                file=sys.stderr,
            )
            return 1
        print("✅ 預約系統班表與官網一致")
        return 0

    changed = not target.exists() or target.read_text(encoding="utf-8") != rendered
    target.write_text(rendered, encoding="utf-8")
    counts = {w: len(v) for w, v in data["weekly"].items()}
    print(f"{'✅ 已更新' if changed else '✅ 已是最新'} {target.relative_to(root)}")
    print(f"   週班表診次數（0=日…6=六）：{counts}")
    print(f"   單日特例：{len(data['exceptions'])} 筆")
    if changed:
        print("   ⚠️ 已上線的系統需另外執行：npx tsx scripts/sync-schedule.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
