// Phase-1 tests: the unified Fonts list + size strip works from file:// (no node script, no server): every size 4-26 is selectable,
// missing sizes are created on click, Atari 8x8 view auto-derives, Export menu is grouped. Screenshots in out/ at several viewports.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
    await p.waitForFunction(() => window.FE && FE.state.f && document.querySelectorAll('#sizes .sz').length >= 13);
    const shot = (n) => p.screenshot({ path: path.join(OUT, 'ui2-' + n + '.png') });
    const strip = await p.$$eval('#sizes .sz', (s) => s.map((x) => x.dataset.size));
    assert.deepStrictEqual(strip, ['4', '5', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26']); ok('file://: default family Craft Sans shows all sizes ' + strip.join(' '));
    assert.strictEqual(await p.locator('#flist .fitem').first().getAttribute('data-fid'), 'craft');
    assert.strictEqual(await p.locator('#flist optgroup, #builtin, #fsize').count(), 0); ok('no old Built-in / Library / size dropdowns');
    await shot('file-default');
    for (const s of [14, 16, 18, 20, 22, 24, 26]) {
      await p.click('#sizes .sz[data-size="' + s + '"]');
      assert.strictEqual(await p.evaluate(() => FE.state.f.adv), s);
      assert.ok(await p.evaluate(() => FE.state.f.glyphs.some((g) => g && g.some((v) => v))), s + ' has pixels');
      assert.ok(await p.locator('#sizes .sz[data-size="' + s + '"]').evaluate((e) => e.classList.contains('on')));
    }
    ok('sizes 14,16,18,20,22,24,26 are each selectable by click from file://'); await shot('file-size26');
    // a blank family: missing sizes are dashed and are created on click
    await p.evaluate(() => FE.openEntry('craft'));
    await p.evaluate(() => { document.getElementById('bnew').click(); });
    await p.waitForTimeout(300);
    const miss = await p.$$eval('#sizes .sz.missing', (s) => s.length);
    if (miss) { await p.evaluate(() => FE.selectSize(26)); assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 26); } ok('missing sizes (' + miss + ') are dashed; selecting creates them');
    await p.evaluate(() => FE.openEntry('craft')); await p.waitForTimeout(200);
    // Atari 8x8 auto-derive
    await p.evaluate(() => FE.showTab('atari')); await p.waitForTimeout(300);
    const msg = await p.evaluate(() => document.getElementById('atinfo').textContent + document.querySelector('.view.on, #views').textContent);
    assert.ok(!/derive it first/i.test(msg)); await shot('file-atari'); ok('Atari 8x8 view shows without "derive it first"');
    // Export menu
    assert.strictEqual(await p.locator('details.menu #bsave').count(), 1); await p.evaluate(() => { document.querySelector('details.menu').open = true; }); await shot('file-export-menu'); ok('Export buttons grouped in one menu');
    await p.evaluate(() => { document.querySelector('details.menu').open = false; FE.showTab('edit'); });
    for (const [w, h] of [[1280, 800], [1000, 700], [760, 900]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(250); await shot('file-' + w + 'x' + h); }
    // ---- phase 2: dashed size really derives from the master; hints; registry tree, flags, group/split ------------------------------------
    await p.evaluate(() => localStorage.removeItem('craft.hint')); await p.reload(); await p.waitForFunction(() => window.FE && FE.state.f);
    assert.ok(await p.isVisible('#hint')); await p.click('#hintx'); assert.ok(!(await p.isVisible('#hint')));
    await p.reload(); await p.waitForFunction(() => window.FE && FE.state.f); assert.ok(!(await p.isVisible('#hint'))); ok('first-run hint shows once and stays dismissed');
    await p.click('#bnew'); await p.waitForFunction(() => FE.state.fam.name.startsWith('New font'));
    assert.strictEqual(await p.locator('#sizes .sz.missing').count(), 12);
    await p.evaluate(() => { const f = FE.state.f; const g = f.glyphs[65] || (f.glyphs[65] = new Array(f.rows).fill(0)); for (let r = 3; r < 9; r++) for (let q = 1; q < 10; q++) g[r] = FE.CF.setPx(f, g[r], q); f.glyphs[65] = g; });
    await p.click('#sizes .sz[data-size="8"]');
    const d8 = await p.evaluate(() => { const f = FE.state.fam.sizes[8]; return { adv: f.adv, origin: f.origin, px: FE.CF.glyph(f, 65).some((v) => v), on: FE.state.f === f }; });
    assert.deepStrictEqual([d8.adv, d8.origin, d8.px, d8.on], [8, 1, true, true]);
    assert.ok(await p.locator('#sizes .sz[data-size="8"]').evaluate((e) => e.classList.contains('have') && !e.classList.contains('missing')));
    assert.strictEqual(await p.locator('#sizes .sz.missing').count(), 11); await shot('derived-size');
    ok('a dashed size becomes derived from the 12 px master on click (origin derived, pixels present, strip updated)');
    await p.click('#sizes .sz[data-size="26"]'); assert.ok(await p.evaluate(() => FE.CF.glyph(FE.state.fam.sizes[26], 65).some((v) => v))); ok('26 px derived from the master too');

    await p.evaluate(() => FE.openEntry('craft')); await p.waitForFunction(() => FE.state.fam.name === 'Craft Sans');
    assert.strictEqual(await p.locator('#tree table.tree tbody tr').count(), 13);
    assert.deepStrictEqual(await p.evaluate(() => FE.sizesFor('acwriter-atari')), [4, 5, 6, 8]);
    await p.uncheck('#tree input[data-t="acwriter-atari"][data-s="5"]');
    assert.deepStrictEqual(await p.evaluate(() => FE.sizesFor('acwriter-atari')), [4, 6, 8]); await p.uncheck('#tree input[data-t="xcwriter"][data-s="26"]');
    await shot('family-tree'); ok('tree lists Family > Style > Size with per-target checkboxes; unticking size 5 for ACWriter changes its size list');
    const zip = await p.evaluate((t) => { const r = FE.familyZip(t); return Array.from(new Uint8Array(r.zip)).map((c) => String.fromCharCode(c)).join(''); }, 'acwriter-atari');
    const pick = (s) => [...new Set(s.match(/Craft_Sans-\d+\.acf/g))], acfs = pick(zip), all = await p.evaluate(() => { const r = FE.familyZip(''); return Array.from(new Uint8Array(r.zip)).map((c) => String.fromCharCode(c)).join(''); });
    assert.strictEqual(acfs.length, 3, acfs.join()); assert.strictEqual(pick(all).length, 13); assert.ok(/family\.manifest\.json/.test(zip));
    ok('Zip "for ACWriter" has only the 3 flagged sizes (' + acfs.join(', ') + ') plus family.manifest.json; all-sizes zip has 13');
    await p.reload(); await p.waitForFunction(() => window.FE && FE.state.f);
    assert.deepStrictEqual(await p.evaluate(() => FE.sizesFor('acwriter-atari')), [4, 6, 8]); ok('flags persist in the browser (craft.manifest) after reload');
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('craft.manifest')); delete m.families[0].styles[0].sizes[5].flags; localStorage.setItem('craft.manifest', JSON.stringify(m)); });
    // group as family / split
    await p.evaluate(async () => { document.getElementById('bnew').click(); document.getElementById('bnew').click(); });
    await p.waitForTimeout(300);
    const r = await p.evaluate(async () => {
      const mine = [...FE.entries.values()].filter((e) => e.kind === 'my' && /^New font/.test(e.name)); const [a, b] = mine;
      await FE.openEntry(b.id); FE.selectSize(8); await FE.openEntry(a.id);
      const before = Object.keys(FE.state.fam.sizes).join(); FE.mergeInto(b.id);
      const after = Object.keys(FE.state.fam.sizes).join(), gone = !FE.entries.has(b.id);
      const sp = FE.splitSize(8);
      return { before, after, gone, split: sp.name, left: Object.keys(FE.state.fam.sizes).join(), has: [...FE.entries.keys()].includes('my:' + sp.name) };
    });
    assert.strictEqual(r.before, '12'); assert.strictEqual(r.after, '8,12'); assert.ok(r.gone); assert.strictEqual(r.left, '12'); assert.ok(r.has); ok('Group as family folds another family\'s sizes in (' + r.after + '); Split this size out makes "' + r.split + '"');
    const man = JSON.parse(await p.evaluate(() => FE.manifestJson())); assert.strictEqual(man.format, 'craft-family-manifest'); ok('Family manifest export is a craft-family-manifest');
    await p.evaluate(() => { localStorage.removeItem('craft.manifest'); const m = JSON.parse(localStorage.getItem('craft.myfonts') || '{}'); for (const k of Object.keys(m)) if (/^New font/.test(k)) delete m[k]; localStorage.setItem('craft.myfonts', JSON.stringify(m)); });
    assert.deepStrictEqual(errs, []); ok('no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.log('FAIL', e.stack || e); process.exit(1); });
