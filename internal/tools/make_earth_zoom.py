#!/usr/bin/env python3
# make_earth_zoom.py — 「由地球到診所」9:16 直式 zoom 短片（15 秒，1080×1920，30fps）。
#
# 分鏡：0–1s 地球自轉 → 1–9.5s 推近亞洲、台灣、臺南市、北區（衛星底圖約在台灣尺度淡出成村里界地圖）
#      → 9.2–10.2s 大頭針＋「立欣診所／臺南市北區育德路 467 號」資訊卡 → 11.2s 起淡入店面照、推近到招牌。
# 座標取自官網 schema（index.html geo）；資訊卡文字是可見文字，改動前照 internal/00 §4 對照並經院長核可。
#
# 素材（外部衛星圖源在 session 被 proxy 擋，改用 npm 套件內附檔案）：
#   mkdir npm && cd npm && for p in three-globe@2.45.6 world-atlas@2.0.2 taiwan-atlas@2021.9.20; do
#     npm pack $p --silent; done; for f in *.tgz; do tar xzf $f && mv package ${f%.tgz}; done
#   three-globe → earth-blue-marble.jpg／night-sky.png；world-atlas → land-10m；taiwan-atlas → 村里／鄉鎮／縣市界。
# 需求：python3、numpy、Pillow、ffmpeg、CJK 字型（預設文泉驛正黑；Mac 用 EARTH_ZOOM_FONT=/System/Library/Fonts/PingFang.ttc）。
#
# 用法：
#   python3 make_earth_zoom.py <npm 素材資料夾> <店面照 1920×1080> <輸出.mp4>
#   python3 make_earth_zoom.py <npm> <照片> <前綴> 1,9.5,14.9   # 只輸出這幾秒的靜態預覽 <前綴>_<影格>.jpg
# 全片在 session 容器約 12 分鐘。成品：/videos/earth-to-clinic-9x16.mp4（院長 2026-11-05 破例同意影片進 repo）。

import json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

