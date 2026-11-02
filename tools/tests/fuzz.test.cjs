// Fuzzes the parsers and converters with mutated real files and random input.
// A "bad" result is a hang (timeout), or an exception that is not a plain Error with a readable message (TypeError, RangeError, undefined).
// Usage: node fuzz.test.cjs [iterations]   (spawns one child per target so hangs can be killed)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const N = process.argv[2] === '--child' ? 0 : +process.argv[2] || 300;
const root = path.join(__dirname, '..', '..');

function child(target, n) {
  global.window = global; global.AC = {};
  const P = require(root + '/web/js/pmd.js'), R = require(root + '/web/js/rmtplay.js'), S = require(root + '/web/js/rmtsap.js'), X = require(root + '/web/js/sapxex.js'), A = require(root + '/web/js/asm6502.js');
  let seed = 7; const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return (seed >> 8) % k; };
  const small = (p) => { try { return fs.statSync(p).size < 200000; } catch (e) { return false; } };
  const find = (dir, ext, max) => { const o = []; const walk = (d) => { if (o.length >= max) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase().endsWith(ext) && o.length < max && small(p)) o.push(p); } }; walk(dir); return o; };
  const seeds = (ext) => find(path.join(root, 'software_n_roms'), ext, 12).map((f) => new Uint8Array(fs.readFileSync(f)));
  const mutate = (b) => {
    const a = Uint8Array.from(b), k = rnd(6);
    if (k === 0) return a.slice(0, rnd(a.length + 1));
    if (k === 1) { for (let i = 0; i < 1 + rnd(8); i++) a[rnd(a.length)] = rnd(256); return a; }
    if (k === 2) { for (let i = 0; i < 4; i++) a[rnd(a.length)] = [0, 255, 128, 127][rnd(4)]; return a; }
    if (k === 3) { const o = new Uint8Array(a.length + 16); o.set(a); return o; }
    if (k === 4) { const p = rnd(a.length), q = rnd(a.length); const t = a[p]; a[p] = a[q]; a[q] = t; return a; }
    return Uint8Array.from({ length: rnd(300) }, () => rnd(256));
  };
  const bad = [];
  const attempt = (label, f) => {
    try { f(); } catch (e) {
      const ok = e instanceof Error && !(e instanceof TypeError) && !(e instanceof RangeError) && !(e instanceof ReferenceError) && typeof e.message === 'string' && e.message.length > 2 && !/undefined(?! symbol)|NaN|is not a function|is not defined|is not iterable|Cannot read|Invalid typed array|Invalid array length/.test(e.message);
      if (!ok && bad.length < 6) bad.push(label + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)));
    }
  };
  let pool;
  if (target === 'midi') pool = seeds('.mid');
  else if (target === 'sap' || target === 'sapxex') pool = seeds('.sap');
  else if (target === 'rmt') {
    pool = []; const m = find(path.join(root, 'software_n_roms'), '.sap', 40);
    for (const f of m) { try { const s = P.parseSap(new Uint8Array(fs.readFileSync(f))); const mem = new Uint8Array(65536); for (const b of s.blocks) mem.set(b.data, b.start); for (let a = 0; a < 65500; a++) if (mem[a] === 82 && mem[a + 1] === 77 && mem[a + 2] === 84 && mem[a + 3] === 52 && mem[a + 7] === 1) { const bl = s.blocks.find((b) => a >= b.start && a <= b.end); const o = [255, 255, a & 255, a >> 8, bl.end & 255, bl.end >> 8]; for (let i = a; i <= bl.end; i++) o.push(mem[i]); pool.push(new Uint8Array(o)); break; } } catch (e) { /* skip */ } }
  } else pool = [];
  for (let i = 0; i < n; i++) {
    if (target === 'asm') {
      const toks = ['lda', 'sta', '#$', '(', ')', ',x', ',y', 'org', '.byte', '.word', 'label', ' = ', '*', '+', '-', '<', '>', '"', "'", ';', '\n', ' ', '$FFFF', '0', '65536', 'jmp', 'bne', '.fill', '.ds', 'icl', 'x', 'y', 'a'];
      let s = ''; for (let k = 0; k < 5 + rnd(40); k++) s += toks[rnd(toks.length)];
      attempt('asm ' + JSON.stringify(s), () => A.assemble(s));
    } else if (pool.length) {
      const b = mutate(pool[rnd(pool.length)]);
      if (target === 'midi') attempt('midi', () => { for (const o of [{}, { smart: true, decay: true }]) P.convert(b, o); });
      else if (target === 'sap') attempt('sap', () => { const s = P.parseSap(b); P.buildSap(s.fields, s.binary); });
      else if (target === 'sapxex') attempt('sapxex', () => X.build(P.parseSap(b), {}));
      else if (target === 'rmt') attempt('rmt', () => S.build(b, { maxFrames: 400 }));
    }
  }
  process.stdout.write(JSON.stringify({ target, bad }));
}

if (process.argv[2] === '--child') { child(process.argv[3], +process.argv[4]); process.exit(0); }
let fail = 0;
for (const t of ['midi', 'sap', 'sapxex', 'rmt', 'asm']) {
  const r = cp.spawnSync(process.execPath, [__filename, '--child', t, String(N)], { timeout: 120000, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error || r.status === null) { console.log(t, 'HANG or KILLED', r.error && r.error.code); fail++; continue; }
  if (r.status !== 0) { console.log(t, 'CRASH', (r.stderr || '').split('\n').slice(0, 4).join(' | ')); fail++; continue; }
  const j = JSON.parse(r.stdout); console.log(t, j.bad.length ? j.bad.length + ' bad' : 'ok'); for (const b of j.bad) console.log('   ', b); if (j.bad.length) fail++;
}
process.exit(fail ? 1 : 0);
