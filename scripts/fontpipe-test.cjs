// Manifest-driven font pipeline test: every font in font/, font_personal/, web/library/fonts (+atari/) and the ROM charsets goes
// through down/up and every export path (acf, xcf, bdf, ttf, fnt). Report: out/fontpipe-report.txt.  --all adds web/library/fonts/personal.
'use strict';
const fs = require('fs'), path = require('path');
const FP = require('../tools/fontpipe.cjs'), SF = require('../tools/sfnt.cjs');
// Documented source limitations (docs/FONT.md): the source font itself lacks the feature, so the check is waived.
const KNOWN = { 'web/library/fonts/atari/Kidpixies12.fnt': { desc: 'source charset has no descenders below the baseline row' } };
const root = path.join(__dirname, '..');
const MAX_FRAC = 0.005; // round-trip pixel diff allowed per size (0.5% of cells); the export paths are lossless so 0 is expected
const FONT_EXT = /\.(ttf|otf|woff|acf|fnt|bdf|pcf|xcf)$/i;

function list(dir, deep) {
  const d = path.join(root, dir), o = [];
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isFile() && FONT_EXT.test(e.name)) o.push(path.join(d, e.name));
    else if (deep && e.isDirectory()) o.push(...list(path.join(dir, e.name), deep));
  }
  return o;
}
const manifest = [].concat(list('font'), list('font_personal'), list('web/library/fonts'), list('web/library/fonts/atari'));
if (process.argv.includes('--all')) manifest.push(...list('web/library/fonts/personal', true));
const romDir = path.join(root, 'software_n_roms');
if (fs.existsSync(romDir)) for (const n of fs.readdirSync(romDir)) if (/\.rom$/i.test(n)) {
  const b = fs.readFileSync(path.join(romDir, n));
  if (FP.detect(b, n) === 'rom') manifest.push(path.join(romDir, n));
}

const rows = [], fails = [], notes = [];
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');
for (const file of manifest) {
  const name = rel(file), data = fs.readFileSync(file);
  let r;
  try { r = FP.roundtrip(data, file); } catch (e) { if (/not supported/i.test(e.message)) notes.push(name + ': ' + e.message); else { (/unrecognised/.test(e.message) ? notes : fails).push(name + ': pipeline threw ' + e.message); } continue; }
  const src = r.kind, known = KNOWN[name] || {};
  let srcInk = 0, srcMiss = [];
  if (src === 'ttf') { const sf = SF.parse(new Uint8Array(data)); for (let c = 33; c < 127; c++) { const id = sf.gidFor(c); if (id && sf.outline(id).length) srcInk++; else srcMiss.push(String.fromCharCode(c)); } }
  for (const [s, row] of Object.entries(r.sizes)) {
    const a = row.analysis, why = [];
    if (src === 'ttf' ? a.count < srcInk : a.count < 90) why.push('blank glyphs where the source has ink (' + a.count + ' of ' + (srcInk || 94) + ')');
    if (srcMiss.length && s === '12') notes.push(name + ': source has no outline for ' + srcMiss.join(' '));
    if (a.upper < 26 || a.lower < 26) why.push('case missing (upper ' + a.upper + ', lower ' + a.lower + ')');
    if (a.supTried && a.supOk < a.supTried - 4 && +s >= 8) why.push('superscripts lost (' + a.supOk + '/' + a.supTried + ')');
    if (a.subTried && a.subOk < a.subTried - 4 - srcMiss.length && +s >= 8) why.push('subscripts lost (' + a.subOk + '/' + a.subTried + ')');
    if (a.capBottom !== undefined && !(a.capBottom >= 6 && a.capBottom <= 10)) why.push('baseline row ' + a.capBottom + ' outside 6..10');
    if (a.capTop !== undefined && !(a.capTop <= 4)) why.push('cap top row ' + a.capTop + ' too low');
    if (a.xTop !== undefined && a.capTop !== undefined && a.xTop < a.capTop) why.push('x-height above cap height');
    if (!known.desc && a.descBottom !== undefined && a.capBottom !== undefined && a.descBottom <= a.capBottom) why.push('no descender below baseline');
    let worst = 0, advBad = 0;
    for (const [k, v] of Object.entries(row.paths)) { worst = Math.max(worst, v.frac); advBad += v.advBad; if (v.frac > MAX_FRAC) why.push(k + ' round trip diff ' + v.diff + ' px (' + (v.frac * 100).toFixed(2) + '%)'); if (v.advBad) why.push(k + ' advances changed for ' + v.advBad + ' glyphs'); }
    rows.push({ name, src, s, a, worst, advBad, paths: Object.keys(row.paths).join('+'), ok: !why.length });
    for (const w of why) fails.push(name + ' @' + s + ': ' + w);
  }
}

const pad = (v, n) => String(v).padEnd(n), lines = [];
lines.push('Font pipeline report  (' + new Date().toISOString().slice(0, 10) + ')   threshold: round-trip diff <= ' + MAX_FRAC * 100 + '% of cells, advances exact');
lines.push(pad('font', 52) + pad('src', 6) + pad('px', 4) + pad('glyphs', 7) + pad('U/L', 7) + pad('cap', 6) + pad('x', 3) + pad('desc', 5) + pad('advs', 5) + pad('sup/sub', 9) + pad('rt-diff%', 9) + 'paths  result');
for (const r of rows) lines.push(pad(r.name, 52) + pad(r.src, 6) + pad(r.s, 4) + pad(r.a.count, 7) + pad(r.a.upper + '/' + r.a.lower, 7) + pad(r.a.capTop + '-' + r.a.capBottom, 6) + pad(r.a.xTop, 3) + pad(r.a.descBottom, 5) + pad(r.a.advs, 5) + pad(r.a.supOk + '/' + r.a.subOk, 9) + pad((r.worst * 100).toFixed(2), 9) + r.paths + '  ' + (r.ok ? 'ok' : 'FAIL'));
lines.push('', 'fonts ' + manifest.length + ', size rows ' + rows.length + ', pass ' + rows.filter((r) => r.ok).length + ', fail ' + rows.filter((r) => !r.ok).length);
lines.push('', 'FAIL LIST', ...(fails.length ? fails : ['(none)']), '', 'NOTES (source limitations / unsupported)', ...(notes.length ? notes : ['(none)']), ...Object.entries(KNOWN).map(([k, v]) => k + ': ' + v.desc));
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'fontpipe-report.txt'), lines.join('\n') + '\n');
console.log(lines.slice(-8 - fails.length - notes.length).join('\n'));
console.log(fails.length ? 'FAIL ' + fails.length : 'ok', '- report: out/fontpipe-report.txt');
// --all is a stress run over an unvetted library (symbol fonts, caps-only fonts): only lossless-export failures are hard there
const hard = process.argv.includes('--all') ? fails.filter((f) => /round trip|advances changed|threw/.test(f)) : fails;
process.exit(hard.length ? 1 : 0);
