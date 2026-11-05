// ACWriter font test sheet: alphabet in both cases, digits, punctuation, a paragraph, then H2O / x2 typed with sub/super styles.
// Shots (canvas only): out/shots/fonts/sheet-acw-1x.png (64-col view), sheet-acw-page.png (PAGE mode), sheet-acw-zoom.png (PAGE 2x).
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const OUT = ROOT + '/out/shots/fonts/';
const SHEET = [
  '', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?.,:;-_()[]{}<>/\\|+=*#$%&@"\'',
  'Illinois 1l I1 O0 Oo gjpqy bdfhkl', 'The quick brown fox jumps over the lazy dog.', 'Pack my box with five dozen liquor jugs.',
  'Craft keeps one font per paragraph. Wrapping, tabs, margins and spelling all work on a stock Atari.', '',
].join('\r');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
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
  await p.evaluate((t) => FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0)))), SHEET);
  const key = async (k, w = 800) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period',
    // MAME positional map: Atari '*' = Backslash (shift -> '^'), '=' = BracketRight, '+' = Quote, '-' = BracketLeft
    '^': 'Shift+Backslash', '=': 'BracketRight', '*': 'Backslash', '+': 'Quote', '-': 'BracketLeft' };
  const type = async (s) => { for (const ch of s) await key(MAP[ch] || ch, 700); };
  const menu = async (...ks) => { await key('Escape', 700); for (const k of ks) await key(k, 700); await p.waitForTimeout(800); };
  // nearest-neighbour blow-up of the emulator canvas so single pixels stay legible in the saved shot
  const shot = async (n) => {
    const url = await p.evaluate(() => {
      const c = document.querySelector('canvas'), k = 3, o = document.createElement('canvas');
      o.width = c.width * k; o.height = c.height * k;
      const x = o.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, o.width, o.height);
      return o.toDataURL('image/png');
    });
    fs.writeFileSync(OUT + n, Buffer.from(url.split(',')[1], 'base64'));
  };
  await key('Escape'); await key('f', 700); await key('o', 700); await type('h:ed.txt'); await key('Enter', 2500);
  await type('H'); await menu('c', 'd'); await type('2'); await menu('c', 'd'); await type('O  x'); await menu('c', 'p'); await type('2'); await menu('c', 'p');
  await type(' E=mc^'); await menu('c', 'p'); await type('2'); await menu('c', 'p'); await type(' a'); await menu('c', 'd'); await type('1'); await menu('c', 'd');
  await p.waitForTimeout(1200);
  await shot('sheet-acw-1x.png');
  await menu('l', 'v'); await p.waitForTimeout(2500);
  await shot('sheet-acw-page.png');
  await menu('l', 'z'); await p.waitForTimeout(2500);
  await shot('sheet-acw-zoom.png');
  console.log('errors:', errs);
  await b.close();
})();
