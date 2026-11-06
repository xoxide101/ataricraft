// Atari graphics characters for the Craft fonts (docs/FONT.md "Atari graphics"). Everything here is drawn from scratch: bars, blocks,
// triangles and lines are pixel rules on the character cell, the suits, ball and arrows are small shapes sampled per pixel.
// No Atari ROM bytes are used, so the generated fonts can be committed.
//
// 37 glyphs: ATASCII 0-31 (font codes/slots 0-31) and the five specials that ATASCII keeps at 96, 123, 125, 126, 127, where the Craft
// fonts keep their ASCII glyphs ` { } ~ DEL. The specials live in slots 128-132 (font codes 128-132).
// Inverse video (ATASCII 128-255) is not stored: it is the complement of the full cell, taken at draw time (inverse()).
'use strict';

const ENTRIES = [
  [0, 0, 0x2665, 'heart', 'heart'], [1, 1, 0x251c, 'box vertical and right', 'cross', 'udr'], [2, 2, 0x2595, 'right one eighth block', 'bar', 'r'],
  [3, 3, 0x2518, 'box up and left', 'cross', 'ul'], [4, 4, 0x2524, 'box vertical and left', 'cross', 'udl'], [5, 5, 0x2510, 'box down and left', 'cross', 'dl'],
  [6, 6, 0x2571, 'diagonal up right', 'diag', '/'], [7, 7, 0x2572, 'diagonal down right', 'diag', '\\'],
  [8, 8, 0x25e2, 'lower right triangle', 'tri', 'br'], [9, 9, 0x2597, 'quadrant lower right', 'quad', 'br'], [10, 10, 0x25e3, 'lower left triangle', 'tri', 'bl'],
  [11, 11, 0x259d, 'quadrant upper right', 'quad', 'tr'], [12, 12, 0x2598, 'quadrant upper left', 'quad', 'tl'], [13, 13, 0x2594, 'upper one eighth block', 'bar', 't'],
  [14, 14, 0x2582, 'lower one quarter block', 'bar', 'b'], [15, 15, 0x2596, 'quadrant lower left', 'quad', 'bl'],
  [16, 16, 0x2663, 'club', 'club'], [17, 17, 0x250c, 'box down and right', 'cross', 'dr'], [18, 18, 0x2500, 'box horizontal', 'cross', 'lr'],
  [19, 19, 0x253c, 'box cross', 'cross', 'udlr'], [20, 20, 0x25cf, 'ball', 'ball'], [21, 21, 0x2584, 'lower half block', 'half', 'b'],
  [22, 22, 0x258e, 'left one quarter block', 'bar', 'l'], [23, 23, 0x252c, 'box down and horizontal', 'cross', 'dlr'],
  [24, 24, 0x2534, 'box up and horizontal', 'cross', 'ulr'], [25, 25, 0x258c, 'left half block', 'half', 'l'], [26, 26, 0x2514, 'box up and right', 'cross', 'ur'],
  [27, 27, 0x238b, 'escape', 'esc'], [28, 28, 0x2191, 'arrow up', 'arrow', 'u'], [29, 29, 0x2193, 'arrow down', 'arrow', 'd'],
  [30, 30, 0x2190, 'arrow left', 'arrow', 'l'], [31, 31, 0x2192, 'arrow right', 'arrow', 'r'],
  [96, 128, 0x2666, 'diamond', 'diamond'], [123, 129, 0x2660, 'spade', 'spade'], [125, 130, 0x21b0, 'clear screen', 'clear'],
  [126, 131, 0x25c0, 'tab left', 'tl'], [127, 132, 0x25b6, 'tab right', 'tr'],
].map(([atascii, slot, uni, name, kind, arg]) => ({ atascii, slot, code: slot, uni, name, kind, arg: arg || '' }));

const BY_UNI = new Map(ENTRIES.map((e) => [e.uni, e]));
const bySlot = (slot) => ENTRIES.find((e) => e.slot === slot);
const isGfxSlot = (slot) => (slot >= 0 && slot < 32) || (slot >= 128 && slot < 133);
const uniOfCode = (code) => { const e = bySlot(code); return e ? e.uni : 0; };
const codeOfUni = (u) => { const e = BY_UNI.get(u); return e ? e.code : -1; };
// ACWriter documents keep graphic n (ATASCII 0-31) as byte 128+n (codes 1-31 are style codes there)
const acwCodeOfUni = (u) => { const e = BY_UNI.get(u); return e && e.slot < 32 ? 128 + e.slot : -1; };
const uniOfAcw = (b) => (b >= 128 && b < 160 ? ENTRIES[b - 128].uni : 0);

// Cell the graphics occupy: faces up to 8 px wide use the 8-row Atari cell (rows head..head+7), larger ones the whole cell.
function cellOf(s) {
  const W = s.adv, small = s.adv <= 8, H = small ? 8 : s.rows, top = small ? s.head : 0;
  return { W, H, top, tw: W <= 7 ? 1 : Math.max(2, Math.round(W / 6)), th: Math.max(1, Math.round(H / 6)) };
}

