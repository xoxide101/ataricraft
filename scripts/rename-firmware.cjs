const fs = require('fs'), path = require('path');
const FW = 'C:/Users/raver/ataricraft/software_n_roms/firmware/';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const mvTo = (f, dir) => { fs.mkdirSync(FW + dir, { recursive: true }); const to = FW + dir + '/' + path.basename(f); fs.renameSync(f, to); return to; };

// 1. fix misplaced files
for (const f of walk(FW)) {
  const b = path.basename(f);
  if (/Rene Rom Images? disk/i.test(b)) mvTo(f, 'Disks and programs/ROM image disks (Rene)');
  else if (/Karin Maxi/i.test(b) && /Peripherals/.test(f)) mvTo(f, 'Drives/Karin Maxi');
  else if (/Karin Maxi/i.test(b) && /Atari 1050/.test(f)) mvTo(f, 'Drives/Karin Maxi');
  else if (/speedy-(bibodos|floppy2000|hss|supercopy)/i.test(b) || /Speedy1\.33n/i.test(b)) mvTo(f, 'Drives/Speedy 1050 variants');
  else if (/Qmeg3\.rom/i.test(b)) mvTo(f, 'OS 8-bit/Replacement OS');
  else if (/Unused/.test(f) && /(Q-Meg 4\.4|Supermon '85|ULTIMON XE)/i.test(b)) mvTo(f, 'OS 8-bit/Replacement OS');
}

const vendors = [
  [/Atari|1450XLD|1400XL|1440XKD|XE130|XE04|XL_XE|XL-XE|810|1050|XF551|1025|1029|815|820|835|850|1030|1090|5200/i, 'Atari'],
  [/Happy/i, 'Happy Computers'], [/Percom|AT-?88|RFD/i, 'Percom'], [/Astra/i, 'Astra'], [/ATR8000/i, 'SWP'],
  [/Karin/i, 'Karin'], [/Indus/i, 'Indus'], [/Q-?Meg/i, 'Quality Micro Group'], [/Omni(mon|view)/i, 'Quality Micro Group (Omni)'],
  [/Speedy|Speeder|megaspeedy|Speedos/i, 'Speedy / Bibo'], [/Black ?Box|bbrom|BB141/i, 'CSS'], [/MIO/i, 'ICD'],
  [/Bit ?3/i, 'Bit 3'], [/Ultimate|U1MB|ultfull/i, 'Ultimate 1MB (FJC)'], [/Rapidus/i, 'Rapidus'],
  [/Highchip|Warp Copy/i, 'Highchip'], [/Supermon|SMON/i, 'Supermon'], [/Turbo|Tygrys|CA2001|Duplicator|Toms|T1050|ISPlate|Archiver|TheChip|Hyper|US Doubler|DTI|Amdek|Bibomon|XOS|Xos|Oldrunner|OSNFast|UHSIO|Os\+\+|Args|HTT/i, 'Third party'],
  [/Diamond/i, 'Reeve Software'], [/Mac65|Action|AWRITER|ASMED/i, 'Third party'],
];
const cryptic = [
  [/^HAPPY\.EPR$/i, 'Happy 1050 Drive ROM (EPROM dump)'], [/^HAPPY\.INH$/i, 'Happy Drive ROM (INH)'], [/^CA2001\.EPR$/i, 'CA2001 Tygrys Turbo 2000 Drive ROM (EPROM dump)'],
  [/^T10504K\.EPR$/i, 'Turbo 1050 4K Drive ROM'], [/^TOMS1050\.EPR$/i, 'Tom\'s 1050 Drive ROM'], [/^PERCOM\.EPR$/i, 'Percom Drive ROM (EPROM dump)'],
  [/^DTIREV5\.EPM$/i, 'DTI Drive ROM rev 5'], [/^Archiver\.rom$/i, '1050 Archiver Drive ROM'], [/^Indus_gt_12\.bin$/i, 'Indus GT Drive ROM v1.2 (alt dump)'],
  [/^ISPlate\.rom$/i, 'ISPlate Drive ROM'], [/^XF551_Turbo\.bin$/i, 'XF551 Turbo Drive ROM'],
  [/^COL80\.OS$/i, 'XL OS ROM with 80-column support'], [/^fastmath\.rom$/i, 'XL OS ROM with fast floating-point'], [/^hires\.rom$/i, 'XL OS ROM with hi-res text'],
  [/^OLD800\.ROM$/i, '800 OS ROM (old)'], [/^SMONBRD\.ROM$/i, 'XL OS ROM with Supermon (board)'], [/^XE04IFRH\.ROM$/i, 'XE OS ROM (Rev 4 variant)'], [/^XE130PAL\.ROM$/i, '130XE OS ROM (PAL)'],
  [/^XLFIX\.ROM$/i, 'XL OS ROM (fixed)'], [/^QMEG\.INH$/i, 'Q-Meg OS ROM (INH)'], [/^SUPERMON\.OS$/i, 'Supermon OS ROM'], [/^TOMS_OS\.ROM$/i, 'Tom\'s OS ROM'],
  [/^SPEEDY\.INH$/i, 'Speedy OS ROM (INH)'], [/^REV2-UHSIO\.ROM$/i, 'XL OS ROM Rev 2 with U.H. SIO'], [/^OSNFast\.bin$/i, 'OS N Fast OS ROM'], [/^OSNFastOmni\.bin$/i, 'OS N Fast OS ROM with Omnimon'],
  [/^Omnimon\.rom$/i, 'Omnimon OS ROM'], [/^Omnimon_rom800\.rom$/i, 'Omnimon OS ROM (800)'], [/^Omniview\.rom$/i, 'Omniview OS ROM'], [/^omniview800_c000\.rom$/i, 'Omniview OS ROM (800, $C000)'],
  [/^Highchip.*\.(rom|inh)$/i, 'Highchip OS ROM'], [/^HIGHCHIP\.ROM/i, 'Highchip OS ROM'], [/^Oldrunner\.ROM$/i, 'Oldrunner OS ROM'], [/^Xos\.rom$/i, 'XOS OS ROM'],
  [/^megaspeedy-(\d+)\.rom$/i, 'MegaSpeedy OS ROM build $1'], [/^speedy-140724\.rom$/i, 'Speedy OS ROM build 140724'],
  [/^BB141\.EPR$/i, 'Black Box v1.41 ROM (EPROM dump)'], [/^bbrom144\.bin$/i, 'Black Box v1.44 ROM'], [/^config\.rom$/i, 'Flash cart config ROM'], [/^flasher\.rom$/i, 'Flash cart flasher ROM'],
  [/^xel\.rom$/i, 'XEL flash ROM'], [/^ultfull\.rom$/i, 'Ultimate 1MB full flash image'], [/^rapidus\.rom$/i, 'Rapidus flash ROM'], [/^32-in-1\.BIN$/i, '32-in-1 cartridge'], [/^Another 32-in-1\.BIN$/i, '32-in-1 cartridge (alt)'],
  [/^PS2JOY\.BIN$/i, 'PS/2 joystick adapter ROM'], [/^atari7800\.rom$/i, 'Atari 7800 BIOS (ROM)'], [/^SIDE 3\.rom$/i, 'SIDE 3 cartridge ROM'], [/^MyIDE-\]\[\.bin$/i, 'MyIDE-II cartridge ROM'],
  [/^ATARIWRI\.INH$/i, 'AtariWriter cartridge (INH)'], [/^Atxerom\.epr$/i, 'ATXE ROM (EPROM dump)'], [/^DIAGCART\.EPR$/i, 'Diagnostic cartridge (EPROM dump)'], [/^Action\.rom$/i, 'Action! language cartridge'],
  [/^ASMED\.R8$/i, 'Assembler Editor cartridge'], [/^AWRITER\.R16$/i, 'AtariWriter cartridge'], [/^Logo_Cartrige\.bin$/i, 'Atari Logo cartridge'], [/^Super_E_Burner\.rom$/i, 'Super E Burner cartridge'],
  [/^Mac65 ver 1\.0\.rom$/i, 'MAC/65 assembler cartridge v1.0'], [/^Atari XEGS Missile Command\.ROM$/i, 'XEGS built-in Missile Command'],
  [/^BASICA\.ROM$/i, 'Atari BASIC rev A (alt)'], [/^Basic XE ver 4_1\.rom$/i, 'BASIC XE v4.1'], [/^Basic XL ver 1_03\.rom$/i, 'BASIC XL v1.03'],
  [/^SDX446s([12])\.rom$/i, 'SpartaDOS X 4.46 flash image (part $1)'], [/^SpartaDosXv419\.bin$/i, 'SpartaDOS X v4.19 cartridge (alt)'],
];
const cls = (f) => /Drives/.test(f) ? 'Drive ROM' : /Replacement OS|OS 8-bit/.test(f) ? 'OS ROM' : /Peripherals|Unused/.test(f) ? 'Device ROM' : /5200/.test(f) ? 'Console OS ROM' : /BASIC/.test(f) ? 'ROM' : 'ROM';
const log = [];
for (const f of walk(FW)) {
  const rel = path.relative(FW, f).replace(/\\/g, '/');
  if (/^(DOS\/|Docs and|INDEX|DOS-RENAME|Disks and|DOS \(zipped|ROMS-RENAME)/.test(rel)) continue;
  const e = path.extname(f), base0 = path.basename(f, e);
  if ((base0.match(/ - /g) || []).length >= 4) continue;
  let b = base0.replace(/^(Firmware|Cartridge|Language) - /, '');
  const type = /^Language/.test(base0) || /BASIC\//.test(rel) ? 'Language' : /Cartridges/.test(rel) ? 'Cartridge' : 'Firmware';
  let note = [];
  const g = b.match(/\[([^\]]*)\]/); if (g) { note.push(g[1]); b = b.replace(/\s*\[[^\]]*\]/, ''); }
  let name = null;
  for (const [re, n] of cryptic) { const m = (b + e).match(re); if (m) { name = n.replace('$1', m[1] || ''); break; } }
  if (!name) name = b;
  let ver = (name.match(/\b(?:rev\.?|ver\.?|v)\s*(\d[\w.]*)/i) || [])[1];
  const isRev = /\brev\.?\s*\d/i.test(name);
  if (ver) name = name.replace(/\b(?:rev\.?|ver\.?|v)\s*\d[\w.]*/i, '').replace(/\s+/g, ' ').trim();
  const year = (b.match(/\((19[78]\d|199\d|20[0-2]\d)\)/) || name.match(/\b(19[78]\d|199\d|20[0-2]\d)\b/) || [])[1];
  if (year) name = name.replace(new RegExp('\\s*\\(?' + year + '\\)?'), '').trim();
  const par = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  name = name.replace(/\s*\([^)]*\)/g, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  note.push(...par);
  let vendor = 'Unknown vendor';
  for (const [re, v] of vendors) if (re.test(b) || re.test(name)) { vendor = v; break; }
  if (!/ROM|cartridge|BASIC|firmware|OS\b|flash/i.test(name) && !type.startsWith('Language')) name += ' ' + cls(rel);
  name = name.replace(/\bfirmware\b/i, 'Firmware ROM').replace(/Firmware ROM ROM/, 'Firmware ROM');
  const out = [type, name, vendor, ver ? (isRev ? 'rev ' : 'v') + ver : 'ver n.d.', year || 'year n.d.'].join(' - ') + (note.length ? ' (' + note.join(', ') + ')' : '') + e;
  const to = path.dirname(f) + '/' + out.replace(/[<>:"/\\|?*]/g, '_');
  if (to !== f && !fs.existsSync(to)) { fs.renameSync(f, to); log.push(path.basename(f) + '  ->  ' + out); }
}
fs.writeFileSync(FW + 'FIRMWARE-RENAME-MAP.txt', log.join('\n') + '\n');
console.log('renamed', log.length);
