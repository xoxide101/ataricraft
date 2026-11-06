// Retro and bitmap font formats around the Craft font model (tools/craftfont.cjs), plus TTC / EOT containers.
// Every format here has a reader, a writer and a round-trip test (scripts/fontformats-test.cjs). Browser build: XCW.FontPipe.Formats.
//   read(bytes, name, opt)  -> Craft font     write(id, font, opt) -> { bytes, ext }     detect(bytes, name) -> format id or null
const CF = require('./craftfont.cjs'), SF = require('./sfnt.cjs');

// The browser Buffer stand-in (web/js/xcwriter/core/shim.js) lacks some writers; fill in what this module uses (no-ops in Node).
{
  const P = Buffer.prototype, dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const poly = (n, f) => { if (!P[n]) Object.defineProperty(P, n, { value: f, configurable: true, writable: true }); };
  poly('writeUInt16BE', function (v, o) { dv(this).setUint16(o, v, false); return o + 2; });
  poly('writeInt16BE', function (v, o) { dv(this).setInt16(o, v, false); return o + 2; });
  poly('writeUInt32BE', function (v, o) { dv(this).setUint32(o, v, false); return o + 4; });
  poly('writeInt32BE', function (v, o) { dv(this).setInt32(o, v, false); return o + 4; });
  poly('copy', function (dst, d = 0, s = 0, e = this.length) { dst.set(this.subarray(s, e), d); return e - s; });
}
const zeros = (n) => new Array(n).fill(0);
const slot = (f, code) => { const s = f.map ? f.map[code] : code; return f.glyphs[s === undefined ? code : s]; };

// Smallest Craft size whose cell holds cw x ch; 8x8 sets use the 8 px size so the pixels sit in the headroom like the Atari charsets.
function cellFont(cw, ch, name) {
  const size = cw <= 8 && ch <= 8 ? 8 : [12, 14, 16, 18, 20, 22, 24, 26].find((s) => { const t = CF.createSize(s, { first: 0, count: 1 }); return t.gw >= cw && t.rows >= ch; });
  if (!size) throw new Error('cell ' + cw + 'x' + ch + ' is larger than the biggest Craft size (26)');
  return CF.createSize(size, { name: String(name || 'Bitmap font').slice(0, 40), first: 0, count: 256 });
}
const rowOff = (f, ch) => (f.adv === 8 && ch <= 8 ? f.head : 0);
function putCell(f, code, rows, cw, ch) {
  const g = zeros(f.rows), off = rowOff(f, ch);
  for (let r = 0; r < ch && off + r < f.rows; r++) for (let q = 0; q < cw; q++) if ((rows[r] >> (cw - 1 - q)) & 1) g[off + r] = CF.setPx(f, g[off + r], q);
  f.glyphs[code] = g;
}
function getCell(f, code, cw, ch) {
  const g = slot(f, code) || [], off = rowOff(f, ch), rows = [];
  for (let r = 0; r < ch; r++) { let v = 0; for (let q = 0; q < cw; q++) if (CF.hasPx(f, g[off + r] || 0, q)) v |= 1 << (cw - 1 - q); rows.push(v); }
  return rows;
}
const packRows = (rows, cw) => { const bpr = Math.ceil(cw / 8), out = []; for (const v of rows) for (let k = 0; k < bpr; k++) out.push((v << (bpr * 8 - cw) >>> (8 * (bpr - 1 - k))) & 255); return out; };
const unpackRows = (buf, at, cw, ch) => { const bpr = Math.ceil(cw / 8), rows = []; for (let r = 0; r < ch; r++) { let v = 0; for (let k = 0; k < bpr; k++) v = (v * 256) + (buf[at + r * bpr + k] || 0); rows.push(bpr * 8 === cw ? v : (v >>> (bpr * 8 - cw)) & ((1 << cw) - 1)); } return rows; };

// ---- orders: file index -> character code --------------------------------------------------------------------------------------------------------
const ORDER = {
  seq: { to: (i, o) => (o.first || 0) + i, from: (c, o) => c - (o.first || 0) },
  'atari-screen': { to: (i) => (i < 64 ? i + 32 : i < 96 ? i - 64 : i), from: (c) => (c < 32 ? c + 64 : c < 96 ? c - 32 : c) },
  atascii: { to: (i) => i, from: (c) => c },
  'c64-screen': { to: (i) => (i < 32 ? i + 64 : i < 64 ? i : i + 64), from: (c) => (c >= 64 && c < 96 ? c - 64 : c >= 32 && c < 64 ? c : c >= 128 && c < 192 ? c - 64 : -1) },
};

