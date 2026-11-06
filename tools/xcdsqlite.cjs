'use strict';
// SQLite import and export for xCBase through node:sqlite (Node 22.5+; the browser reads SQLite through the SQL gateway, tools/sqlgate).
// No temporary files: databases are read with deserialize() and written with serialize().
const D = require('./dbcore.cjs');
const IO = require('./xcdio.cjs');
const fs = require('fs');

function sqlite() {
  try { return require('node:sqlite'); } catch (e) { throw new D.DBError('sqlite-unavailable', 'node:sqlite is not available in this Node version (needs 22.5 or newer)'); }
}
const qs = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const qid = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// input: file path (string) or bytes
function importSqlite(input, opts) {
  opts = opts || {};
  const { DatabaseSync } = sqlite(), loss = new IO.Loss();
  let sdb;
  try {
    if (typeof input === 'string') sdb = new DatabaseSync(input, { readOnly: true });
    else { sdb = new DatabaseSync(':memory:'); sdb.deserialize(input instanceof Uint8Array ? input : Uint8Array.from(input)); }
    sdb.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (e) { try { if (sdb) sdb.close(); } catch (e2) { /* ignore */ } throw new D.DBError('sqlite-bad-file', 'not a readable SQLite database: ' + e.message); }
  const db = new D.Database(opts.name || 'sqlite');
  try {
    const names = sdb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map((r) => r.name).filter((n) => !opts.tables || opts.tables.includes(n));
    const used = new Set();
    for (const tn of names) {
      const info = sdb.prepare(`PRAGMA table_info(${qid(tn)})`).all();
      if (!info.length) continue;
      const total = sdb.prepare(`SELECT count(*) c FROM ${qid(tn)}`).get().c;
      let rows = sdb.prepare(`SELECT * FROM ${qid(tn)} LIMIT 65535`).all();
      if (total > 65535) loss.add('too-many-records', 'lossy', `${tn}: only the first 65535 of ${total} rows were imported`, total - 65535);
      const fused = new Set(), fields = [], keep = [];
      info.slice(0, D.LIMITS.maxFields).forEach((col, ci) => {
        const decl = String(col.type || '').toUpperCase(), vals = rows.map((r) => r[col.name]).filter((v) => v !== null && v !== undefined);
        let f = null;
        if (vals.some((v) => v instanceof Uint8Array)) { loss.add('blob-column', 'lossy', `${tn}.${col.name}: binary column dropped`); return; }
        const nm = IO.fieldName(col.name, fused, loss, ci);
        const len = /\((\d+)/.exec(decl);
        if (/BOOL/.test(decl)) f = { name: nm, type: 'bool' };
        else if (/INT/.test(decl) && vals.every((v) => Number.isInteger(Number(v)) && Math.abs(Number(v)) <= 2147483647)) f = { name: nm, type: 'int' };
        else if (/^(DATE)$/.test(decl) && vals.every((v) => D.parseDate(String(v)))) f = { name: nm, type: 'date' };
        else if (/INT|REAL|FLOA|DOUB|NUMERIC|DECIMAL/.test(decl) || (!decl && vals.length && vals.every((v) => typeof v === 'number'))) {
          f = { name: nm, type: !/REAL|FLOA|DOUB|NUMERIC|DECIMAL/.test(decl) && vals.every((v) => Number.isInteger(v) && Math.abs(v) <= 2147483647) ? 'int' : 'num' };
          if (/INT/.test(decl) && f.type === 'num') loss.add('int-range', 'warn', `${tn}.${col.name}: integers beyond 32 bits are stored as numbers (10 significant digits)`);
        } else {
          const max = Math.max(1, ...vals.map((v) => String(v).length));
          f = max > 255 || vals.some((v) => /[\r\n]/.test(String(v))) ? { name: nm, type: 'memo' } : { name: nm, type: 'text', len: len ? Math.min(255, Math.max(+len[1], max)) : max };
        }
        fields.push(f); keep.push(col.name);
      });
      if (info.length > D.LIMITS.maxFields) loss.add('too-many-fields', 'lossy', `${tn}: only the first ${D.LIMITS.maxFields} columns were imported`, info.length - D.LIMITS.maxFields);
      if (!fields.length) { loss.add('empty-table', 'warn', `${tn}: no usable columns`); continue; }
      const tname = IO.fieldName(tn, used, loss, db.tables.length);
      const t = db.createTable(tname, fields);
      let prec = 0;
      for (const r of rows) {
        t.rows.push(fields.map((f, i) => {
          let v = r[keep[i]]; if (v === null || v === undefined) return null;
          if (f.type === 'bool') return Number(v) !== 0 && String(v).toLowerCase() !== 'false';
          if (f.type === 'num') { const x = Number(v); const c = D.coerce(f, x); if (c !== x) prec++; return c; }
          if (f.type === 'date') return D.parseDate(String(v));
          return D.coerce(f, f.type === 'int' ? Number(v) : String(v), { truncate: true });
        }));
      }
      t._dirty();
      if (prec) loss.add('num-precision', 'info', `${tname}: numbers were rounded to 10 significant digits (BCD)`, prec);
      for (const ix of sdb.prepare(`SELECT name, "unique" u FROM pragma_index_list(${qs(tn)}) WHERE origin = 'c'`).all()) {
        try {
          const cols = sdb.prepare(`SELECT name FROM pragma_index_info(${qs(ix.name)}) ORDER BY seqno`).all().map((c) => c.name);
          const mapped = cols.map((c) => { const k = keep.indexOf(c); return k < 0 ? null : fields[k].name; });
          if (mapped.includes(null) || mapped.length > 4) throw new Error('uses a column xCBase did not import');
          t.createIndex({ name: IO.fieldName(ix.name, new Set(t.indexes.map((x) => x.name.toLowerCase())), loss, 0), fields: mapped, unique: !!ix.u });
        } catch (e) { loss.add('index-skipped', 'info', `${tname}: index ${ix.name}: ${e.message}`); }
      }
    }
  } finally { sdb.close(); }
  if (!db.tables.length) loss.add('empty', 'warn', 'the database has no tables');
  return { db, loss: loss.list };
}

// Writes the whole database. With a path it creates the file (refuses to overwrite unless opts.overwrite); without one it returns the bytes.
function exportSqlite(db, file, opts) {
  opts = opts || {};
  const { DatabaseSync } = sqlite(), loss = new IO.Loss();
  const sdb = new DatabaseSync(':memory:');
  try {
    sdb.exec('BEGIN');
    for (const t of db.tables) {
      const ty = (f) => (f.type === 'int' ? 'INTEGER' : f.type === 'num' ? 'REAL' : f.type === 'text' ? `VARCHAR(${f.len})` : f.type === 'date' ? 'DATE' : f.type === 'bool' ? 'BOOLEAN' : 'TEXT');
      sdb.exec(`CREATE TABLE ${qid(t.name)} (${t.fields.map((f) => qid(f.name) + ' ' + ty(f)).join(', ')})`);
      const ins = sdb.prepare(`INSERT INTO ${qid(t.name)} VALUES (${t.fields.map(() => '?').join(', ')})`);
      for (const r of t.rows) ins.run(...r.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)));
      for (const x of t.indexes) sdb.exec(`CREATE ${x.unique ? 'UNIQUE ' : ''}INDEX ${qid(t.name + '_' + x.name)} ON ${qid(t.name)} (${x.fields.map((n, i) => qid(n) + (x.desc[i] ? ' DESC' : '')).join(', ')})`);
    }
    sdb.exec('COMMIT');
    if (db.forms.length || db.reports.length) loss.add('forms-reports', 'lossy', 'forms and reports are not stored in SQLite');
    const bytes = sdb.serialize();
    if (file) { if (fs.existsSync(file) && !opts.overwrite) throw new D.DBError('exists', 'the file exists: ' + file); fs.writeFileSync(file, bytes); }
    return { bytes, loss: loss.list };
  } finally { sdb.close(); }
}

module.exports = { importSqlite, exportSqlite };
