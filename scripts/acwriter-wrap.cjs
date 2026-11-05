// ACWriter word-wrap check: types a long paragraph on a new empty first line and screenshots it.
// Usage: node scripts/acwriter-wrap.cjs poc5.xex
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('ac.profile', 'natural'));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/' + (process.argv[2] || 'poc5.xex')));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500); // leave the start menu
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.keyboard.press('e'); await p.waitForTimeout(400);
  await p.keyboard.press('e'); await p.waitForTimeout(600);
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const text = 'Word wrap breaks this long line at the last space before the right margin so words stay whole';
  for (const ch of text) { await p.keyboard.press(ch === ' ' ? 'Space' : ch); await p.waitForTimeout(300); }
  await p.waitForTimeout(1500);
  await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-wrap.png' });
  for (let i = 0; i < 30; i++) { await p.keyboard.press('Delete'); await p.waitForTimeout(300); }
  await p.waitForTimeout(1000);
  await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-wrap2.png' });
  for (const ch of ' and more words follow here') { await p.keyboard.press(ch === ' ' ? 'Space' : ch); await p.waitForTimeout(300); }
  await p.waitForTimeout(1000);
  await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-wrap3.png' });
  console.log('errors:', errs);
  await b.close();
})();
