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
    if (/^; @head/m.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))) {
      fs.writeFileSync(out, Buffer.from(require('./buildapp.cjs').build(name).xex));
      console.log('ok  ', name.toUpperCase() + '.COM', fs.statSync(out).size);
      continue;
    }
    execFileSync(mads, [f, '-o:' + out], { cwd: __dirname, stdio: 'pipe' });
    console.log('ok  ', name.toUpperCase() + '.COM', fs.statSync(out).size);
  } catch (e) {
    try { // case-sensitive labels (lynx.asm) only assemble with the Workbench assembler
      fs.writeFileSync(out, Buffer.from(require('./buildapp.cjs').build(name).xex));
      console.log('ok  ', name.toUpperCase() + '.COM', fs.statSync(out).size, '(Workbench assembler)');
      continue;
    } catch (e2) {}
    console.log('FAIL', f, String(e.stdout || e.message));
  }
}
