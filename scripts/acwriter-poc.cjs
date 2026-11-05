// ACWriter proof of concept: boots tools/acwriter/' + (process.argv[3]||'poc80.xex') + ' on a stock 800XL and reports frame timings.
// Usage: node scripts/acwriter-poc.cjs [shots]
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
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/' + (process.argv[3]||'poc80.xex') + ''));
  await p.evaluate((a) => ataricraft.inspect ? FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)) : 0, bytes);
  await p.waitForTimeout(3000);
  const zp = () => p.evaluate(() => Array.from(ataricraft.peek(0xA0, 6)));
  console.log('full, scroll, key frames:', await zp());
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-1.png' });
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500); // leave the start menu
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
    await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
    for (const ch of 'si') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
    await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-5.png' });
    await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
    for (const ch of 'li') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
    await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    await p.keyboard.press('Enter'); await p.waitForTimeout(9000);
    if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-6.png' }); console.log('zp', (await p.evaluate(() => Array.from(ataricraft.peek(0x90, 64)))).map(x=>x.toString(16)).join(' '));
  await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
  for (const ch of 'ru') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-7.png' });
  await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
  for (const ch of 'ba') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-8.png' });
  await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
  for (const ch of 'co') { await p.keyboard.press(ch); await p.waitForTimeout(250); }
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-9.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-10.png' });
  await p.keyboard.press('c'); await p.waitForTimeout(500);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-11.png' });
  await p.keyboard.press('b'); await p.waitForTimeout(500);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-12.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press('d'); await p.waitForTimeout(400);
  await p.keyboard.press('h'); await p.waitForTimeout(500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press('c'); await p.waitForTimeout(2000);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-13.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press('d'); await p.waitForTimeout(400);
  await p.keyboard.press('m'); await p.waitForTimeout(1000);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-14.png' });
  for (const ch of 'abc def ghi') { await p.keyboard.press(ch === ' ' ? 'Space' : ch); await p.waitForTimeout(300); }
  await p.waitForTimeout(1500);
  if (process.argv[2] === 'shots') await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw80-15.png' });
  console.log('errors:', errs);
  await b.close();
})();




