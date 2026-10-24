const D = require('../web/js/dosfs.js'), fs = require('fs'), cp = require('child_process'), path = require('path');
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const files = [];
files.push({ path: 'readme.txt', data: new Uint8Array([72, 105, 155]) });
files.push({ path: 'Read Me.txt', data: new Uint8Array([1, 2, 3]) });
files.push({ path: 'READ_ME.TXT', data: new Uint8Array([4, 5]) });
files.push({ path: 'games/long game name.xex', data: new Uint8Array(500000).map((_, i) => (i * 3) & 255) });
files.push({ path: 'games/long game name.bin', data: new Uint8Array(70000).fill(9) });
files.push({ path: 'games/deep/er/x.dat', data: new Uint8Array(1000).fill(7) });
files.push({ path: 'empty.txt', data: new Uint8Array(0) });
const r = D.buildSdfs(files, { freeBytes: 1 << 20 });
const v = D.open(r.image);
let bad = 0;
for (const e of r.entries) {
  const f = files.find((x) => x.path === e.host), got = v.list().find((x) => x.path === e.sdfs);
  if (!got || !eq(v.read(got), f.data)) { bad++; console.log('BAD', e.host, e.sdfs); }
}
console.log(r.entries.map((e) => e.host + ' -> ' + e.sdfs).join('\n'));
console.log('image', r.image.length, 'free sectors', r.free, bad ? 'FAIL' : 'ok');
fs.writeFileSync('out/folder.atr', r.image);
const ls = cp.spawnSync('out/mkatr14/mkatr-1.4/win32/lsatr.exe', ['out/folder.atr'], { encoding: 'utf8' });
console.log(ls.stdout);
// a folder that cannot fit
try { D.buildSdfs([{ path: 'big.bin', data: new Uint8Array(17 << 20) }]); console.log('FAIL: should not fit'); bad++; } catch (e) { console.log('too big ->', e.message); }
process.exit(bad ? 1 : 0);
