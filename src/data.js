'use strict';
/* =====================================================================
   KanPan 数据层：腾讯行情（实时 / K线 / 分时 / 搜索）+ 指标计算 + 工具
   说明：Tauri 下请求由 Rust 侧发出（不受 CORS 限制）；浏览器里直接打开会被跨域拦截。
   ===================================================================== */

/* ---------- 默认数据与配置 ---------- */
const DEFAULT_WATCH = [
  { k: 'sh000001', n: '上证指数' }, { k: 'sz399006', n: '创业板指' }, { k: 'sh000688', n: '科创50' },
  { k: 'sh600519', n: '贵州茅台' }, { k: 'sz300750', n: '宁德时代' }, { k: 'sz300308', n: '中际旭创' },
  { k: 'sz300502', n: '新易盛' }, { k: 'sh603259', n: '药明康德' }, { k: 'sh600276', n: '恒瑞医药' },
  { k: 'sz300760', n: '迈瑞医疗' }, { k: 'sh688981', n: '中芯国际' }, { k: 'sh688256', n: '寒武纪' },
  { k: 'sh688041', n: '海光信息' }, { k: 'sh688836', n: '宇树科技' }, { k: 'sz002050', n: '三花智控' },
  { k: 'sh601689', n: '拓普集团' },
];
const DEFAULT_SETTINGS = {
  refreshSec: 60,        // 自动刷新间隔（秒）
  tradingOnly: true,     // 仅交易时段自动刷新（减少请求，避免被限流）
  maP: [5, 10, 20, 60],  // K 线上显示的均价线
  maV: [5, 10],          // 成交量上显示的均量线
  showVol: true,
  bars: 80,              // 一屏显示的 K 线根数
  period: 'day',         // 打开个股时默认周期：m 分时 / day / week / month
  theme: 'dark',
};
const MA_P_OPTIONS = [5, 10, 20, 30, 60, 90, 120, 250];
const MA_V_OPTIONS = [5, 10, 60, 120];
const MA_COLORS = { 5: '#f0b90b', 10: '#4c9bff', 20: '#c76bff', 30: '#2fd1c5', 60: '#ff8c42', 90: '#a0a9b8', 120: '#7bd88f', 250: '#ff6b9a' };
const PERIODS = [['m', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']];

/* 搜索页的一键添加 */
const QUICK_INDEX = [
  ['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指'], ['sh000688', '科创50'],
  ['sh000300', '沪深300'], ['sh000016', '上证50'], ['sh000905', '中证500'], ['sh000852', '中证1000'], ['bj899050', '北证50'],
];
const QUICK_SECTOR = [
  ['sz399986', '中证银行'], ['sz399975', '证券公司'], ['sz399997', '中证白酒'], ['sz399989', '中证医疗'],
  ['sz399967', '中证军工'], ['sz399808', '中证新能'], ['sz399971', '中证传媒'],
];
const QUICK_ETF = [
  ['sh510300', '沪深300ETF'], ['sh510050', '上证50ETF'], ['sh510500', '500ETF'], ['sz159915', '创业板ETF'],
  ['sh588000', '科创50ETF'], ['sh512480', '半导体ETF'], ['sh512000', '券商ETF'], ['sh512170', '医疗ETF'],
];
const QUICK_WORDS = ['半导体', '芯片', '人工智能', '机器人', '光伏', '新能源车', '医药', '消费', '煤炭', '有色', '房地产', '红利'];

/* ---------- 通用工具 ---------- */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= n) s -= arr[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function guessKind(mk, code) {
  if (mk === 'sh') {
    if (/^000\d{3}$/.test(code) || /^93\d{4}$/.test(code)) return '指数';
    if (/^(50|51|52|56|58)\d{4}$/.test(code)) return 'ETF';
    if (/^(60|68)\d{4}$/.test(code)) return '股票';
  } else if (mk === 'sz') {
    if (/^399\d{3}$/.test(code) || /^98\d{4}$/.test(code)) return '指数';
    if (/^159\d{3}$/.test(code) || /^16\d{4}$/.test(code)) return 'ETF';
    if (/^(00|30)\d{4}$/.test(code)) return '股票';
  } else if (mk === 'bj') {
    if (/^899\d{3}$/.test(code)) return '指数';
    if (/^[489]\d{5}$/.test(code)) return '股票';
  }
  return '';
}
function kindOf(mk, code, type) {
  type = type || '';
  if (type === 'ZS') return '指数';
  const g = guessKind(mk, code);
  if (g) return g;
  if (/^GP/.test(type)) return '股票';
  if (/ETF|LOF/.test(type)) return 'ETF';
  return null;
}
const kindOfKey = k => guessKind(k.slice(0, 2), k.slice(2)) || '股票';
const decOf = kind => (kind === 'ETF' ? 3 : 2);

function fmtPrice(v, dec = 2) { return isFinite(v) && v !== 0 ? v.toFixed(dec) : '--'; }
function fmtPct(p) { if (!isFinite(p)) return '--'; return (p > 0 ? '+' : '') + p.toFixed(2) + '%'; }
function fmtChg(c, dec = 2) { if (!isFinite(c)) return '--'; return (c > 0 ? '+' : '') + c.toFixed(dec); }
function fmtBig(v, unit = '') {
  if (!isFinite(v)) return '--';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿' + unit;
  if (a >= 1e4) return (v / 1e4).toFixed(a >= 1e6 ? 1 : 2) + '万' + unit;
  return v.toFixed(0) + unit;
}
const fmtVol = v => fmtBig(v, '手');            // 成交量：手
const fmtAmt = wan => fmtBig(wan * 1e4, '');    // 成交额：腾讯给的是「万元」
function signClass(x) { return x > 0 ? 'up' : x < 0 ? 'down' : 'flat'; }

/* ---------- 北京时间 / 交易时段 ---------- */
function bjNow(d = new Date()) { return new Date(d.getTime() + (480 + d.getTimezoneOffset()) * 60000); }
function marketState(now = bjNow()) {
  const wd = now.getDay(), m = now.getHours() * 60 + now.getMinutes();
  if (wd === 0 || wd === 6) return { s: '休市', live: false };
  if (m < 555) return { s: '盘前', live: false };
  if (m < 570) return { s: '集合竞价', live: true };
  if (m <= 690) return { s: '交易中', live: true };
  if (m < 780) return { s: '午间休市', live: false };
  if (m <= 900) return { s: '交易中', live: true };
  return { s: '已收盘', live: false };
}
/* 比交易时段略宽，保证开收盘的最后一笔能刷到 */
function inRefreshWindow(now = bjNow()) {
  const wd = now.getDay(), m = now.getHours() * 60 + now.getMinutes();
  if (wd === 0 || wd === 6) return false;
  return (m >= 555 && m <= 692) || (m >= 778 && m <= 903);
}

/* ---------- 网络（带节流，避免被腾讯限制） ---------- */
function netFetch() {
  const t = (typeof window !== 'undefined') && window.__TAURI__;
  return (t && t.http && t.http.fetch) ? t.http.fetch : window.fetch.bind(window);
}
let _chain = Promise.resolve(), _lastReq = 0;
function paced(fn, gap = 180) {   // 所有请求串行，间隔至少 gap 毫秒
  const run = _chain.then(async () => {
    const wait = _lastReq + gap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastReq = Date.now();
    return fn();
  });
  _chain = run.catch(() => {});
  return run;
}
const _inflight = new Map();
function httpText(url, enc = 'utf-8', timeout = 12000) {
  if (_inflight.has(url)) return _inflight.get(url);
  const p = paced(async () => {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await netFetch()(url, { method: 'GET', signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return new TextDecoder(enc).decode(await r.arrayBuffer());
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('请求超时');
      throw e;
    } finally { clearTimeout(tm); }
  }).finally(() => _inflight.delete(url));
  _inflight.set(url, p);
  return p;
}

/* ---------- 实时行情 qt.gtimg.cn（GBK，波浪线分隔） ---------- */
function parseQuotes(text) {
  const out = {}, re = /v_([a-z]{2}\d+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const f = m[2].split('~');
    if (f.length < 35 || !f[1]) continue;
    const num = i => { const x = parseFloat(f[i]); return isFinite(x) ? x : 0; };
    const q = {
      k: m[1], name: f[1], code: f[2], price: num(3), prev: num(4), open: num(5), vol: num(6),
      time: f[30] || '', chg: num(31), pct: num(32), high: num(33), low: num(34),
      amount: num(37), turnover: num(38), pe: num(39), amp: num(43), mcap: num(44), tcap: num(45), pb: num(46),
    };
    if (!q.price && q.prev) { q.price = q.prev; q.chg = 0; q.pct = 0; q.halt = true; }   // 停牌/未开盘
    out[m[1]] = q;
  }
  return out;
}
async function fetchQuotes(keys) {
  keys = Array.from(new Set(keys));
  const out = {};
  for (let i = 0; i < keys.length; i += 50) {
    const txt = await httpText('https://qt.gtimg.cn/q=' + keys.slice(i, i + 50).join(','), 'gbk');
    Object.assign(out, parseQuotes(txt));
  }
  return out;
}

/* ---------- K 线 web.ifzq.gtimg.cn ---------- */
function parseKline(j, k, period) {
  const d = j && j.data && j.data[k];
  if (!d || Array.isArray(d)) return [];
  const arr = d['qfq' + period] || d[period] || d['hfq' + period] || [];
  return arr.map(r => ({ d: String(r[0]), o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    .filter(b => isFinite(b.c) && b.c > 0 && isFinite(b.o) && isFinite(b.h) && isFinite(b.l));
}
async function fetchKline(k, period, count) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + k + ',' + period + ',,,' + count + ',qfq';
  return parseKline(JSON.parse(await httpText(url)), k, period);
}
/* 需要的根数 = 最大均线周期 + 约 140 根可翻看的历史；一次请求，不翻页 */
function klineCount(maP, maV) {
  const mx = Math.max(5, ...(maP || []), ...(maV || []));
  return clamp(mx + 140, 160, 500);
}

/* ---------- 分时 minute/query ---------- */
function minuteSlot(t) {            // 'HHMM' → 0..240（9:30..11:30 → 0..120，13:01..15:00 → 121..240）
  const mins = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2, 4), 10);
  if (mins <= 570) return 0;
  if (mins <= 690) return mins - 570;
  if (mins < 780) return 120;
  return 121 + Math.max(0, mins - 781);
}
function parseMinute(j, k, isIndex) {
  const d = j && j.data && j.data[k];
  const md = d && d.data;
  if (!md || !Array.isArray(md.data)) return { pts: [], date: '', prev: 0 };
  let prevCv = 0;
  const bySlot = new Map();
  for (const s of md.data) {
    const p = String(s).trim().split(/\s+/);
    if (p.length < 2 || !/^\d{4}$/.test(p[0])) continue;
    const price = +p[1], cv = +p[2] || 0, ca = +p[3] || 0;
    if (!(price > 0)) continue;
    const v = cv >= prevCv ? cv - prevCv : cv;
    prevCv = cv;
    let a = null;
    if (!isIndex && cv > 0 && ca > 0) {
      a = ca / (cv * 100);
      if (!(a > price * 0.5 && a < price * 2)) a = null;   // 单位对不上就不画均价线
    }
    const i = minuteSlot(p[0]);
    bySlot.set(i, { i, t: p[0], p: price, v, a });
  }
  const pts = Array.from(bySlot.values()).sort((x, y) => x.i - y.i);
  const qt = d.qt && d.qt[k];
  const prev = qt ? (parseFloat(qt[4]) || 0) : 0;
  return { pts, date: String(md.date || ''), prev };
}
async function fetchMinute(k, isIndex) {
  return parseMinute(JSON.parse(await httpText('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + k)), k, isIndex);
}

/* ---------- 搜索 smartbox ---------- */
function parseSmartbox(txt) {
  const m = String(txt).match(/v_hint="([^"]*)"/);
  if (!m || !m[1] || m[1] === 'N') return [];
  const dec = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const out = [], seen = new Set();
  for (const it of dec(m[1]).split('^')) {
    const [mk, code, name, py, type] = it.split('~');
    if (!['sh', 'sz', 'bj'].includes(mk) || !/^\d{6}$/.test(code || '')) continue;
    const kind = kindOf(mk, code, type);
    if (!kind) continue;
    const key = mk + code;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ k: key, n: name, t: kind });
  }
  return out;
}
async function searchSymbols(q) {
  return parseSmartbox(await httpText('https://smartbox.gtimg.cn/s3/?v=2&t=all&q=' + encodeURIComponent(q)));
}
