// Circuit Runner demo: generates the art and level data, appends it to game.asm and assembles an .XEX.
// Usage: node games/circuit/build.cjs [out.xex]
const fs = require('fs'), path = require('path');
const { assemble } = require('../../web/js/asm6502.js');

// ---- tiles: 4 pixels wide x 8 tall, '.'=background a=COLPF0 b=COLPF1 c=COLPF2 (or COLPF3 when the map byte has bit 7)
const G = {};
const T = (id, rows) => { if (rows.length !== 8 || rows.some((r) => r.length !== 4)) throw new Error('bad glyph ' + id); G[id] = rows; };
// far skyline
T(1, ['..a.', '.aaa', 'aaab', 'aaab', 'aaab', 'aaab', 'aaab', 'aaab']);
T(2, Array(8).fill('aaab'));
T(3, ['aaab', 'acab', 'aaab', 'aaab', 'aaab', 'acab', 'aaab', 'aaab']);
T(4, ['bbbb', 'aaab', 'aaab', 'aaab', 'aaab', 'aaab', 'aaab', 'aaab']);
// mid traces and chips
T(5, ['....', '....', '....', 'cccc', 'bbbb', '....', '....', '....']);
T(6, Array(8).fill('.bc.'));
T(7, ['....', '....', '....', '.ccc', '.bbb', '.bc.', '.bc.', '.bc.']);
T(8, ['....', '.cc.', 'cbbc', 'cbbc', '.cc.', '....', '....', '....']);
T(9, ['bbbb', 'bccb', 'bacb', 'bacb', 'bacb', 'bccb', 'bbbb', 'aaaa']);
T(10, ['b.b.', 'b.b.', 'bbbb', 'bccb', 'bacb', 'bbbb', 'b.b.', 'b.b.']);
// near ground, platforms, pillars
T(11, ['cccc', 'bbbb', 'abab', 'aaaa', 'abab', 'aaaa', 'abab', 'aaaa']);
T(12, ['abab', 'aaaa', 'baba', 'aaaa', 'abab', 'aaaa', 'baba', 'aaaa']);
T(13, ['cccc', 'cbbb', 'cbab', 'cbbb', 'aaaa', '....', '....', '....']);
T(14, ['cccc', 'bbbb', 'babb', 'bbbb', 'aaaa', '....', '....', '....']);
T(15, ['cccc', 'bbbc', 'babc', 'bbbc', 'aaaa', '....', '....', '....']);
T(16, ['....', 'aaaa', 'abba', 'abba', 'abba', 'abba', 'abba', 'abba']);
T(17, Array(8).fill('abba'));
T(18, ['abba', 'abba', 'acba', 'abba', 'abba', 'abba', 'abba', 'abba']);
// puzzle: heatsink block (19, solid), gate door (20, solid), plates A and B (21, 22), gate LED (23)
T(19, ['cccc', 'bbbb', 'cbbc', 'bbbb', 'cbbc', 'bbbb', 'cbbc', 'aaaa']);
T(20, ['cbcb', 'bcbc', 'cbcb', 'bcbc', 'cbcb', 'bcbc', 'cbcb', 'bcbc']);
T(21, ['....', '....', '....', '....', '....', '....', 'cccc', 'bbbb']);
T(22, ['....', '....', '....', '....', '....', '.cc.', 'cccc', 'bbbb']);
T(23, ['....', '....', '.cc.', 'cbbc', 'cbbc', '.cc.', '....', '....']);
const GT = 11, GF = 12, PL = 13, PM = 14, PR = 15, PT = 16, PB = 17, PLED = 18; // ground top, fill, platform L/M/R, pillar top/body/led

const charset = new Uint8Array(1024);
for (const [id, rows] of Object.entries(G)) rows.forEach((r, y) => {
  let b = 0; for (const ch of r) b = (b << 2) | ('.abc'.indexOf(ch));
  charset[id * 8 + y] = b;
});

// ---- tile maps: 23 rows x 256 columns, plus the first 44 columns repeated so the 44-byte fetch never runs off the row
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return (seed >> 8) % n; };
const COLS = 256, ROWS = 23, rows = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

