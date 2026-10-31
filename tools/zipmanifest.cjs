// Pass 1: identify every file inside every zip and write a manifest (CSV + JSON). Read-only.
//   node tools/zipmanifest.cjs <zip folder> --dat <tosec dats> --match "Atari 2600" --nointro <crc dat> --mame <softlist.xml> --out <manifest base>
// Per file: crc32/sha1/md5, the MAME set that lists it (and its parent), TOSEC name (md5), No-Intro name (crc).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const root = args[0], datArg = opt('--dat'), match = opt('--match') || '', outBase = opt('--out');
if (!root || !outBase) { console.log('usage: see header'); process.exit(1); }
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function readZip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const ents = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lh = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(lh, lh + csize);
    ents.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
  }
  return ents;
}
const tosec = new Map();
if (datArg) for (const f of fs.readdirSync(datArg).filter((f) => /\.dat$/i.test(f) && f.startsWith(match)))
  for (const m of fs.readFileSync(path.join(datArg, f), 'utf8').matchAll(/<rom name="([^"]*)" size="(\d+)"[^>]*?md5="([0-9a-f]+)"/gi)) if (!tosec.has(m[3])) tosec.set(m[3], unesc(m[1]));
const nointro = new Map();
if (opt('--nointro')) for (const m of fs.readFileSync(opt('--nointro'), 'utf8').matchAll(/comment "([^"]*)"[\s\S]*?rom \( crc ([0-9A-F]+) \)/g)) nointro.set(m[2].toLowerCase(), m[1]);
const mameByCrc = new Map();
if (opt('--mame')) for (const m of fs.readFileSync(opt('--mame'), 'utf8').matchAll(/<software name="([^"]+)"(?: cloneof="([^"]+)")?[^>]*>([\s\S]*?)<\/software>/g)) {
  const desc = unesc((m[3].match(/<description>([^<]*)/) || [])[1] || '');
  for (const c of m[3].matchAll(/<rom [^>]*crc="([0-9a-f]+)"/g)) (mameByCrc.get(c[1]) || mameByCrc.set(c[1], []).get(c[1])).push({ set: m[1], parent: m[2] || '', desc });
}

const rows = [];
for (const f of fs.readdirSync(root).filter((x) => /\.zip$/i.test(x)).sort()) {
  const short = f.replace(/\.zip$/i, '');
  for (const e of readZip(fs.readFileSync(path.join(root, f)))) {
    const crc = zlib.crc32(e.data).toString(16).padStart(8, '0'), md5 = crypto.createHash('md5').update(e.data).digest('hex');
    const mm = mameByCrc.get(crc) || [];
    const own = mm.find((x) => x.set === short || x.parent === short) || mm[0];
    rows.push({ zip: f, file: e.name, size: e.data.length, crc32: crc, sha1: crypto.createHash('sha1').update(e.data).digest('hex'), md5,
      mameSet: own ? own.set : '', mameParent: own ? own.parent : '', mameDesc: own ? own.desc : '', tosec: tosec.get(md5) || '', nointro: nointro.get(crc) || '',
      mameOwn: own ? (own.set === short || own.parent === short || short === own.set) : false });
  }
}
fs.writeFileSync(outBase + '.json', JSON.stringify(rows, null, 1));
const cols = Object.keys(rows[0]);
fs.writeFileSync(outBase + '.csv', [cols.join(',')].concat(rows.map((r) => cols.map((c) => '"' + String(r[c]).replace(/"/g, '""') + '"').join(','))).join('\r\n'));
const zips = new Set(rows.map((r) => r.zip)).size;
const noId = rows.filter((r) => !r.mameSet && !r.tosec && !r.nointro);
console.log(`${zips} zips, ${rows.length} files. identified by: MAME ${rows.filter((r) => r.mameSet).length}, TOSEC ${rows.filter((r) => r.tosec).length}, No-Intro ${rows.filter((r) => r.nointro).length}; unidentified by any: ${noId.length}`);
const multi = {}; rows.forEach((r) => (multi[r.zip] = (multi[r.zip] || 0) + 1));
console.log(`zips with more than one file: ${Object.values(multi).filter((n) => n > 1).length}`);
