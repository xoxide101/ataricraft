// Family registry (web/js/fontedit/fontfamily.js via tools/fontfamily.cjs): defaults, flags, merge/split, grouping by file name, views, extensibility,
// and that the ACWriter face build only writes the sizes flagged for acwriter-atari.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const FF = require('../tools/fontfamily.cjs'), A = require('../tools/acwfaces.cjs');
const ok = (m) => console.log('ok  ' + m);
const OUT = path.join(__dirname, '..', 'out', 'ff-test'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const m = FF.craft(), cs = FF.find(m, 'craft-sans');
assert.deepStrictEqual(FF.validate(m), []); assert.deepStrictEqual(Object.keys(cs.styles[0].sizes).map(Number), FF.SIZES);
assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'acwriter-atari'), [4, 5, 6, 8]);
assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'xcwriter'), FF.SIZES); assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'print'), FF.SIZES);
assert.deepStrictEqual(FF.sizesFor(m, 'craft-zoom', 'zoom'), [8]); assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'zoom'), []);
ok('defaults: acwriter-atari 4,5,6,8; xcwriter and print all 13 sizes; zoom face is style-limited');

FF.setFlag(m, cs, 'regular', 5, 'acwriter-atari', false); FF.setFlag(m, cs, 'regular', 26, 'xcwriter', false); FF.setFlag(m, cs, 'regular', 12, 'acwriter-atari', true);
assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'acwriter-atari'), [4, 6, 8, 12]); assert.ok(!FF.sizesFor(m, 'craft-sans', 'xcwriter').includes(26));
FF.setFlag(m, cs, 'regular', 5, 'acwriter-atari', null); assert.ok(FF.sizesFor(m, 'craft-sans', 'acwriter-atari').includes(5));
ok('explicit flags override the default rule; null resets to the default');

m.targets.c64 = { label: 'Commodore 64', sizes: [8] };
assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'c64'), [8]); FF.setFlag(m, cs, 'regular', 8, 'c64', false); assert.deepStrictEqual(FF.sizesFor(m, 'craft-sans', 'c64'), []);
assert.deepStrictEqual(FF.validate(m), []); ok('a new machine is just data in manifest.targets (no code change)');

// round trip + unknown target kept
const back = FF.parse(FF.serialize(m)); assert.deepStrictEqual(back, JSON.parse(JSON.stringify(m)));
FF.setFlag(back, FF.find(back, 'craft-sans'), 'regular', 10, 'future-machine', true); assert.ok(FF.validate(back).some((p) => /unknown target future-machine/.test(p))); ok('manifest JSON round trip; unknown targets are reported but kept');

// files -> one family
const g = FF.newManifest(); const fams = FF.groupFiles(g, ['craft4.acf', 'craft5.acf', 'craft6.acf', 'Fancy-Bold-12.xcf', 'Fancy-Bold-8.fnt', 'Fancy_10px.acf', 'notes.txt']);
assert.deepStrictEqual(g.families.map((f) => f.id).sort(), ['craft', 'fancy']); const fancy = FF.find(g, 'fancy');
assert.deepStrictEqual(fancy.styles.map((s) => s.style).sort(), ['bold', 'regular']); assert.deepStrictEqual(Object.keys(FF.styleOf(fancy, 'bold').sizes), ['8', '12']);
assert.deepStrictEqual(Object.keys(FF.find(g, 'craft').styles[0].sizes), ['4', '5', '6']); assert.strictEqual(FF.find(g, 'craft').styles[0].sizes[5].source, 'craft5.acf');
ok('craft4.acf craft5.acf ... and Fancy-Bold-12.xcf group into one family each, with style, size and per-size source file');

// merge / split
const a = FF.addFamily(g, { name: 'Alpha' }), b = FF.addFamily(g, { name: 'Beta' }); FF.setSize(a, 'regular', 8, { origin: 'hand' }); FF.setSize(b, 'regular', 8, { origin: 'derived' }); FF.setSize(b, 'regular', 10, { origin: 'derived' });
FF.merge(g, ['alpha', 'beta'], 'Alpha'); assert.strictEqual(g.families.filter((f) => f.id === 'beta').length, 0);
assert.strictEqual(FF.styleOf(a, 'regular').sizes[8].origin, 'hand'); assert.ok(FF.styleOf(a, 'regular').sizes[10]); assert.ok(a.aliases.includes('beta'));
const nf = FF.split(g, 'alpha', 'regular', [10], 'Alpha ten'); assert.deepStrictEqual(Object.keys(FF.styleOf(nf).sizes), ['10']); assert.ok(!FF.styleOf(a).sizes[10]); assert.deepStrictEqual(FF.validate(g), []);
ok('merge keeps the first family\'s sizes and remembers aliases; split moves sizes into a new family');

// the old three groups are views
const v = FF.views(m); assert.deepStrictEqual(v['Craft faces'], ['craft-sans', 'craft-zoom']); assert.ok(v['ACWriter / Craft fonts'].includes('craft-sans')); ok('Craft faces / ACWriter / My fonts are views over the registry');

// the ACWriter build honours the flags
const mf = FF.craft(); FF.setFlag(mf, FF.find(mf, 'craft-sans'), 'regular', 5, 'acwriter-atari', false); FF.setFlag(mf, FF.find(mf, 'craft-zoom'), 'zoom', 8, 'acwriter-atari', false);
assert.ok(A.enabled('craft4', null, mf) && !A.enabled('craft5', null, mf) && !A.enabled('zfont', null, mf));
A.emit(OUT, mf); const have = fs.readdirSync(OUT).sort(); assert.deepStrictEqual(have, ['craft4.inc', 'craft6.inc']);
A.emit(OUT, FF.craft()); assert.deepStrictEqual(fs.readdirSync(OUT).sort(), ['craft4.inc', 'craft5.inc', 'craft6.inc', 'zfont.inc']);
ok('ACWriter face build writes only flagged sizes: with craft5 and zfont off -> ' + have.join(', '));
// shipped manifest is valid and agrees with the defaults
assert.deepStrictEqual(FF.validate(FF.load()), []); ok('font/family-manifest.json is valid');
