// PING / NSLOOKUP / TRACERT / WHOIS / IPCONFIG end to end: relay mode (real ICMP/DNS through the relay) and the N:-only fallbacks.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn, execFileSync } = require('child_process');
const http = require('http'), net = require('net'), fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const mads = (name, defs) => { const o = ROOT + '/out/' + name + '.com'; execFileSync(ROOT + '/out/mads/mads.exe', [ROOT + '/tools/net/netdiag.asm', ...defs.map((d) => '-d:' + d), '-o:' + o], { stdio: 'ignore' }); return Array.from(fs.readFileSync(o)); };
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const web = http.createServer((q, p) => p.end('x')).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  const port = web.address().port;
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8796', '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const run = async (label, xex, host, wait, relayOn) => {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.click('#boot'); await p.waitForTimeout(3000);
    await p.evaluate(({ rel }) => {
      FujiNet.enabled = true; FujiNet.bridge = rel ? 'http://127.0.0.1:8796' : 'http://127.0.0.1:1'; localStorage.setItem('ac.nettoken', 'testtoken');
      if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true);
    }, { rel: relayOn });
    await p.waitForTimeout(3000);
    const d = [0xA5, ...Buffer.from(host, 'latin1'), 0x9B];
    const img = xex.concat([0x80, 0x04, (0x480 + d.length - 1) & 255, (0x480 + d.length - 1) >> 8], d);
    await p.evaluate((x) => ataricraft.bootFile('T.COM', new Uint8Array(x)), img);
    await p.waitForTimeout(wait);
    const txt = await p.evaluate(() => FujiNet.emu.screenText());
    console.log('---', label, '\n' + txt.split('\n').map((l) => l.trimEnd()).filter(Boolean).join('\n'));
    await p.close();
    return { txt, errs };
  };
  let r = await run('ping relay', mads('ping', ['MODE=1']), '127.0.0.1', 12000, true);
  ok(/Reply 127\.0\.0\.1/.test(r.txt), 'PING via relay shows replies');
  r = await run('nslookup relay', mads('nslookup', ['MODE=2']), 'localhost', 8000, true);
  ok(/Name: localhost/.test(r.txt) && /127\.0\.0\.1/.test(r.txt), 'NSLOOKUP via relay');
  r = await run('tracert relay', mads('tracert', ['MODE=3']), '127.0.0.1', 12000, true);
  ok(/127\.0\.0\.1/.test(r.txt) && !/needs the/.test(r.txt), 'TRACERT via relay');
  r = await run('tracert fallback', mads('tracert', ['MODE=3']), '127.0.0.1', 8000, false);
  ok(/needs the Ataricraft relay/.test(r.txt), 'TRACERT without relay says so');
  r = await run('ping fallback', mads('pingnd', ['MODE=1', 'NODIAG=1']), '127.0.0.1:' + port, 14000, true);
  ok(/Reply from 127\.0\.0\.1:\d+: time=\d+ ms/.test(r.txt.replace(/\n/g, '')) || /Reply from/.test(r.txt), 'PING fallback times a TCP connect');
  r = await run('ping closed port', mads('pingnd', ['MODE=1', 'NODIAG=1']), '127.0.0.1:9', 14000, true);
  ok(/Request failed/.test(r.txt), 'PING fallback reports a closed port');
  r = await run('ping auto-detect w/o relay', mads('ping', ['MODE=1']), '127.0.0.1:' + port, 14000, false);
  ok(/No relay: timing TCP/.test(r.txt), 'PING auto-detects: no relay -> TCP fallback path');
  r = await run('ipconfig relay', mads('ipconfig', ['MODE=5']), '', 8000, true);
  ok(/IP: \d+\.\d+\.\d+\.\d+/.test(r.txt), 'IPCONFIG via relay lists an address');
  r = await run('whois fallback', mads('whois', ['MODE=4']), 'example.com', 8000, false);
  ok(/needs the Ataricraft relay/.test(r.txt), 'WHOIS without relay says so');
  if (process.env.ONLINE) {
    r = await run('whois relay', mads('whois', ['MODE=4']), 'google.com', 20000, true);
    ok(/Domain Name: GOOGLE\.COM/i.test(r.txt), 'WHOIS via relay');
    r = await run('nslookup DoH', mads('nsnd', ['MODE=2', 'NODIAG=1']), 'example.com', 12000, true);
    ok(/Name: example\.com/.test(r.txt) && /\d+\.\d+\.\d+\.\d+/.test(r.txt), 'NSLOOKUP DoH fallback');
  }
  await b.close(); relay.kill(); web.close();
  console.log(bad ? 'NETDIAG FAIL' : 'NETDIAG PASS');
  process.exit(bad ? 1 : 0);
})();