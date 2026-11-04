// Builds the AtariCraft Tools disk: a MyDOS 360K (1440 x 256 B) data disk.
// It carries no DOS, so it is not tied to any one OS: boot any DOS, then mount it as D2:.
// Usage: node tools/make-tools-disk.cjs   (run tools/cmd/build.cjs, tools/tests/build.cjs and tools/net/build.cjs first)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
global.window = global; global.AC = {};
const load = (f) => (0, eval)(fs.readFileSync(path.join(root, 'web/js', f), 'utf8'));
load('dosfs.js'); load('afmcore.js');
const C = AC.AfmCore;
const rd = (p) => new Uint8Array(fs.readFileSync(path.join(root, p)));
const atascii = (s) => new Uint8Array([...s.replace(/\r?\n/g, '\x9b')].map((c) => c.charCodeAt(0) & 255));

const progs = [
  ['AFM.COM', 'tools/afm/afm.com'], ['AFM80.COM', 'tools/afm/afm80.com'], ['CMD.COM', 'tools/cmd/bin/cmd.com'],
  ['VIEW.COM', 'tools/cmd/bin/view.com'], ['NANO.COM', 'tools/cmd/bin/nano.com'], ['CALC.COM', 'tools/cmd/bin/calc.com'], ['80COL.COM', 'tools/cmd/bin/80col.com'],
  ...['arc', 'zip', 'lzh', 'alf', 'zoo', 'arj', 'dcm', 'disc'].map((n) => [n.toUpperCase() + '.COM', 'tools/cmd/bin/' + n + '.com']),
  ...['KEYTEST', 'SNDTEST', 'GFXTEST', 'MEMTEST', 'CPUTEST', 'MIDIPLAY', 'MP3PLAY'].map((n) => [n + '.COM', 'tools/tests/bin/' + n + '.COM']),
  ...['PING', 'NSLOOKUP', 'TRACERT'].map((n) => [n + '.COM', 'tools/net/' + n.toLowerCase() + '.com']),
  ...['WGET', 'CURL', 'LYNX', 'JQ', 'MAIL', 'NC'].map((n) => [n + '.COM', 'tools/tests/bin/' + n + '.COM']),
  ['TEST.PMD', 'tools/tests/TEST.PMD'], ['DEMO.PMD', 'tools/tests/DEMO.PMD'], ['DEMO.MID', 'tools/tests/DEMO.MID'],
  ['MP3DEMO.SMP', 'tools/tests/audio/MP3DEMO.SMP'], ['DUAL.SMP', 'tools/tests/audio/DUAL.SMP'],
  ['MONO.WAV', 'tools/tests/audio/MONO.WAV'], ['STEREO.WAV', 'tools/tests/audio/STEREO.WAV'],
];

const readme = `ATARICRAFT TOOLS DISK
MyDOS format, 360K (1440 x 256 byte sectors).
Has no DOS on it. Boot a DOS that reads 256-byte
sectors, then use this as D2: (MyDOS, SpartaDOS,
BW-DOS). DOS 2.0/2.5 cannot read it.

Start with TOOLS.TXT (VIEW TOOLS.TXT).
Run a tool: DOS menu option L, then the name.
Free to copy and share. No third-party code.
`;

const tools = `ATARICRAFT TOOLS - WHAT EACH FILE DOES

FILE MANAGERS AND SHELL
AFM.COM    file manager, 40 columns.
AFM80.COM  the same in 80 columns.
  Browse, copy, move, delete, and open
  archives like folders.
CMD.COM    DOS-style command shell:
  DIR COPY TYPE MORE and more. HELP lists
  them. Run the tools below by name.
  Full manual: MANUAL.TXT

TEXT AND UTILITIES
NANO.COM   text editor: NANO FILE.TXT
CALC.COM   calculator: type a sum, Return
80COL.COM  80 columns: 80COL /ON or /OFF
VIEW.COM   read a text file: VIEW FILE.TXT
  W/S or Ctrl+Up/Down = 1 line
  SPACE = page down, B = page up
  T = top, E = end, ESC or Q = quit

ARCHIVE TOOLS (Q = quit at the prompt)
ARC  .ARC .PAK   ZIP  .ZIP
LZH  .LZH .LHA   ALF  .ALF
ZOO  .ZOO        ARJ  .ARJ
DCM  .DCM disk image to or from ATR
DISC ISO9660, UDF and FAT images on D9:/D10:

NETWORK (needs FujiNet N:, or the Ataricraft relay)
PING host[:port]  ping. Relay = real ICMP replies,
  else times TCP connects (port 80).
NSLOOKUP host     DNS lookup (relay, else DoH).
TRACERT host      trace route. Relay only.
WGET url         fetch a URL, show it, save
  WGET.TXT.
CURL [-i] [-d data] url  GET or POST.
LYNX url          text web browser.
JQ /path url      pick one value out of JSON.
MAIL L|R|D|S ... POP3 / SMTP mail (plain text).
NC host port     netcat. NC -l port listens.
  Tools take their arguments from CMD.COM or a prompt.

HARDWARE TESTS (PASS/FAIL colours)
KEYTEST  keyboard, console keys, joysticks
SNDTEST  POKEY audio: 4 voices, noise, sweeps,
  stereo left/right test. Keys: G guided,
  0-9 free play, D = stereo ditty (bass on
  the LEFT, melody on the RIGHT). Stereo
  needs a second POKEY.
GFXTEST  every graphics mode, I = scroll
MEMTEST  extended RAM, B = burn-in loop
CPUTEST  6502 and 65C816 instruction check
MIDIPLAY play a .MID or .PMD song: L left, R right,
  B both, SPACE play. Try DEMO.MID.
MP3PLAY  play a .SMP sample or 8-bit .WAV, same
  keys. Try MP3DEMO.SMP, DUAL.SMP (dual POKEY),
  MONO.WAV, STEREO.WAV. Make files on a PC
  with audioconv.cjs.

Not on this disk: games, BASIC programs, word
processor, spreadsheet, RAM disk.
`;

const manual = fs.readFileSync(path.join(root, 'tools/cmd/MANUAL.TXT'), 'latin1');
const bl = AC.DosFs.createMyDos({ sectors: 1440, sectorSize: 256 });
const m = C.mount(bl, 'tools.atr');
m.vol.writeFile('README.TXT', atascii(readme), true);
m.vol.writeFile('TOOLS.TXT', atascii(tools), true);
m.vol.writeFile('MANUAL.TXT', atascii(manual), true);
for (const [n, p] of progs) m.vol.writeFile(n, rd(p), true);
C.refresh(m);

const outDir = path.join(root, 'web/library/craftapps/Tools');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'AtariCraft Tools 360K.atr');
fs.writeFileSync(out, Buffer.from(m.bytes));
const m2 = C.mount(new Uint8Array(fs.readFileSync(out)), 'x');
const names = C.entries(m2).map((e) => e.name);
const miss = ['README.TXT', 'TOOLS.TXT', 'MANUAL.TXT', ...progs.map((p) => p[0])].filter((n) => !names.includes(n));
console.log(m2.kind, 'free sectors', m2.vol.freeSectors(), 'files', names.length, miss.length ? 'MISSING ' + miss.join(' ') : 'all present');
for (const [n, p] of progs) {
  const e = m2.vol.list().find((x) => x.name === n);
  if (!e || Buffer.compare(Buffer.from(m2.vol.read(e)), Buffer.from(rd(p))) !== 0) { console.log('MISMATCH', n); process.exitCode = 1; }
}
