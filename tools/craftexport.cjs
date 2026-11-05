// Exports a Craft Word document (docs/CRAFT-FORMAT.md) to other formats.
// Usage: node tools/craftexport.cjs FILE.CWD OUTPUT [--format text|atascii|rtf|html|md] [--eol crlf|lf|cr]
// The format defaults to the output extension: .txt text, .atx atascii, .rtf, .htm/.html, .md.
const fs = require('fs'), path = require('path');
const { parse } = require('./craftdoc.cjs');

const STYLE = { 1: 'b', 2: 'i', 3: 'u', 4: 'inv', 11: 'sup', 12: 'sub' };
// Paragraphs of { align, bullet, runs: [{ t, b, i, u, sup, sub }] }; soft line breaks (14) are joined, hard (13) end the paragraph.
function model(payload, opt = {}) {
  const out = []; const on = { b: 0, i: 0, u: 0, inv: 0, sup: 0, sub: 0 };
  let p = { align: 'l', bullet: false, runs: [] };
  for (const b of payload) {
    if (b === 13) { out.push(p); p = { align: 'l', bullet: false, runs: [] }; }
    else if (b === 14) { const l = p.runs[p.runs.length - 1]; if (!l || !/\s$/.test(l.t)) p.runs.push({ t: ' ', ...on }); }
    else if (b < 32) {
      if (STYLE[b]) on[STYLE[b]] ^= 1;
      else if (b === 15) p.align = 'c'; else if (b === 16) p.align = 'r'; else if (b === 17) p.align = 'j';
      else if (b === 19 || b === 20) p.bullet = true;
    } else {
      const ch = b === 160 ? '\u00a0' : b === 173 ? '\u2011' : b >= 128 && b < 160 ? (opt.graphics ? String.fromCharCode(0xe000 + b) : '\u25a1') : String.fromCharCode(b);
      const l = p.runs[p.runs.length - 1];
      if (l && l.b === on.b && l.i === on.i && l.u === (on.u | on.inv) && l.sup === on.sup && l.sub === on.sub) l.t += ch;
      else p.runs.push({ t: ch, b: on.b, i: on.i, u: on.u | on.inv, sup: on.sup, sub: on.sub });
    }
  }
  if (p.runs.length) out.push(p);
  return out;
}
const plain = (p) => p.runs.map((r) => r.t).join('');

function toText(ps, cols) {
  return ps.map((p) => {
    let t = (p.bullet ? '* ' : '') + plain(p).replace(/\u00a0/g, ' ').replace(/\u2011/g, '-').replace(/\u25a1/g, '?');
    if (p.align === 'c') t = ' '.repeat(Math.max(0, (cols - t.length) >> 1)) + t;
    else if (p.align === 'r') t = ' '.repeat(Math.max(0, cols - t.length)) + t;
    return t;
  });
}

const rtfEsc = (s) => [...s].map((c) => { const n = c.codePointAt(0); return c === '\\' || c === '{' || c === '}' ? '\\' + c : n === 160 ? '\\~' : n === 0x2011 ? '\\_' : n < 127 ? c : '\\u' + (n > 32767 ? n - 65536 : n) + '?'; }).join('');
function toRtf(ps) {
  let s = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fmodern Courier New;}}\\f0\\fs20\n';
  for (const p of ps) {
    s += '\\pard' + ({ c: '\\qc', r: '\\qr', j: '\\qj', l: '\\ql' })[p.align] + (p.bullet ? '\\fi-300\\li300 \\bullet\\tab ' : ' ');
    for (const r of p.runs) { const cw = (r.b ? '\\b' : '') + (r.i ? '\\i' : '') + (r.u ? '\\ul' : '') + (r.sup ? '\\super' : '') + (r.sub ? '\\sub' : ''); s += '{' + cw + (cw ? ' ' : '') + rtfEsc(r.t) + '}'; }
    s += '\\par\n';
  }
  return s + '}\n';
}

const hEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
function toHtml(ps, title) {
  let s = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>' + hEsc(title) + '</title></head>\n<body style="font-family:monospace">\n';
  let inList = false;
  for (const p of ps) {
    if (p.bullet && !inList) { s += '<ul>\n'; inList = true; } else if (!p.bullet && inList) { s += '</ul>\n'; inList = false; }
    const inner = p.runs.map((r) => { let t = hEsc(r.t); if (r.sup) t = '<sup>' + t + '</sup>'; if (r.sub) t = '<sub>' + t + '</sub>'; if (r.u) t = '<u>' + t + '</u>'; if (r.i) t = '<i>' + t + '</i>'; if (r.b) t = '<b>' + t + '</b>'; return t; }).join('');
    const al = { c: 'center', r: 'right', j: 'justify' }[p.align];
    s += p.bullet ? '<li>' + inner + '</li>\n' : '<p' + (al ? ' style="text-align:' + al + '"' : '') + '>' + (inner || '&nbsp;') + '</p>\n';
  }
  return s + (inList ? '</ul>\n' : '') + '</body></html>\n';
}

function toMd(ps) {
  return ps.map((p) => (p.bullet ? '- ' : '') + p.runs.map((r) => { let t = r.t.replace(/([\\\\*_`])/g, '\\$1'); if (r.b && r.i) t = '***' + t + '***'; else if (r.b) t = '**' + t + '**'; else if (r.i) t = '*' + t + '*'; return t; }).join('')).join('\n\n');
}

// Craft text to ATASCII text: printable ASCII is kept, everything else becomes '?'. Lines end in $9B.
function toAtascii(ps, cols) {
  const bytes = [];
  for (const line of toText(ps, cols)) { for (const c of line) { const n = c.charCodeAt(0); bytes.push(n >= 32 && n < 127 ? n : 63); } bytes.push(0x9b); }
  return Buffer.from(bytes);
}

function exportDoc(buf, format, name = 'document', eol = 'crlf') {
  const { h, payload } = parse(buf); const ps = model(payload); const cols = h.cols || 64;
  const nl = { crlf: '\r\n', lf: '\n', cr: '\r' }[eol];
  if (format === 'atascii') return toAtascii(ps, cols);
  if (format === 'rtf') return Buffer.from(toRtf(ps), 'latin1');
  if (format === 'html') return Buffer.from(toHtml(ps, name), 'utf8');
  if (format === 'md') return Buffer.from(toMd(ps).replace(/\n/g, nl) + nl, 'utf8');
  if (format === 'text') return Buffer.from(toText(ps, cols).join(nl) + nl, 'latin1');
  throw new Error('unknown format ' + format);
}

if (require.main === module) {
  const args = process.argv.slice(2); const pos = []; let format, eol = 'crlf';
  for (let i = 0; i < args.length; i++) { if (args[i] === '--format') format = args[++i]; else if (args[i] === '--eol') eol = args[++i]; else pos.push(args[i]); }
  if (pos.length < 2) { console.error('usage: node tools/craftexport.cjs FILE.CWD OUTPUT [--format text|atascii|rtf|html|md] [--eol crlf|lf|cr]'); process.exit(2); }
  format = format || { '.txt': 'text', '.atx': 'atascii', '.rtf': 'rtf', '.htm': 'html', '.html': 'html', '.md': 'md' }[path.extname(pos[1]).toLowerCase()] || 'text';
  const out = exportDoc(fs.readFileSync(pos[0]), format, path.basename(pos[0]), eol);
  fs.writeFileSync(pos[1], out); console.log(format + ' -> ' + pos[1] + ' (' + out.length + ' bytes)');
}

module.exports = { exportDoc, model, toText, toRtf, toHtml, toMd, toAtascii };
