// Craft font model (docs/FONT.md): fixed-width bitmap fonts with explicit metrics (headroom, cap, x-height, baseline,
// descender rows), a code -> glyph-slot map (where the real upper and lower case glyphs live), sup/sub offsets,
// the ACF2 binary file, JSON, the 6502 .inc, ACF1 import and the built-in fonts. DOM-free (rasterTtf needs a browser).
'use strict';

const MAGIC2 = 'ACF2';
const ROWS = 12, HEAD = 2, XTOP = 4, BASE = 8, DESC = 3;
const zeros = (n) => new Array(n).fill(0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Standard metrics: cell rows 0..11: 0-1 headroom, 2-8 capitals (cap line row 2, baseline row 8), x-height line row 4, 9-11 descender.
function create(opt = {}) {
  const adv = opt.adv || 5;
  const f = {
    name: opt.name || 'Untitled', adv, gw: opt.gw || adv - 1, rows: opt.rows || ROWS, head: opt.head ?? HEAD, xTop: opt.xTop ?? XTOP,
    base: opt.base ?? BASE, desc: opt.desc ?? DESC, supUp: opt.supUp ?? 2, subDown: opt.subDown ?? 3,
    first: opt.first ?? 32, count: opt.count ?? 96, upper: 65, lower: 97,
    glyphs: [], map: [], sup: {}, sub: {},
  };
  for (let i = 0; i < 256; i++) { f.glyphs.push(zeros(f.rows)); f.map.push(i); }
  return f;
}

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

function serialize(f) {
  const nm = Buffer.from(f.name.slice(0, 40), 'latin1');
  const hasMap = !isDefaultMap(f);
  const vars = [];
  for (const [kind, tab] of [[1, f.sup], [2, f.sub]]) for (const c of Object.keys(tab)) vars.push([+c, kind, tab[c]]);
  const flags = (hasMap ? 1 : 0) | (vars.length ? 2 : 0);
  const head = Buffer.from([f.adv, f.gw, f.rows, f.head, f.xTop, f.base, f.desc, f.supUp & 255, f.subDown & 255, f.first, f.count & 255, flags, f.upper & 255, f.lower & 255, nm.length]);
  const parts = [Buffer.from(MAGIC2, 'latin1'), head, nm];
  if (hasMap) parts.push(Buffer.from(f.map));
  for (let i = 0; i < f.count; i++) parts.push(Buffer.from(f.glyphs[f.first + i] || zeros(f.rows)));
  if (vars.length) {
    parts.push(Buffer.from([vars.length]));
    for (const [c, k, r] of vars) parts.push(Buffer.from([c, k]), Buffer.from(r));
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
  if (flags & 1) { for (let i = 0; i < 256; i++) f.map[i] = b(); }
  for (let i = 0; i < count; i++) { f.glyphs[first + i] = Array.from(buf.subarray(p, p + rows)); p += rows; }
  if (flags & 2) {
    const n = b();
    for (let i = 0; i < n; i++) { const c = b(), k = b(); (k === 1 ? f.sup : f.sub)[c] = Array.from(buf.subarray(p, p + rows)); p += rows; }
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

const hex = (a) => a.map((v) => v.toString(16).padStart(2, '0')).join('');
const unhex = (s) => (s.match(/../g) || []).map((h) => parseInt(h, 16));

function toJson(f) {
  const o = { format: 'craft-font', version: 2, name: f.name, adv: f.adv, gw: f.gw, rows: f.rows, head: f.head, xTop: f.xTop, base: f.base, desc: f.desc,
    supUp: f.supUp, subDown: f.subDown, first: f.first, count: f.count, upper: f.upper, lower: f.lower, glyphs: {}, sup: {}, sub: {} };
  if (!isDefaultMap(f)) o.map = f.map.slice();
  for (let i = 0; i < f.count; i++) o.glyphs[f.first + i] = hex(f.glyphs[f.first + i]);
  for (const c of Object.keys(f.sup)) o.sup[c] = hex(f.sup[c]);
  for (const c of Object.keys(f.sub)) o.sub[c] = hex(f.sub[c]);
  return JSON.stringify(o, null, 1);
}

function fromJson(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format !== 'craft-font') throw new Error('not a craft-font JSON');
  const f = create(o);
  f.upper = o.upper ?? 65; f.lower = o.lower ?? 97;
  if (o.map) f.map = o.map.slice();
  for (const k of Object.keys(o.glyphs)) f.glyphs[+k] = unhex(o.glyphs[k]);
  for (const c of Object.keys(o.sup || {})) f.sup[+c] = unhex(o.sup[c]);
  for (const c of Object.keys(o.sub || {})) f.sub[+c] = unhex(o.sub[c]);
  return f;
}

// 6502 data: one plane per cell row (prefix_0 .. prefix_<rows-1>), `count` bytes each, pixels MSB-left (bit 7 = leftmost);
// prefix_map = code -> slot offset (slot - first) for all 256 codes, 255 where the slot is outside the stored range.
function toInc(f, prefix = 'cf') {
  let o = '; generated from Craft font "' + f.name + '" (docs/FONT.md) - do not edit\n';
  o += prefix + '_ADV = ' + f.adv + '\n' + prefix + '_GW = ' + f.gw + '\n' + prefix + '_ROWS = ' + f.rows + '\n' + prefix + '_HEAD = ' + f.head + '\n';
  o += prefix + '_XTOP = ' + f.xTop + '\n' + prefix + '_BASE = ' + f.base + '\n' + prefix + '_DESC = ' + f.desc + '\n';
  o += prefix + '_SUPUP = ' + f.supUp + '\n' + prefix + '_SUBDN = ' + f.subDown + '\n' + prefix + '_FIRST = ' + f.first + '\n' + prefix + '_COUNT = ' + f.count + '\n';
  for (let r = 0; r < f.rows; r++) {
    o += prefix + '_' + r + ':\n';
    for (let i = 0; i < f.count; i += 16) {
      const n = Math.min(16, f.count - i);
      o += '        .byte ' + Array.from({ length: n }, (_, k) => (f.glyphs[f.first + i + k] || [])[r] || 0).join(',') + '\n';
    }
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
// Returns a font: capitals are scaled to the cap rows, then the glyph is squeezed horizontally into gw columns.
async function rasterTtf(b64, opt) {
  const adv = opt.adv || 5, gw = opt.gw || adv - 1, name = opt.name || 'TTF';
  const ff = new FontFace('CFRaster', 'url(data:font/ttf;base64,' + b64 + ')');
  await ff.load(); document.fonts.add(ff);
  const ref = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ref.font = '200px CFRaster';
  const capH = ref.measureText('H').actualBoundingBoxAscent || 140;
  const capRows = BASE - HEAD + 1, fsz = (200 * capRows) / capH;
  const nW = ref.measureText('n').width * fsz / 200;
  const f = create({ adv, gw, name }), S = 4, th = opt.threshold ?? 0.3;
  const c = document.createElement('canvas'); c.width = gw * S; c.height = ROWS * S;
  const x = c.getContext('2d', { willReadFrequently: true });
  for (let a = 32; a < 128; a++) {
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = fsz * S + 'px CFRaster'; x.textBaseline = 'alphabetic';
    const s = String.fromCharCode(a), raw = Math.max(0.01, x.measureText(s).width / S);
    const gx = Math.min((gw * 0.92) / nW, gw / raw);
    x.save(); x.translate(Math.max(0, (gw - raw * gx) / 2) * S, 0); x.scale(gx, 1);
    x.fillText(s, 0, (BASE + 1) * S); x.restore();
    const d = x.getImageData(0, 0, c.width, c.height).data, g = zeros(ROWS);
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < gw; q++) {
      let cov = 0;
      for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) cov += d[((r * S + v) * c.width + q * S + u) * 4 + 3];
      if (cov / (255 * S * S) >= th) g[r] |= 0x80 >> q;
    }
    f.glyphs[a] = g;
  }
  return f;
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

module.exports = { create, glyph, render, shift, place, setCase, slotOf, serialize, parse, fromAcf1, acf1Sizes, toJson, fromJson, toInc, builtin, fromFnt, rasterTtf, isDefaultMap, METRICS: { ROWS, HEAD, XTOP, BASE, DESC }, MAGIC2, clamp };
