// Builds a self-booting ACWRITER.ATR (no DOS needed) from tools/acwriter/poc5.xex -> tools/acwriter/ACWRITER.ATR and ACWRITER.COM
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DC = require(path.join(ROOT, 'web/js/diskconv.js'));
const xex = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools/acwriter/poc5.xex')));
fs.writeFileSync(path.join(ROOT, 'tools/acwriter/ACWRITER.COM'), xex);
const atr = DC.xexToAtr(xex);
fs.writeFileSync(path.join(ROOT, 'tools/acwriter/ACWRITER.ATR'), atr);
console.log('ACWRITER.COM', xex.length, 'bytes; ACWRITER.ATR', atr.length, 'bytes');
