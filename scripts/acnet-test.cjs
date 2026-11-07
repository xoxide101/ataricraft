// ACNet end-to-end: real emulator (Chrome + wasm atari800 patched with the $D1A0 window) -> WebSocket -> Node bridge -> userspace IP
// stack with its own MAC/DHCP lease on an in-process virtual LAN with test peers. A 6502 program built with mads exercises the whole
// API through BOTH transports (register window + IRQ, and SIO device $65). Also tests "bridge down" => clean no-link behaviour.
// Usage: node scripts/acnet-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { execFileSync } = require('child_process');
const path = require('path');
const { Stack } = require('../tools/acnet/stack.cjs');
const { Hub, DhcpServer, dnsServer } = require('../tools/acnet/l2-virtual.cjs');
const { startBridge } = require('../tools/acnet/bridge.cjs');
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function build(variant) {
  const out = `${ROOT}/out/acnet-demo-${variant}.xex`;
  const args = ['demo.asm', ...(variant === 'sio' ? ['-d:ACNET_SIO=1'] : []), ...(process.env.NOIRQ ? ['-d:NOIRQ=1'] : []), '-o:' + out];
  execFileSync(`${ROOT}/out/mads/mads.exe`, args, { cwd: `${ROOT}/guest/acnet`, stdio: 'pipe' });
  return require('fs').readFileSync(out);
}

