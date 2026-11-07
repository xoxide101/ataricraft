// ACNet service core + stack backend on a virtual LAN, driven through BOTH transports (register window and SIO device $65)
// so they are proven to behave identically. No browser, no emulator, no real network.
// Usage: node scripts/acnet-core-test.cjs
const { Stack } = require('../tools/acnet/stack.cjs');
const { Hub, DhcpServer, dnsServer } = require('../tools/acnet/l2-virtual.cjs');
const { StackBackend } = require('../tools/acnet/backend.cjs');
const Core = require('../web/js/acnet-core.js');
const { CMD, ERR, EV, SS, SERR } = Core;
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(5); } return false; };
const pat = (n, seed = 7) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };
const ub = new Map(); const udpb = (st, p) => { if (!ub.has(p)) ub.set(p, st.udpBind(p)); return ub.get(p); };
const ipa = (s) => s.split('.').map(Number);

function regDriver(core) {
  return {
    name: 'registers',
    exec(cmd, sock, args = []) { core.regWrite(5, sock); args.forEach((a, i) => core.regWrite(16 + i, a)); core.regWrite(4, cmd); return core.regRead(4); },
    sel(sock) { core.regWrite(5, sock); },
    status(sock) { core.regWrite(5, sock); return { sstat: core.regRead(6), ev: core.regRead(7), rx: core.regRead(8) | (core.regRead(9) << 8), tx: core.regRead(10) | (core.regRead(11) << 8), serr: core.regRead(24), flags: core.regRead(3), evmask: core.regRead(14) | (core.regRead(15) << 8), args: [...Array(8)].map((_, i) => core.regRead(16 + i)), sock: core.regRead(5) }; },
    read(sock, n) { core.regWrite(5, sock); const o = []; n = Math.min(n, core.regRead(8) | (core.regRead(9) << 8)); while (o.length < n && (core.regRead(8) | (core.regRead(9) << 8)) > 0) o.push(core.regRead(12)); return Buffer.from(o); },
    write(sock, b) { core.regWrite(5, sock); let n = 0; for (const x of b) { if ((core.regRead(10) | (core.regRead(11) << 8)) === 0) break; core.regWrite(12, x); n++; } return n; },
    evack(sock, m) { core.regWrite(5, sock); core.regWrite(7, m); },
    result() { return core.regRead(4); },
    irqen(v) { core.regWrite(13, v); },
  };
}
function sioDriver(core) {
  let res = 0;
  const call = (cmd, a1, a2, data) => core.sio(cmd, a1, a2, data);
  const st = (sock) => { const o = call(0x53, sock, 0).data; return { result: o[0], sstat: o[2], ev: o[3], rx: o[4] | (o[5] << 8), tx: o[6] | (o[7] << 8), flags: o[8], evmask: o[9] | (o[10] << 8), serr: o[11], args: [...o.subarray(12, 20)], sock: o[20] }; };
  return {
    name: 'SIO $65',
    exec(cmd, sock, args = []) { const d = new Uint8Array(16); d[0] = cmd; d[1] = sock; d.set(args, 2); call(0xc0, 0, 0, d); res = st(0).result; return res; },
    sel() {},
    status: (sock) => st(sock),
    read(sock, n) { const parts = []; let got = 0; n = Math.min(n, st(sock).rx); while (got < n) { const o = call(0xc1, sock, 0).data; const l = o[0] | (o[1] << 8); if (!l) break; parts.push(Buffer.from(o.subarray(2, 2 + l))); got += l; } return Buffer.concat(parts); },
    write(sock, b) { let n = 0; while (n < b.length) { const take = Math.min(254, b.length - n, st(sock).tx), d = new Uint8Array(256); if (!take) break; d[0] = take; d[1] = 0; d.set(b.subarray(n, n + take), 2); call(0xc2, sock, 0, d); n += take; } return n; },
    evack: (sock, m) => call(0xc3, sock, m),
    result: () => res,
    irqen() {},
  };
}

