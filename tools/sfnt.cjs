// TrueType / OpenType / WOFF reader, outline rasteriser and a bitmap-to-TrueType writer. Pure JS, no dependencies, no Buffer or DOM:
// runs in Node and in the browser (bundled into xcw-core.js). Used by tools/fontpipe.cjs (docs/FONT.md, "Font pipeline").
//   parse(bytes)  -> font { upm, ascent, descent, capHeight, xHeight, numGlyphs, family, kind, gid(code), advance(gid), outline(gid), table(tag) }
//   outline(gid)  -> contours, each an array of [x, y] points in font units (y up), curves already flattened
//   coverage(polys, w, h, sy) -> Float32Array w*h of pixel coverage (non-zero winding, exact in x, sy samples in y)
//   build(spec)   -> Uint8Array of a TrueType font made of straight-edged contours (used to export bitmap fonts)
'use strict';

const inflate = require('./inflate.cjs');

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset || 0, (b.byteOffset || 0) + b.byteLength) : b));
const U16 = (b, o) => (b[o] << 8) | b[o + 1];
const S16 = (b, o) => { const v = U16(b, o); return v > 32767 ? v - 65536 : v; };
const U32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const tag4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// ---- container: sfnt (TTF/OTF) or WOFF ---------------------------------------------------------------------------------------
function tables(b) {
  const t = {};
  const sig = tag4(b, 0);
  if (sig === 'wOFF') {
    const n = U16(b, 12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20, off = U32(b, o + 4), cl = U32(b, o + 8), ol = U32(b, o + 12);
      const raw = b.subarray(off, off + cl);
      t[tag4(b, o)] = cl === ol ? raw : inflate.inflateRaw(raw.subarray(2));
    }
    return t;
  }
  if (sig === 'wOF2') {
    let W; try { W = require('./woff2.cjs'); } catch (e) { throw new Error('WOFF2 is only supported in Node (Brotli); convert the font to WOFF or TTF'); }
    return W.tables(b);
  }
  let base = 0;
  if (sig === 'ttcf') base = U32(b, 12);
  else if (!(sig === 'OTTO' || sig === '\0\x01\0\0' || sig === 'true' || sig === 'typ1')) throw new Error('not a TrueType/OpenType/WOFF font');
  const n = U16(b, base + 4);
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16, off = U32(b, o + 8), len = U32(b, o + 12);
    t[tag4(b, o)] = b.subarray(off, off + len);
  }
  return t;
}

// ---- cmap ---------------------------------------------------------------------------------------------------------------------
function cmapLookups(c) {
  const out = [];
  if (!c || c.length < 4) return out;
  const n = U16(c, 2);
  for (let i = 0; i < n; i++) {
    const pid = U16(c, 4 + i * 8), eid = U16(c, 6 + i * 8), off = U32(c, 8 + i * 8), fmt = U16(c, off);
    let fn = null;
    if (fmt === 0) fn = (cp) => (cp < 256 ? c[off + 6 + cp] : 0);
    else if (fmt === 4) {
      const sc = U16(c, off + 6) >> 1, endO = off + 14, startO = endO + sc * 2 + 2, deltaO = startO + sc * 2, rangeO = deltaO + sc * 2;
      fn = (cp) => {
        if (cp > 0xffff) return 0;
        for (let s = 0; s < sc; s++) {
          if (U16(c, endO + s * 2) < cp) continue;
          const st = U16(c, startO + s * 2);
          if (st > cp) return 0;
          const ro = U16(c, rangeO + s * 2), d = U16(c, deltaO + s * 2);
          if (ro === 0) return (cp + d) & 0xffff;
          const g = U16(c, rangeO + s * 2 + ro + (cp - st) * 2);
          return g ? (g + d) & 0xffff : 0;
        }
        return 0;
      };
    } else if (fmt === 6) {
      const first = U16(c, off + 6), cnt = U16(c, off + 8);
      fn = (cp) => (cp >= first && cp < first + cnt ? U16(c, off + 10 + (cp - first) * 2) : 0);
    } else if (fmt === 12) {
      const ng = U32(c, off + 12);
      fn = (cp) => {
        for (let g = 0; g < ng; g++) { const o = off + 16 + g * 12, s = U32(c, o), e = U32(c, o + 4); if (cp >= s && cp <= e) return U32(c, o + 8) + cp - s; }
        return 0;
      };
    }
    if (fn) out.push({ pid, eid, fmt, fn });
  }
  return out;
}

