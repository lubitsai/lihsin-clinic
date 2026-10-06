"""Build faq.json from the website assistant's knowledge.json (the single source of truth).

    python3 build_faq.py                       # fetch from the live website, write faq.json
    python3 build_faq.py --kb ../lihsin-clinic/clinic-assistant/knowledge.json \
                         --search-js ../lihsin-clinic/clinic-assistant/search.js
    python3 build_faq.py --check               # do not write; exit 1 if faq.json is stale

What it does, in order:
  1. Every FAQ answer goes through present(), ported from the website's search.js: vaccine caveats,
     COVID note, public-vaccine registration fee, opening-hours note, seasonal note, and the
     "no price except registration fees" rule. Nothing is added beyond what the website shows.
  2. LINE wording (approved by the clinic director, 2026-10-03): "或加 LINE @lhpedclinic" style
     contact lines become "在此聊天室輸入「專人服務」", because the reader is already in our LINE.
     Every rewrite is listed in LINE用語改寫對照.csv for spot checks.
  3. Opening hours, contact and fee replies are generated from knowledge.json, not typed by hand.
  3b. Self-pay prices (director 2026-10-05): rules and website replies come from knowledge.json `prices`;
      prices_line.json adds the LINE-only promotion wording (the website must not mention promotions).
  4. Extra question wordings come from aliases.json; collisions fail the build.
  5. With --search-js, the triage regexes in core.py must equal the website's, or the build fails.
"""
import argparse
import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import urlopen

import core

ROOT = Path(__file__).parent
SITE_KB = 'https://lhpedclinic.com.tw/clinic-assistant/knowledge.json'
SITE_JS = 'https://lhpedclinic.com.tw/clinic-assistant/search.js'
# Inside the website repo (internal/line-helpdesk/) read the repo's own files; a standalone deploy copy reads the live site.
REPO_ASSISTANT = ROOT.parents[1] / 'clinic-assistant'
if (REPO_ASSISTANT / 'knowledge.json').exists():
    SITE_KB, SITE_JS = str(REPO_ASSISTANT / 'knowledge.json'), str(REPO_ASSISTANT / 'search.js')

# ── website search.js constants (system-instruction notes), ported verbatim ──
HOURS_NOTE = '實際門診時間以官網 https://lhpedclinic.com.tw 公告為準，建議來電或 LINE 確認。'
COVID_NOTE = '提醒：本院沒有提供新冠疫苗；「左流右新」是疾管署的共同接種政策說明。'
COVID = re.compile(r'新冠疫苗|covid19疫苗|covid疫苗|左流右新|莫德納|輝瑞|諾瓦瓦克斯')
VACCINE_NOTE = '接種提醒：適用對象與劑次依原廠仿單記載，由醫師評估；現貨與到貨情形請先來電或 LINE 確認。發燒或急性疾病期應暫緩接種，有禁忌者不接種。'
PRICE = re.compile(r'費用|價格|多少錢|價錢|折扣|收費|價位|要錢嗎|免費嗎|自費多少|掛號費|部分負擔|費多少')

# ── LINE wording (director-approved 2026-10-03) ──
LINE_HERE = '在此聊天室輸入「專人服務」'
CONTACT = '請來電 06-2516086 或' + LINE_HERE + '詢問。'
OTHER_FEES = '自費疫苗、快篩、減重等項目的費用，可以直接輸入項目名稱查詢（例如「水痘疫苗多少錢」）；其他自費項目' + CONTACT
HANDLE = r'LINE\s*@lhpedclinic'
LINE_RULES = [
    # 「或 LINE @lhpedclinic 確認」「或加／洽官方 LINE @lhpedclinic」；「或 LINE @lhpedclinic 預約」指圖文選單預約，保留
    (re.compile(r'或\s*(?:加|洽官方|洽|以)?\s*(?:官方\s*)?' + HANDLE + r'(?!\s*(?:線上)?預約)\s*'), '或' + LINE_HERE),
    # 「也可洽官方 LINE @lhpedclinic」
    (re.compile(r'(?:加|洽官方|洽)\s*(?:官方\s*)?' + HANDLE + r'\s*'), LINE_HERE),
    # 聯絡方式並列：「電話 06-2516086，LINE @lhpedclinic」
    (re.compile(r'\s*、\s*' + HANDLE + r'(?!\s*(?:線上)?預約)\s*'), '或' + LINE_HERE),
    (re.compile(r'\s*[，｜]\s*' + HANDLE + r'(?!\s*(?:線上)?預約)\s*'), '，或' + LINE_HERE),
    # 「LINE @lhpedclinic｜06-2516086」：讀者已在 LINE 裡，只留電話
    (re.compile(HANDLE + r'\s*｜\s*'), ''),
    # 公費品牌公告（官網首頁公告⑧）：讀者已加入官方帳號，改指圖文選單（院長 2026-10-05 逐字核可）
    (re.compile(r'加入「立欣診所」LINE官方帳號，點選「流感疫苗資訊」查詢最新消息'), '點選選單的「流感疫苗資訊」查詢'),
]

