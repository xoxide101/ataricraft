const assert = require('assert');
const APT = require('../tools/apt/apt.cjs');

const parts = [
  { sectorSize: 512, sectors: 2048, name: 'SYSTEM' },
  { sectorSize: 512, sectors: 65535, name: 'GAMES', writeProtected: true },
  { sectorSize: 256, sectors: 4096, name: 'DD256', mapping: 1 },
];
const img = APT.build(parts, { boot: 1 });
assert.strictEqual(img[510], 0x55); assert.strictEqual(img[511], 0xaa);
assert.strictEqual(img[0x1be + 4], 0x7f);
assert.strictEqual(String.fromCharCode(img[513], img[514], img[515]), 'APT');

const r = APT.parse(img);
assert.strictEqual(r.aptLba, 1);
assert.strictEqual(r.boot, 1);
assert.strictEqual(r.slots.length, 3);
assert.deepStrictEqual(r.slots.map((s) => s.name), ['SYSTEM', 'GAMES', 'DD256']);
assert.deepStrictEqual(r.slots.map((s) => s.sectorSize), [512, 512, 256]);
assert.deepStrictEqual(r.slots.map((s) => s.count), [2048, 65535, 4096]);
assert.strictEqual(r.slots[1].writeProtected, true);
assert.strictEqual(r.slots[2].mapping, 1);
assert.strictEqual(r.slots[0].start, 3);
assert.strictEqual(r.slots[1].start, r.slots[0].start + 2048 + 1);
console.log('built', img.length, 'bytes; synthetic APT round-trip OK');

// Optional: real APT images passed on the command line
for (const f of process.argv.slice(2)) {
  const p = APT.parse(new Uint8Array(require('fs').readFileSync(f)));
  console.log(f, JSON.stringify({ apt: p.aptLba, boot: p.boot, parts: p.slots.map((s) => [s.drive, s.name, s.sectorSize, s.count]) }));
}