// far skyline (rows 0-5), period 64 columns
{
  const h = []; let c = 0;
  while (c < 64) { const w = Math.min(64 - c, 3 + rnd(4)), ht = 1 + rnd(5); for (let i = 0; i < w; i++) h[c + i] = ht; c += w; }
  for (let c2 = 0; c2 < COLS; c2++) {
    const ht = h[c2 % 64];
    for (let r = 6 - ht; r < 6; r++) rows[r][c2] = r === 6 - ht ? (c2 % 3 === 0 ? 1 : 4) : (rnd(3) === 0 ? 3 | (rnd(2) ? 0x80 : 0) : 2);
  }
}
// mid circuit traces (rows 6-11), period 128 columns
{
  const m = Array.from({ length: 6 }, () => new Array(128).fill(0));
  const runs = (r) => { let c = rnd(6); while (c < 120) { const len = 6 + rnd(18); for (let i = 0; i < len && c + i < 128; i++) m[r][c + i] = 5; m[r][c] = 8; if (c + len < 128) m[r][c + len] = 8; c += len + 3 + rnd(8); } };
  runs(1); runs(3); runs(5);
  for (let c = 4; c < 124; c += 5 + rnd(9)) { m[2][c] = 6; if (m[1][c] === 0) m[1][c] = 8; if (m[3][c] === 0) m[3][c] = 8; }
  for (let c = 6; c < 120; c += 22 + rnd(14)) { for (let i = 0; i < 4; i++) { m[4][c + i] = 9 | (rnd(3) === 0 ? 0x80 : 0); m[5][c + i] = 10; } m[3][c] = 0; }
  for (let r = 0; r < 6; r++) for (let c = 0; c < COLS; c++) rows[6 + r][c] = m[r][c % 128];
}
// near layer (rows 12-22): ground, pits, platforms, pillars
{
  const solid = new Array(COLS).fill(true);
  for (const [s, l] of [[40, 6], [100, 8], [170, 6], [230, 5]]) for (let i = 0; i < l; i++) solid[s + i] = false;
  for (let c = 0; c < COLS; c++) {
    if (solid[c]) { rows[20][c] = GT | (rnd(4) === 0 ? 0x80 : 0); rows[21][c] = GF | (rnd(5) === 0 ? 0x80 : 0); rows[22][c] = GF; }
  }
  const plat = (r, c, len) => { for (let i = 0; i < len; i++) rows[r][c + i] = i === 0 ? PL : i === len - 1 ? PR : PM; };
  for (const [r, c, l] of [[16, 24, 5], [16, 56, 4], [16, 88, 6], [13, 96, 4], [16, 120, 4], [16, 150, 7], [13, 158, 4], [16, 216, 6], [13, 222, 3]]) plat(r, c, l);
  for (let c = 8; c < 250; c += 9 + rnd(12)) {
    if (c > 182 && c < 216) continue;
    if (!solid[c] || !solid[c + 1] || rows[16][c] || rows[16][c + 1] || rows[13][c] || rows[13][c + 1]) continue;
    const ht = 3 + rnd(4);
    for (let i = 0; i < 2; i++) for (let r = 20 - ht; r < 20; r++) rows[r][c + i] = r === 20 - ht ? PT : (r === 20 - ht + 2 && i === 0 ? PLED | (rnd(2) ? 0x80 : 0) : PB);
  }
  // AND-gate puzzle: ONE's plate A (cols 190-191), a heatsink block with a low vent under it (196-205, vent row 19)
  // holding TASK's plate B (200-201), then the door (208-209, rows 13-19) with its LED above it
  for (const c of [190, 191]) rows[19][c] = 21;
  for (const c of [200, 201]) rows[19][c] = 22;
  for (let c = 196; c < 206; c++) for (let r = 16; r < 19; r++) rows[r][c] = 19;
  for (const c of [208, 209]) for (let r = 13; r < 20; r++) rows[r][c] = 20;
  rows[12][208] = 23;
}

