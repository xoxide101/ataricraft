// ACWriter opens a CWD that carries the page trailer (docs/PAGE.md): text must load, trailer ignored.
// Usage: node scripts/acwriter-pagefile.cjs poc5.xex
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/' + (process.argv[2] || 'poc5.xex')));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500); // leave the start menu
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch, 600); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-' + n + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) { await key(k, 700); } await p.waitForTimeout(1000); };
  console.log('HATABS', await p.evaluate(() => ataricraft.peek(0x31A, 36).map((x) => x.toString(16)).join(' ')));
  const X = require(ROOT + '/tools/xcwcore.cjs');
  const st = (t) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 });
  const doc = X.normalize([{ align: 'l', bullet: false, runs: [st('PAGE TRAILER FILE LOADS OK IN ACWRITER')] }, { align: 'c', bullet: false, runs: [st('centred line')] }]);
  const cwd = X.toCwd(doc, { page: X.Page.normalize({ paper: 'a4', pitch: 12, tabs: [{ pos: 30, kind: 'l' }] }) }).file;
  console.log('file', cwd.length, 'flags', cwd[6]);
  await p.evaluate((a) => FujiNet.emu.hostWrite('PG.CWD', new Uint8Array(a)), Array.from(cwd));
  await key('ArrowDown', 900);
  await menu('f', 'o');
  await type('h:pg');
  await key('Enter', 2000);
  await shot('pagefile');
  console.log('errors:', errs);
  await b.close();
})();