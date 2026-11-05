// node scripts/test-import-paperclip.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { read } = require('../tools/import-paperclip.cjs');
const dir = path.join(__dirname, '..', 'docs', 'samples', 'import');
const P = read(fs.readFileSync(path.join(dir, 'paperclip-sample.bin')));
assert.strictEqual(P.length, 4);
assert.strictEqual(P[0].align, 'c');
assert.strictEqual(P[0].runs.map((r) => r.t).join(''), 'Title');
const r = P[1].runs;
assert.strictEqual(r.map((x) => x.t).join(''), 'Plainboldunder x2 h2o');
const f = (t) => r.find((x) => x.t === t);
assert.ok(f('bold').b && !f('bold').u);
assert.ok(f('under').u && !f('under').b);
assert.ok(f('Plain').b === 0 && f('Plain').u === 0);
const twos = r.filter((x) => x.t === '2');
assert.ok(twos[0].sup && !twos[0].sub && twos[1].sub && !twos[1].sup);
assert.strictEqual(P[2].align, 'r');
assert.strictEqual(P[2].runs[0].t, 'right side');
assert.strictEqual(P[3].align, 'l');
assert.strictEqual(P[3].runs[0].t, 'Second paragraph here');
const S = read(fs.readFileSync(path.join(dir, 'paperclip-scripts.bin')));
assert.strictEqual(S.length, 1);
assert.deepStrictEqual(S[0].runs.map((x) => [x.t, x.sup, x.sub]), [['ab', 0, 0], ['UP', 1, 0], ['cd', 0, 0], ['DN', 0, 1], ['ef', 0, 0]]);
const M = read(fs.readFileSync(path.join(dir, 'paperclip-margins.bin')));
assert.deepStrictEqual(M.map((x) => x.runs.map((y) => y.t).join('')), ['ab', 'cdef']);
console.log('paperclip import OK');


