// Builds sample.bin for SNDTEST: 4096 4-bit samples (0-15), played at about 7.8 kHz (two scanlines per sample, about 0.52 s).
// Synthetic, not recorded: a falling "zap" chirp, then a two-tone beep, then a decaying noise burst.
const fs = require('fs'), path = require('path');
const N = 4096, RATE = 15720 / 2;
const out = Buffer.alloc(N);
let ph = 0, seed = 1;
for (let i = 0; i < N; i++) {
  const t = i / N; let v = 0;
  if (t < 0.4) { const f = 2400 - 2000 * (t / 0.4); ph += 2 * Math.PI * f / RATE; v = Math.sin(ph) * (1 - t / 0.4 * 0.5); }
  else if (t < 0.75) { const u = (t - 0.4) / 0.35, f = u < 0.5 ? 880 : 1320; ph += 2 * Math.PI * f / RATE; v = Math.sin(ph) * 0.8; }
  else { seed = (seed * 1103515245 + 12345) >>> 0; v = ((seed >>> 16) / 32768 - 1) * (1 - (t - 0.75) / 0.25) * 0.9; }
  out[i] = Math.max(0, Math.min(15, Math.round(7.5 + v * 7.5)));
}
fs.writeFileSync(path.join(__dirname, 'sample.bin'), out);
console.log('sample.bin', out.length);
