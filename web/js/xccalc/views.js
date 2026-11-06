// xCCalc views: 1-bit framebuffer, charts (bar/line/pie, PNG export) and the Atari view (what ACCalc would show).
(function () {
  'use strict';
  const XA = window.XA, C = XA.C, $ = XA.$;
  const V = XA.views = {};
  const font = (window.XCC_DATA && window.XCC_DATA.font4) || [];

  class FB {
    constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h); }
    px(x, y, v) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = v === undefined ? 1 : v; }
    line(x0, y0, x1, y1) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (;;) { this.px(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    rect(x, y, w, h) { this.line(x, y, x + w - 1, y); this.line(x, y + h - 1, x + w - 1, y + h - 1); this.line(x, y, x, y + h - 1); this.line(x + w - 1, y, x + w - 1, y + h - 1); }
    fill(x, y, w, h, pat, inv) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (!pat || pat(i, j)) this.px(i, j, inv ? 0 : 1);
    }
    glyph(ch, x, y, inv) {
      let code = ch.charCodeAt(0); if (code < 32 || code > 127) code = 63;
      const g = font[code - 32] || [];
      for (let j = 0; j < 7; j++) for (let i = 0; i < 4; i++) { const on = (g[j] >> (3 - i)) & 1; this.px(x + i, y + j, inv ? 1 - on : on); }
    }
    text(s, x, y, pitch, inv) { for (let i = 0; i < s.length; i++) this.glyph(s[i], x + i * (pitch || 5), y, inv); }
    toImage(scale, canvas) {
      const c = canvas || document.createElement('canvas'); c.width = this.w * scale; c.height = this.h * scale;
      const g = c.getContext('2d'), im = g.createImageData(c.width, c.height);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const v = this.d[((y / scale) | 0) * this.w + ((x / scale) | 0)] ? 0 : 255, o = (y * c.width + x) * 4;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255;
      }
      g.putImageData(im, 0, 0); return c;
    }
  }
  V.FB = FB;

  // ---------- charts ----------
  const PATS = [null, (x, y) => (x + y) % 2 === 0, (x, y) => (x + y) % 4 === 0, (x, y) => y % 2 === 0, (x, y) => x % 2 === 0, (x, y) => (x - y) % 4 === 0];
  function chartData(wb, ch) {
    const rg = C.parseRange(ch.range || ''); if (!rg) return null;
    const si = ch.sheet === undefined ? XA.s : (typeof ch.sheet === 'number' ? ch.sheet : wb.sheetIndex(ch.sheet));
    const get = (r, c) => { const x = wb.cell(si, r, c); return x && x.val !== null && x.val !== undefined ? x.val : null; };
    const num = (v) => (typeof v === 'number' ? v : null);
    const hasCat = rg.c2 > rg.c1 && typeof get(rg.r1 + 1, rg.c1) === 'string' || (rg.c2 > rg.c1 && get(rg.r1 + 1, rg.c1) === null && typeof get(rg.r1, rg.c1) === 'string');
    let top = rg.r1, left = rg.c1;
    const hasHead = rg.r2 > rg.r1 && num(get(rg.r1, rg.c2)) === null && typeof get(rg.r1, rg.c2) === 'string';
    const cats = [], series = [];
    if (hasHead) top++;
    if (hasCat) left++;
    for (let r = top; r <= rg.r2; r++) cats.push(hasCat ? String(wb.display(si, r, rg.c1)) : String(r - top + 1));
    for (let c = left; c <= rg.c2; c++) {
      const vals = []; for (let r = top; r <= rg.r2; r++) vals.push(num(get(r, c)) || 0);
      series.push({ name: hasHead ? String(wb.display(si, rg.r1, c)) : C.colName(c), vals });
    }
    return { cats, series };
  }
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  V.renderChart = (wb, ch) => {
    const fb = new FB(320, 192), d = chartData(wb, ch);
    fb.rect(0, 0, 320, 192);
    const title = String(ch.title || '').slice(0, 62); fb.text(title, Math.max(2, (320 - title.length * 5) / 2), 4);
    if (!d || !d.series.length) { fb.text('NO DATA', 130, 90); return fb; }
    const n = d.cats.length, ns = d.series.length;
    if (ch.kind === 'pie') {
      const vals = d.series[0].vals.map((v) => Math.max(0, v)), tot = vals.reduce((a, b) => a + b, 0) || 1, cx = 90, cy = 104, R = 70;
      const bounds = []; let acc = 0; for (const v of vals) { acc += v / tot; bounds.push(acc * Math.PI * 2); }
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        const rr = x * x + y * y; if (rr > R * R) continue;
        let a = Math.atan2(x, -y); if (a < 0) a += Math.PI * 2;
        let k = bounds.findIndex((b) => a <= b); if (k < 0) k = vals.length - 1;
        const p = PATS[k % PATS.length];
        if (!p || p(cx + x, cy + y)) fb.px(cx + x, cy + y);
        if (rr > (R - 1) * (R - 1)) fb.px(cx + x, cy + y);
      }
      let a0 = 0; for (let k = 0; k < vals.length; k++) { fb.line(cx, cy, cx + Math.round(Math.sin(a0) * R), cy - Math.round(Math.cos(a0) * R)); a0 = bounds[k]; }
      for (let k = 0; k < Math.min(n, 14); k++) {
        const y = 24 + k * 10; fb.rect(180, y, 8, 8); fb.fill(181, y + 1, 6, 6, PATS[k % PATS.length] || (() => true));
        fb.text((d.cats[k] + ' ' + Math.round(vals[k] / tot * 100) + '%').slice(0, 26), 192, y + 1);
      }
      return fb;
    }
    const L = 38, T = 26, W = 320 - L - 8, H = 192 - T - 22;
    let mx = 0, mn = 0; for (const s of d.series) for (const v of s.vals) { mx = Math.max(mx, v); mn = Math.min(mn, v); }
    mx = niceMax(mx); if (mn < 0) mn = -niceMax(-mn);
    const yOf = (v) => T + H - ((v - mn) / (mx - mn || 1)) * H;
    fb.line(L, T, L, T + H); fb.line(L, yOf(0), L + W, yOf(0));
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Math.round(yOf(v)); for (let x = L; x < L + W; x += 4) fb.px(x, y); fb.text(String(+v.toPrecision(3)).slice(0, 7).padStart(7), 1, y - 3); }
    const gw = W / n;
    for (let i = 0; i < n; i++) {
      const lab = d.cats[i].slice(0, Math.max(1, Math.floor(gw / 5)));
      fb.text(lab, L + i * gw + (gw - lab.length * 5) / 2, T + H + 4);
    }
    if (ch.kind === 'line') {
      d.series.forEach((s, k) => {
        let px = null, py = null;
        s.vals.forEach((v, i) => { const x = L + gw * (i + .5), y = yOf(v); if (px !== null) fb.line(px, py, x, y); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (k % 2 === 0 || (a + b) % 2 === 0) fb.px(x + a, y + b); px = x; py = y; });
      });
    } else {
      const bw = Math.max(2, Math.floor(gw * .8 / ns));
      d.series.forEach((s, k) => s.vals.forEach((v, i) => {
        const x = Math.round(L + gw * i + (gw - bw * ns) / 2 + k * bw), y0 = Math.round(yOf(0)), y1 = Math.round(yOf(v));
        const top = Math.min(y0, y1), h = Math.abs(y0 - y1) + 1;
        fb.rect(x, top, bw, h); const p = PATS[k % PATS.length]; if (p) fb.fill(x + 1, top + 1, bw - 2, h - 2, p);
      }));
    }
    if (ns > 1) d.series.forEach((s, k) => { const x = L + 6 + k * 70; fb.rect(x, 14, 6, 6); const p = PATS[k % PATS.length]; if (p) fb.fill(x + 1, 15, 4, 4, p); fb.text(s.name.slice(0, 11), x + 9, 13); });
    return fb;
  };
  V.chartPng = (wb, ch) => new Promise((res) => { V.renderChart(wb, ch).toImage(3).toBlob((b) => b.arrayBuffer().then((a) => res(new Uint8Array(a))), 'image/png'); });

  V.renderCharts = () => {
    const list = $('chlist'); if (!list) return;
    const wb = XA.wb, items = wb.charts || [];
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<div class="muted" style="padding:10px">No charts yet. Select a range and press Chart.</div>'; return; }
    items.forEach((ch, i) => {
      const box = document.createElement('div'); box.className = 'chbox';
      const cv = V.renderChart(wb, ch).toImage(2); cv.className = 'chimg'; cv.dataset.chart = i;
      const bar = document.createElement('div'); bar.className = 'chbar';
      bar.innerHTML = '<b>' + XA.esc(ch.title || ch.kind) + '</b> <span class="muted">' + XA.esc(ch.kind + ' ' + ch.range) + '</span>';
      const mk = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; bar.appendChild(b); };
      mk('PNG', async () => XA.download(await V.chartPng(wb, ch), (ch.title || 'chart').replace(/\W+/g, '_') + '.png', 'image/png'));
      mk('Kind', () => { ch.kind = ch.kind === 'bar' ? 'line' : ch.kind === 'line' ? 'pie' : 'bar'; XA.dirty = true; XA.emit('history'); V.renderCharts(); });
      mk('Delete', () => { wb.charts.splice(i, 1); XA.dirty = true; V.renderCharts(); });
      box.append(bar, cv); list.appendChild(box);
    });
  };
  V.addChart = (kind) => {
    const q = XA.opRect(); if (q.r1 === q.r2 && q.c1 === q.c2) { XA.toast('Select a data range first'); return; }
    const rng = C.colName(q.c1) + (q.r1 + 1) + ':' + C.colName(q.c2) + (q.r2 + 1);
    (XA.wb.charts = XA.wb.charts || []).push({ kind, sheet: XA.s, title: 'Chart ' + rng, range: rng, row: 0, col: 0, w: 8, h: 12 });
    XA.dirty = true; document.body.classList.add('charts'); V.renderCharts(); XA.toast('Chart added');
  };

  // ---------- Atari view ----------
  const ROWS = 21, LINES = 24, PITCH = 5;
  V.atari = { top: 0, left: 0 };
  function limits() {
    const wb = XA.wb, out = [], A = C.ATARI_FUNCS; let cells = 0, maxr = 0, bad = new Set(), nonlat = 0;
    if (wb.sheets.length > 4) out.push('More than 4 sheets (' + wb.sheets.length + ')');
    wb.sheets.forEach((s, i) => {
      const b = wb.bounds(i); maxr = Math.max(maxr, b.rows);
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
        const x = wb.cell(i, r, c); if (!x || x.val === null || x.val === undefined) continue; cells++;
        if (typeof x.val === 'string' && /[^\x00-\xff]/.test(x.val)) nonlat++;
        if (x.f) { const re = /([A-Z][A-Z0-9.]*)\(/g; let m; while ((m = re.exec(String(x.f).toUpperCase()))) if (!(A instanceof Set ? A.has(m[1]) : Array.isArray(A) ? A.includes(m[1]) : A && m[1] in A)) bad.add(m[1]); }
      }
    });
    if (cells > 65535) out.push('Over 65535 cells (' + cells + ')');
    if (maxr > 255) out.push('Rows beyond 255 (' + maxr + ')');
    if (bad.size) out.push('Functions ACCalc lacks: ' + [...bad].join(', '));
    if (nonlat) out.push(nonlat + ' cell(s) with non-Latin-1 text');
    let size = 0;
    try { size = XA.F.toBinary(wb).bytes.length; } catch (e) { out.push(e.code === 'xcs-too-big' ? '.xcs payload over 65535 bytes' : 'xcs: ' + e.message); }
    if (wb.mode !== 'bcd') out.push('Number mode is IEEE; Atari uses BCD (switch Numbers to Atari BCD to preview)');
    return { out, size, cells };
  }
  V.drawAtari = () => {
    const wb = XA.wb, si = XA.s, s = wb.sheets[si], fb = new FB(320, 192), A = V.atari, sel = XA.sel;
    const colW = (c) => Math.max(3, Math.min(30, wb.colWidth(si, c)));
    const avail = 64 - 4;
    if (sel.r < A.top) A.top = sel.r; if (sel.r >= A.top + ROWS) A.top = sel.r - ROWS + 1;
    if (sel.c < A.left) A.left = sel.c;
    const cols = (l) => { const a = []; let w = 0; for (let c = l; c < C.MAXCOL; c++) { if (w + colW(c) > avail && a.length) break; a.push(c); w += colW(c); } return a; };
    while (A.left < sel.c && !cols(A.left).includes(sel.c)) A.left++;
    const cs = cols(A.left);
    const head = C.colName(sel.c) + (sel.r + 1) + ' ' + wb.editText(si, sel.r, sel.c); fb.text(head.slice(0, 64), 0, 0, PITCH);
    fb.line(0, 8, 319, 8);
    let x = 4 * PITCH; const xs = [];
    cs.forEach((c) => { xs.push(x); const w = colW(c), l = C.colName(c), on = c === sel.c; const lx = x + Math.floor((w - l.length) / 2) * PITCH; if (on) fb.fill(x, 9, w * PITCH, 8, null); fb.text(l, lx, 9, PITCH, on); x += w * PITCH; });
    for (let k = 0; k < ROWS; k++) {
      const r = A.top + k, y = 17 + k * 8, on = r === sel.r, lab = String(r + 1).padStart(3);
      if (on) fb.fill(0, y, 4 * PITCH, 8); fb.text(lab, 0, y + 1, PITCH, on);
      cs.forEach((c, j) => {
        const w = colW(c), cur = on && c === sel.c; let t = wb.display(si, r, c);
        const v = wb.cell(si, r, c); if (!t) { if (cur) fb.fill(xs[j], y, w * PITCH, 8); return; }
        const isNum = v && typeof v.val === 'number';
        if (t.length > w) t = isNum ? '#'.repeat(w) : t.slice(0, w);
        const al = wb.align(si, r, c), off = al === 'r' ? w - t.length : al === 'c' ? Math.floor((w - t.length) / 2) : 0;
        if (cur) fb.fill(xs[j], y, w * PITCH, 8);
        fb.text(t, xs[j] + off * PITCH, y + 1, PITCH, cur);
      });
    }
    fb.line(0, 184, 319, 184); fb.text((s.name || 'Sheet').slice(0, 12) + ' ' + (wb.mode === 'bcd' ? 'BCD' : 'IEEE'), 2, 185, PITCH);
    const lim = limits(), st = lim.cells + ' cells ' + lim.size + 'b';
    fb.text(st, 318 - st.length * PITCH, 185, PITCH);
    fb.toImage(1, $('atcanvas'));
    const pct = Math.min(100, Math.round(lim.size / 655.35));
    $('meter').innerHTML = '<div style="width:' + pct + '%"></div>';
    $('fittext').textContent = lim.size + ' of 65535 bytes (' + pct + '%) in .xcs, ' + lim.cells + ' cells';
    $('warns').innerHTML = lim.out.length ? lim.out.map((w) => '<li>' + XA.esc(w) + '</li>').join('') : '<li class="ok">Fits ACCalc limits</li>';
  };
  V.atariKey = (e) => {
    if (!document.body.classList.contains('m-atari')) return;
    const k = e.key, d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageDown: [ROWS, 0], PageUp: [-ROWS, 0] }[k];
    if (!d) return;
    e.preventDefault(); const s = XA.sel; XA.select(Math.max(0, s.r + d[0]), Math.max(0, Math.min(C.MAXCOL - 1, s.c + d[1])), Math.max(0, s.r + d[0]), Math.max(0, Math.min(C.MAXCOL - 1, s.c + d[1])));
  };
  V.refresh = () => {
    if (document.body.classList.contains('m-atari')) V.drawAtari();
    if (document.body.classList.contains('charts')) V.renderCharts();
  };
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(V.refresh, 60); };
  for (const ev of ['change', 'select', 'sheets', 'mode', 'book', 'layout']) XA.on(ev, later);
  document.addEventListener('keydown', V.atariKey);
})();
