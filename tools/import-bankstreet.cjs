// Importer for The Bank Street Writer (Atari 8-bit, Broderbund 1982) documents. See docs/formats/bankstreet.md.
// A BSW document is an ordinary DOS 2 file on a disk BSW initialised itself (boot sectors + DOS 2 layout).
// Text is ATASCII: $9B ends a paragraph, a leading $03 centres the line, $8E is a soft (word-wrap) break
// that BSW itself loads as a space, $09 is an indent. No other style codes exist.
const para = () => ({ align: 'l', bullet: false, runs: [] });

// DOS 2 reader: returns [{ name, bytes, protected }] for every in-use file whose content looks like BSW text.
function extractFromAtr(atr) {
  if (!(atr.length > 16 && atr[0] === 0x96 && atr[1] === 0x02)) return [];
  const ss = atr[4] | (atr[5] << 8) || 128;
  const secOff = (n) => (n <= 3 ? 16 + (n - 1) * 128 : 16 + 3 * 128 + (n - 4) * ss);
  const sec = (n) => { const o = secOff(n), len = n <= 3 ? 128 : ss; return o + len <= atr.length ? atr.subarray(o, o + len) : null; };
  const docs = [];
  for (let d = 361; d <= 368; d++) {
    const s = sec(d); if (!s) break;
    for (let e = 0; e < s.length; e += 16) {
      const flag = s[e];
      if (flag === 0) continue;
      if (!(flag & 0x40) || (flag & 0x80)) continue; // in use, not deleted
      const start = s[e + 3] | (s[e + 4] << 8);
      const base = Buffer.from(s.subarray(e + 5, e + 13)).toString('latin1').trimEnd();
      const ext = Buffer.from(s.subarray(e + 13, e + 16)).toString('latin1').trimEnd();
      const parts = []; let n = start, guard = 0;
      while (n && guard++ < 1500) {
        const sc = sec(n); if (!sc) break;
        const cnt = sc[sc.length - 1], next = ((sc[sc.length - 3] & 3) << 8) | sc[sc.length - 2];
        parts.push(Buffer.from(sc.subarray(0, Math.min(cnt, sc.length - 3)))); n = next;
      }
      const bytes = Buffer.concat(parts);
      if (!looksLikeText(bytes)) continue;
      // BSW stores a password (a 3-character cipher, not decoded) in the file-name extension.
      docs.push({ name: base, bytes, protected: ext !== '' });
    }
  }
  return docs;
}

function looksLikeText(b) {
  if (!b.length) return false;
  let ok = 0;
  for (const c of b) if (c === 0x9b || c === 0x8e || c === 0x09 || c === 0x03 || (c >= 32 && c < 127)) ok++;
  return ok === b.length;
}

function read(buf) {
  buf = Buffer.from(buf);
  if (buf.length > 16 && buf[0] === 0x96 && buf[1] === 0x02) { // a whole disk image: take the first document
    const docs = extractFromAtr(buf);
    buf = docs.length ? docs[0].bytes : Buffer.alloc(0);
  }
  let end = buf.length; while (end > 0 && buf[end - 1] === 0xff) end--; // sector padding if raw sector data is passed
  buf = buf.subarray(0, end);
  const out = []; let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i < buf.length && buf[i] !== 0x9b) continue;
    if (i === buf.length && i === start) break;
    const p = para(); let t = '';
    for (let k = start; k < i; k++) {
      const b = buf[k];
      if (b === 0x03 && k === start) { p.align = 'c'; continue; }
      if (b === 0x8e) { t += ' '; continue; }
      if (b === 0x09) { t += '    '; continue; }
      if (b < 32) continue;
      const c = b & 127;
      t += c >= 32 && c < 127 ? String.fromCharCode(c) : '?';
    }
    p.runs.push({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 });
    out.push(p); start = i + 1;
  }
  return out;
}

module.exports = { read, extractFromAtr };
