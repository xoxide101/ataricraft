// Page view: the true page (paper, pitch, margins, tab stops from docs/PAGE.md) drawn to scale with the ACWriter pixel font,
// horizontal and vertical scrolling, zoom, a ruler with editable tab stops and a page navigator.
// Logical pixels: one column = CELL[pitch] px wide (5 / 4 / 3 at 10 / 12 / 17 cpi), one line = 8 px (6 lpi), so a page is about 48-51 px per inch.
// Everything is drawn in whole device pixels at any zoom, so the pixel font stays crisp.
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $('pgcanvas'), ctx = cv.getContext('2d'), scr = $('pgscroll'), sizer = $('pgsizer'), ruler = $('pgruler'), rctx = ruler.getContext('2d');
  const nav = $('pgnav'), nctx = nav.getContext('2d'), ta = $('pgtext');
  const F4 = XCW_DATA.font4, SY = XCW_DATA.sym, P = XCW.Page;
  const CELL = { 10: 5, 12: 4, 17: 3 }, LH = 8, PAD = 24, GAP = 16, RH = 28;
  const THEMES = {
    paper: { bg: '#efece2', ink: '#14110c' }, blue: { bg: '#1b2c8c', ink: '#a8b8ff' },
    amber: { bg: '#2a1700', ink: '#ffb000' }, green: { bg: '#00200a', ink: '#46ff6c' },
  };
  const ZOOMS = [[50, '50%'], [75, '75%'], [100, '100% (12 px+ cells)'], [150, '150%'], [200, '200%'], [300, '300%'], [400, '400%'], ['width', 'Fit width'], ['page', 'Fit page'], ['pixel', '1:1 pixels']];
  let theme = THEMES.paper, caret = { p: 0, o: 0 }, anchor = { p: 0, o: 0 }, lines = [], goalX = null, blink = 1, drag = false, zoomSel = 100, z = 3, dpr = 1, rd = null, nd = false, G = null;
  const cmp = XCW.cmp;

  const glyph = (c, face) => {
    if (face && c >= 32 && c <= 127) { const g = faceGlyph(face, c); if (g) return g; }
    return c >= 128 && c <= 255 ? SY.slice((c - 128) * 8, (c - 128) * 8 + 8) : c >= 32 && c <= 127 ? F4[c - 32] : F4[0];
  };

  // typefaces: Atari 1 KB charsets (.fnt, OS screen-code order) listed in the font manifest; the page view shows each 8x8 glyph
  // folded to the 4-pixel cell (the same glyph the ACWriter zoom view draws at 2x). Names are 8.3-safe ids, as ACWriter loads <ID>.FNT.
  const FACES = {}, FCACHE = {};
  const faceId = (u) => u.split('/').pop().replace(/\.[^.]*$/, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
  const screenCode = (c) => (c >= 96 ? c : c - 32);
  function faceRows(face, c) { const f = FACES[face]; if (!f) return null; const o = screenCode(c) * 8; return Array.from(f.slice(o, o + 8)); }
  function faceGlyph(face, c) {
    const key = face + ':' + c; if (FCACHE[key]) return FCACHE[key];
    const r = faceRows(face, c); if (!r) return null;
    return (FCACHE[key] = r.map((b) => { let n = 0; for (let k = 0; k < 4; k++) if ((b >> (7 - 2 * k)) & 3) n |= 8 >> k; return n; }));
  }
  async function loadFaces() {
    if (!/^https?:/.test(location.protocol)) return;
    try {
      const m = await (await fetch('library/fonts/local/manifest.json')).json(), sel = $('pgfont');
      for (const g of m.groups) for (const f of g.fonts) {
        if (!/\.fnt$/i.test(f.url)) continue;
        const id = faceId(f.url); if (FACES[id]) continue;
        const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer()); if (buf.length !== 1024) continue;
        FACES[id] = buf;
        const o = document.createElement('option'); o.value = id; o.textContent = id + (g.id === 'personal' ? ' (personal)' : ''); sel.appendChild(o);
      }
      render();
    } catch (e) { /* the manifest is only served over http */ }
  }
  const page = () => P.info(XW.page || {});
  function geom() {
    const i = page(), cw = CELL[i.pitch], pw = i.paperCols * cw, ph = i.paperLines * LH, n = Math.max(1, Math.ceil(lines.length / i.textLines));
    return { i, cw, pw, ph, n, dw: pw + 2 * PAD, dh: n * ph + (n - 1) * GAP + 2 * PAD };
  }
  const pageTop = (g, k) => PAD + k * (g.ph + GAP);
  const lineY = (g, li) => pageTop(g, Math.floor(li / g.i.textLines)) + (g.i.top + (li % g.i.textLines)) * LH;

  // device-pixel rectangles from logical coordinates; edges are rounded so neighbouring pixels never overlap or leave gaps
  let ox = 0, oy = 0, S = 2;
  function px(c, lx, ly, lw, lh, col) {
    const x0 = Math.round(lx * S) - ox, y0 = Math.round(ly * S) - oy, x1 = Math.round((lx + lw) * S) - ox, y1 = Math.round((ly + lh) * S) - oy;
    if (x1 <= 0 || y1 <= 0 || x0 >= cv.width || y0 >= cv.height) return;
    c.fillStyle = col; c.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }
  function drawCell(x, y, cell, ink, cw, face) {
    const rows = glyph(cell.ch.charCodeAt(0), face), dy = cell.sup ? -1 : cell.sub ? 1 : 0, bw = Math.min(4, cw);
    for (let r = 0; r < rows.length && r < 8; r++) {
      const sh = cell.i && r < 3 ? 1 : 0, bits = rows[r];
      for (let c = 0; c < bw; c++) if (bits & (8 >> c)) { px(ctx, x + c + sh, y + r + dy, 1, 1, ink); if (cell.b && cw > 3) px(ctx, x + c + sh + 1, y + r + dy, 1, 1, ink); }
    }
    if (cell.u) px(ctx, x, y + 7, cw, 1, ink);
  }

  // column (relative to the left margin) of every cell on a line after alignment and justification
  function cols(line, usable) {
    const base = line.bullet ? 2 : 0, width = usable - base, cells = line.cells;
    let t = cells.length; while (t > 0 && cells[t - 1].ch === ' ') t--;
    const xs = new Array(cells.length + 1);
    let off = 0;
    if (line.align === 'c') off = Math.max(0, Math.floor((width - t) / 2)); else if (line.align === 'r') off = Math.max(0, width - t);
    let extra = 0, gaps = 0, give = 0;
    if (line.align === 'j' && !line.last) { for (let k = 0; k < t; k++) if (cells[k].ch === ' ') gaps++; extra = gaps ? Math.max(0, width - t) : 0; }
    let x = base + off, g = 0;
    for (let k = 0; k <= cells.length; k++) {
      xs[k] = x;
      if (k < cells.length) { x++; if (extra && k < t && cells[k].ch === ' ') { g++; const want = Math.floor((extra * g) / gaps); x += want - give; give = want; } }
    }
    return xs;
  }
  const xsOf = (l) => cols(l, page().usable);
  function relayout() { lines = XCW.atariLines(XW.doc, undefined, XW.page || P.normalize({})); }
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

  // ---- zoom and scroll ----
  function computeZ() {
    dpr = window.devicePixelRatio || 1;
    const g = geom(), vw = scr.clientWidth || 800, vh = scr.clientHeight || 500;
    if (zoomSel === 'width') z = (vw - 6) / g.dw;
    else if (zoomSel === 'page') z = Math.min((vw - 6) / g.dw, (vh - 6) / (g.ph + 2 * PAD));
    else if (zoomSel === 'pixel') z = 1 / dpr;
    else z = zoomSel * 3 / 100;
    z = Math.max(0.25, Math.min(16, z));
  }
  function setZoom(v) {
    const old = z, cx = (scr.scrollLeft + scr.clientWidth / 2) / old, cy = (scr.scrollTop + scr.clientHeight / 2) / old;
    zoomSel = v === 'width' || v === 'page' || v === 'pixel' ? v : +v;
    computeZ();
    layoutSizer();
    scr.scrollLeft = cx * z - scr.clientWidth / 2; scr.scrollTop = cy * z - scr.clientHeight / 2;
    render();
  }
  function layoutSizer() {
    const g = geom();
    sizer.style.width = Math.ceil(g.dw * z) + 'px'; sizer.style.height = Math.ceil(g.dh * z) + 'px';
  }
  function fitCanvas() {
    const w = scr.clientWidth, h = scr.clientHeight, W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    if (ruler.width !== W) { ruler.width = W; ruler.height = Math.round(RH * dpr); ruler.style.height = RH + 'px'; }
  }
  function ensureVisible(cl) {
    const g = geom(), l = lines[cl.li]; if (!l) return;
    const lx = PAD + (g.i.left + xsOf(l)[cl.k]) * g.cw, ly = lineY(g, cl.li);
    const vw = scr.clientWidth, vh = scr.clientHeight, m = 40;
    const x0 = lx * z, y0 = ly * z, y1 = (ly + LH) * z;
    if (x0 - m < scr.scrollLeft) scr.scrollLeft = Math.max(0, x0 - m); else if (x0 + g.cw * z + m > scr.scrollLeft + vw) scr.scrollLeft = x0 + g.cw * z + m - vw;
    if (y0 - m < scr.scrollTop) scr.scrollTop = Math.max(0, y0 - m); else if (y1 + m > scr.scrollTop + vh) scr.scrollTop = y1 + m - vh;
  }

  // ---- drawing ----
  function render() {
    if (!document.body.classList.contains('m-page')) return;
    relayout();
    caret = normPos(caret); anchor = normPos(anchor);
    computeZ(); layoutSizer(); fitCanvas();
    S = z * dpr; ox = Math.round(scr.scrollLeft * dpr); oy = Math.round(scr.scrollTop * dpr);
    const g = geom(), th = theme, i = g.i;
    G = g;
    ctx.fillStyle = '#40454f'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let k = 0; k < g.n; k++) {
      const top = pageTop(g, k);
      px(ctx, PAD + 3, top + 3, g.pw, g.ph, '#00000055');
      px(ctx, PAD, top, g.pw, g.ph, th.bg);
      // usable area outline (dotted) so the margins are visible without printing
      const gx = PAD + i.left * g.cw, gy = top + i.top * LH, gw = i.usable * g.cw, gh = i.textLines * LH, gc = th.ink + '33';
      for (let d = 0; d < gw; d += 4) { px(ctx, gx + d, gy - 1, 2, 1, gc); px(ctx, gx + d, gy + gh, 2, 1, gc); }
      for (let d = 0; d < gh; d += 4) { px(ctx, gx - 1, gy + d, 1, 2, gc); px(ctx, gx + gw, gy + d, 1, 2, gc); }
    }
    const [s, e] = cmp(anchor, caret) <= 0 ? [anchor, caret] : [caret, anchor], has = cmp(s, e) !== 0, cl = posToLC(caret);
    const first = Math.max(0, Math.floor((oy / S - PAD) / (g.ph + GAP)) * i.textLines - 1);
    for (let li = first; li < lines.length; li++) {
      const y = lineY(g, li);
      if (y * S - oy > cv.height) break;
      if ((y + LH) * S - oy < 0) continue;
      const l = lines[li], xs = xsOf(l), face = (XW.doc[l.p] && XW.doc[l.p].font) || '';
      if (l.bullet && l.first) drawCell(PAD + i.left * g.cw, y, { ch: '*', b: 1, i: 0, u: 0, sup: 0, sub: 0 }, th.ink, g.cw);
      l.cells.forEach((c, k) => {
        const x = PAD + (i.left + xs[k]) * g.cw, here = { p: l.p, o: l.o0 + k };
        const on = has && cmp(here, s) >= 0 && cmp(here, e) < 0;
        if (on) px(ctx, x, y, g.cw, LH, th.ink);
        if (c.ch !== ' ' || c.u) drawCell(x, y, c, on ? th.bg : th.ink, g.cw, face);
        if (XW.missAt(l.p, l.o0 + k)) for (let q = 0; q < g.cw; q += 2) px(ctx, x + q, y + 7, 1, 1, '#e0382c');
      });
      if (blink && !has && li === cl.li) px(ctx, PAD + (i.left + xs[cl.k]) * g.cw, y, 1, LH, th.ink);
    }
    drawRuler(g); drawNav(g); info(g);
    const pf = (XW.doc[caret.p] && XW.doc[caret.p].font) || '', fs = $('pgfont');
    if (fs.value !== pf && [...fs.options].some((o) => o.value === pf)) fs.value = pf;
    const f = XCW.fit(XW.doc, undefined, XW.page || P.normalize({}));
    XW.atariInfo(f);
  }

  const pix = (c, str, x, y, sc, col) => {
    for (let k = 0; k < str.length; k++) {
      const rows = glyph(str.charCodeAt(k));
      for (let r = 0; r < 7; r++) for (let b = 0; b < 4; b++) if (rows[r] & (8 >> b)) { c.fillStyle = col; c.fillRect(x + (k * 5 + b) * sc, y + r * sc, sc, sc); }
    }
  };
  function drawRuler(g) {
    const i = g.i, w = ruler.width, h = ruler.height, d = Math.max(1, Math.round(dpr)), c = rctx;
    const X = (col) => Math.round((PAD + col * g.cw) * S) - ox;
    c.fillStyle = '#2b2f38'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d9d6cc'; c.fillRect(X(0), 2 * d, X(i.paperCols) - X(0), h - 4 * d);
    c.fillStyle = '#9a978d'; c.fillRect(X(0), 2 * d, X(i.left) - X(0), h - 4 * d); c.fillRect(X(i.paperCols - i.right), 2 * d, X(i.paperCols) - X(i.paperCols - i.right), h - 4 * d);
    const every = z * g.cw >= 4 ? 1 : 5;
    for (let col = 0; col <= i.paperCols; col += every) {
      const maj = col % 10 === 0, mid = col % 5 === 0, len = maj ? 10 : mid ? 7 : 4;
      c.fillStyle = '#222'; c.fillRect(X(col), h - 2 * d - len * d, d, len * d);
      if (maj && col < i.paperCols) pix(c, String(col / 10 * 1), X(col) + 2 * d, 3 * d, Math.max(1, Math.round(d)), '#222');
    }
    // page centre mark
    const cx = X(i.centre); c.fillStyle = '#c0392b'; c.fillRect(cx - d, 2 * d, 2 * d, h - 4 * d);
    c.beginPath(); c.moveTo(cx - 4 * d, 2 * d); c.lineTo(cx + 4 * d, 2 * d); c.lineTo(cx, 7 * d); c.closePath(); c.fill();
    // margin markers
    c.fillStyle = '#1b6dd6';
    const tri = (x, dir) => { c.beginPath(); c.moveTo(x, h - 2 * d); c.lineTo(x - dir * 5 * d, h - 10 * d); c.lineTo(x + dir * 0, h - 10 * d); c.closePath(); c.fill(); c.fillRect(x - (dir > 0 ? 0 : 0), h - 12 * d, d, 10 * d); };
    tri(X(i.left), -1); tri(X(i.paperCols - i.right), 1);
    // tab stops
    c.fillStyle = '#e67e22';
    for (const t of i.tabs) {
      const x = X(t.pos), y = h - 3 * d;
      if (t.kind === 'l') { c.fillRect(x, y - 9 * d, 2 * d, 9 * d); c.fillRect(x, y - 2 * d, 7 * d, 2 * d); }
      else if (t.kind === 'r') { c.fillRect(x - d, y - 9 * d, 2 * d, 9 * d); c.fillRect(x - 6 * d, y - 2 * d, 7 * d, 2 * d); }
      else { c.fillRect(x - d, y - 9 * d, 2 * d, 9 * d); c.fillRect(x - 5 * d, y - 2 * d, 11 * d, 2 * d); }
    }
  }
  function info(g) {
    const i = g.i, longest = lines.reduce((m, l) => Math.max(m, l.cells.length + (l.bullet ? 2 : 0)), 0);
    const el = $('pgfit');
    el.innerHTML = '<b>' + P.PAPERS[i.paper].name + '</b> &middot; ' + i.pitch + ' cpi &middot; usable <b>' + i.usable + ' of ' + i.paperCols + ' columns</b> (' + i.usableInches.toFixed(1) + ' in), ' + i.textLines + ' lines/page &middot; ' + g.n + ' page' + (g.n > 1 ? 's' : '') + ' &middot; longest line ' + longest + ' col &middot; ' + Math.round(z * 50) + '%';
    el.classList.toggle('warn', longest > i.usable);
  }
  function navScale(g) { return Math.min(110 / g.dw, 150 / g.dh); }
  function drawNav(g) {
    const sc = navScale(g), W = Math.max(30, Math.round(g.dw * sc)), H = Math.max(30, Math.round(g.dh * sc));
    if (nav.width !== W || nav.height !== H) { nav.width = W; nav.height = H; nav.style.width = W + 'px'; nav.style.height = H + 'px'; }
    nctx.fillStyle = '#2b2f38'; nctx.fillRect(0, 0, W, H);
    const i = g.i;
    for (let k = 0; k < g.n; k++) {
      const top = pageTop(g, k);
      nctx.fillStyle = theme.bg; nctx.fillRect(Math.round(PAD * sc), Math.round(top * sc), Math.max(1, Math.round(g.pw * sc)), Math.max(1, Math.round(g.ph * sc)));
    }
    nctx.fillStyle = theme.ink + '99';
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li], n = l.cells.length; if (!n) continue;
      const xs = xsOf(l);
      nctx.fillRect(Math.round((PAD + (i.left + xs[0]) * g.cw) * sc), Math.round(lineY(g, li) * sc + 1), Math.max(1, Math.round(n * g.cw * sc)), 1);
    }
    const vx = scr.scrollLeft / z * sc, vy = scr.scrollTop / z * sc, vw = Math.min(W, scr.clientWidth / z * sc), vh = Math.min(H, scr.clientHeight / z * sc);
    nctx.strokeStyle = '#ff9d3a'; nctx.lineWidth = 2; nctx.strokeRect(vx + 1, vy + 1, Math.max(4, vw - 2), Math.max(4, vh - 2));
    nctx.fillStyle = '#ff9d3a22'; nctx.fillRect(vx, vy, vw, vh);
  }
  function navMove(e) {
    const r = nav.getBoundingClientRect(), g = geom(), sc = navScale(g);
    const lx = (e.clientX - r.left) / sc, ly = (e.clientY - r.top) / sc;
    scr.scrollLeft = lx * z - scr.clientWidth / 2; scr.scrollTop = ly * z - scr.clientHeight / 2;
    render();
  }
  nav.addEventListener('mousedown', (e) => { e.preventDefault(); nd = true; navMove(e); });
  window.addEventListener('mousemove', (e) => { if (nd) navMove(e); });
  window.addEventListener('mouseup', () => { nd = false; });

  // ---- ruler editing ----
  const colAt = (e) => { const r = ruler.getBoundingClientRect(), g = geom(); return ((e.clientX - r.left + scr.scrollLeft) / z - PAD) / g.cw; };
  function setPage(patch) { XW.page = P.normalize({ ...P.info(XW.page || {}), ...patch }); XW.pageChanged(); }
  ruler.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const c = colAt(e), i = page(), tol = Math.max(0.6, 5 / (z * geom().cw));
    const t = i.tabs.find((q) => Math.abs(q.pos - c) <= tol);
    if (Math.abs(c - i.left) <= tol && !t) rd = { m: 'left' };
    else if (Math.abs(c - (i.paperCols - i.right)) <= tol && !t) rd = { m: 'right' };
    else if (t) rd = { m: 'tab', pos: t.pos, kind: t.kind };
    else if (c >= 0 && c < i.paperCols) { const pos = Math.round(c); setPage({ tabs: i.tabs.concat([{ pos, kind: $('pgkind').value }]) }); rd = { m: 'tab', pos, kind: $('pgkind').value }; }
  });
  window.addEventListener('mousemove', (e) => {
    if (!rd) return;
    const i = page(), c = Math.round(colAt(e));
    if (rd.m === 'left') setPage({ left: Math.max(0, Math.min(c, i.paperCols - i.right - 8)) });
    else if (rd.m === 'right') setPage({ right: Math.max(0, Math.min(i.paperCols - c, i.paperCols - i.left - 8)) });
    else if (c >= 0 && c < i.paperCols && c !== rd.pos && !i.tabs.some((q) => q.pos === c)) {
      setPage({ tabs: i.tabs.map((q) => (q.pos === rd.pos ? { pos: c, kind: rd.kind } : q)) }); rd.pos = c;
    }
  });
  window.addEventListener('mouseup', () => { rd = null; });
  const removeTabAt = (e) => { const i = page(), c = colAt(e), t = i.tabs.find((q) => Math.abs(q.pos - c) <= 0.8); if (t) setPage({ tabs: i.tabs.filter((q) => q !== t) }); };
  ruler.addEventListener('dblclick', removeTabAt);
  ruler.addEventListener('contextmenu', (e) => { e.preventDefault(); removeTabAt(e); });

  // ---- editing (same model operations as the Atari view) ----
  function setCaret(pos, keepAnchor) {
    caret = normPos(pos); if (!keepAnchor) anchor = caret;
    blink = 1; relayout(); computeZ(); ensureVisible(posToLC(caret)); render(); XW.selChanged();
  }
  function moveLine(d, keep) {
    const cl = posToLC(caret), xs = xsOf(lines[cl.li]);
    if (goalX === null) goalX = xs[cl.k];
    const li = Math.max(0, Math.min(lines.length - 1, cl.li + d)), nx = xsOf(lines[li]);
    let k = 0, bd = 1e9;
    for (let j = 0; j <= lines[li].cells.length; j++) { const dd = Math.abs(nx[j] - goalX); if (dd < bd) { bd = dd; k = j; } }
    const gx = goalX; setCaret(lcToPos(li, k), keep); goalX = gx;
  }
  function pointPos(e) {
    const r = cv.getBoundingClientRect(), g = geom(), i = g.i;
    const lx = (e.clientX - r.left + scr.scrollLeft) / z, ly = (e.clientY - r.top + scr.scrollTop) / z;
    const pg = Math.max(0, Math.min(g.n - 1, Math.floor((ly - PAD + GAP / 2) / (g.ph + GAP))));
    const row = Math.max(0, Math.min(i.textLines - 1, Math.floor((ly - pageTop(g, pg) - i.top * LH) / LH)));
    const li = Math.max(0, Math.min(lines.length - 1, pg * i.textLines + row)), xs = xsOf(lines[li]), x = (lx - PAD) / g.cw - i.left;
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
    goalX = null; blink = 1; relayout(); ensureVisible(posToLC(caret)); render();
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
    goalX = null; blink = 1; relayout(); ensureVisible(posToLC(caret)); render();
  }
  // Tab: spaces up to the next tab stop (absolute column). Craft text has no tab code; centre and right stops act as left stops while typing.
  function tabSpaces() {
    const cl = posToLC(caret), i = page(), col = i.left + xsOf(lines[cl.li])[cl.k];
    const st = i.tabs.find((t) => t.pos > col), target = st ? st.pos : col + 8 - ((col - i.left) % 8);
    return ' '.repeat(Math.max(1, target - col));
  }

  ta.addEventListener('keydown', (e) => {
    if (XW.key(e)) return;
    const k = e.key, sh = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cl = posToLC(caret), tl = page().textLines;
    const go = (p) => { e.preventDefault(); setCaret(p, sh); goalX = null; };
    if (k === 'ArrowLeft') go(caret.o > 0 ? { p: caret.p, o: caret.o - 1 } : caret.p > 0 ? { p: caret.p - 1, o: XCW.ptext(XW.doc[caret.p - 1]).length } : caret);
    else if (k === 'ArrowRight') go(caret.o < XCW.ptext(XW.doc[caret.p]).length ? { p: caret.p, o: caret.o + 1 } : caret.p < XW.doc.length - 1 ? { p: caret.p + 1, o: 0 } : caret);
    else if (k === 'ArrowUp') { e.preventDefault(); moveLine(-1, sh); } else if (k === 'ArrowDown') { e.preventDefault(); moveLine(1, sh); }
    else if (k === 'PageUp') { e.preventDefault(); moveLine(-tl, sh); } else if (k === 'PageDown') { e.preventDefault(); moveLine(tl, sh); }
    else if (k === 'Home') go(lcToPos(cl.li, 0));
    else if (k === 'End') { const l = lines[cl.li]; go(lcToPos(cl.li, !l.last && l.cells.length && l.cells[l.cells.length - 1].ch === ' ' ? l.cells.length - 1 : l.cells.length)); }
    else if (k === 'Backspace') { e.preventDefault(); remove(-1); } else if (k === 'Delete') { e.preventDefault(); remove(1); }
    else if (k === 'Enter') { e.preventDefault(); insert('\n'); }
    else if (k === 'Tab') { e.preventDefault(); insert(tabSpaces()); }
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
  cv.addEventListener('contextmenu', (e) => { relayout(); XW.contextMenu(e, pointPos(e)); });
  scr.addEventListener('scroll', () => render());
  scr.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const steps = [50, 75, 100, 150, 200, 300, 400], cur = Math.round(z * 100 / 3);
    let k = steps.findIndex((s) => s >= cur - 1); if (k < 0) k = steps.length - 1;
    k = Math.max(0, Math.min(steps.length - 1, k + (e.deltaY < 0 ? 1 : -1)));
    $('pgzoom').value = String(steps[k]); setZoom(steps[k]);
  }, { passive: false });
  window.addEventListener('resize', () => render());
  setInterval(() => { blink ^= 1; if (document.activeElement === ta && document.body.classList.contains('m-page')) render(); }, 530);

  // ---- zoom select and Page setup dialog ----
  $('pgzoom').innerHTML = ZOOMS.map((q) => '<option value="' + q[0] + '"' + (q[0] === 100 ? ' selected' : '') + '>' + q[1] + '</option>').join('');
  $('pgzoom').onchange = () => { setZoom($('pgzoom').value); ta.focus(); };
  $('pgfont').onchange = () => { XW.setFont($('pgfont').value); ta.focus(); };
  loadFaces();

  function setupDialog() {
    const cur = page(); let tabs = cur.tabs.map((t) => ({ ...t }));
    const H = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    XW.modal('<h3>Page setup</h3>' +
      '<div class="g2"><div><label>Paper</label><select id="psp">' + Object.values(P.PAPERS).map((p) => '<option value="' + p.id + '">' + H(p.name) + '</option>').join('') + '</select></div>' +
      '<div><label>Pitch</label><select id="psc">' + P.PITCHES.map((c) => '<option value="' + c + '">' + c + ' characters per inch' + (c === 17 ? ' (compressed)' : '') + '</option>').join('') + '</select></div>' +
      '<div><label>Left margin (columns)</label><input type="number" id="psl" min="0"></div><div><label>Right margin (columns)</label><input type="number" id="psr" min="0"></div>' +
      '<div><label>Top margin (lines)</label><input type="number" id="pst" min="0"></div><div><label>Bottom margin (lines)</label><input type="number" id="psb" min="0"></div></div>' +
      '<label>How the usable area fits the paper</label><div class="fitbar" id="psbar"></div><div id="pssum" class="dim"></div>' +
      '<label>Tab stops</label><div id="pstabs" class="dim"></div>' +
      '<div class="row"><button id="psclr">Clear tabs</button><button id="psdef">Defaults</button><span style="flex:1"></span><button id="pscancel">Cancel</button><button class="on" id="psok">OK</button></div>');
    $('psp').value = cur.paper; $('psc').value = cur.pitch; $('psl').value = cur.left; $('psr').value = cur.right; $('pst').value = cur.top; $('psb').value = cur.bottom;
    const read = () => P.info({ paper: $('psp').value, pitch: +$('psc').value, left: +$('psl').value, right: +$('psr').value, top: +$('pst').value, bottom: +$('psb').value, tabs, font: cur.font });
    const upd = () => {
      const i = read(), longest = lines.reduce((m, l) => Math.max(m, l.cells.length), 0);
      $('psbar').innerHTML = '<i class="m" style="width:' + (i.left * 100 / i.paperCols) + '%">' + (i.left ? i.left : '') + '</i><i class="u" style="width:' + (i.usable * 100 / i.paperCols) + '%">' + i.usable + ' columns usable</i><i class="m" style="width:' + (i.right * 100 / i.paperCols) + '%">' + (i.right ? i.right : '') + '</i>';
      $('pssum').innerHTML = 'Paper ' + i.paperCols + ' columns (' + i.inchesWide.toFixed(2) + ' in) &middot; usable ' + i.usable + ' columns = ' + i.usableInches.toFixed(2) + ' in &middot; ' + i.textLines + ' of ' + i.paperLines + ' lines per page &middot; page centre at column ' + i.centre + '. On the 320 px Atari screen: ' + i.usable * CELL[i.pitch] + ' px of text, ' + (i.usable * CELL[i.pitch] > 320 ? 'needs horizontal scrolling' : 'fits') + '.';
      $('pstabs').innerHTML = i.tabs.length ? i.tabs.map((t, k) => '<span style="margin-right:12px">' + { l: 'Left', c: 'Centre', r: 'Right' }[t.kind] + ' ' + t.pos + ' <a href="#" data-k="' + k + '" style="color:#ff9d3a">remove</a></span>').join('') : 'None. Click the ruler in the page view to add one.';
    };
    const pitchChanged = () => { const d = P.defaults($('psp').value, +$('psc').value); $('psl').value = d.left; $('psr').value = d.right; };
    $('psp').onchange = () => { tabs = tabs.filter((t) => t.pos < read().paperCols); upd(); };
    $('psc').onchange = () => { pitchChanged(); tabs = []; upd(); };
    ['psl', 'psr', 'pst', 'psb'].forEach((id) => { $(id).oninput = upd; });
    $('pstabs').onclick = (e) => { const k = e.target.dataset && e.target.dataset.k; if (k !== undefined) { e.preventDefault(); tabs.splice(+k, 1); upd(); } };
    $('psclr').onclick = () => { tabs = []; upd(); };
    $('psdef').onclick = () => { const d = P.defaults('letter', 10); $('psp').value = 'letter'; $('psc').value = 10; $('psl').value = d.left; $('psr').value = d.right; $('pst').value = d.top; $('psb').value = d.bottom; tabs = []; upd(); };
    $('pscancel').onclick = XW.closeModal;
    $('psok').onclick = () => { const i = read(); XW.closeModal(); XW.page = P.normalize({ ...i, tabs: i.tabs }); XW.pageChanged(); ta.focus(); };
    upd();
  }
  $('pgsetup').onclick = setupDialog;

  window.PG = {
    render,
    load(doc, s) { if (s) { anchor = s.a; caret = s.f; } relayout(); render(); },
    getSel: () => ({ a: anchor, f: caret }),
    setSel(a, f) { anchor = a; caret = f || a; render(); },
    focus() { ta.focus(); },
    setTheme(n) { theme = THEMES[n] || THEMES.paper; render(); },
    lines() { relayout(); return lines; },
    canvas: cv, setup: setupDialog, setZoom, scroller: scr, faceRows, faces: () => Object.keys(FACES),
    state: () => ({ z, dpr, geom: geom(), scrollLeft: scr.scrollLeft, scrollTop: scr.scrollTop }),
  };
})();