NPM = sys.argv[1]
PHOTO = sys.argv[2]
OUT = sys.argv[3]
W, H, FPS = 1080, 1920, 30
SS = 2  # supersampling for vector layer
LON_T, LAT_T = 120.20645980056585, 23.014676834296754
FONT = os.environ.get("EARTH_ZOOM_FONT", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc")
CORAL = (238, 112, 89)

tex = np.asarray(Image.open(f"{NPM}/three-globe-2.45.6/example/img/earth-blue-marble.jpg").convert("RGB"), dtype=np.float32)
TH, TW = tex.shape[:2]
stars = np.asarray(Image.open(f"{NPM}/three-globe-2.45.6/example/img/night-sky.png").convert("RGB")
                   .crop((0, 0, 1152, 2048)).resize((W, H)), dtype=np.float32)
photo = Image.open(PHOTO).convert("RGB").resize((1920, 1080))
PW, PH = photo.size

# ---------- topojson ----------
def decode_topo(path):
    d = json.load(open(path))
    sx, sy = d["transform"]["scale"]; tx, ty = d["transform"]["translate"]
    arcs = []
    for a in d["arcs"]:
        q = np.cumsum(np.array(a, dtype=np.float64), axis=0)
        arcs.append(np.column_stack([q[:, 0] * sx + tx, q[:, 1] * sy + ty]))
    return d, arcs

def ring_coords(ring, arcs):
    pts = []
    for i in ring:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.append(a if not pts else a[1:])
    return np.vstack(pts)

def polygons(geom, arcs):
    t = geom["type"]
    polys = [geom["arcs"]] if t == "Polygon" else geom["arcs"] if t == "MultiPolygon" else []
    return [[ring_coords(r, arcs) for r in p] for p in polys]

tw, tw_arcs = decode_topo(f"{NPM}/taiwan-atlas-2021.9.20/villages-10t.json")
obj = tw["objects"]

def arc_ids(o):
    s = set()
    def walk(x):
        for y in x:
            if isinstance(y, list): walk(y)
            else: s.add(y if y >= 0 else ~y)
    for g in o["geometries"]:
        walk(g.get("arcs", []))
    return s

county_arcs = arc_ids(obj["counties"])
town_arcs = arc_ids(obj["towns"]) - county_arcs
vill_arcs = arc_ids(obj["villages"]) - county_arcs - town_arcs
tw_land = [p for g in obj["nation"]["geometries"] for p in polygons(g, tw_arcs)]
tainan = [p for g in obj["counties"]["geometries"] if g["properties"]["COUNTYNAME"] == "台南市" for p in polygons(g, tw_arcs)]
north = [p for g in obj["towns"]["geometries"]
         if g["properties"]["COUNTYNAME"] == "台南市" and g["properties"]["TOWNNAME"] == "北區" for p in polygons(g, tw_arcs)]

wa, wa_arcs = decode_topo(f"{NPM}/world-atlas-2.0.2/land-10m.json")
world_land = []
for g in wa["objects"]["land"]["geometries"]:
    for p in polygons(g, wa_arcs):
        lo, la = p[0][:, 0], p[0][:, 1]
        if lo.max() > 100 and lo.min() < 140 and la.max() > 5 and la.min() < 40 and not (119 < lo.mean() < 122.5 and 21.5 < la.mean() < 25.5):
            world_land.append(p)

def centroid(polys):
    p = max((pp[0] for pp in polys), key=len)
    return p[:, 0].mean(), p[:, 1].mean()

# ---------- projection ----------
def ortho(lon, lat, lon0, lat0, R, cx, cy):
    l, p = np.radians(lon), np.radians(lat)
    l0, p0 = math.radians(lon0), math.radians(lat0)
    x = np.cos(p) * np.sin(l - l0)
    y = math.cos(p0) * np.sin(p) - math.sin(p0) * np.cos(p) * np.cos(l - l0)
    return np.column_stack([cx + R * x, cy - R * y])

def render_globe(lon0, lat0, R):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    x = (xx - W / 2) / R; y = -(yy - H / 2) / R
    rho = np.sqrt(x * x + y * y)
    inside = rho <= 1
    c = np.arcsin(np.clip(rho, 0, 1))
    p0, l0 = math.radians(lat0), math.radians(lon0)
    rs = np.where(rho == 0, 1e-9, rho)
    lat = np.arcsin(np.clip(np.cos(c) * math.sin(p0) + y * np.sin(c) * math.cos(p0) / rs, -1, 1))
    lon = l0 + np.arctan2(x * np.sin(c), rs * np.cos(c) * math.cos(p0) - y * np.sin(c) * math.sin(p0))
    u = ((lon / (2 * np.pi) + 0.5) % 1) * TW - 0.5
    v = (0.5 - lat / np.pi) * TH - 0.5
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
    fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
    u0m, u1m = u0 % TW, (u0 + 1) % TW
    v0c, v1c = np.clip(v0, 0, TH - 1), np.clip(v0 + 1, 0, TH - 1)
    col = (tex[v0c, u0m] * (1 - fu) * (1 - fv) + tex[v0c, u1m] * fu * (1 - fv)
           + tex[v1c, u0m] * (1 - fu) * fv + tex[v1c, u1m] * fu * fv)
    shade = (np.clip(np.cos(c), 0, 1) ** 0.35)[..., None]
    col = col * (0.25 + 0.75 * shade)
    d = rho - 1
    glow = np.where(inside, 0.35 * (1 - np.cos(c)) ** 3, np.exp(-np.maximum(d, 0) / 0.035))[..., None]
    out = np.where(inside[..., None], col, stars)
    out = out * (1 - glow * 0.6) + np.array([110, 170, 255], np.float32) * glow * 0.6
    return np.clip(out, 0, 255)

def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)

def ease(t):
    t = min(max(t, 0), 1)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2

