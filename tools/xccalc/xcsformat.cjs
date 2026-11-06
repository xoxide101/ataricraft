'use strict';
// .xcs: Craft spreadsheet. Binary = CRFT header (type 'S') + compact payload (docs/XCCALC.md); JSON twin = lossless text form.
const C = require('../calccore.cjs');

const MAGIC = [0x43, 0x52, 0x46, 0x54];
const KIND = { blank: 0, num: 1, str: 2, formula: 3, err: 4, bool: 5 };
const MAXPAYLOAD = 0xffff;

function crc16(b, n) { let c = 0xffff; for (let i = 0; i < n; i++) { c ^= b[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
const sum16 = (b, o, n) => { let s = 0; for (let i = 0; i < n; i++) s = (s + b[o + i]) & 0xffff; return s; };

class Out {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); } u16(v) { this.a.push(v & 255, (v >> 8) & 255); }
  bytes(b) { for (const x of b) this.a.push(x); }
  f64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.bytes(b); }
}

// returns {bytes, loss:[...], cells}
function toBinary(wb) {
  const loss = [], pool = [], pidx = new Map();
  let nonLatin = 0;
  const S = (s) => {
    s = String(s);
    let b = '';
    for (const ch of s) { const cc = ch.charCodeAt(0); if (cc > 255) { b += '?'; nonLatin++; } else b += ch; }
    if (b.length > 32767) b = b.slice(0, 32767);
    if (!pidx.has(b)) { pidx.set(b, pool.length); pool.push(b); }
    return pidx.get(b);
  };
  const customs = [];
  const fmtByte = (x) => { if (x.fmtc) { let i = customs.indexOf(x.fmtc); if (i < 0) { i = customs.length; customs.push(x.fmtc); } return 16 + i; } return x.fmt; };
  const putNum = (o, v) => { if (wb.mode === 'bcd') o.bytes(C.bcdEncode(v)); else o.f64(v); };
  let totalCells = 0, maxR = 0, maxC = 0;
  const sheetBlob = new Out();
  for (let s = 0; s < wb.sheets.length; s++) {
    const sh = wb.sheets[s];
    sheetBlob.u16(S(sh.name)); sheetBlob.u8(sh.frozenRows); sheetBlob.u8(sh.frozenCols); sheetBlob.u8(sh.defaultColW);
    const cw = [...sh.colw.entries()].filter(([c]) => c < 256).sort((a, b) => a[0] - b[0]);
    sheetBlob.u8(cw.length); for (const [c, w] of cw) { sheetBlob.u8(c); sheetBlob.u8(Math.min(255, w)); }
    const rows = new Map();
    for (const [kk, x] of sh.cells) { const r = kk >> 8; if (!rows.has(r)) rows.set(r, []); rows.get(r).push([kk & 255, x]); }
    const rkeys = [...rows.keys()].sort((a, b) => a - b);
    sheetBlob.u16(rkeys.length);
    for (const r of rkeys) {
      const list = rows.get(r).sort((a, b) => a[0] - b[0]);
      sheetBlob.u16(r); sheetBlob.u8(list.length - 1);
      for (const [c, x] of list) {
        totalCells++; if (r + 1 > maxR) maxR = r + 1; if (c + 1 > maxC) maxC = c + 1;
        const fm = fmtByte(x), v = x.val;
        const kind = x.f ? KIND.formula : v === null || v === undefined ? KIND.blank : typeof v === 'number' ? KIND.num : typeof v === 'string' ? KIND.str : typeof v === 'boolean' ? KIND.bool : KIND.err;
        sheetBlob.u8(c); sheetBlob.u8(kind | (fm ? 8 : 0) | (x.st ? 16 : 0));
        if (fm) sheetBlob.u8(fm);
        if (x.st) sheetBlob.u8(x.st);
        if (kind === KIND.formula) {
          sheetBlob.u16(S(x.f));
          if (v === null || v === undefined) sheetBlob.u8(KIND.blank);
          else if (typeof v === 'number') { sheetBlob.u8(KIND.num); putNum(sheetBlob, v); }
          else if (typeof v === 'string') { sheetBlob.u8(KIND.str); sheetBlob.u16(S(v)); }
          else if (typeof v === 'boolean') { sheetBlob.u8(KIND.bool); sheetBlob.u8(v ? 1 : 0); }
          else { sheetBlob.u8(KIND.err); sheetBlob.u8(C.ERRCODES.indexOf(v.err)); }
        } else if (kind === KIND.num) putNum(sheetBlob, v);
        else if (kind === KIND.str) sheetBlob.u16(S(v));
        else if (kind === KIND.bool) sheetBlob.u8(v ? 1 : 0);
        else if (kind === KIND.err) sheetBlob.u8(C.ERRCODES.indexOf(v.err));
      }
    }
  }
  const names = [...wb.names.values()];
  const nameBlob = new Out();
  for (const n of names) { nameBlob.u16(S(n.name)); nameBlob.u16(S(n.ref)); }
  const chartBlob = new Out();
  for (const ch of wb.charts) { chartBlob.u8(['bar', 'line', 'pie'].indexOf(ch.kind)); chartBlob.u8(ch.sheet || 0); chartBlob.u16(S(ch.title || '')); chartBlob.u16(S(ch.range)); chartBlob.u16(ch.row || 0); chartBlob.u8(ch.col || 0); chartBlob.u8(ch.w || 8); chartBlob.u8(ch.h || 12); }
  const fmtBlob = new Out();
  for (const f of customs) fmtBlob.u16(S(f));
  if (nonLatin) loss.push({ code: 'non-latin1-text', severity: 'lossy', count: nonLatin, detail: 'characters above U+00FF stored as ? in the binary; the JSON twin keeps them' });
  const strs = new Out();
  for (const p of pool) { if (p.length < 128) strs.u8(p.length); else { strs.u8(0x80 | (p.length >> 8)); strs.u8(p.length & 255); } for (let i = 0; i < p.length; i++) strs.u8(p.charCodeAt(i)); }
  const pay = new Out();
  pay.u8(wb.mode === 'bcd' ? 1 : 0); pay.u8(wb.sheets.length); pay.u8(names.length); pay.u8(customs.length); pay.u8(wb.charts.length); pay.u8(0);
  pay.u16(pool.length); pay.u16(strs.a.length);
  pay.bytes(strs.a); pay.bytes(fmtBlob.a); pay.bytes(nameBlob.a); pay.bytes(chartBlob.a); pay.bytes(sheetBlob.a);
  const payload = Uint8Array.from(pay.a), withCrc = new Uint8Array(payload.length + 2);
  withCrc.set(payload); const crc = crc16(payload, payload.length); withCrc[payload.length] = crc & 255; withCrc[payload.length + 1] = crc >> 8;
  if (withCrc.length > MAXPAYLOAD) { const e = new Error('xcs payload ' + withCrc.length + ' bytes exceeds the 65535 byte limit of version 1; save the JSON twin or XLSX instead'); e.code = 'xcs-too-big'; throw e; }
  const out = new Uint8Array(16 + withCrc.length), dv = new DataView(out.buffer);
  out.set(MAGIC); out[4] = 1; out[5] = 0x53; out[6] = 0; out[7] = 0;
  dv.setUint16(8, withCrc.length, true); dv.setUint16(10, Math.min(65535, totalCells), true); out[12] = Math.min(255, maxC); out[13] = Math.min(255, maxR);
  dv.setUint16(14, sum16(withCrc, 0, withCrc.length), true);
  out.set(withCrc, 16);
  return { bytes: out, loss, cells: totalCells };
}

