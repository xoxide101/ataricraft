// Builds the AtariCraft Audio disk: Atari DOS 2.5 enhanced density (130K) data disk with the audio tools and
// original (public domain) test files. No DOS on it: boot any DOS, then mount it as D2:.
// Usage: node tools/make-audio-disk.cjs   (run tools/tests/build.cjs first)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
global.window = global; global.AC = {};
const load = (f) => (0, eval)(fs.readFileSync(path.join(root, 'web/js', f), 'utf8'));
load('dosfs.js'); load('afmcore.js');
const C = AC.AfmCore;
const rd = (p) => new Uint8Array(fs.readFileSync(path.join(root, p)));
const atascii = (s) => new Uint8Array([...s.replace(/\r?\n/g, '\x9b')].map((c) => c.charCodeAt(0) & 255));

// STEREO.SMP: 1.8 s of tones, left only, then right only, then both. Stereo layout: left nibble high, right low.
function stereoSample() {
  const speed = 2, rate = 15720 / speed, third = Math.round(rate * 0.6), frames = third * 3, pages = Math.ceil(frames / 256);
  const out = Buffer.alloc(8 + pages * 256, 0x88);
  out.set([0x53, 0x4D, 0x50, 1, speed, pages, 2, 0], 0);
  const q = (v) => Math.max(0, Math.min(15, Math.round(7.5 + v * 7)));
  for (let i = 0; i < frames; i++) {
    const seg = Math.floor(i / third), t = i / rate;
    const l = seg !== 1 ? Math.sin(2 * Math.PI * 440 * t) : 0;
    const r = seg !== 0 ? Math.sin(2 * Math.PI * 660 * t) : 0;
    out[8 + i] = (q(l) << 4) | q(r);
  }
  return new Uint8Array(out);
}

const files = [
  ['MIDIPLAY.COM', rd('tools/tests/bin/MIDIPLAY.COM')],
  ['MP3PLAY.COM', rd('tools/tests/bin/MP3PLAY.COM')],
  ['SNDTEST.COM', rd('tools/tests/bin/SNDTEST.COM')],
  ['DEMO.PMD', rd('tools/tests/DEMO.PMD')],
  ['TEST.PMD', rd('tools/tests/TEST.PMD')],
  ['STEREO.SMP', stereoSample()],
];

const readme = `ATARICRAFT AUDIO DISK
Atari DOS 2.5 format, 130K enhanced density.
Has no DOS on it. Boot any DOS, then use this
as D2:. Run a tool: DOS menu L, then the name.

MIDIPLAY.COM  play a .PMD song
MP3PLAY.COM   play a .SMP sample, or an 8-bit
              mono/stereo .WAV
SNDTEST.COM   POKEY audio and stereo test

In the players type a file name (D2:DEMO.PMD),
then L left, R right, B both, SPACE play, any
key stops, N new file, ESC exit.

DEMO.PMD    original 16 second tune
TEST.PMD    short test tune
STEREO.SMP  tone left, then right, then both
            (needs a second POKEY to separate)

Make your own on a PC (ataricraft/tools):
 midiconv.cjs  song.mid -> .PMD
 audioconv.cjs sound.mp3 -> .SMP (--stereo)
Clips live in memory: about 8 s mono, 4 s
stereo. NTSC timing; PAL plays slow.
Test files here are public domain.
`;

const m = C.mount(AC.DosFs.createDos2({ sectors: 1040 }), 'audio.atr');
m.vol.writeFile('README.TXT', atascii(readme), true);
for (const [n, b] of files) m.vol.writeFile(n, b, true);
C.refresh(m);

const outDir = path.join(root, 'web/library/craftapps/Tools');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'AtariCraft Audio 130K.atr');
fs.writeFileSync(out, Buffer.from(m.bytes));
const m2 = C.mount(new Uint8Array(fs.readFileSync(out)), 'x');
const names = C.entries(m2).map((e) => e.name);
const miss = ['README.TXT', ...files.map((f) => f[0])].filter((n) => !names.includes(n));
console.log(m2.kind, 'free sectors', m2.vol.freeSectors(), 'files', names.length, miss.length ? 'MISSING ' + miss.join(' ') : 'all present');
for (const [n, b] of files) {
  const e = m2.vol.list().find((x) => x.name === n);
  if (!e || Buffer.compare(Buffer.from(m2.vol.read(e)), Buffer.from(b)) !== 0) { console.log('MISMATCH', n); process.exitCode = 1; }
}
