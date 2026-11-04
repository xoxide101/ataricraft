// Builds the network diagnostic tools from netdiag.asm: PING, NSLOOKUP and TRACERT.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const mads = path.join(root, 'out', 'mads', 'mads.exe');
for (const [mode, name] of [[1, 'ping'], [2, 'nslookup'], [3, 'tracert']]) {
  const out = path.join(__dirname, name + '.com');
  execFileSync(mads, ['netdiag.asm', '-d:MODE=' + mode, '-o:' + out], { cwd: __dirname, stdio: 'pipe' });
  console.log('ok  ', name.toUpperCase() + '.COM', fs.statSync(out).size);
}