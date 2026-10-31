#!/usr/bin/env node
// Download the newest public TOSEC DAT pack (hash/name catalogues only, no software) and extract the DATs for chosen systems.
//   node tools/fetch-dats.cjs [system-prefix ...]     default: Atari
//   e.g. node tools/fetch-dats.cjs Atari Commodore "Tandy" "Apple"
// Output: out/dats/tosec.zip (cached) and out/dats/tosec/*.dat. Needs Node 18+ and Windows 10+ tar (bsdtar).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const BASE = 'https://www.tosecdev.org';
const out = path.join(__dirname, '..', 'out', 'dats');
fs.mkdirSync(path.join(out, 'tosec'), { recursive: true });
const systems = process.argv.slice(2).length ? process.argv.slice(2) : ['Atari'];

(async () => {
  const idx = await (await fetch(BASE + '/downloads/category/22-datfiles')).text();
  const cats = [...idx.matchAll(/href="(?:https:\/\/www\.tosecdev\.org)?(\/downloads\/category\/\d+-(\d{4}-\d\d-\d\d))"/g)].map((m) => ({ url: BASE + m[1], date: m[2] }));
  if (!cats.length) throw new Error('no DAT releases found on the TOSEC downloads page');
  cats.sort((a, b) => b.date.localeCompare(a.date));
  const page = await (await fetch(cats[0].url)).text();
  const dl = [...page.matchAll(/href="([^"]*\?download=\d+:[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))[0];
  if (!dl) throw new Error('no download link on ' + cats[0].url);
  const url = dl.startsWith('http') ? dl : BASE + dl;
  console.log('latest TOSEC release', cats[0].date);
  const zip = path.join(out, 'tosec.zip');
  const head = await fetch(url, { method: 'HEAD' }), want = +head.headers.get('content-length');
  if (fs.existsSync(zip) && fs.statSync(zip).size === want) console.log('already downloaded', want, 'bytes');
  else {
    console.log('downloading', want, 'bytes ...');
    const r = await fetch(url); const buf = Buffer.from(await r.arrayBuffer());
    if (want && buf.length !== want) throw new Error('incomplete download');
    fs.writeFileSync(zip, buf);
  }
  for (const s of systems) {
    const res = cp.spawnSync('tar', ['-xf', zip, '-C', out, '--strip-components=1', '--wildcards', `TOSEC/${s}*`], { encoding: 'utf8' });
    if (res.status !== 0) { const r2 = cp.spawnSync('tar', ['-xf', zip, '-C', out, `TOSEC/${s}*`], { encoding: 'utf8' }); if (r2.status !== 0) console.log('extract failed for', s, res.stderr || r2.stderr); }
  }
  // tar writes into out/ (stripped) or out/TOSEC; gather into out/dats/tosec
  for (const d of [out, path.join(out, 'TOSEC')]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (/\.dat$/i.test(f)) fs.renameSync(path.join(d, f), path.join(out, 'tosec', f));
  const n = fs.readdirSync(path.join(out, 'tosec')).filter((f) => /\.dat$/i.test(f)).length;
  console.log(`${n} DAT files in ${path.join(out, 'tosec')}`);
})().catch((e) => { console.error('fetch-dats:', e.message); process.exit(1); });
