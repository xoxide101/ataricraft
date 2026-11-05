// Craft font model (docs/FONT.md): fixed-width bitmap fonts with explicit metrics (headroom, cap, x-height, baseline,
// descender rows), a code -> glyph-slot map (where the real upper and lower case glyphs live), sup/sub offsets,
// the ACF2 binary file, JSON, the 6502 .inc, ACF1 import and the built-in fonts. DOM-free (rasterTtf needs a browser).
'use strict';

const MAGIC2 = 'ACF2';
const ROWS = 12, HEAD = 2, XTOP = 4, BASE = 8, DESC = 3;
const zeros = (n) => new Array(n).fill(0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Size set (docs/FONT.md). 12x12 is the master a family is designed on; the others are derived from it.
// Tall sizes: 2 headroom rows / 8 body rows (cap line row 2 .. baseline row 9) / 2 descender rows.
// Small faces and the 8x8 Atari size: 2 / 7 / 3 (baseline row 8), the cell the 6502 planes use.
const SIZES = {
  12: { adv: 12, gw: 10, rows: 12, head: 2, xTop: 4, base: 9, desc: 2, supUp: 2, subDown: 2, label: '12x12 (master)' },
  10: { adv: 10, gw: 8, rows: 12, head: 2, xTop: 4, base: 9, desc: 2, supUp: 2, subDown: 2, label: '10x12' },
  8: { adv: 8, gw: 8, rows: 12, head: 2, xTop: 4, base: 8, desc: 3, supUp: 2, subDown: 3, label: '8x8 (Atari)' },
  6: { adv: 6, gw: 5, rows: 12, head: 2, xTop: 4, base: 8, desc: 3, supUp: 2, subDown: 3, label: '6 px overview' },
  5: { adv: 5, gw: 4, rows: 12, head: 2, xTop: 4, base: 8, desc: 3, supUp: 2, subDown: 3, label: '5 px overview' },
  4: { adv: 4, gw: 3, rows: 12, head: 2, xTop: 4, base: 8, desc: 3, supUp: 2, subDown: 3, label: '4 px overview' },
};
// origin: 0 master (hand drawn / rasterised), 1 derived from the master, 2 hand-edited after deriving
const ORIGIN = { master: 0, derived: 1, hand: 2 };

// Rows are one byte (bit 7 = leftmost pixel) when the glyph is at most 8 px wide, otherwise two bytes (bit 15 = leftmost).
const isWide = (f) => f.gw > 8;
const topBit = (f) => (isWide(f) ? 0x8000 : 0x80);
const bitMask = (f, q) => topBit(f) >> q;
const fullMask = (f) => (isWide(f) ? 0xffff : 0xff) & ~((isWide(f) ? 0xffff : 0xff) >> f.gw);
const hasPx = (f, row, q) => !!(row & bitMask(f, q));

// Standard metrics: cell rows 0..11: 0-1 headroom, 2-8 capitals (cap line row 2, baseline row 8), x-height line row 4, 9-11 descender.
function create(opt = {}) {
  const adv = opt.adv || 5;
  const f = {
    name: opt.name || 'Untitled', adv, gw: opt.gw || adv - 1, rows: opt.rows || ROWS, head: opt.head ?? HEAD, xTop: opt.xTop ?? XTOP,
    base: opt.base ?? BASE, desc: opt.desc ?? DESC, supUp: opt.supUp ?? 2, subDown: opt.subDown ?? 3,
    first: opt.first ?? 32, count: opt.count ?? 96, upper: 65, lower: 97,
    origin: opt.origin ?? 0, locked: !!opt.locked, masterAdv: opt.masterAdv ?? 0,
    glyphs: [], map: [], sup: {}, sub: {},
  };
  for (let i = 0; i < 256; i++) { f.glyphs.push(zeros(f.rows)); f.map.push(i); }
  return f;
}
const createSize = (size, opt = {}) => create(Object.assign({}, SIZES[size], opt));

const slotOf = (f, code) => f.map[code & 255];
function glyph(f, code) { return f.glyphs[slotOf(f, code)] || zeros(f.rows); }

function shift(rows, dy) {
  const n = rows.length, out = zeros(n);
  for (let r = 0; r < n; r++) { const s = r - dy; if (s >= 0 && s < n) out[r] = rows[s]; }
  return out;
}

// mode: 0 normal, 1 superscript, 2 subscript. A per-glyph variant wins; otherwise the glyph is shifted into the headroom / descender rows.
function render(f, code, mode = 0) {
  if (mode === 1) return f.sup[code] ? f.sup[code].slice() : shift(glyph(f, code), -f.supUp);
  if (mode === 2) return f.sub[code] ? f.sub[code].slice() : shift(glyph(f, code), f.subDown);
  return glyph(f, code).slice();
}

// Moves/copies the glyphs currently shown for `from..from+n-1` to slots `to..` and points the map at them.
function place(f, fromCode, n, toSlot) {
  const src = [];
  for (let i = 0; i < n; i++) src.push(glyph(f, fromCode + i).slice());
  for (let i = 0; i < n; i++) { f.glyphs[toSlot + i] = src[i]; f.map[fromCode + i] = toSlot + i; }
  if (fromCode === 65) f.upper = toSlot;
  if (fromCode === 97) f.lower = toSlot;
}

function setCase(f, kind, slot) {
  if (kind === 'upper') { place(f, 65, 26, slot); f.upper = slot; } else { place(f, 97, 26, slot); f.lower = slot; }
}

function isDefaultMap(f) { return f.map.every((v, i) => v === i); }

const rowBytes = (f, r) => (isWide(f) ? [(r >> 8) & 255, r & 255] : [r & 255]);
const glyphBytes = (f, g) => Buffer.from([].concat(...g.map((r) => rowBytes(f, r))));

function serialize(f) {
  const nm = Buffer.from(f.name.slice(0, 40), 'latin1');
  const hasMap = !isDefaultMap(f);
  const vars = [];
  for (const [kind, tab] of [[1, f.sup], [2, f.sub]]) for (const c of Object.keys(tab)) vars.push([+c, kind, tab[c]]);
  const hasMeta = f.origin || f.locked || f.masterAdv;
  const flags = (hasMap ? 1 : 0) | (vars.length ? 2 : 0) | (isWide(f) ? 4 : 0) | (hasMeta ? 8 : 0);
  const head = Buffer.from([f.adv, f.gw, f.rows, f.head, f.xTop, f.base, f.desc, f.supUp & 255, f.subDown & 255, f.first, f.count & 255, flags, f.upper & 255, f.lower & 255, nm.length]);
  const parts = [Buffer.from(MAGIC2, 'latin1'), head, nm];
  if (hasMeta) parts.push(Buffer.from([f.origin & 255, f.locked ? 1 : 0, f.masterAdv & 255]));
  if (hasMap) parts.push(Buffer.from(f.map));
  for (let i = 0; i < f.count; i++) parts.push(glyphBytes(f, f.glyphs[f.first + i] || zeros(f.rows)));
  if (vars.length) {
    parts.push(Buffer.from([vars.length]));
    for (const [c, k, r] of vars) parts.push(Buffer.from([c, k]), glyphBytes(f, r));
  }
  return Buffer.concat(parts);
}

const s8 = (v) => (v > 127 ? v - 256 : v);

function parse(buf) {
  buf = Buffer.from(buf);
  const magic = buf.toString('latin1', 0, 4);
  if (magic === 'ACF1') return fromAcf1(buf, 0);
  if (magic !== MAGIC2) throw new Error('not an ACF font (' + JSON.stringify(magic) + ')');
  let p = 4;
  const b = () => buf[p++];
  const adv = b(), gw = b(), rows = b(), head = b(), xTop = b(), base = b(), desc = b(), supUp = s8(b()), subDown = s8(b());
  const first = b(), count = b() || 256, flags = b(), upper = b(), lower = b(), nl = b();
  const name = buf.toString('latin1', p, p + nl); p += nl;
  const f = create({ adv, gw, rows, head, xTop, base, desc, supUp, subDown, first, count, name });
  f.upper = upper; f.lower = lower;
  if (flags & 8) { f.origin = b(); f.locked = !!b(); f.masterAdv = b(); }
  const bpr = isWide(f) ? 2 : 1;
  const rowsAt = () => { const o = []; for (let r = 0; r < rows; r++) { o.push(bpr === 2 ? (buf[p] << 8) | buf[p + 1] : buf[p]); p += bpr; } return o; };
  if (flags & 1) { for (let i = 0; i < 256; i++) f.map[i] = b(); }
  for (let i = 0; i < count; i++) f.glyphs[first + i] = rowsAt();
  if (flags & 2) {
    const n = b();
    for (let i = 0; i < n; i++) { const c = b(), k = b(); (k === 1 ? f.sup : f.sub)[c] = rowsAt(); }
  }
  if (p > buf.length) throw new Error('ACF2 truncated');
  return f;
}

// Legacy ttf2acf output: "ACF1", u8 nsizes, then per size u8 W, u8 H, u8 bytesPerRow and 96 glyphs. One size becomes a font;
// metrics are inferred from the height (a sixth headroom, a quarter descender) because the old file has none.
function fromAcf1(buf, sizeIndex = 0) {
  buf = Buffer.from(buf);
  let p = 5;
  const n = buf[4];
  for (let s = 0; s < n; s++) {
    const W = buf[p], H = buf[p + 1], bpr = buf[p + 2]; p += 3;
    const len = 96 * H * bpr;
    if (s === sizeIndex) {
      const desc = Math.max(1, Math.round(H / 4)), head = Math.round(H / 6), base = H - desc - 1;
      const f = create({ adv: W, gw: W, rows: H, head, desc, base, xTop: Math.round(head + (base - head + 1) * 0.3), supUp: head, subDown: desc, name: 'ACF1 ' + W + 'x' + H });
      for (let g = 0; g < 96; g++) {
        const rws = [];
        for (let r = 0; r < H; r++) rws.push(buf[p + (g * H + r) * bpr]);
        f.glyphs[32 + g] = rws;
      }
      f.acf1 = { sizes: n, bpr };
      return f;
    }
    p += len;
  }
  throw new Error('ACF1 size index out of range');
}

function acf1Sizes(buf) {
  buf = Buffer.from(buf); const out = []; let p = 5;
  for (let s = 0; s < buf[4]; s++) { out.push({ W: buf[p], H: buf[p + 1] }); p += 3 + 96 * buf[p + 1] * buf[p + 2]; }
  return out;
}

const hex = (a, w = 2) => a.map((v) => v.toString(16).padStart(w, '0')).join('');
const unhex = (s, w = 2) => (s.match(new RegExp('.{' + w + '}', 'g')) || []).map((h) => parseInt(h, 16));

function toJson(f) {
  const w = isWide(f) ? 4 : 2;
  const o = { format: 'craft-font', version: 2, name: f.name, adv: f.adv, gw: f.gw, rows: f.rows, head: f.head, xTop: f.xTop, base: f.base, desc: f.desc,
    supUp: f.supUp, subDown: f.subDown, first: f.first, count: f.count, upper: f.upper, lower: f.lower, origin: f.origin, locked: f.locked, masterAdv: f.masterAdv, glyphs: {}, sup: {}, sub: {} };
  if (!isDefaultMap(f)) o.map = f.map.slice();
  for (let i = 0; i < f.count; i++) o.glyphs[f.first + i] = hex(f.glyphs[f.first + i], w);
  for (const c of Object.keys(f.sup)) o.sup[c] = hex(f.sup[c], w);
  for (const c of Object.keys(f.sub)) o.sub[c] = hex(f.sub[c], w);
  return JSON.stringify(o, null, 1);
}

function fromJson(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format !== 'craft-font') throw new Error('not a craft-font JSON');
  const f = create(o);
  const w = isWide(f) ? 4 : 2;
  f.upper = o.upper ?? 65; f.lower = o.lower ?? 97;
  if (o.map) f.map = o.map.slice();
  for (const k of Object.keys(o.glyphs)) f.glyphs[+k] = unhex(o.glyphs[k], w);
  for (const c of Object.keys(o.sup || {})) f.sup[+c] = unhex(o.sup[c], w);
  for (const c of Object.keys(o.sub || {})) f.sub[+c] = unhex(o.sub[c], w);
  return f;
}

