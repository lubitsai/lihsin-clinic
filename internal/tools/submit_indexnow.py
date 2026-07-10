#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
submit_indexnow.py — 立欣診所 IndexNow 批次提交 v1.0（2026-07-10）
====================================================================
讀取 repo 的 sitemap.xml 與根目錄金鑰檔，把全部可索引頁一次 POST 給
api.indexnow.org（IndexNow 協定會自動分享給所有參與的搜尋引擎）。

用途：部署 SOP 的固定收尾步驟之一（00 §7）。內容實質變更的批次
上線後執行；純技術層批次（href、schema class 等）不需執行。

用法：
  python3 internal/tools/submit_indexnow.py [--root .] [--dry]

  --dry  只列出將提交的 payload，不實際送出。

環境需求：執行環境的網路政策須允許 api.indexnow.org
（Claude Code 環境設定 → Network access → Custom → Allowed domains；
 政策在 session 啟動時套用，session 中途改設定不會生效——需開新 session）。
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SITE_ORIGIN = "https://lhpedclinic.com.tw"
KEY = "631da727697dc88a64a8f0b76042c891"   # 00 §1；金鑰檔在 repo 根目錄
ENDPOINT = "https://api.indexnow.org/indexnow"
NON_PAGE_SUFFIXES = (".jpg", ".png", ".webp", ".pdf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    root = Path(args.root).resolve()

    keyfile = root / f"{KEY}.txt"
    if not keyfile.exists() or keyfile.read_text(encoding="utf-8").strip() != KEY:
        sys.exit(f"❌ 金鑰檔缺失或內容不符：{keyfile}")

    tree = ET.parse(root / "sitemap.xml")
    locs = [e.text.strip() for e in tree.iter()
            if e.tag.endswith("}loc") and e.text]
    seen = set()
    pages = [u for u in locs
             if not u.endswith(NON_PAGE_SUFFIXES)
             and not (u in seen or seen.add(u))]
    if not pages:
        sys.exit("❌ sitemap 未解析出任何頁面 URL")

    payload = {
        "host": "lhpedclinic.com.tw",
        "key": KEY,
        "keyLocation": f"{SITE_ORIGIN}/{KEY}.txt",
        "urlList": pages,
    }
    print(f"將提交 {len(pages)} 條 URL 至 {ENDPOINT}")
    if args.dry:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        return

    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = r.status in (200, 202)
            print(f"HTTP {r.status} — {'✅ 提交成功' if ok else '⚠️ 非預期狀態，請人工確認'}")
            sys.exit(0 if ok else 1)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        sys.exit(f"❌ HTTP {e.code}：{body}")
    except Exception as e:
        sys.exit(f"❌ 連線失敗：{e}\n"
                 "（若為 CONNECT 403＝執行環境網路政策未放行 api.indexnow.org，"
                 "或政策是在本 session 啟動後才修改——請開新 session 再跑。）")


if __name__ == "__main__":
    main()
