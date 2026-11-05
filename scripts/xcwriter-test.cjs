// xCWriter browser test: opens the page, imports the import samples, types, toggles modes, converts, screenshots.
// Usage: node scripts/xcwriter-test.cjs   (screenshots in out/xcw-*.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const shot = (n) => p.screenshot({ path: path.join(OUT, 'xcw-' + n + '.png') });
  const ok = (m) => console.log('ok  ' + m);
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/xcwriter.html');
  await shot('1-home');
  assert((await p.title()).includes('xCWriter'));
  ok('home screen loads');

  // every import sample opens through the file input (unknown extensions go through the format dialog)
  const dir = path.join(ROOT, 'docs/samples/import');
  const guess = (f) => (/^(letterperfect|paperclip|firstxlent|textwizard|bankstreet)/.exec(f) || [])[1];
  const opened = [];
  for (const f of fs.readdirSync(dir)) {
    await p.setInputFiles('#filein', path.join(dir, f));
    await p.waitForTimeout(150);
    if (await p.locator('#ofmt').count()) { await p.selectOption('#ofmt', guess(f) || 'auto'); await p.click('#ook'); await p.waitForTimeout(150); }
    const t = await p.evaluate(() => XCW.plain(XW.doc));
    assert(t.trim().length >= 5, f + ' opened empty');
    opened.push(f + ' (' + t.length + ')');
  }
  ok('opened ' + opened.length + ' import samples: ' + opened.join(', '));

  // new document, typing, styles, spelling
  await p.click('#bhome'); await p.click('#hnew');
  await p.click('#hq');
  await p.keyboard.type('Teh quick brown fox');
  await p.keyboard.press('Control+b'); await p.keyboard.type(' jumps'); await p.keyboard.press('Control+b');
  await p.keyboard.type(' over the lazy dog.'); await p.keyboard.press('Enter');
  await p.keyboard.type('Second paragraph, with a curly \u201cquote\u201d and an em dash \u2014 here.');
  await p.waitForTimeout(500);
  const model = await p.evaluate(() => JSON.parse(JSON.stringify(XW.doc)));
  assert.strictEqual(model.length, 2);
  assert(model[0].runs.some((r) => r.b && r.t.includes('jumps')), 'bold run');
  ok('typing + bold shape the model: ' + model[0].runs.map((r) => (r.b ? '*' : '') + r.t).join('|'));
  assert((await p.evaluate(() => XW.misses.map((m) => m.word))).includes('Teh'), 'Teh flagged');
  await p.click('#tb-c');
  const box = await p.locator('#hq p').first().boundingBox();
  await p.mouse.click(box.x + 20, box.y + 10);
  await p.waitForTimeout(300);
  await p.mouse.click(box.x + 14, box.y + 10, { button: 'right' });
  await p.waitForTimeout(300);
  const menu = await p.locator('#ctx').innerText();
  assert(/The/.test(menu), 'suggestion list has The: ' + menu);
  await shot('2-hq-menu');
  await p.locator('#ctx div', { hasText: /^The$/ }).click();
  await p.waitForTimeout(300);
  assert((await p.evaluate(() => XCW.plain(XW.doc))).startsWith('The quick'), 'suggestion applied');
  ok('spell squiggle + right-click suggestion replaced Teh with The');
  await shot('3-hq');

  await p.evaluate(() => XW.api.doUndo(false));
  assert((await p.evaluate(() => XCW.plain(XW.doc))).startsWith('Teh quick'), 'undo');
  await p.evaluate(() => XW.api.doUndo(true));
  assert((await p.evaluate(() => XCW.plain(XW.doc))).startsWith('The quick'), 'redo');
  ok('undo/redo');

  await p.keyboard.press('Control+f'); await p.fill('#fq', 'lazy'); await p.fill('#fr', 'sleepy'); await p.click('#frall');
  assert((await p.evaluate(() => XCW.plain(XW.doc))).includes('sleepy dog'), 'replace all');
  await p.click('#fclose');
  ok('find/replace');

  // matching mode
  await p.click('#mat'); await p.waitForTimeout(400);
  assert(await p.evaluate(() => document.body.classList.contains('m-atari')));
  const plain = await p.evaluate(() => XCW.plain(XW.doc));
  assert(!/[\u201c\u201d\u2014]/.test(plain), 'non-Atari characters transliterated on entering matching mode');
  await p.click('#atcanvas'); await p.keyboard.press('Control+End');
  await p.keyboard.type(' Typed on the Atari screen.'); await p.keyboard.press('Control+b'); await p.keyboard.type(' bold');
  await p.waitForTimeout(300);
  await shot('4-atari');
  const info = await p.evaluate(() => ({ fit: document.getElementById('fittext').innerText, lines: AT.lines().length, widths: AT.lines().map((l) => l.cells.length) }));
  assert(info.widths.every((w) => w <= 64), 'no line wider than 64 columns');
  ok('matching mode: ' + info.lines + ' lines, widest ' + Math.max(...info.widths) + ' cols, meter "' + info.fit + '"');

  const rt = await p.evaluate(() => {
    const a = XCW.save(XW.doc, 'cwd').bytes, r = XCW.openDoc(a, 'x.cwd'), b = XCW.save(r.paras, 'cwd').bytes;
    const sig = (d) => JSON.stringify(XCW.atariLines(d).map((l) => l.cells.map((c) => c.ch + c.b + c.i + c.u).join('')));
    return { same: Array.from(a).join() === Array.from(b).join(), lines: sig(XW.doc) === sig(r.paras), n: a.length };
  });
  assert(rt.same && rt.lines, 'CWD round trip ' + JSON.stringify(rt));
  ok('matching-mode .CWD round trip identical (' + rt.n + ' bytes, same screen lines)');

  await p.selectOption('#themesel', 'amber'); await p.waitForTimeout(200); await shot('5-amber');
  await p.evaluate(() => { const t = 'The quick brown fox jumps over the lazy dog. '.repeat(400); XW.doc = XCW.normalize([{ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }]); XW.docVer++; AT.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } }); });
  await p.waitForTimeout(300);
  assert(/over/.test(await p.locator('#warns').innerText()), 'over-limit warning');
  assert((await p.locator('#meter.over').count()) === 1, 'meter over');
  await shot('6-overflow');
  ok('over-limit document: red meter and warning');

  await p.selectOption('#themesel', 'paper');
  await p.setInputFiles('#filein', path.join(ROOT, 'docs/samples/ACWRITER-DEMO.CWD'));
  await p.waitForTimeout(300); await shot('7-demo-atari');
  await p.click('#mhq'); await p.waitForTimeout(400); await shot('8-demo-hq');
  assert((await p.evaluate(() => XW.doc.length)) > 3);
  ok('mode switch keeps the document');

  const src = '../ACWRITER-DEMO.CWD';
  for (const fmt of ['rtf', 'cwd', 'docx']) {
    await p.click('#bconv');
    await p.setInputFiles('#cfile', path.join(dir, src));
    await p.selectOption('#cout', fmt); await p.waitForTimeout(200);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#cgo')]);
    const f = path.join(OUT, 'xcw-convert.' + fmt); await dl.saveAs(f);
    const head = fs.readFileSync(f).subarray(0, 5).toString('latin1'), sig = { rtf: '{\\rtf', cwd: 'CRFT', docx: 'PK' }[fmt];
    assert(head.startsWith(sig), fmt + ' header ' + JSON.stringify(head));
    if (fmt === 'cwd') await shot('9-convert');
    ok('convert ' + src + ' -> ' + fmt + ' (' + fs.statSync(f).size + ' bytes; ' + (await p.locator('#crep').innerText()).replace(/\s+/g, ' ').slice(0, 100) + ')');
    await p.click('#cclose');
  }

  await p.click('#bsave'); await p.selectOption('#sfmt', 'atascii'); await p.waitForTimeout(150);
  const rep = await p.locator('#srep').innerText();
  assert(/dropped for ATASCII|Nothing is lost|become/.test(rep), 'drop report: ' + rep);
  await shot('10-save'); await p.click('#scancel');
  await p.click('#tb-send'); await p.waitForTimeout(1200);
  assert(/emulator/i.test(await p.locator('#toast').innerText()));
  ok('Send to Atari reports no emulator tab; ATASCII drop report shown');

  // in-page export -> import round trips (browser bundle) on the document just edited
  const rtr = await p.evaluate(() => {
    const doc = XW.doc, base = XCW.plain(doc), out = {};
    for (const f of ['rtf', 'html', 'docx', 'md', 'cwd', 'text', 'atascii']) {
      const r = XCW.save(doc, f), back = XCW.openDoc(r.bytes, 'rt.' + (f === 'text' ? 'txt' : f === 'atascii' ? 'atascii' : f));
      out[f] = [XCW.plain(back.paras).replace(/\s+/g, ' ').trim() === base.replace(/\s+/g, ' ').trim(), r.bytes.length];
    }
    return out;
  });
  for (const f of ['rtf', 'html', 'docx', 'md']) assert(rtr[f][0], f + ' export->import changed the text in the page');
  ok('in-page export->import keeps text for rtf/html/docx/md; ' + Object.entries(rtr).map(([k, v]) => k + ':' + (v[0] ? 'same' : 'differs(lossy)')).join(' '));
  for (const [f, label] of [['rich.docx', 'Word docx'], ['rich.rtf', 'Word RTF'], ['rich.doc', 'Word doc']]) {
    await p.setInputFiles('#filein', path.join(ROOT, 'docs/samples/word', f)); await p.waitForTimeout(300);
    const t = await p.evaluate(() => XCW.plain(XW.doc));
    assert(/Quarterly Report/.test(t) && /First bullet/.test(t) && /Name \| Qty \| Price/.test(t), label + ' import lost text/table: ' + t.slice(0, 120));
  }
  ok('Word-made .docx/.rtf/.doc import with headings, bullets and table rows as text');
  // mixed-font docx (scripts/mkmixeddoc.ps1): one font per paragraph, the dominant one by characters, and a warning toast
  await p.setInputFiles('#filein', path.join(ROOT, 'docs/samples/word/mixed-fonts.docx')); await p.waitForTimeout(400);
  const mx = await p.evaluate(() => ({ t: XCW.plain(XW.doc), toast: document.body.innerText }));
  assert(/Arial dominant/.test(mx.t) && /Only Courier New here/.test(mx.t), 'mixed docx text: ' + mx.t);
  assert(/2 paragraph\(s\) mix fonts on one line/.test(mx.toast), 'mixed-font warning not shown');
  const mi = require('../tools/craftimport.cjs').toModel(fs.readFileSync(path.join(ROOT, 'docs/samples/word/mixed-fonts.docx')), 'mixed-fonts.docx');
  assert.deepStrictEqual(mi.paras.map((q) => q.srcFont), ['Arial', 'Times New Roman', 'Courier New', 'Arial']); assert.strictEqual(mi.mixedFonts, 2);
  ok('mixed-font Word docx: dominant font per paragraph (Arial, Times New Roman, Courier New, Arial) and the "2 paragraph(s) mix fonts" warning');
  await p.click('#bhelp'); await shot('11-help');
 await p.click('#bhome'); await shot('12-home-recent');
  assert((await p.locator('#recent .card').count()) >= 1, 'recent docs');
  ok('help + recent documents');
  assert.strictEqual(errs.length, 0, 'page errors: ' + errs.join(' | '));
  await b.close();
  console.log('xcwriter-test: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
