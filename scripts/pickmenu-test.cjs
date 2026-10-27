// Click loads into #1; right-click / long-press opens a D1-D8 / Cart 1-2 menu; drive pulldowns are gone.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const R = 'C:/Users/raver/ataricraft/';
(async () => {
  fs.mkdirSync(R + 'out/pick', { recursive: true });
  const atr = Buffer.alloc(16 + 720 * 128); atr[0] = 0x96; atr[1] = 0x02; atr[2] = (720 * 128 / 16) & 255; atr[3] = (720 * 128 / 16) >> 8; atr[4] = 128;
  fs.writeFileSync(R + 'out/pick/Game - Test - Me - v1 - 2026.atr', atr);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);
  await p.click('#sidetabs button[data-t=fm]');
  await p.setInputFiles('#medfolder', R + 'out/pick'); await p.waitForTimeout(800);
  await p.fill('#medfilter', 'Game - Test'); await p.waitForTimeout(500);
  const row = p.locator('#medlist div', { hasText: 'Game - Test' }).first();
  await row.click(); await p.waitForTimeout(800);
  const d1 = await p.textContent('#d1');
  await row.click({ button: 'right' });
  const items = await p.locator('.pickmenu div').allTextContents();
  await p.locator('.pickmenu div', { hasText: 'D3:' }).click(); await p.waitForTimeout(800);
  const s1 = await p.evaluate(() => document.querySelectorAll('#savedrv, #fsdrv, #blankslot').length);
  const hidden = await p.evaluate(() => ['savedrv', 'fsdrv', 'blankslot'].map((i) => document.getElementById(i).type));
  // long-press via touch events
  await p.fill('#medfilter', 'Game - Test'); await p.waitForTimeout(500);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('#medlist div')].find((d) => d.textContent.includes('Game - Test'));
    const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(700);
  const lp = await p.locator('.pickmenu div').count();
  console.log({ d1, items: items.length, first: items[0], d3: await p.evaluate(() => (window.ataricraft && 1) && document.querySelector('#medlist') && 1), selects: s1, hidden, longPressMenu: lp > 0 });
  console.log(await p.evaluate(() => document.getElementById('diagcount')?.textContent));
  console.log(errs); await b.close();
})();

