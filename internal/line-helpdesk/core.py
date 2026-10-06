"""Pure routing, no I/O.

Safety first: emergency words are checked on every text message (substring, not whole-question),
even while a case waits for staff. Unknown questions get up to three related approved questions
as buttons; the HTTP layer may automatically open a staff case when nothing relevant is found.

Normalization, triage regexes and the related-question scorer are ported from the clinic website's
assistant (https://lhpedclinic.com.tw/clinic-assistant/search.js, v1 2026-09-24) so the LINE bot and
the website triage the same text the same way. build_faq.py --search-js checks they still match.
No negation handling on purpose (director 2026-10-03): 「沒有呼吸困難」 still gets the 119 reply, same as the website.
"""
import math
import re
import unicodedata
from datetime import date

# ── exact-match key (whole question, ignore spaces and common punctuation) ──
def norm(text):
    return re.sub(r'[\s？?！!。．，,]+', '', unicodedata.normalize('NFKC', text)).lower()

# ── website normalize(): full/half width, synonyms, keep letters and digits only ──
SYNONYMS = [
    (r'臺', '台'), (r'星期|禮拜', '週'), (r'週天', '週日'), (r'預防針', '疫苗'),
    (r'小朋友|小孩子|小孩|孩童|兒童|小兒', '孩子'), (r'醫生', '醫師'),
]
def normalize(text):
    t = unicodedata.normalize('NFKC', str(text or '')).lower()
    for pattern, to in SYNONYMS:
        t = re.sub(pattern, to, t)
    return ''.join(ch for ch in t if unicodedata.category(ch)[0] in 'LN')

# ── website triage regexes, verbatim (matched against normalize()d text) ──
URGENT_SRC = r'呼吸困難|呼吸急促|呼吸很喘|很喘|喘不過氣|嘴唇發紫|嘴唇發黑|臉色發白|臉色發青|發紺|叫不醒|意識不清|意識改變|昏迷|昏倒|抽搐|痙攣|抽筋不停|發燒.{0,8}抽筋|抽筋.{0,8}發燒|眼睛上吊|持續嘔吐|一直吐|脫水|尿不出來|大量出血|血流不止|(?:3個月以下|三個月以下|未滿3個月|未滿三個月|[123一二三兩]個月大|新生兒|出生.{0,3}[天週]).{0,12}發燒'
SOON_SRC = r'高燒持續|高燒不退|燒不退|退燒後.{0,6}(?:活力|精神)|活力.{0,4}變差|精神.{0,4}變差|吃喝.{0,6}減少|喝.{0,4}(?:很少|變少)|尿量.{0,6}減少|尿.{0,2}變少|嗜睡|肌躍|心跳加快'
URGENT = re.compile(URGENT_SRC)
SOON = re.compile(SOON_SRC)

def triage(text):
    """'urgent' / 'soon' / None, same rules as the website assistant."""
    q = normalize(text)
    if URGENT.search(q):
        return 'urgent'
    if SOON.search(q):
        return 'soon'
    return None

HANDOFF_WORDS = {norm(x) for x in ['專人服務', '轉人工', '人工客服', '找真人', '請專人回答', '請專人協助']}
RESUME_WORDS = {norm(x) for x in ['結束專人服務', '恢復小幫手', '回到小幫手']}
NONTEXT = '[民眾傳送非文字訊息，請於官方帳號查看]'

# Small talk is never "unanswerable": it must not open a staff case (matched on normalize()d text).
_THANKS = r'謝謝|多謝|感謝|感恩|謝啦|謝囉|謝了|thanks|thankyou|thx|3q|辛苦了'
_GREET = r'你好|您好|哈囉|嗨|hi|hello|早安|午安|晚安|請問|在嗎|有人嗎|醫師好|護理師好'
_ACK = r'好的|好喔|好哦|好|ok|okay|收到|了解|瞭解|知道了|嗯|喔|哦|噢|讚|沒問題|是的|對|恩'
_FILL = r'[啊呀喔哦唷耶啦囉嗎呢了的]*'
THANKS = re.compile(rf'(?:(?:{_ACK}|{_GREET}){_FILL})*(?:{_THANKS}){_FILL}(?:(?:{_THANKS}|{_ACK}|您|你|醫師|護理師){_FILL})*')
GREET = re.compile(rf'(?:(?:{_GREET}){_FILL})+')
ACK = re.compile(rf'(?:(?:{_ACK}){_FILL})+')

