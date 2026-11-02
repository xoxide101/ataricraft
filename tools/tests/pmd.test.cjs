// Checks the MIDI -> PMD converter on a synthetic file: classic mode is stable, smart mode keeps bass and melody and arpeggiates the rest.
const assert = require('assert'), P = require('../../web/js/pmd.js');
const midi = (evs) => { // evs: [deltaTicks, ...bytes]
  const t = []; for (const [d, ...b] of evs) { const v = []; let x = d; v.unshift(x & 127); while ((x >>= 7)) v.unshift((x & 127) | 128); t.push(...v, ...b); }
  t.push(0, 0xFF, 0x2F, 0);
  const h = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xE0], k = [0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, 0];
  k[4] = (t.length >>> 24) & 255; k[5] = (t.length >>> 16) & 255; k[6] = (t.length >>> 8) & 255; k[7] = t.length & 255;
  return Uint8Array.from([...h, ...k, ...t]);
};
const chord = [60, 64, 67, 71, 74, 79];
const song = midi([[0, 0x90, 36, 100], ...chord.map((n) => [0, 0x90, n, 100]), [0, 0x99, 38, 120], [480, 0x80, 36, 0], ...chord.map((n) => [0, 0x80, n, 0]), [0, 0x89, 38, 0]]);

const c = P.convert(song);
assert.strictEqual(P.convert(song, { smart: false }).pmd.length, c.pmd.length, 'smart:false is the classic path');
assert(!c.smart);

const s = P.convert(song, { smart: true });
assert(s.smart && s.shared > 0, 'chord notes were shared');
const ev = P.events(s.pmd, 60).list;
const at = (t) => { const st = new Array(8).fill(0); for (const e of ev) if (e.t <= t) st[e.reg] = e.val; return st; };
const st = at(0.2);
const tones = [0, 2, 4, 6].map((v) => ({ f: st[v], c: st[v + 1] })).filter((x) => x.c & 15);
assert(tones.some((x) => (x.c & 0xE0) === 0xC0), 'low note uses poly4 distortion');
assert(tones.some((x) => (x.c & 0xE0) === 0xA0), 'melody uses pure tone');
const hz = (f) => 63921 / (2 * (f + 1));
assert(tones.filter((x) => (x.c & 0xE0) === 0xA0).some((x) => Math.abs(hz(x.f) - 784) < 25), 'highest note (G5, 784 Hz) kept');
assert(Math.abs(63921 / (15 * (tones.find((x) => (x.c & 0xE0) === 0xC0).f + 1)) - 65.4) < 1.5, 'bass C2 at about 65.4 Hz');
const arpFreqs = new Set(); for (let f = 1; f < 20; f++) { const q = at(f / 60); arpFreqs.add(q.slice(0, 8).join()); }
assert(arpFreqs.size > 3, 'state changes frame to frame (arpeggio)');
assert(s.pmd[s.pmd.length - 3 + 1] === 0xFF, 'ends with the end record');
console.log('pmd: all ok, smart', s.pmd.length, 'bytes, classic', c.pmd.length, 'bytes');
