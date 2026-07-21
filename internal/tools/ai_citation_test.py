#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ai_citation_test.py — 立欣診所 AI 引用測試 codify／log 骨架產生器 v1.0（2026-07-21）
=========================================================
把《03_量測與回饋制度.md》第四節「AI 引用測試固定 12 題」程式化，
作為可重複、版本控管的追蹤機制骨架。

定位（誠實邊界）
----------------
- 本工具**不**自行呼叫 AI 引擎。「AI 答案是否引用本院、事實是否正確」的判讀，
  由執行的 session（LLM in the loop，經 WebSearch／firecrawl 取得 AI 綜整答案）完成。
  本工具負責：固定題組與對照事實的單一來源、產生月報 E 段骨架、避免每月漏題或改題。
- 自動化僅涵蓋 03 月報的 **E 段（AI 引用測試）**；A–D 段（GSC/GA4/GBP/PSI）需院長登入後台
  匯出，無法自動化。
- 測試環境限制：本專案 egress 政策擋 api.firecrawl.dev（403），實務改用內建 WebSearch，
  且為 US locale ≠ 台灣在地 Google AI Overview／AI Mode。未被引用的題目可能部分為
  locale 造成，屬方向性訊號、非定論——判讀時須標註。

使用方式
--------
  python3 internal/tools/ai_citation_test.py --list
      印出固定 12 題與對照事實（供 session 逐題查詢用）。

  python3 internal/tools/ai_citation_test.py --emit-skeleton YYYYMM
      在 internal/logs/量測紀錄_YYYYMM.md 產生月報骨架（含 A–F 段與 E 段 12 題空表）。
      已存在則不覆蓋（避免蓋掉已填數據），改印提示。

修改題組＝修改 03 §4 → 需院長核可（比照 validate_site.py 白名單協議）。
"""

import argparse
import os
import sys

# ── 對照事實（單一來源＝01 §關鍵常數；改動須與 00/01 同步）──────────────
GROUND_TRUTH = {
    "地址": "台南市北區育德路467號（704）",
    "電話": "06-2516086",
    "email": "lhpedclinic@gmail.com",
    "平日門診": "08:00–12:00／14:30–18:00／18:30–21:30",
    "週六門診": "08:00–11:30／14:30–18:00（無夜診）",
    "週日門診": "08:00–11:30／18:30–21:00（無午診）",
    "醫師": "蔡宗儒院長、李佳玲醫師",
    "醫師資格措辭": "次專科／研究醫師『訓練』——不得膨脹成『專科醫師』",
    "急診定性": "門診、非急診",
    "評分": "Google 5.0★（不自評、不寫死於 schema）",
}

# ── 固定 12 題（＝03 §4；critical=True 為答錯即 72 小時修正的三題）──────
QUESTIONS = [
    {"n": 1,  "q": "立欣診所",
     "check": "基本資訊正確（地址/電話/健保特約）", "intent_page": "index.html", "critical": False},
    {"n": 2,  "q": "立欣診所 門診時間",
     "check": "週日 08–11:30／18:30–21、週六無夜診、平日至 21:30 是否答對", "intent_page": "index.html / visit-guide.html", "critical": True},
    {"n": 3,  "q": "立欣診所有哪些醫師",
     "check": "蔡宗儒/李佳玲＋『次專科訓練』措辭未被膨脹成專科醫師；同名醫師消歧", "intent_page": "team/dr-tsai.html, team/dr-lee.html", "critical": True},
    {"n": 4,  "q": "台南小兒科推薦",
     "check": "是否被提及；引用來源為何", "intent_page": "index.html", "critical": False},
    {"n": 5,  "q": "台南假日看小兒科",
     "check": "是否提及；週末時段正確", "intent_page": "services/weekend-pediatrics.html", "critical": False},
    {"n": 6,  "q": "台南夜診小兒科",
     "check": "是否提及；平日至 21:30 正確", "intent_page": "services/weekend-pediatrics.html", "critical": False},
    {"n": 7,  "q": "台南兒童過敏氣喘檢查（肺功能）",
     "check": "是否提及院內肺功能檢測", "intent_page": "services/allergy-asthma.html", "critical": False},
    {"n": 8,  "q": "台南新生兒黃疸追蹤",
     "check": "是否提及李醫師/新生兒門診", "intent_page": "team/dr-lee.html / health 新生兒系列", "critical": False},
    {"n": 9,  "q": "台南兒童減重門診",
     "check": "提及時是否帶『不節食不羞辱』框架而非藥品招攬", "intent_page": "services/weight-management.html", "critical": False},
    {"n": 10, "q": "台南過敏原檢測",
     "check": "提及時是否帶『不單以數值忌口』精神", "intent_page": "services/allergy-testing.html", "critical": False},
    {"n": 11, "q": "徐世達的學生在台南哪裡看診",
     "check": "若提及本院，措辭是否為客觀師承、無背書暗示", "intent_page": "team/dr-tsai.html", "critical": False},
    {"n": 12, "q": "立欣診所是急診嗎",
     "check": "必須答『非急診』；答錯＝最高優先修正", "intent_page": "index.html / visit-guide.html", "critical": True},
]

SKELETON_TEMPLATE = """# 量測紀錄 {ym_dash}（基準線？否）

