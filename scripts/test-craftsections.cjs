// Sections, role styles and sizes in the DOM-free core: precedence, CPG1 tags 4..7 (with tags 2/3 as the resolved faces for old readers),
// section/role ops, docx export -> import, and the mixed-fonts.docx sample mapping to sections.
const assert = require('assert'), fs = require('fs'), path = require('path');
const X = require('../tools/xcwcore.cjs'), P = require('../tools/craftpage.cjs'), D = require('../tools/craftdoc.cjs');
const ok = (m) => console.log('ok  ' + m);
const mk = (t, o) => Object.assign({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }, o || {});
const faces = (paras, page) => P.resolve(paras, page).map((r) => r.face);

// precedence: default < section < style < paragraph
const page = P.normalize({ dfont: 'CRAFT8', styles: { title: { face: 'CRAFT12', size: 12 }, h1: { size: 10 } } });
const paras = [mk('T', { role: 'title' }), mk('H', { role: 'h1' }), mk('b1'), mk('b2', { sec: true, sf: 'ATARIROM' }), mk('h', { role: 'h1' }), mk('o', { font: 'CRAFT10', size: 5 }), mk('s', { font: 'ROM' })];
assert.deepStrictEqual(faces(paras, page), ['CRAFT12', 'CRAFT10', 'CRAFT8', 'ATARIROM', 'ATARIROM', 'CRAFT5', ''], 'resolve');
ok('precedence default < section < style < paragraph, sizes only for Craft faces');

// trailer round trip: tags 4..7 restore the structure, tags 2/3 hold the resolved faces
const cwd = X.toCwd(X.normalize(paras), { page }).file;
const hd = D.parse(cwd).h.page;
assert(hd.fonts && hd.font === 'CRAFT12', 'tag 2/3 carry resolved faces: ' + JSON.stringify([hd.font, hd.fonts]));
const o = X.openDoc(cwd, 'T.xcw');
assert.deepStrictEqual(faces(o.paras, o.page), faces(paras, page), 'faces after reload');
assert.deepStrictEqual(o.paras.map((p) => p.role || ''), ['title', '', '', '', 'h1', '', ''].map((v, i) => paras[i].role || ''));
assert.strictEqual(o.page.dfont || o.page.font, 'CRAFT8'); assert.strictEqual(P.sections(o.paras, o.page).length, 2);
assert.strictEqual(o.paras[5].size, 5); assert.strictEqual(o.page.styles.title.size, 12);
ok('.xcw round trip keeps sections, roles, sizes, style table, default font');

// an old reader (tags 1-3 only) sees the same faces
const lp = P.applyFonts(X.normalize(paras.map((p) => mk(p.runs[0].t))), { font: hd.font, fonts: hd.fonts });
assert.deepStrictEqual(faces(lp, P.normalize({})), faces(paras, page), 'legacy tags 2/3 give the resolved faces');
ok('tags 2/3 alone reproduce the resolved faces');

// ops
const q = X.normalize([mk('a'), mk('b'), mk('c')]);
const pos = X.sectionBreak(q, { p: 1, o: 0 }, 'CRAFT10'); assert.strictEqual(pos.p, 1); assert.strictEqual(P.sections(q, P.normalize({})).length, 2);
X.setSectionFontRange(q, 1, 2, 'CRAFT12'); assert.deepStrictEqual(faces(q, P.normalize({})), ['', 'CRAFT12', 'CRAFT12']);
X.setRole(q, 0, 0, 'h1', { h1: { b: 1, align: 'c' } }); assert.strictEqual(q[0].role, 'h1'); assert.strictEqual(q[0].align, 'c'); assert(q[0].runs[0].b);
X.setParaSize(q, 1, 1, 6); assert.deepStrictEqual(faces(q, P.normalize({})), ['', 'CRAFT6', 'CRAFT12']);
X.removeSectionBreak(q, 1); assert.strictEqual(P.sections(q, P.normalize({})).length, 1);
ok('section break / section font / role / size / remove ops');

// docx export -> import keeps faces, roles and sections
const d = X.save(X.normalize(paras), 'docx', { page }), od = X.openDoc(d.bytes, 'T.docx');
assert.deepStrictEqual(faces(od.paras, od.page || P.normalize({})), faces(paras, page), 'docx faces');
assert.deepStrictEqual(od.paras.map((p) => p.role || ''), paras.map((p) => p.role || ''));
assert.strictEqual(P.sections(od.paras, od.page || P.normalize({})).length, 2);
ok('docx round trip: styles (Title/Heading), section-level fonts and sizes');

// Word sample with four fonts becomes sections
const mf = path.join(__dirname, '..', 'docs', 'samples', 'word', 'mixed-fonts.docx');
const im = X.openDoc(new Uint8Array(fs.readFileSync(mf)), 'mixed-fonts.docx');
const ms = P.sections(im.paras, im.page || P.normalize({}));
assert.strictEqual(ms.length, 4, 'mixed-fonts.docx sections: ' + ms.length);
ok('mixed-fonts.docx maps to ' + ms.length + ' sections: ' + faces(im.paras, im.page).join(' '));
console.log('test-craftsections: all passed');
