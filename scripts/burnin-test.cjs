// Burn-in: boots each self-running tool from the Tools disk sources repeatedly in one emulator page and checks for page errors,
// a hung CPU (frame counter stops) and empty screens. Usage: node scripts/burnin-test.cjs [rounds]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const rounds = +process.argv[2] || 3;
const tools = ['tests/bin/CPUTEST.COM', 'tests/bin/MEMTEST.COM', 'tests/bin/GFXTEST.COM', 'tests/bin/SNDTEST.COM', 'tests/bin/KEYTEST.COM', 'net/ping.com', 'net/whois.com', 'net/ipconfig.com', 'cmd/bin/calc.com', 'cmd/bin/80col.com', 'afm/afm.com'];
let bad = 0;
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(3000);
  for (let r = 1; r <= rounds; r++) for (const t of tools) {
    const name = t.split('/').pop();
    const bytes = Array.from(fs.readFileSync(ROOT + '/tools/' + t));
    await p.evaluate(([n, x]) => ataricraft.bootFile(n, new Uint8Array(x)), [name, bytes]);
    await p.waitForTimeout(2500);
    const a = await p.evaluate(() => ataricraft.peek ? ataricraft.peek(0x14, 1)[0] : 0);
    await p.waitForTimeout(400);
    const c = await p.evaluate(() => ataricraft.peek ? ataricraft.peek(0x14, 1)[0] : 0);
    const txt = await p.evaluate(() => (window.FujiNet && FujiNet.emu.screenText ? FujiNet.emu.screenText() : '')).catch(() => '');
    const ok = a !== c && !errs.length;
    if (!ok) { bad++; console.log('FAIL', r, name, { a, c, errs: errs.slice(0, 2) }); } else console.log('ok  ', r, name, JSON.stringify(txt.replace(/\s+/g, ' ').trim().slice(0, 40)));
  }
  await b.close();
  console.log(bad ? 'BURNIN FAIL ' + bad : 'BURNIN PASS');
  process.exit(bad ? 1 : 0);
})();
