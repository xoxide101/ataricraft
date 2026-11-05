// xCWriter test sheet: the same sheet text as scripts/acwriter-fontsheet.cjs in Page view with the Standard face at 100/200/300 %,
// plus Atari matching 2x. Shots: out/shots/fonts/sheet-xcw-100.png / -200 / -300 / -atari2x
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(ROOT, 'out', 'shots', 'fonts');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const SHEET = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?.,:;-_()[]{}<>/\\|+=*#$%&@"\'^~',
  'Illinois 1l I1 O0 Oo gjpqy bdfhkl', 'The quick brown fox jumps over the lazy dog.', 'Pack my box with five dozen liquor jugs.',
  'Craft keeps one font per paragraph. Wrapping, tabs, margins and spelling all work on a stock Atari.',
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:' + srv.address().port + '/xcwriter.html');
  await p.click('#hnew'); await p.click('#mpg'); await p.waitForTimeout(600);
  await p.evaluate((sheet) => {
    const r = (t, sup, sub) => ({ t, b: 0, i: 0, u: 0, sup: sup || 0, sub: sub || 0 });
    const paras = [{ align: 'l', bullet: false, runs: [r('H'), r('2', 0, 1), r('O  x'), r('2', 1, 0), r(' E=mc'), r('2', 1, 0), r(' a'), r('1', 0, 1)] }]
      .concat(sheet.map((t) => ({ align: 'l', bullet: false, runs: [r(t)] })));
    XW.doc = XCW.normalize(paras);
    PG.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } });
  }, SHEET);
  const sel = await p.evaluate(() => [...document.querySelectorAll('#pgzoom option')].map((o) => o.value));
  console.log('zoom options', sel.join(' '));
  let bad = 0;
  for (const z of ['100', '200', '300']) {
    if (!sel.includes(z)) { console.log('FAIL zoom ' + z + ' not offered'); bad++; continue; }
    await p.selectOption('#pgzoom', z); await p.waitForTimeout(500);
    const ink = await p.evaluate(() => { const c = PG.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 90) n++; return n; });
    console.log((ink > 500 ? 'ok   ' : 'FAIL ') + 'page view ' + z + '%: ' + ink + ' ink pixels'); if (ink <= 500) bad++;
    await p.screenshot({ path: path.join(SHOTS, 'sheet-xcw-' + z + '.png') });
  }
  await p.click('#mat'); await p.selectOption('#atview', '2'); await p.waitForTimeout(500);
  await p.locator('#atcanvas').screenshot({ path: path.join(SHOTS, 'sheet-xcw-atari2x.png') });
  console.log('page errors:', errs);
  await b.close(); srv.close(); process.exit(bad || errs.length ? 1 : 0);
})();
