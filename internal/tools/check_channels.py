#!/usr/bin/env python3
"""
官網 ↔ LINE ↔ iOS App ↔ 預約系統：一條指令跑完所有跨系統比對（只檢查、不寫檔）。

為什麼需要這支工具
------------------
官網是唯一事實來源，另外三套系統各有自己的同步工具與測試，分散在三個地方、
提醒散在 `00` 各批紀錄裡。官網改了一處，要記得哪幾套系統得重跑什麼，全靠記憶。
本工具把既有的檢查串起來，再補上原本沒有人盯的「系統彼此之間」的事實
（電話、地址、LINE 帳號、醫師分流句、掛號入口是否三邊同一套）。

    python3 internal/tools/check_channels.py                 # App repo 預設找 ../lihsin-app
    python3 internal/tools/check_channels.py --app <路徑>     # 指定 App repo
    python3 internal/tools/check_channels.py --booking-tests  # 加跑預約系統 Vitest（需 node_modules 與測試用 PostgreSQL）

結束碼 0＝沒有 ✗；1＝有 ✗。「－」是略過（缺 repo 或缺環境），不算失敗但要在交付說明寫明。
各項不同步時該跑什麼，見 `.claude/skills/assistant-sync/SKILL.md`〈跨系統對照表〉。
"""

from __future__ import annotations

import argparse
import filecmp
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHONE_DIGITS = "062516086"
ADDRESS = "台南市北區育德路467號"
LINE_OA = "@lhpedclinic"

results: list[tuple[str, str, str]] = []  # (mark, name, detail)


def record(ok: bool | None, name: str, detail: str = "") -> None:
    results.append(("－" if ok is None else "✓" if ok else "✗", name, detail))


def run(name: str, cmd: list[str], cwd: Path = ROOT, timeout: int = 900) -> bool:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        record(False, name, str(e))
        return False
    lines = [x.strip() for x in (p.stdout if p.stdout.strip() else p.stderr).splitlines() if x.strip()]
    record(p.returncode == 0, name, (lines[-1] if lines else "")[:160])
    return p.returncode == 0


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def check_site() -> None:
    py = sys.executable
    run("官網班表 → 預約系統／公開 schedule.json", [py, "internal/tools/sync_schedule.py", "--check"])
    run("官網 ↔ LINE 小幫手（題庫、分流、回答一致）", [py, "internal/tools/sync_assistants.py", "--check"])
    run("官網就診事實（公告效期、停打時間）", [py, "internal/tools/check_visit_facts.py"])


def check_facts(app: Path | None) -> None:
    """電話、地址、LINE 帳號：四處各寫一份，沒有工具盯過彼此。"""
    sources: dict[str, str] = {
        "預約系統 clinic-info.ts": read(ROOT / "booking-system/src/lib/clinic-info.ts"),
        "LINE 卡片 legacy_messages.json": json.dumps(
            json.loads(read(ROOT / "internal/line-helpdesk/legacy_messages.json")), ensure_ascii=False
        ),
    }
    if app:
        sources["App ClinicLinks.swift"] = read(app / "LihsinClinic/ClinicLinks.swift")
    bad = []
    for name, text in sources.items():
        if PHONE_DIGITS not in digits(text) and "88662516086" not in digits(text):
            bad.append(f"{name} 找不到電話 06-2516086")
        if ADDRESS not in squash(text):
            bad.append(f"{name} 找不到地址 {ADDRESS}")
    for name in ("預約系統 clinic-info.ts", "App ClinicLinks.swift"):
        if name in sources and LINE_OA not in sources[name]:
            bad.append(f"{name} 的 LINE 加好友連結不是 {LINE_OA}")
    record(not bad, "電話／地址／LINE 帳號四處一致", "；".join(bad))


def check_doctor_guide() -> None:
    """「這些狀況可以找我」：官網 services/index.html 是原文，LINE 醫師卡與預約系統選醫師步驟逐字引用。
    預約系統 ↔ 官網由 website-parity 測試盯（含「不限醫師」那句的句尾差異）；這裡補 LINE 醫師卡這一邊。"""
    site = squash(re.sub(r"<[^>]+>", "", read(ROOT / "services/index.html")))
    ts = read(ROOT / "booking-system/src/lib/clinic-notes.ts")
    block = ts[ts.index("export const DOCTOR_GUIDE") :]
    block = block[block.index("byName") : block.index("}", block.index("byName"))]
    sentences = re.findall(r':\s*"([^"]+)"', block)
    line = json.dumps(json.loads(read(ROOT / "internal/line-helpdesk/legacy_messages.json")), ensure_ascii=False)
    bad = []
    for s in sentences:
        if squash(s) not in site:
            bad.append(f"預約系統「{s[:12]}…」不在官網原文")
        if s not in line:
            bad.append(f"LINE 醫師卡沒有「{s[:12]}…」")
    record(bool(sentences) and not bad, "醫師分流句：官網＝LINE 醫師卡＝預約系統", "；".join(bad) or f"{len(sentences)} 句")


