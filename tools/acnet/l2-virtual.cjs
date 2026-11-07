'use strict';
// Virtual LAN for tests: an in-process Ethernet hub, a DHCP server and a tiny DNS server, so the ACNet stack
// can be exercised end to end (DHCP lease, ARP, ICMP, UDP, TCP, DNS) with no real network.
const { ip2n, n2ip, ipb, cksum, sum16 } = require('./stack.cjs');

class Hub {
  constructor(opts = {}) { this.ports = new Set(); this.loss = opts.loss || 0; this.drop = opts.drop || null; this.frames = 0; }
  port() {
    const hub = this;
    const p = {
      handler: null,
      send(f) {
        hub.frames++;
        const copy = Buffer.from(f);
        if (hub.drop && hub.drop(copy)) return;
        if (hub.loss && Math.random() < hub.loss) return;
        setImmediate(() => { for (const q of hub.ports) if (q !== p && q.handler) q.handler(Buffer.from(copy)); });
      },
      onFrame(fn) { p.handler = fn; },
      close() { hub.ports.delete(p); },
    };
    this.ports.add(p);
    return p;
  }
}

// Minimal DHCP server answering on the hub: pool .100-.199 by default.
class DhcpServer {
  constructor(hub, cfg = {}) {
    this.cfg = Object.assign({ server: '10.7.0.1', mask: '255.255.255.0', gw: '10.7.0.1', dns: ['10.7.0.1'], pool: 100, lease: 3600 }, cfg);
    this.leases = new Map(); this.log = []; this.l2 = hub.port(); this.mac = Buffer.from('02deadbeef01', 'hex');
    this.l2.onFrame((f) => this.rx(f));
  }
  rx(f) {
    if (f.length < 14 + 20 + 8 + 240 || f.readUInt16BE(12) !== 0x0800 || f[14 + 9] !== 17) return;
    const ihl = (f[14] & 15) * 4, u = f.subarray(14 + ihl);
    if (u.readUInt16BE(2) !== 67) return;
    const p = u.subarray(8);
    if (p[0] !== 1 || p.readUInt32BE(236) !== 0x63825363) return;
    const opt = new Map();
    for (let i = 240; i < p.length;) { const k = p[i]; if (k === 255) break; if (k === 0) { i++; continue; } opt.set(k, p.subarray(i + 2, i + 2 + p[i + 1])); i += 2 + p[i + 1]; }
    const type = opt.get(53) && opt.get(53)[0], chaddr = Buffer.from(p.subarray(28, 34)), mk = chaddr.toString('hex');
    this.log.push({ type, mac: mk });
    const want = opt.get(50) ? n2ip(opt.get(50).readUInt32BE(0)) : null, ci = p.readUInt32BE(12);
    let ip = this.leases.get(mk);
    if (!ip) { ip = '10.7.0.' + (this.cfg.pool + this.leases.size); this.leases.set(mk, ip); }
    if (type === 1) this.reply(p, chaddr, 2, ip, false);
    else if (type === 3) {
      const ask = want || (ci ? n2ip(ci) : ip);
      if (ask !== ip) this.reply(p, chaddr, 6, '0.0.0.0', false);
      else this.reply(p, chaddr, 5, ip, ci !== 0);
    }
  }
  reply(req, chaddr, type, yip, unicast) {
    const c = this.cfg, b = Buffer.alloc(240);
    b[0] = 2; b[1] = 1; b[2] = 6; req.copy(b, 4, 4, 8); b.writeUInt16BE(req.readUInt16BE(10), 10);
    ipb(yip).copy(b, 16); ipb(c.server).copy(b, 20); chaddr.copy(b, 28); b.writeUInt32BE(0x63825363, 236);
    const o = [Buffer.from([53, 1, type]), Buffer.concat([Buffer.from([54, 4]), ipb(c.server)])];
    if (type !== 6) {
      const u32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x; };
      o.push(Buffer.concat([Buffer.from([51, 4]), u32(c.lease)]), Buffer.concat([Buffer.from([58, 4]), u32(c.t1 || Math.floor(c.lease / 2))]),
        Buffer.concat([Buffer.from([59, 4]), u32(c.t2 || Math.floor(c.lease * 0.875))]), Buffer.concat([Buffer.from([1, 4]), ipb(c.mask)]),
        Buffer.concat([Buffer.from([3, 4]), ipb(c.gw)]), Buffer.concat([Buffer.from([6, 4 * c.dns.length]), ...c.dns.map(ipb)]));
    }
    o.push(Buffer.from([255]));
    const msg = Buffer.concat([b, ...o]), u = Buffer.alloc(8 + msg.length);
    u.writeUInt16BE(67, 0); u.writeUInt16BE(68, 2); u.writeUInt16BE(u.length, 4); msg.copy(u, 8);
    const dst = unicast ? ip2n(yip) : 0xffffffff, src = ip2n(c.server);
    const ph = Buffer.alloc(12); ph.writeUInt32BE(src, 0); ph.writeUInt32BE(dst, 4); ph[9] = 17; ph.writeUInt16BE(u.length, 10);
    u.writeUInt16BE(cksum(u, sum16(ph)) || 0xffff, 6);
    const h = Buffer.alloc(20); h[0] = 0x45; h.writeUInt16BE(20 + u.length, 2); h[8] = 64; h[9] = 17; h.writeUInt32BE(src, 12); h.writeUInt32BE(dst, 16);
    h.writeUInt16BE(cksum(h), 10);
    const e = Buffer.alloc(14); (unicast ? chaddr : Buffer.from('ffffffffffff', 'hex')).copy(e, 0); this.mac.copy(e, 6); e.writeUInt16BE(0x0800, 12);
    this.l2.send(Buffer.concat([e, h, u]));
  }
}

// DNS responder bound on a Stack UDP port 53: zone = { 'name': 'a.b.c.d' }
function dnsServer(stack, zone) {
  const s = stack.udpBind(53);
  s.queries = [];
  s.onmessage = (b, rip, rport) => {
    const id = b.readUInt16BE(0); let i = 12; const labs = [];
    while (b[i]) { labs.push(b.toString('ascii', i + 1, i + 1 + b[i])); i += 1 + b[i]; }
    const name = labs.join('.').toLowerCase(), q = b.subarray(12, i + 5); s.queries.push(name);
    const ip = zone[name];
    const hd = Buffer.from([id >> 8, id & 255, 0x81, ip ? 0x80 : 0x83, 0, 1, 0, ip ? 1 : 0, 0, 0, 0, 0]);
    const parts = [hd, q];
    if (ip) parts.push(Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4]), ipb(ip));
    s.send(rip, rport, Buffer.concat(parts));
  };
  return s;
}

module.exports = { Hub, DhcpServer, dnsServer };
