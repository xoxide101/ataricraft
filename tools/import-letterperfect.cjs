'use strict';
// Importer for Letter Perfect (LJK, Atari 8-bit) documents. See docs/formats/letterperfect.md.
// read(buf): buf = the document text stream (the file's data sectors; text ends at the first $1B).
// An ATR image of a Letter Perfect disk is also accepted (the first document is read; see readDisk for all).
const para = () => ({ align: 'l', bullet: false, runs: [] });

function readDisk(img) {
  const sec = (n) => img.subarray(16 + (n - 1) * 128, 16 + n * 128);
  const docs = [];
  for (let s = 361; s <= 368; s++) {
    const d = sec(s);
    for (let i = 0; i < 8; i++) {
      const e = d.subarray(i * 16, i * 16 + 16);
      if (!e[0] || e[0] === 0xff) continue;
      const st = e[3] | (e[4] << 8);
      if (!st || st > 720) continue;
      const name = Buffer.from(e.subarray(5, 16)).toString('latin1').trimEnd();
      if (!/LP$/.test(name)) continue;
      const h = sec(st), parts = [];
      for (let k = 8; k < 128; k += 2) { const v = h[k] | (h[k + 1] << 8); if (!v || v > 720) break; parts.push(Buffer.from(sec(v))); }
      docs.push({ name, data: Buffer.concat(parts) });
    }
  }
  return docs;
}

function read(buf) {
  buf = Buffer.from(buf);
  if (buf.length > 16 && buf[0] === 0x96 && buf[1] === 0x02) {
    const d = readDisk(buf);
    if (!d.length) return [];
    buf = d[0].data;
  }
  let end = buf.indexOf(0x1b);
  if (end < 0) { end = buf.length; while (end > 0 && buf[end - 1] === 0) end--; }
  const out = [];
  out.header = []; out.footer = [];
  let b = 0, u = 0, sup = 0, sub = 0, just = 0, pageBreak = false;
  let pos = 0;
  while (pos < end) {
    let eol = buf.indexOf(0x9b, pos);
    if (eol < 0 || eol > end) eol = end;
    const ln = buf.subarray(pos, eol);
    pos = eol + 1;
    if (ln.length && (ln[0] === 0x06 || ln[0] === 0x08 || ln[0] === 0x07)) {
      const txt = ln.subarray(1).toString('latin1');
      if (ln[0] === 0x06) { const m = /j(\d+)/.exec(txt); if (m) just = +m[1] ? 1 : 0; }
      else (ln[0] === 0x08 ? out.header : out.footer).push(txt);
      continue;
    }
    const p = para();
    if (just) p.align = 'j';
    let t = '';
    const put = () => { if (t) p.runs.push({ t, b, i: 0, u, sup, sub }); t = ''; };
    for (let k = 0; k < ln.length; k++) {
      const c = ln[k];
      if (c === 0x03) { p.align = 'c'; continue; }
      if (c === 0x02) { put(); b ^= 1; continue; }
      if (c === 0x15) { put(); u ^= 1; continue; }
      if (c === 0x10) { pageBreak = true; continue; }
      if (c === 0x16 && k + 1 < ln.length) {
        const n = ln[++k];
        if (n === 0x5e) { put(); sup ^= 1; }
        else if (n === 0x2a) { put(); sub ^= 1; }
        else t += n >= 32 && n < 127 ? String.fromCharCode(n) : '';
        continue;
      }
      if (c < 32) continue;
      t += c >= 32 && c < 127 ? String.fromCharCode(c) : c >= 160 ? String.fromCharCode(c) : '?';
    }
    put();
    if (!p.runs.length) p.runs.push({ t: '', b: 0, i: 0, u: 0, sup: 0, sub: 0 });
    if (pageBreak) { p.pageBreakBefore = true; pageBreak = false; }
    out.push(p);
  }
  return out;
}

module.exports = { read, readDisk };
