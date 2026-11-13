// Rebuilds web/library/craftapps/Tools/AtariCraft Tools 360K.atr from the tracked tool binaries and verifies it.
// Usage: node scripts/build-tools-atr.cjs
// Runs tools/make-tools-disk.cjs, then re-reads the ATR with the project's own MyDOS reader and checks that the
// directory lists every tracked tool COM and that each file is byte-identical to its source (ACWRITER.COM included).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const atr = path.join(root, 'web/library/craftapps/Tools/AtariCraft Tools 360K.atr');
const r = cp.spawnSync(process.execPath, [path.join(root, 'tools/make-tools-disk.cjs')], { stdio: 'inherit' });
if (r.status !== 0) { console.error('make-tools-disk failed'); process.exit(1); }

global.window = global; global.AC = {};
const load = (f) => (0, eval)(fs.readFileSync(path.join(root, 'web/js', f), 'utf8'));
load('dosfs.js'); load('afmcore.js');
const m = AC.AfmCore.mount(new Uint8Array(fs.readFileSync(atr)), 'tools.atr');
const list = m.vol.list();
const byName = new Map(list.map((e) => [e.name, e]));
console.log(m.kind, 'files', list.length, 'free sectors', m.vol.freeSectors());
console.log(list.map((e) => e.name).join(' '));

// every COM tracked under tools/ must be on the disk (names upper-cased, duplicates by name must be identical)
const tracked = cp.execFileSync('git', ['ls-files', 'tools/**/*.com', 'tools/*.com', 'tools/**/*.COM'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);
let bad = 0;
for (const f of tracked) {
  const name = path.basename(f).toUpperCase();
  const e = byName.get(name);
  const src = fs.readFileSync(path.join(root, f));
  if (!e) { console.log('MISSING ', name, '(' + f + ')'); bad++; continue; }
  const same = Buffer.compare(Buffer.from(m.vol.read(e)), src) === 0;
  console.log(same ? 'ok      ' : 'MISMATCH', name, src.length, 'bytes');
  if (!same) bad++;
}
if (!byName.has('ACWRITER.COM')) { console.log('ACWRITER.COM not on disk'); bad++; }
console.log(bad ? 'FAILED: ' + bad + ' problem(s)' : 'OK: ' + tracked.length + ' tool COMs verified');
process.exit(bad ? 1 : 0);
