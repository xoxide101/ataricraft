// Scans Atari DOS disk images (.ATR) for tokenized Atari BASIC files, detokenizes them and runs each through the
// in-browser interpreter headlessly, reporting the first ERROR per program.
//   node scripts/atr-basic-scan.cjs <image.atr|folder> [more...]   (set SHOW=1 to print LISTings of failures)
'use strict';
const fs = require('fs'), path = require('path');
const DosFs = require('../web/js/dosfs.js');
const { Basic } = require('../web/js/basic.js');

const STMT = 'REM,DATA,INPUT,COLOR,LIST,ENTER,LET,IF,FOR,NEXT,GOTO,GO TO,GOSUB,TRAP,BYE,CONT,COM,CLOSE,CLR,DEG,DIM,END,NEW,OPEN,LOAD,SAVE,STATUS,NOTE,POINT,XIO,ON,POKE,PRINT,RAD,READ,RESTORE,RETURN,RUN,STOP,POP,?,GET,PUT,GRAPHICS,PLOT,POSITION,DOS,DRAWTO,SETCOLOR,LOCATE,SOUND,LPRINT,CSAVE,CLOAD,,ERROR-'.split(',');
const OPS = {
  0x12: ',', 0x13: '$', 0x14: ':', 0x15: ';', 0x17: ' GOTO ', 0x18: ' GOSUB ', 0x19: ' TO ', 0x1a: ' STEP ', 0x1b: ' THEN ', 0x1c: '#', 0x1d: '<=', 0x1e: '<>', 0x1f: '>=', 0x20: '<', 0x21: '>', 0x22: '=', 0x23: '^', 0x24: '*', 0x25: '+', 0x26: '-', 0x27: '/', 0x28: ' NOT ', 0x29: ' OR ', 0x2a: ' AND ', 0x2b: '(', 0x2c: ')', 0x2d: '=', 0x2e: '=', 0x2f: '<=', 0x30: '<>', 0x31: '>=', 0x32: '<', 0x33: '>', 0x34: '=', 0x35: '+', 0x36: '-', 0x37: '(', 0x38: '(', 0x39: '(', 0x3a: '(', 0x3b: '(', 0x3c: ',',
};
const FUNS = 'STR$,CHR$,USR,ASC,VAL,LEN,ADR,ATN,COS,PEEK,SIN,RND,FRE,EXP,LOG,CLOG,SQR,SGN,ABS,INT,PADDLE,STICK,PTRIG,STRIG'.split(',');

