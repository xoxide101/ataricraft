const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const R = 'C:/Users/raver/ataricraft/';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const dir = process.argv[2];
if (!dir) { console.log('usage: node scripts/romclass-test.cjs <folder of ROMs>'); process.exit(2); }
const files = walk(dir).filter((f) => [8192, 10240, 16384].includes(fs.statSync(f).size));
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', files);
  await p.waitForTimeout(4000);
  const st = await p.evaluate(() => document.getElementById('romstate').textContent);
  const bad = await p.evaluate(() => {
    return [...document.getElementById('osrom').options].map((o) => o.textContent).filter((t) => /MIO|Black ?Box|bbrom|\bDOS\b/i.test(t));
  });
  console.log('input', files.length, '|', st);
  console.log('non-OS names in OS list:', bad.length, bad.slice(0, 5));
  console.log('errors', errs);
  await b.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})();
