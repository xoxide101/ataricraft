const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const [name, vp] of [['port', { width: 412, height: 892 }], ['land', { width: 892, height: 412 }], ['tabport', { width: 800, height: 1280 }], ['tabland', { width: 1280, height: 800 }], ['desk', { width: 1366, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 3.5, isMobile: name !== 'desk', hasTouch: name !== 'desk' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
    await p.waitForTimeout(500);
    await p.screenshot({ path: `out/px-${name}-0.png` });
    if (name !== 'desk') await p.setInputFiles('#romfiles', ['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM', 'C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM']);
    else await p.setInputFiles('#romfiles', ['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM', 'C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM']);
    await p.click('#boot'); await p.waitForTimeout(3000);
    const m = await p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, screen: r('#screen'), kbd: r('#kbdwrap'), sideVisible: getComputedStyle(document.querySelector('.side')).display };
    });
    console.log(name, JSON.stringify(m));
    await p.screenshot({ path: `out/px-${name}-1.png` });
    await p.click('#sbtoggle');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `out/px-${name}-2.png` });
    console.log(name, 'sidebar after toggle:', await p.evaluate(() => getComputedStyle(document.querySelector('.side')).display), errs);
    await ctx.close();
  }
  await b.close();
})();
