// Tracker song model and compiler. A song is compiled to per-frame POKEY register arrays (9 per POKEY),
// the same shape AC.RmtSap.pack() takes, so a tracker song can become a SAP or XEX.
// Track i drives voice (i & 3) of POKEY (i >> 2): POKEY 0 is the left chip ($D200), POKEY 1 the right chip ($D210).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.TrackCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CLOCK = 63921; // 64 kHz POKEY base clock, NTSC
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALES = {
    Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], Major: [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10],
    'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10],
    Blues: [0, 3, 5, 6, 7, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Mixolydian: [0, 2, 4, 5, 7, 9, 10], 'Whole tone': [0, 2, 4, 6, 8, 10],
  };
  const WAVES = ['pure', 'poly4', 'noise'];
  const noteName = (n) => NOTE[n % 12] + (Math.floor(n / 12) - 1);

  function newSong(stereo) {
    const nt = stereo ? 8 : 4;
    const song = { name: 'Untitled', pal: false, speed: 6, stereo: !!stereo, scale: { root: 0, name: 'Minor pentatonic' }, tracks: [], patterns: [], order: [0], loop: true };
    for (let i = 0; i < nt; i++) song.tracks.push({ name: 'T' + (i + 1), wave: i === 3 || i === 7 ? 'noise' : 'pure', vol: 12, decay: 0 });
    song.patterns.push(newPattern(16, nt));
    return song;
  }
  const newPattern = (rows, nt) => ({ rows, cells: Array.from({ length: nt }, () => new Array(rows).fill(null)) });

  // Switching between 1 and 2 POKEYs keeps the first four tracks.
  function setStereo(song, stereo) {
    const nt = stereo ? 8 : 4; song.stereo = !!stereo;
    while (song.tracks.length > nt) song.tracks.pop();
    while (song.tracks.length < nt) song.tracks.push({ name: 'T' + (song.tracks.length + 1), wave: 'pure', vol: 12, decay: 0 });
    for (const p of song.patterns) {
      while (p.cells.length > nt) p.cells.pop();
      while (p.cells.length < nt) p.cells.push(new Array(p.rows).fill(null));
    }
  }
  function resizePattern(p, rows) {
    for (const c of p.cells) { c.length = rows; for (let i = p.rows; i < rows; i++) c[i] = null; }
    p.rows = rows;
  }

  // Returns {audf, shifted, ok} for a MIDI note on a waveform. Pure tones below ~MIDI 47 do not fit in 8 bits and go up octaves.
  function pitch(n, wave) {
    let shifted = 0, hz = 440 * Math.pow(2, (n - 69) / 12), d;
    const div = (h) => (wave === 'poly4' ? CLOCK / (15 * h) : CLOCK / (2 * h)) - 1;
    d = Math.round(div(hz));
    while (d > 255 && wave !== 'noise') { hz *= 2; shifted++; d = Math.round(div(hz)); }
    if (d > 255) d = 255;
    if (d < 0) return { audf: 0, shifted, ok: false };
    return { audf: d, shifted, ok: true };
  }
  const ctl = (wave, vol) => (wave === 'noise' ? 0x80 : wave === 'poly4' ? 0xC0 : 0xA0) | vol;

  function compile(song) {
    const warn = new Set(), frames = [], nt = song.tracks.length, np = song.stereo ? 2 : 1;
    const st = song.tracks.map(() => ({ audf: 0, vol: 0, base: 0, age: 0 }));
    const lowest = song.tracks.map(() => null);
    for (const pi of song.order) {
      const pat = song.patterns[pi]; if (!pat) { warn.add(`Order list points at missing pattern ${pi}`); continue; }
      for (let r = 0; r < pat.rows; r++) {
        for (let t = 0; t < nt; t++) {
          const cell = pat.cells[t] && pat.cells[t][r]; if (!cell) continue;
          const s = st[t], tk = song.tracks[t];
          if (cell.n === -1) { s.vol = s.base = 0; continue; }
          const p = pitch(cell.n, tk.wave);
          if (p.shifted) warn.add(`${tk.name}: ${noteName(cell.n)} is below the 8-bit pure tone range and plays ${p.shifted} octave${p.shifted > 1 ? 's' : ''} higher`);
          s.audf = p.audf; s.base = s.vol = cell.v == null ? tk.vol : cell.v; s.age = 0;
        }
        for (let f = 0; f < song.speed; f++) {
          const regs = [];
          for (let c = 0; c < np; c++) {
            for (let v = 0; v < 4; v++) {
              const s = st[c * 4 + v], tk = song.tracks[c * 4 + v];
              if (tk.decay > 0 && s.base) s.vol = Math.max(0, s.base - Math.floor(s.age / tk.decay));
              s.age++;
              regs.push(s.audf, ctl(tk.wave, s.vol));
            }
            regs.push(0);
          }
          frames.push(regs);
        }
      }
    }
    if (!frames.length) warn.add('Song is empty');
    return { frames, loop: song.loop ? 0 : -1, warnings: [...warn], seconds: frames.length / (song.pal ? 50 : 60) };
  }

  // Rebuilds an untrusted object into a valid song (clamping every field) or throws.
  function sanitize(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.tracks) || !Array.isArray(o.patterns) || !o.patterns.length) throw new Error('Not a tracker song file');
    const int = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    const stereo = o.tracks.length > 4, nt = stereo ? 8 : 4;
    const sc = o.scale && SCALES[o.scale.name] ? o.scale.name : 'Minor pentatonic';
    const song = { name: String(o.name == null ? 'Untitled' : o.name).slice(0, 40), pal: !!o.pal, speed: int(o.speed, 1, 32, 6), stereo, scale: { root: int(o.scale && o.scale.root, 0, 11, 0), name: sc }, tracks: [], patterns: [], order: [], loop: o.loop !== false };
    for (let i = 0; i < nt; i++) {
      const t = o.tracks[i] && typeof o.tracks[i] === 'object' ? o.tracks[i] : {};
      song.tracks.push({ name: String(t.name == null ? 'T' + (i + 1) : t.name).slice(0, 8), wave: WAVES.includes(t.wave) ? t.wave : 'pure', vol: int(t.vol, 0, 15, 12), decay: int(t.decay, 0, 16, 0) });
    }
    for (const p of o.patterns.slice(0, 64)) {
      const rows = int(p && p.rows, 1, 128, 16), pp = newPattern(rows, nt);
      for (let t = 0; t < nt; t++) for (let r = 0; r < rows; r++) {
        const c = p && Array.isArray(p.cells) && Array.isArray(p.cells[t]) ? p.cells[t][r] : null;
        if (c && typeof c === 'object' && Number.isFinite(Number(c.n))) pp.cells[t][r] = { n: Number(c.n) === -1 ? -1 : int(c.n, 0, 127, 60), v: c.v == null ? null : int(c.v, 0, 15, 12) };
      }
      song.patterns.push(pp);
    }
    for (const x of Array.isArray(o.order) ? o.order.slice(0, 256) : []) { const n = Number(x); if (Number.isInteger(n) && n >= 0 && n < song.patterns.length) song.order.push(n); }
    if (!song.order.length) song.order = [0];
    return song;
  }

  // Reads note events from a format 0/1 MIDI file: [{sec, on, ch, n, vel}] sorted by time.
  function midiNotes(b) {
    const u16 = (p) => (b[p] << 8) | b[p + 1], u32 = (p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    if (!b || b.length < 14 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('not a MIDI file');
    const ntr = u16(10), div = u16(12); if (div & 0x8000 || !div) throw new Error('SMPTE time division is not supported');
    const ev = [], tempos = [{ tick: 0, us: 500000 }]; let p = 14;
    for (let t = 0; t < ntr && p + 8 <= b.length; t++) {
      if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== 'MTrk') break;
      const end = Math.min(b.length, p + 8 + u32(p + 4)); p += 8; let tick = 0, run = 0;
      const vl = () => { let v = 0, c; do { c = b[p++]; v = v * 128 + (c & 0x7F); } while (c & 0x80 && p < end); return v; };
      while (p < end) {
        tick += vl(); let s = b[p];
        if (s === 0xFF) { const type = b[p + 1]; p += 2; const len = vl(); if (type === 0x51 && len === 3) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] }); p += len; continue; }
        if (s === 0xF0 || s === 0xF7) { p++; p += vl(); continue; }
        if (s & 0x80) { run = s; p++; } else s = run;
        const kind = s & 0xF0, ch = s & 15;
        if (kind === 0xC0 || kind === 0xD0) { p++; continue; }
        const d1 = b[p++], d2 = b[p++];
        if (kind === 0x90 && d2 > 0) ev.push({ tick, on: true, ch, n: d1, vel: d2 }); else if (kind === 0x80 || kind === 0x90) ev.push({ tick, on: false, ch, n: d1 });
      }
      p = end;
    }
    tempos.sort((x, y) => x.tick - y.tick);
    const toSec = (tick) => { let sec = 0, last = 0, us = 500000; for (const tp of tempos) { if (tp.tick > tick) break; sec += (tp.tick - last) * us / 1e6 / div; last = tp.tick; us = tp.us; } return sec + (tick - last) * us / 1e6 / div; };
    ev.forEach((e) => (e.sec = toSec(e.tick)));
    return ev.sort((x, y) => x.sec - y.sec || (x.on ? 1 : 0) - (y.on ? 1 : 0));
  }

  // Builds a song from MIDI: notes are quantised to rows (song.speed frames each) and placed on free tracks, drums on the noise tracks.
  function fromMidi(bytes, base) {
    const song = newSong(base.stereo); Object.assign(song, { name: base.name, pal: base.pal, speed: base.speed, scale: { root: base.scale.root, name: base.scale.name }, loop: base.loop });
    const fps = song.pal ? 50 : 60, rowSec = song.speed / fps, ev = midiNotes(bytes), nt = song.tracks.length;
    const noise = song.stereo ? [3, 7] : [3], tonal = (song.stereo ? [0, 4, 1, 5, 2, 6] : [0, 1, 2]);
    const open = new Map(), notes = [];
    for (const e of ev) {
      const key = e.ch + ':' + e.n;
      if (e.on) { const o = open.get(key) || []; o.push({ row: Math.round(e.sec / rowSec), n: e.n, vel: e.vel, drum: e.ch === 9 }); open.set(key, o); }
      else { const o = open.get(key); if (o && o.length) { const nn = o.shift(); nn.end = Math.max(nn.row + 1, Math.round(e.sec / rowSec)); notes.push(nn); } }
    }
    for (const o of open.values()) for (const nn of o) { nn.end = nn.row + 2; notes.push(nn); }
    notes.sort((a, b) => a.row - b.row || b.n - a.n);
    const busy = new Array(nt).fill(-1), place = [];
    let dropped = 0;
    for (const nn of notes) {
      const pool = nn.drum ? noise : tonal; let t = pool.find((x) => busy[x] <= nn.row);
      if (t == null) { dropped++; continue; }
      busy[t] = nn.end; place.push({ t, row: nn.row, end: nn.end, n: nn.drum ? 36 + (nn.n % 12) : nn.n, v: Math.max(1, Math.round(nn.vel / 127 * 15)) });
    }
    const total = place.reduce((m, x) => Math.max(m, x.end), 1), PR = 32, np = Math.min(64, Math.ceil(total / PR));
    song.patterns = Array.from({ length: np }, () => newPattern(PR, nt)); song.order = song.patterns.map((_, i) => i);
    const at = (t, r) => (r < np * PR ? song.patterns[Math.floor(r / PR)].cells[t] : null);
    place.sort((a, b) => a.row - b.row);
    for (const x of place) { const c = at(x.t, x.row); if (c) c[x.row % PR] = { n: Math.max(0, Math.min(127, x.n)), v: x.v }; }
    for (const x of place) { const c = at(x.t, x.end); if (c && !c[x.end % PR]) c[x.end % PR] = { n: -1 }; }
    return { song, notes: place.length, dropped, truncated: total > np * PR, rows: total };
  }

  const inScale = (song, n) => SCALES[song.scale.name].includes(((n - song.scale.root) % 12 + 12) % 12);
  // Nearest scale note (ties go down).
  function snap(song, n) {
    for (let d = 0; d < 7; d++) { if (inScale(song, n - d)) return n - d; if (inScale(song, n + d)) return n + d; }
    return n;
  }
  // Move by whole scale degrees, so a transposed phrase stays in key.
  function degree(song, n, steps) {
    n = snap(song, n); const dir = steps < 0 ? -1 : 1;
    for (let k = Math.abs(steps); k > 0; k--) { do n += dir; while (!inScale(song, n) && n > 0 && n < 127); }
    return Math.max(0, Math.min(127, n));
  }

  return { NOTE, SCALES, WAVES, noteName, newSong, newPattern, setStereo, resizePattern, sanitize, fromMidi, midiNotes, pitch, compile, inScale, snap, degree, CLOCK };
});