def small_talk(text):
    """'thanks' / 'greet' / 'pick' / 'ack' (no reply) / None."""
    q = normalize(text)
    if q.isdigit() and len(q) <= 2:
        return 'pick'  # typed "1" after a numbered suggestion list
    if not q:
        return 'ack'   # emoji-only; meaningful single characters must continue routing
    for kind, rx in (('thanks', THANKS), ('greet', GREET), ('ack', ACK)):
        if rx.fullmatch(q):
            return kind
    if re.fullmatch(r'(?:謝謝|感謝)(?:你們|您們|您|你)(?:的)?(?:協助|幫忙|回覆)', q):
        return 'thanks'
    return None

# ── website search(): bigram scorer with title / page / BM25-saturated answer ──
FILLER = re.compile(r'請問|多少|可以|可不可以|能不能|什麼|怎麼|要不要|需要|是不是|會不會|有沒有|一定|還是|如果|你們|立欣診所|[嗎呢啊吧喔嗯的了]')
TOPIC = [
    (r'長不高|太矮|矮小|身高不夠', '身高'), (r'什麼時候|什麼情況|哪些情況|哪種情況|何時', '何時'),
    (r'看醫師|給醫師看|就診', '就醫'),
]
def search_key(text):
    t = normalize(text)
    for pattern, to in TOPIC:
        t = re.sub(pattern, to, t)
    return FILLER.sub('', t)

def grams(s):
    return [s[i:i + 2] for i in range(len(s) - 1)]

def is_valid(item, today):
    return not item.get('valid_until') or date.fromisoformat(item['valid_until']) >= today

class Searcher:
    def __init__(self, rows):
        """rows: dicts with title, page, kb_answer (the website text the site indexes), core."""
        self.docs = []
        for r in rows:
            a = search_key(r['kb_answer'])
            tf = {}
            for g in grams(a):
                tf[g] = tf.get(g, 0) + 1
            t = search_key(r['title'])
            self.docs.append({'row': r, 'title': set(grams(t)), 'page': set(grams(search_key(r.get('page', '')))),
                              'tf': tf, 'len': len(a), 'text': t + '|' + a})
        n = len(self.docs)
        self.n = n
        self.avg = sum(d['len'] for d in self.docs) / n if n else 1
        self.df = {}
        for d in self.docs:
            for g in d['title'] | d['page'] | set(d['tf']):
                self.df[g] = self.df.get(g, 0) + 1
        self.unseen = 0.5 * math.log(1 + (n + 0.5) / 0.5)

    def idf(self, g):
        df = self.df.get(g, 0)
        return math.log(1 + (self.n - df + 0.5) / (df + 0.5))

    def search(self, question, today, limit=5, strict=False):
        all_g = list(dict.fromkeys(grams(search_key(question))))
        qg = [g for g in all_g if g in self.df]
        if not qg:
            return []
        total = sum(self.idf(g) for g in qg) + (len(all_g) - len(qg)) * self.unseen
        scored, phrase_hits = [], []
        phrase = '' if strict else search_key(question)
        for d in self.docs:
            if not is_valid(d['row'], today):
                continue
            s = in_title = anywhere = 0.0
            title_hits = 0
            for g in qg:
                w, tf = self.idf(g), d['tf'].get(g, 0)
                t, p = g in d['title'], g in d['page']
                a = (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d['len'] / self.avg)) if tf else 0
                s += w * (2.5 * t + 0.5 * p + 0.6 * a)
                if t:
                    in_title += w
                    title_hits += 1
                if t or tf:
                    anywhere += w
            bonus = 0.05 if d['row'].get('core') else 0
            if len(phrase) >= 4 and phrase in d['text']:
                phrase_hits.append((s / total + bonus, d['row']))
            title_cov, cov = in_title / total, anywhere / total
            if title_cov < 0.3 and not (cov >= 0.75 and title_cov >= 0.15):
                continue
            if len(qg) >= 3 and title_hits < 2:
                continue
            if strict and title_cov < 0.45:
                continue
            scored.append((s / total + bonus, d['row']))
        if not scored:
            scored = phrase_hits
        scored.sort(key=lambda x: -x[0])
        top = scored[0][0] if scored else 0
        return [row for score, row in scored if score >= top * 0.55][:limit]

