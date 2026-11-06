// EBookCraft image engine: decode -> gray -> adjust/deskew/resize -> quantize (threshold, ordered, Floyd-Steinberg, Atkinson) -> encode.
// Gray image = { w, h, g: Uint8Array (0 black .. 255 white) }. Quantized image adds { lv: Uint8Array (0..levels-1), levels }.
// Decoders: browser = anything createImageBitmap reads; Node = PNG, PGM/PPM/PBM, BMP and baseline JPEG (luma only, which is all gray output needs).
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const fromRgba = (w, h, rgba, bg = 255) => {
    const g = new Uint8Array(w * h);
    for (let i = 0, o = 0; i < g.length; i++, o += 4) {
      const a = rgba[o + 3] / 255, y = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      g[i] = Math.round(y * a + bg * (1 - a));
    }
    return { w, h, g };
  };
  const toRgba = (img) => { const o = new Uint8Array(img.w * img.h * 4); for (let i = 0; i < img.g.length; i++) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = img.g[i]; o[i * 4 + 3] = 255; } return o; };

  // ---- decoders ----
  function pnm(a) {
    const t = B.decodeText(a.subarray(0, Math.min(a.length, 64))), mg = t.slice(0, 2);
    let p = 2; const num = () => { while (/\s|#/.test(String.fromCharCode(a[p]))) { if (a[p] === 35) while (a[p] !== 10) p++; else p++; } let s = ''; while (a[p] >= 48 && a[p] <= 57) s += String.fromCharCode(a[p++]); return +s; };
    const w = num(), h = num(), g = new Uint8Array(w * h);
    if (mg === 'P1' || mg === 'P4') {
      if (mg === 'P1') { for (let i = 0; i < g.length;) { const c = a[p++]; if (c === 48) g[i++] = 255; else if (c === 49) g[i++] = 0; } }
      else { p++; const st = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = a[p + y * st + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255; }
      return { w, h, g };
    }
    const mx = num(); p++;
    const rd = mx > 255 ? (i) => a[p + i * 2] : (i) => Math.round((a[p + i] * 255) / mx);
    if (mg === 'P5') for (let i = 0; i < g.length; i++) g[i] = rd(i);
    else if (mg === 'P6') for (let i = 0; i < g.length; i++) g[i] = Math.round(0.299 * rd(i * 3) + 0.587 * rd(i * 3 + 1) + 0.114 * rd(i * 3 + 2));
    else throw new Error('unsupported PNM variant ' + mg);
    return { w, h, g };
  }
  function bmp(a) {
    const off = B.le32(a, 10), w = B.le32(a, 18) | 0, h0 = B.le32(a, 18 + 4) | 0, bpp = B.le16(a, 28), comp = B.le32(a, 30), h = Math.abs(h0), top = h0 < 0;
    if (comp !== 0 && comp !== 3) throw new Error('compressed BMP is not supported');
    const g = new Uint8Array(w * h), st = ((w * bpp + 31) >> 5) << 2, ncol = B.le32(a, 46) || (bpp <= 8 ? 1 << bpp : 0), pal = [];
    for (let i = 0; i < ncol; i++) { const o = 14 + B.le32(a, 14) + i * 4; pal.push(Math.round(0.114 * a[o] + 0.587 * a[o + 1] + 0.299 * a[o + 2])); }
    for (let y = 0; y < h; y++) {
      const row = off + (top ? y : h - 1 - y) * st;
      for (let x = 0; x < w; x++) {
        let v;
        if (bpp === 24 || bpp === 32) { const o = row + x * (bpp >> 3); v = 0.114 * a[o] + 0.587 * a[o + 1] + 0.299 * a[o + 2]; }
        else if (bpp === 8) v = pal[a[row + x]]; else if (bpp === 4) v = pal[(a[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15]; else if (bpp === 1) v = pal[(a[row + (x >> 3)] >> (7 - (x & 7))) & 1];
        else throw new Error('BMP bit depth ' + bpp + ' not supported');
        g[y * w + x] = Math.round(v);
      }
    }
    return { w, h, g };
  }

  // Baseline/extended sequential Huffman JPEG, luma only. Progressive and arithmetic coded files throw.
  const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  let COS = null;
  function jpegGray(a) {
    if (!COS) { COS = new Float32Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2; }
    const q = [], hts = {}; let w = 0, h = 0, comps = [], ri = 0, p = 2;
    const buildHt = (counts, syms) => {
      const maxc = new Int32Array(18).fill(-1), minc = new Int32Array(17), vp = new Int32Array(17); let code = 0, k = 0;
      for (let l = 1; l <= 16; l++) { vp[l] = k; minc[l] = code; code += counts[l - 1]; k += counts[l - 1]; maxc[l] = counts[l - 1] ? code - 1 : -1; code <<= 1; }
      return { maxc, minc, vp, syms };
    };
    while (p < a.length) {
      if (a[p] !== 0xff) { p++; continue; }
      const m = a[p + 1]; p += 2;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { if (m === 0xff) p--; continue; }
      const len = B.be16(a, p), seg = p + 2, end = p + len;
      if (m === 0xdb) { let o = seg; while (o < end) { const pq = a[o] >> 4, id = a[o] & 15; o++; const t = new Float32Array(64); for (let i = 0; i < 64; i++) { t[ZZ[i]] = pq ? B.be16(a, o + i * 2) : a[o + i]; } o += pq ? 128 : 64; q[id] = t; } }
      else if (m === 0xc4) { let o = seg; while (o < end) { const tc = a[o] >> 4, id = a[o] & 15, counts = a.subarray(o + 1, o + 17), n = counts.reduce((x, y) => x + y, 0); hts[tc * 4 + id] = buildHt(counts, a.subarray(o + 17, o + 17 + n)); o += 17 + n; } }
      else if (m === 0xc0 || m === 0xc1) { h = B.be16(a, seg + 1); w = B.be16(a, seg + 3); const n = a[seg + 5]; comps = []; for (let i = 0; i < n; i++) comps.push({ id: a[seg + 6 + i * 3], h: a[seg + 7 + i * 3] >> 4, v: a[seg + 7 + i * 3] & 15, tq: a[seg + 8 + i * 3], pred: 0 }); }
      else if (m === 0xc2 || m === 0xc3 || (m >= 0xc5 && m <= 0xcf && m !== 0xc8 && m !== 0xcc && m !== 0xc4)) throw new Error('progressive/lossless/arithmetic JPEG is not supported in Node; use the browser or save the scan as baseline JPEG/PNG');
      else if (m === 0xdd) ri = B.be16(a, seg);
      else if (m === 0xda) {
        const ns = a[seg]; for (let i = 0; i < ns; i++) { const c = comps.find((x) => x.id === a[seg + 1 + i * 2]); c.dc = hts[a[seg + 2 + i * 2] >> 4]; c.ac = hts[4 + (a[seg + 2 + i * 2] & 15)]; }
        p = end; return decodeScan();
      }
      p = end;
    }
    throw new Error('JPEG: no image data');
    function decodeScan() {
      const hmax = Math.max(...comps.map((c) => c.h)), vmax = Math.max(...comps.map((c) => c.v)), mw = Math.ceil(w / (8 * hmax)), mh = Math.ceil(h / (8 * vmax));
      const Y = comps[0], yw = mw * Y.h * 8, yh = mh * Y.v * 8, plane = new Uint8ClampedArray(yw * yh);
      let bits = 0, nb = 0, pos = p;
      const bit = () => {
        if (!nb) { let b = a[pos++]; if (b === 0xff) { const n = a[pos]; if (n === 0) pos++; else { pos--; return 0; } } bits = b === undefined ? 0 : b; nb = 8; }
        nb--; return (bits >> nb) & 1;
      };
      const rcv = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
      const ext = (v, n) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
      const huff = (t) => { let code = 0; for (let l = 1; l <= 16; l++) { code = (code << 1) | bit(); if (t.maxc[l] >= 0 && code <= t.maxc[l] && code >= t.minc[l]) return t.syms[t.vp[l] + code - t.minc[l]]; } return 0; };
      const blk = new Float32Array(64), tmp = new Float32Array(64);
      let cnt = 0;
      for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
        if (ri && cnt && cnt % ri === 0) { nb = 0; while (pos < a.length && !(a[pos] === 0xff && a[pos + 1] >= 0xd0 && a[pos + 1] <= 0xd7)) pos++; pos += 2; for (const c of comps) c.pred = 0; }
        cnt++;
        for (let ci = 0; ci < comps.length; ci++) {
          const c = comps[ci];
          for (let by = 0; by < c.v; by++) for (let bx = 0; bx < c.h; bx++) {
            blk.fill(0);
            const s = huff(c.dc); c.pred += ext(rcv(s), s); blk[0] = c.pred * q[c.tq][0];
            for (let k = 1; k < 64;) { const rs = huff(c.ac), r = rs >> 4, sz = rs & 15; if (!sz) { if (r === 15) { k += 16; continue; } break; } k += r; if (k > 63) break; blk[ZZ[k]] = ext(rcv(sz), sz) * q[c.tq][ZZ[k]]; k++; }
            if (ci) continue;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let v = 0; for (let u = 0; u < 8; u++) v += COS[x * 8 + u] * blk[y * 8 + u]; tmp[y * 8 + x] = v; }
            const ox = (mx * c.h + bx) * 8, oy = (my * c.v + by) * 8;
            for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let v = 0; for (let u = 0; u < 8; u++) v += COS[y * 8 + u] * tmp[u * 8 + x]; plane[(oy + y) * yw + ox + x] = v + 128; }
          }
        }
      }
      const g = new Uint8Array(w * h);
      const sx = Y.h === hmax ? 1 : hmax / Y.h, sy = Y.v === vmax ? 1 : vmax / Y.v;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = plane[Math.floor(y / sy) * yw + Math.floor(x / sx)];
      return { w, h, g };
    }
  }

  async function browserDecode(bytes) {
    const bmpd = await createImageBitmap(new Blob([bytes]));
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmpd.width, bmpd.height) : Object.assign(document.createElement('canvas'), { width: bmpd.width, height: bmpd.height });
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmpd, 0, 0);
    const d = cx.getImageData(0, 0, bmpd.width, bmpd.height);
    return fromRgba(d.width, d.height, d.data);
  }
  // bytes -> gray image
  async function decode(bytes, name) {
    const a = B.u8(bytes);
    if (!B.isNode) return browserDecode(a);
    if (B.be32(a, 0) === 0x89504e47) { const r = await B.pngDecode(a); return fromRgba(r.w, r.h, r.rgba); }
    if (a[0] === 0x50 && a[1] >= 0x31 && a[1] <= 0x36) return pnm(a);
    if (a[0] === 0x42 && a[1] === 0x4d) return bmp(a);
    if (a[0] === 0xff && a[1] === 0xd8) return jpegGray(a);
    throw new Error('Unsupported image format for ' + (name || 'data') + ' (Node reads PNG, JPEG baseline, BMP, PNM; the browser reads anything it can display)');
  }
  const decodeJpeg = async (a) => { const r = jpegGray(B.u8(a)); return { w: r.w, h: r.h, rgba: toRgba(r) }; };

  // ---- tone adjustments ----
  function otsu(g) {
    const hist = new Float64Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
    return th;
  }
  // opt: { brightness -100..100, contrast -100..100, gamma (1 = none), auto: stretch 1%..99% to full range, flatten: divide by blurred background (uneven scans) }
  function adjust(img, opt = {}) {
    const g = img.g, out = new Uint8Array(g.length);
    let lo = 0, hi = 255;
    if (opt.auto) {
      const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
      const cut = g.length * 0.01; let s = 0; for (lo = 0; lo < 255; lo++) { s += hist[lo]; if (s > cut) break; }
      s = 0; for (hi = 255; hi > 0; hi--) { s += hist[hi]; if (s > cut) break; }
      if (hi - lo < 16) { lo = 0; hi = 255; }
    }
    const c = opt.contrast || 0, f = (259 * (c + 255)) / (255 * (259 - c)), br = opt.brightness || 0, gam = opt.gamma || 1, lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let x = clamp(((v - lo) * 255) / (hi - lo), 0, 255);
      if (gam !== 1) x = 255 * Math.pow(x / 255, 1 / gam);
      lut[v] = clamp(Math.round(f * (x - 128) + 128 + br * 2.55), 0, 255);
    }
    let src = g;
    if (opt.flatten) src = flatten(img);
    for (let i = 0; i < g.length; i++) out[i] = lut[src[i]];
    return { w: img.w, h: img.h, g: out };
  }
  // remove uneven lighting: divide by a heavily blurred copy (box blur on a 1/8 scale)
  function flatten(img) {
    const s = 8, sw = Math.max(1, Math.ceil(img.w / s)), sh = Math.max(1, Math.ceil(img.h / s)), small = resize(img, sw, sh), r = Math.max(2, Math.round(Math.min(sw, sh) / 12));
    const blur = (src, w, h, horizontal) => {
      const o = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let t = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k; if (xx >= 0 && xx < w && yy >= 0 && yy < h) { t += src[yy * w + xx]; n++; } } o[y * w + x] = t / n; }
      return o;
    };
    // background = local maximum-ish: blur of a max-filtered image keeps text from darkening the estimate
    const mx = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let m = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < sw && yy >= 0 && yy < sh) m = Math.max(m, small.g[yy * sw + xx]); } mx[y * sw + x] = m; }
    const bg = blur(blur(mx, sw, sh, true), sw, sh, false), out = new Uint8Array(img.g.length);
    for (let y = 0; y < img.h; y++) {
      const fy = clamp(y / s - 0.5, 0, sh - 1), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < img.w; x++) {
        const fx = clamp(x / s - 0.5, 0, sw - 1), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        const b = (bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x1] * tx) * (1 - ty) + (bg[y1 * sw + x0] * (1 - tx) + bg[y1 * sw + x1] * tx) * ty;
        out[y * img.w + x] = clamp(Math.round((img.g[y * img.w + x] * 255) / Math.max(b, 32)), 0, 255);
      }
    }
    return out;
  }

  // ---- geometry ----
  function resize(img, nw, nh) {
    nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
    if (nw === img.w && nh === img.h) return { w: nw, h: nh, g: img.g.slice() };
    const pass = (src, sw, sh, dw, dh, horiz) => {
      const out = new Float32Array(dw * dh), sl = horiz ? sw : sh, dl = horiz ? dw : dh, k = sl / dl, lines = horiz ? sh : sw;
      for (let d = 0; d < dl; d++) {
        let a0, a1;
        if (k > 1) { a0 = d * k; a1 = (d + 1) * k; } else { const c = (d + 0.5) * k - 0.5; a0 = Math.floor(clamp(c, 0, sl - 1)); a1 = null; }
        for (let l = 0; l < lines; l++) {
          let v;
          if (k > 1) {
            let t = 0, tw = 0; const i0 = Math.floor(a0), i1 = Math.min(sl - 1, Math.ceil(a1) - 1);
            for (let i = i0; i <= i1; i++) { const wt = Math.min(a1, i + 1) - Math.max(a0, i); const sv = horiz ? src[l * sw + i] : src[i * sw + l]; t += sv * wt; tw += wt; }
            v = t / tw;
          } else {
            const c = clamp((d + 0.5) * k - 0.5, 0, sl - 1), i0 = Math.floor(c), i1 = Math.min(sl - 1, i0 + 1), tt = c - i0;
            const s0 = horiz ? src[l * sw + i0] : src[i0 * sw + l], s1 = horiz ? src[l * sw + i1] : src[i1 * sw + l];
            v = s0 * (1 - tt) + s1 * tt;
          }
          if (horiz) out[l * dw + d] = v; else out[d * dw + l] = v;
        }
      }
      return out;
    };
    const t1 = pass(img.g, img.w, img.h, nw, img.h, true), t2 = pass(t1, nw, img.h, nw, nh, false), g = new Uint8Array(nw * nh);
    for (let i = 0; i < g.length; i++) g[i] = clamp(Math.round(t2[i]), 0, 255);
    return { w: nw, h: nh, g };
  }
  // contain: whole image inside W x H, padded with bg; cover: fills and crops; stretch: ignores aspect
  function fit(img, W, H, opt = {}) {
    const mode = opt.mode || 'contain', bg = opt.bg === undefined ? 255 : opt.bg;
    if (mode === 'stretch') return resize(img, W, H);
    const s = mode === 'cover' ? Math.max(W / img.w, H / img.h) : Math.min(W / img.w, H / img.h), nw = Math.max(1, Math.round(img.w * s)), nh = Math.max(1, Math.round(img.h * s));
    const r = resize(img, nw, nh), out = new Uint8Array(W * H).fill(bg), ox = Math.floor((W - nw) / 2), oy = Math.floor((H - nh) / 2);
    for (let y = 0; y < H; y++) { const sy = y - oy; if (sy < 0 || sy >= nh) continue; for (let x = 0; x < W; x++) { const sx = x - ox; if (sx >= 0 && sx < nw) out[y * W + x] = r.g[sy * nw + sx]; } }
    return { w: W, h: H, g: out };
  }
  // Slice an image into W x H screens in reading order (left to right, top to bottom); the last row/column is padded with bg.
  function tiles(img, W, H, bg = 255) {
    const cols = Math.ceil(img.w / W), rows = Math.ceil(img.h / H), list = [];
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const g = new Uint8Array(W * H).fill(bg);
      for (let y = 0; y < H && ty * H + y < img.h; y++) for (let x = 0; x < W && tx * W + x < img.w; x++) g[y * W + x] = img.g[(ty * H + y) * img.w + tx * W + x];
      list.push({ w: W, h: H, g, tx, ty });
    }
    return { cols, rows, tiles: list };
  }
  function rotate(img, deg, bg = 255) {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = img.w / 2, cy = img.h / 2, out = new Uint8Array(img.g.length).fill(bg), w = img.w, h = img.h, g = img.g;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = c * (x - cx) + s * (y - cy) + cx, sy = -s * (x - cx) + c * (y - cy) + cy;
      if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) continue;
      const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, i = y0 * w + x0;
      out[y * w + x] = Math.round((g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + w] * (1 - tx) + g[i + w + 1] * tx) * ty);
    }
    return { w, h, g: out };
  }
  // Projection-profile skew estimate (degrees, positive = page text runs downhill to the right). maxDeg search range.
  function skewAngle(img, maxDeg = 6) {
    const f = Math.max(1, Math.floor(Math.max(img.w, img.h) / 700)), small = f > 1 ? resize(img, Math.ceil(img.w / f), Math.ceil(img.h / f)) : img, th = Math.min(otsu(small.g), 200);
    const pts = []; for (let y = 0; y < small.h; y++) for (let x = 0; x < small.w; x++) if (small.g[y * small.w + x] < th) pts.push(x, y);
    if (pts.length < 200) return 0;
    const step = Math.max(2, Math.floor(pts.length / 2 / 40000)) * 2, score = (deg) => {
      const r = (deg * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r), bins = new Int32Array(small.h + small.w + 4), off = small.w + 2;
      for (let i = 0; i < pts.length; i += step) bins[Math.round(pts[i + 1] * c - pts[i] * s) + off]++;
      let t = 0; for (let i = 0; i < bins.length; i++) t += bins[i] * bins[i]; return t;
    };
    let best = 0, bs = -1;
    for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) { const v = score(d); if (v > bs) { bs = v; best = d; } }
    const c0 = best; for (let d = c0 - 0.5; d <= c0 + 0.5 + 1e-9; d += 0.1) { const v = score(d); if (v > bs) { bs = v; best = d; } }
    return Math.round(best * 10) / 10;
  }
  function deskew(img, maxDeg = 6) { const a = skewAngle(img, maxDeg); return { img: Math.abs(a) < 0.2 ? img : rotate(img, a), angle: a }; }
  function autocrop(img, margin = 8, th) {
    th = th === undefined ? Math.min(otsu(img.g), 200) : th;
    let x0 = img.w, x1 = -1, y0 = img.h, y1 = -1;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.g[y * img.w + x] < th) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return img;
    x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin); x1 = Math.min(img.w - 1, x1 + margin); y1 = Math.min(img.h - 1, y1 + margin);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) g.set(img.g.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
    return { w, h, g };
  }

  // ---- quantize / dither ----
  const DITHERS = ['threshold', 'bayer4', 'bayer8', 'floyd', 'atkinson'];
  const BAYER = (n) => { let m = [[0]]; while (m.length < n) { const k = m.length, o = []; for (let y = 0; y < 2 * k; y++) { o.push([]); for (let x = 0; x < 2 * k; x++) o[y].push(4 * m[y % k][x % k] + [[0, 2], [3, 1]][Math.floor(y / k)][Math.floor(x / k)]); } m = o; } return m; };
  const B4 = BAYER(4), B8 = BAYER(8);
  // levels 2..256. method: threshold | bayer4 | bayer8 | floyd | atkinson. threshold (0-255 or 'otsu') only for levels = 2 with method threshold.
  function quantize(img, opt = {}) {
    const L = clamp(Math.round(opt.levels || 2), 2, 256), method = opt.method || 'floyd', { w, h } = img, step = 255 / (L - 1), lv = new Uint8Array(w * h);
    const near = (v) => clamp(Math.round(v / step), 0, L - 1);
    if (method === 'threshold') {
      let th = opt.threshold === undefined || opt.threshold === 'otsu' ? (L === 2 ? otsu(img.g) : null) : opt.threshold;
      for (let i = 0; i < lv.length; i++) lv[i] = L === 2 ? (img.g[i] > th ? 1 : 0) : near(img.g[i]);
    } else if (method === 'bayer4' || method === 'bayer8') {
      const M = method === 'bayer4' ? B4 : B8, n = M.length, nn = n * n;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lv[y * w + x] = near(img.g[y * w + x] + ((M[y % n][x % n] + 0.5) / nn - 0.5) * step);
    } else {
      const e = Float32Array.from(img.g), atk = method === 'atkinson';
      for (let y = 0; y < h; y++) {
        const ltr = atk || !(y & 1);
        for (let k = 0; k < w; k++) {
          const x = ltr ? k : w - 1 - k, i = y * w + x, old = e[i], q = near(old), err = old - q * step, d = ltr ? 1 : -1;
          lv[i] = q;
          const add = (xx, yy, f) => { if (xx >= 0 && xx < w && yy < h) e[yy * w + xx] += err * f; };
          if (atk) { const f = 1 / 8; add(x + 1, y, f); add(x + 2, y, f); add(x - 1, y + 1, f); add(x, y + 1, f); add(x + 1, y + 1, f); add(x, y + 2, f); }
          else { add(x + d, y, 7 / 16); add(x - d, y + 1, 3 / 16); add(x, y + 1, 5 / 16); add(x + d, y + 1, 1 / 16); }
        }
      }
    }
    const g = new Uint8Array(w * h); for (let i = 0; i < g.length; i++) g[i] = Math.round(lv[i] * step);
    return { w, h, g, lv, levels: L };
  }

  // ---- encoders ----
  const pbm = (q) => { // P4; ink (dark) = 1
    const st = (q.w + 7) >> 3, hd = B.enc('P4\n' + q.w + ' ' + q.h + '\n'), out = new Uint8Array(hd.length + st * q.h); out.set(hd);
    for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) if (q.g[y * q.w + x] < 128) out[hd.length + y * st + (x >> 3)] |= 0x80 >> (x & 7);
    return out;
  };
  const pgm = (q) => { const hd = B.enc('P5\n' + q.w + ' ' + q.h + '\n255\n'), out = new Uint8Array(hd.length + q.g.length); out.set(hd); out.set(q.g, hd.length); return out; };
  const png = (q, text) => B.pngEncodeGray(q.w, q.h, q.g, q.levels ? (q.levels <= 2 ? 1 : q.levels <= 4 ? 2 : q.levels <= 16 ? 4 : 8) : 8, text || 'EBookCraft');

  EBC.image = { flatten, fromRgba, toRgba, decode, decodeJpeg, jpegGray, adjust, otsu, resize, fit, tiles, rotate, skewAngle, deskew, autocrop, quantize, DITHERS, pbm, pgm, png };
  if (typeof module !== 'undefined' && module.exports) module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
