// Views: Family (all sizes side by side, compare against a fresh derive), Specimen (waterfall), Atari screen (simulated screens,
// graphics tiling test, charset view with inverse video).
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, G = XCW.Gfx;
  const ORIG = ['master', 'derived', 'hand-edited'];
  const sortedSizes = () => Object.keys(st.fam.sizes).map(Number).sort((a, b) => a - b);

  // text -> [[code, inverse]]; {i}..{/i} marks inverse video
  function parse(text) {
    const out = []; let inv = 0;
    for (let i = 0; i < text.length;) {
      if (text.startsWith('{i}', i)) { inv = 1; i += 3; continue; }
      if (text.startsWith('{/i}', i)) { inv = 0; i += 4; continue; }
      const cp = text.codePointAt(i); i += cp > 0xffff ? 2 : 1;
      out.push([FE.codeOfChar(String.fromCodePoint(cp)), inv]);
    }
    return out;
  }
  // draws one line; returns the end x in unzoomed pixels. o: prop, kern, rowFrom (skip headroom), bg (for inverse cells), z
  function drawLine(c, f, text, x0, y0, z, color, o = {}) {
    const cells = parse(text), r0 = o.rowFrom || 0; let x = x0;
    cells.forEach(([code, inv], i) => {
      const slot = f.map[code], g = CF.glyph(f, code), nc = CF.colsOf(f, slot), adv = o.prop ? (f.advs[slot] || f.adv) : f.adv;
      if (o.kern && i) x += FE.kernOf(f, cells[i - 1][0], code);
      if (inv) { c.fillStyle = color; c.fillRect(x * z, y0 * z, adv * z, (f.rows - r0) * z); }
      c.fillStyle = inv ? o.bg : color;
      for (let r = r0; r < f.rows; r++) if (g[r]) for (let q = 0; q < nc; q++) if (CF.hasPx(f, g[r], q)) c.fillRect((x + q) * z, (y0 + r - r0) * z, z, z);
      x += adv;
    });
    return x;
  }
  FE.drawLine = drawLine; FE.parseText = parse;
  const widthOf = (f, text, prop) => parse(text).reduce((n, [code]) => n + (prop ? (f.advs[f.map[code]] || f.adv) : f.adv), 0);
  const fontOfSize = (s) => (st.fam.sizes[s] || (st.fam.sizes[st.fam.master] && s !== st.fam.master ? CF.derive(st.fam.sizes[st.fam.master], s, { threshold: 0.4, keepStems: true }) : null));

  // ---- Family view --------------------------------------------------------------------------------------------------------------------------
  const FSAMPLE = 'Hag 0123 \u250c\u2500\u2510\u2665';
  function drawFamily() {
    if (!FE.isTab('family') || !st.fam) return;
    const C = FE.themeColors(), box = $('famcards'), have = sortedSizes();
    box.innerHTML = '';
    for (const s of FE.SIZES.concat(have.filter((k) => !FE.SIZES.includes(k))).sort((a, b) => a - b)) {
      const f = st.fam.sizes[s], d = document.createElement('div');
      d.className = 'card' + (f ? '' : ' missing') + (st.f.adv === s ? ' on' : ''); d.dataset.size = s;
      if (!f) { d.innerHTML = '<h4>' + s + ' px <span class="badge">missing</span></h4><button class="mk" data-size="' + s + '">Create from ' + st.fam.master + ' px master</button>'; box.appendChild(d); continue; }
      const cv = document.createElement('canvas'), z = Math.max(1, Math.min(4, Math.floor(160 / Math.max(f.adv * 6, 24))));
      cv.width = Math.max(150, Math.min(260, widthOf(f, FSAMPLE) * z + 8)); cv.height = (f.rows + 4) * z; const c = cv.getContext('2d');
      c.fillStyle = C.paper; c.fillRect(0, 0, cv.width, cv.height); drawLine(c, f, FSAMPLE, 2, 2, z, '#16181c');
      d.innerHTML = '<h4>' + s + ' px <span class="badge o' + f.origin + '">' + ORIG[f.origin] + '</span>' + (f.locked ? ' <span class="badge">locked</span>' : '') + '</h4>';
      d.appendChild(cv);
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<label><input type="checkbox" class="lk" ' + (f.locked ? 'checked' : '') + '> lock</label><button class="op">Open</button>' + (f.origin !== 0 ? '<button class="rd" title="Overwrite this size with a fresh derive from the master">Re-derive</button>' : '');
      d.appendChild(row);
      row.querySelector('.lk').onchange = (e) => { f.locked = e.target.checked; FE.render(); };
      row.querySelector('.op').onclick = () => { FE.selectSize(s); FE.showTab('edit'); };
      const rd = row.querySelector('.rd'); if (rd) rd.onclick = () => { const was = f.locked; f.locked = false; st.fam.sizes[s].origin = 1; FE.deriveSizes([s], true); const g = st.fam.sizes[s]; if (g) g.locked = was; };
      box.appendChild(d);
    }
    box.querySelectorAll('.mk').forEach((b) => { b.onclick = () => FE.selectSize(+b.dataset.size); });
    drawCompare();
  }
  FE.renders.push(drawFamily);
  function drawCompare() {
    const sel = $('cmpsize'), cur = sel.value, ds = sortedSizes().filter((s) => s !== st.fam.master);
    if (sel.dataset.sig !== ds.join()) { sel.innerHTML = ds.map((s) => '<option value="' + s + '">' + s + ' px</option>').join(''); sel.dataset.sig = ds.join(); if (ds.includes(+cur)) sel.value = cur; else if (ds.includes(st.f.adv)) sel.value = st.f.adv; }
    const cv = $('cmp'), c = cv.getContext('2d'), C = FE.themeColors(), s = +sel.value, orig = st.fam.sizes[s], master = st.fam.sizes[st.fam.master];
    if (!orig || !master) { cv.width = 1; cv.height = 1; $('cmpinfo').textContent = 'The master has no other size to compare yet. Create sizes from the strip above.'; return; }
    const fresh = CF.derive(master, s, FE.hintOpts()), z = Math.max(1, Math.min(3, Math.floor(40 / s * 2)));
    const codes = []; for (let k = 33; k < 127; k++) codes.push(k);
    const perRow = Math.max(8, Math.floor(700 / ((orig.adv + 2) * z))), nrows = Math.ceil(codes.length / perRow), cw = (orig.adv + 2) * z, ch = (orig.rows + 2) * z;
    cv.width = perRow * cw; cv.height = nrows * ch; c.fillStyle = C.bg; c.fillRect(0, 0, cv.width, cv.height);
    let nd = 0; const list = [];
    codes.forEach((code, i) => {
      const x0 = (i % perRow) * cw, y0 = Math.floor(i / perRow) * ch, a = CF.glyph(orig, code), b = CF.glyph(fresh, code); let d = 0;
      for (let r = 0; r < orig.rows; r++) for (let q = 0; q < orig.adv; q++) {
        const pa = CF.hasPx(orig, a[r] || 0, q), pb = CF.hasPx(fresh, b[r] || 0, q);
        if (!pa && !pb) continue; d += pa !== pb ? 1 : 0;
        c.fillStyle = pa && pb ? C.dim : pa ? '#ff5555' : '#4aa8ff'; c.fillRect(x0 + (1 + q) * z, y0 + (1 + r) * z, z, z);
      }
      if (d) { nd++; list.push(String.fromCharCode(code)); }
    });
    $('cmpinfo').innerHTML = nd ? '<b>' + nd + '</b> of 94 ASCII glyphs differ from a fresh derive (' + list.join(' ') + '). <span style="color:#ff5555">Red = only in your ' + s + ' px</span>, <span style="color:#4aa8ff">blue = only in a fresh derive</span>, grey = both.' : 'Identical to a fresh derive from the ' + master.adv + ' px master.';
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('cmpsize').onchange = drawCompare;
    $('fbderive').onclick = () => FE.deriveSizes(FE.SIZES, false);
    $('fbmissing').onclick = () => FE.deriveSizes(FE.SIZES.filter((s) => !st.fam.sizes[s]), false);
    $('fbforce').onclick = () => { if (confirm('Overwrite every derived and hand-edited size (except locked) with a fresh derive from the master?')) FE.deriveSizes(FE.SIZES, true); };
  });

  // ---- Specimen ------------------------------------------------------------------------------------------------------------------------------------
  const rangeStr = (a, b, per) => { let o = '', n = 0; for (let c = a; c <= b; c++) { o += String.fromCharCode(c); if (++n % per === 0) o += '\n'; } return o; };
  const SAMPLES = {
    pangram: 'The quick brown fox jumps over the lazy dog.\nPACK MY BOX WITH FIVE DOZEN LIQUOR JUGS\nHamburgefonstiv 0123456789 (gypsy) [jug] {q}',
    ascii: rangeStr(33, 126, 32),
    latin1: rangeStr(161, 255, 32),
    box: '\u250c\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2510\n\u251c\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2524\n\u2514\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2518\n\u2595\u2595\u2595 \u2582\u2584\u2588 \u258c\u258e',
    atari: G.ENTRIES.map((e) => String.fromCodePoint(e.uni)).join('').replace(/(.{16})/g, '$1\n'),
  };
  FE.SAMPLES = SAMPLES;
  function specimen(cv, z) {
    const fam = st.fam, C = FE.themeColors(), prop = $('sprop').checked, kern = $('skern').checked, lines = $('sptext').value.split('\n');
    const sizes = sortedSizes(), parts = [];
    let W = 0, H = 6;
    for (const s of sizes) { const f = fam.sizes[s], w = Math.max(...lines.map((l) => widthOf(f, l, prop))) + 12; W = Math.max(W, w); parts.push([f, H]); H += (f.rows + 1) * lines.length + 8; }
    cv.width = Math.max(W, 60) * z; cv.height = H * z; const c = cv.getContext('2d');
    c.fillStyle = C.paper; c.fillRect(0, 0, cv.width, cv.height);
    for (const [f, y] of parts) {
      c.fillStyle = C.dim; c.fillRect(0, (y - 3) * z, cv.width, 1);
      lines.forEach((l, i) => drawLine(c, f, l, 6, y + i * (f.rows + 1), z, '#16181c', { prop, kern }));
    }
    return cv;
  }
  FE.specimenCanvas = () => specimen(document.createElement('canvas'), 2);
  function drawSpecimen() { if (FE.isTab('specimen') && st.fam) specimen($('spcv'), +$('spz').value); }
  FE.renders.push(drawSpecimen);
  document.addEventListener('DOMContentLoaded', () => {
    $('sptext').value = SAMPLES.pangram;
    $('spsample').onchange = () => { $('sptext').value = SAMPLES[$('spsample').value] || $('sptext').value; FE.render(); };
    for (const id of ['sptext', 'spz', 'sprop', 'skern']) $(id).addEventListener('input', drawSpecimen);
  });

  // ---- Atari screen: 4x7 / 5x7 / 6x7 text on 320 px lines, 8x8 charset with inverse video, graphics tiling test -------------------------------------------
  const BLUE = '#1b3a8a', LIGHT = '#9fc0ff';
  function screenSim(cv, s, text, zoom) {
    const f = fontOfSize(s); if (!f) return;
    const cols = Math.floor(320 / f.adv), r0 = f.head, ph = f.rows - r0 + 1, lines = [];
    for (const raw of text.split('\n')) { const cells = parse(raw); for (let i = 0; i < Math.max(1, cells.length); i += cols) lines.push(raw && cells.length ? cells.slice(i, i + cols) : []); }
    const H = Math.max(40, lines.length * ph + 4);
    cv.width = 320 * zoom; cv.height = H * zoom; const c = cv.getContext('2d');
    c.fillStyle = BLUE; c.fillRect(0, 0, cv.width, cv.height);
    lines.forEach((cells, li) => {
      let x = 0;
      for (const [code, inv] of cells) {
        const slot = f.map[code], g = CF.glyph(f, code), nc = CF.colsOf(f, slot), y = 2 + li * ph;
        if (inv) { c.fillStyle = LIGHT; c.fillRect(x * zoom, y * zoom, f.adv * zoom, ph * zoom); }
        c.fillStyle = inv ? BLUE : LIGHT;
        for (let r = r0; r < f.rows; r++) if (g[r]) for (let q = 0; q < nc; q++) if (CF.hasPx(f, g[r], q)) c.fillRect((x + q) * zoom, (y + r - r0) * zoom, zoom, zoom);
        x += f.adv;
      }
    });
  }
  function drawScreens() {
    if (!FE.isTab('atari') || !st.fam) return;
    const text = $('simtext').value, z = +$('simz').value;
    for (const s of [4, 5, 6, 8]) { screenSim($('sim' + s), s, text, z); const f = fontOfSize(s); $('simcap' + s).textContent = f ? (s === 8 ? '8x8 charset' : s + 'x7') + ' - ' + Math.floor(320 / f.adv) + ' columns' + (st.fam.sizes[s] ? '' : ' (derived on the fly, not stored)') : 'no ' + s + ' px'; }
  }
  FE.renders.push(drawScreens);

  // tiling: horizontal runs and vertical stacks of the box-drawing glyphs, with a pixel-exact edge match check
  const BOXH = ['\u250c\u2500', '\u2500\u2500', '\u2500\u2510', '\u251c\u2500', '\u2500\u2524', '\u252c\u2500', '\u2500\u252c', '\u2534\u2500', '\u2500\u2534', '\u253c\u2500', '\u2500\u253c', '\u2514\u2500', '\u2500\u2518'];
  const BOXV = ['\u250c\u251c', '\u251c\u251c', '\u251c\u2514', '\u2510\u2524', '\u2524\u2524', '\u2524\u2518', '\u252c\u253c', '\u253c\u2534', '\u253c\u253c', '\u251c\u253c', '\u253c\u2524'];
  FE.tilingCheck = (f = st.f) => {
    const cp = (ch) => f.map[FE.codeOfChar(ch)], bad = [];
    const code = (ch) => FE.codeOfChar(ch);
    const ink = (g, r, q) => CF.hasPx(f, g[r] || 0, q);
    let r0 = 99, r1 = -1;
    for (const e of G.ENTRIES) if (e.uni >= 0x2500 && e.uni < 0x2580) { const g = f.glyphs[f.map[e.slot]] || []; for (let r = 0; r < f.rows; r++) if (g[r]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); } }
    for (const pair of BOXH) {
      const a = CF.glyph(f, code(pair[0])), b = CF.glyph(f, code(pair[1])), na = CF.colsOf(f, cp(pair[0]));
      let d = 0; for (let r = r0; r <= r1; r++) if (ink(a, r, na - 1) !== ink(b, r, 0)) d++;
      if (d) bad.push({ pair, dir: 'h', rows: d, code: code(pair[0]) });
    }
    for (const pair of BOXV) {
      const a = CF.glyph(f, code(pair[0])), b = CF.glyph(f, code(pair[1])), nc = CF.colsOf(f, cp(pair[0]));
      let d = 0; for (let q = 0; q < nc; q++) if (ink(a, r1, q) !== ink(b, r0, q)) d++;
      if (d) bad.push({ pair, dir: 'v', rows: d, code: code(pair[0]) });
    }
    return { checked: BOXH.length + BOXV.length, bad, r0, r1 };
  };
  function drawTiling() {
    if (!FE.isTab('atari') || !st.fam) return;
    const f = st.f, C = FE.themeColors(), z = Math.max(1, Math.min(6, Math.floor(8 / Math.max(1, f.adv / 8)))), cv = $('tilecv'), c = cv.getContext('2d');
    const rows = ['\u250c\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2510', '\u251c\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2524', '\u2514\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2518', '\u2500'.repeat(16)];
    const cellH = (f.rows - f.head) , W = (rows[3].length * f.adv + 8) * z;
    cv.width = Math.max(W, 200); cv.height = (rows.length * cellH + 6) * z; c.fillStyle = C.paper; c.fillRect(0, 0, cv.width, cv.height);
    rows.forEach((l, i) => drawLine(c, f, l, 4, 3 + i * cellH, z, '#16181c', { rowFrom: f.head }));
    const rep = FE.tilingCheck(f), sh = (ch) => ch.split('').map((x) => FP.glyphName(FE.codeOfChar(x)) || x).join('+');
    $('tileinfo').innerHTML = rep.bad.length ? '<b class="bad">' + rep.bad.length + ' of ' + rep.checked + ' joins do not connect</b> at ' + f.adv + ' px: ' + rep.bad.map((b) => '<a href="#" class="jump" data-code="' + b.code + '">' + b.pair + ' ' + (b.dir === 'h' ? 'left-right' : 'top-bottom') + ' (' + b.rows + ')</a>').join(', ') : '<b class="ok">All ' + rep.checked + ' joins connect</b> at ' + f.adv + ' px: lines, corners, tees and crosses meet pixel-exactly.';
    $('tileinfo').querySelectorAll('.jump').forEach((a) => { a.onclick = (e) => { e.preventDefault(); FE.gotoCode(+a.dataset.code); }; });
  }
  FE.renders.push(drawTiling);

  // charset view (8x8, screen-code order or ATASCII, normal + inverse halves)
  const atCv = $('atcv'), atX = atCv.getContext('2d'), AZ = 2;
  const atCode = (i) => ($('atlay').value === 'screen' ? (i < 64 ? i + 32 : i < 96 ? i - 64 : i) : i);
  function drawAtari() {
    if (!FE.isTab('atari') || !st.fam) return;
    const f = FE.atari8(true), halves = $('atinv').checked ? 2 : 1, C = FE.themeColors();
    atCv.width = 16 * 10 * AZ * halves + (halves - 1) * 8 * AZ; atCv.height = 8 * 10 * AZ;
    atX.fillStyle = C.bg; atX.fillRect(0, 0, atCv.width, atCv.height);
    $('atinfo').textContent = f ? (f === st.f ? '' : st.fam.sizes[8] === f ? 'using the 8x8 size of this family' : '8x8 derived on the fly from the ' + st.f.adv + ' px master (not stored: click 8 Atari in the size strip to keep it)') : '';
    if (!f) return;
    for (let h = 0; h < halves; h++) for (let i = 0; i < 128; i++) {
      const code = atCode(i), g = f.glyphs[f.map[code]] || [];
      const x0 = h * (16 * 10 + 8) * AZ + (i % 16) * 10 * AZ, y0 = ((i / 16) | 0) * 10 * AZ;
      if (h) { atX.fillStyle = C.ink; atX.fillRect(x0, y0, 10 * AZ, 10 * AZ); }
      atX.fillStyle = h ? C.bg : C.ink;
      for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) if (CF.hasPx(f, g[f.head + r] || 0, q)) atX.fillRect(x0 + (1 + q) * AZ, y0 + (1 + r) * AZ, AZ, AZ);
      if (f === st.f && f.map[code] === st.slot) { atX.strokeStyle = C.acc; atX.lineWidth = 2; atX.strokeRect(x0 + 1, y0 + 1, 10 * AZ - 2, 10 * AZ - 2); }
    }
  }
  FE.renders.push(drawAtari);
  atCv.addEventListener('mousedown', (e) => {
    const f0 = FE.atari8(true); if (!f0) return;
    const r = atCv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * atCv.width, y = ((e.clientY - r.top) / r.height) * atCv.height;
    const half = $('atinv').checked && x >= (16 * 10 + 8) * AZ ? 1 : 0, col = Math.floor((x - half * (16 * 10 + 8) * AZ) / (10 * AZ)), row = Math.floor(y / (10 * AZ));
    const i = row * 16 + col; if (col < 0 || col > 15 || i < 0 || i > 127) return;
    if (f0 !== st.f) { if (!st.fam.sizes[8]) { st.fam.sizes[8] = f0; FE.libChanged(); } FE.setFont(st.fam.sizes[8], st.fam, true); }
    FE.select(st.f.map[atCode(i)]);
  });
  document.addEventListener('DOMContentLoaded', () => {
    $('atlay').onchange = $('atinv').onchange = drawAtari;
    $('simtext').value = 'The quick brown fox jumps over the lazy dog.\n{i}INVERSE VIDEO{/i} normal 0123456789\n\u250c\u2500\u2500\u2500\u2510 \u2665\u2663\u2666\u2660 \u2190\u2191\u2192\u2193\n\u2514\u2500\u2500\u2500\u2518';
    $('simtext').oninput = $('simz').onchange = drawScreens;
    $('brom').onclick = () => FE.openRomCharset();
  });
  FE.onTab('atari', () => { if (FE.val) FE.val.render(); });
})();
