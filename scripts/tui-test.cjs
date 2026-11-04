// Runs tools/tui/tuidemo.com in the real emulator: draws, Esc opens the menu, Down+Return picks About. node scripts/tui-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  const Dos = require(ROOT + '/web/js/dosfs.js');
  const img = new Uint8Array(fs.readFileSync(ROOT + '/web/library/craftapps/DOS images/Atari DOS 2.5.atr'));
  const v = Dos.open(img); v.writeFile('AUTORUN.SYS', new Uint8Array(fs.readFileSync(ROOT + '/tools/tui/tuidemo.com')));
  await p.setInputFiles('#f1', { name: 'TUI.atr', mimeType: 'application/octet-stream', buffer: Buffer.from(v.image ? v.image() : img) });
  await p.click('#boot'); await p.waitForTimeout(9000);
  await p.screenshot({ path: ROOT + '/out/tui-0.png' });
  let ok = true;
  const t0 = await p.evaluate(() => ataricraft.screenText());
  console.log(t0.split('\n').slice(0, 8).join('\n'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.screenshot({ path: ROOT + '/out/tui-1.png' });
  const t1 = await p.evaluate(() => ataricraft.screenText());
  console.log(t1.split('\n').slice(0, 8).join('\n'));
  await b.close();
  console.log(errs.length ? 'errors ' + errs : 'done');
})();