# ── self-pay prices (director 2026-10-05): same rules and gates as the website's search.js priceRule() ──
PRICE_ASK = re.compile(r'多少|錢|費|價|付|幾元|幾塊')
FREE_ASK = re.compile(r'免費|要錢嗎|要收費嗎')

class PriceMatcher:
    def __init__(self, prices):
        self.no_data = (prices or {}).get('no_data', '')
        self.rules = [dict(r, res=[re.compile(x) for x in r['all']], no=re.compile(r['not']) if r.get('not') else None)
                      for r in (prices or {}).get('rules', [])]

    def match(self, text):
        """First rule whose `all` patterns all match and `not` doesn't; None hands over to the rest of routing."""
        q = normalize(text)
        if '公費' in q or not PRICE_ASK.search(re.sub(r'[公自]費', '', q)):
            return None
        rule = next((r for r in self.rules if all(rx.search(q) for rx in r['res']) and not (r['no'] and r['no'].search(q))), None)
        if not rule or (FREE_ASK.search(q) and rule['kind'] in ('vaccine', 'ask')):
            return None
        return rule

# ── website front routing (search.js 3-0 / 4 / 5-0 / 5 / 5-0a / 6-0), regexes verbatim; build_faq.py --search-js checks parity ──
ROUTE_SRC = {
    'PRICE': r'費用|價格|多少錢|價錢|折扣|收費|價位|要錢嗎|免費嗎|自費多少|掛號費|部分負擔|費多少',
    'PUBLIC_FLU': r'公費.{0,12}(?:流感|疫苗|打)|(?:流感|疫苗).{0,12}公費',
    'BRAND_ASK': r'品牌|牌子|廠牌|哪一?牌|哪[一個]?家|什麼疫苗|哪一?支|指定|選牌|挑|預約|預購|預定|預訂|保留|留(?:一|給|著)',
    'PUBLIC_BRAND': r'公費.{0,8}(?:品牌|牌子|廠牌|哪一?牌)',
    'VAX_CUTOFF': r'(?:疫苗|打針|接種|施打).{0,8}(?:最晚|最後|截止|停止|到幾點|幾點前|幾點以前|幾點後|幾點以後|幾點為止)|(?:最晚|最後|截止|停止|幾點).{0,8}(?:疫苗|打針|接種|施打)',
    'FLU_DOCS': r'流感.{0,12}(?:帶什麼|要帶|攜帶|帶哪些|準備什麼|什麼證件|證件)|(?:帶什麼|要帶|攜帶|帶哪些|準備什麼|什麼證件|證件).{0,12}流感',
    'STUDENT': r'學生|國小|國中|高中|高職|小學|補接種',
    'DOSE': r'吃什麼藥|要吃藥嗎|吃多少|劑量|幾cc|幾毫升|幾ml|幫.{0,4}(?:看|判讀)報告|我的報告|報告.{0,6}正常嗎|數值.{0,4}正常嗎',
    'SUITABLE': r'(?:我|孩子|我家|兒子|女兒|寶寶|老大|老二|他|她).{0,10}(?:氣喘|過敏|免疫|吃藥|用藥|吃過|感冒|發燒|咳嗽|生病|早產|蠶豆|癲癇|心臟|懷孕|抗生素|克流感|流感藥|剛打|打過).{0,12}(?:可以|能不能|可不可以|能|適合).{0,6}(?:打|接種)',
    'QUOTA': r'額滿|滿了|約滿|約不到|沒名額|沒有名額|加號|加掛|還有名額|有沒有名額|還有位子|電話.{0,4}(?:預約|掛號|約)|打電話.{0,6}(?:約|掛)',
    'ACTION': r'(?:幫我|替我|幫忙|可以幫).{0,6}(?:預約|掛號|取消|改期|改時間|查)|我的.{0,4}(?:預約|號碼|號次|未到)|排第幾|還要等多久|還要等幾|還有名額|還有位子|有沒有名額|可以插號|提前看',
    'FEE': r'掛號費|部分負擔|收費標準|收費表|看診.{0,4}(?:多少錢|費用|要錢|收多少)|看(?:一次|病|醫師|醫生).{0,4}(?:多少錢|費用|收多少)|押單|(?:沒帶|忘記帶|忘了帶|未帶).{0,3}健保卡|健保卡.{0,4}(?:沒帶|忘記|忘了)|診斷書|慢性處方|慢箋|福保|自費看診|自費掛號',
    'PUBLIC_VAX': r'公費.{0,10}(?:疫苗|流感|接種|打針)|(?:疫苗|流感).{0,10}公費',
    'SELF_VAX': r'自費.{0,10}(?:疫苗|流感|接種|打針)|(?:疫苗|流感).{0,10}自費',
    'CHECKUP': r'成人健檢|公費健檢|成人預防保健|成人.{0,4}健康檢查',
    'CHILD': r'兒童|小孩|孩子|寶寶|嬰兒|幼兒|小朋友',
    'MONEY': r'多少|錢|費|免費|收費|付',
}
PRICE, PUBLIC_FLU, BRAND_ASK, PUBLIC_BRAND, VAX_CUTOFF, FLU_DOCS, STUDENT, DOSE, SUITABLE, QUOTA, ACTION, FEE, PUBLIC_VAX, SELF_VAX, CHECKUP, CHILD, MONEY = (re.compile(ROUTE_SRC[n]) for n in ['PRICE', 'PUBLIC_FLU', 'BRAND_ASK', 'PUBLIC_BRAND', 'VAX_CUTOFF', 'FLU_DOCS', 'STUDENT', 'DOSE', 'SUITABLE', 'QUOTA', 'ACTION', 'FEE', 'PUBLIC_VAX', 'SELF_VAX', 'CHECKUP', 'CHILD', 'MONEY'])
# 5-0a pinned FAQs by title (never by Q number: numbers shift when the knowledge base is regenerated)
PINS = {
    'PIN_CUTOFF': ['週六、週日或夜診時段可以接種疫苗嗎？', '打疫苗需要預約嗎？要先確認有沒有貨嗎？'],
    'PIN_FLU_DOCS': ['打流感疫苗要預約嗎？可以直接現場掛號嗎？當天要帶什麼？', '國小到高中職學生要打公費流感疫苗，需要帶什麼？'],
    'PIN_FLU_DOCS_STUDENT': ['國小到高中職學生要打公費流感疫苗，需要帶什麼？', '打流感疫苗要預約嗎？可以直接現場掛號嗎？當天要帶什麼？'],
}
BRAND_BUTTON = '流感疫苗資訊'   # rich-menu keyword answered by the official account backend (passthrough)

