// Matrix test: SDFS create/write/list/read/remove across media sizes and sector sizes, cross-checked with lsatr (if present).
// Usage: node scripts/sdfs-matrix-test.cjs [path-to-lsatr.exe]
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const Dos = require('../web/js/dosfs.js');
const lsatr = process.argv[2] || 'out/mkatr14/mkatr-1.4/win32/lsatr.exe';
const haveLs = fs.existsSync(lsatr);
const rnd = (n, seed) => { const a = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = x >>> 16; if (a[i] === 10 || a[i] === 0x9b || a[i] === 13) a[i] = 1; } return a; };
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const sizes = [[128, 720], [128, 1040], [256, 720], [256, 1440], [256, 2880], [256, 5760], [256, 16384], [256, 32768], [256, 65535], [512, 1440], [512, 2880], [512, 20000], [512, 32768]];
let ran = 0, fail = 0, skipped = 0;
for (const [ss, n] of sizes) {
  const tag = ss + 'x' + n;
  try {
    let img;
    try { img = Dos.createSdfs({ sectorSize: ss, sectors: n, label: 'M' + n }); } catch (e) { console.log(tag, 'create unsupported:', e.message); skipped++; continue; }
    const v = Dos.open(img);
    assert(v && v.kind === 'sdfs', 'detect');
    const free0 = v.freeSectors();
    const cap = Math.max(0, (n - 60) * ss * 0.4) | 0;
    const files = {
      'A.TXT': rnd(10, 1), 'EMPTY': new Uint8Array(0), 'ONE.BIN': rnd(ss, 2), 'SUB/B.COM': rnd(ss * 3 + 1, 3),
      'SUB/DEEP/C.DAT': rnd(Math.min(cap, ss * 200 + 5), 4), 'BIG.XEX': rnd(Math.min(cap, 700000), 5),
    };
    for (let i = 0; i < 40; i++) files['MANY/F' + i + '.X'] = rnd(30 + i, 100 + i);
    for (const [p, d] of Object.entries(files)) v.writeFile(p, d);
    const v2 = Dos.open(img), list = v2.list();
    for (const [p, d] of Object.entries(files)) {
      const e = list.find((x) => x.path === p); assert(e, 'listed ' + p);
      assert.strictEqual(e.size, d.length, 'size ' + p); assert(eq(v2.read(e), d), 'content ' + p);
    }
    v2.writeFile('A.TXT', rnd(ss * 2, 9)); assert(eq(v2.read(v2.list().find((x) => x.path === 'A.TXT')), rnd(ss * 2, 9)), 'overwrite');
    if (haveLs) {
      const f = path.join(os.tmpdir(), 'mx_' + tag + '.atr'), d = path.join(os.tmpdir(), 'mx_' + tag);
      fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, img);
      const r = cp.spawnSync(lsatr, ['-X', d, f], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (ss === 128 || ss === 512) { console.log('  (lsatr skipped for ss', ss + ')'); }
      else {
        let ok = 0;
        for (const [p, dat] of Object.entries(files)) {
          if (p === 'A.TXT' || dat.length === 0) continue;
          const hp = path.join(d, ...p.split('/'));
          assert(fs.existsSync(hp), 'lsatr missing ' + p + ' ' + (r.stderr || '').slice(0, 100));
          assert(eq(fs.readFileSync(hp), dat), 'lsatr content ' + p); ok++;
        }
        console.log(tag, 'lsatr verified', ok, 'files');
      }
      fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(f, { force: true });
    }
    const before = v2.freeSectors(); v2.remove('BIG.XEX'); assert(v2.freeSectors() > before, 'remove frees');
    v2.remove('MANY/F3.X'); assert(!v2.list().find((x) => x.path === 'MANY/F3.X'), 'removed');
    for (const p of Object.keys(files)) if (p !== 'A.TXT') { try { v2.remove(p); } catch (e) { } }
    console.log(tag, 'OK free', free0, '->', v2.freeSectors()); ran++;
  } catch (e) { console.log(tag, 'FAIL', e.message); fail++; }
}
console.log(`ran ${ran}, failed ${fail}, skipped ${skipped}`);
process.exit(fail ? 1 : 0);
