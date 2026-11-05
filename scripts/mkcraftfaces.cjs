// Builds font/craft12.acf (hand-drawn master, tools/craftmaster.cjs), font/craft10.acf and font/craft8.fnt (derived from it).
// Existing files are kept unless --force is given, so hand edits made in fontedit are never overwritten.
const fs = require('fs'), path = require('path');
const CF = require('../tools/craftfont.cjs'), M = require('../tools/craftmaster.cjs');
const root = path.join(__dirname, '..'), force = process.argv.includes('--force');

function build() {
  const m = M.master(), d10 = CF.derive(m, 10, {}), d8 = CF.derive(m, 8, {});
  d10.name = 'Craft 10x12'; d8.name = 'Craft 8x8';
  return { m, d10, d8 };
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
function ensure() {
  const { m, d10, d8 } = build();
  return [write('craft12.acf', CF.serialize(m)), write('craft10.acf', CF.serialize(d10)), write('craft8.fnt', CF.toFnt(d8))];
}
if (require.main === module) {
  const w = ensure();
  const { m, d10, d8 } = build();
  console.log('craft12/10/8 written:', w.join(','));
  if (process.argv.includes('--art')) for (const f of [m, d10, d8]) console.log(f.name + '\n' + art(f, process.argv[process.argv.indexOf('--art') + 1] || 'Handgxy 09'));
}
module.exports = { build, art, ensure };
