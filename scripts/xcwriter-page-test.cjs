// xCWriter page view test: page geometry, ruler tab editing, zoom, scroll, navigator, page setup, round trip of the page trailer.
// Usage: node scripts/xcwriter-page-test.cjs   (screenshots in out/xcwp-*.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const shot = (n) => p.screenshot({ path: path.join(OUT, 'xcwp-' + n + '.png') });
  const ok = (m) => console.log('ok  ' + m);
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/xcwriter.html');
  await p.click('#hnew');
  await p.click('#mpg'); await p.waitForTimeout(300);
  assert(await p.evaluate(() => document.body.classList.contains('m-page')));
  const long = 'The quick brown fox jumps over the lazy dog. '.repeat(6);
  await p.keyboard.type(long.slice(0, 200), { delay: 2 });
  await p.keyboard.press('Enter');
  await p.keyboard.type('Second paragraph.');
  await p.waitForTimeout(300);
  let lines = await p.evaluate(() => PG.lines().map((l) => l.cells.length));
  assert(Math.max(...lines) > 64 && Math.max(...lines) <= 80, 'wraps at the 80 usable columns: ' + lines);
  ok('page view wraps at usable width: line lengths ' + lines.join(','));
  const st = await p.evaluate(() => PG.state());
  assert.strictEqual(st.geom.i.usable, 80); assert.strictEqual(st.geom.pw, 425); assert.strictEqual(st.geom.ph, 528);
  ok('true page 425 x 528 logical px (85 cols x 5 px, 66 lines x 8 px), usable 80 cols');
  await shot('1-page');

  // ruler: add a centre and a right tab by clicking, drag a margin marker
  const rb = await p.locator('#pgruler').boundingBox();
  const colX = (col) => rb.x + (24 + col * 5) * st.z - st.scrollLeft;
  await p.selectOption('#pgkind', 'c'); await p.mouse.click(colX(42), rb.y + 14);
  await p.selectOption('#pgkind', 'r'); await p.mouse.click(colX(70), rb.y + 14);
  await p.selectOption('#pgkind', 'l'); await p.mouse.click(colX(20), rb.y + 14);
  let page = await p.evaluate(() => XW.page);
  assert.deepStrictEqual(page.tabs.map((t) => t.kind + t.pos), ['l20', 'c42', 'r70']);
  ok('ruler clicks add left/centre/right tab stops: ' + page.tabs.map((t) => t.kind + t.pos));
  await p.mouse.move(colX(page.left), rb.y + 20); await p.mouse.down(); await p.mouse.move(colX(8), rb.y + 20, { steps: 4 }); await p.mouse.up();
  page = await p.evaluate(() => XW.page);
  assert.strictEqual(page.left, 8);
  lines = await p.evaluate(() => PG.lines().map((l) => l.cells.length));
  assert(Math.max(...lines) <= 75 && Math.max(...lines) > 64, 'rewrap after margin drag: ' + lines);
  ok('dragging the left margin to column 8 re-wraps to 75 usable columns');
  await p.mouse.dblclick(colX(70), rb.y + 14);
  assert.strictEqual((await p.evaluate(() => XW.page.tabs.length)), 2); ok('double-click removes a tab stop');
  await shot('2-ruler');

  // Tab key honours stops
  await p.click('#pgcanvas'); await p.keyboard.press('Control+End'); await p.keyboard.press('Enter'); await p.keyboard.press('Tab'); await p.keyboard.type('x');
  const tl = await p.evaluate(() => { const L = PG.lines(); const l = L[L.length - 1]; return { n: l.cells.findIndex((c) => c.ch === 'x'), left: XW.page.left }; });
  assert.strictEqual(tl.left + tl.n, 20, 'tab to stop at absolute column 20'); ok('Tab key moves to the left stop at column 20');

  // zoom
  for (const [v, want] of [['50', 1], ['100', 2], ['400', 8]]) {
    await p.selectOption('#pgzoom', v); await p.waitForTimeout(150);
    const z = await p.evaluate(() => PG.state().z); assert.strictEqual(z, want); ok('zoom ' + v + '% = ' + want + 'x');
  }
  await shot('3-zoom400');
  await p.selectOption('#pgzoom', 'width'); await p.waitForTimeout(150);
  const fw = await p.evaluate(() => { const s = PG.state(); return { z: s.z, dw: s.geom.dw * s.z, vw: PG.scroller.clientWidth }; });
  assert(fw.dw <= fw.vw + 1 && fw.dw > fw.vw - 12, 'fit width ' + JSON.stringify(fw)); ok('fit width: page ' + Math.round(fw.dw) + ' px in ' + fw.vw + ' px');
  await shot('4-fitwidth');
  await p.selectOption('#pgzoom', '300'); await p.waitForTimeout(150);

  // scrolling follows the caret horizontally and the navigator drags the view
  await p.click('#pgcanvas'); await p.keyboard.press('Control+Home'); await p.keyboard.press('End'); await p.waitForTimeout(200);
  const sc = await p.evaluate(() => ({ x: PG.scroller.scrollLeft, w: PG.scroller.scrollWidth, c: PG.scroller.clientWidth }));
  assert(sc.w > sc.c, 'content wider than the view at 300%'); ok('300%: page ' + sc.w + ' px in a ' + sc.c + ' px view; scrollLeft follows caret = ' + Math.round(sc.x));
  const nb = await p.locator('#pgnav').boundingBox();
  await p.mouse.click(nb.x + 5, nb.y + 5); await p.waitForTimeout(150);
  const sc2 = await p.evaluate(() => ({ x: PG.scroller.scrollLeft, y: PG.scroller.scrollTop }));
  assert(sc2.x < sc.x || sc.x === 0); assert(sc2.x < 50 && sc2.y < 50, 'navigator click scrolls to the page corner ' + JSON.stringify(sc2)); ok('navigator click moves the view to the top-left');
  await p.mouse.click(nb.x + nb.width - 4, nb.y + nb.height - 4); await p.waitForTimeout(150);
  const sc3 = await p.evaluate(() => PG.scroller.scrollLeft); assert(sc3 > sc2.x); ok('navigator click at the right side scrolls right: ' + Math.round(sc3));
  await shot('5-nav');

  // page setup dialog: A4 at 12 cpi
  await p.click('#pgsetup'); await p.waitForTimeout(150);
  await shot('6-setup');
  await p.selectOption('#psp', 'a4'); await p.selectOption('#psc', '12'); await p.waitForTimeout(100);
  const sum = await p.textContent('#pssum'); assert(/99 columns/.test(sum) && /93 columns/.test(sum), sum);
  await p.click('#psok'); await p.waitForTimeout(200);
  const pg2 = await p.evaluate(() => XW.page); assert.strictEqual(pg2.paper, 'a4'); assert.strictEqual(pg2.pitch, 12);
  const g2 = await p.evaluate(() => PG.state().geom); assert.strictEqual(g2.pw, 99 * 4);
  lines = await p.evaluate(() => PG.lines().map((l) => l.cells.length)); assert(Math.max(...lines) > 80, 'A4 12 cpi usable 93: ' + lines);
  ok('page setup A4 / 12 cpi: ' + g2.i.paperCols + ' cols, usable ' + g2.i.usable + ', ' + g2.i.textLines + ' lines');
  await p.selectOption('#pgzoom', 'page'); await p.waitForTimeout(200); await shot('7-a4');

  // save to CWD carries the page; reopening restores it
  const saved = await p.evaluate(() => Array.from(XCW.save(XW.doc, 'cwd', { page: XW.page }).bytes));
  const hdr = await p.evaluate((a) => { const h = XCW.parseCwd(new Uint8Array(a)).h; return { flags: h.flags, cols: h.cols, page: h.page }; }, saved);
  assert.strictEqual(hdr.flags, 2); assert.strictEqual(hdr.cols, 93); assert.strictEqual(hdr.page.paper, 'a4');
  await p.evaluate((a) => XW.api.openBuf(new Uint8Array(a), 'T.CWD', 'auto'), saved); await p.waitForTimeout(200);
  const back = await p.evaluate(() => XW.page); assert.strictEqual(back.paper, 'a4'); assert.strictEqual(back.pitch, 12); assert.strictEqual(back.left, 4); assert.strictEqual(back.right, 2);
  ok('CWD save/open round-trips page setup: ' + JSON.stringify(back));

  // the other modes are untouched
  await p.click('#mat'); await p.waitForTimeout(200);
  const al = await p.evaluate(() => Math.max(...AT.lines().map((l) => l.cells.length)));
  assert(al <= 64); ok('Atari matching view still wraps at 64 columns (' + al + ')');
  await p.click('#mhq'); await p.waitForTimeout(100);
  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
