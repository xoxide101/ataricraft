// ACWord proof of concept: boots tools/acword/' + (process.argv[3]||'poc80.xex') + ' on a stock 800XL and reports frame timings.
// Usage: node scripts/acword-poc.cjs [shots]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '800xl').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acword/' + (process.argv[3]||'poc80.xex') + ''));
  await p.evaluate((a) => ataricraft.inspect ? FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)) : 0, bytes);
  await p.waitForTimeout(3000);
  const zp = () => p.evaluate(() => Array.from(ataricraft.peek(0xA0, 6)));
  console.log('full, scroll, key frames:', await zp());
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-1.png' });
  await p.locator('canvas').first().click();
  for (const ch of 'Hello') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
  await p.waitForTimeout(500);
  console.log('after typing:', await zp());
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-2.png' });
  await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
  for (const ch of 'it') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
  await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-3.png' });
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-4.png' });
  console.log('errors:', errs);
  await b.close();
})();