// ---- glyf outlines ------------------------------------------------------------------------------------------------------------
function quad(out, p0, p1, p2, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, a = (1 - t) * (1 - t), bb = 2 * (1 - t) * t, c = t * t;
    out.push([a * p0[0] + bb * p1[0] + c * p2[0], a * p0[1] + bb * p1[1] + c * p2[1]]);
  }
}
function cubic(out, p0, p1, p2, p3, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

// TrueType contour (on/off-curve points) -> polygon
function flattenTt(pts) {
  const n = pts.length;
  if (n < 2) return [];
  let start = pts.findIndex((p) => p.on), seq;
  if (start < 0) { const m = [(pts[0].x + pts[n - 1].x) / 2, (pts[0].y + pts[n - 1].y) / 2]; seq = [{ x: m[0], y: m[1], on: true }].concat(pts); start = 0; }
  else seq = pts.slice(start).concat(pts.slice(0, start));
  const out = [[seq[0].x, seq[0].y]];
  let cur = [seq[0].x, seq[0].y], i = 1;
  const m = seq.length;
  while (i <= m) {
    const p = seq[i % m];
    if (p.on) { out.push([p.x, p.y]); cur = [p.x, p.y]; i++; continue; }
    const nx = seq[(i + 1) % m];
    let end;
    if (nx.on) { end = [nx.x, nx.y]; i += 2; } else { end = [(p.x + nx.x) / 2, (p.y + nx.y) / 2]; i++; }
    quad(out, cur, [p.x, p.y], end, 6); cur = end;
  }
  return out;
}

function glyfOutline(tb, loca, longLoca, gid, depth) {
  const lo = longLoca ? U32(loca, gid * 4) : U16(loca, gid * 2) * 2, hi = longLoca ? U32(loca, gid * 4 + 4) : U16(loca, gid * 2 + 2) * 2;
  if (hi <= lo) return [];
  const g = tb.glyf.subarray(lo, hi), nc = S16(g, 0);
  if (nc >= 0) {
    const ends = []; let p = 10;
    for (let i = 0; i < nc; i++) { ends.push(U16(g, p)); p += 2; }
    const np = nc ? ends[nc - 1] + 1 : 0;
    p += 2 + U16(g, p);
    const flags = [];
    while (flags.length < np) { const f = g[p++]; flags.push(f); if (f & 8) { let r = g[p++]; while (r--) flags.push(f); } }
    const xs = [], ys = []; let v = 0;
    for (let i = 0; i < np; i++) { const f = flags[i]; if (f & 2) { const d = g[p++]; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += S16(g, p); p += 2; } xs.push(v); }
    v = 0;
    for (let i = 0; i < np; i++) { const f = flags[i]; if (f & 4) { const d = g[p++]; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += S16(g, p); p += 2; } ys.push(v); }
    const out = []; let s = 0;
    for (const e of ends) {
      const pts = [];
      for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      const poly = flattenTt(pts); if (poly.length > 2) out.push(poly);
      s = e + 1;
    }
    return out;
  }
  if (depth > 6) return [];
  let out = [], p = 10, f;
  do {
    f = U16(g, p); const sub = U16(g, p + 2); p += 4;
    let dx, dy;
    if (f & 1) { dx = S16(g, p); dy = S16(g, p + 2); p += 4; } else { dx = (g[p] << 24) >> 24; dy = (g[p + 1] << 24) >> 24; p += 2; }
    if (!(f & 2)) { dx = 0; dy = 0; }
    let a = 1, b = 0, c = 0, d = 1;
    const f2 = (o) => S16(g, o) / 16384;
    if (f & 8) { a = d = f2(p); p += 2; } else if (f & 0x40) { a = f2(p); d = f2(p + 2); p += 4; } else if (f & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
    for (const poly of glyfOutline(tb, loca, longLoca, sub, depth + 1)) out.push(poly.map(([x, y]) => [a * x + c * y + dx, b * x + d * y + dy]));
  } while (f & 0x20);
  return out;
}

// ---- CFF (Type 2 charstrings) -------------------------------------------------------------------------------------------------
function cffIndex(b, p) {
  const n = U16(b, p);
  if (!n) return { items: [], end: p + 2 };
  const os = b[p + 2], off = (i) => { let v = 0; for (let k = 0; k < os; k++) v = v * 256 + b[p + 3 + i * os + k]; return v; };
  const base = p + 3 + (n + 1) * os - 1, items = [];
  for (let i = 0; i < n; i++) items.push(b.subarray(base + off(i), base + off(i + 1)));
  return { items, end: base + off(n) };
}
function cffDict(b) {
  const d = {}; let st = [], i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c <= 21) { const k = c === 12 ? 1200 + b[i++] : c; d[k] = st; st = []; }
    else if (c === 28) { st.push(S16(b, i)); i += 2; }
    else if (c === 29) { st.push(U32(b, i) | 0); i += 4; }
    else if (c === 30) {
      let s = '', done = false;
      while (!done && i < b.length) { for (const nb of [b[i] >> 4, b[i] & 15]) { if (nb === 15) { done = true; break; } s += nb < 10 ? nb : nb === 10 ? '.' : nb === 11 ? 'E' : nb === 12 ? 'E-' : nb === 14 ? '-' : ''; } i++; }
      st.push(parseFloat(s) || 0);
    } else if (c >= 32 && c <= 246) st.push(c - 139);
    else if (c >= 247 && c <= 250) st.push((c - 247) * 256 + b[i++] + 108);
    else if (c >= 251 && c <= 254) st.push(-(c - 251) * 256 - b[i++] - 108);
  }
  return d;
}
function cffPrepare(cff) {
  const hdr = cff[2], names = cffIndex(cff, hdr), tops = cffIndex(cff, names.end), strs = cffIndex(cff, tops.end), gsub = cffIndex(cff, strs.end);
  const top = cffDict(tops.items[0]), cs = cffIndex(cff, top[17][0]);
  const priv = (d) => {
    if (!d[18]) return { subrs: [] };
    const [size, off] = d[18], pd = cffDict(cff.subarray(off, off + size));
    return { subrs: pd[19] ? cffIndex(cff, off + pd[19][0]).items : [] };
  };
  const fds = [];
  let sel = null;
  if (top[1236]) {
    for (const it of cffIndex(cff, top[1236][0]).items) fds.push(priv(cffDict(it)));
    const fo = top[1237][0], fmt = cff[fo];
    sel = new Uint8Array(cs.items.length);
    if (fmt === 0) for (let g = 0; g < sel.length; g++) sel[g] = cff[fo + 1 + g];
    else if (fmt === 3) {
      const nr = U16(cff, fo + 1);
      for (let r = 0; r < nr; r++) { const f0 = U16(cff, fo + 3 + r * 3), fd = cff[fo + 5 + r * 3], f1 = U16(cff, fo + 3 + (r + 1) * 3); for (let g = f0; g < f1 && g < sel.length; g++) sel[g] = fd; }
    }
  } else fds.push(priv(top));
  return { cs: cs.items, gsubrs: gsub.items, fds, sel };
}
function cffOutline(c, gid) {
  const subrs = c.fds[c.sel ? c.sel[gid] : 0].subrs, gs = c.gsubrs;
  const bias = (a) => (a.length < 1240 ? 107 : a.length < 33900 ? 1131 : 32768);
  const out = []; let cur = null, x = 0, y = 0, nst = 0, first = true, st = [], done = false;
  const move = () => { if (cur && cur.length > 2) out.push(cur); cur = [[x, y]]; };
  const line = (dx, dy) => { x += dx; y += dy; cur.push([x, y]); };
  const curve = (a, b, c2, d, e, f) => { const p0 = [x, y], p1 = [x + a, y + b], p2 = [p1[0] + c2, p1[1] + d], p3 = [p2[0] + e, p2[1] + f]; cubic(cur, p0, p1, p2, p3, 8); x = p3[0]; y = p3[1]; };
  const width = (odd) => { if (first) { first = false; if (odd) st.shift(); } };
  function run(code, depth) {
    let i = 0;
    while (i < code.length && !done) {
      const b0 = code[i++];
      if (b0 === 28) { st.push(S16(code, i)); i += 2; continue; }
      if (b0 >= 32 && b0 <= 246) { st.push(b0 - 139); continue; }
      if (b0 >= 247 && b0 <= 250) { st.push((b0 - 247) * 256 + code[i++] + 108); continue; }
      if (b0 >= 251 && b0 <= 254) { st.push(-(b0 - 251) * 256 - code[i++] - 108); continue; }
      if (b0 === 255) { st.push((U32(code, i) | 0) / 65536); i += 4; continue; }
      switch (b0) {
        case 1: case 3: case 18: case 23: width(st.length % 2); nst += st.length >> 1; st = []; break;
        case 19: case 20: width(st.length % 2); nst += st.length >> 1; st = []; i += (nst + 7) >> 3; break;
        case 21: width(st.length > 2); move.call(null); x += st[0]; y += st[1]; cur = [[x, y]]; st = []; break;
        case 22: width(st.length > 1); move(); x += st[0]; cur = [[x, y]]; st = []; break;
        case 4: width(st.length > 1); move(); y += st[0]; cur = [[x, y]]; st = []; break;
        case 5: for (let k = 0; k + 1 < st.length; k += 2) line(st[k], st[k + 1]); st = []; break;
        case 6: case 7: { let h = b0 === 6; for (const v of st) { if (h) line(v, 0); else line(0, v); h = !h; } st = []; break; }
        case 8: for (let k = 0; k + 5 < st.length; k += 6) curve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); st = []; break;
        case 24: { let k = 0; for (; k + 7 < st.length; k += 6) curve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); line(st[k], st[k + 1]); st = []; break; }
        case 25: { let k = 0; for (; k + 7 < st.length; k += 2) line(st[k], st[k + 1]); curve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); st = []; break; }
        case 26: { let k = 0, dx1 = 0; if (st.length % 4) dx1 = st[k++]; for (; k + 3 < st.length; k += 4) { curve(dx1, st[k], st[k + 1], st[k + 2], 0, st[k + 3]); dx1 = 0; } st = []; break; }
        case 27: { let k = 0, dy1 = 0; if (st.length % 4) dy1 = st[k++]; for (; k + 3 < st.length; k += 4) { curve(st[k], dy1, st[k + 1], st[k + 2], st[k + 3], 0); dy1 = 0; } st = []; break; }
        case 30: case 31: {
          let h = b0 === 31, k = 0;
          while (k + 3 < st.length) {
            const last = st.length - k === 5 ? st[k + 4] : 0;
            if (h) curve(st[k], 0, st[k + 1], st[k + 2], last, st[k + 3]); else curve(0, st[k], st[k + 1], st[k + 2], st[k + 3], last);
            h = !h; k += 4;
          }
          st = []; break;
        }
        case 10: { const a = st.pop() + bias(subrs); if (subrs[a] && depth < 10) run(subrs[a], depth + 1); break; }
        case 29: { const a = st.pop() + bias(gs); if (gs[a] && depth < 10) run(gs[a], depth + 1); break; }
        case 11: return;
        case 14: width(st.length === 1 || st.length === 5); done = true; break;
        case 12: {
          const b1 = code[i++];
          if (b1 === 34) { const [a, b, c2, d, e, f, g] = st; curve(a, 0, b, c2, d, 0); curve(e, 0, f, -c2, g, 0); }
          else if (b1 === 35) { curve(st[0], st[1], st[2], st[3], st[4], st[5]); curve(st[6], st[7], st[8], st[9], st[10], st[11]); }
          else if (b1 === 36) { const [a, b, c2, d, e, f, g, h2, k] = st; curve(a, b, c2, d, e, 0); curve(f, 0, g, h2, k, -(b + d + h2)); }
          else if (b1 === 37) {
            const sx = st[0] + st[2] + st[4] + st[6] + st[8], sy = st[1] + st[3] + st[5] + st[7] + st[9];
            curve(st[0], st[1], st[2], st[3], st[4], st[5]);
            if (Math.abs(sx) > Math.abs(sy)) curve(st[6], st[7], st[8], st[9], st[10], -sy); else curve(st[6], st[7], st[8], st[9], -sx, st[10]);
          }
          st = []; break;
        }
        default: st = [];
      }
    }
  }
  run(c.cs[gid], 0);
  if (cur && cur.length > 2) out.push(cur);
  return out;
}

