// ACNet userspace stack test on a virtual LAN: DHCP, ARP, ICMP, UDP, TCP (flow control, loss), DNS, renew.
// Usage: node scripts/acnet-stack-test.cjs
const { Stack } = require('../tools/acnet/stack.cjs');
const { Hub, DhcpServer, dnsServer } = require('../tools/acnet/l2-virtual.cjs');
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(20); } return false; };
const pat = (n, seed = 7) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };

(async () => {
  const hub = new Hub();
  const dhcp = new DhcpServer(hub, { lease: 6, t1: 2, t2: 4 });
  const peer = new Stack(hub.port(), { staticIp: { ip: '10.7.0.1', mask: '255.255.255.0' }, mac: Buffer.from('02aaaaaaaa01', 'hex') });
  const dns = dnsServer(peer, { 'host.test': '10.7.0.1', 'alias.test': '10.7.0.1' });
  const dev = new Stack(hub.port(), { hostname: 'acnet-test' });
  const mac = dev.mac.toString('hex');

  ok(await until(() => dev.info().up), 'DHCP lease obtained');
  const inf = dev.info();
  ok(inf.ip === '10.7.0.100' && inf.mask === '255.255.255.0' && inf.gw === '10.7.0.1' && inf.dns[0] === '10.7.0.1', 'lease fields: ip/mask/gw/dns', inf);
  ok(inf.mac.replace(/:/g, '') === mac && (dev.mac[0] & 2) === 2 && (dev.mac[0] & 1) === 0, 'own locally-administered unicast MAC', inf.mac);
  ok(dhcp.log.some((l) => l.type === 1) && dhcp.log.some((l) => l.type === 3), 'DISCOVER and REQUEST seen by server');

  // ICMP both ways (ARP resolves underneath)
  const rtt = await dev.ping('10.7.0.1').catch(() => -1);
  ok(rtt >= 0, 'device pings peer (ARP + ICMP echo)', rtt);
  const rtt2 = await peer.ping('10.7.0.100').catch(() => -1);
  ok(rtt2 >= 0, 'peer pings device (device answers ARP + ping)', rtt2);
  ok(await peer.ping('10.7.0.77', 800).then(() => false, () => true), 'ping to absent host times out');

  // DNS
  const ip = await dev.resolve('host.test').catch((e) => e.message);
  ok(ip === '10.7.0.1', 'DNS A lookup via lease DNS server', ip);
  await dev.resolve('host.test');
  ok(dns.queries.filter((q) => q === 'host.test').length === 1, 'DNS answer cached');
  ok(await dev.resolve('nope.test').then(() => 'ok', (e) => e.message) === 'NXDOMAIN', 'NXDOMAIN reported');
  ok(await dev.resolve('1.2.3.4') === '1.2.3.4', 'literal IP passes through');

  // UDP
  const echo = peer.udpBind(7777);
  echo.onmessage = (b, rip, rp) => echo.send(rip, rp, b);
  const u = dev.udpBind(0); let got = null;
  u.onmessage = (b, rip, rp) => { got = { b, rip, rp }; };
  u.send('10.7.0.1', 7777, Buffer.from('hello udp'));
  ok(await until(() => got), 'UDP echo round trip');
  ok(got && got.b.toString() === 'hello udp' && got.rip === '10.7.0.1' && got.rp === 7777, 'UDP payload/source', got && got.rip);
  const big = pat(1400); let gb = null; u.onmessage = (b) => { gb = b; };
  u.send('10.7.0.1', 7777, big);
  ok(await until(() => gb) && gb.equals(big), 'UDP 1400-byte datagram');

  // TCP: device connects to peer echo
  const srvConns = [];
  const lst = peer.tcpListen(8000, (s) => { srvConns.push(s); s.ondata = (d) => { s.write(d); s.consume(d.length); }; s.oneof = () => s.close(); });
  const c = dev.tcpConnect('10.7.0.1', 8000);
  let connected = false; c.onconnect = () => { connected = true; };
  ok(await until(() => connected), 'TCP connect to peer listener (3-way handshake)');
  let rx = []; c.ondata = (d) => { rx.push(d); c.consume(d.length); };
  c.write(Buffer.from('ping'));
  ok(await until(() => Buffer.concat(rx).toString() === 'ping'), 'TCP echo small');
  const N = 600000, data = pat(N, 3); rx = [];
  let sentAck = 0; c.onsent = (n) => { sentAck += n; };
  c.write(data);
  ok(await until(() => Buffer.concat(rx).length >= N, 30000), 'TCP 600 KB echo completes');
  ok(Buffer.concat(rx).equals(data), 'TCP 600 KB echo intact');
  ok(sentAck === N + 0 || sentAck >= N, 'onsent accounts all bytes', sentAck);
  let closed = false, cerr = 'x'; c.onclose = (e) => { closed = true; cerr = e; };
  c.close();
  ok(await until(() => closed, 10000) && cerr === null, 'graceful close both directions', cerr);
  ok(await until(() => dev.tcp.size === 0 && peer.tcp.size === 0, 8000), 'no leaked TCP state (TIME_WAIT expires)', [dev.tcp.size, peer.tcp.size]);

  // refused
  const r = dev.tcpConnect('10.7.0.1', 9); let rerr = null; r.onclose = (e) => { rerr = e; };
  ok(await until(() => rerr) && rerr === 'refused', 'connect to closed port -> refused (RST)', rerr);

  // peer connects to device listener (inbound)
  let accepted = null, srvData = [];
  dev.tcpListen(6000, (s) => { accepted = s; s.ondata = (d) => { srvData.push(d); s.consume(d.length); s.write(Buffer.from('ACK:' + d.toString())); }; });
  const pc = peer.tcpConnect('10.7.0.100', 6000); let pcrx = []; pc.ondata = (d) => { pcrx.push(d); pc.consume(d.length); };
  pc.onconnect = () => pc.write(Buffer.from('inbound'));
  ok(await until(() => Buffer.concat(pcrx).toString() === 'ACK:inbound'), 'device listener accepts inbound TCP from LAN');
  ok(accepted && accepted.rip === 0x0a070001, 'accepted peer address');
  pc.close(); await until(() => accepted && accepted.state === 'CLOSE_WAIT');
  ok(accepted.state === 'CLOSE_WAIT' || accepted.state === 'CLOSED', 'listener sees remote FIN', accepted.state);
  accepted.close();

  // flow control: receiver withholds consume -> sender stalls, then completes after consume
  let slow = null, slowRx = 0;
  peer.tcpListen(8100, (s) => { slow = s; s.credit = 4000; s.ondata = (d) => { slowRx += d.length; }; });
  const fc = dev.tcpConnect('10.7.0.1', 8100); fc.onconnect = () => fc.write(pat(50000, 9));
  await wait(1500);
  ok(slowRx <= 4000 && slowRx > 0, 'receive window limits sender (zero-window stall)', slowRx);
  let freed = 0; const t0 = Date.now();
  while (slowRx < 50000 && Date.now() - t0 < 20000) { const n = slowRx - freed; if (n) { freed += n; slow.consume(n); } await wait(30); }
  ok(slowRx === 50000, 'window reopens, remaining data delivered', slowRx);
  fc.abort(); await wait(100);

  // loss: 8% frame loss both directions, 150 KB must still arrive intact
  hub.loss = 0.08;
  const lc = dev.tcpConnect('10.7.0.1', 8000); let lrx = [], lconn = false; lc.onconnect = () => { lconn = true; }; lc.ondata = (d) => { lrx.push(d); lc.consume(d.length); };
  await until(() => lconn, 20000);
  const L = pat(150000, 5); lc.write(L);
  ok(await until(() => Buffer.concat(lrx).length >= L.length, 90000) && Buffer.concat(lrx).equals(L), 'TCP survives 8% frame loss (retransmission)');
  hub.loss = 0; lc.abort(); await wait(200);

  // reset from peer
  const rc = dev.tcpConnect('10.7.0.1', 8000); let rcerr = 'none'; rc.onclose = (e) => { rcerr = e; };
  await until(() => rc.state === 'ESTABLISHED'); srvConns[srvConns.length - 1].abort();
  ok(await until(() => rcerr !== 'none') && rcerr === 'reset', 'peer RST surfaces as reset', rcerr);

  // lease renew (t1=2s): DHCP REQUEST unicast, still bound, same address
  const before = dhcp.log.filter((l) => l.type === 3).length;
  await wait(2600);
  ok(dhcp.log.filter((l) => l.type === 3).length > before && dev.info().up && dev.info().ip === '10.7.0.100', 'lease renewed at T1 without losing the address', dev.info());
  dev.close(); peer.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall stack tests passed');
  process.exit(bad ? 1 : 0);
})();
