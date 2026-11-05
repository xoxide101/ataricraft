// xCWriter core: no DOM, no Node-only APIs beyond Buffer (the browser bundle shims it), so Electron and other
// front ends can reuse it. Document model = tools/craftimport.cjs: paras of { align, bullet, runs: [{ t, b, i, u, sup, sub }] }.
// This file adds: model editing, format open/save with a "what was dropped" report, the Atari-matching layout,
// a minimal .docx writer, and spell suggestions. Platform facts live in PROFILES so a C64 profile can be added.
'use strict';
const I = require('./craftimport.cjs');
const E = require('./craftexport.cjs');
const D = require('./craftdoc.cjs');
const cd = require('./cdict.cjs');
const P = require('./craftpage.cjs');
const CF = require('./craftfont.cjs');

const KEYS = ['b', 'i', 'u', 'sup', 'sub'];
const KEYNAME = { b: 'bold', i: 'italic', u: 'underline', sup: 'superscript', sub: 'subscript' };

const PROFILES = {
  atari: { id: 'atari', name: 'Atari 8-bit (ACWriter)', cols: 64, rows: 20, docLimit: 11264, payloadMax: I.MAXPAYLOAD, pixelW: 320, pixelH: 192, pitch: 5, lineH: 8, ext: 'CWD' },
};

// ---- model basics ----------------------------------------------------------
const emptyPara = () => ({ align: 'l', bullet: false, runs: [] });
const newDoc = () => [emptyPara()];
const clone = (x) => JSON.parse(JSON.stringify(x));
const ptext = (p) => p.runs.map((r) => r.t).join('');
const plain = (paras) => paras.map(ptext).join('\n');

function toCells(p) {
  const c = [];
  for (const r of p.runs) for (const ch of r.t.split('')) c.push({ ch, b: r.b ? 1 : 0, i: r.i ? 1 : 0, u: r.u ? 1 : 0, sup: r.sup ? 1 : 0, sub: r.sub ? 1 : 0 });
  return c;
}
function fromCells(cells, like) {
  const runs = [];
  for (const c of cells) {
    const l = runs[runs.length - 1];
    if (l && KEYS.every((k) => l[k] === c[k])) l.t += c.ch;
    else runs.push({ t: c.ch, b: c.b, i: c.i, u: c.u, sup: c.sup, sub: c.sub });
  }
  const o = { align: like ? like.align : 'l', bullet: like ? !!like.bullet : false, runs };
  if (like && like.font) o.font = like.font;
  return o;
}
// fill in missing style keys and merge equal neighbours (importers leave keys out)
function normalize(paras) {
  const out = paras.map((p) => fromCells(toCells(p), p));
  return out.length ? out : newDoc();
}
const cmp = (a, b) => (a.p - b.p) || (a.o - b.o);
const order = (a, b) => (cmp(a, b) <= 0 ? [a, b] : [b, a]);
const docEnd = (paras) => ({ p: paras.length - 1, o: ptext(paras[paras.length - 1]).length });

function insertText(paras, pos, text, st) {
  const cells = toCells(paras[pos.p]);
  const like = cells[pos.o - 1] || cells[pos.o] || {};
  const s = st || { b: like.b || 0, i: like.i || 0, u: like.u || 0, sup: like.sup || 0, sub: like.sub || 0 };
  const parts = String(text).replace(/\r\n?/g, '\n').split('\n');
  const mkc = (str) => str.split('').map((ch) => ({ ch, ...s }));
  const head = cells.slice(0, pos.o), tail = cells.slice(pos.o), src = paras[pos.p];
  if (parts.length === 1) { paras[pos.p] = fromCells(head.concat(mkc(parts[0]), tail), src); return { p: pos.p, o: pos.o + parts[0].length }; }
  const np = [fromCells(head.concat(mkc(parts[0])), src)];
  for (let k = 1; k < parts.length - 1; k++) np.push(fromCells(mkc(parts[k]), src));
  const last = parts[parts.length - 1];
  np.push(fromCells(mkc(last).concat(tail), src));
  paras.splice(pos.p, 1, ...np);
  return { p: pos.p + parts.length - 1, o: last.length };
}

function deleteRange(paras, a, b) {
  [a, b] = order(a, b);
  if (!cmp(a, b)) return a;
  const first = toCells(paras[a.p]), last = toCells(paras[b.p]);
  paras.splice(a.p, b.p - a.p + 1, fromCells(first.slice(0, a.o).concat(last.slice(b.o)), paras[a.p]));
  return a;
}

