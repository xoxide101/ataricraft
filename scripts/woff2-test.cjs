// WOFF2 reader test (tools/woff2.cjs): every .woff2 under web/library/fonts/personal is decoded and compared glyph by glyph
// (outlines + advances, all glyphs) with the same-named .ttf/.otf next to it when there is one; then one is converted through fontpipe.
// Usage: node scripts/woff2-test.cjs        (local fonts are gitignored: SKIP when absent)
const fs = require('fs'), path = require('path');
const SF = require('../tools/sfnt.cjs'), FP = require('../tools/fontpipe.cjs');
const root = path.resolve(__dirname, '../web/library/fonts/personal');
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const files = walk(root).filter((f) => /\.woff2$/i.test(f));
// twins that are a different build of the font (verified by hand: other advance widths / a 100-unit y shift in one glyph), not decoder errors
const OTHER_BUILD = /Area51\.woff2|Beachball Short\.woff2/;
let ok = 0, cmp = 0, bad = 0, glyphs = 0;
for (const f of files) {
  let w;
  try { w = SF.parse(new Uint8Array(fs.readFileSync(f))); } catch (e) { console.log('FAIL decode', f, e.message); bad++; continue; }
  ok++;
  const sib = ['.ttf', '.otf'].map((x) => f.replace(/\.woff2$/i, x)).find((x) => fs.existsSync(x));
  if (!sib) continue;
  if (OTHER_BUILD.test(f)) continue;
  const t = SF.parse(new Uint8Array(fs.readFileSync(sib)));
  cmp++;
  if (w.numGlyphs !== t.numGlyphs) { console.log('FAIL glyph count', f); bad++; continue; }
  for (let g = 0; g < w.numGlyphs; g++) {
    glyphs++;
    if (JSON.stringify(w.outline(g)) !== JSON.stringify(t.outline(g)) || w.advance(g) !== t.advance(g)) { console.log('FAIL glyph', g, f); bad++; break; }
  }
}
if (files.length) {
  const f = files[0], res = FP.load(new Uint8Array(fs.readFileSync(f)), path.basename(f));
  if (res.kind !== 'woff2' || !res.fam) { console.log('FAIL fontpipe load of', f, Object.keys(res)); bad++; }
}console.log(files.length ? `${ok}/${files.length} WOFF2 decoded, ${cmp} compared against a TTF/OTF twin (${glyphs} glyphs identical)${bad ? ', ' + bad + ' FAILED' : ''}` : 'SKIP (no .woff2 in web/library/fonts/personal)');
process.exit(bad ? 1 : 0);
