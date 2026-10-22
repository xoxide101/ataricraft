// Extended-RAM bank test. Builds a small 6502 program (with a tiny built-in assembler) that runs ON the emulated Atari.
// It probes every PORTB bank-select combination, counts the distinct 16 KB banks the machine really has, checks that
// the main $4000-$7FFF window is left alone, then fills and verifies every bank with an address/bank pattern and its
// complement (stuck bits, bank aliasing and bank crosstalk show up as errors). $5000-$57FF is skipped (Self-Test ROM).
(function () {
  const RES = 0x600, REPS = 0x620, NCOMBO = 64;
  // zero page variables
  const PTR = 0x80, PG = 0x82, BNK = 0x83, MODE = 0x84, MSK = 0x85, IDX = 0x86, TMP = 0x87;

  const OPS = {
    LDA: { imm: 0xA9, zp: 0xA5, abs: 0xAD, absx: 0xBD, indy: 0xB1 }, STA: { zp: 0x85, abs: 0x8D, absx: 0x9D, indy: 0x91 },
    LDX: { imm: 0xA2, zp: 0xA6, abs: 0xAE }, LDY: { imm: 0xA0 }, STX: { zp: 0x86 }, STY: { zp: 0x84 },
    INC: { zp: 0xE6, abs: 0xEE }, CPX: { imm: 0xE0 }, CMP: { imm: 0xC9, zp: 0xC5, abs: 0xCD, indy: 0xD1 }, EOR: { imm: 0x49, zp: 0x45 },
    JMP: { abs: 0x4C }, JSR: { abs: 0x20 },
    INX: { imp: 0xE8 }, INY: { imp: 0xC8 }, RTS: { imp: 0x60 }, SEI: { imp: 0x78 }, CLI: { imp: 0x58 }, TXA: { imp: 0x8A }, TYA: { imp: 0x98 }, PHA: { imp: 0x48 }, PLA: { imp: 0x68 },
    BEQ: { rel: 0xF0 }, BNE: { rel: 0xD0 }, BCC: { rel: 0x90 }, BCS: { rel: 0xB0 },
  };

  function assemble(lines, org, tail) {
    const labels = {};
    const items = [];
    let pc = org;
    const num = (s) => (s[0] === '$' ? parseInt(s.slice(1), 16) : parseInt(s, 10));
    const val = (s) => (/^[A-Za-z_]/.test(s) ? { label: s } : { n: num(s) });
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.endsWith(':')) { labels[line.slice(0, -1)] = pc; continue; }
      const m = line.match(/^(\w+)\s*(.*)$/);
      const op = m[1].toUpperCase(), arg = m[2].trim();
      const t = OPS[op];
      if (!t) throw new Error('unknown op ' + op);
      let mode, v;
      if (!arg) mode = 'imp';
      else if (arg[0] === '#') { mode = 'imm'; v = val(arg.slice(1)); }
      else if (/^\(.*\),\s*[yY]$/.test(arg)) { mode = 'indy'; v = val(arg.match(/^\((.*)\)/)[1]); }
      else if (/,\s*[xX]$/.test(arg)) { mode = 'absx'; v = val(arg.replace(/,\s*[xX]$/, '')); }
      else if (t.rel) { mode = 'rel'; v = val(arg); }
      else { v = val(arg); mode = v.n !== undefined && v.n < 256 && t.zp !== undefined ? 'zp' : 'abs'; }
      if (t[mode] === undefined) throw new Error(`bad mode ${mode} for ${line}`);
      const size = mode === 'imp' ? 1 : mode === 'abs' || mode === 'absx' ? 3 : 2;
      items.push({ op: t[mode], mode, v, size, pc, line });
      pc += size;
    }
    labels.tbl = pc;
    const out = [];
    for (const it of items) {
      out.push(it.op);
      if (it.size === 1) continue;
      const x = it.v.label ? labels[it.v.label] : it.v.n;
      if (x === undefined) throw new Error('undefined label in ' + it.line);
      if (it.mode === 'rel') {
        const d = x - (it.pc + 2);
        if (d < -128 || d > 127) throw new Error('branch out of range: ' + it.line);
        out.push(d & 255);
      } else if (it.size === 2) out.push(x & 255);
      else out.push(x & 255, x >> 8);
    }
    return out.concat(tail);
  }

  // PORTB values: OS ROM on (bit0), CPU window on (bit4 = 0), the other bits (1,2,3,5,6,7) walked through all 64 combinations.
  function combos() {
    const bits = [0x02, 0x04, 0x08, 0x20, 0x40, 0x80], t = [];
    for (let i = 0; i < NCOMBO; i++) { let b = 0x01; bits.forEach((m, k) => { if (i & (1 << k)) b |= m; }); t.push(b); }
    return t;
  }

  function program() {
    const R = (n) => RES + n;
    const code = [
      'SEI', 'LDA #0', `STA $D40E`, 'LDA #$FF', 'STA $D301',
      'LDA #$55', 'STA $4000',
      'LDX #0',
      'p1w:', 'LDA tbl,X', 'STA $D301', 'TXA', 'STA $4000', 'EOR #$FF', 'STA $7FFF', 'INX', `CPX #${NCOMBO}`, 'BNE p1w',
      'LDX #0',
      'p1r:', 'LDA tbl,X', 'STA $D301', 'LDA $4000', `STX ${TMP}`, `CMP ${TMP}`, 'BNE no', 'LDA $7FFF', 'EOR #$FF', `CMP ${TMP}`, 'BNE no',
      'LDA #1', 'BNE st', 'no:', 'LDA #0', 'st:', `STA ${REPS},X`, 'BEQ sk', `INC ${R(1)}`, 'sk:', 'INX', `CPX #${NCOMBO}`, 'BNE p1r',
      'LDA #$FF', 'STA $D301', `LDA #0`, `STA ${R(2)}`, 'LDA $4000', 'CMP #$55', 'BNE m1', `INC ${R(2)}`, 'm1:',
      `LDA #0`, `STA ${MSK}`,
      `LDA #1`, `STA ${R(3)}`, `LDA #0`, `STA ${MODE}`, 'JSR scan',
      `LDA #2`, `STA ${R(3)}`, `LDA #1`, `STA ${MODE}`, 'JSR scan',
      `LDA #$FF`, `STA ${MSK}`,
      `LDA #3`, `STA ${R(3)}`, `LDA #0`, `STA ${MODE}`, 'JSR scan',
      `LDA #4`, `STA ${R(3)}`, `LDA #1`, `STA ${MODE}`, 'JSR scan',
      'LDA #$FF', 'STA $D301', 'LDA #$40', 'STA $D40E', 'LDA #1', `STA ${R(0)}`, 'CLI',
      'spin:', 'JMP spin',
      'scan:', 'LDA #0', `STA ${IDX}`, `STA ${BNK}`,
      'sl:', `LDX ${IDX}`, `LDA ${REPS},X`, 'BEQ sn', 'LDA tbl,X', 'STA $D301', 'LDA #$40', `STA ${PG}`,
      'pl:', `LDA ${PG}`, 'CMP #$50', 'BCC ok', 'CMP #$58', 'BCC skp',
      'ok:', `STA ${PTR + 1}`, 'LDA #0', `STA ${PTR}`, 'LDY #0',
      'il:', 'TYA', `EOR ${PG}`, `EOR ${BNK}`, `EOR ${MSK}`, `STA ${TMP}`, `LDA ${MODE}`, 'BNE ver', `LDA ${TMP}`, `STA (${PTR}),Y`, 'JMP nx',
      'ver:', `LDA (${PTR}),Y`, `CMP ${TMP}`, 'BEQ nx', 'JSR err',
      'nx:', 'INY', 'BNE il',
      'skp:', `INC ${PG}`, `LDA ${PG}`, 'CMP #$80', 'BNE pl',
      `INC ${BNK}`, `LDA ${BNK}`, `STA ${R(4)}`,
      'sn:', `INC ${IDX}`, `LDA ${IDX}`, `CMP #${NCOMBO}`, 'BNE sl', 'RTS',
      'err:', `INC ${R(5)}`, 'BNE e1', `INC ${R(6)}`, 'BNE e1', `INC ${R(12)}`,
      'e1:', `LDX ${R(6)}`, 'BNE e2', `LDX ${R(12)}`, 'BNE e2', `LDX ${R(5)}`, 'CPX #1', 'BNE e2',
      `STA ${R(10)}`, `LDA ${TMP}`, `STA ${R(9)}`, `LDA ${PG}`, `STA ${R(8)}`, `LDA ${IDX}`, `STA ${R(7)}`, `LDA ${R(3)}`, `STA ${R(11)}`,
      'e2:', 'RTS',
    ];
    const org = 0x2000;
    const bytes = assemble(code, org, combos());
    const end = org + bytes.length - 1;
    return Uint8Array.from([0xFF, 0xFF, org & 255, org >> 8, end & 255, end >> 8, ...bytes, 0xE0, 0x02, 0xE1, 0x02, org & 255, org >> 8]);
  }

  // Number of extended 16 KB banks a RAM option should provide.
  function expectedBanks(ram) {
    return ({ '128': 4, '192': 8, '320r': 16, '320c': 16, '576': 32, '1088': 64 })[ram] || 0;
  }

  function read(emu) {
    const r = emu.peek(RES, 16);
    return {
      done: r[0] === 1, found: r[1], mainIntact: r[2] === 1, phase: r[3], bank: r[4],
      errors: r[5] + (r[6] << 8) + (r[12] << 16),
      first: { combo: r[7], page: r[8], expected: r[9], got: r[10], phase: r[11] },
    };
  }

  window.AC = window.AC || {};
  AC.MemTest = { program, expectedBanks, read, combos };
})();
