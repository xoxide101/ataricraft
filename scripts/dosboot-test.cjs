// Boots DOS records through the real UI path (relay /dosboot/* -> ataricraft.bootRecord) and asserts the DOS prompt text.
// Usage: node scripts/dosboot-test.cjs [id-substring ...]   (needs scripts/dosboot-scan.cjs run on the folders first)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..') + '/';
const RD = R + 'software_n_roms/8bit/Atari 8-Bit/Atari 8-bit Archive of Archives/Atari800WinPLus 40/xf25/';
const PORT = 8795;
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['atari-v2.5-1984', 'bewesoft-v1.30-1995-12-17-side-a', 'dos-xl-oss-v2.30-1983', 'mydos', 'top-dos-bennett-r.-k.-v1.5a', 'spartados'];

(async () => {
  fs.mkdirSync(R + 'out/dosboot', { recursive: true });
  const relay = spawn('node', [R + 'tools/tnfs-bridge/bridge.cjs', String(PORT)], { cwd: R, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.setInputFiles('#romfiles', [RD + 'ATARIXL.ROM', RD + 'ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.click('#dosbtn');
  await p.waitForTimeout(800);
  const ids = await p.evaluate(() => window.ataricraftDosBoot.sources.flatMap((s, si) => s.doc.records.map((r) => [si, r.id])));
  console.log('records via relay:', ids.length);
  let fail = 0;
  for (const w of WANT) {
    const hit = ids.find(([, id]) => id.includes(w));
    if (!hit) { console.log('SKIP (no record)', w); fail++; continue; }
    const res = await p.evaluate(async ([si, id]) => {
      const s = window.ataricraftDosBoot.sources[si], rec = s.doc.records.find((r) => r.id === id);
      await window.ataricraftDosBoot.boot(s, rec);
      return { rec: { expect: rec.boot.expect, family: rec.family, version: rec.version } };
    }, hit);
    await p.waitForTimeout(((res.rec.expect && res.rec.expect.afterFrames) || 600) * 20 + 1500);
    const text = await p.evaluate(() => window.ataricraft.screenText());
    const any = (res.rec.expect && res.rec.expect.anyText) || [];
    const ok = any.some((t) => text.toUpperCase().includes(t.toUpperCase()));
    await p.screenshot({ path: R + `out/dosboot/${hit[1].slice(0, 50)}.png` });
    console.log(ok ? 'PASS' : 'FAIL', hit[1], `(${res.rec.family} ${res.rec.version})`, '\n  screen:', JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 200)));
    if (!ok) fail++;
  }
  await b.close(); relay.kill();
  process.exit(fail ? 1 : 0);
})();
