// Sections + role styles on one document, ACWriter (6502 in the emulator, 2x zoom view) vs xCWriter's Atari 2x view, pixel for pixel.
// Document: Title (ATARIPIX), Heading 1/2 (KIDPIXI2), body section 1 (CRAFT8), body section 2 (ATARIROM), one paragraph override (CRAFT8).
// Also checks: ACWriter reads the CPG1 file with the new tags 4..7 (it ignores them and uses tags 2/3, the resolved faces), saves it again
// with the same resolved faces, and the re-opened file draws the same pixels. Frames: out/shots/sections/*.png
// Usage: node scripts/acwriter-sections.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), SHOTS = path.join(ROOT, 'out', 'shots', 'sections');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const X = require(ROOT + '/tools/xcwcore.cjs'), P = X.Page;

const FNTS = { ATARIPIX: 'library/fonts/atari/AtariPixel8.fnt', KIDPIXI2: 'library/fonts/atari/Kidpixies12.fnt', CRAFT8: 'library/fonts/local/shared/craft8.fnt', ATARIROM: 'library/fonts/local/atarirom.fnt' };
const run = (t) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 });
const mk = (t, o) => Object.assign({ align: 'l', bullet: false, runs: [run(t)] }, o || {});
const PARAS = [
  mk('Sections demo', { role: 'title' }),
  mk('First heading', { role: 'h1' }),
  mk('Body in section 1'),
  mk('Second heading', { role: 'h2' }),
  mk('Body in section 2', { sec: true, sf: 'ATARIROM' }),
  mk('Override paragraph', { font: 'CRAFT8' }),
  mk('Last body line'),
];
PARAS[0].sf = 'CRAFT8';
const PAGE = P.normalize({ dfont: '', styles: { title: { face: 'ATARIPIX' }, h1: { face: 'KIDPIXI2' }, h2: { face: 'KIDPIXI2' } } });
const EXPECT = ['ATARIPIX', 'KIDPIXI2', 'CRAFT8', 'KIDPIXI2', 'ATARIROM', 'CRAFT8', 'ATARIROM'];
const NL = PARAS.length;

