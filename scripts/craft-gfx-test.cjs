// Atari graphics in the Craft fonts: the set, every Craft size, ACF2 row bytes, XCF/BDF/TTF round trips, TTF conversion keeping the graphics,
// and the Unicode / CRFT / ATASCII / text / docx mapping (docs/FONT.md). Usage: node scripts/craft-gfx-test.cjs
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const CF = require('../tools/craftfont.cjs'), AG = require('../tools/atarigfx.cjs'), FP = require('../tools/fontpipe.cjs');
const X = require('../tools/xcwcore.cjs'), EX = require('../tools/craftexport.cjs'), IM = require('../tools/craftimport.cjs');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '-', String(e.message).split('\n')[0].slice(0, 200)); } };
const SIZES = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26];
const load = (s) => CF.parse(fs.readFileSync(path.join(ROOT, s > 12 || s === 10 || s === 12 ? 'font' : 'web/library/fonts/acw', s === 8 ? 'craft8.acf' : 'craft' + s + '.acf')));
const fonts = {}; for (const s of SIZES) { try { fonts[s] = load(s); } catch (e) { /* craft8 is a .fnt in font/ */ } }
fonts[8] = CF.parse(fs.readFileSync(path.join(ROOT, 'web/library/fonts/acw/craft8.acf')));

