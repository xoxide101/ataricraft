'use strict';
// ACNet userspace IPv4 stack: Ethernet, ARP, DHCP client (lease/renew), ICMP echo, UDP, TCP, DNS client.
// It owns its own MAC and IP; everything is sent as raw Ethernet frames through a pluggable L2 backend
// ({ send(frame), onFrame(fn), close() }). No host sockets are used.
const EventEmitter = require('events');
const crypto = require('crypto');

const BCAST = Buffer.from('ffffffffffff', 'hex');
const ip2n = (s) => s.split('.').reduce((a, b) => ((a << 8) | (b & 255)) >>> 0, 0) >>> 0;
const n2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const ipb = (s) => { const b = Buffer.alloc(4); b.writeUInt32BE(ip2n(s)); return b; };
const macStr = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(':');
const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => +x < 256);

function sum16(buf, init = 0) {
  let s = init;
  const n = buf.length & ~1;
  for (let i = 0; i < n; i += 2) s += (buf[i] << 8) | buf[i + 1];
  if (buf.length & 1) s += buf[buf.length - 1] << 8;
  return s;
}
const fold = (s) => { while (s > 0xffff) s = (s & 0xffff) + (s >>> 16); return s; };
const cksum = (buf, init = 0) => (~fold(sum16(buf, init))) & 0xffff;

const seqLt = (a, b) => ((a - b) | 0) < 0;
const seqLe = (a, b) => ((a - b) | 0) <= 0;

function randomMac() {
  const b = crypto.randomBytes(6);
  b[0] = (b[0] & 0xfc) | 0x02; // locally administered, unicast
  return b;
}

const F = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };
const MSS = 1400;

class TcpSock {
  constructor(stack, lip, lport, rip, rport) {
    this.stack = stack; this.lip = lip; this.lport = lport; this.rip = rip; this.rport = rport;
    this.state = 'CLOSED';
    this.iss = crypto.randomBytes(4).readUInt32BE(); this.snd_una = this.iss; this.snd_nxt = this.iss;
    this.rcv_nxt = 0; this.snd_wnd = 1; this.mss = 536;
    this.sendBuf = []; this.sendLen = 0; // bytes from snd_una on (acked data is dropped)
    this.finQueued = false; this.finSent = false; this.peerFin = false;
    this.credit = 65535; this.lastAdvWnd = 0;
    this.rto = 800; this.retries = 0; this.timer = 0; this.twAt = 0;
    this.parent = null;
    this.onconnect = null; this.ondata = null; this.onclose = null; this.onsent = null; this.oneof = null;
  }
  key() { return `${this.lip}:${this.lport}:${this.rip}:${this.rport}`; }
  write(buf) {
    if (this.state !== 'ESTABLISHED' && this.state !== 'CLOSE_WAIT') return false;
    if (this.finQueued) return false;
    buf = Buffer.from(buf);
    if (buf.length) { this.sendBuf.push(buf); this.sendLen += buf.length; this.stack._tcpOutput(this); }
    return true;
  }
  // The application consumed n bytes of received data: reopen the receive window.
  consume(n) {
    this.credit = Math.min(65535, this.credit + n);
    const w = this._wnd();
    if (this.state === 'ESTABLISHED' || this.state === 'FIN_WAIT_1' || this.state === 'FIN_WAIT_2' || this.state === 'CLOSE_WAIT') {
      if (this.lastAdvWnd === 0 || w - this.lastAdvWnd >= 2 * MSS) this.stack._tcpSeg(this, F.ACK, this.snd_nxt, null);
    }
  }
  _wnd() { return Math.min(65535, Math.max(0, this.credit)); }
  close() {
    if (this.state === 'SYN_SENT' || this.state === 'SYN_RCVD') { this.stack._tcpDrop(this, null); return; }
    if (this.state === 'ESTABLISHED' || this.state === 'CLOSE_WAIT') { this.finQueued = true; this.stack._tcpOutput(this); }
  }
  abort() {
    if (this.state !== 'CLOSED' && this.state !== 'TIME_WAIT' && this.state !== 'LISTEN') this.stack._tcpSeg(this, F.RST | F.ACK, this.snd_nxt, null);
    this.stack._tcpDrop(this, null);
  }
}

class Stack extends EventEmitter {
  constructor(l2, opts = {}) {
    super();
    this.l2 = l2; this.mac = opts.mac ? Buffer.from(opts.mac) : randomMac();
    this.hostname = opts.hostname || 'acnet';
    this.ip = 0; this.mask = 0; this.gw = 0; this.dns = []; this.lease = null;
    this.log = opts.log || (() => {});
    this.arp = new Map(); this.arpPending = new Map();
    this.tcp = new Map(); this.listeners = new Map(); this.udp = new Map();
    this.pings = new Map(); this.dnsCache = new Map(); this.dnsPending = new Map();
    this.nextPort = 49152 + (crypto.randomBytes(2).readUInt16BE() % 4000);
    this.ipId = crypto.randomBytes(2).readUInt16BE();
    this.stats = { rx: 0, tx: 0, dropped: 0 };
    this.dhcp = { state: 'INIT', xid: 0, tries: 0, at: 0, server: 0, offer: null };
    l2.onFrame((f) => { try { this._rx(f); } catch (e) { this.stats.dropped++; this.log('rx error', e.message); } });
    this.tmr = setInterval(() => this._tick(), 50);
    if (this.tmr.unref) this.tmr.unref();
    if (opts.staticIp) { this.dhcp.state = 'STATIC'; this._setAddr(opts.staticIp); }
    else this._dhcpStart();
  }

