// Compares the glyphs ACWriter draws with (text view font4.inc, chrome font6.inc) against the built-in Craft 5 px / 6 px faces.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..') + path.sep;
const CF = require(R + 'tools/craftfont.cjs');
const f5 = CF.parse(fs.readFileSync(R + 'web/library/fonts/craft/craft5.acf'));
const f6 = CF.parse(fs.readFileSync(R + 'web/library/fonts/craft/craft6.acf'));
const f4 = JSON.parse(fs.readFileSync(R + 'tools/acwriter/font4.json', 'utf8'));
const inc6 = fs.readFileSync(R + 'tools/acwriter/font6.inc', 'utf8').split(/\r?\n/).filter((l) => /\.byte/.test(l)).map((l) => l.replace(/.*\.byte\s+/, '').split(',').map(Number));
let bad5 = [], bad6 = [];
for (let a = 32; a < 128; a++) {
  const g5 = f5.glyphs[a], g6 = f6.glyphs[a];
  // craft rows: HEAD=2.. ; 7 visible rows of the 8x8 cell
  const w5 = Array.from({ length: 7 }, (_, i) => (g5[2 + i] || 0) >> 4);
  const t5 = f4[a - 32];
  if (JSON.stringify(w5) !== JSON.stringify(t5)) bad5.push(String.fromCharCode(a));
  const w6 = Array.from({ length: 7 }, (_, i) => g6[2 + i] || 0).concat([0]);
  if (JSON.stringify(w6) !== JSON.stringify(inc6[a - 32])) bad6.push(String.fromCharCode(a));
}
console.log('text face (font4) differs from Craft 5px rows 2..8 for: ' + (bad5.join('') || 'none'));
console.log('chrome face (font6) differs from Craft 6px rows 2..8 for: ' + (bad6.join('') || 'none'));
