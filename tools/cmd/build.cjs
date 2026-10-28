const { execFileSync } = require('child_process');
const path = require('path');
const mads = path.resolve(__dirname, '..', '..', 'out', 'mads', 'mads.exe');
const run = (...a) => execFileSync(mads, a, { cwd: __dirname, stdio: 'inherit' });
run('rt.asm', '-o:bin\\rt.bin');
run('loader.asm', '-o:bin\\loader.bin');
run('cmd.asm', '-o:bin\\cmd.com');