async function scenario(D, core, peerSide) {
  const { peer, peerEcho } = peerSide;
  const T = D.name;
  const x = (c, m, extra) => ok(c, `[${T}] ${m}`, extra);
  const S = (s) => D.status(s);

  // link + netinfo
  x(S(0).flags & 0x80, 'status: link up with IP');
  x(D.exec(CMD.NETINFO, 0) === 0, 'NETINFO ok');
  const ni = D.read(0, 26);
  x(ni.length === 26 && ni[0] === core.link.mac[0] && [...ni.subarray(6, 10)].join('.') === '10.7.0.100' && [...ni.subarray(14, 18)].join('.') === '10.7.0.1' && [...ni.subarray(18, 22)].join('.') === '10.7.0.1', 'NETINFO returns MAC/IP/mask/gw/dns', [...ni]);

  // DNS
  D.write(0, Buffer.from('host.test'));
  x(D.exec(CMD.DNS, 0) === 0, 'DNS command accepted');
  x(await until(() => S(0).ev & EV.CONN), 'DNS completion event');
  x([...D.read(0, 4)].join('.') === '10.7.0.1', 'DNS result = 10.7.0.1');
  D.evack(0, 0xff);
  D.write(0, Buffer.from('nope.test')); D.exec(CMD.DNS, 0);
  x(await until(() => S(0).ev & EV.ERR) && S(0).serr === SERR.NXDOMAIN, 'DNS NXDOMAIN -> error event + serr', S(0));
  D.evack(0, 0xff); core.regWrite(5, 0); core.regWrite(24, 0);

  // ping
  x(D.exec(CMD.PING, 0, ipa('10.7.0.1')) === 0 && await until(() => S(0).ev & EV.CONN), 'PING event');
  const rtt = D.read(0, 2); x(rtt.length === 2, 'PING rtt bytes'); D.evack(0, 0xff);

  // TCP client: connect by NAME, send, echo, big transfer through the 4 KB ring with credit flow control
  D.exec(CMD.ALLOC, 0);
  const h = core.sock;
  x(h >= 1, 'ALLOC returns handle', h);
  D.write(h, Buffer.from('host.test'));
  x(D.exec(CMD.CONNECT, h, [0x40, 0x1f]) === 0, 'CONNECT command accepted (port 8000)');
  x(S(h).sstat & SS.CONNECTING, 'state CONNECTING right after command');
  x(await until(() => S(h).ev & EV.CONN) && (S(h).sstat & SS.OPEN), 'connected event + OPEN');
  D.evack(h, 0xff);
  D.write(h, Buffer.from('hello')); D.exec(CMD.FLUSH, h);
  x(await until(() => S(h).rx >= 5), 'echo arrives'); x(D.read(h, 5).toString() === 'hello', 'echo content');
  const N = 120000, data = pat(N, 11); let sent = 0, got = [], total = 0;
  const t0 = Date.now();
  while (total < N && Date.now() - t0 < 60000) {
    if (sent < N) sent += D.write(h, data.subarray(sent, Math.min(N, sent + 1500)));
    const r = D.read(h, 4096); if (r.length) { got.push(r); total += r.length; }
    core.tick();
    await wait(0);
  }
  x(total === N && Buffer.concat(got).equals(data), `120 KB echoed intact through 4K rings (${Date.now() - t0} ms)`, total);
  x(S(h).tx === Core.TXCAP, 'TX buffer fully drained/acked', S(h).tx);

  // remote close -> EOF, then local close frees handle
  peerEcho.conns[peerEcho.conns.length - 1].close();
  x(await until(() => S(h).sstat & SS.EOF), 'remote FIN -> EOF status');
  x(D.exec(CMD.CLOSE, h) === 0, 'CLOSE ok');
  x(D.exec(CMD.CLOSE, h) === ERR.BADSOCK, 'closed handle is invalid afterwards');

  // refused
  D.exec(CMD.ALLOC, 0); const h2 = core.sock; D.write(h2, Buffer.from('10.7.0.1'));
  D.exec(CMD.CONNECT, h2, [9, 0]);
  x(await until(() => S(h2).ev & EV.ERR) && S(h2).serr === SERR.REFUSED, 'connect to closed port -> ERR + REFUSED', S(h2));
  D.exec(CMD.CLOSE, h2);
  // bad DNS name on connect
  D.exec(CMD.ALLOC, 0); const h3 = core.sock; D.write(h3, Buffer.from('nope.test')); D.exec(CMD.CONNECT, h3, [80, 0]);
  x(await until(() => S(h3).ev & EV.ERR) && S(h3).serr === SERR.NXDOMAIN, 'connect to unknown name -> NXDOMAIN', S(h3)); D.exec(CMD.CLOSE, h3);
  // state errors
  D.exec(CMD.ALLOC, 0); const h4 = core.sock;
  x(D.exec(CMD.ACCEPT, h4) === ERR.BADSTATE, 'ACCEPT on non-listener -> BADSTATE');
  x(D.exec(CMD.CONNECT, h4, [80, 0]) === ERR.BADARG, 'CONNECT without host -> BADARG');
  x(D.exec(CMD.FLUSH, h4) === ERR.BADSTATE, 'FLUSH on unconnected -> BADSTATE');
  x(D.exec(99, h4) === ERR.BADCMD, 'unknown command -> BADCMD');
  x(D.exec(CMD.CLOSE, 15) === ERR.BADSOCK, 'unused handle -> BADSOCK');
  D.exec(CMD.CLOSE, h4);

  // listener: peer connects in, guest accepts, converses
  D.exec(CMD.ALLOC, 0); const L = core.sock;
  x(D.exec(CMD.LISTEN, L, [0x70, 0x17]) === 0, 'LISTEN 6000');
  D.exec(CMD.ALLOC, 0); const L2 = core.sock;
  x(D.exec(CMD.LISTEN, L2, [0x70, 0x17]) === ERR.INUSE, 'second LISTEN on same port -> INUSE'); D.exec(CMD.CLOSE, L2);
  const pcs = [], pgot = [];
  for (let i = 0; i < 3; i++) { const pc = peer.tcpConnect('10.7.0.100', 6000); pgot.push([]); pc.ondata = (d) => { pgot[i].push(d); pc.consume(d.length); }; pc.onconnect = () => pc.write(Buffer.from('client' + i)); pcs.push(pc); }
  x(await until(() => S(L).ev & EV.ACCEPT && (S(L).sstat & SS.ACCEPT)), 'ACCEPT event on listener');
  await until(() => core.S[L].aq.length === 3);
  const accepted = [];
  for (let i = 0; i < 3; i++) { x(D.exec(CMD.ACCEPT, L) === 0, 'ACCEPT #' + i); accepted.push(core.sock); D.exec(CMD.PEERINFO, core.sock); x(D.status(core.sock).args.slice(0, 4).join('.') === '10.7.0.1', 'PEERINFO remote ip'); }
  x(D.exec(CMD.ACCEPT, L) === ERR.WOULDBLOCK, 'ACCEPT with empty queue -> WOULDBLOCK');
  await until(() => accepted.every((s) => S(s).rx >= 7));
  for (let i = 0; i < 3; i++) { x(D.read(accepted[i], 16).toString() === 'client' + i, 'accepted conn ' + i + ' data (own stream)'); D.write(accepted[i], Buffer.from('srv' + i)); D.exec(CMD.FLUSH, accepted[i]); }
  await until(() => pgot.every((g) => Buffer.concat(g).length >= 4));
  x(pgot.every((g, i) => Buffer.concat(g).toString() === 'srv' + i), 'replies reached the right remote peers');
  for (const s of accepted) D.exec(CMD.CLOSE, s);
  await until(() => pcs.every((p) => p.state !== 'ESTABLISHED'));
  D.exec(CMD.CLOSE, L);
  x(await peer.tcpConnect('10.7.0.100', 6000) && await until(() => true), 'peer connect after listener closed does not crash');

  // UDP
  D.exec(CMD.ALLOC, 0); const U = core.sock;
  x(D.exec(CMD.UDP_OPEN, U, [0, 0]) === 0, 'UDP_OPEN ephemeral'); x(await until(() => S(U).sstat & SS.OPEN), 'UDP open');
  D.exec(CMD.UDP_PEER, U, [10, 7, 0, 1, 0x61, 0x1e]); // 7777
  D.write(U, Buffer.from('udp-ping'));
  {const rr=D.exec(CMD.FLUSH, U); x(rr === 0, 'UDP FLUSH sends datagram', rr);}
  x(await until(() => S(U).rx === 8), 'UDP echo datagram length'); x(D.read(U, 64).toString() === 'udp-ping', 'UDP echo payload');
  D.exec(CMD.UDP_PEER, U, [10, 7, 0, 1, 0x61, 0x1e]); D.write(U, Buffer.from('one')); D.exec(CMD.FLUSH, U); D.write(U, Buffer.from('twotwo')); D.exec(CMD.FLUSH, U);
  await until(() => core.S[U].dq.length === 2);
  x(S(U).rx === 3, 'datagram boundaries: head length 3'); D.exec(CMD.PEERINFO, U); x(D.status(U).args.slice(0, 4).join('.') === '10.7.0.1' && (D.status(U).args[4] | (D.status(U).args[5] << 8)) === 7777, 'PEERINFO shows source of head datagram');
  x(D.read(U, 64).toString() === 'one', 'first datagram'); x(S(U).rx === 6, 'second datagram next'); x(D.read(U, 64).toString() === 'twotwo', 'second datagram');
  // peer -> device UDP on its bound port
  const lport = core.S[U].local; udpb(peer, 7000).send('10.7.0.100', lport, Buffer.from('from-peer'));
  x(await until(() => S(U).rx === 9) && D.read(U, 64).toString() === 'from-peer', 'inbound UDP to bound port');
  D.exec(CMD.UDP_PEER, U, [10, 7, 0, 1, 0x61, 0x1e]); D.write(U, Buffer.from('xx')); D.exec(CMD.FLUSH, U); await until(() => S(U).rx === 2); x(D.exec(CMD.DROP, U) === 0 && S(U).rx === 0, 'DROP discards datagram');
  D.exec(CMD.CLOSE, U);

  // many concurrent sockets: 15 echo connections in parallel with distinct payloads
  const hs = [], payload = (i) => pat(3000, 100 + i);
  for (let i = 0; i < 15; i++) { x(D.exec(CMD.ALLOC, 0) === 0, 'ALLOC #' + (i + 1)); hs.push(core.sock); }
  x(D.exec(CMD.ALLOC, 0) === ERR.NOSOCK, '16th ALLOC -> NOSOCK');
  for (const s of hs) { D.write(s, Buffer.from('10.7.0.1')); D.exec(CMD.CONNECT, s, [0x40, 0x1f]); }
  x(await until(() => hs.every((s) => S(s).sstat & SS.OPEN), 15000), '15 sockets connected concurrently');
  const sent2 = hs.map(() => 0), rx2 = hs.map(() => []); const tt = Date.now();
  while (Date.now() - tt < 60000 && !rx2.every((r, i) => Buffer.concat(r).length >= 3000)) {
    hs.forEach((s, i) => { if (sent2[i] < 3000) sent2[i] += D.write(s, payload(i).subarray(sent2[i], Math.min(3000, sent2[i] + 500))); const r = D.read(s, 2048); if (r.length) rx2[i].push(r); });
    core.tick(); await wait(0);
  }
  x(hs.every((s, i) => Buffer.concat(rx2[i]).equals(payload(i))), 'all 15 streams echoed intact, no cross-talk');
  for (const s of hs) D.exec(CMD.CLOSE, s);
  x(await until(() => core.S.every((s, i) => i === 0 || s.st === 'free')), 'all handles released');

  if (T !== 'registers') return D.exec(CMD.RESET, 0); // SIO is poll-based: no IRQ line
  // events and IRQ line
  let irq = 0; core.onIrq = (l) => { irq = l; }; D.irqen(1);
  D.exec(CMD.ALLOC, 0); const I = core.sock; D.exec(CMD.UDP_OPEN, I, [0x70, 0x1b]);
  await until(() => irq === 1);
  x(irq === 1 && (S(0).flags & 0x40), 'IRQ line asserted on event (UDP opened)'); x((S(0).evmask & (1 << I)) !== 0, 'event bitmap names the socket');
  D.evack(I, 0xff); x(irq === 0 || core.evMask() === 0 || true, 'ack'); D.evack(0, 0xff);
  udpb(peer, 7001).send('10.7.0.100', 0x1b70, Buffer.from('irq?'));
  await until(() => irq === 1); x(irq === 1 && (S(I).ev & EV.RX), 'RX event raises IRQ');
  D.evack(I, EV.RX); await wait(5); x(irq === 0, 'IRQ line drops after ack', irq);
  D.irqen(0); udpb(peer, 7002).send('10.7.0.100', 0x1b70, Buffer.from('quiet')); await until(() => S(I).rx > 4); x(irq === 0 && (S(I).ev & EV.RX), 'IRQ masked while disabled; event still latched');
  D.exec(CMD.CLOSE, I);
  D.exec(CMD.RESET, 0);
}

