// node scripts/acw-faces.cjs : regenerates the ACWriter-faces data for the font editor and the overridden .inc files in font/build/
const A = require('../tools/acwfaces.cjs');
for (const f of A.writeWeb()) console.log(f.id.padEnd(8), f.adv + ' px', f.override ? 'OVERRIDE' : 'built   ', f.src);
