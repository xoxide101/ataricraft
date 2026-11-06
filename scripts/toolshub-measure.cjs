// Emulator page weight: requests, bytes and load time of web/index.html (median of N cold loads). Usage: node scripts/toolshub-measure.cjs [page] [runs]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const ROOT = 'C:/Users/raver/ataricraft', PORT = '8801';
const page = process.argv[2] || 'index.html', RUNS = +process.argv[3] || 5;
(async () => {
  const srv = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', PORT], { env: process.env });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const res = [];
  for (let i = 0; i < RUNS; i++) {
    const p = await (await b.newContext()).newPage();
    let bytes = 0, n = 0, js = 0; const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('response', async (r) => { try { const len = (await r.body()).length; bytes += len; n++; if (/\.js(\?|$)/.test(r.url())) js += len; } catch (e) { /* redirects */ } });
    const t0 = Date.now();
    await p.goto('http://127.0.0.1:' + PORT + '/' + page, { waitUntil: 'load' });
    const load = Date.now() - t0; await p.waitForTimeout(1200);
    res.push({ load, bytes, js, n, errs });
    await p.context().close();
  }
  await b.close(); srv.kill();
  const med = (k) => res.map((r) => r[k]).sort((a, c) => a - c)[res.length >> 1];
  console.log(JSON.stringify({ page, requests: med('n'), totalKB: Math.round(med('bytes') / 1024), jsKB: Math.round(med('js') / 1024), loadMs: med('load'), errors: res[0].errs }));
})();
