// xCBase application state and operations: database, view (filter/sort), undo/redo, files, SQL gateway client, mail merge, history.
// The engine is tools/dbcore.cjs + xcdformat.cjs + xcdio.cjs (window.XCB, bundled by scripts/xcbase-sync-core.cjs). No DOM here except toast/dialog helpers.
(function () {
  'use strict';
  const { D, F, IO } = window.XCB;
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const XA = window.XA = { D, F, IO, $, LS, db: null, tname: '', name: 'Untitled', dirty: false, undo: [], redo: [], listeners: {}, filter: '', sort: null, cur: { row: 0, col: 0 }, gate: { url: 'http://127.0.0.1:8766', token: '', caps: null } };
  XA.on = (ev, fn) => { (XA.listeners[ev] = XA.listeners[ev] || []).push(fn); };
  XA.emit = (ev, a) => { for (const fn of XA.listeners[ev] || []) fn(a); };
  const esc = XA.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let toastT = 0;
  XA.toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2800); };
  XA.dialog = (html, wire) => { $('dlg').innerHTML = html; $('modal').classList.add('on'); if (wire) wire($('dlg')); };
  XA.closeDialog = () => { $('modal').classList.remove('on'); };
  XA.err = (e) => { XA.toast((e && e.message) || String(e)); };

  // ---------- database and current table ----------
  XA.table = () => XA.db.table(XA.tname);
  XA.setDb = (db, name) => {
    XA.db = db; XA.name = name || db.name || 'Untitled'; XA.tname = db.tables.length ? db.tables[0].name : '';
    XA.undo = []; XA.redo = []; XA.filter = ''; XA.sort = null; XA.cur = { row: 0, col: 0 }; XA.dirty = false;
    XA.emit('db'); XA.emit('history');
  };
  XA.newDb = () => {
    const db = new D.Database('Untitled'), t = db.createTable('table1', [{ name: 'id', type: 'int' }, { name: 'name', type: 'text', len: 20 }]);
    t.insert({ id: 1, name: '' });
    XA.setDb(db, 'Untitled');
  };
  XA.useTable = (name) => { XA.tname = name; XA.filter = ''; XA.sort = null; XA.cur = { row: 0, col: 0 }; XA.emit('table'); };

  // ---------- the view: filtered, sorted positions into table.rows ----------
  const OPS = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<>|!=|>=|<=|=|>|<|~)\s*(.*?)\s*$/;
  XA.makeFilter = (t, text) => {
    text = String(text || '').trim(); if (!text) return null;
    const m = OPS.exec(text);
    if (m && t.hasCol(m[1])) {
      const ci = t.col(m[1]), f = t.fields[ci], op = m[2];
      let v = m[3]; if (v.length > 1 && /^(["']).*\1$/.test(v)) v = v.slice(1, -1);
      if (op === '~') { const n = v.toLowerCase(); return (r) => r[ci] !== null && String(D.fmtValue(r[ci], f.type, f)).toLowerCase().includes(n); }
      let cv; try { cv = D.coerce(f, v); } catch (e) { throw new Error('"' + v + '" is not a valid ' + f.type + ' value for ' + f.name); }
      return (r) => {
        const x = r[ci]; if (x === null || x === undefined) return false;
        const c = f.type === 'text' ? D.cmpCI(x, cv) : D.cmp(x, cv);
        return op === '=' ? c === 0 : op === '<>' || op === '!=' ? c !== 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '<' ? c < 0 : c <= 0;
      };
    }
    const n = text.toLowerCase();
    return (r) => r.some((x, i) => x !== null && x !== undefined && String(D.fmtValue(x, t.fields[i].type, t.fields[i])).toLowerCase().includes(n));
  };
  let vcache = null;
  XA.positions = () => {
    const t = XA.table(), key = t.name + '|' + t.version + '|' + t.rows.length + '|' + XA.filter + '|' + JSON.stringify(XA.sort);
    if (vcache && vcache.key === key) return vcache.pos;
    let pos, pred = null;
    try { pred = XA.makeFilter(t, XA.filter); XA.filterError = ''; } catch (e) { XA.filterError = e.message; }
    pos = t.rows.map((_, i) => i);
    if (pred) pos = pos.filter((i) => pred(t.rows[i]));
    if (XA.sort && t.hasCol(XA.sort.field)) pos = t.sort([XA.sort], pos);
    vcache = { key, pos }; return pos;
  };
  XA.setSort = (field, desc) => { XA.sort = field ? { field, desc: !!desc } : null; XA.emit('view'); };
  XA.setFilter = (text) => { XA.filter = text; XA.cur.row = 0; XA.emit('view'); };
  XA.recIndex = (row) => XA.positions()[row];

  // ---------- undo / redo (every step is closures over the live table) ----------
  XA.push = (label, undo, redo) => { XA.undo.push({ label, undo, redo }); if (XA.undo.length > 500) XA.undo.shift(); XA.redo = []; XA.dirty = true; XA.emit('change'); XA.emit('history'); };
  XA.doUndo = () => { const s = XA.undo.pop(); if (!s) return; s.undo(); XA.redo.push(s); XA.dirty = true; clampCur(); XA.emit('change'); XA.emit('history'); XA.toast('Undid: ' + s.label); };
  XA.doRedo = () => { const s = XA.redo.pop(); if (!s) return; s.redo(); XA.undo.push(s); XA.dirty = true; clampCur(); XA.emit('change'); XA.emit('history'); XA.toast('Redid: ' + s.label); };
  const clampCur = () => { const n = XA.positions().length; XA.cur.row = Math.max(0, Math.min(n - 1, XA.cur.row)); };

  XA.addRecord = (values) => {
    const t = XA.table(), i = t.insert(values || {}), row = t.rows[i].slice();
    XA.push('add record', () => { t.delete(i); }, () => { t.insertAt(i, row); });
    const p = XA.positions(); XA.cur.row = Math.max(0, p.indexOf(i)); return i;
  };
  XA.deleteRecord = (i) => {
    const t = XA.table(), old = t.delete(i);
    XA.push('delete record', () => { t.insertAt(i, old); }, () => { t.delete(i); }); clampCur();
  };
  XA.setCell = (i, field, text) => {
    const t = XA.table(), f = t.fields[t.col(field)];
    let v = text;
    if (typeof text === 'string') { const s = text.trim(); v = s === '' && f.type !== 'text' && f.type !== 'memo' ? null : text; if (f.type === 'bool' && s !== '') v = /^(1|y|yes|t|true|x)$/i.test(s) ? true : /^(0|n|no|f|false)$/i.test(s) ? false : text; }
    const old = t.update(i, { [field]: v }), now = t.rows[i].slice();
    XA.push('edit ' + field, () => { t.setRow(i, old); }, () => { t.setRow(i, now); });
  };
  XA.setRecord = (i, obj) => {
    const t = XA.table(), old = t.update(i, obj), now = t.rows[i].slice();
    XA.push('edit record', () => { t.setRow(i, old); }, () => { t.setRow(i, now); });
  };
  // schema and whole-database changes: undo by snapshot
  const snapDb = () => JSON.stringify(D.toJSON(XA.db));
  XA.schema = (label, fn) => {
    const before = snapDb(), tn = XA.tname; fn(); const after = snapDb();
    const put = (s, name) => { XA.db = D.fromJSON(s); XA.tname = XA.db.hasTable(name) ? name : (XA.db.tables[0] || { name: '' }).name; XA.emit('table'); };
    XA.push(label, () => put(before, tn), () => put(after, XA.tname)); XA.emit('table');
  };
  XA.addField = (def) => XA.schema('add field', () => { XA.table().addField(def); });
  XA.dropField = (name) => XA.schema('drop field', () => { XA.table().dropField(name); });
  XA.addIndex = (def) => XA.schema('create index', () => { XA.table().createIndex(def); });
  XA.dropIndex = (name) => XA.schema('drop index', () => { XA.table().dropIndex(name); });
  XA.addTable = (name, fields) => XA.schema('add table', () => { XA.db.createTable(name, fields); XA.tname = name; });
  XA.dropTable = (name) => XA.schema('drop table', () => { XA.db.dropTable(name); XA.tname = XA.db.tables.length ? XA.db.tables[0].name : ''; });
  XA.uniqueName = (base) => { let n = base.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'table'; if (/^[0-9]/.test(n)) n = 't' + n; let k = 1, c = n; while (XA.db.hasTable(c)) { const s = String(++k); c = n.slice(0, 10 - s.length) + s; } return c; };

  // ---------- files ----------
  const MIME = { xcd: 'application/x-craft-database', json: 'application/json', dbf: 'application/x-dbf', dbt: 'application/octet-stream', csv: 'text/csv', tsv: 'text/tab-separated-values', html: 'text/html', txt: 'text/plain' };
  const ext = (n) => (/\.([A-Za-z0-9]+)$/.exec(n) || [])[1] ? /\.([A-Za-z0-9]+)$/.exec(n)[1].toLowerCase() : '';
  const baseName = (n) => String(n).replace(/\.[^.]*$/, '');
  XA.download = (bytes, name, mime) => {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(new Error('could not read ' + f.name)); r.readAsArrayBuffer(f); });
  const magic = (b) => b.length > 5 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'CRFT';

  // parse one file into { db, loss, name }; throws DBError with a readable message
  XA.parseFile = async (f, siblings) => {
    const bytes = await readFile(f), e = ext(f.name);
    if (magic(bytes) || e === 'xcd') { const r = F.fromBinary(bytes); return { db: r.db, loss: (r.info.warnings || []).map((w) => ({ code: 'xcd-warning', severity: 'warn', count: 1, detail: String(w) })), name: f.name }; }
    if (e === 'json') return { db: D.fromJSON(new TextDecoder().decode(bytes)), loss: [], name: f.name };
    if (e === 'dbf') {
      const dbt = (siblings || []).find((s) => s !== f && baseName(s.name).toLowerCase() === baseName(f.name).toLowerCase() && ext(s.name) === 'dbt');
      const r = IO.importDBF(bytes, { memo: dbt ? await readFile(dbt) : undefined, name: baseName(f.name), tableName: XA.uniqueNameFor(baseName(f.name)) });
      return { db: r.db, loss: r.loss, name: f.name };
    }
    if (['sqlite', 'db', 'sqlite3'].includes(e)) throw new Error('SQLite files are read through the SQL gateway (SQL gateway button), not in the browser');
    const r = IO.importDelimited(bytes, { name: baseName(f.name), tableName: XA.uniqueNameFor(baseName(f.name)), delimiter: e === 'tsv' ? '\t' : undefined });
    return { db: r.db, loss: r.loss, name: f.name };
  };
  XA.uniqueNameFor = (base) => { let n = String(base).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'table'; if (/^[0-9]/.test(n)) n = 't' + n; return n; };

  // open: replace the database. add: append the tables of the file(s) to it.
  XA.openFiles = async (list, add) => {
    list = Array.from(list || []); if (!list.length) return;
    const main = list.filter((f) => ext(f.name) !== 'dbt'); let loss = [], opened = 0;
    for (const f of main) {
      try {
        const r = await XA.parseFile(f, list); loss = loss.concat(r.loss.map((l) => Object.assign({}, l, { detail: f.name + ': ' + l.detail })));
        if (add && XA.db) {
          XA.schema('import ' + f.name, () => { for (const t of r.db.tables) { const nt = XA.db.createTable(XA.uniqueName(t.name), t.fields); nt.rows = t.rows.map((x) => x.slice()); nt._dirty(); for (const x of t.indexes) { try { nt.createIndex(x); } catch (e) { /* skip */ } } XA.tname = nt.name; } });
        } else if (!opened) { XA.setDb(r.db, r.name); opened++; XA.remember(); } else { XA.toast('Only the first file was opened; use Import to add the others'); break; }
      } catch (e) { XA.dialog('<h3>Could not open ' + esc(f.name) + '</h3><p>' + esc(e.message) + '</p><div class="row"><button id="dok" class="on">OK</button></div>', (d) => { d.querySelector('#dok').onclick = XA.closeDialog; }); return false; }
    }
    if (add) XA.emit('table');
    const shown = XA.lossRows(loss);
    if (shown.length) XA.dialog('<h3>Imported with notes</h3>' + XA.lossHtml(loss) + '<div class="row"><button id="dok" class="on">OK</button></div>', (d) => { d.querySelector('#dok').onclick = XA.closeDialog; });
    return true;
  };

  // format: xcd | json | dbf | csv | tsv   (dbf/csv/tsv export the current table)
  XA.exportAs = (fmt) => {
    const base = baseName(XA.name) || 'database', t = XA.table();
    if (fmt === 'xcd') { const r = F.toBinary(XA.db); return { files: [{ name: base + '.xcd', bytes: r.bytes, mime: MIME.xcd }], loss: r.loss || [] }; }
    if (fmt === 'json') return { files: [{ name: base + '.json', bytes: new TextEncoder().encode(JSON.stringify(D.toJSON(XA.db), null, 1)), mime: MIME.json }], loss: [] };
    if (fmt === 'dbf') { const r = IO.exportDBF(t), files = [{ name: t.name + '.dbf', bytes: r.dbf, mime: MIME.dbf }]; if (r.dbt) files.push({ name: t.name + '.dbt', bytes: r.dbt, mime: MIME.dbt }); return { files, loss: r.loss }; }
    if (fmt === 'csv' || fmt === 'tsv') { const r = IO.exportDelimited(t, { delimiter: fmt === 'tsv' ? '\t' : ',', bom: true }); return { files: [{ name: t.name + '.' + fmt, bytes: new TextEncoder().encode(r.text), mime: MIME[fmt] }], loss: r.loss }; }
    throw new Error('unknown format ' + fmt);
  };
  XA.save = (fmt) => {
    const r = XA.exportAs(fmt || 'xcd');
    for (const f of r.files) XA.download(f.bytes, f.name, f.mime);
    if ((fmt || 'xcd') === 'xcd') { XA.dirty = false; XA.remember(); }
    return r;
  };

  // ---------- history (recent databases, undo) ----------
  XA.remember = () => {
    try {
      const json = JSON.stringify(D.toJSON(XA.db));
      if (json.length > 400000) return;
      const rec = LS.get('xcb.recent', []).filter((x) => x.name !== XA.name);
      rec.unshift({ name: XA.name, t: Date.now(), json }); LS.set('xcb.recent', rec.slice(0, 8)); XA.emit('recent');
    } catch (e) { /* storage full: the recent list is optional */ }
  };
  XA.openRecent = (i) => { const r = LS.get('xcb.recent', [])[i]; if (r) XA.setDb(D.fromJSON(r.json), r.name); };
  // History only: recent databases, SQL gateway address, query text, undo/redo. The open database stays.
  XA.clearHistory = () => {
    LS.set('xcb.recent', []); for (const k of ['xcb.gate', 'xcb.sql']) { try { localStorage.removeItem(k); } catch (e) { /* unavailable */ } }
    XA.undo = []; XA.redo = []; XA.emit('history'); XA.emit('recent'); XA.toast('History cleared');
  };
  XA.lossRows = (loss) => (loss || []).filter((l) => l.severity !== 'info');
  XA.lossHtml = (loss) => { const l = XA.lossRows(loss); return l.length ? '<ul class="rep">' + l.map((x) => '<li><b>' + esc(x.code) + '</b>' + (x.count > 1 ? ' x' + x.count : '') + ': ' + esc(x.detail) + '</li>').join('') + '</ul>' : '<ul class="rep none"><li>Nothing lost.</li></ul>'; };

  // ---------- reports and mail merge ----------
  XA.reportFor = (t) => (XA.db.reports.find((r) => r.table.toLowerCase() === t.name.toLowerCase()) || { name: t.name, table: t.name, title: t.name + ' listing', columns: t.fields.map((f) => ({ field: f.name })) });
  XA.reportHTML = (rep) => D.reportHTML(D.runReport(XA.db, rep || XA.reportFor(XA.table())), { page: true });
  // Merge output for the current view (filter and sort apply). See docs/XCBASE.md "Mail merge into xCWriter".
  XA.mergeOutputs = (template) => {
    const t = XA.table(), pos = XA.positions(), names = t.fields.map((f) => f.name), used = D.mergeFields(template);
    const unknown = used.filter((n) => !t.hasCol(n));
    const objs = pos.map((i) => t.toObject(t.rows[i]));
    const letters = objs.map((o) => D.mergeText(template, o));
    const txt = letters.join('\n\f\n'), j = { format: 'xcmerge', version: 1, table: t.name, fields: t.fields.map((f) => ({ name: f.name, type: f.type })), template, records: pos.map((i) => t.rows[i].map((v) => (v === undefined ? null : v))) };
    const csv = IO.exportDelimited(t, { delimiter: ',', bom: true, positions: pos }).text;
    return { unknown, names, count: pos.length, txt, json: JSON.stringify(j, null, 1), csv, letters };
  };

  // ---------- SQL gateway client (same wire convention as web/js/transport.js relay: X-AC-Token, X-AC-Args, X-AC-Meta, X-AC-Err) ----------
  XA.gcall = async (route, args) => {
    const g = XA.gate; let r;
    try { r = await fetch(g.url.replace(/\/+$/, '') + route, { method: 'POST', headers: { 'X-AC-Token': g.token, 'X-AC-Args': encodeURIComponent(JSON.stringify(args || {})) } }); } catch (e) { throw new Error('the SQL gateway is not reachable at ' + g.url + ' (start it: node tools/sqlgate/server.cjs <config.json>)'); }
    let body = null; try { body = await r.json(); } catch (e) { /* empty */ }
    if (r.status === 403) throw new Error('the SQL gateway refused the token');
    if (!r.ok) throw new Error((body && body.message) || (body && body.error) || 'gateway error ' + r.status);
    return body;
  };
  XA.rowsToTable = (name, res) => {
    const used = new Set(), fields = res.columns.map((c, i) => {
      let n = String(c).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'c' + (i + 1); if (/^[0-9]/.test(n)) n = 'c' + n.slice(0, 9); let k = 1, base = n;
      while (used.has(n.toLowerCase())) { const s = String(++k); n = base.slice(0, 10 - s.length) + s; } used.add(n.toLowerCase());
      const vals = res.rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined);
      if (vals.length && vals.every((v) => Number.isInteger(v) && Math.abs(v) <= 2147483647)) return { name: n, type: 'int' };
      if (vals.length && vals.every((v) => typeof v === 'number')) return { name: n, type: 'num' };
      const len = Math.max(1, ...vals.map((v) => String(v).length));
      return len > 255 ? { name: n, type: 'memo' } : { name: n, type: 'text', len };
    });
    return { name, fields };
  };
})();
