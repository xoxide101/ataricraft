'use strict';
// Excel COM round trip: node scripts/calc-excel-test.cjs  (skips when Excel is not installed)
// 1) our formula results must equal Excel's for a function matrix, 2) a workbook saved by Excel must import and recalculate to the same values.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('../tools/calccore.cjs'), IO = require('../tools/xccalc/xcsio.cjs');
const EXCEL = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE';
if (!fs.existsSync(EXCEL)) { console.log('skip: Excel not installed'); process.exit(0); }
const OUT = path.join(__dirname, '..', 'out', 'xccalc'); fs.mkdirSync(OUT, { recursive: true });
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };

const FORMULAS = [
  'SUM(B1:B5)', 'AVERAGE(B1:B5)', 'MIN(B1:B5)', 'MAX(B1:B5)', 'COUNT(B1:B5,"x")', 'COUNTA(A1:A5)', 'COUNTBLANK(B1:C5)', 'MEDIAN(B1:B5)', 'PRODUCT(B1:B3)',
  'IF(B1>2,"y","n")', 'AND(B1>0,B2>0)', 'OR(B1>100,B2>100)', 'NOT(B1=1)', 'ROUND(2.5,0)', 'ROUND(-2.5,0)', 'ROUND(1.2345,3)', 'ROUNDUP(1.21,1)', 'ROUNDDOWN(-1.29,1)', 'ABS(-3.5)', 'INT(-2.5)', 'MOD(-7,3)', 'MOD(7,-3)', 'SQRT(2)', 'POWER(2,0.5)', '2^10', '-2^2', '10/4', '1/3', '50%+1', 'EXP(1)', 'LN(10)', 'LOG10(1000)', 'SIGN(-9)', 'PI()',
  'LEN("hello")', 'LEFT("hello",2)', 'RIGHT("hello",3)', 'MID("hello",2,3)', 'UPPER("abC")', 'LOWER("AbC")', 'TRIM("  a   b  ")', 'CONCAT("a",1,"b")', '"x"&1.5&TRUE', 'FIND("l","hello")', 'TEXT(1234.567,"#,##0.00")', 'TEXT(0.256,"0.0%")', 'TEXT(46000,"yyyy-mm-dd")', 'VALUE("12.5")',
  'VLOOKUP(3,B1:C5,2)', 'VLOOKUP(3,B1:C5,2,FALSE)', 'VLOOKUP("z",A1:B5,2,FALSE)', 'HLOOKUP(2,B1:C2,2,FALSE)', 'INDEX(B1:C5,2,2)', 'INDEX(B1:B5,3)', 'MATCH(3,B1:B5,0)', 'MATCH(3.5,B1:B5,1)', 'MATCH(30,B1:B5,-1)',
  'SUMIF(B1:B5,">2")', 'SUMIF(A1:A5,"a*",B1:B5)', 'COUNTIF(B1:B5,"<=3")', 'COUNTIF(A1:A5,"b")', 'IFERROR(1/0,"bad")', 'ISNUMBER(B1)', 'ISTEXT(A1)', 'ISBLANK(Z9)', 'ISERROR(1/0)', 'CHOOSE(2,"a","b","c")', 'ROW(B3)', 'COLUMN(C1)', 'DATE(2026,11,6)', 'YEAR(46000)', 'MONTH(46000)', 'DAY(46000)',
  '1/0', 'SQRT(-1)', 'NOSUCH(1)', '"a"+1', 'B1+B2*B3-B4/B5', '(B1+B2)*(B3-B4)', 'B1<>B2', 'A1="A1"', '"abc"<"abd"', 'IF(1,2)', 'SUM(Data!A1:A3)', 'Data!A1+Data!A2', 'AVERAGE(Data!A1:A3)*3',
];
function build() {
  const wb = new C.Workbook(); const I = (r, t, s = 0) => wb.input(s, r, t);
  ['a1', 'b', 'a', 'c', 'ab'].forEach((t, i) => I('A' + (i + 1), t === 'a1' ? 'A1' : t)); [1, 2, 3, 4, 5].forEach((v, i) => I('B' + (i + 1), String(v))); [10, 20, 30, 40, 50].forEach((v, i) => I('C' + (i + 1), String(v)));
  wb.addSheet('Data'); [1.5, 2.5, 4].forEach((v, i) => I('A' + (i + 1), String(v), 1));
  FORMULAS.forEach((f, i) => I('F' + (i + 1), '=' + f));
  return wb;
}
const wb = build(), x = IO.exportXLSX(wb); fs.writeFileSync(path.join(OUT, 'matrix.xlsx'), x.bytes);
const dump = path.join(OUT, 'excel-dump.json'), saved = path.join(OUT, 'excel-saved.xlsx');
for (const f of [dump, saved]) if (fs.existsSync(f)) fs.unlinkSync(f);
const r = cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'calc-excel-com.ps1'), '-In', path.join(OUT, 'matrix.xlsx'), '-Dump', dump, '-Saved', saved], { encoding: 'utf8', timeout: 180000 });
if (!fs.existsSync(dump)) { console.log('Excel did not produce a dump', r.stderr.slice(0, 400)); process.exit(1); }
let ex = JSON.parse(fs.readFileSync(dump, 'utf8').replace(/^\uFEFF/, '')); if (!Array.isArray(ex)) ex = [ex];
const byAddr = new Map(ex.filter((e) => e.sheet === 'Sheet1').map((e) => [e.addr, e]));
const known = new Set(['NOSUCH(1)']); // not implemented here and not in Excel either
let diffs = 0;
FORMULAS.forEach((f, i) => {
  const a = 'F' + (i + 1), e = byAddr.get(a), mine = wb.getA1(0, a);
  let want = e ? e.v : undefined; const mineS = C.isErr(mine) ? mine.err : mine;
  if (e && e.err) want = e.text;
  const same = typeof mineS === 'number' && typeof want === 'number' ? Math.abs(mineS - want) <= 1e-9 * Math.max(1, Math.abs(want)) : mineS === want || (typeof mineS === 'boolean' && mineS === want);
  const tolerated = known.has(f) || (C.isErr(mine) && typeof want === 'string' && /^#/.test(want));
  if (!same && !(tolerated)) { diffs++; console.log('DIFF', f, 'ours', JSON.stringify(mineS), 'excel', JSON.stringify(want)); }
  if (C.isErr(mine) && typeof want === 'string' && /^#/.test(want) && mine.err !== want) console.log('note: error code differs for', f, mine.err, 'vs', want);
});
ok(diffs === 0, diffs + ' formula result(s) differ from Excel');
// Excel-saved workbook imports and recalculates identically; display text equality for formats
const imp = IO.importXLSX(fs.readFileSync(saved));
ok(imp.cachedTotal > 50 && imp.cachedDiff === 0, 'Excel-saved workbook recalculates to Excel values (' + imp.cachedDiff + ' of ' + imp.cachedTotal + ' differ)');
const unsup = imp.loss.filter((l) => /^unsupported/.test(l.code)); ok(unsup.length === 0 || unsup.every((l) => /NOSUCH/.test(l.code)), 'no unsupported functions ' + JSON.stringify(unsup));

// formats and styles through Excel: write, let Excel read, compare number formats/bold/align/text
const wf = new C.Workbook(); const I2 = (a, t) => wf.input(0, a, t);
I2('A1', '1234.5'); wf.setFormat(0, 0, 0, '#,##0.00'); I2('A2', '0.256'); wf.setFormat(0, 1, 0, '0.0%'); I2('A3', '46000'); wf.setFormat(0, 2, 0, 'yyyy-mm-dd'); I2('A4', '$9.5'); I2('A5', 'bold'); wf.setStyle(0, 4, 0, 1 | 2 | 4 | 16);
I2('A6', '12345'); wf.setFormat(0, 5, 0, '0.00E+00'); I2('A7', '-3.14159'); wf.setFormat(0, 6, 0, '0.000');
fs.writeFileSync(path.join(OUT, 'styles.xlsx'), IO.exportXLSX(wf).bytes);
const d2 = path.join(OUT, 'excel-styles.json'); if (fs.existsSync(d2)) fs.unlinkSync(d2);
cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'calc-excel-com.ps1'), '-In', path.join(OUT, 'styles.xlsx'), '-Dump', d2], { encoding: 'utf8', timeout: 180000 });
let es = JSON.parse(fs.readFileSync(d2, 'utf8').replace(/^\uFEFF/, '')); if (!Array.isArray(es)) es = [es];
const T = (a) => es.find((e) => e.addr === a);
ok(T('A1').text.trim() === wf.display(0, 0, 0) && T('A1').text.trim() === '1,234.50', 'Excel text A1 ' + T('A1').text);
ok(T('A2').text === '25.6%' && wf.display(0, 1, 0) === '25.6%', 'pct text ' + T('A2').text);
ok(T('A3').text === '2025-12-09' && wf.display(0, 2, 0) === '2025-12-09', 'date text ' + T('A3').text);
ok(T('A4').text.trim() === wf.display(0, 3, 0), 'currency ' + T('A4').text + ' vs ' + wf.display(0, 3, 0));
ok(T('A5').bold && T('A5').italic && T('A5').ul && T('A5').ha === -4108, 'styles bold/italic/underline/center ' + JSON.stringify(T('A5')));
ok(T('A6').text === wf.display(0, 5, 0), 'sci ' + T('A6').text + ' vs ' + wf.display(0, 5, 0));
ok(T('A7').text === wf.display(0, 6, 0), 'neg ' + T('A7').text + ' vs ' + wf.display(0, 6, 0));
console.log(fail ? fail + ' of ' + n + ' FAILED' : 'ok ' + n + ' checks (Excel COM, ' + FORMULAS.length + ' formulas compared)');
process.exit(fail ? 1 : 0);
