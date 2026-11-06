// Local TNFS relay for ataricraft: browsers cannot send UDP, so the page asks this tiny HTTP server.
//   node bridge.cjs [port]        (default 8765, loopback only)
//   GET /list?host=h[:port]&path=/dir   -> [{name, dir, size}]
//   GET /file?host=h[:port]&path=/a.atr -> raw bytes
const dgram = require('dgram');
const net = require('net');
const http = require('http');
const netapi = require('./netapi.cjs');

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
    case 0x22: return st ? 5 : 7;
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
const flag = (n) => process.argv.includes(n);

// Writes are off unless the relay is started with --allow-write.
const tnfsErr = (what, status) => { const e = new Error(what + ' failed (status ' + status + ')'); e.code = status === 2 ? 170 : (status === 1 || status === 13) ? 167 : 144; return e; };
const needWrite = () => { if (!flag('--allow-write')) { const e = new Error('writes need --allow-write'); e.code = 167; throw e; } };
async function put(hostSpec, path, data, append) {
  needWrite();
  const c = await conn(hostSpec);
  // O_WRONLY | O_CREAT | (O_APPEND or O_TRUNC), mode 0644
  const fl = 0x0002 | 0x0100 | (append ? 0x0008 : 0x0200);
  let r = await c.req(0x29, Buffer.concat([Buffer.from([fl & 255, fl >> 8, 0xa4, 0x01]), path0(path)]));
  if (r[4] !== 0) throw tnfsErr('open', r[4]);
  const fd = r[5];
  try {
    for (let at = 0; at < data.length; at += 512) {
      const chunk = data.subarray(at, at + 512), h = Buffer.alloc(3);
      h[0] = fd; h.writeUInt16LE(chunk.length, 1);
      r = await c.req(0x22, Buffer.concat([h, chunk]));
      if (r[4] !== 0) throw tnfsErr('write', r[4]);
    }
  } finally { await c.req(0x23, Buffer.from([fd])).catch(() => {}); }
  listCache.clear();
}
async function fsop(hostSpec, op, path, to) {
  needWrite();
  const c = await conn(hostSpec);
  const cmd = { mkdir: 0x13, rmdir: 0x14, unlink: 0x26, rename: 0x28 }[op];
  if (!cmd) { const e = new Error('bad op'); e.code = 146; throw e; }
  const r = await c.req(cmd, op === 'rename' ? Buffer.concat([path0(path), path0(to)]) : path0(path));
  if (r[4] !== 0) throw tnfsErr(op, r[4]);
  listCache.clear();
}
// SD: one folder on this PC (--sd DIR) shown to the Atari as SD:/. Paths cannot leave it (symlinks are resolved first).
const fs = require('fs'), pathMod = require('path');
const sdArg = process.argv.indexOf('--sd');
const sdRoot = sdArg > 0 && process.argv[sdArg + 1] ? pathMod.resolve(process.argv[sdArg + 1]) : null;
const sdErr = (code) => { const e = new Error('sd error ' + code); e.code = code; return e; };
function sdPath(p, mustExist) {
  if (!sdRoot) throw sdErr(146);
  const full = pathMod.resolve(sdRoot, '.' + pathMod.posix.normalize('/' + String(p || '/').replace(/\\/g, '/')));
  const inside = (f) => f === sdRoot || f.startsWith(sdRoot + pathMod.sep);
  if (!inside(full)) throw sdErr(167);
  let real = full;
  try { real = fs.realpathSync(full); } catch (e) { if (mustExist) throw sdErr(170); try { real = pathMod.join(fs.realpathSync(pathMod.dirname(full)), pathMod.basename(full)); } catch (x) { throw sdErr(170); } }
  const rr = fs.realpathSync(sdRoot);
  if (!(real === rr || real.startsWith(rr + pathMod.sep))) throw sdErr(167);
  return full;
}
const sdFsErr = (e) => { throw e.code && typeof e.code === 'number' ? e : sdErr(e.code === 'ENOENT' ? 170 : e.code === 'EEXIST' ? 151 : e.code === 'ENOTEMPTY' || e.code === 'EPERM' || e.code === 'EACCES' ? 167 : 144); };
function sdList(p) {
  const d = sdPath(p, true);
  try { return fs.readdirSync(d, { withFileTypes: true }).map((e) => { let size = 0, mtime = 0; try { const s = fs.statSync(pathMod.join(d, e.name)); mtime = Math.round(s.mtimeMs); size = e.isFile() ? s.size : 0; } catch (x) {} return { name: e.name, dir: e.isDirectory(), size, mtime }; }); } catch (e) { sdFsErr(e); }
}
function sdFile(p) { try { return fs.readFileSync(sdPath(p, true)); } catch (e) { sdFsErr(e); } }
function sdPut(p, data, append) { needWrite(); try { const f = sdPath(p, false); (append ? fs.appendFileSync : fs.writeFileSync)(f, data); } catch (e) { sdFsErr(e); } }
function sdOp(op, p, to) {
  needWrite();
  try {
    if (op === 'mkdir') fs.mkdirSync(sdPath(p, false));
    else if (op === 'rmdir') fs.rmdirSync(sdPath(p, true));
    else if (op === 'unlink') { const a = sdPath(p, true); if (fs.statSync(a).isDirectory()) throw sdErr(167); fs.unlinkSync(a); }
    else if (op === 'rename') fs.renameSync(sdPath(p, true), sdPath(to, false));
    else throw sdErr(146);
  } catch (e) { sdFsErr(e); }
}
// One token that survives restarts, so nothing needs pasting: AC_TOKEN wins, else ~/.ataricraft-token.
const osMod = require('os');
const tokenFile = pathMod.join(osMod.homedir(), '.ataricraft-token');
function persistentToken() {
  if (process.env.AC_TOKEN) return process.env.AC_TOKEN;
  try { const t = fs.readFileSync(tokenFile, 'utf8').trim(); if (/^[0-9a-f]{16,}$/.test(t)) return t; } catch (e) {}
  const t = require('crypto').randomBytes(12).toString('hex');
  try { fs.writeFileSync(tokenFile, t + '\n', { mode: 0o600 }); } catch (e) {}
  return t;
}
const relayNet = netapi.create({ token: persistentToken(), allowLan: flag('--allow-lan'), allowWrite: flag('--allow-write'), extra: {
  '/net/sd/list': async (a) => ({ meta: {}, body: Buffer.from(JSON.stringify(sdList(a.path))) }),
  '/net/sd/file': async (a) => ({ meta: {}, body: sdFile(a.path) }),
  '/net/sd/put': async (a, body) => { sdPut(a.path, body, a.append); return { meta: {} }; },
  '/net/sd/op': async (a) => { sdOp(a.op, a.path, a.to || ''); return { meta: {} }; },
  '/net/tnfs/list': async (a) => ({ meta: {}, body: Buffer.from(JSON.stringify(await list(a.host, a.path || '/'))) }),
  '/net/tnfs/file': async (a) => ({ meta: {}, body: await file(a.host, a.path) }),
  '/net/tnfs/put': async (a, body) => { listCache.clear(); await put(a.host, a.path, body, a.append); listCache.clear(); return { meta: {} }; },
  '/net/tnfs/op': async (a) => { listCache.clear(); await fsop(a.host, a.op, a.path, a.to || ''); listCache.clear(); return { meta: {} }; },
} });
// The relay also serves the emulator (web/) so one command is enough: open http://127.0.0.1:PORT/.
// HTML is served with the token and relay address pre-filled. Static replies carry no CORS headers,
// so other websites cannot read the token, and a non-local Host header is refused (DNS rebinding).
const webRoot = pathMod.resolve(__dirname, '..', '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream' };
const ctl = require('./ctl.cjs').create(relayNet.token);
const dosArgs = process.argv.reduce((a, v, i, all) => (v === '--dos' && all[i + 1] ? a.concat(all[i + 1]) : a), []);
const dosboot = require('../dosboot/api.cjs').create({ token: relayNet.token, extraRoots: dosArgs });
const isApi = (p) => p.startsWith('/net/') || p.startsWith('/ctl/') || p.startsWith('/dosboot/') || ['/ping', '/status', '/list', '/file'].includes(p);
function serveStatic(rq, rs, u) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(rq.headers.host || '')) { rs.writeHead(403); rs.end('bad host'); return; }
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch (e) { rs.writeHead(400); rs.end(); return; }
  if (rel === '/') rel = '/index.html';
  const full = pathMod.resolve(webRoot, '.' + pathMod.posix.normalize(rel));
  if (!(full === webRoot || full.startsWith(webRoot + pathMod.sep))) { rs.writeHead(403); rs.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { rs.writeHead(404); rs.end('not found'); return; }
    const ext = pathMod.extname(full).toLowerCase();
    if (ext === '.html') {
      const inj = '<script>try{localStorage.setItem("ac.nettoken",' + JSON.stringify(relayNet.token) + ');localStorage.setItem("ac.tnfsbridge",location.origin)}catch(e){}</script>';
      data = Buffer.from(String(data).replace(/<head[^>]*>/i, (m) => m + inj));
    }
    rs.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    rs.end(data);
  });
}
const server = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  if (u.pathname.startsWith('/dosboot/')) { dosboot.handle(rq, rs, u); return; }
  if (rq.method === 'GET' && !isApi(u.pathname)) { serveStatic(rq, rs, u); return; }
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.setHeader('Access-Control-Allow-Private-Network', 'true');
  rs.setHeader('Access-Control-Allow-Headers', 'X-AC-Token, X-AC-Args');
  rs.setHeader('Access-Control-Expose-Headers', 'X-AC-Meta, X-AC-Err');
  rs.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (rq.method === 'OPTIONS') { rs.writeHead(204); rs.end(); return; }
  if (u.pathname.startsWith('/net/')) { relayNet.handle(rq, rs, u.pathname); return; }
  if (u.pathname.startsWith('/ctl/')) { ctl.handle(rq, rs, u.pathname); return; }
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
const port = +process.argv[2] || +process.env.AC_PORT || 8765;
server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('Ataricraft + relay running: ' + url + '   (Ctrl+C to stop)');
  console.log('Open that address and FujiNet networking is already set up (token and relay address are filled in for you).');
  console.log((flag('--allow-lan') ? '[LAN targets ALLOWED]' : '[LAN/loopback targets blocked]') + ' ' + (flag('--allow-write') ? '[writes ALLOWED]' : '[read-only]') + (sdRoot ? ' [SD: ' + sdRoot + ']' : ''));
  console.log('N: token (only needed if you open the page from a file or another host): ' + relayNet.token);
  if (flag('--open')) {
    const cp = require('child_process');
    try {
      if (process.platform === 'win32') cp.spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
      else cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch (e) {}
  }
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is busy (is the relay already running? try: node tools/tnfs-bridge/bridge.cjs ' + (port + 1) + ')' : String(e.message)); process.exit(1); });

// Unmount cleanly so the servers don't keep our sessions open.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { conns.forEach((c) => c.close()); relayNet.closeAll(); setTimeout(() => process.exit(0), 700); });
}
