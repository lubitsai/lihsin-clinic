#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gsc_core_queries.py — 五個核心 Query 雙窗口比較表（03 §九，2026-09-25ao 院長裁示新增）

院長裁示：GSC 升為專案第一量測優先；五個核心 Query 固定比較
「最近 7 天 vs 前 7 天」與「最近 28 天 vs 前 28 天」的
曝光／點擊／CTR／平均排名／Landing Page。

本工具只做「把院長從 GSC 後台匯出的檔案合成比較表」——session 沒有 GSC API
權限（03 §9-5），**不產生、不推估任何數字**。缺哪一格就印「—／未匯出」。

用法：
    python3 internal/tools/gsc_core_queries.py [輸入 ...] [--out FILE] [--detail]
    python3 internal/tools/gsc_core_queries.py --selftest

輸入：GSC「成效 → 匯出 → 下載 CSV」得到的 .zip，或其中單一 .csv。
      可加前綴標註（自動判斷失敗時才需要）：
        7=檔案        指定窗口為 7 天
        28=檔案       指定窗口為 28 天
        t3:28=檔案    指定這份是「#3 台南疫苗」篩選後的 28 天匯出（用於 Landing Page）
      一份 zip 裡的「查詢」表 → 算指標；「網頁」表 → 只有在該匯出**已用 03 §9-3 的
      規則運算式篩到單一主題**時才算 Landing Page（未篩選的網頁表混了全站流量，不可用）。

