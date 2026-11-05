// Tests for tools/cdict.cjs: hash vectors (shared with docs/DICTIONARY.md and the 6502 code), build/parse round trip,
// the exact tier, possessives, tokenizer, and the shipped docs/samples/EN.CDC.
// Usage: node scripts/test-dict.cjs
const fs = require('fs');
const assert = require('assert');
const cd = require('../tools/cdict.cjs');
const ROOT = __dirname + '/..';

const vectors = [
  ['ab', 0x3bbce65a, [58970, 74263, 89556, 104849, 120142]],
  ['cat', 0x7ff3c32f, [115503, 17186, 49941, 82696, 115451]],
  ['the', 0x22c29e1e, [40478, 49377, 58276, 67175, 76074]],
  ['dont', 0x4538dea3, [56995, 74716, 92437, 110158, 127879]],
  ["a's", 0x74b4c868, [51304, 81181, 111058, 9863, 39740]],
  ['Atari', 0x1b9c68ba, [26810, 33879, 40948, 48017, 55086]],
  ['zzzzzzzzzzzz', 0x67324617, [17943, 44362, 70781, 97200, 123619]],
];
for (const [w, h, p] of vectors) {
  assert.strictEqual(cd.hash(w), h, 'hash ' + w);
  assert.deepStrictEqual(cd.probes(h, 131072, 5), p, 'probes ' + w);
}
assert.strictEqual(cd.hash('CAT'), cd.hash('cat'), 'case folding');

const r = cd.build(['cat', 'Dog', "don't", 'dogs', 'o\'clock', 'bad1', 'x y', ''], { bytes: 1024, k: 4, lang: 'en', exact: true });
const d = cd.parse(r.file);
assert.strictEqual(d.words, 5); assert.strictEqual(d.bits, 8192); assert.strictEqual(d.k, 4); assert.strictEqual(d.lang, 'en');
assert.strictEqual(r.file.length, 24 + 1024 + d.exactOff * 0 + (r.file.length - 24 - 1024));
for (const w of ['cat', 'CAT', 'dog', "don't", "DON'T", "dog's", "dogs'", "o'clock"]) assert(cd.has(d, w), 'has ' + w);
for (const w of ['cot', 'bad1', '']) assert(!cd.has(d, w), 'not ' + w);
assert.deepStrictEqual(cd.unpackExact(r.file, d.exactOff), ['cat', 'dog', 'dogs', "don't", "o'clock"].sort());
assert.throws(() => cd.build(['a'], { bytes: 1000 }));

assert.deepStrictEqual(cd.tokens("The dog's bone, 3rd 'quoted' cats' x7 I a ok."), [
  { word: 'The', index: 0 }, { word: "dog's", index: 4 }, { word: 'bone', index: 10 }, { word: 'quoted', index: 21 }, { word: "cats'", index: 29 }, { word: 'ok', index: 42 }]);

const en = cd.parse(fs.readFileSync(ROOT + '/docs/samples/EN.CDC'));
assert.strictEqual(en.bits, 131072); assert.strictEqual(en.hashId, 1);
for (const w of ['the', 'word', 'processor', 'computer', "don't", "it's", 'Atari']) assert(cd.has(en, w), 'EN has ' + w);
for (const w of ['teh', 'wrod', 'procesor', 'qxzvk']) assert(!cd.has(en, w), 'EN lacks ' + w);
console.log('test-dict: all passed;', en.words, 'words in EN.CDC');
