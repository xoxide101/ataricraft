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
// Large sizes (xCWriter, print, web; the Atari app cannot hold them): square cell of `size` rows, a gap of about an eighth of the advance.
for (const s of [14, 16, 18, 20, 22, 24, 26]) {
  const gap = Math.max(2, Math.round(s / 8)), head = Math.round(s / 6), desc = head, base = s - desc - 1, body = base - head + 1;
  SIZES[s] = { adv: s, gw: s - gap, rows: s, head, xTop: head + Math.round(body * 0.25), base, desc, supUp: head, subDown: head, label: s + 'x' + s };
}
const BIG_SIZES = [14, 16, 18, 20, 22, 24, 26];
// origin: 0 master (hand drawn / rasterised), 1 derived from the master, 2 hand-edited after deriving
const ORIGIN = { master: 0, derived: 1, hand: 2 };

// Rows are one byte (bit 7 = leftmost pixel) when the glyph is at most 8 px wide, otherwise two bytes (bit 15 = leftmost).
// ACF2 extension: faces wider than 16 px (and the 10 px face, whose Atari graphics fill the whole 10 px cell) store 2-3 bytes per row,
// signalled by header flag 32 + a bytes-per-row byte. Older files have no flag and keep gw > 8 ? 2 : 1.
const defBpr = (gw) => (gw > 16 ? 3 : gw > 8 ? 2 : 1);
const bprOf = (f) => f.bpr || defBpr(f.gw);
const isWide = (f) => bprOf(f) > 1;
const topBit = (f) => 1 << (8 * bprOf(f) - 1);
const bitMask = (f, q) => topBit(f) >>> q;
const allBits = (f) => (bprOf(f) >= 4 ? 0xFFFFFFFF : (1 << (8 * bprOf(f))) - 1);
const fullMask = (f) => (allBits(f) & ~(allBits(f) >>> f.gw)) >>> 0;
const cellMask = (f) => (allBits(f) & ~(allBits(f) >>> f.adv)) >>> 0;
// Atari graphics slots (0-31 and 128-132, tools/atarigfx.cjs) are drawn over the whole advance, not only the gw glyph columns
const isGfxSlot = (slot) => (slot >= 0 && slot < 32) || (slot >= 128 && slot < 133);
const colsOf = (f, slot) => (isGfxSlot(slot) ? Math.max(f.adv, f.gw) : f.gw);
const hasPx = (f, row, q) => !!(row & bitMask(f, q));

