// ACWriter item 4: Word-style typing styles (^B ^I ^U ^T apply to text typed afterwards), selection styling, align and indent keys.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
const ok = (m) => console.log('ok  ' + m);
const bad = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };
(async () => {
  const t = await L.boot({ wait: 17000 });
  const { key, type } = t;
  const out = L.ROOT + '/out/shots/keys';
  fs.mkdirSync(out, { recursive: true });
  // document text with style codes shown as <n>
  const doc = async () => {
    const e = await t.peek(0xA6, 2); const n = e[0] + e[1] * 256 - 0x6400; const m = await t.peek(0x6400, Math.max(n, 1)); let s = '';
    for (const v of m) { if (v === 0) break; s += v >= 32 && v < 127 ? String.fromCharCode(v) : '<' + v + '>'; }
    return s;
  };
  const expect = async (label, want) => { const g = await doc(); g === want ? ok(label + ' -> ' + g) : bad(label + ': got ' + g + ' want ' + want); };
  await key('n', 2500);
  await key('CapsLock', 800);
  await type('plain ', 200);
  await key('Control+b', 400);
  await t.shot(out + '/1-bold-pending.png');
  await expect('bold armed, nothing inserted yet', 'plain ');
  await type('bold', 200);
  await key('Control+b', 400);
  await type(' after ', 200);
  await expect('bold only on typed text', 'plain <1>bold<1> after ');
  await key('Control+o', 300); await key('Control+u', 300); await key('Control+k', 300);
  await t.shot(out + '/2-combo-pending.png');
  await type('all', 500);
  await t.shot(out + '/3-combo-typed.png');
  const d = await doc();
  /<2><3><21>all/.test(d) ? ok('combination typed: ' + d) : bad('combination: ' + d);
  // toggle twice before typing changes nothing
  await key('Control+b', 700); await key('Control+b', 700);
  await type('x', 200);
  const d2 = await doc();
  d2.endsWith('allx') ? ok('double toggle adds no codes') : bad('double toggle: ' + d2);
  // alignment keys
  await key('Control+e', 600);
  const a1 = await doc(); a1.startsWith('<15>') ? ok('^E centres') : bad('^E: ' + a1);
  await key('Control+r', 600);
  const a2 = await doc(); a2.startsWith('<16>') ? ok('^R right') : bad('^R: ' + a2);
  await key('Control+z', 600);
  const a3 = await doc(); a3.startsWith('<17>') ? ok('^Z justify') : bad('^Z: ' + a3);
  await key('Control+l', 600);
  const a4 = await doc(); !/^<1[5-7]>/.test(a4) ? ok('^L left') : bad('^L: ' + a4);
  await key('Tab', 600);
  const i1 = await doc(); i1.startsWith('<18>') ? ok('Tab indents') : bad('Tab: ' + i1);
  await key('Tab', 600);
  const i2 = await doc(); !/^(<1[5-7]>)?<18>/.test(i2) ? ok('Tab again removes the indent') : bad('Tab2: ' + i2);
  // selection: mark with ^S, move, apply bold
  await key('Enter', 400);
  await type('select me', 500);
  await key('Control+a', 300);
  await key('Control+s', 300);
  for (let n = 0; n < 9; n++) await key('ArrowRight', 700);
  await key('Control+b', 600);
  const s1 = await doc();
  /<1>select me<1>/.test(s1) ? ok('selection bolded: ' + s1.slice(-30)) : bad('selection: ' + s1);
  await t.shot(out + '/4-selection-bold.png');
  console.log('errors', t.errs);
  await t.b.close();
})();
