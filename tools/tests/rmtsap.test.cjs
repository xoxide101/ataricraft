// Builds a register-stream SAP from the RMT module inside real RMT SAP files, then replays it on the 6502 interpreter.
// The replayed POKEY writes must equal the JS player's frames, including after the song loops.
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = global; global.AC = {};
const P = require('../../web/js/pmd.js'), R = require('../../web/js/rmtplay.js'), S = require('../../web/js/rmtsap.js'), X = require('../../web/js/sapxex.js'), Cpu = require('./cpu6502.cjs');
const root = path.join(__dirname, '..', '..', 'software_n_roms');
const files = ['Eckn_Loader.sap', 'Battle_Eagle.sap', 'Callisto.sap', path.join('8bit', 'Atari 8-Bit', 'Music', 'R', 'Roxblox.sap')].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
if (!files.length) { console.log('rmtsap: no RMT SAP files found, skipped'); process.exit(0); }

function moduleOf(file) {
  const sap = P.parseSap(new Uint8Array(fs.readFileSync(file)));
  const mem = new Uint8Array(65536); for (const b of sap.blocks) mem.set(b.data, b.start);
  let base = -1;
  for (let a = 0; a < 0xFFF0; a++) if (mem[a] === 0x52 && mem[a + 1] === 0x4D && mem[a + 2] === 0x54 && mem[a + 3] === 0x34 && mem[a + 7] === 1) { base = a; break; }
  const blk = sap.blocks.find((b) => base >= b.start && base <= b.end);
  const o = [0xFF, 0xFF, base & 255, base >> 8, blk.end & 255, blk.end >> 8];
  for (let a = base; a <= blk.end; a++) o.push(mem[a]);
  return new Uint8Array(o);
}

for (const f of files) {
  const rmt = moduleOf(f);
  const r = S.build(rmt, { name: 'T', maxFrames: 4000 });
  const sap = P.parseSap(r.sap);
  assert.strictEqual(sap.get('TYPE'), 'B');
  const mem = new Uint8Array(65536); for (const b of sap.blocks) mem.set(b.data, b.start);
  const regs = new Array(0x20).fill(0);
  const cpu = Cpu(mem, (a, v) => { if ((a & 0xFFE0) === 0xD200) regs[a & 0x1F] = v; });
  cpu.jsr(parseInt(sap.get('INIT'), 16), 0, 0, 0);
  const ref = S.render(require('../../web/js/rmtplay.js').load(rmt), { maxFrames: 4000 });
  const total = ref.frames.length + (ref.loop >= 0 ? 300 : 0);
  for (let n = 0; n < total; n++) {
    cpu.jsr(parseInt(sap.get('PLAYER'), 16), 0, 0, 0);
    const want = n < ref.frames.length ? ref.frames[n] : ref.frames[ref.loop + (n - ref.frames.length)];
    assert(want, 'frame ' + n);
    for (let i = 0; i < 9; i++) assert.strictEqual(regs[i], want[i], `${path.basename(f)} frame ${n} reg ${i}`);
  }
  X.build(P.parseSap(r.sap), {});
  console.log(path.basename(f), `frames ${r.frames}, loop ${r.loop}, stream ${r.streamBytes} bytes, ${r.seconds.toFixed(1)} s`);
}
console.log('rmtsap: all ok');
