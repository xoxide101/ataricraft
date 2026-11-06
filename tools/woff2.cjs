// WOFF2 container reader (W3C WOFF2): Brotli stream + the glyf/loca and hmtx table transforms, rebuilt into plain sfnt tables.
// Node only: Brotli comes from zlib.brotliDecompressSync. Browsers have no Brotli decoder (DecompressionStream supports gzip and deflate only),
// so the xCWriter bundle / font editor reject WOFF2 with a clear message; sfnt.cjs loads this file lazily. Used by tools/sfnt.cjs.
//   tables(bytes) -> { tag: Uint8Array } in the same shape as the sfnt / WOFF readers.
'use strict';

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function brotli(b) {
  let z;
  try { z = require('zlib'); } catch (e) { z = null; }
  if (!z || !z.brotliDecompressSync) throw new Error('WOFF2 needs a Brotli decoder (Node zlib); the browser has none, convert the font to WOFF or TTF');
  return new Uint8Array(z.brotliDecompressSync(b));
}

class Rd {
  constructor(b, o) { this.b = b; this.o = o || 0; }
  u8() { return this.b[this.o++]; }
  u16() { const v = (this.b[this.o] << 8) | this.b[this.o + 1]; this.o += 2; return v; }
  s16() { const v = this.u16(); return v > 32767 ? v - 65536 : v; }
  u32() { const v = ((this.b[this.o] << 24) | (this.b[this.o + 1] << 16) | (this.b[this.o + 2] << 8) | this.b[this.o + 3]) >>> 0; this.o += 4; return v; }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) { const c = this.u8(); if (i === 0 && c === 0x80) throw new Error('WOFF2: bad UIntBase128'); v = v * 128 + (c & 0x7f); if (!(c & 0x80)) return v; }
    throw new Error('WOFF2: UIntBase128 too long');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return 253 + this.u8();
    if (c === 254) return 506 + this.u8();
    return c;
  }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
}

const sgn = (flag, v) => (flag & 1 ? v : -v);

function glyfTable(t) {
  const r = new Rd(t, 0);
  r.u16(); const opt = r.u16(), n = r.u16(), indexFormat = r.u16();
  const sz = []; for (let i = 0; i < 7; i++) sz.push(r.u32());
  const [nCont, nPts, flg, glyph, comp, bbox, ins] = sz.map((s) => new Rd(r.bytes(s), 0));
  const bboxBitmap = bbox.bytes(4 * ((n + 31) >> 5));
  const out = [], loca = [0], xMin = new Int16Array(n);
  let total = 0;
  for (let g = 0; g < n; g++) {
    const nc = nCont.s16();
    let buf = null;
    const hasBox = !!(bboxBitmap[g >> 3] & (0x80 >> (g & 7)));
    if (nc === 0) { /* empty glyph */ } else if (nc > 0) {
      const ends = []; let np = 0;
      for (let i = 0; i < nc; i++) { np += nPts.u255(); ends.push(np - 1); }
      const xs = new Array(np), ys = new Array(np), on = new Array(np);
      let x = 0, y = 0;
      for (let i = 0; i < np; i++) {
        const f = flg.u8(), fl = f & 0x7f; let dx, dy;
        on[i] = !(f & 0x80);
        if (fl < 10) { dx = 0; dy = sgn(fl, ((fl & 14) << 7) + glyph.u8()); }
        else if (fl < 20) { dx = sgn(fl, (((fl - 10) & 14) << 7) + glyph.u8()); dy = 0; }
        else if (fl < 84) { const b0 = fl - 20, b1 = glyph.u8(); dx = sgn(fl, 1 + (b0 & 0x30) + (b1 >> 4)); dy = sgn(fl >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); }
        else if (fl < 120) { const b0 = fl - 84, a = glyph.u8(), c = glyph.u8(); dx = sgn(fl, 1 + (Math.floor(b0 / 12) << 8) + a); dy = sgn(fl >> 1, 1 + ((((b0 % 12) >> 2)) << 8) + c); }
        else if (fl < 124) { const a = glyph.u8(), b2 = glyph.u8(), c = glyph.u8(); dx = sgn(fl, (a << 4) + (b2 >> 4)); dy = sgn(fl >> 1, ((b2 & 0x0f) << 8) + c); }
        else { const a = glyph.u8(), b2 = glyph.u8(), c = glyph.u8(), d = glyph.u8(); dx = sgn(fl, (a << 8) + b2); dy = sgn(fl >> 1, (c << 8) + d); }
        x += dx; y += dy; xs[i] = x; ys[i] = y;
      }
      const il = glyph.u255(), instr = ins.bytes(il);
      let bx0, by0, bx1, by1;
      if (hasBox) { bx0 = bbox.s16(); by0 = bbox.s16(); bx1 = bbox.s16(); by1 = bbox.s16(); }
      else { bx0 = Math.min(...xs); bx1 = Math.max(...xs); by0 = Math.min(...ys); by1 = Math.max(...ys); }
      buf = new Uint8Array(10 + 2 * nc + 2 + il + np + 4 * np);
      const dv = new DataView(buf.buffer);
      dv.setInt16(0, nc); dv.setInt16(2, bx0); dv.setInt16(4, by0); dv.setInt16(6, bx1); dv.setInt16(8, by1);
      let o = 10; for (const e of ends) { dv.setUint16(o, e); o += 2; }
      dv.setUint16(o, il); o += 2; buf.set(instr, o); o += il;
      for (let i = 0; i < np; i++) buf[o++] = on[i] ? 1 : 0;
      let px = 0; for (let i = 0; i < np; i++) { dv.setInt16(o, xs[i] - px); px = xs[i]; o += 2; }
      let py = 0; for (let i = 0; i < np; i++) { dv.setInt16(o, ys[i] - py); py = ys[i]; o += 2; }
      xMin[g] = bx0;
    } else {
      const start = comp.o; let more = true, instrs = false;
      while (more) {
        const f = comp.u16(); comp.u16();
        comp.o += f & 1 ? 4 : 2;
        if (f & 8) comp.o += 2; else if (f & 0x40) comp.o += 4; else if (f & 0x80) comp.o += 8;
        more = !!(f & 0x20); if (f & 0x100) instrs = true;
      }
      const cbytes = comp.b.subarray(start, comp.o);
      let il = 0, instr = new Uint8Array(0);
      if (instrs) { il = glyph.u255(); instr = ins.bytes(il); }
      const bx0 = bbox.s16(), by0 = bbox.s16(), bx1 = bbox.s16(), by1 = bbox.s16();
      buf = new Uint8Array(10 + cbytes.length + (instrs ? 2 + il : 0));
      const dv = new DataView(buf.buffer);
      dv.setInt16(0, -1); dv.setInt16(2, bx0); dv.setInt16(4, by0); dv.setInt16(6, bx1); dv.setInt16(8, by1);
      buf.set(cbytes, 10);
      if (instrs) { dv.setUint16(10 + cbytes.length, il); buf.set(instr, 12 + cbytes.length); }
      xMin[g] = bx0;
    }
    if (buf) { out.push(buf); total += buf.length; const pad = (4 - (total & 3)) & 3; if (pad) { out.push(new Uint8Array(pad)); total += pad; } }
    loca.push(total);
  }
  const glyf = new Uint8Array(total); let o = 0; for (const p of out) { glyf.set(p, o); o += p.length; }
  const lo = new Uint8Array(indexFormat ? 4 * (n + 1) : 2 * (n + 1)), ldv = new DataView(lo.buffer);
  loca.forEach((v, i) => { if (indexFormat) ldv.setUint32(4 * i, v); else ldv.setUint16(2 * i, v >> 1); });
  return { glyf, loca: lo, xMin, numGlyphs: n, opt };
}

