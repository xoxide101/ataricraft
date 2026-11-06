// ACWriter per-paragraph fonts vs find/replace and file import/open: replacements that lengthen or shorten
// wrapped paragraphs (soft breaks move, paragraph count does not), repeated replaces, opening a CRFT file without
// font tags, opening a text file, and a failed Open that must keep the table.
// Table: fpn $0781, fpi $07C8, fps $07D0. Doc stream at $6400 up to dend ($A6).
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const L = (w) => (w + ' ').repeat(Math.ceil(100 / (w.length + 1))).trim();
const TEXT = [L('alpha'), L('beta'), L('gamma'), L('delta'), 'short five'].join('\r') + '\r';
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
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 600); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
  const table = async () => { const n = (await peek(0x0781))[0]; return Array.from(await peek(0x07C8, n)); };
  const docText = async () => { const e = await peek(0xA6, 2), len = e[0] + 256 * e[1] - 0x6400; return String.fromCharCode(...(await peek(0x6400, Math.min(len, 400))).map((c) => (c >= 32 && c < 127 ? c : c === 13 ? 124 : c === 14 ? 47 : 63))); };
  const docStat = async () => {
    const e = await peek(0xA6, 2), len = e[0] + 256 * e[1] - 0x6400, d = await peek(0x6400, Math.min(len, 1500));
    return { len, hard: d.filter((c) => c === 13).length, soft: d.filter((c) => c === 14).length };
  };
  let fails = 0;
  const check = (name, ok, extra) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
  const down = async (n) => { for (let i = 0; i < n; i++) await key('ArrowDown', 600); };
  const setFont = async () => { await menu('c', 'f'); await type('h:big'); await key('Enter', 3000); };
  const openDoc = async (n) => { await menu('f', 'o'); await type(n); await key('Enter', 3000); };
  const replace = async (a, c) => { for (let i = 0; i < 14; i++) await key('ArrowUp', 250); console.log('replace', a, '->', c, JSON.stringify(await docStat())); await key('Control+r', 800); await type(a); await key('Enter', 900); await type(c); await key('Enter', 1500); await key('a', 9000); };

  await key('ArrowDown', 900); await openDoc('h:ed.txt');
  const base = await docStat();
  console.log('start', JSON.stringify(base));
  // save a CRFT copy that has no font tags before any font is set
  await menu('f', 'a'); await type('h:nofont'); await key('Enter', 2500);
  await down(1); await key('Control+e', 500).catch(() => {});
  const p0 = await table();
  await down(0); await setFont();
  await down(2); await setFont();
  const t0 = await table();
  check('two font changes set', t0.length === 2, t0);
  const d0 = await docStat();

  // go to the top and replace in paragraph 0 with something much longer, then much shorter
  await key('Control+Home', 700).catch(() => {});
  for (let i = 0; i < 12; i++) await key('ArrowUp', 300);
  await replace('alpha', 'ALPHABETICAL');
  console.log(await docText());
  const d1 = await docStat();
  check('lengthening replace: same paragraph count', d1.hard === d0.hard, [d0, d1]);
  check('lengthening replace: table unchanged', JSON.stringify(await table()) === JSON.stringify(t0), await table());
  await replace('ALPHABETICAL', 'a');
  const d2 = await docStat();
  check('shortening replace: same paragraph count', d2.hard === d0.hard, [d0, d2]);
  check('shortening replace: table unchanged', JSON.stringify(await table()) === JSON.stringify(t0), await table());
  await replace('gamma', 'g');
  check('replace in a font paragraph keeps the table', JSON.stringify(await table()) === JSON.stringify(t0), await table());
  await replace('delta', 'DELTADELTADELTA');
  check('replace after the font paragraphs keeps the table', JSON.stringify(await table()) === JSON.stringify(t0), await table());
  const d3 = await docStat();
  check('paragraph count still the same', d3.hard === d0.hard, [d0, d3]);

  // a failed open keeps everything
  await openDoc('h:missing.cwd');
  check('failed open keeps the table', JSON.stringify(await table()) === JSON.stringify(t0), await table());
  const d4 = await docStat();
  check('failed open keeps the document', d4.len === d3.len, [d3, d4]);

  // opening a CRFT file without font tags forgets the table
  await openDoc('h:nofont.cwd');
  check('opening a CRFT file without tags clears the table', (await table()).length === 0, await table());
  const d5 = await docStat();
  check('and loads that file', d5.len === base.len && d5.hard === base.hard, [base, d5]);

  // fonts again, then open the plain text file (import path)
  await down(1); await setFont();
  check('font set again', (await table()).length === 1, await table());
  await openDoc('h:ed.txt');
  check('opening a text file (import) clears the table', (await table()).length === 0, await table());
  check('no page errors', errs.length === 0, errs);
  console.log(fails ? 'FAILS ' + fails : 'all ok');
  await b.close(); process.exit(fails ? 1 : 0);
})();
