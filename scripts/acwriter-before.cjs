// Baseline probe: boot the ATR, N = New, type, move; print geometry and save screenshots; count frame differences while idle.
const L = require('./acwriter-cursor-lib.cjs'), path = require('path'), fs = require('fs');
const OUT = path.join(L.ROOT, 'out', 'shots', 'cursor'); fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || 'before';
(async () => {
  const t = await L.boot();
  await t.shot(path.join(OUT, tag + '-0-boot.png'));
  await t.key('n', 1500);
  await t.type('Hello world', 100);
  await t.key('ArrowLeft'); await t.key('ArrowLeft');
  await t.p.waitForTimeout(800);
  await t.shot(path.join(OUT, tag + '-1-typed.png'));
  const f = [];
  for (let i = 0; i < 24; i++) { f.push(await t.grab()); await t.p.waitForTimeout(60); }
  let changed = 0, bb = null;
  for (let i = 1; i < f.length; i++) { const d = L.bbox(f[i - 1], f[i]); if (d.n) { changed++; bb = d; } }
  console.log('canvas', f[0].w, 'x', f[0].h, 'idle frames that differ:', changed, '/', f.length - 1, bb || '');
  console.log('errors', t.errs);
  await t.b.close();
})();
