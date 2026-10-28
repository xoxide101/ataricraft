/* WebAFM tool library: pure functions (no DOM) so they can be tested in Node.
   Text codec, hex helpers, checksums. Disassembler/assembler/BASIC/etc. are added below as they are built. */
(function () {
  'use strict';
  const T = {};

  // ---------- text <-> bytes ----------
  // Modes: 'atascii' (EOL = $9B), 'lf' (PC/Unix), 'crlf' (PC/Windows).
  // Bytes that are not plain text show as {$XX} so every file round-trips byte for byte.
  const hx = (b) => b.toString(16).toUpperCase().padStart(2, '0');
  const TOKEN = /\{\$([0-9A-Fa-f]{2})\}/g;

  T.decodeText = function (bytes, mode) {
    mode = mode || 'atascii';
    let out = '';
    const n = bytes.length;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (mode === 'atascii' && b === 0x9b) out += '\n';
      else if (mode === 'lf' && b === 10) out += '\n';
      else if (mode === 'crlf' && b === 13 && bytes[i + 1] === 10) { out += '\n'; i++; }
      else if (mode !== 'atascii' && b === 9) out += '\t';
      else if (b >= 32 && b < 127) out += b === 123 && /^\$[0-9A-Fa-f]{2}\}/.test(String.fromCharCode(bytes[i + 1] || 0, bytes[i + 2] || 0, bytes[i + 3] || 0, bytes[i + 4] || 0)) ? '{$7B}' : String.fromCharCode(b);
      else out += '{$' + hx(b) + '}';
    }
    return out;
  };

  T.encodeText = function (str, mode) {
    mode = mode || 'atascii';
    str = str.replace(/\r\n?/g, '\n');
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '{') { const m = /^\{\$([0-9A-Fa-f]{2})\}/.exec(str.slice(i, i + 5)); if (m) { out.push(parseInt(m[1], 16)); i += 4; continue; } }
      if (c === '\n') { if (mode === 'atascii') out.push(0x9b); else if (mode === 'crlf') out.push(13, 10); else out.push(10); }
      else { const k = c.charCodeAt(0); out.push(k < 256 ? k : 63); }
    }
    return new Uint8Array(out);
  };

  // How text-like a file is (0..1) and which line-ending convention it uses.
  T.sniff = function (bytes) {
    const n = Math.min(bytes.length, 8192);
    if (!n) return { text: true, mode: 'atascii', score: 1 };
    let ok = 0, a = 0, lf = 0, crlf = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0x9b) { a++; ok++; } else if (b === 10) { lf++; ok++; if (bytes[i - 1] === 13) crlf++; } else if (b === 13 || b === 9) ok++;
      else if (b >= 32 && b < 127) ok++;
    }
    const mode = crlf && crlf >= lf / 2 ? 'crlf' : lf > a ? 'lf' : 'atascii';
    const score = ok / n, binary = bytes[0] === 0xff && bytes[1] === 0xff;
    return { text: score >= 0.9 && !binary, mode, score, binary };
  };

  // ---------- hex ----------
  T.hexRow = function (data, off, w) {
    w = w || 16;
    const row = data.subarray(off, off + w);
    let h = '', a = '';
    for (let i = 0; i < w; i++) { if (i < row.length) { h += hx(row[i]) + ' '; a += row[i] >= 32 && row[i] < 127 ? String.fromCharCode(row[i]) : '.'; } else h += '   '; }
    return off.toString(16).toUpperCase().padStart(6, '0') + '  ' + h + ' ' + a;
  };
  T.parseHex = function (s) {
    const t = s.replace(/[\s,]|0x|\$/gi, '');
    if (!t || t.length % 2 || /[^0-9a-f]/i.test(t)) return null;
    const out = new Uint8Array(t.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
    return out;
  };
  // Find `needle` (Uint8Array) in `data` from `from`; dir 1 forward, -1 backward. Returns index or -1.
  T.findBytes = function (data, needle, from, dir) {
    const n = needle.length; if (!n) return -1;
    const ok = (i) => { for (let k = 0; k < n; k++) if (data[i + k] !== needle[k]) return false; return true; };
    if (dir < 0) { for (let i = Math.min(from, data.length - n); i >= 0; i--) if (ok(i)) return i; } else for (let i = Math.max(0, from); i <= data.length - n; i++) if (ok(i)) return i;
    return -1;
  };

  // ---------- checksums ----------
  let crcT = null;
  T.crc32 = function (d) {
    if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  T.crc16 = function (d) { let c = 0xffff; for (let i = 0; i < d.length; i++) { c ^= d[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; };
  T.sum16 = function (d) { let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) & 0xffff; return s; };
  T.hex = hx;

  // ---------- 6502 disassembler ----------
  const OPS = {}; // opcode -> [mnemonic, mode]
  (function () {
    const g = (m, list) => { for (const [op, mo] of list) OPS[op] = [m, mo]; };
    const alu = { ORA: 0x01, AND: 0x21, EOR: 0x41, ADC: 0x61, STA: 0x81, LDA: 0xa1, CMP: 0xc1, SBC: 0xe1 };
    const aluModes = [['izx', 0], ['zp', 4], ['imm', 8], ['abs', 12], ['izy', 16], ['zpx', 20], ['aby', 24], ['abx', 28]];
    for (const m in alu) for (const [mo, d] of aluModes) if (!(m === 'STA' && mo === 'imm')) OPS[alu[m] + d] = [m, mo];
    const rmw = { ASL: 0x02, ROL: 0x22, LSR: 0x42, ROR: 0x62, DEC: 0xc2, INC: 0xe2 };
    for (const m in rmw) { const b = rmw[m]; g(m, [[b + 4, 'zp'], [b + 12, 'abs'], [b + 20, 'zpx'], [b + 28, 'abx']]); if (m !== 'DEC' && m !== 'INC') OPS[b + 8] = [m, 'acc']; }
    g('STX', [[0x86, 'zp'], [0x8e, 'abs'], [0x96, 'zpy']]); g('LDX', [[0xa2, 'imm'], [0xa6, 'zp'], [0xae, 'abs'], [0xb6, 'zpy'], [0xbe, 'aby']]);
    g('STY', [[0x84, 'zp'], [0x8c, 'abs'], [0x94, 'zpx']]); g('LDY', [[0xa0, 'imm'], [0xa4, 'zp'], [0xac, 'abs'], [0xb4, 'zpx'], [0xbc, 'abx']]);
    g('CPY', [[0xc0, 'imm'], [0xc4, 'zp'], [0xcc, 'abs']]); g('CPX', [[0xe0, 'imm'], [0xe4, 'zp'], [0xec, 'abs']]);
    g('BIT', [[0x24, 'zp'], [0x2c, 'abs']]); g('JMP', [[0x4c, 'abs'], [0x6c, 'ind']]); g('JSR', [[0x20, 'abs']]);
    const br = { BPL: 0x10, BMI: 0x30, BVC: 0x50, BVS: 0x70, BCC: 0x90, BCS: 0xb0, BNE: 0xd0, BEQ: 0xf0 };
    for (const m in br) OPS[br[m]] = [m, 'rel'];
    const imp = { BRK: 0x00, PHP: 0x08, CLC: 0x18, PLP: 0x28, SEC: 0x38, RTI: 0x40, PHA: 0x48, CLI: 0x58, RTS: 0x60, PLA: 0x68, SEI: 0x78, DEY: 0x88, TXA: 0x8a, TYA: 0x98, TXS: 0x9a, TAY: 0xa8, TAX: 0xaa, CLV: 0xb8, TSX: 0xba, INY: 0xc8, DEX: 0xca, CLD: 0xd8, INX: 0xe8, NOP: 0xea, SED: 0xf8 };
    for (const m in imp) OPS[imp[m]] = [m, 'imp'];
  })();
  const LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };
  // Well-known Atari OS / hardware addresses used to label operands.
  T.ATARI_LABELS = {
    0x0A: 'WARMST', 0x0C: 'DOSVEC', 0x0E: 'DOSINI', 0x10: 'POKMSK', 0x12: 'RTCLOK', 0x14: 'RTCLOK+2', 0x43: 'CASINI', 0x58: 'SAVMSC', 0x5A: 'OLDROW', 0x5C: 'OLDCOL', 0x5D: 'OLDCHR',     0x5E: 'OLDADR',
        0x90: 'APPMHI', 0xD4: 'FR0', 0xE0: 'FR1', 0xF2: 'CIX', 0xF3: 'INBUFF',
    0x200: 'VDSLST', 0x202: 'VPRCED', 0x204: 'VINTER', 0x206: 'VBREAK', 0x208: 'VKEYBD', 0x20A: 'VSERIN', 0x20C: 'VSEROR', 0x20E: 'VSEROC', 0x210: 'VTIMR1', 0x212: 'VTIMR2', 0x214: 'VTIMR4', 0x216: 'VIMIRQ',
    0x218: 'CDTMV1', 0x21A: 'CDTMV2', 0x21C: 'CDTMV3', 0x21E: 'CDTMV4', 0x220: 'CDTMV5', 0x222: 'VVBLKI', 0x224: 'VVBLKD', 0x226: 'CDTMA1', 0x228: 'CDTMA2', 0x22A: 'CDTMF3', 0x22C: 'SRTIMR', 0x22F: 'SDMCTL', 0x230: 'SDLSTL', 0x231: 'SDLSTH',
    0x26F: 'GPRIOR', 0x270: 'PADDL0', 0x278: 'STICK0', 0x279: 'STICK1', 0x27C: 'PTRIG0', 0x284: 'STRIG0', 0x285: 'STRIG1', 0x2C0: 'PCOLR0', 0x2C4: 'COLOR0', 0x2C5: 'COLOR1', 0x2C6: 'COLOR2', 0x2C7: 'COLOR3', 0x2C8: 'COLOR4',
    0x2E0: 'RUNAD', 0x2E2: 'INITAD', 0x2E5: 'MEMTOP', 0x2E7: 'MEMLO', 0x2F0: 'CRSINH', 0x2F4: 'CHBAS', 0x2FC: 'CH', 0x2FB: 'ATACHR', 0x2F3: 'CHACT',
    0x300: 'DDEVIC', 0x301: 'DUNIT', 0x302: 'DCOMND', 0x303: 'DSTATS', 0x304: 'DBUFLO', 0x305: 'DBUFHI', 0x306: 'DTIMLO', 0x308: 'DBYTLO', 0x30A: 'DAUX1', 0x30B: 'DAUX2',
    0x340: 'IOCB0', 0x342: 'ICCOM', 0x344: 'ICBAL', 0x345: 'ICBAH', 0x348: 'ICBLL', 0x349: 'ICBLH', 0x34A: 'ICAX1', 0x34B: 'ICAX2',
    0xD000: 'HPOSP0', 0xD001: 'HPOSP1', 0xD002: 'HPOSP2', 0xD003: 'HPOSP3', 0xD004: 'HPOSM0', 0xD008: 'SIZEP0', 0xD00D: 'GRAFP0', 0xD012: 'COLPM0', 0xD016: 'COLPF0', 0xD017: 'COLPF1', 0xD018: 'COLPF2', 0xD019: 'COLPF3', 0xD01A: 'COLBK', 0xD01B: 'PRIOR', 0xD01D: 'GRACTL', 0xD01E: 'HITCLR', 0xD01F: 'CONSOL',
    0xD200: 'AUDF1', 0xD201: 'AUDC1', 0xD202: 'AUDF2', 0xD203: 'AUDC2', 0xD204: 'AUDF3', 0xD205: 'AUDC3', 0xD206: 'AUDF4', 0xD207: 'AUDC4', 0xD208: 'AUDCTL', 0xD209: 'KBCODE', 0xD20A: 'RANDOM', 0xD20E: 'IRQEN', 0xD20F: 'SKCTL',
    0xD300: 'PORTA', 0xD301: 'PORTB', 0xD302: 'PACTL', 0xD303: 'PBCTL',
    0xD400: 'DMACTL', 0xD401: 'CHACTL', 0xD402: 'DLISTL', 0xD403: 'DLISTH', 0xD404: 'HSCROL', 0xD405: 'VSCROL', 0xD407: 'PMBASE', 0xD409: 'CHBASE', 0xD40A: 'WSYNC', 0xD40B: 'VCOUNT', 0xD40C: 'PENH', 0xD40D: 'PENV', 0xD40E: 'NMIEN', 0xD40F: 'NMIST',
    0xE400: 'EDITRV', 0xE410: 'SCRENV', 0xE420: 'KEYBDV', 0xE430: 'PRINTV', 0xE440: 'CASETV', 0xE450: 'DISKIV', 0xE453: 'DSKINV', 0xE456: 'CIOV', 0xE459: 'SIOV', 0xE45C: 'SETVBV', 0xE45F: 'SYSVBV', 0xE462: 'XITVBV', 0xE465: 'SIOINV', 0xE468: 'SENDEV', 0xE46B: 'INTINV', 0xE46E: 'CIOINV', 0xE471: 'BLKBDV', 0xE474: 'WARMSV', 0xE477: 'COLDSV', 0xE47A: 'RBLOKV', 0xE47D: 'CSOPIV', 0xE480: 'PUPDIV',
  };
  const h4 = (n) => '$' + n.toString(16).toUpperCase().padStart(4, '0'), h2 = (n) => '$' + hx(n);
  // Split an Atari binary load file into segments: [{start, end, data}] plus trailing junk info. Returns null if not a binary load file.
  T.parseSegments = function (d) {
    if (d.length < 6 || d[0] !== 0xff || d[1] !== 0xff) return null;
    const segs = []; let i = 0, bad = null;
    while (i + 1 < d.length) {
      if (d[i] === 0xff && d[i + 1] === 0xff) { i += 2; if (i + 1 >= d.length) break; }
      if (i + 3 >= d.length) { bad = 'truncated segment header at offset ' + i; break; }
      const s = d[i] | d[i + 1] << 8, e = d[i + 2] | d[i + 3] << 8; i += 4;
      if (e < s) { bad = 'bad segment range at offset ' + (i - 4); break; }
      const len = e - s + 1, avail = Math.min(len, d.length - i);
      segs.push({ start: s, end: s + avail - 1, data: d.subarray(i, i + avail), truncated: avail < len });
      i += avail; if (avail < len) { bad = 'last segment is cut short'; break; }
    }
    return { segs, bad };
  };
  // Disassemble one instruction at data[i] (address pc). opts.labels: map addr->name. Returns {len, bytes, text, target}.
  T.disasm1 = function (data, i, pc, opts) {
    const L = (opts && opts.labels) || T.ATARI_LABELS, op = data[i], def = OPS[op];
    if (!def) return { len: 1, bytes: [op], text: '.BYTE ' + h2(op), target: null, data: true };
    const [m, mo] = def, len = LEN[mo];
    if (i + len > data.length) return { len: 1, bytes: [op], text: '.BYTE ' + h2(op), target: null, data: true };
    const b1 = data[i + 1], w = data[i + 1] | data[i + 2] << 8, nm = (a, z) => L[a] || (z ? h2(a) : h4(a));
    let arg = '', target = null;
    switch (mo) {
      case 'imp': break; case 'acc': arg = 'A'; break;
      case 'imm': arg = '#' + h2(b1); break;
      case 'zp': arg = nm(b1, 1); break; case 'zpx': arg = nm(b1, 1) + ',X'; break; case 'zpy': arg = nm(b1, 1) + ',Y'; break;
      case 'izx': arg = '(' + nm(b1, 1) + ',X)'; break; case 'izy': arg = '(' + nm(b1, 1) + '),Y'; break;
      case 'rel': target = (pc + 2 + (b1 > 127 ? b1 - 256 : b1)) & 0xffff; arg = L[target] || h4(target); break;
      case 'abs': arg = nm(w); if (m === 'JMP' || m === 'JSR') target = w; break;
      case 'abx': arg = nm(w) + ',X'; break; case 'aby': arg = nm(w) + ',Y'; break;
      case 'ind': arg = '(' + nm(w) + ')'; break;
    }
    return { len, bytes: Array.from(data.subarray(i, i + len)), text: m + (arg ? ' ' + arg : ''), target };
  };
  // Disassemble data loaded at `origin` into listing text. opts: {labels:true|false, branchLabels:true}
  T.disasm = function (data, origin, opts) {
    opts = opts || {}; const useL = opts.labels !== false ? T.ATARI_LABELS : {};
    const lines = [], tg = new Set();
    // pass 1: find branch/jump targets inside the block
    for (let i = 0, pc = origin; i < data.length;) { const r = T.disasm1(data, i, pc, { labels: useL }); if (r.target != null && r.target >= origin && r.target < origin + data.length) tg.add(r.target); i += r.len; pc += r.len; }
    const lab = Object.assign({}, useL); for (const t of tg) if (!lab[t]) lab[t] = 'L' + t.toString(16).toUpperCase().padStart(4, '0');
    for (let i = 0, pc = origin & 0xffff; i < data.length;) {
      if (tg.has(pc)) lines.push((lab[pc] || '') + ':');
      const r = T.disasm1(data, i, pc, { labels: lab });
      lines.push('  ' + h4(pc).slice(1) + '  ' + r.bytes.map(hx).join(' ').padEnd(8) + '  ' + r.text);
      i += r.len; pc = (pc + r.len) & 0xffff;
    }
    return lines.join('\n');
  };
  // Disassemble a whole file: Atari binary load files segment by segment (with INIT/RUN notes), anything else from `origin`.
  T.disasmFile = function (d, origin, opts) {
    const b = T.parseSegments(d);
    if (!b) return '; raw bytes, origin ' + h4(origin) + '\n' + T.disasm(d, origin, opts);
    const out = []; let n = 0;
    for (const s of b.segs) {
      n++;
      const note = s.start === 0x2e0 && s.data.length === 2 ? '  ; RUNAD = ' + h4(s.data[0] | s.data[1] << 8) : s.start === 0x2e2 && s.data.length === 2 ? '  ; INITAD = ' + h4(s.data[0] | s.data[1] << 8) : '';
      out.push(`; ---- segment ${n}: ${h4(s.start)}-${h4(s.end)} (${s.data.length} bytes)${s.truncated ? ' CUT SHORT' : ''}${note}`);
      if (note) out.push('  .WORD ' + h4(s.data[0] | s.data[1] << 8)); else out.push(T.disasm(s.data, s.start, opts));
    }
    if (b.bad) out.push('; ' + b.bad);
    return out.join('\n');
  };

  if (typeof AC !== 'undefined') AC.WTools = Object.assign(AC.WTools || {}, T);
  if (typeof module !== 'undefined') module.exports = T;
})();
