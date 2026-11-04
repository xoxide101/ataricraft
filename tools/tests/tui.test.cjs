// Checks tools/tui/tui.inc through tools/tui/tuidemo.com on the node 6502: node tools/tests/tui.test.cjs
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const Cpu = require('./cpu6502.cjs');
const dir = path.join(__dirname, '..', 'tui');
execFileSync(path.join(__dirname, '..', '..', 'out', 'mads', 'mads.exe'), ['tuidemo.asm', '-o:tuidemo.com', '-t:tuidemo.lab'], { cwd: dir, stdio: 'pipe' });
const lab = {}; for (const l of fs.readFileSync(path.join(dir, 'tuidemo.lab'), 'latin1').split(/\r?\n/)) { const m = l.match(/^\w\w\t([0-9A-Fa-f]{4})\t(\w+)/); if (m) lab[m[2]] = parseInt(m[1], 16); }
const mem = new Uint8Array(65536);
const x = fs.readFileSync(path.join(dir, 'tuidemo.com'));
let p = 2;
while (p < x.length) { if (x[p] === 255 && x[p + 1] === 255) p += 2; const s = x[p] | x[p + 1] << 8, e = x[p + 2] | x[p + 3] << 8; p += 4; for (let a = s; a <= e; a++) mem[a] = x[p++]; }
const run = mem[0x2E0] | mem[0x2E1] << 8;
mem[0x58] = 0; mem[0x59] = 0x40;
mem.set([0xAD, 0x00, 0xF1, 0xA2, 0xFF, 0x8E, 0xFC, 0x02, 0x60], 0xF000);
mem[0xE424] = 0xFF; mem[0xE425] = 0xEF;
mem[0x0A] = 0xF0; mem[0x0B] = 0xFF; mem[0x2FC] = 0xFF; mem[0x285] = 1; mem[0x279] = 0xF;
const c = Cpu(mem); c.pc = run; c.sp = 0xFF;
let bad = 0, n = 0;
const ok = (v, m) => { if (!v) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const go = (steps) => { for (let i = 0; i < steps && c.pc !== 0xFFF0; i++) { c.step(); if (++n % 100 === 0) mem[0x14] = (mem[0x14] + 1) & 255; } };
const scr = (col, row) => mem[0x4000 + row * 40 + col];
const key = (k) => { mem[0xF100] = k; mem[0x2FC] = 0x3F; go(30000); };
go(30000);
ok(scr(1, 0) === (0x26 | 0x80) && scr(7, 0) === (0x28 | 0x80), 'menu bar drawn inverse (File, Help)');
ok(scr(6, 4) === 17 && scr(33, 4) === 5 && scr(6, 13) === 26 && scr(33, 13) === 3 && scr(7, 4) === 18, 'window frame drawn');
ok(scr(8, 6) === 0x21 && scr(9, 6) === 0x34, 'text drawn as screen codes');
const mx0 = mem[lab.MX], q = [0, 2, 3, 1];
mem[0x279] = q[0]; go(300);
for (let i = 1; i <= 6; i++) { mem[0x279] = q[i & 3]; go(300); }
ok(mem[lab.MX] === mx0 + 2, 'ST mouse: 6 steps right = 2 cells (MX ' + mx0 + ' -> ' + mem[lab.MX] + ')');
for (let i = 5; i >= 0; i--) { mem[0x279] = q[i & 3]; go(300); }
ok(mem[lab.MX] === mx0, 'ST mouse: 6 steps left returns');
key(0x1B); go(30000);
ok(scr(1, 1) === 17 && scr(1, 6) === 26, 'Esc opens File pop-up menu');
key(0x1D); key(0x1D); key(0x9B); go(30000);
ok(mem[0x600] === 2, 'Down, Down, Return chose item 2 (About)');
ok(scr(14, 9) === 17 || scr(8, 9) === 17 || [...Array(40).keys()].some((i) => scr(i, 9) === 17), 'About message box shown');
key(0x9B);
mem[lab.MX] = 8; mem[lab.MY] = 0; mem[0x285] = 0; go(30000); mem[0x285] = 1; go(30000);
ok([...Array(40).keys()].some((i) => scr(i, 9) === 17), 'clicking Help on the bar opens its box');
mem[0x285] = 0; mem[lab.MX] = 17; mem[lab.MY] = 12; go(30000); mem[0x285] = 1; go(30000);
ok(![...Array(40).keys()].some((i) => scr(i, 9) === 17), 'clicking [ OK ] closes the box');
key(0x71);
ok(c.pc === 0xFFF0, 'q exits through DOSVEC');
console.log(bad ? 'FAILED ' + bad : 'TUI PASS');
process.exit(bad ? 1 : 0);
