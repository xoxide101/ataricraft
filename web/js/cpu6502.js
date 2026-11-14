// NMOS 6502 core shared by the 2600 and 7800 console cores. DOM-free, runs in Node tests.
// Every bus access calls bus.tick() once, so video chips stay in step with the CPU; internal cycles are padded at the end of each instruction.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Cpu6502 = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  // Base cycle counts per opcode; 0 marks an undefined opcode (treated as a 2-cycle NOP).
  const CYC = [
    7, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
    6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
    6, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
    6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
    2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, 2, 6, 0, 6, 4, 4, 4, 4, 2, 5, 2, 5, 5, 5, 5, 5,
    2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4, 2, 5, 0, 5, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 4,
    2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
    2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  ];
  // Addressing modes: 0 imp, 1 acc, 2 imm, 3 zp, 4 zpx, 5 zpy, 6 abs, 7 abx, 8 aby, 9 inx, 10 iny, 11 ind, 12 rel
  const MODE = new Uint8Array(256).fill(0);
  const setMode = (m, list) => { for (const o of list) MODE[o] = m; };
  setMode(1, [0x0a, 0x2a, 0x4a, 0x6a]);
  setMode(2, [0x09, 0x29, 0x49, 0x69, 0xa0, 0xa2, 0xa9, 0xc0, 0xc9, 0xe0, 0xe9, 0x80, 0x82, 0x89, 0xc2, 0xe2, 0x0b, 0x2b, 0x4b, 0x6b, 0xab, 0xcb, 0xeb]);
  setMode(3, [0x05, 0x06, 0x24, 0x25, 0x26, 0x45, 0x46, 0x65, 0x66, 0x84, 0x85, 0x86, 0xa4, 0xa5, 0xa6, 0xc4, 0xc5, 0xc6, 0xe4, 0xe5, 0xe6, 0x04, 0x44, 0x64, 0x07, 0x27, 0x47, 0x67, 0x87, 0xa7, 0xc7, 0xe7]);
  setMode(4, [0x15, 0x16, 0x35, 0x36, 0x55, 0x56, 0x75, 0x76, 0x94, 0x95, 0xb4, 0xb5, 0xd5, 0xd6, 0xf5, 0xf6, 0x14, 0x34, 0x54, 0x74, 0xd4, 0xf4, 0x17, 0x37, 0x57, 0x77, 0xd7, 0xf7]);
  setMode(5, [0x96, 0xb6, 0x97, 0xb7]);
  setMode(6, [0x0c, 0x0d, 0x0e, 0x20, 0x2c, 0x2d, 0x2e, 0x4c, 0x4d, 0x4e, 0x6d, 0x6e, 0x8c, 0x8d, 0x8e, 0xac, 0xad, 0xae, 0xcc, 0xcd, 0xce, 0xec, 0xed, 0xee, 0x0f, 0x2f, 0x4f, 0x6f, 0x8f, 0xaf, 0xcf, 0xef]);
  setMode(7, [0x1c, 0x1d, 0x1e, 0x3c, 0x3d, 0x3e, 0x5c, 0x5d, 0x5e, 0x7c, 0x7d, 0x7e, 0x9d, 0xbc, 0xbd, 0xdc, 0xdd, 0xde, 0xfc, 0xfd, 0xfe, 0x1f, 0x3f, 0x5f, 0x7f, 0xdf, 0xff]);
  setMode(8, [0x19, 0x39, 0x59, 0x79, 0x99, 0xb9, 0xbe, 0xd9, 0xf9, 0x1b, 0x3b, 0x5b, 0x7b, 0xdb, 0xfb, 0xbf]);
  setMode(9, [0x01, 0x21, 0x41, 0x61, 0x81, 0xa1, 0xc1, 0xe1, 0x03, 0x23, 0x43, 0x63, 0x83, 0xa3, 0xc3, 0xe3]);
  setMode(10, [0x11, 0x31, 0x51, 0x71, 0x91, 0xb1, 0xd1, 0xf1, 0x13, 0x33, 0x53, 0x73, 0xb3, 0xd3, 0xf3]);
  setMode(11, [0x6c]);
  setMode(12, [0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]);
  // Opcodes whose indexed read takes an extra cycle on a page crossing (stores and read-modify-write always pay it, already in CYC).
  const PAGE = new Uint8Array(256);
  for (const o of [0x1d, 0x3d, 0x5d, 0x7d, 0xbd, 0xdd, 0xfd, 0xbc, 0x19, 0x39, 0x59, 0x79, 0xb9, 0xd9, 0xf9, 0xbe, 0x11, 0x31, 0x51, 0x71, 0xb1, 0xd1, 0xf1, 0xbf, 0xb3, 0x1c, 0x3c, 0x5c, 0x7c, 0xdc, 0xfc]) PAGE[o] = 1;

  class Cpu6502 {
    constructor(bus) {
      this.bus = bus; this.a = 0; this.x = 0; this.y = 0; this.sp = 0xfd; this.pc = 0;
      this.n = 0; this.v = 0; this.d = 0; this.i = 1; this.z = 0; this.c = 0;
      this.cycles = 0; this.nmiPending = false; this.irqLine = false; this.accesses = 0; this.halted = false;
    }
    reset() { this.sp = 0xfd; this.i = 1; this.pc = this.rd(0xfffc) | (this.rd(0xfffd) << 8); this.cycles += 7; }
    rd(a) { this.accesses++; if (this.bus.tick) this.bus.tick(); return this.bus.read(a & 0xffff) & 0xff; }
    wr(a, v) { this.accesses++; if (this.bus.tick) this.bus.tick(); this.bus.write(a & 0xffff, v & 0xff); }
    get p() { return (this.n << 7) | (this.v << 6) | 0x20 | (this.d << 3) | (this.i << 2) | (this.z << 1) | this.c; }
    set p(b) { this.n = (b >> 7) & 1; this.v = (b >> 6) & 1; this.d = (b >> 3) & 1; this.i = (b >> 2) & 1; this.z = (b >> 1) & 1; this.c = b & 1; }
    push(v) { this.wr(0x100 + this.sp, v); this.sp = (this.sp - 1) & 0xff; }
    pull() { this.sp = (this.sp + 1) & 0xff; return this.rd(0x100 + this.sp); }
    nz(v) { this.n = (v >> 7) & 1; this.z = v === 0 ? 1 : 0; return v; }
    interrupt(vec, brk) {
      this.rd(this.pc); this.rd(this.pc);
      this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p | (brk ? 0x10 : 0)); this.i = 1;
      this.pc = this.rd(vec) | (this.rd(vec + 1) << 8);
    }
    // Resolves the operand address for a mode. Returns -1 for implied/accumulator.
    ea(mode, op) {
      let a, b;
      switch (mode) {
        case 2: a = this.pc; this.pc = (this.pc + 1) & 0xffff; return a;
        case 3: a = this.rd(this.pc++); this.pc &= 0xffff; return a;
        case 4: a = this.rd(this.pc++); this.pc &= 0xffff; this.rd(a); return (a + this.x) & 0xff;
        case 5: a = this.rd(this.pc++); this.pc &= 0xffff; this.rd(a); return (a + this.y) & 0xff;
        case 6: a = this.rd(this.pc) | (this.rd(this.pc + 1) << 8); this.pc = (this.pc + 2) & 0xffff; return a;
        case 7: case 8: {
          a = this.rd(this.pc) | (this.rd(this.pc + 1) << 8); this.pc = (this.pc + 2) & 0xffff;
          b = (a + (mode === 7 ? this.x : this.y)) & 0xffff;
          if (PAGE[op] && ((a ^ b) & 0xff00)) { this.rd((a & 0xff00) | (b & 0xff)); } else if (!PAGE[op]) this.rd((a & 0xff00) | (b & 0xff));
          return b;
        }
        case 9: b = (this.rd(this.pc++) + this.x) & 0xff; this.pc &= 0xffff; this.rd(b); return this.rd(b) | (this.rd((b + 1) & 0xff) << 8);
        case 10: {
          b = this.rd(this.pc++); this.pc &= 0xffff;
          a = this.rd(b) | (this.rd((b + 1) & 0xff) << 8); const r = (a + this.y) & 0xffff;
          if (PAGE[op] && ((a ^ r) & 0xff00)) this.rd((a & 0xff00) | (r & 0xff)); else if (!PAGE[op]) this.rd((a & 0xff00) | (r & 0xff));
          return r;
        }
        case 11: { a = this.rd(this.pc) | (this.rd(this.pc + 1) << 8); this.pc = (this.pc + 2) & 0xffff; return this.rd(a) | (this.rd((a & 0xff00) | ((a + 1) & 0xff)) << 8); }
        default: return -1;
      }
    }
    adc(m) {
      if (this.d) {
        const bin = this.a + m + this.c; this.z = (bin & 0xff) === 0 ? 1 : 0;
        let al = (this.a & 15) + (m & 15) + this.c; if (al >= 10) al = ((al + 6) & 15) + 16;
        let s = (this.a & 0xf0) + (m & 0xf0) + al;
        this.n = (s >> 7) & 1; this.v = (~(this.a ^ m) & (this.a ^ s) & 0x80) ? 1 : 0;
        if (s >= 0xa0) s += 0x60;
        this.c = s >= 0x100 ? 1 : 0; this.a = s & 0xff;
      } else {
        const r = this.a + m + this.c; this.v = (~(this.a ^ m) & (this.a ^ r) & 0x80) ? 1 : 0; this.c = r > 255 ? 1 : 0; this.a = this.nz(r & 0xff);
      }
    }
    sbc(m) {
      if (this.d) {
        const a0 = this.a, c0 = this.c, d0 = this.d; this.d = 0; this.adc(m ^ 0xff); this.d = d0;
        let al = (a0 & 15) - (m & 15) + c0 - 1; if (al < 0) al = ((al - 6) & 15) - 16;
        let s = (a0 & 0xf0) - (m & 0xf0) + al; if (s < 0) s -= 0x60;
        this.a = s & 0xff;
      } else this.adc(m ^ 0xff);
    }
    cmp(r, m) { const t = r - m; this.c = t >= 0 ? 1 : 0; this.nz(t & 0xff); }
    branch(cond) {
      const off = this.rd(this.pc++); this.pc &= 0xffff;
      if (cond) { this.rd(this.pc); const o = (off << 24) >> 24, t = (this.pc + o) & 0xffff; if ((t ^ this.pc) & 0xff00) this.rd((this.pc & 0xff00) | (t & 0xff)); this.pc = t; }
    }
    // Runs one instruction (or services an interrupt). Returns cycles consumed.
    step() {
      this.accesses = 0; const start = this.cycles;
      if (this.nmiPending) { this.nmiPending = false; this.interrupt(0xfffa, false); return this.finish(7); }
      if (this.irqLine && !this.i) { this.interrupt(0xfffe, false); return this.finish(7); }
      const op = this.rd(this.pc++); this.pc &= 0xffff;
      let cyc = CYC[op] || 2; const mode = MODE[op];
      let ea = this.ea(mode, op), m;
      const rdm = () => (mode === 2 ? this.rd(ea) : this.rd(ea));
      const rmw = (f) => { if (mode === 1) { this.a = f(this.a); } else { const v = this.rd(ea); this.wr(ea, v); this.wr(ea, f(v)); } };
      const asl = (v) => { this.c = v >> 7; return this.nz((v << 1) & 0xff); };
      const lsr = (v) => { this.c = v & 1; return this.nz(v >> 1); };
      const rol = (v) => { const c = this.c; this.c = v >> 7; return this.nz(((v << 1) | c) & 0xff); };
      const ror = (v) => { const c = this.c; this.c = v & 1; return this.nz((v >> 1) | (c << 7)); };
      const inc = (v) => this.nz((v + 1) & 0xff), dec = (v) => this.nz((v - 1) & 0xff);
      switch (op) {
        case 0x00: this.rd(this.pc++); this.pc &= 0xffff; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p | 0x10); this.i = 1; this.pc = this.rd(0xfffe) | (this.rd(0xffff) << 8); break;
        case 0x01: case 0x05: case 0x09: case 0x0d: case 0x11: case 0x15: case 0x19: case 0x1d: this.a = this.nz(this.a | rdm()); break;
        case 0x21: case 0x25: case 0x29: case 0x2d: case 0x31: case 0x35: case 0x39: case 0x3d: this.a = this.nz(this.a & rdm()); break;
        case 0x41: case 0x45: case 0x49: case 0x4d: case 0x51: case 0x55: case 0x59: case 0x5d: this.a = this.nz(this.a ^ rdm()); break;
        case 0x61: case 0x65: case 0x69: case 0x6d: case 0x71: case 0x75: case 0x79: case 0x7d: this.adc(rdm()); break;
        case 0xe1: case 0xe5: case 0xe9: case 0xed: case 0xf1: case 0xf5: case 0xf9: case 0xfd: case 0xeb: this.sbc(rdm()); break;
        case 0xc1: case 0xc5: case 0xc9: case 0xcd: case 0xd1: case 0xd5: case 0xd9: case 0xdd: this.cmp(this.a, rdm()); break;
        case 0xe0: case 0xe4: case 0xec: this.cmp(this.x, rdm()); break;
        case 0xc0: case 0xc4: case 0xcc: this.cmp(this.y, rdm()); break;
        case 0xa1: case 0xa5: case 0xa9: case 0xad: case 0xb1: case 0xb5: case 0xb9: case 0xbd: this.a = this.nz(rdm()); break;
        case 0xa2: case 0xa6: case 0xae: case 0xb6: case 0xbe: this.x = this.nz(rdm()); break;
        case 0xa0: case 0xa4: case 0xac: case 0xb4: case 0xbc: this.y = this.nz(rdm()); break;
        case 0x81: case 0x85: case 0x8d: case 0x91: case 0x95: case 0x99: case 0x9d: this.wr(ea, this.a); break;
        case 0x86: case 0x8e: case 0x96: this.wr(ea, this.x); break;
        case 0x84: case 0x8c: case 0x94: this.wr(ea, this.y); break;
        case 0x24: case 0x2c: m = rdm(); this.z = (this.a & m) === 0 ? 1 : 0; this.n = m >> 7; this.v = (m >> 6) & 1; break;
        case 0x0a: case 0x06: case 0x0e: case 0x16: case 0x1e: rmw(asl); break;
        case 0x4a: case 0x46: case 0x4e: case 0x56: case 0x5e: rmw(lsr); break;
        case 0x2a: case 0x26: case 0x2e: case 0x36: case 0x3e: rmw(rol); break;
        case 0x6a: case 0x66: case 0x6e: case 0x76: case 0x7e: rmw(ror); break;
        case 0xe6: case 0xee: case 0xf6: case 0xfe: rmw(inc); break;
        case 0xc6: case 0xce: case 0xd6: case 0xde: rmw(dec); break;
        case 0xe8: this.rd(this.pc); this.x = this.nz((this.x + 1) & 0xff); break;
        case 0xc8: this.rd(this.pc); this.y = this.nz((this.y + 1) & 0xff); break;
        case 0xca: this.rd(this.pc); this.x = this.nz((this.x - 1) & 0xff); break;
        case 0x88: this.rd(this.pc); this.y = this.nz((this.y - 1) & 0xff); break;
        case 0xaa: this.rd(this.pc); this.x = this.nz(this.a); break;
        case 0xa8: this.rd(this.pc); this.y = this.nz(this.a); break;
        case 0x8a: this.rd(this.pc); this.a = this.nz(this.x); break;
        case 0x98: this.rd(this.pc); this.a = this.nz(this.y); break;
        case 0xba: this.rd(this.pc); this.x = this.nz(this.sp); break;
        case 0x9a: this.rd(this.pc); this.sp = this.x; break;
        case 0x48: this.rd(this.pc); this.push(this.a); break;
        case 0x08: this.rd(this.pc); this.push(this.p | 0x10); break;
        case 0x68: this.rd(this.pc); this.rd(0x100 + this.sp); this.a = this.nz(this.pull()); break;
        case 0x28: this.rd(this.pc); this.rd(0x100 + this.sp); this.p = this.pull(); break;
        case 0x18: this.rd(this.pc); this.c = 0; break;
        case 0x38: this.rd(this.pc); this.c = 1; break;
        case 0x58: this.rd(this.pc); this.i = 0; break;
        case 0x78: this.rd(this.pc); this.i = 1; break;
        case 0xb8: this.rd(this.pc); this.v = 0; break;
        case 0xd8: this.rd(this.pc); this.d = 0; break;
        case 0xf8: this.rd(this.pc); this.d = 1; break;
        case 0x10: this.branch(!this.n); break;
        case 0x30: this.branch(this.n); break;
        case 0x50: this.branch(!this.v); break;
        case 0x70: this.branch(this.v); break;
        case 0x90: this.branch(!this.c); break;
        case 0xb0: this.branch(this.c); break;
        case 0xd0: this.branch(!this.z); break;
        case 0xf0: this.branch(this.z); break;
        case 0x4c: this.pc = ea; break;
        case 0x6c: this.pc = ea; break;
        case 0x20: { const ret = (this.pc - 1) & 0xffff; this.rd(0x100 + this.sp); this.push(ret >> 8); this.push(ret & 0xff); this.pc = ea; break; }
        case 0x60: { this.rd(this.pc); this.rd(0x100 + this.sp); const lo = this.pull(); const hi = this.pull(); this.pc = (((hi << 8) | lo) + 1) & 0xffff; this.rd(this.pc); break; }
        case 0x40: { this.rd(this.pc); this.rd(0x100 + this.sp); this.p = this.pull(); const lo = this.pull(); this.pc = lo | (this.pull() << 8); break; }
        case 0xea: this.rd(this.pc); break;
        // Common undocumented opcodes seen in 2600 and 7800 software
        case 0xa7: case 0xb7: case 0xaf: case 0xbf: case 0xa3: case 0xb3: this.a = this.x = this.nz(rdm()); break;
        case 0x87: case 0x97: case 0x8f: case 0x83: this.wr(ea, this.a & this.x); break;
        case 0xc7: case 0xd7: case 0xcf: case 0xdf: case 0xdb: case 0xc3: case 0xd3: { const v = this.rd(ea); this.wr(ea, v); const r = (v - 1) & 0xff; this.wr(ea, r); this.cmp(this.a, r); break; }
        case 0xe7: case 0xf7: case 0xef: case 0xff: case 0xfb: case 0xe3: case 0xf3: { const v = this.rd(ea); this.wr(ea, v); const r = (v + 1) & 0xff; this.wr(ea, r); this.sbc(r); break; }
        case 0x07: case 0x17: case 0x0f: case 0x1f: case 0x1b: case 0x03: case 0x13: { const v = this.rd(ea); this.wr(ea, v); this.c = v >> 7; const r = (v << 1) & 0xff; this.wr(ea, r); this.a = this.nz(this.a | r); break; }
        case 0x27: case 0x37: case 0x2f: case 0x3f: case 0x3b: case 0x23: case 0x33: { const v = this.rd(ea); this.wr(ea, v); const c = this.c; this.c = v >> 7; const r = ((v << 1) | c) & 0xff; this.wr(ea, r); this.a = this.nz(this.a & r); break; }
        case 0x47: case 0x57: case 0x4f: case 0x5f: case 0x5b: case 0x43: case 0x53: { const v = this.rd(ea); this.wr(ea, v); this.c = v & 1; const r = v >> 1; this.wr(ea, r); this.a = this.nz(this.a ^ r); break; }
        case 0x67: case 0x77: case 0x6f: case 0x7f: case 0x7b: case 0x63: case 0x73: { const v = this.rd(ea); this.wr(ea, v); const c = this.c; this.c = v & 1; const r = (v >> 1) | (c << 7); this.wr(ea, r); this.adc(r); break; }
        case 0x0b: case 0x2b: this.a = this.nz(this.a & rdm()); this.c = this.n; break;
        case 0x4b: this.a = this.nz(this.a & rdm()); this.c = this.a & 1; this.a = this.nz(this.a >> 1); break;
        case 0xab: this.a = this.x = this.nz(rdm()); break;
        case 0xcb: { const t = (this.a & this.x) - rdm(); this.c = t >= 0 ? 1 : 0; this.x = this.nz(t & 0xff); break; }
        case 0x04: case 0x44: case 0x64: case 0x0c: case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4: case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc: case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2: if (mode !== 2) this.rd(ea); break;
        case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa: this.rd(this.pc); break;
        default: this.halted = true; break;
      }
      return this.finish(cyc);
    }
    finish(cyc) {
      let used = Math.max(this.accesses, 0);
      while (used < cyc) { if (this.bus.tick) this.bus.tick(); used++; }
      this.cycles += Math.max(cyc, this.accesses);
      return Math.max(cyc, this.accesses);
    }
  }
  return { Cpu6502, CYC, MODE };
});