// ---- font object --------------------------------------------------------------------------------------------------------------
function parse(input) {
  const b = u8(input), tb = tables(b);
  if (!tb.head || !tb.maxp || !tb.cmap) throw new Error('font has no head/maxp/cmap table');
  const upm = U16(tb.head, 18) || 1000, longLoca = S16(tb.head, 50) === 1;
  const numGlyphs = U16(tb.maxp, 4);
  const hh = tb.hhea ? { asc: S16(tb.hhea, 4), desc: S16(tb.hhea, 6), n: U16(tb.hhea, 34) } : { asc: upm * 0.8, desc: -upm * 0.2, n: 0 };
  const cff = tb['CFF '] ? cffPrepare(tb['CFF ']) : null;
  if (!cff && !(tb.glyf && tb.loca)) throw new Error('font has no outlines (bitmap-only fonts are not supported)');
  const os2 = tb['OS/2'];
  const font = {
    kind: cff ? 'cff' : 'glyf', upm, numGlyphs, ascent: hh.asc, descent: hh.desc, tables: tb,
    capHeight: os2 && os2.length >= 90 && U16(os2, 0) >= 2 ? S16(os2, 88) : 0, xHeight: os2 && os2.length >= 90 && U16(os2, 0) >= 2 ? S16(os2, 86) : 0,
    family: '', lookups: cmapLookups(tb.cmap), cache: new Map(),
  };
  if (tb.name) {
    const n = tb.name, cnt = U16(n, 2), so = U16(n, 4), names = {};
    for (let i = 0; i < cnt; i++) {
      const o = 6 + i * 12, pid = U16(n, o), id = U16(n, o + 6), len = U16(n, o + 8), off = so + U16(n, o + 10);
      let s = '';
      if (pid === 1 || pid === 0 && false) for (let k = 0; k < len; k++) s += String.fromCharCode(n[off + k]);
      else for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(U16(n, off + k));
      if (!names[id] || pid === 3) names[id] = s;
    }
    font.family = names[16] || names[1] || '';
    font.fullName = names[4] || font.family;
  }
  font.gid = (cp) => {
    for (const l of font.lookups) if (l.pid === 3 || l.pid === 0) { const g = l.fn(cp); if (g) return g; }
    if (cp < 256) for (const l of font.lookups) { const g = l.fn(cp); if (g) return g; }
    return 0;
  };
  // Pixel fonts sometimes live in the Private Use Area or a symbol cmap (3,0): F000 + code
  font.gidFor = (cp) => font.gid(cp) || font.gid(0xf000 + cp) || 0;
  font.advance = (g) => {
    const hm = tb.hmtx; if (!hm || !hh.n) return upm;
    return U16(hm, Math.min(g, hh.n - 1) * 4);
  };
  font.outline = (g) => {
    if (font.cache.has(g)) return font.cache.get(g);
    let o = [];
    try { o = cff ? cffOutline(cff, g) : glyfOutline(tb, tb.loca, longLoca, g, 0); } catch (e) { o = []; }
    font.cache.set(g, o); return o;
  };
  font.bbox = (g) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of font.outline(g)) for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  };
  font.table = (t) => tb[t] || null;
  return font;
}

