'use strict';
// xCBase interchange: DBF (dBase III with optional .dbt memo), CSV and TSV. Pure JS (no Node modules) so the browser bundle uses it too.
// Every importer and exporter returns a loss report of {code, severity, count, detail}. SQLite import/export is Node only: tools/xcdsqlite.cjs.
const D = require('./dbcore.cjs');

const bad = (code, msg) => { throw new D.DBError(code, msg); };
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';
const dec1252 = (b) => new TextDecoder('windows-1252').decode(b);
const dec437 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += b[i] < 128 ? String.fromCharCode(b[i]) : CP437_HIGH[b[i] - 128]; return s; };
const latin1Bytes = (s, st) => { const o = []; for (const ch of String(s)) { const c = ch.codePointAt(0); if (c > 255) { o.push(63); st.n++; } else o.push(c); } return o; };

class Loss {
  constructor() { this.list = []; this.map = new Map(); }
  add(code, severity, detail, n) { const k = code + '|' + detail; const e = this.map.get(k); if (e) e.count += n || 1; else { const x = { code, severity, count: n || 1, detail }; this.map.set(k, x); this.list.push(x); } }
}

// ---------------------------------------------------------------- names
function fieldName(raw, used, loss, i) {
  let n = String(raw === undefined || raw === null ? '' : raw).trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) n = 'F' + (i + 1);
  if (!/^[A-Za-z_]/.test(n)) n = 'F' + n;
  n = n.slice(0, D.LIMITS.nameLen);
  let cand = n, k = 1;
  while (used.has(cand.toLowerCase())) { const sfx = String(++k); cand = n.slice(0, D.LIMITS.nameLen - sfx.length) + sfx; }
  used.add(cand.toLowerCase());
  if (cand !== String(raw)) loss.add('renamed-field', 'info', `"${raw}" became ${cand}`);
  return cand;
}

// ---------------------------------------------------------------- DBF
const DBF_TYPES = new Set(['C', 'N', 'F', 'D', 'L', 'M']);
function importDBF(bytes, opts) {
  opts = opts || {}; bytes = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const loss = new Loss();
  if (bytes.length < 33) bad('dbf-truncated', 'the file is too short to be a dBase file');
  const ver = bytes[0];
  if (![0x02, 0x03, 0x83, 0x8b, 0x30, 0xf5, 0x8e, 0xfb].includes(ver)) bad('dbf-bad-header', 'not a dBase file (version byte 0x' + ver.toString(16) + ')');
  if (ver !== 0x03 && ver !== 0x83) loss.add('dbf-version', 'warn', 'version 0x' + ver.toString(16) + ' is not dBase III; only the fields xCBase knows are read');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const nrec = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), lang = bytes[29];
  if (hlen < 33 || hlen > bytes.length || rlen < 2) bad('dbf-bad-header', 'damaged header (header length ' + hlen + ', record length ' + rlen + ')');
  const dec = lang === 0x01 || lang === 0x02 ? dec437 : dec1252;
  const defs = [];
  let p = 32;
  while (p + 32 <= hlen && bytes[p] !== 0x0d) {
    let n = 0; while (n < 11 && bytes[p + n]) n++;
    const name = String.fromCharCode(...bytes.subarray(p, p + n)), type = String.fromCharCode(bytes[p + 11]);
    defs.push({ name, type, len: bytes[p + 16], dec: bytes[p + 17] });
    p += 32;
  }
  if (bytes[p] !== 0x0d) bad('dbf-bad-header', 'field list is not terminated (damaged header)');
  if (!defs.length) bad('dbf-bad-header', 'no fields');
  let off = 1; const cols = [];
  for (const d of defs) { d.off = off; off += d.len; if (DBF_TYPES.has(d.type)) cols.push(d); else loss.add('dbf-field-type', 'lossy', `field ${d.name} has type ${d.type}, which xCBase does not read; the column was dropped`); }
  if (off > rlen) bad('dbf-bad-header', 'fields are wider than the record length');
  if (!cols.length) bad('dbf-bad-header', 'no usable fields');
  const avail = Math.floor((bytes.length - hlen) / rlen);
  let n = nrec;
  if (nrec > avail) { n = avail; loss.add('dbf-truncated', 'warn', `header says ${nrec} records, the file holds ${avail}`, nrec - avail); }
  const used = new Set(), memo = opts.memo ? (opts.memo instanceof Uint8Array ? opts.memo : Uint8Array.from(opts.memo)) : null;
  const raw = []; let deleted = 0, memoMiss = 0;
  for (let i = 0; i < n; i++) {
    const b = hlen + i * rlen;
    if (bytes[b] === 0x2a) { deleted++; continue; }
    const row = cols.map((d) => {
      const sl = bytes.subarray(b + d.off, b + d.off + d.len);
      if (d.type === 'M') {
        const ref = String.fromCharCode(...sl).trim(); if (!ref || !/^\d+$/.test(ref)) return null;
        if (!memo) { memoMiss++; return null; }
        const start = +ref * 512; if (start >= memo.length) { memoMiss++; return null; }
        let e = start; while (e < memo.length && memo[e] !== 0x1a) e++;
        return dec(memo.subarray(start, e)).replace(/\r\n/g, '\n').replace(/\x8d\n/g, '');
      }
      return d.type === 'C' ? dec(sl).replace(/[\s\0]+$/, '') : String.fromCharCode(...sl).trim();
    });
    raw.push(row);
  }
  if (deleted) loss.add('dbf-deleted', 'info', 'records marked deleted were not imported', deleted);
  if (memoMiss) loss.add('dbf-memo-missing', 'warn', 'memo text needs the .dbt file next to the .dbf', memoMiss);
  const fields = cols.map((d, ci) => {
    const name = fieldName(d.name, used, loss, ci);
    if (d.type === 'C') return { name, type: 'text', len: Math.max(1, Math.min(255, d.len)) };
    if (d.type === 'M') return { name, type: 'memo' };
    if (d.type === 'D') return { name, type: 'date' };
    if (d.type === 'L') return { name, type: 'bool' };
    const vals = raw.map((r) => r[ci]).filter((v) => v !== '');
    if (d.dec === 0 && d.type === 'N' && vals.every((v) => /^-?\d+$/.test(v) && Math.abs(+v) <= 2147483647)) return { name, type: 'int' };
    return { name, type: 'num' };
  });
  const db = new D.Database(opts.name || 'dbf');
  const t = db.createTable(opts.tableName || 'data', fields);
  let bad2 = 0;
  for (const r of raw) {
    const rec = r.map((v, i) => {
      const f = fields[i];
      if (f.type === 'text') return v;
      if (v === '' || (f.type === 'bool' && v === '?')) return null;
      if (f.type === 'memo') return v;
      if (f.type === 'bool') return /^[TtYy]$/.test(v);
      if (f.type === 'date') return D.parseDate(v) || (bad2++, null);
      const x = Number(v); return Number.isFinite(x) ? x : (bad2++, null);
    });
    if (t.rows.length >= 65535) { loss.add('too-many-records', 'lossy', 'only the first 65535 records were imported', 1); continue; }
    try { t.rows.push(rec.map((v, i) => D.coerce(fields[i], v, { truncate: true }))); } catch (e) { loss.add('bad-value', 'lossy', e.message); t.rows.push(rec.map((v, i) => { try { return D.coerce(fields[i], v, { truncate: true }); } catch (e2) { return null; } })); }
  }
  if (bad2) loss.add('bad-value', 'lossy', 'values that were not valid numbers or dates became empty', bad2);
  t._dirty();
  return { db, loss: loss.list };
}

