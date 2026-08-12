# -*- coding: utf-8 -*-
"""立欣診所完整介紹 PDF 產生腳本（2026年8月更新版）

用法：
    python3 internal/tools/build_pdf.py [輸出路徑]
    # 不給參數＝直接輸出到 repo 的 docs/lihsin-clinic-intro-2026.pdf

字型：需要 NotoTC-Reg.ttf / NotoTC-Bold.ttf（Noto Sans TC 400／700 靜態實例）。
      搜尋順序＝環境變數 LIHSIN_PDF_FONT_DIR → 本腳本同目錄 → 目前工作目錄。
      建置環境若無此兩檔，可由 npm 套件 @expo-google-fonts/noto-sans-tc 取出
      NotoSansTC_400Regular.ttf／NotoSansTC_700Bold.ttf 改名使用（字面一致）。

2026-08 更新（事實層對齊官網 2026-08-12 版本）：
  ① 網路時段預約系統（lhpedclinic.booknow.com.tw）全面納入：釋出/截止、報到 10 分鐘、
     取消改期與未到計次、同時 2 筆額度、家庭預約、疫苗施打截止時間
  ② 各診次現場掛號開始時間（早診 08:00／午診 14:30／晚診 18:00）與完整過號規則
  ③ 醫療團隊補兒科專科醫師資格、李醫師國泰完整資歷；師承補客觀陳述但書
  ④ 服務項目 6→11 項（補過敏原檢測、兒童發展篩檢、耳鼻喉、皮膚、外傷）
  ⑤ 院內設備 2→5 項（肺量計具名 MIR Minispir、InBody 270、尿液分析儀、
     超音波噴霧治療器、耳鼻喉治療台）
  ⑥ 衛教文章 21→43 篇（三專欄；含成人健康專欄）
  ⑦ 門診時間頁補 2026-09-01 起醫師排班異動（開診時段未變）
  ⑧ 去除比較級措辭（「少數」等），改為客觀事實陳述

工程層改善：目錄頁碼改為兩趟建置自動產生（不再手寫，內容增減不會失準）、
  章節加 PDF 書籤與大綱、目錄可點擊跳頁、內文網址可點擊。
"""
import os
import sys

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, HRFlowable, Flowable, KeepTogether)
from reportlab.platypus import paragraph as _rl_paragraph
from reportlab.lib import textsplit as _rl_textsplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# 中文標點禁則：reportlab 內建清單只涵蓋日文標點，補上中文全形逗號、分號等，
# 避免斷行後由「，、。；：！？）」開頭（改為懸掛在右邊界）。
# ⚠️ 兩份都要補：單一 frag 段落走 textsplit.dumbSplit、多 frag（含 <b>）走 paragraph.cjkFragSplit，
#    各自 import 了自己的 ALL_CANNOT_START，只補一邊會半數失效。
_EXTRA_CANNOT_START = '，；：！？．＞…—―）］｝〉》、。」』】％‰'
_rl_paragraph.ALL_CANNOT_START += _EXTRA_CANNOT_START
_rl_textsplit.ALL_CANNOT_START += _EXTRA_CANNOT_START

# ────────────────────────────── 路徑與字型 ──────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
DEFAULT_OUT = os.path.join(REPO_ROOT, 'docs', 'lihsin-clinic-intro-2026.pdf')


def _font_path(filename):
    candidates = []
    env_dir = os.environ.get('LIHSIN_PDF_FONT_DIR')
    if env_dir:
        candidates.append(os.path.join(env_dir, filename))
    candidates.append(os.path.join(SCRIPT_DIR, filename))
    candidates.append(os.path.join(os.getcwd(), filename))
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise SystemExit(
        "找不到字型檔 %s。請置於下列任一位置：\n  %s\n"
        "（可由 npm 套件 @expo-google-fonts/noto-sans-tc 取 NotoSansTC_400Regular.ttf／"
        "NotoSansTC_700Bold.ttf 改名）" % (filename, "\n  ".join(candidates)))


pdfmetrics.registerFont(TTFont('TC', _font_path('NotoTC-Reg.ttf')))
pdfmetrics.registerFont(TTFont('TCB', _font_path('NotoTC-Bold.ttf')))

# ────────────────────────────── 樣式 ──────────────────────────────
GREEN = colors.HexColor('#7C9A6E')
LGREEN = colors.HexColor('#A8C69F')
BGGREEN = colors.HexColor('#f0f7ed')
GOLD = colors.HexColor('#D4B896')
DARK = colors.HexColor('#333333')
GRAY = colors.HexColor('#666666')
RED = colors.HexColor('#c0392b')


def S(name, **kw):
    # wordWrap='CJK'：中文逐字斷行＋標點懸掛（避免整行被英數詞卡住、避免標點落在行首）。
    # ⚠️ 此模式下不可用不斷行空格 U+00A0：滿行時 reportlab 會吃掉其後的字元。
    kw.setdefault('wordWrap', 'CJK')
    return ParagraphStyle(name, **kw)


h1 = S('h1', fontName='TCB', fontSize=20, textColor=GREEN, spaceAfter=10, spaceBefore=4, leading=26)
h2 = S('h2', fontName='TCB', fontSize=14, textColor=GREEN, spaceAfter=7, spaceBefore=10, leading=20,
       keepWithNext=1)
h3 = S('h3', fontName='TCB', fontSize=11.5, textColor=DARK, spaceAfter=4, spaceBefore=6, leading=16,
       keepWithNext=1)
body = S('body', fontName='TC', fontSize=10, textColor=DARK, leading=16, spaceAfter=5)
bullet = S('bullet', fontName='TC', fontSize=10, textColor=DARK, leading=15.5, spaceAfter=2.5, leftIndent=10)
note = S('note', fontName='TC', fontSize=8.5, textColor=GRAY, leading=13, spaceAfter=3)
center_sub = S('cs', fontName='TC', fontSize=13, textColor=GRAY, alignment=1, leading=20, spaceAfter=4)
center_title = S('ct', fontName='TCB', fontSize=30, textColor=GREEN, alignment=1, leading=40, spaceAfter=6)
quote = S('q', fontName='TC', fontSize=10, textColor=GREEN, leading=16, leftIndent=8, spaceAfter=5)
sub_h = S('sub_h', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=3, spaceBefore=2,
          keepWithNext=1)

DOC_VERSION = '2026年8月'
SITE = 'https://lhpedclinic.com.tw'
BOOKING = 'https://lhpedclinic.booknow.com.tw/'
PROGRESS = 'https://www.mainpi.com/query?i=2935'

HEADER = "立欣診所 LiHsin Clinic ｜ 台南市北區小兒科・家庭醫學　%s" % SITE
FOOTER1 = "台南市北區育德路467號 ｜ 06-2516086 ｜ LINE: @lhpedclinic"
FOOTER2 = ("衛生福利部健保特約醫療機構 ｜ 本文件由蔡宗儒院長審閱 ｜ 文件版本：%s（更新版）"
           % DOC_VERSION)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('TC', 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(20 * mm, 285 * mm, HEADER)
    canvas.setStrokeColor(LGREEN)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 283 * mm, 190 * mm, 283 * mm)
    canvas.setStrokeColor(LGREEN)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.setFont('TC', 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(20 * mm, 11.5 * mm, FOOTER1)
    canvas.drawRightString(190 * mm, 11.5 * mm, "- %d -" % canvas.getPageNumber())
    canvas.setFont('TC', 6.5)
    canvas.drawString(20 * mm, 8.5 * mm, FOOTER2)
    canvas.restoreState()


def bl(items, st=bullet):
    return [Paragraph("• %s" % x, st) for x in items]


def url(u, label=None):
    """可點擊的網址（PDF 內超連結）。"""
    return '<link href="%s" color="#5a7a50">%s</link>' % (u, label or u)


# ───────────────────── 章節標記：兩趟建置取得真實頁碼 ─────────────────────
SECTION_PAGES = {}


class SectionMark(Flowable):
    """零高度標記：記錄章節起始頁、加 PDF 書籤與大綱。"""

    def __init__(self, key, title):
        Flowable.__init__(self)
        self.key = key
        self.title = title
        self.width = 0
        self.height = 0

    def wrap(self, availWidth, availHeight):
        return (0, 0)

    def draw(self):
        SECTION_PAGES[self.key] = self.canv.getPageNumber()
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, level=0)


# 章節清單（目錄與書籤共用單一來源）
SECTIONS = [
    ('sec01', '一、診所簡介'),
    ('sec02', '二、醫療團隊'),
    ('sec03', '三、服務項目'),
    ('sec04', '四、門診時間'),
    ('sec05', '五、院內專業設備'),
    ('sec06', '六、為什麼選擇立欣診所'),
    ('sec07', '七、預約掛號與看診流程'),
    ('sec08', '八、衛教文章'),
    ('sec09', '九、常見問題 FAQ'),
    ('sec10', '十、就診前準備事項'),
    ('sec11', '十一、聯絡資訊與交通'),
]


