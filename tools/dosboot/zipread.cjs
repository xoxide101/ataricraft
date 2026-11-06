// Minimal ZIP reader for Node (stored + deflate), used by the DOS boot scanner and the local relay.
const fs = require('fs');
const zlib = require('zlib');

function entries(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nl), method, csize, size, off });
    p += 46 + nl + xl + cl;
  }
  return out;
}

function extract(buf, ent) {
  const o = ent.off;
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + ent.csize);
  if (ent.method === 0) return Buffer.from(raw);
  if (ent.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('unsupported zip method ' + ent.method);
}

const list = (file) => entries(fs.readFileSync(file)).filter((e) => !e.name.endsWith('/'));
function read(file, member) {
  const buf = fs.readFileSync(file);
  const ent = entries(buf).find((e) => e.name === member);
  if (!ent) throw new Error('no member ' + member + ' in ' + file);
  return extract(buf, ent);
}

module.exports = { entries, extract, list, read };
