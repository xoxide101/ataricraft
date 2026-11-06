// Generates the EBookCraft test samples in docs/samples/ebook/ from public-domain text (1859-1892 excerpts) plus a short original note.
// Needs Chrome + playwright-core only for the "scanned page" (a slightly rotated, shaded page rendered at 150 dpi); everything else is pure Node.
//   node scripts/ebookcraft-samples.cjs
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.join(__dirname, '..');
const EBC = require(path.join(root, 'web/js/ebookcraft/index.js'));
const B = EBC.base, I = EBC.image;
const out = path.join(root, 'docs', 'samples', 'ebook');
fs.mkdirSync(out, { recursive: true });
const w = (n, d) => { fs.writeFileSync(path.join(out, n), d); console.log(n, d.length); };

const TITLE = 'Public Domain Sampler', AUTHOR = 'Various (public domain)';
const CH = [
  ['About this sampler', ['This small book was assembled for testing EBookCraft. The excerpts below are from works that are in the public domain; this note is original and free to use.', 'It exists so that the reader, the converter and the OCR step have something real to chew on: several chapters, a table of contents, long and short paragraphs, and a few typographic characters such as dashes and curly quotes.']],
  ['A Tale of Two Cities', ['It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way \u2014 in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.', '(Charles Dickens, 1859.)']],
  ['Pride and Prejudice', ['It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', 'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.', '(Jane Austen, 1813.)']],
  ['Moby-Dick', ['Call me Ishmael. Some years ago \u2014 never mind how long precisely \u2014 having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.', '(Herman Melville, 1851.)']],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const enc = (s) => Buffer.from(s, 'utf8');

(async () => {
  // plain text
  w('sampler.txt', enc(CH.map(([t, ps]) => t.toUpperCase() + '\n\n' + ps.join('\n\n')).join('\n\n\n') + '\n'));
  // HTML
  w('sampler.html', enc('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + TITLE + '</title><meta name="author" content="' + AUTHOR + '"></head><body>' +
    CH.map(([t, ps]) => '<h1>' + esc(t) + '</h1>' + ps.map((p) => '<p>' + esc(p) + '</p>').join('')).join('') + '</body></html>'));
  // FB2
  w('sampler.fb2', enc('<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose</genre><author><first-name>Various</first-name><last-name>(public domain)</last-name></author><book-title>' + TITLE + '</book-title><lang>en</lang></title-info></description><body>' +
    CH.map(([t, ps]) => '<section><title><p>' + esc(t) + '</p></title>' + ps.map((p) => '<p>' + esc(p) + '</p>').join('') + '</section>').join('') + '</body></FictionBook>'));
  // EPUB 3 with nav + NCX
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ebookcraft:sampler</dc:identifier><dc:title>' + TITLE + '</dc:title><dc:creator>' + AUTHOR + '</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' + CH.map((c, i) => '<item id="c' + i + '" href="c' + i + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '</manifest><spine toc="ncx">' + CH.map((c, i) => '<itemref idref="c' + i + '"/>').join('') + '</spine></package>' },
    { name: 'OEBPS/nav.xhtml', data: '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>' + CH.map(([t], i) => '<li><a href="c' + i + '.xhtml">' + esc(t) + '</a></li>').join('') + '</ol></nav></body></html>' },
    { name: 'OEBPS/toc.ncx', data: '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>' + CH.map(([t], i) => '<navPoint id="n' + i + '" playOrder="' + (i + 1) + '"><navLabel><text>' + esc(t) + '</text></navLabel><content src="c' + i + '.xhtml"/></navPoint>').join('') + '</navMap></ncx>' },
    ...CH.map(([t, ps], i) => ({ name: 'OEBPS/c' + i + '.xhtml', data: '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + esc(t) + '</title></head><body><h1>' + esc(t) + '</h1>' + ps.map((p) => '<p>' + esc(p) + '</p>').join('') + '</body></html>' })),
  ];
  const epub = await B.zipWrite(files, { deflate: true });
  w('sampler.epub', Buffer.from(epub));
  // MOBI (PalmDOC compression type 2, literal-only stream: valid, readers just see no back-references)
  {
    const html = '<html><body>' + CH.map(([t, ps]) => '<h1>' + esc(t) + '</h1>' + ps.map((p) => '<p>' + esc(p) + '</p>').join('') + '<mbp:pagebreak/>').join('') + '</body></html>';
    const text = Buffer.from(html.replace(/[^\x00-\x7f]/g, (c) => (c === '\u2014' ? '--' : '?')), 'latin1');
    const recs = [];
    for (let i = 0; i < text.length; i += 4096) {
      const ch = text.subarray(i, i + 4096), o = [];
      for (const b of ch) { if (b === 0 || (b >= 9 && b <= 0x7f)) o.push(b); else o.push(1, b); }
      recs.push(Buffer.from(o));
    }
    const name = Buffer.from(TITLE), auth = Buffer.from('Various'), hl = 232;
    const exth = Buffer.concat([Buffer.from('EXTH'), Buffer.alloc(8), Buffer.alloc(8 + auth.length)]);
    exth.writeUInt32BE(exth.length, 4); exth.writeUInt32BE(1, 8); exth.writeUInt32BE(100, 12); exth.writeUInt32BE(8 + auth.length, 16); auth.copy(exth, 20);
    const ex = Buffer.concat([exth, Buffer.alloc((4 - (exth.length % 4)) % 4)]);
    const r0 = Buffer.alloc(16 + hl + ex.length + name.length + 4);
    r0.writeUInt16BE(2, 0); r0.writeUInt32BE(text.length, 4); r0.writeUInt16BE(recs.length, 8); r0.writeUInt16BE(4096, 10);
    r0.write('MOBI', 16); r0.writeUInt32BE(hl, 20); r0.writeUInt32BE(2, 24); r0.writeUInt32BE(65001, 28); r0.writeUInt32BE(6, 36);
    r0.writeUInt32BE(16 + hl + ex.length, 84); r0.writeUInt32BE(name.length, 88); r0.writeUInt32BE(0x40, 128); r0.writeUInt32BE(0xffffffff, 80 - 0 + 0 * 0);
    r0.writeUInt32BE(recs.length + 1, 80);
    ex.copy(r0, 16 + hl); name.copy(r0, 16 + hl + ex.length);
    const all = [r0, ...recs], head = Buffer.alloc(78 + all.length * 8 + 2);
    head.write('sampler', 0); head.write('BOOKMOBI', 60); head.writeUInt16BE(all.length, 76);
    let off = head.length; all.forEach((r, i) => { head.writeUInt32BE(off, 78 + i * 8); head.writeUInt32BE(i * 2, 82 + i * 8); off += r.length; });
    w('sampler.mobi', Buffer.concat([head, ...all]));
  }
  // Craft Word
  if (globalThis.XCW) {
    const paras = [];
    for (const [t, ps] of CH) { paras.push({ align: 'c', bullet: false, runs: [{ t: EBC.book.asciify(t), b: 1 }] }); for (const p of ps) paras.push({ align: 'l', bullet: false, runs: [{ t: EBC.book.asciify(p) }] }); }
    const c = globalThis.XCW.toCwd(paras, {});
    w('sampler.cwd', Buffer.from(c.file || c.bytes));
  }
  // PDF with a text layer (Helvetica, WinAnsi, uncompressed streams so it is easy to inspect)
  {
    const wrapLines = (t, n) => { const o = []; let l = ''; for (const wd of t.split(' ')) { if ((l + ' ' + wd).trim().length > n) { o.push(l); l = wd; } else l = (l + ' ' + wd).trim(); } if (l) o.push(l); return o; };
    const pdfEsc = (s) => s.replace(/[\\()]/g, '\\$&').replace(/\u2014/g, '\x97').replace(/[^\x20-\x7e\x97]/g, '?');
    const pages = [[TITLE, '', ...wrapLines(CH[1][1][0], 80), '', ...wrapLines(CH[2][1].join(' '), 80)], [CH[3][0], '', ...wrapLines(CH[3][1].join(' '), 80)]];
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [' + pages.map((p, i) => (5 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Title (' + TITLE + ') /Author (Various) >>';
    pages.forEach((lines, i) => {
      const s = 'BT /F1 11 Tf 14 TL 56 740 Td ' + lines.map((l) => '(' + pdfEsc(l) + ') Tj T*').join(' ') + ' ET';
      objs[5 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>';
      objs[6 + i * 2] = '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream';
    });
    let body = '%PDF-1.4\n'; const offs = [];
    for (let i = 1; i < objs.length; i++) { offs[i] = body.length; body += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
    const xr = body.length;
    body += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + offs.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info 4 0 R >>\nstartxref\n' + xr + '\n%%EOF\n';
    w('sampler-text.pdf', Buffer.from(body, 'latin1'));
  }
  // Scanned page: Chrome renders a 150 dpi letter page (serif, rotated 1.1 degrees, shaded), then PNG + image-only PDF
  const pw = require('C:/Users/raver/craftapi/node_modules/playwright-core');
  const br = await pw.chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const pg = await br.newPage({ viewport: { width: 1275, height: 1650 } });
  await pg.setContent('<body style="margin:0;background:#e9e4d6"><div style="position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.18),rgba(0,0,0,0) 40%,rgba(0,0,0,.08))"></div>' +
    '<div style="position:absolute;left:150px;top:170px;width:975px;transform:rotate(1.1deg);transform-origin:0 0;font:34px/48px Georgia,\'Times New Roman\',serif;color:#1b1b1b"><h1 style="font-size:46px;text-align:center;margin:0 0 40px">A Tale of Two Cities</h1>' +
    CH[1][1].map((p) => '<p style="text-align:justify;margin:0 0 20px">' + esc(p) + '</p>').join('') + '<h2 style="font-size:40px;text-align:center;margin:50px 0 30px">Pride and Prejudice</h2>' + CH[2][1].map((p) => '<p style="text-align:justify;margin:0 0 20px">' + esc(p) + '</p>').join('') + '</div></body>');
  const shot = await pg.screenshot({ type: 'png' });
  await br.close();
  const img = await I.decode(new Uint8Array(shot), 'x.png');
  const png = await B.pngEncodeGray(img.w, img.h, img.g, 8);
  w('scan-page.png', Buffer.from(png));
  const raw = zlib.deflateSync(Buffer.from(img.g)), parts = [];
  const o = []; let pos = 0; const add = (b) => { parts.push(Buffer.from(b, 'latin1')); pos += parts[parts.length - 1].length; };
  add('%PDF-1.4\n');
  o[1] = pos; add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  o[2] = pos; add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  o[3] = pos; add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  o[4] = pos; add('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ' + raw.length + ' >>\nstream\n'); parts.push(raw); pos += raw.length; add('\nendstream\nendobj\n');
  o[5] = pos; add('5 0 obj\n<< /Length 33 >>\nstream\nq 612 0 0 792 0 0 cm /Im0 Do Q\nendstream\nendobj\n');
  const xr = pos; add('xref\n0 6\n0000000000 65535 f \n' + o.slice(1).map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n');
  w('scan-page.pdf', Buffer.concat(parts));
})().catch((e) => { console.error(e); process.exit(1); });
