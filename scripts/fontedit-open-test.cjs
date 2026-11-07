// Regression: opening many real font files in the editor must not error (file:// and http). Run: node scripts/fontedit-open-test.cjs
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const SF = require('../tools/sfnt.cjs');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log('ok  ' + m);
const W = 'C:/Windows/Fonts/';
const files = [];
const add = (p) => { if (fs.existsSync(p)) files.push(p); };
['arial.ttf', 'consola.ttf', 'cour.ttf', 'times.ttf', 'cambria.ttc'].forEach((n) => add(W + n));
const lib = (d, ext) => { const p = path.join(WEB, 'library/fonts', d); return fs.existsSync(p) ? fs.readdirSync(p).filter((n) => n.endsWith(ext)).map((n) => path.join(p, n)) : []; };
files.push(...lib('', '.otf').slice(0, 1), ...lib('', '.ttf').slice(0, 2), ...lib('atari', '.fnt').slice(0, 2), ...lib('acw', '.acf').slice(0, 2));
add(path.join(ROOT, 'font/craft14.acf'));
const wf = path.join(OUT, 'open-test.woff');
if (fs.existsSync(files[0])) { fs.writeFileSync(wf, Buffer.from(SF.woff(fs.readFileSync(files.find((f) => /\.ttf$/i.test(f)))))); files.push(wf); }
assert.ok(files.length >= 8, 'need at least 8 font files, have ' + files.length);

const server = http.createServer((q, r) => {
  const p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'fontedit.html');
  if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.statusCode = 404; return r.end(); }
  r.end(fs.readFileSync(p));
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/fontedit.html', fileUrl = 'file:///' + WEB.replace(/\\/g, '/') + '/fontedit.html';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  try {
    for (const [mode, url] of [['file://', fileUrl], ['http', base]]) {
      const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage(), errs = [];
      pg.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      pg.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errs.push('console ' + m.text()));
      await pg.goto(url); await pg.waitForFunction(() => window.FE && FE.entries && FE.entries.size);
      for (const f of files) {
        await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
        const before = await pg.evaluate(() => FE.entries.size);
        await pg.setInputFiles('#file', f); await pg.waitForTimeout(150);
        await pg.waitForFunction((n) => FE.entries.size > n || [...document.querySelectorAll('.toast')].some((t) => /Cannot/.test(t.textContent)), before, { timeout: 30000 }).catch(() => {});
        const toast = await pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
        const grew = (await pg.evaluate(() => FE.entries.size)) > before, name = path.basename(f);
        if (/Cannot|failed/i.test(toast) || !grew) { bad++; console.log('FAIL ' + mode + ' ' + name + ' -> ' + (toast || 'no family added')); } else ok(mode + ' ' + name + ': ' + toast.slice(0, 90));
      }
      if (errs.length) { bad++; console.log('FAIL ' + mode + ' page errors: ' + errs.slice(0, 5).join(' | ')); } else ok(mode + ' no page or console errors');
      await pg.context().close();
    }
  } finally { await b.close(); server.close(); }
  if (bad) { console.error('FAIL ' + bad + ' problem(s)'); process.exit(1); }
  ok('opened ' + files.length + ' real font files on file:// and http without error');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
