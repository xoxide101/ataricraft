'use strict';
// dbcore: the xCBase engine. Typed tables, records, sorted indexes, find/filter/sort, a SELECT-subset query language,
// form and report definitions, mail-merge helpers and the JSON twin of the .xcd file. Machine independent: no I/O,
// no Node-only modules, so scripts/xcbase-sync-core.cjs can bundle it for the browser. See docs/XCBASE.md.

class DBError extends Error {
  constructor(code, message) { super(message); this.name = 'DBError'; this.code = code; }
}
const fail = (code, msg) => { throw new DBError(code, msg); };

const TYPES = ['text', 'int', 'num', 'date', 'bool', 'memo'];
const LIMITS = { nameLen: 10, maxText: 255, maxFields: 64, int: [-2147483648, 2147483647], numMax: 9.9999999999e97, numMin: 1e-99, maxMemo: 32000 };
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------- values
function isDate(y, m, d) {
  if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1)) return false;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[m - 1];
}
function parseDate(v) {
  if (v instanceof Date) v = v.getFullYear() + '-' + (v.getMonth() + 1) + '-' + v.getDate();
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m || !isDate(+m[1], +m[2], +m[3])) return null;
  return String(m[1]).padStart(4, '0') + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
}
const roundNum = (x) => { if (x === 0) return 0; const r = Number(x.toPrecision(10)); return Math.abs(r) < LIMITS.numMin ? 0 : r; };

// Convert v to the stored form of a field. opts.truncate: cut over-long text instead of failing.
function coerce(f, v, opts) {
  if (v === null || v === undefined) return null;
  switch (f.type) {
    case 'text': case 'memo': {
      let s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v instanceof Date ? parseDate(v) : String(v);
      s = s.replace(/\0/g, '');
      const max = f.type === 'text' ? f.len : LIMITS.maxMemo;
      if (s.length > max) { if (opts && opts.truncate) s = s.slice(0, max); else fail('too-long', `${f.name}: ${s.length} characters, the field holds ${max}`); }
      return s;
    }
    case 'int': {
      if (typeof v === 'string') { if (v.trim() === '') return null; v = Number(v); }
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) fail('bad-value', `${f.name}: not an integer`);
      if (v < LIMITS.int[0] || v > LIMITS.int[1]) fail('out-of-range', `${f.name}: ${v} does not fit 32 bits`);
      return v === 0 ? 0 : v;
    }
    case 'num': {
      if (typeof v === 'string') { if (v.trim() === '') return null; v = Number(v.replace(/,/g, '')); }
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v)) fail('bad-value', `${f.name}: not a number`);
      if (Math.abs(v) > LIMITS.numMax) fail('out-of-range', `${f.name}: ${v} is beyond the BCD range`);
      return roundNum(v);
    }
    case 'date': {
      if (typeof v === 'string' && v.trim() === '') return null;
      const d = parseDate(v);
      if (!d) fail('bad-value', `${f.name}: not a date (use YYYY-MM-DD)`);
      return d;
    }
    case 'bool': {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v).trim().toLowerCase();
      if (s === '') return null;
      if (['t', 'true', 'y', 'yes', '1', '.t.'].includes(s)) return true;
      if (['f', 'false', 'n', 'no', '0', '.f.'].includes(s)) return false;
      return fail('bad-value', `${f.name}: not a yes/no value`);
    }
  }
  return fail('bad-type', 'unknown type ' + f.type);
}

