// Writes tools/tests/DEMO.MID, a short original tune (A minor, 120 bpm, 8 bars: lead, bass, drums), made for
// testing MIDIPLAY. CC0 / public domain: no samples, no third-party melody. Then: node tools/midiconv.cjs tools/tests/DEMO.MID
const fs = require('fs'), path = require('path');
const PPQ = 480, ev = [];
const add = (t, ...b) => ev.push({ t, b });
const note = (t, len, ch, n, v) => { add(t, 0x90 | ch, n, v); add(t + len, 0x80 | ch, n, 0); };
const beat = PPQ;
const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (triad notes)
const lead = [
  [69, 72, 76, 72, 69, 72, 76, 81],
  [69, 72, 77, 72, 69, 72, 77, 76],
  [67, 72, 76, 72, 67, 72, 76, 79],
  [67, 71, 74, 71, 67, 71, 74, 72],
];
for (let bar = 0; bar < 8; bar++) {
  const t0 = bar * 4 * beat, chord = prog[bar % 4], mel = lead[bar % 4];
  for (let i = 0; i < 8; i++) {
    const n = bar >= 4 && i === 7 ? mel[i] + 2 : mel[i];
    note(t0 + i * beat / 2, beat / 2 - 20, 0, n, 96);
  }
  const root = chord[0] - 12;
  for (let i = 0; i < 8; i++) note(t0 + i * beat / 2, beat / 2 - 30, 1, i % 4 === 3 ? root + 7 : root, 90);
  for (let i = 0; i < 8; i++) note(t0 + i * beat / 2, 60, 9, 42, 60);
  for (const b of [0, 2]) note(t0 + b * beat, 60, 9, 36, 110);
  for (const b of [1, 3]) note(t0 + b * beat, 60, 9, 38, 100);
}
const tempo = Math.round(60000000 / 120);
const trk = [];
const vlq = (v) => { const o = [v & 127]; while ((v >>= 7)) o.unshift((v & 127) | 128); return o; };
trk.push(0, 0xFF, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
trk.push(0, 0xC0, 80, 0, 0xC1, 38);
ev.sort((a, b) => a.t - b.t || (a.b[0] & 0xF0) - (b.b[0] & 0xF0));
let last = 0;
for (const e of ev) { trk.push(...vlq(e.t - last), ...e.b); last = e.t; }
trk.push(0, 0xFF, 0x2F, 0);
const hdr = Buffer.from([0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255]);
const len = trk.length;
const out = Buffer.concat([hdr, Buffer.from([0x4D, 0x54, 0x72, 0x6B, len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255]), Buffer.from(trk)]);
fs.writeFileSync(path.join(__dirname, 'DEMO.MID'), out);
console.log('DEMO.MID', out.length, 'bytes');
