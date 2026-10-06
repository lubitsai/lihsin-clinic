"""Cloud Run Functions entry point: linebot. No generative medical advice."""
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from google.cloud import firestore
from core import Catalog, NONTEXT, RESUME_WORDS, decide, norm

ROOT = Path(__file__).parent
CATALOG = Catalog(json.loads((ROOT / 'faq.json').read_text(encoding='utf-8')))
LEGACY = json.loads((ROOT / 'legacy_messages.json').read_text(encoding='utf-8'))
REPLIES = CATALOG.replies
TAIPEI = ZoneInfo('Asia/Taipei')
STAFF_BUTTON = {'type':'action','action':{'type':'message','label':'請專人協助','text':'專人服務'}}
DB = None

def database():
    global DB
    if DB is None:
        DB = firestore.Client(database=os.getenv('FIRESTORE_DATABASE', '(default)'))
    return DB

def collection(name):
    return database().collection(os.getenv('FIRESTORE_PREFIX', 'lh_helpdesk_') + name)

def now():
    return datetime.now(timezone.utc)

def line_api(path, payload):
    req = Request('https://api.line.me/v2/bot/' + path,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['LINE_CHANNEL_ACCESS_TOKEN'],
                 'Content-Type': 'application/json'}, method='POST')
    with urlopen(req, timeout=12) as response:
        return response.status

def reply(token, messages):
    if messages and token:
        line_api('message/reply', {'replyToken':token, 'messages':messages})

def message(text):
    return {'type':'text','text':text}

def with_staff_button(msg, extra=()):
    return dict(msg, quickReply={'items':[*extra, STAFF_BUTTON]})

def utf16_clip(text, limit):
    return text.encode('utf-16-le')[:limit*2].decode('utf-16-le', errors='ignore')

def suggestion_message(items):
    lines = [REPLIES['suggest_head']] + [f"{i}. {item['title']}" for i, item in enumerate(items, 1)]
    buttons = [{'type':'action','action':{'type':'message',
                'label':utf16_clip(f"{i}. {item['title']}", 20), 'text':item['title']}}
               for i, item in enumerate(items, 1)]
    return with_staff_button(message('\n'.join(lines)), buttons)

def question_buttons(texts):
    """Quick-reply buttons that send a follow-up question (or a rich-menu keyword) as the user."""
    return [{'type':'action','action':{'type':'message','label':utf16_clip(t, 20),'text':t}} for t in texts]

def auto_handoff():
    """AUTO_HANDOFF=on (default): questions the bot cannot answer at all, and images/files, open a staff case."""
    return os.getenv('AUTO_HANDOFF', 'on').strip().lower() not in ('off', '0', 'false', 'no')

def pending_hours():
    try:
        value = float(os.getenv('PENDING_HOURS', '24'))
        return value if math.isfinite(value) and 0 <= value <= 8760 else 24.0
    except ValueError:
        return 24.0

def pending_active(state):
    """A case silences the bot only until staff close it or PENDING_HOURS pass (0 = never auto-resume)."""
    if state.get('status') != 'pending':
        return False
    hours = pending_hours()
    since = state.get('pending_since') or state.get('created_at')
    if hours <= 0 or since is None:
        return True
    if not isinstance(since, datetime):
        return True  # malformed stored date: preserve human ownership
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    return now() - since < timedelta(hours=hours)

def admin_ids():
    return {x.strip() for x in os.getenv('ADMIN_USER_IDS','').split(',') if x.strip()}

def enabled_for(uid):
    mode = os.getenv('BOT_MODE','pilot')
    if mode == 'off':
        return False
    if mode == 'live':
        return True
    return uid in admin_ids() | {x.strip() for x in os.getenv('PILOT_USER_IDS','').split(',') if x.strip()}

def handoff_message(case):
    return message('您好，我是立欣診所小鹿客服。這個問題需要由專人確認，已登記待處理（案件編號：' + case + '）。\n機器人將暫停回覆，請留下您的問題，由診所人員於服務時間查看後回覆；此處非即時醫療諮詢。\n若需即時聯繫，請致電 06-2516086；不需要專人協助了，可輸入「結束專人服務」。')