const typeRank = (v) => (v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : 3);
// null sorts first; text is compared case-insensitively, then by code point so the order is total
function cmp(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const ta = typeRank(a), tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  if (typeof a === 'string') {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpCI(a, b) { // like cmp but text that differs only in case is equal (used for = and index seeks)
  if (typeof a === 'string' && typeof b === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return cmp(a, b);
}
const eq = (a, b) => cmpCI(a, b) === 0;

function recordBytes(fields) { // size of one record in the .xcd binary (docs/XCBASE.md)
  let n = 1 + Math.ceil(fields.length / 8);
  for (const f of fields) n += f.type === 'text' ? f.len : f.type === 'int' ? 4 : f.type === 'num' ? 6 : f.type === 'date' ? 4 : f.type === 'bool' ? 1 : 2;
  return n;
}

// ---------------------------------------------------------------- table
function normField(f) {
  if (!f || typeof f.name !== 'string' || !IDENT.test(f.name)) fail('bad-name', 'field names are letters, digits and _, not starting with a digit: ' + (f && f.name));
  if (f.name.length > LIMITS.nameLen) fail('bad-name', `field name "${f.name}" is longer than ${LIMITS.nameLen} characters`);
  if (!TYPES.includes(f.type)) fail('bad-type', `field ${f.name}: type must be one of ${TYPES.join(', ')}`);
  const o = { name: f.name, type: f.type };
  if (f.type === 'text') {
    const len = f.len === undefined ? 30 : f.len;
    if (!Number.isInteger(len) || len < 1 || len > LIMITS.maxText) fail('bad-length', `field ${f.name}: text length 1..${LIMITS.maxText}`);
    o.len = len;
  }
  return o;
}

class Table {
  constructor(name, fields) {
    if (!IDENT.test(name || '')) fail('bad-name', 'table names are letters, digits and _: ' + name);
    if (name.length > LIMITS.nameLen) fail('bad-name', `table name "${name}" is longer than ${LIMITS.nameLen} characters`);
    if (!fields || !fields.length) fail('bad-schema', 'a table needs at least one field');
    if (fields.length > LIMITS.maxFields) fail('bad-schema', `at most ${LIMITS.maxFields} fields`);
    this.name = name; this.fields = fields.map(normField); this.rows = []; this.indexes = []; this.version = 0;
    const seen = new Set();
    for (const f of this.fields) { const k = f.name.toLowerCase(); if (seen.has(k)) fail('bad-schema', 'duplicate field ' + f.name); seen.add(k); }
  }
  col(name) {
    const k = String(name).toLowerCase();
    for (let i = 0; i < this.fields.length; i++) if (this.fields[i].name.toLowerCase() === k) return i;
    return fail('no-field', `table ${this.name} has no field ${name}`);
  }
  hasCol(name) { try { this.col(name); return true; } catch (e) { return false; } }
  get length() { return this.rows.length; }
  _dirty() { this.version++; for (const ix of this.indexes) ix.perm = null; }
  _row(rec, opts) {
    const row = new Array(this.fields.length).fill(null);
    if (Array.isArray(rec)) {
      if (rec.length > this.fields.length) fail('bad-record', 'more values than fields');
      rec.forEach((v, i) => { row[i] = coerce(this.fields[i], v, opts); });
    } else {
      for (const k of Object.keys(rec)) { const i = this.col(k); row[i] = coerce(this.fields[i], rec[k], opts); }
    }
    return row;
  }
  _checkUnique(row, skip) {
    for (const ix of this.indexes) {
      if (!ix.unique) continue;
      const cols = ix.fields.map((n) => this.col(n)), key = cols.map((c) => row[c]);
      if (key.some((v) => v === null)) continue;
      for (let i = 0; i < this.rows.length; i++) if (i !== skip && cols.every((c, j) => eq(this.rows[i][c], key[j]))) fail('duplicate-key', `index ${ix.name} already has ${key.join(', ')}`);
    }
  }
  insert(rec, opts) {
    const row = this._row(rec, opts);
    this._checkUnique(row, -1);
    this.rows.push(row); this._dirty();
    return this.rows.length - 1;
  }
  insertAt(i, row) { this.rows.splice(i, 0, row.slice()); this._dirty(); }
  get(i) { const r = this.rows[i]; if (!r) return fail('no-record', 'no record ' + i); return this.toObject(r); }
  toObject(row) { const o = {}; this.fields.forEach((f, i) => { o[f.name] = row[i]; }); return o; }
  update(i, patch, opts) {
    const old = this.rows[i]; if (!old) fail('no-record', 'no record ' + i);
    const row = old.slice();
    for (const k of Object.keys(patch)) { const c = this.col(k); row[c] = coerce(this.fields[c], patch[k], opts); }
    this._checkUnique(row, i);
    this.rows[i] = row; this._dirty();
    return old;
  }
  delete(i) { if (!this.rows[i]) fail('no-record', 'no record ' + i); const [old] = this.rows.splice(i, 1); this._dirty(); return old; }
  setRow(i, row) { this.rows[i] = row.slice(); this._dirty(); }

  addField(def, fill) {
    if (this.fields.length >= LIMITS.maxFields) fail('bad-schema', `at most ${LIMITS.maxFields} fields`);
    const f = normField(def);
    if (this.hasCol(f.name)) fail('bad-schema', 'duplicate field ' + f.name);
    const v = fill === undefined ? null : coerce(f, fill);
    this.fields.push(f); for (const r of this.rows) r.push(v); this._dirty();
    return this.fields.length - 1;
  }
  dropField(name) {
    const c = this.col(name);
    if (this.fields.length === 1) fail('bad-schema', 'cannot drop the last field');
    const nm = this.fields[c].name.toLowerCase();
    this.indexes = this.indexes.filter((ix) => !ix.fields.some((n) => n.toLowerCase() === nm));
    this.fields.splice(c, 1); for (const r of this.rows) r.splice(c, 1); this._dirty();
  }

  // ----- indexes: sorted permutations of record positions, rebuilt lazily
  createIndex(def) {
    if (!def || !IDENT.test(def.name || '')) fail('bad-name', 'index name');
    if (def.name.length > LIMITS.nameLen) fail('bad-name', 'index name too long');
    if (this.indexes.some((x) => x.name.toLowerCase() === def.name.toLowerCase())) fail('bad-schema', 'duplicate index ' + def.name);
    const fields = [].concat(def.fields || []).map((n) => this.fields[this.col(n)].name);
    if (!fields.length || fields.length > 4) fail('bad-schema', 'an index has 1 to 4 fields');
    const desc = fields.map((_, i) => !!(def.desc && def.desc[i]));
    const ix = { name: def.name, fields, desc, unique: !!def.unique, perm: null };
    if (ix.unique) { const keys = new Set(); for (const r of this.rows) { const k = JSON.stringify(fields.map((n) => { const v = r[this.col(n)]; return typeof v === 'string' ? v.toLowerCase() : v; })); if (!k.includes('null') && keys.has(k)) fail('duplicate-key', 'existing records already repeat a key of ' + def.name); keys.add(k); } }
    this.indexes.push(ix);
    return ix;
  }
  dropIndex(name) { const n = this.indexes.findIndex((x) => x.name.toLowerCase() === String(name).toLowerCase()); if (n < 0) fail('no-index', 'no index ' + name); this.indexes.splice(n, 1); }
  index(name) { const ix = this.indexes.find((x) => x.name.toLowerCase() === String(name).toLowerCase()); return ix || fail('no-index', 'no index ' + name); }
  _cmpRows(cols, desc) {
    return (a, b) => {
      for (let k = 0; k < cols.length; k++) { const c = cmp(this.rows[a][cols[k]], this.rows[b][cols[k]]); if (c) return desc[k] ? -c : c; }
      return a - b;
    };
  }
  perm(ix) {
    if (typeof ix === 'string') ix = this.index(ix);
    if (!ix.perm) {
      const cols = ix.fields.map((n) => this.col(n));
      ix.perm = Array.from({ length: this.rows.length }, (_, i) => i).sort(this._cmpRows(cols, ix.desc));
    }
    return ix.perm;
  }
  // positions whose first N index fields equal key (key is an array or a single value), in index order
  seek(indexName, key) {
    const ix = this.index(indexName), p = this.perm(ix), cols = ix.fields.map((n) => this.col(n));
    key = [].concat(key === undefined ? [] : key).map((v, i) => (v === null ? null : coerce(this.fields[cols[i]], v)));
    if (key.length > cols.length) fail('bad-key', 'too many key values');
    const c = (pos) => { for (let k = 0; k < key.length; k++) { const d = cmpCI(this.rows[pos][cols[k]], key[k]); if (d) return ix.desc[k] ? -d : d; } return 0; };
    let lo = 0, hi = p.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c(p[m]) < 0) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < p.length && c(p[i]) === 0; i++) out.push(p[i]);
    return out;
  }
  find(field, value) { // uses an index that starts with the field when one exists
    const c = this.col(field), ix = this.indexes.find((x) => this.col(x.fields[0]) === c);
    if (ix) return this.seek(ix.name, [value]).sort((a, b) => a - b);
    const v = value === null ? null : coerce(this.fields[c], value);
    const out = []; for (let i = 0; i < this.rows.length; i++) if (eq(this.rows[i][c], v)) out.push(i);
    return out;
  }
  filter(pred) { const out = []; for (let i = 0; i < this.rows.length; i++) if (pred(this.toObject(this.rows[i]), i)) out.push(i); return out; }
  // order is a list of "field", "field DESC" or {field, desc}
  sort(order, positions) {
    const spec = [].concat(order).map((o) => (typeof o === 'string' ? { field: o.replace(/\s+(asc|desc)$/i, ''), desc: /\sdesc$/i.test(o) } : o));
    const cols = spec.map((o) => this.col(o.field)), desc = spec.map((o) => !!o.desc);
    const pos = (positions || this.rows.map((_, i) => i)).slice();
    return pos.sort(this._cmpRows(cols, desc));
  }
}

// ---------------------------------------------------------------- database
class Database {
  constructor(name) { this.name = name || 'database'; this.tables = []; this.forms = []; this.reports = []; }
  table(name) { const t = this.tables.find((x) => x.name.toLowerCase() === String(name).toLowerCase()); return t || fail('no-table', 'no table ' + name); }
  hasTable(name) { return this.tables.some((x) => x.name.toLowerCase() === String(name).toLowerCase()); }
  createTable(name, fields) {
    if (this.hasTable(name)) fail('bad-schema', 'duplicate table ' + name);
    const t = new Table(name, fields); this.tables.push(t); return t;
  }
  dropTable(name) { const t = this.table(name); this.tables.splice(this.tables.indexOf(t), 1); this.forms = this.forms.filter((f) => f.table.toLowerCase() !== t.name.toLowerCase()); this.reports = this.reports.filter((r) => r.table.toLowerCase() !== t.name.toLowerCase()); }
  query(sql, params) { return query(this, sql, params); }
}

// ---------------------------------------------------------------- query language (SELECT subset)
const KEYWORDS = new Set('SELECT DISTINCT FROM WHERE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET AS AND OR NOT LIKE IN BETWEEN IS NULL TRUE FALSE JOIN INNER LEFT OUTER ON'.split(' '));
const AGGS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === "'") {
      let s = ''; i++;
      for (;;) { if (i >= src.length) fail('syntax', 'unterminated string'); if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += src[i++]; }
      toks.push({ t: 'str', v: s }); continue;
    }
    if (ch === '"' || ch === '[') {
      const end = ch === '"' ? '"' : ']', j = src.indexOf(end, i + 1);
      if (j < 0) fail('syntax', 'unterminated name'); toks.push({ t: 'id', v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i)); toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); const up = m[0].toUpperCase(); toks.push(KEYWORDS.has(up) ? { t: 'kw', v: up } : { t: 'id', v: m[0], bare: true }); i += m[0].length; continue; }
    if (ch === ':' && /[A-Za-z_]/.test(src[i + 1] || '')) { const m = /^:[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); toks.push({ t: 'param', v: m[0].slice(1) }); i += m[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['<>', '!=', '<=', '>=', '||'].includes(two)) { toks.push({ t: 'op', v: two === '!=' ? '<>' : two }); i += 2; continue; }
    if ('=<>+-*/%(),.?;'.includes(ch)) { toks.push({ t: ch === '?' ? 'param' : 'op', v: ch === '?' ? null : ch }); i++; continue; }
    fail('syntax', 'unexpected character ' + ch);
  }
  return toks;
}

