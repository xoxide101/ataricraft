// Installs the optional OCR add-on (tesseract.js + English LSTM data) next to the app. Needs Node + npm and network ONCE; afterwards everything runs offline.
//   node scripts/ebookcraft-install-ocr.cjs [--from <dir with node_modules>]   (--from: copy from an existing npm install, no network)
// Licence: tesseract.js, tesseract.js-core and tesseract.js-data are Apache-2.0. Files are gitignored, not committed.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const nodeDir = path.join(root, 'tools', 'ebookcraft', 'ocr');
const webDir = path.join(root, 'web', 'js', 'ebookcraft', 'ocr');
const i = process.argv.indexOf('--from');
fs.mkdirSync(nodeDir, { recursive: true });
if (i > 0) {
  const src = path.resolve(process.argv[i + 1]);
  fs.cpSync(path.join(src, 'node_modules'), path.join(nodeDir, 'node_modules'), { recursive: true });
} else {
  fs.writeFileSync(path.join(nodeDir, 'package.json'), JSON.stringify({ name: 'ebookcraft-ocr', private: true, version: '1.0.0' }));
  const r = cp.spawnSync('npm', ['install', '--no-audit', '--no-fund', 'tesseract.js@7', 'tesseract.js-core@7', '@tesseract.js-data/eng'], { cwd: nodeDir, stdio: 'inherit', shell: true });
  if (r.status !== 0) { console.error('npm install failed'); process.exit(1); }
}
const nm = path.join(nodeDir, 'node_modules');
const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
copy(path.join(nm, 'tesseract.js', 'dist', 'tesseract.min.js'), path.join(webDir, 'tesseract.min.js'));
copy(path.join(nm, 'tesseract.js', 'dist', 'worker.min.js'), path.join(webDir, 'worker.min.js'));
copy(path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), path.join(webDir, 'lang', 'eng.traineddata.gz'));
const core = path.join(nm, 'tesseract.js-core');
for (const f of fs.readdirSync(core)) if (/^tesseract-core.*lstm.*\.(js|wasm)$/.test(f)) copy(path.join(core, f), path.join(webDir, 'core', f));
let n = 0, bytes = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(webDir);
console.log('OCR add-on installed: ' + n + ' browser files, ' + (bytes / 1048576).toFixed(1) + ' MB in web/js/ebookcraft/ocr/ (gitignored)');
