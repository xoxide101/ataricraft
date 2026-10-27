const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  for (const basic of [true, false]) {
    if (!basic) await p.evaluate(() => document.getElementById('basic').click());
    await p.click('#boot');
    await p.waitForTimeout(2000);
    await p.setInputFiles('#f1', R + 'out/fmt/XFTOOLS.DCM');
    for (const t of [3000, 6000, 10000]) {
      await p.waitForTimeout(t);
      const m = await p.evaluate(() => [...ataricraft.peek(0x700, 16)].map((x) => x.toString(16)).join(' '));
      const st = await p.evaluate(() => ({ pc: ataricraft.state().frames, txt: ataricraft.screenText().split('\n').filter((l) => l.trim()).slice(0, 6) }));
      console.log('basic=' + basic, 't+' + t, '$700:', m, JSON.stringify(st.txt));
    }
  }
  await b.close();
})();
