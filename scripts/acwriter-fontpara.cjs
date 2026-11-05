// ACWriter per-paragraph font table stays aligned with its paragraphs across Return, Backspace joins, line cut/paste,
// multi-line selection cut/paste, find/replace, opening a text file and New. Table: fpn $0781, fpi $07C8, fps $07D0.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const TEXT = 'alpha beta gamma\rDelta epsilon zeta\rEta theta iota\rlast one here\rfifth line\rsixth line\r';
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
  const fnt = new Uint8Array(1024); for (let i = 0; i < 1024; i++) fnt[i] = (i & 1) ? 0x7E : 0xFF;
  await p.evaluate(([t, f]) => {
    FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0))));
    FujiNet.emu.hostWrite('BIG.FNT', new Uint8Array(f));
  }, [TEXT, Array.from(fnt)]);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 700); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  const table = async () => { const n = (await peek(0x0781))[0]; return { n, idx: Array.from(await peek(0x07C8, n)), slot: Array.from(await peek(0x07D0, n)) }; };
  let fails = 0;
  const check = async (name, want) => {
    const t = await table(); const ok = JSON.stringify(t.idx) === JSON.stringify(want);
    if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, 'paragraphs with a font change:', JSON.stringify(t.idx), ok ? '' : 'wanted ' + JSON.stringify(want));
  };
  const openDoc = async () => { await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 2500); };
  const setFont = async () => { await menu('c', 'f'); await type('h:big'); await key('Enter', 3000); };
  const down = async (n) => { for (let i = 0; i < n; i++) await key('ArrowDown', 600); };
  const up = async (n) => { for (let i = 0; i < n; i++) await key('ArrowUp', 600); };

  await key('ArrowDown', 900); await openDoc();
  await down(2); await setFont();
  await check('font set on paragraph 2', [2]);
  await up(2); await key('Control+e', 500); await key('Enter', 900);
  await check('Return in paragraph 0 shifts it to 3', [3]);
  await p.evaluate(() => { for (const t of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(t, { code: 'IntlBackslash', key: 'Backspace', bubbles: true })); });
  await p.waitForTimeout(900);
  await check('Backspace join shifts it back to 2', [2]);
  await key('Control+a', 500); await key('Control+d', 1200);
  await check('cut of line 0 moves it to 1', [1]);
  await key('Control+p', 1500);
  await check('paste of the line moves it back to 2', [2]);
  await key('Control+r', 800); await type('alpha'); await key('Enter', 900); await type('zeta'); await key('Enter', 2200);
  await check('find/replace leaves the table alone', [2]);

  await openDoc();
  await check('opening a text file clears the table', []);
  await down(1); await setFont(); await down(3); await setFont();
  await check('two changes, paragraphs 1 and 4', [1, 4]);
  await key('Control+l', 1500); await type('1'); await key('Enter', 2000);
  await key('Control+s', 600); await down(2);
  await key('Control+d', 1500);
  await check('cutting 2 paragraphs drops the one inside and moves the other to 2', [2]);
  await key('Control+p', 1800);
  await check('pasting them back moves it to 4', [4]);

  await menu('f', 'n'); await p.waitForTimeout(1500);
  const t = await table();
  console.log(t.n === 0 ? 'ok  ' : 'FAIL', 'New document clears the table', JSON.stringify(t)); if (t.n !== 0) fails++;
  if (errs.length) { console.log('page errors', errs); fails++; }
  console.log(fails ? 'FAILS ' + fails : 'all ok');
  await b.close(); process.exit(fails ? 1 : 0);
})();
