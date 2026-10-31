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

  // Frame preview: the strip down the left and right edges, turned 90 degrees along the top and bottom. A guess at how Print Shop lays a border out.
  function borderFrame(d) {
    const n = d.length, bp = borderPixels(d).px, px = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0;
      if (x < 8) v = bp[y * 8 + x];
      else if (x >= n - 8) v = bp[y * 8 + (n - 1 - x)];
      if (y < 8) v = bp[x * 8 + y];
      else if (y >= n - 8) v = bp[x * 8 + (n - 1 - y)];
      px[y * n + x] = v;
    }
    return { px, w: n, h: n };
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

  // Font (FO.*): per-character height table, then lo/hi byte tables of glyph pointers (relative to the load address).
  // Glyph k is character 32+k, stored as rows of ceil(width/8) bytes.
  function fontGlyphsF(d, addr) {
    const N = 59; if (d.length < 4 * N) return null;
    const out = []; let ok = 0, tot = 0;
    for (let k = 0; k < N; k++) {
      const w = d[k], h = d[N + k], p = (d[2 * N + k] | (d[3 * N + k] << 8)) - addr;
      if (!w || !h || w > 64 || h > 64) { out.push({ ch: String.fromCharCode(32 + k), w: 8, h: 1, px: new Uint8Array(8) }); continue; }
      const bpr = Math.ceil(w / 8); tot++;
      if (p < 4 * N || p + bpr * h > d.length) { out.push({ ch: String.fromCharCode(32 + k), w: bpr * 8, h, px: new Uint8Array(bpr * 8 * h) }); continue; }
      ok++;
      const px = new Uint8Array(bpr * 8 * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < bpr * 8; x++) px[y * bpr * 8 + x] = (d[p + y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1;
      out.push({ ch: String.fromCharCode(32 + k), w: bpr * 8, h, px, pw: w });
    }
    return tot >= 40 && ok >= tot * 0.9 ? out : null;
  }
  function fontGlyphs(d, addr) {
    const f = fontGlyphsF(d, addr); if (f) return f;
    let best = null;
    for (let S = 0x40; S < 0xa0; S++) for (let N = 55; N <= 70; N++) {
      const H = S + N; if (H + N > d.length) continue;
      let bad = 0, prev = -1, fit = 0;
      for (let k = 1; k < N; k++) {
        const p = d[S + k] | (d[H + k] << 8); if (!p) continue;
        if (p < prev || p - prev > 200) bad++;
        const h = d[S - N + k - 1], df = p - prev; if (prev > 0 && h && df > 0 && df % h === 0) fit++;
        prev = p;
      }
      if (!best || bad < best.bad || (bad === best.bad && fit > best.fit)) best = { bad, fit, S, N, H };
    }
    if (!best || best.bad > 6) return null;
    const ptr = [];
    for (let k = 0; k < best.N; k++) ptr.push(((d[best.S + k] | (d[best.H + k] << 8)) - addr));
    const out = [];
    for (let k = 1; k < best.N; k++) {
      const p = ptr[k], h = d[best.S - best.N + k];
      if (!h || p <= 0 || p >= d.length) continue;
      let nx = d.length; for (let j = k + 1; j < best.N; j++) if (ptr[j] > p && ptr[j] <= d.length) { nx = ptr[j]; break; }
      const bpr = Math.max(1, Math.min(8, Math.round((nx - p) / h)));
      const px = new Uint8Array(bpr * 8 * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < bpr * 8; x++) px[y * bpr * 8 + x] = ((d[p + y * bpr + (x >> 3)] || 0) >> (7 - (x & 7))) & 1;
      out.push({ ch: String.fromCharCode(32 + k), w: bpr * 8, h, px });
    }
    return out;
  }
  function fontSheet(gl, scale) {
    const cols = 12, cw = (Math.max(...gl.map((o) => o.w)) + 4) * scale, ch = (Math.max(...gl.map((o) => o.h)) + 4) * scale;
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = Math.ceil(gl.length / cols) * ch;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    gl.forEach((o, i) => g.drawImage(canvasOf(o.px, o.w, o.h, scale), (i % cols) * cw + 2, Math.floor(i / cols) * ch + 2));
    return c;
  }

  // Standard Atari graphics files, chosen by extension and size.
  //   MIC / PIC / GR15 : 160x192, 2 bits per pixel (4 colours), 40 bytes per line, optional 4 trailing colour bytes
  //   GR8 / G8         : 320x192, 1 bit per pixel, 40 bytes per line
  //   FNT / CHR / SET  : 1024-byte (or 512) character set, 8 bytes per character
  // An optional $FFFF binary-load header is skipped.
  const PICEXT = /\.(mic|pic|gr15|gr8|g8|g15|fnt|chr|set)$/i;
  function atariColor(c) {
    const hue = c >> 4, lum = c & 15;
    if (!hue) { const v = Math.round(lum * 255 / 15); return [v, v, v]; }
    const a = ((hue - 1) / 15) * 2 * Math.PI + 0.35, y = 0.12 + lum / 15 * 0.85;
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return [cl(y + 0.956 * 0.28 * Math.cos(a) + 0.621 * 0.28 * Math.sin(a)), cl(y - 0.272 * 0.28 * Math.cos(a) - 0.647 * 0.28 * Math.sin(a)), cl(y - 1.106 * 0.28 * Math.cos(a) + 1.703 * 0.28 * Math.sin(a))];
  }
  function decodePic(name, d) {
    if (!PICEXT.test(name)) return null;
    let o = 0; if (d.length > 6 && d[0] === 0xff && d[1] === 0xff) o = 6;
    const n = d.length - o, ext = name.match(PICEXT)[1].toLowerCase();
    if (/^(fnt|chr|set)$/.test(ext)) {
      if (n < 512) return null;
      const cnt = n >= 1024 ? 128 : 64, w = 16 * 8, h = Math.ceil(cnt / 16) * 8, px = new Uint8Array(w * h);
      for (let k = 0; k < cnt; k++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
        px[((k >> 4) * 8 + y) * w + (k & 15) * 8 + x] = (d[o + k * 8 + y] >> (7 - x)) & 1;
      return { px, w, h, pal: [[255, 255, 255], [0, 0, 0]], info: cnt + ' characters of 8x8' };
    }
    if (n < 7680) return null;
    if (/^(gr8|g8)$/.test(ext)) {
      const px = new Uint8Array(320 * 192);
      for (let y = 0; y < 192; y++) for (let x = 0; x < 320; x++) px[y * 320 + x] = (d[o + y * 40 + (x >> 3)] >> (7 - (x & 7))) & 1;
      return { px, w: 320, h: 192, pal: [[255, 255, 255], [0, 0, 0]], info: '320x192, 1 bit per pixel' };
    }
    const c = n >= 7684 ? [d[o + 7680], d[o + 7681], d[o + 7682], d[o + 7683]] : [0x28, 0xca, 0x94, 0x00];
    const pal = [atariColor(c[3]), atariColor(c[0]), atariColor(c[1]), atariColor(c[2])];
    const px = new Uint8Array(160 * 192);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 160; x++) px[y * 160 + x] = (d[o + y * 40 + (x >> 2)] >> (6 - (x & 3) * 2)) & 3;
    return { px, w: 160, h: 192, pal, aspect: 2, info: '160x192, 4 colours' + (n >= 7684 ? ' (colour bytes $' + c.map((v) => v.toString(16).padStart(2, '0')).join(' $') + ')' : ' (no colour bytes, default palette)') };
  }
  function picCanvas(pic, scale) {
    const sx = scale * (pic.aspect || 1), c = document.createElement('canvas'); c.width = pic.w * sx; c.height = pic.h * scale;
    const g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const v = pic.pal[pic.px[((y / scale) | 0) * pic.w + ((x / sx) | 0)]], i = (y * c.width + x) * 4;
      img.data[i] = v[0]; img.data[i + 1] = v[1]; img.data[i + 2] = v[2]; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); return c;
  }

  return { parse, read, gfxPixels, borderPixels, borderFrame, canvasOf, png, sheet, fontGlyphs, fontGlyphsF, fontSheet, decodePic, picCanvas, PICEXT, GW, GH };
});