function parse(sql) {
  const toks = tokenize(sql); let p = 0, nparam = 0;
  const peek = () => toks[p] || { t: 'eof' };
  const isKw = (v) => peek().t === 'kw' && peek().v === v;
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const eatKw = (v) => { if (isKw(v)) { p++; return true; } return false; };
  const eatOp = (v) => { if (isOp(v)) { p++; return true; } return false; };
  const needKw = (v) => { if (!eatKw(v)) fail('syntax', `expected ${v} near ${show()}`); };
  const needOp = (v) => { if (!eatOp(v)) fail('syntax', `expected ${v} near ${show()}`); };
  const show = () => { const t = peek(); return t.t === 'eof' ? 'end of query' : String(t.v === null ? '?' : t.v); };
  const ident = () => { const t = peek(); if (t.t !== 'id') fail('syntax', `expected a name near ${show()}`); p++; return t.v; };

  function primary() {
    const t = peek();
    if (t.t === 'num') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'param') { p++; return t.v === null ? { k: 'param', i: nparam++ } : { k: 'param', name: t.v }; }
    if (t.t === 'kw' && t.v === 'NULL') { p++; return { k: 'lit', v: null }; }
    if (t.t === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) { p++; return { k: 'lit', v: t.v === 'TRUE' }; }
    if (eatOp('(')) { const e = expr(); needOp(')'); return e; }
    if (t.t === 'op' && t.v === '*') fail('syntax', '* is only allowed in the select list and COUNT(*)');
    if (t.t === 'id') {
      p++;
      if (isOp('(')) {
        p++; const name = t.v.toUpperCase(); const args = []; let distinct = false, star = false;
        if (AGGS.has(name)) { if (eatKw('DISTINCT')) distinct = true; if (isOp('*') && name === 'COUNT') { p++; star = true; } else args.push(expr()); } else if (!isOp(')')) { do args.push(expr()); while (eatOp(',')); }
        needOp(')');
        return AGGS.has(name) ? { k: 'agg', fn: name, arg: args[0], distinct, star } : { k: 'fn', fn: name, args };
      }
      if (eatOp('.')) { if (eatOp('*')) return { k: 'star', table: t.v }; return { k: 'col', table: t.v, name: ident() }; }
      return { k: 'col', name: t.v };
    }
    return fail('syntax', 'unexpected ' + show());
  }
  const unary = () => { if (eatOp('-')) return { k: 'neg', e: unary() }; if (eatOp('+')) return unary(); return primary(); };
  const binLevel = (ops, next) => () => { let l = next(); while (peek().t === 'op' && ops.includes(peek().v)) { const op = toks[p++].v; l = { k: 'bin', op, l, r: next() }; } return l; };
  const mul = binLevel(['*', '/', '%'], unary), add = binLevel(['+', '-'], mul), cat = binLevel(['||'], add);
  function comparison() {
    let l = cat();
    for (;;) {
      const t = peek();
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { p++; l = { k: 'bin', op: t.v, l, r: cat() }; continue; }
      let neg = false; const save = p;
      if (isKw('NOT')) { p++; neg = true; }
      if (eatKw('LIKE')) { l = { k: 'like', neg, l, r: cat() }; continue; }
      if (eatKw('IN')) { needOp('('); const list = []; do list.push(expr()); while (eatOp(',')); needOp(')'); l = { k: 'in', neg, l, list }; continue; }
      if (eatKw('BETWEEN')) { const a = cat(); needKw('AND'); const b = cat(); l = { k: 'between', neg, l, a, b }; continue; }
      if (neg) { p = save; break; }
      if (eatKw('IS')) { const n = eatKw('NOT'); needKw('NULL'); l = { k: 'isnull', neg: n, e: l }; continue; }
      break;
    }
    return l;
  }
  const not = () => (eatKw('NOT') ? { k: 'not', e: not() } : comparison());
  const and = () => { let l = not(); while (eatKw('AND')) l = { k: 'and', l, r: not() }; return l; };
  const or = () => { let l = and(); while (eatKw('OR')) l = { k: 'or', l, r: and() }; return l; };
  const expr = or;
  const tref = () => { const name = ident(); let alias = name; if (eatKw('AS')) alias = ident(); else if (peek().t === 'id') alias = ident(); return { name, alias }; };

  needKw('SELECT');
  const q = { distinct: false, items: [], from: null, joins: [], where: null, group: [], having: null, order: [], limit: null, offset: 0 };
  if (eatKw('DISTINCT')) q.distinct = true;
  if (isOp('*')) { p++; q.items.push({ e: { k: 'star' } }); } else {
    do {
      const e = expr(); let alias = null;
      if (eatKw('AS')) alias = ident(); else if (peek().t === 'id') alias = ident();
      q.items.push({ e, alias });
    } while (eatOp(','));
  }
  needKw('FROM'); q.from = tref();
  for (;;) {
    let left = false;
    if (isKw('LEFT')) { p++; eatKw('OUTER'); left = true; needKw('JOIN'); } else if (isKw('INNER')) { p++; needKw('JOIN'); } else if (!eatKw('JOIN')) break;
    const t = tref(); needKw('ON'); q.joins.push({ t, left, on: expr() });
  }
  if (eatKw('WHERE')) q.where = expr();
  if (eatKw('GROUP')) { needKw('BY'); do q.group.push(expr()); while (eatOp(',')); }
  if (eatKw('HAVING')) q.having = expr();
  if (eatKw('ORDER')) { needKw('BY'); do { const e = expr(); const desc = eatKw('DESC'); if (!desc) eatKw('ASC'); q.order.push({ e, desc }); } while (eatOp(',')); }
  if (eatKw('LIMIT')) { const t = peek(); if (t.t !== 'num') fail('syntax', 'LIMIT needs a number'); p++; q.limit = t.v; if (eatKw('OFFSET')) { const o = peek(); if (o.t !== 'num') fail('syntax', 'OFFSET needs a number'); p++; q.offset = o.v; } }
  eatOp(';');
  if (peek().t !== 'eof') fail('syntax', 'unexpected ' + show() + ' (one SELECT statement only)');
  q.nparam = nparam;
  return q;
}

