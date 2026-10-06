import base64
import hashlib
import hmac
import json
import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch, MagicMock
from flask import Flask, request
import main
from core import decide

class RoutingTests(unittest.TestCase):
    def route(self,t,pending=False):
        return decide(t,pending,main.CATALOG,main.LEGACY,{'流感疫苗資訊'},date(2026,10,3))
    def test_faq_and_unknown(self):
        self.assertEqual(self.route('請問診所電話？')[0],'answer')
        self.assertIn(self.route('小孩藥可以加倍嗎')[0],('suggest','unknown'))
        self.assertEqual(self.route('專人服務')[0],'handoff')
    def test_pending_silences_menus_but_not_emergencies(self):
        for q in ['診所電話','醫師介紹','專人服務','流感疫苗資訊']:
            self.assertEqual(self.route(q,True)[0],'silent')
        self.assertEqual(self.route('孩子呼吸困難',True)[0],'urgent')
    def test_passthrough_and_legacy(self):
        self.assertEqual(self.route('流感疫苗資訊')[0],'passthrough')
        self.assertEqual(self.route('醫師介紹')[1],main.LEGACY['醫師介紹'])
    def test_unauthorized_cannot_close_case(self):
        with patch.dict(os.environ,{'ADMIN_USER_IDS':'owner'}):
            self.assertIn('僅供',main.admin_command('stranger','/客服 結案 ABCD'))
    def test_pilot_gate(self):
        with patch.dict(os.environ,{'BOT_MODE':'pilot','ADMIN_USER_IDS':'owner','PILOT_USER_IDS':'tester'}):
            self.assertTrue(main.enabled_for('tester'))
            self.assertFalse(main.enabled_for('patient'))
    def test_suggestion_buttons_fit_line_limits(self):
        hits=self.route('有流感疫苗嗎')[1]
        msg=main.suggestion_message(hits)
        items=msg['quickReply']['items']
        self.assertEqual(items[-1],main.STAFF_BUTTON)
        for it in items:
            self.assertLessEqual(len(it['action']['label']),20)
            self.assertLessEqual(len(it['action']['text']),300)
        self.assertEqual(items[0]['action']['text'],hits[0]['title'])
    def test_pending_window(self):
        fresh={'status':'pending','pending_since':main.now()-timedelta(hours=1)}
        old={'status':'pending','pending_since':main.now()-timedelta(hours=25)}
        self.assertTrue(main.pending_active(fresh))
        self.assertFalse(main.pending_active(old))
        with patch.dict(os.environ,{'PENDING_HOURS':'0'}):
            self.assertTrue(main.pending_active(old))
        self.assertFalse(main.pending_active({'status':'bot'}))

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__)
    def invoke(self,body,sig=True):
        raw=json.dumps(body).encode()
        signature=base64.b64encode(hmac.new(b'testsecret',raw,hashlib.sha256).digest()).decode() if sig else 'bad'
        with patch.dict(os.environ,{'LINE_CHANNEL_SECRET':'testsecret','LINE_CHANNEL_ACCESS_TOKEN':'testtoken'}):
            with self.app.test_request_context('/',method='POST',data=raw,headers={'X-Line-Signature':signature}):
                return main.linebot(request)
    def test_empty_verification(self):
        self.assertEqual(self.invoke({'events':[]})[1],200)
    def test_signature_before_processing(self):
        with patch('main.process_event') as process:
            self.assertEqual(self.invoke({'events':[{}]},False)[1],400)
            process.assert_not_called()
    def test_all_events_processed_despite_one_failure(self):
        with patch('main.process_event',side_effect=[ValueError(),None]) as process:
            self.assertEqual(self.invoke({'events':[{'id':1},{'id':2}]})[1],503)
            self.assertEqual(process.call_count,2)
    def test_nonmessage_and_group_ignored(self):
        with patch('main.database') as db:
            main.process_event({'type':'follow','source':{'type':'user','userId':'Utest'}})
            main.process_event({'type':'message','source':{'type':'group','userId':'Utest'}})
            db.assert_not_called()

