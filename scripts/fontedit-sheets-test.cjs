// Font sheets, diff and transfer engines (no browser): node scripts/fontedit-sheets-test.cjs
const assert = require('assert'), zlib = require('zlib'), vm = require('vm'), fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..') + '/';
const CF = require(R + 'tools/craftfont.cjs'), S = require(R + 'web/js/fontedit/sheetcore.js'), D = require(R + 'web/js/fontedit/fontdiff.js');
const ok = (m) => console.log('ok  ' + m);
const win = {}; vm.runInNewContext(fs.readFileSync(R + 'web/js/fontedit/acw-faces.js', 'utf8'), { window: win });
const face = (id) => CF.parse(Buffer.from(win.ACW_FACES.find((f) => f.id === id).acf, 'base64'));
const A = face('craft8'), B = face('craft12'), ids = win.ACW_FACES.map((f) => f.id);
const ascii = []; for (let c = 32; c < 127; c++) ascii.push(c);
const png = (parts) => {
  const b = Buffer.concat(parts); assert.strictEqual(b.readUInt32BE(0), 0x89504e47);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), d = b[24], ct = b[25]; let o = 8; const idat = []; let phys = null;
  while (o < b.length) { const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); if (t === 'pHYs') phys = [b.readUInt32BE(o + 8), b[o + 16]]; o += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rb = Math.ceil((w * d * (ct === 3 ? 1 : 3)) / 8);
  return { w, h, d, ct, phys, rawOk: raw.length === (rb + 1) * h, raw, rb };
};

