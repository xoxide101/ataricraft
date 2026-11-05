// node scripts/test-import-textwizard.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { read } = require('../tools/import-textwizard.cjs');
const dir = path.join(__dirname, '..', 'docs', 'samples', 'import');
const P = read(fs.readFileSync(path.join(dir, 'textwizard-sample.bin')));
const txt = (p) => p.runs.map((r) => r.t).join('');
assert.deepStrictEqual(P.map(txt), ['Centred title', 'plainunderafter', 'upmiddown', 'margins set', 'Right block', '', 'Long line of words that should wrap around the edge of the screen for sure ok', 'Last']);
assert.strictEqual(P[0].align, 'c');
assert.strictEqual(P[4].align, 'r');
assert.strictEqual(P[1].runs.length, 3);
assert.deepStrictEqual(P[1].runs.map((r) => r.u), [0, 1, 0]);
assert.deepStrictEqual(P[2].runs.map((r) => [r.sup, r.sub]), [[1, 0], [0, 0], [0, 1]]);
assert.ok(P.every((p) => p.bullet === false && p.runs.every((r) => r.b === 0 && r.i === 0)));
console.log('textwizard import OK');
