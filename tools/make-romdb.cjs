// Builds web/js/romdb.js from the WUDSN Atari ROM Checker sources (CartridgeDatabase.csv, ROMVersions.csv, CartridgeType.java).
// Usage: node tools/make-romdb.cjs <folder with those three files>
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
if (!dir) { console.log('usage: node make-romdb.cjs <folder>'); process.exit(1); }
const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
const ids = {};
for (const m of read('CartridgeType.java').matchAll(/^\s*\*\s+(CARTRIDGE_\w+)\s+=\s+(\d+)/gm)) ids[m[1]] = +m[2];
const split = (l) => [...l.matchAll(/"([^"]*)"|([^;]+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]).trim());
const carts = {};
let skipped = 0;
for (const l of read('CartridgeDatabase.csv').split(/\r?\n/).slice(1)) {
  const m = /^(\d+);'0x([0-9A-Fa-f]{8});?';"([^"]*)";"([^"]*)";"([^"]*)";(\w+)/.exec(l);
  if (!m || !ids[m[6]]) { skipped++; continue; }
  carts[m[2].toLowerCase()] = [+m[1], ids[m[6]], m[3], m[5]];
}
const os = {};
const rows = read('ROMVersions.csv').split(/\r?\n/);
const head = rows[0].split(';');
for (const l of rows.slice(1)) {
  const f = l.split(';');
  const crc = (f[head.indexOf('CRC32')] || '').replace(/^0x/i, '').toLowerCase();
  if (crc.length === 8) os[crc] = [f[head.indexOf('Type')], f[head.indexOf('Id')], f[head.indexOf('Revision')], f[head.indexOf('Year')]];
}
const out = '// Derived from the WUDSN Atari ROM Checker (cartridge database and ROM versions), (C) Peter Dell, GPL v2 or later: https://www.wudsn.com\n' +
  'window.AC = window.AC || {};\nAC.CART_DB = ' + JSON.stringify(carts) + ';\nAC.OS_DB = ' + JSON.stringify(os) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'web', 'js', 'romdb.js'), out);
console.log(`carts ${Object.keys(carts).length} (skipped ${skipped}), os/basic ${Object.keys(os).length}, ${out.length} bytes`);
