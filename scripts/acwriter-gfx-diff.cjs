// Pixel diff of the Atari graphics: ACWriter (6502 in the emulator, normal 1x view) vs the xCWriter Atari matching view, same document.
// A document of the 32 ATASCII graphics (CRFT bytes 128..159) is built with xcwcore from their Unicode characters,
// opened in ACWriter, and the same document is drawn in the xCWriter Atari view. Writes out/shots/fonts/gfx-{acw,xcw,diff}.png.
// Usage: node scripts/acwriter-gfx-diff.cjs [maxMismatch]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(ROOT, 'out', 'shots', 'fonts');
fs.mkdirSync(SHOTS, { recursive: true });
const MAXBAD = Number(process.argv[2] || 0);
const X = require(ROOT + '/tools/xcwcore.cjs'), AG = X.Gfx;

function png(w, h, rgba) {
  const crc = (b) => { let c, t = png.t || (png.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); let r = 0xFFFFFFFF; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (ty, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(ty, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const gl = (a, b) => Array.from({ length: b - a }, (_, i) => String.fromCodePoint(AG.uniOfCode(a + i))).join('');
const LINES = ['Gfx: ' + gl(0, 14), gl(14, 28), gl(28, 32) + ' ' + gl(0, 4) + ' abc'];

(async () => {
  const st = (t) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 });
  const doc = X.normalize(LINES.map((t) => ({ align: 'l', bullet: false, runs: [st(t)] })));
  const cwd = X.toCwd(doc, { page: X.Page.normalize({}) }).file;
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.selectOption('#ram', '128').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex')));
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.evaluate((a) => FujiNet.emu.hostWrite('GFX.CWD', new Uint8Array(a)), Array.from(cwd));
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period' };
  const type = async (s) => { for (const ch of s) await key(MAP[ch] || ch, 700); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:gfx.cwd'); await key('Enter', 3500);
  await key('ArrowUp', 300); await key('ArrowUp', 300); await key('ArrowUp', 300);
  await p.waitForTimeout(1500);
  const A = await p.evaluate(() => { const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Uint8Array(c.width * c.height); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0; return { w: c.width, h: c.height, a: Array.from(o) }; });
  await p.locator('canvas').first().screenshot({ path: path.join(SHOTS, 'gfx-acw-raw.png') });
  await b.close();

  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const b2 = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const q = await (await b2.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errs = []; q.on('pageerror', (e) => errs.push(e.message));
  await q.goto('http://localhost:' + srv.address().port + '/xcwriter.html');
  await q.click('#hnew'); await q.click('#mat'); await q.waitForTimeout(600);
  const xw = await q.evaluate(async (lines) => {
    const run = (t) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 });
    XW.doc = XCW.normalize(lines.map((t) => ({ align: 'l', bullet: false, runs: [run(t)] })));
    AT.setView2(false); AT.render();
    const cv = document.getElementById('atcanvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, o = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0;
    return { w: cv.width, h: cv.height, a: Array.from(o) };
  }, LINES);
  await q.locator('#atcanvas').screenshot({ path: path.join(SHOTS, 'gfx-xcw-raw.png') });

  // find the ACWriter frame offset that best matches the xCWriter text rows (the first text row holds the cursor cell: mask the first 3 cells)
  const rowsH = 8 * LINES.length + 8; let best = null;
  for (let oy = 0; oy <= 40; oy++) for (let ox = 0; ox <= 24; ox++) {
    let n = 0;
    for (let y = 8; y < 8 + rowsH; y++) for (let x = 24; x < Math.min(xw.w, A.w - ox); x++) if (A.a[(y + oy) * A.w + x + ox] !== xw.a[y * xw.w + x]) n++;
    if (!best || n < best.n) best = { n, ox, oy };
  }
  const w = Math.min(xw.w, A.w - best.ox), h = rowsH, S = 4, out = new Uint32Array(w * S * h * S);
  for (let y = 0; y < h * S; y++) for (let x = 0; x < w * S; x++) {
    const sx = (x / S) | 0, sy = ((y / S) | 0) + 8;
    const a = A.a[(sy + best.oy) * A.w + sx + best.ox], m = xw.a[sy * xw.w + sx];
    out[y * w * S + x] = a && m ? 0xFF202020 : a ? 0xFF2020E0 : m ? 0xFFE02020 : 0xFFF0F0F0;
  }
  fs.writeFileSync(path.join(SHOTS, 'gfx-diff.png'), png(w * S, h * S, new Uint8Array(out.buffer)));
  console.log((best.n <= MAXBAD ? 'ok   ' : 'FAIL ') + 'graphics line: ' + best.n + ' mismatching pixels (ACWriter frame offset ' + best.ox + ',' + best.oy + '), page errors: ' + JSON.stringify(errs));
  await b2.close(); srv.close(); process.exit(best.n <= MAXBAD && !errs.length ? 0 : 1);
})();
