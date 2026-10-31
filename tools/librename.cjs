// Rename disk images to their DAT (TOSEC) names when the hash matches exactly.
//   node tools/librename.cjs <folder> --dat <dat folder|file>            preview only
//   node tools/librename.cjs <folder> --dat <dats> --apply [--log f.json] rename in place, write undo log
//   node tools/librename.cjs --undo f.json                               restore original names
// Renames stay in the same folder. Nothing is deleted or overwritten.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

if (opt('--undo')) {
  const log = JSON.parse(fs.readFileSync(opt('--undo'), 'utf8'));
  let ok = 0, bad = 0;
  for (const m of log.moves.reverse()) {
    if (fs.existsSync(m.to) && !fs.existsSync(m.from)) { fs.renameSync(m.to, m.from); ok++; } else { bad++; console.log('skipped (changed since):', m.to); }
  }
  console.log(`restored ${ok}, skipped ${bad}`); process.exit(0);
}

const root = args.find((a) => !a.startsWith('--') && a !== opt('--dat') && a !== opt('--log'));
const datArg = opt('--dat');
if (!root || !datArg) { console.log('usage: node tools/librename.cjs <folder> --dat <dats> [--apply] [--log f.json]'); process.exit(1); }
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

const list = fs.statSync(datArg).isDirectory() ? fs.readdirSync(datArg).filter((f) => /\.dat$/i.test(f)).map((f) => path.join(datArg, f)) : [datArg];
const byMd5 = new Map();
for (const f of list) {
  const x = fs.readFileSync(f, 'utf8');
  for (const m of x.matchAll(/<rom name="([^"]*)" size="(\d+)"[^>]*?md5="([0-9a-f]+)"/gi)) if (!byMd5.has(m[3])) byMd5.set(m[3], unesc(m[1]));
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(root).filter((p) => /\.(atr|xfd|atx|dcm|pro|xex|car|rom|bin|cas)$/i.test(p));
const plan = [], skipped = [], claimed = new Set();
for (const p of files) {
  const name = byMd5.get(crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'));
  if (!name) continue;
  const target = path.join(path.dirname(p), safe(name));
  if (path.basename(p) === safe(name)) continue;
  const key = target.toLowerCase();
  if (claimed.has(key) || (fs.existsSync(target) && target.toLowerCase() !== p.toLowerCase())) { skipped.push({ from: p, to: target }); continue; }
  claimed.add(key); plan.push({ from: p, to: target });
}
for (const m of plan) console.log(`${path.basename(m.from)}  ->  ${path.basename(m.to)}`);
for (const s of skipped) console.log(`SKIP (target exists or duplicate): ${path.basename(s.from)} -> ${path.basename(s.to)}`);
console.log(`\n${plan.length} to rename, ${skipped.length} skipped.`);
if (!args.includes('--apply')) { console.log('Preview only. Add --apply to rename.'); process.exit(0); }
const logFile = opt('--log') || `rename-log-${Date.now()}.json`;
fs.writeFileSync(logFile, JSON.stringify({ moves: plan }, null, 1));
for (const m of plan) fs.renameSync(m.from, m.to);
console.log(`renamed ${plan.length}. Undo: node tools/librename.cjs --undo ${logFile}`);
