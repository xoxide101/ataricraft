// Workbench map editor for games/circuit/assets.json. Shares the loaded file with the Sprites tab (AC.SpriteEd).
// map.rows: 23 hex strings of 256 columns (2 digits each, bit 7 = COLPF3 variant); rows 0-5 far, 6-11 mid, 12-22 near.
(function () {
  const AC = (window.AC = window.AC || {});
  const root = document.getElementById('maped');
  if (!root) return;
  const COLS = 256, CW = 16, CH = 16, BANDS = { far: [0, 6], mid: [6, 12], near: [12, 23] };
  const pal = AC.buildPalette('ntsc', {});
  const rgb = (v) => { const c = pal[parseInt(String(v).replace('$', ''), 16) & 254]; return [c & 255, (c >> 8) & 255, (c >> 16) & 255]; };
  const $ = (id) => document.getElementById(id);

  root.innerHTML = '<div class="row"><small>Load assets.json in the Sprites tab first (the map and tiles live in the same file).</small></div>' +
    '<div class="row"><label>Layer <select id="mpband"><option value="near">near (rows 12-22)</option><option value="mid">mid (rows 6-11)</option><option value="far">far (rows 0-5)</option></select></label>' +
    '<label>Tool <select id="mptool"><option value="paint">Paint</option><option value="rect">Rectangle</option><option value="pick">Pick tile</option></select></label>' +
    '<label><input type="checkbox" id="mpp3"> PF3 colour variant</label><button class="b" id="mpundo">Undo</button>' +
    '<button class="b" id="mpsave">Download assets.json</button></div>' +
    '<div class="row"><canvas id="mppal" style="border:1px solid #3a4150;cursor:pointer"></canvas><small id="mpinfo"></small></div>' +
    '<div style="overflow-x:auto;max-width:100%;border:1px solid #3a4150"><canvas id="mpcv" style="display:block;cursor:crosshair;touch-action:none"></canvas></div>' +
    '<div class="row"><small>Left button paints, right button erases. Rectangle: drag. The layers scroll at 1/4 (far), 1/2 (mid) and full speed (near).</small></div>' +
    '<div class="row"><label>Preview camera <input type="range" id="mpcam" min="0" max="1020" step="4" value="0" style="width:420px"></label><small id="mpcamv"></small></div>' +
    '<canvas id="mppv" style="background:#000;border:1px solid #3a4150;max-width:100%"></canvas>' +
    '<pre id="mpout">Tiles 21 and 22 are the two AND-gate plates (two tiles wide), 20 is the door column, 23 its LED. The build finds them in the map, so they can go anywhere in the near layer.</pre>';

  let rows = null, lastData = null, band = 'near', cur = 11, undo = [], drag = null, cache = new Map();
  const data = () => (AC.SpriteEd && AC.SpriteEd.get && AC.SpriteEd.get()) || null;
  const bandOf = (r) => (r < 6 ? 'far' : r < 12 ? 'mid' : 'near');
  const say = (m, err) => { $('mpout').textContent = m; $('mpout').className = err ? 'err' : ''; };

  function sync() {
    const d = data();
    if (!d || !d.sheets || !d.sheets.tiles) { rows = null; return false; }
    if (!d.map) { d.map = { cols: COLS, note: 'rows 0-5 far, 6-11 mid, 12-22 near; two hex digits per column', rows: Array.from({ length: 23 }, () => '00'.repeat(COLS)) }; }
    if (d !== lastData) {
      lastData = d; undo = [];
      rows = d.map.rows.map((h) => Uint8Array.from({ length: COLS }, (_, c) => parseInt(h.substr(c * 2, 2), 16)));
    }
    return true;
  }
  const store = (r) => { lastData.map.rows[r] = Array.from(rows[r], (v) => v.toString(16).padStart(2, '0')).join(''); };
  const snap = () => { undo.push(lastData.map.rows.slice()); if (undo.length > 100) undo.shift(); };
  const tileList = () => Object.keys(lastData.sheets.tiles.frames).map((k) => [parseInt(k, 10), k]).sort((a, b) => a[0] - b[0]);

  function tileImg(id, flag, b) {
    const key = id + '|' + flag + '|' + b;
    let c = cache.get(key); if (c) return c;
    const t = lastData.sheets.tiles, bd = t.bands[b], name = Object.keys(t.frames).find((k) => parseInt(k, 10) === id);
    c = document.createElement('canvas'); c.width = 4; c.height = 8; const g = c.getContext('2d'), im = g.createImageData(4, 8);
    const cols = { '.': rgb(bd.bk), a: rgb(bd.pf[0]), b: rgb(bd.pf[1]), c: rgb(bd.pf[flag ? 3 : 2]) };
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const ch = name ? t.frames[name][y][x] : '.', v = cols[ch] || cols['.'], o = (y * 4 + x) * 4;
      im.data[o] = v[0]; im.data[o + 1] = v[1]; im.data[o + 2] = v[2]; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0); cache.set(key, c); return c;
  }
  const put = (g, v, x, y, b) => { g.drawImage(tileImg(v & 127, v >> 7, b), x, y, CW, CH); };

  function drawPalette() {
    const l = [[0, '0 empty'], ...tileList()], pc = $('mppal'), g = pc.getContext('2d'), per = 12, S = 40;
    pc.width = per * S; pc.height = Math.ceil(l.length / per) * S; g.imageSmoothingEnabled = false;
    l.forEach(([id], i) => {
      const x = (i % per) * S, y = Math.floor(i / per) * S;
      g.fillStyle = '#111'; g.fillRect(x, y, S, S);
      g.drawImage(tileImg(id, 0, band), x + 4, y + 4, 32, 32);
      if (id === cur) { g.strokeStyle = '#ff9d3a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, S - 2, S - 2); }
    });
    const n = l.find(([id]) => id === cur);
    $('mpinfo').textContent = 'Brush: ' + (n ? n[1] : cur) + ($('mpp3').checked ? ' (PF3)' : '');
  }
  function draw() {
    const [r0, r1] = BANDS[band], cv = $('mpcv'), g = cv.getContext('2d');
    cv.width = COLS * CW; cv.height = (r1 - r0) * CH; g.imageSmoothingEnabled = false;
    for (let r = r0; r < r1; r++) for (let c = 0; c < COLS; c++) put(g, rows[r][c], c * CW, (r - r0) * CH, band);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath();
    for (let c = 0; c <= COLS; c += 8) { g.moveTo(c * CW + .5, 0); g.lineTo(c * CW + .5, cv.height); }
    g.stroke();
    if (drag && drag.rect) { g.strokeStyle = '#ff9d3a'; g.lineWidth = 2; const [a, b] = [Math.min(drag.c0, drag.c1), Math.max(drag.c0, drag.c1)], [x, y] = [Math.min(drag.r0, drag.r1), Math.max(drag.r0, drag.r1)]; g.strokeRect(a * CW + 1, (x - r0) * CH + 1, (b - a + 1) * CW - 2, (y - x + 1) * CH - 2); }
    drawPalette(); preview();
  }
  function preview() {
    const cam = +$('mpcam').value, pv = $('mppv'), g = pv.getContext('2d');
    pv.width = 40 * CW; pv.height = 23 * CH; g.imageSmoothingEnabled = false;
    const off = { far: cam >> 4, mid: (cam >> 1) >> 2, near: cam >> 2 };
    for (let r = 0; r < 23; r++) {
      const b = bandOf(r); g.fillStyle = 'rgb(' + rgb(lastData.sheets.tiles.bands[b].bk) + ')'; g.fillRect(0, r * CH, pv.width, CH);
      for (let c = 0; c < 40; c++) put(g, rows[r][(c + off[b]) % COLS], c * CW, r * CH, b);
    }
    $('mpcamv').textContent = 'camera ' + cam + ' px (far col ' + off.far + ', mid col ' + off.mid + ', near col ' + off.near + ')';
  }
  function refresh() { cache.clear(); if (!sync()) return; draw(); }

  function cell(e) { const r = $('mpcv').getBoundingClientRect(), sc = $('mpcv').width / r.width; return [Math.floor(((e.clientX - r.left) * sc) / CW), BANDS[band][0] + Math.floor(((e.clientY - r.top) * sc) / CH)]; }
  const val = (erase) => (erase ? 0 : cur ? cur | ($('mpp3').checked ? 128 : 0) : 0);
  function setCell(c, r, v) { if (c < 0 || c >= COLS || r < BANDS[band][0] || r >= BANDS[band][1]) return; rows[r][c] = v; }
  const down = (e) => {
    if (!rows) return; e.preventDefault(); const [c, r] = cell(e), tool = e.button === 2 ? 'paint' : $('mptool').value;
    if (c < 0 || c >= COLS || r < BANDS[band][0] || r >= BANDS[band][1]) return;
    if (tool === 'pick') { cur = rows[r][c] & 127; $('mpp3').checked = !!(rows[r][c] & 128); draw(); return; }
    snap(); $('mpcv').setPointerCapture(e.pointerId);
    drag = { erase: e.button === 2, rect: tool === 'rect', c0: c, r0: r, c1: c, r1: r, touched: new Set() };
    if (!drag.rect) { setCell(c, r, val(drag.erase)); drag.touched.add(r); draw(); }
  };
  const move = (e) => {
    if (!drag) return; const [c, r] = cell(e); drag.c1 = c; drag.r1 = r;
    if (!drag.rect) { setCell(c, r, val(drag.erase)); drag.touched.add(r); }
    draw();
  };
  const up = () => {
    if (!drag) return;
    if (drag.rect) for (let r = Math.min(drag.r0, drag.r1); r <= Math.max(drag.r0, drag.r1); r++) for (let c = Math.min(drag.c0, drag.c1); c <= Math.max(drag.c0, drag.c1); c++) setCell(c, r, val(drag.erase));
    for (let r = BANDS[band][0]; r < BANDS[band][1]; r++) store(r);
    drag = null; draw(); report();
  };
  function report() {
    const n = (id) => rows.reduce((s, r) => s + r.filter((v) => (v & 127) === id).length, 0);
    const w = []; if (!n(21)) w.push('no plate A (21)'); if (!n(22)) w.push('no plate B (22)'); if (!n(20)) w.push('no door (20)');
    say(w.length ? 'Warning: ' + w.join(', ') + '. The AND gate will not work.' : 'Gate pieces found: plate A ' + n(21) + ' tiles, plate B ' + n(22) + ', door ' + n(20) + ', LED ' + n(23) + '.', w.length);
  }
  $('mpcv').onpointerdown = down; $('mpcv').onpointermove = move; $('mpcv').onpointerup = up; $('mpcv').oncontextmenu = (e) => e.preventDefault();
  $('mppal').onclick = (e) => {
    if (!rows) return; const r = $('mppal').getBoundingClientRect(), sc = $('mppal').width / r.width, i = Math.floor(((e.clientY - r.top) * sc) / 40) * 12 + Math.floor(((e.clientX - r.left) * sc) / 40);
    const l = [[0], ...tileList()]; if (l[i]) { cur = l[i][0]; drawPalette(); }
  };
  $('mpband').onchange = () => { band = $('mpband').value; cache.clear(); draw(); };
  $('mpp3').onchange = drawPalette; $('mpcam').oninput = preview;
  $('mpundo').onclick = () => {
    if (!rows || !undo.length) return; lastData.map.rows = undo.pop();
    rows = lastData.map.rows.map((h) => Uint8Array.from({ length: COLS }, (_, c) => parseInt(h.substr(c * 2, 2), 16))); draw();
  };
  $('mpsave').onclick = () => { if (AC.SpriteEd && AC.SpriteEd.save) AC.SpriteEd.save(); };
  document.querySelector('nav button[data-t=maped]').addEventListener('click', refresh);
  AC.MapEd = { refresh };
})();
