// Round-trip checks for tools/craftimport.cjs and tools/craftexport.cjs (no Atari or browser needed).
const assert = require('assert');
const { convert } = require('../tools/craftimport.cjs');
const { exportDoc } = require('../tools/craftexport.cjs');
const { parse } = require('../tools/craftdoc.cjs');
const show = (f) => [...parse(f).payload].map((c) => (c < 32 ? '<' + c + '>' : String.fromCharCode(c))).join('');

// AtariWriter text: centre, right, inverse = underline, a format line and a header line are dropped.
const aw = Buffer.from([0x0c, 0x31, 0x30, 0x9b, 0x08, 0x48, 0x44, 0x52, 0x9b, 0x03, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x9b, 0x03, 0x03, 0x52, 0x74, 0x9b, 0x61, 0xe2, 0xe3, 0x64, 0x9b]);
const r = convert(aw, 'X', { format: 'atascii' });
assert.strictEqual(show(r.file), '<15>Title<13><16>Rt<13>a<3>bc<3>d<13>');

const md = Buffer.from('# Head\n\nHi **bold** and *it*\n- item\n');
const m = convert(md, 'a.md').file; const base = show(m);
assert.strictEqual(base, '<1>Head<1><13><13>Hi <1>bold<1> and <2>it<2><13><19>item<13>');
for (const f of ['rtf', 'html', 'md']) {
  const back = show(convert(exportDoc(m, f), 'x.' + f).file).replace(/<13>(<13>)+/g, '<13>');
  assert.strictEqual(back.replace(/<13>/g, ''), base.replace(/<13>/g, ''), f);
}
const txt = exportDoc(m, 'text').toString('latin1');
assert(/^Head\r\n/.test(txt));
console.log('ok');
