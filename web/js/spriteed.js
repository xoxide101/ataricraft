// Workbench sprite editor. Works on a JSON asset file shared with the game build (games/circuit/assets.json):
// { sheets: { name: { w, h, players: ['$52','$76'], frames: { frameName: ['..bbbb..', ...] } } } }
// 'b' is drawn in the first player's colour, 'w' in the second, '.' is clear. The sheet colour bytes are Atari colour values.
(function () {
  const AC = (window.AC = window.AC || {});
  const root = document.getElementById('sprites');
  if (!root) return;
  const pal = AC.buildPalette ? AC.buildPalette('ntsc', {}) : new Uint32Array(256);
  const css = (v) => { const c = pal[v & 254]; return 'rgb(' + (c & 255) + ',' + ((c >> 8) & 255) + ',' + ((c >> 16) & 255) + ')'; };
  const hex = (s) => { const n = parseInt(String(s).replace(/^\$|^0x/i, ''), 16); return isNaN(n) ? 0 : n & 255; };

  root.innerHTML = '<div class="drop" id="dsp">Drop an assets.json here, or <button class="b" id="spload">choose one</button> <small>(games/circuit/assets.json)</small></div>' +
    '<div class="row"><label>Sheet <select id="spsheet"></select></label><label>Frame <select id="spframe"></select></label>' +
    '<button class="b" id="spnewf">New frame</button><button class="b" id="spdup">Duplicate</button><button class="b" id="spmir">Mirrored copy</button><button class="b" id="spdel">Delete</button><button class="b" id="spren">Rename</button></div>' +
    '<div class="row"><label>Brush <select id="spbrush"><option value="b">Player 1 colour</option><option value="w">Player 2 colour</option><option value=".">Clear</option></select></label>' +
    '<label>P1 colour $<input type="text" id="spc1" size="2" style="width:48px"></label><label>P2 colour $<input type="text" id="spc2" size="2" style="width:48px"></label>' +
    '<button class="b" id="spundo">Undo</button><button class="b" id="spfh">Flip H</button><button class="b" id="spfv">Flip V</button><button class="b" id="spclr">Clear</button>' +
    '<button class="b" id="spl">&#8592;</button><button class="b" id="spr">&#8594;</button><button class="b" id="spu">&#8593;</button><button class="b" id="spd">&#8595;</button></div>' +
    '<div class="row" style="align-items:flex-start"><canvas id="spcv" style="border:1px solid #3a4150;cursor:crosshair;touch-action:none"></canvas>' +
    '<div><div><small>Preview, all frames (as on screen)</small></div><canvas id="sppv" style="background:#222;border:1px solid #3a4150"></canvas>' +
    '<div class="row"><label>Animate <input type="checkbox" id="spanim"></label><label>Frames per second <input type="text" id="spfps" value="6" style="width:40px"></label></div>' +
    '<div><small>Colour swatches (click to set the brush colour)</small></div><canvas id="sppal" style="border:1px solid #3a4150;cursor:pointer"></canvas></div></div>' +
    '<div class="row"><button class="b" id="spsave">Download assets.json</button><button class="b" id="spnews">New sheet</button></div>' +
    '<pre id="spout">Edit, then download assets.json and put it in games/circuit/. Run node games\\circuit\\build.cjs to rebuild the game.</pre>';
  const $ = (id) => document.getElementById(id);
  let data = null, sheet = null, frame = null, undo = [], timer = null, paintCh = null;
  const Z = 20;

  const say = (m, err) => { $('spout').textContent = m; $('spout').className = err ? 'err' : ''; };
  const S = () => data.sheets[sheet];
  const F = () => S().frames[frame];

  function load(obj) {
    if (!obj || !obj.sheets) throw new Error('No "sheets" in this file');
    data = obj; sheet = Object.keys(obj.sheets)[0]; frame = Object.keys(S().frames)[0]; undo = []; fill();
    say('Loaded ' + Object.keys(obj.sheets).length + ' sheets.');
  }
  function fill() {
    $('spsheet').innerHTML = ''; for (const k of Object.keys(data.sheets)) $('spsheet').append(new Option(k, k)); $('spsheet').value = sheet;
    fillFrames(); $('spc1').value = S().players[0].replace('$', ''); $('spc2').value = S().players[1].replace('$', '');
    redraw();
  }
  function fillFrames() { $('spframe').innerHTML = ''; for (const k of Object.keys(S().frames)) $('spframe').append(new Option(k, k)); $('spframe').value = frame; }
  const snap = () => { undo.push(JSON.stringify(data)); if (undo.length > 100) undo.shift(); };
  const colOf = (ch) => (ch === 'b' ? css(hex(S().players[0])) : ch === 'w' ? css(hex(S().players[1])) : null);

  function drawFrame(g, rows, s, xs) {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) { const c = colOf(rows[y][x]); if (c) { g.fillStyle = c; g.fillRect(x * s * xs, y * s, s * xs, s); } }
  }
  function redraw() {
    if (!data) return;
    const sh = S(), cv = $('spcv'), g = cv.getContext('2d');
    cv.width = sh.w * Z; cv.height = sh.h * Z; g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    drawFrame(g, F(), Z, 1);
    g.strokeStyle = '#2d3340'; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= sh.w; x++) { g.moveTo(x * Z + .5, 0); g.lineTo(x * Z + .5, cv.height); }
    for (let y = 0; y <= sh.h; y++) { g.moveTo(0, y * Z + .5); g.lineTo(cv.width, y * Z + .5); }
    g.stroke();
    const names = Object.keys(sh.frames), pv = $('sppv'), pg = pv.getContext('2d'), sc = 3;
    pv.width = names.length * (sh.w * sc * 2 + 6) + 6; pv.height = sh.h * sc + 6; pg.clearRect(0, 0, pv.width, pv.height);
    names.forEach((n, i) => {
      pg.save(); pg.translate(6 + i * (sh.w * sc * 2 + 6), 3);
      if (n === frame) { pg.strokeStyle = '#ff9d3a'; pg.strokeRect(-3, -3, sh.w * sc * 2 + 6, sh.h * sc + 6); }
      drawFrame(pg, sh.frames[n], sc, 2); pg.restore();
    });
    const pc = $('sppal'), qg = pc.getContext('2d'); pc.width = 16 * 18; pc.height = 8 * 18;
    for (let h = 0; h < 16; h++) for (let l = 0; l < 8; l++) { qg.fillStyle = css(h * 16 + l * 2); qg.fillRect(h * 18, l * 18, 18, 18); }
  }

  function cell(e) { const r = $('spcv').getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / Z), Math.floor((e.clientY - r.top) / Z)]; }
  function paint(e) {
    const [x, y] = cell(e), sh = S(); if (x < 0 || y < 0 || x >= sh.w || y >= sh.h) return;
    const rows = F(), row = [...rows[y]]; if (row[x] === paintCh) return; row[x] = paintCh; rows[y] = row.join(''); redraw();
  }
  $('spcv').onpointerdown = (e) => { e.preventDefault(); if (!data) return; snap(); paintCh = e.button === 2 ? '.' : $('spbrush').value; $('spcv').setPointerCapture(e.pointerId); paint(e); };
  $('spcv').onpointermove = (e) => { if (paintCh !== null) paint(e); };
  $('spcv').onpointerup = () => { paintCh = null; };
  $('spcv').oncontextmenu = (e) => e.preventDefault();
  $('sppal').onclick = (e) => {
    if (!data) return; const r = $('sppal').getBoundingClientRect(), v = Math.floor((e.clientX - r.left) / 18) * 16 + Math.floor((e.clientY - r.top) / 18) * 2;
    const k = $('spbrush').value === 'w' ? 1 : 0; snap(); S().players[k] = '$' + v.toString(16).toUpperCase().padStart(2, '0'); $(k ? 'spc2' : 'spc1').value = S().players[k].slice(1); redraw();
  };
  const setCol = (k) => () => { if (!data) return; snap(); S().players[k] = '$' + hex($(k ? 'spc2' : 'spc1').value).toString(16).toUpperCase().padStart(2, '0'); redraw(); };
  $('spc1').onchange = setCol(0); $('spc2').onchange = setCol(1);
  $('sppv').onclick = (e) => {
    if (!data) return; const sh = S(), r = $('sppv').getBoundingClientRect(), i = Math.floor((e.clientX - r.left - 3) / (sh.w * 6 + 6)), n = Object.keys(sh.frames)[i];
    if (n) { frame = n; $('spframe').value = n; redraw(); }
  };

  const need = (fn) => () => { if (!data) return say('Load assets.json first.', 1); fn(); };
  const edit = (fn) => need(() => { snap(); S().frames[frame] = fn(F().slice()); redraw(); });
  const rev = (r) => [...r].reverse().join('');
  $('spsheet').onchange = () => { sheet = $('spsheet').value; frame = Object.keys(S().frames)[0]; undo = []; fill(); };
  $('spframe').onchange = () => { frame = $('spframe').value; redraw(); };
  $('spfh').onclick = edit((r) => r.map(rev));
  $('spfv').onclick = edit((r) => r.reverse());
  $('spclr').onclick = edit((r) => r.map((s) => '.'.repeat(s.length)));
  $('spl').onclick = edit((r) => r.map((s) => s.slice(1) + '.'));
  $('spr').onclick = edit((r) => r.map((s) => '.' + s.slice(0, -1)));
  $('spu').onclick = edit((r) => { r.shift(); r.push('.'.repeat(S().w)); return r; });
  $('spd').onclick = edit((r) => { r.pop(); r.unshift('.'.repeat(S().w)); return r; });
  $('spundo').onclick = () => { if (!undo.length) return; data = JSON.parse(undo.pop()); if (!data.sheets[sheet]) sheet = Object.keys(data.sheets)[0]; if (!S().frames[frame]) frame = Object.keys(S().frames)[0]; fill(); };
  const uniq = (base) => { let n = base, i = 2; while (S().frames[n]) n = base + i++; return n; };
  $('spnewf').onclick = need(() => { snap(); const n = uniq('frame'); S().frames[n] = Array(S().h).fill('.'.repeat(S().w)); frame = n; fillFrames(); redraw(); });
  $('spdup').onclick = need(() => { snap(); const n = uniq(frame + '_copy'); S().frames[n] = F().slice(); frame = n; fillFrames(); redraw(); });
  $('spmir').onclick = need(() => { snap(); const n = uniq(frame + '_mirror'); S().frames[n] = F().map(rev); frame = n; fillFrames(); redraw(); });
  $('spdel').onclick = need(() => {
    if (Object.keys(S().frames).length < 2) return say('A sheet needs at least one frame.', 1);
    snap(); delete S().frames[frame]; frame = Object.keys(S().frames)[0]; fillFrames(); redraw();
  });
  $('spren').onclick = need(() => {
    const n = (prompt('New frame name', frame) || '').trim(); if (!n || n === frame) return;
    if (S().frames[n]) return say('That name is taken.', 1);
    snap(); const o = {}; for (const k of Object.keys(S().frames)) o[k === frame ? n : k] = S().frames[k]; S().frames = o; frame = n; fillFrames(); redraw();
  });
  $('spnews').onclick = need(() => {
    const n = (prompt('Sheet name', 'new') || '').trim(); if (!n || data.sheets[n]) return;
    const w = Math.max(1, Math.min(8, +prompt('Width in pixels (1 to 8)', '8') || 8)), h = Math.max(1, Math.min(128, +prompt('Height in scanlines (1 to 128)', '8') || 8));
    snap(); data.sheets[n] = { w, h, players: ['$0E', '$0A'], frames: { a: Array(h).fill('.'.repeat(w)) } }; sheet = n; frame = 'a'; fill();
  });
  $('spsave').onclick = need(() => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'assets.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('Saved assets.json. Put it in games/circuit/ and run node games\\circuit\\build.cjs.');
  });
  $('spanim').onchange = () => {
    clearInterval(timer); if (!$('spanim').checked || !data) return;
    timer = setInterval(() => { const n = Object.keys(S().frames); frame = n[(n.indexOf(frame) + 1) % n.length]; $('spframe').value = frame; redraw(); }, 1000 / Math.max(1, +$('spfps').value || 6));
  };
  $('spfps').onchange = $('spanim').onchange;

  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.json,application/json';
  const read = (f) => f.text().then((t) => { try { load(JSON.parse(t)); } catch (e) { say('Could not read that file: ' + e.message, 1); } });
  fi.onchange = () => { if (fi.files[0]) read(fi.files[0]); fi.value = ''; };
  $('spload').onclick = () => fi.click();
  const d = $('dsp');
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
  AC.SpriteEd = { load };
})();
