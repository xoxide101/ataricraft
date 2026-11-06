// Builds the ACCalc test workbooks with calccore (bcd mode) and writes .xcs files with the formula caches blanked,
// so the Atari has to compute every formula itself. The expected values (JS engine, atari-bcd mode) go to a JSON file.
// usage: node scripts/accalc-gen.cjs [outdir]   (default out/accalc)
const fs = require('fs'), path = require('path');
const C = require('../tools/calccore.cjs');
const X = require('../tools/xccalc/xcsformat.cjs');

function build() {
  const wb = new C.Workbook({ mode: 'bcd', sheets: 0 });
  const s = wb.addSheet('Test');
  const V = (r, c, v) => wb.setValue(s, r, c, v);
  const F = (r, c, f) => wb.setFormula(s, r, c, f);
  ['Item', 'Qty', 'Price', 'Total'].forEach((t, i) => V(0, i, t));
  [['Apples', 3, 0.5], ['Pears', 12, 1.25], ['Plums', 7, 2.4]].forEach((row, i) => {
    V(i + 1, 0, row[0]); V(i + 1, 1, row[1]); V(i + 1, 2, row[2]); F(i + 1, 3, `B${i + 2}*C${i + 2}`);
  });
  V(4, 0, 'Sum');
  F(4, 1, 'SUM(B2:B4)'); F(4, 2, 'AVERAGE(C2:C4)'); F(4, 3, 'SUM(D2:D4)');
  V(5, 0, 'Stats');
  F(5, 1, 'MIN(B2:B4)'); F(5, 2, 'MAX(C2:C4)'); F(5, 3, 'COUNT(B2:D4)');
  V(6, 0, 'More');
  F(6, 1, 'IF(B5>20,1,0)'); F(6, 2, 'IF(C5<1,100,200)'); F(6, 3, 'PRODUCT(B2:B4)');
  V(7, 0, 'Fn');
  F(7, 1, 'ROUND(D4*1.07,1)'); F(7, 2, 'ABS(-B3)'); F(7, 3, '2^10');
  V(8, 0, 'Div');
  F(8, 1, 'B3/B4'); F(8, 2, '10/3'); F(8, 3, 'SQRT(16)');
  V(9, 0, 'Int');
  F(9, 1, 'INT(-2.5)'); F(9, 2, 'MOD(17,5)'); F(9, 3, 'ROUND(2.675,2)');
  V(10, 0, 'Err');
  F(10, 1, '1/0'); F(10, 2, 'A1+1'); F(10, 3, 'B11+1');
  V(11, 0, 'Prec');
  F(11, 1, '2+3*4^2'); F(11, 2, '-2^2'); F(11, 3, '(1+2)*(3+4)/7');
  V(12, 0, 'Big');
  F(12, 1, '1000000*1000000'); F(12, 2, '1/3'); F(12, 3, 'SQRT(2)');
  wb.setFormat(s, 1, 3, '0.00'); wb.setFormat(s, 4, 3, '$#,##0.00'); wb.setFormat(s, 12, 2, '0.000');
  wb.setStyle(s, 0, 0, 1); wb.setStyle(s, 0, 1, 1 | 24); wb.setStyle(s, 0, 2, 1 | 24); wb.setStyle(s, 0, 3, 1 | 24);
  wb.sheets[s].defaultColW = 9; wb.sheets[s].colw.set(0, 8); wb.sheets[s].colw.set(3, 11);
  wb.recalcAll();
  return { wb, s };
}

function make() {
  const { wb, s } = build();
  const expect = {}, saved = [];
  for (const [kk, x] of wb.sheets[s].cells) if (x.f) { const r = kk >> 8, c = kk & 255; saved.push([x, x.val]); expect[String.fromCharCode(65 + c) + (r + 1)] = x.val instanceof C.XErr ? { err: x.val.err } : x.val; x.val = null; }
  const blank = X.toBinary(wb).bytes;
  for (const [x, v] of saved) x.val = v;
  const full = X.toBinary(wb).bytes;
  return { blank, full, expect };
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'out', 'accalc');
  fs.mkdirSync(out, { recursive: true });
  const m = make();
  fs.writeFileSync(path.join(out, 'TEST.XCS'), m.blank);
  fs.writeFileSync(path.join(out, 'TESTFULL.XCS'), m.full);
  fs.writeFileSync(path.join(out, 'TEST.expect.json'), JSON.stringify(m.expect, null, 1));
  console.log('wrote', out, m.blank.length, 'bytes (blank caches),', m.full.length, 'bytes (cached)');
}
module.exports = { make, build };
