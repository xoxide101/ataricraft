// Print Shop (Broderbund / Atari 8-bit) data disks: reader for the custom directory used by the graphics, icon and program disks.
// Layout (found by inspecting the disks):
//   sector 361 starts "PRINT SHOP:CLK!"; sectors 361-368 hold 32-byte directory entries:
//     name (16, space padded) | first sector (2, LE) | load address (2, LE) | length (2, LE) | zeros
//   each file is a chain of 128-byte sectors: 126 data bytes + 2-byte LE number of the next sector (0 = last)
//   a graphic is 88 x 52 pixels, 1 bit per pixel, MSB first, 11 bytes per row (572 bytes; the file is 572 or 576 long)
//   a border (BO.*) is a tiled strip 8 pixels wide, 1 byte per row; fonts (FO.*) are variable-length tables (extracted raw)
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.PrintShop = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const GW = 88, GH = 52;
  const sector = (b, n) => b.subarray(16 + (n - 1) * 128, 16 + n * 128);

  function parse(b) {
    if (!b || b.length < 16 + 369 * 128 || b[0] !== 0x96 || b[1] !== 0x02 || (b[4] | (b[5] << 8)) !== 128) return null;
    const nsec = Math.floor((b.length - 16) / 128), head = sector(b, 361);
    if (String.fromCharCode(...head.subarray(0, 10)) !== 'PRINT SHOP') return null;
    const entries = [];
    for (let n = 361; n <= 368; n++) {
      const s = sector(b, n);
      for (let k = 0; k < 128; k += 32) {
        if (n === 361 && k === 0) continue;
        const e = s.subarray(k, k + 32);
        if (e[0] === 0 || e[0] === 0xff) continue;
        let name = '', ok = true;
        for (let i = 0; i < 16; i++) { const c = e[i]; if (c < 32 || c > 126) { ok = false; break; } name += String.fromCharCode(c); }
        const start = e[16] | (e[17] << 8), addr = e[18] | (e[19] << 8), len = e[20] | (e[21] << 8);
        if (!ok || !len || start < 1 || start > nsec) continue;
        name = name.trimEnd();
        const kind = /^FO\./.test(name) ? 'font' : /^BO\./.test(name) ? 'border' : len >= 572 && len <= 576 ? 'graphic' : 'data';
        entries.push({ name, start, addr, len, kind });
      }
    }
    return { entries, nsec };
  }

  // Follows the sector chain; returns {data, short} (short = the chain ended before the directory length).
  function read(b, e) {
    const out = new Uint8Array(e.len), seen = new Set();
    let n = e.start, got = 0;
    while (n && got < e.len && n <= Math.floor((b.length - 16) / 128) && !seen.has(n)) {
      seen.add(n);
      const s = sector(b, n), take = Math.min(126, e.len - got);
      out.set(s.subarray(0, take), got); got += take;
      n = s[126] | (s[127] << 8);
    }
    return { data: out, short: got < e.len };
  }

  // 1 = black pixel
  function gfxPixels(d) {
    const px = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) px[y * GW + x] = (d[y * 11 + (x >> 3)] >> (7 - (x & 7))) & 1;
    return px;
  }
  function borderPixels(d) {
    const h = d.length, px = new Uint8Array(8 * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) px[y * 8 + x] = (d[y] >> (7 - x)) & 1;
    return { px, w: 8, h };
  }

  function canvasOf(px, w, h, scale) {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const v = px[((y / scale) | 0) * w + ((x / scale) | 0)] ? 0 : 255, o = (y * c.width + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); return c;
  }
  const png = (c) => new Promise((res) => c.toBlob(async (bl) => res(new Uint8Array(await bl.arrayBuffer())), 'image/png'));

  // Several graphics on one sheet with their names underneath.
  function sheet(items, scale, cols) {
    const cw = GW * scale + 8, ch = GH * scale + 22, rows = Math.ceil(items.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.font = '12px sans-serif'; g.fillStyle = '#000'; g.textAlign = 'center';
    items.forEach((it, i) => {
      const x = (i % cols) * cw + 4, y = Math.floor(i / cols) * ch + 2;
      g.drawImage(canvasOf(it.px, GW, GH, scale), x, y);
      g.strokeStyle = '#999'; g.strokeRect(x - 0.5, y - 0.5, GW * scale + 1, GH * scale + 1);
      g.fillText(it.name.slice(0, 18), x + (GW * scale) / 2, y + GH * scale + 15);
    });
    return c;
  }

  return { parse, read, gfxPixels, borderPixels, canvasOf, png, sheet, GW, GH };
});