// 6502 data: one plane per cell row (prefix_0 .. prefix_<rows-1>), `count` bytes each, pixels MSB-left (bit 7 = leftmost);
// a wide font (glyph over 8 px) adds a second plane per row, prefix_<r>L, with columns 8-15.
// prefix_map = code -> slot offset (slot - first) for all 256 codes, 255 where the slot is outside the stored range.
function toInc(f, prefix = 'cf') {
  let o = '; generated from Craft font "' + f.name + '" (docs/FONT.md) - do not edit\n';
  o += prefix + '_ADV = ' + f.adv + '\n' + prefix + '_GW = ' + f.gw + '\n' + prefix + '_ROWS = ' + f.rows + '\n' + prefix + '_HEAD = ' + f.head + '\n';
  o += prefix + '_XTOP = ' + f.xTop + '\n' + prefix + '_BASE = ' + f.base + '\n' + prefix + '_DESC = ' + f.desc + '\n';
  o += prefix + '_SUPUP = ' + f.supUp + '\n' + prefix + '_SUBDN = ' + f.subDown + '\n' + prefix + '_FIRST = ' + f.first + '\n' + prefix + '_COUNT = ' + f.count + '\n';
  const wide = isWide(f);
  const plane = (name, fn) => {
    o += name + ':\n';
    for (let i = 0; i < f.count; i += 16) {
      const n = Math.min(16, f.count - i);
      o += '        .byte ' + Array.from({ length: n }, (_, k) => fn((f.glyphs[f.first + i + k] || [])) ).join(',') + '\n';
    }
  };
  for (let r = 0; r < f.rows; r++) {
    plane(prefix + '_' + r, (g) => (wide ? ((g[r] || 0) >> 8) & 255 : (g[r] || 0) & 255));
    if (wide) plane(prefix + '_' + r + 'L', (g) => (g[r] || 0) & 255);
  }
  o += prefix + '_map:\n';
  for (let i = 0; i < 256; i += 16) {
    o += '        .byte ' + Array.from({ length: 16 }, (_, k) => { const s = f.map[i + k] - f.first; return s >= 0 && s < f.count ? s : 255; }).join(',') + '\n';
  }
  return o;
}

