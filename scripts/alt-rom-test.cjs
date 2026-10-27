const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 150)));
  await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
  await p.selectOption('#core', 'altirra');
  const hash = () => p.evaluate(() => { const d = ataricraft.peek(0xC000, 0x4000); let h = 0; for (const x of d) h = (h * 31 + x) >>> 0; return h; });
  const out = {};
  const opts = await p.evaluate(() => Array.from(document.getElementById('osrom').options).map((o) => o.value + '=' + o.textContent));
  for (const o of opts) {
    const [v, t] = o.split('=');
    await p.selectOption('#osrom', v);
    await p.click('#boot'); await p.waitForTimeout(2500);
    out[t] = await hash();
  }
  console.log(JSON.stringify(out, null, 1));
  console.log(await p.evaluate(() => ataricraft.screenText().slice(0, 60)), errs);
  await b.close();
})();
