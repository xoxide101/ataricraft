'use strict';
// xCBase web test: node scripts/xcbase-web-test.cjs   (Playwright + Chrome; screenshots in out/xcbase/web-*.png)
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'out', 'xcbase');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let fail = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const srv = http.createServer((q, s) => {
    const p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(fs.readFileSync(p));
  }).listen(0);
  const port = srv.address().port;

  // gateway with a temp sqlite file
  const dbf = path.join(OUT, 'gate-test.sqlite'), cfgf = path.join(OUT, 'gate-test.json');
  try { fs.rmSync(dbf, { force: true }); } catch (e) {}
  const { DatabaseSync } = require('node:sqlite');
  const sdb = new DatabaseSync(dbf); sdb.exec("CREATE TABLE people(id INTEGER, name TEXT, city TEXT); INSERT INTO people VALUES (1,'Ann','Oslo'),(2,'Bo','Rome'),(3,'Cy','Oslo'); CREATE TABLE secret(x TEXT)"); sdb.close();
  fs.writeFileSync(cfgf, JSON.stringify({ port: 8791, databases: { main: { engine: 'sqlite', path: dbf, tables: ['people'] } } }));
  const gate = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'sqlgate', 'server.cjs'), cfgf, '8791'], { env: Object.assign({}, process.env, { AC_TOKEN: 'webtesttoken' }), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));

  const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 780 }, acceptDownloads: true }), page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/403|400|404|favicon|font|Private|CORS|ERR_/i.test(m.text())) errs.push(m.text()); });
  const shot = (k) => page.screenshot({ path: path.join(OUT, 'web-' + k + '.png') });
  const dl = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
  try {
    await page.goto('http://localhost:' + port + '/xcbase.html'); await page.waitForFunction('window.XCB_READY');
    await shot('home');
    await page.click('#hdemo');
    ok(await page.evaluate(() => XA.tname) === 'customers', 'demo opens on customers');
    ok(await page.locator('#gsizer .grow').count() >= 10, 'grid rows rendered');
    await shot('grid');

    await page.click('#gsizer [data-r="0"] [data-c="1"]'); await page.keyboard.press('Enter');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Ada L.'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => XA.table().rows[0][1]) === 'Ada L.', 'cell edit commits');
    await page.click('#tb-undo'); ok(await page.evaluate(() => XA.table().rows[0][1]) === 'Ada Lovelace', 'undo edit ' + await page.evaluate(() => JSON.stringify([XA.table().rows[0][1], XA.undo.map((u) => u.label)])));
    await page.click('#tb-redo'); ok(await page.evaluate(() => XA.table().rows[0][1]) === 'Ada L.', 'redo edit');
    const c0 = await page.evaluate(() => XA.table().rows.length);
    await page.click('#tb-add'); ok(await page.evaluate(() => XA.table().rows.length) === c0 + 1, 'add record');
    await page.click('#tb-undo'); ok(await page.evaluate(() => XA.table().rows.length) === c0, 'undo add');
    await page.evaluate(() => { XA.cur.row = 0; XA.emit('select'); }); await page.click('#tb-del');
    ok(await page.evaluate(() => XA.table().rows.length) === c0 - 1, 'delete record');
    await page.click('#tb-undo'); ok(await page.evaluate(() => XA.table().rows.length) === c0, 'undo delete');

    await page.click('#ghead [data-f="name"]');
    ok(await page.evaluate(() => XA.sort && XA.sort.field) === 'name', 'click heading sorts');
    await page.fill('#filter', 'city=London'); ok(await page.evaluate(() => XA.positions().length) === 3, 'filter city=London -> 3');
    await page.fill('#filter', 'balance>1000'); ok(await page.evaluate(() => XA.positions().length) === 3, 'filter balance>1000 -> 3');
    await page.fill('#filter', '');

    await page.evaluate(() => { const t = XA.db.createTable('big', [{ name: 'id', type: 'int' }, { name: 'txt', type: 'text', len: 10 }]); for (let i = 0; i < 20000; i++) t.insert({ id: i, txt: 'r' + i }); XA.useTable('big'); });
    ok(await page.locator('#gsizer .grow').count() < 80, 'virtual scroll: few DOM rows for 20000 records');
    await page.evaluate(() => { document.getElementById('gscroll').scrollTop = 24 * 15000; });
    await page.waitForTimeout(200);
    ok(/r1[45]\d\d\d/.test(await page.locator('#gsizer .grow').nth(10).innerText()), 'scrolled to row ~15000');
    await page.evaluate(() => { XA.dropTable('big'); });
    ok(await page.evaluate(() => XA.db.tables.length) === 2, 'drop table');

    await page.click('#mform'); ok(await page.locator('#formcard input').count() >= 4, 'form view shows fields');
    await page.click('[data-nav="next"]'); ok(await page.evaluate(() => XA.cur.row) === 1, 'form next');
    await page.fill('#ff2', 'Lyon'); await page.press('#ff2', 'Tab');
    ok(await page.evaluate(() => XA.table().rows[XA.positions()[1]][2]) === 'Lyon', 'form edit writes record');
    await shot('form');

    await page.click('#mquery'); await page.fill('#qsql', 'SELECT city, count(*) AS n FROM customers GROUP BY city ORDER BY n DESC, city'); await page.click('#qrun');
    ok(await page.locator('#qout tbody tr').count() >= 3, 'query returns grouped rows');
    await page.fill('#qsql', 'SELECT name FROM customers WHERE city = ?'); await page.fill('#qparams', '["London"]'); await page.click('#qrun');
    ok(await page.locator('#qout tbody tr').count() === 3, 'parameterised query');
    await page.fill('#qsql', 'SELECT nope FROM customers'); await page.click('#qrun'); ok(/Error/.test(await page.innerText('#qinfo')), 'bad query shows error');
    await page.fill('#qsql', 'SELECT name, city FROM customers'); await page.fill('#qparams', ''); await page.click('#qrun'); await page.click('#qtotable');
    ok(await page.evaluate(() => XA.db.hasTable('result')), 'query result kept as table');
    await shot('query');

    await page.click('#mat'); ok(/bytes/.test(await page.innerText('#fittext')), 'atari view meter: ' + await page.innerText('#fittext'));
    ok(await page.locator('#layout tr').count() > 3, 'record layout table');
    await shot('atari');

    await page.click('#mgrid'); await page.evaluate(() => XA.useTable('customers'));
    await page.click('#tb-export'); const fx = await dl('[data-x="xcd"]'); await page.keyboard.press('Escape');
    const xb = fs.readFileSync(fx); ok(xb.slice(0, 4).toString() === 'CRFT' && xb[5] === 0x44, '.xcd download has CRFT/D header, ' + xb.length + ' bytes');
    await page.evaluate(() => XA.closeDialog()); await page.click('#tb-export'); const fc = await dl('[data-x="csv"]');
    ok(/Ada/.test(fs.readFileSync(fc, 'utf8')), 'csv export'); await page.evaluate(() => XA.closeDialog());
    await page.click('#tb-export'); const fd = await dl('[data-x="dbf"]'); const db0 = fs.readFileSync(fd)[0]; ok(db0 === 0x83 || db0 === 0x03, 'dbf export'); await page.evaluate(() => XA.closeDialog());
    await page.click('#bhome'); await page.setInputFiles('#filein', fx); await page.waitForTimeout(500);
    ok(await page.evaluate(() => XA.db && XA.db.tables.length) >= 2, 'reopen exported .xcd');
    await page.setInputFiles('#filein', fc); await page.waitForTimeout(400);
    ok(await page.evaluate(() => XA.db.tables.length) >= 1, 'csv open path ran');
    await page.evaluate(() => { XA.closeDialog(); });
    await page.evaluate(() => { XA.useTable('customers'); });

    await page.click('#tb-report'); await page.waitForTimeout(400);
    ok(/London/.test(await page.frameLocator('#rframe').locator('body').innerText()), 'report renders grouped HTML');
    await shot('report'); await page.evaluate(() => XA.closeDialog());

    await page.click('#tb-merge'); await page.fill('#mtpl', 'Dear <<name>> of <<city>> <<bogus>>'); await page.waitForTimeout(200);
    ok(/bogus/.test(await page.innerText('#mwarn')), 'merge warns about unknown field');
    const fm = await dl('#mjson'); const mj = JSON.parse(fs.readFileSync(fm, 'utf8'));
    ok(mj.format === 'xcmerge' && mj.records.length === 10, 'xcmerge.json: ' + mj.records.length + ' records');
    const ft = await dl('#mtxt'); ok(/Dear .* of /.test(fs.readFileSync(ft, 'utf8')), 'merged letters text');
    await shot('merge'); await page.evaluate(() => XA.closeDialog());

    await page.click('#tb-sql'); await page.fill('#gurl', 'http://127.0.0.1:8791'); await page.fill('#gtok', 'wrong'); await page.click('#gcon'); await page.waitForTimeout(600);
    ok(await page.locator('#gbody').isHidden(), 'bad token refused');
    await page.fill('#gtok', 'webtesttoken'); await page.click('#gcon'); await page.waitForTimeout(800);
    ok(await page.locator('#gbody').isVisible(), 'gateway connects');
    const gt = await page.innerText('#gtabs'); ok(gt.includes('people') && !gt.includes('secret'), 'only allow-listed tables listed');
    await page.fill('#gsql', 'SELECT * FROM people WHERE city = ?'); await page.fill('#gprm', '["Oslo"]'); await page.click('#grun'); await page.waitForTimeout(500);
    ok(await page.locator('#gres tbody tr').count() === 2, 'gateway parameterised query');
    await page.fill('#gsql', 'SELECT * FROM secret'); await page.click('#grun'); await page.waitForTimeout(500);
    ok(await page.locator('#gst span').count() > 0, 'non-allow-listed table refused: ' + await page.innerText('#gst'));
    await page.fill('#gsql', "SELECT * FROM people WHERE city = 'x'"); await page.click('#grun'); await page.waitForTimeout(500);
    ok(await page.locator('#gst span').count() > 0, 'inline literal refused: ' + await page.innerText('#gst'));
    await page.fill('#gsql', 'SELECT * FROM people'); await page.fill('#gprm', ''); await page.click('#grun'); await page.waitForTimeout(500);
    await page.click('#gimp'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => XA.db.tables.some((t) => t.name === 'sql' && t.rows.length === 3)), 'gateway result imported as table');
    ok(await page.evaluate(() => !JSON.stringify(localStorage).includes('webtesttoken')), 'token not persisted in localStorage');
    await page.click('#tb-sql'); await shot('gateway'); await page.evaluate(() => XA.closeDialog());

    await page.click('#bhome');
    await page.evaluate(() => { XA.LS.set('xcb.recent', [{ name: 'x', json: {} }]); XA.emit('recent'); });
    await page.click('#home', { button: 'right', position: { x: 300, y: 300 } });
    await page.click('#ctx >> text=Clear history'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('xcb.recent') || '[]').length === 0 && !localStorage.getItem('xcb.gate') && !localStorage.getItem('xcb.sql')), 'right-click Clear history empties stored history');
    ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } catch (e) { ok(false, 'exception: ' + e.message.split('\n')[0]); await shot('error').catch(() => {}); }
  await br.close(); srv.close(); gate.kill();
  console.log(`\n${n - fail}/${n} passed`); process.exit(fail ? 1 : 0);
})();