// ---- built-in fonts: derived from the Atari 8x8 font (web/library/fonts/atari/AtariPixel8.fnt) -------------------------
const DESC_LETTERS = 'gjpqy';

function atariRows(fnt, a) {
  const sc = a < 32 ? a + 64 : a < 96 ? a - 32 : a;
  return Array.from(fnt.slice(sc * 8, sc * 8 + 8));
}

// Hand-tuned glyphs for the 3 px wide face (17 cpi), where the automatic column merge turns m / w / M / W into blocks.
const NARROW = {
  m: ['#.#', '###', '###', '#.#', '#.#'], w: ['#.#', '#.#', '###', '###', '#.#'],
  M: ['#.#', '###', '###', '###', '#.#', '#.#', '#.#'], W: ['#.#', '#.#', '#.#', '###', '###', '###', '#.#'],
};

// 8x8 glyph (7 usable columns) -> gw columns
function cols(b, gw) {
  const c = (k) => (b >> (7 - k)) & 1;
  let o;
  if (gw === 5) o = [c(0) | c(1), c(2), c(3), c(4), c(5) | c(6)];
  else if (gw === 4) o = [c(0) | c(1), c(2), c(3), c(4) | c(5)];
  else o = [c(0) | c(1), c(2) | c(3) | c(4), c(5) | c(6)];
  return o.reduce((v, bit, i) => v | (bit << (7 - i)), 0);
}

