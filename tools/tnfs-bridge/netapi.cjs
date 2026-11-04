// /net/* endpoints for the virtual FujiNet N: device: HTTP, TCP client/server and UDP.
// Every call needs the X-AC-Token header (printed at relay start) and, unless --allow-lan is set,
// targets that resolve to loopback/private/link-local addresses are refused so a web page cannot use
// the relay to reach your LAN. Args travel in the X-AC-Args header (URI-encoded JSON); the body is raw bytes.
const dns = require('dns').promises;
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ERR = { OK: 1, TIMEOUT: 138, GENERAL: 144, DENIED: 167, NOT_FOUND: 170, REFUSED: 200, UNREACH: 201, RESET: 204, ADDR_IN_USE: 206, NO_SERVER: 208, NO_WAIT: 209 };
const MAX_BODY = 8 << 20, MAX_SOCKETS = 32;

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb') || /^f[cd]/.test(l)) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    return m ? isPrivate(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function create(opts) {
  const token = opts.token || crypto.randomBytes(12).toString('hex');
  const allowLan = !!opts.allowLan;
  const sockets = new Map(); // id -> {kind, ...}
  let nextId = 1;
  const newId = () => nextId++;

  async function resolve(host) {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!addrs.length) throw Object.assign(new Error('no address'), { code: ERR.NOT_FOUND });
    if (!allowLan && addrs.some((a) => isPrivate(a.address))) throw Object.assign(new Error('private address blocked'), { code: ERR.DENIED });
    return addrs[0].address;
  }
  const fail = (e) => ({ err: e.code && typeof e.code === 'number' ? e.code : (e.code === 'ENOTFOUND' ? ERR.NOT_FOUND : e.code === 'ECONNREFUSED' ? ERR.REFUSED : e.code === 'ETIMEDOUT' ? ERR.TIMEOUT : ERR.UNREACH) });

  // Pseudo-host diag.ataricraft: N:HTTP://diag.ataricraft/ping|trace|dns/<host> returns plain text for the PING,
  // TRACERT and NSLOOKUP tools. A real FujiNet cannot resolve this name, which is how the tools detect it.
  const HOSTRE = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,100}$/;
  const clip = (s) => s.replace(/\r/g, '').split('\n').filter((l) => !/^\s*(Pinging .* with|Approximate round|Tracing route|over a maximum|Trace complete|PING |traceroute to)/i.test(l)).map((l) => l.trim().replace(/\s{2,}/g, ' ').replace(/Reply from /, 'Reply ').replace(/bytes=\d+ /, '').replace(/ ms\b/g, 'ms').replace(/packets transmitted, /, 'sent ').replace(/, /g, ' ').slice(0, 39)).filter((l) => l).join('\n') + '\n';
  function run(cmd, args, ms) {
    return new Promise((res) => execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, out, err) => res(String(out || '') + (out ? '' : String(err || (e && e.message) || '')))));
  }
  async function diag(url) {
    const m = /^\/(ping|trace|dns)\/([^/]+)$/.exec(url.pathname);
    const host = m && decodeURIComponent(m[2]).replace(/^([^:]+):\d+$/, '$1');
    const text = (s) => ({ meta: { status: 200, headers: [['content-type', 'text/plain']] }, body: Buffer.from(s, 'latin1') });
    if (!m || !HOSTRE.test(host)) return text('BAD REQUEST\n');
    const win = process.platform === 'win32';
    try {
      if (m[1] === 'dns') {
        let out = 'Name: ' + host + '\n';
        if (net.isIP(host)) {
          const names = await dns.reverse(host).catch(() => []);
          return text(clip(out + (names.length ? names.map((n) => 'Host: ' + n).join('\n') : 'No PTR record')));
        }
        const as = (await dns.lookup(host, { all: true })).map((a) => a.address).filter((a) => allowLan || !isPrivate(a));
        return text(clip(out + (as.length ? as.map((a) => 'Address: ' + a).join('\n') : 'No address')));
      }
      const ip = await resolve(host);
      if (m[1] === 'ping') return text(clip('Pinging ' + host + ' [' + ip + ']\n' + await run('ping', win ? ['-n', '4', '-w', '2000', ip] : ['-c', '4', '-W', '2', ip], 20000)));
      return text(clip('Tracing ' + host + ' [' + ip + ']\n' + await run(win ? 'tracert' : 'traceroute', win ? ['-d', '-h', '16', '-w', '500', ip] : ['-n', '-m', '16', '-q', '2', '-w', '1', ip], 60000)));
    } catch (e) {
      return text(m[1] === 'dns' ? 'Not found\n' : 'Host not found or blocked\n');
    }
  }
  async function http(a, body) {
    let url = new URL(a.url), method = a.method || 'GET';
    if (url.hostname === 'diag.ataricraft') return diag(url);
    if (!/^https?:$/.test(url.protocol)) return { err: ERR.GENERAL };
    const headers = Object.assign({}, a.headers);
    for (let hop = 0; hop < 6; hop++) {
      await resolve(url.hostname);
      const r = await fetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) || !body.length ? undefined : body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) {
        url = new URL(r.headers.get('location'), url);
        if (!/^https?:$/.test(url.protocol)) return { err: ERR.GENERAL };
        if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) method = 'GET';
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return { meta: { status: r.status, headers: [...r.headers.entries()] }, body: buf.subarray(0, MAX_BODY) };
    }
    return { err: ERR.GENERAL };
  }


  async function tcpOpen(a) {
    const ip = await resolve(a.host);
    return new Promise((res) => {
      const s = net.connect({ host: ip, port: a.port });
      const o = { kind: 'tcp', s, buf: [], eof: false };
      s.setTimeout(30000, () => s.destroy());
      s.on('data', (d) => { o.buf.push(d); });
      s.on('end', () => { o.eof = true; });
      s.on('close', () => { o.eof = true; });
      s.on('error', () => { o.eof = true; });
      s.once('connect', () => { const id = newId(); if (sockets.size >= MAX_SOCKETS) { s.destroy(); return res({ err: ERR.GENERAL }); } sockets.set(id, o); res({ meta: { id } }); });
      s.once('error', (e) => res(fail(e)));
    });
  }
  function attach(sock) {
    const o = { kind: 'tcp', s: sock, buf: [], eof: false };
    sock.on('data', (d) => o.buf.push(d));
    for (const ev of ['end', 'close', 'error']) sock.on(ev, () => { o.eof = true; });
    const id = newId(); sockets.set(id, o); return id;
  }
  function tcpListen(a) {
    return new Promise((res) => {
      const srv = net.createServer();
      const o = { kind: 'listen', s: srv, pending: [] };
      srv.on('connection', (sock) => { if (o.pending.length < 4) o.pending.push(sock); else sock.destroy(); });
      srv.once('error', (e) => res(e.code === 'EADDRINUSE' ? { err: ERR.ADDR_IN_USE } : fail(e)));
      srv.listen(a.port, allowLan ? '0.0.0.0' : '127.0.0.1', () => { const id = newId(); sockets.set(id, o); res({ meta: { id } }); });
    });
  }
  function tcpAccept(a) {
    const o = sockets.get(a.id);
    if (!o || o.kind !== 'listen') return { err: ERR.NO_SERVER };
    const sock = o.pending.shift();
    if (!sock) return { err: ERR.NO_WAIT };
    return { meta: { id: attach(sock) } };
  }
  function tcpRead(a) {
    const o = sockets.get(a.id);
    if (!o || o.kind !== 'tcp') return { err: ERR.GENERAL };
    const all = Buffer.concat(o.buf), n = Math.min(all.length, a.n || 512);
    o.buf = n < all.length ? [all.subarray(n)] : [];
    return { meta: { eof: o.eof && !o.buf.length }, body: all.subarray(0, n) };
  }
  function tcpWrite(a, body) {
    const o = sockets.get(a.id);
    if (!o || o.kind !== 'tcp' || o.s.destroyed) return { err: ERR.RESET };
    o.s.write(body);
    return { meta: {} };
  }
  function close(a) {
    const o = sockets.get(a.id);
    if (o) {
      sockets.delete(a.id);
      try { if (o.kind === 'listen') o.pending.forEach((p) => p.destroy()); o.s.destroy ? o.s.destroy() : o.s.close(); } catch (e) { /* already closed */ }
    }
    return { meta: {} };
  }
  async function udpOpen(a) {
    if (a.host) await resolve(a.host);
    return new Promise((res) => {
      const s = dgram.createSocket('udp4');
      const o = { kind: 'udp', s, q: [] };
      s.on('message', (m) => { if (o.q.length < 64) o.q.push(m); });
      s.once('error', (e) => res(fail(e)));
      s.bind(a.host ? 0 : a.port, allowLan ? '0.0.0.0' : '127.0.0.1', () => { const id = newId(); sockets.set(id, o); res({ meta: { id } }); });
    });
  }
  function udpRead(a) {
    const o = sockets.get(a.id);
    if (!o || o.kind !== 'udp') return { err: ERR.GENERAL };
    return { meta: {}, body: o.q.shift() || Buffer.alloc(0) };
  }
  async function udpSend(a, body) {
    const o = sockets.get(a.id);
    if (!o || o.kind !== 'udp') return { err: ERR.GENERAL };
    const ip = await resolve(a.host);
    o.s.send(body.subarray(0, 1400), a.port, ip);
    return { meta: {} };
  }

  const routes = { '/net/http': http, '/net/tcp/open': tcpOpen, '/net/tcp/listen': tcpListen, '/net/tcp/accept': tcpAccept, '/net/tcp/read': tcpRead, '/net/tcp/write': tcpWrite, '/net/tcp/close': close, '/net/udp/open': udpOpen, '/net/udp/read': udpRead, '/net/udp/send': udpSend, '/net/udp/close': close };
  Object.assign(routes, opts.extra || {});

  async function handle(rq, rs, pathname) {
    const given = Buffer.from(String(rq.headers['x-ac-token'] || ''));
    const want = Buffer.from(token);
    if (rq.method !== 'POST' || given.length !== want.length || !crypto.timingSafeEqual(given, want)) { rs.writeHead(403); rs.end('token'); return; }
    const fn = routes[pathname];
    if (!fn) { rs.writeHead(404); rs.end(); return; }
    const chunks = []; let size = 0;
    for await (const c of rq) { size += c.length; if (size > MAX_BODY) { rs.writeHead(413); rs.end(); return; } chunks.push(c); }
    let r;
    try {
      const args = JSON.parse(decodeURIComponent(rq.headers['x-ac-args'] || '%7B%7D'));
      r = await fn(args, Buffer.concat(chunks));
    } catch (e) { r = fail(e); }
    if (r.err) { rs.writeHead(502, { 'X-AC-Err': String(r.err) }); rs.end(); return; }
    rs.writeHead(200, { 'X-AC-Meta': encodeURIComponent(JSON.stringify(r.meta || {})), 'Content-Type': 'application/octet-stream' });
    rs.end(r.body || '');
  }
  const closeAll = () => { for (const id of [...sockets.keys()]) close({ id }); };
  return { token, handle, closeAll, isPrivate };
}

module.exports = { create, isPrivate };