const truthy = (v) => v === true || (typeof v === 'number' && v !== 0 && v === v);
const num = (v) => (v === null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : null);
const likeRe = (pat) => new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '[\\s\\S]') + '$', 'i');
const dateParts = (v) => { const d = typeof v === 'string' ? parseDate(v) : null; return d ? d.split('-').map(Number) : null; };

const FN = {
  UPPER: (a) => (a[0] === null ? null : String(a[0]).toUpperCase()), LOWER: (a) => (a[0] === null ? null : String(a[0]).toLowerCase()),
  LENGTH: (a) => (a[0] === null ? null : String(a[0]).length), LEN: (a) => FN.LENGTH(a),
  TRIM: (a) => (a[0] === null ? null : String(a[0]).trim()), LTRIM: (a) => (a[0] === null ? null : String(a[0]).replace(/^\s+/, '')), RTRIM: (a) => (a[0] === null ? null : String(a[0]).replace(/\s+$/, '')),
  SUBSTR: (a) => { if (a[0] === null) return null; const s = String(a[0]); let st = num(a[1]); if (st === null) return null; st = Math.trunc(st); const from = st > 0 ? st - 1 : Math.max(0, s.length + st); return a[2] === undefined ? s.slice(from) : s.substr(from, Math.max(0, num(a[2]))); },
  LEFT: (a) => (a[0] === null ? null : String(a[0]).slice(0, Math.max(0, num(a[1])))), RIGHT: (a) => { if (a[0] === null) return null; const s = String(a[0]), n = Math.max(0, num(a[1])); return n ? s.slice(-n) : ''; },
  ABS: (a) => (num(a[0]) === null ? null : Math.abs(num(a[0]))),
  ROUND: (a) => { const x = num(a[0]); if (x === null) return null; const d = a[1] === undefined ? 0 : num(a[1]), m = Math.pow(10, d); return roundNum(Math.round((x + Math.sign(x) * 1e-12) * m) / m); },
  INT: (a) => (num(a[0]) === null ? null : Math.trunc(num(a[0]))), FLOOR: (a) => (num(a[0]) === null ? null : Math.floor(num(a[0]))), CEIL: (a) => (num(a[0]) === null ? null : Math.ceil(num(a[0]))),
  COALESCE: (a) => { for (const v of a) if (v !== null && v !== undefined) return v; return null; }, IFNULL: (a) => (a[0] === null ? a[1] : a[0]),
  NULLIF: (a) => (eq(a[0], a[1]) ? null : a[0]), CONCAT: (a) => a.map((v) => (v === null ? '' : String(v))).join(''),
  YEAR: (a) => { const d = dateParts(a[0]); return d ? d[0] : null; }, MONTH: (a) => { const d = dateParts(a[0]); return d ? d[1] : null; }, DAY: (a) => { const d = dateParts(a[0]); return d ? d[2] : null; },
};

function sqlCmp(a, b) { return a === null || b === null ? null : cmpCI(a, b); }