function styleRange(paras, a, b, key, val) {
  [a, b] = order(a, b);
  for (let p = a.p; p <= b.p; p++) {
    const cells = toCells(paras[p]);
    const s = p === a.p ? a.o : 0, e = p === b.p ? b.o : cells.length;
    for (let k = s; k < e; k++) {
      cells[k][key] = val ? 1 : 0;
      if (val && key === 'sup') cells[k].sub = 0; else if (val && key === 'sub') cells[k].sup = 0;
    }
    paras[p] = fromCells(cells, paras[p]);
  }
}
// true when every character in the range has the style (or, for an empty range, the character before the caret)
function hasStyle(paras, a, b, key) {
  [a, b] = order(a, b);
  if (!cmp(a, b)) { const c = toCells(paras[a.p])[a.o - 1]; return !!(c && c[key]); }
  let any = false;
  for (let p = a.p; p <= b.p; p++) {
    const cells = toCells(paras[p]);
    for (let k = p === a.p ? a.o : 0; k < (p === b.p ? b.o : cells.length); k++) { any = true; if (!cells[k][key]) return false; }
  }
  return any;
}

function getFragment(paras, a, b) {
  [a, b] = order(a, b);
  const out = [];
  for (let p = a.p; p <= b.p; p++) {
    const cells = toCells(paras[p]);
    out.push(fromCells(cells.slice(p === a.p ? a.o : 0, p === b.p ? b.o : cells.length), paras[p]));
  }
  return out;
}
function insertFragment(paras, pos, frag) {
  if (!frag.length) return pos;
  const cells = toCells(paras[pos.p]), head = cells.slice(0, pos.o), tail = cells.slice(pos.o), src = paras[pos.p];
  if (frag.length === 1) { const f = toCells(frag[0]); paras[pos.p] = fromCells(head.concat(f, tail), src); return { p: pos.p, o: pos.o + f.length }; }
  const np = [fromCells(head.concat(toCells(frag[0])), src)];
  for (let k = 1; k < frag.length - 1; k++) np.push(clone(frag[k]));
  const lc = toCells(frag[frag.length - 1]);
  np.push(fromCells(lc.concat(tail), frag[frag.length - 1]));
  paras.splice(pos.p, 1, ...np);
  return { p: pos.p + frag.length - 1, o: lc.length };
}

// ---- Craft text / Atari fit --------------------------------------------------
function cleanParas(paras) {
  return paras.map((p) => ({ align: p.align, bullet: p.bullet, ...(p.font ? { font: p.font } : {}), runs: p.runs.map((r) => ({ ...r, t: I.clean(r.t.replace(/\t/g, '    ')) })) }));
}
const charOk = (ch) => { const c = ch.codePointAt(0); return (c >= 32 && c < 127) || c === 160 || (c >= 161 && c <= 255 && c !== 173); };

// page (tools/craftpage.cjs setup) switches wrapping from the profile's screen columns to the page's usable columns.
function craftPayload(paras, profile = PROFILES.atari, page = null) {
  const ps = normalize(paras);
  return page ? I.layout(cleanParas(P.expandTabs(ps, page)), P.normalize(page)) : I.layout(cleanParas(ps), profile.cols);
}
function fit(paras, profile = PROFILES.atari, page = null) {
  const bytes = craftPayload(paras, profile, page).length;
  return { bytes, limit: profile.docLimit, pct: Math.round((bytes * 1000) / profile.docLimit) / 10, over: Math.max(0, bytes - profile.docLimit) };
}

// Craft document file from the model. Cuts at the last line end that fits `limit` (ACWriter's document area).
function toCwd(paras, opt = {}) {
  const prof = opt.profile || PROFILES.atari, limit = opt.limit || prof.docLimit;
  if (opt.page) opt = { ...opt, page: { ...opt.page, fonts: P.fontRecords(paras, opt.page.font) } };
  let bytes = craftPayload(paras, prof, opt.page), truncated = false, dropped = 0;
  if (bytes.length > limit) {
    let cut = limit; while (cut > 0 && bytes[cut - 1] !== 13 && bytes[cut - 1] !== 14) cut--;
    dropped = bytes.length - cut; bytes = bytes.slice(0, cut); truncated = true;
  }
  const lines = bytes.filter((b) => b === 13 || b === 14).length;
  return { file: I.build(bytes, prof.cols, lines, opt.page), truncated, dropped, bytes: bytes.length, lines };
}

