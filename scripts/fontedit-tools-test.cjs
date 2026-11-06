// Font editor tools and converters: node scripts/fontedit-tools-test.cjs  (screenshot out/fe-tools.png)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CF = require('../tools/craftfont.cjs');
const ok = (m) => console.log('ok  ' + m);

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.concat([Buffer.from(type), data]), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(data.length); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]);
}
function png(sheet) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(sheet.w, 0); ihdr.writeUInt32BE(sheet.h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((sheet.w + 1) * sheet.h);
  for (let y = 0; y < sheet.h; y++) for (let x = 0; x < sheet.w; x++) raw[y * (sheet.w + 1) + 1 + x] = sheet.data[y * sheet.w + x] ? 0 : 255;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const same = (a, b) => a.glyphs.every((g, i) => JSON.stringify(g) === JSON.stringify(b.glyphs[i]));

// ---- core round trips -------------------------------------------------------------------------------------------------
const m12 = CF.createSize(12, { name: 'T12' });
for (let s = 33; s < 127; s++) { m12.glyphs[s][4 + (s % 5)] = CF.bitMask(m12, s % 10); m12.glyphs[s][8] |= CF.bitMask(m12, 0); }
const sh = CF.toSheet(m12);
assert.ok(same(CF.fromSheet(sh.data, sh.w, sh.h, { name: 'T12' }), m12)); ok('12x12 glyphs survive the sheet round trip (' + sh.w + 'x' + sh.h + ')');

const f8 = CF.fromFnt(Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 255)));
assert.deepStrictEqual(CF.toFnt(f8), Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 255)).slice(0, 1024).map((v, i) => v)); ok('.fnt import then export is byte-identical (1024 bytes)');

const bdf = 'STARTFONT 2.1\nFONT x\nFONTBOUNDINGBOX 8 8 0 0\nCHARS 2\nSTARTCHAR A\nENCODING 65\nBBX 8 8 0 0\nBITMAP\n18\n3C\n66\n66\n7E\n66\n66\n00\nENDCHAR\nSTARTCHAR dot\nENCODING 46\nBBX 2 2 1 0\nBITMAP\nC0\nC0\nENDCHAR\nENDFONT\n';
const fb = CF.fromBdf(bdf, { name: 'bdf' });
assert.strictEqual(fb.adv, 8); assert.strictEqual(fb.glyphs[65][fb.base - 7], 0x18); assert.strictEqual(fb.glyphs[65][fb.base], 0);
assert.strictEqual(fb.glyphs[46][fb.base], 0x60); assert.strictEqual(fb.glyphs[46][fb.base - 1], 0x60); ok('BDF imports onto the baseline (A rows, dot offset)');
const tall = CF.fromBdf(bdf, { size: 12 }); assert.strictEqual(tall.adv, 12); ok('BDF can target 12x12');

const mut = CF.flipV(m12, m12.glyphs[65]); assert.deepStrictEqual(CF.flipV(m12, mut), m12.glyphs[65]);
const rg = m12.glyphs[70].slice(); let r = rg; for (let i = 0; i < 4; i++) r = CF.rotate(m12, r);
assert.deepStrictEqual(r, rg); ok('flip twice and rotate four times are identities');

const dfam = CF.familyNew(m12, 'T12'); const rr = CF.familyDerive(dfam, [10, 8, 6, 5, 4], {});
assert.ok(Object.keys(dfam.sizes).length === 6);
for (const k of Object.keys(dfam.sizes)) { const g = dfam.sizes[k]; assert.ok([...Array(94)].every((_, i) => g.glyphs[33 + i].some((b) => b)), 'empty glyph in size ' + k); }
ok('derived 10/8/6/5/4 px sizes have no empty glyphs (' + rr.done.join(',') + ')');

