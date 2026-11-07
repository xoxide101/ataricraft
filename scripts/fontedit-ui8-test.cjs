const { chromium } = require('C:/craftapi/node_modules/playwright-core'.replace('C:/craftapi', 'C:/Users/raver/craftapi'));
const path = require('path');
const URL = 'file:///' + path.resolve(__dirname, '..', 'web', 'fontedit.html').replace(/\\/g, '/');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForTimeout(800);
  const ids = await pg.evaluate(() => FE.panels.list());
  ok(ids.length >= 15, 'panels registered: ' + ids.join(','));
  const mode = (id) => pg.evaluate((i) => FE.panels.get(i).mode, id);
  // float + dock
  await pg.click('#gcol .pbar [data-a=float]'); ok(await mode('glyphs') === 'float', 'glyph grid floats');
  ok(await pg.locator('.pph').count() === 1, 'placeholder shown');
  const b1 = await pg.locator('#gcol').boundingBox();
  await pg.mouse.move(b1.x + 100, b1.y + 8); await pg.mouse.down(); await pg.mouse.move(b1.x + 160, b1.y + 68, { steps: 4 }); await pg.mouse.up();
  const b2 = await pg.locator('#gcol').boundingBox(); ok(Math.abs(b2.x - b1.x - 60) < 4, 'floating window dragged');
  await pg.click('.pph button'); ok(await mode('glyphs') === 'dock', 'bring back');
  // maximise + Esc
  await pg.click('#ecol .pbar [data-a=max]'); ok(await mode('pixels') === 'max', 'pixel editor maximised');
  const bm = await pg.locator('#ecol').boundingBox(); ok(bm.width > 1400, 'maximised width ' + Math.round(bm.width));
  await pg.screenshot({ path: 'out/panels-max-1600.png' });
  await pg.keyboard.press('Escape'); ok(await mode('pixels') === 'dock', 'Esc leaves maximise');
  // zoom pixel editor
  const z0 = await pg.inputValue('#zoom');
  await pg.click('#ecol .pbar [data-a=in]'); const z1 = await pg.inputValue('#zoom'); ok(+z1 > +z0, 'zoom + ' + z0 + '->' + z1);
  await pg.click('#ecol .pbar [data-a=out]'); ok(await pg.inputValue('#zoom') === z0, 'zoom -');
  // keyboard + on hovered panel, ctrl+wheel
  await pg.hover('#ecol'); await pg.keyboard.press('+'); ok(+(await pg.inputValue('#zoom')) > +z0, 'key + zooms hovered panel');
  await pg.keyboard.press('0'); ok(await pg.inputValue('#zoom') === '24', 'key 0 resets');
  await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -100); await pg.keyboard.up('Control');
  ok(+(await pg.inputValue('#zoom')) > 24, 'ctrl+wheel zooms');
  // glyph grid zoom (native) and css zoom
  await pg.click('#gcol .pbar [data-a=in]'); ok(await pg.evaluate(() => FE.gridZoom()) > 1, 'glyph grid zoom');
  await pg.click('#rpanel .panel[data-panel=metrics] .pbar [data-a=in]');
  ok(await pg.evaluate(() => FE.panels.get('metrics').cz) > 1, 'css zoom on metrics');
  // persisted
  await pg.click('#ecol .pbar [data-a=float]');
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('craft.layout')));
  ok(saved.panels.glyphs && saved.panels.glyphs.zoom > 1 && saved.panels.pixels.mode === 'float', 'craft.layout stored ' + JSON.stringify(saved.panels).slice(0, 120));
  await pg.reload(); await pg.waitForTimeout(800);
  ok(await mode('pixels') === 'float', 'float restored after reload');
  ok(await pg.evaluate(() => FE.gridZoom()) > 1, 'grid zoom restored');
  ok(await pg.evaluate(() => FE.panels.get('metrics').cz) > 1, 'metrics zoom restored');
  await pg.screenshot({ path: 'out/panels-float-1600.png' });
  // layouts + reset
  await pg.click('[data-lay=overview]'); ok(await pg.evaluate(() => FE.state.tab) === 'specimen' && await pg.locator('#lpanel.collapsed').count() === 1, 'Overview layout');
  await pg.click('[data-lay=compare]'); ok(await pg.evaluate(() => FE.state.tab) === 'family', 'Compare layout');
  await pg.screenshot({ path: 'out/panels-compare-1600.png' });
  await pg.click('#layreset');
  ok(await mode('pixels') === 'dock' && await pg.evaluate(() => FE.gridZoom()) === 1 && await pg.inputValue('#zoom') === '24', 'Reset layout');
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('craft.layout')).layout) === 'editor', 'reset stored');
  // narrow widths
  for (const w of [1100, 760]) {
    await pg.setViewportSize({ width: w, height: 800 }); await pg.waitForTimeout(300);
    await pg.click('#gcol .pbar [data-a=max]'); await pg.waitForTimeout(200);
    const bx = await pg.locator('#gcol').boundingBox(); ok(bx.width > w * 0.9 - 4, w + ': maximised glyph grid fills ' + Math.round(bx.width));
    await pg.screenshot({ path: 'out/panels-max-' + w + '.png' });
    await pg.keyboard.press('Escape');
    await pg.screenshot({ path: 'out/panels-' + w + '.png' });
  }
  ok(errs.length === 0, 'no console errors ' + errs.slice(0, 3).join('|'));
  await b.close(); process.exit(fails ? 1 : 0);
})();
