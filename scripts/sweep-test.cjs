// Library sweep: loads a random sample of entries from each archive folder and reports failures by cause.
// usage: node scripts/sweep-test.cjs <root folder> [samplePerFolder=25] [maxFolderMB=300]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..') + '/';
const root = process.argv[2] || R + 'software_n_roms/8bit';
const N = +process.argv[3] || 25, MAXMB = +process.argv[4] || 300;

function folders(dir, out = []) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  const arcs = ents.filter((e) => e.isFile() && /\.(zip|7z)$/i.test(e.name));
  if (arcs.length) out.push({ dir, mb: arcs.reduce((s, e) => s + fs.statSync(path.join(dir, e.name)).size, 0) / 1048576, n: arcs.length });
  for (const e of ents) if (e.isDirectory()) folders(path.join(dir, e.name), out);
  return out;
}
const pick = (a, n) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b.slice(0, n); };
const SEEN = R + 'out/sweep-seen.json';
const seen = new Set(fs.existsSync(SEEN) ? JSON.parse(fs.readFileSync(SEEN, 'utf8')) : []);

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const bad = [], skipped = [];
  let tried = 0;
  for (const f of folders(root)) {
    const rel = path.relative(root, f.dir) || '.';
    if (f.mb > MAXMB || /a2600|2600/i.test(rel)) { skipped.push(rel + ` (${Math.round(f.mb)} MB)`); continue; }
    const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
    p.on('pageerror', (e) => bad.push({ where: rel, entry: '(page error)', msg: e.message }));
    try {
      await p.goto('file:///' + R + 'web/index.html');
      await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
      await p.waitForTimeout(600); await p.click('#boot'); await p.waitForTimeout(1500);
      await p.setInputFiles('#medfolder', f.dir);
      await p.waitForFunction(() => ataricraft.mediaList().length > 0, null, { timeout: 180000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const list = (await p.evaluate(() => ataricraft.mediaList())).filter((e) => /^(disk|cart|exe|tape)$/.test(e.kind) && !seen.has(e.name));
      let ok = 0;
      for (const e of pick(list, N)) {
        tried++; seen.add(e.name);
        const f0 = await p.evaluate(() => ataricraft.state().frames);
        const r = await Promise.race([
          p.evaluate((n) => ataricraft.loadEntry(n, 1), e.name),
          new Promise((res) => setTimeout(() => res({ ok: false, msg: 'TIMEOUT 30s' }), 30000)),
        ]).catch((x) => ({ ok: false, msg: 'EVAL ' + x.message }));
        if (r.ok) {
          await p.waitForTimeout(1200);
          const st = await p.evaluate(() => ataricraft.state());
          if (!st.booted || st.frames <= f0) r.ok = false, r.msg = 'emulator stalled after load (' + r.msg.slice(0, 50) + ')';
        }
        if (r.ok) ok++; else bad.push({ where: rel, entry: e.name, msg: r.msg });
      }
      fs.writeFileSync(SEEN, JSON.stringify([...seen]));
      console.log(`${rel}: ${list.length} loadable, sampled ${Math.min(N, list.length)}, ok ${ok}`);
    } catch (x) { bad.push({ where: rel, entry: '(folder)', msg: x.message.split('\n')[0] }); }
    await p.close();
  }
  await b.close();
  const by = {};
  for (const x of bad) { const k = x.msg.replace(/"[^"]*"|\S+\.(atr|xex|xfd|rom|car|bin|cas|dcm|zip|7z)\b/gi, '<f>').replace(/\d+/g, '#').slice(0, 90); (by[k] = by[k] || []).push(x); }
  console.log(`\nTried ${tried}, failed ${bad.length}. Skipped: ${skipped.join('; ') || 'none'}`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n[${v.length}] ${k}`); v.slice(0, 3).forEach((x) => console.log('   ' + x.where + ' :: ' + x.entry));
  }
})();