def section(key, title, style=h1):
    """章節標題（含標記）。"""
    return [SectionMark(key, title), Paragraph(title, style)]


def notice_box(title, text, bg='#fdeeee', border='#f5c6c6', title_color=RED):
    t = Table([
        [Paragraph(title, S('nt', fontName='TCB', fontSize=10.5, textColor=title_color, leading=15))],
        [Paragraph(text, S('ntb', fontName='TC', fontSize=9.5, textColor=DARK, leading=15))],
    ], colWidths=[150 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(bg)),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(border)),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    return t


# ────────────────────────────── 衛教文章資料 ──────────────────────────────
ARTICLES_TSAI = [
    ('黴漿菌肺炎', '「會走路的肺炎」症狀、抗藥性與照護重點', '/health/mycoplasma-pneumonia.html'),
    ('兒童蕁麻疹', '急性與慢性、常見誘因、過敏性休克警訊', '/health/child-urticaria.html'),
    ('認識過敏', '過敏體質、常見症狀、原因與居家保養', '/health/allergy.html'),
    ('孩子半夜咳不停\n是氣喘嗎', '久咳原因、咳嗽變異型氣喘、肺功能檢測', '/health/child-chronic-cough.html'),
    ('如何判斷孩子在喘', '聽、數、看三步驟，各年齡呼吸過快門檻與危險徵象', '/health/child-wheezing.html'),
    ('後鼻滴流', '一直清喉嚨、鼻涕倒流與夜咳的關聯', '/health/postnasal-drip.html'),
    ('過敏性鼻炎治療', '鼻噴劑與抗組織胺的使用、居家環境控制', '/health/allergic-rhinitis-treatment.html'),
    ('認識塵蟎', '防蟎寢具、55°C 熱水清洗、濕度控制', '/health/dust-mite.html'),
    ('過敏原檢測\n報告怎麼看', 'IgE／IgG 數值判讀，結果不單以數值決定忌口', '/health/allergy-test-results.html'),
    ('異位性皮膚炎', '清潔保濕、藥膏使用與居家注意事項', '/health/atopic-dermatitis.html'),
    ('腸病毒', '症狀、重症四大前兆，酒精無效需用含氯漂白水', '/health/enterovirus.html'),
    ('腸病毒71型疫苗', '接種對象、劑數與保護重點', '/health/enterovirus71-vaccine.html'),
    ('hMPV 人類間質\n肺炎病毒', '症狀、與感冒流感的鑑別、就醫警訊', '/health/hmpv.html'),
    ('麻疹', '傳染力、併發症與出國前 2–4 週接種提醒', '/health/measles.html'),
    ('MMR 疫苗', '麻疹腮腺炎德國麻疹三合一的公費時程與注意', '/health/mmr-vaccine.html'),
    ('肺炎鏈球菌疫苗', '幼兒公費時程、疫苗種類與長者接種', '/health/pneumococcal-vaccine.html'),
    ('水痘疫苗', '公費時程、第二劑與突破性水痘', '/health/varicella-vaccine.html'),
    ('流感疫苗', '公費對象、接種時機與注意事項', '/health/flu-vaccine.html'),
    ('兒童流感', '症狀表現，以及流感與一般感冒的差別', '/health/influenza.html'),
    ('兒童發燒', '幾度算發燒、退燒藥怎麼用、何時該就醫', '/health/child-fever.html'),
    ('兒童中暑', '熱傷害三種類型與急救五步驟', '/health/heat-illness.html'),
    ('兒童生長曲線', '百分位判讀與身高、體重追蹤', '/health/growth-curve.html'),
    ('過敏會引起\n偏頭痛嗎', '過敏與兒童頭痛的關聯、組織胺與危險徵兆', '/health/allergy-headache.html'),
    ('兒童肥胖與\n體重管理', '健康體位三寶，不節食、不羞辱的體重管理', '/health/childhood-obesity.html'),
    ('兒童中耳炎', '耳朵痛、揉耳朵的判斷與就醫時機', '/health/otitis-media.html'),
]

ARTICLES_LEE = [
    ('嬰幼兒腸胃炎', '輪狀／諾羅病毒、脫水警訊與補水原則', '/health/infant-gastroenteritis.html'),
    ('輪狀病毒疫苗', '口服疫苗劑型、接種月齡與注意事項', '/health/rotavirus-vaccine.html'),
    ('新生兒黃疸', '生理性與病理性的分辨、回診監測時機', '/health/newborn-jaundice.html'),
    ('新生兒餵食', '奶量夠不夠？尿布次數與體重觀察', '/health/newborn-feeding.html'),
    ('新生兒發燒', '三個月以下發燒的處置與就醫時機', '/health/newborn-fever.html'),
    ('新生兒睡眠安全', '仰睡原則、嬰兒猝死症（SIDS）預防', '/health/newborn-sleep-safety.html'),
    ('寶寶溢奶吐奶', '生理性溢奶、胃食道逆流與危險警訊', '/health/baby-spitting-up.html'),
    ('嬰兒腸絞痛', 'Wessel 333 法則與安撫方法', '/health/baby-colic.html'),
    ('RSV 單株抗體', '樂唯初（Beyfortus）保護力、適合對象與注意', '/health/rsv-immunization.html'),
    ('B型腦膜炎\n雙球菌疫苗', '必思諾（Bexsero）劑次、副作用與適用年齡', '/health/meningococcal-b-vaccine.html'),
    ('兒童便秘', '幾天沒大便算便秘、何時要就醫', '/health/child-constipation.html'),
]

ARTICLES_ADULT = [
    ('全方位健康檢查', '自費健檢套組項目與適合對象', '/health/health-checkup.html'),
    ('代謝症候群', '5 項判定標準、風險與可逆的改善方向', '/health/metabolic-syndrome.html'),
    ('高血壓', '130/80 新標準與居家血壓 722 量測', '/health/hypertension.html'),
    ('糖尿病', '診斷標準、糖尿病前期與日常控制', '/health/diabetes.html'),
    ('高血脂', '膽固醇與三酸甘油酯數值判讀與改善', '/health/hyperlipidemia.html'),
    ('帶狀皰疹疫苗', '保護力、適合對象與接種注意事項', '/health/shingles-vaccine.html'),
    ('9 價 HPV 疫苗', '可預防的疾病、適合對象與公費自費', '/health/hpv-vaccine.html'),
]

_detail_st = S('artd', fontName='TC', fontSize=8.5, textColor=DARK, leading=11.5)
_url_st = S('arturl', fontName='TC', fontSize=7.5, textColor=GRAY, leading=10)


_hdr_st = S('arthdr', fontName='TCB', fontSize=8.5, textColor=colors.white, leading=11)


def art_table(rows):
    data = [['主題', '內容重點',
             Paragraph('官網網址<br/><font size="7">lhpedclinic.com.tw/health/…</font>',
                       _hdr_st)]]
    for topic, detail, path in rows:
        data.append([topic, Paragraph(detail, _detail_st),
                     Paragraph(url(SITE + path, path.rsplit('/', 1)[-1]), _url_st)])
    t = Table(data, colWidths=[30 * mm, 70 * mm, 50 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'TCB'), ('FONTNAME', (0, 1), (0, -1), 'TCB'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('BACKGROUND', (0, 0), (-1, 0), GREEN), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('TEXTCOLOR', (0, 1), (0, -1), GREEN), ('BACKGROUND', (0, 1), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('GRID', (0, 0), (-1, -1), 0.5, LGREEN),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('ROWBACKGROUNDS', (1, 1), (-1, -1), [colors.white, colors.HexColor('#fafbfa')]),
    ]))
    return t


