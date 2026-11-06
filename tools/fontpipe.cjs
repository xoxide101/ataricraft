// Font pipeline (docs/FONT.md, "Font pipeline"): one shared module for Node and the browser, no build step beyond the xCWriter bundle.
//   DOWN  high-res outline font (TTF / OTF / WOFF) -> ACF2 at 12x12 (master), 10x12, 8x8, 6/5/4 px, using the Craft master/derive logic.
//   UP    Atari fonts (ROM charset, .fnt, .acf, .json, BDF, PCF) -> working ACF + XCF, and export to BDF / TTF / .fnt so a font survives.
// XCF = xCWriter font: the craft-family JSON plus names, Unicode, advances, bearings and metrics (see docs/FONT.md).
// All functions take and return plain bytes (Uint8Array / Buffer) or strings; nothing touches the file system or the DOM.
'use strict';

const CF = require('./craftfont.cjs');
const SF = require('./sfnt.cjs');

const SIZES = [12, 10, 8, 6, 5, 4];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const zeros = (n) => new Array(n).fill(0);
const bytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const text = (b) => { let s = ''; const u = bytes(b); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return s; };
const enc = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const baseName = (n) => String(n || 'font').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

// ---- names and code space -----------------------------------------------------------------------------------------------------
const ASCII_NAMES = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(' ');
const glyphName = (code) => (code >= 32 && code <= 126 ? ASCII_NAMES[code - 32] : 'atascii' + code.toString(16).padStart(2, '0'));
// ASCII keeps its Unicode value; the Atari graphics (0-31) and 127-255 sit in the Private Use Area at U+E000 + code
const uniOf = (code) => (code >= 32 && code <= 126 ? code : 0xe000 + code);
const codeOfUni = (u) => (u >= 32 && u <= 126 ? u : u >= 0xe000 && u <= 0xe0ff ? u - 0xe000 : -1);

// ---- glyph helpers --------------------------------------------------------------------------------------------------------------
const rowsOf = (f, code) => CF.glyph(f, code);
const hasInk = (g) => g.some((v) => v);
function inkBox(f, g) {
  let x0 = f.gw, x1 = -1, y0 = f.rows, y1 = -1;
  for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, g[r], q)) { if (q < x0) x0 = q; if (q > x1) x1 = q; if (r < y0) y0 = r; if (r > y1) y1 = r; }
  return x1 < 0 ? null : { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const codesOf = (f) => { const a = []; for (let c = 0; c < 256; c++) { const s = f.map[c]; if (s >= f.first && s < f.first + f.count) a.push(c); } return a; };
const advOf = (f, code) => f.advs[f.map[code]] || f.adv;

// Per-glyph horizontal data. lsb/rsb in px of the advance: measured from the bitmap for fixed-pitch glyphs, centred for a glyph whose
// advance was narrowed (proportional fonts). sh = how far the ink is moved left when the font is exported with proportional advances.
function glyphMetrics(f, code) {
  const g = rowsOf(f, code), box = inkBox(f, g), adv = advOf(f, code), slot = f.map[code];
  const prop = !!(f.advs && f.advs[slot] && f.advs[slot] !== f.adv);
  if (!box) return { adv, lsb: 0, rsb: adv, ink: 0, sh: 0, prop };
  const lsb = prop ? Math.max(0, Math.floor((adv - box.w) / 2)) : box.x0;
  return { adv, lsb, rsb: adv - lsb - box.w, ink: box.w, sh: prop ? box.x0 - lsb : 0, prop, box };
}

// ---- analysis (used by the tests and the editor) ----------------------------------------------------------------------------------
function analyze(f) {
  const a = { count: 0, blank: [], upper: 0, lower: 0, digits: 0, capTop: -1, capBottom: -1, xTop: -1, descBottom: -1, supOk: 0, supTried: 0, subOk: 0, subTried: 0, advs: Object.keys(f.advs || {}).length };
  const inkCnt = (g) => g.reduce((n, r) => { let c = 0; for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, r, q)) c++; return n + c; }, 0);
  for (let c = 33; c < 127; c++) {
    const g = rowsOf(f, c);
    if (hasInk(g)) a.count++; else a.blank.push(c);
  }
  const has = (c) => hasInk(rowsOf(f, c));
  for (let c = 65; c <= 90; c++) if (has(c)) a.upper++;
  for (let c = 97; c <= 122; c++) if (has(c)) a.lower++;
  for (let c = 48; c <= 57; c++) if (has(c)) a.digits++;
  const bH = inkBox(f, rowsOf(f, 72)), bx = inkBox(f, rowsOf(f, 120));
  if (bH) { a.capTop = bH.y0; a.capBottom = bH.y1; }
  if (bx) a.xTop = bx.y0;
  for (const ch of 'gjpqy') { const b = inkBox(f, rowsOf(f, ch.charCodeAt(0))); if (b) a.descBottom = Math.max(a.descBottom, b.y1); }
  for (const c of [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 69, 72, 120]) {
    const n = inkCnt(rowsOf(f, c));
    if (!n) continue;
    a.supTried++; a.subTried++;
    if (inkCnt(CF.render(f, c, 1)) === n) a.supOk++;
    if (inkCnt(CF.render(f, c, 2)) === n) a.subOk++;
  }
  return a;
}

