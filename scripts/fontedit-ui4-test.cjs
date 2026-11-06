// Phase-4 tests (outline layer): sfnt raw contours / TTC / CFF / WOFF writers in Node, then the Outline tab from file://.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const SF = require('../tools/sfnt.cjs'), FPn = require('../tools/fontpipe.cjs'), CF = require('../tools/craftfont.cjs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
const ARIAL = 'C:/Windows/Fonts/arial.ttf', HAVE = fs.existsSync(ARIAL);
(async () => {
  // ---- node: pixel-only font -> merged square contours, TTF/OTF/WOFF round trip
  const m = CF.parse(fs.readFileSync(path.join(ROOT, 'font/craft12.acf')));
  for (const opt of [{}, { merge: true }, { merge: true, otf: true }]) {
    const bytes = FPn.toTtf(m, opt), back = FPn.fromTtfExport(bytes);
    assert.ok(back, 'readable'); assert.deepStrictEqual(back.glyphs[65], m.glyphs[65], 'A exact ' + JSON.stringify(opt));
  }
  ok('Craft 12 px -> plain / merged / merged OTF outlines -> back: exact pixels');
  if (HAVE) {
    const f = SF.parse(fs.readFileSync(ARIAL)), gid = f.gidFor(65), raw = f.raw(gid);
    assert.ok(raw.length >= 2 && raw[0].every((p) => p.length >= 3), 'raw contours of A');
    const cub = raw.map(SF.toCubic), q = cub.map(SF.toQuad);
    assert.ok(cub.length === raw.length && q.length === raw.length); ok('arial A: ' + raw.length + ' contours, toCubic/toQuad');
    const mk = (o) => SF.build({ family: 'T', upm: f.upm, ascent: f.ascent, descent: f.descent, glyphs: [{ name: 'A', cp: 65, adv: 600, contours: raw }], ...o });
    for (const [n, o] of [['ttf', {}], ['otf', { otf: true }]]) {
      const b = mk(o), g = SF.parse(b); assert.ok(g.outline(g.gidFor(65)).length, n + ' parses'); ok(n + ' build -> parse: A has outline');
    }
    const w = SF.woff(mk({})); assert.strictEqual(Buffer.from(w).slice(0, 4).toString(), 'wOFF'); assert.ok(SF.parse(w), 'woff parses'); ok('WOFF writer round trip');
  } else console.log('skip arial (not installed)');

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (mm) => { if (mm.type() === 'error') errs.push(mm.text()); });
    await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
    await p.waitForFunction(() => window.FE && FE.state.f && document.querySelectorAll('#sizes .sz').length >= 13);
    await p.evaluate(() => { localStorage.removeItem('craft.outline'); });
    const shot = (n) => p.screenshot({ path: path.join(OUT, 'ui4-' + n + '.png') });
    // pixel-only family (Craft)
    await p.evaluate(() => FE.showTab('outline'));
    await p.waitForFunction(() => FE.ol && FE.ol.glyph());
    let s = await p.evaluate(() => { const g = FE.ol.glyph(); return { n: g.contours.length, src: document.getElementById('olsrc').textContent }; });
    assert.ok(s.n >= 1, 'Craft A has square contours'); ok('Craft family: outline from pixels (' + s.src + '), A has ' + s.n + ' contour(s)');
    await shot('craft');
    if (HAVE) {
      await p.setInputFiles('#file', ARIAL);
      await p.waitForFunction(() => /arial/i.test(FE.state.fam.name || ''), null, { timeout: 20000 });
      await p.evaluate(() => { FE.showTab('outline'); FE.ol.load && FE.ol.load(); });
      await p.fill('#olchar', 'O'); await p.dispatchEvent('#olchar', 'change');
      const o = await p.evaluate(() => { const g = FE.ol.glyph(); return { n: g.contours.length, pts: g.contours.reduce((a, c) => a + c.length, 0), cp: FE.ol.cp() }; });
      assert.strictEqual(o.cp, 79); assert.ok(o.n === 2, 'O has 2 contours: ' + o.n); ok('arial O: 2 contours, ' + o.pts + ' points');
      await shot('arial-O');
      // edit: move a point, undo/redo
      const before = await p.evaluate(() => JSON.stringify(FE.ol.glyph().contours));
      await p.evaluate(() => { FE.ol.sel.clear ? FE.ol.sel.clear() : (FE.ol.sel.length = 0); FE.ol.ops.selectAll && FE.ol.ops.selectAll(); });
      await p.click('#olsel'); await p.keyboard.press('ArrowRight');
      const after = await p.evaluate(() => JSON.stringify(FE.ol.glyph().contours));
      assert.notStrictEqual(before, after, 'nudge moved points'); ok('select all + arrow nudges the outline');
      await p.click('#olundo'); assert.strictEqual(await p.evaluate(() => JSON.stringify(FE.ol.glyph().contours)), before, 'undo'); ok('undo restores');
      await p.click('#olredo'); assert.strictEqual(await p.evaluate(() => JSON.stringify(FE.ol.glyph().contours)), after, 'redo'); ok('redo');
      // rasterize this glyph at the current size
      await p.click('#olraster');
      ok('rasterize: ' + (await p.textContent('#olrinfo')));
      // export through the API, load in Chrome
      for (const fmt of ['ttf', 'otf', 'woff']) {
        const r = await p.evaluate(async (fmt) => {
          const bytes = FE.outlineExport(fmt, 'ascii', true); const ff = new FontFace('T' + fmt, bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
          await ff.load(); return { len: bytes.length, status: ff.status };
        }, fmt);
        assert.strictEqual(r.status, 'loaded'); ok(fmt + ' export (' + r.len + ' bytes) loads in Chrome FontFace');
      }
    }
    await shot('final');
    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join('; '));
    ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
