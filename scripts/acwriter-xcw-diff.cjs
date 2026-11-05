// Pixel diff: ACWriter 2x zoom (6502 in the emulator) vs the xCWriter Atari matching view at 2x, same text, same face.
// Reports the mismatch count per face and writes out/shots/fonts/diff-<face>-{acw,xcw,diff}.png (diff: red = only ACWriter, blue = only xCWriter).
// Usage: node scripts/acwriter-xcw-diff.cjs [maxMismatchPerFace]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(ROOT, 'out', 'shots', 'fonts');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const MAXBAD = Number(process.argv[2] || 0);

// minimal PNG writer (RGBA)
function png(w, h, rgba) {
  const crc = (b) => { let c, t = png.t || (png.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); let r = 0xFFFFFFFF; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (ty, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(ty, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// every case: label, xCWriter face id ('' = ACWriter default), ACWriter .FNT to load (null = default zfont), text lines (<= 19 columns, no wrapping or scrolling)
const LINES = ['Hamburgefonts xyz', 'Quick Jumpy Fox 0123', 'gjpqy bdfhkl Illinois', 'The (fox) [ran]: "yes"', 'a+b=c-d <e> {f} 50%'].map((s) => s.slice(0, 19));
const TEXT = LINES.join('\r') + '\r';
const FNT = (n) => { const f = path.join(ROOT, 'font', n); return fs.existsSync(f) ? fs.readFileSync(f) : null; };
const CASES = [
  { id: 'default', xf: '', fnt: null },
  { id: 'CRAFT8', xf: 'CRAFT8', fnt: FNT('craft8.fnt') },
  { id: 'ROM', xf: 'ATARIROM', fnt: fs.readFileSync(path.join(ROOT, 'software_n_roms', 'ATARIXL.ROM')).subarray(0x2000, 0x2400) },
].concat(fs.existsSync(path.join(ROOT, 'font_personal', 'FONT.FNT')) ? [{ id: 'FONT', xf: 'FONT', fnt: fs.readFileSync(path.join(ROOT, 'font_personal', 'FONT.FNT')) }] : [])
  // sub/superscript (codes 12 / 11 in ACWriter text) in the default face; the file is opened after the plain cases
  .concat([{ id: 'subsup', xf: '', fnt: null, file: 'ED2', reset: true }]);
const SUBSUP = [['H', 0, 0], ['2', 0, 1], ['O  x', 0, 0], ['2', 1, 0], [' y', 0, 0]];

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.selectOption('#ram', '128').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  const X = require(ROOT + '/tools/xcwcore.cjs');
  const st = (t, sup, sub) => ({ t, b: 0, i: 0, u: 0, sup: sup || 0, sub: sub || 0 });
  const cwd2 = X.toCwd(X.normalize([{ align: 'l', bullet: false, runs: SUBSUP.map(([a, u, d]) => st(a, u, d)) }, { align: 'l', bullet: false, runs: [st('CO2 and H2O')] }]), { page: X.Page.normalize({}) }).file;
  await p.evaluate(([t, a]) => {
    FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0))));
    FujiNet.emu.hostWrite('ED2.CWD', new Uint8Array(a));
  }, [TEXT, Array.from(cwd2)]);
  for (const c of CASES) if (c.fnt) await p.evaluate(([n, f]) => FujiNet.emu.hostWrite(n.toUpperCase() + '.FNT', new Uint8Array(f)), ['D' + c.id.slice(0, 7), Array.from(c.fnt)]);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period' };
  const type = async (s) => { for (const ch of s) await key(MAP[ch] || ch, 700); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 2500);
  await menu('l', 'v'); await menu('l', 'z'); await p.waitForTimeout(2500);
  // ACWriter frames: 336x240 luminance, ink = dark
  const grab = () => p.evaluate(() => { const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Uint8Array(c.width * c.height); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0; return { w: c.width, h: c.height, a: Array.from(o) }; });
  const acw = {};
  for (const c of CASES) {
    if (c.file) { await menu('f', 'o'); await type('h:' + c.file.toLowerCase() + '.cwd'); await key('Enter', 3000); await p.waitForTimeout(1500); }
    if (c.rom) { await menu('c', 'f'); await type('rom'); await key('Enter', 3000); }
    if (c.fnt) { await menu('c', 'f'); await type('d' + c.id.slice(0, 7).toLowerCase()); await key('Enter', 3500); }
    await key('ArrowUp', 300); await key('ArrowUp', 300);
    acw[c.id] = await grab();
  }
  await b.close();

  // xCWriter side over http
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
  await q.click('#hnew'); await q.click('#mat');
  await q.waitForTimeout(600);
  let bad = 0, FIXED = null; const rows = [];
  for (const c of CASES) {
    const xw = await q.evaluate(async ([lines, xf, ss]) => {
      if (xf) { XFACE.use(xf); await XFACE.load(XFACE.get(xf)); }
      await XFACE.load(XFACE.get('CRAFT8'));
      const run = (t, sup, sub) => ({ t, b: 0, i: 0, u: 0, sup, sub });
      XW.doc = XCW.normalize(lines.map((t, k) => ({ align: 'l', bullet: false, runs: ss && k === 0 ? ss.map(([a, u, d]) => run(a, u, d)) : [run(t, 0, 0)], ...(xf ? { font: xf } : {}) })));
      AT.setView2(true); AT.render();
      const cv = document.getElementById('atcanvas'), d = cv.getContext('2d').getImageData(0, 0, 320, 192).data, o = new Uint8Array(320 * 192);
      for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0;
      return Array.from(o);
    }, [c.file ? ['', 'CO2 and H2O'] : LINES, c.xf, c.file ? SUBSUP : null]);
    const NL = c.file ? 2 : LINES.length;
    // text region: 9 lines x 16 px starting at y 16 in the xCWriter view; the cursor cell (row 0, first text column 3) is masked as it blinks
    const A = acw[c.id]; let best = null;
    for (let oy = FIXED ? FIXED.oy : 0; oy <= (FIXED ? FIXED.oy : 60); oy++) for (let ox = FIXED ? FIXED.ox : 0; ox <= (FIXED ? FIXED.ox : 16); ox++) {
      let n = 0;
      for (let y = 16; y < 16 + NL * 16; y++) for (let x = 0; x < 320; x++) {
        if (y < 32 && x >= 48 && x < 64) continue;
        if (A.a[(y + oy) * A.w + x + ox] !== xw[y * 320 + x]) n++;
      }
      if (!best || n < best.n) best = { n, ox, oy };
    }
    const w = 320, h = NL * 16, S = 3, out = new Uint32Array(w * S * h * S);
    for (let y = 0; y < h * S; y++) for (let x = 0; x < w * S; x++) {
      const sx = (x / S) | 0, sy = (y / S) | 0;
      const a = A.a[(sy + 16 + best.oy) * A.w + sx + best.ox], m = xw[(sy + 16) * 320 + sx];
      out[y * w * S + x] = a && m ? 0xFF202020 : a ? 0xFF2020E0 : m ? 0xFFE02020 : 0xFFF0F0F0;
    }
    fs.writeFileSync(path.join(SHOTS, 'diff-' + c.id + '.png'), png(w * S, h * S, new Uint8Array(out.buffer)));
    const o2 = new Uint32Array(w * S * h * S);
    for (let y = 0; y < h * S; y++) for (let x = 0; x < w * S; x++) o2[y * w * S + x] = A.a[(((y / S) | 0) + 16 + best.oy) * A.w + ((x / S) | 0) + best.ox] ? 0xFF202020 : 0xFFF0F0F0;
    fs.writeFileSync(path.join(SHOTS, 'diff-' + c.id + '-acw.png'), png(w * S, h * S, new Uint8Array(o2.buffer)));
    rows.push({ face: c.id, mismatch: best.n, offset: best.ox + ',' + best.oy });
    if (!FIXED) FIXED = { ox: best.ox, oy: best.oy };
    console.log((best.n <= MAXBAD ? 'ok   ' : 'FAIL ') + c.id + ': ' + best.n + ' mismatching pixels of ' + w * h + ' (ACWriter frame offset ' + best.ox + ',' + best.oy + ')');
    if (best.n > MAXBAD) bad++;
  }
  console.log('page errors:', errs);
  console.log(bad ? 'FAILS ' + bad : 'all ok');
  await b2.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
