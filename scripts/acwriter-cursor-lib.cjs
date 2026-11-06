// Shared helpers for the ACWriter cursor/flicker/status tests: boot ACWRITER.ATR in the emulator, grab the canvas.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

async function boot(opts = {}) {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.selectOption('#ram', '128').catch(() => {});
  const atr = opts.atr || ROOT + '/tools/acwriter/ACWRITER.ATR';
  await p.setInputFiles('#f1', { name: 'ACWRITER.ATR', mimeType: 'application/octet-stream', buffer: fs.readFileSync(atr) });
  await p.click('#boot');
  await p.waitForTimeout(opts.wait || 16000);
  await p.locator('canvas').first().click();
  const key = async (k, w = 250) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period', ',': 'Comma' };
  const type = async (s, w = 120) => { for (const ch of s) await key(MAP[ch] || ch, w); };
  // 1-bit frame of the Atari canvas (dark = 1), cropped to the 320x192 active area when it is that size
  const grab = () => p.evaluate(() => { const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Uint8Array(c.width * c.height); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0; return { w: c.width, h: c.height, a: o }; });
  const shot = (f) => p.screenshot({ path: f });
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  return { b, p, errs, key, type, grab, shot, peek };
}
const diff = (A, B) => { const r = []; for (let i = 0; i < A.a.length; i++) if (A.a[i] !== B.a[i]) r.push(i); return r; };
// bounding box of changed pixels as {n, x0,y0,x1,y1} in canvas pixels
const bbox = (A, B) => { const d = diff(A, B); if (!d.length) return { n: 0 }; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (const i of d) { const x = i % A.w, y = (i / A.w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { n: d.length, x0, y0, x1, y1 }; };
module.exports = { boot, diff, bbox, ROOT };
