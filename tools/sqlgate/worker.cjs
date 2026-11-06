// Child process: runs ONE statement against ONE database under the SQLite authorizer. Forked by core.cjs, which kills it on timeout\n// (a process, not a worker thread: a runaway native sqlite call cannot be interrupted inside a thread).
'use strict';
const { DatabaseSync, constants: K } = require('node:sqlite');

// scalar functions a query may call; everything else (load_extension, readfile, ...) is denied
const FUNCS = new Set(['count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat', 'abs', 'round', 'lower', 'upper', 'length', 'substr', 'substring', 'trim', 'ltrim', 'rtrim', 'replace', 'instr', 'coalesce', 'ifnull', 'nullif', 'iif', 'typeof', 'like', 'glob', 'date', 'time', 'datetime', 'julianday', 'strftime', 'printf', 'format', 'hex', 'quote', 'unicode', 'char', 'sign']);

function run(w) {
  const allow = new Set(w.tables.map((t) => t.toLowerCase()));
  const write = w.mode === 'exec';
  const db = new DatabaseSync(w.path, { readOnly: !write });
  try {
    if (w.op === 'schema') {
      const t = String(w.table);
      if (!allow.has(t.toLowerCase())) throw Object.assign(new Error('table not allowed: ' + t), { code: 'denied' });
      const cols = db.prepare('SELECT name, type, "notnull" nn, pk FROM pragma_table_info(?)').all(t);
      if (!cols.length) throw Object.assign(new Error('no such table: ' + t), { code: 'no-table' });
      return { columns: cols.map((c) => ({ name: c.name, type: c.type, notNull: !!c.nn, pk: c.pk > 0 })) };
    }
    if (w.op === 'tables') {
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
      return { tables: names.filter((n) => allow.has(n.toLowerCase())) };
    }
    db.setAuthorizer((code, a, b, c) => {
      switch (code) {
        case K.SQLITE_SELECT: return K.SQLITE_OK;
        case K.SQLITE_RECURSIVE: return K.SQLITE_OK;
        // a CTE or subquery name is reported without a database name; real tables always carry one (main/temp)
        case K.SQLITE_READ: return c === null || c === undefined ? K.SQLITE_OK : allow.has(String(a).toLowerCase()) ? K.SQLITE_OK : K.SQLITE_DENY;
        case K.SQLITE_FUNCTION: return FUNCS.has(String(b).toLowerCase()) ? K.SQLITE_OK : K.SQLITE_DENY;
        case K.SQLITE_INSERT: case K.SQLITE_UPDATE: case K.SQLITE_DELETE:
          return write && allow.has(String(a).toLowerCase()) ? K.SQLITE_OK : K.SQLITE_DENY;
        default: return K.SQLITE_DENY; // PRAGMA, ATTACH, DDL, transactions, triggers, ...
      }
    });
    const st = db.prepare(w.sql);
    if (write) { const r = st.run(...w.params); return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }; }
    const cols = st.columns().map((c) => c.name), rows = [];
    let bytes = 0, more = false;
    for (const r of st.iterate(...w.params)) {
      if (rows.length >= w.maxRows) { more = true; break; }
      const row = cols.map((c) => { const v = r[c]; return v instanceof Uint8Array ? null : typeof v === 'bigint' ? Number(v) : v; });
      bytes += JSON.stringify(row).length;
      if (bytes > w.maxBytes) { more = true; break; }
      rows.push(row);
    }
    return { columns: cols, rows, more };
  } finally { db.close(); }
}
process.once('message', (w) => {
  let out;
  try { out = { ok: true, result: run(w) }; } catch (e) { out = { ok: false, code: e.code && /^[a-z-]+$/.test(e.code) ? e.code : e.errcode === 23 ? 'denied' : 'sql-error', message: e.message }; }
  process.send(out, () => process.exit(0));
});
