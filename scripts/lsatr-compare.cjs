// Compare dosfs.js listings/contents against dmsc lsatr on real images.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const D = require('../web/js/dosfs.js');
const LS = path.resolve(__dirname, '../out/mkatr14/mkatr-1.4/win32/lsatr.exe');
const files = process.argv.slice(2);
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const nl = (b) => { let n = 0; for (const x of b) if (x === 10) n++; return n; };
let bad = 0;
for (const f of files) {
  const raw = fs.readFileSync(f);
  let vol; try { vol = D.open(new Uint8Array(raw)); } catch (e) { console.log('SKIP', path.basename(f), e.message); continue; }
  const mine = new Map();
  for (const e of vol.list()) { const p = (e.path || e.name).replace(/\/$/, ''); if (!e.dir && !e.isDir) mine.set(p.toUpperCase(), e); }
  const out = path.resolve(__dirname, '../out/lsx'); fs.rmSync(out, { recursive: true, force: true });
  const r = cp.spawnSync(LS, ['-X', out, f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const theirs = new Map();
  const walk = (d, pre) => { for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) { const fp = path.join(d, n), p = pre ? pre + '/' + n : n; fs.statSync(fp).isDirectory() ? walk(fp, p) : theirs.set(p.toUpperCase(), fp); } };
  walk(out, '');
  let miss = 0, diff = 0, same = 0;
  for (const [p, e] of mine) {
    const t = theirs.get(p); if (!t) { miss++; continue; }
    const a = Buffer.from(vol.read(e)), b = fs.readFileSync(t);
    // Windows lsatr writes in text mode: LF -> CRLF
    if (a.equals(b) || b.length === a.length + nl(a) && md5(b) === md5(Buffer.from(a.toString('latin1').replace(/\n/g, '\r\n'), 'latin1'))) same++; else diff++;
  }
  const extra = [...theirs.keys()].filter((p) => !mine.has(p)).length;
  const ok = !miss && !diff && !extra;
  if (!ok) bad++;
  console.log((ok ? 'OK  ' : 'DIFF'), path.basename(f), vol.kind, 'mine', mine.size, 'lsatr', theirs.size, 'same', same, 'diff', diff, 'missing-in-lsatr', miss, 'extra-in-lsatr', extra);
}
process.exit(bad ? 1 : 0);