# ── catalog: exact index + searcher, built once at import time ──
class Catalog:
    def __init__(self, data):
        self.meta = data['meta']
        self.replies = data['replies']
        self.items = data['items']
        self.exact = {}
        for item in self.items:
            if not item.get('enabled', True):
                continue
            for q in item['questions']:
                key = norm(q)
                if key in self.exact and self.exact[key] is not item:
                    raise ValueError('duplicate question: ' + q)
                self.exact[key] = item
        # Emergency titles can never be answered by exact match (triage wins), so never suggest them.
        self.searcher = Searcher([i for i in self.items if i.get('kind') == 'faq' and not triage(i['title'])])
        self.prices = PriceMatcher(data.get('prices'))
        self.titles = {i['title']: i for i in self.items if i.get('enabled', True) and i.get('title')}

    def by_title(self, title, today):
        item = self.titles.get(title)
        return item if item and is_valid(item, today) else None

    def route(self, text, today, passthrough=()):
        """search.js front routing that runs before prices: 3-0 public flu brand, 4 dose/suitability,
        5-0 booking quota, 5 things the bot cannot do, 5-0a pinned FAQs. Returns a text message with optional
        'buttons' (question texts for quick reply), or None."""
        q = normalize(text)
        r = self.replies
        if ((PUBLIC_FLU.search(q) and BRAND_ASK.search(q)) or PUBLIC_BRAND.search(q)) and '自費' not in q:
            n = next((i for i in self.items if i.get('kind') == 'notice' and re.search('公費.*品牌', i['title'])
                      and is_valid(i, today)), None)
            if n:
                return {'type': 'text', 'text': n['answer'], 'buttons': [BRAND_BUTTON] if BRAND_BUTTON in passthrough else []}
        if DOSE.search(q) or SUITABLE.search(q):
            return {'type': 'text', 'text': r['clinical']}
        if QUOTA.search(q):
            rows = [i for i in self.items if i.get('kind') == 'faq' and is_valid(i, today)
                    and (i['title'].startswith('預約名額') or i['title'].startswith('網路預約規則：預約請至'))]
            if rows:
                return {'type': 'text', 'text': rows[0]['answer'] + '\n\n' + r['booking_links'],
                        'buttons': [x['title'] for x in rows[1:2]]}
        if ACTION.search(q):
            return {'type': 'text', 'text': r['action']}
        pin = None
        if VAX_CUTOFF.search(q) and not PRICE.search(q):
            pin = PINS['PIN_CUTOFF']
        elif FLU_DOCS.search(q) and not PRICE.search(q):
            pin = PINS['PIN_FLU_DOCS_STUDENT'] if STUDENT.search(q) else PINS['PIN_FLU_DOCS']
        if pin:
            first, second = (self.by_title(t, today) for t in pin)
            if first:
                return {'type': 'text', 'text': first['answer'], 'buttons': [second['title']] if second else []}
        return None

    def money_route(self, text, today):
        """search.js 6-0a…6 money questions that no self-pay price rule answered: vaccine registration fee,
        adult check-up, chronic prescription, fee table, then the generic no-data reply. Returns text or None."""
        q = normalize(text)
        r = self.replies
        asks_money = MONEY.search(re.sub(r'[公自]費', '', q)) or FEE.search(q)
        if SELF_VAX.search(q) and asks_money:
            lines = ([r['public_vax_note']] if PUBLIC_VAX.search(q) else []) + [r['self_vax_note'], r['self_vax_tail']]
            return '\n\n'.join(lines) + '\n\n' + r['vaccine_note']
        if PUBLIC_VAX.search(q) and asks_money:
            return r['public_vax_note'] + '\n\n' + r['vaccine_note']
        if CHECKUP.search(q) and not CHILD.search(q) and asks_money:
            return r['checkup_note'] + '\n\n' + r['other_fees']
        if re.search('慢性處方|慢箋|連續處方', q) and re.search('氣喘|過敏|噴劑|鼻炎|鼻子', q):
            row = next((i for i in self.items if i.get('kind') == 'faq' and '本院最多開 28 天' in i.get('kb_answer', '')), None)
            if row:
                return row['answer']
        if FEE.search(q):
            return r['fee_table']
        if PRICE.search(q):
            return self.prices.no_data
        return None

    def lookup(self, text, today):
        item = self.exact.get(norm(text))
        return item if item and is_valid(item, today) else None

    def related(self, text, today, limit=3):
        return self.searcher.search(text, today, limit)

