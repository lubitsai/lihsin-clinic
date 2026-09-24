/* 立欣診所「線上小幫手」回覆引擎 v1（2026-09-24）
   ------------------------------------------------------------
   純前端、不連任何語言模型：先依知識庫正本的系統指示做規則分流（急症 → 費用 →
   個別病情 → 代辦 → 消歧義 → 門診時間 → 聯絡資訊），其餘才在 FAQ 裡檢索，
   回覆的每一句都來自 /clinic-assistant/knowledge.json（internal/tools/build_assistant_kb.py 產生）
   或本檔的固定句。家長輸入的文字只在這個瀏覽器分頁的記憶體裡比對，不送出、不儲存。
   測試：node internal/tools/test_assistant.mjs
   ============================================================ */

const CONTACT = '請來電 06-2516086 或加 LINE @lhpedclinic 詢問。';
// 系統指示第 15 條逐字
const HOURS_NOTE = '實際門診時間以官網 https://lhpedclinic.com.tw 公告為準，建議來電或 LINE 確認。';
// 系統指示第 20 條
const HOLIDAY_NOTE = '國定假日、連假、颱風天門診可能調整，請以診所最新公告或 LINE @lhpedclinic 為準。';
// 系統指示第 12 條
const COVID_NOTE = '提醒：本院沒有提供新冠疫苗；「左流右新」是疾管署的共同接種政策說明。';
const COVID = /新冠疫苗|covid19疫苗|covid疫苗|左流右新|莫德納|輝瑞|諾瓦瓦克斯/;
// 系統指示第 11 條四但書
const VACCINE_NOTE = '接種提醒：適用對象與劑次依原廠仿單記載，由醫師評估；現貨與到貨情形請先來電或 LINE 確認。發燒或急性疾病期應暫緩接種，有禁忌者不接種。';
const MAPS = 'https://www.google.com/maps/search/?api=1&query=立欣診所+台南市北區育德路467號';
const LINE_URL = 'https://line.me/R/ti/p/@lhpedclinic';
const DAY = ['日', '一', '二', '三', '四', '五', '六'];
const SESSION = { MORNING: '上午', AFTERNOON: '下午', EVENING: '晚上' };

// ── 正規化：全半形、同義字，兩邊（題庫與提問）走同一套 ──
const SYNONYMS = [
  [/臺/g, '台'], [/星期|禮拜/g, '週'], [/週天/g, '週日'], [/預防針/g, '疫苗'],
  [/小朋友|小孩子|小孩|孩童|兒童|小兒/g, '孩子'], [/醫生/g, '醫師'], [/幾號/g, '幾號'],
];
export function normalize(s) {
  let t = String(s || '').normalize('NFKC').toLowerCase();
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.replace(/[^\p{L}\p{N}]/gu, '');
}
// 檢索專用：拿掉問句虛詞，避免「可以帶寵物嗎」靠「可以帶」配到不相干的題目
const FILLER = /請問|可以|可不可以|能不能|什麼|怎麼|要不要|需要|是不是|會不會|有沒有|一定|還是|如果|你們|立欣診所|[嗎呢啊吧喔嗯的了]/g;
const TOPIC = [
  [/長不高|太矮|矮小|身高不夠/g, '身高'], [/什麼時候|什麼情況|哪些情況|哪種情況|何時/g, '何時'],
  [/看醫師|給醫師看|就診/g, '就醫'],
];
const searchKey = (s) => {
  let t = normalize(s);
  for (const [re, to] of TOPIC) t = t.replace(re, to);
  return t.replace(FILLER, '');
};
const grams = (s) => {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
};