def line_text(text):
    for pattern, to in LINE_RULES:
        text = pattern.sub(to, text)
    return text

def present(row, kb):
    """search.js present(): append the notes the website shows under an answer."""
    notes = kb['fees']['notes']
    public_vax = next((t for t in notes if t.startswith('單純接種公費疫苗')), None)
    if row.get('fee'):
        return row['answer'] + '\n\n' + OTHER_FEES
    if PRICE.search(core.normalize(row['title'])):
        return '費用依項目與當日狀況不同，' + CONTACT
    text, all_text = row['answer'], row['title'] + row['answer']
    if re.search('疫苗|接種', all_text) and not ('仿單' in all_text and '醫師評估' in all_text
            and re.search('來電|LINE', all_text) and re.search('暫緩|急性', all_text)):
        text += '\n\n' + VACCINE_NOTE
    if COVID.search(core.normalize(all_text)):
        text += '\n\n' + COVID_NOTE
    if public_vax and '公費' in all_text and '免費' in row['answer'] and re.search('疫苗|接種', all_text):
        text += '\n\n' + public_vax
    if re.search('門診|看診時間|排班|夜診|晚診|假日|掛號', row['title']):
        text += '\n\n' + HOURS_NOTE
    if row.get('seasonal'):
        text += f"\n\n以上為 {kb['reviewed_at']} 版資料；年度政策與資格請再確認最新公告。"
    return text

def ops_items(kb):
    fx, site = kb['facts'], kb['site']
    doc = {k[0]: k for k in fx['醫師'].split('（')[0].split('、')}
    ses = {'MORNING': '上午', 'AFTERNOON': '下午', 'EVENING': '夜間'}
    day = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
    lines = []
    for k in ['1', '2', '3', '4', '5', '6', '0']:
        parts = [f"{ses[s['session']]} {s['start']}–{s['end']} {'、'.join(doc[x] for x in s['doctors'])}"
                 for s in kb['schedule']['weekly'][k]]
        lines.append(day[int(k)] + '：' + ('；'.join(parts) or '休診'))
    hours = next(p for p in kb['soon_reply'].split('\n\n') if p.startswith('立欣診所門診時間'))
    fees = '\n'.join(f'{r[0]}：掛號費 {r[1]} 元、健保部分負擔 {r[2]} 元' for r in kb['fees']['rows'])
    fees += '\n\n' + '\n'.join('・' + n for n in kb['fees']['notes']) + '\n\n' + OTHER_FEES
    tail = '\n\n詳細資訊：' + site
    rows = [
        ('KEY01', hours + '\n\n各時段看診醫師：\n' + '\n'.join(lines) + '\n\n臨時異動以官網首頁「最新門診異動」為準。' + tail),
        ('KEY02', f"{fx['名稱']}\n地址：{fx['地址']}\n電話：{fx['電話']}" + tail + '/visit-guide.html'),
        ('KEY03', '電話：' + fx['電話']),
        ('KEY04', f"網路預約：{fx['網路預約']}\n看診進度查詢：{fx['看診進度查詢']}\n預約與過號規則：{site}/visit-guide.html#booking-rules"),
        ('KEY05', '看診進度查詢：' + fx['看診進度查詢']),
        ('KEY06', fees),
        ('KEY07', fx['醫師'] + tail + '/team/'),
        ('KEY08', fx['健保']),
    ]
    return [{'id': i, 'kind': 'ops', 'questions': [], 'answer': a} for i, a in rows]

def read_source(src):
    if re.match(r'https?://', src):
        with urlopen(src, timeout=30) as r:
            return r.read()
    return Path(src).read_bytes()

# website fixed sentences reused verbatim (search.js reply('clinical'…) / reply('action'…)); parity-checked
CLINICAL = '這需要醫師當面評估才能決定，請攜帶健保卡、兒童健康手冊與目前用藥來院；疫苗現貨請先來電 06-2516086 確認。'
ACTION_TEXT = '線上小幫手無法代為預約、改期、取消，也查不到個人的預約、號次或候診時間。'
SELF_VAX_TAIL = "'自費疫苗本身的費用，' + CONTACT"

