const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
  await p.selectOption('#core', 'altirra');
  await p.click('#boot'); await p.waitForTimeout(3000);
  const scr = () => p.evaluate(() => ataricraft.screenText().replace(/\n+/g, '|'));
  await p.evaluate(() => ataricraft.type('10 PRINT "HOSTTEST"\nLIST "H:T.LST"\nNEW\nENTER "H:T.LST"\nLIST\n'));
  await p.waitForTimeout(6000);
  console.log('H:', (await scr()).slice(-160));
  await p.evaluate(() => ataricraft.type('NEW\n10 ? STICK(0);" ";STRIG(0)\n20 GOTO 10\nRUN\n'));
  await p.waitForTimeout(9000);
  const base = (await scr()).slice(-40);
  await p.evaluate(() => ataricraft.joy(1, 1)); await p.waitForTimeout(1000);
  const up = (await scr()).slice(-40);
  await p.evaluate(() => ataricraft.joy(0, 0));
  console.log('joy base', base, '\njoy up+fire', up);
  console.log('errs', errs);
  await b.close();
})();

