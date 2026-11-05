// Bank-count probe (bk_cnt -> sv_nb at $07E5) on each emulator RAM size.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const CASES = [['xl', '64', 1], ['130xe', '128', 4], ['130xe', '320r', 16], ['130xe', '320c', 16], ['130xe', '576', 16], ['130xe', '1088', 32]];
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let fails = 0;
  for (const [model, ram, want] of CASES) {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#model', model).catch(() => {});
    const ok = await p.selectOption('#ram', ram).then(() => true).catch(() => false);
    await p.click('#boot'); await p.waitForTimeout(3000);
    const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
    await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
    await p.waitForTimeout(6000);
    const nb = await p.evaluate(() => ataricraft.peek(0x07E5, 1)[0]);
    const pass = ok && nb === want;
    if (!pass) fails++;
    console.log(pass ? 'ok  ' : 'FAIL', model, ram, 'banks=' + nb, 'want ' + want, ok ? '' : '(ram option missing)');
    await p.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
