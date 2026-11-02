const assert = require('assert');
global.window = global; global.AC = {};
const T = require('../../web/js/trackcore.js');
const vlq = (n) => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
function midi(events, div = 96) { // events: [tick, status, d1, d2]
  const tr = [0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20]; let last = 0;
  for (const [t, s, a, b] of events.sort((x, y) => x[0] - y[0])) { tr.push(...vlq(t - last), s, a, b); last = t; }
  tr.push(0, 0xFF, 0x2F, 0);
  return new Uint8Array([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, div, 0x4D, 0x54, 0x72, 0x6B, tr.length >>> 24, 0, tr.length >> 8 & 255, tr.length & 255, ...tr]);
}
// 120 bpm, 96 ppq: a beat = 0.5 s = 30 frames; speed 6 => 5 rows per beat
const base = T.newSong(true); base.speed = 6;
const ev = [[0, 0x90, 60, 100], [96, 0x80, 60, 0], [96, 0x90, 64, 100], [192, 0x80, 64, 0], [0, 0x90, 67, 80], [192, 0x80, 67, 0], [0, 0x99, 38, 120], [48, 0x89, 38, 0]];
for (let i = 0; i < 5; i++) ev.push([0, 0x90, 50 + i, 90], [96, 0x80, 50 + i, 0]); // 5 extra at once: exceeds 6 tonal tracks with the other 3 -> some dropped
const r = T.fromMidi(midi(ev), base);
assert.strictEqual(r.notes + r.dropped, 9);
assert(r.dropped >= 1, 'voice limit drops notes: ' + r.dropped);
const c0 = r.song.patterns[0].cells;
assert(c0.some((t) => t[0] && t[0].n === 60), 'C4 at row 0');
const t = c0.findIndex((tr) => tr[5] && tr[5].n === 64); assert(t >= 0, 'E4 at row 5 (one beat)');
assert(c0[3][0] && c0[3][0].n >= 36, 'drum on noise track 3');
assert(r.song.patterns[0].cells.every((tr) => tr.length === 32));
assert.strictEqual(T.compile(r.song).frames[0].length, 18);
assert.strictEqual(T.sanitize(JSON.parse(JSON.stringify(r.song))).tracks.length, 8);
assert.throws(() => T.fromMidi(new Uint8Array([1, 2, 3]), base), /not a MIDI/);
const m = T.fromMidi(midi(ev), T.newSong(false)); assert.strictEqual(m.song.tracks.length, 4); assert(m.dropped > r.dropped);
console.log('midi import ok:', r.notes, 'placed,', r.dropped, 'dropped; mono', m.notes, 'placed');
