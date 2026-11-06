// Audit runner: node scripts/audit-run.cjs  -> out/audit.txt (one line per script: name, exit code, seconds)
const { spawnSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
// derived-file staleness and docs-vs-code checks always run first; the rest comes from out/audit-list.txt (one script name per line, optional args after a space)
const LIST = ['build-all --check', 'docs-check', ...fs.readFileSync(ROOT + '/out/audit-list.txt', 'utf8').split(/\r?\n/).filter(Boolean)];
fs.writeFileSync(ROOT + '/out/audit.txt', '');
for (const line of LIST) {
  const [s, ...extra] = line.split(' '), t = Date.now();
  const r = spawnSync('node', ['scripts/' + s + '.cjs', ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 1500000, maxBuffer: 1 << 26 });
  fs.writeFileSync(ROOT + '/out/audit-' + line.replace(/\W+/g, '_') + '.log', (r.stdout || '') + (r.stderr || ''));
  fs.appendFileSync(ROOT + '/out/audit.txt', line + '\t' + (r.status === null ? 'TIMEOUT' : r.status) + '\t' + Math.round((Date.now() - t) / 1000) + 's\n');
}
fs.appendFileSync(ROOT + '/out/audit.txt', 'DONE\n');
