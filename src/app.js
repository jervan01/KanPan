'use strict';
/* =====================================================================
   KanPan — A 股看盘（腾讯行情）。依赖 data.js / chart.js
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

const I = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
  drag: '<svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>',
  top: '<svg viewBox="0 0 24 24"><path d="M12 19V6M6 12l6-6 6 6M6 3h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ---------- 存储 ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('kp.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kp.' + k, JSON.stringify(v)); } catch (e) { /* 配额满等情况忽略 */ } },
};
let S = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
S.maP = (Array.isArray(S.maP) ? S.maP : []).filter(n => MA_P_OPTIONS.includes(n)).sort((a, b) => a - b);
S.maV = (Array.isArray(S.maV) ? S.maV : []).filter(n => MA_V_OPTIONS.includes(n)).sort((a, b) => a - b);
S.refreshSec = clamp(+S.refreshSec || 60, 10, 3600);
S.bars = clamp(+S.bars || 80, 20, 300);
if (!PERIODS.some(p => p[0] === S.period)) S.period = 'day';
let watch = store.get('watch', null);
if (!Array.isArray(watch) || !watch.length) watch = clone(DEFAULT_WATCH);
watch = watch.filter(w => w && /^(sh|sz|bj)\d{6}$/.test(w.k));
let quotes = store.get('quotes', {});
const saveSettings = () => store.set('settings', S);
const saveWatch = () => store.set('watch', watch);

let sortKey = '', sortDir = 0;      // sortDir: 1 降序 / -1 升序 / 0 手动顺序
let edit = false, dragging = false;
let lastOk = 0, lastErr = '', refreshing = false, timer = 0;
let det = null;                      // 当前打开的个股详情

/* ---------- Toast ---------- */
let toastTimer = 0;
function toast(msg, ms = 2000) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- 覆盖层栈 / Android 返回键 ---------- */
const stack = [];
let afterQ = null, closing = false;
function pushOverlay(el, close) { stack.push({ el, close }); history.pushState({ o: stack.length }, ''); }
function closeTop(after) {
  if (!stack.length) { if (after) after(); return; }
  if (closing) return;
  closing = true; afterQ = after || null; history.back();
}
window.addEventListener('popstate', () => {
  closing = false;
  const o = stack.pop(); if (o) o.close();
  const a = afterQ; afterQ = null; if (a) a();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) closeTop(); });

function openSheet({ title, sub, tools = '', body, footer, flex, onMount, onClose }) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = '<div class="sheet-card"><div class="sheet-h"><button class="icon-btn" data-sheet="close" aria-label="返回">' + I.back + '</button>' +
    '<h2>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h2>' + tools + '</div>' +
    '<div class="sheet-b' + (flex ? ' flex' : '') + '">' + body + '</div>' + (footer ? '<div class="sheet-f">' + footer + '</div>' : '') + '</div>';
  $('#sheets').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  pushOverlay(el, () => { el.classList.remove('show'); if (onClose) onClose(); setTimeout(() => el.remove(), 260); });
  el.addEventListener('click', e => {
    if (e.target.closest('[data-sheet="close"]')) closeTop();
    else if (e.target === el && window.innerWidth >= 700) closeTop();
  });
  $$('[data-icon]', el).forEach(x => { x.innerHTML = I[x.dataset.icon] || ''; });
  if (onMount) onMount(el);
  return el;
}
function confirmBox(title, message, okText = '确定') {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'dlg';
    el.innerHTML = '<div class="dlg-card"><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p><div class="dlg-b"><button class="btn" data-r="0">取消</button><button class="btn primary" data-r="1">' + esc(okText) + '</button></div></div>';
    $('#sheets').appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    let result = false;
    pushOverlay(el, () => { el.classList.remove('show'); setTimeout(() => el.remove(), 180); res(result); });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b) { result = b.dataset.r === '1'; closeTop(); } else if (e.target === el) closeTop();
    });
  });
}

/* ---------- 主题 / 视口 ---------- */
function applyTheme() {
  const dark = S.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : S.theme !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0d1015' : '#f4f5f7';
  if (det && det.chart) det.chart.invalidate();
}
function fitViewport() {
  const vv = window.visualViewport;
  if (vv) { document.documentElement.style.setProperty('--app-h', vv.height + 'px'); window.scrollTo(0, 0); }
}
if (window.visualViewport) { visualViewport.addEventListener('resize', fitViewport); visualViewport.addEventListener('scroll', fitViewport); }

