"""Website front routing ported 2026-10-05p (search.js PUBLIC_BRAND / VAX_CUTOFF / FLU_DOCS and the public-brand rule)."""
import json
import unittest
from datetime import date
from pathlib import Path

import main
from core import Catalog, decide

ROOT = Path(__file__).parent
CAT = Catalog(json.loads((ROOT / 'faq.json').read_text(encoding='utf-8')))
LEGACY = json.loads((ROOT / 'legacy_messages.json').read_text(encoding='utf-8'))
PASS = {'流感疫苗資訊', '過敏氣喘諮詢', '減重營養諮詢'}
DAY = date(2026, 10, 5)

def route(q, today=DAY, passthrough=PASS):
    return decide(q, False, CAT, LEGACY, passthrough, today)

# Q numbers are only test labels here; the bot itself pins these FAQs by title.
T = {'Q226': '週六、週日或夜診時段可以接種疫苗嗎？', 'Q198': '打疫苗需要預約嗎？要先確認有沒有貨嗎？', 'Q202': '國小到高中職學生要打公費流感疫苗，需要帶什麼？', 'Q524': '打流感疫苗要預約嗎？可以直接現場掛號嗎？當天要帶什麼？'}

class RoutingTests(unittest.TestCase):
    def test_public_brand_goes_to_notice(self):
        for q in ['今天公費哪一牌？', '今天公費哪一牌', '公費流感今天是哪個牌子', '今天公費流感疫苗是什麼品牌',
                  '公費流感可以指定品牌嗎', '公費流感疫苗可以預約嗎', '公費流感可以先保留一劑嗎', '公費流感疫苗可以預購嗎']:
            action, msg = route(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('流感疫苗資訊', msg['text'], q)
            self.assertIn('無法指定品牌', msg['text'], q)
            self.assertEqual(msg['buttons'], ['流感疫苗資訊'], q)
            self.assertIn('您也可以點選選單的「流感疫苗資訊」查詢。', msg['text'], q)   # director 2026-10-05
            self.assertNotIn('加入「立欣診所」LINE官方帳號', msg['text'], q)

    def test_brand_button_only_when_backend_answers_it(self):
        action, msg = route('今天公費哪一牌', passthrough=set())
        self.assertEqual(action, 'answer')
        self.assertEqual(msg['buttons'], [])

    def test_self_pay_brand_not_routed_to_public_notice(self):
        action, msg = route('自費流感疫苗有哪些品牌')
        self.assertFalse(action == 'answer' and '無法指定品牌' in msg.get('text', ''))

    def test_notice_expiry(self):
        action, msg = route('今天公費哪一牌', today=date(2027, 4, 1))
        self.assertFalse(action == 'answer' and '無法指定品牌' in (msg or {}).get('text', ''))

    def test_vaccine_cutoff(self):
        for q in ['最後幾點可以打疫苗？', '幾點以後不能打疫苗', '疫苗打到幾點', '週六最晚幾點可以打疫苗']:
            action, msg = route(q)
            self.assertEqual(action, 'answer', q)
            self.assertTrue(msg['text'].startswith('您好，因疫苗清點與申報作業，本院於每日最後一診結束前一小時暫停疫苗施打。'), q)
            self.assertTrue(msg['text'].endswith('最後施打時間：週一至週五 20:30、週六 17:00、週日 20:00。'), q)
            self.assertEqual(msg['buttons'], [T['Q226'], T['Q198']], q)

    def test_flu_documents(self):
        for q, first, second in [('3歲小孩打公費流感要帶什麼', 'Q524', 'Q202'), ('打流感疫苗要帶什麼', 'Q524', 'Q202'),
                                 ('學生打公費流感要帶什麼', 'Q202', 'Q524'), ('國中生打公費流感要帶什麼證件', 'Q202', 'Q524')]:
            action, msg = route(q)
            self.assertEqual(action, 'answer', q)
            self.assertEqual(msg['text'], CAT.titles[T[first]]['answer'], q)
            self.assertEqual(msg['buttons'], [CAT.titles[T[second]]['title']], q)
        self.assertIn('兒童健康手冊', route('3歲小孩打公費流感要帶什麼')[1]['text'])

    def test_follow_up_button_answers(self):
        # Tapping the button sends the full title, which must hit the exact-match answer.
        for fid in ('Q198', 'Q202', 'Q524'):
            action, msg = route(CAT.titles[T[fid]]['title'])
            self.assertEqual((action, msg['text']), ('answer', CAT.titles[T[fid]]['answer']))
        self.assertEqual(route('流感疫苗資訊')[0], 'passthrough')

    def test_not_over_triggered(self):
        action, msg = route('打完疫苗可以洗澡嗎')
        self.assertFalse(action == 'answer' and msg['text'] == CAT.titles['週六、週日或夜診時段可以接種疫苗嗎？']['answer'])
        self.assertIn('1,600', route('能伏鼻多少')[1]['text'])          # price questions keep the price rule
        self.assertEqual(route('孩子呼吸很喘 最後幾點可以打疫苗')[0], 'urgent')  # safety still first

    def test_line_message_shape(self):
        _, msg = route('最後幾點可以打疫苗')
        body = {k: v for k, v in msg.items() if k != 'buttons'}
        out = main.with_staff_button(body, main.question_buttons(msg['buttons']))
        self.assertNotIn('buttons', out)
        items = out['quickReply']['items']
        self.assertEqual(items[-1], main.STAFF_BUTTON)
        self.assertEqual(items[0]['action']['text'], T['Q226'])
        self.assertLessEqual(len(items[0]['action']['label'].encode('utf-16-le')) // 2, 20)

if __name__ == '__main__':
    unittest.main()


class WebsiteRulesV26Tests(unittest.TestCase):
    """2.6: website front rules that 2.5 lacked (search.js 4 / 5-0 / 5 / 6-0a…6), same regexes and order."""
    def ans(self, q):
        return route(q)

    def test_public_vaccine_fee(self):
        for q in ['公費流感疫苗多少錢', '打公費流感疫苗要錢嗎', '公費流感疫苗免費嗎']:
            action, msg = self.ans(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('只酌收掛號費', msg['text'])
            self.assertIn('仿單', msg['text'])

    def test_self_vaccine_registration_fee(self):
        action, msg = self.ans('打自費疫苗要掛號費嗎')
        self.assertIn('不另外收掛號費', msg['text'])
        self.assertIn('在此聊天室輸入「專人服務」', msg['text'])

    def test_fee_table_and_health_card(self):
        for q in ['掛號費多少', '忘記帶健保卡', '健保卡沒帶']:
            action, msg = self.ans(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('押單費', msg['text'])

    def test_checkup_fee(self):
        action, msg = self.ans('成人健檢要掛號費嗎')
        self.assertIn('不另外收掛號費', msg['text'])

    def test_cannot_book_for_you(self):
        for q in ['可以幫我預約嗎', '幫我取消預約', '我排第幾號']:
            action, msg = self.ans(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('線上小幫手無法代為預約', msg['text'])
            self.assertIn('booknow', msg['text'])

    def test_quota(self):
        action, msg = self.ans('預約額滿怎麼辦')
        self.assertIn('無法加號', msg['text'])

    def test_dose_and_suitability_go_to_doctor(self):
        for q in ['孩子吃多少藥', '我家孩子有氣喘可以打流感疫苗嗎', '幫我看報告']:
            action, msg = self.ans(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('需要醫師當面評估', msg['text'])

    def test_order_matches_website(self):
        self.assertEqual(self.ans('燒不退要吃多少藥')[0], 'soon')          # red flag before dose rule
        self.assertEqual(self.ans('孩子嘴唇發紫可以幫我預約嗎')[0], 'urgent')
        self.assertIn('2,400 元', self.ans('水痘疫苗多少錢')[1]['text'])     # price before fee rules
        self.assertIn('目前這份價目資料沒有', self.ans('打針多少錢')[1]['text'])   # generic price, not a staff case

class TailRouteTests(unittest.TestCase):
    """search.js 7–10 ported 2026-10-08o: cross-session, late, stock, COVID, dates, holidays, hours, contact."""
    def ans(self, q, today=date(2026, 10, 8)):
        return decide(q, False, CAT, LEGACY, PASS, today)

    def test_stock_never_promises(self):
        for q in ['鼻噴流感疫苗有現貨嗎', '水痘疫苗還有貨嗎']:
            action, msg = self.ans(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('不代表今天有現貨', msg['text'])
            self.assertIn('在此聊天室輸入「專人服務」', msg['text'])
            self.assertNotIn('@lhpedclinic', msg['text'])

    def test_late_and_cross_session(self):
        action, msg = self.ans('我遲到了')
        self.assertIn('預約時段遲到', msg['text'])
        self.assertEqual(msg['buttons'], ['預約遲到怎麼辦', '現場號過號怎麼辦'])
        action, msg = self.ans('可以掛晚上的號嗎')
        self.assertIn('只受理當診次', msg['text'])
        self.assertIn('現場掛號', msg['buttons'])

    def test_covid(self):
        action, msg = self.ans('有打新冠疫苗嗎')
        self.assertTrue(msg['text'].startswith('提醒：本院沒有提供新冠疫苗'))

    def test_date_answers_from_schedule(self):
        action, msg = self.ans('10/10有看診嗎')
        self.assertTrue(msg['text'].startswith('10 月 10 日（六）'))
        self.assertIn('上午 08:00–11:30　蔡', msg['text'])
        self.assertIn('蔡＝蔡宗儒院長', msg['text'])
        self.assertIn('請以診所最新公告為準', msg['text'])
        self.assertTrue(self.ans('明天有看診嗎')[1]['text'].startswith('10 月 9 日（五）'))
        self.assertTrue(self.ans('下週六有開嗎')[1]['text'].startswith('10 月 17 日（六）'))
        self.assertEqual(self.ans('9/26有看診嗎')[1]['text'], '這一天已經過去了，請輸入今天以後的日期。')

    def test_schedule_exception(self):
        msg = self.ans('9/26有看診嗎', today=date(2026, 9, 20))[1]
        self.assertIn('｜門診異動', msg['text'])
        self.assertIn('全日休診', msg['text'])
        self.assertIn('常態週六門診', msg['text'])

    def test_holiday(self):
        action, msg = self.ans('中秋節有看診嗎')
        self.assertTrue(msg['text'].startswith('國定假日、連假、颱風天門診可能調整，請以診所最新公告為準。'))
        self.assertIn('客服不會主動通知門診異動', msg['text'])

    def test_hours_and_contact(self):
        self.assertIn('立欣診所門診時間', self.ans('夜診幾點')[1]['text'])
        self.assertIn('lhpedclinic@gmail.com', self.ans('email')[1]['text'])
        self.assertIn('台南市北區育德路', self.ans('停車方便嗎')[1]['text'])