// Screen lines exactly as ACWriter wraps them: parse the payload that craftimport's layout() writes.
// cells carry the paragraph index p and character offset o, so an editor can map caret <-> screen.
function atariLines(paras, profile = PROFILES.atari, page = null) {
  const bytes = craftPayload(paras, profile, page), lines = [];
  const on = { b: 0, i: 0, u: 0, sup: 0, sub: 0 }, CODE = { 1: 'b', 2: 'i', 3: 'u', 4: 'u', 11: 'sup', 12: 'sub' };
  let p = 0, o = 0, align = 'l', bullet = false, first = true, cells = [], start = 0;
  for (const b of bytes) {
    if (b === 13 || b === 14) {
      lines.push({ p, o0: start, cells, align, bullet, first, last: b === 13 });
      cells = []; start = o; first = b === 13;
      if (b === 13) { p++; o = 0; start = 0; align = 'l'; bullet = false; for (const k of KEYS) on[k] = 0; }
    } else if (b < 32) {
      if (CODE[b]) on[CODE[b]] ^= 1; else if (b === 15) align = 'c'; else if (b === 16) align = 'r'; else if (b === 17) align = 'j'; else if (b === 19 || b === 20) bullet = true;
    } else { cells.push({ ch: String.fromCharCode(b), b: on.b, i: on.i, u: on.u, sup: on.sup, sub: on.sub, p, o }); o++; }
  }
  if (!lines.length) lines.push({ p: 0, o0: 0, cells: [], align: 'l', bullet: false, first: true, last: true });
  return lines;
}

// what the Atari cannot show for this document
function atariWarnings(paras, profile = PROFILES.atari) {
  const w = [], seen = new Map(); let tabs = 0, translit = 0, lost = 0;
  const TL = ['\u2018', '\u2019', '\u201c', '\u201d', '\u2013', '\u2014', '\u2026', '\u2022', '\u20ac', '\u2122', '\u00ad'];
  for (const p of paras) for (const r of p.runs) for (const ch of r.t) {
    if (ch === '\t') { tabs++; continue; }
    if (charOk(ch) || (ch.codePointAt(0) >= 0xe080 && ch.codePointAt(0) <= 0xe09f)) continue;
    seen.set(ch, (seen.get(ch) || 0) + 1);
    if (TL.includes(ch)) translit++; else lost++;
  }
  if (translit) w.push(translit + ' character(s) have an Atari look-alike (curly quotes, dashes, ellipsis...) and become plain ASCII');
  if (lost) w.push(lost + ' character(s) are not in the Atari set and become ?: ' + [...seen.keys()].filter((c) => !TL.includes(c)).slice(0, 12).join(' '));
  if (tabs) w.push(tabs + ' tab(s) become 4 spaces');
  const f = fit(paras, profile);
  if (f.over) w.push('document is ' + f.over + ' bytes over the ' + f.limit + ' byte ACWriter limit; the end will be cut');
  return w;
}

