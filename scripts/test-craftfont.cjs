// Craft font model tests: node scripts/test-craftfont.cjs
const assert = require('assert');
const fs = require('fs');
const CF = require('../tools/craftfont.cjs');
const R = __dirname + '/../';
let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };

// metrics + built-ins
for (const adv of [4, 5, 6]) {
  const f = CF.parse(fs.readFileSync(R + 'web/library/fonts/craft/craft' + adv + '.acf'));
  assert.strictEqual(f.adv, adv); assert.strictEqual(f.gw, adv - 1); assert.strictEqual(f.rows, 12);
  assert.deepStrictEqual([f.head, f.xTop, f.base, f.desc, f.supUp, f.subDown], [2, 4, 8, 3, 2, 3]);
  const rowsUsed = (ch) => { const g = CF.glyph(f, ch.charCodeAt(0)); return g.map((b, i) => (b ? i : -1)).filter((i) => i >= 0); };
  const cap = rowsUsed('H'), low = rowsUsed('a'), g = rowsUsed('g');
  assert.strictEqual(Math.min(...cap), 2); assert.strictEqual(Math.max(...cap), 8);
  assert.strictEqual(Math.min(...low), 4); assert.strictEqual(Math.max(...low), 8);
  assert.strictEqual(Math.min(...g), 4); assert.ok(Math.max(...g) === 11);
  for (let c = 32; c < 128; c++) {
    const gl = CF.glyph(f, c);
    for (const b of gl) assert.ok((b & (0xff >> f.gw)) === 0, 'glyph ' + c + ' wider than ' + f.gw);
  }
  assert.ok(CF.glyph(f, 32).every((b) => !b));
  ok('built-in craft' + adv + ': ' + adv + ' px advance, cap rows 2..8, x-height 4, descender rows to ' + Math.max(...g));
  assert.deepStrictEqual(CF.parse(CF.serialize(f)), f);
  ok('craft' + adv + ' ACF2 round-trip');
}

// case locations (map), variants, shift
const f = CF.parse(fs.readFileSync(R + 'web/library/fonts/craft/craft5.acf'));
const A = CF.glyph(f, 65).slice(), a = CF.glyph(f, 97).slice();
CF.setCase(f, 'upper', 160); CF.setCase(f, 'lower', 192);
assert.deepStrictEqual(f.glyphs[160], A); assert.deepStrictEqual(f.glyphs[192], a);
assert.strictEqual(f.map[65], 160); assert.strictEqual(f.map[122], 192 + 25);
assert.deepStrictEqual(CF.glyph(f, 65), A);
f.first = 32; f.count = 224; // slots up to 255
ok('upper / lower case glyph locations move through the map');
f.supUp = 2; f.subDown = 3;
const sup = CF.render(f, 65, 1), sub = CF.render(f, 65, 2);
assert.strictEqual(sup.findIndex((b) => b), 0); assert.strictEqual(sub.findIndex((b) => b), 5);
f.sup[65] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
assert.strictEqual(CF.render(f, 65, 1)[3], 4);
const f2 = CF.parse(CF.serialize(f));
assert.deepStrictEqual(f2.map, f.map); assert.deepStrictEqual(f2.sup[65], f.sup[65]); assert.strictEqual(f2.upper, 160);
ok('sup/sub shift into headroom / descender rows, variants and map survive ACF2');
assert.deepStrictEqual(CF.fromJson(CF.toJson(f2)).glyphs[160], f2.glyphs[160]);
ok('JSON round-trip');

// 6502 .inc
const inc = CF.toInc(f2, 'cx');
assert.ok(/cx_ADV = 5/.test(inc) && /cx_11:/.test(inc) && /cx_map:/.test(inc) && /cx_BASE = 8/.test(inc));
assert.strictEqual((inc.match(/\.byte/g) || []).length, 12 * 14 + 16);
ok('.inc has 12 planes and the code map');

// old ACF1 still loads
const a1 = Buffer.concat([Buffer.from('ACF1'), Buffer.from([1, 5, 8, 1]), Buffer.alloc(96 * 8, 0x80)]);
const o = CF.parse(a1);
assert.strictEqual(o.adv, 5); assert.strictEqual(o.rows, 8); assert.strictEqual(CF.glyph(o, 65)[0], 0x80);
ok('ACF1 file loads with inferred metrics (' + o.head + ' head, ' + o.desc + ' desc)');
// wide (12x12) rows, derive, lock, serialize/json/inc roundtrips
{
  const m = CF.createSize(12, { name: 'T' });
  for (let c = 33; c < 127; c++) m.glyphs[c] = [0, 0, 0xff80 & 0xffc0, 0x8040, 0x8040, 0xffc0, 0x8040, 0x8040, 0x8040, 0, 0, 0];
  const p = CF.parse(CF.serialize(m));
  assert.ok(CF.isWide(p)); assert.deepStrictEqual(p.glyphs[65], m.glyphs[65]); assert.strictEqual(p.adv, 12);
  assert.deepStrictEqual(CF.fromJson(CF.toJson(m)).glyphs[66], m.glyphs[66]);
  assert.ok(/cf_\d+L/.test(CF.toInc(m, 'cf')) || /_\d+L/.test(CF.toInc(m, 'cf')));
  ok('12x12 wide rows roundtrip through ACF2, JSON and .inc');
  const fam = CF.familyNew(m);
  let r = CF.familyDerive(fam, [10, 8, 6, 5, 4]);
  assert.deepStrictEqual(r.done, [10, 8, 6, 5, 4]);
  for (const s of [10, 8, 6, 5, 4]) { const f = fam.sizes[s]; assert.strictEqual(f.origin, CF.ORIGIN.derived); for (let c = 33; c < 127; c++) assert.ok(f.glyphs[c].some((v) => v), s + ':' + c); assert.strictEqual(CF.parse(CF.serialize(f)).origin, 1); }
  fam.sizes[8].glyphs[65][0] = 0x80; CF.markEdited(fam.sizes[8]); fam.sizes[4].locked = true;
  const keep = fam.sizes[8].glyphs[65].join(), k4 = fam.sizes[4];
  r = CF.familyDerive(fam, [8, 4, 6]);
  assert.deepStrictEqual(r.skipped, [8, 4]); assert.strictEqual(fam.sizes[8].glyphs[65].join(), keep); assert.strictEqual(fam.sizes[4], k4);
  assert.strictEqual(CF.parse(CF.serialize(fam.sizes[8])).origin, 2); assert.strictEqual(CF.parse(CF.serialize(fam.sizes[4])).locked, true);
  r = CF.familyDerive(fam, [8, 4], { force: true }); assert.deepStrictEqual(r.done, [8, 4]);
  assert.strictEqual(CF.familyFromJson(CF.familyToJson(fam)).sizes[10].adv, 10);
  ok('derive 10/8/6/5/4 from a 12x12 master; hand-edited/locked kept, force overrides, origin persisted');
}
console.log('test-craftfont: ' + n + ' groups passed');
