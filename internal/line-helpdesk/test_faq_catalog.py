"""Content and routing checks; no network or Cloud credentials needed."""
import json
import os
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
        self.assertEqual(len(notices), 8)
        for x in notices:
            after = date.fromisoformat(x['valid_until']) + timedelta(days=1)
            self.assertEqual(route(x['questions'][0], today=TODAY)[0], 'answer')
            self.assertNotEqual(route(x['questions'][0], today=after)[0], 'answer')

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
