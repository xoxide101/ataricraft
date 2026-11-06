'use strict';
// .xcd: Craft database. Binary = CRFT header (type 'D') + fixed-width payload (docs/XCBASE.md); JSON twin = dbcore.toJSON.
// The payload is laid out so a 6502 can seek record n: fixed record size, null bitmap, BCD-6 numbers, record count in the header, CRC-16 at the end.
const D = require('./dbcore.cjs');
const C = require('./calccore.cjs');

const MAGIC = [0x43, 0x52, 0x46, 0x54];
const TYPE_CODE = { text: 1, int: 2, num: 3, date: 4, bool: 5, memo: 6 };
const CODE_TYPE = [null, 'text', 'int', 'num', 'date', 'bool', 'memo'];
const MAXPAYLOAD = 0xffff;
const bad = (code, msg) => { throw new D.DBError(code, msg); };

function crc16(b, n) { let c = 0xffff; for (let i = 0; i < n; i++) { c ^= b[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
const sum16 = (b, o, n) => { let s = 0; for (let i = 0; i < n; i++) s = (s + b[o + i]) & 0xffff; return s; };

class Out {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); }
  u16(v) { this.a.push(v & 255, (v >> 8) & 255); }
  i32(v) { this.a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); }
  bytes(b) { for (const x of b) this.a.push(x); }
  get length() { return this.a.length; }
}
// Latin-1 only; counts what had to change
function latin1(s, st) {
  const out = [];
  for (const ch of String(s)) { const c = ch.codePointAt(0); if (c > 255) { out.push(63); st.nonLatin++; } else out.push(c); }
  return out;
}
const asciiJSON = (o) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function fieldSize(f) { return f.type === 'text' ? f.len : f.type === 'int' ? 4 : f.type === 'num' ? 6 : f.type === 'date' ? 4 : f.type === 'bool' ? 1 : 2; }

// returns {bytes, loss, info}
function toBinary(db) {
  const loss = [], st = { nonLatin: 0 };
  if (db.tables.length > 255) bad('xcd-too-big', 'at most 255 tables');
  const o = new Out();
  const name = latin1(db.name || '', st).slice(0, 255);
  o.u8(db.tables.length); o.u8(name.length); o.bytes(name);
  let totalRecords = 0, maxFields = 0;
  for (const t of db.tables) {
    const tn = latin1(t.name, st);
    const recSize = D.recordBytes(t.fields), nullBytes = Math.ceil(t.fields.length / 8);
    if (recSize > 0xffff) bad('xcd-too-big', `${t.name}: record is ${recSize} bytes`);
    if (t.rows.length > 0xffff) bad('xcd-too-big', `${t.name}: ${t.rows.length} records (limit 65535)`);
    const memos = [];
    o.u8(tn.length); o.bytes(tn); o.u8(t.fields.length); o.u8(t.indexes.length); o.u16(t.rows.length); o.u16(recSize);
    t.rows.forEach((r) => t.fields.forEach((f, i) => { if (f.type === 'memo' && r[i] !== null) memos.push(r[i]); }));
    o.u16(memos.length);
    totalRecords += t.rows.length; maxFields = Math.max(maxFields, t.fields.length);
    let off = 1 + nullBytes;
    for (const f of t.fields) {
      const nb = latin1(f.name, st); for (let i = 0; i < 10; i++) o.u8(nb[i] || 0);
      o.u8(TYPE_CODE[f.type]); o.u8(f.type === 'text' ? f.len : fieldSize(f)); o.u16(off); off += fieldSize(f);
    }
    for (const x of t.indexes) {
      const nb = latin1(x.name, st); for (let i = 0; i < 10; i++) o.u8(nb[i] || 0);
      o.u8(x.unique ? 1 : 0); o.u8(x.fields.length);
      for (let i = 0; i < 4; i++) o.u8(i < x.fields.length ? t.col(x.fields[i]) | (x.desc[i] ? 0x80 : 0) : 0);
    }
    let memoNo = 0;
    for (const r of t.rows) {
      o.u8(0);
      const nulls = new Array(nullBytes).fill(0); t.fields.forEach((f, i) => { if (r[i] === null) nulls[i >> 3] |= 1 << (i & 7); });
      o.bytes(nulls);
      t.fields.forEach((f, i) => {
        const v = r[i], isNull = v === null;
        if (f.type === 'text') { const b = isNull ? [] : latin1(v, st); for (let k = 0; k < f.len; k++) o.u8(b[k] || 0); } else if (f.type === 'int') o.i32(isNull ? 0 : v);
        else if (f.type === 'num') o.bytes(isNull || v === 0 ? [0, 0, 0, 0, 0, 0] : C.bcdEncode(v));
        else if (f.type === 'date') { if (isNull) o.i32(0); else { const p = v.split('-').map(Number); o.u16(p[0]); o.u8(p[1]); o.u8(p[2]); } } else if (f.type === 'bool') o.u8(v ? 1 : 0);
        else o.u16(isNull ? 0 : ++memoNo);
      });
    }
    for (const x of t.indexes) for (const p of t.perm(x)) o.u16(p);
    for (const m of memos) { const b = latin1(m, st); o.u16(b.length); o.bytes(b); }
  }
  const meta = db.forms.length || db.reports.length ? asciiJSON({ forms: db.forms, reports: db.reports }) : '';
  if (meta.length > 0xffff) bad('xcd-too-big', 'form and report definitions are over 65535 bytes');
  o.u16(meta.length); for (let i = 0; i < meta.length; i++) o.u8(meta.charCodeAt(i));
  const body = Uint8Array.from(o.a), crc = crc16(body, body.length);
  const plen = body.length + 2;
  if (plen > MAXPAYLOAD) bad('xcd-too-big', `the file would be ${plen + 16} bytes; the .xcd limit is ${MAXPAYLOAD + 16} (65535 payload bytes)`);
  const out = new Uint8Array(16 + plen);
  out.set(MAGIC, 0); out[4] = 1; out[5] = 0x44; out[6] = 0; out[7] = 0;
  out[8] = plen & 255; out[9] = plen >> 8; out[10] = Math.min(totalRecords, 0xffff) & 255; out[11] = Math.min(totalRecords, 0xffff) >> 8; out[12] = Math.min(maxFields, 255); out[13] = Math.min(db.tables.length, 255);
  out.set(body, 16); out[16 + body.length] = crc & 255; out[17 + body.length] = crc >> 8;
  const cs = sum16(out, 16, plen); out[14] = cs & 255; out[15] = cs >> 8;
  if (st.nonLatin) loss.push({ code: 'non-latin1-text', severity: 'lossy', count: st.nonLatin, detail: 'characters above U+00FF stored as ? in the binary; the JSON twin keeps them' });
  return { bytes: out, loss, info: { records: totalRecords, tables: db.tables.length, size: out.length } };
}

