'use strict';
// Connects the ACNet service core (web/js/acnet-core.js) to a Stack: translates backend messages to stack sockets.
const { Stack, ip2n, n2ip, isIp } = require('./stack.cjs');
const RXCAP = 4096;

const aip = (s) => s.split('.').map(Number);
const amac = (s) => s.split(':').map((x) => parseInt(x, 16));

function linkMsg(stack) {
  const i = stack.info();
  return { op: 'link', up: i.up, mac: amac(i.mac), ip: aip(i.ip), mask: aip(i.mask), gw: aip(i.gw), dns: i.dns.map(aip) };
}

class StackBackend {
  // emit(msg) delivers a message to the core.
  constructor(stack, emit) {
    this.stack = stack; this.emit = emit; this.conns = new Map(); this.nextId = 1000;
    this.onLink = () => this.emit(linkMsg(stack));
    stack.on('link', this.onLink);
  }
  dispose() { this.stack.off('link', this.onLink); this.closeAll(); }
  closeAll() {
    for (const c of new Set(this.conns.values())) this._kill(c);
    this.conns.clear();
  }
  _kill(c) {
    if (c.sock) { c.sock.ondata = c.sock.onclose = c.sock.onsent = c.sock.oneof = c.sock.onconnect = null; c.sock.abort(); }
    if (c.listener) c.listener.close();
    if (c.udp) c.udp.close();
    c.dead = true;
  }
  _out(c, m) { // hold messages for accepted sockets until the core aliased them
    if (c.dead) return;
    if (!c.bound) { c.queue.push(m); return; }
    m.h = c.key; this.emit(m);
  }
  _wire(c) {
    const s = c.sock;
    s.onconnect = () => this._out(c, { op: 'connected' });
    s.ondata = (d) => this._out(c, { op: 'data', data: d });
    s.onsent = (n) => this._out(c, { op: 'sent', n });
    s.oneof = () => this._out(c, { op: 'eof' });
    s.onclose = (err) => { this._out(c, { op: 'closed', err }); };
  }
  handle(m) {
    const st = this.stack;
    switch (m.op) {
      case 'hello': this.emit(linkMsg(st)); return;
      case 'connect': {
        const c = { key: m.h, bound: true, queue: [] }; this.conns.set(m.h, c);
        st.resolve(m.host).then((ip) => {
          if (c.dead) return;
          c.sock = st.tcpConnect(ip, m.port, RXCAP); this._wire(c);
        }).catch((e) => { if (!c.dead) { this.conns.delete(m.h); this.emit({ op: 'error', h: m.h, err: e.message === 'NXDOMAIN' ? 'NXDOMAIN' : e.message === 'no link' ? 'no link' : 'dns' }); } });
        return;
      }
      case 'listen': {
        const c = { key: m.h, bound: true, queue: [] };
        try {
          c.listener = st.tcpListen(m.port, (sock) => {
            const id = this.nextId++, cc = { key: id, bound: false, queue: [], sock };
            this.conns.set(id, cc); this._wire(cc);
            this.emit({ op: 'accepted', h: m.h, id, rip: aip(n2ip(sock.rip)), rport: sock.rport });
          }, RXCAP);
          this.conns.set(m.h, c);
        } catch (e) { this.emit({ op: 'error', h: m.h, err: 'other' }); }
        return;
      }
      case 'alias': {
        const c = this.conns.get(m.id); if (!c) return;
        this.conns.delete(m.id); c.key = m.h; c.bound = true; this.conns.set(m.h, c);
        for (const q of c.queue.splice(0)) { q.h = m.h; this.emit(q); }
        return;
      }
      case 'udp': {
        try {
          const c = { key: m.h, bound: true, queue: [], udp: st.udpBind(m.port) };
          c.udp.onmessage = (data, ip, port) => this._out(c, { op: 'data', data, ip: aip(ip), port });
          this.conns.set(m.h, c);
          this.emit({ op: 'opened', h: m.h, port: c.udp.port });
        } catch (e) { this.emit({ op: 'error', h: m.h, err: 'other' }); }
        return;
      }
      case 'send': {
        const c = this.conns.get(m.h); if (!c) return;
        const data = Buffer.from(m.data);
        if (c.udp) { try { c.udp.send(m.host, m.port, data); } catch (e) { this.emit({ op: 'error', h: m.h, err: 'no link' }); } return; }
        if (c.sock && !c.sock.write(data)) this.emit({ op: 'error', h: m.h, err: 'reset' });
        return;
      }
      case 'credit': { const c = this.conns.get(m.h); if (c && c.sock) c.sock.consume(m.n); return; }
      case 'shutdown': { const c = this.conns.get(m.h); if (c && c.sock) c.sock.close(); return; }
      case 'close': {
        const c = this.conns.get(m.h) || this.conns.get(m.id);
        if (!c) return;
        this.conns.delete(c.key);
        if (c.sock && (c.sock.state === 'ESTABLISHED' || c.sock.state === 'CLOSE_WAIT')) { c.sock.ondata = c.sock.onsent = c.sock.oneof = c.sock.onconnect = null; c.sock.onclose = null; c.sock.close(); c.dead = true; }
        else this._kill(c);
        return;
      }
      case 'dns':
        st.resolve(m.name).then((ip) => this.emit({ op: 'dnsres', h: 0, ip: aip(ip) }), (e) => this.emit({ op: 'dnsres', h: 0, err: e.message === 'NXDOMAIN' ? 'NXDOMAIN' : 'dns' }));
        return;
      case 'ping':
        st.ping(m.ip, 2500).then((ms) => this.emit({ op: 'pingres', h: 0, ms: Math.min(65535, ms) }), () => this.emit({ op: 'pingres', h: 0, err: 'timeout' }));
        return;
      default:
    }
  }
}

module.exports = { StackBackend, linkMsg, Stack, ip2n, isIp };