// ---- generic raw cells ---------------------------------------------------------------------------------------------------------------------------------
function readRaw(buf, o = {}) {
  buf = Buffer.from(buf);
  const cw = o.cw || 8, ch = o.ch || 8, skip = o.skip || 0, ord = ORDER[o.order || 'seq'], gs = Math.ceil(cw / 8) * ch;
  const n = Math.min(o.count || 256, Math.floor((buf.length - skip) / gs));
  if (n < 1) throw new Error('file too short for ' + cw + 'x' + ch + ' cells');
  const f = cellFont(cw, ch, o.name);
  for (let i = 0; i < n; i++) { const c = ord.to(i, o); if (c >= 0 && c < 256) putCell(f, c, unpackRows(buf, skip + i * gs, cw, ch), cw, ch); }
  return f;
}
function writeRaw(f, o = {}) {
  const cw = o.cw || 8, ch = o.ch || 8, ord = ORDER[o.order || 'seq'], n = o.count || 256, out = [];
  for (let i = 0; i < n; i++) { const c = ord.to(i, o); out.push(...packRows(c >= 0 && c < 256 ? getCell(f, c, cw, ch) : zeros(ch), cw)); }
  return Buffer.from(out);
}

// ---- Atari 8-bit .fnt: screen-code order (default) or ATASCII order; a 2 KB file adds the inverse half -----------------------------------
function readAtari(buf, o = {}) {
  buf = Buffer.from(buf);
  if (o.order === 'atascii') {
    if (buf.length < 1024) throw new Error('not an Atari charset');
    const s = Buffer.alloc(1024);
    for (let a = 0; a < 128; a++) buf.copy(s, ORDER['atari-screen'].from(a) * 8, a * 8, a * 8 + 8);
    buf = s;
  }
  return CF.fromFnt(buf, { name: o.name });
}
function writeAtari(f, o = {}) {
  let b = CF.toFnt(f);
  if (o.order === 'atascii') { const s = Buffer.alloc(1024); for (let a = 0; a < 128; a++) b.copy(s, a * 8, ORDER['atari-screen'].from(a) * 8, ORDER['atari-screen'].from(a) * 8 + 8); b = s; }
  return o.inverse ? Buffer.concat([b, Buffer.from(b.map((v) => v ^ 255))]) : b;
}

// ---- PSF (Linux console fonts) ------------------------------------------------------------------------------------------------------------------------
function readPsf(buf, o = {}) {
  buf = Buffer.from(buf);
  let cw, ch, n, at;
  if (buf[0] === 0x36 && buf[1] === 0x04) { cw = 8; ch = buf[3]; n = buf[2] & 1 ? 512 : 256; at = 4; }
  else if (buf.readUInt32LE(0) === 0x864ab572) { at = buf.readUInt32LE(8); n = buf.readUInt32LE(16); ch = buf.readUInt32LE(24); cw = buf.readUInt32LE(28); }
  else throw new Error('not a PSF font');
  return readRaw(buf, { cw, ch, skip: at, count: Math.min(n, 256), name: o.name });
}
function writePsf(f, o = {}) {
  const cw = o.cw || 8, ch = o.ch || 8, data = writeRaw(f, { cw, ch, count: 256 });
  if (cw === 8 && o.version !== 2) return Buffer.concat([Buffer.from([0x36, 0x04, 0, ch]), data]);
  const h = Buffer.alloc(32); h.writeUInt32LE(0x864ab572, 0); h.writeUInt32LE(32, 8); h.writeUInt32LE(0, 12); h.writeUInt32LE(256, 16);
  h.writeUInt32LE(Math.ceil(cw / 8) * ch, 20); h.writeUInt32LE(ch, 24); h.writeUInt32LE(cw, 28);
  return Buffer.concat([h, data]);
}

