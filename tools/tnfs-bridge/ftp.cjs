// Minimal FTP client for the relay (N:FTP://host/path). Passive mode, binary type, one control connection per operation.
// Used by netapi.cjs for /net/ftp/list, /file, /put and /op. Plain FTP only (no TLS), like the Atari tools expect.
const net = require('net');

const FTP_ERR = { GENERAL: 144, DENIED: 167, NOT_FOUND: 170, TIMEOUT: 138 };
const TMO = 15000;
const ferr = (code, msg) => Object.assign(new Error(msg), { code });

function lineSocket(sock) {
  let buf = '', waiters = [];
  const lines = [];
  sock.setEncoding('latin1');
  sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } flush(); });
  const closed = new Promise((res) => sock.on('close', res));
  function flush() { while (waiters.length && lines.length) waiters.shift()(lines.shift()); if (waiters.length && sock.destroyed) waiters.splice(0).forEach((w) => w(null)); }
  sock.on('close', flush);
  const next = () => new Promise((res, rej) => { waiters.push(res); flush(); setTimeout(() => rej(ferr(FTP_ERR.TIMEOUT, 'ftp timeout')), TMO).unref(); });
  return { next, closed };
}

// reply: {code, text}. Multi-line replies ("123-" ... "123 ") are folded.
async function readReply(ls) {
  let l = await ls.next(); if (l === null) throw ferr(FTP_ERR.GENERAL, 'ftp closed');
  const code = +l.slice(0, 3); let text = l;
  if (l[3] === '-') for (;;) { l = await ls.next(); if (l === null) throw ferr(FTP_ERR.GENERAL, 'ftp closed'); text += '\n' + l; if (+l.slice(0, 3) === code && l[3] === ' ') break; }
  return { code, text };
}

const connect = (host, port) => new Promise((res, rej) => { const s = net.connect({ host, port }, () => res(s)); s.setTimeout(TMO, () => s.destroy(ferr(FTP_ERR.TIMEOUT, 'timeout'))); s.on('error', rej); });

// api: {resolve(host) -> ip}. Returns a session object after login.
async function login(api, host, port, user, pass) {
  const ip = await api.resolve(host);
  const ctl = await connect(ip, port || 21), ls = lineSocket(ctl);
  ctl.removeAllListeners('error'); ctl.on('error', () => {});
  const S = { ctl, ip };
  S.cmd = async (c) => { ctl.write(c + '\r\n'); return readReply(ls); };
  S.expect = async (c, ok) => { const r = await S.cmd(c); if (!ok.includes(Math.floor(r.code / 100))) throw mapErr(r); return r; };
  S.quit = () => { try { ctl.write('QUIT\r\n'); } catch (e) { /* ignore */ } ctl.destroy(); };
  const hello = await readReply(ls);
  if (hello.code !== 220) { S.quit(); throw mapErr(hello); }
  try {
    let r = await S.cmd('USER ' + (user || 'anonymous'));
    if (r.code === 331) r = await S.cmd('PASS ' + (user ? pass || '' : pass || 'atari@ataricraft'));
    if (r.code !== 230 && r.code !== 202) throw ferr(FTP_ERR.DENIED, 'login: ' + r.text);
    await S.expect('TYPE I', [2]);
  } catch (e) { S.quit(); throw e; }
  // Opens a passive data connection and issues cmd; resolves to {sock, reply} once the server answers 1xx.
  S.data = async (c) => {
    const r = await S.expect('PASV', [2]);
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r.text);
    if (!m) throw ferr(FTP_ERR.GENERAL, 'bad PASV');
    const dport = (+m[5] << 8) | +m[6];
    const sock = await connect(ip, dport); // always the control peer's address: ignores a spoofed PASV host
    const first = await S.cmd(c);
    if (first.code >= 400) { sock.destroy(); throw mapErr(first); }
    return sock;
  };
  S.finish = async () => { const r = await readReply(ls); if (r.code >= 400) throw mapErr(r); };
  return S;
}

function mapErr(r) {
  const c = r.code;
  if (c === 550 || c === 450) return ferr(FTP_ERR.NOT_FOUND, r.text);
  if (c === 530 || c === 532 || c === 553 || c === 553) return ferr(FTP_ERR.DENIED, r.text);
  return ferr(FTP_ERR.GENERAL, r.text);
}

const slurp = (sock, max) => new Promise((res, rej) => { const a = []; let n = 0; sock.on('data', (d) => { n += d.length; if (n > max) { sock.destroy(); rej(ferr(FTP_ERR.GENERAL, 'too big')); } else a.push(d); }); sock.on('end', () => res(Buffer.concat(a))); sock.on('close', () => res(Buffer.concat(a))); sock.on('error', rej); });

// UNIX "ls -l" or DOS style LIST lines -> [{name, dir, size}]
function parseList(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    let m = /^([-dl])[rwxsStT-]{9}\+?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(.+)$/.exec(l);
    if (m) { const name = m[3].replace(/ -> .*$/, ''); if (name !== '.' && name !== '..') out.push({ name, dir: m[1] === 'd', size: +m[2] }); continue; }
    m = /^\d\d-\d\d-\d\d\s+\d\d:\d\d[AP]M\s+(<DIR>|\d+)\s+(.+)$/.exec(l);
    if (m) out.push({ name: m[2], dir: m[1] === '<DIR>', size: m[1] === '<DIR>' ? 0 : +m[1] });
  }
  return out;
}

async function withSession(api, a, fn) {
  for (const k of ['host', 'user', 'pass', 'path', 'to']) if (/[\x00-\x1f]/.test(String(a[k] || ''))) throw ferr(FTP_ERR.GENERAL, 'control character in ' + k);
  const S = await login(api, a.host, a.port, a.user, a.pass);
  try { return await fn(S); } finally { S.quit(); }
}

const ops = {
  async list(api, a) {
    return withSession(api, a, async (S) => {
      const sock = await S.data('LIST ' + (a.path && a.path !== '/' ? a.path : '/'));
      const txt = (await slurp(sock, 4 << 20)).toString('latin1'); await S.finish();
      return parseList(txt);
    });
  },
  async file(api, a, max) {
    return withSession(api, a, async (S) => { const sock = await S.data('RETR ' + a.path); const b = await slurp(sock, max); await S.finish(); return b; });
  },
  async put(api, a, body) {
    return withSession(api, a, async (S) => {
      const sock = await S.data((a.append ? 'APPE ' : 'STOR ') + a.path);
      await new Promise((res, rej) => { sock.on('error', rej); sock.end(body, res); });
      await S.finish();
    });
  },
  async op(api, a) {
    return withSession(api, a, async (S) => {
      if (a.op === 'mkdir') await S.expect('MKD ' + a.path, [2]);
      else if (a.op === 'rmdir') await S.expect('RMD ' + a.path, [2]);
      else if (a.op === 'unlink') await S.expect('DELE ' + a.path, [2]);
      else if (a.op === 'rename') { await S.expect('RNFR ' + a.path, [3]); await S.expect('RNTO ' + a.to, [2]); }
      else throw ferr(146, 'op');
    });
  },
};

module.exports = { ops, parseList, FTP_ERR };
