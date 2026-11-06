// Scans a Windows folder for Atari DOS disk images (.atr/.xfd, loose or inside .zip), detects the DOS from the
// boot sectors and directory, and writes/updates dosboot.json (boot records, see docs/DOSBOOT.md).
//   node scripts/dosboot-scan.cjs <folder> [--out FILE] [--all] [--no-register] [--dry] [--verbose] [--machine 130xe] [--ram 128]
// Records you edited by hand (set "userEdited": true) are kept on re-scan. The folder is also remembered in
// ~/.ataricraft-dosboot.json so the local relay (tools/tnfs-bridge/bridge.cjs) can serve it to the emulator.
const fs = require('fs'), path = require('path'), os = require('os');
const DB = require('../web/js/dosboot.js');
const { scan } = require('../tools/dosboot/scan.cjs');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--machine', '--ram'].includes(args[i - 1])));
if (!root || flag('--help')) {
  console.log('usage: node scripts/dosboot-scan.cjs <folder> [--out FILE] [--all] [--no-register] [--dry] [--verbose] [--machine MODEL] [--ram KB]');
  process.exit(root ? 0 : 2);
}
const base = path.resolve(root);
if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) { console.error('not a folder: ' + base); process.exit(2); }
const outFile = path.resolve(opt('--out') || path.join(base, 'dosboot.json'));

const { records, skipped, warnings } = scan(base, { all: flag('--all'), machine: opt('--machine'), ram: opt('--ram') });
let existing = { records: [] };
if (fs.existsSync(outFile)) { try { existing = DB.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { console.error('existing ' + outFile + ' ignored: ' + e.message); } }
const doc = { format: DB.FORMAT, version: DB.VERSION, title: 'DOS boot records', root: base, generated: new Date().toISOString().slice(0, 10), records: DB.merge(existing, records) };

console.log('scanned ' + base);
for (const r of doc.records) console.log(('  ' + r.id).padEnd(64).slice(0, 64), r.family.padEnd(15), (r.version || '-').padEnd(6), r.machine.model + '/' + r.machine.ram + 'K');
console.log(doc.records.length + ' boot records, ' + skipped.length + ' skipped');
warnings.forEach(([n, w]) => console.log('  WARN', n, '-', w));
if (flag('--verbose')) skipped.forEach(([n, w]) => console.log('  skip', n, '-', w));
if (flag('--dry')) process.exit(0);
fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote ' + outFile);

if (!flag('--no-register')) {
  const reg = path.join(os.homedir(), '.ataricraft-dosboot.json');
  let d = { roots: [] };
  try { d = JSON.parse(fs.readFileSync(reg, 'utf8')); } catch (e) { /* new registry */ }
  const cur = d.roots.find((r) => path.resolve(r.root) === base);
  if (cur) cur.file = outFile; else d.roots.push({ root: base, file: outFile });
  fs.writeFileSync(reg, JSON.stringify(d, null, 2) + '\n');
  console.log('registered in ' + reg + ' (the relay serves it to the emulator)');
}
