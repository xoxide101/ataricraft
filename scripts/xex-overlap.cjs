// Reports overlapping load segments in an XEX (a later segment silently overwrites an earlier one).
const b = require('fs').readFileSync(process.argv[2] || __dirname + '/../tools/acwriter/poc5.xex');
let o = 2; const segs = [];
while (o < b.length) {
  const s = b.readUInt16LE(o); if (s === 0xFFFF) { o += 2; continue; }
  const e = b.readUInt16LE(o + 2); segs.push([s, e]); o += 4 + e - s + 1;
}
let bad = 0;
for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
  const [a, b2] = [segs[i], segs[j]];
  if (a[0] <= b2[1] && b2[0] <= a[1] && !(a[0] >= 0x2E0 && a[1] <= 0x2E3) && a[0] !== 0x2E0) { bad++; console.log('OVERLAP', a.map((x) => x.toString(16)).join('-'), b2.map((x) => x.toString(16)).join('-')); }
}
console.log(bad ? bad + ' overlaps' : 'no overlapping segments', '(' + segs.length + ' segments)');
process.exit(bad ? 1 : 0);
