// Build a clean, plainly named ROM set (long TOSEC names, canonical extensions) for an SD card or RetroArch library.
//   node tools/rom-namer/build-set.cjs --src <folder with TOSEC zips> --out <folder> [--apply] [--all] [--no-proto]
// Dry run by default. Reads each "Atari <system> - Games (TOSEC-...)" zip directly (no extraction step) and writes one folder per system:
//   <out>\Atari - 2600\*.a26     <out>\Atari - 2600 - Paddle\*.a26     (same for 5200 .a52, 7800 .a78, Lynx .lnx)
// Bad dumps, hacks, trained/cracked/modified/overdumped and alternate copies ([b] [h] [t] [cr] [m] [o] [a]) are skipped unless --all.
// The paddle folder is chosen by title (the ROM files do not say which controller a game uses); edit PADDLE below to taste.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const SYSTEMS = [
  { id: '2600', match: /Atari 2600.*- Games/i, ext: '.a26', from: ['.a26', '.bin'], dir: 'Atari - 2600' },
  { id: '5200', match: /Atari 5200 - Games/i, ext: '.a52', from: ['.a52', '.bin'], dir: 'Atari - 5200' },
  { id: '7800', match: /Atari 7800 - Games/i, ext: '.a78', from: ['.a78'], dir: 'Atari - 7800' },
  { id: 'Lynx', match: /Atari Lynx - Games - \[LNX\]/i, ext: '.lnx', from: ['.lnx'], dir: 'Atari - Lynx' },
  { id: 'Jaguar', match: /Atari Jaguar - Games - \[J64\]/i, ext: '.j64', from: ['.j64'], dir: 'Atari - Jaguar' },
  { id: '8bit', match: /Atari 8bit - Games - \[ATR\]/i, ext: '.atr', from: ['.atr'], dir: 'Atari - 8-bit' },
];
// Titles (lower case, start of name) that are played with paddles. Only listed systems get a paddle folder.
const PADDLE = {
  '2600': ['breakout', 'super breakout', 'kaboom', 'video olympics', 'warlords', 'circus atari', 'canyon bomber', 'night driver', 'steeplechase', 'casino', 'poker plus', 'blackjack', 'woody pop', 'off the wall', 'bachelor party', 'gigolo', 'paddle'],
  '5200': ['super breakout', 'breakout', 'paddle'],
  '7800': ['paddle'],
  'Lynx': [],
  'Jaguar': [],
  '8bit': ['paddle'],
};
const BAD = /\[(b|h|t|o|cr|m|a)\d*(?:\s[^\]]*)?\]/i;

function readZip(file) {
  const buf = fs.readFileSync(file);
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip: ' + file);
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flag = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString(flag & 0x800 ? 'utf8' : 'latin1');
    out.push({ name, method, csize, size, off });
    p += 46 + nl + xl + cl;
  }
  return { buf, entries: out };
}
function extract(z, en) {
  const b = z.buf, ln = b.readUInt16LE(en.off + 26), lx = b.readUInt16LE(en.off + 28), s = en.off + 30 + ln + lx, raw = b.slice(s, s + en.csize);
  if (en.method === 0) return raw;
  if (en.method === 93) { if (!zlib.zstdDecompressSync) throw new Error('Zstandard zip: needs Node 22.15 or newer'); return zlib.zstdDecompressSync(raw); }
  return zlib.inflateRawSync(raw);
}
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
const isPaddle = (sys, title) => PADDLE[sys].some((k) => title.toLowerCase().startsWith(k) || (k === 'paddle' && /paddle/i.test(title)));

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const src = arg('--src'), out = arg('--out'), apply = a.includes('--apply'), all = a.includes('--all'), noProto = a.includes('--no-proto');
  if (!src || !out) { console.log('usage: node tools/rom-namer/build-set.cjs --src <folder with TOSEC zips> --out <folder> [--apply] [--all] [--no-proto]'); process.exit(1); }
  const zips = []; const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach((f) => walk(path.join(p, f))) : /\.zip$/i.test(p) && zips.push(p); walk(src);
  for (const sys of SYSTEMS) {
    const zf = zips.filter((z) => sys.match.test(path.basename(z)));
    if (!zf.length) { console.log(sys.id + ': no matching zip found'); continue; }
    const seen = new Set(); let kept = 0, paddle = 0, tapes = 0, skipped = 0, written = 0;
    for (const f of zf) {
      const z = readZip(f);
      for (const en of z.entries) {
        const base = path.posix.basename(en.name), ext = path.extname(base).toLowerCase();
        if (!sys.from.includes(ext) || en.name.endsWith('/')) continue;
        const stem = base.slice(0, base.length - ext.length);
        if ((!all && BAD.test(stem)) || (noProto && /\((proto|beta|demo)\b/i.test(stem))) { skipped++; continue; }
        const key = stem.toLowerCase(); if (seen.has(key)) { skipped++; continue; } seen.add(key);
        const sc = sys.id === '2600' && /supercharger/i.test(stem), pad = !sc && isPaddle(sys.id, stem);
        const dir = path.join(out, sys.dir + (sc ? ' - Supercharger' : pad ? ' - Paddle' : '')), to = path.join(dir, safe(stem) + sys.ext);
        kept++; if (pad) paddle++; if (sc) tapes++;
        if (apply) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(to, extract(z, en)); written++; }
      }
    }
    console.log(`${sys.id}: ${kept} ROMs (${paddle} paddle${tapes ? ', ' + tapes + ' Supercharger' : ''}), ${skipped} skipped${apply ? ', ' + written + ' written' : ' (dry run)'}`);
  }
}
module.exports = { readZip, extract, isPaddle, BAD };