// ---- PCF writer (minimal: properties, metrics, bitmaps, encodings; MSB, no accelerator tables). The reader is CF.fromPcf. ---------------------
function writePcf(f, o = {}) {
  const cw = f.gw, ch = f.rows, bpr = Math.ceil(cw / 8), asc = f.base + 1, desc = ch - 1 - f.base, n = 256;
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }, i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; };
  const fmt = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }, pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const name = String(o.name || f.name || 'Craft').replace(/[^\x20-\x7e]/g, '?'), str = Buffer.from('FAMILY_NAME\0' + name + '\0', 'latin1');
  const props = pad4(Buffer.concat([fmt(4), i32(1), i32(0), Buffer.from([1]), i32(12)])), propsT = Buffer.concat([props, i32(str.length), pad4(str)]);
  const met = [fmt(4), i32(n)], offs = [], bits = [];
  for (let c = 0; c < n; c++) {
    met.push(i16(0), i16(cw), i16(f.adv), i16(asc), i16(desc), i16(0));
    offs.push(i32(c * ch * bpr)); bits.push(Buffer.from(packRows(getCell(f, c, cw, ch), cw)));
  }
  const bmp = Buffer.concat([fmt(4 | 8), i32(n), ...offs, i32(n * ch * bpr), i32(n * ch * bpr), i32(n * ch * bpr), i32(n * ch * bpr), ...bits]);
  const enc = [fmt(4), i16(0), i16(n - 1), i16(0), i16(0), i16(32)]; for (let c = 0; c < n; c++) enc.push(i16(c));
  const tabs = [[1, pad4(propsT)], [4, pad4(Buffer.concat(met))], [8, pad4(bmp)], [32, pad4(Buffer.concat(enc))]], head = Buffer.alloc(8 + tabs.length * 16);
  head.writeUInt32LE(0x70636601, 0); head.writeUInt32LE(tabs.length, 4);
  let at = head.length;
  tabs.forEach(([type, b], i) => { const fm = b.readUInt32LE(0); head.writeUInt32LE(type, 8 + i * 16); head.writeUInt32LE(fm, 12 + i * 16); head.writeUInt32LE(b.length, 16 + i * 16); head.writeUInt32LE(at, 20 + i * 16); at += b.length; });
  return Buffer.concat([head, ...tabs.map((t) => t[1])]);
}

// ---- Atari ST / GEM .fnt (big-endian header 88 bytes, one raster form; monospaced cells) -------------------------------------------
function readGem(buf, o = {}) {
  buf = Buffer.from(buf);
  const flags0 = buf.readUInt16BE(66), le = !!(flags0 & 4), u16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p)), u32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
  const first = u16(36), last = u16(38), offT = u32(72), datT = u32(76), fw = u16(80), fh = u16(82);
  if (last < first || last > 255 || !fh || fh > 26 || datT + fw * fh > buf.length) throw new Error('not a GEM font');
  const n = last - first + 1, xs = []; for (let i = 0; i <= n; i++) xs.push(u16(offT + i * 2));
  let cw = 0; for (let i = 0; i < n; i++) cw = Math.max(cw, xs[i + 1] - xs[i]);
  if (!cw || cw > 23) throw new Error('GEM font cell too wide');
  const f = cellFont(cw, fh, o.name || buf.toString('latin1', 4, 36).replace(/\0.*$/, '') || 'GEM font');
  for (let i = 0; i < n; i++) {
    const rows = [];
    for (let r = 0; r < fh; r++) { let v = 0; for (let x = xs[i]; x < xs[i + 1]; x++) v = (v << 1) | ((buf[datT + r * fw + (x >> 3)] >> (7 - (x & 7))) & 1); rows.push(v << (cw - (xs[i + 1] - xs[i]))); }
    putCell(f, first + i, rows, cw, fh);
  }
  return f;
}
function writeGem(f, o = {}) {
  const cw = o.cw || 8, ch = o.ch || 8, n = 256, fw = Math.ceil((n * cw) / 8), hdr = Buffer.alloc(88);
  hdr.writeUInt16BE(1, 0); hdr.writeUInt16BE(ch, 2); hdr.write(String(o.name || f.name || 'Craft').slice(0, 31), 4, 'latin1');
  hdr.writeUInt16BE(0, 36); hdr.writeUInt16BE(n - 1, 38);
  [ch - 1, ch - 2, ch >> 1, 1, 1, cw, cw, 0, 0, 0, 1, 0, 0].forEach((v, i) => hdr.writeUInt16BE(v, 40 + i * 2));
  hdr.writeUInt16BE(8, 66); hdr.writeUInt32BE(0, 68); hdr.writeUInt32BE(88, 72); hdr.writeUInt32BE(88 + (n + 1) * 2, 76); hdr.writeUInt16BE(fw, 80); hdr.writeUInt16BE(ch, 82);
  const offs = Buffer.alloc((n + 1) * 2); for (let i = 0; i <= n; i++) offs.writeUInt16BE(i * cw, i * 2);
  const form = Buffer.alloc(fw * ch);
  for (let i = 0; i < n; i++) getCell(f, i, cw, ch).forEach((v, r) => { for (let q = 0; q < cw; q++) if ((v >> (cw - 1 - q)) & 1) { const x = i * cw + q; form[r * fw + (x >> 3)] |= 0x80 >> (x & 7); } });
  return Buffer.concat([hdr, offs, form]);
}

