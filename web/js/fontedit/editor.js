// Pixel editor: tools (pencil, eraser, line, rect, ellipse, fill, select/move), transforms, batch operations on the selected glyphs,
// onion skin of the neighbouring size, ghost of a reference font (live outline), pixel grid, zoom, draggable guide lines,
// per-glyph advance / bearings, metrics, history list and the real-line-spacing preview.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, $ = FE.$, st = FE.state, COL = FE.COL;
  const ed = $('edit'), ex = ed.getContext('2d'), rl = $('ruler'), rx = rl.getContext('2d'), pv = $('preview'), px = pv.getContext('2d');
  Object.assign(st, { tool: 'pen', zoom: 0, showGrid: true, onion: 'off', ghost: { on: false, op: 0.5, scale: 100, dx: 0, dy: 0, face: null, name: '' }, region: null, pending: null });
  const NC = (slot) => FE.NC(slot);
  const getPx = (g, q, y) => CF.hasPx(st.f, g[y], q);
  const setPx = (g, q, y, v) => { const bit = CF.bitMask(st.f, q); g[y] = v ? (g[y] | bit) >>> 0 : (g[y] & ~bit) >>> 0; };
  const colMask = (nc) => { let m = 0; for (let q = 0; q < nc; q++) m = (m | CF.bitMask(st.f, q)) >>> 0; return m; };

  // ---- geometry --------------------------------------------------------------------------------------------------------
  function fitES() {
    const w = $('escroll').clientWidth - 24, h = $('escroll').clientHeight - 24;
    if (w < 80 || h < 80) return 24;
    return Math.max(4, Math.min(48, Math.floor(Math.min(w / NC(), h / st.f.rows))));
  }
  const ES = () => st.zoom || fitES();
  const guides = () => { const f = st.f; return [{ k: 'head', row: f.head, label: 'cap/ascender', col: COL.cap }, { k: 'xTop', row: f.xTop, label: 'x-height', col: COL.xh }, { k: 'base', row: f.base + 1, label: 'baseline', col: COL.base }]; };

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  function neighbourSize() {
    if (st.onion === 'off' || !st.fam) return null;
    const sizes = Object.keys(st.fam.sizes).map(Number).sort((a, b) => a - b), i = sizes.indexOf(st.f.adv);
    const j = st.onion === 'smaller' ? i - 1 : i + 1;
    return sizes[j] !== undefined ? st.fam.sizes[sizes[j]] : null;
  }
  function drawEdit() {
    const f = st.f; if (!f || !FE.isTab('edit')) return;
    const C = FE.themeColors(), nc = NC(), E = ES(), g = FE.rows(st.slot, st.tgt, false);
    if (ed.width !== nc * E || ed.height !== f.rows * E) { ed.width = nc * E; ed.height = f.rows * E; }
    ex.fillStyle = C.bg; ex.fillRect(0, 0, ed.width, ed.height);
    ex.fillStyle = COL.head + '33'; ex.fillRect(0, 0, ed.width, f.head * E);
    ex.fillStyle = COL.desc + '33'; ex.fillRect(0, (f.base + 1) * E, ed.width, (f.rows - f.base - 1) * E);
    if (st.ghost.on && st.ghost.face) drawGhost(E);
    const nb = neighbourSize();
    if (nb) {
      const ng = nb.glyphs[nb.map[FE.cur()]] || [], sx = f.adv / nb.adv, sy = f.rows / nb.rows;
      ex.fillStyle = '#4aa8ff66';
      for (let r = 0; r < nb.rows; r++) if (ng[r]) for (let q = 0; q < CF.colsOf(nb, nb.map[FE.cur()]); q++) if (CF.hasPx(nb, ng[r], q)) ex.fillRect(q * sx * E, r * sy * E, Math.max(1, sx * E), Math.max(1, sy * E));
    }
    ex.fillStyle = C.ink;
    for (let r = 0; r < f.rows; r++) for (let q = 0; q < nc; q++) if (CF.hasPx(f, g[r], q)) ex.fillRect(q * E, r * E, E, E);
    if (FE.drawDiff) FE.drawDiff(ex, E, nc);
    if (st.showGrid && E >= 6) {
      ex.strokeStyle = C.grid; ex.lineWidth = 1; ex.beginPath();
      for (let q = 0; q <= nc; q++) { ex.moveTo(q * E + .5, 0); ex.lineTo(q * E + .5, ed.height); }
      for (let r = 0; r <= f.rows; r++) { ex.moveTo(0, r * E + .5); ex.lineTo(ed.width, r * E + .5); }
      ex.stroke();
    }
    // advance edge (where the next glyph starts) when the glyph is narrower than the cell
    const adv = f.advs[st.slot] || f.adv;
    if (adv < nc) { ex.fillStyle = '#ff555555'; ex.fillRect(adv * E, 0, (nc - adv) * E, ed.height); }
    for (const gd of guides()) { ex.fillStyle = gd.col; ex.fillRect(0, gd.row * E - 1, ed.width, 2); }
    if (st.pending) { ex.fillStyle = C.acc + '99'; for (const [q, y] of st.pending.cells) if (q >= 0 && y >= 0 && q < nc && y < f.rows) ex.fillRect(q * E + 1, y * E + 1, E - 2, E - 2); }
    if (st.region) { const r = st.region; ex.strokeStyle = C.acc; ex.lineWidth = 2; ex.setLineDash([5, 4]); ex.strokeRect(r.x0 * E + 1, r.y0 * E + 1, (r.x1 - r.x0 + 1) * E - 2, (r.y1 - r.y0 + 1) * E - 2); ex.setLineDash([]); }
    drawRuler(E);
    const c = FE.cur(), ci = FE.charInfo(c);
    $('gname').textContent = ci.name + ' - code ' + c + ', slot ' + st.slot + (st.tgt ? (st.tgt === 1 ? ' (super)' : ' (sub)') : '') + ', U+' + ci.uni.toString(16).toUpperCase().padStart(4, '0');
    $('codeinfo').textContent = c; $('codeslot').value = f.map[c];
  }
  function drawRuler(E) {
    const C = FE.themeColors(), f = st.f;
    rl.width = 64; rl.height = f.rows * E;
    rx.fillStyle = C.paper; rx.fillRect(0, 0, 64, rl.height); rx.font = '11px system-ui,sans-serif'; rx.textBaseline = 'middle';
    rx.fillStyle = C.dim; rx.fillRect(63, 0, 1, rl.height);
    for (let r = 0; r < f.rows; r += (E < 10 ? 2 : 1)) { rx.fillStyle = C.dim; rx.textAlign = 'right'; rx.fillText(String(r), 60, r * E + E / 2); }
    rx.textAlign = 'left';
    for (const gd of guides()) {
      const y = gd.row * E, on = st.gdrag === gd.k;
      rx.fillStyle = gd.col; rx.beginPath(); rx.moveTo(0, y - 6); rx.lineTo(10, y); rx.lineTo(0, y + 6); rx.fill();
      rx.fillRect(0, y - (on ? 1.5 : .5), 64, on ? 3 : 1.5);
      rx.fillText(gd.label, 12, y - 8 < 6 ? y + 8 : y - 8);
    }
  }
  function drawGhost(E) {
    const f = st.f, G = st.ghost, ci = FE.charInfo(FE.cur());
    if (!ci.ch || ci.code < 32) return;
    const capRows = f.base + 1 - f.head, size = (capRows * E * G.scale / 100) / G.cap;
    ex.save(); ex.font = size + 'px "' + G.face + '"'; ex.textBaseline = 'alphabetic';
    ex.globalAlpha = G.op; ex.fillStyle = FE.themeColors().pink; ex.fillText(ci.ch, (0.5 + G.dx) * E, (f.base + 1 + G.dy) * E);
    ex.globalAlpha = Math.min(1, G.op + .3); ex.strokeStyle = FE.themeColors().pink; ex.lineWidth = 1; ex.strokeText(ci.ch, (0.5 + G.dx) * E, (f.base + 1 + G.dy) * E);
    ex.restore();
  }
  FE.renders.push(drawEdit);
  FE.onTab('edit', () => { setTimeout(FE.render, 0); });

  // reference font behind the pixels: any TTF/OTF/WOFF the browser can load
  let refN = 0;
  FE.setRef = async (bytes, name) => {
    try {
      const fam = 'feref' + (++refN), face = new FontFace(fam, Uint8Array.from(bytes).buffer);
      await face.load(); document.fonts.add(face);
      const c = document.createElement('canvas').getContext('2d'); c.font = '200px "' + fam + '"';
      const m = c.measureText('H'), cap = (m.actualBoundingBoxAscent || 140) / 200;
      Object.assign(st.ghost, { face: fam, cap, name, on: true }); $('gshow').checked = true; $('gname2').textContent = name; FE.render(); return true;
    } catch (e) { FE.toast('Reference font not usable: ' + e.message); return false; }
  };

  // ---- mouse ------------------------------------------------------------------------------------------------------------------
  const cellAt = (e, clamp) => {
    const r = ed.getBoundingClientRect(), nc = NC(), f = st.f;
    let q = Math.floor(((e.clientX - r.left) / r.width) * nc), y = Math.floor(((e.clientY - r.top) / r.height) * f.rows);
    if (clamp) { q = Math.max(0, Math.min(nc - 1, q)); y = Math.max(0, Math.min(f.rows - 1, y)); }
    return q < 0 || y < 0 || q >= nc || y >= f.rows ? null : [q, y];
  };
  const lineCells = (a, b) => {
    const out = []; let [x0, y0] = a; const [x1, y1] = b, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    return out;
  };
  const box = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const rectCells = (a, b, fill) => {
    const [x0, y0, x1, y1] = box(a, b), out = [];
    for (let y = y0; y <= y1; y++) for (let q = x0; q <= x1; q++) if (fill || y === y0 || y === y1 || q === x0 || q === x1) out.push([q, y]);
    return out;
  };
  const ellipseCells = (a, b, fill) => {
    const [x0, y0, x1, y1] = box(a, b), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx2 = (x1 - x0) / 2 + 0.5, ry2 = (y1 - y0) / 2 + 0.5, inside = new Set(), out = [];
    for (let y = y0; y <= y1; y++) for (let q = x0; q <= x1; q++) if (((q - cx) / rx2) ** 2 + ((y - cy) / ry2) ** 2 <= 1) inside.add(y * 64 + q);
    for (const k of inside) {
      const y = Math.floor(k / 64), q = k % 64;
      if (fill || ![[q + 1, y], [q - 1, y], [q, y + 1], [q, y - 1]].every(([a1, b1]) => inside.has(b1 * 64 + a1))) out.push([q, y]);
    }
    return out;
  };
  const constrain = (a, b, shape) => {
    if (!st.shift) return b;
    if (shape === 'line') { const dx = b[0] - a[0], dy = b[1] - a[1]; if (Math.abs(dx) > 2 * Math.abs(dy)) return [b[0], a[1]]; if (Math.abs(dy) > 2 * Math.abs(dx)) return [a[0], b[1]]; const m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + Math.sign(dx) * m, a[1] + Math.sign(dy) * m]; }
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + (dx < 0 ? -m : m), a[1] + (dy < 0 ? -m : m)];
  };
  const shapeCells = (tool, a, b) => (tool === 'line' ? lineCells(a, b) : tool === 'rect' ? rectCells(a, b, $('rectfill').checked) : ellipseCells(a, b, $('rectfill').checked));
  function floodFill(g, a, val) {
    const nc = NC(), from = getPx(g, a[0], a[1]), seen = new Set(), stack = [a];
    if (from === !!val) return;
    while (stack.length) {
      const [q, y] = stack.pop(), k = y * 64 + q;
      if (q < 0 || y < 0 || q >= nc || y >= st.f.rows || seen.has(k) || getPx(g, q, y) !== from) continue;
      seen.add(k); setPx(g, q, y, val); stack.push([q + 1, y], [q - 1, y], [q, y + 1], [q, y - 1]);
    }
  }
  const inRegion = (c) => st.region && c[0] >= st.region.x0 && c[0] <= st.region.x1 && c[1] >= st.region.y0 && c[1] <= st.region.y1;
  const quick = () => { drawEdit(); FE.renders[0](); };

  ed.addEventListener('mousedown', (e) => {
    e.preventDefault(); st.shift = e.shiftKey;
    const c = cellAt(e); if (!c) return;
    const val = e.button === 2 || st.tool === 'eraser' ? 0 : 1, g = FE.rows(st.slot, st.tgt, true);
    st.val = val; st.start = c; st.down = 1;
    if (st.tool === 'select') {
      if (inRegion(c)) {
        FE.push('Move selection', [st.slot]);
        const r = st.region, base = g.slice(), flo = [];
        for (let y = r.y0; y <= r.y1; y++) for (let q = r.x0; q <= r.x1; q++) if (getPx(g, q, y)) { flo.push([q, y]); setPx(base, q, y, 0); }
        st.move = { base, flo, r0: Object.assign({}, r) };
      } else { st.region = { x0: c[0], y0: c[1], x1: c[0], y1: c[1] }; st.sel2 = true; }
      drawEdit(); return;
    }
    if (st.tool === 'fill') { FE.push('Fill', [st.slot]); floodFill(g, c, val); CF.markEdited(st.f); FE.changed(); st.down = 0; return; }
    if (st.tool === 'pen' || st.tool === 'eraser') {
      FE.push(val ? 'Draw' : 'Erase', [st.slot]);
      if (e.button !== 2 && st.tool === 'pen') st.val = getPx(g, c[0], c[1]) ? 0 : 1; // first click decides draw / erase for the drag
      setPx(g, c[0], c[1], st.val); CF.markEdited(st.f); st.last = c; quick(); return;
    }
    st.pending = { cells: [c] }; drawEdit();
  });
  window.addEventListener('mousemove', (e) => {
    const c = cellAt(e, !!st.down);
    if (c) $('estat').textContent = 'col ' + c[0] + ', row ' + c[1] + (st.f.rows ? '  (' + (c[1] < st.f.head ? 'headroom' : c[1] <= st.f.base ? (c[1] >= st.f.xTop ? 'x-height zone' : 'cap zone') : 'descender') + ')' : '');
    if (!st.down || !c) return;
    st.shift = e.shiftKey;
    const g = FE.rows(st.slot, st.tgt, true);
    if (st.tool === 'pen' || st.tool === 'eraser') { for (const [q, y] of lineCells(st.last, c)) setPx(g, q, y, st.val); st.last = c; quick(); }
    else if (st.tool === 'select') {
      if (st.move) {
        const dx = c[0] - st.start[0], dy = c[1] - st.start[1], r0 = st.move.r0, nc = NC(), rows = st.move.base.slice();
        for (const [q, y] of st.move.flo) { const nq = q + dx, ny = y + dy; if (nq >= 0 && nq < nc && ny >= 0 && ny < st.f.rows) setPx(rows, nq, ny, 1); }
        for (let i = 0; i < g.length; i++) g[i] = rows[i];
        st.region = { x0: r0.x0 + dx, x1: r0.x1 + dx, y0: r0.y0 + dy, y1: r0.y1 + dy }; quick();
      } else if (st.sel2) { const [x0, y0, x1, y1] = box(st.start, c); st.region = { x0, y0, x1, y1 }; drawEdit(); }
    } else if (st.pending) { const b = constrain(st.start, c, st.tool); st.pending.cells = shapeCells(st.tool, st.start, b); drawEdit(); }
  });
  window.addEventListener('mouseup', (e) => {
    if (!st.down) return; st.down = 0;
    const g = FE.rows(st.slot, st.tgt, true);
    if (st.pending) {
      const c = cellAt(e, true), b = constrain(st.start, c, st.tool);
      FE.push(st.tool === 'line' ? 'Line' : st.tool === 'rect' ? 'Rectangle' : 'Ellipse', [st.slot]);
      // push() has just recorded the state before the shape because nothing was drawn while previewing
      for (const [q, y] of shapeCells(st.tool, st.start, b)) if (q >= 0 && y >= 0 && q < NC() && y < st.f.rows) setPx(g, q, y, st.val);
      st.pending = null; CF.markEdited(st.f);
    }
    st.move = null; st.sel2 = false;
    FE.changed();
  });
  ed.addEventListener('contextmenu', (e) => e.preventDefault());
  ed.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(ES() + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
  FE.clearRegion = () => { st.region = null; drawEdit(); };

  // guide lines: drag the handles in the ruler
  rl.addEventListener('mousedown', (e) => {
    const r = rl.getBoundingClientRect(), y = (e.clientY - r.top) * rl.height / r.height, E = ES();
    const hit = guides().filter((gd) => Math.abs(gd.row * E - y) <= 9).sort((a, b) => Math.abs(a.row * E - y) - Math.abs(b.row * E - y))[0];
    if (!hit) return;
    FE.push('Move ' + hit.label + ' line', [], true); st.gdrag = hit.k; e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!st.gdrag) return;
    const r = rl.getBoundingClientRect(), f = st.f, row = Math.round(((e.clientY - r.top) * rl.height / r.height) / ES());
    if (st.gdrag === 'head') f.head = Math.max(0, Math.min(f.xTop, row));
    else if (st.gdrag === 'xTop') f.xTop = Math.max(f.head, Math.min(f.base, row));
    else { f.base = Math.max(f.xTop, Math.min(f.rows - 1, row - 1)); f.desc = f.rows - f.base - 1; }
    drawEdit(); FE.hooks.forEach((h) => h());
  });
  window.addEventListener('mouseup', () => { if (st.gdrag) { st.gdrag = null; CF.markEdited(st.f); FE.changed(); } });

  // ---- zoom, grid, onion, ghost controls ---------------------------------------------------------------------------------------
  function setZoom(z) { st.zoom = Math.max(4, Math.min(64, z)); $('zoom').value = st.zoom; FE.render(); }
  document.addEventListener('DOMContentLoaded', () => {
    $('zoom').oninput = () => setZoom(+$('zoom').value);
    $('zfit').onclick = () => { st.zoom = 0; $('zoom').value = fitES(); FE.render(); };
    $('pgrid').onchange = () => { st.showGrid = $('pgrid').checked; FE.render(); };
    $('onion').onchange = () => { st.onion = $('onion').value; FE.render(); };
    $('gshow').onchange = () => { st.ghost.on = $('gshow').checked && !!st.ghost.face; if ($('gshow').checked && !st.ghost.face) $('gfile').click(); FE.render(); };
    $('gfile').onchange = async () => { const f = $('gfile').files[0]; if (f) await FE.setRef(new Uint8Array(await f.arrayBuffer()), f.name); $('gfile').value = ''; };
    for (const [id, k, div] of [['gopac', 'op', 100], ['gscale', 'scale', 1], ['gdx', 'dx', 10], ['gdy', 'dy', 10]]) $(id).oninput = () => { st.ghost[k] = +$(id).value / div; FE.render(); };
    $('gsrc').onclick = () => { if (st.src && st.src.bytes) FE.setRef(st.src.bytes, st.src.name); else $('gfile').click(); };
    document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
    document.querySelectorAll('.tgt').forEach((b) => { b.onclick = () => { st.tgt = +b.dataset.t; document.querySelectorAll('.tgt').forEach((x) => x.classList.toggle('on', x === b)); FE.render(); }; });
    $('vclear').onclick = () => { const c = FE.cur(); delete st.f.sup[c]; delete st.f.sub[c]; FE.changed(); FE.toast('Variants for code ' + c + ' removed; auto shift is used'); };
    new ResizeObserver(() => { if (st.f && !st.zoom) drawEdit(); }).observe($('escroll'));
    $('zoom').value = 24;
  });
  function setTool(t) { st.tool = t; document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === t)); if (t !== 'select') st.region = null; drawEdit(); }
  FE.setTool = setTool;

  // ---- transforms on the selected glyphs (all of them when several are selected) -------------------------------------------------
  const ops = {
    up: ['Shift up', (g) => g.slice(1).concat([0])],
    down: ['Shift down', (g) => [0].concat(g.slice(0, -1))],
    left: ['Shift left', (g, s) => g.map((b) => (b << 1 >>> 0) & CF.fullMask(st.f) & colMask(NC(s)) >>> 0)],
    right: ['Shift right', (g) => g.map((b) => b >>> 1)],
    clr: ['Clear', (g) => g.map(() => 0)],
    inv: ['Invert', (g, s) => g.map((b) => (~b & colMask(NC(s))) >>> 0)],
    mir: ['Flip horizontally', (g, s) => g.map((b) => { let o = 0; const n = NC(s); for (let q = 0; q < n; q++) if (CF.hasPx(st.f, b, q)) o |= CF.bitMask(st.f, n - 1 - q); return o >>> 0; })],
    flipv: ['Flip vertically', (g) => CF.flipV(st.f, g)],
    rot: ['Rotate 90\u00b0', (g) => CF.rotate(st.f, g)],
  };
  for (const [id, [label, fn]] of Object.entries(ops)) {
    FE.ops = FE.ops || {};
    FE.ops[id] = () => FE.editSlots(label, st.tool === 'select' && st.region && (id === 'clr') ? [st.slot] : FE.selSlots(), (g, s) => {
      if (id === 'clr' && st.region && st.tool === 'select') { const r = st.region, n = g.slice(); for (let y = r.y0; y <= r.y1; y++) for (let q = r.x0; q <= r.x1; q++) setPx(n, q, y, 0); return n; }
      return fn(g, s);
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    for (const id of Object.keys(ops)) $(id).onclick = FE.ops[id];
    $('cpy').onclick = copy; $('pst').onclick = paste;
  });

  // ---- clipboard: a region, or the whole glyph (resampled when it comes from another size) ----------------------------------------
  function copy() {
    const f = st.f, g = FE.rows(st.slot, st.tgt, false);
    if (st.region) {
      const r = st.region, pix = [];
      for (let y = r.y0; y <= r.y1; y++) for (let q = r.x0; q <= r.x1; q++) if (getPx(g, q, y)) pix.push([q - r.x0, y - r.y0]);
      st.clip = { kind: 'region', pix, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 }; FE.toast('Region copied');
    } else { st.clip = { kind: 'glyph', rows: g.slice(), font: f, slots: FE.selSlots().map((s) => [s, (f.glyphs[s] || []).slice()]) }; FE.toast(st.clip.slots.length > 1 ? st.clip.slots.length + ' glyphs copied' : 'Glyph copied'); }
  }
  function paste() {
    const c = st.clip; if (!c) return;
    if (c.kind === 'region') {
      const o = st.region ? [st.region.x0, st.region.y0] : [0, 0];
      FE.editSlots('Paste region', [st.slot], (g) => { for (const [q, y] of c.pix) if (q + o[0] < NC() && y + o[1] < st.f.rows) setPx(g, q + o[0], y + o[1], 1); });
      st.region = { x0: o[0], y0: o[1], x1: Math.min(NC() - 1, o[0] + c.w - 1), y1: Math.min(st.f.rows - 1, o[1] + c.h - 1) };
      setTool('select'); return;
    }
    const slots = c.slots.length > 1 && st.sel.size > 1 ? FE.selSlots() : [st.slot];
    const src = c.font === st.f ? null : c.font;
    const same = !src || (src.rows === st.f.rows && src.gw === st.f.gw && src.adv === st.f.adv);
    FE.push('Paste glyph' + (slots.length > 1 ? 's' : ''), slots);
    slots.forEach((s, i) => {
      const rows = (c.slots[i] || c.slots[0])[1].length ? (c.slots[i] || c.slots[0])[1] : c.rows, g = FE.rows(s, st.tgt, true);
      const n = same ? rows : CF.deriveGlyph(src, st.f, rows, {});
      for (let k = 0; k < g.length; k++) g[k] = n[k] || 0;
    });
    CF.markEdited(st.f); FE.changed();
  }
  FE.copy = copy; FE.paste = paste;

  // ---- batch operations --------------------------------------------------------------------------------------------------------------
  const noGfx = (slots) => slots.filter((s) => !CF.isGfxSlot(s));
  function weight(dir) {
    FE.editSlots(dir > 0 ? 'Weight +' : 'Weight -', noGfx(FE.selSlots()), (g, s) => { const m = colMask(NC(s)); return g.map((b) => (dir > 0 ? (b | (b >>> 1)) & m : b & ~(b & (b >>> 1) & ~((b << 1) >>> 0))) >>> 0); });
  }
  function shiftBy(dx, dy) {
    FE.editSlots('Shift ' + dx + ',' + dy, FE.selSlots(), (g, s) => {
      const m = colMask(NC(s)); let o = g.slice();
      if (dy > 0) o = new Array(dy).fill(0).concat(o.slice(0, o.length - dy)); else if (dy < 0) o = o.slice(-dy).concat(new Array(-dy).fill(0));
      return o.map((b) => ((dx > 0 ? b >>> dx : (b << -dx) >>> 0) & m) >>> 0);
    });
  }
  const masterFont = () => (st.fam && st.fam.sizes[st.fam.master]) || null;
  function fromMaster() {
    const m = masterFont();
    if (!m || m === st.f) return FE.toast('This size is the master: there is nothing to derive from');
    FE.editSlots('Derive from master', noGfx(FE.selSlots()), (g, s) => CF.deriveGlyph(m, st.f, m.glyphs[s] || new Array(m.rows).fill(0), FE.hintOpts()));
    FE.toast('Re-derived ' + noGfx(FE.selSlots()).length + ' glyph(s) from the ' + m.adv + ' px master');
  }
  function copyToSize() {
    const t = st.fam && st.fam.sizes[$('cpsize').value]; if (!t || t === st.f) return FE.toast('Choose another existing size');
    const src = st.f, slots = FE.selSlots();
    for (const s of slots) { const n = CF.deriveGlyph(src, t, src.glyphs[s] || new Array(src.rows).fill(0), {}); t.glyphs[s] = n; }
    CF.markEdited(t); FE.changed(); FE.toast('Copied ' + slots.length + ' glyph(s) to ' + t.adv + ' px (resampled)');
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('bwplus').onclick = () => weight(1); $('bwminus').onclick = () => weight(-1);
    $('bshift').onclick = () => shiftBy(+$('bdx').value || 0, +$('bdy').value || 0);
    $('bfrommaster').onclick = fromMaster; $('bcpsize').onclick = copyToSize;
    $('bsetnc').onclick = () => { const a = FE.selSlots(); FE.toast(a.length + ' glyph(s) selected: ' + a.slice(0, 12).join(', ') + (a.length > 12 ? '...' : '')); };
  });
  FE.batch = { weight, shiftBy, fromMaster, copyToSize };
  FE.renders.push(() => {
    const n = FE.selSlots().length; $('bsel').textContent = n + ' glyph' + (n === 1 ? '' : 's') + ' selected';
    const sel = $('cpsize'), keep = sel.value; sel.innerHTML = '';
    if (st.fam) for (const k of Object.keys(st.fam.sizes).map(Number).sort((a, b) => a - b)) if (k !== st.f.adv) { const o = document.createElement('option'); o.value = k; o.textContent = k + ' px'; sel.appendChild(o); }
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  });

  // ---- shortcuts ---------------------------------------------------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const T = 'Tools';
    FE.key('B', 'Pencil (right button erases)', () => setTool('pen'), T); FE.key('E', 'Eraser', () => setTool('eraser'), T); FE.key('L', 'Line (Shift: 45\u00b0)', () => setTool('line'), T);
    FE.key('R', 'Rectangle (Shift: square)', () => setTool('rect'), T); FE.key('O', 'Ellipse (Shift: circle)', () => setTool('ellipse'), T); FE.key('G', 'Flood fill', () => setTool('fill'), T);
    FE.key('M', 'Select / move a region', () => setTool('select'), T);
    FE.key('ArrowLeft', 'Shift glyph left', () => FE.ops.left(), 'Transform'); FE.key('ArrowRight', 'Shift glyph right', () => FE.ops.right(), 'Transform');
    FE.key('ArrowUp', 'Shift glyph up', () => FE.ops.up(), 'Transform'); FE.key('ArrowDown', 'Shift glyph down', () => FE.ops.down(), 'Transform');
    FE.key('H', 'Flip horizontally', () => FE.ops.mir(), 'Transform'); FE.key('V', 'Flip vertically', () => FE.ops.flipv(), 'Transform');
    FE.key('T', 'Rotate 90\u00b0', () => FE.ops.rot(), 'Transform'); FE.key('I', 'Invert', () => FE.ops.inv(), 'Transform'); FE.key('Delete', 'Clear glyph (or region)', () => FE.ops.clr(), 'Transform');
    FE.key('Ctrl+C', 'Copy region or glyph', copy, 'Clipboard'); FE.key('Ctrl+V', 'Paste', paste, 'Clipboard');
    FE.key('+', 'Zoom in', () => setZoom(ES() + 2), 'View'); FE.key('-', 'Zoom out', () => setZoom(ES() - 2), 'View'); FE.key('0', 'Fit the editor to the window', () => $('zfit').click(), 'View');
    FE.key('D', 'Toggle pixel grid', () => { $('pgrid').checked = !$('pgrid').checked; $('pgrid').onchange(); }, 'View');
    FE.key('Q', 'Cycle onion skin: off / smaller size / larger size', () => { $('onion').value = { off: 'smaller', smaller: 'larger', larger: 'off' }[st.onion]; $('onion').onchange(); }, 'View');
    FE.key('W', 'Toggle reference outline', () => { $('gshow').checked = !$('gshow').checked; $('gshow').onchange(); }, 'View');
    ['edit', 'family', 'specimen', 'atari', 'kern', 'quality'].forEach((t, i) => FE.key('Alt+' + (i + 1), 'Go to the ' + t + ' tab', () => FE.showTab(t), 'View'));
  });

  // ---- properties: advance, bearings, slot, case, super/sub ---------------------------------------------------------------------------------
  const num = (id, lo, hi) => Math.max(lo, Math.min(hi, parseInt($(id).value, 10) || 0));
  const inkSpan = (g) => { const f = st.f, nc = NC(); let lo = 99, hi = -1; for (const r of g) for (let q = 0; q < nc; q++) if (CF.hasPx(f, r, q)) { lo = Math.min(lo, q); hi = Math.max(hi, q); } return hi < 0 ? null : [lo, hi]; };
  const advOfSlot = (s) => st.f.advs[s] || st.f.adv;
  FE.hooks.push(() => {
    const sp = inkSpan(FE.rows(st.slot, st.tgt, false)), a = advOfSlot(st.slot);
    $('gmname').textContent = '(slot ' + st.slot + ')';
    $('gmw').value = sp ? sp[1] - sp[0] + 1 : 0; $('gmlb').value = sp ? sp[0] : 0; $('gmrb').value = sp ? a - sp[1] - 1 : 0; $('gmadv').value = a;
  });
  function setAdv(v) {
    const f = st.f; v = Math.max(1, Math.min(CF.isWide(f) ? 32 : 16, v | 0));
    FE.push('Advance ' + v, []);
    if (v === f.adv) delete f.advs[st.slot]; else f.advs[st.slot] = v;
    CF.markEdited(f); FE.changed();
  }
  function setLb(lb) {
    const sp = inkSpan(FE.rows(st.slot, st.tgt, false)); if (!sp) return;
    const d = Math.max(0, Math.min(NC() - (sp[1] - sp[0] + 1), lb)) - sp[0], m = colMask(NC());
    if (d) FE.editSlots('Left bearing ' + lb, [st.slot], (g) => g.map((b) => (d > 0 ? b >>> d : ((b << -d) >>> 0) & m)));
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('gmadv').onchange = () => setAdv(+$('gmadv').value);
    $('gmreset').onclick = () => setAdv(st.f.adv);
    $('gmrb').onchange = () => { const sp = inkSpan(FE.rows(st.slot, st.tgt, false)); if (sp) setAdv(sp[1] + 1 + Math.max(0, +$('gmrb').value || 0)); };
    $('gmlb').onchange = () => setLb(+$('gmlb').value || 0);
    $('gmtrim').onclick = () => setLb(0);
    $('gmw').onchange = () => {
      const f = st.f, sp = inkSpan(FE.rows(st.slot, st.tgt, false)); if (!sp) return;
      const w0 = sp[1] - sp[0] + 1, w1 = Math.max(1, Math.min(NC() - sp[0], +$('gmw').value || 1));
      if (w1 === w0) return;
      FE.editSlots('Ink width ' + w1, [st.slot], (g) => g.map((b) => { let o = 0; for (let q = 0; q < w1; q++) if (CF.hasPx(f, b, sp[0] + Math.min(w0 - 1, Math.floor(((q + 0.5) * w0) / w1)))) o |= CF.bitMask(f, sp[0] + q); return o >>> 0; }));
    };
    $('supup').onchange = () => { FE.push('Superscript offset', [], true); st.f.supUp = num('supup', 0, 6); FE.changed(); };
    $('subdn').onchange = () => { FE.push('Subscript offset', [], true); st.f.subDown = num('subdn', 0, 6); FE.changed(); };
    $('upgo').onclick = () => { CF.setCase(st.f, 'upper', num('upslot', 0, 230)); st.slot = st.f.map[65]; FE.changed(); };
    $('lowgo').onclick = () => { CF.setCase(st.f, 'lower', num('lowslot', 0, 230)); st.slot = st.f.map[97]; FE.changed(); };
    $('codeslot').onchange = () => { const c = FE.cur(); st.f.map[c] = num('codeslot', 0, 255); st.slot = st.f.map[c]; FE.changed(); };
    for (const [id, key] of [['mhead', 'head'], ['mxtop', 'xTop'], ['mbase', 'base']]) $(id).onchange = () => {
      const f = st.f; FE.push('Metrics', [], true); f[key] = Math.max(0, Math.min(f.rows - 1, +$(id).value || 0));
      if (key === 'base') f.desc = f.rows - f.base - 1; f.xTop = Math.max(f.head, Math.min(f.base, f.xTop)); CF.markEdited(f); FE.changed();
    };
  });
  FE.renders.push(() => {
    const f = st.f; if (!f) return;
    $('info').innerHTML = '<b>' + f.adv + ' px</b> advance, glyph <b>' + f.gw + ' px</b> wide, cell ' + f.rows + ' rows';
    $('metrics').textContent = 'Rows 0-' + (f.rows - 1) + ': headroom 0-' + (f.head - 1) + ', cap line ' + f.head + ', x-height ' + f.xTop + ', baseline row ' + f.base + ', descender ' + (f.base + 1) + '-' + (f.rows - 1) + '. Drag the coloured handles in the ruler beside the editor to move the lines.';
    $('caseinfo').textContent = 'A-Z -> slots ' + f.map[65] + '..' + (f.map[65] + 25) + ', a-z -> slots ' + f.map[97] + '..' + (f.map[97] + 25) + (CF.isDefaultMap(f) ? ' (identity map)' : ' (custom map stored in the file)');
    $('mhead').value = f.head; $('mxtop').value = f.xTop; $('mbase').value = f.base; $('supup').value = f.supUp; $('subdn').value = f.subDown;
    const nb = neighbourSize(); $('onioninfo').textContent = st.onion === 'off' ? '' : nb ? '(' + nb.adv + ' px)' : '(no such size)';
  });

  // ---- history list ------------------------------------------------------------------------------------------------------------------------
  FE.renders.push(() => {
    const h = FE.hist(), box2 = $('histlist'), el = (cls, label, fn) => { const b = document.createElement('button'); b.className = 'hi ' + cls; b.textContent = label; b.onclick = fn; return b; };
    box2.innerHTML = '';
    h.redo.slice().reverse().forEach((e, i, a) => box2.appendChild(el('redo', e.label, () => { for (let k = 0; k <= i; k++) FE.redo(); })));
    h.undo.slice().reverse().forEach((e, i) => box2.appendChild(el(i === 0 ? 'now' : '', e.label, () => FE.undo(i + (i === 0 ? 1 : 1)))));
    if (!h.undo.length && !h.redo.length) box2.textContent = 'No edits yet in this size.';
    $('undo').disabled = !h.undo.length; $('redo').disabled = !h.redo.length;
  });

  // ---- preview: real line spacing; ^{sup} _{sub}; kerning pairs when "kerning" is on ----------------------------------------------------------
  function drawPreview() {
    const f = st.f; if (!f) return;
    const z = +$('pvz').value, lead = +$('lead').value || 0, lines = $('sample').value.split('\n'), C = FE.themeColors();
    const cells = lines.map((ln) => {
      const out = []; let mode = 0;
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i];
        if ((ch === '^' || ch === '_') && ln[i + 1] === '{' && ln.indexOf('}', i) > 0) { mode = ch === '^' ? 1 : 2; i++; continue; }
        if (ch === '}' && mode) { mode = 0; continue; }
        out.push([FE.codeOfChar(ch), mode]);
      }
      return out;
    });
    const prop = $('pvprop').checked, kern = $('pvkern').checked, advOf = (code) => (prop && f.advs[f.map[code]]) || f.adv;
    const widths = cells.map((c) => c.reduce((s, [code], i) => s + advOf(code) + (kern && i ? FE.kernOf(f, c[i - 1][0], code) : 0), 0));
    const W = Math.max(8 * f.adv, ...widths) + 8, lh = f.rows + lead, H = cells.length * lh + 8;
    pv.width = W * z; pv.height = H * z;
    px.fillStyle = '#f6f3ea'; px.fillRect(0, 0, pv.width, pv.height);
    cells.forEach((ln, li) => {
      const y0 = 4 + li * lh;
      if ($('pvg').checked) for (const [k, col] of [[f.head, COL.cap], [f.xTop, COL.xh], [f.base + 1, COL.base]]) { px.fillStyle = col + '77'; px.fillRect(0, (y0 + k) * z, pv.width, 1); }
      px.fillStyle = '#16181c';
      let xo = 0;
      ln.forEach(([code, mode], i) => {
        if (kern && i) xo += FE.kernOf(f, ln[i - 1][0], code);
        const g = CF.render(f, code, mode), i0 = xo; xo += advOf(code);
        for (let r = 0; r < f.rows; r++) if (g[r]) for (let q = 0; q < NC(f.map[code]); q++) if (CF.hasPx(f, g[r], q)) px.fillRect((4 + i0 + q) * z, (y0 + r) * z, z, z);
      });
    });
  }
  FE.renders.push(drawPreview);
  FE.drawPreview = drawPreview;
  FE.renders.push(() => FE.hooks.forEach((h) => h()));
  document.addEventListener('DOMContentLoaded', () => { for (const id of ['sample', 'pvz', 'pvg', 'lead', 'pvprop', 'pvkern']) $(id).addEventListener('input', () => FE.render()); });
  FE.kernOf = FE.kernOf || (() => 0);
})();
