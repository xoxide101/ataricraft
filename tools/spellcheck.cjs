#!/usr/bin/env node
// List words that are not in a Craft dictionary. Same hash and word rules as ACWriter's Search > Spell check.
// Usage: node tools/spellcheck.cjs FILE.CWD|FILE.txt [--dict docs/samples/EN.CDC] [--unique]
// Line numbers are editor lines (a soft line break starts a new line), the same as "Ln" in ACWriter.
const fs = require('fs');
const path = require('path');
const cd = require('./cdict.cjs');

const a = process.argv.slice(2), pos = []; let dictPath = path.join(__dirname, '..', 'docs', 'samples', 'EN.CDC'), unique = false;
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--dict') dictPath = a[++i];
  else if (a[i] === '--unique') unique = true;
  else pos.push(a[i]);
}
if (!pos.length) { console.error('usage: node tools/spellcheck.cjs FILE.CWD|FILE.txt [--dict EN.CDC] [--unique]'); process.exit(2); }

// one string per editor line; style and paragraph codes (< 32) are skipped
function linesOf(buf) {
  let bytes = buf;
  if (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'CRFT') bytes = buf.subarray(16, 16 + buf.readUInt16LE(8));
  else bytes = Buffer.from(buf.toString('latin1').replace(/\r\n?|\n|\x9b/g, '\r'), 'latin1'); // plain text: CR ends a line
  const lines = []; let cur = '';
  for (const b of bytes) {
    if (b === 13 || b === 14) { lines.push(cur); cur = ''; }
    else if (b < 32) continue;
    else if (b === 160 || b >= 127) cur += ' ';
    else cur += String.fromCharCode(b);
  }
  if (cur) lines.push(cur);
  return lines;
}

const dict = cd.parse(fs.readFileSync(dictPath));
const seen = new Set(); let bad = 0, total = 0;
linesOf(fs.readFileSync(pos[0])).forEach((line, i) => {
  for (const t of cd.tokens(line)) {
    total++;
    if (cd.has(dict, t.word)) continue;
    const key = t.word.toLowerCase();
    if (unique && seen.has(key)) continue;
    seen.add(key); bad++;
    console.log(`${i + 1}:${t.index + 1}\t${t.word}`);
  }
});
console.error(`${bad} unknown of ${total} words (dictionary ${path.basename(dictPath)}, ${dict.words} words, a Bloom filter: about 2% of misspellings can slip through, see docs/DICTIONARY.md)`);