// returns {dbf, dbt|null, loss}
function exportDBF(table, opts) {
  opts = opts || {};
  const loss = new Loss(), st = { n: 0 };
  const cols = table.fields.map((f, ci) => {
    const c = { f, ci };
    if (f.type === 'text') { c.type = 'C'; c.len = Math.min(254, f.len); c.dec = 0; if (f.len > 254) loss.add('dbf-text-length', 'lossy', 'text fields are cut to 254 characters in dBase'); } else if (f.type === 'int') { c.type = 'N'; c.len = 11; c.dec = 0; } else if (f.type === 'num') {
      let dec = 0, ints = 1, neg = 0;
      for (const r of table.rows) { const v = r[ci]; if (v === null) continue; if (v < 0) neg = 1; const s = Math.abs(v).toFixed(10).replace(/0+$/, '').replace(/\.$/, ''), parts = s.split('.'); ints = Math.max(ints, parts[0].length); dec = Math.max(dec, (parts[1] || '').length); }
      let len = neg + ints + (dec ? 1 + dec : 0);
      if (len > 19) { const over = len - 19; dec = Math.max(0, dec - over); len = neg + ints + (dec ? 1 + dec : 0); }
      c.type = 'N'; c.len = Math.min(19, Math.max(len, 1)); c.dec = dec;
    } else if (f.type === 'date') { c.type = 'D'; c.len = 8; c.dec = 0; } else if (f.type === 'bool') { c.type = 'L'; c.len = 1; c.dec = 0; } else { c.type = 'M'; c.len = 10; c.dec = 0; }
    return c;
  });
  const hasMemo = cols.some((c) => c.type === 'M');
  const rlen = 1 + cols.reduce((a, c) => a + c.len, 0), hlen = 32 + 32 * cols.length + 1, n = table.rows.length;
  const out = new Uint8Array(hlen + n * rlen + 1);
  const dv = new DataView(out.buffer);
  const now = opts.date ? new Date(opts.date) : new Date();
  out[0] = hasMemo ? 0x83 : 0x03; out[1] = now.getFullYear() - 1900; out[2] = now.getMonth() + 1; out[3] = now.getDate();
  dv.setUint32(4, n, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true); out[29] = 0x03;
  let off = 1;
  cols.forEach((c, i) => {
    const b = 32 + 32 * i, nm = c.f.name.toUpperCase();
    for (let k = 0; k < nm.length; k++) out[b + k] = nm.charCodeAt(k);
    out[b + 11] = c.type.charCodeAt(0); out[b + 16] = c.len; out[b + 17] = c.dec; c.off = off; off += c.len;
  });
  out[32 + 32 * cols.length] = 0x0d;
  const memos = []; let overflow = 0;
  table.rows.forEach((r, i) => {
    const b = hlen + i * rlen; out[b] = 0x20; out.fill(0x20, b + 1, b + rlen);
    for (const c of cols) {
      const v = r[c.ci]; let s = null;
      if (c.type === 'C') { if (v !== null) { const by = latin1Bytes(v.slice(0, c.len), st); for (let k = 0; k < by.length; k++) out[b + c.off + k] = by[k]; } continue; }
      if (c.type === 'M') { if (v !== null && v !== '') { memos.push(v); s = String(memos.length).padStart(10); } } else if (v === null) { if (c.type === 'L') s = '?'; } else if (c.type === 'N') {
        s = c.type === 'N' && c.f.type === 'int' ? String(v) : v.toFixed(c.dec);
        if (s.length > c.len) { overflow++; s = null; } else s = s.padStart(c.len);
      } else if (c.type === 'D') s = v.replace(/-/g, '');
      else if (c.type === 'L') s = v ? 'T' : 'F';
      if (s !== null) for (let k = 0; k < s.length; k++) out[b + c.off + k] = s.charCodeAt(k);
    }
  });
  out[out.length - 1] = 0x1a;
  if (overflow) loss.add('dbf-number-overflow', 'lossy', 'numbers too wide for dBase (19 digits) were written empty', overflow);
  loss.add('dbf-null', 'info', 'dBase has no null: empty numbers, dates and logicals are blank; empty and missing text both read back as empty text');
  let dbt = null;
  if (hasMemo) {
    const parts = [];
    let blocks = 1;
    for (const m of memos) { const by = latin1Bytes(m, st).concat([0x1a, 0x1a]); const nb = Math.ceil(by.length / 512); const blk = new Uint8Array(nb * 512); blk.set(by); parts.push(blk); blocks += nb; }
    dbt = new Uint8Array(blocks * 512); new DataView(dbt.buffer).setUint32(0, blocks, true);
    let o = 512; for (const blk of parts) { dbt.set(blk, o); o += blk.length; }
    // the memo numbers written above counted memos; rewrite them as block numbers
    let blockNo = 1, k = 0;
    table.rows.forEach((r, i) => { for (const c of cols) if (c.type === 'M' && r[c.ci] !== null && r[c.ci] !== '') { const s = String(blockNo).padStart(10), b = hlen + i * rlen + c.off; for (let q = 0; q < 10; q++) out[b + q] = s.charCodeAt(q); blockNo += parts[k++].length / 512; } });
  }
  if (st.n) loss.add('non-latin1-text', 'lossy', 'characters above U+00FF were written as ?', st.n);
  return { dbf: out, dbt, loss: loss.list };
}