async function lan() {
  const hub = new Hub();
  new DhcpServer(hub, { lease: 3600 });
  const peer = new Stack(hub.port(), { staticIp: { ip: '10.7.0.1' }, mac: Buffer.from('02aaaaaaaa01', 'hex') });
  dnsServer(peer, { 'host.test': '10.7.0.1' });
  const body = 'hello world';
  const resp = `HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
  peer.tcpListen(80, (s) => { let g = ''; s.ondata = (d) => { g += d; s.consume(d.length); if (g.includes('\r\n\r\n')) { peer.lastReq = g; s.write(Buffer.from(resp)); s.close(); } }; });
  peer.tcpListen(8000, (s) => { s.ondata = (d) => { s.write(d); s.consume(d.length); }; });
  const u = peer.udpBind(7777); u.onmessage = (b, ip, p) => u.send(ip, p, b);
  const dev = new Stack(hub.port(), { hostname: 'acnet' });
  for (let i = 0; i < 400 && !dev.info().up; i++) await wait(20);
  return { hub, peer, dev, resp };
}

async function newPage(b, url) {
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.addInitScript((u) => { localStorage.setItem('ac.acnet.url', u); }, url);
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '800xl'); await p.selectOption('#core', 'atari800');
  await p.click('#boot'); await p.waitForTimeout(3500);
  return p;
}
const peek = (p, a, n) => p.evaluate(([a, n]) => ataricraft.peek(a, n), [a, n]);
const str = (a) => String.fromCharCode(...a);

async function runDemo(b, variant, withBridge) {
  const tag = `[${variant}${withBridge ? '' : ', bridge down'}]`;
  const x = (c, m, e) => ok(c, `${tag} ${m}`, e);
  const xex = build(variant);
  let L = null, br = null;
  if (withBridge) { L = await lan(); br = await startBridge({ stack: L.dev, port: 0 }); }
  const p = await newPage(b, withBridge ? `ws://127.0.0.1:${br.port}` : 'ws://127.0.0.1:1');
  await p.evaluate(async (by) => { await ataricraft.bootFile('ACNET.XEX', Uint8Array.from(by)); }, [...xex]);

  let peerData = '', listenPeer = null;
  const t0 = Date.now(); let done = false;
  while (Date.now() - t0 < 120000) {
    const [stage, d] = await peek(p, 0x600, 2);
    if (withBridge && stage === 5 && !listenPeer) {
      await wait(400);
      const gip = L.dev.info().ip;
      listenPeer = L.peer.tcpConnect(gip, 6000);
      listenPeer.onconnect = () => listenPeer.write(Buffer.from('hello-from-peer'));
      listenPeer.ondata = (c) => { peerData += c; listenPeer.consume(c.length); };
    }
    if (d === 0xaa) { done = true; break; }
    await wait(150);
  }
  x(done, `demo ran to completion in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const r = await peek(p, 0x600, 0xb0);
  if (!done) console.log(tag, 'stalled; page6:', Array.from({ length: 11 }, (_, i) => Buffer.from(r.slice(i * 16, i * 16 + 16)).toString('hex')).join(' | '), await p.evaluate(() => ACNet.core.S.map((s, i) => i + ':' + s.st + '/rx' + (s.rx ? s.rx.length : '?')).slice(0, 4).join(' ')));
  if (!done) console.log(tag, 'irq state', await p.evaluate(() => [ACNet.core.irqen, ACNet.core.irqLevel, ataricraft.peek(0x216, 2).join(',')].join(' ')));
  const w = (o) => r[o] | (r[o + 1] << 8);
  x(r[2] === 0, 'device detected (an_init)');
  if (!withBridge) {
    x(r[0x20] === 1, 'DNS fails cleanly with no bridge');
    x(r[0x30] === 1 && w(0x31) === 0, 'TCP connect fails cleanly (no hang)');
    x(r[0x50] === 1, 'listen fails cleanly');
    x(r[0x90] === 1 && r[0x92] === 0, 'no sockets opened');
    const st = await p.evaluate(() => ACNet.status());
    x(/no link/.test(st), 'UI/status reports no link', st);
    const flags = await p.evaluate(() => { ACNet.core.regWrite(5, 0); return ACNet.core.regRead(3); });
    x((flags & 0x80) === 0 && (flags & 0x20) === 0, 'STATUS: link bit clear, bridge bit clear', flags);
    x(p.errs.length === 0, 'no page errors', p.errs);
    await p.context().close();
    return;
  }
  const info = L.dev.info(), ip = info.ip.split('.').map(Number);
  const ni = r.slice(4, 30);
  x(ni.slice(6, 10).join('.') === info.ip && ni.slice(10, 14).join('.') === '255.255.255.0' && ni.slice(14, 18).join('.') === '10.7.0.1' && ni.slice(18, 22).join('.') === '10.7.0.1', 'NETINFO: IP/mask/gw/dns from DHCP lease', ni);
  x(ni.slice(0, 6).map((v) => v.toString(16).padStart(2, '0')).join(':') === info.mac, 'NETINFO: MAC is the stack MAC (own identity)', info.mac);
  x((ni[0] & 2) === 2 && (ni[0] & 1) === 0, 'MAC is locally administered unicast');
  x(r[0x20] === 0 && r.slice(0x21, 0x25).join('.') === '10.7.0.1', 'DNS host.test -> 10.7.0.1');
  x(r[0x28] === 0, 'ping gateway/peer answered', w(0x29));
  x(r[0x81] === 7, 'DNS NXDOMAIN reported as serr 7', r[0x81]);
  const hl = w(0x31), html = str(await peek(p, 0x4000, hl));
  x(r[0x30] === 0 && hl === L.resp.length && html === L.resp, `HTTP GET: ${hl} bytes, headers+body match`, html);
  x(L.peer.lastReq && L.peer.lastReq.startsWith('GET /hello HTTP/1.0\r\nHost: host.test'), 'server saw the request, source is the ACNet IP');
  x(r[0x38] === 0 && r[0x39] === 8 && str(r.slice(0x40, 0x48)) === 'udp-ping', 'UDP echo round trip');
  x(r[0x50] === 0 && r.slice(0x51, 0x55).join('.') === '10.7.0.1' && w(0x55) === listenPeer.lport, 'listener: accepted inbound connection from the peer (ip/port)', r.slice(0x50, 0x58));
  x(r[0x57] === 15 && str(r.slice(0x58, 0x67)) === 'hello-from-peer', 'listener: guest received peer data');
  x(peerData === 'srv-ok', 'listener: peer received guest reply', peerData);
  x(r[0x80] === 1, 'connect to closed port -> REFUSED (serr 1)', r[0x80]);
  x(r[0x90] === 0 && r[0x91] === 8 && r[0x92] === 8, '8 concurrent TCP sockets, each got its own byte back', r.slice(0x90, 0x93));
  x(r[0x70] === 0 && w(0x71) === 20000 && w(0x73) === 20000 && w(0x75) === 0, `20000-byte full-duplex echo intact (stalls on TX full: ${w(0x77)})`, [w(0x71), w(0x73), w(0x75)]);
  if (variant === 'reg') x(r[0x82] >= 1, `IRQ-driven: ISR ran ${r[0x82]}x, latched event map ${w(0x83).toString(16)}`);
  const left = await p.evaluate(() => ACNet.core.S.filter((s, i) => i && s.st !== 'free').length);
  x(left <= 1, 'no leaked socket handles in the device', left);
  // the bridge keeps no connection state after the page goes away
  await p.context().close(); await wait(300);
  x(!L.dev.tcp || L.dev.tcp.size === 0 || [...L.dev.tcp.values()].every((s) => !['ESTABLISHED', 'CLOSE_WAIT', 'SYN_SENT'].includes(s.state)), 'closing the page closes every stack socket (none left ESTABLISHED/CLOSE_WAIT)', [...L.dev.tcp.values()].map((s) => s.state));
  await br.close(); L.dev.close(); L.peer.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const v of ['reg', 'sio']) await runDemo(b, v, true);
  await runDemo(b, 'reg', false);
  await runDemo(b, 'sio', false);
  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall ACNet e2e tests passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
