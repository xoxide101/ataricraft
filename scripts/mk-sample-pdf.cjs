// Writes docs/samples/pdf-test.pdf: a 3-page, uncompressed, hand-built PDF (text in two fonts, tiny text, vector art)
// used by scripts/pdfview-test.cjs. No third-party content. Usage: node scripts/mk-sample-pdf.cjs [out.pdf]
const fs = require('fs'), path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'samples', 'pdf-test.pdf');
const objs = [];
const add = (s) => objs.push(s) && objs.length;
const esc = (s) => s.replace(/[\\()]/g, '\\$&');
const text = (x, y, font, size, s) => `BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET\n`;
const pages = [
  text(72, 720, 'F1', 28, 'Ataricraft PDF test, page 1') + text(72, 690, 'F2', 12, 'High resolution rendering: this line is set in Times at twelve points.') +
  text(72, 670, 'F1', 6, 'Tiny six point text for HiDPI checks: the quick brown fox jumps over the lazy dog 0123456789') +
  text(72, 640, 'F1', 12, 'Atari 8-bit computers have a 6502 CPU, ANTIC, GTIA and POKEY.') +
  '0 0 0 RG 2 w 72 500 m 300 500 l S 0.8 0 0 rg 72 380 120 80 re f 0 0.4 0.9 rg 220 380 120 80 re f ' +
  '0 0 0 RG 0.25 w ' + Array.from({ length: 40 }, (_, i) => `72 ${300 + i} m 340 ${300 + i} l S`).join(' ') + '\n',
  text(72, 720, 'F1', 28, 'Page 2: search target') + text(72, 690, 'F2', 12, 'The word Zanzibar appears once on this page.') + text(72, 670, 'F2', 12, 'And POKEY appears here too.'),
  text(72, 720, 'F1', 28, 'Page 3') + text(72, 690, 'F2', 12, 'Last page. Atari again: ANTIC and GTIA.') +
  '0 0 0 RG 1 w ' + Array.from({ length: 12 }, (_, i) => `${306 + 150 * Math.cos(i * Math.PI / 6)} ${400 + 150 * Math.sin(i * Math.PI / 6)} m 306 400 l S`).join(' ') + '\n',
];
add('<< /Type /Catalog /Pages 2 0 R >>');
add(`<< /Type /Pages /Kids [${pages.map((_, i) => 5 + i * 2 + ' 0 R').join(' ')}] /Count ${pages.length} >>`);
add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
pages.forEach((c, i) => {
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
  add(`<< /Length ${c.length} >>\nstream\n${c}endstream`);
});
let pdf = '%PDF-1.4\n'; const offs = [];
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xr = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, pdf, 'latin1');
console.log('wrote', out, pdf.length, 'bytes');
