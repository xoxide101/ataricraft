// Build reference DATs from files you already have: node tools/makedat.cjs <folder> --name "Atari 7800 - Library" --out <dat folder> [--ext a78]
// Writes two Logiqx DATs: "<name>.dat" (whole files) and "<name> (payload).dat" (A78 header stripped, for headerless ROM sets), plus a CSV.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = args[0], name = opt('--name', path.basename(root || 'library')), out = opt('--out', 'out/dats/mine'), ext = opt('--ext', '');
if (!root) { console.log('usage: node tools/makedat.cjs <folder> --name <name> --out <folder> [--ext a78]'); process.exit(1); }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(root).filter((p) => !ext || p.toLowerCase().endsWith('.' + ext.toLowerCase()));
const h = (a, b) => crypto.createHash(a).update(b).digest('hex'), c32 = (b) => zlib.crc32(b).toString(16).padStart(8, '0');
const whole = [], payload = [], csv = ['file,size,crc32,md5,sha1,header,payloadSize,payloadCrc32,payloadMd5'];
for (const p of files) {
  const b = fs.readFileSync(p), base = path.basename(p), hdr = b.length > 128 && b.toString('latin1', 1, 10) === 'ATARI7800';
  const body = hdr ? b.subarray(128) : b;
  whole.push(`\t<game name="${esc(base)}">\n\t\t<description>${esc(base)}</description>\n\t\t<rom name="${esc(base)}" size="${b.length}" crc="${c32(b)}" md5="${h('md5', b)}" sha1="${h('sha1', b)}"/>\n\t</game>`);
  if (hdr) payload.push(`\t<game name="${esc(base)}">\n\t\t<description>${esc(base)}</description>\n\t\t<rom name="${esc(base)}" size="${body.length}" crc="${c32(body)}" md5="${h('md5', body)}" sha1="${h('sha1', body)}"/>\n\t</game>`);
  csv.push([path.relative(root, p), b.length, c32(b), h('md5', b), h('sha1', b), hdr ? 'A78' : '', body.length, c32(body), h('md5', body)].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
}
const dat = (n, g) => `<?xml version="1.0"?>\n<datafile>\n\t<header><name>${esc(n)}</name><description>${esc(n)}</description><comment>built from local files</comment></header>\n${g.join('\n')}\n</datafile>\n`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, name + '.dat'), dat(name, whole));
if (payload.length) fs.writeFileSync(path.join(out, name + ' (payload).dat'), dat(name + ' (payload)', payload));
fs.writeFileSync(path.join(out, name + '.csv'), csv.join('\r\n'));
console.log(`${files.length} files hashed -> ${out} (${payload.length} headered, payload DAT ${payload.length ? 'written' : 'skipped'})`);
