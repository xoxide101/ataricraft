// Manifest-driven font pipeline test: every font in font/, font_personal/, web/library/fonts (+atari/) and the ROM charsets goes
// through down/up and every export path (acf, xcf, bdf, ttf, fnt). Report: out/fontpipe-report.txt.  --all adds web/library/fonts/personal.
'use strict';
const fs = require('fs'), path = require('path');
const FP = require('../tools/fontpipe.cjs'), SF = require('../tools/sfnt.cjs');
// Waivers (documented in docs/FONT.md): up to 2 punctuation glyphs may rasterise to nothing when the source glyph is a sub-pixel mark; sup/sub of Atari-Russian and Poppkorn lose glyphs because the Cyrillic / display caps nearly fill the cell.
// Source-side facts, so the glyph checks compare the output with what the SOURCE font really contains instead of with a fixed ideal
// (symbol, caps-only, pixel-grid and no-descender fonts legitimately lack features; the pipeline must keep what exists, not invent it).
// Outline fonts (ttf/otf/woff) are measured on their outlines; bitmap fonts use their native (largest) size as the reference.
function srcFacts(data, kind, nat) {
  if (kind !== 'ttf' && kind !== 'woff' && kind !== 'woff2') return { ink: nat.count, upper: nat.upper, lower: nat.lower, desc: nat.descBottom > nat.capBottom, capsOnly: false, xTaller: false, capRatio: 1, miss: [] };
  const sf = SF.parse(new Uint8Array(data)), cache = {};
  const box = (ch) => {
    if (ch in cache) return cache[ch];
    const id = sf.gidFor(ch.charCodeAt(0)), ol = id ? sf.outline(id) : [];
    if (!ol.length) return (cache[ch] = null);
    let y0 = 1e9, y1 = -1e9; for (const p of ol) for (const q of p) { if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return (cache[ch] = { y0, y1, key: JSON.stringify(ol) });
  };
  const F = { ink: 0, upper: 0, lower: 0, miss: [], same: 0, lowTaller: 0 };
  for (let c = 33; c < 127; c++) { if (box(String.fromCharCode(c))) F.ink++; else F.miss.push(String.fromCharCode(c)); }
  for (let i = 0; i < 26; i++) {
    const U = box(String.fromCharCode(65 + i)), L = box(String.fromCharCode(97 + i));
    if (U) F.upper++; if (L) F.lower++;
    if (U && L && U.key === L.key) F.same++;
    if (U && L && L.y1 > U.y1 * 1.02) F.lowTaller++;
  }
  const H = box('H'), x = box('x');
  let dmin = 1e9; for (const ch of 'gjpqy') { const b = box(ch); if (b) dmin = Math.min(dmin, b.y0); }
  const base = Math.min(H ? H.y0 : 0, x ? x.y0 : 0);
  F.desc = !!H && dmin < 1e9 && (base - dmin) / Math.max(1, H.y1 - H.y0) >= 0.08;
  F.capsOnly = F.same >= 20;
  F.xTaller = F.lowTaller > 5 || !!(x && H && x.y1 > H.y1 * 1.02);
  F.capRatio = H ? H.y1 / sf.upm : 1;
  return F;
}const root = path.join(__dirname, '..');
const MAX_FRAC = 0.005; // round-trip pixel diff allowed per size (0.5% of cells); the export paths are lossless so 0 is expected
const FONT_EXT = /\.(ttf|otf|woff2?|acf|fnt|bdf|pcf|xcf)$/i;

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
  const src = r.kind, sz = Object.keys(r.sizes).map(Number), nat = r.sizes[Math.max(...sz)].analysis;
  const F = srcFacts(data, src, nat);
  const feat = [!F.desc && 'no descenders', F.lower === 0 && 'no lowercase', F.capsOnly && 'caps-only (lowercase = capitals)', F.upper < 26 && F.upper + ' capitals', F.lower > 0 && F.lower < 26 && F.lower + ' lowercase letters', F.xTaller && 'x-height above cap height', F.capRatio < 0.5 && 'cap height ' + F.capRatio.toFixed(2) + ' em'].filter(Boolean);
  if (feat.length) notes.push(name + ': source has ' + feat.join(', '));
  if (F.miss.length) notes.push(name + ': source has no outline for ' + F.miss.join(' '));
  for (const [s, row] of Object.entries(r.sizes)) {
    const a = row.analysis, why = [], subDn = +s >= 10 ? 2 : 3;
    if (a.count < F.ink - 2) why.push('blank glyphs where the source has ink (' + a.count + ' of ' + F.ink + ')');
    if (a.upper < F.upper || a.lower < F.lower) why.push('case lost (upper ' + a.upper + '/' + F.upper + ', lower ' + a.lower + '/' + F.lower + ')');
    // a glyph that already touches the cell top / bottom cannot be shifted by the sup / sub offset without clipping: source property
    if (a.supTried && a.supOk < a.supTried - 4 && +s >= 8 && a.capTop >= 2 && F.capRatio < 0.7 && !/Atari-Russian|Poppkorn/.test(name)) why.push('superscripts lost (' + a.supOk + '/' + a.supTried + ')');
    if (a.subTried && a.subOk < a.subTried - 4 - F.miss.length && +s >= 8 && a.capBottom + subDn < 12 && F.capRatio < 0.7) why.push('subscripts lost (' + a.subOk + '/' + a.subTried + ')');
    if (a.capBottom >= 0 && !(a.capBottom >= 6 && a.capBottom <= Math.max(10, +s - 3))) why.push('baseline row ' + a.capBottom + ' outside 6..' + Math.max(10, +s - 3));
    if (a.capTop >= 0 && !(a.capTop <= Math.max(4, Math.round(+s / 6))) && F.capRatio >= 0.5) why.push('cap top row ' + a.capTop + ' too low');
    if (a.xTop >= 0 && a.capTop >= 0 && a.xTop < a.capTop && !F.xTaller) why.push('x-height above cap height');
    if (F.desc && +s >= 8 && a.descBottom >= 0 && a.capBottom >= 0 && a.descBottom <= a.capBottom) why.push('descender lost (source has one)');    let worst = 0, advBad = 0;
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
lines.push('', 'FAIL LIST', ...(fails.length ? fails : ['(none)']), '', 'NOTES (source limitations / unsupported)', ...(notes.length ? notes : ['(none)']));
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'fontpipe-report.txt'), lines.join('\n') + '\n');
console.log(lines.slice(-8 - fails.length - notes.length).join('\n'));
console.log(fails.length ? 'FAIL ' + fails.length : 'ok', '- report: out/fontpipe-report.txt');
// --all is a stress run over an unvetted library (symbol fonts, caps-only fonts): only lossless-export failures are hard there
const hard = process.argv.includes('--all') ? fails.filter((f) => /round trip|advances changed|threw/.test(f)) : fails;
process.exit(hard.length ? 1 : 0);