// ---- sprites (8 pixels wide): 'b' goes to the first player, 'w' to the second
const mirror = (rs) => rs.map((r) => [...r].reverse().join(''));
const HERO = {
  idle: ['..bbbb..', '.bbbbbb.', '.bwbbwb.', '..bbbb..', '........', '.bbbbbb.', 'b.bwwb.b', 'b.bwwb.b', 'b.bbbb.b', '........', '..bbbb..', '..bbbb..', '..b..b..', '..b..b..', '........', '.bb..bb.'],
  run1: ['..bbbb..', '.bbbbbb.', '.bwbbwb.', '..bbbb..', '........', '.bbbbbb.', '..bwwb.b', 'b.bwwb.b', 'b.bbbb..', '........', '..bbbb..', '..bbbb..', '..b...b.', '.b.....b', '........', '.bb...bb'],
  run2: ['..bbbb..', '.bbbbbb.', '.bwbbwb.', '..bbbb..', '........', '.bbbbbb.', 'b.bwwb..', 'b.bwwb.b', '..bbbb.b', '........', '..bbbb..', '..bbbb..', '...bb...', '...bb...', '........', '..bbbb..'],
  jump: ['..bbbb..', '.bbbbbb.', '.bwbbwb.', '..bbbb..', '........', 'b.bbbb.b', 'b.bwwb.b', '..bwwb..', '..bbbb..', '........', '..bbbb..', '.b....b.', '.bb..bb.', '........', '........', '........'],
};
const DOG = {
  a: ['.w...b.b', 'ww..bbbb', '.bbbbwbb', 'bbbbbbbb', '.bbbbbb.', '.bbbbbb.', '.b.bb.b.', '.b.bb.b.'],
  b: ['.w...b.b', 'ww..bbbb', '.bbbbwbb', 'bbbbbbbb', '.bbbbbb.', '.bbbbbb.', 'b..bb..b', 'b..bb..b'],
};
const plane = (rs, ch) => rs.map((r) => [...r].reduce((v, c) => (v << 1) | (c === ch ? 1 : 0), 0));
const heroFrames = ['idle', 'run1', 'run2', 'jump'].map((k) => HERO[k]);
const heroAll = heroFrames.concat(heroFrames.map(mirror)), dogAll = [DOG.a, DOG.b, mirror(DOG.a), mirror(DOG.b)];
const flat = (fr, ch) => [].concat(...fr.map((f) => plane(f, ch)));

// ---- text for the status line (ANTIC mode 2 screen codes)
const hud = ' ONE+TASK FIRE=JUMP SELECT=SWAP NOW:';
const NAMEOFF = hud.length;
const hudBytes = [...hud.padEnd(40)].map((c) => { const a = c.charCodeAt(0); return a < 96 ? a - 32 : a; });

// ---- emit assembly
const out = [];
const bytes = (arr) => { for (let i = 0; i < arr.length; i += 24) out.push('        .byte ' + arr.slice(i, i + 24).join(',')); };
out.push('        org $3000', 'hp0');
bytes(flat(heroAll, 'b')); out.push('hp1'); bytes(flat(heroAll, 'w'));
out.push('dp2'); bytes(flat(dogAll, 'b')); out.push('dp3'); bytes(flat(dogAll, 'w'));
// palettes per band: mid, near, status line
out.push('cbk', '        .byte $02,$04,$00', 'cp0', '        .byte $C2,$52,$00', 'cp1', '        .byte $C6,$76,$0E', 'cp2', '        .byte $CC,$3A,$82', 'cp3', '        .byte $2E,$FA,$00');
out.push('        org $3800'); bytes([...charset]);
const dlb = [0x70, 0x70, 0x70];
for (let r = 0; r < ROWS; r++) dlb.push((r === 5 || r === 11 || r === 22) ? 0xD4 : 0x54, 0, 0x40 + 2 * r);
dlb.push(0x42, 0x80, 0x3E, 0x41, 0x00, 0x3E);
out.push('        org $3E00'); bytes(dlb);
out.push('        org $3E80'); bytes(hudBytes);
for (let r = 0; r < ROWS; r++) {
  const row = []; for (let c = 0; c < COLS + 44; c++) row.push(rows[r][c % COLS]);
  out.push('        org $' + (0x4000 + r * 0x200).toString(16).toUpperCase()); bytes(row);
}
const src = 'NAMEOFF = ' + NAMEOFF + '\n' + fs.readFileSync(path.join(__dirname, 'game.asm'), 'utf8') + '\n' + out.join('\n') + '\n        org $02E0\n        .word start\n';
const r = assemble(src);
const file = process.argv[2] || path.join(__dirname, '..', '..', 'out', 'circuit.xex');
fs.writeFileSync(file, Buffer.from(r.xex));
console.log('wrote', file, r.xex.length, 'bytes; code ends at $' + (Math.max(...r.segments.filter((s) => s.addr < 0x3000).map((s) => s.addr + s.bytes.length))).toString(16));