// Run a SELECT. params: array for ? or object for :name. Returns {columns:[{name,type}], rows, plan}.
function query(db, sql, params) {
  const q = typeof sql === 'string' ? parse(sql) : sql;
  const P = params === undefined || params === null ? [] : params;
  const getParam = (n) => {
    if (n.name !== undefined) { if (Array.isArray(P) || !(n.name in P)) fail('param', 'missing parameter :' + n.name); return P[n.name]; }
    if (!Array.isArray(P) || n.i >= P.length) fail('param', 'missing parameter ' + (n.i + 1)); return P[n.i];
  };
  const refs = [q.from].concat(q.joins.map((j) => j.t)).map((r) => ({ alias: r.alias, table: db.table(r.name) }));
  const seenAlias = new Set(); for (const r of refs) { const a = r.alias.toLowerCase(); if (seenAlias.has(a)) fail('syntax', 'duplicate table name ' + r.alias + ' (use AS)'); seenAlias.add(a); }
  const resolve = (n) => {
    const hits = [];
    refs.forEach((r, ti) => {
      if (n.table && r.alias.toLowerCase() !== n.table.toLowerCase()) return;
      if (r.table.hasCol(n.name)) hits.push([ti, r.table.col(n.name)]);
    });
    if (!hits.length) fail('no-field', 'unknown field ' + (n.table ? n.table + '.' : '') + n.name);
    if (hits.length > 1) fail('ambiguous', 'ambiguous field ' + n.name + ' (qualify it with the table name)');
    return hits[0];
  };

  // compile an expression to fn(env) where env = {rows:[row per table], group:[env...]|null}
  let aliasMap = null;
  function comp(e, allowAgg) {
    switch (e.k) {
      case 'lit': return () => e.v;
      case 'param': return () => { const v = getParam(e); return v === undefined ? null : v; };
      case 'col': {
        if (!e.table && aliasMap && aliasMap.has(e.name.toLowerCase()) && !refs.some((r) => r.table.hasCol(e.name))) return aliasMap.get(e.name.toLowerCase());
        const [ti, ci] = resolve(e);
        return (env) => { const r = env.rows[ti]; return r ? r[ci] : null; };
      }
      case 'neg': { const f = comp(e.e, allowAgg); return (env) => { const v = num(f(env)); return v === null ? null : -v; }; }
      case 'not': { const f = comp(e.e, allowAgg); return (env) => { const v = f(env); return v === null ? null : !truthy(v); }; }
      case 'and': { const l = comp(e.l, allowAgg), r = comp(e.r, allowAgg); return (env) => { const a = l(env); if (a !== null && !truthy(a)) return false; const b = r(env); if (b !== null && !truthy(b)) return false; return a === null || b === null ? null : true; }; }
      case 'or': { const l = comp(e.l, allowAgg), r = comp(e.r, allowAgg); return (env) => { const a = l(env); if (a !== null && truthy(a)) return true; const b = r(env); if (b !== null && truthy(b)) return true; return a === null || b === null ? null : false; }; }
      case 'bin': {
        const l = comp(e.l, allowAgg), r = comp(e.r, allowAgg), op = e.op;
        if (op === '||') return (env) => { const a = l(env), b = r(env); return a === null || b === null ? null : String(a) + String(b); };
        if (['+', '-', '*', '/', '%'].includes(op)) return (env) => {
          const a = num(l(env)), b = num(r(env)); if (a === null || b === null) return null;
          if (op === '+') return roundNum(a + b); if (op === '-') return roundNum(a - b); if (op === '*') return roundNum(a * b);
          if (b === 0) return null; return op === '/' ? roundNum(a / b) : a % b;
        };
        return (env) => {
          const a = l(env), b = r(env); const c = sqlCmp(typeof a === 'string' && typeof b === 'number' ? num(a) === null ? a : num(a) : a, typeof b === 'string' && typeof a === 'number' ? num(b) === null ? b : num(b) : b);
          if (c === null) return null;
          return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
        };
      }
      case 'like': { const l = comp(e.l, allowAgg), r = comp(e.r, allowAgg); return (env) => { const a = l(env), b = r(env); if (a === null || b === null) return null; const m = likeRe(b).test(String(a)); return e.neg ? !m : m; }; }
      case 'in': {
        const l = comp(e.l, allowAgg), list = e.list.map((x) => comp(x, allowAgg));
        return (env) => { const a = l(env); if (a === null) return null; let nul = false; for (const f of list) { const b = f(env); if (b === null) nul = true; else if (eq(a, b)) return e.neg ? false : true; } return nul ? null : e.neg ? true : false; };
      }
      case 'between': {
        const l = comp(e.l, allowAgg), a = comp(e.a, allowAgg), b = comp(e.b, allowAgg);
        return (env) => { const x = l(env), lo = a(env), hi = b(env); if (x === null || lo === null || hi === null) return null; const m = cmpCI(x, lo) >= 0 && cmpCI(x, hi) <= 0; return e.neg ? !m : m; };
      }
      case 'isnull': { const f = comp(e.e, allowAgg); return (env) => { const n = f(env) === null; return e.neg ? !n : n; }; }
      case 'fn': {
        const f = FN[e.fn]; if (!f) fail('syntax', 'unknown function ' + e.fn);
        const args = e.args.map((x) => comp(x, allowAgg)); return (env) => f(args.map((g) => g(env)));
      }
      case 'agg': {
        if (!allowAgg) fail('syntax', e.fn + ' is not allowed here');
        const arg = e.star ? null : comp(e.arg, false);
        return (env) => {
          let vals = e.star ? env.group.map(() => 1) : env.group.map((g) => arg(g)).filter((v) => v !== null);
          if (e.distinct) { const seen = new Set(), o = []; for (const v of vals) { const k = typeof v + ':' + (typeof v === 'string' ? v.toLowerCase() : v); if (!seen.has(k)) { seen.add(k); o.push(v); } } vals = o; }
          if (e.fn === 'COUNT') return vals.length;
          if (!vals.length) return null;
          if (e.fn === 'MIN') return vals.reduce((a, b) => (cmp(b, a) < 0 ? b : a));
          if (e.fn === 'MAX') return vals.reduce((a, b) => (cmp(b, a) > 0 ? b : a));
          const ns = vals.map(num).filter((v) => v !== null); if (!ns.length) return null;
          const s = ns.reduce((a, b) => a + b, 0); return roundNum(e.fn === 'SUM' ? s : s / ns.length);
        };
      }
      default: return fail('syntax', 'cannot use ' + e.k + ' here');
    }
  }
  const hasAgg = (e) => !!e && typeof e === 'object' && (e.k === 'agg' || Object.keys(e).some((k) => (Array.isArray(e[k]) ? e[k].some(hasAgg) : e[k] && typeof e[k] === 'object' && hasAgg(e[k]))));

  // select list
  const items = [];
  for (const it of q.items) {
    if (it.e.k === 'star') {
      refs.forEach((r, ti) => {
        if (it.e.table && r.alias.toLowerCase() !== it.e.table.toLowerCase()) return;
        r.table.fields.forEach((f, ci) => items.push({ name: refs.length > 1 || it.e.table ? r.alias + '.' + f.name : f.name, type: f.type, agg: false, fn: (env) => (env.rows[ti] ? env.rows[ti][ci] : null) }));
      });
    } else {
      const grouped = hasAgg(it.e);
      let name = it.alias || (it.e.k === 'col' ? it.e.name : it.e.k === 'agg' ? it.e.fn.toLowerCase() + (it.e.star ? '(*)' : '') : 'expr' + (items.length + 1));
      let type = null;
      if (it.e.k === 'col') { const [ti, ci] = resolve(it.e); type = refs[ti].table.fields[ci].type; } else if (it.e.k === 'agg') type = it.e.fn === 'COUNT' ? 'int' : it.e.fn === 'MIN' || it.e.fn === 'MAX' ? null : 'num';
      items.push({ name, type, agg: grouped, expr: it.e, alias: it.alias });
    }
  }
  const anyAgg = items.some((i) => i.agg) || hasAgg(q.having) || q.order.some((o) => hasAgg(o.e));
  const grouping = anyAgg || q.group.length > 0;
  aliasMap = new Map();
  items.forEach((i) => { if (i.expr) i.fn = comp(i.expr, grouping); });
  items.forEach((i) => { if (i.alias) aliasMap.set(i.alias.toLowerCase(), i.fn); });
  if (grouping && q.items.some((i) => i.e.k === 'star')) fail('syntax', '* cannot be combined with GROUP BY or aggregates');
  const where = q.where ? comp(q.where, false) : null;
  const groupBy = q.group.map((g) => comp(g, false));
  const having = q.having ? comp(q.having, true) : null;
  const order = q.order.map((o) => {
    if (o.e.k === 'lit' && typeof o.e.v === 'number') { const it = items[o.e.v - 1]; if (!it) fail('syntax', 'ORDER BY position ' + o.e.v + ' is out of range'); return { f: it.fn, desc: o.desc }; }
    return { f: comp(o.e, grouping), desc: o.desc };
  });
  const joinOn = q.joins.map((j) => comp(j.on, false));

  // scan: single table can use an index for col = constant
  let plan = 'scan', candidates = null;
  if (!q.joins.length && q.where) {
    const t = refs[0].table, conj = [], walk = (e) => { if (e.k === 'and') { walk(e.l); walk(e.r); } else conj.push(e); };
    walk(q.where);
    for (const c of conj) {
      if (c.k !== 'bin' || c.op !== '=') continue;
      const side = (a, b) => (a.k === 'col' && (b.k === 'lit' || b.k === 'param') ? [a, b] : null), m = side(c.l, c.r) || side(c.r, c.l);
      if (!m) continue;
      const [ti, ci] = resolve(m[0]); if (ti !== 0) continue;
      const ix = t.indexes.find((x) => t.col(x.fields[0]) === ci);
      if (!ix) continue;
      const v = m[1].k === 'lit' ? m[1].v : getParam(m[1]);
      if (v === null || v === undefined) continue;
      try { candidates = t.seek(ix.name, [v]).sort((a, b) => a - b); plan = 'index:' + ix.name; break; } catch (e) { candidates = null; }
    }
  }
  let envs = [];
  const base = refs[0].table.rows;
  const first = candidates || base.map((_, i) => i);
  for (const i of first) envs.push({ rows: [base[i]] });
  refs.slice(1).forEach((r, ji) => {
    const j = q.joins[ji], out = [], rows = r.table.rows;
    for (const env of envs) {
      let hit = false;
      for (const row of rows) { const e2 = { rows: env.rows.concat([row]) }; if (truthy(joinOn[ji](e2))) { out.push(e2); hit = true; } }
      if (!hit && j.left) out.push({ rows: env.rows.concat([null]) });
    }
    envs = out;
  });
  if (where) envs = envs.filter((e) => truthy(where(e)));

  let out; // [{vals, keys}]
  if (grouping) {
    const groups = new Map();
    for (const env of envs) { const k = groupBy.length ? JSON.stringify(groupBy.map((g) => { const v = g(env); return typeof v === 'string' ? v.toLowerCase() : v; })) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(env); }
    if (!groups.size && !groupBy.length) groups.set('', []);
    out = [];
    for (const list of groups.values()) {
      const env = { rows: list.length ? list[0].rows : refs.map(() => null), group: list };
      if (having && !truthy(having(env))) continue;
      out.push({ vals: items.map((i) => i.fn(env)), keys: order.map((o) => o.f(env)) });
    }
  } else out = envs.map((env) => ({ vals: items.map((i) => i.fn(env)), keys: order.map((o) => o.f(env)) }));

  if (q.distinct) { const seen = new Set(); out = out.filter((r) => { const k = JSON.stringify(r.vals.map((v) => (typeof v === 'string' ? v.toLowerCase() : v))); if (seen.has(k)) return false; seen.add(k); return true; }); }
  if (order.length) out = out.map((r, i) => [r, i]).sort((a, b) => { for (let k = 0; k < order.length; k++) { const c = cmp(a[0].keys[k], b[0].keys[k]); if (c) return order[k].desc ? -c : c; } return a[1] - b[1]; }).map((x) => x[0]);
  let rows = out.map((r) => r.vals);
  if (q.offset) rows = rows.slice(q.offset);
  if (q.limit !== null) rows = rows.slice(0, q.limit);
  const columns = items.map((it, ci) => {
    let type = it.type;
    if (!type) { for (const r of rows) { const v = r[ci]; if (v !== null) { type = typeof v === 'number' ? (Number.isInteger(v) ? 'num' : 'num') : typeof v === 'boolean' ? 'bool' : 'text'; break; } } }
    return { name: it.name, type: type || 'text' };
  });
  return { columns, rows, plan, count: rows.length };
}

