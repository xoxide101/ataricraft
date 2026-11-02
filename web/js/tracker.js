// Workbench Tracker tab: pattern grid, scales, 1 or 2 POKEY tracks, preview, JSON save/load, SAP/XEX export.
(function () {
  const T = AC.TrackCore, $$ = (id) => document.getElementById(id), root = $$('tracker');
  if (!root) return;
  const KEYS = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23 };
  let song = T.newSong(false), pi = 0, cur = { r: 0, t: 0, col: 0 }, oct = 3, ctx = null, comp = null;
  try { const s = localStorage.getItem('ac_tracker'); if (s) song = T.sanitize(JSON.parse(s)); } catch (e) { /* keep default */ }
  const store = () => { try { localStorage.setItem('ac_tracker', JSON.stringify(song)); } catch (e) { /* ignore */ } };

  root.innerHTML = `
  <div class="row"><label>Name <input type="text" id="tkname" style="width:150px"></label>
    <label>POKEYs <select id="tkpokey"><option value="0">1 (4 voices, mono)</option><option value="1">2 (8 voices, left + right)</option></select></label>
    <label>Frames per row <input type="number" id="tkspeed" min="1" max="32" style="width:52px"></label>
    <label><input type="checkbox" id="tkpal"> PAL (50 Hz)</label><label><input type="checkbox" id="tkloop"> Loop</label></div>
  <div class="row"><label>Key <select id="tkroot"></select></label><label>Scale <select id="tkscale"></select></label>
    <label>Octave <input type="number" id="tkoct" min="0" max="8" style="width:48px"></label>
    <small>Notes in the scale are bright, others dim.</small></div>
  <div class="row"><label>Pattern <select id="tkpat"></select></label><button class="b" id="tkaddpat">New</button><button class="b" id="tkdup">Copy</button>
    <label>Rows <input type="number" id="tkrows" min="1" max="128" style="width:56px"></label>
    <label>Order <input type="text" id="tkorder" style="width:180px" title="Pattern numbers, comma separated"></label></div>
  <div id="tktracks"></div>
  <div class="row"><button class="b" id="tkplay">Play</button><button class="b" id="tkstop" disabled>Stop</button>
    <button class="b" id="tkup">Up 1</button><button class="b" id="tkdown">Down 1</button><button class="b" id="tkoctup">Up octave</button><button class="b" id="tkoctdown">Down octave</button>
    <button class="b" id="tkdegup">Up scale step</button><button class="b" id="tkdegdown">Down scale step</button><button class="b" id="tksnap">Snap to scale</button>
    <small>(on the selected track, or the whole pattern if you click a header)</small></div>
  <div id="tkgrid" tabindex="0" style="overflow:auto;max-height:420px;background:#0d0f12;border:1px solid #3a4150;border-radius:6px;outline:none"></div>
  <small>Keys: Z S X D C V G B H N J M = low octave, Q 2 W 3 E R 5 T 6 Y 7 U = upper. Arrows move. Enter = note off. Backspace/Delete clears. On the volume column type 0-9 or A-F.</small>
  <div class="row"><button class="b" id="tkjson">Save song JSON</button><button class="b" id="tkload">Load song JSON</button><button class="b" id="tkmidi">Import MIDI</button>
    <button class="b" id="tksap">Export SAP</button><button class="b" id="tkxex">Export XEX</button></div>
  <pre id="tkout"></pre>`;

  const fill = (sel, items) => { sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); };
  fill($$('tkroot'), T.NOTE.map((n, i) => [i, n])); fill($$('tkscale'), Object.keys(T.SCALES).map((n) => [n, n]));
  let sel = -1; // selected track header, -1 = whole pattern

  const pat = () => song.patterns[pi] || (pi = 0, song.patterns[0]);
  const hex = (n) => n.toString(16).toUpperCase();
  function refresh() {
    store(); const p = pat();
    $$('tkname').value = song.name; $$('tkpokey').value = song.stereo ? '1' : '0'; $$('tkspeed').value = song.speed; $$('tkpal').checked = song.pal; $$('tkloop').checked = song.loop;
    $$('tkroot').value = song.scale.root; $$('tkscale').value = song.scale.name; $$('tkoct').value = oct;
    fill($$('tkpat'), song.patterns.map((_, i) => [i, 'Pattern ' + i])); $$('tkpat').value = pi; $$('tkrows').value = p.rows; $$('tkorder').value = song.order.join(',');
    $$('tktracks').innerHTML = '<table><tr>' + song.tracks.map((t, i) => `<td><b style="color:${i < 4 && song.stereo ? '#7ab8ff' : i >= 4 ? '#ffb27a' : '#d8dce4'}">${song.stereo ? (i < 4 ? 'L ' : 'R ') : ''}${t.name}</b><br>
      <select data-k="wave" data-i="${i}">${T.WAVES.map((w) => `<option${w === t.wave ? ' selected' : ''}>${w}</option>`).join('')}</select>
      vol <input type="number" data-k="vol" data-i="${i}" min="0" max="15" value="${t.vol}" style="width:42px"> decay <input type="number" data-k="decay" data-i="${i}" min="0" max="16" value="${t.decay}" style="width:42px"></td>`).join('') + '</tr></table>';
    $$('tktracks').querySelectorAll('[data-k]').forEach((e) => (e.onchange = () => { const t = song.tracks[+e.dataset.i]; t[e.dataset.k] = e.dataset.k === 'wave' ? e.value : Math.max(0, +e.value | 0); refresh(); }));
    grid(); report();
  }
  function grid() {
    const p = pat(); let h = '<table style="font:13px Consolas,monospace;width:auto"><tr><td></td>';
    song.tracks.forEach((t, i) => { h += `<td colspan="2" data-h="${i}" style="cursor:pointer;color:${sel === i ? '#ff9d3a' : '#8a93a3'};border-left:1px solid #3a4150">${t.name}</td>`; });
    h += '</tr>';
    for (let r = 0; r < p.rows; r++) {
      h += `<tr style="${r % 4 === 0 ? 'background:#161a20' : ''}"><td style="color:#5a6372">${hex(r).padStart(2, '0')}</td>`;
      song.tracks.forEach((t, i) => {
        const c = p.cells[i][r], on = cur.r === r && cur.t === i;
        let ns = '---', col = '#4a5160';
        if (c) { if (c.n === -1) { ns = 'OFF'; col = '#ff7b7b'; } else { ns = T.noteName(c.n).padEnd(3, '-'); col = T.inScale(song, c.n) ? '#9bd1ff' : '#8a7a5a'; } }
        const vs = c && c.v != null ? hex(c.v) : '-';
        h += `<td data-r="${r}" data-t="${i}" data-c="0" style="border-left:1px solid #3a4150;color:${col};${on && cur.col === 0 ? 'background:#ff9d3a;color:#111' : ''}">${ns}</td>`
          + `<td data-r="${r}" data-t="${i}" data-c="1" style="color:#7ee0a0;${on && cur.col === 1 ? 'background:#ff9d3a;color:#111' : ''}">${vs}</td>`;
      });
      h += '</tr>';
    }
    $$('tkgrid').innerHTML = h + '</table>';
  }
  function report() {
    comp = T.compile(song);
    const lines = [`${comp.frames.length} frames, ${comp.seconds.toFixed(1)} s at ${song.pal ? 50 : 60} Hz. Voices used: ${song.tracks.length} of ${song.stereo ? 8 : 4} (one track per voice).`];
    for (const w of comp.warnings) lines.push('Warning: ' + w);
    $$('tkout').className = ''; $$('tkout').textContent = lines.join('\n');
  }

  // editing
  const range = () => (sel >= 0 ? [sel, sel] : [0, song.tracks.length - 1]);
  function mapNotes(fn) {
    const p = pat(), [a, b] = range();
    for (let t = a; t <= b; t++) for (let r = 0; r < p.rows; r++) { const c = p.cells[t][r]; if (c && c.n >= 0) c.n = Math.max(0, Math.min(127, fn(c.n))); }
    refresh();
  }
  const bind = (id, fn) => { $$(id).onclick = fn; };
  bind('tkup', () => mapNotes((n) => n + 1)); bind('tkdown', () => mapNotes((n) => n - 1));
  bind('tkoctup', () => mapNotes((n) => n + 12)); bind('tkoctdown', () => mapNotes((n) => n - 12));
  bind('tkdegup', () => mapNotes((n) => T.degree(song, n, 1))); bind('tkdegdown', () => mapNotes((n) => T.degree(song, n, -1)));
  bind('tksnap', () => mapNotes((n) => T.snap(song, n)));
  $$('tkgrid').onclick = (e) => {
    const h = e.target.dataset.h, d = e.target;
    if (h != null) { sel = sel === +h ? -1 : +h; grid(); return; }
    if (d.dataset.r != null) { cur = { r: +d.dataset.r, t: +d.dataset.t, col: +d.dataset.c }; grid(); $$('tkgrid').focus(); }
  };
  $$('tkgrid').onkeydown = (e) => {
    const p = pat(), k = e.key.toLowerCase(); let handled = true;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (k === 'arrowdown') cur.r = (cur.r + 1) % p.rows; else if (k === 'arrowup') cur.r = (cur.r + p.rows - 1) % p.rows;
    else if (k === 'arrowright') { if (cur.col === 0) cur.col = 1; else { cur.col = 0; cur.t = (cur.t + 1) % song.tracks.length; } }
    else if (k === 'arrowleft') { if (cur.col === 1) cur.col = 0; else { cur.col = 1; cur.t = (cur.t + song.tracks.length - 1) % song.tracks.length; } }
    else if (k === 'backspace' || k === 'delete') { if (cur.col === 1 && p.cells[cur.t][cur.r]) p.cells[cur.t][cur.r].v = null; else p.cells[cur.t][cur.r] = null; }
    else if (k === 'enter') { p.cells[cur.t][cur.r] = { n: -1 }; cur.r = (cur.r + 1) % p.rows; }
    else if (cur.col === 0 && k in KEYS) { const old = p.cells[cur.t][cur.r]; p.cells[cur.t][cur.r] = { n: Math.min(127, 12 * (oct + 1) + KEYS[k]), v: old ? old.v : null }; cur.r = (cur.r + 1) % p.rows; }
    else if (cur.col === 1 && /^[0-9a-f]$/.test(k) && p.cells[cur.t][cur.r] && p.cells[cur.t][cur.r].n >= 0) { p.cells[cur.t][cur.r].v = parseInt(k, 16); cur.r = (cur.r + 1) % p.rows; }
    else handled = false;
    if (handled) { e.preventDefault(); store(); grid(); report(); }
  };

  // settings
  $$('tkname').onchange = () => { song.name = $$('tkname').value; refresh(); };
  $$('tkpokey').onchange = () => { T.setStereo(song, $$('tkpokey').value === '1'); cur.t = Math.min(cur.t, song.tracks.length - 1); sel = -1; refresh(); };
  $$('tkspeed').onchange = () => { song.speed = Math.max(1, Math.min(32, +$$('tkspeed').value | 0)); refresh(); };
  $$('tkpal').onchange = () => { song.pal = $$('tkpal').checked; refresh(); };
  $$('tkloop').onchange = () => { song.loop = $$('tkloop').checked; refresh(); };
  $$('tkroot').onchange = () => { song.scale.root = +$$('tkroot').value; refresh(); };
  $$('tkscale').onchange = () => { song.scale.name = $$('tkscale').value; refresh(); };
  $$('tkoct').onchange = () => { oct = Math.max(0, Math.min(8, +$$('tkoct').value | 0)); refresh(); };
  $$('tkpat').onchange = () => { pi = +$$('tkpat').value; cur.r = 0; refresh(); };
  $$('tkrows').onchange = () => { T.resizePattern(pat(), Math.max(1, Math.min(128, +$$('tkrows').value | 0))); cur.r = Math.min(cur.r, pat().rows - 1); refresh(); };
  $$('tkorder').onchange = () => {
    const o = $$('tkorder').value.split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 0 && n < song.patterns.length);
    song.order = o.length ? o : [0]; refresh();
  };
  bind('tkaddpat', () => { song.patterns.push(T.newPattern(pat().rows, song.tracks.length)); pi = song.patterns.length - 1; refresh(); });
  bind('tkdup', () => { song.patterns.push(JSON.parse(JSON.stringify(pat()))); pi = song.patterns.length - 1; refresh(); });

  // preview: every frame's register writes, scheduled on up to 8 oscillators, POKEY 0 left and POKEY 1 right
  const stop = () => { if (ctx) { ctx.close(); ctx = null; } $$('tkstop').disabled = true; };
  bind('tkstop', stop);
  bind('tkplay', () => {
    stop(); report(); if (!comp.frames.length) return;
    ctx = new AudioContext(); const c = ctx, fps = song.pal ? 50 : 60, t0 = c.currentTime + 0.1, np = song.stereo ? 2 : 1;
    const nbuf = c.createBuffer(1, c.sampleRate, c.sampleRate), nd = nbuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const vs = [];
    for (let i = 0; i < np * 4; i++) {
      const pan = c.createStereoPanner(); pan.pan.value = np === 1 ? 0 : i < 4 ? -1 : 1; pan.connect(c.destination);
      const osc = c.createOscillator(), g = c.createGain(), ns = c.createBufferSource(), ng = c.createGain();
      osc.type = 'square'; g.gain.value = 0; ng.gain.value = 0; ns.buffer = nbuf; ns.loop = true;
      osc.connect(g).connect(pan); ns.connect(ng).connect(pan); osc.start(); ns.start(); vs.push({ osc, g, ns, ng, f: -1, c: -1 });
    }
    const secs = Math.min(comp.frames.length, fps * 120);
    for (let n = 0; n < secs; n++) {
      const t = t0 + n / fps, fr = comp.frames[n];
      for (let i = 0; i < np * 4; i++) {
        const v = vs[i], f = fr[(i >> 2) * 9 + (i & 3) * 2], cc = fr[(i >> 2) * 9 + (i & 3) * 2 + 1];
        if (f === v.f && cc === v.c) continue; v.f = f; v.c = cc;
        const poly = (cc & 0xE0) === 0xC0, noise = (cc & 0xE0) === 0x80, hz = poly ? T.CLOCK / (15 * (f + 1)) : T.CLOCK / (2 * (f + 1)), vol = (cc & 15) / 15 * 0.1;
        v.osc.frequency.setValueAtTime(Math.min(hz, 20000), t); v.ns.playbackRate.setValueAtTime(Math.min(Math.max(hz / 2000, 0.1), 8), t);
        v.g.gain.setValueAtTime(noise ? 0 : vol, t); v.ng.gain.setValueAtTime(noise ? vol * 1.5 : 0, t);
      }
    }
    $$('tkstop').disabled = false; setTimeout(() => { if (ctx === c) stop(); }, (secs / fps + 0.5) * 1000);
  });

  // files
  const dl = (name, bytes, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const fname = () => song.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'SONG';
  const err = (m) => { $$('tkout').className = 'err'; $$('tkout').textContent = m; };
  bind('tkjson', () => dl(song.name.replace(/\s+/g, '_') + '.song.json', JSON.stringify(song, null, 1), 'application/json'));
  bind('tkload', () => {
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.json';
    fi.onchange = async () => {
      try {
        const s = T.sanitize(JSON.parse(await fi.files[0].text()));
        T.compile(s);
        song = s; pi = 0; cur = { r: 0, t: 0, col: 0 }; sel = -1; refresh();
      } catch (e) { err('Could not load: ' + e.message); }
    };
    fi.click();
  });
  bind('tkmidi', () => {
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.mid,.midi';
    fi.onchange = async () => {
      try {
        const r = T.fromMidi(new Uint8Array(await fi.files[0].arrayBuffer()), song); T.compile(r.song);
        song = r.song; pi = 0; cur = { r: 0, t: 0, col: 0 }; sel = -1; refresh();
        $$('tkout').textContent += `\nImported ${r.notes} notes (${r.dropped} dropped: no free track), ${r.rows} rows${r.truncated ? ', TRUNCATED to 64 patterns' : ''}. Speed ${song.speed} frames per row, change it to retime.`;
      } catch (e) { err('Could not import: ' + e.message); }
    };
    fi.click();
  });  const sapOf = () => AC.RmtSap.pack(comp.frames, comp.loop, song.stereo, { pal: song.pal, name: song.name });
  bind('tksap', () => { try { report(); dl(fname() + '.SAP', sapOf().sap, 'application/octet-stream'); } catch (e) { err(e.message); } });
  bind('tkxex', () => { try { report(); dl(fname() + '.XEX', AC.SapXex.build(AC.Pmd.parseSap(sapOf().sap), {}).xex, 'application/octet-stream'); } catch (e) { err(e.message); } });

  AC.Tracker = { get: () => song, set: (s) => { song = s; pi = 0; refresh(); }, compile: () => T.compile(song) };
  refresh();
})();
