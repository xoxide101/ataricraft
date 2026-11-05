// ACWriter glyph map: every ASCII character 32..126 in rows of 16 labelled with the hex code of the row start, shown in the 64-column
// view, PAGE mode and the PAGE 2x zoom. Shots: out/shots/fonts/map-acw-1x.png, map-acw-page.png, map-acw-zoom.png (3x blow-ups).
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const OUT = ROOT + '/out/shots/fonts/';
const rows = [];
for (let a = 32; a < 127; a += 16) {
  let s = a.toString(16).toUpperCase() + ':';
  for (let c = a; c < a + 16 && c < 127; c++) s += String.fromCharCode(c);
  rows.push(s);
}
const SHEET = rows.join('\r') + '\r';
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
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period' };
  const type = async (s) => { for (const ch of s) await key(MAP[ch] || ch, 700); };
  const menu = async (...ks) => { await key('Escape', 700); for (const k of ks) await key(k, 700); await p.waitForTimeout(800); };
  const shot = async (n, k = 3, crop = null) => {
    const url = await p.evaluate(([k, crop]) => {
      const c = document.querySelector('canvas'), o = document.createElement('canvas');
      const sx = crop ? crop[0] * c.width : 0, sy = crop ? crop[1] * c.height : 0, sw = crop ? crop[2] * c.width : c.width, sh = crop ? crop[3] * c.height : c.height;
      o.width = sw * k; o.height = sh * k;
      const x = o.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
      return o.toDataURL('image/png');
    }, [k, crop]);
    fs.writeFileSync(OUT + n, Buffer.from(url.split(',')[1], 'base64'));
  };
  await key('Escape'); await key('f', 700); await key('o', 700); await type('h:ed.txt'); await key('Enter', 2500);
  await p.waitForTimeout(1200); await shot('map-acw-1x.png', 6, [0.02, 0.1, 0.45, 0.3]);
  await menu('l', 'v'); await p.waitForTimeout(2500); await shot('map-acw-page.png');
  await menu('l', 'z'); await p.waitForTimeout(2500); await shot('map-acw-zoom.png');
  console.log('errors:', errs);
  await b.close();
})();