/* =====================================================================
   自选列表
   ===================================================================== */
const kindOfWatch = w => w.t || kindOfKey(w.k);
function viewList() {
  const arr = watch.map(w => ({ w, q: quotes[w.k] }));
  if (sortKey && sortDir) {
    const dir = sortDir;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * (a.w.n || '').localeCompare(b.w.n || '', 'zh');
      const x = a.q ? (sortKey === 'pct' ? a.q.pct : a.q.price) : null, y = b.q ? (sortKey === 'pct' ? b.q.pct : b.q.price) : null;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (y - x) * dir;
    });
  }
  return arr;
}
function rowHtml({ w, q }) {
  const kind = kindOfWatch(w), dec = decOf(kind), cls = q ? signClass(q.pct) : 'flat';
  return '<div class="row' + (edit ? ' editing' : '') + '" data-k="' + w.k + '">' +
    (edit ? '<button class="handle" aria-label="拖动排序">' + I.drag + '</button>' : '') +
    '<div class="nm"><b>' + esc(q ? q.name : w.n) + '</b><small><i class="tag">' + kind + '</i>' + w.k.slice(2) + '</small></div>' +
    '<div class="px ' + cls + '">' + (q ? fmtPrice(q.price, dec) : '--') + '</div>' +
    '<div class="pc"><span class="pill ' + cls + '">' + (q ? fmtPct(q.pct) : '--') + '</span></div>' +
    (edit ? '<button class="mini-btn" data-act="top" aria-label="置顶">' + I.top + '</button><button class="mini-btn danger" data-act="del" aria-label="删除">' + I.trash + '</button>' : '') +
    '</div>';
}
function renderList() {
  if (dragging) return;
  const list = $('#list');
  if (!watch.length) { list.innerHTML = '<div class="empty">自选为空，点右上角放大镜搜索添加</div>'; return; }
  list.innerHTML = viewList().map(rowHtml).join('');
}
function renderHead() {
  $$('#thead .th').forEach(b => {
    const on = b.dataset.sort === sortKey && sortDir;
    b.classList.toggle('on', !!on);
    $('i', b).textContent = on ? (sortDir === 1 ? '▼' : '▲') : '';
  });
  const be = $('#btnEdit'); be.innerHTML = edit ? I.check : I.edit; be.classList.toggle('on', edit);
}
const fmtSec = s => (s < 60 ? s + ' 秒' : s % 60 === 0 ? (s / 60) + ' 分钟' : s + ' 秒');
function renderSub() {
  const ms = marketState(), m = $('#mkt');
  m.textContent = ms.s; m.classList.toggle('live', ms.live);
  const t = lastOk ? new Date(lastOk).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
  $('#sub').innerHTML = '更新于 ' + t + ' · 每 ' + fmtSec(S.refreshSec) + '自动刷新' + (S.tradingOnly ? '（仅交易时段）' : '') +
    (edit ? ' · 拖动 ☰ 调整顺序' : '') + (lastErr ? ' · <span class="err">刷新失败</span>' : '');
}
function setEdit(on) {
  edit = on;
  if (on) { sortKey = ''; sortDir = 0; }
  renderHead(); renderList(); renderSub();
}

/* ---------- 刷新 ---------- */
function setSpin(on) { $('#btnRefresh').classList.toggle('spin', on); }
function mergeQuotes(qs) {
  Object.assign(quotes, qs);
  let dirty = false;
  watch.forEach(w => { const q = qs[w.k]; if (q && q.name && w.n !== q.name) { w.n = q.name; dirty = true; } });
  if (dirty) saveWatch();
  store.set('quotes', quotes);
}
async function refresh(manual) {
  if (refreshing) return;
  refreshing = true; setSpin(true);
  try {
    const keys = watch.map(w => w.k); if (det) keys.push(det.k);
    mergeQuotes(await fetchQuotes(keys));
    lastOk = Date.now(); lastErr = '';
    renderList(); updateDetailHead();
    if (manual && det) loadDetail(true);
  } catch (e) {
    lastErr = String((e && e.message) || e);
    if (manual) toast('刷新失败：' + lastErr, 3000);
  } finally { refreshing = false; setSpin(false); renderSub(); }
}
async function loadQuotesFor(keys) {
  try { mergeQuotes(await fetchQuotes(keys)); renderList(); updateDetailHead(); } catch (e) { /* 下次刷新再取 */ }
}
function tick() {
  if (document.hidden) return;
  if (S.tradingOnly && !inRefreshWindow()) { renderSub(); return; }
  refresh(false);
  if (det) loadDetail(true);
}
function schedule() { clearInterval(timer); timer = setInterval(tick, S.refreshSec * 1000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  renderSub();
  if (Date.now() - lastOk > S.refreshSec * 1000) { refresh(false); if (det) loadDetail(true); }
});
setInterval(renderSub, 20000);

