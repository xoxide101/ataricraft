// Rebuild short-named ROM zips (MAME style) with long DAT (TOSEC) names. Never touches the source folder.
//   node tools/ziprename.cjs <zip folder> --dat <dat folder|file> --out <new folder> [--match "Atari 2600"]
// Each zip is matched by the MD5 of the files inside. A matched zip is rewritten as "<DAT name>.zip"
// with its matched files renamed to the DAT names. Unmatched zips are listed and left out.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const root = args[0], datArg = opt('--dat'), out = opt('--out'), match = opt('--match') || '';
if (!root || !datArg || !out) { console.log('usage: node tools/ziprename.cjs <zip folder> --dat <dats> --out <folder> [--match "Atari 2600"]'); process.exit(1); }
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

const dats = (fs.statSync(datArg).isDirectory() ? fs.readdirSync(datArg).filter((f) => /\.dat$/i.test(f) && f.startsWith(match)).map((f) => path.join(datArg, f)) : [datArg]);
const byMd5 = new Map();
for (const f of dats) {
  const x = fs.readFileSync(f, 'utf8');
  for (const m of x.matchAll(/<rom name="([^"]*)" size="(\d+)"[^>]*?md5="([0-9a-f]+)"/gi)) if (!byMd5.has(m[3])) byMd5.set(m[3], unesc(m[1]));
}

function readZip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const ents = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lh = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(lh, lh + csize);
    ents.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
  }
  return ents;
}
function writeZip(ents) {
  const parts = [], cd = []; let off = 0;
  for (const e of ents) {
    const nm = Buffer.from(e.name, 'utf8'), c = zlib.deflateRawSync(e.data), crc = zlib.crc32(e.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, c); cd.push(ch, nm); off += 30 + nm.length + c.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(ents.length, 8); end.writeUInt16LE(ents.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}

fs.mkdirSync(out, { recursive: true });
const used = new Set(), done = [], none = [], partial = [];
for (const f of fs.readdirSync(root).filter((x) => /\.zip$/i.test(x)).sort()) {
  let ents; try { ents = readZip(fs.readFileSync(path.join(root, f))); } catch (e) { none.push(f + ' (unreadable)'); continue; }
  const hits = ents.map((e) => byMd5.get(crypto.createHash('md5').update(e.data).digest('hex')) || null);
  const first = hits.find(Boolean);
  if (!first) { none.push(f); continue; }
  if (hits.some((h) => !h)) partial.push(f);
  let target = safe(first.replace(/\.[^.]+$/, '')) + '.zip', k = 2;
  while (used.has(target.toLowerCase())) target = safe(first.replace(/\.[^.]+$/, '')) + ` [${k++}].zip`;
  used.add(target.toLowerCase());
  const renamed = ents.map((e, i) => ({ name: hits[i] ? safe(hits[i]) : path.basename(e.name), data: e.data }));
  fs.writeFileSync(path.join(out, target), writeZip(renamed));
  done.push(`${f}  ->  ${target}`);
}
fs.writeFileSync(path.join(out, '_renamed.txt'), done.join('\n') + '\n\nNOT MATCHED:\n' + none.join('\n') + '\n');
if (args.includes('--list')) done.forEach((d) => console.log(d));
console.log(`\n${done.length} rebuilt into ${out}; ${none.length} not found in the DATs (left out); ${partial.length} had some files not in the DATs (kept under their own names).`);
console.log(`Full old -> new list and unmatched names: ${path.join(out, '_renamed.txt')} (or add --list to print).`);
