// Phase-3 tests (pixel layer): hinting-lite derive options, per-glyph overrides that survive "Re-render all sizes", override diff
// highlight, re-render glyph, draggable guides, onion skin, reference ghost, kerning classes. Runs from file://; screenshots in out/ui3-*.png.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const CF = require('../tools/craftfont.cjs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
(async () => {
  // node level: the new derive options
  const m = CF.parse(fs.readFileSync(path.join(ROOT, 'font/craft12.acf')));
  const d0 = CF.derive(m, 8, {}), dw = CF.derive(m, 8, { weight: 1 }), dl = CF.derive(m, 8, { weight: -1 }), dx = CF.derive(m, 8, { snapX: true });
  const px = (f) => f.glyphs.reduce((n, g) => n + (g || []).reduce((k, v) => { let c = 0; for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, v, q)) c++; return k + c; }, 0), 0);
  assert.ok(px(dw) > px(d0) && px(dl) < px(d0), 'weight +1 adds and -1 removes pixels: ' + [px(dl), px(d0), px(dw)]); ok('weight option: lighter ' + px(dl) + ' < normal ' + px(d0) + ' < bolder ' + px(dw) + ' pixels (8 px)');
  const top = (f, s) => f.glyphs[s].findIndex((v) => v), xs = 'a'.charCodeAt(0); let differs = 0;
  for (const sz of [14, 16, 20, 22, 26]) { const a = CF.derive(m, sz, {}), c = CF.derive(m, sz, { snapX: true }); assert.strictEqual(top(c, c.map[xs]), c.xTop, 'snapX at ' + sz); if (top(a, a.map[xs]) !== a.xTop) differs++; }
  assert.strictEqual(differs, 5, 'plain derive misses the x-height somewhere'); void dx; ok('snapX: lowercase a top lands on the target x-height at 14/16/20/22/26 px (plain derive is one row too high at ' + differs + ' of 5)');
  assert.deepStrictEqual(CF.derive(m, 8, {}).glyphs[65], CF.derive(m, 8, { snapBase: false }).glyphs[65]); ok('derive without new options is unchanged');

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (mm) => { if (mm.type() === 'error') errs.push(mm.text()); });
    await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
    await p.waitForFunction(() => window.FE && FE.state.f && document.querySelectorAll('#sizes .sz').length >= 13);
    await p.evaluate(() => { localStorage.removeItem('craft.ovr'); localStorage.setItem('craft.hint', '1'); });
    await p.reload(); await p.waitForFunction(() => window.FE && FE.state.f);
    const shot = (n) => p.screenshot({ path: path.join(OUT, 'ui3-' + n + '.png') });
    await p.evaluate(() => FE.showTab('edit'));
    await p.click('#sizes .sz[data-size="8"]');
    assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 8);
    // 1. hand edit -> override
    const A = await p.evaluate(() => { const f = FE.state.f; FE.select(f.map[65]); return f.map[65]; });
    const before = await p.evaluate((a) => FE.state.f.glyphs[a].slice(), A);
    const box = await p.locator('#edit').boundingBox(), E = await p.evaluate(() => FE.state.zoom || Math.floor(document.getElementById('edit').width / (FE.state.f.adv)));
    const cell = await p.evaluate(() => { const c = document.getElementById('edit'), r = c.getBoundingClientRect(), E = c.width / FE.CF.colsOf(FE.state.f, FE.state.slot); return { x: r.left, y: r.top, E: E * r.width / c.width }; });
    let hit = null;
    for (let r = 0; r < 8 && !hit; r++) for (let q = 0; q < 8 && !hit; q++) if (!(await p.evaluate(([a, rr, qq]) => FE.CF.hasPx(FE.state.f, FE.state.f.glyphs[a][rr], qq), [A, r, q]))) hit = [q, r];
    await p.mouse.click(cell.x + (hit[0] + 0.5) * cell.E, cell.y + (hit[1] + 0.5) * cell.E);
    const o1 = await p.evaluate((a) => ({ ovr: FE.isOvr(a), info: document.getElementById('ovrinfo').textContent, stored: JSON.parse(localStorage.getItem('craft.ovr') || '{}') }), A);
    assert.ok(o1.ovr, 'edited glyph is an override'); assert.match(o1.info, /1 override/); assert.deepStrictEqual(Object.values(o1.stored)[0], [A]); ok('drawing in 8 px marks glyph as override (' + o1.info + '), persisted in craft.ovr'); void box; void E;
    // 2. diff highlight
    await p.check('#bdiff'); await shot('diff');
    const green = await p.evaluate(() => { const c = document.getElementById('edit'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] > 150 && d[i + 2] < 120) n++; return n; });
    assert.ok(green > 20, 'green diff pixels ' + green); ok('diff highlight draws the hand-added pixel in green (' + green + ' px of canvas)');
    // 3. re-render all keeps override, changes the rest
    const B = await p.evaluate(() => FE.state.f.map[66]), nB = (s) => p.evaluate(([a]) => { const f = FE.state.f; let n = 0; for (const v of f.glyphs[a]) for (let q = 0; q < f.gw; q++) if (FE.CF.hasPx(f, v, q)) n++; return n; }, [s]);
    const b0 = await nB(B), a0 = await p.evaluate((a) => FE.state.f.glyphs[a].slice(), A);
    await p.selectOption('#dwt', '1'); await p.click('#brerall');
    const b1 = await nB(B), a1 = await p.evaluate((a) => FE.state.f.glyphs[a].slice(), A);
    assert.ok(b1 > b0, 'B got bolder: ' + b0 + ' -> ' + b1); assert.deepStrictEqual(a1, a0); ok('Re-render all sizes with weight bolder: B ' + b0 + ' -> ' + b1 + ' px; the overridden A is untouched');
    assert.ok(await p.evaluate(() => FE.state.fam.sizes[26].origin === 1 || FE.state.fam.sizes[26].origin === 0));
    await shot('rerender-all');
    // 4. overwrite overrides
    await p.check('#brinc'); await p.click('#brerall'); await p.uncheck('#brinc');
    const a2 = await p.evaluate((a) => ({ g: FE.state.f.glyphs[a].slice(), ovr: FE.isOvr(a) }), A);
    assert.notDeepStrictEqual(a2.g, a0); assert.ok(!a2.ovr); ok('"overwrite overrides too" re-renders A and clears its flag');
    // 5. re-render glyph button: edit again then re-render just this glyph
    await p.mouse.click(cell.x + (hit[0] + 0.5) * cell.E, cell.y + (hit[1] + 0.5) * cell.E);
    assert.ok(await p.evaluate((a) => FE.isOvr(a), A)); await p.click('#bfrommaster');
    assert.ok(!(await p.evaluate((a) => FE.isOvr(a), A))); ok('Re-render from master (selected glyph) clears the override and restores the derived pixels');
    await p.evaluate(() => FE.undo()); assert.ok(await p.evaluate(([a, r, q]) => FE.CF.hasPx(FE.state.f, FE.state.f.glyphs[a][r], q), [A, hit[1], hit[0]])); ok('re-render is one undo step (the hand-drawn pixel is back)');
    await p.selectOption('#dwt', '0'); await p.click('#bovrmark');
    assert.ok(await p.evaluate((a) => FE.isOvr(a), A)); await p.click('#bovrclear'); assert.ok(!(await p.evaluate((a) => FE.isOvr(a), A))); ok('Mark / Clear override buttons');
    // 6. draggable guides (x-height + baseline)
    await p.evaluate(() => FE.select(FE.state.f.map[65]));
    const g0 = await p.evaluate(() => ({ x: FE.state.f.xTop, h: FE.state.f.head, b: FE.state.f.base }));
    const rb = await p.evaluate(() => { const r = document.getElementById('ruler').getBoundingClientRect(), c = document.getElementById('ruler'); const E = r.height / FE.state.f.rows; return { x: r.left + 5, y: r.top, E }; });
    await p.mouse.move(rb.x, rb.y + g0.x * rb.E); await p.mouse.down(); await p.mouse.move(rb.x, rb.y + (g0.x - 1) * rb.E + 1, { steps: 4 }); await p.mouse.up();
    const g1 = await p.evaluate(() => ({ x: FE.state.f.xTop })); assert.strictEqual(g1.x, g0.x - 1); ok('dragging the x-height guide in the ruler moves it (' + g0.x + ' -> ' + g1.x + ')');
    await p.evaluate(() => FE.undo());
    // 7. onion skin
    await p.selectOption('#onion', 'larger');
    const blue = await p.evaluate(() => { const c = document.getElementById('edit'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 40 && d[i + 2] > 150) n++; return n; });
    assert.ok(blue > 50, 'onion pixels ' + blue); ok('onion skin of the larger size draws a blue layer (' + blue + ' px)'); await shot('onion'); await p.selectOption('#onion', 'off');
    // 8. ghost of a reference TTF
    if (fs.existsSync('C:/Windows/Fonts/arial.ttf')) {
      const bytes = [...fs.readFileSync('C:/Windows/Fonts/arial.ttf')];
      const cnt = () => p.evaluate(() => { const c = document.getElementById('edit'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return s.size; });
      const c0 = await cnt(); assert.ok(await p.evaluate(async (a) => FE.setRef(a, 'arial.ttf'), bytes));
      const c1 = await cnt(); assert.ok(c1 > c0, 'ghost adds colours ' + c0 + ' -> ' + c1); await shot('ghost'); ok('ghost: live outline of arial.ttf drawn behind the pixels (' + c0 + ' -> ' + c1 + ' distinct colours)');
      await p.evaluate(() => { document.getElementById('gshow').checked = false; document.getElementById('gshow').dispatchEvent(new Event('change')); });
    } else console.log('skip ghost (no arial.ttf)');
    // 9. kerning classes
    await p.evaluate(() => FE.showTab('kern'));
    await p.click('#kclasses summary'); await p.fill('#kcname', 'A'); await p.selectOption('#kcside', 'L'); await p.fill('#kcmem', 'AÀ'); await p.click('#kcadd');
    await p.fill('#kcname', 'V'); await p.selectOption('#kcside', 'R'); await p.fill('#kcmem', 'VWY'); await p.click('#kcadd');
    await p.selectOption('#kcl', 'A'); await p.selectOption('#kcr', 'V'); await p.fill('#kcv', '-1'); await p.click('#kcpadd');
    const k = await p.evaluate(() => { const f = FE.state.f, c = (s) => s.charCodeAt(0); return [FE.kernOf(f, c('A'), c('V')), FE.kernOf(f, c('A'), c('W')), FE.kernOf(f, c('A'), c('Y')), FE.kernOf(f, c('A'), c('A'))]; });
    assert.deepStrictEqual(k, [-1, -1, -1, 0]); ok('kerning class A|V = -1 applies to A+V/W/Y and not A+A');
    await p.fill('#kl', 'A'); await p.fill('#kr', 'W'); await p.fill('#kv', '-2'); await p.click('#kadd');
    assert.strictEqual(await p.evaluate(() => FE.kernOf(FE.state.f, 65, 87)), -2); ok('an explicit pair beats the class pair'); await shot('kern-classes');
    assert.ok((await p.textContent('#kcplist')).includes('A + V')); ok('class pair listed in the table');
    // 10. layout screenshot of the family panel with the new controls
    await p.evaluate(() => FE.showTab('edit')); await p.setViewportSize({ width: 1280, height: 800 }); await shot('layout-1280');
    await p.evaluate(() => { localStorage.removeItem('craft.ovr'); });
    assert.deepStrictEqual(errs, []); ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
