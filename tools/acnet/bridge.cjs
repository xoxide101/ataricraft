'use strict';
// ACNet bridge: WebSocket server (browser emulator) in front of the userspace IP stack on a raw L2 backend.
//   node tools\acnet\bridge.cjs [--l2 pcap|virtual] [--adapter NAME] [--port 8765] [--host 127.0.0.1] [--hostname acnet]
// JSON text frames; binary payloads are base64 in the "data" field. One browser client at a time owns the device.
const http = require('http');
const crypto = require('crypto');
const { Stack, randomMac } = require('./stack.cjs');
const { StackBackend } = require('./backend.cjs');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsSend(sock, text) {
  const p = Buffer.from(text), n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  if (!sock.destroyed) sock.write(Buffer.concat([h, p]));
}

// Minimal RFC 6455 frame parser (text, ping, close; masked client frames).
function wsParser(onText, onClose, sock) {
  let buf = Buffer.alloc(0), frag = null;
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, fin = buf[0] & 128; let len = buf[1] & 127, o = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
      const masked = buf[1] & 128; if (masked) o += 4;
      if (buf.length < o + len) return;
      const pl = Buffer.from(buf.subarray(o, o + len));
      if (masked) for (let i = 0; i < len; i++) pl[i] ^= buf[o - 4 + (i & 3)];
      buf = buf.subarray(o + len);
      if (op === 8) { onClose(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, len]), pl])); continue; }
      if (op === 1 || op === 0) {
        frag = op === 1 ? [pl] : (frag || []).concat([pl]);
        if (fin) { const t = Buffer.concat(frag).toString('utf8'); frag = null; onText(t); }
      }
    }
  };
}

const enc = (m) => JSON.stringify(m, function (k, v) { const o = this[k]; return k === 'data' && o && (o.buffer || Buffer.isBuffer(o)) ? { b64: Buffer.from(o).toString('base64') } : v; });
const dec = (t) => JSON.parse(t, (k, v) => (v && typeof v === 'object' && typeof v.b64 === 'string' ? new Uint8Array(Buffer.from(v.b64, 'base64')) : v));

function startBridge({ stack, port = 8765, host = '127.0.0.1', log = () => {} }) {
  let owner = null;
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('ACNet bridge\n'); });
  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    if (owner) { sock.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return; }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
    sock.setNoDelay(true);
    const be = new StackBackend(stack, (m) => wsSend(sock, enc(m)));
    owner = sock; log('client connected');
    let gone = false;
    const bye = () => { if (gone) return; gone = true; be.dispose(); if (owner === sock) owner = null; log('client gone'); sock.destroy(); };
    sock.on('data', wsParser((t) => { try { be.handle(dec(t)); } catch (e) { log('bad msg ' + e.message); } }, bye, sock));
    sock.on('close', bye); sock.on('error', bye);
  });
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, host, () => res({ server, port: server.address().port, close: () => new Promise((r) => { if (owner) owner.destroy(); server.close(() => r()); }) }));
  });
}

async function main() {
  const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const l2name = opt('l2', 'pcap'), hostname = opt('hostname', 'acnet'), port = +opt('port', 8765);
  let l2;
  if (l2name === 'virtual') {
    const { Hub, DhcpServer, dnsServer } = require('./l2-virtual.cjs');
    const hub = new Hub(); new DhcpServer(hub, { lease: 3600 });
    const peer = new Stack(hub.port(), { staticIp: { ip: '10.7.0.1' }, mac: Buffer.from('02aaaaaaaa01', 'hex') });
    dnsServer(peer, { 'host.test': '10.7.0.1' });
    peer.tcpListen(8000, (s) => { s.ondata = (d) => { s.write(d); s.consume(d.length); }; });
    const u = peer.udpBind(7777); u.onmessage = (b, ip, p) => u.send(ip, p, b);
    l2 = hub.port();
    console.log('virtual LAN: peer 10.7.0.1 (DNS host.test, TCP echo 8000, UDP echo 7777)');
  } else if (l2name === 'pcap') {
    const pcap = require('./l2-pcap.cjs'), want = opt('adapter', '');
    let dev;
    if (want.startsWith('\\Device\\')) dev = { name: want };
    else if (want) { // Windows adapter name (Get-NetAdapter) -> Npcap device by interface GUID
      const guid = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetAdapter -Name '${want}').InterfaceGuid`]).toString().trim().toUpperCase();
      dev = pcap.listDevices().find((d) => guid && d.name.toUpperCase().includes(guid));
    } else { console.log('Npcap devices (pass --adapter "<Windows adapter name>"):'); for (const d of pcap.listDevices()) console.log(' ', d.name, '-', d.description); process.exit(2); }
    if (!dev) throw new Error('no Npcap device for adapter ' + want);
    l2 = pcap.open(dev.name);
  } else throw new Error('unknown --l2 ' + l2name);
  const stack = new Stack(l2, { hostname, mac: randomMac() });
  stack.on('link', () => { const i = stack.info(); console.log('link', i.up ? 'UP ' + i.ip + ' gw ' + i.gw + ' mac ' + i.mac : 'DOWN'); });
  const b = await startBridge({ stack, port, host: opt('host', '127.0.0.1'), log: (s) => console.log(s) });
  console.log('ACNet bridge on ws://' + opt('host', '127.0.0.1') + ':' + b.port + ' (l2=' + l2name + ')');
  const ser = opt('serial', '');
  if (ser) { // same service core behind SIO device $65 on a USB-SIO cable, for a real Atari
    const Core = require('../../web/js/acnet-core.js'), { StackBackend, linkMsg } = require('./backend.cjs'), { SioHost, openSerial } = require('./sio-serial.cjs');
    const core = Core.create(), be = new StackBackend(stack, (m) => setImmediate(() => core.deliver(m)));
    core.backend = (m) => setImmediate(() => be.handle(m)); core.setBridge(true);
    stack.on('link', () => core.deliver(linkMsg(stack)));
    core.deliver(linkMsg(stack));
    new SioHost(openSerial(ser, +opt('baud', 19200)), core, { log: (s) => console.log(s) });
    console.log('SIO device $65 on ' + ser + ' @' + opt('baud', 19200));
  }
}

module.exports = { startBridge, enc, dec, wsSend, wsParser };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