// ---------------------------------------------------------------- forms and reports (definitions are plain JSON)
const FORM_COLS = 64, FORM_ROWS = 22; // the Atari 64-column text screen assumed for ACBase (see docs/XCBASE.md)

function defaultForm(table) {
  const t = table.fields ? table : null;
  const fields = t.fields.map((f, i) => ({ field: f.name, label: f.name, row: i + 1, col: 1, width: Math.min(f.type === 'text' ? f.len : f.type === 'memo' ? 40 : 12, FORM_COLS - 14) }));
  return { name: t.name, table: t.name, title: t.name, fields };
}
function checkForm(db, f) {
  const out = [];
  if (!f || !IDENT.test(f.name || '')) return ['form name'];
  if (!db.hasTable(f.table)) return ['form ' + f.name + ': no table ' + f.table];
  const t = db.table(f.table);
  for (const x of f.fields || []) {
    if (!t.hasCol(x.field)) out.push(`form ${f.name}: no field ${x.field}`);
    if (!(x.row >= 0 && x.row < FORM_ROWS)) out.push(`form ${f.name}: ${x.field} row ${x.row} is outside the ${FORM_ROWS}-line screen`);
    if (!(x.col >= 0 && x.col + (x.width || 1) <= FORM_COLS)) out.push(`form ${f.name}: ${x.field} runs past column ${FORM_COLS}`);
  }
  return out;
}
function checkReport(db, r) {
  const out = [];
  if (!r || !IDENT.test(r.name || '')) return ['report name'];
  if (!db.hasTable(r.table)) return ['report ' + r.name + ': no table ' + r.table];
  const t = db.table(r.table);
  for (const c of r.columns || []) if (c.field && !t.hasCol(c.field) && !r.query) out.push(`report ${r.name}: no field ${c.field}`);
  if (r.query) { try { parse(r.query); } catch (e) { out.push(`report ${r.name}: query: ${e.message}`); } }
  if (r.groupBy && !t.hasCol(r.groupBy) && !r.query) out.push(`report ${r.name}: no group field ${r.groupBy}`);
  return out;
}

