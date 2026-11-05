// Imports other document formats into a Craft Word document (docs/CRAFT-FORMAT.md).
// Usage: node tools/craftimport.cjs INPUT [OUTPUT.CWD] [--format atascii|text|rtf|html|md|doc|docx|letterperfect|paperclip|firstxlent|textwizard|bankstreet] [--cols N]
// Formats: ATASCII text (incl. AtariWriter), ASCII/UTF-8 text, RTF, HTML, Markdown, Word .docx and .doc,
// and Atari Letter Perfect, PaperClip, First XLEnt, Text Wizard and Bank Street Writer (explicit --format; see docs/formats).
// AtariWriter inverse video, centre and right codes are decoded. See docs/IMPORT.md.
const fs = require('fs'), path = require('path');
const MAXPAYLOAD = 0x3fff;

// ---- detection -----------------------------------------------------------
function detect(buf, name) {
  const ext = path.extname(name || '').toLowerCase();
  const head = buf.toString('latin1', 0, 64);
  if (head.startsWith('CRFT')) return 'craft';
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^\s*<(!doctype|html|head|body|p|h[1-6]|div)\b/i.test(buf.toString('latin1', 0, 256))) return 'html';
  if (buf.length > 16 && buf[0] === 0x96 && buf[1] === 0x02 && require('./import-bankstreet.cjs').extractFromAtr(buf).length) return 'bankstreet';
  if (buf.readUInt32BE(0) === 0xd0cf11e0) return 'doc';
  if (buf.readUInt16BE(0) === 0x504b && ext === '.docx') return 'docx';
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.htm' || ext === '.html') return 'html';
  let a9b = 0, crlf = 0, lf = 0, hi = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x9b) a9b++; else if (b === 10) { lf++; if (i && buf[i - 1] === 13) crlf++; } else if (b >= 128) hi++;
  }
  if (a9b > 0 && a9b >= lf) return 'atascii';
  return 'text';
}

// ---- text mapping to Craft text ------------------------------------------
const TRANSLIT = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u2022': '*', '\u20ac': 'E', '\u2122': 'TM', '\u00ad': '-', '\u2011': '\xad' };
function toCraft(ch) {
  if (TRANSLIT[ch] !== undefined) return TRANSLIT[ch] === '\xad' ? String.fromCharCode(173) : TRANSLIT[ch];
  const c = ch.codePointAt(0);
  if (c === 9) return '    ';
  if (c >= 32 && c < 127) return ch;
  if (c === 0xa0) return String.fromCharCode(160);
  if (c >= 161 && c <= 255 && c !== 173) return ch;
  return c === 173 ? '-' : '?';
}
const clean = (s) => [...s].map(toCraft).join('');

// ---- intermediate model: paragraphs of runs --------------------------------
// paragraph = { align: 'l'|'c'|'r'|'j', bullet: bool, runs: [{ t, b, i, u, sup, sub }] }
const para = () => ({ align: 'l', bullet: false, runs: [] });

function fromAtascii(buf) {
  // Lines end in $9B. AtariWriter(+) conventions (from its manual and sample files):
  // inverse video = underline, Ctrl-C at line start = centre, two Ctrl-C = flush right,
  // a line opening with a Ctrl-letter format code and a value (margins, spacing, header...) is layout, not text.
  const out = []; let start = 0;
  const CMD = new Set([2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25]);
  const lines = []; for (let i = 0; i <= buf.length; i++) if (i === buf.length || buf[i] === 0x9b) { if (i > start || i < buf.length) lines.push(buf.slice(start, i)); start = i + 1; }
  for (const ln of lines) {
    const p = para(); let k = 0;
    if (ln.length && CMD.has(ln[0])) {
      const rest = [...ln].filter((b) => b >= 32 && b < 128).map((b) => String.fromCharCode(b)).join('');
      if (/^[\d\s]*$/.test(rest) || [6, 8, 17, 22].includes(ln[0])) continue;
    }
    while (k < ln.length && ln[k] === 3) { p.align = p.align === 'c' ? 'r' : 'c'; k++; }
    let t = '', u = 0;
    const put = () => { if (t) p.runs.push({ t, u }); t = ''; };
    for (; k < ln.length; k++) {
      const b = ln[k];
      if (b === 0x1b) { k++; continue; }
      if (b === 0x7f || b === 0x7e || b === 0xfe || b === 0xff) continue;
      if (b === 0x09) { t += '    '; continue; }
      if (b < 32) continue;
      const inv = b >= 128 ? 1 : 0, c = b & 127;
      if (inv !== u) { put(); u = inv; }
      t += c >= 32 && c < 127 ? String.fromCharCode(c) : '?';
    }
    put(); if (!p.runs.length) p.runs.push({ t: '' }); out.push(p);
  }
  return out;
}

function fromText(buf) {
  let s = buf.toString('utf8');
  if (s.includes('\ufffd')) s = buf.toString('latin1');
  s = s.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  return s.split('\n').map((l) => { const p = para(); p.runs.push({ t: clean(l) }); return p; });
}