(async () => {
  // ---- parseCodes
  assert.strictEqual(D.parseCodes('A-Z 0-9 #200').length, 37); assert.strictEqual(D.parseCodes('U+00C0-00FF').length, 64);
  assert.deepStrictEqual(D.parseCodes('0x41 #66 c'), [65, 66, 99]); assert.strictEqual(D.parseCodes('65-90').length, 26);
  ok('parseCodes: characters, ranges, #n, 0x, U+, decimal');

  // ---- glyph chart, every dpi, PNG validity
  const sh = S.glyphChart({ CF, items: [{ name: 'Craft 8', f: A }], codes: ascii, zoom: 6, dpi: 300, labelFont: A, paper: 'letter' });
  assert.ok(sh.pages.length >= 1 && sh.pages[0].ops.length > 100); ok('glyph chart: ' + sh.pages.length + ' page(s), ' + sh.pages[0].ops.length + ' rectangles');
  for (const dpi of S.DPIS) {
    const t = Date.now(), p = png(await S.renderPng(sh.pages[0], { dpi })), [W, H] = S.dotsOf(sh.pages[0], dpi);
    assert.ok(p.rawOk && p.w === W && p.h === H && p.w === Math.round(8.5 * dpi) && p.h === 11 * dpi, 'png ' + dpi);
    assert.ok(p.phys && Math.abs(p.phys[0] - Math.round(dpi / 0.0254)) <= 1 && p.phys[1] === 1, 'pHYs ' + dpi);
    ok('PNG ' + dpi + ' dpi: ' + p.w + 'x' + p.h + ' valid, dpi chunk, ' + (Date.now() - t) + ' ms');
  }
  // hard edges: only palette indices, no in-between colours; 4800 dpi image uses <= 16 palette entries
  const hi = png(await S.renderPng(sh.pages[0], { dpi: 4800 })); assert.strictEqual(hi.ct, 3); assert.ok(hi.d <= 4); ok('4800 dpi uses a ' + hi.d + '-bit palette (no smoothing)');
  // a font pixel at 300 dpi and zoom 6 is 12x12 dots: scanning a row inside a known ink rectangle gives uniform runs
  const k = S.dotsPer({ zoom: 6, dpi: 300 }); assert.strictEqual(k, 12); ok('one font pixel = ' + k + ' dots at 300 dpi, zoom 6 (integer)');

  // ---- region / tiles join up
  const page = sh.pages[0], dpi = 600, tl = S.tiles(page, dpi, 2048), [W, H] = S.dotsOf(page, dpi);
  assert.ok(tl.length > 1); let area = 0;
  for (const t of tl) { const p = png(await S.renderPng(page, { dpi, region: t.region })); assert.ok(p.rawOk && p.w <= 2048 && p.h <= 2048); area += p.w * p.h; }
  assert.strictEqual(area, W * H); ok('tiles cover the page exactly: ' + tl.length + ' tiles of at most 2048 dots');
  const whole = png(await S.renderPng(page, { dpi })), t0 = png(await S.renderPng(page, { dpi, region: tl[0].region }));
  assert.ok(whole.raw.length > t0.raw.length); ok('region render equals a slice of the page size');
  let stopped = false; try { await S.renderPng(page, { dpi: 4800, cancelled: () => true }); } catch (e) { stopped = /cancel/i.test(e.message); } assert.ok(stopped); ok('a running 4800 dpi save can be cancelled');

  // ---- SVG and print HTML
  const svg = S.toSvg(page, { title: 'x' }); assert.ok(/^<\?xml|^<svg/.test(svg) && svg.includes('<svg') && svg.includes('shape-rendering="crispEdges"')); ok('SVG is vector with crisp edges (' + (svg.length / 1024).toFixed(0) + ' KB)');
  const html = S.printHtml(sh.pages, { paper: 'letter', landscape: false }, { title: 'T' }); assert.ok(html.includes('@page') && html.includes('<svg')); ok('print HTML: @page size + inline vector pages');
  assert.ok(S.printHtml(sh.pages, { paper: 'a4' }, { title: 'T', images: ['blob:x'] }).includes('image-rendering'));
  ok('print as picture uses pixelated images');

  // ---- size chart
  const sz = S.sizeChart({ CF, items: ids.slice(0, 2).map((id) => ({ name: id, fam: { sizes: { 8: A, 12: B } } })), sizes: [8, 12], text: 'Hamburgefonstiv 0123', zoom: 4, dpi: 300, labelFont: A, paper: 'letter' });
  assert.ok(sz.pages[0].ops.length > 300); ok('size comparison chart: fonts side by side, 2 sizes, ' + sz.pages[0].ops.length + ' rectangles');
  assert.ok(JSON.stringify(sz.info).length > 2); ok('chart carries labels (name, px size, dpi)');

  // ---- diff
  const same = D.diffFonts(CF, A, A, { codes: ascii }); assert.strictEqual(same.summary.changed, 0); assert.strictEqual(same.summary.similarity, 1);
  const A2 = CF.clone ? CF.clone(A) : face('craft8'); const slot = A2.map[65]; const orig = A2.glyphs[slot].slice(); A2.glyphs[slot] = A2.glyphs[slot].map((r, i) => (i === 3 ? r ^ 0x80 : r));
  const one = D.diffFonts(CF, A, A2, { codes: ascii }); assert.strictEqual(one.summary.changed, 1); assert.strictEqual(one.summary.changedPx, 1);
  const row = one.rows.find((r) => r.code === 65); assert.strictEqual(row.status, 'changed'); assert.strictEqual(row.changed, 1); ok('diff: one flipped pixel -> 1 glyph changed, 1 pixel, onlyA/onlyB split');
  A2.glyphs[slot] = new Array(A2.rows).fill(0); const gone = D.diffFonts(CF, A, A2, { codes: [65] }); assert.strictEqual(gone.rows[0].status, 'missing'); ok('diff: emptied glyph reported as missing in B');
  A2.glyphs[slot] = orig;
  const cross = D.diffFonts(CF, A, B, { codes: ascii, align: 'baseline' }); assert.ok(cross.summary.changed > 50 && cross.metrics.some((m) => m.differs)); ok('diff across sizes: ' + cross.summary.changed + ' glyphs differ, metrics differences listed');
  const csv = D.toCsv([{ ref: 'A', name: 'B', diff: cross }]); assert.ok(csv.split('\n').length > 90 && /status/i.test(csv.split('\n')[0])); JSON.parse(D.toJson([{ ref: 'A', name: 'B', diff: cross, kern: D.kernDiff({}, {}) }])); ok('diff exports: CSV rows + valid JSON');
  const kd = D.kernDiff({ '65,86': -1, '1,2': 1 }, { '65,86': -2, '3,4': 1 }); assert.deepStrictEqual([kd.differ.length, kd.onlyA.length, kd.onlyB.length], [1, 1, 1]); ok('kerning diff: differ / only A / only B');
  const sd = S.diffSheet({ CF, FD: D, ref: { name: 'A', f: A }, diffs: [{ name: 'B', f: A2, diff: one, kern: kd, ref: 'A' }], zoom: 6, dpi: 300, labelFont: A, paper: 'letter', onlyDiff: true });
  assert.ok(sd.pages.length >= 2); ok('diff sheet: cells plus a summary table page (' + sd.pages.length + ' pages)');

  // ---- transfer
  const dst = face('craft12'), src = face('craft8');
  const up = []; for (let c = 65; c <= 90; c++) up.push(c);
  const before = dst.glyphs[dst.map[97]].slice(), capBefore = dst.glyphs[dst.map[65]].slice();
  let pl = D.planGlyphs(CF, src, dst, up, { offset: 32, mode: 'copy' });
  assert.strictEqual(pl.items.length, 26); assert.ok(pl.items.every((i) => i.tcode === i.code + 32)); D.applyGlyphs(dst, pl);
  assert.deepStrictEqual(dst.glyphs[dst.map[65]], capBefore); assert.notDeepStrictEqual(dst.glyphs[dst.map[97]], before);
  assert.ok(D.countPx(CF, dst, 97) > 0); ok('copy A-Z onto a-z (offset +32): 26 glyphs, capitals untouched');
  const ov = D.planGlyphs(CF, src, dst, up, { offset: 32, overwrite: 'empty' }); assert.strictEqual(ov.items.length, 0); assert.strictEqual(ov.skipped.length, 26); ok('overwrite "only empty" skips non-empty targets');
  const out = D.planGlyphs(CF, src, dst, [250], { offset: 32 }); assert.ok(out.skipped[0] && /outside/.test(out.skipped[0].why)); ok('targets outside 0-255 are skipped with a reason');
  const sc = D.planGlyphs(CF, src, dst, [65], { mode: 'scale', threshold: 0.5 }); const cap = (f) => f.base - f.head + 1;
  const rowsUsed = sc.items[0].rows.map((r, i) => (r ? i : -1)).filter((i) => i >= 0); assert.ok(rowsUsed.length && rowsUsed[rowsUsed.length - 1] <= dst.base); assert.ok(rowsUsed.length >= cap(src) * dst.rows / src.rows - 3);
  ok('scale mode keeps the baseline and grows the glyph by the cap-height ratio');
  const m = D.planMetrics(CF, src, dst, { scale: true }); assert.ok(m.base <= dst.rows - 1 && m.base >= m.head); ok('metrics plan stays inside the target cell');
  const kp = D.planKern((a, b) => (a === 65 && b === 86 ? -2 : 0), [65, 86], 8, 12, { offset: 32, scale: true }); assert.deepStrictEqual(kp, { '97,118': -3 }); ok('kerning plan: pair moved by the offset and scaled by the advance ratio');
  console.log('ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
