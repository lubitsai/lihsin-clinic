#!/usr/bin/env python3
"""產生 /health/ 衛教總覽頁搜尋用的關鍵字索引 health/search-index.json。

為什麼要這個檔：家長打進搜尋框的多半是口語（拉肚子、打疫苗、長不高），
卡片上的標題與摘要用的是衛教用語，只比對卡片文字會漏掉大半。每篇文章的
<meta name="keywords"> 已經收了家長常用說法，這裡把它整理成「檔名 → 關鍵字」
索引，總覽頁第一次輸入時才載入（見 health/index.html 搜尋腳本）。

只收 health/index.html 上有卡片的文章；同一篇內被較長詞完整包含的短詞會去掉，
以縮小檔案。輸出排序固定，重跑結果逐位元組相同。

用法：
  python3 internal/tools/build_health_search.py          # 重產
  python3 internal/tools/build_health_search.py --check  # 只檢查是否過期（過期 exit 1）

新增衛教文章或改動任一篇 keywords 後要重跑；validate_site.py 會以 W-HEALTHSEARCH 提示過期索引。
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

CARD_RE = re.compile(r'<a href="/health/([a-z0-9-]+)\.html" class="flex flex-col bg-white')
KW_RE = re.compile(r'<meta\s+name="keywords"\s+content="([^"]*)"')


def build(root: Path) -> str:
    health = root / "health"
    slugs = sorted(set(CARD_RE.findall((health / "index.html").read_text(encoding="utf-8"))))
    index = {}
    for slug in slugs:
        page = health / f"{slug}.html"
        if not page.exists():
            continue
        m = KW_RE.search(page.read_text(encoding="utf-8"))
        if not m:
            continue
        terms = {t.strip() for t in html.unescape(m.group(1)).split(",") if t.strip()}
        keep = []
        for t in sorted(terms, key=lambda s: (-len(s), s)):
            low = t.lower()
            if not any(low in k.lower() for k in keep):
                keep.append(t)
        index[slug] = " ".join(sorted(keep))
    return json.dumps(index, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    root = Path(args.root)
    out = root / "health" / "search-index.json"
    rendered = build(root)
    if args.check:
        if not out.exists() or out.read_text(encoding="utf-8") != rendered:
            print("health/search-index.json 過期，請跑 python3 internal/tools/build_health_search.py")
            return 1
        print("health/search-index.json 已是最新")
        return 0
    out.write_text(rendered, encoding="utf-8")
    print(f"已寫入 {out}（{len(json.loads(rendered))} 篇，{len(rendered.encode())} bytes）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
