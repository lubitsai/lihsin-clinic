#!/usr/bin/env python3
"""PostToolUse hook：改到首頁 index.html 後，自動重產班表（院長 2026-09-28 裁示「請自動跑」）。

為什麼要自動：門診異動（連假、颱風、臨時停診）改的是 index.html 的門診時間表或 EXCEPTIONS，
但假日小兒科頁「今天、本週六、本週日有沒有門診？」卡讀的是 notices/schedule.json、
預約系統讀 booking-system/prisma/schedule.json——兩份都由 sync_schedule.py 產生，漏跑就會把休診日說成有看診。

觸發：Edit／Write／MultiEdit 的目標是 repo 根目錄 index.html；或 Bash 指令字串裡出現 index.html
（本 repo 常用 python／sed 改檔，只掛 Edit 會漏）。先跑 --check（約 0.05 秒），不同步才重產，
所以與門診表無關的首頁修改不會產生任何變更。
不會 commit：重產的檔案留在工作區，由當批一起提交（validate_site.py 的 E-SCHEDULE 仍是 push 前的最後防線）。
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "internal" / "tools" / "sync_schedule.py"


def touches_index(payload: dict) -> bool:
    name = payload.get("tool_name", "")
    ti = payload.get("tool_input") or {}
    if name in ("Edit", "Write", "MultiEdit"):
        fp = ti.get("file_path") or ""
        try:
            return Path(fp).resolve() == ROOT / "index.html"
        except OSError:
            return False
    if name == "Bash":
        return "index.html" in (ti.get("command") or "")
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    if not touches_index(payload) or not TOOL.exists():
        return 0
    run = lambda *a: subprocess.run([sys.executable, str(TOOL), *a], cwd=ROOT, capture_output=True, text=True)
    chk = run("--check")
    if chk.returncode == 0:
        return 0
    if chk.returncode == 1:
        gen = run()
        if gen.returncode == 0:
            msg = ("門診時間表有變 → 已自動執行 sync_schedule.py，重產 notices/schedule.json 與 "
                   "booking-system/prisma/schedule.json（請隨本批一起 commit）。")
            ctx = (msg + "\n" + gen.stdout.strip() +
                   "\n提醒：門診異動另需 build_assistant_kb.py（小幫手）與 validate_site.py；"
                   "已上線的預約系統另需在主機跑 npx tsx scripts/sync-schedule.ts。")
        else:
            msg = "sync_schedule.py 自動重產失敗，請手動處理。"
            ctx = msg + "\n" + (gen.stderr or gen.stdout).strip()
    else:
        # exit 2＝首頁門診表解析失敗（可見表與 SCHEDULE 不一致等），多半是改到一半，交給 Claude 判斷
        msg = "sync_schedule.py：首頁門診時間表目前無法解析，班表未重產。"
        ctx = msg + "\n" + (chk.stderr or chk.stdout).strip()
    print(json.dumps({"systemMessage": msg,
                      "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": ctx}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
