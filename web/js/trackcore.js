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

  return { NOTE, SCALES, WAVES, noteName, newSong, newPattern, setStereo, resizePattern, pitch, compile, inScale, snap, degree, CLOCK };
});
