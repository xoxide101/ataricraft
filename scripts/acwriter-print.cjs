// ACWriter File > Print to the emulated P: device. Loads a small document with styles, prints it in each mode
// (t text, e Epson ESC/P, b bitmap 60 dpi, d bitmap 120 dpi), rebuilds the byte stream from the captured frames
// and checks it; the bitmap capture is decoded and rendered to out/acw-print-<mode>.png.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const B = 1, I = 2, U = 3;
const DOC = [...'Hello '].map((c) => c.charCodeAt(0)).concat([B], [...'bold'].map((c) => c.charCodeAt(0)), [B], [32, I], [...'ital'].map((c) => c.charCodeAt(0)), [I, 32, U], [...'under'].map((c) => c.charCodeAt(0)), [U, 13], [...'Second line.'].map((c) => c.charCodeAt(0)), [13]);
const hdr = Buffer.alloc(16); hdr.write('CRFT'); hdr[4] = 1; hdr[5] = 0x57; hdr.writeUInt16LE(DOC.length, 8); hdr.writeUInt16LE(2, 10); hdr[12] = 64; hdr[13] = 20; hdr.writeUInt16LE(DOC.reduce((a, c) => a + c, 0) & 0xffff, 14);
const FILE = Array.from(Buffer.concat([hdr, Buffer.from(DOC)]));

function stream(lines) {
  const o = [];
  for (const l of lines) { for (const x of l.b) o.push(x); if (l.e) o.push(0x9b); }
  return o;
}

// minimal ESC/P decoder: returns {text, rasters: [{x,y,cols}]}; graphics columns go to a page bitmap
function decode(bytes) {
  const W = 1700, pins = [], pg = [];
  let y = 0, i = 0, line = '', dpi = 0, lsp = 0, xpos = 0;
  const dots = [];
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c === 27) {
      const k = bytes[i++];
      if (k === 0x2a) { const m = bytes[i++], n = bytes[i] + 256 * bytes[i + 1]; i += 2; const d = bytes.slice(i, i + n); i += n; dots.push({ y, x: xpos, m, d }); xpos += n; }
      else if (k === 0x4a) { y += bytes[i++]; xpos = 0; }
      else if (k === 0x33) { lsp = bytes[i++]; }
      else if (k === 0x43) i++;
      else if (k === 0x2d || k === 0x53) i++;
    } else if (c === 0x9b) { if (dots.length) { /* a bitmap line ends */ } xpos = 0; }
    else if (c === 12) { /* form feed */ }
  }
  return { dots, y, lsp };
}

(async () => {
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
  await p.evaluate((d) => { FujiNet.emu.hostWrite('PR.CWD', new Uint8Array(d)); Printer.cfg.auto = false; }, FILE);
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 500); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1000); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => ataricraft.peek(x, m), [a, n]);
  await key('ArrowDown', 900);
  await menu('f', 'o');
  await type('h:pr.cwd');
  await key('Enter', 2500);
  const dend = await peek(0xA6, 2);
  console.log('doc end', dend);

  const run = async (letter) => {
    await p.evaluate(() => Printer.clear());
    await menu('f', 'r');
    await type(letter);
    await key('Enter', 1000);
    await p.waitForTimeout(6000);
    console.log('fer', await peek(0x1412), 'cmsg', await peek(0xAC));
    return p.evaluate(() => Printer.lines.map((l) => ({ b: Array.from(l.b), e: l.e })));
  };

  const T = stream(await run('t'));
  const ts = String.fromCharCode(...T.map((x) => (x === 0x9b ? 10 : x)));
  console.log(JSON.stringify(ts.slice(0, 200)));
  ok(/Hello bold ital under\n/.test(ts) && /Second line\.\n/.test(ts), 'plain text mode prints the text without style codes', ts.slice(0, 120));
  ok(!T.some((x) => x > 0 && x < 9 && x !== 0), 'no style toggles leak into the text', T.slice(0, 40));
  ok(T.includes(12), 'form feed ends the page');
  ok((await peek(0xAC))[0] === 1, 'Done. message');

  const E = stream(await run('e'));
  const eh = E.slice(0, 8);
  ok(E[0] === 27 && E[1] === 64, 'Epson: starts with ESC @', eh);
  ok(E[2] === 27 && E[3] === 67 && (E[4] === 66 || E[4] === 70 || E[4] === 84), 'Epson: ESC C page length', eh);
  const es = String.fromCharCode(...E.map((x) => (x === 27 ? 0x7e : x === 0x9b ? 10 : x)));
  ok(/~Ebold~F/.test(es), 'Epson: bold on/off around "bold"', es.slice(0, 120));
  ok(/~4ital~5/.test(es), 'Epson: italic on/off', es.slice(0, 120));
  ok(/~-1under~-0/.test(es), 'Epson: underline on/off', es.slice(0, 120));

  for (const [letter, m] of [['b', 0], ['d', 1]]) {
    const S = stream(await run(letter));
    const hit = []; for (let i = 0; i + 4 < S.length; i++) if (S[i] === 27 && S[i + 1] === 42) hit.push(i);
    ok(hit.length >= 4, 'bitmap ' + letter + ': ESC * graphics rows present', hit.length);
    ok(hit.every((i) => S[i + 2] === m), 'bitmap ' + letter + ': density mode ' + m, hit.map((i) => S[i + 2]).slice(0, 4));
    let good = true, ndots = 0, st = 0;
    for (const i of hit) { const n = S[i + 3] + 256 * S[i + 4]; ndots += n; if (S[i + 5 + n] !== 0x9b) good = false; if (S.slice(i + 5, i + 5 + n).includes(0x9b)) good = false; }
    ok(good, 'bitmap ' + letter + ': graphics data free of EOL, rows end with EOL');
    ok(S.includes(27) && S[2] === 27 && S[3] === 67, 'bitmap ' + letter + ': page setup');
    // raster: rows of 8 pins at y positions from ESC J advances
    const rows = []; let y = 0, x = 0;
    for (let i = 0; i < S.length;) {
      if (S[i] === 27 && S[i + 1] === 42) { const n = S[i + 3] + 256 * S[i + 4]; rows.push({ y, d: S.slice(i + 5, i + 5 + n) }); i += 6 + n; }
      else if (S[i] === 27 && S[i + 1] === 74) { y += S[i + 2]; i += 3; }
      else i++;
    }
    const w = Math.max(...rows.map((r) => r.d.length)), h = Math.ceil(y / 3) + 20;
    const ppx = m ? 1 : 2; // 60 dpi dots are twice as wide as 120 dpi dots
    await p.evaluate(([rows, w, h, ppx, name]) => {
      const c = document.createElement('canvas'); c.width = w * ppx; c.height = h; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
      for (const r of rows) r.d.forEach((v, xx) => { for (let k = 0; k < 8; k++) if (v & (0x80 >> k)) g.fillRect(xx * ppx, Math.round(r.y / 3) + k, ppx, 1); });
      window.__png = c.toDataURL();
    }, [rows, w, h, ppx, letter]);
    const url = await p.evaluate(() => window.__png);
    fs.writeFileSync(ROOT + '/out/acw-print-' + letter + '.png', Buffer.from(url.split(',')[1], 'base64'));
    let ink = 0; for (const r of rows) for (const v of r.d) for (let k = 0; k < 8; k++) if (v & (1 << k)) ink++;
    ok(ink > 300, 'bitmap ' + letter + ': rendered raster has ink', ink);
    console.log(letter, 'rows', rows.length, 'width dots', w, 'ink', ink);
  }
  ok(errs.length === 0, 'no page errors', errs);
  await b.close();
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