const SYMBOL = new Set(['heart', 'club', 'diamond', 'spade', 'ball', 'arrow', 'esc', 'clear', 'tl', 'tr']);
const SS = 4;
function sample(fn, x0, y0, w, h) {
  let n = 0;
  for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (fn((x0 + ((i + 0.5) / SS) * w), (y0 + ((j + 0.5) / SS) * h))) n++;
  return n / (SS * SS);
}
const inPoly = (p, x, y) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
};
const circ = (cx, cy, r) => (u, v) => (u - cx) * (u - cx) + (v - cy) * (v - cy) <= r * r;
const heartFn = (u, v) => { const x = (u - 0.5) * 2.5, y = 1.2 - v * 2.4, a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0; };
const SHAPES = {
  heart: heartFn,
  spade: (u, v) => (v < 0.8 && heartFn(u, 1 - v / 0.8)) || (v >= 0.6 && v <= 1 && Math.abs(u - 0.5) <= 0.07 + (v - 0.62) * 0.55),
  club: (u, v) => circ(0.5, 0.27, 0.22)(u, v) || circ(0.25, 0.58, 0.22)(u, v) || circ(0.75, 0.58, 0.22)(u, v) || (v >= 0.5 && v <= 1 && Math.abs(u - 0.5) <= 0.07 + (v - 0.5) * 0.5),
  diamond: (u, v) => Math.abs(u - 0.5) + Math.abs(v - 0.5) <= 0.5,
  ball: circ(0.5, 0.5, 0.5),
};
// arrows: polygons in the unit square (head + stem)
const ARROWS = {
  u: [[[0.5, 0], [1, 0.5], [0.65, 0.5], [0.65, 1], [0.35, 1], [0.35, 0.5], [0, 0.5]]],
  d: [[[0.5, 1], [1, 0.5], [0.65, 0.5], [0.65, 0], [0.35, 0], [0.35, 0.5], [0, 0.5]]],
  l: [[[0, 0.5], [0.5, 0], [0.5, 0.35], [1, 0.35], [1, 0.65], [0.5, 0.65], [0.5, 1]]],
  r: [[[1, 0.5], [0.5, 0], [0.5, 0.35], [0, 0.35], [0, 0.65], [0.5, 0.65], [0.5, 1]]],
  clear: [[[0, 0.3], [0.35, 0], [0.35, 0.18], [0.78, 0.18], [0.78, 1], [0.6, 1], [0.6, 0.42], [0.35, 0.42], [0.35, 0.6]]],
  tl: [[[0, 0.5], [1, 0], [1, 1]]],
  tr: [[[1, 0.5], [0, 0], [0, 1]]],
  esc: [[[0, 0], [0.75, 0], [0.5, 0.25], [1, 0.75], [0.75, 1], [0.25, 0.5], [0, 0.75]]],
};

