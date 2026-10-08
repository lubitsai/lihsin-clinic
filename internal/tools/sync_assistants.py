#!/usr/bin/env python3
"""官網線上小幫手＋LINE 線上小幫手：一鍵同步、驗證、打包（assistant-sync skill 的執行檔）。

    python3 internal/tools/sync_assistants.py                         # 重產＋驗證＋一致性比對
    python3 internal/tools/sync_assistants.py --zip <輸出資料夾>        # 另外打包 LINE 程式包
    python3 internal/tools/sync_assistants.py --ask 鼻噴有現貨嗎 水痘多少錢   # 兩邊各問一次，並排列出回答
    python3 internal/tools/sync_assistants.py --check                 # 只檢查、不寫檔（任何不同步即 exit 1）

步驟：
  1. 重產：知識庫正本 Q&A 區（build_chatbot_kb.py）→ clinic-assistant/knowledge.json（build_assistant_kb.py）
          → internal/line-helpdesk/faq.json（build_faq.py，含分流規則與 search.js 逐字核對）
  2. 測試：node internal/tools/test_assistant.mjs；LINE 單元測試（缺 Flask／Firestore 套件時只跑不需要它們的兩檔）
  3. 一致性比對（parity_queries.json＋--ask 問句）：Node 實跑官網 search.js、Python 實跑 LINE core.py，
     比四件事——緊急判斷（urgent／soon）、自費價目命中哪一條、相似題檢索前 3 名、問句解析出的日期。四者在設計上必須完全相同。
  4. validate_site.py --stage deploy（E-ASSISTANT＝官網、W-LINE＝LINE）
  5. --zip：打包 internal/line-helpdesk/ 給院長部署（檔名帶 git HEAD）

結束碼：全部通過 0；有任何失敗或不一致 1。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'internal' / 'tools'
LINE = ROOT / 'internal' / 'line-helpdesk'
KB_JSON = ROOT / 'clinic-assistant' / 'knowledge.json'
SEARCH_JS = ROOT / 'clinic-assistant' / 'search.js'
PY = sys.executable

ok_all = True


def run(*cmd, cwd=ROOT, quiet=False):
    r = subprocess.run(list(map(str, cmd)), cwd=cwd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def report(label, passed, detail=''):
    global ok_all
    ok_all &= passed
    mark = '✓' if passed else '✗'
    line = f'{mark} {label}'
    if detail:
        line += '：' + detail.splitlines()[-1][:160]
    print(line)


def latest_kb():
    found = sorted((ROOT / 'internal').glob('AI客服知識庫_立欣診所_正本_*.md'))
    return found[-1]


def regenerate(check_only):
    kb = latest_kb()
    steps = [
        ('知識庫正本 Q&A 區', [PY, TOOLS / 'build_chatbot_kb.py', '--kb', kb]),
        ('官網小幫手 knowledge.json', [PY, TOOLS / 'build_assistant_kb.py']),
        ('LINE 小幫手 faq.json', [PY, LINE / 'build_faq.py']),
    ]
    for label, cmd in steps:
        code, out = run(*cmd, '--check')
        if code == 0:
            report(label + ' 已同步', True)
            continue
        if check_only:
            report(label + ' 不同步', False, out)
            continue
        code, out = run(*cmd)
        report(label + (' 已重產' if code == 0 else ' 重產失敗'), code == 0, out)


def tests():
    code, out = run('node', TOOLS / 'test_assistant.mjs')
    report('官網小幫手測試', code == 0, out)
    full = run(PY, '-c', 'import flask, google.cloud.firestore', cwd=LINE)[0] == 0
    args = ['-m', 'unittest'] if full else ['-m', 'unittest', 'test_faq_catalog', 'test_prices']
    code, out = run(PY, *args, cwd=LINE)
    tail = [l for l in out.splitlines() if l.startswith(('Ran ', 'OK', 'FAILED'))]
    note = ' '.join(tail) + ('' if full else '（缺套件，只跑題庫與價目測試；完整測試先 pip install -r internal/line-helpdesk/requirements.lock.txt）')
    report('LINE 小幫手測試', code == 0, note)


NODE_SCRIPT = r'''
import fs from 'fs';
import { createAssistant, normalize, parseDate } from '%(search)s';
const kb = JSON.parse(fs.readFileSync('%(kb)s', 'utf8'));
const js = fs.readFileSync('%(search)s', 'utf8');
const rx = (n) => new RegExp(js.match(new RegExp('^const ' + n + ' = /(.*)/;$', 'm'))[1]);
const URGENT = rx('URGENT'), SOON = rx('SOON'), PRICE_ASK = rx('PRICE_ASK'), FREE_ASK = rx('FREE_ASK');
const rules = (kb.prices?.rules || []).map((r) => ({ ...r, res: r.all.map((x) => new RegExp(x)), no: r.not ? new RegExp(r.not) : null }));
const price = (q) => {   // mirrors search.js priceRule()
  if (/公費/.test(q) || !PRICE_ASK.test(q.replace(/[公自]費/g, ''))) return null;
  const r = rules.find((x) => x.res.every((re) => re.test(q)) && !(x.no && x.no.test(q)));
  if (!r || (FREE_ASK.test(q) && (r.kind === 'vaccine' || r.kind === 'ask'))) return null;
  return r.id;
};
const A = createAssistant(kb);
const qs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const today = process.argv[3];
console.log(JSON.stringify(qs.map((q) => { const n = normalize(q);
  return { triage: URGENT.test(n) ? 'urgent' : SOON.test(n) ? 'soon' : null, price: price(n), date: parseDate(q, today),
           search: A.search(q, today, 3).map((h) => h.row.id), answer: A.ask(q, today) }; })));
'''


def site_answers(queries, today):
    with tempfile.TemporaryDirectory() as tmp:
        script, qfile = Path(tmp) / 'parity.mjs', Path(tmp) / 'q.json'
        script.write_text(NODE_SCRIPT % {'search': SEARCH_JS.as_posix(), 'kb': KB_JSON.as_posix()}, encoding='utf-8')
        qfile.write_text(json.dumps(queries, ensure_ascii=False), encoding='utf-8')
        code, out = run('node', script, qfile, today)
        if code != 0:
            raise RuntimeError(out)
        return json.loads(out.splitlines()[-1])


def line_side():
    sys.path.insert(0, str(LINE))
    import core  # noqa: E402
    data = json.loads((LINE / 'faq.json').read_text(encoding='utf-8'))
    legacy = json.loads((LINE / 'legacy_messages.json').read_text(encoding='utf-8'))
    kb = json.loads(KB_JSON.read_text(encoding='utf-8'))
    searcher = core.Searcher([dict(id=r['id'], title=r['title'], page=r['page'], kb_answer=r['answer'], core=r.get('core'),
                                   valid_until=r.get('valid_until')) for r in kb['faqs']])
    web_prices = core.PriceMatcher(kb.get('prices'))   # website rules (LINE adds only wording on top)
    return core, core.Catalog(data), legacy, searcher, web_prices


def parity(extra, today_s):
    queries = json.loads((LINE / 'parity_queries.json').read_text(encoding='utf-8'))['queries']
    queries = list(dict.fromkeys(queries + extra))
    site = site_answers(queries, today_s)
    core, cat, legacy, searcher, web_prices = line_side()
    today = datetime.strptime(today_s, '%Y-%m-%d').date()
    diffs = []
    for q, s in zip(queries, site):
        r = web_prices.match(q)
        mine = {'triage': core.triage(q), 'price': r['id'] if r else None,
                'search': [h['id'] for h in searcher.search(q, today, 3)],
                'date': (lambda d: d.isoformat() if d else None)(core.parse_date(q, today))}
        for k in mine:
            if mine[k] != s[k]:
                diffs.append(f'  「{q}」{k}：官網 {s[k]}｜LINE {mine[k]}')
    report(f'一致性比對（{len(queries)} 句 × 緊急判斷／價目／檢索／日期）', not diffs, f'{len(diffs)} 處不一致' if diffs else '全部一致')
    for d in diffs[:30]:
        print(d)
    return site, queries, core, cat, legacy, today


def ask(questions, site, queries, core, cat, legacy, today):
    print('\n── 兩邊回答並排 ──')
    for q in questions:
        s = site[queries.index(q)]['answer']
        faq = next((b for b in s['blocks'] if b['type'] == 'faq'), None)
        notice = next((b for b in s['blocks'] if b['type'] == 'notice'), None)
        web = s['text'] or (notice['title'] if notice else '') or (faq['items'][0]['title'] if faq else s['kind'])
        action, payload = core.decide(q, False, cat, legacy, {'流感疫苗資訊'}, today)
        if isinstance(payload, dict):
            line = payload.get('text', '［卡片］')
        elif isinstance(payload, list):
            line = '相似題：' + ' / '.join(h['title'] for h in payload)
        else:
            line = {'handoff': '（轉專人）', 'unknown': '（答不出來 → 轉專人）'}.get(action, action)
        print(f'● {q}\n  官網［{s["kind"]}］{web[:90]}\n  LINE［{action}］{line[:90]}'.replace('\n\n', ' '))


def package(out_dir):
    head = run('git', 'rev-parse', '--short', 'HEAD')[1]
    readme = (LINE / 'README_設定步驟.md').read_text(encoding='utf-8').splitlines()[0]
    ver = readme.split('（')[-1].rstrip('）').replace('第二版 ', '') if '（' in readme else 'latest'
    out = Path(out_dir) / f'立欣診所_LINE客服_{ver}_main-{head}.zip'
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(LINE.rglob('*')):
            if f.is_file() and '__pycache__' not in f.parts:
                z.write(f, Path('line-helpdesk') / f.relative_to(LINE))
    report('LINE 程式包', True, str(out))


def main():
    ap = argparse.ArgumentParser(description='官網＋LINE 小幫手一鍵同步')
    ap.add_argument('--check', action='store_true', help='只檢查、不寫檔')
    ap.add_argument('--zip', metavar='DIR', help='打包 LINE 程式包到此資料夾')
    ap.add_argument('--ask', nargs='+', default=[], metavar='問句', help='兩邊各問一次並排列出')
    ap.add_argument('--today', default=datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d'))
    a = ap.parse_args()
    print(f'── 官網＋LINE 小幫手同步（{a.today}）──')
    regenerate(a.check)
    tests()
    site, queries, core, cat, legacy, today = parity(a.ask, a.today)
    code, out = run(PY, TOOLS / 'validate_site.py', '--root', '.', '--stage', 'deploy')
    warn_line = [l.strip() for l in out.splitlines() if 'W-LINE' in l or 'E-ASSISTANT' in l]
    report('validate_site', code == 0 and not warn_line, '; '.join(warn_line) or out)
    if a.ask:
        ask(a.ask, site, queries, core, cat, legacy, today)
    if a.zip and ok_all:
        package(a.zip)
    elif a.zip:
        print('✗ 有項目未通過，未打包 LINE 程式包')
    for p in (LINE / '__pycache__', TOOLS / '__pycache__'):
        subprocess.run(['rm', '-rf', str(p)])
    print('\n結論：' + ('✅ 兩邊小幫手同步且一致' if ok_all else '⚠️ 有項目需要處理（見上方 ✗）'))
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
