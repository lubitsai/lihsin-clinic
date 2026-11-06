"""LINE Flex 卡片簡易預覽（本機用，非官方渲染器；版面近似，用來檢查配色、文字、按鈕）。
用法：python3 internal/line-oa/preview_flex.py internal/line-helpdesk/legacy_messages.json preview.html
圖片：storage.googleapis.com 的圖會讀 ./img/<檔名>，請先下載到 img/；其他網址照原樣載入。"""
import json, sys, html
SZ={'xxs':11,'xs':13,'sm':14,'md':16,'lg':19,'xl':22,'xxl':29,'3xl':35}
SP={'none':0,'xs':2,'sm':4,'md':8,'lg':12,'xl':16,'xxl':20}
IM={'xxs':40,'xs':60,'sm':80,'md':100,'lg':120,'xl':140,'xxl':160,'3xl':180,'4xl':200,'5xl':240}
def px(v,table=SP):
    if v is None: return None
    return v if str(v).endswith('px') else f"{table.get(v,0)}px"
def loc(u): return 'img/'+u.rsplit('/',1)[1] if 'storage.googleapis.com' in u else u
def comp(c, parent='vertical', first=False):
    t=c['type']; st=[]
    m=c.get('margin')
    if m and not first: st.append(('margin-top' if parent!='horizontal' else 'margin-left')+':'+px(m))
    if c.get('offsetStart'): st.append('margin-left:'+px(c['offsetStart']))
    if t=='box':
        lay=c['layout']; st.append('display:flex;flex-direction:'+('column' if lay=='vertical' else 'row'))
        if lay=='baseline': st.append('align-items:baseline')
        if c.get('alignItems')=='center': st.append('align-items:center')
        for k,css in [('backgroundColor','background'),('borderColor','border-color')]:
            if c.get(k): st.append(f'{css}:{c[k]}')
        if c.get('borderWidth'): st.append(f"border:{c['borderWidth']} solid {c.get('borderColor','#000')}")
        if c.get('cornerRadius'): st.append('border-radius:'+px(c['cornerRadius'],{'none':0,'xs':2,'sm':4,'md':8,'lg':12,'xl':16,'xxl':20}))
        for k in ('paddingAll','paddingTop','paddingBottom','paddingStart','paddingEnd'):
            if c.get(k):
                css={'paddingAll':'padding','paddingTop':'padding-top','paddingBottom':'padding-bottom','paddingStart':'padding-left','paddingEnd':'padding-right'}[k]
                st.append(css+':'+px(c[k]))
        if c.get('width'): st.append('width:'+c['width'])
        if c.get('height'): st.append('min-height:'+c['height'])
        gap=c.get('spacing'); 
        if gap: st.append('gap:'+px(gap))
        inner=''.join(comp(dict(x,_flex=1) if lay=='horizontal' else x,lay,i==0) for i,x in enumerate(c.get('contents',[])))
        return f'<div style="{";".join(st)}">{inner}</div>'
    if t=='text':
        st+= [f"font-size:{SZ.get(c.get('size','md'),16)}px", f"color:{c.get('color','#111')}", 'font-weight:'+('bold' if c.get('weight')=='bold' else 'normal'),
              'text-align:'+{'center':'center','end':'right'}.get(c.get('align'),'left'),'white-space:pre-wrap','line-height:1.45']
        return f'<div style="{";".join(st)}">{html.escape(c["text"])}</div>'
    if t=='image':
        w=IM.get(c.get('size','md'),100)
        return f'<div style="{";".join(st)};display:flex;justify-content:center"><img src="{loc(c["url"])}" style="width:{w}px;max-width:100%"></div>'
    if t=='icon':
        return '<span style="color:#f5b301;margin-right:4px">★</span>'
    if t=='separator':
        return f'<div style="{";".join(st)};border-top:1px solid {c.get("color","#ddd")}"></div>'
    if t=='button':
        sec=c.get('style')=='secondary'
        if c.get('_flex'): st.append('flex:1')
        st+=[f"background:{c.get('color','#17c950')}",'color:'+('#111' if sec else '#fff'),'border-radius:8px','text-align:center',
             'padding:'+('8px' if c.get('height')=='sm' else '12px'),'font-size:15px','font-weight:bold' if not sec else 'font-weight:normal']
        return f'<div class="btn" style="{";".join(st)}">{html.escape(c["action"]["label"])}</div>'
    return ''
def bubble(b):
    parts=[]
    if b.get('header'):
        h=b['header']; parts.append(f'<div style="background:{h.get("backgroundColor","#fff")};padding:16px;min-height:{h.get("height","auto")};box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">{"".join(comp(x) for x in h["contents"])}</div>')
    if b.get('hero'):
        parts.append(f'<img src="{loc(b["hero"]["url"])}" style="width:100%;display:block;aspect-ratio:20/13;object-fit:cover">')
    bd=b['body']; parts.append(f'<div style="padding:20px">{comp(dict(bd))}</div>')
    if b.get('footer'): parts.append(f'<div style="padding:0 20px 20px">{comp(dict(b["footer"]))}</div>')
    return f'<div class="bub">{"".join(parts)}</div>'
def page(msgs,title):
    cards=[]
    for name,m in msgs:
        c=m['contents']; bs=c['contents'] if c['type']=='carousel' else [c]
        cards.append(f'<h2>{html.escape(name)}</h2><div class="row">{"".join(bubble(b) for b in bs)}</div>')
    return f'''<!doctype html><meta charset="utf-8"><title>{title}</title><style>body{{margin:0;padding:16px;background:#8EA9D6;font-family:"WenQuanYi Zen Hei",sans-serif}}
h2{{color:#fff;font-size:18px;margin:14px 4px 8px}}.row{{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}}
.bub{{width:300px;background:#fff;border-radius:18px;overflow:hidden;box-sizing:border-box}}</style>{"".join(cards)}'''
if __name__=='__main__':
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    order=['診療項目','醫師介紹','診所資訊','過敏減重諮詢']
    open(sys.argv[2],'w',encoding='utf-8').write(page([(k,d[k]) for k in order],'preview'))
