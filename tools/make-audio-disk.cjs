// Builds the AtariCraft Audio disk: MyDOS 180K (720 x 256 B) data disk with the audio tools and
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
  ['DEMO.MID', rd('tools/tests/DEMO.MID')],
  ['TEST.PMD', rd('tools/tests/TEST.PMD')],
  ['STEREO.SMP', stereoSample()],
  ['MP3DEMO.SMP', rd('tools/tests/audio/MP3DEMO.SMP')],
  ['DUAL.SMP', rd('tools/tests/audio/DUAL.SMP')],
  ['MONO.WAV', rd('tools/tests/audio/MONO.WAV')],
  ['STEREO.WAV', rd('tools/tests/audio/STEREO.WAV')],
];

const readme = `ATARICRAFT AUDIO DISK
MyDOS format, 180K (720 x 256 byte sectors).
Has no DOS on it. Boot MyDOS (or SpartaDOS,
BW-DOS), then use this as D2:. Run a tool: DOS menu L, then the name.

MIDIPLAY.COM  play a .PMD song
MP3PLAY.COM   play a .SMP sample, or an 8-bit
              mono/stereo .WAV
SNDTEST.COM   POKEY audio and stereo test

In the players type a file name (D2:DEMO.PMD),
then L left, R right, B both, SPACE play, any
key stops, N new file, ESC exit.

DEMO.PMD    original 16 second tune
DEMO.MID    same tune as a MIDI file (MIDIPLAY reads .MID directly)
TEST.PMD    short test tune
STEREO.SMP  tone left, then right, then both
            (needs a second POKEY to separate)
MP3DEMO.SMP 7.8 s mono sample (synth -> mp3 ->
            audioconv)
DUAL.SMP    3.9 s dual POKEY sample, melody left,
            bass right
MONO.WAV    8-bit mono WAV, MP3PLAY loads it as is
STEREO.WAV  8-bit stereo WAV, melody L, bass R

Make your own on a PC (ataricraft/tools):
 midiconv.cjs  song.mid -> .PMD
 audioconv.cjs sound.mp3 -> .SMP (--stereo)
Clips live in memory: about 8 s mono, 4 s
stereo. NTSC timing; PAL plays slow.
Test files here are public domain.
`;

const m = C.mount(AC.DosFs.createMyDos({ sectors: 720, sectorSize: 256 }), 'audio.atr');
m.vol.writeFile('README.TXT', atascii(readme), true);
for (const [n, b] of files) m.vol.writeFile(n, b, true);
C.refresh(m);

const outDir = path.join(root, 'web/library/craftapps/Tools');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'AtariCraft Audio 180K.atr');
fs.writeFileSync(out, Buffer.from(m.bytes));
const m2 = C.mount(new Uint8Array(fs.readFileSync(out)), 'x');
const names = C.entries(m2).map((e) => e.name);
const miss = ['README.TXT', ...files.map((f) => f[0])].filter((n) => !names.includes(n));
console.log(m2.kind, 'free sectors', m2.vol.freeSectors(), 'files', names.length, miss.length ? 'MISSING ' + miss.join(' ') : 'all present');
for (const [n, b] of files) {
  const e = m2.vol.list().find((x) => x.name === n);
  if (!e || Buffer.compare(Buffer.from(m2.vol.read(e)), Buffer.from(b)) !== 0) { console.log('MISMATCH', n); process.exitCode = 1; }
}
