// Outline layer: real contours behind the pixel sizes. A glyph is a list of closed contours of points [x, y, kind, smooth] in font units
// (y up): kind 0 = on-curve, 2 = cubic control (always two between on-curve points); smooth = 1 keeps the two handles of an on-curve point
// collinear. TrueType (quadratic) outlines are converted to cubic on load, and back to quadratic on TTF export. Pixel-only fonts get square
// contours (one unit = 1/100 pixel, merged). Edits are kept per family in localStorage ('craft.outline'); the pixel sizes are made from
// the outline with the same rasteriser as TTF import (FE.rasterizeOutline).
(() => {
  'use strict';
  const FE = window.FE, XCW = window.XCW, FP = XCW.FontPipe, SF = FP.Sfnt, CF = XCW.Font, $ = (id) => document.getElementById(id), st = FE.state;
  if (!$('olcv')) return;
  const KAPPA = 0.5522847498, MODELS = new WeakMap(), LS = 'craft.outline';
  let cur = null, cp = 65, tool = 'select', view = { s: 0.3, ox: 20, oy: 300 }, drag = null, drawing = null, undo = [], redo = [], followed = null, hover = null, spaceDown = false;
  const sel = new Set();
  const cv = $('olcv'), cx = cv.getContext('2d');

  // ---- model ----------------------------------------------------------------------------------------------------------------------
  const key = (m) => (st.fam ? st.fam.name : 'font') + (m.font ? '|outline' : '|pixels');
  const store = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
  function normalize(raw) {
    let c = SF.toCubic(raw).map((p) => [p[0], p[1], p[2] === 2 ? 2 : 0, 0]);
    if (c.length > 1 && c[0][2] === 0 && c[c.length - 1][2] === 0 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
    for (let i = 0; i < c.length; i++) {
      const a = c[(i + c.length - 1) % c.length], p = c[i], b = c[(i + 1) % c.length];
      if (p[2] !== 0 || a[2] !== 2 || b[2] !== 2) continue;
      const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1], l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (l > 0 && Math.abs(ux * vy - uy * vx) <= 0.02 * l && ux * vx + uy * vy > 0) p[3] = 1;
    }
    return c;
  }
  function model() {
    const fam = st.fam; if (!fam) return null;
    let m = MODELS.get(fam); if (m) return m;
    let font = null;
    if (st.src && st.src.bytes) { try { font = SF.parse(Uint8Array.from(st.src.bytes)); } catch (e) { font = null; } }
    if (font) {
      const info = FP.sfntInfo(font);
      m = { font, upm: font.upm, asc: font.ascent, desc: font.descent, cap: font.capHeight || Math.round(info.capH), xh: font.xHeight || Math.round(info.xH), glyphs: {}, src: st.src.name || 'font' };
    } else {
      const f = fam.sizes[12] || st.f, U = 100;
      m = { master: f, upm: f.rows * U, asc: (f.base + 1) * U, desc: -(f.rows - f.base - 1) * U, cap: (f.base - f.head + 1) * U, xh: (f.base - f.xTop + 1) * U, glyphs: {}, src: 'pixel master (' + f.gw + 'x' + f.rows + ')' };
    }
    m.edited = new Set(); MODELS.set(fam, m);
    const sv = store()[key(m)];
    if (sv) {
      Object.assign(m, sv.m || {});
      for (const k of Object.keys(sv.g || {})) { m.glyphs[k] = { adv: sv.g[k].adv, contours: sv.g[k].contours }; m.edited.add(+k); }
    }
    return m;
  }
  let cpCode = null;
  function codeOf(u) {
    if (!cpCode) { cpCode = new Map(); for (let c = 0; c < 256; c++) { const ci = FE.charInfo(c); if (ci && ci.ch && !cpCode.has(ci.ch.codePointAt(0))) cpCode.set(ci.ch.codePointAt(0), c); } }
    return cpCode.get(u);
  }
  function load(m, u) {
    if (m.glyphs[u]) return m.glyphs[u];
    let g = null;
    if (m.font) {
      const id = m.font.gidFor(u);
      if (id || u === 32) g = { adv: id ? m.font.advance(id) : Math.round(m.upm / 4), contours: id ? m.font.raw(id).map(normalize).filter((c) => c.length > 2) : [] };
    } else {
      const f = m.master, c = codeOf(u), slot = c == null ? undefined : f.map[c];
      if (slot !== undefined && f.glyphs[slot]) g = { adv: (f.advs[slot] || f.adv) * 100, contours: FP.pixelContours(f, f.glyphs[slot], f.gw, 0).map((q) => q.map((p) => [p[0], p[1], 0, 0])) };
    }
    if (g) m.glyphs[u] = g;
    return g;
  }
  function persist(m) {
    const s = store(), g = {};
    for (const u of m.edited) if (m.glyphs[u]) g[u] = { adv: m.glyphs[u].adv, contours: m.glyphs[u].contours };
    s[key(m)] = { m: { asc: m.asc, desc: m.desc, xh: m.xh, cap: m.cap }, g };
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { /* quota */ }
  }
  const flat = (g) => g.flat || (g.flat = g.contours.map((c) => SF.flattenRaw(c, 12)));
  const bboxOf = (polys) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  };
  const area = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  const depth = (g, i) => { const p = flat(g), s = g.contours[i].find((q) => q[2] === 0) || g.contours[i][0]; let d = 0; for (let j = 0; j < p.length; j++) if (j !== i && inside(p[j], s[0], s[1])) d++; return d; };

  // ---- current glyph and undo -------------------------------------------------------------------------------------------------
  const snap = () => JSON.stringify({ a: cur.adv, c: cur.contours });
  function begin(label) { undo.push({ label, s: snap() }); if (undo.length > 200) undo.shift(); redo = []; }
  function changed() {
    const m = model(); cur.flat = null; m.glyphs[cp] = cur; m.edited.add(cp); persist(m); schedulePreview(); FE.outlineRev = (FE.outlineRev || 0) + 1; draw(); panel();
  }
  function restore(s) { const o = JSON.parse(s); cur.adv = o.a; cur.contours = o.c; cur.flat = null; sel.clear(); const m = model(); m.glyphs[cp] = cur; m.edited.add(cp); persist(m); schedulePreview(); draw(); panel(); }
  function doUndo() { if (!undo.length) return; const u = undo.pop(); redo.push({ label: u.label, s: snap() }); restore(u.s); }
  function doRedo() { if (!redo.length) return; const u = redo.pop(); undo.push({ label: u.label, s: snap() }); restore(u.s); }

  function openGlyph(u) {
    const m = model(); if (!m) return false;
    const g = load(m, u);
    if (!g) { cur = null; cp = u; draw(); panel(); return false; }
    cp = u; cur = g; sel.clear(); undo = []; redo = []; drawing = null; fit(); draw(); panel(); schedulePreview(); return true;
  }

  // ---- view -----------------------------------------------------------------------------------------------------------------------
  const toC = (x, y) => [view.ox + x * view.s, view.oy - y * view.s];
  const toU = (px, py) => [(px - view.ox) / view.s, (view.oy - py) / view.s];
  function size() { const w = Math.max(300, cv.clientWidth | 0), h = Math.max(260, cv.clientHeight | 0); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } }
  function fit() {
    const m = model(); if (!m) return; size();
    const span = m.asc - m.desc + m.upm * 0.5, adv = Math.max(cur ? cur.adv : m.upm / 2, m.upm * 0.3);
    view.s = Math.min(cv.height / span, (cv.width * 0.8) / adv); view.ox = (cv.width - adv * view.s) / 2; view.oy = (m.asc + m.upm * 0.22) * view.s;
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------------
  function trace(ctx, c) {
    const n = c.length; if (!n) return;
    ctx.moveTo(...toC(c[0][0], c[0][1]));
    let i = 1;
    while (i < n) {
      if (c[i][2] === 2 && i + 1 < n) { const e = c[(i + 2) % n]; ctx.bezierCurveTo(...toC(c[i][0], c[i][1]), ...toC(c[i + 1][0], c[i + 1][1]), ...toC(e[0], e[1])); i += 3; } else { ctx.lineTo(...toC(c[i][0], c[i][1])); i++; }
    }
    ctx.closePath();
  }
  const partner = (c, i) => { const n = c.length; return c[(i + n - 1) % n][2] === 0 ? (i + n - 1) % n : (i + 1) % n; };
  function draw() {
    size(); const m = model(), T = FE.themeColors(), W = cv.width, H = cv.height;
    cx.clearRect(0, 0, W, H); cx.fillStyle = T.bg; cx.fillRect(0, 0, W, H);
    if (!m) return;
    const line = (y, col, label) => { const py = view.oy - y * view.s; cx.strokeStyle = col; cx.lineWidth = 1; cx.setLineDash([4, 4]); cx.beginPath(); cx.moveTo(0, py + .5); cx.lineTo(W, py + .5); cx.stroke(); cx.setLineDash([]); cx.fillStyle = col; cx.font = '11px sans-serif'; cx.fillText(label + ' ' + Math.round(y), 4, py - 3); };
    line(m.asc, '#8b93a1', 'ascender'); line(m.cap, '#c77dff', 'cap'); line(m.xh, '#3fa7ff', 'x-height'); line(0, '#4fd37f', 'baseline'); line(m.desc, '#8b93a1', 'descender');
    if (!cur) { cx.fillStyle = T.dim; cx.font = '14px sans-serif'; cx.fillText('No outline for this character in the source. Use the pen or a shape to draw one, or pick another character.', 14, 28); if (!drawing) return; }
    if (cur) {
      const x0 = view.ox, x1 = view.ox + cur.adv * view.s;
      cx.strokeStyle = '#ff9f1c'; cx.setLineDash([2, 3]); cx.beginPath(); cx.moveTo(x0 + .5, 0); cx.lineTo(x0 + .5, H); cx.moveTo(x1 + .5, 0); cx.lineTo(x1 + .5, H); cx.stroke(); cx.setLineDash([]);
      cx.fillStyle = T.ink; cx.globalAlpha = 0.22; cx.beginPath(); for (const c of cur.contours) trace(cx, c); cx.fill('nonzero'); cx.globalAlpha = 1;
      cx.strokeStyle = T.ink; cx.lineWidth = 1.5; cx.beginPath(); for (const c of cur.contours) trace(cx, c); cx.stroke();
      cur.contours.forEach((c, ci) => {
        for (let i = 0; i < c.length; i++) if (c[i][2] === 2) { const q = c[partner(c, i)]; cx.strokeStyle = '#8b93a1'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(...toC(c[i][0], c[i][1])); cx.lineTo(...toC(q[0], q[1])); cx.stroke(); }
        for (let i = 0; i < c.length; i++) {
          const p = c[i], [px, py] = toC(p[0], p[1]), on = sel.has(ci + ':' + i);
          cx.fillStyle = on ? T.acc : T.bg; cx.strokeStyle = p[2] === 2 ? '#3fa7ff' : on ? T.acc : T.ink; cx.lineWidth = 1.5;
          cx.beginPath();
          if (p[2] === 2) cx.arc(px, py, 3.5, 0, 6.3); else if (p[3]) cx.arc(px, py, 4.5, 0, 6.3); else cx.rect(px - 4, py - 4, 8, 8);
          cx.fill(); cx.stroke();
        }
        const a = c[0], b = c[1] || c[0], [ax, ay] = toC(a[0], a[1]), [bx, by] = toC(b[0], b[1]), ang = Math.atan2(by - ay, bx - ax);
        cx.fillStyle = '#ff9f1c'; cx.beginPath(); cx.moveTo(ax + Math.cos(ang) * 14, ay + Math.sin(ang) * 14); cx.lineTo(ax + Math.cos(ang + 2.5) * 8, ay + Math.sin(ang + 2.5) * 8); cx.lineTo(ax + Math.cos(ang - 2.5) * 8, ay + Math.sin(ang - 2.5) * 8); cx.fill();
      });
    }
    if (drawing) {
      cx.strokeStyle = '#ff9f1c'; cx.lineWidth = 1.5; cx.beginPath();
      const c = fromDrawing(drawing, false); if (c.length) { cx.moveTo(...toC(c[0][0], c[0][1])); let i = 1; while (i < c.length) { if (c[i][2] === 2 && i + 1 < c.length) { cx.bezierCurveTo(...toC(c[i][0], c[i][1]), ...toC(c[i + 1][0], c[i + 1][1]), ...toC(c[i + 2][0], c[i + 2][1])); i += 3; } else { cx.lineTo(...toC(c[i][0], c[i][1])); i++; } } }
      cx.stroke();
      for (const p of drawing) { const [px, py] = toC(p.x, p.y); cx.fillStyle = '#ff9f1c'; cx.fillRect(px - 3, py - 3, 6, 6); }
    }
    if (drag && drag.mode === 'band') { cx.strokeStyle = T.acc; cx.setLineDash([3, 3]); cx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); cx.setLineDash([]); }
    if (drag && (drag.mode === 'rect' || drag.mode === 'ellipse')) { const [a, b] = shapeBox(drag); cx.strokeStyle = T.acc; cx.setLineDash([3, 3]); const [sx, sy] = toC(a[0], b[1]), [ex, ey] = toC(b[0], a[1]); if (drag.mode === 'rect') cx.strokeRect(sx, sy, ex - sx, ey - sy); else { cx.beginPath(); cx.ellipse((sx + ex) / 2, (sy + ey) / 2, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2, 0, 0, 6.3); cx.stroke(); } cx.setLineDash([]); }
  }
  function fromDrawing(d, close = true) {
    const out = [], n = d.length;
    for (let i = 0; i < (close ? n : n - 1); i++) {
      const a = d[i], b = d[(i + 1) % n];
      out.push([a.x, a.y, 0, a.ho && a.hi ? 1 : 0]);
      if (a.ho || b.hi) { const c1 = a.ho || [a.x, a.y], c2 = b.hi || [b.x, b.y]; out.push([c1[0], c1[1], 2, 0], [c2[0], c2[1], 2, 0]); }
    }
    if (!close && n) out.push([d[n - 1].x, d[n - 1].y, 0, 0]);
    return out;
  }

  // ---- geometry helpers -------------------------------------------------------------------------------------------------------
  const gridStep = () => Math.max(1, +$('olgrid').value || 1);
  const snapU = (u) => ($('olsnap').checked ? [Math.round(u[0] / gridStep()) * gridStep(), Math.round(u[1] / gridStep()) * gridStep()] : [Math.round(u[0]), Math.round(u[1])]);
  function hit(px, py, r = 8) {
    if (!cur) return null; let best = null, bd = r * r;
    cur.contours.forEach((c, ci) => c.forEach((p, i) => { const [x, y] = toC(p[0], p[1]), d = (x - px) ** 2 + (y - py) ** 2; if (d <= bd) { bd = d; best = ci + ':' + i; } }));
    return best;
  }
  const P = (k) => { const [a, b] = k.split(':').map(Number); return cur.contours[a] && cur.contours[a][b]; };
  function fixRuns(c) {
    const s = c.findIndex((p) => p[2] === 0); if (s < 0) return [];
    const q = c.slice(s).concat(c.slice(0, s)), out = []; let i = 0;
    while (i < q.length) { if (q[i][2] !== 2) { out.push(q[i]); i++; continue; } let j = i; while (j < q.length && q[j][2] === 2) j++; if (j - i === 2) out.push(q[i], q[i + 1]); i = j; }
    return out;
  }
  const onCount = (c) => c.filter((p) => p[2] === 0).length;
  function clean() { cur.contours = cur.contours.map(fixRuns).filter((c) => onCount(c) >= 3); }
  // all points a drag of the on-curve point at c[i] must carry along
  const attached = (c, i) => { const n = c.length, o = []; if (c[i][2] !== 0) return o; if (c[(i + n - 1) % n][2] === 2) o.push((i + n - 1) % n); if (c[(i + 1) % n][2] === 2) o.push((i + 1) % n); return o; };
  function mirrorHandle(c, i) {
    const n = c.length, j = partner(c, i), pj = c[j]; if (!pj[3]) return;
    const other = [(j + 1) % n, (j + n - 1) % n].find((k) => k !== i && c[k][2] === 2);
    if (other === undefined) return;
    const dx = c[i][0] - pj[0], dy = c[i][1] - pj[1], len = Math.hypot(dx, dy) || 1, ol = Math.hypot(c[other][0] - pj[0], c[other][1] - pj[1]);
    c[other][0] = pj[0] - (dx / len) * ol; c[other][1] = pj[1] - (dy / len) * ol;
  }
  function shapeBox(d) {
    let a = d.u0, b = d.u1;
    if (d.shift) { const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(Math.abs(dx), Math.abs(dy)); b = [a[0] + (dx < 0 ? -k : k), a[1] + (dy < 0 ? -k : k)]; }
    return [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
  }
  function rectContour(a, b, hole) {
    const c = [[a[0], a[1], 0, 0], [a[0], b[1], 0, 0], [b[0], b[1], 0, 0], [b[0], a[1], 0, 0]];
    return hole ? c.reverse() : c;
  }
  function ellipseContour(a, b, hole) {
    const cxm = (a[0] + b[0]) / 2, cym = (a[1] + b[1]) / 2, rx = (b[0] - a[0]) / 2, ry = (b[1] - a[1]) / 2, kx = rx * KAPPA, ky = ry * KAPPA, R = Math.round;
    const c = [[a[0], cym, 0, 1], [a[0], cym + ky, 2, 0], [cxm - kx, b[1], 2, 0], [cxm, b[1], 0, 1], [cxm + kx, b[1], 2, 0], [b[0], cym + ky, 2, 0], [b[0], cym, 0, 1], [b[0], cym - ky, 2, 0], [cxm + kx, a[1], 2, 0], [cxm, a[1], 0, 1], [cxm - kx, a[1], 2, 0], [a[0], cym - ky, 2, 0]].map((p) => [R(p[0]), R(p[1]), p[2], p[3]]);
    return hole ? c.reverse() : c;
  }
  // nearest point of the outline to a canvas position: { ci, i (on-point index the segment starts at), t, d }
  function nearSegment(px, py) {
    let best = null;
    cur.contours.forEach((c, ci) => {
      const n = c.length; let i = 0;
      while (i < n) {
        const a = c[i]; let pts, next;
        if (c[(i + 1) % n][2] === 2) { const b1 = c[(i + 1) % n], b2 = c[(i + 2) % n], e = c[(i + 3) % n]; pts = [a, b1, b2, e]; next = i + 3; } else { pts = [a, c[(i + 1) % n]]; next = i + 1; }
        for (let s = 0; s <= 40; s++) {
          const t = s / 40, u = 1 - t;
          const x = pts.length === 4 ? u * u * u * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t * t * t * pts[3][0] : u * pts[0][0] + t * pts[1][0];
          const y = pts.length === 4 ? u * u * u * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t * t * t * pts[3][1] : u * pts[0][1] + t * pts[1][1];
          const [qx, qy] = toC(x, y), d = Math.hypot(qx - px, qy - py);
          if (!best || d < best.d) best = { ci, i, t, d, cubic: pts.length === 4 };
        }
        i = next;
      }
    });
    return best;
  }
  function splitAt(h) {
    const c = cur.contours[h.ci], n = c.length, t = h.t, a = c[h.i], lerp = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (!h.cubic) { const e = c[(h.i + 1) % n], m = lerp(a, e); c.splice(h.i + 1, 0, [Math.round(m[0]), Math.round(m[1]), 0, 0]); return; }
    const b1 = c[(h.i + 1) % n], b2 = c[(h.i + 2) % n], e = c[(h.i + 3) % n];
    const ab = lerp(a, b1), bc = lerp(b1, b2), cd = lerp(b2, e), abc = lerp(ab, bc), bcd = lerp(bc, cd), m = lerp(abc, bcd), R = Math.round;
    const rep = [[R(ab[0]), R(ab[1]), 2, 0], [R(abc[0]), R(abc[1]), 2, 0], [R(m[0]), R(m[1]), 0, 1], [R(bcd[0]), R(bcd[1]), 2, 0], [R(cd[0]), R(cd[1]), 2, 0]];
    if ((h.i + 1) % n === 0) return;
    c.splice(h.i + 1, 2, ...rep);
  }

  // ---- pointer ----------------------------------------------------------------------------------------------------------------
  const evPos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  cv.addEventListener('pointerdown', (e) => {
    const [px, py] = evPos(e), u = snapU(toU(px, py)); cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown) { drag = { mode: 'pan', px, py, ox: view.ox, oy: view.oy }; return; }
    if (tool === 'select') {
      if (!cur) return;
      const k = hit(px, py);
      if (k) {
        if (e.shiftKey) { if (sel.has(k)) sel.delete(k); else sel.add(k); } else if (!sel.has(k)) { sel.clear(); sel.add(k); }
        const moving = new Map();
        for (const kk of sel) { const [ci, i] = kk.split(':').map(Number), c = cur.contours[ci]; moving.set(kk, [c[i][0], c[i][1]]); for (const j of attached(c, i)) if (!sel.has(ci + ':' + j)) moving.set(ci + ':' + j, [c[j][0], c[j][1]]); }
        drag = { mode: 'move', u0: toU(px, py), moving, snap: snap(), moved: false };
      } else { if (!e.shiftKey) sel.clear(); drag = { mode: 'band', x0: px, y0: py, x1: px, y1: py, add: e.shiftKey }; }
      draw(); panel(); return;
    }
    if (tool === 'pen') {
      if (drawing && drawing.length > 2) { const [fx, fy] = toC(drawing[0].x, drawing[0].y); if (Math.hypot(fx - px, fy - py) < 9) { finishPen(); return; } }
      if (!drawing) drawing = [];
      drawing.push({ x: u[0], y: u[1] }); drag = { mode: 'pen', u0: u }; draw(); return;
    }
    if (tool === 'knife') {
      if (!cur) return; const h = nearSegment(px, py);
      if (h && h.d < 12) { begin('Add point'); splitAt(h); changed(); }
      return;
    }
    if (tool === 'rect' || tool === 'ellipse') { drag = { mode: tool, u0: u, u1: u, shift: e.shiftKey, hole: e.altKey || $('olhole').checked }; draw(); }
  });
  cv.addEventListener('pointermove', (e) => {
    const [px, py] = evPos(e), uu = toU(px, py);
    $('olpos').textContent = 'x ' + Math.round(uu[0]) + '  y ' + Math.round(uu[1]);
    if (!drag) { if (tool === 'select') { const k = hit(px, py); if (k !== hover) { hover = k; cv.style.cursor = k ? 'move' : 'default'; } } return; }
    if (drag.mode === 'pan') { view.ox = drag.ox + px - drag.px; view.oy = drag.oy + py - drag.py; draw(); return; }
    if (drag.mode === 'band') { drag.x1 = px; drag.y1 = py; draw(); return; }
    if (drag.mode === 'move') {
      const u = toU(px, py), dx = u[0] - drag.u0[0], dy = u[1] - drag.u0[1];
      if (!drag.moved && Math.hypot(dx, dy) * view.s < 2) return;
      if (!drag.moved) { undo.push({ label: 'Move points', s: drag.snap }); redo = []; drag.moved = true; }
      for (const [k, o] of drag.moving) { const p = P(k), s = snapU([o[0] + dx, o[1] + dy]); p[0] = s[0]; p[1] = s[1]; }
      for (const k of drag.moving.keys()) { const [ci, i] = k.split(':').map(Number), c = cur.contours[ci]; if (c[i][2] === 2) mirrorHandle(c, i); }
      cur.flat = null; draw(); return;
    }
    if (drag.mode === 'pen') { const d = drawing[drawing.length - 1], u = snapU(toU(px, py)); if (Math.hypot(u[0] - drag.u0[0], u[1] - drag.u0[1]) * view.s > 4) { d.ho = u; d.hi = [2 * d.x - u[0], 2 * d.y - u[1]]; } draw(); return; }
    if (drag.mode === 'rect' || drag.mode === 'ellipse') { drag.u1 = snapU(toU(px, py)); drag.shift = e.shiftKey; draw(); }
  });
  cv.addEventListener('pointerup', (e) => {
    if (!drag) return; const d = drag; drag = null;
    if (d.mode === 'band') {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      if (cur) cur.contours.forEach((c, ci) => c.forEach((p, i) => { const [x, y] = toC(p[0], p[1]); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) sel.add(ci + ':' + i); }));
      draw(); panel();
    } else if (d.mode === 'move') { if (d.moved) { cur.flat = null; changed(); } }
    else if (d.mode === 'rect' || d.mode === 'ellipse') {
      const [a, b] = shapeBox(d); if (b[0] - a[0] < 2 || b[1] - a[1] < 2) { draw(); return; }
      if (!cur) cur = { adv: Math.round(model().upm / 2), contours: [] };
      begin('Add ' + d.mode);
      cur.contours.push(d.mode === 'rect' ? rectContour(a, b, d.hole) : ellipseContour(a, b, d.hole)); changed();
    } else if (d.mode === 'pen') draw();
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const [px, py] = evPos(e), u = toU(px, py), f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    view.s = Math.max(0.02, Math.min(8, view.s * f)); view.ox = px - u[0] * view.s; view.oy = py + u[1] * view.s; draw();
  }, { passive: false });
  function finishPen() {
    if (!drawing || drawing.length < 3) { drawing = null; draw(); return; }
    if (!cur) cur = { adv: Math.round(model().upm / 2), contours: [] };
    begin('Pen contour');
    cur.contours.push(fromDrawing(drawing)); drawing = null; changed();
  }

  // ---- operations ---------------------------------------------------------------------------------------------------------------
  const targets = () => { const all = []; cur.contours.forEach((c, ci) => c.forEach((p, i) => all.push(ci + ':' + i))); return sel.size ? [...sel] : all; };
  function edit(label, fn) { if (!cur) return; begin(label); fn(); clean(); changed(); }
  const ops = {
    del() { if (!cur || !sel.size) return; edit('Delete points', () => {
      cur.contours.forEach((c, ci) => {
        const rm = new Set();
        c.forEach((p, i) => { if (!sel.has(ci + ':' + i)) return; rm.add(i); if (p[2] === 0) for (const j of attached(c, i)) rm.add(j); });
        cur.contours[ci] = c.filter((p, i) => !rm.has(i));
      });
      sel.clear();
    }); },
    smooth(on) { edit(on ? 'Smooth points' : 'Corner points', () => { for (const k of sel) { const [ci, i] = k.split(':').map(Number), c = cur.contours[ci], p = c[i]; if (p[2] !== 0) continue; p[3] = on ? 1 : 0; if (on) { const h = attached(c, i); if (h.length === 2) { const a = c[h[0]], b = c[h[1]], dx = p[0] - a[0], dy = p[1] - a[1], l = Math.hypot(dx, dy) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]); b[0] = Math.round(p[0] + (dx / l) * lb); b[1] = Math.round(p[1] + (dy / l) * lb); } } } }); },
    curve() { edit('Line to curve', () => { for (const k of [...sel].sort((a, b) => b.split(':')[1] - a.split(':')[1])) { const [ci, i] = k.split(':').map(Number), c = cur.contours[ci], n = c.length; if (c[i][2] !== 0 || c[(i + 1) % n][2] !== 0) continue; const a = c[i], e = c[(i + 1) % n], R = Math.round; c.splice(i + 1, 0, [R(a[0] + (e[0] - a[0]) / 3), R(a[1] + (e[1] - a[1]) / 3), 2, 0], [R(a[0] + (e[0] - a[0]) * 2 / 3), R(a[1] + (e[1] - a[1]) * 2 / 3), 2, 0]); } }); },
    line() { edit('Curve to line', () => { for (const k of sel) { const [ci, i] = k.split(':').map(Number), c = cur.contours[ci]; for (const j of attached(c, i)) c[j][2] = -1; } cur.contours = cur.contours.map((c) => c.filter((p) => p[2] !== -1)); sel.clear(); }); },
    simplify(tol) {
      let removed = 0;
      edit('Simplify', () => {
        for (const c of cur.contours) {
          let again = true;
          while (again) {
            again = false;
            for (let i = 0; i < c.length && c.length > 3; i++) {
              const n = c.length, a = c[(i + n - 1) % n], p = c[i], b = c[(i + 1) % n];
              if (p[2] !== 0 || a[2] !== 0 || b[2] !== 0) continue;
              const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), d = l ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l : Math.hypot(p[0] - a[0], p[1] - a[1]);
              if (d <= tol) { c.splice(i, 1); removed++; again = true; break; }
            }
          }
        }
        sel.clear();
      });
      return removed;
    },
    round(step) { edit('Round to grid', () => { for (const k of targets()) { const p = P(k); p[0] = Math.round(p[0] / step) * step; p[1] = Math.round(p[1] / step) * step; } }); },
    reverse() { edit('Reverse direction', () => { const ids = new Set(targets().map((k) => +k.split(':')[0])); cur.contours = cur.contours.map((c, i) => (ids.has(i) ? c.slice().reverse() : c)); sel.clear(); }); },
    fixdir() { edit('Fix directions', () => { cur.flat = null; cur.contours = cur.contours.map((c, i) => { const want = depth(cur, i) % 2 === 0 ? -1 : 1, have = Math.sign(area(flat(cur)[i])); return have && have !== want ? c.slice().reverse() : c; }); sel.clear(); }); },
    flip(h) { edit(h ? 'Flip horizontal' : 'Flip vertical', () => { const b = bboxOf(flat(cur)); if (!b) return; const ids = new Set(targets().map((k) => +k.split(':')[0])); cur.contours = cur.contours.map((c, i) => { if (!ids.has(i)) return c; const r = c.map((p) => (h ? [cur.adv - p[0] , p[1], p[2], p[3]] : [p[0], b.y0 + b.y1 - p[1], p[2], p[3]])); return r.reverse(); }); sel.clear(); }); },
    nudge(dx, dy) { edit('Nudge', () => { for (const k of targets()) { const p = P(k); p[0] += dx; p[1] += dy; } }); },
    selectAll() { sel.clear(); if (cur) cur.contours.forEach((c, ci) => c.forEach((p, i) => sel.add(ci + ':' + i))); draw(); panel(); },
    revert() { const m = model(); delete m.glyphs[cp]; m.edited.delete(cp); persist(m); openGlyph(cp); },
  };
  // metrics of the glyph: lsb moves the outline, rsb changes the advance
  function setMetric(what, v) {
    if (!cur) return; const b = bboxOf(flat(cur)); if (!b || !isFinite(v)) return;
    begin('Set ' + what);
    if (what === 'adv') cur.adv = Math.max(0, Math.round(v));
    else if (what === 'lsb') { const d = Math.round(v - b.x0); for (const c of cur.contours) for (const p of c) p[0] += d; cur.adv += d; }
    else if (what === 'rsb') cur.adv = Math.round(b.x1 + v);
    changed();
  }
  function setLine(what, v) { const m = model(); if (!m || !isFinite(v)) return; m[what] = Math.round(v); persist(m); draw(); panel(); }

  // ---- panel ----------------------------------------------------------------------------------------------------------------------
  function panel() {
    const m = model(); if (!m) return;
    const ci = cp >= 32 ? String.fromCodePoint(cp) : '';
    $('olglyph').textContent = (ci || '?') + '  U+' + cp.toString(16).toUpperCase().padStart(4, '0') + (m.edited.has(cp) ? '  (edited)' : '');
    $('olsrc').textContent = 'Source: ' + m.src + ' - ' + m.upm + ' units per em';
    const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    set('olasc', m.asc); set('oldesc', m.desc); set('olxh', m.xh); set('olcap', m.cap);
    const b = cur && bboxOf(flat(cur));
    set('oladv', cur ? Math.round(cur.adv) : ''); set('ollsb', b ? Math.round(b.x0) : ''); set('olrsb', b ? Math.round(cur.adv - b.x1) : '');
    $('olbbox').textContent = b ? 'bbox ' + Math.round(b.x0) + ',' + Math.round(b.y0) + ' - ' + Math.round(b.x1) + ',' + Math.round(b.y1) : 'empty glyph';
    const list = $('olcont'); list.textContent = '';
    if (cur) cur.contours.forEach((c, i) => {
      const a = area(flat(cur)[i]), d = depth(cur, i), row = document.createElement('div'); row.className = 'olrow';
      row.textContent = '#' + (i + 1) + (d % 2 ? ' hole' : ' outer') + ', ' + (a < 0 ? 'clockwise' : 'counter-clockwise') + ((a < 0) === (d % 2 === 0) ? '' : ' (wrong: use Fix directions)') + ', ' + onCount(c) + ' on / ' + (c.length - onCount(c)) + ' off';
      row.onclick = () => { sel.clear(); c.forEach((p, k) => sel.add(i + ':' + k)); draw(); }; list.appendChild(row);
    });
    const lg = $('ollog'); lg.textContent = undo.slice(-8).reverse().map((u) => u.label).join(' < ') || 'no edits yet';
    $('olstat').textContent = (sel.size ? sel.size + ' selected - ' : '') + 'tool: ' + tool + (tool === 'pen' ? ' (click = corner, drag = smooth, click the first point or Enter to close)' : tool === 'knife' ? ' (click a segment to add a point)' : '');
    document.querySelectorAll('.oltool').forEach((b2) => b2.classList.toggle('on', b2.dataset.otool === tool));
  }

  // ---- pixel preview + rasterise ------------------------------------------------------------------------------------------------
  function shim(m) {
    const g = (u) => load(m, u);
    return {
      kind: 'outline', upm: m.upm, ascent: m.asc, descent: m.desc, capHeight: m.cap, xHeight: m.xh, family: st.fam.name, numGlyphs: 0,
      gid: (u) => (g(u) ? u : 0), gidFor: (u) => (g(u) ? u : 0), advance: (u) => g(u).adv, outline: (u) => flat(g(u)), bbox: (u) => bboxOf(flat(g(u))),
    };
  }
  FE.outlineShim = () => { const m = model(); return m ? shim(m) : null; };
  let pvT = 0;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(preview, 120); }
  function preview() {
    const m = model(), c = $('olpv'); if (!m || !c || !cur || cp < 32 || cp > 126) { if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
    const sizes = [6, 12], X = c.getContext('2d'), T = FE.themeColors(); X.clearRect(0, 0, c.width, c.height); X.fillStyle = T.bg; X.fillRect(0, 0, c.width, c.height);
    let x = 4;
    for (const k of sizes) {
      let f; try { f = FP.rasterFont(shim(m), k, FE.rasterOpts()); } catch (e) { continue; }
      const rows = f.glyphs[cp] || [], z = k === 6 ? 8 : 5;
      X.fillStyle = T.ink;
      for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, rows[r], q)) X.fillRect(x + q * z, 4 + r * z, z, z);
      X.fillStyle = T.dim; X.font = '10px sans-serif'; X.fillText(k + ' px', x, c.height - 4); x += f.gw * z + 12;
    }
  }
  FE.rasterOpts = () => { const h = FE.hintOpts(); return { threshold: h.threshold, weight: h.weight || 0, hint: !!h.snapX }; };
  // Rasterises outline glyphs into the pixel sizes. o: { all: every existing size, glyphs: 'all' (ASCII) | one, overwrite: also overrides + locked sizes }
  FE.rasterizeOutline = (o = {}) => {
    const m = model(), fam = st.fam; if (!m) return { sizes: 0, glyphs: 0 };
    const codes = o.glyphs === 'all' ? Array.from({ length: 95 }, (_, i) => 32 + i) : [cp];
    const keys = o.all ? Object.keys(fam.sizes).map(Number) : Object.keys(fam.sizes).map(Number).filter((k) => fam.sizes[k] === st.f);
    const res = { sizes: 0, glyphs: 0, kept: 0 }, sh = shim(m);
    for (const k of keys) {
      const f = fam.sizes[k]; if (!CF.SIZES[k]) continue;
      if (f.locked && o.all && !o.overwrite) continue;
      const nf = FP.rasterFont(sh, k, Object.assign(FE.rasterOpts(), { name: fam.name })), ov = FE.ovrOf ? FE.ovrOf(f) : {}, slots = [];
      for (const a of codes) { const slot = f.map[a]; if (slot === undefined || !nf.glyphs[a]) continue; if (ov[slot] && !o.overwrite) { res.kept++; continue; } slots.push([a, slot]); }
      if (!slots.length) continue;
      if (f === st.f && (FE.pushRaw || FE.push)) (FE.pushRaw || FE.push)('Rasterize outline', slots.map((s) => s[1]));
      for (const [a, slot] of slots) { f.glyphs[slot] = nf.glyphs[a].slice(); if (nf.advs[a] !== undefined) f.advs[slot] = nf.advs[a]; else delete f.advs[slot]; if (ov[slot]) delete ov[slot]; }
      res.sizes++; res.glyphs += slots.length;
    }
    FE.a8cache = null; if (FE.changed) FE.changed(); if (FE.emitFont) FE.emitFont(); FE.render();
    return res;
  };

  // ---- export TTF / OTF / WOFF from the outline -----------------------------------------------------------------------------------
  function codesFor(m, set) {
    const out = [];
    if (set === 'all') { if (m.font) { for (let u = 32; u < 0xffff; u++) if (u < 0xd800 || u > 0xdfff) if (m.font.gid(u)) out.push(u); } else for (let c = 0; c < 256; c++) { const ci = FE.charInfo(c); if (ci && ci.ch && c >= 32 && m.master.glyphs[m.master.map[c]]) out.push(ci.ch.codePointAt(0)); } }
    else { for (let u = 32; u < 127; u++) out.push(u); if (set === 'latin1') for (let u = 160; u < 256; u++) out.push(u); }
    for (const u of m.edited) if (!out.includes(u)) out.push(u);
    return [...new Set(out)].sort((a, b) => a - b);
  }
  FE.outlineExport = (fmt, set) => {
    const m = model(); if (!m) throw new Error('no font');
    const u = m.upm, glyphs = [{ unicode: [], adv: Math.round(u / 2), contours: [[[Math.round(u * 0.08), 0, 0], [Math.round(u * 0.08), Math.round(u * 0.7), 0], [Math.round(u * 0.42), Math.round(u * 0.7), 0], [Math.round(u * 0.42), 0, 0]], [[Math.round(u * 0.14), Math.round(u * 0.06), 0], [Math.round(u * 0.36), Math.round(u * 0.06), 0], [Math.round(u * 0.36), Math.round(u * 0.64), 0], [Math.round(u * 0.14), Math.round(u * 0.64), 0]]] }];
    for (const c of codesFor(m, set || 'ascii')) { const g = load(m, c); if (g) glyphs.push({ unicode: [c], adv: Math.round(g.adv), contours: g.contours.map((q) => q.map((p) => [p[0], p[1], p[2]])) }); }
    const bytes = SF.build({ name: (st.fam.name || 'Font').slice(0, 40), upm: m.upm, ascent: m.asc, descent: m.desc, capHeight: m.cap, xHeight: m.xh, glyphs, otf: fmt === 'otf' });
    return fmt === 'woff' ? SF.woff(bytes) : bytes;
  };

  // ---- wiring ---------------------------------------------------------------------------------------------------------------------
  function setTool(t) { tool = t; if (t !== 'pen' && drawing) { drawing = null; } draw(); panel(); }
  document.querySelectorAll('.oltool').forEach((b) => { b.onclick = () => setTool(b.dataset.otool); });
  const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  bind('olsmooth', () => ops.smooth(true)); bind('olcorner', () => ops.smooth(false)); bind('olcurve', ops.curve); bind('olline', ops.line); bind('oldel', ops.del);
  bind('olsimp', () => { const n = ops.simplify(+$('olsimptol').value || 2); FE.toast('Simplify removed ' + n + ' point' + (n === 1 ? '' : 's')); });
  bind('olround', () => ops.round(gridStep())); bind('olrev', ops.reverse); bind('olfix', ops.fixdir); bind('olfh', () => ops.flip(true)); bind('olfv', () => ops.flip(false));
  bind('olundo', doUndo); bind('olredo', doRedo); bind('olfit', () => { fit(); draw(); }); bind('olrevert', ops.revert);
  bind('olsel', ops.selectAll);
  bind('olraster', () => { const r = FE.rasterizeOutline({ all: $('olsz').value === 'all', glyphs: $('olgl').value, overwrite: $('olovw').checked }); $('olrinfo').textContent = r.glyphs + ' glyph(s) in ' + r.sizes + ' size(s) rasterized' + (r.kept ? ', ' + r.kept + ' override(s) kept' : '') + '.'; });
  for (const f of ['ttf', 'otf', 'woff']) bind('olx' + f, () => { try { const b = FE.outlineExport(f, $('olset').value); FE.download((st.fam.name || 'font').replace(/[^\w.-]+/g, '_') + '.' + f, b, 'application/octet-stream'); FE.toast(f.toUpperCase() + ' written (' + b.length + ' bytes)'); } catch (e) { FE.toast('Export failed: ' + e.message); } });
  for (const [id, w] of [['oladv', 'adv'], ['ollsb', 'lsb'], ['olrsb', 'rsb']]) $(id).onchange = () => setMetric(w, +$(id).value);
  for (const [id, w] of [['olasc', 'asc'], ['oldesc', 'desc'], ['olxh', 'xh'], ['olcap', 'cap']]) $(id).onchange = () => setLine(w, +$(id).value);
  $('olchar').onchange = () => { const v = $('olchar').value; if (!v) return; const u = /^u\+/i.test(v) ? parseInt(v.slice(2), 16) : v.codePointAt(0); if (!openGlyph(u)) FE.toast('That character is not in the source: draw it with the pen or shapes'); followed = FE.cur(); };
  window.addEventListener('keydown', (e) => {
    if (!FE.isTab('outline')) return;
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey; let done = true;
    if (ctrl && k.toLowerCase() === 'z') (e.shiftKey ? doRedo : doUndo)();
    else if (ctrl && k.toLowerCase() === 'y') doRedo();
    else if (ctrl && k.toLowerCase() === 'a') ops.selectAll();
    else if (ctrl) done = false;
    else if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; }
    else if (k === 'Delete' || k === 'Backspace') ops.del();
    else if (k === 'Enter') finishPen();
    else if (k === 'Escape') { drawing = null; sel.clear(); draw(); panel(); }
    else if (k.startsWith('Arrow')) { const s = e.shiftKey ? 10 : 1; ops.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? s : k === 'ArrowDown' ? -s : 0); }
    else if ({ v: 'select', p: 'pen', k: 'knife', r: 'rect', o: 'ellipse' }[k.toLowerCase()]) setTool({ v: 'select', p: 'pen', k: 'knife', r: 'rect', o: 'ellipse' }[k.toLowerCase()]);
    else if (k.toLowerCase() === 's') ops.smooth(!e.shiftKey);
    else if (k.toLowerCase() === 'f') { fit(); draw(); }
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; cv.style.cursor = 'default'; } });
  FE.key('P / K / R / O / V (Outline tab)', 'Outline tools: pen, knife, rectangle, ellipse, select', () => {}, 'Outline');
  FE.key('S / Shift+S (Outline tab)', 'Outline: make selected points smooth / corner', () => {}, 'Outline');
  FE.key('Enter / Esc (Outline tab)', 'Outline: close the pen contour / cancel', () => {}, 'Outline');
  FE.onTab('outline', () => { followed = null; setTimeout(() => { FE.render(); }, 0); });
  FE.renders.push(() => {
    if (!FE.isTab('outline') || !st.fam) return;
    const m = model(), now = FE.cur() + '|' + st.fam.name;
    if (now !== followed && m) { followed = now; const ch = FE.charInfo(FE.cur()); const u = ch && ch.ch ? ch.ch.codePointAt(0) : null; if (u) openGlyph(u); else { cur = null; draw(); panel(); } }
    else { draw(); panel(); }
  });
  FE.ol = { model, open: openGlyph, load: (u) => { const m = model(); return load(m, u); }, glyph: () => cur, cp: () => cp, ops, sel, setTool, setMetric, view, toC, toU, begin, changed, undo: doUndo, redo: doRedo, normalize };
})();
