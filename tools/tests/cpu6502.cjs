// Minimal NMOS 6502 interpreter (official opcodes only), used by tests to run real player code from SAP files.
module.exports = function Cpu(mem, onWrite) {
  const c = { a: 0, x: 0, y: 0, sp: 0xFF, pc: 0, C: 0, Z: 0, I: 0, D: 0, V: 0, N: 0, cycles: 0, mem };
  const rd = (a) => mem[a & 0xFFFF];
  const wr = (a, v) => { a &= 0xFFFF; mem[a] = v & 255; if (onWrite) onWrite(a, v & 255); };
  const rw = (a) => rd(a) | rd(a + 1) << 8;
  const nz = (v) => { c.Z = (v & 255) === 0 ? 1 : 0; c.N = (v >> 7) & 1; return v & 255; };
  const push = (v) => { mem[0x100 + c.sp] = v & 255; c.sp = (c.sp - 1) & 255; };
  const pull = () => { c.sp = (c.sp + 1) & 255; return mem[0x100 + c.sp]; };
  const getP = () => c.C | c.Z << 1 | c.I << 2 | c.D << 3 | 0x30 | c.V << 6 | c.N << 7;
  const setP = (p) => { c.C = p & 1; c.Z = (p >> 1) & 1; c.I = (p >> 2) & 1; c.D = (p >> 3) & 1; c.V = (p >> 6) & 1; c.N = (p >> 7) & 1; };
  const adc = (v) => {
    if (c.D) {
      let lo = (c.a & 15) + (v & 15) + c.C, hi = (c.a >> 4) + (v >> 4);
      const bin = c.a + v + c.C; c.Z = (bin & 255) === 0 ? 1 : 0;
      if (lo > 9) { lo += 6; hi++; }
      c.N = (hi >> 3) & 1; c.V = (~(c.a ^ v) & (c.a ^ (hi << 4)) & 0x80) ? 1 : 0;
      if (hi > 9) hi += 6;
      c.C = hi > 15 ? 1 : 0; c.a = ((hi << 4) | (lo & 15)) & 255; return;
    }
    const r = c.a + v + c.C; c.V = (~(c.a ^ v) & (c.a ^ r) & 0x80) ? 1 : 0; c.C = r > 255 ? 1 : 0; c.a = nz(r);
  };
  const sbc = (v) => {
    if (c.D) {
      const bin = c.a - v - (1 - c.C);
      let lo = (c.a & 15) - (v & 15) - (1 - c.C), hi = (c.a >> 4) - (v >> 4);
      if (lo < 0) { lo -= 6; hi--; }
      if (hi < 0) hi -= 6;
      c.V = ((c.a ^ v) & (c.a ^ bin) & 0x80) ? 1 : 0; c.C = bin >= 0 ? 1 : 0; nz(bin);
      c.a = ((hi << 4) | (lo & 15)) & 255; return;
    }
  };
  const sbcBin = (v) => { const r = c.a - v - (1 - c.C); c.V = ((c.a ^ v) & (c.a ^ r) & 0x80) ? 1 : 0; c.C = r >= 0 ? 1 : 0; c.a = nz(r); };
  const cmp = (r, v) => { const t = r - v; c.C = t >= 0 ? 1 : 0; nz(t); };
  // addressing modes return the effective address
  const zp = () => rd(c.pc++), zpx = () => (rd(c.pc++) + c.x) & 255, zpy = () => (rd(c.pc++) + c.y) & 255;
  const ab = () => { const a = rw(c.pc); c.pc += 2; return a; };
  const abx = () => (ab() + c.x) & 0xFFFF, aby = () => (ab() + c.y) & 0xFFFF;
  const izx = () => { const p = (rd(c.pc++) + c.x) & 255; return rd(p) | rd((p + 1) & 255) << 8; };
  const izy = () => { const p = rd(c.pc++); return ((rd(p) | rd((p + 1) & 255) << 8) + c.y) & 0xFFFF; };
  const br = (cond) => { const o = rd(c.pc++); if (cond) c.pc = (c.pc + (o > 127 ? o - 256 : o)) & 0xFFFF; };
  const asl = (v) => { c.C = v >> 7; return nz(v << 1); }, lsr = (v) => { c.C = v & 1; return nz(v >> 1); };
  const rol = (v) => { const r = (v << 1 | c.C); c.C = (v >> 7) & 1; return nz(r); };
  const ror = (v) => { const r = (v >> 1) | c.C << 7; c.C = v & 1; return nz(r); };
  const rmw = (ea, f) => { wr(ea, f(rd(ea))); };
  // group-based decode: aaabbbcc
  c.step = function () {
    const op = rd(c.pc++);
    const cc = op & 3, bbb = (op >> 2) & 7, aaa = op >> 5;
    switch (op) {
      case 0x00: c.pc++; push(c.pc >> 8); push(c.pc); push(getP()); c.I = 1; c.pc = rw(0xFFFE); return;
      case 0x20: { const a = ab(); const r = (c.pc - 1) & 0xFFFF; push(r >> 8); push(r); c.pc = a; return; }
      case 0x40: setP(pull()); c.pc = pull() | pull() << 8; return;
      case 0x60: c.pc = ((pull() | pull() << 8) + 1) & 0xFFFF; return;
      case 0x4C: c.pc = ab(); return;
      case 0x6C: { const a = ab(); c.pc = rd(a) | rd((a & 0xFF00) | ((a + 1) & 255)) << 8; return; }
      case 0x08: push(getP()); return; case 0x28: setP(pull()); return;
      case 0x48: push(c.a); return; case 0x68: c.a = nz(pull()); return;
      case 0x18: c.C = 0; return; case 0x38: c.C = 1; return; case 0x58: c.I = 0; return; case 0x78: c.I = 1; return;
      case 0xB8: c.V = 0; return; case 0xD8: c.D = 0; return; case 0xF8: c.D = 1; return;
      case 0x88: c.y = nz(c.y - 1); return; case 0xC8: c.y = nz(c.y + 1); return;
      case 0xCA: c.x = nz(c.x - 1); return; case 0xE8: c.x = nz(c.x + 1); return;
      case 0x8A: c.a = nz(c.x); return; case 0x98: c.a = nz(c.y); return;
      case 0xAA: c.x = nz(c.a); return; case 0xA8: c.y = nz(c.a); return;
      case 0xBA: c.x = nz(c.sp); return; case 0x9A: c.sp = c.x; return;
      case 0xEA: return;
      case 0x10: br(!c.N); return; case 0x30: br(c.N); return; case 0x50: br(!c.V); return; case 0x70: br(c.V); return;
      case 0x90: br(!c.C); return; case 0xB0: br(c.C); return; case 0xD0: br(!c.Z); return; case 0xF0: br(c.Z); return;
      case 0x0A: c.a = asl(c.a); return; case 0x4A: c.a = lsr(c.a); return;
      case 0x2A: c.a = rol(c.a); return; case 0x6A: c.a = ror(c.a); return;
    }
    if (cc === 1) {
      let ea = null, imm = 0;
      switch (bbb) { case 0: ea = izx(); break; case 1: ea = zp(); break; case 2: imm = 1; break; case 3: ea = ab(); break; case 4: ea = izy(); break; case 5: ea = zpx(); break; case 6: ea = aby(); break; case 7: ea = abx(); break; }
      if (aaa === 4) { wr(ea, c.a); return; }
      const v = imm ? rd(c.pc++) : rd(ea);
      switch (aaa) {
        case 0: c.a = nz(c.a | v); break; case 1: c.a = nz(c.a & v); break; case 2: c.a = nz(c.a ^ v); break;
        case 3: adc(v); break; case 5: c.a = nz(v); break; case 6: cmp(c.a, v); break;
        case 7: if (c.D) sbc(v); else sbcBin(v); break;
      }
      return;
    }
    if (cc === 2) {
      let ea;
      switch (bbb) { case 0: { const v = rd(c.pc++); if (aaa === 5) { c.x = nz(v); return; } throw new Error('bad op ' + op.toString(16)); }
        case 1: ea = zp(); break; case 3: ea = ab(); break;
        case 5: ea = (aaa === 4 || aaa === 5) ? zpy() : zpx(); break;
        case 7: ea = (aaa === 5) ? aby() : abx(); break; default: throw new Error('bad op ' + op.toString(16)); }
      switch (aaa) {
        case 0: rmw(ea, asl); break; case 1: rmw(ea, rol); break; case 2: rmw(ea, lsr); break; case 3: rmw(ea, ror); break;
        case 4: wr(ea, c.x); break; case 5: c.x = nz(rd(ea)); break;
        case 6: rmw(ea, (v) => nz(v - 1)); break; case 7: rmw(ea, (v) => nz(v + 1)); break;
      }
      return;
    }
    if (cc === 0) {
      let ea = null, imm = 0;
      switch (bbb) { case 0: imm = 1; break; case 1: ea = zp(); break; case 3: ea = ab(); break; case 5: ea = zpx(); break; case 7: ea = abx(); break; default: throw new Error('bad op ' + op.toString(16)); }
      if (aaa === 4) { wr(ea, c.y); return; }
      const v = imm ? rd(c.pc++) : rd(ea);
      switch (aaa) {
        case 1: c.Z = (c.a & v) === 0 ? 1 : 0; c.N = (v >> 7) & 1; c.V = (v >> 6) & 1; break;
        case 5: c.y = nz(v); break; case 6: cmp(c.y, v); break; case 7: cmp(c.x, v); break;
        default: throw new Error('bad op ' + op.toString(16));
      }
      return;
    }
    throw new Error('bad op ' + op.toString(16) + ' at ' + ((c.pc - 1) & 0xFFFF).toString(16));
  };
  // Runs a subroutine until it returns (RTS to a sentinel address).
  c.jsr = function (addr, a, x, y, limit) {
    const SENT = 0xFFF0;
    c.a = a | 0; c.x = x | 0; c.y = y | 0; c.sp = 0xFF;
    push((SENT - 1) >> 8); push((SENT - 1) & 255); c.pc = addr;
    for (let n = 0; n < (limit || 2000000); n++) { if (c.pc === SENT) return n; c.step(); }
    throw new Error('subroutine did not return');
  };
  return c;
};
