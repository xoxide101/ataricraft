// Convert any audio file (mp3, wav, ogg, flac...) to a 4-bit sample file for MP3PLAY.COM. Needs ffmpeg on PATH to decode.
//   node tools/audioconv.cjs <in> [--out NAME.SMP] [--speed 2] [--secs N] [--start S] [--gain 1.0]
// --speed = scanlines per sample: 1 = 15.7 kHz (about 3.9 s fits), 2 = 7.86 kHz (7.8 s, default), 3 = 5.24 kHz (11.7 s).
// File layout: 'S','M','P',1, speed, pages, 0, 0, then packed nibbles (high nibble first), 256-byte pages.
// The player holds the whole clip in RAM ($4000-$B7FF = 30720 bytes incl. 8-byte header, so 119 pages).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args[0];
if (!input || input.startsWith('--')) { console.log('usage: node tools/audioconv.cjs <in> [--out NAME.SMP] [--stereo] [--speed 1|2|3] [--secs N] [--start S] [--gain G]'); process.exit(1); }
const speed = +opt('--speed', 2), gain = +opt('--gain', 1), ch = args.includes('--stereo') ? 2 : 1;
if (![1, 2, 3].includes(speed)) { console.log('--speed must be 1, 2 or 3'); process.exit(1); }
const rate = 15720 / speed, MAXPAGES = 119, maxSamples = MAXPAGES * 512 / ch;
const secs = Math.min(+opt('--secs', maxSamples / rate), maxSamples / rate), start = +opt('--start', 0);
const ff = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(secs), '-i', input, '-ac', String(ch), '-ar', String(Math.round(rate)), '-af', 'highpass=f=40,loudnorm=I=-14:TP=-1:LRA=7', '-f', 'u8', '-'], { maxBuffer: 1 << 28 });
if (ff.error || ff.status !== 0) { console.log('ffmpeg failed: ' + (ff.error ? ff.error.message : ff.stderr.toString())); process.exit(1); }
const pcm = ff.stdout;
const frames = Math.floor(pcm.length / ch);
let n = Math.min(frames, maxSamples);
const pages = Math.max(1, Math.ceil(n * ch / 512));
const q = new Uint8Array(pages * 512).fill(8);
const errs = [0, 0];
let seed = 12345;
for (let i = 0; i < n * ch; i++) {
  const side = i % ch;
  let v = ((pcm[i] - 128) / 128) * gain;
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const x = 7.5 + v * 7.5 + ((seed >>> 8) / 16777216 - 0.5) * 0.9 + errs[side];
  const c = Math.max(0, Math.min(15, Math.round(x)));
  errs[side] = (x - c) * 0.5;
  q[i] = c;
}
const out = Buffer.alloc(8 + pages * 256);
out.set([0x53, 0x4D, 0x50, 1, speed, pages, ch, 0], 0);
for (let i = 0; i < pages * 256; i++) out[8 + i] = (q[i * 2] << 4) | q[i * 2 + 1];
const dest = opt('--out', path.basename(input, path.extname(input)).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '.SMP');
fs.writeFileSync(dest, out);
console.log(`${dest}: ${(n / rate).toFixed(2)} s  at ${rate.toFixed(0)} Hz, ${pages} pages, ${out.length} bytes${frames > n ? ' (clipped to fit RAM)' : ''}`);
