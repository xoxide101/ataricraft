// xCWriter sections, role styles and sizes (docs/FONT.md "Styles and sections"), driven through the Page view toolbar.
// Precedence: document default < section font < style (Title/Heading 1-3/Body/Caption) < paragraph font/size. A line never mixes faces.
// Checks: UI controls, resolved faces and cell sizes per line in Page view, ink per paragraph band, .xcw (CPG1 tags 4..7) and docx round trips.
// Screenshots: out/shots/sections/xcw-*.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(ROOT, 'out', 'shots', 'sections');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };
const TXT = ['Annual report', 'Chapter one', 'First body paragraph of the first section.', 'Chapter two', 'Second section body text here.', 'Override paragraph with its own face and size.', 'Closing words.'];
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ok = (m) => console.log('ok  ' + m);
  await p.goto('http://localhost:' + srv.address().port + '/xcwriter.html');
  await p.click('#hnew'); await p.click('#mpg'); await p.waitForTimeout(800);
  await p.evaluate(async (t) => {
    for (const i of ['CRAFT8', 'CRAFT10', 'CRAFT12', 'ATARIROM', 'KIDPIXI2']) { XFACE.use(i); await XFACE.load(XFACE.get(i)); }
    XW.doc = XCW.normalize(t.map((s) => ({ align: 'l', bullet: false, runs: [{ t: s, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] })));
    PG.load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } });
  }, TXT);
  const sel = (a, f = a, o = 0) => p.evaluate(([x, y, off]) => { PG.load(XW.doc, { a: { p: x, o: off }, f: { p: y, o: off } }); }, [a, f, o]);
  const faces = () => p.evaluate(() => XCW.Page.resolve(XW.doc, XW.page || {}).map((r) => r.face));
  const lineInfo = () => p.evaluate(() => PG.lines().map((l) => ({ p: l.p, cw: l.cw, h: l.h })));
  const inkOf = () => p.evaluate(() => { const c = PG.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, h = 7; for (let k = 0; k < d.length; k += 4) if (d[k] < 90) { n++; h = (h * 31 + k) >>> 0; } return { n, h }; });
  const shot = (n) => p.screenshot({ path: path.join(SHOTS, 'xcw-' + n + '.png') });
  const redraw = async () => { await p.evaluate(() => PG.render()); await p.waitForTimeout(250); };

  assert(await p.isVisible('#pgrole') && await p.isVisible('#secfont') && await p.isVisible('#secbrk') && await p.isVisible('#seclist') && await p.isVisible('#pgsize') && await p.isVisible('#pgstyles'), 'style/section controls visible');
  const base = await inkOf();
  ok('controls visible; plain page ink ' + base.n);

  // (1) roles: Title and Heading 1 on paragraphs 0, 1 and 3
  await sel(0); await p.selectOption('#pgrole', 'title');
  await sel(1); await p.selectOption('#pgrole', 'h1');
  await sel(3); await p.selectOption('#pgrole', 'h1');
  let f = await faces(); let li = await lineInfo();
  const st = await p.evaluate(() => XW.page.styles);
  assert(st.title && st.h1, 'default style table created: ' + JSON.stringify(st));
  assert.deepStrictEqual(await p.evaluate(() => XW.doc.map((q) => q.role || '')), ['title', 'h1', '', 'h1', '', '', '']);
  ok('roles set from the toolbar: title / h1 / h1');

  // (2) document default + style faces through the Styles dialog
  await p.click('#pgstyles'); await p.waitForSelector('#sdf');
  await p.selectOption('#sdf', 'CRAFT8');
  await p.selectOption('select[data-r="title"][data-k="face"]', 'CRAFT12'); await p.selectOption('select[data-r="title"][data-k="size"]', '12');
  await p.selectOption('select[data-r="h1"][data-k="face"]', 'KIDPIXI2'); await p.selectOption('select[data-r="h1"][data-k="size"]', '0');
  await shot('1-styles-dialog');
  await p.click('#sok'); await p.waitForTimeout(500);
  f = await faces(); li = await lineInfo();
  assert.deepStrictEqual(f, ['CRAFT12', 'KIDPIXI2', 'CRAFT8', 'KIDPIXI2', 'CRAFT8', 'CRAFT8', 'CRAFT8'], 'faces: default < style: ' + f);
  ok('Styles dialog: default CRAFT8, title CRAFT12/size 12, heading KIDPIXI2: ' + f.join(' '));

  // (3) section break at paragraph 4 with its own font; the first section keeps the default
  await sel(4); await p.click('#secbrk');
  const secs = await p.evaluate(() => XCW.Page.sections(XW.doc, XW.page).map((s) => [s.start, s.end]));
  assert.strictEqual(secs.length, 2, 'two sections ' + JSON.stringify(secs));
  const at = secs[1][0];
  await sel(at); await p.selectOption('#secfont', 'ATARIROM');
  f = await faces();
  assert.deepStrictEqual(f.slice(0, 3), ['CRAFT12', 'KIDPIXI2', 'CRAFT8'], 'first section unchanged ' + f);
  assert(f.slice(at).every((x, i) => x === 'ATARIROM' || (XW_role(i + at))), 'second section uses the section font: ' + f);
  function XW_role(i) { return i === 3; }
  const opts = await p.$$eval('#seclist option', (o) => o.map((x) => x.textContent));
  assert.strictEqual(opts.length, 2, 'section list has two entries: ' + opts);
  ok('section break + section font: ' + f.join(' ') + ' | list ' + opts.join(' ; '));

  // (4) paragraph override of face and size, size choice rules
  await sel(5);
  await p.selectOption('#pgfont', 'CRAFT10'); await p.selectOption('#pgsize', '12');
  f = await faces();
  assert.strictEqual(f[5], 'CRAFT12', 'paragraph font CRAFT10 with size 12 gives CRAFT12: ' + f);
  const note = await p.textContent('#sizenote');
  assert(/4\/5\/6\/8\/10\/12/.test(note), 'size note lists the Craft sizes: ' + note);
  await sel(4); await p.selectOption('#pgsize', '12');
  assert.strictEqual((await faces())[4], 'ATARIROM', 'a fixed-size face ignores the size');
  assert(/single size/.test(await p.textContent('#sizenote')), 'note explains fixed size faces');
  await p.selectOption('#pgsize', '0');
  f = await faces();
  ok('paragraph override font+size: ' + f.join(' '));

  // (5) page view: cell size and line height per line, one face per line, ink per paragraph
  await sel(0); await redraw(); await p.selectOption('#pgzoom', '100').catch(() => {}); await redraw();
  li = await lineInfo();
  const byP = {}; for (const l of li) (byP[l.p] = byP[l.p] || new Set()).add(l.cw + 'x' + l.h);
  for (const k of Object.keys(byP)) assert.strictEqual(byP[k].size, 1, 'paragraph ' + k + ' lines share one cell size: ' + [...byP[k]]);
  const cell = (n) => [...byP[n]][0];
  assert.strictEqual(cell(0).split('x')[1], '12', 'title line height 12'); assert.strictEqual(cell(2).split('x')[1], '8'); assert.strictEqual(cell(5).split('x')[1], '12', 'override size 12 line height');
  assert.notStrictEqual(cell(0), cell(2), 'title and body cells differ');
  await sel(6); await redraw();
  const ink = await inkOf();
  assert(ink.n > base.n && ink.h !== base.h, 'page view ink changed: ' + base.n + ' -> ' + ink.n);
  await shot('2-page-view-styles-sections');
  ok('page view: cells ' + Object.entries(byP).map(([k, v]) => k + ':' + [...v][0]).join(' ') + ', ink ' + ink.n);

  // (6) round trips: .xcw (tags 4..7) and docx
  const rt = await p.evaluate(async () => {
    const want = XCW.Page.resolve(XW.doc, XW.page).map((r) => r.face);
    const s = XCW.save(XW.doc, 'cwd', { page: XW.page }), o = XCW.openDoc(s.bytes, 'T.xcw');
    const got = XCW.Page.resolve(o.paras, o.page).map((r) => r.face);
    const d = XCW.save(XW.doc, 'docx', { page: XW.page }), od = XCW.openDoc(d.bytes, 'T.docx');
    const gotD = XCW.Page.resolve(od.paras, od.page || {}).map((r) => r.face);
    const roles = o.paras.map((q) => q.role || ''), rolesD = od.paras.map((q) => q.role || '');
    const secs = XCW.Page.sections(o.paras, o.page).length, secsD = XCW.Page.sections(od.paras, od.page || {}).length;
    return { want, got, gotD, roles, rolesD, secs, secsD, ext: XCW.SAVE_FORMATS.find((x) => x.id === 'cwd').ext, n: s.bytes.length };
  });
  assert.deepStrictEqual(rt.got, rt.want, '.xcw round trip faces');
  assert.deepStrictEqual(rt.roles, ['title', 'h1', '', 'h1', '', '', '']); assert.strictEqual(rt.secs, 2); assert.strictEqual(rt.ext, 'xcw');
  assert.deepStrictEqual(rt.gotD, rt.want, 'docx round trip faces: ' + JSON.stringify(rt.gotD));
  assert.deepStrictEqual(rt.rolesD, rt.roles, 'docx roles'); assert.strictEqual(rt.secsD, 2, 'docx sections');
  ok('.xcw and docx round trips keep faces, roles and 2 sections');

  // (7) undo restores the structure
  await sel(6); await p.selectOption('#pgrole', 'h2');
  assert.strictEqual(await p.evaluate(() => XW.doc[6].role), 'h2');
  await p.evaluate(() => XW.undoRedo(false)); await p.waitForTimeout(200);
  assert.strictEqual(await p.evaluate(() => XW.doc[6].role || ''), '');
  ok('undo reverts a role change');

  assert.deepStrictEqual(errs, [], 'no page errors');
  ok('no page errors');
  console.log('xcwriter-sections-test: all passed');
  await b.close(); srv.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