  close() { clearInterval(this.tmr); for (const s of [...this.tcp.values()]) s.abort(); try { this.l2.close(); } catch (e) { /* closed */ } }

  info() {
    return {
      mac: macStr(this.mac), up: this.ip !== 0, ip: this.ip ? n2ip(this.ip) : '0.0.0.0', mask: this.ip ? n2ip(this.mask) : '0.0.0.0',
      gw: this.gw ? n2ip(this.gw) : '0.0.0.0', dns: this.dns.map(n2ip), dhcp: this.dhcp.state,
      leaseLeft: this.lease ? Math.max(0, Math.round((this.lease.expire - Date.now()) / 1000)) : 0,
    };
  }
  _setAddr(a) {
    this.ip = ip2n(a.ip); this.mask = ip2n(a.mask || '255.255.255.0'); this.gw = a.gw ? ip2n(a.gw) : 0;
    this.dns = (a.dns || []).map(ip2n);
    this.emit('link', this.info());
  }

  // ---- Ethernet / ARP ----
  _tx(frame) { this.stats.tx++; this.l2.send(frame); }
  _eth(dstMac, type, payload) {
    const h = Buffer.alloc(14); dstMac.copy(h, 0); this.mac.copy(h, 6); h.writeUInt16BE(type, 12);
    const f = Buffer.concat([h, payload]);
    this._tx(f.length < 60 ? Buffer.concat([f, Buffer.alloc(60 - f.length)]) : f);
  }
  _rx(f) {
    if (f.length < 14) return;
    this.stats.rx++;
    const dst = f.subarray(0, 6);
    const bc = dst.equals(BCAST), mc = (dst[0] & 1) === 1;
    if (!bc && !mc && !dst.equals(this.mac)) return;
    const src = f.subarray(6, 12);
    if (src.equals(this.mac)) return;
    const type = f.readUInt16BE(12), body = f.subarray(14);
    if (type === 0x0806) this._rxArp(body);
    else if (type === 0x0800) this._rxIp(body, src);
  }
  _arpPkt(op, tmac, tip) {
    const p = Buffer.alloc(28);
    p.writeUInt16BE(1, 0); p.writeUInt16BE(0x0800, 2); p[4] = 6; p[5] = 4; p.writeUInt16BE(op, 6);
    this.mac.copy(p, 8); p.writeUInt32BE(this.ip, 14); tmac.copy(p, 18); p.writeUInt32BE(tip, 24);
    return p;
  }
  _rxArp(p) {
    if (p.length < 28 || p.readUInt16BE(0) !== 1 || p.readUInt16BE(2) !== 0x0800) return;
    const op = p.readUInt16BE(6), smac = Buffer.from(p.subarray(8, 14)), sip = p.readUInt32BE(14), tip = p.readUInt32BE(24);
    if (sip !== 0) this._arpLearn(sip, smac);
    if (op === 1 && this.ip !== 0 && tip === this.ip) this._eth(smac, 0x0806, this._arpPkt(2, smac, sip));
  }
  _arpLearn(ip, mac) {
    this.arp.set(ip, { mac, t: Date.now() });
    const pend = this.arpPending.get(ip);
    if (pend) { this.arpPending.delete(ip); for (const pkt of pend.queue) this._eth(mac, 0x0800, pkt); }
  }
  _announce() { if (this.ip) this._eth(BCAST, 0x0806, this._arpPkt(1, Buffer.alloc(6), this.ip)); }

