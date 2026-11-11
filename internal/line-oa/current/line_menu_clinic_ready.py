# 在 Google Colab 的 Python 程式碼儲存格執行
import io, json, getpass
from datetime import datetime
from urllib.parse import urlparse
from pathlib import Path
import requests
from PIL import Image
from google.colab import files
from IPython.display import display

def main():
    token = getpass.getpass('貼上 Channel access token（隱藏輸入）：').strip()
    if not token:
        raise ValueError('Token 不可空白')
    session = requests.Session()
    session.headers['Authorization'] = 'Bearer ' + token
    base = 'https://api.line.me/v2/bot'

    def call(method, url, **kwargs):
        r = session.request(method, url, timeout=60, **kwargs)
        if not r.ok:
            raise RuntimeError(f'LINE 回應 {r.status_code}：' + r.text.replace(token, '[已隱藏]'))
        return r.json() if r.content else {}

    try:
        bot = call('GET', base + '/info')
        print('連線帳號：', bot.get('displayName'), bot.get('basicId'))
        print('請上傳 rich-menu-9area-health.jpg（2500 × 1686、1 MB 以下；右下格為「衛教專區」）。')
        uploaded = files.upload()
        if len(uploaded) != 1:
            raise ValueError('請只上傳一張圖片')
        data = next(iter(uploaded.values()))
        im = Image.open(io.BytesIO(data))
        if im.size != (2500, 1686) or im.format not in ('JPEG', 'PNG'):
            raise ValueError('圖片必須是 2500 × 1686 的 JPEG 或 PNG')
        if len(data) > 1000000:
            raise ValueError('請使用 1 MB 以下的圖片')
        mime = 'image/jpeg' if im.format == 'JPEG' else 'image/png'
        display(im.resize((750, 506)))

        labels = ['線上掛號', '看診進度', '醫師介紹', '診所資訊',
                  '流感疫苗資訊', '過敏門診', '減重門診', '衛教專區']
        values = [
            'https://liff.line.me/2005432137-reYdg0y3',
            'https://www.mainpi.com/query?i=2935',
            '醫師介紹', '診所資訊', '流感疫苗資訊',
            '過敏氣喘諮詢', '減重營養諮詢',
            'https://lhpedclinic.com.tw/health/'   # 2026-11-11 院長裁示：粉絲專頁改衛教專區（粉專移到「診所資訊」卡片按鈕）
        ]
        areas = []
        print('已填入原有八格設定，並加上中間品牌帶 → 官網首頁。')
        print('「過敏門診」傳送「過敏氣喘諮詢」；「減重門診」傳送「減重營養諮詢」，沿用後台自動回應。')
        for i, (label, value) in enumerate(zip(labels, values)):
            action = ({'type': 'uri', 'label': label, 'uri': value}
                      if value.startswith('https://')
                      else {'type': 'message', 'text': value})
            areas.append({'bounds': {'x': (i % 4)*625,
                'y': 0 if i < 4 else 1140, 'width': 625,
                'height': 610 if i < 4 else 546}, 'action': action})
        # 2026-11-07 院長核可：中間品牌帶（y 610–1140）原本沒有動作，改為開啟官網首頁（首頁有最新門診異動公告）
        labels.append('官網首頁（中間品牌帶）')
        areas.append({'bounds': {'x': 0, 'y': 610, 'width': 2500, 'height': 530},
                      'action': {'type': 'uri', 'label': '官網首頁', 'uri': 'https://lhpedclinic.com.tw/'}})

        menu = {'size': {'width': 2500, 'height': 1686}, 'selected': True,
                'name': '立欣診所九區選單-' + datetime.now().strftime('%Y%m%d-%H%M%S'),
                'chatBarText': '診所服務選單', 'areas': areas}
        call('POST', base + '/richmenu/validate', json=menu)
        old = session.get(base + '/user/all/richmenu', timeout=60)
        if old.status_code == 403:
            # 此 GET 端點的官方定義：預設選單由 OA Manager 等其他管道設定。
            old_id = None
            old_source = 'other_channel_or_oa_manager'
            print('目前選單由 LINE 後台等其他管道設定（403）；可繼續建立 API 選單。')
            print('原後台選單將保留，不會刪除。')
        elif old.status_code == 404:
            old_id = None
            old_source = 'none'
        elif old.ok:
            old_id = old.json()['richMenuId']
            old_source = 'messaging_api'
        else:
            detail = old.text.replace(token, '[已隱藏]')
            raise RuntimeError(f'無法確認舊選單，HTTP {old.status_code}：{detail}，尚未發布。')

        print('\n請核對帳號與九區設定：', bot.get('displayName'), bot.get('basicId'))
        for label, area in zip(labels, areas):
            a = area['action']
            print(label, '→', a.get('uri', '傳送文字：' + a.get('text', '')))
        if input('\n輸入「發布」將此選單設為帳號預設；其他輸入取消：').strip() != '發布':
            print('已取消，沒有建立或切換選單。')
            return
        new_id = call('POST', base + '/richmenu', json=menu)['richMenuId']
        print('已建立選單，ID：', new_id)
        backup = {'account': bot.get('basicId'), 'previous_api_default': old_id,
                  'previous_default_source': old_source,
                  'new_rich_menu_id': new_id, 'menu': menu}
        Path('line_menu_backup.json').write_text(json.dumps(backup, ensure_ascii=False, indent=2), encoding='utf-8')
        files.download('line_menu_backup.json')
        call('POST', f'https://api-data.line.me/v2/bot/richmenu/{new_id}/content',
             data=data, headers={'Content-Type': mime})
        call('POST', base + '/user/all/richmenu/' + new_id)
        current = call('GET', base + '/user/all/richmenu')['richMenuId']
        if current != new_id:
            raise RuntimeError('發布後查核不一致，請用手機確認。')
        print('發布成功！請重新開啟手機 LINE 聊天室並測試九區（含中間品牌帶）。')
        print('舊選單未刪除；個別用戶綁定的選單可能仍會優先顯示。')
        print('請保留下載的 line_menu_backup.json，內含新舊選單 ID，不含 Token。')
    finally:
        session.headers.pop('Authorization', None)
        session.close()

try:
    main()
except Exception as e:
    print('操作停止：', str(e))
    print('如已顯示新選單 ID，請保留它；不要連續重跑，以免建立重複選單。')