# ────────────────────────────── 內容 ──────────────────────────────
def build_story():
    story = []

    # ========== 封面 ==========
    story.append(Spacer(1, 44))
    story.append(Paragraph("立 欣 診 所", center_title))
    story.append(Paragraph("LiHsin Clinic", S('en', fontName='TCB', fontSize=18, textColor=LGREEN,
                                              alignment=1, spaceAfter=20)))
    story.append(HRFlowable(width="40%", thickness=2, color=GOLD, spaceAfter=20, spaceBefore=4,
                            hAlign='CENTER'))
    story.append(Paragraph("醫學中心訓練的兒科醫師", center_sub))
    story.append(Paragraph("家門口的暖心照護", center_sub))
    story.append(Spacer(1, 8))
    story.append(Paragraph("小鹿醫師團隊　The Little Deer Doctor Team",
                           S('subbrand', fontName='TCB', fontSize=11, textColor=GOLD, alignment=1,
                             leading=16, spaceAfter=4)))
    story.append(Spacer(1, 20))
    cover_data = [
        ['院　址', '台南市北區育德路467號'],
        ['電　話', '06-2516086'],
        ['L I N E', '@lhpedclinic'],
        ['官　網', url(SITE)],
        ['網路預約', url(BOOKING, 'lhpedclinic.booknow.com.tw')],
        ['看診進度', url(PROGRESS, 'mainpi.com/query?i=2935')],
        ['開業日期', '2024年7月1日'],
        ['Google 評價', '★ 5.0 星（衛福部健保特約醫療機構）'],
    ]
    cover_cell = S('cov_cell', fontName='TC', fontSize=11, textColor=DARK, leading=15)
    cover_key = S('cov_key', fontName='TCB', fontSize=11, textColor=GREEN, leading=15)
    t = Table([[Paragraph(k, cover_key), Paragraph(v, cover_cell)] for k, v in cover_data],
              colWidths=[35 * mm, 110 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6), ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.white),
        ('ROWBACKGROUNDS', (1, 0), (1, -1), [colors.HexColor('#fafbfa')]),
    ]))
    story.append(t)
    story.append(Spacer(1, 24))
    story.append(Paragraph(
        "本文件為立欣診所公開介紹資料，提供家長、媒體、AI 搜尋引擎與合作夥伴參考。"
        "內容對應官網 %s 版本；門診異動與疫苗現貨以官網公告與 LINE 為準。" % DOC_VERSION,
        S('cov', fontName='TC', fontSize=9, textColor=GRAY, alignment=1, leading=14)))
    story.append(PageBreak())

    # ========== 目錄 ==========
    story.append(Paragraph("目 錄", h1))
    story.append(Spacer(1, 6))
    toc_st = S('toc', fontName='TC', fontSize=11.5, textColor=DARK, leading=24)
    toc_pg = S('tocpg', fontName='TC', fontSize=11.5, textColor=DARK, leading=24, alignment=2)
    toc_rows = []
    for key, name in SECTIONS:
        dots = '…' * max(3, 32 - len(name))
        toc_rows.append([
            Paragraph('<link destination="%s" color="#333333">%s　%s</link>' % (key, name, dots),
                      toc_st),
            Paragraph('<link destination="%s" color="#333333">%s</link>'
                      % (key, SECTION_PAGES.get(key, '')), toc_pg),
        ])
    toc_t = Table(toc_rows, colWidths=[140 * mm, 10 * mm])
    toc_t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(toc_t)
    story.append(PageBreak())

    # ========== 一、診所簡介 ==========
    story += section('sec01', '一、診所簡介')
    story.append(Paragraph("關於立欣診所", h2))
    story.append(Paragraph(
        "立欣診所（LiHsin Clinic）是位於台南市北區育德路467號的小兒科與家庭醫學診所，"
        "於2024年7月1日開業，為衛生福利部中央健康保險署特約醫療機構。診所由具馬偕兒童醫院"
        "兒童過敏氣喘免疫風濕科研究醫師訓練的蔡宗儒院長主持，李佳玲醫師擔任主治醫師，"
        "具國泰綜合醫院新生兒次專科研究醫師訓練；兩位皆為臺灣兒科醫學會認證的兒科專科醫師。"
        "服務對象從新生兒、兒童到成人與長輩，涵蓋兒科、兒童過敏氣喘、新生兒照護、疫苗接種"
        "與成人家庭醫學。", body))
    story.append(Paragraph("立欣診所的特色", h2))
    for t_, d_ in [
        ("醫學中心訓練的兒科醫師",
         "蔡宗儒院長具馬偕兒童醫院兒童過敏氣喘免疫風濕科研究醫師訓練，李佳玲醫師具國泰綜合醫院"
         "新生兒次專科研究醫師訓練，兩位皆為兒科專科醫師。"),
        ("院內肺功能檢測儀（肺量計 Spirometer）",
         "為兒童氣喘與慢性久咳提供客觀量化的氣道評估，協助醫師判斷控制狀況與用藥反應，"
         "不必僅依賴症狀描述。檢查需孩子配合用力吹氣，一般約 5～6 歲以上較能順利完成，"
         "是否安排由醫師評估。"),
        ("InBody 270 身體組成分析儀",
         "用於科學減重門診，提供體脂率、基礎代謝率、肌肉量等客觀數據，讓減重有明確的起點與"
         "追蹤依據。"),
        ("週一至週日七天門診",
         "平日提供上午、下午、夜診三段門診（夜診看診至21:30）；週六、週日均有門診，"
         "便於雙薪家庭安排就診。"),
        ("公費與自費疫苗完整供應",
         "兒童公費疫苗依國家接種時程提供；自費疫苗包含輪狀病毒、腸病毒71型、B型腦脊髓膜炎"
         "（Bexsero 必思諾）、15價肺炎鏈球菌、RSV單株抗體（樂唯初 Beyfortus）、HPV、"
         "帶狀皰疹疫苗（欣剋疹）等。適用對象依原廠仿單與醫師評估，接種前請先確認當日現貨。"),
        ("網路時段預約與即時看診進度",
         "採網路時段預約（每 30 分鐘一個時段），門診時間也可來電由櫃檯代訂；搭配免排雲端"
         "（MainPI）看診進度查詢，在家等候快到號再出門。"),
        ("兒童友善的候診空間",
         "設置兒童遊戲區與卡通主題佈置，降低孩子就醫的緊張感。"),
    ]:
        story.append(Paragraph("• <b>%s</b>" % t_, h3))
        story.append(Paragraph(d_, bullet))
    story.append(Paragraph("服務區域", h2))
    story.append(Paragraph(
        "立欣診所主要服務台南市北區、東區、中西區、永康區、安南區、南區、仁德區等地區居民。"
        "診所位置鄰近成大醫院、台南公園與長榮中學，交通便利。", body))
    story.append(PageBreak())

    # ========== 二、醫療團隊 ==========
    story += section('sec02', '二、醫療團隊')
    story.append(Paragraph("蔡宗儒 院長", h2))
    story.append(Paragraph("專長：兒童過敏、氣喘、一般兒科、肥胖醫學",
                           S('sp', fontName='TCB', fontSize=10, textColor=GOLD, spaceAfter=6)))
    story.append(Paragraph("學歷與專科訓練", h3))
    story += bl([
        "中國醫藥大學 醫學士暨公共衛生碩士",
        "馬偕兒童醫院 兒童過敏氣喘免疫風濕科研究醫師（次專科訓練）",
        "新光吳火獅紀念醫院 兒科總醫師",
        "成大醫院 兒科住院醫師",
        "天主教輔仁大學醫院 兒科主治醫師",
        "日本順天堂大學醫院 兒科臨床進修",
    ])
    story.append(Paragraph("專科資格與學會會員", h3))
    story += bl([
        "專科資格：兒科專科醫師（臺灣兒科醫學會）",
        "學會會員：台灣兒科醫學會、台灣兒童過敏氣喘免疫及風濕病醫學會、台灣肥胖醫學會",
    ])
    story.append(Paragraph(
        "師承：過敏及氣喘師承台北馬偕徐世達教授；異位性皮膚炎師承新光醫院王怜人醫師。"
        "以上為客觀師承陳述，師承關係不代表任何背書，兩位師長並未在本院執業。", note))
    story.append(Paragraph("看診理念", h3))
    story.append(Paragraph(
        "「我相信每個孩子都值得被溫柔對待。從診斷到陪伴，我希望成為家長最信任的醫療夥伴，"
        "讓每一次就診都是一次安心的體驗。」", quote))
    story.append(Paragraph(
        "蔡宗儒院長在台北完成醫學中心訓練後返鄉開業，期望將醫學中心的兒童過敏氣喘照護經驗"
        "帶回家鄉台南。看診上強調「不催促看診、不開過強的藥」，重視傾聽家長與孩子的真實狀況，"
        "用淺白方式說明診斷與治療方向。", body))
    story.append(Paragraph("完整學經歷與撰寫、審閱的衛教文章：%s"
                           % url(SITE + '/team/dr-tsai.html'), note))
    story.append(PageBreak())

    story.append(Paragraph("李佳玲 主治醫師", h2))
    story.append(Paragraph("專長：新生兒照護、黃疸追蹤、一般兒科、小兒成長發育評估",
                           S('sp2', fontName='TCB', fontSize=10, textColor=GOLD, spaceAfter=6)))
    story.append(Paragraph("學歷與專科訓練", h3))
    story += bl([
        "國防醫學院 醫學士",
        "國泰綜合醫院 新生兒次專科研究醫師（次專科訓練）",
        "國泰綜合醫院 兒科主治醫師",
        "國泰綜合醫院 兒科總醫師",
        "國泰綜合醫院 兒科住院醫師",
        "台北禾馨民權婦幼診所 兒科主治醫師",
    ])
    story.append(Paragraph("專科資格與學會會員", h3))
    story += bl([
        "專科資格：兒科專科醫師（臺灣兒科醫學會）",
        "學會會員：台灣兒科醫學會、台灣新生兒科醫學會",
    ])
    story.append(Paragraph("看診理念", h3))
    story.append(Paragraph(
        "「新生兒的每一個微笑，都是我堅持的動力。我致力於提供細心、專業的新生兒照護，"
        "讓每位寶寶在生命最初的旅程中，都能獲得最溫暖的守護。」", quote))
    story.append(Paragraph("專業介紹", h3))
    story.append(Paragraph(
        "李佳玲醫師專精新生兒黃疸追蹤、母乳與配方奶餵食評估、嬰幼兒生長曲線與發展里程碑追蹤、"
        "早產兒回診照護。對於初為人父母的家庭，可從新生兒滿月健檢、副食品添加（4～6 個月起）、"
        "語言與動作發展，提供成長過程的完整照護建議，並協助規劃嬰幼兒疫苗接種時程。", body))
    story.append(Paragraph("完整學經歷與撰寫、審閱的衛教文章：%s"
                           % url(SITE + '/team/dr-lee.html'), note))
    story.append(Spacer(1, 10))

    team = [
        ['項目', '蔡宗儒 院長', '李佳玲 主治醫師'],
        ['醫學院', '中國醫藥大學\n醫學士暨公衛碩士', '國防醫學院\n醫學士'],
        ['醫學中心訓練', '成大、新光、馬偕、輔大', '國泰綜合醫院'],
        ['次專科訓練', '兒童過敏氣喘免疫風濕科\n研究醫師（馬偕兒童醫院）',
         '新生兒次專科研究醫師\n（國泰綜合醫院）'],
        ['專科資格', '兒科專科醫師\n（臺灣兒科醫學會）', '兒科專科醫師\n（臺灣兒科醫學會）'],
        ['海外進修', '日本順天堂大學\n兒科臨床進修', '—'],
        ['主要專長', '兒童過敏、氣喘\n一般兒科、肥胖醫學', '新生兒照護、一般兒科\n小兒成長發育'],
        ['學會會員', '兒科醫學會、肥胖醫學會、\n過敏氣喘免疫及風濕病醫學會',
         '兒科醫學會\n新生兒科醫學會'],
    ]
    tt = Table(team, colWidths=[30 * mm, 60 * mm, 60 * mm])
    tt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'TCB'), ('FONTNAME', (0, 1), (-1, -1), 'TC'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5), ('BACKGROUND', (0, 0), (-1, 0), GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('TEXTCOLOR', (0, 1), (0, -1), GREEN),
        ('FONTNAME', (0, 1), (0, -1), 'TCB'), ('BACKGROUND', (0, 1), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, LGREEN), ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS', (1, 1), (-1, -1), [colors.white, colors.HexColor('#fafbfa')]),
    ]))
    story.append(KeepTogether([
        Paragraph("醫療團隊資歷一覽表", h2),
        tt,
        Paragraph("醫師排班（哪一診由哪一位醫師看診）以官網首頁門診時間表與網路預約系統顯示為準。",
                  note),
    ]))
    story.append(PageBreak())

    # ========== 三、服務項目 ==========
    story += section('sec03', '三、服務項目')
    story.append(Paragraph(
        "各項服務的詳細說明可參考官網服務專頁：%s" % url(SITE + '/#services'), note))
    def item(*flows):
        story.append(KeepTogether([f for f in flows if f is not None]))

    item(
        Paragraph("1. 小兒科一般診療", h3),
        Paragraph(
            "提供 0 歲新生兒至 18 歲青少年的兒科照護，包含急性疾病診療（感冒、發燒、腸胃炎、"
            "皮膚紅疹等）、慢性疾病追蹤、生長發育評估與健康諮詢。", body))
    item(
        Paragraph("2. 兒童過敏氣喘照護", h3),
        Paragraph("由具馬偕兒童醫院兒童過敏氣喘免疫風濕科訓練的蔡宗儒院長主診，服務內容包含：",
                  body),
        *bl([
            "兒童氣喘評估與長期控制（含院內肺功能檢測）",
            "過敏性鼻炎照護（含環境控制與藥物調整）",
            "異位性皮膚炎照護（含保濕計畫與用藥指導）",
            "食物過敏評估",
            "慢性久咳鑑別診斷（咳嗽變異型氣喘、後鼻滴流、感染後咳嗽等）",
            "個人化氣喘控制計畫與定期追蹤",
        ]),
        Paragraph("氣喘以「良好控制、減少發作」為治療目標，並非根治。", note))
    item(
        Paragraph("3. 自費過敏原檢測（急性 IgE／慢性 IgG）", h3),
        Paragraph(
            "經醫師評估後以抽血檢驗，協助釐清塵蟎、花粉、黴菌、動物皮毛及部分食物等可能的"
            "誘發因子，作為環境調整與飲食建議的參考。急性（IgE）針對立即型反應，"
            "慢性（IgG）為延遲型反應。是否檢測、檢測項目由醫師依個別狀況評估；"
            "檢測結果需由醫師結合症狀與病史判讀，不單以數值決定忌口。", body))
    item(
        Paragraph("4. 新生兒與嬰幼兒照護", h3),
        Paragraph("由具國泰綜合醫院新生兒次專科研究醫師訓練的李佳玲醫師主診：", body),
        *bl([
            "新生兒黃疸追蹤評估（建議出院後 1–2 天回診監測）",
            "母乳或配方奶餵食評估與指導",
            "嬰幼兒生長曲線追蹤",
            "早產兒回診照護",
            "副食品添加諮詢（4–6 個月起）",
            "嬰幼兒發展評估（動作、語言、社交里程碑）",
        ]))
    item(
        Paragraph("5. 兒童發展篩檢門診（公費）", h3),
        Paragraph(
            "配合國民健康署方案辦理，未滿 7 歲兒童共 6 次公費發展篩檢，檢視粗大動作、精細動作、"
            "語言認知與社會發展；當天流程約 10–15 分鐘。需要進一步評估時，協助轉介兒童發展"
            "聯合評估中心。", body),
        *bl([
            "施測時間：週二至週五上午 09:00–11:30、下午 14:30–16:00；週一僅下午 14:30–16:00"
            "（國定假日不施測）",
            "每個時段只安排 1 位兒童施測；家中有 2 位兒童要施測，請分別預約 2 個時段",
            "當天請帶健保卡與兒童健康手冊，兩樣缺一即無法施測",
            "早產的孩子請依矯正年齡（不是出生後的實際月齡）挑選對應時段，"
            "不確定可先來電由櫃檯協助",
        ]))
    story.append(Paragraph("6. 疫苗接種服務", h3))
    story.append(Paragraph("公費疫苗（依國家接種時程）", sub_h))
    story.append(Paragraph(
        "依兒童健康手冊（黃卡）時程提供公費疫苗，包含五合一、四合一、13價肺炎鏈球菌、水痘、"
        "MMR（麻疹腮腺炎德國麻疹）、A型肝炎、日本腦炎、HPV、流感疫苗等。", body))
    story.append(Paragraph("自費疫苗（多元選擇）", sub_h))
    vac = [
        ['對象', '疫苗品項'],
        ['嬰幼兒／兒童',
         '口服輪狀病毒疫苗、腸病毒71型疫苗、B型腦脊髓膜炎（Bexsero 必思諾）、\n'
         '15價肺炎鏈球菌、RSV單株抗體（樂唯初 Beyfortus）、\n'
         'HPV（嘉喜9價）、水痘、流感疫苗等'],
        ['成人／長輩',
         '帶狀皰疹疫苗（欣剋疹 Shingrix）、HPV（嘉喜9價）、20價肺炎鏈球菌、\n'
         'MMR、Tdap（百日咳）、A型／B型肝炎、流感疫苗等'],
    ]
    vt = Table(vac, colWidths=[28 * mm, 122 * mm])
    vt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'TCB'), ('FONTNAME', (0, 1), (-1, -1), 'TC'),
        ('FONTSIZE', (0, 0), (-1, -1), 9), ('BACKGROUND', (0, 0), (-1, 0), GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('TEXTCOLOR', (0, 1), (0, -1), GREEN),
        ('FONTNAME', (0, 1), (0, -1), 'TCB'), ('BACKGROUND', (0, 1), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('GRID', (0, 0), (-1, -1), 0.5, LGREEN),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(vt)
    story.append(Paragraph(
        "※ 各疫苗的適用對象、劑次與間隔依原廠仿單記載，實際是否接種由醫師當日評估；"
        "有發燒、急性疾病或對疫苗成分過敏等禁忌情形時應暫緩或不予接種。疫苗現貨會變動，"
        "接種前請先來電 06-2516086 或加 LINE @lhpedclinic 確認。", note))
    story.append(Paragraph(
        "※ 每日最後一診前 1 小時停止疫苗施打（清點申報作業）：週一至週五 20:30 前、"
        "週六 17:00 前、週日 20:00 前到院。", note))
    item(
        Paragraph("7. 家庭醫學照護（成人服務）", h3),
        *bl([
            "成人感冒、咳嗽、腸胃道症狀等一般診療",
            "高血壓、糖尿病、高血脂等慢性病的穩定控制與長期追蹤"
            "（以控制病情、降低併發症風險為目標）",
            "公費成人預防保健（成人健檢）",
            "成人疫苗接種（流感、帶狀皰疹、肺炎鏈球菌、HPV 等）",
            "一般健康諮詢",
        ]))
    story.append(Paragraph("8. 科學減重門診", h3))
    story.append(Paragraph(
        "由台灣肥胖醫學會醫師蔡宗儒院長主持，採「三位一體科學減重方案」，"
        "結合精準評估與個人化規劃：", body))
    story.append(Paragraph("第一步：身體組成分析", sub_h))
    story.append(Paragraph(
        "透過院內 InBody 270 身體組成分析儀，了解基礎代謝率、體脂率、肌肉量、體水分等客觀數據，"
        "建立減重起點。", body))
    story.append(Paragraph("第二步：醫師專業評估", sub_h))
    story.append(Paragraph(
        "由醫師進行個人體質評估，量測血壓、腰圍，必要時安排抽血檢查，確認減重方式與用藥安全性。",
        body))
    story.append(Paragraph("第三步：個人化方案規劃", sub_h))
    story.append(Paragraph(
        "依個人代謝狀況、生活型態與減重目標規劃飲食衛教與運動建議；經醫師完整評估後，"
        "必要時搭配核准之減重藥物（須符合適應症）。減重需經醫師完整評估，效果因人而異，"
        "並非每位民眾皆適用相同方式。對成長中的孩子與青少年，以建立健康習慣與維持正常生長為主，"
        "不採嚴格節食，也不以體重評價孩子。", body))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "關於 GLP-1 類減重藥物：GLP-1 受體促效劑（semaglutide）與雙機轉 GLP-1／GIP 受體促效劑"
        "（tirzepatide）等新型代謝藥物，在台灣核准適應症為「第2型糖尿病」之血糖控制。"
        "用於體重管理屬仿單外（off-label）使用，須由醫師完整評估 BMI、代謝指標、共病、"
        "禁忌症後依個別醫療判斷處方。立欣診所提供醫師面診評估，效果因人而異，並有副作用風險。"
        "本資訊為一般醫學衛教，不構成藥品廣告。", note))
    item(
        Paragraph("9. 耳鼻喉相關症狀門診", h3),
        Paragraph(
            "鼻塞、流鼻水、鼻涕倒流、喉嚨痛、耳朵痛與中耳炎等孩子與大人常見的耳鼻喉相關症狀，"
            "門診都可以評估。院內備有耳鼻喉治療台與超音波噴霧治療器，另可處理耳垢清理與淺層魚刺。"
            "立欣診所為小兒科與家庭醫學診所、非耳鼻喉專科，需專科進一步處置者協助轉介。", body))
    item(
        Paragraph("10. 皮膚疾病門診", h3),
        Paragraph(
            "皮膚過敏、濕疹與異位性皮膚炎、蕁麻疹、黴菌感染（香港腳與各種癬）、單純疱疹等"
            "常見皮膚問題，兒童與成人皆可於門診評估與治療。需切片、雷射或專科長期追蹤者"
            "協助轉介。", body))
    item(
        Paragraph("11. 外傷處理門診", h3),
        Paragraph(
            "擦傷、割傷、撕裂傷的清創與換藥，並由醫師評估後進行傷口縫合與拆線"
            "（他院縫合的傷口也可以來拆）、膿瘍處置，以及蜂窩性組織炎的口服抗生素治療與追蹤，"
            "另依受傷型態與接種紀錄評估破傷風。傷及肌腱神經血管、大量出血或大面積燒燙傷，"
            "請直接前往急診。", body))
    story.append(Spacer(1, 6))
    story.append(notice_box(
        "【就醫定位】",
        "立欣診所為一般門診、非急診機構。若出現高燒不退合併意識改變、呼吸困難、抽搐、"
        "嚴重脫水等狀況，請直接撥打 <b>119</b> 或前往鄰近醫院急診，勿等候門診。"))
    story.append(PageBreak())

    # ========== 四、門診時間 ==========
    story += section('sec04', '四、門診時間')
    story.append(Paragraph(
        "立欣診所平日設有夜診，週六與週日均有門診，方便雙薪家庭的就診需求。", body))
    story.append(Spacer(1, 4))
    sched = [
        ['時段', '一', '二', '三', '四', '五', '六', '日'],
        ['上午\n08:00–12:00', '✓', '✓', '✓', '✓', '✓', '✓\n至11:30', '✓\n至11:30'],
        ['下午\n14:30–18:00', '✓', '✓', '✓', '✓', '✓', '✓', '—'],
        ['夜間\n18:30–21:30', '✓', '✓', '✓', '✓', '✓', '—', '✓\n至21:00'],
    ]
    st = Table(sched, colWidths=[32 * mm] + [16.5 * mm] * 7)
    st.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'TCB'), ('FONTNAME', (0, 1), (0, -1), 'TCB'),
        ('FONTNAME', (1, 1), (-1, -1), 'TC'), ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 0), (-1, 0), GREEN), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('TEXTCOLOR', (0, 1), (0, -1), GREEN), ('BACKGROUND', (0, 1), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, LGREEN), ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(st)
    story.append(Paragraph("門診時間重點說明", h3))
    story += bl([
        "平日夜診（一至五）：18:30–21:30，方便上班族家長下班後帶孩子就診",
        "週六：上午 08:00–11:30、下午 14:30–18:00（無夜診）",
        "週日：上午 08:00–11:30、夜間 18:30–21:00（無午診）",
        "國定假日、颱風天等特殊日期門診時段可能調整（颱風天依台南市政府停班停課公告為準），"
        "請以官網公告、LINE 官方帳號或 Facebook 為準",
    ])
    story.append(Paragraph("各診次現場掛號開始時間", h3))
    reg = [
        ['診次', '現場掛號開始', '看診時間'],
        ['早診', '08:00', '08:00 起'],
        ['午診', '14:30', '14:30 起'],
        ['晚診', '18:00', '18:30 起'],
    ]
    rt = Table(reg, colWidths=[30 * mm, 45 * mm, 45 * mm])
    rt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'TCB'), ('FONTNAME', (0, 1), (0, -1), 'TCB'),
        ('FONTNAME', (1, 1), (-1, -1), 'TC'), ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 0), (-1, 0), GREEN), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('TEXTCOLOR', (0, 1), (0, -1), GREEN), ('BACKGROUND', (0, 1), (0, -1), BGGREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, LGREEN), ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(rt)
    story.append(Paragraph(
        "以上為現場掛號（到櫃檯抽號）的受理時間，平日與週六、週日相同。網路預約的開放與截止"
        "時間不同，見第七章「網路預約規則」。", note))
    story.append(Spacer(1, 4))
    story.append(notice_box(
        "【2026 年 9 月 1 日起醫師排班異動】",
        "各診次的<b>開診時段不變</b>，異動的是醫師排班：週四下午改由李醫師看診、"
        "週五下午改由蔡醫師看診；週一晚診蔡醫師看診至 21:00、李醫師看診至 21:30；"
        "週日上午蔡醫師看診至 11:00、李醫師看診至 11:30。8 月 31 日前仍依原排班。"
        "各診次的看診醫師以官網首頁門診時間表與網路預約系統顯示為準。",
        bg='#f0f7ed', border='#A8C69F', title_color=GREEN))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "【即時看診進度查詢】建議就診前先查詢即時看診進度，在家等候快到號再出門，"
        "減少候診區停留時間。查詢網址：%s" % url(PROGRESS), note))
    story.append(PageBreak())

    # ========== 五、院內專業設備 ==========
    story += section('sec05', '五、院內專業設備')
    story.append(Paragraph("立欣診所院內備有下列檢測與治療設備：", body))
    story.append(Paragraph("1. 肺功能檢測儀（MIR Minispir 肺量計）", h3))
    story.append(Paragraph(
        "用途：客觀量化評估兒童氣喘與慢性久咳的氣道狀況。可量測第一秒用力呼氣量（FEV1）、"
        "用力肺活量（FVC）、尖峰呼氣流速（PEF），並比較支氣管擴張劑使用前後的變化；"
        "機器內建兒童吹氣動畫引導，有助孩子放鬆配合完成檢查。適用對象：", body))
    story += bl([
        "疑似氣喘的兒童",
        "慢性久咳超過 4 週的孩子",
        "已確診氣喘、需追蹤治療反應的兒童",
        "運動後容易喘鳴或呼吸困難的孩子",
        "成人慢性咳嗽鑑別診斷",
    ])
    story.append(Paragraph(
        "檢查需要孩子配合用力吸氣再快速吹氣，一般約 5～6 歲以上較能順利完成；年紀更小的孩子，"
        "醫師會以症狀型態、發作頻率、病史與理學檢查評估，不一定需要肺量計。是否安排檢查、"
        "數值如何判讀，由醫師依個別狀況評估。", body))
    story.append(Paragraph("2. InBody 270 身體組成分析儀", h3))
    story.append(Paragraph(
        "用途：科學減重門診的身體組成評估。分析項目包含體脂率、基礎代謝率（BMR）、肌肉量與分布、"
        "身體水分、內臟脂肪等級與節段性分析。建議減重過程中每 4 至 6 週追蹤一次。", body))
    story.append(Paragraph("3. 全自動尿液分析儀", h3))
    story.append(Paragraph(
        "用於尿路感染、血尿、蛋白尿等的門診初步檢查，協助醫師判斷是否需要進一步檢驗或轉介。", body))
    story.append(Paragraph("4. 超音波噴霧治療器", h3))
    story.append(Paragraph(
        "用於呼吸道症狀的噴霧治療，協助緩解鼻腔與呼吸道不適，是否使用由醫師依症狀評估。", body))
    story.append(Paragraph("5. 耳鼻喉治療台", h3))
    story.append(Paragraph(
        "用於鼻腔、咽喉與耳部的檢查與處置，包含耳垢清理、淺層魚刺取出等。需專科進一步處置者"
        "協助轉介。", body))
    story.append(PageBreak())

    # ========== 六、為什麼選擇立欣診所 ==========
    story += section('sec06', '六、為什麼選擇立欣診所')
    for n, t_, d_ in [
        ("1", "醫學中心訓練的專業背景",
         "蔡宗儒院長具成大、新光、馬偕、輔大等醫學中心兒科訓練，並在馬偕兒童醫院完成兒童過敏"
         "氣喘免疫風濕科次專科研究訓練；李佳玲醫師具國泰綜合醫院新生兒次專科訓練。"
         "兩位皆為臺灣兒科醫學會認證的兒科專科醫師。"),
        ("2", "暖心照護的看診態度",
         "「不催促看診」是核心承諾。每位病患都有充分時間說明症狀，醫師耐心傾聽，"
         "用淺白方式說明診斷與治療方向。"),
        ("3", "兒童友善的候診環境",
         "融入卡通主題與童趣元素，設置專屬兒童遊戲區，降低就醫緊張感。"),
        ("4", "全週門診的便利性",
         "週一至週日七天門診，平日夜診至21:30，週六全天、週日上午與夜間均有診，適合雙薪家庭。"),
        ("5", "院內檢測設備",
         "肺功能檢測儀讓氣喘與久咳評估有客觀依據；InBody 270 讓減重有量化數據；"
         "另備尿液分析儀、超音波噴霧治療器與耳鼻喉治療台。"),
        ("6", "精準用藥的原則",
         "依個人體質與症狀調整藥物，不開過強的藥；兒童用藥特別謹慎。"),
        ("7", "免排隊的就醫流程",
         "網路時段預約 24 小時都能操作，門診時間也可來電由櫃檯代訂；搭配免排雲端（MainPI）"
         "看診進度查詢，在家等候快到號再出門。"),
        ("8", "透明的自費資訊",
         "自費費用、疫苗供貨狀況均事先告知，不模糊收費。"),
    ]:
        story.append(Paragraph("【%s】%s" % (n, t_), h3))
        story.append(Paragraph(d_, bullet))
    story.append(PageBreak())

    # ========== 七、預約掛號與看診流程 ==========
    story += section('sec07', '七、預約掛號與看診流程')
    story.append(Paragraph("三種就診方式", h2))
    story += bl([
        "<b>網路時段預約</b>：%s。每 30 分鐘為一個時段、每個時段一組名額。"
        "LINE 選單與看診進度頁的預約按鈕，都是連到同一個系統。" % url(BOOKING, '網路預約系統'),
        "<b>電話（櫃檯代訂）</b>：門診時間來電 06-2516086，由櫃檯人員代您操作同一套系統，"
        "名額、時段與規則完全相同。",
        "<b>現場掛號</b>：未預約可直接到診抽號（現場號）。到診前先查即時看診進度，"
        "抓準時間再出發。",
    ])
    story.append(Paragraph("網路預約規則", h2))
    story.append(Paragraph("什麼時候可以約", sub_h))
    story += bl([
        "每日 00:00 釋出第 14 天的時段，可預約範圍為未來 14 天內。",
        "網路預約請在該時段開始的 4 小時前完成。",
        "距離不足 4 小時：請在該診次開診前來電，由櫃檯協助預約。",
        "該診次開診後就不再受理該診次的預約，請直接到院現場掛號候診。",
    ])
    story.append(Paragraph("報到只保留 10 分鐘", sub_h))
    story += bl([
        "網路上完成預約是先保留該時段的名額，到診所櫃檯完成報到後才算正式掛號。",
        "請於預約時段開始後 10 分鐘內完成報到（例：預約 19:00，請於 19:10 前到櫃檯），"
        "建議提早 5–10 分鐘到院。",
        "報到時請主動告知櫃檯您有預約並出示健保卡；系統不會自動跳出通知。",
        "逾時該筆預約即取消，需重新抽現場號依序候診。",
    ])
    story.append(Paragraph("取消、改期與名額", sub_h))
    story += bl([
        "該診次開診前，都可以在預約系統自行取消或改期；開診後就無法再取消當診的預約。",
        "開診後臨時不能來、當天也沒有到診，這筆會列為 1 次未到；累計 3 次未到將暫停網路預約資格"
        " 3 個月，期間仍可到院現場掛號。",
        "逾時報到但當天仍有來看診：重新抽現場號後由櫃檯註記，不列為未到。",
        "每個預約帳號同時最多保留 2 筆尚未完成的預約（當日的預約不計入）。",
        "同一家庭、同一診次有 2 位以上要看診時，由 1 位成員代表預約 1 個時段即可，"
        "到診後一起報到、依序看診（兒童發展篩檢門診除外）。",
    ])
    story.append(Paragraph(
        "完整規則見官網「就診指南」：%s" % url(SITE + '/visit-guide.html'), note))
    story.append(Paragraph("看診順序與過號", h2))
    story.append(Paragraph(
        "看診時預約號與現場號交錯叫號，預約號會在該時段內依序安排，遇特殊狀況可能順延。"
        "建議於預估看診號前 3–5 組回到現場等候。", body))
    story.append(notice_box(
        "【過號了怎麼辦】",
        "叫號時連續叫兩次、約一分鐘仍未進診間，該號即列為過號。回到診所後請先至櫃檯"
        "<b>重新報到</b>；沒有重新報到的號碼，不會自動排回候診序列。過號後的順位依重新報到的"
        "先後順序計算，與原本的掛號號碼無關：第 1 位過號者從重新報到後的下一個現場號起算，"
        "至少等候 5 組現場病人；同時有多位過號者，依重新報到順序排列，每位之間再間隔 3 組"
        "現場病人（皆不含預約號）。重新報到後請留在現場，若再次叫號時不在，需重新排入過號順位。"))
    story.append(Paragraph(
        "孩子出現呼吸困難、抽搐、意識改變或精神活力明顯變差，請直接告知櫃檯，由護理人員先行評估，"
        "不受一般過號順序限制；情況危急請直接撥打 119 或前往鄰近急診。", note))
    story.append(Paragraph("看診流程", h2))
    flow = [
        ['1. 預約或現場掛號', '網路預約系統、來電由櫃檯代訂，或直接到院抽現場號。'],
        ['2. 查詢即時看診進度', '就診當天查詢 MainPI 看診進度，在家等候快到號再出門。'],
        ['3. 抵達診所報到', '預約者請於時段開始後 10 分鐘內到櫃檯報到並主動告知有預約；'
                       '攜帶健保卡，兒童初診請帶兒童健康手冊（黃卡）。'],
        ['4. 候診', '兒童可至遊戲區等候，降低緊張感。'],
        ['5. 醫師問診與診療', '醫師詳細詢問病史與症狀，必要時安排檢查；不催促看診。'],
        ['6. 結帳與領藥', '健保病患持卡結帳，自費項目清楚說明後結帳；院內備有藥局服務。'],
        ['7. 後續追蹤', '依病情安排回診，或加入 LINE 接收後續衛教資訊。'],
    ]
    flow_key = S('flow_key', fontName='TCB', fontSize=9, textColor=GREEN, leading=13)
    flow_val = S('flow_val', fontName='TC', fontSize=9, textColor=DARK, leading=13)
    ft = Table([[Paragraph(k, flow_key), Paragraph(v, flow_val)] for k, v in flow],
               colWidths=[42 * mm, 108 * mm])
    ft.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('GRID', (0, 0), (-1, -1), 0.5, LGREEN),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, colors.HexColor('#fafbfa')]),
    ]))
    story.append(ft)
    story.append(PageBreak())

    # ========== 八、衛教文章 ==========
    story += section('sec08', '八、衛教文章')
    story.append(Paragraph(
        "立欣診所官網提供由本院醫師（蔡宗儒院長、李佳玲醫師）撰寫或審閱的衛教文章共 43 篇，"
        "涵蓋兒童過敏氣喘、感染症、疫苗資訊、新生兒照護與成人健康。文章皆參考衛生福利部疾管署、"
        "國民健康署、兒科醫學會等官方來源整理。", body))
    story.append(Spacer(1, 3))
    story.append(Paragraph("蔡宗儒院長專欄｜兒童過敏氣喘與常見疾病照護（25 篇）",
                           S('col1', fontName='TCB', fontSize=10.5, textColor=GREEN,
                             spaceBefore=4, spaceAfter=4)))
    story.append(art_table(ARTICLES_TSAI))
    story.append(Paragraph("李佳玲醫師專欄｜新生兒與嬰幼兒照護（11 篇）",
                           S('col2', fontName='TCB', fontSize=10.5, textColor=GREEN,
                             spaceBefore=10, spaceAfter=4)))
    story.append(art_table(ARTICLES_LEE))
    story.append(Paragraph("蔡宗儒院長專欄｜家庭醫學・成人健康（7 篇）",
                           S('col3', fontName='TCB', fontSize=10.5, textColor=GREEN,
                             spaceBefore=10, spaceAfter=4)))
    story.append(art_table(ARTICLES_ADULT))
    story.append(Spacer(1, 6))
    tool_note = Table([
        [Paragraph("線上工具｜兒童生長曲線評估",
                   S('tnt', fontName='TCB', fontSize=9.5, textColor=GREEN, leading=14))],
        [Paragraph("官網另提供免費「兒童生長曲線評估工具」，內建 WHO 與國健署生長標準、"
                   "支援早產兒矯正年齡，可繪製身高／體重／頭圍趨勢並列印小卡；"
                   "紀錄僅存於使用者手機、不上傳。網址：%s"
                   % url(SITE + '/growth.html', 'lhpedclinic.com.tw/growth.html'),
                   S('tntb', fontName='TC', fontSize=8.5, textColor=DARK, leading=13))],
    ], colWidths=[150 * mm])
    tool_note.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BGGREEN), ('BOX', (0, 0), (-1, -1), 0.5, LGREEN),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(KeepTogether(tool_note))
    story.append(Paragraph(
        "完整文章與季節性衛教主題（流感疫苗、腸病毒、新冠等最新消息）請見官網 %s"
        % url(SITE), note))
    story.append(PageBreak())

    # ========== 九、FAQ ==========
    story += section('sec09', '九、常見問題 FAQ')
    faqs1 = [
        ("Q1: 立欣診所是健保特約診所嗎？",
         "是的。立欣診所為衛生福利部中央健康保險署健保特約醫療機構，持有效健保卡就診，"
         "一般兒科及家庭醫學服務依健保規定給付。部分自費項目（如自費疫苗、自費過敏原檢測、"
         "科學減重門診與 InBody 分析）費用另計。"),
        ("Q2: 立欣診所怎麼預約掛號？",
         "採網路時段預約，每 30 分鐘一個時段、每個時段一組名額。可至網路預約系統 "
         "lhpedclinic.booknow.com.tw 預約（LINE 選單與看診進度頁的預約按鈕都連到同一個系統），"
         "或在門診時間來電 06-2516086 由櫃檯人員代為操作。看診日前 14 天開放預約，"
         "請於時段開始 4 小時前完成；完成預約後仍須到櫃檯報到才算正式掛號。"),
        ("Q3: 幾點開始現場掛號？早診、午診、晚診的掛號時間？",
         "各診次現場掛號（到櫃檯抽號）開始時間為早診 08:00、午診 14:30、晚診 18:00，"
         "平日與週六、週日都一樣。晚診 18:00 開始掛號、18:30 開始看診；早診與午診的掛號時間"
         "與看診時間相同。"),
        ("Q4: 預約後多久要到？逾時會怎樣？",
         "請於預約時段開始後 10 分鐘內到櫃檯報到（例：預約 19:00，請於 19:10 前到），"
         "建議提早 5–10 分鐘到院，並主動告知櫃檯您有預約。逾時該筆預約即取消，"
         "需重新抽現場號依序候診。"),
        ("Q5: 過號了怎麼辦？要重新掛號嗎？",
         "不需要重新掛號，但要先至櫃檯重新報到；沒有重新報到的號碼不會自動排回候診序列。"
         "順位依重新報到的先後順序計算：第 1 位過號者至少等候 5 組現場病人，"
         "同時有多位過號者每位之間再間隔 3 組（皆不含預約號）。"),
        ("Q6: 第一次帶孩子來看診需要準備什麼？",
         "建議攜帶：（1）孩子的健保卡；（2）兒童健康手冊（黃卡）；（3）過去接種或就診紀錄；"
         "（4）目前服用藥物清單。"),
        ("Q7: 孩子發燒幾度需要就醫？",
         "3 個月以下嬰兒超過 38°C 應立即就醫；3 個月至 3 歲超過 39°C 或發燒超過 24 小時建議就診；"
         "3 歲以上發燒超過 3 天、伴隨意識改變、抽搐或呼吸急促時需就醫。退燒後孩子的精神狀態"
         "比體溫更重要。"),
        ("Q8: 兒童過敏該掛哪一科？",
         "兒童過敏（氣喘、過敏性鼻炎、異位性皮膚炎）建議掛小兒科，並尋找有過敏免疫次專科訓練的"
         "兒科醫師。蔡宗儒院長具馬偕兒童醫院兒童過敏氣喘免疫風濕科研究醫師訓練。"),
    ]
    faqs2 = [
        ("Q9: 兒童氣喘需要長期用藥嗎？",
         "輕度氣喘可能只需發作時用藥；中重度建議規律使用控制型藥物。氣喘以「良好控制」為目標，"
         "部分孩子隨年齡增長氣道成熟，症狀會明顯改善。立欣診所以院內肺功能檢測客觀追蹤治療反應。"),
        ("Q10: 新生兒黃疸需要注意什麼？",
         "新生兒黃疸多為生理性，通常出生後 3–5 天達高峰、約 2 週內消退。若出現過早"
         "（24 小時內）、消退過慢（超過 2 週）或顏色很深需積極評估。李佳玲醫師建議寶寶出院後"
         " 1–2 天回診監測。"),
        ("Q11: 兒童發展篩檢怎麼安排？要帶什麼？",
         "配合國民健康署方案，未滿 7 歲兒童共 6 次公費篩檢，與一般門診使用同一套預約系統，"
         "每個時段只安排 1 位兒童施測。施測時間為週二至週五上午 09:00–11:30、下午 14:30–16:00，"
         "週一僅下午 14:30–16:00。當天請帶健保卡與兒童健康手冊，兩樣缺一即無法施測；"
         "早產的孩子請依矯正年齡挑選對應時段。"),
        ("Q12: 打疫苗要幾點前到？需要先預約嗎？",
         "每日最後一診前 1 小時停止疫苗施打（清點申報作業）：週一至週五 20:30 前、"
         "週六 17:00 前、週日 20:00 前到院。多數自費疫苗現貨供應、不需預約，"
         "但現貨會變動，建議接種前先來電 06-2516086 或 LINE @lhpedclinic 確認；"
         "實際可否接種依醫師當日評估。"),
        ("Q13: 帶狀皰疹疫苗（欣剋疹）適合誰打？",
         "依原廠仿單記載，適用對象為 50 歲以上成人，以及 18 歲以上具免疫低下風險者，"
         "共 2 劑、第 2 劑於第 1 劑後 2–6 個月接種。保護效果依原廠仿單記載，"
         "實際情形依年齡與個人狀況而異，接種前由醫師評估是否適合、有無禁忌。"),
        ("Q14: 立欣診所有提供成人服務嗎？",
         "有的。除兒科外也提供成人家庭醫學照護，包含感冒、腸胃道症狀等一般診療，慢性病"
         "（高血壓、糖尿病、高血脂）的穩定控制與長期追蹤，成人公費健檢、科學減重門診，"
         "以及 HPV、帶狀皰疹等成人疫苗接種。"),
        ("Q15: 科學減重門診費用為何？",
         "為自費項目，費用依診療內容而定。完整評估包含 InBody 270 身體組成分析、血壓量測、"
         "腰圍記錄，必要時安排抽血。費用於就診時透明說明，建議透過 LINE 或來電諮詢當前費用。"),
        ("Q16: 診所附近有停車位嗎？",
         "診所門口設有機車停車格；汽車可停放於鄰近收費停車場或路邊車格。診所鄰近成大醫院、"
         "台南公園與長榮中學，交通便利。"),
        ("Q17: 我可以線上查詢看診進度嗎？",
         "可以。透過免排雲端（MainPI）即時看診進度系統查詢：%s，"
         "顯示目前看診號碼與等候人數。雲端號碼偶有延遲，實際看診號碼以現場報到號碼為準。"
         % url(PROGRESS)),
        ("Q18: 加入 LINE 官方帳號有什麼好處？",
         "可以：（1）從選單進入網路預約系統；（2）詢問疫苗現貨；（3）接收季節性衛教資訊"
         "（流感季、腸病毒季提醒）；（4）了解國定假日與颱風天的門診異動。"),
    ]
    for q, a in faqs1 + faqs2:
        story.append(KeepTogether([Paragraph(q, h3), Paragraph(a, bullet)]))
    story.append(PageBreak())

    # ========== 十、就診前準備事項 ==========
    story += section('sec10', '十、就診前準備事項')
    story.append(Paragraph("兒科就診", h3))
    story += bl([
        "必備：兒童健保卡、兒童健康手冊（黃卡）",
        "建議攜帶：過去接種紀錄、病歷或檢驗報告、目前服用藥物名稱",
        "口頭整理：症狀開始時間、最高體溫、症狀變化、飲食與睡眠狀況",
        "過敏兒童：已知過敏原清單、發作頻率、目前使用的過敏藥",
        "氣喘評估：近 1 個月發作頻率、夜咳次數、運動後是否喘鳴",
    ])
    story.append(Paragraph("新生兒回診", h3))
    story += bl([
        "必備：嬰兒健保卡、兒童健康手冊（黃卡）",
        "新生兒黃疸：出生醫院出院時的黃疸值紀錄",
        "餵食記錄：每日餵食次數、每次奶量、解便與小便次數",
        "哺乳問題：母乳或配方奶種類、是否有溢奶或吐奶",
    ])
    story.append(Paragraph("兒童發展篩檢", h3))
    story += bl([
        "必備：健保卡與兒童健康手冊，兩樣缺一即無法施測",
        "早產的孩子請依矯正年齡（不是出生後的實際月齡）挑選對應時段",
        "每個時段只安排 1 位兒童；家中有 2 位兒童要施測，請分別預約 2 個時段",
    ])
    story.append(Paragraph("成人科學減重初診", h3))
    story += bl([
        "建議穿著輕便服裝（InBody 測量需要）",
        "避免測量前 2 小時內大量進食、運動、洗澡",
        "建議攜帶近 3 個月血液檢查報告、目前服用藥物清單",
        "口頭整理：過去減重經驗、飲食／運動／睡眠習慣",
    ])
    story.append(Paragraph("自費疫苗接種", h3))
    story += bl([
        "事前來電 06-2516086 或 LINE 確認當日疫苗現貨",
        "必備：健保卡、兒童健康手冊（黃卡，兒童適用）",
        "到院時間：每日最後一診前 1 小時停止施打（平日 20:30 前、週六 17:00 前、"
        "週日 20:00 前），請提早抵達",
        "接種後於診所觀察 15–30 分鐘後再離開",
    ])
    story.append(PageBreak())

    # ========== 十一、聯絡資訊與交通 ==========
    story += section('sec11', '十一、聯絡資訊與交通')
    story.append(Paragraph("聯絡方式", h2))
    contact = [
        ['院址', '台南市北區育德路 467 號'],
        ['電話', '06-2516086'],
        ['LINE 官方帳號', '@lhpedclinic'],
        ['LINE 連結', url('https://line.me/R/ti/p/@lhpedclinic')],
        ['官方網站', url(SITE)],
        ['網路預約系統', url(BOOKING)],
        ['即時看診進度', url(PROGRESS)],
        ['電子郵件', 'lhpedclinic@gmail.com'],
        ['Facebook', url('https://www.facebook.com/lhpedclinic')],
        ['Instagram', '@lhpedclinic'],
        ['Google 評價', '★ 5.0 星｜搜尋「立欣診所 台南」'],
    ]
    ct_key = S('ct_key', fontName='TCB', fontSize=9.5, textColor=GREEN, leading=13)
    ct_val = S('ct_val', fontName='TC', fontSize=9.5, textColor=DARK, leading=13)
    ct = Table([[Paragraph(k, ct_key), Paragraph(v, ct_val)] for k, v in contact],
               colWidths=[40 * mm, 110 * mm])
    ct.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), BGGREEN), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, LGREEN), ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(ct)
    story.append(Paragraph("交通資訊", h2))
    story.append(Paragraph(
        "<b>開車前往</b>：診所位於育德路 467 號，鄰近成大醫院、台南公園與長榮中學，"
        "周邊有路邊停車格與民營停車場。建議用 Google 地圖搜尋「立欣診所」導航。", bullet))
    story.append(Paragraph("<b>機車前往</b>：診所門口設有機車停車格。", bullet))
    story.append(Paragraph(
        "<b>大眾運輸</b>：可搭台南市公車於台南公園或成大醫院站下車，步行約 5–10 分鐘抵達。",
        bullet))
    story.append(Paragraph("服務區域", h2))
    story.append(Paragraph(
        "立欣診所主要服務範圍涵蓋：台南市北區、東區、中西區、永康區、安南區、南區、仁德區"
        "等地區居民。", body))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=LGREEN))
    story.append(Paragraph(
        "醫療廣告暨衛教資訊聲明：本文件為衛生福利部健保特約醫療機構「立欣診所」之公開介紹資料，"
        "由蔡宗儒院長審閱發布。所有醫療衛教內容僅供一般參考，不構成醫療診斷建議；實際診斷與治療"
        "請至診所由醫師面診評估。疫苗、藥物之適用對象與保護效力依原廠仿單記載，個別效果因人而異，"
        "並有副作用風險。本院為一般門診、非急診機構；急重症請撥打 119 或前往鄰近醫院急診。"
        "門診時間、醫師排班與疫苗現貨可能調整，實際以官網公告與 LINE 官方帳號為準。"
        "文件版本：%s更新版。" % DOC_VERSION, note))
    return story


