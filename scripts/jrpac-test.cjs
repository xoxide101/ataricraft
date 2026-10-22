const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.click('#boot');
  await p.waitForTimeout(2000);
  await p.setInputFiles('#medfolder', R + 'out/jr');
  await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => [...document.querySelectorAll('#medlist div')].map((d) => d.textContent).join(' | ')));
  await p.click('#medlist div >> nth=0');
  await p.waitForTimeout(6000);
  console.log('status:', await p.textContent('#status'));
  console.log('type opts:', await p.evaluate(() => document.querySelector('#ctype') && [...document.querySelectorAll('#ctype option')].map((o) => o.textContent).slice(0, 5)));
  console.log((await p.evaluate(() => JSON.parse(localStorage.getItem('ac.diag')))).slice(-6).join('\n'));
  await p.screenshot({ path: R + 'out/jr.png' });
  await b.close();
})();


