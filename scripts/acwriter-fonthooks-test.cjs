// Checks the ACWriter font build hooks (tools/acwfaces.cjs override): without overrides the generated .inc files are
// unchanged, with a test override for craft5 / zfont the build output changes and the ACWriter XEX differs.
// Usage: node scripts/acwriter-fonthooks-test.cjs
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), AW = path.join(ROOT, 'tools/acwriter');
const CF = require('../tools/craftfont.cjs'), ACW = require('../tools/acwfaces.cjs');
const OVR = path.join(ROOT, 'font/overrides');
const norm = (f) => crypto.createHash('sha1').update(fs.readFileSync(f, 'latin1').replace(/\r\n/g, '\n')).digest('hex');
const INCS = ['craft4.inc', 'craft5.inc', 'craft6.inc', 'zfont.inc', 'craftpg.inc'].map((n) => path.join(AW, n));
const GEN = [path.join(ROOT, 'web/js/fontedit/builtin-fonts.js'), ...INCS];
const saved = new Map(GEN.map((f) => [f, fs.readFileSync(f)]));
const node = (s) => cp.execFileSync('node', [path.join(AW, s)], { cwd: ROOT, stdio: 'pipe' });
const build = () => { node('mkcraftfonts.cjs'); node('mkzoomfont.cjs'); node('mkpgfont.cjs'); };
const mads = () => { cp.execFileSync(path.join(ROOT, 'out/mads/mads.exe'), ['poc5.asm', '-o:poc5.xex', '-l:poc5.lst'], { cwd: AW, stdio: 'pipe' }); return crypto.createHash('sha1').update(fs.readFileSync(path.join(AW, 'poc5.xex'))).digest('hex'); };
let fails = 0; const check = (n, ok) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', n); };
const restore = () => { for (const [f, b] of saved) fs.writeFileSync(f, b); for (const id of ['craft5', 'zfont']) fs.rmSync(path.join(OVR, id + '.acf'), { force: true }); };
const poc = path.join(AW, 'poc5.xex'), lst = path.join(AW, 'poc5.lst');
const xexBak = fs.existsSync(poc) ? fs.readFileSync(poc) : null, lstBak = fs.readFileSync(lst);
try {
  for (const id of ['craft5', 'zfont']) if (fs.existsSync(path.join(OVR, id + '.acf'))) throw new Error('remove font/overrides/' + id + '.acf first');
  const ref = INCS.map(norm);
  build();
  check('no overrides: generated .inc files unchanged', INCS.every((f, i) => norm(f) === ref[i]));
  const x0 = mads();
  // test override: light up a pixel in 'A' of craft5 and of zfont
  fs.mkdirSync(OVR, { recursive: true });
  for (const id of ['craft5', 'zfont']) {
    const f = ACW.baseFace(id); const g = CF.glyph(f, 65);
    g[f.head] = g[f.head] ^ (id === 'zfont' ? 0xFF : 0x01);
    fs.writeFileSync(path.join(OVR, id + '.acf'), CF.serialize(f));
  }
  build();
  check('craft5 override changes craft5.inc', norm(INCS[1]) !== ref[1]);
  check('zfont override changes zfont.inc', norm(INCS[3]) !== ref[3]);
  check('craft4/craft6/pg untouched by those overrides', norm(INCS[0]) === ref[0] && norm(INCS[2]) === ref[2] && norm(INCS[4]) === ref[4]);
  check('ACWriter build changes', mads() !== x0);
} catch (e) { fails++; console.log('FAIL', e.message); }
restore();
if (xexBak) fs.writeFileSync(poc, xexBak); fs.writeFileSync(lst, lstBak);
process.exit(fails ? 1 : 0);