/* ---------- 自选增删 ---------- */
function addWatch(it) {
  if (watch.some(w => w.k === it.k)) { toast('已在自选中'); return false; }
  watch.push({ k: it.k, n: it.n, t: it.t || kindOfKey(it.k) });
  saveWatch(); renderList(); loadQuotesFor([it.k]); toast('已添加 ' + it.n);
  return true;
}
function removeWatch(k) {
  const w = watch.find(x => x.k === k); if (!w) return;
  watch = watch.filter(x => x.k !== k); saveWatch(); renderList(); toast('已移除 ' + w.n);
}

/* ---------- 拖动排序（只移动兄弟节点，被拖行保持在 DOM 里以免丢失指针） ---------- */
function startDrag(e, row) {
  e.preventDefault();
  const list = $('#list'), handle = e.target.closest('.handle');
  dragging = true; row.classList.add('dragging');
  try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const grab = e.clientY - row.getBoundingClientRect().top;
  const move = ev => {
    const y = ev.clientY, lr = list.getBoundingClientRect();
    if (y < lr.top + 50) list.scrollTop -= 12; else if (y > lr.bottom - 50) list.scrollTop += 12;
    for (;;) {
      const prev = row.previousElementSibling; if (!prev) break;
      const r = prev.getBoundingClientRect();
      if (y < r.top + r.height / 2) list.insertBefore(prev, row.nextSibling); else break;
    }
    for (;;) {
      const next = row.nextElementSibling; if (!next) break;
      const r = next.getBoundingClientRect();
      if (y > r.top + r.height / 2) list.insertBefore(next, row); else break;
    }
    const nat = list.getBoundingClientRect().top + row.offsetTop - list.scrollTop;
    row.style.transform = 'translateY(' + (y - grab - nat) + 'px)';
  };
  const done = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', done);
    handle.removeEventListener('pointercancel', done);
    row.style.transform = ''; row.classList.remove('dragging');
    const order = $$('.row', list).map(r => r.dataset.k);
    watch = order.map(k => watch.find(w => w.k === k)).filter(Boolean);
    saveWatch(); dragging = false; renderList();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', done);
  handle.addEventListener('pointercancel', done);
}

/* =====================================================================
   个股详情（分时 / 日K / 周K / 月K）
   ===================================================================== */
