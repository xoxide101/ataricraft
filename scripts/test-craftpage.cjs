// Tests for tools/craftpage.cjs and the CRFT page trailer. Usage: node scripts/test-craftpage.cjs
const assert = require('assert');
const fs = require('fs'), path = require('path');
const P = require('../tools/craftpage.cjs');
const X = require('../tools/xcwcore.cjs');
const D = require('../tools/craftdoc.cjs');
const I = require('../tools/craftimport.cjs');

// columns and lines
assert.strictEqual(P.paperCols('letter', 10), 85);
assert.strictEqual(P.paperCols('letter', 12), 102);
assert.strictEqual(P.paperCols('letter', 17), 144);
assert.strictEqual(P.paperCols('a4', 10), 82);
assert.strictEqual(P.paperLines('letter'), 66);
assert.strictEqual(P.paperLines('legal'), 84);
const def = P.info({});
assert.strictEqual(def.paper, 'letter'); assert.strictEqual(def.pitch, 10);
assert.strictEqual(def.usable, 80); assert.strictEqual(def.usableInches, 8); assert.strictEqual(def.centre, 42.5); assert.strictEqual(def.textLines, 54);
assert.strictEqual(P.info({ paper: 'a4', pitch: 12 }).usable, 99 - 4 - 2);
// normalization clamps junk
const junk = P.normalize({ paper: 'x', pitch: 11, left: 999, right: 999, tabs: [{ pos: 10, kind: 'q' }, { pos: 10, kind: 'r' }, { pos: 500, kind: 'l' }] });
assert.ok(P.info(junk).usable >= 8 && junk.tabs.length === 1 && junk.tabs[0].kind === 'l');

// trailer round trip
const pg = P.normalize({ paper: 'legal', pitch: 12, left: 6, right: 4, tabs: [{ pos: 30, kind: 'l' }, { pos: 51, kind: 'c' }, { pos: 96, kind: 'r' }], font: 'FONT4' });
assert.deepStrictEqual(P.fromTrailer(P.toTrailer(pg)), pg);
assert.strictEqual(P.fromTrailer(Buffer.from('nope')), null);

// layout wraps at usable columns, not 64
const para = (t) => ({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] });
const long = 'word '.repeat(40).trim();
const maxLine = (bytes) => { let m = 0, c = 0; for (const b of bytes) { if (b === 13 || b === 14) { m = Math.max(m, c); c = 0; } else if (b >= 32) c++; } return m; };
const b64 = I.layout([para(long)], 64), b80 = I.layout([para(long)], P.normalize({}));
assert.ok(maxLine(b64) <= 64 && maxLine(b80) <= 80 && maxLine(b80) > 64, 'page layout wraps at 80');
assert.deepStrictEqual(I.layout([para(long)], 80), b80);
const b = I.layout([para(long)], P.normalize({ pitch: 17 })); assert.ok(maxLine(b) > 100 && maxLine(b) <= P.info({ pitch: 17 }).usable);

// file: old files unchanged, new files carry flag + trailer and old parse ignores nothing
const old = I.build(b64, 64, 5);
assert.strictEqual(old.length, 16 + b64.length); assert.strictEqual(D.parse(old).h.page, null);
const nf = I.build(b80, 80, 5, pg);
const hp = D.parse(nf).h;
assert.strictEqual(hp.flags, 2); assert.strictEqual(hp.cols, P.usableCols(pg)); assert.deepStrictEqual(hp.page, pg); assert.ok(hp.checksumOk);
assert.strictEqual(nf.length, 16 + b80.length + P.toTrailer(pg).length);
// the 6502 reader reads `length` payload bytes: simulate by cutting the trailer
assert.deepStrictEqual(D.paragraphs(D.parse(nf).payload), D.paragraphs(D.parse(nf.subarray(0, 16 + b80.length)).payload));
// a damaged trailer degrades to defaults, never throws
const bad = Buffer.concat([nf.subarray(0, 16 + b80.length), Buffer.from('CPG1\x01\x20')]);
assert.ok(D.parse(bad).h.page.paper === 'letter');
// the demo document (old format) still loads
const demo = path.join(__dirname, '..', 'docs', 'samples', 'ACWRITER-DEMO.CWD');
if (fs.existsSync(demo)) assert.strictEqual(D.parse(fs.readFileSync(demo)).h.page, null);

// tabs: left, centre, right stops expand to spaces on the right columns
const tp = P.normalize({ left: 0, right: 0, tabs: [{ pos: 20, kind: 'l' }, { pos: 40, kind: 'c' }, { pos: 60, kind: 'r' }] });
const [e] = P.expandTabs([para('a\tleft\tmid\tend')], tp);
const s = e.runs.map((r) => r.t).join('');
assert.strictEqual(s.indexOf('left'), 20); assert.strictEqual(s.indexOf('mid'), 40 - 1); assert.strictEqual(s.indexOf('end') + 3, 60);

// xcwcore: page-aware CWD with trailer, openDoc returns the page, page lines are 80 wide
const doc = X.normalize([para(long), para('x\ty')]);
const r = X.toCwd(doc, { page: pg });
const o = X.openDoc(r.file, 'T.CWD');
assert.deepStrictEqual(o.page, pg);
const lines = X.atariLines(doc, X.PROFILES.atari, P.normalize({}));
assert.ok(Math.max(...lines.map((l) => l.cells.length)) > 64 && Math.max(...lines.map((l) => l.cells.length)) <= 80);
assert.strictEqual(X.openDoc(X.toCwd(doc).file, 'T.CWD').page, null);
console.log('craftpage tests passed');