# ────────────────────────────── 建置 ──────────────────────────────
def build(out_path):
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    def make_doc():
        return SimpleDocTemplate(
            out_path, pagesize=A4,
            topMargin=22 * mm, bottomMargin=18 * mm, leftMargin=20 * mm, rightMargin=20 * mm,
            title='立欣診所完整介紹 %s' % DOC_VERSION, author='立欣診所 蔡宗儒院長',
            subject='立欣診所（台南市北區小兒科・家庭醫學）診所簡介、醫療團隊、服務項目、'
                    '門診時間、預約掛號、衛教文章、常見問題與聯絡資訊',
            keywords=['立欣診所', '台南小兒科', '台南北區兒科', '兒童過敏氣喘', '新生兒照護',
                      '疫苗接種', '家庭醫學', '科學減重', '假日兒科', '夜間門診'],
            creator='internal/tools/build_pdf.py')

    # 第一趟：取得各章節真實頁碼（目錄此時為空白頁碼）
    make_doc().build(build_story(), onFirstPage=header_footer, onLaterPages=header_footer)
    first_pass = dict(SECTION_PAGES)

    # 第二趟：帶著頁碼重建；目錄多一行不會位移（目錄長度固定）
    doc = make_doc()
    doc.build(build_story(), onFirstPage=header_footer, onLaterPages=header_footer)

    if first_pass != SECTION_PAGES:
        print("⚠️ 兩趟頁碼不一致，目錄可能失準：", first_pass, SECTION_PAGES)
    return doc.page


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    pages = build(out)
    print("✅ PDF 已生成：%s（共 %d 頁）" % (out, pages))
    print("   章節頁碼：" + "、".join("%s=%s" % (n, SECTION_PAGES.get(k, '?'))
                                  for k, n in SECTIONS))