const kcache = new Map();
async function getKline(k, p, need, force) {
  const key = k + '|' + p, c = kcache.get(key), age = c ? Date.now() - c.t : 1e12;
  if (c && c.count >= need && age < (force ? 15000 : 45000)) return c.bars;   // 缓存命中：不发请求
  const bars = await fetchKline(k, p, need);
  kcache.set(key, { t: Date.now(), count: need, bars });
  return bars;
}
function openDetail(k, nameHint, kindHint) {
  if (det) return;
  const w = watch.find(x => x.k === k), kind = (w && w.t) || kindHint || kindOfKey(k), q = quotes[k];
  const name = (q && q.name) || (w && w.n) || nameHint || k;
  const d = { k, name, kind, dec: decOf(kind), period: S.period, tok: 0, bars: null, minute: null, chart: null, el: null, err: '' };
  det = d;
  d.el = openSheet({
    title: name, sub: k.slice(0, 2).toUpperCase() + ' ' + k.slice(2), flex: true,
    tools: '<button class="icon-btn" id="dStar" data-act="star" aria-label="自选"></button>',
    body: '<div class="d-head" id="dHead"></div>' +
      '<div class="tabs" id="dTabs">' + PERIODS.map(p => '<button class="tab' + (p[0] === d.period ? ' on' : '') + '" data-p="' + p[0] + '">' + p[1] + '</button>').join('') +
      '<span class="grow"></span><button class="tab gear" id="dGear">' + I.gear + '指标</button></div>' +
      '<div class="chart-host" id="dChart"></div>' +
      '<div class="d-foot">长按显示十字光标（轻点收起）· 双指缩放 · 左右拖动翻看 · 前复权 · 数据来自腾讯财经，仅供参考</div>',
    onMount(el) {
      d.el = el;   // openSheet 返回前就会调用 onMount，必须先赋值，updateStar/updateDetailHead 要用
      d.chart = new Chart($('#dChart', el));
      d.chart.vis = S.bars;
      d.chart.onZoom = v => { S.bars = v; saveSettings(); };
      $('#dTabs', el).addEventListener('click', e => {
        const t = e.target.closest('.tab[data-p]');
        if (t && t.dataset.p !== d.period) {
          d.period = t.dataset.p; d.bars = null; d.minute = null; d.err = '';
          $$('.tab[data-p]', el).forEach(b => b.classList.toggle('on', b === t));
          d.chart.setMessage('加载中…'); loadDetail(false);
        }
        if (e.target.closest('#dGear')) openIndicators();
      });
      $('#dChart', el).addEventListener('click', () => { if (d.err) { d.chart.setMessage('加载中…'); loadDetail(true); } });
      $('#dStar', el).addEventListener('click', () => {
        if (watch.some(x => x.k === d.k)) removeWatch(d.k); else addWatch({ k: d.k, n: d.name, t: d.kind });
        updateStar();
      });
      updateStar(); updateDetailHead();
      d.chart.setMessage('加载中…');
      loadDetail(false);
      if (!quotes[k]) loadQuotesFor([k]);
    },
    onClose() { if (d.chart) d.chart.destroy(); if (det === d) det = null; },
  });
}
function updateStar() {
  if (!det) return;
  const on = watch.some(x => x.k === det.k), b = $('#dStar', det.el);
  if (b) { b.innerHTML = on ? I.starFill : I.star; b.style.color = on ? 'var(--avg)' : ''; }
}
function fmtQuoteTime(t) { return /^\d{14}$/.test(t) ? t.slice(4, 6) + '-' + t.slice(6, 8) + ' ' + t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14) : ''; }
function updateDetailHead() {
  const d = det; if (!d || !d.el) return;
  const box = $('#dHead', d.el); if (!box) return;
  const q = quotes[d.k];
  if (!q) { box.innerHTML = '<div class="d-price"><span class="big flat">--</span></div>'; return; }
  const cls = signClass(q.pct), dec = d.dec;
  const cmp = v => signClass(v - q.prev);
  const cells = [
    ['今开', fmtPrice(q.open, dec), cmp(q.open)], ['最高', fmtPrice(q.high, dec), cmp(q.high)], ['最低', fmtPrice(q.low, dec), cmp(q.low)], ['昨收', fmtPrice(q.prev, dec), ''],
    ['成交量', fmtVol(q.vol), ''], ['成交额', fmtAmt(q.amount), ''], ['换手率', q.turnover ? q.turnover.toFixed(2) + '%' : '--', ''], ['振幅', q.amp ? q.amp.toFixed(2) + '%' : '--', ''],
  ];
  if (d.kind === '股票' && q.pe) cells.push(['市盈率', q.pe.toFixed(1), ''], ['市净率', q.pb ? q.pb.toFixed(2) : '--', ''], ['总市值', q.tcap ? fmtBig(q.tcap * 1e8) : '--', ''], ['流通市值', q.mcap ? fmtBig(q.mcap * 1e8) : '--', '']);
  box.innerHTML = '<div class="d-price"><span class="big ' + cls + '">' + fmtPrice(q.price, dec) + '</span><span class="' + cls + '">' + fmtChg(q.chg, dec) + '</span><span class="' + cls + '">' + fmtPct(q.pct) + '</span>' +
    '<span class="d-time">' + (q.halt ? '停牌/未开盘 ' : '') + fmtQuoteTime(q.time) + '</span></div>' +
    '<div class="d-grid">' + cells.map(c => '<div><span>' + c[0] + '</span><b class="' + c[2] + '">' + c[1] + '</b></div>').join('') + '</div>';
}
function paintDetail(reset) {
  const d = det; if (!d || !d.chart) return;
  if (d.period === 'm') {
    if (!d.minute) return;
    const q = quotes[d.k], prev = (q && q.prev) || d.minute.prev;
    d.chart.setM({ pts: d.minute.pts, prev, dec: d.dec, kind: d.kind, showVol: S.showVol }, reset);
  } else {
    if (!d.bars) return;
    d.chart.setK({ bars: d.bars, dec: d.dec, kind: d.kind, maP: S.maP, maV: S.maV, showVol: S.showVol, vis: S.bars }, reset);
  }
}
async function loadDetail(force) {
  const d = det; if (!d) return;
  const tok = ++d.tok, p = d.period, first = !(p === 'm' ? d.minute : d.bars);
  try {
    if (p === 'm') {
      const r = await fetchMinute(d.k, d.kind === '指数');
      if (det !== d || d.tok !== tok) return;
      d.minute = r;
    } else {
      const bars = await getKline(d.k, p, klineCount(S.maP, S.maV), force);
      if (det !== d || d.tok !== tok) return;
      d.bars = bars;
    }
    d.err = ''; paintDetail(first);
  } catch (e) {
    if (det !== d || d.tok !== tok) return;
    d.err = String((e && e.message) || e);
    if (first) d.chart.setMessage('加载失败，轻点重试');
    else toast('更新失败：' + d.err, 2500);
  }
}