def check_regex_parity(js):
    for name, mine in (('URGENT', core.URGENT_SRC), ('SOON', core.SOON_SRC), *core.ROUTE_SRC.items()):
        m = re.search(r'^const ' + name + r' = /(.*)/;$', js, re.M)
        if not m or m.group(1) != mine:
            raise SystemExit(f'✗ core 的 {name} 與官網 search.js 不一致，請先同步 core.py')
    for name, mine in core.PINS.items():
        m = re.search(r'^const ' + name + r' = \[(.*)\];$', js, re.M)
        if not m or re.findall(r"'([^']+)'", m.group(1)) != mine:
            raise SystemExit(f'✗ core.PINS[{name}] 與官網 search.js 不一致，請先同步 core.py')
    for literal in (CLINICAL, ACTION_TEXT, SELF_VAX_TAIL):
        if literal not in js:
            raise SystemExit('✗ 固定回覆與官網 search.js 不一致：' + literal[:30])

def line_prices(kb, overrides, add_line):
    """官網 prices（比對規則＋官網版回覆）＋ LINE 覆寫（優惠文字、同行規則）→ LINE 用價目。"""
    src = kb.get('prices') or {'rules': [], 'no_data': ''}
    ids = {r['id'] for r in src['rules']}
    for key in list(overrides.get('replace', {})) + list(overrides.get('insert_before', {})):
        if key not in ids:
            raise SystemExit('✗ prices_line.json 指到官網價目沒有的規則：' + key)
    rules = []
    for r in src['rules']:
        for extra in overrides.get('insert_before', {}).get(r['id'], []):
            rules.append(dict(extra))
        rules.append(dict(r, reply=overrides.get('replace', {}).get(r['id'], r['reply'])))
    for r in rules:
        if re.search(r'瘦瘦筆|瘦瘦針|猛健樂|週纖達|胰妥讚', r['reply']):
            raise SystemExit('✗ 價目回覆不得寫藥物俗名或品牌：' + r['id'])
        text = add_line(r['id'], r['reply'])
        r['reply'] = text + ('\n\n' + VACCINE_NOTE if r['kind'] == 'vaccine' else '')
    return {'reviewed_at': src.get('reviewed_at'), 'no_data': src['no_data'] + CONTACT, 'rules': rules}

