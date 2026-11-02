// Compiles a tracker song, packs it to a SAP, replays the SAP on the 6502 interpreter and compares POKEY writes with the frames.
const assert = require('assert');
global.window = global; global.AC = {};
const P = require('../../web/js/pmd.js'), R = require('../../web/js/rmtplay.js'), A = require('../../web/js/asm6502.js'), S = require('../../web/js/rmtsap.js'), X = require('../../web/js/sapxex.js'), T = require('../../web/js/trackcore.js'), Cpu = require('./cpu6502.cjs');

// pitch
assert.strictEqual(T.pitch(69, 'pure').audf, 72);
const low = T.pitch(36, 'pure'); assert(low.shifted >= 1 && low.audf <= 255);
assert.strictEqual(T.pitch(36, 'poly4').shifted, 0);

// scales
const s = T.newSong(true); s.scale = { root: 0, name: 'Major' };
assert.strictEqual(T.snap(s, 61), 60); assert.strictEqual(T.snap(s, 63), 62);
assert.strictEqual(T.degree(s, 60, 1), 62); assert.strictEqual(T.degree(s, 64, 1), 65); assert.strictEqual(T.degree(s, 60, -1), 59); assert.strictEqual(T.degree(s, 60, 7), 72);

// compile: lead on POKEY 0 voice 0, bass on POKEY 1 voice 0 with decay
s.speed = 3; s.patterns[0].cells[0][0] = { n: 69 }; s.patterns[0].cells[0][4] = { n: -1 };
s.patterns[0].cells[4][0] = { n: 45, v: 8 }; s.tracks[4].decay = 2; s.tracks[4].wave = 'poly4';
s.patterns.push(T.newPattern(8, 8)); s.patterns[1].cells[3][0] = { n: 60, v: 15 }; s.order = [0, 1];
const c = T.compile(s);
assert.strictEqual(c.frames.length, (16 + 8) * 3); assert.strictEqual(c.loop, 0); assert.strictEqual(c.frames[0].length, 18);
assert.strictEqual(c.frames[0][0], 72); assert.strictEqual(c.frames[0][1], 0xAC);
assert.strictEqual(c.frames[12][1] & 15, 0, 'note off at row 4');
assert.strictEqual(c.frames[0][9 + 1], 0xC8); assert.strictEqual(c.frames[2][9 + 1], 0xC7); assert.strictEqual(c.frames[4][9 + 1], 0xC6, 'decay');
assert.strictEqual(c.frames[16 * 3][6 + 1], 0x8F, 'noise track in pattern 2');

// pack -> SAP -> 6502 replay
const r = S.pack(c.frames, c.loop, true, { name: 'T' });
const sap = P.parseSap(r.sap); assert.strictEqual(sap.get('STEREO'), '');
const mem = new Uint8Array(65536); for (const b of sap.blocks) mem.set(b.data, b.start);
const regs = new Array(0x20).fill(0);
const cpu = Cpu(mem, (a, v) => { if ((a & 0xFFE0) === 0xD200) regs[a & 0x1F] = v; });
cpu.jsr(parseInt(sap.get('INIT'), 16), 0, 0, 0);
const rt = (i) => (i < 9 ? i : 0x10 + i - 9);
for (let n = 0; n < c.frames.length * 2; n++) {
  cpu.jsr(parseInt(sap.get('PLAYER'), 16), 0, 0, 0);
  const want = c.frames[n % c.frames.length];
  for (let i = 0; i < 18; i++) assert.strictEqual(regs[rt(i)], want[i], `frame ${n} reg ${i}`);
}
X.build(P.parseSap(r.sap), {});

// mono switch keeps 4 tracks
T.setStereo(s, false); assert.strictEqual(s.tracks.length, 4); assert.strictEqual(T.compile(s).frames[0].length, 9);
console.log('trackcore: all ok');
