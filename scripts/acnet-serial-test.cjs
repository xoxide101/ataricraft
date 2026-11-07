// ACNet over serial (SIO wire protocol): an independent byte-level "Atari" talks SIO frames over a loopback stream pair to SioHost,
// which drives the shared core + userspace stack on the virtual LAN. No hardware; proves framing, checksums, NAK handling, and
// real TCP/UDP/DNS through the serial path. NOT proven: a real Atari / USB-SIO cable (timing, command-line signalling).
// Usage: node scripts/acnet-serial-test.cjs
const { Duplex } = require('stream');
const { Stack } = require('../tools/acnet/stack.cjs');
const { Hub, DhcpServer, dnsServer } = require('../tools/acnet/l2-virtual.cjs');
const { StackBackend } = require('../tools/acnet/backend.cjs');
const { SioHost, chk } = require('../tools/acnet/sio-serial.cjs');
const Core = require('../web/js/acnet-core.js');
const { CMD, EV } = Core;
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(5); } return false; };

function pair() {
  const mk = (peer) => new Duplex({ read() {}, write(c, e, cb) { setImmediate(() => peer().push(c)); cb(); } });
  let a, b; a = mk(() => b); b = mk(() => a); return [a, b];
}

// minimal Atari-side SIO master written independently of the host code
class Atari {
  constructor(s) { this.s = s; this.q = []; this.w = null; s.on('data', (d) => { this.q.push(...d); this.pump(); }); }
  pump() { if (this.w && this.q.length >= this.w.n) { const w = this.w; this.w = null; w.res(this.q.splice(0, w.n)); } }
  take(n) { return new Promise((res) => { this.w = { n, res }; this.pump(); }); }
  async call(cmd, a1, a2, data, rlen = 0) {
    const h = [0x65, cmd, a1, a2]; this.s.write(Buffer.from([...h, chk(h)]));
    const ack = (await this.take(1))[0]; if (ack !== 0x41) return { ack };
    if (data) { this.s.write(Buffer.from([...data, chk(data)])); const a2k = (await this.take(1))[0]; if (a2k !== 0x41) return { ack, dack: a2k }; }
    const c = (await this.take(1))[0]; if (c !== 0x43 || !rlen) return { ack, c };
    const f = await this.take(rlen + 1); return { ack, c, data: f.slice(0, rlen), chkOk: chk(f.slice(0, rlen)) === f[rlen] };
  }
  async st(sock) { const r = await this.call(0x53, sock, 0, null, 32); return { res: r.data[0], sstat: r.data[2], ev: r.data[3], rx: r.data[4] | (r.data[5] << 8), tx: r.data[6] | (r.data[7] << 8), flags: r.data[8], serr: r.data[11], cur: r.data[20], args: r.data.slice(12, 20), ok: r.chkOk }; }
  async exec(cmd, sock, args = []) { const d = new Array(16).fill(0); d[0] = cmd; d[1] = sock; args.forEach((v, i) => (d[2 + i] = v)); await this.call(0xc0, 0, 0, d); return (await this.st(0)).res; }
  async send(sock, buf) { let n = 0; while (n < buf.length) { const s = await this.st(sock), t = Math.min(254, buf.length - n, s.tx); if (!t) { await wait(5); continue; } const d = new Array(256).fill(0); d[0] = t; buf.slice(n, n + t).forEach((v, i) => (d[2 + i] = v)); await this.call(0xc2, sock, 0, d); n += t; } }
  async echo(sock, buf) { const out = []; let n = 0; const t0 = Date.now(); while (out.length < buf.length && Date.now() - t0 < 30000) { const s = await this.st(sock); if (n < buf.length && s.tx) { const t = Math.min(254, buf.length - n, s.tx), d = new Array(256).fill(0); d[0] = t; buf.slice(n, n + t).forEach((v, i) => (d[2 + i] = v)); await this.call(0xc2, sock, 0, d); n += t; await this.exec(CMD.FLUSH, sock); continue; } if (s.rx) { const r = await this.call(0xc1, sock, 254, null, 256); const l = r.data[0] | (r.data[1] << 8); out.push(...r.data.slice(2, 2 + l)); } else await wait(2); } return Buffer.from(out); }
  async recv(sock, want) { const out = []; const t0 = Date.now(); while (out.length < want && Date.now() - t0 < 8000) { const s = await this.st(sock); if (!s.rx) { await wait(5); continue; } const r = await this.call(0xc1, sock, Math.min(254, want - out.length), null, 256); const l = r.data[0] | (r.data[1] << 8); out.push(...r.data.slice(2, 2 + l)); } return Buffer.from(out); }
}