/* ---------- 指标设置 ---------- */
function openIndicators() {
  openSheet({
    title: '指标设置',
    body: '<div class="sec">均价线（显示在 K 线上，可多选）</div><div class="chips" id="cP"></div>' +
      '<div class="sec">均量线（显示在成交量上，可多选）</div><div class="chips" id="cV"></div>' +
      '<div class="card" style="margin-top:1.2rem"><div class="row2"><span>显示成交量</span><input type="checkbox" class="sw" id="cVol"></div>' +
      '<div class="col"><label>一屏显示 K 线根数：<b id="cBv"></b></label><input type="range" id="cB" min="30" max="200" step="10"></div></div>' +
      '<div class="hint">为避免被腾讯限流：每个周期只请求一次历史 K 线（约「最长均线周期 + 140」根，最多 500 根），之后每次刷新只更新当前这一个图表。选的均线越长，首次加载的数据越多。</div>',
    onMount(el) {
      const draw = () => {
        $('#cP', el).innerHTML = MA_P_OPTIONS.map(n => '<button class="chip' + (S.maP.includes(n) ? ' on' : '') + '" data-p="' + n + '"><i style="background:' + MA_COLORS[n] + '"></i>MA' + n + '</button>').join('');
        $('#cV', el).innerHTML = MA_V_OPTIONS.map(n => '<button class="chip' + (S.maV.includes(n) ? ' on' : '') + '" data-v="' + n + '"><i style="background:' + MA_COLORS[n] + '"></i>量' + n + '</button>').join('');
      };
      const apply = () => { saveSettings(); draw(); if (det) { paintDetail(false); loadDetail(false); } };
      const toggle = (arr, n) => { const i = arr.indexOf(n); if (i >= 0) arr.splice(i, 1); else { arr.push(n); arr.sort((a, b) => a - b); } };
      draw();
      $('#cVol', el).checked = S.showVol; $('#cB', el).value = clamp(S.bars, 30, 200); $('#cBv', el).textContent = $('#cB', el).value;
      el.addEventListener('click', e => {
        const p = e.target.closest('[data-p]'), v = e.target.closest('[data-v]');
        if (p) { toggle(S.maP, +p.dataset.p); apply(); }
        if (v) { toggle(S.maV, +v.dataset.v); apply(); }
      });
      $('#cVol', el).addEventListener('change', e => { S.showVol = e.target.checked; apply(); });
      $('#cB', el).addEventListener('input', e => { S.bars = +e.target.value; $('#cBv', el).textContent = S.bars; if (det && det.chart) det.chart.vis = S.bars; saveSettings(); paintDetail(false); });
    },
  });
}

/* =====================================================================
   搜索添加
   ===================================================================== */
