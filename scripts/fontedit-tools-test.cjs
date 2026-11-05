// Font editor tools and converters: node scripts/fontedit-tools-test.cjs  (screenshot out/fe-tools.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CF = require('../tools/craftfont.cjs');
const ok = (m) => console.log('ok  ' + m);

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.concat([Buffer.from(type), data]), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(data.length); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]);
}
function png(sheet) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(sheet.w, 0); ihdr.writeUInt32BE(sheet.h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((sheet.w + 1) * sheet.h);
  for (let y = 0; y < sheet.h; y++) for (let x = 0; x < sheet.w; x++) raw[y * (sheet.w + 1) + 1 + x] = sheet.data[y * sheet.w + x] ? 0 : 255;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const same = (a, b) => a.glyphs.every((g, i) => JSON.stringify(g) === JSON.stringify(b.glyphs[i]));

// ---- core round trips -------------------------------------------------------------------------------------------------
const m12 = CF.createSize(12, { name: 'T12' });
for (let s = 33; s < 127; s++) { m12.glyphs[s][4 + (s % 5)] = CF.bitMask(m12, s % 10); m12.glyphs[s][8] |= CF.bitMask(m12, 0); }
const sh = CF.toSheet(m12);
assert.ok(same(CF.fromSheet(sh.data, sh.w, sh.h, { name: 'T12' }), m12)); ok('12x12 glyphs survive the sheet round trip (' + sh.w + 'x' + sh.h + ')');

const f8 = CF.fromFnt(Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 255)));
assert.deepStrictEqual(CF.toFnt(f8), Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 255)).slice(0, 1024).map((v, i) => v)); ok('.fnt import then export is byte-identical (1024 bytes)');

const bdf = 'STARTFONT 2.1\nFONT x\nFONTBOUNDINGBOX 8 8 0 0\nCHARS 2\nSTARTCHAR A\nENCODING 65\nBBX 8 8 0 0\nBITMAP\n18\n3C\n66\n66\n7E\n66\n66\n00\nENDCHAR\nSTARTCHAR dot\nENCODING 46\nBBX 2 2 1 0\nBITMAP\nC0\nC0\nENDCHAR\nENDFONT\n';
const fb = CF.fromBdf(bdf, { name: 'bdf' });
assert.strictEqual(fb.adv, 8); assert.strictEqual(fb.glyphs[65][fb.base - 7], 0x18); assert.strictEqual(fb.glyphs[65][fb.base], 0);
assert.strictEqual(fb.glyphs[46][fb.base], 0x60); assert.strictEqual(fb.glyphs[46][fb.base - 1], 0x60); ok('BDF imports onto the baseline (A rows, dot offset)');
const tall = CF.fromBdf(bdf, { size: 12 }); assert.strictEqual(tall.adv, 12); ok('BDF can target 12x12');

const mut = CF.flipV(m12, m12.glyphs[65]); assert.deepStrictEqual(CF.flipV(m12, mut), m12.glyphs[65]);
const rg = m12.glyphs[70].slice(); let r = rg; for (let i = 0; i < 4; i++) r = CF.rotate(m12, r);
assert.deepStrictEqual(r, rg); ok('flip twice and rotate four times are identities');

const dfam = CF.familyNew(m12, 'T12'); const rr = CF.familyDerive(dfam, [10, 8, 6, 5, 4], {});
assert.ok(Object.keys(dfam.sizes).length === 6);
for (const k of Object.keys(dfam.sizes)) { const g = dfam.sizes[k]; assert.ok([...Array(94)].every((_, i) => g.glyphs[33 + i].some((b) => b)), 'empty glyph in size ' + k); }
ok('derived 10/8/6/5/4 px sizes have no empty glyphs (' + rr.done.join(',') + ')');

// ---- browser ------------------------------------------------------------------------------------------------------------
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1380, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept('0'));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
  await p.waitForFunction(() => window.FE);
  await p.click('#bnew');
  assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 12); ok('New makes a blank 12x12 master');
  await p.evaluate(() => FE.select(65));
  const box = await p.locator('#edit').boundingBox();
  const cw = box.width / 10, ch = box.height / 12, at = (q, y) => [box.x + (q + 0.5) * cw, box.y + (y + 0.5) * ch];
  const rows = () => p.evaluate(() => FE.state.f.glyphs[65].slice());
  const px = (g, q, y) => !!(g[y] & (0x8000 >> q));
  // line
  await p.click('.tool[data-tool="line"]');
  let [x0, y0] = at(1, 2), [x1, y1] = at(6, 2);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1); await p.mouse.up();
  let g = await rows(); assert.ok([1, 2, 3, 4, 5, 6].every((q) => px(g, q, 2))); ok('line tool draws a horizontal run');
  // rect (outline)
  await p.click('.tool[data-tool="rect"]');
  [x0, y0] = at(1, 3); [x1, y1] = at(6, 8);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1); await p.mouse.up();
  g = await rows(); assert.ok(px(g, 1, 5) && px(g, 6, 5) && !px(g, 3, 5) && px(g, 3, 8)); ok('rect tool draws an outline (interior stays empty)');
  // fill the interior
  await p.click('.tool[data-tool="fill"]');
  const [fx, fy] = at(3, 5); await p.mouse.click(fx, fy);
  g = await rows(); assert.ok(px(g, 3, 5) && px(g, 5, 7) && !px(g, 8, 5)); ok('fill floods the enclosed interior only');
  // erase with right button (pencil)
  await p.click('.tool[data-tool="pen"]');
  const [ex, ey] = at(3, 5); await p.mouse.click(ex, ey, { button: 'right' });
  g = await rows(); assert.ok(!px(g, 3, 5)); ok('pencil right button erases');
  // undo/redo chain
  const n0 = (await rows()).join();
  await p.click('#undo'); const n1 = (await rows()).join(); assert.notStrictEqual(n0, n1);
  await p.click('#redo'); assert.strictEqual((await rows()).join(), n0); ok('undo then redo restores the erase');
  await p.click('#flipv'); const fl = await rows(); await p.click('#flipv');
  assert.deepStrictEqual(await rows(), g); assert.ok(fl.join() !== g.join()); ok('Flip V and back');
  // derive and PNG import/export through the page
  const sheetPng = png(CF.toSheet(m12)).toString('base64');
  const imp = await p.evaluate(async (b64) => { await FE.openBytes(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), 'T12.sheet.png'); return [FE.state.f.adv, FE.state.f.glyphs[70].some((x) => x)]; }, sheetPng);
  assert.deepStrictEqual(imp, [12, true]); ok('PNG sheet imported in the browser as 12x12');
  const bd = await p.evaluate(async (t) => { await FE.openBytes(new TextEncoder().encode(t), 'x.bdf'); return [FE.state.f.adv, FE.state.f.glyphs[65][FE.state.f.base - 7]]; }, bdf);
  assert.deepStrictEqual(bd, [8, 0x18]); ok('BDF imported in the browser');
  await p.evaluate(() => FE.openBytes(new Uint8Array(1024).map((_, i) => i * 7 & 255), 'a.fnt'));
  const fnt = await p.evaluate(() => Array.from(FE.CF.toFnt(FE.state.f)).join());
  assert.strictEqual(fnt, Array.from(new Uint8Array(1024).map((_, i) => i * 7 & 255)).join()); ok('.fnt open then export in the browser is identical');
  // converter screenshot: a 12x12 font with the derive row visible
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.screenshot({ path: ROOT + '/out/fe-tools.png' });
  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
