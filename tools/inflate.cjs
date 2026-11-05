// Synchronous raw-deflate decoder (RFC 1951) so the browser build can run tools/officeread.cjs without zlib.
// Node uses zlib.inflateRawSync; the xCWriter bundle maps that name to this (scripts/sync-xcwriter-core.cjs).
'use strict';

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// canonical Huffman table from code lengths: { count[len], sym[] }
function table(lens) {
  const count = new Array(16).fill(0), offs = new Array(16).fill(0), sym = new Array(lens.length);
  for (const l of lens) count[l]++;
  for (let i = 2; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let i = 0; i < lens.length; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
  return { count, sym };
}

let FIXED = null;
function fixed() {
  if (FIXED) return FIXED;
  const l = new Array(288).fill(8); for (let i = 144; i < 256; i++) l[i] = 9; for (let i = 256; i < 280; i++) l[i] = 7;
  return (FIXED = { lit: table(l), dist: table(new Array(30).fill(5)) });
}

function inflateRaw(src) {
  let pos = 0, bit = 0, cur = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;
  const need = (n) => { if (op + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out.subarray(0, op)); out = o; } };
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (!bit) { if (pos >= src.length) throw new Error('inflate: unexpected end of data'); cur = src[pos++]; bit = 8; }
      v |= (cur & 1) << i; cur >>= 1; bit--;
    }
    return v;
  };
  const decode = (t) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.count[len];
      if (code - c < first) return t.sym[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bit = 0;
      if (pos + 4 > src.length) throw new Error('inflate: truncated');
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) ({ lit, dist } = fixed());
      else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lens = new Array(19).fill(0);
        for (let i = 0; i < ncode; i++) lens[CLORD[i]] = bits(3);
        const ct = table(lens), all = [];
        while (all.length < nlen + ndist) {
          const s = decode(ct);
          if (s < 16) all.push(s);
          else {
            let rep, val = 0;
            if (s === 16) { if (!all.length) throw new Error('inflate: bad repeat'); val = all[all.length - 1]; rep = 3 + bits(2); }
            else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
            while (rep--) all.push(val);
          }
        }
        lit = table(all.slice(0, nlen)); dist = table(all.slice(nlen, nlen + ndist));
      }
      for (;;) {
        const s = decode(lit);
        if (s < 256) { need(1); out[op++] = s; }
        else if (s === 256) break;
        else {
          const li = s - 257; if (li > 28) throw new Error('inflate: bad length');
          const len = LBASE[li] + bits(LEXT[li]), di = decode(dist);
          if (di > 29) throw new Error('inflate: bad distance');
          const d = DBASE[di] + bits(DEXT[di]);
          if (d > op) throw new Error('inflate: distance too far');
          need(len); for (let k = 0; k < len; k++) { out[op] = out[op - d]; op++; }
        }
      }
    } else throw new Error('inflate: bad block type');
  } while (!last);
  return out.slice(0, op);
}

module.exports = { inflateRaw, inflateRawSync: inflateRaw };
