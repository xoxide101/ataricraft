// Circuit Runner demo: generates the art and level data, appends it to game.asm and assembles an .XEX.
// Usage: node games/circuit/build.cjs [out.xex]
const fs = require('fs'), path = require('path');
const { assemble } = require('../../web/js/asm6502.js');
const CM = require('../../web/js/circuitmap.js');

// ---- tiles: 4 pixels wide x 8 tall, '.'=background a=COLPF0 b=COLPF1 c=COLPF2 (or COLPF3 when the map byte has bit 7)
const ASSETS_PATH = path.join(__dirname, 'assets.json');
const ASSETS = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8')), SHEETS = ASSETS.sheets;
const G = {};
for (const [k, rows] of Object.entries(SHEETS.tiles.frames)) {
  const id = parseInt(k, 10);
  if (!(id > 0 && id < 128)) throw new Error('tile name must start with an id from 1 to 127: ' + k);
  if (rows.length !== 8 || rows.some((r) => r.length !== 4 || /[^.abc]/.test(r))) throw new Error('bad tile ' + k);
  if (G[id]) throw new Error('duplicate tile id ' + id);
  G[id] = rows;
}
const GT = 11, GF = 12, PL = 13, PM = 14, PR = 15, PT = 16, PB = 17, PLED = 18; // ground top, fill, platform L/M/R, pillar top/body/led

const charset = new Uint8Array(1024);
for (const [id, rows] of Object.entries(G)) rows.forEach((r, y) => {
  let b = 0; for (const ch of r) b = (b << 2) | ('.abc'.indexOf(ch));
  charset[id * 8 + y] = b;
});

// ---- generated starter map: 23 rows x 256 columns (assets.json holds the real 25 x 512 map; older maps are upgraded). Each row is emitted with the first 44 columns repeated so the 44-byte fetch never runs off the row
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return (seed >> 8) % n; };
const COLS = 256, ROWS = 23, rows = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

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

// ---- the map in assets.json (hex, two digits per column; bit 7 = COLPF3 variant) replaces the generated one
const toHex = (r) => r.map((v) => v.toString(16).padStart(2, '0')).join('');
if (process.argv.includes('--dump-map')) {
  ASSETS.map = CM.upgrade({ cols: COLS, rows: rows.map(toHex) });
  fs.writeFileSync(ASSETS_PATH, JSON.stringify(ASSETS, null, 1)); console.log('map written to assets.json'); process.exit(0);
}
const srcMap = ASSETS.map || { cols: COLS, rows: rows.map(toHex) };
if (CM.check(srcMap)) throw new Error(CM.check(srcMap));
const MAP = CM.toRows(CM.upgrade(srcMap)), NC = CM.COLS, BANDS = CM.ensureSky(SHEETS.tiles.bands);
const NB = (r, c) => 0x5800 + (r - 12) * 0x240 + c;
// puzzle positions come from the map: plates 21 and 22 (two tiles wide), door 20 (one column, rows top to bottom), LED 23
const find = (id) => { const o = []; for (let r = 12; r < ROWS; r++) for (let c = 0; c < NC; c++) if ((MAP[r][c] & 127) === id) o.push([r, c]); return o; };
const at = (r, c) => '$' + NB(r, c).toString(16).toUpperCase();
const pA = find(21), pB = find(22), door = find(20), led = find(23);
const lowest = (l) => l.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
if (!pA.length || !pB.length || !door.length) console.warn('warning: map needs tile 21 (plate A), 22 (plate B) and 20 (door) for the AND gate; using dummies');
const dum = '', pa = lowest(pA)[0], pb = lowest(pB)[0], dc = lowest(door)[0];
const PUZ = [
  'PA0 = ' + (pa ? at(pa[0], pa[1]) : dum), 'PA1 = ' + (pa && pA.length > 1 ? at(pa[0], pa[1] + 1) : dum),
  'PB0 = ' + (pb ? at(pb[0], pb[1]) : dum), 'PB1 = ' + (pb && pB.length > 1 ? at(pb[0], pb[1] + 1) : dum),
  'LEDADR = ' + (led.length ? at(led[0][0], led[0][1]) : dum),
  'DOORCL = ' + (dc ? dc[1] & 255 : 255), 'DOORCH = ' + (dc ? dc[1] >> 8 : 0), 'DOORR0 = ' + (dc ? Math.min(...door.map((d) => d[0])) : 22), 'DOORR1 = ' + (dc ? Math.max(...door.map((d) => d[0])) + 1 : 23),
].join('\n') + '\n';