function diffFonts(a, b) {
  let diff = 0, total = 0; const bad = [];
  for (let c = 0; c < 256; c++) {
    const ga = rowsOf(a, c), gb = rowsOf(b, c); let d = 0;
    for (let r = 0; r < Math.max(a.rows, b.rows); r++) for (let q = 0; q < Math.max(a.gw, b.gw); q++) {
      const pa = q < a.gw && r < a.rows && CF.hasPx(a, ga[r] || 0, q), pb = q < b.gw && r < b.rows && CF.hasPx(b, gb[r] || 0, q);
      if (pa) total++;
      if (pa !== pb) d++;
    }
    if (d) { diff += d; bad.push(c); }
  }
  let advBad = 0;
  for (let c = 0; c < 256; c++) if (advOf(a, c) !== advOf(b, c)) advBad++;
  return { diff, total, frac: total ? diff / total : 0, bad, advBad };
}

// ---- TrueType / OpenType / WOFF -> Craft (DOWN) --------------------------------------------------------------------------------
function sfntInfo(font) {
  const hb = (cp) => { const g = font.gidFor(cp); return g ? font.bbox(g) : null; };
  const H = hb(72) || hb(0x48), x = hb(120), n = font.gidFor(110);
  const bl = H ? H.y0 : 0;
  let capH = H ? H.y1 - H.y0 : font.capHeight || font.upm * 0.7;
  if (capH <= 0) capH = font.upm * 0.7;
  const xH = x ? Math.max(1, x.y1 - bl) : capH * 0.7;
  const nAdv = n ? font.advance(n) : font.upm * 0.6;
  return { bl, capH, xH, nAdv };
}

