// Tests web/js/bcomp.js: compiles BASIC, runs the XEX on the node 6502 with a CIO stub, and compares the output with
// the interpreter (web/js/basic.js) and with expected text.  Also checks that MADS assembles the generated source
// to the same bytes as asm6502.js.   node tools/tests/bcomp.test.cjs
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const Cpu = require('./cpu6502.cjs');
const { compile } = require('../../web/js/bcomp.js');
const { Basic } = require('../../web/js/basic.js');
const mads = path.join(__dirname, '..', '..', 'out', 'mads', 'mads.exe');
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : x); } else console.log('ok  ', m); };

function load(mem, x) {
  let p = 2;
  while (p < x.length) {
    if (x[p] === 255 && x[p + 1] === 255) p += 2;
    const s = x[p] | x[p + 1] << 8, e = x[p + 2] | x[p + 3] << 8; p += 4;
    for (let a = s; a <= e; a++) mem[a] = x[p++];
  }
  return mem[0x2E0] | mem[0x2E1] << 8;
}
function run(xex, inputs = [], files = {}) {
  const mem = new Uint8Array(65536);
  const start = load(mem, xex);
  mem[0x0A] = 0xF0; mem[0x0B] = 0xFF;
  const c = Cpu(mem); c.pc = start; c.sp = 0xFF;
  let out = '', steps = 0, seed = 12345; const gfx = [], opened = {}, rpos = {};
  while (c.pc !== 0xFFF0 && steps++ < 20000000) {
    if (c.pc === 0xE456) {
      const x = c.x, cmd = mem[0x342 + x];
      if (cmd === 11 && x === 0) {
        const ch = c.a; if (ch === 155) { out += '\n'; mem[0x55] = 0; } else { out += String.fromCharCode(ch); mem[0x55] = (mem[0x55] + 1) & 255; }
      } else if (cmd === 11 && opened[x] && opened[x] !== 'S:') files[opened[x]] = (files[opened[x]] || '') + String.fromCharCode(c.a);
      else if (cmd === 11) gfx.push(['plot', mem[0x55] | mem[0x56] << 8, mem[0x54], c.a]);
      else if (cmd === 7 && opened[x]) { const f = files[opened[x]] || '', i = rpos[x] || 0; rpos[x] = i + 1; c.a = i < f.length ? f.charCodeAt(i) : 0; }
      else if (cmd === 0x11) gfx.push(['draw', mem[0x55] | mem[0x56] << 8, mem[0x54], mem[0x2FB]]);
      else if (cmd === 3) {
        let a = mem[0x344 + x] | mem[0x345 + x] << 8, nm = ''; while (mem[a] !== 155 && nm.length < 40) nm += String.fromCharCode(mem[a++]);
        opened[x] = nm; rpos[x] = 0; if (nm === 'S:') gfx.push(['open', mem[0x34A + x], mem[0x34B + x]]);
      } else if (cmd === 12) delete opened[x];
      else if (cmd === 5) {
        let line;
        if (x === 0) line = (inputs.shift() || '') + '\x9b';
        else { const f = files[opened[x]] || '', i = rpos[x] || 0, e = f.indexOf('\n', i); const ln = e < 0 ? f.slice(i) : f.slice(i, e); rpos[x] = e < 0 ? f.length : e + 1; line = ln + '\x9b'; }
        const a = mem[0x344 + x] | mem[0x345 + x] << 8;
        for (let i = 0; i < line.length; i++) mem[a + i] = line.charCodeAt(i);
      }
      c.y = 1;
      const lo = mem[0x100 + ((c.sp + 1) & 255)], hi = mem[0x100 + ((c.sp + 2) & 255)];
      c.sp = (c.sp + 2) & 255; c.pc = ((hi << 8 | lo) + 1) & 0xFFFF;
      continue;
    }
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; mem[0xD20A] = (seed >> 16) & 255;
    c.step();
  }
  return { out, gfx, mem, files, done: c.pc === 0xFFF0 };
}
async function interp(src, inputs = []) {
  let out = ''; const b = new Basic({ print: (s) => { out += s; }, input: async () => inputs.shift() || '' });
  b.load(src); await b.run(); return out;
}
function build(src) {
  const r = compile(src);
  if (r.errors.length) { console.log('compile errors', JSON.stringify(r.errors)); return null; }
  return r;
}
async function same(name, src, inputs = []) {
  const r = build(src); if (!r) { ok(false, name); return; }
  const got = run(r.xex, inputs.slice());
  const want = await interp(src, inputs.slice());
  ok(got.done && got.out === want, `${name} (matches interpreter)`, JSON.stringify([got.out, want, got.done]));
}
function expectOut(name, src, want, inputs = [], files = {}) {
  const r = build(src); if (!r) { ok(false, name); return; }
  const got = run(r.xex, inputs.slice(), files);
  ok(got.done && got.out === want, name, JSON.stringify([got.out, want, got.done]));
}
function expectErr(name, src, re) {
  const r = compile(src);
  ok(r.errors.length && re.test(r.errors[0].msg) && r.xex === null, name, JSON.stringify(r.errors));
}

