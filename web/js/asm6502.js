// AtariCraft 6502 assembler: a small MADS-style subset that runs in the browser and writes Atari XEX files.
// Supported: labels (with or without ':'), NAME = expr / EQU, ORG or * = expr, .BYTE/.BY .WORD/.WO .TEXT .FILL .DS .END,
// expressions with + - * / % & | ^ << >> ~, unary < (low) and > (high), * for the current address, $hex 0xhex %bin decimal,
// 'c' (ATASCII) and "c" (screen code); in .BYTE/.TEXT "text" is screen codes and 'text' is ATASCII, as in MADS.
// Also: .RUN expr / .INIT expr write the RUNAD ($2E0) / INITAD ($2E2) segment; assemble(text, {symbols:{NAME:value}}) predefines names (e.g. hardware registers).
// MADS/dasm compatibility: DTA b()/a()/l()/h()/c'', DC.B, DC.W, DS.B; PROCESSOR/OPT/LIST/SEG are ignored.
// Not supported: macros, .PROC/.IF, include files, undocumented opcodes.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Asm = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  // mode order: imp acc imm zp zpx zpy abs abx aby ind izx izy
  const M = ['imp', 'acc', 'imm', 'zp', 'zpx', 'zpy', 'abs', 'abx', 'aby', 'ind', 'izx', 'izy'];
  const T = {};
  const def = (n, o) => { T[n] = {}; for (const [k, v] of Object.entries(o)) T[n][k] = v; };
  const grp = (n, imm, zp, zpx, abs, abx, aby, izx, izy) => def(n, { imm, zp, zpx, abs, abx, aby, izx, izy });
  grp('ADC', 0x69, 0x65, 0x75, 0x6D, 0x7D, 0x79, 0x61, 0x71); grp('AND', 0x29, 0x25, 0x35, 0x2D, 0x3D, 0x39, 0x21, 0x31);
  grp('CMP', 0xC9, 0xC5, 0xD5, 0xCD, 0xDD, 0xD9, 0xC1, 0xD1); grp('EOR', 0x49, 0x45, 0x55, 0x4D, 0x5D, 0x59, 0x41, 0x51);
  grp('LDA', 0xA9, 0xA5, 0xB5, 0xAD, 0xBD, 0xB9, 0xA1, 0xB1); grp('ORA', 0x09, 0x05, 0x15, 0x0D, 0x1D, 0x19, 0x01, 0x11);
  grp('SBC', 0xE9, 0xE5, 0xF5, 0xED, 0xFD, 0xF9, 0xE1, 0xF1);
  def('STA', { zp: 0x85, zpx: 0x95, abs: 0x8D, abx: 0x9D, aby: 0x99, izx: 0x81, izy: 0x91 });
  for (const [n, a, z, zx, ab, abx] of [['ASL', 0x0A, 0x06, 0x16, 0x0E, 0x1E], ['LSR', 0x4A, 0x46, 0x56, 0x4E, 0x5E], ['ROL', 0x2A, 0x26, 0x36, 0x2E, 0x3E], ['ROR', 0x6A, 0x66, 0x76, 0x6E, 0x7E]]) def(n, { acc: a, zp: z, zpx: zx, abs: ab, abx });
  def('DEC', { zp: 0xC6, zpx: 0xD6, abs: 0xCE, abx: 0xDE }); def('INC', { zp: 0xE6, zpx: 0xF6, abs: 0xEE, abx: 0xFE });
  def('LDX', { imm: 0xA2, zp: 0xA6, zpy: 0xB6, abs: 0xAE, aby: 0xBE }); def('LDY', { imm: 0xA0, zp: 0xA4, zpx: 0xB4, abs: 0xAC, abx: 0xBC });
  def('STX', { zp: 0x86, zpy: 0x96, abs: 0x8E }); def('STY', { zp: 0x84, zpx: 0x94, abs: 0x8C });
  def('CPX', { imm: 0xE0, zp: 0xE4, abs: 0xEC }); def('CPY', { imm: 0xC0, zp: 0xC4, abs: 0xCC });
  def('BIT', { zp: 0x24, abs: 0x2C }); def('JMP', { abs: 0x4C, ind: 0x6C }); def('JSR', { abs: 0x20 });
  const REL = { BCC: 0x90, BCS: 0xB0, BEQ: 0xF0, BMI: 0x30, BNE: 0xD0, BPL: 0x10, BVC: 0x50, BVS: 0x70 };
  const IMP = { BRK: 0, CLC: 0x18, CLD: 0xD8, CLI: 0x58, CLV: 0xB8, DEX: 0xCA, DEY: 0x88, INX: 0xE8, INY: 0xC8, NOP: 0xEA, PHA: 0x48, PHP: 0x08, PLA: 0x68, PLP: 0x28,
    RTI: 0x40, RTS: 0x60, SEC: 0x38, SED: 0xF8, SEI: 0x78, TAX: 0xAA, TAY: 0xA8, TSX: 0xBA, TXA: 0x8A, TXS: 0x9A, TYA: 0x98 };

  // Atari screen (internal) code for an ATASCII character: MADS uses it for text in double quotes.
  const screen = (c) => (c < 32 ? c + 64 : c < 96 ? c - 32 : c);

  class AsmError extends Error { constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; } }

  // Expression evaluator. Returns {v, known}; unknown symbols give known=false and v=0 until the last pass.
  function evalExpr(src, ctx) {
    let i = 0, known = true; const s = src;
    const ws = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
    const prim = () => {
      ws(); const c = s[i];
      if (c === '(') { i++; const v = or(); ws(); if (s[i] !== ')') throw new Error('missing )'); i++; return v; }
      if (c === '-') { i++; return -prim(); } if (c === '+') { i++; return prim(); } if (c === '~') { i++; return ~prim(); }
      if (c === '<') { i++; return prim() & 255; } if (c === '>') { i++; return (prim() >> 8) & 255; }
      if (c === '*') { i++; return ctx.pc; }
      let m;
      const r = s.slice(i);
      if ((m = /^\$([0-9A-Fa-f]+)/.exec(r)) || (m = /^0[xX]([0-9A-Fa-f]+)/.exec(r))) { i += m[0].length; return parseInt(m[1], 16); }
      if ((m = /^%([01]+)/.exec(r))) { i += m[0].length; return parseInt(m[1], 2); }
      if ((m = /^'(.)'?/.exec(r))) { i += m[0].length; return m[1].charCodeAt(0); }
      if ((m = /^"(.)"?/.exec(r))) { i += m[0].length; return screen(m[1].charCodeAt(0)); }
      if ((m = /^\d+/.exec(r))) { i += m[0].length; return parseInt(m[0], 10); }
      if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(r))) {
        i += m[0].length; const n = m[0];
        if (ctx.syms.has(n)) return ctx.syms.get(n);
        known = false; return 0;
      }
      throw new Error('bad expression: ' + s.slice(i));
    };
    const mulE = () => { let a = prim(); for (;;) { ws(); const c = s[i]; if (c === '*' ) { i++; a *= prim(); } else if (c === '/') { i++; const b = prim(); a = b ? Math.trunc(a / b) : 0; } else if (c === '%') { i++; const b = prim(); a = b ? a % b : 0; } else return a; } };
    const addE = () => { let a = mulE(); for (;;) { ws(); const c = s[i]; if (c === '+') { i++; a += mulE(); } else if (c === '-') { i++; a -= mulE(); } else return a; } };
    const shE = () => { let a = addE(); for (;;) { ws(); if (s.startsWith('<<', i)) { i += 2; a <<= addE(); } else if (s.startsWith('>>', i)) { i += 2; a >>= addE(); } else return a; } };
    const and = () => { let a = shE(); for (;;) { ws(); if (s[i] === '&') { i++; a &= shE(); } else return a; } };
    const xor = () => { let a = and(); for (;;) { ws(); if (s[i] === '^') { i++; a ^= and(); } else return a; } };
    const or = () => { let a = xor(); for (;;) { ws(); if (s[i] === '|') { i++; a |= xor(); } else return a; } };
    const v = or(); ws(); if (i < s.length) throw new Error('unexpected: ' + s.slice(i));
    return { v, known };
  }

  function splitArgs(s) {
    const out = []; let cur = '', q = '', d = 0;
    for (const c of s) {
      if (q) { cur += c; if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(') d++; if (c === ')') d--;
      if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim() || out.length) out.push(cur.trim()); return out;
  }
  function stripComment(l) { let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') q = !q; else if (!q && c === "'" && l[i + 2] === "'") i += 2; else if (!q && c === ';') return l.slice(0, i); } return l; }

  // Operand shape: {mode, expr}. 'zp'/'abs' share one entry and are chosen later from the value.
  function shape(op, mn) {
    const t = op.trim();
    if (!t) return { mode: 'imp' };
    if (/^a$/i.test(t) && T[mn] && T[mn].acc) return { mode: 'acc' };
    if (t[0] === '#') return { mode: 'imm', expr: t.slice(1) };
    let m;
    if ((m = /^\((.*),\s*[xX]\s*\)$/.exec(t))) return { mode: 'izx', expr: m[1] };
    if ((m = /^\((.*)\)\s*,\s*[yY]$/.exec(t))) return { mode: 'izy', expr: m[1] };
    if ((m = /^\((.*)\)$/.exec(t))) return { mode: 'ind', expr: m[1] };
    if ((m = /^(.*),\s*[xX]$/.exec(t))) return { mode: 'x', expr: m[1] };
    if ((m = /^(.*),\s*[yY]$/.exec(t))) return { mode: 'y', expr: m[1] };
    return { mode: 'm', expr: t };
  }

  function assemble(text, opts) {
    opts = opts || {};
    const lines = String(text).split(/\r?\n/), syms = new Map(), listing = [];
    let segs, prev = '', finalNext = false, all = [];
    const pre = opts.symbols || {};
    for (let pass = 1; pass <= 8; pass++) {
      const last = finalNext || pass === 8;
      let pc = 0x2000, seg = null; segs = []; listing.length = 0; all = [];
      for (const k in pre) if (!syms.has(k)) syms.set(k, pre[k]);
      const org = (a) => { pc = a & 0xFFFF; seg = null; };
      const emit = (b) => { if (!seg) { seg = { addr: pc, bytes: [] }; segs.push(seg); } seg.bytes.push(b & 255); all.push(b & 255); pc = (pc + 1) & 0xFFFF; };
      const ctx = { get pc() { return pc; }, syms }, seen = new Set();
      for (let ln = 0; ln < lines.length; ln++) {
        const raw = stripComment(lines[ln]); if (!raw.trim()) continue;
        const start = pc, ai = all.length;
        try {
          let body = raw, label = null, m;
          if ((m = /^\s*\*\s*=\s*(.+)$/.exec(raw))) { org(evalExpr(m[1], ctx).v); continue; }
          if (/^\S/.test(raw)) { m = /^([A-Za-z_][A-Za-z0-9_.]*):?(.*)$/.exec(raw); if (!m) throw new Error('bad label'); label = m[1]; body = m[2]; }
          let t = body.trim();
          if ((m = /^(?:=|equ\b)\s*(.+)$/i.exec(t)) && label) { const r = evalExpr(m[1], ctx); if (last && !r.known) throw new Error('undefined symbol in ' + m[1]); syms.set(label, r.v); continue; }
          if (label) { if (seen.has(label)) throw new Error('duplicate label ' + label); seen.add(label); syms.set(label, pc); }
          if (!t) continue;
          m = /^(\S+)\s*(.*)$/.exec(t); const mn = ({ 'DC.B': 'BYTE', 'DC.W': 'WORD', 'DS.B': 'DS' })[m[1].toUpperCase().replace(/^\./, '')] || m[1].toUpperCase().replace(/^\./, ''), rest = m[2];
          const dot = m[1][0] === '.';
          if (mn === 'PROCESSOR' || mn === 'OPT' || mn === 'LIST' || mn === 'SEG' || mn === 'SEG.U' || mn === 'MAC' || mn === 'ENDM') { if (mn === 'MAC' || mn === 'ENDM') throw new Error('macros are not supported'); continue; }
          if (mn === 'DTA') {
            for (const a of splitArgs(rest)) {
              const d = /^([baclhBACLH])\s*\((.*)\)$/.exec(a) || /^([cC])\s*(["'].*["'])$/.exec(a);
              if (!d) { const r = evalExpr(a, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + a); emit(r.v); continue; }
              const k = d[1].toLowerCase();
              if (k === 'c') { const q = d[2]; for (const c of q.slice(1, -1)) emit(q[0] === '"' ? screen(c.charCodeAt(0)) : c.charCodeAt(0)); continue; }
              for (const e of splitArgs(d[2])) {
                const r = evalExpr(e, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + e);
                if (k === 'b') emit(r.v); else if (k === 'l') emit(r.v); else if (k === 'h') emit(r.v >> 8); else { emit(r.v); emit(r.v >> 8); }
              }
            }
            continue;
          }
          if (mn === 'ORG') { org(evalExpr(rest, ctx).v); continue; }
          if (mn === 'END') break;
          if (mn === 'RUN' || mn === 'INIT') {
            const r = evalExpr(rest, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + rest);
            const keep = pc; pc = mn === 'RUN' ? 0x2E0 : 0x2E2; seg = null; emit(r.v); emit(r.v >> 8); pc = keep; seg = null; continue;
          }
          if (mn === 'BYTE' || mn === 'BY' || mn === 'TEXT' || mn === 'WORD' || mn === 'WO') {
            for (const a of splitArgs(rest)) {
              if ((mn === 'BYTE' || mn === 'BY' || mn === 'TEXT') && a.length > 1 && (a[0] === '"' || (a[0] === "'" && a.length > 3)) && a.endsWith(a[0])) { for (const c of a.slice(1, -1)) emit(a[0] === '"' ? screen(c.charCodeAt(0)) : c.charCodeAt(0)); continue; }
              const r = evalExpr(a, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + a);
              if (mn === 'WORD' || mn === 'WO') { emit(r.v); emit(r.v >> 8); } else emit(r.v);
            }
            continue;
          }
          if (mn === 'FILL' || mn === 'DS') { const a = splitArgs(rest), n = evalExpr(a[0], ctx).v, v = a[1] ? evalExpr(a[1], ctx).v : 0; for (let k = 0; k < n; k++) emit(v); continue; }
          if (REL[mn] !== undefined) {
            const r = evalExpr(rest, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + rest);
            const off = r.v - (pc + 2); if (last && (off < -128 || off > 127)) throw new Error(`branch out of range (${off})`);
            emit(REL[mn]); emit(off); continue;
          }
          if (IMP[mn] !== undefined && !rest.trim()) { emit(IMP[mn]); continue; }
          const tab = T[mn]; if (!tab) throw new Error((dot ? 'unknown directive ' : 'unknown instruction ') + m[1]);
          const sh = shape(rest, mn);
          if (sh.mode === 'acc') { emit(tab.acc); continue; }
          if (sh.mode === 'imp') { if (tab.acc) { emit(tab.acc); continue; } throw new Error(mn + ' needs an operand'); }
          const r = evalExpr(sh.expr, ctx); if (last && !r.known) throw new Error('undefined symbol in ' + sh.expr);
          let mode = sh.mode;
          const zpOk = r.known && r.v >= 0 && r.v < 256;
          if (mode === 'm') mode = zpOk && tab.zp !== undefined ? 'zp' : 'abs';
          else if (mode === 'x') mode = zpOk && tab.zpx !== undefined ? 'zpx' : 'abx';
          else if (mode === 'y') mode = zpOk && tab.zpy !== undefined ? 'zpy' : 'aby';
          const op = tab[mode]; if (op === undefined && !last && !r.known) { emit(0); emit(0); emit(0); continue; }
          if (op === undefined) throw new Error(`${mn} does not support this addressing mode`);
          emit(op);
          if (mode === 'imm' || mode === 'zp' || mode === 'zpx' || mode === 'zpy' || mode === 'izx' || mode === 'izy') { if (last && (r.v < -128 || r.v > 255)) throw new Error('value does not fit in a byte'); emit(r.v); }
          else { emit(r.v); emit(r.v >> 8); }
        } catch (e) { if (e instanceof AsmError) throw e; throw new AsmError(ln + 1, e.message); }
        finally { if (last && all.length !== ai) listing.push({ line: ln + 1, addr: start, len: all.length - ai, bytes: all.slice(ai) }); }
      }
      const now = JSON.stringify([...syms]);
      if (last) break;
      if (now === prev) finalNext = true;
      prev = now;
    }
    const user = Object.fromEntries([...syms].filter(([k]) => !(k in pre)));
    const hx = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
    const listingText = listing.map((l) => `${String(l.line).padStart(4)} ${hx(l.addr, 4)}  ${l.bytes.slice(0, 4).map((b) => hx(b, 2)).join(' ').padEnd(11)}${l.bytes.length > 4 ? '+' : ' '} ${lines[l.line - 1].trimEnd()}`).join('\n');
    return { segments: segs.filter((s) => s.bytes.length), symbols: user, listing, listingText, xex: toXex(segs) };
  }

  function toXex(segs) {
    const o = [0xFF, 0xFF];
    for (const s of segs) { if (!s.bytes.length) continue; const e = s.addr + s.bytes.length - 1; o.push(s.addr & 255, s.addr >> 8, e & 255, e >> 8, ...s.bytes); }
    return new Uint8Array(o);
  }

  return { assemble, evalExpr, AsmError };
});
