const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { read } = require('../tools/import-letterperfect.cjs');
const dir = path.join(__dirname, '..', 'docs', 'samples', 'import');
const flat = (p) => p.runs.map((r) => r.t).join('');

let d = read(fs.readFileSync(path.join(dir, 'letterperfect-sample.bin')));
assert.strictEqual(d.length, 3);
assert.strictEqual(d[0].align, 'c');
assert.strictEqual(flat(d[0]), 'Title');
assert.deepStrictEqual(d[1].runs.map((r) => [r.t, r.sup, r.sub]), [['Sup', 0, 0], ['up', 1, 0], [' Sub', 0, 0], ['dn', 0, 1], [' end', 0, 0]]);
assert.strictEqual(d[1].align, 'l');
assert.strictEqual(flat(d[2]), 'Long line here');
assert.strictEqual(d[2].align, 'j'); // j1 format line precedes it

d = read(fs.readFileSync(path.join(dir, 'letterperfect-sample2.bin')));
assert.strictEqual(d.length, 3);
assert.deepStrictEqual(d[0].runs.map((r) => [r.t, r.b, r.u]), [['Plain', 0, 0], ['Bold', 1, 0], [' and', 0, 0], ['Under', 0, 1], ['Both', 1, 1]]);
assert.ok(flat(d[1]).startsWith('This is a long line') && flat(d[1]).endsWith('how it is stored.'));
assert.strictEqual(flat(d[2]), 'After page');
assert.strictEqual(d[2].pageBreakBefore, true);
assert.deepStrictEqual(d.header, ['Head']);
assert.deepStrictEqual(d.footer, ['Foot']);

d = read(fs.readFileSync(path.join(dir, 'letterperfect-letter.bin')));
assert.ok(d.length > 20);
assert.strictEqual(d[0].align, 'l'); // j0
assert.ok(d.some((p) => p.runs.some((r) => r.u === 1 && r.t === ' UNDERSTANDING')));
assert.ok(flat(d[d.length - 1]) === 'RCB:KLB');
assert.ok(!d.some((p) => /your $/.test(flat(p)) && flat(p) === 'your '));

const atr = read(fs.readFileSync(path.join(__dirname, '..', 'software_n_roms', 'LetterPerfect.ATR')));
assert.ok(atr.length > 20);
console.log('letterperfect import OK');
