// Font sheets (PNG 150-4800 dpi, tiles, SVG, print), size comparison chart, font diff, copy between fonts with undo, system-font dialog.
// Needs playwright-core and Chrome: set PLAYWRIGHT_CORE / CHROME_PATH, or the usual locations are tried. A TTF is taken from FONT_TTF or the system font folders.
const path = require('path'), fs = require('fs'), zlib = require('zlib');
const first = (l) => l.find((p) => p && fs.existsSync(p));
const pwPath = first([process.env.PLAYWRIGHT_CORE, 'C:/Users/raver/craftapi/node_modules/playwright-core', '/opt/playwright-mcp/node_modules/playwright-core', path.resolve(__dirname, '..', 'node_modules', 'playwright-core')]);
const chrome = first([process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']);
const ttf = first([process.env.FONT_TTF, 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf']);
if (!pwPath || !chrome || !ttf) { console.log('SKIP: needs playwright-core, Chrome and a TTF (' + [pwPath, chrome, ttf].join(', ') + ')'); process.exit(0); }
const { chromium } = require(pwPath);
const URL = 'file://' + (process.platform === 'win32' ? '/' : '') + path.resolve(__dirname, '..', 'web', 'fontedit.html').replace(/\\/g, '/');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL ') + m); if (!c) fails++; };
const pngInfo = (u8) => { // validate signature, IHDR, IDAT inflate size
  const b = Buffer.from(u8); if (b.readUInt32BE(0) !== 0x89504e47) return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25]; let o = 8, idat = [], phys = false;
  while (o < b.length) { const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); if (t === 'pHYs') phys = true; o += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rb = Math.ceil((w * depth * (ct === 3 ? 1 : 3)) / 8);
  return { w, h, depth, ct, phys, good: raw.length === (rb + 1) * h };
};
(async () => {
  const b = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForTimeout(800);
  await pg.setInputFiles('#file', [ttf]); await pg.waitForTimeout(3000);
  const ids = await pg.evaluate(() => [...FE.entries.keys()]);
  ok(ids.length >= 2, 'library has built-in and imported fonts: ' + ids.slice(0, 6).join(','));

  // ---- sheets tab
  await pg.click('[data-tab="sheets"]'); await pg.waitForTimeout(600);
  ok(await pg.locator('#shdpi option').count() === 6, 'six resolutions in the pull-down');
  ok(await pg.evaluate(() => !!FE.sheetBuilt()), 'glyph chart built');
  const dpis = [150, 300, 600, 1200, 2400, 4800];
  for (const d of dpis) {
    const r = await pg.evaluate(async (d) => { const bl = await FE.sheetPng(0, d); const u = new Uint8Array(await bl.arrayBuffer()); return { n: u.length, head: Array.from(u) }; }, d);
    const i = pngInfo(r.head); const [w, h] = [Math.round(8.5 * d), Math.round(11 * d)];
    ok(!!i && i.good && i.phys && i.w === w && i.h === h, 'PNG ' + d + ' dpi is a valid ' + w + 'x' + h + ' image with dpi chunk (' + (r.n / 1024).toFixed(0) + ' KB)');
  }
  const t = await pg.evaluate(async () => { const S = FESheet, page = FE.sheetBuilt().sheet.pages[0]; return S.tiles(page, 4800, 8192).length; });
  ok(t > 1, '4800 dpi Letter splits into ' + t + ' tiles of at most 8192 dots');
  await pg.selectOption('#shdpi', '600'); await pg.waitForTimeout(300);
  let dl = pg.waitForEvent('download'); await pg.click('#shpng'); let f = await dl; ok(/600dpi\.png$/.test(f.suggestedFilename()), 'Save PNG downloads ' + f.suggestedFilename());
  dl = pg.waitForEvent('download'); await pg.click('#shsvg'); f = await dl; ok(/\.svg$/.test(f.suggestedFilename()), 'SVG downloads ' + f.suggestedFilename());
  await pg.evaluate(() => { document.getElementById('shprint').onclick; });
  const html = await pg.evaluate(async () => { document.querySelector('#shprint').click(); await new Promise((r) => setTimeout(r, 400)); return FE.lastPrintHtml || ''; });
  ok(/@page/.test(html) && /<svg/.test(html), 'print HTML has @page and vector pages');

  // ---- size chart
  await pg.selectOption('#shtype', 'sizes'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { for (const o of document.getElementById('shfonts').options) o.selected = true; document.getElementById('shfonts').dispatchEvent(new Event('change')); }); await pg.waitForTimeout(800);
  const sc = await pg.evaluate(() => { const b = FE.sheetBuilt(); return { type: b.type, pages: b.sheet.pages.length, ops: b.sheet.pages[0].ops.length }; });
  ok(sc.type === 'sizes' && sc.ops > 500, 'size comparison chart: ' + JSON.stringify(sc));

  // ---- diff
  await pg.selectOption('#shtype', 'diff'); await pg.waitForTimeout(300);
  await pg.evaluate((ids) => { for (const o of document.getElementById('shfonts').options) o.selected = ids.includes(o.value); document.getElementById('shfonts').dispatchEvent(new Event('change')); }, [ids[0], ids[ids.length - 1]]); await pg.waitForTimeout(1200);
  const dsum = await pg.evaluate(() => { const b = FE.sheetBuilt(); return b && b.diffs.map((d) => d.diff.summary); });
  ok(dsum && dsum.length === 1 && dsum[0].compared > 50, 'diff summary: ' + JSON.stringify(dsum && dsum[0]));
  ok(await pg.locator('#shsum table').count() === 1, 'summary table shown');
  dl = pg.waitForEvent('download'); await pg.click('#shcsv'); f = await dl; ok(/\.csv$/.test(f.suggestedFilename()), 'diff CSV downloads');

  // ---- copy with undo
  await pg.click('[data-tab="copy"]'); await pg.waitForTimeout(500);
  const imp = ids.find((x) => x.startsWith('my:'));
  await pg.selectOption('#cpsrc', imp); await pg.waitForTimeout(400); await pg.selectOption('#cptgt', 'craft'); await pg.waitForTimeout(400);
  await pg.selectOption('#cpsrcsz', '12'); await pg.selectOption('#cptgtsz', '12');
  await pg.selectOption('#cpset', 'custom'); await pg.fill('#cpcodes', 'A-Z'); await pg.fill('#cpat', 'a'); await pg.waitForTimeout(300);
  const snap = () => pg.evaluate(() => { const f = FE.entries.get('craft').fam.sizes[12]; return [97, 98, 65].map((c) => (f.glyphs[f.map[c]] || []).join(',')).join('|'); });
  const before = await snap();
  const srcPx = await pg.evaluate((imp) => { const f = FE.entries.get(imp).fam.sizes[12]; return FEDiff.countPx(FE.CF, f, 65); }, imp);
  await pg.click('#cpapply'); await pg.waitForTimeout(800);
  const after = await snap();
  const aPx = await pg.evaluate(() => { const f = FE.entries.get('craft').fam.sizes[12]; return [FEDiff.countPx(FE.CF, f, 97), FEDiff.countPx(FE.CF, f, 65)]; });
  ok(after !== before && aPx[0] === srcPx && after.split('|')[2] === before.split('|')[2], 'A-Z copied onto a-z (A unchanged); a has the source A pixels: ' + aPx[0] + ' = ' + srcPx);
  await pg.evaluate(() => FE.undo()); await pg.waitForTimeout(200);
  ok(await snap() === before, 'Ctrl+Z restores the target glyphs');

  // metrics + kerning + advances in one copy, one undo; re-rasterize from the TTF outline
  await pg.evaluate(() => { FE.openEntry('craft', 12); }); await pg.waitForTimeout(400);
  await pg.evaluate(() => { FE.state.kern[12] = FE.state.kern[12] || {}; FE.state.kern[12]['65,86'] = -1; });
  await pg.selectOption('#cpsrc', imp); await pg.selectOption('#cptgt', 'craft'); await pg.waitForTimeout(300);
  await pg.selectOption('#cpsrcsz', '12'); await pg.selectOption('#cptgtsz', '12');
  await pg.selectOption('#cpset', 'custom'); await pg.fill('#cpcodes', 'A V'); await pg.fill('#cpat', 'a'); await pg.selectOption('#cpfit', 'raster'); await pg.fill('#cpth', '40');
  await pg.check('#cpmetrics'); await pg.check('#cpkern'); await pg.waitForTimeout(500);
  const info = await pg.evaluate(() => document.getElementById('cpinfo').textContent); ok(/re-rasterized at 12 px/.test(info) && /vertical metrics/.test(info) && /kerning pair/.test(info), 'preview describes raster fit, metrics, kerning: ' + info.slice(0, 160));
  const state = () => pg.evaluate(() => { const f = FE.entries.get('craft').fam.sizes[12]; return JSON.stringify([f.head, f.xTop, f.base, f.desc, f.advs, f.glyphs[f.map[97]], FE.state.kern]); });
  const st0 = await state(); const hist0 = await pg.evaluate(() => FE.hist().undo.length);
  await pg.click('#cpapply'); await pg.waitForTimeout(900);
  const st1 = await state(); ok(st1 !== st0 && (await pg.evaluate(() => FE.state.kern[12]['97,118'])) === -1, 'raster copy changed glyph a and moved kerning pair A,V to a,v');
  ok(await pg.evaluate(() => FE.hist().undo.length) === hist0 + 1, 'one undo step for glyphs + metrics + kerning');
  await pg.evaluate(() => FE.undo()); await pg.waitForTimeout(200);
  const st2 = await state(); if (st2 !== st0) console.log('before', st0, '\nafter ', st2);
  ok(st2 === st0, 'undo restores glyphs, metrics, advances and kerning tables');
  ok(await pg.evaluate((imp) => FE.credits.of('Craft Sans').length >= 1 && FE.creditsText('Craft Sans').includes(FE.entries.get(imp).name), imp), 'credits record names the source font');

  // ---- system fonts dialog (file pick path)
  await pg.click('#bsys'); await pg.waitForTimeout(300);
  ok(await pg.isVisible('#sysdlg'), 'system fonts dialog opens');
  await pg.setInputFiles('#sysfiles', [ttf]); await pg.waitForTimeout(400);
  ok(await pg.locator('#syslist .fitem').count() === 1, 'picked font file is listed');
  await pg.click('#syslist .fitem'); await pg.waitForTimeout(800);
  ok((await pg.evaluate(() => document.getElementById('syspv').width)) > 10, 'bitmap preview drawn');
  await pg.click('#sysassrc'); await pg.waitForTimeout(3000);
  const src = await pg.evaluate(() => { const id = document.getElementById('cpsrc').value, s = FE.sources.get(id); return { id, origin: s && s.origin, hint: s && s.raster.hint }; });
  ok(src.origin === 'file' && src.hint === false, 'added as copy source with source note, hinting off: ' + JSON.stringify(src));
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
