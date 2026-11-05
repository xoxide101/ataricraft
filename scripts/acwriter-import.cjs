// Opens converted .CWD files (from tools/craftimport.cjs) in the app through the H: device and screenshots each.
// Usage: node scripts/acwriter-import.cjs poc5.xex FILE1.CWD FILE2.CWD ...   (files from out/ ; screenshots out/acw-imp-NAME.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const xex = process.argv[2] || 'poc5.xex', files = process.argv.slice(3);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), Array.from(fs.readFileSync(ROOT + '/tools/acwriter/' + xex)));
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500); // leave the start menu
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch, 600); };
  await key('ArrowDown', 900);
  for (const f of files) {
    const name = path.basename(f, path.extname(f)).toUpperCase();
    await p.evaluate(([n, a]) => FujiNet.emu.hostWrite(n + '.CWD', new Uint8Array(a)), [name, Array.from(fs.readFileSync(ROOT + '/out/' + f))]);
    await key('Escape'); await key('f', 700); await key('o', 700); await p.waitForTimeout(800);
    await type('h:' + name.toLowerCase()); await key('Enter', 2000);
    await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-imp-' + name + '.png' });
  }
  console.log('errors:', errs);
  await b.close();
})();
