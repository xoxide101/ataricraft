// CURL.COM, JQ.COM and NC.COM end to end against local servers, run from the CMD hand-off line on both cores.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const ROOT = 'C:/Users/raver/ataricraft';
const { build } = require(ROOT + '/tools/tests/buildapp.cjs');
const rec = { method: '', body: '', ncIn: [], srvIn: [] };
const JSONDOC = '{"name":"Atari","specs":{"cpu":"6502","ram":[64,128]},"year":1979}';
const web = http.createServer((q, r) => {
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (q.url === '/j') { r.setHeader('Content-Type', 'application/json'); return r.end(JSONDOC); }
    rec.method = q.method; rec.body = b; r.setHeader('X-Test', 'hello-header'); r.end('curl body');
  });
}).listen(0, '127.0.0.1');
const echo = net.createServer((s) => {
  s.on('error', () => {}); s.on('data', (d) => { rec.ncIn.push(d.toString('latin1')); s.write('ECHO:' + d.toString('latin1')); });
}).listen(0, '127.0.0.1');
const screen = () => {
  const e = FujiNet.emu, sm = e.peek(0x58, 2), base = sm[0] | (sm[1] << 8), rows = [];
  for (let r = 0; r < 24; r++) rows.push(Array.from(e.peek(base + r * 40, 40)).map((c) => { c &= 0x7f; c = c < 64 ? c + 32 : c < 96 ? c - 64 : c; return String.fromCharCode(c); }).join('').trimEnd());
  return rows.join('\n');
};
const tryClient = (port, tries) => new Promise((res) => {
  const go = (n) => {
    const c = net.connect(port, '127.0.0.1'); rec.sock = c;
    let got = '';
    c.on('data', (d) => { got += d.toString('latin1'); rec.srvIn.push(got); if (/HELLO FROM ATARI/.test(got)) c.write('ping from node\r\n'); });
    c.on('error', () => { if (n > 0) setTimeout(() => go(n - 1), 500); else res(); });
    c.on('close', () => res());
  };
  go(tries);
});
(async () => {
  await Promise.all([web, echo].map((s) => new Promise((r) => s.once('listening', r))));
  const WP = '127.0.0.1:' + web.address().port, EP = echo.address().port;
  const LP = 18555;
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8791', '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  const cases = [
    ['curl', 'http://' + WP + '/', (s) => /curl body/.test(s)],
    ['curl', '-i http://' + WP + '/', (s) => /STATUS 1/.test(s) && /hello-header/i.test(s) && /curl body/.test(s)],
    ['curl', '-d name=atari http://' + WP + '/', (s) => rec.method === 'POST' && rec.body === 'name=atari'],
    ['jq', '/name http://' + WP + '/j', (s) => /Atari/.test(s)],
    ['jq', '/specs/cpu http://' + WP + '/j', (s) => /6502/.test(s)],
    ['jq', '/specs/ram http://' + WP + '/j', (s) => /\[64,128\]/.test(s)],
    ['jq', '/year http://' + WP + '/j', (s) => /1979/.test(s)],
    ['jq', '/missing http://' + WP + '/j', (s) => /NOT FOUND/.test(s)],
    ['nc', '127.0.0.1 ' + EP + ' hello', (s) => /ECHO:hello/.test(s)],
    ['nc', '-l ' + LP, (s) => /LISTENING/.test(s) && rec.srvIn.some((x) => /BYE/.test(x)) && rec.ncIn.length === 0 && /ping from node/.test(s), () => tryClient(LP, 20)],
  ];
  const xexs = {};
  for (const n of ['curl', 'jq', 'nc']) xexs[n] = build(n).xex;
  for (const core of (process.env.CORES || 'atari800,altirra').split(',')) {
    for (const [app, args, check, side] of cases.filter((c) => !process.env.ONLY || c[1].startsWith(process.env.ONLY))) {
      const p = await (await b.newContext()).newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto('file:///' + ROOT + '/web/index.html');
      await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
      await p.selectOption('#core', core);
      await p.click('#boot'); await p.waitForTimeout(3000);
      await p.evaluate(() => {
        FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken');
        if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true);
      });
      await p.waitForTimeout(4000);
      rec.srvIn.length = 0; rec.ncIn.length = 0;
      const d = [0xA5, ...Buffer.from(args, 'latin1'), 0x9B];
      const img = Array.from(xexs[app]).concat([0x80, 0x04, (0x80 + d.length - 1) & 255, 0x04], d);
      await p.evaluate((sc) => { window.__snaps = new Set(); clearInterval(window.__iv); window.__iv = setInterval(() => { window.__snaps.add(eval('(' + sc + ')()')); }, 15); }, screen.toString());
      if (process.env.DBG) console.log('T boot', Date.now()); await p.evaluate((x) => ataricraft.bootFile('APP.COM', new Uint8Array(x)), img);
      if (process.env.DBG) console.log('T booted', Date.now()); const sp = side ? side() : null;
      await p.waitForFunction(() => Array.from(window.__snaps).some((x) => x.includes('BOOT ERROR')), null, { timeout: 25000, polling: 20 }).catch(() => {});
      if (process.env.DBG) console.log('DBG', await p.evaluate(() => { const e = FujiNet.emu; return 'sav=' + Array.from(e.peek(0x58, 2)) + ' dcb=' + Array.from(e.peek(0x300, 12)) + ' zp=' + Array.from(e.peek(0xA0, 4)) + ' pc=' + (e.cpu ? JSON.stringify(e.cpu) : '') + ' st=' + Array.from(e.peek(0x3100, 4)); }));
      if (process.env.DBG) console.log('T idle', Date.now()); await p.evaluate((x) => ataricraft.bootFile('IDLE.COM', new Uint8Array(x)), [0xFF, 0xFF, 0x00, 0x20, 0x02, 0x20, 0x4C, 0x00, 0x20]);
      await p.waitForTimeout(300);
      if (sp) { rec.sock && rec.sock.destroy(); await Promise.race([sp, new Promise((r) => setTimeout(r, 2000))]); }
      if (process.env.DBG) console.log('T snaps', Date.now()); const s = (await p.evaluate(() => Array.from(window.__snaps))).join('\n');
      const ok = check(s);
      if (process.env.SHOW || !ok) console.log('---', core, app, args, '\n' + s);
      console.log(core, app, args.split(' ')[0], errs, ok ? 'OK' : 'FAILED');
      if (!ok) bad++;
      await p.context().close();
    }
  }
  await b.close(); relay.kill(); web.close(); echo.close();
  process.exit(bad ? 1 : 0);
})();
