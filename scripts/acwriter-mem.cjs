// ACWriter PAGE mode (hmode 4) in the emulator. Screenshots: out/acw-page-<model>-N.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const MODEL = process.argv[2] || '130xe';
let TEXT = 'alpha beta gamma\rDelta epsilon zeta\rEta theta iota\r';
for (let i = 4; i <= 12; i++) TEXT += 'line number ' + i + ' filler text that is long enough to need wrapping in the page view at ten characters per inch\r';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', MODEL).catch(() => {});
  await p.selectOption('#ram', MODEL === '130xe' ? '128' : '64').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-' + n + '.png' });
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  await p.waitForTimeout(8000);
  console.log(MODEL, 'cmsg', (await peek(0xAC))[0], 'sv_xe', (await peek(0x135C))[0]);
  await shot('mem-' + MODEL);
  await b.close();
})();

