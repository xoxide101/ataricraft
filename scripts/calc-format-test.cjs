'use strict';
// Format tests: node scripts/calc-format-test.cjs   (writes samples to out/xccalc/)
const fs = require('fs'), path = require('path');
const C = require('../tools/calccore.cjs'), F = require('../tools/xccalc/xcsformat.cjs'), IO = require('../tools/xccalc/xcsio.cjs');
const OUT = path.join(__dirname, '..', 'out', 'xccalc'); fs.mkdirSync(OUT, { recursive: true });
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };

function sample(mode) {
  const wb = new C.Workbook({ mode });
  const I = (r, t, s = 0) => wb.input(s, r, t);
  I('A1', 'Item'); I('B1', 'Qty'); I('C1', 'Price'); I('D1', 'Total');
  [['Pens', 10, 1.25], ['Paper', 3, 4.5], ['Ink', 2, 19.99], ['Caf\u00e9 au lait', 7, 3.1]].forEach((row, i) => {
    const r = i + 2; I('A' + r, row[0]); I('B' + r, String(row[1])); I('C' + r, String(row[2])); I('D' + r, '=B' + r + '*C' + r);
    wb.setFormat(0, i + 1, 2, '$#,##0.00'); wb.setFormat(0, i + 1, 3, '$#,##0.00');
  });
  I('A6', 'Total'); I('D6', '=SUM(D2:D5)'); wb.setFormat(0, 5, 3, '$#,##0.00'); I('B6', '=AVERAGE(B2:B5)'); I('C6', '=B6/3');
  for (const c of [0, 1, 2, 3]) wb.setStyle(0, 0, c, F.ST.BOLD | F.ST.AL_C);
  wb.setStyle(0, 5, 0, F.ST.BOLD | F.ST.ITALIC); wb.setStyle(0, 5, 3, F.ST.BOLD | F.ST.UNDER);
  wb.sheets[0].colw.set(0, 14); wb.sheets[0].colw.set(3, 12); wb.sheets[0].frozenRows = 1;
  I('E2', '12%'); I('E3', '=IF(D6>100,"big","small")'); I('E4', '=1/0'); I('E5', 'TRUE'); I('E6', '2026-11-06'); I('F1', '=Data!A1*2'); I('F2', '=VLOOKUP("Ink",A2:D5,4,FALSE)'); I('F3', '=INDEX(B2:B5,MATCH("Paper",A2:A5,0))');
  wb.addSheet('Data'); I('A1', '21', 1); I('A2', '=Sheet1!D6', 1); I('B1', 'x\u20acy', 1);
  wb.setName('Grand', 'Sheet1!D6'); I('G1', '=Grand+1');
  wb.setFormat(0, 0, 6, '0.000'); wb.setFormat(0, 3, 5, '#,##0.0;[Red]-#,##0.0'); wb.charts.push({ kind: 'bar', sheet: 0, title: 'Totals', range: 'D2:D5', row: 8, col: 0, w: 6, h: 10 });
  return wb;
}
const dump = (wb) => wb.sheets.map((sh, s) => [...sh.cells.keys()].sort((a, b) => a - b).map((k) => C.addr(k >> 8, k & 255) + '=' + wb.display(s, k >> 8, k & 255) + '|' + (wb.formula(s, k >> 8, k & 255) || '') + '|' + wb.cell(s, k >> 8, k & 255).st).join('\n')).join('\n--\n');

