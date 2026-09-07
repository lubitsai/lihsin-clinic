#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_sw_bump.py — 防呆 18 的自動閘門（2026-09-07 院長裁示新增）

規則（01 防呆 18）：改動任何「同網域共用靜態資源」時，必須在**同一批**把
`sw.js` 的 VERSION 尾碼 +1。

為什麼需要機器把關：sw.js 對同網域靜態資源走 stale-while-revalidate
（`return cached || network` ＝快取優先）。不 bump 的話，回訪者第一次載入
拿到的仍是舊版資產，要再載入一次頁面才生效。這種失效是「三重靜默」——
頁面照開、版面不破、validate_site.py 全綠，只有數據會少。
validate_site.py 是**單檔內容檢查**，看不到「這批改了什麼」，結構上擋不住，
所以只能在 CI 用 git diff 層級把關。

用法：
    python3 internal/tools/check_sw_bump.py --base <ref> --head <ref>

退出碼：0 通過（含不適用）／1 違規／2 執行錯誤（無法取得 diff 等）

逃生門：把 `[no-sw-bump]` 寫進該範圍任一 commit 訊息（或由 CI 傳入
--allow-marker 的 PR 標題／內文）即跳過，並**必須在交付說明寫明理由**。
用於「改動不影響交付內容」的情形（純註解、純格式）。
"""

import argparse
import re
import subprocess
import sys

# ── 受管清單 ──────────────────────────────────────────────────────────
# ① 01 防呆 18 明列的共用根資產（多頁引用、走 SWR）
# ② sw.js PRECACHE 的成員：它們只在 SW 安裝時寫入快取，**不 bump 就永遠不會更新**
#    （/offline.html 更極端——它只會從快取被讀出來，網路路徑根本不經過它）
SHARED_ASSETS = [
    'cta-track.js',           # ① GA4 轉換事件，75 頁引用
    'clarity.js',             # ①
    'pwa-register.js',        # ①
    'tailwind.css',           # ①＋②
    'offline.html',           # ②
    'manifest.webmanifest',   # ②
    'images/logo.png',        # ②
]

SW_PATH = 'sw.js'
VERSION_RE = re.compile(r"""const\s+VERSION\s*=\s*['"]([^'"]+)['"]""")
SKIP_MARKER = '[no-sw-bump]'


def git(*args):
    r = subprocess.run(['git'] + list(args), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('git %s 失敗：%s' % (' '.join(args), r.stderr.strip()))
    return r.stdout


def version_at(ref):
    """讀取某個 ref 的 sw.js VERSION；檔案不存在或讀不到回 None。"""
    try:
        blob = git('show', '%s:%s' % (ref, SW_PATH))
    except RuntimeError:
        return None
    m = VERSION_RE.search(blob)
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True, help='比較基準 ref（PR 的 base、push 的 before）')
    ap.add_argument('--head', required=True, help='被檢查的 ref')
    ap.add_argument('--allow-marker', default='',
                    help='額外納入逃生門比對的文字（例如 PR 標題＋內文）')
    a = ap.parse_args()

    try:
        changed = [p for p in git('diff', '--name-only', '%s...%s' % (a.base, a.head)).split('\n') if p]
    except RuntimeError as e:
        print('::error::無法取得 diff：%s' % e)
        print('提示：checkout 需 fetch-depth: 0，且 base ref 要抓得到。')
        return 2

    touched = [p for p in SHARED_ASSETS if p in changed]
    print('=== 防呆 18 閘門（01：改共用根資產要同批 bump sw.js VERSION）===')
    print('比較範圍：%s...%s（異動 %d 檔）' % (a.base, a.head, len(changed)))

    if not touched:
        print('✅ 本批未動任何共用根資產 → 不適用，通過。')
        return 0

    print('本批動到的共用根資產：')
    for p in touched:
        print('  - %s' % p)

    # 逃生門
    try:
        msgs = git('log', '--format=%B', '%s..%s' % (a.base, a.head))
    except RuntimeError:
        msgs = ''
    if SKIP_MARKER in msgs or SKIP_MARKER in a.allow_marker:
        print('⏭️  偵測到 %s → 略過檢查。' % SKIP_MARKER)
        print('   ⚠️ 交付說明必須寫明為什麼這批不需要 bump。')
        return 0

    old, new = version_at(a.base), version_at(a.head)
    print('sw.js VERSION：%s → %s' % (old or '(讀不到)', new or '(讀不到)'))

    if new is None:
        print('::error::讀不到 head 的 sw.js VERSION——常數格式被改了？')
        print('若 sw.js 的 VERSION 寫法有變更，請同批修 internal/tools/check_sw_bump.py 的 VERSION_RE。')
        return 1

    if old == new:
        print('::error::動了共用根資產卻沒有 bump sw.js 的 VERSION（仍是 %s）。' % new)
        print('')
        print('為什麼會擋：sw.js 對同網域靜態資源走 stale-while-revalidate')
        print('（`return cached || network` ＝快取優先）。不 bump 的話，回訪者第一次')
        print('載入拿到的仍是舊版，要再載入一次頁面才生效——掛新的 GA4 事件時，')
        print('那一拍正好落在最需要資料的觀察窗裡。')
        print('')
        print('怎麼修：把 sw.js 的 VERSION 尾碼 +1（如 lhpc-pwa-v2 → v3），')
        print('        與資產改動放同一批，然後重推。')
        print('')
        print('確定不需要 bump（純註解／純格式，交付內容沒變）：')
        print('        在 commit 訊息寫 %s，並在交付說明講明理由。' % SKIP_MARKER)
        print('')
        print('規則全文：internal/01_新對話接續提示詞.md 防呆 18')
        return 1

    print('✅ VERSION 已同批 bump → 通過。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