@firestore.transactional
def plan_event(tx, event_ref, session_ref, uid, text, event):
    prior = event_ref.get(transaction=tx)
    session = session_ref.get(transaction=tx)
    state = session.to_dict() or {}
    if prior.exists:
        old = prior.to_dict()
        if old.get('done'):
            return []
        if pending_active(state) and old.get('action') not in ('urgent','soon','handoff'):
            tx.update(event_ref, {'done':True,'messages':[], 'delivery':'suppressed_during_human'})
            return []
        return old.get('messages', [])
    passthrough = set(json.loads(os.getenv('OA_PASSTHROUGH_KEYWORDS', '["流感疫苗資訊","過敏氣喘諮詢","減重營養諮詢"]')))
    pending = pending_active(state)
    if text == '我的案件編號' and state.get('status') == 'pending':
        action, answer = 'answer', message('您的待處理案件編號：' + state['case_id'])
    elif norm(text) in RESUME_WORDS and state.get('status') == 'pending':
        action, answer = 'resume', None
    else:
        action, answer = decide(text, pending, CATALOG, LEGACY, passthrough, now().astimezone(TAIPEI).date())
    if action in ('unknown', 'nontext') and auto_handoff():
        # Nothing approved to say, not even a related question: hand over instead of a dead end.
        action = 'handoff'
    messages = []
    if pending and action in ('urgent', 'soon', 'silent'):
        # Store only a bounded recent question, not a transcript.
        tx.update(session_ref, {'latest_question':text[:500], 'updated_at':now()})
    if action == 'handoff':
        if state.get('status') == 'pending':
            # Past the auto-resume window and asking again: same case, waiting again.
            case = state['case_id']
            tx.update(session_ref, {'pending_since':now(), 'updated_at':now(), 'latest_question':text[:500]})
        else:
            case = hashlib.sha256((uid + event['webhookEventId']).encode()).hexdigest()[:16].upper()
            tx.set(session_ref, {'status':'pending','case_id':case,'created_at':now(),'pending_since':now(),
                'updated_at':now(),'question':text[:500], 'latest_question':text[:500]})
        messages = [handoff_message(case)]
    elif action == 'resume':
        tx.update(session_ref, {'status':'bot','closed_at':now(),'closed_by':'user',
                                'question':firestore.DELETE_FIELD,'latest_question':firestore.DELETE_FIELD})
        messages = [message(REPLIES['resumed'])]
    elif action in ('urgent', 'soon'):
        messages = [message(answer)]
    elif action == 'suggest':
        messages = [suggestion_message(answer)]
    elif action in ('unknown', 'nontext'):
        messages = [with_staff_button(message(REPLIES[action]))]
    elif action == 'answer':
        if answer.get('type') == 'text':
            body = {k: v for k, v in answer.items() if k != 'buttons'}
            messages = [with_staff_button(body, question_buttons(answer.get('buttons', ())))]
        else:
            messages = [answer]
    tx.set(event_ref, {'done':not bool(messages),'messages':messages,'action':action,
                       'expires_at':now()+timedelta(days=7)})
    return messages

@firestore.transactional
def close_case(tx, ref, expected_case, uid):
    snap = ref.get(transaction=tx)
    data = snap.to_dict() or {}
    if data.get('status') != 'pending' or data.get('case_id') != expected_case:
        return False
    tx.update(ref, {'status':'bot','closed_at':now(),'closed_by':uid,
                    'question':firestore.DELETE_FIELD,'latest_question':firestore.DELETE_FIELD})
    return True

