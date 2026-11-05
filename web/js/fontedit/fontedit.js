// Craft Font Editor (web/fontedit.html). Uses XCW.Font (tools/craftfont.cjs, docs/FONT.md); no build step.
(() => {
  'use strict';
  const CF = XCW.Font, $ = (id) => document.getElementById(id);
  const M = CF.METRICS;
  const COL = { head: '#4a78c8', cap: '#e8b030', xh: '#58c878', base: '#e05555', desc: '#9a6ad0' };
  const st = { f: null, slot: 65, tgt: 0, clip: null, undo: [], down: 0 };

  const b64ToBuf = (s) => Buffer.from(s, 'base64');
  const bufToB64 = (b) => Buffer.from(b).toString('base64');
  const toast = (m) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2400); };

  function setFont(f) {
    st.f = f; st.undo = [];
    st.slot = f.map[65] === undefined ? 65 : f.map[65];
    $('name').value = f.name; $('supup').value = f.supUp; $('subdn').value = f.subDown;
    $('upslot').value = f.map[65]; $('lowslot').value = f.map[97];
    sizeCanvases(); renderAll();
  }

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
  const pushUndo = () => { st.undo.push(JSON.stringify([st.slot, st.tgt, target(false)])); if (st.undo.length > 100) st.undo.shift(); };

  // ---- drawing -----------------------------------------------------------------------------------------------
  const grid = $('grid'), gx = grid.getContext('2d'), ed = $('edit'), ex = ed.getContext('2d'), pv = $('preview'), px = pv.getContext('2d');
  const GS = 2;
  const cell = () => ({ w: (st.f.adv + 2) * GS, h: (st.f.rows + 2) * GS });
  const ES = 24;

  function sizeCanvases() {
    const c = cell(), f = st.f;
    grid.width = c.w * 16; grid.height = c.h * 16;
    ed.width = f.gw * ES; ed.height = f.rows * ES;
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
      if (g) for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (g[r] & (0x80 >> q)) gx.fillRect(x0 + GS + q * GS, y0 + GS + r * GS, GS, GS);
      if (s === st.slot) { gx.strokeStyle = '#ff9d3a'; gx.lineWidth = 2; gx.strokeRect(x0 + 1, y0 + 1, c.w - 2, c.h - 2); }
    }
  }

  function drawEdit() {
    const f = st.f, g = target(false);
    ex.fillStyle = '#0f1115'; ex.fillRect(0, 0, ed.width, ed.height);
    ex.fillStyle = COL.head + '44'; ex.fillRect(0, 0, ed.width, f.head * ES);
    ex.fillStyle = COL.desc + '44'; ex.fillRect(0, (f.base + 1) * ES, ed.width, (f.rows - f.base - 1) * ES);
    ex.strokeStyle = '#ffffff12'; ex.lineWidth = 1;
    for (let q = 0; q <= f.gw; q++) { ex.beginPath(); ex.moveTo(q * ES + .5, 0); ex.lineTo(q * ES + .5, ed.height); ex.stroke(); }
    for (let r = 0; r <= f.rows; r++) { ex.beginPath(); ex.moveTo(0, r * ES + .5); ex.lineTo(ed.width, r * ES + .5); ex.stroke(); }
    ex.fillStyle = '#f2f4f8';
    for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (g[r] & (0x80 >> q)) ex.fillRect(q * ES + 1, r * ES + 1, ES - 1, ES - 1);
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
    const W = Math.max(8, ...cells.map((c) => c.length)) * f.adv + 8, lh = f.rows + lead, H = cells.length * lh + 8;
    pv.width = W * z; pv.height = H * z;
    px.fillStyle = '#f6f3ea'; px.fillRect(0, 0, pv.width, pv.height);
    cells.forEach((ln, li) => {
      const y0 = 4 + li * lh;
      if ($('pvg').checked) {
        for (const [k, col] of [[f.head, COL.cap], [f.xTop, COL.xh], [f.base + 1, COL.base], [f.head - 0, null]]) if (col) { px.fillStyle = col + '77'; px.fillRect(0, (y0 + k) * z, pv.width, 1); }
      }
      px.fillStyle = '#16181c';
      ln.forEach(([code, mode], i) => {
        const g = CF.render(f, code, mode);
        for (let r = 0; r < f.rows; r++) if (g[r]) for (let q = 0; q < f.gw; q++) if (g[r] & (0x80 >> q)) px.fillRect((4 + i * f.adv + q) * z, (y0 + r) * z, z, z);
      });
    });
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
    const q = Math.floor(((e.clientX - r.left) / r.width) * f.gw), y = Math.floor(((e.clientY - r.top) / r.height) * f.rows);
    if (q < 0 || y < 0 || q >= f.gw || y >= f.rows) return;
    const g = target(true), bit = 0x80 >> q;
    if (val === undefined) val = (g[y] & bit) ? 0 : 1; // first click decides draw / erase for the drag
    if (!!(g[y] & bit) === !!val) return val;
    g[y] = val ? g[y] | bit : g[y] & ~bit;
    drawEdit(); drawGrid(); drawPreview();
    return val;
  }
  ed.addEventListener('mousedown', (e) => { pushUndo(); st.down = 1; st.dragVal = paint(e); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => { if (st.down) paint(e, st.dragVal); });
  window.addEventListener('mouseup', () => { st.down = 0; });
  ed.addEventListener('contextmenu', (e) => e.preventDefault());

  const edit = (fn) => { pushUndo(); const g = target(true), n = fn(g.slice()); for (let i = 0; i < g.length; i++) g[i] = n[i]; renderAll(); };
  const mask = () => (0xff << (8 - st.f.gw)) & 0xff;
  $('up').onclick = () => edit((g) => g.slice(1).concat([0]));
  $('down').onclick = () => edit((g) => [0].concat(g.slice(0, -1)));
  $('left').onclick = () => edit((g) => g.map((b) => (b << 1) & mask()));
  $('right').onclick = () => edit((g) => g.map((b) => (b >> 1) & mask()));
  $('clr').onclick = () => edit((g) => g.map(() => 0));
  $('inv').onclick = () => edit((g) => g.map((b) => ~b & mask()));
  $('mir').onclick = () => edit((g) => g.map((b) => { let o = 0; for (let q = 0; q < st.f.gw; q++) if (b & (0x80 >> q)) o |= 0x80 >> (st.f.gw - 1 - q); return o; }));
  $('cpy').onclick = () => { st.clip = target(false).slice(); toast('Glyph copied'); };
  $('pst').onclick = () => { if (st.clip) edit(() => st.clip.slice()); };
  $('undo').onclick = () => {
    const u = st.undo.pop(); if (!u) return;
    const [slot, tgt, rows] = JSON.parse(u); st.slot = slot; st.tgt = tgt;
    const g = target(true); for (let i = 0; i < g.length; i++) g[i] = rows[i];
    document.querySelectorAll('.tgt').forEach((b) => b.classList.toggle('on', +b.dataset.t === st.tgt));
    renderAll();
  };
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement.tagName !== 'TEXTAREA') { $('undo').click(); e.preventDefault(); } });
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
  for (const id of ['sample', 'pvz', 'pvg', 'lead']) $(id).addEventListener('input', drawPreview);

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
  $('builtin').onchange = () => setFont(CF.parse(b64ToBuf(window.CRAFT_FONTS[$('builtin').value])));

  async function openBytes(bytes, name) {
    const buf = Buffer.from(bytes), magic = buf.toString('latin1', 0, 4);
    if (magic === 'ACF2') return setFont(CF.parse(buf));
    if (magic === 'ACF1') {
      const sizes = CF.acf1Sizes(buf);
      let idx = 0;
      if (sizes.length > 1) idx = Math.max(0, Math.min(sizes.length - 1, parseInt(prompt('This legacy .acf has ' + sizes.length + ' sizes:\n' + sizes.map((s, i) => i + ': ' + s.W + 'x' + s.H).join('\n') + '\nUse which?', '0'), 10) || 0));
      const f = CF.fromAcf1(buf, idx); f.name = name; return setFont(f);
    }
    if (buf[0] === 0x7b) return setFont(CF.fromJson(buf.toString('utf8')));
    const isSfnt = buf.length > 4 && (buf.readUInt32BE(0) === 0x00010000 || ['OTTO', 'true', 'wOFF', 'wOF2'].includes(magic));
    if (!isSfnt && (buf.length === 1024 || buf.length === 2048 || /\.fnt$/i.test(name))) {
      const f = CF.fromFnt(buf, { name: name.replace(/\.[^.]+$/, '') }); setFont(f); return toast('Atari charset imported as 8 px; 8x8 glyphs, descender rows used by g j p q y');
    }
    const f = await CF.rasterTtf(buf.toString('base64'), { adv: +$('ttfadv').value, name: name.replace(/\.[^.]+$/, '').slice(0, 40) });
    setFont(f); toast('TTF converted to ' + f.adv + ' px; tune the glyphs, then save');
  }

  // Font library (manifest from scripts/fontlist.cjs); personal fonts only exist on this machine.
  async function loadLibrary() {
    const sel = $('flist');
    let man;
    try { man = await (await fetch('library/fonts/local/manifest.json', { cache: 'no-store' })).json(); } catch (e) { sel.options[0].textContent = 'Font library (run node scripts/fontlist.cjs)'; return; }
    for (const g of man.groups) {
      const og = document.createElement('optgroup'); og.label = g.label + (g.fonts.length ? '' : ' (none)'); sel.appendChild(og);
      for (const f of g.fonts) { const o = document.createElement('option'); o.value = f.url; o.textContent = f.name; og.appendChild(o); }
    }
  }
  $('flist').onchange = async () => {
    const url = $('flist').value; if (!url) return;
    try { const r = await fetch(url); await openBytes(new Uint8Array(await r.arrayBuffer()), url.split('/').pop()); } catch (e) { toast('Cannot open: ' + e.message); }
    $('flist').value = '';
  };
  loadLibrary();
  $('file').onchange = async () => {
    const f = $('file').files[0]; if (!f) return;
    try { await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { toast('Cannot open: ' + e.message); }
    $('file').value = '';
  };

  window.FE = { state: st, setFont, openBytes, exportAcf, render: renderAll, CF, select: (s) => { st.slot = s; renderAll(); } };
  setFont(CF.parse(b64ToBuf(window.CRAFT_FONTS.craft6)));
})();
