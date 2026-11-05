// Importer for "The First XLEnt Word Processor" documents (plain ATASCII text, no header).
// See docs/formats/firstxlent.md. read(buf, opts) -> [{ align, bullet, runs: [{ t, b, i, u, sup, sub }] }]
// opts.printerCodes: true maps Option+B / Option+I / Option+U (inverse letters, meaning is defined by the
// printer driver and NOT verified) to bold / italic / underline toggles. Default: those codes are dropped.
'use strict';

const CENTER = 0xc3;      // inverse C at line start: centre; twice: flush right
const FORMAT = 0xc6;      // inverse F at line start: format line (layout directives)
const NBSP = 0xa0;        // Option+Space: protected space

function applyFormatLine(text, st) {
  for (const d of text.split(':')) {
    const m = /^(cn|ra|ju)\s*([01])?\s*$/i.exec(d.trim());
    if (!m) continue;
    const on = m[2] !== '0', k = m[1].toLowerCase();
    if (on) st.align = { cn: 'c', ra: 'r', ju: 'j' }[k];
    else if (st.align === { cn: 'c', ra: 'r', ju: 'j' }[k]) st.align = 'l';
  }
}

function read(buf, opts) {
  const printerCodes = !!(opts && opts.printerCodes);
  const out = [];
  const st = { align: 'l' };
  let start = 0;
  const lines = [];
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x9b) {
      if (i > start || i < buf.length) lines.push(buf.slice(start, i));
      start = i + 1;
    }
  }
  for (const ln of lines) {
    if (ln.length && ln[0] === FORMAT) {
      applyFormatLine(Buffer.from(ln.slice(1)).toString('latin1'), st);
      continue;
    }
    const p = { align: st.align, bullet: false, runs: [] };
    let k = 0, n = 0;
    while (k < ln.length && ln[k] === CENTER) { n++; k++; }
    if (n === 1) p.align = 'c'; else if (n >= 2) p.align = 'r';
    const cur = { b: 0, i: 0, u: 0, sup: 0, sub: 0 };
    let t = '';
    const put = () => { if (t) p.runs.push({ t, ...cur }); t = ''; };
    for (; k < ln.length; k++) {
      const c = ln[k];
      if (c === NBSP) { t += ' '; continue; }
      if (c >= 0x20 && c < 0x7f) { t += String.fromCharCode(c); continue; }
      if (printerCodes && c >= 0xc1 && c <= 0xda) {
        const key = { 0xc2: 'b', 0xc9: 'i', 0xd5: 'u' }[c];
        if (key) { put(); cur[key] ^= 1; }
      }
      // everything else (control chars 1-26, soft hyphen, user chars, other inverse codes) is dropped
    }
    put();
    if (!p.runs.length) p.runs.push({ t: '', ...cur });
    out.push(p);
  }
  return out;
}

module.exports = { read };