// ---------------------------------------------------------------- CSV / TSV
function decodeText(bytes) {
  if (typeof bytes === 'string') return { text: bytes, encoding: 'string' };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; } catch (e) { return { text: dec1252(bytes), encoding: 'windows-1252' }; }
}
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10); let best = ',', score = 0;
  for (const d of [',', '\t', ';', '|']) {
    const counts = sample.filter((l) => l.length).map((l) => { let q = false, n = 0; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length, s = consistent * 100 + counts[0];
    if (s > score) { score = s; best = d; }
  }
  return best;
}
function parseDelimited(text, delim) {
  const rows = []; let row = [], f = '', q = false, i = 0, started = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += ch; i++; continue;
    }
    if (ch === '"' && f === '') { q = true; started = true; i++; continue; }
    if (ch === delim) { row.push(f); f = ''; started = true; i++; continue; }
    if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; i++; if (started || f !== '' || row.length) { row.push(f); rows.push(row); } row = []; f = ''; started = false; continue; }
    f += ch; started = true; i++;
  }
  if (q) bad('csv-unterminated', 'a quoted field is not closed (damaged file)');
  if (started || f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const RE_INT = /^-?(0|[1-9]\d{0,9})$/, RE_NUM = /^-?(0|[1-9]\d*)?(\.\d+)?([eE][+-]?\d+)?$/, RE_DATE = /^\d{4}-\d{2}-\d{2}$/, RE_BOOL = /^(true|false|yes|no|t|f)$/i;
function inferType(vals) {
  const v = vals.filter((x) => x !== '');
  if (!v.length) return { type: 'text', len: 10 };
  if (v.every((x) => RE_INT.test(x) && Math.abs(+x) <= 2147483647) && v.every((x) => !/^-?0\d/.test(x))) return { type: 'int' };
  if (v.every((x) => RE_NUM.test(x) && /\d/.test(x) && x.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '').length <= 10 && Math.abs(+x) < 1e98 && Number.isFinite(+x)) && v.every((x) => !/^-?0\d/.test(x))) return { type: 'num' };
  if (v.every((x) => RE_DATE.test(x) && D.parseDate(x))) return { type: 'date' };
  if (v.every((x) => RE_BOOL.test(x))) return { type: 'bool' };
  const max = Math.max(...v.map((x) => x.length));
  return max > 255 || v.some((x) => /[\r\n]/.test(x)) ? { type: 'memo' } : { type: 'text', len: Math.max(1, max) };
}

