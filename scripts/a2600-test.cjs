'use strict';
// 6502 + Atari 2600 core tests. Optional ROM smoke test: set A2600_ROM to a cartridge file (images are written to %TEMP%). node scripts/a2600-test.cjs
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { Cpu6502 } = require('../web/js/cpu6502.js');
const { Console2600, detectMapper } = require('../web/js/a2600.js');
let n = 0, fail = 0;
const eq = (a, b, m) => { n++; if (a !== b) { fail++; console.log('FAIL', m, '\n  got ', a, '\n  want', b); } };

// ---- CPU: run small programs on a flat 64K bus
function cpuRun(code, setup) {
  const mem = new Uint8Array(65536); mem.set(code, 0x200); mem[0xfffc] = 0; mem[0xfffd] = 2;
  const bus = { read: (a) => mem[a], write: (a, v) => { mem[a] = v; }, ticks: 0, tick() { this.ticks++; } };
  const c = new Cpu6502(bus); c.reset(); bus.ticks = 0; if (setup) setup(c, mem);
  let cyc = 0; for (let g = 0; c.pc < 0x200 + code.length && !c.halted && g < 5000; g++) cyc += c.step();
  return { c, mem, cyc, ticks: bus.ticks };
}
let r = cpuRun([0xa9, 0x05, 0x69, 0x03]);                 // LDA #5, ADC #3
eq(r.c.a, 8, 'ADC'); eq(r.cyc, 4, 'LDA#+ADC# cycles'); eq(r.ticks, 4, 'ticks match cycles');
r = cpuRun([0xf8, 0x18, 0xa9, 0x19, 0x69, 0x28]);          // SED CLC LDA #$19 ADC #$28 -> $47
eq(r.c.a, 0x47, 'BCD ADC');
r = cpuRun([0xf8, 0x38, 0xa9, 0x50, 0xe9, 0x11]);          // SED SEC LDA #$50 SBC #$11 -> $39
eq(r.c.a, 0x39, 'BCD SBC');
r = cpuRun([0xa2, 0x03, 0xca, 0xd0, 0xfd]);               // LDX #3; loop DEX BNE
eq(r.c.x, 0, 'DEX/BNE loop'); eq(r.cyc, 2 + 3 * 2 + 2 * 3 + 2, 'branch taken/not taken cycles');
r = cpuRun([0x20, 0x06, 0x02, 0x4c, 0x0a, 0x02, 0xa9, 0x42, 0x60, 0xea]); // JSR sub; JMP past end; sub: LDA #$42 RTS
eq(r.c.a, 0x42, 'JSR/RTS'); eq(r.c.sp, 0xfd, 'stack balanced');
r = cpuRun([0xa2, 0x01, 0xbd, 0xff, 0x02, 0xa9, 0x00], (c, m) => { m[0x300] = 0x77; }); // LDA $02FF,X crosses page
eq(r.c.a, 0, 'LDA abs,X executed'); eq(r.cyc, 2 + 5 + 2, 'page-cross cycle penalty');
r = cpuRun([0xa9, 0x80, 0x0a, 0x2a]);                    // ASL A -> 0 carry; ROL A -> 1
eq(r.c.a, 1, 'ASL/ROL');
r = cpuRun([0x6c, 0x10, 0x02, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0x15, 0x02, 0x00, 0x00], null);
eq(r.c.pc >= 0x200, true, 'JMP indirect runs');

