// Compiles BASIC with web/js/bcomp.js, boots the XEX as AUTORUN.SYS in the real emulator and checks the screen. node scripts/bcomp-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const BComp = require(ROOT + '/web/js/bcomp.js');
(async () => {
  const src = '10 FOR I=1 TO 5\n20 PRINT "SQUARE ";I;" = ";I*I\n30 NEXT I\n40 PRINT "DONE"\n50 GOTO 50';
  const r = BComp.compile(src);
  if (r.errors.length) { console.log('compile errors', r.errors); process.exit(1); }
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  const Dos = require(ROOT + '/web/js/dosfs.js');
  const img = new Uint8Array(fs.readFileSync(ROOT + '/web/library/craftapps/DOS images/Atari DOS 2.5.atr'));
  const v = Dos.open(img); v.writeFile('AUTORUN.SYS', new Uint8Array(r.xex));
  await p.setInputFiles('#f1', { name: 'BC.atr', mimeType: 'application/octet-stream', buffer: Buffer.from(v.image ? v.image() : img) });
  await p.click('#boot'); await p.waitForTimeout(9000);
  const t = await p.evaluate(() => ataricraft.screenText());
  console.log(t.split('\n').slice(0, 10).join('\n'));
  const pass = /SQUARE 5 = 25/.test(t) && /DONE/.test(t) && !errs.length;
  await b.close();
  console.log(pass ? 'BCOMP E2E PASS' : 'BCOMP E2E FAIL ' + errs);
  process.exit(pass ? 0 : 1);
})();
