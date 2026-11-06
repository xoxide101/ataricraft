// xCCalc boot: wires toolbar, tabs, files, dialogs, context menu, clipboard, fonts, help.
(function () {
  'use strict';
  const XA = window.XA, C = XA.C, $ = XA.$, G = XA.grid, V = XA.views, LS = XA.LS;
  const show = (s) => { document.body.classList.remove('s-home', 's-editor', 's-help'); document.body.classList.add('s-' + s); if (s === 'editor') { G.relayout(); V.refresh(); setTimeout(() => G.focus(), 0); } };
  XA.show = show;

  function open(wb, name, loss) {
    XA.setBook(wb, name, { loss }); show('editor');
    const rows = XA.lossRows(loss || []);
    if (rows.length) XA.dialog('<h3>Opened with changes</h3><p>Some things in this file are not supported by xCCalc:</p>' + XA.lossHtml(loss) + '<div class="acts"><button class="p" id="dok">OK</button></div>', (d) => { d.querySelector('#dok').onclick = XA.closeDialog; });
  }
  async function openFiles(files) {
    for (const f of files) {
      try {
        const r = XA.importFile(new Uint8Array(await f.arrayBuffer()), f.name);
        open(r.wb, /\.(csv|tsv|xlsx|ods|xcs)$/i.test(f.name) ? f.name : f.name + '.xcs', r.loss);
      } catch (e) { XA.toast('Could not open ' + f.name + ': ' + e.message); }
      break;
    }
  }
  XA.openFiles = openFiles;
  const pick = () => { const fi = $('filein'); fi.value = ''; fi.click(); };
  $('filein').onchange = (e) => openFiles([...e.target.files]);
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) openFiles([...e.dataTransfer.files]); });

  function saveDialog() {
    const last = LS.get('xcc.fmt', 'xcs');
    const opts = [['xcs', 'xCCalc (.xcs)'], ['xlsx', 'Excel (.xlsx)'], ['ods', 'OpenDocument (.ods)'], ['csv', 'CSV, this sheet'], ['tsv', 'TSV, this sheet'], ['html', 'HTML page']];
    XA.dialog('<h3>Save as</h3><label>Format <select id="sfmt">' + opts.map((o) => '<option value="' + o[0] + '"' + (o[0] === last ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><div id="sloss"></div><div class="acts"><button class="p" id="sgo">Save</button><button id="scancel">Cancel</button></div>', (d) => {
      const upd = () => { try { d.querySelector('#sloss').innerHTML = XA.lossHtml(XA.exportAs(d.querySelector('#sfmt').value).loss || []); } catch (e) { d.querySelector('#sloss').innerHTML = '<ul class="rep"><li>' + XA.esc(e.message) + '</li></ul>'; } };
      d.querySelector('#sfmt').onchange = upd; upd();
      d.querySelector('#scancel').onclick = XA.closeDialog;
      d.querySelector('#sgo').onclick = () => { try { XA.save(d.querySelector('#sfmt').value); XA.closeDialog(); XA.toast('Saved'); } catch (e) { XA.toast(e.message); } };
    });
  }
  XA.on('savekey', saveDialog); XA.on('openkey', pick);
  $('bopen').onclick = $('hopen').onclick = pick; $('bsave').onclick = saveDialog;
  $('hnew').onclick = () => { XA.newBook(); show('editor'); };
  $('hdemo').onclick = () => { open(XA.demo(), 'Budget demo.xcs', []); document.body.classList.add('charts'); V.refresh(); };
  $('bhome').onclick = () => { XA.remember(); drawRecent(); show('home'); };
  $('logo').onclick = () => { XA.wb ? $('bhome').click() : show('home'); };
  const help = () => show('help');
  $('bhelp').onclick = $('hhelp').onclick = help;
  $('helpdoc').innerHTML = '<h2>xCCalc help</h2><p>A spreadsheet for Craft. Files are .xcs (the format ACCalc opens on the Atari), and it also reads and writes CSV, TSV, XLSX and ODS, and exports HTML.</p>' +
    '<h3>Editing</h3><p>Type to replace a cell, F2 or double-click to edit. Enter moves down, Tab moves right. Formulas start with =. Ctrl+D / Ctrl+R fill down / right. Ctrl+Z / Ctrl+Y undo and redo. Paste tab-separated text from Excel directly into the grid.</p>' +
    '<h3>Atari view</h3><p>Shows the sheet at 320x192 with 64 columns of 5-pixel characters, and lists what would not fit in ACCalc: size, sheet count, functions and rows. Arrow keys move the cursor.</p>' +
    '<h3>Numbers</h3><p>IEEE doubles by default. Atari BCD mode rounds like the Atari 6-byte numbers (10 digits, 1E-99 to 9.99999999E+97).</p>' +
    '<h3>Charts</h3><p>Select a range with labels and values, press Chart. Bar, line and pie are drawn in 1 bit; PNG exports at 960x576.</p>' +
    '<div class="acts"><button class="p" id="hback">Back</button></div>';
  $('hback').onclick = () => show(XA.wb ? 'editor' : 'home');

  // ----- recent -----
  function drawRecent() {
    const rec = LS.get('xcc.recent', []), el = $('recent');
    el.innerHTML = rec.length ? '<h4>Recent</h4>' + rec.map((r, i) => '<div class="rec" data-i="' + i + '">' + XA.esc(r.name) + ' <span class="muted">' + new Date(r.t).toLocaleString() + '</span></div>').join('') : '';
    el.querySelectorAll('.rec').forEach((d) => { d.onclick = () => { const r = rec[+d.dataset.i]; try { open(XA.F.fromJSON(r.json), r.name, []); } catch (e) { XA.toast('Could not restore: ' + e.message); } }; });
  }
  XA.on('recent', drawRecent); drawRecent();
  addEventListener('beforeunload', (e) => { if (XA.dirty) { XA.remember(); e.preventDefault(); e.returnValue = ''; } });

  // ----- modes -----
  const setMode = (m) => { document.body.classList.toggle('m-atari', m === 'atari'); document.body.classList.toggle('m-sheet', m !== 'atari'); $('msh').classList.toggle('on', m !== 'atari'); $('mat').classList.toggle('on', m === 'atari'); if (m === 'atari') { V.drawAtari(); } else { G.relayout(); G.focus(); } };
  $('msh').onclick = () => setMode('sheet'); $('mat').onclick = () => setMode('atari');
  $('tb-chart').onclick = () => V.addChart('bar');
  $('tb-charts').onclick = () => { document.body.classList.toggle('charts'); V.refresh(); G.relayout(); };

  // ----- toolbar -----
  const btn = (id, fn) => { $(id).onmousedown = (e) => e.preventDefault(); $(id).onclick = fn; };
  btn('tb-b', () => XA.setStyle(1, 'toggle')); btn('tb-i', () => XA.setStyle(2, 'toggle')); btn('tb-u', () => XA.setStyle(4, 'toggle'));
  btn('tb-al', () => XA.setAlign(1)); btn('tb-ac', () => XA.setAlign(2)); btn('tb-ar', () => XA.setAlign(3)); btn('tb-aa', () => XA.setAlign(0));
  btn('tb-undo', XA.doUndo); btn('tb-redo', XA.doRedo); btn('tb-fd', () => XA.fill('down')); btn('tb-fr', () => XA.fill('right'));
  const nf = $('numfmt'); nf.innerHTML = C.FORMATS.map((f) => '<option>' + XA.esc(f) + '</option>').join('') + '<option value="__custom">Custom...</option>';
  nf.onchange = () => {
    let v = nf.value;
    if (v === '__custom') { v = prompt('Number format code', '0.00') || ''; if (!v) return syncFmt(); }
    XA.setFormat(v); G.focus();
  };
  function syncFmt() { const c = XA.wb && XA.wb.cell(XA.s, XA.sel.r, XA.sel.c), f = (c && c.fmt) || 'General'; if (![...nf.options].some((o) => o.value === f)) { nf.insertBefore(new Option(f, f), nf.lastChild); } nf.value = f; }
  $('nummode').onchange = (e) => { XA.setMode(e.target.value); };
  $('sizesel').innerHTML = [10, 11, 12, 13, 14, 16, 18, 20].map((n) => '<option' + (n === 13 ? ' selected' : '') + '>' + n + '</option>').join('');
  $('sizesel').onchange = (e) => { G.setFont(null, +e.target.value); };
  const fs = $('fontsel');
  const sysFonts = [['System', "system-ui,'Segoe UI',sans-serif"], ['Serif', "Georgia,'Times New Roman',serif"], ['Mono', "Consolas,'Courier New',monospace"], ['Arial', 'Arial,sans-serif']];
  fs.innerHTML = sysFonts.map((f, i) => '<option value="s' + i + '">' + f[0] + '</option>').join('');
  fs.onchange = () => {
    const v = fs.value;
    if (v[0] === 's') G.setFont(sysFonts[+v.slice(1)][1]);
    else { try { const f = window.XFACE.hqFont(v.slice(1)); G.setFont(f && f.css ? f.css : "'" + v.slice(1) + "'"); } catch (e) { XA.toast('Font failed'); } }
  };
  try { // Craft faces (guarded: the writer's face loader is shared and may fail)
    if (window.XFACE && XFACE.init) Promise.resolve(XFACE.init()).then(() => {
      const l = (XFACE.list && XFACE.list()) || [];
      for (const f of l) { const n = typeof f === 'string' ? f : f.name || f.id; if (n) fs.add(new Option('Craft: ' + n, 'f' + n)); }
    }).catch(() => {});
  } catch (e) { /* optional */ }

  // ----- status + formula bar -----
  function status() {
    if (!XA.wb) return;
    const q = XA.rect(), wb = XA.wb, s = XA.s; let sum = 0, n = 0, cnt = 0;
    if ((q.r2 - q.r1 + 1) * (q.c2 - q.c1 + 1) <= 200000) { const b = wb.bounds(s); for (let r = q.r1; r <= Math.min(q.r2, b.rows); r++) for (let c = q.c1; c <= Math.min(q.c2, b.cols); c++) { const x = wb.cell(s, r, c); if (x && x.val !== null && x.val !== undefined) { cnt++; if (typeof x.val === 'number') { sum += x.val; n++; } } } }
    $('st-sel').textContent = XA.rangeText(q);
    $('st-sum').textContent = n ? 'Sum ' + +sum.toPrecision(12) + '   Avg ' + +(sum / n).toPrecision(10) + '   Count ' + cnt : cnt ? 'Count ' + cnt : '';
    $('st-mode').textContent = wb.mode === 'bcd' ? 'Atari BCD' : 'IEEE';
  }
  XA.on('select', () => { if (!XA.wb) return; if (!G.editing) { $('namebox').value = XA.addr(XA.sel.r, XA.sel.c); $('fbar').value = XA.wb.editText(XA.s, XA.sel.r, XA.sel.c); } syncFmt(); status(); });
  XA.on('change', () => { status(); if (XA.wb && !G.editing) $('fbar').value = XA.wb.editText(XA.s, XA.sel.r, XA.sel.c); syncFmt(); $('docname').textContent = XA.name + (XA.dirty ? ' *' : ''); });
  XA.on('book', () => { $('docname').textContent = XA.name; $('nummode').value = XA.wb.mode; });
  XA.on('mode', () => { if (XA.wb) $('nummode').value = XA.wb.mode; });
  XA.on('history', () => { $('tb-undo').disabled = !XA.undo.length; $('tb-redo').disabled = !XA.redo.length; });
  $('fbar').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (XA.commit(XA.sel.r, XA.sel.c, $('fbar').value)) { G.move(1, 0, false); G.focus(); } }
    else if (e.key === 'Escape') { $('fbar').value = XA.wb.editText(XA.s, XA.sel.r, XA.sel.c); G.focus(); }
  };
  $('fbar').onfocus = () => { if (G.editing) return; };
  $('fbar').oninput = () => { if (G.editing) $('ced').value = $('fbar').value; };
  $('namebox').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const t = $('namebox').value.trim(); let rg = C.parseRange(t);
    if (!rg && XA.wb.names) { const nm = XA.wb.names instanceof Map ? XA.wb.names.get(t.toUpperCase()) || XA.wb.names.get(t) : XA.wb.names[t] || XA.wb.names[t.toUpperCase()]; const ref = nm && (nm.ref || nm.range || (typeof nm === 'string' ? nm : '')); if (ref) rg = C.parseRange(String(ref).replace(/^.*!/, '')); }
    if (rg) { XA.select(rg.r1, rg.c1, rg.r2, rg.c2); G.reveal(rg.r1, rg.c1); G.focus(); } else XA.toast('Unknown reference');
  };

  // ----- tabs -----
  function tabs() {
    if (!XA.wb) return;
    const el = $('tabs'); el.innerHTML = '';
    XA.wb.sheets.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'tab' + (i === XA.s ? ' on' : ''); d.textContent = s.name || 'Sheet' + (i + 1);
      d.onclick = () => { XA.gotoSheet(i); G.focus(); };
      d.ondblclick = () => { const n = prompt('Sheet name', s.name); if (n) XA.renameSheet(i, n); };
      el.appendChild(d);
    });
  }
  XA.on('sheets', tabs); XA.on('book', tabs);
  $('tabadd').onclick = () => { if (XA.wb) XA.addSheet(); };

  // ----- clipboard -----
  document.addEventListener('copy', (e) => { if (!document.body.classList.contains('s-editor') || G.editing || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && document.activeElement !== $('gcanvas')) return; const t = XA.copyText(false); if (t != null) { e.clipboardData.setData('text/plain', t); e.preventDefault(); XA.toast('Copied'); } });
  document.addEventListener('cut', (e) => { if (!document.body.classList.contains('s-editor') || G.editing || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && document.activeElement !== $('gcanvas')) return; const t = XA.copyText(true); if (t != null) { e.clipboardData.setData('text/plain', t); e.preventDefault(); } });
  document.addEventListener('paste', (e) => { if (!document.body.classList.contains('s-editor') || G.editing || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && document.activeElement !== $('gcanvas')) return; const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); XA.pasteText(t); } });

  // ----- context menu (same pattern as xCWriter, with Clear history) -----
  const ctx = $('ctx');
  XA.showCtx = (e, items) => {
    ctx.innerHTML = '';
    for (const it of items) {
      if (it === '-') { ctx.appendChild(document.createElement('hr')); continue; }
      const d = document.createElement('div'); d.textContent = it.label;
      if (it.off) d.className = 'dis'; else d.onclick = () => { ctx.style.display = 'none'; it.run(); };
      ctx.appendChild(d);
    }
    ctx.style.display = 'block';
    ctx.style.left = Math.min(e.clientX, innerWidth - ctx.offsetWidth - 4) + 'px'; ctx.style.top = Math.min(e.clientY, innerHeight - ctx.offsetHeight - 4) + 'px';
  };
  XA.on('context', (e) => {
    const copy = (cut) => { const t = XA.copyText(cut); if (t != null && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); };
    XA.showCtx(e, [
      { label: 'Cut', run: () => copy(true) }, { label: 'Copy', run: () => copy(false) },
      { label: 'Paste', run: async () => { try { XA.pasteText(await navigator.clipboard.readText()); } catch (x) { if (XA.clip) XA.pasteText(XA.clip.text); else XA.toast('Use Ctrl+V to paste'); } } },
      { label: 'Clear contents', run: () => XA.clearRange(false) }, { label: 'Clear contents and format', run: () => XA.clearRange(true) }, '-',
      { label: 'Fill down', run: () => XA.fill('down') }, { label: 'Fill right', run: () => XA.fill('right') }, '-',
      { label: 'Bold', run: () => XA.setStyle(1, 'toggle') }, { label: 'Italic', run: () => XA.setStyle(2, 'toggle') }, '-',
      { label: 'Insert bar chart', run: () => V.addChart('bar') }, { label: 'Insert line chart', run: () => V.addChart('line') }, { label: 'Insert pie chart', run: () => V.addChart('pie') }, '-',
      { label: 'Clear undo history', run: () => { XA.undo = []; XA.redo = []; XA.emit('history'); XA.toast('Undo history cleared'); } },
      { label: 'Clear history', run: () => XA.clearHistory() },
    ]);
  });
  addEventListener('mousedown', (e) => { if (!ctx.contains(e.target)) ctx.style.display = 'none'; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { ctx.style.display = 'none'; if ($('modal').classList.contains('on')) XA.closeDialog(); } });

  G.init();
  XA.newBook(); XA.wb.charts = XA.wb.charts || [];
  XA.dirty = false; show('home');
  window.XCC_READY = true;
})();
