// Contact sheet of the pipeline results: node scripts/fontpipe-sheet.cjs  ->  out/fontpipe-sheet.png (view a copy named *-v.png)
// Each font is run down/up, exported to TTF, read back, and drawn at its sizes next to each other.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const FP = require('../tools/fontpipe.cjs'), CF = require('../tools/craftfont.cjs');
const root = path.join(__dirname, '..');
const SRC = ['font_personal/Atari8bit.ttf', 'web/library/fonts/PressStart2P.ttf', 'web/library/fonts/Connection.otf', 'web/library/fonts/Kidpixies.ttf', 'font_personal/FONT.FNT', 'software_n_roms/ATARIXL.ROM', 'font/craft12.acf']
  .filter((f) => fs.existsSync(path.join(root, f)));
const TEXT = 'Hamburgefonstiv 0123456789 Quick fox jumps, H\u2082O x\u00b2';

function line(f, text) {
  const px = []; let x = 0;
  const cols = [];
  for (const ch of text) {
    const code = FP.codeOfUni ? FP.codeOfUni(ch.codePointAt(0)) : ch.charCodeAt(0);
    const c = code === undefined || code === null ? 63 : code, slot = f.map ? f.map[c] : c, g = f.glyphs[slot] || [], adv = (f.advs && f.advs[slot]) || f.adv;
    for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (g[r] & CF.bitMask(f, q)) cols.push([x + q, r]);
    x += adv;
  }
  return { w: x, h: f.rows, px: cols };
}

(async () => {
  const rows = [];
  for (const rel of SRC) {
    const data = fs.readFileSync(path.join(root, rel));
    const r = FP.load(data, rel), sizes = Object.keys(r.fam.sizes).map(Number).sort((a, b) => b - a);
    for (const s of sizes) {
      const f = r.fam.sizes[s];
      const back = FP.readBack(path.basename(rel, path.extname(rel)) + '.ttf', FP.toTtf(f), s);
      rows.push({ label: path.basename(rel) + '  ' + s + ' px  (via TTF export)', line: line(back, TEXT) });
    }
  }
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 900, height: 400 } })).newPage();
  await p.setContent('<body style="margin:0;background:#fff"><canvas id=c></canvas></body>');
  await p.evaluate((rows) => {
    const Z = 2, pad = 6, cv = document.getElementById('c'), lh = rows.map((r) => r.line.h * Z + 14 + pad);
    cv.width = 880; cv.height = lh.reduce((a, b) => a + b, 10);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    let y = 6;
    rows.forEach((r, i) => {
      c.fillStyle = '#666'; c.font = '10px sans-serif'; c.fillText(r.label, 6, y + 9);
      c.fillStyle = '#000'; for (const [x, yy] of r.line.px) c.fillRect(6 + x * Z, y + 12 + yy * Z, Z, Z);
      y += lh[i];
    });
  }, rows);
  const h = await p.evaluate(() => document.getElementById('c').height);
  await p.setViewportSize({ width: 900, height: h + 10 });
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  await p.locator('#c').screenshot({ path: path.join(root, 'out', 'fontpipe-sheet.png') });
  fs.copyFileSync(path.join(root, 'out', 'fontpipe-sheet.png'), path.join(root, 'out', 'fontpipe-sheet-v.png'));
  console.log('wrote out/fontpipe-sheet.png (' + rows.length + ' lines)');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