(async () => {
  const resolved = P.resolve(PARAS, PAGE).map((r) => r.face);
  assert.deepStrictEqual(resolved, EXPECT, 'model resolves the expected faces');
  const cwd = X.toCwd(X.normalize(PARAS), { page: PAGE }).file;
  const back = X.openDoc(cwd, 'SEC.CWD');
  assert.deepStrictEqual(P.resolve(back.paras, back.page).map((r) => r.face), EXPECT, 'CWD round trip keeps the faces');
  console.log('ok   model: ' + EXPECT.join(' '));

  const rom = fs.readFileSync(path.join(ROOT, 'software_n_roms', 'ATARIXL.ROM')).subarray(0x2000, 0x2400);
  const fntBytes = {};
  for (const [id, rel] of Object.entries(FNTS)) {
    const f = path.join(WEB, rel);
    fntBytes[id] = id === 'ATARIROM' ? Buffer.from(rom) : fs.readFileSync(f);
    assert.strictEqual(fntBytes[id].length, 1024, id);
  }

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.selectOption('#ram', '128').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex')));
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.evaluate(([c, fonts]) => {
    FujiNet.emu.hostWrite('SEC.CWD', new Uint8Array(c));
    for (const [n, a] of Object.entries(fonts)) FujiNet.emu.hostWrite(n + '.FNT', new Uint8Array(a));
  }, [Array.from(cwd), Object.fromEntries(Object.entries(fntBytes).map(([k, v]) => [k, Array.from(v)]))]);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const MAP = { ' ': 'Space', ':': 'Shift+Semicolon', '.': 'Period' };
  const type = async (s) => { for (const ch of s) await key(MAP[ch] || ch, 700); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const grab = () => p.evaluate(() => { const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Uint8Array(c.width * c.height); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0; return { w: c.width, h: c.height, a: Array.from(o) }; });
  const still = async () => { let a = await grab(); for (let k = 0; k < 6; k++) { await p.waitForTimeout(1200); const c = await grab(); if (JSON.stringify(c.a) === JSON.stringify(a.a)) return c; a = c; } return a; };
  const files = () => p.evaluate(() => Object.fromEntries(Object.entries(FujiNet.emu.hostFiles()).map(([k, v]) => [k, Array.from(v)])));
  const shot = (n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);

  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:sec.cwd'); await key('Enter', 6000);
  await menu('l', 'v'); await menu('l', 'z'); await p.waitForTimeout(2500);
  await key('ArrowUp', 300); await key('ArrowUp', 300);
  const A1 = await still(); await shot('acwriter-zoom');
  const n = (await peek(0x0781))[0], fns = (await peek(0x0782))[0];
  console.log('ACWriter font changes ' + n + ', loaded fonts ' + fns);

  // save from ACWriter, start over, reopen
  await menu('f', 'a'); await type('h:sec2'); await key('Enter', 2500);
  const saved = Object.entries(await files()).find(([k]) => /^SEC2\./i.test(k));
  assert(saved, 'ACWriter wrote SEC2');
  const sv = X.openDoc(Uint8Array.from(saved[1]), 'SEC2.CWD');
  assert.deepStrictEqual(P.resolve(sv.paras, sv.page).map((r) => r.face), EXPECT, 'ACWriter-saved file carries the same resolved faces');
  console.log('ok   ACWriter saved the same resolved faces (tags 2/3)');
  await menu('f', 'n'); await p.waitForTimeout(1500);
  await menu('f', 'o'); await type('h:sec2.cwd'); await key('Enter', 6000);
  await p.waitForTimeout(2500);
  await key('ArrowUp', 300); await key('ArrowUp', 300);
  const A2 = await still(); await shot('acwriter-zoom-reloaded');
  await b.close();

  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const b2 = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const q = await (await b2.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  q.on('pageerror', (e) => errs.push(e.message));
  await q.goto('http://localhost:' + srv.address().port + '/xcwriter.html');
  await q.click('#hnew'); await q.click('#mat'); await q.waitForTimeout(600);
  const xw = await q.evaluate(async (a) => {
    const o = XCW.openDoc(Uint8Array.from(a), 'SEC.CWD');
    for (const r of XCW.Page.resolve(o.paras, o.page)) if (r.face) { XFACE.use(r.face); await XFACE.load(XFACE.get(r.face)); }
    XW.page = o.page; XW.doc = XCW.normalize(o.paras);
    AT.setView2(true); AT.render();
    const cv = document.getElementById('atcanvas'), d = cv.getContext('2d').getImageData(0, 0, 320, 192).data, r = new Uint8Array(320 * 192);
    for (let i = 0; i < r.length; i++) r[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0;
    return Array.from(r);
  }, Array.from(cwd));
  await q.screenshot({ path: path.join(SHOTS, 'xcwriter-atari2x.png') });
  const diff = (A, oy, ox) => {
    let bad = 0;
    for (let y = 16; y < 16 + NL * 16; y++) for (let x = 0; x < 320; x++) { if (y < 32 && x >= 48 && x < 64) continue; if (A.a[(y + oy) * A.w + x + ox] !== xw[y * 320 + x]) bad++; }
    return bad;
  };
  let best = null;
  for (let oy = 0; oy <= 60; oy++) for (let ox = 0; ox <= 16; ox++) { const m = diff(A1, oy, ox); if (!best || m < best.m) best = { m, ox, oy }; }
  console.log((best.m === 0 ? 'ok   ' : 'FAIL ') + 'ACWriter zoom vs xCWriter Atari 2x: ' + best.m + ' mismatching pixels (' + NL + ' lines, offset ' + best.ox + ',' + best.oy + ')');
  const per = []; for (let l = 0; l < NL; l++) { let c = 0, xs = []; for (let y = 16 + l * 16; y < 32 + l * 16; y++) for (let x = 0; x < 320; x++) if (A1.a[(y + best.oy) * A1.w + x + best.ox] !== xw[y * 320 + x]) { c++; xs.push(x); } per.push(c + (c ? '@' + Math.min(...xs) + '-' + Math.max(...xs) : '')); }
  console.log('mismatch per line: ' + per.join(' | '));
  const m2 = diff(A2, best.oy, best.ox);
  console.log((m2 === 0 ? 'ok   ' : 'FAIL ') + 'after save, New and reopen: ' + m2 + ' mismatching pixels');
  let ink = 0; for (let l = 0; l < NL; l++) { let c = 0; for (let y = 16 + l * 16; y < 32 + l * 16; y++) for (let x = 0; x < 320; x++) c += xw[y * 320 + x]; if (c < 30) console.log('FAIL line ' + l + ' has no ink'), ink++; }
  console.log('page errors:', errs);
  const bad = (best.m ? 1 : 0) + (m2 ? 1 : 0) + ink + errs.length;
  console.log(bad ? 'FAILS ' + bad : 'all ok');
  await b2.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
