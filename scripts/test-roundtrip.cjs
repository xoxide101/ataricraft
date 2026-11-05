// Round-trip regression tests (Node side): xCWriter formats out and back in, real-world RTF variants, Word-made files, Atari size limits.
// Usage: node scripts/test-roundtrip.cjs
const assert = require('assert'), fs = require('fs'), path = require('path');
const X = require('../tools/xcwcore.cjs'), I = require('../tools/craftimport.cjs'), D = require('../tools/craftdoc.cjs');
const RTFS = require('./rtf-fixtures.cjs');
const root = path.join(__dirname, '..');
const ok = (m) => console.log('ok  ' + m);
const st = (t, o = {}) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0, ...o });
const sig = (ps) => ps.map((p) => p.align + (p.bullet ? '*' : ' ') + p.runs.map((r) => (r.b ? '<b>' : '') + (r.i ? '<i>' : '') + (r.u ? '<u>' : '') + (r.sup ? '<^>' : '') + (r.sub ? '<_>' : '') + r.t).join('|')).join('\n');
const textOf = (ps) => ps.map((p) => p.runs.map((r) => r.t).join('')).join('\n');
const rtf = (s) => X.openDoc(Buffer.from(s, 'latin1'), 'x.rtf').paras;
const find = (ps, re) => ps.find((p) => re.test(p.runs.map((r) => r.t).join('')));

// ---- 1. every xCWriter format out and back in ------------------------------
const doc = X.normalize([
  { align: 'c', bullet: false, runs: [st('Title', { b: 1 })] },
  { align: 'l', bullet: false, runs: [st('Plain '), st('bold', { b: 1 }), st(' '), st('it', { i: 1 }), st(' '), st('und', { u: 1 }), st(' x'), st('2', { sup: 1 }), st(' H'), st('2', { sub: 1 }), st('O \u201cq\u201d \u2014 caf\u00e9 \u20ac \\ { } * _ ` # < > &')] },
  { align: 'l', bullet: true, runs: [st('item one')] }, { align: 'l', bullet: true, runs: [st('item two', { b: 1, i: 1 })] },
  { align: 'r', bullet: false, runs: [st('right')] }, { align: 'j', bullet: false, runs: [st('justified text')] },
  { align: 'l', bullet: false, runs: [st('')] }, { align: 'l', bullet: false, runs: [st('last')] },
]);
const back = (fmt) => X.openDoc(X.save(doc, fmt).bytes, 'x.' + fmt, { format: fmt === 'cwd' ? 'craft' : fmt });
for (const fmt of ['rtf', 'html', 'docx']) { assert.strictEqual(sig(back(fmt).paras), sig(doc.map((p) => p)), fmt + ' round trip'); ok(fmt + ': styles, alignment, bullets, unicode and the empty paragraph survive'); }
{
  const cwd = back('cwd').paras, want = sig(doc).replace(/\u201c|\u201d/g, '"').replace(/\u2014/g, '-').replace(/\u20ac/g, 'E');
  assert.strictEqual(sig(cwd), want); ok('cwd: everything survives; curly quotes, dash and euro become ASCII look-alikes');
}
{
  const md = back('md').paras;
  assert.strictEqual(md.length, doc.length); assert(md[1].runs.some((r) => r.b && r.t === 'bold')); assert(md[1].runs.some((r) => r.i && r.t === 'it'));
  assert(md[3].bullet && md[3].runs[0].b && md[3].runs[0].i); assert.strictEqual(textOf(md), textOf(doc));
  assert(!md[1].runs.some((r) => r.u || r.sup || r.sub) && md[0].align === 'l');
  ok('md: bold/italic/bullets/text/escapes survive; underline, sub/sup, alignment are lost');
}
for (const fmt of ['text', 'atascii']) {
  const t = back(fmt).paras; assert.strictEqual(t.length, doc.length);
  assert(t.every((p) => !p.runs.some((r) => r.b || r.i || r.u)));
  assert(/^ +Title$/.test(textOf([t[0]])) && /^\* item one$/.test(textOf([t[2]]))); assert(/^ +right$/.test(textOf([t[4]])));
  ok(fmt + ': plain lines only (centre/right become spaces, bullets "* "), no styles');
}
assert(textOf(back('atascii').paras).includes('caf?')); ok('atascii: e-acute becomes ? (not in the Atari set used by the exporter)');