// Pixel fonts (an em of 6-10 pixels, nearly every outline coordinate a multiple of one pixel) are sampled on their own grid instead of
// being scaled. Returns the pixel size in font units, or 0.
function pixelUnit(font) {
  for (const n of [8, 7, 9, 10, 6]) {
    const unit = font.upm / n;
    if (unit !== Math.round(unit)) continue;
    let on = 0, all = 0;
    for (let cp = 33; cp < 127; cp++) {
      const id = font.gidFor(cp); if (!id) continue;
      for (const poly of font.outline(id)) for (const [x, y] of poly) { all += 2; if (Math.abs(x / unit - Math.round(x / unit)) < 1e-6) on++; if (Math.abs(y / unit - Math.round(y / unit)) < 1e-6) on++; }
    }
    if (all > 200 && on / all >= 0.97) return unit;
  }
  return 0;
}
// Scales a TrueType font into one Craft size. Capitals fill the cap rows, glyphs are squeezed into the ink columns (same rules as the
// browser rasteriser CF.rasterTtf), the baseline is the bottom of H. Advances stay proportional: advs holds each glyph's advance in px.
function rasterFont(input, size, opt = {}) {
  const font = input.outline ? input : SF.parse(input);
  const spec = CF.SIZES[size]; if (!spec) throw new Error('unknown size ' + size);
  const { adv, gw, rows, head, base } = spec, th = opt.threshold ?? 0.3, wt = opt.weight || 0;
  const info = sfntInfo(font), capRows = base - head + 1, sc = capRows / info.capH;
  const nW = info.nAdv * sc, thEff = th - wt * 0.08;
  let sy = 1;
  if (opt.hint) { const xH = info.xH * sc; sy = Math.max(1, Math.round(xH)) / xH; }
  const f = CF.create(Object.assign({}, spec, { name: (opt.name || font.family || 'Font').slice(0, 40), masterAdv: size === 12 ? 0 : 12 }));
  const nId = font.gidFor(110), refAdv = nId ? font.advance(nId) : info.nAdv;
  f.xinfo = {};
  for (let a = 32; a < 128; a++) {
    const id = font.gidFor(a);
    if (!id && a !== 32) continue;
    const rawUnits = id ? font.advance(id) : refAdv * 0.5, raw = Math.max(0.01, rawUnits * sc), gx = Math.min((gw * 0.92) / nW, gw / raw);
    const tx = Math.max(0, (gw - raw * gx) / 2);
    const polys = id ? font.outline(id).map((p) => p.map(([x, y]) => [tx + x * sc * gx, base + 1 - (y - info.bl) * sc * sy])) : [];
    const cov = SF.coverage(polys, gw, rows, 8), g = zeros(rows), top = CF.topBit(f);
    let mx = 0;
    for (let r = 0; r < rows; r++) for (let q = 0; q < gw; q++) { const c = cov[r * gw + q]; if (c > mx) mx = c; if (c >= thEff) g[r] |= top >> q; }
    if (!hasInk(g) && mx > 0.05) for (let i = 0; i < cov.length; i++) if (cov[i] >= mx * 0.6) g[(i / gw) | 0] |= top >> (i % gw);
    f.glyphs[a] = g;
    let pa = clamp(Math.round((rawUnits / refAdv) * adv), 1, adv);
    const box = inkBox(f, g);
    if (box) pa = Math.max(pa, Math.min(adv, box.w));
    if (pa !== adv) f.advs[a] = pa;
  }
  return f;
}

// Samples a pixel-grid font exactly: one outline unit step = one cell pixel, baseline row = base.
function gridFont(input, size, opt = {}) {
  const font = input.outline ? input : SF.parse(input), unit = opt.unit || pixelUnit(font);
  if (!unit) throw new Error('not a pixel-grid font');
  const spec = CF.SIZES[size], { gw, rows, base } = spec, info = sfntInfo(font);
  const f = CF.create(Object.assign({}, spec, { name: (opt.name || font.family || 'Font').slice(0, 40), first: 0, count: 256 }));
  f.xinfo = {};
  const unitAdv = Math.round(font.advance(font.gidFor(110) || font.gidFor(72) || 1) / unit);
  for (let a = 0; a < 256; a++) {
    const id = font.gidFor(a); if (!id) continue;
    const polys = font.outline(id).map((p) => p.map(([x, y]) => [x / unit, base + 1 - (y - info.bl) / unit]));
    const cov = SF.coverage(polys, gw, rows, 4), g = zeros(rows), top = CF.topBit(f);
    for (let r = 0; r < rows; r++) for (let q = 0; q < gw; q++) if (cov[r * gw + q] >= 0.5) g[r] |= top >> q;
    f.glyphs[a] = g;
    const adv = Math.round(font.advance(id) / unit);
    if (adv !== unitAdv && adv >= 1 && adv <= 16) f.advs[a] = adv;
  }
  f.pixelAdv = unitAdv;
  return f;
}

// advance table of dst from src: every per-glyph advance scaled by dst.adv / src.adv
function scaleAdvs(src, dst) {
  const o = {};
  for (const k of Object.keys(src.advs || {})) { const v = clamp(Math.round((src.advs[k] / src.adv) * dst.adv), 1, dst.adv); if (v !== dst.adv) o[k] = v; }
  return o;
}

