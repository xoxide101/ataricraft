const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const [n,w,h] of [['d',1366,900],['p',412,892]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log('ERR', e.message));
    await p.goto('file:///' + R + 'web/index.html');
    await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
    await p.waitForTimeout(800);
    await p.click('#boot'); await p.waitForTimeout(2500);
    await p.screenshot({ path: R + 'out/toast-' + n + '.png' });
    console.log(n, await p.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  }
  await b.close();
})();