(async () => {
  await same('print/arith', '10 PRINT 1+2*3;" ";(1+2)*3;" ";INT(100/7);" ";-5+2;" ";7-10\n20 PRINT "DONE"');
  await same('vars/for', '10 S=0:FOR I=1 TO 5\n20 S=S+I*I\n30 NEXT I\n40 PRINT S');
  await same('step down', '10 FOR I=10 TO 1 STEP -3:PRINT I;" ";:NEXT I:PRINT');
  await same('nested for', '10 FOR I=1 TO 3:FOR J=1 TO 3:PRINT I*J;" ";:NEXT J:PRINT:NEXT I');
  await same('gosub', '10 GOSUB 100\n20 PRINT "B"\n30 END\n100 PRINT "A"\n110 RETURN');
  await same('if', '10 A=5\n20 IF A>3 THEN PRINT "BIG"\n30 IF A<3 THEN PRINT "SMALL"\n40 IF A=5 THEN 60\n50 PRINT "X"\n60 PRINT "END"');
  await same('if skips rest of line', '10 A=1\n20 IF A=2 THEN PRINT "NO":PRINT "NO2"\n30 PRINT "YES"');
  await same('on goto', '10 FOR I=1 TO 3\n20 ON I GOTO 100,200,300\n30 NEXT I\n40 END\n100 PRINT "A";:GOTO 30\n200 PRINT "B";:GOTO 30\n300 PRINT "C";:GOTO 30');
  await same('on gosub', '10 FOR I=1 TO 2:ON I GOSUB 100,200:NEXT I:END\n100 PRINT "ONE":RETURN\n200 PRINT "TWO":RETURN');
  await same('compare ops', '10 A=3:B=4\n20 PRINT (A<B);(A>B);(A=B);(A<>B);(A<=3);(A>=4)');
  await same('and or not', '10 A=1:B=0\n20 PRINT (A AND B);(A OR B);NOT A;NOT B');
  await same('negative numbers', '10 A=-12345:B=300\n20 PRINT A;" ";A*2;" ";ABS(A)');
  expectOut('negative division', '10 A=-12345:B=300\n20 PRINT A/B;" ";B/A', '-41 0\n');
  await same('arrays', '10 DIM A(10)\n20 FOR I=0 TO 10:A(I)=I*I:NEXT I\n30 S=0:FOR I=0 TO 10:S=S+A(I):NEXT I\n40 PRINT S;" ";A(7)');
  expectOut('input (two values on one line)', '10 INPUT A,B\n20 PRINT A+B;" ";A*B', '? 7 -60\n', ['12,-5']);
  await same('print comma', '10 PRINT 1,2,3');
  expectOut('peek/poke', '10 POKE 1536,123:POKE 1537,1:PRINT PEEK(1536);" ";DPEEK(1536)', '123 379\n');
  expectOut('stick/strig', '10 PRINT STICK(0);" ";STRIG(1)', '0 0\n');
  {
    const r = build('10 DIM H(15)\n20 FOR I=1 TO 1600:N=INT(RND(0)*16):H(N)=H(N)+1:NEXT I\n30 M=0:T=0:FOR I=0 TO 15:T=T+H(I):IF H(I)=0 THEN M=1\n40 NEXT I\n50 PRINT T;" ";M');
    const g = r && run(r.xex);
    ok(g && g.out === '1600 0\n', 'INT(RND(0)*N) stays in range and covers it', g && g.out);
  }
  {
    const r = build('10 GRAPHICS 7+16:COLOR 2:PLOT 10,20:DRAWTO 30,40:SETCOLOR 0,1,2:SOUND 1,100,10,8:POSITION 5,6');
    const g = r && run(r.xex);
    const j = g && JSON.stringify(g.gfx);
    ok(g && g.done && j === '[["open",28,7],["plot",10,20,2],["draw",30,40,2]]' && g.mem[0x2C4] === 0x12 && g.mem[0xD202] === 100 && g.mem[0xD203] === 0xA8 && g.mem[0x54] === 6 && g.mem[0x55] === 5,
      'graphics/sound statements', j + ' ' + (g && [g.mem[0x2C4], g.mem[0xD202], g.mem[0xD203]]));
  }
  expectErr('float rejected', '10 A=1.5', /floating/);
  expectErr('string not DIMed', '10 A$="X"', /not DIMed/);
  expectErr('missing line', '10 GOTO 99', /does not exist/);
  expectErr('NEXT without FOR', '10 NEXT I', /without FOR/);
  expectErr('FOR without NEXT', '10 FOR I=1 TO 3', /no NEXT/);
  expectErr('bare RND', '10 A=RND(0)', /RND/);
  expectOut('division truncates toward zero', '10 A=-7:PRINT A/2;" ";7/-2;" ";-7/-2', '-3 -3 3\n');
  expectErr('undeclared array', '10 A(1)=2', /DIM/);

  // ---- strings ----
  expectOut('string assign/len', '10 DIM A$(20),B$(20):A$="HELLO":B$=A$:PRINT B$;" ";LEN(B$)', 'HELLO 5\n');
  expectOut('substrings', '10 DIM A$(20):A$="HELLO":PRINT A$(2,4);" ";A$(3);" ";A$(1,1);" ";LEN(A$(2,3))', 'ELL LLO H 2\n');
  expectOut('append with A$(LEN+1)=', '10 DIM A$(10):A$="AB":A$(LEN(A$)+1)="CD":PRINT A$;" ";LEN(A$):A$(2)="X":PRINT A$;" ";LEN(A$)', 'ABCD 4\nAX 2\n');
  expectOut('chr$/asc', '10 DIM A$(5):A$=CHR$(72):PRINT A$;CHR$(73);" ";ASC("B");" ";ASC(A$)', 'HI 66 72\n');
  expectOut('val', '10 DIM A$(8):A$="123":PRINT VAL(A$)+1;" ";VAL("-45");" ";VAL("12AB")', '124 -45 12\n');
  expectOut('string compare', '10 DIM A$(9):A$="HELLO"\n20 IF A$="HELLO" THEN PRINT "EQ"\n30 IF A$<>"HELLO" THEN PRINT "NE"\n40 IF A$="HELL" THEN PRINT "SHORT"\n50 IF A$(1,2)="HE" AND LEN(A$)=5 THEN PRINT "OK"', 'EQ\nOK\n');
  expectOut('input string', '10 DIM A$(12):INPUT A$:PRINT "HI ";A$;" ";LEN(A$)', '? HI WORLD 5\n', ['WORLD']);
  expectOut('string overflow is error 9', '10 DIM A$(3):A$="HELLO":PRINT "NO"', 'ERROR 9\n');
  expectOut('bad substring is error 9', '10 DIM A$(5):A$="HI":PRINT A$(1,3)', 'ERROR 9\n');
  expectErr('A$(i,j)= rejected', '10 DIM A$(5):A$(1,2)="X"', /not supported/);
  // ---- DATA / READ / RESTORE ----
  expectOut('data/read/restore', '10 DATA 1,2,3,-4\n20 DATA HELLO,WORLD\n30 DIM N$(10):FOR I=1 TO 4:READ X:PRINT X;" ";:NEXT I:READ N$:PRINT N$;" ";:READ N$:PRINT N$\n40 RESTORE:READ X:PRINT X\n50 RESTORE 20:READ N$:PRINT N$\n60 DIM T(2):RESTORE 10:READ T(1),T(2):PRINT T(1)+T(2)',
    '1 2 3 -4 HELLO WORLD\n1\nHELLO\n3\n');
  expectOut('read past end is error 6', '10 DATA 1\n20 READ A,B:PRINT "NO"', 'ERROR 6\n');
  // ---- bounds, STEP ----
  expectOut('array subscript too big is error 9', '10 DIM A(3):A(3)=7:PRINT A(3):A(4)=1:PRINT "NO"', '7\nERROR 9\n');
  expectOut('negative subscript is error 9', '10 DIM A(3):I=-1:PRINT A(I)', 'ERROR 9\n');
  await same('variable step up', '10 S=2:FOR I=0 TO 10 STEP S:PRINT I;" ";:NEXT I:PRINT');
  await same('variable step down', '10 S=-3:FOR I=10 TO 1 STEP S:PRINT I;" ";:NEXT I:PRINT');
  await same('expression step', '10 A=1:FOR I=1 TO 9 STEP A+A:PRINT I;" ";:NEXT I:PRINT');
  // ---- channels ----
  {
    const r = build('10 OPEN #2,8,0,"D:OUT.TXT":PRINT #2;"HI";1+2:PUT #2,65:CLOSE #2:PRINT "OK"');
    const g = r && run(r.xex);
    ok(g && g.done && g.out === 'OK\n' && g.files['D:OUT.TXT'] === 'HI3\x9bA', 'OPEN/PRINT #/PUT/CLOSE', g && JSON.stringify([g.out, g.files]));
  }
  {
    const r = build('10 DIM S$(10):OPEN #2,4,0,"D:IN.TXT":INPUT #2,A,B:INPUT #2,S$:GET #2,C:CLOSE #2:PRINT A+B;" ";S$;" ";C');
    const g = r && run(r.xex, [], { 'D:IN.TXT': '12,34\nHEL\nZ' });
    ok(g && g.done && g.out === '46 HEL 90\n', 'OPEN/INPUT #/GET', g && JSON.stringify([g.out, g.done]));
  }
  // MADS must produce the same bytes as asm6502.js for a program that uses most of the runtime
  const sample = '10 DIM A(5):GRAPHICS 3:COLOR 1:PLOT 1,1:DRAWTO 5,5:SOUND 0,50,10,5\n20 INPUT B:FOR I=0 TO 5:A(I)=I*B/3:PRINT A(I),:NEXT I\n30 ON B GOSUB 100:IF B>2 AND B<9 THEN PRINT INT(RND(0)*5):END\n100 RETURN';
  const r = build(sample + '\n200 DIM S$(9),T(3):S$="AB":S$(3)=CHR$(67):IF S$="ABC" THEN PRINT LEN(S$);VAL(S$)\n210 DATA 5,X\n220 READ T(1):READ S$:OPEN #2,8,0,"D:X":PRINT #2;S$:CLOSE #2:S=3:FOR I=1 TO 9 STEP S:NEXT I:T(1)=1:POKE 1536,ASC(S$)');
  if (r && fs.existsSync(mads)) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
    fs.writeFileSync(path.join(d, 'a.asm'), r.asm); 
    try {
      cp.execFileSync(mads, ['a.asm', '-o:a.xex'], { cwd: d, stdio: 'pipe' });
      const m = fs.readFileSync(path.join(d, 'a.xex'));
      const img = (b) => { const o = new Map(); let p = 2; while (p < b.length) { if (b[p] === 255 && b[p + 1] === 255) { p += 2; continue; } const s = b.readUInt16LE(p), e = b.readUInt16LE(p + 2); for (let a = s; a <= e; a++) o.set(a, b[p + 4 + a - s]); p += 4 + e - s + 1; } return o; };
      const A = img(m), Bm = img(Buffer.from(r.xex));
      let diff = 0; for (const [a, v] of Bm) if (v !== 0 && A.get(a) !== v) diff++; for (const [a, v] of A) if (v !== 0 && Bm.get(a) !== v) diff++;
      ok(diff === 0, 'MADS and asm6502.js produce the same memory image', `${diff} differing bytes`);
    } catch (e) { ok(false, 'MADS assembles the generated source', String(e.stdout || e.message).slice(0, 400)); }
  } else console.log('skip MADS cross-check');
  console.log(bad ? 'FAILED ' + bad : 'BCOMP PASS');
  process.exit(bad ? 1 : 0);
})();
