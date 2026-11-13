// Builds scripts/fixtures/dos-sample.bas as a DOS .exe, runs it in DOSBox-X (headless) and checks the output.
//   node tools/dos-basic/dos-test.cjs        (DOSBOX env var overrides C:\DOSBox-X\dosbox-x.exe)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const dosbox = process.env.DOSBOX || 'C:\\DOSBox-X\\dosbox-x.exe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dostest-'));
const b = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-dos.cjs'), path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'dos-sample.bas'), path.join(dir, 'T.EXE')], { stdio: 'inherit' });
if (b.status) process.exit(1);
const child = cp.spawn(dosbox, ['-nogui', '-fastlaunch', '-c', `mount c ${dir}`, '-c', 'c:', '-c', 'T.EXE > OUT.TXT', '-c', 'exit'], { stdio: 'ignore', windowsHide: true });
const deadline = Date.now() + 60000;
const wait = setInterval(() => {
  const done = child.exitCode !== null;
  if (done || Date.now() > deadline) {
    clearInterval(wait); if (!done) child.kill();
    const got = fs.existsSync(path.join(dir, 'OUT.TXT')) ? fs.readFileSync(path.join(dir, 'OUT.TXT'), 'latin1').replace(/\r/g, '') : '';
    const want = 'HELLO FROM DOS BASIC\nSUM=55\nSUB\n42 ANSWER\nBIG\nATA 5 TAR\n';
    fs.rmSync(dir, { recursive: true, force: true });
    if (got === want) { console.log('dos-test: ok'); process.exit(0); }
    console.error('dos-test: FAILED\n--- got ---\n' + got + '--- want ---\n' + want); process.exit(1);
  }
}, 300);