// ---- 2600: tiny hand-made cartridge draws a solid playfield and runs the timer
function cart(prog) { const rom = new Uint8Array(4096).fill(0xea); rom.set(prog, 0); rom[0xffc] = 0; rom[0xffd] = 0xf0; return rom; }
const prog = [
  0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0x00,                 // SEI CLD LDX #$FF TXS LDA #0
  0x85, 0x09,                                               // STA COLUBK? (set later)
  0xa9, 0x44, 0x85, 0x08, 0xa9, 0xff, 0x85, 0x0d, 0x85, 0x0e, 0x85, 0x0f, // COLUPF=$44, PF0/1/2=$FF
  0xa9, 0x0e, 0x85, 0x06, 0xa9, 0xff, 0x85, 0x1b, 0xa9, 0x00, 0x85, 0x10, // COLUP0 white, GRP0=$FF, RESP0
  // frame loop @ $F020
  0xa9, 0x02, 0x85, 0x00, 0x85, 0x02, 0x85, 0x02, 0x85, 0x02, 0xa9, 0x00, 0x85, 0x00, // VSYNC 3 lines
  0xa2, 0xff, 0x85, 0x02, 0xca, 0xd0, 0xfb,                 // 229 WSYNC lines
  0x4c, 0x20, 0xf0,
];
const rom = cart(prog);
// patch the loop target: frame loop begins after the setup bytes
let loop = 0; for (let i = 0; i < prog.length - 3; i++) if (prog[i] === 0xa9 && prog[i + 1] === 0x02 && prog[i + 2] === 0x85 && prog[i + 3] === 0x00) { loop = i; break; }
rom[prog.length - 2] = loop & 0xff; rom[prog.length - 1] = 0xf0 | (loop >> 8);
const con = new Console2600(); con.load(rom);
let ok = 0; for (let f = 0; f < 6; f++) if (con.runFrame()) ok++;
eq(ok, 6, 'runFrame completes frames from VSYNC');
const lines = con.tia.lines; eq(lines >= 255 && lines <= 270, true, 'frame has ~262 lines (got ' + lines + ')');
const px = (x, y) => con.tia.out[y * 160 + x];
const midY = con.window().top + 20;
eq(px(5, midY) !== 0xff000000 && px(5, midY) === px(150, midY), true, 'playfield fills both halves');
eq(detectMapper(new Uint8Array(4096)), '4K', 'detect 4K'); eq(detectMapper(new Uint8Array(8192)), 'F8', 'detect F8 default');
eq(detectMapper(new Uint8Array(16384)), 'F6', 'detect F6'); eq(detectMapper(new Uint8Array(32768)), 'F4', 'detect F4');

// RIOT timer: TIM64T then read INTIM after ~128 cycles
const c2 = new Console2600(); c2.load(cart([0xea]));
c2.write(0x296, 10); for (let i = 0; i < 64 * 3; i++) c2.tick();
eq(c2.read(0x284), 7, 'INTIM counts down every 64 cycles');
for (let i = 0; i < 64 * 20; i++) c2.tick();
eq((c2.read(0x285) & 0x80) !== 0, true, 'INSTAT underflow flag');

// Joystick / switches read back active-low
const c3 = new Console2600(); c3.load(cart([0xea])); c3.input.p0.up = 1; c3.input.p0.fire = 1; c3.input.reset = 1; c3.applyInput();
eq(c3.read(0x280) & 0x10, 0, 'SWCHA up pressed = 0'); eq(c3.read(0x08c | 0x0c) & 0x80, 0, 'INPT4 fire pressed = 0'); eq(c3.read(0x282) & 1, 0, 'SWCHB reset pressed = 0');

// ---- Optional real-ROM smoke test with PNG dump
function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const romPath = process.env.A2600_ROM;
if (romPath && fs.existsSync(romPath)) {
  const g = new Console2600(); g.load(new Uint8Array(fs.readFileSync(romPath)));
  g.input.p0.fire = 1; g.applyInput(); let got = 0; for (let f = 0; f < 180; f++) if (g.runFrame()) got++;
  const win = g.window(), w = 160, h = win.height, buf = Buffer.alloc(w * h * 4);
  const colors = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = g.tia.out[(win.top + y) * w + x]; colors.add(v); buf.writeUInt32LE(v >>> 0, (y * w + x) * 4); }
  const out = path.join(os.tmpdir(), 'a2600-' + path.basename(romPath).replace(/\W+/g, '_') + '.png'); fs.writeFileSync(out, png(w, h, buf));
  console.log('ROM', path.basename(romPath), 'mapper', g.mapper, 'frames', got, 'colours', colors.size, 'lines', g.tia.lines, '->', out);
  eq(got >= 170, true, 'ROM produces frames'); eq(colors.size > 2, true, 'ROM draws more than two colours');
}
console.log(`a2600-test: ${n} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
