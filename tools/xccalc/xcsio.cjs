'use strict';
// Spreadsheet importers/exporters: CSV/TSV (encoding aware), XLSX, ODS (read and write), HTML (write).
// Every import returns { wb, loss:[{code,severity,count,detail}] }; every export returns { bytes|text, loss }.
const C = require('../calccore.cjs');
const U = require('../craftcore/util.cjs');
const ENC = require('../craftcore/encodings.cjs');
let zlib = null; try { zlib = require('zlib'); } catch (e) { /* browser: inflate.cjs below */ }
let INF = null; try { INF = require('../inflate.cjs'); } catch (e) { /* optional */ }

const loss = () => { const m = new Map(); const add = (code, severity, detail, n = 1) => { const k = code; if (!m.has(k)) m.set(k, { code, severity, count: 0, detail }); m.get(k).count += n; }; add.list = () => [...m.values()]; return add; };

// ---------- bytes -> text ----------
function decodeText(bytes, hint) {
  bytes = U.u8(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const sw = new Uint8Array(bytes.length - 2); for (let i = 0; i + 1 < sw.length + 1 && i + 3 <= bytes.length; i += 2) { sw[i] = bytes[i + 3]; sw[i + 1] = bytes[i + 2]; } return { text: new TextDecoder('utf-16le').decode(sw), encoding: 'utf-16be' }; }
  if (hint && hint !== 'auto') { const r = ENC.decode(bytes, hint); return { text: r.text, encoding: hint, lost: r.lost }; }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; } catch (e) { /* not UTF-8 */ }
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
}
function encodeText(text, encoding, bom) {
  const e = (encoding || 'utf-8').toLowerCase();
  if (e === 'utf-16le') { const b = new Uint8Array(2 + text.length * 2); b[0] = 0xff; b[1] = 0xfe; for (let i = 0; i < text.length; i++) { b[2 + i * 2] = text.charCodeAt(i) & 255; b[3 + i * 2] = text.charCodeAt(i) >> 8; } return { bytes: b, lost: [] }; }
  if (e === 'utf-8' || e === 'utf8') { const b = new TextEncoder().encode(text); return { bytes: bom ? U.concat([Uint8Array.of(0xef, 0xbb, 0xbf), b]) : b, lost: [] }; }
  const name = e === 'windows-1252' || e === 'cp1252' ? 'cp1252' : e;
  try { return ENC.encode(text, name); } catch (x) { return ENC.encode(text, 'latin1'); }
}