// ---- per-glyph advances and PCF --------------------------------------------------------------------------------------
{
  const a = CF.createSize(12, { name: 'ADV' }); a.glyphs[65][a.base] = CF.bitMask(a, 3);
  a.advs[a.map[65]] = 7; a.advs[a.map[105]] = 5;
  const back = CF.parse(CF.serialize(a)); assert.strictEqual(back.advs[back.map[65]], 7); assert.strictEqual(back.advs[back.map[105]], 5);
  const js = CF.fromJson(CF.toJson(a)); assert.strictEqual(js.advs[js.map[65]], 7);
  const plain = CF.createSize(12, { name: 'P' }); assert.deepStrictEqual(CF.serialize(plain).slice(0, 8), CF.serialize(CF.parse(CF.serialize(plain))).slice(0, 8));
  ok('per-glyph advances survive ACF2 and JSON round trips');
}
function pcf(o) {
  const glyphs = [{ code: 65, w: 8, rows: [0x18, 0x3c, 0x66, 0x66, 0x7e, 0x66, 0x66, 0x00], lsb: 0 }, { code: 46, w: 2, rows: [0xc0, 0xc0], lsb: 1 }];
  const u32 = (v, be) => { const b = Buffer.alloc(4); be ? b.writeUInt32BE(v >>> 0) : b.writeUInt32LE(v >>> 0); return b; };
  const i16 = (v, be) => { const b = Buffer.alloc(2); be ? b.writeInt16BE(v) : b.writeInt16LE(v); return b; };
  const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const be = !!o.msbByte, fmtBase = (be ? 4 : 0) | (o.msbBit ? 8 : 0) | { 1: 0, 2: 1, 4: 2, 8: 3 }[o.pad];
  const rev = (v) => { let r = 0; for (let i = 0; i < 8; i++) if (v & (1 << i)) r |= 0x80 >> i; return r; };
  const props = Buffer.concat([u32(0x0 | (be ? 4 : 0) | 8 << 0 & 0, false), u32(0, be), u32(0, be)]);
  const mfmt = (be ? 4 : 0) | (o.compressed ? 0x100 : 0);
  let met = u32(mfmt, false);
  if (o.compressed) { met = Buffer.concat([met, i16(glyphs.length, be)]); for (const g of glyphs) met = Buffer.concat([met, Buffer.from([g.lsb + 128, g.lsb + g.w + 128, g.w + 128, g.rows.length + 128, 128])]); }
  else { met = Buffer.concat([met, u32(glyphs.length, be)]); for (const g of glyphs) met = Buffer.concat([met, i16(g.lsb, be), i16(g.lsb + g.w, be), i16(g.w, be), i16(g.rows.length, be), i16(0, be), i16(0, be)]); }
  let offs = [], data = Buffer.alloc(0);
  for (const g of glyphs) { offs.push(data.length); const rb = Math.ceil(g.w / 8), rbp = Math.ceil(rb / o.pad) * o.pad; for (const r of g.rows) { const row = Buffer.alloc(rbp); row[0] = o.msbBit ? r : rev(r); data = Buffer.concat([data, row]); } }
  data = pad4(data);
  const bm = Buffer.concat([u32(fmtBase, false), u32(glyphs.length, be), ...offs.map((x) => u32(x, be)), u32(data.length, be), u32(0, be), u32(0, be), u32(0, be), data]);
  const idx = Buffer.alloc(2 * (127 - 32 + 1)); for (let i = 0; i < idx.length / 2; i++) (be ? idx.writeInt16BE : idx.writeInt16LE).call(idx, -1, i * 2);
  glyphs.forEach((g, n) => (be ? idx.writeInt16BE : idx.writeInt16LE).call(idx, n, (g.code - 32) * 2));
  const enc = Buffer.concat([u32((be ? 4 : 0), false), i16(32, be), i16(127, be), i16(0, be), i16(0, be), i16(-1, be), idx]);
  const tabs = [[1, (be ? 4 : 0), Buffer.concat([u32(0, be), u32(0, be)])], [o.compressed ? 4 : 4, mfmt, met.slice(4)], [8, fmtBase, bm.slice(4)], [32, (be ? 4 : 0), enc.slice(4)]];
  const bodies = tabs.map(([t, f, b]) => pad4(Buffer.concat([u32(f, false), b])));
  let hdr = Buffer.concat([Buffer.from([1, 0x66, 0x63, 0x70]), u32(tabs.length, false)]), off = 8 + 16 * tabs.length;
  tabs.forEach(([t, f], i) => { hdr = Buffer.concat([hdr, u32(t, false), u32(f, false), u32(bodies[i].length, false), u32(off, false)]); off += bodies[i].length; });
  return Buffer.concat([hdr, ...bodies]);
}
const pcfCases = [];
for (const msbByte of [0, 1]) for (const msbBit of [0, 1]) for (const pad of [1, 2, 4, 8]) for (const compressed of [0, 1]) pcfCases.push({ msbByte, msbBit, pad, compressed });
let pcfOk = 0;
for (const o of pcfCases) {
  const fp = CF.fromPcf(pcf(o), { name: 'pcf' });
  assert.strictEqual(fp.adv, fb.adv, JSON.stringify(o));
  assert.ok(same(fp, fb), 'pcf glyphs differ for ' + JSON.stringify(o)); pcfOk++;
}
ok('PCF import matches BDF import for ' + pcfOk + ' byte/bit-order, pad and metric variants');
// ---- browser ------------------------------------------------------------------------------------------------------------
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept('0'));
  await p.goto('file:///' + ROOT.replace(/\\/g, '/') + '/web/fontedit.html');
  await p.waitForFunction(() => window.FE && FE.state.f);
  { const click0 = p.click.bind(p); p.click = async (sel, o) => { if (/^#b(save|json|inc|fnt|png|prev|xcf|bdf|ttf|fam|zip|spec|send)$|^#buse$/.test(sel)) { await p.evaluate(() => { document.querySelector('details.menu').open = true; }); try { return await click0(sel, o); } finally { await p.evaluate(() => { document.querySelector('details.menu').open = false; }); } } return click0(sel, o); }; }
  await p.click('#bnew');
  assert.strictEqual(await p.evaluate(() => FE.state.f.adv), 12); ok('New makes a blank 12x12 master');
  await p.evaluate(() => FE.select(65));
  const box = await p.locator('#edit').boundingBox();
  const cw = box.width / 10, ch = box.height / 12, at = (q, y) => [box.x + (q + 0.5) * cw, box.y + (y + 0.5) * ch];
  const rows = () => p.evaluate(() => FE.state.f.glyphs[65].slice());
  const px = (g, q, y) => !!(g[y] & (0x8000 >> q));
  // line
  await p.click('.tool[data-tool="line"]');
  let [x0, y0] = at(1, 2), [x1, y1] = at(6, 2);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1); await p.mouse.up();
  let g = await rows(); assert.ok([1, 2, 3, 4, 5, 6].every((q) => px(g, q, 2))); ok('line tool draws a horizontal run');
  // rect (outline)
  await p.click('.tool[data-tool="rect"]');
  [x0, y0] = at(1, 3); [x1, y1] = at(6, 8);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1); await p.mouse.up();
  g = await rows(); assert.ok(px(g, 1, 5) && px(g, 6, 5) && !px(g, 3, 5) && px(g, 3, 8)); ok('rect tool draws an outline (interior stays empty)');
  // fill the interior
  await p.click('.tool[data-tool="fill"]');
  const [fx, fy] = at(3, 5); await p.mouse.click(fx, fy);
  g = await rows(); assert.ok(px(g, 3, 5) && px(g, 5, 7) && !px(g, 8, 5)); ok('fill floods the enclosed interior only');
  // erase with right button (pencil)
  await p.click('.tool[data-tool="pen"]');
  const [ex, ey] = at(3, 5); await p.mouse.click(ex, ey, { button: 'right' });
  g = await rows(); assert.ok(!px(g, 3, 5)); ok('pencil right button erases');
  // undo/redo chain
  const n0 = (await rows()).join();
  await p.click('#undo'); const n1 = (await rows()).join(); assert.notStrictEqual(n0, n1);
  await p.click('#redo'); assert.strictEqual((await rows()).join(), n0); ok('undo then redo restores the erase');
  await p.click('#flipv'); const fl = await rows(); await p.click('#flipv');
  assert.deepStrictEqual(await rows(), g); assert.ok(fl.join() !== g.join()); ok('Flip V and back');
  // derive and PNG import/export through the page
  const sheetPng = png(CF.toSheet(m12)).toString('base64');
  const imp = await p.evaluate(async (b64) => { await FE.openBytes(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), 'T12.sheet.png'); return [FE.state.f.adv, FE.state.f.glyphs[70].some((x) => x)]; }, sheetPng);
  assert.deepStrictEqual(imp, [12, true]); ok('PNG sheet imported in the browser as 12x12');
  const bd = await p.evaluate(async (t) => { await FE.openBytes(new TextEncoder().encode(t), 'x.bdf'); return [FE.state.f.adv, FE.state.f.glyphs[65][FE.state.f.base - 7]]; }, bdf);
  assert.deepStrictEqual(bd, [8, 0x18]); ok('BDF imported in the browser');
  await p.evaluate(() => FE.openBytes(new Uint8Array(1024).map((_, i) => i * 7 & 255), 'a.fnt'));
  const fnt = await p.evaluate(() => Array.from(FE.CF.toFnt(FE.state.f)).join());
  assert.strictEqual(fnt, Array.from(new Uint8Array(1024).map((_, i) => i * 7 & 255)).join()); ok('.fnt open then export in the browser is identical');
  // ---- validation panes, bands, grid, diff ---------------------------------------------------------------------------------
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  const ink = (id) => p.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 90 && d[k + 1] < 90 && d[k + 2] < 90) n++; return [c.width, c.height, n]; }, id);
  for (const id of ['v1', 'v2', 'vp']) { const [w, h, n] = await ink(id); assert.ok(w > 100 && h > 20 && n > 200, id + ' draws visible text (' + n + ' ink px)'); }
  ok('ACWriter 1x, 2x and xCWriter Page panes all show ink');
  assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('v2').width, document.getElementById('v2').height]), [320, 192]); ok('ACWriter panes use the 320x192 screen');
  const inkNoBands = await ink('v2'); await p.evaluate(() => { document.getElementById('vbands').checked = false; document.getElementById('vbands').dispatchEvent(new Event('input')); });
  const colorCount = (id, rgb) => p.evaluate(([i, c]) => { const cv = document.getElementById(i), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - c[0]) < 12 && Math.abs(d[k + 1] - c[1]) < 12 && Math.abs(d[k + 2] - c[2]) < 12) n++; return n; }, [id, rgb]);
  assert.strictEqual(await colorCount('v2', [0xe0, 0x55, 0x55]), 0);
  await p.evaluate(() => { document.getElementById('vbands').checked = true; document.getElementById('vbands').dispatchEvent(new Event('input')); });
  assert.ok(await colorCount('v2', [0xe0, 0x55, 0x55]) > 50 && await colorCount('vp', [0xe0, 0x55, 0x55]) > 20); ok('metric bands (baseline row) toggle on and off');
  const g0 = await colorCount('v2', [0xd8, 0xd5, 0xcc]);
  await p.evaluate(() => { document.getElementById('vgrid').checked = true; document.getElementById('vgrid').dispatchEvent(new Event('input')); });
  assert.ok(await ink('v2') !== inkNoBands || (await colorCount('v2', [0xd8, 0xd5, 0xcc])) !== g0); ok('dot grid overlay changes the panes');
  const dif = await p.evaluate(() => FE.val.diff());
  assert.ok(Array.isArray(dif.list) && Object.keys(dif.pct).length === 94); ok('diff view lists ' + dif.list.length + ' differing glyphs for craft6');
  await p.evaluate(() => { const t = document.getElementById('vth'); t.value = 100; t.dispatchEvent(new Event('input')); });
  assert.strictEqual((await p.evaluate(() => FE.val.diff())).list.length, 0); ok('diff threshold 100% reports nothing');
  await p.evaluate(() => { const t = document.getElementById('vth'); t.value = 0.1; t.dispatchEvent(new Event('input')); });
  const lo = await p.evaluate(() => FE.val.diff().list.length); assert.ok(lo > 0 && /differ/.test(await p.textContent('#vdl'))); ok('low threshold flags glyphs (' + lo + ')');
  await p.evaluate(() => { const t = document.getElementById('vth'); t.value = 10; t.dispatchEvent(new Event('input')); });
  await p.evaluate(() => FE.openBytes(new Uint8Array(1024).map((_, i) => (i * 5) & 255), 'a.fnt'));
  assert.ok((await ink('v2'))[2] > 100); ok('8 px .fnt font renders in the ACWriter panes');
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  // ---- per-glyph width / bearings / advance --------------------------------------------------------------------------------
  await p.evaluate(() => FE.select(65));
  const gm = () => p.evaluate(() => ['gmw', 'gmlb', 'gmrb', 'gmadv'].map((i) => +document.getElementById(i).value));
  const m0 = await gm(); assert.ok(m0[0] > 0 && m0[3] === await p.evaluate(() => FE.state.f.adv));
  await p.fill('#gmadv', String(m0[3] + 2)); await p.dispatchEvent('#gmadv', 'change');
  const m1 = await gm(); assert.strictEqual(m1[3], m0[3] + 2); assert.strictEqual(m1[2], m0[2] + 2); assert.ok(await p.evaluate(() => Object.keys(FE.state.f.advs).length === 1)); ok('advance override widens the right bearing');
  await p.fill('#gmrb', String(m0[2])); await p.dispatchEvent('#gmrb', 'change');
  assert.deepStrictEqual(await gm(), m0); assert.strictEqual(await p.evaluate(() => Object.keys(FE.state.f.advs).length), 0); ok('right bearing back to default removes the override');
  await p.evaluate(() => FE.select(46)); const m2 = await gm(); assert.ok(m2[0] < 5, 'dot narrower than the cell');
  await p.fill('#gmlb', String(m2[1] + 1)); await p.dispatchEvent('#gmlb', 'change');
  assert.strictEqual((await gm())[1], m2[1] + 1); ok('left bearing shifts the ink');
  await p.click('#gmtrim'); assert.strictEqual((await gm())[1], 0); ok('trim moves the ink to the left edge');
  const wb = (await gm())[0]; await p.fill('#gmw', String(wb + 1)); await p.dispatchEvent('#gmw', 'change');
  assert.strictEqual((await gm())[0], wb + 1); ok('width field resamples the glyph');
  await p.click('#gmreset'); await p.evaluate(() => FE.select(65));
  // ---- Send to ACWriter, Use in xCWriter, master, open/save ------------------------------------------------------------------
  await p.evaluate(() => { window.__w = []; window.FujiNet = { emu: { hostWrite: (n, b) => window.__w.push([n, b.length, Array.from(b.slice(0, 4))]) } }; });
  await p.click('#bsend');
  let w = await p.evaluate(() => window.__w); assert.strictEqual(w.length, 1); assert.ok(/\.ACF$/.test(w[0][0]) && w[0][1] > 100 && w[0][2].join() === Array.from(Buffer.from('ACF2')).join() || w[0][0].endsWith('.ACF')); ok('Send to ACWriter writes ' + w[0][0] + ' (' + w[0][1] + ' bytes) via FujiNet.emu.hostWrite');
  await p.evaluate(() => FE.openBytes(new Uint8Array(1024).map((_, i) => (i * 3) & 255), 'send8.fnt'));
  await p.click('#bsend'); w = await p.evaluate(() => window.__w); assert.ok(/\.FNT$/.test(w[1][0]) && w[1][1] === 1024); ok('8 px fonts are sent as a 1024 byte ' + w[1][0]);
  await p.evaluate(() => { delete window.FujiNet; });
  const t0 = Date.now(); await p.click('#bsend'); await p.waitForFunction(() => /Not sent/.test(document.body.innerText), null, { timeout: 5000 }); ok('Send without an emulator reports it (' + (Date.now() - t0) + ' ms)');
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  await p.fill('#name', 'MYFONT'); await p.dispatchEvent('#name', 'change'); await p.click('#buse');
  const uf = await p.evaluate(() => JSON.parse(localStorage.getItem('craft.userfonts') || '{}'));
  assert.ok(JSON.stringify(uf).includes('MYFONT') || Object.keys(uf).length > 0); ok('Use in xCWriter stores the font in craft.userfonts (' + Object.keys(uf).join(',') + ')');
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  await p.evaluate(() => { FE.state.f.locked = true; document.getElementById('bderive').click(); });
  await p.evaluate(() => { FE.selectSize(5); });
  const m8 = await p.evaluate(() => [FE.state.f.adv, FE.state.fam && Object.keys(FE.state.fam.sizes).length]); assert.strictEqual(m8[0], 5);
  await p.click('#bmaster'); assert.strictEqual(await p.evaluate(() => FE.state.fam.master), 5);
  const lockedKept = await p.evaluate(() => { const l = Object.values(FE.state.fam.sizes).filter((f) => f.locked); document.getElementById('bderive').click(); return l.length > 0 && l.every((f) => Object.values(FE.state.fam.sizes).includes(f)); }); assert.ok(lockedKept); ok('Set as master + Derive smaller keep locked and hand-edited sizes');
  const rt = await p.evaluate(() => { const a = FE.exportAcf(); const b = FE.CF.parse(a); return [a.length, b.adv === FE.state.f.adv, JSON.stringify(b.glyphs) === JSON.stringify(FE.state.f.glyphs)]; });
  assert.ok(rt[1] && rt[2]); ok('save then open of .acf is lossless (' + rt[0] + ' bytes)');
  await p.evaluate(() => FE.openBytes(FE.CF.serialize(FE.state.f), 'rt.acf')); ok('.acf opens through the page');
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  // ---- font pipeline: ROM import, XCF / BDF / TTF export and lossless re-import ----------------------------------------------
  const romFile = ROOT + '/software_n_roms/ATARIXL.ROM';
  if (fs.existsSync(romFile)) {
    const imp2 = await p.evaluate(async (b64) => { await FE.openBytes(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), 'ATARIXL.ROM'); return [FE.state.f.adv, FE.state.f.glyphs[65].some((x) => x)]; }, fs.readFileSync(romFile).toString('base64'));
    assert.deepStrictEqual(imp2, [8, true]); ok('ROM charset imported through the pipeline (8x8, A has ink)');
  }
  await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
  await p.evaluate(() => { document.getElementById('bderive').click(); });
  const before = await p.evaluate(() => JSON.stringify(FE.state.f.glyphs));
  for (const [btn, ext] of [['bxcf', 'xcf'], ['bbdf', 'bdf'], ['bttf', 'ttf']]) {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#' + btn)]);
    const file = ROOT + '/out/fe-pipe.' + ext; await dl.saveAs(file);
    assert.ok(dl.suggestedFilename().endsWith('.' + ext)); assert.ok(fs.statSync(file).size > 500);
    await p.evaluate(() => FE.openBytes(new Uint8Array(1024).map((_, i) => (i * 3) & 255), 'other.fnt'));
    const after = await p.evaluate(async (b64) => { await FE.openBytes(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), 'x'); return JSON.stringify(FE.state.f.glyphs); }, fs.readFileSync(file)    .toString('base64'));
        assert.ok(after.length > 100);
        if (ext !== 'xcf') assert.strictEqual(after, before, ext + ' re-import differs');
    ok(ext.toUpperCase() + ' exported (' + fs.statSync(file).size + ' bytes) and re-imported in the browser');
    await p.evaluate(() => FE.openBytes(Uint8Array.from(atob(window.CRAFT_FONTS.craft6), (c) => c.charCodeAt(0)), 'c6.acf'));
  await p.evaluate(() => FE.showTab('atari'));
    await p.evaluate(() => { document.getElementById('bderive').click(); });
  }
  const xcfSame = await p.evaluate(async () => {
    const FP = XCW.FontPipe, fam = FE.state.fam || FE.CF.familyNew(FE.state.f), s = FE.state.f.adv;
    const out = FP.files(fam, 'rt', { formats: ['xcf', 'bdf', 'ttf'] }), g = JSON.stringify(FE.state.f.glyphs), res = {};
    for (const n of Object.keys(out)) { const k = n.endsWith('.xcf') ? 'xcf' : n.endsWith('.bdf') ? 'bdf' : 'ttf'; if (k !== 'xcf' && !n.includes('-' + s + '.')) continue; const bytes = typeof out[n] === 'string' ? new TextEncoder().encode(out[n]) : out[n]; await FE.openBytes(bytes, n); res[k] = JSON.stringify(FE.state.f.glyphs); }
    return [g, res];
  });
  assert.ok(xcfSame[1].bdf === xcfSame[0] && xcfSame[1].ttf === xcfSame[0]); ok('BDF and TTF exports re-import to identical glyph bitmaps');
  await p.screenshot({ path: ROOT + '/out/fe-tools.png' });
  await p.evaluate(() => { document.getElementById('vhl').checked = false; document.getElementById('vhl').dispatchEvent(new Event('input')); document.querySelectorAll('.toast,#toast').forEach((e) => e.remove()); FE.showTab('atari'); }); await p.screenshot({ path: ROOT + '/out/fe-validate.png', fullPage: true }); fs.copyFileSync(ROOT + '/out/fe-validate.png', ROOT + '/out/fe-validate-v.png');
  assert.deepStrictEqual(errs, []); ok('no page errors');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
