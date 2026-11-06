// Builds font/craft12.acf (hand-drawn master, tools/craftmaster.cjs), font/craft10.acf and font/craft8.fnt (derived from it).
// Existing files are kept unless --force is given, so hand edits made in fontedit are never overwritten.
const fs = require('fs'), path = require('path');
const CF = require('../tools/craftfont.cjs'), M = require('../tools/craftmaster.cjs');
const root = path.join(__dirname, '..'), force = process.argv.includes('--force');

function build() {
  const m = M.master(), d10 = CF.derive(m, 10, {}), f8 = require('../tools/craft8art.cjs').face();
  d10.name = 'Craft 10x12';
  return { m, d10, d8: f8 };
}
function write(fn, buf) {
  const p = path.join(root, 'font', fn);
  if (!force && fs.existsSync(p)) return false;
  fs.writeFileSync(p, buf); return true;
}
function art(f, text) {
  const out = [];
  for (let r = 0; r < f.rows; r++) {
    let line = '';
    for (const ch of text) { const g = CF.glyph(f, ch.charCodeAt(0)); for (let q = 0; q < f.adv; q++) line += q < f.gw && CF.hasPx(f, g[r], q) ? '#' : '.'; line += '|'; }
    out.push(line);
  }
  return out.join('\n');
}
// Large sizes (14-26 px, xCWriter / print / web; too big for the Atari app) are derived from the font/craft12.acf master when missing.
function ensureBig(force) {
  const m = CF.parse(fs.readFileSync(path.join(root, 'font', 'craft12.acf'))), made = [];
  for (const s of CF.BIG_SIZES) {
    const fn = 'craft' + s + '.acf';
    if (!force && fs.existsSync(path.join(root, 'font', fn))) continue;
    const d = CF.derive(m, s, {}); d.name = 'Craft ' + s + 'x' + s;
    fs.writeFileSync(path.join(root, 'font', fn), CF.serialize(d)); made.push(fn);
  }
  return made;
}
function ensure() {
  const { m, d10, d8 } = build(), AF = require('../tools/acwfaces.cjs');
  const w = [write('craft12.acf', CF.serialize(AF.withGfx(m))), write('craft10.acf', CF.serialize(AF.withGfx(d10))), write('craft8.fnt', CF.toFnt(AF.withGfx(d8)))];
  AF.upgradeFiles(); ensureBig(force);
  return w;
}
if (require.main === module) {
  const w = ensure();
  const { m, d10, d8 } = build();
  console.log('craft12/10/8 written:', w.join(','));
  if (process.argv.includes('--art')) for (const f of [m, d10, d8]) console.log(f.name + '\n' + art(f, process.argv[process.argv.indexOf('--art') + 1] || 'Handgxy 09'));
}
module.exports = { build, art, ensure, ensureBig };