function fromBinary(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 16 || b[0] !== 0x43 || b[1] !== 0x52 || b[2] !== 0x46 || b[3] !== 0x54) throw new Error('not a CRFT file');
  if (b[4] !== 1) throw new Error('unsupported CRFT version ' + b[4]);
  if (b[5] !== 0x53) throw new Error('not a spreadsheet (type ' + String.fromCharCode(b[5]) + ')');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), len = dv.getUint16(8, true);
  if (b.length < 16 + len || len < 12) throw new Error('truncated xcs');
  const info = { warnings: [] };
  const pay = b.subarray(16, 16 + len);
  if (sum16(pay, 0, len) !== dv.getUint16(14, true)) info.warnings.push('header checksum mismatch');
  if (crc16(pay, len - 2) !== (pay[len - 2] | (pay[len - 1] << 8))) info.warnings.push('payload CRC mismatch');
  let p = 0;
  const u8 = () => pay[p++], u16 = () => { const v = pay[p] | (pay[p + 1] << 8); p += 2; return v; };
  const mode = u8() ? 'bcd' : 'ieee', nSheets = u8(), nNames = u8(), nFmts = u8(), nCharts = u8(); u8();
  const nStr = u16(); u16();
  const pool = [];
  for (let i = 0; i < nStr; i++) { let l = u8(); if (l & 0x80) l = ((l & 0x7f) << 8) | u8(); let s = ''; for (let k = 0; k < l; k++) s += String.fromCharCode(u8()); pool.push(s); }
  const customs = []; for (let i = 0; i < nFmts; i++) customs.push(pool[u16()]);
  const names = []; for (let i = 0; i < nNames; i++) names.push([pool[u16()], pool[u16()]]);
  const charts = [];
  for (let i = 0; i < nCharts; i++) { const k = u8(), sheet = u8(), title = pool[u16()], range = pool[u16()], row = u16(), col = u8(), w = u8(), h = u8(); charts.push({ kind: ['bar', 'line', 'pie'][k], sheet, title, range, row, col, w, h }); }
  const wb = new C.Workbook({ mode, sheets: 0 });
  const getNum = () => { if (mode === 'bcd') { const v = C.bcdDecode(pay, p); p += 6; return v; } const v = new DataView(pay.buffer, pay.byteOffset + p, 8).getFloat64(0, true); p += 8; return v; };
  const getVal = () => { const k = u8(); if (k === KIND.num) return getNum(); if (k === KIND.str) return pool[u16()]; if (k === KIND.bool) return !!u8(); if (k === KIND.err) return new C.XErr(C.ERRCODES[u8()] || C.ERR.VALUE); return null; };
  const cached = [];
  wb.batch(() => {
    for (let s = 0; s < nSheets; s++) {
      const si = wb.addSheet(pool[u16()]), sh = wb.sheets[si];
      sh.frozenRows = u8(); sh.frozenCols = u8(); sh.defaultColW = u8();
      const ncw = u8(); for (let i = 0; i < ncw; i++) { const c = u8(), w = u8(); sh.colw.set(c, w); }
      const nrows = u16();
      for (let ri = 0; ri < nrows; ri++) {
        const r = u16(), n = u8() + 1;
        for (let ci = 0; ci < n; ci++) {
          const c = u8(), fl = u8(), kind = fl & 7;
          const fm = fl & 8 ? u8() : 0, st = fl & 16 ? u8() : 0;
          if (kind === KIND.formula) { const f = pool[u16()]; const cv = getVal(); wb.setFormula(si, r, c, f); cached.push([si, r, c, cv]); }
          else if (kind === KIND.num) wb.setValue(si, r, c, getNum());
          else if (kind === KIND.str) wb.setValue(si, r, c, pool[u16()]);
          else if (kind === KIND.bool) wb.setValue(si, r, c, !!u8());
          else if (kind === KIND.err) wb.setValue(si, r, c, new C.XErr(C.ERRCODES[u8()] || C.ERR.VALUE));
          else wb.ensure(si, r, c);
          const x = wb.cell(si, r, c);
          if (fm >= 16) x.fmtc = customs[fm - 16]; else x.fmt = fm;
          x.st = st;
        }
      }
    }
    for (const [n, ref] of names) wb.names.set(n.toUpperCase(), { name: n, ref, ast: null });
  });
  wb.recompileAll();
  wb.charts = charts;
  let mism = 0;
  for (const [s, r, c, cv] of cached) {
    const v = wb.get(s, r, c);
    const same = v === cv || (typeof v === 'number' && typeof cv === 'number' && Math.abs(v - cv) <= 1e-9 * Math.max(1, Math.abs(v))) || (C.isErr(v) && C.isErr(cv) && v.err === cv.err);
    if (!same) mism++;
  }
  if (mism) info.warnings.push(mism + ' cached formula value(s) differ from the recalculation (volatile functions or a different number mode)');
  info.cells = dv.getUint16(10, true); info.mode = mode;
  return { wb, info };
}

