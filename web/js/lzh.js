// lzh.js - LHA/LZH archive reader: level 0 and 1 headers, methods -lh0- (stored) and -lh1- (adaptive Huffman).
// Reference for the 6502 LZH tool. UMD so node tests can require() it.
//
// -lh1- is Yoshizaki's LZHUF: LZSS (4096 byte ring, matches 3..60) whose literal/length symbols (314) are coded
// with an adaptive Huffman tree and whose match distances use a static prefix code for the upper 6 bits plus
// 6 raw low bits. Written from the algorithm description; no code from the (non-commercial) lzhuf.c.
// Not yet handled: -lh4-..-lh7- (static Huffman, LHA 2.x), level 2 headers, directories.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Lzh = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const N = 4096, F = 60, THRESHOLD = 2;
  const N_CHAR = 256 - THRESHOLD + F;   // 314 symbols
  const T = N_CHAR * 2 - 1, R = T - 1, MAX_FREQ = 0x8000;

  function crc16(b) {
    let c = 0;
    for (let i = 0; i < b.length; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = (c & 1) ? (c >>> 1) ^ 0xA001 : c >>> 1;
    }
    return c & 0xFFFF;
  }

  // Static distance code: 64 prefixes of length 3..8, canonical order. Expanded to 256-entry decode tables.
  const D_CODE = new Uint8Array(256), D_LEN = new Uint8Array(256);
  (function () {
    const lens = [];
    for (let i = 0; i < 64; i++) lens.push(i < 1 ? 3 : i < 4 ? 4 : i < 12 ? 5 : i < 24 ? 6 : i < 48 ? 7 : 8);
    let c = 0, prev = 3;
    for (let i = 0; i < 64; i++) {
      c <<= (lens[i] - prev); prev = lens[i];
      const base = c << (8 - lens[i]);
      for (let k = 0; k < (1 << (8 - lens[i])); k++) { D_CODE[base + k] = i; D_LEN[base + k] = lens[i]; }
      c++;
    }
  })();

  function decodeLh1(src, outLen) {
    const freq = new Uint32Array(T + 1), prnt = new Int32Array(T + N_CHAR), son = new Int32Array(T);
    for (let i = 0; i < N_CHAR; i++) { freq[i] = 1; son[i] = i + T; prnt[i + T] = i; }
    for (let i = 0, j = N_CHAR; j <= R; i += 2, j++) {
      freq[j] = freq[i] + freq[i + 1]; son[j] = i; prnt[i] = prnt[i + 1] = j;
    }
    freq[T] = 0xFFFF; prnt[R] = 0;

    let pos = 0, buf = 0, blen = 0;
    function bit() {
      if (blen === 0) { buf = pos < src.length ? src[pos] : 0; pos++; blen = 8; }
      blen--; return (buf >> blen) & 1;
    }
    function byte() { let v = 0; for (let i = 0; i < 8; i++) v = (v << 1) | bit(); return v; }

    function reconst() {
      let j = 0;
      for (let i = 0; i < T; i++) if (son[i] >= T) { freq[j] = (freq[i] + 1) >> 1; son[j] = son[i]; j++; }
      for (let i = 0, jj = N_CHAR; jj < T; i += 2, jj++) {
        const f = freq[jj] = freq[i] + freq[i + 1];
        let k = jj - 1;
        while (f < freq[k]) k--;
        k++;
        for (let m = jj; m > k; m--) { freq[m] = freq[m - 1]; son[m] = son[m - 1]; }
        freq[k] = f; son[k] = i;
      }
      for (let i = 0; i < T; i++) {
        const k = son[i];
        if (k >= T) prnt[k] = i; else prnt[k] = prnt[k + 1] = i;
      }
    }
    function update(c) {
      if (freq[R] === MAX_FREQ) reconst();
      c = prnt[c + T];
      do {
        const k = ++freq[c];
        let l = c + 1;
        if (k > freq[l]) {
          while (k > freq[++l]);
          l--;
          freq[c] = freq[l]; freq[l] = k;
          const i = son[c]; prnt[i] = l; if (i < T) prnt[i + 1] = l;
          const j = son[l]; son[l] = i;
          prnt[j] = c; if (j < T) prnt[j + 1] = c;
          son[c] = j;
          c = l;
        }
        c = prnt[c];
      } while (c !== 0);
    }
    function decodeChar() {
      let c = son[R];
      while (c < T) c = son[c + bit()];
      c -= T; update(c); return c;
    }
    function decodePos() {
      let i = byte();
      const hi = D_CODE[i] << 6;
      let j = D_LEN[i] - 2;
      while (j--) i = (i << 1) | bit();
      return hi | (i & 0x3F);
    }

    const out = new Uint8Array(outLen), ring = new Uint8Array(N).fill(0x20);
    let r = N - F, n = 0;
    while (n < outLen) {
      const c = decodeChar();
      if (c < 256) { out[n++] = c; ring[r] = c; r = (r + 1) & (N - 1); }
      else {
        const i = (r - decodePos() - 1) & (N - 1), len = c - 255 + THRESHOLD;
        for (let k = 0; k < len && n < outLen; k++) {
          const v = ring[(i + k) & (N - 1)];
          out[n++] = v; ring[r] = v; r = (r + 1) & (N - 1);
        }
      }
    }
    return out;
  }

  // -lh4-/-lh5-/-lh6-/-lh7-: LZSS with per-block static Huffman tables. dicBits = 12, 13, 15, 16.
  function decodeLh5(src, outLen, dicBits) {
    let pos = 0, bb = 0, bn = 0;
    function bits(n) { // n <= 16
      while (bn < n) { bb = ((bb << 8) | (pos < src.length ? src[pos] : 0)) >>> 0; pos++; bn += 8; if (bn > 24) break; }
      bn -= n; return (bb >>> bn) & ((1 << n) - 1);
    }
    // build a lookup tree decoder from code lengths
    function build(lens, n) {
      const cnt = new Array(17).fill(0);
      for (let i = 0; i < n; i++) cnt[lens[i]]++;
      cnt[0] = 0;
      const next = new Array(18).fill(0);
      let code = 0;
      for (let l = 1; l <= 16; l++) { code = (code + cnt[l - 1]) << 1; next[l] = code; }
      const map = new Map();
      for (let i = 0; i < n; i++) if (lens[i]) map.set(lens[i] * 65536 + next[lens[i]]++, i);
      return map;
    }
    function sym(map) {
      let c = 0;
      for (let l = 1; l <= 16; l++) {
        c = (c << 1) | bits(1);
        const v = map.get(l * 65536 + c);
        if (v !== undefined) return v;
      }
      throw new Error('bad Huffman code');
    }
    const NP = dicBits + 1, PBIT = dicBits <= 13 ? 4 : 5;
    const out = new Uint8Array(outLen);
    let n = 0, blk = 0, cMap, pMap, cConst = -1, pConst = -1;
    const ring = new Uint8Array(1 << dicBits);
    const mask = (1 << dicBits) - 1;
    let r = 0;

    function readPt(nn, nbit, special) {
      const k = bits(nbit);
      const lens = new Uint8Array(nn);
      if (k === 0) return { c: bits(nbit) };
      let i = 0;
      while (i < k) {
        let c = bits(3);
        if (c === 7) while (bits(1)) c++;
        lens[i++] = c;
        if (i === special) { let z = bits(2); while (z-- > 0) lens[i++] = 0; }
      }
      return { map: build(lens, nn) };
    }
    function readC() {
      const t = readPt(19, 5, 3);
      const k = bits(9);
      if (k === 0) return { c: bits(9) };
      const lens = new Uint8Array(510);
      let i = 0;
      while (i < k) {
        let c = t.map ? sym(t.map) : t.c;
        if (c <= 2) {
          if (c === 0) c = 1; else if (c === 1) c = bits(4) + 3; else c = bits(9) + 20;
          while (c-- > 0) lens[i++] = 0;
        } else lens[i++] = c - 2;
      }
      return { map: build(lens, 510) };
    }
    while (n < outLen) {
      if (blk === 0) {
        blk = bits(16);
        const c = readC(); cMap = c.map; cConst = c.c === undefined ? -1 : c.c;
        const p = readPt(NP, PBIT, -1); pMap = p.map; pConst = p.c === undefined ? -1 : p.c;
      }
      blk--;
      const c = cMap ? sym(cMap) : cConst;
      if (c < 256) { out[n++] = c; ring[r] = c; r = (r + 1) & mask; continue; }
      const len = c - 253;
      let p = pMap ? sym(pMap) : pConst;
      if (p > 1) p = (1 << (p - 1)) + bits(p - 1);
      const s = (r - p - 1) & mask;
      for (let k = 0; k < len && n < outLen; k++) {
        const v = ring[(s + k) & mask];
        out[n++] = v; ring[r] = v; r = (r + 1) & mask;
      }
    }
    return out;
  }

  function dosDate(d, t) {
    return { year: 1980 + (d >> 9), month: (d >> 5) & 15, day: d & 31, hour: t >> 11, minute: (t >> 5) & 63, second: (t & 31) * 2 };
  }

  // Walk the headers. Level 0 and 1 only; stops at the end marker or the first bad header.
  function list(b) {
    const out = [];
    let p = 0;
    while (p + 22 < b.length && b[p] !== 0) {
      const hs = b[p], level = b[p + 20];
      if (level > 1 || b[p + 2] !== 0x2D || b[p + 6] !== 0x2D) break;
      const method = String.fromCharCode(b[p + 3], b[p + 4], b[p + 5]);
      let packed = (b[p + 7] | b[p + 8] << 8 | b[p + 9] << 16 | b[p + 10] * 16777216) >>> 0;
      const size = (b[p + 11] | b[p + 12] << 8 | b[p + 13] << 16 | b[p + 14] * 16777216) >>> 0;
      const time = b[p + 15] | b[p + 16] << 8, date = b[p + 17] | b[p + 18] << 8;
      const nl = b[p + 21];
      let name = '';
      for (let i = 0; i < nl; i++) name += String.fromCharCode(b[p + 22 + i]);
      const crc = b[p + 22 + nl] | b[p + 23 + nl] << 8;
      let q = p + hs + 2;
      if (level === 1) {
        // each extended header ends with the 2 byte size of the next one; the first size is the last 2 bytes
        // of the base header and 0 ends the chain. Their bytes are counted in "packed".
        let es = b[q - 2] | b[q - 1] << 8, ext = 0;
        while (es) { ext += es; es = b[q + ext - 2] | b[q + ext - 1] << 8; }
        packed -= ext; q += ext;
      }
      if (q + packed > b.length) break;
      out.push({ name, size, packed, method, crc, modified: dosDate(date, time), offset: q });
      p = q + packed;
    }
    return out;
  }

  function extract(b, e) {
    const data = b.subarray(e.offset, e.offset + e.packed);
    let out;
    if (e.method === 'lh0') out = data.slice(0, e.size);
    else if (e.method === 'lh1') out = decodeLh1(data, e.size);
    else if (e.method === 'lh4') out = decodeLh5(data, e.size, 12);
    else if (e.method === 'lh5') out = decodeLh5(data, e.size, 13);
    else if (e.method === 'lh6') out = decodeLh5(data, e.size, 15);
    else if (e.method === 'lh7') out = decodeLh5(data, e.size, 16);
    else throw new Error('LZH method -' + e.method + '- not supported');
    if (crc16(out) !== e.crc) throw new Error('LZH CRC mismatch: ' + e.name);
    return out;
  }

  return { list, extract, decodeLh1, crc16 };
});
