const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const mads = path.join(root, 'out', 'mads', 'mads.exe');
const bin = path.join(__dirname, 'bin');
fs.mkdirSync(bin, { recursive: true });
const only = process.argv.slice(2);
for (const f of fs.readdirSync(__dirname).filter(n => n.endsWith('.asm'))) {
  const name = f.replace('.asm', '');
  if (only.length && !only.includes(name)) continue;
  const out = path.join(bin, name.toUpperCase() + '.COM');
  try {
    execFileSync(mads, [f, '-o:' + out], { cwd: __dirname, stdio: 'pipe' });
    console.log('ok  ', name.toUpperCase() + '.COM', fs.statSync(out).size);
  } catch (e) {
    console.log('FAIL', f, String(e.stdout || e.message));
  }
}
