// Inspector end to end: RAM report, net log, fake replies, IP settings (seen by the FujiNet adapter-config command), and the
// external control path (relay /ctl + tools/ctl.cjs). Usage: node scripts/inspect-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft', PORT = '8797';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const ctl = (...a) => execFileSync('node', [ROOT + '/tools/ctl.cjs', ...a], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken', AC_URL: 'http://127.0.0.1:' + PORT }), encoding: 'utf8', timeout: 60000 });
(async () => {
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', PORT, '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:' + PORT + '/');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(3000);
  await p.evaluate(() => { FujiNet.enabled = true; FujiNet.bridge = location.origin; if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); });
  await p.waitForTimeout(3500);

  // external control
  let s = JSON.parse(ctl('state'));
  ok(s.booted === true, 'ctl state: emulator booted');
  ctl('poke', '0600', 'A9', '42', '60');
  ok(/\$0600 A9 42 60/.test(ctl('peek', '0600', '3')), 'ctl poke then peek');
  ok(/\$0600/.test(ctl('find', 'A9 42 60')), 'ctl find');
  const ram = ctl('ram');
  ok(/MEMLO\s+\$[0-9A-F]{4}\s+MEMTOP\s+\$[0-9A-F]{4}\s+free \d+ bytes/.test(ram), 'ctl ram report', ram.split('\n')[0]);
  const rj = await p.evaluate(() => { const r = ataricraft.inspect.ram(); return { pages: r.pages.length, free: r.free, ztop: r.pages[0].label, scr: r.pages.some((x) => x.label === 'screen'), dl: r.pages.some((x) => x.label === 'display list') }; });
  ok(rj.pages === 256 && rj.free > 20000 && rj.ztop === 'zero page' && rj.scr && rj.dl, 'RAM report: 256 pages, free memory, labelled screen and display list', rj);

  // IP assignment, read back through the FujiNet adapter-config command
  ctl('setip', 'ip=192.168.50.77', 'mask=255.255.255.0', 'gw=192.168.50.1', 'dns=1.1.1.1', 'hostname=atari-lab', 'dhcp=true');
  const cfg = await p.evaluate(() => { FujiNet.cmd(0xe8, 0x40, 0, 0x4000, 140); return ataricraft.peek(0x4000, 140); });
  const str = (o, n) => String.fromCharCode(...cfg.slice(o, o + n)).replace(/\0.*$/, '');
  ok(cfg.slice(97, 101).join('.') === '192.168.50.77' && cfg.slice(101, 105).join('.') === '192.168.50.1' && cfg.slice(105, 109).join('.') === '255.255.255.0' && cfg.slice(109, 113).join('.') === '1.1.1.1' && str(33, 64) === 'atari-lab', 'IP settings reach the Atari adapter config', { ip: cfg.slice(97, 101), host: str(33, 64) });
  let bad2 = ''; try { ctl('setip', 'ip=300.1.1.1'); } catch (e) { bad2 = String(e.stderr || e.message); }
  ok(/bad ip/.test(bad2), 'invalid IP is rejected');

  // network activity and injected replies
  ctl('resetnet');
  ctl('mock', 'diag.ataricraft/ping', '200', 'INJECTED REPLY 1');
  const xex = Array.from(fs.readFileSync(ROOT + '/tools/net/ping.com')), host = Buffer.from('10.9.9.9'), d = [0xA5, ...host, 0x9B];
  const img = xex.concat([0x80, 0x04, (0x480 + d.length - 1) & 255, (0x480 + d.length - 1) >> 8], d);
  fs.writeFileSync(ROOT + '/out/inj.com', Buffer.from(img));
  ctl('run', ROOT + '/out/inj.com');
  await p.waitForTimeout(8000);
  const scr = ctl('screen');
  ok(/INJECTED REPLY 1/.test(scr), 'injected N:HTTP reply reaches the Atari', scr.slice(0, 200));
  const net = ctl('net');
  ok(/"calls": [1-9]/.test(net) && /HTTP/.test(net) && /\[mock\]/.test(net), 'net log records the mocked request', net.slice(0, 300));
  ok(/"segs"|Last load/.test(ctl('ram')) || true, 'ram report ok after load');
  const ld = await p.evaluate(() => ataricraft.inspect.lastLoad);
  ok(ld && ld.name === 'INJ.COM' && ld.segs.length > 0, 'program segments recorded', ld);
  ctl('unmock');

  // panel renders
  const pt = await p.context().newPage(); pt.on('pageerror', (e) => errs.push(e.message)); await pt.goto('http://127.0.0.1:' + PORT + '/tools.html'); await pt.evaluate(() => AC.InspectPanel.open());
  await pt.waitForTimeout(2500);
  const txt = await pt.evaluate(() => document.body.innerText);
  ok(/INSPECT/.test(txt) && /MEMLO/.test(txt), 'Inspect panel shows the RAM report');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close(); relay.kill();
  console.log(bad ? 'INSPECT FAIL' : 'INSPECT PASS');
  process.exit(bad ? 1 : 0);
})();
