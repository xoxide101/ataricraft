/* Image library shared by the Workbench Images tab and tools/imgtool.cjs. No DOM, so it also runs in Node.
   - detect/info: recognise PNG, GIF, BMP, JPEG, WebP, ICO, TIFF from magic bytes (headers only) and the Atari raw
     screen dumps (GR.8 / GR.9 / GR.15 "MIC", 7680 bytes) from extension plus size.
   - decode/encode: pure code for PNG (needs an inflate function for decode), BMP, GIF (decode, first frame) and the Atari
     formats. JPEG and WebP need a codec: the Workbench uses the browser canvas, the CLI uses ffmpeg when it is installed.
   - organize: group files by format. Every image is {w, h, data} with RGBA bytes. */
(function (root) {
  'use strict';
  const I = {};
  const u8 = (a) => (a instanceof Uint8Array ? a : new Uint8Array(a));
  const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const le16 = (b, o) => b[o] | (b[o + 1] << 8);
  const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const ascii = (b, o, n) => String.fromCharCode.apply(null, Array.from(b.subarray(o, o + n)));
  const ext = (name) => ((/\.([^.\\/]+)$/.exec(name || '') || [])[1] || '').toLowerCase();

  I.FORMATS = {
    png: { label: 'PNG', exts: ['png'], mime: 'image/png' },
    gif: { label: 'GIF', exts: ['gif'], mime: 'image/gif' },
    bmp: { label: 'BMP', exts: ['bmp'], mime: 'image/bmp' },
    jpg: { label: 'JPEG', exts: ['jpg', 'jpeg', 'jpe'], mime: 'image/jpeg' },
    webp: { label: 'WebP', exts: ['webp'], mime: 'image/webp' },
    ico: { label: 'ICO', exts: ['ico'], mime: 'image/x-icon' },
    tiff: { label: 'TIFF', exts: ['tif', 'tiff'], mime: 'image/tiff' },
    gr8: { label: 'Atari GR.8 (320x192, 2 shades)', exts: ['gr8', 'g8'], atari: true, w: 320, h: 192 },
    gr9: { label: 'Atari GR.9 (80x192, 16 shades)', exts: ['gr9', 'g9', 'pic'], atari: true, w: 80, h: 192 },
    gr15: { label: 'Atari GR.15 / MicroPainter (160x192, 4 colours)', exts: ['mic', 'gr15', 'g15'], atari: true, w: 160, h: 192 },
  };
  I.ATARI_SIZE = 7680;
  const byExt = {};
  Object.keys(I.FORMATS).forEach((k) => I.FORMATS[k].exts.forEach((e) => (byExt[e] = k)));
  I.formatFromExt = (name) => byExt[ext(name)] || null;

  // ---------- detect / info ----------
  I.detect = function (bytes, name) {
    const b = u8(bytes);
    if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
    if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'gif';
    if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d && le32(b, 14) >= 12) return 'bmp';
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
    if (b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4] > 0) return 'ico';
    if (b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42))) return 'tiff';
    const f = I.formatFromExt(name);
    if (f && I.FORMATS[f].atari && b.length >= I.ATARI_SIZE && b.length <= I.ATARI_SIZE + 16) return f;
    return null;
  };

  I.info = function (bytes, name) {
    const b = u8(bytes), f = I.detect(b, name);
    if (!f) return null;
    const r = { format: f, size: b.length, w: 0, h: 0 };
    if (f === 'png') { r.w = be32(b, 16); r.h = be32(b, 20); r.depth = b[24]; r.colorType = b[25]; }
    else if (f === 'gif') { r.w = le16(b, 6); r.h = le16(b, 8); }
    else if (f === 'bmp') { r.w = le32(b, 18) | 0; r.h = Math.abs(le32(b, 22) | 0); r.depth = le16(b, 28); }
    else if (f === 'jpg') {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 1 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { r.h = (b[i + 5] << 8) | b[i + 6]; r.w = (b[i + 7] << 8) | b[i + 8]; break; }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
    } else if (f === 'webp') {
      const k = ascii(b, 12, 4);
      if (k === 'VP8X') { r.w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); r.h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)); }
      else if (k === 'VP8L') { const v = le32(b, 21); r.w = (v & 0x3fff) + 1; r.h = ((v >> 14) & 0x3fff) + 1; }
      else if (k === 'VP8 ') { r.w = le16(b, 26) & 0x3fff; r.h = le16(b, 28) & 0x3fff; }
    } else if (f === 'ico') { r.w = b[6] || 256; r.h = b[7] || 256; r.count = b[4]; }
    else if (I.FORMATS[f].atari) { r.w = I.FORMATS[f].w; r.h = I.FORMATS[f].h; }
    return r;
  };

  // ---------- organize ----------
  // files: [{name, bytes}] -> {groups: {fmt: [{name, size, w, h}]}, unknown: [names]}
  I.organize = function (files) {
    const groups = {}, unknown = [];
    for (const f of files) {
      const bytes = f.bytes || f.data;
      const inf = I.info(bytes, f.name);
      if (!inf) { unknown.push(f.name); continue; }
      (groups[inf.format] = groups[inf.format] || []).push({ name: f.name, size: inf.size, w: inf.w, h: inf.h });
    }
    return { groups, unknown };
  };
  // Folder name for a format in an organized tree.
  I.folderName = (fmt) => ({ jpg: 'JPEG', gr8: 'Atari-GR8', gr9: 'Atari-GR9', gr15: 'Atari-GR15' }[fmt] || (I.FORMATS[fmt] ? I.FORMATS[fmt].label.split(' ')[0].toUpperCase() : 'Other'));

  // ---------- checksums ----------
  let crcT;
  const crc32 = (b, c) => {
    if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let k = n; for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; crcT[n] = k >>> 0; } }
    c = (c === undefined ? 0xffffffff : c);
    for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    return c;
  };
  I.crc32 = (b) => (crc32(u8(b)) ^ 0xffffffff) >>> 0;
  const adler = (b) => { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; };
  const cat = (parts) => { let n = 0; parts.forEach((p) => (n += p.length)); const o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; };
  const w32 = (v) => Uint8Array.of(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const stored = (raw) => { // zlib stream made of stored blocks (valid, just not compressed)
    const parts = [Uint8Array.of(0x78, 0x01)];
    for (let i = 0; i < raw.length || i === 0; i += 65535) {
      const n = Math.min(65535, raw.length - i), last = i + n >= raw.length ? 1 : 0;
      parts.push(Uint8Array.of(last, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255), raw.subarray(i, i + n));
      if (!raw.length) break;
    }
    parts.push(w32(adler(raw)));
    return cat(parts);
  };

  // ---------- PNG ----------
  I.encodePNG = function (img, ctx) {
    const { w, h, data } = img, raw = new Uint8Array(h * (w * 4 + 1));
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
    const z = ctx && ctx.deflate ? u8(ctx.deflate(raw)) : stored(raw);
    const chunk = (t, d) => { const tb = Uint8Array.from(t, (c) => c.charCodeAt(0)); return cat([w32(d.length), tb, d, w32((crc32(d, crc32(tb)) ^ 0xffffffff) >>> 0)]); };
    const ihdr = cat([w32(w), w32(h), Uint8Array.of(8, 6, 0, 0, 0)]);
    return cat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]);
  };

  I.decodePNG = function (bytes, ctx) {
    const b = u8(bytes);
    if (!ctx || !ctx.inflate) throw new Error('PNG decode needs an inflate function');
    let w = 0, h = 0, depth = 0, ct = 0, il = 0, pal = null, trns = null; const idat = [];
    for (let o = 8; o + 8 <= b.length;) {
      const n = be32(b, o), t = ascii(b, o + 4, 4), d = b.subarray(o + 8, o + 8 + n);
      if (t === 'IHDR') { w = be32(d, 0); h = be32(d, 4); depth = d[8]; ct = d[9]; il = d[12]; }
      else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d);
      else if (t === 'IEND') break;
      o += 12 + n;
    }
    if (il) throw new Error('Interlaced PNG is not supported');
    if (depth !== 8 && !(ct === 3 && depth <= 8) && !(ct === 0 && depth <= 8)) throw new Error('PNG bit depth ' + depth + ' is not supported');
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    if (!ch) throw new Error('Unknown PNG colour type ' + ct);
    const bpp = Math.max(1, (ch * depth) >> 3), stride = (w * ch * depth + 7) >> 3;
    const raw = u8(ctx.inflate(cat(idat))), out = new Uint8Array(h * stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[dst + x - bpp] : 0, up = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
        let v = raw[src + x];
        if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
        else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
        out[dst + x] = v & 255;
      }
    }
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = y * stride, i = (y * w + x) * 4;
      let r, g, bl, a = 255;
      if (ct === 6) { const k = o + x * 4; r = out[k]; g = out[k + 1]; bl = out[k + 2]; a = out[k + 3]; }
      else if (ct === 2) { const k = o + x * 3; r = out[k]; g = out[k + 1]; bl = out[k + 2]; }
      else if (ct === 4) { const k = o + x * 2; r = g = bl = out[k]; a = out[k + 1]; }
      else {
        const bit = x * depth, v = (out[o + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        if (ct === 3) { if (!pal) throw new Error('PNG has no palette'); r = pal[v * 3]; g = pal[v * 3 + 1]; bl = pal[v * 3 + 2]; if (trns && v < trns.length) a = trns[v]; }
        else r = g = bl = depth === 8 ? v : Math.round(v * 255 / ((1 << depth) - 1));
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = a;
    }
    return { w, h, data };
  };

  // ---------- BMP ----------
  I.encodeBMP = function (img) {
    const { w, h, data } = img, row = (w * 3 + 3) & ~3, size = 54 + row * h, o = new Uint8Array(size), dv = new DataView(o.buffer);
    o[0] = 0x42; o[1] = 0x4d; dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, row * h, true);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, d = 54 + y * row + x * 3, a = data[s + 3] / 255;
      o[d] = Math.round(data[s + 2] * a); o[d + 1] = Math.round(data[s + 1] * a); o[d + 2] = Math.round(data[s] * a);
    }
    return o;
  };
  I.decodeBMP = function (bytes) {
    const b = u8(bytes), off = le32(b, 10), hs = le32(b, 14), w = le32(b, 18) | 0, hh = le32(b, 22) | 0, depth = le16(b, 28), comp = le32(b, 30);
    if (hs < 40 || comp !== 0 && comp !== 3) throw new Error('BMP variant not supported (compressed or old header)');
    if (![8, 24, 32].includes(depth)) throw new Error('BMP depth ' + depth + ' not supported');
    const h = Math.abs(hh), top = hh < 0, row = ((w * depth + 31) >> 5) << 2, data = new Uint8Array(w * h * 4);
    const pal = 14 + hs;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = off + (top ? y : h - 1 - y) * row, i = (y * w + x) * 4;
      if (depth === 8) { const p = pal + b[s + x] * 4; data[i] = b[p + 2]; data[i + 1] = b[p + 1]; data[i + 2] = b[p]; data[i + 3] = 255; }
      else { const k = s + x * (depth >> 3); data[i] = b[k + 2]; data[i + 1] = b[k + 1]; data[i + 2] = b[k]; data[i + 3] = depth === 32 ? b[k + 3] || 255 : 255; }
    }
    return { w, h, data };
  };

  // ---------- GIF (first frame, decode only) ----------
  I.decodeGIF = function (bytes) {
    const b = u8(bytes), W = le16(b, 6), H = le16(b, 8), flags = b[10];
    let p = 13, gct = null;
    if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); gct = b.subarray(p, p + n); p += n; }
    let trans = -1;
    while (p < b.length) {
      const t = b[p++];
      if (t === 0x21) {
        const lab = b[p++];
        if (lab === 0xf9 && b[p] >= 4 && (b[p + 1] & 1)) trans = b[p + 4];
        while (b[p]) p += b[p] + 1;
        p++;
      } else if (t === 0x2c) {
        const ix = le16(b, p), iy = le16(b, p + 2), iw = le16(b, p + 4), ih = le16(b, p + 6), f = b[p + 8]; p += 9;
        let ct = gct;
        if (f & 0x80) { const n = 3 << ((f & 7) + 1); ct = b.subarray(p, p + n); p += n; }
        if (!ct) throw new Error('GIF has no colour table');
        const min = b[p++], blocks = [];
        while (b[p]) { blocks.push(b.subarray(p + 1, p + 1 + b[p])); p += b[p] + 1; }
        const lz = cat(blocks), idx = new Uint8Array(iw * ih), clear = 1 << min, end = clear + 1;
        let size = min + 1, next = end + 1, prev = -1, bits = 0, acc = 0, ip = 0, op = 0;
        const pre = new Int32Array(4096), suf = new Uint8Array(4096), stack = new Uint8Array(4097);
        for (let i = 0; i < clear; i++) suf[i] = i;
        while (op < idx.length) {
          while (bits < size && ip < lz.length) { acc |= lz[ip++] << bits; bits += 8; }
          if (bits < size) break;
          const code = acc & ((1 << size) - 1); acc >>= size; bits -= size;
          if (code === clear) { size = min + 1; next = end + 1; prev = -1; continue; }
          if (code === end) break;
          let c = code, sp = 0;
          if (prev === -1) { idx[op++] = suf[code]; prev = code; continue; }
          if (c >= next) { stack[sp++] = 0; c = prev; }
          while (c >= clear) { stack[sp++] = suf[c]; c = pre[c]; }
          stack[sp++] = suf[c];
          const first = stack[sp - 1];
          if (code >= next) stack[0] = first;
          while (sp > 0 && op < idx.length) idx[op++] = stack[--sp];
          if (next < 4096) { pre[next] = prev; suf[next] = first; next++; if (next === (1 << size) && size < 12) size++; }
          prev = code;
        }
        const data = new Uint8Array(W * H * 4);
        const rows = (f & 0x40) ? [].concat(range(0, ih, 8), range(4, ih, 8), range(2, ih, 4), range(1, ih, 2)) : range(0, ih, 1);
        rows.forEach((dy, sy) => {
          for (let x = 0; x < iw; x++) {
            const v = idx[sy * iw + x], X = ix + x, Y = iy + dy;
            if (X >= W || Y >= H) continue;
            const o = (Y * W + X) * 4;
            data[o] = ct[v * 3]; data[o + 1] = ct[v * 3 + 1]; data[o + 2] = ct[v * 3 + 2]; data[o + 3] = v === trans ? 0 : 255;
          }
        });
        return { w: W, h: H, data };
      } else if (t === 0x3b) break;
      else throw new Error('Bad GIF block');
    }
    throw new Error('GIF has no image');
  };
  const range = (s, e, st) => { const a = []; for (let i = s; i < e; i += st) a.push(i); return a; };

  // ---------- GIF encode (one frame). Exact palette up to 256 colours, otherwise a fixed 3-3-2 palette. ----------
  I.encodeGIF = function (img) {
    const { w, h, data } = img, n = w * h, idx = new Uint8Array(n), map = new Map(), pal = [];
    let exact = true, hasT = false;
    for (let i = 0; i < n && exact; i++) {
      if (data[i * 4 + 3] < 128) { hasT = true; continue; }
      const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
      if (!map.has(k)) { if (map.size >= (hasT ? 255 : 256) && true) { exact = false; break; } map.set(k, map.size); pal.push(k); }
    }
    if (exact && hasT === false) for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) { hasT = true; break; }
    if (exact && hasT && map.size > 255) exact = false;
    let tIdx = -1;
    if (exact) {
      tIdx = hasT ? pal.length : -1;
      for (let i = 0; i < n; i++) idx[i] = data[i * 4 + 3] < 128 ? tIdx : map.get((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
      if (hasT) pal.push(0);
    } else {
      pal.length = 0;
      for (let c = 0; c < 256; c++) pal.push((((c >> 5) * 255 / 7 + 0.5 | 0) << 16) | ((((c >> 2) & 7) * 255 / 7 + 0.5 | 0) << 8) | ((c & 3) * 255 / 3 + 0.5 | 0));
      if (hasT) tIdx = 0;
      for (let i = 0; i < n; i++) {
        if (hasT && data[i * 4 + 3] < 128) { idx[i] = 0; continue; }
        let v = (data[i * 4] >> 5 << 5) | (data[i * 4 + 1] >> 5 << 2) | (data[i * 4 + 2] >> 6);
        if (hasT && v === 0) v = 1;
        idx[i] = v;
      }
    }
    let bitsN = 1; while ((1 << bitsN) < pal.length) bitsN++;
    const out = [];
    const w16 = (v) => out.push(v & 255, (v >> 8) & 255);
    'GIF89a'.split('').forEach((c) => out.push(c.charCodeAt(0)));
    w16(w); w16(h); out.push(0x80 | 0x70 | (bitsN - 1), 0, 0);
    for (let i = 0; i < (1 << bitsN); i++) { const c = pal[i] || 0; out.push((c >> 16) & 255, (c >> 8) & 255, c & 255); }
    if (tIdx >= 0) out.push(0x21, 0xf9, 4, 1, 0, 0, tIdx, 0);
    out.push(0x2c); w16(0); w16(0); w16(w); w16(h); out.push(0);
    const min = Math.max(2, bitsN); out.push(min);
    const clear = 1 << min, end = clear + 1, bytes = [];
    let acc = 0, nb = 0, size = min + 1, next = end + 1, dict = new Map();
    const put = (code) => { acc |= code << nb; nb += size; while (nb >= 8) { bytes.push(acc & 255); acc >>= 8; nb -= 8; } };
    put(clear);
    let cur = idx[0];
    for (let i = 1; i < n; i++) {
      const c = idx[i], key = cur * 256 + c, hit = dict.get(key);
      if (hit !== undefined) { cur = hit; continue; }
      put(cur);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
      else { put(clear); dict = new Map(); size = min + 1; next = end + 1; }
      cur = c;
    }
    put(cur); put(end); if (nb > 0) bytes.push(acc & 255);
    for (let i = 0; i < bytes.length; i += 255) { const len = Math.min(255, bytes.length - i); out.push(len); for (let j = 0; j < len; j++) out.push(bytes[i + j]); }
    out.push(0, 0x3b);
    return new Uint8Array(out);
  };

  // ---------- Atari ----------
  // Colour registers are Atari colour bytes (hue<<4 | lum). Needs a palette: AC.buildPalette (palette.js) or opts.atariRGB.
  I.atariPalette = function (opts) {
    if (opts && opts.atariRGB) return opts.atariRGB;
    const A = root.AC;
    if (!A || !A.buildPalette) throw new Error('Atari palette not loaded (palette.js)');
    const pal = A.buildPalette((opts && opts.video) || 'ntsc', {});
    return (c) => { const v = pal[c & 254]; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; };
  };
  // Defaults: GR.15 [BAK, PF0, PF1, PF2]; GR.8 [background, foreground]; GR.9 uses one hue with 16 luminances.
  I.ATARI_DEFAULTS = { gr15: [0x00, 0x28, 0xCA, 0x94], gr8: [0x00, 0x0E], gr9hue: 0x00 };

  I.atariColors = function (fmt, opts) {
    const c = (opts && opts.colors) || null;
    if (fmt === 'gr15') return (c || I.ATARI_DEFAULTS.gr15).slice(0, 4);
    if (fmt === 'gr8') return (c || I.ATARI_DEFAULTS.gr8).slice(0, 2);
    const hue = ((opts && opts.hue !== undefined ? opts.hue : I.ATARI_DEFAULTS.gr9hue) & 15) << 4;
    return Array.from({ length: 16 }, (_, l) => hue | l);
  };

  // Raw dump -> RGBA. By default pixels are widened to a 320x192 picture so the aspect matches the TV (opts.native keeps 160 / 80).
  I.decodeAtari = function (bytes, fmt, opts) {
    const b = u8(bytes), rgb = I.atariPalette(opts), F = I.FORMATS[fmt], idx = new Uint8Array(F.w * F.h);
    if (b.length < I.ATARI_SIZE) throw new Error('Atari picture must be at least 7680 bytes');
    let cols = I.atariColors(fmt, opts);
    // MicroPainter files carry 4 colour bytes after the pixels: COLPF0, COLPF1, COLPF2, COLBAK (708-710, 712).
    if (fmt === 'gr15' && b.length >= 7684 && !(opts && (opts.colors || opts.ignoreTrailer))) cols = [b[7683], b[7680], b[7681], b[7682]];
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
      const by = b[y * 40 + (fmt === 'gr8' ? x >> 3 : fmt === 'gr15' ? x >> 2 : x >> 1)];
      idx[y * F.w + x] = fmt === 'gr8' ? (by >> (7 - (x & 7))) & 1 : fmt === 'gr15' ? (by >> (6 - 2 * (x & 3))) & 3 : (x & 1 ? by & 15 : by >> 4);
    }
    const sx = opts && opts.native ? 1 : 320 / F.w, W = F.w * sx, data = new Uint8Array(W * F.h * 4);
    for (let y = 0; y < F.h; y++) for (let x = 0; x < W; x++) {
      const [r, g, bl] = rgb(cols[idx[y * F.w + Math.floor(x / sx)]]), o = (y * W + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = 255;
    }
    return { w: W, h: F.h, data };
  };

  // Scale to w x h. fit 'contain' (default) keeps the aspect on a black background, 'stretch' fills, 'cover' crops. Area average.
  I.resize = function (img, w, h, fit) {
    fit = fit || 'contain';
    const sw = img.w, sh = img.h, out = new Uint8Array(w * h * 4);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    let dw = w, dh = h, dx = 0, dy = 0, cx = 0, cy = 0, cw = sw, ch = sh;
    if (fit === 'contain') { const s = Math.min(w / sw, h / sh); dw = Math.max(1, Math.round(sw * s)); dh = Math.max(1, Math.round(sh * s)); dx = (w - dw) >> 1; dy = (h - dh) >> 1; }
    else if (fit === 'cover') { const s = Math.max(w / sw, h / sh); cw = Math.min(sw, Math.round(w / s)); ch = Math.min(sh, Math.round(h / s)); cx = (sw - cw) >> 1; cy = (sh - ch) >> 1; }
    for (let y = 0; y < dh; y++) {
      const y0 = cy + (y * ch) / dh, y1 = cy + ((y + 1) * ch) / dh;
      for (let x = 0; x < dw; x++) {
        const x0 = cx + (x * cw) / dw, x1 = cx + ((x + 1) * cw) / dw;
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = Math.floor(y0); yy < Math.max(Math.ceil(y1), Math.floor(y0) + 1); yy++) for (let xx = Math.floor(x0); xx < Math.max(Math.ceil(x1), Math.floor(x0) + 1); xx++) {
          const s = (Math.min(sh - 1, yy) * sw + Math.min(sw - 1, xx)) * 4, al = img.data[s + 3] / 255;
          r += img.data[s] * al; g += img.data[s + 1] * al; b += img.data[s + 2] * al; a += al; n++;
        }
        const o = ((dy + y) * w + dx + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { w, h, data: out };
  };

  // RGBA -> raw Atari dump (7680 bytes). Colours come from the nearest register colour; opts.dither = Floyd-Steinberg.
  I.encodeAtari = function (img, fmt, opts) {
    opts = opts || {};
    const F = I.FORMATS[fmt], rgb = I.atariPalette(opts), cols = I.atariColors(fmt, opts), pal = cols.map(rgb);
    const aspect = fmt === 'gr9' ? 4 : fmt === 'gr15' ? 2 : 1;
    // work on a 320x192 picture first when widening is needed so a normal screenshot keeps its shape
    const src = img.w === F.w && img.h === F.h ? img : img.w === F.w * aspect && img.h === F.h ? img : I.resize(img, F.w * aspect, F.h, opts.fit);
    const work = src.w === F.w ? src : I.resize(src, F.w, F.h, 'stretch');
    const w = F.w, h = F.h, buf = new Float32Array(w * h * 3), idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { buf[i * 3] = work.data[i * 4]; buf[i * 3 + 1] = work.data[i * 4 + 1]; buf[i * 3 + 2] = work.data[i * 4 + 2]; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3; let best = 0, bd = 1e12;
      for (let k = 0; k < pal.length; k++) { const dr = buf[o] - pal[k][0], dg = buf[o + 1] - pal[k][1], db = buf[o + 2] - pal[k][2], d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db; if (d < bd) { bd = d; best = k; } }
      idx[y * w + x] = best;
      if (opts.dither) {
        for (let c = 0; c < 3; c++) {
          const e = buf[o + c] - pal[best][c];
          if (x + 1 < w) buf[o + 3 + c] += e * 7 / 16;
          if (y + 1 < h) { if (x > 0) buf[o + 3 * (w - 1) + c] += e * 3 / 16; buf[o + 3 * w + c] += e * 5 / 16; if (x + 1 < w) buf[o + 3 * (w + 1) + c] += e / 16; }
        }
      }
    }
    const out = new Uint8Array(I.ATARI_SIZE);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = idx[y * w + x];
      if (fmt === 'gr8') out[y * 40 + (x >> 3)] |= v << (7 - (x & 7));
      else if (fmt === 'gr15') out[y * 40 + (x >> 2)] |= v << (6 - 2 * (x & 3));
      else out[y * 40 + (x >> 1)] |= x & 1 ? v : v << 4;
    }
    if (opts.trailer && fmt === 'gr15') { const t = new Uint8Array(I.ATARI_SIZE + 4); t.set(out); t.set([cols[1], cols[2], cols[3], cols[0]], I.ATARI_SIZE); return t; }
    return out;
  };

  // ---------- generic decode / encode ----------
  // ctx: {inflate, deflate, atari opts, external(fmtOrBytes)} - external is used for JPEG/WebP/ICO/TIFF when supplied.
  I.decode = function (bytes, name, ctx) {
    ctx = ctx || {};
    const f = ctx.from || I.detect(bytes, name);
    if (!f) throw new Error('Unknown image format');
    if (f === 'png' && ctx.inflate) return I.decodePNG(bytes, ctx);
    if (f === 'bmp') { try { return I.decodeBMP(bytes); } catch (e) { if (!ctx.external) throw e; } }
    if (f === 'gif' && !ctx.external) return I.decodeGIF(bytes);
    if (I.FORMATS[f].atari) return I.decodeAtari(bytes, f, ctx);
    if (ctx.external) return ctx.external(bytes, f);
    throw new Error(I.FORMATS[f].label + ' needs the Workbench (browser) or ffmpeg to decode');
  };
  I.canEncode = (fmt) => ['png', 'bmp', 'gif', 'gr8', 'gr9', 'gr15'].includes(fmt);
  I.encode = function (img, fmt, ctx) {
    ctx = ctx || {};
    if (fmt === 'png') return I.encodePNG(img, ctx);
    if (fmt === 'bmp') return I.encodeBMP(img);
    if (fmt === 'gif') return I.encodeGIF(img);
    if (I.FORMATS[fmt] && I.FORMATS[fmt].atari) return I.encodeAtari(img, fmt, ctx);
    if (ctx.externalEncode) return ctx.externalEncode(img, fmt);
    throw new Error('Cannot write ' + fmt + ' here (needs the Workbench or ffmpeg)');
  };
  I.extFor = (fmt) => I.FORMATS[fmt].exts[0];

  // ---------- a small stored ZIP writer (for "download all") ----------
  I.zip = function (files) {
    const parts = [], cen = []; let off = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const nm = enc.encode(f.name), d = u8(f.bytes), c = I.crc32(d);
      const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint32(14, c, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, nm.length, true); lh.set(nm, 30);
      parts.push(lh, d);
      const ch = new Uint8Array(46 + nm.length), w = new DataView(ch.buffer);
      w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint32(16, c, true); w.setUint32(20, d.length, true); w.setUint32(24, d.length, true); w.setUint16(28, nm.length, true); w.setUint32(42, off, true); ch.set(nm, 46);
      cen.push(ch); off += lh.length + d.length;
    }
    const cs = cen.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return cat(parts.concat(cen, [end]));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = I;
  else { root.AC = root.AC || {}; root.AC.img = I; }
})(typeof window !== 'undefined' ? window : globalThis);
