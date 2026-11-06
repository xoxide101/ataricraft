// Craft Font Editor (web/fontedit.html). Uses XCW.Font (tools/craftfont.cjs, docs/FONT.md); no build step.
(() => {
  'use strict';
  const CF = XCW.Font, $ = (id) => document.getElementById(id);
  const M = CF.METRICS;
  const COL = { head: '#4a78c8', cap: '#e8b030', xh: '#58c878', base: '#e05555', desc: '#9a6ad0' };
  const hooks = [];
  const st = { f: null, slot: 65, tgt: 0, clip: null, undo: [], down: 0 };

  const b64ToBuf = (s) => Buffer.from(s, 'base64');
  const bufToB64 = (b) => Buffer.from(b).toString('base64');
  const toast = (m) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2400); };

  function setFont(f, fam) {
    st.f = f; st.undo = [];
    st.fam = fam || (st.fam && Object.values(st.fam.sizes).includes(f) ? st.fam : null);
    st.slot = f.map[65] === undefined ? 65 : f.map[65];
    $('name').value = f.name; $('supup').value = f.supUp; $('subdn').value = f.subDown;
    $('upslot').value = f.map[65]; $('lowslot').value = f.map[97];
    sizeCanvases(); renderAll(); refreshFam(); updateAcwBar();
  }

  // ---- family: master + derived sizes -------------------------------------------------------------------------------
  const ORIG = ['master', 'derived', 'hand-edited'];
  function refreshFam() {
    const f = st.f, sel = $('fsize'), fam = st.fam;
    sel.innerHTML = '';
    const sizes = fam ? Object.keys(fam.sizes).map(Number) : [f.adv];
    for (const k of sizes.sort((a, b) => b - a)) {
      const g = fam ? fam.sizes[k] : f, o = document.createElement('option');
      o.value = k; o.textContent = (CF.SIZES[k] ? CF.SIZES[k].label : k + ' px') + ' - ' + ORIG[g.origin] + (g.locked ? ', locked' : '');
      sel.appendChild(o);
    }
    sel.value = f.adv; $('flock').checked = !!f.locked;
  }
  $('fsize').onchange = () => { const g = st.fam && st.fam.sizes[$('fsize').value]; if (g) setFont(g); };
  $('flock').onchange = () => { st.f.locked = $('flock').checked; refreshFam(); };
  $('bderive').onclick = () => {
    const f = st.f, fam = st.fam || CF.familyNew(f);
    if (!fam.sizes[f.adv]) fam.sizes[f.adv] = f;
    fam.master = fam.master === undefined || !fam.sizes[fam.master] ? f.adv : fam.master;
    const sizes = Object.keys(CF.SIZES).map(Number).filter((s) => s < fam.master);
    const r = CF.familyDerive(fam, sizes, { threshold: +$('dth').value, keepStems: $('dkeep').checked });
    st.fam = fam; setFont(fam.sizes[fam.master], fam);
    toast('Derived ' + (r.done.join(', ') || 'nothing') + (r.skipped.length ? '; kept locked/hand-edited ' + r.skipped.join(', ') : ''));
  };
  $('bfam').onclick = () => { const fam = st.fam || CF.familyNew(st.f); download(fname() + '.family.json', CF.familyToJson(fam), 'application/json'); };

  // The code whose glyph lives in the selected slot (the first code that maps there), so Super/Sub variants have a character to attach to.
  const codeOfSlot = (slot) => { const f = st.f; for (let c = 0; c < 256; c++) if (f.map[c] === slot) return c; return slot; };
  const cur = () => codeOfSlot(st.slot);

  // rows being edited for the current target
  function target(create) {
    const f = st.f, c = cur();
    if (st.tgt === 0) return f.glyphs[st.slot] || (f.glyphs[st.slot] = new Array(f.rows).fill(0));
    const tab = st.tgt === 1 ? f.sup : f.sub;
    if (!tab[c] && create) tab[c] = CF.render(f, c, st.tgt);
    return tab[c] || CF.render(f, c, st.tgt);
  }
  const pushUndo = () => { st.undo.push(JSON.stringify([st.slot, st.tgt, target(false)])); st.redo = []; if (st.undo.length > 100) st.undo.shift(); };

  // ---- drawing -----------------------------------------------------------------------------------------------
  const grid = $('grid'), gx = grid.getContext('2d'), ed = $('edit'), ex = ed.getContext('2d'), pv = $('preview'), px = pv.getContext('2d');
  const GS = 2;
  const cell = () => ({ w: (st.f.adv + 2) * GS, h: (st.f.rows + 2) * GS });
  const ES = 24;
  // columns of a slot: the Atari graphics (slots 0-31, 128-132) fill the whole advance, letters only the glyph width
  const NC = (slot) => CF.colsOf(st.f, slot === undefined ? st.slot : slot);

  function sizeCanvases() {
    const c = cell(), f = st.f;
    grid.width = c.w * 16; grid.height = c.h * 16;
    ed.width = NC() * ES; ed.height = f.rows * ES;
  }

  function drawGrid() {
    const f = st.f, c = cell();
    gx.fillStyle = '#101216'; gx.fillRect(0, 0, grid.width, grid.height);
    for (let s = 0; s < 256; s++) {
      const x0 = (s % 16) * c.w, y0 = ((s / 16) | 0) * c.h;
      const inA = s >= f.map[65] && s < f.map[65] + 26, inl = s >= f.map[97] && s < f.map[97] + 26;
      if (inA) { gx.fillStyle = '#16301f'; gx.fillRect(x0, y0, c.w, c.h); }
      if (inl) { gx.fillStyle = '#1a2538'; gx.fillRect(x0, y0, c.w, c.h); }
      const g = f.glyphs[s];
      gx.fillStyle = '#e8eaee';
      if (g) for (let r = 0; r < f.rows; r++) for (let q = 0; q < NC(s); q++) if (CF.hasPx(f, g[r], q)) gx.fillRect(x0 + GS + q * GS, y0 + GS + r * GS, GS, GS);
      if (s === st.slot) { gx.strokeStyle = '#ff9d3a'; gx.lineWidth = 2; gx.strokeRect(x0 + 1, y0 + 1, c.w - 2, c.h - 2); }
    }
  }

  function drawEdit() {
    const f = st.f, g = target(false);
    if (ed.width !== NC() * ES) ed.width = NC() * ES;
    ex.fillStyle = '#0f1115'; ex.fillRect(0, 0, ed.width, ed.height);
    ex.fillStyle = COL.head + '44'; ex.fillRect(0, 0, ed.width, f.head * ES);
    ex.fillStyle = COL.desc + '44'; ex.fillRect(0, (f.base + 1) * ES, ed.width, (f.rows - f.base - 1) * ES);
    ex.strokeStyle = '#ffffff12'; ex.lineWidth = 1;
    for (let q = 0; q <= NC(); q++) { ex.beginPath(); ex.moveTo(q * ES + .5, 0); ex.lineTo(q * ES + .5, ed.height); ex.stroke(); }
    for (let r = 0; r <= f.rows; r++) { ex.beginPath(); ex.moveTo(0, r * ES + .5); ex.lineTo(ed.width, r * ES + .5); ex.stroke(); }
    ex.fillStyle = '#f2f4f8';
    for (let r = 0; r < f.rows; r++) for (let q = 0; q < NC(); q++) if (CF.hasPx(f, g[r], q)) ex.fillRect(q * ES + 1, r * ES + 1, ES - 1, ES - 1);
    const line = (y, col) => { ex.fillStyle = col; ex.fillRect(0, y - 1, ed.width, 2); };
    line(f.head * ES, COL.cap); line(f.xTop * ES, COL.xh); line((f.base + 1) * ES, COL.base);
    const c = cur();
    $('gname').textContent = '- code ' + c + (c >= 33 && c < 127 ? ' "' + String.fromCharCode(c) + '"' : '') + ', slot ' + st.slot + (st.tgt ? (st.tgt === 1 ? ' (super)' : ' (sub)') : '');
    $('codeinfo').textContent = c; $('codeslot').value = f.map[c];
  }

  // ^{text} = superscript, _{text} = subscript
  function drawPreview() {
    const f = st.f, z = +$('pvz').value, lead = +$('lead').value || 0, lines = $('sample').value.split('\n');
    const cells = lines.map((ln) => {
      const out = []; let mode = 0;
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i];
        if ((ch === '^' || ch === '_') && ln[i + 1] === '{' && ln.indexOf('}', i) > 0) { mode = ch === '^' ? 1 : 2; i++; continue; }
        if (ch === '}' && mode) { mode = 0; continue; }
        out.push([ch.charCodeAt(0) & 255, mode]);
      }
      return out;
    });
    const prop = $('pvprop').checked, advOf = (code) => (prop && f.advs[f.map[code]]) || f.adv;
    const W = Math.max(8 * f.adv, ...cells.map((c) => c.reduce((s, [code]) => s + advOf(code), 0))) + 8, lh = f.rows + lead, H = cells.length * lh + 8;
    pv.width = W * z; pv.height = H * z;
    px.fillStyle = '#f6f3ea'; px.fillRect(0, 0, pv.width, pv.height);
    cells.forEach((ln, li) => {
      const y0 = 4 + li * lh;
      if ($('pvg').checked) {
        for (const [k, col] of [[f.head, COL.cap], [f.xTop, COL.xh], [f.base + 1, COL.base], [f.head - 0, null]]) if (col) { px.fillStyle = col + '77'; px.fillRect(0, (y0 + k) * z, pv.width, 1); }
      }
      px.fillStyle = '#16181c';
      let xo = 0;
      ln.forEach(([code, mode]) => {
        const g = CF.render(f, code, mode), i0 = xo; xo += advOf(code);
        for (let r = 0; r < f.rows; r++) if (g[r]) for (let q = 0; q < NC(f.map[code]); q++) if (CF.hasPx(f, g[r], q)) px.fillRect((4 + i0 + q) * z, (y0 + r) * z, z, z);
      });
    });
    hooks.forEach((h) => h());
  }

  function drawInfo() {
    const f = st.f;
    $('info').innerHTML = '<b>' + f.adv + ' px</b> advance, glyph <b>' + f.gw + ' px</b> wide, cell ' + f.rows + ' rows';
    $('metrics').textContent = 'Cell rows 0-' + (f.rows - 1) + ': headroom 0-' + (f.head - 1) + ', cap line row ' + f.head + ', x-height line row ' + f.xTop + ', baseline row ' + f.base + ', descender ' + (f.base + 1) + '-' + (f.rows - 1) + '.';
    $('caseinfo').textContent = 'A-Z -> slots ' + f.map[65] + '..' + (f.map[65] + 25) + ', a-z -> slots ' + f.map[97] + '..' + (f.map[97] + 25) + (CF.isDefaultMap(f) ? ' (identity map)' : ' (custom map is stored in the file)');
  }

  function renderAll() { drawGrid(); drawEdit(); drawPreview(); drawInfo(); }

  // ---- interaction ------------------------------------------------------------------------------------------------
  grid.addEventListener('mousedown', (e) => {
    const c = cell(), r = grid.getBoundingClientRect();
    const s = Math.floor((e.clientY - r.top) / c.h) * 16 + Math.floor((e.clientX - r.left) / c.w);
    if (s >= 0 && s < 256) { st.slot = s; renderAll(); }
  });

  function paint(e, val) {
    const r = ed.getBoundingClientRect(), f = st.f;
    const q = Math.floor(((e.clientX - r.left) / r.width) * NC()), y = Math.floor(((e.clientY - r.top) / r.height) * f.rows);
    if (q < 0 || y < 0 || q >= NC() || y >= f.rows) return;
    const g = target(true), bit = CF.bitMask(f, q);
    if (val === undefined) val = (g[y] & bit) ? 0 : 1; // first click decides draw / erase for the drag
    if (!!(g[y] & bit) === !!val) return val;
    g[y] = val ? g[y] | bit : g[y] & ~bit;
    CF.markEdited(f);
    drawEdit(); drawGrid(); drawPreview();
    return val;
  }
  const cellAt = (e) => {
    const r = ed.getBoundingClientRect(), f = st.f;
    const q = Math.floor(((e.clientX - r.left) / r.width) * NC()), y = Math.floor(((e.clientY - r.top) / r.height) * f.rows);
    return q < 0 || y < 0 || q >= NC() || y >= f.rows ? null : [q, y];
  };
  const setPixel = (g, q, y, val) => { const bit = CF.bitMask(st.f, q); g[y] = val ? g[y] | bit : g[y] & ~bit; };
  const getPixel = (g, q, y) => CF.hasPx(st.f, g[y], q);
  function lineCells(a, b) {
    const out = []; let [x0, y0] = a; const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    return out;
  }
  function applyShape(tool, a, b, val) {
    const g = target(true), f = st.f;
    if (tool === 'line') lineCells(a, b).forEach(([q, y]) => setPixel(g, q, y, val));
    else if (tool === 'rect') {
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])], fill = $('rectfill').checked;
      for (let y = y0; y <= y1; y++) for (let q = x0; q <= x1; q++) if (fill || y === y0 || y === y1 || q === x0 || q === x1) setPixel(g, q, y, val);
    } else if (tool === 'fill') {
      const from = getPixel(g, a[0], a[1]), seen = new Set(), stack = [a];
      if (from === !!val) return;
      while (stack.length) {
        const [q, y] = stack.pop(), k = y * 32 + q;
        if (q < 0 || y < 0 || q >= NC() || y >= f.rows || seen.has(k) || getPixel(g, q, y) !== from) continue;
        seen.add(k); setPixel(g, q, y, val); stack.push([q + 1, y], [q - 1, y], [q, y + 1], [q, y - 1]);
      }
    }
    CF.markEdited(f); renderAll();
  }
  st.tool = 'pen';
  document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => { st.tool = b.dataset.tool; document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x === b)); }; });
  ed.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const c = cellAt(e); if (!c) return;
    pushUndo();
    const val = e.button === 2 ? 0 : 1;
    if (st.tool === 'fill') { applyShape('fill', c, c, val); return; }
    st.down = 1; st.start = c; st.shapeVal = val;
    if (st.tool === 'pen') st.dragVal = paint(e, e.button === 2 ? 0 : undefined);
  });
  window.addEventListener('mousemove', (e) => { if (st.down && st.tool === 'pen') paint(e, st.dragVal); });
  window.addEventListener('mouseup', (e) => {
    if (st.down && (st.tool === 'line' || st.tool === 'rect')) { const c = cellAt(e); if (c) applyShape(st.tool, st.start, c, st.shapeVal); }
    st.down = 0;
  });
  ed.addEventListener('contextmenu', (e) => e.preventDefault());

  const edit = (fn) => { pushUndo(); const g = target(true), n = fn(g.slice()); for (let i = 0; i < g.length; i++) g[i] = n[i]; CF.markEdited(st.f); renderAll(); };
  const mask = () => CF.fullMask(st.f);
  $('up').onclick = () => edit((g) => g.slice(1).concat([0]));
  $('down').onclick = () => edit((g) => [0].concat(g.slice(0, -1)));
  $('left').onclick = () => edit((g) => g.map((b) => (b << 1) & mask()));
  $('right').onclick = () => edit((g) => g.map((b) => (b >> 1) & mask()));
  $('clr').onclick = () => edit((g) => g.map(() => 0));
  $('inv').onclick = () => edit((g) => g.map((b) => ~b & mask()));
  $('mir').onclick = () => edit((g) => g.map((b) => { let o = 0; for (let q = 0; q < st.f.gw; q++) if (CF.hasPx(st.f, b, q)) o |= CF.bitMask(st.f, st.f.gw - 1 - q); return o; }));
  $('cpy').onclick = () => { st.clip = target(false).slice(); toast('Glyph copied'); };
  $('pst').onclick = () => { if (st.clip) edit(() => st.clip.slice()); };
  const restore = (u) => {
    const [slot, tgt, rows] = JSON.parse(u); st.slot = slot; st.tgt = tgt;
    const g = target(true); for (let i = 0; i < g.length; i++) g[i] = rows[i];
    document.querySelectorAll('.tgt').forEach((b) => b.classList.toggle('on', +b.dataset.t === st.tgt));
    renderAll();
  };
  $('undo').onclick = () => {
    const u = st.undo.pop(); if (!u) return;
    const [slot, tgt] = JSON.parse(u); st.slot = slot; st.tgt = tgt;
    (st.redo = st.redo || []).push(JSON.stringify([slot, tgt, target(false).slice()]));
    restore(u);
  };
  $('redo').onclick = () => {
    const u = (st.redo || []).pop(); if (!u) return;
    const [slot, tgt] = JSON.parse(u); st.slot = slot; st.tgt = tgt;
    st.undo.push(JSON.stringify([slot, tgt, target(false).slice()]));
    restore(u);
  };
  $('flipv').onclick = () => edit((g) => CF.flipV(st.f, g));
  $('rot').onclick = () => edit((g) => CF.rotate(st.f, g));
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'z' && !e.shiftKey) { $('undo').click(); e.preventDefault(); } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { $('redo').click(); e.preventDefault(); }
  });
  document.querySelectorAll('.tgt').forEach((b) => {
    b.onclick = () => { st.tgt = +b.dataset.t; document.querySelectorAll('.tgt').forEach((x) => x.classList.toggle('on', x === b)); renderAll(); };
  });
  $('vclear').onclick = () => { const c = cur(); delete st.f.sup[c]; delete st.f.sub[c]; renderAll(); toast('Variants for code ' + c + ' removed; auto shift is used'); };

  const num = (id, lo, hi) => Math.max(lo, Math.min(hi, parseInt($(id).value, 10) || 0));
  $('supup').onchange = () => { st.f.supUp = num('supup', 0, 6); drawPreview(); };
  $('subdn').onchange = () => { st.f.subDown = num('subdn', 0, 6); drawPreview(); };
  $('upgo').onclick = () => { CF.setCase(st.f, 'upper', num('upslot', 0, 230)); st.slot = st.f.map[65]; renderAll(); };
  $('lowgo').onclick = () => { CF.setCase(st.f, 'lower', num('lowslot', 0, 230)); st.slot = st.f.map[97]; renderAll(); };
  $('codeslot').onchange = () => { const c = cur(); st.f.map[c] = num('codeslot', 0, 255); st.slot = st.f.map[c]; renderAll(); };
  $('name').onchange = () => { st.f.name = $('name').value.slice(0, 40); };
  for (const id of ['sample', 'pvz', 'pvg', 'lead', 'pvprop']) $(id).addEventListener('input', drawPreview);

  // ---- per-glyph metrics: ink width, bearings and advance ------------------------------------------------------------
  // Left bearing = blank columns before the ink, right bearing = blank columns from the ink to the advance (so a normal glyph has 1).
  // The advance of a glyph defaults to the font advance; an override is stored in f.advs[slot] (ACF2 flag 16, JSON "advs").
  const inkSpan = (g) => { const f = st.f; let lo = 99, hi = -1; for (const r of g) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, r, q)) { lo = Math.min(lo, q); hi = Math.max(hi, q); } return hi < 0 ? null : [lo, hi]; };
  const advOfSlot = (s) => st.f.advs[s] || st.f.adv;
  function drawGM() {
    const sp = inkSpan(target(false)), a = advOfSlot(st.slot);
    $('gmname').textContent = '(slot ' + st.slot + ')';
    $('gmw').value = sp ? sp[1] - sp[0] + 1 : 0; $('gmlb').value = sp ? sp[0] : 0; $('gmrb').value = sp ? a - sp[1] - 1 : 0; $('gmadv').value = a;
  }
  hooks.push(drawGM);
  function setAdv(v) {
    const f = st.f; v = Math.max(1, Math.min(16, v | 0));
    if (v === f.adv) delete f.advs[st.slot]; else f.advs[st.slot] = v;
    CF.markEdited(f); renderAll();
  }
  $('gmadv').onchange = () => setAdv(+$('gmadv').value);
  $('gmreset').onclick = () => setAdv(st.f.adv);
  $('gmrb').onchange = () => { const sp = inkSpan(target(false)); if (sp) setAdv(sp[1] + 1 + Math.max(0, +$('gmrb').value || 0)); };
  function setLb(lb) {
    const sp = inkSpan(target(false)); if (!sp) return;
    const d = Math.max(0, Math.min(st.f.gw - (sp[1] - sp[0] + 1), lb)) - sp[0], m = mask();
    if (d) edit((g) => g.map((b) => (d > 0 ? b >> d : (b << -d) & m)));
  }
  $('gmlb').onchange = () => setLb(+$('gmlb').value || 0);
  $('gmtrim').onclick = () => setLb(0);
  $('gmw').onchange = () => {
    const f = st.f, sp = inkSpan(target(false)); if (!sp) return;
    const w0 = sp[1] - sp[0] + 1, w1 = Math.max(1, Math.min(f.gw - sp[0], +$('gmw').value || 1));
    if (w1 === w0) return;
    edit((g) => g.map((b) => {
      let o = 0;
      for (let q = 0; q < w1; q++) if (CF.hasPx(f, b, sp[0] + Math.min(w0 - 1, Math.floor(((q + 0.5) * w0) / w1)))) o |= CF.bitMask(f, sp[0] + q);
      return o;
    }));
  };

  // ---- Send to ACWriter (H:), Use in xCWriter, master size ---------------------------------------------------------
  // 8 px fonts go to ACWriter as an Atari charset (NAME.FNT, what Character > Font loads), other sizes as NAME.ACF.
  function acwriterFile() {
    const f = st.f, acf = exportAcf();
    return f.adv === 8 && f.gw <= 8 ? [fname() + '.FNT', new Uint8Array(CF.toFnt(f))] : [fname() + '.ACF', new Uint8Array(acf)];
  }
  const directEmu = () => {
    const c = [window.FujiNet && window.FujiNet.emu];
    try { if (window.opener && !window.opener.closed) c.push(window.opener.FujiNet && window.opener.FujiNet.emu); } catch (e) { /* cross-origin opener */ }
    return c.find((e) => e && typeof e.hostWrite === 'function') || null;
  };
  function viaChannel(name, bytes) {
    return new Promise((res) => {
      if (!window.BroadcastChannel) return res({ ok: false, msg: 'BroadcastChannel is not available' });
      const bc = new BroadcastChannel('xcwriter'); let done = false;
      const end = (r) => { if (done) return; done = true; bc.close(); res(r); };
      bc.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'pong') { if (!m.booted) end({ ok: false, msg: 'the emulator tab is open but not booted' }); else bc.postMessage({ type: 'hostWrite', name, bytes: Array.from(bytes) }); }
        else if (m.type === 'result') end({ ok: m.ok, name: m.name, msg: m.msg });
      };
      bc.postMessage({ type: 'ping' });
      setTimeout(() => end({ ok: false, msg: 'no emulator tab found: open index.html in this browser and boot ACWriter' }), 1500);
    });
  }
  async function sendToAcwriter() {
    const [name, bytes] = acwriterFile(), emu = directEmu();
    let r;
    if (emu) { emu.hostWrite(name, bytes); r = { ok: true, name, via: 'emulator' }; }
    else { r = await viaChannel(name, bytes); r.via = 'channel'; }
    toast(r.ok ? 'Wrote H:' + (r.name || name) + ' (' + bytes.length + ' bytes). In ACWriter use Character > Font and pick ' + (r.name || name) : 'Not sent: ' + r.msg);
    return Object.assign({ name, size: bytes.length }, r);
  }
  $('bsend').onclick = sendToAcwriter;
  function useInXcwriter() {
    if (!window.XFACE) throw new Error('faces.js is not loaded');
    const id = XFACE.faceId(fname() + '.acf'), bytes = new Uint8Array(exportAcf());
    XFACE.saveUser(id, bytes);
    toast('xCWriter font list now has ' + id + ' (Font editor group, this browser)');
    return id;
  }
  $('buse').onclick = useInXcwriter;
  $('bmaster').onclick = () => {
    const f = st.f, fam = st.fam || CF.familyNew(f);
    fam.sizes[f.adv] = f;
    const old = fam.sizes[fam.master];
    if (old && old !== f && old.origin === CF.ORIGIN.master) old.origin = CF.ORIGIN.hand;
    fam.master = f.adv; f.origin = CF.ORIGIN.master; f.masterAdv = 0;
    for (const g of Object.values(fam.sizes)) if (g !== f) g.masterAdv = f.adv;
    st.fam = fam; refreshFam(); toast(CF.SIZES[f.adv].label + ' is now the master; Derive smaller rebuilds the sizes below it');
  };

  // ---- files --------------------------------------------------------------------------------------------------------
  function exportAcf() { st.f.name = $('name').value || st.f.name; ensureRange(); return CF.serialize(st.f); }
  // Stored glyph range must cover every slot that holds a glyph.
  function ensureRange() {
    const f = st.f; let lo = 32, hi = f.first + f.count - 1;
    const used = (s) => s >= 0 && s < 256 && f.glyphs[s] && f.glyphs[s].some((b) => b);
    for (let s = 0; s < 256; s++) if (used(s)) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
    for (let c = 0; c < 256; c++) if (used(f.map[c])) { lo = Math.min(lo, f.map[c]); hi = Math.max(hi, f.map[c]); }
    f.first = lo; f.count = hi - lo + 1;
  }
  function download(name, data, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const fname = () => ($('name').value || 'font').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 8).toUpperCase() || 'FONT';
  $('bsave').onclick = () => { const b = exportAcf(); download(fname() + '.acf', b); toast('Saved ' + b.length + ' bytes (ACF2)'); };
  $('bjson').onclick = () => { exportAcf(); download(fname() + '.json', CF.toJson(st.f), 'application/json'); };
  $('binc').onclick = () => { exportAcf(); download(fname() + '.inc', CF.toInc(st.f, 'cf'), 'text/plain'); };
  $('bopen').onclick = () => $('file').click();
  $('bnew').onclick = () => { setFont(CF.createSize(+$('ttfadv').value, { name: 'New font' })); toast('Blank ' + CF.SIZES[st.f.adv].label + ' font'); };
  $('bfnt').onclick = () => { const f = atari8(); if (!f) return toast('Atari charsets are 8 px: derive the 8x8 size first'); download(fname() + '.fnt', CF.toFnt(f), 'application/octet-stream'); toast('Exported ' + fname() + '.fnt (1024 bytes, 8x8, screen-code order)'); };
  const canvasPng = (cv, name) => cv.toBlob((bl) => { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = name; document.body.appendChild(a); a.click(); a.remove(); });
  $('bpng').onclick = () => {
    const sh = CF.toSheet(st.f), cv = document.createElement('canvas'); cv.width = sh.w; cv.height = sh.h;
    const c = cv.getContext('2d'), im = c.createImageData(sh.w, sh.h);
    for (let i = 0; i < sh.data.length; i++) { const v = sh.data[i] ? 0 : 255; im.data.set([v, v, v, 255], i * 4); }
    c.putImageData(im, 0, 0); canvasPng(cv, fname() + '.sheet.png');
  };
  function pipeExport(ext) {
    const FP = XCW.FontPipe, fam = st.fam || CF.familyNew(st.f), size = st.f.adv, base = fname();
    const only = ext === 'xcf' ? fam : { sizes: { [size]: st.f }, master: size, name: fam.name };
    const out = FP.files(only, base, { formats: [ext] }), names = Object.keys(out);
    const n = names.find((k) => k.endsWith('.' + ext)); download(n, out[n], ext === 'xcf' ? 'application/json' : 'application/octet-stream');
    toast(ext.toUpperCase() + ' exported: ' + n);
  }
  $('bxcf').onclick = () => pipeExport('xcf'); $('bbdf').onclick = () => pipeExport('bdf'); $('bttf').onclick = () => pipeExport('ttf');
  $('bprev').onclick = () => canvasPng(pv, fname() + '.preview.png');
  async function sheetFromPng(bytes, name) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const c = cv.getContext('2d'); c.drawImage(bmp, 0, 0);
    const im = c.getImageData(0, 0, bmp.width, bmp.height).data, data = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = im[i * 4 + 3] > 127 && (im[i * 4] + im[i * 4 + 1] + im[i * 4 + 2]) / 3 < 128 ? 1 : 0;
    return CF.fromSheet(data, bmp.width, bmp.height, { name });
  }
  $('builtin').onchange = () => setFont(CF.parse(b64ToBuf(window.CRAFT_FONTS[$('builtin').value])));

  async function openBytesLegacy(bytes, name) {
    const buf = Buffer.from(bytes), magic = buf.toString('latin1', 0, 4);
    if (buf[0] === 0x89 && magic.slice(1) === 'PNG') { const f = await sheetFromPng(bytes, name.replace(/\.[^.]+$/, '')); setFont(f); return toast('PNG sheet imported as ' + CF.SIZES[f.adv].label); }
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return openBytes(new Uint8Array(raw), name.replace(/\.gz$/i, ''));
    }
    if (magic === 'ACF2') return setFont(CF.parse(buf));
    if (magic === 'ACF1') {
      const sizes = CF.acf1Sizes(buf);
      let idx = 0;
      if (sizes.length > 1) idx = Math.max(0, Math.min(sizes.length - 1, parseInt(prompt('This legacy .acf has ' + sizes.length + ' sizes:\n' + sizes.map((s, i) => i + ': ' + s.W + 'x' + s.H).join('\n') + '\nUse which?', '0'), 10) || 0));
      const f = CF.fromAcf1(buf, idx); f.name = name; return setFont(f);
    }
    throw new Error('unrecognised font file (' + name + ')');
  }

  // ---- import through the shared pipeline (XCW.FontPipe, tools/fontpipe.cjs) ---------------------------------------------------
  const baseOf = (n) => String(n).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const sizeWanted = () => (+$('ttfadv').value !== 12 ? +$('ttfadv').value : 0);
  function ttfOpts(name) {
    return { name: baseOf(name).slice(0, 40), threshold: +$('ttfth').value, weight: +$('ttfw').value, hint: $('ttfh').checked, baseline: +$('ttfbl').value || 0, noGrid: !$('ttfnative').checked, direct: $('ttfdirect').checked };
  }
  // the whole family at its sizes, one row of sample text per size
  function drawImpPreview(fam) {
    const cv = $('impprev'), c = cv.getContext('2d'), z = 2, text = 'Hamburgefonstiv, gypsy jug: 0123 ABC xyz', sizes = Object.keys(fam.sizes).map(Number).sort((a, b) => b - a);
    const adv = (f, code) => f.advs[f.map[code]] || f.adv;
    const W = Math.max(...sizes.map((s) => [...text].reduce((n, ch) => n + adv(fam.sizes[s], ch.charCodeAt(0)), 0))) + 8;
    cv.width = W * z; cv.height = sizes.reduce((h, s) => h + fam.sizes[s].rows + 3, 4) * z;
    c.fillStyle = '#f6f3ea'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#16181c';
    let y = 2;
    for (const s of sizes) {
      const f = fam.sizes[s]; let x = 4;
      for (const ch of text) { const code = ch.charCodeAt(0), g = CF.glyph(f, code); for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, g[r] || 0, q)) c.fillRect((x + q) * z, (y + r) * z, z, z); x += adv(f, code); }
      y += f.rows + 3;
    }
  }
  function showImport(r, name) {
    $('imp').hidden = false; $('impname').textContent = name;
    const i = r.info || {};
    $('impinfo').textContent = (i.pixel ? ' - pixel-grid font, sampled natively as 8x8 (grid ' + i.pixel + ' units)' : ' - outline font scaled to the cell') + ', sizes ' + Object.keys(r.fam.sizes).join(', ') + ' px, ' + (i.glyphs || '?') + ' glyphs' + (i.warnings && i.warnings.length ? '; ' + i.warnings.join('; ') : '');
    drawImpPreview(r.fam);
  }
  function convertTtf(bytes, name) {
    st.src = { bytes, name };
    const r = XCW.FontPipe.load(bytes, name, ttfOpts(name));
    const want = +$('ttfadv').value, f = r.fam.sizes[want] || r.fam.sizes[r.fam.master];
    setFont(f, r.fam); showImport(r, name); keepFamily();
    toast('Converted ' + name + ' through the pipeline: ' + Object.keys(r.fam.sizes).join(', ') + ' px; change a setting to convert again');
  }
  for (const id of ['ttfadv', 'ttfth', 'ttfw', 'ttfh', 'ttfbl', 'ttfnative', 'ttfdirect']) $(id).addEventListener('change', () => { if (st.src && !$('imp').hidden) convertTtf(st.src.bytes, st.src.name); });
  $('impkeep').onclick = () => { $('imp').hidden = true; st.src = null; };

  async function openBytes(bytes, name) {
    const buf = Buffer.from(bytes), FP = XCW.FontPipe, kind = FP.detect(bytes, name);
    if (buf[0] === 0x1f && buf[1] === 0x8b || (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG')) return openBytesLegacy(bytes, name);
    const acfm = (kind === 'bdf' && /ACFM/.test(buf.toString('latin1', 0, 4096))) || (kind === 'ttf' && buf.toString('latin1', 0, 600).includes('ACFM'));
    if ((kind === 'ttf' || kind === 'woff' || kind === 'woff2') && !acfm) return convertTtf(bytes, name);
    st.src = null; $('imp').hidden = true;
    if (kind === 'rom-nocharset') throw new Error('this ROM image has no Atari character set at the standard location');
    if (['xcf', 'rom', 'fnt', 'bdf', 'pcf', 'family', 'ttf'].includes(kind)) {
      const r = FP.load(bytes, name, { name: baseOf(name).slice(0, 40), size: sizeWanted() });
      const f = r.fam.sizes[r.fam.master];
      setFont(f, r.fam); keepFamily();
      const what = { rom: 'Atari ROM charset (8x8, screen-code order)', fnt: 'Atari charset (.fnt, 8x8, screen-code order)' }[kind] || kind.toUpperCase();
      return toast(what + ' imported (pipeline): ' + Object.keys(r.fam.sizes).join(', ') + ' px');
    }
    if (kind === 'json') { const f = CF.fromJson(buf.toString('utf8')); return setFont(f); }
    return openBytesLegacy(bytes, name);
  }

  // ---- My fonts: imported families persist in this browser (localStorage craft.myfonts) --------------------------------------
  const MY = 'craft.myfonts';
  const myFonts = () => { try { return JSON.parse(localStorage.getItem(MY) || '{}'); } catch (e) { return {}; } };
  function keepFamily(quiet) {
    try {
      const fam = st.fam || CF.familyNew(st.f), name = (fam.name || st.f.name || 'font').slice(0, 40), m = myFonts();
      m[name] = XCW.FontPipe.toXcf(fam, {});
      localStorage.setItem(MY, JSON.stringify(m)); fillMy(); return name;
    } catch (e) { if (!quiet) toast('Could not keep the font in this browser: ' + e.message); return null; }
  }
  $('bkeep').onclick = () => { const n = keepFamily(); if (n) toast('"' + n + '" is in My fonts (library list, this browser)'); };
  function fillMy() {
    const sel = $('flist'); let og = sel.querySelector('optgroup[data-my]');
    const m = myFonts(), names = Object.keys(m);
    if (!names.length) { if (og) og.remove(); return; }
    if (!og) { og = document.createElement('optgroup'); og.dataset.my = '1'; og.label = 'My fonts (this browser)'; const a = sel.querySelector('optgroup[data-acw]'); (a || sel.options[0]).after(og); }
    og.innerHTML = '';
    for (const n of names.sort()) { const o = document.createElement('option'); o.value = 'my:' + n; o.textContent = n; og.appendChild(o); }
  }

  // ---- ACWriter / Craft fonts: the faces ACWriter and xCWriter really use (tools/acwfaces.cjs) -----------------------------------
  const acwFaces = () => window.ACW_FACES || [];
  st.acw = new Map();
  function openAcw(id) {
    const meta = acwFaces().find((x) => x.id === id); if (!meta) throw new Error('unknown ACWriter face ' + id);
    st.src = null; $('imp').hidden = true; st.acw = new Map();
    if (id === 'zfont') { const f = CF.parse(b64ToBuf(meta.acf)); st.acw.set(f, id); st.fam = null; return setFont(f); }
    const fam = { format: 'craft-family', version: 1, name: 'ACWriter Craft faces', master: 12, sizes: {} };
    for (const x of acwFaces()) {
      if (x.id === 'zfont') continue;
      const f = CF.parse(b64ToBuf(x.acf)); f.origin = x.adv === 12 ? CF.ORIGIN.master : CF.ORIGIN.hand; f.masterAdv = x.adv === 12 ? 0 : 12;
      fam.sizes[x.adv] = f; st.acw.set(f, x.id);
    }
    setFont(fam.sizes[meta.adv], fam);
  }
  function fillAcw() {
    const sel = $('flist'), og = document.createElement('optgroup'); og.dataset.acw = '1'; og.label = 'ACWriter / Craft fonts';
    for (const x of acwFaces()) { const o = document.createElement('option'); o.value = 'acw:' + x.id; o.textContent = x.label + (x.override ? ' (edited)' : ''); og.appendChild(o); }
    sel.options[0].after(og);
  }
  function updateAcwBar() {
    const bar = $('acwbar'), id = st.acw && st.acw.get(st.f), m = acwFaces().find((x) => x.id === id);
    if (!m) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<b>ACWriter face ' + m.id + '</b><span>' + m.used + '</span><span style="color:var(--dim)">source: ' + m.src + '</span>' +
      '<button id="bacwsave" title="Write this face back to its source (needs node scripts/fontedit-server.cjs; otherwise downloads the file to put in font/overrides/)">Save to ACWriter source</button>' +
      '<button id="bacwreset" title="Remove the edit; the face is built from its source again (needs the local server)">Reset to built face</button>';
    $('bacwsave').onclick = saveAcw; $('bacwreset').onclick = resetAcw;
  }
  async function saveAcw() {
    const id = st.acw.get(st.f), m = acwFaces().find((x) => x.id === id), acf = exportAcf();
    let r;
    try { r = await (await fetch('/__acwface/' + id, { method: 'POST', body: acf })).json(); } catch (e) { r = { ok: false, msg: e.message }; }
    if (r.ok) { m.acf = Buffer.from(acf).toString('base64'); m.override = true; toast('Saved ' + id + ' to ' + r.where + '. Rebuild ACWriter (mkcraftfonts / mkzoomfont) to use it'); return { ok: true, where: r.where }; }
    download(id + '.acf', acf); toast('No write-back server (' + r.msg + '): downloaded ' + id + '.acf - put it in font/overrides/ (or run node scripts/fontedit-server.cjs)');
    return { ok: false, downloaded: true, msg: r.msg, size: acf.length };
  }
  async function resetAcw() {
    const id = st.acw.get(st.f);
    try { const r = await (await fetch('/__acwface/' + id, { method: 'DELETE' })).json(); if (!r.ok) throw new Error(r.msg); } catch (e) { toast('Reset needs the local server: ' + e.message); return { ok: false }; }
    const mod = await (await fetch('js/fontedit/acw-faces.js', { cache: 'no-store' })).text(); // refreshed list
    const faces = JSON.parse(mod.replace(/^[^]*?window\.ACW_FACES = /, '').replace(/;\s*$/, ''));
    window.ACW_FACES = faces; openAcw(id); toast(id + ' is built from its source again'); return { ok: true };
  }

  // ---- Atari charset view: the 8x8 glyphs in ROM order (screen code) or ATASCII, normal and inverse -------------------------------
  const atari8 = () => (st.f.adv === 8 ? st.f : st.fam && st.fam.sizes[8]);
  const atCv = $('atcv'), atX = atCv.getContext('2d'), AZ = 2;
  const atCode = (i) => ($('atlay').value === 'screen' ? (i < 64 ? i + 32 : i < 96 ? i - 64 : i) : i); // screen code index -> ATASCII code
  function drawAtari() {
    const f = atari8(), halves = $('atinv').checked ? 2 : 1;
    atCv.width = 16 * 10 * AZ * halves + (halves - 1) * 8 * AZ; atCv.height = 8 * 10 * AZ;
    atX.fillStyle = '#101216'; atX.fillRect(0, 0, atCv.width, atCv.height);
    $('atinfo').textContent = f ? (f === st.f ? '' : 'using the 8x8 size of this family') : 'no 8x8 size in this font: derive it first';
    if (!f) return;
    for (let h = 0; h < halves; h++) for (let i = 0; i < 128; i++) {
      const code = $('atlay').value === 'screen' ? atCode(i) : i, g = f.glyphs[f.map[code]] || [];
      const x0 = h * (16 * 10 + 8) * AZ + (i % 16) * 10 * AZ, y0 = ((i / 16) | 0) * 10 * AZ;
      if (h) { atX.fillStyle = '#e8eaee'; atX.fillRect(x0, y0, 10 * AZ, 10 * AZ); }
      atX.fillStyle = h ? '#101216' : '#e8eaee';
      for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) if (CF.hasPx(f, g[f.head + r] || 0, q)) atX.fillRect(x0 + (1 + q) * AZ, y0 + (1 + r) * AZ, AZ, AZ);
      if (f === st.f && f.map[code] === st.slot) { atX.strokeStyle = '#ff9d3a'; atX.lineWidth = 2; atX.strokeRect(x0 + 1, y0 + 1, 10 * AZ - 2, 10 * AZ - 2); }
    }
  }
  hooks.push(drawAtari);
  $('atlay').onchange = $('atinv').onchange = drawAtari;
  atCv.addEventListener('mousedown', (e) => {
    const f = atari8(); if (!f) return;
    const r = atCv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * atCv.width, y = ((e.clientY - r.top) / r.height) * atCv.height;
    const half = $('atinv').checked && x >= (16 * 10 + 8) * AZ ? 1 : 0, col = Math.floor((x - half * (16 * 10 + 8) * AZ) / (10 * AZ)), row = Math.floor(y / (10 * AZ));
    const i = row * 16 + col; if (col < 0 || col > 15 || i < 0 || i > 127) return;
    if (f !== st.f) setFont(f, st.fam);
    st.slot = st.f.map[$('atlay').value === 'screen' ? atCode(i) : i]; renderAll();
  });
  $('brom').onclick = async () => {
    try { const r = await fetch('library/fonts/local/atarirom.fnt'); if (!r.ok) throw new Error('HTTP ' + r.status); await openBytes(new Uint8Array(await r.arrayBuffer()), 'Atari ROM charset.fnt'); }
    catch (e) { toast('ROM charset not found in the library (' + e.message + '): choose ATARIXL.ROM or a .fnt file'); $('file').click(); }
  };

  // Font library (manifest from scripts/fontlist.cjs); personal fonts only exist on this machine.
  async function loadLibrary() {
    const sel = $('flist');
    fillAcw(); fillMy();
    let man;
    try { man = await (await fetch('library/fonts/local/manifest.json', { cache: 'no-store' })).json(); } catch (e) { sel.options[0].textContent = 'Font library (run node scripts/fontlist.cjs)'; return; }
    for (const g of man.groups) {
      const og = document.createElement('optgroup'); og.label = g.label + (g.fonts.length ? '' : ' (none)'); sel.appendChild(og);
      for (const f of g.fonts) { const o = document.createElement('option'); o.value = f.url; o.textContent = f.name; og.appendChild(o); }
    }
  }
  $('flist').onchange = async () => {
    const url = $('flist').value; if (!url) return;
    try {
      if (url.startsWith('acw:')) openAcw(url.slice(4));
      else if (url.startsWith('my:')) { const x = myFonts()[url.slice(3)]; await openBytes(new TextEncoder().encode(x), url.slice(3) + '.xcf'); }
      else { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); await openBytes(new Uint8Array(await r.arrayBuffer()), url.split('/').pop()); }
    } catch (e) { toast('Cannot open: ' + e.message); }
    $('flist').value = '';
  };
  loadLibrary();
  $('file').onchange = async () => {
    const f = $('file').files[0]; if (!f) return;
    try { await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { toast('Cannot open: ' + e.message); }
    $('file').value = '';
  };

  window.FE = { hooks, fname, sendToAcwriter, useInXcwriter, acwriterFile, toast, state: st, setFont, openBytes, openAcw, saveAcw, resetAcw, keepFamily, myFonts, exportAcf, render: renderAll, CF, select: (s) => { st.slot = s; renderAll(); } };
  setFont(CF.parse(b64ToBuf(window.CRAFT_FONTS.craft6)));
})();
