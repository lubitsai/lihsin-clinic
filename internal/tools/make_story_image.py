#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_story_image.py — 方形公告圖 → 9:16 限時動態版（FB Story／IG Story）

站上的公告圖與資訊圖一律是 1:1（1254×1254，見 make_infographic.py）。
FB／IG 限時動態的畫布是 9:16（1080×1920），直接把方形圖丟上去會被上下
補黑邊或左右裁掉字。本工具把方形圖置中放在 1080×1920 畫布上，上下的空白
用圖本身補滿，所以晴天版、夕陽版、夜晚版各自會得到自己色系的背景。

三種補法（`--bg`），預設 solid：
  solid ——取圖四個角落的平均色（角落幾乎一定是純天空／純草地），往接縫
          漸層到該側邊緣的平均色。晴天版得到淺藍、夕陽版得到橘、夜晚版
          得到深藍，各自對得上。
  edge  ——把最上緣與最下緣各一條窄帶往外拉伸。⚠️ 只適用於上下緣是純背景
          的圖；這組公告圖的上緣是綠色布條、下緣是米色資訊列，拉伸會變成
          看得出字影的直向拖影。
  blur  ——整張放大模糊後填滿。⚠️ 放大後取到的是圖的中段（米色文字框），
          夜晚版會糊成土色、和深藍天空對不上。

版面（1080×1920）：
  y   0– 420  背景            ← IG 頂部頭像／FB 頂部列會蓋到約 250px
  y 420–1500  公告圖 1080×1080  ← 安全區內，不會被 UI 蓋住
  y1500–1920  背景            ← IG 底部回覆列會蓋到約 250px

用法：
  python3 internal/tools/make_story_image.py <來源圖> <輸出檔名主幹> [--dir images/social]
                                             [--bg solid|edge|blur] [--margin 0]
                                             [--webp] [--dry]

範例：
  python3 internal/tools/make_story_image.py src.png registration-closed-morning

輸出：
  <dir>/<slug>-story.jpg   1080×1920  JPEG q88 progressive

備註：Meta 會拒絕「已經發過的素材」，所以實際發限動時要另外複製一份帶
時間戳的檔名（發布腳本負責，不是本工具）。
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError:
    sys.exit("需要 Pillow：pip install Pillow")

W, H = 1080, 1920
BLUR_RADIUS = 64
BG_BRIGHTNESS = 0.72   # 背景壓暗，讓前景公告圖跳出來
BG_SATURATION = 1.10   # 稍微加飽和，避免模糊後的背景灰掉
SHADOW_BLUR = 24
SHADOW_ALPHA = 90
EDGE_BAND = 20      # 取上下各幾列來求邊緣平均色（edge 模式則是拉伸這幾列）
CORNER_PATCH = 96   # solid 模式角落取色的方塊邊長
EDGE_BLUR = 10      # 拉伸後輕微模糊，消掉橫向條紋


def cover_crop(im, w, h):
    """等比放大到足以覆蓋 w×h，再置中裁切。"""
    scale = max(w / im.width, h / im.height)
    resized = im.resize(
        (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
        Image.LANCZOS,
    )
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    return resized.crop((left, top, left + w, top + h))


def _avg(im):
    """整塊的平均色。"""
    return im.convert("RGB").resize((1, 1), Image.LANCZOS).getpixel((0, 0))


def _corner_color(im, where):
    """取該側兩個角落各一塊的平均色——角落幾乎一定是純背景（天空／草地）。"""
    w, h = im.size
    s = min(CORNER_PATCH, w // 2, h // 2)
    if where == "top":
        boxes = [(0, 0, s, s), (w - s, 0, w, s)]
    else:
        boxes = [(0, h - s, s, h), (w - s, h - s, w, h)]
    cols = [_avg(im.crop(b)) for b in boxes]
    return tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))


def _edge_avg(im, where):
    """該側最外緣一條窄帶的平均色——用來讓漸層在接縫處對上圖的實際顏色。"""
    w, h = im.size
    band = min(EDGE_BAND, h)
    box = (0, 0, w, band) if where == "top" else (0, h - band, w, h)
    return _avg(im.crop(box))


def _gradient(w, h, top_rgb, bottom_rgb):
    """由上而下的線性漸層。"""
    grad = Image.new("RGB", (1, max(h, 1)))
    px = grad.load()
    for i in range(max(h, 1)):
        t = i / max(h - 1, 1)
        px[0, i] = tuple(
            round(top_rgb[c] + (bottom_rgb[c] - top_rgb[c]) * t) for c in range(3)
        )
    return grad.resize((w, max(h, 1)), Image.BICUBIC)


