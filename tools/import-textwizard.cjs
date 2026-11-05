'use strict';
// Importer for Text Wizard / Letter Wizard (Datasoft, Atari 8-bit) documents. See docs/formats/textwizard.md.
// A document is a plain ATASCII text file: lines end in $9B, formatting is embedded Ctrl-letter codes.
// read(buf) -> [{ align, bullet, runs: [{ t, b, i, u, sup, sub }] }]
const para = () => ({ align: 'l', bullet: false, runs: [] });

// Codes followed by a decimal argument (ASCII digits) and the maximum digits taken (from the reference card).
const ARG = { 0x0c: 3, 0x12: 3, 0x09: 2, 0x04: 3, 0x19: 3, 0x01: 1, 0x13: 3, 0x0d: 2, 0x0e: 3, 0x11: 2 };
// Codes that take the rest of the line as a phrase (header/footer) or file name (chain): not body text.
const LINE_CMD = new Set([0x07, 0x08, 0x16]);

function read(buf) {
  const out = [];
  let u = 0, sup = 0, sub = 0, just = 0;
  let start = 0;
  const lines = [];
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x9b) { if (i > start || i < buf.length) lines.push(buf.subarray(start, i)); start = i + 1; }
  }
  for (const ln of lines) {
    const p = para();
    let k = 0, sawCmd = false;
    if (ln.length && LINE_CMD.has(ln[0])) continue;
    while (k < ln.length && ln[k] === 0x03) { p.align = p.align === 'c' ? 'r' : 'c'; k++; sawCmd = true; }
    let t = '';
    const put = () => { if (t) p.runs.push({ t, b: 0, i: 0, u, sup, sub }); t = ''; };
    for (; k < ln.length; k++) {
      const c = ln[k];
      if (c === 0x15) { put(); u ^= 1; sawCmd = true; continue; }
      if (c === 0x02) { put(); sup ^= 1; if (sup) sub = 0; sawCmd = true; continue; }
      if (c === 0x06) { put(); sub ^= 1; if (sub) sup = 0; sawCmd = true; continue; }
      if (c === 0x0a) {
        // Ctrl-J(1)/(0) = justify on/off (from the reference card; the editor never stored it as a code in our tests)
        const d = ln[k + 1];
        if (d === 0x30 || d === 0x31) { just = d === 0x31 ? 1 : 0; k++; sawCmd = true; }
        continue;
      }
      if (c === 0x7f || (c === 0x09 && !(ln[k + 1] >= 0x30 && ln[k + 1] <= 0x39))) { t += '    '; continue; }
      if (ARG[c] !== undefined) {
        let n = 0;
        while (n < ARG[c] && k + 1 < ln.length && ln[k + 1] >= 0x30 && ln[k + 1] <= 0x39) { k++; n++; }
        sawCmd = true;
        continue;
      }
      if (c < 32) continue;
      if (c >= 128) continue; // inverse video = remark, not printed
      t += c < 127 ? String.fromCharCode(c) : '?';
    }
    put();
    if (!p.runs.length) {
      if (sawCmd) continue; // layout-only line
      p.runs.push({ t: '', b: 0, i: 0, u: 0, sup: 0, sub: 0 });
    }
    if (just && p.align === 'l') p.align = 'j';
    out.push(p);
  }
  return out;
}

module.exports = { read };