  // ---- IPv4 ----
  _nextHop(dst) {
    if (dst === 0xffffffff) return dst;
    if (((dst ^ this.ip) & this.mask) >>> 0 === 0) return dst;
    return this.gw || dst;
  }
  sendIp(dst, proto, payload, src = this.ip) {
    const h = Buffer.alloc(20);
    h[0] = 0x45; h.writeUInt16BE(20 + payload.length, 2); h.writeUInt16BE((this.ipId = (this.ipId + 1) & 0xffff), 4);
    h.writeUInt16BE(0x4000, 6); h[8] = 64; h[9] = proto; h.writeUInt32BE(src, 12); h.writeUInt32BE(dst, 16);
    h.writeUInt16BE(cksum(h), 10);
    const pkt = Buffer.concat([h, payload]);
    if (dst === 0xffffffff || (this.ip && dst === (((this.ip & this.mask) | ~this.mask) >>> 0))) { this._eth(BCAST, 0x0800, pkt); return; }
    const hop = this._nextHop(dst);
    const e = this.arp.get(hop);
    if (e && Date.now() - e.t < 300000) { this._eth(e.mac, 0x0800, pkt); return; }
    let pend = this.arpPending.get(hop);
    if (!pend) {
      pend = { queue: [], tries: 0, at: 0 }; this.arpPending.set(hop, pend);
      this._arpAsk(hop, pend);
    }
    if (pend.queue.length < 16) pend.queue.push(pkt);
  }
  _arpAsk(hop, pend) {
    pend.tries++; pend.at = Date.now();
    this._eth(BCAST, 0x0806, this._arpPkt(1, Buffer.alloc(6), hop));
  }
  _rxIp(p, srcMac) {
    if (p.length < 20 || (p[0] >> 4) !== 4) return;
    const ihl = (p[0] & 15) * 4;
    if (ihl < 20 || p.length < ihl) return;
    if (cksum(p.subarray(0, ihl)) !== 0) { this.stats.dropped++; return; }
    const total = p.readUInt16BE(2);
    if (total < ihl || total > p.length) return;
    if (p.readUInt16BE(6) & 0x3fff) { this.stats.dropped++; return; } // fragments unsupported
    const proto = p[9], src = p.readUInt32BE(12), dst = p.readUInt32BE(16), body = p.subarray(ihl, total);
    const toMe = this.ip !== 0 && dst === this.ip;
    const bcast = dst === 0xffffffff || (this.ip !== 0 && dst === (((this.ip & this.mask) | ~this.mask) >>> 0));
    if (proto === 17 && (toMe || bcast || this.ip === 0)) {
      if (this.ip === 0 && !(body.length >= 8 && body.readUInt16BE(2) === 68)) return;
      this._rxUdp(src, dst, body, bcast, p.subarray(0, Math.min(total, ihl + 8)));
      return;
    }
    if (!toMe) return;
    if (srcMac && src !== 0 && ((src ^ this.ip) & this.mask) >>> 0 === 0) this._arpLearn(src, Buffer.from(srcMac));
    if (proto === 1) this._rxIcmp(src, body);
    else if (proto === 6) this._rxTcp(src, dst, body);
  }

  // ---- ICMP ----
  _rxIcmp(src, b) {
    if (b.length < 8 || cksum(b) !== 0) return;
    if (b[0] === 8) {
      const r = Buffer.from(b); r[0] = 0; r.writeUInt16BE(0, 2); r.writeUInt16BE(cksum(r), 2);
      this.sendIp(src, 1, r);
    } else if (b[0] === 0) {
      const k = `${src}:${b.readUInt16BE(4)}:${b.readUInt16BE(6)}`, w = this.pings.get(k);
      if (w) { this.pings.delete(k); clearTimeout(w.t); w.res(Date.now() - w.at); }
    }
  }
  ping(ipStr, timeoutMs = 2000, size = 32) {
    const dst = ip2n(ipStr), id = crypto.randomBytes(2).readUInt16BE(), seq = 1;
    const m = Buffer.alloc(8 + size); m[0] = 8; m.writeUInt16BE(id, 4); m.writeUInt16BE(seq, 6);
    for (let i = 0; i < size; i++) m[8 + i] = 0x61 + (i % 23);
    m.writeUInt16BE(cksum(m), 2);
    return new Promise((res, rej) => {
      const k = `${dst}:${id}:${seq}`;
      const t = setTimeout(() => { this.pings.delete(k); rej(new Error('timeout')); }, timeoutMs);
      this.pings.set(k, { res, t, at: Date.now() });
      this.sendIp(dst, 1, m);
    });
  }

  // ---- UDP ----
  _udpPkt(src, dst, sp, dp, data) {
    const u = Buffer.alloc(8 + data.length);
    u.writeUInt16BE(sp, 0); u.writeUInt16BE(dp, 2); u.writeUInt16BE(u.length, 4); data.copy(u, 8);
    const ph = Buffer.alloc(12); ph.writeUInt32BE(src, 0); ph.writeUInt32BE(dst, 4); ph[9] = 17; ph.writeUInt16BE(u.length, 10);
    let c = cksum(u, sum16(ph)); if (c === 0) c = 0xffff;
    u.writeUInt16BE(c, 6);
    return u;
  }
  _rxUdp(src, dst, u, bcast, orig) {
    if (u.length < 8) return;
    const len = u.readUInt16BE(4);
    if (len < 8 || len > u.length) return;
    u = u.subarray(0, len);
    if (u.readUInt16BE(6) !== 0) {
      const ph = Buffer.alloc(12); ph.writeUInt32BE(src, 0); ph.writeUInt32BE(dst, 4); ph[9] = 17; ph.writeUInt16BE(len, 10);
      if (cksum(u, sum16(ph)) !== 0) { this.stats.dropped++; return; }
    }
    const sp = u.readUInt16BE(0), dp = u.readUInt16BE(2), data = u.subarray(8);
    if (dp === 68 && this._dhcpRx(data)) return;
    const s = this.udp.get(dp);
    if (s) { if (s.onmessage) s.onmessage(Buffer.from(data), n2ip(src), sp); return; }
    if (!bcast && this.ip) { // ICMP port unreachable
      const m = Buffer.alloc(8 + orig.length); m[0] = 3; m[1] = 3; orig.copy(m, 8);
      m.writeUInt16BE(cksum(m), 2); this.sendIp(src, 1, m);
    }
  }
  udpBind(port = 0) {
    if (!port) { do { port = this._ephemeral(); } while (this.udp.has(port)); }
    if (this.udp.has(port)) throw new Error('port in use');
    const self = this;
    const s = {
      port, onmessage: null,
      send(ip, p, buf) {
        if (!self.ip) throw new Error('no link');
        self.sendIp(ip2n(ip), 17, self._udpPkt(self.ip, ip2n(ip), port, p, Buffer.from(buf)));
      },
      close() { if (self.udp.get(port) === s) self.udp.delete(port); },
    };
    this.udp.set(port, s);
    return s;
  }
  _ephemeral() { const p = this.nextPort++; if (this.nextPort > 65000) this.nextPort = 49152; return p; }