// ── 規則分流用的字詞（對 normalize 後的字串比對）──
const URGENT = /呼吸困難|呼吸急促|呼吸很喘|很喘|喘不過氣|嘴唇發紫|嘴唇發黑|臉色發白|臉色發青|發紺|叫不醒|意識不清|意識改變|昏迷|昏倒|抽搐|痙攣|抽筋不停|發燒.{0,8}抽筋|抽筋.{0,8}發燒|眼睛上吊|持續嘔吐|一直吐|脫水|尿不出來|大量出血|血流不止|(?:3個月以下|三個月以下|未滿3個月|未滿三個月|[123一二三兩]個月大|新生兒|出生.{0,3}[天週]).{0,12}發燒/;
const SOON = /高燒持續|高燒不退|燒不退|退燒後.{0,6}(?:活力|精神)|活力.{0,4}變差|精神.{0,4}變差|吃喝.{0,6}減少|喝.{0,4}(?:很少|變少)|尿量.{0,6}減少|尿.{0,2}變少|嗜睡|肌躍|心跳加快/;
const PRICE = /費用|價格|多少錢|價錢|折扣|收費|價位|要錢嗎|免費嗎|自費多少/;
const DOSE = /吃什麼藥|要吃藥嗎|吃多少|劑量|幾cc|幾毫升|幾ml|幫.{0,4}(?:看|判讀)報告|我的報告|報告.{0,6}正常嗎|數值.{0,4}正常嗎/;
const SUITABLE = /(?:我|孩子|我家|兒子|女兒|寶寶|老大|老二|他|她).{0,10}(?:氣喘|過敏|免疫|吃藥|用藥|吃過|感冒|發燒|咳嗽|生病|早產|蠶豆|癲癇|心臟|懷孕|抗生素|克流感|流感藥|剛打|打過).{0,12}(?:可以|能不能|可不可以|能|適合).{0,6}(?:打|接種)/;
const ACTION = /(?:幫我|替我|幫忙|可以幫).{0,6}(?:預約|掛號|取消|改期|改時間|查)|我的.{0,4}(?:預約|號碼|號次|未到)|排第幾|還要等多久|還要等幾|還有名額|還有位子|有沒有名額|可以插號|提前看/;
const LATE = /遲到|沒趕上|來不及|趕不上/;
const STOCK = /現貨|庫存|有貨|剩幾|到貨了嗎|打得到嗎|還有疫苗嗎/;
const HOLIDAY = /颱風|連假|國定假日|過年|春節|除夕|清明|端午|中秋|元旦|跨年/;
const SCHED_WORDS = /看診|門診|有診|開診|休診|休息|有開|開嗎|有沒有開|營業|上班|幾點|醫師在|看嗎|有看|掛號|時間|放假|休假/;
const HOURS_TOPIC = /門診時間|看診時間|營業時間|幾點開|幾點到|幾點看|幾點結束|夜診|晚診|早診|午診|班表|排班|哪天看診|哪幾天/;
const QUEUE = /看診進度|叫號|輪到|到幾號|看到幾號|現在幾號/;
const ADDRESS = /地址|在哪裡?$|在哪$|位置|怎麼去|怎麼走|交通|導航|停車/;
const PHONE = /電話|打電話|聯絡|聯繫/;

const PERSONAL = /[a-z][12]\d{8}|09\d{8}|我叫|我的名字|名字叫|病歷號|我的生日|生日是|出生日期|出生年月日|我的電話|我的地址|我家地址|我住在/;
/** 提問是否疑似含個資：介面據此不回顯使用者的原句（系統指示第 13、14 條）。 */
export function looksPersonal(question) {
  return PERSONAL.test(normalize(question));
}

// ── 日期（一律台灣時間）──
export function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(now);
}
const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmtDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
const weekday = (s) => toDate(s).getUTCDay();
const label = (s) => `${+s.slice(5, 7)} 月 ${+s.slice(8)} 日（${DAY[weekday(s)]}）`;

/** 從提問解析出一個日期（YYYY-MM-DD）；沒有日期字樣回 null。 */
export function parseDate(question, today) {
  let q = String(question || '').normalize('NFKC');
  for (const [re, to] of SYNONYMS) q = q.replace(re, to);
  const rel = q.match(/大後天|後天|明天|明日|今天|今日|今晚|今早/);
  if (rel) return addDays(today, { 大後天: 3, 後天: 2, 明天: 1, 明日: 1 }[rel[0]] || 0);
  const md = q.match(/(?<!\d)(1[0-2]|0?[1-9])(?:月|\/|-)(3[01]|[12]\d|0?[1-9])(?:日|號)?(?!\d)/);
  if (md) {
    let y = +today.slice(0, 4);
    const pad = (n) => String(n).padStart(2, '0');
    let d = `${y}-${pad(md[1])}-${pad(md[2])}`;
    if (d < addDays(today, -30)) d = `${y + 1}-${pad(md[1])}-${pad(md[2])}`;
    return isNaN(toDate(d)) ? null : d;
  }
  const wk = q.match(/(下下|下|這|本)?週([一二三四五六日])/);
  if (wk) {
    const target = DAY.indexOf(wk[2]);
    const mondayIdx = (weekday(today) + 6) % 7;
    if (wk[1] === '下' || wk[1] === '下下') {
      return addDays(today, -mondayIdx + (wk[1] === '下' ? 7 : 14) + (target + 6) % 7);
    }
    return addDays(today, (target - weekday(today) + 7) % 7);
  }
  return null;
}

