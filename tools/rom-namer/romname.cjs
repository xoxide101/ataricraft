// Identify console/computer ROM and disk files and propose the canonical extension.
//   node tools/rom-namer/romname.cjs <file|folder>... [--apply]
// Dry run by default. Detection order: header magic, then extension, then headerless size/vector heuristics (marked "guess").
const fs = require('fs'), path = require('path');

const EXT = { '.a26': '2600', '.a52': '5200', '.a78': '7800', '.lnx': 'Lynx', '.j64': 'Jaguar', '.nes': 'NES', '.gb': 'Game Boy', '.gbc': 'Game Boy Color', '.gba': 'Game Boy Advance', '.sms': 'Master System', '.gg': 'Game Gear', '.md': 'Mega Drive', '.sfc': 'SNES', '.atr': 'Atari 8-bit disk', '.xex': 'Atari 8-bit exe', '.car': 'Atari 8-bit cart', '.cas': 'Atari 8-bit tape', '.st': 'Atari ST disk' };
// extensions seen in the wild that map to a canonical one
const ALIAS = { '.bin': null, '.rom': null, '.a2600': '.a26', '.vcs': '.a26', '.a5200': '.a52', '.a7800': '.a78', '.smd': '.md', '.gen': '.md', '.smc': '.sfc', '.xfd': '.atr', '.com': '.xex', '.obj': '.xex' };

function identify(buf, name) {
  const ext = path.extname(name).toLowerCase();
  const s = (o, n) => buf.slice(o, o + n).toString('latin1');
  if (s(1, 9) === 'ATARI7800') return { system: '7800', ext: '.a78', how: 'header' };
  if (s(0, 4) === 'LYNX') return { system: 'Lynx', ext: '.lnx', how: 'header' };
  if (s(0, 4) === 'NES\x1a') return { system: 'NES', ext: '.nes', how: 'header' };
  if (s(0, 4) === 'CART') return { system: 'Atari 8-bit cart', ext: '.car', how: 'header' };
  if (s(0, 4) === 'FUJI') return { system: 'Atari 8-bit tape', ext: '.cas', how: 'header' };
  if (buf.length > 16 && buf[0] === 0x96 && buf[1] === 0x02) return { system: 'Atari 8-bit disk', ext: '.atr', how: 'header' };
  if (buf.length > 6 && buf[0] === 0xff && buf[1] === 0xff) return { system: 'Atari 8-bit exe', ext: '.xex', how: 'header' };
  if (buf.length > 0x150 && buf.slice(0x104, 0x108).equals(Buffer.from([0xce, 0xed, 0x66, 0x66]))) return { system: buf[0x143] & 0x80 ? 'Game Boy Color' : 'Game Boy', ext: buf[0x143] & 0x80 ? '.gbc' : '.gb', how: 'header' };
  if (buf.length > 0x8000 && s(0x7ff0, 8) === 'TMR SEGA') return { system: 'Master System / Game Gear', ext: ext === '.gg' ? '.gg' : '.sms', how: 'header' };
  if (buf.length > 0x200 && /^SEGA/.test(s(0x100, 4))) return { system: 'Mega Drive', ext: '.md', how: 'header' };
  const al = ALIAS[ext];
  if (al) return { system: EXT[al], ext: al, how: 'extension alias' };
  if (EXT[ext]) return { system: EXT[ext], ext, how: 'extension' };
  if (ext !== '.bin' && ext !== '.rom') return null;
  const n = buf.length;
  if (n >= 4) {
    const rv = buf[n - 4] | (buf[n - 3] << 8), v52 = buf[n - 2] | (buf[n - 1] << 8);
    if ((rv & 0x1000) && ((rv >> 13) === 0 || (rv >> 13) === 7) && [2048, 4096, 8192, 12288, 16384, 32768, 65536].includes(n)) return { system: '2600', ext: '.a26', how: 'guess (reset vector)' };
    if (v52 >= 0x4000 && v52 < 0xc000 && [4096, 8192, 16384, 32768].includes(n)) return { system: '5200', ext: '.a52', how: 'guess (start vector)' };
  }
  return { system: 'unknown', ext: null, how: 'no match' };
}

module.exports = { identify };

if (require.main === module) {
  const apply = process.argv.includes('--apply'), args = process.argv.slice(2).filter((a) => a !== '--apply');
  const files = [];
  for (const a of args) { const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach((f) => walk(path.join(p, f))) : files.push(p); walk(a); }
  let changed = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f), r = identify(buf, f);
    if (!r) continue;
    const ext = path.extname(f).toLowerCase(), to = r.ext && r.ext !== ext ? f.slice(0, f.length - path.extname(f).length) + r.ext : null;
    console.log((to ? 'RENAME ' : 'ok     ') + f + (to ? ' -> ' + path.basename(to) : '') + '  [' + r.system + ', ' + r.how + ']');
    if (to && apply && !r.how.startsWith('guess') && !fs.existsSync(to)) { fs.renameSync(f, to); changed++; }
  }
  if (apply) console.log(changed + ' renamed (guesses are never auto-renamed)');
}
