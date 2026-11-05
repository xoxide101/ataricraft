// Craft dictionary (CDIC) library: build, parse and look up. Format and hash: docs/DICTIONARY.md.
// The hash is written to match the 6502 code in tools/acwriter/word/spell.inc step for step.
'use strict';

const HDR = 24, VERSION = 1, HASH_ID = 1, F_EXACT = 1;
const INIT = 0x9e3779b9;

// letters a-z -> 1..26, apostrophe -> 27; anything else is not part of a word
function code(ch) {
  if (ch >= 97 && ch <= 122) return ch - 96;
  if (ch >= 65 && ch <= 90) return ch - 64;
  if (ch === 39) return 27;
  return 0;
}

const rol5 = (x) => ((x << 5) | (x >>> 27)) >>> 0;

// hash id 1: x = INIT; per char x = rol32(x,5) ^ code; end: x ^= x << 16 (mod 2^32).  Returns the 32-bit value.
function hash(word) {
  let x = INIT;
  for (let i = 0; i < word.length; i++) {
    const c = code(word.charCodeAt(i));
    if (!c) throw new Error('bad character in word: ' + word);
    x = (rol5(x) ^ c) >>> 0;
  }
  return (x ^ (x << 16)) >>> 0;
}

// probe i = (h1 + i*h2) mod bits, h1 = h, h2 = (h >> 16) | 1; bits is a power of two
function probes(h, bits, k) {
  const mask = bits - 1, h2 = ((h >>> 16) | 1) >>> 0;
  const out = []; let p = h & mask;
  for (let i = 0; i < k; i++) { out.push(p); p = (p + h2) & mask; }
  return out;
}

// lowercase a-z and inner apostrophes; null when the word has other characters
function normalize(w) {
  w = String(w).toLowerCase().replace(/^'+/, '').replace(/'+$/, '');
  if (!/^[a-z']+$/.test(w) || w.length > 24) return null;
  return w;
}

function build(words, opt = {}) {
  const bytes = opt.bytes || 16384, k = opt.k || 5, lang = opt.lang || 'en';
  if (bytes & (bytes - 1) || bytes < 16) throw new Error('--bytes must be a power of two (the 6502 masks the bit index)');
  if (k < 1 || k > 15) throw new Error('--k must be 1..15');
  const bits = bytes * 8;
  const set = new Set();
  for (const w of words) { const n = normalize(w.trim()); if (n && n.replace(/'/g, '')) set.add(n); }
  const list = [...set].sort();
  const table = Buffer.alloc(bytes);
  for (const w of list) for (const p of probes(hash(w), bits, k)) table[p >> 3] |= 1 << (p & 7);
  let exact = Buffer.alloc(0);
  if (opt.exact) exact = packExact(list);
  const h = Buffer.alloc(HDR);
  h.write('CDIC', 0, 'latin1'); h[4] = VERSION; h[5] = HASH_ID; h[6] = k; h[7] = opt.exact ? F_EXACT : 0;
  h.writeUInt32LE(bits, 8); h.writeUInt32LE(list.length, 12); h.write(lang.slice(0, 4), 16, 'latin1');
  h.writeUInt32LE(opt.exact ? HDR + bytes : 0, 20);
  return { file: Buffer.concat([h, table, exact]), words: list, bits, k, bytes };
}

// tier 2: sorted words, each as [shared prefix length][suffix length][suffix bytes], ended by a 0xFF 0xFF pair
function packExact(list) {
  const parts = []; let prev = '';
  for (const w of list) {
    let l = 0; while (l < prev.length && l < w.length && prev[l] === w[l]) l++;
    const s = w.slice(l);
    parts.push(Buffer.from([l, s.length]), Buffer.from(s, 'latin1')); prev = w;
  }
  parts.push(Buffer.from([0xff, 0xff]));
  return Buffer.concat(parts);
}

function unpackExact(buf, off) {
  const out = []; let prev = '';
  while (off < buf.length && buf[off] !== 0xff) {
    const l = buf[off], n = buf[off + 1];
    prev = prev.slice(0, l) + buf.toString('latin1', off + 2, off + 2 + n);
    out.push(prev); off += 2 + n;
  }
  return out;
}

function parse(buf) {
  if (buf.length < HDR || buf.toString('latin1', 0, 4) !== 'CDIC') throw new Error('not a CDIC dictionary');
  const d = { version: buf[4], hashId: buf[5], k: buf[6], flags: buf[7], bits: buf.readUInt32LE(8), words: buf.readUInt32LE(12),
    lang: buf.toString('latin1', 16, 20).replace(/\0+$/, ''), exactOff: buf.readUInt32LE(20) };
  if (d.version !== VERSION) throw new Error('unsupported CDIC version ' + d.version);
  if (d.hashId !== HASH_ID) throw new Error('unsupported hash id ' + d.hashId);
  const n = d.bits >>> 3;
  if (d.bits & (d.bits - 1) || buf.length < HDR + n) throw new Error('bad bit count / truncated file');
  d.table = buf.subarray(HDR, HDR + n);
  d.buf = buf;
  return d;
}

function testBloom(d, w) {
  for (const p of probes(hash(w), d.bits, d.k)) if (!(d.table[p >> 3] & (1 << (p & 7)))) return false;
  return true;
}

// Is the word known? Tries the word itself, then without a possessive: dog's -> dog, dogs' -> dogs.
function has(d, word) {
  const w = normalize(word);
  if (!w) return false;
  const exact = d.exactSet || (d.exactOff ? (d.exactSet = new Set(unpackExact(d.buf, d.exactOff))) : null);
  const t = exact ? (x) => exact.has(x) : (x) => testBloom(d, x);
  if (t(w)) return true;
  if (w.endsWith("'s") && w.length > 2 && t(w.slice(0, -2))) return true;
  if (w.endsWith("s'") && w.length > 2 && t(w.slice(0, -1))) return true;
  return false;
}

// words to check in a text: runs of letters and inner apostrophes; skips tokens with digits, 1-letter words and > 24 letters
function tokens(text) {
  const out = []; const re = /[A-Za-z0-9']+/g; let m;
  while ((m = re.exec(text))) {
    let w = m[0], off = m.index;
    if (/[0-9]/.test(w)) continue;
    const lead = w.match(/^'+/); if (lead) { w = w.slice(lead[0].length); off += lead[0].length; }
    w = w.replace(/'+$/, (t) => (t.length === 1 && /s$/i.test(w.slice(0, -1)) ? t : ''));
    if (w.length < 2 || w.length > 24) continue;
    out.push({ word: w, index: off });
  }
  return out;
}

module.exports = { HDR, VERSION, HASH_ID, INIT, code, hash, probes, normalize, build, parse, has, testBloom, tokens, packExact, unpackExact };
