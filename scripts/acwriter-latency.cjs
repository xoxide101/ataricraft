const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', process.argv[2] || '130xe').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(process.argv[3] || ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(8000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  for (const k of 'abcdef') { await p.keyboard.press(k); await p.waitForTimeout(600); }
  console.log('mfull/mkey', await p.evaluate(() => Array.from(ataricraft.peek(0xA0, 3))));
  await b.close();
})();
