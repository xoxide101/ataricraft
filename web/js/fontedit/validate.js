// Font editor validation panes (web/fontedit.html): the preview text as ACWriter PAGE view 1x / 2x and xCWriter's Page view draw it,
// metric bands and dot grid, and a diff of the two renderings. Same glyph bitmaps and rules as web/js/xcwriter/faces.js,
// editor-atari.js (render2) and editor-page.js (drawBitmap); layout comes from XCW.atariLines (tools/xcwcore.cjs).
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, $ = (id) => document.getElementById(id), st = FE.state;
  const COL = { head: '#4a78c8', cap: '#e8b030', xh: '#58c878', base: '#e05555', desc: '#9a6ad0' };
  const PAPER = { bg: '#efece2', ink: '#14110c', bar: '#14110c' };
  const CELL = { 10: 5, 12: 4, 17: 3 }, LH = 8;
  let last = { diff: [], pct: {} };

  // face of the font being edited: { w, h, base, get(code, mode) -> { w, h, px } } (same shape as XFACE faces)
  function bitmapOf(f, code, mode) {
    const rows = CF.render(f, code, mode || 0), px = new Uint8Array(f.adv * f.rows);
    for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.gw; x++) if (CF.hasPx(f, rows[y], x)) px[y * f.adv + x + (f.adv > f.gw + 1 ? 1 : 0)] = 1;
    return { w: f.adv, h: f.rows, px };
  }
  function mkFace(f) {
    const cache = {};
    return { w: f.adv, h: f.rows, f, get: (c, m) => (c >= 32 && c <= 127 ? (cache[c + ':' + (m || 0)] = cache[c + ':' + (m || 0)] || bitmapOf(f, c, m)) : null) };
  }
  // 8 px fonts go to ACWriter as an Atari charset (rows head..head+7 verbatim); every other size is folded to 8x8 like xCWriter's 2x view
  const direct8 = (f) => f.adv === 8 && f.gw <= 8;
  function glyph8(face, code, mode) {
    const f = face.f, bm = face.get(code, mode);
    if (!bm) return null;
    if (direct8(f)) {
      const rows = CF.render(f, code, mode), px = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (((rows[f.head + y] || 0) >> (7 - x)) & 1) px[y * 8 + x] = 1;
      return { w: 8, h: 8, px };
    }
    return XFACE.fold(bm, 8, 8);
  }

  // ---- text and layout -------------------------------------------------------------------------------------------
  function paras(text) {
    return text.split('\n').map((ln) => {
      const runs = []; let mode = 0;
      const add = (ch) => { const l = runs[runs.length - 1]; if (l && l.sup === (mode === 1 ? 1 : 0) && l.sub === (mode === 2 ? 1 : 0)) l.t += ch; else runs.push({ t: ch, b: 0, i: 0, u: 0, sup: mode === 1 ? 1 : 0, sub: mode === 2 ? 1 : 0 }); };
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i];
        if ((ch === '^' || ch === '_') && ln[i + 1] === '{' && ln.indexOf('}', i) > 0) { mode = ch === '^' ? 1 : 2; i++; continue; }
        if (ch === '}' && mode) { mode = 0; continue; }
        add(ch);
      }
      return { align: 'l', bullet: false, runs };
    });
  }
  const layoutAt = (text, cols) => XCW.atariLines(paras(text), { ...XCW.PROFILES.atari, cols }, null);
  const modeOf = (c) => (c.sup ? 1 : c.sub ? 2 : 0);

  // ---- bands and grid --------------------------------------------------------------------------------------------
  // y of cell row boundary k inside a cell of height `ch` starting at y0
  function bands(ctx, f, x0, y0, cw, ch, rowOf, z) {
    const Y = (k) => Math.round(y0 + rowOf(k) * ch);
    ctx.fillStyle = COL.head + '33'; ctx.fillRect(x0, Y(0), cw, Math.max(1, Y(f.head) - Y(0)));
    ctx.fillStyle = COL.desc + '33'; ctx.fillRect(x0, Y(f.base + 1), cw, Math.max(1, Y(f.rows) - Y(f.base + 1)));
    for (const [k, c] of [[f.head, COL.cap], [f.xTop, COL.xh], [f.base + 1, COL.base]]) { ctx.fillStyle = c; ctx.fillRect(x0, Y(k), cw, Math.max(1, Math.round(z / 2))); }
  }
  function dotGrid(ctx, x0, y0, cw, ch, cols, rows) {
    ctx.fillStyle = '#00000022';
    for (let q = 0; q <= cols; q++) ctx.fillRect(Math.round(x0 + (q * cw) / cols), Math.round(y0), 1, Math.round(ch));
    for (let r = 0; r <= rows; r++) ctx.fillRect(Math.round(x0), Math.round(y0 + (r * ch) / rows), Math.round(cw), 1);
  }

  const opts = () => ({ grid: $('vgrid').checked, bands: $('vbands').checked, hl: $('vhl').checked });
  const differs = (c) => opts().hl && last.pct[c] !== undefined && last.pct[c] * 100 >= +$('vth').value && last.pct[c] > 0;

  // ---- ACWriter 1x: 64 x 20 cells of 5 x 8 px, 4x8 fold of the face ------------------------------------------------
  function draw1x(face) {
    const cv = $('v1'), ctx = cv.getContext('2d'), o = opts(), f = face.f;
    cv.width = 320; cv.height = 192; cv.style.width = 320 * +$('vsz').value + 'px';
    ctx.fillStyle = PAPER.bg; ctx.fillRect(0, 0, 320, 192);
    const lines = layoutAt($('sample').value, 64);
    lines.slice(0, 20).forEach((l, r) => {
      const y = r * 8;
      l.cells.forEach((c, k) => {
        const x = k * 5, code = c.ch.charCodeAt(0);
        if (differs(code)) { ctx.fillStyle = '#ffd86655'; ctx.fillRect(x, y, 5, 8); }
        if (o.bands && k === 0) bands(ctx, f, 0, y, 320, 8, (kk) => kk / f.rows, 1);
        if (c.ch === ' ') return;
        const bm = face.get(code, 0); if (!bm) return;
        const g = XFACE.fold(bm, 4, 8), dy = c.sup ? -1 : c.sub ? 1 : 0;
        ctx.fillStyle = PAPER.ink;
        for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 4; gx++) if (g.px[gy * 4 + gx]) ctx.fillRect(x + gx, y + gy + dy, 1, 1);
      });
      if (o.grid) for (let k = 0; k < l.cells.length; k++) dotGrid(ctx, k * 5, y, 5, 8, 4, 8);
    });
    return lines.length;
  }

  // ---- ACWriter 2x: 20 columns x 9 lines of 16x16 cells (editor-atari.js render2, word/zoom.inc) ------------------
  function draw2x(face) {
    const cv = $('v2'), ctx = cv.getContext('2d'), o = opts(), f = face.f, d8 = direct8(f);
    cv.width = 320; cv.height = 192; cv.style.width = 320 * +$('vsz').value + 'px';
    ctx.fillStyle = PAPER.bg; ctx.fillRect(0, 0, 320, 192);
    ctx.fillStyle = PAPER.bar; ctx.fillRect(0, 0, 320, 8); ctx.fillRect(0, 168, 320, 24);
    const lines = layoutAt($('sample').value, 20);
    lines.slice(0, 9).forEach((l, r) => {
      const y = 16 + r * 16;
      l.cells.forEach((c, k) => {
        const x = k * 16, code = c.ch.charCodeAt(0);
        if (differs(code)) { ctx.fillStyle = '#ffd86699'; ctx.fillRect(x, y, 16, 16); }
        if (o.bands && k === 0) bands(ctx, f, 0, y, 320, 16, d8 ? (kk) => Math.max(0, Math.min(1, (kk - f.head) / 8)) : (kk) => kk / f.rows, 2);
        if (c.ch === ' ') return;
        const g = glyph8(face, code, 0);
        if (!g) return;
        ctx.fillStyle = PAPER.ink;
        if (c.sup || c.sub) {
          const capSet = [0, 1].some((gy) => [0, 1, 2, 3, 4, 5, 6, 7].some((gx) => g.px[gy * 8 + gx])), rowsL = capSet ? [0, 1, 3, 4, 5] : [2, 3, 4, 5];
          const top = (capSet ? 0 : 2) + (c.sub && !c.sup ? 6 : 0);
          rowsL.forEach((gy, n) => { for (let gx = 0; gx < 8; gx++) if (g.px[gy * 8 + gx]) ctx.fillRect(x + gx * 2, y + top + n * 2, 2, 2); });
          return;
        }
        for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) if (g.px[gy * 8 + gx]) ctx.fillRect(x + gx * 2, y + gy * 2, 2, 2);
      });
      if (o.grid) for (let k = 0; k < l.cells.length; k++) dotGrid(ctx, k * 16, y, 16, 16, 8, 8);
    });
    return lines.length;
  }

  // ---- xCWriter Page view (editor-page.js: faceDims, relayout, drawBitmap) ---------------------------------------------
  function drawPage(face) {
    const cv = $('vp'), ctx = cv.getContext('2d'), o = opts(), f = face.f, z = +$('vpz').value, pitch = +$('vpitch').value;
    const info = XCW.Page.info(XCW.Page.normalize({ pitch })), k = CELL[pitch] / 5;
    const cw = face.w < 8 ? CELL[pitch] : face.w * k, lh = face.w < 8 ? LH : face.h;
    const uc = Math.abs(cw - CELL[pitch]) < 1e-6 ? info.usable : Math.max(1, Math.floor((info.usable * CELL[pitch]) / cw));
    const lines = layoutAt($('sample').value, uc), M = 4;
    $('vpinfo').textContent = 'letter ' + pitch + ' cpi, ' + uc + ' columns of ' + (Math.round(cw * 100) / 100) + ' x ' + lh + ' dots, zoom ' + z;
    const LW = info.usable * CELL[pitch] + 2 * M, LHH = lines.length * lh + 2 * M;
    cv.width = Math.ceil(LW * z); cv.height = Math.ceil(LHH * z);
    ctx.fillStyle = PAPER.bg; ctx.fillRect(0, 0, cv.width, cv.height);
    const px = (lx, ly, lw, lhh, col) => {
      const x0 = Math.round(lx * z), y0 = Math.round(ly * z), x1 = Math.round((lx + lw) * z), y1 = Math.round((ly + lhh) * z);
      ctx.fillStyle = col; ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    };
    lines.forEach((l, li) => {
      const y = M + li * lh;
      l.cells.forEach((c, kk) => {
        const x = M + kk * cw, code = c.ch.charCodeAt(0);
        if (differs(code)) px(x, y, cw, lh, '#ffd86699');
        if (o.bands && kk === 0) bands(ctx, f, M * z, y * z, info.usable * CELL[pitch] * z, lh * z, (q) => q / f.rows, z);
        if (c.ch === ' ') return;
        const bm = face.get(code, modeOf(c));
        if (!bm) return;
        const sx = cw / bm.w, sy = lh / bm.h;
        for (let r = 0; r < bm.h; r++) for (let q = 0; q < bm.w;) {
          if (!bm.px[r * bm.w + q]) { q++; continue; }
          let e = q; while (e < bm.w && bm.px[r * bm.w + e]) e++;
          px(x + q * sx, y + r * sy, (e - q) * sx, sy, PAPER.ink); q = e;
        }
      });
      if (o.grid) for (let kk = 0; kk < l.cells.length; kk++) dotGrid(ctx, (M + kk * cw) * z, y * z, cw * z, lh * z, face.w, face.h);
    });
    return lines.length;
  }

  // ---- diff -----------------------------------------------------------------------------------------------------------
  // Both renderings are put on a 120 x 120 raster (120 = lcm of the advances and 12 rows). An 8 px font is compared dot for dot
  // (ACWriter's 8 rows sit on rows head..head+7 of the face), any other size by shape in the unit cell.
  const R = 120;
  function rasters(face, code) {
    const f = face.f, bm = face.get(code, 0), g8 = glyph8(face, code, 0), A = new Uint8Array(R * R), B = new Uint8Array(R * R), d8 = direct8(f);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      A[y * R + x] = bm.px[Math.floor((y * bm.h) / R) * bm.w + Math.floor((x * bm.w) / R)];
      if (d8) { const ry = Math.floor((y * f.rows) / R) - f.head; B[y * R + x] = ry >= 0 && ry < 8 ? g8.px[ry * 8 + Math.floor((x * 8) / R)] : 0; }
      else B[y * R + x] = g8.px[Math.floor((y * 8) / R) * 8 + Math.floor((x * 8) / R)];
    }
    return [A, B];
  }
  function computeDiff(face) {
    const pct = {}, list = [];
    for (let c = 33; c <= 126; c++) {
      const [A, B] = rasters(face, c); let x = 0, u = 0;
      for (let i = 0; i < A.length; i++) { if (A[i] || B[i]) u++; if (A[i] !== B[i]) x++; }
      pct[c] = u ? x / u : 0;
    }
    for (let c = 33; c <= 126; c++) if (pct[c] * 100 >= +$('vth').value && pct[c] > 0) list.push(c);
    return { pct, list };
  }
  function drawDiff(face) {
    const cv = $('vd'), ctx = cv.getContext('2d'), T = 64, TH = 76, th = +$('vth').value;
    cv.width = 16 * T; cv.height = 6 * TH;
    ctx.fillStyle = '#101216'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.textBaseline = 'top';
    for (let c = 32; c <= 127; c++) {
      const i = c - 32, x0 = (i % 16) * T, y0 = Math.floor(i / 16) * TH;
      if (c >= 33 && c <= 126) {
        const [A, B] = rasters(face, c), im = ctx.createImageData(60, 60);
        for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
          const j = (2 * y + 1) * R + 2 * x + 1, a = A[j], b = B[j], o = (y * 60 + x) * 4;
          const col = a && b ? [150, 150, 150] : a ? [255, 82, 82] : b ? [74, 168, 255] : [24, 27, 33];
          im.data.set([col[0], col[1], col[2], 255], o);
        }
        ctx.putImageData(im, x0 + 2, y0 + 2);
        const p = last.pct[c] || 0;
        ctx.strokeStyle = p * 100 >= th && p > 0 ? '#ff9d3a' : '#2a2f39'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, 62, 62);
        ctx.fillStyle = p * 100 >= th && p > 0 ? '#ff9d3a' : '#8a93a3'; ctx.fillText(String.fromCharCode(c) + ' ' + Math.round(p * 100) + '%', x0 + 3, y0 + 64);
      }
    }
    const n = last.list.length;
    $('vdl').textContent = n ? n + ' of 94 glyphs differ by at least ' + th + '%: ' + last.list.map((c) => String.fromCharCode(c)).join(' ') : 'No glyph differs by ' + th + '% or more: both renderings agree.';
  }

  function render() {
    if (!$('v1')) return;
    if (!st.f) return;
    const face = mkFace(st.f);
    last = computeDiff(face); last.diff = last.list;
    const n = [draw1x(face), draw2x(face), drawPage(face)];
    drawDiff(face);
    return n;
  }
  FE.hooks.push(() => { if (st.f && FE.isTab('atari')) render(); });
  for (const id of ['vsz', 'vpz', 'vpitch', 'vgrid', 'vbands', 'vhl', 'vth']) $(id).addEventListener('input', render);
  FE.val = { render, diff: () => ({ list: last.list.slice(), pct: Object.assign({}, last.pct) }), mkFace, glyph8, direct8 };
  render();
})();
