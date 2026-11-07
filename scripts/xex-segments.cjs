// Lists the load segments of an Atari XEX file: node scripts/xex-segments.cjs tools/acwriter/poc5.xex
const b = require('fs').readFileSync(process.argv[2]);
let i = 0;
const out = [];
while (i < b.length) {
  if (b[i] === 0xFF && b[i + 1] === 0xFF) i += 2;
  const s = b[i] | (b[i + 1] << 8), e = b[i + 2] | (b[i + 3] << 8);
  out.push(s.toString(16).toUpperCase().padStart(4, '0') + '-' + e.toString(16).toUpperCase().padStart(4, '0') + ' (' + (e - s + 1) + ')');
  i += 4 + (e - s + 1);
}
console.log(out.join('\n'));