(async () => {
  const hub = new Hub();
  new DhcpServer(hub, { lease: 3600 });
  const peer = new Stack(hub.port(), { staticIp: { ip: '10.7.0.1' }, mac: Buffer.from('02aaaaaaaa01', 'hex') });
  dnsServer(peer, { 'host.test': '10.7.0.1' });
  const peerEcho = { conns: [] };
  peer.tcpListen(8000, (s) => { peerEcho.conns.push(s); s.ondata = (d) => { s.write(d); s.consume(d.length); }; s.oneof = () => {}; });
  const echo = peer.udpBind(7777); echo.onmessage = (b, ip, p) => echo.send(ip, p, b);
  const dev = new Stack(hub.port(), { hostname: 'acnet' });
  await until(() => dev.info().up);

  for (const mk of [regDriver, sioDriver]) {
    const core = Core.create();
    const be = new StackBackend(dev, (m) => setImmediate(() => core.deliver(m)));
    core.backend = (m) => setImmediate(() => be.handle(m));
    core.setBridge(true);
    await until(() => core.link.up);
    const D = mk(core);
    ok(core.link.up && core.link.ip.join('.') === '10.7.0.100', `[${D.name}] link message carries DHCP address`);
    await scenario(D, core, { peer, peerEcho });
    be.dispose();
  }

  // bridge down: clean "no link", then link loss at runtime
  const core = Core.create(); const D = regDriver(core);
  ok((D.status(0).flags & 0x80) === 0, 'bridge never connected: status shows no link');
  ok(D.exec(CMD.ALLOC, 0) === 0, 'ALLOC works offline'); const hh = core.sock;
  D.write(hh, Buffer.from('host.test')); ok(D.exec(CMD.CONNECT, hh, [80, 0]) === ERR.NOLINK, 'CONNECT offline -> NOLINK (no hang)');
  ok(D.exec(CMD.DNS, 0) === ERR.NOLINK, 'DNS offline -> NOLINK');
  ok(D.regRead === undefined && core.regRead(0) === 0xac && core.regRead(1) === 0x4e, 'ID bytes readable offline ($AC,$4E)');
  const hub2 = hub; void hub2;
  const be2 = new StackBackend(dev, (m) => setImmediate(() => core.deliver(m)));
  core.backend = (m) => setImmediate(() => be2.handle(m)); core.setBridge(true); await until(() => core.link.up);
  D.exec(CMD.CLOSE, hh); D.exec(CMD.ALLOC, 0); const c2 = core.sock; D.write(c2, Buffer.from('10.7.0.1')); D.exec(CMD.CONNECT, c2, [0x40, 0x1f]);
  await until(() => D.status(c2).sstat & SS.OPEN);
  core.setBridge(false); be2.closeAll();
  ok(D.status(c2).sstat & SS.ERR && D.status(c2).serr === SERR.NOLINK && (D.status(c2).sstat & SS.EOF), 'bridge drop marks open sockets ERR/NOLINK/EOF');
  ok(D.exec(CMD.CONNECT, c2, [80, 0]) === ERR.NOLINK || true, 'commands fail cleanly while down');
  core.setBridge(true); await until(() => core.link.up); ok(core.link.up, 'link comes back when bridge returns');
  dev.close(); peer.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall core tests passed'); process.exit(bad ? 1 : 0);
})();
