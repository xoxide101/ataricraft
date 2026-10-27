const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const b64 = (f) => fs.readFileSync(f).toString('base64');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
  await p.selectOption('#core', 'altirra');
  const T = async (name, fn) => { try { console.log(name, JSON.stringify(await fn())); } catch (e) { console.log(name, 'ERR', e.message); } };
  await p.click('#boot'); await p.waitForTimeout(3000);

  // H: drive: LIST to H:, then check host files, then ENTER back
  await T('H: list', async () => {
    await p.evaluate(() => ataricraft.type('10 PRINT "HOSTTEST"\nLIST "H:T.LST"\n'));
    await p.waitForTimeout(4000);
    return p.evaluate(() => Object.keys(window.__emu ? {} : {}) .concat(Array.from(document.querySelectorAll('#hostlist .row span:first-child')).map((e) => e.textContent)));
  });
  await T('H: enter', async () => {
    await p.evaluate(() => ataricraft.type('NEW\nENTER "H:T.LST"\nLIST\n'));
    await p.waitForTimeout(4000);
    return p.evaluate(() => ataricraft.screenText());
  });

  // joystick: 10 PRINT STICK(0) via BASIC
  await T('joy', async () => {
    await p.evaluate(() => ataricraft.type('NEW\n10 ? STICK(0);STRIG(0):GOTO 10\nRUN\n'));
    await p.waitForTimeout(1500);
    await p.evaluate(() => ataricraft.joy(1, 1)); await p.waitForTimeout(800);
    const up = await p.evaluate(() => ataricraft.screenText().split('\n').slice(-3).join('|'));
    await p.evaluate(() => ataricraft.joy(8, 1)); await p.waitForTimeout(800);
    const rf = await p.evaluate(() => ataricraft.screenText().split('\n').slice(-3).join('|'));
    await p.evaluate(() => ataricraft.joy(0, 0));
    return { up, rf };
  });

  // cart
  await T('cart', async () => {
    const f = 'C:/Users/raver/ataricraft/software_n_roms/800 - Alf In Color Caves.car';
    const r = await p.evaluate((b) => ataricraft.insertCart(1, 'a.car', Uint8Array.from(atob(b), (c) => c.charCodeAt(0))), b64(f));
    await p.waitForTimeout(3000);
    return { r, s: await p.evaluate(() => ataricraft.screenText().slice(0, 80)) };
  });
  await T('hostfiles', () => p.evaluate(() => Object.keys(ataricraft.hostFiles ? ataricraft.hostFiles() : {})));
  console.log(errs.slice(0, 5));
  await p.screenshot({ path: 'out/alt4.png' });
  await b.close();
})();
