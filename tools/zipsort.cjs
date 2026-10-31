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

function writeZip(name, data) {
  const nm = Buffer.from(name, 'utf8'), c = zlib.deflateRawSync(data), crc = zlib.crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
  const off = 30 + nm.length + c.length, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([lh, nm, c, ch, nm, end]);
}

const plan = [], placed = new Map(); let dupes = 0, copies = 0;
const byZip = new Map(); rows.forEach((r) => (byZip.get(r.zip) || byZip.set(r.zip, []).get(r.zip)).push(r));
for (const [zip, rs] of byZip) {
  for (const r of rs) {
    const ext = path.extname(r.file) || '.bin';
    const memberships = new Map();
    for (const a of (r.mameAll || '').split(';;').filter(Boolean)) { const [par, set, d] = a.split('|'); if (!memberships.has(par)) memberships.set(par, d || desc.get(set)); }
    const own = r.mameParent || r.mameSet || zip.replace(/\.zip$/i, '');
    if (!memberships.size) memberships.set(own, r.mameDesc);
    if (!memberships.has(own)) memberships.set(own, r.mameDesc);
    let first = true;
    for (const [parentSet, setDesc] of memberships) {
      const top = safe(desc.get(parentSet) || setDesc || parentSet);
      const base = r.tosec ? r.tosec.replace(/\.[^.]+$/, '') : (r.nointro || setDesc || path.basename(r.file, ext));
      const name = safe(base + (r.tosec ? path.extname(r.tosec) : ext));
      const dir = path.join(out, 'rom', system, medium, top);
      let stem = safe(base), target = path.join(dir, stem + '.zip'), k = 2;
      for (;;) {
        const prev = placed.get(target.toLowerCase());
        if (!prev) break;
        if (prev === r.sha1) { target = null; dupes++; break; }
        target = path.join(dir, `${stem} [${k++}].zip`);
      }
      if (!target) continue;
      placed.set(target.toLowerCase(), r.sha1);
      if (!first) copies++; first = false;
      plan.push({ zip, file: r.file, target, inner: name, top, source: r.tosec ? 'TOSEC' : r.nointro ? 'No-Intro' : 'MAME' });
    }
  }
}
const folders = new Set(plan.map((p) => p.top)); const cnt = {}; plan.forEach((p) => (cnt[p.top] = (cnt[p.top] || 0) + 1));
const multiFolders = Object.values(cnt).filter((n) => n > 1).length;
if (!args.includes('--dry')) {
  for (const [zip] of byZip) {
    const ents = readZip(fs.readFileSync(path.join(root, zip)));
    for (const p of plan.filter((q) => q.zip === zip)) { fs.mkdirSync(path.dirname(p.target), { recursive: true }); fs.writeFileSync(p.target, writeZip(p.inner, ents.get(p.file))); }
  }
  fs.writeFileSync(path.join(out, 'rom', system, medium, '_sort-map.txt'), plan.map((p) => `${p.zip}!${p.file}  ->  ${path.relative(path.join(out, 'rom', system, medium), p.target)}   [${p.source}]`).join('\n'));
}
if (args.includes('--sets')) {
  const sets = new Map(); plan.forEach((p) => (sets.get(p.top) || sets.set(p.top, []).get(p.top)).push(p));
  const sdir = path.join(out, 'sets', system, medium); fs.mkdirSync(sdir, { recursive: true });
  const cache = new Map(); const lines = [];
  for (const [top, ps] of sets) {
    const parts = [], cd = []; let off = 0;
    for (const p of ps) {
      if (!cache.has(p.zip)) cache.clear(), cache.set(p.zip, readZip(fs.readFileSync(path.join(root, p.zip))));
      const data = cache.get(p.zip).get(p.file), nm = Buffer.from(p.inner, 'utf8'), c = zlib.deflateRawSync(data), crc = zlib.crc32(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, nm, c); cd.push(ch, nm); off += 30 + nm.length + c.length;
    }
    const cdb = Buffer.concat(cd), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(ps.length, 8); end.writeUInt16LE(ps.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
    fs.writeFileSync(path.join(sdir, top + '.zip'), Buffer.concat([...parts, cdb, end]));
    lines.push(`${ps.length > 1 ? 'SET       ' : 'INDIVIDUAL'}  ${ps.length}  ${top}`);
  }
  fs.writeFileSync(path.join(sdir, '_classification.txt'), lines.join('\n'));
  console.log(`sets: ${sets.size} set zips written to ${sdir} (${lines.filter((l) => l.startsWith('SET')).length} multi-rom sets, ${lines.filter((l) => l.startsWith('INDIV')).length} individuals)`);
}
console.log(`${args.includes('--dry') ? 'DRY RUN: ' : ''}${plan.length} individual zips into ${folders.size} top-name folders (${multiFolders} hold more than one rom); ${copies} are extra copies of a rom listed under more than one top name; ${dupes} identical duplicates skipped.`);
console.log(`names from: TOSEC ${plan.filter((p) => p.source === 'TOSEC').length}, No-Intro ${plan.filter((p) => p.source === 'No-Intro').length}, MAME ${plan.filter((p) => p.source === 'MAME').length}`);