function importDelimited(input, opts) {
  opts = opts || {};
  const loss = new Loss(), { text, encoding } = decodeText(input);
  if (encoding === 'windows-1252') loss.add('encoding', 'info', 'the file is not UTF-8; it was read as Windows-1252');
  const delim = opts.delimiter || detectDelimiter(text);
  let rows = parseDelimited(text, delim);
  if (!rows.length) bad('csv-empty', 'the file has no rows');
  const width = Math.max(...rows.map((r) => r.length));
  const looksHeader = (r) => r.every((x) => x.trim() !== '' && !RE_NUM.test(x.trim()) && !RE_DATE.test(x.trim())) && new Set(r.map((x) => x.trim().toLowerCase())).size === r.length;
  const header = opts.header === undefined ? rows.length > 1 && looksHeader(rows[0]) : !!opts.header;
  const names = header ? rows.shift() : [];
  let ncol = Math.max(width, names.length);
  if (ncol > D.LIMITS.maxFields) { loss.add('too-many-fields', 'lossy', `only the first ${D.LIMITS.maxFields} of ${ncol} columns were imported`, ncol - D.LIMITS.maxFields); ncol = D.LIMITS.maxFields; }
  let ragged = 0;
  rows = rows.map((r) => { if (r.length !== ncol) ragged++; const o = r.slice(0, ncol); while (o.length < ncol) o.push(''); return o; });
  if (ragged) loss.add('ragged-rows', 'warn', 'rows with a different number of columns were padded or cut', ragged);
  if (rows.length > 65535) { loss.add('too-many-records', 'lossy', 'only the first 65535 rows were imported', rows.length - 65535); rows = rows.slice(0, 65535); }
  const used = new Set(), fields = [];
  for (let c = 0; c < ncol; c++) { const inf = inferType(rows.map((r) => r[c])); const f = { name: fieldName(header ? names[c] : 'F' + (c + 1), used, loss, c), type: inf.type }; if (inf.len) f.len = inf.len; fields.push(f); }
  const db = new D.Database(opts.name || 'import'), t = db.createTable(opts.tableName || 'data', fields);
  let trunc = 0;
  for (const r of rows) {
    t.rows.push(fields.map((f, c) => {
      const v = r[c];
      if (f.type === 'text') { if (v.length > f.len) trunc++; return D.coerce(f, v, { truncate: true }); }
      if (f.type === 'memo') return D.coerce(f, v, { truncate: true });
      if (v === '') return null;
      if (f.type === 'num') return D.coerce(f, Number(v));
      return D.coerce(f, v);
    }));
  }
  t._dirty();
  if (trunc) loss.add('text-cut', 'lossy', 'text was cut to the field length', trunc);
  return { db, loss: loss.list, info: { delimiter: delim, header, encoding } };
}

function exportDelimited(table, opts) {
  opts = opts || {};
  const d = opts.delimiter || ',', eol = opts.eol || '\r\n';
  const q = (s) => (s === '' ? '' : /[",\r\n]/.test(s) || s.includes(d) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const cell = (f, v) => (v === null ? '' : f.type === 'bool' ? (v ? 'true' : 'false') : String(v));
  const lines = [];
  if (opts.header !== false) lines.push(table.fields.map((f) => q(f.name)).join(d));
  const pos = opts.positions || table.rows.map((_, i) => i);
  for (const i of pos) lines.push(table.fields.map((f, c) => q(cell(f, table.rows[i][c]))).join(d));
  return { text: (opts.bom ? '\ufeff' : '') + lines.join(eol) + eol, loss: [] };
}

module.exports = { importDBF, exportDBF, importDelimited, exportDelimited, parseDelimited, detectDelimiter, inferType, decodeText, fieldName, Loss };
