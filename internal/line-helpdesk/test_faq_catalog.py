"""Content and routing checks; no network or Cloud credentials needed."""
import ast
import json
import os
import re
import unittest
from datetime import date, timedelta
from pathlib import Path

import build_faq
import core
from core import Catalog, decide, norm, triage

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / 'faq.json').read_text(encoding='utf-8'))
CAT = Catalog(DATA)
LEGACY = json.loads((ROOT / 'legacy_messages.json').read_text(encoding='utf-8'))
PASS = {'流感疫苗資訊', '過敏氣喘諮詢', '減重營養諮詢'}
TODAY = date(2026, 10, 3)

def _actions(o):
    if isinstance(o, dict):
        if isinstance(o.get('action'), dict):
            yield o['action']
        for v in o.values():
            yield from _actions(v)
    elif isinstance(o, list):
        for x in o:
            yield from _actions(x)

def route(text, pending=False, today=TODAY):
    return decide(text, pending, CAT, LEGACY, PASS, today)

class TriageTests(unittest.TestCase):
    def test_emergency_words_inside_sentences(self):
        for q in ['我兒子呼吸困難怎麼辦', '寶寶 2 個月大發燒 38 度', '小孩發燒後一直抽筋', '臺灣小朋友嘴唇發紫']:
            with self.subTest(q=q):
                action, text = route(q)
                self.assertEqual(action, 'urgent')
                self.assertIn('119', text)

    def test_emergency_answered_even_while_waiting_for_staff(self):
        self.assertEqual(route('孩子現在呼吸很喘', pending=True)[0], 'urgent')
        self.assertEqual(route('高燒不退第三天', pending=True)[0], 'soon')
        self.assertEqual(route('診所電話', pending=True)[0], 'silent')

    def test_soon_words(self):
        for q in ['高燒不退第三天', '退燒後精神很差', '孩子喝水變少尿也變少']:
            self.assertEqual(route(q)[0], 'soon', q)

    def test_ordinary_symptom_is_not_triaged(self):
        for q in ['咳嗽有痰', '喘鳴', '昨天吐一次']:
            self.assertIsNone(triage(q), q)

    def test_regex_matches_website_when_available(self):
        js = Path(os.getenv('SEARCH_JS', ROOT.parents[1] / 'clinic-assistant' / 'search.js'))
        if not js.exists():
            self.skipTest('set SEARCH_JS=path/to/clinic-assistant/search.js to compare with the website')
        build_faq.check_regex_parity(js.read_text(encoding='utf-8'))

