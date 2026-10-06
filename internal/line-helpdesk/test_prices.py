"""Self-pay prices (director 2026-10-05): same rules as the website, LINE-only promotion wording."""
import json
import unittest
from datetime import date
from pathlib import Path

import core
from core import Catalog, decide

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / 'faq.json').read_text(encoding='utf-8'))
CAT = Catalog(DATA)
LEGACY = json.loads((ROOT / 'legacy_messages.json').read_text(encoding='utf-8'))

def reply(q):
    action, msg = decide(q, False, CAT, LEGACY, set(), date(2026, 10, 5))
    return action, (msg or {}).get('text', '') if isinstance(msg, dict) else ''

class PriceTests(unittest.TestCase):
    def assertPrice(self, q, *parts):
        action, text = reply(q)
        self.assertEqual(action, 'answer', q)
        for p in parts:
            self.assertIn(p, text, q)

    def test_items(self):
        self.assertPrice('水痘疫苗多少錢', '2,400 元', '仿單')          # vaccines carry the four caveats
        self.assertPrice('肺炎疫苗多少錢', '4,000', '4,500', '哪一種')
        self.assertPrice('RSV多少錢', '快篩', '單株抗體', '成人')
        self.assertPrice('流感快篩多少錢', '250 元')
        self.assertPrice('我女兒A肝多少錢', '900 元', '需先預約')
        self.assertPrice('診斷書多少錢', '第 2 份起每份 50 元')
        self.assertPrice('打點滴多少錢', '850 元起')

    def test_flu_vaccines(self):
        self.assertPrice('自費流感疫苗多少錢', '伏流感 1,000', '1,500', '1,900 元，目前已售完', '1,600', '仿單')
        self.assertPrice('能伏鼻多少', '1,600 元')
        self.assertPrice('輔流禦多少錢', '目前已售完')
        self.assertPrice('流感多少錢', '快篩', '疫苗')
        self.assertIsNone(CAT.prices.match('公費流感疫苗多少錢'))
        self.assertIsNone(CAT.prices.match('過敏鼻噴劑多少錢'))

    def test_clinic_brand_names(self):
        # 院長 2026-10-06 交付的院內疫苗品項表：品牌名對到同一條價目
        for q, part in [('必思諾多少錢', '6,500 元'), ('沛兒20多少錢', '4,500 元'), ('伏痘敏多少錢', '2,400 元'),
                        ('恩穩健多少錢', '4,100 元'), ('Beyfortus多少錢', '16,000 元'), ('M-M-R II多少錢', '1,000 元'),
                        ('補施追多少錢', '1,500 元'), ('安在時多少錢', '500 元'), ('肺恩賜多少錢', '4,000 元')]:
            self.assertPrice(q, part)

    def test_line_promotions(self):
        self.assertPrice('帶狀皰疹疫苗多少', '16,500', '每人可折 500 元')
        self.assertPrice('皮蛇疫苗兩個人一起打多少', '同行優惠與兩劑付清的併用')
        self.assertPrice('HPV多少錢', '優惠價為 16,500')
        self.assertPrice('減重8週多少錢', '原價 36,800', '推廣價為 30,800')

    def test_no_drug_names(self):
        for q in ['瘦瘦筆一支多少錢', '猛健樂多少錢', '減重多少錢']:
            action, text = reply(q)
            self.assertEqual(action, 'answer', q)
            self.assertIn('醫師評估後開立的藥物', text)
            self.assertNotRegex(text, '瘦瘦筆|猛健樂')

    def test_line_wording_and_quick_test_rules(self):
        _, text = reply('兩劑型輪狀多少')
        self.assertIn('在此聊天室輸入「專人服務」', text)
        _, text = reply('流感快篩多少錢')
        self.assertNotIn('不另外收取掛號費', text)
        self.assertNotIn('仿單', text)

    def test_gates(self):
        self.assertIsNone(CAT.prices.match('公費水痘疫苗多少錢'))
        self.assertIsNone(CAT.prices.match('水痘疫苗免費嗎'))
        self.assertIsNone(CAT.prices.match('水痘疫苗要打幾劑'))
        self.assertIsNone(CAT.prices.match('打自費疫苗要掛號費嗎'))
        self.assertIsNone(CAT.prices.match('克流感多少錢'))
        self.assertEqual(reply('多少錢')[1], next(i for i in DATA['items'] if i['id'] == 'KEY06')['answer'])

    def test_emergency_still_first(self):
        self.assertEqual(reply('孩子呼吸困難，打點滴多少錢')[0], 'urgent')

if __name__ == '__main__':
    unittest.main()