退出碼：0 成功／1 輸入無法解析／2 自測失敗
"""

import argparse
import csv
import io
import pathlib
import re
import sys
import tempfile
import zipfile

# ── 主題定義（與 03 §9-1 同步；改這裡必須同批改 03）────────────────────
# 比對前先正規化：去空白、轉小寫、「臺」→「台」。
# 依 PRIORITY 順序「先中先得」，每個查詢只歸一個主題，避免重複計算。
OTHER_CITIES = re.compile(r'台北|新北|台中|新竹|高雄|嘉義|桃園|基隆|彰化|苗栗|雲林|屏東|宜蘭|花蓮|台東')

TOPICS = {
    # id: (名稱, 規則, 承載頁, 可接受分流頁規則)
    'B':  ('立欣診所（品牌對照列）',
           lambda q: re.search(r'立欣|lihsin|li-hsin|lhped', q),
           '/', None),
    't3': ('台南疫苗',
           lambda q: re.search(r'(台南|北區).*疫苗|疫苗.*(台南|北區)', q),
           '/services/vaccination.html',
           re.compile(r'^/news/flu-vaccine[\w-]*\.html$|^/health/[\w-]*vaccine[\w-]*\.html$')),
    't4': ('台南家醫科',
           lambda q: re.search(r'(台南|北區).*(家醫|家庭醫學)|(家醫|家庭醫學).*(台南|北區)', q),
           '/services/family-medicine.html', None),
    't2': ('北區小兒科',
           lambda q: '北區' in q and re.search(r'兒科|小兒', q),
           '/', None),
    't1': ('台南兒科',
           lambda q: '台南' in q and re.search(r'兒科|小兒', q),
           '/', None),
    't5': ('台南北區診所',
           lambda q: '北區' in q and '診所' in q,
           '/', None),
}
PRIORITY = ['B', 't3', 't4', 't2', 't1', 't5']

# 院長在 GSC 篩選器「查詢 → 自訂（規則運算式）」貼上的字串（03 §9-3 逐字同步；GSC 用 RE2，不支援 lookahead，
# 所以互斥歸類交給上面的 classify，篩選器只負責「把該主題的查詢全部撈進來」）
TN = '(台|臺)南'
GSC_REGEX = {
    't1': f'{TN}.*(兒科|小兒)|(兒科|小兒).*{TN}',
    't2': '北區.*(兒科|小兒)|(兒科|小兒).*北區',
    't3': f'({TN}|北區).*疫苗|疫苗.*({TN}|北區)',
    't4': f'({TN}|北區).*(家醫|家庭醫學)|(家醫|家庭醫學).*({TN}|北區)',
    't5': '北區.*診所|診所.*北區',
}
# 週快版用的聯集：一份匯出涵蓋五詞＋品牌對照列，列數遠低於 GSC 匯出上限 1,000 列
GSC_REGEX_ALL = (f'立欣|({TN}|北區).*(兒科|小兒|疫苗|家醫|家庭醫學|診所)'
                 f'|(兒科|小兒|疫苗|家醫|家庭醫學|診所).*({TN}|北區)')
CORE = ['t1', 't2', 't3', 't4', 't5']      # 顯示順序＝院長裁示原順序
WINDOWS = ['7', '28']

# 樣本不足門檻（提案值，待院長核可；03 §9-6）：任一期曝光低於此數 → 不解讀百分比
MIN_IMPR = {'7': 50, '28': 100}


def norm_query(q):
    return re.sub(r'\s+', '', q).lower().replace('臺', '台')


def classify(q):
    n = norm_query(q)
    for tid in PRIORITY:
        if tid in ('t2', 't5') and OTHER_CITIES.search(n):
            continue
        if tid in ('t1', 't3', 't4') and OTHER_CITIES.search(n) and '台南' not in n:
            continue
        if TOPICS[tid][1](n):
            return tid
    return None


def norm_page(url):
    """GSC 會把 /x 與 /x.html 當兩筆（量測紀錄_202609 A-5）→ 一律收斂成 .html 正規版。"""
    p = re.sub(r'^https?://[^/]+', '', url.strip()).split('?')[0].split('#')[0] or '/'
    if p.endswith('/index.html'):
        p = p[:-len('index.html')]
    elif not p.endswith('/') and not re.search(r'\.\w+$', p):
        p += '.html'
    return p


# ── CSV 解析 ──────────────────────────────────────────────────────────
METRIC_KEYS = [
    ('clicks', re.compile(r'點擊|clicks', re.I)),
    ('impr', re.compile(r'曝光|impressions', re.I)),
    ('ctr', re.compile(r'點閱率|ctr', re.I)),
    ('pos', re.compile(r'排名|排序|position', re.I)),
]
PREV_RE = re.compile(r'previous|prior|前一|先前|上一|前期|前\s*\d+\s*天', re.I)
CUR_RE = re.compile(r'last|current|過去|最近|本期|近\s*\d+\s*天', re.I)


def to_num(s):
    s = (s or '').strip().replace(',', '').replace('%', '')
    try:
        return float(s)
    except ValueError:
        return None


def parse_table(text):
    """回傳 (種類, 維度欄名, rows)；種類 = query / page / filter / other。
    rows: [{'key': 維度值, 'cur': {指標}, 'prev': {指標} 或 None}]"""
    rows = list(csv.reader(io.StringIO(text.lstrip('﻿'))))
    if not rows:
        return 'other', '', []
    header = rows[0]
    h0 = header[0]
    if re.search(r'篩選|filter', h0, re.I):
        return 'filter', h0, rows[1:]
    if re.search(r'查詢|quer', h0, re.I):
        kind = 'query'
    elif re.search(r'網頁|頁面|page', h0, re.I):
        kind = 'page'
    else:
        return 'other', h0, []
    cols = {}                                  # metric -> [(idx, period)]
    for i, h in enumerate(header[1:], start=1):
        for m, rx in METRIC_KEYS:
            if rx.search(h):
                hh = h.replace('目前', '')
                period = 'prev' if PREV_RE.search(hh) else ('cur' if CUR_RE.search(hh) else None)
                cols.setdefault(m, []).append((i, period))
                break
    colmap = {}
    for m, lst in cols.items():
        if len(lst) == 1:
            colmap[(m, 'cur')] = lst[0][0]
        else:
            # GSC 比較匯出的欄位順序＝本期在前；只有標頭認不出期別時才用這個後備規則
            for n, (i, period) in enumerate(lst[:2]):
                colmap[(m, period or ('cur' if n == 0 else 'prev'))] = i
    has_prev = any(p == 'prev' for (_, p) in colmap)
    out = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        rec = {'key': r[0].strip(), 'cur': {}, 'prev': {} if has_prev else None}
        for (m, p), i in colmap.items():
            v = to_num(r[i]) if i < len(r) else None
            rec[p][m] = v
        out.append(rec)
    return kind, h0, out


def window_hint(text):
    m = re.search(r'(\d+)\s*(天|days?)', text, re.I)
    if m and m.group(1) in WINDOWS:
        return m.group(1)
    return None


def load_input(spec):
    """spec: [tid:][win=]path → dict(tables, window, topic_hint, src)"""
    topic = win = None
    m = re.match(r'^(?:(t[1-5]):)?(?:(7|28)=)?(.+)$', spec)
    topic, win, path = m.group(1), m.group(2), pathlib.Path(m.group(3))
    texts = []
    if path.suffix.lower() == '.zip':
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.lower().endswith('.csv'):
                    texts.append((n, z.read(n).decode('utf-8-sig', errors='replace')))
    else:
        texts.append((path.name, path.read_text(encoding='utf-8-sig', errors='replace')))
    tables = {}
    hint_text = ''
    filter_text = ''
    for name, t in texts:
        kind, h0, rows = parse_table(t)
        if kind in ('query', 'page'):
            tables[kind] = rows
            hint_text += t.split('\n', 1)[0] + '\n'
        elif kind == 'filter':
            filter_text += '\n'.join(','.join(r) for r in rows) + '\n'
    win = win or window_hint(filter_text) or window_hint(hint_text)   # 篩選器.csv 的日期列優先於欄位標頭
    if not topic and GSC_REGEX_ALL not in filter_text:
        hits = [t for t, rx in GSC_REGEX.items() if rx in filter_text]
        topic = max(hits, key=lambda t: len(GSC_REGEX[t])) if hits else None
    return {'tables': tables, 'window': win, 'topic': topic, 'src': str(path)}


# ── 聚合 ──────────────────────────────────────────────────────────────
def agg(rows):
    """點擊、曝光加總；CTR＝點擊/曝光；排名＝以曝光加權。"""
    c = sum((r.get('clicks') or 0) for r in rows)
    i = sum((r.get('impr') or 0) for r in rows)
    pw = sum((r.get('pos') or 0) * (r.get('impr') or 0) for r in rows)
    return {'clicks': c, 'impr': i,
            'ctr': (c / i * 100) if i else None,
            'pos': (pw / i) if i else None}


def build(inputs):
    qrows = {w: {} for w in WINDOWS}       # window -> {query: rec}（多份匯出同查詢以後者為準，不重複加總）
    pages = {}                             # (window, tid) -> [rec]
    notes = []
    for inp in inputs:
        w = inp['window']
        if w not in WINDOWS:
            notes.append(f'⚠️ `{inp["src"]}` 判斷不出是 7 天還是 28 天 → 略過（請用 `7=` 或 `28=` 前綴標註）')
            continue
        q = inp['tables'].get('query', [])
        for r in q:
            qrows[w][r['key']] = r
        if 'page' in inp['tables']:
            tid = inp['topic']
            if not tid:
                # 篩選器.csv 認不出時的後備：由同一份匯出的查詢表推斷（單一主題篩選 → 該主題過半）
                share = {}
                tot = 0
                for r in q:
                    im = r['cur'].get('impr') or 0
                    tot += im
                    t = classify(r['key'])
                    share[t] = share.get(t, 0) + im
                best = max(share, key=share.get) if share else None
                if best in CORE and tot and share[best] / tot >= 0.5:
                    tid = best
            if tid:
                pages[(w, tid)] = inp['tables']['page']
            elif q:
                notes.append(f'ℹ️ `{inp["src"]}` 的網頁表未篩選單一主題 → 不用於 Landing Page（屬正常，未篩選匯出只拿來算指標）')
    result = {}
    for w in WINDOWS:
        buckets = {t: {'cur': [], 'prev': [], 'queries': []} for t in TOPICS}
        has_prev = False
        for key, r in qrows[w].items():
            t = classify(key)
            if not t:
                continue
            buckets[t]['cur'].append(r['cur'])
            if r['prev'] is not None:
                has_prev = True
                buckets[t]['prev'].append(r['prev'])
            buckets[t]['queries'].append(r)
        for t, b in buckets.items():
            result[(w, t)] = {
                'loaded': bool(qrows[w]),
                'cur': agg(b['cur']), 'prev': agg(b['prev']) if has_prev else None,
                'queries': sorted(b['queries'], key=lambda r: -(r['cur'].get('impr') or 0)),
                'pages': pages.get((w, t)),
            }
    return result, notes


# ── 輸出 ──────────────────────────────────────────────────────────────
def fmt_int(v):
    return '—' if v is None else f'{v:,.0f}'


def pct(a, b):
    if a is None or b is None:
        return ''
    if a == 0:
        return '（新）' if b else ''
    return f'（{(b - a) / a * 100:+.0f}%）'


def cell_count(prev, cur, m):
    if prev is None:
        return fmt_int(cur[m])
    return f'{fmt_int(prev[m])} → **{fmt_int(cur[m])}**{pct(prev[m], cur[m])}'


def cell_ctr(prev, cur):
    c = '—' if cur['ctr'] is None else f'{cur["ctr"]:.2f}%'
    if prev is None:
        return c
    p = '—' if prev['ctr'] is None else f'{prev["ctr"]:.2f}%'
    d = f'（{cur["ctr"] - prev["ctr"]:+.2f}pp）' if cur['ctr'] is not None and prev['ctr'] is not None else ''
    return f'{p} → **{c}**{d}'


def cell_pos(prev, cur):
    c = '—' if cur['pos'] is None else f'{cur["pos"]:.1f}'
    if prev is None:
        return c
    p = '—' if prev['pos'] is None else f'{prev["pos"]:.1f}'
    d = ''
    if cur['pos'] is not None and prev['pos'] is not None:
        diff = prev['pos'] - cur['pos']             # 排名數字變小＝進步
        d = f'（{"↑" if diff > 0 else "↓" if diff < 0 else "＝"}{abs(diff):.1f}）'
    return f'{p} → **{c}**{d}'


def landing(res, tid):
    rows = res['pages']
    if rows is None:
        return '未匯出', ''
    merged = {}
    for r in rows:
        k = norm_page(r['key'])
        e = merged.setdefault(k, {'c': 0, 'i': 0, 'pc': 0, 'pi': 0})
        e['c'] += r['cur'].get('clicks') or 0
        e['i'] += r['cur'].get('impr') or 0
        if r['prev']:
            e['pc'] += r['prev'].get('clicks') or 0
            e['pi'] += r['prev'].get('impr') or 0
    if not merged:
        return '（無資料）', ''
    top = max(merged, key=lambda k: (merged[k]['c'], merged[k]['i']))
    ptop = max(merged, key=lambda k: (merged[k]['pc'], merged[k]['pi']))
    tot = sum(e['i'] for e in merged.values()) or 1
    _, _, carrier, alt = TOPICS[tid]
    if top == carrier:
        flag = '✅ 承載頁'
    elif alt and alt.search(top):
        flag = '🟡 分流頁（單品項／流感頁，非撞題）'
    else:
        flag = f'⚠️ 非承載頁（應為 `{carrier}`）→ 02 R2／R7'
    shift = '' if ptop == top or not any(e['pi'] for e in merged.values()) else f'；前期為 `{ptop}` ⚠️ 換頁'
    return f'`{top}`（曝光占 {merged[top]["i"] / tot * 100:.0f}%）{shift}', flag


def render(result, notes, detail=False):
    L = ['# 五個核心 Query｜雙窗口比較（`03` §九）', '',
         '> 由 `internal/tools/gsc_core_queries.py` 自院長匯出檔合成；**數字全部來自 GSC 匯出，本工具不推估**。',
         '> 查詢層指標＝該主題所有變體查詢加總（CTR＝點擊÷曝光；平均排名＝以曝光加權）。'
         'GSC 會隱匿低頻查詢，故主題合計**一律是低估**、與後台總表不相等屬正常。', '']
    for w in WINDOWS:
        title = f'## 最近 {w} 天 vs 前 {w} 天'
        if not result[(w, 't1')]['loaded']:
            L += [title, '', f'（未匯出 {w} 天檔案）', '']
            continue
        L += [title, '',
              '| # | 核心 Query | 曝光 前→本 | 點擊 前→本 | CTR 前→本 | 平均排名 前→本 | 本期主要 Landing Page | 判定 |',
              '|---|---|---|---|---|---|---|---|']
        for n, t in enumerate(CORE + ['B'], start=1):
            r = result[(w, t)]
            cur, prev = r['cur'], r['prev']
            lp, flag = landing(r, t)
            small = prev is not None and min(cur['impr'], prev['impr']) < MIN_IMPR[w]
            if not r['queries']:
                flag = '查無（匯出中沒有此主題的查詢列＝曝光極低或被 GSC 隱匿）'
            elif small:
                flag = (flag + '；' if flag else '') + f'樣本少（曝光<{MIN_IMPR[w]}）百分比不解讀'
            label = 'B' if t == 'B' else str(n)
            L.append(f'| {label} | {TOPICS[t][0]} | {cell_count(prev, cur, "impr")} | '
                     f'{cell_count(prev, cur, "clicks")} | {cell_ctr(prev, cur)} | '
                     f'{cell_pos(prev, cur)} | {lp} | {flag} |')
        L += ['', '> B 列＝品牌對照，**不與 1–5 平均**（03 §9-3 ②）。排名 ↑＝名次數字變小＝進步。', '']
    if detail:
        L += ['## 附：各主題歸入的查詢（依本期曝光，前 10）', '']
        for w in WINDOWS:
            for t in CORE + ['B']:
                qs = result[(w, t)]['queries'][:10]
                if not qs:
                    continue
                L.append(f'- **{w} 天｜{TOPICS[t][0]}**：' + '、'.join(
                    f'{q["key"]}（{fmt_int(q["cur"].get("impr"))}）' for q in qs))
        L.append('')
    if notes:
        L += ['## 附：輸入檔提示', ''] + [f'- {n}' for n in notes] + ['']
    return '\n'.join(L)


# ── 自測 ──────────────────────────────────────────────────────────────
def selftest():
    cases = {
        '台南兒科': 't1', '臺南 小兒科': 't1', '台南兒科推薦': 't1',
        '北區小兒科': 't2', '台南北區小兒科': 't2', '台中北區小兒科': None,
        '台南疫苗': 't3', '台南流感疫苗': 't3', '台南兒科疫苗': 't3', '北區疫苗': 't3',
        '台南家醫科': 't4', '台南北區家庭醫學科': 't4',
        '台南北區診所': 't5', '北區 診所': 't5', '新竹北區診所': None,
        '立欣診所': 'B', '立欣診所 台南北區': 'B', '台南 診所': None, '流感疫苗': None,
    }
    bad = [(q, classify(q), e) for q, e in cases.items() if classify(q) != e]
    assert not bad, f'classify 失敗：{bad}'
    # 院長貼進 GSC 的規則運算式必須撈得到 classify 歸進該主題的查詢（否則篩選匯出會漏列）
    for q, e in cases.items():
        n = norm_query(q)
        if e in GSC_REGEX:
            assert re.search(GSC_REGEX[e], q) or re.search(GSC_REGEX[e], n), f'GSC_REGEX[{e}] 撈不到 {q}'
        if e:
            assert re.search(GSC_REGEX_ALL, n), f'GSC_REGEX_ALL 撈不到 {q}'
    assert norm_page('https://lhpedclinic.com.tw/services/vaccination') == '/services/vaccination.html'
    assert norm_page('https://lhpedclinic.com.tw/index.html') == '/'
    assert norm_page('https://lhpedclinic.com.tw/team/') == '/team/'

    en_q = ('Top queries,Last 7 days Clicks,Previous 7 days Clicks,Last 7 days Impressions,'
            'Previous 7 days Impressions,Last 7 days CTR,Previous 7 days CTR,'
            'Last 7 days Position,Previous 7 days Position\n'
            '台南兒科,10,5,100,80,10%,6.25%,4.0,6.0\n'
            '台南小兒科,0,1,100,20,0%,5%,8.0,9.0\n'
            '立欣診所,30,28,60,55,50%,50.91%,1.0,1.0\n'
            '克流感,3,0,300,0,1%,0%,7.2,0\n')
    zh_q = ('熱門查詢,過去 28 天點擊次數,前 28 天點擊次數,過去 28 天曝光次數,前 28 天曝光次數,'
            '過去 28 天點閱率,前 28 天點閱率,過去 28 天排名,前 28 天排名\n'
            '台南疫苗,4,2,"1,000",500,0.4%,0.4%,5.0,7.0\n'
            '台南流感疫苗,6,0,200,0,3%,0%,3.0,0\n')
    zh_p = ('熱門網頁,過去 28 天點擊次數,前 28 天點擊次數,過去 28 天曝光次數,前 28 天曝光次數,'
            '過去 28 天點閱率,前 28 天點閱率,過去 28 天排名,前 28 天排名\n'
            'https://lhpedclinic.com.tw/services/vaccination,1,2,300,400,1%,1%,6,7\n'
            'https://lhpedclinic.com.tw/services/vaccination.html,2,0,200,50,1%,0%,6,7\n'
            'https://lhpedclinic.com.tw/news/flu-vaccine-2026.html,7,0,700,50,1%,0%,4,8\n')
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        (d / 'q7.csv').write_text(en_q, encoding='utf-8-sig')
        with zipfile.ZipFile(d / 't3.zip', 'w') as z:
            z.writestr('查詢.csv', zh_q)
            z.writestr('網頁.csv', zh_p)
        with zipfile.ZipFile(d / 'f.zip', 'w') as z:
            z.writestr('篩選器.csv', f'篩選器,值\n搜尋類型,網頁\n查詢,~{GSC_REGEX["t4"]}\n日期,比較過去 7 天與前一期\n')
            z.writestr('網頁.csv', zh_p)
        f = load_input(str(d / 'f.zip'))
        assert f['topic'] == 't4' and f['window'] == '7', (f['topic'], f['window'])
        inputs = [load_input(str(d / 'q7.csv')), load_input(str(d / 't3.zip'))]
    assert inputs[0]['window'] == '7' and inputs[1]['window'] == '28', [i['window'] for i in inputs]
    res, _ = build(inputs)
    t1 = res[('7', 't1')]
    assert t1['cur']['clicks'] == 10 and t1['cur']['impr'] == 200 and t1['prev']['clicks'] == 6
    assert abs(t1['cur']['pos'] - 6.0) < 1e-9, t1['cur']['pos']           # (4*100+8*100)/200
    assert abs(t1['prev']['pos'] - 6.6) < 1e-9, t1['prev']['pos']         # (6*80+9*20)/100
    assert res[('7', 'B')]['cur']['clicks'] == 30
    t3 = res[('28', 't3')]
    assert t3['cur']['impr'] == 1200 and t3['prev']['impr'] == 500
    assert t3['pages'] is not None, '篩選匯出應自動判定為 t3'
    lp, flag = landing(t3, 't3')
    assert '/news/flu-vaccine-2026.html' in lp and flag.startswith('🟡'), (lp, flag)
    assert '換頁' in lp                                                   # 前期主要頁是 vaccination.html（兩筆合併 2 點擊）
    out = render(res, [])
    assert '| 1 | 台南兒科 |' in out and '| B | 立欣診所' in out
    print('selftest OK')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='*')
    ap.add_argument('--out')
    ap.add_argument('--detail', action='store_true', help='列出各主題歸入的查詢（核對歸類用）')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        try:
            selftest()
        except AssertionError as e:
            print(f'selftest FAIL: {e}', file=sys.stderr)
            return 2
        return 0
    if not a.inputs:
        ap.print_help()
        return 1
    try:
        inputs = [load_input(s) for s in a.inputs]
    except (OSError, zipfile.BadZipFile) as e:
        print(f'無法讀取輸入：{e}', file=sys.stderr)
        return 1
    if not any(i['tables'].get('query') for i in inputs):
        print('輸入中找不到 GSC「查詢」表（第一欄標頭應為「熱門查詢」／Top queries）', file=sys.stderr)
        return 1
    result, notes = build(inputs)
    md = render(result, notes, a.detail)
    if a.out:
        pathlib.Path(a.out).write_text(md + '\n', encoding='utf-8')
        print(f'已寫入 {a.out}')
    else:
        print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main())