function detok(b) {
  if (b.length < 16 || b[0] !== 0 || b[1] !== 0) return null;
  const w = (o) => b[o] | (b[o + 1] << 8);
  const vntp = w(2), vntd = w(4), vvtp = w(6), stmtab = w(8), starp = w(12);
  const off = (a) => 14 + a - vntp;
  if (vntd < vntp || stmtab < vvtp || starp < stmtab || off(starp) > b.length + 1) return null;
  const names = []; let cur = '';
  for (let i = off(vntp); i < off(vntd); i++) { const c = b[i]; if (c & 0x80) { names.push(cur + String.fromCharCode(c & 0x7f)); cur = ''; } else cur += String.fromCharCode(c); }
  const lines = [];
  for (let p = off(stmtab); p < off(starp) && p < b.length - 3;) {
    const ln = w(p), end = p + b[p + 2]; if (b[p + 2] < 4 || end > b.length) return null;
    let q = p + 3; const sts = [];
    while (q < end) {
      const se = p + b[q], tk = b[q + 1]; if (se > end || se <= q) return null;
      let s = tk === 0x36 ? '' : (STMT[tk] || '?') + (tk === 0x00 || tk === 0x01 || tk === 0x37 ? '' : ' ');
      let r = q + 2;
      if (tk === 0 || tk === 1 || tk === 0x37) { for (; r < se && b[r] !== 0x9b; r++) s += String.fromCharCode(b[r] & 0x7f); }
      else {
        for (; r < se; r++) {
          const t = b[r];
          if (t === 0x16 || t === 0x14) break;
          if (t >= 0x80) s += (names[t - 0x80] || '?').replace(/\($/, '');
          else if (t === 0x0e) { let e = b[r + 1], sign = e & 0x80, ex = (e & 0x7f) - 64, m = 0; for (let k = 0; k < 5; k++) { const v = b[r + 2 + k]; m = m * 100 + (v >> 4) * 10 + (v & 15); } const val = m * Math.pow(100, ex - 4); s += (sign ? '-' : '') + (Math.round(val * 1e9) / 1e9); r += 6; }
          else if (t === 0x0f) { const n = b[r + 1]; s += '"' + Buffer.from(b.slice(r + 2, r + 2 + n)).toString('latin1').replace(/"/g, '""') + '"'; r += 1 + n; }
          else if (t >= 0x3d && t <= 0x54) s += FUNS[t - 0x3d];
          else if (OPS[t] !== undefined) s += OPS[t];
          else s += '?';
        }
      }
      sts.push(s.trimEnd()); q = se;
    }
    lines.push(ln + ' ' + sts.join(':')); p = end;
  }
  return lines.join('\n');
}

async function tryRun(src) {
  let out = '', steps = 0; const b = new Basic({ print: (t) => (out += t), input: () => new Promise((r) => setImmediate(() => r('1'))), onStep: async () => { if (++steps > 300000) b.stopFlag = true; if (steps % 5000 === 0) await new Promise((r) => setImmediate(r)); }, hooks: { peek: () => 0, poke() {}, call() {}, usr: () => 0 } });
  try { b.load(src); } catch (e) { return 'LOAD: ' + e.message; }
  const t = setTimeout(() => { b.stopFlag = true; }, 800);
  try { await b.run(); } catch (e) { clearTimeout(t); return 'THROW: ' + e.message; }
  clearTimeout(t);
  const m = /ERROR- (\d+) AT LINE (\d+)[^\n]*/.exec(out);
  return m ? m[0] : '';
}

(async () => {
  const args = process.argv.slice(2), imgs = [];
  for (const a of args) { if (fs.statSync(a).isDirectory()) { const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.atr$/i.test(p) && imgs.push(p); } }; walk(a); } else imgs.push(a); }
  const tally = {}; let total = 0, clean = 0;
  for (const img of imgs) {
    const v = DosFs.open(new Uint8Array(fs.readFileSync(img))); if (!v) { console.log('skip', img); continue; }
    for (const e of v.list('')) {
      if (e.dir || !/\.(BAS|LST)$/i.test(e.name)) continue;
      const data = v.read(e); const src = /\.LST$/i.test(e.name) ? Buffer.from(data).toString('latin1') : detok(data);
      if (!src) continue;
      total++; if (process.env.DUMP && e.name === process.env.DUMP) console.log(src);
      if (process.env.TRACE) console.log('run', e.name);
      const r = await tryRun(src);
      if (!r) clean++; else { const k = r.replace(/AT LINE \d+/, '').replace(/\(.*$/, '').trim(); (tally[k] = tally[k] || []).push(e.name + ' ' + (/LINE (\d+)/.exec(r) || [])[0]); }
      if (r && process.env.SHOW) { const ln = /LINE (\d+)/.exec(r)[1]; console.log('==', e.name, r, '\n   >> ' + (src.split('\n').find((l) => l.startsWith(ln + ' ')) || '').slice(0, 160)); }
    }
  }
  console.log(`programs: ${total}, ran without an error in 0.8s: ${clean}`);
  for (const k of Object.keys(tally).sort((a, b) => tally[b].length - tally[a].length)) console.log(String(tally[k].length).padStart(4), k, '|', tally[k].slice(0, 4).join('; '));
})();
