// Screenshot of ACWriter's normal view with a pangram, to compare its 4x7 glyphs with xCWriter. Output: out/acw-glyphs.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const TEXT = 'Standard: The quick brown fox jumps over the lazy dog 0123\rTHE QUICK BROWN FOX JUMPS OVER THE LAZY DOG\r';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.selectOption('#ram', '128').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.evaluate((t) => FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0)))), TEXT);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 800); };
  await key('ArrowDown', 900);
  await key('Escape'); await key('f', 700); await key('o', 700); await type('h:ed.txt'); await key('Enter', 2500);
  await p.waitForTimeout(1500);
  await p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-glyphs.png' });
  await b.close();
})();
