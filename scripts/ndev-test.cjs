// N: devices through the real emulator hook (libatari800 core) + live relay on loopback (--allow-lan).
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const http = require('http');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const web = http.createServer((q, p) => { p.setHeader('Content-Type', 'application/json'); p.end('{"name":"fuji","n":[7,8,9]}\r\n'); }).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8791', '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);
  const res = await p.evaluate(async (port) => {
    FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken');
    const m = () => FujiNet.emu.mem();
    const A = 0x600, hook = FujiNet.emu.m.acSio, out = [];
    const str = (s) => { m().fill(0, A, A + 256); for (let i = 0; i < s.length; i++) m()[A + i] = s.charCodeAt(i); m()[A + s.length] = 0x9b; };
    const call = (dev, cmd, aux, len) => hook(dev, cmd, 0, aux, A, len);
    const st = (dev) => { call(dev, 0x53, 0, 4); return Array.from(m().subarray(A, A + 4)); };
    const rd = (dev, n) => { call(dev, 0x52, n, n); return String.fromCharCode(...m().subarray(A, A + n)); };
    str('N:TEST://'); out.push(call(0x71, 0x4f, 4, 256)); const s1 = st(0x71); out.push(s1[0] > 90, s1[3]); out.push(rd(0x71, 12));
    str('N2:HTTP://127.0.0.1:' + port + '/j'); out.push(call(0x72, 0x4f, 4, 256)); const s2 = st(0x72); out.push(s2[3]); out.push(rd(0x72, s2[0]));
    call(0x72, 0x43, 0, 0);
    out.push(hook(0x79, 0x53, 0, 0, A, 4), hook(0x70, 0xff, 0, 0, A, 0));
    return out;
  }, web.address().port);
  console.log(JSON.stringify(res), errs);
  const ok = res[0] === 67 && res[1] === true && res[2] === 1 && res[3] === 'This is test ' .slice(0, 12) && res[4] === 67 && res[5] === 1 && /^\{"name":"fuji"/.test(res[6]) && res[7] === 0;
  console.log(ok ? 'N: emulator test OK' : 'N: emulator test FAILED');
  await b.close(); relay.kill(); web.close();
  process.exit(ok ? 0 : 1);
})();
