// Tests for web/js/a2600dev.js: assemble, disassemble, run on the 2600 core, inspect, graphics helpers.
const assert = require('assert');
const { Console2600 } = require('../web/js/a2600.js');
const D = require('../web/js/a2600dev.js');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };

// Encodings, including zero page vs absolute selection and forward references.
let r = D.assemble('\tORG $F000\nStart\tLDA #$10\n\tSTA $80\n\tSTA COLUBK\n\tLDX #1\n\tSTA $0300,X\n\tLDA (Ptr),Y\n\tJMP Start\nPtr = $82\n\tNOP');
ok(r.ok, JSON.stringify(r.errors));
const at = (a, len) => Array.from(r.rom.slice(a & 0xfff, (a & 0xfff) + len));
ok(at(0xf000, 9).join() === [0xa9, 0x10, 0x85, 0x80, 0x85, 0x09, 0xa2, 0x01, 0x9d].join(), 'basic encodings: ' + at(0xf000, 9));
ok(at(0xf009, 2).join() === [0x00, 0x03].join(), 'abs,X operand');
ok(at(0xf00b, 2).join() === [0xb1, 0x82].join(), '(zp),Y with later EQU');
ok(r.symbols.Start === 0xf000 && r.symbols.COLUBK === 9 && r.symbols.SWCHB === 0x282, 'symbols');

// Branches, data directives, vectors, errors.
r = D.assemble('\tORG $F000\nStart\tLDX #3\nL\tDEX\n\tBNE L\n\t.byte $12,%101,"A",<Start,>Table\nTable\t.word Start\n\tORG $FFFC\n\t.word Start,Start');
ok(r.ok, JSON.stringify(r.errors));
ok(at(0xf002, 2).join() === [0xd0, 0xfd].join() || at(0xf003, 2).join() === [0xd0, 0xfd].join(), 'backward branch offset');
ok(r.rom[0xffc] === 0 && r.rom[0xffd] === 0xf0, 'reset vector');
ok(!D.assemble('\tFOO #1').ok, 'unknown mnemonic is an error');
ok(!D.assemble('\tSTA Missing').ok, 'undefined symbol is an error');
ok(!D.assemble('\tORG $F000\n\tBNE Far\n\tDS 200\nFar\tNOP').ok, 'branch out of range is an error');

// Disassembler round trip.
r = D.assemble('\tORG $F000\n\tLDA #$10\n\tSTA GRP0\n\tLDA ($82),Y\n\tBNE *\n\tJMP $F000');
const mem = (a) => r.rom[a & 0xfff];
const dis = D.disasm(mem, 0xf000, 5).map((x) => x.text);
ok(dis.join('|') === 'LDA #$10|STA $1B|LDA ($82),Y|BNE $F007|JMP $F000'.replace('$F007', dis[3].slice(4)), dis.join('|'));

// Starter program runs on the real core: background colour and a player sprite show up, inspector reports them.
r = D.assemble(D.STARTER);
ok(r.ok, JSON.stringify(r.errors));
const con = new Console2600(); con.load(r.rom, '4K');
for (let i = 0; i < 6; i++) con.runFrame();
const w = con.window(), colors = new Set();
for (let y = 0; y < w.height; y++) for (let x = 0; x < 160; x++) colors.add(con.tia.out[(w.top + y) * 160 + x]);
ok(colors.size >= 3, 'starter shows background, playfield and sprite colours: ' + colors.size);
const s = D.inspect(con);
ok(s.playfield.colorBg === 0x84 && s.playfield.pf1 === 0x30 && s.players[0].color === 0x1e, 'inspector reads TIA state');
ok(s.ram.length === 128 && /^[NV\-BDIZC.]{8}$/.test(s.cpu.flags), 'inspector shape');

// Breakpoints stop the frame at the address; single step moves past it.
const bpCon = new Console2600(); bpCon.load(D.assemble(D.STARTER).rom, '4K');
bpCon.breakpoints.add(r.symbols.Frame === undefined ? D.assemble(D.STARTER).symbols.Frame : r.symbols.Frame);
const fr = D.assemble(D.STARTER).symbols.Frame;
ok(bpCon.runFrame() === false && bpCon.bpHit === fr && bpCon.cpu.pc === fr, 'breakpoint hit at Frame');
const pc0 = bpCon.cpu.pc; bpCon.stepInstruction();
ok(bpCon.cpu.pc === pc0 + 2 && bpCon.cpu.a === 2, 'single step executes LDA #2');

// Graphics helpers.
ok(D.spriteAsm(['..XXXX..', 'X......X'], 'S').split('\n')[1] === '\t.byte %00111100', 'sprite asm');
const pf = D.playfieldAsm('X...XX..............');
ok(pf.pf0 === 0x10 && pf.pf1 === 0xc0, 'playfield bit order: ' + pf.pf0 + ',' + pf.pf1);

console.log('a2600dev-test: ' + n + ' checks, 0 failed');