function fromRtf(buf) {
  const s = buf.toString('latin1'); const out = []; let cur = para();
  const st = { b: 0, i: 0, u: 0, sup: 0, sub: 0 }; const stack = []; let skip = 0, depth = 0, ucSkip = 0, bulletTab = 0;
  const SKIPDEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'generator']);
  const add = (t) => { if (!skip && t) cur.runs.push({ t: clean(t), ...st }); };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { stack.push({ ...st, skip }); depth++; if (s[i + 1] === '\\' && s[i + 2] === '*') skip = skip || depth; }
    else if (c === '}') { const p = stack.pop(); if (p) { Object.assign(st, p); if (skip && depth < skip) skip = 0; else skip = p.skip; } depth--; }
    else if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i));
      if (m) {
        const w = m[1], n = m[2] === undefined ? null : +m[2]; i += m[0].length - 1;
        if (SKIPDEST.has(w) && !skip) skip = depth;
        else if (w === 'par' || w === 'line') { if (!skip) { out.push(cur); cur = para(); } }
        else if (w === 'pard') cur.align = 'l';
        else if (w === 'qc') cur.align = 'c'; else if (w === 'qr') cur.align = 'r'; else if (w === 'qj') cur.align = 'j'; else if (w === 'ql') cur.align = 'l';
        else if (w === 'b') st.b = n === 0 ? 0 : 1; else if (w === 'i') st.i = n === 0 ? 0 : 1;
        else if (w === 'ul') st.u = n === 0 ? 0 : 1; else if (w === 'ulnone') st.u = 0;
        else if (w === 'super') st.sup = 1; else if (w === 'sub') st.sub = 1; else if (w === 'nosupersub') { st.sup = 0; st.sub = 0; }
        else if (w === 'tab') { if (bulletTab) bulletTab = 0; else add('    '); } else if (w === 'emdash' || w === 'endash') add('-');
        else if (w === 'lquote' || w === 'rquote') add("'"); else if (w === 'ldblquote' || w === 'rdblquote') add('"');
        else if (w === 'bullet') { if (!skip && !cur.runs.length) { cur.bullet = true; bulletTab = 1; } else add('*'); }
        else if (w === 'u' && n !== null) { add(String.fromCodePoint(n < 0 ? n + 65536 : n)); ucSkip = 1; }
      } else {
        const n = s[i + 1]; i++;
        if (n === "'") { add(String.fromCharCode(parseInt(s.substr(i + 1, 2), 16))); i += 2; }
        else if (n === '\\' || n === '{' || n === '}') add(n);
        else if (n === '\n' || n === '\r') { if (!skip) { out.push(cur); cur = para(); } }
      }
    } else if (c !== '\n' && c !== '\r') {
      if (ucSkip) { ucSkip = 0; continue; }
      add(c);
    }
  }
  if (cur.runs.length) out.push(cur);
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));

