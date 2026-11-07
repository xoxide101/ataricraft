// Builds a self-booting ACWRITER.ATR (no DOS needed) from tools/acwriter/poc5.xex -> tools/acwriter/ACWRITER.ATR and ACWRITER.COM
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DC = require(path.join(ROOT, 'web/js/diskconv.js'));
const xex = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools/acwriter/poc5.xex')));
fs.writeFileSync(path.join(ROOT, 'tools/acwriter/ACWRITER.COM'), xex);
const atr = DC.xexToAtr(xex);
// DOS 2 layout for the documents the D: handler (word/diskfs.inc) saves: VTOC at 360, directory 361..368,
// everything after the boot program is free
const sec = (n) => atr.subarray(16 + (n - 1) * 128, 16 + n * 128);
let last = 359;
while (last > 3 && sec(last).every((b) => b === 0)) last--;
if (last >= 359) throw new Error('boot program too large for the document area');
const free = []; for (let s = last + 1; s <= 719; s++) if (s < 360 || s > 368) free.push(s);
const vt = sec(360);
vt[0] = 2; vt[1] = 709 & 255; vt[2] = 709 >> 8; vt[3] = free.length & 255; vt[4] = free.length >> 8;
for (const s of free) vt[10 + (s >> 3)] |= 0x80 >> (s & 7);
console.log('boot program ends at sector', last, '; free sectors', free.length, '(' + free.length * 125 + ' bytes)');
fs.writeFileSync(path.join(ROOT, 'tools/acwriter/ACWRITER.ATR'), atr);
const VER = fs.readFileSync(path.join(ROOT, 'tools/acwriter/word/version.inc'), 'utf8').match(/'([\d.]+)'/)[1];
fs.writeFileSync(path.join(ROOT, 'tools/acwriter/ACWRITER.VERSION.txt'), 'AC Writer ' + VER + '\n');
console.log('AC Writer ' + VER + ': ACWRITER.COM', xex.length, 'bytes; ACWRITER.ATR', atr.length, 'bytes');
