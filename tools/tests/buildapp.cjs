// Assemble a sample app that uses the shared N: includes: node tools/tests/buildapp.cjs NAME [out.xex]
// The Workbench assembler has no include directive, so the includes are pasted in at "; @head" and "; @lib".
const fs = require('fs'), path = require('path');
const { assemble } = require('../../web/js/asm6502.js');
function build(name) {
  const d = __dirname, rd = (f) => fs.readFileSync(path.join(d, f), 'utf8');
  const src = rd(name + '.asm').replace('; @head', () => rd('nhead.inc')).replace('; @lib', () => rd('nlib.inc')).replace('; @tok', () => rd('ntok.inc'));
  return { src, ...assemble(src) };
}
module.exports = { build };
if (require.main === module) {
  const r = build(process.argv[2]);
  const out = process.argv[3] || path.join(__dirname, 'bin', process.argv[2].toUpperCase() + '.COM');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.xex));
  console.log(out, r.xex.length + ' bytes');
}
