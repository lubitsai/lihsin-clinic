#!/usr/bin/env python3
"""員工敏感資料閘門（2026-11-14 院長裁示）。

本 repo 在 GitHub 是公開的。員工個資、薪資、出勤、人事事件一律只放私人 repo
lhclinic-work，任何分支都不得提交。本腳本在 CI（.github/workflows/staff-data-gate.yml）
與本機都可執行：

  python3 internal/tools/check_staff_data.py --all              # 掃整棵追蹤中的樹
  python3 internal/tools/check_staff_data.py --range BASE HEAD  # 只掃這批新增的檔名與新增行

規則：
  1. 檔名：Office 檔（xlsx/docx…）一律擋；檔名含薪資、出勤、人事類字詞也擋。
  2. 內容：文字檔出現薪資單／人事事件專用詞就擋。二進位檔（圖片、PDF）不看內容，
     截圖與掃描檔擋不住，提交前仍要自己確認。
逃生門：確定不是員工資料的單行（例如法規說明），在同一行加 `staff-data-ok`。
注意：push 後才跑的 CI 只能「發現」，資料已經上了公開 GitHub；發現就要刪分支或改寫歷史。
"""
import re
import subprocess
import sys

SELF_EXEMPT = {
    "internal/tools/check_staff_data.py",
    ".github/workflows/staff-data-gate.yml",
    "CLAUDE.md",  # 規則本文會提到這些字詞
}

OFFICE_EXT = re.compile(r"\.(xlsx|xlsm|xls|docx|doc|ods|odt|numbers|pages)$", re.I)
NAME_RX = re.compile(
    r"薪|工資|出勤|打卡|班表|排班|人事|資遣|離職|勞資|特休|加班|勞健保|生日|"
    r"payroll|salary|salaries|timesheet|attendance|employee|personnel", re.I)
CONTENT_RX = re.compile(
    r"薪資發放|薪資單|薪資明細|薪資表|底薪|本薪|投保薪資|投保金額|勞保自付|健保自付|"
    r"勞退提繳|勞退自提|加班費|加班時數|特休未休|特別休假|資遣|離職證明|打卡紀錄|打卡卡|"
    r"出勤紀錄|出勤表|勞資會議|績效獎金|(?<![A-Za-z])PPF(?![A-Za-z])")
ALLOW = "staff-data-ok"


def git(*args):
    # quotepath=off：中文路徑不跳脫，diff 的 +++ b/路徑 才解析得到
    return subprocess.run(["git", "-c", "core.quotepath=off", *args],
                          capture_output=True, check=True).stdout


def is_binary(data: bytes) -> bool:
    return b"\x00" in data[:8192]


def check_name(path, problems):
    if path in SELF_EXEMPT:
        return
    if OFFICE_EXT.search(path):
        problems.append(f"{path}: Office 檔不放公開 repo")
    elif NAME_RX.search(path.rsplit("/", 1)[-1]):
        problems.append(f"{path}: 檔名像員工／人事資料")


def check_lines(path, lines, problems):
    if path in SELF_EXEMPT:
        return
    for no, line in lines:
        if ALLOW in line:
            continue
        m = CONTENT_RX.search(line)
        if m:
            where = f"{path}:{no}" if no else path
            problems.append(f"{where}: 出現「{m.group(0)}」")


def scan_all(problems):
    for path in git("ls-files", "-z").decode("utf-8").split("\0"):
        if not path:
            continue
        check_name(path, problems)
        try:
            data = open(path, "rb").read()
        except OSError:
            continue
        if not is_binary(data):
            text = data.decode("utf-8", "replace")
            check_lines(path, enumerate(text.splitlines(), 1), problems)


def scan_range(base, head, problems):
    # 新增或改名進來的檔案（含中途新增又刪掉的，所以逐 commit 看）
    out = git("log", "--format=", "--name-only", "--diff-filter=AR", "-z",
              f"{base}..{head}").decode("utf-8")
    for path in sorted(set(p.strip("\n") for p in out.split("\0") if p.strip("\n"))):
        check_name(path, problems)
    # 每個 commit 的新增行
    patch = git("log", "-p", "--format=", "--no-color", "--text", "-U0",
                f"{base}..{head}").decode("utf-8", "replace")
    path, added = None, []
    for line in patch.splitlines():
        if line.startswith("+++ "):
            if path and added:
                check_lines(path, added, problems)
            p = line[4:]
            path = p[2:] if p.startswith("b/") else None
            added = []
        elif line.startswith("+") and path:
            added.append((0, line[1:]))
    if path and added:
        check_lines(path, added, problems)


def main():
    args = sys.argv[1:]
    problems = []
    if args == ["--all"]:
        scan_all(problems)
    elif len(args) == 3 and args[0] == "--range":
        scan_range(args[1], args[2], problems)
    else:
        sys.exit(__doc__)
    problems = sorted(set(problems))
    if problems:
        print("✗ 疑似員工敏感資料（本 repo 是公開的，這類資料只放私人 repo lhclinic-work）：")
        for p in problems:
            print("  -", p)
        print(f"\n確定不是員工資料的單行，在該行加 `{ALLOW}` 後重推。")
        sys.exit(1)
    print("✓ 未發現員工敏感資料")


if __name__ == "__main__":
    main()
