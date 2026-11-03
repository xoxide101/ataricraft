// One-command start: the relay serves the emulator and pre-fills the token/relay address.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const env = Object.assign({}, process.env); delete env.AC_TOKEN;
  const rl = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8794'], { env });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8794/');
    ok(await p.title() !== '', 'emulator page loads from the relay');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.click('#boot'); await p.waitForTimeout(2500);
    const r = await p.evaluate(async () => {
      const tok = localStorage.getItem('ac.nettoken');
      const res = await fetch(FujiNet.bridge + '/net/udp/close', { method: 'POST', headers: { 'X-AC-Token': tok || '', 'X-AC-Args': '%7B%7D' } });
      return { tok: !!tok, bridge: FujiNet.bridge, status: res.status, origin: location.origin };
    });
    ok(r.tok && r.bridge === r.origin, 'token and relay address were filled in automatically', r);
    ok(r.status === 200, 'N: relay call works with no manual setup', r.status);
    ok(errs.length === 0, 'no page errors', errs);
  } finally { await b.close(); rl.kill(); }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
