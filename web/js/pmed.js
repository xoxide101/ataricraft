// Workbench PMG tab: edit the four players and four missiles, preview with sizes, priority and overlap colours, export asm data or JSON.
(function () {
  const root = document.getElementById('pmg'); if (!root) return;
  const $ = (id) => document.getElementById(id), pal = AC.buildPalette('ntsc', {}), CELL = 12;
  const rgb = (c) => { const v = pal[c & 254]; return `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`; };
  const blankRows = (h, w) => Array.from({ length: h }, () => '.'.repeat(w));
  const fresh = () => ({ kind: 'pmg', height: 24, res: 2, multi: false, colors: [0x9A, 0x0E, 0x2A, 0x9C], missiles: 'player', size: [1, 1, 1, 1], msize: [1, 1, 1, 1], x: [60, 60, 110, 110, 160, 168, 176, 184],
    players: [0, 1, 2, 3].map(() => blankRows(24, 8)), miss: [0, 1, 2, 3].map(() => blankRows(24, 2)) });
  let d = fresh(), sel = 'p0', undo = [];
  try { const s = localStorage.getItem('ac_pmg'); if (s) d = check(JSON.parse(s)); } catch (e) { d = fresh(); }

  function check(o) {
    if (!o || typeof o !== 'object' || o.kind !== 'pmg') throw new Error('Not a player-missile file');
    const h = Number(o.height); if (!Number.isInteger(h) || h < 1 || h > 128) throw new Error('height must be a whole number from 1 to 128');
    const grid = (a, w) => { if (!Array.isArray(a) || a.length !== 4) throw new Error('Need 4 players and 4 missiles'); return a.map((rows) => { if (!Array.isArray(rows) || rows.length !== h || rows.some((r) => typeof r !== 'string' || r.length !== w || /[^.#]/.test(r))) throw new Error(`Each shape must be ${h} rows of ${w} characters from . and #`); return rows.slice(); }); };
    const nums = (a, n, lo, hi, def) => Array.from({ length: n }, (_, i) => { const v = Math.round(Number(a && a[i])); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; });
    const sz = (a) => nums(a, 4, 1, 4, 1).map((v) => (v === 3 ? 4 : v));
    return { kind: 'pmg', height: h, res: o.res === 1 ? 1 : 2, multi: !!o.multi, colors: nums(o.colors, 4, 0, 255, 0), missiles: o.missiles === 'fifth' ? 'fifth' : 'player',
      size: sz(o.size), msize: sz(o.msize), x: nums(o.x, 8, 0, 255, 100), players: grid(o.players, 8), miss: grid(o.miss, 2) };
  }

  root.innerHTML = `<div class="drop" id="dpm">Drop a player-missile .json here, or <button class="b" id="pmload">choose one</button></div>
  <div class="row" id="pmsel"></div>
  <div class="row"><label>Height <input type="number" id="pmh" min="1" max="128" style="width:56px"></label>
    <label>Resolution <select id="pmres"><option value="2">Single line (256 bytes/player)</option><option value="1">Double line (128 bytes/player)</option></select></label>
    <label>Colour <input type="text" id="pmcol" style="width:48px"></label>
    <label>Width <select id="pmsize"><option value="1">x1</option><option value="2">x2</option><option value="4">x4</option></select></label>
    <label>X <input type="number" id="pmx" min="0" max="255" style="width:56px"></label>
    <label><input type="checkbox" id="pmmulti"> Multicolour (P0+P1, P2+P3 overlap = OR of colours)</label>
    <label><input type="checkbox" id="pmfifth"> Missiles as 5th player</label></div>
  <div class="row"><button class="b" id="pmundo">Undo</button><button class="b" id="pmclear">Clear</button><button class="b" id="pmfh">Flip H</button><button class="b" id="pmfv">Flip V</button>
    <button class="b" id="pmup">Shift up</button><button class="b" id="pmdn">Shift down</button><button class="b" id="pmcopy">Copy to next</button></div>
  <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap"><div style="overflow:auto;max-height:520px;border:1px solid #3a4150"><canvas id="pmcv" style="cursor:crosshair"></canvas></div>
    <div><canvas id="pmpv" width="360" height="300" style="background:#000;border:1px solid #3a4150"></canvas><br><small>Preview: pixels are colour clocks. Left click paints, right click erases.</small></div></div>
  <div class="row"><button class="b" id="pmsave">Save JSON</button><button class="b" id="pmasm">Export asm data</button></div><pre id="pmout"></pre>`;

  const ids = ['p0', 'p1', 'p2', 'p3', 'm0', 'm1', 'm2', 'm3'];
  $('pmsel').innerHTML = ids.map((i) => `<button class="b" data-s="${i}">${i[0] === 'p' ? 'Player ' : 'Missile '}${i[1]}</button>`).join('');
  const say = (m, e) => { $('pmout').textContent = m; $('pmout').className = e ? 'err' : ''; };
  const idx = () => +sel[1], isP = () => sel[0] === 'p', shape = () => (isP() ? d.players : d.miss)[idx()];
  const cols = () => (isP() ? 8 : 2), slot = () => (isP() ? idx() : 4 + idx());
  const snap = () => { undo.push(JSON.stringify(d)); if (undo.length > 100) undo.shift(); };
  const store = () => { try { localStorage.setItem('ac_pmg', JSON.stringify(d)); } catch (e) { /* ignore */ } };
  const setRow = (r, c, ch) => { const s = shape(); if (s[r][c] === ch) return false; s[r] = s[r].slice(0, c) + ch + s[r].slice(c + 1); return true; };

  function draw() {
    const cv = $('pmcv'), w = cols(); cv.width = w * CELL; cv.height = d.height * CELL; const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    const color = rgb(d.colors[isP() || d.missiles === 'player' ? idx() : 3]), s = shape();
    for (let r = 0; r < d.height; r++) for (let c = 0; c < w; c++) { g.fillStyle = s[r][c] === '#' ? color : (r + c) % 2 ? '#15181d' : '#1a1e24'; g.fillRect(c * CELL, r * CELL, CELL, CELL); }
    preview(); store();
  }
  function preview() {
    const cv = $('pmpv'), g = cv.getContext('2d'), PX = 2, py = d.res === 2 ? 1 : 2, H = d.height * py;
    g.fillStyle = '#10131a'; g.fillRect(0, 0, cv.width, cv.height);
    const off = 20, buf = new Map(), put = (xp, r, c, col, slotn) => {
      const key = xp + ',' + r, prev = buf.get(key);
      if (prev && d.multi && Math.floor(prev.slot / 2) === Math.floor(slotn / 2) && prev.slot !== slotn) buf.set(key, { col: prev.col | col, slot: Math.min(prev.slot, slotn) });
      else if (!prev || slotn < prev.slot) buf.set(key, { col, slot: slotn });
    };
    for (let i = 0; i < 4; i++) for (let r = 0; r < d.height; r++) for (let c = 0; c < 8; c++) if (d.players[i][r][c] === '#') for (let k = 0; k < d.size[i]; k++) put(d.x[i] + c * d.size[i] + k, r, 0, d.colors[i], i);
    for (let i = 0; i < 4; i++) for (let r = 0; r < d.height; r++) for (let c = 0; c < 2; c++) if (d.miss[i][r][c] === '#') for (let k = 0; k < d.msize[i]; k++) put(d.x[4 + i] + c * d.msize[i] + k, r, 0, d.colors[d.missiles === 'fifth' ? 3 : i], 4 + i);
    for (const [key, v] of buf) { const [xp, r] = key.split(',').map(Number); g.fillStyle = rgb(v.col); g.fillRect(off + xp * PX - 100, off + r * py, PX, py); }
    g.fillStyle = '#3a4150'; g.fillRect(off - 2, off - 2, 1, H + 4);
  }

  function fillUi() {
    root.querySelectorAll('[data-s]').forEach((b) => { b.style.outline = b.dataset.s === sel ? '2px solid #ff9d3a' : ''; });
    $('pmh').value = d.height; $('pmres').value = d.res; $('pmmulti').checked = d.multi; $('pmfifth').checked = d.missiles === 'fifth';
    $('pmcol').value = '$' + d.colors[isP() || d.missiles === 'player' ? idx() : 3].toString(16).toUpperCase().padStart(2, '0');
    $('pmsize').value = (isP() ? d.size : d.msize)[idx()]; $('pmx').value = d.x[slot()];
    draw();
  }
  root.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { sel = b.dataset.s; fillUi(); }));

  let paint = null;
  const at = (e) => { const b = $('pmcv').getBoundingClientRect(); return { r: Math.floor((e.clientY - b.top) / CELL), c: Math.floor((e.clientX - b.left) / CELL) }; };
  const hit = (e) => { const { r, c } = at(e); if (r < 0 || c < 0 || r >= d.height || c >= cols()) return; if (setRow(r, c, paint)) draw(); };
  $('pmcv').oncontextmenu = (e) => e.preventDefault();
  $('pmcv').onmousedown = (e) => { e.preventDefault(); snap(); paint = e.button === 2 ? '.' : '#'; hit(e); };
  window.addEventListener('mousemove', (e) => { if (paint) hit(e); });
  window.addEventListener('mouseup', () => { paint = null; });

  const edit = (fn) => { snap(); fn(); fillUi(); };
  $('pmundo').onclick = () => { if (undo.length) { d = JSON.parse(undo.pop()); fillUi(); } };
  $('pmclear').onclick = () => edit(() => { (isP() ? d.players : d.miss)[idx()] = blankRows(d.height, cols()); });
  $('pmfh').onclick = () => edit(() => { const a = isP() ? d.players : d.miss; a[idx()] = a[idx()].map((r) => [...r].reverse().join('')); });
  $('pmfv').onclick = () => edit(() => { const a = isP() ? d.players : d.miss; a[idx()] = a[idx()].slice().reverse(); });
  $('pmup').onclick = () => edit(() => { const a = isP() ? d.players : d.miss; a[idx()] = [...a[idx()].slice(1), '.'.repeat(cols())]; });
  $('pmdn').onclick = () => edit(() => { const a = isP() ? d.players : d.miss; a[idx()] = ['.'.repeat(cols()), ...a[idx()].slice(0, -1)]; });
  $('pmcopy').onclick = () => edit(() => { const a = isP() ? d.players : d.miss, n = (idx() + 1) % 4; a[n] = a[idx()].slice(); sel = sel[0] + n; });
  $('pmh').onchange = () => edit(() => {
    const h = Math.max(1, Math.min(128, Math.round(+$('pmh').value) || d.height));
    for (const [a, w] of [[d.players, 8], [d.miss, 2]]) for (let i = 0; i < 4; i++) { while (a[i].length < h) a[i].push('.'.repeat(w)); a[i].length = h; }
    d.height = h;
  });
  $('pmres').onchange = () => { d.res = +$('pmres').value; fillUi(); };
  $('pmmulti').onchange = () => { d.multi = $('pmmulti').checked; fillUi(); };
  $('pmfifth').onchange = () => { d.missiles = $('pmfifth').checked ? 'fifth' : 'player'; fillUi(); };
  $('pmcol').onchange = () => { const v = parseInt($('pmcol').value.replace('$', ''), 16); if (Number.isFinite(v) && v >= 0 && v < 256) d.colors[isP() || d.missiles === 'player' ? idx() : 3] = v; fillUi(); };
  $('pmsize').onchange = () => { (isP() ? d.size : d.msize)[idx()] = +$('pmsize').value; fillUi(); };
  $('pmx').onchange = () => { d.x[slot()] = Math.max(0, Math.min(255, Math.round(+$('pmx').value) || 0)); fillUi(); };

  const bits = (s) => parseInt(s.replace(/#/g, '1').replace(/\./g, '0'), 2);
  const byteRows = (a, h) => Array.from({ length: h }, (_, r) => bits(a[r]));
  function asm() {
    const h = d.height, hx = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0'), out = [`; ${h} lines per shape, ${d.res === 2 ? 'single' : 'double'} line resolution`, `PMHEIGHT = ${h}`];
    for (let i = 0; i < 4; i++) { out.push(`player${i}  ; colour ${hx(d.colors[i])}, width x${d.size[i]}, x ${d.x[i]}`); for (let r = 0; r < h; r += 8) out.push('        .byte ' + byteRows(d.players[i], h).slice(r, r + 8).map(hx).join(',')); }
    out.push(`missiles  ; bits 1-0 = M0, 3-2 = M1, 5-4 = M2, 7-6 = M3; size byte ${hx(d.msize.reduce((a, s, i) => a | ({ 1: 0, 2: 1, 4: 3 }[s] << (2 * i)), 0))}`);
    const m = Array.from({ length: h }, (_, r) => d.miss.reduce((a, rows, i) => a | (bits(rows[r]) << (2 * i)), 0));
    for (let r = 0; r < h; r += 8) out.push('        .byte ' + m.slice(r, r + 8).map(hx).join(','));
    out.push(`sizep   .byte ${d.size.map((s) => hx({ 1: 0, 2: 1, 4: 3 }[s])).join(',')}  ; SIZEP0-3`, `colp    .byte ${d.colors.map(hx).join(',')}  ; COLPM0-3`, `hposp   .byte ${d.x.slice(0, 4).join(',')}  ; HPOSP0-3`, `hposm   .byte ${d.x.slice(4).join(',')}  ; HPOSM0-3`);
    return out.join('\n') + '\n';
  }
  const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('pmsave').onclick = () => dl('pmg.json', JSON.stringify(d, null, 1), 'application/json');
  $('pmasm').onclick = () => { const t = asm(); say(t); dl('pmg.asm', t, 'text/plain'); };
  const read = (f) => f.text().then((t) => { try { d = check(JSON.parse(t)); undo = []; sel = 'p0'; fillUi(); say('Loaded.'); } catch (e) { say('Could not read that file: ' + e.message, 1); } });
  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.json'; fi.onchange = () => { if (fi.files[0]) read(fi.files[0]); fi.value = ''; };
  $('pmload').onclick = () => fi.click();
  $('dpm').ondragover = (e) => e.preventDefault();
  $('dpm').ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
  AC.PmgEd = { get: () => d, asm };
  fillUi();
})();
