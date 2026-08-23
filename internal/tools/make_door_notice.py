#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_door_notice.py — 把門診異動公告圖排成診所門口張貼用的 A4 PDF。

用途：五載體同步清單第 ⑥ 項（診所門口實體公告）。院長貼來的公告圖是正方形、
給網路看的；門口那張要能列印、要遠看得清楚，所以另外排一張 A4。

刻意不加任何文字：公告圖上已經有全部資訊（日期、時段、診所名），
在這裡另寫字＝新增未經核可的可見文字，且與網路版會有對不齊的風險。

用法：
  python3 internal/tools/make_door_notice.py images/notice/clinic-notice-20260823b.jpg
  python3 internal/tools/make_door_notice.py <來源圖> [-o 輸出.pdf] [--landscape] [--dpi 300]

輸出預設放 internal/print/（由 _redirects 擋在站外，不會被公開部署）。
列印時選「實際大小 / 100%」，不要選「配合頁面縮放」。
"""
import argparse
import subprocess
import sys
from pathlib import Path

A4_MM = (210.0, 297.0)
MARGIN_MM = 10.0  # 四邊留白，一般印表機的不可列印區約 5mm


def ensure_pillow():
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "Pillow"], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="公告圖（jpg/png/webp）")
    ap.add_argument("-o", "--out", default=None, help="輸出 PDF 路徑")
    ap.add_argument("--landscape", action="store_true", help="橫式 A4（正方形圖通常直式較大）")
    ap.add_argument("--dpi", type=int, default=300)
    args = ap.parse_args()

    ensure_pillow()
    from PIL import Image

    src = Path(args.src)
    out = Path(args.out) if args.out else Path("internal/print") / (src.stem + "-A4.pdf")
    out.parent.mkdir(parents=True, exist_ok=True)

    w_mm, h_mm = (A4_MM[1], A4_MM[0]) if args.landscape else A4_MM
    px = lambda mm: int(round(mm / 25.4 * args.dpi))
    page = Image.new("RGB", (px(w_mm), px(h_mm)), "white")

    im = Image.open(src).convert("RGB")
    box_w, box_h = px(w_mm - 2 * MARGIN_MM), px(h_mm - 2 * MARGIN_MM)
    scale = min(box_w / im.width, box_h / im.height)   # 只縮不放，保持比例
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    page.paste(im, ((page.width - im.width) // 2, (page.height - im.height) // 2))

    page.save(out, "PDF", resolution=args.dpi)
    print(f"✅ {out}")
    print(f"   A4 {'橫式' if args.landscape else '直式'} {args.dpi}dpi，"
          f"圖片列印尺寸約 {im.width / args.dpi * 25.4:.0f}×{im.height / args.dpi * 25.4:.0f} mm")
    print("   列印時請選「實際大小 / 100%」，不要選「配合頁面縮放」。")


if __name__ == "__main__":
    main()
