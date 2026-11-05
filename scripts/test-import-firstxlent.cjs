const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { read } = require('../tools/import-firstxlent.cjs');

const dir = path.join(__dirname, '..', 'docs', 'samples', 'import');
const buf = fs.readFileSync(path.join(dir, 'firstxlent-sample.bin'));
const txt = (p) => p.runs.map((r) => r.t).join('');

let ps = read(buf);
assert.deepStrictEqual(ps.map((p) => p.align), ['c', 'l', 'r', 'j', 'j', 'j', 'j', 'j']);
assert.strictEqual(ps.length, 8);
assert.strictEqual(txt(ps[0]), 'Centered Title');
assert.strictEqual(txt(ps[1]), 'Plain line');
assert.strictEqual(txt(ps[2]), 'Right line');
assert.ok(txt(ps[3]).startsWith('the quick brown fox') && txt(ps[3]).endsWith('farmer today'));
assert.strictEqual(txt(ps[4]), 'Somebold andunder text.');
assert.strictEqual(txt(ps[5]), 'Softhyphen and nbsp');
assert.strictEqual(txt(ps[6]), '');
assert.strictEqual(txt(ps[7]), 'Last');
assert.ok(ps.every((p) => p.runs.every((r) => !r.b && !r.u)));

ps = read(buf, { printerCodes: true });
const rs = ps[4].runs;
assert.deepStrictEqual(rs.map((r) => [r.t, r.b, r.u]), [['Some', 0, 0], ['bold', 1, 0], [' and', 0, 0], ['under', 0, 1], [' text.', 0, 0]]);

assert.strictEqual(txt(read(fs.readFileSync(path.join(dir, 'firstxlent-hello.bin')))[0]), 'Hello World');
console.log('firstxlent import OK');