// `f4rows`: optional existing hand-tuned 4x7 glyphs for gw 4 (tools/acwriter/font4.json, 96 entries of 7 nibbles, bit 3 = left pixel).
function builtin(fnt, adv, f4rows) {
  const gw = adv - 1, f = create({ adv, gw, name: 'Craft ' + adv + 'px' });
  for (let a = 32; a < 128; a++) {
    const r = atariRows(fnt, a), ch = String.fromCharCode(a), g = zeros(ROWS);
    if (DESC_LETTERS.includes(ch)) {
      const body = [r[2], r[3], r[3], r[4], r[5]], tail = [r[6], r[6], r[7]];
      body.concat(tail).forEach((b, i) => { g[XTOP + i] = cols(b, gw); });
    } else if (gw === 4 && f4rows && r[7] === 0) {
      f4rows[a - 32].forEach((nib, i) => { g[HEAD + i] = nib << 4; });
    } else {
      r.forEach((b, i) => { g[HEAD + i] = cols(b, gw); });
    }
    f.glyphs[a] = g;
  }
  if (gw === 3) for (const [ch, pat] of Object.entries(NARROW)) {
    const top = ch >= 'a' ? XTOP : HEAD, g = zeros(ROWS);
    pat.forEach((s, i) => { g[top + i] = [...s].reduce((v, c, q) => v | (c === '#' ? 0x80 >> q : 0), 0); });
    f.glyphs[ch.charCodeAt(0)] = g;
  }
  return f;
}

