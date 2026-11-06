// Font pipeline CLI (docs/FONT.md "Font pipeline"; module tools/fontpipe.cjs).
//   node scripts/fontpipe.cjs down      <ttf|otf|woff> [--size 12,10,8,6,5,4|all] [--out DIR] [--formats acf,xcf,...] [--threshold 0.3] [--weight 0] [--hint] [--direct] [--name N]
//   node scripts/fontpipe.cjs up        <rom|fnt|acf|json|bdf|pcf|xcf>  [--out DIR] [--formats acf,xcf,bdf,ttf,fnt,json] [--size ..] [--name N]
//   node scripts/fontpipe.cjs roundtrip <any font file> [--size ..]        prints the per-size pixel diff of every export path; exit 1 over --max (0.005)
// Files go to --out (default out/fontpipe). --install writes the .acf/.xcf files to web/library/fonts/local/converted (gitignored),
// refreshes the font manifest, and the font then shows under "Converted" in the xCWriter and font editor pickers.
// A file with an extension as --out (e.g. my.acf) names the single output.
'use strict';
const fs = require('fs'), path = require('path');
const FP = require('../tools/fontpipe.cjs');

const [cmd, file, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) {
  const k = rest[i];
  if (!k.startsWith('--')) continue;
  const key = k.slice(2), nxt = rest[i + 1];
  if (['hint', 'direct', 'noGrid', 'install'].includes(key)) opt[key] = true;
  else { opt[key] = nxt; i++; }
}
if (!['down', 'up', 'roundtrip'].includes(cmd) || !file) {
  console.error('usage: node scripts/fontpipe.cjs down|up|roundtrip <file> [--size 12,8|all] [--out DIR] [--formats acf,xcf,bdf,ttf,fnt,json] [--threshold n] [--weight n] [--hint] [--direct] [--name N]');
  process.exit(2);
}
const conv = { name: opt.name, threshold: opt.threshold !== undefined ? +opt.threshold : undefined, weight: opt.weight !== undefined ? +opt.weight : undefined, hint: !!opt.hint, direct: !!opt.direct, noGrid: !!opt.noGrid };
if (opt.install) { opt.out = path.join(__dirname, '..', 'web', 'library', 'fonts', 'local', 'converted'); opt.formats = opt.formats || 'acf,xcf'; }
if (opt.size && opt.size !== 'all') { conv.sizes = String(opt.size).split(',').map(Number); conv.size = conv.sizes.length === 1 ? conv.sizes[0] : undefined; }
for (const k of Object.keys(conv)) if (conv[k] === undefined) delete conv[k];

(async () => {
  const data = fs.readFileSync(file), kind = FP.detect(data, file);
  if (cmd === 'down' && !['ttf', 'woff'].includes(kind)) console.error('note: ' + path.basename(file) + ' is a ' + kind + ' font, not an outline font: only smaller sizes are derived');
  if (cmd === 'roundtrip') {
    const r = FP.roundtrip(data, file, conv), max = opt.max !== undefined ? +opt.max : 0.005;
    let bad = 0;
    console.log(path.basename(file) + ' (' + r.kind + ')' + (r.info && r.info.pixel ? ', pixel grid ' + r.info.pixel : ''));
    for (const [s, row] of Object.entries(r.sizes)) {
      const a = row.analysis, p = Object.entries(row.paths).map(([k, v]) => k + ' ' + v.diff + 'px/' + v.advBad + 'adv').join('  ');
      console.log('  ' + String(s).padStart(2) + ' px  glyphs ' + a.count + '  cap ' + a.capTop + '-' + a.capBottom + '  x ' + a.xTop + '  desc ' + a.descBottom + '  adv ' + a.advs + '  | ' + p);
      for (const v of Object.values(row.paths)) if (v.frac > max || v.advBad) bad++;
    }
    console.log(bad ? 'FAIL: ' + bad + ' path(s) over the threshold' : 'ok: every export path reads back within ' + max * 100 + '%');
    process.exit(bad ? 1 : 0);
  }
  const r = FP.load(data, file, conv);
  const base = opt.name || FP.baseName(file).replace(/[^A-Za-z0-9_-]/g, '_');
  const formats = opt.formats ? opt.formats.split(',') : cmd === 'down' ? ['acf', 'xcf'] : ['acf', 'xcf', 'bdf', 'ttf', 'fnt'];
  const out = FP.files(r.fam, base, { formats, meta: { source: { file: path.basename(file), kind: r.kind } } });
  let dir = opt.out || path.join(__dirname, '..', 'out', 'fontpipe');
  const names = Object.keys(out);
  if (path.extname(dir)) {
    const ext = path.extname(dir).slice(1), pick = names.filter((n) => n.endsWith('.' + ext));
    if (pick.length !== 1) { console.error('--out ' + dir + ' needs exactly one ' + ext + ' output, got ' + pick.length + ' (use a directory)'); process.exit(2); }
    fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    fs.writeFileSync(dir, typeof out[pick[0]] === 'string' ? out[pick[0]] : Buffer.from(out[pick[0]]));
    console.log('wrote ' + dir); return;
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) { fs.writeFileSync(path.join(dir, n), typeof out[n] === 'string' ? out[n] : Buffer.from(out[n])); console.log('wrote ' + path.join(dir, n)); }
  if (opt.install) { require('./fontlist.cjs').build(); console.log('manifest updated: the font appears under Converted in the xCWriter and font editor pickers'); }
  for (const w of (r.info && r.info.warnings) || []) console.log('warning: ' + w);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
