#!/usr/bin/env python3
"""官網「線上小幫手」資料檔產生器：AI 客服知識庫正本＋首頁門診時間 → /clinic-assistant/knowledge.json。

線上小幫手（2026-09-24 起取代 Chatbase）是純前端的規則分流＋常見問題檢索，
不連任何語言模型，所以它能說的每一句話都必須來自這支工具產出的 JSON：

    internal/AI客服知識庫_立欣診所_正本_*.md（最新一份）
        ├── 二、開場白＋建議問題（逐字）
        ├── 三、急症腳本／次級紅旗（逐字）
        ├── 四、診所基本事實、現場掛號、網路預約規則、⏰ 目前官網公告
        ├── 五、Q&A 本體（官網 FAQ 結構化資料鏡像，逐字）
        └── 六、補充問答（⏰ 12 月後整節刪）
    index.html
        └── 可見門診時間表＋JS 的 SCHEDULE/EXCEPTIONS（沿用 sync_schedule.py 的解析與交叉核對）
                    │
                    ▼
    clinic-assistant/knowledge.json（產生檔，勿手改）

知識庫正本在 internal/（_redirects 擋成 404），公開部署的只有這份 JSON，
所以系統指示、合規自檢、維護規則這些內部段落刻意不輸出。

用法：
    python3 internal/tools/build_assistant_kb.py            # 產生／更新 knowledge.json
    python3 internal/tools/build_assistant_kb.py --check    # 不寫檔；與現況不一致即 exit 1

什麼時候要重跑（validate_site.py 會以 ERROR 擋下漏跑）：
- 重產知識庫正本（build_chatbot_kb.py）之後
- 改首頁門診時間表或 EXCEPTIONS（門診異動公告）之後——與 sync_schedule.py 同批
- 首頁公告上架／下架、知識庫第四節 ⏰ 公告表更新之後
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_schedule  # noqa: E402

SITE = 'https://lhpedclinic.com.tw'
OUT_REL = 'clinic-assistant/knowledge.json'
KB_GLOB = 'AI客服知識庫_立欣診所_正本_*.md'


class KbError(RuntimeError):
    pass


def section(text: str, start: str, end: str) -> str:
    try:
        return text.split(start, 1)[1].split(end, 1)[0]
    except IndexError:
        raise KbError(f'找不到段落 {start!r}…{end!r}')


def code_blocks(text: str) -> list[str]:
    return [b.strip('\n') for b in re.findall(r'```\n(.*?)```', text, re.S)]


def plain(md: str) -> str:
    """Markdown 粗體／行內碼去標記；答案本身是純文字，這裡只處理第四、六節的手寫段落。"""
    md = re.sub(r'\*\*(.+?)\*\*', r'\1', md)
    md = re.sub(r'`([^`]+)`', r'\1', md)
    return md.strip()


def page_titles(root: Path, paths: set[str]) -> dict[str, str]:
    out = {}
    for p in sorted(paths):
        f = root / (p.lstrip('/') + ('index.html' if p.endswith('/') else ''))
        if not f.exists():
            raise KbError(f'知識庫來源頁不存在：{p}（先重產知識庫正本）')
        m = re.search(r'<title>(.*?)</title>', f.read_text(encoding='utf-8'), re.S)
        title = re.sub(r'\s+', ' ', m.group(1)).strip() if m else p
        # 「主題｜立欣診所…」只留主題，卡片上當「出自」標籤
        out[p] = re.split(r'\s*[｜|]\s*', title)[0].replace('&amp;', '&')
    return out


def extract_qa(text: str, prefix: str) -> list[dict]:
    rows = []
    pattern = re.compile(r'^\*\*(' + prefix + r'\d+)\s*(⏰)?｜(.*?)\*\*\s*\n', re.M)
    for m in pattern.finditer(text):
        tail = text[m.end():]
        end = re.search(r'^\*\*[QS]\d+|^#{2,3} |^---\s*$', tail, re.M)
        answer = tail[:end.start() if end else len(tail)].strip()
        pages = re.findall(r'^### 來源頁：`([^`]+)`', text[:m.start()], re.M)
        rows.append({
            'id': m.group(1),
            'title': m.group(3).replace('★', '').strip(),
            'answer': answer,
            'path': pages[-1] if pages else '/',
            'core': '★' in m.group(3),
            'seasonal': bool(m.group(2)),
        })
    return rows


def build(root: Path, kb_path: Path) -> dict:
    kb = kb_path.read_text(encoding='utf-8')
    m = re.search(r'_(\d{8})\.md$', kb_path.name)
    if not m:
        raise KbError(f'知識庫檔名缺日期：{kb_path.name}')
    reviewed = f'{m.group(1)[:4]}-{m.group(1)[4:6]}-{m.group(1)[6:]}'

    # ── 二、開場白＋建議問題；三、急症腳本（逐字，院長核可過的 Chatbase 文字） ──
    greet_blocks = code_blocks(section(kb, '## 二、', '## 三、'))
    if len(greet_blocks) != 2:
        raise KbError(f'第二節應有開場白與建議問題兩個程式碼區塊，實得 {len(greet_blocks)}')
    urgent_blocks = code_blocks(section(kb, '## 三、', '## 四、'))
    if len(urgent_blocks) != 2:
        raise KbError(f'第三節應有急症與次級紅旗兩段固定回覆，實得 {len(urgent_blocks)}')

    # ── 四、診所基本事實 ──
    ops = section(kb, '## 四、', '## 五、')
    facts = {}
    for k, v in re.findall(r'^\| (\S[^|]*?) \| (.*?) \|$', ops.split('### ')[0], re.M):
        if k in ('項目', '---'):
            continue
        # 括號內指向系統指示的維護註記不對外
        facts[k] = plain(re.sub(r'；[^；）]*系統指示[^）]*', '', v))
    for need in ('名稱', '地址', '電話', 'LINE', '網路預約', '看診進度查詢', 'Email', '醫師'):
        if need not in facts:
            raise KbError(f'第四節基本事實缺「{need}」')

    guides = []
    walkin = re.search(r'### 現場掛號\n(.*?)(?=^### )', ops, re.S | re.M)
    if not walkin:
        raise KbError('第四節缺「現場掛號」')
    guides.append({'id': 'G1', 'title': '現場掛號',
                   'answer': plain(re.sub(r'^- ', '', walkin.group(1).strip(), flags=re.M).replace('\n  ', '')),
                   'path': '/visit-guide.html'})
    rules = re.search(r'### 網路預約規則[^\n]*\n(.*?)(?=^> |^### )', ops, re.S | re.M)
    if not rules:
        raise KbError('第四節缺「網路預約規則」')
    for i, item in enumerate(re.findall(r'^- (.*)$', rules.group(1), re.M), 2):
        head = re.match(r'\*\*(.+?)\*\*[：:]?(.*)', item)
        # 無粗體小標的條目以第一個子句當標題（逐字，不自編）
        title = head.group(1) if head else re.split(r'[，；。]', item, 1)[0]
        guides.append({'id': f'G{i}', 'title': '網路預約規則：' + title,
                       'answer': plain(head.group(2) if head else item),
                       'path': '/visit-guide.html'})
    late = re.search(r'^> \*\*預約遲到 vs 現場號過號[^*]*\*\*[：:](.*?)(?=^### )', ops, re.S | re.M)
    if late:
        guides.append({'id': f'G{len(guides) + 1}', 'title': '預約遲到 vs 現場號過號',
                       'answer': plain(re.sub(r'\n> ?', '', late.group(1))
                                       .replace('第五節 Q&A「過號」題與\n', '').replace('第五節 Q&A「過號」題與', '')
                                       .replace('`visit-guide.html#missed-number`', f' {SITE}/visit-guide.html#missed-number ')),
                       'path': '/visit-guide.html'})

    notices = []
    table = re.search(r'### ⏰ 目前官網公告[^\n]*\n(.*?)(?=^> |^---|\Z)', ops, re.S | re.M)
    for line in (table.group(1) if table else '').splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) != 3 or cells[0] in ('公告', '---') or set(cells[0]) <= set('-'):
            continue
        until = re.search(r'\d{4}-\d{2}-\d{2}', cells[2])
        if not until:
            raise KbError(f'公告「{cells[0]}」缺下架日：{cells[2]}')
        notices.append({'id': f'N{len(notices) + 1}', 'title': cells[0], 'answer': plain(cells[1]),
                        'valid_until': until.group(0), 'schedule': '門診' in cells[0]})

    # ── 五、Q&A 本體 ──
    faqs = extract_qa(section(kb, '<!-- KB:QA:BEGIN -->', '<!-- KB:QA:END -->'), 'Q')
    stats = re.search(r'題目總數[^|]*\|\s*\**(\d+)', section(kb, '<!-- KB:STATS:BEGIN -->', '<!-- KB:STATS:END -->'))
    if stats and int(stats.group(1)) != len(faqs):
        raise KbError(f'Q&A 本體解析 {len(faqs)} 題，與規模表 {stats.group(1)} 題不符（格式變了？）')
    ids = [r['id'] for r in faqs]
    if ids != [f'Q{i:03}' for i in range(1, len(faqs) + 1)]:
        raise KbError('Q&A 編號不連續，可能漏題')

    # ── 六、補充問答（⏰ 12 月後整節刪 → 到期日 12-31） ──
    supp_text = section(kb, '## 六、', '## 七、')
    supp = extract_qa(supp_text, 'S')
    supp_until = f'{reviewed[:4]}-12-31' if re.search(r'12 ?月後整節刪', supp_text) else None
    for r in supp:
        r['path'] = '/'
        r['valid_until'] = supp_until

    for r in faqs + supp + guides + notices:
        if not r['answer']:
            raise KbError(f'{r["id"]} 答案為空')

    titles = page_titles(root, {r['path'] for r in faqs + supp + guides})
    for r in faqs + supp + guides:
        r['page'] = titles[r['path']]

    html = (root / 'index.html').read_text(encoding='utf-8')
    try:
        sched = sync_schedule.build(html)
    except sync_schedule.ScheduleError as e:
        raise KbError(f'首頁門診時間表解析失敗：{e}')

    return {
        '_comment': '由 internal/tools/build_assistant_kb.py 從 AI 客服知識庫正本與 index.html 產生，請勿手動編輯',
        'source': {'kb': kb_path.name, 'kb_sha256': hashlib.sha256(kb.encode()).hexdigest()},
        'reviewed_at': reviewed,
        'site': SITE,
        'greeting': greet_blocks[0],
        'suggestions': [s.strip() for s in greet_blocks[1].splitlines() if s.strip()],
        'urgent_reply': urgent_blocks[0],
        'soon_reply': urgent_blocks[1],
        'facts': facts,
        'schedule': {'weekly': sched['weekly'], 'exceptions': sched['exceptions']},
        'notices': notices,
        'faqs': faqs + supp + guides,
    }


def latest_kb(root: Path) -> Path:
    found = sorted((root / 'internal').glob(KB_GLOB))
    if not found:
        raise KbError(f'internal/ 下找不到 {KB_GLOB}')
    return found[-1]


def main() -> int:
    ap = argparse.ArgumentParser(description='AI 客服知識庫正本 → 線上小幫手 knowledge.json')
    ap.add_argument('--root', default='.')
    ap.add_argument('--kb', help='知識庫正本路徑（預設取 internal/ 下日期最新的一份）')
    ap.add_argument('--check', action='store_true', help='只檢查，不寫檔；不一致 exit 1')
    args = ap.parse_args()

    root = Path(args.root).resolve()
    try:
        kb_path = Path(args.kb).resolve() if args.kb else latest_kb(root)
        data = build(root, kb_path)
    except KbError as e:
        print(f'✗ {e}', file=sys.stderr)
        return 2

    rendered = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
    target = root / OUT_REL
    summary = (f"FAQ {sum(r['id'][0] == 'Q' for r in data['faqs'])}＋補充 {sum(r['id'][0] == 'S' for r in data['faqs'])}"
               f"＋預約掛號 {sum(r['id'][0] == 'G' for r in data['faqs'])}｜公告 {len(data['notices'])}"
               f"｜門診特例 {len(data['schedule']['exceptions'])} 日｜來源 {kb_path.name}")
    if args.check:
        current = target.read_text(encoding='utf-8') if target.exists() else ''
        if current != rendered:
            print(f'✗ {OUT_REL} 與知識庫正本／首頁門診時間不一致，請執行 '
                  'python3 internal/tools/build_assistant_kb.py', file=sys.stderr)
            return 1
        print(f'✓ {OUT_REL} 已同步（{summary}）')
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(rendered, encoding='utf-8')
    print(f'✓ 已寫入 {OUT_REL}（{len(rendered.encode()) // 1024} KB；{summary}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