function hmtxTable(t, numHMetrics, g) {
  const r = new Rd(t, 0), flags = r.u8(), n = g.numGlyphs;
  const adv = []; for (let i = 0; i < numHMetrics; i++) adv.push(r.u16());
  const lsb = new Array(n);
  for (let i = 0; i < numHMetrics; i++) lsb[i] = flags & 1 ? g.xMin[i] : r.s16();
  for (let i = numHMetrics; i < n; i++) lsb[i] = flags & 2 ? g.xMin[i] : r.s16();
  const out = new Uint8Array(4 * numHMetrics + 2 * (n - numHMetrics)), dv = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < n; i++) { if (i < numHMetrics) { dv.setUint16(o, adv[i]); o += 2; } dv.setInt16(o, lsb[i]); o += 2; }
  return out;
}

function tables(b) {
  const r = new Rd(b, 0);
  if (r.u32() !== 0x774f4632) throw new Error('not a WOFF2 font');
  r.u32(); r.u32();
  const num = r.u16(); r.u16(); r.u32();
  const compSize = r.u32(); r.o = 48;
  const dir = [];
  for (let i = 0; i < num; i++) {
    const f = r.u8(), idx = f & 63, ver = f >> 6;
    const tag = idx === 63 ? String.fromCharCode(...r.bytes(4)) : KNOWN[idx];
    const origLen = r.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? ver === 0 : tag === 'hmtx' ? ver === 1 : ver !== 0;
    dir.push({ tag, origLen, len: transformed ? r.base128() : origLen, transformed });
  }
  const raw = brotli(b.subarray(r.o, r.o + compSize));
  let at = 0; const t = {}, src = {};
  for (const d of dir) { src[d.tag] = d; d.data = raw.subarray(at, at + d.len); at += d.len; }
  let g = null;
  for (const d of dir) t[d.tag] = d.data;
  if (src.glyf && src.glyf.transformed) {
    g = glyfTable(src.glyf.data); t.glyf = g.glyf; t.loca = g.loca;
  } else if (src.hmtx && src.hmtx.transformed) throw new Error('WOFF2: transformed hmtx without transformed glyf');
  if (src.hmtx && src.hmtx.transformed) {
    const hh = t.hhea; if (!hh) throw new Error('WOFF2: hhea missing');
    t.hmtx = hmtxTable(src.hmtx.data, (hh[34] << 8) | hh[35], g);
  }
  return t;
}

module.exports = { tables };
