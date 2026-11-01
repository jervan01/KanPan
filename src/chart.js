'use strict';
/* =====================================================================
   KanPan 图表：canvas 绘制 K 线（均线 / 成交量 / 均量线）与分时图
   手势：拖动平移 · 双指缩放 · 长按显示十字光标（再点一下收起）
   ===================================================================== */
class Chart {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'k';
    this.bars = []; this.n = 0; this.end = 0; this.vis = 80;
    this.cfg = { maP: [], maV: [], showVol: true, dec: 2, kind: '股票' };
    this.ma = {}; this.vma = {};
    this.pts = []; this.prev = 0;
    this.cross = null;               // {i, x, y}
    this.msg = '';
    this.ptrs = new Map();
    this.g = null;
    this.onZoom = null;
    this._raf = 0;
    this._lay = null;
    this.W = 0; this.H = 0;
    this.bind();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); }
    this.resize();
  }
  destroy() { if (this.ro) this.ro.disconnect(); cancelAnimationFrame(this._raf); this.canvas.remove(); }

  /* ---------- 数据 ---------- */
  setK(o, reset) {
    this.mode = 'k'; this.msg = '';
    const atEnd = reset || this.end >= this.n;
    this.bars = o.bars || []; this.n = this.bars.length;
    this.cfg = { maP: o.maP || [], maV: o.maV || [], showVol: o.showVol !== false, dec: o.dec || 2, kind: o.kind || '股票' };
    if (o.vis) this.vis = o.vis;
    this.calc();
    this.end = atEnd ? this.n : Math.min(this.end, this.n);
    if (reset) this.cross = null;
    this.invalidate();
  }
  setM(o, reset) {
    this.mode = 'm'; this.msg = '';
    this.pts = o.pts || []; this.prev = o.prev || 0;
    this.cfg = { maP: [], maV: [], showVol: o.showVol !== false, dec: o.dec || 2, kind: o.kind || '股票' };
    if (reset) this.cross = null;
    this.invalidate();
  }
  setMessage(m) { this.msg = m; this.invalidate(); }
  calc() {
    const c = this.bars.map(b => b.c), v = this.bars.map(b => b.v);
    this.ma = {}; this.vma = {};
    this.cfg.maP.forEach(n => { this.ma[n] = sma(c, n); });
    this.cfg.maV.forEach(n => { this.vma[n] = sma(v, n); });
  }

  /* ---------- 尺寸 / 重绘调度 ---------- */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(0, this.host.clientWidth); this.H = Math.max(0, this.host.clientHeight);
    this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate();
  }
  invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }
  theme() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim() || '#888';
    return { bg: g('--bg'), card: g('--bg2'), fg: g('--fg'), fg2: g('--fg2'), line: g('--line'), up: g('--up'), down: g('--down'), minute: g('--minute'), avg: g('--avg') };
  }
  draw() {
    const { ctx, W, H } = this;
    if (!W || !H) return;
    const t = this.g = this.theme();
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    if (this.msg) { this.empty(this.msg); return; }
    if (this.mode === 'k') this.drawK(t); else this.drawM(t);
  }
  empty(text) {
    const { ctx, W, H } = this;
    ctx.fillStyle = this.g.fg2; ctx.textAlign = 'center'; ctx.font = '14px system-ui,sans-serif';
    ctx.fillText(text, W / 2, H / 2); ctx.textAlign = 'left';
  }

  /* ---------- 小工具 ---------- */
  line(x1, y1, x2, y2, color, w = 1, dash) {
    const { ctx } = this;
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.setLineDash(dash || []);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
  }
  tag(text, x, y, bg, fg, align = 'left') {   // 带底色的小标签（坐标轴 / 十字光标）
    const { ctx } = this;
    const w = ctx.measureText(text).width + 8;
    const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    ctx.fillStyle = bg; ctx.fillRect(x0, y - 8, w, 16);
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, x0 + 4, y);
  }
  legendRows(items, maxW) {          // 预先算出需要几行，避免图例被截断
    const { ctx } = this;
    let rows = 1, x = 4;
    for (const [text] of items) {
      const w = ctx.measureText(text).width + 8;
      if (x + w > maxW && x > 4) { rows++; x = 4; }
      x += w;
    }
    return rows;
  }
  legend(items, x, y, maxW, lh = 14) {
    const { ctx } = this;
    ctx.textAlign = 'left';
    const x0 = x;
    for (const [text, color] of items) {
      const w = ctx.measureText(text).width + 8;
      if (x + w > maxW && x > x0) { x = x0; y += lh; }
      ctx.fillStyle = color; ctx.fillText(text, x, y); x += w;
    }
  }
  box(lines, side, t) {            // 十字光标信息框
    const { ctx, W } = this;
    const pad = 6, lh = 15;
    const w = Math.max(...lines.map(l => ctx.measureText(l[0] + '  ' + l[1]).width)) + pad * 2 + 4;
    const h = lines.length * lh + pad * 2 - 2;
    const x = side === 'left' ? 6 : W - w - (this.mode === 'k' ? 60 : 6), y = 24;
    ctx.save(); ctx.globalAlpha = .94; ctx.fillStyle = t.card; ctx.strokeStyle = t.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke(); ctx.restore();
    lines.forEach((l, i) => {
      const yy = y + pad + i * lh + 6;
      ctx.textAlign = 'left'; ctx.fillStyle = t.fg2; ctx.fillText(l[0], x + pad, yy);
      ctx.textAlign = 'right'; ctx.fillStyle = l[2] || t.fg; ctx.fillText(l[1], x + w - pad, yy);
    });
    ctx.textAlign = 'left';
  }

  /* =================================================================
     K 线
     ================================================================= */
  drawK(t) {
    const { ctx, W, H, cfg, bars, n } = this;
    if (!n) { this.empty('暂无数据'); return; }
    const dec = cfg.dec, axisW = 56, plotW = W - axisW, botH = 16;
    // 顶部均线图例：全选 8 条时会换行，按需增高
    const maItems = cfg.maP.map(m => ['MA' + m + ' 000000.00', '']);
    const topH = 6 + 14 * (maItems.length ? this.legendRows(maItems, plotW) : 1);
    let priceBot, volTop = 0, volBot = 0;
    if (cfg.showVol) {
      const vRows = this.legendRows([['成交量 0000.00万手', '']].concat(cfg.maV.map(m => ['V' + m + ' 0000.00万', ''])), plotW);
      const gap = 4 + 14 * vRows;
      const avail = H - topH - botH - gap;
      priceBot = topH + Math.round(avail * 0.7); volTop = priceBot + gap; volBot = H - botH;
    } else priceBot = H - botH;
    const priceTop = topH, priceH = priceBot - priceTop;
    const vis = Math.max(1, Math.min(this.vis, n));
    const end = clamp(this.end, vis, n), start = end - vis;
    this.end = end;
    const barW = plotW / vis, xOf = i => (i - start + 0.5) * barW;
    this._lay = { axisW, plotW, start, end, vis, barW, priceTop, priceBot, volTop, volBot };

    // 价格范围（只按可见 K 线）
    let hi = -Infinity, lo = Infinity, hiI = start, loI = start;
    for (let i = start; i < end; i++) {
      if (bars[i].h > hi) { hi = bars[i].h; hiI = i; }
      if (bars[i].l < lo) { lo = bars[i].l; loI = i; }
    }
    const pad = (hi - lo) * 0.07 || hi * 0.01;
    const top = hi + pad, bot = lo - pad;
    const yP = p => priceTop + (top - p) / (top - bot) * priceH;
    const pOf = y => top - (y - priceTop) / priceH * (top - bot);

    // 网格 + 右侧价格轴
    ctx.textAlign = 'left';
    for (let k = 0; k <= 4; k++) {
      const y = priceTop + priceH * k / 4, p = top - (top - bot) * k / 4;
      this.line(0, y, plotW, y, t.line, 1);
      ctx.fillStyle = t.fg2; ctx.fillText(p.toFixed(dec), plotW + 4, clamp(y, priceTop + 6, priceBot - 6));
    }
    this.line(plotW, priceTop, plotW, volBot || priceBot, t.line, 1);

    // X 轴日期 + 竖向网格
    const lbl = this.dateLabel.bind(this);
    ctx.fillStyle = t.fg2; ctx.textAlign = 'center';
    for (let k = 0; k < 4; k++) {
      const i = clamp(start + Math.floor(vis * (k + 0.5) / 4), start, end - 1), x = xOf(i);
      this.line(x, priceTop, x, volBot || priceBot, t.line, 1, [2, 4]);
      ctx.fillStyle = t.fg2; ctx.fillText(lbl(bars[i].d), clamp(x, 26, plotW - 26), H - botH / 2);
    }
    ctx.textAlign = 'left';

    // 蜡烛（涨红跌绿）
    const bw = Math.max(1, Math.floor(barW * 0.72));
    for (let i = start; i < end; i++) {
      const b = bars[i], pc = i > 0 ? bars[i - 1].c : b.o;
      const up = b.c > b.o || (b.c === b.o && b.c >= pc);
      const col = up ? t.up : t.down, x = Math.round(xOf(i));
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + .5, yP(b.h)); ctx.lineTo(x + .5, yP(b.l)); ctx.stroke();
      const y1 = yP(Math.max(b.o, b.c)), y2 = yP(Math.min(b.o, b.c));
      ctx.fillRect(Math.round(x - bw / 2), y1, bw, Math.max(1, y2 - y1));
    }

    // 均价线（裁剪在价格区内）
    ctx.save(); ctx.beginPath(); ctx.rect(0, priceTop, plotW, priceH); ctx.clip();
    for (const m of cfg.maP) {
      const arr = this.ma[m]; if (!arr) continue;
      ctx.beginPath(); ctx.strokeStyle = MA_COLORS[m] || '#999'; ctx.lineWidth = 1.2;
      let pen = false;
      for (let i = start; i < end; i++) {
        if (arr[i] == null) { pen = false; continue; }
        const x = xOf(i), y = yP(arr[i]);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 最高 / 最低标注
    ctx.font = '10px system-ui,sans-serif'; ctx.fillStyle = t.fg2;
    const mark = (i, p, above) => {
      const x = xOf(i), s = p.toFixed(dec), w = ctx.measureText(s).width;
      const right = x + w + 8 < plotW;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillText((right ? '←' : '') + s + (right ? '' : '→'), x + (right ? 2 : -2), clamp(yP(p) + (above ? -8 : 8), priceTop + 6, priceBot - 6));
    };
    mark(hiI, hi, true); if (loI !== hiI) mark(loI, lo, false);
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left';

    // 最新价虚线 + 轴标签
    if (end === n) {
      const last = bars[n - 1], pc = n > 1 ? bars[n - 2].c : last.o;
      const col = last.c >= pc ? t.up : t.down, y = yP(last.c);
      this.line(0, y, plotW, y, col, 1, [3, 3]);
      this.tag(last.c.toFixed(dec), plotW + 1, clamp(y, priceTop + 8, priceBot - 8), col, '#fff');
    }

    // 成交量 + 均量线
    const ci = this.cross && this.cross.i >= start && this.cross.i < end ? this.cross.i : -1;
    const li = ci >= 0 ? ci : end - 1;
    if (cfg.showVol) {
      let vmax = 0;
      for (let i = start; i < end; i++) {
        vmax = Math.max(vmax, bars[i].v);
        for (const m of cfg.maV) { const a = this.vma[m]; if (a && a[i] != null) vmax = Math.max(vmax, a[i]); }
      }
      vmax = (vmax || 1) * 1.08;
      const vh = volBot - volTop, yV = v => volBot - v / vmax * vh;
      this.line(0, volTop, plotW, volTop, t.line, 1); this.line(0, volBot, plotW, volBot, t.line, 1);
      for (let i = start; i < end; i++) {
        const b = bars[i], pc = i > 0 ? bars[i - 1].c : b.o;
        const up = b.c > b.o || (b.c === b.o && b.c >= pc);
        ctx.fillStyle = up ? t.up : t.down;
        const x = Math.round(xOf(i) - bw / 2), y = yV(b.v);
        ctx.fillRect(x, y, bw, Math.max(1, volBot - y));
      }
      ctx.save(); ctx.beginPath(); ctx.rect(0, volTop, plotW, vh); ctx.clip();
      for (const m of cfg.maV) {
        const arr = this.vma[m]; if (!arr) continue;
        ctx.beginPath(); ctx.strokeStyle = MA_COLORS[m] || '#999'; ctx.lineWidth = 1.2;
        let pen = false;
        for (let i = start; i < end; i++) {
          if (arr[i] == null) { pen = false; continue; }
          const x = xOf(i), y = yV(arr[i]);
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = t.fg2; ctx.textAlign = 'left';
      ctx.fillText(fmtBig(vmax / 1.08), plotW + 4, volTop + 8);
      const items = [['成交量 ' + fmtVol(bars[li].v), t.fg2]];
      cfg.maV.forEach(m => { const a = this.vma[m]; items.push(['V' + m + ' ' + (a && a[li] != null ? fmtBig(a[li]) : '--'), MA_COLORS[m]]); });
      this.legend(items, 4, priceBot + 8, plotW);
    }

    // 均线图例（顶部）
    const items = [];
    cfg.maP.forEach(m => { const a = this.ma[m]; items.push(['MA' + m + ' ' + (a && a[li] != null ? a[li].toFixed(dec) : '--'), MA_COLORS[m]]); });
    this.legend(items, 4, 10, plotW);

    // 十字光标
    if (ci >= 0) {
      const b = bars[ci], pb = ci > 0 ? bars[ci - 1] : null;
      const x = xOf(ci), y = this.cross.y;
      this.line(x, priceTop, x, volBot || priceBot, t.fg2, 1, [4, 3]);
      if (y >= priceTop && y <= priceBot) {
        this.line(0, y, plotW, y, t.fg2, 1, [4, 3]);
        this.tag(pOf(y).toFixed(dec), plotW + 1, y, t.fg2, t.bg);
      }
      this.tag(this.dateLabel(b.d, true), clamp(x, 40, plotW - 40), H - botH / 2, t.fg2, t.bg, 'center');
      const pc = pb ? pb.c : b.o, pct = (b.c - pc) / pc * 100;
      const cc = pct >= 0 ? t.up : t.down;
      this.box([
        ['日期', b.d], ['开盘', b.o.toFixed(dec), b.o >= pc ? t.up : t.down], ['最高', b.h.toFixed(dec), b.h >= pc ? t.up : t.down],
        ['最低', b.l.toFixed(dec), b.l >= pc ? t.up : t.down], ['收盘', b.c.toFixed(dec), cc],
        ['涨跌幅', fmtPct(pct), cc], ['成交量', fmtVol(b.v)],
      ], x < W / 2 ? 'right' : 'left', t);
    }
  }
  dateLabel(d, full) {
    if (full) return d;
    return d.length >= 10 ? d.slice(2) : d;   // yy-mm-dd
  }

  /* =================================================================
     分时
     ================================================================= */
  drawM(t) {
    const { ctx, W, H, cfg, pts } = this;
    const prev = this.prev || (pts[0] && pts[0].p) || 0;
    if (!pts.length || !prev) { this.empty('暂无分时数据（未开盘或停牌）'); return; }
    const dec = cfg.dec, topH = 8, botH = 16, plotW = W;
    let priceBot, volTop = 0, volBot = 0;
    if (cfg.showVol) { const avail = H - topH - botH - 14; priceBot = topH + Math.round(avail * 0.72); volTop = priceBot + 14; volBot = H - botH; }
    else priceBot = H - botH;
    const priceTop = topH, priceH = priceBot - priceTop;
    const sw = plotW / 240, xOf = i => i * sw;
    this._lay = { sw, plotW, priceTop, priceBot, volTop, volBot };

    let dev = 0;
    for (const p of pts) { dev = Math.max(dev, Math.abs(p.p - prev)); if (p.a) dev = Math.max(dev, Math.abs(p.a - prev)); }
    dev = Math.max(dev, prev * 0.002) * 1.08;
    const hi = prev + dev, lo = prev - dev;
    const yP = p => priceTop + (hi - p) / (hi - lo) * priceH;

    // 网格与两侧坐标
    for (let k = 0; k <= 4; k++) {
      const y = priceTop + priceH * k / 4, p = hi - (hi - lo) * k / 4, pct = (p - prev) / prev * 100;
      this.line(0, y, plotW, y, t.line, 1, k === 2 ? [4, 3] : undefined);
      const col = k < 2 ? t.up : k > 2 ? t.down : t.fg2, yy = clamp(y, priceTop + 7, priceBot - 7);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(p.toFixed(dec), 3, yy);
      ctx.textAlign = 'right'; ctx.fillText(fmtPct(pct).replace('+', ''), plotW - 3, yy);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = t.fg2;
    [[0, '09:30', 'left'], [120, '11:30/13:00', 'center'], [240, '15:00', 'right']].forEach(([i, s, al]) => {
      const x = xOf(i);
      if (i === 120) this.line(x, priceTop, x, volBot || priceBot, t.line, 1, [2, 4]);
      ctx.textAlign = al; ctx.fillText(s, al === 'left' ? 2 : al === 'right' ? plotW - 2 : x, H - botH / 2);
    });
    ctx.textAlign = 'left';

    // 价格线 + 渐变填充
    ctx.beginPath();
    pts.forEach((p, k) => { const x = xOf(p.i), y = yP(p.p); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = t.minute; ctx.lineWidth = 1.4; ctx.stroke();
    const lastP = pts[pts.length - 1];
    ctx.lineTo(xOf(lastP.i), priceBot); ctx.lineTo(xOf(pts[0].i), priceBot); ctx.closePath();
    const gr = ctx.createLinearGradient(0, priceTop, 0, priceBot);
    gr.addColorStop(0, 'rgba(90,160,255,.22)'); gr.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = gr; ctx.fill();

    // 均价线
    if (pts.some(p => p.a)) {
      ctx.beginPath(); ctx.strokeStyle = t.avg; ctx.lineWidth = 1.2;
      let pen = false;
      pts.forEach(p => { if (!p.a) return; const x = xOf(p.i), y = yP(p.a); if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y); });
      ctx.stroke();
    }

    // 成交量
    if (cfg.showVol) {
      const vmax = Math.max(1, ...pts.map(p => p.v)) * 1.08, vh = volBot - volTop, bw = Math.max(1, sw * 0.7);
      this.line(0, volTop, plotW, volTop, t.line, 1); this.line(0, volBot, plotW, volBot, t.line, 1);
      let pp = prev;
      for (const p of pts) {
        ctx.fillStyle = p.p >= pp ? t.up : t.down; pp = p.p;
        const h = Math.max(1, p.v / vmax * vh);
        ctx.fillRect(xOf(p.i) - bw / 2, volBot - h, bw, h);
      }
      ctx.fillStyle = t.fg2; ctx.textAlign = 'left';
      ctx.fillText('成交量 ' + fmtBig(pts.reduce((s, p) => s + p.v, 0), '手'), 4, priceBot + 7);
    }

    // 十字光标
    if (this.cross) {
      const p = this.nearest(this.cross.i);
      if (p) {
        const x = xOf(p.i), y = yP(p.p), pct = (p.p - prev) / prev * 100, cc = pct >= 0 ? t.up : t.down;
        this.line(x, priceTop, x, volBot || priceBot, t.fg2, 1, [4, 3]);
        this.line(0, y, plotW, y, t.fg2, 1, [4, 3]);
        ctx.fillStyle = t.minute; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        const lines = [['时间', p.t.slice(0, 2) + ':' + p.t.slice(2)], ['价格', p.p.toFixed(dec), cc], ['涨跌幅', fmtPct(pct), cc]];
        if (p.a) lines.push(['均价', p.a.toFixed(dec), t.avg]);
        lines.push(['成交量', fmtVol(p.v)]);
        this.box(lines, x < W / 2 ? 'right' : 'left', t);
      }
    }
  }
  nearest(slot) {
    let best = null, bd = 1e9;
    for (const p of this.pts) { const d = Math.abs(p.i - slot); if (d < bd) { bd = d; best = p; } }
    return bd <= 3 ? best : null;
  }

  /* =================================================================
     手势
     ================================================================= */
  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  hit(x, y) {   // 触点 → 十字光标
    const L = this._lay; if (!L) return null;
    if (this.mode === 'k') {
      if (!this.n) return null;
      return { i: clamp(L.start + Math.floor(x / L.barW), L.start, L.end - 1), x, y };
    }
    return { i: clamp(Math.round(x / L.sw), 0, 240), x, y };
  }
  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const p = this.pos(e);
      this.ptrs.set(e.pointerId, { x: p.x, y: p.y });
      if (this.ptrs.size === 2 && this.mode === 'k') {
        clearTimeout(this.g_timer); this.gesture = 'pinch';
        const [a, b] = [...this.ptrs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, vis: this.vis };
        this.cross = null; return;
      }
      if (this.ptrs.size > 1) return;
      this.start = { x: p.x, y: p.y, end: this.end, hadCross: !!this.cross };
      this.gesture = 'pending';
      clearTimeout(this.g_timer);
      this.g_timer = setTimeout(() => {
        if (this.gesture === 'pending') { this.gesture = 'cross'; this.cross = this.hit(this.start.x, this.start.y); this.invalidate(); }
      }, 320);
    });
    c.addEventListener('pointermove', e => {
      if (!this.ptrs.has(e.pointerId)) return;
      const p = this.pos(e);
      this.ptrs.set(e.pointerId, { x: p.x, y: p.y });
      if (this.gesture === 'pinch' && this.ptrs.size >= 2) {
        const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.vis = clamp(Math.round(this.pinch.vis * this.pinch.d / d), 20, Math.max(20, Math.min(300, this.n)));
        this.invalidate(); return;
      }
      if (this.gesture === 'pending') {
        if (Math.hypot(p.x - this.start.x, p.y - this.start.y) < 8) return;
        clearTimeout(this.g_timer);
        if (this.start.hadCross || this.cross) this.gesture = 'cross';
        else if (this.mode === 'k') this.gesture = 'pan';
        else this.gesture = 'cross';
      }
      if (this.gesture === 'pan' && this._lay) {
        const db = Math.round((p.x - this.start.x) / this._lay.barW);
        this.end = clamp(this.start.end - db, Math.min(this.vis, this.n), this.n);
        this.invalidate();
      } else if (this.gesture === 'cross') {
        this.cross = this.hit(p.x, p.y); this.invalidate();
      }
    });
    const up = e => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      clearTimeout(this.g_timer);
      if (this.gesture === 'pending') {      // 轻点：收起十字光标
        if (this.cross) { this.cross = null; this.invalidate(); }
      }
      if (this.gesture === 'pinch' && this.onZoom) this.onZoom(this.vis);
      if (this.ptrs.size === 0) this.gesture = 'none';
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      if (this.mode !== 'k') return;
      e.preventDefault();
      this.vis = clamp(Math.round(this.vis * (e.deltaY > 0 ? 1.12 : 0.89)), 20, Math.max(20, Math.min(300, this.n)));
      if (this.onZoom) this.onZoom(this.vis);
      this.invalidate();
    }, { passive: false });
  }
}