// ---------- CSV ----------
function detectDelimiter(text) {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 8);
  let best = ',', score = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = head.filter((l) => l).map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const sc = counts.every((c) => c === counts[0]) ? counts[0] + 100 : Math.min(...counts);
    if (sc > score) { score = sc; best = d; }
  }
  return best;
}
function parseCSV(text, delim) {
  const rows = [];
  let row = [], f = '', q = false, i = 0, quotedField = false;
  const flush = () => { row.push(quotedField ? { q: f } : f); f = ''; quotedField = false; };
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += ch; i++; continue;
    }
    if (ch === '"' && f === '') { q = true; quotedField = true; i++; continue; }
    if (ch === delim) { flush(); i++; continue; }
    if (ch === '\r' || ch === '\n') { flush(); rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; i++; continue; }
    f += ch; i++;
  }
  if (f !== '' || row.length || quotedField) { flush(); rows.push(row); }
  return rows;
}
function importCSV(bytes, opts = {}) {
  const add = loss();
  const dt = decodeText(bytes, opts.encoding);
  if (dt.lost && dt.lost.length) add('unmappable-characters', 'lossy', 'characters not representable in ' + dt.encoding, dt.lost.length);
  const delim = opts.delimiter || (opts.name && /\.tsv$/i.test(opts.name) ? '\t' : detectDelimiter(dt.text));
  const rows = parseCSV(dt.text, delim);
  const wb = new C.Workbook({ mode: opts.mode });
  if (rows.length > C.MAXROW) add('rows-truncated', 'lossy', 'more than 65536 rows', rows.length - C.MAXROW);
  wb.batch(() => {
    for (let r = 0; r < Math.min(rows.length, C.MAXROW); r++) {
      const row = rows[r];
      if (row.length > C.MAXCOL) add('columns-truncated', 'lossy', 'more than 256 columns', row.length - C.MAXCOL);
      for (let c = 0; c < Math.min(row.length, C.MAXCOL); c++) {
        const fld = row[c], quoted = typeof fld === 'object', t = quoted ? fld.q : fld;
        if (t === '') { if (quoted) wb.setValue(0, r, c, ''); continue; }
        if (quoted || /^0\d+$/.test(t) || /^\d{16,}$/.test(t) || (t[0] === '=' && !opts.formulas)) {
          if (!quoted && /^0\d+$/.test(t)) add('leading-zeros-kept-as-text', 'info', 'numbers with leading zeros stay text so the zeros survive');
          if (!quoted && t[0] === '=') add('formula-kept-as-text', 'info', 'a field starting with = is text unless formulas are enabled');
          if (quoted && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t.trim())) { wb.input(0, { r, c }, t); continue; }
          wb.setValue(0, r, c, t);
        } else wb.input(0, { r, c }, t);
      }
    }
  });
  add('encoding-' + dt.encoding, 'info', 'text decoded as ' + dt.encoding + ', delimiter ' + JSON.stringify(delim), 0);
  return { wb, loss: add.list(), encoding: dt.encoding, delimiter: delim };
}
function exportCSV(wb, s, opts = {}) {
  const add = loss(), d = opts.delimiter || ',', b = wb.bounds(s), lines = [];
  const quote = (t) => (t.includes(d) || /["\r\n]/.test(t) || opts.quoteAll || /^\s|\s$/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
  let formulas = 0;
  for (let r = 0; r < b.rows; r++) {
    const row = [];
    for (let c = 0; c < b.cols; c++) {
      const x = wb.cell(s, r, c);
      let t = '';
      if (x && x.val !== null && x.val !== undefined) {
        if (x.f) formulas++;
        t = opts.raw && typeof x.val === 'number' ? String(x.val) : wb.display(s, r, c);
        if (typeof x.val === 'string' && /^[=+\-@]/.test(t) && opts.safe) t = "'" + t;
      }
      row.push(quote(t));
    }
    lines.push(row.join(d));
  }
  if (formulas) add('formulas-to-values', 'lossy', 'CSV stores the displayed results, not formulas', formulas);
  if (!opts.raw) add('display-format-applied', 'info', 'numbers are written the way the grid shows them (rounded by format)', 0);
  if (wb.sheets.length > 1) add('other-sheets-dropped', 'lossy', 'CSV holds one sheet; sheet ' + (s + 1) + ' written', wb.sheets.length - 1);
  const text = lines.join(opts.crlf === false ? '\n' : '\r\n') + (lines.length ? (opts.crlf === false ? '\n' : '\r\n') : '');
  const e = encodeText(text, opts.encoding, opts.bom);
  if (e.lost && e.lost.length) add('unmappable-characters', 'lossy', 'characters not representable in ' + (opts.encoding || 'utf-8'), e.lost.length);
  return { bytes: e.bytes, loss: add.list() };
}

// ---------- zip ----------
function zipWrite(files) {
  const parts = [], central = [];
  let off = 0;
  const w16 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255), w32 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  for (const [name, data0] of files) {
    const data = typeof data0 === 'string' ? U.enc(data0) : data0, nm = U.enc(name), crc = U.crc32(data);
    const lh = U.concat([w32(0x04034b50), w16(20), w16(0x0800), w16(0), w16(0), w16(0x21), w32(crc), w32(data.length), w32(data.length), w16(nm.length), w16(0), nm]);
    parts.push(lh, data);
    central.push(U.concat([w32(0x02014b50), w16(20), w16(20), w16(0x0800), w16(0), w16(0), w16(0x21), w32(crc), w32(data.length), w32(data.length), w16(nm.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), nm]));
    off += lh.length + data.length;
  }
  const cd = U.concat(central);
  return U.concat([...parts, cd, w32(0x06054b50), w16(0), w16(0), w16(files.length), w16(files.length), w32(cd.length), w32(off), w16(0)]);
}
function zipRead(bytes) {
  const b = U.u8(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map();
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a ZIP file');
  let n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true);
  while (n--) {
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = b.subarray(ds, ds + csz);
    out.set(name, () => (method === 0 ? raw : zlib ? new Uint8Array(zlib.inflateRawSync(raw)) : INF.inflateRaw(raw)));
  }
  return { has: (n2) => out.has(n2), names: () => [...out.keys()], text: (n2) => (out.has(n2) ? new TextDecoder().decode(out.get(n2)()) : null) };
}

// ---------- xml helpers ----------
const xe = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xd = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]));
const attrs = (s) => { const o = {}; let m; const re = /([\w:.-]+)="([^"]*)"/g; while ((m = re.exec(s))) o[m[1]] = xd(m[2]); return o; };
const textOf = (xml) => { let t = ''; xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g; let m; while ((m = re.exec(xml))) t += m[1] ? xd(m[1]) : ''; return t; };

