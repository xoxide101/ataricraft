// Builds the font list used by web/fontedit.html (and the converters): node scripts/fontlist.cjs
// Groups: Built-in (craft4/5/6 from builtin-fonts.js), Shipped (font/, web/library/fonts/), Atari ROM (extracted from the OS ROM
// at build time, never committed), Personal (font_personal/, gitignored). Everything generated goes to web/library/fonts/local/,
// which is gitignored, so no ROM bytes and no personal font can reach a commit.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const local = path.join(root, 'web', 'library', 'fonts', 'local');
const FONT_EXT = /\.(acf|json|ttf|otf|woff2?|fnt|bdf|pcf|png)$/i;

const rd = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => FONT_EXT.test(f)).sort() : []);
const mk = (d) => fs.mkdirSync(d, { recursive: true });

function build() {
  mk(local); mk(path.join(local, 'shared')); mk(path.join(local, 'personal'));
  mk(path.join(root, 'font')); mk(path.join(root, 'font_personal'));
  const groups = [];

  // shareable fonts we ship: font/ (copied next to the manifest so the static server can reach them)
  const bi = fs.readFileSync(path.join(root, 'web', 'js', 'fontedit', 'builtin-fonts.js'), 'utf8');
  const CF = require('../tools/craftfont.cjs');
  for (const m of bi.matchAll(/"(craft\d+)":"([^"]+)"/g)) {
    const p = path.join(root, 'font', m[1] + '.acf');
    if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
  }
  // craft 8x8 / 10x12 / 12x12 are real designs (tools/craftmaster.cjs); mkcraftfaces writes them only when missing
  require('./mkcraftfaces.cjs').ensure();
  const CRAFT = { craft4: 'Craft 4 px (overview)', craft5: 'Craft 5 px (overview)', craft6: 'Craft 6 px (overview)', craft8: 'Craft 8x8 (Atari native)', craft10: 'Craft 10x12', craft12: 'Craft 12x12 (master)' };
  const all = rd(path.join(root, 'font')).map((f) => {
    fs.copyFileSync(path.join(root, 'font', f), path.join(local, 'shared', f));
    return { name: f, url: 'library/fonts/local/shared/' + f, label: CRAFT[f.replace(/\.[^.]+$/, '')] };
  });
  const order = ['craft12', 'craft10', 'craft8', 'craft6', 'craft5', 'craft4'];
  const craft = all.filter((f) => f.label).sort((a, b) => order.indexOf(a.name.replace(/\.[^.]+$/, '')) - order.indexOf(b.name.replace(/\.[^.]+$/, '')));
  groups.push({ id: 'craft', label: 'Craft faces', fonts: craft });
  const shared = all.filter((f) => !f.label);
  for (const f of rd(path.join(root, 'web', 'library', 'fonts'))) shared.push({ name: f, url: 'library/fonts/' + f });
  for (const f of rd(path.join(root, 'web', 'library', 'fonts', 'atari'))) shared.push({ name: f, url: 'library/fonts/atari/' + f });
  groups.push({ id: 'shared', label: 'Shipped', fonts: shared });

  // stock Atari ROM charset: OS ROM $E000-$E3FF (offset $2000 of a 16 KB XL ROM), screen-code order
  const rom = [path.join(root, 'software_n_roms', 'ATARIXL.ROM'), path.join(root, 'roms', 'ATARIXL.ROM')].find((p) => fs.existsSync(p));
  const romFonts = [];
  if (rom) {
    const b = fs.readFileSync(rom);
    if (b.length === 16384) {
      fs.writeFileSync(path.join(local, 'atarirom.fnt'), b.subarray(0x2000, 0x2400));
      romFonts.push({ name: 'Atari ROM charset (ATASCII, 8x8)', url: 'library/fonts/local/atarirom.fnt' });
    }
  }
  groups.push({ id: 'rom', label: 'Atari ROM', fonts: romFonts });

  // the user's own fonts: font_personal/ (gitignored)
  const personal = rd(path.join(root, 'font_personal')).map((f) => {
    fs.copyFileSync(path.join(root, 'font_personal', f), path.join(local, 'personal', f));
    return { name: f, url: 'library/fonts/local/personal/' + f };
  });
  groups.push({ id: 'personal', label: 'Personal', fonts: personal });

  // fonts converted by scripts/fontpipe.cjs --install (gitignored): one entry per family, its largest size
  const conv = path.join(local, 'converted'), best = {};
  for (const f of rd(conv).filter((x) => /\.acf$/i.test(x))) {
    const m = /^(.*?)(?:-(\d+))?\.acf$/i.exec(f), s = +m[2] || 0;
    if (!best[m[1]] || s > best[m[1]].s) best[m[1]] = { s, f };
  }
  groups.push({ id: 'converted', label: 'Converted', fonts: Object.keys(best).sort().map((k) => ({ name: best[k].f, url: 'library/fonts/local/converted/' + best[k].f, label: k + (best[k].s ? ' (' + best[k].s + ' px)' : '') })) });

  fs.writeFileSync(path.join(local, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), groups }, null, 1));
  return groups;
}

if (require.main === module) {
  for (const g of build()) console.log(g.label + ': ' + g.fonts.length + ' font(s)' + (g.fonts.length ? ' - ' + g.fonts.map((f) => f.name).join(', ') : ''));
}
module.exports = { build };
