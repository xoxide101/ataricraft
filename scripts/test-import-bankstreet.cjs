// Checks the Bank Street Writer importer against a document saved by the real program.
const fs = require('fs'), assert = require('assert'), path = require('path');
const { read } = require('../tools/import-bankstreet.cjs');
const p = read(fs.readFileSync(path.join(__dirname, '../docs/samples/import/bankstreet-sample.bin')));
assert.deepStrictEqual(p.map((x) => x.align), ['c', 'l', 'l', 'l']);
assert.deepStrictEqual(p.map((x) => x.runs[0].t), ['Centered', 'Tabbed', 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AND KEEPS RUNNING ON AND ON FOR A LONG TIME.', 'last']);
console.log('ok');
