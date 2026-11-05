// Measure the false-positive rate of a CDIC dictionary against words that are not English.
// Usage: node scripts/dict-fp.cjs DICT.CDC ENABLE.txt     (ENABLE = the public-domain word list used as the "real words" oracle)
// 1) 200000 random lowercase strings of 3..10 letters, 2) every single-letter misspelling (delete, swap, replace, insert)
// of 3000 dictionary words, keeping only strings that are NOT in the oracle. The "all-oracle" row (dictionary words) must be 100% accepted.
const fs = require('fs');
const cd = require('../tools/cdict.cjs');
const d = cd.parse(fs.readFileSync(process.argv[2]));
const oracle = new Set(fs.readFileSync(process.argv[3], 'latin1').split(/\r?\n/).filter(Boolean));
let s = 20240607;
const rn = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0), s >>> 16);
const L = 'abcdefghijklmnopqrstuvwxyz';
let n = 0, fp = 0;
for (let i = 0; i < 200000; i++) {
  let w = ''; const len = 3 + (rn() % 8);
  for (let j = 0; j < len; j++) w += L[rn() % 26];
  if (oracle.has(w)) continue;
  n++; if (cd.testBloom(d, w)) fp++;
}
console.log(`random strings: ${fp}/${n} accepted = ${(fp / n * 100).toFixed(2)}%`);
const dictWords = [...oracle].filter((w) => w.length >= 4 && cd.testBloom(d, w) && !w.includes("'"));
const sample = []; for (let i = 0; i < 3000; i++) sample.push(dictWords[rn() % dictWords.length]);
let m = 0, mf = 0; const seen = new Set();
for (const w of sample) {
  const c = [];
  for (let i = 0; i < w.length; i++) {
    c.push(w.slice(0, i) + w.slice(i + 1));
    if (i + 1 < w.length) c.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    for (const ch of L) { c.push(w.slice(0, i) + ch + w.slice(i + 1)); c.push(w.slice(0, i) + ch + w.slice(i)); }
  }
  for (const x of c) {
    if (x.length < 2 || oracle.has(x) || seen.has(x)) continue;
    seen.add(x); m++; if (cd.testBloom(d, x)) mf++;
  }
}
console.log(`single-edit misspellings: ${mf}/${m} accepted = ${(mf / m * 100).toFixed(2)}%`);
let ok = 0, tot = 0; for (const w of sample) { tot++; if (cd.has(d, w)) ok++; }
console.log(`dictionary words accepted: ${ok}/${tot}`);