def decide(text, pending, catalog, legacy, passthrough, today):
    """Returns (action, payload).

    action: urgent / soon / resume / silent (no reply) / handoff / passthrough / answer / suggest / unknown / nontext
    pending: True only while a staff case is open and not past the auto-resume window.
    """
    if text == NONTEXT:
        return ('silent', None) if pending else ('nontext', None)
    level = triage(text)
    if level == 'urgent':
        return 'urgent', catalog.replies['urgent']
    if pending:
        if norm(text) in RESUME_WORDS:
            return 'resume', None
        if level == 'soon':
            return 'soon', catalog.replies['soon']
        return 'silent', None
    key = norm(text)
    if key in HANDOFF_WORDS:
        return 'handoff', None
    if key in RESUME_WORDS:
        return 'answer', {'type': 'text', 'text': catalog.replies['not_pending']}
    talk = small_talk(text)
    if talk == 'ack':
        return 'silent', None
    if talk:
        return 'answer', {'type': 'text', 'text': catalog.replies[talk]}
    if text in passthrough:
        return 'passthrough', None
    if text in legacy:
        return 'answer', legacy[text]
    item = catalog.lookup(text, today)
    if item:
        if item.get('legacy_key'):
            return 'answer', legacy[item['legacy_key']]
        return 'answer', {'type': 'text', 'text': item['answer']}
    if level == 'soon':   # website order: secondary red flags before every front route
        return 'soon', catalog.replies['soon']
    routed = catalog.route(text, today, passthrough)
    if routed:
        return 'answer', routed
    price = catalog.prices.match(text)
    if price:
        return 'answer', {'type': 'text', 'text': price['reply']}
    money = catalog.money_route(text, today)
    if money:
        return 'answer', {'type': 'text', 'text': money}
    hits = catalog.related(text, today)
    if hits:
        return 'suggest', hits
    return 'unknown', None
