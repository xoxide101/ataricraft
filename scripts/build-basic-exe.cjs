// Builds a standalone Windows .exe that runs a BASIC listing with the same interpreter as the browser panel.
//   node scripts/build-basic-exe.cjs program.bas [out.exe]
// Uses Node's single-executable-application support (Node 20+) and postject (fetched with npx on first use).
// The .exe is a console program: PRINT goes to stdout, INPUT reads stdin. Graphics, sound and PEEK/POKE to hardware are not available.
// It is not a DOS program: DOS needs a 16-bit toolchain, which this build does not provide.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-basic-exe.cjs program.bas [out.exe]'); process.exit(2); }
const out = path.resolve(process.argv[3] || path.basename(src).replace(/\.[^.]*$/, '') + '.exe');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'basicexe-'));
const basicSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'basic.js'), 'utf8');

const entry = `'use strict';
const basicModule = (() => { const module = { exports: {} }, exports = module.exports; (function (self) {\n${basicSrc}\n}).call(module.exports, module.exports); return module.exports; })();
const sea = require('node:sea'), readline = require('node:readline');
const Basic = (basicModule.Basic || (basicModule.AC && basicModule.AC.Basic && basicModule.AC.Basic.Basic) || basicModule);
const text = sea.getAsset('program.bas', 'utf8');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const queue = [], waiters = []; let closed = false;
rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
rl.on('close', () => { closed = true; waiters.splice(0).forEach((w) => w('')); });
const input = (prompt) => { process.stdout.write(prompt || '? '); return new Promise((res) => { if (queue.length) res(queue.shift()); else if (closed) res(''); else waiters.push(res); }); };
const b = new Basic({ print: (s) => process.stdout.write(s === '\\f' ? '\\n' : s), input, hooks: {} });
b.load(text);
b.run().then((r) => { rl.close(); process.exit(r && r.error ? 1 : 0); });
`;
fs.writeFileSync(path.join(tmp, 'entry.cjs'), entry);
fs.writeFileSync(path.join(tmp, 'sea-config.json'), JSON.stringify({ main: 'entry.cjs', output: 'sea.blob', disableExperimentalSEAWarning: true, assets: { 'program.bas': path.resolve(src) } }));
const run = (c, a) => { const r = cp.spawnSync(c, a, { cwd: tmp, stdio: 'inherit', shell: c === 'npx' && process.platform === 'win32' }); if (r.status !== 0) { console.error('failed:', c, a.join(' ')); process.exit(1); } };
run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);
fs.copyFileSync(process.execPath, out);
run('npx', ['--yes', 'postject', JSON.stringify(out), 'NODE_SEA_BLOB', 'sea.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1048576) + ' MB)');