// ---------- JSON twin ----------
function toJSON(wb) {
  const o = { format: 'xcs-json', version: 1, mode: wb.mode, sheets: [], names: {}, charts: wb.charts.map((c) => Object.assign({}, c)) };
  for (const n of wb.names.values()) o.names[n.name] = n.ref;
  for (const sh of wb.sheets) {
    const sj = { name: sh.name, frozenRows: sh.frozenRows, frozenCols: sh.frozenCols, defaultColW: sh.defaultColW, colw: {}, cells: {} };
    for (const [c, w] of sh.colw) sj.colw[C.colName(c)] = w;
    const keys = [...sh.cells.keys()].sort((a, b) => a - b);
    for (const kk of keys) {
      const x = sh.cells.get(kk), cj = {}, v = x.val;
      if (x.f) cj.f = x.f;
      if (v !== null && v !== undefined) { if (typeof v === 'number') cj.n = v; else if (typeof v === 'string') cj.s = v; else if (typeof v === 'boolean') cj.b = v; else cj.e = v.err; }
      if (x.fmtc) cj.fmt = x.fmtc; else if (x.fmt) cj.fmt = C.FORMATS[x.fmt];
      if (x.st) cj.st = x.st;
      sj.cells[C.addr(kk >> 8, kk & 255)] = cj;
    }
    o.sheets.push(sj);
  }
  return o;
}
function fromJSON(o) {
  if (typeof o === 'string') o = JSON.parse(o);
  if (o.format !== 'xcs-json') throw new Error('not an xcs-json document');
  const wb = new C.Workbook({ mode: o.mode, sheets: 0 });
  wb.batch(() => {
    o.sheets.forEach((sj, s) => {
      wb.addSheet(sj.name); const sh = wb.sheets[s];
      sh.frozenRows = sj.frozenRows || 0; sh.frozenCols = sj.frozenCols || 0; sh.defaultColW = sj.defaultColW || 9;
      for (const [cn, w] of Object.entries(sj.colw || {})) sh.colw.set(C.colIndex(cn), w);
      for (const [a, cj] of Object.entries(sj.cells)) {
        const { r, c } = C.parseAddr(a);
        if (cj.f !== undefined) wb.setFormula(s, r, c, cj.f);
        else if (cj.n !== undefined) wb.setValue(s, r, c, cj.n); else if (cj.s !== undefined) wb.setValue(s, r, c, cj.s); else if (cj.b !== undefined) wb.setValue(s, r, c, cj.b); else if (cj.e !== undefined) wb.setValue(s, r, c, new C.XErr(cj.e)); else wb.ensure(s, r, c);
        const x = wb.cell(s, r, c);
        if (cj.fmt) wb.setFmtCode(x, cj.fmt);
        x.st = cj.st || 0;
      }
    });
    for (const [n, ref] of Object.entries(o.names || {})) wb.names.set(n.toUpperCase(), { name: n, ref, ast: null });
  });
  wb.recompileAll();
  wb.charts = (o.charts || []).map((c) => Object.assign({}, c));
  return wb;
}

// style byte: bit0 bold, bit1 italic, bit2 underline, bits3-4 alignment (0 auto, 1 left, 2 center, 3 right)
const ST = { BOLD: 1, ITALIC: 2, UNDER: 4, AL_L: 8, AL_C: 16, AL_R: 24 };

module.exports = { toBinary, fromBinary, toJSON, fromJSON, crc16, sum16, MAXPAYLOAD, ST, KIND };
