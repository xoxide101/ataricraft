'use strict';
// xCCalc web test: node scripts/xccalc-test.cjs   (Playwright + Chrome; screenshots in out/xccalc/web-*.png)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'out', 'xccalc');
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
  const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 760 }, acceptDownloads: true }), page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|font/i.test(m.text())) errs.push(m.text()); });
  await page.goto('http://localhost:' + port + '/xccalc.html'); await page.waitForFunction('window.XCC_READY');
  const disp = (r, c, s = 0) => page.evaluate(([r, c, s]) => XA.wb.display(s, r, c), [r, c, s]);
  const shot = (n) => page.screenshot({ path: path.join(OUT, 'web-' + n + '.png') });

  await shot('home');
  await page.click('#hnew'); await page.click('#gcanvas', { position: { x: 100, y: 40 } });
  await page.evaluate(() => XA.select(0, 0, 0, 0));
  await page.keyboard.type('5'); await page.keyboard.press('Enter'); await page.keyboard.type('7'); await page.keyboard.press('Enter');
  await page.keyboard.type('=A1*A2'); await page.keyboard.press('Enter');
  ok(await disp(2, 0) === '35', 'formula typed: =A1*A2 -> ' + await disp(2, 0));
  await page.evaluate(() => XA.select(0, 0, 0, 0)); await page.keyboard.type('10'); await page.keyboard.press('Enter');
  ok(await disp(2, 0) === '70', 'recalculation -> ' + await disp(2, 0));
  await page.keyboard.press('Control+z');
  ok(await disp(0, 0) === '5' && await disp(2, 0) === '35', 'undo');
  await page.keyboard.press('Control+y');
  ok(await disp(0, 0) === '10', 'redo');

  // formula bar edit
  await page.evaluate(() => XA.select(3, 0, 3, 0)); await page.fill('#fbar', '=SUM(A1:A3)'); await page.press('#fbar', 'Enter');
  ok(await disp(3, 0) === '87', 'formula bar commit -> ' + await disp(3, 0));

  // paste Excel TSV
  await page.evaluate(() => XA.select(0, 2, 0, 2)); await page.focus('#gcanvas');
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Name\tQty\tPrice\r\nApple\t3\t1.5\r\nPear\t4\t"2,5"\r\n'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  ok(await disp(1, 2) === 'Apple' && await disp(1, 3) === '3' && await disp(2, 4) === '2,5', 'paste TSV: ' + [await disp(1, 2), await disp(1, 3), await disp(2, 4)]);
  // fill down
  await page.evaluate(() => { XA.select(1, 5, 1, 5); }); await page.keyboard.type('=D2*1.5'); await page.keyboard.press('Enter');
  await page.evaluate(() => XA.select(1, 5, 2, 5, true)); await page.keyboard.press('Control+d');
  ok(await disp(1, 5) === '4.5' && await disp(2, 5) === '6', 'fill down ' + await disp(1, 5) + ' ' + await disp(2, 5));
  // bold + format
  await page.evaluate(() => XA.select(1, 5, 2, 5, true)); await page.keyboard.press('Control+b'); await page.selectOption('#numfmt', '$#,##0.00');
  ok((await disp(1, 5)).startsWith('$') && (await disp(2, 5)).startsWith('$') && await page.evaluate(() => XA.wb.cell(0, 1, 5).st & 1), 'number format + bold ' + await disp(1, 5) + ' ' + await page.evaluate(() => JSON.stringify(XA.wb.cell(0, 1, 5)) + JSON.stringify(XA.rect())));
  // column resize
  const w0 = await page.evaluate(() => XA.wb.colWidth(0, 1));
  await page.evaluate(() => XA.setColW(1, 20)); ok(await page.evaluate(() => XA.wb.colWidth(0, 1)) === 20 && w0 !== 20, 'column width');
  await page.evaluate(() => XA.select(0, 0, 0, 0)); await shot('typed');

  // right-click menu
  await page.click('#gcanvas', { button: 'right', position: { x: 200, y: 60 } });
  ok(await page.isVisible('#ctx') && (await page.textContent('#ctx')).includes('Clear history'), 'context menu has Clear history'); await shot('ctx');
  await page.click('#ctx >> text=Clear history');
  ok(await page.evaluate(() => (XA.LS.get('xcc.recent', [])).length === 0 && XA.undo.length === 0), 'Clear history');

  // save .xcs and reload
  await page.evaluate(() => XA.select(0, 0, 0, 0)); await page.click('#bsave'); await page.selectOption('#sfmt', 'xcs');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sgo')]);
  const xcsPath = path.join(OUT, 'web-saved.xcs'); await dl.saveAs(xcsPath);
  ok(fs.statSync(xcsPath).size > 20, 'saved .xcs ' + fs.statSync(xcsPath).size + ' bytes');
  const before = await page.evaluate(() => { const o = []; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) o.push(XA.wb.display(0, r, c)); return o.join('|'); });
  await page.evaluate(() => XA.newBook());
  await page.setInputFiles('#filein', xcsPath);
  await page.waitForFunction('XA.name === "web-saved.xcs"');
  const after = await page.evaluate(() => { const o = []; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) o.push(XA.wb.display(0, r, c)); return o.join('|'); });
  ok(before === after && before.includes('Apple'), 'save/reload .xcs round trip');

  // open XLSX made by Excel COM
  const xl = path.join(OUT, 'excel-saved.xlsx');
  if (fs.existsSync(xl)) {
    await page.setInputFiles('#filein', xl); await page.waitForFunction('XA.name === "excel-saved.xlsx"');
    if (await page.isVisible('#dlg #dok')) await page.click('#dok');
    const info = await page.evaluate(() => { const w = XA.wb; let f = 0, e = 0; for (let s = 0; s < w.sheets.length; s++) { const b = w.bounds(s); for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) { const x = w.cell(s, r, c); if (x && x.f) f++; if (x && XA.C.isErr(x.val)) e++; } } return { sheets: w.sheets.length, f, e, a1: w.display(0, 0, 0), f1: w.display(0, 0, 5) }; });
    const C = require('../tools/calccore.cjs'), IO = require('../tools/xccalc/xcsio.cjs');
    const ref = IO.importXLSX(new Uint8Array(fs.readFileSync(xl))).wb;
    ok(info.sheets === ref.sheets.length && info.f > 50 && info.f1 === ref.display(0, 0, 5), 'Excel COM xlsx opened: ' + JSON.stringify(info));
    await shot('excel');
  } else console.log('skip  Excel xlsx missing (run scripts/calc-excel-test.cjs)');

  // csv/tsv/ods/xlsx/html save round trips from the UI
  for (const fmt of ['csv', 'tsv', 'xlsx', 'ods', 'html']) {
    await page.evaluate(() => XA.newBook()); await page.evaluate(() => { XA.commit(0, 0, '3'); XA.commit(1, 0, '=A1*2'); });
    await page.click('#bsave'); await page.selectOption('#sfmt', fmt);
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#sgo')]);
    const p = path.join(OUT, 'web-out.' + fmt); await d.saveAs(p); ok(fs.statSync(p).size > 3, 'save ' + fmt);
    if (fmt !== 'html') { await page.setInputFiles('#filein', p); await page.waitForFunction((n) => XA.name === n, 'web-out.' + fmt); await page.evaluate(() => XA.closeDialog()); ok((await disp(1, 0)) === '6', 'reopen ' + fmt + ' -> ' + await disp(1, 0)); }
  }

  // demo, charts, Atari view
  await page.click('#bhome'); await page.click('#hdemo'); await page.waitForSelector('#chlist canvas');
  await shot('demo');
  const png = await page.evaluate(async () => { const b = await XA.views.chartPng(XA.wb, XA.wb.charts[0]); return Array.from(b.slice(0, 8)); });
  ok(png.join() === '137,80,78,71,13,10,26,10', 'chart PNG signature');
  const cnv = page.locator('#chlist canvas').first(); await cnv.screenshot({ path: path.join(OUT, 'web-chart.png') });
  for (const k of ['line', 'pie']) { await page.evaluate((k) => { XA.wb.charts[0].kind = k; XA.views.renderCharts(); }, k); await page.locator('#chlist canvas').first().screenshot({ path: path.join(OUT, 'web-chart-' + k + '.png') }); }
  await page.click('#mat'); await page.waitForTimeout(200); await shot('atari');
  const warns = await page.textContent('#warns'); ok(warns.length > 0, 'atari warnings: ' + warns.trim().slice(0, 80));
  await page.click('#msh');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await br.close(); srv.close();
  console.log(fail ? fail + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
