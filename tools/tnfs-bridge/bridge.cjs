// Local TNFS relay for ataricraft: browsers cannot send UDP, so the page asks this tiny HTTP server.
//   node bridge.cjs [port]        (default 8765, loopback only)
//   GET /list?host=h[:port]&path=/dir   -> [{name, dir, size}]
//   GET /file?host=h[:port]&path=/a.atr -> raw bytes
const dgram = require('dgram');
const net = require('net');
const http = require('http');

const TIMEOUT = 2000, RETRIES = 2;

const udpHosts = new Set(); // hosts that refused TCP

// TCP has no datagram boundaries, so work out each reply's length from its command.
function frameLen(b) {
  if (b.length < 5) return 0;
  const cmd = b[3], st = b[4];
  switch (cmd) {
    case 0x00: return st ? 5 : 9;
    case 0x10: case 0x29: return st ? 5 : 6;
    case 0x11: { if (st) return 5; const e = b.indexOf(0, 5); return e < 0 ? 0 : e + 1; }
    case 0x17: return st ? 5 : 8;
    case 0x18: {
      if (st) return 5;
      if (b.length < 9) return 0;
      let o = 9;
      for (let i = 0; i < b[5]; i++) {
        if (b.length < o + 13) return 0;
        const e = b.indexOf(0, o + 13);
        if (e < 0) return 0;
        o = e + 1;
      }
      return o;
    }
    case 0x24: return st ? 5 : 27;
    case 0x25: return st ? 5 : 9;
    case 0x21: { if (st) return 5; if (b.length < 7) return 0; return 7 + b.readUInt16LE(5); }
    default: return 5;
  }
}

class Conn {
  constructor(host, port) {
    this.host = host; this.port = port; this.id = 0; this.seq = 0; this.tcp = false;
    this.pending = new Map();
  }
  openUdp() {
    this.tcp = false;
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (m) => { const p = m.length >= 5 && this.pending.get(m[2]); if (p) p(m); });
    this.sock.on('error', () => {});
  }
  openTcp() {
    this.tcp = true; this.buf = Buffer.alloc(0); this.queue = [];
    return new Promise((ok, bad) => {
      const s = this.sock = net.connect(this.port, this.host);
      s.setNoDelay(true);
      const ct = setTimeout(() => s.destroy(new Error('tcp connect timeout')), 4000);
      s.once('connect', () => { clearTimeout(ct); ok(); });
      s.once('close', () => clearTimeout(ct));
      const fail = (e) => { this.dead = true; bad(e); this.queue.splice(0).forEach((w) => { clearTimeout(w.t); w.rej(new Error('tcp connection lost')); }); };
      s.on('error', fail);
      s.on('close', () => fail(new Error('tcp closed')));
      s.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        for (;;) {
          const n = frameLen(this.buf);
          if (!n || this.buf.length < n) break;
          const m = this.buf.subarray(0, n); this.buf = this.buf.subarray(n);
          const w = this.queue[0];
          if (w && w.seq !== m[2]) continue; // stray duplicate reply
          this.queue.shift();
          if (w) { clearTimeout(w.t); w.res(m); }
        }
      });
    });
  }
  async req(cmd, body, first) {
    const seq = first ? 0 : (this.seq = (this.seq + 1) & 255);
    const pkt = Buffer.concat([Buffer.from([this.id & 255, this.id >> 8, seq, cmd]), body]);
    if (this.tcp) {
      // The server drops requests that arrive back to back, so wait for each reply.
      const run = () => new Promise((res, rej) => {
        const w = { seq, res, rej, t: setTimeout(() => { rej(new Error('timeout talking to ' + this.host + ' (tcp)')); this.sock.destroy(); }, 15000) };
        this.queue.push(w);
        this.sock.write(pkt);
      });
      const p = (this.chain || Promise.resolve()).then(run, run);
      this.chain = p.catch(() => {});
      return p;
    }
    for (let i = 0; i < RETRIES; i++) {
      const r = await new Promise((res) => {
        const t = setTimeout(() => { this.pending.delete(seq); res(null); }, TIMEOUT);
        this.pending.set(seq, (m) => { clearTimeout(t); this.pending.delete(seq); res(m); });
        this.sock.send(pkt, this.port, this.host);
      });
      if (r) return r;
    }
    throw new Error('timeout talking to ' + this.host + ' cmd 0x' + cmd.toString(16));
  }
  async mountOnce() {
    this.id = 0; this.seq = 0;
    const r = await this.req(0x00, Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.from('/\0\0\0')]), true);
    if (r[4] !== 0) throw new Error('mount refused (status ' + r[4] + ')');
    this.id = r[0] | (r[1] << 8);
    this.seq = 0;
  }
  // TCP is faster and more reliable, so try it first. A "tcp:" or "udp:" prefix forces one;
  // otherwise fall back to UDP for UDP-only hosts and remember them.
  async mount() {
    if (this.force !== 'udp' && !(this.force !== 'tcp' && udpHosts.has(this.host))) {
      try {
        await this.openTcp();
        return await this.mountOnce();
      } catch (e) {
        try { this.sock.destroy(); } catch (x) {}
        if (this.force === 'tcp') throw e;
      }
      udpHosts.add(this.host);
    }
    this.openUdp();
    try { await this.mountOnce(); } catch (e) { this.sock.close(); throw e; }
  }
  close() {
    try { this.req(0x01, Buffer.alloc(0)).catch(() => {}); } catch (e) {}
    setTimeout(() => { try { this.tcp ? this.sock.destroy() : this.sock.close(); } catch (e) {} }, 500);
  }
}

