// Builds a Windows TrueType font (.ttf) from Atari 8x8 character data. Each lit pixel becomes part of a square outline.
// Layout: 1024 units per em, 128 units per pixel, advance 8 pixels (monospaced). Baseline sits under row 6, so row 7 is the descender row.
// Mapping: ASCII $20-$7F show the matching Atari characters; every character is also placed at U+E000+n (normal) and U+E080+n (inverse video),
// n = screen code 0-127, so the graphics and control characters can be reached from a font-aware program.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Ttf = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const UPM = 1024, PX = 128, TOP = 7; // row r spans y = (6-r)*PX .. (7-r)*PX

  // Outline rectangles for one 8-row glyph: runs per row, merged downwards when identical.
  function rects(rows) {
    const out = []; let open = new Map();
    for (let r = 0; r <= 8; r++) {
      const runs = [];
      if (r < 8) { let x = 0; while (x < 8) { if ((rows[r] >> (7 - x)) & 1) { let e = x; while (e + 1 < 8 && (rows[r] >> (7 - e - 1)) & 1) e++; runs.push([x, e + 1]); x = e + 1; } else x++; } }
      const next = new Map();
      for (const [x0, x1] of runs) { const k = x0 + ',' + x1, o = open.get(k); if (o) { o.r1 = r + 1; next.set(k, o); open.delete(k); } else next.set(k, { x0, x1, r0: r, r1: r + 1 }); }
      for (const o of open.values()) out.push(o);
      open = next;
    }
    return out;
  }

  function glyphBytes(rows) {
    const rs = rects(rows); if (!rs.length) return { data: new Uint8Array(0), pts: 0, cts: 0, xMin: 0 };
    const pts = [], ends = [];
    for (const o of rs) {
      const x0 = o.x0 * PX, x1 = o.x1 * PX, yT = (TOP - o.r0 - 1) * PX + PX - PX, yTop = (6 - o.r0) * PX + PX, yBot = (6 - (o.r1 - 1)) * PX;
      pts.push([x0, yBot], [x0, yTop], [x1, yTop], [x1, yBot]); ends.push(pts.length - 1); void yT;
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const n = pts.length, len = 10 + ends.length * 2 + 2 + n + n * 4;
    const b = new DataView(new ArrayBuffer(len)); let o = 0;
    const i16 = (v) => { b.setInt16(o, v); o += 2; };
    i16(ends.length); i16(Math.min(...xs)); i16(Math.min(...ys)); i16(Math.max(...xs)); i16(Math.max(...ys));
    for (const e of ends) i16(e);
    i16(0);
    for (let i = 0; i < n; i++) b.setUint8(o++, 1);
    let px = 0; for (const p of pts) { i16(p[0] - px); px = p[0]; }
    let py = 0; for (const p of pts) { i16(p[1] - py); py = p[1]; }
    return { data: new Uint8Array(b.buffer), pts: n, cts: ends.length, xMin: Math.min(...xs) };
  }

  const pad4 = (u) => { const n = (3 + u.length) & ~3; if (n === u.length) return u; const r = new Uint8Array(n); r.set(u); return r; };
  const sum = (u) => { let s = 0; for (let i = 0; i < u.length; i += 4) s = (s + (((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | (u[i + 3] || 0)) >>> 0)) >>> 0; return s; };
  const u16 = (...v) => { const b = new Uint8Array(v.length * 2); v.forEach((x, i) => { b[i * 2] = (x >> 8) & 255; b[i * 2 + 1] = x & 255; }); return b; };
  const u32 = (...v) => { const b = new Uint8Array(v.length * 4); v.forEach((x, i) => { b[i * 4] = (x >>> 24) & 255; b[i * 4 + 1] = (x >>> 16) & 255; b[i * 4 + 2] = (x >>> 8) & 255; b[i * 4 + 3] = x & 255; }); return b; };
  const cat = (...a) => { const r = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { r.set(x, o); o += x.length; } return r; };
  const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return b; };

  // chars: array of 128 or 256 items of 8 bytes (Atari character set order = screen codes; 128-255 are optional inverse forms).
  function build(font, opts = {}) {
    const family = opts.family || 'Atari 8-bit', ver = opts.version || '1.0';
    const chr = (n) => Array.from(font.subarray(n * 8, n * 8 + 8));
    const faces = [{ rows: [0x7E, 0x42, 0x42, 0x42, 0x42, 0x42, 0x7E, 0], codes: [] }]; // .notdef
    const map = new Map();
    const add = (rows, codes) => { const gi = faces.length; faces.push({ rows, codes }); for (const c of codes) map.set(c, gi); };
    const asciiOf = (n) => (n < 64 ? n + 32 : n >= 96 ? n : null);
    for (let n = 0; n < 128; n++) {
      const rows = chr(n), codes = [0xE000 + n]; const a = asciiOf(n); if (a !== null && a < 0x80) codes.push(a);
      add(rows, codes);
      add(rows.map((r) => (~r) & 255), [0xE080 + n]);
    }
    const gl = faces.map((f) => glyphBytes(f.rows));
    let off = 0; const loca = [0], glyf = [];
    for (const g of gl) { const d = pad4(g.data); glyf.push(d); off += d.length; loca.push(off); }
    const nG = faces.length;
    const hmtx = cat(...gl.map((g) => u16(UPM, g.xMin)));
    const maxPts = Math.max(...gl.map((g) => g.pts)), maxCts = Math.max(...gl.map((g) => g.cts));

    // cmap format 4: one segment per code
    const codes = [...map.keys()].sort((a, b) => a - b), segs = codes.map((c) => ({ c, d: (map.get(c) - c) & 0xFFFF }));
    segs.push({ c: 0xFFFF, d: 1 });
    const sc = segs.length, sr = 2 ** Math.floor(Math.log2(sc)) * 2;
    const f4 = cat(u16(4, 16 + sc * 8, 0, sc * 2, sr, Math.log2(sr / 2), sc * 2 - sr), u16(...segs.map((s) => s.c)), u16(0), u16(...segs.map((s) => s.c)), u16(...segs.map((s) => s.d)), u16(...segs.map(() => 0)));
    const cmap = cat(u16(0, 1, 3, 1), u32(12), f4);

    const t = Math.floor(Date.now() / 1000) + 2082844800;
    const head = cat(u32(0x00010000, 0x00010000, 0, 0x5F0F3CF5), u16(3, UPM), u32(0, t, 0, t), u16(0, -PX & 0xFFFF, 8 * PX, 8 * PX, 0, 8, 2, 1, 0));
    const hhea = cat(u32(0x00010000), u16(7 * PX, (-PX) & 0xFFFF, 0, UPM, 0, 0, 8 * PX, 1, 0, 0, 0, 0, 0, 0, 0, nG));
    const maxp = cat(u32(0x00010000), u16(nG, maxPts, maxCts, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0));
    const os2 = cat(u16(3, UPM, 400, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, PX, 3 * PX), u16(0), new Uint8Array([2, 0, 0, 9, 0, 0, 0, 0, 0, 0]), u32(1, 1 << 28, 0, 0), new Uint8Array([0x41, 0x43, 0x52, 0x46]), u16(0x40, 0x20, 0xF8FF, 7 * PX, (-PX) & 0xFFFF, 0, 7 * PX, PX, 1, 0), u32(0x1, 0), u16(5 * PX, 7 * PX, 0x20, 0x20, 1));
    const post = cat(u32(0x00030000, 0, 0), u16((-PX) & 0xFFFF, PX / 2), u32(1, 0, 0, 0, 0));
    const names = [[1, family], [2, 'Regular'], [3, family + ' ' + ver], [4, family], [5, 'Version ' + ver], [6, family.replace(/[^A-Za-z0-9]/g, '') + '-Regular']];
    const strs = names.map(([, s]) => utf16(s)); let so = 0; const recs = [];
    names.forEach(([id], i) => { recs.push(u16(3, 1, 0x409, id, strs[i].length, so)); so += strs[i].length; });
    const name = cat(u16(0, names.length, 6 + names.length * 12), ...recs, ...strs);

    const tables = { 'OS/2': os2, cmap, glyf: cat(...glyf), head, hhea, hmtx, loca: u32(...loca), maxp, name, post };
    const tags = Object.keys(tables).sort(), n = tags.length, sr2 = 2 ** Math.floor(Math.log2(n)) * 16;
    let pos = 12 + n * 16; const dir = [], body = [];
    for (const tg of tags) { const d = pad4(tables[tg]); dir.push(cat(new Uint8Array([...tg].map((c) => c.charCodeAt(0))), u32(sum(d), pos, tables[tg].length))); body.push(d); pos += d.length; }
    const out = cat(u32(0x00010000), u16(n, sr2, Math.log2(sr2 / 16), n * 16 - sr2), ...dir, ...body);
    const hi = 12 + tags.indexOf('head') * 16, hp = (out[hi + 8] << 24 | out[hi + 9] << 16 | out[hi + 10] << 8 | out[hi + 11]) >>> 0;
    const adj = (0xB1B0AFBA - sum(out)) >>> 0; out.set(u32(adj), hp + 8);
    return out;
  }
  return { build };
});