// ---- 2. real-world RTF variants ---------------------------------------------
{
  const w = rtf(RTFS.wordpad);
  assert.strictEqual(w.length, 6);
  assert(w[0].align === 'c' && w[0].runs[0].b && w[0].runs[0].t === 'WordPad Title');
  assert(w[2].bullet && w[3].bullet && textOf([w[2]]) === 'First bullet');
  assert(w[1].runs.some((r) => r.b && r.t === 'bold') && w[1].runs.some((r) => r.i && r.t === 'italic') && w[1].runs.some((r) => r.u && r.t === 'underline'));
  assert.strictEqual(w[4].align, 'r'); assert(!/Calibri|Riched|red255/.test(textOf(w)));
  ok('WordPad-style RTF: fonttbl/colortbl/generator skipped, \\pntext bullets, \\qc/\\qr, bold/italic/underline');
}
{
  const e = rtf(RTFS.escapes), t = textOf(e);
  assert(t.includes('Smart \u2019quote'), 'unicode escape ' + t); assert(t.includes('dash\u2014x')); assert(t.includes('euro \u20ac and caf\u00e9 and \u00e9-acute'), 'euro + hex + skip: ' + t);
  assert(t.includes('Two skip \u201c\u201dq') === false && t.includes('Two skip \u201cq\u201d after'), '\\uc2 skips two fallback bytes: ' + t);
  assert(t.includes('Negative \ud83d\udc00?') === false); assert(t.includes('done and visible, esc \\ { }'), 'escapes + unknown destination: ' + t);
  assert(!/Secret|ACME|Nobody|header text|footer text|example\.com|HYPERLINK|PAGE|0102|89504e/.test(t), 'hidden groups leaked: ' + t);
  assert(find(e, /^bold bold-italic all three/).runs.map((r) => (r.b ? 'b' : '') + (r.i ? 'i' : '') + (r.u ? 'u' : '')).join() === 'b,bi,biu,b,', 'nested groups restore styles');
  assert(find(e, /^Line one/) && find(e, /^Line two {4}tabbed/)); assert(find(e, /^Centred/).align === 'c' && find(e, /^Left again/).align === 'l');
  assert(find(e, /^Before-after picture\.$/) && find(e, /^After PNG\.$/), 'pictures skipped');
  const lk = find(e, /^link text trailing/); assert(lk && lk.runs[0].u, 'hyperlink result kept, instruction dropped'); assert(find(e, /^3 page field/));
  const craft = I.toModel(Buffer.from(RTFS.escapes, 'latin1'), 'x.rtf').paras; assert(textOf(craft).includes('caf\u00e9') && textOf(craft).includes("Smart 'quote") && textOf(craft).includes('euro E and'));
  ok('hand-written RTF: \\u8217?, \\uc1/\\uc2, \\\'xx cp1252, info/stylesheet/header groups, \\pict, \\field, nested groups, \\line, \\tab all handled');
}
{
  const t = rtf(RTFS.table), tx = t.map((p) => p.runs.map((r) => r.t).join(''));
  assert.deepStrictEqual(tx, ['Before table', 'Name | Qty | Price', 'Apple | 3 | 1.50', 'After table']); assert(t[2].runs[0].b);
  ok('RTF table: one line per row, cells joined with " | "');
}
assert.strictEqual(textOf(rtf('{\\rtf1 a\\par\\pard\\qc b\\par c\\par\\pard d\\par}')), 'a\nb\nc\nd');
assert.deepStrictEqual(rtf('{\\rtf1\\qc a\\par b\\par\\pard c\\par}').map((p) => p.align), ['c', 'c', 'l']); ok('RTF paragraph alignment persists until \\pard');
assert.strictEqual(textOf(rtf('{\\rtf1 {\\b one} \\plain two \\b three\\plain  four\\par}')), 'one two three four'); ok('\\plain resets character styles');