// ---- containers: TTC collections and EOT wrappers ----------------------------------------------------------------------------------------------
const tableDir = (b, off = 0) => { const n = b.readUInt16BE(off + 4), t = []; for (let i = 0; i < n; i++) { const p = off + 12 + i * 16; t.push({ tag: b.toString('latin1', p, p + 4), sum: b.readUInt32BE(p + 4), off: b.readUInt32BE(p + 8), len: b.readUInt32BE(p + 12) }); } return t; };
function ttcPack(fonts) {
  fonts = fonts.map((x) => Buffer.from(x));
  let at = 12 + 4 * fonts.length; const parts = [], offs = [];
  for (const b of fonts) {
    const t = tableDir(b), dir = Buffer.alloc(12 + t.length * 16); b.copy(dir, 0, 0, 12);
    let p = at + dir.length; const bodies = [];
    t.forEach((e, i) => { const body = b.subarray(e.off, e.off + e.len), padn = (4 - (e.len % 4)) % 4; dir.write(e.tag, 12 + i * 16, 'latin1'); dir.writeUInt32BE(e.sum, 16 + i * 16); dir.writeUInt32BE(p, 20 + i * 16); dir.writeUInt32BE(e.len, 24 + i * 16); bodies.push(body, Buffer.alloc(padn)); p += e.len + padn; });
    offs.push(at); parts.push(dir, ...bodies); at = p;
  }
  const h = Buffer.alloc(12 + 4 * fonts.length); h.write('ttcf', 0, 'latin1'); h.writeUInt32BE(0x00010000, 4); h.writeUInt32BE(fonts.length, 8); offs.forEach((o, i) => h.writeUInt32BE(o, 12 + i * 4));
  return Buffer.concat([h, ...parts]);
}
function ttcUnpack(input, idx = 0) {
  const b = Buffer.from(input); if (b.toString('latin1', 0, 4) !== 'ttcf') return b;
  const n = b.readUInt32BE(8); if (idx >= n) throw new Error('TTC has only ' + n + ' fonts');
  const off = b.readUInt32BE(12 + idx * 4), t = tableDir(b, off), dir = Buffer.alloc(12 + t.length * 16); b.copy(dir, 0, off, off + 12);
  let p = dir.length; const bodies = [];
  t.forEach((e, i) => { const padn = (4 - (e.len % 4)) % 4; dir.write(e.tag, 12 + i * 16, 'latin1'); dir.writeUInt32BE(e.sum, 16 + i * 16); dir.writeUInt32BE(p, 20 + i * 16); dir.writeUInt32BE(e.len, 24 + i * 16); bodies.push(b.subarray(e.off, e.off + e.len), Buffer.alloc(padn)); p += e.len + padn; });
  return Buffer.concat([dir, ...bodies]);
}
function eotWrap(ttf, name) {
  ttf = Buffer.from(ttf);
  const nm = Buffer.from(String(name || 'Font'), 'utf16le'), z = Buffer.alloc(2), h = Buffer.alloc(82);
  h.writeUInt32LE(0x00020001, 8); h.writeUInt32LE(0, 12); h.writeUInt16LE(0x504c, 34);
  const parts = [h, z, (() => { const b = Buffer.alloc(2); b.writeUInt16LE(nm.length); return b; })(), nm, z, Buffer.alloc(2), z, Buffer.alloc(2), z, Buffer.alloc(2), z, Buffer.alloc(2), z, Buffer.alloc(2), ttf];
  const out = Buffer.concat(parts); out.writeUInt32LE(out.length, 0); out.writeUInt32LE(ttf.length, 4);
  return out;
}
function eotUnwrap(input) {
  const b = Buffer.from(input);
  if (b.length < 82 || b.readUInt16LE(34) !== 0x504c) throw new Error('not an EOT file');
  const flags = b.readUInt32LE(12), size = b.readUInt32LE(4);
  if (flags & 0x4) throw new Error('EOT is MicroType-compressed; convert it with a tool that supports MTX (not supported here)');
  const data = Buffer.from(b.subarray(b.length - size));
  if (flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  return data;
}

// ---- registry ---------------------------------------------------------------------------------------------------------------------------------------------
const FORMATS = [
  { id: 'raw', label: 'Raw cells (user cell size and order)', ext: 'raw', read: (b, o) => readRaw(b, o), write: (f, o) => ({ bytes: writeRaw(f, o), ext: 'raw' }) },
  { id: 'atari', label: 'Atari 8-bit .fnt (screen-code or ATASCII order, inverse half)', ext: 'fnt', read: (b, o) => readAtari(b, o), write: (f, o) => ({ bytes: writeAtari(f, o), ext: 'fnt' }) },
  { id: 'c64', label: 'Commodore 64 charset (2048 / .64c)', ext: '64c', read: (b, o) => readRaw(b, { ...o, skip: b.length % 2048 === 2 ? 2 : 0, order: 'c64-screen', count: 128 }), write: (f, o) => ({ bytes: Buffer.concat([...(o.header ? [Buffer.from([0, 0x38])] : []), (() => { const half = writeRaw(f, { order: 'c64-screen', count: 128 }); return Buffer.concat([half, Buffer.from(half.map((v) => v ^ 255))]); })()]), ext: o.header ? '64c' : 'bin' }) },
  { id: 'zx', label: 'ZX Spectrum charset (768 bytes, chars 32-127)', ext: 'zx', read: (b, o) => readRaw(b, { ...o, first: 32, count: 96 }), write: (f) => ({ bytes: writeRaw(f, { first: 32, count: 96 }), ext: 'zx' }) },
  { id: 'msx', label: 'MSX charset (2048 bytes, 256 chars)', ext: 'chr', read: (b, o) => readRaw(b, { ...o, count: 256 }), write: (f) => ({ bytes: writeRaw(f, {}), ext: 'chr' }) },
  { id: 'cpc', label: 'Amstrad CPC charset (2048 bytes, 256 chars)', ext: 'cpc', read: (b, o) => readRaw(b, { ...o, count: 256 }), write: (f) => ({ bytes: writeRaw(f, {}), ext: 'cpc' }) },
  { id: 'psf', label: 'PSF 1 / PSF 2 (Linux console)', ext: 'psf', read: (b, o) => readPsf(b, o), write: (f, o) => ({ bytes: writePsf(f, o), ext: 'psf' }) },
  { id: 'pcf', label: 'PCF (X11, minimal writer)', ext: 'pcf', read: (b, o) => CF.fromPcf(b, o), write: (f, o) => ({ bytes: writePcf(f, o), ext: 'pcf' }) },
  { id: 'gem', label: 'Atari ST / GEM .fnt', ext: 'fnt', read: (b, o) => readGem(b, o), write: (f, o) => ({ bytes: writeGem(f, o), ext: 'fnt' }) },
];
const byId = (id) => FORMATS.find((x) => x.id === id) || (() => { throw new Error('unknown format ' + id); })();

function detect(input, name) {
  const b = Buffer.from(input), nm = String(name || '').toLowerCase();
  if (b.length > 3 && ((b[0] === 0x36 && b[1] === 0x04) || b.readUInt32LE(0) === 0x864ab572)) return 'psf';
  if (b.length > 82 && b.readUInt16LE(34) === 0x504c && b.readUInt32LE(0) === b.length) return 'eot';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'ttcf') return 'ttc';
  if (/\.64c$/.test(nm) || ((b.length === 2050 || b.length === 4098) && /\.(c64|64c|bin|chr)$/.test(nm))) return 'c64';
  if (b.length === 768 || /\.(zx|ch8)$/.test(nm)) return 'zx';
  if (/\.msx$/.test(nm)) return 'msx';
  if (/\.cpc$/.test(nm)) return 'cpc';
  if (/\.fnt$/.test(nm) && b.length > 88 && b.length !== 1024 && b.length !== 2048) { try { readGem(b); return 'gem'; } catch (e) { return null; } }
  if (/\.(raw|bin|chr)$/.test(nm)) return 'raw';
  return null;
}
function read(input, name, o = {}) {
  const id = o.format || detect(input, name); if (!id || id === 'eot' || id === 'ttc') throw new Error('not a bitmap format: ' + name);
  const b = Buffer.from(input); return byId(id).read(b, { name: o.name, ...o });
}
function write(id, f, o = {}) { return byId(id).write(f, o); }

module.exports = { FORMATS, detect, read, write, readRaw, writeRaw, readAtari, writeAtari, readPsf, writePsf, writePcf, readGem, writeGem, ttcPack, ttcUnpack, eotWrap, eotUnwrap, ORDER, cellFont };
