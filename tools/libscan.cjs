// Read-only library scanner. Usage: node tools/libscan.cjs <outdir> <root> [<root>...]
// Writes <outdir>/index.jsonl (one line per file: root, rel path, size, mtime ms) and <outdir>/summary.json.
// Never modifies the scanned folders. Keep <outdir> outside the repo.
const fs = require('fs'), path = require('path');
const [out, ...roots] = process.argv.slice(2);
if (!out || !roots.length) { console.error('usage: node tools/libscan.cjs <outdir> <root>...'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const ws = fs.createWriteStream(path.join(out, 'index.jsonl'));
const sum = {};
let files = 0, errs = 0;
async function walk(root, dir) {
  let d;
  try { d = await fs.promises.opendir(dir); } catch (e) { errs++; return; }
  const subs = [];
  for await (const e of d) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { subs.push(full); continue; }
    if (!e.isFile()) continue;
    let st; try { st = await fs.promises.stat(full); } catch (x) { errs++; continue; }
    const ext = path.extname(e.name).toLowerCase() || '(none)';
    ws.write(JSON.stringify({ r: path.basename(root), p: path.relative(root, full), s: st.size, m: Math.round(st.mtimeMs) }) + '\n');
    const t = (sum[path.basename(root)] ||= { files: 0, bytes: 0, ext: {} });
    t.files++; t.bytes += st.size;
    const x = (t.ext[ext] ||= { n: 0, b: 0 }); x.n++; x.b += st.size;
    if (++files % 20000 === 0) console.log(files, 'files', full.slice(0, 100));
  }
  for (const s of subs) await walk(root, s);
}
(async () => {
  for (const r of roots) { console.log('scanning', r); await walk(r, r); }
  ws.end();
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ when: new Date().toISOString(), files, errors: errs, roots: sum }, null, 1));
  console.log('done', files, 'files,', errs, 'errors');
})();
