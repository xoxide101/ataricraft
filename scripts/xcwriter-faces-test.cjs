// xCWriter typeface system test (web/js/xcwriter/faces.js): the picker lists Craft faces, shipped fonts, the Atari ROM charset and the
// personal fonts; a face changes the pixels in Page view, High quality and Atari matching; per-paragraph fonts survive .CWD.
// Serves web/ over http (the manifest cannot load from file://). Screenshots: out/shots/fonts/*.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'out', 'shots', 'fonts'), WEB = path.join(ROOT, 'web');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };
const SAMPLE = 'The quick brown fox jumps over the lazy dog 0123';
const para = (t, font) => Object.assign({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }, font ? { font } : {});
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const base = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (m) => console.log('ok  ' + m);
  const shot = (n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  await p.goto(base + 'xcwriter.html');
  await p.click('#hnew'); await p.click('#mpg'); await p.waitForTimeout(800);

  // (a) the picker lists everything
  const opts = await p.evaluate(() => [...document.querySelectorAll('#pgfont optgroup')].map((g) => ({ g: g.label, o: [...g.children].map((o) => o.value) })));
  const all = opts.flatMap((g) => g.o), groups = opts.map((g) => g.g);
  for (const id of ['CRAFT12', 'CRAFT10', 'CRAFT8', 'CRAFT6', 'CRAFT5', 'CRAFT4', 'ATARIROM', 'ATARI8BI', 'FONT']) assert(all.includes(id), id + ' listed: ' + all);
  for (const g of ['Craft faces', 'Shipped', 'Atari ROM', 'Personal']) assert(groups.includes(g), 'group ' + g + ' in ' + groups);
  assert(await p.isVisible('#pgfont'), 'typeface control visible in the toolbar');
  ok('picker groups ' + groups.join(' / ') + ', ' + all.length + ' faces');
  await p.evaluate(() => { const s = document.getElementById('pgfont'); s.size = Math.min(s.options.length + s.querySelectorAll('optgroup').length, 34); s.style.cssText = 'position:fixed;z-index:99;top:100px;left:20px;height:640px;max-width:420px'; });
  await shot('1-font-picker-list');
  await p.evaluate(() => { const s = document.getElementById('pgfont'); s.size = 1; s.style.cssText = ''; });

  // (b) the same text in several faces: pixels differ in every view
  const faces = ['', 'CRAFT12', 'CRAFT10', 'CRAFT8', 'ATARIROM', 'ATARI8BI', 'FONT'];
  await p.evaluate(async (ids) => { for (const i of ids) if (i) { XFACE.use(i); await XFACE.load(XFACE.get(i)); if (XFACE.get(i).state !== 'ready') throw new Error(i + ' ' + XFACE.get(i).error); } }, faces);
  const pageHash = async (face) => {
    await p.evaluate(([t, f]) => { XW.doc = XCW.normalize([{ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }], ...(f ? { font: f } : {}) }]); PG.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } }); }, [SAMPLE, face]);
    await p.evaluate(() => PG.render()); await p.waitForTimeout(250);
    return p.evaluate(() => { const c = PG.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, h = 7; for (let k = 0; k < d.length; k += 4) if (d[k] < 90) { n++; h = (h * 31 + k) >>> 0; } return { n, h }; });
  };
  const ph = []; for (const f of faces) ph.push(await pageHash(f));
  assert(ph.every((x) => x.n > 150), 'every face has ink in Page view: ' + JSON.stringify(ph));
  assert.strictEqual(new Set(ph.map((x) => x.h)).size, faces.length, 'page view: each face draws different pixels');
  ok('page view: ' + faces.length + ' faces, ' + faces.length + ' different pixel patterns (ink px ' + ph.map((x) => x.n).join(',') + ')');

  // stacked sample paragraphs, one face each (never mid-line)
  await p.evaluate(([t, ids]) => { XW.doc = XCW.normalize(ids.map((f) => ({ align: 'l', bullet: false, runs: [{ t: (f || 'Standard') + ': ' + t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }], ...(f ? { font: f } : {}) }))); PG.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } }); }, [SAMPLE, faces]);
  await p.selectOption('#pgzoom', '100'); await p.waitForTimeout(300);
  await shot('2-page-view-same-text-in-7-fonts');
  const dims = await p.evaluate(() => PG.lines().map((l) => ({ f: (XW.doc[l.p].font || 'std'), cw: l.cw, h: l.h })));
  const by = (f) => dims.find((d) => d.f === f);
  assert(by('CRAFT12').cw > by('CRAFT10').cw && by('CRAFT10').cw > by('CRAFT8').cw && by('CRAFT8').cw > by('std').cw, 'cell widths grow 4x7 < 8 < 10 < 12: ' + JSON.stringify(dims.map((d) => d.f + ':' + d.cw)));
  assert(by('CRAFT12').h === 12 && by('CRAFT10').h === 12 && by('CRAFT8').h === 8 && by('std').h === 8, 'line heights follow cell heights');
  ok('page view cell sizes proportional: ' + [...new Set(dims.map((d) => d.f + ' ' + d.cw + 'x' + d.h))].join(', '));

  // (c) per-paragraph fonts, saved and reloaded through .CWD (CPG1 tags 2/3)
  await p.evaluate(([mk]) => { XW.doc = XCW.normalize([['CRAFT12', 'Heading in Craft 12x12'], ['', 'Standard body text keeps the 64 column ACWriter look.'], ['CRAFT8', 'Atari 8x8 native paragraph, one font for the whole line.'], ['ATARI8BI', 'Atari8bit.ttf converted to the 12x12 master.'], ['ATARIROM', 'ROM charset paragraph.']].map(([f, t]) => ({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }], ...(f ? { font: f } : {}) }))); PG.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } }); }, [0]);
  await p.waitForTimeout(300);
  await shot('3-page-view-per-paragraph-fonts');
  const mixed = await p.evaluate(() => XW.doc.map((d) => d.font || ''));
  const bytes = await p.evaluate(() => Array.from(XCW.save(XW.doc, 'cwd', { page: XW.page }).bytes));
  const back = await p.evaluate((a) => XCW.openDoc(new Uint8Array(a), 'x.cwd').paras.map((q) => q.font || ''), bytes);
  assert.deepStrictEqual(back, mixed); ok('.CWD round trip keeps per-paragraph fonts ' + JSON.stringify(back));
  const s = Buffer.from(bytes).toString('latin1'); assert(s.includes('CRAFT12') && s.includes('ATARI8BI'), 'font names in the CPG1 trailer');

  // Atari matching: ACWriter's 1x screen draws the standard 4x7 font for every paragraph (as the 6502 does); the 2x PAGE zoom shows the 8x8 faces
  await p.click('#mat'); await p.waitForTimeout(500);
  const atHash = () => p.evaluate(() => { const c = AT.canvas, d = c.getContext('2d').getImageData(0, 0, 320, 192).data; let h = 7, n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 90) { n++; h = (h * 31 + k) >>> 0; } return { n, h }; });
  await p.selectOption('#atview', '2'); await p.waitForTimeout(300);
  assert(await p.evaluate(() => AT.view2), 'atari 2x view on');
  const ah = [];
  for (const f of ['', 'CRAFT8', 'ATARIROM', 'ATARI8BI', 'FONT']) {
    await p.evaluate(([t, f]) => { XW.doc = XCW.normalize([{ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }], ...(f ? { font: f } : {}) }]); AT.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } }); AT.setView2(true); }, [SAMPLE.slice(0, 18), f]);
    await p.waitForTimeout(250); ah.push(await atHash());
  }
  assert(ah.every((x) => x.n > 100), 'atari ink ' + JSON.stringify(ah));
  assert(new Set(ah.map((x) => x.h)).size >= 4, 'atari 2x: faces differ ' + JSON.stringify(ah));
  ok('atari matching 2x: ' + ah.length + ' faces, ' + new Set(ah.map((x) => x.h)).size + ' different pixel patterns (the standard face is the ROM charset)');
  await p.evaluate(() => { XW.doc = XCW.normalize([['CRAFT8', 'Craft 8x8 native'], ['', 'ROM charset default'], ['ATARI8BI', 'Atari8bit.ttf face'], ['FONT', 'FONT.FNT personal']].map(([f, t]) => ({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }], ...(f ? { font: f } : {}) }))); AT.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 3, o: 0 } }); AT.setView2(true); });
  await p.waitForTimeout(300);
  await shot('3b-atari-matching-2x-per-paragraph-fonts');
  await p.selectOption('#atview', '1'); await p.waitForTimeout(300);
  await shot('3c-atari-matching-1x');

  // High quality: the face is a web font on its paragraphs and differs from the standard text
  await p.click('#mhq'); await p.waitForTimeout(1500);
  const hq = await p.evaluate(() => [...document.querySelectorAll('#hq p')].map((e) => [e.dataset.font || '', e.style.fontFamily, e.style.fontSize]));
  assert.strictEqual(hq[0][0], 'CRAFT8'); assert(/XC[FV]_CRAFT8/.test(hq[0][1]), 'HQ paragraph 0 web font: ' + JSON.stringify(hq));
  assert(/XC[FV]_ATARI8BI/.test(hq[2][1]), 'HQ paragraph 2 Atari8bit: ' + JSON.stringify(hq));
  const loaded = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded' && /XC[FV]_/.test(f.family)).length);
  assert(loaded >= 3, 'web fonts loaded ' + loaded);
  const buf = async (i) => crypto.createHash('md5').update(await p.locator('#hq p').nth(i).screenshot()).digest('hex');
  assert.notStrictEqual(await buf(0), await buf(1)); ok('high quality: ' + loaded + ' face web fonts loaded, face paragraphs render differently');
  await shot('4-high-quality-per-paragraph-fonts');

  // the toolbar control works in high quality and the model keeps it
  await p.click('#hq'); await p.evaluate(() => HQ.setSel({ p: 1, o: 2 })); await p.selectOption('#pgfont', 'CRAFT10'); await p.waitForTimeout(600);
  const f2 = await p.evaluate(() => XW.doc.map((d) => d.font || ''));
  assert.strictEqual(f2[1], 'CRAFT10', JSON.stringify(f2) + ' sel ' + JSON.stringify(await p.evaluate(() => HQ.getSel()))); ok('toolbar typeface works in high quality: ' + JSON.stringify(f2));
  const hq2 = await p.evaluate(() => XW.doc.map((d) => d.font || ''));
  await p.keyboard.type('x'); assert.deepStrictEqual(await p.evaluate(() => XW.doc.map((d) => d.font || '')), hq2); ok('typing keeps the font records aligned');

  // a font saved by the font editor appears without a rebuild
  await p.evaluate(() => { const f = XCW.Font.parse(Uint8Array.from(atob(localStorage.getItem('x') || ''), (c) => c.charCodeAt(0))); return f; }).catch(() => {});
  const acf = fs.readFileSync(path.join(ROOT, 'font', 'craft6.acf')).toString('base64');
  await p.evaluate((a) => { localStorage.setItem('craft.userfonts', JSON.stringify({ MYEDIT: a })); window.dispatchEvent(new StorageEvent('storage', { key: 'craft.userfonts' })); }, acf);
  await p.waitForTimeout(300);
  assert(await p.evaluate(() => XFACE.list().some((f) => f.id === 'MYEDIT' && f.group.includes('Font editor'))), 'editor font listed');
  assert(await p.evaluate(() => [...document.querySelectorAll('#pgfont option')].some((o) => o.value === 'MYEDIT')), 'editor font in picker');
  ok('a font saved by the editor (localStorage) is in the picker without a rebuild');

  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close(); srv.close(); console.log('xcwriter-faces-test: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
