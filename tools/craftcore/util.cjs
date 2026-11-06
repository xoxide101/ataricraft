// craftcore util: dependency-free bytes, checksums and canonical JSON. Works in Node (require) and in a browser
// (<script> sets AC.CraftCore.util). See docs/ARCH-CONTAINER.md and docs/ARCH-TRANSPORT.md.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.CraftCore = root.AC.CraftCore || {}; root.AC.CraftCore.util = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const u8 = (b) => (b == null ? new Uint8Array(0) : b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : Uint8Array.from(b));
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (b) => new TextDecoder('utf-8').decode(u8(b));
  const concat = (list) => {
    let n = 0; for (const b of list) n += b.length;
    const o = new Uint8Array(n); let p = 0;
    for (const b of list) { o.set(b, p); p += b.length; }
    return o;
  };
  const equals = (a, b) => {
    a = u8(a); b = u8(b);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  // index of the first differing byte, or -1 (a length difference counts as a difference at the shorter length)
  const firstDiff = (a, b) => {
    a = u8(a); b = u8(b);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : n;
  };
  const hex = (b) => { b = u8(b); let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; };
  const unhex = (s) => { const o = new Uint8Array(s.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };

  // ---- checksums ----
  const CRC32T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b, c) => { b = u8(b); c = ~(c || 0) >>> 0; for (let i = 0; i < b.length; i++) c = CRC32T[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  // CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection. Cheap on a 6502 with a 512-byte table.
  const CRC16T = (() => { const t = new Uint16Array(256); for (let n = 0; n < 256; n++) { let c = n << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; t[n] = c; } return t; })();
  const crc16 = (b, c) => { b = u8(b); c = c == null ? 0xffff : c; for (let i = 0; i < b.length; i++) c = ((c << 8) & 0xffff) ^ CRC16T[((c >> 8) ^ b[i]) & 255]; return c; };
  const sum16 = (b) => { b = u8(b); let s = 0; for (let i = 0; i < b.length; i++) s = (s + b[i]) & 0xffff; return s; }; // the CRFT payload checksum

  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(data) {
    data = u8(data);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = data.length, total = ((len + 9 + 63) >> 6) << 6;
    const p = new Uint8Array(total); p.set(data); p[len] = 0x80;
    const dv = new DataView(p.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
    const w = new Uint32Array(64);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32), od = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) od.setUint32(i * 4, H[i]);
    return out;
  }
  const sha256hex = (b) => hex(sha256(b));

  // Canonical JSON: keys sorted, no whitespace, so the same manifest is always the same bytes (and the same checksum).
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  // Small deterministic PRNG (mulberry32) for repeatable fuzz and fault injection.
  const prng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  return { u8, enc, dec, concat, equals, firstDiff, hex, unhex, crc32, crc16, sum16, sha256, sha256hex, canonical, prng };
});
