// EBookCraft base layer: byte helpers, zip read/write, inflate/deflate, text decoding, HTML/XML tokenizer, PNG codec.
// Same file runs in the browser (script tag -> window.EBC.base) and in Node (require('./index.js')). DOM-free.
// All compression goes through zlib (Node) or DecompressionStream/CompressionStream (browsers), so every call is async.
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
  const zlib = isNode ? require('zlib') : null;

  const u8 = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
  const concat = (list) => {
    const out = new Uint8Array(list.reduce((n, a) => n + a.length, 0)); let o = 0;
    for (const a of list) { out.set(a, o); o += a.length; }
    return out;
  };
  const enc = (s) => new TextEncoder().encode(s);
  const le16 = (a, o) => a[o] | (a[o + 1] << 8);
  const le32 = (a, o) => (a[o] | (a[o + 1] << 8) | (a[o + 2] << 16) | (a[o + 3] << 24)) >>> 0;
  const be16 = (a, o) => (a[o] << 8) | a[o + 1];
  const be32 = (a, o) => ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0;

  let CRC = null;
  function crc32(a, c = 0) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; CRC[n] = v >>> 0; } }
    c = ~c >>> 0;
    for (let i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  }

  async function pipe(a, ctor, fmt) {
    const s = new Blob([a]).stream().pipeThrough(new ctor(fmt));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  // format: 'raw' (zip entries), 'zlib' (PDF/PNG streams)
  async function inflate(a, format = 'raw') {
    a = u8(a);
    if (isNode) return new Uint8Array(format === 'raw' ? zlib.inflateRawSync(a) : zlib.inflateSync(a));
    return pipe(a, DecompressionStream, format === 'raw' ? 'deflate-raw' : 'deflate');
  }
  async function deflate(a, format = 'raw') {
    a = u8(a);
    if (isNode) return new Uint8Array(format === 'raw' ? zlib.deflateRawSync(a, { level: 9 }) : zlib.deflateSync(a, { level: 9 }));
    return pipe(a, CompressionStream, format === 'raw' ? 'deflate-raw' : 'deflate');
  }
  // PDF streams are sometimes damaged; keep what inflates (Node only, where partial output is available)
  async function inflateLoose(a) {
    try { return await inflate(a, 'zlib'); } catch (e) {
      if (!isNode) throw e;
      try { return new Uint8Array(zlib.inflateSync(u8(a), { finishFlush: zlib.constants.Z_SYNC_FLUSH })); } catch (e2) { throw e; }
    }
  }

  // ---- zip ----
  async function zipRead(buf) {
    const a = u8(buf);
    let e = -1;
    for (let i = a.length - 22; i >= Math.max(0, a.length - 22 - 65557); i--) if (le32(a, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end-of-central-directory record)');
    const n = le16(a, e + 10); let p = le32(a, e + 16);
    const entries = new Map();
    for (let k = 0; k < n; k++) {
      if (le32(a, p) !== 0x02014b50) throw new Error('zip: bad central directory');
      const flags = le16(a, p + 8), method = le16(a, p + 10), csize = le32(a, p + 20), usize = le32(a, p + 24);
      const nl = le16(a, p + 28), el = le16(a, p + 30), cl = le16(a, p + 32), off = le32(a, p + 42);
      const name = new TextDecoder('utf-8').decode(a.subarray(p + 46, p + 46 + nl));
      entries.set(name, { name, method, csize, usize, off, flags, dir: name.endsWith('/') });
      p += 46 + nl + el + cl;
    }
    const get = async (name) => {
      const en = entries.get(name);
      if (!en) throw new Error('zip: no entry ' + name);
      const lo = en.off, ds = lo + 30 + le16(a, lo + 26) + le16(a, lo + 28);
      const raw = a.subarray(ds, ds + en.csize);
      if (en.method === 0) return raw.slice();
      if (en.method === 8) return inflate(raw, 'raw');
      throw new Error('zip: unsupported compression method ' + en.method + ' in ' + name);
    };
    const find = (name) => {
      if (entries.has(name)) return name;
      const l = name.toLowerCase();
      for (const k of entries.keys()) if (k.toLowerCase() === l) return k;
      return null;
    };
    return { entries, names: [...entries.keys()].filter((k) => !entries.get(k).dir), get, find };
  }

  // files: [{ name, data: Uint8Array|string }]; deflate=true compresses entries that shrink
  async function zipWrite(files, opt = {}) {
    const parts = [], cd = [];
    let off = 0;
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc(f.data) : u8(f.data), name = enc(f.name), crc = crc32(data);
      let method = 0, body = data;
      if (opt.deflate !== false && data.length > 64) { const d = await deflate(data, 'raw'); if (d.length < data.length) { method = 8; body = d; } }
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x800, true); dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true); dv.setUint32(18, body.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true); lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(10, method, true);
      cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); ch.set(name, 46);
      parts.push(lh, body); cd.push(ch); off += lh.length + body.length;
    }
    const cdb = concat(cd), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdb.length, true); ev.setUint32(16, off, true);
    return concat([...parts, cdb, end]);
  }

  // ---- text ----
  function decodeText(buf, hint) {
    const a = u8(buf);
    if (a[0] === 0xef && a[1] === 0xbb && a[2] === 0xbf) return new TextDecoder('utf-8').decode(a.subarray(3));
    if (a[0] === 0xff && a[1] === 0xfe) return new TextDecoder('utf-16le').decode(a.subarray(2));
    if (a[0] === 0xfe && a[1] === 0xff) return new TextDecoder('utf-16be').decode(a.subarray(2));
    if (hint && !/^utf-?8$/i.test(hint)) { try { return new TextDecoder(hint).decode(a); } catch (e) { /* fall through */ } }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(a); } catch (e) { return new TextDecoder('windows-1252').decode(a); }
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7', laquo: '\u00ab', raquo: '\u00bb', eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', aacute: '\u00e1', uuml: '\u00fc', ouml: '\u00f6', auml: '\u00e4', szlig: '\u00df', ccedil: '\u00e7', ntilde: '\u00f1', deg: '\u00b0', times: '\u00d7', shy: '\u00ad', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003' };
  const entities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, n) => {
    if (n[0] === '#') { const c = n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : +n.slice(1); try { return String.fromCodePoint(c); } catch (e) { return ''; } }
    return Object.prototype.hasOwnProperty.call(ENT, n) ? ENT[n] : Object.prototype.hasOwnProperty.call(ENT, n.toLowerCase()) ? ENT[n.toLowerCase()] : m;
  });

  // Tolerant tag tokenizer for HTML / XHTML / FB2: [{ tag, close, attrs, self }] or { text }. No DOM needed.
  function tokens(src) {
    const out = [], re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|doctype)[^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) out.push({ text: src.slice(last, m.index) });
      last = re.lastIndex;
      if (m[0].startsWith('<![CDATA[')) { out.push({ text: m[1], raw: true }); continue; }
      if (!m[3]) continue;
      const attrs = {}, ar = /([\w:.-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
      let am; const as = m[4] || '';
      while ((am = ar.exec(as))) attrs[am[1].toLowerCase()] = entities(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] || '');
      out.push({ tag: m[3].toLowerCase(), close: !!m[2], attrs, self: /\/\s*$/.test(as) });
    }
    if (last < src.length) out.push({ text: src.slice(last) });
    return out;
  }

  // ---- PNG codec (decode: 1..16 bit, all colour types, Adam7; used in Node, browsers decode through canvas) ----
  async function pngDecode(buf) {
    const a = u8(buf);
    if (be32(a, 0) !== 0x89504e47) throw new Error('not a PNG');
    let p = 8, w = 0, h = 0, bd = 8, ct = 0, il = 0, pal = null, trns = null; const idat = [];
    while (p < a.length) {
      const len = be32(a, p), t = String.fromCharCode(a[p + 4], a[p + 5], a[p + 6], a[p + 7]), d = a.subarray(p + 8, p + 8 + len);
      if (t === 'IHDR') { w = be32(d, 0); h = be32(d, 4); bd = d[8]; ct = d[9]; il = d[12]; }
      else if (t === 'PLTE') pal = d.slice(); else if (t === 'tRNS') trns = d.slice(); else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
      p += 12 + len;
    }
    const raw = await inflate(concat(idat), 'zlib');
    const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], bpp = Math.max(1, (chans * bd) >> 3), out = new Uint8Array(w * h * 4);
    const pass = (pw, ph, x0, y0, dx, dy, at) => {
      const stride = (pw * chans * bd + 7) >> 3; let prev = new Uint8Array(stride), o = at;
      for (let y = 0; y < ph; y++) {
        const f = raw[o++], cur = raw.slice(o, o + stride); o += stride;
        for (let i = 0; i < stride; i++) {
          const l = i >= bpp ? cur[i - bpp] : 0, u = prev[i], ul = i >= bpp ? prev[i - bpp] : 0;
          if (f === 1) cur[i] = (cur[i] + l) & 255; else if (f === 2) cur[i] = (cur[i] + u) & 255; else if (f === 3) cur[i] = (cur[i] + ((l + u) >> 1)) & 255;
          else if (f === 4) { const pp = l + u - ul, pa = Math.abs(pp - l), pb = Math.abs(pp - u), pc = Math.abs(pp - ul); cur[i] = (cur[i] + (pa <= pb && pa <= pc ? l : pb <= pc ? u : ul)) & 255; }
        }
        for (let x = 0; x < pw; x++) {
          const v = [];
          for (let c = 0; c < chans; c++) {
            if (bd === 8) v.push(cur[x * chans + c]);
            else if (bd === 16) v.push(cur[(x * chans + c) * 2]);
            else { const bit = (x * chans + c) * bd, s = 8 - bd - (bit & 7); v.push((cur[bit >> 3] >> s) & ((1 << bd) - 1)); }
          }
          let r, g, b, al = 255;
          if (ct === 0) { const mx = bd === 16 ? 255 : (1 << bd) - 1; r = g = b = Math.round((v[0] * 255) / mx); }
          else if (ct === 2) { r = v[0]; g = v[1]; b = v[2]; }
          else if (ct === 3) { r = pal[v[0] * 3]; g = pal[v[0] * 3 + 1]; b = pal[v[0] * 3 + 2]; if (trns && v[0] < trns.length) al = trns[v[0]]; }
          else if (ct === 4) { r = g = b = v[0]; al = v[1]; } else { r = v[0]; g = v[1]; b = v[2]; al = v[3]; }
          const q = ((y0 + y * dy) * w + x0 + x * dx) * 4; out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = al;
        }
        prev = cur;
      }
      return o;
    };
    if (!il) pass(w, h, 0, 0, 1, 1, 0);
    else {
      let at = 0;
      for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
        const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
        if (pw > 0 && ph > 0) at = pass(pw, ph, x0, y0, dx, dy, at);
      }
    }
    return { w, h, rgba: out };
  }

  // gray: Uint8Array w*h of levels 0..255. bits 1,2,4,8 -> PNG colour type 0 at that bit depth (viewers show it as grayscale)
  async function pngEncodeGray(w, h, gray, bits = 8, text) {
    const levels = (1 << bits) - 1, stride = (w * bits + 7) >> 3, raw = new Uint8Array((stride + 1) * h);
    for (let y = 0; y < h; y++) {
      const o = y * (stride + 1) + 1;
      for (let x = 0; x < w; x++) {
        const v = bits === 8 ? gray[y * w + x] : Math.round((gray[y * w + x] * levels) / 255);
        if (bits === 8) raw[o + x] = v; else { const bit = x * bits; raw[o + (bit >> 3)] |= v << (8 - bits - (bit & 7)); }
      }
    }
    const chunk = (t, d) => {
      const o = new Uint8Array(12 + d.length), dv = new DataView(o.buffer);
      dv.setUint32(0, d.length); o.set(enc(t), 4); o.set(d, 8); dv.setUint32(8 + d.length, crc32(o.subarray(4, 8 + d.length))); return o;
    };
    const ih = new Uint8Array(13), iv = new DataView(ih.buffer); iv.setUint32(0, w); iv.setUint32(4, h); ih[8] = bits; ih[9] = 0;
    const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih)];
    if (text) parts.push(chunk('tEXt', enc('Software\0' + text)));
    parts.push(chunk('IDAT', await deflate(raw, 'zlib')), chunk('IEND', new Uint8Array(0)));
    return concat(parts);
  }

  const b64 = (a) => { if (isNode) return Buffer.from(a).toString('base64'); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); };
  const unb64 = (s) => (isNode ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

  EBC.base = { isNode, u8, concat, enc, le16, le32, be16, be32, crc32, inflate, deflate, inflateLoose, zipRead, zipWrite, decodeText, entities, tokens, pngDecode, pngEncodeGray, b64, unb64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
