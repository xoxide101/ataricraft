// Pass 2: build rom/<system>/<medium>/<top name>/<rom name> from the pass-1 manifest. Copies only; the source zips are untouched.
//   node tools/zipsort.cjs <zip folder> --manifest <m.json> --mame <softlist.xml> --out <dest root> [--system "Atari 2600"] [--medium Cartridge] [--dry]
// Top name = the MAME parent set's title (clones and splits of the same game share one folder).
// Rom name = TOSEC name, else No-Intro name, else the MAME title of the set that lists the file.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = args[0], man = opt('--manifest'), mame = opt('--mame'), out = opt('--out'), system = opt('--system', 'Atari 2600'), medium = opt('--medium', 'Cartridge');
if (!root || !man || !mame || !out) { console.log('usage: see header'); process.exit(1); }
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() || '_';

const desc = new Map();
for (const m of fs.readFileSync(mame, 'utf8').matchAll(/<software name="([^"]+)"[^>]*>[\s\S]*?<description>([^<]*)/g)) desc.set(m[1], unesc(m[2]));
const rows = JSON.parse(fs.readFileSync(man, 'utf8'));

function readZip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const ents = new Map();
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lh = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(lh, lh + csize);
    ents.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
  }
  return ents;
}

const plan = [], placed = new Map(); let dupes = 0;
const byZip = new Map(); rows.forEach((r) => (byZip.get(r.zip) || byZip.set(r.zip, []).get(r.zip)).push(r));
for (const [zip, rs] of byZip) {
  for (const r of rs) {
    const parentSet = r.mameParent || r.mameSet || zip.replace(/\.zip$/i, '');
    const top = safe(desc.get(parentSet) || r.mameDesc || parentSet);
    const ext = path.extname(r.file) || '.bin';
    const name = safe(r.tosec || ((r.nointro || r.mameDesc || path.basename(r.file, ext)) + ext));
    const dir = path.join(out, 'rom', system, medium, top);
    let target = path.join(dir, name), k = 2;
    for (;;) {
      const prev = placed.get(target.toLowerCase());
      if (!prev) break;
      if (prev === r.sha1) { target = null; dupes++; break; }
      const b = path.extname(name); target = path.join(dir, name.slice(0, name.length - b.length) + ` [${k++}]` + b);
    }
    if (!target) continue;
    placed.set(target.toLowerCase(), r.sha1);
    plan.push({ zip, file: r.file, target, top, source: r.tosec ? 'TOSEC' : r.nointro ? 'No-Intro' : 'MAME' });
  }
}
const folders = new Set(plan.map((p) => p.top)), single = new Set(); const cnt = {}; plan.forEach((p) => (cnt[p.top] = (cnt[p.top] || 0) + 1));
const multiFolders = Object.values(cnt).filter((n) => n > 1).length;
if (!args.includes('--dry')) {
  for (const [zip, rs] of byZip) {
    const ents = readZip(fs.readFileSync(path.join(root, zip)));
    for (const p of plan.filter((q) => q.zip === zip)) { fs.mkdirSync(path.dirname(p.target), { recursive: true }); fs.writeFileSync(p.target, ents.get(p.file)); }
  }
  fs.writeFileSync(path.join(out, 'rom', system, medium, '_sort-map.txt'), plan.map((p) => `${p.zip}!${p.file}  ->  ${path.relative(path.join(out, 'rom', system, medium), p.target)}   [${p.source}]`).join('\n'));
}
console.log(`${args.includes('--dry') ? 'DRY RUN: ' : ''}${plan.length} files into ${folders.size} top-name folders (${multiFolders} folders hold more than one rom, ${folders.size - multiFolders} hold a single rom); ${dupes} identical duplicates skipped.`);
console.log(`names from: TOSEC ${plan.filter((p) => p.source === 'TOSEC').length}, No-Intro ${plan.filter((p) => p.source === 'No-Intro').length}, MAME ${plan.filter((p) => p.source === 'MAME').length}`);
