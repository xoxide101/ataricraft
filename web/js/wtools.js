/* WebAFM tool library: pure functions (no DOM) so they can be tested in Node.
   Text codec, hex helpers, checksums. Disassembler/assembler/BASIC/etc. are added below as they are built. */
(function () {
  'use strict';
  const T = {};

  // ---------- text <-> bytes ----------
  // Modes: 'atascii' (EOL = $9B), 'lf' (PC/Unix), 'crlf' (PC/Windows).
  // Bytes that are not plain text show as {$XX} so every file round-trips byte for byte.
  const hx = (b) => b.toString(16).toUpperCase().padStart(2, '0');
  const TOKEN = /\{\$([0-9A-Fa-f]{2})\}/g;

  T.decodeText = function (bytes, mode) {
    mode = mode || 'atascii';
    let out = '';
    const n = bytes.length;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (mode === 'atascii' && b === 0x9b) out += '\n';
      else if (mode === 'lf' && b === 10) out += '\n';
      else if (mode === 'crlf' && b === 13 && bytes[i + 1] === 10) { out += '\n'; i++; }
      else if (mode !== 'atascii' && b === 9) out += '\t';
      else if (b >= 32 && b < 127) out += b === 123 && /^\$[0-9A-Fa-f]{2}\}/.test(String.fromCharCode(bytes[i + 1] || 0, bytes[i + 2] || 0, bytes[i + 3] || 0, bytes[i + 4] || 0)) ? '{$7B}' : String.fromCharCode(b);
      else out += '{$' + hx(b) + '}';
    }
    return out;
  };

  T.encodeText = function (str, mode) {
    mode = mode || 'atascii';
    str = str.replace(/\r\n?/g, '\n');
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '{') { const m = /^\{\$([0-9A-Fa-f]{2})\}/.exec(str.slice(i, i + 5)); if (m) { out.push(parseInt(m[1], 16)); i += 4; continue; } }
      if (c === '\n') { if (mode === 'atascii') out.push(0x9b); else if (mode === 'crlf') out.push(13, 10); else out.push(10); }
      else { const k = c.charCodeAt(0); out.push(k < 256 ? k : 63); }
    }
    return new Uint8Array(out);
  };

  // How text-like a file is (0..1) and which line-ending convention it uses.
  T.sniff = function (bytes) {
    const n = Math.min(bytes.length, 8192);
    if (!n) return { text: true, mode: 'atascii', score: 1 };
    let ok = 0, a = 0, lf = 0, crlf = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0x9b) { a++; ok++; } else if (b === 10) { lf++; ok++; if (bytes[i - 1] === 13) crlf++; } else if (b === 13 || b === 9) ok++;
      else if (b >= 32 && b < 127) ok++;
    }
    const mode = crlf && crlf >= lf / 2 ? 'crlf' : lf > a ? 'lf' : 'atascii';
    const score = ok / n, binary = bytes[0] === 0xff && bytes[1] === 0xff;
    return { text: score >= 0.9 && !binary, mode, score, binary };
  };

  // ---------- hex ----------
  T.hexRow = function (data, off, w) {
    w = w || 16;
    const row = data.subarray(off, off + w);
    let h = '', a = '';
    for (let i = 0; i < w; i++) { if (i < row.length) { h += hx(row[i]) + ' '; a += row[i] >= 32 && row[i] < 127 ? String.fromCharCode(row[i]) : '.'; } else h += '   '; }
    return off.toString(16).toUpperCase().padStart(6, '0') + '  ' + h + ' ' + a;
  };
  T.parseHex = function (s) {
    const t = s.replace(/[\s,]|0x|\$/gi, '');
    if (!t || t.length % 2 || /[^0-9a-f]/i.test(t)) return null;
    const out = new Uint8Array(t.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
    return out;
  };
  // Find `needle` (Uint8Array) in `data` from `from`; dir 1 forward, -1 backward. Returns index or -1.
  T.findBytes = function (data, needle, from, dir) {
    const n = needle.length; if (!n) return -1;
    const ok = (i) => { for (let k = 0; k < n; k++) if (data[i + k] !== needle[k]) return false; return true; };
    if (dir < 0) { for (let i = Math.min(from, data.length - n); i >= 0; i--) if (ok(i)) return i; } else for (let i = Math.max(0, from); i <= data.length - n; i++) if (ok(i)) return i;
    return -1;
  };

  // ---------- checksums ----------
  let crcT = null;
  T.crc32 = function (d) {
    if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  T.crc16 = function (d) { let c = 0xffff; for (let i = 0; i < d.length; i++) { c ^= d[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; };
  T.sum16 = function (d) { let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) & 0xffff; return s; };
  T.hex = hx;

  if (typeof AC !== 'undefined') AC.WTools = Object.assign(AC.WTools || {}, T);
  if (typeof module !== 'undefined') module.exports = T;
})();