def build(kb_bytes, aliases, overrides=None):
    kb = json.loads(kb_bytes)
    items, rewrites = [], []
    def add_line(item_id, before):
        after = line_text(before)
        if after != before:
            rewrites.append((item_id, before, after))
        return after
    for r in kb['faqs']:
        shown = present(r, kb)
        items.append({'id': r['id'], 'kind': 'faq', 'title': r['title'], 'questions': [r['title']],
                      'answer': add_line(r['id'], shown), 'kb_answer': r['answer'], 'page': r['page'],
                      'source_url': kb['site'] + r['path'], 'core': bool(r.get('core')),
                      'seasonal': bool(r.get('seasonal')), **({'valid_until': r['valid_until']} if r.get('valid_until') else {})})
    items += ops_items(kb)
    for n in kb['notices']:
        qs = list(dict.fromkeys([n['title'], n['title'].split('｜')[0].strip()]))
        items.append({'id': n['id'], 'kind': 'notice', 'title': n['title'], 'questions': qs,
                      'answer': add_line(n['id'], n['answer']), 'valid_until': n['valid_until']})
    items.append({'id': 'NAV_WEBSITE', 'kind': 'navigation', 'questions': [], 'answer': kb['site'] + '/'})
    by_id = {i['id']: i for i in items}
    for item_id, extra in aliases.items():
        if item_id.startswith('_'):
            continue
        if item_id not in by_id:
            raise SystemExit('✗ aliases.json 指到不存在的題目：' + item_id)
        by_id[item_id]['questions'] += [q for q in extra if q not in by_id[item_id]['questions']]
    for i in items:
        if not i['questions']:
            raise SystemExit('✗ 沒有任何問法：' + i['id'])
    prices = line_prices(kb, overrides or {}, add_line)
    notes = kb['fees']['notes']
    note = lambda head: add_line('fee_note', next(t for t in notes if t.startswith(head)))
    fx = kb['facts']
    fee_table = next(i['answer'] for i in items if i['id'] == 'KEY06')
    replies = {
        'urgent': kb['urgent_reply'],
        'soon': kb['soon_reply'],
        'suggest_head': '以下是官網上的相關問答，請點選下方按鈕查看：',
        'unknown': '這部分我不確定，找不到足夠的資料。' + CONTACT,
        'nontext': '小幫手目前只能讀文字訊息，請直接輸入問題；需要專人查看圖片或檔案，請輸入「專人服務」。',
        'resumed': '已結束專人服務，小幫手恢復回答。之後需要專人協助，請再輸入「專人服務」。',
        'not_pending': '目前沒有等待中的專人服務，可以直接輸入問題。',
        'thanks': '不客氣！還有其他問題，可以直接輸入。',
        'pick': '請點選訊息下方的按鈕，或直接輸入完整的問題。',
        'greet': '您好，請直接輸入想查詢的問題，例如門診時間、預約方式或疫苗；需要專人協助請輸入「專人服務」。',
        'clinical': CLINICAL,
        'action': ACTION_TEXT + f"\n\n網路預約：{fx['網路預約']}\n看診進度查詢：{fx['看診進度查詢']}\n電話：{fx['電話']}",
        'booking_links': f"網路預約：{fx['網路預約']}\n電話：{fx['電話']}",
        'public_vax_note': note('單純接種公費疫苗'),
        'self_vax_note': note('單純接種自費疫苗'),
        'self_vax_tail': '自費疫苗本身的費用，' + CONTACT,
        'checkup_note': note('單純做成人預防保健'),
        'vaccine_note': VACCINE_NOTE,
        'other_fees': OTHER_FEES,
        'fee_table': fee_table,
        'greeting_reference': add_line('greeting', kb['greeting']),
        'suggestions_reference': kb['suggestions'],
    }
    data = {
        'meta': {'source': kb['source'], 'knowledge_sha256': hashlib.sha256(kb_bytes).hexdigest(),
                 'reviewed_at': kb['reviewed_at'], 'site': kb['site'],
                 'counts': {k: sum(i['kind'] == k for i in items) for k in ('faq', 'ops', 'notice', 'navigation')}},
        'replies': replies,
        'prices': prices,
        'items': items,
    }
    cat = core.Catalog(data)  # raises on duplicate normalized questions
    for s in kb['suggestions']:
        if not cat.lookup(s, datetime.now(timezone(timedelta(hours=8))).date()):
            raise SystemExit('✗ 歡迎詞快捷問題沒有對應答案，請補 aliases.json：' + s)
    leftover = [i['id'] for i in items if '@lhpedclinic' in i['answer']]
    return data, rewrites, leftover

def main():
    ap = argparse.ArgumentParser(description='knowledge.json → faq.json')
    ap.add_argument('--kb', default=SITE_KB, help='knowledge.json 路徑或網址（在官網 repo 內預設讀 repo 檔，否則讀官網線上）')
    ap.add_argument('--search-js', default=SITE_JS, help='search.js 路徑或網址，用來核對緊急字詞規則；給空字串略過')
    ap.add_argument('--out', default=str(ROOT / 'faq.json'))
    ap.add_argument('--check', action='store_true', help='不寫檔；faq.json 與來源不一致即 exit 1')
    a = ap.parse_args()
    if a.search_js:
        check_regex_parity(read_source(a.search_js).decode('utf-8'))
    aliases = json.loads((ROOT / 'aliases.json').read_text(encoding='utf-8'))
    overrides = json.loads((ROOT / 'prices_line.json').read_text(encoding='utf-8'))
    data, rewrites, leftover = build(read_source(a.kb), aliases, overrides)
    text = json.dumps(data, ensure_ascii=False, indent=1) + '\n'
    out = Path(a.out)
    c = data['meta']['counts']
    summary = f"問答 {c['faq']}｜營運 {c['ops']}｜公告 {c['notice']}｜價目規則 {len(data['prices']['rules'])}｜LINE 用語改寫 {len(rewrites)} 則｜保留 @lhpedclinic {len(leftover)} 則（預約入口等）｜來源 sha {data['meta']['knowledge_sha256'][:12]}"
    if a.check:
        if not out.exists() or out.read_text(encoding='utf-8') != text:
            print('✗ faq.json 已過期，請重跑 python3 build_faq.py\n  ' + summary)
            sys.exit(1)
        print('✓ faq.json 已同步：' + summary)
        return
    out.write_text(text, encoding='utf-8')
    with open(ROOT / 'LINE用語改寫對照.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['編號', '改寫前', '改寫後'])
        w.writerows(rewrites)
    print('✓ 已寫入 faq.json：' + summary)

if __name__ == '__main__':
    main()
