// Small in-process FTP server for tests (passive mode only, one root directory, no TLS).
//   const s = await start(rootDir, {user:'atari', pass:'secret'}); s.port; s.close(); s.log (commands seen)
const net = require('net'), fs = require('fs'), path = require('path');

function start(root, opts) {
  opts = opts || {};
  const log = [];
  const resolveIn = (cwd, p) => {
    const full = path.resolve(root, '.' + path.posix.normalize('/' + (p.startsWith('/') ? p : path.posix.join(cwd, p))));
    if (full !== path.resolve(root) && !full.startsWith(path.resolve(root) + path.sep)) throw new Error('outside');
    return full;
  };
  const server = net.createServer((c) => {
    let cwd = '/', user = '', authed = false, rnfr = null, pasv = null, buf = '';
    const say = (s) => c.write(s + '\r\n');
    say('220 mock ftp ready');
    const dataConn = () => new Promise((res, rej) => { if (!pasv) return rej(new Error('no pasv')); pasv.once('conn', res); if (pasv.sock) res(pasv.sock); });
    const listing = (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
      const st = fs.statSync(path.join(dir, e.name));
      return `${e.isDirectory() ? 'd' : '-'}rw-r--r-- 1 ftp ftp ${String(e.isDirectory() ? 0 : st.size).padStart(8)} Jan  1 12:00 ${e.name}`;
    }).join('\r\n') + '\r\n';
    c.on('data', async (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const sp = line.indexOf(' '), cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase(), arg = sp < 0 ? '' : line.slice(sp + 1);
        log.push(cmd === 'PASS' ? 'PASS ***' : line);
        try {
          if (cmd === 'USER') { user = arg; say(opts.user ? '331 password please' : (arg === 'anonymous' ? '331 anonymous ok' : '530 anonymous only')); continue; }
          if (cmd === 'PASS') { if (!opts.user || (user === opts.user && arg === opts.pass)) { authed = true; say('230 logged in'); } else say('530 login incorrect'); continue; }
          if (cmd === 'QUIT') { say('221 bye'); c.end(); continue; }
          if (!authed) { say('530 login first'); continue; }
          if (cmd === 'TYPE' || cmd === 'MODE' || cmd === 'STRU') { say('200 ok'); continue; }
          if (cmd === 'PWD') { say(`257 "${cwd}"`); continue; }
          if (cmd === 'CWD') { const f = resolveIn(cwd, arg); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) { cwd = '/' + path.relative(root, f).replace(/\\/g, '/'); say('250 ok'); } else say('550 no such directory'); continue; }
          if (cmd === 'PASV') {
            if (pasv && pasv.srv) pasv.srv.close();
            pasv = { sock: null, waiters: [] };
            pasv.once = (ev, fn) => pasv.waiters.push(fn);
            pasv.emit = (ev, s) => pasv.waiters.splice(0).forEach((w) => w(s));
            pasv.srv = net.createServer((s) => { pasv.sock = s; pasv.emit('conn', s); });
            await new Promise((r) => pasv.srv.listen(0, '127.0.0.1', r));
            const p = pasv.srv.address().port;
            say(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})`); continue;
          }
          if (['LIST', 'NLST', 'RETR', 'STOR', 'APPE'].includes(cmd)) {
            if (cmd === 'LIST' || cmd === 'NLST') { const dir = resolveIn(cwd, arg.replace(/^-\S+\s*/, '') || '.'); if (!fs.existsSync(dir)) { say('550 not found'); continue; } say('150 listing'); const s = await dataConn(); s.end(listing(dir)); await new Promise((r) => s.on('close', r)); say('226 done'); }
            else if (cmd === 'RETR') { const f = resolveIn(cwd, arg); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { say('550 no such file'); continue; } say('150 sending'); const s = await dataConn(); s.end(fs.readFileSync(f)); await new Promise((r) => s.on('close', r)); say('226 done'); }
            else {
              if (opts.readOnly) { say('550 permission denied'); continue; }
              const f = resolveIn(cwd, arg); say('150 receiving'); const s = await dataConn(); const parts = []; s.on('data', (x) => parts.push(x));
              await new Promise((r) => s.on('close', r));
              (cmd === 'APPE' ? fs.appendFileSync : fs.writeFileSync)(f, Buffer.concat(parts)); say('226 stored');
            }
            pasv = null; continue;
          }
          if (cmd === 'MKD') { fs.mkdirSync(resolveIn(cwd, arg)); say('257 created'); continue; }
          if (cmd === 'RMD') { fs.rmdirSync(resolveIn(cwd, arg)); say('250 removed'); continue; }
          if (cmd === 'DELE') { fs.unlinkSync(resolveIn(cwd, arg)); say('250 deleted'); continue; }
          if (cmd === 'RNFR') { rnfr = resolveIn(cwd, arg); say(fs.existsSync(rnfr) ? '350 ready' : '550 not found'); continue; }
          if (cmd === 'RNTO') { fs.renameSync(rnfr, resolveIn(cwd, arg)); say('250 renamed'); continue; }
          say('502 not implemented');
        } catch (e) { say('550 ' + (e.code === 'ENOENT' ? 'not found' : e.message)); }
      }
    });
    c.on('error', () => {});
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ port: server.address().port, log, close: () => server.close() })));
}

module.exports = { start };
if (require.main === module) {
  const dir = path.resolve(process.argv[2] || '.'), port = +process.argv[3] || 2121;
  start(dir, {}).then((s) => console.log('mock ftp serving', dir, 'on 127.0.0.1:' + s.port));
}