function openSearch() {
  let tok = 0, timer2 = 0, results = null;
  openSheet({
    title: '搜索添加',
    body: '<div class="search sticky"><span data-icon="search"></span><input id="qi" placeholder="代码 / 名称 / 拼音，如 茅台、510300、半导体" autocomplete="off" autocapitalize="off" spellcheck="false"></div><div id="qb"></div>',
    onMount(el) {
      const inp = $('#qi', el), body = $('#qb', el);
      const has = k => watch.some(w => w.k === k);
      const chips = list => '<div class="chips">' + list.map(([k, n]) => '<button class="chip' + (has(k) ? ' added' : '') + '" data-add="' + k + '" data-n="' + esc(n) + '">' + (has(k) ? '✓ ' : '+ ') + esc(n) + '</button>').join('') + '</div>';
      const quick = () => {
        body.innerHTML = '<div class="sec">大盘指数</div>' + chips(QUICK_INDEX) + '<div class="sec">板块指数</div>' + chips(QUICK_SECTOR) +
          '<div class="sec">ETF</div>' + chips(QUICK_ETF) +
          '<div class="sec">热门主题（点击搜索相关指数 / ETF / 个股）</div><div class="chips">' + QUICK_WORDS.map(w => '<button class="chip" data-w="' + w + '">' + w + '</button>').join('') + '</div>' +
          '<div class="hint">搜索支持 A 股个股、指数（含各类板块/行业指数）、ETF。点右侧 + 加入自选，点整行查看行情。</div>';
      };
      const showResults = () => {
        if (!results) return;
        body.innerHTML = results.length ? results.map(r => '<div class="res" data-k="' + r.k + '"><div class="tx"><b>' + esc(r.n) + '</b><small><i class="tag">' + r.t + '</i>' + r.k.slice(0, 2).toUpperCase() + ' ' + r.k.slice(2) + '</small></div>' +
          '<button class="add' + (has(r.k) ? ' on' : '') + '" data-add="' + r.k + '" data-n="' + esc(r.n) + '" data-t="' + r.t + '">' + (has(r.k) ? I.check : I.plus) + '</button></div>').join('') : '<div class="empty">没有找到匹配的 A 股标的</div>';
      };
      const run = async () => {
        const q = inp.value.trim();
        if (!q) { results = null; quick(); return; }
        const my = ++tok; body.innerHTML = '<div class="empty">搜索中…</div>';
        try { const r = await searchSymbols(q); if (my !== tok) return; results = r; showResults(); }
        catch (e) { if (my === tok) body.innerHTML = '<div class="empty">搜索失败：' + esc(e.message || e) + '</div>'; }
      };
      inp.addEventListener('input', () => { clearTimeout(timer2); timer2 = setTimeout(run, 350); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer2); run(); inp.blur(); } });
      el.addEventListener('click', e => {
        const add = e.target.closest('[data-add]');
        if (add) {
          const k = add.dataset.add;
          if (!has(k)) addWatch({ k, n: add.dataset.n, t: add.dataset.t || kindOfKey(k) }); else toast('已在自选中');
          if (results) showResults(); else quick();
          return;
        }
        const w = e.target.closest('[data-w]');
        if (w) { inp.value = w.dataset.w; run(); return; }
        const r = e.target.closest('.res');
        if (r) { const it = (results || []).find(x => x.k === r.dataset.k); openDetail(r.dataset.k, it && it.n, it && it.t); }
      });
      quick();
      setTimeout(() => inp.focus(), 300);
    },
  });
}

/* =====================================================================
   设置
   ===================================================================== */