  // ---- TCP ----
  _tcpSeg(s, flags, seq, data, extra) {
    const optLen = flags & F.SYN ? 4 : 0, dl = data ? data.length : 0;
    const t = Buffer.alloc(20 + optLen + dl);
    t.writeUInt16BE(s.lport, 0); t.writeUInt16BE(s.rport, 2); t.writeUInt32BE(seq >>> 0, 4);
    t.writeUInt32BE(flags & F.ACK ? s.rcv_nxt >>> 0 : 0, 8);
    t[12] = ((5 + optLen / 4) << 4); t[13] = flags;
    const w = s._wnd(); s.lastAdvWnd = w; t.writeUInt16BE(w, 14);
    if (optLen) { t[20] = 2; t[21] = 4; t.writeUInt16BE(MSS, 22); }
    if (dl) data.copy(t, 20 + optLen);
    this._tcpFinish(t, s.lip, s.rip);
    this.sendIp(s.rip, 6, t, s.lip);
  }
  _tcpFinish(t, src, dst) {
    const ph = Buffer.alloc(12); ph.writeUInt32BE(src, 0); ph.writeUInt32BE(dst, 4); ph[9] = 6; ph.writeUInt16BE(t.length, 10);
    t.writeUInt16BE(0, 16); t.writeUInt16BE(cksum(t, sum16(ph)), 16);
  }
  _tcpRstTo(src, dst, th, dlen) {
    const t = Buffer.alloc(20);
    t.writeUInt16BE(th.dp, 0); t.writeUInt16BE(th.sp, 2); t[12] = 0x50;
    if (th.flags & F.ACK) { t.writeUInt32BE(th.ack >>> 0, 4); t[13] = F.RST; }
    else { t.writeUInt32BE(0, 4); t.writeUInt32BE((th.seq + dlen + ((th.flags & F.SYN) ? 1 : 0) + ((th.flags & F.FIN) ? 1 : 0)) >>> 0, 8); t[13] = F.RST | F.ACK; }
    this._tcpFinish(t, dst, src);
    this.sendIp(src, 6, t, dst);
  }
  tcpConnect(ipStr, port, credit = 65535) {
    if (!this.ip) throw new Error('no link');
    let lp; do { lp = this._ephemeral(); } while ([...this.tcp.values()].some((x) => x.lport === lp));
    const s = new TcpSock(this, this.ip, lp, ip2n(ipStr), port);
    s.state = 'SYN_SENT'; s.mss = 536; s.credit = credit;
    this.tcp.set(s.key(), s);
    this._tcpSeg(s, F.SYN, s.iss, null); s.snd_nxt = (s.iss + 1) >>> 0;
    this._armRto(s);
    return s;
  }
  tcpListen(port, onaccept, credit = 65535) {
    if (this.listeners.has(port)) throw new Error('port in use');
    const l = { port, onaccept, credit, close: () => { if (this.listeners.get(port) === l) this.listeners.delete(port); } };
    this.listeners.set(port, l);
    return l;
  }
  _armRto(s) { s.timer = Date.now() + s.rto; }
  _tcpDrop(s, err) {
    if (s.state === 'CLOSED') return;
    s.state = 'CLOSED'; s.timer = 0;
    this.tcp.delete(s.key());
    if (s.onclose) { const f = s.onclose; s.onclose = null; f(err); }
  }
  _tcpOutput(s) {
    if (s.state !== 'ESTABLISHED' && s.state !== 'CLOSE_WAIT' && s.state !== 'FIN_WAIT_1' && s.state !== 'LAST_ACK') return;
    let inflight = (s.snd_nxt - s.snd_una) >>> 0;
    if (s.finSent && inflight > 0) inflight--; // FIN occupies a sequence number but no buffer byte
    const win = Math.min(s.snd_wnd, 24 * s.mss);
    for (;;) {
      const off = (s.snd_nxt - s.snd_una - (s.finSent ? 1 : 0)) >>> 0;
      const avail = s.sendLen - off;
      if (avail <= 0) break;
      const room = win - ((s.snd_nxt - s.snd_una) >>> 0);
      if (room <= 0) break;
      const n = Math.min(avail, room, s.mss);
      this._tcpSeg(s, F.ACK | F.PSH, s.snd_nxt, this._peek(s, off, n));
      s.snd_nxt = (s.snd_nxt + n) >>> 0;
      if (!s.timer) this._armRto(s);
    }
    const off = (s.snd_nxt - s.snd_una - (s.finSent ? 1 : 0)) >>> 0;
    if (s.finQueued && !s.finSent && s.sendLen - off === 0) {
      this._tcpSeg(s, F.FIN | F.ACK, s.snd_nxt, null);
      s.snd_nxt = (s.snd_nxt + 1) >>> 0; s.finSent = true;
      if (s.state === 'ESTABLISHED') s.state = 'FIN_WAIT_1'; else if (s.state === 'CLOSE_WAIT') s.state = 'LAST_ACK';
      if (!s.timer) this._armRto(s);
    }
    void inflight;
  }
  _peek(s, off, n) {
    const out = Buffer.alloc(n); let o = 0, skip = off;
    for (const b of s.sendBuf) {
      if (skip >= b.length) { skip -= b.length; continue; }
      const take = Math.min(b.length - skip, n - o);
      b.copy(out, o, skip, skip + take); o += take; skip = 0;
      if (o >= n) break;
    }
    return out;
  }
  _dropAcked(s, n) {
    s.sendLen -= n;
    while (n > 0 && s.sendBuf.length) {
      const b = s.sendBuf[0];
      if (b.length <= n) { n -= b.length; s.sendBuf.shift(); } else { s.sendBuf[0] = b.subarray(n); n = 0; }
    }
  }
  _rxTcp(src, dst, t) {
    if (t.length < 20) return;
    const ph = Buffer.alloc(12); ph.writeUInt32BE(src, 0); ph.writeUInt32BE(dst, 4); ph[9] = 6; ph.writeUInt16BE(t.length, 10);
    if (cksum(t, sum16(ph)) !== 0) { this.stats.dropped++; return; }
    const off = (t[12] >> 4) * 4;
    if (off < 20 || off > t.length) return;
    const th = { sp: t.readUInt16BE(0), dp: t.readUInt16BE(2), seq: t.readUInt32BE(4), ack: t.readUInt32BE(8), flags: t[13], wnd: t.readUInt16BE(14) };
    const data = t.subarray(off);
    let mss = 536;
    for (let i = 20; i + 1 < off;) { // options
      const k = t[i];
      if (k === 0) break;
      if (k === 1) { i++; continue; }
      const l = t[i + 1]; if (l < 2) break;
      if (k === 2 && l === 4) mss = t.readUInt16BE(i + 2);
      i += l;
    }
    const key = `${dst}:${th.dp}:${src}:${th.sp}`;
    const s = this.tcp.get(key);
    if (!s) {
      const l = this.listeners.get(th.dp);
      if (th.flags & F.RST) return;
      if (l && (th.flags & F.SYN) && !(th.flags & F.ACK)) {
        let pending = 0; for (const x of this.tcp.values()) if (x.parent === l && x.state === 'SYN_RCVD') pending++;
        if (pending >= 16) return;
        const c = new TcpSock(this, dst, th.dp, src, th.sp);
        c.parent = l; c.credit = l.credit; c.state = 'SYN_RCVD'; c.rcv_nxt = (th.seq + 1) >>> 0; c.snd_wnd = th.wnd || 1; c.mss = Math.min(mss, MSS);
        this.tcp.set(c.key(), c);
        this._tcpSeg(c, F.SYN | F.ACK, c.iss, null); c.snd_nxt = (c.iss + 1) >>> 0; this._armRto(c);
        return;
      }
      this._tcpRstTo(src, dst, th, data.length);
      return;
    }
    this._tcpIn(s, th, data, mss);
  }
  _tcpIn(s, th, data, mss) {
    if (s.state === 'SYN_SENT') {
      if ((th.flags & F.ACK) && th.ack !== s.snd_nxt) { if (!(th.flags & F.RST)) this._tcpRstTo(s.rip, s.lip, th, data.length); return; }
      if (th.flags & F.RST) { if (th.flags & F.ACK) this._tcpDrop(s, 'refused'); return; }
      if ((th.flags & F.SYN) && (th.flags & F.ACK)) {
        s.rcv_nxt = (th.seq + 1) >>> 0; s.snd_una = th.ack; s.snd_wnd = th.wnd; s.mss = Math.min(mss, MSS);
        s.state = 'ESTABLISHED'; s.timer = 0; s.retries = 0; s.rto = 800;
        this._tcpSeg(s, F.ACK, s.snd_nxt, null);
        if (s.onconnect) s.onconnect();
        this._tcpOutput(s);
      }
      return;
    }
    if (th.flags & F.RST) {
      if (seqLe(s.rcv_nxt, th.seq) || s.state === 'SYN_RCVD') this._tcpDrop(s, 'reset');
      return;
    }
    if (th.flags & F.SYN) {
      if (s.state === 'SYN_RCVD') { this._tcpSeg(s, F.SYN | F.ACK, s.iss, null); } else this._tcpSeg(s, F.ACK, s.snd_nxt, null);
      return;
    }
    if (!(th.flags & F.ACK)) return;
    if (s.state === 'SYN_RCVD') {
      if (th.ack !== s.snd_nxt) { this._tcpRstTo(s.rip, s.lip, th, data.length); return; }
      s.snd_una = th.ack; s.state = 'ESTABLISHED'; s.timer = 0; s.retries = 0; s.rto = 800; s.snd_wnd = th.wnd;
      if (s.parent && s.parent.onaccept) s.parent.onaccept(s);
    }
    // ACK processing
    if (seqLt(s.snd_una, th.ack) && seqLe(th.ack, s.snd_nxt)) {
      let acked = (th.ack - s.snd_una) >>> 0;
      const finAcked = s.finSent && th.ack === s.snd_nxt;
      if (finAcked) acked--;
      s.snd_una = th.ack;
      if (acked > 0) { this._dropAcked(s, acked); if (s.onsent) s.onsent(acked); }
      s.retries = 0; s.rto = 800;
      s.timer = s.snd_una === s.snd_nxt ? 0 : Date.now() + s.rto;
      if (finAcked) {
        if (s.state === 'FIN_WAIT_1') s.state = 'FIN_WAIT_2';
        else if (s.state === 'LAST_ACK') { this._tcpDrop(s, null); return; }
      }
    }
    if (seqLe(s.snd_una, th.ack)) s.snd_wnd = th.wnd;
    // data
    let ackNow = false;
    if (data.length || (th.flags & F.FIN)) {
      let seq = th.seq, d = data;
      if (seqLt(seq, s.rcv_nxt)) { // partial retransmit overlap
        const skip = (s.rcv_nxt - seq) >>> 0;
        if (skip >= d.length && !((th.flags & F.FIN) && seq + d.length >>> 0 === s.rcv_nxt)) { this._tcpSeg(s, F.ACK, s.snd_nxt, null); return; }
        d = d.subarray(Math.min(skip, d.length)); seq = s.rcv_nxt;
      }
      if (seq === s.rcv_nxt && (s.state === 'ESTABLISHED' || s.state === 'FIN_WAIT_1' || s.state === 'FIN_WAIT_2')) {
        if (d.length > s.credit) { d = d.subarray(0, s.credit); th = { ...th, flags: th.flags & ~F.FIN }; }
        if (d.length) { s.rcv_nxt = (s.rcv_nxt + d.length) >>> 0; s.credit -= d.length; if (s.ondata) s.ondata(Buffer.from(d)); }
        if ((th.flags & F.FIN) && !s.peerFin) {
          s.peerFin = true; s.rcv_nxt = (s.rcv_nxt + 1) >>> 0;
          if (s.state === 'ESTABLISHED') s.state = 'CLOSE_WAIT';
          else if (s.state === 'FIN_WAIT_1') s.state = 'CLOSING';
          else if (s.state === 'FIN_WAIT_2') { s.state = 'TIME_WAIT'; s.twAt = Date.now() + 2000; s.timer = 0; }
          if (s.oneof) s.oneof();
        }
        ackNow = true;
      } else if (s.state === 'CLOSE_WAIT' || s.state === 'LAST_ACK' || s.state === 'CLOSING' || s.state === 'TIME_WAIT') ackNow = true;
      else ackNow = true; // out of order: dup ACK, peer retransmits
    }
    if (s.state === 'CLOSING' && s.finSent && s.snd_una === s.snd_nxt) { s.state = 'TIME_WAIT'; s.twAt = Date.now() + 2000; s.timer = 0; }
    if (ackNow) this._tcpSeg(s, F.ACK, s.snd_nxt, null);
    this._tcpOutput(s);
  }

