// Tests web/js/dosfs.js: SDFS create/write/read-back, directories, delete, large files. Optional args: real image paths to list.
const assert = require('assert');
const fs = require('fs');
const Dos = require('../web/js/dosfs.js');

const rnd = (n, seed) => { const a = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = x >>> 16; } return a; };
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

for (const [ss, n] of [[256, 65535], [256, 1440], [512, 20000]]) {
  const img = Dos.createSdfs({ sectorSize: ss, sectors: n, label: 'TEST' });
  const v = Dos.open(img);
  assert(v && v.kind === 'sdfs', 'detect sdfs ' + ss + '/' + n);
  assert.strictEqual(v.sectors, n);
  const free0 = v.freeSectors();
  const files = {
    'HELLO.TXT': rnd(10, 1), 'EMPTY.DAT': new Uint8Array(0), 'ONE.BIN': rnd(ss, 2),
    'SUB/A.COM': rnd(1000, 3), 'SUB/DEEP/B.COM': rnd(ss * 130 + 7, 4), 'BIG.DAT': rnd(Math.min(3000000, (n - 100) * ss / 2), 5),
  };
  for (const [p, d] of Object.entries(files)) v.writeFile(p, d);
  for (let i = 0; i < 60; i++) v.writeFile('SUB/F' + i + '.X', rnd(50 + i, 100 + i));
  const v2 = Dos.open(img);
  const list = v2.list();
  for (const [p, d] of Object.entries(files)) {
    const e = list.find((x) => x.path === p);
    assert(e, 'listed ' + p);
    assert.strictEqual(e.size, d.length);
    assert(eq(v2.read(e), d), 'content ' + p);
  }
  for (let i = 0; i < 60; i++) assert(eq(v2.read(list.find((x) => x.path === 'SUB/F' + i + '.X')), rnd(50 + i, 100 + i)));
  assert(list.find((x) => x.path === 'SUB/' && 0) || list.find((x) => x.dir && x.path === 'SUB'), 'dir listed');
  // overwrite + delete returns space
  v2.writeFile('HELLO.TXT', rnd(500, 9));
  assert(eq(v2.read(v2.list().find((x) => x.path === 'HELLO.TXT')), rnd(500, 9)));
  const before = v2.freeSectors();
  v2.remove('BIG.DAT');
  assert(v2.freeSectors() > before);
  assert(!v2.list().find((x) => x.path === 'BIG.DAT'));
  // free count equals bitmap count
  const s1 = Dos.layout(img).sec(1);
  const L = Dos.layout(img), bs = s1[16] | (s1[17] << 8);
  let bits = 0;
  for (let k = 1; k <= n; k++) if (L.sec(bs + Math.floor(k / (ss * 8)))[(k % (ss * 8)) >> 3] & (0x80 >> (k & 7))) bits++;
  assert.strictEqual(bits, v2.freeSectors(), 'bitmap vs header free count');
  assert(free0 > v2.freeSectors());
  console.log(`ok SDFS ${ss}B x ${n}: ${v2.list().length} entries, free ${v2.freeSectors()}`);
}

// a layout check: packed ATR size
assert.strictEqual(Dos.makeAtr(256, 65535).length, 16 + 384 + 65532 * 256);

// disk full
{
  const img = Dos.createSdfs({ sectorSize: 256, sectors: 200 });
  const v = Dos.open(img);
  assert.throws(() => v.writeFile('X.BIN', new Uint8Array(256 * 400)), /full/);
  console.log('ok disk-full');
}

for (const p of process.argv.slice(2)) {
  const v = Dos.open(new Uint8Array(fs.readFileSync(p)));
  if (!v) { console.log(p, ': not recognised'); continue; }
  const l = v.list();
  console.log(p, v.kind, v.label, v.sectorSize + 'B', v.sectors, 'sectors, uniform=' + v.layoutUniform, l.length, 'entries');
  for (const e of l.filter((x) => !x.dir)) { const d = v.read(e); if (!e.approxSize && d.length !== e.size) console.log('  SIZE MISMATCH', e.path, e.size, d.length); }
}
console.log('all dosfs tests passed');