class CatalogTests(unittest.TestCase):
    def test_every_question_returns_its_answer(self):
        for item in DATA['items']:
            for q in item['questions']:
                with self.subTest(id=item['id'], question=q):
                    action, msg = route(q)
                    if triage(q) == 'urgent':
                        self.assertEqual(action, 'urgent')   # safety wins over exact match
                        continue
                    self.assertEqual(action, 'answer')
                    self.assertEqual(msg['text'], item['answer'])

    def test_welcome_quick_questions_have_answers(self):
        for q in DATA['replies']['suggestions_reference']:
            self.assertEqual(route(q)[0], 'answer', q)

    def test_counts_and_source(self):
        c = DATA['meta']['counts']
        self.assertGreaterEqual(c['faq'], 900)   # grows with the website
        self.assertEqual(c['ops'], 8)
        self.assertEqual(len(DATA['meta']['knowledge_sha256']), 64)

    def test_no_conflicting_questions_and_length_limit(self):
        seen = {}
        for item in DATA['items']:
            self.assertLessEqual(len(item['answer'].encode('utf-16-le')) // 2, 5000)
            for q in item['questions']:
                self.assertNotIn(norm(q), seen, q)
                seen[norm(q)] = item['id']

    def test_announcements_expire(self):
        notices = [x for x in DATA['items'] if x['kind'] == 'notice']
        self.assertEqual(len(notices), DATA['meta']['counts']['notice'])   # grows with homepage announcements
        self.assertGreaterEqual(len(notices), 1)
        for x in notices:
            until = date.fromisoformat(x['valid_until'])
            self.assertEqual(route(x['questions'][0], today=TODAY)[0], 'answer')
            if until == date.max:   # 常設公告（9999-12-31，院長 2026-10-13 裁示）：永不過期，遠期仍要答得出來
                self.assertEqual(route(x['questions'][0], today=date(2100, 1, 1))[0], 'answer', x['id'])
                continue
            after = until + timedelta(days=1)
            action, msg = route(x['questions'][0], today=after)
            # an expired notice is never shown again (its title may still route elsewhere, e.g. to a date answer)
            self.assertFalse(action == 'answer' and x['answer'] in msg['text'], x['id'])

    def test_line_wording(self):
        q56 = next(i for i in DATA['items'] if i['id'] == 'Q056')
        self.assertIn('在此聊天室輸入「專人服務」', q56['answer'])
        shown = [i['answer'] for i in DATA['items']] + [DATA['replies']['greeting_reference']]
        self.assertFalse([t for t in shown if '加 LINE @lhpedclinic' in t])

    def test_vaccine_caveats_kept(self):
        for item in DATA['items']:
            if item['kind'] == 'faq' and '疫苗' in item['title'] and not build_faq.PRICE.search(core.normalize(item['title'])):
                with self.subTest(id=item['id']):
                    a = item['title'] + item['answer']
                    self.assertTrue('仿單' in a and '醫師評估' in a, item['id'])

class UnknownQuestionTests(unittest.TestCase):
    def test_unknown_question_suggests_instead_of_handoff(self):
        action, hits = route('有流感疫苗嗎')
        self.assertEqual(action, 'suggest')
        self.assertTrue(1 <= len(hits) <= 3)
        for h in hits:   # every suggested title, when tapped, returns its answer
            self.assertEqual(route(h['title'])[0], 'answer')

    def test_nonsense_is_unknown_not_handoff(self):
        self.assertEqual(route('這題沒有設定987654321')[0], 'unknown')

    def test_only_explicit_request_opens_case(self):
        for q in ['專人服務', '轉人工', '請專人協助']:
            self.assertEqual(route(q)[0], 'handoff')
        self.assertEqual(route('結束專人服務', pending=True)[0], 'resume')

    def test_suggestions_never_contain_emergency_titles(self):
        for q in ['熱性痙攣', '脫水怎麼補充', '抽搐']:
            action, hits = route(q)
            if action == 'suggest':
                self.assertFalse(any(triage(h['title']) for h in hits))

    def test_small_talk_never_unanswerable(self):
        for q in ['謝謝', '好的謝謝', '謝謝你們的協助', '你好', '請問']:
            action, msg = route(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn(msg['text'], (DATA['replies']['thanks'], DATA['replies']['greet']))
        for q in ['好', 'OK', '收到了', '嗯嗯', '👍']:
            self.assertEqual(route(q), ('silent', None), q)
        self.assertEqual(route('1')[1]['text'], DATA['replies']['pick'])
        self.assertEqual(route('孩子嘴唇發紫謝謝')[0], 'urgent')   # safety still first

    def test_nontext(self):
        self.assertEqual(route(core.NONTEXT)[0], 'nontext')
        self.assertEqual(route(core.NONTEXT, pending=True)[0], 'silent')

    def test_passthrough_and_legacy(self):
        self.assertEqual(route('流感疫苗資訊')[0], 'passthrough')
        self.assertEqual(route('醫師介紹')[1], LEGACY['醫師介紹'])
        self.assertEqual(route('立欣診所')[1], LEGACY['診所資訊'])

    def test_latest_notice_button(self):
        # 院長 2026-11-06「先 A 後 B」之 B：程式讀官網門診異動公告回答，到期自動改回核可句＋門診時間表
        live = [i for i in DATA['items'] if i['kind'] == 'notice' and i.get('schedule')]
        if live:
            n = live[0]
            text = decide('最新門診異動', False, CAT, LEGACY, PASS, date.fromisoformat(n['valid_until']))[1]['text']
            self.assertIn(n['answer'], text)
        after = date.fromisoformat(max([i['valid_until'] for i in live] or ['2026-01-01'])) + timedelta(days=1)
        for q in ('最新門診異動', '門診異動', '最近有休診嗎', '門診公告'):
            action, msg = decide(q, False, CAT, LEGACY, PASS, after)
            self.assertEqual(action, 'answer', q)
            self.assertTrue(msg['text'].startswith('目前沒有門診異動，各診次依常態門診時間看診。最新公告以官網首頁為準：https://lhpedclinic.com.tw/#clinic-notice'), q)
            self.assertIn('立欣診所門診時間', msg['text'])
        self.assertNotIn('目前沒有門診異動', decide('門診時間', False, CAT, LEGACY, PASS, after)[1]['text'])

    def test_date_ask_shows_covering_notice(self):
        # 代診（時段不變、無 EXCEPTIONS）：問那一天要附上公告（與官網 search.js noticesOn 同步）
        for n in [i for i in DATA['items'] if i['kind'] == 'notice' and i.get('schedule') and i.get('start')]:
            d = date.fromisoformat(n['start'])
            text = decide(f'{d.month}/{d.day}有看診嗎', False, CAT, LEGACY, PASS, d - timedelta(days=1))[1]['text']
            self.assertIn(n['answer'], text)
            self.assertIn('門診異動', text)
            later = date.fromisoformat(n['valid_until']) + timedelta(days=1)
            self.assertNotIn(n['answer'], decide(f'{later.month}/{later.day}有看診嗎', False, CAT, LEGACY, PASS, d - timedelta(days=1))[1]['text'])

    def test_clinic_card_links_and_wording(self):
        # 院長 2026-11-07：班表圖點擊改開官網門診時間區塊（原為範本預設 line.me）；「周」統一為「週」
        raw = json.dumps(LEGACY, ensure_ascii=False)
        self.assertNotIn('https://line.me/', raw)
        self.assertNotIn('周', raw)
        for key in ('診所資訊', '立欣診所'):
            self.assertEqual(LEGACY[key]['contents']['hero']['action']['uri'], 'https://lhpedclinic.com.tw/#schedule')

    def test_cards_use_website_palette(self):
        # 院長 2026-11-07 第一層：LINE 卡片配色對齊官網（tailwind 主色 #7C9A6E 系），舊紅棕色系不得再出現
        raw = json.dumps(LEGACY, ensure_ascii=False)
        for old in ('#A52A2A', '#C47451', '#F89880', '#E74C3C', '#008080', '#3D0C02'):
            self.assertNotIn(old, raw)
        palette = {'#7C9A6E', '#f0f7ed', '#A8C69F', '#4d6b43', '#4b5563', '#c66060', '#e8f4e8', '#5f7d52', '#FFFFFF'}
        self.assertTrue(set(re.findall(r'"(?:color|backgroundColor|borderColor)": "(#[0-9A-Fa-f]{6})"', raw)) <= palette)
        for b in LEGACY['診療項目']['contents']['contents']:
            self.assertNotIn('header', b)
            texts = json.dumps(b['body'], ensure_ascii=False)
            self.assertIn('"門診服務"', texts)
            self.assertIn('立欣診所｜小鹿醫師團隊', texts)
        self.assertEqual(LEGACY['過敏減重諮詢']['altText'], '特別門診諮詢')

    def test_card_wording_matches_website(self):
        # 院長 2026-11-07 逐字核可：診療項目文字照官網服務頁、醫師學經歷照官網醫師頁、資格由院長確認
        cards = json.dumps(LEGACY['診療項目'], ensure_ascii=False)
        for must in ('家庭醫學・慢性病', '非耳鼻喉專科，需專科處置時協助轉介', '非皮膚專科，需專科處置時協助轉介',
                     '接種前由醫師評估，現貨請先來電或在此聊天室詢問', '必要時依醫師評估用藥，效果因人而異',
                     '大量出血或深部傷口請直接前往急診'):
            self.assertIn(must, cards)
        self.assertNotIn('三高慢性病', cards)
        tsai, lee = (json.dumps(b, ensure_ascii=False) for b in LEGACY['醫師介紹']['contents']['contents'])
        for t in (tsai, lee):
            self.assertNotIn('中華民國小兒科專科醫師', t)
            self.assertIn('兒科專科醫師（臺灣兒科醫學會）', t)
            self.assertIn('青少年醫學次專科醫師', t)
            self.assertIn('成人預防保健服務醫師', t)
            self.assertIn('兒童發展與健康篩檢服務醫師', t)
        self.assertNotIn('"■  中國醫藥大學 醫學士"', tsai)
        for must in ('天主教輔仁大學醫院', '馬偕兒童醫院', '新光吳火獅紀念醫院', '肥胖症專科醫師（中華民國肥胖研究學會）',
                     '氣喘慢性照護醫師', '糖尿病共同照護網認證'):
            self.assertIn(must, tsai)
        self.assertIn('新生兒科專科醫師（台灣新生兒科醫學會）', lee)
        self.assertNotIn('糖尿病共同照護網', lee)   # 院長確認：只有蔡醫師有
        # 院長 2026-11-07：醫師卡加「完整介紹」連官網醫師頁、粉專按鈕去掉「點我>>」；營養師卡院長裁示先刪除（只留兩位醫師）
        self.assertEqual(len(LEGACY['醫師介紹']['contents']['contents']), 2)
        for t, page in ((tsai, 'dr-tsai'), (lee, 'dr-lee')):
            self.assertIn(f'"label": "完整介紹", "uri": "https://lhpedclinic.com.tw/team/{page}.html"', t)
            self.assertNotIn('點我>>', t)
        info = json.dumps(LEGACY['診所資訊'], ensure_ascii=False)
        for must in ('上午 08:00 - 12:00', '夜間 18:30 - 21:30', '週六夜間及週日下午休診', '現場掛號：早診 08:00、午診 14:30、晚診 18:00 開始'):
            self.assertIn(must, info)
        self.assertEqual(LEGACY['診所資訊'], LEGACY['立欣診所'])

    def test_card_images_hosted_on_website(self):
        # 2026-11-07：卡片圖一律讀官網（班表圖 LH_Time2_s.jpg 與官網同一張，官網換圖 LINE 自動跟上）
        raw = json.dumps(LEGACY, ensure_ascii=False)
        self.assertNotIn('storage.googleapis.com', raw)
        site = Path(__file__).resolve().parents[2]
        for url in set(re.findall(r'"url": "(https://lhpedclinic\.com\.tw/images/[^"]+)"', raw)):
            if (site / 'images').exists():
                self.assertTrue((site / url.split('lhpedclinic.com.tw/', 1)[1]).exists(), url)

    def test_service_cards(self):
        # 院長 2026-11-07：耳鼻喉不宣稱專科（00 §4-5）、疫苗不寫「各項」（本院不提供卡介苗）、InBody 大小寫；每卡「了解更多」連官網服務頁
        raw = json.dumps(LEGACY['診療項目'], ensure_ascii=False)
        for bad in ('耳鼻喉治療', '各項公自費', 'Inbody'):
            self.assertNotIn(bad, raw)
        bubbles = LEGACY['診療項目']['contents']['contents']
        self.assertEqual(len(bubbles), 8)
        site = Path(__file__).resolve().parents[2]
        for b in bubbles:
            act = b['footer']['contents'][0]['action']
            self.assertEqual((act['type'], act['label']), ('uri', '了解更多'))
            self.assertTrue(act['uri'].startswith('https://lhpedclinic.com.tw/services/'))
            img = b['body']['contents'][0]['contents'][0]   # 院長 2026-11-07「小鹿醫師」情境插圖，放官網 images/line/
            self.assertTrue(img['url'].startswith('https://lhpedclinic.com.tw/images/line/service-'), img['url'])
            if (site / 'images').exists():
                self.assertTrue((site / img['url'].split('lhpedclinic.com.tw/', 1)[1]).exists(), img['url'])
            page = act['uri'].split('lhpedclinic.com.tw/', 1)[1]
            if (site / 'services').exists():   # inside the website repo: the page must exist
                self.assertTrue((site / (page + 'index.html' if page.endswith('/') else page)).exists(), page)
        self.assertLess(len(raw.encode()), 50000)   # LINE carousel limit

    def test_clinic_card_buttons_never_open_a_case(self):
        # 「診所資訊」卡片上的按鈕文字：不可落到 unknown（會自動轉專人、開案件）
        default = re.search(r"^DEFAULT_PASSTHROUGH = (\(.*?\))$", (ROOT / 'main.py').read_text(encoding='utf-8'), re.M)
        self.assertEqual(set(ast.literal_eval(default.group(1))), PASS)   # main.py default == the set tested here
        labels = {a['text'] for a in _actions(LEGACY['診所資訊']) if a.get('type') == 'message'}
        self.assertIn('最新門診異動', labels)
        for text in labels:
            self.assertNotEqual(route(text)[0], 'unknown', text)

class BuildTests(unittest.TestCase):
    def test_faq_json_is_up_to_date_with_knowledge(self):
        kb = Path(os.getenv('KB_PATH', ROOT.parents[1] / 'clinic-assistant' / 'knowledge.json'))
        if not kb.exists():
            self.skipTest('set KB_PATH=path/to/knowledge.json to check faq.json is current')
        aliases = json.loads((ROOT / 'aliases.json').read_text(encoding='utf-8'))
        overrides = json.loads((ROOT / 'prices_line.json').read_text(encoding='utf-8'))
        data, _, _ = build_faq.build(kb.read_bytes(), aliases, overrides)
        self.assertEqual(data, DATA, 'faq.json is stale: run python3 build_faq.py')

if __name__ == '__main__':
    unittest.main()
