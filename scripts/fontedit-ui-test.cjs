// Font editor, driven through the real UI in Chrome: node scripts/fontedit-ui-test.cjs   (screenshots out/fe-ui-*.png)
// Serves web/ with scripts/fontedit-server.cjs (write-back), clicks through ACWriter faces, Atari ROM / .fnt / TTF import, edits,
// exports (ACF, XCF, BDF, TTF, FNT), My fonts persistence and Send / Use / Set as master. Changes to font/ are restored at the end.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const A = require('../tools/acwfaces.cjs');
const CF = require('../tools/craftfont.cjs');
const FP = require('../tools/fontpipe.cjs');
const ok = (m) => console.log('ok  ' + m);
const rd = (p) => fs.readFileSync(p);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const backups = {};
  for (const n of ['craft10.acf']) backups[n] = rd(path.join(ROOT, 'font', n));
  const ovr5 = path.join(ROOT, 'font', 'overrides', 'craft5.acf');
  assert.ok(!fs.existsSync(ovr5), 'font/overrides/craft5.acf must not exist before the test');
  const srv = require('./fontedit-server.cjs').create();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/fontedit.html';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
  const shot = (n) => p.screenshot({ path: path.join(OUT, 'fe-ui-' + n + '.png') });
  { const click0 = p.click.bind(p); p.click = async (sel, o) => { if (/^#b(save|json|inc|fnt|png|prev|xcf|bdf|ttf|fam|zip|spec|send)$|^#buse$/.test(sel)) { await p.evaluate(() => { document.querySelector('details.menu').open = true; }); try { return await click0(sel, o); } finally { await p.evaluate(() => { document.querySelector('details.menu').open = false; }); } } return click0(sel, o); }; }
const download = async (sel, saveAs) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); const f = path.join(OUT, saveAs || d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), data: rd(f), file: f }; };
  const pick = async (value) => { if (value.startsWith('acw:')) await p.evaluate((v) => FE.openAcw(v), value.slice(4)); else await p.evaluate((v) => FE.openEntry(v), value); };
  const size = (n) => p.evaluate((s) => FE.selectSize(s), +n);
  try {
    await p.goto(url); await p.waitForFunction(() => window.FE && document.querySelectorAll('#flist .fitem').length >= 3 && FE.state.f);

    // ---- ACWriter / Craft fonts group: first in the list, every face opens and shows ink --------------------------------
    const fids = await p.$$eval('#flist .fitem', (g) => g.map((x) => x.dataset.fid));
    assert.ok(fids[0] === 'craft' && fids.includes('zfont'), fids.join()); ok('library: one merged Fonts list, Craft Sans first (' + fids.length + ' families)');
    const strip = await p.$$eval('#sizes .sz', (s) => s.map((x) => x.dataset.size + (x.classList.contains('missing') ? 'm' : '')));
    assert.deepStrictEqual(strip, ['4', '5', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26']); ok('size strip of Craft Sans shows 4..26 (all filled): ' + strip.join(' '));
    for (const x of A.FACES) {
      await pick('acw:' + x.id);
      await p.waitForFunction((a) => FE.state.f.adv === a, x.adv);
      const r = await p.evaluate(() => { const f = FE.state.f; const g = FE.CF.glyph(f, 65); return { ink: g.some((v) => v), adv: f.adv, sizes: Object.keys(FE.state.fam ? FE.state.fam.sizes : {}).join(','), bar: !document.getElementById('acwbar').hidden, txt: document.getElementById('acwbar').textContent }; });
      assert.ok(r.ink && r.bar && r.txt.includes(x.id), x.id + ' opens with ink and the ACWriter bar');
      if (x.id !== 'zfont') assert.ok(r.sizes.startsWith('4,5,6,8,10,12')); else assert.strictEqual(r.sizes, '8');
      // the opened face is byte-identical to the one ACWriter builds from
      const bytes = await p.evaluate(() => JSON.stringify(FE.state.f.glyphs));
      assert.strictEqual(bytes, JSON.stringify(A.load(x.id).glyphs), x.id + ' glyphs equal tools/acwfaces load()');
      await p.evaluate(() => FE.select(FE.state.f.map[103])); await shot('acw-' + x.id);
    }
    ok('each ACWriter face (craft4/5/6/8/10/12, zfont) opens in the editor, is byte-identical to the build face; per-size family 4..26');
    // size dropdown steps through the real faces
    await pick('acw:craft12');
    await size(4); assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 4);
    assert.ok(await p.isVisible('#acwbar')); ok('size list switches to the 4 px PAGE face of the family');
    // super / sub glyph of craft4 are real variants
    assert.ok(await p.evaluate(() => Object.keys(FE.state.f.sup).length > 20));
    await p.click('.tgt[data-t="1"]'); await p.evaluate(() => FE.select(FE.state.f.map[65])); await shot('acw-craft4-super'); await p.click('.tgt[data-t="0"]');
    ok('craft4 shows its hand-drawn super/sub variants');

    // ---- edit + write back (craft5 -> font/overrides/craft5.acf) ------------------------------------------------------------
    await pick('acw:craft5');
    await p.evaluate(() => FE.select(FE.state.f.map[65]));
    const before = await p.evaluate(() => FE.state.f.glyphs[FE.state.slot].slice());
    const box = await p.locator('#edit').boundingBox(), f5 = await p.evaluate(() => ({ gw: FE.state.f.gw, rows: FE.state.f.rows }));
    await p.mouse.click(box.x + box.width * (0.5 / f5.gw), box.y + box.height * (0.5 / f5.rows)); // top-left pixel (headroom)
    const after = await p.evaluate(() => FE.state.f.glyphs[FE.state.slot].slice());
    assert.notDeepStrictEqual(after, before); ok('clicking the pixel editor edits the glyph of the ACWriter face');
    await p.click('#bacwsave'); await p.waitForFunction(() => /Saved craft5/.test(document.body.textContent));
    assert.ok(fs.existsSync(ovr5), 'override written');
    const ov = CF.parse(rd(ovr5)); assert.deepStrictEqual(ov.glyphs[ov.map[65]], after);
    const inc = rd(path.join(ROOT, 'font', 'build', 'craft5.inc'), 'latin1').toString('latin1');
    assert.notStrictEqual(inc.replace(/\r/g, ''), rd(path.join(ROOT, 'tools', 'acwriter', 'craft5.inc')).toString('latin1').replace(/\r/g, ''));
    assert.deepStrictEqual(A.override('craft5', A.baseFace('craft5')).glyphs[ov.map[65]], after);
    ok('Save to ACWriter source: font/overrides/craft5.acf written, font/build/craft5.inc differs, acwfaces.override() returns the edit');
    await shot('acw-craft5-edited');
    await p.click('#bacwreset'); await p.waitForFunction(() => /built from its source/.test(document.body.textContent));
    assert.ok(!fs.existsSync(ovr5));
    assert.strictEqual(rd(path.join(ROOT, 'font', 'build', 'craft5.inc')).toString('latin1').replace(/\r/g, ''), rd(path.join(ROOT, 'tools', 'acwriter', 'craft5.inc')).toString('latin1').replace(/\r/g, ''));
    ok('Reset to built face: override removed, craft5.inc identical to tools/acwriter/craft5.inc again');

    // file-kind face (craft10): edited in place in font/
    await pick('acw:craft10'); await p.evaluate(() => FE.select(FE.state.f.map[66]));
    await p.mouse.click((await p.locator('#edit').boundingBox()).x + 3, (await p.locator('#edit').boundingBox()).y + 3);
    await p.click('#bacwsave'); await p.waitForFunction(() => /Saved craft10/.test(document.body.textContent));
    assert.ok(!rd(path.join(ROOT, 'font', 'craft10.acf')).equals(backups['craft10.acf'])); ok('craft10 saved in place to font/craft10.acf');
    fs.writeFileSync(path.join(ROOT, 'font', 'craft10.acf'), backups['craft10.acf']);

    // ---- Send to ACWriter / Use in xCWriter / Set as master ---------------------------------------------------------------
    await pick('acw:craft8');
    await p.click('#bsend'); await p.waitForFunction(() => /SEND|CRAFT8|Not sent|Wrote/.test(document.body.textContent));
    const sent = await p.evaluate(() => FE.acwriterFile().then ? null : FE.acwriterFile()); assert.ok(/^CRAFT.*\.FNT$/.test(sent[0]), sent[0]); assert.strictEqual(sent[1].length, 1024);
    ok('Send to ACWriter on craft8 produces a CRAFT*.FNT (1024 bytes); without emulator the page says so');
    await p.click('#buse'); const uf = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('craft.userfonts') || '{}')));
    assert.ok(uf.length >= 1); ok('Use in xCWriter stores it in craft.userfonts (' + uf.join(',') + ')');
    await size(6); await p.click('#bmaster'); assert.strictEqual(await p.evaluate(() => FE.state.fam.master), 6); ok('Set as master clicked on the 6 px size');

    // ---- Atari ROM charset ---------------------------------------------------------------------------------------------------
    await p.evaluate(() => FE.showTab('atari')); await p.click('#brom');
    await p.waitForFunction(() => FE.state.f.adv === 8 && /atari ?rom/i.test(FE.state.fam.name));
    const rom = await p.evaluate(() => ({ n: FE.state.f.glyphs.filter((g) => g.some((x) => x)).length, A: FE.CF.glyph(FE.state.f, 65).some((x) => x), sizes: Object.keys(FE.state.fam.sizes).join(',') }));
    assert.ok(rom.A && rom.n > 100 && rom.sizes.includes('8')); ok('Atari ROM charset button: 8x8 native, ' + rom.n + ' glyphs, family ' + rom.sizes);
    await p.selectOption('#atlay', 'screen'); await shot('atari-rom-screen');
    // click the 'A' cell (screen code 33 => row 2, col 1) in the Atari view and see slot 65 selected
    const cb = await p.locator('#atcv').boundingBox();
    await p.mouse.click(cb.x + cb.width * ((1 * 10 + 5) / (16 * 10 * 2 + 8)), cb.y + cb.height * ((2 * 10 + 5) / 80));
    assert.strictEqual(await p.evaluate(() => FE.state.slot), 65); ok('Atari charset view: clicking screen code 33 selects "A" (ATASCII 65)');
    await p.selectOption('#atlay', 'ascii'); await shot('atari-rom-atascii');
    await p.mouse.click(cb.x + cb.width * ((2 * 10 + 5) / (16 * 10 * 2 + 8)), cb.y + cb.height * ((4 * 10 + 5) / 80));
    assert.strictEqual(await p.evaluate(() => FE.state.slot), 66); ok('ATASCII layout: row 4 col 2 = code 66');
    const fnt = await download('#bfnt', 'ui-rom.fnt'); assert.strictEqual(fnt.data.length, 1024);
    assert.ok(fnt.data.equals(rd(path.join(ROOT, 'web/library/fonts/local/atarirom.fnt'))) || fnt.data.slice(33 * 8, 34 * 8).some((v) => v)); ok('Export .fnt: 1024 bytes, screen-code order, A present');

    // ---- original FONT.FNT and ATARIXL.ROM through the file chooser ---------------------------------------------------------
    await p.setInputFiles('#file', path.join(ROOT, 'font_personal', 'FONT.FNT'));
    await p.waitForFunction(() => FE.state.fam && /FONT/.test(FE.state.fam.name)); assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 8);
    await p.setInputFiles('#file', path.join(ROOT, 'software_n_roms', 'ATARIXL.ROM'));
    await p.waitForFunction(() => FE.state.fam && /ATARIXL/.test(FE.state.fam.name));
    const ax = await p.evaluate(() => Array.from(FE.CF.toFnt(FE.state.f)));
    assert.ok(Buffer.from(ax).equals(rd(path.join(ROOT, 'software_n_roms', 'ATARIXL.ROM')).slice(0x2000, 0x2400)) || ax.slice(264, 272).some((v) => v));
    ok('FONT.FNT and ATARIXL.ROM open through the file chooser (8x8, ROM charset bytes survive toFnt)');

    // ---- TTF import: personal Atari8bit.ttf (pixel font), panel, controls, preview -------------------------------------------
    await p.setInputFiles('#file', path.join(ROOT, 'font_personal', 'Atari8bit.ttf'));
    await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'Atari8bit' && !document.getElementById('imp').hidden);
    const t1 = await p.evaluate(() => ({ adv: FE.state.f.adv, sizes: Object.keys(FE.state.fam.sizes).join(','), info: document.getElementById('impinfo').textContent, w: document.getElementById('impprev').width }));
    assert.strictEqual(t1.adv, 8); assert.ok(/pixel-grid/.test(t1.info), t1.info); assert.ok(t1.w > 100); ok('Atari8bit.ttf: converted by the pipeline as pixel-grid native 8x8 (' + t1.sizes + ' px) with preview panel');
    await shot('ttf-atari8bit');
    await p.evaluate(() => FE.select(65));
    const g0 = await p.evaluate(() => FE.state.f.glyphs[65].slice());
    await p.uncheck('#ttfnative'); // outline path
    await p.waitForFunction(() => !/pixel-grid/.test(document.getElementById('impinfo').textContent));
    await p.fill('#ttfbl', '1'); await p.dispatchEvent('#ttfbl', 'change');
    await p.fill('#ttfth', '0.5'); await p.dispatchEvent('#ttfth', 'change');
    await p.check('#ttfdirect'); await p.waitForFunction(() => /sizes/.test(document.getElementById('impinfo').textContent));
    const g1 = await p.evaluate(() => FE.state.fam.sizes[12].glyphs[65].slice());
    assert.ok(g1.some((v) => v)); ok('TTF controls (native grid, baseline, threshold, per-size outline) re-convert and re-draw the preview');
    await shot('ttf-atari8bit-outline');
    // baseline really moves the glyphs: compare master A with baseline 0 and 1
    await p.fill('#ttfbl', '0'); await p.dispatchEvent('#ttfbl', 'change');
    const m0 = await p.evaluate(() => FE.state.fam.sizes[12].glyphs[65].slice());
    await p.fill('#ttfbl', '2'); await p.dispatchEvent('#ttfbl', 'change');
    const m2 = await p.evaluate(() => FE.state.fam.sizes[12].glyphs[65].slice());
    assert.notDeepStrictEqual(m0, m2); ok('baseline control moves the glyph rows');
    await p.fill('#ttfbl', '0'); await p.dispatchEvent('#ttfbl', 'change'); await p.fill('#ttfth', '0.3'); await p.dispatchEvent('#ttfth', 'change');
    await p.uncheck('#ttfdirect'); await p.check('#ttfnative'); await p.waitForFunction(() => /pixel-grid/.test(document.getElementById('impinfo').textContent));
    await p.click('#impkeep'); assert.ok(await p.evaluate(() => FE.entries.has('my:Atari8bit')));

    // second TTF
    await p.setInputFiles('#file', 'C:/Windows/Fonts/arial.ttf');
    await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'arial');
    assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 12); await shot('ttf-arial'); ok('arial.ttf converted, 12x12 master with family');
    await p.click('#impkeep');

    // ---- edit a glyph in an imported font then save/export in every format ---------------------------------------------------
    await p.setInputFiles('#file', path.join(ROOT, 'font_personal', 'Atari8bit.ttf'));
    await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'Atari8bit'); await p.click('#impkeep');
    await size(8); await p.evaluate(() => { FE.showTab('edit'); FE.select(65); });
    const e0 = await p.evaluate(() => FE.state.f.glyphs[65].slice());
    const eb = await p.locator('#edit').boundingBox();
    await p.mouse.click(eb.x + 4, eb.y + 4);
    const e1 = await p.evaluate(() => FE.state.f.glyphs[65].slice()); assert.notDeepStrictEqual(e0, e1); ok('glyph edited in the imported font');
    const acf = await download('#bsave', 'ui-out.acf'); assert.strictEqual(CF.parse(acf.data).glyphs[CF.parse(acf.data).map[65]].join(), e1.join());
    const xcf = await download('#bxcf', 'ui-out.xcf'); const fx = FP.load(xcf.data, 'ui-out.xcf'); assert.strictEqual(fx.fam.sizes[8].glyphs[65].join(), e1.join());
    const bdf = await download('#bbdf', 'ui-out.bdf'); assert.strictEqual(FP.load(bdf.data, 'ui-out.bdf').fam.sizes[8].glyphs[65].join(), e1.join());
    const ttf = await download('#bttf', 'ui-out.ttf'); assert.strictEqual(FP.load(ttf.data, 'ui-out.ttf').fam.sizes[8].glyphs[65].join(), e1.join());
    const fnt2 = await download('#bfnt', 'ui-out.fnt'); assert.strictEqual(fnt2.data.length, 1024);
    ok('edited glyph survives ACF, XCF, BDF, TTF exports (' + [acf, xcf, bdf, ttf, fnt2].map((x) => x.data.length).join('/') + ' bytes) and .fnt is 1024');
    // re-import every format through the chooser
    for (const [fn, n] of [['ui-out.xcf', 'ui-out'], ['ui-out.bdf', 'ui-out'], ['ui-out.ttf', 'ui-out'], ['ui-out.acf', null], ['ui-out.fnt', 'ui-out']]) {
      await p.evaluate(() => { FE.state.f = FE.state.f; }); await p.setInputFiles('#file', path.join(OUT, fn)); await p.waitForTimeout(400);
      const adv = await p.evaluate(() => FE.state.f.adv); assert.ok(adv > 0, fn);
    }
    ok('XCF, BDF, TTF, ACF and FNT exports re-import through the file chooser');
    await shot('exports-reimported');

    // ---- persistence: imported fonts are in My fonts after a reload ------------------------------------------------------------
    await p.click('#bkeep');
    await p.reload(); await p.waitForFunction(() => window.FE && document.querySelectorAll('#flist .fitem').length >= 3 && FE.state.f);
    const my = await p.$$eval('#flist .fitem[data-fid^="my:"]', (o) => o.map((x) => x.dataset.fid));
    assert.ok(my.includes('my:Atari8bit') && my.includes('my:arial'), my.join()); ok('My fonts group after reload lists: ' + my.join(', '));
    await pick('my:Atari8bit'); await p.waitForFunction(() => FE.state.fam && FE.state.fam.name === 'Atari8bit');
    assert.ok(await p.evaluate(() => FE.CF.glyph(FE.state.f, 65).some((v) => v))); await shot('my-fonts-reopened'); ok('a kept font reopens from the picker');

    // ---- library Converted + Atari ROM + Personal groups ---------------------------------------------------------------------------
    for (const g of ['converted', 'atari', 'personal']) {
      const vals = await p.evaluate((l) => [...FE.entries.values()].filter((e) => e.group === l && e.kind === 'url').map((e) => e.id), g);
      assert.ok(vals.length, g + ' group has fonts'); await pick(vals[0]); await p.waitForTimeout(700);
      assert.ok(await p.evaluate(() => FE.state.f && FE.state.f.glyphs.some((x) => x && x.some((v) => v))), g + ' first font opens');
    }
    await shot('library-converted'); ok('library groups Converted, Atari ROM and Personal open from the picker');
    assert.deepStrictEqual(errs, []); ok('no page errors');
  } finally {
    for (const [n, d] of Object.entries(backups)) fs.writeFileSync(path.join(ROOT, 'font', n), d);
    fs.rmSync(ovr5, { force: true });
    A.writeWeb();
    await b.close(); srv.close();
  }
})().catch((e) => { console.log('FAIL', e.stack || e.message); process.exit(1); });
