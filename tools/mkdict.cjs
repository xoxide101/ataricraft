#!/usr/bin/env node
// Build a Craft dictionary (CDIC) from a word list. Format: docs/DICTIONARY.md.
// Usage: node tools/mkdict.cjs WORDLIST.txt OUT.CDC [--bytes N] [--k N] [--lang en] [--exact]
//          [--only RANKLIST.txt]  keep only words that also appear in this list (frequency filter)
//          [--extra FILE.txt]     add these words (one per line) to the result
// --bytes is the bit-table size and must be a power of two (default 16384 = 131072 bits).
const fs = require('fs');
const cd = require('./cdict.cjs');

const a = process.argv.slice(2), pos = [], opt = {};
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--exact') opt.exact = true;
  else if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i];
  else pos.push(a[i]);
}
if (pos.length < 2) { console.error('usage: node tools/mkdict.cjs WORDLIST.txt OUT.CDC [--bytes N] [--k N] [--lang en] [--exact] [--only LIST] [--extra LIST]'); process.exit(2); }
const read = (f) => fs.readFileSync(f, 'latin1').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
let words = read(pos[0]);
if (opt.only) { const keep = new Set(read(opt.only).map((w) => w.toLowerCase())); words = words.filter((w) => keep.has(w.toLowerCase())); }
if (opt.extra) words = words.concat(read(opt.extra));
const r = cd.build(words, { bytes: +opt.bytes || 16384, k: +opt.k || 5, lang: opt.lang || 'en', exact: !!opt.exact });
fs.writeFileSync(pos[1], r.file);
let ones = 0; for (const b of r.file.subarray(cd.HDR, cd.HDR + r.bytes)) for (let j = 0; j < 8; j++) ones += (b >> j) & 1;
const fill = ones / r.bits;
console.log(`${pos[1]}: ${r.file.length} bytes, ${r.words.length} words, ${r.bits} bits, k=${r.k}, fill ${(fill * 100).toFixed(1)}%, expected false-positive rate ${(Math.pow(fill, r.k) * 100).toFixed(2)}%`);
