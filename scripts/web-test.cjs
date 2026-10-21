// Headless check: open web/index.html from file://, boot, type into BASIC, save screenshots.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '..', '..', 'craftapi', 'node_modules', 'playwright-core'));
const root = path.resolve(__dirname, '..');
const roms = path.join(root, 'software_n_roms');
const out = path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file:///' + path.join(root, 'web', 'index.html').replace(/\\/g, '/'));
  await page.setInputFiles('#romfiles', [path.join(roms, 'ATARIXL.ROM'), path.join(roms, 'ATARIBAS.ROM')]);
  await page.evaluate(() => ataricraft.boot({ model: '130xe', basic: true }));
  await page.evaluate(() => { ataricraft.pause(); ataricraft.step(60); });
  fs.writeFileSync(path.join(out, 'ready.png'), Buffer.from((await page.evaluate(() => ataricraft.screenshot({ scale: 2 }))).split(',')[1], 'base64'));
  console.log('text after boot:\n' + await page.evaluate(() => ataricraft.screenText()));
  await page.evaluate(() => { ataricraft.type('PRINT "HELLO FROM AGENT"\n'); ataricraft.step(300); });
  console.log('text after type:\n' + await page.evaluate(() => ataricraft.screenText()));
  await page.evaluate(() => ataricraft.type('10 FOR I=0 TO 15:POKE 712,I*16+6:NEXT I\nRUN\n'));
  await page.evaluate(() => ataricraft.step(500));
  fs.writeFileSync(path.join(out, 'typed.png'), Buffer.from((await page.evaluate(() => ataricraft.screenshot({ scale: 2 }))).split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(out, 'page.png') });
  console.log('state', JSON.stringify(await page.evaluate(() => ataricraft.state())));
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
