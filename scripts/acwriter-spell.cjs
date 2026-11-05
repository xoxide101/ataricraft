// ACWriter spell checker in the emulator: loads EN.CDC through the H: device, opens a short text with
// deliberate misspellings, runs Search > Spell check and screenshots the highlighted word.
// Usage: node scripts/acwriter-spell.cjs [130xe|800xl] [EN.CDC|EN8.CDC]
// Screenshots: out/acw-spell-<model>-N.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const MODEL = process.argv[2] || '130xe';
const DICT = process.argv[3] || 'EN.CDC';
const TEXT = "The quick brwon fox jumps over teh lazy dog.\rIt's a fine day, isn't it? Zxqvk wrote this, and dont stop.\r";
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', MODEL).catch((e) => console.log('model select failed', e.message));
  await p.selectOption('#ram', MODEL === '130xe' ? '128' : '64').catch((e) => console.log('ram select failed', e.message));
  console.log('model', await p.inputValue('#model'), 'ram', await p.inputValue('#ram'));
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  const dict = Array.from(fs.readFileSync(ROOT + '/docs/samples/' + DICT));
  await p.evaluate(([d, t]) => { FujiNet.emu.hostWrite('EN.CDC', new Uint8Array(d)); FujiNet.emu.hostWrite('SP.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0)))); }, [dict, TEXT]);
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 600); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-spell-' + MODEL + '-' + n + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) { await key(k, 700); } await p.waitForTimeout(1000); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => ataricraft.peek(x, m), [a, n]);
  await key('ArrowDown', 900);
  await menu('f', 'o');
  await shot('0-menu');
  await type('h:sp.txt');
  await key('Enter', 2500);
  await shot('0-loaded');
  await menu('s', 's');
  await p.waitForTimeout(3000);
  await shot('1-first');
  console.log('first: sv_on', await peek(0x1352), 'sv_xe', await peek(0x135C), 'sv_dl', await peek(0x135E), 'cmsg', await peek(0xAC), 'us/ue/ul', await peek(0x1355, 3), 'sugg', await peek(0x1360));
  await key('i', 1500);
  await shot('2-second');
  console.log('second: us/ue/ul', await peek(0x1355, 3), 'sugg', await peek(0x1360));
  await key('1', 1500);
  await shot('3-after-replace');
  console.log('third: sv_on', await peek(0x1352), 'us/ue/ul', await peek(0x1355, 3));
  await key('a', 1500);
  await shot('4-after-add');
  console.log('next: sv_on', await peek(0x1352), 'us/ue/ul', await peek(0x1355, 3), 'ignored', await peek(0x135F));
  await key('i', 1500);
  await shot('5-end');
  console.log('end: sv_on', await peek(0x1352), 'cmsg', await peek(0xAC));
  console.log('errors:', errs);
  await b.close();
})();
