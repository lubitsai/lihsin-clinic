#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_asset.py — 立欣診所品牌素材一鍵轉檔器 v1.0（2026-07-11；止血包 C）
=========================================================
把「PNG → 向量化 → 六格式輸出 → 依命名規則歸檔」這條反覆手工迭代的流程固化成一支腳本。
向量化參數＝過往吉祥物／LOGO 案例已驗證值（filter_speckle=6 / color_precision=6 /
layer_difference=16），不再每次重試。

設計原則
--------
1. 向量化本質需第三方庫（vtracer/cairosvg/Pillow），非純標準庫；故：
   - 所有第三方庫「延後載入」，缺哪個就跳過對應格式並印出安裝指令，不整支崩潰。
   - 至少需要 vtracer（產生 SVG 母檔）；其餘格式由 SVG 母檔衍生。
2. SVG＝向量母檔（single source）；PNG/JPG 由 SVG 渲染（任意尺寸都乾淨），
   不由原始點陣圖放大。AI＝PDF 相容檔（Illustrator 可直接開啟 PDF-compatible .ai）。
3. 冪等：同輸入同參數重跑覆蓋輸出，不累積垃圾檔。
4. 命名規則＝品牌資產庫慣例「資產名_用途_尺寸_版本」：
     向量：{name}_{usage}_vector_{version}.{svg,pdf,ai}
     點陣：{name}_{usage}_{size}_{version}.{png,jpg}

已驗證參數（勿隨意更動，更動請記錄於 00 教訓）
--------------------------------------------
  filter_speckle = 6      # 濾除雜點（吉祥物案 4 版迭代後定值）
  color_precision = 6     # 色彩量化精度
  layer_difference = 16   # 分層色差門檻

使用方式
--------
  python3 tools/convert_asset.py INPUT.png \\
      --name mascot --usage web --version v1 \\
      [--sizes 256,512,1024] [--outdir ./out] [--jpg-bg white] \\
      [--formats svg,pdf,ai,png,jpg]

  必填：INPUT（來源點陣圖，建議去背 PNG）、--name、--usage、--version
  --sizes    點陣輸出邊長（px），逗號分隔，預設 512。每個尺寸各出一張 PNG/JPG。
  --outdir   輸出資料夾，預設 ./asset_out
  --jpg-bg   JPG 無透明度，去背處以此色填底，預設 white
  --formats  只出指定格式（預設全出）。缺對應庫的格式自動跳過並提示。

依賴安裝（一次）
----------------
  pip install vtracer cairosvg pillow
  # cairosvg 另需系統套件 libcairo2（Debian/Ubuntu: apt install libcairo2）

輸出後歸檔提醒
--------------
  將 out/ 內檔案依原命名放入 Google Drive 品牌資產庫對應資料夾；
  母檔（SVG）與衍生檔一併保存，下次改版沿用同 name/usage、遞增 version。
