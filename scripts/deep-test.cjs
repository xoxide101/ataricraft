const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const D = R + 'out/deep';
  if (!fs.existsSync(D)) { console.log('SKIP: out/deep missing'); return; }
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => { errs.push(e.message); console.log('ERR', e.message); });
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfolder', D);
  await p.waitForTimeout(1500);
  await p.setInputFiles('#medfolder', D);
  await p.waitForTimeout(3000);
  const rows = async (f) => { await p.fill('#medfilter', f); await p.waitForTimeout(400); return p.evaluate(() => [...document.querySelectorAll('#medlist div')].map((d) => d.textContent.trim())); };
  console.log('romstate:', await p.textContent('#romstate'));
  const osv = await p.evaluate(() => { const o = [...document.querySelectorAll('#osrom option')]; return (o.find((x) => /REV\. ?2/.test(x.text)) || o[1]).value; });
  await p.selectOption('#osrom', osv); await p.click('#boot'); await p.waitForTimeout(2000);
  let fails = 0;
  for (const [f, re] of [['pogoman', /pogoman.*atr/i], ['Mars Mission', /mars.*atr/i], ['achase', /astro chase.*rom/i], ['action', /action.*rom/i], ['abracadabra', /abracadabra.*rom/i], ['Aztec', /aztec.*atr/i]]) {
    const r = await rows(f);
    console.log(f, '->', r.join(' | '));
    const loc = p.locator('#medlist div', { hasText: re }).first();
    if (!(await loc.count())) { console.log('FAIL not listed:', f); fails++; continue; }
    await loc.click(); await p.waitForTimeout(3500);
    console.log('  status:', await p.textContent('#status'), '| d1:', await p.textContent('#d1'), '| pc:', await p.evaluate(() => ataricraft.peek(0x700, 4).join(',')));
  }
  const m = await rows('mss');
  console.log('7z rows:', m.join(' | '));
  await b.close();
  console.log(errs.length || fails ? 'DEEP FAIL' : 'DEEP OK');
})();
