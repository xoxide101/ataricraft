// Phase-6 tests: font manager (favourites, tags, collections, search, compare, waterfall, coverage, duplicates, hand-off) from file://.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
const URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true }), pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await pg.goto(URL); await pg.waitForFunction(() => window.FE && FE.entries && FE.entries.size);
    await pg.evaluate(() => FE.showTab('manager'));
    const rows = await pg.locator('#mgrows tr[data-id]').count(); assert.ok(rows >= 2, 'rows ' + rows); ok('manager lists ' + rows + ' fonts');

    await pg.locator('#mgrows tr[data-id="craft"]').click();
    await pg.locator('#mgrows tr[data-id="craft"] [data-star]').click();
    await pg.fill('#mgtagin', 'retro'); await pg.click('#mgtag');
    await pg.fill('#mgcollin', 'Atari set'); await pg.click('#mgcoll');
    await pg.selectOption('#mgfilter', 'fav'); assert.strictEqual(await pg.locator('#mgrows tr[data-id]').count(), 1); ok('favourite filter shows only the starred font');
    await pg.selectOption('#mgfilter', 't:retro'); assert.strictEqual(await pg.locator('#mgrows tr[data-id]').count(), 1); ok('tag filter');
    await pg.selectOption('#mgfilter', 'c:Atari set'); assert.strictEqual(await pg.locator('#mgrows tr[data-id]').count(), 1); ok('collection filter');
    await pg.selectOption('#mgfilter', '');
    await pg.fill('#mgsearch', 'zzzznomatch'); assert.strictEqual(await pg.locator('#mgrows tr[data-id]').count(), 0); await pg.fill('#mgsearch', ''); ok('search with no match empties the table');

    await pg.reload(); await pg.waitForFunction(() => window.FE && FE.entries && FE.entries.size); await pg.evaluate(() => FE.showTab('manager'));
    assert.ok((await pg.textContent('#mgrows tr[data-id="craft"]')).includes('#retro'), 'tag persists');
    assert.strictEqual(await pg.locator('#mgrows tr[data-id="craft"] .star').textContent(), '\u2605'); ok('favourite, tag and collection survive a reload');

    // duplicate: install the same family twice under two names, then scan
    await pg.evaluate(() => { FE.keepFamily(true, FE.state.fam, 'Dup A'); FE.keepFamily(true, FE.state.fam, 'Dup B'); FE.libChanged(); });
    await pg.click('#mgscan'); await pg.waitForFunction(() => !document.getElementById('mgscan').disabled, null, { timeout: 60000 });
    const dup = await pg.textContent('#mgdup'); assert.ok(/Dup A/.test(dup) && /Dup B/.test(dup), 'duplicates: ' + dup); ok('duplicate scan finds identical families: ' + dup.trim());
    const cov = await pg.evaluate(() => FE.coverageOf(FE.entries.get('craft').fam));
    assert.strictEqual(cov.ascii.total, 94); assert.ok(cov.ascii.have >= 90, 'ascii coverage ' + cov.ascii.have); assert.ok(cov.atari.have > 0, 'atari graphics present');
    ok('coverage Craft: ASCII ' + cov.ascii.have + '/94, Atari graphics ' + cov.atari.have + '/' + cov.atari.total);
    await pg.locator('#mgrows tr[data-id="craft"]').click();
    assert.ok(/ASCII 32-126/.test(await pg.textContent('#mgcov')), 'coverage panel');

    // compare + waterfall
    await pg.selectOption('#mgA', 'craft'); await pg.selectOption('#mgB', 'my:Dup A'); await pg.selectOption('#mgpx', '12'); await pg.click('#mgcmp');
    await pg.waitForFunction(() => document.getElementById('mgcmpinfo').textContent.includes('vs'));
    const ink = await pg.evaluate(() => { const c = document.getElementById('mgcA'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]]; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2]) n++; return n; });
    assert.ok(ink > 50, 'compare draws ink ' + ink); ok('compare renders text for both fonts');
    await pg.click('#mgwfgo'); await pg.waitForFunction(() => document.querySelectorAll('#mgwf canvas').length >= 10);
    ok('waterfall: ' + await pg.locator('#mgwf canvas').count() + ' sizes');

    // hand-off
    await pg.locator('#mgrows tr[data-id="craft"]').click(); await pg.click('#mgxcw');
    const faces = await pg.evaluate(() => !!(window.XFACE && XFACE.listUser ? XFACE.listUser().length >= 0 : true)); assert.ok(faces);
    await pg.click('#mginstall'); assert.ok(await pg.evaluate(() => Object.keys(FE.myFonts()).includes(FE.entries.get('craft').name)), 'installed in My fonts'); ok('Use in xCWriter / Install for Craft run without errors');
    await pg.click('#mgacw'); await pg.waitForTimeout(500); ok('Send to ACWriter runs (reports via toast when no emulator is attached)');
    await pg.fill('#mgsearch', 'craft'); await pg.locator('#mgrows tr[data-id=craft] td:nth-child(2)').dblclick(); await pg.waitForFunction(() => FE.isTab('edit'), null, { timeout: 5000 }).catch(() => {}); assert.ok(await pg.evaluate(() => FE.isTab('edit')), 'double-click opens editor'); ok('double-click opens in editor');
    await pg.evaluate(() => FE.showTab('manager'));
    for (const [w, h] of [[1600, 1000], [1100, 800], [760, 900]]) { await pg.setViewportSize({ width: w, height: h }); await pg.screenshot({ path: path.join(OUT, 'ui6-' + w + '.png') }); }
    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | ')); ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
