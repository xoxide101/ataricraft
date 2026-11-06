// Font library test: node scripts/fontlist-test.cjs  (screenshots out/fl-*.png)
// Runs scripts/fontlist.cjs, serves web/ over http, loads the library entries in fontedit.html and checks that nothing from
// font_personal/ or the extracted ROM charset is visible to git.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ok = (m) => console.log('ok  ' + m);
const git = (a) => execSync('git ' + a, { cwd: ROOT, encoding: 'utf8' });

(async () => {
  fs.mkdirSync(ROOT + '/out', { recursive: true });
  const groups = require('./fontlist.cjs').build();
  const names = (id) => groups.find((g) => g.id === id).fonts.map((f) => f.name);
  assert.ok(names('craft').includes('craft6.acf'));
  ok('shipped group lists ' + names('shared').length + ' fonts');
  const havePersonal = fs.existsSync(ROOT + '/font_personal/FONT.FNT');
  const haveRom = names('rom').length === 1;

  const ign = ['font_personal/FONT.FNT', 'web/library/fonts/local/manifest.json', 'web/library/fonts/local/personal/FONT.FNT'];
  if (haveRom) ign.push('web/library/fonts/local/atarirom.fnt');
  for (const p of ign) assert.ok(git('check-ignore ' + p).trim() === p, p + ' must be gitignored');
  assert.strictEqual(git('status --short -- font_personal web/library/fonts/local').trim(), '');
  assert.ok(!git('ls-files font_personal web/library/fonts/local').trim());
  ok('font_personal/ and web/library/fonts/local/ are ignored and untracked');

  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, 'web', decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200); r.end(d); } });
  }).listen(0);
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept('0'));
  await p.goto('http://localhost:' + port + '/fontedit.html');
  await p.waitForFunction(() => window.FE);
  await p.waitForFunction(() => document.querySelectorAll('#flist optgroup').length === 5);
  const labels = await p.$$eval('#flist optgroup', (g) => g.map((x) => x.label));
  assert.deepStrictEqual(labels.map((l) => l.replace(/ \(none\)/, '')), ['Craft faces', 'Shipped', 'Atari ROM', 'Personal', 'Converted']);
  ok('library groups: ' + labels.join(', '));

  const load = async (name) => {
    const val = await p.$eval('#flist', (s, n) => [...s.options].find((o) => o.textContent === n)?.value, name);
    assert.ok(val, name + ' listed');
    await p.evaluate(() => { FE.state.f = null; });
    await p.selectOption('#flist', val);
    await p.waitForFunction(() => FE.state.f, null, { timeout: 15000 });
    await p.waitForTimeout(400);
    return p.evaluate(() => { const f = FE.state.f; return { name: f.name, adv: f.adv, filled: f.glyphs.filter((g) => g.some((x) => x)).length }; });
  };
  const must = (f, min) => assert.ok(f.filled >= min, f.name + ' has only ' + f.filled + ' non-empty glyphs');

  if (haveRom) { const f = await load('Atari ROM charset (ATASCII, 8x8)'); must(f, 120); assert.strictEqual(f.adv, 8); ok('Atari ROM charset: ' + f.filled + ' glyphs, ' + f.adv + ' px'); }
  if (havePersonal) {
    const f1 = await load('FONT.FNT'); must(f1, 90); ok('personal FONT.FNT via the charset importer: ' + f1.filled + ' glyphs');
    await p.selectOption('#ttfadv', '8');
    const f2 = await load('Atari8bit.ttf'); must(f2, 80); assert.strictEqual(f2.adv, 8); ok('personal Atari8bit.ttf via the TTF rasteriser: ' + f2.filled + ' glyphs at ' + f2.adv + ' px');
    await p.screenshot({ path: ROOT + '/out/fl-1-library.png' });
  }
  const f3 = await load('craft5.acf'); assert.strictEqual(f3.adv, 5); ok('shipped craft5.acf opens');
  assert.deepStrictEqual(errs, []);
  ok('no page errors');
  await b.close(); srv.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
