// Playwright test for web/fontedit.html: node scripts/fontedit-test.cjs  (screenshots out/fe-*.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ok = (m) => console.log('ok  ' + m);

(async () => {
  fs.mkdirSync(ROOT + '/out', { recursive: true });
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept('0'));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
  await p.waitForFunction(() => window.FE);
  ok('loads the built-in Craft 6 px font: ' + (await p.textContent('#info')).trim());

  // select 'g' slot and paint
  await p.evaluate(() => FE.select(103));
  assert.ok((await p.textContent('#gname')).includes('"g"'));
  const before = await p.evaluate(() => FE.state.f.glyphs[103].slice());
  const box = await p.locator('#edit').boundingBox();
  await p.mouse.click(box.x + 4, box.y + 4); // column 0, row 0 (headroom)
  const after = await p.evaluate(() => FE.state.f.glyphs[103].slice());
  assert.notDeepStrictEqual(after, before); assert.strictEqual(after[0], 0x80);
  await p.click('#undo');
  assert.deepStrictEqual(await p.evaluate(() => FE.state.f.glyphs[103].slice()), before);
  ok('click paints a pixel in the headroom row, undo restores it');
  await p.screenshot({ path: ROOT + '/out/fe-1-main.png' });

  // case locations
  await p.fill('#upslot', '160'); await p.click('#upgo');
  await p.fill('#lowslot', '192'); await p.click('#lowgo');
  const m = await p.evaluate(() => [FE.state.f.map[65], FE.state.f.map[122], FE.state.f.glyphs[160].some((x) => x)]);
  assert.deepStrictEqual(m, [160, 217, true]);
  ok('upper-case placed at slot 160, lower-case at slot 192 (map 65->160, 122->217)');

  // sup/sub offsets + variants
  await p.fill('#supup', '2'); await p.press('#supup', 'Tab'); await p.fill('#subdn', '3'); await p.press('#subdn', 'Tab');
  await p.click('.tgt[data-t="1"]');
  const box2 = await p.locator('#edit').boundingBox();
  await p.mouse.click(box2.x + 4, box2.y + 4);
  assert.ok(await p.evaluate(() => Object.keys(FE.state.f.sup).length === 1));
  ok('super variant created on first edit');
  await p.click('.tgt[data-t="0"]');
  await p.check('#pvg'); await p.selectOption('#pvz', '3');
  await p.screenshot({ path: ROOT + '/out/fe-2-case.png' });

  // save -> reopen round trip
  const b64 = await p.evaluate(() => Buffer.from(FE.exportAcf()).toString('base64'));
  const CF = require('../tools/craftfont.cjs');
  const f = CF.parse(Buffer.from(b64, 'base64'));
  assert.strictEqual(f.map[65], 160); assert.strictEqual(f.supUp, 2); assert.ok(f.sup[103] || Object.keys(f.sup).length === 1);
  assert.ok(f.first <= 32 && f.first + f.count > 217);
  ok('saved ACF2 parses in Node with map, offsets and variants (' + b64.length * 3 / 4 + ' bytes)');
  const inc = await p.evaluate(() => FE.CF.toInc(FE.state.f, 'cf'));
  assert.ok(/cf_11:/.test(inc));
  ok('.inc export has 12 planes');

  // legacy ACF1 and TTF
  const a1 = Buffer.concat([Buffer.from('ACF1'), Buffer.from([2, 5, 8, 1]), Buffer.alloc(96 * 8, 0x80), Buffer.from([8, 12, 1]), Buffer.alloc(96 * 12, 0x40)]);
  await p.evaluate((x) => FE.openBytes(Uint8Array.from(atob(x), (c) => c.charCodeAt(0)), 'OLD.acf'), a1.toString('base64'));
  assert.strictEqual(await p.evaluate(() => FE.state.f.rows), 8);
  ok('legacy ACF1 (2 sizes) opens, size 0 chosen');
  await p.selectOption('#ttfadv', '6');
  await p.setInputFiles('#file', 'C:/Windows/Fonts/arial.ttf');
  await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'arial', null, { timeout: 20000 });
  assert.deepStrictEqual(await p.evaluate(() => [FE.state.f.rows, FE.state.f.adv]), [12, 6]);

  // TTF -> 12x12 master -> derived 8x8 and 4 px; locked / hand-edited sizes survive a re-derive
  await p.selectOption('#ttfadv', '12');
  await p.setInputFiles('#file', 'C:/Windows/Fonts/ariblk.ttf');
  await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'ariblk', null, { timeout: 20000 });
  await p.click('#bderive');
  const fam = await p.evaluate(() => {
    const out = {};
    for (const [k, f] of Object.entries(FE.state.fam.sizes)) {
      let n = 0, empty = 0;
      for (let c = 33; c < 127; c++) { const g = f.glyphs[c]; if (g) { n++; if (!g.some((v) => v)) { empty++; (out.list = out.list || []).push(k + ':' + c); } } }
      out[k] = { n, empty, origin: f.origin, gw: f.gw };
    }
    return out;
  });
  assert.ok(!fam.list, 'empty glyphs ' + fam.list);
  for (const k of ['12', '10', '8', '6', '5', '4']) { assert.ok(fam[k], 'size ' + k); assert.strictEqual(fam[k].n, 94, 'glyphs ' + k); assert.strictEqual(fam[k].empty, 0, 'empty ' + k + ' ' + JSON.stringify(fam[k])); }
  assert.strictEqual(fam[12].origin, 0); assert.strictEqual(fam[8].origin, 1);
  await p.screenshot({ path: ROOT + '/out/fe-4-family.png' });
  await p.evaluate(() => { const f = FE.state.fam.sizes[8]; f.glyphs[65][3] ^= 0x10; FE.state.fam.sizes[8].origin = 2; FE.state.fam.sizes[4].locked = true; });
  const kept = await p.evaluate(() => { const b = FE.state.fam.sizes[8].glyphs[65].join(), c = FE.state.fam.sizes[4]; FE.state.fam.sizes[12].glyphs[66][5] ^= 1; document.getElementById('bderive').click(); return [b === FE.state.fam.sizes[8].glyphs[65].join(), c === FE.state.fam.sizes[4]]; });
  assert.deepStrictEqual(kept, [true, true]);
  ok('TTF -> 12x12 master -> derived 10/8/6/5/4 px: 94 glyphs each, none empty; hand-edited and locked sizes survive re-derive');
  await p.selectOption('#ttfadv', '6');
  await p.setInputFiles('#file', 'C:/Windows/Fonts/arial.ttf');
  await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'arial', null, { timeout: 20000 });
  await p.evaluate(() => FE.select(72));
  await p.fill('#sample', 'Hamburgefonstiv gypsy quick fox\nSuper^{2} and sub_{2} (jpqy)');
  await p.screenshot({ path: ROOT + '/out/fe-3-ttf.png' });
  ok('TTF (arial) converted in the browser to the 12-row Craft cell');

  // 4 px built-in for 17 cpi
  await p.selectOption('#builtin', 'craft4');
  await p.fill('#sample', 'The quick brown fox jumps over the lazy dog. mmm www MW\nHamburgefonstiv 0123456789 (gypsy) @#%&');
  await p.selectOption('#pvz', '4');
  await p.screenshot({ path: ROOT + '/out/fe-4-craft4.png' });
  assert.deepStrictEqual(errs, []);
  ok('no page errors');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
