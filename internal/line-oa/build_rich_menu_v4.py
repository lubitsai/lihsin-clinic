"""v4：從原始 8 格選單圖重做。下排②③改字「過敏氣喘」「科學減重」、④保留原圖「粉絲專頁」；中間品牌帶加營業時間膠囊＋右上「衛教專區」按鈕（院長 2026-11-13）"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np, sys
# 用法（repo 根目錄）：python3 internal/line-oa/build_rich_menu_v3.py <輸出.jpg> ['膠囊文字'] [字級]
# 字型：jf open 粉圓 2.1（SIL OFL），下載 https://raw.githubusercontent.com/justfont/open-huninn-font/master/font/jf-openhuninn-2.1.ttf
#       放到 HUNINN_FONT 指定的路徑（預設 ./jf-openhuninn-2.1.ttf）。原圖固定讀 internal/line-oa/rich-menu-8grid.jpg。
import os
F=os.environ.get('HUNINN_FONT','jf-openhuninn-2.1.ttf')
src=Image.open('internal/line-oa/rich-menu-8grid.jpg').convert('RGB')
A=np.asarray(src).astype(float)
X4=4

def inpaint(arr, mask, iters=500, blur=8):
    fill=arr.copy(); known=~mask; fill[mask]=0
    for _ in range(iters):
        acc=np.zeros_like(fill); cnt=np.zeros(mask.shape)
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            k=np.roll(np.roll(known,dy,0),dx,1)
            acc+=np.roll(np.roll(fill,dy,0),dx,1)*k[...,None]; cnt+=k
        upd=mask&(cnt>0)&~known
        if not upd.any(): break
        fill[upd]=acc[upd]/cnt[upd][:,None]; known|=upd
    sm=np.asarray(Image.fromarray(fill.clip(0,255).astype('uint8')).filter(ImageFilter.GaussianBlur(blur))).astype(float)
    fill[mask]=sm[mask]; return fill

def text_color(cell, box):
    y0,y1,x0,x1=box; reg=cell[y0:y1,x0:x1].reshape(-1,3)
    return tuple(int(v) for v in np.median(reg[reg.sum(1)<350],0))

def draw_label(img, text, cx, cy, color, size=88):
    big=img.resize((img.width*X4,img.height*X4),Image.LANCZOS); d=ImageDraw.Draw(big)
    f=ImageFont.truetype(F,size*X4)
    for ox,oy in ((0,0),(1.2,0),(0,1.2),(1.2,1.2)):
        d.text((cx*X4+ox*X4,cy*X4+oy*X4),text,font=f,fill=color,anchor='mm')
    return big.resize(img.size,Image.LANCZOS)

out=A.copy()
# ── 下排②③：改字（只補文字列，插圖不動）──
for x0,old_box,new in ((625,(345,440,140,515),'過敏氣喘'),(1250,(345,440,120,500),'科學減重')):
    cell=A[1140:1686,x0:x0+625].copy(); col=text_color(cell,old_box)
    m=np.zeros(cell.shape[:2],bool); y0,y1,a0,a1=old_box; m[y0-6:y1+8,a0-14:a1+14]=True
    cell=inpaint(cell,m)
    cx=(a0+a1)/2; img=draw_label(Image.fromarray(cell.clip(0,255).astype('uint8')),new,cx,389,col)
    out[1140:1686,x0:x0+625]=np.asarray(img)
# ── 下排④：v4 起保留原圖「粉絲專頁」（院長 2026-11-13：最新資訊常發在 Facebook）──
# ── 中間品牌帶：副標下方加膠囊標籤 ──
band=Image.fromarray(out.clip(0,255).astype('uint8'))
big=band.resize((2500*X4,1686*X4),Image.LANCZOS); d=ImageDraw.Draw(big)
txt=sys.argv[2] if len(sys.argv)>2 else '週六、週日與平日夜間都有門診'; f=ImageFont.truetype(F,int(sys.argv[3]) *X4 if len(sys.argv)>3 else 50*X4)
tw=d.textlength(txt,font=f); pcx=1095*X4; pcy=1081*X4; ph=(int(sys.argv[3]) if len(sys.argv)>3 else 50)*X4+26*X4; pw=tw+56*X4
d.rounded_rectangle((pcx-pw/2,pcy-ph/2,pcx+pw/2,pcy+ph/2),radius=ph/2,fill=(124,154,110))
d.text((pcx,pcy+2*X4),txt,font=f,fill=(255,255,255),anchor='mm')
# 衛教專區按鈕：品牌帶右上、父母頭頂上方空白處（點擊區＝品牌帶右半，見 Colab 腳本）
f2=ImageFont.truetype(F,58*X4); t2='衛教專區 ›'
tw2=d.textlength(t2,font=f2); hcx=1760*X4; hcy=684*X4; hh=94*X4; hw=tw2+72*X4
d.rounded_rectangle((hcx-hw/2,hcy-hh/2,hcx+hw/2,hcy+hh/2),radius=hh/2,fill=(124,154,110))
d.text((hcx,hcy+3*X4),t2,font=f2,fill=(255,255,255),anchor='mm')
final=big.resize((2500,1686),Image.LANCZOS)
final.save(sys.argv[1],quality=88,optimize=True)
print('pill width px', round(pw/X4), 'x range', round((pcx-pw/2)/X4), round((pcx+pw/2)/X4))