// ---- rasteriser -----------------------------------------------------------------------------------------------------------------
// polys: arrays of [x, y] in pixel space (y down). Returns coverage 0..1 per pixel, non-zero winding.
function coverage(polys, W, H, SY = 8) {
  const cov = new Float32Array(W * H), edges = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      if (a[1] === c[1]) continue;
      edges.push(a[1] < c[1] ? [a[0], a[1], c[0], c[1], 1] : [c[0], c[1], a[0], a[1], -1]);
    }
  }
  if (!edges.length) return cov;
  for (let r = 0; r < H; r++) {
    for (let s = 0; s < SY; s++) {
      const y = r + (s + 0.5) / SY, xs = [];
      for (const e of edges) if (y >= e[1] && y < e[3]) xs.push([e[0] + ((y - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
      if (xs.length < 2) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let w = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        w += xs[k][1];
        if (!w) continue;
        const xa = Math.max(0, xs[k][0]), xb = Math.min(W, xs[k + 1][0]);
        if (xb <= xa) continue;
        for (let q = Math.floor(xa); q < Math.ceil(xb) && q < W; q++) cov[r * W + q] += (Math.min(q + 1, xb) - Math.max(q, xa)) / SY;
      }
    }
  }
  return cov;
}

// ---- TrueType writer ----------------------------------------------------------------------------------------------------------
const w16 = (a, v) => a.push((v >> 8) & 255, v & 255);
const w32 = (a, v) => a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const utf16 = (s) => { const a = []; for (let i = 0; i < s.length; i++) w16(a, s.charCodeAt(i)); return a; };
const pad4 = (a) => { while (a.length % 4) a.push(0); return a; };
function sum32(a) { let s = 0; for (let i = 0; i < a.length; i += 4) s = (s + (((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0)) >>> 0; return s; }

// spec: { name, upm, ascent, descent, capHeight, xHeight, glyphs: [{ unicode: [cp...], adv, contours: [[[x,y],...]] }], extra: { TAG: Uint8Array } }
// glyphs[0] is .notdef. Contours must be straight-edged integer polygons, clockwise for ink (y up).
function build(spec) {
  const G = spec.glyphs, n = G.length, upm = spec.upm;
  const glyf = [], loca = [], hmtx = [];
  let xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9, maxP = 0, maxC = 0, advMax = 0;
  for (const g of G) {
    loca.push(glyf.length);
    const cs = g.contours || [];
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, np = 0;
    for (const c of cs) for (const [x, y] of c) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); np++; }
    if (cs.length) {
      w16(glyf, cs.length); w16(glyf, bx0); w16(glyf, by0); w16(glyf, bx1); w16(glyf, by1);
      let e = -1; for (const c of cs) { e += c.length; w16(glyf, e); }
      w16(glyf, 0);
      const flags = [], xs = [], ys = []; let px = 0, py = 0;
      for (const c of cs) for (const [x, y] of c) { flags.push(1); w16(xs, x - px); w16(ys, y - py); px = x; py = y; }
      glyf.push(...flags, ...xs, ...ys);
      // deltas are written as 16-bit words: flags 1 (on curve) with neither the short nor the same bit set
      pad4(glyf);
      xMin = Math.min(xMin, bx0); yMin = Math.min(yMin, by0); xMax = Math.max(xMax, bx1); yMax = Math.max(yMax, by1);
      maxP = Math.max(maxP, np); maxC = Math.max(maxC, cs.length);
    }
    w16(hmtx, g.adv); w16(hmtx, cs.length ? bx0 : 0); advMax = Math.max(advMax, g.adv);
  }
  loca.push(glyf.length);
  if (xMin > xMax) { xMin = yMin = xMax = yMax = 0; }
  const locaB = []; for (const o of loca) w32(locaB, o);

  const map = [];
  G.forEach((g, i) => { for (const cp of g.unicode || []) if (cp < 0xffff) map.push([cp, i]); });
  map.sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [cp, gi] of map) {
    const s = segs[segs.length - 1];
    if (s && cp === s.end + 1 && gi === s.gid + (cp - s.start)) s.end = cp; else if (!s || cp > s.end) segs.push({ start: cp, end: cp, gid: gi });
  }
  segs.push({ start: 0xffff, end: 0xffff, gid: 0 });
  const sc = segs.length, cm = [];
  w16(cm, 0); w16(cm, 1); w16(cm, 3); w16(cm, 1); w32(cm, 12);
  w16(cm, 4); w16(cm, 16 + sc * 8); w16(cm, 0); w16(cm, sc * 2);
  let es = 1, ent = 0; while (es * 2 <= sc) { es *= 2; ent++; }
  w16(cm, es * 2); w16(cm, ent); w16(cm, sc * 2 - es * 2);
  for (const s of segs) w16(cm, s.end);
  w16(cm, 0);
  for (const s of segs) w16(cm, s.start);
  for (const s of segs) w16(cm, (s.gid - s.start) & 0xffff);
  for (let i = 0; i < sc; i++) w16(cm, 0);

  const head = [];
  w32(head, 0x00010000); w32(head, 0x00010000); w32(head, 0); w32(head, 0x5f0f3cf5); w16(head, 3); w16(head, upm);
  for (let i = 0; i < 4; i++) w32(head, 0);
  w16(head, xMin); w16(head, yMin); w16(head, xMax); w16(head, yMax); w16(head, 0); w16(head, 8); w16(head, 2); w16(head, 1); w16(head, 0);
  const hhea = [];
  w32(hhea, 0x00010000); w16(hhea, spec.ascent); w16(hhea, spec.descent); w16(hhea, 0); w16(hhea, advMax); w16(hhea, 0); w16(hhea, 0); w16(hhea, xMax);
  w16(hhea, 1); w16(hhea, 0); w16(hhea, 0); for (let i = 0; i < 4; i++) w16(hhea, 0); w16(hhea, 0); w16(hhea, n);
  const maxp = [];
  w32(maxp, 0x00010000); w16(maxp, n); w16(maxp, maxP); w16(maxp, maxC); for (let i = 0; i < 11; i++) w16(maxp, i === 2 ? 2 : 0);
  const os2 = [];
  w16(os2, 2); w16(os2, Math.round(advMax / 2)); w16(os2, 400); w16(os2, 5); w16(os2, 0);
  for (let i = 0; i < 10; i++) w16(os2, 0);
  w16(os2, 0); for (let i = 0; i < 10; i++) os2.push(i === 3 ? 9 : 0);
  w32(os2, 0); w32(os2, 0); w32(os2, 0); w32(os2, 0);
  os2.push(0x41, 0x43, 0x46, 0x20); w16(os2, 0x40);
  w16(os2, 32); w16(os2, 0xfffd); w16(os2, spec.ascent); w16(os2, spec.descent); w16(os2, 0); w16(os2, spec.ascent); w16(os2, -spec.descent);
  w32(os2, 1); w32(os2, 0); w16(os2, spec.xHeight || 0); w16(os2, spec.capHeight || 0); w16(os2, 32); w16(os2, 32); w16(os2, 1);
  const nm = spec.name || 'Font', recs = [[1, nm], [2, 'Regular'], [4, nm], [6, nm.replace(/[^A-Za-z0-9]/g, '')]];
  const name = []; w16(name, 0); w16(name, recs.length); w16(name, 6 + recs.length * 12);
  const strs = [];
  for (const [id, s] of recs) { const u = utf16(s); w16(name, 3); w16(name, 1); w16(name, 0x409); w16(name, id); w16(name, u.length); w16(name, strs.length); strs.push(...u); }
  name.push(...strs);
  const post = []; w32(post, 0x00030000); w32(post, 0); w16(post, -100); w16(post, 50); w32(post, 0); for (let i = 0; i < 4; i++) w32(post, 0);

  const tabs = { 'OS/2': os2, cmap: cm, glyf, head, hhea, hmtx, loca: locaB, maxp, name, post };
  for (const k of Object.keys(spec.extra || {})) tabs[k] = Array.from(spec.extra[k]);
  const tags = Object.keys(tabs).sort(), nt = tags.length;
  let s2 = 1, e2 = 0; while (s2 * 2 <= nt) { s2 *= 2; e2++; }
  const out = []; w32(out, 0x00010000); w16(out, nt); w16(out, s2 * 16); w16(out, e2); w16(out, nt * 16 - s2 * 16);
  let off = 12 + nt * 16; const bodies = [];
  for (const t of tags) {
    const body = pad4(tabs[t].slice());
    for (const c of t) out.push(c.charCodeAt(0));
    w32(out, sum32(body)); w32(out, off); w32(out, tabs[t].length);
    bodies.push(body); off += body.length;
  }
  for (const bd of bodies) for (let i = 0; i < bd.length; i++) out.push(bd[i]);
  const hd = 12 + nt * 16; let ho = hd;
  for (let i = 0; i < tags.indexOf('head'); i++) ho += bodies[i].length;
  const adj = (0xb1b0afba - sum32(pad4(out.slice()))) >>> 0;
  out[ho + 8] = adj >>> 24; out[ho + 9] = (adj >>> 16) & 255; out[ho + 10] = (adj >>> 8) & 255; out[ho + 11] = adj & 255;
  return Uint8Array.from(out);
}

module.exports = { parse, coverage, build, tables };
