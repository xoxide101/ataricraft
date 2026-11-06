// Runs every ACWriter / xCWriter / craftfonts regression script and prints one pass/fail line each.
const { spawnSync } = require('child_process');
const fs = require('fs');
const dir = __dirname;
const skip = /glyphshot|xcw-diff|fontsheet|dbg|segments2/;
const names = fs.readdirSync(dir).filter((n) => /^(acwriter-.*|test-craftfonts?|test-xcw.*|xcwriter-.*-?test|xcwriter-test)\.cjs$/.test(n) && !skip.test(n));
let bad = 0;
for (const n of names) {
  const t0 = Date.now();
  const r = spawnSync('node', [require('path').join(dir, n)], { encoding: 'utf8', timeout: 900000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.split('\n').filter((l) => /^FAIL|FAIL /.test(l));
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + n + ' ' + Math.round((Date.now() - t0) / 1000) + 's' + (ok ? '' : ' :: ' + fails.slice(0, 3).join(' | ') + (r.error ? ' ' + r.error.message : '')));
}
console.log(bad ? bad + ' failing' : 'all pass');