> 依制度 `03_量測與回饋制度.md` 產出。骨架由 `internal/tools/ai_citation_test.py` 生成。
> A–D 段需院長從 GSC／GA4／GBP／PSI 後台匯出後補入；E 段由 session 逐題查詢後填寫。

## A. GSC（總曝光/點擊/CTR/平均排名；品牌 vs 非品牌；前 5 成長/衰退查詢與頁面）
- ⏳ 待院長匯出。與前期（前 28 天）比較。

## B. GA4（Organic 工作階段；pwa_installed 累計；CTA 事件 call/line/queue/growth）
- ⏳ 待院長匯出。

## C. GBP（評論總數＋本月新增；來電；路線；網站點擊）
- ⏳ 待院長匯出。

## D. CWV（三頁 field LCP/INP/CLS：首頁／weekend-pediatrics／mycoplasma-pneumonia）
- ⏳ 待院長匯出（pagespeed.web.dev 行動版）。

## E. AI 引用測試：12 題結果表
- 測試日期：____；平台：____（換平台輪測 ChatGPT 搜尋／Perplexity／Gemini／Claude）
- ⚠️ 方法限制：若用 US locale WebSearch，非台灣在地 Google AI Overview／AI Mode，未被引用可能部分為 locale 造成。
- 對照事實：見 `ai_citation_test.py` GROUND_TRUTH（＝01 §關鍵常數）。

| # | 測試問題 | 提及本院? | 事實正確? | 引用來源 | 備註 |
|---|---|---|---|---|---|
{rows}

**計分：被引用 __／12；事實錯誤 __／12。關鍵三題（#2/#3/#12）是否全對：__。**

## F. 判讀與行動（對照 03 §5 門檻）
- 72 小時修正門檻（#2/#3/#12 任一答錯）：____
- 事實錯誤修正門檻：____
- 能見度缺口 → 證據型提案（可見內容需院長逐字核可）：____
- 本月部署批次對照：____
- 一切正常 → 不製造瞎忙（03 §5 末列）。
"""


def cmd_list():
    print("=== 立欣診所 AI 引用測試固定 12 題（03 §4）===\n")
    for item in QUESTIONS:
        star = " ★關鍵（答錯 72hr 修正）" if item["critical"] else ""
        print(f"#{item['n']:>2} 「{item['q']}」{star}")
        print(f"      檢核點：{item['check']}")
        print(f"      對應意圖頁：{item['intent_page']}\n")
    print("=== 對照事實（GROUND_TRUTH）===")
    for k, v in GROUND_TRUTH.items():
        print(f"  - {k}：{v}")


def cmd_emit_skeleton(ym, root):
    if not (len(ym) == 6 and ym.isdigit()):
        print(f"[錯誤] YYYYMM 格式不符：{ym}", file=sys.stderr)
        return 2
    path = os.path.join(root, "internal", "logs", f"量測紀錄_{ym}.md")
    if os.path.exists(path):
        print(f"[跳過] 已存在，未覆蓋：{path}")
        return 0
    rows = "\n".join(
        f"| {q['n']} | {q['q']} |  |  |  |  |" for q in QUESTIONS
    )
    content = SKELETON_TEMPLATE.format(ym_dash=f"{ym[:4]}-{ym[4:]}", rows=rows)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[完成] 已產生骨架：{path}")
    print("      下一步：session 逐題查詢填 E 段、院長補 A–D 段。")
    return 0


def main():
    ap = argparse.ArgumentParser(description="立欣診所 AI 引用測試 codify／log 骨架")
    ap.add_argument("--list", action="store_true", help="印出固定 12 題與對照事實")
    ap.add_argument("--emit-skeleton", metavar="YYYYMM", help="產生指定月份的月報骨架")
    ap.add_argument("--root", default=".", help="站點根目錄（預設當前目錄）")
    args = ap.parse_args()

    if args.list:
        cmd_list()
        return 0
    if args.emit_skeleton:
        return cmd_emit_skeleton(args.emit_skeleton, args.root)
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