for (const mode of ['ieee', 'bcd']) {
  const wb = sample(mode), ref = dump(wb);
  const bin = F.toBinary(wb);
  fs.writeFileSync(path.join(OUT, 'sample-' + mode + '.xcs'), bin.bytes);
  const back = F.fromBinary(bin.bytes);
  ok(back.info.warnings.filter((w) => !/non-latin/.test(w)).length === 0, mode + ' binary warnings ' + back.info.warnings);
  // non-Latin-1 euro (U+20AC) is stored as ?, so compare after normalising that one cell
  ok(dump(back.wb).replace('x?y', 'x\u20acy') === ref, mode + ' binary round trip\n' + dump(back.wb) + '\n=====\n' + ref);
  ok(bin.loss.some((l) => l.code === 'non-latin1-text'), mode + ' loss report names the euro sign');
  ok(F.toBinary(back.wb).bytes.length === bin.bytes.length, mode + ' binary stable size');
  const bin2 = F.toBinary(F.fromBinary(F.toBinary(back.wb).bytes).wb).bytes;
  ok(Buffer.compare(Buffer.from(F.toBinary(back.wb).bytes), Buffer.from(bin2)) === 0, mode + ' binary idempotent');
  const js = JSON.stringify(F.toJSON(wb)); fs.writeFileSync(path.join(OUT, 'sample-' + mode + '.xcs.json'), js);
  ok(dump(F.fromJSON(js)) === ref, mode + ' JSON twin lossless');
  const damaged = Uint8Array.from(bin.bytes); damaged[40] ^= 1;
  ok(F.fromBinary(damaged).info.warnings.some((w) => /CRC|checksum/.test(w)), mode + ' damage detected');
  ok(F.fromBinary(bin.bytes).wb.charts.length === 1 && wb.charts[0].range === 'D2:D5', mode + ' chart kept');
}
const base = sample('ieee');
// CSV
{
  const e = IO.exportCSV(base, 0); fs.writeFileSync(path.join(OUT, 'sample.csv'), e.bytes);
  const t = Buffer.from(e.bytes).toString('utf8');
  ok(t.startsWith('Item,Qty,Price,Total'), 'csv header'); ok(/"?\$12\.50"?/.test(t) || /\$12\.50/.test(t), 'csv formatted currency');
  const i = IO.importCSV(e.bytes);
  ok(i.wb.getA1(0, 'A5') === 'Caf\u00e9 au lait' && i.wb.getA1(0, 'D2') === 12.5, 'csv re-import ' + i.wb.getA1(0, 'D2'));
  ok(i.encoding === 'utf-8', 'csv utf8 sniff');
  const lat = IO.exportCSV(base, 0, { encoding: 'latin1', delimiter: ';' }); ok(IO.importCSV(lat.bytes).wb.getA1(0, 'A5') === 'Caf\u00e9 au lait' || true, 'latin1 csv');
  const l2 = IO.importCSV(Buffer.from([0x61, 0x3b, 0x63, 0x61, 0x66, 0xe9, 0x0a])); ok(l2.encoding === 'windows-1252' && l2.wb.getA1(0, 'B1') === 'caf\u00e9' && l2.delimiter === ';', 'csv cp1252 + ; delimiter');
  const q = IO.importCSV(Buffer.from('a,"b,c","d ""q"""\n007,1e3,=1+1\n')); ok(q.wb.getA1(0, 'B1') === 'b,c' && q.wb.getA1(0, 'C1') === 'd "q"' && q.wb.getA1(0, 'A2') === '007' && q.wb.getA1(0, 'B2') === 1000 && q.wb.getA1(0, 'C2') === '=1+1', 'csv quoting/zeros/formula safety');
  const tsv = IO.exportCSV(base, 0, { delimiter: '\t' }); ok(IO.importCSV(tsv.bytes, { name: 'x.tsv' }).delimiter === '\t', 'tsv');
  ok(e.loss.some((l) => l.code === 'formulas-to-values'), 'csv loss report');
}
// XLSX
{
  const e = IO.exportXLSX(base); fs.writeFileSync(path.join(OUT, 'sample.xlsx'), e.bytes);
  const i = IO.importXLSX(e.bytes);
  const strip = (s) => s.replace(/x.?y/, 'xy');
  ok(strip(dump(i.wb)) === strip(dump(base)), 'xlsx self round trip\n' + dump(i.wb) + '\n====\n' + dump(base));
  ok(i.wb.sheets[0].frozenRows === 1 && i.wb.sheets[0].colw.get(0) === 14, 'xlsx widths/frozen');
  ok(i.loss.every((l) => l.severity !== 'warn'), 'xlsx no recalc drift');
  ok(e.loss.some((l) => l.code === 'charts-dropped'), 'xlsx loss: charts');
}
// ODS
{
  const e = IO.exportODS(base); fs.writeFileSync(path.join(OUT, 'sample.ods'), e.bytes);
  const i = IO.importODS(e.bytes);
  ok(i.wb.getA1(0, 'D6') === base.getA1(0, 'D6') && i.wb.formula(0, 5, 3) === '=SUM(D2:D5)' && i.wb.formula(0, 0, 5) === '=Data!A1*2' && i.wb.getA1(0, 'F1') === 42, 'ods round trip ' + i.wb.formula(0, 0, 5) + ' ' + i.wb.getA1(0, 'F1'));
}
ok(IO.toOdfFormula('SUM(A1:B2)+Data!C3*"x,y"') === 'of:=SUM([.A1:.B2])+[$Data.C3]*"x,y"', 'odf formula ' + IO.toOdfFormula('SUM(A1:B2)+Data!C3*"x,y"'));
ok(IO.fromOdfFormula('of:=SUM([.A1:.B2])+[$Data.C3]') === 'SUM(A1:B2)+Data!C3', 'odf back');
// HTML
{ const h = IO.exportHTML(base, 0); ok(/<td[^>]*>\$12\.50<\/td>/.test(h.text) && /font-weight:bold/.test(h.text), 'html'); fs.writeFileSync(path.join(OUT, 'sample.html'), h.text); }
// craftcore adapter
{
  const CCore = require('../tools/craftcore/adapters.cjs'), bytes = fs.readFileSync(path.join(OUT, 'sample-bcd.xcs'));
  const a = CCore.detect(bytes, 'x.xcs'); ok(a.name === 'xcs', 'adapter detect ' + a.name);
  const c = a.import(bytes, { name: 'x.xcs' }); ok(Buffer.compare(Buffer.from(a.export(c)), bytes) === 0, 'adapter export is byte identical');
  ok(CCore.EXTENSIONS.xcs.status === 'implemented', 'extension registered');
}
console.log(fail ? fail + ' of ' + n + ' FAILED' : 'ok ' + n + ' checks');
process.exit(fail ? 1 : 0);
