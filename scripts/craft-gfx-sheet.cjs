// Contact sheet of the Craft fonts: for every size 4..26 the 32 Atari graphics, the 5 extra symbols and a sample of text, in a PNG.
// Usage: node scripts/craft-gfx-sheet.cjs  -> out/shots/fonts/craft-gfx-sheet.png
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out', 'shots', 'fonts');
const CF = require('../tools/craftfont.cjs'), AG = require('../tools/atarigfx.cjs');
fs.mkdirSync(OUT, { recursive: true });
function png(w, h, rgba) {
  const t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let r = 0xFFFFFFFF; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (ty, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(ty, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26], Z = 2, W = 1300;
const fonts = sizes.map((s) => CF.parse(fs.readFileSync(path.join(ROOT, s > 12 ? 'font' : 'web/library/fonts/acw', 'craft' + s + '.acf'))));
const lineOf = (f, codes) => codes.map((c) => ({ c, slot: f.map[c], cols: CF.colsOf(f, f.map[c]) }));
const rowsTotal = fonts.reduce((h, f) => h + 2 * (f.rows + 3), 6);
const px = new Uint32Array(W * Z * rowsTotal * Z).fill(0xFFF4F2EA);
let y0 = 3;
const dot = (x, y, col) => { for (let a = 0; a < Z; a++) for (let b = 0; b < Z; b++) px[(y * Z + a) * W * Z + x * Z + b] = col; };
for (const f of fonts) {
  const sets = [[...Array(32).keys(), 128, 129, 130, 131, 132], [...'Hamburgefonstiv Qjy 0123 .,;:!?()[]{}<>+-=*/ ABCabc'].map((c) => c.charCodeAt(0))];
  for (const codes of sets) {
    let x = 4;
    for (const g of lineOf(f, codes)) {
      const rows = f.glyphs[g.slot] || [];
      for (let r = 0; r < f.rows; r++) for (let q = 0; q < g.cols; q++) if (rows[r] !== undefined && CF.hasPx(f, rows[r], q)) dot(x + q, y0 + r, 0xFF16181C);
      x += f.adv;
    }
    y0 += f.rows + 3;
  }
}
const out = Buffer.from(px.buffer);
fs.writeFileSync(path.join(OUT, 'craft-gfx-sheet.png'), png(W * Z, rowsTotal * Z, new Uint8Array(out.buffer, out.byteOffset, out.length)));
console.log('wrote out/shots/fonts/craft-gfx-sheet.png', W * Z + 'x' + rowsTotal * Z);
