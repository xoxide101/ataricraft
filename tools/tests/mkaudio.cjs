// Makes the original (CC0) audio test files in tools/tests/audio: synthesised here, no third-party material.
//   MP3DEMO.SMP  mono sample made the full way: synth -> .mp3 -> audioconv (needs ffmpeg on PATH)
//   DUAL.SMP     stereo (dual POKEY) sample made the same way: melody left, bass right
//   MONO.WAV     8-bit mono 15.72 kHz canonical WAV, 1.8 s (MP3PLAY loads it directly)
//   STEREO.WAV   8-bit stereo 7.86 kHz canonical WAV, 1.8 s, melody left / bass right
// Usage: node tools/tests/mkaudio.cjs
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const dir = path.join(__dirname, 'audio'), tmp = path.join(require('os').tmpdir(), 'acaudio');
fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });

// A minor pentatonic phrase: [midi note, beats]. Plucked sine + a little 2nd harmonic.
const mel = [[69, 1], [72, 1], [76, 1], [74, 1], [72, 1], [69, 1], [67, 1], [69, 2], [64, 1], [67, 1], [69, 1], [72, 1], [69, 2], [57, 2]];
const bas = [[45, 2], [45, 2], [43, 2], [43, 2], [41, 2], [41, 2], [40, 2], [45, 2]];
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
function voice(rate, secs, notes, bpm, lo) {
  const out = new Float32Array(Math.round(rate * secs)), beat = 60 / bpm;
  let t0 = 0;
  for (const [n, b] of notes) {
    const f = hz(n), len = b * beat;
    for (let i = 0, N = Math.round(len * rate); i < N && t0 + i < out.length; i++) {
      const t = i / rate, env = Math.exp(-t * (lo ? 3 : 4)) * Math.min(1, t * 200);
      out[t0 + i] += env * (Math.sin(2 * Math.PI * f * t) + (lo ? 0.3 : 0.2) * Math.sin(4 * Math.PI * f * t));
    }
    t0 += Math.round(len * rate);
  }
  return out;
}
function wav(rate, chans, secs, bpm) {
  const m = voice(rate, secs, mel, bpm, false), b = voice(rate, secs, bas, bpm, true);
  const frames = m.length, data = Buffer.alloc(frames * chans);
  const u8 = (v) => Math.max(0, Math.min(255, Math.round(128 + v * 90)));
  for (let i = 0; i < frames; i++) {
    if (chans === 1) data[i] = u8(m[i] * 0.6 + b[i] * 0.5);
    else { data[2 * i] = u8(m[i]); data[2 * i + 1] = u8(b[i]); }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(chans, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * chans, 28);
  h.writeUInt16LE(chans, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const sh = (c, a) => { const r = spawnSync(c, a, { stdio: 'inherit' }); if (r.status !== 0) throw new Error(c + ' failed'); };

fs.writeFileSync(path.join(dir, 'MONO.WAV'), wav(15720, 1, 1.8, 130));
fs.writeFileSync(path.join(dir, 'STEREO.WAV'), wav(7860, 2, 1.8, 130));

// Longer 44.1 kHz sources, encoded to mp3 so the whole mp3 -> Atari path is exercised.
const src = (name, chans, secs) => {
  const w = wav(44100, chans, secs, 110), f = path.join(tmp, name + '.wav');
  fs.writeFileSync(f, w); sh('ffmpeg', ['-v', 'error', '-y', '-i', f, '-b:a', '128k', path.join(tmp, name + '.mp3')]);
  return path.join(tmp, name + '.mp3');
};
const ac = path.join(__dirname, '..', 'audioconv.cjs');
sh('node', [ac, src('mono', 1, 8), '--out', path.join(dir, 'MP3DEMO.SMP'), '--speed', '2']);
sh('node', [ac, src('dual', 2, 4), '--out', path.join(dir, 'DUAL.SMP'), '--speed', '2', '--stereo']);
for (const f of fs.readdirSync(dir)) console.log(f, fs.statSync(path.join(dir, f)).size);
