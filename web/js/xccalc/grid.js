// xCCalc grid: canvas with virtual scrolling (only the visible cells are drawn), selection, in-cell editor, column resize, keyboard.
(function () {
  'use strict';
  const XA = window.XA, C = XA.C, $ = XA.$;
  const HDRW = 52, HDRH = 24, ROWH = 22, CW = 8, PAD = 6;
  const G = XA.grid = { font: { family: "system-ui,'Segoe UI',sans-serif", size: 13 }, editing: null };
  let canvas, scroll, sizer, ced, ctx, dpr = 1, colX = [0], tmp = null, raf = 0, drag = null;

  const colPx = (c) => (tmp && tmp.c === c ? tmp.px : XA.wb.colWidth(XA.s, c) * CW + PAD);
  function layout() {
    colX = [0];
    for (let c = 0; c < C.MAXCOL; c++) colX.push(colX[c] + colPx(c));
    sizer.style.width = HDRW + colX[C.MAXCOL] + 'px'; sizer.style.height = HDRH + C.MAXROW * ROWH + 'px';
  }
  const colAt = (x) => { let lo = 0, hi = C.MAXCOL - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; } return lo; };
  const rowAt = (y) => Math.max(0, Math.min(C.MAXROW - 1, Math.floor(y / ROWH)));
  G.cellRect = (r, c) => ({ x: HDRW + colX[c], y: HDRH + r * ROWH, w: colX[c + 1] - colX[c], h: ROWH });
  G.invalidate = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const fontStr = (st) => (st & 2 ? 'italic ' : '') + (st & 1 ? 'bold ' : '') + G.font.size + 'px ' + G.font.family;

  function cellText(r, c, x0, y, w, c1, sx, forceClip) {
    const wb = XA.wb, s = XA.s, x = wb.cell(s, r, c);
    if (!x || x.val === null || x.val === undefined) return;
    let t = wb.display(s, r, c); if (t === '') return;
    const st = x.st, al = wb.align(s, r, c), isErr = C.isErr(x.val), isNum = typeof x.val === 'number';
    ctx.font = fontStr(st);
    let tw = ctx.measureText(t).width; const avail = w - 6;
    if (isNum && tw > avail) { t = '#'.repeat(Math.max(1, Math.floor(avail / ctx.measureText('#').width))); tw = ctx.measureText(t).width; }
    let clipW = w;
    if (tw > avail && al === 'l' && !isNum) { // text runs over empty neighbours
      let cc = c + 1, ext = w;
      while (cc < C.MAXCOL && cc <= c1 + 1 && ext - 6 < tw && !wb.cell(s, r, cc)) { ext += colX[cc + 1] - colX[cc]; cc++; }
      clipW = ext;
    }
    ctx.fillStyle = isErr ? '#c0281c' : '#111';
    const clip = tw > clipW - 6;
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(x0 + 1, y + 1, clipW - 2, ROWH - 2); ctx.clip(); }
    const tx = al === 'r' ? x0 + w - 3 - tw : al === 'c' ? x0 + (w - tw) / 2 : x0 + 3;
    ctx.fillText(t, tx, y + ROWH / 2 + 1);
    if (st & 4) ctx.fillRect(tx, y + ROWH / 2 + G.font.size / 2 + 1, tw, 1);
    if (clip) ctx.restore();
  }

  function draw() {
    if (!XA.wb || !canvas.width) return;
    const W = scroll.clientWidth, H = scroll.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const sx = scroll.scrollLeft, sy = scroll.scrollTop;
    const r0 = Math.max(0, Math.floor(sy / ROWH)), r1 = Math.min(C.MAXROW - 1, Math.ceil((sy + H) / ROWH));
    const c0 = colAt(sx), c1 = colAt(sx + W);
    const q = XA.rect(), cur = XA.sel;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.strokeStyle = '#d6d9e0'; ctx.lineWidth = 1; ctx.beginPath();
    for (let c = c0; c <= c1 + 1; c++) { const x = Math.round(HDRW + colX[c] - sx) - 0.5; ctx.moveTo(x, HDRH); ctx.lineTo(x, H); }
    for (let r = r0; r <= r1 + 1; r++) { const y = Math.round(HDRH + r * ROWH - sy) - 0.5; ctx.moveTo(HDRW, y); ctx.lineTo(W, y); }
    ctx.stroke();
    for (let r = r0; r <= r1; r++) {
      const y = HDRH + r * ROWH - sy;
      for (let c = c0; c <= c1; c++) cellText(r, c, HDRW + colX[c] - sx, y, colX[c + 1] - colX[c], c1, sx);
    }
    // selection: tint, border, and the active cell left white
    ctx.save(); ctx.beginPath(); ctx.rect(HDRW, HDRH, W - HDRW, H - HDRH); ctx.clip();
    const ax = HDRW + colX[q.c1] - sx, ay = HDRH + q.r1 * ROWH - sy, aw = colX[q.c2 + 1] - colX[q.c1], ah = (q.r2 - q.r1 + 1) * ROWH;
    ctx.fillStyle = 'rgba(255,157,58,.16)'; ctx.fillRect(ax, ay, aw, ah);
    ctx.strokeStyle = '#ff8c1a'; ctx.lineWidth = 2; ctx.strokeRect(ax + 1, ay + 1, aw - 2, ah - 2);
    if (q.r1 !== q.r2 || q.c1 !== q.c2) {
      const cr = G.cellRect(cur.r, cur.c), cx = cr.x - sx, cy = cr.y - sy;
      ctx.fillStyle = '#fff'; ctx.fillRect(cx + 2, cy + 2, cr.w - 4, cr.h - 4);
      cellText(cur.r, cur.c, cx, cy, cr.w, c1, sx);
      ctx.strokeStyle = '#ff8c1a'; ctx.lineWidth = 2; ctx.strokeRect(cx + 1, cy + 1, cr.w - 2, cr.h - 2);
    }
    ctx.restore();
    // headers
    ctx.font = '600 12px system-ui,sans-serif'; ctx.textAlign = 'center';
    for (let c = c0; c <= c1; c++) {
      const x0 = HDRW + colX[c] - sx, w = colX[c + 1] - colX[c], on = c >= q.c1 && c <= q.c2;
      ctx.fillStyle = on ? '#ffd9ab' : '#eceff4'; ctx.fillRect(x0, 0, w, HDRH);
      ctx.fillStyle = '#9aa1ae'; ctx.fillRect(x0 + w - 1, 0, 1, HDRH); ctx.fillStyle = on ? '#000' : '#444'; ctx.fillText(C.colName(c), x0 + w / 2, HDRH / 2 + 1);
    }
    for (let r = r0; r <= r1; r++) {
      const y = HDRH + r * ROWH - sy, on = r >= q.r1 && r <= q.r2;
      ctx.fillStyle = on ? '#ffd9ab' : '#eceff4'; ctx.fillRect(0, y, HDRW, ROWH);
      ctx.fillStyle = '#9aa1ae'; ctx.fillRect(0, y + ROWH - 1, HDRW, 1); ctx.fillStyle = on ? '#000' : '#444'; ctx.fillText(String(r + 1), HDRW / 2, y + ROWH / 2 + 1);
    }
    ctx.fillStyle = '#dfe3ea'; ctx.fillRect(0, 0, HDRW, HDRH); ctx.fillStyle = '#9aa1ae'; ctx.fillRect(HDRW - 1, 0, 1, HDRH); ctx.fillRect(0, HDRH - 1, HDRW, 1);
    ctx.textAlign = 'left';
    if (G.editing) place();
  }

  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const W = scroll.clientWidth, H = scroll.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    G.invalidate();
  }

  G.reveal = (r, c) => {
    const rc = G.cellRect(r, c), W = scroll.clientWidth, H = scroll.clientHeight;
    if (rc.x - scroll.scrollLeft < HDRW) scroll.scrollLeft = rc.x - HDRW; else if (rc.x + rc.w - scroll.scrollLeft > W) scroll.scrollLeft = rc.x + rc.w - W;
    if (rc.y - scroll.scrollTop < HDRH) scroll.scrollTop = rc.y - HDRH; else if (rc.y + rc.h - scroll.scrollTop > H) scroll.scrollTop = rc.y + rc.h - H;
    G.invalidate();
  };
  G.visibleRows = () => Math.max(1, Math.floor((scroll.clientHeight - HDRH) / ROWH) - 1);
  G.firstRow = () => Math.floor(scroll.scrollTop / ROWH);

  // ---------- editor ----------
  function place() {
    const { r, c } = G.editing, rc = G.cellRect(r, c), w = Math.max(rc.w, 140);
    ced.style.left = rc.x - 1 + 'px'; ced.style.top = rc.y - 1 + 'px'; ced.style.width = w + 2 + 'px'; ced.style.height = ROWH + 2 + 'px';
    ced.style.font = G.font.size + 'px ' + G.font.family;
  }
  G.startEdit = (initial) => {
    if (G.editing) return;
    const { r, c } = XA.sel;
    G.editing = { r, c, mode: initial === undefined ? 'edit' : 'enter' };
    ced.style.display = 'block'; place();
    ced.value = initial !== undefined ? initial : XA.wb.editText(XA.s, r, c);
    $('fbar').value = ced.value;
    G.reveal(r, c); place(); ced.focus();
    ced.setSelectionRange(ced.value.length, ced.value.length);
  };
  G.endEdit = (save) => {
    const ed = G.editing; if (!ed) return false;
    G.editing = null; ced.style.display = 'none';
    let ok = true;
    if (save) ok = XA.commit(ed.r, ed.c, ced.value);
    XA.emit('select'); G.invalidate();
    return ok;
  };
  const move = (dr, dc, extend) => {
    const s = XA.sel, nr = Math.max(0, Math.min(C.MAXROW - 1, s.r + dr)), nc = Math.max(0, Math.min(C.MAXCOL - 1, s.c + dc));
    if (extend) XA.select(s.ar, s.ac, nr, nc, true); else XA.select(nr, nc, nr, nc);
    G.reveal(nr, nc);
  };
  G.move = move;
  const filled = (r, c) => { const x = XA.wb.cell(XA.s, r, c); return !!x && x.val !== null && x.val !== undefined; };
  const jump = (dr, dc, extend) => {
    const s = XA.sel; let r = s.r, c = s.c;
    const inb = (a, b) => a >= 0 && b >= 0 && a < C.MAXROW && b < C.MAXCOL;
    if (!inb(r + dr, c + dc)) return;
    const cur = filled(r, c), nxt = filled(r + dr, c + dc);
    r += dr; c += dc;
    if (cur && nxt) { while (inb(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; } } else { while (inb(r + dr, c + dc) && !filled(r, c)) { r += dr; c += dc; } }
    if (extend) XA.select(s.ar, s.ac, r, c, true); else XA.select(r, c, r, c);
    G.reveal(r, c);
  };
  const styleKey = { b: 1, i: 2, u: 4 };

  function onKey(e) {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    if (ctrl && !e.altKey) {
      const l = k.toLowerCase();
      if (styleKey[l]) { e.preventDefault(); XA.setStyle(styleKey[l], 'toggle'); return; }
      if (l === 'z') { e.preventDefault(); sh ? XA.doRedo() : XA.doUndo(); return; }
      if (l === 'y') { e.preventDefault(); XA.doRedo(); return; }
      if (l === 'd') { e.preventDefault(); XA.fill('down'); return; }
      if (l === 'r') { e.preventDefault(); XA.fill('right'); return; }
      if (l === 'a') { e.preventDefault(); XA.select(C.MAXROW - 1, C.MAXCOL - 1, 0, 0, true); return; }
      if (l === 's') { e.preventDefault(); XA.emit('savekey'); return; }
      if (l === 'o') { e.preventDefault(); XA.emit('openkey'); return; }
      if (k === 'Home') { e.preventDefault(); XA.select(0, 0, 0, 0); G.reveal(0, 0); return; }
      if (k.startsWith('Arrow')) { e.preventDefault(); jump(k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0, sh); return; }
      return; // copy/cut/paste arrive as clipboard events
    }
    switch (k) {
      case 'ArrowDown': e.preventDefault(); move(1, 0, sh); return;
      case 'ArrowUp': e.preventDefault(); move(-1, 0, sh); return;
      case 'ArrowLeft': e.preventDefault(); move(0, -1, sh); return;
      case 'ArrowRight': e.preventDefault(); move(0, 1, sh); return;
      case 'Tab': e.preventDefault(); move(0, sh ? -1 : 1, false); return;
      case 'Enter': e.preventDefault(); move(sh ? -1 : 1, 0, false); return;
      case 'Home': e.preventDefault(); move(0, -XA.sel.c, sh); return;
      case 'PageDown': e.preventDefault(); move(G.visibleRows(), 0, sh); return;
      case 'PageUp': e.preventDefault(); move(-G.visibleRows(), 0, sh); return;
      case 'F2': e.preventDefault(); G.startEdit(); return;
      case 'Delete': case 'Backspace': e.preventDefault(); XA.clearRange(false); return;
      case 'Escape': XA.clip = null; return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); G.startEdit(k); }
  }
  function onEdKey(e) {
    const ed = G.editing, k = e.key;
    if (!ed) return;
    const done = (dr, dc) => { e.preventDefault(); if (G.endEdit(true)) { move(dr, dc, false); canvas.focus(); } };
    if (k === 'Enter') return done(e.shiftKey ? -1 : 1, 0);
    if (k === 'Tab') return done(0, e.shiftKey ? -1 : 1);
    if (k === 'Escape') { e.preventDefault(); G.endEdit(false); canvas.focus(); return; }
    if (ed.mode === 'enter' && k.startsWith('Arrow') && !ced.value.startsWith('=')) done(k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0);
  }

  // ---------- mouse ----------
  const pos = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  function hit(e) {
    const { x, y } = pos(e), sx = scroll.scrollLeft, sy = scroll.scrollTop;
    if (x < HDRW && y < HDRH) return { k: 'corner' };
    if (y < HDRH) {
      const cx = x - HDRW + sx, c = colAt(cx);
      if (Math.abs(cx - colX[c + 1]) <= 4) return { k: 'resize', c };
      if (c > 0 && Math.abs(cx - colX[c]) <= 4) return { k: 'resize', c: c - 1 };
      return { k: 'col', c };
    }
    if (x < HDRW) return { k: 'row', r: rowAt(y - HDRH + sy) };
    return { k: 'cell', r: rowAt(y - HDRH + sy), c: colAt(x - HDRW + sx) };
  }
  function autoFit(c) {
    const wb = XA.wb, s = XA.s, b = wb.bounds(s); let mx = 0;
    for (let r = 0; r < b.rows; r++) { const x = wb.cell(s, r, c); if (!x) continue; const t = wb.display(s, r, c); if (t) { ctx.font = fontStr(x.st); mx = Math.max(mx, ctx.measureText(t).width); } }
    return Math.max(3, Math.min(60, Math.ceil((mx + 10 - PAD) / CW)));
  }
  function onDown(e) {
    if (e.button === 2) return;
    if (G.editing) G.endEdit(true);
    canvas.focus();
    const h = hit(e), s = XA.sel;
    if (h.k === 'resize') {
      if (e.detail === 2) { XA.setColW(h.c, autoFit(h.c)); return; }
      drag = { k: 'resize', c: h.c, x0: e.clientX, w0: colX[h.c + 1] - colX[h.c] }; e.preventDefault(); return;
    }
    if (h.k === 'cell') {
      if (e.detail === 2) { G.startEdit(); return; }
      if (e.shiftKey) XA.select(s.ar, s.ac, h.r, h.c, true); else XA.select(h.r, h.c, h.r, h.c);
      drag = { k: 'cell' };
    } else if (h.k === 'col') {
      const a = e.shiftKey ? s.ac : h.c;
      XA.select(0, a, C.MAXROW - 1, h.c, true); XA.sel.r = 0;
      drag = { k: 'col', a };
    } else if (h.k === 'row') {
      const a = e.shiftKey ? s.ar : h.r;
      XA.select(a, 0, h.r, C.MAXCOL - 1, true); XA.sel.c = 0;
      drag = { k: 'row', a };
    } else XA.select(C.MAXROW - 1, C.MAXCOL - 1, 0, 0, true);
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag) {
      if (e.target === canvas) { const h = hit(e); canvas.style.cursor = h.k === 'resize' ? 'col-resize' : h.k === 'col' || h.k === 'row' ? 'default' : 'cell'; }
      return;
    }
    if (drag.k === 'resize') { tmp = { c: drag.c, px: Math.max(CW * 2, drag.w0 + e.clientX - drag.x0) }; layout(); G.invalidate(); return; }
    const h = hit(e), s = XA.sel;
    if (drag.k === 'cell' && h.k === 'cell') { XA.select(s.ar, s.ac, h.r, h.c, true); autoScroll(e); }
    else if (drag.k === 'col' && h.c !== undefined) { XA.select(0, drag.a, C.MAXROW - 1, h.c, true); XA.sel.r = 0; }
    else if (drag.k === 'row' && h.r !== undefined) { XA.select(drag.a, 0, h.r, C.MAXCOL - 1, true); XA.sel.c = 0; }
  }
  function autoScroll(e) {
    const b = scroll.getBoundingClientRect();
    if (e.clientY > b.bottom - 14) scroll.scrollTop += ROWH; else if (e.clientY < b.top + HDRH + 4) scroll.scrollTop -= ROWH;
    if (e.clientX > b.right - 14) scroll.scrollLeft += 40; else if (e.clientX < b.left + HDRW + 4) scroll.scrollLeft -= 40;
  }
  function onUp() {
    if (drag && drag.k === 'resize' && tmp) {
      const w = Math.max(1, Math.round((tmp.px - PAD) / CW)), c = tmp.c; tmp = null;
      if (w !== XA.wb.colWidth(XA.s, c)) XA.setColW(c, w); else { layout(); G.invalidate(); }
    }
    drag = null;
  }

  G.init = () => {
    canvas = $('gcanvas'); scroll = $('gscroll'); sizer = $('gsizer'); ced = $('ced'); ctx = canvas.getContext('2d');
    canvas.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    canvas.addEventListener('keydown', onKey); ced.addEventListener('keydown', onEdKey);
    ced.addEventListener('input', () => { $('fbar').value = ced.value; });
    ced.addEventListener('blur', () => { if (G.editing && document.activeElement !== $('fbar')) G.endEdit(true); });
    scroll.addEventListener('scroll', G.invalidate);
    canvas.addEventListener('contextmenu', (e) => {
      const h = hit(e);
      if (h.k === 'cell') { const q = XA.rect(); if (h.r < q.r1 || h.r > q.r2 || h.c < q.c1 || h.c > q.c2) XA.select(h.r, h.c, h.r, h.c); }
      e.preventDefault(); XA.emit('context', e);
    });
    new ResizeObserver(sizeCanvas).observe(scroll);
    for (const ev of ['change', 'select', 'sheets']) XA.on(ev, G.invalidate);
    XA.on('layout', () => { if (XA.wb) { layout(); G.invalidate(); } });
    XA.on('book', () => { scroll.scrollLeft = 0; scroll.scrollTop = 0; });
    sizeCanvas();
  };
  G.setFont = (family, size) => { if (family) G.font.family = family; if (size) G.font.size = size; G.invalidate(); };
  G.focus = () => canvas.focus();
  G.relayout = () => { if (canvas && XA.wb) { layout(); sizeCanvas(); } };
})();
