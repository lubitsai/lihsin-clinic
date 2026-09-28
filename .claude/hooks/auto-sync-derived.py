#!/usr/bin/env python3
"""PostToolUse hook：改到網站頁面或知識庫正本後，自動重產衍生檔（院長 2026-09-28 裁示「請自動跑」「小幫手也請一起自動跑」）。

三段依序檢查，每段先 --check，不同步才重產（全部同步時合計約 0.5 秒、零變更）：
  1. sync_schedule.py       index.html 門診時間表 → notices/schedule.json、booking-system/prisma/schedule.json
  2. build_chatbot_kb.py    全站 FAQ 結構化資料 → 知識庫正本的 Q&A 標記區（標記區外的手寫內容不動）
  3. build_assistant_kb.py  知識庫正本＋首頁門診時間＋頁面標題 → clinic-assistant/knowledge.json（線上小幫手）
     重產後跑 test_assistant.mjs；測試失敗會回報，不回滾。
順序有依賴：2 改了正本，3 才會看到新題目。

觸發：Edit／Write／MultiEdit 的目標是對外 .html（排除 booking-system／archive／internal）或知識庫正本；
或 Bash 指令字串含 .html／知識庫正本檔名（本 repo 常用 python／sed 改檔，只掛 Edit 會漏）。
不 commit：重產的檔案留在工作區，隨本批一起提交；validate_site.py（E-SCHEDULE／E-ASSISTANT）仍是 push 前的最後防線。
不涵蓋：預約系統主機的 npx tsx scripts/sync-schedule.ts（要登入主機）；Codex／GitHub 網頁改檔不觸發。
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "internal" / "tools"
KB_GLOB = "AI客服知識庫_立欣診所_正本_*.md"
SKIP = ("booking-system", "archive", "internal", "node_modules")


def latest_kb():
    found = sorted((ROOT / "internal").glob(KB_GLOB))
    return found[-1] if found else None


def relevant(payload: dict) -> bool:
    name = payload.get("tool_name", "")
    ti = payload.get("tool_input") or {}
    if name in ("Edit", "Write", "MultiEdit"):
        try:
            p = Path(ti.get("file_path") or "").resolve()
            rel = p.relative_to(ROOT)
        except (OSError, ValueError):
            return False
        if p.suffix == ".html":
            return rel.parts[0] not in SKIP
        return p.match(KB_GLOB)
    if name == "Bash":
        cmd = ti.get("command") or ""
        return ".html" in cmd or "AI客服知識庫" in cmd
    return False


def run(*args):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True, text=True)


def step(label, check_cmd, gen_cmd, notes, after=None):
    """回傳 True 表示本段有重產（或出錯），訊息寫進 notes。"""
    chk = run(*check_cmd)
    if chk.returncode == 0:
        return False
    gen = run(*gen_cmd)
    if gen.returncode != 0:
        notes.append(f"✗ {label} 自動重產失敗，請手動處理：\n{(gen.stderr or gen.stdout).strip()[-800:]}")
        return True
    line = f"✓ {label} 已自動重產"
    if after:
        t = run(*after)
        tail = (t.stdout or t.stderr).strip().splitlines()[-1:] or [""]
        line += f"；測試{'通過' if t.returncode == 0 else '失敗 ✗'}：{tail[0]}"
    notes.append(line)
    return True


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    if not relevant(payload):
        return 0
    py = sys.executable
    notes = []
    if (TOOLS / "sync_schedule.py").exists():
        chk = run(py, str(TOOLS / "sync_schedule.py"), "--check")
        if chk.returncode == 1:
            step("門診班表（notices/schedule.json、booking-system/prisma/schedule.json）",
                 [py, str(TOOLS / "sync_schedule.py"), "--check"], [py, str(TOOLS / "sync_schedule.py")], notes)
            notes.append("  ⚠️ 已上線的預約系統另需在主機跑 npx tsx scripts/sync-schedule.ts")
        elif chk.returncode == 2:
            # 首頁門診表解析失敗（多半是改到一半），後面兩段也會讀它，全部跳過交給 Claude 判斷
            notes.append("✗ 首頁門診時間表目前無法解析，班表與小幫手皆未重產：\n" + (chk.stderr or chk.stdout).strip()[-800:])
            return report(notes)
    kb = latest_kb()
    if kb and (TOOLS / "build_chatbot_kb.py").exists():
        step(f"知識庫正本 Q&A 區（{kb.name}）",
             [py, str(TOOLS / "build_chatbot_kb.py"), "--kb", str(kb), "--check"],
             [py, str(TOOLS / "build_chatbot_kb.py"), "--kb", str(kb)], notes)
    if (TOOLS / "build_assistant_kb.py").exists():
        test = ["node", str(TOOLS / "test_assistant.mjs")] if (TOOLS / "test_assistant.mjs").exists() else None
        step("線上小幫手 clinic-assistant/knowledge.json",
             [py, str(TOOLS / "build_assistant_kb.py"), "--check"],
             [py, str(TOOLS / "build_assistant_kb.py")], notes, after=test)
    return report(notes)


def report(notes) -> int:
    if not notes:
        return 0
    msg = "衍生檔自動同步：\n" + "\n".join(notes) + "\n（重產的檔案請隨本批一起 commit）"
    print(json.dumps({"systemMessage": msg,
                      "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