// ---- 3. files made by real Word (docs/samples/word) ---------------------------
const wd = path.join(root, 'docs', 'samples', 'word');
const want = ['Quarterly Report', 'Centred line', 'Right aligned line', 'First bullet', 'Second bullet', 'Name | Qty | Price', 'Apple | 3 | 1.50', 'After the table.'];
for (const f of ['rich.docx', 'rich.rtf', 'rich.doc']) {
  const r = X.openDoc(fs.readFileSync(path.join(wd, f)), f), tx = r.paras.map((p) => p.runs.map((x) => x.t).join(''));
  for (const w of want) assert(tx.includes(w), f + ' missing line ' + JSON.stringify(w) + ' in ' + JSON.stringify(tx));
  assert(tx.some((l) => l.includes('\u201csmart quotes\u201d') && l.includes('\u2014') && l.includes('H2O')), f + ' smart quotes');
  assert(tx.some((l) => l.includes('\u00a9') && l.includes('\u20ac') && l.includes('\u00e9') && l.includes('\u2122')), f + ' symbols: ' + tx.find((l) => /Symbols/.test(l)));
  assert(tx.some((l) => /^A hyperlink: example link end\.$/.test(l)));
  if (f !== 'rich.doc') {
    const p1 = r.paras.find((p) => /^Plain intro/.test(p.runs.map((x) => x.t).join('')));
    assert(p1.runs.some((x) => x.b && x.t === 'bold') && p1.runs.some((x) => x.i && x.t === 'italic') && p1.runs.some((x) => x.u && x.t === 'underline') && p1.runs.some((x) => x.sub && x.t === '2') && p1.runs.some((x) => x.sup && x.t === '2'));
    assert(r.paras.find((p) => /^Centred/.test(p.runs[0].t)).align === 'c' && r.paras.find((p) => /^Right/.test(p.runs[0].t)).align === 'r');
    assert(r.paras.filter((p) => p.bullet).length === 2, f + ' bullets');
  }
  ok('Word ' + f + ': ' + (f === 'rich.doc' ? 'text, symbols and table rows (formatting not read from .doc)' : 'text, bold/italic/underline/sub/sup, centre/right, bullets, table rows, smart quotes, symbols'));
}
{
  const c = I.convert(fs.readFileSync(path.join(wd, 'rich.rtf')), 'rich.rtf');
  const p = D.paragraphs ? D.parse(c.file) : null; assert(p && p.h.checksumOk);
  const txt = X.plain(X.openDoc(c.file, 'RICH.CWD').paras); assert(txt.includes('Name | Qty | Price') && txt.includes('"smart quotes"') && txt.includes('H2O'));
  ok('Word RTF -> .CWD (craftimport): checksum ok, table rows and ASCII quotes present');
}

// ---- 4. Atari size limits -----------------------------------------------------
{
  let body = ''; for (let i = 1; i <= 220; i++) body += (i === 1 ? '\\b ' : '') + 'The quick brown fox jumps over the lazy dog, paragraph ' + i + ' of a long \\i real-world\\i0  RTF document.' + (i === 1 ? '\\b0 ' : '') + '\\par\r\n';
  const long = Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}' + body + '}', 'latin1');
  const r = I.convert(long, 'long.rtf');
  assert(r.truncated && r.dropped > 0 && r.bytes <= I.ATARI_DOC); const h = D.parse(r.file);
  assert(h.h.checksumOk && h.h.length === r.bytes && r.bytes < 0x2c00, 'ACWriter rejects payloads of 0x2C00 bytes or more');
  const last = r.file[r.file.length - 1]; assert(last === 13, 'ends at a paragraph end');
  const again = X.openDoc(r.file, 'LONG.CWD'); assert(again.paras.length > 100 && /paragraph \d+ of a long real-world RTF document\.$/.test(textOf(again.paras)));
  assert(I.convert(long, 'long.rtf', { max: 0x3fff }).bytes <= 0x3fff);
  const short = I.convert(Buffer.from('{\\rtf1 hi\\par}'), 'a.rtf'); assert(!short.truncated);
  ok('long RTF: cut to ' + r.bytes + ' bytes at a paragraph end (' + r.dropped + ' dropped), flagged truncated, checksum valid, below ACWriter 11264 byte area');
  const x = X.save(X.openDoc(long, 'long.rtf').paras, 'cwd'); assert(x.report.some((m) => /cut at/.test(m)) && x.report.length); ok('xCWriter reports the same cut when saving .CWD');
}
{
  // style left on at the cut is closed
  const bytes = [1]; for (let i = 0; i < 40; i++) bytes.push(...Buffer.from('word '.repeat(10)), 14); bytes.push(13);
  const cut = I.cutAtLine(bytes, 300); assert(cut.length <= 300 && cut[cut.length - 1] === 13 && cut.filter((b) => b === 1).length % 2 === 0); ok('cut inside bold closes the bold toggle');
}
console.log('roundtrip tests passed');