const conns = new Map();
async function conn(hostSpec) {
  const m = /^(tcp|udp):(?:\/\/)?/i.exec(hostSpec.trim());
  const force = m ? m[1].toLowerCase() : null;
  const key = (force ? force + ':' : '') + hostSpec.trim().slice(m ? m[0].length : 0).toLowerCase();
  let c = conns.get(key);
  if (c && c.dead) { conns.delete(key); c = null; }
  if (!c) {
    const [h, p] = key.replace(/^(tcp|udp):/, '').split(':');
    c = new Conn(h, +p || 16384);
    c.force = force;
    c.ready = c.mount();
    conns.set(key, c);
    c.ready.catch(() => conns.delete(key));
  }
  await c.ready;
  clearTimeout(c.idle);
  c.idle = setTimeout(() => { conns.delete(key); c.close(); }, 60000);
  return c;
}

const cs = (b, off) => { const e = b.indexOf(0, off); return [b.toString('latin1', off, e < 0 ? b.length : e), (e < 0 ? b.length : e) + 1]; };
const path0 = (p) => Buffer.from(p + '\0', 'latin1');

// TNFS 1.2 extended listing: entries with flags and size, many per packet.
async function listX(c, path) {
  let r = await c.req(0x17, Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('\0'), path0(path)]));
  if (r[4] !== 0) { if (r[4] === 0x16 || r[4] === 0x26) return null; throw new Error('opendir failed (status ' + r[4] + ')'); }
  const h = r[5], total = r.readUInt16LE(6), out = [];
  let seen = 0;
  for (let guard = 0; guard < 200 && (!total || seen < total); guard++) {
    r = await c.req(0x18, Buffer.from([h, 0]));
    if (r[4] !== 0 && r[4] !== 0x21) break;
    const n = r[5] || 0;
    seen += n;
    let o = 9;
    for (let i = 0; i < n && o < r.length; i++) {
      const flags = r[o], size = r.readUInt32LE(o + 1);
      const [name, next] = cs(r, o + 13);
      o = next;
      if (name && name !== '.' && name !== '..') out.push({ name, dir: !!(flags & 1), size });
    }
    if (r[4] === 0x21) break;
  }
  c.req(0x12, Buffer.from([h])).catch(() => {});
  return out;
}

const listCache = new Map();
async function list(hostSpec, path) {
  const key = hostSpec.toLowerCase() + '|' + path, hit = listCache.get(key);
  if (hit && Date.now() - hit.t < 120000) return hit.v;
  const v = await listFresh(hostSpec, path);
  listCache.set(key, { t: Date.now(), v });
  return v;
}