// ---- TTF rasteriser (browser only; also injected into Chrome by ttf2acf.cjs) --------------------------------------------
// Returns a font in one of the SIZES (opt.size or opt.adv: 12 is the master): capitals are scaled to the cap rows, then the glyph is
// squeezed horizontally into gw columns. Controls: threshold (coverage 0..1 that turns a pixel on), weight (0 normal, 1-3 bolder,
// -1 lighter) and hint (stretch vertically so the x-height lands on a whole number of rows).
async function rasterTtf(b64, opt) {
  const size = opt.size || opt.adv || 5, spec = SIZES[size] || { adv: size, gw: opt.gw || size - 1, rows: ROWS, head: HEAD, xTop: XTOP, base: BASE, desc: DESC, supUp: 2, subDown: 3 };
  const adv = spec.adv, gw = opt.gw || spec.gw, name = opt.name || 'TTF', rows = spec.rows, head = spec.head, base = spec.base, xTop = spec.xTop;
  const ff = new FontFace('CFRaster', 'url(data:font/ttf;base64,' + b64 + ')');
  await ff.load(); document.fonts.add(ff);
  const ref = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ref.font = '200px CFRaster';
  const capH = ref.measureText('H').actualBoundingBoxAscent || 140;
  const capRows = base - head + 1, fsz = (200 * capRows) / capH;
  const nW = ref.measureText('n').width * fsz / 200;
  let sy = 1;
  if (opt.hint) {
    const xH = (ref.measureText('x').actualBoundingBoxAscent || capH * 0.7) / capH * capRows, want = Math.max(1, Math.round(xH));
    sy = want / xH;
  }
  const f = create(Object.assign({}, spec, { gw, name, masterAdv: size === 12 ? 0 : 12 })), S = 4, th = opt.threshold ?? 0.3, wt = opt.weight || 0;
  const c = document.createElement('canvas'); c.width = gw * S; c.height = rows * S;
  const x = c.getContext('2d', { willReadFrequently: true });
  for (let a = 32; a < 128; a++) {
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.strokeStyle = '#000'; x.font = fsz * S + 'px CFRaster'; x.textBaseline = 'alphabetic';
    const s = String.fromCharCode(a), raw = Math.max(0.01, x.measureText(s).width / S);
    const gx = Math.min((gw * 0.92) / nW, gw / raw);
    x.save(); x.translate(Math.max(0, (gw - raw * gx) / 2) * S, (base + 1) * S); x.scale(gx, sy);
    x.fillText(s, 0, 0);
    if (wt) { x.lineWidth = Math.abs(wt) * 0.12 * S; if (wt > 0) x.strokeText(s, 0, 0); }
    x.restore();
    const d = x.getImageData(0, 0, c.width, c.height).data, g = zeros(rows), top = gw > 8 ? 0x8000 : 0x80, cv = [];
    let mx = 0;
    for (let r = 0; r < rows; r++) for (let q = 0; q < gw; q++) {
      let cov = 0;
      for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) cov += d[((r * S + v) * c.width + q * S + u) * 4 + 3];
      cov /= 255 * S * S; cv.push(cov); if (cov > mx) mx = cov;
      if (cov >= th - (wt < 0 ? wt * 0.08 : 0)) g[r] |= top >> q;
    }
    // faint but real ink (thin underscore, hyphen) must not vanish: keep its strongest pixels
    if (!g.some((v) => v) && mx > 0.05) for (let i = 0; i < cv.length; i++) if (cv[i] >= mx * 0.6) g[(i / gw) | 0] |= top >> (i % gw);
    f.glyphs[a] = g;
  }
  return f;
}

