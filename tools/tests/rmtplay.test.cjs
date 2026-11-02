// Runs RMT-exported SAP files twice: the original 6502 player on a CPU interpreter, and the JS port on the same module.
// Every call's POKEY register values must match. Usage: node rmtplay.test.cjs [more.sap ...]
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = global; global.AC = {};
const P = require('../../web/js/pmd.js'), R = require('../../web/js/rmtplay.js'), Cpu = require('./cpu6502.cjs');
const root = path.join(__dirname, '..', '..', 'software_n_roms');
const defaults = ['Eckn_Loader.sap', 'Battle_Eagle.sap', 'Xirius_Defect.sap', 'Callisto.sap', path.join('8bit', 'Atari 8-Bit', 'Music', 'R', 'Roxblox.sap'), path.join('8bit', 'Atari 8-Bit', 'Music', 'E', 'Eckn.sap')].map((f) => path.join(root, f));
const files = process.argv.length > 2 ? process.argv.slice(2) : defaults.filter((f) => fs.existsSync(f));
if (!files.length) { console.log('rmtplay: no RMT SAP files found, skipped'); process.exit(0); }
const hex = (n) => n.toString(16).toUpperCase();

function check(file, calls) {
  const sap = P.parseSap(new Uint8Array(fs.readFileSync(file)));
  const type = sap.get('TYPE'), init = parseInt(sap.get('INIT'), 16), player = parseInt(sap.get('PLAYER'), 16);
  assert.strictEqual(type, 'B', file + ': only type B is checked');
  const mem = new Uint8Array(65536);
  for (const b of sap.blocks) mem.set(b.data, b.start);
  const img = mem.slice();
  let base = -1;
  for (let a = 0; a < 0xFFF0; a++) if (mem[a] === 0x52 && mem[a + 1] === 0x4D && mem[a + 2] === 0x54 && (mem[a + 3] === 0x34 || mem[a + 3] === 0x38) && mem[a + 7] === 1) { base = a; break; }
  assert(base >= 0, file + ': no RMT module found');
  const regs = new Array(0x20).fill(0);
  const cpu = Cpu(mem, (a, v) => { if ((a & 0xFFE0) === 0xD200) regs[a & 0x1F] = v; });
  cpu.jsr(init, 0, 0, 0);
  const m = R.fromImage(img, base);
  const pl = R.player(m, { songline: 0 });
  let bad = 0, used = new Set();
  for (let n = 0; n < calls; n++) {
    cpu.jsr(player, 0, 0, 0);
    const got = pl.play();
    for (let k = 0; k < got.pokey.length; k++) {
      const q = got.pokey[k], o = k * 0x10;
      const exp = [regs[o], regs[o + 1], regs[o + 2], regs[o + 3], regs[o + 4], regs[o + 5], regs[o + 6], regs[o + 7], regs[o + 8]];
      const have = [q.audf[0], q.audc[0], q.audf[1], q.audc[1], q.audf[2], q.audc[2], q.audf[3], q.audc[3], q.audctl];
      // Silent channels (volume 0) may differ in AUDF without affecting sound; compare AUDC always, AUDF only when audible.
      for (let c = 0; c < 4; c++) {
        const audible = (exp[c * 2 + 1] & 15) !== 0 || (q.audc[c] & 15) !== 0;
        if (exp[c * 2 + 1] !== have[c * 2 + 1] || (audible && exp[c * 2] !== have[c * 2])) { if (bad++ < 5) console.log(path.basename(file), 'call', n, 'pokey', k, 'ch', c, 'real', hex(exp[c * 2]), hex(exp[c * 2 + 1]), 'port', hex(have[c * 2]), hex(have[c * 2 + 1])); }
        if (exp[c * 2 + 1] & 15) used.add(exp[c * 2 + 1] & 0xF0);
      }
      if (exp[8] !== have[8]) { if (bad++ < 5) console.log(path.basename(file), 'call', n, 'AUDCTL real', hex(exp[8]), 'port', hex(have[8])); }
    }
  }
  return { bad, name: sap.get('NAME'), tracks: m.tracks, speed: m.speed, instr: m.instrSpeed, dist: [...used].map(hex).join(',') };
}

let fail = 0;
for (const f of files) {
  const r = check(f, 3000);
  console.log(path.basename(f), JSON.stringify(r));
  if (r.bad) fail++;
}
assert.strictEqual(fail, 0, fail + ' file(s) differ from the original player');
console.log('rmtplay: all ok');
