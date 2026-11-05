// ACWriter home screen, help page, convert/import and the Open fallback.
// Usage: node scripts/acwriter-home.cjs [poc5.xex]   (screenshots in out/acw-home*.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '800xl').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/' + (process.argv[2] || 'poc5.xex')));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(12000);
  const key = async (k, w = 3500) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch, 600); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-home' + n + '.png' });
  const peek = (a, n) => p.evaluate(([a, n]) => ataricraft.peek(a, n), [a, n]);
  const sample = fs.readFileSync(ROOT + '/docs/samples/import/firstxlent-sample.bin');
  await p.evaluate((a) => FujiNet.emu.hostWrite('FX.TXT', new Uint8Array(a)), Array.from(sample));

  console.log('hmode at launch', await peek(0x1330, 1));
  await shot('1-launch');
  await key('ArrowDown'); await key('ArrowDown');
  await shot('2-select');
  await key('h');
  await shot('3-help');
  for (let i = 0; i < 3; i++) await key('Space');
  await shot('4-help-scrolled');
  await key('Escape');
  await key('c');
  await shot('5-convert');
  await key('i');
  await type('h:fx.txt');
  await key('Enter', 5000);
  await shot('6-imported');
  console.log('isz', await peek(0x1339, 2), 'cmsg', await peek(0x1330 - 0x1330 + 0, 0));
  await key('e');
  await shot('7-editor');
  await key('Escape'); await key('f', 1500); await key('h');
  await shot('8-home-again');
  await key('Escape');
  await shot('9-back');
  // File > Open on a plain file (no CRFT header) falls back to the import; ^C at line start centres / right-aligns
  const long = 'Open fallback: a long plain text line that has to be wrapped at sixty-four columns by the importer, with soft breaks.';
  const ct = Buffer.concat([Buffer.from([3]), Buffer.from('Centred title\x9b'), Buffer.from([3, 3]), Buffer.from('Right aligned\x9b'), Buffer.from(long + '\x9b'), Buffer.from('Last line\x9b', 'latin1')]);
  await p.evaluate((a) => FujiNet.emu.hostWrite('CT.TXT', new Uint8Array(a)), Array.from(ct));
  await key('Escape'); await key('f', 1500); await key('o', 1500);
  await type('h:ct.txt');
  await key('Enter', 6000);
  await shot('10-open-fallback');
  await key('F1', 5000);
  await shot('11-f1-help');
  await key('Escape');
  await shot('12-after-f1');
  console.log('hmode', await peek(0x1330, 1));
  await key('Escape'); await key('f', 1500); await key('h'); await key('q', 4000);
  await shot('13-quit');
  await key('Escape'); await key('f', 1500); await key('h'); await key('q', 4000);
  await shot('13-quit');
  console.log('errors:', errs);
  await b.close();
})();





