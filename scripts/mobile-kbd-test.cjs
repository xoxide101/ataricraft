// Phone layout test (Pixel 6 Pro XL: 412x892 portrait, 892x412 landscape): keyboard reachable, Arrows/Pad tabs work.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  for (const [w, h, tag] of [[412, 892, 'portrait'], [892, 412, 'landscape']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
    await p.waitForTimeout(800);
    const info = await p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); const b = e && e.getBoundingClientRect(); return b && [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      return { screen: r('#screen'), kbd: r('#kbd'), mini: r('#kmini .amini'), center: r('.center'), scrollable: document.querySelector('.center').scrollHeight > document.querySelector('.center').clientHeight };
    });
    console.log(tag, JSON.stringify(info));
    await p.screenshot({ path: `out/mobile-${tag}-keys.png` });
    await p.click('#kbmode [data-m=arrows]'); await p.waitForTimeout(200);
    const arr = await p.evaluate(() => [!document.getElementById('karrows').hidden, document.querySelectorAll('#karrows .akey').length, document.getElementById('kbd').hidden]);
    console.log(tag, 'arrows', JSON.stringify(arr)); if (!arr[0] || arr[1] < 10 || !arr[2]) bad++;
    await p.screenshot({ path: `out/mobile-${tag}-arrows.png` });
    await p.click('#kbmode [data-m=pad]'); await p.waitForTimeout(200);
    const pad = await p.evaluate(() => { const a = document.getElementById('padarea2').getBoundingClientRect(); return [!document.getElementById('kpad').hidden, document.getElementById('padon').checked, Math.round(a.width), Math.round(a.height)]; });
    console.log(tag, 'pad', JSON.stringify(pad)); if (!pad[0] || !pad[1]) bad++;
    await p.screenshot({ path: `out/mobile-${tag}-pad.png` });
    await p.click('#kbmode [data-m=keys]'); await p.waitForTimeout(200);
    const back = await p.evaluate(() => document.getElementById('padon').checked); console.log(tag, 'pad restored off:', !back); if (back) bad++;
    console.log(tag, 'errors', errs); if (errs.length) bad++;
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