font_cache = {}
def font(sz):
    if sz not in font_cache: font_cache[sz] = ImageFont.truetype(FONT, sz)
    return font_cache[sz]

def label(dr, xy, text, size, alpha, fill=(40, 40, 40)):
    if alpha <= 0: return
    a = int(255 * alpha)
    dr.text(xy, text, font=font(size), fill=fill + (a,), anchor="mm",
            stroke_width=max(2, size // 9), stroke_fill=(255, 255, 255, a))

def render_map(lon0, lat0, R, L, t):
    w, h = W * SS, H * SS
    Rs, cx, cy = R * SS, w / 2, h / 2
    img = Image.new("RGBA", (w, h), (166, 205, 228, 255))
    dr = ImageDraw.Draw(img, "RGBA")
    def vis(xy):
        return xy[:, 0].max() > -w and xy[:, 0].min() < 2 * w and xy[:, 1].max() > -h and xy[:, 1].min() < 2 * h
    def fill_polys(polys, color):
        for p in polys:
            xy = ortho(p[0][:, 0], p[0][:, 1], lon0, lat0, Rs, cx, cy)
            if len(xy) > 2 and vis(xy):
                dr.polygon([tuple(q) for q in xy], fill=color)
    fill_polys(world_land, (241, 236, 222, 255))
    fill_polys(tw_land, (247, 243, 232, 255))
    a_tn = smooth(4.5, 4.9, L)
    if a_tn: fill_polys(tainan, (255, 226, 205, int(255 * a_tn)))
    a_n = smooth(5.1, 5.5, L)
    if a_n: fill_polys(north, CORAL + (int(110 * a_n),))
    def lines(ids, color, width, alpha):
        if alpha <= 0: return
        for i in ids:
            xy = ortho(tw_arcs[i][:, 0], tw_arcs[i][:, 1], lon0, lat0, Rs, cx, cy)
            if vis(xy) and (np.ptp(xy[:, 0]) + np.ptp(xy[:, 1]) > 1.5):
                dr.line([tuple(q) for q in xy], fill=color + (int(255 * alpha),), width=width, joint="curve")
    lines(vill_arcs, (200, 185, 170), 1 * SS, 0.8 * smooth(5.3, 5.8, L))
    lines(town_arcs, (175, 155, 140), 2 * SS, smooth(4.6, 5.0, L))
    lines(county_arcs, (150, 130, 120), 2 * SS, smooth(3.9, 4.3, L))
    # north district outline
    if a_n:
        for p in north:
            xy = ortho(p[0][:, 0], p[0][:, 1], lon0, lat0, Rs, cx, cy)
            dr.line([tuple(q) for q in xy] + [tuple(xy[0])], fill=CORAL + (int(255 * a_n),), width=4 * SS, joint="curve")
    # labels
    def place(lonlat):
        q = ortho(np.array([lonlat[0]]), np.array([lonlat[1]]), lon0, lat0, Rs, cx, cy)[0]
        return (q[0], q[1])
    label(dr, place((120.95, 23.75)), "臺灣  Taiwan", 46 * SS, smooth(3.9, 4.2, L) * (1 - smooth(4.7, 5.0, L)))
    label(dr, place((120.33, 23.15)), "臺南市", 42 * SS, smooth(4.6, 4.9, L) * (1 - smooth(5.4, 5.7, L)))
    nl = centroid(north)
    label(dr, place((nl[0] - 0.008, nl[1] + 0.004)), "北區", 40 * SS, smooth(5.5, 5.8, L), fill=(170, 60, 40))
    return img.resize((W, H), Image.LANCZOS).convert("RGB")

def draw_pin(img, s, card):
    if s <= 0: return img
    img = img.convert("RGBA")
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    cx, cy = W / 2, H / 2
    drop = (1 - ease(s)) * 120
    r = 26
    top = cy - 78 - drop
    dr.ellipse((cx - 22, cy - 7, cx + 22, cy + 7), fill=(0, 0, 0, int(70 * s)))
    for rr, col in ((r + 4, (255, 255, 255)), (r, (190, 40, 30))):
        dr.polygon([(cx - rr * 0.82, top + r * 1.45), (cx + rr * 0.82, top + r * 1.45), (cx, cy - drop + (rr - r) * 1.2)], fill=col + (int(255 * s),))
        dr.ellipse((cx - rr, top + r - rr, cx + rr, top + r + rr), fill=col + (int(255 * s),))
    dr.ellipse((cx - 10, top + r - 10, cx + 10, top + r + 10), fill=(255, 255, 255, int(255 * s)))
    if card > 0:
        a = int(255 * card)
        bx, by = cx, cy + 70
        dr.rounded_rectangle((bx - 230, by - 10, bx + 230, by + 110), 18, fill=(255, 255, 255, int(235 * card)))
        dr.text((bx, by + 30), "立欣診所", font=font(46), fill=CORAL + (a,), anchor="mm")
        dr.text((bx, by + 82), "臺南市北區育德路 467 號", font=font(26), fill=(70, 70, 70, a), anchor="mm")
    return Image.alpha_composite(img, ov).convert("RGB")

_bh = H; _bw = int(PW * H / PH)
PHOTO_BG = photo.resize((_bw, _bh), Image.LANCZOS).crop(((_bw - W) // 2, 0, (_bw - W) // 2 + W, H)) \
    .filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * 0.55))

def photo_frame(u):
    # whole landscape photo over a blurred fill, pushing in until the sign spans the frame
    e = ease(u)
    k = (W / PW) * (1 - e) + 0.80 * e
    px, py = 960 + (915 - 960) * e, 540 + (250 - 540) * e
    sy = H / 2 - 120 * e
    fg = photo.resize((int(PW * k), int(PH * k)), Image.LANCZOS)
    out = PHOTO_BG.copy()
    out.paste(fg, (int(W / 2 - px * k), int(sy - py * k)))
    return out

# ---------- timeline ----------
T_TOTAL = 15.0
Z0, Z1 = 1.0, 9.5            # zoom window
L0, L1 = math.log10(420), 5.95
LON_S, LAT_S = 60.0, 8.0

if len(sys.argv) > 4:  # preview a single time (seconds) as a still
    FRAMES = [int(float(x) * FPS) for x in sys.argv[4].split(",")]
else:
    FRAMES = None
ff = None if FRAMES else subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
                       "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
N = int(T_TOTAL * FPS)
for f in (FRAMES or range(N)):
    t = f / FPS
    u = (t - Z0) / (Z1 - Z0)
    L = L0 + (L1 - L0) * ease(u)
    R = 10 ** L
    r = ease(min(max(u / 0.5, 0), 1)) if u > 0 else 0
    spin = (1 - smooth(0, 0.3, u)) * 0  # globe idles via start offset below
    lon0 = LON_S + (LON_T - LON_S) * r - (Z0 - min(t, Z0)) * 6
    lat0 = LAT_S + (LAT_T - LAT_S) * r
    a_map = smooth(3.55, 4.15, L)
    if a_map < 1:
        frame = Image.fromarray(render_globe(lon0, lat0, R).astype(np.uint8))
        if a_map > 0:
            frame = Image.blend(frame, render_map(lon0, lat0, R, L, t), a_map)
    else:
        frame = render_map(lon0, lat0, R, L, t)
    frame = draw_pin(frame, smooth(9.2, 9.8, t), smooth(9.7, 10.2, t))
    a_ph = smooth(11.2, 12.0, t)
    if a_ph > 0:
        frame = Image.blend(frame, photo_frame((t - 11.2) / (T_TOTAL - 11.2)), a_ph)
    if FRAMES: frame.save(f"{OUT}_{f}.jpg"); continue
    ff.stdin.write(frame.tobytes())
    if f % 30 == 0: print(f, round(L, 2), flush=True)
if ff: ff.stdin.close(); ff.wait()
