// alf.js - ALF archive reader (Atari 8-bit LZ.COM / DZ.COM "AlfCrunch"). UMD so node tests can require() it.
//
// Layout: ARC-like 29 byte headers ($1A $0F, name[13] NUL then space padded, packed u32, date, time, additive
// 16-bit checksum, size u32) each followed by the packed data; no end marker.
// Data: LZW, 9..12 bit codes MSB first, 256 = reset, 257 = end, first free code 258, no "early change";
// the width grows after code 511/1023/2047 is assigned. Format notes: B. Watson's alftools doc/*.txt.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Alf = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  function dosDate(d, t) {
    if (!d) return null;
    return { year: 1980 + (d >> 9), month: (d >> 5) & 15, day: d & 31, hour: Math.min(t >> 11, 23), minute: (t >> 5) & 63, second: (t & 31) * 2 };
  }

  const u32 = (b, p) => (b[p] | b[p + 1] << 8 | b[p + 2] << 16 | b[p + 3] * 16777216) >>> 0;

  function sum16(d) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s = (s + d[i]) & 0xFFFF;
    return s;
  }

  function list(b) {
    const out = [];
    let p = 0;
    while (p + 29 <= b.length && b[p] === 0x1A && b[p + 1] === 0x0F) {
      let name = '';
      for (let i = 0; i < 13 && b[p + 2 + i]; i++) name += String.fromCharCode(b[p + 2 + i]);
      if (name.endsWith('.')) name = name.slice(0, -1);
      const packed = u32(b, p + 15), size = u32(b, p + 25);
      const e = { name, size, packed, sum: b[p + 23] | b[p + 24] << 8, modified: dosDate(b[p + 19] | b[p + 20] << 8, b[p + 21] | b[p + 22] << 8), offset: p + 29 };
      if (e.offset + packed > b.length) break;
      out.push(e);
      p = e.offset + packed;
    }
    return out;
  }

  function decode(data, size) {
    const out = new Uint8Array(size);
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4096);
    let next = 258, width = 9, prev = -1, op = 0, acc = 0, nb = 0, ip = 0;
    for (;;) {
      while (nb < width) {
        if (ip >= data.length) throw new Error('ALF data truncated');
        acc = ((acc << 8) | data[ip++]) >>> 0; nb += 8;
      }
      const code = (acc >>> (nb - width)) & ((1 << width) - 1);
      nb -= width; acc &= (1 << nb) - 1;
      if (code === 257) break;
      if (code === 256) { next = 258; width = 9; prev = -1; continue; }
      let sp = 0, c = code;
      if (prev < 0) {
        if (code > 255) throw new Error('ALF bad first code');
      } else if (code >= next) {
        if (code > next) throw new Error('ALF bad code');
        stack[sp++] = 0; // placeholder: first byte of the previous string
        c = prev;
      }
      while (c > 255) { stack[sp++] = suffix[c]; c = prefix[c]; }
      stack[sp++] = c;
      const first = c;
      if (prev >= 0 && code >= next) stack[0] = first;
      if (op + sp > size) throw new Error('ALF output overrun');
      while (sp) out[op++] = stack[--sp];
      if (prev >= 0 && next < 4096) { prefix[next] = prev; suffix[next] = first; next++; }
      prev = code;
      if (next > 511 && width < 10) width = 10;
      if (next > 1023 && width < 11) width = 11;
      if (next > 2047 && width < 12) width = 12;
    }
    if (op !== size) throw new Error('ALF size mismatch');
    return out;
  }

  function extract(b, e) {
    const out = decode(b.subarray(e.offset, e.offset + e.packed), e.size);
    if (sum16(out) !== e.sum) throw new Error('ALF checksum mismatch: ' + e.name);
    return out;
  }

  return { list, extract, decode, sum16 };
});
