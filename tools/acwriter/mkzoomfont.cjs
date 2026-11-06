// Builds zfont.inc: the Craft 8x8 face (tools/craft8art.cjs, the same data as font/craft8.fnt) for the PAGE 2x zoom (word/zoom.inc).
// 96 glyphs, codes 32..127, 8 rows each, bit 7 = leftmost pixel. Code 127 is drawn as '?'.
// An edited face (font/overrides/zfont.acf, see tools/acwfaces.cjs) replaces the built one.
const fs = require('fs');
const acw = require('../acwfaces.cjs');
const face = acw.override('zfont', acw.baseFace('zfont'));
fs.writeFileSync(__dirname + '/zfont.inc', acw.zfontInc(face));
console.log('zfont.inc', 96 * 8, 'bytes');