class TransactionTests(unittest.TestCase):
    def test_handoff_persisted_before_reply(self):
        tx=MagicMock(); er=MagicMock(); sr=MagicMock()
        er.get.return_value.exists=False
        sr.get.return_value.to_dict.return_value={}
        result=main.plan_event.to_wrap(tx,er,sr,'Utest','專人服務',{'webhookEventId':'evt1'})
        self.assertIn('已登記',result[0]['text'])
        session=tx.set.call_args_list[0].args[1]
        self.assertEqual(session['status'],'pending')
        self.assertEqual(len(session['case_id']),16)
    def test_duplicate_done_event_silent(self):
        tx=MagicMock(); er=MagicMock(); sr=MagicMock()
        er.get.return_value.exists=True
        er.get.return_value.to_dict.return_value={'done':True,'messages':[]}
        self.assertEqual(main.plan_event.to_wrap(tx,er,sr,'Utest','q',{'webhookEventId':'evt1'}),[])
        tx.set.assert_not_called()
    def test_failed_delivery_retains_response_for_retry(self):
        tx=MagicMock(); er=MagicMock(); sr=MagicMock()
        er.get.return_value.exists=True
        er.get.return_value.to_dict.return_value={'done':False,'messages':[main.message('已登記')]}
        self.assertEqual(main.plan_event.to_wrap(tx,er,sr,'Utest','q',{'webhookEventId':'evt1'}),[main.message('已登記')])
    def test_pending_question_silent_and_recorded(self):
        tx=MagicMock(); er=MagicMock(); sr=MagicMock()
        er.get.return_value.exists=False
        sr.get.return_value.to_dict.return_value={'status':'pending','case_id':'ABC','pending_since':main.now()}
        self.assertEqual(main.plan_event.to_wrap(tx,er,sr,'Utest','診所電話',{'webhookEventId':'evt2'}),[])
        self.assertEqual(tx.update.call_args.args[1]['latest_question'],'診所電話')
    def plan(self,text,state):
        tx=MagicMock(); er=MagicMock(); sr=MagicMock()
        er.get.return_value.exists=False
        sr.get.return_value.to_dict.return_value=state
        return tx,main.plan_event.to_wrap(tx,er,sr,'Utest',text,{'webhookEventId':'evt9'})
    def test_unanswerable_question_opens_case_automatically(self):
        tx,result=self.plan('這題沒有設定987654321',{})
        self.assertIn('已登記待處理',result[0]['text'])
        session=tx.set.call_args_list[0].args[1]
        self.assertEqual((session['status'],session['question']),('pending','這題沒有設定987654321'))
    def test_related_questions_still_offered_before_handoff(self):
        tx,result=self.plan('有流感疫苗嗎',{})
        self.assertTrue(result[0]['text'].startswith(main.REPLIES['suggest_head']))
        self.assertFalse([c for c in tx.set.call_args_list if c.args[1].get('status')=='pending'])
    def test_auto_handoff_can_be_turned_off(self):
        with patch.dict(os.environ,{'AUTO_HANDOFF':'off'}):
            tx,result=self.plan('這題沒有設定987654321',{})
        self.assertEqual(result[0]['text'],main.REPLIES['unknown'])
        self.assertEqual(result[0]['quickReply']['items'],[main.STAFF_BUTTON])
        self.assertFalse([c for c in tx.set.call_args_list if c.args[1].get('status')=='pending'])
    def test_unanswerable_while_waiting_stays_silent(self):
        tx,result=self.plan('這題沒有設定987654321',{'status':'pending','case_id':'ABC','pending_since':main.now()})
        self.assertEqual(result,[])
    def test_urgent_while_pending_replies_and_records(self):
        tx,result=self.plan('孩子嘴唇發紫',{'status':'pending','case_id':'ABC','pending_since':main.now()})
        self.assertIn('119',result[0]['text'])
        self.assertEqual(tx.update.call_args.args[1]['latest_question'],'孩子嘴唇發紫')
    def test_user_can_end_case(self):
        tx,result=self.plan('結束專人服務',{'status':'pending','case_id':'ABC','pending_since':main.now()})
        self.assertEqual(result[0]['text'],main.REPLIES['resumed'])
        self.assertEqual(tx.update.call_args.args[1]['status'],'bot')
        self.assertEqual(tx.update.call_args.args[1]['closed_by'],'user')
    def test_expired_case_answers_and_rehandoff_keeps_case_id(self):
        old={'status':'pending','case_id':'ABC','pending_since':main.now()-timedelta(hours=30)}
        _,result=self.plan('診所電話',dict(old))
        self.assertIn('06-2516086',result[0]['text'])
        tx,result=self.plan('專人服務',dict(old))
        self.assertIn('ABC',result[0]['text'])
        tx.set.assert_called_once()   # only the event record; session is updated, not replaced
        self.assertIn('pending_since',tx.update.call_args.args[1])
    def test_sticker_ignored_image_handed_over(self):
        with patch('main.database') as db, patch('main.reply') as rep, patch.dict(os.environ,{'BOT_MODE':'live'}):
            main.process_event({'type':'message','source':{'type':'user','userId':'Utest'},'message':{'type':'sticker'},'replyToken':'t'})
            db.assert_not_called(); rep.assert_not_called()
        tx,result=self.plan(main.NONTEXT,{})
        self.assertIn('已登記待處理',result[0]['text'])   # staff can see the image in the chat
        with patch.dict(os.environ,{'AUTO_HANDOFF':'off'}):
            tx,result=self.plan(main.NONTEXT,{})
        self.assertEqual(result[0]['text'],main.REPLIES['nontext'])

    def test_close_clears_question_and_reenables_bot(self):
        tx=MagicMock(); sr=MagicMock()
        sr.get.return_value.to_dict.return_value={'status':'pending','case_id':'ABC'}
        self.assertTrue(main.close_case.to_wrap(tx,sr,'ABC','owner'))
        self.assertEqual(tx.update.call_args.args[1]['status'],'bot')
        self.assertEqual(tx.update.call_args.args[1]['question'],main.firestore.DELETE_FIELD)
    def test_stale_close_does_not_close_new_case(self):
        tx=MagicMock(); sr=MagicMock()
        sr.get.return_value.to_dict.return_value={'status':'pending','case_id':'NEW'}
        self.assertFalse(main.close_case.to_wrap(tx,sr,'OLD','owner'))
        tx.update.assert_not_called()

if __name__ == '__main__':
    unittest.main()