def build_background_blur(src):
    bg = cover_crop(src, W, H).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
    bg = ImageEnhance.Brightness(bg).enhance(BG_BRIGHTNESS)
    bg = ImageEnhance.Color(bg).enhance(BG_SATURATION)
    return bg


def build_story(src, margin=0, bg="solid"):
    """回傳 1080×1920 的 RGB 圖。margin 為公告圖左右各留的空白像素。"""
    side = W - 2 * margin
    if side <= 0:
        raise ValueError(f"--margin {margin} 太大，公告圖寬度會 <= 0")

    fg = src.convert("RGB").resize((side, side), Image.LANCZOS)
    x = (W - side) // 2
    y = (H - side) // 2

    if bg == "blur":
        canvas = build_background_blur(src).convert("RGBA")
        # 模糊背景與前景是兩張不同的圖，需要一條陰影邊界把它們分開
        shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        shadow.paste((0, 0, 0, SHADOW_ALPHA), (x, y, x + side, y + side))
        shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
        canvas = Image.alpha_composite(canvas, shadow)
        canvas.paste(fg, (x, y))
        return canvas.convert("RGB")

    if bg == "edge":
        top_band = fg.crop((0, 0, side, EDGE_BAND)).resize((side, y), Image.LANCZOS)
        bottom_band = fg.crop((0, side - EDGE_BAND, side, side)).resize(
            (side, H - y - side), Image.LANCZOS
        )
        top_band = top_band.filter(ImageFilter.GaussianBlur(EDGE_BLUR))
        bottom_band = bottom_band.filter(ImageFilter.GaussianBlur(EDGE_BLUR))
    else:
        # solid：角落取色 → 往接縫漸層到該側邊緣的平均色。
        # 不直接拉伸邊緣像素，因為這些公告圖的上緣是綠色布條、下緣是米色資訊列，
        # 拉伸會變成看得出字影的直向拖影。
        top_band = _gradient(
            side, y, _corner_color(fg, "top"), _edge_avg(fg, "top")
        )
        bottom_band = _gradient(
            side, H - y - side, _edge_avg(fg, "bottom"), _corner_color(fg, "bottom")
        )

    canvas = Image.new("RGB", (W, H), _corner_color(fg, "top"))
    canvas.paste(top_band, (x, 0))
    canvas.paste(bottom_band, (x, y + side))
    canvas.paste(fg, (x, y))
    return canvas


def main():
    ap = argparse.ArgumentParser(description="方形公告圖 → 1080×1920 限時動態版")
    ap.add_argument("src", help="來源圖（建議 1254×1254）")
    ap.add_argument("slug", help="輸出檔名主幹，會產出 <slug>-story.jpg")
    ap.add_argument("--dir", default="images/social", help="輸出目錄（預設 images/social）")
    ap.add_argument("--margin", type=int, default=0, help="公告圖左右各留的空白像素（預設 0＝滿版）")
    ap.add_argument("--bg", choices=("solid", "edge", "blur"), default="solid",
                    help="上下留白的補法：solid＝角落取色漸層（預設）／"
                         "edge＝邊緣像素延伸／blur＝整張放大模糊")
    ap.add_argument("--webp", action="store_true", help="另外產一份 webp")
    ap.add_argument("--dry", action="store_true", help="只印出會做什麼，不寫檔")
    args = ap.parse_args()

    if not os.path.isfile(args.src):
        sys.exit(f"找不到來源圖：{args.src}")

    src = Image.open(args.src)
    if src.width != src.height:
        print(f"⚠️  來源不是正方形（{src.width}×{src.height}），會被壓成正方——"
              f"請先用 make_infographic.py 裁成 1254²", file=sys.stderr)

    out_jpg = os.path.join(args.dir, f"{args.slug}-story.jpg")
    print(f"{args.src} ({src.width}×{src.height}) → {out_jpg} ({W}×{H}, bg={args.bg})")
    if args.webp:
        print(f"{' ' * 4}＋ {os.path.join(args.dir, f'{args.slug}-story.webp')}")
    if args.dry:
        return

    os.makedirs(args.dir, exist_ok=True)
    story = build_story(src, margin=args.margin, bg=args.bg)
    story.save(out_jpg, "JPEG", quality=88, progressive=True, optimize=True)
    print(f"  ✓ {out_jpg}  {os.path.getsize(out_jpg) / 1024:.0f}KB")
    if args.webp:
        out_webp = os.path.join(args.dir, f"{args.slug}-story.webp")
        story.save(out_webp, "WEBP", quality=84, method=6)
        print(f"  ✓ {out_webp}  {os.path.getsize(out_webp) / 1024:.0f}KB")


if __name__ == "__main__":
    main()
