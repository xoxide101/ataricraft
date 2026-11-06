// The faces ACWriter / xCWriter really use, as one registry the font editor can open, edit and write back to.
//   node scripts/acw-faces.cjs            regenerate web/js/fontedit/acw-faces.js, web/library/fonts/acw/*.acf, font/build/*
// Sources of truth (unchanged, owned by the ACWriter build in tools/acwriter/): font3_art.cjs (craft4), font4.json + AtariPixel8.fnt
// (craft5, craft6), craft8art.cjs (craft8 / zfont). font/craft8.fnt, craft10.acf, craft12.acf are real files that are edited in place.
// Edits of the generated faces (craft4 / 5 / 6 / zfont) are stored as font/overrides/<id>.acf. The ACWriter build must read them:
//   const f = require('../acwfaces.cjs').override('craft' + adv, builtFace);   (docs/FONT.md, "ACWriter faces")
'use strict';
const fs = require('fs'), path = require('path');
const CF = require('./craftfont.cjs');
const ROOT = path.join(__dirname, '..');
const OVR = path.join(ROOT, 'font', 'overrides'), BUILD = path.join(ROOT, 'font', 'build');
const fontFile = (n) => path.join(ROOT, 'font', n);

const FACES = [
  { id: 'craft4', adv: 4, label: 'Craft 4 px - Standard (PAGE mode)', used: 'ACWriter PAGE view 1x, xCWriter Page view; craftpg.inc is built from craft4.inc', src: 'tools/acwriter/font3_art.cjs -> craft4.inc', kind: 'override' },
  { id: 'craft5', adv: 5, label: 'Craft 5 px (12 cpi)', used: 'ACWriter 12 cpi pitch, craft5.inc', src: 'tools/acwriter/font4.json + AtariPixel8.fnt -> craft5.inc', kind: 'override' },
  { id: 'craft6', adv: 6, label: 'Craft 6 px (10 cpi)', used: 'ACWriter 10 cpi pitch, craft6.inc', src: 'AtariPixel8.fnt columns 7->5 -> craft6.inc', kind: 'override' },
  { id: 'craft8', adv: 8, label: 'Craft 8x8 (Atari native)', used: 'ACWriter Character > Font, FONT.FNT charset', src: 'font/craft8.fnt (edited in place)', kind: 'file', file: 'craft8.fnt' },
  { id: 'craft10', adv: 10, label: 'Craft 10x12', used: 'xCWriter HQ pitch', src: 'font/craft10.acf (edited in place)', kind: 'file', file: 'craft10.acf' },
  { id: 'craft12', adv: 12, label: 'Craft 12x12 (master)', used: 'master the other sizes are derived from', src: 'font/craft12.acf (edited in place)', kind: 'file', file: 'craft12.acf' },
  { id: 'zfont', adv: 8, label: 'Zoom 8x8 (zfont.inc)', used: 'ACWriter PAGE 2x zoom (word/zoom.inc)', src: 'tools/craft8art.cjs -> zfont.inc', kind: 'override' },
];
const byId = (id) => FACES.find((f) => f.id === id);
const ovrPath = (id) => path.join(OVR, id + '.acf');

function baseFace(id) {
  const meta = byId(id); if (!meta) throw new Error('unknown ACWriter face ' + id);
  if (meta.kind === 'file' && fs.existsSync(fontFile(meta.file))) {
    const b = fs.readFileSync(fontFile(meta.file));
    const f = /\.fnt$/i.test(meta.file) ? CF.fromFnt(b, { name: meta.label }) : CF.parse(b);
    return f;
  }
  if (id === 'craft4') return require('./acwriter/font3_art.cjs').face();
  if (id === 'craft5' || id === 'craft6') {
    const fnt = fs.readFileSync(path.join(ROOT, 'web/library/fonts/atari/AtariPixel8.fnt'));
    const f4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/acwriter/font4.json'), 'utf8'));
    return CF.builtin(fnt, meta.adv, id === 'craft5' ? f4 : null);
  }
  if (id === 'craft8') return require('./craft8art.cjs').face();
  if (id === 'zfont') { const f = require('./craft8art.cjs').face(); f.name = meta.label; return f; }
  if (id === 'craft10') return CF.derive(require('./craftmaster.cjs').master(), 10, {});
  if (id === 'craft12') return require('./craftmaster.cjs').master();
  throw new Error('no source for ' + id);
}
const hasOverride = (id) => fs.existsSync(ovrPath(id));

