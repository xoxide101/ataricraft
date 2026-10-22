const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const atr = fs.readFileSync(R + 'software_n_roms/Rene Rom images disk 4 Side B.atr');
  const n = (atr.length - 16) / 128;
  const pro = Buffer.alloc(16 + n * 140);
  pro[0] = n >> 8; pro[1] = n & 255; pro[2] = 0x50;
  for (let s = 0; s < n; s++) {
    const o = 16 + s * 140;
    pro[o + 1] = 0xff;
    atr.copy(pro, o + 12, 16 + s * 128, 16 + (s + 1) * 128);
  }
  fs.mkdirSync(R + 'out/fmt', { recursive: true });
  fs.writeFileSync(R + 'out/fmt/test.pro', pro);
  fs.copyFileSync(R + 'software_n_roms/Rene Rom images disk 4 Side A.atr', R + 'out/fmt/test.atr');

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.click('#boot');
  await p.waitForTimeout(2500);
  for (const f of ['test.atr', 'test.pro', 'XFTOOLS.DCM']) {
    await p.setInputFiles('#f1', R + 'out/fmt/' + f);
    await p.waitForTimeout(8000);
    console.log('=== ' + f, '|', await p.textContent('#status'), '|', await p.textContent('#d1'));
    console.log((await p.evaluate(() => ataricraft.screenText())).split('\n').filter((l) => l.trim()).slice(0, 8).join('\n'));
    await p.locator('#screen').screenshot({ path: R + 'out/fmt/' + f + '.png' });
  }
  await b.close();
})();
