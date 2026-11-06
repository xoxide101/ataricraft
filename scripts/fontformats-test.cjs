// Round-trip tests for every bitmap / container format in tools/fontformats.cjs (read -> write -> read, pixels compared).
const fs = require('fs'), path = require('path'), assert = require('assert');
const CF = require('../tools/craftfont.cjs'), FF = require('../tools/fontformats.cjs'), SF = require('../tools/sfnt.cjs'), FP = require('../tools/fontpipe.cjs');
const ROOT = path.join(__dirname, '..'), ok = (m) => console.log('ok  ' + m);
const m12 = CF.parse(fs.readFileSync(path.join(ROOT, 'font/craft12.acf')));
const f8 = CF.derive(m12, 8, {}), f16 = CF.derive(m12, 16, {});
const cell = (f, c, cw, ch) => FF.writeRaw(f, { cw, ch, first: c, count: 1 });
const same = (a, b, cw, ch, codes, what) => { for (const c of codes) assert.deepStrictEqual(cell(a, c, cw, ch), cell(b, c, cw, ch), what + ' glyph ' + c); };
const ascii = []; for (let c = 32; c < 127; c++) ascii.push(c);
const some = (f) => ascii.filter((c) => cell(f, c, 8, 8).some((v) => v)).length;
assert.ok(some(f8) > 80, 'test font has ink');

// raw cells: 8x8 and 8x16, odd width 5x7, 12x12
for (const [cw, ch, f] of [[8, 8, f8], [8, 16, f16], [5, 7, f8], [12, 12, m12]]) {
  const b = FF.writeRaw(f, { cw, ch }), g = FF.readRaw(b, { cw, ch });
  same(f, g, cw, ch, ascii, 'raw ' + cw + 'x' + ch); assert.ok(FF.writeRaw(g, { cw, ch }).equals(b));
  ok('raw ' + cw + 'x' + ch + ': ' + b.length + ' bytes, read back identical');
}
// Atari .fnt: both orders, inverse half
{
  const sc = FF.writeAtari(f8, {}), at = FF.writeAtari(f8, { order: 'atascii' }), inv = FF.writeAtari(f8, { inverse: true });
  assert.strictEqual(sc.length, 1024); assert.ok(!sc.equals(at));
  const a = FF.readAtari(at, { order: 'atascii' }), s = FF.readAtari(sc, {});
  assert.ok(FF.writeAtari(a, {}).equals(sc), 'ATASCII order reads to the same font'); assert.ok(FF.writeAtari(s, {}).equals(sc));
  assert.strictEqual(inv.length, 2048); assert.ok(inv.subarray(0, 1024).equals(sc)); assert.strictEqual(inv[1024 + 8], sc[8] ^ 255);
  assert.ok(FF.writeAtari(FF.readAtari(inv, {}), {}).equals(sc)); assert.strictEqual(sc.readUInt8(0x21 * 8 - 0x20 * 8 + 8 * 0) !== undefined, true);
  ok('Atari .fnt: screen-code and ATASCII order, 2 KB with inverse half');
}
// C64 2048 and .64c, ZX 768, MSX / CPC
{
  const c = FF.write('c64', f8, {}), c2 = FF.write('c64', f8, { header: true });
  assert.strictEqual(c.bytes.length, 2048); assert.strictEqual(c2.bytes.length, 2050); assert.strictEqual(FF.detect(c2.bytes, 'x.64c'), 'c64');
  const g = FF.read(c2.bytes, 'x.64c', {}), cov = [...Array(32).keys()].map((i) => i + 64).concat([...Array(32).keys()].map((i) => i + 32));
  same(f8, g, 8, 8, cov, 'c64'); assert.ok(FF.write('c64', g, {}).bytes.equals(c.bytes)); ok('C64: 2048 and .64c (2-byte load address) round trip, uppercase/graphics set');
  const z = FF.write('zx', f8, {}); assert.strictEqual(z.bytes.length, 768); assert.strictEqual(FF.detect(z.bytes, 'a.bin'), 'zx');
  const zg = FF.read(z.bytes, 'a.zx', {}); same(f8, zg, 8, 8, ascii.concat([127]), 'zx'); assert.ok(FF.write('zx', zg, {}).bytes.equals(z.bytes)); ok('ZX Spectrum 768 bytes round trip');
  for (const id of ['msx', 'cpc']) { const w = FF.write(id, f8, {}), g2 = FF.read(w.bytes, 'a.' + id, {}); same(f8, g2, 8, 8, ascii, id); assert.strictEqual(w.bytes.length, 2048); ok(id.toUpperCase() + ' 2048 bytes round trip'); }
}
// PSF 1 / 2
for (const [cw, ch, f, ver] of [[8, 8, f8, 1], [8, 16, f16, 1], [12, 12, m12, 2]]) {
  const w = FF.writePsf(f, { cw, ch }), g = FF.readPsf(w);
  assert.strictEqual(w[0] === 0x36, ver === 1); same(f, g, cw, ch, ascii, 'psf'); assert.ok(FF.writePsf(g, { cw, ch }).equals(w)); assert.strictEqual(FF.detect(w, 'a.psf'), 'psf');
  ok('PSF' + ver + ' ' + cw + 'x' + ch + ' round trip (' + w.length + ' bytes)');
}
// PCF
{
  const w = FF.writePcf(f8), g = CF.fromPcf(w, { size: 8 }); same(f8, g, 8, 8, ascii, 'pcf'); same(f8, g, 8, 12, ascii, 'pcf12');
  assert.ok(FF.writePcf(g).equals(w)); ok('PCF (minimal writer) -> CF.fromPcf: pixels identical, writer idempotent (' + w.length + ' bytes)');
}
// GEM
for (const [cw, ch, f] of [[8, 8, f8], [8, 16, f16]]) {
  const w = FF.writeGem(f, { cw, ch }), g = FF.readGem(w); same(f, g, cw, ch, ascii, 'gem'); assert.ok(FF.writeGem(g, { cw, ch }).equals(w)); assert.strictEqual(FF.detect(w, 'a.fnt'), 'gem');
  ok('Atari ST/GEM .fnt ' + cw + 'x' + ch + ' round trip (' + w.length + ' bytes)');
}
// TTC, EOT, WOFF through the sfnt pipeline
{
  const a = FP.toTtf(f8, {}), b = FP.toTtf(m12, { merge: true });
  const ttc = FF.ttcPack([a, b]); assert.strictEqual(SF.ttcCount(ttc), 2); assert.strictEqual(FF.detect(ttc, 'x.ttc'), 'ttc');
  for (const [i, src] of [[0, a], [1, b]]) {
    const one = FF.ttcUnpack(ttc, i), back = FP.fromTtfExport(one), orig = FP.fromTtfExport(src);
    assert.deepStrictEqual(back.glyphs[65], orig.glyphs[65], 'ttc member ' + i); assert.ok(SF.parse(ttc, i).gidFor(65) > 0);
  }
  ok('TTC: 2 fonts packed, each unpacked and parsed (pixels identical)');
  const eot = FF.eotWrap(a, 'Craft 8'); assert.strictEqual(FF.detect(eot, 'x.eot'), 'eot'); assert.ok(FF.eotUnwrap(eot).equals(a)); ok('EOT wrap/unwrap: TTF bytes identical');
  const woff = SF.woff(a); assert.deepStrictEqual(FP.fromTtfExport(Buffer.from(woff)).glyphs[65], f8.glyphs[f8.map[65]] ? FP.fromTtfExport(a).glyphs[65] : null); ok('WOFF 1: write -> read back pixels identical');
}
console.log('fontformats-test: all passed');
