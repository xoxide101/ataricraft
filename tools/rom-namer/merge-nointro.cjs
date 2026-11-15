// Merge No-Intro style archives (an outer zip of per-game zips) into an existing set folder without overwriting anything.
//   node tools/rom-namer/merge-nointro.cjs --src <folder with the outer zips> --out <set folder> --sevenzip <7z.exe> [--apply] [--all] [--only nes,snes,...] [--stage <temp folder>]
// Titles already present in the target folder (matched ignoring case, punctuation and spacing) are skipped, as are
// Beta / Proto / Sample / Demo / Kiosk / BIOS entries unless --all. Dry run by default (lists the archive, extracts nothing).
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { readZip, extract } = require('./build-set.cjs');

const JOBS = [
  { id: 'nes', archive: 'Nintendo - Nintendo Entertainment System.zip', dir: 'Nintendo - NES', exts: ['.nes'] },
  { id: 'snes', archive: 'Nintendo - Super Nintendo Entertainment System.zip', dir: 'Nintendo - SNES', exts: ['.sfc', '.smc'] },
  { id: 'genesis', archive: 'Sega - Mega Drive - Genesis.zip', dir: 'Sega - Genesis', exts: ['.md', '.bin', '.gen'], force: '.md' },
  { id: 'n64', archive: 'Nintendo - N64.zip', dir: 'Nintendo - N64', exts: ['.z64', '.n64', '.v64'] },
  { id: 'ds', archive: 'Nintendo - DS.zip', dir: 'Nintendo - DS', exts: ['.nds'] },
  { id: 'gb', archive: 'Nintendo - Game Boy (1).zip', dir: 'Nintendo - Game Boy', exts: ['.gb'] },
  { id: 'gbc', archive: 'Nintendo - Game Boy Color (1).zip', dir: 'Nintendo - Game Boy Color', exts: ['.gbc'] },
  { id: 'gba', archive: 'Nintendo - Game Boy Advance (1).zip', dir: 'Nintendo - Game Boy Advance', exts: ['.gba'] },
  { id: 'pce', archive: 'NEC - PC Engine - TurboGrafx 16.zip', dir: 'NEC - TurboGrafx-16 - PC Engine', exts: ['.pce'] },
  { id: 'pce2', archive: 'NEC - TurboGrafx-16.zip', dir: 'NEC - TurboGrafx-16 - PC Engine', exts: ['.pce'] },
  { id: 'sgx', archive: 'NEC - Super Grafx.zip', dir: 'NEC - SuperGrafx', exts: ['.pce', '.sgx'] },
];
const SKIP = /\((beta|proto|sample|demo|kiosk|promo|test program|unl)\b|\[bios\]/i;
const norm = (s) => s.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, '');
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');

function listInner(sevenzip, archive) {
  const r = cp.spawnSync(sevenzip, ['l', '-ba', '-slt', '-sccUTF-8', archive], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('7z list failed: ' + (r.stderr || r.stdout).slice(0, 200));
  return r.stdout.split(/\r?\n/).filter((l) => l.startsWith('Path = ')).map((l) => l.slice(7)).filter((p) => /\.zip$/i.test(p));
}

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const src = arg('--src'), out = arg('--out'), sz = arg('--sevenzip'), apply = a.includes('--apply'), all = a.includes('--all');
  const only = arg('--only') ? arg('--only').split(',') : null, stage = arg('--stage') || path.join(os.tmpdir(), 'nointro-stage');
  if (!src || !out || !sz) { console.log('usage: node tools/rom-namer/merge-nointro.cjs --src <folder> --out <set folder> --sevenzip <7z.exe> [--apply] [--all] [--only nes,snes,genesis,n64,ds,gb,gbc,gba] [--stage <temp>]'); process.exit(1); }
  for (const job of JOBS) {
    if (only && !only.includes(job.id)) continue;
    const archive = path.join(src, job.archive), dir = path.join(out, job.dir);
    if (!fs.existsSync(archive)) { console.log(job.id + ': archive not found'); continue; }
    const have = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).map(norm) : []);
    const inner = listInner(sz, archive); let fresh = 0, dup = 0, skipped = 0, written = 0;
    const wanted = inner.filter((p) => { const n = path.posix.basename(p); if (!all && SKIP.test(n)) { skipped++; return false; } if (have.has(norm(n))) { dup++; return false; } fresh++; return true; });
    if (apply && wanted.length) {
      fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(dir, { recursive: true });
      const listFile = path.join(stage, '_want.txt'); fs.writeFileSync(listFile, wanted.join('\n'), 'utf8');
      const r = cp.spawnSync(sz, ['x', archive, '-o' + stage, '-y', '-spd', '-scsUTF-8', '@' + listFile], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (r.status !== 0 && r.status !== 1) throw new Error('7z extract failed: ' + (r.stderr || r.stdout).slice(-300));
      for (const p of wanted) {
        const f = path.join(stage, p); if (!fs.existsSync(f)) continue;
        const z = readZip(f), en = z.entries.find((e) => job.exts.includes(path.extname(e.name).toLowerCase()));
        if (!en) continue;
        const stem = path.basename(p).replace(/\.zip$/i, ''), to = path.join(dir, safe(stem) + (job.force || path.extname(en.name).toLowerCase()));
        if (fs.existsSync(to)) continue;
        fs.writeFileSync(to, extract(z, en)); written++;
      }
      fs.rmSync(stage, { recursive: true, force: true });
    }
    console.log(`${job.id}: ${inner.length} titles in archive, ${dup} already present, ${skipped} skipped (beta/proto/etc), ${fresh} new${apply ? ', ' + written + ' written' : ' (dry run)'}`);
  }
}
module.exports = { norm, SKIP, JOBS };
