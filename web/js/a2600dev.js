// Atari 2600 development kit: assembler (TIA/RIOT symbols built in), disassembler, state inspector and graphics-to-asm helpers.
// DOM-free so it runs in Node tests and in console.html. Meant for both people and AI agents: every function returns plain data.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AC = root.AC || {}; root.AC.A2600Dev = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const OPTXT = {
    ADC: 'imm69 zp65 zpx75 abs6D abx7D aby79 inx61 iny71', AND: 'imm29 zp25 zpx35 abs2D abx3D aby39 inx21 iny31',
    ASL: 'acc0A zp06 zpx16 abs0E abx1E', BCC: 'rel90', BCS: 'relB0', BEQ: 'relF0', BIT: 'zp24 abs2C', BMI: 'rel30', BNE: 'relD0',
    BPL: 'rel10', BRK: 'imp00', BVC: 'rel50', BVS: 'rel70', CLC: 'imp18', CLD: 'impD8', CLI: 'imp58', CLV: 'impB8',
    CMP: 'immC9 zpC5 zpxD5 absCD abxDD abyD9 inxC1 inyD1', CPX: 'immE0 zpE4 absEC', CPY: 'immC0 zpC4 absCC',
    DEC: 'zpC6 zpxD6 absCE abxDE', DEX: 'impCA', DEY: 'imp88', EOR: 'imm49 zp45 zpx55 abs4D abx5D aby59 inx41 iny51',
    INC: 'zpE6 zpxF6 absEE abxFE', INX: 'impE8', INY: 'impC8', JMP: 'abs4C ind6C', JSR: 'abs20',
    LDA: 'immA9 zpA5 zpxB5 absAD abxBD abyB9 inxA1 inyB1', LDX: 'immA2 zpA6 zpyB6 absAE abyBE', LDY: 'immA0 zpA4 zpxB4 absAC abxBC',
    LSR: 'acc4A zp46 zpx56 abs4E abx5E', NOP: 'impEA', ORA: 'imm09 zp05 zpx15 abs0D abx1D aby19 inx01 iny11',
    PHA: 'imp48', PHP: 'imp08', PLA: 'imp68', PLP: 'imp28', ROL: 'acc2A zp26 zpx36 abs2E abx3E', ROR: 'acc6A zp66 zpx76 abs6E abx7E',
    RTI: 'imp40', RTS: 'imp60', SBC: 'immE9 zpE5 zpxF5 absED abxFD abyF9 inxE1 inyF1', SEC: 'imp38', SED: 'impF8', SEI: 'imp78',
    STA: 'zp85 zpx95 abs8D abx9D aby99 inx81 iny91', STX: 'zp86 zpy96 abs8E', STY: 'zp84 zpx94 abs8C',
    TAX: 'impAA', TAY: 'impA8', TSX: 'impBA', TXA: 'imp8A', TXS: 'imp9A', TYA: 'imp98'
  };
  const OPS = {}, DIS = {};
  for (const m in OPTXT) {
    OPS[m] = {};
    for (const t of OPTXT[m].split(' ')) { const mode = t.slice(0, -2), code = parseInt(t.slice(-2), 16); OPS[m][mode] = code; DIS[code] = { m, mode }; }
  }
  const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, inx: 2, iny: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };

  const SYMBOLS = {};
  ('VSYNC VBLANK WSYNC RSYNC NUSIZ0 NUSIZ1 COLUP0 COLUP1 COLUPF COLUBK CTRLPF REFP0 REFP1 PF0 PF1 PF2 RESP0 RESP1 RESM0 RESM1 RESBL ' +
    'AUDC0 AUDC1 AUDF0 AUDF1 AUDV0 AUDV1 GRP0 GRP1 ENAM0 ENAM1 ENABL HMP0 HMP1 HMM0 HMM1 HMBL VDELP0 VDELP1 VDELBL RESMP0 RESMP1 HMOVE HMCLR CXCLR')
    .split(' ').forEach((n, i) => { SYMBOLS[n] = i; });
  'CXM0P CXM1P CXP0FB CXP1FB CXM0FB CXM1FB CXBLPF CXPPMM INPT0 INPT1 INPT2 INPT3 INPT4 INPT5'.split(' ').forEach((n, i) => { SYMBOLS[n] = i; });
  Object.assign(SYMBOLS, { SWCHA: 0x280, SWACNT: 0x281, SWCHB: 0x282, SWBCNT: 0x283, INTIM: 0x284, TIMINT: 0x285, TIM1T: 0x294, TIM8T: 0x295, TIM64T: 0x296, T1024T: 0x297 });
  const DIRECTIVES = new Set(['ORG', '.ORG', 'EQU', '=', '.BYTE', 'BYTE', '.DB', 'DC.B', '.WORD', 'WORD', '.DW', 'DC.W', 'DS', '.DS', 'DS.B', '.FILL', 'PROCESSOR', 'SEG', 'INCLUDE', 'END', 'ALIGN']);

  function parseNum(t) {
    if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
    if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
    if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return null;
  }

  // Splits "label  op  arg ; comment" while keeping quoted text and commas inside the argument intact.
  function splitLine(raw) {
    let s = raw, q = null;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ';') { s = s.slice(0, i); break; } }
    if (!s.trim()) return { label: '', op: '', arg: '' };
    let label = '', rest = s;
    if (!/^\s/.test(s)) {
      const m = s.match(/^(\S+)\s*(.*)$/); let first = m[1];
      if (first.endsWith(':')) { label = first.slice(0, -1); rest = m[2]; }
      else if (DIRECTIVES.has(first.toUpperCase()) || OPS[first.toUpperCase()]) rest = s;
      else { label = first; rest = m[2]; }
    }
    rest = rest.trim();
    const m2 = rest.match(/^(\S+)\s*(.*)$/);
    let op = m2 ? m2[1] : '', arg = m2 ? m2[2].trim() : '';
    if (!op && !label) return { label, op: '', arg: '' };
    if (arg.startsWith('=') || arg.toUpperCase().startsWith('EQU ')) { if (!label) label = op; arg = arg.replace(/^=|^EQU\s+/i, '').trim(); op = 'EQU'; }
    if (op === '=') op = 'EQU';
    return { label, op: op.toUpperCase(), arg };
  }

  function assemble(src, opts) {
    opts = opts || {};
    const lines = String(src).split(/\r?\n/).map(splitLine), errors = [], sym = Object.assign({}, SYMBOLS), force = new Set(), listing = [];
    const mem = new Map();
    let curLine = 0, pass = 1, pc = 0xf000, unk = false;
    const err = (m) => { if (pass === 2) errors.push({ line: curLine + 1, message: m }); };
    function term(t) {
      t = t.trim(); if (!t) return 0;
      let f = null; if (t[0] === '<' || t[0] === '>') { f = t[0]; t = t.slice(1).trim(); }
      let v;
      if (t === '*') v = pc;
      else if (/^'.$/.test(t)) v = t.charCodeAt(1);
      else if ((v = parseNum(t)) === null) {
        if (Object.prototype.hasOwnProperty.call(sym, t)) v = sym[t];
        else { unk = true; if (pass === 2) err('undefined symbol ' + t); v = 0; }
      }
      return f === '<' ? v & 255 : f === '>' ? (v >> 8) & 255 : v;
    }
    function expr(e) {
      unk = false; const parts = e.match(/[+-]?[^+-]+/g) || []; let v = 0;
      parts.forEach((p, i) => { const neg = p[0] === '-', body = p.replace(/^[+-]/, ''); const x = term(body); v += neg ? -x : x; if (i === 0 && !/^[+-]/.test(p)) v = v; });
      return v;
    }
    function emit(b) { if (pass === 2) mem.set(pc, b & 255); pc = (pc + 1) & 0xffff; }
    function operand(a) {
      let m;
      if (!a) return { mode: 'imp' };
      if (/^a$/i.test(a)) return { mode: 'acc' };
      if (a[0] === '#') return { mode: 'imm', e: a.slice(1) };
      if ((m = a.match(/^\((.*),\s*x\)$/i))) return { mode: 'inx', e: m[1] };
      if ((m = a.match(/^\((.*)\)\s*,\s*y$/i))) return { mode: 'iny', e: m[1] };
      if ((m = a.match(/^\((.*)\)$/))) return { mode: 'ind', e: m[1] };
      if ((m = a.match(/^(.*),\s*x$/i))) return { mode: 'idx', e: m[1], r: 'x' };
      if ((m = a.match(/^(.*),\s*y$/i))) return { mode: 'idx', e: m[1], r: 'y' };
      return { mode: 'dir', e: a };
    }
    for (pass = 1; pass <= 2; pass++) {
      pc = 0xf000;
      for (curLine = 0; curLine < lines.length; curLine++) {
        const L = lines[curLine], start = pc; let bytes = [];
        if (L.op === 'EQU') { if (L.label) { const v = expr(L.arg); sym[L.label] = v; } continue; }
        if (L.label) sym[L.label] = pc;
        if (!L.op) continue;
        const before = mem.size;
        if (L.op === 'ORG' || L.op === '.ORG') { pc = expr(L.arg) & 0xffff; continue; }
        if (['PROCESSOR', 'SEG', 'INCLUDE', 'END'].includes(L.op)) continue;
        if (['.BYTE', 'BYTE', '.DB', 'DC.B'].includes(L.op)) {
          for (const p of L.arg.split(',')) { const t = p.trim(); if (/^".*"$/.test(t)) for (const ch of t.slice(1, -1)) { bytes.push(ch.charCodeAt(0)); emit(ch.charCodeAt(0)); } else { const v = expr(t); bytes.push(v & 255); emit(v); } }
        } else if (['.WORD', 'WORD', '.DW', 'DC.W'].includes(L.op)) {
          for (const p of L.arg.split(',')) { const v = expr(p); bytes.push(v & 255, (v >> 8) & 255); emit(v); emit(v >> 8); }
        } else if (['DS', '.DS', 'DS.B', '.FILL'].includes(L.op)) {
          const a = L.arg.split(','), n = expr(a[0]), f = a[1] ? expr(a[1]) : 0; for (let i = 0; i < n; i++) { bytes.push(f & 255); emit(f); }
        } else if (L.op === 'ALIGN') {
          const n = expr(L.arg); while (pc % n) { bytes.push(0); emit(0); }
        } else if (OPS[L.op]) {
          const tbl = OPS[L.op], o = operand(L.arg); let mode = o.mode, v = 0, isUnk = false;
          if (o.e !== undefined) { v = expr(o.e); isUnk = unk; if (pass === 1 && isUnk) force.add(curLine); }
          const small = !isUnk && !force.has(curLine) && v >= 0 && v <= 255;
          if (mode === 'dir' && tbl.rel !== undefined) mode = 'rel';
          else if (mode === 'dir' || mode === 'idx') {
            const sfx = mode === 'idx' ? o.r : '', zp = 'zp' + sfx, ab = 'ab' + (sfx ? sfx : 's');
            const abName = sfx ? 'ab' + sfx : 'abs';
            if (tbl[zp] !== undefined && (small || tbl[abName] === undefined)) mode = zp; else mode = abName;
          }
          if (tbl[mode] === undefined) { err(L.op + ' does not support ' + mode + ' addressing'); }
          else {
            bytes.push(tbl[mode]); emit(tbl[mode]);
            if (mode === 'rel') { const off = v - (pc + 1); if (pass === 2 && (off < -128 || off > 127)) err('branch out of range (' + off + ')'); bytes.push(off & 255); emit(off); }
            else if (SIZE[mode] === 2) { if (pass === 2 && (v < -128 || v > 255)) err('value out of byte range'); bytes.push(v & 255); emit(v); }
            else if (SIZE[mode] === 3) { bytes.push(v & 255, (v >> 8) & 255); emit(v); emit(v >> 8); }
          }
        } else err('unknown mnemonic or directive ' + L.op);
        if (pass === 2 && before !== undefined) listing.push({ line: curLine + 1, addr: start, bytes });
      }
    }
    const used = [...mem.keys()];
    const rom = new Uint8Array(opts.size || 4096).fill(opts.fill === undefined ? 0xff : opts.fill);
    for (const [a, b] of mem) rom[a % rom.length] = b;
    return { ok: errors.length === 0, errors, rom, symbols: sym, listing, size: used.length, entry: sym.Start !== undefined ? sym.Start : null };
  }

  function disasm(read, pc, count) {
    const out = [];
    for (let n = 0; n < (count || 1); n++) {
      const op = read(pc), d = DIS[op];
      if (!d) { out.push({ addr: pc, len: 1, bytes: [op], text: '.byte $' + op.toString(16).toUpperCase().padStart(2, '0') }); pc = (pc + 1) & 0xffff; continue; }
      const len = SIZE[d.mode], b = [op]; for (let i = 1; i < len; i++) b.push(read((pc + i) & 0xffff));
      const w = b[1] | (b[2] << 8), h2 = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0'), h4 = (v) => '$' + v.toString(16).toUpperCase().padStart(4, '0');
      const arg = { imp: '', acc: 'A', imm: '#' + h2(b[1]), zp: h2(b[1]), zpx: h2(b[1]) + ',X', zpy: h2(b[1]) + ',Y', inx: '(' + h2(b[1]) + ',X)', iny: '(' + h2(b[1]) + '),Y', rel: h4((pc + 2 + ((b[1] << 24) >> 24)) & 0xffff), abs: h4(w), abx: h4(w) + ',X', aby: h4(w) + ',Y', ind: '(' + h4(w) + ')' }[d.mode];
      out.push({ addr: pc, len, bytes: b, text: (d.m + ' ' + arg).trim() });
      pc = (pc + len) & 0xffff;
    }
    return out;
  }

  const FLAGNAMES = 'NV-BDIZC';
  // Snapshot of everything a programmer wants to watch: CPU, beam position, the five TIA objects, playfield and RAM.
  function inspect(con) {
    const c = con.cpu, t = con.tia, p = c.p;
    const obj = (i) => ({ x: i === 0 ? t.p0 : t.p1, grp: i === 0 ? t.grp0 : t.grp1, delayed: i === 0 ? t.grp0d : t.grp1d, color: i === 0 ? t.colup0 : t.colup1, nusiz: i === 0 ? t.nusiz0 : t.nusiz1, reflect: !!(i === 0 ? t.refp0 : t.refp1), hmove: t.hm[i] });
    let flags = ''; for (let i = 0; i < 8; i++) flags += (p & (0x80 >> i)) ? FLAGNAMES[i] : '.';
    return {
      cpu: { a: c.a, x: c.x, y: c.y, sp: c.sp, pc: c.pc, p, flags, cycles: c.cycles },
      beam: { scanline: t.y, colorClock: t.hpos, vsync: !!(t.vsync & 2), vblank: !!(t.vblank & 2) },
      players: [obj(0), obj(1)],
      missiles: [{ x: t.m0, enabled: !!(t.enam0 & 2), hmove: t.hm[2], resetToPlayer: !!(t.resmp0 & 2) }, { x: t.m1, enabled: !!(t.enam1 & 2), hmove: t.hm[3], resetToPlayer: !!(t.resmp1 & 2) }],
      ball: { x: t.bl, enabled: !!(t.enabl & 2), delayed: !!(t.enabld & 2), hmove: t.hm[4] },
      playfield: { pf0: t.pf0, pf1: t.pf1, pf2: t.pf2, ctrlpf: t.ctrlpf, mirror: !!(t.ctrlpf & 1), score: !!(t.ctrlpf & 2), priority: !!(t.ctrlpf & 4), ballSize: 1 << ((t.ctrlpf >> 4) & 3), colorFg: t.colupf, colorBg: t.colubk },
      ram: Array.from(con.ram)
    };
  }

  // Graphics helpers: bitmaps in, ready-to-paste assembler out.
  function spriteAsm(rows, label) {
    const out = [label || 'Sprite'];
    rows.forEach((r) => { const bits = String(r).replace(/[^.X01#]/gi, '').padEnd(8, '.').slice(0, 8); out.push('\t.byte %' + bits.replace(/[X#1]/gi, '1').replace(/\./g, '0')); });
    return out.join('\n');
  }
  function playfieldAsm(cells, label) {
    const c = String(cells).replace(/[^.X01#]/gi, '').padEnd(20, '.').slice(0, 20).split('').map((ch) => (/[X#1]/i.test(ch) ? 1 : 0));
    let pf0 = 0, pf1 = 0, pf2 = 0;
    for (let i = 0; i < 4; i++) if (c[i]) pf0 |= 0x10 << i;
    for (let i = 0; i < 8; i++) { if (c[4 + i]) pf1 |= 0x80 >> i; if (c[12 + i]) pf2 |= 1 << i; }
    const b = (v) => '%' + v.toString(2).padStart(8, '0');
    return { pf0, pf1, pf2, asm: (label || 'PF') + '\n\t.byte ' + b(pf0) + ',' + b(pf1) + ',' + b(pf2) + '  ; PF0,PF1,PF2' };
  }
  const STARTER = [
    '\tPROCESSOR 6502', '\tORG $F000', '',
    'Start\tSEI', '\tCLD', '\tLDX #$FF', '\tTXS', '\tLDA #0', 'Clear\tSTA 0,X', '\tDEX', '\tBNE Clear', '',
    '\tLDA #$1E', '\tSTA COLUP0', '\tLDA #$84', '\tSTA COLUBK', '\tLDA #$30', '\tSTA COLUPF', '\tLDA #%00110000', '\tSTA PF1', '',
    'Frame\tLDA #2', '\tSTA VSYNC', '\tSTA WSYNC', '\tSTA WSYNC', '\tSTA WSYNC', '\tLDA #0', '\tSTA VSYNC',
    '\tLDX #37', 'VB\tSTA WSYNC', '\tDEX', '\tBNE VB',
    '\tLDX #192', 'Line\tSTA WSYNC', '\tLDA Ship-1,X', '\tSTA GRP0', '\tDEX', '\tBNE Line',
    '\tLDA #2', '\tSTA VBLANK', '\tLDX #30', 'OS\tSTA WSYNC', '\tDEX', '\tBNE OS', '\tLDA #0', '\tSTA VBLANK', '\tJMP Frame', '',
    '\tORG $F100', 'Ship', '\t.byte %00011000,%00111100,%01111110,%11111111,%11111111,%01011010,%01011010,%10000001', '\tDS 184', '',
    '\tORG $FFFC', '\t.word Start', '\t.word Start'
  ].join('\n');

  return { assemble, disasm, inspect, spriteAsm, playfieldAsm, OPS, SYMBOLS, STARTER };
});
