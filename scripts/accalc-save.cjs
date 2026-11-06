// ACCalc save/recalc test: load TEST.XCS (blank caches), ^R, ^S, read the saved file back and compare with the
// calccore atari-bcd values (TESTFULL.XCS) and the JS cached values. usage: node scripts/accalc-save.cjs
const fs = require('fs'), path = require('path');
const { build, boot, OUT } = require('./accalc-test.cjs');
const gen = require('./accalc-gen.cjs'), X = require('../tools/xccalc/xcsformat.cjs');

function cellsOf(wbr) {
  const wb = wbr.wb || wbr, m = {};
  for (const sh of wb.sheets) for (const [kk, x] of sh.cells) m[String.fromCharCode(65 + (kk & 255)) + ((kk >> 8) + 1)] = x;
  return m;
}
const show = (v) => (v && v.err ? v.err : String(v));

(async () => {
  const g = gen.make();
  const e = await boot(build(), { 'TEST.XCS': g.blank, 'TESTFULL.XCS': g.full });
  await e.key('Control+o', 900); await e.type('h:test', 250); await e.key('Enter', 5000);
  await e.key('Control+r', 3000);
  await e.key('Control+s', 900); await e.type('h:saved', 250); await e.key('Enter', 6000);
  await e.shot('20-saved');
  const host = await e.host();
  await e.close();
  const name = Object.keys(host).find((k) => /SAVED/i.test(k));
  if (!name) { console.log('no saved file; host files:', Object.keys(host)); process.exit(1); }
  const bytes = Uint8Array.from(host[name]);
  fs.writeFileSync(path.join(OUT, 'SAVED.XCS'), bytes);
  console.log(bytes.length, Array.from(bytes.slice(0,20)), g.full.constructor.name, g.full.length);
  const got = X.fromBinary(bytes), exp = X.fromBinary(Uint8Array.from(g.full));
  console.log('saved bytes', bytes.length, 'warnings', JSON.stringify(got.warnings || got.info || []));
  const a = cellsOf(got), b = cellsOf(exp);
  let bad = 0, n = 0, f = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    n++;
    const x = a[k], y = b[k];
    if (!x || !y) { bad++; console.log('MISSING', k, !!x, !!y); continue; }
    if ((x.f || '') !== (y.f || '')) { bad++; console.log('FORMULA', k, x.f, y.f); }
    if (x.fmt !== y.fmt || (x.st || 0) !== (y.st || 0)) { bad++; console.log('STYLE', k, x.fmt, y.fmt, x.st, y.st); }
    const vx = x.val, vy = y.val;
    if (x.f) f++;
    const same = vx && vx.err !== undefined ? vy && vx.err === vy.err : vx === vy;
    if (!same) { bad++; console.log('VALUE', k, x.f || '', 'atari', show(vx), 'js', show(vy)); }
  }
  console.log(`cells ${n} formulas ${f} differing ${bad}`);
  process.exit(0);
})();

