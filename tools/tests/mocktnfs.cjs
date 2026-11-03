// Minimal UDP TNFS server for tests: mount, directory listing, stat, read, write, seek, mkdir, rmdir, unlink, rename.
// Serves one directory and refuses paths that leave it. Not a full TNFS server (no extended listing, no TCP).
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

function start(root, port = 0) {
  const sessions = new Map(); let nextId = 1;
  const files = new Map(), dirs = new Map();
  let fdN = 1, dN = 1;
  const abs = (p) => { const f = path.resolve(root, '.' + path.posix.normalize('/' + p)); return f.startsWith(path.resolve(root)) ? f : null; };
  const cstr = (b, o) => { const e = b.indexOf(0, o); return [b.toString('latin1', o, e < 0 ? b.length : e), (e < 0 ? b.length : e) + 1]; };
  const log = [];
  const sock = dgram.createSocket('udp4');
  sock.on('message', (m, rinfo) => {
    if (m.length < 4) return;
    const id = m.readUInt16LE(0), seq = m[2], cmd = m[3], body = m.subarray(4);
    const reply = (status, extra) => sock.send(Buffer.concat([Buffer.from([id & 255, id >> 8, seq, cmd, status]), extra || Buffer.alloc(0)]), rinfo.port, rinfo.address);
    log.push(cmd);
    try {
      if (cmd === 0x00) { const sid = nextId++; sessions.set(sid, true); sock.send(Buffer.from([sid & 255, sid >> 8, seq, 0, 0, 0x02, 0x01, 0xe8, 0x03]), rinfo.port, rinfo.address); return; }
      if (cmd === 0x01) { reply(0); return; }
      if (!sessions.has(id)) { reply(0x1b); return; }
      const [p1, n1] = cstr(body, 0);
      switch (cmd) {
        case 0x10: { const a = abs(p1); if (!a || !fs.existsSync(a)) return reply(2); const h = dN++; dirs.set(h, ['.', '..', ...fs.readdirSync(a)].slice(2)); return reply(0, Buffer.from([h])); }
        case 0x11: { const l = dirs.get(body[0]); if (!l || !l.length) return reply(0x21); return reply(0, Buffer.from(l.shift() + '\0', 'latin1')); }
        case 0x12: dirs.delete(body[0]); return reply(0);
        case 0x13: { const a = abs(p1); if (!a) return reply(1); fs.mkdirSync(a); return reply(0); }
        case 0x14: { const a = abs(p1); if (!a) return reply(1); fs.rmdirSync(a); return reply(0); }
        case 0x17: return reply(0x16);
        case 0x24: {
          const a = abs(p1); if (!a || !fs.existsSync(a)) return reply(2);
          const s = fs.statSync(a), b = Buffer.alloc(24);
          b.writeUInt16LE(s.isDirectory() ? 0x41ed : 0x81a4, 0); b.writeUInt32LE(s.size, 6);
          return reply(0, b);
        }
        case 0x26: { const a = abs(p1); if (!a || !fs.existsSync(a)) return reply(2); fs.unlinkSync(a); return reply(0); }
        case 0x28: { const [p2] = cstr(body, n1), a = abs(p1), b = abs(p2); if (!a || !b || !fs.existsSync(a)) return reply(a && fs.existsSync(a) ? 1 : 2); fs.renameSync(a, b); return reply(0); }
        case 0x29: {
          const flags = body.readUInt16LE(0), [pp] = cstr(body, 4), a = abs(pp);
          if (!a) return reply(1);
          const rw = flags & 3;
          if (rw === 1 && !fs.existsSync(a)) return reply(2);
          const mode = rw === 1 ? 'r' : (flags & 0x0008) ? 'a' : (flags & 0x0200) ? 'w' : fs.existsSync(a) ? 'r+' : 'w';
          if (!(flags & 0x0100) && rw !== 1 && !fs.existsSync(a)) return reply(2);
          const fd = fs.openSync(a, mode), h = fdN++; files.set(h, { fd, pos: 0 });
          return reply(0, Buffer.from([h]));
        }
        case 0x21: { const f = files.get(body[0]); if (!f) return reply(9); const n = body.readUInt16LE(1), buf = Buffer.alloc(n), got = fs.readSync(f.fd, buf, 0, n, f.pos); if (!got) return reply(0x21); f.pos += got; const h = Buffer.alloc(2); h.writeUInt16LE(got); return reply(0, Buffer.concat([h, buf.subarray(0, got)])); }
        case 0x22: { const f = files.get(body[0]); if (!f) return reply(9); const n = body.readUInt16LE(1); fs.writeSync(f.fd, body, 3, n); const h = Buffer.alloc(2); h.writeUInt16LE(n); return reply(0, h); }
        case 0x23: { const f = files.get(body[0]); if (f) { fs.closeSync(f.fd); files.delete(body[0]); } return reply(0); }
        case 0x25: { const f = files.get(body[0]); if (!f) return reply(9); f.pos = body.readUInt32LE(2); const h = Buffer.alloc(4); h.writeUInt32LE(f.pos); return reply(0, h); }
        default: return reply(0x16);
      }
    } catch (e) { reply(e.code === 'ENOENT' ? 2 : e.code === 'EEXIST' ? 17 : 1); }
  });
  return new Promise((ok) => sock.bind(port, '127.0.0.1', () => ok({ port: sock.address().port, log, close: () => { try { sock.close(); } catch (e) {} } })));
}
module.exports = { start };
