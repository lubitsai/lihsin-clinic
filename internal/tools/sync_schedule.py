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
            badge = re.search(r'<span class="badge-[^"]*"[^>]*>(.*?)</span>\s*(?:</span>)?', cell, re.S)
            label = strip_tags(badge.group(1)) if badge else ""
            if not label:
                raise ScheduleError(f"週{weekday} {row_label} 的欄位找不到醫師／休診標籤")
            if label == "休診":
                continue

            doctors = [d.strip() for d in re.split(r"[/／、]", label) if d.strip()]
            doctors = [re.sub(r"醫師$", "", d) for d in doctors]

            time_texts = [strip_tags(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", cell, re.S)]
            span = next((t for t in time_texts if re.match(r"^\d{2}:\d{2}[–-]\d{2}:\d{2}$", t)), None)
            if span is None:
                raise ScheduleError(f"週{weekday} {row_label} 的欄位找不到時間（{time_texts!r}）")
            start, end = re.split(r"[–-]", span)
            result[weekday].append(
                {"session": session, "start": start, "end": end, "doctors": doctors}
            )

    for slots in result.values():
        slots.sort(key=lambda s: SESSION_ORDER[s["session"]])
    return result


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


def cross_check(table: dict[int, list[dict]], js: dict[int, list[dict]]) -> list[str]:
    """可見表 vs SCHEDULE 常數逐格比對；兩份是官網自己的副本，本來就該一致"""
    problems = []
    names = ["日", "一", "二", "三", "四", "五", "六"]
    for weekday in range(7):
        a = [(s["session"], s["start"], s["end"]) for s in table.get(weekday, [])]
        b = [(s["session"], s["start"], s["end"]) for s in js.get(weekday, [])]
        if a != b:
            problems.append(
                f"週{names[weekday]}：可見表 {a} ≠ SCHEDULE 常數 {b}"
                "（其中一邊改了、另一邊沒跟上）"
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


def main() -> int:
    parser = argparse.ArgumentParser(description="官網門診時間表 → 預約系統班表")
    parser.add_argument("--root", default=".", help="repo 根目錄")
    parser.add_argument("--check", action="store_true", help="只檢查是否同步，不寫檔")
    args = parser.parse_args()

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
