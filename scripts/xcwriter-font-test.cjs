// xCWriter typeface test (Page view): font picker per paragraph, rendering, CWD tag 2/3 round trip, glyph rows == the .FNT bytes.
// Serves web/ over http because the font manifest cannot be fetched from file://. Screenshots: out/xcwf-*.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'), WEB = path.join(ROOT, 'web');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (m) => console.log('ok  ' + m);
  await p.goto('http://localhost:' + port + '/xcwriter.html');
  await p.click('#hnew'); await p.click('#mpg'); await p.waitForTimeout(1500);
  const faces = await p.evaluate(() => PG.faces());
  assert(faces.includes('ATARIROM'), 'ROM charset listed: ' + faces);
  ok('font picker lists the .fnt faces: ' + faces.join(', '));
  await p.keyboard.type('alpha beta gamma'); await p.keyboard.press('Enter'); await p.keyboard.type('second paragraph');
  await p.keyboard.press('ArrowUp');
  await p.selectOption('#pgfont', 'ATARIROM'); await p.waitForTimeout(300);
  let docf = await p.evaluate(() => XW.doc.map((d) => d.font || ''));
  assert.deepStrictEqual(docf, ['ATARIROM', ''], JSON.stringify(docf));
  ok('selecting a font sets it for the caret paragraph only: ' + JSON.stringify(docf));
  // the page-view glyph for 'a' is the FNT row data (screen code 65 for ASCII 97)
  const rows = await p.evaluate(() => PG.faceRows('ATARIROM', 97));
  const fnt = fs.readFileSync(path.join(WEB, 'library/fonts/local/atarirom.fnt'));
  assert.deepStrictEqual(rows, Array.from(fnt.slice(97 * 8, 97 * 8 + 8)));
  ok('glyph rows for "a" equal the charset bytes: ' + rows.map((r) => r.toString(16).padStart(2, '0')).join(' '));
  await p.screenshot({ path: path.join(OUT, 'xcwf-1-font.png') });
  // CWD round trip keeps one font per paragraph (CPG1 tag 3 records)
  const bytes = await p.evaluate(() => Array.from(XCW.save(XW.doc, 'cwd', { page: XW.page }).bytes));
  const s = Buffer.from(bytes).toString('latin1');
  assert(s.includes('ATARIROM'), 'font name in the trailer'); ok('CWD trailer carries the font name');
  const back = await p.evaluate((a) => { const o = XCW.openDoc(new Uint8Array(a), 'x.cwd'); return o.paras.map((q) => q.font || ''); }, bytes);
  assert.deepStrictEqual(back, ['ATARIROM', '']); ok('re-open: ' + JSON.stringify(back));
  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close(); srv.close(); console.log('xcwriter-font-test: all passed');
})().catch((e) => { console.error(e); process.exit(1); });

