// ACWriter selection / copy / cut / paste / find / replace / goto in the emulator.
// Usage: node scripts/acwriter-edit.cjs [130xe|800xl]   Screenshots: out/acw-edit-<model>-N.png
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const MODEL = process.argv[2] || '130xe';
let TEXT = 'alpha beta gamma\rDelta epsilon zeta\rEta theta iota\r';
for (let i = 4; i <= 30; i++) TEXT += 'line number ' + i + ' filler text\r';
TEXT += 'the end Beta final\r';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', MODEL).catch(() => {});
  await p.selectOption('#ram', MODEL === '130xe' ? '128' : '64').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.evaluate((t) => FujiNet.emu.hostWrite('ED.TXT', new Uint8Array([...t].map((c) => c.charCodeAt(0) === 13 ? 155 : c.charCodeAt(0)))), TEXT);
  const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const cap = async (ch) => { await p.keyboard.down('Shift'); await p.keyboard.press(ch); await p.keyboard.up('Shift'); await p.waitForTimeout(700); };
  const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 800); };
  const shot = (n) => p.locator('canvas').first().screenshot({ path: ROOT + '/out/acw-edit-' + MODEL + '-' + n + '.png' });
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(800); };
  const peek = (a, n = 1) => p.evaluate(([x, m]) => ataricraft.peek(x, m), [a, n]);
  const doc = async (n = 400) => { const a = await p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [0x6400, n]); return String.fromCharCode(...a.map((c) => c === 13 || c === 14 ? 124 : c < 32 ? 94 : c)); };
  const lineOf = async (n) => (await doc(900)).split('|')[n];
  let fails = 0;
  const check = (name, ok, extra) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); };
  const state = async () => ({ cl: (await peek(0x93))[0], cc: (await peek(0x94))[0], sel: (await peek(0x14C0))[0], clip: (await peek(0x14C8))[0], cmsg: (await peek(0xAC))[0] });
  await key('ArrowDown', 900);
  await menu('f', 'o'); await type('h:ed.txt'); await key('Enter', 2500);
  check('file loaded', (await lineOf(0)) === 'alpha beta gamma', await lineOf(0));
  await shot('0-loaded');
  // select "alph" with ^S + arrows, copy with ^Y
  await key('Control+s', 600); for (let i = 0; i < 4; i++) await key('ArrowRight', 1600);
  await shot('1-selected');
  check('selection active', (await state()).sel === 1);
  await key('Control+y', 900); await shot('2-copied');
  let s = await state();
  check('copy: clipboard 4 bytes, selection cleared, doc unchanged', s.clip === 4 && s.sel === 0 && (await lineOf(0)) === 'alpha beta gamma', s);
  // paste at the start of line 2
  await key('ArrowDown', 500); await key('Control+a', 500); await key('Control+p', 1200); await shot('3-pasted');
  check('paste at line start', (await lineOf(1)) === 'alphDelta epsilon zeta', await lineOf(1));
  // cut "alp" from there, paste at the end of line 1
  await key('Control+a', 500); await key('Control+s', 600); for (let i = 0; i < 3; i++) await key('ArrowRight', 1600);
  await key('Control+d', 1000); await shot('4-cut');
  check('cut removes the text', (await lineOf(1)) === 'hDelta epsilon zeta', await lineOf(1));
  await key('ArrowUp', 500); await key('Control+e', 500); await key('Control+p', 1200); await shot('5-pasted-end');
  check('paste at end of line 1', (await lineOf(0)) === 'alpha beta gammaalp', await lineOf(0));
  // Home / End
  await key('Control+a', 500); s = await state(); check('^A = line start', s.cc === 0, s);
  await key('Control+e', 500); s = await state(); check('^E = line end', s.cc === 19, s);
  // find (case-insensitive: "beta" also matches "Beta" on the last line)
  await key('Control+g', 800); await shot('6-findprompt');
  await type('beta'); await key('Enter', 2200); await shot('7-found');
  s = await state(); check('find: selects the next match (last line)', s.sel === 1 && s.cl === 30, s);
  await key('Control+g', 1500); await shot('8-findnext');
  s = await state(); check('find next wraps to line 1', s.sel === 1 && s.cl === 0, s);
  await key('Escape', 600);
  // goto line
  await key('Control+l', 800); await type('2'); await key('Enter', 2200); await shot('9-goto');
  s = await state(); check('goto line 2', s.cl === 1 && s.cc === 0, s);
  await key('Control+l', 800); await type('99'); await key('Enter', 2200);
  s = await state(); check('goto past the end clamps to the last line', s.cl === (await peek(0x96))[0] - 1, s);
  // replace: beta -> zed (typed under the Atari caps lock, so ZED), Y then N
  await key('Control+l', 800); await type('1'); await key('Enter', 2000);
  await key('Control+r', 800); await type('beta'); await key('Enter', 900); await type('zed'); await key('Enter', 2200); await shot('10-replace-prompt');
  s = await state(); check('replace prompt shown', s.cmsg === 32 && s.sel === 1, s);
  await key('y', 1500); await shot('11-replaced-one');
  check('Y replaced the first match', (await lineOf(0)) === 'alpha ZED gammaalp', await lineOf(0));
  await key('n', 1500); await shot('12-skipped');
  check('N skipped the second', (await lineOf(30)) === 'the end Beta final', await lineOf(30));
  // replace all: line -> LN
  await key('Control+l', 800); await type('1'); await key('Enter', 2000);
  await key('Control+r', 800); await type('line'); await key('Enter', 900); await type('LN'); await key('Enter', 2200);
  await key('a', 1000); for (let i = 0; i < 60 && (await peek(0x14C2))[0]; i++) await p.waitForTimeout(1000);
  await p.waitForTimeout(1500); await shot('13-replace-all');
  check('A replaced all', (await lineOf(4)) === 'LN number 5 filler text' && (await lineOf(29)) === 'LN number 30 filler text' && (await peek(0x14C5))[0] === 27, [await lineOf(4), await lineOf(29), await peek(0x14C5), await state()]);
  console.log('fails:', fails, 'errors:', errs);
  await b.close();
})();