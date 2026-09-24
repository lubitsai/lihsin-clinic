/* 立欣診所「線上小幫手」介面 v1（2026-09-24，取代 Chatbase）
   ------------------------------------------------------------
   掛載：頁尾 <script type="module" src="/clinic-assistant/widget.js"></script>
   - Shadow DOM 隔離樣式，不吃也不污染頁面的 Tailwind。
   - knowledge.json 在第一次打開（或手指／滑鼠移到按鈕上）才下載，不拖慢首頁。
   - 家長輸入的文字只在本分頁記憶體比對，不送出、不儲存；GA4 只記事件類型，不記原句。
   - Clarity：宿主元素帶 data-clarity-mask，整個對話框在錄影中遮蔽。
   - 行動版位置沿用 Chatbase 泡泡的層疊：底部 CTA Bar(0~70px) → 小幫手(104px) → FAB(11rem)。
   回覆邏輯在 ./search.js；資料由 internal/tools/build_assistant_kb.py 產生。
   ============================================================ */
import { createAssistant, looksPersonal } from './search.js';

const BASE = new URL('.', import.meta.url);
const SAFE_LINK = /^(https:\/\/(lhpedclinic\.com\.tw|lhpedclinic\.booknow\.com\.tw|www\.mainpi\.com|line\.me|www\.google\.com\/maps)\b|tel:|mailto:)/;
const URL_IN_TEXT = /(https:\/\/[^\s）)」，。；、]+)/g;

const CSS = `
:host{all:initial;font-family:'Noto Sans TC',system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;color:#2f3f29;font-size:15px;line-height:1.7;
  --green:#5f7a52;--green-d:#3f5136;--green-l:#f0f7ed;--line:#dcead2;--cream:#fffdf8}
*{box-sizing:border-box}
button,input,a{font:inherit}
button{cursor:pointer}
:focus-visible{outline:3px solid #D4B896;outline-offset:2px}
.launch{position:fixed;right:24px;bottom:24px;z-index:60;display:flex;align-items:center;gap:6px;min-height:52px;padding:0 18px 0 14px;border:0;border-radius:999px;
  background:var(--green);color:#fff;font-weight:700;box-shadow:0 6px 20px rgba(63,81,54,.3)}
.launch:hover{background:var(--green-d)}
.launch .emoji{font-size:22px;line-height:1}
.panel{position:fixed;right:24px;bottom:88px;z-index:61;width:390px;height:min(640px,calc(100dvh - 112px));display:flex;flex-direction:column;
  background:var(--cream);border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,.18);overflow:hidden}
.panel[hidden]{display:none}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 12px 16px;background:var(--green);color:#fff}
header strong{display:block;font-size:16px}
header small{display:block;font-size:12px;opacity:.9}
.close{border:0;background:transparent;color:#fff;font-size:22px;width:44px;height:44px;border-radius:12px}
.close:hover{background:rgba(255,255,255,.15)}
.log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:14px 14px 4px}
.msg{margin:0 0 12px;max-width:100%}
.bot{background:#fff;border:1px solid var(--line);border-radius:4px 16px 16px 16px;padding:10px 12px}
.me{margin-left:auto;width:fit-content;max-width:85%;background:var(--green);color:#fff;border-radius:16px 4px 16px 16px;padding:8px 12px;white-space:pre-wrap;word-break:break-word}
.me.masked{background:#e8ece5;color:#5d6b57;font-size:13px}
p{margin:0 0 8px;white-space:pre-wrap;word-break:break-word}
p:last-child{margin-bottom:0}
.urgent{border-color:#d97a7a;background:#fff5f5}
.urgent p:first-child{font-weight:700;color:#a33b3b}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.chips button{border:1px solid #c5d8ba;background:var(--green-l);color:var(--green-d);border-radius:999px;padding:6px 12px;font-size:14px;text-align:left}
.chips button:hover{background:#e3efdc}
details{border:1px solid var(--line);border-radius:12px;margin:8px 0 0;background:#fff}
summary{cursor:pointer;padding:9px 12px;font-weight:600;color:var(--green-d);list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'▸ ';color:var(--green)}
details[open] summary::before{content:'▾ '}
details .body{padding:0 12px 10px}
.src{font-size:13px;color:#6b7a63}
h4{margin:0 0 6px;font-size:15px;color:var(--green-d)}
.card{border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px 12px;margin:8px 0 0}
.notice{border-left:4px solid #D4B896}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:3px 6px 3px 0}
th{white-space:nowrap;color:var(--green-d);font-weight:600}
.day{margin:6px 0 2px;font-weight:700;color:var(--green-d)}
a{color:#3f6b34;text-underline-offset:3px;word-break:break-all}
form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:#fff}
input{flex:1;min-width:0;font-size:16px;padding:10px 12px;border:1px solid #b9c9b0;border-radius:12px;background:#fff;color:#2f3f29}
.send{border:0;border-radius:12px;background:var(--green);color:#fff;padding:0 16px;font-weight:700;min-height:44px}
.links{display:flex;justify-content:space-around;gap:8px;padding:6px 12px 10px;background:#fff;font-size:13px}
.links a{padding:6px 4px}
.hint{font-size:12px;color:#6b7a63;margin:0 0 12px}
@media (max-width:768px){
  .launch{right:16px;bottom:calc(104px + env(safe-area-inset-bottom,0px));min-height:48px;padding:0 14px 0 12px;font-size:14px}
  .panel{left:8px;right:8px;width:auto;bottom:calc(8px + env(safe-area-inset-bottom,0px));height:calc(100dvh - 72px);z-index:70}
}
@media (prefers-reduced-motion:no-preference){.panel{animation:rise .18s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}}}
`;

