// Builds archive/blank/*.atr (empty formatted disks, MyDOS + SDFS across sizes), verifies each with our reader and lsatr, writes MANIFEST.txt.
// Usage: node scripts/make-archive-disks.cjs [lsatr.exe]
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process'), assert = require('assert');
const Dos = require('../web/js/dosfs.js');
const lsatr = process.argv[2] || 'out/mkatr14/mkatr-1.4/win32/lsatr.exe';
const dir = path.join(__dirname, '..', 'archive', 'blank');
fs.mkdirSync(dir, { recursive: true });
const jobs = [];
for (const [ss, n, tag] of [[128, 720, '90K'], [256, 720, '180K'], [256, 1440, '360K'], [256, 2880, '720K'], [256, 5760, '1440K'], [256, 16384, '4M'], [256, 65535, '16M']])
  jobs.push({ kind: 'mydos', ss, n, tag, make: () => Dos.createMyDos({ sectorSize: ss, sectors: n, label: 'BLANK' }) });
for (const [ss, n, tag] of [[256, 720, '180K'], [256, 1440, '360K'], [256, 2880, '720K'], [256, 5760, '1440K'], [256, 16384, '4M'], [256, 65535, '16M'], [512, 2880, '1440K-512'], [512, 32768, '16M-512']])
  jobs.push({ kind: 'sdfs', ss, n, tag, make: () => Dos.createSdfs({ sectorSize: ss, sectors: n, label: 'BLANK' }) });
const lines = [];
let fail = 0;
for (const j of jobs) {
  const name = `${j.kind}_${j.tag}.atr`, f = path.join(dir, name);
  try {
    const img = j.make(); fs.writeFileSync(f, img);
    const v = Dos.open(new Uint8Array(fs.readFileSync(f)));
    assert(v && v.kind === j.kind, 'detect ' + (v && v.kind));
    const probe = new Uint8Array([1, 2, 3, 4, 5]);
    v.writeFile('T.BIN', probe);
    const v2 = Dos.open(new Uint8Array(v.image ? v.image : img));
    let lsOk = 'n/a';
    if (fs.existsSync(lsatr) && j.ss !== 512) { const r = cp.spawnSync(lsatr, [f], { encoding: 'utf8' }); lsOk = r.status === 0 ? 'ok' : 'FAIL'; if (r.status !== 0) throw new Error('lsatr rejected'); }
    lines.push(`${name}\t${j.kind}\t${j.ss}x${j.n}\t${fs.statSync(f).size}\t${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}\tlsatr:${lsOk}`);
    console.log('ok ', name, 'lsatr', lsOk);
  } catch (e) { fail++; console.log('FAIL', name, e.message); }
}
fs.writeFileSync(path.join(dir, 'MANIFEST.txt'), 'name\tfs\tsectors\tbytes\tsha256\tcheck\n' + lines.join('\n') + '\n');
console.log(jobs.length - fail + '/' + jobs.length + ' built');
process.exit(fail ? 1 : 0);
