const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: +(process.argv[3] || 1500), height: +(process.argv[4] || 950) } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message + (e.stack ? ' ' + e.stack.split('\n')[1] : '')));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('file:///' + path.resolve(__dirname, '..', 'web', 'fontedit.html').replace(/\\/g, '/'));
  await p.waitForTimeout(1500);
  const sizes = await p.$$eval('#sizes .sz', (a) => a.map((x) => x.dataset.size + (x.classList.contains('missing') ? '(m)' : '')));
  console.log('sizes', sizes.join(' '));
  await p.screenshot({ path: path.resolve(__dirname, '..', 'out', process.argv[2] || 'fe-smoke.png') });
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
