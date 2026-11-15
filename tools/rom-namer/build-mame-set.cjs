// Build long-named ROM sets from MAME software-list zips, using the softlist XML (MAME's hash folder) for titles.
//   node tools/rom-namer/build-mame-set.cjs --zips <"Software List ROMs (merged)" folder> --hash <MAME hash folder> --out <folder> [--apply] [--clones] [--only nes,gb,...]
// Dry run by default; never writes next to the sources. One folder per system:
//   <out>\Nintendo - NES\*.nes   Nintendo - Game Boy\*.gb   Nintendo - Game Boy Color\*.gbc   Nintendo - Game Boy Advance\*.gba
//   Sega - Genesis\*.md   Sega - Master System\*.sms   Sega - Game Gear\*.gg
// Parents only unless --clones. NES ROMs are stored headerless in MAME, so an iNES header is built from the softlist
// (mapper from the cart slot, mirroring, battery RAM); carts with a slot not in MAPPER below are counted and skipped.
// Intellivision (address-split ROMs) and Sega CD (CHD) are not handled here; see the bios / chd helpers in docs/CONSOLES.md.
const fs = require('fs'), path = require('path');
const { readZip, extract } = require('./build-set.cjs');

const SYSTEMS = [
  { id: 'nes', list: 'nes', dir: 'Nintendo - NES', ext: '.nes' },
  { id: 'gb', list: 'gameboy', dir: 'Nintendo - Game Boy', ext: '.gb' },
  { id: 'gbc', list: 'gbcolor', dir: 'Nintendo - Game Boy Color', ext: '.gbc' },
  { id: 'gba', list: 'gba', dir: 'Nintendo - Game Boy Advance', ext: '.gba' },
  { id: 'genesis', list: 'megadriv', dir: 'Sega - Genesis', ext: '.md' },
  { id: 'sms', list: 'sms', dir: 'Sega - Master System', ext: '.sms' },
  { id: 'gg', list: 'gamegear', dir: 'Sega - Game Gear', ext: '.gg' },
];
// MAME NES cart slot -> iNES mapper number (unambiguous ones only).
const MAPPER = {
  nrom: 0, sxrom: 1, sxrom_a: 1, sorom: 1, szrom: 1, uxrom: 2, unrom_cc: 2, cnrom: 3, txrom: 4, hkrom: 4, txsrom: 118, tqrom: 119,
  exrom: 5, axrom: 7, pxrom: 9, fxrom: 10, namcot_163: 19, ss88006: 18, g101: 32, tc0190fmc: 33, bnrom: 34, nina001: 34,
  h3001: 65, gxrom: 66, jf11: 66, sunsoft3: 67, sunsoft4: 68, sunsoft_fme7: 69, sunsoft5a: 69, sunsoft5b: 69, vrc1: 75,
  nina006: 79, x1_005: 80, vrc7: 85, jf13: 86, namcot_3433: 88, sunsoft2: 89, fcg: 16, lz93d50: 16, sunsoft1: 184,
};
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function parseSoftlist(file) {
  const t = fs.readFileSync(file, 'latin1'), out = [], re = /<software name="([^"]+)"([^>]*)>([\s\S]*?)<\/software>/g; let m;
  while ((m = re.exec(t))) {
    const cl = /cloneof="([^"]+)"/.exec(m[2]), body = m[3];
    const desc = /<description>([\s\S]*?)<\/description>/.exec(body); if (!desc) continue;
    const slot = /<feature name="slot" value="([^"]+)"/.exec(body), mir = /<feature name="mirroring" value="([^"]+)"/.exec(body);
    const areas = []; const ar = /<dataarea name="([^"]+)"[^>]*>([\s\S]*?)<\/dataarea>/g; let a;
    while ((a = ar.exec(body))) {
      const roms = []; const rr = /<rom name="([^"]+)"([^>]*)>/g; let r;
      while ((r = rr.exec(a[2]))) if (!/nodump/.test(r[2])) roms.push(r[1]);
      areas.push({ name: a[1], roms });
    }
    out.push({ name: m[1], cloneof: cl && cl[1], title: unesc(desc[1]).trim(), slot: slot && slot[1], mirroring: mir && mir[1], areas });
  }
  return out;
}