// Hook for the ACWriter build: returns the user's edited face when font/overrides/<id>.acf exists, else the face passed in.
function override(id, built) {
  if (!hasOverride(id)) return built;
  const f = CF.parse(fs.readFileSync(ovrPath(id)));
  return f;
}
const load = (id) => override(id, baseFace(id));

// Writes an edited face back to its real source: font/ file for craft8/10/12, an override file for the generated ones.
function save(id, acf) {
  const meta = byId(id); if (!meta) throw new Error('unknown ACWriter face ' + id);
  const f = CF.parse(Buffer.from(acf));
  if (f.adv !== meta.adv) throw new Error(id + ' is a ' + meta.adv + ' px face, got ' + f.adv + ' px');
  if (meta.kind === 'file') {
    fs.writeFileSync(fontFile(meta.file), /\.fnt$/i.test(meta.file) ? CF.toFnt(f) : CF.serialize(f));
    return meta.src;
  }
  fs.mkdirSync(OVR, { recursive: true });
  fs.writeFileSync(ovrPath(id), CF.serialize(f));
  return 'font/overrides/' + id + '.acf';
}
// Back to the built source: removes the override (craft8/10/12: rewrites the file from the generator).
function reset(id) {
  const meta = byId(id);
  if (meta.kind === 'file') { fs.rmSync(fontFile(meta.file), { force: true }); const f = baseFace(id); fs.writeFileSync(fontFile(meta.file), /\.fnt$/i.test(meta.file) ? CF.toFnt(f) : CF.serialize(f)); return; }
  fs.rmSync(ovrPath(id), { force: true });
}

// zfont.inc text for the face (96 glyphs, codes 32..127, 8 rows, code 127 drawn as '?')
function zfontInc(f) {
  const all = [];
  for (let a = 32; a <= 127; a++) { const g = CF.glyph(f, a === 127 ? 63 : a); for (let i = 0; i < 8; i++) all.push((g[f.head + i] || 0) & 255); }
  let s = '; generated by mkzoomfont.cjs from tools/craft8art.cjs - do not edit\nzfont:\n';
  for (let i = 0; i < all.length; i += 16) s += '        .byte ' + all.slice(i, i + 16).join(',') + '\n';
  return s;
}

// Everything the editor and the build need: per-face meta + ACF2 + the generated .inc files, written under font/build/ (never tools/acwriter/).
function emit(outBuild = BUILD) {
  fs.mkdirSync(outBuild, { recursive: true });
  const faces = [];
  for (const m of FACES) {
    const f = load(m.id), acf = CF.serialize(f);
    faces.push({ id: m.id, adv: m.adv, label: m.label, used: m.used, src: m.src, kind: m.kind, override: hasOverride(m.id), acf: acf.toString('base64') });
    if (['craft4', 'craft5', 'craft6'].includes(m.id)) fs.writeFileSync(path.join(outBuild, m.id + '.inc'), CF.toInc(f, 'c' + m.adv));
    if (m.id === 'zfont') fs.writeFileSync(path.join(outBuild, 'zfont.inc'), zfontInc(f));
  }
  return faces;
}
function writeWeb() {
  const faces = emit();
  const dir = path.join(ROOT, 'web', 'library', 'fonts', 'acw');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of faces) fs.writeFileSync(path.join(dir, f.id + '.acf'), Buffer.from(f.acf, 'base64'));
  fs.writeFileSync(path.join(ROOT, 'web', 'js', 'fontedit', 'acw-faces.js'), '// GENERATED by scripts/acw-faces.cjs (tools/acwfaces.cjs) - the faces ACWriter and xCWriter use, ACF2 base64.\nwindow.ACW_FACES = ' + JSON.stringify(faces) + ';\n');
  return faces;
}
module.exports = { FACES, byId, baseFace, load, override, save, reset, emit, writeWeb, zfontInc, hasOverride };
