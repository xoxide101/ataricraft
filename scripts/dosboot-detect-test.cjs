// Unit test for DOS detection (web/js/dosboot.js detect + tools/dosboot/scan.cjs): synthetic boot sectors + directories (always run)
// and, when the local disk collections exist, the real images (ignored by git, skipped when absent).
// Usage: node scripts/dosboot-detect-test.cjs
const fs = require('fs'), path = require('path');
const DB = require('../web/js/dosboot.js');
const { scan } = require('../tools/dosboot/scan.cjs');
const R = path.resolve(__dirname, '..');
let fail = 0, n = 0;
const eq = (what, got, want) => { n++; if (got !== want) { fail++; console.log('FAIL', what, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };

function image(header, files, bootText) {
  const sectors = 720, b = new Uint8Array(16 + sectors * 128);
  b[0] = 0x96; b[1] = 0x02; b[2] = (sectors * 8) & 255; b[3] = (sectors * 8) >> 8; b[4] = 128;
  const sec = (s) => 16 + (s - 1) * 128;
  header.forEach((v, i) => { b[sec(1) + i] = v; });
  if (bootText) for (let i = 0; i < bootText.length; i++) b[sec(2) + i] = bootText.charCodeAt(i);
  files.forEach((f, i) => {
    const o = sec(361) + i * 16; b[o] = 0x42;
    const [nm, ext = ''] = f.split('.'); const s = (nm.padEnd(8) + ext.padEnd(3));
    for (let k = 0; k < 11; k++) b[o + 5 + k] = s.charCodeAt(k);
  });
  return b;
}
const det = (h, f, t) => DB.detect(image(h, f, t), []);
const H = (s) => s.match(/../g).map((x) => parseInt(x, 16));

// DOS 1.0: one boot sector, init $1300, DOS.SYS only
let d = det(H('0001000700134c12'), ['DOS.SYS']);
eq('DOS 1.0 family', d.family, 'atari-dos1'); eq('DOS 1.0 version', d.version, '1.0');
// Happy-Computer DOS II+D (header, with and without the CAR DOS text)
d = det(H('0003000715124c2f'), ['DOS.SYS', 'HAPPYDOS.BAS']); eq('Happy DOS family', d.family, 'happy-dos'); eq('Happy DOS version', d.version, '4.5');
d = det(H('0003000715124c2f'), ['MANAGER.BAS', 'DISKTOOL'], 'CAR DOS'); eq('Happy DOS alt dump family', d.family, 'happy-dos');
// DOS 2.0 and DOS 2.5 keep their family; DOS.SYS-only DOS 2.0 loader gets a version
d = det(H('0003000740154c14'), ['DOS.SYS', 'DUP.SYS']); eq('DOS 2 family', d.family, 'atari-dos2'); eq('DOS 2 version', d.version, '2.0');
d = det(H('0003000740154c14'), ['DOS.SYS', 'AUTORUN.SYS']); eq('DOS 2 compatible version', d.version, '2.0');
d = det(H('0003000740154c14'), ['DOS.SYS', 'DUP.SYS', 'RAMDISK.COM']); eq('DOS 2.5 family', d.family, 'atari-dos2');
// priority: signatures of other families still win over the generic DOS 2 files
d = det(H('0003000740154c14'), ['DOS.SYS', 'DUP.SYS', 'MACH.SYS']); eq('Mach DOS wins', d.family, 'mach-dos');
d = det(H('0003000740154c14'), ['DOSXL.SYS', 'DUP.SYS']); eq('DOS XL wins', d.family, 'dos-xl');
// a disk with no DOS
d = det(H('0003000740154c14'), ['GAME.COM'], 'No DOS'); eq('no DOS bootable', d.bootable, false);
eq('EXPECT happy', DB.EXPECT['happy-dos'].length > 0, true); eq('EXPECT dos1', DB.EXPECT['atari-dos1'].length > 0, true);

// label vs content: a "SpartaDOS 90K" image that holds a DOS 2 loader is reported, and its version is not taken from the label
const tmp = path.join(R, 'out', 'dosboot-detect'); fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'spartados443_90K_boot.atr'), image(H('0003000740154c14'), ['DOS.SYS', 'DUP.SYS']));
const sc = scan(tmp, {});
eq('mislabel warning', sc.warnings.length, 1);
eq('mislabel family', sc.records[0] && sc.records[0].family, 'atari-dos2');
eq('mislabel version not from label', sc.records[0] && sc.records[0].version, '2.0');
fs.writeFileSync(path.join(tmp, 'spartados443_90K_boot.atr'), image(H('53030030e0074c80'), ['FILES.TXT']));
const sc2 = scan(tmp, {});
eq('Sparta family', sc2.records[0] && sc2.records[0].family, 'spartados'); eq('Sparta version from name', sc2.records[0] && sc2.records[0].version, '4.43');
fs.rmSync(tmp, { recursive: true, force: true });

// real collections (local only)
const dir = path.join(R, 'software_n_roms/firmware/DOS');
if (fs.existsSync(dir)) {
  const { records } = scan(dir, {});
  const fam = (re) => records.filter((r) => re.test(r.id));
  const all = (re, f, what) => { const l = fam(re); eq(what + ' present', l.length > 0, true); l.forEach((r) => eq(what + ' ' + r.id, r.family, f)); };
  all(/^atari-dos-atari-v1\.0-/, 'atari-dos1', 'DOS 1.0');
  all(/^happy-computer-dos-ii-d/, 'happy-dos', 'Happy DOS');
  eq('no record has family unknown', records.filter((r) => r.family === 'unknown').length, 0);
  const noVer = records.filter((r) => !r.version).map((r) => r.id);
  console.log('records without a version (label says "no version"):', noVer.length);
} else console.log('SKIP real images (software_n_roms not present)');
console.log(fail ? 'FAIL ' + fail + ' of ' + n : 'ok - ' + n + ' checks');
process.exit(fail ? 1 : 0);
