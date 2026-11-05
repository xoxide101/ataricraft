// Atari matching editor: draws exactly the 64x20 screen ACWriter shows (320x192, 1-bit font, 5 px pitch).
// Lines come from XCW.atariLines (the same layout() that writes the .CWD), so wrap points are what ACWriter will do.
(function () {
  const cv = document.getElementById('atcanvas'), ctx = cv.getContext('2d'), ta = document.getElementById('attext');
  const F4 = XCW_DATA.font4, SY = XCW_DATA.sym, COLS = 64, ROWS = 20, TOP = 8;
  const THEMES = {
    paper: { bg: '#efece2', ink: '#14110c', bar: '#14110c', bt: '#efece2' },
    blue: { bg: '#1b2c8c', ink: '#a8b8ff', bar: '#a8b8ff', bt: '#1b2c8c' },
    amber: { bg: '#2a1700', ink: '#ffb000', bar: '#ffb000', bt: '#2a1700' },
    green: { bg: '#00200a', ink: '#46ff6c', bar: '#46ff6c', bt: '#00200a' },
  };
  let theme = THEMES.paper, scroll = 0, caret = { p: 0, o: 0 }, anchor = { p: 0, o: 0 }, lines = [], goalX = null, blink = 1, drag = false, follow = true;

  const glyph = (c) => (c >= 128 && c <= 255 ? SY.slice((c - 128) * 8, (c - 128) * 8 + 8) : c >= 32 && c <= 127 ? F4[c - 32] : F4[0]);
  const cmp = XCW.cmp;

  function px(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  function drawCell(x, y, cell, ink) {
    const rows = glyph(cell.ch.charCodeAt(0));
    const dy = cell.sup ? -1 : cell.sub ? 1 : 0;
    for (let r = 0; r < rows.length && r < 8; r++) {
      const sh = cell.i && r < 3 ? 1 : 0, bits = rows[r];
      for (let c = 0; c < 4; c++) if (bits & (8 >> c)) { px(x + c + sh, y + r + dy, 1, 1, ink); if (cell.b) px(x + c + sh + 1, y + r + dy, 1, 1, ink); }
    }
    if (cell.u) px(x, y + 7, 5, 1, ink);
  }
  function text(s, x, y, ink) { for (let k = 0; k < s.length; k++) drawCell(x + k * 5, y, { ch: s[k], b: 0, i: 0, u: 0, sup: 0, sub: 0 }, ink); }

  // column of every cell on a line, after alignment and justification
  function cols(line) {
    const base = line.bullet ? 2 : 0, width = COLS - base, cells = line.cells;
    let t = cells.length; while (t > 0 && cells[t - 1].ch === ' ') t--;
    const xs = new Array(cells.length + 1);
    let off = 0;
    if (line.align === 'c') off = Math.max(0, Math.floor((width - t) / 2)); else if (line.align === 'r') off = Math.max(0, width - t);
    let extra = 0, gaps = 0, give = 0;
    if (line.align === 'j' && !line.last) { for (let k = 0; k < t; k++) if (cells[k].ch === ' ') gaps++; extra = gaps ? Math.max(0, width - t) : 0; }
    let x = base + off, g = 0;
    for (let k = 0; k <= cells.length; k++) {
      xs[k] = x;
      if (k < cells.length) {
        x++;
        if (extra && k < t && cells[k].ch === ' ') { g++; const want = Math.floor((extra * g) / gaps); x += want - give; give = want; }
      }
    }
    return xs;
  }
  function relayout() { lines = XCW.atariLines(XW.doc); }
  function posToLC(pos) {
    let best = null;
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      if (l.p !== pos.p || pos.o < l.o0) continue;
      best = { li, k: Math.min(pos.o - l.o0, l.cells.length) };
      if (pos.o < l.o0 + l.cells.length || l.last) break;
    }
    return best || { li: Math.max(0, Math.min(lines.length - 1, pos.p)), k: 0 };
  }
  const lcToPos = (li, k) => { const l = lines[li]; return { p: l.p, o: l.o0 + Math.min(k, l.cells.length) }; };
  const normPos = (pos) => { const d = XW.doc, p = Math.max(0, Math.min(d.length - 1, pos.p)); return { p, o: Math.max(0, Math.min(XCW.ptext(d[p]).length, pos.o)) }; };
  const xsCol = (cl) => { const l = lines[cl.li]; return l ? cols(l)[cl.k] : 0; };

  function render() {
    if (!document.body.classList.contains('m-atari')) return;
    relayout();
    caret = normPos(caret); anchor = normPos(anchor);
    const cl = posToLC(caret);
    if (follow) { if (cl.li < scroll) scroll = cl.li; else if (cl.li >= scroll + ROWS) scroll = cl.li - ROWS + 1; }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - 1)));
    const th = theme;
    px(0, 0, 320, 192, th.bg);
    px(0, 0, 320, 8, th.bar);
    text(' xCWriter / ACWriter view', 0, 0, th.bt);
    const [s, e] = cmp(anchor, caret) <= 0 ? [anchor, caret] : [caret, anchor], has = cmp(s, e) !== 0;
    for (let r = 0; r < ROWS; r++) {
      const li = scroll + r; if (li >= lines.length) break;
      const l = lines[li], xs = cols(l), y = TOP + r * 8;
      if (l.bullet && l.first) drawCell(0, y, { ch: '*', b: 1, i: 0, u: 0, sup: 0, sub: 0 }, th.ink);
      l.cells.forEach((c, k) => {
        const x = xs[k] * 5, here = { p: l.p, o: l.o0 + k };
        const on = has && cmp(here, s) >= 0 && cmp(here, e) < 0;
        if (on) px(x, y, 5, 8, th.ink);
        if (c.ch !== ' ' || c.u) drawCell(x, y, c, on ? th.bg : th.ink);
        if (XW.missAt(l.p, l.o0 + k)) for (let q = 0; q < 5; q += 2) px(x + q, y + 7, 1, 1, '#e0382c');
      });
      if (blink && !has && li === cl.li) px(xs[cl.k] * 5, y, 1, 8, th.ink);
    }
    const f = XCW.fit(XW.doc);
    px(0, 168, 320, 24, th.bar);
    text('Ln ' + (cl.li + 1) + '/' + lines.length + ' Col ' + (xsCol(cl) + 1) + '  ' + f.bytes + '/' + f.limit + ' bytes', 2, 169, th.bt);
    text('^B bold ^I ital ^U undl  H: Open from emulator', 2, 177, th.bt);
    XW.atariInfo(f);
  }

  function setCaret(pos, keepAnchor) {
    caret = normPos(pos); if (!keepAnchor) anchor = caret;
    blink = 1; follow = true; render(); XW.selChanged();
  }
  function moveLine(d, keep) {
    const cl = posToLC(caret), xs = cols(lines[cl.li]);
    if (goalX === null) goalX = xs[cl.k];
    const li = Math.max(0, Math.min(lines.length - 1, cl.li + d)), nx = cols(lines[li]);
    let k = 0, bd = 1e9;
    for (let j = 0; j <= lines[li].cells.length; j++) { const dd = Math.abs(nx[j] - goalX); if (dd < bd) { bd = dd; k = j; } }
    const g = goalX; setCaret(lcToPos(li, k), keep); goalX = g;
  }
  function pointPos(e) {
    const r = cv.getBoundingClientRect(), sc = 320 / cv.clientWidth;
    const x = ((e.clientX - r.left - cv.clientLeft) * sc) / 5, y = (e.clientY - r.top - cv.clientTop) * sc;
    const li = Math.max(0, Math.min(lines.length - 1, scroll + Math.floor((y - TOP) / 8))), xs = cols(lines[li]);
    let k = lines[li].cells.length;
    for (let j = 0; j < lines[li].cells.length; j++) if (x < xs[j] + 0.5) { k = j; break; }
    if (!lines[li].last && k === lines[li].cells.length && k > 0 && lines[li].cells[k - 1].ch === ' ') k--;
    return lcToPos(li, k);
  }
  const mapChar = (ch) => {
    const t = XCW.cleanParas([{ align: 'l', bullet: false, runs: [{ t: ch, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }])[0].runs[0].t;
    return t.length === 1 && XCW.charOk(t) ? t : '?';
  };

  function insert(str) {
    XW.edit((doc) => {
      let pos = caret;
      if (cmp(anchor, caret)) pos = XCW.deleteRange(doc, anchor, caret);
      pos = XCW.insertText(doc, pos, str, XW.typingStyle(doc, pos));
      caret = anchor = pos;
    });
    goalX = null; blink = 1; follow = true; render();
  }
  function remove(dir) {
    XW.edit((doc) => {
      let a = anchor, b = caret;
      if (!cmp(a, b)) {
        if (dir < 0) a = caret.o > 0 ? { p: caret.p, o: caret.o - 1 } : caret.p > 0 ? { p: caret.p - 1, o: XCW.ptext(doc[caret.p - 1]).length } : caret;
        else b = caret.o < XCW.ptext(doc[caret.p]).length ? { p: caret.p, o: caret.o + 1 } : caret.p < doc.length - 1 ? { p: caret.p + 1, o: 0 } : caret;
      }
      caret = anchor = XCW.deleteRange(doc, a, b);
    });
    goalX = null; blink = 1; follow = true; render();
  }

  ta.addEventListener('keydown', (e) => {
    if (XW.key(e)) return;
    const k = e.key, sh = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cl = posToLC(caret);
    const nav = (p) => { e.preventDefault(); setCaret(p, sh); goalX = null; };
    if (k === 'ArrowLeft') nav(caret.o > 0 ? { p: caret.p, o: caret.o - 1 } : caret.p > 0 ? { p: caret.p - 1, o: XCW.ptext(XW.doc[caret.p - 1]).length } : caret);
    else if (k === 'ArrowRight') nav(caret.o < XCW.ptext(XW.doc[caret.p]).length ? { p: caret.p, o: caret.o + 1 } : caret.p < XW.doc.length - 1 ? { p: caret.p + 1, o: 0 } : caret);
    else if (k === 'ArrowUp') { e.preventDefault(); moveLine(-1, sh); } else if (k === 'ArrowDown') { e.preventDefault(); moveLine(1, sh); }
    else if (k === 'PageUp') { e.preventDefault(); moveLine(-ROWS, sh); } else if (k === 'PageDown') { e.preventDefault(); moveLine(ROWS, sh); }
    else if (k === 'Home') nav(lcToPos(cl.li, 0));
    else if (k === 'End') { const l = lines[cl.li]; nav(lcToPos(cl.li, !l.last && l.cells.length && l.cells[l.cells.length - 1].ch === ' ' ? l.cells.length - 1 : l.cells.length)); }
    else if (k === 'Backspace') { e.preventDefault(); remove(-1); } else if (k === 'Delete') { e.preventDefault(); remove(1); }
    else if (k === 'Enter') { e.preventDefault(); insert('\n'); }
    else if (k === 'Tab') { e.preventDefault(); insert('    '); }
    else if (k.length === 1) { e.preventDefault(); insert(mapChar(k)); }
  });
  ta.addEventListener('paste', (e) => { e.preventDefault(); XW.pasteData(e.clipboardData); });
  ta.addEventListener('copy', (e) => { e.preventDefault(); XW.copyData(e.clipboardData, false); });
  ta.addEventListener('cut', (e) => { e.preventDefault(); XW.copyData(e.clipboardData, true); });
  cv.addEventListener('mousedown', (e) => { e.preventDefault(); relayout(); drag = true; setCaret(pointPos(e), e.shiftKey); goalX = null; ta.focus(); });
  window.addEventListener('mousemove', (e) => { if (drag) { setCaret(pointPos(e), true); goalX = null; } });
  window.addEventListener('mouseup', () => { drag = false; });
  cv.addEventListener('dblclick', () => {
    const t = XCW.ptext(XW.doc[caret.p]); let a = caret.o, b = caret.o;
    while (a > 0 && /\S/.test(t[a - 1])) a--;
    while (b < t.length && /\S/.test(t[b])) b++;
    anchor = { p: caret.p, o: a }; caret = { p: caret.p, o: b }; render(); XW.selChanged();
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const mx = Math.max(0, lines.length - ROWS); scroll = Math.max(0, Math.min(mx, scroll + Math.sign(e.deltaY) * 3)); follow = false; render(); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => { relayout(); XW.contextMenu(e, pointPos(e)); });
  setInterval(() => { blink ^= 1; if (document.activeElement === ta) render(); }, 530);

  window.AT = {
    render,
    load(doc, s) { if (s) { anchor = s.a; caret = s.f; } render(); },
    getSel: () => ({ a: anchor, f: caret }),
    setSel(a, f) { anchor = a; caret = f || a; render(); },
    focus() { ta.focus(); },
    setTheme(n) { theme = THEMES[n] || THEMES.paper; render(); },
    lines() { relayout(); return lines; },
    canvas: cv,
  };
})();
