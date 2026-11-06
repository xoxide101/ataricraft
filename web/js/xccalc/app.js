// xCCalc application state and operations: workbook, selection, undo/redo, clipboard, files, history.
// The engine is tools/calccore.cjs (window.XCC.C, bundled by scripts/sync-xccalc-core.cjs). No DOM here except toast/dialog helpers.
(function () {
  'use strict';
  const { C, F, IO } = window.XCC;
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const XA = window.XA = { C, F, IO, $, LS, wb: null, s: 0, name: 'Untitled', dirty: false, undo: [], redo: [], clip: null, listeners: {}, sel: { ar: 0, ac: 0, r: 0, c: 0 } };
  XA.on = (ev, fn) => { (XA.listeners[ev] = XA.listeners[ev] || []).push(fn); };
  XA.emit = (ev, a) => { for (const fn of XA.listeners[ev] || []) fn(a); };

  let toastT = 0;
  XA.toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2600); };
  XA.dialog = (html, wire) => { $('dlg').innerHTML = html; $('modal').classList.add('on'); if (wire) wire($('dlg')); };
  XA.closeDialog = () => { $('modal').classList.remove('on'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  XA.esc = esc;

  // ---------- selection ----------
  XA.rect = () => { const s = XA.sel; return { r1: Math.min(s.ar, s.r), r2: Math.max(s.ar, s.r), c1: Math.min(s.ac, s.c), c2: Math.max(s.ac, s.c) }; };
  // whole column/row selections are clamped to the used area so operations stay small
  XA.opRect = () => {
    const q = XA.rect(), b = XA.wb.bounds(XA.s);
    if (q.r1 === 0 && q.r2 >= C.MAXROW - 1) q.r2 = Math.max(b.rows - 1, 0);
    if (q.c1 === 0 && q.c2 >= C.MAXCOL - 1) q.c2 = Math.max(b.cols - 1, 0);
    return q;
  };
  XA.select = (ar, ac, r, c, keepAnchor) => {
    const s = XA.sel;
    r = Math.max(0, Math.min(C.MAXROW - 1, r)); c = Math.max(0, Math.min(C.MAXCOL - 1, c));
    if (!keepAnchor) { s.ar = r; s.ac = c; } else { s.ar = Math.max(0, Math.min(C.MAXROW - 1, ar)); s.ac = Math.max(0, Math.min(C.MAXCOL - 1, ac)); }
    s.r = r; s.c = c; XA.emit('select');
  };
  XA.addr = (r, c) => C.colName(c) + (r + 1);
  XA.rangeText = (q) => (q.r1 === q.r2 && q.c1 === q.c2 ? XA.addr(q.r1, q.c1) : XA.addr(q.r1, q.c1) + ':' + XA.addr(q.r2, q.c2));

  // ---------- cell snapshots for undo ----------
  const snap = (s, r, c) => { const x = XA.wb.cell(s, r, c); return x ? { f: x.f || null, val: x.val, fmt: x.fmt, st: x.st, fmtc: x.fmtc || null } : null; };
  XA.snap = snap;
  function restore(s, r, c, st, dr = 0, dc = 0) {
    const wb = XA.wb;
    if (!st) { wb.clear(s, r, c, true); return; }
    if (st.f) wb.setFormula(s, r, c, dr || dc ? C.shiftFormula(st.f, dr, dc) : st.f);
    else if (st.val !== null && st.val !== undefined) wb.setValue(s, r, c, st.val);
    else wb.clear(s, r, c, false);
    if (st.fmt || st.st || st.fmtc) {
      const y = wb.ensure(s, r, c); y.fmt = st.fmt; y.st = st.st;
      if (st.fmtc) y.fmtc = st.fmtc; else delete y.fmtc;
    } else { const y = wb.cell(s, r, c); if (y) { y.fmt = 0; y.st = 0; delete y.fmtc; wb.prune(s, r, c); } }
  }
  function coords(s, q) {
    const out = [], area = (q.r2 - q.r1 + 1) * (q.c2 - q.c1 + 1);
    if (area <= 40000) { for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) out.push([r, c]); } else {
      for (const kk of XA.wb.sheets[s].cells.keys()) { const r = kk >> 8, c = kk & 255; if (r >= q.r1 && r <= q.r2 && c >= q.c1 && c <= q.c2) out.push([r, c]); }
    }
    return out;
  }
  const selCopy = () => Object.assign({}, XA.sel);
  XA.touch = () => { XA.dirty = true; XA.emit('change'); };

  // run fn, recording the before/after state of every cell in rects as one undo step
  XA.act = (rects, fn) => {
    const s = XA.s, list = [], seen = new Set();
    for (const q of rects) for (const [r, c] of coords(s, q)) { const k = r * 256 + c; if (!seen.has(k)) { seen.add(k); list.push([r, c]); } }
    const before = list.map(([r, c]) => snap(s, r, c)), selBefore = selCopy();
    fn();
    const items = list.map(([r, c], i) => [r, c, before[i], snap(s, r, c)]);
    XA.pushUndo({ s, items, selBefore, selAfter: selCopy() });
    XA.touch();
  };
  XA.pushUndo = (e) => { XA.undo.push(e); if (XA.undo.length > 300) XA.undo.shift(); XA.redo = []; XA.emit('history'); };
  function apply(e, back) {
    const wb = XA.wb;
    if (e.run) { (back ? e.undo : e.redo)(); } else {
      wb.batch(() => { for (const [r, c, b, a] of e.items) restore(e.s, r, c, back ? b : a); });
      const q = back ? e.selBefore : e.selAfter; if (q) XA.sel = Object.assign({}, q);
    }
  }
  XA.doUndo = () => { const e = XA.undo.pop(); if (!e) return; apply(e, true); XA.redo.push(e); XA.touch(); XA.emit('history'); XA.emit('sheets'); XA.emit('select'); XA.emit('layout'); };
  XA.doRedo = () => { const e = XA.redo.pop(); if (!e) return; apply(e, false); XA.undo.push(e); XA.touch(); XA.emit('history'); XA.emit('sheets'); XA.emit('select'); XA.emit('layout'); };
  // sheet-level step with its own undo and redo functions
  XA.step = (undo, redo) => { redo(); XA.undo.push({ run: true, undo, redo }); XA.redo = []; XA.touch(); XA.emit('history'); XA.emit('layout'); };

  // ---------- editing ----------
  XA.commit = (r, c, text) => {
    try { XA.act([{ r1: r, c1: c, r2: r, c2: c }], () => XA.wb.input(XA.s, { r, c }, text)); return true; } catch (e) { XA.toast(String(e.message || e)); return false; }
  };
  XA.clearRange = (all) => { const q = XA.opRect(); XA.act([q], () => XA.wb.batch(() => { for (const [r, c] of coords(XA.s, q)) XA.wb.clear(XA.s, r, c, all); })); };
  XA.eachCell = (q, fn) => XA.wb.batch(() => { for (const [r, c] of coords(XA.s, q)) fn(r, c); });

  XA.setStyle = (mask, mode) => { // mode: 'toggle' | 'set' | 'clear'
    const q = XA.opRect(), wb = XA.wb, s = XA.s;
    let all = true;
    if (mode === 'toggle') for (const [r, c] of coords(s, q)) { const x = wb.cell(s, r, c); if (!x || !(x.st & mask)) { all = false; break; } }
    XA.act([q], () => XA.eachCell(q, (r, c) => { const x = wb.cell(s, r, c), st = x ? x.st : 0; wb.setStyle(s, r, c, mode === 'toggle' ? (all ? st & ~mask : st | mask) : mode === 'set' ? st | mask : st & ~mask); }));
  };
  XA.setAlign = (a) => { // 0 auto 1 left 2 centre 3 right
    const q = XA.opRect(), wb = XA.wb, s = XA.s;
    XA.act([q], () => XA.eachCell(q, (r, c) => { const x = wb.cell(s, r, c), st = x ? x.st : 0; wb.setStyle(s, r, c, (st & ~24) | (a << 3)); }));
  };
  XA.setFormat = (code) => { const q = XA.opRect(), wb = XA.wb, s = XA.s; XA.act([q], () => XA.eachCell(q, (r, c) => wb.setFormat(s, r, c, code))); };

  XA.fill = (dir) => {
    const q = XA.opRect(), wb = XA.wb, s = XA.s;
    const down = dir === 'down';
    let src, dest;
    if (down) { if (q.r2 > q.r1) { src = { r1: q.r1, r2: q.r1, c1: q.c1, c2: q.c2 }; dest = { r1: q.r1 + 1, r2: q.r2, c1: q.c1, c2: q.c2 }; } else if (q.r1 > 0) { src = { r1: q.r1 - 1, r2: q.r1 - 1, c1: q.c1, c2: q.c2 }; dest = q; } }
    else if (q.c2 > q.c1) { src = { r1: q.r1, r2: q.r2, c1: q.c1, c2: q.c1 }; dest = { r1: q.r1, r2: q.r2, c1: q.c1 + 1, c2: q.c2 }; } else if (q.c1 > 0) { src = { r1: q.r1, r2: q.r2, c1: q.c1 - 1, c2: q.c1 - 1 }; dest = q; }
    if (!dest) return;
    XA.act([dest], () => wb.batch(() => {
      for (let r = dest.r1; r <= dest.r2; r++) for (let c = dest.c1; c <= dest.c2; c++) {
        const sr = down ? src.r1 : r, sc = down ? c : src.c1;
        restore(s, r, c, snap(s, sr, sc), r - sr, c - sc);
      }
    }));
  };

  // ---------- clipboard ----------
  const tsvQuote = (t) => (/[\t\r\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
  XA.copyText = (cut) => {
    const q = XA.opRect(), rows = [];
    for (let r = q.r1; r <= q.r2; r++) { const row = []; for (let c = q.c1; c <= q.c2; c++) row.push(tsvQuote(XA.wb.display(XA.s, r, c))); rows.push(row.join('\t')); }
    const text = rows.join('\r\n') + '\r\n';
    XA.clip = { text, s: XA.s, q, cut: !!cut };
    return text;
  };
  XA.pasteText = (text) => {
    const wb = XA.wb, s = XA.s, sel = XA.rect(), clip = XA.clip;
    const norm = (t) => t.replace(/\r\n?/g, '\n');
    if (clip && norm(clip.text) === norm(text)) {
      const h = clip.q.r2 - clip.q.r1 + 1, w = clip.q.c2 - clip.q.c1 + 1;
      const dest = { r1: sel.r1, c1: sel.c1, r2: Math.min(C.MAXROW - 1, sel.r1 + h - 1), c2: Math.min(C.MAXCOL - 1, sel.c1 + w - 1) };
      const srcs = []; for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) srcs.push([r, c, snap(clip.s, clip.q.r1 + r, clip.q.c1 + c)]);
      XA.act(clip.cut ? [dest, clip.q] : [dest], () => wb.batch(() => {
        if (clip.cut && clip.s === s) for (const [r, c] of coords(s, clip.q)) wb.clear(s, r, c, true);
        for (const [r, c, st] of srcs) { const rr = dest.r1 + r, cc = dest.c1 + c; if (rr < C.MAXROW && cc < C.MAXCOL) restore(s, rr, cc, st, rr - (clip.q.r1 + r), cc - (clip.q.c1 + c)); }
      }));
      if (clip.cut) XA.clip = null;
      XA.select(dest.r1, dest.c1, dest.r2, dest.c2, true);
      return;
    }
    const rows = IO.parseCSV(text, '\t');
    if (!rows.length) return;
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    const single = h === 1 && w === 1, big = single && (sel.r2 > sel.r1 || sel.c2 > sel.c1);
    const dest = big ? sel : { r1: sel.r1, c1: sel.c1, r2: Math.min(C.MAXROW - 1, sel.r1 + h - 1), c2: Math.min(C.MAXCOL - 1, sel.c1 + w - 1) };
    XA.act([dest], () => wb.batch(() => {
      for (let r = dest.r1; r <= dest.r2; r++) for (let c = dest.c1; c <= dest.c2; c++) {
        const fld = big ? rows[0][0] : (rows[r - dest.r1] || [])[c - dest.c1];
        if (fld === undefined) continue;
        if (typeof fld === 'object') wb.setValue(s, r, c, fld.q); else wb.input(s, { r, c }, fld);
      }
    }));
    XA.select(dest.r1, dest.c1, dest.r2, dest.c2, true);
  };

  // ---------- sheets, widths, mode ----------
  XA.addSheet = () => {
    const wb = XA.wb; let n = wb.sheets.length + 1; while (wb.sheetIndex('Sheet' + n) >= 0) n++;
    if (wb.sheets.length >= 16) { XA.toast('At most 16 sheets'); return; }
    let idx;
    XA.step(() => { wb.sheets.pop(); wb.recompileAll(); if (XA.s >= wb.sheets.length) XA.s = wb.sheets.length - 1; }, () => { idx = wb.addSheet('Sheet' + n); XA.s = idx; wb.recompileAll(); });
    XA.emit('sheets'); XA.emit('select');
  };
  XA.renameSheet = (i, name) => {
    name = name.trim(); const old = XA.wb.sheets[i].name;
    if (!name || name === old) return;
    const j = XA.wb.sheetIndex(name);
    if (j >= 0 && j !== i) { XA.toast('duplicate sheet name'); return; }
    try { XA.step(() => { XA.wb.renameSheet(i, old); XA.emit('sheets'); }, () => { XA.wb.renameSheet(i, name); XA.emit('sheets'); }); } catch (e) { XA.toast(e.message); }
    XA.emit('sheets');
  };
  XA.gotoSheet = (i) => { if (i === XA.s || i < 0 || i >= XA.wb.sheets.length) return; XA.s = i; XA.sel = { ar: 0, ac: 0, r: 0, c: 0 }; XA.emit('sheets'); XA.emit('layout'); XA.emit('select'); };
  XA.setColW = (c, w) => {
    const sh = XA.wb.sheets[XA.s], old = sh.colw.has(c) ? sh.colw.get(c) : null, s = XA.s;
    w = Math.max(1, Math.min(255, Math.round(w)));
    const set = (v) => { const sh2 = XA.wb.sheets[s]; if (v === null) sh2.colw.delete(c); else sh2.colw.set(c, v); };
    XA.step(() => set(old), () => set(w));
  };
  XA.setMode = (mode) => {
    const old = XA.wb.mode; if (old === mode) return;
    XA.step(() => XA.wb.setMode(old), () => XA.wb.setMode(mode));
    XA.emit('mode');
  };

  // ---------- documents ----------
  XA.setBook = (wb, name, opts) => {
    XA.wb = wb; XA.s = 0; XA.name = name || 'Untitled'; XA.undo = []; XA.redo = []; XA.clip = null; XA.dirty = false; XA.sel = { ar: 0, ac: 0, r: 0, c: 0 };
    XA.loss = (opts && opts.loss) || [];
    XA.emit('book'); XA.emit('history'); XA.emit('sheets'); XA.emit('layout'); XA.emit('select'); XA.emit('mode'); XA.emit('change');
  };
  XA.newBook = (mode) => XA.setBook(new C.Workbook({ mode: mode || 'ieee' }), 'Untitled.xcs');

  XA.demo = () => {
    const wb = new C.Workbook({ mode: 'ieee' }), I = (a, t, s = 0) => wb.input(s, a, t);
    wb.batch(() => {
      I('A1', 'Craft club budget'); wb.setStyle(0, 0, 0, 1);
      ['Item', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'].forEach((h, i) => { I(C.colName(i) + '3', h); wb.setStyle(0, 2, i, 1 | (i ? 24 : 0)); });
      const rows = [['Cartridges', 120, 150, 90, 200], ['Disks', 40, 35, 60, 45], ['Cables', 18.5, 22, 19.75, 30], ['Postage', 12, 12, 15, 18], ['Fonts', 0, 25, 0, 50]];
      rows.forEach((row, i) => {
        const r = i + 4; I('A' + r, row[0]);
        for (let k = 1; k <= 4; k++) { I(C.colName(k) + r, String(row[k])); wb.setFormat(0, r - 1, k, '$#,##0.00'); }
        I('F' + r, '=SUM(B' + r + ':E' + r + ')'); wb.setFormat(0, r - 1, 5, '$#,##0.00');
      });
      I('A9', 'Total'); wb.setStyle(0, 8, 0, 1);
      for (let k = 1; k <= 5; k++) { const cn = C.colName(k); I(cn + '9', '=SUM(' + cn + '4:' + cn + '8)'); wb.setFormat(0, 8, k, '$#,##0.00'); wb.setStyle(0, 8, k, 1); }
      I('A11', 'Biggest quarter'); I('B11', '=MAX(B9:E9)'); wb.setFormat(0, 10, 1, '$#,##0.00');
      I('A12', 'Average per item'); I('B12', '=AVERAGE(F4:F8)'); wb.setFormat(0, 11, 1, '$#,##0.00');
      I('A13', 'Over budget?'); I('B13', '=IF(F9>1000,"yes","no")');
      for (let c = 1; c <= 5; c++) wb.sheets[0].colw.set(c, 11);
      wb.sheets[0].colw.set(0, 16);
    });
    wb.charts.push({ kind: 'bar', sheet: 0, title: 'Spending by quarter', range: 'B3:E5', row: 2, col: 7, w: 8, h: 12 });
    return wb;
  };

  const ext = (n) => (/\.([A-Za-z0-9]+)$/.exec(n) || [, ''])[1].toLowerCase();
  XA.importFile = (bytes, name) => {
    const e = ext(name), isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (bytes.length >= 16 && bytes[0] === 0x43 && bytes[1] === 0x52 && bytes[2] === 0x46 && bytes[3] === 0x54) {
      const r = F.fromBinary(bytes); return { wb: r.wb, loss: (r.info.warnings || []).map((w) => ({ code: 'xcs-warning', severity: 'warn', count: 1, detail: w })), kind: 'xcs' };
    }
    if (bytes[0] === 0x7b && /xcs-json/.test(new TextDecoder().decode(bytes.subarray(0, 200)))) return { wb: F.fromJSON(new TextDecoder().decode(bytes)), loss: [], kind: 'xcs-json' };
    if (isZip || e === 'xlsx' || e === 'xlsm') {
      const z = IO.zipRead(bytes);
      if (z.has('content.xml') && !z.has('xl/workbook.xml')) return Object.assign(IO.importODS(bytes), { kind: 'ods' });
      return Object.assign(IO.importXLSX(bytes), { kind: 'xlsx' });
    }
    if (e === 'ods') return Object.assign(IO.importODS(bytes), { kind: 'ods' });
    return Object.assign(IO.importCSV(bytes, { name }), { kind: e === 'tsv' ? 'tsv' : 'csv' });
  };

  const MIME = { xcs: 'application/x-craft-sheet', csv: 'text/csv', tsv: 'text/tab-separated-values', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet', html: 'text/html' };
  XA.exportAs = (fmt) => {
    const wb = XA.wb, s = XA.s;
    if (fmt === 'xcs') { const r = F.toBinary(wb); return { bytes: r.bytes, loss: r.loss || [] }; }
    if (fmt === 'csv') return IO.exportCSV(wb, s, { delimiter: ',' });
    if (fmt === 'tsv') return IO.exportCSV(wb, s, { delimiter: '\t' });
    if (fmt === 'xlsx') return IO.exportXLSX(wb);
    if (fmt === 'ods') return IO.exportODS(wb);
    if (fmt === 'html') return IO.exportHTML(wb, s);
    throw new Error('unknown format ' + fmt);
  };
  XA.download = (bytes, name, mime) => {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  XA.save = (fmt) => {
    const r = XA.exportAs(fmt), base = XA.name.replace(/\.[^.]*$/, '') || 'sheet';
    XA.download(r.bytes, base + '.' + fmt, MIME[fmt]);
    LS.set('xcc.fmt', fmt);
    if (fmt === 'xcs') { XA.dirty = false; XA.remember(); }
    return r;
  };

  // ---------- history (recent spreadsheets, last save format, undo) ----------
  XA.remember = () => {
    try {
      const json = JSON.stringify(F.toJSON(XA.wb));
      if (json.length > 400000) return;
      const rec = LS.get('xcc.recent', []).filter((x) => x.name !== XA.name);
      rec.unshift({ name: XA.name, t: Date.now(), json }); LS.set('xcc.recent', rec.slice(0, 8));
    } catch (e) { /* storage full or unserialisable: recent list is optional */ }
  };
  // History only: recent spreadsheets, last-used save format, undo/redo. Open documents, fonts and settings stay.
  XA.clearHistory = () => {
    LS.set('xcc.recent', []); try { localStorage.removeItem('xcc.fmt'); } catch (e) { /* storage unavailable */ }
    XA.undo = []; XA.redo = []; XA.clip = null;
    XA.emit('history'); XA.emit('recent'); XA.toast('History cleared');
  };

  XA.lossRows = (loss) => loss.filter((l) => l.severity !== 'info');
  XA.lossHtml = (loss) => { const l = XA.lossRows(loss); return l.length ? '<ul class="rep">' + l.map((x) => '<li><b>' + esc(x.code) + '</b>' + (x.count > 1 ? ' x' + x.count : '') + ': ' + esc(x.detail) + '</li>').join('') + '</ul>' : '<ul class="rep none"><li>Nothing lost.</li></ul>'; };
})();
