// Font sheets (web/fontedit.html "Sheets" tab): glyph charts, size comparison charts and diff sheets as resolution-independent pages,
// then output as SVG (vector), a streamed PNG at 150-4800 dpi (any size, no big canvas) or a canvas preview. DOM-free, UMD: used by
// the editor (window.FESheet), by Node tests (scripts/fontedit-sheets-test.cjs) and tools.
//
// A page is { w, h, ops } in BASE UNITS of 1/150 inch (Letter = 1275 x 1650). Ops are [x, y, w, h, colour] rectangles; a font pixel is
// `zoom` units square. Every dpi in 150/300/600/1200/2400/4800 is a whole multiple of 150, so each unit becomes k x k dots exactly:
// bitmap fonts scale with hard edges, no smoothing and no resampling anywhere.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FESheet = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE_DPI = 150, DPIS = [150, 300, 600, 1200, 2400, 4800];
  const PAPER = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14], a3: [11.69, 16.54], tabloid: [11, 17] };
  const C = { paper: 0, ink: 1, a: 2, b: 3, dim: 4, acc: 5, grid: 6, ok: 7 };
  const PAL = [[255, 255, 255], [20, 22, 26], [214, 48, 49], [41, 98, 214], [120, 126, 138], [232, 140, 0], [214, 218, 226], [0, 140, 76]];
  const hex = (c) => '#' + PAL[c].map((v) => v.toString(16).padStart(2, '0')).join('');

  // ---- bitmap glyph access ----------------------------------------------------------------------------------------------------------
  const advOf = (f, code) => (f.advs && f.advs[f.map[code & 255]]) || f.adv;
  const runCache = new WeakMap();
  // [[row, firstColumn, length], ...] of the set pixels of a glyph (horizontal runs)
  function runsOf(CF, f, code) {
    let m = runCache.get(f); if (!m) runCache.set(f, (m = new Map()));
    const key = code + ':' + (f.glyphs[f.map[code & 255]] || []).join(',');
    let r = m.get(key); if (r) return r;
    r = []; const g = CF.glyph(f, code), cols = CF.colsOf(f, f.map[code & 255]);
    for (let y = 0; y < f.rows; y++) {
      let q = 0; const row = g[y] || 0; if (!row) continue;
      while (q < cols) {
        if (!CF.hasPx(f, row, q)) { q++; continue; }
        let n = 1; while (q + n < cols && CF.hasPx(f, row, q + n)) n++;
        r.push([y, q, n]); q += n;
      }
    }
    if (m.size > 4000) m.clear();
    m.set(key, r); return r;
  }
  const hasInk = (CF, f, code) => (CF.glyph(f, code) || []).some((v) => v);
  const kernAt = (o, f, a, b) => (o && o.kern ? o.kern(f, a, b) || 0 : 0);
  const textWidth = (f, str, o = {}) => {
    let w = 0, prev = -1;
    for (const ch of str) { const c = (o.codeOf || defCode)(ch); w += advOf(f, c) + (prev >= 0 ? kernAt(o, f, prev, c) : 0); prev = c; }
    return w;
  };
  const defCode = (ch) => { const cp = ch.codePointAt(0); return cp < 256 ? cp : 63; };

  // draw text (font pixels -> units) into a page: returns the width in font pixels
  function drawText(page, CF, f, str, x, y, z, c, o = {}) {
    let px = 0, prev = -1; const codeOf = o.codeOf || defCode;
    for (const ch of str) {
      const code = codeOf(ch); if (prev >= 0) px += kernAt(o, f, prev, code);
      for (const [r, q, n] of runsOf(CF, f, code)) page.ops.push([x + (px + q) * z, y + r * z, n * z, z, c]);
      px += advOf(f, code); prev = code;
    }
    return px;
  }

  // ---- layout flow -------------------------------------------------------------------------------------------------------------------
  function paperUnits(spec) {
    const p = PAPER[spec.paper || 'letter'] || PAPER.letter; let [w, h] = p;
    if (spec.landscape) [w, h] = [h, w];
    return [Math.floor(w * BASE_DPI), Math.floor(h * BASE_DPI)];
  }
  function flow(spec) {
    const [W, H] = paperUnits(spec), M = spec.margin ?? 75, LF = spec.labelFont, lz = spec.labelZoom || 2, CF = spec.CF;
    const fl = {
      W, H, M, pages: [], spec, LF, lz, CF, y: 0, page: null,
      label(str, x, y, c = C.ink, page = fl.page) { return LF ? drawText(page, CF, LF, str, x, y, lz, c) * lz : 0; },
      labelW: (str) => (LF ? textWidth(LF, str) * lz : 0), labelH: LF ? LF.rows * lz : 20,
      lineH: (LF ? LF.rows + 2 : 14) * lz,
      newPage() { fl.page = { w: W, h: H, ops: [] }; fl.pages.push(fl.page); fl.y = M + fl.lineH * 2 + 20; return fl.page; },
      need(h) { if (!fl.page || fl.y + h > H - M - fl.lineH) fl.newPage(); },
      rect(x, y, w, h, c) { fl.page.ops.push([x, y, w, h, c]); },
      frame(x, y, w, h, c = C.grid) { fl.rect(x, y, w, 1, c); fl.rect(x, y + h - 1, w, 1, c); fl.rect(x, y, 1, h, c); fl.rect(x + w - 1, y, 1, h, c); },
    };
    return fl;
  }
  const dotsPer = (spec) => spec.zoom * (spec.dpi || BASE_DPI) / BASE_DPI;
  const dpiNote = (spec) => (spec.dpi || BASE_DPI) + ' dpi, ' + (Math.round(dotsPer(spec) * 100) / 100) + ' dots per font px';
  // titles and page numbers once the page count is known
  function finish(fl, title, sub) {
    if (!fl.pages.length) fl.newPage();
    const n = fl.pages.length;
    fl.pages.forEach((p, i) => {
      fl.label(title, fl.M, fl.M, C.ink, p);
      fl.label(sub || '', fl.M, fl.M + fl.lineH, C.dim, p);
      p.ops.push([fl.M, fl.M + fl.lineH * 2 + 4, fl.W - 2 * fl.M, 2, C.ink]);
      const ft = 'page ' + (i + 1) + ' of ' + n; fl.label(ft, fl.W - fl.M - fl.labelW(ft), fl.H - fl.M - fl.labelH, C.dim, p);
      fl.label('Ataricraft font editor', fl.M, fl.H - fl.M - fl.labelH, C.dim, p);
    });
    return { pages: fl.pages, info: { pages: n, dpi: fl.spec.dpi || BASE_DPI, zoom: fl.spec.zoom, dotsPerFontPx: dotsPer(fl.spec), title } };
  }

  // ---- glyph chart: every glyph of a font on a grid, with its code ---------------------------------------------------------------------
  function glyphChart(spec) {
    const CF = spec.CF, z = spec.zoom || 6, fl = flow(spec), codes = spec.codes, ci = spec.items || [];
    for (const it of ci) {
      const f = it.f, cw = Math.max(f.adv, f.gw) * z + 12, ch = f.rows * z + fl.labelH + 14;
      const cols = Math.max(1, Math.floor((fl.W - 2 * fl.M) / cw));
      fl.need(fl.lineH * 2 + ch); fl.label(it.name + '  -  ' + f.adv + ' px, ' + f.gw + 'x' + f.rows + ' cell, ' + codes.length + ' glyphs', fl.M, fl.y, C.acc); fl.y += fl.lineH + 6;
      codes.forEach((code, i) => {
        const col = i % cols;
        if (col === 0) { if (i) fl.y += ch; fl.need(ch); }
        const x = fl.M + col * cw, y = fl.y;
        if (spec.guides !== false) {
          const gx = x + 4, gw = f.adv * z;
          fl.rect(gx, y + 6 + f.base * z + z, gw, 1, C.grid); fl.rect(gx, y + 6 + f.head * z, gw, 1, C.grid);
        }
        for (const [r, q, n] of runsOf(CF, f, code)) fl.rect(x + 4 + q * z, y + 6 + r * z, n * z, z, C.ink);
        const hx = code.toString(16).toUpperCase().padStart(2, '0');
        fl.label(hx, x + 4, y + 8 + f.rows * z, C.dim);
        if (spec.frames) fl.frame(x, y, cw, ch);
      });
      fl.y += ch + fl.lineH;
    }
    return finish(fl, spec.title || 'Glyph chart', ci.map((i) => i.name).join(', ') + ' - ' + dpiNote(spec));
  }

  // wrap text to maxPx font pixels
  function wrap(f, text, maxPx, o) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        if (line && textWidth(f, line + word, o) > maxPx && /\S/.test(line)) { out.push(line.replace(/\s+$/, '')); line = /^\s+$/.test(word) ? '' : word; }
        else line += word;
        while (textWidth(f, line, o) > maxPx && [...line].length > 1) { const a = [...line]; let k = a.length - 1; while (k > 1 && textWidth(f, a.slice(0, k).join(''), o) > maxPx) k--; out.push(a.slice(0, k).join('')); line = a.slice(k).join(''); }
      }
      out.push(line);
    }
    return out;
  }

  // ---- size comparison chart: the same text at several sizes, one column per font ---------------------------------------------------------
  function sizeChart(spec) {
    const CF = spec.CF, z = spec.zoom || 6, fl = flow(spec), items = spec.items, sizes = spec.sizes, n = items.length, gap = 30;
    const colW = Math.floor((fl.W - 2 * fl.M - (n - 1) * gap) / n), maxPx = Math.floor(colW / z) - 1;
    const wo = (it) => ({ codeOf: spec.codeOf, kern: it.kern });
    for (const s of sizes) {
      const blocks = items.map((it) => {
        const f = it.fam.sizes[s];
        const lab = it.name + '  ' + s + ' px  ' + (f ? '' : '(no such size)  ') + (spec.dpi || BASE_DPI) + ' dpi';
        if (!f) return { lab, lines: [], h: 0 };
        const lines = wrap(f, spec.text, maxPx, wo(it)), lh = f.rows + (spec.lead ?? 1);
        return { f, lab, lines, lh, h: lines.length * lh * z };
      });
      const head = fl.lineH + 4;
      let hmax = Math.max(...blocks.map((b) => b.h), 0), room = fl.H - 2 * fl.M - fl.lineH * 4 - head;
      if (hmax > room) hmax = Math.floor(room / z) * z;
      fl.need(head + hmax + 24);
      blocks.forEach((b, i) => {
        const x = fl.M + i * (colW + gap);
        fl.label(b.lab, x, fl.y, i % 2 ? C.b : C.a);
        if (!b.f) return;
        let y = fl.y + head;
        for (const ln of b.lines) {
          if (y + b.lh * z > fl.y + head + hmax + 1) break;
          drawText(fl.page, CF, b.f, ln, x, y, z, C.ink, wo(items[i])); y += b.lh * z;
        }
      });
      fl.y += head + hmax + 24;
    }
    return finish(fl, spec.title || 'Size comparison', items.map((i) => i.name).join('  |  ') + ' - ' + dpiNote(spec));
  }

  // ---- diff sheet -------------------------------------------------------------------------------------------------------------------------
  // diffs: [{ name, diff }] where diff = FontDiff.diffFonts(...) of the reference against that font
  function diffSheet(spec) {
    const CF = spec.CF, z = spec.zoom || 4, fl = flow(spec), ref = spec.ref, FD = spec.FD;
    for (const d of spec.diffs) {
      const A = ref.f, B = d.f, s = d.diff.summary, rows = spec.onlyDiff === false ? d.diff.rows.filter((r) => r.status !== 'empty') : d.diff.rows.filter((r) => r.status !== 'same' && r.status !== 'empty');
      fl.need(fl.lineH * 6);
      fl.label(ref.name + ' (A, ' + A.adv + ' px)  vs  ' + d.name + ' (B, ' + B.adv + ' px)', fl.M, fl.y, C.acc); fl.y += fl.lineH;
      const sum = s.changed + ' changed, ' + s.missing + ' missing in B, ' + s.extra + ' extra in B, ' + s.same + ' same; ' + s.changedPx + ' px differ (' + Math.round(s.similarity * 1000) / 10 + '% alike)';
      fl.label(sum, fl.M, fl.y, C.ink); fl.y += fl.lineH;
      fl.label('Overlay: black = both, red = only A, blue = only B', fl.M, fl.y, C.dim); fl.y += fl.lineH + 8;
      const dyB = d.diff.align === 'baseline' ? B.base - A.base : 0, top = Math.max(0, dyB);
      const pw = Math.max(A.adv, A.gw, B.adv, B.gw) + 1, ph = Math.max(A.rows, B.rows - dyB) + top + 1, cw = (pw * 3 + 3) * z + 16, ch = ph * z + fl.labelH + 14;
      const cols = Math.max(1, Math.floor((fl.W - 2 * fl.M) / cw));
      rows.forEach((r, i) => {
        if (i % cols === 0) { if (i) fl.y += ch; fl.need(ch); }
        const x = fl.M + (i % cols) * cw, y = fl.y + 4 + top * z;
        const draw = (f, ox, dy, here) => { if (here) for (const [rr, q, n] of runsOf(CF, f, r.code)) fl.rect(ox + q * z, y + (rr + dy) * z, n * z, z, C.ink); };
        draw(A, x + 4, 0, r.a); draw(B, x + 4 + (pw + 1) * z, -dyB, r.b);
        const ox = x + 4 + (pw + 1) * 2 * z, cells = FD.overlay(CF, A, B, r.code, d.diff.align);
        for (let rr = 0; rr < cells.h; rr++) for (let q = 0; q < cells.w; q++) { const v = cells.d[rr * cells.w + q]; if (v) fl.rect(ox + q * z, y + (rr + cells.y0) * z, z, z, v === 1 ? C.ink : v === 2 ? C.a : C.b); }
        const lab = r.code.toString(16).toUpperCase().padStart(2, '0') + (r.code > 32 && r.code < 127 ? ' ' + String.fromCharCode(r.code) : '');
        fl.label(lab + '  ' + (r.status === 'changed' ? 'd' + r.changed : r.status), x + 4, fl.y + 8 + ph * z, r.status === 'changed' ? C.a : C.b);
      });
      if (rows.length) fl.y += ch; else { fl.label('No differing glyphs.', fl.M, fl.y, C.ok); fl.y += fl.lineH; }
      fl.y += fl.lineH;
    }
    summaryTable(fl, spec);
    return finish(fl, spec.title || 'Font comparison', ref.name + ' against ' + spec.diffs.map((d) => d.name).join(', ') + ' - ' + dpiNote(spec));
  }
  // summary page: one line per font, then the metrics that differ and the first differing glyphs
  function summaryTable(fl, spec) {
    fl.newPage(); const lh = fl.lineH;
    fl.label('Summary (reference: ' + spec.ref.name + ')', fl.M, fl.y, C.acc); fl.y += lh * 1.5;
    const head = ['font', 'changed', 'missing', 'extra', 'same', 'changed px', 'alike', 'metrics', 'kerning'];
    const tbl = spec.diffs.map((d) => [d.name, d.diff.summary.changed, d.diff.summary.missing, d.diff.summary.extra, d.diff.summary.same, d.diff.summary.changedPx, Math.round(d.diff.summary.similarity * 1000) / 10 + '%', d.diff.metrics.filter((m) => m.differs).length, d.kern ? d.kern.differ.length + d.kern.onlyA.length + d.kern.onlyB.length : '-']);
    table(fl, head, tbl);
    for (const d of spec.diffs) {
      const md = d.diff.metrics.filter((m) => m.differs);
      fl.y += lh; fl.need(lh * 3); fl.label('Metrics: ' + spec.ref.name + ' vs ' + d.name, fl.M, fl.y, C.acc); fl.y += lh;
      table(fl, ['metric', 'A', 'B'], md.length ? md.map((m) => [m.key, m.a, m.b]) : [['(identical)', '', '']]);
      const bad = d.diff.rows.filter((r) => r.status !== 'same' && r.status !== 'empty');
      fl.y += lh; fl.need(lh * 3); fl.label('Glyphs: ' + d.name, fl.M, fl.y, C.acc); fl.y += lh;
      table(fl, ['code', 'char', 'status', 'px A', 'px B', 'changed', 'adv A', 'adv B'], bad.slice(0, 400).map((r) => [r.code, r.code > 32 && r.code < 127 ? String.fromCharCode(r.code) : '', r.status, r.pxA, r.pxB, r.changed, r.advA, r.advB]));
      if (bad.length > 400) { fl.need(lh); fl.label('... ' + (bad.length - 400) + ' more in the CSV export', fl.M, fl.y, C.dim); fl.y += lh; }
    }
  }
  function table(fl, head, rows) {
    const lh = fl.lineH, w = head.map((h, i) => Math.max(fl.labelW(String(h)), ...rows.map((r) => fl.labelW(String(r[i] ?? ''))))), gap = 24;
    const xs = []; let x = fl.M; for (const cw of w) { xs.push(x); x += cw + gap; }
    fl.need(lh * 2); head.forEach((h, i) => fl.label(String(h), xs[i], fl.y, C.dim)); fl.y += lh;
    for (const r of rows) { fl.need(lh); r.forEach((v, i) => fl.label(String(v ?? ''), xs[i], fl.y, C.ink)); fl.y += lh; }
  }

  // ---- output: SVG, canvas preview, streamed PNG ---------------------------------------------------------------------------------------------
  function toSvg(page, o = {}) {
    const wIn = page.w / BASE_DPI, hIn = page.h / BASE_DPI, by = {};
    for (const [x, y, w, h, c] of page.ops) (by[c] || (by[c] = [])).push('M' + x + ' ' + y + 'h' + w + 'v' + h + 'h-' + w + 'z');
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + wIn.toFixed(4) + 'in" height="' + hIn.toFixed(4) + 'in" viewBox="0 0 ' + page.w + ' ' + page.h + '" shape-rendering="crispEdges">';
    if (o.title) s += '<title>' + String(o.title).replace(/[<&]/g, '') + '</title>';
    s += '<rect width="' + page.w + '" height="' + page.h + '" fill="#fff"/>';
    for (const c of Object.keys(by)) s += '<path fill="' + hex(+c) + '" d="' + by[c].join('') + '"/>';
    return s + '</svg>';
  }
  // screen preview: paint rectangles at an integer or fractional scale (fillRect, so nothing is smoothed)
  function paintCanvas(ctx, page, scale) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, Math.round(page.w * scale), Math.round(page.h * scale));
    let last = -1;
    for (const [x, y, w, h, c] of page.ops) {
      if (c !== last) { ctx.fillStyle = hex(c); last = c; }
      const x0 = Math.round(x * scale), y0 = Math.round(y * scale);
      ctx.fillRect(x0, y0, Math.max(1, Math.round((x + w) * scale) - x0), Math.max(1, Math.round((y + h) * scale) - y0));
    }
  }
  const dotsOf = (page, dpi) => [Math.round(page.w * dpi / BASE_DPI), Math.round(page.h * dpi / BASE_DPI)];

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8, c = 0xffffffff) => { for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; };
  const be32 = (v) => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
  const chunk = (type, data) => {
    const t = new Uint8Array([...type].map((c) => c.charCodeAt(0))), out = new Uint8Array(12 + data.length);
    out.set(be32(data.length), 0); out.set(t, 4); out.set(data, 8);
    out.set(be32((crc32(data, crc32(t)) ^ 0xffffffff) >>> 0), 8 + data.length); return out;
  };

  // Streamed PNG of a page (or a region of it) at `dpi`, palette-indexed 1/2/4 bits per dot. Rows between two shape edges are identical,
  // so each is built once; the zlib stream is fed row after row and never holds more than a few MB, so 4800 dpi A3 works.
  // o: { dpi, region: [x, y, w, h] in dots, onProgress(0..1), name }. Returns Uint8Array[] parts (wrap in a Blob or Buffer.concat).
  async function renderPng(page, o = {}) {
    const dpi = o.dpi || BASE_DPI, k = dpi / BASE_DPI, [PW, PH] = dotsOf(page, dpi);
    const [rx, ry, rw, rh] = o.region || [0, 0, PW, PH];
    if (rw < 1 || rh < 1 || rx < 0 || ry < 0 || rx + rw > PW || ry + rh > PH) throw new Error('region outside the page');
    const used = [C.paper], idx = { [C.paper]: 0 };
    for (const op of page.ops) if (!(op[4] in idx)) { idx[op[4]] = used.length; used.push(op[4]); }
    const depth = used.length <= 2 ? 1 : used.length <= 4 ? 2 : 4, perByte = 8 / depth, rowBytes = Math.ceil(rw / perByte);
    const ops = page.ops.map((op, i) => ({ i, x0: Math.round(op[0] * k), x1: Math.round((op[0] + op[2]) * k), y0: Math.round(op[1] * k), y1: Math.round((op[1] + op[3]) * k), c: idx[op[4]] }))
      .filter((p) => p.y1 > ry && p.y0 < ry + rh && p.x1 > rx && p.x0 < rx + rw);
    for (const p of ops) { if (p.x1 === p.x0) p.x1++; if (p.y1 === p.y0) p.y1++; } // hairlines stay visible
    const edges = new Set([ry, ry + rh]); for (const p of ops) { if (p.y0 > ry && p.y0 < ry + rh) edges.add(p.y0); if (p.y1 > ry && p.y1 < ry + rh) edges.add(p.y1); }
    const ys = [...edges].sort((a, b) => a - b), byStart = ops.slice().sort((a, b) => a.y0 - b.y0 || a.i - b.i);
    const cs = new CompressionStream('deflate'), wr = cs.writable.getWriter(), rd = cs.readable.getReader(), idat = [];
    const pump = (async () => { for (;;) { const { done, value } = await rd.read(); if (done) break; idat.push(chunk('IDAT', value)); } })();
    let active = [], next = 0, batch = [], batchLen = 0;
    const flush = async () => { if (!batchLen) return; const b = new Uint8Array(batchLen); let p = 0; for (const x of batch) { b.set(x, p); p += x.length; } batch = []; batchLen = 0; await wr.write(b); };
    const line = new Uint8Array(rowBytes + 1), px = new Uint8Array(rw);
    for (let s = 0; s + 1 < ys.length; s++) {
      const ya = ys[s], yb = ys[s + 1];
      while (next < byStart.length && byStart[next].y0 <= ya) active.push(byStart[next++]);
      active = active.filter((p) => p.y1 > ya); active.sort((a, b) => a.i - b.i);
      px.fill(0);
      for (const p of active) { const a = Math.max(p.x0, rx) - rx, b = Math.min(p.x1, rx + rw) - rx; if (b > a) px.fill(p.c, a, b); }
      line.fill(0);
      if (depth === 1) for (let x = 0; x < rw; x++) { if (px[x]) line[1 + (x >> 3)] |= 0x80 >> (x & 7); }
      else if (depth === 2) for (let x = 0; x < rw; x++) line[1 + (x >> 2)] |= px[x] << (6 - 2 * (x & 3));
      else for (let x = 0; x < rw; x++) line[1 + (x >> 1)] |= px[x] << (4 - 4 * (x & 1));
      for (let r = yb - ya; r > 0; r--) { batch.push(line.slice()); batchLen += line.length; if (batchLen > 4e6) await flush(); }
      if (o.onProgress) o.onProgress((yb - ry) / rh);
      if (o.cancelled && o.cancelled()) throw new Error('cancelled');
    }
    await flush(); await wr.close(); await pump;
    const ihdr = new Uint8Array(13); ihdr.set(be32(rw), 0); ihdr.set(be32(rh), 4); ihdr[8] = depth; ihdr[9] = 3;
    const plte = new Uint8Array(used.length * 3); used.forEach((c, i) => plte.set(PAL[c], i * 3));
    const ppm = Math.round(dpi / 0.0254), phys = new Uint8Array(9); phys.set(be32(ppm), 0); phys.set(be32(ppm), 4); phys[8] = 1;
    const txt = new TextEncoder().encode('Software\0Ataricraft font editor ' + (o.name ? '\u2013 ' + o.name : '').replace(/[^\x20-\x7e]/g, '-') + ' ' + dpi + ' dpi');
    return [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('pHYs', phys), chunk('tEXt', txt), ...idat, chunk('IEND', new Uint8Array(0))];
  }
  // tiles: a list of [x, y, w, h] regions (in dots) of at most maxDots x maxDots
  function tiles(page, dpi, maxDots) {
    const [W, H] = dotsOf(page, dpi), out = [];
    for (let y = 0; y < H; y += maxDots) for (let x = 0; x < W; x += maxDots) out.push({ r: Math.floor(y / maxDots), c: Math.floor(x / maxDots), region: [x, y, Math.min(maxDots, W - x), Math.min(maxDots, H - y)] });
    return out;
  }
  const printHtml = (pages, spec, o = {}) => {
    const [w, h] = (PAPER[spec.paper || 'letter'] || PAPER.letter), W = spec.landscape ? h : w, H = spec.landscape ? w : h;
    return '<!doctype html><meta charset="utf-8"><title>' + String(o.title || 'Font sheet').replace(/[<&]/g, '') + '</title><style>@page{size:' + W + 'in ' + H + 'in;margin:0}html,body{margin:0;background:#fff}.p{width:' + W + 'in;height:' + H + 'in;overflow:hidden;page-break-after:always;break-after:page}.p:last-child{page-break-after:auto}.p svg,.p img{display:block;width:' + W + 'in;height:' + H + 'in;image-rendering:pixelated}</style>' +
      pages.map((p, i) => '<div class="p">' + (o.images ? '<img src="' + o.images[i] + '">' : toSvg(p)) + '</div>').join('');
  };

  return { BASE_DPI, DPIS, PAPER, C, PAL, glyphChart, sizeChart, diffSheet, toSvg, paintCanvas, renderPng, tiles, printHtml, dotsOf, textWidth, drawText, wrap, runsOf, advOf, hasInk, dotsPer, paperUnits, flow, finish };
});