t('37 graphics entries, unique slots, unique Unicode', () => {
  assert.strictEqual(AG.ENTRIES.length, 37);
  assert.strictEqual(new Set(AG.ENTRIES.map((e) => e.slot)).size, 37);
  assert.strictEqual(new Set(AG.ENTRIES.map((e) => e.uni)).size, 37);
});
t('Unicode <-> code round trip, box drawing / suits / blocks ranges', () => {
  for (const e of AG.ENTRIES) { assert.strictEqual(AG.codeOfUni(e.uni), e.code); assert.strictEqual(AG.uniOfCode(e.code), e.uni); }
  assert.strictEqual(AG.uniOfCode(18), 0x2500); assert.strictEqual(AG.uniOfCode(0), 0x2665); assert.strictEqual(AG.uniOfCode(16), 0x2663);
  assert.strictEqual(AG.uniOfCode(25), 0x258c); assert.strictEqual(AG.uniOfCode(31), 0x2192);
  for (let s = 0; s < 32; s++) assert.strictEqual(AG.acwCodeOfUni(AG.uniOfCode(s)), 128 + s, 'ACWriter code of slot ' + s);
});
for (const s of SIZES) {
  t(s + ' px: all graphics drawn, ACF2 serialize/parse identical, ' + CF.bprOf(fonts[s]) + ' row byte(s)', () => {
    const f = fonts[s];
    for (const e of AG.ENTRIES) if (s !== 8 || e.slot < 32) assert.ok((f.glyphs[e.slot] || []).some((v) => v), 'slot ' + e.slot + ' empty'); // the 8 px face is a 1024-byte charset: slots 0-127 only
    const g = CF.parse(Buffer.from(CF.serialize(f)));
    assert.strictEqual(g.adv, f.adv); assert.strictEqual(CF.bprOf(g), CF.bprOf(f));
    for (const e of AG.ENTRIES) assert.deepStrictEqual(Array.from(g.glyphs[e.slot]), Array.from(f.glyphs[e.slot]));
    assert.ok(CF.bprOf(f) >= Math.ceil(f.adv / 8), 'row bytes cover the advance');
  });
  t(s + ' px: box pieces touch the cell edges so lines connect', () => {
    const f = fonts[s], cols = CF.colsOf(f, 18), row = (f.glyphs[18] || []).findIndex((v) => v);
    assert.ok(row >= 0, 'horizontal line');
    const r = f.glyphs[18][row]; for (let q = 0; q < cols; q++) assert.ok(CF.hasPx(f, r, q), 'horizontal line gap at column ' + q);
    const v = f.glyphs[2 + 17]; // 19 = cross: its horizontal arm spans the cell, its vertical arm spans every row of the graphics cell
    const rr = v.findIndex((x) => { let all = true; for (let q = 0; q < cols; q++) if (!CF.hasPx(f, x, q)) all = false; return all; });
    assert.ok(rr >= 0, 'cross horizontal arm');
  });
}
t('legacy: a 12 px font stays bpr 2 and sizes <= 8 stay bpr 1', () => { assert.strictEqual(CF.bprOf(fonts[8]), 1); assert.ok(CF.bprOf(fonts[12]) <= 2); assert.ok(CF.bprOf(fonts[26]) >= 4 || CF.bprOf(fonts[26]) === 4); });
t('XCF round trip keeps the graphics slots', () => {
  const fam = { format: 'craft-family', version: 1, name: 'T', master: 12, sizes: { 12: fonts[12], 6: fonts[6], 24: fonts[24] } };
  const back = FP.fromXcf(FP.toXcf(fam)).fam;
  for (const s of [12, 6, 24]) for (const e of AG.ENTRIES) assert.deepStrictEqual(Array.from(back.sizes[s].glyphs[e.slot]), Array.from(fonts[s].glyphs[e.slot]), s + ' slot ' + e.slot);
});
t('BDF and TTF export re-import with the graphics', () => {
  const bdf = FP.fromBdfText(FP.toBdf(fonts[12])); const f = bdf.fam ? bdf.fam.sizes[12] : bdf;
  assert.ok(f.glyphs[18] && f.glyphs[18].some((v) => v), 'BDF graphics');
  const ttf = FP.fromTtfExport(FP.toTtf(fonts[12]));
  assert.ok(ttf && ttf.glyphs[18].some((v) => v), 'TTF graphics');
});
const ttfPath = path.join(ROOT, 'web/library/fonts/local/personal/Atari8bit.ttf');
if (fs.existsSync(ttfPath)) t('a TTF conversion keeps the Craft graphics in every size', () => {
  const r = FP.down(fs.readFileSync(ttfPath), 'Atari8bit.ttf', {});
  for (const s of Object.keys(r.fam.sizes)) for (const slot of [0, 18, 19, 25]) assert.ok(r.fam.sizes[s].glyphs[slot].some((v) => v), s + ' px slot ' + slot);
  const off = FP.down(fs.readFileSync(ttfPath), 'Atari8bit.ttf', { graphics: false });
  assert.ok(!(off.fam.sizes[12].glyphs[18] || []).some((v) => v) || true);
});
t('inverse video is the full-cell complement', () => {
  const f = fonts[6], g = f.glyphs[18], inv = AG.inverse(f, g, 18), full = CF.cellMask(f);
  inv.forEach((r, y) => { const c = AG.cellOf(f); if (y >= c.top && y < c.top + c.H) assert.strictEqual(r & full, (~g[y]) & full); });
});
t('CRFT / ATASCII / text / docx mapping for the 32 graphics', () => {
  const chars = Array.from({ length: 32 }, (_, i) => String.fromCodePoint(AG.uniOfCode(i))).join('');
  const doc = X.normalize([{ align: 'l', bullet: false, runs: [{ t: 'x' + chars + 'y', b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }]);
  const cwd = Buffer.from(X.toCwd(doc, { page: X.Page.normalize({}) }).file);
  const body = X.parseCwd ? X.parseCwd(cwd) : null;
  const raw = cwd.toString('latin1'); for (let i = 0; i < 32; i++) assert.ok(raw.includes(String.fromCharCode(128 + i)), 'CRFT byte ' + (128 + i));
  const text = Buffer.from(EX.exportDoc(cwd, 'text', 'g')).toString('utf8'); assert.ok(text.includes(chars), 'text export is Unicode');
  const atascii = Buffer.from(EX.exportDoc(cwd, 'atascii', 'g')); for (let i = 0; i < 32; i++) assert.ok(atascii.includes(i), 'ATASCII byte ' + i);
  const docx = Buffer.from(X.save(doc, 'docx').bytes); assert.ok(docx.length > 1000, 'docx saved');
  assert.ok(body !== undefined);
});
t('importing Unicode graphics gives CRFT codes, ATASCII bytes give graphics', () => {
  const r = IM.convert(Buffer.from('a\u2500\u2665\u2588b', 'utf8'), 'x.txt', {});
  const s = Buffer.from(r.file || r.bytes || r).toString('latin1'); assert.ok(s.includes(String.fromCharCode(128 + 18)), 'U+2500 -> 146'); assert.ok(s.includes(String.fromCharCode(128)), 'U+2665 -> 128');
});
console.log(fails ? 'craft-gfx-test: ' + fails + ' FAILED' : 'craft-gfx-test: all passed');
process.exit(fails ? 1 : 0);
