// Workbench Scroll tab: wide 4-colour bitmap art (ANTIC mode E style, 2 bits per pixel) with a scrolling preview, PNG import and export.
(function () {
  const root = document.getElementById('scrollart'); if (!root) return;
  const $ = (id) => document.getElementById(id), pal = AC.buildPalette('ntsc', {});
  const rgbv = (c) => { const v = pal[c & 254]; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; };
  const css = (c) => { const [r, g, b] = rgbv(c); return `rgb(${r},${g},${b})`; };
  const PRESETS = { Greys: [0x00, 0x06, 0x0A, 0x0E], 'Circuit blues': [0x00, 0x94, 0x9A, 0x0E], 'Warm': [0x00, 0x32, 0x2A, 0x4E], 'Green screen': [0x00, 0xB2, 0xB8, 0xBE] };
  const mk = (w, h) => ({ kind: 'scroll', w, h, colors: [0x00, 0x06, 0x0A, 0x0E], px: Array.from({ length: h }, () => new Uint8Array(w)) });
  let d = mk(320, 48), cur = 3, undo = [], Z = 3, cam = 0;

  const toJson = (o) => ({ kind: 'scroll', w: o.w, h: o.h, colors: o.colors, rows: o.px.map((r) => [...r].join('')) });
  function fromJson(o) {
    if (!o || o.kind !== 'scroll') throw new Error('Not a scroll art file');
    const { w, h } = o;
    if (!Number.isInteger(w) || w < 4 || w > 1280 || w % 4 || !Number.isInteger(h) || h < 1 || h > 192) throw new Error('w must be a multiple of 4 up to 1280 and h 1 to 192');
    if (!Array.isArray(o.rows) || o.rows.length !== h || o.rows.some((r) => typeof r !== 'string' || r.length !== w || /[^0-3]/.test(r))) throw new Error(`rows must be ${h} strings of ${w} digits 0-3`);
    if (!Array.isArray(o.colors) || o.colors.length !== 4 || o.colors.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) throw new Error('colors must be 4 numbers 0-255');
    return { kind: 'scroll', w, h, colors: o.colors.slice(), px: o.rows.map((r) => Uint8Array.from(r, (c) => +c)) };
  }
  try { const s = localStorage.getItem('ac_scroll'); if (s) d = fromJson(JSON.parse(s)); } catch (e) { d = mk(320, 48); }

  root.innerHTML = `<div class="drop" id="dsc">Drop a scroll art .json or a picture (.png/.jpg) here, or <button class="b" id="scload">choose one</button></div>
  <div class="row"><label>Width <select id="scw"></select></label><label>Height <input type="number" id="sch" min="1" max="192" style="width:56px"></label>
    <label>Zoom <select id="sczoom"><option>2</option><option selected>3</option><option>4</option><option>6</option></select></label>
    <label>Tool <select id="sctool"><option value="pen">Pencil</option><option value="line">Line</option><option value="rect">Filled rectangle</option><option value="fill">Flood fill</option></select></label>
    <label>Preset <select id="scpre"></select></label><button class="b" id="scundo">Undo</button><button class="b" id="scclear">Clear to colour</button><button class="b" id="scshift">Shift left 1 px (wrap)</button></div>
  <div class="row" id="scpal"></div>
  <div style="overflow:auto;max-width:100%;border:1px solid #3a4150"><canvas id="sccv" style="cursor:crosshair;display:block"></canvas></div>
  <div class="row"><label>Preview scroll <input type="range" id="sccam" min="0" max="0" value="0" style="width:420px"></label><small id="sccaminfo"></small></div>
  <canvas id="scpv" style="background:#000;border:1px solid #3a4150;display:block"></canvas>
  <small>The preview shows one 160 pixel wide screen and wraps at the edge, so make the left and right edges meet for a seamless loop. Left click paints, right click uses colour 0.</small>
  <div class="row"><button class="b" id="scsave">Save JSON</button><button class="b" id="scbin">Export packed .bin</button><button class="b" id="scasm">Export asm</button></div><pre id="scout"></pre>`;

  $('scw').innerHTML = [160, 240, 320, 480, 640, 800, 960, 1280].map((w) => `<option>${w}</option>`).join('');
  $('scpre').innerHTML = '<option value="">(choose)</option>' + Object.keys(PRESETS).map((k) => `<option>${k}</option>`).join('');
  const say = (m, e) => { $('scout').textContent = m; $('scout').className = e ? 'err' : ''; };
  const snap = () => { undo.push({ w: d.w, h: d.h, colors: d.colors.slice(), px: d.px.map((r) => r.slice()) }); if (undo.length > 40) undo.shift(); };
  const store = () => { try { localStorage.setItem('ac_scroll', JSON.stringify(toJson(d))); } catch (e) { /* too large or blocked */ } };

  function pal4() {
    $('scpal').innerHTML = d.colors.map((c, i) => `<label style="display:flex;gap:4px;align-items:center"><span data-c="${i}" style="width:26px;height:26px;background:${css(c)};border:2px solid ${i === cur ? '#ff9d3a' : '#3a4150'};cursor:pointer"></span>
      ${i === 0 ? 'bk' : 'c' + i} <input type="text" data-i="${i}" value="$${c.toString(16).toUpperCase().padStart(2, '0')}" style="width:46px"></label>`).join('');
    $('scpal').querySelectorAll('[data-c]').forEach((e) => (e.onclick = () => { cur = +e.dataset.c; pal4(); }));
    $('scpal').querySelectorAll('[data-i]').forEach((e) => (e.onchange = () => { const v = parseInt(e.value.replace('$', ''), 16); if (Number.isFinite(v) && v >= 0 && v < 256) { snap(); d.colors[+e.dataset.i] = v; } redraw(); }));
  }
  function redraw() {
    const cv = $('sccv'); cv.width = d.w * Z; cv.height = d.h * Z; const g = cv.getContext('2d');
    for (let c = 0; c < 4; c++) { g.fillStyle = css(d.colors[c]); for (let y = 0; y < d.h; y++) { const r = d.px[y]; let x = 0; while (x < d.w) { if (r[x] !== c) { x++; continue; } let e = x; while (e < d.w && r[e] === c) e++; g.fillRect(x * Z, y * Z, (e - x) * Z, Z); x = e; } } }
    g.strokeStyle = 'rgba(255,157,58,.5)'; g.beginPath(); for (let x = 160; x < d.w; x += 160) { g.moveTo(x * Z + .5, 0); g.lineTo(x * Z + .5, d.h * Z); } g.stroke();
    $('scw').value = d.w; $('sch').value = d.h; $('sccam').max = d.w - 1; pal4(); preview(); store();
  }
  function preview() {
    const cv = $('scpv'), PW = 3, PH = 2; cv.width = 160 * PW; cv.height = d.h * PH; const g = cv.getContext('2d');
    for (let y = 0; y < d.h; y++) for (let x = 0; x < 160; x++) { g.fillStyle = css(d.colors[d.px[y][(x + cam) % d.w]]); g.fillRect(x * PW, y * PH, PW, PH); }
    const coarse = cam >> 2, fine = (cam & 3) * 2;
    $('sccaminfo').textContent = `x ${cam} = byte ${coarse}, fine scroll ${fine} of 8 colour clocks`;
  }

  let tool = null, start = null, base = null;
  const pos = (e) => { const b = $('sccv').getBoundingClientRect(); return { x: Math.floor((e.clientX - b.left) / Z), y: Math.floor((e.clientY - b.top) / Z) }; };
  const inb = (p) => p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h;
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < d.w && y < d.h) d.px[y][x] = c; };
  function line(a, b, c) { let x = a.x, y = a.y; const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1; let er = dx + dy; for (;;) { put(x, y, c); if (x === b.x && y === b.y) break; const e2 = 2 * er; if (e2 >= dy) { er += dy; x += sx; } if (e2 <= dx) { er += dx; y += sy; } } }
  function fill(p, c) {
    const t = d.px[p.y][p.x]; if (t === c) return; const st = [[p.x, p.y]];
    while (st.length) { const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= d.w || y >= d.h || d.px[y][x] !== t) continue; d.px[y][x] = c; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  }
  const shapeTo = (p) => {
    d.px = base.map((r) => r.slice()); const t = $('sctool').value;
    if (t === 'line') line(start, p, tool);
    else if (t === 'rect') for (let y = Math.min(start.y, p.y); y <= Math.max(start.y, p.y); y++) for (let x = Math.min(start.x, p.x); x <= Math.max(start.x, p.x); x++) put(x, y, tool);
  };
  $('sccv').oncontextmenu = (e) => e.preventDefault();
  $('sccv').onmousedown = (e) => {
    e.preventDefault(); const p = pos(e); if (!inb(p)) return; snap(); tool = e.button === 2 ? 0 : cur; start = p; base = d.px.map((r) => r.slice());
    const t = $('sctool').value;
    if (t === 'pen') put(p.x, p.y, tool); else if (t === 'fill') { fill(p, tool); tool = null; } redraw();
  };
  window.addEventListener('mousemove', (e) => {
    if (tool === null) return; const p = pos(e), t = $('sctool').value;
    if (t === 'pen') { line(start, p, tool); start = p; } else shapeTo(p); redraw();
  });
  window.addEventListener('mouseup', (e) => { if (tool !== null) { const t = $('sctool').value; if (t !== 'pen') shapeTo(pos(e)); tool = null; redraw(); } });

  $('scundo').onclick = () => { if (undo.length) { d = undo.pop(); redraw(); } };
  $('scclear').onclick = () => { snap(); for (const r of d.px) r.fill(cur); redraw(); };
  $('scshift').onclick = () => { snap(); d.px = d.px.map((r) => { const n = new Uint8Array(r.length); n.set(r.subarray(1)); n[r.length - 1] = r[0]; return n; }); redraw(); };
  $('sczoom').onchange = () => { Z = +$('sczoom').value; redraw(); };
  $('sccam').oninput = () => { cam = +$('sccam').value; preview(); };
  $('scpre').onchange = () => { const p = PRESETS[$('scpre').value]; if (p) { snap(); d.colors = p.slice(); redraw(); } $('scpre').value = ''; };
  const resize = (w, h) => { snap(); d.px = Array.from({ length: h }, (_, y) => { const r = new Uint8Array(w); if (d.px[y]) r.set(d.px[y].subarray(0, w)); return r; }); d.w = w; d.h = h; cam = Math.min(cam, w - 1); redraw(); };
  $('scw').onchange = () => resize(+$('scw').value, d.h);
  $('sch').onchange = () => resize(d.w, Math.max(1, Math.min(192, Math.round(+$('sch').value) || d.h)));

  const packed = () => { const out = []; for (const r of d.px) for (let x = 0; x < d.w; x += 4) out.push((r[x] << 6) | (r[x + 1] << 4) | (r[x + 2] << 2) | r[x + 3]); return out; };
  const dl = (name, data, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('scsave').onclick = () => dl('scroll.json', JSON.stringify(toJson(d)), 'application/json');
  $('scbin').onclick = () => { const b = packed(); dl('scroll.bin', new Uint8Array(b), 'application/octet-stream'); say(`${b.length} bytes: ${d.h} lines of ${d.w / 4} bytes (row stride ${d.w / 4}). Pixel 0 is the top bit pair.`); };
  $('scasm').onclick = () => {
    const b = packed(), hx = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0'), o = [`; ${d.w} x ${d.h} pixels, ${d.w / 4} bytes per line, ${b.length} bytes`, `ARTW = ${d.w / 4}`, `ARTH = ${d.h}`, `artcol  .byte ${d.colors.map(hx).join(',')}  ; COLBK, COLPF0, COLPF1, COLPF2`, 'artdata'];
    for (let i = 0; i < b.length; i += 16) o.push('        .byte ' + b.slice(i, i + 16).map(hx).join(','));
    const t = o.join('\n') + '\n'; dl('scroll.asm', t, 'text/plain'); say(`${b.length} bytes of art data.`);
  };

  function importImage(f) {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      URL.revokeObjectURL(url); const c = document.createElement('canvas'); c.width = d.w; c.height = d.h; const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.drawImage(img, 0, 0, d.w, d.h); const data = g.getImageData(0, 0, d.w, d.h).data, cols = d.colors.map(rgbv);
      snap();
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
        const i = (y * d.w + x) * 4, a = data[i + 3] / 255; let best = 0, bd = 1e9;
        for (let k = 0; k < 4; k++) { const dr = data[i] * a - cols[k][0], dg = data[i + 1] * a - cols[k][1], db = data[i + 2] * a - cols[k][2], dist = dr * dr + dg * dg + db * db; if (dist < bd) { bd = dist; best = k; } }
        d.px[y][x] = best;
      }
      redraw(); say(`Imported ${f.name}, scaled to ${d.w} x ${d.h} and mapped to the 4 current colours.`);
    };
    img.onerror = () => { URL.revokeObjectURL(url); say('Could not read that picture.', 1); };
    img.src = url;
  }
  const read = (f) => {
    if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|bmp)$/i.test(f.name)) return importImage(f);
    return f.text().then((t) => { try { snap(); const n = fromJson(JSON.parse(t)); d = n; cam = 0; redraw(); say('Loaded.'); } catch (e) { undo.pop(); say('Could not read that file: ' + e.message, 1); } });
  };
  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.json,image/*'; fi.onchange = () => { if (fi.files[0]) read(fi.files[0]); fi.value = ''; };
  $('scload').onclick = () => fi.click();
  $('dsc').ondragover = (e) => e.preventDefault();
  $('dsc').ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
  AC.ScrollArt = { get: () => d, packed };
  redraw();
})();
