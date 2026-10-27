const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = 'C:/Users/raver/ataricraft/';
const SRC = [R + 'out/roms', R + 'software_n_roms/8bit/Bios'];
const DST = R + 'software_n_roms/firmware/';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const clean = (n) => n.replace(/\s*\{[0-9A-Fa-f]{8}\}/g, '').replace(/^\+\s*/, '').replace(/\s+/g, ' ').trim();
const has = (b, o) => [0, 3, 6, 9].every((i) => b[o + i] === 0x4c);
const rules = [
  ['Docs and screenshots', /\.(jpg|jpeg|json|cjs|hash|rar)$/i],
  ['DOS (zipped disk-system releases)', /\.zip$/i],
  ['Cartridges and EPROM images/SpartaDOS X', /spartados ?x|sdx4|^sdx|spartadosx/i],
  ['Cartridges and EPROM images/DOS carts', /instados|mydos v3|smartdos/i],
  ['Cartridges and EPROM images/Diamond GOS', /diamond/i],
  ['Peripherals/Flash, IDE and accelerators', /rapidus|32-in-1|ultfull|^xel|ide\+|kmk|^config\.rom|^flasher|ultimate|u1mb/i],
  ['Peripherals/80-column (Bit 3, XEP80)', /bit 3|full-?view|xep/i],
  ['Peripherals/Printers (820, 822, 825)', /\b82[0-9]\b/],
  ['Peripherals/Modems (835, 1030)', /\b835\b|1030/],
  ['OS 8-bit/1400XL and 1450XLD', /1400xl|1450xld|1450 xld/i],
  ['Drives/Other', /\b815\b|amdek|dti|thechip/i],
  ['Cartridges and EPROM images/Software carts', /action|mac65|asmed|awriter|logo_|burner|missile|\.r8$|\.r16$/i],
  ['Peripherals/Other add-ons', /ps2joy|atari7800/i],
  ['5200 console', /5200/i],
  ['Peripherals/1090 80-column', /1090/i],
  ['Peripherals/1030 modem', /1030/i],
  ['Peripherals/XEP80', /xep80|xep-80/i],
  ['Peripherals/850 interface', /\b850\b|r-?verter/i],
  ['Peripherals/MIO and Black Box', /\bMIO\b|black ?box|bbrom|bb1\d\d/i],
  ['Peripherals/Other add-ons', /ultimate|u1mb|myide|side2?\b|rambo|pbi|sio2|ide[ -]?plus|covox|pokey|votrax|supercart|ramdisk/i],
  ['Drives/Indus GT', /indus/i],
  ['Drives/Atari 810', /\b810\b/i],
  ['Drives/Atari 1050', /1050|top drive|karin|isplate|duplicator|happy|hyper-?xf|us ?doubler|speedy 1050|mini speedy|tygrys|ca2001|archiver/i],
  ['Drives/Atari XF551', /xf551|xf55/i],
  ['Drives/Percom and clones', /percom|astra|rfd|at-?88|atr ?8000/i],
  ['Drives/Other', /drive|turbo|\b10[0-9]{2}\b|ocr|dos\s*2.?5.?drive/i],
  ['OS 8-bit/Replacement OS', /q-?meg|speedy|speeder|speedos|os\+\+|xos|omni|supermon|bibomon|ultimon|highchip|warp|oldrun|pud|toms|ramrod|args|osnfast|uhsio|jammer|fujiself/i],
];
const seen = new Map();
const rows = [];
for (const root of SRC) for (const f of walk(root)) {
  const b = fs.readFileSync(f);
  const h = crypto.createHash('sha1').update(b).digest('hex');
  if (seen.has(h)) continue;
  seen.set(h, 1);
  const n = clean(path.basename(f));
  const ext = path.extname(n).toLowerCase();
  if (/^(readme|license|licence)/i.test(n) || ['.md', '.txt', '.webp', '.png', '.gitattributes', '.xls', '.pdf'].includes(ext)) continue;
  let cat = null;
  for (const [c, re] of rules) if (re.test(n) || re.test(path.basename(path.dirname(f)))) { cat = c; break; }
  if (!cat) {
    if (b.length === 10240 && has(b, 0xc50)) cat = 'OS 8-bit/Atari 400-800';
    else if (b.length === 16384 && has(b, 0x2450)) cat = 'OS 8-bit/Atari XL-XE-XEGS';
    else if (b.length === 8192 && /basic/i.test(n)) cat = 'BASIC';
    else if (/basic/i.test(n)) cat = 'BASIC';
    else if (['.atr', '.xex', '.com', '.dcm', '.xfd'].includes(ext)) cat = 'Disks and programs';
    else if (['.car', '.epr', '.inh', '.cart'].includes(ext)) cat = 'Cartridge and EPROM images';
    else cat = 'Unsorted/' + b.length + ' bytes';
  } else if (cat === 'OS 8-bit/Replacement OS' && b.length === 16384 && !has(b, 0x2450)) cat = 'Peripherals/Other add-ons';
  const dir = DST + cat + '/';
  fs.mkdirSync(dir, { recursive: true });
  let dest = dir + n;
  if (fs.existsSync(dest)) dest = dir + path.basename(n, ext) + '_' + h.slice(0, 6) + ext;
  fs.copyFileSync(f, dest);
  rows.push([cat, path.basename(dest), b.length, h]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const by = {};
rows.forEach((r) => (by[r[0]] = (by[r[0]] || 0) + 1));
fs.writeFileSync(DST + 'INDEX.txt', 'category\tfile\tbytes\tsha1\n' + rows.map((r) => r.join('\t')).join('\n') + '\n');
console.log(rows.length, 'unique files');
Object.entries(by).sort().forEach(([k, v]) => console.log(String(v).padStart(4), k));
