// Tests: Atari ROM charset (no emulator: ROM file picker, ROM saved in IndexedDB, bad file) and the big Choose font window with 30+ fonts.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
const URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html';
const SIG = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0x18, 0x18, 0x18, 0x18, 0, 0x18, 0];
const charset = () => { const b = Buffer.alloc(1024); for (let i = 0; i < 1024; i++) b[i] = (i * 37 + 11) & 255; SIG.forEach((v, i) => { b[i] = v; }); return b; };
const rom = (size, off) => { const b = Buffer.alloc(size, 0xea); charset().copy(b, off); return b; };
const toastText = (pg) => pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }), pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await pg.goto(URL); await pg.waitForFunction(() => window.FE && FE.entries && FE.entries.size);

    // ---- 1. Atari ROM charset, no emulator connected ------------------------------------------------------------------------
    assert.ok(await pg.evaluate(() => !FE.state.emu), 'standalone');
    const want = charset();
    for (const [size, off, name] of [[16384, 0x2000, 'ATARIXL.ROM'], [10240, 0x800, 'ATARIA.ROM'], [8192, 0, 'os8k.rom']]) {
      assert.deepStrictEqual(await pg.evaluate((a) => Array.from(FE.romCharset(new Uint8Array(a))), Array.from(rom(size, off))), Array.from(want)); ok('romCharset finds the set in a ' + size + ' byte ROM at +' + off.toString(16));
    }
    // a ROM file picked through the file window (the fallback when no emulator and no saved ROM exist)
    await pg.evaluate(() => { localStorage.clear(); });
    await pg.click('#bemurom');
    await pg.waitForTimeout(500);
    let t = await toastText(pg); assert.ok(/No Atari ROM found/.test(t), 'plain message: ' + t); ok('plain message when no emulator and no ROM: "' + t.slice(0, 70) + '..."');
    const real = path.join(ROOT, 'software_n_roms', 'ATARIXL.ROM');
    const file = fs.existsSync(real) ? real : null;
    const before = await pg.evaluate(() => FE.entries.size);
    await pg.setInputFiles('#romfile', { name: 'ATARIXL.ROM', mimeType: 'application/octet-stream', buffer: rom(16384, 0x2000) });
    await pg.waitForFunction(() => FE.state.f && FE.state.f.adv === 8, null, { timeout: 5000 });
    let got = await pg.evaluate(() => Array.from(FE.CF.toFnt(FE.atari8(true))).slice(0, 1024));
    assert.deepStrictEqual(got.slice(0, 1024), Array.from(want)); ok('picked ATARIXL-style ROM opens as the 8x8 Atari charset (1024 bytes identical)');
    if (file) {
      await pg.setInputFiles('#romfile', file); await pg.waitForTimeout(600);
      const o = await pg.evaluate(() => Array.from(FE.CF.toFnt(FE.atari8(true)))); assert.deepStrictEqual(o, Array.from(fs.readFileSync(real).subarray(0x2000, 0x2400))); ok('real software_n_roms\\ATARIXL.ROM opens: charset at +0x2000 identical');
    } else console.log('skip real ATARIXL.ROM (not present)');
    await pg.setInputFiles('#romfile', { name: 'junk.rom', mimeType: 'application/octet-stream', buffer: Buffer.alloc(16384, 7) });
    await pg.waitForTimeout(400); t = await toastText(pg); assert.ok(/has no Atari character set/.test(t), t); ok('a file without a charset gives a plain message');

    // ROM saved by the emulator page in IndexedDB (name ataricraft / store roms): used without any picker
    await pg.evaluate(() => new Promise((res, rej) => { const q = indexedDB.open('ataricraft', 1); q.onupgradeneeded = () => q.result.createObjectStore('roms', { keyPath: 'name' }); q.onsuccess = () => { const db = q.result; const tx = db.transaction('roms', 'readwrite'); tx.objectStore('roms').clear(); tx.oncomplete = () => { db.close(); res(); }; }; q.onerror = () => rej(q.error); }));
    await pg.evaluate((a) => new Promise((res) => { const q = indexedDB.open('ataricraft'); q.onsuccess = () => { const db = q.result, tx = db.transaction('roms', 'readwrite'); tx.objectStore('roms').put({ name: 'xl-os.rom', kind: 'osxl', bytes: new Uint8Array(a) }); tx.oncomplete = () => { db.close(); res(); }; }; }), Array.from(rom(16384, 0x2000)));
    await pg.evaluate(() => { document.querySelectorAll('.toast').forEach((x) => x.remove()); FE.newBlank && FE.newBlank(); });
    let picker = false; pg.once('filechooser', () => { picker = true; });
    await pg.click('#bemurom'); await pg.waitForTimeout(800);
    assert.ok(!picker, 'no picker when a ROM is saved'); t = await toastText(pg); assert.ok(/saved by the emulator page/.test(t), t);
    assert.strictEqual(await pg.evaluate(() => FE.state.f.adv), 8); ok('ROM saved in the emulator page database is used (no picker)');
    await pg.evaluate(() => FE.showTab('atari')); await pg.click('#brom'); await pg.waitForTimeout(500); assert.ok(!picker); ok('Atari tab "Open the Atari ROM charset" uses the same path');

    // ---- 2. the Choose font window with 30+ fonts --------------------------------------------------------------------------------
    await pg.goto(URL); await pg.waitForFunction(() => window.FE && FE.entries && FE.entries.size);
    const files = [];
    for (const dir of ['C:/Windows/Fonts', path.join(ROOT, 'web/library/fonts')]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (/\.(ttf|otf)$/i.test(f) && fs.statSync(path.join(dir, f)).size < 900000 && files.length < 34) files.push(path.join(dir, f));
    }
    await pg.setInputFiles('#file', files); await pg.waitForTimeout(500);
    await pg.waitForFunction((n) => FE.entries.size >= n, 30, { timeout: 60000 });
    const total = await pg.evaluate(() => FE.entries.size); assert.ok(total >= 30, 'fonts ' + total); ok(total + ' fonts loaded');
    assert.ok(/\u00b7 \d+ px/.test(await pg.textContent('#bchoose')), 'header shows the current font'); ok('header button: ' + (await pg.textContent('#bchoose')).trim());
    for (const [w, h] of [[1600, 1000], [1100, 800], [760, 900]]) {
      await pg.setViewportSize({ width: w, height: h });
      await pg.click('#bchoose'); await pg.waitForSelector('#chooser:not([hidden])');
      await pg.waitForFunction(() => document.querySelectorAll('#chgrid .chcard').length >= 30);
      await pg.waitForTimeout(1200);
      const box = await pg.locator('.chbox').boundingBox(); assert.ok(box.width >= w * 0.8 - 2 || w > 1500, 'modal width ' + box.width); assert.ok(box.height >= h * 0.8 - 2, 'modal height ' + box.height);
      const drawn = await pg.evaluate(() => [...document.querySelectorAll('#chgrid canvas')].filter((c) => c.width > 40).length); assert.ok(drawn >= 5, 'sample canvases drawn ' + drawn);
      await pg.screenshot({ path: path.join(OUT, 'chooser-' + w + '.png') }); ok('chooser at ' + w + 'x' + h + ': ' + box.width + 'x' + box.height + ', ' + drawn + ' samples drawn (out\\chooser-' + w + '.png)');
      await pg.keyboard.press('Escape'); assert.ok(await pg.locator('#chooser').isHidden()); 
    }
    await pg.setViewportSize({ width: 1600, height: 1000 });
    await pg.click('#bchoose');
    await pg.fill('#chtext', 'Quick brown fox 1234'); await pg.fill('#chq', 'arialb');
    await pg.waitForTimeout(300); const n = await pg.locator('#chgrid .chcard').count(); assert.ok(n >= 1 && n < total, 'search ' + n); ok('search "arialb" narrows ' + total + ' to ' + n);
    await pg.fill('#chq', ''); await pg.click('#chlistb'); assert.ok(await pg.evaluate(() => document.getElementById('chgrid').classList.contains('list'))); await pg.click('#chgridb'); ok('grid/list toggle');
    await pg.setViewportSize({ width: 1600, height: 1000 });
    // size slider re-draws samples
    await pg.waitForFunction(() => document.querySelector('#chgrid .chcard.on canvas').width > 40); const w1 = await pg.evaluate(() => document.querySelector('#chgrid .chcard.on canvas').width); await pg.evaluate(() => { const s = document.getElementById('chsize'); s.value = 24; s.dispatchEvent(new Event('input')); }); await pg.waitForTimeout(300);
    const w2 = await pg.evaluate(() => document.querySelector('#chgrid .chcard.on canvas').width); assert.ok(w2 > w1, w1 + ' -> ' + w2); ok('size slider enlarges the sample (' + w1 + ' -> ' + w2 + ' px canvas)');
    // keyboard: Down then Enter picks the next font
    const first = await pg.evaluate(() => document.querySelector('#chgrid .chcard.on') ? document.querySelector('#chgrid .chcard.on').dataset.id : null);
    await pg.focus('#chq'); await pg.keyboard.press('ArrowUp'); const sel = await pg.evaluate(() => document.querySelector('#chgrid .chcard.on').dataset.id); assert.notStrictEqual(sel, first);
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
    assert.ok(await pg.locator('#chooser').isHidden()); assert.strictEqual(await pg.evaluate(() => FE.state.entry), sel); ok('Up + Enter picks ' + sel);
    // double-click picks, Select button picks, tree size picks
    await pg.click('#bchoose'); const card = pg.locator('#chgrid .chcard').nth(3); const cid = await card.getAttribute('data-id');
    await card.dblclick(); await pg.waitForTimeout(800); assert.ok(await pg.locator('#chooser').isHidden()); assert.strictEqual(await pg.evaluate(() => FE.state.entry), cid); ok('double-click picks ' + cid);
    await pg.click('#bchoose'); await pg.click('#chtree .chf[data-f=""]'); await pg.locator('#chtree summary[data-id="craft"]').click({ force: true }).catch(() => {});
    await pg.evaluate(() => { document.querySelector('#chtree summary[data-id="craft"]').parentElement.open = true; });
    await pg.click('#chgrid .chcard[data-id="craft"]'); await pg.click('#chtree button[data-id="craft"][data-size="18"]'); await pg.click('#chpick'); await pg.waitForTimeout(800);
    assert.strictEqual(await pg.evaluate(() => FE.state.entry + ':' + FE.state.f.adv), 'craft:18'); assert.ok(/Craft Sans.*18 px/.test(await pg.textContent('#bchoose'))); ok('tree size 18 + Select button opens Craft Sans at 18 px; header: ' + (await pg.textContent('#bchoose')).trim());
    // favourites
    await pg.click('#bchoose'); await pg.click('#chgrid .chcard[data-id="craft"] .chstar'); await pg.click('#chtree .chf[data-f="fav"]');
    assert.strictEqual(await pg.locator('#chgrid .chcard').count(), 1); ok('favourite filter'); await pg.keyboard.press('Escape');
    assert.deepStrictEqual(errs, [], errs.join('\n')); ok('no page or console errors');
    console.log('fontedit-ui7: PASS');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e.message || e); process.exit(1); });
