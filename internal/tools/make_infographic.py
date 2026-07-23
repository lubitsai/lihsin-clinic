#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_infographic.py — 立欣診所衛教／最新消息資訊圖：一鍵改名＋轉檔

把院長在對話中上傳的一張原始衛教圖（poster/資訊圖），
產出網站標準的 5 個衍生檔（比照 flu-vaccine-2026 等既有圖組）：

  <slug>-infographic.jpg      1254×1254  (JPEG, q86, progressive)   主圖 fallback
  <slug>-infographic.webp     1254×1254  (WebP, q82, method6)       主圖
  <slug>-infographic-768.webp  768×768   (WebP, q82)                行動版 source
  <slug>-thumb.jpg             480×480   (JPEG, q86, progressive)   首頁卡 fallback
  <slug>-thumb.webp            480×480   (WebP, q82)                首頁卡縮圖

預設把非正方形來源「置中裁切」成正方（--crop center）；用 --crop pad 改為
補白邊、--crop none 直接縮放（會變形，不建議）。

用法：
  python3 internal/tools/make_infographic.py <來源圖> <slug> [--dir images]
                                             [--crop center|pad|none]
                                             [--sizes 1254,768,480] [--dry]

範例（本次 COVID）：
  python3 internal/tools/make_infographic.py \\
      /root/.claude/uploads/.../IMG_1246.png covid-19-2026

slug 命名慣例：與承載頁同名主幹（news/health 檔名去副檔名），例如
  flu-vaccine-2026 / covid-19-2026 / rsv-immunization-infographic ...
  （注意：既有 health 圖多為 <topic>-infographic.*，故 slug 給 <topic> 即可；
   若頁面 <img> 用的是 <topic>-infographic 當「主幹」，請把 slug 設為該主幹，
   本工具一律再接 -infographic / -thumb 尾綴，勿自行重複打 -infographic。）

相依：Pillow。缺少時本腳本會自動嘗試 `pip install Pillow` 一次。
輸出後請務必跑：python3 internal/tools/validate_site.py --root . --stage deploy
"""
import argparse
import subprocess
import sys
from pathlib import Path


def ensure_pillow():
    try:
        from PIL import Image  # noqa: F401
        return
    except ImportError:
        print("[i] 未偵測到 Pillow，嘗試安裝（容器為臨時環境，屬正常）…")
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "Pillow"],
                       check=True)
        from PIL import Image  # noqa: F401


def make_square(im, mode):
    """回傳正方形影像。mode: center=置中裁切, pad=補白邊, none=原樣。"""
    from PIL import Image
    w, h = im.size
    if w == h or mode == "none":
        return im
    if mode == "pad":
        s = max(w, h)
        canvas = Image.new("RGB", (s, s), (255, 255, 255))
        canvas.paste(im, ((s - w) // 2, (s - h) // 2))
        return canvas
    # center crop（預設）
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def main():
    ap = argparse.ArgumentParser(description="立欣診所資訊圖改名＋轉檔（5 檔衍生）")
    ap.add_argument("source", help="來源圖路徑（png/jpg/webp 皆可）")
    ap.add_argument("slug", help="輸出主幹，例如 covid-19-2026")
    ap.add_argument("--dir", default="images", help="輸出目錄（預設 images）")
    ap.add_argument("--crop", choices=["center", "pad", "none"], default="center",
                    help="非正方形來源處理方式（預設 center 置中裁切）")
    ap.add_argument("--sizes", default="1254,768,480",
                    help="主圖,行動,縮圖 邊長（預設 1254,768,480）")
    ap.add_argument("--dry", action="store_true", help="只列出將產生的檔名，不寫檔")
    args = ap.parse_args()

    ensure_pillow()
    from PIL import Image

    src = Path(args.source)
    if not src.exists():
        sys.exit(f"[E] 來源圖不存在：{src}")
    outdir = Path(args.dir)
    big, mid, thumb = (int(x) for x in args.sizes.split(","))
    slug = args.slug.strip().rstrip("-")

    plan = [
        (f"{slug}-infographic.jpg", big, "JPEG"),
        (f"{slug}-infographic.webp", big, "WEBP"),
        (f"{slug}-infographic-{mid}.webp", mid, "WEBP"),
        (f"{slug}-thumb.jpg", thumb, "JPEG"),
        (f"{slug}-thumb.webp", thumb, "WEBP"),
    ]

    if args.dry:
        print(f"[dry] 來源：{src}（輸出至 {outdir}/）")
        for name, size, fmt in plan:
            print(f"  → {name}  {size}×{size}  {fmt}")
        return

    outdir.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB")
    print(f"[i] 來源尺寸：{im.size[0]}×{im.size[1]}  crop={args.crop}")
    sq = make_square(im, args.crop)
    if sq.size != im.size:
        print(f"[i] 已處理為正方：{sq.size[0]}×{sq.size[1]}")

    for name, size, fmt in plan:
        r = sq.resize((size, size), Image.LANCZOS)
        path = outdir / name
        if fmt == "JPEG":
            r.save(path, "JPEG", quality=86, optimize=True, progressive=True)
        else:
            r.save(path, "WEBP", quality=82, method=6)
        print(f"  ✓ {path}  ({path.stat().st_size // 1024} KB)")

    print("\n[✓] 完成。下一步（必跑）：")
    print("    python3 internal/tools/validate_site.py --root . --stage deploy")
    print("    ERROR 清零後再 commit / push。")


if __name__ == "__main__":
    main()
