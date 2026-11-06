// EBookCraft Node tests. Run: node scripts/ebookcraft-test.cjs   (OCR checks are skipped when the add-on is not installed)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const EBC = require(path.join(root, 'web/js/ebookcraft/index.js'));
const S = (n) => new Uint8Array(fs.readFileSync(path.join(root, 'docs/samples/ebook', n)));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  // 1. every format opens and yields text
  for (const n of ['sampler.txt', 'sampler.html', 'sampler.fb2', 'sampler.epub', 'sampler.mobi', 'sampler.cwd', 'sampler-text.pdf']) {
    try {
      const b = await EBC.book.open(S(n), n), t = EBC.book.plainText(b);
      ok(t.length > 300 && /Ishmael|Two Cities|Prejudice|best of times/.test(t), n + ' opens (' + b.format + ', ' + b.chapters.length + ' ch, ' + t.length + ' chars, toc ' + b.toc.length + ')');
    } catch (e) { ok(false, n + ' opens: ' + e.message); }
  }
  const ep = await EBC.book.open(S('sampler.epub'), 'sampler.epub');
  ok(EBC.book.search(ep, 'Ishmael').length === 1, 'search finds Ishmael once');
  const pgs = EBC.book.paginateLines(EBC.book.toLines(ep, { cols: 64 }), 23);
  ok(pgs.length >= 2 && pgs.every((p) => p.lines.length <= 23 && p.lines.every((l) => l.length <= 64)), 'Atari pagination 64x23: ' + pgs.length + ' screens');

  // 2. dithers and gray levels
  const I = EBC.image, src = await I.decode(S('scan-page.png'), 'scan-page.png');
  const g = I.fit(src, 320, 192, { mode: 'contain', bg: 255 });
  for (const d of I.DITHERS) for (const lv of [2, 4, 16, 256]) {
    const q = I.quantize(g, { levels: lv, method: d }), used = new Set(q.lv).size;
    if (!(q.w === 320 && used >= 2 && Math.max(...q.lv) < lv)) ok(false, d + '/' + lv + ' levels used ' + used);
  }
  ok(true, 'all ' + I.DITHERS.length + ' dithers x {2,4,16,256} levels quantize');

  // 3. scanned PDF (embedded image, built-in decoder) -> pages
  const out1 = await EBC.pack.convert([{ name: 'scan-page.pdf', bytes: S('scan-page.pdf') }], { text: false, bw: true, gray: [4], atr: true, xex: true, textdisk: false, bundle: true, tiles: 2 }, () => {});
  const f1 = out1.files.map((f) => f.path);
  ok(f1.some((p) => /atari-bw\/p001/.test(p)) && f1.some((p) => /\.atr$/.test(p)) && f1.some((p) => /\.xex$/.test(p)), 'scanned PDF converts to 1-bit pages + ATR + XEX (' + f1.length + ' files)');
  const atr = out1.files.find((f) => /view\.atr$/.test(f.path)).bytes;
  ok(atr[0] === 0x96 && atr[1] === 0x02, 'boot ATR has the $0296 magic, size ' + atr.length);
  const xex = out1.files.find((f) => /\.xex$/.test(f.path)).bytes;
  ok(xex[0] === 0xff && xex[1] === 0xff, 'XEX header FFFF, size ' + xex.length);

  // 4. epub -> everything, bundle round trip
  const out2 = await EBC.pack.convert([{ name: 'sampler.epub', bytes: S('sampler.epub') }], { text: true, bw: true, gray: [4, 16, 256], dither: 'floyd', bundle: true, textdisk: true }, () => {});
  const f2 = out2.files.map((f) => f.path);
  ok(['text/book.txt', 'text/book.xcw'].every((p) => f2.includes(p)) && f2.some((p) => /print-gray256/.test(p)) && f2.some((p) => /-text\.atr$/.test(p)), 'epub converts to text, cwd, all gray sets, text ATR (' + f2.length + ' files)');
  const zip = out2.files.find((f) => /\.ebookcraft\.zip$/.test(f.path)).bytes;
  ok(await EBC.pack.isBundle(zip), 'bundle recognised');
  const back = await EBC.pack.openBundle(zip);
  ok(/Ishmael/.test(EBC.book.plainText(back)) && back.title === ep.title, 'bundle re-opens in reader: ' + back.title);
  const dep = EBC.pack.deployFiles(out2);
  ok(dep.every((f) => f.path.startsWith(EBC.pack.LIB_ROOT + '/' + out2.slug + '/')) && EBC.pack.shelfEntry(out2).slug === out2.slug, 'deploy layout under ' + EBC.pack.LIB_ROOT);

  // 5. CLI
  const od = path.join(root, 'out', 'ebc', 'cli-test');
  fs.rmSync(od, { recursive: true, force: true });
  cp.execFileSync('node', [path.join(root, 'scripts/ebookcraft.cjs'), 'convert', path.join(root, 'docs/samples/ebook/sampler.fb2'), '--text', '--bw', '--gray', '4', '--dither', 'atkinson', '--out', od], { stdio: 'pipe' });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const cf = walk(od);
  ok(cf.some((p) => /book\.txt$/.test(p)) && cf.some((p) => /atari-gray4/.test(p)) && cf.some((p) => /manifest\.json$/.test(p)), 'CLI convert wrote ' + cf.length + ' files');

  // 6. OCR (optional add-on)
  if (await EBC.ocr.available()) {
    const o = await EBC.pack.convert([{ name: 'scan-page.png', bytes: S('scan-page.png') }], { text: true, ocr: true, bw: true, deskew: true, atr: false, xex: false, textdisk: false, bundle: false, print: false }, () => {});
    const t = Buffer.from(o.files.find((f) => f.path === 'text/book.txt').bytes).toString('utf8');
    ok(o.manifest.ocr.ran && o.manifest.ocr.meanConfidence > 80 && /best of times/i.test(t) && /Pride and Prejudice/i.test(t), 'OCR (' + o.manifest.ocr.meanConfidence + '% confidence) reads the scan');
    await EBC.ocr.terminate();
  } else console.log('SKIP OCR (add-on not installed: node scripts/ebookcraft-install-ocr.cjs)');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