"""

import argparse
import os
import shutil
import sys


# ---------- 延後載入：缺庫給明確指令，不崩潰 ----------

def _load_vtracer():
    try:
        import vtracer  # noqa
        return vtracer
    except ImportError:
        return None


def _load_cairosvg():
    try:
        import cairosvg  # noqa
        return cairosvg
    except (ImportError, OSError):
        # OSError＝libcairo2 系統庫缺失
        return None


def _load_pillow():
    try:
        from PIL import Image  # noqa
        return Image
    except ImportError:
        return None


# ---------- 各格式產生器 ----------

VTRACER_PARAMS = dict(
    colormode="color",
    hierarchical="stacked",
    mode="spline",
    filter_speckle=6,
    color_precision=6,
    layer_difference=16,
)


def make_svg(vtracer, src, dst):
    """PNG → SVG（向量母檔），已驗證參數。"""
    vtracer.convert_image_to_svg_py(src, dst, **VTRACER_PARAMS)
    return os.path.exists(dst)


def make_pdf(cairosvg, svg_path, dst):
    cairosvg.svg2pdf(url=svg_path, write_to=dst)
    return os.path.exists(dst)


def make_ai_from_pdf(pdf_path, dst):
    """AI＝PDF 相容檔（Illustrator 可開）。直接複製 PDF 位元組，副檔名改 .ai。"""
    shutil.copyfile(pdf_path, dst)
    return os.path.exists(dst)


def make_png(cairosvg, svg_path, dst, size):
    cairosvg.svg2png(url=svg_path, write_to=dst,
                     output_width=size, output_height=size)
    return os.path.exists(dst)


def make_jpg(Image, png_path, dst, bg):
    """由 PNG 攤平到底色（JPG 無透明度）。"""
    im = Image.open(png_path).convert("RGBA")
    canvas = Image.new("RGBA", im.size, bg)
    canvas.alpha_composite(im)
    canvas.convert("RGB").save(dst, "JPEG", quality=92)
    return os.path.exists(dst)


# ---------- 主流程 ----------

def parse_sizes(s):
    out = []
    for tok in s.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if not tok.isdigit() or int(tok) <= 0:
            sys.exit(f"[錯誤] --sizes 含非正整數：{tok!r}")
        out.append(int(tok))
    return out or [512]


def main():
    ap = argparse.ArgumentParser(
        description="立欣診所品牌素材一鍵轉檔器（PNG → SVG/PDF/AI/PNG/JPG）")
    ap.add_argument("input", help="來源點陣圖（建議去背 PNG）")
    ap.add_argument("--name", required=True, help="資產名，如 mascot / logo")
    ap.add_argument("--usage", required=True, help="用途，如 web / print / line")
    ap.add_argument("--version", required=True, help="版本，如 v1")
    ap.add_argument("--sizes", default="512", help="點陣邊長 px，逗號分隔（預設 512）")
    ap.add_argument("--outdir", default="./asset_out", help="輸出資料夾")
    ap.add_argument("--jpg-bg", default="white", help="JPG 底色（預設 white）")
    ap.add_argument("--formats", default="svg,pdf,ai,png,jpg",
                    help="輸出格式子集（預設全出）")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"[錯誤] 找不到輸入檔：{args.input}")

    want = {f.strip().lower() for f in args.formats.split(",") if f.strip()}
    sizes = parse_sizes(args.sizes)
    os.makedirs(args.outdir, exist_ok=True)

    base = f"{args.name}_{args.usage}"
    ver = args.version
    p = lambda fn: os.path.join(args.outdir, fn)

    made, skipped = [], []

    # --- 載入庫 ---
    vtracer = _load_vtracer()
    cairosvg = _load_cairosvg()
    Image = _load_pillow()

    # SVG 是所有向量/點陣衍生的母檔；需求 svg 或任何衍生格式時都得先有它
    need_svg = bool(want & {"svg", "pdf", "ai", "png", "jpg"})
    svg_path = p(f"{base}_vector_{ver}.svg")

    if need_svg:
        if vtracer is None:
            print("[跳過] 需要 vtracer 產生 SVG 母檔 → 所有格式無法輸出。")
            print("       安裝：pip install vtracer")
            sys.exit(1)
        if make_svg(vtracer, args.input, svg_path):
            if "svg" in want:
                made.append(svg_path)
        else:
            sys.exit("[錯誤] SVG 向量化失敗。")

    # PDF
    pdf_path = p(f"{base}_vector_{ver}.pdf")
    need_pdf = bool(want & {"pdf", "ai"})
    if need_pdf:
        if cairosvg is None:
            skipped.append(("pdf/ai", "缺 cairosvg 或 libcairo2；pip install cairosvg（另需系統 libcairo2）"))
        else:
            if make_pdf(cairosvg, svg_path, pdf_path):
                if "pdf" in want:
                    made.append(pdf_path)
                if "ai" in want:
                    ai_path = p(f"{base}_vector_{ver}.ai")
                    if make_ai_from_pdf(pdf_path, ai_path):
                        made.append(ai_path)
                # 若只要 ai 不要 pdf，收尾刪暫存 pdf
                if "pdf" not in want and os.path.exists(pdf_path):
                    os.remove(pdf_path)

    # PNG / JPG（各尺寸）
    if want & {"png", "jpg"}:
        if cairosvg is None:
            skipped.append(("png", "缺 cairosvg；pip install cairosvg"))
        else:
            for size in sizes:
                png_path = p(f"{base}_{size}_{ver}.png")
                if make_png(cairosvg, svg_path, png_path, size):
                    if "png" in want:
                        made.append(png_path)
                    if "jpg" in want:
                        if Image is None:
                            skipped.append(("jpg", "缺 Pillow；pip install pillow"))
                        else:
                            jpg_path = p(f"{base}_{size}_{ver}.jpg")
                            if make_jpg(Image, png_path, jpg_path, args.jpg_bg):
                                made.append(jpg_path)
                    if "png" not in want and os.path.exists(png_path):
                        os.remove(png_path)  # 只要 jpg 時清暫存 png

    # SVG 為衍生用母檔；若未指定輸出 svg，收尾刪除（與 pdf/png 暫存清理一致）
    if need_svg and "svg" not in want and os.path.exists(svg_path):
        os.remove(svg_path)

    # --- 報告 ---
    print("\n========== 轉檔結果 ==========")
    print(f"來源：{args.input}")
    print(f"向量化參數：filter_speckle=6 / color_precision=6 / layer_difference=16")
    print(f"輸出資料夾：{os.path.abspath(args.outdir)}\n")
    if made:
        print(f"✅ 產出 {len(made)} 檔：")
        for f in made:
            print(f"   {os.path.basename(f)}")
    if skipped:
        print("\n⚠️ 跳過（缺依賴）：")
        for fmt, why in skipped:
            print(f"   {fmt}：{why}")
    print("\n📁 歸檔提醒：依原命名放入 Drive 品牌資產庫；SVG 母檔與衍生檔一併保存，")
    print("   下次改版沿用同 name/usage、遞增 version。")
    print("==============================\n")


if __name__ == "__main__":
    main()