  // ---- timers ----
  _tick() {
    const now = Date.now();
    for (const s of [...this.tcp.values()]) {
      if (s.state === 'TIME_WAIT') { if (now >= s.twAt) this._tcpDrop(s, null); continue; }
      if (!s.timer || now < s.timer) {
        if (!s.timer && s.snd_wnd === 0 && s.sendLen > 0 && s.snd_una === s.snd_nxt) s.timer = now + s.rto; // persist
        continue;
      }
      if (++s.retries > 8) { this._tcpSeg(s, F.RST | F.ACK, s.snd_nxt, null); this._tcpDrop(s, 'timeout'); continue; }
      s.rto = Math.min(s.rto * 2, 8000); s.timer = now + s.rto;
      if (s.state === 'SYN_SENT') this._tcpSeg(s, F.SYN, s.iss, null);
      else if (s.state === 'SYN_RCVD') this._tcpSeg(s, F.SYN | F.ACK, s.iss, null);
      else if (s.snd_wnd === 0 && s.snd_una === s.snd_nxt && s.sendLen > 0) { s.retries = 0; this._tcpSeg(s, F.ACK, s.snd_nxt, this._peek(s, 0, 1)); } // zero-window probe
      else { // go-back-N
        s.snd_nxt = s.snd_una;
        if (s.finSent) s.finSent = false;
        this._tcpOutput(s);
        if (s.snd_una === s.snd_nxt && !s.finQueued && s.sendLen === 0) s.timer = 0;
      }
    }
    for (const [hop, p] of [...this.arpPending]) {
      if (now - p.at < 1000) continue;
      if (p.tries >= 3) this.arpPending.delete(hop); else this._arpAsk(hop, p);
    }
    this._dhcpTick(now);
  }