// ---- derived sizes ------------------------------------------------------------------------------------------------------
// Band-wise downscale of a font into another size: headroom, cap-line-to-baseline and descender bands each map onto the target's
// band, columns map ink width onto ink width. A target pixel is on when its coverage reaches `threshold`; `keepStems` also keeps a
// pixel with at least a quarter coverage that has no inked neighbour on either side, so one-pixel stems never vanish.
function deriveGlyph(src, dst, rows, opt) {
  const th = opt.threshold ?? 0.4, keep = opt.keepStems !== false;
  const bands = (f) => [[0, f.head], [f.head, f.base + 1], [f.base + 1, f.rows]];
  const sb = bands(src), db = bands(dst), out = zeros(dst.rows);
  const cov = [];
  for (let r = 0; r < dst.rows; r++) {
    const bi = db.findIndex(([a, b]) => r >= a && r < b);
    const [da, dbb] = db[bi], [sa, sbb] = sb[bi];
    const y0 = sa + ((r - da) / (dbb - da)) * (sbb - sa), y1 = sa + ((r - da + 1) / (dbb - da)) * (sbb - sa);
    const row = [];
    for (let q = 0; q < dst.gw; q++) {
      const x0 = (q / dst.gw) * src.gw, x1 = ((q + 1) / dst.gw) * src.gw;
      let sum = 0, area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1) && yy < src.rows; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1) && xx < src.gw; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), w = wx * wy;
          area += w; if (hasPx(src, rows[yy], xx)) sum += w;
        }
      }
      row.push(area ? sum / area : 0);
    }
    cov.push(row);
  }
  const top = topBit(dst);
  for (let r = 0; r < dst.rows; r++) {
    for (let q = 0; q < dst.gw; q++) {
      const v = cov[r][q];
      const lone = keep && v >= 0.25 && (q === 0 || cov[r][q - 1] < th) && (q === dst.gw - 1 || cov[r][q + 1] < th);
      if (v >= th || lone) out[r] |= top >> q;
    }
  }
  return out;
}