function track(name, params = {}) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, { from_path: location.pathname, ...params }); } catch { /* 追蹤失敗不影響客服 */ }
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null) n.append(k);
  return n;
}

function link(href, text) {
  if (!SAFE_LINK.test(href)) return document.createTextNode(text || href);
  const external = !href.startsWith('https://lhpedclinic.com.tw') && /^https:/.test(href);
  return el('a', { href, target: /^https:/.test(href) ? '_blank' : null, rel: external ? 'noopener noreferrer' : (/^https:/.test(href) ? 'noopener' : null) }, text || href);
}

// 答案原文是純文字；只把白名單網域的網址轉成連結，其餘一律 textContent
function richText(text, cls) {
  const p = el('p', cls ? { class: cls } : {});
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    p.append(text.slice(last, m.index), link(m[0]));
    last = m.index + m[0].length;
  }
  p.append(text.slice(last));
  return p;
}

if (!document.querySelector('lh-assistant')) {
  const host = document.createElement('lh-assistant');
  host.setAttribute('data-clarity-mask', 'True');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', {}, CSS));

  const launch = el('button', { class: 'launch', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'lh-panel' },
    el('span', { class: 'emoji', 'aria-hidden': 'true' }, '🦌'), '線上小幫手');
  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', name: 'q', maxlength: '300', autocomplete: 'off', enterkeyhint: 'send',
    'aria-label': '輸入您的問題', placeholder: '輸入問題，例如：初診要帶什麼？' });
  const form = el('form', {}, input, el('button', { class: 'send', type: 'submit' }, '送出'));
  const close = el('button', { class: 'close', type: 'button', 'aria-label': '關閉線上小幫手' }, '✕');
  const panel = el('section', { class: 'panel', id: 'lh-panel', role: 'dialog', 'aria-label': '立欣診所線上小幫手', hidden: true },
    el('header', {}, el('div', {}, el('strong', {}, '立欣診所・線上小幫手'), el('small', {}, '依官網公開資料回答常見問題')), close),
    log, form,
    el('nav', { class: 'links', 'aria-label': '聯絡診所' },
      link('tel:062516086', '撥打電話'), link('https://line.me/R/ti/p/@lhpedclinic', 'LINE 詢問'), link('https://lhpedclinic.booknow.com.tw/', '網路預約')));
  root.append(launch, panel);

  let assistant = null, loading = null, greeted = false;
  function load() {
    loading ||= fetch(new URL('knowledge.json', BASE), { credentials: 'omit' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((kb) => { assistant = createAssistant(kb); return kb; });
    return loading;
  }

  const scrollEnd = () => { log.scrollTop = log.scrollHeight; };
  function botSay(...nodes) {
    const m = el('div', { class: 'msg bot' }, ...nodes);
    log.append(m);
    return m;
  }

  function greet(kb) {
    if (greeted) return;
    greeted = true;
    botSay(richText(kb.greeting));
    log.append(el('div', { class: 'chips' }, kb.suggestions.map((s) => el('button', { type: 'button', onclick: () => submit(s) }, s))));
    log.append(el('p', { class: 'hint' }, `資料依官網內容整理（${kb.reviewed_at} 版），不提供個別醫療判斷。`));
  }

  function renderBlock(b) {
    if (b.type === 'text') return richText(b.text, 'src');
    if (b.type === 'notice') return el('div', { class: 'card notice' }, el('h4', {}, '📢 ' + b.title), richText(b.text));
    if (b.type === 'facts') {
      return el('div', { class: 'card' }, el('table', {}, el('tbody', {}, b.rows.map(([k, v, href]) =>
        el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, link(href, v)))))));
    }
    if (b.type === 'schedule') {
      return el('div', { class: 'card' }, el('h4', {}, b.title),
        b.days.map((d) => [d.day ? el('div', { class: 'day' }, d.day) : null,
          el('table', {}, el('tbody', {}, d.rows.map(([k, v]) => el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, v)))))]),
        b.note ? el('p', { class: 'src' }, b.note) : null);
    }
    if (b.type === 'faq') {
      return b.items.map((it) => {
        const d = el('details', { open: it.open },
          el('summary', {}, it.title),
          el('div', { class: 'body' }, richText(it.text), el('p', { class: 'src' }, '出自：', link(it.url, it.page))));
        d.addEventListener('toggle', () => { if (d.open) track('assistant_faq_open', { faq_id: it.id }); });
        return d;
      });
    }
    return null;
  }

  async function submit(text) {
    const question = String(text || '').trim();
    if (!question) return;
    input.value = '';
    // 疑似個資不回顯（系統指示第 14 條）
    log.append(looksPersonal(question)
      ? el('div', { class: 'msg me masked' }, '（為保護隱私，此訊息不顯示）')
      : el('div', { class: 'msg me' }, question));
    scrollEnd();
    try { await load(); } catch {
      botSay(richText('資料載入失敗，請來電 06-2516086 或加 LINE @lhpedclinic 詢問。'));
      loading = null;
      scrollEnd();
      return;
    }
    const r = assistant.ask(question);
    track('assistant_query', { result_kind: r.kind });
    const m = botSay(r.text ? richText(r.text) : null, r.blocks.map(renderBlock));
    if (r.kind === 'urgent' || r.kind === 'soon') m.classList.add('urgent');
    if (r.quick) log.append(el('div', { class: 'chips' }, r.quick.map((s) => el('button', { type: 'button', onclick: () => submit(s) }, s))));
    // 捲到這則回覆的開頭，長答案才不會直接跳到底
    m.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function toggle(open) {
    panel.hidden = !open;
    launch.hidden = open && matchMedia('(max-width:768px)').matches;
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      track('assistant_open');
      if (!greeted) {
        const wait = botSay(el('p', {}, '資料載入中…'));
        load().then((kb) => { wait.remove(); greet(kb); log.scrollTop = 0; })
          .catch(() => { wait.replaceChildren(richText('資料載入失敗，請來電 06-2516086 或加 LINE @lhpedclinic 詢問。')); loading = null; });
      }
      input.focus({ preventScroll: true });
    } else {
      launch.focus();
    }
  }

  launch.addEventListener('click', () => toggle(panel.hidden));
  for (const ev of ['pointerenter', 'touchstart', 'focus']) launch.addEventListener(ev, () => load().catch(() => { loading = null; }), { once: true, passive: true });
  close.addEventListener('click', () => toggle(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });

  // shadow DOM 內的點擊，cta-track.js 的 document 監聽看不到 → 這裡用相同事件名補記
  root.addEventListener('click', (e) => {
    const a = e.composedPath().find((n) => n.tagName === 'A');
    if (!a) return;
    const h = a.getAttribute('href') || '';
    const name = h.startsWith('tel:') ? 'call_click' : h.includes('line.me') ? 'line_click'
      : h.includes('mainpi.com') ? 'queue_click' : h.includes('booknow.com.tw') ? 'booking_click'
        : h.includes('google.com/maps') ? 'directions_click' : null;
    if (name) track(name, { link_url: h, via: 'assistant' });
  });
}