function fmtValue(v, type, col) {
  if (v === null || v === undefined) return '';
  if (type === 'bool') return v ? 'Yes' : 'No';
  if (type === 'num' || type === 'int') { const d = col && col.decimals !== undefined ? col.decimals : null; return d === null ? String(v) : v.toFixed(d); }
  return String(v);
}

// Run a report definition: {name, table, query?, title, columns:[{field,label,width,align,decimals,sum}], orderBy, groupBy}
function runReport(db, rep, params) {
  const errs = checkReport(db, rep); if (errs.length) fail('bad-report', errs.join('; '));
  let columns, rows;
  if (rep.query) { const r = query(db, rep.query, params); columns = r.columns; rows = r.rows; } else {
    const t = db.table(rep.table), cols = (rep.columns && rep.columns.length ? rep.columns : t.fields.map((f) => ({ field: f.name }))).map((c) => c.field);
    columns = cols.map((n) => ({ name: t.fields[t.col(n)].name, type: t.fields[t.col(n)].type }));
    let pos = t.rows.map((_, i) => i);
    const ord = [].concat(rep.groupBy ? [rep.groupBy] : [], rep.orderBy || []);
    if (ord.length) pos = t.sort(ord, pos);
    rows = pos.map((i) => cols.map((n) => t.rows[i][t.col(n)]));
  }
  const spec = (rep.columns && rep.columns.length ? rep.columns : columns.map((c) => ({ field: c.name }))).map((c, i) => Object.assign({ label: columns[i].name, type: columns[i].type }, c));
  const gi = rep.groupBy ? columns.findIndex((c) => c.name.toLowerCase() === rep.groupBy.toLowerCase()) : -1;
  const total = (list) => spec.map((c, i) => (c.sum && (columns[i].type === 'num' || columns[i].type === 'int') ? roundNum(list.reduce((a, r) => a + (typeof r[i] === 'number' ? r[i] : 0), 0)) : null));
  const groups = [];
  if (gi >= 0) { for (const r of rows) { const last = groups[groups.length - 1]; if (last && eq(last.key, r[gi])) last.rows.push(r); else groups.push({ key: r[gi], rows: [r] }); } } else groups.push({ key: null, rows });
  for (const g of groups) g.totals = total(g.rows);
  return { title: rep.title || rep.name, columns: spec, groups, totals: total(rows), count: rows.length, grouped: gi >= 0 };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function reportHTML(res, opts) {
  opts = opts || {};
  const al = (c) => (c.align || (c.type === 'num' || c.type === 'int' ? 'right' : 'left'));
  const cell = (c, v) => `<td style="text-align:${al(c)}">${escHtml(fmtValue(v, c.type, c))}</td>`;
  let h = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(res.title)}</title><style>body{font:12pt Georgia,serif;margin:1.5cm}h1{font-size:18pt}table{border-collapse:collapse;width:100%}th,td{padding:2px 8px;border-bottom:1px solid #bbb}th{border-bottom:2px solid #000;text-align:left}tr.sub td,tr.tot td{font-weight:bold;border-top:1px solid #000}h2{font-size:13pt;margin:14px 0 2px}@media print{body{margin:0}}</style></head><body><h1>${escHtml(res.title)}</h1>`;
  h += '<table><thead><tr>' + res.columns.map((c) => `<th style="text-align:${al(c)}">${escHtml(c.label)}</th>`).join('') + '</tr></thead><tbody>';
  for (const g of res.groups) {
    if (res.grouped) h += `<tr><td colspan="${res.columns.length}"><h2>${escHtml(g.key === null ? '(none)' : String(g.key))}</h2></td></tr>`;
    for (const r of g.rows) h += '<tr>' + res.columns.map((c, i) => cell(c, r[i])).join('') + '</tr>';
    if (res.grouped && g.totals.some((x) => x !== null)) h += '<tr class="sub">' + res.columns.map((c, i) => (g.totals[i] === null ? '<td></td>' : cell(c, g.totals[i]))).join('') + '</tr>';
  }
  if (res.totals.some((x) => x !== null)) h += '<tr class="tot">' + res.columns.map((c, i) => (res.totals[i] === null ? '<td></td>' : cell(c, res.totals[i]))).join('') + '</tr>';
  return h + `</tbody></table><p style="color:#666;font-size:9pt">${res.count} record${res.count === 1 ? '' : 's'}${opts.footer ? ' &middot; ' + escHtml(opts.footer) : ''}</p></body></html>`;
}
function reportText(res, width) { // fixed-width listing, the shape an Atari print job takes
  width = width || 80;
  const n = res.columns.length, w = res.columns.map((c, i) => Math.max(c.label.length, c.width || 0, ...res.groups.flatMap((g) => g.rows.map((r) => fmtValue(r[i], c.type, c).length))));
  const fit = (s, c, k) => { s = s.slice(0, w[k]); return c.type === 'num' || c.type === 'int' || c.align === 'right' ? s.padStart(w[k]) : s.padEnd(w[k]); };
  const line = (cells) => cells.join(' ').replace(/\s+$/, '').slice(0, width);
  const out = [res.title, '', line(res.columns.map((c, i) => fit(c.label, c, i))), '-'.repeat(Math.min(width, w.reduce((a, b) => a + b, 0) + n - 1))];
  for (const g of res.groups) {
    if (res.grouped) out.push('', String(g.key === null ? '(none)' : g.key));
    for (const r of g.rows) out.push(line(res.columns.map((c, i) => fit(fmtValue(r[i], c.type, c), c, i))));
    if (res.grouped && g.totals.some((x) => x !== null)) out.push(line(res.columns.map((c, i) => fit(g.totals[i] === null ? '' : fmtValue(g.totals[i], c.type, c), c, i))));
  }
  if (res.totals.some((x) => x !== null)) out.push('-'.repeat(Math.min(width, w.reduce((a, b) => a + b, 0) + n - 1)), line(res.columns.map((c, i) => fit(res.totals[i] === null ? '' : fmtValue(res.totals[i], c.type, c), c, i))));
  out.push('', res.count + ' record' + (res.count === 1 ? '' : 's'));
  return out.join('\n');
}

// ---------------------------------------------------------------- mail merge
// Fields in a template are written <<Name>> (double angle brackets, ASCII so every machine can type them).
const MERGE_RE = /<<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>>/g;
const mergeFields = (text) => { const out = []; String(text).replace(MERGE_RE, (m, n) => { if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n); return m; }); return out; };
function mergeText(text, obj) { return String(text).replace(MERGE_RE, (m, n) => { const k = Object.keys(obj).find((x) => x.toLowerCase() === n.toLowerCase()); return k === undefined || obj[k] === null ? '' : typeof obj[k] === 'boolean' ? (obj[k] ? 'Yes' : 'No') : String(obj[k]); }); }

