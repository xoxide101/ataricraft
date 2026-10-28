// arc.js - SEA ARC archive reader (methods 1-9 minus squashed variants), used by AFM/WebATM and as the
// reference for the 6502 ARC tool. UMD so node tests can require() it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Arc = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const METHODS = { 1: 'Stored', 2: 'Stored', 3: 'Packed', 4: 'Squeezed', 5: 'Crunched', 6: 'Crunched', 7: 'Crunched', 8: 'Crunched', 9: 'Squashed' };

  function crc16(b) {
    let c = 0;
    for (let i = 0; i < b.length; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = (c & 1) ? (c >>> 1) ^ 0xA001 : c >>> 1;
    }
    return c & 0xFFFF;
  }

  function dosDate(d, t) {
    return { year: 1980 + (d >> 9), month: (d >> 5) & 15, day: d & 31, hour: t >> 11, minute: (t >> 5) & 63, second: (t & 31) * 2 };
  }

  // Walk the archive headers. Returns entries; stops at the end marker or the first bad header.
  function list(b) {
    const out = [];
    let p = 0;
    while (p + 2 <= b.length && b[p] === 0x1A) {
      const m = b[p + 1];
      if (m === 0) break;
      const hl = m === 1 ? 23 : 27;
      if (p + hl + 2 > b.length) break;
      let n = '';
      for (let i = 0; i < 13 && b[p + 2 + i]; i++) n += String.fromCharCode(b[p + 2 + i]);
      const csize = (b[p + 15] | b[p + 16] << 8 | b[p + 17] << 16 | b[p + 18] << 24) >>> 0;
      const date = b[p + 19] | b[p + 20] << 8, time = b[p + 21] | b[p + 22] << 8, crc = b[p + 23] | b[p + 24] << 8;
      const size = m === 1 ? csize : ((b[p + 25] | b[p + 26] << 8 | b[p + 27] << 16 | b[p + 28] << 24) >>> 0);
      const start = p + (m === 1 ? 23 : 29);
      if (start + csize > b.length) break;
      out.push({ name: n, method: m, methodName: METHODS[m] || 'Method ' + m, csize, size, crc, modified: dosDate(date, time), start });
      p = start + csize;
    }
    return out;
  }

  // 0x90 run-length expansion
  function unrle(s) {
    const o = [];
    let last = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== 0x90) { o.push(c); last = c; continue; }
      const n = s[++i];
      if (n === undefined) break;
      if (n === 0) o.push(0x90); else for (let k = 1; k < n; k++) o.push(last);
    }
    return Uint8Array.from(o);
  }

  // CP/M-style Huffman (method 4): node table, then the bit stream, LSB first
  function unsqueeze(s) {
    let p = 0;
    const n = s[0] | s[1] << 8;
    p = 2;
    if (n > 257) throw new Error('bad squeeze tree');
    const L = new Int16Array(n + 1), R = new Int16Array(n + 1);
    for (let i = 0; i < n; i++) {
      L[i] = (s[p] | s[p + 1] << 8) << 16 >> 16;
      R[i] = (s[p + 2] | s[p + 3] << 8) << 16 >> 16;
      p += 4;
    }
    const o = [];
    if (n === 0) return Uint8Array.from(o);
    let node = 0, bit = 0, cur = 0;
    for (;;) {
      if (bit === 0) { if (p >= s.length) break; cur = s[p++]; bit = 8; }
      const v = (cur & 1) ? R[node] : L[node];
      cur >>= 1; bit--;
      if (v < 0) {
        const sym = -(v + 1);
        if (sym === 256) break;
        o.push(sym);
        node = 0;
      } else node = v;
    }
    return Uint8Array.from(o);
  }

  // Dynamic LZW (methods 8/9), as in nomarch: LSB-first codes, the first code adds a dummy entry 256, 256 only
  // drops the width back to 9 (entries are overwritten, not cleared), and codes come in groups of 8 so the stream
  // pads to a group boundary whenever the width changes.
  function unlzw(s, maxbits) {
    let p = 0;
    if (!maxbits) maxbits = s[p++];
    const maxstr = 1 << maxbits;
    const ptr = new Int32Array(maxstr).fill(-1), chr = new Int32Array(maxstr).fill(-1), first = new Int32Array(maxstr).fill(-1);
    for (let i = 0; i < 256; i++) chr[i] = i;
    let last = 255, csize = 9, pos = 0, ofs = 0;
    const total = (s.length - p) * 8;
    const out = [];
    const rd = (n) => {
      if (pos + n > total) return -1;
      let v = 0;
      for (let i = 0; i < n; i++, pos++) v |= ((s[p + (pos >> 3)] >> (pos & 7)) & 1) << i;
      if (v > maxstr - 1) return -1;
      ofs = (ofs + 1) & 7;
      return v;
    };
    const resync = (n) => { while (ofs) if (rd(n) < 0) break; };
    const emit = (code) => {
      const st = [];
      while (ptr[code] !== -1 && st.length < maxstr) { st.push(chr[code]); code = ptr[code]; }
      out.push(chr[code]);
      for (let i = st.length - 1; i >= 0; i--) out.push(st[i]);
    };
    const firstChr = (code) => chr[ptr[code] !== -1 ? first[code] : code];
    const add = (old, c) => {
      last++;
      if (last & maxstr) { last = maxstr - 1; return; }
      chr[last] = c;
      if (old >= maxstr) return;
      ptr[last] = old;
      first[last] = ptr[old] === -1 ? old : first[old];
    };
    let oldc = 0, k = 0, fst = true;
    for (;;) {
      let nc = rd(csize);
      if (nc < 0) break;
      if (fst) { k = nc; fst = false; }
      if (nc === 256) {
        last = 255;
        resync(csize);
        csize = 9;
        nc = rd(csize);
        if (nc < 0) break;
      }
      if (nc <= last) { emit(nc); k = firstChr(nc); }
      else { emit(oldc); out.push(k); }
      if (last !== maxstr - 1) {
        add(oldc, k);
        if (last !== maxstr - 1 && last === (1 << csize) - 1) { csize++; resync(csize - 1); }
      }
      oldc = nc;
    }
    return Uint8Array.from(out);
  }  function extract(b, e) {
    const s = b.subarray(e.start, e.start + e.csize);
    let d;
    switch (e.method) {
      case 1: case 2: d = s; break;
      case 3: d = unrle(s); break;
      case 4: d = unrle(unsqueeze(s)); break;
      case 8: d = unrle(unlzw(s, 0)); break;
      default: throw new Error('unsupported ARC method ' + e.method);
    }
    d = d.slice(0, e.size);
    if (d.length !== e.size) throw new Error('size mismatch');
    if (crc16(d) !== e.crc) throw new Error('CRC mismatch');
    return d;
  }

  return { list, extract, crc16, unrle, unsqueeze, unlzw, METHODS };
});