// ---- sprites (8 pixels wide): 'b' goes to the first player, 'w' to the second
const mirror = (rs) => rs.map((r) => [...r].reverse().join(''));
const HERO = SHEETS.hero.frames, DOG = SHEETS.dog.frames;
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
const hx = (v) => '$' + (parseInt(String(v).replace('$', ''), 16) & 255).toString(16).toUpperCase().padStart(2, '0');
const bd = BANDS;
out.push('cbk', '        .byte ' + [bd.far.bk, bd.mid.bk, bd.near.bk, '$00'].map(hx));
for (let i = 0; i < 4; i++) out.push('cp' + i, '        .byte ' + [bd.far.pf[i], bd.mid.pf[i], bd.near.pf[i], '$00'].map(hx));
out.push('skypal', '        .byte ' + [bd.sky.pf[0], bd.sky.pf[1], bd.sky.pf[2], bd.sky.pf[3], bd.sky.bk].map(hx));
out.push('plpal', '        .byte ' + [SHEETS.hero.players[0], SHEETS.hero.players[1], SHEETS.dog.players[0], SHEETS.dog.players[1]].map(hx));
out.push('        org $3800'); bytes([...charset]);
// display list: one blank line, two sky rows (the DLI on the second hands over to the far band), 23 map rows, status line
const SKYA = 0x7100, SKYB = 0x7200;
const dlb = [0x70, 0x54, SKYA & 255, SKYA >> 8, 0xD4, SKYB & 255, SKYB >> 8];
for (let r = 0; r < ROWS; r++) {
  const a = r < 12 ? 0x4000 + r * 0x200 : NB(r, 0);
  dlb.push((r === 5 || r === 11 || r === 22) ? 0xD4 : 0x54, a & 255, a >> 8);
}
dlb.push(0x42, 0x80, 0x3E, 0x41, 0x00, 0x3E);
out.push('        org $3E00'); bytes(dlb);
out.push('        org $3E80'); bytes(hudBytes);
const emitRow = (addr, r, n) => {
  const row = []; for (let c = 0; c < n; c++) row.push(MAP[r][c % NC]);
  out.push('        org $' + addr.toString(16).toUpperCase()); bytes(row);
};
for (let r = 0; r < 12; r++) emitRow(0x4000 + r * 0x200, r, 300);
for (let r = 12; r < 23; r++) emitRow(NB(r, 0), r, NC + 44);
emitRow(SKYA, 23, 128); emitRow(SKYB, 24, 128);
const nbs = []; for (let r = 12; r < 23; r++) nbs.push(NB(r, 0));
out.push('        org $2D00', 'nbl', '        .byte ' + nbs.map((a) => a & 255).join(','), 'nbh', '        .byte ' + nbs.map((a) => a >> 8).join(','));
// optional music: games/circuit/music.json (a Tracker song) is compiled to raw POKEY frames played from the VBI
const MUSIC_PATH = path.join(__dirname, 'music.json');
if (fs.existsSync(MUSIC_PATH)) {
  const T = require('../../web/js/trackcore.js');
  const song = T.sanitize(JSON.parse(fs.readFileSync(MUSIC_PATH, 'utf8')));
  const c = T.compile(song), N = song.stereo ? 18 : 9, MAXF = Math.floor((0xC000 - 0x8800) / N);
  if (c.frames.length > MAXF) throw new Error('music too long: ' + c.frames.length + ' frames, max ' + MAXF);
  const end = 0x8800 + c.frames.length * N;
  out.push('        org $2C00', 'music   lda #3', '        sta $D20F');
  if (song.stereo) out.push('        sta $D21F');
  out.push('        ldy #0', 'mp1     lda (mptr),y', '        sta $D200,y', '        iny', '        cpy #9', '        bne mp1');
  if (song.stereo) out.push('mp2     lda (mptr),y', '        sta $D207,y', '        iny', '        cpy #18', '        bne mp2');
  out.push('        clc', '        lda mptr', '        adc #' + N, '        sta mptr', '        bcc mp3', '        inc mptr+1',
    'mp3     lda mptr+1', '        cmp #>' + end, '        bcc mp4', '        bne mp5', '        lda mptr', '        cmp #<' + end, '        bcc mp4',
    'mp5     lda #0', '        sta mptr', '        lda #$88', '        sta mptr+1', 'mp4     rts');
  out.push('        org $8800');
  const bs = []; for (const f of c.frames) { for (let i = 0; i < 9; i++) bs.push(f[i]); if (song.stereo) for (let i = 9; i < 18; i++) bs.push(f[i]); }
  bytes(bs);
  out.unshift('mptr = $B2');
  out.push('        org mptr', '        .word $8800');
  console.log('music:', c.frames.length, 'frames,', c.seconds.toFixed(1) + 's', song.stereo ? 'stereo' : 'mono');
} else out.push('music   rts');const src = 'NAMEOFF = ' + NAMEOFF + '\n' + PUZ + fs.readFileSync(path.join(__dirname, 'game.asm'), 'utf8') + '\n' + out.join('\n') + '\n        org $02E0\n        .word start\n';
const r = assemble(src);
const file = process.argv[2] || path.join(__dirname, '..', '..', 'out', 'circuit.xex');
fs.writeFileSync(file, Buffer.from(r.xex));
console.log('wrote', file, r.xex.length, 'bytes; code ends at $' + (Math.max(...r.segments.filter((s) => s.addr < 0x3000).map((s) => s.addr + s.bytes.length))).toString(16));