// DOWN: a font file -> family of Craft sizes. opts: sizes, threshold, weight, hint, direct (rasterise every size instead of deriving),
// name. Returns { fam, info: { kind, pixel, warnings } }.
function down(input, name, opt = {}) {
  const font = SF.parse(input), want = (opt.sizes || SIZES).map(Number);
  const nm = opt.name || font.family || baseName(name), warnings = [];
  const unit = opt.noGrid ? 0 : pixelUnit(font);
  const master = rasterFont(font, 12, Object.assign({}, opt, { name: nm }));
  const fam = CF.familyNew(master, nm);
  if (opt.direct) {
    for (const s of want) if (s !== 12) fam.sizes[s] = Object.assign(rasterFont(font, s, Object.assign({}, opt, { name: nm + ' ' + s })), { origin: CF.ORIGIN.master });
  } else {
    CF.familyDerive(fam, want.filter((s) => s !== 12), { threshold: opt.deriveThreshold });
    for (const s of want) if (s !== 12 && fam.sizes[s]) { fam.sizes[s].advs = scaleAdvs(master, fam.sizes[s]); fam.sizes[s].xinfo = {}; }
  }
  if (unit && want.includes(8)) {
    const g8 = gridFont(font, 8, { unit, name: nm + ' 8x8' });
    g8.origin = CF.ORIGIN.master; g8.masterAdv = 0;
    fam.sizes[8] = g8;
    if (!opt.direct) {
      for (const s of [6, 5, 4]) if (want.includes(s)) { const d = CF.derive(g8, s, { threshold: opt.deriveThreshold }); d.name = nm + ' ' + s; d.advs = scaleAdvs(g8, d); d.xinfo = {}; fam.sizes[s] = d; }
    }
  }
  for (const s of want) {
    const f = fam.sizes[s]; if (!f) continue;
    f.name = f.name.slice(0, 40);
  }
  for (const s of Object.keys(fam.sizes)) if (!want.includes(+s)) delete fam.sizes[s];
  return { fam, info: { kind: font.kind, pixel: unit ? unit : 0, upm: font.upm, glyphs: font.numGlyphs, family: font.family, metrics: sfntInfo(font), warnings } };
}

// ---- Atari sources (UP) --------------------------------------------------------------------------------------------------------
const romCharset = (b) => {
  const n = b.length, at = n === 16384 ? 0x2000 : n === 10240 ? 0x0800 : -1;
  if (at < 0) return null;
  const cs = b.subarray(at, at + 1024);
  if (cs.slice(0, 8).some((v) => v) || !cs.slice(33 * 8, 34 * 8).some((v) => v)) return null; // space is blank, 'A' (screen code 33) is not
  return cs;
};

