#!/usr/bin/env python3
"""AI 客服知識庫（Chatbase）Q&A 本體重產工具。

知識庫的 Q&A 本體是官網 FAQ 結構化資料的鏡像：解析全站 `application/ld+json`
內所有 `@type: Question` 節點 → 去重 → 依頁面分類 → 寫回知識庫檔的兩個標記區：

    <!-- KB:STATS:BEGIN --> … <!-- KB:STATS:END -->   規模表
    <!-- KB:QA:BEGIN -->    … <!-- KB:QA:END -->      Q&A 本體

標記區以外（系統指示、開場白、急症腳本、診所基本事實、合規自檢、維護規則）是手寫內容，
本工具不動。

用法：
    python3 internal/tools/build_chatbot_kb.py --kb internal/AI客服知識庫_立欣診所_正本_20260924.md
    python3 internal/tools/build_chatbot_kb.py --kb <檔> --check   # 與官網不一致即 exit 1

規則（與 2026-09-05 正本相同，改規則要同步改知識庫檔第五節「讀法」）：
- 去重：同一問題出現在多頁時保留答案最長（最完整）的一則，歸在該頁。
- ★ 核心客服題：診所與就診、醫師與資格兩類全部，加上六個核心服務頁。
- ⏰ 時效題：問題本身帶年度或季別字樣（115 年／2026／今年／本年度／左流右新／現在還）。
- 唯一刻意偏離官網逐字：Google 評分數字改為「可於 Google 地圖查看」（`00` §4-3 不外溢）。
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SKIP_PREFIXES = ('/booking-system', '/internal', '/archive', '/docs', '/node_modules', '/.claude', '/.codex')

CORE_SERVICES = {
    '/services/child-designated-physician.html',
    '/services/family-medicine.html',
    '/services/newborn-care.html',
    '/services/pediatric-allergy-asthma.html',
    '/services/vaccination.html',
    '/services/weekend-pediatrics.html',
}

TIME_RE = re.compile(r'115 ?年|2026|今年|本年度|左流右新|現在還')

# (官網原句, 知識庫改寫)；官網改了用字而這裡沒跟上，殘留檢查會擋下來
RATING_SUBS = [
    ('立欣診所目前 Google 評價為 5.0 星，可在 Google 地圖搜尋', '立欣診所的評論可在 Google 地圖搜尋'),
    ('Google 評價 5.0 星，', 'Google 商家評論可於 Google 地圖查看，'),
]
RATING_LEFTOVER_RE = re.compile(r'評[價分][^。，]{0,6}\d(?:\.\d)? ?星')


def category(page):
    if page.startswith('/team/'):
        return 1
    if page.startswith('/services/'):
        return 2
    if page.startswith('/health/'):
        return 3
    if page.startswith('/news/'):
        return 4
    if page.count('/') == 1:
        return 0
    return 5


CATEGORY_NAMES = ['診所與就診', '醫師與資格', '服務項目', '衛教與疾病', '時事與年度（時效，換版時要一起改）', '其他']


def walk(node, acc):
    if isinstance(node, dict):
        t = node.get('@type')
        if t == 'Question' or (isinstance(t, list) and 'Question' in t):
            ans = node.get('acceptedAnswer') or {}
            if isinstance(ans, list):
                ans = ans[0] if ans else {}
            acc.append(((node.get('name') or '').strip(), (ans.get('text') or '').strip()))
        for v in node.values():
            walk(v, acc)
    elif isinstance(node, list):
        for v in node:
            walk(v, acc)


def extract():
    items = []
    for path in sorted(glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)):
        page = '/' + os.path.relpath(path, ROOT).replace(os.sep, '/')
        if page.startswith(SKIP_PREFIXES):
            continue
        src = open(path, encoding='utf-8').read()
        acc = []
        for m in re.finditer(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', src, re.S):
            try:
                walk(json.loads(m.group(1)), acc)
            except json.JSONDecodeError as e:
                sys.exit(f'ERROR: {page} JSON-LD 解析失敗：{e}')
        items += [(page, q, a) for q, a in acc if q and a]
    return items


def dedupe(items):
    best = {}
    for page, q, a in items:
        if q not in best or len(a) > len(best[q][1]):
            best[q] = (page, a)
    return best, len(items) - len(best)


def soften_rating(a):
    for old, new in RATING_SUBS:
        a = a.replace(old, new)
    return a


def build(best, n_nodes, n_dup):
    by_page = {}
    for q, (page, a) in best.items():
        by_page.setdefault(page, []).append((q, a))
    pages = sorted(by_page, key=lambda p: (category(p), p))
    # 同一頁內維持官網原本的出現順序
    order = {}
    for i, (page, q, _) in enumerate(extract_cache):
        order.setdefault((page, q), i)

    qa_lines, n, star, clock = [], 0, 0, 0
    leftovers = []
    cat_counts = {}
    for p in pages:
        cat_counts[category(p)] = cat_counts.get(category(p), 0) + len(by_page[p])
    current_cat = None
    for p in pages:
        c = category(p)
        if c != current_cat:
            current_cat = c
            qa_lines += ['', f'## {CATEGORY_NAMES[c]}（{cat_counts[c]} 題）', '']
        qa_lines += ['', f'### 來源頁：`{p}`', '']
        for q, a in sorted(by_page[p], key=lambda x: order.get((p, x[0]), 0)):
            n += 1
            is_star = c in (0, 1) or p in CORE_SERVICES
            is_clock = bool(TIME_RE.search(q))
            star += is_star
            clock += is_clock
            tag = (' ⏰' if is_clock else '') + ('｜★ ' if is_star else '｜')
            a = soften_rating(a)
            if RATING_LEFTOVER_RE.search(a):
                leftovers.append(q)
            qa_lines += [f'**Q{n:03d}{tag}{q}**', '', a, '']
    if leftovers:
        sys.exit('ERROR: 以下題目仍含評分數字，請更新 RATING_SUBS：\n  ' + '\n  '.join(leftovers))

    stats = [
        '| 項目 | 數量 |',
        '|---|---|',
        f'| 題目總數（去重後） | **{n} 題** |',
        f'| ★ 核心客服題（診所與就診／醫師／六個核心服務頁） | **{star} 題** |',
        f'| ⏰ 問題帶年度或季別字樣、換版時要一起改 | **{clock} 題** |',
        f'| 涵蓋頁面 | {len(pages)} 頁 |',
        f'| 抽取的 FAQ 節點（去重前） | {n_nodes}（跨頁撞題 {n_dup}，保留答案較完整的一則） |',
    ]
    return '\n'.join(stats), '\n'.join(qa_lines).strip('\n')


def replace_region(text, name, body):
    pat = re.compile(rf'(<!-- KB:{name}:BEGIN -->\n).*?(<!-- KB:{name}:END -->)', re.S)
    if not pat.search(text):
        sys.exit(f'ERROR: 知識庫檔缺少 KB:{name} 標記區')
    return pat.sub(lambda m: m.group(1) + body + '\n' + m.group(2), text)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kb', required=True, help='知識庫 Markdown 檔路徑')
    ap.add_argument('--check', action='store_true', help='只比對，不寫檔；不一致 exit 1')
    args = ap.parse_args()

    global extract_cache
    extract_cache = extract()
    best, n_dup = dedupe(extract_cache)
    stats, qa = build(best, len(extract_cache), n_dup)

    text = open(args.kb, encoding='utf-8').read()
    new = replace_region(replace_region(text, 'STATS', stats), 'QA', qa)
    print(stats)
    if args.check:
        if new != text:
            print('✗ 知識庫與官網 FAQ 不一致，請重跑（不加 --check）重產')
            sys.exit(1)
        print('✓ 知識庫與官網 FAQ 一致')
        return
    if new != text:
        open(args.kb, 'w', encoding='utf-8').write(new)
        print(f'✓ 已寫回 {args.kb}')
    else:
        print('✓ 無變更')


extract_cache = []

if __name__ == '__main__':
    main()
