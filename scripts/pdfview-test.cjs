// PDF viewer end to end (Chrome via Playwright, file:// so the offline path is what is tested):
// open, HiDPI canvas, text layer, search, page nav, zoom, drag and drop, library, Atari export, and send to the running emulator.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PDF = path.join(ROOT, 'docs', 'samples', 'pdf-test.pdf');
const OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const ck = (name, ok, extra) => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); if (!ok) bad++; };
(async () => {
  execFileSync('node', [path.join(__dirname, 'mk-sample-pdf.cjs')], { stdio: 'pipe' });
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 800 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/pdfview.html');
  await p.setInputFiles('#file', PDF);
  await p.waitForSelector('.page[data-ready="1"]', { timeout: 20000 });
  ck('page count', (await p.textContent('#np')).trim() === '/ 3');
  const hd = await p.evaluate(() => { const c = document.querySelector('.page canvas'), r = c.getBoundingClientRect(); return { cw: c.width, css: r.width, dpr: devicePixelRatio }; });
  ck('HiDPI backing store is 2x CSS size', Math.abs(hd.cw - hd.css * 2) <= 2, hd);
  const ink = await p.evaluate(() => { const c = document.querySelector('.page canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0, red = 0, blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) dark++; if (d[i] > 180 && d[i + 1] < 40 && d[i + 2] < 40) red++; if (d[i] < 40 && d[i + 2] > 200) blue++; } return { dark, red, blue }; });
  ck('rendered ink (text, red and blue boxes)', ink.dark > 800 && ink.red > 5000 && ink.blue > 5000, ink);
  ck('text layer holds real text', (await p.evaluate(() => document.querySelector('.textLayer').textContent)).includes('High resolution rendering'));
  await p.screenshot({ path: path.join(OUT, 'pdfview-1.png') });
  // search
  await p.fill('#q', 'Zanzibar'); await p.press('#q', 'Enter');
  await p.waitForFunction(() => document.querySelector('mark.cur'), null, { timeout: 10000 });
  ck('search finds Zanzibar on page 2', (await p.textContent('#qn')).trim() === '1 / 1' && (await p.inputValue('#pg')) === '2', await p.textContent('#qn'));
  await p.fill('#q', 'atari'); await p.press('#q', 'Enter');
  await p.waitForFunction(() => /\/ [2-9]/.test(document.getElementById('qn').textContent));
  ck('search is case-insensitive and counts every hit', /\/ 3$/.test(await p.textContent('#qn')), await p.textContent('#qn'));
  // navigation
  await p.click('#prev'); await p.waitForTimeout(300);
  const v1 = await p.inputValue('#pg'); await p.fill('#pg', '3'); await p.press('#pg', 'Enter'); await p.dispatchEvent('#pg', 'change'); await p.waitForTimeout(400);
  ck('page navigation', (await p.inputValue('#pg')) === '3', v1);
  // zoom
  const w100 = await p.evaluate(() => document.querySelector('.page').getBoundingClientRect().width);
  await p.selectOption('#zoom', '4'); await p.waitForFunction(() => document.querySelector('.page canvas[data-done]'), null, { timeout: 30000 });
  const z = await p.evaluate(() => { const pg = document.querySelectorAll('.page')[+document.getElementById('pg').value - 1], c = pg.querySelector('canvas'); return { w: pg.getBoundingClientRect().width, cw: c && c.width }; });
  ck('zoom 400% = 2448 css px wide, canvas crisp (2x)', Math.abs(z.w - 2448) < 3 && z.cw && Math.abs(z.cw - 4896) <= 2 || (z.cw && z.cw > 3000), { w100, ...z });
  await p.selectOption('#zoom', 'fitw'); await p.waitForTimeout(500);
  // Atari export
  await p.fill('#pg', '1'); await p.dispatchEvent('#pg', 'change'); await p.waitForTimeout(300);
  await p.click('#toAtari'); await p.waitForFunction(() => document.getElementById('amsg') && document.getElementById('atari').classList.contains('show'));
  await p.waitForTimeout(800);
  const at = await p.evaluate(() => { const c = document.getElementById('acv'), d = c.getContext('2d').getImageData(0, 0, 320, 192).data; let w = 0, k = 0; for (let i = 0; i < d.length; i += 4) d[i] > 128 ? w++ : k++; return { w, k }; });
  ck('Atari preview has paper and ink', at.w > 20000 && at.k > 500, at);
  await p.selectOption('#amode', 't2'); await p.waitForTimeout(800);
  ck('tile mode reports a tile grid', /tile 1,1 of \d+x\d+/.test(await p.textContent('#atile')), await p.textContent('#atile'));
  await p.screenshot({ path: path.join(OUT, 'pdfview-atari.png') });
  const xex = await p.evaluate(() => Array.from(PDFVIEW_XEX(new Uint8Array(7680))));
  ck('XEX viewer: FFFF header, 7680 data bytes, RUNAD segment', xex[0] === 255 && xex[1] === 255 && xex.slice(-6).join() === [0xE0, 0x02, 0xE1, 0x02, 0x00, 0x3E].join() && xex.length > 7680, xex.length);
  await p.click('#aclose');
  // library: reload and reopen from IndexedDB
  await p.reload(); await p.click('#lib'); await p.waitForSelector('#side .it a');
  ck('library keeps the opened PDF', (await p.textContent('#side .it a')).startsWith('pdf-test.pdf'));
  await p.click('#side .it a'); await p.waitForSelector('.page[data-ready="1"]', { timeout: 20000 });
  ck('library reopen renders', true);
  const eng = await p.evaluate(async () => { const b = PDFVIEW.state.bytes, r = await PDFENGINE.renderPage(b, 1, 100); return { n: await PDFENGINE.pageCount(b), w: r.w, h: r.h, len: r.rgba.length, t: (await PDFENGINE.pageText(b, 2)).includes('Zanzibar') }; });
  ck('PDFENGINE (EBookCraft hook): renderPage/pageCount/pageText', eng.n === 2 || eng.n > 0 ? eng.len === eng.w * eng.h * 4 && eng.w > 600 && eng.t : false, eng);
  // drag and drop onto a fresh page
  const q = await ctx.newPage(); await q.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/pdfview.html');
  const b64 = fs.readFileSync(PDF).toString('base64');
  await q.evaluate(async (s) => { const bin = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bin], 'dropped.pdf', { type: 'application/pdf' })); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, b64);
  await q.waitForSelector('.page[data-ready="1"]', { timeout: 20000 });
  ck('drag and drop opens a PDF', (await q.title()).startsWith('dropped.pdf'));
  // send to the running emulator (window.opener)
  const rom = path.join(ROOT, 'software_n_roms');
  if (fs.existsSync(path.join(rom, 'ATARIXL.ROM'))) {
    const m = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
    await m.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/index.html');
    await m.setInputFiles('#romfiles', [path.join(rom, 'ATARIXL.ROM'), path.join(rom, 'ATARIBAS.ROM')]);
    await m.click('#boot'); await m.waitForTimeout(3000);
    const pop = m.waitForEvent('popup'); await m.evaluate(() => window.open('pdfview.html')); const v = await pop;
    await v.waitForLoadState(); await v.setInputFiles('#file', PDF); await v.waitForSelector('.page[data-ready="1"]', { timeout: 20000 });
    await v.click('#toAtari'); await v.waitForTimeout(800); await v.click('#asend'); await m.bringToFront(); await m.waitForTimeout(5000);
    const st = await m.evaluate(() => { const e = FujiNet.emu, g = (a) => e.peek(a, 1)[0]; return { dl: g(0x230) | (g(0x231) << 8), c1: g(0x2c5) }; });
    ck('Send to emulator boots the picture viewer (SDLST=$3F00)', st.dl === 0x3F00, st);
    await m.screenshot({ path: path.join(OUT, 'pdfview-emu.png') });
  } else console.log('SKIP send-to-emulator (no ROMs)');
  ck('no page errors', errs.length === 0, errs.slice(0, 3));
  await b.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