// ---------------------------------------------------------------- Atari limits (assumed ACBase constraints, docs/XCBASE.md)
const ATARI = { tables: 8, fields: 32, recordBytes: 254, indexes: 4, recordsPerTable: 65535, payload: 65535, forms: 8, reports: 8 };
function atariCheck(db, sizeBytes) {
  const items = [];
  const add = (level, msg) => items.push({ level, msg });
  if (db.tables.length > ATARI.tables) add('error', `${db.tables.length} tables; ACBase opens ${ATARI.tables}`);
  let total = 0;
  for (const t of db.tables) {
    const rb = recordBytes(t.fields); total += t.rows.length;
    if (t.fields.length > ATARI.fields) add('error', `${t.name}: ${t.fields.length} fields (limit ${ATARI.fields})`);
    if (rb > ATARI.recordBytes) add('error', `${t.name}: record is ${rb} bytes (limit ${ATARI.recordBytes})`);
    if (t.indexes.length > ATARI.indexes) add('error', `${t.name}: ${t.indexes.length} indexes (limit ${ATARI.indexes})`);
    if (t.rows.length > ATARI.recordsPerTable) add('error', `${t.name}: ${t.rows.length} records (limit ${ATARI.recordsPerTable})`);
    if (t.fields.some((f) => f.type === 'memo')) add('info', `${t.name}: memo fields live in a separate area; ACBase shows the first line only`);
  }
  if (db.forms.length > ATARI.forms) add('warn', `${db.forms.length} forms (ACBase reads ${ATARI.forms})`);
  if (db.reports.length > ATARI.reports) add('warn', `${db.reports.length} reports (ACBase reads ${ATARI.reports})`);
  if (sizeBytes !== undefined) add(sizeBytes > ATARI.payload ? 'error' : 'info', `file is ${sizeBytes} bytes (limit ${ATARI.payload})`);
  return { ok: !items.some((i) => i.level === 'error'), items, records: total };
}

// ---------------------------------------------------------------- JSON twin
function toJSON(db) {
  return {
    format: 'xcd-json', version: 1, name: db.name,
    tables: db.tables.map((t) => ({ name: t.name, fields: t.fields.map((f) => (f.type === 'text' ? { name: f.name, type: f.type, len: f.len } : { name: f.name, type: f.type })), indexes: t.indexes.map((x) => ({ name: x.name, fields: x.fields.slice(), desc: x.desc.slice(), unique: x.unique })), records: t.rows.map((r) => r.slice()) })),
    forms: db.forms, reports: db.reports,
  };
}
function fromJSON(j) {
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { fail('bad-json', 'not valid JSON: ' + e.message); } }
  if (!j || j.format !== 'xcd-json' || j.version !== 1) fail('bad-json', 'not an xcd-json file');
  const db = new Database(j.name);
  for (const tj of j.tables || []) {
    const t = db.createTable(tj.name, tj.fields);
    for (const r of tj.records || []) { if (!Array.isArray(r)) fail('bad-json', 'records are arrays'); t.rows.push(r.map((v, i) => (i < t.fields.length ? coerce(t.fields[i], v) : fail('bad-json', 'record too long')))); while (t.rows[t.rows.length - 1].length < t.fields.length) t.rows[t.rows.length - 1].push(null); }
    for (const x of tj.indexes || []) t.createIndex(x);
  }
  db.forms = JSON.parse(JSON.stringify(j.forms || [])); db.reports = JSON.parse(JSON.stringify(j.reports || []));
  const problems = db.forms.flatMap((f) => checkForm(db, f)).concat(db.reports.flatMap((r) => checkReport(db, r)));
  if (problems.length) fail('bad-json', problems.join('; '));
  return db;
}

module.exports = {
  DBError, TYPES, LIMITS, ATARI, FORM_COLS, FORM_ROWS, IDENT, Table, Database,
  coerce, cmp, cmpCI, eq, roundNum, parseDate, isDate, recordBytes, normField,
  parse, query, FN, defaultForm, checkForm, checkReport, runReport, reportHTML, reportText, fmtValue,
  mergeFields, mergeText, atariCheck, toJSON, fromJSON,
};
