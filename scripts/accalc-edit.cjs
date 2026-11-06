// ACCalc entry/edit test: type numbers, text and formulas into an empty sheet, edit a cell, clear one, format it,
// save, reopen with calccore and check. usage: node scripts/accalc-edit.cjs
const fs = require('fs'), path = require('path');
const { build, boot, OUT } = require('./accalc-test.cjs');
const X = require('../tools/xccalc/xcsformat.cjs');

(async () => {
  const e = await boot(build(), {});
  const enter = async (t, w = 2500) => { await e.type(t, 200); await e.key('Enter', w); };
  const cur = async () => (await e.peek(0x90, 2));
  const goto = async (r) => { for (let g = 0; g < 40; g++) { const [cr] = await cur(); if (cr === r) return; await e.key(cr < r ? 'ArrowDown' : 'ArrowUp', 600); } throw new Error('goto failed'); };
  await enter('5'); await enter('7'); await enter('=SUM(A1:A2)'); await enter('=A3*2+0.1');
  await enter('hello'); await enter('=1/0'); await enter('-1.5e3'); await enter('12 apples');
  await e.shot('30-entered');
  await goto(0); await enter('10');
  await e.shot('31-edited');
  await goto(3); await e.key('Control+e', 1000); await e.shot('32-edit-formula');
  await e.key('Escape', 600);
  await goto(4); await e.bksp(2500);                       // clear A5
  await goto(3); await e.key('Control+f', 900); await e.key('Control+f', 900); await e.key('Control+b', 900);   // A4: 0.00 bold
  await goto(6); await e.key('Control+e', 1000); await e.shot('33-edit-number');
  await e.key('Escape', 600);
  await e.shot('34-final');
  await e.key('Control+s', 900); await e.type('h:edited', 250); await e.key('Enter', 6000);
  const host = await e.host();
  await e.close();
  const name = Object.keys(host).find((k) => /EDITED/i.test(k));
  if (!name) { console.log('no saved file', Object.keys(host)); process.exit(1); }
  const bytes = Uint8Array.from(host[name]);
  fs.writeFileSync(path.join(OUT, 'EDITED.XCS'), bytes);
  const r = X.fromBinary(bytes);
  console.log('warnings', JSON.stringify(r.warnings));
  const got = {};
  for (const sh of r.wb.sheets) for (const [kk, x] of sh.cells) got['A' + ((kk >> 8) + 1)] = x;
  const exp = { A1: [null, 10], A2: [null, 7], A3: ['SUM(A1:A2)', 17], A4: ['A3*2+0.1', 34.1], A6: ['1/0', '#DIV/0!'], A7: [null, -1500], A8: [null, '12 APPLES'] };
  let bad = 0;
  for (const [k, [f, v]] of Object.entries(exp)) {
    const x = got[k]; const gv = x && (x.val && x.val.err ? x.val.err : x.val);
    const ok = x && (x.f || null) === f && gv === v;
    if (!ok) { bad++; console.log('BAD', k, x && x.f, gv, 'expected', f, v); }
  }
  if (got.A5 && (got.A5.val !== null || got.A5.f)) { bad++; console.log('BAD A5 not cleared', got.A5.val); }
  if (!got.A4 || got.A4.fmt !== 2 || (got.A4.st & 1) !== 1) { bad++; console.log('BAD A4 format/style', got.A4 && got.A4.fmt, got.A4 && got.A4.st); }
  console.log('edit test', bad ? 'FAILED ' + bad : 'OK');
  process.exit(bad ? 1 : 0);
})();


