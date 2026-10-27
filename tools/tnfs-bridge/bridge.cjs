// Local TNFS relay for ataricraft: browsers cannot send UDP, so the page asks this tiny HTTP server.
//   node bridge.cjs [port]        (default 8765, loopback only)
//   GET /list?host=h[:port]&path=/dir   -> [{name, dir, size}]
//   GET /file?host=h[:port]&path=/a.atr -> raw bytes
const dgram = require('dgram');
const http = require('http');

const TIMEOUT = 2500, RETRIES = 3;

class Conn {
  constructor(host, port) {
    this.host = host; this.port = port; this.id = 0; this.seq = 0; this.q = Promise.resolve();
    this.sock = dgram.createSocket('udp4');
    this.pending = new Map();
    this.sock.on('message', (m) => { const p = m.length >= 5 && this.pending.get(m[2]); if (p) p(m); });
    this.sock.on('error', () => {});
  }
  async req(cmd, body, first) {
    const seq = first ? 0 : (this.seq = (this.seq + 1) & 255);
    const pkt = Buffer.concat([Buffer.from([this.id & 255, this.id >> 8, seq, cmd]), body]);
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
  async mount() {
    const r = await this.req(0x00, Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.from('/\0\0\0')]), true);
    if (r[4] !== 0) throw new Error('mount refused (status ' + r[4] + ')');
    this.id = r[0] | (r[1] << 8);
    this.seq = 0;
  }
  close() { try { this.req(0x01, Buffer.alloc(0)).catch(() => {}); } catch (e) {} setTimeout(() => this.sock.close(), 500); }
}

const conns = new Map();
async function conn(hostSpec) {
  const key = hostSpec.toLowerCase();
  let c = conns.get(key);
  if (!c) {
    const [h, p] = key.split(':');
    c = new Conn(h, +p || 16384);
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

async function list(hostSpec, path) {
  const c = await conn(hostSpec);
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
  const size = st.readUInt32LE(11), K = size > 8192 ? 8 : 1, per = Math.ceil(size / K);
  const out = Buffer.alloc(size);
  await Promise.all(Array.from({ length: K }, async (_, k) => {
    const start = k * per, end = Math.min(size, start + per);
    if (start >= end) return;
    let r = await c.req(0x29, Buffer.concat([Buffer.from([1, 0, 0, 0]), path0(path)]));
    if (r[4] !== 0) throw new Error('open failed (status ' + r[4] + ')');
    const fd = r[5];
    if (start) {
      const pos = Buffer.alloc(6); pos[0] = fd; pos.writeUInt32LE(start, 2);
      r = await c.req(0x25, pos);
      if (r[4] !== 0) throw new Error('seek failed (status ' + r[4] + ')');
    }
    for (let at = start; at < end;) {
      r = await c.req(0x21, Buffer.from([fd, 0x00, 0x02]));
      if (r[4] !== 0) break;
      const n = Math.min(r.readUInt16LE(5), end - at);
      if (!n) break;
      r.copy(out, at, 7, 7 + n);
      at += n;
    }
    c.req(0x23, Buffer.from([fd])).catch(() => {});
  }));
  return out;
}
const server = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (rq.method === 'OPTIONS') { rs.writeHead(204); rs.end(); return; }
  const host = u.searchParams.get('host') || '', path = u.searchParams.get('path') || '/';
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) { rs.writeHead(400); rs.end('bad host'); return; }
  try {
    if (u.pathname === '/list') { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(await list(host, path))); }
    else if (u.pathname === '/file') { rs.setHeader('Content-Type', 'application/octet-stream'); rs.end(await file(host, path)); }
    else if (u.pathname === '/ping') rs.end('ataricraft-tnfs-bridge');
    else { rs.writeHead(404); rs.end(); }
  } catch (e) { rs.writeHead(502); rs.end(String(e.message)); }
});
const port = +process.argv[2] || 8765;
server.listen(port, '127.0.0.1', () => console.log('TNFS bridge on http://127.0.0.1:' + port));
