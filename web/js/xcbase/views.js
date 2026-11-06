// xCBase views: form view, query box, Atari view, and the dialogs (design, import/export, report, mail merge, SQL gateway).
(function () {
  'use strict';
  const XA = window.XA, $ = XA.$, D = XA.D, F = XA.F, esc = XA.esc;
  const V = XA.views = {};
  const font = (window.XCB_DATA && window.XCB_DATA.font4) || [];
  const okBtn = (d) => { const b = d.querySelector('#dok'); if (b) b.onclick = XA.closeDialog; };
  const note = (title, html) => XA.dialog('<h3>' + esc(title) + '</h3>' + html + '<div class="row"><button id="dok" class="on">OK</button></div>', okBtn);
  const TYPES = ['text', 'int', 'num', 'date', 'bool', 'memo'];

  // ---------- demo ----------
  V.demo = () => {
    const db = new D.Database('demo');
    const c = db.createTable('customers', [{ name: 'id', type: 'int' }, { name: 'name', type: 'text', len: 20 }, { name: 'city', type: 'text', len: 12 }, { name: 'since', type: 'date' }, { name: 'vip', type: 'bool' }, { name: 'balance', type: 'num' }, { name: 'notes', type: 'memo' }]);
    [['Ada Lovelace', 'London', '1999-05-01', true, 1250.5, 'Prefers letters.\nSecond line of notes.'], ['Bob Stone', 'Paris', '2001-02-28', false, 80], ['Carol King', 'London', '2003-07-14', true, 4300.25], ['Dan O\'Neil', 'Rome', '2010-12-31', false, 0], ['Eve Adams', 'Berlin', '2012-03-09', true, 920.1], ['Frank Moore', 'Paris', '2015-09-30', false, 15.75], ['Grace Hall', 'Madrid', '2018-01-02', true, 610], ['Hank Gray', 'London', '2019-11-11', false, 33.3], ['Iris West', 'Rome', '2020-06-21', true, 2750], ['Jack Fox', 'Berlin', '2022-04-04', false, 5]]
      .forEach((r, i) => c.insert({ id: i + 1, name: r[0], city: r[1], since: r[2], vip: r[3], balance: r[4], notes: r[5] || null }));
    c.createIndex({ name: 'byname', fields: ['name'] }); c.createIndex({ name: 'bycity', fields: ['city', 'name'] });
    const o = db.createTable('orders', [{ name: 'oid', type: 'int' }, { name: 'cust', type: 'int' }, { name: 'item', type: 'text', len: 12 }, { name: 'amount', type: 'num' }, { name: 'odate', type: 'date' }]);
    [[1, 'pen', 12.5], [1, 'ink', 7.25], [2, 'desk', 100], [3, 'lamp', 45], [3, 'chair', 89.9], [3, 'pen', 12.5], [5, 'cable', 9.99], [7, 'disk', 19], [9, 'monitor', 240], [9, 'mouse', 25], [10, 'tape', 4.5], [4, 'clip', 0.1]]
      .forEach((r, i) => o.insert({ oid: 100 + i, cust: r[0], item: r[1], amount: r[2], odate: '2023-0' + (1 + (i % 9)) + '-1' + (i % 9) }));
    o.createIndex({ name: 'bycust', fields: ['cust'] });
    db.forms.push(D.defaultForm(c)); db.forms[0].title = 'Customer card';
    db.reports.push({ name: 'bycity', table: 'customers', title: 'Customers by city', groupBy: 'city', orderBy: ['name'], columns: [{ field: 'name', label: 'Name' }, { field: 'since', label: 'Since' }, { field: 'balance', label: 'Balance', sum: true }] });
    XA.setDb(db, 'demo.xcd'); XA.useTable('customers');
  };

  // ---------- form view ----------
  V.formFor = (t) => XA.db.forms.find((f) => f.table.toLowerCase() === t.name.toLowerCase()) || D.defaultForm(t);
  V.renderForm = () => {
    const el = $('formcard'); if (!XA.db || !XA.tname) { el.innerHTML = ''; return; }
    const t = XA.table(), pos = XA.positions(), n = pos.length, form = V.formFor(t), i = pos[XA.cur.row];
    let h = `<h3>${esc(form.title || t.name)} <span class="muted">${n ? 'record ' + (XA.cur.row + 1) + ' of ' + n + (n !== t.rows.length ? ' (filtered from ' + t.rows.length + ')' : '') : 'no records'}</span></h3>`;
    if (n) {
      const rec = t.rows[i];
      for (const ff of form.fields) {
        const c = t.col(ff.field), f = t.fields[c], v = rec[c];
        const txt = v === null || v === undefined ? '' : f.type === 'bool' ? (v ? 'yes' : 'no') : f.type === 'num' ? String(v) : D.fmtValue(v, f.type, f);
        h += `<div class="frow"><label for="ff${c}">${esc(ff.label || f.name)}</label>`;
        if (f.type === 'memo') h += `<textarea id="ff${c}" data-f="${esc(f.name)}" rows="4">${esc(v || '')}</textarea>`;
        else if (f.type === 'bool') h += `<select id="ff${c}" data-f="${esc(f.name)}"><option value="">(none)</option><option${v === true ? ' selected' : ''} value="yes">yes</option><option${v === false ? ' selected' : ''} value="no">no</option></select>`;
        else h += `<input type="text" id="ff${c}" data-f="${esc(f.name)}" value="${esc(txt)}"${f.type === 'text' ? ` maxlength="${f.len}"` : ''} spellcheck="false">`;
        h += `<span class="ty">${f.type}${f.type === 'text' ? ' ' + f.len : ''}</span></div>`;
      }
    } else h += '<p class="muted">This table has no records (or none match the filter).</p>';
    h += `<div class="fnav"><button data-nav="first">|&lt;</button><button data-nav="prev">&lt; Prev</button><button data-nav="next">Next &gt;</button><button data-nav="last">&gt;|</button><button data-nav="new">+ New record</button><button data-nav="del"${n ? '' : ' disabled'}>Delete</button></div>`;
    el.innerHTML = h;
  };
  V.wireForm = () => {
    const el = $('formcard');
    el.addEventListener('change', (e) => {
      const f = e.target.dataset && e.target.dataset.f; if (!f) return;
      try { XA.setCell(XA.positions()[XA.cur.row], f, e.target.value); } catch (x) { XA.toast(f + ': ' + x.message); }
      V.renderForm();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]'); if (!b) return; const n = XA.positions().length, a = b.dataset.nav;
      if (a === 'first') XA.cur.row = 0; else if (a === 'last') XA.cur.row = Math.max(0, n - 1); else if (a === 'next') XA.cur.row = Math.min(n - 1, XA.cur.row + 1); else if (a === 'prev') XA.cur.row = Math.max(0, XA.cur.row - 1);
      else if (a === 'new') { try { XA.addRecord(); } catch (x) { XA.err(x); } } else if (a === 'del') XA.deleteRecord(XA.positions()[XA.cur.row]);
      XA.emit('select'); V.renderForm();
    });
  };

  // ---------- query view ----------
  let lastRes = null;
  V.runQuery = () => {
    const sql = $('qsql').value, out = $('qout'), info = $('qinfo'); let params = [];
    XA.LS.set('xcb.sql', { sql, params: $('qparams').value });
    const ps = $('qparams').value.trim();
    if (ps) { try { params = JSON.parse(ps); if (!Array.isArray(params)) throw 0; } catch (e) { info.textContent = 'The ? values must be a JSON array, for example ["London", 5]'; return; } }
    try {
      const t0 = performance.now(), r = XA.db.query(sql, params); lastRes = r;
      info.textContent = r.rows.length + ' row' + (r.rows.length === 1 ? '' : 's') + ' - plan: ' + (r.plan || 'scan') + ' - ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms';
      const cap = 500;
      out.innerHTML = '<table><thead><tr>' + r.columns.map((c) => '<th>' + esc(c.name) + '</th>').join('') + '</tr></thead><tbody>' +
        r.rows.slice(0, cap).map((row) => '<tr>' + row.map((v, i) => `<td style="text-align:${r.columns[i].type === 'int' || r.columns[i].type === 'num' ? 'right' : 'left'}">${esc(v === null || v === undefined ? '' : D.fmtValue(v, r.columns[i].type, r.columns[i]))}</td>`).join('') + '</tr>').join('') + '</tbody></table>' + (r.rows.length > cap ? `<p class="muted" style="padding:6px">Showing the first ${cap} rows.</p>` : '');
    } catch (e) { lastRes = null; out.innerHTML = ''; info.textContent = 'Error: ' + e.message; }
  };
  V.resultToTable = (res, name) => {
    const fields = res.columns.map((c, i) => {
      let n = String(c.name).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'c' + (i + 1); if (/^[0-9]/.test(n)) n = 'c' + n.slice(0, 9);
      return { name: n, type: c.type === 'int' || c.type === 'num' || c.type === 'date' || c.type === 'bool' || c.type === 'memo' ? c.type : 'text', len: Math.min(255, Math.max(1, ...res.rows.map((r) => (r[i] === null || r[i] === undefined ? 0 : String(r[i]).length)))) };
    });
    const seen = new Set(); fields.forEach((f, i) => { let k = 1, b = f.name; while (seen.has(f.name.toLowerCase())) { const s = String(++k); f.name = b.slice(0, 10 - s.length) + s; } seen.add(f.name.toLowerCase()); });
    return fields.map((f) => (f.type === 'text' ? f : { name: f.name, type: f.type }));
  };
  V.keepResult = () => {
    if (!lastRes) { XA.toast('Run a query first'); return; }
    const res = lastRes;
    try {
      const name = XA.uniqueName('result');
      XA.schema('query to table', () => { const t = XA.db.createTable(name, V.resultToTable(res)); for (const r of res.rows) t.insert(r.map((v) => v)); XA.tname = name; });
      XA.toast('Created table ' + name);
    } catch (e) { XA.err(e); }
  };

  // ---------- Atari view ----------
  const FB_W = 320, FB_H = 192, COLS = 64, LINES = 24;
  const sizeOf = (f) => (f.type === 'text' ? f.len : f.type === 'int' ? 4 : f.type === 'num' ? 6 : f.type === 'date' ? 4 : f.type === 'bool' ? 1 : 2);
  V.layout = (t) => { let off = 1 + Math.ceil(t.fields.length / 8); return t.fields.map((f) => { const r = { name: f.name, type: f.type, off, size: sizeOf(f) }; off += r.size; return r; }); };
  V.atariWidth = (f) => (f.type === 'text' ? Math.min(f.len, 18) : f.type === 'int' ? 8 : f.type === 'num' ? 11 : f.type === 'date' ? 10 : f.type === 'bool' ? 3 : 12);
  V.drawAtari = () => {
    if (!XA.db || !XA.tname) return;
    const cv = $('atcanvas'), px = new Uint8Array(FB_W * FB_H);
    const glyph = (ch, x, y, inv) => { let code = ch.charCodeAt(0); if (code < 32 || code > 127) code = 63; const g = font[code - 32] || []; for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) { const on = j < 7 && i < 4 ? (g[j] >> (3 - i)) & 1 : 0; if (x + i < FB_W && y + j < FB_H) px[(y + j) * FB_W + x + i] = inv ? 1 - on : on; } };
    const line = (n, s, inv) => { s = String(s).padEnd(COLS).slice(0, COLS); for (let i = 0; i < COLS; i++) glyph(s[i], i * 5, n * 8, inv); };
    const t = XA.table(), pos = XA.positions(), widths = t.fields.map(V.atariWidth);
    line(0, ` ${t.name.toUpperCase()}  ${pos.length ? XA.cur.row + 1 : 0}/${pos.length}`, true);
    let used = 0, shown = 0; while (shown < t.fields.length && used + widths[shown] + 1 <= COLS - 1) { used += widths[shown] + 1; shown++; }
    const cut = (f, v, w) => { let s = v === null || v === undefined ? '' : f.type === 'memo' ? String(v).split(/\r?\n/)[0] : f.type === 'bool' ? (v ? 'Y' : 'N') : D.fmtValue(v, f.type, f); s = s.slice(0, w); return f.type === 'int' || f.type === 'num' ? s.padStart(w) : s.padEnd(w); };
    line(1, t.fields.slice(0, shown).map((f, i) => f.name.slice(0, widths[i]).padEnd(widths[i])).join(' ') + (shown < t.fields.length ? '>' : ''));
    for (let x = 0; x < FB_W; x++) px[(2 * 8 + 6) * FB_W + x] = 1;
    const rowsFit = LINES - 4, firstRow = Math.max(0, Math.min(XA.cur.row - (rowsFit >> 1), pos.length - rowsFit));
    for (let k = 0; k < rowsFit && firstRow + k < pos.length; k++) { const r = t.rows[pos[firstRow + k]]; line(3 + k, t.fields.slice(0, shown).map((f, i) => cut(f, r[i], widths[i])).join(' '), firstRow + k === XA.cur.row); }
    line(LINES - 1, ' ' + (t.fields.length - shown > 0 ? (t.fields.length - shown) + ' field(s) do not fit on screen' : 'all fields fit a 64-column line') + ' ', true);
    const g = cv.getContext('2d'), im = g.createImageData(FB_W, FB_H);
    for (let i = 0; i < px.length; i++) { const v = px[i] ? 0 : 255; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    // side panel
    let size; try { size = F.toBinary(XA.db).bytes.length; } catch (e) { size = e.code === 'xcd-too-big' ? 70000 : undefined; }
    const chk = D.atariCheck(XA.db, size), pct = size === undefined ? 0 : Math.min(100, Math.round(size / D.ATARI.payload * 100));
    $('fittext').textContent = size === undefined ? 'size unknown' : `${size} of ${D.ATARI.payload} bytes (${pct}%), ${chk.records} records`;
    const m = $('meter'); m.className = 'meter' + (pct >= 100 ? ' over' : pct > 80 ? ' warn' : ''); m.firstElementChild.style.width = pct + '%';
    const lay = V.layout(t), rb = lay.length ? lay[lay.length - 1].off + lay[lay.length - 1].size : 0;
    $('layout').innerHTML = '<tr><th>Field</th><th>Type</th><th>Offset</th><th>Bytes</th></tr>' + lay.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.type}</td><td>${r.off}</td><td>${r.size}</td></tr>`).join('') + `<tr><th colspan="3">Record</th><th>${rb} / ${D.ATARI.recordBytes}</th></tr>`;
    $('warns').innerHTML = chk.items.map((x) => `<li class="${x.level === 'error' ? 'err' : ''}">${esc(x.msg)}</li>`).join('') || '<li class="ok">No warnings: ACBase will open this as it is.</li>';
  };

  // ---------- dialogs ----------
  const fieldOpts = (t) => t.fields.map((f) => `<option>${esc(f.name)}</option>`).join('');
  V.newTable = () => {
    XA.dialog(`<h3>New table</h3><label>Name (letters, digits, _, up to 10)</label><input type="text" id="ntn" value="table${XA.db.tables.length + 1}"><label>Fields, one per line: name type [length]  (types: ${TYPES.join(', ')})</label><textarea id="ntf" rows="6" spellcheck="false">id int\nname text 20</textarea><div class="row"><button id="dno">Cancel</button><button id="dok" class="on">Create</button></div>`, (d) => {
      d.querySelector('#dno').onclick = XA.closeDialog;
      d.querySelector('#dok').onclick = () => {
        try {
          const fields = d.querySelector('#ntf').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => { const [name, type, len] = s.split(/\s+/); if (!TYPES.includes(type)) throw new Error('unknown type "' + type + '" in: ' + s); return type === 'text' ? { name, type, len: +len || 20 } : { name, type }; });
          XA.addTable(d.querySelector('#ntn').value.trim(), fields); XA.closeDialog();
        } catch (e) { XA.err(e); }
      };
    });
  };

  V.design = () => {
    const t = XA.table();
    XA.dialog(`<h3>Design: ${esc(t.name)}</h3>
      <label>Fields</label><div>${t.fields.map((f) => `<span class="muted">${esc(f.name)} ${f.type}${f.type === 'text' ? ' ' + f.len : ''}</span>`).join(' &middot; ')}</div>
      <label>Add a field</label><div class="inl"><input type="text" id="afn" placeholder="name"><select id="aft">${TYPES.map((x) => `<option>${x}</option>`).join('')}</select><input type="number" id="afl" value="20" min="1" max="255" style="width:80px"><button id="afa">Add</button></div>
      <label>Drop a field</label><div class="inl"><select id="dfn">${fieldOpts(t)}</select><button id="dfa">Drop</button></div>
      <label>Indexes</label><div>${t.indexes.map((x) => `<span class="muted">${esc(x.name)} (${x.fields.map((n, i) => esc(n) + (x.desc[i] ? ' desc' : '')).join(', ')})${x.unique ? ' unique' : ''}</span>`).join(' &middot; ') || '<span class="muted">none</span>'}</div>
      <div class="inl" style="margin-top:6px"><input type="text" id="ixn" placeholder="index name"><input type="text" id="ixf" placeholder="fields: name, city desc"><label style="margin:0"><input type="checkbox" id="ixu"> unique</label><button id="ixa">Create</button></div>
      <div class="inl" style="margin-top:6px"><select id="ixd">${t.indexes.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select><button id="ixx"${t.indexes.length ? '' : ' disabled'}>Drop index</button></div>
      <label>Table</label><div class="inl"><button id="tdrop">Drop table ${esc(t.name)}</button><span class="muted">(undoable)</span></div>
      <div class="row"><button id="dok" class="on">Close</button></div>`, (d) => {
      okBtn(d); const go = (fn) => { try { fn(); V.design(); } catch (e) { XA.err(e); } };
      d.querySelector('#afa').onclick = () => go(() => { const ty = d.querySelector('#aft').value; XA.addField(ty === 'text' ? { name: d.querySelector('#afn').value.trim(), type: ty, len: +d.querySelector('#afl').value || 20 } : { name: d.querySelector('#afn').value.trim(), type: ty }); });
      d.querySelector('#dfa').onclick = () => go(() => XA.dropField(d.querySelector('#dfn').value));
      d.querySelector('#ixa').onclick = () => go(() => { const parts = d.querySelector('#ixf').value.split(',').map((s) => s.trim()).filter(Boolean); XA.addIndex({ name: d.querySelector('#ixn').value.trim(), fields: parts.map((p) => p.replace(/\s+desc$/i, '')), desc: parts.map((p) => /\sdesc$/i.test(p)), unique: d.querySelector('#ixu').checked }); });
      d.querySelector('#ixx').onclick = () => go(() => XA.dropIndex(d.querySelector('#ixd').value));
      d.querySelector('#tdrop').onclick = () => { try { XA.dropTable(t.name); XA.closeDialog(); } catch (e) { XA.err(e); } };
    });
  };

  V.exportDlg = () => {
    const t = XA.table();
    XA.dialog(`<h3>Export</h3><p class="muted">The database as a whole, or the current table (${esc(t.name)}).</p>
      <div class="inl" style="flex-wrap:wrap;gap:8px"><button data-x="xcd" class="on">Database .xcd</button><button data-x="json">Database JSON twin</button><button data-x="dbf">Table .dbf (+ .dbt)</button><button data-x="csv">Table CSV</button><button data-x="tsv">Table TSV</button></div>
      <p class="muted">SQLite export is done by the SQL gateway tools (node scripts: tools/xcdsqlite.cjs), not in the browser.</p>
      <div class="row"><button id="dok" class="on">Close</button></div>`, (d) => {
      okBtn(d);
      d.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { try { const r = XA.save(b.dataset.x); const l = XA.lossRows(r.loss); note('Exported ' + r.files.map((f) => f.name).join(', '), XA.lossHtml(r.loss)); if (!l.length) XA.toast('Exported ' + r.files.map((f) => f.name).join(', ')); } catch (e) { note('Could not export', '<p>' + esc(e.message) + '</p>'); } }; });
    });
  };

  V.reportDlg = () => {
    const t = XA.table(), reps = XA.db.reports.filter((r) => r.table.toLowerCase() === t.name.toLowerCase());
    const opts = [XA.reportFor(Object.assign(Object.create(t), { name: t.name }))].filter(() => !reps.length).concat(reps);
    const all = reps.length ? reps : opts;
    XA.dialog(`<h3>Report / print</h3><label>Report</label><select id="rsel">${all.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join('')}</select>
      <iframe id="rframe" style="width:100%;height:300px;background:#fff;border:1px solid var(--line);border-radius:6px;margin-top:10px"></iframe>
      <label>Definition (JSON): forms and reports of this database</label><textarea id="rjson" rows="6" spellcheck="false"></textarea>
      <div class="row"><button id="rapply">Apply definition</button><button id="rdl">Download HTML</button><button id="rprint">Print</button><button id="dok" class="on">Close</button></div>`, (d) => {
      okBtn(d);
      const draw = () => { try { d.querySelector('#rframe').srcdoc = XA.reportHTML(all[+d.querySelector('#rsel').value]); } catch (e) { d.querySelector('#rframe').srcdoc = '<p style="font:14px sans-serif;color:#b00">' + esc(e.message) + '</p>'; } };
      d.querySelector('#rjson').value = JSON.stringify({ forms: XA.db.forms, reports: XA.db.reports }, null, 1);
      d.querySelector('#rsel').onchange = draw; draw();
      d.querySelector('#rdl').onclick = () => { try { XA.download(new TextEncoder().encode(XA.reportHTML(all[+d.querySelector('#rsel').value])), t.name + '-report.html', 'text/html'); } catch (e) { XA.err(e); } };
      d.querySelector('#rprint').onclick = () => { const fr = d.querySelector('#rframe'); fr.contentWindow.focus(); fr.contentWindow.print(); };
      d.querySelector('#rapply').onclick = () => {
        try {
          const j = JSON.parse(d.querySelector('#rjson').value), probe = D.fromJSON(Object.assign(D.toJSON(XA.db), { forms: j.forms || [], reports: j.reports || [] }));
          XA.schema('forms and reports', () => { XA.db.forms = probe.forms; XA.db.reports = probe.reports; }); XA.toast('Definitions applied'); V.reportDlg();
        } catch (e) { XA.err(e); }
      };
    });
  };

  V.mergeDlg = () => {
    const t = XA.table(), saved = XA.LS.get('xcb.merge.' + t.name, null);
    const first = t.fields[0] ? t.fields[0].name : 'Name';
    const tpl = saved || 'Dear <<' + (t.hasCol('name') ? t.fields[t.col('name')].name : first) + '>>,\n\nThis is a letter for <<' + first + '>>.\n\nYours sincerely\n';
    XA.dialog(`<h3>Mail merge into xCWriter</h3><p class="muted">Write the letter with &lt;&lt;Field&gt;&gt; markers. The current view (filter and sort) is merged: one letter per record.</p>
      <div class="chips" id="mchips">${t.fields.map((f) => `<button data-ins="${esc(f.name)}">${esc(f.name)}</button>`).join('')}</div>
      <textarea id="mtpl" rows="8" spellcheck="false">${esc(tpl)}</textarea><div id="mwarn" class="muted"></div><label>Preview (first record)</label><pre id="mprev"></pre>
      <div class="row"><button id="mtxt" class="on">Merged letters (.txt)</button><button id="mjson">Merge file (.xcmerge.json)</button><button id="mcsv">Data (.csv)</button><button id="dok">Close</button></div>`, (d) => {
      okBtn(d); const ta = d.querySelector('#mtpl');
      const upd = () => { const m = XA.mergeOutputs(ta.value); d.querySelector('#mwarn').innerHTML = m.unknown.length ? '<span style="color:#f0c070">Unknown fields: ' + m.unknown.map(esc).join(', ') + ' (they merge as empty)</span>' : m.count + ' letter' + (m.count === 1 ? '' : 's') + ' will be produced'; d.querySelector('#mprev').textContent = m.letters[0] || '(no records)'; XA.LS.set('xcb.merge.' + t.name, ta.value); return m; };
      ta.oninput = upd; upd();
      d.querySelector('#mchips').onclick = (e) => { const f = e.target.dataset && e.target.dataset.ins; if (!f) return; const a = ta.selectionStart; ta.value = ta.value.slice(0, a) + '<<' + f + '>>' + ta.value.slice(ta.selectionEnd); ta.focus(); ta.selectionStart = ta.selectionEnd = a + f.length + 4; upd(); };
      const out = (k, ext2, mime) => { const m = upd(), data = k === 'txt' ? m.txt : k === 'json' ? m.json : m.csv; XA.download(new TextEncoder().encode(data), t.name + '-' + (k === 'txt' ? 'letters' : 'merge') + ext2, mime); };
      d.querySelector('#mtxt').onclick = () => out('txt', '.txt', 'text/plain'); d.querySelector('#mjson').onclick = () => out('json', '.xcmerge.json', 'application/json'); d.querySelector('#mcsv').onclick = () => out('csv', '.csv', 'text/csv');
    });
  };

  // ---------- SQL gateway panel ----------
  V.gateDlg = () => {
    const g = XA.gate, saved = XA.LS.get('xcb.gate', null); if (saved && saved.url) g.url = saved.url;
    XA.dialog(`<h3>SQL gateway</h3><p class="muted">Reads SQLite databases through the local relay (node tools/sqlgate/server.cjs). Queries are read-only with ? parameters; the relay holds the table allow-list. The token is kept in memory only.</p>
      <label>Relay address</label><input type="text" id="gurl" value="${esc(g.url)}"><label>Token</label><input type="text" id="gtok" value="${esc(g.token)}" autocomplete="off" spellcheck="false">
      <div class="row" style="margin-top:8px"><button id="gcon" class="on">Connect</button></div><div id="gst" class="muted"></div>
      <div id="gbody" style="display:none"><label>Database</label><select id="gdb"></select><label>Tables</label><div id="gtabs" class="chips"></div>
        <label>SQL (one SELECT, values as ?)</label><textarea id="gsql" rows="3" spellcheck="false"></textarea><input type="text" id="gprm" placeholder='? values: ["x", 1]' style="width:100%;margin-top:6px">
        <div class="row"><button id="grun">Run</button><button id="gimp">Import result as table</button></div><div id="gres" style="max-height:220px;overflow:auto;background:#fff;color:#111;border-radius:6px"></div></div>
      <div class="row"><button id="dok">Close</button></div>`, (d) => {
      okBtn(d); let last = null; const st = (s, bad) => { d.querySelector('#gst').innerHTML = bad ? '<span style="color:#ff8a80">' + esc(s) + '</span>' : esc(s); };
      const syncCfg = () => { g.url = d.querySelector('#gurl').value.trim(); g.token = d.querySelector('#gtok').value.trim(); XA.LS.set('xcb.gate', { url: g.url }); };
      const loadTables = async () => { try { const r = await XA.gcall('/sql/tables', { db: d.querySelector('#gdb').value }); d.querySelector('#gtabs').innerHTML = r.tables.map((n) => `<button data-t="${esc(n)}">${esc(n)}</button>`).join('') || '<span class="muted">no allowed tables</span>'; } catch (e) { st(e.message, true); } };
      d.querySelector('#gcon').onclick = async () => {
        syncCfg();
        try {
          const caps = await XA.gcall('/sql/caps', {}); g.caps = caps; st('Connected: ' + caps.databases.length + ' database(s), row limit ' + caps.limits.maxRows + ', engines: ' + caps.engines.join(', '));
          d.querySelector('#gdb').innerHTML = caps.databases.map((x) => `<option>${esc(x.alias)}</option>`).join(''); d.querySelector('#gbody').style.display = 'block'; await loadTables();
        } catch (e) { st(e.message, true); d.querySelector('#gbody').style.display = 'none'; }
      };
      d.querySelector('#gdb').onchange = loadTables;
      d.querySelector('#gtabs').onclick = (e) => { const n = e.target.dataset && e.target.dataset.t; if (n) d.querySelector('#gsql').value = 'SELECT * FROM ' + n; };
      d.querySelector('#grun').onclick = async () => {
        let params = []; const ps = d.querySelector('#gprm').value.trim();
        if (ps) { try { params = JSON.parse(ps); if (!Array.isArray(params)) throw 0; } catch (e) { st('The ? values must be a JSON array', true); return; } }
        try {
          const r = await XA.gcall('/sql/query', { db: d.querySelector('#gdb').value, sql: d.querySelector('#gsql').value, params }); last = r;
          d.querySelector('#gres').innerHTML = '<table class="rtab"><thead><tr>' + r.columns.map((c) => '<th style="text-align:left;padding:2px 8px;border-bottom:1px solid #ccc">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + r.rows.slice(0, 200).map((row) => '<tr>' + row.map((v) => '<td style="padding:2px 8px">' + esc(v === null ? '' : v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
          st(r.rows.length + ' row(s)' + (r.more ? ' - more rows exist than the relay limit allows' : ''));
        } catch (e) { st(e.message, true); }
      };
      d.querySelector('#gimp').onclick = () => {
        if (!last) { st('Run a query first', true); return; }
        try {
          const name = XA.uniqueName('sql'), r = last, fields = XA.rowsToTable(name, r).fields;
          XA.schema('import SQL result', () => { const t = XA.db.createTable(name, fields); for (const row of r.rows) t.insert(row.map((v, i) => (fields[i].type === 'text' && v !== null ? String(v) : v)), { truncate: true }); XA.tname = name; });
          XA.toast('Imported as table ' + name); XA.closeDialog();
        } catch (e) { st(e.message, true); }
      };
    });
  };

  V.helpHtml = () => `<h2>xCBase help</h2>
    <p>xCBase is the database of the Craft family. A database holds tables; a table holds typed fields and records. Save it as <code>.xcd</code> (small, fixed-width, CRC-protected, built to open in ACBase on an Atari) or as a JSON twin.</p>
    <h3>Field types</h3><p><code>text N</code> (1 to 255), <code>int</code> (32-bit), <code>num</code> (Atari BCD, 10 digits), <code>date</code>, <code>bool</code>, <code>memo</code>. Field names are up to 10 characters.</p>
    <h3>Views</h3><p><b>Grid</b>: click a heading to sort, type in the Filter box (<code>city=London</code>, <code>balance&gt;100</code>, <code>name~an</code>, or plain text). Double-click or Enter edits a cell; Insert adds a record; Delete removes one. Everything is undoable. <b>Form</b>: one record, with memo fields. <b>Query</b>: a SELECT subset executed in the page (joins, GROUP BY, aggregates, ? parameters). <b>Atari view</b>: the 64-column screen and the record layout limits.</p>
    <h3>Files</h3><p>Open or drop .xcd, JSON, dBase III .dbf (with its .dbt), CSV or TSV. Import adds tables to the open database. Export writes .xcd, JSON, .dbf, CSV, TSV. A report of anything the target format cannot hold is shown.</p>
    <h3>SQL gateway</h3><p>The SQL gateway button reads SQLite databases through a local relay (<code>node tools/sqlgate/server.cjs config.json</code>). Read-only by default, table allow-list, ? parameters only, row and size limits. Credentials stay in the relay's config, never in this page or in git.</p>
    <h3>Mail merge</h3><p>Write a letter with <code>&lt;&lt;Field&gt;&gt;</code> markers; xCBase writes the merged letters (.txt, one per record, separated by a form feed), a <code>.xcmerge.json</code> merge file and the data as CSV for xCWriter. See docs/XCBASE.md.</p>
    <h3>History</h3><p>Right-click the grid for Clear undo history and Clear history (recent databases, gateway address, last query).</p>`;
})();
