import unittest
from datetime import timedelta, datetime
from unittest.mock import patch,MagicMock
from urllib.error import HTTPError
import os
import core
import main

class RegressionTests(unittest.TestCase):
    def test_negation_still_warns_like_website(self):
        # Director 2026-10-03: no negation handling; err on the side of the 119 reminder.
        for q in ['沒有呼吸困難','目前並無嘴唇發紫','沒有呼吸困難嗎？他一直喘','沒有呼吸困難，但嘴唇發紫',
                  '不知道有沒有呼吸困難','孩子沒有咳嗽但叫不醒']:
            self.assertEqual(core.triage(q),'urgent',q)
        self.assertEqual(core.triage('未出現高燒不退'),'soon')
    def test_single_symptom_not_silenced(self):
        for q in ['痛','咳','喘','暈']:
            self.assertIsNone(core.small_talk(q),q)
        for q in ['好','👍','OK']:
            self.assertEqual(core.small_talk(q),'ack')
    def test_thanks_with_question_not_swallowed(self):
        for q in ['謝謝但是還痛','謝謝還沒收到藥','謝謝但沒有好']:
            self.assertIsNone(core.small_talk(q),q)
        self.assertEqual(core.small_talk('謝謝你們的協助'),'thanks')
    def test_invalid_pending_hours(self):
        for value in ['nan','inf','-inf','10000000000000000','bad','-1']:
            with patch.dict(os.environ,{'PENDING_HOURS':value}):
                self.assertEqual(main.pending_hours(),24)
                self.assertTrue(main.pending_active({'status':'pending','pending_since':main.now()}))
    def test_legacy_malformed_timestamp(self):
        self.assertTrue(main.pending_active({'status':'pending','pending_since':'bad'}))
        self.assertTrue(main.pending_active({'status':'pending','pending_since':main.now().replace(tzinfo=None)}))
    def test_pending_suppresses_cached_old_answer(self):
        tx=MagicMock();er=MagicMock();sr=MagicMock()
        er.get.return_value.exists=True
        er.get.return_value.to_dict.return_value={'done':False,'action':'answer','messages':[main.message('舊回答')]}
        sr.get.return_value.to_dict.return_value={'status':'pending','created_at':main.now()}
        self.assertEqual(main.plan_event.to_wrap(tx,er,sr,'Utest','q',{'webhookEventId':'e'}),[])
        self.assertEqual(tx.update.call_args.args[1]['delivery'],'suppressed_during_human')
    def test_pending_retries_handoff_ack(self):
        tx=MagicMock();er=MagicMock();sr=MagicMock()
        er.get.return_value.exists=True
        er.get.return_value.to_dict.return_value={'done':False,'action':'handoff','messages':[main.message('已登記')]}
        sr.get.return_value.to_dict.return_value={'status':'pending','created_at':main.now()}
        self.assertEqual(main.plan_event.to_wrap(tx,er,sr,'Utest','q',{'webhookEventId':'e'}),[main.message('已登記')])
    def test_standby_no_reply(self):
        with patch('main.reply') as rep,patch('main.database') as db:
            main.process_event({'mode':'standby','type':'message','source':{'type':'user','userId':'Utest'},'message':{'type':'text','text':'/我的ID'}})
            rep.assert_not_called();db.assert_not_called()
    def test_utf16_labels(self):
        item={'title':'🦌'*20+'測試','id':'T'}
        result=main.suggestion_message([item])
        action=result['quickReply']['items'][0]['action']
        self.assertLessEqual(len(action['label'].encode('utf-16-le'))//2,20)
        self.assertEqual(action['text'],item['title'])
    def test_catalog_titles_fit_action_limit(self):
        for item in main.CATALOG.items:
            if item.get('kind') != 'faq':
                continue
            self.assertLessEqual(len(item['title'].encode('utf-16-le'))//2,300)
    def delivery(self,code):
        event={'type':'message','source':{'type':'user','userId':'Utest'},'message':{'type':'text','text':'電話'},'replyToken':'t','webhookEventId':'e'}
        ref=MagicMock()
        with patch('main.enabled_for',return_value=True),patch('main.collection') as coll,patch('main.database'),patch('main.plan_event',return_value=[main.message('x')]),patch('main.reply',side_effect=HTTPError('https://api.line.me',code,'test',{},None)):
            coll.return_value.document.return_value=ref
            main.process_event(event)
        return ref
    def test_terminal_400_marked_failed_not_sent(self):
        ref=self.delivery(400)
        self.assertEqual(ref.update.call_args.args[0]['delivery'],'failed_http_400')
    def test_429_and_503_still_retry(self):
        for code in [429,503]:
            with self.assertRaises(HTTPError):self.delivery(code)

if __name__=='__main__':unittest.main()
