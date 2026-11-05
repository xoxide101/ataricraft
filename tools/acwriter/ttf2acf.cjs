// TTF -> ACWriter bitmap font converter (.acf), made for the ACWriter width/height steps.
// Usage: node tools/acwriter/ttf2acf.cjs <font.ttf> <out.acf> [preview.png]
// Renders ASCII 32..127 for every (pitch, height) step with Chrome's canvas, thresholds
// to 1 bit, and packs MSB-left rows.
// File: "ACF1", u8 nsizes, then per size: u8 pitch, u8 height, u8 bytesPerRow,
//       then 96 glyphs x height x bytesPerRow bytes.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const PITCH = [3, 5, 8, 10, 13, 15];
const HEIGHT = [4, 8, 12, 16, 20, 24];

(async () => {
  const [src, out, prev] = process.argv.slice(2);
  if (!src || !out) { console.log('usage: ttf2acf.cjs font.ttf out.acf [preview.png]'); process.exit(1); }
  const b64 = fs.readFileSync(src).toString('base64');
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  await p.setContent('<canvas id=c></canvas>');
  const res = await p.evaluate(async ({ b64, PITCH, HEIGHT }) => {
    const ff = new FontFace('F', 'url(data:font/ttf;base64,' + b64 + ')');
    await ff.load(); document.fonts.add(ff);
    const ref = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ref.font = '100px F';
    const m = ref.measureText('Hxg');
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    const adv = ref.measureText('n').width;
    const sizes = [];
    for (const H of HEIGHT) for (const W of PITCH) {
      const bpr = Math.ceil(W / 8);
      // Row 0..H-1 hold the cell; descenders use the bottom ~20% of it.
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      const fs = (H * 100) / (asc + desc);
      const sx = (W * 0.8) / (adv * fs / 100);
      const glyphs = [];
      for (let ch = 32; ch < 128; ch++) {
        x.clearRect(0, 0, W, H);
        x.fillStyle = '#000'; x.font = fs + 'px F'; x.textBaseline = 'alphabetic';
        x.save();
        const raw = x.measureText(String.fromCharCode(ch)).width;
        const gx = Math.min(sx, W / Math.max(raw, 0.01));
        x.translate(Math.max(0, (W - raw * gx) / 2), 0); x.scale(gx, 1);
        x.fillText(String.fromCharCode(ch), 0, (asc * fs) / 100);
        x.restore();
        const d = x.getImageData(0, 0, W, H).data;
        const rows = [];
        for (let r = 0; r < H; r++) {
          const bytes = new Array(bpr).fill(0);
          for (let q = 0; q < W; q++) if (d[(r * W + q) * 4 + 3] >= 110) bytes[q >> 3] |= 0x80 >> (q & 7);
          rows.push(...bytes);
        }
        glyphs.push(rows);
      }
      sizes.push({ W, H, bpr, glyphs });
    }
    return sizes;
  }, { b64, PITCH, HEIGHT });
  const parts = [Buffer.from('ACF1'), Buffer.from([res.length])];
  for (const s of res) {
    parts.push(Buffer.from([s.W, s.H, s.bpr]));
    for (const g of s.glyphs) parts.push(Buffer.from(g));
  }
  fs.writeFileSync(out, Buffer.concat(parts));
  console.log(path.basename(out), Buffer.concat(parts).length, 'bytes,', res.length, 'sizes');
  if (prev) {
    const rows = await p.evaluate((res) => {
      const text = 'Hamburgefonstiv 0123 Quick fox!';
      let y = 4; const W = 700;
      const c = document.createElement('canvas'); c.width = W; c.height = 700;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, 700); x.fillStyle = '#000';
      for (const s of res) {
        let px = 4;
        for (const chv of text) {
          const g = s.glyphs[chv.charCodeAt(0) - 32];
          for (let r = 0; r < s.H; r++) for (let q = 0; q < s.W; q++)
            if (g[r * s.bpr + (q >> 3)] & (0x80 >> (q & 7))) x.fillRect(px + q, y + r, 1, 1);
          px += s.W;
          if (px > W - 20) break;
        }
        y += s.H + 3;
      }
      return c.toDataURL().split(',')[1];
    }, res);
    fs.writeFileSync(prev, Buffer.from(rows, 'base64'));
  }
  await b.close();
})();
