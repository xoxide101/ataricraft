// Audit runner: node scripts/audit-run.cjs  -> out/audit.txt (one line per script: name, exit code, seconds)
const { spawnSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const LIST = fs.readFileSync(ROOT + '/out/audit-list.txt', 'utf8').split(/\r?\n/).filter(Boolean);
fs.writeFileSync(ROOT + '/out/audit.txt', '');
for (const s of LIST) {
  const t = Date.now();
  const r = spawnSync('node', ['scripts/' + s + '.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 1500000, maxBuffer: 1 << 26 });
  fs.writeFileSync(ROOT + '/out/audit-' + s + '.log', (r.stdout || '') + (r.stderr || ''));
  fs.appendFileSync(ROOT + '/out/audit.txt', s + '\t' + (r.status === null ? 'TIMEOUT' : r.status) + '\t' + Math.round((Date.now() - t) / 1000) + 's\n');
}
fs.appendFileSync(ROOT + '/out/audit.txt', 'DONE\n');