def check_booking_entry(app: Path | None) -> None:
    """掛號入口要三邊同一套（全 BookNow 或全自建）；切換日最容易漏一邊。"""
    own = "booking.lhpedclinic.com.tw"
    state: dict[str, str] = {}
    site = read(ROOT / "index.html")
    state["官網首頁"] = "自建" if own in site else "BookNow" if "booknow.com.tw" in site else "?"
    menu = read(ROOT / "internal/line-oa/current/line_menu_clinic_ready.py")
    state["LINE 圖文選單"] = "自建" if own in menu else "BookNow" if "liff.line.me/2005432137" in menu else "?"
    if app:
        m = re.search(r"static let booking = URL\(string: \"([^\"]+)\"", read(app / "LihsinClinic/ClinicLinks.swift"))
        url = m.group(1) if m else ""
        state["App"] = "自建" if own in url else "BookNow" if "booknow" in url else "?"
    kinds = set(state.values())
    record(
        len(kinds) == 1 and "?" not in kinds,
        "線上掛號入口三邊同一套",
        "、".join(f"{k}＝{v}" for k, v in state.items()),
    )


def check_app(app: Path | None) -> None:
    if not app:
        record(None, "iOS App 內附資料與離線頁", "找不到 App repo（--app 指定路徑；沒有就略過）")
        return
    # 產生器會寫檔：複製到暫存資料夾重產，再跟 repo 內的版本比，不動工作目錄
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "app"
        shutil.copytree(app, work, ignore=shutil.ignore_patterns(".git", "*.xcodeproj", "build"))
        for name in ("schedule.json", "notices.json"):
            shutil.copy(ROOT / "notices" / name, work / "LihsinClinic/Resources" / name)
        ok = True
        for script in ("build_site_index.py", "build_offline_site.py"):
            p = subprocess.run(
                [sys.executable, f"scripts/{script}", str(ROOT)], cwd=work, capture_output=True, text=True
            )
            if p.returncode != 0:
                record(False, f"iOS App {script}", (p.stdout + p.stderr).strip().splitlines()[-1][:160])
                ok = False
        if not ok:
            return
        stale = []
        for sub in ("LihsinClinic/Resources", "OfflineSite"):
            stale += _diff(app / sub, work / sub, sub)
        record(
            not stale,
            "iOS App 內附資料與離線頁＝官網現況",
            ("要重跑 App README 的同步指令：" + "、".join(stale[:6]) + ("…" if len(stale) > 6 else "")) if stale else "",
        )
    run("iOS App 內附 JSON 格式", [sys.executable, "scripts/check_bundled_json.py"], cwd=app)


def _diff(a: Path, b: Path, prefix: str) -> list[str]:
    cmp = filecmp.dircmp(a, b)
    out = [f"{prefix}/{n}" for n in cmp.left_only + cmp.right_only]
    _, mismatch, errors = filecmp.cmpfiles(a, b, cmp.common_files, shallow=False)
    out += [f"{prefix}/{n}" for n in mismatch + errors]
    for d in cmp.common_dirs:
        out += _diff(a / d, b / d, f"{prefix}/{d}")
    return out


def check_booking_tests(enabled: bool) -> None:
    name = "預約系統 Vitest（含官網比對 website-parity、班表同步）"
    if not enabled:
        record(None, name, "未加 --booking-tests")
        return
    if not (ROOT / "booking-system/node_modules").exists():
        record(None, name, "booking-system 尚未 npm ci")
        return
    run(name, ["npx", "vitest", "run"], cwd=ROOT / "booking-system", timeout=1800)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", default=str(ROOT.parent / "lihsin-app"), help="iOS App repo 路徑")
    ap.add_argument("--booking-tests", action="store_true", help="加跑預約系統 Vitest")
    args = ap.parse_args()
    app = Path(args.app)
    app = app if (app / "LihsinClinic/ClinicLinks.swift").exists() else None

    check_site()
    check_facts(app)
    check_doctor_guide()
    check_booking_entry(app)
    check_app(app)
    check_booking_tests(args.booking_tests)

    print("── 官網 ↔ LINE ↔ iOS App ↔ 預約系統 ──")
    for mark, name, detail in results:
        print(f"{mark} {name}" + (f"：{detail}" if detail else ""))
    failed = sum(1 for m, _, _ in results if m == "✗")
    skipped = sum(1 for m, _, _ in results if m == "－")
    print(f"\n結論：{'✅ 全部一致' if not failed else f'❌ {failed} 項不一致'}" + (f"（略過 {skipped} 項）" if skipped else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
