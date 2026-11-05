// ACWriter Character > Font: per-paragraph .FNT typefaces in the 2x zoom view, saved/loaded via CPG1 tags 2 and 3.
// Screenshots: out/acw-face-N.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const TEXT = 'alpha beta gamma\rDelta epsilon zeta\rEta theta iota\rlast one here\r';
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
  // a charset where every glyph is a bold block pattern, so the face is obvious on screen
  const fnt = new Uint8Array(1024); for (let i = 0; i < 1024; i++) fnt[i] = (i & 1) ? 0x7E : 0xFF;
  await p.evaluate(([t, f]) => {
    FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0))));
    FujiNet.emu.hostWrite('BIG.FNT', new Uint8Array(f));
  }, [TEXT, Array.from(fnt)]);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 700); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-face-' + n + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  let fails = 0;
  const check = (name, ok, extra) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 2500);
  await menu('l', 'v'); await menu('l', 'z'); await p.waitForTimeout(2000);
  await shot('1-rom');
  check('zoom on', (await peek(0x14E7))[0] === 1);
  await menu('c', 'f'); await type('h:big'); await key('Enter', 3000);
  const st = await peek(0x0781, 2);
  check('font loaded and set for paragraph 0', st[0] === 1 && st[1] === 1, st);
  check('name stored', String.fromCharCode(...(await peek(0x0788, 3))) === 'BIG');
  await shot('2-big');
  await key('ArrowDown', 900);
  await menu('c', 'f'); await type('rom'); await key('Enter', 2000);
  const st2 = await peek(0x0781, 2);
  check('second paragraph back to ROM face', st2[0] === 2 && st2[1] === 1, st2);
  await shot('3-mixed-blocks');
  await menu('f', 'a'); await type('h:ft'); await key('Enter', 2500);
  const files = await p.evaluate(() => Object.fromEntries(Object.entries(FujiNet.emu.hostFiles()).map(([k, v]) => [k, Array.from(v)])));
  const f = files[Object.keys(files).find((n) => /^FT\./i.test(n))] || [];
  const s = String.fromCharCode(...f.map((c) => (c >= 32 && c < 127 ? c : 46)));
  check('trailer has CPG1 and the font name', s.includes('CPG1') && s.includes('BIG'), s.slice(-40));
  check('tag 2 and tag 3 records', s.includes('ROM'));
  // reload in a fresh state: clear the table, then open the file
  await p.evaluate(() => { ataricraft.poke && [0x0781, 0x0782].forEach((a) => ataricraft.poke(a, 0)); });
  await menu('f', 'o'); await type('h:ft.cwd'); await key('Enter', 4000);
  const st3 = await peek(0x0781, 2);
  check('reload restores the font table', st3[0] === 2 && st3[1] >= 1, st3);
  await shot('4-reloaded');
  console.log(fails ? 'FAILS ' + fails : 'all ok');
  await b.close(); process.exit(fails ? 1 : 0);
})();
