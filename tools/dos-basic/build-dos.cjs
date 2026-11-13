// Builds a DOS .exe (16-bit real mode, no extender needed) from a BASIC listing.
//   node tools/dos-basic/build-dos.cjs program.bas [out.exe]
// Needs Open Watcom 2.x (see README.md). Set WATCOM, or install to C:\WATCOM.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const src = process.argv[2];
if (!src) { console.error('usage: node tools/dos-basic/build-dos.cjs program.bas [out.exe]'); process.exit(2); }
const out = path.resolve(process.argv[3] || path.basename(src).replace(/\.[^.]*$/, '').slice(0, 8) + '.exe');
const W = process.env.WATCOM || 'C:\\WATCOM';
if (!fs.existsSync(path.join(W, 'binnt', 'wcl.exe'))) { console.error('Open Watcom not found at ' + W + ' (set WATCOM)'); process.exit(1); }

const text = fs.readFileSync(src, 'latin1').replace(/[\u201c\u201d]/g, '"').replace(/\\([*_])/g, '$1');
const lines = [];
for (const raw of text.split(/\r?\n/)) {
  const m = /^\s*(\d+)\s?(.*)$/.exec(raw);
  if (m) lines.push([+m[1], m[2].replace(/\s+$/, '')]);
  else if (raw.trim() && lines.length) lines[lines.length - 1][1] += raw.trim();
}
if (!lines.length) { console.error('no numbered lines found'); process.exit(1); }
const esc = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[^\x20-\x7e]/g, '?') + '"';
const header = `#define PROG_N ${lines.length}\nstatic const int prog_nums[] = {${lines.map((l) => l[0]).join(',')}};\nstatic const char *const prog_text[] = {\n${lines.map((l) => esc(l[1])).join(',\n')}\n};\n`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dosbasic-'));
fs.writeFileSync(path.join(tmp, 'prog.h'), header);
fs.copyFileSync(path.join(__dirname, 'basic.c'), path.join(tmp, 'basic.c'));
const env = { ...process.env, WATCOM: W, INCLUDE: path.join(W, 'h'), PATH: [path.join(W, 'binnt64'), path.join(W, 'binnt'), process.env.PATH].join(path.delimiter) };
const target = process.env.DOSBASIC_TARGET || 'dos'; // 'nt' builds a native Windows exe for debugging the runtime
const r = cp.spawnSync(target === 'nt' ? 'wcl386' : 'wcl', target === 'nt' ? ['-bt=nt', '-q', '-ox', 'basic.c', '-fe=basic'] : ['-bt=dos', '-ml', '-q', '-ox', '-k40000', 'basic.c', '-fe=basic'], { cwd: tmp, env, encoding: 'utf8' });
if (r.status !== 0 || !fs.existsSync(path.join(tmp, 'basic.exe'))) { console.error(r.stdout + r.stderr); process.exit(1); }
fs.copyFileSync(path.join(tmp, 'basic.exe'), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes, DOS 16-bit)');
