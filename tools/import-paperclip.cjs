// PaperClip (Batteries Included, 1985) document importer. See docs/formats/paperclip.md.
// Headerless: ATASCII text, EOL $9B, in-line formatting codes in $7E and $80-$9F.
function read(buf) {
  const out = [];
  let b = 0, u = 0, sup = 0, sub = 0, i = 0, it = 0;
  let p = { align: 'l', bullet: false, runs: [] }, t = '', skip = false, any = false;
  const put = () => { if (t) p.runs.push({ t, b, i: it, u, sup, sub }); t = ''; };
  const eol = () => {
    put();
    if (!skip) { if (!p.runs.length) p.runs.push({ t: '', b, i: it, u, sup, sub }); out.push(p); }
    p = { align: 'l', bullet: false, runs: [] }; skip = false; any = false;
  };
  for (let k = 0; k < buf.length; k++) {
    const c = buf[k];
    if (c === 0x9b) { eol(); continue; }
    any = true;
    if (c === 0x7e) { t += '    '; continue; }
    if (c >= 0x80 && c <= 0x9f) {
      if (c === 0x94 && t === '' && !p.runs.length) { skip = true; continue; } // special/dot line (header etc.)
      if (c === 0x8c || c === 0x92) { // left/right margin: code, decimal digits, EOL
        while (k + 1 < buf.length && buf[k + 1] >= 0x30 && buf[k + 1] <= 0x39) k++;
        if (buf[k + 1] === 0x9b) k++;
        continue;
      }
      put();
      if (c === 0x82) b = 1; else if (c === 0x81) b = 0;
      else if (c === 0x95) u = 1; else if (c === 0x80) u = 0;
      else if (c === 0x85) { sup = 1; sub = 0; } else if (c === 0x84) { sub = 1; sup = 0; }
      else if (c === 0x86) { sup = 0; sub = 0; }
      else if (c === 0x83) p.align = 'c';
      else if (c === 0x87) p.align = 'r';
      continue;
    }
    if (skip) continue;
    if (c >= 0x20 && c < 0x7f) t += String.fromCharCode(c);
  }
  if (any || t || p.runs.length) eol();
  return out;
}

module.exports = { read };
