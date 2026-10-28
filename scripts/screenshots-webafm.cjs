const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const RR = R + 'web/library/craftapps/Ready to run/';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
  pg.on('pageerror', (e) => console.log('ERR', e.message));
  await pg.goto('file:///' + R + 'web/index.html');
  await pg.waitForTimeout(1500);
  const load = (f) => fs.readFileSync(RR + f).toString('base64');
  await pg.evaluate(async ([a, c]) => {
    const u8 = (s) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
    AC.WebAfm.open();
    await AC.WebAfm.openFile(0, new File([u8(a)], 'SpartaDOS 720K boot + AFM.atr'));
    await AC.WebAfm.openFile(1, new File([u8(c)], 'DOS 2.5 boot + AFM.atr'));
  }, [load('SpartaDOS 720K boot + AFM.atr'), load('DOS 2.5 boot + AFM.atr')]);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: R + 'docs/screenshots/07-webafm.png' });
  await b.close();
})();
