// Phase-5 UI test: every retro/bitmap format is imported through #file in Chrome from file:// and exported from the Export menu;
// exported bytes are read back in Node and compared with the editor's font. Screenshots: out/ui5-*.png.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const CF = require('../tools/craftfont.cjs'), FF = require('../tools/fontformats.cjs'), FP = require('../tools/fontpipe.cjs'), SF = require('../tools/sfnt.cjs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out', 'fmt'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
(async () => {
  const m12 = CF.parse(fs.readFileSync(path.join(ROOT, 'font/craft12.acf'))), f8 = CF.derive(m12, 8, {});
  const A = (f) => JSON.stringify(Array.from(f.glyphs[f.map ? f.map[65] : 65]));
  const files = {
    'imp-atari.fnt': FF.writeAtari(f8, {}), 'imp-atascii.fnt': FF.writeAtari(f8, { order: 'atascii' }), 'imp-c64.64c': FF.write('c64', f8, { header: true }).bytes, 'imp-zx.zx': FF.write('zx', f8, {}).bytes,
    'imp-msx.msx': FF.write('msx', f8, {}).bytes, 'imp-cpc.cpc': FF.write('cpc', f8, {}).bytes, 'imp-psf.psf': FF.writePsf(f8, {}), 'imp-pcf.pcf': FF.writePcf(f8), 'imp-gem.fnt': FF.writeGem(f8, {}),
    'imp-raw.raw': FF.writeRaw(f8, {}), 'imp-eot.eot': FF.eotWrap(FP.toTtf(m12, {}), 'Eot12'), 'imp-ttc.ttc': FF.ttcPack([FP.toTtf(m12, {}), FP.toTtf(f8, {})]),
  };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), b);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }), errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (mm) => { if (mm.type() === 'error') errs.push(mm.text()); });
    await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
    await p.waitForFunction(() => window.FE && FE.state.f && document.querySelectorAll('#sizes .sz').length >= 13);
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.FE && FE.state.f);
    await p.evaluate(() => { document.querySelector('details.rawopt').open = true; });
    for (const n of Object.keys(files)) {
      await p.selectOption('#raworder', /atascii/.test(n) ? 'atascii' : 'seq'); await p.evaluate((v) => { document.getElementById('impsize').value = v; }, /pcf/.test(n) ? 8 : 0); await p.setInputFiles('#file', path.join(OUT, n)); await p.waitForTimeout(500);
      const r = await p.evaluate(() => ({ name: FE.state.fam.name, adv: FE.state.f.adv, A: JSON.stringify(Array.from(FE.state.f.glyphs[FE.state.f.map ? FE.state.f.map[65] : 65] || [])) }));
      assert.ok(r.name, n + ' opened a family'); if (!/eot|ttc/.test(n)) assert.strictEqual(r.name, n.replace(/\.\w+$/, ''), 'family named after the file');
      if (!/eot|ttc/.test(n)) { assert.strictEqual(r.adv, 8, n + ' is 8 px'); assert.strictEqual(r.A, A(f8), n + ': A pixels identical'); }
      ok('import ' + n + ' -> family "' + r.name + '" (' + r.adv + ' px)');
    }
    await p.screenshot({ path: path.join(ROOT, 'out', 'ui5-imported.png') });
    await p.click('#flist .fitem[data-fid="craft"]'); await p.click('#sizes .sz[data-size="8"]');
    assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 8);
    const ref = await p.evaluate(() => { const f = FE.atari8(true); return JSON.stringify(Array.from(f.glyphs[f.map ? f.map[65] : 65])); });
    const exp = async (val) => {
      await p.evaluate(() => { document.querySelector('details.menu').open = true; });
      await p.selectOption('#xfmt', val); await p.fill('#xcw', '8'); await p.fill('#xch', '8');
      const [d] = await Promise.all([p.waitForEvent('download'), p.click('#bxfmt')]);
      const fp = path.join(OUT, 'exp-' + val + '-' + d.suggestedFilename().replace(/[^\w.]/g, '_')); await d.saveAs(fp); return fs.readFileSync(fp);
    };
    const chk = (f, what) => assert.strictEqual(A(f), ref, what + ': A identical after export -> read');
    chk(FF.readAtari(await exp('atari-screen'), {}), 'atari screen'); chk(FF.readAtari(await exp('atari-atascii'), { order: 'atascii' }), 'atascii');
    const inv = await exp('atari-inv'); assert.strictEqual(inv.length, 2048); chk(FF.readAtari(inv, {}), 'atari 2k');
    const c64 = await exp('c64h'); assert.strictEqual(c64.length, 2050); assert.deepStrictEqual(FF.write('c64', FF.read(c64, 'a.64c', {}), {}).bytes.length, 2048);
    chk(FF.read(await exp('zx'), 'a.zx', {}), 'zx'); chk(FF.read(await exp('msx'), 'a.msx', {}), 'msx'); chk(FF.read(await exp('cpc'), 'a.cpc', {}), 'cpc');
    chk(FF.readPsf(await exp('psf')), 'psf'); chk(CF.fromPcf(await exp('pcf'), { size: 8 }), 'pcf'); chk(FF.readGem(await exp('gem')), 'gem'); chk(FF.readRaw(await exp('raw'), {}), 'raw');
    const eot = await exp('eot'); assert.strictEqual(FF.detect(eot, 'a.eot'), 'eot'); assert.ok(FP.fromTtfExport(FF.eotUnwrap(eot)));
    const woff = await exp('woff'); assert.strictEqual(woff.toString('latin1', 0, 4), 'wOFF'); assert.ok(FP.fromTtfExport(woff));
    assert.ok(SF.ttcCount(await exp('ttc')) >= 2);
    ok('exported 14 formats from the Export menu, each read back and compared');
    await p.evaluate(() => { document.querySelector('details.menu').open = true; }); await p.screenshot({ path: path.join(ROOT, 'out', 'ui5-export.png') });
    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join('; ')); ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
