"""從原始 8 格選單圖重做：右下改衛教專區、下排②③改字、中間品牌帶加膠囊標籤（院長 2026-11-13「全部依建議修改」）"""
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
# ── 下排④：粉絲專頁 → 衛教專區（書本圖示＋字）──
X0=1875; cell=A[1140:1686,X0:X0+625].copy(); col=text_color(cell,(335,425,100,450))
m=np.zeros(cell.shape[:2],bool); m[72:306,152:398]=True; m[318:442,82:470]=True
cell=inpaint(cell,m)
for x in range(386,398):
    w=min(1,(x-386)/12); cell[150:306,x]=cell[150:306,x]*(1-w)+A[1140+150:1140+306,X0+x]*w
big=Image.fromarray(cell.clip(0,255).astype('uint8')).resize((625*X4,546*X4),Image.LANCZOS); d=ImageDraw.Draw(big)
FILL=(170,176,128); FILL2=(204,209,168); lw=7*X4; cx=262*X4; top=122*X4; bot=262*X4; half=92*X4
L=[(cx,top+14*X4),(cx-half,top),(cx-half,bot-16*X4),(cx,bot)]; R=[(cx,top+14*X4),(cx+half,top),(cx+half,bot-16*X4),(cx,bot)]
d.polygon(L,fill=FILL2); d.polygon(R,fill=FILL)
for poly in (L,R): d.line(poly+[poly[0]],fill=col,width=lw,joint='curve')
for k in range(3):
    y=top+46*X4+k*32*X4
    d.line((cx-half+24*X4,y-4*X4,cx-22*X4,y+6*X4),fill=col,width=5*X4); d.line((cx+22*X4,y+6*X4,cx+half-24*X4,y-4*X4),fill=col,width=5*X4)
d.line((cx-half-10*X4,bot-14*X4,cx-half-10*X4,bot+4*X4,cx,bot+18*X4,cx+half+10*X4,bot+4*X4,cx+half+10*X4,bot-14*X4),fill=col,width=lw,joint='curve')
cs=15*X4; ccx=cx+half-36*X4; ccy=top-4*X4
d.ellipse((ccx-25*X4,ccy-25*X4,ccx+25*X4,ccy+25*X4),fill=(226,150,120))
d.rectangle((ccx-5*X4,ccy-cs+2*X4,ccx+5*X4,ccy+cs-2*X4),fill='white'); d.rectangle((ccx-cs+2*X4,ccy-5*X4,ccx+cs-2*X4,ccy+5*X4),fill='white')
img=draw_label(big.resize((625,546),Image.LANCZOS),'衛教專區',275,389,col)
out[1140:1686,X0:X0+625]=np.asarray(img)
# ── 中間品牌帶：副標下方加膠囊標籤 ──
band=Image.fromarray(out.clip(0,255).astype('uint8'))
big=band.resize((2500*X4,1686*X4),Image.LANCZOS); d=ImageDraw.Draw(big)
txt=sys.argv[2] if len(sys.argv)>2 else '週六、週日與平日夜間都有門診'; f=ImageFont.truetype(F,int(sys.argv[3]) *X4 if len(sys.argv)>3 else 50*X4)
tw=d.textlength(txt,font=f); pcx=1095*X4; pcy=1081*X4; ph=(int(sys.argv[3]) if len(sys.argv)>3 else 50)*X4+26*X4; pw=tw+56*X4
d.rounded_rectangle((pcx-pw/2,pcy-ph/2,pcx+pw/2,pcy+ph/2),radius=ph/2,fill=(124,154,110))
d.text((pcx,pcy+2*X4),txt,font=f,fill=(255,255,255),anchor='mm')
final=big.resize((2500,1686),Image.LANCZOS)
final.save(sys.argv[1],quality=88,optimize=True)
print('pill width px', round(pw/X4), 'x range', round((pcx-pw/2)/X4), round((pcx+pw/2)/X4))