function detect(input, name) {
  const b = bytes(input), m4 = text(b.subarray(0, 4)), ext = (String(name || '').match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (m4 === 'ACF2' || m4 === 'ACF1') return 'acf';
  if (m4 === 'wOFF') return 'woff';
  if (m4 === 'wOF2') return 'woff2';
  if (m4 === 'OTTO' || m4 === 'true' || m4 === 'ttcf' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  if (text(b.subarray(0, 9)) === 'STARTFONT') return 'bdf';
  if (b.length > 8 && b[0] === 1 && b[1] === 0x66 && b[2] === 0x63 && b[3] === 0x70) return 'pcf';
  if (b[0] === 0x7b || (b[0] === 0xef && b[1] === 0xbb)) {
    try { const o = JSON.parse(text(b).replace(/^\uFEFF/, '')); return o.format === 'xcf' ? 'xcf' : o.format === 'craft-family' ? 'family' : o.format === 'craft-font' ? 'json' : 'unknown'; } catch (e) { return 'unknown'; }
  }
  if (b.length === 16384 || b.length === 10240) return romCharset(b) ? 'rom' : ext === 'rom' ? 'rom-nocharset' : 'unknown';
  if (b.length === 1024 || b.length === 2048) return 'fnt';
  return 'unknown';
}

// BDF -> Craft font. Honours the ACFM comment (our own export) and DWIDTH advances; otherwise the cell is 12 for tall fonts and 8 otherwise.
function fromBdfText(textIn, opt = {}) {
  const lines = String(textIn).split(/\r?\n/);
  let meta = null, fbw = 0, fbh = 0, fam = '';
  for (const l of lines) {
    let m;
    if ((m = /^COMMENT ACFM (.*)$/.exec(l))) { try { meta = JSON.parse(m[1]); } catch (e) { /* ignore */ } }
    if ((m = /^FONTBOUNDINGBOX\s+(-?\d+)\s+(-?\d+)/.exec(l))) { fbw = +m[1]; fbh = +m[2]; }
    if ((m = /^FAMILY_NAME\s+"?([^"]*)"?/.exec(l))) fam = m[1];
  }
  let f;
  if (meta) { f = CF.fromJson(Object.assign({ format: 'craft-font', glyphs: {} }, meta.font)); f.sh = meta.sh || {}; f.xinfo = meta.xinfo || {}; }
  else {
    const size = opt.size || (fbh > 10 ? 12 : 8);
    f = CF.createSize(size, { name: (opt.name || fam || 'BDF font').slice(0, 40), first: 0, count: 256 }); f.sh = {}; f.xinfo = {};
  }
  let cur = null, bits = false, clipped = 0;
  for (const l of lines) {
    let m;
    if (l.startsWith('STARTCHAR')) { cur = { enc: -1, dw: 0, w: 0, h: 0, xo: 0, yo: 0, rows: [] }; bits = false; }
    else if (!cur) continue;
    else if ((m = /^ENCODING\s+(-?\d+)/.exec(l))) cur.enc = +m[1];
    else if ((m = /^DWIDTH\s+(-?\d+)/.exec(l))) cur.dw = +m[1];
    else if ((m = /^BBX\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(l))) { cur.w = +m[1]; cur.h = +m[2]; cur.xo = +m[3]; cur.yo = +m[4]; }
    else if (l.startsWith('BITMAP')) bits = true;
    else if (l.startsWith('ENDCHAR')) {
      if (cur.enc >= 0 && cur.enc < 256) {
        const g = zeros(f.rows), top = f.base - cur.yo - cur.h + 1, sh = f.sh[cur.enc] || 0;
        cur.rows.forEach((hx, i) => {
          const y = top + i;
          for (let x = 0; x < cur.w; x++) {
            const byte = parseInt(hx.substr((x >> 3) * 2, 2) || '0', 16);
            if (!(byte & (0x80 >> (x & 7)))) continue;
            const q = cur.xo + x + sh;
            if (y < 0 || y >= f.rows || q < 0 || q >= f.gw) { clipped++; continue; }
            g[y] |= CF.bitMask(f, q);
          }
        });
        f.glyphs[cur.enc] = g;
        if (cur.dw && cur.dw !== f.adv) f.advs[cur.enc] = cur.dw;
      }
      cur = null; bits = false;
    } else if (bits && /^[0-9A-Fa-f]+$/.test(l.trim())) cur.rows.push(l.trim());
  }
  f.clipped = clipped;
  return f;
}

// Craft font -> BDF text. The ACFM comment carries the model (metrics, map, advances, variants) so a Craft font comes back unchanged.
function toBdf(f) {
  const sh = {}, o = [];
  const codes = codesOf(f);
  for (const c of codes) { const m = glyphMetrics(f, c); if (m.sh) sh[c] = m.sh; }
  const model = JSON.parse(CF.toJson(f)); model.glyphs = {};
  const name = f.name.replace(/[^A-Za-z0-9 _.-]/g, '');
  o.push('STARTFONT 2.1', 'COMMENT Craft font exported by fontpipe (docs/FONT.md)', 'COMMENT ACFM ' + JSON.stringify({ font: model, sh, xinfo: f.xinfo || {} }));
  o.push('FONT -acf-' + name.replace(/ /g, '-') + '-medium-r-normal--' + f.rows + '-' + f.rows * 10 + '-75-75-c-' + f.adv * 10 + '-iso10646-1');
  o.push('SIZE ' + f.rows + ' 75 75', 'FONTBOUNDINGBOX ' + f.adv + ' ' + f.rows + ' 0 ' + -(f.rows - f.base - 1));
  o.push('STARTPROPERTIES 5', 'FAMILY_NAME "' + name + '"', 'PIXEL_SIZE ' + f.rows, 'FONT_ASCENT ' + (f.base + 1), 'FONT_DESCENT ' + (f.rows - f.base - 1), 'DEFAULT_CHAR 32', 'ENDPROPERTIES');
  o.push('CHARS ' + codes.length);
  for (const c of codes) {
    const g = rowsOf(f, c), box = inkBox(f, g), m = glyphMetrics(f, c);
    o.push('STARTCHAR ' + glyphName(c), 'ENCODING ' + c, 'SWIDTH ' + Math.round((m.adv * 1000) / f.rows) + ' 0', 'DWIDTH ' + m.adv + ' 0');
    if (!box) { o.push('BBX 0 0 0 0', 'BITMAP', 'ENDCHAR'); continue; }
    o.push('BBX ' + box.w + ' ' + box.h + ' ' + (box.x0 - m.sh) + ' ' + (f.base - box.y1), 'BITMAP');
    for (let r = box.y0; r <= box.y1; r++) {
      let hx = '';
      for (let b = 0; b < Math.ceil(box.w / 8); b++) { let v = 0; for (let k = 0; k < 8; k++) { const q = box.x0 + b * 8 + k; if (q <= box.x1 && CF.hasPx(f, g[r], q)) v |= 0x80 >> k; } hx += v.toString(16).padStart(2, '0'); }
      o.push(hx.toUpperCase());
    }
    o.push('ENDCHAR');
  }
  o.push('ENDFONT');
  return o.join('\n') + '\n';
}

// ---- TrueType export / re-import of an exported font ------------------------------------------------------------------------------
const PX = 100;
function toTtf(f) {
  const codes = codesOf(f), glyphs = [], meta = { font: null, sh: {}, xinfo: f.xinfo || {} };
  const box = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  glyphs.push({ unicode: [], adv: f.adv * PX, contours: [box(PX, 0, PX * 3, (f.base + 1) * PX)] });
  for (const c of codes) {
    const g = rowsOf(f, c), m = glyphMetrics(f, c), cs = [];
    if (m.sh) meta.sh[c] = m.sh;
    for (let r = 0; r < f.rows; r++) {
      let q = 0;
      while (q < f.gw) {
        if (!CF.hasPx(f, g[r], q)) { q++; continue; }
        let e = q; while (e + 1 < f.gw && CF.hasPx(f, g[r], e + 1)) e++;
        cs.push(box((q - m.sh) * PX, (f.base - r) * PX, (e + 1 - m.sh) * PX, (f.base + 1 - r) * PX));
        q = e + 1;
      }
    }
    glyphs.push({ unicode: [uniOf(c)], adv: m.adv * PX, contours: cs });
  }
  const model = JSON.parse(CF.toJson(f)); model.glyphs = {}; meta.font = model;
  const hh = (r) => (f.base + 1 - r) * PX;
  return SF.build({
    name: f.name.slice(0, 40), upm: f.rows * PX, ascent: hh(0), descent: -(f.rows - f.base - 1) * PX, capHeight: (f.base - f.head + 1) * PX, xHeight: (f.base - f.xTop + 1) * PX,
    glyphs, extra: { ACFM: enc(JSON.stringify(meta)) },
  });
}

// A TrueType font written by toTtf (has the ACFM table) is read back exactly; any other font goes through down().
function fromTtfExport(input) {
  const font = SF.parse(input), t = font.table('ACFM');
  if (!t) return null;
  const meta = JSON.parse(text(t)), f = CF.fromJson(Object.assign({ format: 'craft-font', glyphs: {} }, meta.font));
  f.sh = meta.sh || {}; f.xinfo = meta.xinfo || {};
  for (let c = 0; c < 256; c++) {
    const id = font.gid(uniOf(c)); if (!id) continue;
    const sh = f.sh[c] || 0, g = zeros(f.rows);
    for (const poly of font.outline(id)) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const r = f.base - Math.round(y1 / PX) + 1;
      for (let q = Math.round(x0 / PX) + sh; q < Math.round(x1 / PX) + sh; q++) if (r >= 0 && r < f.rows && q >= 0 && q < f.gw) g[r] |= CF.bitMask(f, q);
    }
    f.glyphs[f.map[c]] = g;
    const adv = Math.round(font.advance(id) / PX);
    if (adv !== f.adv) f.advs[f.map[c]] = adv; else delete f.advs[f.map[c]];
  }
  return f;
}

// ---- XCF (xCWriter font) ---------------------------------------------------------------------------------------------------------
// JSON. A superset of craft-family: every size is a craft-font object (ACF2 model, hex rows) and additionally carries "info" per glyph code
// (name, unicode, advance, left/right bearing, ink width) and "metrics". Reading an XCF only needs the craft-font part; info is derived data.
function toXcf(input, meta = {}) {
  const fam = input.sizes ? input : CF.familyNew(input, input.name);
  const sizes = {}, master = fam.sizes[fam.master];
  for (const k of Object.keys(fam.sizes)) {
    const f = fam.sizes[k], o = JSON.parse(CF.toJson(f)), info = {};
    for (const c of codesOf(f)) {
      const g = rowsOf(f, c), m = glyphMetrics(f, c);
      if (!hasInk(g) && c !== 32) continue;
      info[c] = { n: glyphName(c), u: uniOf(c), adv: m.adv, lsb: (f.xinfo && f.xinfo[c] && f.xinfo[c].lsb) ?? m.lsb, rsb: m.rsb, ink: m.ink };
    }
    o.info = info;
    o.metrics = { rows: f.rows, head: f.head, capTop: f.head, xTop: f.xTop, base: f.base, desc: f.desc, capRows: f.base - f.head + 1, xRows: f.base - f.xTop + 1, descRows: f.rows - f.base - 1, supUp: f.supUp, subDown: f.subDown };
    sizes[k] = o;
  }
  return JSON.stringify({
    format: 'xcf', version: 1, name: fam.name || master.name, family: meta.family || fam.name || master.name, style: meta.style || 'Regular', master: fam.master,
    source: meta.source || null, hires: meta.hires || null, sizes,
  }, null, 1);
}
function fromXcf(textIn) {
  const o = typeof textIn === 'string' ? JSON.parse(textIn) : textIn;
  if (o.format !== 'xcf') throw new Error('not an XCF font');
  const fam = { format: 'craft-family', version: 1, name: o.name, master: o.master, sizes: {} };
  for (const k of Object.keys(o.sizes)) {
    const s = Object.assign({}, o.sizes[k]); delete s.info; delete s.metrics;
    const f = CF.fromJson(s);
    f.xinfo = {};
    for (const c of Object.keys(o.sizes[k].info || {})) f.xinfo[c] = { lsb: o.sizes[k].info[c].lsb };
    fam.sizes[k] = f;
  }
  return { fam, meta: { family: o.family, style: o.style, source: o.source, hires: o.hires } };
}

// ---- load anything (UP) ------------------------------------------------------------------------------------------------------------
// Returns { kind, fam, warnings }. Atari-side sources give a family with the source's own size as master; smaller sizes are derived.
function load(input, name, opt = {}) {
  const b = bytes(input), kind = detect(b, name), nm = opt.name || baseName(name), warnings = [];
  let fam;
  if (kind === 'ttf') { const ex = fromTtfExport(b); if (ex) { if (!ex.xinfo) ex.xinfo = {}; return { kind, fam: CF.familyNew(ex, ex.name || nm), info: { warnings } }; } }
  if (kind === 'ttf' || kind === 'woff') return Object.assign({ kind }, down(b, name, opt));
  if (kind === 'woff2') throw new Error('WOFF2 is not supported; convert to WOFF or TTF first');
  if (kind === 'xcf') { const r = fromXcf(text(b)); return { kind, fam: r.fam, info: { warnings }, meta: r.meta }; }
  if (kind === 'family') return { kind, fam: CF.familyFromJson(text(b)), info: { warnings } };
  let f;
  if (kind === 'acf') f = CF.parse(b);
  else if (kind === 'json') f = CF.fromJson(text(b));
  else if (kind === 'bdf') { f = fromBdfText(text(b), { name: nm, size: opt.size }); if (f.clipped) warnings.push(f.clipped + ' BDF pixels outside the ' + f.adv + 'x' + f.rows + ' cell were clipped'); }
  else if (kind === 'pcf') { f = CF.fromPcf(b, { name: nm, size: opt.size }); }
  else if (kind === 'fnt') f = CF.fromFnt(b, { name: nm });
  else if (kind === 'rom') f = CF.fromFnt(romCharset(b), { name: nm });
  else if (kind === 'rom-nocharset') throw new Error('ROM image has no Atari character set at the standard location');
  else throw new Error('unrecognised font file' + (name ? ' (' + name + ')' : ''));
  if (!f.xinfo) f.xinfo = {};
  fam = CF.familyNew(f, f.name || nm);
  const smaller = (opt.sizes || SIZES).map(Number).filter((s) => s < f.adv && s !== f.adv);
  if (smaller.length && opt.derive !== false) CF.familyDerive(fam, smaller, {});
  return { kind, fam, info: { warnings } };
}

// ---- outputs ---------------------------------------------------------------------------------------------------------------------
// files(fam, base, { formats }) -> { 'name.ext': Uint8Array | string }. formats: acf (per size), xcf, bdf, ttf, fnt (8 px), json.
function files(fam, base, opt = {}) {
  const fm = opt.formats || ['acf', 'xcf', 'bdf', 'ttf', 'fnt'], out = {};
  const sizes = Object.keys(fam.sizes).map(Number).sort((a, b) => b - a);
  for (const s of sizes) {
    const f = fam.sizes[s], tag = sizes.length > 1 ? '-' + s : '';
    if (fm.includes('acf')) out[base + tag + '.acf'] = CF.serialize(f);
    if (fm.includes('bdf')) out[base + tag + '.bdf'] = toBdf(f);
    if (fm.includes('ttf')) out[base + tag + '.ttf'] = toTtf(f);
    if (fm.includes('json')) out[base + tag + '.json'] = CF.toJson(f);
    if (fm.includes('fnt') && f.adv === 8) out[base + '.fnt'] = CF.toFnt(f);
  }
  if (fm.includes('xcf')) out[base + '.xcf'] = toXcf(fam, opt.meta || {});
  return out;
}

// Reads any exported file back (used for round trips): TrueType written by toTtf, BDF, ACF, XCF, JSON.
function readBack(name, data, size) {
  const kind = detect(data, name);
  if (kind === 'ttf') { const f = fromTtfExport(data); if (f) return f; throw new Error('TrueType file was not written by fontpipe'); }
  if (kind === 'bdf') return fromBdfText(text(data), { size });
  if (kind === 'acf') return CF.parse(data);
  if (kind === 'json') return CF.fromJson(text(data));
  if (kind === 'xcf') { const r = fromXcf(text(data)); return r.fam.sizes[size] || r.fam.sizes[r.fam.master]; }
  if (kind === 'fnt') return CF.fromFnt(data, { name: baseName(name) });
  throw new Error('cannot read back ' + name);
}

// Round trip of one source: load -> every size to ACF, XCF, BDF, TTF (and .fnt for 8 px) -> read back -> pixel diff against the first generation.
function roundtrip(input, name, opt = {}) {
  const r = load(input, name, opt), base = baseName(name), res = { kind: r.kind, sizes: {}, info: r.info, fam: r.fam };
  const out = files(r.fam, base, opt);
  for (const s of Object.keys(r.fam.sizes).map(Number)) {
    const f = r.fam.sizes[s], row = { adv: f.adv, analysis: analyze(f), paths: {} };
    for (const [fn, data] of Object.entries(out)) {
      const ext = fn.replace(/^.*\./, '');
      const tag = fn.replace(/\.[^.]+$/, '');
      const mine = ext === 'xcf' || ext === 'fnt' ? true : tag.endsWith('-' + s) || Object.keys(r.fam.sizes).length === 1;
      if (!mine) continue;
      if (ext === 'fnt') { if (f.adv === 8 && (r.kind === 'fnt' || r.kind === 'rom')) row.paths.fnt = diffFonts(f, readBack(fn, data, s)); continue; }
      row.paths[ext] = diffFonts(f, readBack(fn, typeof data === 'string' ? enc(data) : data, s));
    }
    res.sizes[s] = row;
  }
  return res;
}

module.exports = { SIZES, detect, load, down, rasterFont, gridFont, pixelUnit, sfntInfo, romCharset, fromBdfText, toBdf, toTtf, fromTtfExport, toXcf, fromXcf, files, readBack, roundtrip, analyze, diffFonts, glyphMetrics, glyphName, uniOf, codeOfUni, inkBox, codesOf, baseName };