async function listFresh(hostSpec, path) {
  const c = await conn(hostSpec);
  if (!c.noX) {
    try {
      const x = await listX(c, path);
      if (x && x.length) return x;
      if (x === null) c.noX = true;
    } catch (e) { if (/opendir failed/.test(e.message)) throw e; c.noX = true; }
  }
  let r = await c.req(0x10, path0(path));
  if (r[4] !== 0) throw new Error('opendir failed (status ' + r[4] + ')');
  const h = r[5], out = [];
  for (;;) {
    r = await c.req(0x11, Buffer.from([h]));
    if (r[4] !== 0) break;
    const [name] = cs(r, 5);
    if (name === '.' || name === '..' || !name) continue;
    out.push({ name, dir: false, size: 0 });
  }
  c.req(0x12, Buffer.from([h])).catch(() => {});
  const base = path.endsWith('/') ? path : path + '/';
  await Promise.all(out.map(async (e) => {
    try {
      const s = await c.req(0x24, path0(base + e.name));
      if (s[4] === 0) { e.dir = (s.readUInt16LE(5) & 0xf000) === 0x4000; e.size = s.readUInt32LE(11); }
    } catch (x) { /* keep defaults */ }
  }));
  return out;
}

async function file(hostSpec, path) {
  const c = await conn(hostSpec);
  const st = await c.req(0x24, path0(path));
  if (st[4] !== 0) throw new Error('stat failed (status ' + st[4] + ')');
  const size = st.readUInt32LE(11), K = size > 8192 ? (c.tcp ? 1 : 8) : 1, per = Math.ceil(size / K);
  const out = Buffer.alloc(size);
  await Promise.all(Array.from({ length: K }, async (_, k) => {
    const cc = c;
    const start = k * per, end = Math.min(size, start + per);
    if (start >= end) return;
    let r = await cc.req(0x29, Buffer.concat([Buffer.from([1, 0, 0, 0]), path0(path)]));
    if (r[4] !== 0) throw new Error('open failed (status ' + r[4] + ')');
    const fd = r[5];
    if (start) {
      const pos = Buffer.alloc(6); pos[0] = fd; pos.writeUInt32LE(start, 2);
      r = await cc.req(0x25, pos);
      if (r[4] !== 0) throw new Error('seek failed (status ' + r[4] + ')');
    }
    for (let at = start; at < end;) {
      r = await cc.req(0x21, Buffer.from([fd, 0x00, 0x02]));
      if (r[4] !== 0) break;
      const n = Math.min(r.readUInt16LE(5), end - at);
      if (!n) break;
      r.copy(out, at, 7, 7 + n);
      at += n;
    }
    cc.req(0x23, Buffer.from([fd])).catch(() => {});
  }));
  return out;
}
const server = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (rq.method === 'OPTIONS') { rs.writeHead(204); rs.end(); return; }
  if (u.pathname === '/ping') { rs.end('ataricraft-tnfs-bridge'); return; }
  if (u.pathname === '/status') {
    try { rs.end(await (await fetch('https://fujinet.online/tnfs-server-status/')).text()); } catch (e) { rs.writeHead(502); rs.end(String(e.message)); }
    return;
  }
  const host = u.searchParams.get('host') || '', path = u.searchParams.get('path') || '/';
  if (!/^((tcp|udp):(\/\/)?)?[a-z0-9.-]+(:\d+)?$/i.test(host)) { rs.writeHead(400); rs.end('bad host'); return; }
  try {
    if (u.pathname === '/list') { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(await list(host, path))); }
    else if (u.pathname === '/file') { rs.setHeader('Content-Type', 'application/octet-stream'); rs.end(await file(host, path)); }
    else if (u.pathname === '/ping') rs.end('ataricraft-tnfs-bridge');
    else { rs.writeHead(404); rs.end(); }
  } catch (e) { rs.writeHead(502); rs.end(String(e.message)); }
});
const port = +process.argv[2] || 8765;
server.listen(port, '127.0.0.1', () => console.log('TNFS bridge on http://127.0.0.1:' + port));

// Unmount cleanly so the servers don't keep our sessions open.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { conns.forEach((c) => c.close()); setTimeout(() => process.exit(0), 700); });
}
