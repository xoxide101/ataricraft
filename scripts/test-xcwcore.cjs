// Tests for tools/xcwcore.cjs (the xCWriter core) and tools/inflate.cjs. Usage: node scripts/test-xcwcore.cjs
const assert = require('assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const X = require('../tools/xcwcore.cjs');
const { inflateRaw } = require('../tools/inflate.cjs');
const root = path.join(__dirname, '..');

// inflate matches zlib (stored, fixed and dynamic blocks)
for (const data of [Buffer.alloc(0), Buffer.from('hello hello hello hello'), fs.readFileSync(path.join(root, 'docs', 'IMPORT.md')), require('crypto').randomBytes(5000)]) {
  for (const lvl of [0, 1, 9]) assert.deepStrictEqual(Buffer.from(inflateRaw(zlib.deflateRawSync(data, { level: lvl }))), data);
}

const st = (t, o = {}) => ({ t, b: 0, i: 0, u: 0, sup: 0, sub: 0, ...o });
const sample = () => X.normalize([
  { align: 'c', bullet: false, runs: [st('Title', { b: 1 })] },
  { align: 'l', bullet: false, runs: [st('Plain '), st('bold', { b: 1 }), st(' '), st('it', { i: 1 }), st(' '), st('und', { u: 1 }), st(' x'), st('2', { sup: 1 }), st(' H'), st('2', { sub: 1 }), st('O')] },
  { align: 'l', bullet: true, runs: [st('an item')] },
  { align: 'r', bullet: false, runs: [st('right')] },
  { align: 'j', bullet: false, runs: [st('justified text that is long enough to wrap onto a second line when laid out at sixty four columns wide.')] },
]);
const sig = (ps) => JSON.stringify(X.normalize(ps).map((p) => [p.align, p.bullet, p.runs.map((r) => [r.t, r.b, r.i, r.u, r.sup, r.sub])]));
const rejoin = (ps) => X.normalize(ps).map((p) => ({ ...p, runs: p.runs })); // runs already merged

// CWD: model -> file -> model -> file is byte-identical, styles preserved
const doc = sample();
const cwd = X.save(doc, 'cwd').bytes;
const back = X.openDoc(cwd, 'a.cwd');
assert.strictEqual(back.format, 'craft');
assert.deepStrictEqual(X.save(back.paras, 'cwd').bytes, cwd);
assert.strictEqual(X.parseCwd(cwd).h.checksumOk, true);
assert.strictEqual(X.plain(back.paras).replace(/\n/g, '|'), X.plain(doc).replace(/\n/g, '|').replace(/justified text that is long enough to wrap onto a second line when laid out at sixty four columns wide\./, (m) => m));
assert.strictEqual(back.paras[0].align, 'c'); assert.strictEqual(back.paras[2].bullet, true); assert.strictEqual(back.paras[4].align, 'j');
assert(back.paras[1].runs.some((r) => r.t === 'bold' && r.b));
assert(back.paras[1].runs.some((r) => r.t === '2' && r.sup)); assert(back.paras[1].runs.some((r) => r.t === '2' && r.sub));
// existing demo document opens and survives
const demo = fs.readFileSync(path.join(root, 'docs', 'samples', 'ACWRITER-DEMO.CWD'));
const d2 = X.openDoc(demo, 'ACWRITER-DEMO.CWD');
assert(d2.paras.length > 3);
assert.deepStrictEqual(X.save(d2.paras, 'cwd').bytes, X.save(X.openDoc(X.save(d2.paras, 'cwd').bytes).paras, 'cwd').bytes);

// rich formats keep the model
for (const f of ['rtf', 'html', 'docx']) {
  const out = X.save(doc, f).bytes, again = X.openDoc(out, 'x.' + f, { unicode: true });
  assert.strictEqual(again.format, f);
  assert.strictEqual(sig(again.paras), sig(doc), f);
}
// Markdown keeps bold/italic/bullets (not underline/sup/sub/align)
const md = X.openDoc(X.save(doc, 'md').bytes, 'x.md').paras;
assert(md.some((p) => p.runs.some((r) => r.t === 'bold' && r.b)) && md.some((p) => p.bullet));
// text and ATASCII: words survive, report says what was dropped
const atx = X.save(doc, 'atascii');
assert(atx.bytes.includes(0x9b)); assert(atx.report.some((r) => /bold dropped for ATASCII/.test(r)), atx.report.join('; '));
assert(X.openDoc(atx.bytes, 'x.atx', { format: 'atascii' }).paras.some((p) => X.ptext(p).includes('Plain bold')));
assert(X.save(doc, 'text').report.some((r) => /underline dropped for plain text/.test(r)));
assert.strictEqual(X.save(doc, 'rtf').report.length, 0);

// the docx is a well formed zip with the standard parts
const dx = X.save(doc, 'docx').bytes;
assert.strictEqual(dx.readUInt32LE(0), 0x04034b50);
for (const n of ['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml']) assert(dx.includes(Buffer.from(n)), n);
assert.deepStrictEqual(require('child_process').spawnSync('node', ['-e', '1']).status, 0);

// Unicode survives in rich formats, becomes Atari text in a CWD, and is reported
const uni = X.normalize([{ align: 'l', bullet: false, runs: [st('\u201cQuote\u201d \u2014 caf\u00e9 \u4e2d')] }]);
assert.strictEqual(X.ptext(X.openDoc(X.save(uni, 'html').bytes, 'x.html').paras[0]), '\u201cQuote\u201d \u2014 caf\u00e9 \u4e2d');
assert.strictEqual(X.ptext(X.openDoc(X.save(uni, 'docx').bytes, 'x.docx').paras[0]), '\u201cQuote\u201d \u2014 caf\u00e9 \u4e2d');
const wu = X.atariWarnings(uni); assert(wu.length >= 2, wu.join('|'));
assert.strictEqual(X.ptext(X.openDoc(X.save(uni, 'cwd').bytes, 'x.cwd').paras[0]), '"Quote" - caf\u00e9 ?');

// Atari lines: same wrap as craftimport (every line <= 64 columns, bullets 62), offsets map back to the text
const lines = X.atariLines(doc);
assert(lines.every((l) => l.cells.length <= (l.bullet ? 62 : 64)));
assert.strictEqual(lines.filter((l) => l.p === 4).length, 2);
assert.strictEqual(lines.map((l) => l.cells.map((c) => c.ch).join('')).slice(0, 2).join('|'), 'Title|Plain bold it und x2 H2O');
const rebuilt = {}; for (const l of lines) for (const c of l.cells) rebuilt[c.p] = (rebuilt[c.p] || '') + c.ch;
doc.forEach((p, i) => assert.strictEqual(rebuilt[i], X.ptext(p)));
const f = X.fit(doc); assert(f.bytes > 100 && f.limit === 7680 && f.over === 0);
const big = X.normalize([{ align: 'l', bullet: false, runs: [st('word '.repeat(4000))] }]);
assert(X.fit(big).over > 0);
const bc = X.save(big, 'cwd'); assert(bc.report[0].includes('cut at') && X.parseCwd(bc.bytes).h.length <= 7680);

// editing
const ed = X.newDoc();
let pos = X.insertText(ed, { p: 0, o: 0 }, 'Hello world\nSecond');
assert.deepStrictEqual(pos, { p: 1, o: 6 }); assert.strictEqual(X.plain(ed), 'Hello world\nSecond');
X.styleRange(ed, { p: 0, o: 0 }, { p: 0, o: 5 }, 'b', 1);
assert(X.hasStyle(ed, { p: 0, o: 0 }, { p: 0, o: 5 }, 'b') && !X.hasStyle(ed, { p: 0, o: 0 }, { p: 0, o: 8 }, 'b'));
const frag = X.getFragment(ed, { p: 0, o: 3 }, { p: 1, o: 2 });
X.deleteRange(ed, { p: 0, o: 3 }, { p: 1, o: 2 });
assert.strictEqual(X.plain(ed), 'Helcond');
X.insertFragment(ed, { p: 0, o: 3 }, frag); assert.strictEqual(X.plain(ed), 'Hello world\nSecond');
assert(ed[0].runs[0].b && ed[0].runs[0].t === 'Hello');

// spelling
const dict = X.dictParse(fs.readFileSync(path.join(root, 'docs', 'samples', 'EN.CDC')));
const sp = X.spellCheck(dict, X.normalize([{ align: 'l', bullet: false, runs: [st('The quick brwon fox jumpd. Caf\u00e9 is fine.')] }]));
assert(sp.some((s) => s.word === 'brwon') && sp.some((s) => s.word === 'jumpd') && !sp.some((s) => s.word === 'The' || /Caf/.test(s.word)), JSON.stringify(sp));
assert(X.suggest(dict, 'brwon').includes('brown'), X.suggest(dict, 'brwon').join());
assert(X.suggest(dict, 'Teh')[0] === 'The' || X.suggest(dict, 'Teh').includes('The'));
console.log('ok');