export function createAssistant(kb) {
  const valid = (r, today) => !r.valid_until || r.valid_until >= today;
  const doctors = Object.fromEntries((kb.facts['醫師'] || '').split(/[（(]/)[0].split('、')
    .map((n) => [n.trim()[0], n.trim()]));

  // ── 檢索索引：標題（主）、出自頁名（輔）、答案（BM25 飽和）──
  const docs = kb.faqs.map((r) => {
    const t = searchKey(r.title), a = searchKey(r.answer);
    const tf = new Map();
    for (const g of grams(a)) tf.set(g, (tf.get(g) || 0) + 1);
    return { row: r, title: new Set(grams(t)), page: new Set(grams(searchKey(r.page))), tf, len: a.length };
  });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const g of new Set([...d.title, ...d.page, ...d.tf.keys()])) df.set(g, (df.get(g) || 0) + 1);
  const unseen = 0.5 * Math.log(1 + (docs.length + 0.5) / 0.5);
  const idf = (g) => Math.log(1 + (docs.length - (df.get(g) || 0) + 0.5) / ((df.get(g) || 0) + 0.5));

  // strict：同一則回覆已有門診表／聯絡資訊時，只收標題高度相符的題目
  function search(question, today, limit = 5, strict = false) {
    const all = [...new Set(grams(searchKey(question)))];
    const qg = all.filter((g) => df.has(g));
    if (!qg.length) return [];
    // 題庫裡完全沒出現過的字組也算進分母：問的東西題庫沒有，就不硬配
    const total = qg.reduce((s, g) => s + idf(g), 0) + (all.length - qg.length) * unseen;
    const scored = [];
    for (const d of docs) {
      if (!valid(d.row, today)) continue;
      let s = 0, inTitle = 0, anywhere = 0, titleHits = 0;
      for (const g of qg) {
        const w = idf(g), tf = d.tf.get(g) || 0;
        const t = d.title.has(g), p = d.page.has(g);
        const a = tf ? (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.len / avgLen)) : 0;
        s += w * (2.5 * t + 0.5 * p + 0.6 * a);
        if (t) { inTitle += w; titleHits++; }
        if (t || tf) anywhere += w;
      }
      const titleCov = inTitle / total, cov = anywhere / total;
      if (titleCov < 0.3 && !(cov >= 0.75 && titleCov >= 0.15)) continue;
      if (qg.length >= 3 && titleHits < 2) continue;
      if (strict && titleCov < 0.45) continue;
      scored.push({ row: d.row, score: s / total + (d.row.core ? 0.05 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0]?.score || 0;
    return scored.filter((h) => h.score >= top * 0.55).slice(0, limit);
  }

  // 顯示前的附註：不改答案原文，只在後面接系統指示要求的提醒
  function present(row) {
    if (PRICE.test(normalize(row.title))) return '費用依項目與當日狀況不同，' + CONTACT;
    let text = row.answer;
    const all = row.title + row.answer;
    if (/疫苗|接種/.test(all) && !(/仿單/.test(all) && /醫師評估/.test(all) && /來電|LINE/.test(all) && /暫緩|急性/.test(all))) text += '\n\n' + VACCINE_NOTE;
    if (COVID.test(normalize(all))) text += '\n\n' + COVID_NOTE;
    if (/門診|看診時間|排班|夜診|晚診|假日|掛號/.test(row.title)) text += '\n\n' + HOURS_NOTE;
    if (row.seasonal) text += `\n\n以上為 ${kb.reviewed_at} 版資料；年度政策與資格請再確認最新公告。`;
    return text;
  }
  const faqBlock = (hits) => ({
    type: 'faq',
    items: hits.map((h, i) => ({
      id: h.row.id, title: h.row.title, text: present(h.row), page: h.row.page,
      url: kb.site + h.row.path, open: i === 0 && (hits.length === 1 || h.score >= (hits[1]?.score || 0) * 1.35),
    })),
  });

  function weeklyRows(w) {
    const bySession = new Map();
    for (const s of kb.schedule.weekly[String(w)] || []) {
      if (!bySession.has(s.session)) bySession.set(s.session, []);
      bySession.get(s.session).push(s);
    }
    const rows = [];
    for (const [key, list] of bySession) {
      const spans = new Set(list.map((s) => `${s.start}–${s.end}`));
      rows.push([SESSION[key], spans.size === 1
        ? `${[...spans][0]}　${list.flatMap((s) => s.doctors).join('、')}`
        : list.map((s) => `${s.doctors.join('、')} ${s.start}–${s.end}`).join('／')]);
    }
    return rows;
  }
  function sessionsOn(date) {
    const ex = kb.schedule.exceptions[date];
    if (ex) return { special: true, rows: ex.map((s) => [SESSION[s.session], `${s.start}–${s.end}`]) };
    return { special: false, rows: weeklyRows(weekday(date)) };
  }
  const legend = () => Object.entries(doctors).map(([k, v]) => `${k}＝${v}`).join('，');
  const scheduleNotices = (today) => kb.notices.filter((n) => n.schedule && valid(n, today))
    .map((n) => ({ type: 'notice', title: n.title, text: n.answer }));

  const weekTable = () => ({
    type: 'schedule', title: '常態門診時間', note: legend(),
    days: [1, 2, 3, 4, 5, 6, 0].map((w) => ({ day: `週${DAY[w]}`, rows: weeklyRows(w) })),
  });

  function dateAnswer(date, today, q) {
    const blocks = [];
    if (date < today) return { kind: 'dynamic', text: '這一天已經過去了，請輸入今天以後的日期。', blocks };
    const { special, rows } = sessionsOn(date);
    const head = date === today ? `今天 ${label(date)}` : label(date);
    blocks.push({
      type: 'schedule', title: head + (special ? '｜門診異動' : ''),
      days: [{ day: '', rows: rows.length ? rows : [['', '全日休診']] }],
      note: special ? '當日依門診異動公告調整。' : legend(),
    });
    if (special) {
      blocks.push({ type: 'schedule', title: `常態週${DAY[weekday(date)]}門診`, days: [{ day: '', rows: weeklyRows(weekday(date)) }], note: legend() });
    }
    if (special || HOLIDAY.test(q)) blocks.push(...scheduleNotices(today));
    if (HOURS_TOPIC.test(q)) blocks.push(weekTable());
    const tail = [HOURS_NOTE];
    if (!special) tail.unshift(HOLIDAY_NOTE);
    if (/掛號/.test(q)) tail.unshift(kb.faqs.find((r) => r.id === 'G1')?.answer || '');
    blocks.push({ type: 'text', text: tail.filter(Boolean).join('\n') });
    return { kind: 'schedule', text: '', blocks };
  }

  function factsBlock(keys) {
    const f = kb.facts;
    const all = {
      address: ['地址', f['地址'], MAPS],
      phone: ['電話', f['電話'], 'tel:062516086'],
      line: ['LINE', '@lhpedclinic', LINE_URL],
      booking: ['網路預約', f['網路預約'], f['網路預約']],
      queue: ['看診進度', f['看診進度查詢'], f['看診進度查詢']],
      email: ['Email', f['Email'], 'mailto:' + f['Email']],
    };
    return { type: 'facts', rows: keys.map((k) => all[k]) };
  }

  /**
   * @param {string} question 家長輸入的原句
   * @param {string} [today] YYYY-MM-DD（台灣時間），測試時注入
   * @returns {{kind:string, text:string, blocks:object[], quick?:string[]}}
   */
  function ask(question, today = taipeiToday()) {
    const raw = String(question || '');
    const q = normalize(raw);
    const reply = (kind, text, blocks = [], extra = {}) => ({ kind, text, blocks, ...extra });
    if (!q) return reply('empty', '請輸入想查詢的問題。');
    if (raw.length > 300) return reply('unknown', '請將問題縮短至 300 字內，也請勿輸入個人資料。');

    // 1. 急症腳本：最高優先，不先回衛教內容（第三節）
    if (URGENT.test(q)) return reply('urgent', kb.urgent_reply);
    // 2. 個資：只提醒，不回顯（第 13、14 條）
    if (PERSONAL.test(q)) return reply('privacy', '提醒您，這個對話不需要提供個人資料，也不適合討論個別病情，請直接來電 06-2516086 由專人協助。');
    // 3. 次級紅旗（第三節）
    if (SOON.test(q)) return reply('soon', kb.soon_reply);
    // 4. 個別適合性、藥量、報告判讀 → 醫師當面評估（第 1、11-1 條）
    if (DOSE.test(q) || SUITABLE.test(q)) {
      return reply('clinical', '這需要醫師當面評估才能決定，請攜帶健保卡、兒童健康手冊與目前用藥來院；疫苗現貨請先來電 06-2516086 確認。');
    }
    // 5. 代訂／查號次／承諾名額（第 17 條）
    if (ACTION.test(q)) {
      return reply('action', '線上小幫手無法代為預約、改期、取消，也查不到個人的預約、號次或候診時間。', [factsBlock(['booking', 'queue', 'phone'])]);
    }
    // 6. 費用（第 5 條）：一律轉人工，仍附上相關題目（題目答案本身無金額）
    if (PRICE.test(q)) {
      const hits = search(raw.replace(/費用|價格|多少錢|價錢|折扣|收費|價位|要錢嗎|免費嗎|自費多少/g, ''), today, 3);
      return reply('price', '費用依項目與當日狀況不同，' + CONTACT, hits.length ? [faqBlock(hits)] : []);
    }
    // 7. 消歧義（第 18、19 條）
    if (LATE.test(q) && !/預約|現場|過號|報到/.test(q)) {
      return reply('clarify', '請問是「預約時段遲到」，還是「現場號過號」？兩者規則不同。', [], { quick: ['預約遲到怎麼辦', '現場號過號怎麼辦'] });
    }
    if (/掛號/.test(q) && !/現場|網路|線上|預約|開始|幾點|時間|過號|電話|帶|證件|健保|費/.test(q) && !parseDate(raw, today)) {
      return reply('clarify', '請問您是要網路預約，還是直接到現場掛號？', [], { quick: ['網路預約怎麼約', '現場掛號幾點開始'] });
    }
    // 8. 現貨、新冠疫苗（第 12 條）
    if (STOCK.test(q)) return reply('dynamic', '公告中的「已到貨」不代表今天有現貨。' + CONTACT);
    if (COVID.test(q)) {
      const hits = search(raw, today, 3);
      return reply('results', COVID_NOTE, hits.length ? [faqBlock(hits)] : []);
    }

    // 9. 特定日期有沒有看診：依首頁門診時間表與門診異動（EXCEPTIONS）
    const date = parseDate(raw, today);
    if (date && (SCHED_WORDS.test(q) || q.length <= 8)) return dateAnswer(date, today, q);
    if (HOLIDAY.test(q) && SCHED_WORDS.test(q)) {
      return reply('dynamic', HOLIDAY_NOTE, [...scheduleNotices(today), { type: 'text', text: '客服不會主動通知門診異動；已預約的時段若受影響，請在預約系統查看，或透過 LINE、來電與櫃檯聯繫。' }]);
    }

    // 10. 一般門診時間、聯絡資訊，並附相關題目
    const blocks = [];
    if (HOURS_TOPIC.test(q) || (/週[一二三四五六日]/.test(q) && SCHED_WORDS.test(q))) {
      blocks.push(weekTable(), { type: 'text', text: HOURS_NOTE });
    }
    const keys = [];
    if (ADDRESS.test(q)) keys.push('address');
    if (PHONE.test(q)) keys.push('phone');
    if (/line|賴/.test(q)) keys.push('line');
    if (/email|信箱|mail/.test(q)) keys.push('email');
    if (QUEUE.test(q)) keys.push('queue');
    if (keys.length) blocks.push(factsBlock(keys));

    const hits = search(raw, today, 5, blocks.length > 0);
    if (hits.length) blocks.push(faqBlock(hits));
    if (!blocks.length) return reply('unknown', '這部分我不確定，找不到足夠的資料。' + CONTACT);
    return reply('results', hits.length && blocks.length === 1 ? '以下是官網上的相關問答：' : '', blocks);
  }

  return { ask, search, present };
}
