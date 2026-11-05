// xCWriter right-click menus and Clear history: node scripts/xcwriter-history-test.cjs  (screenshots out/xcwh-*.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'file://' }).catch(() => {});
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const url = 'file:///' + ROOT.replace(/\\/g, '/') + '/web/xcwriter.html';
  await p.goto(url);
  const menu = () => p.evaluate(() => { const c = document.getElementById('ctx'); return c.style.display === 'block' ? [...c.children].map((d) => d.textContent || '-') : null; });
  const click = async (label) => { await p.locator('#ctx div', { hasText: new RegExp('^' + label + '$') }).click(); await p.waitForTimeout(150); };
  const lsRecent = () => p.evaluate(() => JSON.parse(localStorage.getItem('xcw.recent') || '[]').length);

  // two documents in the recent list, plus a saved font and a user dictionary word that must survive
  for (const t of ['First document', 'Second document']) {
    await p.click('#hnew'); await p.keyboard.type(t); await p.waitForTimeout(1800);
    await p.evaluate(() => document.getElementById('bhome').click()); await p.waitForTimeout(100);
  }
  await p.evaluate(() => { localStorage.setItem('craft.userfonts', '{"X.acf":"AAAA"}'); localStorage.setItem('xcw.ignore', '["zzzq"]'); localStorage.setItem('xcw.fmt', '"docx"'); });
  await p.reload(); await p.waitForTimeout(300);
  assert.strictEqual(await p.locator('#recent .card').count(), 2); ok('start screen lists 2 recent documents');

  await p.locator('#recent .card').first().click({ button: 'right' });
  let m = await menu(); assert.deepStrictEqual(m, ['Remove from list', 'Clear history']); ok('right-click on a recent card offers ' + m.join(' / '));
  await p.screenshot({ path: path.join(OUT, 'xcwh-1-recent.png') });
  await click('Remove from list');
  assert.strictEqual(await p.locator('#recent .card').count(), 1); assert.strictEqual(await lsRecent(), 1); ok('Remove from list drops only that document');
  await p.reload(); await p.waitForTimeout(300);
  assert.strictEqual(await p.locator('#recent .card').count(), 1); ok('removal persists after reload');

  await p.locator('#recent').click({ button: 'right', position: { x: (await p.locator('#recent').boundingBox()).width - 4, y: 2 } });
  m = await menu(); assert.ok(m.includes('Clear history') && !m.includes('Remove from list')); ok('right-click on empty list area offers Clear history only');
  await click('Clear history');
  assert.strictEqual(await p.locator('#recent .card').count(), 0); assert.strictEqual(await lsRecent(), 0);
  assert.ok(/History cleared/.test(await p.textContent('#toast'))); ok('Clear history empties the list and toasts "History cleared"');
  await p.reload(); await p.waitForTimeout(300);
  assert.strictEqual(await p.locator('#recent .card').count(), 0);
  const kept = await p.evaluate(() => [localStorage.getItem('craft.userfonts'), localStorage.getItem('xcw.ignore'), localStorage.getItem('xcw.fmt')]);
  assert.deepStrictEqual(kept, ['{"X.acf":"AAAA"}', '["zzzq"]', null]); ok('history stays empty after reload; saved fonts and user dictionary kept, last-used format cleared');

  // editor menu (HQ view)
  await p.click('#hnew'); await p.keyboard.type('Hello wrold text'); await p.waitForTimeout(500);
  await p.click('#mhq'); await p.waitForTimeout(200);
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  m = await menu(); assert.deepStrictEqual(m.filter((x) => x !== '-'), ['Cut', 'Copy', 'Paste', 'Select all', 'Clear undo history', 'Clear history']); ok('editor menu: ' + m.join(' | '));
  await p.screenshot({ path: path.join(OUT, 'xcwh-2-editor.png') });
  await click('Select all');
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  await click('Copy');
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  await click('Cut'); await p.waitForTimeout(150);
  assert.strictEqual((await p.evaluate(() => XCW.plain(XW.doc))).trim(), ''); ok('Select all + Cut empties the document');
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  await click('Paste'); await p.waitForTimeout(150);
  assert.ok(/Hello wrold text/.test(await p.evaluate(() => XCW.plain(XW.doc)))); ok('Paste puts the text back');
  assert.ok(await p.evaluate(() => XW.undo.length) > 0);
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  await click('Clear undo history');
  assert.strictEqual(await p.evaluate(() => XW.undo.length + XW.redo.length), 0); ok('Clear undo history empties undo/redo');
  assert.ok(/Hello wrold/.test(await p.evaluate(() => XCW.plain(XW.doc)))); ok('the document itself is untouched');

  // editor Clear history, then reload: the open document is not re-added to the recent list
  await p.evaluate(() => { localStorage.setItem('xcw.fmt', '"rtf"'); });
  await p.locator('#hq').click({ button: 'right', position: { x: 30, y: 10 } });
  await click('Clear history');
  assert.strictEqual(await lsRecent(), 0);
  await p.reload(); await p.waitForTimeout(300);
  assert.strictEqual(await lsRecent(), 0); ok('Clear history from the editor persists after reload (no document re-added)');

  // other places keep the browser menu
  const prevented = await p.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('fq') && document.getElementById('fq').dispatchEvent(e); return e.defaultPrevented; });
  assert.strictEqual(prevented, false); ok('find box keeps the normal browser context menu');
  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