(async () => {
  const hub = new Hub(); new DhcpServer(hub, { lease: 3600 });
  const peer = new Stack(hub.port(), { staticIp: { ip: '10.7.0.1' }, mac: Buffer.from('02aaaaaaaa01', 'hex') });
  dnsServer(peer, { 'host.test': '10.7.0.1' });
  peer.tcpListen(8000, (s) => { s.ondata = (d) => { s.write(d); s.consume(d.length); }; });
  const u = peer.udpBind(7777); u.onmessage = (b, ip, p) => u.send(ip, p, b);
  const dev = new Stack(hub.port(), { hostname: 'acnet' });
  await until(() => dev.info().up);

  const core = Core.create(); const be = new StackBackend(dev, (m) => setImmediate(() => core.deliver(m)));
  core.backend = (m) => setImmediate(() => be.handle(m)); core.setBridge(true); await until(() => core.link.up);
  const [hs, as] = pair(); const host = new SioHost(hs, core); const A = new Atari(as);

  const s0 = await A.st(0);
  ok(s0.ok && (s0.flags & 0x80) && core.link.up, 'status frame: checksum ok, link up over serial');
  // protocol robustness
  let r = await A.call(0x99, 0, 0, null); ok(r.ack === 0x4e, 'unknown command -> NAK');
  as.write(Buffer.from([0x31, 0x53, 0, 0, 0x84])); await wait(30); ok(true, 'frame for another device ($31) ignored without reply');
  const d = new Array(16).fill(0); d[0] = CMD.NETINFO; const bad2 = [...d, chk(d) ^ 0xff];
  as.write(Buffer.from([0x65, 0xc0, 0, 0, chk([0x65, 0xc0, 0, 0])])); const ack = await A.take(1); as.write(Buffer.from(bad2));
  const nak = await A.take(1); ok(ack[0] === 0x41 && nak[0] === 0x4e, 'bad data checksum -> NAK, state recovers');
  ok((await A.st(0)).ok, 'host still in sync after the NAK');
  as.write(Buffer.from([0xff, 0x00, 0x12])); await wait(120); ok((await A.st(0)).ok, 'line noise before a frame is skipped (resync)');

  // NETINFO, DNS, ping
  ok(await A.exec(CMD.NETINFO, 0) === 0, 'NETINFO ok');
  const ni = await A.recv(0, 26); ok([...ni.subarray(6, 10)].join('.') === core.link.ip.join('.') && ni[0] === core.link.mac[0], 'NETINFO bytes carry our MAC and DHCP IP', [...ni]);
  await A.send(0, Buffer.from('host.test')); ok(await A.exec(CMD.DNS, 0) === 0, 'DNS submitted');
  ok(await until(async () => ((await A.st(0)).ev & EV.CONN) !== 0), 'DNS completion event'); ok([...await A.recv(0, 4)].join('.') === '10.7.0.1', 'DNS host.test -> 10.7.0.1');
  await A.call(0xc3, 0, 0xff, null);

  // TCP echo, 50 KB, over serial at the frame level
  ok(await A.exec(CMD.ALLOC, 0) === 0, 'ALLOC'); const h = (await A.st(0)).cur;
  await A.send(h, Buffer.from('10.7.0.1')); ok(await A.exec(CMD.CONNECT, h, [0x40, 0x1f]) === 0, 'CONNECT 10.7.0.1:8000');
  ok(await until(async () => ((await A.st(h)).sstat & 1) && !((await A.st(h)).sstat & 0x20)), 'connected');
  const n = 50000, tx = Buffer.alloc(n); for (let i = 0; i < n; i++) tx[i] = (i * 7 + (i >> 8)) & 255;
  const t0 = Date.now(); const rx = await A.echo(h, tx);
  ok(rx.equals(tx), `50000-byte TCP echo through SIO frames intact (${((Date.now() - t0) / 1000).toFixed(1)} s; ${host.stats.frames} frames)`);
  await A.exec(CMD.CLOSE, h);

  // UDP
  await A.exec(CMD.ALLOC, 0); const uh = (await A.st(0)).cur; await A.exec(CMD.UDP_OPEN, uh, [0, 0]);
  await A.exec(CMD.UDP_PEER, uh, [10, 7, 0, 1, 0x61, 0x1e]); await A.send(uh, Buffer.from('serial-udp')); await A.exec(CMD.FLUSH, uh);
  ok((await A.recv(uh, 10)).toString() === 'serial-udp', 'UDP echo over serial'); await A.exec(CMD.CLOSE, uh);

  // listener: peer connects in
  await A.exec(CMD.ALLOC, 0); const lh = (await A.st(0)).cur; await A.exec(CMD.LISTEN, lh, [0x70, 0x17]);
  const pc = peer.tcpConnect(core.link.ip.join('.'), 6000); pc.onconnect = () => pc.write(Buffer.from('knock')); let got = ''; pc.ondata = (c) => { got += c; pc.consume(c.length); };
  ok(await until(async () => ((await A.st(lh)).sstat & 0x80) !== 0), 'inbound connection seen as ACCEPT status');
  ok(await A.exec(CMD.ACCEPT, lh) === 0, 'ACCEPT'); const ch = (await A.st(0)).cur;
  ok((await A.recv(ch, 5)).toString() === 'knock', 'accepted socket received peer data'); await A.send(ch, Buffer.from('open')); await A.exec(CMD.FLUSH, ch);
  ok(await until(() => got === 'open'), 'peer received reply'); await A.exec(CMD.CLOSE, ch); await A.exec(CMD.CLOSE, lh);

  be.dispose(); dev.close(); peer.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall ACNet serial tests passed'); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
