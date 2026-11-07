// ACWriter 0.1.7 item 1: typing case matches a PC keyboard with Caps Lock off and on, in text, zoom and page view.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
let fails = 0;
const check = (m, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
(async () => {
  const t = await L.boot({ wait: 17000 });
  const { key } = t;
  const out = 'scripts/case-shots';
  fs.mkdirSync(out, { recursive: true });
  const doc = async () => {
    const e = await t.peek(0xA6, 2); const n = e[0] + e[1] * 256 - 0x6400; if (n <= 0) return ''; const m = await t.peek(0x6400, n); let s = '';
    for (const v of m) s += v >= 32 && v < 127 ? String.fromCharCode(v) : '<' + v + '>';
    return s;
  };
  const caps = async () => (await t.peek(0x2BE))[0];
  await key('n', 2500);
  await t.shot(out + '/after-new.png');
  check('Caps Lock starts off', (await caps()) === 0, await caps());
  const seq = ['a', 'Shift+b', 'c', 'Shift+1', '1'];
  const run = async (label, want) => {
    const before = await doc();
    for (const k of seq) await key(k, 500);
    const got = (await doc()).slice(before.length);
    check(label + ' ' + got, got === want, { got, want });
  };
  await run('text, caps off: aBc!1', 'aBc!1');
  await key('CapsLock', 700);
  await run('text, caps on: AbC!1', 'AbC!1');
  await t.shot(out + '/text-caps-on.png');
  await key('CapsLock', 700);
  await key('Escape', 800); await key('l', 800); await key('z', 2500);
  await run('zoom, caps off', 'aBc!1');
  await key('CapsLock', 700);
  await run('zoom, caps on', 'AbC!1');
  await key('CapsLock', 700);
  await key('Escape', 800); await key('l', 800); await key('v', 2500);
  await run('page, caps off', 'aBc!1');
  await key('CapsLock', 700);
  await run('page, caps on', 'AbC!1');
  await t.shot(out + '/page-caps-on.png');
  console.log('fails:', fails, 'errors:', t.errs);
  await t.b.close();
  process.exit(fails ? 1 : 0);
})();
