// xCBase boot: screens, toolbar, tabs, context menu, drag and drop, shortcuts.
(function () {
  'use strict';
  const XA = window.XA, $ = XA.$, G = XA.grid, V = XA.views, esc = XA.esc;
  const ctx = $('ctx');
  let mode = 'grid';

  const show = (s) => {
    document.body.classList.remove('s-home', 's-editor', 's-help'); document.body.classList.add('s-' + s);
    if (s === 'editor') { setMode(mode); setTimeout(() => G.paint(), 0); }
    if (s === 'home') drawRecent();
  };
  const setMode = (m) => {
    mode = m;
    for (const k of ['grid', 'form', 'query', 'atari']) { document.body.classList.toggle('m-' + k, k === m); }
    for (const [id, k] of [['mgrid', 'grid'], ['mform', 'form'], ['mquery', 'query'], ['mat', 'atari']]) $(id).classList.toggle('on', k === m);
    if (m === 'grid') { G.rebuild(); } else if (m === 'form') V.renderForm(); else if (m === 'atari') V.drawAtari();
    $('st-mode').textContent = { grid: 'Grid', form: 'Form', query: 'Query', atari: 'Atari view' }[m];
  };
  const refresh = () => {
    if (!XA.db) return;
    $('docname').textContent = XA.name + (XA.dirty ? ' *' : '');
    $('tabs').innerHTML = XA.db.tables.map((t) => `<div class="tab${t.name === XA.tname ? ' on' : ''}" data-t="${esc(t.name)}">${esc(t.name)}</div>`).join('');
    const t = XA.tname ? XA.table() : null;
    $('sortsel').innerHTML = '<option value="">(record order)</option>' + (t ? t.fields.map((f) => `<option value="${esc(f.name)}"${XA.sort && XA.sort.field.toLowerCase() === f.name.toLowerCase() ? ' selected' : ''}>${esc(f.name)}</option>`).join('') : '');
    $('tb-undo').disabled = !XA.undo.length; $('tb-redo').disabled = !XA.redo.length;
    $('tb-undo').title = XA.undo.length ? 'Undo ' + XA.undo[XA.undo.length - 1].label : 'Undo (Ctrl+Z)';
    if (document.activeElement !== $('filter')) $('filter').value = XA.filter || '';
    const n = t ? XA.positions().length : 0;
    $('st-cnt').textContent = t ? n + (t.rows.length !== n ? ' of ' + t.rows.length : '') + ' records' + (XA.filterError ? ' - filter: ' + XA.filterError : '') : '';
    $('st-sel').textContent = t && n ? 'Record ' + (XA.cur.row + 1) + (XA.cur.col < t.fields.length && mode === 'grid' ? ', ' + t.fields[XA.cur.col].name : '') : '';
    if (mode === 'form') V.renderForm(); else if (mode === 'atari') V.drawAtari();
  };
  for (const ev of ['db', 'table', 'view', 'change', 'select', 'history']) XA.on(ev, refresh);
  XA.on('db', () => { if (document.body.classList.contains('s-home')) show('editor'); });

  function drawRecent() {
    const r = XA.LS.get('xcb.recent', []);
    $('recent').innerHTML = r.length ? '<h3>Recent</h3>' + r.map((x, i) => `<div class="rec" data-i="${i}">${esc(x.name)} <span class="muted">${x.tables || ''}</span></div>`).join('') : '<p class="muted">No recent databases.</p>';
  }
  $('recent').onclick = (e) => { const d = e.target.closest('[data-i]'); if (d) { try { XA.openRecent(+d.dataset.i); } catch (x) { XA.err(x); } } };
  XA.on('recent', drawRecent);

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
  const histItems = () => ['-', { label: 'Clear undo history', off: !XA.undo.length && !XA.redo.length, run: () => { XA.undo = []; XA.redo = []; XA.emit('history'); XA.toast('Undo history cleared'); } }, { label: 'Clear history', run: () => XA.clearHistory() }];
  XA.on('context', (e) => {
    const has = XA.db && XA.tname && XA.positions().length;
    XA.showCtx(e, [{ label: 'Add record', run: () => XA.addRecord() }, { label: 'Delete record', off: !has, run: () => XA.deleteRecord(XA.positions()[XA.cur.row]) }, { label: 'Edit cell', off: !has, run: () => G.edit() }, { label: 'Open in Form view', off: !has, run: () => setMode('form') }].concat(histItems()));
  });
  addEventListener('contextmenu', (e) => { if (!e.target.closest('#gsizer')) { if (e.target.closest('#editor,#home')) { e.preventDefault(); XA.showCtx(e, histItems().slice(1)); } } });
  addEventListener('click', (e) => { if (!e.target.closest('#ctx')) ctx.style.display = 'none'; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { ctx.style.display = 'none'; if ($('modal').classList.contains('on')) XA.closeDialog(); } });

  const need = (fn) => () => { if (!XA.db || !XA.tname) { XA.toast('Open or create a database first'); return; } try { fn(); } catch (e) { XA.err(e); } };
  const pick = (add) => { $('filein').dataset.add = add ? '1' : ''; $('filein').value = ''; $('filein').click(); };
  $('filein').onchange = async (e) => { const l = [...e.target.files]; if (l.length) { await XA.openFiles(l, !!e.target.dataset.add && !!XA.db); show('editor'); } };
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', async (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { await XA.openFiles([...e.dataTransfer.files], false); show('editor'); } });

  $('logo').onclick = $('bhome').onclick = () => show('home');
  $('bhelp').onclick = $('hhelp').onclick = () => { $('helpdoc').innerHTML = V.helpHtml(); show('help'); };
  $('hnew').onclick = () => { XA.newDb(); show('editor'); };
  $('hopen').onclick = $('bopen').onclick = () => pick(false);
  $('hdemo').onclick = () => { V.demo(); show('editor'); };
  $('bsave').onclick = need(() => { const r = XA.save('xcd'); const l = XA.lossRows(r.loss); if (l.length) XA.dialog('<h3>Saved with notes</h3>' + XA.lossHtml(r.loss) + '<div class="row"><button id="dok" class="on">OK</button></div>', (d) => { d.querySelector('#dok').onclick = XA.closeDialog; }); else XA.toast('Saved ' + r.files[0].name); });
  $('mgrid').onclick = () => setMode('grid'); $('mform').onclick = need(() => setMode('form')); $('mquery').onclick = () => setMode('query'); $('mat').onclick = need(() => setMode('atari'));
  $('tb-add').onclick = need(() => XA.addRecord());
  $('tb-del').onclick = need(() => { const p = XA.positions(); if (p.length) XA.deleteRecord(p[XA.cur.row]); });
  $('tb-undo').onclick = () => XA.doUndo(); $('tb-redo').onclick = () => XA.doRedo();
  $('filter').oninput = () => XA.setFilter($('filter').value);
  $('sortsel').onchange = () => XA.setSort($('sortsel').value || null, false);
  $('tb-fields').onclick = need(V.design); $('tb-import').onclick = () => pick(true); $('tb-export').onclick = need(V.exportDlg);
  $('tb-report').onclick = need(V.reportDlg); $('tb-merge').onclick = need(V.mergeDlg); $('tb-sql').onclick = need(V.gateDlg);
  $('tabadd').onclick = need(V.newTable);
  $('tabs').onclick = (e) => { const d = e.target.closest('[data-t]'); if (d) XA.useTable(d.dataset.t); };
  $('qrun').onclick = need(V.runQuery); $('qtotable').onclick = need(V.keepResult);
  $('qsql').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); V.runQuery(); } });
  const q = XA.LS.get('xcb.sql', null); if (q) { $('qsql').value = q.sql || ''; $('qparams').value = q.params || ''; }
  $('qsql').placeholder = $('qsql').placeholder;

  addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('s-editor') || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase(), typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if (k === 's') { e.preventDefault(); $('bsave').onclick(); }
    else if (!typing && k === 'z') { e.preventDefault(); e.shiftKey ? XA.doRedo() : XA.doUndo(); } else if (!typing && k === 'y') { e.preventDefault(); XA.doRedo(); }
  });
  addEventListener('beforeunload', (e) => { if (XA.dirty) { e.preventDefault(); e.returnValue = ''; } });

  G.init(); V.wireForm(); show('home'); drawRecent();
  window.XCB_READY = true;
})();