  // ---- DHCP client ----
  _dhcpStart() { const d = this.dhcp; d.state = 'INIT'; d.tries = 0; d.at = 0; d.xid = crypto.randomBytes(4).readUInt32BE(); }
  _dhcpMsg(type, extra) {
    const d = this.dhcp, b = Buffer.alloc(240); // fixed header + magic cookie
    b[0] = 1; b[1] = 1; b[2] = 6; b.writeUInt32BE(d.xid, 4);
    if (type === 1 || d.state === 'REQUESTING' || d.state === 'SELECTING') b.writeUInt16BE(0x8000, 10);
    if (extra && extra.ciaddr) b.writeUInt32BE(extra.ciaddr, 12);
    this.mac.copy(b, 28); b.writeUInt32BE(0x63825363, 236);
    const o = [Buffer.from([53, 1, type]), Buffer.from([61, 7, 1, ...this.mac])];
    const hn = Buffer.from(this.hostname); o.push(Buffer.concat([Buffer.from([12, hn.length]), hn]));
    if (extra && extra.reqIp) o.push(Buffer.concat([Buffer.from([50, 4]), ipb(n2ip(extra.reqIp))]));
    if (extra && extra.server) o.push(Buffer.concat([Buffer.from([54, 4]), ipb(n2ip(extra.server))]));
    o.push(Buffer.from([55, 7, 1, 3, 6, 15, 51, 58, 59]), Buffer.from([255]));
    return Buffer.concat([b, ...o]);
  }
  _dhcpSend(msg, unicastTo) {
    if (unicastTo) { this.sendIp(unicastTo, 17, this._udpPkt(this.ip, unicastTo, 68, 67, msg)); return; }
    const u = this._udpPkt(0, 0xffffffff, 68, 67, msg);
    const h = Buffer.alloc(20); h[0] = 0x45; h.writeUInt16BE(20 + u.length, 2); h[8] = 64; h[9] = 17; h.writeUInt32BE(0xffffffff, 16);
    h.writeUInt16BE(cksum(h), 10);
    this._eth(BCAST, 0x0800, Buffer.concat([h, u]));
  }
  _dhcpTick(now) {
    const d = this.dhcp;
    if (d.state === 'STATIC') return;
    if (this.lease && d.state === 'BOUND') {
      if (now >= this.lease.expire) { this.log('lease expired'); this._unbind(); return; }
      if (now >= this.lease.t2) { d.state = 'REBINDING'; d.tries = 0; d.at = 0; d.xid = crypto.randomBytes(4).readUInt32BE(); }
      else if (now >= this.lease.t1) { d.state = 'RENEWING'; d.tries = 0; d.at = 0; d.xid = crypto.randomBytes(4).readUInt32BE(); }
    }
    if (this.lease && (d.state === 'RENEWING' || d.state === 'REBINDING') && now >= this.lease.expire) { this._unbind(); return; }
    const gap = Math.min(4000 * 2 ** Math.max(0, d.tries - 1), 16000);
    if (d.state === 'INIT' || d.state === 'SELECTING' || d.state === 'REQUESTING') {
      if (d.at && now - d.at < (d.tries ? gap : 0)) return;
      if (d.state === 'REQUESTING' && d.tries >= 4) { this._dhcpStart(); return; }
      d.at = now; d.tries++;
      if (d.state === 'INIT') d.state = 'SELECTING';
      if (d.state === 'SELECTING') this._dhcpSend(this._dhcpMsg(1));
      else this._dhcpSend(this._dhcpMsg(3, { reqIp: d.offer.ip, server: d.offer.server }));
    } else if (d.state === 'RENEWING' || d.state === 'REBINDING') {
      const g = Math.min(10000, Math.max(1000, (this.lease.expire - now) / 4));
      if (d.at && now - d.at < g) return;
      d.at = now; d.tries++;
      const m = this._dhcpMsg(3, { ciaddr: this.ip });
      if (d.state === 'RENEWING') this._dhcpSend(m, d.server); else this._dhcpSend(m);
    }
  }
  _unbind() {
    this.ip = 0; this.mask = 0; this.gw = 0; this.dns = []; this.lease = null;
    for (const s of [...this.tcp.values()]) this._tcpDrop(s, 'no link');
    this._dhcpStart(); this.emit('link', this.info());
  }
  _dhcpRx(p) {
    const d = this.dhcp;
    if (p.length < 241 || p[0] !== 2 || p.readUInt32BE(4) !== d.xid || p.readUInt32BE(236) !== 0x63825363) return false;
    if (!p.subarray(28, 34).equals(this.mac)) return false;
    const opt = new Map();
    for (let i = 240; i < p.length;) {
      const k = p[i]; if (k === 255) break; if (k === 0) { i++; continue; }
      const l = p[i + 1]; opt.set(k, p.subarray(i + 2, i + 2 + l)); i += 2 + l;
    }
    const type = opt.get(53) ? opt.get(53)[0] : 0, yi = p.readUInt32BE(16);
    const u32 = (k) => (opt.get(k) && opt.get(k).length >= 4 ? opt.get(k).readUInt32BE(0) : 0);
    if (type === 2 && d.state === 'SELECTING') {
      d.offer = { ip: yi, server: u32(54) }; d.state = 'REQUESTING'; d.tries = 0; d.at = 0;
      this._dhcpTick(Date.now());
    } else if (type === 5 && (d.state === 'REQUESTING' || d.state === 'RENEWING' || d.state === 'REBINDING')) {
      const secs = u32(51) || 3600, t1 = u32(58) || Math.floor(secs / 2), t2 = u32(59) || Math.floor(secs * 0.875), now = Date.now();
      const o = opt.get(3), dn = opt.get(6), dnsl = [];
      for (let i = 0; dn && i + 4 <= dn.length; i += 4) dnsl.push(dn.readUInt32BE(i));
      const wasIp = this.ip, newIp = yi || this.ip;
      this.ip = newIp; this.mask = u32(1) || ip2n('255.255.255.0'); this.gw = o && o.length >= 4 ? o.readUInt32BE(0) : 0; this.dns = dnsl;
      this.lease = { t1: now + t1 * 1000, t2: now + t2 * 1000, expire: now + secs * 1000 };
      d.server = u32(54) || (d.offer && d.offer.server) || 0; d.state = 'BOUND'; d.tries = 0;
      this.arp.clear();
      if (wasIp !== newIp) { this._announce(); this.log('bound', n2ip(newIp)); }
      this.emit('link', this.info());
    } else if (type === 6) { this.log('DHCP NAK'); this._unbind(); }
    return true;
  }
  // test hook: force an immediate renew
  dhcpRenewNow() { if (this.lease) this.lease.t1 = Date.now() - 1; }

