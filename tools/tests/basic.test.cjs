// Quick checks for web/js/basic.js: node tools/tests/basic.test.cjs
const { Basic } = require('../../web/js/basic.js');
let bad = 0;
async function t(name, src, want, inputs = [], dialect) {
  let out = ''; const b = new Basic({ print: (s) => { out += s; }, input: async () => inputs.shift() || '', dialect });
  b.load(src); await b.run();
  if (out !== want) { bad++; console.log('FAIL', name, JSON.stringify(out), 'wanted', JSON.stringify(want)); } else console.log('ok  ', name);
}
(async () => {
  await t('print', '10 PRINT "HI";1+2*3,7\n20 PRINT 0.5;-0.25;1/3', 'HI7       7\n.5-.25.333333333\n');
  await t('for', '10 FOR I=1 TO 3\n20 PRINT I;\n30 NEXT I\n40 PRINT', '123\n');
  await t('step', '10 FOR I=10 TO 1 STEP -4:PRINT I;:NEXT I', '1062');
  await t('gosub', '10 GOSUB 100\n20 PRINT "B"\n30 END\n100 PRINT "A"\n110 RETURN', 'A\nB\n');
  await t('if', '10 A=5\n20 IF A>3 THEN PRINT "BIG"\n30 IF A<3 THEN PRINT "SMALL"\n40 IF A=5 THEN 60\n50 PRINT "X"\n60 PRINT "END"', 'BIG\nEND\n');
  await t('on', '10 FOR I=1 TO 3\n20 ON I GOTO 100,200,300\n30 NEXT I\n40 END\n100 PRINT "A";:GOTO 30\n200 PRINT "B";:GOTO 30\n300 PRINT "C";:GOTO 30', 'ABC');
  await t('strings', '10 DIM A$(20),B$(5)\n20 A$="HELLO WORLD"\n30 PRINT A$(1,5);A$(7);LEN(A$)\n40 A$(1,1)="J":PRINT A$\n50 B$=STR$(42):PRINT B$;ASC("A");CHR$(66)', 'HELLOWORLD11\nJELLO WORLD\n4265B\n');
  await t('data', '10 DIM N$(10)\n20 READ N$,X:PRINT N$;X\n30 READ N$,X:PRINT N$;X\n40 DATA FRED,5,"AMY",7', 'FRED5\nAMY7\n');
  await t('array', '10 DIM A(3)\n20 FOR I=0 TO 3:A(I)=I*I:NEXT I\n30 PRINT A(3);A(2)', '94\n');
  await t('input', '10 INPUT A,B\n20 PRINT A+B', '7\n', ['3,4']);
  await t('math', '10 PRINT INT(3.7);ABS(-2);SQR(16);2^3;SGN(-5)', '3248-1\n');
  await t('while', '10 I=0\n20 WHILE I<3\n30 I=I+1:PRINT I;\n40 WEND', '123', [], 'xl');
  await t('err', '10 PRINT 1/0', '\nERROR- 11 AT LINE 10\n');
  await t('trap', '10 TRAP 100\n20 PRINT 1/0\n30 PRINT "NO"\n100 PRINT "CAUGHT"', 'CAUGHT\n');
  await t('altair+', '10 A$="AB"+"CD":PRINT A$', 'ABCD\n', [], 'altair');
  process.exit(bad ? 1 : 0);
})();