// ---- formats -----------------------------------------------------------------
const SAVE_FORMATS = [
  { id: 'cwd', label: 'Craft document (.CWD)', ext: 'cwd', mime: 'application/octet-stream' },
  { id: 'text', label: 'Plain text (.txt)', ext: 'txt', mime: 'text/plain' },
  { id: 'atascii', label: 'ATASCII text (EOL $9B)', ext: 'atx', mime: 'application/octet-stream' },
  { id: 'rtf', label: 'Rich Text (.rtf)', ext: 'rtf', mime: 'application/rtf' },
  { id: 'html', label: 'HTML (.html)', ext: 'html', mime: 'text/html' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
  { id: 'docx', label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
];
const OPEN_FORMATS = [
  { id: 'auto', label: 'Auto-detect' }, { id: 'craft', label: 'Craft document (.CWD)' }, { id: 'text', label: 'Plain text' }, { id: 'atascii', label: 'ATASCII / AtariWriter text' },
  { id: 'rtf', label: 'Rich Text (.rtf)' }, { id: 'html', label: 'HTML' }, { id: 'md', label: 'Markdown' }, { id: 'docx', label: 'Word .docx' }, { id: 'doc', label: 'Word 97-2003 .doc (text only)' },
  { id: 'letterperfect', label: 'Letter Perfect (Atari)' }, { id: 'paperclip', label: 'PaperClip (Atari)' }, { id: 'firstxlent', label: 'First XLEnt Word Processor (Atari)' },
  { id: 'textwizard', label: 'Text Wizard (Atari)' }, { id: 'bankstreet', label: 'Bank Street Writer (Atari, text file or ATR image)' },
];
const FMT_NAME = { cwd: 'CWD', text: 'plain text', atascii: 'ATASCII', rtf: 'RTF', html: 'HTML', md: 'Markdown', docx: 'DOCX' };

// Importers that can only be chosen by hand: detect() returns 'text' or 'atascii' for them.
function openDoc(buf, name, opt = {}) {
  buf = Buffer.from(buf);
  const fmt = !opt.format || opt.format === 'auto' ? I.detect(buf, name) : opt.format;
  const r = I.toModel(buf, name, { format: fmt, unicode: opt.unicode !== false, allowCraft: true });
  const notes = [];
  if (fmt === 'doc') notes.push('Legacy .doc: text only, formatting is not read');
  if (r.format === 'bankstreet' && buf[0] === 0x96) notes.push('Took the first document on the disk image');
  if (r.mixedFonts) notes.push(r.mixedFonts + ' paragraph(s) mix fonts on one line; Craft allows one font per line, so the dominant font is used for the whole line');
  const page = r.format === 'craft' ? D.parse(buf).h.page : null;
  const model = normalize(r.paras);
  if (page) P.applyFonts(model, page);
  return { format: r.format, paras: model, notes, page };
}

function styleCounts(paras) {
  const n = { b: 0, i: 0, u: 0, sup: 0, sub: 0, bullet: 0, c: 0, r: 0, j: 0, nonascii: 0, nonlatin: 0 };
  for (const p of paras) {
    if (p.bullet) n.bullet++;
    if (n[p.align] !== undefined) n[p.align]++;
    for (const r of p.runs) {
      for (const k of KEYS) if (r[k]) n[k] += r.t.length;
      for (const ch of r.t) { const c = ch.codePointAt(0); if (c > 126) n.nonascii++; if (!charOk(ch) && c > 126) n.nonlatin++; }
    }
  }
  return n;
}
// Human-readable list of what a format cannot keep.
function dropReport(paras, fmt) {
  const n = styleCounts(paras), out = [], nm = FMT_NAME[fmt] || fmt;
  const drop = (keys) => { for (const k of keys) if (n[k]) out.push(KEYNAME[k] + ' dropped for ' + nm + ' (' + n[k] + ' characters)'); };
  if (fmt === 'atascii' || fmt === 'text') {
    drop(KEYS);
    if (n.bullet) out.push('bullets become "* " for ' + nm + ' (' + n.bullet + ')');
    if (n.c || n.r) out.push('centre/right alignment approximated with spaces for ' + nm);
    if (n.j) out.push('justify dropped for ' + nm);
  } else if (fmt === 'md') {
    drop(['u', 'sup', 'sub']);
    if (n.c || n.r || n.j) out.push('alignment dropped for Markdown');
  }
  if (fmt === 'atascii' && n.nonascii) out.push(n.nonascii + ' non-ASCII character(s) become ? for ATASCII');
  if (fmt === 'cwd') {
    for (const w of atariWarnings(paras)) out.push(w);
    out.push('font, size and line spacing are not stored in a .CWD');
  }
  return out;
}

const u8 = (s, enc) => Buffer.from(s, enc);
function save(paras, fmt, opt = {}) {
  paras = normalize(paras);
  const name = opt.name || 'document', cols = opt.cols || 64, nl = { crlf: '\r\n', lf: '\n', cr: '\r' }[opt.eol || 'crlf'];
  const report = dropReport(paras, fmt);
  let bytes;
  if (fmt === 'cwd') {
    const r = toCwd(paras, opt); bytes = r.file;
    if (r.truncated) report.unshift('document cut at ' + r.bytes + ' bytes to fit ACWriter: ' + r.dropped + ' bytes dropped');
  } else if (fmt === 'text') bytes = u8(E.toText(paras, cols).join(nl) + nl, opt.atari ? 'latin1' : 'utf8');
  else if (fmt === 'atascii') bytes = E.toAtascii(cleanParas(paras), cols);
  else if (fmt === 'rtf') bytes = u8(E.toRtf(paras), 'latin1');
  else if (fmt === 'html') bytes = u8(E.toHtml(paras, name), 'utf8');
  else if (fmt === 'md') bytes = u8(E.toMd(paras).replace(/\n/g, nl) + nl, 'utf8');
  else if (fmt === 'docx') bytes = toDocx(paras, opt);
  else throw new Error('unknown format ' + fmt);
  const f = SAVE_FORMATS.find((x) => x.id === fmt);
  return { bytes, report, ext: f.ext, mime: f.mime };
}

// ---- minimal .docx writer (zip, stored entries: valid, not compressed) --------
let CRC = null;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const parts = [], cen = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8'), d = Buffer.from(data), crc = crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, d); cen.push(ch, nb); off += 30 + nb.length + d.length;
  }
  const cdir = Buffer.concat(cen), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdir.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdir, end]);
}
const xEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]/g, '\u25a1');
function toDocx(paras, opt = {}) {
  const font = (opt.font || 'Calibri').replace(/[<>&"]/g, ''), half = Math.round((opt.size || 11) * 2);
  let body = '';
  for (const p of paras) {
    const jc = { c: 'center', r: 'right', j: 'both' }[p.align];
    body += '<w:p><w:pPr>' + (p.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '') + (jc ? '<w:jc w:val="' + jc + '"/>' : '') + '</w:pPr>';
    for (const r of p.runs) {
      if (!r.t) continue;
      const rpr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.u ? '<w:u w:val="single"/>' : '') + (r.sup ? '<w:vertAlign w:val="superscript"/>' : r.sub ? '<w:vertAlign w:val="subscript"/>' : '');
      body += '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xEsc(r.t) + '</w:t></w:r>';
    }
    body += '</w:p>';
  }
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipStore([
    ['[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'],
    ['_rels/.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + R + '/numbering" Target="numbering.xml"/></Relationships>'],
    ['word/styles.xml', H + '<w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:cs="' + font + '"/><w:sz w:val="' + half + '"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'],
    ['word/numbering.xml', H + '<w:numbering ' + W + '><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'],
    ['word/document.xml', H + '<w:document ' + W + '><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'],
  ]);
}

// ---- spelling (docs/DICTIONARY.md) -----------------------------------------------
const isLetter = (ch) => !!ch && /\p{L}/u.test(ch);
function spellCheck(dict, paras, ignore) {
  const out = [];
  paras.forEach((p, pi) => {
    const t = ptext(p);
    for (const tk of cd.tokens(t)) {
      if (isLetter(t[tk.index - 1]) || isLetter(t[tk.index + tk.word.length])) continue;
      if (cd.has(dict, tk.word) || cd.has(dict, tk.word.toLowerCase())) continue;
      if (ignore && ignore.has(tk.word.toLowerCase())) continue;
      out.push({ p: pi, start: tk.index, end: tk.index + tk.word.length, word: tk.word });
    }
  });
  return out;
}
function suggest(dict, word, max = 6) {
  const lw = word.toLowerCase().replace(/[^a-z']/g, ''), AL = "abcdefghijklmnopqrstuvwxyz'";
  const edits = (w) => {
    const tr = [], rp = [], de = [], ins = [];
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b.length > 1) tr.push(a + b[1] + b[0] + b.slice(2));
      if (b) de.push(a + b.slice(1));
      for (const c of AL) { if (b) rp.push(a + c + b.slice(1)); ins.push(a + c + b); }
    }
    return new Set([...tr, ...rp, ...de, ...ins].filter((x) => x !== w));
  };
  const good = (s) => s.length > 1 && cd.has(dict, s);
  let found = [...edits(lw)].filter(good);
  if (found.length < 2 && lw.length > 2 && lw.length <= 9) {
    const seen = new Set(found);
    for (const e of edits(lw)) for (const e2 of edits(e)) if (!seen.has(e2) && good(e2)) { seen.add(e2); found.push(e2); }
  }
  const cap = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase(), all = word === word.toUpperCase() && word.length > 1;
  return found.slice(0, max).map((s) => (all ? s.toUpperCase() : cap ? s[0].toUpperCase() + s.slice(1) : s));
}

module.exports = {
  Page: P, Font: CF, PROFILES, KEYS, SAVE_FORMATS, OPEN_FORMATS,
  emptyPara, newDoc, clone, ptext, plain, toCells, fromCells, normalize, cmp, order, docEnd,
  insertText, deleteRange, styleRange, hasStyle, getFragment, insertFragment,
  cleanParas, charOk, craftPayload, fit, toCwd, atariLines, atariWarnings,
  openDoc, save, dropReport, styleCounts, toDocx, zipStore, crc32, spellCheck, suggest,
  detect: (b, n) => I.detect(Buffer.from(b), n), parseCwd: (b) => D.parse(Buffer.from(b)), dictParse: (b) => cd.parse(Buffer.from(b)), dictHas: cd.has,
};
