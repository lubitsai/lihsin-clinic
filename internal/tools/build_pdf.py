# -*- coding: utf-8 -*-
"""立欣診所完整介紹 PDF 重製腳本（2026年7月更新版）
2026-07 更新：①次專科合規措辭（服務標題去「次專科服務」、資歷表李醫師補「研究醫師」）
②學會名稱正名（台灣兒童過敏氣喘免疫及風濕病醫學會）③衛教文章 8→21 篇（依官網結構分蔡/李專欄）
④選配：growth 生長曲線工具、聯絡 email、就診指南頁、小鹿醫師團隊副品牌、非急診註記
字型：原指定 NotoTC-Reg/Bold.ttf 不存在，改用系統 Noto Sans CJK TC（Regular/Bold，subfontIndex=3）"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, HRFlowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# 字型：Noto Sans TC（與現行文件同家族）。請將 NotoTC-Reg.ttf / NotoTC-Bold.ttf 置於本腳本同目錄。
# （備註：2026-07 建置環境無此兩檔，改由官方 Noto Sans TC variable font 產生 wght=400/700 靜態實例後套用，字面一致。）
pdfmetrics.registerFont(TTFont('TC', 'NotoTC-Reg.ttf'))
pdfmetrics.registerFont(TTFont('TCB', 'NotoTC-Bold.ttf'))

GREEN = colors.HexColor('#7C9A6E')
LGREEN = colors.HexColor('#A8C69F')
BGGREEN = colors.HexColor('#f0f7ed')
GOLD = colors.HexColor('#D4B896')
DARK = colors.HexColor('#333333')
GRAY = colors.HexColor('#666666')
RED = colors.HexColor('#c0392b')

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, **kw)

h1 = S('h1', fontName='TCB', fontSize=20, textColor=GREEN, spaceAfter=10, spaceBefore=4, leading=26)
h2 = S('h2', fontName='TCB', fontSize=14, textColor=GREEN, spaceAfter=7, spaceBefore=10, leading=20)
h3 = S('h3', fontName='TCB', fontSize=11.5, textColor=DARK, spaceAfter=4, spaceBefore=6, leading=16)
body = S('body', fontName='TC', fontSize=10, textColor=DARK, leading=16, spaceAfter=5)
bullet = S('bullet', fontName='TC', fontSize=10, textColor=DARK, leading=15.5, spaceAfter=2.5, leftIndent=10)
small = S('small', fontName='TC', fontSize=8, textColor=GRAY, leading=12)
note = S('note', fontName='TC', fontSize=8.5, textColor=GRAY, leading=13, spaceAfter=3)
center_title = S('ct', fontName='TCB', fontSize=30, textColor=GREEN, alignment=1, leading=40, spaceAfter=6)
center_sub = S('cs', fontName='TC', fontSize=13, textColor=GRAY, alignment=1, leading=20, spaceAfter=4)

HEADER = "立欣診所 LiHsin Clinic ｜ 台南市北區小兒科・家庭醫學　https://lhpedclinic.com.tw"
FOOTER1 = "台南市北區育德路467號 ｜ 06-2516086 ｜ LINE: @lhpedclinic"
FOOTER2 = "衛生福利部健保特約醫療機構 ｜ 本文件由蔡宗儒院長審閱 ｜ 文件版本：2026年7月（更新版）"

def header_footer(canvas, doc):
    canvas.saveState()
    # Header
    canvas.setFont('TC', 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(20*mm, 285*mm, HEADER)
    canvas.setStrokeColor(LGREEN)
    canvas.setLineWidth(0.5)
    canvas.line(20*mm, 283*mm, 190*mm, 283*mm)
    # Footer
    canvas.setStrokeColor(LGREEN)
    canvas.line(20*mm, 15*mm, 190*mm, 15*mm)
    canvas.setFont('TC', 7.5)
    canvas.setFillColor(GRAY)
    pg = canvas.getPageNumber()
    canvas.drawString(20*mm, 11.5*mm, FOOTER1)
    canvas.drawRightString(190*mm, 11.5*mm, f"- {pg} -")
    canvas.setFont('TC', 6.5)
    canvas.drawString(20*mm, 8.5*mm, FOOTER2)
    canvas.restoreState()

def bl(items, st=bullet):
    return [Paragraph(f"• {x}", st) for x in items]

story = []

# ========== 第 1 頁：封面 ==========
story.append(Spacer(1, 50))
story.append(Paragraph("立 欣 診 所", center_title))
story.append(Paragraph("LiHsin Clinic", S('en', fontName='TCB', fontSize=18, textColor=LGREEN, alignment=1, spaceAfter=20)))
story.append(HRFlowable(width="40%", thickness=2, color=GOLD, spaceAfter=20, spaceBefore=4, hAlign='CENTER'))
story.append(Paragraph("醫學中心訓練的兒科醫師", center_sub))
story.append(Paragraph("家門口的暖心照護", center_sub))
story.append(Spacer(1, 8))
story.append(Paragraph("小鹿醫師團隊　The Little Deer Doctor Team", S('subbrand', fontName='TCB', fontSize=11, textColor=GOLD, alignment=1, leading=16, spaceAfter=4)))
story.append(Spacer(1, 22))
cover_data = [
    ['院　址', '台南市北區育德路467號'],
    ['電　話', '06-2516086'],
    ['L I N E', '@lhpedclinic'],
    ['官　網', 'https://lhpedclinic.com.tw'],
    ['開業日期', '2024年7月1日'],
    ['Google 評價', '★ 5.0 星（衛福部健保特約醫療機構）'],
]
t = Table(cover_data, colWidths=[35*mm, 110*mm])
t.setStyle(TableStyle([
    ('FONTNAME',(0,0),(0,-1),'TCB'),('FONTNAME',(1,0),(1,-1),'TC'),
    ('FONTSIZE',(0,0),(-1,-1),11),('TEXTCOLOR',(0,0),(0,-1),GREEN),
    ('TEXTCOLOR',(1,0),(1,-1),DARK),('BACKGROUND',(0,0),(0,-1),BGGREEN),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),7),
    ('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),12),
    ('GRID',(0,0),(-1,-1),0.5,colors.white),('ROWBACKGROUNDS',(1,0),(1,-1),[colors.HexColor('#fafbfa')]),
]))
story.append(t)
story.append(Spacer(1, 30))
story.append(Paragraph("本文件為立欣診所公開介紹資料，提供家長、媒體、AI 搜尋引擎與合作夥伴參考。", S('cov', fontName='TC', fontSize=9, textColor=GRAY, alignment=1, leading=14)))
story.append(PageBreak())

# ========== 第 2 頁：目錄 ==========
story.append(Paragraph("目 錄", h1))
story.append(Spacer(1, 6))
toc = [
    ('一、診所簡介','3'),('二、醫療團隊','4'),('三、服務項目','7'),
    ('四、門診時間','10'),('五、院內專業設備','11'),('六、為什麼選擇立欣診所','12'),
    ('七、預約掛號與看診流程','13'),('八、衛教文章','14'),('九、常見問題 FAQ','16'),
    ('十、就診前準備事項','18'),('十一、聯絡資訊與交通','19'),
]
for name, pg in toc:
    story.append(Paragraph(f"{name}{'　'*2}……………………………………………………　{pg}", S('toc', fontName='TC', fontSize=11.5, textColor=DARK, leading=26)))
story.append(PageBreak())

# ========== 第 3 頁：診所簡介 ==========
story.append(Paragraph("一、診所簡介", h1))
story.append(Paragraph("關於立欣診所", h2))
story.append(Paragraph("立欣診所（LiHsin Clinic）是位於台灣台南市北區育德路467號的小兒科與家庭醫學診所，於2024年7月1日正式開業，為衛生福利部中央健康保險署特約醫療機構。診所由具有馬偕兒童醫院兒童過敏氣喘免疫風濕科研究醫師訓練背景的蔡宗儒院長主持，並由具國泰醫院新生兒次專科研究醫師訓練的李佳玲醫師擔任主治醫師，為台南北區家庭提供完整的兒童與成人醫療照護。Google 評價 5.0 星，深受在地家長信任。", body))
story.append(Paragraph("立欣診所的特色", h2))
for t_, d_ in [
    ("醫學中心訓練的兒科醫師","蔡宗儒院長具馬偕兒童醫院兒童過敏氣喘免疫風濕科研究醫師訓練，為台南北區基層診所中具備過敏免疫次專科訓練背景的兒科醫師之一。"),
    ("院內肺功能檢測儀（Spirometer）","為兒童氣喘提供客觀量化的評估，協助醫師判斷氣道阻塞程度與可逆性，不必僅依賴症狀描述進行診斷。"),
    ("InBody 身體組成分析儀","用於科學減重門診，提供體脂率、基礎代謝率、肌肉量等精準數據，讓減重有客觀的起點與追蹤依據。"),
    ("週一至週日七天門診","平日提供上午、下午、夜診三段門診（夜診開診至21:30）；週六、週日均有門診，便於雙薪家庭就診。"),
    ("公費與自費疫苗完整供應","兒童公費疫苗依國家接種時程提供，自費疫苗包含輪狀病毒、腸病毒71型、B型腦脊髓膜炎（Bexsero）、15價肺炎鏈球菌、RSV單株抗體、HPV、帶狀皰疹疫苗（欣剋疹）等多元選擇。"),
    ("兒童友善的候診空間","設置兒童遊戲區與卡通主題佈置，降低孩子就醫緊張感。"),
]:
    story.append(Paragraph(f"• <b>{t_}</b>", h3))
    story.append(Paragraph(d_, bullet))
story.append(Paragraph("服務區域", h2))
story.append(Paragraph("立欣診所主要服務台南市北區、東區、中西區、永康區、安南區、南區、仁德區等地區居民。診所位置鄰近成大醫院、台南公園，交通便利。", body))
story.append(PageBreak())

# ========== 第 4 頁：醫療團隊-蔡 ==========
story.append(Paragraph("二、醫療團隊", h1))
story.append(Paragraph("蔡宗儒 院長", h2))
story.append(Paragraph("專長：兒童過敏、氣喘、一般兒科、肥胖醫學", S('sp', fontName='TCB', fontSize=10, textColor=GOLD, spaceAfter=6)))
story.append(Paragraph("學經歷", h3))
story += bl([
    "中國醫藥大學 醫學士暨公共衛生碩士","成大醫院 兒科住院醫師","新光醫院 兒科總醫師",
    "台北馬偕醫院 兒童過敏氣喘免疫風濕科研究醫師","天主教輔仁大學醫院 兒科主治醫師",
    "日本順天堂大學醫院 兒科臨床進修","台灣肥胖醫學會 醫師","台灣兒科醫學會 會員",
    "台灣兒童過敏氣喘免疫及風濕病醫學會 會員",
])
story.append(Paragraph("師承：過敏及氣喘師承台北馬偕徐世達教授；異位性皮膚炎師承新光醫院王怜人醫師。", note))
story.append(Paragraph("看診理念", h3))
story.append(Paragraph("「我相信每個孩子都值得被溫柔對待。從診斷到陪伴，我希望成為家長最信任的醫療夥伴，讓每一次就診都是一次安心的體驗。」", S('q', fontName='TC', fontSize=10, textColor=GREEN, leading=16, leftIndent=8, spaceAfter=5)))
story.append(Paragraph("蔡宗儒院長在台北完成醫學中心訓練後返鄉開業，期望將醫學中心級的兒童過敏氣喘照護經驗帶回家鄉台南。診療上強調「不催促看診、不開過強的藥」，重視傾聽家長與孩子的真實狀況。", body))
story.append(PageBreak())

# ========== 第 5 頁：醫療團隊-李 ==========
story.append(Paragraph("李佳玲 主治醫師", h2))
story.append(Paragraph("專長：新生兒照護、一般兒科、小兒成長發育評估", S('sp2', fontName='TCB', fontSize=10, textColor=GOLD, spaceAfter=6)))
story.append(Paragraph("學經歷", h3))
story += bl([
    "國防醫學院 醫學士","國泰綜合醫院 新生兒次專科研究醫師","禾馨民權婦幼診所 兒科醫師",
    "台灣兒科醫學會 會員","台灣新生兒科醫學會 會員",
])
story.append(Paragraph("專業介紹", h3))
story.append(Paragraph("李佳玲醫師具備新生兒次專科研究醫師訓練，專精於新生兒黃疸追蹤、餵食評估（母乳/配方奶）、生長曲線追蹤、早產兒照護等專業領域。對於初為人父母的家庭，能提供從新生兒滿月健檢、副食品添加、語言與動作發展等成長過程的完整照護建議。", body))
story.append(PageBreak())

# ========== 第 6 頁：資歷一覽表 ==========
story.append(Paragraph("醫療團隊資歷一覽表", h1))
story.append(Spacer(1, 6))
team = [
    ['項目','蔡宗儒 院長','李佳玲 主治醫師'],
    ['醫學院','中國醫藥大學\n醫學士暨公衛碩士','國防醫學院\n醫學士'],
    ['醫學中心訓練','成大、新光、馬偕、輔大','國泰綜合醫院'],
    ['次專科訓練','兒童過敏氣喘免疫風濕科\n（馬偕兒童醫院）','新生兒次專科研究醫師\n（國泰綜合醫院）'],
    ['海外進修','日本順天堂大學\n兒科臨床進修','—'],
    ['主要專長','兒童過敏、氣喘\n一般兒科、肥胖醫學','新生兒照護、一般兒科\n小兒成長發育'],
    ['學會會員','兒科醫學會、肥胖醫學會、\n過敏氣喘免疫及風濕病醫學會','兒科醫學會\n新生兒科醫學會'],
]
tt = Table(team, colWidths=[30*mm, 60*mm, 60*mm])
tt.setStyle(TableStyle([
    ('FONTNAME',(0,0),(-1,0),'TCB'),('FONTNAME',(0,1),(-1,-1),'TC'),
    ('FONTSIZE',(0,0),(-1,-1),9.5),('BACKGROUND',(0,0),(-1,0),GREEN),
    ('TEXTCOLOR',(0,0),(-1,0),colors.white),('TEXTCOLOR',(0,1),(0,-1),GREEN),
    ('FONTNAME',(0,1),(0,-1),'TCB'),('BACKGROUND',(0,1),(0,-1),BGGREEN),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,0),'CENTER'),
    ('GRID',(0,0),(-1,-1),0.5,LGREEN),('TOPPADDING',(0,0),(-1,-1),8),
    ('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),8),
    ('ROWBACKGROUNDS',(1,1),(-1,-1),[colors.white, colors.HexColor('#fafbfa')]),
]))
story.append(tt)
story.append(PageBreak())

# ========== 第 7 頁：服務項目 1-3 ==========
story.append(Paragraph("三、服務項目", h1))
story.append(Paragraph("各項服務的詳細說明亦可參考官網服務專頁：兒童過敏氣喘門診、假日與夜間兒科、新生兒照護門診、疫苗接種（https://lhpedclinic.com.tw/#services）。", note))
story.append(Paragraph("1. 小兒科一般診療", h3))
story.append(Paragraph("提供 0 歲新生兒至 18 歲青少年的完整兒科照護，包含急性疾病診療（感冒、發燒、腸胃炎、皮膚紅疹等）、慢性疾病追蹤、生長發育評估、健康諮詢等服務。", body))
story.append(Paragraph("2. 兒童過敏氣喘照護", h3))
story.append(Paragraph("由具馬偕兒童醫院兒童過敏氣喘免疫風濕科訓練的蔡宗儒院長主診，提供以下完整評估：", body))
story += bl(["兒童氣喘評估與治療（含肺功能檢測）","過敏性鼻炎照護（含過敏原評估與藥物調整）",
    "異位性皮膚炎照護（含保濕計畫與用藥指導）","食物過敏評估",
    "慢性久咳鑑別診斷（咳嗽變異型氣喘、後鼻滴流、感染後咳嗽等）","個人化氣喘控制計畫（季度追蹤）"])
story.append(Paragraph("3. 新生兒與嬰幼兒照護", h3))
story.append(Paragraph("由具國泰醫院新生兒次專科研究醫師訓練的李佳玲醫師主診，服務內容包含：", body))
story += bl(["新生兒黃疸追蹤評估（建議出院後 1–2 天回診監測）","母乳或配方奶餵食評估與指導",
    "嬰幼兒生長曲線追蹤","早產兒回診照護","副食品添加諮詢（4–6 個月起）","嬰幼兒發展評估（動作、語言、社交里程碑）"])
story.append(PageBreak())

# ========== 第 8 頁：服務 4-5 疫苗+家醫 ==========
story.append(Paragraph("4. 疫苗接種服務", h3))
story.append(Paragraph("公費疫苗（依國家接種時程，免費）", S('vh', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=3)))
story.append(Paragraph("依兒童健康手冊（黃卡）時程提供完整公費疫苗，包含五合一、四合一、13價肺炎鏈球菌、水痘、MMR（麻疹腮腺炎德國麻疹）、A型肝炎、日本腦炎、流感疫苗等。", body))
story.append(Paragraph("自費疫苗（多元選擇・現貨供應）", S('vh2', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=3)))
vac = [
    ['對象','疫苗品項'],
    ['嬰幼兒／兒童','輪狀病毒疫苗、腸病毒71型疫苗、B型腦脊髓膜炎（Bexsero）、\n15價肺炎鏈球菌、RSV單株抗體（樂唯初 Beyfortus）、\nHPV（嘉喜9價）、水痘、流感疫苗等'],
    ['成人／長輩','帶狀皰疹疫苗（欣剋疹）、20價肺炎鏈球菌、MMR、\nTdap（百日咳）、A型/B型肝炎、流感疫苗等'],
]
vt = Table(vac, colWidths=[28*mm, 122*mm])
vt.setStyle(TableStyle([
    ('FONTNAME',(0,0),(-1,0),'TCB'),('FONTNAME',(0,1),(-1,-1),'TC'),('FONTSIZE',(0,0),(-1,-1),9),
    ('BACKGROUND',(0,0),(-1,0),GREEN),('TEXTCOLOR',(0,0),(-1,0),colors.white),
    ('TEXTCOLOR',(0,1),(0,-1),GREEN),('FONTNAME',(0,1),(0,-1),'TCB'),('BACKGROUND',(0,1),(0,-1),BGGREEN),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('GRID',(0,0),(-1,-1),0.5,LGREEN),
    ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),8),
]))
story.append(vt)
story.append(Paragraph("※ 每日最後一診前 1 小時停止疫苗施打；建議自費疫苗接種前先來電 06-2516086 或加 LINE @lhpedclinic 確認當日現貨。", note))
story.append(Paragraph("5. 家庭醫學照護（成人服務）", h3))
story += bl(["成人感冒、咳嗽、腸胃道症狀診療","高血壓、糖尿病、高血脂等慢性病追蹤",
    "公費成人預防保健（成人健檢）","成人疫苗接種（流感、帶狀皰疹、肺炎鏈球菌、HPV 等）","一般健康諮詢"])
story.append(PageBreak())

# ========== 第 9 頁：服務 6 減重 ==========
story.append(Paragraph("6. 科學減重門診", h3))
story.append(Paragraph("由台灣肥胖醫學會醫師蔡宗儒院長主持，採「三位一體科學減重方案」，結合精準評估與個人化規劃：", body))
story.append(Paragraph("第一步：身體組成分析", S('st1', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=2)))
story.append(Paragraph("透過院內 InBody 身體組成分析儀，了解基礎代謝率、體脂率、肌肉量、體水分等客觀數據，建立減重起點。", body))
story.append(Paragraph("第二步：醫師專業評估", S('st2', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=2)))
story.append(Paragraph("由醫師進行個人體質評估，量測血壓、腰圍，必要時安排抽血檢查，確認減重方式與用藥安全性。", body))
story.append(Paragraph("第三步：個人化方案規劃", S('st3', fontName='TCB', fontSize=10, textColor=GREEN, spaceAfter=2)))
story.append(Paragraph("依個人代謝狀況、生活型態、減重目標規劃飲食衛教與運動建議；經醫師完整評估後，必要時搭配核准之減重藥物（須符合適應症）。", body))
story.append(Spacer(1,4))
story.append(Paragraph("關於 GLP-1 類減重藥物：GLP-1 受體促效劑（semaglutide）與雙機轉 GLP-1／GIP 受體促效劑（tirzepatide）等新型代謝藥物，在台灣核准適應症為「第2型糖尿病」之血糖控制。用於體重管理屬仿單外（off-label）使用，須由醫師完整評估 BMI、代謝指標、共病、禁忌症後依個別醫療判斷處方。立欣診所提供醫師面診評估，效果因人而異，並有副作用風險。本資訊為一般醫學衛教，不構成藥品廣告。", note))
story.append(PageBreak())

# ========== 第 10 頁：門診時間 ==========
story.append(Paragraph("四、門診時間", h1))
story.append(Paragraph("立欣診所為台南北區少數平日設有夜診、且週六與週日均有門診的兒科與家庭醫學診所，方便雙薪家庭的就診需求。", body))
story.append(Spacer(1,4))
sched = [
    ['時段','一','二','三','四','五','六','日'],
    ['上午\n08:00–12:00','✓','✓','✓','✓','✓','✓\n至11:30','✓\n至11:30'],
    ['下午\n14:30–18:00','✓','✓','✓','✓','✓','✓','—'],
    ['夜間\n18:30–21:30','✓','✓','✓','✓','✓','—','✓\n至21:00'],
]
st = Table(sched, colWidths=[32*mm]+[16.5*mm]*7)
st.setStyle(TableStyle([
    ('FONTNAME',(0,0),(-1,0),'TCB'),('FONTNAME',(0,1),(0,-1),'TCB'),('FONTNAME',(1,1),(-1,-1),'TC'),
    ('FONTSIZE',(0,0),(-1,-1),9),('BACKGROUND',(0,0),(-1,0),GREEN),('TEXTCOLOR',(0,0),(-1,0),colors.white),
    ('TEXTCOLOR',(0,1),(0,-1),GREEN),('BACKGROUND',(0,1),(0,-1),BGGREEN),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,-1),'CENTER'),
    ('GRID',(0,0),(-1,-1),0.5,LGREEN),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
]))
story.append(st)
story.append(Paragraph("門診時間重點說明", h3))
story += bl(["平日夜診（一至五）：18:30–21:30，方便上班族家長下班後帶孩子就診",
    "週六全天：上午 08:00–11:30、下午 14:30–18:00","週日門診：上午 08:00–11:30、夜間 18:30–21:00",
    "國定假日：請查詢診所 Facebook 或 LINE 官方帳號公告"])
story.append(Paragraph("【即時看診進度查詢】建議就診前先查詢即時看診進度，在家等候快到號再出門，減少候診區交叉感染風險。查詢網址：https://www.mainpi.com/query?i=2935", note))
story.append(Paragraph("【就醫提醒】立欣診所為門診診所，非急診單位。如遇高燒不退合併意識改變、抽搐、呼吸困難、嚴重脫水等危急狀況，請立即撥打 119 或前往鄰近醫院急診就醫。", note))
story.append(PageBreak())

# ========== 第 11 頁：設備 ==========
story.append(Paragraph("五、院內專業設備", h1))
story.append(Paragraph("立欣診所引進專業檢測設備，為台南北區基層診所中少數能提供以下檢查的醫療機構：", body))
story.append(Paragraph("1. 肺功能檢測儀（Spirometer）", h3))
story.append(Paragraph("用途：客觀量化評估兒童氣喘與慢性久咳的氣道狀況。適用對象：", body))
story += bl(["疑似氣喘的兒童（5 歲以上）","慢性久咳超過 4 週的孩子","已確診氣喘、需追蹤治療效果的兒童",
    "運動後容易喘鳴或呼吸困難的孩子","成人慢性咳嗽鑑別診斷"])
story.append(Paragraph("肺功能檢測可測量第一秒用力呼氣量（FEV1）、用力肺活量（FVC）等指標，是國際氣喘準則建議的客觀診斷工具。過去這類檢查多需轉介至醫學中心，立欣診所提供基層診所端的便利檢測。", body))
story.append(Paragraph("2. InBody 身體組成分析儀", h3))
story.append(Paragraph("用途：科學減重門診的精準身體組成評估。分析項目包含體脂率、基礎代謝率（BMR）、肌肉量與分布、身體水分、內臟脂肪等級、節段性分析。建議減重過程中每 4 至 6 週進行一次追蹤。", body))
story.append(PageBreak())

# ========== 第 12 頁：為什麼選擇 ==========
story.append(Paragraph("六、為什麼選擇立欣診所", h1))
for n, t_, d_ in [
    ("1","醫學中心訓練的專業背景","院長蔡宗儒醫師具成大、新光、馬偕、輔大等醫學中心兒科訓練，並在馬偕兒童醫院完成兒童過敏氣喘免疫風濕科次專科研究訓練；李佳玲醫師具國泰綜合醫院新生兒次專科訓練。"),
    ("2","暖心照護的看診態度","「不催促看診」是核心承諾。每位病患都有充分時間說明症狀，醫師耐心傾聽，用淺白方式說明診斷與治療方向。"),
    ("3","兒童友善的候診環境","融入卡通主題與童趣元素，設置專屬兒童遊戲區，降低就醫緊張感。"),
    ("4","全週門診的便利性","週一至週日七天門診，平日夜診至21:30，週六全天、週日上午與夜間均有診，適合雙薪家庭。"),
    ("5","院內專業檢測設備","肺功能檢測儀讓氣喘評估有客觀依據；InBody 讓減重有精準數據。兩項設備在台南北區基層診所相對少見。"),
    ("6","精準用藥的原則","依個人體質與症狀調整藥物，不開過強的藥；兒童用藥特別謹慎。"),
    ("7","透明的自費資訊","自費費用、疫苗供貨狀況均事先告知，不模糊收費。"),
]:
    story.append(Paragraph(f"【{n}】{t_}", h3))
    story.append(Paragraph(d_, bullet))
story.append(PageBreak())

# ========== 第 13 頁：預約掛號（更新10分鐘規則）==========
story.append(Paragraph("七、預約掛號與看診流程", h1))
story.append(Paragraph("預約方式", h2))
story += bl([
    "<b>電話預約</b>：撥打 06-2516086，由診所人員協助登記時段。",
    "<b>LINE 預約</b>：加入官方帳號 @lhpedclinic，線上留言預約。",
    "<b>現場掛號</b>：可現場掛號，但視當日診況可能等候較長，建議先預約。",
])
# 更新重點：10分鐘保留規則（醒目框）
notice = Table([[Paragraph("【重要】預約保留時間提醒", S('nt', fontName='TCB', fontSize=10.5, textColor=RED, leading=15)),],
    [Paragraph("網路或電話預約掛號，預約號為偶數號、每半小時一組。<b>預約時間僅保留 10 分鐘，逾時將取消預約並依現場情況等候</b>，建議提早 5–10 分鐘抵達。現場掛號為奇數號，與預約號交錯看診；若現場號過號，需再等 5 位現場號。", S('ntb', fontName='TC', fontSize=9.5, textColor=DARK, leading=15))]],
    colWidths=[150*mm])
notice.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#fdeeee')),('BOX',(0,0),(-1,-1),1,colors.HexColor('#f5c6c6')),
    ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
]))
story.append(Spacer(1,3)); story.append(notice); story.append(Spacer(1,5))
story.append(Paragraph("看診流程", h2))
flow = [
    ['1. 預約或現場掛號','建議透過電話或 LINE 預約，可大幅縮短等候時間。'],
    ['2. 查詢即時看診進度','掃描診所 QR Code 或瀏覽 mainpi 系統，在家等候快到號再出門。'],
    ['3. 抵達診所報到','建議於看診時段前 10 分鐘抵達，攜帶健保卡至櫃台報到；兒童初診請帶健康手冊（黃卡）。'],
    ['4. 候診','兒童可至遊戲區等候，降低緊張感。'],
    ['5. 醫師問診與診療','醫師詳細詢問病史與症狀，必要時安排檢查；不催促看診。'],
    ['6. 結帳與領藥','健保病患持卡結帳，自費項目清楚說明後結帳；院內備有藥局服務。'],
    ['7. 後續追蹤','依病情安排回診，或加入 LINE 接收後續衛教資訊。'],
]
ft = Table(flow, colWidths=[42*mm, 108*mm])
ft.setStyle(TableStyle([
    ('FONTNAME',(0,0),(0,-1),'TCB'),('FONTNAME',(1,0),(1,-1),'TC'),('FONTSIZE',(0,0),(-1,-1),9),
    ('TEXTCOLOR',(0,0),(0,-1),GREEN),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('GRID',(0,0),(-1,-1),0.5,LGREEN),
    ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),8),
    ('ROWBACKGROUNDS',(0,0),(-1,-1),[colors.white, colors.HexColor('#fafbfa')]),
]))
story.append(ft)
story.append(Paragraph("更完整的掛號方式、看診進度查詢與初診準備說明，請見官網「就診指南」：https://lhpedclinic.com.tw/visit-guide.html", note))
story.append(PageBreak())

# ========== 第 14 頁起：衛教文章（8→21 篇，分蔡/李專欄）==========
story.append(Paragraph("八、衛教文章", h1))
story.append(Paragraph("立欣診所官網提供由本院醫師（蔡宗儒院長、李佳玲醫師）編撰審閱的深度衛教文章共 21 篇，涵蓋兒童過敏氣喘、感染症、疫苗資訊與新生兒照護。所有文章皆參考衛福部疾管署、國健署、兒科醫學會等官方來源整理，提供家長正確、實用的居家照護知識。", body))
story.append(Spacer(1,3))

# 衛教文章表格樣式與建構（內容重點、網址以 Paragraph 換行，避免長網址溢出）
_detail_st = S('artd', fontName='TC', fontSize=8.5, textColor=DARK, leading=11.5)
_url_st = S('arturl', fontName='TC', fontSize=7.5, textColor=GRAY, leading=10)
def art_table(rows):
    data = [['主題','內容重點','官網網址']]
    for topic, detail, url in rows:
        data.append([topic, Paragraph(detail, _detail_st), Paragraph(url, _url_st)])
    t = Table(data, colWidths=[30*mm, 70*mm, 50*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ('FONTNAME',(0,0),(-1,0),'TCB'),('FONTNAME',(0,1),(0,-1),'TCB'),('FONTSIZE',(0,0),(-1,-1),8.5),
        ('BACKGROUND',(0,0),(-1,0),GREEN),('TEXTCOLOR',(0,0),(-1,0),colors.white),
        ('TEXTCOLOR',(0,1),(0,-1),GREEN),('BACKGROUND',(0,1),(0,-1),BGGREEN),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('GRID',(0,0),(-1,-1),0.5,LGREEN),
        ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
        ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
        ('ROWBACKGROUNDS',(1,1),(-1,-1),[colors.white, colors.HexColor('#fafbfa')]),
    ]))
    return t

story.append(Paragraph("蔡宗儒院長專欄（過敏氣喘・感染症・疫苗，14 篇）", S('col1', fontName='TCB', fontSize=10.5, textColor=GREEN, spaceBefore=4, spaceAfter=4)))
story.append(art_table([
    ('認識過敏','過敏體質、常見症狀、過敏原檢測、鼻噴劑保養','/health/allergy.html'),
    ('孩子半夜咳不停\n是氣喘嗎','久咳原因、咳嗽變異型氣喘、肺功能檢測','/health/child-chronic-cough.html'),
    ('如何判斷孩子在喘','聽、數、看三步驟、各年齡呼吸過快門檻、危險徵象','/health/child-wheezing.html'),
    ('黴漿菌肺炎','「會走路的肺炎」症狀、抗藥性、治療重點','/health/mycoplasma-pneumonia.html'),
    ('兒童蕁麻疹','急性與慢性、常見誘因、過敏性休克警訊','/health/child-urticaria.html'),
    ('後鼻滴流','鼻涕倒流與慢性咳嗽的關聯、處理方式','/health/postnasal-drip.html'),
    ('過敏性鼻炎治療','藥物、鼻噴劑使用、居家環境控制','/health/allergic-rhinitis-treatment.html'),
    ('認識塵蟎','防蟎寢具、55℃ 熱水清洗、濕度控制','/health/dust-mite.html'),
    ('異位性皮膚炎','清潔保濕、藥膏使用、居家注意事項','/health/atopic-dermatitis.html'),
    ('腸病毒','症狀、重症四大前兆、酒精無效需用含氯漂白水','/health/enterovirus.html'),
    ('hMPV 人類間質\n肺炎病毒','症狀、與感冒流感鑑別、就醫警訊、預防','/health/hmpv.html'),
    ('麻疹與 MMR 疫苗','傳染力、併發症、出國前 2–4 週接種提醒','/health/measles.html'),
    ('過敏會引起\n偏頭痛嗎','過敏與兒童頭痛的關聯、組織胺、危險徵兆','/health/allergy-headache.html'),
    ('兒童肥胖與\n體重管理','健康體位三寶、不節食不羞辱的體重管理','/health/childhood-obesity.html'),
]))

story.append(Paragraph("李佳玲醫師專欄（新生兒與嬰幼兒照護，7 篇）", S('col2', fontName='TCB', fontSize=10.5, textColor=GREEN, spaceBefore=8, spaceAfter=4)))
story.append(art_table([
    ('新生兒黃疸','生理性與病理性、回診監測時機','/health/newborn-jaundice.html'),
    ('新生兒餵食','母乳/配方奶評估、副食品添加時機','/health/newborn-feeding.html'),
    ('新生兒發燒','三個月以下發燒處置、就醫時機','/health/newborn-fever.html'),
    ('新生兒睡眠安全','仰睡原則、嬰兒猝死症（SIDS）預防','/health/newborn-sleep-safety.html'),
    ('寶寶溢奶吐奶','生理性溢奶、胃食道逆流、拍嗝技巧','/health/baby-spitting-up.html'),
    ('嬰兒腸絞痛','Wessel 333 法則、安撫方法','/health/baby-colic.html'),
    ('嬰幼兒腸胃炎','輪狀/諾羅病毒、脫水警訊、補水原則','/health/infant-gastroenteritis.html'),
]))

story.append(Spacer(1,5))
tool_note = Table([[Paragraph("線上工具｜兒童生長曲線評估", S('tnt', fontName='TCB', fontSize=9.5, textColor=GREEN, leading=14)),],
    [Paragraph("官網另提供免費「兒童生長曲線評估工具」，內建 WHO 與國健署生長標準、支援早產兒矯正年齡，可繪製身高/體重/頭圍趨勢並列印小卡；紀錄僅存於使用者手機、不上傳。網址：https://lhpedclinic.com.tw/growth.html", S('tntb', fontName='TC', fontSize=8.5, textColor=DARK, leading=13))]],
    colWidths=[150*mm])
tool_note.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,-1),BGGREEN),('BOX',(0,0),(-1,-1),0.5,LGREEN),
    ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
]))
story.append(tool_note)
story.append(Paragraph("完整文章請見官網 https://lhpedclinic.com.tw 「衛教知識」專區。診所將持續更新季節性衛教主題。", note))
story.append(PageBreak())

# ========== 第 15-16 頁：FAQ（Q7更新合規）==========
story.append(Paragraph("九、常見問題 FAQ", h1))
faqs1 = [
    ("Q1: 立欣診所是健保特約診所嗎？","是的。立欣診所為衛生福利部中央健康保險署健保特約醫療機構，持有效健保卡就診，一般兒科及家庭醫學服務依健保規定給付。部分自費項目（如自費疫苗、科學減重門診、InBody 分析）費用另計。"),
    ("Q2: 第一次帶孩子來看診需要準備什麼？","建議攜帶：（1）孩子的健保卡；（2）兒童健康手冊（黃卡）；（3）過去接種或就診紀錄；（4）目前服用藥物清單。"),
    ("Q3: 孩子發燒幾度需要就醫？","3 個月以下嬰兒超過 38°C 應立即就醫；3 個月至 3 歲超過 39°C 或發燒超過 24 小時建議就診；3 歲以上發燒超過 3 天、伴隨意識改變、抽搐或呼吸急促時需就醫。退燒後孩子精神狀態比體溫更重要。"),
    ("Q4: 兒童過敏該掛哪一科？","兒童過敏（氣喘、過敏性鼻炎、異位性皮膚炎）建議掛小兒科，並尋找有過敏免疫次專科訓練的兒科醫師。蔡宗儒院長具馬偕兒童醫院兒童過敏氣喘免疫風濕科研究醫師訓練。"),
    ("Q5: 兒童氣喘需要長期用藥嗎？","輕度氣喘可能只需發作時用藥；中重度建議規律使用控制型藥物。部分孩子隨年齡增長氣道成熟，症狀會明顯改善。立欣診所以肺功能檢測客觀追蹤治療效果。"),
    ("Q6: 新生兒黃疸需要注意什麼？","新生兒黃疸多為生理性，通常出生後 3–5 天達高峰、約 2 週內消退。若出現過早（24 小時內）、消退過慢（超過 2 週）或顏色很深需積極評估。李佳玲醫師建議寶寶出院後 1–2 天回診監測。"),
    ("Q7: 帶狀皰疹疫苗（欣剋疹）適合誰打？","建議 50 歲以上成人或 18 歲以上具免疫缺陷者接種，共 2 劑、間隔 2–6 個月。依原廠仿單記載具良好保護效果，實際保護力依年齡與個人狀況而異。立欣診所備有現貨，可隨到隨打。每日最後一診前 1 小時停止施打。"),
]
for q, a in faqs1:
    story.append(Paragraph(q, h3))
    story.append(Paragraph(a, bullet))
story.append(PageBreak())
faqs2 = [
    ("Q8: 立欣診所有提供成人服務嗎？","有的。除兒科外也提供成人家庭醫學照護，包含感冒、腸胃道症狀、慢性病追蹤（高血壓、糖尿病、高血脂）、科學減重門診、HPV 疫苗與帶狀皰疹疫苗接種等。"),
    ("Q9: 科學減重門診費用為何？","為自費項目，費用依診療內容而定。完整評估包含 InBody 分析、血壓量測、腰圍記錄，必要時安排抽血。費用就診時透明說明，建議透過 LINE 或來電諮詢當前費用。"),
    ("Q10: 診所附近有停車位嗎？","診所門口設有機車停車格；汽車可停放於鄰近收費停車場或路邊車格。鄰近成大醫院、台南公園，交通便利。"),
    ("Q11: 我可以線上查詢看診進度嗎？","可以。透過 mainpi 即時看診進度系統查詢：https://www.mainpi.com/query?i=2935，顯示目前看診進度與等候人數。"),
    ("Q12: 加入 LINE 官方帳號有什麼好處？","可以：（1）線上預約掛號；（2）詢問疫苗現貨；（3）接收季節性衛教資訊（流感季、腸病毒季提醒）；（4）了解國定假日門診異動。"),
]
for q, a in faqs2:
    story.append(Paragraph(q, h3))
    story.append(Paragraph(a, bullet))
story.append(PageBreak())

# ========== 第 17 頁：就診前準備 ==========
story.append(Paragraph("十、就診前準備事項", h1))
story.append(Paragraph("兒科就診", h3))
story += bl(["必備：兒童健保卡、兒童健康手冊（黃卡）","建議攜帶：過去接種紀錄、病歷或檢驗報告、目前服用藥物名稱",
    "口頭整理：症狀開始時間、最高體溫、症狀變化、飲食與睡眠狀況","過敏兒童：已知過敏原清單、發作頻率、目前使用的過敏藥",
    "氣喘評估：近 1 個月發作頻率、夜咳次數、運動後是否喘鳴"])
story.append(Paragraph("新生兒回診", h3))
story += bl(["必備：嬰兒健保卡、兒童健康手冊（黃卡）","新生兒黃疸：出生醫院出院時的黃疸值紀錄",
    "餵食記錄：每日餵食次數、每次量、解便與小便次數","哺乳問題：母乳或配方奶種類、是否有溢奶或吐奶"])
story.append(Paragraph("成人科學減重初診", h3))
story += bl(["建議穿著輕便服裝（InBody 測量需要）","避免測量前 2 小時內大量進食、運動、洗澡",
    "建議攜帶近 3 個月血液檢查報告、目前服用藥物清單","口頭整理：過去減重經驗、飲食/運動/睡眠習慣"])
story.append(Paragraph("自費疫苗接種", h3))
story += bl(["事前來電 06-2516086 或 LINE 確認當日疫苗現貨","必備：健保卡、兒童健康手冊（黃卡，兒童適用）",
    "接種時段：每日最後一診前 1 小時停止施打，請提早抵達","接種後於診所觀察 15–30 分鐘後再離開"])
story.append(PageBreak())

# ========== 第 18 頁：聯絡資訊 ==========
story.append(Paragraph("十一、聯絡資訊與交通", h1))
story.append(Paragraph("聯絡方式", h2))
contact = [
    ['院址','台南市北區育德路 467 號'],['電話','06-2516086'],['LINE 官方帳號','@lhpedclinic'],
    ['LINE 連結','https://line.me/R/ti/p/@lhpedclinic'],['官方網站','https://lhpedclinic.com.tw'],
    ['電子郵件','lhpedclinic@gmail.com'],
    ['Facebook','https://www.facebook.com/lhpedclinic'],['Instagram','@lhpedclinic'],
    ['即時看診進度','https://www.mainpi.com/query?i=2935'],['Google 評價','★ 5.0 星｜搜尋「立欣診所 台南」'],
]
ct = Table(contact, colWidths=[40*mm, 110*mm])
ct.setStyle(TableStyle([
    ('FONTNAME',(0,0),(0,-1),'TCB'),('FONTNAME',(1,0),(1,-1),'TC'),('FONTSIZE',(0,0),(-1,-1),9.5),
    ('TEXTCOLOR',(0,0),(0,-1),GREEN),('BACKGROUND',(0,0),(0,-1),BGGREEN),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ('GRID',(0,0),(-1,-1),0.5,LGREEN),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),10),
]))
story.append(ct)
story.append(Paragraph("交通資訊", h2))
story.append(Paragraph("<b>開車前往</b>：診所位於育德路 467 號，鄰近成大醫院與台南公園，鄰近有收費停車場。建議用 Google 地圖搜尋「立欣診所」導航。", bullet))
story.append(Paragraph("<b>機車前往</b>：診所門口設有機車停車格。", bullet))
story.append(Paragraph("<b>大眾運輸</b>：可搭台南市公車於台南公園或成大醫院站下車，步行約 5–10 分鐘抵達。", bullet))
story.append(Paragraph("服務區域", h2))
story.append(Paragraph("立欣診所主要服務範圍涵蓋：台南市北區、東區、中西區、永康區、安南區、南區、仁德區等地區居民。", body))
story.append(Spacer(1, 10))
story.append(HRFlowable(width="100%", thickness=0.5, color=LGREEN))
story.append(Paragraph("醫療廣告暨衛教資訊聲明：本文件為衛生福利部健保特約醫療機構「立欣診所」之公開介紹資料，由蔡宗儒院長審閱發布。所有醫療衛教內容僅供一般參考，不構成醫療診斷建議；實際診斷與治療請至診所由醫師面診評估。疫苗、藥物之保護效力與副作用依原廠仿單記載，個別效果因人而異。文件版本：2026年7月更新版。", note))

# Build
doc = SimpleDocTemplate('/tmp/lihsin-clinic-intro-2026.pdf', pagesize=A4,
    topMargin=22*mm, bottomMargin=18*mm, leftMargin=20*mm, rightMargin=20*mm,
    title='立欣診所完整介紹 2026', author='立欣診所 蔡宗儒院長')
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print("✅ PDF 已生成 /tmp/lihsin-clinic-intro-2026.pdf（上傳至 /docs/lihsin-clinic-intro-2026.pdf）")
