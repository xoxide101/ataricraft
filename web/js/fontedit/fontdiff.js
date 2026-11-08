// Font compare and copy/transfer (web/fontedit.html "Compare" tab): per-glyph diff of two or more fonts, and planning of copies between fonts
// (glyph sets, ranges with an offset map, metrics, kerning). DOM-free, UMD: window.FEDiff in the editor, require() in Node tests.
// Nothing here touches the editor state: `plan*` return what would change, `apply*` write into a font you pass in, so the caller can
// take its undo snapshot first.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FEDiff = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const advOf = (f, code) => (f.advs && f.advs[f.map[code & 255]]) || f.adv;
  const colsOf = (CF, f, code) => CF.colsOf(f, f.map[code & 255]);
  const rowsOf = (CF, f, code) => CF.glyph(f, code) || [];
  const present = (CF, f, code) => code === 32 || rowsOf(CF, f, code).some((v) => v);
  const countPx = (CF, f, code) => { const g = rowsOf(CF, f, code), n = colsOf(CF, f, code); let c = 0; for (let r = 0; r < f.rows; r++) for (let q = 0; q < n; q++) if (CF.hasPx(f, g[r] || 0, q)) c++; return c; };
  const shiftOf = (A, B, align) => (align === 'top' ? 0 : B.base - A.base);

  // Overlay of B on A (rows in A's coordinates, B moved so baselines meet): cells 0 none, 1 both, 2 only A, 3 only B.
  function overlay(CF, A, B, code, align) {
    const dy = shiftOf(A, B, align), y0 = Math.min(0, -dy), y1 = Math.max(A.rows, B.rows - dy), w = Math.max(colsOf(CF, A, code), colsOf(CF, B, code), 1), h = y1 - y0;
    const gA = rowsOf(CF, A, code), gB = rowsOf(CF, B, code), nA = colsOf(CF, A, code), nB = colsOf(CF, B, code), d = new Uint8Array(w * h);
    for (let r = y0; r < y1; r++) for (let q = 0; q < w; q++) {
      const a = r >= 0 && r < A.rows && q < nA && CF.hasPx(A, gA[r] || 0, q), rb = r + dy, b = rb >= 0 && rb < B.rows && q < nB && CF.hasPx(B, gB[rb] || 0, q);
      d[(r - y0) * w + q] = a && b ? 1 : a ? 2 : b ? 3 : 0;
    }
    return { w, h, y0, d };
  }
  const METRICS = ['adv', 'gw', 'rows', 'head', 'xTop', 'base', 'desc', 'supUp', 'subDown'];
  // Compare font B with the reference A (one size each). o: { align: 'baseline' | 'top', codes }
  function diffFonts(CF, A, B, o = {}) {
    const align = o.align || 'baseline', codes = o.codes || Array.from({ length: 256 }, (_, i) => i), rows = [];
    const sum = { compared: 0, same: 0, changed: 0, missing: 0, extra: 0, empty: 0, changedPx: 0, onlyA: 0, onlyB: 0, both: 0, advDiff: 0 };
    for (const code of codes) {
      const a = present(CF, A, code), b = present(CF, B, code), r = { code, a, b, advA: advOf(A, code), advB: advOf(B, code), dyB: shiftOf(A, B, align) };
      r.pxA = a ? countPx(CF, A, code) : 0; r.pxB = b ? countPx(CF, B, code) : 0; r.both = r.onlyA = r.onlyB = 0;
      if (a || b) { const ov = overlay(CF, A, B, code, align); for (const v of ov.d) { if (v === 1) r.both++; else if (v === 2) r.onlyA++; else if (v === 3) r.onlyB++; } }
      r.changed = r.onlyA + r.onlyB;
      r.status = !a && !b ? 'empty' : a && !b ? 'missing' : !a && b ? 'extra' : r.changed ? 'changed' : 'same';
      if (r.advA !== r.advB && (a || b)) { sum.advDiff++; r.advDiffers = true; }
      sum[r.status]++; if (r.status !== 'empty') sum.compared++;
      sum.changedPx += r.changed; sum.onlyA += r.onlyA; sum.onlyB += r.onlyB; sum.both += r.both;
      rows.push(r);
    }
    const union = sum.both + sum.onlyA + sum.onlyB; sum.similarity = union ? sum.both / union : 1;
    const metrics = METRICS.map((k) => ({ key: k, a: A[k], b: B[k], differs: A[k] !== B[k] }));
    return { align, rows, summary: sum, metrics };
  }
  // kern tables are { 'left,right': value }; class pairs are expanded by the caller (see kernTable)
  function kernDiff(a, b) {
    const out = { onlyA: [], onlyB: [], differ: [] }, keys = (t) => Object.keys(t || {}).filter((k) => k[0] !== '@' && t[k]);
    for (const k of keys(a)) { if (!b || !b[k]) out.onlyA.push([k, a[k]]); else if (b[k] !== a[k]) out.differ.push([k, a[k], b[k]]); }
    for (const k of keys(b)) if (!a || !a[k]) out.onlyB.push([k, b[k]]);
    return out;
  }
  // plain pair table from a lookup function (so kerning classes count too)
  function kernTable(get, codes) {
    const t = {}; for (const a of codes) for (const b of codes) { const v = get(a, b); if (v) t[a + ',' + b] = v; } return t;
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function toCsv(items) {
    const out = [['reference', 'font', 'code', 'char', 'status', 'pxA', 'pxB', 'both', 'onlyA', 'onlyB', 'changedPx', 'advA', 'advB'].join(',')];
    for (const it of items) for (const r of it.diff.rows) if (r.status !== 'empty') out.push([it.ref, it.name, r.code, r.code > 32 && r.code < 127 ? String.fromCharCode(r.code) : '', r.status, r.pxA, r.pxB, r.both, r.onlyA, r.onlyB, r.changed, r.advA, r.advB].map(csvCell).join(','));
    return out.join('\n') + '\n';
  }
  const toJson = (items) => JSON.stringify(items.map((it) => ({ reference: it.ref, font: it.name, align: it.diff.align, summary: it.diff.summary, metrics: it.diff.metrics, kerning: it.kern || null, glyphs: it.diff.rows.filter((r) => r.status !== 'empty') })), null, 1);

  // ---- code sets ------------------------------------------------------------------------------------------------------------------------
  // "A-Z a-z 0-9": bare tokens are characters; #65, 0x41 and U+0041 are codes; "65-90" (more than one digit each side) is a decimal range.
  function parseCodes(str, codeOfChar = (ch) => { const c = ch.codePointAt(0); return c < 256 ? c : 63; }) {
    const set = new Set(), num = (t) => (/^#\d+$/.test(t) ? +t.slice(1) : /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : /^u\+[0-9a-f]+$/i.test(t) ? parseInt(t.slice(2), 16) : NaN);
    const one = (t) => { const n = num(t); if (!Number.isNaN(n)) return n; const a = [...t]; return a.length === 1 ? codeOfChar(a[0]) : NaN; };
    for (const tok of String(str || '').split(/[\s,;]+/).filter(Boolean)) {
      let m, lo, hi;
      if ((m = /^(\d{2,})-(\d{2,})$/.exec(tok))) { lo = +m[1]; hi = +m[2]; }
      else if ((m = /^u\+([0-9a-f]+)-(?:u\+)?([0-9a-f]+)$/i.exec(tok))) { lo = parseInt(m[1], 16); hi = parseInt(m[2], 16); }
      else if ((m = /^(#\d+|0x[0-9a-f]+|u\+[0-9a-f]+|[^-])-(#\d+|0x[0-9a-f]+|u\+[0-9a-f]+|[^-])$/iu.exec(tok)) && [...tok].length >= 3) { lo = one(m[1]); hi = one(m[2]); }
      if (lo !== undefined && !Number.isNaN(lo) && !Number.isNaN(hi)) { if (lo > hi) [lo, hi] = [hi, lo]; for (let c = lo; c <= hi && c < 256; c++) if (c >= 0) set.add(c); continue; }
      const n = num(tok); if (!Number.isNaN(n)) { if (n >= 0 && n < 256) set.add(n); continue; }
      for (const ch of tok) { const c = codeOfChar(ch); if (c >= 0 && c < 256) set.add(c); }
    }
    return [...set].sort((a, b) => a - b);
  }

  // ---- glyph transfer ---------------------------------------------------------------------------------------------------------------------
  // Source pixel grid of a glyph as 0/1 rows x cols
  function grid(CF, f, code) {
    const g = rowsOf(CF, f, code), n = colsOf(CF, f, code), out = [];
    for (let r = 0; r < f.rows; r++) { const row = new Uint8Array(n); for (let q = 0; q < n; q++) row[q] = CF.hasPx(f, g[r] || 0, q) ? 1 : 0; out.push(row); }
    return out;
  }
  // Place the source glyph in the cell of dst. mode 'copy': pixel for pixel, left edge kept, baselines aligned (clipped at the cell);
  // 'scale': resampled by the ratio of the cap heights with area coverage >= threshold, baseline and left edge kept.
  function convert(CF, src, dst, code, tcode, o = {}) {
    const g = grid(CF, src, code), n = colsOf(CF, dst, tcode), rows = new Array(dst.rows).fill(0), top = CF.topBit(dst);
    const dy = o.baseline === false ? 0 : dst.base - src.base;
    const cap = (f) => Math.max(1, f.base - f.head + 1), s = o.mode === 'scale' ? cap(dst) / cap(src) : 1, th = o.threshold ?? 0.5;
    for (let tr = 0; tr < dst.rows; tr++) for (let tq = 0; tq < n; tq++) {
      let on = false;
      if (s === 1) { const sr = tr - dy, sq = tq; on = sr >= 0 && sr < src.rows && sq < g[0].length && g[sr][sq] === 1; }
      else {
        // target pixel box in source coordinates, rows measured from the baseline
        const yb = (dst.base + 1 - (tr + 1)) / s, yt = (dst.base + 1 - tr) / s, sb = src.base + 1;
        const xa = tq / s, xb = (tq + 1) / s; let ink = 0, tot = 0;
        for (let sr = Math.floor(sb - yt); sr <= Math.ceil(sb - yb) - 1; sr++) {
          const oy = Math.min(sb - yb, sr + 1) - Math.max(sb - yt, sr); if (oy <= 0) continue;
          for (let sq = Math.floor(xa); sq <= Math.ceil(xb) - 1; sq++) {
            const ox = Math.min(xb, sq + 1) - Math.max(xa, sq); if (ox <= 0) continue;
            tot += ox * oy; if (sr >= 0 && sr < src.rows && sq < g[0].length && g[sr][sq]) ink += ox * oy;
          }
        }
        on = tot > 0 && ink / tot >= th;
      }
      if (on) rows[tr] |= top >>> tq;
    }
    let adv = advOf(src, code);
    if (o.mode === 'scale') adv = Math.max(1, Math.min(dst.adv, Math.round(adv * dst.adv / src.adv)));
    return { rows, adv };
  }
  // codes: source codes. o.offset: target = source + offset. o.mode, o.baseline, o.threshold, o.overwrite ('all' | 'empty'), o.advs (copy advances).
  function planGlyphs(CF, src, dst, codes, o = {}) {
    const items = [], skipped = [], off = o.offset || 0;
    for (const code of codes) {
      const tcode = code + off;
      if (tcode < 0 || tcode > 255) { skipped.push({ code, why: 'target code ' + tcode + ' is outside 0-255' }); continue; }
      if (!present(CF, src, code) && o.skipEmpty !== false && code !== 32) { skipped.push({ code, why: 'empty in the source' }); continue; }
      const slot = dst.map[tcode], old = (dst.glyphs[slot] || []).slice(), had = old.some((v) => v);
      if (o.overwrite === 'empty' && had) { skipped.push({ code, why: 'target glyph is not empty' }); continue; }
      const r = convert(CF, src, dst, code, tcode, o);
      items.push({ code, tcode, slot, rows: r.rows, adv: o.advs === false ? undefined : r.adv, old, oldAdv: dst.advs && dst.advs[slot], replaces: had });
    }
    return { items, skipped };
  }
  function applyGlyphs(dst, plan) {
    for (const it of plan.items) {
      dst.glyphs[it.slot] = it.rows.slice();
      if (it.adv !== undefined) { dst.advs = dst.advs || {}; if (it.adv === dst.adv) delete dst.advs[it.slot]; else dst.advs[it.slot] = it.adv; }
    }
    return plan.items.length;
  }
  // vertical metrics, scaled by the row ratio of the two cells (o.scale) and kept inside the target cell
  function planMetrics(CF, src, dst, o = {}) {
    const k = o.scale ? dst.rows / src.rows : 1, cl = (v, hi) => Math.max(0, Math.min(hi, Math.round(v * k))), out = {};
    out.head = cl(src.head, dst.rows - 1); out.xTop = cl(src.xTop, dst.rows - 1); out.base = cl(src.base, dst.rows - 1); out.desc = cl(src.desc, dst.rows);
    out.supUp = cl(src.supUp, 8); out.subDown = cl(src.subDown, 8);
    return out;
  }
  // kerning: lookup(a, b) of the source; pairs whose both glyphs are in `codes` are moved by `offset` and scaled by the advance ratio
  function planKern(get, codes, srcAdv, dstAdv, o = {}) {
    const out = {}, off = o.offset || 0, k = o.scale ? dstAdv / srcAdv : 1;
    for (const a of codes) for (const b of codes) {
      const v = get(a, b); if (!v) continue;
      const ta = a + off, tb = b + off; if (ta < 0 || ta > 255 || tb < 0 || tb > 255) continue;
      const nv = Math.max(-8, Math.min(8, Math.round(v * k))); if (nv) out[ta + ',' + tb] = nv;
    }
    return out;
  }
  const NAMES = { ascii: [32, 126], upper: [65, 90], lower: [97, 122], digits: [48, 57], latin1: [160, 255] };
  return { overlay, diffFonts, kernDiff, kernTable, toCsv, toJson, parseCodes, planGlyphs, applyGlyphs, planMetrics, planKern, convert, present, countPx, advOf, NAMES, METRICS };
});