function inesHeader(prg, chr, mapper, mirroring, battery) {
  const h = Buffer.alloc(16); h.write('NES\x1a', 0, 'latin1'); h[4] = prg / 16384; h[5] = chr / 8192;
  h[6] = ((mapper & 15) << 4) | (mirroring === 'vertical' ? 1 : 0) | (battery ? 2 : 0) | (mirroring === '4screen' ? 8 : 0); h[7] = mapper & 0xf0;
  return h;
}
const swap16 = (b) => { const o = Buffer.from(b); for (let i = 0; i + 1 < o.length; i += 2) { o[i] = b[i + 1]; o[i + 1] = b[i]; } return o; };

function build(sys, sw, z, find) {
  const get = (names) => { const parts = []; for (const n of names) { const en = find(n); if (!en) return null; parts.push(extract(z, en)); } return Buffer.concat(parts); };
  if (sys.id === 'nes') {
    const mapper = MAPPER[sw.slot]; if (mapper === undefined) return { skip: 'mapper ' + sw.slot };
    const prgA = sw.areas.find((a) => a.name === 'prg'), chrA = sw.areas.find((a) => a.name === 'chr');
    if (!prgA || !prgA.roms.length) return { skip: 'no prg' };
    const prg = get(prgA.roms), chr = chrA && chrA.roms.length ? get(chrA.roms) : Buffer.alloc(0);
    if (!prg || !chr) return { skip: 'missing file' };
    if (prg.length % 16384 || chr.length % 8192) return { skip: 'odd size' };
    const battery = sw.areas.some((a) => a.name === 'bwram');
    return { data: Buffer.concat([inesHeader(prg.length, chr.length, mapper, sw.mirroring, battery), prg, chr]) };
  }
  const roms = sw.areas.flatMap((a) => a.roms); if (roms.length !== 1) return { skip: 'multi-file' };
  let d = get(roms); if (!d) return { skip: 'missing file' };
  if (sys.id === 'genesis') {
    const sega = (b) => b.length > 0x104 && /^(SEGA|ESAG)/.test(b.toString('latin1', 0x100, 0x104));
    if (!sega(d)) return { skip: 'not a plain Genesis image' };
    if (d.toString('latin1', 0x100, 0x104) === 'ESAG') d = swap16(d);
  }
  return { data: d };
}

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const zips = arg('--zips'), hash = arg('--hash'), out = arg('--out'), apply = a.includes('--apply'), clones = a.includes('--clones');
  const only = arg('--only') ? arg('--only').split(',') : null;
  if (!zips || !hash || !out) { console.log('usage: node tools/rom-namer/build-mame-set.cjs --zips <folder> --hash <hash folder> --out <folder> [--apply] [--clones] [--only nes,gb,gbc,gba,genesis,sms,gg]'); process.exit(1); }
  for (const sys of SYSTEMS) {
    if (only && !only.includes(sys.id)) continue;
    const xml = path.join(hash, sys.list + '.xml'), zdir = path.join(zips, sys.list);
    if (!fs.existsSync(xml) || !fs.existsSync(zdir)) { console.log(sys.id + ': missing ' + (fs.existsSync(xml) ? zdir : xml)); continue; }
    const used = new Set(), why = {}; let ok = 0, nozip = 0, written = 0;
    for (const sw of parseSoftlist(xml)) {
      if (sw.cloneof && !clones) continue;
      const zf = path.join(zdir, (sw.cloneof || sw.name) + '.zip'); if (!fs.existsSync(zf)) { nozip++; continue; }
      const z = readZip(zf), prefix = sw.cloneof ? sw.name.toLowerCase() + '/' : '';
      const find = (n) => z.entries.find((e) => e.name.toLowerCase() === prefix + n.toLowerCase());
      const r = build(sys, sw, z, find); if (r.skip) { why[r.skip] = (why[r.skip] || 0) + 1; continue; }
      let base = safe(sw.title), k = 2; while (used.has(base.toLowerCase())) base = safe(sw.title) + ' (' + k++ + ')'; used.add(base.toLowerCase());
      ok++; if (apply) { const dir = path.join(out, sys.dir); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, base + sys.ext), r.data); written++; }
    }
    const sk = Object.entries(why).map(([k, v]) => v + ' ' + k).join(', ');
    console.log(`${sys.id}: ${ok} ROMs${nozip ? ', ' + nozip + ' without a zip' : ''}${sk ? ', skipped: ' + sk : ''}${apply ? ', ' + written + ' written' : ' (dry run)'}`);
  }
}
module.exports = { parseSoftlist, inesHeader, MAPPER };