  // ---- DNS client ----
  resolve(name) {
    name = String(name).trim().replace(/\.$/, '');
    if (isIp(name)) return Promise.resolve(name);
    const key = name.toLowerCase(), c = this.dnsCache.get(key);
    if (c && c.exp > Date.now()) return Promise.resolve(c.ip);
    if (this.dnsPending.has(key)) return this.dnsPending.get(key);
    if (!this.ip || !this.dns.length) return Promise.reject(new Error('no dns'));
    const pr = this._dnsQuery(key).finally(() => this.dnsPending.delete(key));
    this.dnsPending.set(key, pr);
    return pr;
  }
  _dnsQuery(name) {
    return new Promise((res, rej) => {
      const id = crypto.randomBytes(2).readUInt16BE(), sock = this.udpBind(0);
      const q = [Buffer.from([id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
      for (const lab of name.split('.')) { if (!lab || lab.length > 63) { sock.close(); return rej(new Error('bad name')); } q.push(Buffer.from([lab.length]), Buffer.from(lab, 'ascii')); }
      q.push(Buffer.from([0, 0, 1, 0, 1]));
      const msg = Buffer.concat(q);
      let attempt = 0, done = false, timer = null;
      const finish = (e, ip, ttl) => {
        if (done) return; done = true; clearTimeout(timer); sock.close();
        if (e) rej(e); else { this.dnsCache.set(name, { ip, exp: Date.now() + Math.min(ttl || 60, 300) * 1000 }); res(ip); }
      };
      sock.onmessage = (b) => {
        if (b.length < 12 || b.readUInt16BE(0) !== id || !(b[2] & 0x80)) return;
        const rc = b[3] & 15;
        if (rc === 3) return finish(new Error('NXDOMAIN'));
        if (rc !== 0) return finish(new Error('dns rcode ' + rc));
        const r = this._dnsParseA(b);
        if (r) finish(null, r.ip, r.ttl); else finish(new Error('no A record'));
      };
      const send = () => {
        if (done) return;
        if (attempt >= 6) return finish(new Error('dns timeout'));
        const server = this.dns[attempt % this.dns.length];
        attempt++;
        try { sock.send(n2ip(server), 53, msg); } catch (e) { return finish(e); }
        timer = setTimeout(send, 1500);
      };
      send();
    });
  }
  _dnsParseA(b) {
    const skipName = (i) => { for (;;) { const l = b[i]; if (l === undefined) return -1; if (l === 0) return i + 1; if ((l & 0xc0) === 0xc0) return i + 2; i += 1 + l; } };
    let i = 12; const qd = b.readUInt16BE(4), an = b.readUInt16BE(6);
    for (let k = 0; k < qd; k++) { i = skipName(i); if (i < 0) return null; i += 4; }
    for (let k = 0; k < an; k++) {
      i = skipName(i); if (i < 0 || i + 10 > b.length) return null;
      const type = b.readUInt16BE(i), ttl = b.readUInt32BE(i + 4), rl = b.readUInt16BE(i + 8);
      if (type === 1 && rl === 4 && i + 14 <= b.length) return { ip: n2ip(b.readUInt32BE(i + 10)), ttl };
      i += 10 + rl;
    }
    return null;
  }
}

module.exports = { Stack, TcpSock, ip2n, n2ip, ipb, macStr, isIp, cksum, sum16, randomMac, BCAST };
