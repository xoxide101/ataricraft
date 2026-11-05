// ACWriter PAGE mode (hmode 4) in the emulator. Screenshots: out/acw-cap-<model>-N.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const MODEL = process.argv[2] || '130xe';
let TEXT = '';
for (let i = 0; i < 190; i++) TEXT += 'x'.repeat(58) + '\r';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', MODEL).catch(() => {});
  await p.selectOption('#ram', MODEL === '130xe' ? '128' : '64').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.evaluate((t) => FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0)))), TEXT);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 800); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-cap-' + MODEL + '-' + n + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  const doc = async (n = 600) => { const a = await peek(0x6400, n); return String.fromCharCode(...a.map((c) => c === 13 || c === 14 ? 124 : c < 32 ? 94 : c)); };
  let fails = 0;
  const check = (name, ok, extra) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 15000);
  const guard = await peek(0x9200, 8);
  const de = async () => { const a = await peek(0xA6, 2); return a[0] + 256 * a[1]; };
  const d0 = await de(); console.log('dend after load', d0.toString(16));
  check('large doc loaded', d0 > 0x8D00, d0.toString(16));
  for (let i = 0; i < 40; i++) await key('x', 600);
  const d1 = await de();
  check('typing stops at the capacity limit (11264 bytes)', d1 <= 0x9000, d1.toString(16));
  check('display list untouched', JSON.stringify(await peek(0x9200, 8)) === JSON.stringify(guard));
  console.log('fails', fails, errs); await b.close(); process.exit(fails ? 1 : 0);
})();


