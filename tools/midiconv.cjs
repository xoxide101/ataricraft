// Convert a Standard MIDI File (format 0 or 1) to a POKEY music file for MIDIPLAY.COM.
//   node tools/midiconv.cjs <in.mid> [--out NAME.PMD] [--pal] [--drums] [--nodrums]
// 4 voices (one POKEY, pure tones, 64 kHz clock). Notes below about B2 are moved up octaves, too high ones down.
// The player routes the same data to the left POKEY, the right POKEY, or both.
// File layout: 'P','M','D',1, then 3-byte records: frames to wait before it, register 0-7 (AUDF1,AUDC1,AUDF2,...), value.
// A record with register $FF ends the song. Timed at 60 Hz (NTSC), or 50 Hz with --pal.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args[0];
if (!input || input.startsWith('--')) { console.log('usage: node tools/midiconv.cjs <in.mid> [--out NAME.PMD] [--pal] [--nodrums]'); process.exit(1); }
const FPS = args.includes('--pal') ? 50 : 60, drums = !args.includes('--nodrums');
const b = fs.readFileSync(input);
if (b.toString('latin1', 0, 4) !== 'MThd') { console.log('not a MIDI file'); process.exit(1); }
const fmt = b.readUInt16BE(8), ntr = b.readUInt16BE(10), div = b.readUInt16BE(12);
if (div & 0x8000) { console.log('SMPTE time division is not supported'); process.exit(1); }
const ev = [], tempos = [{ tick: 0, us: 500000 }];
let p = 14;
for (let t = 0; t < ntr && p < b.length; t++) {
  if (b.toString('latin1', p, p + 4) !== 'MTrk') break;
  const end = p + 8 + b.readUInt32BE(p + 4); p += 8;
  let tick = 0, run = 0;
  const vl = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7F); } while (c & 0x80); return v; };
  while (p < end) {
    tick += vl();
    let s = b[p];
    if (s === 0xFF) { const type = b[p + 1]; p += 2; const len = vl(); if (type === 0x51 && len === 3) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] }); p += len; continue; }
    if (s === 0xF0 || s === 0xF7) { p++; p += vl(); continue; }
    if (s & 0x80) { run = s; p++; } else s = run;
    const kind = s & 0xF0, ch = s & 15;
    if (kind === 0xC0 || kind === 0xD0) { p++; continue; }
    const d1 = b[p++], d2 = b[p++];
    if (kind === 0x90 && d2 > 0) ev.push({ tick, on: true, ch, n: d1, vel: d2 });
    else if (kind === 0x80 || kind === 0x90) ev.push({ tick, on: false, ch, n: d1 });
  }
  p = end;
}
tempos.sort((x, y) => x.tick - y.tick);
const toSec = (tick) => {
  let sec = 0, lastT = 0, us = 500000;
  for (const tp of tempos) { if (tp.tick > tick) break; sec += (tp.tick - lastT) * us / 1e6 / div; lastT = tp.tick; us = tp.us; }
  return sec + (tick - lastT) * us / 1e6 / div;
};
ev.forEach((e) => (e.f = Math.round(toSec(e.tick) * FPS)));
ev.sort((x, y) => x.f - y.f || (x.on ? 1 : 0) - (y.on ? 1 : 0));

const audf = (note) => {
  let n = note;
  while (n < 47) n += 12;
  while (n > 108) n -= 12;
  const f = 440 * Math.pow(2, (n - 69) / 12);
  return Math.max(0, Math.min(255, Math.round(63921 / (2 * f)) - 1));
};
const drumF = (n) => (n <= 36 ? 150 : n <= 40 ? 60 : n <= 44 ? 12 : 30);   // noise pitch: kick low, snare mid, hats high
const voices = [0, 1, 2, 3].map((i) => ({ i, ch: -1, n: -1, born: 0, until: 0 }));
const recs = [], state = new Array(8).fill(-1);
let curF = 0, lastF = 0;
const put = (reg, val) => {
  if (state[reg] === val) return;
  state[reg] = val;
  let d = curF - lastF;
  while (d > 255) { recs.push([255, 0xFE, 0]); d -= 255; }
  recs.push([d, reg, val]); lastF = curF;
};
const frames = ev.length ? ev[ev.length - 1].f : 0;
let i = 0, notes = 0, dropped = 0;
for (let f = 0; f <= frames + 1; f++) {
  curF = f;
  for (const v of voices) if (v.until && v.until <= f) { put(v.i * 2 + 1, 0); v.ch = -1; v.until = 0; }
  while (i < ev.length && ev[i].f <= f) {
    const e = ev[i++];
    if (e.ch === 9) {
      if (!drums || !e.on) continue;
      const v = voices.find((x) => x.ch < 0);
      if (!v) { dropped++; continue; }
      v.ch = 9; v.n = -1; v.born = f; v.until = f + 3;
      put(v.i * 2, drumF(e.n)); put(v.i * 2 + 1, 0x80 | Math.max(4, Math.round(e.vel / 127 * 15)));
      notes++; continue;
    }
    if (e.on) {
      let v = voices.find((x) => x.ch < 0);
      if (!v) { v = voices.filter((x) => x.ch !== 9).sort((a, c) => a.born - c.born)[0]; if (!v) { dropped++; continue; } dropped++; }
      v.ch = e.ch; v.n = e.n; v.born = f; v.until = 0;
      put(v.i * 2, audf(e.n)); put(v.i * 2 + 1, 0xA0 | Math.max(3, Math.round(e.vel / 127 * 15)));
      notes++;
    } else {
      const v = voices.find((x) => x.ch === e.ch && x.n === e.n);
      if (v) { put(v.i * 2 + 1, 0); v.ch = -1; v.n = -1; }
    }
  }
}
for (let k = 0; k < 4; k++) { curF = frames + 2; put(k * 2 + 1, 0); }
recs.push([0, 0xFF, 0]);
const out = Buffer.alloc(4 + recs.length * 3);
out.write('PMD\x01', 0, 'latin1');
recs.forEach((r, k) => { out[4 + k * 3] = r[0]; out[5 + k * 3] = r[1]; out[6 + k * 3] = r[2]; });
const dest = opt('--out', path.basename(input, path.extname(input)).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '.PMD');
fs.writeFileSync(dest, out);
console.log(`${dest}: ${(frames / FPS).toFixed(1)} s, ${notes} notes (${dropped} stolen or dropped for the 4-voice limit), ${recs.length} records, ${out.length} bytes${out.length > 30720 ? '  TOO BIG for the player (30720 max)' : ''}`);