function openSettings() {
  const sw = (id, t, s) => '<div class="row2"><span>' + t + (s ? '<small>' + s + '</small>' : '') + '</span><input type="checkbox" class="sw" id="' + id + '"></div>';
  openSheet({
    title: '设置',
    body: '<div class="sec">刷新</div><div class="card">' +
      '<div class="col"><label>自动刷新间隔</label><div class="chips" id="sInt"></div>' +
      '<div class="two"><input class="field" id="sSec" type="number" inputmode="numeric" min="10" max="3600" step="1" style="width:7rem"><span>秒（10 ~ 3600，默认 60）</span></div></div>' +
      sw('sTr', '仅在交易时段自动刷新', '开市前后才请求，减少请求量，避免被腾讯限制；手动刷新不受影响') + '</div>' +
      '<div class="sec">图表</div><div class="card">' +
      '<div class="col"><label>打开个股时默认显示</label><div class="chips" id="sPer"></div></div>' +
      '<div class="col"><button class="btn block" id="sInd">指标设置：均线 / 成交量 / 均量线</button></div></div>' +
      '<div class="sec">外观</div><div class="card"><div class="col"><label>主题</label><div class="chips" id="sTh"></div><small>涨红跌绿固定为 A 股习惯。</small></div></div>' +
      '<div class="sec">数据</div><div class="card"><div class="col"><button class="btn block" id="sReset">恢复默认自选</button></div></div>' +
      '<div class="hint">行情数据来自腾讯财经公开接口，可能有延迟或中断，仅供参考，不构成任何投资建议。</div>',
    onMount(el) {
      const f = id => $('#' + id, el);
      const INTS = [15, 30, 60, 120, 300];
      const chip = (cls, attr, val, text, on) => '<button class="chip' + (on ? ' on' : '') + '" ' + attr + '="' + val + '">' + text + '</button>';
      const draw = () => {
        f('sInt').innerHTML = INTS.map(s => chip('', 'data-int', s, fmtSec(s), S.refreshSec === s)).join('');
        f('sPer').innerHTML = PERIODS.map(p => chip('', 'data-per', p[0], p[1], S.period === p[0])).join('');
        f('sTh').innerHTML = [['dark', '深色'], ['light', '浅色'], ['system', '跟随系统']].map(t => chip('', 'data-th', t[0], t[1], S.theme === t[0])).join('');
        f('sSec').value = S.refreshSec;
      };
      draw(); f('sTr').checked = S.tradingOnly;
      el.addEventListener('click', async e => {
        const t = e.target;
        const a = t.closest('[data-int]'), b = t.closest('[data-per]'), c = t.closest('[data-th]');
        if (a) { S.refreshSec = +a.dataset.int; saveSettings(); schedule(); renderSub(); draw(); }
        if (b) { S.period = b.dataset.per; saveSettings(); draw(); }
        if (c) { S.theme = c.dataset.th; saveSettings(); applyTheme(); draw(); }
        if (t.closest('#sInd')) openIndicators();
        if (t.closest('#sReset') && await confirmBox('恢复默认自选', '将用默认的 16 个自选替换当前自选列表。', '恢复')) {
          watch = clone(DEFAULT_WATCH); saveWatch(); renderList(); loadQuotesFor(watch.map(w => w.k)); toast('已恢复默认自选');
        }
      });
      f('sSec').addEventListener('change', e => {
        S.refreshSec = clamp(Math.round(+e.target.value) || 60, 10, 3600);
        saveSettings(); schedule(); renderSub(); draw();
      });
      f('sTr').addEventListener('change', e => { S.tradingOnly = e.target.checked; saveSettings(); renderSub(); });
    },
  });
}

/* =====================================================================
   事件 / 启动
   ===================================================================== */
document.addEventListener('click', e => {
  const th = e.target.closest('#thead [data-sort]');
  if (th) {
    const k = th.dataset.sort;
    if (edit) { edit = false; }
    if (sortKey !== k) { sortKey = k; sortDir = 1; } else if (sortDir === 1) sortDir = -1; else { sortKey = ''; sortDir = 0; }
    renderHead(); renderList(); renderSub(); return;
  }
  const a = e.target.closest('#top [data-act]');
  if (a) {
    ({ search: openSearch, refresh: () => refresh(true), edit: () => setEdit(!edit), settings: openSettings })[a.dataset.act]();
    return;
  }
  const row = e.target.closest('#list .row');
  if (row) {
    const k = row.dataset.k, act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'del') { removeWatch(k); return; }
    if (act && act.dataset.act === 'top') {
      const i = watch.findIndex(w => w.k === k);
      if (i > 0) { watch.unshift(watch.splice(i, 1)[0]); saveWatch(); renderList(); $('#list').scrollTop = 0; }
      return;
    }
    if (!edit) openDetail(k);
  }
});
$('#list').addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle');
  if (h && edit) startDrag(e, h.closest('.row'));
});

$$('[data-icon]').forEach(x => { x.innerHTML = I[x.dataset.icon] || ''; });
applyTheme(); fitViewport();
renderHead(); renderList(); renderSub();
schedule();
refresh(false);
