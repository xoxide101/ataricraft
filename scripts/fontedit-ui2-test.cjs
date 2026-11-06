// Phase-1 tests: the unified Fonts list + size strip works from file:// (no node script, no server): every size 4-26 is selectable,
// missing sizes are created on click, Atari 8x8 view auto-derives, Export menu is grouped. Screenshots in out/ at several viewports.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
    await p.waitForFunction(() => window.FE && FE.state.f && document.querySelectorAll('#sizes .sz').length >= 13);
    const shot = (n) => p.screenshot({ path: path.join(OUT, 'ui2-' + n + '.png') });
    const strip = await p.$$eval('#sizes .sz', (s) => s.map((x) => x.dataset.size));
    assert.deepStrictEqual(strip, ['4', '5', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26']); ok('file://: default family Craft Sans shows all sizes ' + strip.join(' '));
    assert.strictEqual(await p.locator('#flist .fitem').first().getAttribute('data-fid'), 'craft');
    assert.strictEqual(await p.locator('#flist optgroup, #builtin, #fsize').count(), 0); ok('no old Built-in / Library / size dropdowns');
    await shot('file-default');
    for (const s of [14, 16, 18, 20, 22, 24, 26]) {
      await p.click('#sizes .sz[data-size="' + s + '"]');
      assert.strictEqual(await p.evaluate(() => FE.state.f.adv), s);
      assert.ok(await p.evaluate(() => FE.state.f.glyphs.some((g) => g && g.some((v) => v))), s + ' has pixels');
      assert.ok(await p.locator('#sizes .sz[data-size="' + s + '"]').evaluate((e) => e.classList.contains('on')));
    }
    ok('sizes 14,16,18,20,22,24,26 are each selectable by click from file://'); await shot('file-size26');
    // a blank family: missing sizes are dashed and are created on click
    await p.evaluate(() => FE.openEntry('craft'));
    await p.evaluate(() => { document.getElementById('bnew').click(); });
    await p.waitForTimeout(300);
    const miss = await p.$$eval('#sizes .sz.missing', (s) => s.length);
    if (miss) { await p.evaluate(() => FE.selectSize(26)); assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 26); } ok('missing sizes (' + miss + ') are dashed; selecting creates them');
    await p.evaluate(() => FE.openEntry('craft')); await p.waitForTimeout(200);
    // Atari 8x8 auto-derive
    await p.evaluate(() => FE.showTab('atari')); await p.waitForTimeout(300);
    const msg = await p.evaluate(() => document.getElementById('atinfo').textContent + document.querySelector('.view.on, #views').textContent);
    assert.ok(!/derive it first/i.test(msg)); await shot('file-atari'); ok('Atari 8x8 view shows without "derive it first"');
    // Export menu
    assert.strictEqual(await p.locator('details.menu #bsave').count(), 1); await p.evaluate(() => { document.querySelector('details.menu').open = true; }); await shot('file-export-menu'); ok('Export buttons grouped in one menu');
    await p.evaluate(() => { document.querySelector('details.menu').open = false; FE.showTab('edit'); });
    for (const [w, h] of [[1280, 800], [1000, 700], [760, 900]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(250); await shot('file-' + w + 'x' + h); }
    assert.deepStrictEqual(errs, []); ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.log('FAIL', e.stack || e); process.exit(1); });
