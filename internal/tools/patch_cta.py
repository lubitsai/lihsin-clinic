#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
立欣診所 GA4 轉換事件腳本全站掛載（外科式字串插入，比照 patch_pwa.py）
=======================================================================
對指定目錄下所有 .html 插入一行：
  <script src="/cta-track.js" defer></script>（插在 </head> 前）

安全機制：
  - 冪等：頁面已含 cta-track.js 即整頁跳過（可重複執行）
  - 排除清單：offline.html、404.html（比照 patch_pwa 慣例）
  - 只用 str.find 精準插入，不重新序列化 HTML
  - growth.html 一併掛載（院長 2026-07-10 核可：零外部相依的唯一例外＝GA）

用法：
  python3 internal/tools/patch_cta.py <目標目錄> [--dry]
"""
import os
import sys

CTA_TAG = '<script src="/cta-track.js" defer></script>'
EXCLUDE = {'offline.html', '404.html'}


def patch_file(path, dry=False):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'cta-track.js' in content:
        return '↷ 已掛載，跳過', 0
    head_end = content.find('</head>')
    if head_end == -1:
        return '⚠ 找不到 </head>，跳過（請人工確認）', 0
    new = content[:head_end] + ' ' + CTA_TAG + '\n' + content[head_end:]
    delta = len(new) - len(content)
    if not dry:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new)
    return '✓ cta-track 掛載', delta


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = sys.argv[1]
    dry = '--dry' in sys.argv
    if dry:
        print('【DRY RUN：僅預覽，不寫入】')
    total, patched = 0, 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ('internal', 'node_modules', '.git')]
        for name in sorted(filenames):
            if not name.endswith('.html'):
                continue
            if name in EXCLUDE:
                print(f'  {name:<42} ↷ 排除清單')
                continue
            total += 1
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root)
            result, delta = patch_file(path, dry=dry)
            if result.startswith('✓'):
                patched += 1
            print(f'  {rel:<42} {result}（+{delta} bytes）')
    print(f'\n共掃描 {total} 個 HTML，本次掛載 {patched} 個。')
    print('提醒：掛載後跑 validate_site.py --stage deploy 再 push。')


if __name__ == '__main__':
    main()
