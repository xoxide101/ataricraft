// Browser test for EBookCraft: serves web/ statically, drives the real UI with Playwright, saves screenshots to out/ebc/.
// Run: node scripts/ebookcraft-browser-test.cjs   (needs Playwright + Chrome paths below; OCR step is skipped if the add-on is absent)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web'), outDir = path.join(root, 'out', 'ebc');
const pw = require(process.env.PLAYWRIGHT || 'C:/Users/raver/craftapi/node_modules/playwright-core');
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.css': 'text/css' };
fs.mkdirSync(outDir, { recursive: true });
const srv = http.createServer((q, r) => {
  const p = path.join(web, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, ''));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const br = await pw.chromium.launch({ executablePath: chrome, headless: true });
  const pg = await br.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(base + 'ebookcraft.html');
  const sample = (n) => fs.readFileSync(path.join(root, 'docs', 'samples', 'ebook', n)).toString('base64');

  // reader
  await pg.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); await EBCApp.openBytes(u, 'sampler.epub'); }, sample('sampler.epub'));
  await pg.waitForTimeout(400);
  const info = await pg.evaluate(() => ({ title: EBCApp.st.book.title, ch: EBCApp.st.book.chapters.length, toc: EBCApp.st.book.toc.length, pos: document.getElementById('pos').textContent, text: document.getElementById('flow').innerText.length }));
  ok(info.ch >= 3 && info.toc >= 3 && info.text > 200, 'epub opens in reader: ' + JSON.stringify(info));
  await pg.screenshot({ path: path.join(outDir, 'shot-reader.png') });
  const p1 = await pg.textContent('#pos'); await pg.keyboard.press('ArrowRight'); const p2 = await pg.textContent('#pos');
  ok(p1 !== p2 || /\/ 1\b/.test(p1), 'page turn: ' + p1.split('|')[0] + ' -> ' + p2.split('|')[0]);
  await pg.click('#sidetabs [data-p=find]'); await pg.fill('#q', 'Ishmael'); await pg.click('#qgo');
  const hits = await pg.locator('#sidebody a.it').count(); ok(hits > 0, 'search finds hits: ' + hits);
  await pg.click('#theme [data-t=night]'); await pg.screenshot({ path: path.join(outDir, 'shot-reader-night.png') });
  await pg.click('#theme [data-t=day]'); await pg.click('#addbm'); await pg.waitForTimeout(100);
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('ebc.bm.' + EBCApp.st.book.id)).length === 1), 'bookmark saved to localStorage');
  const saved = await pg.evaluate(() => localStorage.getItem('ebc.pos.' + EBCApp.st.book.id)); ok(!!saved, 'position saved: ' + saved);
  await pg.click('#viewsel [data-v=atari]'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(outDir, 'shot-atari-view.png') });
  const dark = await pg.evaluate(() => { const c = document.getElementById('acv'), d = c.getContext('2d').getImageData(0, 0, 320, 192).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; });
  ok(dark > 500, 'atari view draws text pixels: ' + dark);
  await pg.click('#viewsel [data-v=hq]');

  // convert 1-bit from a scanned PNG, then OCR
  await pg.click('#tabs [data-tab=conv]');
  await pg.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); await EBCApp.addInputs([new File([u], 'scan-page.png')]); }, sample('scan-page.png'));
  const ocrAvail = await pg.evaluate(() => EBC.ocr.available());
  await pg.check('#o-deskew'); await pg.check('#o-g4'); if (ocrAvail) await pg.check('#o-ocr');
  await pg.click('#run');
  await pg.waitForSelector('#pagegrid img', { timeout: ocrAvail ? 120000 : 30000 });
  await pg.waitForFunction(() => /done in/.test(document.getElementById('log').textContent), null, { timeout: 120000 });
  const res = await pg.evaluate(() => ({ files: EBCApp.st.result.files.map((f) => f.path), ocr: EBCApp.st.result.manifest.ocr, report: EBCApp.st.result.report }));
  ok(res.files.some((f) => /pages\/atari-bw\//.test(f)) && res.files.some((f) => /\.atr$/.test(f)), 'convert produced 1-bit pages and ATR (' + res.files.length + ' files)');
  await pg.screenshot({ path: path.join(outDir, 'shot-convert.png') });
  await pg.locator('#pagegrid').scrollIntoViewIfNeeded();
  if (ocrAvail) {
    ok(res.ocr.ran && res.ocr.meanConfidence > 70, 'browser OCR ran: ' + JSON.stringify(res.ocr));
    const t = await pg.inputValue('#ocrtext'); ok(/Moby|whale|Austen|Dickens|truth|times/i.test(t), 'OCR text recognisable: ' + t.slice(0, 80).replace(/\s+/g, ' '));
    await pg.locator('#ocrtext').scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(outDir, 'shot-ocr.png') });
  } else console.log('SKIP browser OCR (add-on not installed)');
  const bw = res.files.find((f) => /atari-bw\/p001/.test(f));
  const png = await pg.evaluate((p) => { const f = EBCApp.st.result.files.find((x) => x.path === p); return btoa(String.fromCharCode(...f.bytes.slice(0, 100000))); }, bw);
  fs.writeFileSync(path.join(outDir, 'shot-bw-page.png'), Buffer.from(png, 'base64'));
  // scanned PDF through the pdf.js engine (js/pdfjs, vendored by the PDF viewer) when present
  const pdfRes = await pg.evaluate(async (b) => {
    const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const r = await EBC.pack.convert([{ name: 'scan-page.pdf', bytes: u }], { text: false, bw: true, atr: false, xex: false, textdisk: false, bundle: false, print: false, tiles: 0 }, () => {});
    return { engine: !!EBC.pdf.engine, files: r.files.map((f) => f.path), report: r.report };
  }, sample('scan-page.pdf'));
  ok(pdfRes.files.some((f) => /atari-bw\/p001/.test(f)), 'scanned PDF converts in the browser (pdf.js engine: ' + pdfRes.engine + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
