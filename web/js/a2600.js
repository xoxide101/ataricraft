// Atari 2600 (VCS) core: TIA, RIOT and cartridge banking on top of cpu6502.js. DOM-free, runs in Node tests.
// Video is drawn per colour clock (160 visible pixels, 228 clocks per line), so mid-line register tricks and HMOVE combs work.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./cpu6502.js') : root.AC.Cpu6502);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AC = root.AC || {}; root.AC.A2600 = api; }
})(typeof self !== 'undefined' ? self : this, function (CpuMod) {
  const { Cpu6502 } = CpuMod;
  const W = 160, MAXLINES = 320;

  // Colour tables: 128 entries (hue*8+lum) as 0xAABBGGRR for ImageData.
  function makePalette(pal) {
    const out = new Uint32Array(128);
    for (let h = 0; h < 16; h++) for (let l = 0; l < 8; l++) {
      const y = 0.06 + l * 0.133;
      let r = y, g = y, b = y;
      const gray = pal ? h < 2 || h > 13 : h === 0;
      if (!gray) {
        const step = pal ? (h - 2) : (h - 1), n = pal ? 12 : 15;
        const th = (pal ? 2.55 : 2.15) + step * (Math.PI * 2 / n) * (pal ? 1 : 0.96);
        const i = Math.cos(th) * 0.27, q = Math.sin(th) * 0.27;
        r = y + 0.956 * i + 0.621 * q; g = y - 0.272 * i - 0.647 * q; b = y - 1.106 * i + 1.703 * q;
      }
      const c = (v) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, Math.min(1, v)), 0.9) * 255)));
      out[h * 8 + l] = (255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r);
    }
    return out;
  }
  const PAL_NTSC = makePalette(false), PAL_PAL = makePalette(true);
  const COPIES = [[0], [0, 16], [0, 32], [0, 16, 32], [0, 64], [0], [0, 32, 64], [0]];
  const PSCALE = [1, 1, 1, 1, 1, 2, 1, 4];
  const POLY4 = (s) => ((s >> 1) | ((((s ^ (s >> 1)) & 1)) << 3)) & 15;
  const POLY5 = (s) => ((s >> 1) | ((((s ^ (s >> 2)) & 1)) << 4)) & 31;
  const POLY9 = (s) => ((s >> 1) | ((((s ^ (s >> 4)) & 1)) << 8)) & 511;

  class Tia {
    constructor(pal) {
      this.setPal(pal);
      this.fb = new Uint32Array(W * MAXLINES); this.out = new Uint32Array(W * MAXLINES);
      this.reset();
    }
    setPal(pal) { this.pal = pal ? 1 : 0; this.colors = pal ? PAL_PAL : PAL_NTSC; }
    reset() {
      this.hpos = 0; this.y = 0; this.vsync = 0; this.vblank = 0; this.wsync = false; this.frameReady = false;
      this.nusiz0 = this.nusiz1 = 0; this.colup0 = this.colup1 = this.colupf = this.colubk = 0; this.ctrlpf = 0;
      this.refp0 = this.refp1 = 0; this.pf0 = this.pf1 = this.pf2 = 0;
      this.p0 = 0; this.p1 = 0; this.m0 = 0; this.m1 = 0; this.bl = 0;
      this.grp0 = this.grp1 = this.grp0d = this.grp1d = 0; this.enam0 = this.enam1 = this.enabl = this.enabld = 0;
      this.hm = [0, 0, 0, 0, 0]; this.vdelp0 = this.vdelp1 = this.vdelbl = 0; this.resmp0 = this.resmp1 = 0;
      this.cx = new Uint8Array(8); this.hmoveBlank = false; this.firstVis = -1; this.lastVis = -1; this.lines = 0;
      this.inpt = [0, 0, 0, 0, 0x80, 0x80]; this.paddle = [0.5, 0.5, 0.5, 0.5]; this.dumpClock = 0; this.dumped = true;
      this.a = [{ c: 0, f: 0, v: 0, div: 0, s4: 15, s5: 31, s9: 511, t: 0, o: 0 }, { c: 0, f: 0, v: 0, div: 0, s4: 15, s5: 31, s9: 511, t: 0, o: 0 }];
      this.audioClk = 0; this.audio = []; this.vsyncStart = 0;
    }
    write(r, v) {
      switch (r) {
        case 0x00: { const on = (v & 2) !== 0; if (on && !(this.vsync & 2)) this.endFrame(); this.vsync = v; break; }
        case 0x01: { if ((v & 0x80) && !(this.vblank & 0x80)) { this.dumped = true; } else if (!(v & 0x80) && (this.vblank & 0x80)) { this.dumped = false; this.dumpClock = this.y * 228 + this.hpos; } this.vblank = v; break; }
        case 0x02: this.wsync = true; break;
        case 0x04: this.nusiz0 = v; break; case 0x05: this.nusiz1 = v; break;
        case 0x06: this.colup0 = v; break; case 0x07: this.colup1 = v; break; case 0x08: this.colupf = v; break; case 0x09: this.colubk = v; break;
        case 0x0a: this.ctrlpf = v; break; case 0x0b: this.refp0 = v & 8; break; case 0x0c: this.refp1 = v & 8; break;
        case 0x0d: this.pf0 = v; break; case 0x0e: this.pf1 = v; break; case 0x0f: this.pf2 = v; break;
        case 0x10: this.p0 = this.resPos(5, 3); break; case 0x11: this.p1 = this.resPos(5, 3); break;
        case 0x12: this.m0 = this.resPos(4, 2); break; case 0x13: this.m1 = this.resPos(4, 2); break; case 0x14: this.bl = this.resPos(4, 2); break;
        case 0x15: this.a[0].c = v & 15; break; case 0x16: this.a[1].c = v & 15; break;
        case 0x17: this.a[0].f = v & 31; break; case 0x18: this.a[1].f = v & 31; break;
        case 0x19: this.a[0].v = v & 15; break; case 0x1a: this.a[1].v = v & 15; break;
        case 0x1b: this.grp0 = v; this.grp1d = this.grp1; break;
        case 0x1c: this.grp1 = v; this.grp0d = this.grp0; this.enabld = this.enabl; break;
        case 0x1d: this.enam0 = (v >> 1) & 1; break; case 0x1e: this.enam1 = (v >> 1) & 1; break; case 0x1f: this.enabl = (v >> 1) & 1; break;
        case 0x20: this.hm[0] = v; break; case 0x21: this.hm[1] = v; break; case 0x22: this.hm[2] = v; break; case 0x23: this.hm[3] = v; break; case 0x24: this.hm[4] = v; break;
        case 0x25: this.vdelp0 = v & 1; break; case 0x26: this.vdelp1 = v & 1; break; case 0x27: this.vdelbl = v & 1; break;
        case 0x28: this.resmp0 = v & 2; break; case 0x29: this.resmp1 = v & 2; break;
        case 0x2a: this.hmove(); break;
        case 0x2b: this.hm = [0, 0, 0, 0, 0]; break;
        case 0x2c: this.cx.fill(0); break;
        default: break;
      }
    }
    resPos(vis, hb) { return this.hpos < 68 ? hb : (this.hpos - 68 + vis) % W; }
    hmove() {
      const mv = (h) => { let s = (h >> 4) & 15; if (s >= 8) s -= 16; return -s; };
      this.p0 = ((this.p0 + mv(this.hm[0])) % W + W) % W; this.p1 = ((this.p1 + mv(this.hm[1])) % W + W) % W;
      this.m0 = ((this.m0 + mv(this.hm[2])) % W + W) % W; this.m1 = ((this.m1 + mv(this.hm[3])) % W + W) % W; this.bl = ((this.bl + mv(this.hm[4])) % W + W) % W;
      if (this.hpos < 76) this.hmoveBlank = true;
    }
    read(r) {
      switch (r & 15) {
        case 0: return this.cx[0]; case 1: return this.cx[1]; case 2: return this.cx[2]; case 3: return this.cx[3];
        case 4: return this.cx[4]; case 5: return this.cx[5]; case 6: return this.cx[6]; case 7: return this.cx[7];
        case 8: case 9: case 10: case 11: {
          if (this.dumped) return 0;
          const need = (3 + this.paddle[(r & 15) - 8] * 320) * 228;
          return (this.y * 228 + this.hpos - this.dumpClock) >= need ? 0x80 : 0;
        }
        case 12: return this.inpt[4]; case 13: return this.inpt[5];
        default: return 0;
      }
    }
    endFrame() {
      if (this.y < 100) { this.y = 0; return; }
      this.out.set(this.fb); this.lines = this.y; this.frameReady = true; this.fb.fill(0, 0, W * Math.min(this.y + 2, MAXLINES));
      this.outFirst = this.firstVis; this.outLast = this.lastVis; this.firstVis = this.lastVis = -1; this.y = 0;
    }
    audioStep() {
      let mix = 0;
      for (let n = 0; n < 2; n++) {
        const a = this.a[n];
        if (++a.div > a.f) {
          a.div = 0;
          switch (a.c) {
            case 0: case 11: a.o = 1; break;
            case 1: a.s4 = POLY4(a.s4); a.o = a.s4 & 1; break;
            case 2: a.t = (a.t + 1) % 31; if (a.t === 0 || a.t === 18) { a.s4 = POLY4(a.s4); } a.o = a.s4 & 1; break;
            case 3: a.s5 = POLY5(a.s5); if (a.s5 & 1) a.s4 = POLY4(a.s4); a.o = a.s4 & 1; break;
            case 4: case 5: a.o ^= 1; break;
            case 6: case 10: a.t = (a.t + 1) % 31; a.o = a.t < 18 ? 0 : 1; break;
            case 7: case 9: a.s5 = POLY5(a.s5); a.o = a.s5 & 1; break;
            case 8: a.s9 = POLY9(a.s9); a.o = a.s9 & 1; break;
            case 12: case 13: a.t = (a.t + 1) % 6; a.o = a.t < 3 ? 0 : 1; break;
            case 14: a.t = (a.t + 1) % 93; a.o = a.t < 54 ? 0 : 1; break;
            default: a.t = (a.t + 1) % 3; if (a.t === 0) { a.s5 = POLY5(a.s5); } a.o = a.s5 & 1; break;
          }
        }
        mix += a.o * a.v;
      }
      this.audio.push(mix / 30);
    }
    // One colour clock.
    clock() {
      const hp = this.hpos;
      if (++this.audioClk >= 114) { this.audioClk = 0; this.audioStep(); }
      if (hp >= 68) {
        const x = hp - 68;
        if (this.y < MAXLINES) {
          let color = 0;
          if (this.vblank & 2) { color = 0; } else {
            color = this.pixel(x);
            if (this.hmoveBlank && x < 8) color = 0;
            if (this.firstVis < 0) this.firstVis = this.y;
            this.lastVis = this.y;
          }
          this.fb[this.y * W + x] = color ? this.colors[color >> 1] : 0;
          if (!color) this.fb[this.y * W + x] = 0xff000000;
        }
      }
      if (++this.hpos >= 228) { this.hpos = 0; this.y++; this.wsync = false; this.hmoveBlank = false; if (this.y >= MAXLINES - 1) this.endFrame(); }
    }
    pixel(x) {
      const cx = this.cx, cp = this.ctrlpf;
      // Playfield
      let idx = x < 80 ? x >> 2 : (cp & 1 ? 19 - ((x - 80) >> 2) : (x - 80) >> 2), pf;
      pf = idx < 4 ? (this.pf0 >> (4 + idx)) & 1 : idx < 12 ? (this.pf1 >> (11 - idx)) & 1 : (this.pf2 >> (idx - 12)) & 1;
      // Players
      const g0 = this.vdelp0 ? this.grp0d : this.grp0, g1 = this.vdelp1 ? this.grp1d : this.grp1;
      const p0 = this.player(x, this.p0, this.nusiz0, g0, this.refp0), p1 = this.player(x, this.p1, this.nusiz1, g1, this.refp1);
      // Missiles
      const mp0 = this.resmp0 ? (this.p0 + (PSCALE[this.nusiz0 & 7] === 1 ? 3 : PSCALE[this.nusiz0 & 7] === 2 ? 6 : 15)) % W : this.m0;
      const mp1 = this.resmp1 ? (this.p1 + (PSCALE[this.nusiz1 & 7] === 1 ? 3 : PSCALE[this.nusiz1 & 7] === 2 ? 6 : 15)) % W : this.m1;
      const m0 = !this.resmp0 && this.enam0 ? this.missile(x, mp0, this.nusiz0) : 0, m1 = !this.resmp1 && this.enam1 ? this.missile(x, mp1, this.nusiz1) : 0;
      const bsz = 1 << ((cp >> 4) & 3), en = this.vdelbl ? this.enabld : this.enabl;
      const d = (x - this.bl + W) % W, bl = en && d < bsz ? 1 : 0;
      if (m0 && p1) cx[0] |= 0x80; if (m0 && p0) cx[0] |= 0x40;
      if (m1 && p0) cx[1] |= 0x80; if (m1 && p1) cx[1] |= 0x40;
      if (p0 && pf) cx[2] |= 0x80; if (p0 && bl) cx[2] |= 0x40;
      if (p1 && pf) cx[3] |= 0x80; if (p1 && bl) cx[3] |= 0x40;
      if (m0 && pf) cx[4] |= 0x80; if (m0 && bl) cx[4] |= 0x40;
      if (m1 && pf) cx[5] |= 0x80; if (m1 && bl) cx[5] |= 0x40;
      if (bl && pf) cx[6] |= 0x80;
      if (p0 && p1) cx[7] |= 0x80; if (m0 && m1) cx[7] |= 0x40;
      const pfc = cp & 2 ? (x < 80 ? this.colup0 : this.colup1) : this.colupf;
      const fieldTop = pf || bl;
      let c;
      if (cp & 4) c = fieldTop ? (cp & 2 ? pfc : this.colupf) : p0 || m0 ? this.colup0 : p1 || m1 ? this.colup1 : this.colubk;
      else c = p0 || m0 ? this.colup0 : p1 || m1 ? this.colup1 : pf ? pfc : bl ? this.colupf : this.colubk;
      if ((cp & 4) && fieldTop && bl && !pf) c = this.colupf;
      return (c & 0xfe) | 1;
    }
    player(x, pos, nusiz, grp, refl) {
      if (!grp) return 0;
      const cp = COPIES[nusiz & 7], sc = PSCALE[nusiz & 7], w = 8 * sc;
      for (let i = 0; i < cp.length; i++) {
        const d = (x - pos - cp[i] + 2 * W) % W;
        if (d < w) { const bit = (d / sc) | 0; return (grp >> (refl ? bit : 7 - bit)) & 1; }
      }
      return 0;
    }
    missile(x, pos, nusiz) {
      const cp = COPIES[nusiz & 7], w = 1 << ((nusiz >> 4) & 3);
      for (let i = 0; i < cp.length; i++) if ((x - pos - cp[i] + 2 * W) % W < w) return 1;
      return 0;
    }
  }

  // Cartridge banking. bus.read/write get an address with A12 set (0x1000-0x1FFF).
  function detectMapper(rom) {
    const n = rom.length, has = (sig) => { for (let i = 0; i + sig.length <= n; i++) { let k = 0; while (k < sig.length && rom[i + k] === sig[k]) k++; if (k === sig.length) return true; } return false; };
    const count = (sigs) => sigs.reduce((a, s) => { let c = 0; for (let i = 0; i + s.length <= n; i++) { let k = 0; while (k < s.length && rom[i + k] === s[k]) k++; if (k === s.length) c++; } return a + c; }, 0);
    if (n <= 2048) return '2K';
    if (n === 4096) return '4K';
    if (n === 8192) {
      if (count([[0x85, 0x3f]]) >= 2 && !has([0x8d, 0xf8, 0x1f]) ) return '3F';
      if (count([[0x8d, 0xe0, 0x1f], [0x8d, 0xe0, 0x5f], [0x8d, 0xe9, 0x1f], [0x8d, 0xe9, 0x5f], [0x8d, 0xe7, 0x1f], [0xad, 0xe0, 0x1f], [0xad, 0xe9, 0x1f]]) >= 1) return 'E0';
      return 'F8';
    }
    if (n === 12288) return 'FA';
    if (n === 16384) return 'F6';
    if (n === 32768) return 'F4';
    if (n === 65536) return 'EF';
    if (n === 8448 || n === 8195) return 'F8';
    return n > 4096 ? 'F8' : '4K';
  }
  class Cart {
    constructor(rom, mapper) {
      this.rom = rom; this.type = mapper || detectMapper(rom); this.bank = 0; this.ram = null; this.reset();
      const hdr = rom.subarray(0, Math.min(256, rom.length));
      if (['F8', 'F6', 'F4', 'FA', 'EF'].includes(this.type) && hdr.length === 256 && hdr.every((b) => b === hdr[0])) this.ram = new Uint8Array(128);
    }
    reset() { this.bank = this.type === 'F8' || this.type === 'F6' || this.type === 'F4' || this.type === 'FA' || this.type === 'EF' ? this.rom.length / 4096 - 1 : 0; this.e0 = [4, 5, 6]; this.fe = 0; this.fe_state = 0; }
    hot(a) {
      switch (this.type) {
        case 'F8': if (a >= 0xff8 && a <= 0xff9) this.bank = a - 0xff8; break;
        case 'F6': if (a >= 0xff6 && a <= 0xff9) this.bank = a - 0xff6; break;
        case 'F4': if (a >= 0xff4 && a <= 0xffb) this.bank = a - 0xff4; break;
        case 'FA': if (a >= 0xff8 && a <= 0xffa) this.bank = a - 0xff8; break;
        case 'EF': if (a >= 0xfe0 && a <= 0xfef) this.bank = a - 0xfe0; break;
        case 'E0': if (a >= 0xfe0 && a <= 0xfe7) this.e0[0] = a - 0xfe0; else if (a >= 0xfe8 && a <= 0xfef) this.e0[1] = a - 0xfe8; else if (a >= 0xff0 && a <= 0xff7) this.e0[2] = a - 0xff0; break;
        default: break;
      }
    }
    read(addr) {
      const a = addr & 0xfff;
      if (this.ram && a >= 0x80 && a < 0x100) return this.ram[a - 0x80];
      this.hot(a);
      const r = this.rom;
      switch (this.type) {
        case '2K': return r[a & 0x7ff];
        case '4K': return r[a];
        case 'E0': return r[(a < 0x400 ? this.e0[0] : a < 0x800 ? this.e0[1] : a < 0xc00 ? this.e0[2] : 7) * 0x400 + (a & 0x3ff)];
        case '3F': return a < 0x800 ? r[this.bank * 0x800 + (a & 0x7ff)] : r[r.length - 0x800 + (a & 0x7ff)];
        case 'FE': return r[(this.fe ? 0 : 1) * 0x1000 + a];
        default: return r[(this.bank * 0x1000 + a) % r.length];
      }
    }
    write(addr, v) {
      const a = addr & 0xfff;
      if (this.ram && a < 0x80) { this.ram[a] = v; return; }
      this.hot(a);
    }
    // 3F banking is driven by writes to TIA addresses 0x00-0x3F.
    tia3f(v) { if (this.type === '3F') this.bank = v % (this.rom.length / 0x800 - 1 || 1); }
    // FE banking follows the stack: JSR/RTS/PHP pushes of address bit 13 pick the bank.
    stackFe(addr) { if (this.type === 'FE') this.fe = (addr & 0x2000) ? 1 : 0; }
  }

  class Console2600 {
    constructor(opts) {
      opts = opts || {};
      this.tia = new Tia(opts.pal); this.ram = new Uint8Array(128); this.cart = null;
      this.cpu = new Cpu6502(this); this.pal = !!opts.pal;
      this.swcha = 0xff; this.swchb = 0x3f | 0xc0; this.timer = { cycles: 0, interval: 1024, flag: false, set: false };
      this.ddra = 0; this.outA = 0xff; this.frames = 0; this.cycles = 0;
      this.input = { p0: { up: 0, down: 0, left: 0, right: 0, fire: 0 }, p1: { up: 0, down: 0, left: 0, right: 0, fire: 0 }, reset: 0, select: 0, color: 1, diff0: 1, diff1: 1 };
      this.applyInput();
    }
    load(rom, mapper) { this.cart = new Cart(rom, mapper); this.mapper = this.cart.type; this.powerOn(); }
    powerOn() {
      this.tia.reset(); this.ram.fill(0); this.timer.cycles = 0; this.timer.interval = 1024; this.timer.flag = false;
      this.cart && this.cart.reset(); this.cpu.reset();
    }
    setPal(p) { this.pal = !!p; this.tia.setPal(p); }
    // Joystick: bit set = pressed. Called whenever controls change.
    applyInput() {
      const i = this.input, t = this.tia;
      this.swcha = 0xff & ~((i.p0.right ? 0x80 : 0) | (i.p0.left ? 0x40 : 0) | (i.p0.down ? 0x20 : 0) | (i.p0.up ? 0x10 : 0) | (i.p1.right ? 8 : 0) | (i.p1.left ? 4 : 0) | (i.p1.down ? 2 : 0) | (i.p1.up ? 1 : 0));
      this.swchb = ((i.reset ? 0 : 1) | (i.select ? 0 : 2) | 0x34 | (i.color ? 8 : 0) | (i.diff0 ? 0x40 : 0) | (i.diff1 ? 0x80 : 0)) & 0xff;
      t.inpt[4] = i.p0.fire ? 0 : 0x80; t.inpt[5] = i.p1.fire ? 0 : 0x80;
    }
    tick() {
      const t = this.tia; t.clock(); t.clock(); t.clock(); this.cycles++;
      const tm = this.timer;
      if (tm.set) { if (--tm.cycles < 0) { tm.flag = true; tm.interval = 1; } }
    }
    read(addr) {
      addr &= 0x1fff;
      if (addr & 0x1000) return this.cart ? this.cart.read(addr) : 0xff;
      if (!(addr & 0x80)) return this.tia.read(addr & 0xf);
      if (!(addr & 0x200)) return this.ram[addr & 0x7f];
      switch (addr & 7) {
        case 0: return this.swcha & (this.ddra ? ~this.ddra | this.outA : 0xff);
        case 1: return this.ddra;
        case 2: return this.swchb; case 3: return 0;
        case 4: case 6: { const tm = this.timer; const v = tm.cycles >= 0 ? Math.floor(tm.cycles / tm.interval) : tm.cycles & 0xff; tm.flag = false; return v & 0xff; }
        default: return (this.timer.flag ? 0x80 : 0) | 0;
      }
    }
    write(addr, v) {
      addr &= 0x1fff;
      if (addr & 0x1000) { if (this.cart) this.cart.write(addr, v); return; }
      if (!(addr & 0x80)) { const r = addr & 0x3f; this.tia.write(r, v); if (this.cart && this.cart.type === '3F' && r < 0x40) this.cart.tia3f(v); return; }
      if (!(addr & 0x200)) { this.ram[addr & 0x7f] = v; return; }
      if (addr & 4) {
        if (addr & 0x10) {
          const tm = this.timer; tm.interval = [1, 8, 64, 1024][addr & 3]; tm.cycles = v * tm.interval; tm.flag = false; tm.set = true;
        }
      } else if ((addr & 3) === 0) this.outA = v; else if ((addr & 3) === 1) this.ddra = v;
    }
    // Runs until the TIA completes a frame; returns false if it ran far past a plausible frame without one.
    runFrame() {
      const t = this.tia, cpu = this.cpu; t.frameReady = false;
      let guard = 0;
      while (!t.frameReady && guard++ < 200000) {
        if (t.wsync) { this.tick(); continue; }
        if (cpu.halted) { this.tick(); continue; }
        cpu.step();
      }
      if (t.frameReady) this.frames++;
      return t.frameReady;
    }
    // Visible window of the finished frame: { top, height } chosen from the active lines.
    window() {
      const t = this.tia; let top = t.outFirst >= 0 ? t.outFirst : 40, bot = t.outLast >= 0 ? t.outLast : top + 191;
      let h = bot - top + 1; if (h < 150) { h = 192; } if (h > 250) h = 250;
      return { top, height: h, lines: t.lines };
    }
    drainAudio() { const a = this.tia.audio; this.tia.audio = []; return a; }
  }

  return { Console2600, Tia, Cart, detectMapper, W, PAL_NTSC, PAL_PAL };
});