// Derive `size` (see SIZES) from a master font. Copies the code map, case locations, sup/sub offsets and variants.
function derive(master, size, opt = {}) {
  const spec = SIZES[size]; if (!spec) throw new Error('unknown size ' + size);
  const f = create(Object.assign({}, spec, { name: master.name.replace(/ \d+x\d+.*$/, '') + ' ' + spec.label.split(' ')[0], first: master.first, count: master.count, origin: ORIGIN.derived, masterAdv: master.adv }));
  f.map = master.map.slice(); f.upper = master.upper; f.lower = master.lower;
  for (let s = 0; s < 256; s++) if (master.glyphs[s] && master.glyphs[s].some((v) => v)) f.glyphs[s] = deriveGlyph(master, f, master.glyphs[s], opt);
  for (const [k, tab, out] of [[1, master.sup, f.sup], [2, master.sub, f.sub]]) for (const c of Object.keys(tab)) out[c] = deriveGlyph(master, f, tab[c], opt);
  return f;
}

// A family: one master plus the derived sizes. A derived size that was hand-edited (origin 2) or locked is not overwritten by a re-derive
// unless `force` is set.
function familyNew(master, name) {
  const fam = { format: 'craft-family', version: 1, name: name || master.name, master: master.adv, sizes: {} };
  fam.sizes[master.adv] = master; return fam;
}
function familyDerive(fam, sizes, opt = {}) {
  const m = fam.sizes[fam.master], done = [], skipped = [];
  for (const sz of sizes || Object.keys(SIZES).map(Number)) {
    if (sz === fam.master) continue;
    const cur = fam.sizes[sz];
    if (cur && !opt.force && (cur.locked || cur.origin === ORIGIN.hand)) { skipped.push(sz); continue; }
    const d = derive(m, sz, opt); if (cur) d.locked = false;
    fam.sizes[sz] = d; done.push(sz);
  }
  return { done, skipped };
}
// Call after editing a glyph of a derived size: marks it hand-edited.
function markEdited(f) { if (f.origin === ORIGIN.derived) f.origin = ORIGIN.hand; }
function familyToJson(fam) {
  const o = { format: fam.format, version: 1, name: fam.name, master: fam.master, sizes: {} };
  for (const k of Object.keys(fam.sizes)) o.sizes[k] = JSON.parse(toJson(fam.sizes[k]));
  return JSON.stringify(o, null, 1);
}
function familyFromJson(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format !== 'craft-family') throw new Error('not a craft-family JSON');
  const fam = { format: o.format, version: 1, name: o.name, master: o.master, sizes: {} };
  for (const k of Object.keys(o.sizes)) fam.sizes[k] = fromJson(o.sizes[k]);
  return fam;
}

// Atari charset binary (.fnt, 1024 bytes = 128 glyphs in screen-code order; a 2 KB file uses its first half) -> 8 px Craft font.
// Rows go straight into the cell from the headroom down: capitals land on the cap line, the baseline falls on row 8 and the
// 7th/8th rows of g j p q y use the descender rows. ATASCII 0-31 (graphics glyphs) are kept in slots 0-31.
function fromFnt(buf, opt = {}) {
  buf = Buffer.from(buf);
  if (buf.length !== 1024 && buf.length !== 2048) throw new Error('not an Atari charset (' + buf.length + ' bytes, expected 1024 or 2048)');
  const f = create({ adv: 8, gw: 8, name: (opt.name || 'Atari charset').slice(0, 40), first: 0, count: 128 });
  for (let a = 0; a < 128; a++) {
    const r = atariRows(buf, a), g = zeros(ROWS);
    r.forEach((b, i) => { g[HEAD + i] = b; });
    f.glyphs[a] = g;
  }
  return f;
}

module.exports = { create, createSize, glyph, render, shift, place, setCase, slotOf, serialize, parse, fromAcf1, acf1Sizes, toJson, fromJson, toInc, builtin, fromFnt, rasterTtf, derive, deriveGlyph, familyNew, familyDerive, familyToJson, familyFromJson, markEdited, isWide, topBit, bitMask, fullMask, hasPx, SIZES, ORIGIN, isDefaultMap, METRICS: { ROWS, HEAD, XTOP, BASE, DESC }, MAGIC2, clamp };