// Hand-drawn symbols for the 3 and 4 px wide faces, where the curve tests only give blobs (rows listed top down, centred in the capital box)
const TINY = {
  3: {
    heart: ['#.#', '###', '###', '.#.'], diamond: ['.#.', '###', '.#.'], spade: ['.#.', '###', '###', '###', '.#.'], club: ['.#.', '###', '.#.', '###', '.#.'], ball: ['###', '###', '###'],
    'arrow up': ['.#.', '###', '.#.', '.#.', '.#.'], 'arrow down': ['.#.', '.#.', '.#.', '###', '.#.'], 'arrow left': ['.#.', '##.', '###', '##.', '.#.'], 'arrow right': ['.#.', '.##', '###', '.##', '.#.'],
    'clear screen': ['.##', '###', '..#', '..#', '..#'], escape: ['###', '##.', '#.#', '..#'], 'tab left': ['..#', '.##', '###', '.##', '..#'], 'tab right': ['#..', '##.', '###', '##.', '#..'],
  },
  4: {
    heart: ['#..#', '####', '####', '.##.'], diamond: ['.##.', '####', '.##.'], spade: ['.##.', '####', '####', '####', '.##.'], club: ['.##.', '.##.', '####', '####', '.##.'], ball: ['.##.', '####', '####', '.##.'],
    'arrow up': ['.##.', '####', '.##.', '.##.', '.##.'], 'arrow down': ['.##.', '.##.', '.##.', '####', '.##.'], 'arrow left': ['..#.', '.###', '####', '.###', '..#.'], 'arrow right': ['.#..', '###.', '####', '###.', '.#..'],
    'clear screen': ['.###', '####', '...#', '...#', '...#'], escape: ['####', '###.', '#.#.', '#..#'], 'tab left': ['...#', '..##', '.###', '####', '.###', '..##', '...#'], 'tab right': ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  },
};
// Pixel matrix (array of rows, each an array of 0/1 of length adv) of glyph `e` in the cell given by spec {adv, rows, head, base, gw}.
function raster(e, s) {
  // A 1 px gap (faces 4-6 px): the bars are drawn gw columns wide and the last column is repeated into the gap, so cells touch; ACWriter's 5 px cell works the same way
  const gapRep = s.adv - s.gw === 1 && !SYMBOL.has(e.kind), full = s.adv, { W, H, top, tw, th } = cellOf(gapRep ? { ...s, adv: s.gw } : s);
  const out = Array.from({ length: s.rows }, () => new Array(full).fill(0));
  const put = (x, y) => { if (top + y >= 0 && top + y < s.rows && x >= 0 && x < W) out[top + y][x] = 1; };
  const vx0 = Math.floor((W - tw) / 2), vx1 = vx0 + tw, hy0 = Math.floor((H - th) / 2), hy1 = hy0 + th;
  const eachPx = (pred) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pred(x, y)) put(x, y); };
  const k = e.kind, a = e.arg;
  if (k === 'cross') {
    eachPx((x, y) => {
      const inV = x >= vx0 && x < vx1, inH = y >= hy0 && y < hy1;
      return (inV && ((a.includes('u') && y < hy1) || (a.includes('d') && y >= hy0))) || (inH && ((a.includes('l') && x < vx1) || (a.includes('r') && x >= vx0)));
    });
  } else if (k === 'bar') {
    const bw = a === 'r' || a === 'l' ? Math.max(1, Math.round(W / (a === 'l' ? 4 : 8))) : 0, bh = a === 't' ? Math.max(1, Math.round(H / 8)) : Math.max(1, Math.round(H / 4));
    eachPx((x, y) => (a === 'r' ? x >= W - bw : a === 'l' ? x < bw : a === 't' ? y < bh : y >= H - bh));
  } else if (k === 'half') {
    eachPx((x, y) => (a === 'b' ? y >= Math.floor(H / 2) : x < Math.round(W / 2)));
  } else if (k === 'quad') {
    const mx = Math.round(W / 2), my = Math.round(H / 2);
    eachPx((x, y) => (a[0] === 't' ? y < my : y >= my) && (a[1] === 'l' ? x < mx : x >= mx));
  } else if (k === 'tri') {
    eachPx((x, y) => { const u = (x + 0.5) / W, v = (y + 0.5) / H; return a === 'br' ? u + v >= 1 : v >= u; });
  } else if (k === 'diag') {
    const half = Math.max(0.55, tw / 2 + 0.15);
    eachPx((x, y) => { const v = (y + 0.5) / H, xc = a === '/' ? W * (1 - v) : W * v; return Math.abs(x + 0.5 - xc) <= half * (W / 5 > 1 ? W / 5 : 1) * 0.9 + 0.1; });
  } else {
    // symbols: the capital box (columns 0..gw-1, rows head..base)
    const x0 = 0, y0 = s.head, bw = Math.min(W, s.gw), bh = s.base - s.head + 1;
    const tiny = TINY[s.gw] && TINY[s.gw][e.name];
    if (tiny) { const y1 = y0 + Math.floor((bh - tiny.length) / 2); tiny.forEach((row, i) => [...row].forEach((c, q) => { if (c === '#' && y1 + i < s.rows) out[y1 + i][q] = 1; })); return out; }
    const fn = SHAPES[k] || (ARROWS[k] ? (u, v) => ARROWS[k].some((p) => inPoly(p, u, v)) : ARROWS[a] ? (u, v) => ARROWS[a].some((p) => inPoly(p, u, v)) : null);
    if (!fn) throw new Error('no shape for ' + e.name);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (sample(fn, x / bw, y / bh, 1 / bw, 1 / bh) >= 0.5) if (y0 + y < s.rows) out[y0 + y][x0 + x] = 1;
  }
  if (gapRep) for (const row of out) row[full - 1] = row[full - 2];
  return out;
}

// Packs the matrix into font row masks (bit topBit = column 0; `bpr` bytes per row)
function pack(m, bpr) {
  const top = 1 << (8 * bpr - 1);
  return m.map((row) => row.reduce((v, on, q) => (on ? v | (top >>> q) : v), 0));
}

// Writes the 37 glyphs into font f (slots 0-31 and 128-132; widens first/count to cover them).
function install(f) {
  const CF = require('./craftfont.cjs');
  if (Math.ceil(f.adv / 8) > CF.bprOf(f)) CF.setBpr(f, Math.ceil(f.adv / 8));
  const bpr = CF.bprOf(f), s = { adv: f.adv, gw: f.gw, rows: f.rows, head: f.head, base: f.base };
  f.first = Math.min(f.first, 0); f.count = Math.max(f.first + f.count, 133) - f.first;
  for (const e of ENTRIES) { f.glyphs[e.slot] = pack(raster(e, s), bpr); f.map[e.code] = e.slot; }
  f.gfx = true;
  return f;
}
const hasGfx = (f) => !!(f.glyphs[18] && f.glyphs[18].some((v) => v));

// Inverse video: the complement of the whole cell (adv columns, rows of the graphics cell)
function inverse(f, g, code) {
  const CF = require('./craftfont.cjs'), full = CF.cellMask(f);
  const { H, top: y0 } = cellOf(f);
  return g.map((r, y) => (y >= y0 && y < y0 + H ? (~r & full) : r));
}

module.exports = { ENTRIES, bySlot, isGfxSlot, uniOfCode, codeOfUni, acwCodeOfUni, uniOfAcw, cellOf, raster, pack, install, hasGfx, inverse, BY_UNI };
