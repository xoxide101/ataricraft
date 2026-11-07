// ACWriter 0.1.7 item 2: Windows-style selection. Shift+arrow starts and extends a selection, Ctrl+X cuts, Backspace
// deletes, typing replaces. The web emulator sends no Shift flag with the cursor keys, so Shift+arrow is injected
// by writing the Atari key code (cursor key | $40 shift) straight into CH ($02FC).
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
let fails = 0;
const check = (m, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
(async () => {
  const t = await L.boot({ wait: 17000 });
  const { key, type } = t;
  const out = 'scripts/select-shots';
  fs.mkdirSync(out, { recursive: true });
  const doc = async () => {
    const e = await t.peek(0xA6, 2); const n = e[0] + e[1] * 256 - 0x6400; if (n <= 0) return ''; const m = await t.peek(0x6400, n); let s = '';
    for (const v of m) s += v >= 32 && v < 127 ? String.fromCharCode(v) : '<' + v + '>';
    return s;
  };
  const SH = { right: 0xC7, left: 0xC6, up: 0xCE, down: 0xCF };
  const shift = async (d, n = 1) => { for (let i = 0; i < n; i++) { await t.p.evaluate((c) => ataricraft.poke(0x2FC, [c]), SH[d]); await t.p.waitForTimeout(800); } };
  await key('n', 2500);
  await type('abcdef', 500);
  await key('ArrowLeft', 700); await key('ArrowLeft', 700); await key('ArrowLeft', 700);
  await shift('right', 2);
  await t.shot(out + '/selected-de.png');
  await key('Control+x', 1500);
  check('Ctrl+X cuts "de"', (await doc()) === 'abcf', await doc());
  await key('ArrowRight', 700);
  await key('Control+p', 1500);
  check('paste puts "de" back', (await doc()).includes('de'), await doc());
  await t.shot(out + '/pasted.png');
  // Shift+Left selects backwards, Backspace deletes it
  await shift('left', 2);
  await key('Backspace', 1500);
  const d1 = await doc();
  check('Shift+Left x2 then Backspace deletes 2 chars', d1.length === 4, d1);
  // type-over
  await shift('left', 1);
  await key('Shift+z', 800);
  const d2 = await doc();
  check('typing replaces the selection', d2.includes('Z') && d2.length === 4, d2);
  // plain arrow collapses a Shift selection without deleting
  await shift('left', 2);
  await key('ArrowLeft', 900);
  const d3 = await doc();
  check('plain arrow ends the selection, text kept', d3 === d2, d3);
  await key('Home', 600);
  await t.shot(out + '/end.png');
  console.log(fails ? fails + ' FAIL' : 'select: 0 fails', t.errs.join('|'));
  await t.b.close();
  process.exit(fails ? 1 : 0);
})();