// ---------- XLSX ----------
const BUILTIN_FMT = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'yyyy-mm-dd hh:mm', 37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 49: '@' };
const XL_ID = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49 };

function exportXLSX(wb) {
  const add = loss();
  const xlF = (f) => xe(f.replace(/\bCONCAT(?=\()/g, 'CONCATENATE'));
  const fonts = [{ b: 0, i: 0, u: 0 }], xfs = [{ fmt: 'General', font: 0, al: 0 }], xfIdx = new Map([['General|0|0', 0]]), customFmts = [];
  const xfOf = (x) => {
    const code = wb.fmtCode(x), st = x.st || 0;
    const key = code + '|' + st;
    if (xfIdx.has(key)) return xfIdx.get(key);
    const f = { b: st & 1, i: (st >> 1) & 1, u: (st >> 2) & 1 };
    let fi = fonts.findIndex((q) => q.b === f.b && q.i === f.i && q.u === f.u);
    if (fi < 0) { fi = fonts.length; fonts.push(f); }
    if (!(code in XL_ID) && !customFmts.includes(code)) customFmts.push(code);
    xfs.push({ fmt: code, font: fi, al: (st >> 3) & 3 }); xfIdx.set(key, xfs.length - 1);
    return xfs.length - 1;
  };
  const sst = [], sidx = new Map();
  const S = (t) => { if (!sidx.has(t)) { sidx.set(t, sst.length); sst.push(t); } return sidx.get(t); };
  const sheetsXml = wb.sheets.map((sh, s) => {
    const rows = new Map();
    for (const [kk, x] of sh.cells) { const r = kk >> 8; if (!rows.has(r)) rows.set(r, []); rows.get(r).push([kk & 255, x]); }
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    const bnd = wb.bounds(s);
    xml += '<dimension ref="A1' + (bnd.rows ? ':' + C.addr(bnd.rows - 1, bnd.cols - 1) : '') + '"/>';
    if (sh.frozenRows || sh.frozenCols) xml += '<sheetViews><sheetView workbookViewId="0"><pane' + (sh.frozenCols ? ' xSplit="' + sh.frozenCols + '"' : '') + (sh.frozenRows ? ' ySplit="' + sh.frozenRows + '"' : '') + ' topLeftCell="' + C.addr(sh.frozenRows, sh.frozenCols) + '" activePane="' + (sh.frozenRows && sh.frozenCols ? 'bottomRight' : sh.frozenRows ? 'bottomLeft' : 'topRight') + '" state="frozen"/></sheetView></sheetViews>';
    xml += '<sheetFormatPr defaultRowHeight="15"' + (sh.defaultColW !== 9 ? ' defaultColWidth="' + (sh.defaultColW + 0.7109375) + '"' : '') + '/>';
    if (sh.colw.size) xml += '<cols>' + [...sh.colw.entries()].sort((a, b) => a[0] - b[0]).map(([c, w]) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (w + 0.7109375) + '" customWidth="1"/>').join('') + '</cols>';
    xml += '<sheetData>';
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      xml += '<row r="' + (r + 1) + '">';
      for (const [c, x] of rows.get(r).sort((a, b) => a[0] - b[0])) {
        const xf = xfOf(x), ref = C.addr(r, c), v = x.val;
        const sa = xf ? ' s="' + xf + '"' : '';
        let t = '', body = '';
        if (v === null || v === undefined) body = x.f ? '<f>' + xlF(x.f) + '</f>' : '';
        else if (typeof v === 'number') body = (x.f ? '<f>' + xlF(x.f) + '</f>' : '') + '<v>' + String(v) + '</v>';
        else if (typeof v === 'boolean') { t = ' t="b"'; body = (x.f ? '<f>' + xlF(x.f) + '</f>' : '') + '<v>' + (v ? 1 : 0) + '</v>'; }
        else if (C.isErr(v)) { t = ' t="e"'; body = (x.f ? '<f>' + xlF(x.f) + '</f>' : '') + '<v>' + xe(v.err === C.ERR.CIRC || v.err === C.ERR.PARSE ? '#VALUE!' : v.err) + '</v>'; }
        else if (x.f) { t = ' t="str"'; body = '<f>' + xlF(x.f) + '</f><v>' + xe(v) + '</v>'; } else { t = ' t="s"'; body = '<v>' + S(v) + '</v>'; }
        xml += '<c r="' + ref + '"' + sa + t + (body ? '>' + body + '</c>' : '/>');
      }
      xml += '</row>';
    }
    return xml + '</sheetData></worksheet>';
  });
  if (wb.charts.length) add('charts-dropped', 'lossy', 'xCCalc charts are not written to XLSX (kept in .xcs)', wb.charts.length);
  const numFmts = customFmts.length ? '<numFmts count="' + customFmts.length + '">' + customFmts.map((f, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xe(f) + '"/>').join('') + '</numFmts>' : '';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + numFmts +
    '<fonts count="' + fonts.length + '">' + fonts.map((f) => '<font>' + (f.b ? '<b/>' : '') + (f.i ? '<i/>' : '') + (f.u ? '<u/>' : '') + '<sz val="11"/><name val="Calibri"/></font>').join('') + '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.length + '">' + xfs.map((x) => '<xf numFmtId="' + (x.fmt in XL_ID ? XL_ID[x.fmt] : 164 + customFmts.indexOf(x.fmt)) + '" fontId="' + x.font + '" fillId="0" borderId="0" xfId="0"' + (x.fmt !== 'General' ? ' applyNumberFormat="1"' : '') + (x.font ? ' applyFont="1"' : '') + (x.al ? ' applyAlignment="1"><alignment horizontal="' + ['', 'left', 'center', 'right'][x.al] + '"/></xf>' : '/>')).join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const names = [...wb.names.values()].map((n) => '<definedName name="' + xe(n.name) + '">' + xe(n.ref) + '</definedName>').join('');
  const wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    wb.sheets.map((sh, i) => '<sheet name="' + xe(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' + (names ? '<definedNames>' + names + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  const n = wb.sheets.length;
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    wb.sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId' + (n + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    wb.sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' + sst.map((t) => '<si><t xml:space="preserve">' + xe(t) + '</t></si>').join('') + '</sst>';
  const files = [['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wbXml], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', styles], ['xl/sharedStrings.xml', sstXml]];
  sheetsXml.forEach((x, i) => files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', x]));
  if (wb.mode === 'bcd') add('bcd-numbers-written-as-decimals', 'info', 'numbers are the 10-digit BCD values written as decimal text', 0);
  return { bytes: zipWrite(files), loss: add.list() };
}

function importXLSX(bytes, opts = {}) {
  const add = loss(), z = zipRead(bytes);
  const wbx = z.text('xl/workbook.xml');
  if (!wbx) throw new Error('not an XLSX workbook (no xl/workbook.xml)');
  const rels = {};
  { const rx = z.text('xl/_rels/workbook.xml.rels') || ''; let m; const re = /<Relationship\b([^>]*?)\/?>/g; while ((m = re.exec(rx))) { const a = attrs(m[1]); rels[a.Id] = a.Target; } }
  const shared = [];
  { const sx = z.text('xl/sharedStrings.xml'); if (sx) { let m; const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g; while ((m = re.exec(sx))) shared.push(m[1] ? textOf(m[1]) : ''); } }
  // styles: cell xf -> {fmt code, st byte}
  const xfs = [];
  { const sx = z.text('xl/styles.xml');
    if (sx) {
      const custom = {};
      let m; const nre = /<numFmt\b([^>]*?)\/?>/g; while ((m = nre.exec(sx))) { const a = attrs(m[1]); custom[a.numFmtId] = a.formatCode; }
      const fonts = []; const fx = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(sx);
      if (fx) { const fre = /<font\b[^>]*>([\s\S]*?)<\/font>|<font\b[^>]*\/>/g; while ((m = fre.exec(fx[1]))) { const t = m[1] || ''; fonts.push((/<b\b(?![a-z])[^>]*?(?:\/>|>)/.test(t) && !/<b val="0"/.test(t) ? 1 : 0) | (/<i\b(?![a-z])/.test(t) && !/<i val="0"/.test(t) ? 2 : 0) | (/<u\b(?![a-z])/.test(t) && !/<u val="none"/.test(t) ? 4 : 0)); } }
      const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(sx);
      if (cx) {
        const xre = /<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g;
        while ((m = xre.exec(cx[1]))) {
          const a = attrs(m[1]), id = +(a.numFmtId || 0), code = custom[id] !== undefined ? custom[id] : BUILTIN_FMT[id] !== undefined ? BUILTIN_FMT[id] : 'General';
          let st = fonts[+(a.fontId || 0)] || 0;
          const al = /<alignment\b([^>]*?)\/?>/.exec(m[2] || '');
          if (al) { const h = attrs(al[1]).horizontal; st |= (h === 'left' ? 1 : h === 'center' ? 2 : h === 'right' ? 3 : 0) << 3; }
          xfs.push({ code: code.replace(/\[\$?-?[0-9A-Fa-f]*\]/g, '').replace(/_\)/g, '').replace(/\\(.)/g, '$1'), st });
        }
      }
      const fills = (sx.match(/<fill>(?!<patternFill patternType="(none|gray125)")/g) || []).length, borders = (sx.match(/<border\b[^>]*>(?:(?!<\/border>)[\s\S])*?<(left|right|top|bottom) style=/g) || []).length;
      if (fills) add('fills-dropped', 'lossy', 'cell fill colors are not kept', fills);
      if (borders) add('borders-dropped', 'lossy', 'cell borders are not kept', borders);
    } }
  const wb = new C.Workbook({ mode: opts.mode, sheets: 0 });
  const unknownFns = new Map(); let cachedDiff = 0, cachedTotal = 0;
  const cachedList = [];
  const sheetRe = /<sheet\b([^>]*?)\/?>/g;
  let m;
  wb.batch(() => {
    while ((m = sheetRe.exec(wbx))) {
      const a = attrs(m[1]);
      const target = (rels[a['r:id']] || '').replace(/^\//, ''), path = target.startsWith('xl/') ? target : 'xl/' + target;
      const xml = z.text(path);
      if (xml === null) { add('sheet-missing', 'lossy', 'sheet part ' + path + ' not found'); continue; }
      let name = a.name; if (wb.sheetIndex(name) >= 0) name += '_' + wb.sheets.length;
      if (wb.sheets.length >= 16) { add('sheets-dropped', 'lossy', 'xCCalc keeps at most 16 sheets'); continue; }
      const s = wb.addSheet(name), sh = wb.sheets[s];
      const pane = /<pane\b([^>]*?)\/?>/.exec(xml);
      if (pane) { const pa = attrs(pane[1]); sh.frozenCols = Math.min(255, +(pa.xSplit || 0)); sh.frozenRows = Math.min(255, +(pa.ySplit || 0)); }
      const dcw = /<sheetFormatPr\b[^>]*defaultColWidth="([\d.]+)"/.exec(xml); if (dcw) sh.defaultColW = Math.max(1, Math.min(255, Math.round(+dcw[1] - 0.71)));
      const cre = /<col\b([^>]*?)\/?>/g; let cm;
      while ((cm = cre.exec(xml))) { const ca = attrs(cm[1]); if (ca.width) for (let c = +ca.min - 1; c <= Math.min(+ca.max - 1, 255); c++) sh.colw.set(c, Math.max(1, Math.round(+ca.width - 0.71))); }
      const merges = (xml.match(/<mergeCell\b/g) || []).length; if (merges) add('merged-cells-dropped', 'lossy', 'merged ranges are not supported', merges);
      if (/<drawing\b/.test(xml)) add('drawings-dropped', 'lossy', 'charts, images and shapes are not read');
      if (/<conditionalFormatting\b/.test(xml)) add('conditional-formatting-dropped', 'lossy', 'conditional formatting is not kept');
      if (/<dataValidation\b/.test(xml)) add('data-validation-dropped', 'lossy', 'data validation is not kept');
      const sharedF = new Map(); // si -> {f, r, c}
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cc;
      while ((cc = cellRe.exec(xml))) {
        const ca = attrs(cc[1]), ad = C.parseAddr(ca.r || '');
        if (!ad) continue;
        const inner = cc[2] || '', fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner), vm = /<v>([\s\S]*?)<\/v>/.exec(inner), isx = /<is>([\s\S]*?)<\/is>/.exec(inner);
        let val = null;
        const t = ca.t || 'n';
        if (t === 's' && vm) val = shared[+vm[1]];
        else if (t === 'inlineStr' && isx) val = textOf(isx[1]);
        else if (t === 'str' && vm) val = xd(vm[1]);
        else if (t === 'b' && vm) val = vm[1] === '1';
        else if (t === 'e' && vm) val = new C.XErr(C.ERRCODES.includes(xd(vm[1])) ? xd(vm[1]) : C.ERR.VALUE);
        else if (vm) { const n = wb.num.parse(vm[1]); val = isNaN(n) ? null : n; }
        let f = null;
        if (fm) {
          const fa = attrs(fm[1]);
          let ft = fm[2] !== undefined ? xd(fm[2]) : '';
          if (fa.t === 'shared') {
            if (ft) sharedF.set(fa.si, { f: ft, r: ad.r, c: ad.c }); else { const mst = sharedF.get(fa.si); if (mst) ft = C.shiftFormula(mst.f, ad.r - mst.r, ad.c - mst.c); }
          }
          if (fa.t === 'array') add('array-formula-flattened', 'lossy', 'array formulas are read as ordinary formulas');
          if (ft) f = ft.replace(/^=/, '').replace(/_xlfn\.(?:_xlws\.)?|_xlws\.|_xludf\./gi, '');
        }
        if (f) {
          for (const fnm of f.replace(/"[^"]*"/g, '').match(/[A-Za-z_][A-Za-z0-9_.]*(?=\()/g) || []) { if (!wb.E.FN[fnm.toUpperCase()]) unknownFns.set(fnm.toUpperCase(), (unknownFns.get(fnm.toUpperCase()) || 0) + 1); }
          wb.setFormula(s, ad.r, ad.c, f); cachedList.push([s, ad.r, ad.c, val]);
        } else if (val !== null) wb.setValue(s, ad.r, ad.c, val);
        else if (ca.s) wb.ensure(s, ad.r, ad.c);
        const xf = ca.s !== undefined ? xfs[+ca.s] : null;
        if (xf && (xf.code !== 'General' || xf.st)) { const x = wb.ensure(s, ad.r, ad.c); if (xf.code !== 'General') wb.setFmtCode(x, xf.code); x.st = xf.st; }
        else if (!wb.cell(s, ad.r, ad.c)) continue;
      }
    }
    const dn = /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g; let dm;
    while ((dm = dn.exec(wbx))) { const a = attrs(dm[1]); if (a.localSheetId !== undefined || /^_xlnm/.test(a.name) || /\(/.test(dm[2])) { add('defined-names-skipped', 'lossy', 'sheet-local, built-in and computed names are not kept'); continue; } try { wb.names.set(a.name.toUpperCase(), { name: a.name, ref: xd(dm[2]), ast: null }); } catch (e) { /* skip */ } }
  });
  wb.recompileAll();
  for (const [s, r, c, cv] of cachedList) {
    if (cv === null) continue; cachedTotal++;
    const v = wb.get(s, r, c);
    const same = v === cv || (typeof v === 'number' && typeof cv === 'number' && Math.abs(v - cv) <= 1e-9 * Math.max(1, Math.abs(cv))) || (C.isErr(v) && C.isErr(cv));
    if (!same) cachedDiff++;
  }
  for (const [fnm, n] of unknownFns) add('unsupported-function:' + fnm, 'lossy', 'function ' + fnm + ' is not implemented; cells show #NAME?', n);
  if (cachedDiff) add('recalc-differs-from-cache', 'warn', 'recalculated values differ from the values saved by the other program', cachedDiff);
  return { wb, loss: add.list(), cachedTotal, cachedDiff };
}

// ---------- ODS ----------
function toOdfFormula(f) {
  let out = '', i = 0;
  while (i < f.length) {
    if (f[i] === '"') { let j = i + 1; while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
    const rest = f.slice(i), m = /^(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+))?(?![A-Za-z0-9_(])/.exec(rest);
    const prevOk = i === 0 || !/[A-Za-z0-9_.]/.test(f[i - 1]);
    if (m && prevOk) {
      const shn = (x) => (x ? '$' + x.replace(/^'|'$/g, '') + '.' : '.');
      out += '[' + shn(m[1]) + m[2] + (m[4] ? ':' + (m[3] ? shn(m[3]) : '.') + m[4] : '') + ']'; i += m[0].length; continue;
    }
    out += f[i] === ',' ? ';' : f[i]; i++;
  }
  return 'of:=' + out;
}
function fromOdfFormula(f) {
  f = f.replace(/^of:=?/i, '').replace(/^=/, '');
  let out = '', i = 0;
  while (i < f.length) {
    if (f[i] === '"') { let j = i + 1; while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
    if (f[i] === '[') {
      const j = f.indexOf(']', i), body = f.slice(i + 1, j), parts = body.split(':').map((p) => { const mm = /^(?:\$?('[^']+'|[^.\]]*))?\.(.*)$/.exec(p); return mm ? (mm[1] ? (/^[A-Za-z_][\w.]*$/.test(mm[1].replace(/^'|'$/g, '')) ? mm[1].replace(/^'|'$/g, '') : "'" + mm[1].replace(/^'|'$/g, '') + "'") + '!' : '') + mm[2] : p; });
      out += parts.length === 2 ? parts[0] + ':' + parts[1].replace(/^[^!]*!/, '') : parts[0]; i = j + 1; continue;
    }
    out += f[i] === ';' ? ',' : f[i]; i++;
  }
  return out;
}
function exportODS(wb) {
  const add = loss();
  let body = '';
  wb.sheets.forEach((sh, s) => {
    const b = wb.bounds(s);
    body += '<table:table table:name="' + xe(sh.name) + '">';
    for (let c = 0; c < Math.max(1, b.cols); c++) body += '<table:table-column table:style-name="co' + (sh.colw.has(c) ? sh.colw.get(c) : sh.defaultColW) + '"/>';
    for (let r = 0; r < b.rows; r++) {
      body += '<table:table-row>';
      for (let c = 0; c < b.cols; c++) {
        const x = wb.cell(s, r, c), v = x ? x.val : null;
        if (!x || (v === null && !x.f)) { body += '<table:table-cell/>'; continue; }
        const fa = x.f ? ' table:formula="' + xe(toOdfFormula(x.f)) + '"' : '';
        if (typeof v === 'number') body += '<table:table-cell' + fa + ' office:value-type="' + (/%/.test(wb.fmtCode(x)) ? 'percentage' : 'float') + '" office:value="' + v + '"><text:p>' + xe(wb.display(s, r, c)) + '</text:p></table:table-cell>';
        else if (typeof v === 'boolean') body += '<table:table-cell' + fa + ' office:value-type="boolean" office:boolean-value="' + v + '"><text:p>' + (v ? 'TRUE' : 'FALSE') + '</text:p></table:table-cell>';
        else if (C.isErr(v)) body += '<table:table-cell' + fa + ' office:value-type="string" office:string-value=""><text:p>' + xe(v.err) + '</text:p></table:table-cell>';
        else if (v === null) body += '<table:table-cell' + fa + '/>';
        else body += '<table:table-cell' + fa + ' office:value-type="string"><text:p>' + xe(v) + '</text:p></table:table-cell>';
      }
      body += '</table:table-row>';
    }
    body += '</table:table>';
  });
  const widths = new Set(); wb.sheets.forEach((sh) => { widths.add(sh.defaultColW); for (const w of sh.colw.values()) widths.add(w); });
  const colStyles = [...widths].map((w) => '<style:style style:name="co' + w + '" style:family="table-column"><style:table-column-properties style:column-width="' + (w * 0.0875).toFixed(3) + 'in"/></style:style>').join('');
  const content = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles>' + colStyles + '</office:automatic-styles><office:body><office:spreadsheet>' + body + '</office:spreadsheet></office:body></office:document-content>';
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>';
  add('styles-not-written', 'lossy', 'ODS output keeps values, formulas and column widths; bold/italic/alignment/number formats are not written');
  if (wb.charts.length) add('charts-dropped', 'lossy', 'charts are not written to ODS', wb.charts.length);
  return { bytes: zipWrite([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['META-INF/manifest.xml', manifest], ['content.xml', content]]), loss: add.list() };
}
function importODS(bytes, opts = {}) {
  const add = loss(), z = zipRead(bytes), xml = z.text('content.xml');
  if (!xml) throw new Error('not an ODS file (no content.xml)');
  const wb = new C.Workbook({ mode: opts.mode, sheets: 0 });
  const unknownFns = new Map();
  wb.batch(() => {
    const tre = /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g; let tm;
    while ((tm = tre.exec(xml))) {
      const ta = attrs(tm[1]);
      if (wb.sheets.length >= 16) { add('sheets-dropped', 'lossy', 'xCCalc keeps at most 16 sheets'); break; }
      const s = wb.addSheet(wb.sheetIndex(ta['table:name']) >= 0 ? ta['table:name'] + '_' + wb.sheets.length : ta['table:name']);
      let r = 0;
      const rre = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g; let rm;
      while ((rm = rre.exec(tm[2]))) {
        const ra = attrs(rm[1]), rrep = Math.min(+(ra['table:number-rows-repeated'] || 1), 1000);
        if (!rm[2] || r >= C.MAXROW) { r += +(ra['table:number-rows-repeated'] || 1); continue; }
        const cre = /<(table:table-cell|table:covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g; let cm, c = 0;
        const cells = [];
        while ((cm = cre.exec(rm[2]))) {
          const ca = attrs(cm[2]), rep = +(ca['table:number-columns-repeated'] || 1), vt = ca['office:value-type'];
          let val = null, fmt = null;
          if (cm[1] === 'table:covered-table-cell') add('merged-cells-dropped', 'lossy', 'merged ranges are not supported');
          if (vt === 'float' || vt === 'percentage' || vt === 'currency') { const n = wb.num.parse(ca['office:value']); val = isNaN(n) ? null : n; if (vt === 'percentage') fmt = '0%'; if (vt === 'currency') fmt = '$#,##0.00'; }
          else if (vt === 'boolean') val = ca['office:boolean-value'] === 'true';
          else if (vt === 'date') { const d = Date.parse(ca['office:date-value'] + (ca['office:date-value'].length === 10 ? 'T00:00:00Z' : 'Z')); if (!isNaN(d)) { val = C.dateToSerial(new Date(d)); fmt = ca['office:date-value'].length > 10 ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd'; } }
          else if (vt === 'string') val = ca['office:string-value'] !== undefined ? ca['office:string-value'] : (cm[3] || '').split(/<\/text:p>/).map((p) => xd(p.replace(/<[^>]*>/g, ''))).filter((p, i, a) => i < a.length - 1 || p).join('\n');
          const f = ca['table:formula'] ? fromOdfFormula(ca['table:formula']) : null;
          if (val !== null || f || fmt) cells.push({ c, rep: Math.min(rep, f ? 1 : 256), val, fmt, f });
          c += rep;
        }
        for (let k = 0; k < rrep; k++) for (const x of cells) for (let q = 0; q < x.rep; q++) {
          const cc = x.c + q; if (cc >= C.MAXCOL) break;
          if (x.f) { for (const fnm of x.f.replace(/"[^"]*"/g, '').match(/[A-Za-z_][A-Za-z0-9_.]*(?=\()/g) || []) if (!wb.E.FN[fnm.toUpperCase()]) unknownFns.set(fnm.toUpperCase(), (unknownFns.get(fnm.toUpperCase()) || 0) + 1); wb.setFormula(s, r + k, cc, x.f); }
          else if (x.val !== null) wb.setValue(s, r + k, cc, x.val);
          if (x.fmt) wb.setFormat(s, r + k, cc, x.fmt);
        }
        r += +(ra['table:number-rows-repeated'] || 1);
      }
    }
  });
  wb.recompileAll();
  for (const [fnm, n] of unknownFns) add('unsupported-function:' + fnm, 'lossy', 'function ' + fnm + ' is not implemented; cells show #NAME?', n);
  add('styles-not-read', 'lossy', 'ODS cell styles, number formats (except percent/currency/date types), widths and fonts are not read');
  return { wb, loss: add.list() };
}

// ---------- HTML ----------
function exportHTML(wb, s, opts = {}) {
  const b = wb.bounds(s), sh = wb.sheets[s];
  let h = '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + xe(sh.name) + '</title><style>table{border-collapse:collapse;font:14px Georgia,serif}td,th{border:1px solid #999;padding:2px 6px}th{background:#eee}</style></head><body>\n<table>\n';
  if (opts.headers !== false) { h += '<tr><th></th>'; for (let c = 0; c < b.cols; c++) h += '<th>' + C.colName(c) + '</th>'; h += '</tr>\n'; }
  for (let r = 0; r < b.rows; r++) {
    h += '<tr>' + (opts.headers !== false ? '<th>' + (r + 1) + '</th>' : '');
    for (let c = 0; c < b.cols; c++) {
      const x = wb.cell(s, r, c), st = x ? x.st : 0, al = wb.align(s, r, c);
      const style = (al === 'r' ? 'text-align:right;' : al === 'c' ? 'text-align:center;' : '') + (st & 1 ? 'font-weight:bold;' : '') + (st & 2 ? 'font-style:italic;' : '') + (st & 4 ? 'text-decoration:underline;' : '');
      h += '<td' + (style ? ' style="' + style + '"' : '') + '>' + xe(wb.display(s, r, c)) + '</td>';
    }
    h += '</tr>\n';
  }
  h += '</table>\n</body></html>\n';
  const add = loss(); add('formulas-to-values', 'lossy', 'HTML shows results only', 1);
  return { text: h, bytes: U.enc(h), loss: add.list() };
}

module.exports = { importCSV, exportCSV, importXLSX, exportXLSX, importODS, exportODS, exportHTML, parseCSV, detectDelimiter, decodeText, encodeText, zipWrite, zipRead, toOdfFormula, fromOdfFormula };
