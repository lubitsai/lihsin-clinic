#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_members.py — 減重營養課「學員專區」（/members/nutrition/）的加密工具

院長 2026-11-09 裁示：影片與教材 PDF 只給參加八堂課付費減重課程的學員，
官網放一個「輸入密碼才看得到」的專區（純前端密碼，院長知悉其限制）。

加密設計（兩層，換密碼不必重新加密 PDF）：
  • 內容金鑰 K（隨機 32 bytes）：AES-256-GCM 加密每份教材 PDF →
      members/nutrition/files/NN.bin（12 bytes nonce ＋ 密文）
  • 密碼 → PBKDF2-SHA256（600,000 次）→ 包裝金鑰：AES-GCM 加密
      {"k": K, "v": {"1": YouTube ID, ...}} → 寫進 index.html 的
      <script id="vault" type="application/json">。
  網頁原始碼裡沒有密碼、沒有 K、沒有影片 ID；K 與影片 ID 只存在 vault 密文裡，
  repo 任何地方都沒有明文。要改內容就得先用舊密碼解開 vault。

限制（已向院長說明）：學員把密碼或 YouTube 連結轉出去，拿到的人就能看。
每梯換一次密碼可以擋掉舊學員。

用法：
  # 第一次建立（產生新的 K，加密 8 份 PDF）
  python3 internal/tools/build_members.py --password 新密碼 --pdf-dir <含 01_教材.pdf…08_教材.pdf 的資料夾>

  # 換密碼（K 與影片沿用；PDF 不必重做）
  python3 internal/tools/build_members.py --old-password 舊密碼 --password 新密碼

  # 填影片（YouTube「不公開」影片的網址或 ID；可一次給多個）
  python3 internal/tools/build_members.py --old-password 密碼 --password 密碼 \\
      --video 1=https://youtu.be/XXXXXXXXXXX --video 2=YYYYYYYYYYY

  # 只檢查：用密碼解開 vault，列出影片設定與 PDF 能否解密
  python3 internal/tools/build_members.py --check --password 密碼

需要 Python 套件 cryptography（pip install cryptography）。
"""
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "members" / "nutrition" / "index.html"
FILES = ROOT / "members" / "nutrition" / "files"
ITERATIONS = 600_000
LESSONS = 8
VAULT_RE = re.compile(r'(<script id="vault" type="application/json">)(.*?)(</script>)', re.S)
YT_RE = re.compile(r'(?:youtu\.be/|[?&]v=|/embed/|/shorts/|/live/)?([A-Za-z0-9_-]{11})(?:[?&#].*)?$')

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


def wrap_key(password, salt):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def read_vault():
    m = VAULT_RE.search(PAGE.read_text(encoding="utf-8"))
    if not m:
        sys.exit(f"✗ {PAGE.relative_to(ROOT)} 找不到 vault 區塊")
    return json.loads(m.group(2)) if m.group(2).strip() else None


def open_vault(vault, password):
    key = wrap_key(password, unb64(vault["salt"]))
    try:
        plain = AESGCM(key).decrypt(unb64(vault["iv"]), unb64(vault["ct"]), None)
    except Exception:
        sys.exit("✗ 密碼錯誤，解不開目前的 vault")
    return json.loads(plain)


def write_vault(payload, password):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(wrap_key(password, salt)).encrypt(iv, json.dumps(payload, separators=(",", ":")).encode(), None)
    vault = {"kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}
    s = PAGE.read_text(encoding="utf-8")
    s = VAULT_RE.sub(lambda m: m.group(1) + json.dumps(vault) + m.group(3), s, count=1)
    PAGE.write_text(s, encoding="utf-8")


def youtube_id(text):
    m = YT_RE.search(text.strip())
    if not m:
        sys.exit(f"✗ 看不出 YouTube 影片 ID：{text}")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--password", required=True, help="新密碼（--check 時為目前密碼）")
    ap.add_argument("--old-password", help="目前密碼；vault 已存在時必填")
    ap.add_argument("--pdf-dir", type=Path, help="重新加密教材 PDF（01_教材.pdf～08_教材.pdf）")
    ap.add_argument("--video", action="append", default=[], metavar="N=URL", help="設定第 N 堂影片")
    ap.add_argument("--check", action="store_true", help="只檢查，不寫檔")
    a = ap.parse_args()

    vault = read_vault()
    if a.check:
        if not vault:
            sys.exit("✗ vault 是空的，尚未建立")
        p = open_vault(vault, a.password)
        k = unb64(p["k"])
        for n in range(1, LESSONS + 1):
            f = FILES / f"{n:02d}.bin"
            ok = "—"
            if f.exists():
                raw = f.read_bytes()
                ok = "PDF 可解密" if AESGCM(k).decrypt(raw[:12], raw[12:], None)[:5] == b"%PDF-" else "✗ 不是 PDF"
            print(f"第{n}堂  影片：{p['v'].get(str(n)) or '（未設定）'}  教材：{ok}")
        return

    if vault:
        if not a.old_password:
            sys.exit("✗ vault 已存在：請用 --old-password 給目前密碼（換密碼、填影片都要）")
        payload = open_vault(vault, a.old_password)
    else:
        if not a.pdf_dir:
            sys.exit("✗ 第一次建立請給 --pdf-dir")
        payload = {"k": b64(os.urandom(32)), "v": {}}

    if len(a.password) < 8:
        sys.exit("✗ 密碼至少 8 個字元")

    for item in a.video:
        n, _, url = item.partition("=")
        if not n.isdigit() or not 1 <= int(n) <= LESSONS:
            sys.exit(f"✗ --video 格式是 N=網址（N 為 1～{LESSONS}）：{item}")
        payload["v"][n] = youtube_id(url)
        print(f"第{n}堂影片 → {payload['v'][n]}")

    if a.pdf_dir:
        k = unb64(payload["k"])
        FILES.mkdir(parents=True, exist_ok=True)
        for n in range(1, LESSONS + 1):
            src = a.pdf_dir / f"{n:02d}_教材.pdf"
            if not src.exists():
                sys.exit(f"✗ 找不到 {src}")
            nonce = os.urandom(12)
            (FILES / f"{n:02d}.bin").write_bytes(nonce + AESGCM(k).encrypt(nonce, src.read_bytes(), None))
            print(f"第{n}堂教材 → members/nutrition/files/{n:02d}.bin")

    write_vault(payload, a.password)
    print("✓ vault 已寫入 members/nutrition/index.html")


if __name__ == "__main__":
    main()