class In {
  constructor(b, p, end) { this.b = b; this.p = p; this.end = end; }
  need(n) { if (n < 0 || this.p + n > this.end) bad('xcd-corrupt', 'the file ends inside a table (damaged or truncated)'); }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  i32() { this.need(4); const v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24); this.p += 4; return v; }
  take(n) { this.need(n); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
}
const str = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const cstr = (b) => { let n = b.length; while (n && b[n - 1] === 0) n--; return str(b.subarray(0, n)); };

// returns {db, info:{warnings:[...]}}; throws DBError with code xcd-* on damaged files
function fromBinary(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (bytes.length < 16) bad('xcd-truncated', 'file is shorter than the 16-byte header');
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) bad('xcd-bad-magic', 'not a Craft file (no CRFT header)');
  if (bytes[4] !== 1) bad('xcd-bad-version', 'unsupported Craft version ' + bytes[4]);
  if (bytes[5] !== 0x44) bad('xcd-bad-type', 'not a Craft database (type ' + String.fromCharCode(bytes[5]) + ')');
  const plen = bytes[8] | (bytes[9] << 8);
  if (plen < 4 || bytes.length < 16 + plen) bad('xcd-truncated', `header says ${plen} payload bytes, the file has ${Math.max(0, bytes.length - 16)}`);
  if (sum16(bytes, 16, plen) !== (bytes[14] | (bytes[15] << 8))) bad('xcd-checksum', 'header checksum mismatch (damaged file)');
  const end = 16 + plen - 2, crc = bytes[end] | (bytes[end + 1] << 8);
  if (crc16(bytes.subarray(16, end), end - 16) !== crc) bad('xcd-crc', 'payload CRC mismatch (damaged file)');
  const warnings = [], r = new In(bytes, 16, end);
  const nTables = r.u8(), nameLen = r.u8();
  const db = new D.Database(str(r.take(nameLen)));
  for (let ti = 0; ti < nTables; ti++) {
    const tname = str(r.take(r.u8())), nf = r.u8(), ni = r.u8(), nrec = r.u16(), recSize = r.u16(), nmemo = r.u16();
    if (!nf) bad('xcd-corrupt', 'table with no fields');
    const defs = [];
    for (let i = 0; i < nf; i++) {
      const name = cstr(r.take(10)), code = r.u8(), size = r.u8(), off = r.u16(), type = CODE_TYPE[code];
      if (!type) bad('xcd-corrupt', 'unknown field type ' + code);
      defs.push({ name, type, len: size, off });
    }
    let t;
    try { t = db.createTable(tname, defs.map((d) => (d.type === 'text' ? { name: d.name, type: 'text', len: d.len } : { name: d.name, type: d.type }))); } catch (e) { bad('xcd-corrupt', 'bad table definition: ' + e.message); }
    let expect = 1 + Math.ceil(nf / 8); for (const f of t.fields) expect += fieldSize(f);
    if (expect !== recSize) bad('xcd-corrupt', `${tname}: record size ${recSize} does not match its fields (${expect})`);
    defs.forEach((d, i) => { if (d.type !== 'text' && d.len !== fieldSize(t.fields[i])) bad('xcd-corrupt', 'bad field size'); });
    const ixDefs = [];
    for (let i = 0; i < ni; i++) {
      const name = cstr(r.take(10)), fl = r.u8(), nk = r.u8(), ks = [r.u8(), r.u8(), r.u8(), r.u8()];
      if (nk < 1 || nk > 4 || ks.slice(0, nk).some((k) => (k & 0x7f) >= nf)) bad('xcd-corrupt', 'bad index definition');
      ixDefs.push({ name, unique: !!(fl & 1), fields: ks.slice(0, nk).map((k) => t.fields[k & 0x7f].name), desc: ks.slice(0, nk).map((k) => !!(k & 0x80)) });
    }
    const nb = Math.ceil(nf / 8), recs = [];
    const data = r.take(nrec * recSize), memoRefs = [];
    let deleted = 0;
    for (let n = 0; n < nrec; n++) {
      const base = n * recSize, row = new Array(nf).fill(null);
      if (data[base] & 1) { deleted++; continue; }
      let p = base + 1 + nb;
      t.fields.forEach((f, i) => {
        const isNull = !!(data[base + 1 + (i >> 3)] & (1 << (i & 7)));
        let v = null;
        if (f.type === 'text') { if (!isNull) v = cstr(data.subarray(p, p + f.len)); p += f.len; } else if (f.type === 'int') { if (!isNull) v = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24); p += 4; } else if (f.type === 'num') {
          if (!isNull) { for (let k = 1; k <= 5; k++) if ((data[p + k] >> 4) > 9 || (data[p + k] & 15) > 9) bad('xcd-corrupt', `${tname}.${f.name}: bad BCD number`); v = D.roundNum(C.bcdDecode(data, p)); } p += 6;
        } else if (f.type === 'date') { if (!isNull) { const y = data[p] | (data[p + 1] << 8), m = data[p + 2], d = data[p + 3]; if (!D.isDate(y, m, d)) bad('xcd-corrupt', `${tname}.${f.name}: bad date ${y}-${m}-${d}`); v = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); } p += 4; } else if (f.type === 'bool') { if (!isNull) v = data[p] !== 0; p += 1; } else { const mi = data[p] | (data[p + 1] << 8); if (!isNull && mi) memoRefs.push([row, i, mi]); p += 2; }
        row[i] = v;
      });
      recs.push(row);
    }
    if (deleted) warnings.push(`${tname}: ${deleted} deleted record${deleted === 1 ? '' : 's'} skipped`);
    const perms = ixDefs.map(() => { const a = []; for (let i = 0; i < nrec; i++) a.push(r.u16()); return a; });
    const memos = [];
    for (let i = 0; i < nmemo; i++) memos.push(str(r.take(r.u16())));
    for (const [row, i, mi] of memoRefs) { if (mi > memos.length) bad('xcd-corrupt', `${tname}: memo ${mi} is missing`); row[i] = memos[mi - 1]; }
    t.rows = recs;
    for (const d of ixDefs) { try { t.createIndex(d); } catch (e) { warnings.push(`${tname}: index ${d.name}: ${e.message}`); } }
    ixDefs.forEach((d, k) => {
      const ix = t.indexes.find((x) => x.name === d.name); if (!ix || deleted) return;
      const calc = t.perm(ix);
      if (perms[k].length !== calc.length || perms[k].some((v, i) => v !== calc[i])) warnings.push(`${tname}: index ${d.name} on file was out of date and was rebuilt`);
    });
  }
  const mlen = r.u16();
  if (mlen) {
    let meta; try { meta = JSON.parse(str(r.take(mlen))); } catch (e) { bad('xcd-corrupt', 'form and report definitions are damaged'); }
    db.forms = Array.isArray(meta.forms) ? meta.forms : []; db.reports = Array.isArray(meta.reports) ? meta.reports : [];
    const problems = db.forms.flatMap((f) => D.checkForm(db, f)).concat(db.reports.flatMap((x) => D.checkReport(db, x)));
    for (const p of problems) warnings.push(p);
  }
  if (r.p !== end) warnings.push(`${end - r.p} unused byte${end - r.p === 1 ? '' : 's'} after the last table`);
  return { db, info: { warnings, records: db.tables.reduce((a, t) => a + t.rows.length, 0) } };
}

// size of the binary without keeping it; used by the web app's Atari view
function sizeOf(db) { try { return toBinary(db).bytes.length; } catch (e) { return e.code === 'xcd-too-big' ? Infinity : bad(e.code, e.message); } }

module.exports = { toBinary, fromBinary, crc16, sum16, sizeOf, MAXPAYLOAD, TYPE_CODE, CODE_TYPE };
