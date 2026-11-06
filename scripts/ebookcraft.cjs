#!/usr/bin/env node
// EBookCraft command line. Same engine as the web app (web/js/ebookcraft/*), no browser needed.
//   node scripts/ebookcraft.cjs convert <input...|folder> [options] --out <dir>
//   node scripts/ebookcraft.cjs info <book>          title, format, chapters, warnings
//   node scripts/ebookcraft.cjs ocr-status           is the OCR add-on installed?
// Options for convert:
//   --text            text/book.txt (+ .cwd, + per-page text for scans)       --ocr [force]   OCR scanned pages (needs the add-on)
//   --bw              1-bit pages                                              --gray 4,16,256 more gray levels (repeat or comma list)
//   --dither NAME     threshold | bayer4 | bayer8 | floyd | atkinson (default atkinson)
//   --contrast N --brightness N --gamma N --auto --deskew --crop             page clean-up (contrast/brightness -100..100, gamma 0.3..3)
//   --tiles N         cut scans into N screens across for the Atari           --mode gr8|gr15|gr9   Atari screen mode of ATR/XEX
//   --print-width N   high-res width in px (default 1700)                     --no-print / --no-atari / --no-atr / --no-xex / --no-textdisk / --no-bundle
//   --cols N          text wrap for Atari text pages / CWD (default 64)       --slug NAME
//   --deploy          also copy the book into web/library/craftapps/EBookCraft/<slug>/ and update its index.json
//   --stage DIR       same layout under DIR (a staging copy of the web tree for scripts\deploy-server.ps1; never touches the server)
// With none of --text/--bw/--gray/--ocr given, --text --bw is assumed.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const EBC = require(path.join(root, 'web/js/ebookcraft/index.js'));

function parse(argv) {
  const o = { _: [] }, flags = new Set(['text', 'bw', 'auto', 'deskew', 'crop', 'deploy', 'no-print', 'no-atari', 'no-atr', 'no-xex', 'no-textdisk', 'no-bundle']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (k === 'ocr') { o.ocr = argv[i + 1] === 'force' ? (i++, 'force') : true; continue; }
    if (flags.has(k)) { o[k] = true; continue; }
    if (k === 'gray') { (o.gray = o.gray || []).push(...String(argv[++i]).split(',').map(Number)); continue; }
    o[k] = argv[++i];
  }
  return o;
}

function collect(list) {
  const out = [];
  const exts = /\.(epub|txt|html?|xhtml|fb2|mobi|azw3?|prc|cwd|docx|rtf|md|pdf|png|jpe?g|bmp|pbm|pgm|ppm|zip)$/i;
  for (const p of list) {
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) { if (exts.test(f)) out.push({ name: f, bytes: new Uint8Array(fs.readFileSync(path.join(p, f))) }); }
    else out.push({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) });
  }
  return out;
}

function writeFiles(base, files) {
  for (const f of files) { const p = path.join(base, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2), a = parse(rest);
  if (cmd === 'ocr-status') { const ok = await EBC.ocr.available(); console.log(ok ? 'OCR add-on installed' : 'OCR add-on NOT installed: node scripts/ebookcraft-install-ocr.cjs'); return ok ? 0 : 1; }
  if (cmd === 'info') {
    const inp = collect(a._)[0]; const b = await EBC.book.open(inp.bytes, inp.name);
    console.log(JSON.stringify({ title: b.title, author: b.author, format: b.format, chapters: b.chapters.length, toc: b.toc.length, chars: EBC.book.plainText(b).length, warnings: b.warnings }, null, 1));
    return 0;
  }
  if (cmd !== 'convert' || !a._.length) { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 2; }
  const inputs = collect(a._);
  if (!inputs.length) { console.error('no readable input files'); return 2; }
  const any = a.text || a.bw || a.gray || a.ocr;
  const opt = {
    text: any ? !!(a.text || a.ocr) : true, bw: any ? !!a.bw : true, gray: a.gray || [], ocr: a.ocr || false, dither: a.dither || 'atkinson',
    contrast: a.contrast !== undefined ? +a.contrast : undefined, brightness: a.brightness !== undefined ? +a.brightness : undefined, gamma: a.gamma !== undefined ? +a.gamma : undefined,
    auto: !!a.auto, deskew: !!a.deskew, crop: !!a.crop, tiles: +a.tiles || 0, mode: a.mode || (a.gray && !a.bw ? (a.gray.includes(4) ? 'gr15' : a.gray.includes(16) ? 'gr9' : 'gr8') : 'gr8'),
    printWidth: +a['print-width'] || 1700, print: !a['no-print'], atari: !a['no-atari'], atr: !a['no-atr'], xex: !a['no-xex'], textdisk: !a['no-textdisk'], bundle: !a['no-bundle'], cols: +a.cols || 64, slug: a.slug,
  };
  if (!EBC.image.DITHERS.includes(opt.dither)) { console.error('unknown dither ' + opt.dither + ' (' + EBC.image.DITHERS.join(', ') + ')'); return 2; }
  const outDir = path.resolve(a.out || path.join(root, 'out', 'ebookcraft'));
  const r = await EBC.pack.convert(inputs, opt, (m) => process.stderr.write(m + '\n'));
  writeFiles(outDir, r.files);
  console.log('EBookCraft: "' + r.manifest.title + '" -> ' + outDir);
  console.log('  files: ' + r.files.length + ', pages: ' + r.manifest.counts.pages + ', Atari screens: ' + r.manifest.counts.screens + ', text chars: ' + r.manifest.counts.chars);
  if (r.manifest.ocr.requested) console.log('  OCR: ' + (r.manifest.ocr.ran ? 'ran on ' + r.manifest.ocr.pages + ' page(s), mean confidence ' + r.manifest.ocr.meanConfidence : 'did NOT run'));
  for (const m of r.report) console.log('  note: ' + m);
  const targets = [];
  if (a.deploy) targets.push(path.join(root, 'web'));
  if (a.stage) targets.push(path.resolve(a.stage));
  for (const t of targets) {
    writeFiles(t, EBC.pack.deployFiles(r));
    const idx = path.join(t, ...EBC.pack.LIB_ROOT.split('/'), 'index.json');
    let old = []; try { old = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (e) { /* first book */ }
    fs.mkdirSync(path.dirname(idx), { recursive: true });
    fs.writeFileSync(idx, JSON.stringify(EBC.pack.shelfMerge(old, EBC.pack.shelfEntry(r)), null, 1));
    console.log('  deployed to ' + path.join(t, ...EBC.pack.LIB_ROOT.split('/'), r.slug));
  }
  await EBC.ocr.terminate();
  return 0;
}
main().then((c) => process.exit(c || 0), (e) => { console.error('error: ' + e.message); process.exit(1); });
