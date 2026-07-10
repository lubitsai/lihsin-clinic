#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
立欣診所 PWA 全站掛載腳本（外科式字串插入，絕不重排既有 HTML）
================================================================
對指定目錄下所有 .html 進行三項最小插入：
  1. <link rel="manifest" href="/manifest.webmanifest">
     （插在 apple-touch-icon 行之後；找不到則插在 </head> 前）
  2. <script src="/pwa-register.js" defer></script>（插在 </head> 前）
  3. <meta name="theme-color" content="#7C9A6E">（僅在該頁缺少時補）

安全機制：
  - 冪等：頁面已含 manifest.webmanifest 即整頁跳過（可重複執行）
  - 排除清單：offline.html、404.html（離線/錯誤頁不需註冊）
  - 只用 str.find / 精準插入，不經 BeautifulSoup 重新序列化
  - 每檔回報插入結果與位移位元組數，異常（找不到 </head>）即跳過並警告

用法：
  python3 patch_pwa.py <目標目錄>          # 例：python3 patch_pwa.py ./site
  python3 patch_pwa.py <目標目錄> --dry    # 只預覽，不寫檔
"""
import os
import sys

MANIFEST_TAG = '<link rel="manifest" href="/manifest.webmanifest">'
REGISTER_TAG = '<script src="/pwa-register.js" defer></script>'
THEME_TAG = '<meta name="theme-color" content="#7C9A6E">'
EXCLUDE = {'offline.html', '404.html'}


def patch_file(path, dry=False):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    original_len = len(content)
    actions = []

    if 'manifest.webmanifest' in content:
        return '↷ 已掛載，跳過', 0

    head_end = content.find('</head>')
    if head_end == -1:
        return '⚠ 找不到 </head>，跳過（請人工確認）', 0

    # 1) manifest：優先插在 apple-touch-icon 行後
    anchor = content.find('apple-touch-icon')
    if anchor != -1:
        line_end = content.find('\n', anchor)
        if line_end != -1 and line_end < head_end:
            content = content[:line_end + 1] + ' ' + MANIFEST_TAG + '\n' + content[line_end + 1:]
            actions.append('manifest@icon後')
        else:
            anchor = -1
    if anchor == -1:
        head_end = content.find('</head>')
        content = content[:head_end] + ' ' + MANIFEST_TAG + '\n' + content[head_end:]
        actions.append('manifest@head尾')

    # 2) theme-color（缺才補）
    if 'name="theme-color"' not in content:
        head_end = content.find('</head>')
        content = content[:head_end] + ' ' + THEME_TAG + '\n' + content[head_end:]
        actions.append('theme-color補上')

    # 3) 註冊腳本
    head_end = content.find('</head>')
    content = content[:head_end] + ' ' + REGISTER_TAG + '\n' + content[head_end:]
    actions.append('register腳本')

    delta = len(content) - original_len
    if not dry:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
    return '✓ ' + '、'.join(actions), delta


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = sys.argv[1]
    dry = '--dry' in sys.argv
    if dry:
        print('【DRY RUN：僅預覽，不寫入】')

    total, patched = 0, 0
    for dirpath, _dirnames, filenames in os.walk(root):
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
    print('提醒：掛載後請跑既有驗證（JSON-LD／標籤平衡／禁語掃描）再部署。')


if __name__ == '__main__':
    main()