// Standard metrics: cell rows 0..11: 0-1 headroom, 2-8 capitals (cap line row 2, baseline row 8), x-height line row 4, 9-11 descender.
function create(opt = {}) {
  const adv = opt.adv || 5;
  const f = {
    name: opt.name || 'Untitled', adv, gw: opt.gw || adv - 1, rows: opt.rows || ROWS, head: opt.head ?? HEAD, xTop: opt.xTop ?? XTOP,
    base: opt.base ?? BASE, desc: opt.desc ?? DESC, supUp: opt.supUp ?? 2, subDown: opt.subDown ?? 3,
    first: opt.first ?? 32, count: opt.count ?? 96, upper: 65, lower: 97,
    origin: opt.origin ?? 0, locked: !!opt.locked, masterAdv: opt.masterAdv ?? 0, bpr: opt.bpr || 0,
    glyphs: [], map: [], sup: {}, sub: {}, advs: {},
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

const rowBytes = (f, r) => Array.from({ length: bprOf(f) }, (_, k) => (r >>> (8 * (bprOf(f) - 1 - k))) & 255);
const glyphBytes = (f, g) => Buffer.from([].concat(...g.map((r) => rowBytes(f, r))));

function serialize(f) {
  const nm = Buffer.from(f.name.slice(0, 40), 'latin1');
  const hasMap = !isDefaultMap(f);
  const vars = [];
  for (const [kind, tab] of [[1, f.sup], [2, f.sub]]) for (const c of Object.keys(tab)) vars.push([+c, kind, tab[c]]);
  const advList = Object.keys(f.advs || {}).filter((k) => f.advs[k] && f.advs[k] !== f.adv).map(Number);
  const hasMeta = f.origin || f.locked || f.masterAdv;
  const flags = (hasMap ? 1 : 0) | (vars.length ? 2 : 0) | (isWide(f) ? 4 : 0) | (hasMeta ? 8 : 0) | (advList.length ? 16 : 0) | (bprOf(f) !== defBpr(f.gw) ? 32 : 0);
  const head = Buffer.from([f.adv, f.gw, f.rows, f.head, f.xTop, f.base, f.desc, f.supUp & 255, f.subDown & 255, f.first, f.count & 255, flags, f.upper & 255, f.lower & 255, nm.length]);
  const parts = [Buffer.from(MAGIC2, 'latin1'), head, nm];
  if (hasMeta) parts.push(Buffer.from([f.origin & 255, f.locked ? 1 : 0, f.masterAdv & 255]));
  if (flags & 32) parts.push(Buffer.from([bprOf(f)]));
  if (hasMap) parts.push(Buffer.from(f.map));
  for (let i = 0; i < f.count; i++) parts.push(glyphBytes(f, f.glyphs[f.first + i] || zeros(f.rows)));
  if (vars.length) {
    parts.push(Buffer.from([vars.length]));
    for (const [c, k, r] of vars) parts.push(Buffer.from([c, k]), glyphBytes(f, r));
  }
  if (advList.length) parts.push(Buffer.from([advList.length]), Buffer.from(advList.flatMap((k) => [k, f.advs[k]])));
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
  if (flags & 32) f.bpr = b();
  const bpr = bprOf(f);
  const rowsAt = () => { const o = []; for (let r = 0; r < rows; r++) { let v = 0; for (let k = 0; k < bpr; k++) v = v * 256 + buf[p++]; o.push(v); } return o; };
  if (flags & 1) { for (let i = 0; i < 256; i++) f.map[i] = b(); }
  for (let i = 0; i < count; i++) f.glyphs[first + i] = rowsAt();
  if (flags & 2) {
    const n = b();
    for (let i = 0; i < n; i++) { const c = b(), k = b(); (k === 1 ? f.sup : f.sub)[c] = rowsAt(); }
  }
  if (flags & 16) { const n = b(); for (let i = 0; i < n; i++) { const sl = b(); f.advs[sl] = b(); } }
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
  const w = bprOf(f) * 2;
  const o = { format: 'craft-font', version: 2, name: f.name, adv: f.adv, gw: f.gw, rows: f.rows, head: f.head, xTop: f.xTop, base: f.base, desc: f.desc,
    supUp: f.supUp, subDown: f.subDown, first: f.first, count: f.count, upper: f.upper, lower: f.lower, origin: f.origin, locked: f.locked, masterAdv: f.masterAdv, glyphs: {}, sup: {}, sub: {} };
  if (f.bpr && f.bpr !== defBpr(f.gw)) o.bpr = f.bpr;
  if (!isDefaultMap(f)) o.map = f.map.slice();
  if (Object.keys(f.advs || {}).length) o.advs = Object.assign({}, f.advs);
  for (let i = 0; i < f.count; i++) o.glyphs[f.first + i] = hex(f.glyphs[f.first + i], w);
  for (const c of Object.keys(f.sup)) o.sup[c] = hex(f.sup[c], w);
  for (const c of Object.keys(f.sub)) o.sub[c] = hex(f.sub[c], w);
  return JSON.stringify(o, null, 1);
}

function fromJson(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (o.format !== 'craft-font') throw new Error('not a craft-font JSON');
  const f = create(o);
  const w = bprOf(f) * 2;
  f.upper = o.upper ?? 65; f.lower = o.lower ?? 97;
  if (o.map) f.map = o.map.slice();
  if (o.advs) f.advs = Object.assign({}, o.advs);
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
  const nb = bprOf(f);
  const plane = (name, fn) => {
    o += name + ':\n';
    for (let i = 0; i < f.count; i += 16) {
      const n = Math.min(16, f.count - i);
      o += '        .byte ' + Array.from({ length: n }, (_, k) => fn((f.glyphs[f.first + i + k] || [])) ).join(',') + '\n';
    }
  };
  for (let r = 0; r < f.rows; r++) {
    for (let k = 0; k < nb; k++) plane(prefix + '_' + r + ['', 'L', 'M'][k], (g) => ((g[r] || 0) >>> (8 * (nb - 1 - k))) & 255);
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

// 12x12 master (10 px ink) and 10x12 (8 px ink) from the Atari 8x8 face: the 8 body rows sit under 2 rows of headroom, descender letters
// get 2-3 tail rows below the baseline. A starting point for hand editing in fontedit, not a redesign.
function builtinWide(fnt, size) {
  const gw = size === 12 ? 10 : 8, pick = size === 12 ? [0, 1, 1, 2, 3, 4, 5, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
  const f = create(Object.assign({}, SIZES[size], { name: 'Craft ' + SIZES[size].label.split(' ')[0] }));
  const top = gw > 8 ? 15 : 7, wide = (b) => pick.reduce((v, k, i) => v | (((b >> (7 - k)) & 1) << (top - i)), 0);
  for (let a = 32; a < 128; a++) {
    const r = atariRows(fnt, a), g = zeros(f.rows);
    if (DESC_LETTERS.includes(String.fromCharCode(a))) [r[2], r[3], r[3], r[4], r[5], r[6], r[6], r[7]].forEach((b, i) => { g[XTOP + i] = wide(b); });
    else r.forEach((b, i) => { g[HEAD + i] = wide(b); });
    f.glyphs[a] = g;
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
    const d = x.getImageData(0, 0, c.width, c.height).data, g = zeros(rows), top = topBit(f), cv = [];
    let mx = 0;
    for (let r = 0; r < rows; r++) for (let q = 0; q < gw; q++) {
      let cov = 0;
      for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) cov += d[((r * S + v) * c.width + q * S + u) * 4 + 3];
      cov /= 255 * S * S; cv.push(cov); if (cov > mx) mx = cov;
      if (cov >= th - (wt < 0 ? wt * 0.08 : 0)) g[r] |= top >>> q;
    }
    // faint but real ink (thin underscore, hyphen) must not vanish: keep its strongest pixels
    if (!g.some((v) => v) && mx > 0.05) for (let i = 0; i < cv.length; i++) if (cv[i] >= mx * 0.6) g[(i / gw) | 0] |= top >>> (i % gw);
    f.glyphs[a] = g;
  }
  return f;
}

// Changes the bytes per row of every glyph (pixels stay in the same columns).
function setBpr(f, n) {
  const old = bprOf(f), d = 8 * (n - old);
  if (!d) return f;
  const mv = (g) => g.map((r) => (d > 0 ? r * 2 ** d : Math.floor(r / 2 ** -d)));
  f.glyphs = f.glyphs.map(mv);
  for (const k of Object.keys(f.sup)) f.sup[k] = mv(f.sup[k]);
  for (const k of Object.keys(f.sub)) f.sub[k] = mv(f.sub[k]);
  f.bpr = n;
  return f;
}

// ---- derived sizes ------------------------------------------------------------------------------------------------------
// Band-wise downscale of a font into another size: headroom, cap-line-to-baseline and descender bands each map onto the target's
// band, columns map ink width onto ink width. A target pixel is on when its coverage reaches `threshold`; `keepStems` also keeps a
// pixel with at least a quarter coverage that has no inked neighbour on either side, so one-pixel stems never vanish.
// Upscaling (large sizes): the same band mapping, but each target pixel samples the source bilinearly and switches on at coverage 0.5, so a
// one-pixel stem grows to the matching stem width instead of staying hair-thin.
// Vertical bands that map onto each other. snapX adds the x-height line as a band edge so lowercase tops land on the target's x-height.
function bandsOf(src, dst, opt) {
  const ok = (f) => f.xTop > f.head && f.xTop <= f.base, x = opt.snapX && ok(src) && ok(dst);
  return (f) => (x ? [[0, f.head], [f.head, f.xTop], [f.xTop, f.base + 1], [f.base + 1, f.rows]] : [[0, f.head], [f.head, f.base + 1], [f.base + 1, f.rows]]);
}
function upGlyph(src, dst, rows, opt) {
  const bands = bandsOf(src, dst, opt), sb = bands(src), db = bands(dst), out = zeros(dst.rows), top = topBit(dst), th = opt.upThreshold ?? 0.5;
  let minx = src.gw, maxx = -1;
  for (const r of rows) for (let q = 0; q < src.gw; q++) if (hasPx(src, r, q)) { if (q < minx) minx = q; if (q > maxx) maxx = q; }
  const px = (y, x) => (y < 0 || x < 0 || y >= src.rows || x >= src.gw ? 0 : hasPx(src, rows[y], x) ? 1 : 0);
  const sw = src.gw / dst.gw;
  for (let r = 0; r < dst.rows; r++) {
    const bi = db.findIndex(([a, b]) => r >= a && r < b), [da, dbb] = db[bi], [sa, sbb] = sb[bi];
    const sy = sa + ((r + 0.5 - da) / (dbb - da)) * (sbb - sa) - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let q = 0; q < dst.gw; q++) {
      const sx = (q + 0.5) * sw - 0.5, x0 = Math.floor(sx), fx = sx - x0;
      const v = px(y0, x0) * (1 - fx) * (1 - fy) + px(y0, x0 + 1) * fx * (1 - fy) + px(y0 + 1, x0) * (1 - fx) * fy + px(y0 + 1, x0 + 1) * fx * fy;
      if (v >= th) out[r] |= top >>> q;
    }
  }
  if (maxx >= 0 && !out.some((v) => v)) out[dst.head] |= top;
  return out;
}

function deriveGlyphRaw(src, dst, rows, opt) {
  if (dst.rows > src.rows || (dst.gw > src.gw && dst.rows >= src.rows)) return upGlyph(src, dst, rows, opt);  const th = opt.threshold ?? 0.4, keep = opt.keepStems !== false;
  const bands = bandsOf(src, dst, opt);
  const sb = bands(src), db = bands(dst), out = zeros(dst.rows);
  // columns: a glyph whose ink already fits the target is moved, not resampled, so one-pixel stems stay one pixel wide
  let minx = src.gw, maxx = -1;
  for (const r of rows) for (let q = 0; q < src.gw; q++) if (hasPx(src, r, q)) { if (q < minx) minx = q; if (q > maxx) maxx = q; }
  const inkW = maxx - minx + 1, fits = maxx >= 0 && inkW <= dst.gw && opt.resample !== true;
  const dx = fits ? minx - clamp(Math.round((minx * dst.gw) / src.gw), 0, dst.gw - inkW) : 0;
  const cov = [];
  for (let r = 0; r < dst.rows; r++) {
    const bi = db.findIndex(([a, b]) => r >= a && r < b);
    const [da, dbb] = db[bi], [sa, sbb] = sb[bi];
    const y0 = sa + ((r - da) / (dbb - da)) * (sbb - sa), y1 = sa + ((r - da + 1) / (dbb - da)) * (sbb - sa);
    const row = [];
    for (let q = 0; q < dst.gw; q++) {
      const x0 = fits ? q + dx : (q / dst.gw) * src.gw, x1 = fits ? q + dx + 1 : ((q + 1) / dst.gw) * src.gw;
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
      if (v >= th || lone) out[r] |= top >>> q;
    }
  }
  // A glyph with ink never derives to nothing: switch on the cell with the most coverage.
  if (rows.some((v) => v) && !out.some((v) => v)) {
    let best = -1, br = 0, bq = 0;
    cov.forEach((row, r) => row.forEach((v, q) => { if (v > best) { best = v; br = r; bq = q; } }));
    out[br] |= top >>> bq;
  }
  return out;
}

// deriveGlyph = the resampler plus the hinting-lite steps: snapBase keeps a glyph that sat on the baseline on the baseline,
// weight +1 thickens every horizontal run by a pixel, -1 trims the right pixel of runs of 3+ (stems of 1-2 pixels are kept).
function deriveGlyph(src, dst, rows, opt) {
  opt = opt || {};
  let out = deriveGlyphRaw(src, dst, rows, opt);
  if (opt.snapBase) {
    let sb = -1; for (let r = Math.min(src.base, rows.length - 1); r >= 0; r--) { if (rows[r]) { sb = r; break; } }
    let lr = -1; for (let r = out.length - 1; r >= 0; r--) if (out[r]) { lr = r; break; }
    if (sb === src.base && lr >= 0 && Math.abs(lr - dst.base) === 1) { const d = dst.base - lr, o = out; out = o.map((_, r) => o[r - d] || 0); }
  }
  if (opt.weight) {
    const mask = (((1 << dst.gw) - 1) << (8 * bprOf(dst) - dst.gw)) >>> 0;
    out = out.map((v) => (opt.weight > 0 ? ((v | (v >>> 1)) & mask) >>> 0 : (v & ~(v & (v >>> 1) & (v >>> 2) & ~(v << 1)) & mask) >>> 0));
  }
  return out;
}

// Derive `size` (see SIZES) from a master font. Copies the code map, case locations, sup/sub offsets and variants.
function derive(master, size, opt = {}) {
  const spec = SIZES[size]; if (!spec) throw new Error('unknown size ' + size);
  const f = create(Object.assign({}, spec, { name: master.name.replace(/ \d+x\d+.*$/, '') + ' ' + spec.label.split(' ')[0], first: master.first, count: master.count, origin: ORIGIN.derived, masterAdv: master.adv }));
  f.map = master.map.slice(); f.upper = master.upper; f.lower = master.lower;
  const AG = require('./atarigfx.cjs'), gfx = AG.hasGfx(master) && opt.graphics !== false;
  for (let s = 0; s < 256; s++) if (!(gfx && AG.isGfxSlot(s)) && master.glyphs[s] && master.glyphs[s].some((v) => v)) f.glyphs[s] = deriveGlyph(master, f, master.glyphs[s], opt);
  if (gfx) AG.install(f);
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

// ---- converters and glyph transforms (shared by fontedit.html and the tests) ----------------------------------------------------
// A glyph is an array of row bit masks; pixel (q, r) is on when hasPx(f, g[r], q).
const setPx = (f, row, q) => row | bitMask(f, q);
function flipV(f, g) { return g.slice().reverse(); }
// Rotate the gw x gw square that starts at the headroom row (the ink area of the narrow glyph) a quarter turn clockwise.
function rotate(f, g) {
  const n = f.gw, out = g.slice();
  for (let r = 0; r < n; r++) out[f.head + r] = 0;
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
    if (g[f.head + r] !== undefined && hasPx(f, g[f.head + r], q)) {
      const nr = q, nq = n - 1 - r;
      if (f.head + nr < f.rows) out[f.head + nr] = setPx(f, out[f.head + nr], nq);
    }
  }
  return out;
}

// BDF bitmap font -> Craft font. size: 12 (default for fonts taller than 10 rows) or 8. The BDF baseline lands on f.base.
function fromBdf(text, opt = {}) {
  const lines = String(text).split(/\r?\n/);
  let fh = 0, name = opt.name || 'BDF font';
  for (const l of lines) {
    let m;
    if ((m = /^FONTBOUNDINGBOX\s+(-?\d+)\s+(-?\d+)/.exec(l))) fh = +m[2];
    if ((m = /^FAMILY_NAME\s+"?([^"]*)"?/.exec(l)) && !opt.name) name = m[1];
  }
  const size = opt.size || (fh > 10 ? 12 : 8);
  const f = createSize(size, { name: name.slice(0, 40), first: 0, count: 256 });
  let cur = null, inBits = false, row = 0, n = 0;
  for (const l of lines) {
    let m;
    if (l.startsWith('STARTCHAR')) { cur = { enc: -1, w: 0, h: 0, xo: 0, yo: 0, rows: [] }; inBits = false; }
    else if (!cur) continue;
    else if ((m = /^ENCODING\s+(-?\d+)/.exec(l))) cur.enc = +m[1];
    else if ((m = /^BBX\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(l))) { cur.w = +m[1]; cur.h = +m[2]; cur.xo = +m[3]; cur.yo = +m[4]; }
    else if (l.startsWith('BITMAP')) { inBits = true; row = 0; }
    else if (l.startsWith('ENDCHAR')) {
      if (cur.enc >= 0 && cur.enc < 256) {
        const g = zeros(f.rows), top = f.base - cur.yo - cur.h + 1;
        cur.rows.forEach((hexRow, i) => {
          const y = top + i;
          if (y < 0 || y >= f.rows) return;
          for (let x = 0; x < cur.w; x++) {
            const q = cur.xo + x;
            if (q < 0 || q >= f.gw) continue;
            const byte = parseInt(hexRow.substr(Math.floor(x / 8) * 2, 2) || '0', 16);
            if (byte & (0x80 >> (x % 8))) g[y] = setPx(f, g[y], q);
          }
        });
        f.glyphs[cur.enc] = g; n++;
      }
      cur = null; inBits = false;
    } else if (inBits && /^[0-9A-Fa-f]+$/.test(l.trim())) cur.rows.push(l.trim());
  }
  if (!n) throw new Error('BDF contains no glyphs');
  return f;
}

// PCF (X11 compiled bitmap font) -> Craft font. Reads the tables as the X server writes them: either byte order, either bit order, glyph
// padding 1/2/4/8 and scan unit 1/2/4/8, compressed or full metrics, single-byte encodings. The glyphs are turned into a BDF description and
// go through fromBdf, so the baseline and size rules are the same as for BDF.
function fromPcf(input, opt = {}) {
  const buf = Buffer.from(input);
  if (buf.length < 8 || buf.readUInt32LE(0) !== 0x70636601) throw new Error('not a PCF font (a gzip-compressed .pcf.gz must be unpacked first)');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.length), nt = buf.readUInt32LE(4), tabs = {};
  for (let i = 0; i < nt; i++) tabs[buf.readUInt32LE(8 + i * 16)] = { format: buf.readUInt32LE(12 + i * 16), size: buf.readUInt32LE(16 + i * 16), off: buf.readUInt32LE(20 + i * 16) };
  const need = (t, n) => { if (!tabs[t]) throw new Error('PCF has no ' + n + ' table'); return tabs[t]; };
  const rd = (t) => {
    const msb = !!(t.format & 4), at = t.off + 4;
    return { msb, p: at, i32() { const v = dv.getInt32(this.p, !msb); this.p += 4; return v; }, i16() { const v = dv.getInt16(this.p, !msb); this.p += 2; return v; }, u8() { return buf[this.p++]; } };
  };
  let family = opt.name || '';
  if (tabs[1]) {
    const r = rd(tabs[1]), n = r.i32(), props = [];
    for (let i = 0; i < n; i++) { const no = r.i32(), isStr = r.u8(), v = r.i32(); props.push([no, isStr, v]); }
    r.p = tabs[1].off + ((r.p - tabs[1].off + 3) & ~3);
    r.i32();
    const base = r.p, str = (o) => { let e = base + o; while (buf[e]) e++; return buf.toString('latin1', base + o, e); };
    for (const [no, isStr, v] of props) if (isStr && !family && str(no) === 'FAMILY_NAME') family = str(v);
  }
  const mt = need(4, 'metrics'), mr = rd(mt), metrics = [];
  if (mt.format & 0x100) { const n = mr.i16(); for (let i = 0; i < n; i++) { const m = [mr.u8() - 128, mr.u8() - 128, mr.u8() - 128, mr.u8() - 128, mr.u8() - 128]; metrics.push({ lsb: m[0], rsb: m[1], w: m[2], asc: m[3], desc: m[4] }); } }
  else { const n = mr.i32(); for (let i = 0; i < n; i++) { const m = [mr.i16(), mr.i16(), mr.i16(), mr.i16(), mr.i16(), mr.i16()]; metrics.push({ lsb: m[0], rsb: m[1], w: m[2], asc: m[3], desc: m[4] }); } }
  const bt = need(8, 'bitmaps'), br = rd(bt), bn = br.i32(), offs = [];
  for (let i = 0; i < bn; i++) offs.push(br.i32());
  br.p += 16;
  const dataAt = br.p, pad = 1 << (bt.format & 3), scan = 1 << ((bt.format >> 4) & 3), byteMsb = !!(bt.format & 4), bitMsb = !!(bt.format & 8);
  const et = need(32, 'encodings'), er = rd(et), minC = er.i16(), maxC = er.i16(), minB1 = er.i16(), maxB1 = er.i16();
  er.i16();
  const cols = maxC - minC + 1, idx = [];
  for (let i = 0; i < cols * (maxB1 - minB1 + 1); i++) idx.push(er.i16());
  let fh = 0;
  for (const m of metrics) fh = Math.max(fh, m.asc + m.desc);
  let out = 'STARTFONT 2.1\nFONT pcf\nFAMILY_NAME "' + (family || 'PCF font') + '"\nFONTBOUNDINGBOX 8 ' + fh + ' 0 0\nCHARS ' + metrics.length + '\n', n = 0;
  for (let i = 0; i < idx.length; i++) {
    const gi = idx[i];
    if (gi < 0 || gi >= metrics.length || minB1 !== 0 || maxB1 !== 0) continue;
    const m = metrics[gi], w = m.rsb - m.lsb, h = m.asc + m.desc;
    if (w <= 0 || h <= 0) { out += 'STARTCHAR g\nENCODING ' + (minC + i) + '\nBBX 0 0 0 0\nBITMAP\nENDCHAR\n'; continue; }
    const rb = Math.ceil(Math.ceil(w / 8) / pad) * pad, rowsHex = [];
    for (let y = 0; y < h; y++) {
      const row = Array.from(buf.subarray(dataAt + offs[gi] + y * rb, dataAt + offs[gi] + (y + 1) * rb));
      if (scan > 1 && byteMsb !== bitMsb) for (let u = 0; u < row.length; u += scan) row.splice(u, scan, ...row.slice(u, u + scan).reverse());
      if (!bitMsb) for (let k = 0; k < row.length; k++) { let v = row[k], r = 0; for (let b = 0; b < 8; b++) { r = (r << 1) | (v & 1); v >>= 1; } row[k] = r; }
      rowsHex.push(row.slice(0, Math.ceil(w / 8)).map((v) => v.toString(16).padStart(2, '0')).join(''));
    }
    out += 'STARTCHAR g\nENCODING ' + (minC + i) + '\nBBX ' + w + ' ' + h + ' ' + m.lsb + ' ' + (-m.desc) + '\nBITMAP\n' + rowsHex.join('\n') + '\nENDCHAR\n'; n++;
  }
  if (!n) throw new Error('PCF contains no glyphs');
  return fromBdf(out + 'ENDFONT\n', opt);
}
// Atari charset binary from an 8 px font: 128 glyphs in screen-code order, rows taken from the headroom down (inverse of fromFnt).
function toFnt(f) {
  const out = Buffer.alloc(1024);
  for (let a = 0; a < 128; a++) {
    const sc = a < 32 ? a + 64 : a < 96 ? a - 32 : a, g = f.glyphs[f.map[a]] || zeros(f.rows);
    for (let i = 0; i < 8; i++) out[sc * 8 + i] = ((g[f.head + i] || 0) >> (8 * (bprOf(f) - 1))) & 255;
  }
  return out;
}

// Sheet: 16 x 16 cells of adv x rows pixels, 1 byte per pixel (0 / 1), row-major.
function toSheet(f) {
  const cw = f.adv, ch = f.rows, w = cw * 16, h = ch * 16, data = new Uint8Array(w * h);
  for (let s = 0; s < 256; s++) {
    const g = f.glyphs[s]; if (!g) continue;
    for (let r = 0; r < ch; r++) for (let q = 0; q < f.gw; q++) if (hasPx(f, g[r], q)) data[((Math.floor(s / 16) * ch + r) * w) + (s % 16) * cw + q] = 1;
  }
  return { w, h, cw, ch, data };
}
function fromSheet(data, w, h, opt = {}) {
  const size = opt.size || ({ 192: 12, 160: 10, 128: 8, 96: 6, 80: 5, 64: 4 }[w] || 12), f = createSize(size, { name: (opt.name || 'Sheet font').slice(0, 40), first: 0, count: 256 });
  const cw = w / 16, ch = h / 16;
  if (cw !== f.adv || ch !== f.rows) throw new Error('sheet cells are ' + cw + 'x' + ch + ', expected ' + f.adv + 'x' + f.rows);
  for (let s = 0; s < 256; s++) {
    const g = zeros(f.rows);
    for (let r = 0; r < ch; r++) for (let q = 0; q < f.gw; q++) if (data[(Math.floor(s / 16) * ch + r) * w + (s % 16) * cw + q]) g[r] = setPx(f, g[r], q);
    f.glyphs[s] = g;
  }
  return f;
}

module.exports = { builtinWide, create, createSize, glyph, render, shift, place, setCase, slotOf, serialize, parse, fromAcf1, acf1Sizes, toJson, fromJson, toInc, builtin, fromFnt, rasterTtf, derive, deriveGlyph, familyNew, familyDerive, familyToJson, familyFromJson, markEdited, isWide, topBit, bitMask, fullMask, cellMask, bprOf, defBpr, setBpr, isGfxSlot, colsOf, BIG_SIZES, hasPx, SIZES, ORIGIN, isDefaultMap, METRICS: { ROWS, HEAD, XTOP, BASE, DESC }, MAGIC2, clamp, flipV, rotate, fromBdf, fromPcf, toFnt, toSheet, fromSheet, setPx };