def admin_command(uid, text):
    if uid not in admin_ids():
        return '此指令僅供已授權員工使用。'
    args = text.split()
    if len(args) >= 2 and args[1] == '待處理':
        cursor = args[2] if len(args) == 3 else None
        if len(args) > 3 or (cursor and not re.fullmatch(r'U[0-9a-f]{32}', cursor)):
            return '用法：/客服 待處理（下一頁請複製提供的指令）'
        query = collection('sessions').where(filter=firestore.FieldFilter('status','==','pending')).order_by('__name__')
        if cursor:
            query = query.start_after({'__name__': collection('sessions').document(cursor)})
        rows = list(query.limit(11).stream())
        if not rows:
            return '目前沒有待處理案件。'
        parts = ['待處理案件（每頁最多10筆）：']
        for row in rows[:10]:
            d = row.to_dict()
            since = d.get('pending_since') or d.get('created_at')
            when = since.replace(tzinfo=since.tzinfo or timezone.utc).astimezone(TAIPEI).strftime('%m/%d %H:%M') if isinstance(since, datetime) else ''
            note = '' if pending_active(d) else '（已逾時，小幫手已恢復回答，仍請回覆）'
            parts.append(d['case_id'] + ' ' + when + note + '\n' + d.get('question','')[:80] + '\n最近：' + d.get('latest_question','')[:80])
        if len(rows)>10:
            parts.append('下一頁：/客服 待處理 ' + rows[9].id)
        parts.append('請先在官方帳號聊天室回覆民眾，完成後輸入：/客服 結案 案件編號')
        return '\n\n'.join(parts)
    if len(args) == 3 and args[1] == '結案' and re.fullmatch(r'[A-Fa-f0-9]{16}', args[2]):
        case = args[2].upper()
        rows = list(collection('sessions').where(filter=firestore.FieldFilter('case_id','==',case)).limit(2).stream())
        if len(rows) != 1:
            return '找不到唯一案件，未變更。請核對案件編號。'
        ok = close_case(database().transaction(), rows[0].reference, case, uid)
        return '已結案；此民眾的下一則訊息恢復機器人回答。' if ok else '案件已結案或已變更，未再次修改。'
    return '員工指令：\n/客服 待處理\n/客服 結案 案件編號\n請先在官方帳號後台人工回答，再結案。'

def process_event(event):
    source = event.get('source', {})
    uid = source.get('userId')
    if event.get('mode') == 'standby':
        return
    if source.get('type') != 'user' or not uid:
        return
    if event.get('type') != 'message':
        return
    msg = event.get('message', {})
    if msg.get('type') == 'sticker':
        return  # stickers never open a case or get a reply
    text = msg.get('text', '').strip() if msg.get('type') == 'text' else NONTEXT
    if not text:
        return
    token = event.get('replyToken')
    if text == '/我的ID':
        reply(token, [message('您的 LINE 使用者 ID：\n' + uid + '\n此 ID 不代表已取得管理權限。')])
        return
    if text.startswith('/客服'):
        reply(token, [message(admin_command(uid, text))])
        return
    if not enabled_for(uid):
        # Pilot/off preserve original menu behavior for non-pilot users.
        if text in LEGACY:
            reply(token, [LEGACY[text]])
        return
    eid = event.get('webhookEventId')
    if not eid:
        raise ValueError('Missing webhook event id')
    ref = collection('events').document(hashlib.sha256(eid.encode()).hexdigest())
    messages = plan_event(database().transaction(), ref,
                          collection('sessions').document(uid), uid, text, event)
    if messages:
        if not token:
            ref.update({'done':True,'messages':[], 'delivery':'failed_missing_reply_token'})
            logging.error('helpdesk_reply_missing_token')
            return
        try:
            reply(token, messages)
        except HTTPError as exc:
            if exc.code != 400:
                raise  # auth, throttling and service failures remain visible/retryable
            # Bad/expired/used reply tokens and malformed payloads cannot be fixed by redelivery.
            # Record failure, not successful delivery; never log message bodies or credentials.
            ref.update({'done':True,'messages':[], 'delivery':'failed_http_400'})
            logging.error('helpdesk_reply_rejected status=400')
            return
        ref.update({'done':True,'messages':[], 'delivery':'sent'})

def linebot(request):
    if request.method == 'GET':
        return 'OK', 200
    if request.method != 'POST':
        return 'Method not allowed', 405
    secret = os.getenv('LINE_CHANNEL_SECRET')
    if not secret or not os.getenv('LINE_CHANNEL_ACCESS_TOKEN'):
        return 'Configuration required', 503
    raw = request.get_data()
    signature = request.headers.get('X-Line-Signature','')
    expected = base64.b64encode(hmac.new(secret.encode(),raw,hashlib.sha256).digest()).decode()
    if not hmac.compare_digest(signature,expected):
        return 'Invalid signature', 400
    try:
        payload = json.loads(raw)
        if not isinstance(payload.get('events'), list):
            return 'Invalid payload', 400
    except (ValueError, AttributeError):
        return 'Invalid payload', 400
    failed = False
    for event in payload['events']:
        try:
            process_event(event)
        except Exception as exc:
            # Never log the raw webhook, question, token, user ID or response body.
            logging.error('helpdesk_event_failed type=%s', type(exc).__name__)
            failed = True
    return ('Retry later', 503) if failed else ('OK', 200)
