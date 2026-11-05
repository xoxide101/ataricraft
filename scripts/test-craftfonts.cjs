// One font per line block: CPG1 tag 3 records, paragraph fonts through .CWD, RTF mixed-font warning.
const assert = require('assert');
const X = require('../tools/xcwcore.cjs');
const P = require('../tools/craftpage.cjs');
const D = require('../tools/craftdoc.cjs');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

const t = P.toTrailer({ paper: 'letter', pitch: 10, font: 'craft6', fonts: [{ p: 3, font: 'craft12' }, { p: 1, font: 'ROM' }, { p: 1, font: 'dup' }] });
const back = P.fromTrailer(t);
assert.strictEqual(back.font, 'craft6'); assert.deepStrictEqual(back.fonts.map((r) => r.p), [1, 3]); ok('tag 2 and tag 3 records round-trip, sorted, unique per paragraph');
assert(P.fromTrailer(P.toTrailer({})).fonts.length === 0); ok('a trailer without tag 3 has no font changes (old files load)');

const mk = (txt, font) => { const p = { align: 'l', bullet: false, runs: [{ t: txt, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }; if (font) p.font = font; return p; };
const paras = [mk('one'), mk('two', 'craft12'), mk('three', 'craft12'), mk('four'), mk('five', 'ROM')];
const page = P.normalize({ paper: 'letter', pitch: 10, font: '' });
const f = X.toCwd(paras, { page }).file;
const hd = D.parse(f).h.page;
assert.deepStrictEqual(hd.fonts, [{ p: 1, font: 'craft12' }, { p: 3, font: 'ROM' }]); ok('toCwd stores only font changes at paragraph starts');
const o = X.openDoc(f, 'X.CWD');
assert.deepStrictEqual(o.paras.map((p) => p.font || ''), ['', 'craft12', 'craft12', '', '']); ok('openDoc restores one font per paragraph');

const sp = X.insertText(o.paras, { p: 1, o: 2 }, '\nsplit', undefined);
assert.strictEqual(o.paras[1].font, 'craft12'); assert.strictEqual(o.paras[2].font, 'craft12'); ok('splitting a paragraph keeps its font on both halves (no mid-line change)');

const rtf = '{\\rtf1{\\fonttbl{\\f0 Times New Roman;}{\\f1 Arial;}}\\f0 Hello \\f1 big world and more text here\\par \\f0 plain line\\par}';
const o2 = X.openDoc(Buffer.from(rtf), 'm.rtf');
assert(o2.notes.some((s) => /mix fonts/.test(s))); assert.strictEqual(o2.paras.length, 2); ok('RTF with two fonts on one line warns and keeps one line: ' + o2.notes.find((s) => /mix/.test(s)));
const I = require('../tools/craftimport.cjs');
assert.strictEqual(I.fromRtf(Buffer.from(rtf))[0].srcFont, 'Arial'); ok('dominant source font chosen (Arial by characters)');
console.log('test-craftfonts: all passed (' + n + ')');