function fromHtml(buf) {
  let s = buf.toString('utf8'); if (s.includes('\ufffd')) s = buf.toString('latin1');
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '').replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  const out = []; let cur = para(); const st = { b: 0, i: 0, u: 0, sup: 0, sub: 0 };
  const brk = () => { if (cur.runs.length) out.push(cur); cur = para(); };
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi; let m;
  while ((m = re.exec(s))) {
    if (m[4] !== undefined) { const t = decode(m[4].replace(/\s+/g, ' ')); if (t.trim() || cur.runs.length) cur.runs.push({ t: clean(t), ...st }); continue; }
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3], v = close ? 0 : 1;
    if (tag === 'b' || tag === 'strong') st.b = v; else if (tag === 'i' || tag === 'em') st.i = v; else if (tag === 'u') st.u = v;
    else if (tag === 'sup') st.sup = v; else if (tag === 'sub') st.sub = v;
    else if (tag === 'br') brk();
    else if (/^(p|div|h[1-6]|li|tr|blockquote|center|ul|ol|table)$/.test(tag)) {
      brk();
      if (!close) {
        if (/^h[1-6]$/.test(tag)) { st.b = 1; }
        if (tag === 'li') cur.bullet = true;
        if (tag === 'center' || /align\s*=\s*["']?center/i.test(attrs)) cur.align = 'c';
        else if (/align\s*=\s*["']?right/i.test(attrs)) cur.align = 'r';
      } else if (/^h[1-6]$/.test(tag)) st.b = 0;
    }
  }
  brk(); return out;
}

function fromMd(buf) {
  const out = [];
  for (const line of buf.toString('utf8').replace(/\r\n?/g, '\n').split('\n')) {
    const p = para(); let l = line, b = 0;
    const h = /^#{1,6}\s+(.*)$/.exec(l); if (h) { l = h[1]; b = 1; }
    const li = /^\s*[-*+]\s+(.*)$/.exec(l); if (li) { l = li[1]; p.bullet = true; }
    const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|([^*_`]+|[*_`])/g; let m;
    while ((m = re.exec(l))) {
      if (m[2] !== undefined) p.runs.push({ t: clean(m[2]), b: 1 }); else if (m[4] !== undefined) p.runs.push({ t: clean(m[4]), i: 1 });
      else if (m[5] !== undefined) p.runs.push({ t: clean(m[5]) }); else p.runs.push({ t: clean(m[6]), b });
    }
    if (b) p.runs.forEach((r) => { r.b = 1; });
    out.push(p);
  }
  return out;
}

// ---- layout to the Craft stream --------------------------------------------
// Wraps at `cols`, writes style toggles, alignment and bullet markers, 13 at a paragraph end and 14 at a soft wrap.
function layout(paras, cols) {
  const bytes = []; const A = { c: 15, r: 16, j: 17 };
  const on = { b: 0, i: 0, u: 0, sup: 0, sub: 0 }; const CODE = { b: 1, i: 2, u: 3, sup: 11, sub: 12 };
  for (const p of paras) {
    const width = cols - (p.bullet ? 2 : 0);
    const marks = []; if (A[p.align]) marks.push(A[p.align]); if (p.bullet) marks.push(19);
    // flatten to tokens: [char, styleKey]
    const chars = []; for (const r of p.runs) for (const ch of r.t) chars.push({ ch, b: r.b ? 1 : 0, i: r.i ? 1 : 0, u: r.u ? 1 : 0, sup: r.sup ? 1 : 0, sub: r.sub ? 1 : 0 });
    let start = 0, first = true;
    const emit = (seg, last) => {
      if (first) bytes.push(...marks);
      for (const c of seg) {
        for (const k of Object.keys(CODE)) if (c[k] !== on[k]) { bytes.push(CODE[k]); on[k] = c[k]; }
        bytes.push(c.ch.charCodeAt(0));
      }
      if (last) { for (const k of Object.keys(CODE)) if (on[k]) { bytes.push(CODE[k]); on[k] = 0; } }
      bytes.push(last ? 13 : 14); first = false;
    };
    if (!chars.length) { emit([], true); continue; }
    while (chars.length - start > width) {
      let cut = -1; for (let k = start + width - 1; k > start; k--) if (chars[k].ch === ' ') { cut = k; break; }
      const end = cut > 0 ? cut + 1 : start + width;
      emit(chars.slice(start, end), false);
      start = end;
    }
    emit(chars.slice(start), true);
  }
  return bytes;
}

function build(bytes, cols, lines) {
  const pay = Buffer.from(bytes); let sum = 0;
  for (const b of pay) sum = (sum + b) & 0xffff;
  const h = Buffer.alloc(16);
  h.write('CRFT', 0, 'latin1'); h[4] = 1; h[5] = 0x57; h.writeUInt16LE(pay.length, 8); h.writeUInt16LE(Math.min(lines, 255), 10); h[12] = cols; h[13] = 20; h.writeUInt16LE(sum, 14);
  return Buffer.concat([h, pay]);
}

function convert(buf, name, opts = {}) {
  const fmt = opts.format || detect(buf, name); const cols = opts.cols || 64;
  const O = require('./officeread.cjs');
  const req = (n) => require('./import-' + n + '.cjs').read;
  const office = (f) => (b) => f(b).map((p) => { p.runs.forEach((r) => { r.t = clean(r.t); }); return p; });
  const importers = { atascii: fromAtascii, text: fromText, rtf: fromRtf, html: fromHtml, md: fromMd, doc: office(O.readDoc), docx: office(O.readDocx),
    letterperfect: office(req('letterperfect')), paperclip: office(req('paperclip')), firstxlent: office(req('firstxlent')), textwizard: office(req('textwizard')), bankstreet: office(req('bankstreet')) };
  if (!importers[fmt]) throw new Error(fmt === 'craft' ? 'already a Craft document' : 'unknown format ' + fmt);
  let paras = importers[fmt](buf);
  while (paras.length && !paras[paras.length - 1].runs.some((r) => r.t.trim())) paras.pop();
  let bytes = layout(paras, cols), truncated = false;
  if (bytes.length > MAXPAYLOAD) { bytes = bytes.slice(0, MAXPAYLOAD); truncated = true; }
  const lines = bytes.filter((b) => b === 13 || b === 14).length;
  return { format: fmt, file: build(bytes, cols, lines), truncated, paragraphs: paras.length, bytes: bytes.length };
}

if (require.main === module) {
  const args = process.argv.slice(2); const o = {}; const pos = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--format') o.format = args[++i]; else if (args[i] === '--cols') o.cols = +args[++i]; else pos.push(args[i]); }
  if (!pos[0]) { console.error('usage: node tools/craftimport.cjs INPUT [OUTPUT.CWD] [--format atascii|text|rtf|html|md|doc|docx|letterperfect|paperclip|firstxlent|textwizard|bankstreet] [--cols N]'); process.exit(2); }
  const r = convert(fs.readFileSync(pos[0]), pos[0], o);
  const outp = pos[1] || path.join(path.dirname(pos[0]), path.basename(pos[0], path.extname(pos[0])).slice(0, 8).toUpperCase() + '.CWD');
  fs.writeFileSync(outp, r.file);
  console.log(`${r.format}: ${r.paragraphs} paragraphs, ${r.bytes} bytes${r.truncated ? ' (TRUNCATED to fit one page set)' : ''} -> ${outp}`);
}

module.exports = { convert, detect };
