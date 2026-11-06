// ACWriter typeface reload: a document with three loaded typefaces (one reused), a return to the ROM face, saved,
// cleared with New, reopened: CPG1 tag 2/3 records are exact, the font table (fpn/fpi/fps/fns/names) is identical
// after the reload, every font is loaded (name byte 15 = 0), and a second save is byte-identical to the first.
// Table: fpn $0781, fns $0782, names $0788 (4 x 16, byte 15 = state), fpi $07C8, fps $07D0.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const TEXT = 'para zero\rpara one\rpara two\rpara three\rpara four\rpara five\rpara six\rpara seven\r';
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
  const mk = (f) => { const a = new Uint8Array(1024); for (let i = 0; i < 1024; i++) a[i] = f(i); return Array.from(a); };
  await p.evaluate(([t, f1, f2, f3]) => {
    FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0))));
    FujiNet.emu.hostWrite('A1.FNT', new Uint8Array(f1)); FujiNet.emu.hostWrite('A2.FNT', new Uint8Array(f2)); FujiNet.emu.hostWrite('A3.FNT', new Uint8Array(f3));
  }, [TEXT, mk((i) => (i & 1) ? 0x7E : 0xFF), mk((i) => 0x18 << (i & 1)), mk((i) => (i * 37) & 0xFF)]);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 700); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  let fails = 0;
  const check = (name, ok, extra) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
  const down = async (n) => { for (let i = 0; i < n; i++) await key('ArrowDown', 600); };
  const setFont = async (n) => { await menu('c', 'f'); await type(n); await key('Enter', 3000); };
  const state = async () => {
    const n = (await peek(0x0781))[0], fns = (await peek(0x0782))[0], nm = await peek(0x0788, 64);
    const names = []; for (let s = 0; s < 4; s++) { const r = nm.slice(s * 16, s * 16 + 16); names.push({ name: String.fromCharCode(...r.slice(0, 12).filter((c) => c)), st: r[15] }); }
    const idx = await peek(0x07C8, n), slot = await peek(0x07D0, n);
    // resolve a slot to a name so a renumbering of slots would not matter
    const res = idx.map((q, i) => [q, slot[i] ? names[slot[i] - 1].name : 'ROM']);
    return { n, fns, names, idx, slot, res };
  };
  const files = () => p.evaluate(() => Object.fromEntries(Object.entries(FujiNet.emu.hostFiles()).map(([k, v]) => [k, Array.from(v)])));
  const trailer = (f) => {
    const i = Buffer.from(f).indexOf('CPG1'); const out = { tag2: null, tag3: [], ok: i >= 0 };
    if (i < 0) return out;
    let q = i + 4;
    while (q + 2 <= f.length) {
      const tag = f[q], len = f[q + 1], d = f.slice(q + 2, q + 2 + len); q += 2 + len;
      if (tag === 2) out.tag2 = String.fromCharCode(...d);
      else if (tag === 3) out.tag3.push([d[0] + 256 * d[1], String.fromCharCode(...d.slice(2))]);
    }
    return out;
  };

  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 2500);
  await menu('l', 'v'); await menu('l', 'z'); await p.waitForTimeout(1500);
  await setFont('h:a1');
  await down(2); await setFont('h:a2');
  await down(2); await setFont('h:a3');
  await down(1); await setFont('rom');
  await down(2); await setFont('h:a1');
  const s1 = await state();
  console.log(JSON.stringify(s1));
  check('four loaded fonts at most, three used', s1.fns === 3, s1.fns);
  check('table has paragraph 0 and four changes', JSON.stringify(s1.res) === JSON.stringify([[0, 'A1'], [2, 'A2'], [4, 'A3'], [5, 'ROM'], [7, 'A1']]) || JSON.stringify(s1.res.slice(-4)) === JSON.stringify([[2, 'A2'], [4, 'A3'], [5, 'ROM'], [7, 'A1']]), s1.res);
  check('every loaded font reads state 0', s1.names.slice(0, s1.fns).every((x) => x.st === 0), s1.names);

  await menu('f', 'a'); await type('h:ft2'); await key('Enter', 2500);
  const f2 = Object.entries(await files()).find(([n]) => /^FT2\./i.test(n));
  const T = trailer(f2 ? f2[1] : []);
  console.log(JSON.stringify(T));
  check('tag 2 names paragraph 0 face', T.tag2 === 'A1', T.tag2);
  check('tag 3 records in order', JSON.stringify(T.tag3) === JSON.stringify([[2, 'A2'], [4, 'A3'], [5, 'ROM'], [7, 'A1']]), T.tag3);

  await menu('f', 'n'); await p.waitForTimeout(1500);
  const sn = await state();
  check('New clears the table (loaded fonts stay in memory)', sn.n === 0, sn);
  await menu('f', 'o'); await type('h:ft2.cwd'); await key('Enter', 6000);
  const s2 = await state();
  console.log(JSON.stringify(s2));
  check('reload: same change list', JSON.stringify(s2.res) === JSON.stringify(s1.res), s2.res);
  check('reload: same count of fonts', s2.fns === s1.fns, [s1.fns, s2.fns]);
  check('reload: fonts loaded', s2.names.slice(0, s2.fns).every((x) => x.st === 0), s2.names);
  check('reload: same font names', JSON.stringify(s2.names.map((x) => x.name)) === JSON.stringify(s1.names.map((x) => x.name)), s2.names);
  await menu('f', 'a'); await type('h:ft3'); await key('Enter', 2500);
  const f3 = Object.entries(await files()).find(([n]) => /^FT3\./i.test(n));
  check('second save is byte identical to the first', f2 && f3 && JSON.stringify(f2[1]) === JSON.stringify(f3[1]), [f2 && f2[1].length, f3 && f3[1].length]);
  // cold start: the same file must pull all three fonts from the device again
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(13000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  const sc = await state();
  check('cold start: no fonts, no table', sc.n === 0 && sc.fns === 0, sc);
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ft2.cwd'); await key('Enter', 6000);
  const s3 = await state();
  check('cold reload: same change list', JSON.stringify(s3.res) === JSON.stringify(s1.res), s3.res);
  check('cold reload: fonts loaded from device', s3.fns === 3 && s3.names.slice(0, 3).every((x) => x.st === 0), s3.names);
  await menu('f', 'a'); await type('h:ft4'); await key('Enter', 2500);
  const f4 = Object.entries(await files()).find(([n]) => /^FT4\./i.test(n));
  check('cold reload save is byte identical', f4 && JSON.stringify(f2[1]) === JSON.stringify(f4[1]));
  check('no page errors', errs.length === 0, errs);
  console.log(fails ? 'FAILS ' + fails : 'all ok');
  await b.close(); process.exit(fails ? 1 : 0);
})();
