// ACWord indent and bullet check.
// Usage: node scripts/acword-align.cjs poc5.xex
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
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acword/' + (process.argv[2] || 'poc5.xex')));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch, 600); };
  let n = 0; const shot = () => p.locator('canvas').first().screenshot({ path: ROOT + '/out/als' + (n++) + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) { await key(k, 700); } await p.waitForTimeout(1000); };
  await key('ArrowDown', 900);
  await menu('c', 'y');
  await key('ArrowRight', 500); await key('ArrowRight', 500); await key('ArrowDown', 500);
  await p.waitForTimeout(800); await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-pk1.png' });
  await key('Enter', 1500);
  await menu('c', 'y'); await key('Space', 800); await key('ArrowRight', 500);
  await p.waitForTimeout(800); await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-pk2.png' });
  await key('Enter', 1500);
  await p.waitForTimeout(1500);
  await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-pk3.png' });
  console.log('errors:', errs);
  await b.close();
})();









