'use strict';
// In-browser BASIC interpreter (web/js/basic.js): 2-D arrays, CALL, and statements found in typical downloaded samples. node scripts/basic-run-test.cjs
const { Basic } = require('../web/js/basic.js');
let fail = 0, n = 0;
async function run(src, hooks, dialect) {
  let out = ''; const b = new Basic({ print: (t) => { out += t; }, hooks: hooks || {}, dialect });
  b.load(src); await b.run(); return out;
}
const eq = (a, b, m) => { n++; if (a !== b) { fail++; console.log('FAIL', m, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
(async () => {
  eq(await run('10 DIM A(2,3)\n20 FOR I=0 TO 2:FOR J=0 TO 3:A(I,J)=I*10+J:NEXT J:NEXT I\n30 PRINT A(2,3);" ";A(1,0)'), '23 10\n', 'DIM A(x,y) store/read');
  eq(/ERROR- 9/.test(await run('10 DIM A(2,3)\n20 PRINT A(3,0)')), true, '2-D bounds -> ERROR 9');
  eq(/ERROR- 9/.test(await run('10 DIM A(2,3)\n20 PRINT A(1)')), true, 'wrong index count -> ERROR 9');
  eq(await run('10 DIM A(5):A(5)=7:PRINT A(5)'), '7\n', '1-D array unchanged');
  let called = null;
  eq(await run('10 CALL 1536\n20 CALL(1600,5,6)\n30 PRINT "OK"', { call: (...a) => { (called = called || []).push(a.join(',')); } }), 'OK\n', 'CALL does not error');
  eq(called && called.join('|'), '1536|1600,5,6', 'CALL passes address and args to host hook');
  eq(await run('10 PRINT USR(1536)\n20 PRINT DPEEK(0)'), '0\n0\n', 'USR/DPEEK without host');
  eq(await run('10 OPEN #1,4,0,"K:"\n20 GET #1,K\n30 PRINT #1;"X"\n40 CLOSE #1\n50 PRINT "DONE"'), 'X\nDONE\n', 'OPEN/GET/PRINT#/CLOSE are accepted');
  {
    const fx = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'game-starter.bas'), 'utf8');
    const o = await run('5 SC=0:BYLAD=0\n' + fx);
    eq(/ERROR- 8/.test(o), false, 'pasted listing (smart quotes, \\*, wrapped line, RESTORE n) has no ERROR 8');
    eq(/SCORE:0/.test(o), true, 'pasted listing prints SCORE');
  }
  console.log(`basic-run-test: ${n} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
